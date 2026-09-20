import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

/**
 * **A MENU ITEM NEVER LEAVES THE FOCUS ON `<body>`** — spec §11's categorical rule, accessibility item 1,
 * and a class of defect rather than a control: whole-branch review finding C1 named one instance, and
 * the sibling search its fix asked for found two more.
 *
 * **THE MECHANISM, MEASURED IN CHROME RATHER THAN REASONED ABOUT — AND THE FIRST TWO GUESSES WERE BOTH
 * WRONG.** It is not that focus is stranded on the hidden menu item. `hidePopover()` RESTORES focus to
 * whatever held it before the popover opened, so a menu item on its own never strands anything. What
 * strands it is the gesture that runs next: if it rebuilds the tree, `renderLayout`'s
 * `root.replaceChildren()` detaches the host that the restored element lives in, and focus falls to
 * `<body>` a frame later. So the rule this file checks has two conditions, not one — the gesture must
 * rebuild the layout AND the focus must have been inside a view — and a gesture that does neither is
 * safe without any handler doing anything about it.
 *
 * **WHICH IS WHY THE BASELINE IN `beforeEach` IS LOAD-BEARING AND NOT TIDINESS.** Because focus is
 * restored to the pre-open element, a test that begins on `<body>` ends on `<body>` whatever the gesture
 * did, and one that begins on a header control ends on that control — the header is outside `<main>` and
 * survives every rebuild. Both read as a pass. Only a starting point INSIDE a view can tell the two
 * apart, and the file went through both wrong baselines before that was measured: with focus starting on
 * `#new-view`, removing the fix under test changed nothing and all five cases passed.
 *
 * **MEASURED ACROSS A FRAME, NOT SYNCHRONOUSLY.** `document.activeElement` read at the end of the click
 * handler still names the pre-open element on the broken path and the fixed one alike — the blur has not
 * happened yet. Every assertion below therefore waits two animation frames first.
 *
 * **WHAT IT DOES NOT COVER.** `⋯` → *move the editor here* is C1's own instance and is pinned where the
 * editor-custody state it needs already exists (`two-lambda-panes.test.ts`, "keeps the focus in the view
 * that took the editor"). The copies menu's rows place focus deliberately and `copies-undo.test.ts` pins
 * that; the rule they follow is §11's third, not this one.
 */

/** Where the focus is, named so a failure says it rather than printing an element. */
const where = (): string => {
  const a = document.activeElement
  if (a === null || a === document.body) return '<body>'
  const cls = a.className === '' ? '' : `.${String(a.className).split(' ').join('.')}`
  return `${a.tagName.toLowerCase()}${a.id === '' ? '' : `#${a.id}`}${cls}`
}

/** Two frames — one for the style recalc that hides the menu, one for the blur that follows it. */
const settled = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

/**
 * Drive one menu the way a user does: open it, check the open put the focus inside it, activate an item.
 *
 * The focus-is-inside-the-menu check is the precondition the whole file rests on. Without it a gesture
 * that never took the focus in the first place would satisfy every assertion below while proving
 * nothing — which is exactly how the seven existing `button.claim-editor` call sites missed C1.
 */
async function throughMenu(
  openerSel: string,
  pick: (items: readonly HTMLButtonElement[]) => HTMLButtonElement | undefined,
  what: string,
): Promise<void> {
  const opener = document.querySelector<HTMLButtonElement>(openerSel)
  if (opener === null) throw new Error(`${what}: no opener at ${openerSel}`)
  opener.click()
  const menu = document.getElementById(opener.getAttribute('aria-controls') ?? '')
  if (menu === null) throw new Error(`${what}: ${openerSel} controls no menu`)
  const items = [...menu.querySelectorAll<HTMLButtonElement>('button')]
  const item = pick(items)
  if (item === undefined) {
    const offered = items.map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim())
    throw new Error(`${what}: no such item — offered ${JSON.stringify(offered)}`)
  }
  expect(menu.contains(document.activeElement), `${what}: opening the menu did not put focus in it`).toBe(true)
  item.click()
  await settled()
}

const label = (b: HTMLButtonElement): string => (b.textContent ?? '').replace(/\s+/g, ' ').trim()

let view: EditorView

