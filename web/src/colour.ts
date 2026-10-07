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
 * 0.4 ms, so reparsing on every scroll would cost twenty times what it buys. **BOTH GROW WITH THE
 * DOCUMENT**: at 1,518,470 units a parse of the whole text measured 154 to 179 ms and a reparse after
 * one character 3.0 to 4.3 ms (2026-10-06). `PARSE_SLICE_MS` has what an editor's first parse does
 * about that.
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
 * THE LARGER OF THE SESSION'S TWO COPY CEILINGS, NOT A NUMBER OF THIS MODULE'S OWN: a TM copy's,
 * `MAX_SCRATCH_TM_BYTES` at 6,100,000, where an asm copy's, `MAX_SCRATCH_ASM_BYTES`, is 5,200,000. A
 * document no copy will hold is not one worth parsing on the main thread: a parse of a whole text of
 * 6,072,644 units measured 614 to 673 ms, in slices 676 and 688 ms, and a reparse after one character
 * typed 13.4 to 15.1 ms, in one go inside the keystroke's update (2026-10-06).
 *
 * **ONE CEILING FOR EVERY EDITOR, SO AN ASM DOCUMENT BETWEEN THE TWO IS STILL COLOURED**, though no asm copy
 * builds it: refusing a document is the session's to say, and this gate only refuses the absurd. A ceiling
 * per language would be a second place for each copy's number to be kept.
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
 * through `onFailure` that read as four coincidental per-language failures and produced four notices,
 * one per language, for one event — against design §10's one notice per failure.
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

/**
 * How long one slice of an editor's first parse may run before it stops for a timer, in milliseconds.
 *
 * **AN EDITOR'S FIRST PARSE RUNS IN SLICES OF THIS LENGTH, AND IT RAN IN ONE TASK UNTIL THE COPY OF A 7,353-STATE
 * MACHINE HELD THE PAGE FOR IT.** That machine's text is 1,518,470 units: 7,353 states and 18,499 rules, a line each.
 * Measured in Chromium on 2026-10-06, the machine copied while its program's run and then the copy's both record,
 * five runs on each side taken in turn: in one go the parse took 194 to 208 ms, and from the editor's mount the page
 * ran no timer for 232 to 249 ms and drew no frame for 216 to 232 ms; in slices no gap between two timers or two
 * frames reached 100 ms, the parser's calls took 179 to 188 ms in all and the longest 8.1 to 9.0 ms, and the tree
 * landed 720 to 860 ms after the click.
 *
 * **THE BOUND IS ON ONE CALL TO THE PARSER, IN ONE EDITOR.** The update that carries a first slice measured 8.3 to
 * 12.0 ms in five editors, the slice and the rest of the update, and 22.6 ms in the first editor a page mounted;
 * editors that mount together each queue a slice of their own; and a slice cannot stop inside a token, so one
 * comment line of 3,000,000 units parsed in 57.2 ms without a callback.
 *
 * **THE PARSER STOPS ITSELF AND IS ASKED AGAIN.** `web-tree-sitter` calls a parse's `progressCallback` as it goes,
 * 16,095 times over that machine's text, and a parse whose callback answers `true` returns `null` with its state
 * kept: the next `parse` on that parser with the same text carries on from there, and `reset()` drops the state.
 * **THE SAME TREE AS A PARSE IN ONE GO FOR A TEXT WITHOUT ERRORS, AND NOT ALWAYS FOR ONE WITH MANY.** That machine's
 * two trees were compared node for node, 787,756 nodes, and were the same. On text with a mistake every 61 to 1,499
 * units a resumed parse recovered differently from a parse in one go, in each of the four grammars, and differently
 * again with where its slices ended; with one mistake in a text of 0.55 to 1.5 million units, 0 of 8 sliced parses
 * differed, in each of six cases.
 */
export const PARSE_SLICE_MS = 8

