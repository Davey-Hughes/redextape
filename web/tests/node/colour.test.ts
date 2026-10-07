import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EditorState, RangeSetBuilder } from '@codemirror/state'
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view'
import { Decoration } from '@codemirror/view'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Language, Parser, Query } from 'web-tree-sitter'
import {
  COLOUR_CEILING_UNITS,
  type ColourSpan,
  classMapFrom,
  colourPluginClass,
  colourSpans,
  createGrammarRegistry,
  FIRST_SCREEN_UNITS,
  overCeiling,
  PARSE_SLICE_MS,
} from '../../src/colour'
import { LANGUAGE_IDS, type LanguageId } from '../../src/lsp-protocol'
import type { TokenClass } from '../../src/types'

describe('classMapFrom', () => {
  it('keeps the four tables apart, because three captures mean different things per language', () => {
    const map = classMapFrom([
      ['redextape', [['function', 'Ident']]],
      ['redextape_asm', [['function', 'Mnemonic']]],
    ])
    expect(map.get('redextape')?.get('function')).toBe('tok-ident')
    expect(map.get('redextape_asm')?.get('function')).toBe('tok-mnemonic')
  })

  it('answers undefined for a capture no table maps, rather than a default class', () => {
    // A default would paint a capture nobody mapped, turning an omission into a quiet miscolouring.
    const map = classMapFrom([['redextape', [['keyword', 'Keyword']]]])
    expect(map.get('redextape')?.get('no.such.capture')).toBeUndefined()
    expect(map.get('no_such_language')).toBeUndefined()
  })
})

describe('overCeiling', () => {
  it('is false at the ceiling and true one unit past it', () => {
    // The boundary in both directions: `>=` here would refuse a document that exactly fits.
    expect(overCeiling(COLOUR_CEILING_UNITS)).toBe(false)
    expect(overCeiling(COLOUR_CEILING_UNITS + 1)).toBe(true)
  })

  it('has the larger copy ceiling, a TM copy’s, not a number of its own', () => {
    expect(COLOUR_CEILING_UNITS).toBe(6_100_000)
  })
})

describe('the bounds on a parse in one go', () => {
  it('are a slice of 8 ms and a first screen of 32,000 units', () => {
    // THE VALUES, because every case below reads the names: 80 for 8 passed all of them.
    expect(PARSE_SLICE_MS).toBe(8)
    expect(FIRST_SCREEN_UNITS).toBe(32_000)
  })
})

/**
 * `colourSpans` over the REAL committed grammars, in Node.
 *
 * **THE HALVED VIEWPORT WINDOW SHIPPED BECAUSE NOTHING HERE PARSED ANYTHING.** Every test in this file
 * was over a pure function on a hand-built table; the one thing the module actually does — put a
 * CodeMirror viewport to a tree-sitter query and read offsets back — had no test at either tier, and a
 * query window half the height of the viewport passed every gate. These load the same `.wasm` and the
 * same `highlights.scm` the app ships, because the defect was in the units crossing that boundary and a
 * stub query would have been written with whichever units the stub's author believed in.
 *
 * NODE, NOT THE BROWSER TIER. `Language.load` takes a filesystem path under Node (it branches on
 * `process.versions.node` and reads the file) and the runtime `.wasm` is located the same way, so this
 * needs no page — and a test that runs in the fast tier is one that runs on every push.
 */
const repoFile = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

type Grammar = { readonly language: Language; readonly query: Query; readonly parser: Parser }

/** A CodeMirror visible range: the shape `EditorView.visibleRanges` hands `colourSpans`. */
type Visible = { readonly from: number; readonly to: number }

const load = async (name: string): Promise<Grammar> => {
  const language = await Language.load(repoFile(`../../../grammars/${name}/${name}.wasm`))
  const query = new Query(language, readFileSync(repoFile(`../../../grammars/${name}/queries/highlights.scm`), 'utf8'))
  const parser = new Parser()
  parser.setLanguage(language)
  return { language, query, parser }
}

/** The rows for one language, as `classMapFrom` builds them. Mirrors `redextape-core`'s `capture_map`. */
const classesFor = (rows: readonly (readonly [string, TokenClass])[]): Map<string, string> => {
  const map = classMapFrom([['one', rows]]).get('one')
  if (!map) throw new Error('classMapFrom dropped the only table it was given')
  return map
}

/** Named for the reason `REDEXTAPE_ROWS` below is: the registry suite needs the rows, not just the map. */
const LAMBDA_ROWS: readonly (readonly [string, TokenClass])[] = [
  ['keyword.function', 'Binder'],
  ['variable.parameter', 'Binder'],
  ['variable', 'Ident'],
  ['punctuation.delimiter', 'Punct'],
  ['punctuation.bracket', 'Punct'],
]

const LAMBDA_CLASSES = classesFor(LAMBDA_ROWS)

/** Named rather than inlined, because the ceiling suite below needs the rows and not just the map. */
const REDEXTAPE_ROWS: readonly (readonly [string, TokenClass])[] = [
  ['keyword', 'Keyword'],
  ['operator', 'Operator'],
  ['number', 'Nat'],
  ['punctuation.bracket', 'Punct'],
  ['punctuation.delimiter', 'Punct'],
  ['function', 'Ident'],
  ['function.call', 'Ident'],
  ['variable', 'Ident'],
  ['variable.parameter', 'Ident'],
]

const REDEXTAPE_CLASSES = classesFor(REDEXTAPE_ROWS)

/** A `DecorationSet` as the `ColourSpan[]` that produced it, so it compares against `colourSpans`. */
const marks = (set: DecorationSet): ColourSpan[] => {
  const out: ColourSpan[] = []
  for (const iter = set.iter(); iter.value !== null; iter.next()) {
    out.push({ from: iter.from, to: iter.to, cls: (iter.value.spec as { class: string }).class })
  }
  return out
}

