import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

/**
 * **THE SHARED SURFACES AND THE λ LEG'S TWO VIEWS** — what the ONE status line and the ONE source editor decoration
 * say once the λ leg holds a view of the program and a view of a copy.
 *
 * They used to follow focus: `PaneCollection.active`, the pane the user last focused on the leg, answered for both,
 * through the `focusin` listener `pane-host.ts`'s `hostFor` wires on each host's creation. The check by hand found
 * what that cost on the machine legs: a copy's view focused last took the program's running focus off the program's
 * own view, and the status line named a copy only while its view had been focused last. So neither follows focus
 * onto a copy now. The decoration is the program's λ running focus, read off the most recently focused view of the
 * program, and the status line names every view showing a copy, by its title where the leg has more than one view.
 *
 * **THE TWO VIEWS ARE MADE TO DISAGREE, WHICH IS THE WHOLE FIXTURE.** One λ view is on a copy and the other is back on
 * the program, so what the line and the decoration say can depend on which one has the focus — and each test drives
 * the focus into both, so an answer that followed it would change under the test.
 *
 * THE SENTENCE IS THE REAL ONE, NOT A `/detached/` REGEX — `link-status.ts`'s `detachedText` is where it
 * is written, and matching it exactly is what makes the assertion fail if that clause is reworded into
 * something else about a view rather than merely deleted.
 *
 * THE HARNESS IS `pane-picker.test.ts`'s, WHICH IS `two-lambda-panes.test.ts`'s — the same shell, the
 * same one-mount-per-file `beforeAll` (ES module imports are cached, so `main()` runs once per page and
 * Vitest gives each test FILE its own page), the same `beforeEach` that undoes both drifts a test can
 * leave behind.
 */

/** `link-status.ts`'s `detachedText` for a λ view on a copy named by `title`, beside another λ view, verbatim. */
const lambdaDetached = (title: string) => `${title} view shows a copy — not linked to the program`
/** `link-status.ts`'s λ clause for a pin with no node in the term at this step. */
const NO_NODE = 'this construct has no node in the λ term at this step'

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
  // WIDE ENOUGH FOR ITS ADDS: at the runner's default 414 px a view is 201 px wide, and the app refuses a split or a
  // `+ view` that leaves a view under `MIN_VIEW_PX` (`layout.ts`). The default's 896 px height is kept.
  await page.viewport(1280, 896)
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
      // THE DEFAULT TREE'S FOUR VIEWS: source, λ, asm and TM.
      leafIds().length === 4 &&
      lambdaLeaves().length === 1,
    'the default layout on a settled source program',
  )
})

