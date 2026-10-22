import { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, leaves } from '../../src/layout'
import { bindingKey } from '../../src/view-header'
import { parseWorkspace } from '../../src/workspace'
import {
  editorsInLeaf,
  fourViews,
  lambdaLeaves,
  leafIds,
  pickBinding,
  resetToFourViews,
  SHELL,
  splitSame,
  stateIdle,
  termOf,
  titleOf,
  tmStepText,
  until,
} from './harness'
import { lambdaSettled } from './lambda-text'

/**
 * TWO λ PANES ON TWO λ SESSIONS, THROUGH THE APP. `view-title.test.ts` asserts the resolution and the
 * rendering, on a registry it builds by hand; this file asserts that a user can GET there, which is the
 * property the layout tree adds.
 *
 * THE PAGE IS BUILT FROM `SHELL` AND `main` IS IMPORTED DYNAMICALLY, as in `layout-app.test.ts`, whose
 * own doc has why a bare top-level `import { ready }` cannot work: Vitest's browser mode serves its own
 * tester HTML, not this project's `index.html`, so `main()`'s mount-point check has nothing to find
 * unless something builds the page first, and ES module imports are linked and evaluated before any of a
 * file's own top-level code runs.
 */

const btn = (leaf: string, label: string) =>
  document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button[aria-label="${label}"]`)
/**
 * `leaf`'s pair in force, read off its title as an object with a live `value`, so every read below
 * stays one expression. A pick goes through `pickBinding`.
 */
const bindingOf = (leaf: string) =>
  titleOf(leaf) === null
    ? null
    : {
        get value() {
          return titleOf(leaf)?.dataset.binding ?? ''
        },
      }
/** Every item `leaf`'s title menu offers, as `{ value, textContent }` — opens and closes the menu to read it. */
function itemsOf(leaf: string): { value: string; textContent: string }[] {
  const title = titleOf(leaf)
  if (title === null) return []
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const items = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b) => ({
    value: b.dataset.binding ?? '',
    textContent: b.textContent ?? '',
  }))
  menu?.hidePopover()
  return items
}
/**
 * The labels of the title menu's λ items on `leaf` — WHICH SESSIONS OFFER A λ LEG. The menu lists
 * every leg, so an unfiltered list would mix the source session's asm and TM legs into every count;
 * filtering by key is what keeps an assertion about the λ sessions about λ.
 */
const lambdaLabelsOf = (leaf: string) =>
  itemsOf(leaf)
    .filter((i) => i.value.startsWith('lambda:'))
    .map((i) => i.textContent)
/**
 * The λ item for the buffer `leaf` IS BOUND TO RIGHT NOW — which is how the tests below name the buffer
 * they just forked.
 *
 * **THE ID IS NOT WRITABLE DOWN, AND PINNING THE MINTED ONE WOULD BE A MISTAKE.** A fork mints `scratch-N`
 * and never reissues a retired name, and `main()` runs once per test FILE — so the number a given fork
 * lands on is a function of how many forks every test before it performed, including the ones that abort
 * early. A test that hard-codes `scratch-3` passes until an unrelated test above it gains a fork.
 *
 * **IT DOES NOT IDENTIFY THE BUFFER BY ELIMINATION**, as "the λ item that is not `source`": several of the
 * tests below fork twice within one test, so "exactly one λ item that is not `source`" is false inside a
 * test, and a rule that holds at the top of every test is the kind that fails the day someone forks again.
 * The pane's OWN BINDING is the fact the callers need: the buffer they just forked is the session the
 * forking pane is showing, whatever else is live beside it.
 *
 * IT REFUSES A PANE THAT IS ON `source`, because the callers only ever ask this of a pane that has just
 * forked — returning the source item there would make every assertion after it describe the wrong session.
 */
const boundBufferItemOf = (leaf: string): { value: string; textContent: string } => {
  const bound = titleOf(leaf)?.dataset.binding
  if (bound === undefined) throw new Error(`no title-selector on [data-leaf="${leaf}"]`)
  if (bound === bindingKey('lambda', 'source')) {
    throw new Error(`[data-leaf="${leaf}"] is bound to the source session, not to a buffer`)
  }
  const item = itemsOf(leaf).find((i) => i.value.startsWith('lambda:') && i.value === bound)
  if (item === undefined) throw new Error(`${leaf}'s λ items hold none for \`${bound}\``)
  return item
}
/**
 * Type `text` into the term editor mounted on `leaf`, replacing whatever is in it.
 *
 * A REAL CodeMirror TRANSACTION THROUGH `EditorView.findFromDOM`, which is `editor-view-fixture.ts`'s
 * `typeIn`: setting `.textContent` and firing a synthetic `InputEvent` never reaches CodeMirror's
 * `docChanged` update listener — CodeMirror owns its DOM and does not read it back — so it is dead code
 * that fires no recompile at all. `ScratchEditor#setText` is no substitute either: it raises a
 * `#seeding` flag for the duration of its dispatch so a fork's seed is never mistaken for a keystroke,
 * which suppresses exactly the recompile a caller here is asking for — `scratch-edit.test.ts`'s file
 * doc states that argument.
 *
 * IT REFUSES A PANE WITH NO EDITOR RATHER THAN RETURNING, because a caller's next `until` would
 * otherwise wait out its whole timeout on a keystroke that was never delivered.
 */
const typeInto = (leaf: string, text: string): void => {
  const host = document.querySelector<HTMLElement>(`[data-leaf="${leaf}"] .cm-content`)
  if (host === null) throw new Error(`[data-leaf="${leaf}"] has no editor to type into`)
  const editor = EditorView.findFromDOM(host)
  if (editor === null) throw new Error(`no CodeMirror view mounted under [data-leaf="${leaf}"]`)
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } })
}
/**
 * Retire every buffer on the page, through the header list — the app's own retire, one row at a time.
 *
 * **THE RESET NEEDS THIS BECAUSE THE APP REFUSES A FORK WHILE `MAX_WARM_BUFFERS` OF THEM ARE LIVE**
 * (`scratch.ts`, 5d-ii-d design §4.4/§4.6's measured cap), and this file performs more forks across the
 * one page it mounts than the cap admits — every one of them outliving its test unless something here
 * ends it. It is a loop rather than a sweep, because the app offers no sweep: `ScratchBuffers.retire`
 * takes the buffer it ends and there is deliberately no call that ends them all (nothing ends a buffer
 * implicitly). Driving the rows one at a time is therefore not a roundabout way of doing something
 * simpler; it is the only gesture that exists.
 *
 * THE LIST IS RE-OPENED PER ROW, WHICH IS `buffer-list.ts`'s CONTRACT RATHER THAN A RETRY. Rows are
 * built on `beforetoggle` and rebuilt around every delete (`handleDelete`), and the list closes
 * altogether when the last row goes — so the buttons this loop just walked are gone by the time the
 * delete returns, whichever of the two happened; the row count read fresh on each reopen is
 * the loop's condition for exactly that reason — a closed list keeps whatever it last rendered, and
 * the count is a structural fact about the menu (`.buffer-list .buffer-row`) rather than a string a
 * label is free to reword.
 */
const retireEveryBuffer = (): void => {
  const button = document.querySelector<HTMLButtonElement>('#buffers')
  if (button === null) throw new Error('no #buffers control in the header')
  for (let guard = 0; ; guard++) {
    if (guard > 32) throw new Error('the buffer list will not empty after 32 retires')
    if (button.getAttribute('aria-expanded') !== 'true') button.click()
    if (document.querySelectorAll('.buffer-list .buffer-row').length === 0) break
    const row = document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label^="delete "]')
    if (row === null) throw new Error('the open list has rows but no retire control on any of them')
    row.click()
  }
}
/** The TM pane's own transport strip — the δ leg has a play head independent of λ's. */
const tmClick = (glyph: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="tm-0"] .controls button')]
    .find((b) => b.textContent === glyph)
    ?.click()