describe('colourSpans', () => {
  let lambda: Grammar
  let redextape: Grammar

  beforeAll(async () => {
    await Parser.init({ locateFile: () => repoFile('../../node_modules/web-tree-sitter/web-tree-sitter.wasm') })
    lambda = await load('tree-sitter-redextape-lambda')
    redextape = await load('tree-sitter-redextape')
  })

  /** The spans for one document, with the whole of it visible unless `ranges` says otherwise. */
  const spans = (g: Grammar, src: string, classes: Map<string, string>, ranges?: readonly Visible[]): ColourSpan[] => {
    const tree = g.parser.parse(src)
    if (!tree) throw new Error(`the parser returned no tree for ${JSON.stringify(src)}`)
    try {
      return colourSpans(g.query, tree.rootNode, ranges ?? [{ from: 0, to: src.length }], classes)
    } finally {
      tree.delete()
    }
  }

  const starts = (ss: readonly ColourSpan[]): number[] => ss.map((s) => s.from)

  it('colours the WHOLE viewport, not the first half of it', () => {
    // THE REGRESSION TEST FOR THE HALVED WINDOW. A query's `startIndex`/`endIndex` are 2 × UTF-16 code
    // units; a captured node's are plain code units. Passing the CodeMirror positions through undoubled
    // asked for the first half of the viewport, and this document is the one the fix's comment quotes:
    // 9 ASCII units, 6 captures, of which an undoubled `endIndex: 9` returns the first 3.
    expect(starts(spans(lambda, '(ab) (cd)', LAMBDA_CLASSES))).toEqual([0, 1, 3, 5, 6, 8])
  })

  it("keeps a scrolled viewport's marks inside that viewport", () => {
    // The same defect seen from the other end, and the one a user reports: with the window halved, a
    // viewport starting at unit 7 queries units 3.5 to 7.5, so the marks come back for text that is off
    // screen and the visible text is bare. 15 units, and the second half holds captures 8..15.
    //
    // THIS IS THE ASSERTION THAT WOULD ALSO CATCH THE LIBRARY CHANGING ITS MIND. An over-wide window is
    // harmless — the test above would stay green if `startIndex`/`endIndex` became plain code units in
    // some later `web-tree-sitter` — but this one queries from 14 on a 15-unit document and would
    // return nothing at all.
    const found = spans(lambda, '(λx. x) (λy. y)', LAMBDA_CLASSES, [{ from: 7, to: 15 }])
    expect(starts(found)).toEqual([8, 9, 10, 11, 13, 14])
    // Non-ASCII on purpose: 15 code units, 17 UTF-8 bytes. A `byteToIndex`-style conversion here — the
    // mistake the module header warns about — would ask for units 4 to 8.5 and return captures at 5
    // and 6, outside the viewport, so this also holds the factor to the buffer's element size.
    for (const s of found) expect(s.from, JSON.stringify(s)).toBeGreaterThanOrEqual(7)
  })

  it('asks for nothing when a visible range is empty, because `endIndex: 0` means unlimited', () => {
    // Doubling turns an empty range into `{startIndex: 0, endIndex: 0}`, which the library reads as "no
    // limit" and answers with the WHOLE document — every capture, none of them visible.
    expect(spans(lambda, '(ab) (cd)', LAMBDA_CLASSES, [{ from: 0, to: 0 }])).toEqual([])
  })

  it('collapses two captures on one node to one decoration', () => {
    // `print(x);` is captured as both `variable@0..5` and `function.call@0..5` by design, and both
    // project to `tok-ident`. Two marks on one range nest rather than conflict, so nothing looks wrong
    // — but `redextape_grammar_check`'s `captures_with` returns ONE entry per byte range, and part 3's
    // differential compares this function's output against a fixture emitted from it.
    const found = spans(redextape, 'print(x);', REDEXTAPE_CLASSES)
    expect(found).toEqual([
      { from: 0, to: 5, cls: 'tok-ident' },
      { from: 5, to: 6, cls: 'tok-punct' },
      { from: 6, to: 7, cls: 'tok-ident' },
      { from: 7, to: 8, cls: 'tok-punct' },
      { from: 8, to: 9, cls: 'tok-punct' },
    ])
  })

  it('returns one ascending run across overlapping visible ranges, which RangeSetBuilder requires', () => {
    // A node intersecting two visible ranges is returned by both queries, so the raw concatenation goes
    // 0,1,3 then 1,3,5,6,8 — and `RangeSetBuilder.add` throws "Ranges must be added sorted by `from`
    // position and `startSide`" the moment `from` goes backwards. More than one range is the case
    // CodeMirror's own doc names: "when there are, for example, large collapsed ranges in the
    // viewport", `visibleRanges` is the subset of it that is actually drawn.
    const ranges = [
      { from: 0, to: 4 },
      { from: 2, to: 9 },
    ]
    const found = spans(lambda, '(ab) (cd)', LAMBDA_CLASSES, ranges)
    expect(starts(found)).toEqual([0, 1, 3, 5, 6, 8])
    const builder = new RangeSetBuilder<Decoration>()
    expect(() => {
      for (const s of found) builder.add(s.from, s.to, Decoration.mark({ class: s.cls }))
    }).not.toThrow()
    // OFFSET ORDER REGARDLESS OF ARRIVAL ORDER, which is the sort's own contract and the only way to
    // reach it: the collapse alone already yields ascending output for ascending ranges (a `Map` keeps a
    // key's first position when a later `set` overwrites it), so with sorted `visibleRanges` deleting
    // the sort reddens nothing. The differential in part 3 needs the order, not just the collapse.
    expect(starts(spans(lambda, '(ab) (cd)', LAMBDA_CLASSES, [...ranges].reverse()))).toEqual([0, 1, 3, 5, 6, 8])
  })
})

/**
 * **THE CEILING'S ROUND TRIP, WHICH WAS ARGUED IN A COMMENT AND NOT TESTED.**
 *
 * `#reparse` DROPS the tree when a document crosses `COLOUR_CEILING_UNITS` rather than merely leaving
 * it unparsed, and the whole reason is a sequence no single transaction can show: paste past the
 * ceiling (the tree is kept, describing the text from before the paste), then delete back under it, and
 * the next single-change transaction finds a non-null tree and calls `tree.edit()` with coordinates
 * from a document that tree has never held. tree-sitter then REUSES the subtrees the edit did not
 * touch — for text that is now something else entirely — and the result is a wrong tree, silently, not
 * a slower parse.
 *
 * **THE PLUGIN HAD NO HANDLE TO DRIVE, AND THAT IS WHAT TOOK THE WORK.** It was an anonymous class
 * expression inside `treeSitterColour`; `ViewPlugin.fromClass` hands back an `Extension`, and reaching
 * the instance through `view.plugin(...)` needs a mounted `EditorView` and therefore a DOM — in a tier
 * where the failure is invisible anyway, since a wrong tree renders as wrong decorations rather than as
 * an error. `colour.ts` now exports `colourPluginClass`, the factory that builds that class, so the
 * three transactions can be driven directly here. Nothing in `src/` calls it.
 *
 * **EVERYTHING ELSE IS REAL: a real grammar, a real `Parser`, real `EditorState`s and a real
 * `ChangeSet`.** Only the `EditorView` is a stub, and only for the three members the plugin touches —
 * `state`, `visibleRanges` and a `dispatch` the constructor calls to provoke a recompute
 * (`tests/node/replies.test.ts` casts the same shape for the same reason). A hand-built `ViewUpdate`
 * over a hand-built change set would be the one place the bug could hide, which is why the transitions
 * are produced by `EditorState.update`.
 */
