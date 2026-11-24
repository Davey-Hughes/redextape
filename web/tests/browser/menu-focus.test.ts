import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { bindingKey } from '../../src/view-header'
import { frames, resetToFourViews, SHELL, stateIdle, until } from './harness'
import { userSplit } from './user-event-fixture'

/**
 * **A MENU ITEM NEVER LEAVES THE FOCUS ON `<body>`** — spec §11's categorical rule, accessibility item 1,
 * and a class of defect rather than a control.
 *
 * **THE MECHANISM.** It is not that focus is stranded on the hidden menu item. `hidePopover()` RESTORES
 * focus to whatever held it before the popover opened, so a menu item on its own never strands anything.
 * What strands it is the gesture that runs next: if it rebuilds the tree, `renderLayout`'s
 * `root.replaceChildren()` detaches the host that the restored element lives in, and focus falls to
 * `<body>` a frame later. So the rule this file checks has two conditions, not one — the gesture must
 * rebuild the layout AND the focus must have been inside a view — and a gesture that does neither is
 * safe without any handler doing anything about it.
 *
 * **WHICH IS WHY THE BASELINE IN `beforeEach` IS LOAD-BEARING AND NOT TIDINESS.** Because focus is
 * restored to the pre-open element, a test that begins on `<body>` ends on `<body>` whatever the gesture
 * did, and one that begins on a header control ends on that control — the header is outside `<main>` and
 * survives every rebuild. Only a starting point INSIDE a view can tell the broken path from the fixed one.
 *
 * **MEASURED ACROSS A FRAME, NOT SYNCHRONOUSLY.** `document.activeElement` read at the end of the click
 * handler still names the pre-open element on the broken path and the fixed one alike — the blur has not
 * happened yet. Every assertion below therefore waits two animation frames first.
 */

/** Where the focus is, named so a failure says it rather than printing an element. */
const where = (): string => {
  const a = document.activeElement
  if (a === null || a === document.body) return '<body>'
  const cls = a.className === '' ? '' : `.${String(a.className).split(' ').join('.')}`
  return `${a.tagName.toLowerCase()}${a.id === '' ? '' : `#${a.id}`}${cls}`
}

/**
 * Drive one menu the way a user does: open it, check the open put the focus inside it, activate an item.
 *
 * The focus-is-inside-the-menu check is the precondition the whole file rests on. Without it a gesture
 * that never took the focus in the first place would satisfy every assertion below while proving nothing.
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
  await frames()
}

const label = (b: HTMLButtonElement): string => (b.textContent ?? '').replace(/\s+/g, ' ').trim()

let view: EditorView

beforeAll(async () => {
  // WIDE ENOUGH FOR ITS SPLITS: at the runner's default 414 px a view is 201 px wide, and the app refuses a split that
  // leaves a view under `MIN_VIEW_PX` (`layout.ts`). The default's 896 px height is kept.
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
})

// Back to the four views before each gesture, since several of these change the tree.
beforeEach(async () => {
  await resetToFourViews()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(
    () =>
      document.querySelectorAll('[data-leaf]').length === 4 &&
      document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle',
    'the four views',
  )
  // **A KNOWN STARTING POINT INSIDE A VIEW — the file doc has the argument.** `<body>` (what the reset above
  // leaves when its own fix is removed) makes every later case report `<body>` whatever its gesture did. A
  // header control (`#share`) makes every case report a pass, because the header is outside `<main>` and
  // no rebuild touches it. A control inside a view is the only baseline that discriminates.
  document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-title')?.focus()
  expect(where(), 'the baseline focus did not take').toBe('button.view-title')
})

describe('a menu item hands the focus on', () => {
  it('the title menu, picking the TM leg', async () => {
    await throughMenu(
      '[data-leaf="lambda-0"] button.view-title',
      (i) => i.find((b) => label(b).startsWith('TM')),
      'the TM leg',
    )
    expect(where(), 'picking the TM leg stranded the focus').not.toBe('<body>')
  })

  /**
   * **PICKING THE PAIR ALREADY IN FORCE SWITCHES NOTHING AND SAYS NOTHING** — `rebind`'s notice is gated
   * on the session having changed — but the menu still opened and still shut, so it is still a gesture
   * that has to leave the focus somewhere. It passes with no handler doing anything: the arm rebuilds no
   * layout, so `hidePopover()`'s restoration to the title button is the whole story. Held here because
   * that is a fact about this gesture, not a guarantee any code makes.
   */
  it('the title menu, picking the pair already in force', async () => {
    await throughMenu(
      '[data-leaf="lambda-0"] button.view-title',
      (i) => i.find((b) => label(b) === 'λ · program'),
      'the pair in force',
    )
    expect(where(), 'picking the pair already in force stranded the focus').not.toBe('<body>')
  })

  it('the workspace menu, reset preset', async () => {
    await throughMenu('#workspace', (i) => i.find((b) => label(b).startsWith('reset preset')), 'reset preset')
    expect(where(), 'reset preset stranded the focus').not.toBe('<body>')
  })

  it("a view's split, adding a view", async () => {
    expect(
      await userSplit('lambda-0', bindingKey('tm', 'source')),
      'precondition: the split added a view',
    ).not.toBeNull()
    await frames()
    expect(where(), 'adding a view stranded the focus').not.toBe('<body>')
  })
})
