import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * **THE FORK, DRIVEN THROUGH THE APP** — design §4.3's detach, plan T8, from the control a user
 * clicks to the second session it registers and back.
 *
 * THIS IS THE TIER THAT WAS MISSING ONE TASK AGO, AND SAYING SO IS THE POINT. T7's own doc records
 * why every test it shipped built its registry by hand: "nothing in this slice can put a second
 * session in `main()`'s registry — a `LambdaScratch` needs a worker message `session-worker.ts` does
 * not have, and creating one on edit is §4.3, which is T8." This file is the app doing it.
 *
 * WHAT IT DOES NOT ASSERT, AND WHERE THAT LIVES INSTEAD. Neither `pool.size` nor a worker's liveness
 * is reachable from the DOM, and this app has ONE λ pane, so the singleton (which the plan requires
 * be asserted on pool size, "not on rendering") and the terminate-on-recompile claim are
 * `tests/node/scratch.test.ts` and `tests/browser/scratch-fork.test.ts` respectively. What is only
 * assertable here is the wiring: that a control exists, that clicking it moves this pane onto a
 * detached session seeded with the term it was showing, and that recompiling brings it home.
 */

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

async function until(predicate: () => boolean, what: string, timeoutMs = 60_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const resultsText = () => document.querySelector('#results')?.textContent ?? ''
const term = () => document.querySelector('#lambda .term')?.textContent ?? ''
const step = () => document.querySelector('#lambda .step')?.textContent ?? ''
const heading = () => document.querySelector('#lambda h2')?.textContent ?? ''
const forkButton = () => document.querySelector<HTMLButtonElement>('#lambda .controls .detach')
const selector = () => document.querySelector<HTMLSelectElement>('#lambda .pane-binding select')
const statusLine = () => document.querySelector('#link-status')?.textContent ?? ''

/** `app.test.ts`'s `settled`, and the same invariant argument applies — see its doc there. */
async function settled(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(
    () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== '',
    `the app to settle on \`${src}\``,
  )
}

const clickLambda = (label: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('#lambda .controls button')].find(
    (x) => x.textContent === label,
  )
  if (b === undefined) throw new Error(`no \`${label}\` button in the λ pane`)
  b.click()
}

