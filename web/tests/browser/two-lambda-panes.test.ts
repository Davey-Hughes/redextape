import { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { defaultLayout, LAYOUT_STORAGE_KEY, leaves, parseLayout } from '../../src/layout'

/**
 * TWO λ PANES ON TWO λ SESSIONS, THROUGH THE APP — the claim 5d-i could assert only with hand-built
 * panes.
 *
 * `sessions.ts`'s `SessionRegistry` doc and `binding-selector.test.ts`'s own header both record why that
 * was; the latter, in as many words: "this app has ONE λ pane, so two panes side by side on two λ
 * sessions is still not a state `main()` can reach".
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
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

const leafIds = () => [...document.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf ?? '')
/**
 * The ids of every λ pane — by `data-kind`, NOT by an `id` prefix. `nextLeafId` now mints `pane-${n}`
 * regardless of which leg the split came from (`main.ts`'s own doc on `nextLeafId`: a pane can change
 * which leg it renders, so an id like `lambda-3` would describe something the pane is not), so
 * `dataset.kind` is the only truthful statement of what a leaf renders left to select on.
 */
const lambdaLeaves = () =>
  [...document.querySelectorAll<HTMLElement>('[data-kind="lambda"]')].map((e) => e.dataset.leaf ?? '')
const textOf = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .term`)?.textContent ?? ''
const btn = (leaf: string, label: string) =>
  document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button[aria-label="${label}"]`)
/**
 * Split `leaf` through `control` into a second pane of the same kind on the same session — the gesture
 * every test here reached with a single `btn(leaf, 'split …')?.click()`.
 *
 * **A SPLIT IS TWO CLICKS NOW, AND THE FIRST MENU ENTRY IS WHY IT IS STILL ONE GESTURE.** The control
 * opens a picker (`pane-chrome.ts`'s `splitControl`), whose first item is the pane's own `(leg, session)`
 * pair labelled `(same)` — put there precisely so the case that WAS the whole gesture stays one click
 * away. That is what keeps every test below testing what it always tested: the same pane, duplicated,
 * on the same session, which is how this file reaches two λ panes on one scratch without a rebind.
 *
 * THE MENU IS REACHED THROUGH `aria-controls`, AND THE LABEL IS CHECKED. A pane has two pickers and each
 * keeps the entries it was last opened with, so `[data-leaf] .pane-picker button` could click an item in
 * a popover that is not open; and a missing entry clicked through `?.` is a silent no-op that would
 * leave every assertion after it describing a page nothing happened on.
 */
const splitSame = (leaf: string, control: string): void => {
  const button = btn(leaf, control)
  if (button === null) throw new Error(`no "${control}" control on [data-leaf="${leaf}"]`)
  button.click()
  const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
  const first = menu?.querySelector<HTMLButtonElement>('button') ?? null
  if (first === null || !(first.textContent ?? '').endsWith('(same)')) {
    throw new Error(`${leaf}'s "${control}" menu does not start with the duplicate case: ${first?.textContent}`)
  }
  first.click()
}
const selectOf = (leaf: string) =>
  document.querySelector<HTMLSelectElement>(`[data-leaf="${leaf}"] .pane-binding select`)
/**
 * The λ `<optgroup>`'s own options on `leaf` — WHICH SESSIONS OFFER A λ LEG. The selector lists both
 * legs now, so `select.options` would mix the source session's TM leg into every count; naming the
 * group is what keeps an assertion about the λ sessions about λ.
 */
const lambdaOptionsOf = (leaf: string) =>
  [...document.querySelectorAll(`[data-leaf="${leaf}"] .pane-binding optgroup[label="λ"] option`)].map(
    (o) => o.textContent,
  )
/**
 * The `<option>` value the pane selector encodes a `(leg, session)` pair as — spelled out here rather
 * than imported from `pane-chrome.ts`, so this pins the DOM contract instead of agreeing with whatever
 * the control currently does. `\x00` as an escape is `scripts/check-text-bytes.sh`'s rule.
 */
const optionValue = (leg: string, id: string) => `${leg}\x00${id}`
/**
 * The λ `<option>` for the buffer `leaf` IS BOUND TO RIGHT NOW — which is how the two tests below name
 * the buffer they just forked, where they used to write `optionValue('lambda', 'lambda-scratch')`.
 *
 * **THE ID IS NOT WRITABLE DOWN ANY MORE, AND PINNING THE MINTED ONE WOULD BE THE SAME MISTAKE IN A
 * NEWER SPELLING.** 5d-ii-c decision 1 mints `scratch-N` per fork and never reissues a retired name, and
 * `main()` runs once per test FILE — so the number a given fork lands on is a function of how many
 * forks every test before it performed, including the ones that abort early. A test that hard-codes
 * `scratch-3` passes until an unrelated test above it gains a fork.
 *
 * **IT USED TO IDENTIFY THE BUFFER BY ELIMINATION — "the λ option that is not `source`" — AND THREW
 * UNLESS THERE WAS EXACTLY ONE. Decision 2 made that precondition false for this file.** A source
 * keystroke no longer retires anything, so a fork leaves a buffer in the λ group until something ends
 * it explicitly — and the reset below now does that between tests, which is a change made for the cap
 * (`retireEveryBuffer`) rather than for this helper. **The precondition is NOT restored by it and this
 * helper does not go back**: several of the tests below fork twice within one test, so "exactly one λ
 * option that is not `source`" is false inside a test as well as across the file, and a rule that
 * happened to hold at the top of every test is the kind that fails the day someone forks again. The pane's
 * OWN BINDING is the fact those callers actually needed: the buffer they just forked is the session the
 * forking pane is showing, whatever else is live beside it.
 *
 * IT REFUSES A PANE THAT IS ON `source`, because the callers only ever ask this of a pane that has just
 * forked — returning the source option there would make every assertion after it describe the wrong
 * session, which is precisely what the by-elimination version failed loudly rather than quietly to do.
 */
