import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { treeKey } from '../../src/arrangements'
import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from '../../src/buffers-store'
import { LAYOUT_STORAGE_KEY, type LayoutNode } from '../../src/layout'
import { serializeWorkspace } from '../../src/workspace'
import { fourViews, fourViewWorkspace, SHELL, until } from './harness'

/**
 * A RELOAD WHILE A PARKED VIEW SHOWS A COPY — the view layouts spec §5.2: the view comes back on the program, and the
 * copy is in the copies menu.
 *
 * A parked view's binding is stored with the rest (`bindings-stored.test.ts` holds that), and the tree stored beside
 * it does not hold its leaf: a remembered arrangement does. After a reload no view is built for that leaf until its
 * arrangement is entered, and the view built then is a new one under the parked view's id. **THE STORED BINDING MUST
 * NOT REACH THAT VIEW.** `main.ts`'s restore takes a binding only for a leaf of the stored tree, so this one is
 * never seeded.
 *
 * **THE EMPTY BINDINGS THE MOUNT STORES ARE NOT WHAT HOLDS THAT.** The copies are written once at start-up, before
 * any view is built, and again by the first layout, and each write reads its bindings off the views: no view is on
 * the copy either time, so storage holds none whether the binding was seeded or not. Measured with the restore
 * taking a binding for a remembered arrangement's leaf too (2026-10-12): the stored bindings were as empty, and the
 * first case failed on the copy's row, which no longer said *paused*, and the second on the view's title. This file's
 * doc said the first layout's write is what drops the binding, and the first case's `{}` read as holding it.
 *
 * **SEEDED BEFORE THE ONE MOUNT**, as `buffer-restore.test.ts` seeds its own and for its reason, and built with the
 * app's own writers: the source over the asm and TM views, all four remembered, and `lambda-0` bound to the copy.
 */

/** The tree on screen when the page was left: the λ view switched off, out of `fourViews()`. */
const WITHOUT_LAMBDA: LayoutNode = {
  kind: 'split',
  dir: 'column',
  sizes: [0.5, 0.5],
  children: [
    { kind: 'leaf', id: 'source', pane: 'source' },
    {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [
        { kind: 'leaf', id: 'asm-0', pane: 'asm' },
        { kind: 'leaf', id: 'tm-0', pane: 'tm' },
      ],
    },
  ],
}

const SEEDED_BUFFERS = serializeBuffers({
  minted: 1,
  buffers: [{ id: 'scratch-1', label: 'copy 1', text: '(\\a. a)', collapsed: false, leg: 'lambda' }],
  bindings: { 'lambda-0': 'scratch-1' },
})
const SEEDED_WORKSPACE = serializeWorkspace({
  ...fourViewWorkspace(),
  tree: WITHOUT_LAMBDA,
  focused: 'source',
  arrangements: { [treeKey(fourViews())]: fourViews() },
})

const leaf = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${id}"]:not([role="tab"])`)
const titleText = (id: string): string => leaf(id)?.querySelector('.view-title')?.textContent ?? ''
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const stored = () => parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))
const rowNames = (): (string | null)[] =>
  [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row-name')].map((e) => e.textContent)

beforeAll(async () => {
  await page.viewport(1280, 896)
  localStorage.setItem(LAYOUT_STORAGE_KEY, SEEDED_WORKSPACE)
  localStorage.setItem(BUFFERS_STORAGE_KEY, SEEDED_BUFFERS)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('a reload while a parked view shows a copy', () => {
  it('opens on the stored tree, with the copy kept and shown by no view', () => {
    expect(mounted(), 'precondition: the stored tree, which has no λ view').toEqual(['source', 'asm-0', 'tm-0'])
    expect(
      stored()?.buffers.map((b) => b.id),
      'the copy is kept',
    ).toEqual(['scratch-1'])
    // WHAT THE MOUNT LEAVES IN STORAGE, WHICH IS EMPTY WITH THE BINDING SEEDED TOO (the file's doc).
    expect(stored()?.bindings, 'the parked view’s binding outlived the view').toEqual({})
    // THIS IS WHAT A SEEDED BINDING CHANGES: the copy is warmed for the view it is bound to, and its row says so.
    document.querySelector<HTMLButtonElement>('#buffers')?.click()
    expect(rowNames(), 'a copy no view shows is not given a worker').toEqual(['λ copy 1 · not shown · paused'])
    document.querySelector<HTMLElement>('.buffer-list')?.hidePopover()
  })

  it('builds the view on the program when its arrangement is entered', async () => {
    // WITH THE POINTER, as a user presses the λ toggle.
    await userEvent.click(document.querySelector('#views-shown button[data-shows="lambda"]') as HTMLElement)
    expect(mounted(), 'precondition: the remembered arrangement, with the λ view').toEqual([
      'source',
      'lambda-0',
      'asm-0',
      'tm-0',
    ])
    expect(titleText('lambda-0'), 'the view built under the parked view’s id took its stored binding').toBe(
      'λ · program',
    )
    expect(stored()?.bindings).toEqual({})
  })
})