describe('the fork control, end to end', () => {
  // ONE MOUNT FOR THE FILE, for `app.test.ts`'s reason: ES module imports are cached, so `main()` runs
  // once per page and Vitest gives each test FILE its own page.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(
      () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== '',
      'the first compile',
    )
  })

  /**
   * THE WHOLE CYCLE IN ONE `it`, WHICH IS A SEQUENCING DECISION RATHER THAN LAZINESS. The states are
   * ordered — there is no scratchpad to retire until one has been forked, and no fork until the app
   * has compiled — and `beforeAll` mounts one app for the file, so splitting them into four `it`s
   * would make each depend on the previous having run, which is the shared-mutable-fixture failure
   * `app.test.ts` documents in its own nested-`describe` note. Every stage below asserts before it
   * acts.
   */
  it('forks the λ pane onto a scratchpad seeded with the term it was showing, and comes home on a recompile', async () => {
    await settled('let x = 40; x + 2')

    // STAGE 1 — attached, and the app looks exactly as T7 left it. The selector is absent because one
    // session offers λ (`bindingSelect`'s "not shown at all below two options"), and the fork control
    // is present because the pane is attached and its frame is whole.
    expect(heading()).toBe('lambda')
    expect(selector()).toBeNull()
    expect(forkButton()).not.toBeNull()

    // Two steps in, so the seed is a term the SOURCE SESSION IS NOT AT STEP 0 OF. §4.3 seeds with
    // "that pane's current text", and a fork taken at step 0 would produce a scratchpad
    // indistinguishable from the source's own λ leg — the whole claim would render identically either
    // way, which is the trap the plan names for the singleton test and it applies here too.
    //
    // `↺` FIRST, BECAUSE A SETTLED PANE IS AT THE FRONTIER AND NOT AT THE START. Recording pushes the
    // play head along with it, so `let x = 40; x + 2` finishes at `step 7 of 7` and `▶` there means
    // "record one more" — which for an `ended` leg is nothing at all. `restart` seeks to the oldest
    // retained frame, which is step 0 exactly until eviction has happened (`controlStrip`'s own note).
    clickLambda('↺')
    clickLambda('▶')
    clickLambda('▶')
    const seed = term()
    expect(step()).toContain('step 2 of')
    expect(seed).not.toBe('')

    // STAGE 2 — the fork. Everything up to the first reply is synchronous, so this is asserted
    // without a wait: the pane is on the scratchpad, says so, and has a selector to come back with.
    clickLambda('✎ fork')

    expect(heading()).toContain('[detached]')
    // §4.5's OTHER SURFACE, and the pairing is the point: the badge is the glanceable one and the
    // status line is the authoritative narration. `main.ts`'s `detachedPanes` reads the same
    // `SessionEntry.detached` the badge does, so the two cannot disagree.
    expect(statusLine()).toContain('λ pane detached')
    // The control is gone, because a pane already on the scratchpad has nothing to fork — and the
    // selector has arrived in its place, which is the affordance for the same intent that still works.
    expect(forkButton()).toBeNull()
    const select = selector()
    if (select === null) throw new Error('a second λ session should have produced a selector')
    expect([...select.options].map((o) => o.textContent)).toEqual(['source', 'λ scratchpad'])
    expect(select.value).toBe('lambda-scratch')
    // BEFORE ANY REPLY: the leg exists and has nothing in it yet, and the step readout says which of
    // those two it is. `controlState` renders `reason` while `!available`, which is what
    // `LambdaScratchpad` seeds the leg's status with rather than leaving it `''`.
    expect(step()).toBe('building…')
    expect(term()).toBe('')

    // STAGE 3 — the scratchpad reduces, on its own thread, from the term the pane was showing.
    //
    // **FIVE STEPS, NOT SEVEN, AND THAT NUMBER IS THE FORK.** The source session's λ leg is seven
    // β-steps end to end; this scratchpad was seeded at its step 2, so it has exactly the remaining
    // five to do. A fork that quietly re-ran the whole program — or one that showed the source's own
    // leg under a new name — would read `of 7` here. `doneText` appends nothing for `'ended'` and the
    // trailing `…` is `controls.ts`'s "more can still be recorded", so waiting for its absence is
    // waiting for the reduction to finish rather than for a frame to exist.
    await until(() => step().startsWith('step') && !step().endsWith('…'), 'the scratchpad to finish reducing')
    expect(step()).toBe('step 5 of 5')

    // And its step 0 is the term the pane was showing when the button was clicked — §4.3's "seeded
    // with that pane's current text", read back off the screen it was taken from.
    clickLambda('↺')
    expect(step()).toBe('step 0 of 5')
    expect(term()).toBe(seed)

    // STAGE 4 — recompile from source retires it. Synchronous on the keystroke: `schedule` retires
    // before it debounces the post, so the pane does not sit on a stale scratchpad for `DEBOUNCE_MS`
    // plus a compile.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 5' } })

    expect(heading()).toBe('lambda')
    expect(statusLine()).not.toContain('detached')
    // The selector is gone too, which is the registry having genuinely lost a session rather than the
    // pane having merely looked away — `bindingSelect` removes itself below two options.
    expect(selector()).toBeNull()

    await until(
      () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText().includes('45'),
      'the recompile',
    )
    // And the pane is showing the SOURCE session's newly recorded leg — at its frontier, with no
    // trailing `…`, which is a leg that ran to its end rather than the scratchpad's leftovers. The
    // fork control is back for the same reason it went away: this pane is attached again.
    expect(forkButton()).not.toBeNull()
    expect(step()).toMatch(/^step \d+ of \d+$/)
    expect(term()).not.toBe('')
  })
})
