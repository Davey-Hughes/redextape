import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { focusInPage, SHELL, until } from './harness'

/**
 * A PARKED VIEW THAT COMES BACK SHOWING A COPY NO VIEW HOLDS AN EDITOR FOR — the view layouts spec §5.5.
 *
 * A machine copy's editor lives in one view. When that view closes the editor is destroyed, and `pane-host.ts`'s
 * `mountOnViewOf` mounts a fresh one on a view of the copy in the tree on screen. A view a switch parked is not in
 * that tree. So with the copy's second view parked and its first view closed, the copy had no editor anywhere, and
 * the parked view came back showing it with none and with no *move the editor here* in its menu (measured with the
 * mount taken out, 2026-10-12): a view offers that only while an editor exists. `applyLayout` mounts one on a view
 * that returns from a remembered arrangement showing such a copy, as its creation pass does for a view it builds.
 *
 * **A TM COPY, NOT A λ ONE**: a λ copy's editor waits in custody when its view closes, and the view that returns
 * offers to bring it over.
 *
 * **A FILE OF ITS OWN**, beside `parked-copy-editor.test.ts`, which holds §5.5's other defect and leaves its page on
 * two views of a λ copy: this scenario starts from all four views on the program, with nothing remembered.
 *
 * The toggles, `+ view` and `✕` are pressed with `userEvent`, as a user presses them; *edit a copy* is `.click()`,
 * since its item is in a menu the case does not open.
 */

const errors: string[] = []
const onError = (e: ErrorEvent): void => {
  errors.push(e.message)
}

const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']

const leaf = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${id}"]:not([role="tab"])`)
const titleText = (id: string): string => leaf(id)?.querySelector('.view-title')?.textContent ?? ''
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const press = (kind: string): Promise<void> =>
  userEvent.click(document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`) as HTMLElement)
const editors = (id: string): number => leaf(id)?.querySelectorAll('.term-editor .cm-editor').length ?? 0
/** Every copy's editor on the page, in whichever view: the source editor is not in a `.term-editor`. */
const copyEditors = (): number => document.querySelectorAll('#views .term-editor .cm-editor').length
/** A view's *move the editor here*, which its menu holds only while it is offered. */
const claim = (id: string): HTMLButtonElement | null =>
  leaf(id)?.querySelector<HTMLButtonElement>('button.claim-editor') ?? null
/** The views on the page whose title is `title`. */
const showing = (title: string): string[] => mounted().filter((id) => titleText(id) === title)

beforeAll(async () => {
  window.addEventListener('error', onError)
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})
afterAll(() => window.removeEventListener('error', onError))

describe('a parked view of a TM copy whose other view, holding the editor, was closed', () => {
  it('has an editor when it comes back', async () => {
    expect(mounted(), 'precondition: all four views').toEqual(FOUR)
    leaf('tm-0')?.querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => titleText('tm-0') === 'TM · copy 1' && editors('tm-0') === 1, 'the copy and its editor')
    const copy = leaf('tm-0')?.querySelector<HTMLElement>('button.view-title')?.dataset.binding ?? ''
    expect(copy, 'precondition: the view’s title names its copy').toMatch(/^tm:scratch-\d+$/)

    // THE SOURCE BESIDE TM, WHERE THE SECOND VIEW OF THE COPY IS ADDED: that arrangement alone holds it.
    await press('lambda')
    await press('asm')
    expect(mounted(), 'precondition: the source beside the TM view').toEqual(['source', 'tm-0'])
    leaf('tm-0')?.querySelector<HTMLElement>('button.view-title')?.focus()
    await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
    const item = (): HTMLButtonElement | null =>
      document.querySelector<HTMLButtonElement>(`#new-view-menu button[data-binding="${copy}"]`)
    await until(() => item() !== null, '+ view’s item for the copy')
    await userEvent.click(item() as HTMLButtonElement)
    const second = mounted().find((id) => id !== 'source' && id !== 'tm-0')
    if (second === undefined) throw new Error('+ view added no second view of the copy')
    await until(() => titleText(second) === 'TM · copy 1', 'the second view of the copy')
    expect(editors('tm-0'), 'precondition: the editor stays in the first view').toBe(1)
    expect(editors(second), 'precondition: the second view holds no editor').toBe(0)
    expect(claim(second), 'precondition: the second view offers to take the editor').not.toBeNull()

    // ALL FOUR AGAIN, BY TWO SWITCHES: neither arrangement names the second view, so it is parked.
    await press('asm')
    await press('lambda')
    expect(mounted(), 'precondition: the second view is off the page').toEqual(FOUR)
    expect(titleText('tm-0'), 'precondition: the view on the page shows the copy').toBe('TM · copy 1')
    expect(editors('tm-0'), 'precondition: the view on the page holds the editor').toBe(1)

    // THE HOLDER IS CLOSED, WHICH DESTROYS THE EDITOR, and no view in the tree shows the copy to take a fresh one.
    await userEvent.click(leaf('tm-0')?.querySelector<HTMLButtonElement>('button.view-close') as HTMLButtonElement)
    await focusInPage('the ✕ of the view that held the copy’s editor')
    expect(mounted(), 'precondition: the holder is closed').toEqual(['source', 'lambda-0', 'asm-0'])
    expect(copyEditors(), 'precondition: the copy’s editor went with its view').toBe(0)

    // THE TM TOGGLE SHOWS THE TREE BEFORE THE ✕, WITH A NEW VIEW ON THE PROGRAM WHERE THE CLOSED ONE WAS.
    await press('tm')
    expect(mounted(), 'precondition: all four views again').toEqual(FOUR)
    expect(titleText('tm-0'), 'precondition: the view built where the closed one was shows the program').toBe(
      'TM · program',
    )

    // BACK TO THE ARRANGEMENT THAT HOLDS THE PARKED VIEW.
    await press('lambda')
    await press('asm')
    expect(mounted()).toEqual(['source', 'tm-0', second])
    expect(errors, 'a handler threw').toEqual([])
    expect(titleText(second)).toBe('TM · copy 1')
    expect(showing('TM · copy 1'), 'precondition: the returned view alone shows the copy').toEqual([second])
    expect(editors(second), 'the view came back showing a copy with no editor').toBe(1)
  })
})
