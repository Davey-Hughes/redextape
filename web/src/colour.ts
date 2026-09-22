import type { Extension } from '@codemirror/state'
import { RangeSetBuilder } from '@codemirror/state'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { Decoration, type EditorView, ViewPlugin } from '@codemirror/view'
import type { Tree, Language as TsLanguage, Node as TsNode, Query as TsQuery } from 'web-tree-sitter'
import { Edit, Language, Parser, Query } from 'web-tree-sitter'
import runtimeWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url'
import redextapeHighlights from '../../grammars/tree-sitter-redextape/queries/highlights.scm?raw'
import redextapeWasmUrl from '../../grammars/tree-sitter-redextape/tree-sitter-redextape.wasm?url'
import asmHighlights from '../../grammars/tree-sitter-redextape-asm/queries/highlights.scm?raw'
import asmWasmUrl from '../../grammars/tree-sitter-redextape-asm/tree-sitter-redextape-asm.wasm?url'
import lambdaHighlights from '../../grammars/tree-sitter-redextape-lambda/queries/highlights.scm?raw'
import lambdaWasmUrl from '../../grammars/tree-sitter-redextape-lambda/tree-sitter-redextape-lambda.wasm?url'
import tmHighlights from '../../grammars/tree-sitter-redextape-tm/queries/highlights.scm?raw'
import tmWasmUrl from '../../grammars/tree-sitter-redextape-tm/tree-sitter-redextape-tm.wasm?url'
import type { LanguageId } from './lsp-protocol'
import { tokenClassName } from './theme'
import type { TokenClass } from './types'

/**
 * The colourer, over `web-tree-sitter` and the four committed grammar `.wasm`.
 *
 * **INDICES HERE ARE UTF-16 CODE UNITS, NOT BYTES, AND THAT IS MEASURED.** Parsing `(λx. λy. x)` — 11
 * UTF-16 units, 13 UTF-8 bytes — gives a root `endIndex` of 11. CodeMirror positions are UTF-16 code
 * units too, so a tree-sitter offset goes straight into a `Decoration` range. **`spans.ts`'s
 * `byteToIndex` must not be used here.** That conversion exists for the λ pane's frame spans, which
 * `print_lambda_capped` writes as byte offsets, and applying it to these would mis-place every span
 * after the first non-ASCII character — which in this app means every λ document.
 *
 * **WITH ONE EXCEPTION, AND IT SHIPPED A BUG: A QUERY'S `startIndex`/`endIndex` ARE NOT IN THOSE
 * UNITS.** They are 2 × UTF-16 code units while the `startIndex`/`endIndex` READ BACK off a captured
 * node are plain code units. `colourSpans` below holds the doubling and the measurement that pins it;
 * this paragraph exists so the sentence above is not read as covering the whole module.
 *
 * **TWO CLOCKS, AND CONFLATING THEM IS THE OBVIOUS FIRST IMPLEMENTATION.** The tree is reparsed when
 * the document changes; the decorations are rebuilt when the document changes OR the viewport moves.
 * Measured in Chromium on a 103,028-unit TM: a full reparse is 8.1 ms and an incremental one is
 * 0.4 ms, so reparsing on every scroll would cost twenty times what it buys and would grow with the
 * document where the incremental path does not.
 *
 * **THE QUERY IS SCOPED TO THE VIEWPORT AND THAT IS A REQUIREMENT, NOT AN OPTIMISATION.** The same
 * document yields 32,591 captures whole and 293 for one viewport, and a 229,181-unit TM yields 82,464
 * against 897. Tens of thousands of decorations in one `RangeSet` is the problem `virtual-list.ts`
 * already exists to avoid on the δ table.
 *
 * **THOSE TWO VIEWPORT FIGURES READ 88 AND 420 UNTIL THE DOUBLING ABOVE WAS FOUND**, because every
 * probe behind them passed a code-unit count to an option that wanted twice one. They were corrected
 * by re-measuring, not by scaling: the whole-document counts beside them pass no range at all and
 * reproduce exactly, which is what pins the error to the range option rather than to the grammars.
 */

