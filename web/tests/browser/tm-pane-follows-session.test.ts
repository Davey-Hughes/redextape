import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import FIXTURE from '../../../crates/redextape-core/tests/fixtures/five_minus_three_single_tape.tm?raw'
import type { LinkWiring } from '../../src/link-wiring'
import type { PaneEvents } from '../../src/pane-chrome'
import { PaneCollection } from '../../src/panes'
import type { RunReply, RunRequest } from '../../src/protocol'
import { createReplies } from '../../src/replies'
import { ScratchBuffers } from '../../src/scratch'
import { type PoolPort, SessionPool } from '../../src/session-client'
import { PaneSlot, SessionRegistry } from '../../src/sessions'
import { TmPane } from '../../src/tm-pane'
import type { TmProgram, TmScratchStatus } from '../../src/types'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

/**
 * **A TM PANE SHOWS WHAT ITS SESSION HOLDS, WHETHER OR NOT IT HOLDS THE EDITOR** — Important finding, whole-branch
 * review of the reduced-files slice, confirmed in Chrome before this file existed. A buffer's status and value
 * reading reach every TM pane on it, but were cleared only on the pane that held the editor, so a split pane kept
 * `reduced: single-tape · 241,666 steps` and `value: 2` beside the source program after a rebind, kept a value
 * after its buffer was cooled, and kept both after the buffer's worker died.
 *
 * **A FILE OF ITS OWN, NOT MORE TESTS IN `tm-reduced-buffer.test.ts`, BECAUSE OF THE COOL.** Every test file gets its
 * own page, and that file's tests all paste into the one buffer its `beforeAll` mints; cooling it would leave every
 * test added after this one without a warm buffer to paste into, and its split test already leaves a second TM pane
 * that leaf ids here would have to route around. Here each test closes the panes it split, the cool comes after the
 * rebinds, and the retire, last, mints a second buffer of its own.
 *
 * **A COOL OR RETIRE TELLS WHAT IT MOVES WHAT SOURCE HOLDS** — Important finding, review of the fix that made the
 * selector reseed a TM pane. `ScratchBuffers.cool` and `retire` moved panes with a bare `PaneSlot.rebind`, so a pane
 * that had visited a reduced buffer came back to source with the buffer's machine and false fork facts. Those two
 * tests follow the review's flow, and compare every moved pane with a pane that never left source.
 *
 * **THE WORKER'S DEATH IS RECONSTRUCTED, NOT DRIVEN.** No text reaches `onTmScratch`'s `worker-error` reply through
 * the app — `tmScratch` answers every string with diagnostics or a scratch — so that describe drives `createReplies`
 * directly over real panes, a real registry and a real `ScratchBuffers` with no threads behind it, the shape
 * `tests/node/replies.test.ts`'s `scratchDriver` uses. It runs first, before the app is mounted over the page.
 */

const PROGRAM: TmProgram = {
  states: [{ name: 'pc0', accept: false, rules: [{ read: ['a'], write: ['b'], moves: ['R'], next: 0 }] }],
  alphabet: ['a', 'b'],
  tapes: 1,
  width: 8,
  start: 0,
}

const REDUCED: TmScratchStatus = {
  available: true,
  reason: '',
  width: 8,
  run: 'Running',
  header: true,
  reduction: { stages: ['single-tape'], steps: 241_666 },
}

/** `PaneEvents`'s members a `TmPane`'s constructor reads, all inert — `tm-pane-editor.test.ts`'s `events`. */
const inertEvents = (): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
  editScratch: vi.fn(),
  collapse: vi.fn(),
})