describe('the colourer across the ceiling', () => {
  let redextape: Grammar

  /** What `main.ts` hands the plugin: the whole map, keyed by language, not one language's rows. */
  const REDEXTAPE_BY_LANGUAGE = classMapFrom([['redextape', REDEXTAPE_ROWS]])

  beforeAll(async () => {
    await Parser.init({ locateFile: () => repoFile('../../node_modules/web-tree-sitter/web-tree-sitter.wasm') })
    redextape = await load('tree-sitter-redextape')
  })

  it('drops the tree on the way over, so a document that comes back under is parsed afresh', async () => {
    // `let aaaaa = 1;` and `zzzzzzzzzzzzzz` are the SAME LENGTH and share no token structure, which is
    // what makes the stale-reuse visible. The over-ceiling document REPLACES the first one, so the tree
    // the buggy path keeps describes text that is not a prefix of anything that follows; the delete then
    // lands exactly at unit 14, the old tree's own end, so tree-sitter treats every node in it as
    // unchanged and hands back `let`-as-a-keyword over a document of `z`s.
    const under = 'let aaaaa = 1;'
    const over = 'z'.repeat(COLOUR_CEILING_UNITS + 1)
    const back = over.slice(0, under.length)
    expect(overCeiling(over.length)).toBe(true)
    expect(overCeiling(back.length)).toBe(false)

    // **A REAL SINK, NOT AN OMITTED OPTIONAL ONE, AND THE OMISSION IS WHAT THE WHOLE-BRANCH REVIEW
    // FOUND.** `onCeiling` used to be optional and `#rebuild` called it as `opts.onCeiling?.(…)`; this
    // test passed nothing, so v8 marked that line covered while an optional call on `undefined` did
    // nothing at all — a designed notice with no call site anywhere in the tree. The field is required
    // now, and what it was called with is asserted below rather than merely accepted.
    const ceilings: LanguageId[] = []
    const view = { state: EditorState.create({ doc: '' }), visibleRanges: [{ from: 0, to: 0 }], dispatch: () => {} }
    const plugin = new (colourPluginClass({
      languageId: 'redextape',
      registry: { load: async () => ({ language: redextape.language, query: redextape.query }) },
      classes: () => REDEXTAPE_BY_LANGUAGE,
      onCeiling: (id) => ceilings.push(id),
    }))(view as unknown as EditorView)
    // The grammar arrives on a promise the constructor does not await; one macrotask is enough for its
    // continuation to have set the parser, and without it every transaction below would return early.
    await new Promise((r) => setTimeout(r, 0))

    /** Drive one single-change transaction through the plugin, as one gesture in an editor does. */
    const apply = (changes: { from: number; to: number; insert: string }): void => {
      const startState = view.state
      const tr = startState.update({ changes })
      view.state = tr.state
      view.visibleRanges = [{ from: 0, to: tr.state.doc.length }]
      plugin.update({
        view,
        state: tr.state,
        startState,
        changes: tr.changes,
        docChanged: true,
        viewportChanged: true,
      } as unknown as ViewUpdate)
    }
    const replaceAll = (text: string): void => apply({ from: 0, to: view.state.doc.length, insert: text })
    const truncateTo = (n: number): void => apply({ from: n, to: view.state.doc.length, insert: '' })

    replaceAll(under)
    const tree = redextape.parser.parse(under)
    if (!tree) throw new Error('the parser returned no tree')
    const wanted = colourSpans(redextape.query, tree.rootNode, [{ from: 0, to: under.length }], REDEXTAPE_CLASSES)
    tree.delete()
    // The baseline: the plugin agrees with a fresh parse before anything crosses the ceiling. Without
    // this the two assertions below could both be describing an editor that never coloured at all.
    expect(marks(plugin.decorations)).toEqual(wanted)
    expect(wanted.some((s) => s.cls === 'tok-keyword')).toBe(true)
    // NOTHING SAID YET, and this half is what makes the next assertion mean something: without it a
    // hook that fired on every update would pass the count below just as well.
    expect(ceilings).toEqual([])

    // SELECT ALL AND PASTE, not an append, and the difference is the whole test. An append would leave
    // the old tree still describing its own prefix truthfully, so a stale tree would be indistinguishable
    // from a fresh one; replacing the document is what makes the kept tree describe text that is gone.
    replaceAll(over)
    // Over the ceiling the editor goes uncoloured — the other half of the branch, and the reason the
    // tree is not simply left in place: there is nothing on screen that needs it.
    expect(marks(plugin.decorations)).toEqual([])
    // AND THE EDITOR SAYS SO — design §10's "one notice saying which", named by the language the
    // plugin holds. `main.ts` turns this into the sentence `tests/browser/colour-ceiling.test.ts`
    // reads off the notice line.
    expect(ceilings).toEqual(['redextape'])

    // DELETE THE TAIL, not the whole document, and this is the other half of what makes the bug
    // reachable. `tree.edit` over a replacement of everything marks every node changed, so even a kept
    // tree is fully reparsed and the defect hides; deleting from unit 14 to the end marks nothing before
    // 14 changed, and the old tree ENDS at 14 — so tree-sitter reuses all of it. Measured directly
    // against `web-tree-sitter` 0.27.0: the stale parse yields
    // `(source_file (let_statement name: (identifier) value: (number) (MISSING ";")) (identifier))`
    // over a document of `z`s, where a fresh parse yields `(source_file (identifier))`.
    truncateTo(back.length)
    // THE ASSERTION THE COMMENT WAS STANDING IN FOR. A tree carried across the ceiling would still
    // describe `let aaaaa = 1;` here and colour `zzz` as a keyword; a fresh parse of a document of `z`s
    // has no keyword in it at all.
    const fresh = redextape.parser.parse(back)
    if (!fresh) throw new Error('the parser returned no tree')
    const expected = colourSpans(redextape.query, fresh.rootNode, [{ from: 0, to: back.length }], REDEXTAPE_CLASSES)
    fresh.delete()
    expect(marks(plugin.decorations)).toEqual(expected)
    expect(marks(plugin.decorations).some((s) => s.cls === 'tok-keyword')).toBe(false)
    // STILL ONE. Coming back under the ceiling says nothing new — `#ceilingReported` is per instance,
    // not per crossing, and a notice line that repeated itself on every update over a large document
    // would be the per-keystroke chatter `notice.ts` is built to refuse.
    expect(ceilings).toEqual(['redextape'])
  })
})

