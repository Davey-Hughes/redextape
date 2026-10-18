import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import {
  clickWorkspaceItem,
  deleteEveryCopy,
  editorsOf,
  focusInPage,
  host,
  inCopiesMenu,
  mounted,
  press,
  resetToFourViews,
  SHELL,
  shutCopiesMenu,
  stateIdle,
  tabLeaves,
  termEditorsIn,
  titleText,
  until,
} from './harness'

/**
 * A COPY DELETED, OR PAUSED, WHILE THE VIEW HOLDING ITS EDITOR IS A STAGE TAB THAT IS NOT SELECTED — the view layouts
 * spec §5.5.
 *
 * A view that stopped showing a copy had the copy's editor taken down by the next `draw()`, and `draw()` passes over a
 * view that is not on the page. So a hidden tab went on holding the editor of a copy it no longer showed. After a
 * delete and its *undo* the copy had a second editor on the first view moved back, and the next sweep handed that view
 * the stale one and threw `handed a second editor while still holding one`. After a pause nothing threw, and the
 * stale editor stayed where it was.
 *
 * **THE STALE EDITOR IS LOOKED FOR WHERE IT WAS LEFT**, in the hidden view's host, which is kept while it is off the
 * page and can be asked what it holds. The throw is asserted too, but it says less than it seems to: the sweep takes
 * the stale editor off the hidden view before it throws, so every assertion made after the *undo* but the one on the
 * throw passed without the teardown (measured, 2026-10-12).
 *
 * **EACH LEG HAS ITS OWN CASES**: a λ view's teardown is `LambdaPane`'s and a TM or asm view's is `CopyEditor`'s, and
 * a teardown that reached only a λ view passed every test while λ had the only case.
 *
 * **EVERY GESTURE HERE IS ONE THE APP HAD BEFORE THE VIEW LAYOUTS**: the Stage, a second view of a copy, *move the
 * editor here*, delete and undo, pause and resume. `pane-host.ts`'s `reseedingSlots` takes the editor down as it moves
 * a view off the page onto the program. `parked-copy-editor.test.ts` drives the same thing for a view a switch parked.
 *
 * **A DELETE, ITS *UNDO*, A PAUSE AND A RESUME ARE PRESSED WITH THE POINTER** (`press`), as a user presses them: the
 * copies button, then the row's control; the notice's *undo* where the pointer finds it. The copy, its second view,
 * the editor's move and the tabs selected to look at a view are arranged with `.click()`, and so is the page put back
 * before each case.
 */

const errors: string[] = []
const onError = (e: ErrorEvent): void => {
  errors.push(e.message)
}

/** A leg's name in a title and in the copies menu, and the view a default arrangement gives it. */
type Leg = { readonly name: string; readonly view: string }
const LEGS: readonly Leg[] = [
  { name: 'λ', view: 'lambda-0' },
  { name: 'TM', view: 'tm-0' },
  { name: 'asm', view: 'asm-0' },
]

const tab = (id: string): void => document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${id}"]`)?.click()

/** What a case holds once its copy's editor is in a view that is off the page. */
type Hidden = {
  /** The copy's name in the copies menu: `λ copy 1`. */
  readonly copy: string
  /** A view's title while it shows the copy, and while it shows the program. */
  readonly onCopy: string
  readonly onProgram: string
  /** The second view of the copy, and its host, which is kept while its tab is not selected. */
  readonly second: string
  readonly holder: HTMLElement
}

/**
 * Make a copy in `leg`'s view, add a second view of it, move the copy's editor onto the second, and select the first
 * view's tab: the second, holding the editor, is then a tab that is not selected.
 */
