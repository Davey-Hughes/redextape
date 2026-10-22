import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { bindingKey } from '../../src/view-header'
import {
  editorHost,
  forkButton,
  idle,
  lambdaHeading,
  lambdaTitle,
  pickBinding,
  SHELL,
  settled,
  titleOf,
  until,
} from './harness'

/**
 * **THE BINDING SELECTOR UNMOUNTS THE EDITOR TOO.** A pick of another session's λ item in the λ view's
 * title menu goes through `pane-host.ts`'s same-leg `rebind` arm, which takes a copy's editor off the
 * view, into custody, when the view leaves the copy. A rebind that left it there would drop the
 * `copy · not linked` badge and repaint the term from the newly-bound leg, but leave `.term-editor` in the
 * DOM holding the SCRATCH's editor while the body below showed the SOURCE's term, and typing in it would
 * produce no visible change anywhere, on either pane — the edit would land on a session that was not
 * on screen.
 *
 * DRIVEN THROUGH THE MOUNTED APP, NOT AGAINST A HAND-BUILT REGISTRY, because what would break is in the
 * WIRING between the title menu, `pane-host.ts`'s `rebind` and `LambdaPane`, not in any one of them
 * alone. This file forks through the real `.detach` control and rebinds through the real title menu, the
 * same path `scratch-app.test.ts`'s end-to-end test drives — the only new thing under test is what
 * `.term-editor` does across the SECOND leg of that path. That test comes home through this same control
 * but does not look at the editor: it asserts the badge, the binding and the source leg's frames, and a
 * `.term-editor` left mounted over the session the pane just left would pass every one of them — which
 * is the assertion this file exists for and the reason it is not folded into that one.
 */

/** Every pair `leaf`'s title menu offers, as keys — opens and closes the menu to read it. */
function offered(leaf: string): string[] {
  const title = titleOf(leaf)
  if (title === null) return []
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const keys = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b) => b.dataset.binding ?? '')
  menu?.hidePopover()
  return keys
}

let view: EditorView

/**
 * The λ item's key for the one scratch buffer the λ view's title menu offers — BY ELIMINATION, since the
 * source session is the only λ session whose id `main.ts` writes down.
 *
 * **NOT A LITERAL ID, AND THE MINTED ONE WOULD BE NO BETTER A CONSTANT.** 5d-ii-c decision 1 mints
 * `scratch-N` per fork and never reissues a retired name, and `main()` runs once per test FILE — so the
 * number a fork lands on is a function of every fork before it, including ones in tests that failed
 * early. Reading the key off the menu keeps the assertion an identity check against the DOM rather than an
 * agreement with a counter.
 */
const bufferKey = (): string => {
  const buffers = offered('lambda-0').filter((k) => k.startsWith('lambda:') && k !== bindingKey('lambda', 'source'))
  const only = buffers[0]
  if (buffers.length !== 1 || only === undefined) {
    throw new Error(`expected exactly one scratch buffer in the λ group, found ${buffers.length}`)
  }
  return only
}

