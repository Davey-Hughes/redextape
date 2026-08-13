import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'

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
 * that path.
 *
 * **THAT SENTENCE USED TO END "which that test never takes: it recompiles its way home rather than
 * using the selector", AND IT NO LONGER CAN.** 5d-ii-c decision 2 stopped a recompile from ending a
 * buffer, so that test's own STAGE 5 comes home through this same control. What it still does not do
 * is look at the editor: it asserts the badge, the binding and the source leg's frames, and a
 * `.term-editor` left mounted over the session the pane just left would pass every one of them —
 * which is the assertion this file exists for and the reason it is not folded into that one.
 */

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <button type="button" id="buffers">buffers</button>
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
/**
 * The λ `<option>` for the one scratch buffer the λ pane's selector offers — BY ELIMINATION, since the
 * source session is the only λ session whose id `main.ts` writes down.
 *
 * **THIS REPLACES A LITERAL `'lambda-scratch'`, AND THE MINTED ID WOULD BE NO BETTER A CONSTANT.**
 * 5d-ii-c decision 1 mints `scratch-N` per fork and never reissues a retired name, and `main()` runs
 * once per test FILE — so the number a fork lands on is a function of every fork before it, including
 * ones in tests that failed early. Reading the option keeps the assertion an identity check against the
 * DOM rather than an agreement with a counter.
 */
const bufferOption = (): HTMLOptionElement => {
  const buffers = [
    ...document.querySelectorAll<HTMLOptionElement>('[data-leaf="lambda-0"] .pane-binding optgroup[label="λ"] option'),
  ].filter((o) => o.textContent !== 'source')
  const only = buffers[0]
  if (buffers.length !== 1 || only === undefined) {
    throw new Error(`expected exactly one scratch buffer in the λ group, found ${buffers.length}`)
  }
  return only
}
const editor = () => document.querySelector('[data-leaf="lambda-0"] .term-editor')

/** `scratch-app.test.ts`'s own `settled`, and the same invariant argument applies — see its doc there. */
async function settled(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(
    () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== '',
    `the app to settle on \`${src}\``,
  )
}

