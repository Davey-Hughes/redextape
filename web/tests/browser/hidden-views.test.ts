import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LambdaTrees } from '../../src/lambda-trees'
import { ruleCount } from '../../src/protocol'
import { TmPane } from '../../src/tm-pane'
import { SHELL, until } from './harness'

/**
 * A view off the page costs nothing (Plan 7 part 4a, closing part 2b's "`replies.ts` paints disconnected
 * panes"): a hidden TM view is not handed each compile's machine, and a hidden λ view asks the worker for no
 * tree. In the Stage preset every view but the shown one is off the page.
 */
let view: EditorView
/** The machine `beforeAll`'s own compile seeded a TM view with, before any view was hidden. */
let baselineRules = -1

const pick = (sel: string): void => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
  const m = document.querySelector<HTMLElement>('#workspace-menu')
  if (m?.matches(':popover-open')) m.hidePopover()
}
const tab = (leaf: string) => document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`)
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const tick = () => new Promise((r) => setTimeout(r, 0))

async function compile(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
}

function linkAt(pos: number): void {
  view.dispatch({ selection: { anchor: pos } })
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: "'", ctrlKey: true, cancelable: true }))
}

/** Walk the whole virtualized δ table and report whether any row is painted linked. */
async function anyLinkedRow(): Promise<boolean> {
  const table = document.querySelector<HTMLElement>('[data-leaf="tm-0"] .state-table')
  if (table === null) throw new Error('no table')
  let found = false
  for (let s = 0; s <= 60 && !found; s += 1) {
    table.scrollTop = (table.scrollHeight * s) / 60
    table.dispatchEvent(new Event('scroll'))
    await tick()
    found = document.querySelector('[data-leaf="tm-0"] .is-linked') !== null
  }
  return found
}

/** Walk the whole virtualized δ table and collect every row painted linked, by its own text. */
async function linkedSet(): Promise<Set<string>> {
  const table = document.querySelector<HTMLElement>('[data-leaf="tm-0"] .state-table')
  if (table === null) throw new Error('no table')
  const out = new Set<string>()
  for (let s = 0; s <= 60; s += 1) {
    table.scrollTop = (table.scrollHeight * s) / 60
    table.dispatchEvent(new Event('scroll'))
    await tick()
    for (const r of document.querySelectorAll('[data-leaf="tm-0"] .is-linked')) out.add(r.textContent ?? '')
  }
  return out
}

describe('views off the page', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    const setProgram = vi.spyOn(TmPane.prototype, 'setProgram')
    await compile('let x = 40; x + 2')
    const seeded = setProgram.mock.calls.at(-1)?.[0] ?? null
    baselineRules = seeded === null ? -1 : ruleCount(seeded)
    setProgram.mockRestore()
    pick('[data-preset="stage"]')
    tab('lambda-0')?.click()
  })

  afterEach(() => vi.restoreAllMocks())

  it('does not hand a hidden TM view each compile, and seeds it when it is shown', async () => {
    tab('lambda-0')?.click()
    await tick()
    const setProgram = vi.spyOn(TmPane.prototype, 'setProgram')
    await compile('let y = 1; y + 1')
    expect(setProgram, 'the TM view is off the page').not.toHaveBeenCalled()
    tab('tm-0')?.click()
    await until(() => setProgram.mock.calls.length > 0, 'the shown TM view to be seeded')
    expect(document.querySelector('[data-leaf="tm-0"] .state-row')).not.toBeNull()
    const seeded = setProgram.mock.calls.at(-1)?.[0] ?? null
    expect(seeded, 'the seeded program is not null').not.toBeNull()
    expect(
      seeded === null ? -1 : ruleCount(seeded),
      "the seeded program is this compile's, not the stale one",
    ).not.toBe(baselineRules)
  })

  it('asks for no λ tree for a hidden λ view', async () => {
    tab('tm-0')?.click()
    const want = vi.spyOn(LambdaTrees.prototype, 'want')
    await compile('let z = 2; z + 2')
    expect(want, 'the λ view is off the page').not.toHaveBeenCalled()
    tab('lambda-0')?.click()
    await until(() => want.mock.calls.length > 0, 'the shown λ view to ask for its tree')
  })

  it('reapplies a link made while it was hidden across the compile, once it is shown', async () => {
    tab('lambda-0')?.click()
    await tick()
    await compile('let w = 3; w + 2')
    linkAt('let w = 3; w + 2'.indexOf('w + 2'))
    await tick()
    tab('tm-0')?.click()
    await until(
      () => document.querySelector('[data-leaf="tm-0"] .state-row') !== null,
      'the shown TM view to draw rows',
    )
    expect(await anyLinkedRow(), 'linked rows present in the shown TM view').toBe(true)
  })

  it('reapplies a link made while it was hidden only for the gesture, once it is shown', async () => {
    // Unlike the previous case, the view IS on the page for the compile — only the link gesture
    // itself, right after, finds it hidden. It is not in `unseen`, so `draw()`'s seed block never
    // runs for it; the fan-out in `setLinkTo` is what has to reach it, same as a view that was never
    // hidden at all.
    tab('tm-0')?.click()
    await tick()
    await compile('let v = 41; v + 2')
    tab('lambda-0')?.click()
    await tick()
    linkAt('let v = 41; v + 2'.indexOf('v + 2'))
    await tick()
    tab('tm-0')?.click()
    await tick()
    expect(await anyLinkedRow(), 'linked rows present in the shown TM view').toBe(true)
  })

  it('shows the current pin, not one left over from before it was hidden, once shown', async () => {
    const src = 'let u = 43; u + 2'
    const p1 = src.indexOf('43')
    const p2 = src.indexOf('u + 2')
    tab('tm-0')?.click()
    await tick()
    await compile(src)
    // Pin `43` while the view is on the page, then hide it and move the pin to `u + 2` while it
    // cannot see the change — the view saw the compile, so it is not in `unseen` and `draw()`'s seed
    // block does not run for it either; only the fan-out reaches it, on both links.
    linkAt(p1)
    await tick()
    const before = await linkedSet()
    tab('lambda-0')?.click()
    await tick()
    linkAt(p2)
    await tick()
    tab('tm-0')?.click()
    await tick()
    const shown = await linkedSet()
    linkAt(p2)
    await tick()
    const expected = await linkedSet()
    // NOT VACUOUS: two empty sets are equal, and so are two pins that mark the same rows.
    expect(expected.size, 'the current pin marks rows').toBeGreaterThan(0)
    expect([...before].sort(), 'the two pins mark different rows').not.toEqual([...expected].sort())
    expect([...shown].sort(), 'the shown view paints the CURRENT pin, not the one it had when hidden').toEqual(
      [...expected].sort(),
    )
  })
})
