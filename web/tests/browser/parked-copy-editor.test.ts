import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import {
  deleteEveryCopy,
  editorsOf,
  focusInPage,
  host,
  inCopiesMenu,
  mounted,
  press,
  resetToFourViews,
  SHELL,
  stateIdle,
  termEditorsIn,
  titleText,
  until,
} from './harness'

/**
 * A COPY DELETED, OR PAUSED, WHILE THE VIEW HOLDING ITS EDITOR IS OFF THE PAGE — the view layouts spec §5.5.
 *
 * A view that stops showing a copy has the copy's editor taken down by the next `draw()`, and `draw()` passes over a
 * view that is not on the page. Left to that, a view off the page would go on holding the editor of a copy it no
 * longer showed: after a delete and its *undo* the copy would have a second editor on the first view moved back,
 * and the next sweep would hand that view the stale one and throw `handed a second editor while still holding one`;
 * after a pause nothing would throw, and the stale editor would stay where it was.
 *
 * **TWO WAYS A VIEW IS OFF THE PAGE**: a view a switch parked, which this file drives, and a Stage tab that is not
 * selected, which is `stage-copy-editor.test.ts`'s. `pane-host.ts`'s `reseedingSlots` takes the editor down as it
 * moves a view off the page onto the program, for both.
 *
 * **THE STALE EDITOR IS LOOKED FOR WHERE IT WAS LEFT, AND EACH LEG HAS ITS OWN CASES** — `stage-copy-editor.test.ts`
 * has why: the sweep takes the stale editor off the view before it throws, so the throw says less than it seems, and a
 * λ view's teardown is `LambdaPane`'s where a TM or asm view's is `CopyEditor`'s.
 *
 * **A DELETE, ITS *UNDO*, A PAUSE, A RESUME AND EVERY TOGGLE ARE PRESSED WITH THE POINTER** (`press`), as a user
 * presses them: the copies button, then the row's control; the notice's *undo* where the pointer finds it. The copy,
 * its second view and the editor's move are arranged with `.click()`, and so is the page put back before each case.
 */

const errors: string[] = []
const onError = (e: ErrorEvent): void => {
  errors.push(e.message)
}

const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']

/** A leg's name in a title and in the copies menu, the view a default arrangement gives it, and its toggle. */
type Leg = { readonly name: string; readonly view: string; readonly kind: string }
const LEGS: readonly Leg[] = [
  { name: 'λ', view: 'lambda-0', kind: 'lambda' },
  { name: 'TM', view: 'tm-0', kind: 'tm' },
  { name: 'asm', view: 'asm-0', kind: 'asm' },
]

/** Press the toggle of each leg but `leg`'s: from all four views to the source beside `leg`'s, and back. */
const toggleTheOthers = async (leg: Leg): Promise<void> => {
  for (const other of LEGS) if (other !== leg) await press(`#views-shown button[data-shows="${other.kind}"]`)
}

/** What a case holds once its copy's editor is in a parked view. */
type Parked = {
  /** The copy's name in the copies menu: `λ copy 1`. */
  readonly copy: string
  /** A view's title while it shows the copy, and while it shows the program. */
  readonly onCopy: string
  readonly onProgram: string
  /** The second view of the copy, and its host, which is kept while the view is parked. */
  readonly second: string
  readonly holder: HTMLElement
}

/**
 * Show the source beside `leg`'s view, make a copy there, add a second view of it and move the copy's editor onto the
 * second; then show all four views again, by two switches. Neither arrangement they pass through names the second
 * view, so it is parked, editor and all.
 */
