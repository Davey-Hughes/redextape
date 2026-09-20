import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

/**
 * **THE SHARED SURFACES FOLLOW FOCUS** — which pane the ONE status line and the ONE source editor
 * decoration are talking about, once a leg holds more than one.
 *
 * `PaneCollection.active` has answered this since the collection gained `#activeByLeg`: the pane the
 * user last focused on that leg, falling back to insertion order. What it did not have was a CALLER —
 * nothing anywhere in the app called `markActive`, so the map stayed empty and `active` degenerated to
 * the `first` it replaced. With two λ panes that made `#link-status` describe whichever pane happened to
 * be created first, whatever the user was working in. The `focusin` listener `pane-host.ts`'s `hostFor`
 * now wires on each host's creation is the missing caller, and this file is what says so from the app.
 *
 * **THE TWO PANES ARE MADE TO DISAGREE, WHICH IS THE WHOLE FIXTURE.** One λ pane is on the scratch (so
 * `detachedPanes().lambda` reads `true` for it) and the other is back on the source session (so it reads
 * `false`), and `#link-status` can only be describing one of them at a time. A test with both panes on
 * one session could not fail against the bug at all: the two answers would be the same sentence.
 *
 * THE SENTENCE IS THE REAL ONE, NOT A `/detached/` REGEX — `link-status.ts`'s `detachedText` is where it
 * is written, and matching it exactly is what makes the assertion fail if that clause is reworded into
 * something else about a pane rather than merely deleted.
 *
 * THE HARNESS IS `pane-picker.test.ts`'s, WHICH IS `two-lambda-panes.test.ts`'s — the same shell, the
 * same one-mount-per-file `beforeAll` (ES module imports are cached, so `main()` runs once per page and
 * Vitest gives each test FILE its own page), the same `beforeEach` that undoes both drifts a test can
 * leave behind.
 */

/** `link-status.ts`'s `detachedText` for a detached λ pane, verbatim. */
const LAMBDA_DETACHED = 'λ view shows a copy — not linked to the program'

const leafIds = () => [...document.querySelectorAll<HTMLElement>('[data-leaf]')].map((e) => e.dataset.leaf ?? '')
const lambdaLeaves = () =>
  [...document.querySelectorAll<HTMLElement>('[data-kind="lambda"]')].map((e) => e.dataset.leaf ?? '')
/** The title-selector of `leaf`'s view — the pair in force is its `data-binding`. */
const titleOf = (leaf: string) => document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-title`)

/** Pick `key` (`bindingKey(leg, session)`) through `leaf`'s title menu, as a user does. */
function pickBinding(leaf: string, key: string): void {
  const title = titleOf(leaf)
  if (title === null) throw new Error(`no title-selector on [data-leaf="${leaf}"]`)
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const item = menu?.querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
  if (item == null) {
    const offered = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b) => b.dataset.binding)
    throw new Error(`[data-leaf="${leaf}"] offers no ${JSON.stringify(key)} — offered: ${JSON.stringify(offered)}`)
  }
  item.click()
}

const editorsIn = (leaf: string) => document.querySelectorAll(`[data-leaf="${leaf}"] .cm-editor`).length
const status = () => document.querySelector('#link-status')?.textContent ?? ''

/**
 * The construct the SOURCE editor's running-focus decoration is currently over, or `''` for none —
 * `running-focus.test.ts`'s reading, with two differences this file's fixture forces.
 *
 * SCOPED TO `#editor`, NOT TO `.cm-editor`. That file has one CodeMirror on the page; this one forks a
 * scratch, and a forked λ pane mounts a SECOND `.cm-editor` inside itself. `#editor` is the element
 * `main.ts` mounts the one source `EditorView` into, so it names the surface `draw.ts` decorates and
 * cannot be satisfied by a mark in a pane's own editor.
 *
 * ALL THREE CLAIM CLASSES, for that file's reason: `exact`, `within` and `coincident` are one
 * decoration wearing whichever class the claim earned, so asking for one of them would read "no focus"
 * on a frame that has one.
 */
const sourceFocusText = () =>
  document.querySelector('#editor .is-focus-exact, #editor .is-focus-within, #editor .is-focus-coincident')
    ?.textContent ?? ''

/** `running-focus.test.ts`'s transport `click`, parameterised by leaf because this file has two λ panes. */
const transportClick = (leaf: string, label: string): void => {
  const b = [...document.querySelectorAll<HTMLButtonElement>(`[data-leaf="${leaf}"] .controls button`)].find(
    (x) => x.textContent === label,
  )
  if (b === undefined) throw new Error(`no "${label}" control on [data-leaf="${leaf}"]`)
  b.click()
}