/**
 * How far into a document the first screen's own parse reaches, in UTF-16 code units.
 *
 * **WHILE A SLICED PARSE IS PENDING, THE SCREEN IS COLOURED FROM A PARSE OF THE DOCUMENT'S START, UP TO THE END OF THE
 * LAST VISIBLE LINE, WHEN THAT IS AT MOST THIS FAR IN.** A copy's editor mounts showing its first lines, and without
 * this they stood plain until the whole parse landed, 757 to 969 ms after the click in three runs. With it they are
 * coloured 190 to 255 ms after the click, where the parse in one go coloured them at 377 to 431 ms, in five runs of
 * each taken in turn (2026-10-06). The first 6,048 units of the 1,518,470-unit machine, 130 lines, parsed in 0.70 ms,
 * and gave the captures the whole tree gives over those units.
 *
 * **A BOUND, BECAUSE THIS PARSE RUNS IN ONE GO INSIDE AN UPDATE.** A screen further down than this shows plain text
 * until the whole parse lands. Of that machine, the first 20,064 units parsed in 2.20 ms and the first 64,040 in
 * 6.80 ms. Text the grammars make more work of costs more: 31,995 units of one mnemonic repeated took 14.5 ms as asm,
 * and of one bracket repeated 9.6 ms as TM and 9.8 ms as λ.
 *
 * **EXACT WHERE A LINE END IS A PLACE THE GRAMMAR CAN STOP.** That is the TM text form, measured, and every item of an
 * asm text is a line too. A program cut at a line end may be cut inside a bracket, and the parser then recovers as it
 * can; in 6 of 6 programs and λ terms cut so, the marks were the whole tree's. **A λ COPY'S TEXT IS ONE LINE**, so
 * its last visible line ends where it does: one longer than this bound has no first screen and is plain until its
 * whole parse lands.
 */
export const FIRST_SCREEN_UNITS = 32_000

/** The marks for `ranges`, as the decorations one editor draws. */
function marksOf(
  query: TsQuery,
  root: TsNode,
  ranges: readonly { readonly from: number; readonly to: number }[],
  byCapture: ReadonlyMap<string, string>,
): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  for (const s of colourSpans(query, root, ranges, byCapture)) {
    b.add(s.from, s.to, Decoration.mark({ class: s.cls }))
  }
  return b.finish()
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
 *
 * **`now` IS THE CLOCK A SLICE IS TIMED BY, AND NOTHING IN `src/` PASSES IT.** A test passes a counter, so that a slice
 * is a fixed number of the parser's progress callbacks and a document takes more than one slice by its size alone.
 *
 * **WHICH PARSES RUN IN SLICES: THE ONES WITH NO TREE BEFORE THEM, AND SO NOTHING ON SCREEN TO LOSE.** An editor's
 * first, the first after a document comes back under the ceiling, and the parse of whatever text a change leaves
 * while one of those is still pending: that change abandons the pending parse, the parser is reset, and the new text
 * is parsed from its start. The first slice runs inside the update that asked for it, so a document that parses
 * within `PARSE_SLICE_MS` is coloured in that update, as every document was; the rest run one to a timer, and the
 * plugin asks the view for one recompute when the tree lands. Until then the screen is coloured as
 * `FIRST_SCREEN_UNITS` says. **SO TEXT PAST THE FIRST SCREEN STAYS PLAIN FOR AS LONG AS KEYS ARRIVE FASTER THAN ONE
 * PARSE TAKES**: with a key every 100 ms into 1,534,779 units whose parse was pending, the end of the text was
 * coloured after 0 of 30 keys, and about 200 ms after the last.
 *
 * **A DOCUMENT THAT HAS A TREE IS REPARSED IN THE UPDATE THAT CHANGED IT, IN ONE GO, AS IT WAS.** A single change
 * edits the tree and reparses against it: after one character typed that measured 3.0 to 4.3 ms at 1,518,470 units
 * and 13.4 to 15.1 ms at 6,072,644 (2026-10-06). A change that replaces most of a large document costs about what a
 * parse of that much text does, and so does a transaction of several changes, which cannot edit the tree (`editFor`)
 * and parses the whole text. **THIS BRANCH PUT THOSE TWO IN SLICES AT FIRST, AND ITS REVIEW MEASURED WHY NOT TO**:
 * the tree is gone while the slices run, and a screen past the first went plain, for 14 of 15 frames at 1,534,779
 * units on an idle page, where the parse in one go held the update for 164.4 ms with the screen coloured throughout.
 * A replacement by the same text, which is what a *format* that changes nothing dispatches, is not reparsed at all.
 */