describe('a TM buffer whose worker died', () => {
  it('tells every TM pane on the buffer, not only the one holding the editor', () => {
    const reg = new SessionRegistry()
    const port = (): PoolPort => ({
      postMessage: (_m: RunRequest) => undefined,
      addEventListener: (_t: 'message', _h: (e: { data: RunReply }) => void) => undefined,
      terminate: () => undefined,
    })
    const buffers = new ScratchBuffers({
      registry: reg,
      pool: new SessionPool(port, () => undefined),
      historyBytes: 1_000_000,
      onReply: () => undefined,
    })
    const id = buffers.forkBlank('tm')
    const panes = new PaneCollection()
    const made = ['held', 'split'].map((leaf) => {
      const host = document.createElement('section')
      document.body.append(host)
      const pane = new TmPane(host, inertEvents())
      panes.add({ id: leaf, kind: 'tm', slot: new PaneSlot('tm', id), pane, host })
      return { pane, host }
    })
    const [held, split] = made
    if (held === undefined || split === undefined) throw new Error('two panes were not made')
    const replies = createReplies({
      setProgram: () => undefined,
      sessions: reg,
      scratchpad: buffers,
      results: document.createElement('section'),
      view: () => undefined as unknown as EditorView,
      panes,
      links: {} as LinkWiring,
      draw: () => undefined,
      // THE FIRST PANE IS THE EDITOR'S HOME, as a buffer bound through a pane's selector makes it.
      editorHome: () => held.pane,
      onBuffersPersist: () => undefined,
      notify: () => undefined,
    })

    replies.onScratchReply(id, { kind: 'tm-scratch-compiled', gen: 1, tm: REDUCED, tmProgram: PROGRAM, tapeNames: [] })
    replies.onScratchReply(id, {
      kind: 'tm-value',
      gen: 1,
      run: { run: 'Ended', steps: 241_666, cap: 241_666 },
      value: { Value: { text: '2' } },
    })
    for (const { host } of made) {
      expect(host.querySelector('.tm-status')?.textContent).toContain('reduced: single-tape · 241,666 steps')
      expect(host.querySelector('.tm-value')?.textContent).toBe('value: 2')
    }
    expect(held.host.querySelector('.cm-editor')).not.toBeNull()

    replies.onScratchReply(id, { kind: 'worker-error', gen: 1, message: 'the thread threw' })
    for (const { host } of made) {
      expect(host.querySelector('.tm-status')?.textContent).not.toContain('reduced')
      expect(host.querySelector('.tm-value')?.textContent).toBe('')
    }
    for (const { host } of made) host.remove()
  })
})

describe('a TM pane told it is attached', () => {
  /**
   * **DRIVEN ON THE PANE, BECAUSE NO ROUTE IN THE APP REACHES THIS CLEAR FIRST ANY MORE.** Every route that moves a
   * pane onto source reseeds it before `PaneSlot.render` calls `setDetached(false)`, so the app-level tests below stay
   * green with the clear removed. This is what a route that moved a pane without a seed would leave the pane holding.
   */
  it('forgets a buffer’s sentence and value', () => {
    const host = document.createElement('section')
    document.body.append(host)
    const pane = new TmPane(host, inertEvents())
    pane.setDetached(true)
    pane.setScratchStatus(REDUCED)
    pane.setScratchValue({ run: { run: 'Ended', steps: 241_666, cap: 241_666 }, value: { Value: { text: '2' } } })
    // ONE COMPARISON PER STATE, so a failure shows both lines rather than stopping at the first.
    const shown = () => ({
      status: host.querySelector('.tm-status')?.textContent ?? '',
      value: host.querySelector('.tm-value')?.textContent ?? '',
    })
    expect(shown()).toEqual({ status: 'reduced: single-tape · 241,666 steps', value: 'value: 2' })
    pane.setDetached(false)
    expect(shown()).toEqual({ status: '', value: '' })
    host.remove()
  })
})

const leaf = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-leaf="${id}"]`)
  if (el === null) throw new Error(`no pane at [data-leaf="${id}"]`)
  return el
}
const statusOf = (id: string) => leaf(id).querySelector('.tm-status')?.textContent ?? ''
const valueTextOf = (id: string) => leaf(id).querySelector('.tm-value')?.textContent ?? ''
const labelsOf = (id: string) => [...leaf(id).querySelectorAll('.tape-label')].map((e) => e.textContent)
/**
 * The δ table's scroll range, which is its row count times `ROW_HEIGHT`: a fact about the MACHINE the pane holds,
 * unlike the rows themselves, which are a window that moves with the running state.
 */
const tableHeightOf = (id: string) => leaf(id).querySelector<HTMLElement>('.state-spacer')?.style.height ?? ''
/** The fork control as `TmPane.#refreshDetach` leaves it: `absent`, `disabled: <its reason>`, or `enabled`. */
const forkOf = (id: string) => {
  const button = leaf(id).querySelector<HTMLButtonElement>('button.detach')
  return button === null ? 'absent' : button.disabled ? `disabled: ${button.title}` : 'enabled'
}
const selectOf = (id: string) => leaf(id).querySelector<HTMLButtonElement>('button.view-title')?.dataset.binding
/** Every pair `id`'s title menu offers, as keys — opens and closes the menu to read it. */
function offered(id: string): string[] {
  const title = leaf(id).querySelector<HTMLButtonElement>('button.view-title')
  if (title === null) return []
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const keys = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b) => b.dataset.binding ?? '')
  menu?.hidePopover()
  return keys
}
const tmLeaves = () =>
  [...document.querySelectorAll<HTMLElement>('[data-kind="tm"]')].map((el) => el.dataset.leaf ?? '')

