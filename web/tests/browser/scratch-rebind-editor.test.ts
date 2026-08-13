import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * **THE BINDING SELECTOR UNMOUNTS THE EDITOR TOO — regression for the Important finding from the
 * whole-branch review before merge.** `LambdaPane.setEditor` used to be reachable from exactly two
 * places in `main.ts`: the scratch's first build (`scratch-compiled`) and recompile-from-source's
 * retire branch. `PaneSlot.render` — the per-frame call that drives `setDetached`, and the one call
 * site that actually runs when a user picks a DIFFERENT session in the λ pane's own binding selector —
 * was not one of them. So rebinding away from a scratch through that control dropped the `[detached]`
 * badge and repainted the term from the newly-bound leg, but left `.term-editor` in the DOM holding the
 * SCRATCH's editor while the body below showed the SOURCE's term. Typing in it produced no visible
 * change anywhere, on either pane — the edit landed on a session that was not on screen.
 *
 * DRIVEN THROUGH THE MOUNTED APP, NOT AGAINST A HAND-BUILT REGISTRY, because the defect is in the
 * WIRING between `PaneSlot.render` and `LambdaPane`, not in either alone. `binding-selector.test.ts`'s
 * hand-built harness calls `paint` (`slot.render` then nothing else) the same way `main.ts`'s `draw()`
 * does — it would have caught this too, had any of its cases forked an editor first, but none of them
 * builds a `LambdaScratch` with a real editor behind it (T7's own doc: this app's one λ pane is what
 * makes that state unreachable without a real fork). This file forks through the real `.detach`
 * control and rebinds through the real `<select>`, the same path `scratch-app.test.ts`'s end-to-end
 * test drives — the only new thing under test is what `.term-editor` does across the SECOND leg of
 * that path, which that test never takes: it recompiles its way home rather than using the selector.
 */

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

let view: EditorView

async function until(predicate: () => boolean, what: string, timeoutMs = 60_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const resultsText = () => document.querySelector('#results')?.textContent ?? ''
const heading = () => document.querySelector('[data-leaf="lambda-0"] h2')?.textContent ?? ''
const forkButton = () => document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')
const selector = () => document.querySelector<HTMLSelectElement>('[data-leaf="lambda-0"] .pane-binding select')
/**
 * The `<option>` value the pane selector encodes a `(leg, session)` pair as — spelled out here rather
 * than imported from `pane-chrome.ts`, so this pins the DOM contract instead of agreeing with whatever
 * the control currently does. `\x00` as an escape is `scripts/check-text-bytes.sh`'s rule.
 */
const optionValue = (leg: string, id: string) => `${leg}\x00${id}`
const editor = () => document.querySelector('[data-leaf="lambda-0"] .term-editor')

/** `scratch-app.test.ts`'s own `settled`, and the same invariant argument applies — see its doc there. */
async function settled(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(
    () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== '',
    `the app to settle on \`${src}\``,
  )
}

describe('rebinding a forked λ pane back to source through the binding selector', () => {
  // ONE MOUNT FOR THE FILE, `scratch-app.test.ts`'s own reason: ES module imports are cached, so
  // `main()` runs once per page and Vitest gives each test FILE its own page.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(
      () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== '',
      'the first compile',
    )
  })

  it('removes .term-editor from the DOM — it does not merely drop the [detached] badge', async () => {
    await settled('let x = 40; x + 2')

    const fork = forkButton()
    if (fork === null) throw new Error('the λ pane should offer a fork on a settled, attached pane')
    fork.click()
    expect(heading()).toContain('[detached]')

    await until(() => editor() !== null, 'the editor to mount')
    expect(editor()).not.toBeNull()

    const select = selector()
    // NOT "a second λ session should have produced a selector", which this message used to say: the
    // control lists `(leg, session)` pairs, and the source session's two legs put it on screen before
    // any fork. What the fork produced is the λ scratchpad OPTION, which is what the next line reads.
    if (select === null) throw new Error('the pane selector should be on screen from the first paint')
    expect(select.value).toBe(optionValue('lambda', 'lambda-scratch'))

    // THE REBIND — through the real `<select>`, the same `change` event `main.ts` listens for, not a
    // direct call into `slot.rebind`. `paneSelect`'s own option values are `(leg, session)` PAIRS —
    // they were bare `SessionId`s until the control was widened to both axes, which is why this goes
    // through `optionValue` rather than the literal id — and `main.ts`'s `SOURCE_SESSION` is the
    // literal string `'source'`.
    select.value = optionValue('lambda', 'source')
    select.dispatchEvent(new Event('change'))

    // THE OLD SURFACES STILL PASS: the badge is gone and the selector agrees. Neither of these two
    // assertions is what this test exists for — the one below is.
    expect(heading()).toBe('lambda')
    expect(select.value).toBe(optionValue('lambda', 'source'))
    // THE REGRESSION. Without `LambdaPane.setDetached`'s teardown, this stayed non-null: the scratch's
    // editor, still mounted, still listening, over a body now showing the source's term.
    expect(editor()).toBeNull()
  })
})
