import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

/**
 * A VIEW THAT COMES BACK TO THE PAGE SCROLLS ONLY WHAT IT STILL HOLDS — the view layouts spec §5.2.
 *
 * `pane-host.ts` keeps the scroll positions of a view that leaves the page until it returns, each beside the element
 * that was scrolled. One of those elements can leave the view while it is away: a copy has one editor, in one view,
 * and *move the editor here* takes it out of a view that is off the page as readily as out of one that is on it. The
 * view that returns must not write the scroll it remembers onto an editor another view has now.
 *
 * **TWO VIEWS OF ONE COPY, IN TWO COMBINATIONS OF VIEWS**: the second λ view is added while all four kinds show, so
 * the combination without the asm view, visited for the first time, has the first λ view and not the second.
 */

const host = (leaf: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${leaf}"]:not([role="tab"])`)
const leaves = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views .pane[data-leaf]')].map((p) => p.dataset.leaf ?? '')
const shows = (leaf: string): string | undefined =>
  host(leaf)?.querySelector<HTMLElement>('.view-title')?.dataset.binding
/** The sideways scroller of the copy's editor, where `leaf`'s view holds it: CodeMirror's own, which moves with it. */
const editorIn = (leaf: string): HTMLElement | null =>
  host(leaf)?.querySelector<HTMLElement>('.term-editor .cm-scroller') ?? null
const toggle = (kind: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#views-shown button[data-shows="${kind}"]`) as HTMLElement
const claim = (leaf: string): HTMLButtonElement | null =>
  host(leaf)?.querySelector<HTMLButtonElement>('button.claim-editor') ?? null

describe('a copy’s editor that another view took while its view was off the page', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  })

  it('is not scrolled by the return of the view that used to hold it', async () => {
    // A COPY IN THE λ VIEW, AND A SECOND VIEW OF IT, which takes the editor.
    host('lambda-0')?.querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => shows('lambda-0') !== bindingKey('lambda', 'source'), 'the copy')
    // ITS EDITOR MOUNTED BEFORE THE SECOND VIEW EXISTS: a view built while the copy has no editor anywhere mounts one
    // itself, and would hold the editor with nothing having moved.
    await until(() => editorIn('lambda-0') !== null, 'the copy’s editor to mount in the first view')
    const copy = shows('lambda-0') as string
    const before = new Set(leaves())
    await userEvent.click(document.querySelector('#new-view') as HTMLElement)
    await userEvent.click(document.querySelector(`#new-view-menu button[data-binding="${copy}"]`) as HTMLElement)
    await until(() => leaves().some((l) => !before.has(l)), 'the second view of the copy')
    const second = leaves().find((l) => !before.has(l)) as string
    await until(() => claim(second) !== null, 'the second view to offer the editor')
    claim(second)?.click()
    await until(() => editorIn(second) !== null, 'the editor to move to the second view')
    const editor = editorIn(second) as HTMLElement
    expect(editor.scrollWidth - editor.clientWidth, 'precondition: the editor scrolls sideways').toBeGreaterThan(300)
    editor.scrollLeft = 300
    expect(editor.scrollLeft, 'precondition: the editor is scrolled in the second view').toBe(300)

    // THE SECOND VIEW LEAVES THE PAGE WITH THE EDITOR, and the first view takes it.
    await userEvent.click(toggle('asm'))
    expect(host(second), 'precondition: the second view is off the page').toBeNull()
    expect(host('lambda-0'), 'precondition: the first view is on it').not.toBeNull()
    await until(() => claim('lambda-0') !== null, 'the first view to offer the editor')
    claim('lambda-0')?.click()
    await until(() => editorIn('lambda-0') !== null, 'the editor to move to the first view')
    expect(editorIn('lambda-0'), 'precondition: the editor that moved is the one that was scrolled').toBe(editor)
    expect(editor.scrollLeft, 'precondition: the editor is at its start in the first view').toBe(0)

    // THE SECOND VIEW COMES BACK, remembering where the editor was scrolled to while it held it.
    await userEvent.click(toggle('asm'))
    expect(host(second), 'the second view did not come back').not.toBeNull()
    expect(editorIn('lambda-0'), 'the editor left the first view').toBe(editor)
    expect(editor.scrollLeft, 'the second view scrolled an editor it no longer holds').toBe(0)
  })
})