async function hideTheHolder(leg: Leg): Promise<Hidden> {
  tab(leg.view)
  expect(titleText(leg.view), 'precondition: the view starts on the program').toBe(`${leg.name} · program`)
  host(leg.view)?.querySelector<HTMLButtonElement>('button.detach')?.click()
  await until(() => / · copy \d+$/.test(titleText(leg.view)) && editorsOf(leg.view) === 1, 'the copy and its editor')
  const binding = host(leg.view)?.querySelector<HTMLElement>('button.view-title')?.dataset.binding ?? ''
  const number = /^[a-z]+:scratch-(\d+)$/.exec(binding)?.[1]
  if (number === undefined) throw new Error(`the view’s title does not name a copy: ${JSON.stringify(binding)}`)
  const onCopy = `${leg.name} · copy ${number}`
  expect(titleText(leg.view), 'precondition: the view shows the copy its title names').toBe(onCopy)

  // A SECOND VIEW OF THE COPY, WHICH THE STAGE SHOWS, AND THE EDITOR MOVED ONTO IT.
  const before = new Set(tabLeaves())
  document.querySelector<HTMLButtonElement>('#new-view')?.click()
  document.querySelector<HTMLButtonElement>(`#new-view-menu button[data-binding="${binding}"]`)?.click()
  const second = tabLeaves().find((id) => !before.has(id))
  if (second === undefined) throw new Error('+ view added no second view of the copy')
  await until(() => host(second) !== null && titleText(second) === onCopy, 'the second view, shown')
  const holder = host(second)
  if (holder === null) throw new Error('the second view has no host')
  holder.querySelector<HTMLButtonElement>('button.claim-editor')?.click()
  await until(() => termEditorsIn(holder) === 1, 'the editor to move to the second view')

  // THE FIRST VIEW'S TAB: the second, holding the editor, is now a tab that is not selected.
  tab(leg.view)
  expect(mounted(), 'precondition: the holder is off the page').toEqual([leg.view])
  expect(holder.isConnected, 'precondition: the holder’s host is out of the document').toBe(false)
  expect(termEditorsIn(holder), 'precondition: the hidden view holds the copy’s editor').toBe(1)
  expect(editorsOf(leg.view), 'precondition: the view on the page holds no editor').toBe(0)
  return { copy: `${leg.name} copy ${number}`, onCopy, onProgram: `${leg.name} · program`, second, holder }
}

beforeAll(async () => {
  window.addEventListener('error', onError)
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(stateIdle, 'the first compile')
  clickWorkspaceItem('[data-preset="stage"]')
})
afterAll(() => window.removeEventListener('error', onError))

// **ONE PAGE FOR THE FILE, SO EACH CASE PUTS IT BACK FIRST**: no copies, and the four views on the program, with
// nothing a case before it added. A case that failed half way leaves the next one where every case starts.
beforeEach(async () => {
  deleteEveryCopy()
  await resetToFourViews()
  expect(tabLeaves(), 'precondition: the four views, as tabs').toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
  errors.length = 0
})

for (const leg of LEGS) {
  describe(`a ${leg.name} copy whose editor is in a hidden Stage tab`, () => {
    it('is deleted and restored with one editor, and no handler throws', async () => {
      const { copy, onCopy, onProgram, second, holder } = await hideTheHolder(leg)

      await inCopiesMenu(`delete ${copy}`)
      await focusInPage(`delete ${copy}, pressed in the copies menu`)
      await until(() => titleText(leg.view) === onProgram, 'the shown view to move to the program')
      // BEFORE THE UNDO, AND BEFORE ANYTHING CAN THROW: the hidden view shows the program now, and holds no editor.
      expect(termEditorsIn(holder), 'the hidden view still holds the editor of the copy it left').toBe(0)

      // THE DELETE OF THE LAST COPY SHUT THE MENU, and the pointer goes on to the notice.
      await press('#notice button.notice-action')
      await focusInPage(`the undo of ${copy}’s delete`)
      await until(() => titleText(leg.view) === onCopy && editorsOf(leg.view) === 1, 'the copy and an editor back')

      tab(second)
      expect(mounted()).toEqual([second])
      expect(errors, 'a handler threw').toEqual([])
      expect(titleText(second)).toBe(onCopy)
      expect(editorsOf(second), 'the copy has an editor in each of its views').toBe(0)
      tab(leg.view)
      expect(editorsOf(leg.view)).toBe(1)
    })

    it('is paused and resumed, and the hidden view gives up the editor at the pause', async () => {
      const { copy, onProgram, second, holder } = await hideTheHolder(leg)

      await inCopiesMenu(`pause ${copy}`)
      await focusInPage(`pause ${copy}, pressed in the copies menu`)
      await until(() => titleText(leg.view) === onProgram, 'the shown view to move to the program')
      // A PAUSE THROWS NOTHING WITH THE STALE EDITOR LEFT IN PLACE, so this is the whole of what holds it.
      expect(termEditorsIn(holder), 'the hidden view still holds the editor of the copy it left').toBe(0)

      await inCopiesMenu(`resume ${copy} — restarts at step 0`)
      await focusInPage(`resume ${copy}, pressed in the copies menu`)
      shutCopiesMenu()
      tab(second)
      expect(mounted()).toEqual([second])
      expect(errors, 'a handler threw').toEqual([])
      expect(titleText(second), 'a resumed copy’s views stay on the program').toBe(onProgram)
      expect(editorsOf(second)).toBe(0)
    })
  })
}
