import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'

// DUPLICATED FROM `app.test.ts` ON PURPOSE. This file exists only because that page cannot host this
// test — see the file-level comment on the single `it` below for why a fresh mount is the whole point.
const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main>
    <section id="source" class="pane"><div id="editor"></div><div id="link-status" class="link-status"></div></section>
    <section id="lambda" class="pane"></section>
    <section id="tm" class="pane wide"></section>
    <section id="results" class="pane results wide"></section>
  </main>`

let view: EditorView

async function until(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error('timed out waiting for the app')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const resultsText = () => document.querySelector('#results')?.textContent ?? ''
const linkStatusText = () => document.querySelector('#link-status')?.textContent ?? ''

/** Link the source construct at `pos`, via the keyboard route `main.ts` binds to `Mod-'`. */
function linkAt(v: EditorView, pos: number): void {
  v.dispatch({ selection: { anchor: pos } })
  v.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: "'", ctrlKey: true, cancelable: true }))
}

/** Replace the whole buffer and wait for the run it triggers to finish. */
async function settled(v: EditorView, src: string): Promise<void> {
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: src } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== '')
}

describe('the λ pane, truncated', () => {
  // ONE MOUNT FOR THE FILE, ON ITS OWN PAGE. Vitest gives each test file its own page and worker, and
  // that isolation is why this test lives here rather than as one more `it` in `app.test.ts`: on the
  // ~40-test shared worker there, the program below degraded badly and the whole file timed out, while
  // a control at the identical position (`let x = 41; x + 2`) settled fine on that same worker. THAT
  // DOES NOT PIN THE CAUSE TO THE TERM ITSELF — see the closing paragraph of the `it` below: which
  // literal settles depends on run order within a worker, because a worker's print stack ceiling
  // degrades after its first deep print. The isolation this file buys is still needed either way; only
  // the reason has changed.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  // UNTESTABLE BY CONSTRUCTION, NOT BY CHOICE, UNTIL THE PRINTER GOT A DEPTH CAP. `lambdaLinkState`'s
  // `'truncated'` arm (`main.ts`) only fires for a source construct whose λ node exists in
  // `LinkIndex.lambda_nodes` but was cut from the printed text — before `print_lambda_capped` gained a
  // depth limit (see the PR that added `index.lambdaCut`'s DEPTH reason), the only way to fall past the
  // print frontier was a byte budget so large the wasm module crashed reaching it. The depth cap made a
  // small, well-formed term exercise the same code path instead.
  //
  // `let x = 1000; x` IS THE ONE VALUE THAT WORKS, MEASURED, NOT GUESSED. `x` here is `church 1000`
  // (`let` desugars to a redex), so its term depth is 1,003 — just past the cap (mirrors
  // `redextape_wasm::session::MAX_PRINT_DEPTH`, currently 1,000), cut by DEPTH rather than by byte
  // budget.
  //
  // THERE IS NO CLIFF HERE, AND AN EARLIER VERSION OF THIS COMMENT CLAIMED THERE WAS. It said the
  // literal "cannot be raised because the app stops settling above ~1500" — a program at 1600 was
  // observed not settling while a control at 1500 did. That was an ORDERING ARTIFACT of the bug
  // `MAX_PRINT_DEPTH`'s new, lower value now fixes, not a size ceiling on the literal: a worker's
  // print stack ceiling degrades after its first deep print and settles lower (see `session.rs`'s
  // doc comment on `MAX_PRINT_DEPTH`), so whichever deep program happened to run FIRST in a worker
  // got the roomier ceiling, and the printer call for a later one could overflow mid-flight, poison
  // the session's wasm-bindgen reentrancy borrow, and go silent forever with no `worker-error`
  // reaching the client (see `session-worker.ts`'s `dropLive`). Which literal "settled" depended on
  // run order within a worker, not on the literal's own depth.
  it('reports truncation for a construct past the printer’s depth cap', async () => {
    const src = 'let x = 1000; x'
    await settled(view, src)

    // RESTART TO STEP 0 BEFORE CLICKING. `lambdaLinkState` checks the play head before it checks
    // truncation (see its doc in `main.ts`: "a play head off step 0 makes truncation irrelevant"), so
    // clicking after the run — which leaves the λ pane mid-playback — reports `'not-step-0'` and never
    // reaches the branch this test exists for.
    const restart = [...document.querySelectorAll<HTMLButtonElement>('#lambda button')].find((b) =>
      b.textContent?.includes('↺'),
    )
    restart?.click()
    await until(() => (document.querySelector('#lambda .step')?.textContent ?? '').includes('step 0'))

    // THE LITERAL, NOT THE TRAILING `x`. The literal's λ node is the one whose span was cut by the
    // printer's depth cap; the trailing `x` still resolves to a span inside the printed prefix and would
    // report `'shown'` instead.
    linkAt(view, src.indexOf('1'))
    await until(() => linkStatusText() !== '')
    expect(linkStatusText()).toContain('the λ term is truncated before this construct')
  }, 30_000)
})