// **BOTH DESTINATIONS**: the first test rebinds a copy's view to the program and the second from one copy
// to another, so this `describe` is the selector's editor behaviour on either.
describe('rebinding a forked λ pane through the binding selector', () => {
  // ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives: ES module imports are cached, so
  // `main()` runs once per page and Vitest gives each test FILE its own page.
  beforeAll(async () => {
    // WIDE ENOUGH FOR ITS ADDS: at the runner's default 414 px a view is 201 px wide, and the app refuses a split or a
    // `+ view` that leaves a view under `MIN_VIEW_PX` (`layout.ts`). The default's 896 px height is kept.
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(idle, 'the first compile')
  })

  it('removes .term-editor from the DOM — it does not merely drop the "copy · not linked" status', async () => {
    await settled(view, 'let x = 40; x + 2')

    const fork = forkButton()
    if (fork === null) throw new Error('the λ pane should offer a fork on a settled, attached pane')
    fork.click()
    expect(lambdaHeading()).toContain('copy · not linked')

    await until(() => editorHost() !== null, 'the editor to mount')
    // **THE WAIT IS THE ASSERTION**: an `expect` restating its predicate would be green on every run,
    // because `until` has already proved the one thing it checks.
    //
    // WHAT THE WAIT CANNOT SAY IS THAT ANYTHING LIVE IS UNDER THE HOST, and that is precisely what makes
    // this test's closing `expect(editorHost()).toBeNull()` mean something. `.term-editor` is a CLASS that
    // `setEditor` writes onto a host which always exists — `LambdaPane`'s own doc: "an empty class means
    // `.term-editor` selects nothing". So a bare classed host with no view inside would satisfy the wait
    // above AND the teardown below, and the file would still report the regression fixed while nothing
    // had ever been mounted or destroyed. `.cm-editor` IS the `EditorView`'s `dom`, which is how
    // `scratch-buffers.test.ts` reads the same fact, and `findFromDOM` returning null over a node that is
    // still in the document is exactly the "destroyed but left behind" state this cannot afford to miss.
    const mounted = editorHost()?.querySelector<HTMLElement>('.cm-editor') ?? null
    if (mounted === null) throw new Error('the fork left .term-editor on the pane with no CodeMirror in it')
    expect(EditorView.findFromDOM(mounted)).not.toBeNull()

    const title = lambdaTitle()
    // THE SELECTOR IS ON SCREEN FROM THE FIRST PAINT: the control lists `(leg, session)` pairs, and the
    // source session's three legs put it on screen before any fork. What the fork produced is the BUFFER's
    // item, which the `expect` below reads through `bufferKey`.
    if (title === null) throw new Error('the pane selector should be on screen from the first paint')
    // `bufferKey` throwing unless there is exactly one is the fork's own evidence: it produced a second
    // λ session, and one.
    expect(title.dataset.binding).toBe(bufferKey())

    // THE REBIND — through the real title menu, the same pick a user makes, not a direct call into
    // `slot.rebind`. The items carry `(leg, session)` PAIRS (`bindingKey`), and `main.ts`'s
    // `SOURCE_SESSION` is the literal string `'source'`.
    pickBinding('lambda-0', bindingKey('lambda', 'source'))

    // THE `copy · not linked` STATUS IS GONE AND THE SELECTOR AGREES. Neither of these two assertions is
    // what this test exists for — the one below is.
    expect(lambdaHeading()).toBe('λ · program')
    expect(title.dataset.binding).toBe(bindingKey('lambda', 'source'))
    // THE REGRESSION. Had the rebind left the scratch's editor on the view, this would stay non-null: the
    // editor still mounted, still listening, over a body now showing the source's term.
    expect(editorHost()).toBeNull()
  })

  /**
   * **AND A SCRATCH→SCRATCH REBIND HANDS THE EDITOR TO CUSTODY.** `setDetached` tears an editor down on
   * `!detached`, and BOTH SIDES of a scratch→scratch rebind are detached, so it does not fire there.
   * `reconcileEditors` skips the pane, because its inner loop opens
   * `if (p.slot.binding.session !== session) continue` and the pane no longer names the session whose
   * editor it is holding. Without the handover, the pane would render buffer B's frames with buffer A's
   * live CodeMirror mounted above them, permanently — the shape the test above exists to refuse, reached
   * by the rebind that test does not drive.
   *
   * SIX GESTURES, AND EVERY ONE IS NEEDED. A fork requires the pane to be ON source (a detached pane
   * offers no ✎), and rebinding to source takes the editor off the pane — so a second buffer cannot be
   * made from the pane that must keep holding the first one's editor. The split is what supplies a
   * second pane to make B from, which is also why this cannot be folded into the test above.
   */
  it('hands the editor to custody on a scratch→scratch rebind rather than leaving it over the wrong buffer', async () => {
    // 1. BACK TO A FORKABLE PANE. The test above left `lambda-0` on source with its buffer still live
    //    (nothing ends a buffer implicitly), which is exactly the state a fork needs.
    await settled(view, 'let y = 1; y + y')
    forkButton()?.click()
    await until(() => editorHost() !== null, "the first pane's editor to mount")
    const bufferA = lambdaTitle()?.dataset.binding ?? ''
    expect(bufferA).not.toBe(bindingKey('lambda', 'source'))

    // 2. A SECOND λ VIEW ON THE SAME BUFFER, through the real `⋯` menu's "another view of this" entry —
    //    the gesture `two-lambda-panes.test.ts` establishes. It arrives holding no editor: there is one
    //    `ScratchEditor` per buffer and `lambda-0` has it.
    const more = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-more')
    if (more === null) throw new Error('no view menu on the forked λ view')
    more.click()
    const menu = document.getElementById(more.getAttribute('aria-controls') ?? '')
    menu?.querySelector<HTMLButtonElement>('button.view-split[data-dir="row"]')?.click()
    const same = menu?.querySelector<HTMLButtonElement>('.view-menu-pairs button[data-same]') ?? null
    if (same === null) throw new Error('the split menu offers no "another view of this"')
    same.click()
    const second = [...document.querySelectorAll<HTMLElement>('[data-kind="lambda"]')]
      .map((e) => e.dataset.leaf ?? '')
      .find((l) => l !== 'lambda-0')
    if (second === undefined) throw new Error('the split produced no second λ pane')

    // 3. THE SECOND PANE MAKES BUFFER B — home to source first, because a detached pane offers no ✎.
    pickBinding(`${second}`, bindingKey('lambda', 'source'))
    const secondFork = document.querySelector<HTMLButtonElement>(`[data-leaf="${second}"] button.detach`)
    if (secondFork === null) throw new Error('the second pane should offer a fork once it is back on source')
    secondFork.click()
    await until(() => document.querySelector(`[data-leaf="${second}"] .term-editor`) !== null, "B's editor to mount")
    const bufferB = titleOf(second)?.dataset.binding ?? ''
    expect(bufferB).not.toBe(bufferA)
    // AND `lambda-0` STILL HOLDS A's EDITOR — asserted, because everything below is about what happens
    // to this exact view and a test that had already lost it would pass vacuously.
    expect(editorHost()).not.toBeNull()

    // 4. THE GESTURE. `lambda-0` goes from buffer A straight to buffer B: detached on both sides, which
    //    is the whole of why `setDetached`'s teardown does not fire.
    const first = lambdaTitle()
    if (first === null) throw new Error('no title-selector on the first λ view')
    pickBinding('lambda-0', bufferB)

    // THE REGRESSION. Without the handover this would stay non-null: buffer A's live CodeMirror, mounted
    // over buffer B's frames.
    expect(editorHost()).toBeNull()
    expect(lambdaTitle()?.dataset.binding).toBe(bufferB)
    // **AND THE NODE IS GONE, NOT MERELY THE CLASS.** `editorHost()` reads `.term-editor`, which is a class
    // on the pane's editor HOST: a `takeEditor` that stripped it and left `editor.dom` parented underneath
    // would leave the view visible and `contenteditable` in a pane bound to another buffer, and a keystroke
    // in it would still reach `recompile`. So the assertion is about the node the user can click rather
    // than about the wrapper's styling.
    expect(document.querySelectorAll('[data-leaf="lambda-0"] .cm-editor')).toHaveLength(0)

    // 5. AND THE VIEW WAS HELD, NOT DESTROYED — the half that makes `hold` the right verb rather than
    //    `destroy`. Rebinding back to A leaves the pane detached with no editor, which is precisely the
    //    state deferred-a11y item 11's control exists for: `hasEditor(A)` is true because custody has
    //    it, so the control is offered, and clicking it runs the sweep that mounts the SAME view here.
    pickBinding('lambda-0', bufferA)
    expect(editorHost()).toBeNull()
    const claim = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.claim-editor')
    expect(claim).not.toBeNull()
    claim?.click()
    await until(() => editorHost() !== null, "A's editor to come back out of custody")
  })
})