const boundBufferOptionOf = (leaf: string): HTMLOptionElement => {
  const select = selectOf(leaf)
  if (select === null) throw new Error(`no binding selector on [data-leaf="${leaf}"]`)
  if (select.value === optionValue('lambda', 'source')) {
    throw new Error(`[data-leaf="${leaf}"] is bound to the source session, not to a buffer`)
  }
  const option = [...select.querySelectorAll<HTMLOptionElement>('optgroup[label="λ"] option')].find(
    (o) => o.value === select.value,
  )
  if (option === undefined) throw new Error(`${leaf}'s λ group holds no option for \`${select.value}\``)
  return option
}
const editorsIn = (leaf: string) => document.querySelectorAll(`[data-leaf="${leaf}"] .cm-editor`).length
/**
 * Type `text` into the term editor mounted on `leaf`, replacing whatever is in it.
 *
 * A REAL CodeMirror TRANSACTION THROUGH `EditorView.findFromDOM`, which is `lambda-editor.test.ts`'s
 * own `retype` and the technique the first test below already documents inline: setting `.textContent`
 * and firing a synthetic `InputEvent` never reaches CodeMirror's `docChanged` update listener —
 * CodeMirror owns its DOM and does not read it back — so it is dead code that fires no recompile at
 * all. `LambdaEditor#setText` is no substitute either: it raises a `#seeding` flag for the duration of
 * its dispatch so a fork's seed is never mistaken for a keystroke, which suppresses exactly the
 * recompile a caller here is asking for — `scratch-edit.test.ts`'s file doc states that argument.
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
 * **THE RESET NEEDS THIS BECAUSE THE APP REFUSES A FORK WHILE `MAX_BUFFERS` OF THEM ARE LIVE**
 * (`scratch.ts`, design §4.5's provisional cap), and this file performs more forks across the one page
 * it mounts than the cap admits — every one of them outliving its test unless something here ends it.
 * The reset's own doc has the full account of what that changed; what this helper is, is
 * a loop rather than a sweep, because the app offers no sweep: `ScratchBuffers.retire` takes the buffer
 * it ends and there is deliberately no call that ends them all (decision 2 — nothing ends a buffer
 * implicitly). Driving the rows one at a time is therefore not a roundabout way of doing something
 * simpler; it is the only gesture that exists.
 *
 * THE LIST IS RE-OPENED PER ROW, WHICH IS `buffer-list.ts`'s CONTRACT RATHER THAN A RETRY. Rows are
 * built on `beforetoggle` and the retire handler hides the popover before it fires, so the buttons this
 * loop just walked are gone by the time the retire returns; the count on the button is the loop's
 * condition for exactly that reason — it is the one readout that stays current while the list is closed.
 */