// **THE NAME LOST "back to source", WHICH IS THE WHOLE OF WHAT THE SECOND TEST ADDS.** This `describe`
// read "rebinding a forked λ pane back to source through the binding selector", and two doc comments in
// `src/` cited this file as the proof that a rebind takes the editor down — reading the narrow name as
// the general claim. It is the selector's editor behaviour on BOTH destinations now.
describe('rebinding a forked λ pane through the binding selector', () => {
  // ONE MOUNT FOR THE FILE, `scratch-app.test.ts`'s own reason: ES module imports are cached, so
  // `main()` runs once per page and Vitest gives each test FILE its own page.
  beforeAll(async () => {
    // THE LAYOUT KEY IS SHARED ACROSS THE WHOLE BROWSER TIER — every test file gets its own page but
    // the same origin, so a file that persists a tree leaves it for whichever file mounts next.
    // `main()` reads this key ONCE, while resolving `let tree`, so it has to be cleared before the
    // import below and not in a `beforeEach`. `scratch-buffers.test.ts` is where the argument lives:
    // it is the file that first stored a tree with one of `defaultLayout()`'s own leaves missing, and
    // this file's `[data-leaf="lambda-0"]` lookups all answered `null` under it.
    localStorage.removeItem(LAYOUT_STORAGE_KEY)
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
    // any fork. What the fork produced is the BUFFER's option, which is what the next line reads.
    if (select === null) throw new Error('the pane selector should be on screen from the first paint')
    // WAS `optionValue('lambda', 'lambda-scratch')` — see `bufferOption` for why that constant is gone
    // and why the minted id does not replace it. `bufferOption` throwing unless there is exactly one is
    // the other half of what this line used to say: the fork produced a second λ session, and one.
    expect(select.value).toBe(bufferOption().value)

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

  /**
   * **AND THE TEARDOWN ABOVE COVERS ONLY THE REBIND TO SOURCE — Important finding, review of the
   * deferred-a11y item 11/12 fix, and the defect is this file's own subject one buffer over.**
   *
   * `setDetached` tears an editor down on `!detached`, and BOTH SIDES of a scratch→scratch rebind are
   * detached, so it never fires. `reconcileEditors` then skips the pane, because its inner loop opens
   * `if (p.slot.binding.session !== session) continue` and the pane no longer names the session whose
   * editor it is holding. And the custody pass never sees the view, because nothing handed it over. So
   * the pane rendered buffer B's frames with buffer A's live CodeMirror mounted above them,
   * permanently — the exact shape the test above exists to refuse, reached by the one rebind that test
   * does not drive. **Two doc comments named this file as the proof that the state was impossible.**
   *
   * IT IS WORSE THAN THE ORIGINAL, because `transport.ts`'s `editScratch` reads `slot.binding.session`
   * at EDIT time rather than closing over it: a keystroke in the stale editor called
   * `recompile(B, <A's text>)`, and the reply overwrote whichever pane was showing B. The first test's
   * defect typed into a session that was not on screen; this one typed OVER one that was.
   *
   * **DECISION 1 IS WHAT MADE THE GESTURE REACHABLE.** While there was one scratch id, "rebound away
   * from the scratch" and "rebound to source" were the same sentence, and the teardown that handles the
   * second was a complete answer to the first. Plural buffers separated them.
   *
   * SIX GESTURES, AND EVERY ONE IS NEEDED. A fork requires the pane to be ON source (a detached pane
   * offers no ✎), and rebinding to source is what destroys the editor — so a second buffer cannot be
   * made from the pane that must keep holding the first one's editor. The split is what supplies a
   * second pane to make B from, which is also why this cannot be folded into the test above.
   */
  it('hands the editor to custody on a scratch→scratch rebind rather than leaving it over the wrong buffer', async () => {
    // 1. BACK TO A FORKABLE PANE. The test above left `lambda-0` on source with its buffer still live
    //    (nothing ends a buffer implicitly), which is exactly the state a fork needs.
    await settled('let y = 1; y + y')
    const p = () => document.querySelector<HTMLSelectElement>('[data-leaf="lambda-0"] .pane-binding select')
    forkButton()?.click()
    await until(() => editor() !== null, "the first pane's editor to mount")
    const bufferA = p()?.value ?? ''
    expect(bufferA).not.toBe(optionValue('lambda', 'source'))

    // 2. A SECOND λ PANE ON THE SAME BUFFER, through the real split picker's `(same)` entry — the
    //    gesture `two-lambda-panes.test.ts` establishes. It arrives holding no editor: there is one
    //    `LambdaEditor` per buffer and `lambda-0` has it.
    const split = document.querySelector<HTMLButtonElement>(
      '[data-leaf="lambda-0"] button[aria-label="split left and right"]',
    )
    if (split === null) throw new Error('no split control on the forked λ pane')
    split.click()
    const menu = document.getElementById(split.getAttribute('aria-controls') ?? '')
    const same = menu?.querySelector<HTMLButtonElement>('button') ?? null
    if (same === null || !(same.textContent ?? '').endsWith('(same)')) {
      throw new Error(`the split menu does not start with the duplicate case: ${same?.textContent}`)
    }
    same.click()
    const second = [...document.querySelectorAll<HTMLElement>('[data-kind="lambda"]')]
      .map((e) => e.dataset.leaf ?? '')
      .find((l) => l !== 'lambda-0')
    if (second === undefined) throw new Error('the split produced no second λ pane')

    // 3. THE SECOND PANE MAKES BUFFER B — home to source first, because a detached pane offers no ✎.
    const secondSelect = document.querySelector<HTMLSelectElement>(`[data-leaf="${second}"] .pane-binding select`)
    if (secondSelect === null) throw new Error('no binding selector on the second λ pane')
    secondSelect.value = optionValue('lambda', 'source')
    secondSelect.dispatchEvent(new Event('change', { bubbles: true }))
    const secondFork = document.querySelector<HTMLButtonElement>(`[data-leaf="${second}"] .controls .detach`)
    if (secondFork === null) throw new Error('the second pane should offer a fork once it is back on source')
    secondFork.click()
    await until(() => document.querySelector(`[data-leaf="${second}"] .term-editor`) !== null, "B's editor to mount")
    const bufferB = secondSelect.value
    expect(bufferB).not.toBe(bufferA)
    // AND `lambda-0` STILL HOLDS A's EDITOR — asserted, because everything below is about what happens
    // to this exact view and a test that had already lost it would pass vacuously.
    expect(editor()).not.toBeNull()

    // 4. THE GESTURE. `lambda-0` goes from buffer A straight to buffer B: detached on both sides, which
    //    is the whole of why the teardown the first test pins does not fire.
    const first = p()
    if (first === null) throw new Error('no binding selector on the first λ pane')
    first.value = bufferB
    first.dispatchEvent(new Event('change', { bubbles: true }))

    // THE REGRESSION. Without the handover this stayed non-null: buffer A's live CodeMirror, mounted
    // over buffer B's frames, with `editScratch` ready to route its keystrokes to B.
    expect(editor()).toBeNull()
    expect(first.value).toBe(bufferB)
    // **AND THE NODE IS GONE, NOT MERELY THE CLASS — this line is the one the fix's first version
    // passed while still shipping the defect.** `editor()` reads `.term-editor`, which is a class on the
    // pane's editor HOST; `takeEditor` stripped it and left `editor.dom` parented underneath, so the
    // view stayed visible and `contenteditable` in a pane bound to another buffer, and a keystroke in
    // it still reached `recompile` — painting a parse error on a different pane's editor. Found by
    // driving the app in Chromium, not by this file, which is exactly why the assertion is now about
    // the node the user can click rather than about the wrapper's styling.
    expect(document.querySelectorAll('[data-leaf="lambda-0"] .cm-editor')).toHaveLength(0)

    // 5. AND THE VIEW WAS HELD, NOT DESTROYED — the half that makes `hold` the right verb rather than
    //    `destroy`. Rebinding back to A leaves the pane detached with no editor, which is precisely the
    //    state deferred-a11y item 11's control exists for: `hasEditor(A)` is true because custody has
    //    it, so the control is offered, and clicking it runs the sweep that mounts the SAME view here.
    first.value = bufferA
    first.dispatchEvent(new Event('change', { bubbles: true }))
    expect(editor()).toBeNull()
    const claim = document.querySelector<HTMLButtonElement>(
      '[data-leaf="lambda-0"] button[aria-label="bring the term editor to this pane"]',
    )
    expect(claim).not.toBeNull()
    claim?.click()
    await until(() => editor() !== null, "A's editor to come back out of custody")
  })
})
