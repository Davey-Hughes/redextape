import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from '../../src/buffers-store'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { encodeLink } from '../../src/share-link'
import { bindingKey } from '../../src/view-header'
import { defaultWorkspace, PRESETS, parseWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A LINK OPENED AT START-UP, WHOLE, AND ITS UNDO** — Plan 7 part 6a spec §5.3 and §5.5. The page is a returning
 * visitor's: `let x = 40; x + 2` under `unary` (`setup.ts`), Explorer, and a λ copy bound to the λ view. The link
 * carries `let y = 10; y + 5` under `binary` and the Debugger preset's workspace, whose λ view is drawn as an outline. A
 * link takes precedence over both stores: the page opens on it, drops the copy's binding without warming the copy, keeps
 * the copy listed, and clears the fragment; its `undo` puts back the stored program, workspace and the copy's view.
 * ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 *
 * **THE LINK CARRIES A TWO-LINE PROGRAM, NOT AN EXAMPLE**: no case here is about a recording, and at a tenth of a core
 * an example's first compile outlasted the start-up notice, and the `undo` on it.
 */

const LINKED = 'let y = 10; y + 5'
const COPY = 'scratch-1'
const LINK_WORKSPACE = {
  ...defaultWorkspace(),
  switches: PRESETS.debugger,
  display: { 'lambda-0': { layout: 'outline', vars: 'names', map: 'icicle' } },
} as const

const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
/** The readout's lines in either mode: the strip's segments, or the inspector's rows, each its label and value. */
const readout = () =>
  [...document.querySelectorAll('#results .segment, #results .row')].map((el) =>
    el.matches('.row')
      ? `${el.querySelector('.row-label')?.textContent ?? ''} = ${el.querySelector('.row-value')?.textContent ?? ''}`
      : (el.textContent ?? ''),
  )
const lambdaShows = () =>
  document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .view-title')?.dataset.binding ?? ''
const lambdaLayout = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term')?.dataset.layout
const storedBindings = () => parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))?.bindings

let view: EditorView

beforeAll(async () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace(defaultWorkspace()))
  localStorage.setItem(
    BUFFERS_STORAGE_KEY,
    serializeBuffers({
      minted: 1,
      buffers: [{ id: COPY, label: 'copy 1', text: '(λa. a) (λb. b)', collapsed: false, leg: 'lambda' }],
      bindings: { 'lambda-0': COPY },
    }),
  )
  const fragment = await encodeLink({
    program: LINKED,
    encoding: 'binary',
    workspace: serializeWorkspace(LINK_WORKSPACE),
    positions: {},
  })
  history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && readout().length > 0, 'the first compile')
})

describe('a link at start-up', () => {
  it('clears the fragment', () => {
    expect(location.hash).toBe('')
  })

  it("opens the link's program under its encoding", async () => {
    expect(view.state.doc.toString()).toBe(LINKED)
    expect(picker().value).toBe('binary')
    expect(readout()).toContain('λ value = 15')
    expect(readout()).toContain('TM value = 15')
  })

  it("opens the link's workspace, with every view on the program", async () => {
    expect(document.querySelector('#workspace')?.textContent).toBe('Debugger ▾')
    expect(document.querySelector<HTMLElement>('#step-bar')?.hidden).toBe(false)
    expect(lambdaShows()).toBe(bindingKey('lambda', 'source'))
    // **READ ONCE ITS TREE HAS ARRIVED**: until a step's tree lands, the view is drawn `flat` whatever its display.
    await until(() => lambdaLayout() !== 'flat', 'the λ tree')
    expect(lambdaLayout()).toBe('outline')
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.switches).toEqual(PRESETS.debugger)
  })

  it('keeps the copy listed, paused, and drops its binding from storage', () => {
    expect(document.querySelector('#buffers')?.textContent).toBe('copies 1 ▾')
    expect(storedBindings()).toEqual({})
  })

  it('says so, with an undo', () => {
    expect(noticeText()).toBe('opened a shared link')
    expect(undoButton()?.textContent).toBe('undo')
  })

  it('puts back the stored program, its encoding, the workspace and the copy’s view on undo', async () => {
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
    expect(picker().value).toBe('unary')
    expect(document.querySelector('#workspace')?.textContent).toBe('Explorer ▾')
    expect(document.querySelector<HTMLElement>('#step-bar')?.hidden).toBe(true)
    expect(lambdaShows()).toBe(bindingKey('lambda', COPY))
    expect(noticeText()).toBe('put back the program and the workspace')
    expect(document.activeElement).toBe(view.contentDOM)
    expect(storedBindings()).toEqual({ 'lambda-0': COPY })
    // THE COPY WAS COLD, AND UNDO WARMED IT: its view draws its term.
    await until(() => lambdaLayout() === 'code', 'the copy’s term')
    await until(() => idle() && (segments()[0] ?? '').startsWith('λ 42'), 'the program’s compile')
  })
})
