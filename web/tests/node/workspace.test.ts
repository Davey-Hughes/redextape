import { describe, expect, it } from 'vitest'
import { defaultLayout, leaves, serializeLayout, splitLeaf } from '../../src/layout'
import {
  DEFAULT_SPEED,
  defaultFocus,
  defaultWorkspace,
  isSpeed,
  PRESETS,
  parseWorkspace,
  presetOf,
  SPEEDS,
  type Switches,
  serializeWorkspace,
  WORKSPACE_VERSION,
  withPanel,
} from '../../src/workspace'

const SPLIT = splitLeaf(defaultLayout(), 'lambda-0', 'row', 'pane-1', 'tm')

describe('presetOf', () => {
  it('names the three presets and calls the other five combinations custom', () => {
    const all: Switches[] = []
    for (const steps of ['view', 'bar'] as const)
      for (const views of ['tiles', 'stage'] as const)
        for (const readout of ['strip', 'inspector'] as const) all.push({ steps, views, readout })
    const named = all.map(presetOf)
    expect(named.filter((p) => p !== null).sort()).toEqual(['debugger', 'explorer', 'stage'])
    expect(named.filter((p) => p === null)).toHaveLength(5)
    expect(presetOf(PRESETS.explorer)).toBe('explorer')
    expect(presetOf(PRESETS.debugger)).toBe('debugger')
    expect(presetOf(PRESETS.stage)).toBe('stage')
  })
})

describe('the speed ladder', () => {
  it('runs from 1/s to 5,000/s with 8/s the default', () => {
    expect(SPEEDS[0]).toBe(1)
    expect(SPEEDS[SPEEDS.length - 1]).toBe(5000)
    expect(DEFAULT_SPEED).toBe(8)
    expect(isSpeed(8)).toBe(true)
    expect(isSpeed(9)).toBe(false)
    expect(isSpeed('8')).toBe(false)
  })
})

describe('defaultFocus', () => {
  it('is the first λ or TM leaf, and the source leaf only when there is no other', () => {
    expect(defaultFocus(defaultLayout())).toBe('lambda-0')
    expect(defaultFocus({ kind: 'leaf', id: 'source', pane: 'source' })).toBe('source')
  })
})

describe('parseWorkspace', () => {
  it('migrates a version 1 layout: the tree kept, Explorer, speed 8, the first view focused, no panels', () => {
    const ws = parseWorkspace(serializeLayout(SPLIT))
    expect(ws).not.toBeNull()
    expect(ws?.tree).toEqual(SPLIT)
    expect(ws?.switches).toEqual(PRESETS.explorer)
    expect(ws?.speed).toBe(8)
    expect(ws?.focused).toBe('lambda-0')
    expect(ws?.panels).toEqual({})
  })

  it('round-trips version 2', () => {
    const ws = {
      tree: SPLIT,
      switches: PRESETS.stage,
      speed: 250 as const,
      focused: 'pane-1',
      panels: { 'tm-0': { rules: false } },
    }
    const raw = serializeWorkspace(ws)
    expect(JSON.parse(raw).version).toBe(WORKSPACE_VERSION)
    expect(parseWorkspace(raw)).toEqual(ws)
  })

  it.each([
    ['nothing stored', null],
    ['not JSON', '{'],
    ['an unknown version', JSON.stringify({ version: 3, tree: defaultLayout() })],
    ['an invalid tree', JSON.stringify({ version: 1, tree: { kind: 'split', dir: 'row', children: [], sizes: [] } })],
  ])('returns null for %s', (_what, raw) => {
    expect(parseWorkspace(raw)).toBeNull()
  })

  const valid = (): Record<string, unknown> => JSON.parse(serializeWorkspace(defaultWorkspace()))
  it.each([
    [
      'an unknown switch value',
      (e: Record<string, unknown>) => ({ ...e, switches: { steps: 'side', views: 'tiles', readout: 'strip' } }),
    ],
    ['a missing switch', (e: Record<string, unknown>) => ({ ...e, switches: { steps: 'view', views: 'tiles' } })],
    ['a speed off the ladder', (e: Record<string, unknown>) => ({ ...e, speed: 9 })],
    ['a focus naming no leaf', (e: Record<string, unknown>) => ({ ...e, focused: 'pane-9' })],
    [
      'a panel map keyed by a leaf not in the tree',
      (e: Record<string, unknown>) => ({ ...e, panels: { 'pane-9': { rules: true } } }),
    ],
    [
      'a panel state that is not a boolean',
      (e: Record<string, unknown>) => ({ ...e, panels: { 'tm-0': { rules: 'yes' } } }),
    ],
    // **AT VERSION 2, NOT ONLY THROUGH THE MIGRATION.** The `'an invalid tree'` row above is wrapped at
    // version 1, so it measured the migration branch's guard alone; a hand-edited version 2 envelope is
    // the reachable hazard, and an unvalidated tree reaches `applyLayout` — a split with no children
    // renders as a pane with wrong padding, and a source leaf under another id mints an empty section
    // beside the detached editor (`layout.ts`'s `validate` argues both).
    // EACH SPOILED TREE CARRIES A `focused` THAT ITS OWN LEAVES SATISFY. Otherwise the envelope is
    // refused by the focus check and the tree check is never reached — which is how the first version of
    // these two rows passed against a `parseWorkspace` that took its version 2 tree entirely on trust.
    [
      'a version 2 tree whose source leaf is under another id',
      (e: Record<string, unknown>) => ({ ...e, tree: { kind: 'leaf', id: 'foo', pane: 'source' }, focused: 'foo' }),
    ],
    [
      'a version 2 tree whose sizes do not sum to 1',
      (e: Record<string, unknown>) => ({
        ...e,
        tree: {
          kind: 'split',
          dir: 'row',
          sizes: [0.9, 0.9],
          children: [
            { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
            { kind: 'leaf', id: 'tm-0', pane: 'tm' },
          ],
        },
        focused: 'lambda-0',
        panels: {},
      }),
    ],
  ])('rejects the whole envelope for %s', (_what, spoil) => {
    expect(parseWorkspace(JSON.stringify(spoil(valid())))).toBeNull()
  })
})

describe('serializeWorkspace', () => {
  it('drops the panel state of a leaf that has left the tree, and a focus on one', () => {
    const ws = {
      ...defaultWorkspace(),
      focused: 'pane-9',
      panels: { 'pane-9': { rules: false }, 'tm-0': { rules: false } },
    }
    const back = JSON.parse(serializeWorkspace(ws))
    expect(back.panels).toEqual({ 'tm-0': { rules: false } })
    expect(back.focused).toBe('lambda-0')
  })
})

describe('withPanel', () => {
  it('records one panel of one view without touching the others', () => {
    const next = withPanel({ 'tm-0': { rules: false } }, 'pane-1', 'rules', true)
    expect(next).toEqual({ 'tm-0': { rules: false }, 'pane-1': { rules: true } })
  })
})

describe('defaultWorkspace', () => {
  it('is the default tree, Explorer, speed 8, focused on the λ view', () => {
    const ws = defaultWorkspace()
    expect(leaves(ws.tree).map((l) => l.id)).toEqual(['source', 'lambda-0', 'tm-0'])
    expect(ws.switches).toEqual(PRESETS.explorer)
    expect(ws.speed).toBe(8)
    expect(ws.focused).toBe('lambda-0')
  })
})
