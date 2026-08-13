import { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { defaultLayout, LAYOUT_STORAGE_KEY, leaves, parseLayout } from '../../src/layout'

/**
 * TWO λ PANES ON TWO λ SESSIONS, THROUGH THE APP — the claim 5d-i could assert only with hand-built
 * panes.
 *
 * `sessions.ts:180-184` and `binding-selector.test.ts`'s own header both record why that was: "this app
 * has ONE λ pane, so two panes side by side on two λ sessions is still not a state `main()` can reach".
 * Neither file is wrong and neither is superseded — they assert the resolution and the rendering. This
 * one asserts that a user can GET there, which is the property the layout tree adds and the reason
 * 5d-ii-a is sequenced ahead of the multiplexer.
 *
 * THE SHELL AND THE DYNAMIC IMPORT ARE THIS FILE'S OWN ADDITION, matching `layout-app.test.ts`'s and
 * `scratch-app.test.ts`'s idiom exactly rather than the plan's illustrative top-level `import { ready }`
 * — see `layout-app.test.ts`'s own doc for why a bare import cannot work: Vitest's browser mode serves
 * its own tester HTML, not this project's `index.html`, so `main()`'s mount-point check has nothing to
 * find unless something builds the page first, and ES module imports are linked and evaluated before
 * any of a file's own top-level code runs.
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

const leafIds = () => [...document.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf ?? '')
const lambdaLeaves = () => leafIds().filter((id) => id.startsWith('lambda'))
const textOf = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .term`)?.textContent ?? ''
const btn = (leaf: string, label: string) =>
  document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button[aria-label="${label}"]`)
const selectOf = (leaf: string) =>
  document.querySelector<HTMLSelectElement>(`[data-leaf="${leaf}"] .pane-binding select`)
const editorsIn = (leaf: string) => document.querySelectorAll(`[data-leaf="${leaf}"] .cm-editor`).length
/** The TM pane's own transport strip — the δ leg has a play head independent of λ's. */
const tmClick = (glyph: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="tm-0"] .controls button')]
    .find((b) => b.textContent === glyph)
    ?.click()
const tmStepText = () => document.querySelector('[data-leaf="tm-0"] .step')?.textContent ?? ''

const until = async (p: () => boolean, ms = 5000) => {
  const start = performance.now()
  while (!p()) {
    if (performance.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

// ONE MOUNT FOR THE FILE, the same reason every sibling file gives: ES module imports are cached, so
// `main()` runs once per page and Vitest gives each test FILE its own page. `localStorage` is cleared
// BEFORE the mount, not (only) in `beforeEach` — `main()` reads it exactly once, synchronously, while
// resolving `let tree`, so a clear written only in `beforeEach` (which runs AFTER `beforeAll`) would
// never be seen by that read.
//
// WAITS FOR THE FIRST COMPILE TO SETTLE, WHICH THE PLAN'S ILLUSTRATIVE SNIPPET DID NOT — found by
// running it: the very first test's fork click landed while `main()`'s own `compile.schedule(SAMPLE)`
// was still mid-flight (`results.dataset.state === 'running'`), so `linkWiring.index` was still `null`
// and `transport.ts`'s `detach` handler silently declined (`if (wiring.index === null || ...) return`)
// — the click did nothing, and nothing else in the test waits or retries, so it timed out waiting for an
// editor that was never asked for. `scratch-app.test.ts`'s own `beforeAll` waits for exactly this same
// condition before its first fork, for the identical reason; this file needed the same wait and did not
// have it.
let view: EditorView

beforeAll(async () => {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle')
})

/**
 * RESET TO A CLEAN BASELINE BEFORE EVERY TEST, NOT ONLY `localStorage` — found the same way the
 * `beforeAll` wait above was: running this file. All three tests below fork, split and rebind panes on
 * the ONE app this file mounts (`layout-app.test.ts`'s own multi-`it`-one-`beforeAll` idiom, carried
 * through here), so a test that assumes "exactly one λ leaf" or "no scratchpad yet" is assuming state
 * only the FIRST test in the file actually starts in. `restore-layout` undoes the TREE shape (extra
 * leaves from a split); it does not touch the session registry, so a pane left bound to a scratch stays
 * bound to it even after its leaf is gone from the tree — the second half is a recompile-from-source
 * dispatched directly on `view`, which is what `compile.ts`'s `schedule` uses to retire any scratchpad
 * and rebind every pane pointed at it back to `source` (`scratch.ts`'s `retire`). Both facts drift
 * independently, so both are undone independently, in either order.
 */
beforeEach(async () => {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
  document.querySelector<HTMLButtonElement>('#restore-layout')?.click()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(
    () =>
      document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
      leafIds().length === 3 &&
      lambdaLeaves().length === 1,
  )
})

describe('two λ panes on two λ sessions', () => {
  it('renders two different terms at the same time, reached entirely through the UI', async () => {
    // 1. Fork the source-derived λ pane into a scratch — 5d-iii's existing control.
    // `.controls .detach`, NOT `button[aria-label*="fork"]` — the plan's illustrative snippet reached for
    // an `aria-label`, but `detachButton` (`pane-chrome.ts`) deliberately has none: its own doc states
    // the button carries REAL TEXT ("✎ fork") rather than a glyph, and text content IS the accessible
    // name without a redundant `aria-label` restating it — the same distinction `layoutControls`'s
    // glyph-only buttons need one for and this one does not. `scratch-app.test.ts`'s own `forkButton`
    // already uses this exact selector.
    const fork = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')
    fork?.click()
    await until(() => document.querySelectorAll('[data-leaf="lambda-0"] .term-editor').length > 0)

    // 2. Split it — the control this slice adds.
    btn('lambda-0', 'split left and right')?.click()
    await until(() => lambdaLeaves().length === 2)
    const [first, second] = lambdaLeaves()

    // 3. Point the new pane back at the source session — 5d-i's selector.
    const sel = selectOf(second ?? '')
    if (sel === null || sel === undefined) throw new Error('the split pane has no binding selector')
    sel.value = 'source'
    sel.dispatchEvent(new Event('change', { bubbles: true }))

    // 4. Edit the scratch so the two sessions genuinely differ — a REAL CodeMirror transaction via
    // `EditorView.findFromDOM`, exactly `lambda-editor.test.ts`'s own `retype` helper: `.textContent`
    // plus a synthetic `InputEvent` (this test's own former approach) never reaches CodeMirror's
    // `docChanged` update listener — CodeMirror owns its DOM and does not read it back — so it is dead
    // code that fires no recompile at all. `lambda-editor.test.ts`'s file doc has the full argument.
    const beforeEditFirst = textOf(first ?? '')
    const beforeEditSecond = textOf(second ?? '')
    const host = document.querySelector<HTMLElement>(`[data-leaf="${first}"] .cm-content`)
    if (host === null) throw new Error('the forked pane has no editor')
    const scratchView = EditorView.findFromDOM(host)
    if (scratchView === null) throw new Error('no CodeMirror view mounted under the forked pane')
    scratchView.dispatch({ changes: { from: 0, to: scratchView.state.doc.length, insert: 'λf.λx. f x' } })

    await until(() => textOf(first ?? '') !== beforeEditFirst && textOf(first ?? '') !== '')

    // The edit reached the pane and changed WHAT IT SHOWS, not merely "differs from the other pane" —
    // which was already true before any edit, from the fork's own alpha-renaming (`x0` vs `x`). A test
    // that only checked the latter would pass even if the edit above did nothing at all.
    expect(textOf(first ?? '')).not.toBe(beforeEditFirst)
    expect(textOf(first ?? '')).toContain('f x')
    // The source-bound pane is unaffected by an edit to the scratch's own buffer.
    expect(textOf(second ?? '')).toBe(beforeEditSecond)

    expect(textOf(first ?? '')).not.toBe(textOf(second ?? ''))
    expect(textOf(first ?? '')).not.toBe('')
    expect(textOf(second ?? '')).not.toBe('')
  })

  it('moves the one editor rather than mounting a second', async () => {
    // `.controls .detach`, NOT `button[aria-label*="fork"]` — the plan's illustrative snippet reached for
    // an `aria-label`, but `detachButton` (`pane-chrome.ts`) deliberately has none: its own doc states
    // the button carries REAL TEXT ("✎ fork") rather than a glyph, and text content IS the accessible
    // name without a redundant `aria-label` restating it — the same distinction `layoutControls`'s
    // glyph-only buttons need one for and this one does not. `scratch-app.test.ts`'s own `forkButton`
    // already uses this exact selector.
    const fork = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')
    fork?.click()
    await until(() => document.querySelectorAll('.cm-editor').length > 1)

    btn('lambda-0', 'split left and right')?.click()
    await until(() => lambdaLeaves().length === 2)
    const [first, second] = lambdaLeaves()

    // Both panes are on the scratch; only one holds the editor.
    expect(editorsIn(first ?? '')).toBe(1)
    expect(editorsIn(second ?? '')).toBe(0)

    // THE SAME `EditorView` INSTANCE, CAPTURED BEFORE THE MOVE — `EditorView.findFromDOM`, the same
    // technique `lambda-editor.test.ts`'s own `retype` documents. A node count alone (the assertions
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
    btn(second ?? '', 'bring the term editor to this pane')?.click()
    await until(() => editorsIn(second ?? '') === 1)
    expect(editorsIn(first ?? '')).toBe(0)
    expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(1)

    const hostAfter = document.querySelector<HTMLElement>(`[data-leaf="${second}"] .cm-content`)
    if (hostAfter === null) throw new Error('the claimed pane has no editor host')
    const viewAfter = EditorView.findFromDOM(hostAfter)
    if (viewAfter === null) throw new Error('no CodeMirror view mounted under the claimed pane')

    expect(viewAfter).toBe(viewBefore)
    expect(viewAfter.state.selection.main.head).toBe(cursorAt)
  })

  /**
   * CRITICAL FINDING, WHOLE-BRANCH REVIEW BEFORE MERGE — A LEG WITH NO PANE IS A LEGAL STATE.
   *
   * `closeLeaf` refuses only the last leaf in the TREE, and `draw()` offers `close` on `leaves() > 1`,
   * so `close` is on the single λ pane a fresh page ships from the first frame — three leaves, nothing
   * to click through to reach it. `draw.ts` and `link-wiring.ts` nonetheless threw on an empty λ or TM
   * leg, each justifying it with "`main.ts` always registers one pane of each leg before this can be
   * called" — true through wave 1, false from the moment `applyLayout` began deriving panes from the
   * tree. AND THE BREAKAGE PERSISTED: `applyLayout` writes the tree to `localStorage` before it calls
   * `draw()`, so the λ-less arrangement was committed and a reload came straight back to the dead app.
   *
   * IT DRIVES BOTH ENTRY POINTS, because they are reachable independently and one fix could plausibly
   * miss either. `draw()` is the per-frame path (the TM transport below); `link-wiring.ts` is reached
   * from the source editor's own `updateListener` on every keystroke, through `drawLink` ->
   * `detachedPanes` -> `theTmSlot`/`theLambdaSlot`, with no λ pane to resolve.
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
      btn('lambda-0', 'close this pane')?.click()
      await until(() => lambdaLeaves().length === 0)
      expect(leafIds()).toEqual(['source', 'tm-0'])

      // THE PER-FRAME PATH, DRIVEN ON PURPOSE AND ASSERTED ON ITS OUTPUT. Scrubbing the δ leg runs
      // `draw()` — the function that threw — and `.step` is painted by that same pass, so a changed
      // step text is evidence the repaint happened rather than evidence nothing crashed. `◀` RATHER
      // THAN `▶`: a finished run leaves the play head at the LAST step (`running-focus.test.ts` asserts
      // `step 2,870 of 2,870` for its own fixture), so forward is disabled and clicking it is a silent
      // no-op — found by writing this with `▶` and watching it time out on a green app.
      const before = tmStepText()
      expect(before).not.toBe('')
      tmClick('◀')
      await until(() => tmStepText() !== before)

      // THE KEYSTROKE PATH, which reaches `link-wiring.ts` without going through `draw.ts` first.
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' + 0' } })
      await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle')

      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * IMPORTANT FINDING, WHOLE-BRANCH REVIEW BEFORE MERGE — design §4.3 promises that "closing the pane
   * that holds the editor unmounts the view without destroying it... the next pane to ask for the
   * editor re-mounts the same view with its text, cursor and undo intact", and nothing made that true.
   * `applyLayout` dropped the closed pane from `panes` before anything asked it for its editor, and
   * `reconcileEditors` only ever iterates `panes.of('lambda')` — so the `LambdaEditor` was stranded in
   * a host no longer in the tree, while the survivor went on offering "bring the term editor to this
   * pane" and clicking it did nothing, forever. A control that provably cannot work, offered anyway.
   *
   * IT ASSERTS THE CONTROL IS OFFERED **AND** THAT IT WORKS. Either half alone passes against the bug:
   * the button was always there, and a test that only counted `.cm-editor` nodes after the click could
   * not tell "re-mounted the same view" from "built a fresh one" — so this carries the same
   * `EditorView.findFromDOM` identity check and parked cursor the move test above documents, for the
   * same reason.
   */
  it('re-mounts the same editor on a survivor after the pane holding it is closed', async () => {
    const fork = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')
    fork?.click()
    await until(() => editorsIn('lambda-0') > 0)

    btn('lambda-0', 'split left and right')?.click()
    await until(() => lambdaLeaves().length === 2)
    const [holder, survivor] = lambdaLeaves()
    expect(editorsIn(holder ?? '')).toBe(1)
    expect(editorsIn(survivor ?? '')).toBe(0)

    const hostBefore = document.querySelector<HTMLElement>(`[data-leaf="${holder}"] .cm-content`)
    if (hostBefore === null) throw new Error('the forked pane has no editor host')
    const viewBefore = EditorView.findFromDOM(hostBefore)
    if (viewBefore === null) throw new Error('no CodeMirror view mounted under the forked pane')
    const cursorAt = viewBefore.state.doc.length
    viewBefore.dispatch({ selection: { anchor: cursorAt } })

    btn(holder ?? '', 'close this pane')?.click()
    await until(() => lambdaLeaves().length === 1)
    expect(lambdaLeaves()).toEqual([survivor])
    expect(editorsIn(survivor ?? '')).toBe(0)

    const claim = btn(survivor ?? '', 'bring the term editor to this pane')
    expect(claim).not.toBeNull()
    claim?.click()
    await until(() => editorsIn(survivor ?? '') === 1)

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
   * IMPORTANT FINDING, RE-REVIEW OF THE CUSTODY FIX ITSELF — the fix above made design §4.3's
   * impossible state representable, and this is the six-step sequence that reached it.
   *
   * The scratch session's id is a CONSTANT, re-registered by the next fork, so a `heldEditors` entry
   * keyed by it OUTLIVED the session's death: the retire path (`compile.ts`'s recompile-from-source)
   * called `draw()` and never `applyLayout()`, and `reconcileEditors`' destroy-a-held-editor branch is
   * only reachable from the latter. Fork again on the survivor and the SECOND editor mounts on it
   * legitimately — then the first layout gesture handed the pane the stale one on top, and
   * `receiveEditor` overwrote `#editor` without removing the previous node. Measured: TWO
   * `.term-editor .cm-editor` in one λ pane, the pane's `#editor` pointing at a view over a TERMINATED
   * worker, and the live one orphaned in the DOM where neither `setEditor` nor `destroy` could reach it.
   * That is "two uncoordinated CodeMirror instances over one buffer", which §4.3 rejects as structurally
   * impossible.
   *
   * IT ASSERTS IDENTITY, NOT A COUNT. `.term-editor .cm-editor` of 1 is also what "the stale view won"
   * looks like — the node count cannot tell which of the two survived — so the surviving instance is
   * checked against the `EditorView` the SECOND fork mounted, by `EditorView.findFromDOM`, the same
   * technique the move test above documents.
   */
  it('destroys a held editor when its session retires, rather than resurrecting it over a live one', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      // 1-2. Fork, then split, so one pane holds the editor and one does not.
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')?.click()
      await until(() => editorsIn('lambda-0') > 0)
      btn('lambda-0', 'split left and right')?.click()
      await until(() => lambdaLeaves().length === 2)
      const [holder, survivor] = lambdaLeaves()
      expect(editorsIn(holder ?? '')).toBe(1)

      // 3. Close the holder — the editor goes into custody rather than being destroyed.
      btn(holder ?? '', 'close this pane')?.click()
      await until(() => lambdaLeaves().length === 1)
      expect(btn(survivor ?? '', 'bring the term editor to this pane')).not.toBeNull()

      // 4. A SOURCE keystroke retires the scratch. This is the path that calls `draw()` and not
      // `applyLayout()`; the claim control withdrawing is what says the survivor is back on `source`.
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' + 0' } })
      await until(
        () =>
          document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
          btn(survivor ?? '', 'bring the term editor to this pane') === null,
      )

      // 5. Fork again on the survivor — a NEW scratch under the SAME session id, and a second editor.
      document.querySelector<HTMLButtonElement>(`[data-leaf="${survivor}"] .controls .detach`)?.click()
      await until(() => editorsIn(survivor ?? '') > 0)
      const liveHost = document.querySelector<HTMLElement>(`[data-leaf="${survivor}"] .cm-content`)
      if (liveHost === null) throw new Error('the re-forked pane has no editor host')
      const live = EditorView.findFromDOM(liveHost)
      if (live === null) throw new Error('no CodeMirror view mounted under the re-forked pane')

      // 6. Any layout gesture reconciles editors. An unrelated pane's split is the mildest one there is.
      const leavesBefore = leafIds().length
      btn('tm-0', 'split top and bottom')?.click()
      await until(() => leafIds().length === leavesBefore + 1)

      // ONE editor in one λ pane, and it is the LIVE one — not the stale view over the worker
      // `retire` terminated four steps ago.
      expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(1)
      expect(editorsIn(survivor ?? '')).toBe(1)
      const afterHost = document.querySelector<HTMLElement>(`[data-leaf="${survivor}"] .cm-content`)
      if (afterHost === null) throw new Error('the λ pane lost its editor host')
      expect(EditorView.findFromDOM(afterHost)).toBe(live)
      // The source editor and this one, and nothing else anywhere on the page.
      expect(document.querySelectorAll('.cm-editor').length).toBe(2)
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * MINOR FINDING, SAME RE-REVIEW — `reset layout` RE-MINTS `defaultLayout()`'s LITERAL IDS, so a closed
   * `lambda-0` does come back, and `editorOwner` still named it.
   *
   * The two docs that justified keying custody by session argued from "the closed leaf's id is never
   * reused (`nextLeafId` only counts up)", which is true of the ids `nextLeafId` mints and false of the
   * three `defaultLayout` writes down. A pane that merely INHERITED the id was resolved as the editor's
   * home the moment it was rebound to the scratch, and the next layout gesture delivered the held editor
   * onto it — the silent relocation §4.2 and §4.3 both refuse, with the claim control withdrawing itself
   * as the editor appeared where nobody had asked for it.
   */
  it('does not deliver a held editor to a pane that merely inherited the owner leaf id', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')?.click()
    await until(() => editorsIn('lambda-0') > 0)

    // Close the only λ pane — the editor goes into custody under the scratch session.
    btn('lambda-0', 'close this pane')?.click()
    await until(() => lambdaLeaves().length === 0)

    // `reset layout` mints a FRESH `lambda-0`, the same literal id the custody entry's owner names.
    document.querySelector<HTMLButtonElement>('#restore-layout')?.click()
    await until(() => lambdaLeaves().length === 1)
    expect(lambdaLeaves()).toEqual(['lambda-0'])

    // Point it at the scratch, which is still live — no pane's death retires a session.
    const sel = selectOf('lambda-0')
    if (sel === null || sel === undefined) throw new Error('the restored λ pane has no binding selector')
    sel.value = 'lambda-scratch'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    // THE REBIND TOOK — asserted rather than assumed, because `select.value = x` for an option that is
    // not in the list silently leaves the value at `''`, and every assertion below would then pass on a
    // pane that never went near the scratch.
    expect(sel.value).toBe('lambda-scratch')
    expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('[detached]')

    // A layout gesture on an UNRELATED pane. This is where the editor used to arrive unbidden.
    const leavesBefore = leafIds().length
    btn('tm-0', 'split top and bottom')?.click()
    await until(() => leafIds().length === leavesBefore + 1)

    expect(editorsIn('lambda-0')).toBe(0)
    // AND THE CONTROL THAT WOULD FETCH IT IS STILL OFFERED, AND STILL WORKS — withdrawing it would be
    // the other half of the same defect, a pane holding no editor with no way to ask for one.
    const claim = btn('lambda-0', 'bring the term editor to this pane')
    expect(claim).not.toBeNull()
    claim?.click()
    await until(() => editorsIn('lambda-0') === 1)
    expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(1)
  })

  /**
   * IMPORTANT FINDING, THIRD REVIEW ROUND — **THE TWO FIXES ABOVE ARE EACH CORRECT AND THEY INTERACT,
   * AND THIS TEST IS LITERALLY THE CONCATENATION OF THE TWO TESTS THEY SHIPPED WITH.**
   *
   * The retire fix (`destroys a held editor when its session retires`, above) makes every retire call
   * `reconcileEditors`. The claim fix (`does not deliver a held editor to a pane that merely inherited
   * the owner leaf id`, above) makes `applyLayout` drop an `editorOwner` claim when its leaf id arrives
   * fresh — which is what `reset layout` does to a closed pane's claim. But `reconcileEditors` ran both
   * of its passes over `editorOwner.keys()`, so dropping the claim removed the custody entry from the
   * only domain the retire sweep could see: the sweep became a no-op for exactly the entry it exists to
   * destroy.
   *
   * NEITHER TEST ABOVE REACHES THIS. The retire one never calls `reset layout`, so its claim survives
   * and its sweep works; the claim one never retires after the drop, so nothing needs sweeping. Six
   * clicks with both halves in one sequence do — and what was measured in the running app before the
   * fix is three separate failures from one cause: E1 survived the retire; the sixth step threw
   * `a λ pane was handed a second editor while still holding one` out of `reconcileEditors` ->
   * `applyLayout` -> the click handler, so `renderLayout`, `writeLayoutStorage` and `draw` never ran
   * (the model gained a leaf, the DOM did not, and storage kept the old tree); and E1 LEAKED
   * permanently, because `heldEditors.delete` ran before the `receiveEditor` that threw.
   *
   * IT ASSERTS ALL THREE, NOT ONLY THE THROW. The leaf count is read from the DOM (`leafIds`) and
   * checked against the tree in `localStorage`, which is the tree/DOM/storage agreement the throw used
   * to break; the surviving editor is checked by IDENTITY against the one the SECOND fork mounted,
   * because a count of one is also what "the dead view won" looks like.
   */
  it('destroys a held editor whose claim was dropped by reset layout, rather than resurrecting it', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      // 1. Fork, so `lambda-0` holds the one editor and `editorOwner` claims `lambda-0` for the scratch.
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')?.click()
      await until(() => editorsIn('lambda-0') > 0)

      // 2. Close it — the editor goes into custody, and the claim still names `lambda-0`.
      btn('lambda-0', 'close this pane')?.click()
      await until(() => lambdaLeaves().length === 0)

      // 3. `reset layout` re-mints the literal `lambda-0`, which DROPS the claim. The scratch session is
      // untouched by any of this — no pane's death retires one — and the binding selector is how that is
      // observed from the DOM: two registered sessions is what makes `bindingSelect` render at all.
      document.querySelector<HTMLButtonElement>('#restore-layout')?.click()
      await until(() => lambdaLeaves().length === 1)
      expect(selectOf('lambda-0')).not.toBeNull()

      // 4. A SOURCE keystroke retires the scratch. THIS is the sweep that had nothing left to sweep: the
      // custody entry was still there and no claim named it. The selector withdrawing is the retire
      // landing — one session left to offer.
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' + 0' } })
      await until(
        () =>
          document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && selectOf('lambda-0') === null,
      )

      // 5. Fork again on the fresh `lambda-0` — a NEW scratch under the SAME constant session id, and a
      // second, legitimately mounted editor.
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')?.click()
      await until(() => editorsIn('lambda-0') > 0)
      const liveHost = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .cm-content')
      if (liveHost === null) throw new Error('the re-forked pane has no editor host')
      const live = EditorView.findFromDOM(liveHost)
      if (live === null) throw new Error('no CodeMirror view mounted under the re-forked pane')

      // 6. Any layout gesture reconciles editors. An unrelated pane's split is the mildest one there is,
      // and it is the step that used to throw before it could paint or persist anything.
      const leavesBefore = leafIds().length
      btn('tm-0', 'split top and bottom')?.click()
      await until(() => leafIds().length === leavesBefore + 1)

      // ONE editor in one λ pane, and it is the LIVE one — not the view over the worker `retire`
      // terminated two steps ago.
      expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(1)
      expect(editorsIn('lambda-0')).toBe(1)
      const afterHost = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .cm-content')
      if (afterHost === null) throw new Error('the λ pane lost its editor host')
      expect(EditorView.findFromDOM(afterHost)).toBe(live)
      // The source editor and this one, and nothing else anywhere on the page.
      expect(document.querySelectorAll('.cm-editor').length).toBe(2)

      // THE TREE, THE DOM AND STORAGE STILL AGREE — the throw's other cost, and the one no assertion
      // about editors would have noticed. `parseLayout` reads back exactly what `applyLayout` persisted.
      const stored = parseLayout(localStorage.getItem(LAYOUT_STORAGE_KEY))
      expect(stored).not.toBeNull()
      expect(
        leaves(stored ?? defaultLayout())
          .map((l) => l.id)
          .sort(),
      ).toEqual([...leafIds()].sort())

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

    btn('source', 'close this pane')?.click()
    await until(() => !leafIds().includes('source'))

    document.querySelector<HTMLButtonElement>('#restore-layout')?.click()
    await until(() => leafIds().includes('source'))

    expect(document.querySelector('[data-leaf="source"] .cm-content')?.textContent).toBe(before)
  })
})