// ONE MOUNT FOR THE FILE: ES module imports are cached, so `main()` runs once per page and Vitest gives
// each test FILE its own page. Storage needs no clearing before the mount: each browser test file gets
// its own in-memory `Storage`, installed in `tests/browser/setup.ts` before this file's own module body
// runs; see that file's doc for why.
//
// WAITS FOR THE FIRST COMPILE TO SETTLE: a fork click while `main()`'s own start-up compile is still
// mid-flight (`results.dataset.state === 'running'`) finds `linkWiring.index` still `null`, and
// `transport.ts`'s `detach` handler silently declines (`if (wiring.index === null || ...) return`) — the
// click does nothing, and nothing else in a test waits or retries, so it would time out waiting for an
// editor that was never asked for. `scratch-app.test.ts`'s own `beforeAll` waits for the first compile
// too, before its first fork.
let view: EditorView

beforeAll(async () => {
  // WIDE ENOUGH FOR ITS ADDS: at the runner's default 414 px a view is 201 px wide, and the app refuses a split or a
  // `+ view` that leaves a view under `MIN_VIEW_PX` (`layout.ts`). The default's 896 px height is kept.
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(stateIdle)
})

/**
 * RESET TO A CLEAN BASELINE BEFORE EVERY TEST, NOT ONLY `localStorage`. Every test below forks, splits
 * and rebinds panes on the ONE app this file mounts, so a test that assumes "exactly one λ leaf" or "this
 * pane is attached" is assuming state only the FIRST test in the file actually starts in. Three facts
 * drift independently, so three are undone independently: the TREE shape, through `resetToFourViews`;
 * each surviving λ pane's BINDING, through its own selector; and the source PROGRAM, through a dispatch
 * on `view`.
 *
 * **THE BINDING IS PUT BACK BY ITS OWN GESTURE, NOT AS A SIDE EFFECT OF THE PROGRAM'S.** A source keystroke
 * ends no buffer (5d-ii-c design §4.3's table), so a λ pane a test left on a buffer stays
 * `copy · not linked`, holding that buffer's editor and offering no fork control at all — under which the
 * next test's `?.click()` on `button.detach` would be a silent no-op and its first `until` would wait on an
 * editor that was already there. Rebinding through the selector is the gesture that means "put this pane
 * back on the source session".
 *
 * **NO λ VIEW SURVIVES THE RESET**: *reset preset* leaves the source beside the TM view, and
 * `resetToFourViews`' λ toggle builds `lambda-0` again, on the program. The loop below finds it there and
 * skips it.
 *
 * **THE BUFFERS ARE RECLAIMED TOO, BECAUSE OF `scratch.ts`'s CAP** (`MAX_WARM_BUFFERS`, 5d-ii-d design
 * §4.4/§4.6's measured figure): this file forks more times on the one page it mounts than the cap admits, so
 * without the reclamation below the fork past it would be refused and the refusal would reach the click
 * handler as a throw. The accumulation is incidental to every claim here but the last test's, which asserts
 * the λ group whole; no other test counts the λ group.
 *
 * A page that has forked before differs from a fresh one in the TREE, the BINDINGS and the PROGRAM — all
 * three of which this block restores by hand and none of which a retire touches once the panes are home.
 * What a leftover buffer adds beyond those is an extra entry in every selector and an extra worker.
 *
 * `resetToFourViews` FIRST, THEN THE REBIND, THEN THE RETIRE. The reset drops the extra leaves a split
 * left behind, so the loop below only ever has the four views' panes to put back — and a pane the
 * reset re-minted is already on `source` (`pane-host.ts`'s creation loop), so it is skipped rather than
 * rebound twice. The retire goes LAST of the three because by then every buffer is an orphan: no pane
 * is on one, so `ScratchBuffers.retire` moves nothing, and the reclamation cannot be the thing that put
 * a pane back on `source`. (It does destroy any editor the previous test left in custody, which is the
 * point — that editor belongs to a buffer that is ending.)
 */
beforeEach(async () => {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
  await resetToFourViews()
  for (const leaf of lambdaLeaves()) {
    const binding = bindingOf(leaf)
    if (binding === null || binding.value === bindingKey('lambda', 'source')) continue
    pickBinding(leaf, bindingKey('lambda', 'source'))
  }
  retireEveryBuffer()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(
    () =>
      document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
      // ALL FOUR VIEWS: source, λ, asm and TM.
      leafIds().length === 4 &&
      lambdaLeaves().length === 1 &&
      // THE λ PANE IS ATTACHED AGAIN, which is the precondition a test's first fork click depends on.
      // `button.detach` is offered only on a pane that is not `#detached`.
      document.querySelector('[data-leaf="lambda-0"] button.detach') !== null,
  )
})