/**
 * **THE TWO PANES ARE MADE TO DISAGREE, WHICH IS THE WHOLE FIXTURE** — the file header's paragraph of
 * that name, performed. Returns `[scratchLeaf, sourceLeaf]`: the first is `lambda-0` forked onto the λ
 * scratchpad, the second is its split pointed back at the source session.
 *
 * SHARED BY BOTH TESTS BECAUSE BOTH SURFACES NEED THE SAME DISAGREEMENT, and for one reason: the panes
 * must be on two SESSIONS, not merely two leaves. A session owns the history and the detachment flag
 * alike, so two panes on one session answer both questions identically, and neither test could tell an
 * answer that follows the focus onto a copy from one that does not.
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

describe('the app-wide surfaces beside a λ view on a copy', () => {
  /**
   * **THE LINE NAMES THE COPY'S VIEW WHICHEVER λ VIEW HAS THE FOCUS.** It read the λ leg's active view, so with the
   * view of the program focused it said nothing of the copy on screen, and with the copy's focused it said "λ view",
   * which does not say which of the two. Focusing the program's view is the expectation the old reading failed.
   */
  it('the status line names the λ copy by its title whichever of the two λ views has the focus', async () => {
    const [scratchPane, sourcePane] = await twoDisagreeingLambdaPanes()
    const title = titleOf(scratchPane)?.textContent?.trim() ?? ''
    expect(title).toMatch(/^λ · copy \d+$/)

    focusPane(sourcePane)
    expect(status()).toBe(lambdaDetached(title))

    focusPane(scratchPane)
    expect(status()).toBe(lambdaDetached(title))
  })

  /**
   * **THE SOURCE EDITOR'S FOCUS DECORATION IS THE PROGRAM'S λ RUNNING FOCUS, WHICHEVER λ VIEW HAS THE FOCUS** — the
   * λ half of the machine legs' fix (`copy-beside-program.test.ts`). `draw.ts` reads it off the most recently focused
   * view of the program, so focusing the copy's view leaves it where the program's view put it.
   *
   * **WHY THE DECORATION COULD DISAGREE BETWEEN THE TWO VIEWS AT ALL**: a scratch session has no lowering behind it,
   * so every λ frame it records carries `Owner::None` (`session.rs`'s `lambda_state` commentary: "a scratch has no
   * lowering that could have recorded an owner — which is what 'detached' means"), and `runningFocus` answers `null`
   * for `'None'`. Read off the copy's view, the decoration went dark.
   *
   * THE PROGRAM'S VIEW IS PARKED AT STEP 1 RATHER THAN LEFT AT THE FRONTIER, and that is not tidiness.
   * `running-focus.test.ts` records that steps 4-7 of this program are inside `plus` and inside two Church numerals
   * — `Owner::None`, every one — so a settled λ leg sits on an UNMARKED frame and this test would read `''` either
   * way and assert nothing. Step 1 owns `let x = 40;`, and step 2 is inside `x + 2`, which is how stepping the
   * program is seen to move the decoration.
   */
  it('the source editor focus decoration stays the program’s whichever λ view has the focus', async () => {
    const [scratchPane, sourcePane] = await twoDisagreeingLambdaPanes()

    // The two views are on two sessions, so this moves the PROGRAM's play head and leaves the copy's where it is.
    // `↺` first because the settled leg is parked at its frontier.
    transportClick(sourcePane, '↺')
    transportClick(sourcePane, '▶')
    expect(stepTextOf(sourcePane)).toContain('step 1')
    expect(sourceFocusText()).toBe('let x = 40;')

    // THE COPY'S VIEW FOCUSED LAST: the program's focus stands.
    focusPane(scratchPane)
    expect(sourceFocusText(), 'the copy’s view took the program’s focus away').toBe('let x = 40;')

    // THE PROGRAM STEPS, AND THE DECORATION MOVES WITH IT — then the copy's view is focused again.
    transportClick(sourcePane, '▶')
    expect(stepTextOf(sourcePane)).toContain('step 2')
    focusPane(scratchPane)
    expect(sourceFocusText()).toBe('x + 2')
  })

  /**
   * **THE λ CLAUSE IS THE PROGRAM'S VIEW'S, AND IT IS SAID BESIDE THE COPY'S.** `linkStatus` keeps a leg's clauses
   * while any view of the leg shows the program, so `draw.ts` must take the λ link state from a view of the program:
   * the copy's view marks nothing whatever is pinned and would answer `'shown'`, saying nothing about a term of the
   * program's that has no node for the pin. At step 1 `40` has none (`stage.test.ts` has the case).
   */
  it('the λ clause is the program’s view’s whichever of the two λ views has the focus', async () => {
    const [scratchPane, sourcePane] = await twoDisagreeingLambdaPanes()
    const title = titleOf(scratchPane)?.textContent?.trim() ?? ''
    transportClick(sourcePane, '↺')
    transportClick(sourcePane, '▶')
    expect(stepTextOf(sourcePane)).toContain('step 1')

    const src = view.state.doc.toString()
    view.dispatch({ selection: { anchor: src.indexOf('40') } })
    view.focus()
    await userEvent.keyboard("{Control>}'{/Control}")
    await until(() => status().includes(NO_NODE), 'the program’s λ view to say `40` has no node at step 1')
    expect(status().startsWith(lambdaDetached(title))).toBe(true)

    focusPane(scratchPane)
    expect(status(), 'the copy’s view answered for the program’s term').toContain(NO_NODE)
    focusPane(sourcePane)
    expect(status()).toContain(NO_NODE)
  })
})
