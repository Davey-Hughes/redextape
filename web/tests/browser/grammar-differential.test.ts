import { beforeAll, describe, expect, it } from 'vitest'
import { Parser } from 'web-tree-sitter'
import goldenRaw from '../../../grammars/capture-golden.json?raw'
import redextapeHighlights from '../../../grammars/tree-sitter-redextape/queries/highlights.scm?raw'
import redextapeWasmUrl from '../../../grammars/tree-sitter-redextape/tree-sitter-redextape.wasm?url'
import asmHighlights from '../../../grammars/tree-sitter-redextape-asm/queries/highlights.scm?raw'
import asmWasmUrl from '../../../grammars/tree-sitter-redextape-asm/tree-sitter-redextape-asm.wasm?url'
import lambdaHighlights from '../../../grammars/tree-sitter-redextape-lambda/queries/highlights.scm?raw'
import lambdaWasmUrl from '../../../grammars/tree-sitter-redextape-lambda/tree-sitter-redextape-lambda.wasm?url'
import tmHighlights from '../../../grammars/tree-sitter-redextape-tm/queries/highlights.scm?raw'
import tmWasmUrl from '../../../grammars/tree-sitter-redextape-tm/tree-sitter-redextape-tm.wasm?url'
import init, { captureClasses } from '../../../pkg/redextape_wasm.js'
import { type CaptureTable, classMapFrom, colourSpans, createGrammarRegistry } from '../../src/colour'
import { LANGUAGE_IDS, type LanguageId } from '../../src/lsp-protocol'
import { tokenClassName } from '../../src/theme'
import { TOKEN_CLASSES, type TokenClass } from '../../src/types'

/**
 * **THE GRAMMAR DIFFERENTIAL, CROSSED INTO THE BROWSER.**
 *
 * `redextape-grammar-check` holds the four grammars to the hand-written front end span for span, and it
 * **cannot run here**: its `build.rs` compiles four generated `parser.c` into itself through `cc`, so
 * there is no wasm build of it. What runs here is the other artefact — the four committed `.wasm`, under
 * `web-tree-sitter`, which is what the app actually colours from and which no Rust test can load. The
 * two meet in `grammars/capture-golden.json`, which that crate's `tests/golden.rs` emits and verifies.
 *
 * **SO THIS IS THE TEST THAT FAILS IF THE ARTEFACT MOVES**: a grammar ABI bump, a bumped tree-sitter
 * CLI, or a committed `.wasm` that no longer matches its own `grammar.js`. Every other check in the
 * tree reads either the C parser or the query, and none of them reads the `.wasm`.
 *
 * **THE COLLAPSE IS THE WHOLE COMPARISON, NOT A DETAIL OF IT.** `Grammar::captures` does not return a
 * raw capture list: it keys captures by `(start, end)` into a `BTreeMap`, rejects two captures on one
 * range that disagree, and drains in offset order. A raw list is a different sequence, and asserting one
 * against the other would be a reconciliation dressed as an equality. `colourSpans` — the app's own
 * function, from `src/colour.ts` — collapses identically and by design, so it is called here rather than
 * reimplemented. This file is its first non-test consumer, which is the other half of why it is called
 * rather than copied.
 *
 * **OFFSETS ARE UTF-16 CODE UNITS.** The golden is written in them and the Rust side does the converting,
 * because this side is the one under test and a conversion here would be a second thing that could be
 * wrong. The λ fixture is what makes the choice observable: over pure ASCII the two units agree, and its
 * first binder sits at 1..2 in code units against 1..3 in bytes.
 *
 * **THE FOUR TABLES DISAGREE ON `@function`, `@variable.parameter` AND `@label.reference`, AND THAT IS
 * WHY THE LOOP BELOW IS PER LANGUAGE.** One merged pass over four grammars would colour an asm mnemonic
 * as an identifier and agree with itself while doing it. `capture-golden.json` is keyed by `languageId`
 * for the same reason, and the Rust side asserts each language's fixture carries a class no other one
 * produces.
 *
 * **REAL TIMERS.** Three of the awaits below are wasm fetches; a fake clock plus an awaited fetch is a
 * deadlock rather than a slow test.
 */

/** One golden span: a UTF-16 start, a UTF-16 end, and a `TokenClass` name. */
type GoldenSpan = [start: number, end: number, cls: string]

/** One golden fixture: the text, and what `Grammar::captures` makes of it. */
type GoldenFixture = { src: string; spans: GoldenSpan[] }

/** The whole file: language, then fixture name. */
type Golden = Record<string, Record<string, GoldenFixture>>

const golden = JSON.parse(goldenRaw) as Golden

/**
 * The artefacts under test, named here rather than taken from `colour.ts`'s private table.
 *
 * **THE POINT IS THAT THIS TEST SAYS WHICH `.wasm` IT READ.** `createGrammarRegistry` takes `sources`,
 * so swapping two rows below is the one-line sabotage that shows the comparison is reading the compiled
 * artefact and not merely the query text — which is the half `colour.ts` alone could not demonstrate,
 * since it holds the only copy of the mapping.
 */
const SOURCES: Record<LanguageId, { readonly wasmUrl: string; readonly highlights: string }> = {
  redextape: { wasmUrl: redextapeWasmUrl, highlights: redextapeHighlights },
  redextape_lambda: { wasmUrl: lambdaWasmUrl, highlights: lambdaHighlights },
  redextape_tm: { wasmUrl: tmWasmUrl, highlights: tmHighlights },
  redextape_asm: { wasmUrl: asmWasmUrl, highlights: asmHighlights },
}