/** The `TokenClass` names as they cross the wasm boundary, paired with their capture names. */
export type CaptureTable = readonly [languageId: string, rows: readonly (readonly [string, TokenClass])[]]

/** Per language, capture name to CSS class. Built once from `captureClasses()`. */
export function classMapFrom(tables: readonly CaptureTable[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  for (const [languageId, rows] of tables) {
    const inner = new Map<string, string>()
    for (const [capture, cls] of rows) inner.set(capture, tokenClassName(cls))
    out.set(languageId, inner)
  }
  return out
}

/**
 * The document size past which an editor goes uncoloured, in UTF-16 code units.
 *
 * THE SESSION BUFFER CEILING'S NUMBER, NOT A NUMBER OF THIS MODULE'S OWN. A document the session will
 * not hold is not one worth parsing on the main thread: a full reparse extrapolates to about 480 ms
 * there, a visible stall on every keystroke.
 *
 * **THE UNITS DIFFER AND THE DIRECTION IS WHAT MAKES THAT SAFE.** `MAX_SCRATCH_TM_BYTES` counts UTF-8
 * bytes and `doc.length` counts UTF-16 code units, so these are not the same measurement of the same
 * document. UTF-16 units are never more than UTF-8 bytes for any text, so a document the session
 * accepted is always under this ceiling too: the mismatch can only ever make this gate more
 * permissive than the session's, never less. Reusing the number rather than converting is deliberate —
 * a conversion would need the whole document's bytes counted on every keystroke to answer a question
 * whose only job is to refuse the absurd.
 */
export const COLOUR_CEILING_UNITS = 6_100_000

/** Whether a document of this length goes uncoloured. At the ceiling exactly, it does not. */
export function overCeiling(units: number): boolean {
  return units > COLOUR_CEILING_UNITS
}

type GrammarSource = { readonly wasmUrl: string; readonly highlights: string }

const SOURCES: Record<LanguageId, GrammarSource> = {
  redextape: { wasmUrl: redextapeWasmUrl, highlights: redextapeHighlights },
  redextape_lambda: { wasmUrl: lambdaWasmUrl, highlights: lambdaHighlights },
  redextape_tm: { wasmUrl: tmWasmUrl, highlights: tmHighlights },
  redextape_asm: { wasmUrl: asmWasmUrl, highlights: asmHighlights },
}

export type LoadedGrammar = { readonly language: TsLanguage; readonly query: TsQuery }

export type GrammarRegistry = { load(id: LanguageId): Promise<LoadedGrammar | null> }

/** What a caught `unknown` says to a user. */
const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Loads a grammar once per language and remembers the answer, including a failure.
 *
 * **A FAILED LOAD IS REMEMBERED AS A FAILURE.** Retrying per editor would multiply one broken fetch by
 * the number of views and produce one notice each. Design §10: that language shows uncoloured, one
 * notice, and the other three are unaffected because each grammar loads independently.
 *
 * **THE RUNTIME IS SHARED AND ITS FAILURE IS THEREFORE NOT A PER-LANGUAGE ONE — TWO CALLBACKS, NOT
 * ONE, AND THAT SPLIT IS THE WHOLE POINT.** `Parser.init` is memoised across every `load`, so a
 * `web-tree-sitter.wasm` that will not fetch rejects EVERY language's promise from the one cause. Put
 * through `onFailure` that read as three coincidental per-language failures and produced three notices
 * for one event — four once part 5 adds an asm editor — against design §10's one notice per failure.
 * `onRuntimeFailure` fires at most once per registry and says the thing that is actually true: nothing
 * on the page is coloured. Per-grammar independence below is untouched; only the shared step is folded.
 *
 * **NEITHER CALLBACK IS OPTIONAL.** An optional reporting hook is a notice the design promises and the
 * app can silently not have — which is exactly what `ColourOptions.onCeiling` was until this branch's
 * whole-branch review found it declared, invoked and passed by nobody.
 */
export function createGrammarRegistry(opts: {
  onFailure: (id: LanguageId, reason: string) => void
  onRuntimeFailure: (reason: string) => void
  sources?: Partial<Record<LanguageId, GrammarSource>>
  /**
   * How the shared runtime is started, for a test that needs it to fail.
   *
   * **THIS REPLACED A `locateRuntime` SEAM THAT COULD NOT EXPRESS THE FAILURE.** `Parser.init` memoises
   * its module in a module-level `Module3 ??=`, so once any test in a process has initialised the
   * runtime successfully, a later `locateFile` pointing at nothing resolves from the cache and the
   * shared-failure path above is unreachable. A seam over the whole step can reject; a seam over the
   * path it reads cannot. Nothing in `src/` passes it.
   */
  initRuntime?: () => Promise<void>
}): GrammarRegistry {
  const cache = new Map<LanguageId, Promise<LoadedGrammar | null>>()
  let started: Promise<void> | null = null
  let runtimeReported = false
  const init = () => {
    started ??= (opts.initRuntime ?? (() => Parser.init({ locateFile: () => runtimeWasmUrl })))()
    return started
  }
  return {
    load(id) {
      const hit = cache.get(id)
      if (hit) return hit
      const source = opts.sources?.[id] ?? SOURCES[id]
      const p = (async () => {
        try {
          await init()
        } catch (e) {
          // ONCE FOR THE PAGE, NOT ONCE PER LANGUAGE — the shared cause gets the shared report. Every
          // `load` still resolves null, so each editor goes uncoloured exactly as a per-grammar
          // failure leaves one.
          if (!runtimeReported) {
            runtimeReported = true
            opts.onRuntimeFailure(reasonOf(e))
          }
          return null
        }
        try {
          const language = await Language.load(source.wasmUrl)
          return { language, query: new Query(language, source.highlights) }
        } catch (e) {
          opts.onFailure(id, reasonOf(e))
          return null
        }
      })()
      cache.set(id, p)
      return p
    },
  }
}

/**
 * One CodeMirror change as one tree-sitter edit.
 *
 * **ONLY FOR A SINGLE-CHANGE TRANSACTION**, which is what typing produces and what the caller checks
 * before calling this. A multi-change transaction's `fromA`/`toA` are all in the old document while its
 * `fromB`/`toB` are all in the new one, so applying them one at a time to a tree feeds tree-sitter
 * coordinates that were never simultaneously true — and an imprecise edit gives a WRONG tree, not
 * merely a slower parse. The caller drops the tree and reparses instead, which measured 8.1 ms at
 * 103,028 units.
 *
 * **`Edit` IS A CLASS, NOT AN INTERFACE, SO THIS CONSTRUCTS ONE.** It carries `editPoint` and
 * `editRange` methods, and an object literal with the six fields is therefore not assignable to it —
 * `tsc` rejects it with TS2739 naming exactly those two. The constructor is a field assignment
 * (`startIndex >>> 0` and so on) that touches no wasm, so building one costs nothing and needs no
 * initialised runtime.
 */
function editFor(
  before: { lineAt(pos: number): { number: number; from: number } },
  after: { lineAt(pos: number): { number: number; from: number } },
  fromA: number,
  toA: number,
  toB: number,
): Edit {
  const point = (doc: { lineAt(pos: number): { number: number; from: number } }, pos: number) => {
    const line = doc.lineAt(pos)
    return { row: line.number - 1, column: pos - line.from }
  }
  return new Edit({
    startIndex: fromA,
    oldEndIndex: toA,
    newEndIndex: toB,
    startPosition: point(before, fromA),
    oldEndPosition: point(before, toA),
    newEndPosition: point(after, toB),
  })
}

/** One decoration: a UTF-16 code-unit range and the CSS class to mark it with. */
export type ColourSpan = { readonly from: number; readonly to: number; readonly cls: string }

/**
 * The captures for the visible ranges, one span per range, in offset order.
 *
 * **THE QUERY'S RANGE BOUNDS ARE 2 × UTF-16 CODE UNITS AND THE CAPTURED NODE'S ARE NOT. DO NOT DELETE
 * THE `* 2`.** `web-tree-sitter` 0.27.0 passes `startIndex`/`endIndex` through to the wasm unchanged,
 * where they are offsets into a UTF-16 buffer measured in bytes; the `startIndex`/`endIndex` read back
 * off a captured node are divided by two on the way out. The API is asymmetric, one half of it agrees
 * with CodeMirror, and the halves look identical at the call site — which is how this shipped wrong:
 * the query got a window HALF the height of the viewport, so the lower half of every screen was bare,
 * and after a scroll the window landed on off-screen text and the marks missed the viewport entirely.
 *
 * MEASURED, on the λ grammar over the pure-ASCII 9-unit document `(ab) (cd)`:
 *
 * ```text
 * no range    : 6 captures at 0,1,3,5,6,8
 * endIndex= 9 : 3 captures at 0,1,3        <- the doc length in code units, covering half the doc
 * endIndex=18 : 6 captures at 0,1,3,5,6,8  <- 2x, covering all of it
 * ```
 *
 * **2 × CODE UNITS, NOT UTF-8 BYTES — measured, because the two coincide on ASCII and that is the
 * reading a 2× on an ASCII document invites.** `λab λcd` is 7 code units and 9 UTF-8 bytes, and its
 * second `λ` starts at unit 4, byte 5. `endIndex: 8` — past that byte — still returns only the first
 * capture; `endIndex: 14` (2 × 7) returns both. So the factor is the buffer's element size, not an
 * encoding conversion, and `spans.ts`'s `byteToIndex` is as wrong here as the module header says.
 *
 * **AN EMPTY RANGE IS SKIPPED RATHER THAN QUERIED, BECAUSE `endIndex: 0` MEANS UNLIMITED.** The library
 * reads a zero end as "no limit" (measured: `{startIndex: 0, endIndex: 0}` returns all 6 captures
 * above, and `{startIndex: 10, endIndex: 0}` returns the 3 past unit 5). A `from === to` visible range
 * doubled to `0` would therefore query the WHOLE document — the opposite of the bug above, and just as
 * quiet.
 *
 * **ONE SPAN PER RANGE, AND IT IS THE COLLAPSE THAT DOES THE WORK.** The `redextape` grammar captures
 * some nodes twice by design — `print(x);` yields `variable@0..5` AND `function.call@0..5`, both
 * projecting to `tok-ident` — and a node straddling two visible ranges comes back from both queries.
 * Left alone that is duplicate marks nesting inside one another with no override order, and the repeat
 * from the second range arrives after a larger `from`, which is what makes `RangeSetBuilder.add` throw
 * "Ranges must be added sorted by `from` position and `startSide`". The keying and the ordering are
 * exactly `redextape_grammar_check`'s `captures_with` — `(start, end)` into a map drained in offset
 * order — because part 3's browser differential compares this function's output against a golden
 * fixture emitted from that Rust function, and the comparison is only an equality if both sides
 * collapse the same way. Last capture wins per range, as its `BTreeMap::insert` does; the choice is
 * observable only when two captures on ONE range project to different classes, which that function
 * reports as an error rather than resolving, so matching it keeps the two from diverging silently if it
 * ever stops doing so.
 *
 * **THE SORT IS NOT WHAT FIXES THAT, AND DELETING IT REDDENS NOTHING TODAY — MEASURED, AND SAID HERE
 * RATHER THAN LEFT FOR SOMEONE TO REDISCOVER.** `Map` keeps a key's FIRST insertion position when a
 * later `set` overwrites it, so a duplicate from a second range lands where it already was; with
 * `visibleRanges` ascending and disjoint (CodeMirror sorts them) and captures ascending within one
 * query, insertion order is already offset order. The sort is here so the offset order this function
 * PROMISES — the half of the differential's equality that is not about collapsing — holds by
 * construction rather than resting on those two properties, neither of which anything in this tree
 * pins. `colourSpans` takes the ranges as an argument, so its own contract is the thing under test.
 */
export function colourSpans(
  query: TsQuery,
  root: TsNode,
  visibleRanges: readonly { readonly from: number; readonly to: number }[],
  byCapture: ReadonlyMap<string, string>,
): ColourSpan[] {
  const byRange = new Map<string, ColourSpan>()
  for (const { from, to } of visibleRanges) {
    if (from >= to) continue
    for (const c of query.captures(root, { startIndex: from * 2, endIndex: to * 2 })) {
      const cls = byCapture.get(c.name)
      const { startIndex, endIndex } = c.node
      // An empty range is not a decoration CodeMirror accepts, and a capture on a zero-width
      // node is what an error recovery produces.
      if (cls === undefined || startIndex >= endIndex) continue
      byRange.set(`${startIndex}:${endIndex}`, { from: startIndex, to: endIndex, cls })
    }
  }
  return [...byRange.values()].sort((a, b) => a.from - b.from || a.to - b.to)
}

/** What one editor's colourer needs: which language it holds, where grammars come from, and the map. */
export type ColourOptions = {
  languageId: LanguageId
  registry: GrammarRegistry
  classes: () => Map<string, Map<string, string>>
  /**
   * Say that this editor's document is past `COLOUR_CEILING_UNITS` — design §10's "no colour and no
   * diagnostics for that document, one notice saying which". Called at most once per plugin instance.
   *
   * **REQUIRED, AND IT WAS OPTIONAL UNTIL THE WHOLE-BRANCH REVIEW.** Declared, invoked as
   * `opts.onCeiling?.(…)` and passed by NO caller, which meant a document over the ceiling went
   * uncoloured in silence — the designed notice did not exist. Worse, the ceiling test still executed
   * that line, so v8 recorded it covered while an optional call on `undefined` did nothing. A required
   * field is what makes "declared but never wired" a compile error rather than a coverage figure.
   */
  onCeiling: (id: LanguageId) => void
}

/**
 * The plugin class `treeSitterColour` installs, built over `opts`.
 *
 * **A NAMED FACTORY RATHER THAN THE ANONYMOUS CLASS EXPRESSION THIS USED TO BE, AND A TEST IS THE WHOLE
 * REASON.** `#reparse`'s ceiling branch drops the tree rather than leaving it, so that a paste past the
 * ceiling followed by a delete back under it cannot edit a tree describing text that no longer exists.
 * That round trip is three transactions against one plugin INSTANCE, and `ViewPlugin.fromClass` hands
 * back no handle to one: `view.plugin(...)` needs a mounted `EditorView`, which needs a DOM, and the
 * failure it guards against is invisible in the DOM anyway — a wrong tree renders as wrong decorations,
 * not as an error. Exporting the class lets `tests/node/colour.test.ts` construct one over a real
 * parser and a stubbed view and drive the three transactions directly, in the tier that runs on every
 * push. Nothing in `src/` calls this; `treeSitterColour` below is the only consumer.
 */
export function colourPluginClass(opts: ColourOptions) {
  return class {
    decorations: DecorationSet = Decoration.none
    #grammar: LoadedGrammar | null = null
    #parser: Parser | null = null
    #tree: Tree | null = null
    #ceilingReported = false
    // NOT `#dead`, AND THE GATE IS WHY. `scripts/check-colours.sh` reads a private member named
    // only in hex letters as a hex colour — a false positive it documents and tells you to fix by
    // renaming rather than by weakening the pattern. `#dead` is four hex letters and fails it.
    #destroyed = false

    constructor(view: EditorView) {
      opts.registry
        .load(opts.languageId)
        .then((g) => {
          if (this.#destroyed || !g) return
          this.#grammar = g
          this.#parser = new Parser()
          this.#parser.setLanguage(g.language)
          // The load is async and nothing else will provoke a recompute, so ask for one. An empty
          // transaction is the cheapest way; `update` below rebuilds from it.
          view.dispatch({})
        })
        .catch(() => {
          // CAUGHT, NOT `void`ed: an unhandled rejection in a browser reaches
          // `window.onunhandledrejection` and prints as an uncaught error. `ScratchEditor`'s blur
          // handler and `LspClient`'s `initialize` carry the same note, for the same reason.
          //
          // A FETCH THAT FAILS DOES NOT REACH HERE: `createGrammarRegistry` catches it, reports it
          // through `onFailure` and RESOLVES with null. What can still reject is this continuation —
          // `new Parser()`, `setLanguage`, `view.dispatch` — or an `onFailure` that throws, which
          // rejects the registry's promise instead of resolving it. Nothing awaits this promise, so
          // there is no consumer to see any of them, and the outcome is the one design §10 already
          // specifies for a grammar that will not load: that language shows uncoloured, and the
          // other three are unaffected.
        })
    }

    update(u: ViewUpdate) {
      if (u.docChanged) this.#reparse(u)
      if (u.docChanged || u.viewportChanged || this.#tree === null) this.#rebuild(u.view)
    }

    destroy() {
      this.#destroyed = true
      this.#tree?.delete()
      this.#parser?.delete()
      this.#tree = null
      this.#parser = null
    }

    #reparse(u: ViewUpdate) {
      if (overCeiling(u.state.doc.length)) {
        // **DROPPED, NOT MERELY LEFT UNPARSED, AND THE ROUND TRIP IS WHY.** Returning with `#tree`
        // intact leaves a tree describing text that no longer exists, and nothing downstream can
        // tell: paste past the ceiling (this branch, tree kept), then delete back under it, and the
        // next single-change transaction finds a non-null `#tree` and calls `tree.edit()` with
        // coordinates from a document this tree has never held. That is the outcome `editFor`'s
        // header warns about — a WRONG tree, silently, not a slower parse — reached by a route it
        // does not cover: a precise edit against the wrong document rather than an imprecise one.
        this.#tree?.delete()
        this.#tree = null
        return
      }
      const parser = this.#parser
      if (!parser) return
      const changes: { fromA: number; toA: number; toB: number }[] = []
      u.changes.iterChanges((fromA, toA, _fromB, toB) => changes.push({ fromA, toA, toB }))
      const only = changes.length === 1 ? changes[0] : undefined
      const old = this.#tree
      if (only && old) {
        old.edit(editFor(u.startState.doc, u.state.doc, only.fromA, only.toA, only.toB))
        // **`parse` RETURNS A NEW `Tree` AND FREES NOTHING**, so the old one has to be deleted here
        // or a wasm tree leaks per keystroke — GC-bounded through `FinalizationRegistry` rather than
        // unbounded, which makes it invisible rather than harmless. Safe because subtrees are
        // refcounted: the new tree holds its own references to everything it reused. Deleted on the
        // null return too — `parse` answering null must not turn a leak into a dropped handle, and
        // leaving `#tree` null makes the next `#rebuild` parse from scratch.
        const next = parser.parse(u.state.doc.toString(), old)
        old.delete()
        this.#tree = next
        return
      }
      old?.delete()
      this.#tree = parser.parse(u.state.doc.toString())
    }

    #rebuild(view: EditorView) {
      const g = this.#grammar
      const parser = this.#parser
      if (!g || !parser) return
      if (overCeiling(view.state.doc.length)) {
        if (!this.#ceilingReported) {
          this.#ceilingReported = true
          opts.onCeiling(opts.languageId)
        }
        this.decorations = Decoration.none
        return
      }
      this.#tree ??= parser.parse(view.state.doc.toString())
      const tree = this.#tree
      if (!tree) return
      const byCapture = opts.classes().get(opts.languageId)
      if (!byCapture) return
      const b = new RangeSetBuilder<Decoration>()
      for (const s of colourSpans(g.query, tree.rootNode, view.visibleRanges, byCapture)) {
        b.add(s.from, s.to, Decoration.mark({ class: s.cls }))
      }
      this.decorations = b.finish()
    }
  }
}

/** The colourer for one editor, whose language never changes. */
export function treeSitterColour(opts: ColourOptions): Extension {
  return ViewPlugin.fromClass(colourPluginClass(opts), { decorations: (v) => v.decorations })
}