const stepTextOf = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .step`)?.textContent ?? ''

/**
 * Put focus inside `leaf` and report what the pane's own chrome says its binding is.
 *
 * **THE TITLE-SELECTOR IS THE TARGET RATHER THAN A STEP BUTTON, AND THE CHOICE IS ABOUT WHAT SURVIVES
 * THE REDRAW THE FOCUS ITSELF CAUSES.** The listener under test calls `draw()`, and `draw()` reaches every
 * view: `step-controls.ts`'s `update` hides the continue button the frame recording ends, and
 * `view-header.ts`'s `viewMenu` removes any menu item that stops applying — a focused control caught by
 * either is gone from under its holder. The view header repaints its heading only when the pairs on offer
 * change, so the title is the one control in a view that is guaranteed to still be the same element,
 * still focused, after the frame its own `focusin` painted. It is also exactly what `focusPane` targets
 * for the same document-order reason.
 *
 * IT THROWS ON A MISSING PANE RATHER THAN `?.focus()`, because a silent no-op here would leave focus
 * wherever the previous step put it and every assertion after it would be about the wrong pane.
 */
const focusPane = (leaf: string): void => {
  const title = titleOf(leaf)
  if (title === null) throw new Error(`no title-selector on [data-leaf="${leaf}"]`)
  title.focus()
  if (document.activeElement !== title) throw new Error(`focus did not land on [data-leaf="${leaf}"]`)
}

/**
 * Split `leaf` through `control` into a second pane of the same kind on the same session — the
 * "another view of this" entry, first in every menu. `two-lambda-panes.test.ts`'s `splitSame`, label check and all.
 */
const splitSame = (leaf: string, dir: 'row' | 'column'): void => splitVia(leaf, dir, 'same')

/**
 * Split `leaf` through its `⋯` menu, as a user does: `pick` is `'same'` (another view of this), `'source'`,
 * or a `bindingKey(leg, session)`.
 */
function splitVia(leaf: string, dir: 'row' | 'column', pick: string): void {
  const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
  if (more === null) throw new Error(`no view menu on [data-leaf="${leaf}"]`)
  more.click()
  const menu = document.getElementById(more.getAttribute('aria-controls') ?? '')
  menu?.querySelector<HTMLButtonElement>(`button.view-split[data-dir="${dir}"]`)?.click()
  const selector =
    pick === 'same' ? 'button[data-same]' : pick === 'source' ? 'button[data-source]' : `button[data-binding="${pick}"]`
  const item = menu?.querySelector<HTMLButtonElement>(`.view-menu-pairs ${selector}`)
  if (item == null) {
    const offered = [...(menu?.querySelectorAll<HTMLButtonElement>('.view-menu-pairs button') ?? [])].map(
      (b) => b.textContent,
    )
    throw new Error(`[data-leaf="${leaf}"] offers no ${pick} to split into — offered: ${offered.join(' | ')}`)
  }
  item.click()
}

let view: EditorView

beforeAll(async () => {
  // Each browser test file gets its own in-memory `Storage` now, installed in `tests/browser/setup.ts`
  // before this file's own module body runs — see that file's doc for why clearing a shared key was not
  // enough. Neither key needs clearing here any more.
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

beforeEach(async () => {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
  document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(
    () =>
      document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
      leafIds().length === 3 &&
      lambdaLeaves().length === 1,
    'the default layout on a settled source program',
  )
})

/**
 * **THE TWO PANES ARE MADE TO DISAGREE, WHICH IS THE WHOLE FIXTURE** — the file header's paragraph of
 * that name, performed. Returns `[scratchLeaf, sourceLeaf]`: the first is `lambda-0` forked onto the λ
 * scratchpad, the second is its split pointed back at the source session.
 *
 * SHARED BY BOTH TESTS BECAUSE BOTH `active('lambda')` CONSUMERS NEED THE SAME DISAGREEMENT, and for
 * one reason: the panes must be on two SESSIONS, not merely two leaves. A session owns the history and
 * the detachment flag alike, so two panes on one session answer both questions identically and neither
 * test could fail against a missing `markActive`.
 *
 * THE BINDINGS ARE ASSERTED HERE, BEFORE ANY CALLER LOOKS AT FOCUS. A rebind that never happened would
 * leave both panes on the scratch — where both answers are the same and no expectation downstream could
 * fail. (`pickBinding` throws on a pair the menu does not offer, which the old `select.value = x` did
 * not.)
 */
async function twoDisagreeingLambdaPanes(): Promise<[string, string]> {
  // 1. Fork `lambda-0` onto a scratch buffer — the pane that IS outside the correspondence.
  document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
  await until(() => editorsIn('lambda-0') > 0, 'the fork to mount an editor')
  // THE BUFFER'S OWN PAIR, READ OFF THE PANE THAT WAS JUST FORKED — where step 3 below used to write
  // `('lambda', 'lambda-scratch')`, the fixed id every fork produced under 5d-i's singleton.
  // 5d-ii-c decision 1 mints `scratch-N` per fork and `main()` runs once per test FILE, so the number
  // is a function of how many forks ran before this one and is not writable down here. Capturing the
  // value the fork actually produced is also the stronger statement: step 3 asserts this pane is on THE
  // BUFFER THIS FORK MADE, not merely on something that is not the source session.
  const buffer = titleOf('lambda-0')?.dataset.binding ?? ''
  expect(buffer).not.toBe(bindingKey('lambda', 'source'))

  // 2. Split it, so the leg holds two panes. Both are on the scratch at this point.
  splitSame('lambda-0', 'row')
  await until(() => lambdaLeaves().length === 2, 'the split to add a second λ pane')
  const [first, second] = lambdaLeaves()
  expect(first).toBe('lambda-0')
  expect(second).not.toBe(undefined)

  // 3. Point the new pane back at the source session, so the two panes disagree.
  pickBinding(second ?? '', bindingKey('lambda', 'source'))
  await until(() => titleOf(second ?? '')?.dataset.binding === bindingKey('lambda', 'source'), 'the rebind to take')
  expect(titleOf(first ?? '')?.dataset.binding).toBe(buffer)

  return [first ?? '', second ?? '']
}

describe('the app-wide surfaces describe the pane the user is working in', () => {
  /**
   * **THE CLAIM, AND WHAT MAKES IT FAIL WITHOUT THE LISTENER.** `panes.of('lambda')` here is
   * `[lambda-0, <the split>]` in insertion order, and only the FIRST of those is detached — so with no
   * `markActive` caller, `active('lambda')` answers `lambda-0` forever and the line reads the detachment
   * sentence no matter which pane has focus. The first expectation below is exactly that failure.
   *
   * BOTH DIRECTIONS ARE DRIVEN, NOT ONLY THE ONE THAT WAS BROKEN. Focusing the attached pane must clear
   * the sentence AND focusing the detached one must bring it back — an implementation that marked the
   * wrong leaf, or marked once and never again, satisfies one and not the other.
   */
  it('the status line follows focus between two λ panes that disagree about detachment', async () => {
    const [scratchPane, sourcePane] = await twoDisagreeingLambdaPanes()

    // THE PANE THE USER IS WORKING IN IS THE ATTACHED ONE — nothing is outside the correspondence, so
    // the line has nothing to say. THIS is the expectation the missing caller failed.
    focusPane(sourcePane)
    expect(status()).toBe('')

    // AND BACK: the detached pane is the one being described again.
    focusPane(scratchPane)
    expect(status()).toBe(LAMBDA_DETACHED)
  })

  /**
   * **THE OTHER CONSUMER OF `active('lambda')`, AND IT WAS THE UNTESTED ONE.** `PaneCollection.active`'s
   * own doc names exactly two: `link-wiring.ts`'s `detachedPanes`, which the case above drives, and
   * `draw.ts`'s running-focus decoration on the ONE source editor, which nothing asserted followed
   * focus. The two read the same answer through different code — `drawLink`'s three arms against
   * `setFocus.of(...)` — so a fix that satisfied one is not evidence about the other.
   *
   * **WHY THE DECORATION CAN DISAGREE BETWEEN THE TWO PANES AT ALL**: a scratch session has no lowering
   * behind it, so every λ frame it records carries `Owner::None` (`session.rs`'s `lambda_state`
   * commentary: "a scratch has no lowering that could have recorded an owner — which is what 'detached'
   * means"), and `runningFocus` answers `null` for `'None'`. The source session's frames carry real
   * owners. So "which pane is active" is the whole of whether the editor is marked at all.
   *
   * THE SOURCE PANE IS PARKED AT STEP 1 RATHER THAN LEFT AT THE FRONTIER, and that is not tidiness.
   * `running-focus.test.ts` records that steps 4-7 of this program are inside `plus` and inside two
   * Church numerals — `Owner::None`, every one — so a settled λ leg sits on an UNMARKED frame and this
   * test would read `''` in both directions and assert nothing. Step 1 owns `let x = 40;`.
   *
   * THREE TRANSITIONS, NOT TWO, AND NONE OF THEM IS SATISFIED BY A CONSTANT. Dark on the scratch pane,
   * lit on the source pane, dark again on the scratch: "never paints" fails the middle one and "paints
   * whatever the frontier holds" fails the outer two. Against a missing `markActive`, `active('lambda')`
   * is `lambda-0` — the scratch pane — forever, and the middle expectation is the one that fails.
   */
  it('the source editor focus decoration follows focus between two λ panes on two sessions', async () => {
    const [scratchPane, sourcePane] = await twoDisagreeingLambdaPanes()

    // The two panes are on two sessions, so this moves the SOURCE session's play head and leaves the
    // scratch's where it is. `↺` first because the settled leg is parked at its frontier.
    transportClick(sourcePane, '↺')
    transportClick(sourcePane, '▶')
    expect(stepTextOf(sourcePane)).toContain('step 1')

    // DARK: the pane being described records no owner, so there is nothing to mark.
    focusPane(scratchPane)
    expect(sourceFocusText(), 'a scratch frame owns no construct').toBe('')

    // LIT: the same editor, the same frame on screen, a different active pane.
    focusPane(sourcePane)
    expect(sourceFocusText()).toBe('let x = 40;')

    // AND DARK AGAIN — a decoration that is painted once and never withdrawn passes the line above.
    focusPane(scratchPane)
    expect(sourceFocusText()).toBe('')
  })
})
