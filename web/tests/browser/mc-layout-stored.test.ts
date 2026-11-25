import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { fieldWidths } from '../../../pkg/redextape_wasm.js'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { decodeLink } from '../../src/share-link'
import type { Workspace } from '../../src/workspace'
import {
  host,
  menuOf,
  moreOf,
  picker,
  SHELL,
  shareButton,
  shareLinkField,
  shareMenu,
  stateIdle,
  storedLayout,
  toggle,
  until,
} from './harness'
import { codePanelOf, codeRows, sourceAndClif, syntaxChoice, targetChoice } from './mc-fixture'

/**
 * **A CLIF VIEW'S MACHINE CODE SETTINGS ARE STORED WITH THE WORKSPACE, UNDER THE VIEW'S ID** (machine code panel design
 * §4, *The panel* and *The picker*): the target, the syntax and the bytes in `clifDisplay`, the panel's open state in
 * `panels` and its share in `panelSizes`. A workspace stored by `main`, with none of them, builds x86-64 in AT&T with
 * no bytes and the panel closed; a stored one builds the view as stored; a press stores its choice; the view taken
 * off the screen and brought back, a reload, and a share link each give them back.
 *
 * A RELOAD IS A FRESH `main` ON THE SAME STORE, as `share-open-clif.test.ts` remounts: a query string gives a new
 * module instance, and `localStorage` is left as the last instance wrote it. The cases run in order, each on the
 * mount the case before left.
 */

/** The settings the cases store, choose and look for, past every default. */
const STORED = { layout: 'compact', target: 'x86-64', syntax: 'intel', bytes: true } as const
/** The machine code panel's share to the listing's: three to one, far from the default's one to one. */
const SIZES = { listing: 1, code: 3 }

let mounts = 0
async function mount(): Promise<void> {
  const spec = mounts === 0 ? '../../src/main' : `../../src/main?remount=${mounts}`
  mounts += 1
  document.body.innerHTML = SHELL
  await (await import(/* @vite-ignore */ spec)).ready
  await until(stateIdle, 'the first compile')
  await until(() => clif()?.querySelector('.clif-row.is-next') !== null, 'the clif view at its step 0')
}

const clif = () => host('clif-0')
const pane = () => clif() as HTMLElement
const bytesItem = () =>
  menuOf(moreOf(pane())).querySelector<HTMLButtonElement>('button.clif-bytes') as HTMLButtonElement
const checked = (el: HTMLElement) => el.getAttribute('aria-checked')
const stored = () => storedLayout<Pick<Workspace, 'clifDisplay' | 'panels' | 'panelSizes'>>()
const heightOf = (name: string) =>
  (pane().querySelector(`[data-region="${name}"]`) as HTMLElement).getBoundingClientRect().height

/** What the view shows of its machine code settings, read off its controls, its rows and its regions. */
async function shown(): Promise<{
  target: string | undefined
  syntax: string | undefined
  bytes: boolean
  open: boolean
  share: number
}> {
  const open = codePanelOf(pane()).dataset.open === 'true'
  if (open) await until(() => codeRows(pane()).length > 0, 'the panel’s rows')
  return {
    target: (['x86-64', 'arm64'] as const).find((t) => checked(targetChoice(pane(), t)) === 'true'),
    syntax: (['att', 'intel'] as const).find((s) => checked(syntaxChoice(pane(), s)) === 'true'),
    bytes: checked(bytesItem()) === 'true' && pane().querySelector('.mc-bytes') !== null,
    open,
    share: Math.round((heightOf('code') / heightOf('listing')) * 10) / 10,
  }
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  // A WORKSPACE `main` STORED: the layout alone, no panel state for the view.
  localStorage.setItem(LAYOUT_STORAGE_KEY, sourceAndClif({ clifDisplay: { 'clif-0': { layout: 'exact' } } }))
  await mount()
}, 30_000)

describe('the machine code settings of a stored clif view', () => {
  it('reads a workspace main stored as x86-64 in AT&T, no bytes, the panel closed', async () => {
    const s = await shown()
    expect({ ...s, share: undefined }).toEqual({
      target: 'x86-64',
      syntax: 'att',
      bytes: false,
      open: false,
      share: undefined,
    })
  })

  it('builds the view as stored', async () => {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      sourceAndClif({
        clifDisplay: { 'clif-0': STORED },
        panels: { 'clif-0': { code: true } },
        panelSizes: { 'clif-0': SIZES },
      }),
    )
    await mount()
    expect(await shown()).toEqual({ target: 'x86-64', syntax: 'intel', bytes: true, open: true, share: 3 })
  }, 30_000)

  it('stores the target a press chooses beside what was stored', async () => {
    await userEvent.click(targetChoice(pane(), 'arm64'))
    await until(() => checked(targetChoice(pane(), 'arm64')) === 'true', 'arm64 chosen')
    expect(stored().clifDisplay?.['clif-0']).toEqual({ ...STORED, target: 'arm64' })
    expect(stored().panels?.['clif-0']?.code, 'the panel stored open').toBe(true)
    expect(stored().panelSizes?.['clif-0'], 'the share stored').toMatchObject(SIZES)
  })

  it('gives them back when the view is taken off the screen and brought back', async () => {
    await userEvent.click(toggle('clif'))
    await until(() => clif() === null, 'the clif view to go')
    expect(stored().clifDisplay?.['clif-0'], 'kept while the view is off the screen').toEqual({
      ...STORED,
      target: 'arm64',
    })
    await userEvent.click(toggle('clif'))
    await until(() => clif()?.querySelector('.clif-row.is-next') !== null, 'the clif view back')
    expect(await shown()).toEqual({ target: 'arm64', syntax: 'intel', bytes: true, open: true, share: 3 })
    await userEvent.click(targetChoice(pane(), 'x86-64'))
    expect(checked(syntaxChoice(pane(), 'intel')), 'the syntax kept for x86-64').toBe('true')
    await userEvent.click(targetChoice(pane(), 'arm64'))
  }, 30_000)

  it('gives them back on a reload', async () => {
    await mount()
    expect(await shown()).toEqual({ target: 'arm64', syntax: 'intel', bytes: true, open: true, share: 3 })
  }, 30_000)

  it('carries them in a share link, which opens the view with them', async () => {
    await userEvent.click(shareButton())
    await until(() => shareLinkField().value !== '', 'the link')
    const value = shareLinkField().value
    shareMenu().hidePopover()
    const fragment = value.slice(value.indexOf('#'))
    const opened = await decodeLink(
      fragment,
      [...picker().options].map((o) => o.value),
      fieldWidths() as number[],
    )
    if (opened.kind !== 'whole') throw new Error(`the link opened as ${opened.kind}`)
    expect(opened.workspace.clifDisplay['clif-0']).toEqual({ ...STORED, target: 'arm64' })
    expect(opened.workspace.panels['clif-0']?.code, 'the panel open in the link').toBe(true)
    expect(opened.workspace.panelSizes['clif-0'], 'the share in the link').toMatchObject(SIZES)

    // THE LINK OPENED ON A PAGE WHOSE STORE SAYS OTHERWISE: what the view shows came from the link.
    localStorage.setItem(LAYOUT_STORAGE_KEY, sourceAndClif({ clifDisplay: { 'clif-0': { layout: 'exact' } } }))
    history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
    await mount()
    expect(await shown()).toEqual({ target: 'arm64', syntax: 'intel', bytes: true, open: true, share: 3 })
  }, 30_000)
})