async function parkTheHolder(leg: Leg): Promise<Parked> {
  expect(mounted(), 'precondition: all four views').toEqual(FOUR)
  // THE SOURCE BESIDE THE LEG'S VIEW, WHERE THE SECOND VIEW IS ADDED: that arrangement alone holds it.
  await toggleTheOthers(leg)
  expect(mounted(), 'precondition: the source beside the leg’s view').toEqual(['source', leg.view])
  expect(titleText(leg.view), 'precondition: the view starts on the program').toBe(`${leg.name} · program`)
  host(leg.view)?.querySelector<HTMLButtonElement>('button.detach')?.click()
  await until(() => / · copy \d+$/.test(titleText(leg.view)) && editorsOf(leg.view) === 1, 'the copy and its editor')
  const binding = host(leg.view)?.querySelector<HTMLElement>('button.view-title')?.dataset.binding ?? ''
  const number = /^[a-z]+:scratch-(\d+)$/.exec(binding)?.[1]
  if (number === undefined) throw new Error(`the view’s title does not name a copy: ${JSON.stringify(binding)}`)
  const onCopy = `${leg.name} · copy ${number}`
  expect(titleText(leg.view), 'precondition: the view shows the copy its title names').toBe(onCopy)

  host(leg.view)?.querySelector<HTMLElement>('button.view-title')?.focus()
  const before = new Set(mounted())
  document.querySelector<HTMLButtonElement>('#new-view')?.click()
  document.querySelector<HTMLButtonElement>(`#new-view-menu button[data-binding="${binding}"]`)?.click()
  const second = mounted().find((id) => !before.has(id))
  if (second === undefined) throw new Error('+ view added no second view of the copy')
  await until(() => titleText(second) === onCopy, 'the second view of the copy')
  const holder = host(second)
  if (holder === null) throw new Error('the second view has no host')
  holder.querySelector<HTMLButtonElement>('button.claim-editor')?.click()
  await until(() => termEditorsIn(holder) === 1 && editorsOf(leg.view) === 0, 'the editor to move to the second view')

  await toggleTheOthers(leg)
  expect(mounted(), 'precondition: the second view is off the page').toEqual(FOUR)
  expect(holder.isConnected, 'precondition: the holder’s host is out of the document').toBe(false)
  expect(termEditorsIn(holder), 'precondition: the parked view holds the copy’s editor').toBe(1)
  expect(titleText(leg.view), 'precondition: the view on the page shows the copy').toBe(onCopy)
  expect(editorsOf(leg.view), 'precondition: the editor is not on the page').toBe(0)
  return { copy: `${leg.name} copy ${number}`, onCopy, onProgram: `${leg.name} · program`, second, holder }
}

beforeAll(async () => {
  window.addEventListener('error', onError)
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(stateIdle, 'the first compile')
})
afterAll(() => window.removeEventListener('error', onError))

// **ONE PAGE FOR THE FILE, SO EACH CASE PUTS IT BACK FIRST**: no copies, the four views on the program, and no
// arrangement remembered that names a view a case before it added.
beforeEach(async () => {
  deleteEveryCopy()
  await resetToFourViews()
  errors.length = 0
})

for (const leg of LEGS) {
  describe(`a ${leg.name} copy whose editor is in a view a switch parked`, () => {
    it('is deleted and restored with one editor, and no handler throws', async () => {
      const { copy, onCopy, onProgram, second, holder } = await parkTheHolder(leg)

      await inCopiesMenu(`delete ${copy}`)
      await focusInPage(`delete ${copy}, pressed in the copies menu`)
      await until(() => titleText(leg.view) === onProgram, 'the view on the page to move to the program')
      // BEFORE THE UNDO, AND BEFORE ANYTHING CAN THROW: the parked view shows the program now, and holds no editor.
      expect(termEditorsIn(holder), 'the parked view still holds the editor of the copy it left').toBe(0)

      // THE DELETE OF THE LAST COPY SHUT THE MENU, and the pointer goes on to the notice.
      await press('#notice button.notice-action')
      await focusInPage(`the undo of ${copy}’s delete`)
      await until(() => titleText(leg.view) === onCopy && editorsOf(leg.view) === 1, 'the copy and an editor back')

      // BACK TO THE ARRANGEMENT THAT HOLDS THE PARKED VIEW.
      await toggleTheOthers(leg)
      expect(mounted()).toEqual(['source', leg.view, second])
      expect(errors, 'a handler threw').toEqual([])
      expect(titleText(second)).toBe(onCopy)
      expect(editorsOf(leg.view), 'the view the copy came back to lost its editor').toBe(1)
      expect(editorsOf(second), 'the copy has an editor in each of its views').toBe(0)
    })

    it('is paused and resumed, and the parked view gives up the editor at the pause', async () => {
      const { copy, onProgram, second, holder } = await parkTheHolder(leg)

      await inCopiesMenu(`pause ${copy}`)
      await focusInPage(`pause ${copy}, pressed in the copies menu`)
      await until(() => titleText(leg.view) === onProgram, 'the view on the page to move to the program')
      // A PAUSE THROWS NOTHING WITH THE STALE EDITOR LEFT IN PLACE, so this is the whole of what holds it.
      expect(termEditorsIn(holder), 'the parked view still holds the editor of the copy it left').toBe(0)

      await inCopiesMenu(`resume ${copy} — restarts at step 0`)
      await focusInPage(`resume ${copy}, pressed in the copies menu`)
      await toggleTheOthers(leg)
      expect(mounted()).toEqual(['source', leg.view, second])
      expect(errors, 'a handler threw').toEqual([])
      expect(titleText(second), 'a resumed copy’s views stay on the program').toBe(onProgram)
      expect(editorsOf(second)).toBe(0)
    })
  })
}