beforeAll(async () => {
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

// Back to the default three views before each gesture, since several of these change the tree.
beforeEach(async () => {
  document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(
    () =>
      document.querySelectorAll('[data-leaf]').length === 3 &&
      document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle',
    'the default views',
  )
  // **A KNOWN STARTING POINT INSIDE A VIEW — the file doc has the argument, and both of the other two
  // choices were tried and measured useless.** `<body>` (what the reset above leaves when its own fix is
  // removed) makes every later case report `<body>` whatever its gesture did: sabotaging ONE fix turned
  // three tests red, two of them only inheriting the first's. A header control (`#new-view`) makes every
  // case report a pass, because the header is outside `<main>` and no rebuild touches it: sabotaging that
  // same fix turned NOTHING red. A control inside a view is the only baseline that discriminates, and
  // with it the sabotage fails exactly the one case whose fix was removed.
  document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-title')?.focus()
  expect(where(), 'the baseline focus did not take').toBe('button.view-title')
})

describe('a menu item hands the focus on', () => {
  it('the title menu, picking the other leg', async () => {
    await throughMenu(
      '[data-leaf="lambda-0"] button.view-title',
      (i) => i.find((b) => label(b).startsWith('TM')),
      'the other leg',
    )
    expect(where(), 'picking the other leg stranded the focus').not.toBe('<body>')
  })

  /**
   * **PICKING THE PAIR ALREADY IN FORCE SWITCHES NOTHING AND SAYS NOTHING** — `rebind`'s notice is gated
   * on the session having changed — but the menu still opened and still shut, so it is still a gesture
   * that has to leave the focus somewhere. It passes today with no handler doing anything: the arm
   * rebuilds no layout, so `hidePopover()`'s restoration to the title button is the whole story. Held
   * here because that is a fact about this gesture, not a guarantee any code makes.
   */
  it('the title menu, picking the pair already in force', async () => {
    await throughMenu(
      '[data-leaf="lambda-0"] button.view-title',
      (i) => i.find((b) => label(b) === 'λ · program'),
      'the pair in force',
    )
    expect(where(), 'picking the pair already in force stranded the focus').not.toBe('<body>')
  })

  /**
   * **ANOTHER SESSION ON THE SAME LEG TAKES `rebind`'s OTHER ARM** — the one that returns early, before
   * the `focusPane` the cross-leg arm below it has always called. That asymmetry is what made this look
   * like a second instance of C1, and driving it is how that was settled: it rebuilds no layout, so
   * nothing detaches the element `hidePopover()` restores to, and the focus is fine without any handler
   * doing anything.
   *
   * **A `focusPane(id)` WAS ADDED TO THAT ARM AND THEN TAKEN BACK OUT, WHICH IS WHY THIS CASE EXISTS.**
   * The first probe that seemed to show it stranding focus never checked where the focus WAS before the
   * gesture; it had been left on `<body>` by the probe before it, so `<body>` afterwards measured
   * nothing. Re-run with that precondition asserted, the gesture lands on the title button with the fix
   * removed — and the fix's own sabotage could not be made to fire. A sabotage that does not fire is the
   * finding, so the code went back and this test stayed, to hold the arm at what it actually does.
   */
  it('the title menu, picking another session on the same leg', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    await until(
      () => (document.querySelector('[data-leaf="lambda-0"] .view-title')?.textContent ?? '').includes('copy'),
      'the copy',
    )
    // A SECOND λ VIEW, STILL ON THE PROGRAM — the one that can pick the copy.
    await throughMenu('#new-view', (i) => i.find((b) => label(b) === 'λ · program'), 'a second λ view')
    const onProgram = [...document.querySelectorAll<HTMLElement>('[data-leaf]')].find(
      (l) => (l.querySelector('.view-title')?.textContent ?? '').replace(/\s+/g, ' ').trim() === 'λ · program',
    )
    if (onProgram === undefined) throw new Error('no λ view on the program to pick the copy from')
    await throughMenu(
      `[data-leaf="${onProgram.dataset.leaf}"] button.view-title`,
      (i) => i.find((b) => label(b).includes('copy')),
      'onto the copy',
    )
    expect(where(), 'picking another session on the same leg stranded the focus').not.toBe('<body>')
  })

  it('the workspace menu, reset preset', async () => {
    await throughMenu('#workspace', (i) => i.find((b) => label(b).startsWith('reset preset')), 'reset preset')
    expect(where(), 'reset preset stranded the focus').not.toBe('<body>')
  })

  it('+ view, adding a view', async () => {
    await throughMenu('#new-view', (i) => i.find((b) => label(b).startsWith('TM')), 'adding a view')
    expect(where(), 'adding a view stranded the focus').not.toBe('<body>')
  })
})