describe('two λ panes on two λ sessions', () => {
  it('renders two different terms at the same time, reached entirely through the UI', async () => {
    // 1. Fork the source-derived λ pane into a scratch. `button.detach`, NOT an `aria-label`: the
    // item reads *edit a copy*, and `view-header.ts`'s `item` composes its accessible name from that
    // label plus the second line ("edit a copy the term at this step"), so no spelling of "fork" is
    // in it. `harness.ts`'s `forkButton` uses this exact selector.
    const fork = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')
    fork?.click()
    await until(() => document.querySelectorAll('[data-leaf="lambda-0"] .term-editor').length > 0)

    // 2. Split it.
    splitSame('lambda-0', 'row')
    await until(() => lambdaLeaves().length === 2)
    const [first, second] = lambdaLeaves()

    // 3. Point the new pane back at the source session.
    const binding = bindingOf(second ?? '')
    if (binding === null || binding === undefined) throw new Error('the split pane has no binding selector')
    pickBinding(second ?? '', bindingKey('lambda', 'source'))

    // **WAIT FOR BOTH PANES TO SETTLE BEFORE TAKING THE SNAPSHOT BELOW, OR THE SNAPSHOT RACES THEM.** Step 4
    // snapshots each pane and then waits for the scratch pane to CHANGE. Nothing above waited for either pane's
    // term: step 1's wait fires when the editor exists and step 2's when the pane count is 2, and the rebind in
    // step 3 is followed by nothing at all. On a fast machine both panes have settled anyway, so the snapshot is
    // the finished term and the only later change is the edit. On a slow runner the scratch pane can still be
    // empty when snapshotted, so the seed rendering afterwards would satisfy the wait before the edit's
    // recompile did, and the `u v` assertion below would receive the seed's Church numeral. The scratch pane
    // reads empty straight after the fork click and holds its full term once settled.
    //
    // Each conjunct is the only false one in some state. The scratch pane being non-empty is the only false
    // one in the race above. The split pane being non-empty keeps a mid-rebind empty render from passing,
    // which would race the source-pane assertion below the same way. Text rather than the fork control the
    // other rebinds in this file wait for, because what the snapshot needs settled is the TERM.
    // BOTH NON-EMPTY, AND NOT YET DIFFERENT. The copy is forked from the program's step 0, where a run opens
    // (`History`), so before the edit both views show one term. The edit below is what makes the two
    // sessions' terms differ.
    await lambdaSettled(first ?? '')
    await lambdaSettled(second ?? '')
    await until(() => termOf(first ?? '') !== '' && termOf(second ?? '') !== '')

    // 4. Edit the scratch so the two sessions genuinely differ — `typeInto`, a REAL CodeMirror
    // transaction through `EditorView.findFromDOM`; its own doc has why setting `.textContent` would
    // not do.
    const beforeEditFirst = termOf(first ?? '')
    const beforeEditSecond = termOf(second ?? '')
    // THE MARKER IS NOT IN THE SEED, ASSERTED RATHER THAN REASONED — see the assertion below for what
    // this is protecting.
    expect(beforeEditFirst).not.toContain('u v')
    typeInto(first ?? '', 'λu.λv. u v')

    await until(() => termOf(first ?? '') !== beforeEditFirst && termOf(first ?? '') !== '')

    // THE STRUCTURAL HALF OF THIS DESCRIBE'S OWN NAME: the two panes are on two SESSIONS at the moment
    // of the edit. `splitSame` duplicates a pane ON ITS OWN SESSION, so both panes leave step 2 bound to
    // the buffer, and step 3's one pick is what is supposed to move exactly one of them. Had it moved
    // both, `typeInto` would have landed the keystroke on an editor over the SOURCE session — voiding
    // the premise of every assertion below — and the wait above would still have fired, on the re-render
    // that followed.
    expect(bindingOf(first ?? '')?.value).not.toBe(bindingKey('lambda', 'source'))
    expect(bindingOf(second ?? '')?.value).toBe(bindingKey('lambda', 'source'))
    // **AND THE MARKER IS SEED-FREE.** The buffer is seeded from `beforeEach`'s `let x = 40; x + 2`,
    // whose λ term is a Church numeral over `f` and `x0`, and `u`/`v` occur in no Church numeral over
    // `f` and `x0`, so this tells "the pane shows what I typed" from "the pane showed some other frame
    // of the same numeral". The last test in this file has the long form of the argument.
    expect(termOf(first ?? '')).toContain('u v')
    // The source-bound pane is unaffected by an edit to the scratch's own buffer.
    expect(termOf(second ?? '')).toBe(beforeEditSecond)

    // NOT THE WAIT RESTATED: `second` never appears in that wait, and `beforeEditSecond` could itself be
    // `''`, which is the reading of "they differ" this rules out.
    expect(termOf(first ?? '')).not.toBe(termOf(second ?? ''))
    expect(termOf(second ?? '')).not.toBe('')
  })

  it('moves the one editor rather than mounting a second', async () => {
    // `button.detach`, NOT an `aria-label`: the item reads *edit a copy*, and `view-header.ts`'s
    // `item` composes its accessible name from that label plus the second line ("edit a copy the
    // term at this step"), so no spelling of "fork" is in it. `harness.ts`'s `forkButton` uses this
    // exact selector.
    const fork = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')
    fork?.click()
    await until(() => document.querySelectorAll('.cm-editor').length > 1)

    splitSame('lambda-0', 'row')
    await until(() => lambdaLeaves().length === 2)
    const [first, second] = lambdaLeaves()

    // Both panes are on the scratch; only one holds the editor.
    expect(editorsInLeaf(first ?? '')).toBe(1)
    expect(editorsInLeaf(second ?? '')).toBe(0)

    // THE SAME `EditorView` INSTANCE, CAPTURED BEFORE THE MOVE — `EditorView.findFromDOM`, the same
    // technique `editor-view-fixture.ts`'s `typeIn` documents. A node count alone (the assertions
    // above and below) cannot tell "the editor moved" from "a new editor was built with the same
    // text": destroying the old view and constructing a fresh one seeded with its text produces the
    // identical `.cm-editor` counts at every step. `toBe`, not `toEqual`, is what a rebuild fails —
    // two different `EditorView` objects can `toEqual` on their printed state and still be two
    // different instances with two different (in a rebuild's case, freshly reset) cursors.
    const hostBefore = document.querySelector<HTMLElement>(`[data-leaf="${first}"] .cm-content`)
    if (hostBefore === null) throw new Error('the forked pane has no editor host')
    const viewBefore = EditorView.findFromDOM(hostBefore)
    if (viewBefore === null) throw new Error('no CodeMirror view mounted under the forked pane')

    // STATE A REBUILD WOULD DESTROY: park the cursor away from position 0, the position a freshly
    // constructed `EditorState.create` (no explicit `selection`) always starts a document at. If the
    // move below rebuilds instead of relocating, the fresh instance's cursor resets to 0 and this
    // assertion (repeated after the move) catches it even if the `toBe` above somehow did not.
    const cursorAt = viewBefore.state.doc.length
    viewBefore.dispatch({ selection: { anchor: cursorAt } })
    expect(viewBefore.state.selection.main.head).toBe(cursorAt)

    // Asking the other pane for it MOVES it.
    document.querySelector<HTMLButtonElement>(`[data-leaf="${second ?? ''}"] button.claim-editor`)?.click()
    await until(() => editorsInLeaf(second ?? '') === 1)
    expect(editorsInLeaf(first ?? '')).toBe(0)
    expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(1)

    const hostAfter = document.querySelector<HTMLElement>(`[data-leaf="${second}"] .cm-content`)
    if (hostAfter === null) throw new Error('the claimed pane has no editor host')
    const viewAfter = EditorView.findFromDOM(hostAfter)
    if (viewAfter === null) throw new Error('no CodeMirror view mounted under the claimed pane')

    expect(viewAfter).toBe(viewBefore)
    expect(viewAfter.state.selection.main.head).toBe(cursorAt)
  })

  /**
   * **FOCUS SURVIVES THE GESTURE.**
   *
   * `renderLayout` detaches every child of `#views` (`root.replaceChildren()`) and re-appends the
   * hosts, and detaching the subtree holding `document.activeElement` drops focus to `<body>`. Its one
   * rescue matches `.layout-divider` by `data-path`/`data-index`, so a control inside a HOST is not
   * rescued. That is why `showEditor` ends in `focusPane`, and this is the gesture that reaches it.
   *
   * **IT DRIVES THE MENU RATHER THAN THE BUTTON.** This file's other uses of this selector
   * reach `button.claim-editor` with the `⋯` popover shut, and none of them asserts anything
   * about `document.activeElement`.
   *
   * **WHAT `shut()` LEAVES BEHIND IS THE PRE-OPEN ELEMENT, NOT THE INVOKER.** `hidePopover()` restores
   * focus to whatever held it before the popover opened, which is not the `⋯` button: `more.click()`
   * here is programmatic and Chrome does not focus a button on a script-driven click. The sequence,
   * instrumented: focus is on `button.view-title` before the menu opens, `beforetoggle`'s `autofocus`
   * moves it to the first item (`button.view-split`), and activating *move the editor here* hands it
   * straight back to `button.view-title` — the pre-open element, which lives in this host.
   * `applyLayout` then detaches that host, and without `showEditor`'s `focusPane` the focus would fall
   * to `<body>` a frame later.
   *
   * So what this test needs is not that focus be on any particular control, but that it be INSIDE THE
   * HOST when the gesture commits, which the assertion below states directly rather than inferring.
   *
   * It builds its own state because `beforeEach` resets the app between tests: fork, then split, which
   * leaves the editor on `first` and the claim on `second`.
   */
  it('keeps the focus in the view that took the editor', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    await until(() => document.querySelectorAll('.cm-editor').length > 1, 'the copy')
    splitSame('lambda-0', 'row')
    await until(() => lambdaLeaves().length === 2, 'the second view')
    const [first, second] = lambdaLeaves()
    expect(editorsInLeaf(first ?? ''), 'the editor starts on the first view').toBe(1)
    expect(editorsInLeaf(second ?? ''), 'the second view starts without it').toBe(0)

    const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${second ?? ''}"] button.view-more`)
    expect(more, 'the view without the editor has a ⋯ menu').not.toBeNull()
    more?.click()
    const claim = document.querySelector<HTMLButtonElement>(`[data-leaf="${second ?? ''}"] button.claim-editor`)
    expect(claim, 'the view without the editor offers to take it').not.toBeNull()
    // THE PRECONDITION THIS TEST IS ABOUT: focus is inside the host when the gesture commits. Asserted
    // rather than assumed, because the seven sibling uses of this selector all fail it silently.
    expect(
      document.querySelector(`[data-leaf="${second}"]`)?.contains(document.activeElement),
      'the open menu put focus inside the host',
    ).toBe(true)
    claim?.click()
    await until(() => editorsInLeaf(second ?? '') === 1, 'the editor to arrive')
    // RE-QUERIED AFTER THE REBUILD, not captured before it: `renderLayout` re-appends the host elements
    // it was given, so the node is the same one, and re-reading it is what makes that a fact this test
    // does not have to assume.
    expect(document.activeElement, 'focus fell to <body>').not.toBe(document.body)
    expect(
      document.querySelector(`[data-leaf="${second}"]`)?.contains(document.activeElement),
      'focus left the view that took the editor',
    ).toBe(true)
  })

  /**
   * **A LEG WITH NO PANE IS A LEGAL STATE.** `closeLeaf` refuses only the last leaf in the TREE, so a page's
   * last λ pane can be closed, and `draw.ts` and `link-wiring.ts` must not throw on an empty λ or TM leg. A
   * throw there would persist: `applyLayout` writes the tree to `localStorage` before it calls `draw()`, so
   * the λ-less arrangement would be committed and a reload would come straight back to the dead app.
   *
   * IT DRIVES BOTH ENTRY POINTS, because they are reachable independently and one fix could plausibly
   * miss either. `draw()` is the per-frame path (the TM transport below); `link-wiring.ts` is reached
   * from the source editor's own `updateListener` on every keystroke, through `drawLink` ->
   * `detachedPanes`, per leg, with no λ pane to count.
   */
  it('keeps working after the last λ pane is closed, rather than throwing on every frame', async () => {
    // UNHANDLED ERRORS ARE COLLECTED, NOT INFERRED FROM A GREEN ASSERTION. A throw inside a click
    // handler or a CodeMirror update listener does not reject anything this test awaits — it surfaces
    // as an `error` event on `window` and nothing else, so a test that only checked the DOM afterwards
    // could pass while the app was throwing on every frame behind it.
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      btn('lambda-0', 'close this view')?.click()
      await until(() => lambdaLeaves().length === 0)
      expect(leafIds()).toEqual(['source', 'asm-0', 'tm-0'])

      // THE PER-FRAME PATH, DRIVEN ON PURPOSE AND ASSERTED ON ITS OUTPUT. Scrubbing the δ leg runs
      // `draw()` — the function that would throw — and `.step` is painted by that same pass, so a
      // changed step text is evidence the repaint happened rather than evidence nothing crashed. `▶`
      // RATHER THAN `◀`: a run opens on step 0 (`History`), so back is disabled and clicking it is a
      // silent no-op.
      const before = tmStepText()
      expect(before).not.toBe('')
      tmClick('▶')
      await until(() => tmStepText() !== before)

      // THE KEYSTROKE PATH, which reaches `link-wiring.ts` without going through `draw.ts` first.
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' + 0' } })
      await until(stateIdle)

      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * **5d-ii-a DESIGN §4.3's PROMISE**: "closing the pane that holds the editor unmounts the view without
   * destroying it... the next pane to ask for the editor re-mounts the same view with its text, cursor
   * and undo intact". `applyLayout` drops the closed pane from `panes`, and `reconcileEditors` only
   * ever iterates the views in `panes`, so without custody the `ScratchEditor` would be stranded in a
   * host no longer in the tree while the survivor went on offering *move the editor here* and clicking
   * it did nothing.
   *
   * IT ASSERTS THE CONTROL IS OFFERED **AND** THAT IT WORKS. Either half alone would pass against a
   * stranded editor: the control is offered either way, and a test that only counted `.cm-editor` nodes
   * after the click could not tell "re-mounted the same view" from "built a fresh one" — so this
   * carries the same `EditorView.findFromDOM` identity check and parked cursor the move test above
   * documents, for the same reason.
   */
  it('re-mounts the same editor on a survivor after the pane holding it is closed', async () => {
    const fork = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')
    fork?.click()
    await until(() => editorsInLeaf('lambda-0') > 0)

    splitSame('lambda-0', 'row')
    await until(() => lambdaLeaves().length === 2)
    const [holder, survivor] = lambdaLeaves()
    expect(editorsInLeaf(holder ?? '')).toBe(1)
    expect(editorsInLeaf(survivor ?? '')).toBe(0)

    const hostBefore = document.querySelector<HTMLElement>(`[data-leaf="${holder}"] .cm-content`)
    if (hostBefore === null) throw new Error('the forked pane has no editor host')
    const viewBefore = EditorView.findFromDOM(hostBefore)
    if (viewBefore === null) throw new Error('no CodeMirror view mounted under the forked pane')
    const cursorAt = viewBefore.state.doc.length
    viewBefore.dispatch({ selection: { anchor: cursorAt } })

    btn(holder ?? '', 'close this view')?.click()
    await until(() => lambdaLeaves().length === 1)
    expect(lambdaLeaves()).toEqual([survivor])
    expect(editorsInLeaf(survivor ?? '')).toBe(0)

    const claim = document.querySelector<HTMLButtonElement>(`[data-leaf="${survivor ?? ''}"] button.claim-editor`)
    expect(claim).not.toBeNull()
    claim?.click()
    await until(() => editorsInLeaf(survivor ?? '') === 1)

    const hostAfter = document.querySelector<HTMLElement>(`[data-leaf="${survivor}"] .cm-content`)
    if (hostAfter === null) throw new Error('the claiming pane has no editor host')
    const viewAfter = EditorView.findFromDOM(hostAfter)
    if (viewAfter === null) throw new Error('no CodeMirror view mounted under the claiming pane')
    expect(viewAfter).toBe(viewBefore)
    expect(viewAfter.state.selection.main.head).toBe(cursorAt)
    // STILL EXACTLY ONE, mounted in exactly one pane — a custody hand-back that duplicated rather than
    // relocated would satisfy every assertion above except this one.
    expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(1)
  })

  /**
   * **AN EDITOR WAITING IN CUSTODY SURVIVES A SOURCE RECOMPILE, BECAUSE THE BUFFER IT BELONGS TO DOES.**
   * The opening gestures are fork, split and close the holder; step 4, a source keystroke, is the path
   * that calls `draw()` and never `applyLayout()`, and the claim control's WITHDRAWAL is asserted not to
   * happen. A source keystroke retires nothing, and no layout gesture ends a session, so no step of this
   * test reaches the destroy branch of the custody sweep (`!sessions.has(session)`, which
   * `ScratchBuffers.cool` produces, on its own or from `retire`): `tests/browser/editor-custody.test.ts`
   * drives it over the real `createEditorCustody`, and `tests/browser/scratch-buffers.test.ts` drives it
   * through the app's own retire.
   *
   * IT ASSERTS IDENTITY, NOT A COUNT: `.term-editor .cm-editor` of 1 is also what "a fresh view was
   * built over the buffer's text" looks like, and a rebuild would lose the user's cursor and undo
   * history — which is exactly what custody exists to keep. The parked cursor is
   * `moves the one editor`'s own technique, for the same reason.
   */
  it('keeps a held editor waiting across a source recompile, and hands back the same instance', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      // 1-2. Fork, then split, so one pane holds the editor and one does not.
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
      await until(() => editorsInLeaf('lambda-0') > 0)
      const buffer = boundBufferItemOf('lambda-0').value
      const heldHost = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .cm-content')
      if (heldHost === null) throw new Error('the forked pane has no editor host')
      const heldView = EditorView.findFromDOM(heldHost)
      if (heldView === null) throw new Error('no CodeMirror view mounted under the forked pane')
      // STATE A REBUILD WOULD DESTROY, parked away from position 0 — the position a freshly constructed
      // `EditorState.create` always starts a document at.
      const cursorAt = heldView.state.doc.length
      heldView.dispatch({ selection: { anchor: cursorAt } })

      splitSame('lambda-0', 'row')
      await until(() => lambdaLeaves().length === 2)
      const [holder, survivor] = lambdaLeaves()
      expect(editorsInLeaf(holder ?? '')).toBe(1)

      // 3. Close the holder — the editor goes into custody rather than being destroyed.
      btn(holder ?? '', 'close this view')?.click()
      await until(() => lambdaLeaves().length === 1)
      expect(
        document.querySelector<HTMLButtonElement>(`[data-leaf="${survivor ?? ''}"] button.claim-editor`),
      ).not.toBeNull()

      // 4. A SOURCE keystroke, an event in the source session's life only. The `until` waits on the
      // recompile itself, because the thing being asserted is an ABSENCE and it has to be given the
      // time a retire would take.
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' + 0' } })
      await until(stateIdle)

      // THE SURVIVOR IS STILL ON THE BUFFER, and the control that would fetch the held editor is
      // still offered.
      expect(bindingOf(survivor ?? '')?.value).toBe(buffer)
      expect(document.querySelector(`[data-leaf="${survivor}"] h2`)?.textContent).toContain('copy · not linked')
      expect(
        document.querySelector<HTMLButtonElement>(`[data-leaf="${survivor ?? ''}"] button.claim-editor`),
      ).not.toBeNull()

      // 5. Fetch it. THE SAME INSTANCE, with the cursor where the user left it — a held editor that had
      // been destroyed leaves this control with nothing to hand over, and one that had been rebuilt
      // comes back at position 0.
      document.querySelector<HTMLButtonElement>(`[data-leaf="${survivor ?? ''}"] button.claim-editor`)?.click()
      await until(() => editorsInLeaf(survivor ?? '') === 1)
      const backHost = document.querySelector<HTMLElement>(`[data-leaf="${survivor}"] .cm-content`)
      if (backHost === null) throw new Error('the claiming pane has no editor host')
      const back = EditorView.findFromDOM(backHost)
      expect(back).toBe(heldView)
      expect(back?.state.selection.main.head).toBe(cursorAt)

      // 6. Any layout gesture reconciles editors. An unrelated pane's split is the mildest one there is,
      // and it is where a custody entry the reconcile mishandled would surface.
      const leavesBefore = leafIds().length
      splitSame('tm-0', 'column')
      await until(() => leafIds().length === leavesBefore + 1)

      expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(1)
      expect(editorsInLeaf(survivor ?? '')).toBe(1)
      const afterHost = document.querySelector<HTMLElement>(`[data-leaf="${survivor}"] .cm-content`)
      if (afterHost === null) throw new Error('the λ pane lost its editor host')
      expect(EditorView.findFromDOM(afterHost)).toBe(heldView)
      // The source editor and this one, and nothing else anywhere on the page.
      expect(document.querySelectorAll('.cm-editor').length).toBe(2)
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * **A DEFAULT ARRANGEMENT'S LITERAL IDS ARE MINTED AGAIN**, so a closed `lambda-0` comes back —
   * `resetToFourViews`' λ toggle mints the id again — while `editorOwner` may still name it. "The closed
   * leaf's id is never reused" is true of the ids `nextLeafId` mints and false of the four
   * `defaultArrangement` writes down. A pane that merely INHERITED the id would be resolved as the editor's
   * home the moment it was rebound to the scratch, and the next layout gesture would deliver the held
   * editor onto it — the silent relocation 5d-ii-a §4.2 and §4.3 both refuse, with the claim control
   * withdrawing itself as the editor appeared where nobody had asked for it.
   */
  it('does not deliver a held editor to a pane that merely inherited the owner leaf id', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    await until(() => editorsInLeaf('lambda-0') > 0)
    // THE BUFFER THIS FORK MINTED, CAPTURED WHILE THE PANE IS STILL SHOWING IT — the pane is closed two
    // lines below, and after that nothing on screen names it until this test puts it back.
    const buffer = boundBufferItemOf('lambda-0').value

    // Close the only λ pane — the editor goes into custody under the scratch session.
    btn('lambda-0', 'close this view')?.click()
    await until(() => lambdaLeaves().length === 0)

    // `resetToFourViews`' λ toggle mints a FRESH `lambda-0`, the same literal id the custody entry's owner names.
    await resetToFourViews()
    await until(() => lambdaLeaves().length === 1)
    expect(lambdaLeaves()).toEqual(['lambda-0'])

    // Point it at the buffer, which is still live — no pane's death retires a session.
    //
    // **THE VALUE IS THE FORKING PANE'S OWN BINDING**, captured above. `boundBufferItemOf`'s own doc
    // has the argument.
    const binding = bindingOf('lambda-0')
    if (binding === null || binding === undefined) throw new Error('the restored λ pane has no binding selector')
    pickBinding('lambda-0', buffer)
    // THE REBIND TOOK — asserted rather than assumed, because every assertion below would otherwise pass
    // on a pane that never went near the buffer. The pick (`pickBinding` throws on an item the menu does
    // not hold) and the first line check that the buffer outlived the close and the reset; the other two
    // say the pane MOVED off the session the new view was built on, and `copy · not linked` is
    // `SessionEntry.detached` for the session it actually ended up on, which only a buffer sets.
    expect(binding.value).toBe(buffer)
    expect(binding.value).not.toBe(bindingKey('lambda', 'source'))
    expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('copy · not linked')

    // A layout gesture on an UNRELATED pane, where a held editor resolved to an inherited home
    // would arrive unbidden.
    const leavesBefore = leafIds().length
    splitSame('tm-0', 'column')
    await until(() => leafIds().length === leavesBefore + 1)

    expect(editorsInLeaf('lambda-0')).toBe(0)
    // AND THE CONTROL THAT WOULD FETCH IT IS STILL OFFERED, AND STILL WORKS — withdrawing it would be
    // the other half of the same defect, a pane holding no editor with no way to ask for one.
    const claim = document.querySelector<HTMLButtonElement>(`[data-leaf="${'lambda-0'}"] button.claim-editor`)
    expect(claim).not.toBeNull()
    claim?.click()
    await until(() => editorsInLeaf('lambda-0') === 1)
    expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(1)
  })

  /**
   * **THE TWO TESTS ABOVE IN ONE SEQUENCE, BECAUSE WHAT THEY HOLD INTERACTS.** `applyLayout` drops an
   * `editorOwner` claim when its leaf id arrives fresh — which is what minting a closed pane's id again
   * does to its claim — so a custody pass that ran over `editorOwner.keys()` would lose the entry with its
   * claim: the entry would become unreachable from the function that owns both of its endings.
   *
   * NEITHER TEST ABOVE REACHES THIS. The custody one never mints the closed pane's id again, so its claim
   * survives; the claim one never puts a second buffer's editor on the pane afterwards. Six clicks with
   * both halves in one sequence do, and a mishandled entry shows as a throw out of `reconcileEditors`
   * (`a λ pane was handed a second editor while still holding one`) and the held editor E1 lost or
   * resurrected; without `applyLayout`'s `finally`, the throw would also leave the tree, the DOM and
   * storage disagreeing.
   *
   * **THE SEQUENCE ENDS WITH E1 STILL IN CUSTODY**, since a source keystroke retires nothing, and step 7
   * asks for it back through the real control. Getting the SAME `EditorView` proves the entry survived
   * every step of this sequence and is still reclaimable. **THE HEADER LIST'S RETIRE IS NOT SUBSTITUTED FOR
   * STEP 4 HERE**, deliberately: this sequence is about a custody entry surviving LAYOUT gestures, and
   * ending the buffer in the middle of it would replace the claim under test with a different one that
   * `scratch-buffers.test.ts` already makes.
   *
   * **STEP 7 DOES NOT GUARD THE CUSTODY PASS'S DOMAIN**, its iterating `heldEditors` rather than
   * `editorOwner.keys()`. Mounting a held editor needs `editorHomeFor` to resolve, which needs an
   * `editorOwner` claim — and "move the editor here" installs one (`pane-host.ts`'s `showEditor`) BEFORE
   * the `applyLayout` it triggers reconciles. So by the time the pass runs at step 7 the entry IS claimed,
   * and a pass over `editorOwner.keys()` would find it too. **The only ending that tells the two domains
   * apart is the destroy branch** (`!sessions.has`): `tests/browser/editor-custody.test.ts` drives that
   * branch over a custody object built by `createEditorCustody` with an entry no claim names, which is the
   * domain distinction stated directly rather than inferred from a sequence of clicks.
   *
   * IT ASSERTS ALL THREE, NOT ONLY THE THROW. The leaf count is read from the DOM (`leafIds`) and checked
   * against the tree in `localStorage`, which is the tree/DOM/storage agreement `applyLayout`'s `finally`
   * keeps through a throw; each surviving editor is checked by IDENTITY against the view its own fork
   * mounted, because a count is also what "the wrong view won" looks like.
   */
  it('keeps a held editor whose claim was dropped when its view’s id was minted again reachable, rather than losing or resurrecting it', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      // 1. Fork, so `lambda-0` holds the one editor and `editorOwner` claims `lambda-0` for the buffer.
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
      await until(() => editorsInLeaf('lambda-0') > 0)
      // THE BUFFER AND ITS EDITOR, CAPTURED WHILE A PANE IS STILL SHOWING THEM — step 3 asserts the
      // buffer survived the close and the reset, step 4 that it survived the recompile, and step 7 that
      // this exact `EditorView` is what comes back.
      const bufferA = boundBufferItemOf('lambda-0')
      const valueA = bufferA.value
      const labelA = bufferA.textContent ?? ''
      const heldHost = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .cm-content')
      if (heldHost === null) throw new Error('the forked pane has no editor host')
      const heldA = EditorView.findFromDOM(heldHost)
      if (heldA === null) throw new Error('no CodeMirror view mounted under the forked pane')

      // 2. Close it — the editor goes into custody, and the claim still names `lambda-0`.
      btn('lambda-0', 'close this view')?.click()
      await until(() => lambdaLeaves().length === 0)

      // 3. `resetToFourViews`' λ toggle re-mints the literal `lambda-0`, which DROPS the claim. The buffer is
      // untouched by any of this — no pane's death retires one — and the pane selector is how that is
      // observed from the DOM: a session offering a λ leg is an entry in the λ group.
      //
      // **READ THROUGH THE λ GROUP RATHER THAN THROUGH THE CONTROL'S PRESENCE**: the control lists
      // `(leg, session)` PAIRS and the source session alone contributes three, one per leg, so it never
      // withdraws; which sessions offer a λ leg is what the group says.
      //
      // `toContain`: what this step needs is that THIS buffer is in it, which is what naming it says.
      await resetToFourViews()
      await until(() => lambdaLeaves().length === 1)
      expect(lambdaLabelsOf('lambda-0')).toContain(labelA)

      // 4. A SOURCE keystroke, the step that proves a keystroke retires nothing: the entry is still in
      // the λ group afterwards, so the custody entry it keys is still an entry for a LIVE session —
      // which is precisely the state the destroy branch must not fire in, and the state the rest of
      // this test runs in.
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' + 0' } })
      await until(stateIdle)
      expect(lambdaLabelsOf('lambda-0')).toContain(labelA)

      // 5. Fork again on the fresh `lambda-0` — a SECOND buffer, and a second, legitimately mounted
      // editor. This is what makes step 6 a collision rather than a no-op: one live editor on the pane,
      // one in custody under a session no claim names.
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
      await until(() => editorsInLeaf('lambda-0') > 0)
      const liveHost = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .cm-content')
      if (liveHost === null) throw new Error('the re-forked pane has no editor host')
      const live = EditorView.findFromDOM(liveHost)
      if (live === null) throw new Error('no CodeMirror view mounted under the re-forked pane')
      expect(live).not.toBe(heldA)
      expect(bindingOf('lambda-0')?.value).not.toBe(valueA)

      // 6. Any layout gesture reconciles editors. An unrelated pane's split is the mildest one there is,
      // and it is the step where a mishandled custody entry would throw.
      const leavesBefore = leafIds().length
      splitSame('tm-0', 'column')
      await until(() => leafIds().length === leavesBefore + 1)

      // ONE editor mounted in one λ pane, and it is the SECOND fork's — the held one was neither handed
      // to this pane (the throw) nor destroyed on the way past.
      expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(1)
      expect(editorsInLeaf('lambda-0')).toBe(1)
      const afterHost = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .cm-content')
      if (afterHost === null) throw new Error('the λ pane lost its editor host')
      expect(EditorView.findFromDOM(afterHost)).toBe(live)
      // The source editor and this one, and nothing else anywhere on the page.
      expect(document.querySelectorAll('.cm-editor').length).toBe(2)

      // THE TREE, THE DOM AND STORAGE STILL AGREE — what the throw would cost without `applyLayout`'s
      // `finally`, and what no assertion about editors would notice. `parseWorkspace` reads back exactly
      // what `applyLayout` persisted.
      const stored = parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.tree ?? null
      expect(stored).not.toBeNull()
      expect(
        leaves(stored ?? fourViews())
          .map((l) => l.id)
          .sort(),
      ).toEqual([...leafIds()].sort())

      // 7. **AND E1 IS STILL THERE TO BE ASKED FOR.** Nothing in the app has named that session since
      // step 2 and its claim was dropped in step 3, so the only place it can have survived four steps
      // and two layout gestures is `heldEditors`. A second pane, pointed at buffer A, asks for it
      // through the real control; the view that arrives is checked by identity, because a fresh editor
      // over the same text would satisfy every count here and would be exactly the silent loss custody
      // exists to prevent.
      //
      // **THIS IS A SURVIVAL CHECK, NOT A CHECK OF THE PASS'S DOMAIN** — the claim control re-claims the
      // session before `applyLayout` reconciles, so the entry is claimed again by the time the custody
      // pass sees it and a pass over `editorOwner.keys()` would reach it too. See this test's own doc.
      splitSame('lambda-0', 'row')
      await until(() => lambdaLeaves().length === 2)
      const asker = lambdaLeaves()[1]
      const askerBinding = bindingOf(asker ?? '')
      if (askerBinding === null || askerBinding === undefined) throw new Error('the split pane has no binding selector')
      pickBinding(asker ?? '', valueA)
      expect(askerBinding.value).toBe(valueA)

      const claim = document.querySelector<HTMLButtonElement>(`[data-leaf="${asker ?? ''}"] button.claim-editor`)
      expect(claim).not.toBeNull()
      claim?.click()
      await until(() => editorsInLeaf(asker ?? '') === 1)
      const askerHost = document.querySelector<HTMLElement>(`[data-leaf="${asker}"] .cm-content`)
      if (askerHost === null) throw new Error('the claiming pane has no editor host')
      expect(EditorView.findFromDOM(askerHost)).toBe(heldA)
      // ONE EDITOR PER BUFFER, EACH ON THE PANE BOUND TO IT — B's is untouched by A's arrival, which is
      // the pair of facts the sweep's own two predicates (a live session, a pane that names it) exist
      // to keep true with more than one buffer.
      expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(2)
      expect(EditorView.findFromDOM(afterHost)).toBe(live)

      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  it('keeps the program when the source pane is closed and restored', async () => {
    const cm = document.querySelector<HTMLElement>('[data-leaf="source"] .cm-content')
    if (cm === null) throw new Error('no source editor')
    const before = cm.textContent ?? ''
    expect(before.length).toBeGreaterThan(0)

    btn('source', 'close this view')?.click()
    await until(() => !leafIds().includes('source'))

    await resetToFourViews()
    await until(() => leafIds().includes('source'))

    expect(document.querySelector('[data-leaf="source"] .cm-content')?.textContent).toBe(before)
  })

  /**
   * **`reconcileEditors`' SWEEP MUST NOT ASSUME THE APP HOLDS AT MOST ONE COPY'S EDITOR.**
   *
   * The sweep means "the editor belonging to session S lives on `home(S)`", but a `LambdaPane` does not
   * record whose editor it is holding — so a loop that asked every λ pane for its editor and handed
   * whatever came back to S's home would match that meaning only while there could be one such editor at
   * a time. A fork mints its own buffer, which makes two editors at once ordinary, and such a sweep
   * would take buffer B's editor off B's own pane and hand it to A's home, where
   * `LambdaPane.receiveEditor` throws `a λ pane was handed a second editor while still holding one`.
   *
   * **THE COST IS NOT ONLY THE THROW.** `takeEditor()` would already have nulled B's pane by the time
   * `receiveEditor` raises, and nothing would have taken custody of the returned view — so the app's
   * last reference to a live `EditorView` with its own pending debounce would be dropped on the floor.
   * `applyLayout`'s `try`/`finally` keeps the tree, the DOM and `localStorage` agreeing through it; the
   * editor is gone either way, and the exception reaches `window`'s `error` event.
   *
   * **FIVE GESTURES, ALL OF THEM ORDINARY, AND THIS TEST IS EXACTLY THOSE FIVE.** Fork `lambda-0`; split
   * it; rebind the new pane back to source through its own selector; fork THAT pane, which mints a
   * second buffer and mounts a second editor; then perform any layout gesture at all — a split of the TM
   * pane is the mildest one there is.
   *
   * THE PREDICATE IS THE PANE'S OWN BINDING. A λ pane only ever comes to hold an editor while bound to
   * that editor's session — `replies.ts`'s `scratch-compiled` arm mounts through `editorHomeFor`, which
   * checks the binding, and `receiveEditor` is only ever handed an editor by this sweep — so
   * `p.slot.binding.session === session` is the fact the loop needs. The "move the editor here" flow it
   * exists to serve satisfies it by construction: that control is only offered on a pane already bound
   * to the session (`LambdaPane.#refreshClaim`'s `#detached` gate), so both the pane losing the editor
   * and the pane gaining it name S.
   *
   * IT ASSERTS IDENTITY, NOT COUNTS. Two `.cm-editor` nodes is also what "the sweep moved B's editor
   * onto A's pane and A's was orphaned" would look like from a count, so each pane's surviving view is
   * checked against the `EditorView` its own fork mounted.
   */
  it('leaves each buffer’s editor on its own pane when two buffers are open at once', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      // 1. Fork `lambda-0` — buffer A, and the first editor.
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
      await until(() => editorsInLeaf('lambda-0') > 0)
      const bufferA = bindingOf('lambda-0')?.value ?? ''
      expect(bufferA).not.toBe(bindingKey('lambda', 'source'))

      // 2. Split it. Both panes are on A; only `lambda-0` holds the editor.
      splitSame('lambda-0', 'row')
      await until(() => lambdaLeaves().length === 2)
      const [first, second] = lambdaLeaves()
      expect(first).toBe('lambda-0')
      expect(editorsInLeaf(second ?? '')).toBe(0)

      // 3. Rebind the new pane back to source, so it can be forked in its own right — a pane already on
      // a buffer is offered no fork control (`#refreshDetach`'s `!this.#detached` gate).
      const binding = bindingOf(second ?? '')
      if (binding === null || binding === undefined) throw new Error('the split pane has no binding selector')
      pickBinding(second ?? '', bindingKey('lambda', 'source'))
      await until(() => document.querySelector(`[data-leaf="${second}"] button.detach`) !== null)

      // 4. Fork it — buffer B, a SECOND buffer live at the same time, and a second editor.
      document.querySelector<HTMLButtonElement>(`[data-leaf="${second}"] button.detach`)?.click()
      await until(() => editorsInLeaf(second ?? '') > 0)
      const bufferB = bindingOf(second ?? '')?.value ?? ''
      expect(bufferB).not.toBe(bindingKey('lambda', 'source'))
      // THE FIXTURE'S WHOLE POINT: two panes, two DIFFERENT buffers. A second fork that rebound to the
      // existing buffer would make every assertion below vacuous.
      expect(bufferB).not.toBe(bufferA)

      const hostA = document.querySelector<HTMLElement>(`[data-leaf="${first}"] .cm-content`)
      const hostB = document.querySelector<HTMLElement>(`[data-leaf="${second}"] .cm-content`)
      if (hostA === null || hostB === null) throw new Error('one of the two forked panes has no editor host')
      const viewA = EditorView.findFromDOM(hostA)
      const viewB = EditorView.findFromDOM(hostB)
      if (viewA === null || viewB === null) throw new Error('one of the two forked panes has no CodeMirror view')
      expect(viewA).not.toBe(viewB)

      // 5. Any layout gesture reconciles editors. This is the click a sweep blind to the binding would
      // throw on.
      const leavesBefore = leafIds().length
      splitSame('tm-0', 'column')
      await until(() => leafIds().length === leavesBefore + 1)

      // EACH EDITOR IS STILL ON THE PANE THAT FORKED IT, and it is the same instance.
      expect(editorsInLeaf(first ?? '')).toBe(1)
      expect(editorsInLeaf(second ?? '')).toBe(1)
      expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(2)
      const afterA = document.querySelector<HTMLElement>(`[data-leaf="${first}"] .cm-content`)
      const afterB = document.querySelector<HTMLElement>(`[data-leaf="${second}"] .cm-content`)
      if (afterA === null || afterB === null) throw new Error('a λ pane lost its editor host')
      expect(EditorView.findFromDOM(afterA)).toBe(viewA)
      expect(EditorView.findFromDOM(afterB)).toBe(viewB)
      // And the panes still disagree about which buffer they show, so nothing was quietly rebound.
      expect(bindingOf(first ?? '')?.value).toBe(bufferA)
      expect(bindingOf(second ?? '')?.value).toBe(bufferB)

      // THE THROW ITSELF — `applyLayout`'s `try`/`finally` keeps the tree, the DOM and storage agreeing
      // through an escaping exception, so no assertion above can see one; `window`'s `error` event is
      // where it surfaces and nowhere else.
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * **TWO λ PANES ON TWO DIFFERENT SCRATCH BUFFERS, SIDE BY SIDE, EACH SHOWING ITS OWN TERM** (5d-ii-c
   * design §5's browser-tier claim).
   *
   * **IT IS THIS FILE'S FIRST TEST ONE STEP ON.** That one reaches two λ SESSIONS — a buffer beside the
   * source session; this one reaches two BUFFERS at once, since a fork mints one per call, and shows both
   * terms on screen.
   *
   * **IT ASSERTS ON WHAT EACH PANE RENDERS RATHER THAN ON WHAT ITS SELECTOR IS LABELLED** — 5d-ii-c §5's rule,
   * and here the rule has teeth in a way a label check cannot reproduce: two panes bound to ONE buffer under
   * two different names would satisfy every comparison of ids and labels below. So each buffer is given a term
   * of its own THROUGH ITS OWN EDITOR, and each pane is then asserted to show its term AND NOT THE OTHER'S — a
   * shared buffer fails that pair in both directions at once.
   *
   * **THE KEYSTROKES ARE NOT DECORATION.** Both forks are seeded from the same source program, so an
   * unedited buffer renders what its sibling renders and "each pane shows its own term" would be true
   * of a page with one buffer on it. The edits are what make the two terms name the two sessions.
   *
   * **AND THE λ GROUP IS ASSERTED WHOLE** (5d-ii-c design §3.2). `sessions.ts`'s `pairs()` keeps
   * registration order within each leg's group and `view-header.ts`'s `viewHeader` builds its menu in the
   * order it is handed, so `λ · program` followed by the two buffers in fork order is a statement about
   * what the control OFFERS rather than a length any two entries would satisfy. Both panes are asked,
   * because the title-selector is built per pane and a pair list that reached only the pane that forked
   * last would still be broken.
   *
   * **ITS FIXTURE IS THE TEST ABOVE'S AND THE TWO CLAIMS ARE DISJOINT**: that one asserts each buffer's
   * EDITOR stays on the pane that forked it, by `EditorView` identity, and never reads a pane's body;
   * this one asserts the two rendered TERMS and the selector's contents, and touches an editor only as
   * the thing a user types a term into.
   * The rebind at step 4 is a gesture rather than a detail — a pane already on a buffer is offered no
   * fork control (`LambdaPane.#refreshDetach`'s `!this.#detached` gate), so putting the split pane back
   * on the source session is what makes it forkable in its own right.
   */
  it('renders two different buffers side by side, each showing its own term, reached entirely through the UI', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      // 1. Fork `lambda-0` — buffer A, and its editor.
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
      await until(() => editorsInLeaf('lambda-0') > 0)
      const itemA = boundBufferItemOf('lambda-0')
      const valueA = itemA.value
      const labelA = itemA.textContent ?? ''

      // 2. Give A a term of its own, through its own editor.
      //
      // THE WAIT IS ON THE MARKER, NOT ON "THE TEXT CHANGED". The keystroke is debounced and reduced on
      // the buffer's OWN thread, so the pane is the only thing that can say the round trip finished —
      // but a buffer's first frame can land after its editor does, and a wait any change satisfies
      // would let that seed frame stand in for the edit and hand the assertions below a term the
      // keystroke never produced.
      //
      // **AND THE MARKER IS CHOSEN AGAINST THE SEED.** Both buffers are seeded from `let x = 40; x + 2`, whose λ
      // term is the Church numeral `λf. λx0. f (f (f … (f x0)))`, so `f x` is already in the seed as the head of
      // `f x0`, and a wait and a match on it would both pass on a pane the keystroke had not reached yet. `p`/`q`
      // and `m`/`n` occur nowhere in a Church numeral over `f` and `x0`.
      //
      // **AND THAT IS ASSERTED ON THE LINE BELOW RATHER THAN LEFT TO THIS PARAGRAPH**: `not.toContain` names it, so
      // if the sample program ever grows the marker, the failure says so instead of reading as a term mismatch. The
      // first test asserts the same of its seed.
      //
      // **EVERY TEXT THIS TEST KEEPS OR COMPARES EXACTLY IS READ FROM A SETTLED VIEW** — `lambdaSettled`, after the
      // marker's wait and before the read. Between a frame and its tree the λ view shows the frame's flat text, one
      // worker round trip long: after the edit it reads `λp. λq. p q` for a frame and then the tree's `λp q. p q`.
      // `termA` taken in that frame would never equal the settled pane it is compared with at the end, and on a
      // slower runner, where the round trip is longer, the marker's 20 ms poll can land in it. The marker wait
      // stays first: before the edit reaches the pane, the seed's tree is already settled.
      await until(() => termOf('lambda-0') !== '')
      await lambdaSettled('lambda-0')
      const seededA = termOf('lambda-0')
      expect(seededA).not.toContain('p q')
      typeInto('lambda-0', 'λp.λq. p q')
      await until(() => termOf('lambda-0').includes('p q'))
      await lambdaSettled('lambda-0')
      const termA = termOf('lambda-0')
      expect(termA).not.toBe(seededA)

      // 3. Split. Both panes are on A — the split menu's first entry is the pane's own pair — and this is
      // the state the test has to get PAST: one buffer shown twice.
      splitSame('lambda-0', 'row')
      await until(() => lambdaLeaves().length === 2)
      const [first, second] = lambdaLeaves()
      expect(first).toBe('lambda-0')
      expect(bindingOf(second ?? '')?.value).toBe(valueA)
      await until(() => termOf(second ?? '') !== '')
      await lambdaSettled(second ?? '')
      expect(termOf(second ?? '')).toBe(termA)

      // 4. Put the new pane back on the source session, which is what makes it forkable.
      const binding = bindingOf(second ?? '')
      if (binding === null || binding === undefined) throw new Error('the split pane has no binding selector')
      pickBinding(second ?? '', bindingKey('lambda', 'source'))
      await until(() => document.querySelector(`[data-leaf="${second}"] button.detach`) !== null)

      // 5. Fork IT — buffer B, MINTED RATHER THAN REBOUND, and that is asserted before anything is awaited.
      // `fork` rebinds the slot synchronously and the click's own repaint carries the new pair into the
      // selector — `scratch-cap.test.ts` asserts `copy · not linked` on the heading with nothing awaited after
      // its own fork click, for exactly that reason — so the mint is observable here, and putting the check
      // ahead of the wait is what makes a fork that rebinds instead of minting fail this test on the CLAIM
      // rather than by timing out on an editor its rebind was never going to mount.
      document.querySelector<HTMLButtonElement>(`[data-leaf="${second}"] button.detach`)?.click()
      const itemB = boundBufferItemOf(second ?? '')
      const valueB = itemB.value
      const labelB = itemB.textContent ?? ''
      expect(valueB).not.toBe(valueA)
      // THE LABEL IS NEARLY IMPLIED BY THE VALUE — it is the value's own suffix respelled, and `fork`
      // composes both from one counter. It is kept because the λ-group assertion at the end of this
      // test is written in LABELS, and two buffers sharing one would make that `toEqual` unable to
      // tell them apart while still passing.
      expect(labelB).not.toBe(labelA)
      await until(() => editorsInLeaf(second ?? '') > 0)

      // 6. And give B its own term, through B's own editor — the same marker wait, for step 2's reason.
      await until(() => termOf(second ?? '') !== '')
      await lambdaSettled(second ?? '')
      const seededB = termOf(second ?? '')
      expect(seededB).not.toContain('n m')
      typeInto(second ?? '', 'λm.λn. n m')
      await until(() => termOf(second ?? '').includes('n m'))
      await lambdaSettled(second ?? '')
      expect(termOf(second ?? '')).not.toBe(seededB)

      // **THE HEADLINE, READ OFF BOTH PANES AT ONE MOMENT.** Each shows the term typed into ITS buffer
      // and not the term typed into the other's — the pair of checks a single shared buffer fails
      // whichever of the two terms it happens to be holding.
      //
      // THE TWO HALVES CATCH DIFFERENT SHAPES, WHICH IS WHY BOTH ARE HERE. A pane rendering the WRONG
      // session shows exactly one marker, so `toContain` is what reports it; `not.toContain` reports a
      // pane whose text carries BOTH — a buffer seeded from another buffer's text, or a pane
      // accumulating frames instead of replacing them — which no single-point mutation of the fork,
      // the recompile or the pair list produces. They are the cheap half of a claim whose expensive
      // half is already paid for, not evidence.
      expect(termOf(first ?? '')).toContain('p q')
      expect(termOf(second ?? '')).toContain('n m')
      expect(termOf(first ?? '')).not.toContain('n m')
      expect(termOf(second ?? '')).not.toContain('p q')

      // AND A's TERM IS STILL EXACTLY THE ONE A's KEYSTROKE PUT THERE — character for character,
      // untouched by B being forked, seeded and edited beside it. "Different" is the weaker claim and
      // a re-seeded A would satisfy it; this is what "its own" means.
      expect(termOf(first ?? '')).toBe(termA)
      expect(bindingOf(first ?? '')?.value).toBe(valueA)
      expect(bindingOf(second ?? '')?.value).toBe(valueB)

      // **THE PAIR LIST CARRYING MORE THAN ONE λ SCRATCH** — the source session's λ leg and both
      // buffers, in registration order, in EITHER pane's selector.
      expect(lambdaLabelsOf(first ?? '')).toEqual(['λ · program', labelA, labelB])
      expect(lambdaLabelsOf(second ?? '')).toEqual(['λ · program', labelA, labelB])

      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })
})