/**
 * **A FIRST PARSE THAT OUTLASTS ONE SLICE, WHICH RAN IN ONE TASK UNTIL THE COPY OF A 7,353-STATE MACHINE HELD THE PAGE.**
 *
 * The colourer parsed a document's whole text inside the update that first needed a tree, and a copy editor mounting on
 * 1,518,470 units of machine text stopped the page for the length of that parse. These drive the plugin as the suite
 * above does, over the real TM grammar and a real `Parser`, and hold what it does when an editor's first parse does
 * not fit in `PARSE_SLICE_MS`: the update returns after one slice, the first screen is coloured from a parse of its
 * own lines, the rest of the parse runs a slice to a timer, and an edit meanwhile starts it over. And what it does
 * once there is a tree, which is what it did before.
 *
 * **THE CLOCK IS A COUNTER, AND THAT IS WHAT MAKES A SLICE A FIXED AMOUNT OF TEXT.** `colourPluginClass` takes the
 * clock a slice is timed by as its second argument, which nothing in `src/` passes. Here each reading is one
 * millisecond later than the last, so a slice ends at the parser's ninth progress callback whatever the machine: the
 * 1,000-state machine below makes more than 600 of them, and so takes more than one slice by construction, where a
 * wall clock would make that a property of the runner.
 *
 * **THE TIMERS ARE VITEST'S, SO A TEST RUNS ONE CONTINUATION AT A TIME.** Only `setTimeout` and `clearTimeout` are
 * faked: the grammar reaches the plugin on a promise, and `settled` below flushes that with real microtasks.
 *
 * **THE VIEW'S `dispatch` CALLS THE PLUGIN'S `update`, AS A REAL VIEW'S DOES.** The plugin asks for a recompute with an
 * empty transaction when its grammar arrives and when a sliced parse lands, and what it then does in `update` is half
 * of each property here. The stub in the suite above ignores `dispatch` and calls `update` by hand, which cannot show
 * an `update` the plugin itself provoked.
 */
