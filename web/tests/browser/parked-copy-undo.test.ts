import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import {
  deleteEveryCopy,
  editorsOf,
  host,
  mounted,
  press,
  pressShownToggle,
  resetToFourViews,
  SHELL,
  stateIdle,
  termEditorsIn,
  titleText,
  until,
} from './harness'

/**
 * A COPY DELETED AND RESTORED WHILE A PARKED VIEW SHOWS IT: WHERE ITS EDITOR, AND THE FOCUS, COME BACK.
 *
 * A delete's *undo* moves back each view the delete moved, and the first of them gets the copy's editor and the focus
 * (`pane-host.ts`'s `moveBack`, `main.ts`'s `undo`). Taken in the order they were built, the first could be a view a
 * switch had parked while a newer view of the copy was on screen: the editor would be mounted in the parked view, the
 * view on screen would show the copy with none and offer *move the editor here*, and the focus would be on the
 * copies button. `moveBack` takes the views of the tree on screen first.
 *
 * **THE PARKED VIEW IS THE OLDER ONE HERE**, which `parked-copy-editor.test.ts`'s is not: there the view on the page
 * is the first built, and gets the editor in either order.
 *
 * **AND WHERE ONLY A PARKED VIEW SHOWS THE COPY, IT GETS THE EDITOR**: the copy comes back editable in the view that
 * showed it, and the focus goes to the copies button, since no view on the page can take it.
 *
 * **THE DELETE, ITS *UNDO* AND EVERY TOGGLE ARE PRESSED WITH THE POINTER** (`press`). A press puts the focus on the
 * *undo* button before its handler runs, so the notice line ends while it holds the focus and hands it to the copies
 * button (`notice.ts`'s `createNotices`), and `main.ts`'s `undo` then moves it. A `.click()` moves no focus, so the
 * line would never hold it. **SO THE COPIES BUTTON HAS THE FOCUS BY EITHER HAND WHERE NO VIEW ON SCREEN SHOWS THE
 * COPY**: with `undo` giving no focus at all, that case would pass, and the case of a view on screen is the one that
 * would fail.
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

/** What a case holds once `leg`'s view shows a copy of its own. */
type Copied = {
  /** The copy's name in the copies menu, and its key in a title menu and in `+ view`'s. */
  readonly copy: string
  readonly binding: string
  /** A view's title while it shows the copy. */
  readonly onCopy: string
  /** The host of `leg`'s view, which is kept while the view is parked. */
  readonly first: HTMLElement
}

/** Make a copy in `leg`'s view, from all four views on the program. */
async function copyIn(leg: Leg): Promise<Copied> {
  expect(mounted(), 'precondition: all four views').toEqual(FOUR)
  expect(titleText(leg.view), 'precondition: the view starts on the program').toBe(`${leg.name} · program`)
  const first = host(leg.view)
  if (first === null) throw new Error('the leg’s view has no host')
  first.querySelector<HTMLButtonElement>('button.detach')?.click()
  await until(() => / · copy \d+$/.test(titleText(leg.view)) && editorsOf(leg.view) === 1, 'the copy and its editor')
  const binding = first.querySelector<HTMLElement>('button.view-title')?.dataset.binding ?? ''
  const number = /^[a-z]+:scratch-(\d+)$/.exec(binding)?.[1]
  if (number === undefined) throw new Error(`the view’s title does not name a copy: ${JSON.stringify(binding)}`)
  return { copy: `${leg.name} copy ${number}`, binding, onCopy: titleText(leg.view), first }
}

/**
 * Delete `copy` from the copies menu, then press the notice's *undo*, each with the pointer. The delete of the last
 * copy shuts the menu itself.
 */
async function deleteAndUndo(copy: string): Promise<void> {
  await press('#buffers')
  await press(`.buffer-list button[aria-label="delete ${copy}"]`)
  await press('#notice button.notice-action')
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
  const [other, kept] = LEGS.filter((l) => l !== leg) as [Leg, Leg]

  describe(`a ${leg.name} copy deleted and restored while a parked view shows it`, () => {
    it('comes back with its editor, and the focus, in the view of it on screen', async () => {
      const { copy, binding, onCopy, first } = await copyIn(leg)
      // ONE OTHER VIEW OFF, THEN THE COPY'S: the copy's view is parked, and all four views are remembered with it.
      // The view added next makes an arrangement of three kinds, which is not the one that holds the parked view.
      await pressShownToggle(other.kind)
      await pressShownToggle(leg.kind)
      expect(mounted(), 'precondition: the source beside one view, the copy’s view parked').toEqual([
        'source',
        kept.view,
      ])
      const before = new Set(mounted())
      document.querySelector<HTMLButtonElement>('#new-view')?.click()
      document.querySelector<HTMLButtonElement>(`#new-view-menu button[data-binding="${binding}"]`)?.click()
      const second = mounted().find((id) => !before.has(id))
      if (second === undefined) throw new Error('+ view added no second view of the copy')
      await until(() => titleText(second) === onCopy, 'the second view of the copy')
      host(second)?.querySelector<HTMLButtonElement>('button.claim-editor')?.click()
      await until(() => editorsOf(second) === 1, 'the editor to move to the view on screen')
      expect(first.isConnected, 'precondition: the first view of the copy is off the page').toBe(false)
      expect(termEditorsIn(first), 'precondition: the parked view gave the editor up').toBe(0)

      await deleteAndUndo(copy)
      expect(titleText(second), 'precondition: the view on screen shows the copy again').toBe(onCopy)
      expect(termEditorsIn(first), 'the copy’s editor came back in the parked view').toBe(0)
      expect(editorsOf(second), 'the view of the copy on screen has no editor').toBe(1)
      expect(document.activeElement, 'the focus is not in the view the copy came back to').toBe(
        host(second)?.querySelector('.view-title'),
      )

      // ALL FOUR AGAIN, WHICH BRINGS THE PARKED VIEW BACK: on the copy, as the undo left it, with no second editor.
      await pressShownToggle(other.kind)
      expect(mounted(), 'precondition: all four views again').toEqual(FOUR)
      expect(titleText(leg.view), 'the parked view was not moved back onto the copy').toBe(onCopy)
      expect(editorsOf(leg.view)).toBe(0)
      expect(errors, 'a handler threw').toEqual([])
    })

    it('comes back with its editor in the parked view where no view on screen shows it', async () => {
      const { copy, onCopy, first } = await copyIn(leg)
      await pressShownToggle(leg.kind)
      expect(mounted(), 'precondition: the copy’s view is parked').toEqual(FOUR.filter((id) => id !== leg.view))
      expect(first.isConnected, 'precondition: its host is out of the document').toBe(false)
      expect(termEditorsIn(first), 'precondition: the parked view holds the copy’s editor').toBe(1)

      await deleteAndUndo(copy)
      expect(termEditorsIn(first), 'the copy came back with no editor').toBe(1)
      expect(document.activeElement, 'the focus is not on the copies button').toBe(document.querySelector('#buffers'))

      await pressShownToggle(leg.kind)
      expect(mounted(), 'precondition: all four views again').toEqual(FOUR)
      expect(titleText(leg.view), 'the parked view was not moved back onto the copy').toBe(onCopy)
      expect(editorsOf(leg.view)).toBe(1)
      expect(errors, 'a handler threw').toEqual([])
    })
  })
}