/**
 * Split `id` to the right through its `⋯` menu and answer the leaf it created — `pick` is `'same'`
 * (another view of this), `'source'`, or a `bindingKey(leg, session)`.
 */
async function split(id: string, pick: string): Promise<string> {
  const before = tmLeaves()
  const more = leaf(id).querySelector<HTMLButtonElement>('button.view-more')
  if (more === null) throw new Error(`no view menu on [data-leaf="${id}"]`)
  more.click()
  const menu = document.getElementById(more.getAttribute('aria-controls') ?? '')
  menu?.querySelector<HTMLButtonElement>('button.view-split[data-dir="row"]')?.click()
  const selector =
    pick === 'same' ? 'button[data-same]' : pick === 'source' ? 'button[data-source]' : `button[data-binding="${pick}"]`
  const chosen = menu?.querySelector<HTMLButtonElement>(`.view-menu-pairs ${selector}`)
  if (chosen == null) {
    const offered = [...(menu?.querySelectorAll<HTMLButtonElement>('.view-menu-pairs button') ?? [])].map(
      (b) => b.textContent,
    )
    throw new Error(`no ${pick} — offered: ${offered.join(' | ')}`)
  }
  chosen.click()
  await until(() => tmLeaves().length === before.length + 1, 'the split to add a TM pane')
  const created = tmLeaves().find((l) => !before.includes(l))
  if (created === undefined) throw new Error('the split added no TM pane')
  return created
}

/** Pick `(tm, session)` in a view's own title menu, the gesture a user makes. */
function rebind(id: string, session: string): void {
  const title = leaf(id).querySelector<HTMLButtonElement>('button.view-title')
  if (title === null) throw new Error(`no title-selector on [data-leaf="${id}"]`)
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const item = menu?.querySelector<HTMLButtonElement>(`button[data-binding="${bindingKey('tm', session)}"]`)
  if (item == null) throw new Error(`[data-leaf="${id}"] offers no TM pair for ${session}`)
  item.click()
}

function close(id: string): void {
  leaf(id).querySelector<HTMLButtonElement>('button[aria-label="close this view"]')?.click()
}

/** The source program's δ table height, read off `tm-0` before it is bound to the buffer. */
let sourceTable = ''

/** Open the header's buffer list afresh, so its rows describe the buffers as they are now. */
function openBufferList(): void {
  const list = document.querySelector<HTMLElement>('.buffer-list')
  if (list?.matches(':popover-open') === true) list.hidePopover()
  document.querySelector<HTMLButtonElement>('#buffers')?.click()
}

/** Click the buffer list's control named `label`, as a user does. */
function clickBufferControl(label: string): void {
  openBufferList()
  const control = document.querySelector<HTMLButtonElement>(`.buffer-list button[aria-label="${label}"]`)
  if (control === null) throw new Error(`no "${label}" control in the buffer list`)
  control.click()
}

/**
 * Mint a TM buffer, bind `tm-0` to it through its own selector, and paste the reduced fixture into the editor that
 * mounts there: the selector visit the review's flow starts from.
 */
async function visitNewBuffer(session: string): Promise<void> {
  openBufferList()
  document.querySelector<HTMLButtonElement>('.buffer-list button.new-tm')?.click()
  await until(() => offered('tm-0').includes(bindingKey('tm', session)), `${session} to be offered`)
  rebind('tm-0', session)
  await until(() => leaf('tm-0').querySelector('.cm-editor') !== null, `the ${session} editor to mount`)
  const dom = leaf('tm-0').querySelector<HTMLElement>('.cm-editor')
  const editor = dom === null ? null : EditorView.findFromDOM(dom)
  if (editor === null) throw new Error(`the ${session} editor has no view`)
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: FIXTURE } })
  await until(() => valueTextOf('tm-0') === 'value: 2', `the fixture to read 2 in ${session}`)
  expect(tableHeightOf('tm-0')).not.toBe(sourceTable)
}

/**
 * Put the review's panes on `session`, which `tm-0` already shows through its selector: a split made on the buffer,
 * and a split made on source then rebound onto the buffer. Also split one pane on source that stays there, for the
 * moved panes to be compared with. Answers the panes a cool or retire of the buffer moves, and that reference.
 */
