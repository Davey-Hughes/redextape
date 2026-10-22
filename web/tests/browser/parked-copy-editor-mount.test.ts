import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { claim, editorsOf, focusInPage, host, mountAt, mounted, titleText, until } from './harness'
import { clickToggle } from './user-event-fixture'

/**
 * A PARKED VIEW THAT COMES BACK SHOWING A COPY NO VIEW HOLDS AN EDITOR FOR — the view layouts spec §5.5.
 *
 * A machine copy's editor lives in one view. When that view closes the editor is destroyed, and `pane-host.ts`'s
 * `mountOnViewOf` mounts a fresh one on a view of the copy in the tree on screen. A view a switch parked is not in
 * that tree. So with the copy's second view parked and its first view closed, the copy would have no editor
 * anywhere, and the parked view would come back showing it with none and with no *move the editor here* in its menu:
 * a view offers that only while an editor exists. `applyLayout` mounts one on a view that returns from a remembered
 * arrangement showing such a copy, as its creation pass does for a view it builds.
 *
 * **A TM COPY, NOT A λ ONE**: a λ copy's editor waits in custody when its view closes, and the view that returns
 * offers to bring it over.
 *
 * **A FILE OF ITS OWN**, beside `parked-copy-editor.test.ts`, which holds §5.5's other defect: this scenario starts
 * from all four views on the program, with nothing remembered.
 *
 * The toggles, `+ view` and `✕` are pressed with `userEvent`, as a user presses them; *edit a copy* is `.click()`,
 * since its item is in a menu the case does not open.
 */

const errors: string[] = []
const onError = (e: ErrorEvent): void => {
  errors.push(e.message)
}

const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']

/** Every copy's editor on the page, in whichever view: the source editor is not in a `.term-editor`. */
const copyEditors = (): number => document.querySelectorAll('#views .term-editor .cm-editor').length
/** The views on the page whose title is `title`. */
const showing = (title: string): string[] => mounted().filter((id) => titleText(id) === title)

beforeAll(async () => {
  window.addEventListener('error', onError)
  await mountAt(1280, 896)
})
afterAll(() => window.removeEventListener('error', onError))

describe('a parked view of a TM copy whose other view, holding the editor, was closed', () => {
  it('has an editor when it comes back', async () => {
    expect(mounted(), 'precondition: all four views').toEqual(FOUR)
    host('tm-0')?.querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => titleText('tm-0') === 'TM · copy 1' && editorsOf('tm-0') === 1, 'the copy and its editor')
    const copy = host('tm-0')?.querySelector<HTMLElement>('button.view-title')?.dataset.binding ?? ''
    expect(copy, 'precondition: the view’s title names its copy').toMatch(/^tm:scratch-\d+$/)

    // THE SOURCE BESIDE TM, WHERE THE SECOND VIEW OF THE COPY IS ADDED: that arrangement alone holds it.
    await clickToggle('lambda')
    await clickToggle('asm')
    expect(mounted(), 'precondition: the source beside the TM view').toEqual(['source', 'tm-0'])
    host('tm-0')?.querySelector<HTMLElement>('button.view-title')?.focus()
    await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
    const item = (): HTMLButtonElement | null =>
      document.querySelector<HTMLButtonElement>(`#new-view-menu button[data-binding="${copy}"]`)
    await until(() => item() !== null, '+ view’s item for the copy')
    await userEvent.click(item() as HTMLButtonElement)
    const second = mounted().find((id) => id !== 'source' && id !== 'tm-0')
    if (second === undefined) throw new Error('+ view added no second view of the copy')
    await until(() => titleText(second) === 'TM · copy 1', 'the second view of the copy')
    expect(editorsOf('tm-0'), 'precondition: the editor stays in the first view').toBe(1)
    expect(editorsOf(second), 'precondition: the second view holds no editor').toBe(0)
    expect(claim(second), 'precondition: the second view offers to take the editor').not.toBeNull()

    // ALL FOUR AGAIN, BY TWO SWITCHES: neither arrangement names the second view, so it is parked.
    await clickToggle('asm')
    await clickToggle('lambda')
    expect(mounted(), 'precondition: the second view is off the page').toEqual(FOUR)
    expect(titleText('tm-0'), 'precondition: the view on the page shows the copy').toBe('TM · copy 1')
    expect(editorsOf('tm-0'), 'precondition: the view on the page holds the editor').toBe(1)

    // THE HOLDER IS CLOSED, WHICH DESTROYS THE EDITOR, and no view in the tree shows the copy to take a fresh one.
    await userEvent.click(host('tm-0')?.querySelector<HTMLButtonElement>('button.view-close') as HTMLButtonElement)
    await focusInPage('the ✕ of the view that held the copy’s editor')
    expect(mounted(), 'precondition: the holder is closed').toEqual(['source', 'lambda-0', 'asm-0'])
    expect(copyEditors(), 'precondition: the copy’s editor went with its view').toBe(0)

    // THE TM TOGGLE SHOWS THE TREE BEFORE THE ✕, WITH A NEW VIEW ON THE PROGRAM WHERE THE CLOSED ONE WAS.
    await clickToggle('tm')
    expect(mounted(), 'precondition: all four views again').toEqual(FOUR)
    expect(titleText('tm-0'), 'precondition: the view built where the closed one was shows the program').toBe(
      'TM · program',
    )

    // BACK TO THE ARRANGEMENT THAT HOLDS THE PARKED VIEW.
    await clickToggle('lambda')
    await clickToggle('asm')
    expect(mounted()).toEqual(['source', 'tm-0', second])
    expect(errors, 'a handler threw').toEqual([])
    expect(titleText(second)).toBe('TM · copy 1')
    expect(showing('TM · copy 1'), 'precondition: the returned view alone shows the copy').toEqual([second])
    expect(editorsOf(second), 'the view came back showing a copy with no editor').toBe(1)
  })
})