/** The golden's class name as the app's `TokenClass`, or a failure naming the name it could not place. */
const asTokenClass = (name: string): TokenClass => {
  const hit = TOKEN_CLASSES.find((c) => c === name)
  if (hit === undefined) throw new Error(`the golden names \`${name}\`, which is not a TokenClass this app has`)
  return hit
}

/** The golden's key as a `languageId`, or a failure: an unknown one would otherwise be skipped silently. */
const asLanguageId = (id: string): LanguageId => {
  const hit = LANGUAGE_IDS.find((l) => l === id)
  if (hit === undefined) throw new Error(`the golden names the language \`${id}\`, which this app does not have`)
  return hit
}

/** Per language, capture name to CSS class — built from the wasm export, exactly as `main.ts` builds it. */
let classes: Map<string, Map<string, string>>

/** One registry for the file, as the app keeps one for the page. */
let registry: ReturnType<typeof createGrammarRegistry>

/** The failures the registry reported, so a grammar that did not load fails loudly instead of uncoloured. */
const failures: string[] = []

beforeAll(async () => {
  // `captureClasses()` is a wasm export and throws if the module is not live — the same ordering
  // constraint `main.ts` documents around its own call.
  await init()
  classes = classMapFrom(captureClasses() as CaptureTable[])
  registry = createGrammarRegistry({
    onFailure: (id, reason) => failures.push(`${id}: ${reason}`),
    // THE SHARED `web-tree-sitter.wasm`, WHICH IS NOT ANY ONE LANGUAGE'S FAILURE and is reported apart
    // from them. Into the same list: either way this file's assertion is that nothing failed at all.
    onRuntimeFailure: (reason) => failures.push(`the runtime: ${reason}`),
    sources: SOURCES,
  })
})

describe('the committed grammar .wasm agree with the Rust differential, span for span', () => {
  for (const [languageKey, fixtures] of Object.entries(golden)) {
    for (const [name, fixture] of Object.entries(fixtures)) {
      it(`${languageKey}: ${name}`, async () => {
        const languageId = asLanguageId(languageKey)
        const grammar = await registry.load(languageId)
        expect(failures, 'a grammar that will not load is this test failing, not this test skipping').toEqual([])
        if (grammar === null) throw new Error(`${languageId}: the grammar did not load`)

        const parser = new Parser()
        try {
          parser.setLanguage(grammar.language)
          const tree = parser.parse(fixture.src)
          if (tree === null) throw new Error(`${languageId}: the parser returned no tree`)
          try {
            // **A FIXTURE THAT DOES NOT PARSE CLEANLY YIELDS A SHORT CAPTURE LIST**, and a short list
            // that is a prefix of the truth is the shape of a comparison that passes while covering
            // nothing. The Rust side's authority check is the mirror of this one.
            expect(tree.rootNode.hasError, `${languageId}: \`${name}\` did not parse cleanly here`).toBe(false)

            const byCapture = classes.get(languageId)
            if (byCapture === undefined) throw new Error(`${languageId}: captureClasses() has no table for it`)

            // **THE DISAGREEMENT RULE, WHICH THE COLLAPSE CANNOT CARRY.** `Grammar::captures` returns
            // `Err` when two captures on one range project to different classes; `colourSpans` takes
            // the last of them, deliberately matching `BTreeMap::insert` rather than throwing inside a
            // render path. So the refusal lives here, over the raw captures, and without it this file
            // would compare a collapse whose soundness nothing on this side had checked.
            //
            // **THE RANGE IS DOUBLED AND THE CAPTURED NODE'S OFFSETS ARE NOT.** `QueryOptions`'
            // `startIndex`/`endIndex` are 2 × UTF-16 code units in web-tree-sitter 0.27.0, while
            // `node.startIndex` is plain code units — `colourSpans`'s own comment holds the
            // measurement. The asymmetry has already shipped one Critical defect on this branch.
            const seen = new Map<string, string>()
            for (const c of grammar.query.captures(tree.rootNode, {
              startIndex: 0,
              endIndex: fixture.src.length * 2,
            })) {
              const cls = byCapture.get(c.name)
              if (cls === undefined) continue
              const key = `${c.node.startIndex}:${c.node.endIndex}`
              const prev = seen.get(key)
              expect(
                prev ?? cls,
                `${languageId}: \`${name}\`: two captures on ${key} disagree, the second via @${c.name}`,
              ).toBe(cls)
              seen.set(key, cls)
            }

            const got = colourSpans(grammar.query, tree.rootNode, [{ from: 0, to: fixture.src.length }], byCapture)
            const want = fixture.spans.map(([from, to, cls]) => ({ from, to, cls: tokenClassName(asTokenClass(cls)) }))
            expect(got).toEqual(want)
          } finally {
            tree.delete()
          }
        } finally {
          parser.delete()
        }
      })
    }
  }

  /**
   * The golden covers all four languages.
   *
   * Without this, deleting a language from the fixture file would delete its coverage here and leave
   * every remaining test green — the loop above iterates the FILE, so an absent language is not a
   * failure, it is silence. The Rust side refuses a language the golden carries and no fixture
   * computes; this is the other direction.
   */
  it('covers every language the app colours', () => {
    expect(Object.keys(golden).sort()).toEqual([...LANGUAGE_IDS].sort())
  })
})