const retireEveryBuffer = (): void => {
  const button = document.querySelector<HTMLButtonElement>('#buffers')
  if (button === null) throw new Error('no #buffers control in the header')
  // The readout is `buffers N ▾` (`bufferList.update`), and `N === 0` is also the state that hides the
  // button — so a loop that trusted the popover to be openable would spin on an empty list.
  for (let guard = 0; (button.textContent ?? '').match(/\d+/)?.[0] !== '0'; guard++) {
    if (guard > 32) throw new Error(`the buffer list will not empty: ${button.textContent}`)
    button.click()
    const row = document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label^="retire "]')
    if (row === null) throw new Error(`${button.textContent} but the open list has no row to retire`)
    row.click()
  }
}
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
 * `beforeAll` wait above was: running this file. Every test below forks, splits and rebinds panes on
 * the ONE app this file mounts (`layout-app.test.ts`'s own multi-`it`-one-`beforeAll` idiom, carried
 * through here), so a test that assumes "exactly one λ leaf" or "this pane is attached" is assuming
 * state only the FIRST test in the file actually starts in. Three facts drift independently, so three
 * are undone independently: the TREE shape, through `restore-layout`; each surviving λ pane's BINDING,
 * through its own selector; and the source PROGRAM, through a dispatch on `view`.
 *
 * **THE MIDDLE ONE USED TO BE A SIDE EFFECT OF THE LAST, AND 5d-ii-c DECISION 2 ENDED THAT.** This
 * block dispatched the source program and relied on `compile.ts`'s `schedule` retiring the newest
 * buffer on the keystroke — which rebound every pane pointed at it back to `source` (`scratch.ts`'s
 * `retire`) and, incidentally, gave the next test an attached λ pane. A keystroke ends no buffer now
 * (design §4.3's table), so `restore-layout` alone leaves a surviving `lambda-0` exactly where the
 * previous test put it: still `[detached]`, still holding that buffer's editor, and offering no fork
 * control at all — under which the next test's `?.click()` on `.controls .detach` is a silent no-op and
 * its first `until` waits on an editor that is already there. Rebinding through the selector is the
 * gesture that still means "put this pane back on the source session", so this asks for it directly
 * rather than as a consequence of something else.
 *
 * **THE BUFFERS ARE RECLAIMED TOO, AND THIS PARAGRAPH USED TO REFUSE TO DO THAT.** It read: *"THE
 * BUFFERS THEMSELVES ARE NOT CLEANED UP, AND THAT IS NOW A CHOICE RATHER THAN A LIMIT... The header
 * list (design §4.2) makes a retire reachable — this reset could open it and empty it between tests —
 * and deliberately does not: the state these tests need undone is the TREE, the BINDINGS and the
 * PROGRAM, and retiring the buffers as well would make every one of them start from a page that has
 * never forked, which is not the page the failures this file guards were found on."* **What falsified
 * it is `scratch.ts`'s `MAX_BUFFERS`**, design §4.5's provisional cap: this file forks more times on
 * the one page it mounts than the cap admits, so without the reclamation below the fork past it is
 * refused and the refusal reaches the click handler as a throw — which is how this was found. So
 * "never clean up" was not a choice about how much state a test inherits; it was an assumption that
 * buffers accumulate without limit, and the app has stopped granting it. The accumulation was also
 * incidental to every claim here: not one test counts the λ group, which is why `boundBufferOptionOf`
 * reads a pane's own binding instead (its own doc has that argument, unchanged).
 *
 * **WHAT THE OLD PARAGRAPH WAS PROTECTING IS WORTH KEEPING AND IS NOT WHAT IT SAID.** A page that has
 * forked before differs from a fresh one in the TREE, the BINDINGS and the PROGRAM — all three of which
 * this block already restores by hand and none of which a retire touches once the panes are home. What
 * a leftover buffer adds beyond those is an extra entry in every selector and an extra worker, and no
 * failure this file guards was found by either.
 *
 * `restore-layout` FIRST, THEN THE REBIND, THEN THE RETIRE. The reset drops the extra leaves a split
 * left behind, so the loop below only ever has the surviving default panes to put back — and a pane the
 * reset re-minted is already on `source` (`pane-host.ts`'s creation loop), so it is skipped rather than
 * rebound twice. The retire goes LAST of the three because by then every buffer is an orphan: no pane
 * is on one, so `ScratchBuffers.retire` moves nothing, and the reclamation cannot be the thing that put
 * a pane back on `source`. (It does destroy any editor the previous test left in custody, which is the
 * point — that editor belongs to a buffer that is ending.)
 */
beforeEach(async () => {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
  document.querySelector<HTMLButtonElement>('#restore-layout')?.click()
  for (const leaf of lambdaLeaves()) {
    const sel = selectOf(leaf)
    if (sel === null || sel.value === optionValue('lambda', 'source')) continue
    sel.value = optionValue('lambda', 'source')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  }
  retireEveryBuffer()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(
    () =>
      document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
      leafIds().length === 3 &&
      lambdaLeaves().length === 1 &&
      // THE λ PANE IS ATTACHED AGAIN, which is the precondition every test's first click depends on and
      // the one this block used to get for free from the retire. `.controls .detach` is offered only on
      // a pane that is not `#detached`.
      document.querySelector('[data-leaf="lambda-0"] .controls .detach') !== null,
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
    splitSame('lambda-0', 'split left and right')
    await until(() => lambdaLeaves().length === 2)
    const [first, second] = lambdaLeaves()

    // 3. Point the new pane back at the source session — 5d-i's selector.
    const sel = selectOf(second ?? '')
    if (sel === null || sel === undefined) throw new Error('the split pane has no binding selector')
    sel.value = optionValue('lambda', 'source')
    sel.dispatchEvent(new Event('change', { bubbles: true }))

    // 4. Edit the scratch so the two sessions genuinely differ — `typeInto`, a REAL CodeMirror
    // transaction through `EditorView.findFromDOM`. Its own doc carries the argument this comment
    // used to spell out here: `.textContent` plus a synthetic `InputEvent` (this test's own former
    // approach) never reaches CodeMirror's `docChanged` update listener, because CodeMirror owns its
    // DOM and does not read it back, so it is dead code that fires no recompile at all.
    const beforeEditFirst = textOf(first ?? '')
    const beforeEditSecond = textOf(second ?? '')
    // THE MARKER IS NOT IN THE SEED, ASSERTED RATHER THAN REASONED — see the assertion below for what
    // this is protecting and what it cost when it was only reasoned.
    expect(beforeEditFirst).not.toContain('u v')
    typeInto(first ?? '', 'λu.λv. u v')

    await until(() => textOf(first ?? '') !== beforeEditFirst && textOf(first ?? '') !== '')

    // The edit reached the pane and changed WHAT IT SHOWS, not merely "differs from the other pane" —
    // which was already true before any edit, from the fork's own alpha-renaming (`x0` vs `x`). A test
    // that only checked the latter would pass even if the edit above did nothing at all.
    expect(textOf(first ?? '')).not.toBe(beforeEditFirst)
    // **AND THE MARKER IS SEED-FREE, WHICH IT WAS NOT.** This term was `λf.λx. f x` and this line read
    // `toContain('f x')` — but the buffer is seeded from `beforeEach`'s `let x = 40; x + 2`, whose λ
    // term is a Church numeral over `f` and `x0` in which `f x0` CONTAINS `f x`. The line was not
    // vacuous, because the `until` and the assertion above exclude the frame captured before the edit;
    // it simply could not tell "the pane shows what I typed" from "the pane showed some other frame of
    // the same numeral", which is not the fact it is written to state. `u`/`v` occur in no Church
    // numeral over `f` and `x0`. The last test in this file has the long form of the argument.
    expect(textOf(first ?? '')).toContain('u v')
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

    splitSame('lambda-0', 'split left and right')
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

    splitSame('lambda-0', 'split left and right')
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
   * **THE SIX-STEP SEQUENCE THAT REACHED DESIGN §4.3's IMPOSSIBLE STATE, RE-POINTED BECAUSE 5d-ii-c
   * DECISION 2 DELETED ITS FOURTH STEP.**
   *
   * WHAT THIS TEST USED TO CLAIM — its name was "destroys a held editor when its session retires,
   * rather than resurrecting it over a live one", an IMPORTANT finding from the re-review of the
   * custody fix. A `heldEditors` entry OUTLIVED its session's death: the retire path (`compile.ts`'s
   * recompile-from-source) called `draw()` and never `applyLayout()`, and `reconcileEditors`'
   * destroy-a-held-editor branch is only reachable from the latter. Fork again on the survivor and the
   * SECOND editor mounted legitimately — then the first layout gesture handed the pane the stale one on
   * top, and `receiveEditor` overwrote `#editor` without removing the previous node. Measured: TWO
   * `.term-editor .cm-editor` in one λ pane, `#editor` pointing at a view over a TERMINATED worker, and
   * the live one orphaned in the DOM where neither `setEditor` nor `destroy` could reach it.
   *
   * **STEP 4 WAS "a SOURCE keystroke retires the scratch", AND A SOURCE KEYSTROKE NOW RETIRES NOTHING.**
   * That branch is guarded by `!sessions.has(session)`, which only a retire produces — and between
   * decision 2 and the header list that inherits poison recovery (design §4.4) there was no retire left
   * in the app at all. (This clause read "the only retire left in the app fires from a fork whose
   * BUILD FAILS — `replies.ts`'s phantom-fork `no-session` — which no gesture can aim at a buffer that
   * has an editor to hold"; the task after the recompile's took that one away as well, so the window was
   * total rather than narrow.) **THIS PARAGRAPH RECORDED THE COVERAGE AS LOST RATHER THAN MOVED "UNTIL
   * THE RETIRE CONTROL SHIPS", AND IT HAS SHIPPED.** Nothing at THIS tier can drive the branch even so —
   * the sequence below is about layout gestures, and no layout gesture ends a session — so the debt is
   * discharged where the branch lives: `tests/browser/editor-custody.test.ts` drives it over the real
   * `createEditorCustody`, and `tests/browser/scratch-buffers.test.ts` drives it through the app's own
   * retire. The record stays because the gap was real and the shape of it is worth keeping.
   *
   * **WHAT IT ASSERTS INSTEAD IS THE FACT THAT REPLACED THAT ONE**: an editor waiting in custody
   * survives a source recompile, because the buffer it belongs to does. The same three opening
   * gestures, and step 4 is still driven — it is still the path that calls `draw()` and never
   * `applyLayout()` — but the claim control's WITHDRAWAL, which used to be how this test saw the retire
   * land, is now asserted not to happen.
   *
   * IT ASSERTS IDENTITY, NOT A COUNT, for the reason it always did: `.term-editor .cm-editor` of 1 is
   * also what "a fresh view was built over the buffer's text" looks like, and a rebuild would lose the
   * user's cursor and undo history — which is exactly what custody exists to keep. The parked cursor is
   * `moves the one editor`'s own technique, for the same reason.
   */
  it('keeps a held editor waiting across a source recompile, and hands back the same instance', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      // 1-2. Fork, then split, so one pane holds the editor and one does not.
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')?.click()
      await until(() => editorsIn('lambda-0') > 0)
      const buffer = boundBufferOptionOf('lambda-0').value
      const heldHost = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .cm-content')
      if (heldHost === null) throw new Error('the forked pane has no editor host')
      const heldView = EditorView.findFromDOM(heldHost)
      if (heldView === null) throw new Error('no CodeMirror view mounted under the forked pane')
      // STATE A REBUILD WOULD DESTROY, parked away from position 0 — the position a freshly constructed
      // `EditorState.create` always starts a document at.
      const cursorAt = heldView.state.doc.length
      heldView.dispatch({ selection: { anchor: cursorAt } })

      splitSame('lambda-0', 'split left and right')
      await until(() => lambdaLeaves().length === 2)
      const [holder, survivor] = lambdaLeaves()
      expect(editorsIn(holder ?? '')).toBe(1)

      // 3. Close the holder — the editor goes into custody rather than being destroyed.
      btn(holder ?? '', 'close this pane')?.click()
      await until(() => lambdaLeaves().length === 1)
      expect(btn(survivor ?? '', 'bring the term editor to this pane')).not.toBeNull()

      // 4. A SOURCE keystroke, which used to retire the buffer here and is now an event in the source
      // session's life only. The `until` waits on the recompile itself, because the thing being
      // asserted is an ABSENCE and it has to be given the time the retire used to take.
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' + 0' } })
      await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle')

      // THE SURVIVOR IS STILL ON THE BUFFER, and the control that would fetch the held editor is still
      // offered — the two surfaces this step used to watch go the other way.
      expect(selectOf(survivor ?? '')?.value).toBe(buffer)
      expect(document.querySelector(`[data-leaf="${survivor}"] h2`)?.textContent).toContain('[detached]')
      expect(btn(survivor ?? '', 'bring the term editor to this pane')).not.toBeNull()

      // 5. Fetch it. THE SAME INSTANCE, with the cursor where the user left it — a held editor that had
      // been destroyed (the old behaviour) leaves this control with nothing to hand over, and one that
      // had been rebuilt comes back at position 0.
      btn(survivor ?? '', 'bring the term editor to this pane')?.click()
      await until(() => editorsIn(survivor ?? '') === 1)
      const backHost = document.querySelector<HTMLElement>(`[data-leaf="${survivor}"] .cm-content`)
      if (backHost === null) throw new Error('the claiming pane has no editor host')
      const back = EditorView.findFromDOM(backHost)
      expect(back).toBe(heldView)
      expect(back?.state.selection.main.head).toBe(cursorAt)

      // 6. Any layout gesture reconciles editors. An unrelated pane's split is the mildest one there is,
      // and it is where a custody entry the reconcile mishandled would surface.
      const leavesBefore = leafIds().length
      splitSame('tm-0', 'split top and bottom')
      await until(() => leafIds().length === leavesBefore + 1)

      expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(1)
      expect(editorsIn(survivor ?? '')).toBe(1)
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
    // THE BUFFER THIS FORK MINTED, CAPTURED WHILE THE PANE IS STILL SHOWING IT — the pane is closed two
    // lines below, and after that nothing on screen names it until this test puts it back.
    const buffer = boundBufferOptionOf('lambda-0').value

    // Close the only λ pane — the editor goes into custody under the scratch session.
    btn('lambda-0', 'close this pane')?.click()
    await until(() => lambdaLeaves().length === 0)

    // `reset layout` mints a FRESH `lambda-0`, the same literal id the custody entry's owner names.
    document.querySelector<HTMLButtonElement>('#restore-layout')?.click()
    await until(() => lambdaLeaves().length === 1)
    expect(lambdaLeaves()).toEqual(['lambda-0'])

    // Point it at the buffer, which is still live — no pane's death retires a session.
    //
    // **THE VALUE IS THE FORKING PANE'S OWN BINDING, WHERE THIS LINE USED TO WRITE THE SESSION ID DOWN
    // AND THEN, BRIEFLY, TO FIND IT BY ELIMINATION.** It said `optionValue('lambda', 'lambda-scratch')`,
    // the fixed id 5d-i's singleton gave every fork; decision 1 mints one per fork, so there is no id to
    // write; and decision 2 keeps every earlier test's buffer alive in this same page, so "the λ option
    // that is not source" no longer names one thing. `boundBufferOptionOf`'s own doc has the argument.
    const sel = selectOf('lambda-0')
    if (sel === null || sel === undefined) throw new Error('the restored λ pane has no binding selector')
    sel.value = buffer
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    // THE REBIND TOOK — asserted rather than assumed, because every assertion below would otherwise
    // pass on a pane that never went near the buffer. `select.value` silently stays `''` for an option
    // the list does not hold, so the first line is a real check that the buffer outlived the close and
    // the reset; the other two say the pane MOVED off the session `reset layout` restored it on, and
    // `[detached]` is `SessionEntry.detached` for the session it actually ended up on, which only a
    // buffer sets.
    expect(sel.value).toBe(buffer)
    expect(sel.value).not.toBe(optionValue('lambda', 'source'))
    expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('[detached]')

    // A layout gesture on an UNRELATED pane. This is where the editor used to arrive unbidden.
    const leavesBefore = leafIds().length
    splitSame('tm-0', 'split top and bottom')
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
   * The custody-sweep fix (the test above, when it was `destroys a held editor when its session
   * retires`) made every retire call `reconcileEditors`. The claim fix (`does not deliver a held editor
   * to a pane that merely inherited the owner leaf id`, above) makes `applyLayout` drop an `editorOwner`
   * claim when its leaf id arrives fresh — which is what `reset layout` does to a closed pane's claim.
   * But `reconcileEditors` ran both of its passes over `editorOwner.keys()`, so dropping the claim
   * removed the custody entry from the only domain either pass could see: the entry became unreachable
   * from the function that owns both of its endings.
   *
   * NEITHER TEST ABOVE REACHES THIS. The custody one never calls `reset layout`, so its claim survives;
   * the claim one never puts a second buffer's editor on the pane afterwards. Six clicks with both
   * halves in one sequence do — and what was measured in the running app before the fix is three
   * separate failures from one cause: E1 survived; the sixth step threw `a λ pane was handed a second
   * editor while still holding one` out of `reconcileEditors` -> `applyLayout` -> the click handler, so
   * `renderLayout`, `writeLayoutStorage` and `draw` never ran (the model gained a leaf, the DOM did not,
   * and storage kept the old tree); and E1 LEAKED permanently, because `heldEditors.delete` ran before
   * the `receiveEditor` that threw.
   *
   * **STEP 4 USED TO RETIRE THE BUFFER, AND THE OUTCOME IT SET UP WAS "E1 IS DESTROYED".** 5d-ii-c
   * decision 2 removes the retire from the source keystroke — and then from the failed fork as well, so
   * no gesture in the app retired anything until design §4.4's control landed. (This clause named
   * "`replies.ts`'s phantom-fork `no-session`" as the one that was left.) The sequence now ends with E1
   * STILL IN CUSTODY, and step 7 asks for it back through the real control. Getting the SAME
   * `EditorView` proves the entry survived every step of this sequence and is still reclaimable. **THE
   * HEADER LIST'S RETIRE IS NOT SUBSTITUTED FOR STEP 4 HERE**, deliberately: this sequence is about a
   * custody entry surviving LAYOUT gestures, and ending the buffer in the middle of it would replace the
   * claim under test with a different one that `scratch-buffers.test.ts` already makes.
   *
   * **WHAT STEP 7 DOES NOT DO IS GUARD THE THIRD ROUND'S DOMAIN FIX, AND THIS PARAGRAPH SAID IT DID.**
   * That fix made the custody pass iterate `heldEditors` rather than `editorOwner.keys()`. Mounting a
   * held editor needs `editorHomeFor` to resolve, which needs an `editorOwner` claim — and "bring the
   * term editor to this pane" installs one (`pane-host.ts`'s `showEditor`) BEFORE the `applyLayout` it
   * triggers reconciles. So by the time the pass runs at step 7 the entry IS claimed, and a pre-fix
   * pass over `editorOwner.keys()` would have found it too. **The only ending that tells the two
   * domains apart is the destroy branch** (`!sessions.has`), which needs a retire — so that regression
   * guard was LOST, not relocated, until the retire control landed. **IT HAS LANDED AND THE DEBT IS
   * PAID**: `tests/browser/editor-custody.test.ts` drives that branch over a custody object built by
   * `createEditorCustody` with an entry no claim names, which is the domain distinction stated directly
   * rather than inferred from a sequence of clicks.
   *
   * IT ASSERTS ALL THREE, NOT ONLY THE THROW. The leaf count is read from the DOM (`leafIds`) and
   * checked against the tree in `localStorage`, which is the tree/DOM/storage agreement the throw used
   * to break; each surviving editor is checked by IDENTITY against the view its own fork mounted,
   * because a count is also what "the wrong view won" looks like.
   */
  it('keeps a held editor whose claim was dropped by reset layout reachable, rather than losing or resurrecting it', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      // 1. Fork, so `lambda-0` holds the one editor and `editorOwner` claims `lambda-0` for the buffer.
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')?.click()
      await until(() => editorsIn('lambda-0') > 0)
      // THE BUFFER AND ITS EDITOR, CAPTURED WHILE A PANE IS STILL SHOWING THEM — step 3 asserts the
      // buffer survived the close and the reset, step 4 that it survived the recompile, and step 7 that
      // this exact `EditorView` is what comes back. The label used to be the constant `'λ scratchpad'`,
      // which is what `main.ts` called its one scratch session before a fork minted a name per call.
      const bufferA = boundBufferOptionOf('lambda-0')
      const valueA = bufferA.value
      const labelA = bufferA.textContent ?? ''
      const heldHost = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .cm-content')
      if (heldHost === null) throw new Error('the forked pane has no editor host')
      const heldA = EditorView.findFromDOM(heldHost)
      if (heldA === null) throw new Error('no CodeMirror view mounted under the forked pane')

      // 2. Close it — the editor goes into custody, and the claim still names `lambda-0`.
      btn('lambda-0', 'close this pane')?.click()
      await until(() => lambdaLeaves().length === 0)

      // 3. `reset layout` re-mints the literal `lambda-0`, which DROPS the claim. The buffer is
      // untouched by any of this — no pane's death retires one — and the pane selector is how that is
      // observed from the DOM: a session offering a λ leg is an entry in the λ group.
      //
      // **READ THROUGH THE λ GROUP RATHER THAN THROUGH THE CONTROL'S PRESENCE, WHICH IS WHAT THESE TWO
      // STEPS USED TO DO.** They asserted `selectOf('lambda-0')` non-null here and null after the
      // retire, because the control listed SESSIONS and withdrew below two. It lists `(leg, session)`
      // PAIRS now and the source session alone contributes two, so it never withdraws — the fact both
      // steps were reaching for is which sessions offer a λ leg, and that is what the group says.
      //
      // `toContain`, NOT `toEqual(['source', forked])`: decision 2 keeps every earlier test's buffer
      // alive on this one page, so the group is as long as this file's fork count. What this step needs
      // is that THIS buffer is in it, which is what naming it says.
      document.querySelector<HTMLButtonElement>('#restore-layout')?.click()
      await until(() => lambdaLeaves().length === 1)
      expect(lambdaOptionsOf('lambda-0')).toContain(labelA)

      // 4. A SOURCE keystroke, which retired the buffer here until decision 2 and is now the step that
      // proves it does not: the entry is still in the λ group afterwards, so the custody entry it keys
      // is still an entry for a LIVE session — which is precisely the state the destroy branch must not
      // fire in, and the state the rest of this test runs in.
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' + 0' } })
      await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle')
      expect(lambdaOptionsOf('lambda-0')).toContain(labelA)

      // 5. Fork again on the fresh `lambda-0` — a SECOND buffer, and a second, legitimately mounted
      // editor. This is what makes step 6 a collision rather than a no-op: one live editor on the pane,
      // one in custody under a session no claim names.
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')?.click()
      await until(() => editorsIn('lambda-0') > 0)
      const liveHost = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .cm-content')
      if (liveHost === null) throw new Error('the re-forked pane has no editor host')
      const live = EditorView.findFromDOM(liveHost)
      if (live === null) throw new Error('no CodeMirror view mounted under the re-forked pane')
      expect(live).not.toBe(heldA)
      expect(selectOf('lambda-0')?.value).not.toBe(valueA)

      // 6. Any layout gesture reconciles editors. An unrelated pane's split is the mildest one there is,
      // and it is the step that used to throw before it could paint or persist anything.
      const leavesBefore = leafIds().length
      splitSame('tm-0', 'split top and bottom')
      await until(() => leafIds().length === leavesBefore + 1)

      // ONE editor mounted in one λ pane, and it is the SECOND fork's — the held one was neither handed
      // to this pane (the throw) nor destroyed on the way past.
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

      // 7. **AND E1 IS STILL THERE TO BE ASKED FOR — THE ASSERTION THAT REPLACES "IT WAS DESTROYED".**
      // Nothing in the app has named that session since step 2 and its claim was dropped in step 3, so
      // the only place it can have survived four steps and two layout gestures is `heldEditors`. A
      // second pane, pointed at buffer A, asks for it through the real control; the view that arrives is
      // checked by identity, because a fresh editor over the same text would satisfy every count here
      // and would be exactly the silent loss custody exists to prevent.
      //
      // **THIS IS A SURVIVAL CHECK, NOT A CHECK OF THE PASS'S DOMAIN** — the claim control re-claims the
      // session before `applyLayout` reconciles, so the entry is claimed again by the time the custody
      // pass sees it and a pass over `editorOwner.keys()` would reach it too. See this test's own doc.
      splitSame('lambda-0', 'split left and right')
      await until(() => lambdaLeaves().length === 2)
      const asker = lambdaLeaves()[1]
      const askerSelect = selectOf(asker ?? '')
      if (askerSelect === null || askerSelect === undefined) throw new Error('the split pane has no binding selector')
      askerSelect.value = valueA
      askerSelect.dispatchEvent(new Event('change', { bubbles: true }))
      expect(askerSelect.value).toBe(valueA)

      const claim = btn(asker ?? '', 'bring the term editor to this pane')
      expect(claim).not.toBeNull()
      claim?.click()
      await until(() => editorsIn(asker ?? '') === 1)
      const askerHost = document.querySelector<HTMLElement>(`[data-leaf="${asker}"] .cm-content`)
      if (askerHost === null) throw new Error('the claiming pane has no editor host')
      expect(EditorView.findFromDOM(askerHost)).toBe(heldA)
      // ONE EDITOR PER BUFFER, EACH ON THE PANE BOUND TO IT — B's is untouched by A's arrival, which is
      // the pair of facts the sweep's own two predicates (a live session, a pane that names it) exist
      // to keep true now that buffers are plural.
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

    btn('source', 'close this pane')?.click()
    await until(() => !leafIds().includes('source'))

    document.querySelector<HTMLButtonElement>('#restore-layout')?.click()
    await until(() => leafIds().includes('source'))

    expect(document.querySelector('[data-leaf="source"] .cm-content')?.textContent).toBe(before)
  })

  /**
   * **IMPORTANT FINDING, REVIEW OF TASKS 1+2 AS A UNIT — `reconcileEditors`' SWEEP ASSUMED THE APP HELD
   * AT MOST ONE SCRATCH EDITOR, AND THE SINGLETON WAS CONCEALING THE ASSUMPTION RATHER THAN SATISFYING
   * IT BY DESIGN.**
   *
   * The sweep means "the editor belonging to session S lives on `home(S)`", but a `LambdaPane` does not
   * record whose editor it is holding — so the loop asked every λ pane for its editor and handed
   * whatever came back to S's home. That was equivalent to the intended meaning only while there could
   * be one such editor at a time, which is what 5d-i's singleton produced by accident: a second fork
   * REBOUND to the existing scratch, so `custody.claim` overwrote one `editorOwner` entry rather than
   * adding a second, and no second `scratch-compiled` ever fired. Two λ panes could not both hold an
   * editor. **A fork that mints its own buffer (5d-ii-c decision 1) makes that state ordinary**, and the
   * sweep then takes buffer B's editor off B's own pane and hands it to A's home, where
   * `LambdaPane.receiveEditor` throws `a λ pane was handed a second editor while still holding one`.
   *
   * **THE COST IS NOT ONLY THE THROW.** `takeEditor()` has already nulled B's pane by the time
   * `receiveEditor` raises, and nothing has taken custody of the returned view — so the app's last
   * reference to a live `EditorView` with its own pending debounce is dropped on the floor, which is the
   * exact leak the third review round fixed on the custody pass by moving `heldEditors.delete` after the
   * mount. `applyLayout`'s `try`/`finally` keeps the tree, the DOM and `localStorage` agreeing through
   * it; the editor is gone either way, and the exception reaches `window`'s `error` event.
   *
   * **FIVE GESTURES, ALL OF THEM ORDINARY, AND THIS TEST IS EXACTLY THOSE FIVE.** Fork `lambda-0`;
   * split it; rebind the new pane back to source through its own selector; fork THAT pane, which mints a
   * second buffer and mounts a second editor; then perform any layout gesture at all — a split of the TM
   * pane is the mildest one there is. I recorded this as a Task 8 concern on the grounds that no test
   * failed today and behaviour had therefore not changed; **the premise was false and the review was
   * right to block on it**, because the reachable-in-five-clicks defect and the "not yet reachable"
   * story are two different things for whoever reads this next.
   *
   * THE MISSING PREDICATE IS THE PANE'S OWN BINDING. A λ pane only ever comes to hold an editor while
   * bound to that editor's session — `replies.ts`'s `scratch-compiled` arm mounts through
   * `editorHomeFor`, which checks the binding, and `receiveEditor` is only ever handed an editor by this
   * sweep — so `p.slot.binding.session === session` is the fact the loop was missing. The "bring the
   * term editor to this pane" flow it exists to serve satisfies it by construction: that control is only
   * offered on a pane already bound to the session (`LambdaPane.#refreshClaim`'s `#detached` gate), so
   * both the pane losing the editor and the pane gaining it name S.
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
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')?.click()
      await until(() => editorsIn('lambda-0') > 0)
      const bufferA = selectOf('lambda-0')?.value ?? ''
      expect(bufferA).not.toBe(optionValue('lambda', 'source'))

      // 2. Split it. Both panes are on A; only `lambda-0` holds the editor.
      splitSame('lambda-0', 'split left and right')
      await until(() => lambdaLeaves().length === 2)
      const [first, second] = lambdaLeaves()
      expect(first).toBe('lambda-0')
      expect(editorsIn(second ?? '')).toBe(0)

      // 3. Rebind the new pane back to source, so it can be forked in its own right — a pane already on
      // a buffer is offered no fork control (`#refreshDetach`'s `!this.#detached` gate).
      const sel = selectOf(second ?? '')
      if (sel === null || sel === undefined) throw new Error('the split pane has no binding selector')
      sel.value = optionValue('lambda', 'source')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      await until(() => document.querySelector(`[data-leaf="${second}"] .controls .detach`) !== null)

      // 4. Fork it — buffer B, a SECOND buffer live at the same time, and a second editor.
      document.querySelector<HTMLButtonElement>(`[data-leaf="${second}"] .controls .detach`)?.click()
      await until(() => editorsIn(second ?? '') > 0)
      const bufferB = selectOf(second ?? '')?.value ?? ''
      expect(bufferB).not.toBe(optionValue('lambda', 'source'))
      // THE FIXTURE'S WHOLE POINT: two panes, two DIFFERENT buffers. A second fork that rebound to the
      // existing buffer — the singleton's behaviour — would make every assertion below vacuous.
      expect(bufferB).not.toBe(bufferA)

      const hostA = document.querySelector<HTMLElement>(`[data-leaf="${first}"] .cm-content`)
      const hostB = document.querySelector<HTMLElement>(`[data-leaf="${second}"] .cm-content`)
      if (hostA === null || hostB === null) throw new Error('one of the two forked panes has no editor host')
      const viewA = EditorView.findFromDOM(hostA)
      const viewB = EditorView.findFromDOM(hostB)
      if (viewA === null || viewB === null) throw new Error('one of the two forked panes has no CodeMirror view')
      expect(viewA).not.toBe(viewB)

      // 5. Any layout gesture reconciles editors. This is the click that threw.
      const leavesBefore = leafIds().length
      splitSame('tm-0', 'split top and bottom')
      await until(() => leafIds().length === leavesBefore + 1)

      // EACH EDITOR IS STILL ON THE PANE THAT FORKED IT, and it is the same instance.
      expect(editorsIn(first ?? '')).toBe(1)
      expect(editorsIn(second ?? '')).toBe(1)
      expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(2)
      const afterA = document.querySelector<HTMLElement>(`[data-leaf="${first}"] .cm-content`)
      const afterB = document.querySelector<HTMLElement>(`[data-leaf="${second}"] .cm-content`)
      if (afterA === null || afterB === null) throw new Error('a λ pane lost its editor host')
      expect(EditorView.findFromDOM(afterA)).toBe(viewA)
      expect(EditorView.findFromDOM(afterB)).toBe(viewB)
      // And the panes still disagree about which buffer they show, so nothing was quietly rebound.
      expect(selectOf(first ?? '')?.value).toBe(bufferA)
      expect(selectOf(second ?? '')?.value).toBe(bufferB)

      // THE THROW ITSELF — `applyLayout`'s `try`/`finally` keeps the tree, the DOM and storage agreeing
      // through an escaping exception, so no assertion above can see one; `window`'s `error` event is
      // where it surfaces and nowhere else.
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * **THE HEADLINE OF 5d-ii-c — TWO λ PANES ON TWO DIFFERENT SCRATCH BUFFERS, SIDE BY SIDE, EACH
   * SHOWING ITS OWN TERM** (design §5, which names it as this slice's browser-tier claim).
   *
   * **IT IS THIS FILE'S FIRST TEST ONE STEP ON, AND THE STEP IS THE WHOLE SLICE.** That one reaches two
   * λ SESSIONS — a buffer beside the source session — which 5d-i's singleton already allowed. Two
   * BUFFERS is the state the singleton made unreachable: a second fork REBOUND the forking pane to the
   * buffer the first one built rather than minting another (`scratch.ts`'s `fork` doc records the `has`
   * branch that did it), so however many λ panes the layout tree could reach, the app could never show
   * two scratch terms at once. Decision 1 mints one per fork, and this is that claim on screen.
   *
   * **IT ASSERTS ON WHAT EACH PANE RENDERS RATHER THAN ON WHAT ITS SELECTOR IS LABELLED** — §5's rule,
   * and here the rule has teeth in a way a label check cannot reproduce: two panes bound to ONE buffer
   * under two different names would satisfy every comparison of ids and labels below, and that is
   * precisely the state the singleton produced. So each buffer is given a term of its own THROUGH ITS
   * OWN EDITOR, and each pane is then asserted to show its term AND NOT THE OTHER'S — a shared buffer
   * fails that pair in both directions at once.
   *
   * **THE KEYSTROKES ARE NOT DECORATION.** Both forks are seeded from the same source program, so an
   * unedited buffer renders what its sibling renders and "each pane shows its own term" would be true
   * of a page with one buffer on it. The edits are what make the two terms name the two sessions.
   *
   * **AND THE λ GROUP IS ASSERTED WHOLE, WHICH IS THE PAIR LIST'S FIRST REAL EXERCISE** (design §3.2).
   * That group has never carried more than one scratch. `sessions.ts`'s `pairs()` keeps registration
   * order within each leg's group and `paneSelect` appends in the order it is handed, so `source`
   * followed by the two buffers in fork order is a statement about what the control OFFERS rather than
   * a length any two entries would satisfy. Both panes are asked, because the selector is rendered per
   * pane and a pair list that reached only the pane that forked last would still be broken.
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
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')?.click()
      await until(() => editorsIn('lambda-0') > 0)
      const optionA = boundBufferOptionOf('lambda-0')
      const valueA = optionA.value
      const labelA = optionA.textContent ?? ''

      // 2. Give A a term of its own, through its own editor.
      //
      // THE WAIT IS ON THE MARKER, NOT ON "THE TEXT CHANGED". The keystroke is debounced and reduced on
      // the buffer's OWN thread, so the pane is the only thing that can say the round trip finished —
      // but a buffer's first frame can land after its editor does, and a wait any change satisfies
      // would let that seed frame stand in for the edit and hand the assertions below a term the
      // keystroke never produced.
      //
      // **AND THE MARKER IS CHOSEN AGAINST THE SEED, WHICH IS NOT A FORMALITY: THE FIRST CHOICE HERE
      // WAS VACUOUS.** Both buffers are seeded from `let x = 40; x + 2`, whose λ term is the Church
      // numeral `λf. λx0. f (f (f … (f x0)))` — so `f x`, the marker this step was first written with
      // and the one this file's first test used to match on, IS ALREADY IN THE SEED as the head of
      // `f x0`: the wait and the match below both passed on a pane the keystroke had not reached yet.
      // `p`/`q` and `m`/`n` occur nowhere in a Church numeral over `f` and `x0`.
      //
      // **AND THAT IS ASSERTED ON THE LINE BELOW RATHER THAN LEFT TO THIS PARAGRAPH**, because a
      // comment is what it was left to the first time. `not.toBe(seededA)` is what caught it, and
      // `not.toContain` is what names it: if the sample program ever grows the marker, the failure
      // says so instead of reading as a term mismatch. The first test carries the same pair.
      await until(() => textOf('lambda-0') !== '')
      const seededA = textOf('lambda-0')
      expect(seededA).not.toContain('p q')
      typeInto('lambda-0', 'λp.λq. p q')
      await until(() => textOf('lambda-0').includes('p q'))
      const termA = textOf('lambda-0')
      expect(termA).not.toBe(seededA)

      // 3. Split. Both panes are on A — the picker's first entry is the pane's own pair — and this is
      // the state the test has to get PAST: one buffer shown twice is what 5d-ii-a could already reach
      // and what a second fork used to collapse back to.
      splitSame('lambda-0', 'split left and right')
      await until(() => lambdaLeaves().length === 2)
      const [first, second] = lambdaLeaves()
      expect(first).toBe('lambda-0')
      expect(selectOf(second ?? '')?.value).toBe(valueA)
      await until(() => textOf(second ?? '') !== '')
      expect(textOf(second ?? '')).toBe(termA)

      // 4. Put the new pane back on the source session, which is what makes it forkable.
      const sel = selectOf(second ?? '')
      if (sel === null || sel === undefined) throw new Error('the split pane has no binding selector')
      sel.value = optionValue('lambda', 'source')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      await until(() => document.querySelector(`[data-leaf="${second}"] .controls .detach`) !== null)

      // 5. Fork IT — buffer B, MINTED RATHER THAN REBOUND, and that is asserted before anything is
      // awaited. `fork` rebinds the slot synchronously and the click's own repaint carries the new
      // pair into the selector — `scratch-cap.test.ts` asserts `[detached]` on the heading with nothing
      // awaited after its own fork click, for exactly that reason — so the mint is observable here, and putting
      // the check ahead of the wait is what makes 5d-i's singleton fail this test on the CLAIM rather
      // than by timing out on an editor its rebind was never going to mount.
      document.querySelector<HTMLButtonElement>(`[data-leaf="${second}"] .controls .detach`)?.click()
      const optionB = boundBufferOptionOf(second ?? '')
      const valueB = optionB.value
      const labelB = optionB.textContent ?? ''
      expect(valueB).not.toBe(valueA)
      // THE LABEL IS NEARLY IMPLIED BY THE VALUE — it is the value's own suffix respelled, and `fork`
      // composes both from one counter. It is kept because the λ-group assertion at the end of this
      // test is written in LABELS, and two buffers sharing one would make that `toEqual` unable to
      // tell them apart while still passing.
      expect(labelB).not.toBe(labelA)
      await until(() => editorsIn(second ?? '') > 0)

      // 6. And give B its own term, through B's own editor — the same marker wait, for step 2's reason.
      await until(() => textOf(second ?? '') !== '')
      const seededB = textOf(second ?? '')
      expect(seededB).not.toContain('n m')
      typeInto(second ?? '', 'λm.λn. n m')
      await until(() => textOf(second ?? '').includes('n m'))
      expect(textOf(second ?? '')).not.toBe(seededB)

      // **THE HEADLINE, READ OFF BOTH PANES AT ONE MOMENT.** Each shows the term typed into ITS buffer
      // and not the term typed into the other's — the pair of checks a single shared buffer fails
      // whichever of the two terms it happens to be holding.
      //
      // THE TWO HALVES CATCH DIFFERENT SHAPES, WHICH IS WHY BOTH ARE HERE AND WHY ONLY THE FIRST HALF
      // HAS EVER BEEN SEEN TO FIRE. A pane rendering the WRONG session shows exactly one marker, so
      // `toContain` is what reports it; `not.toContain` reports a pane whose text carries BOTH — a
      // buffer seeded from another buffer's text, or a pane accumulating frames instead of replacing
      // them — which no single-point mutation of the fork, the recompile or the pair list produces.
      // They are the cheap half of a claim whose expensive half is already paid for, not evidence.
      expect(textOf(first ?? '')).toContain('p q')
      expect(textOf(second ?? '')).toContain('n m')
      expect(textOf(first ?? '')).not.toContain('n m')
      expect(textOf(second ?? '')).not.toContain('p q')

      // AND A's TERM IS STILL EXACTLY THE ONE A's KEYSTROKE PUT THERE — character for character,
      // untouched by B being forked, seeded and edited beside it. "Different" is the weaker claim and
      // a re-seeded A would satisfy it; this is what "its own" means.
      expect(textOf(first ?? '')).toBe(termA)
      expect(selectOf(first ?? '')?.value).toBe(valueA)
      expect(selectOf(second ?? '')?.value).toBe(valueB)

      // **THE PAIR LIST CARRYING MORE THAN ONE λ SCRATCH, FOR THE FIRST TIME** — the source session's λ
      // leg and both buffers, in registration order, in EITHER pane's selector.
      expect(lambdaOptionsOf(first ?? '')).toEqual(['source', labelA, labelB])
      expect(lambdaOptionsOf(second ?? '')).toEqual(['source', labelA, labelB])

      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })
})