async function panesOnBuffer(session: string): Promise<{ moved: string[]; reference: string }> {
  const reference = await split('tm-0', bindingKey('tm', 'source'))
  const same = await split('tm-0', 'same')
  const rebound = await split('tm-0', bindingKey('tm', 'source'))
  rebind(rebound, session)
  const moved = ['tm-0', same, rebound]
  await until(() => moved.every((id) => valueTextOf(id) === 'value: 2'), `every pane on ${session} to read 2`)
  expect(tableHeightOf(reference)).toBe(sourceTable)
  expect(forkOf(reference)).toBe('enabled')
  return { moved, reference }
}

/**
 * What each moved pane shows against what a pane that never left source shows: the binding, the machine, the status
 * line, the value line and the fork control. One comparison, so a failure names every fact that differs on every
 * pane rather than only the first.
 */
function expectShowsSource(moved: string[], reference: string): void {
  const shown = (id: string) => ({
    id,
    binding: selectOf(id),
    table: tableHeightOf(id),
    status: statusOf(id),
    value: valueTextOf(id),
    fork: forkOf(id),
  })
  const source = {
    binding: bindingKey('tm', 'source'),
    table: sourceTable,
    status: statusOf(reference),
    value: '',
    fork: 'enabled',
  }
  expect(moved.map(shown)).toEqual(moved.map((id) => ({ id, ...source })))
}

describe('a TM pane rebound, cooled or retired off a reduced buffer', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    const view: EditorView = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
    await until(() => tableHeightOf('tm-0') !== '' && tableHeightOf('tm-0') !== '0px', 'the source machine to draw')
    sourceTable = tableHeightOf('tm-0')
    await visitNewBuffer('scratch-1')
  })

  it('forgets the buffer’s sentence, value, machine and fork facts when a split of it is rebound to source', async () => {
    const created = await split('tm-0', 'same')
    expect(valueTextOf(created)).toBe('value: 2')
    expect(forkOf(created)).toBe('absent')
    rebind(created, 'source')
    await until(() => tableHeightOf(created) === sourceTable, 'the rebound pane to draw the source machine')
    expect(statusOf(created)).not.toContain('reduced')
    expect(valueTextOf(created)).toBe('')
    expect(forkOf(created)).toBe('enabled')
    close(created)
  })

  it('shows the buffer’s sentence, value and tape label when a pane on source is rebound onto it', async () => {
    const created = await split('tm-0', bindingKey('tm', 'source'))
    expect(tableHeightOf(created)).toBe(sourceTable)
    expect(forkOf(created)).toBe('enabled')
    rebind(created, 'scratch-1')
    await until(() => valueTextOf(created) === 'value: 2', 'the rebound pane to read 2')
    expect(statusOf(created)).toContain('reduced: single-tape · 241,666 steps')
    expect(labelsOf(created)).toEqual(['5 tapes, interleaved'])
    expect(forkOf(created)).toBe('absent')
    close(created)
  })

  /**
   * **THE REVIEW'S FLOW, AND RED BEFORE A COOL RESEEDED WHAT IT MOVED.** A cool moved every pane with a bare
   * `PaneSlot.rebind`, so all three panes kept the buffer's machine and a status naming one of its states. The two
   * splits read `disabled: 1,866 rules — too large to open in an editor`, the buffer's fork facts, and `tm-0`, which
   * had held the editor, had no fork control at all.
   */
  it('tells every pane a cool moves what source holds: its machine, its status and a fork control', async () => {
    const { moved, reference } = await panesOnBuffer('scratch-1')
    clickBufferControl('pause TM copy 1')
    await until(
      () => moved.every((id) => selectOf(id) === bindingKey('tm', 'source')),
      'the cool to move every pane to source',
    )
    expectShowsSource(moved, reference)
    for (const id of moved.slice(1)) close(id)
    close(reference)
  })

  it('tells every pane a retire moves what source holds, as a cool does', async () => {
    await visitNewBuffer('scratch-2')
    const { moved, reference } = await panesOnBuffer('scratch-2')
    clickBufferControl('delete TM copy 2')
    await until(
      () => moved.every((id) => selectOf(id) === bindingKey('tm', 'source')),
      'the retire to move every pane to source',
    )
    expectShowsSource(moved, reference)
    for (const id of moved.slice(1)) close(id)
    close(reference)
  })
})