export function colourPluginClass(opts: ColourOptions, now: () => number = () => performance.now()) {
  return class {
    decorations: DecorationSet = Decoration.none
    #view: EditorView
    #grammar: LoadedGrammar | null = null
    #parser: Parser | null = null
    #tree: Tree | null = null
    /** The text a sliced parse is part of the way through, or `null` when none is. While it is set, `#tree` is `null`. */
    #pending: string | null = null
    /** The timer the pending parse's next slice waits on. */
    #timer: ReturnType<typeof setTimeout> | null = null
    /** Set when a tree lands from a timer, so that the update it then asks for rebuilds though nothing else changed. */
    #landed = false
    /** The parser for the first screen's own parse, made when one is first wanted: `#parser` is part-way through another. */
    #front: Parser | null = null
    #ceilingReported = false
    // NOT `#dead`, AND THE GATE IS WHY. `scripts/check-colours.sh` reads a private member named
    // only in hex letters as a hex colour — a false positive it documents and tells you to fix by
    // renaming rather than by weakening the pattern. `#dead` is four hex letters and fails it.
    #destroyed = false

    constructor(view: EditorView) {
      this.#view = view
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
      // WITH NO TREE AND NO PARSE PENDING, every update asks again: that is an editor whose grammar has only now
      // arrived. WITH A PARSE PENDING, only a change to the text or the screen does: the first screen's marks are a
      // parse of their own, and an update that moved neither would parse those lines again for the same marks.
      const waiting = this.#tree === null && this.#pending === null
      if (u.docChanged || u.viewportChanged || waiting || this.#landed) this.#rebuild(u.view)
    }

    destroy() {
      this.#destroyed = true
      this.#abandon()
      this.#tree?.delete()
      this.#parser?.delete()
      this.#front?.delete()
      this.#tree = null
      this.#parser = null
      this.#front = null
    }

    /**
     * Give up a pending parse: its text is gone, or the editor is.
     *
     * **THE PARSER IS RESET, AND WITHOUT THAT THE NEXT PARSE WOULD CARRY ON WITH THIS ONE.** A parser whose callback
     * stopped it keeps its place, and its next `parse` resumes from there whatever text it is handed: the tree would
     * be the abandoned text's as far as that parse had got, and the new text's after.
     */
    #abandon() {
      if (this.#pending === null) return
      this.#parser?.reset()
      this.#pending = null
      if (this.#timer !== null) clearTimeout(this.#timer)
      this.#timer = null
    }

    /**
     * One slice of the pending parse. Whether it finished the parse, in which case the tree is in `#tree`.
     *
     * **A SLICE ALWAYS GETS SOMEWHERE**: the parser consults the callback only every so many of its own steps, so a
     * slice whose clock has already run out still parses up to the next one.
     */
    #slice(parser: Parser, text: string): boolean {
      const started = now()
      const tree = parser.parse(text, null, { progressCallback: () => now() - started > PARSE_SLICE_MS })
      if (tree === null) return false
      this.#tree = tree
      this.#pending = null
      return true
    }

    /**
     * The pending parse's next slice, from a timer.
     *
     * **A TIMER, SO THAT A SLICE TAKES ITS TURN WITH EVERYTHING ELSE THE PAGE HAS QUEUED.** The alternative measured
     * was a task that runs ahead of other work: it landed the tree as soon as a parse in one go does, and through
     * the parse no timer ran for 221 to 250 ms and no worker's reply was taken in for 206 to 232 ms, in three runs.
     *
     * **NEVER FOR AN EDITOR THAT IS GONE OR A TEXT THAT IS**: `#abandon` clears the timer, and `destroy` and
     * `#reparse` both abandon.
     *
     * **A SLICE THAT THROWS HERE IS NOT TRIED AGAIN.** The timer is cleared before the slice runs and set again only
     * when one returns, so the error is reported once, as any error thrown from a timer is, and the editor keeps its
     * first screen's marks. The next change to the document abandons that parse and starts one on the new text.
     */
    #resume = (): void => {
      this.#timer = null
      const parser = this.#parser
      const text = this.#pending
      if (!parser || text === null) return
      if (!this.#slice(parser, text)) {
        this.#timer = setTimeout(this.#resume, 0)
        return
      }
      // The tree landed outside any update, and nothing else will provoke a recompute: ask for one, as the
      // grammar's arrival does.
      this.#landed = true
      this.#view.dispatch({})
    }

    #reparse(u: ViewUpdate) {
      // **A REPLACEMENT BY THE SAME TEXT LEAVES EVERYTHING AS IT IS**: the tree, or the parse that is pending, is
      // this text's already. *Format* is one edit over the whole buffer, dispatched whether or not it changed a
      // character (`lsp-text.ts`'s `applyEdits`), and reparsed the whole text at every one.
      if (u.startState.doc.eq(u.state.doc)) return
      // WHATEVER FOLLOWS, the text a pending parse was reading is no longer the document.
      this.#abandon()
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
      const old = this.#tree
      // NO TREE TO REPARSE AGAINST, AND SO NOTHING ON SCREEN FROM ONE: `#rebuild` parses the new text, in slices.
      if (!parser || !old) return
      const changes: { fromA: number; toA: number; toB: number }[] = []
      u.changes.iterChanges((fromA, toA, _fromB, toB) => changes.push({ fromA, toA, toB }))
      const only = changes.length === 1 ? changes[0] : undefined
      if (only) {
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
      // **SEVERAL CHANGES AGAINST A TREE ARE A WHOLE PARSE, IN ONE GO, AS THEY WERE.** In slices the tree would be
      // gone while they ran, and with it the colour of every screen past the first: `colourPluginClass`'s doc has
      // the measurement that put this back.
      old.delete()
      this.#tree = parser.parse(u.state.doc.toString())
    }

    #rebuild(view: EditorView) {
      this.#landed = false
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
      if (this.#tree === null && this.#pending === null) {
        const text = view.state.doc.toString()
        this.#pending = text
        if (!this.#slice(parser, text)) this.#timer = setTimeout(this.#resume, 0)
      }
      const byCapture = opts.classes().get(opts.languageId)
      if (!byCapture) return
      const tree = this.#tree
      this.decorations = tree
        ? marksOf(g.query, tree.rootNode, view.visibleRanges, byCapture)
        : this.#firstScreen(g, view, byCapture)
    }

    /** What to draw while the whole parse is pending: `FIRST_SCREEN_UNITS` has the rule and its reasons. */
    #firstScreen(g: LoadedGrammar, view: EditorView, byCapture: ReadonlyMap<string, string>): DecorationSet {
      const last = view.visibleRanges[view.visibleRanges.length - 1]
      if (last === undefined) return Decoration.none
      const cut = view.state.doc.lineAt(last.to).to
      if (cut > FIRST_SCREEN_UNITS) return Decoration.none
      if (this.#front === null) {
        this.#front = new Parser()
        this.#front.setLanguage(g.language)
      }
      const tree = this.#front.parse(view.state.doc.sliceString(0, cut))
      if (!tree) return Decoration.none
      try {
        return marksOf(g.query, tree.rootNode, view.visibleRanges, byCapture)
      } finally {
        tree.delete()
      }
    }
  }
}

/** The colourer for one editor, whose language never changes. */
export function treeSitterColour(opts: ColourOptions): Extension {
  return ViewPlugin.fromClass(colourPluginClass(opts), { decorations: (v) => v.decorations })
}