describe('the colourer on a document whose parse outlasts one slice', () => {
  let tm: Grammar

  /** The rows for TM, as `redextape-core`'s `capture_map` has them. */
  const TM_ROWS: readonly (readonly [string, TokenClass])[] = [
    ['keyword', 'Keyword'],
    ['number', 'Nat'],
    ['label', 'Label'],
    ['label.reference', 'StateName'],
    ['variable', 'Ident'],
    ['type', 'Ident'],
    ['character', 'TapeSymbol'],
    ['constant.builtin', 'Move'],
    ['comment', 'Comment'],
    ['punctuation.bracket', 'Punct'],
    ['punctuation.delimiter', 'Punct'],
  ]
  const TM_CLASSES = classesFor(TM_ROWS)
  const TM_BY_LANGUAGE = classMapFrom([['redextape_tm', TM_ROWS]])

  beforeAll(async () => {
    await Parser.init({ locateFile: () => repoFile('../../node_modules/web-tree-sitter/web-tree-sitter.wasm') })
    tm = await load('tree-sitter-redextape-tm')
  })
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A one-tape machine of `states` states in the TM text form: three lines to a state, every line a whole item. */
  const machine = (states: number): string => {
    let out =
      'tapes 1\nstart s0\nversion 1\nencoding unary\nwidth 8\nslots 1\nresult Nat\ntape 0 #________#\n\nstate halt: accept\n'
    for (let i = 0; i < states; i++) {
      const next = i + 1 < states ? `s${i + 1}` : 'halt'
      out += `state s${i}:\n  [1] -> write [_], move [R], goto ${next}\n  [_] -> write [1], move [L], goto s${i}\n`
    }
    return out
  }

  /** 91,779 units, past `FIRST_SCREEN_UNITS`, and more than 600 progress callbacks to parse. */
  const BIG = machine(1000)
  /** 539 units and 3 progress callbacks: a parse the counter clock cannot stop. */
  const SMALL = machine(5)

  /** What a parse of the whole of `src` in one go colours in `ranges`. */
  const whole = (src: string, ranges: readonly Visible[]): ColourSpan[] => {
    const tree = tm.parser.parse(src)
    if (!tree) throw new Error('the parser returned no tree')
    try {
      expect(tree.rootNode.hasError, 'precondition: the text is a well-formed machine').toBe(false)
      return colourSpans(tm.query, tree.rootNode, ranges, TM_CLASSES)
    } finally {
      tree.delete()
    }
  }

  /** How many progress callbacks a parse of `src` in one go makes: what the counter clock divides into slices. */
  const callbacks = (src: string): number => {
    let n = 0
    tm.parser
      .parse(src, null, {
        progressCallback: () => {
          n += 1
          return false
        },
      })
      ?.delete()
    return n
  }

  /** The promise the grammar arrives on, and its continuation, run to their end. No timer is needed for either. */
  const settled = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  type Mounted = {
    plugin: { decorations: DecorationSet; update(u: ViewUpdate): void; destroy(): void }
    /** How many times the plugin has asked the view for a recompute. */
    dispatches(): number
    /** How many times the plugin has read its clock. */
    reads(): number
    /** Move the viewport without changing the document, as a scroll does. */
    show(ranges: readonly Visible[]): void
    /** An update that changes neither the document nor the viewport, as a caret moving does. */
    idle(): void
    /** One transaction of `changes` through the plugin; afterwards `ranges` is what is visible. */
    change(
      changes: { from: number; to: number; insert: string } | { from: number; to: number; insert: string }[],
      ranges: readonly Visible[],
    ): void
    text(): string
    ceilings: LanguageId[]
  }

  /** A TM editor over `src` showing `ranges`, with its grammar already arrived and its first update run. */
  const mount = async (src: string, ranges: readonly Visible[]): Promise<Mounted> => {
    let reads = 0
    let dispatches = 0
    const ceilings: LanguageId[] = []
    const view = {
      state: EditorState.create({ doc: src }),
      visibleRanges: ranges,
      dispatch: (): void => {
        dispatches += 1
        plugin.update({
          view,
          state: view.state,
          startState: view.state,
          docChanged: false,
          viewportChanged: false,
        } as unknown as ViewUpdate)
      },
    }
    const plugin = new (colourPluginClass(
      {
        languageId: 'redextape_tm',
        registry: { load: async () => ({ language: tm.language, query: tm.query }) },
        classes: () => TM_BY_LANGUAGE,
        onCeiling: (id) => ceilings.push(id),
      },
      () => {
        reads += 1
        return reads
      },
    ))(view as unknown as EditorView)
    await settled()
    expect(dispatches, 'precondition: the grammar arrived and the plugin asked for its first recompute').toBe(1)
    return {
      plugin,
      dispatches: () => dispatches,
      reads: () => reads,
      idle: () => {
        plugin.update({
          view,
          state: view.state,
          startState: view.state,
          docChanged: false,
          viewportChanged: false,
        } as unknown as ViewUpdate)
      },
      show: (next) => {
        view.visibleRanges = next
        plugin.update({
          view,
          state: view.state,
          startState: view.state,
          docChanged: false,
          viewportChanged: true,
        } as unknown as ViewUpdate)
      },
      change: (changes, next) => {
        const startState = view.state
        const tr = startState.update({ changes })
        view.state = tr.state
        view.visibleRanges = next
        plugin.update({
          view,
          state: tr.state,
          startState,
          changes: tr.changes,
          docChanged: true,
          viewportChanged: true,
        } as unknown as ViewUpdate)
      },
      text: () => view.state.doc.toString(),
      ceilings,
    }
  }

  /** A range well past `FIRST_SCREEN_UNITS`, ending inside a `goto`: a screen a long way down the machine. */
  const FAR: readonly Visible[] = [{ from: 60_000, to: BIG.indexOf('goto', 61_200) + 2 }]
  /** Where `TOP` ends: inside a `goto`, so that a first screen cut at the range's end would show. */
  const TOP_END = BIG.indexOf('goto', 1_200) + 2
  /** The top of the machine. */
  const TOP: readonly Visible[] = [{ from: 0, to: TOP_END }]

  it('gives the first update one slice of the parse and leaves the rest to a timer', async () => {
    expect(callbacks(BIG), 'precondition: the parse makes far more callbacks than one slice has').toBeGreaterThan(600)
    const m = await mount(BIG, FAR)
    // ONE SLICE: the reading that starts it, then one a callback until one is past the budget.
    expect(m.reads()).toBe(PARSE_SLICE_MS + 2)
    expect(vi.getTimerCount(), 'the rest of the parse is scheduled').toBe(1)
    // AND NOTHING FROM A TREE THAT IS NOT THERE YET: this far down is past the first screen, so the text is plain.
    expect(marks(m.plugin.decorations)).toEqual([])
  })

  it('colours text past the first screen once the whole parse lands, asking the view once', async () => {
    const m = await mount(BIG, FAR)
    vi.runOnlyPendingTimers()
    expect(marks(m.plugin.decorations), 'one more slice is not the parse').toEqual([])
    expect(vi.getTimerCount(), 'and the next is scheduled').toBe(1)
    vi.runAllTimers()
    expect(marks(m.plugin.decorations)).toEqual(whole(BIG, FAR))
    expect(marks(m.plugin.decorations).length, 'precondition: there is something to colour there').toBeGreaterThan(100)
    // ONE RECOMPUTE FOR THE LANDING, after the grammar's own: a slice that did not finish the parse asks for nothing.
    expect(m.dispatches()).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('colours the first screen from its own lines while the whole parse is pending', async () => {
    const m = await mount(BIG, TOP)
    expect(vi.getTimerCount(), 'precondition: the whole parse is pending').toBe(1)
    expect(marks(m.plugin.decorations)).toEqual(whole(BIG, TOP))
    expect(marks(m.plugin.decorations).length, 'precondition: there is something to colour there').toBeGreaterThan(100)
    // AND AFTER A SCROLL THAT STAYS INSIDE THE FIRST SCREEN'S REACH, still with no whole tree.
    const lower: readonly Visible[] = [{ from: 20_000, to: BIG.indexOf('goto', 21_200) + 2 }]
    m.show(lower)
    expect(vi.getTimerCount(), 'precondition: the whole parse is still pending').toBe(1)
    expect(marks(m.plugin.decorations)).toEqual(whole(BIG, lower))
  })

  it('parses no more than the first screen’s lines in one go while the whole parse is pending', async () => {
    // WHAT THE BOUND IS FOR, HELD ON THE PARSER'S OWN INPUT: a first screen parsed from the whole text colours the
    // same and holds the update for the whole parse, which is the defect. Every `parse` the plugin makes is seen here;
    // one with a progress callback is a slice, and one without runs to its end inside the update.
    const parse = vi.spyOn(Parser.prototype, 'parse')
    try {
      const m = await mount(BIG, TOP)
      expect(vi.getTimerCount(), 'precondition: the whole parse is pending').toBe(1)
      expect(marks(m.plugin.decorations).length, 'precondition: the first screen is coloured').toBeGreaterThan(100)
      const inOneGo = parse.mock.calls.filter(([, , options]) => options?.progressCallback === undefined)
      const sliced = parse.mock.calls.filter(([, , options]) => options?.progressCallback !== undefined)
      expect(sliced.map(([text]) => (text as string).length)).toEqual([BIG.length])
      // To the end of the line the screen ends in, and not a unit of the 91,779 past it.
      expect(inOneGo.map(([text]) => (text as string).length)).toEqual([BIG.indexOf('\n', TOP_END)])
    } finally {
      parse.mockRestore()
    }
  })

  it('reads the first screen’s end off the last visible range when the screen is in pieces', async () => {
    // TWO RANGES, AS A FOLD IN THE MIDDLE OF THE SCREEN LEAVES: the parse has to reach the end of the second.
    const pieces: readonly Visible[] = [
      { from: 0, to: 500 },
      { from: 20_000, to: BIG.indexOf('goto', 21_200) + 2 },
    ]
    const m = await mount(BIG, pieces)
    expect(vi.getTimerCount(), 'precondition: the whole parse is pending').toBe(1)
    expect(marks(m.plugin.decorations)).toEqual(whole(BIG, pieces))
    expect(marks(m.plugin.decorations).filter((s) => s.from >= 20_000).length).toBeGreaterThan(100)
  })

  it('does not parse the first screen again at an update that moved neither the text nor the screen', async () => {
    // A CARET MOVING IN AN EDITOR WHOSE PARSE IS PENDING: its first screen's marks are for this text and this screen
    // already, and every such update parsed those lines again.
    const parse = vi.spyOn(Parser.prototype, 'parse')
    try {
      const m = await mount(BIG, TOP)
      expect(vi.getTimerCount(), 'precondition: the whole parse is pending').toBe(1)
      const drawn = marks(m.plugin.decorations)
      const calls = parse.mock.calls.length
      m.idle()
      expect(parse.mock.calls.length).toBe(calls)
      expect(marks(m.plugin.decorations)).toEqual(drawn)
      expect(drawn.length, 'precondition: the first screen is coloured').toBeGreaterThan(100)
    } finally {
      parse.mockRestore()
    }
  })

  it('reaches a line that ends at `FIRST_SCREEN_UNITS` exactly, and not the line after it', async () => {
    // A COMMENT LINE AHEAD OF THE MACHINE, AS LONG AS IT TAKES TO PUT ONE OF ITS LINE ENDS ON THE BOUND ITSELF. `>=`
    // for `>` in the bound refuses that line, and no bound at all colours the next one.
    const lineEnd = BIG.lastIndexOf('\n', FIRST_SCREEN_UNITS - 1_000)
    const src = `; ${'x'.repeat(FIRST_SCREEN_UNITS - lineEnd - 3)}\n${BIG}`
    expect(src[FIRST_SCREEN_UNITS], 'precondition: a line ends at the bound').toBe('\n')
    const inside: readonly Visible[] = [{ from: FIRST_SCREEN_UNITS - 1_200, to: FIRST_SCREEN_UNITS - 3 }]
    const m = await mount(src, inside)
    expect(vi.getTimerCount(), 'precondition: the whole parse is pending').toBe(1)
    expect(marks(m.plugin.decorations)).toEqual(whole(src, inside))
    expect(marks(m.plugin.decorations).length, 'precondition: there is something to colour there').toBeGreaterThan(100)
    m.show([{ from: FIRST_SCREEN_UNITS - 1_200, to: FIRST_SCREEN_UNITS + 3 }])
    expect(vi.getTimerCount(), 'precondition: the whole parse is still pending').toBe(1)
    expect(marks(m.plugin.decorations)).toEqual([])
  })

  it('starts over on the new text when an edit arrives while the parse is pending', async () => {
    const m = await mount(BIG, TOP)
    vi.runOnlyPendingTimers()
    expect(vi.getTimerCount(), 'precondition: the parse is some slices in and still pending').toBe(1)
    // A COMMENT LINE AT THE VERY TOP, which is text the abandoned parse had already been over.
    m.change({ from: 0, to: 0, insert: '; a note\n' }, TOP)
    expect(vi.getTimerCount(), 'one parse is pending, not two').toBe(1)
    expect(marks(m.plugin.decorations), 'the first screen is the new text’s').toEqual(whole(m.text(), TOP))
    vi.runAllTimers()
    m.show(FAR)
    expect(marks(m.plugin.decorations)).toEqual(whole(m.text(), FAR))
    m.show(TOP)
    expect(marks(m.plugin.decorations)).toEqual(whole(m.text(), TOP))
    expect(marks(m.plugin.decorations)[0]).toEqual({ from: 0, to: 8, cls: 'tok-comment' })
  })

  /**
   * **A DOCUMENT THAT HAS A TREE IS REPARSED AS IT WAS, IN THE UPDATE THAT CHANGED IT.** The three cases below are what
   * a coloured editor does on a keystroke, on a transaction of several changes and on a replacement of its whole text.
   * This branch first put the last two in slices, and its whole-branch review measured what that cost: the tree was
   * dropped, so a screen past the first went plain, for 14 of 15 frames at 1,534,779 units on an idle page, where the
   * parse in one go held the update for 164.4 ms and the screen stayed coloured.
   */
  it('reparses a keystroke against a landed tree at once, as before', async () => {
    const m = await mount(BIG, FAR)
    vi.runAllTimers()
    const dispatched = m.dispatches()
    // ONE DIGIT ON THE END OF A `goto`'S TARGET: the machine still parses, and the tree under the screen changes.
    const at = BIG.indexOf('\n', BIG.indexOf('goto s', 60_100))
    m.change({ from: at, to: at, insert: '9' }, FAR)
    expect(vi.getTimerCount(), 'nothing is left to a timer').toBe(0)
    expect(m.dispatches()).toBe(dispatched)
    expect(marks(m.plugin.decorations)).toEqual(whole(m.text(), FAR))
  })

  it('reparses a transaction of several changes against a landed tree in that update, the screen still coloured', async () => {
    const m = await mount(BIG, FAR)
    vi.runAllTimers()
    const before = m.reads()
    const middle = BIG.indexOf('\nstate ', 70_000) + 1
    m.change(
      [
        { from: 0, to: 0, insert: '; first\n' },
        { from: middle, to: middle, insert: '; middle\n' },
        { from: BIG.length, to: BIG.length, insert: '; last\n' },
      ],
      FAR,
    )
    expect(vi.getTimerCount(), 'nothing is left to a timer').toBe(0)
    expect(m.reads() - before, 'no slice was timed').toBe(0)
    expect(marks(m.plugin.decorations)).toEqual(whole(m.text(), FAR))
    expect(marks(m.plugin.decorations).length, 'precondition: there is something to colour there').toBeGreaterThan(100)
  })

  it('reparses a replacement of the whole text against a landed tree in that update, the screen still coloured', async () => {
    const m = await mount(BIG, FAR)
    vi.runAllTimers()
    const next = `; replaced\n${BIG}`
    const before = m.reads()
    m.change({ from: 0, to: BIG.length, insert: next }, FAR)
    expect(vi.getTimerCount(), 'nothing is left to a timer').toBe(0)
    expect(m.reads() - before, 'no slice was timed').toBe(0)
    expect(marks(m.plugin.decorations)).toEqual(whole(next, FAR))
    expect(marks(m.plugin.decorations).length, 'precondition: there is something to colour there').toBeGreaterThan(100)
  })

  it('parses several changes in slices when they arrive with the first parse still pending', async () => {
    // NO TREE YET, SO NOTHING ON SCREEN TO LOSE: the new text's parse starts over as the first one did.
    const m = await mount(BIG, FAR)
    vi.runOnlyPendingTimers()
    expect(vi.getTimerCount(), 'precondition: the parse is some slices in and still pending').toBe(1)
    const before = m.reads()
    m.change(
      [
        { from: 0, to: 0, insert: '; first\n' },
        { from: BIG.length, to: BIG.length, insert: '; last\n' },
      ],
      FAR,
    )
    expect(m.reads() - before, 'one slice').toBe(PARSE_SLICE_MS + 2)
    expect(vi.getTimerCount(), 'one parse is pending, not two').toBe(1)
    expect(marks(m.plugin.decorations), 'plain past the first screen until it lands').toEqual([])
    vi.runAllTimers()
    expect(marks(m.plugin.decorations)).toEqual(whole(m.text(), FAR))
  })

  /**
   * **A REPLACEMENT BY THE SAME TEXT IS NOT A CHANGE TO REPARSE.** *Format* answers with one edit over the whole
   * buffer and the editor dispatches it whether or not it changed a character (`lsp-text.ts`'s `applyEdits`), so
   * every format of a text that parses, changed by it or not, reparsed the whole of it: 164.4 ms inside the update at
   * 1,534,779 units, measured by this branch's review on `main`'s colourer.
   */
  it('does not reparse a replacement by the same text', async () => {
    const m = await mount(BIG, FAR)
    vi.runAllTimers()
    const drawn = marks(m.plugin.decorations)
    const parse = vi.spyOn(Parser.prototype, 'parse')
    try {
      m.change({ from: 0, to: BIG.length, insert: BIG }, FAR)
      expect(parse.mock.calls.length).toBe(0)
    } finally {
      parse.mockRestore()
    }
    expect(vi.getTimerCount()).toBe(0)
    expect(marks(m.plugin.decorations)).toEqual(drawn)
    expect(drawn.length, 'precondition: there is something to colour there').toBeGreaterThan(100)
  })

  it('reparses a change that keeps the text’s length and its lines and not the text', async () => {
    // THE SAME-TEXT RULE'S OTHER SIDE: one character typed over another, and the whole text replaced by one of its
    // length, are changes. Taken for the same text, each would leave the tree of the text before.
    const m = await mount(BIG, TOP)
    vi.runAllTimers()
    expect(marks(m.plugin.decorations)[0], 'precondition: the text opens on a keyword').toEqual({
      from: 0,
      to: 5,
      cls: 'tok-keyword',
    })
    // `tapes 1` TO `;apes 1`: the first line is a comment now, one unit for one.
    m.change({ from: 0, to: 1, insert: ';' }, TOP)
    expect(m.text().length).toBe(BIG.length)
    expect(marks(m.plugin.decorations)).toEqual(whole(m.text(), TOP))
    expect(marks(m.plugin.decorations)[0]).toEqual({ from: 0, to: 7, cls: 'tok-comment' })
    // AND THE WHOLE TEXT BY ANOTHER OF ITS LENGTH AND ITS LINES: the comment is the second line's this time.
    const other = `tapes 1\n;${BIG.slice(9)}`
    expect(other.length).toBe(BIG.length)
    m.change({ from: 0, to: BIG.length, insert: other }, TOP)
    expect(marks(m.plugin.decorations)).toEqual(whole(other, TOP))
    expect(marks(m.plugin.decorations)[1]).toEqual({ from: 6, to: 7, cls: 'tok-nat' })
    expect(marks(m.plugin.decorations)[2]).toEqual({ from: 8, to: 16, cls: 'tok-comment' })
  })

  it('does not start a pending parse over for a replacement by the same text', async () => {
    const m = await mount(BIG, FAR)
    vi.runOnlyPendingTimers()
    expect(vi.getTimerCount(), 'precondition: the parse is some slices in and still pending').toBe(1)
    const before = m.reads()
    m.change({ from: 0, to: BIG.length, insert: BIG }, FAR)
    expect(m.reads() - before, 'no slice ran in that update: the pending parse is still the text’s').toBe(0)
    expect(vi.getTimerCount()).toBe(1)
    vi.runAllTimers()
    expect(marks(m.plugin.decorations)).toEqual(whole(BIG, FAR))
  })

  it('rebuilds nothing at an update that moved nothing, once its tree has landed', async () => {
    const m = await mount(BIG, FAR)
    vi.runAllTimers()
    expect(
      marks(m.plugin.decorations).length,
      'precondition: the tree landed and the screen is coloured',
    ).toBeGreaterThan(100)
    // THE QUERY IS WHAT A REBUILD COSTS ONCE THERE IS A TREE, so its calls are what is counted.
    const captures = vi.spyOn(Query.prototype, 'captures')
    try {
      m.idle()
      m.idle()
      expect(captures.mock.calls.length).toBe(0)
    } finally {
      captures.mockRestore()
    }
  })

  it('colours a document that parses inside one slice in the same update, with nothing scheduled', async () => {
    expect(callbacks(SMALL), 'precondition: fewer callbacks than a slice has').toBeLessThan(PARSE_SLICE_MS)
    const all: readonly Visible[] = [{ from: 0, to: SMALL.length }]
    const m = await mount(SMALL, all)
    expect(vi.getTimerCount()).toBe(0)
    expect(m.dispatches()).toBe(1)
    expect(marks(m.plugin.decorations)).toEqual(whole(SMALL, all))
  })

  it('draws nothing, and still parses, for an editor with nothing visible', async () => {
    // AN EDITOR WITH NO HEIGHT YET HAS NO VISIBLE RANGE AT ALL, and the first screen's rule reads the last one.
    const m = await mount(BIG, [])
    expect(vi.getTimerCount(), 'precondition: the whole parse is pending').toBe(1)
    // A SECOND UPDATE, MADE FROM HERE: the first ran inside the promise the grammar arrived on, whose own `catch`
    // would have taken a throw from it, and this one's would reach the test.
    m.show([])
    expect(marks(m.plugin.decorations)).toEqual([])
    vi.runAllTimers()
    m.show(FAR)
    expect(marks(m.plugin.decorations)).toEqual(whole(BIG, FAR))
  })

  it('does not try again a slice that throws from its timer, and parses afresh on the next change', async () => {
    const m = await mount(BIG, TOP)
    expect(vi.getTimerCount(), 'precondition: the whole parse is pending').toBe(1)
    const parse = vi.spyOn(Parser.prototype, 'parse').mockImplementationOnce(() => {
      throw new Error('the parser fell over')
    })
    try {
      expect(() => vi.runOnlyPendingTimers()).toThrow('the parser fell over')
    } finally {
      parse.mockRestore()
    }
    expect(vi.getTimerCount(), 'nothing is scheduled to throw again').toBe(0)
    expect(marks(m.plugin.decorations), 'the first screen keeps its marks').toEqual(whole(BIG, TOP))
    m.change({ from: 0, to: 0, insert: '; a note\n' }, TOP)
    vi.runAllTimers()
    m.show(FAR)
    expect(marks(m.plugin.decorations)).toEqual(whole(m.text(), FAR))
  })

  it('leaves nothing scheduled once destroyed mid-parse', async () => {
    // NOTHING SCHEDULED IS THE WHOLE PROPERTY: a slice that ran after this would ask a destroyed view for a recompute.
    const m = await mount(BIG, FAR)
    expect(vi.getTimerCount(), 'precondition: the whole parse is pending').toBe(1)
    m.plugin.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('abandons a pending parse when the document crosses the ceiling, and parses afresh when it comes back', async () => {
    const m = await mount(BIG, TOP)
    vi.runOnlyPendingTimers()
    expect(vi.getTimerCount(), 'precondition: the parse is some slices in and still pending').toBe(1)
    const over = 'z'.repeat(COLOUR_CEILING_UNITS + 1)
    m.change({ from: 0, to: BIG.length, insert: over }, [{ from: 0, to: 100 }])
    expect(m.ceilings).toEqual(['redextape_tm'])
    expect(vi.getTimerCount(), 'nothing is parsing a document too large to colour').toBe(0)
    expect(marks(m.plugin.decorations)).toEqual([])
    // BACK UNDER, to text the abandoned parse never saw: resumed on it, the parser would answer with the top of `BIG`.
    const back = 'state halt: accept\n'
    m.change({ from: 0, to: over.length, insert: back }, [{ from: 0, to: back.length }])
    vi.runAllTimers()
    expect(marks(m.plugin.decorations)).toEqual(whole(back, [{ from: 0, to: back.length }]))
    expect(marks(m.plugin.decorations)[0]).toEqual({ from: 0, to: 5, cls: 'tok-keyword' })
  })
})

/**
 * **THE REGISTRY'S TWO FAILURE SHAPES, WHICH DESIGN §10 GIVES DIFFERENT SENTENCES AND THE CODE GAVE
 * THE SAME ONE.**
 *
 * Row 3 of that table — *a grammar fails to load: that language shows uncoloured, one notice, the other
 * three are unaffected* — was built in `main.ts` and exercised by nothing:
 * `tests/browser/grammar-differential.test.ts` only ever asserts the failure list stays EMPTY, which is
 * a test of the happy path wearing a failure's clothes. The first test below drives a real failed load.
 *
 * The second is the case the review found underneath it. `Parser.init` is memoised for the whole
 * registry, so a runtime `.wasm` that will not fetch rejects every language's promise from ONE cause —
 * four notices, one per language, for a single event that leaves nothing on the page coloured.
 * `createGrammarRegistry` reports that through `onRuntimeFailure`, once.
 *
 * **NODE, AND THE GRAMMARS ARE THE REAL ONES**, as the two suites above are: `Language.load` takes a
 * filesystem path here, so a fabricated failure sits beside a genuine success in the same registry and
 * the independence claim is about real loads rather than about two stubs.
 */
describe('the grammar registry when something does not load', () => {
  const highlightsOf = (name: string): string =>
    readFileSync(repoFile(`../../../grammars/${name}/queries/highlights.scm`), 'utf8')

  const wasmOf = (name: string): string => repoFile(`../../../grammars/${name}/${name}.wasm`)

  /** The runtime, located as the suites above locate it, rather than through Vite's `?url` default. */
  const initRuntime = (): Promise<void> =>
    Parser.init({ locateFile: () => repoFile('../../node_modules/web-tree-sitter/web-tree-sitter.wasm') })

  /** Whether an editor of `languageId` over `src` paints anything, driven through the real plugin. */
  const painted = async (
    registry: { load: (id: LanguageId) => Promise<{ language: Language; query: Query } | null> },
    languageId: LanguageId,
    src: string,
    classes: Map<string, Map<string, string>>,
  ): Promise<number> => {
    const state = EditorState.create({ doc: src })
    const view = { state, visibleRanges: [{ from: 0, to: state.doc.length }], dispatch: () => {} }
    const plugin = new (colourPluginClass({
      languageId,
      registry,
      classes: () => classes,
      onCeiling: (id) => {
        throw new Error(`${id}: nothing here is anywhere near the ceiling`)
      },
    }))(view as unknown as EditorView)
    // The load is a promise the constructor does not await, and a REJECTED one takes a second turn of
    // the microtask queue to reach the registry's own catch; two macrotasks is slack, not a race.
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    plugin.update({ view, state, docChanged: false, viewportChanged: true } as unknown as ViewUpdate)
    return plugin.decorations.size
  }

  it('leaves one broken grammar uncoloured, reports it once, and colours the others anyway', async () => {
    const failures: [LanguageId, string][] = []
    const runtimeFailures: string[] = []
    const registry = createGrammarRegistry({
      onFailure: (id, reason) => failures.push([id, reason]),
      onRuntimeFailure: (reason) => runtimeFailures.push(reason),
      initRuntime,
      sources: {
        // THE λ ROW IS THE SABOTAGE and it is a path, not a stub: `Language.load` really goes looking
        // for this file and really does not find it.
        redextape_lambda: {
          wasmUrl: repoFile('../../../grammars/tree-sitter-redextape-lambda/no-such-grammar.wasm'),
          highlights: highlightsOf('tree-sitter-redextape-lambda'),
        },
        redextape: {
          wasmUrl: wasmOf('tree-sitter-redextape'),
          highlights: highlightsOf('tree-sitter-redextape'),
        },
      },
    })
    const classes = classMapFrom([
      ['redextape', REDEXTAPE_ROWS],
      ['redextape_lambda', LAMBDA_ROWS],
    ])

    expect(await registry.load('redextape_lambda')).toBeNull()
    expect(failures.map(([id]) => id)).toEqual(['redextape_lambda'])
    expect(runtimeFailures, 'a missing grammar is not the runtime failing').toEqual([])
    // THE LANGUAGE ITSELF: uncoloured, not merely unreported. A registry that answered null while the
    // plugin painted from somewhere else would satisfy the line above and nothing a user can see.
    expect(await painted(registry, 'redextape_lambda', 'λx. x', classes)).toBe(0)

    // **THE HALF MOST WORTH PINNING**, per `createGrammarRegistry`'s own doc and design §10's row 3:
    // the other languages are unaffected, because each grammar loads independently over a runtime they
    // merely share. A second `load` of the broken one adds no second report either — a failure is
    // remembered as a failure.
    expect(await registry.load('redextape')).not.toBeNull()
    expect(await painted(registry, 'redextape', 'let x = 1;', classes)).toBeGreaterThan(0)
    expect(await registry.load('redextape_lambda')).toBeNull()
    expect(failures).toHaveLength(1)
    expect(runtimeFailures).toEqual([])
  })

  it('reports a failed shared runtime once for the page, not once per language', async () => {
    const failures: [LanguageId, string][] = []
    const runtimeFailures: string[] = []
    const registry = createGrammarRegistry({
      onFailure: (id, reason) => failures.push([id, reason]),
      onRuntimeFailure: (reason) => runtimeFailures.push(reason),
      // **THE SEAM IS OVER THE WHOLE STEP RATHER THAN OVER `locateFile`, AND IT HAS TO BE.**
      // `Parser.init` memoises its module in a module-level `Module3 ??=`, so once the suites above
      // have initialised the runtime in this process, no `locateFile` can make it fail again. See
      // `createGrammarRegistry`'s `initRuntime`.
      initRuntime: () => Promise.reject(new Error('the runtime .wasm did not fetch')),
    })

    const loaded = await Promise.all(LANGUAGE_IDS.map((id) => registry.load(id)))

    expect(loaded, 'every language goes uncoloured, which is the honest outcome').toEqual([null, null, null, null])
    // **THE DEFECT FIRST, BECAUSE A SEQUENCE PROVES ONLY ITS PREFIX.** Four `onFailure` calls is what
    // shipped: one event reported as four grammars that happened to break at once, and four notices
    // where §10 promises one per failure.
    expect(failures, 'the runtime is nobody’s grammar').toEqual([])
    // And one sentence for the one event, rather than silence — the other way this can be wrong.
    expect(runtimeFailures).toEqual(['the runtime .wasm did not fetch'])
  })
})
