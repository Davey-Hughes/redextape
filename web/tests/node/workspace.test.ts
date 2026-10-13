import { describe, expect, it } from 'vitest'
import { treeKey } from '../../src/arrangements'
import {
  defaultArrangement,
  defaultLayout,
  type LayoutNode,
  leaves,
  serializeLayout,
  splitLeaf,
} from '../../src/layout'
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
  withDisplay,
  withPanel,
  withPanelSizes,
  withTmDisplay,
} from '../../src/workspace'
import { fourViews, fourViewWorkspace } from '../browser/harness'

/** All four views, two rows of two — the tree these cases were written against; `defaultLayout()` is two views now. */
const FOUR = fourViews()
const SPLIT = splitLeaf(FOUR, 'lambda-0', 'row', 'pane-1', 'tm')

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
  it('is the first leaf that is not the source, and the source leaf only when there is no other', () => {
    expect(defaultFocus(FOUR)).toBe('lambda-0')
    expect(defaultFocus(defaultLayout('wide'))).toBe('tm-0')
    expect(defaultFocus({ kind: 'leaf', id: 'source', pane: 'source' })).toBe('source')
  })

  /** An asm view is a view like the others: it was passed over while this took the first λ or TM leaf. */
  it('is the asm leaf where that is the first leaf that is not the source', () => {
    expect(defaultFocus(defaultArrangement(['source', 'asm'], 'wide'))).toBe('asm-0')
    expect(defaultFocus(defaultArrangement(['asm', 'tm'], 'wide'))).toBe('asm-0')
    expect(defaultFocus({ kind: 'leaf', id: 'asm-0', pane: 'asm' })).toBe('asm-0')
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
      panelSizes: { 'tm-0': { rules: 2.5, diagram: 0.5 } },
      inspector: false,
      display: { 'pane-1': { layout: 'outline' as const, vars: 'debruijn' as const, map: 'minimap' as const } },
      tmDisplay: { 'tm-0': { level: 'local' as const, edges: 'chips' as const } },
      arrangements: { 'source+tm': defaultLayout('tall') },
    }
    const raw = serializeWorkspace(ws)
    expect(JSON.parse(raw).version).toBe(WORKSPACE_VERSION)
    expect(parseWorkspace(raw)).toEqual(ws)
  })

  it.each([
    ['nothing stored', null],
    ['not JSON', '{'],
    ['an unknown version', JSON.stringify({ version: 3, tree: defaultLayout('wide') })],
    ['an invalid tree', JSON.stringify({ version: 1, tree: { kind: 'split', dir: 'row', children: [], sizes: [] } })],
  ])('returns null for %s', (_what, raw) => {
    expect(parseWorkspace(raw)).toBeNull()
  })

  const valid = (): Record<string, unknown> => JSON.parse(serializeWorkspace(defaultWorkspace('wide')))
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
  // **A FIELD 2a DID NOT WRITE IS NOT AN INVALID FIELD.** Version 2 shipped without `inspector`, so a
  // workspace stored by part 2a has none; refusing it would reset every upgrading user's layout, which is
  // the one thing the version 2 envelope exists to avoid (spec §3).
  it('defaults a missing inspector to open, and refuses one that is not a boolean', () => {
    const base = {
      version: 2,
      tree: SPLIT,
      switches: PRESETS.explorer,
      speed: 8,
      focused: 'lambda-0',
      panels: {},
    }
    expect(parseWorkspace(JSON.stringify(base))?.inspector).toBe(true)
    expect(parseWorkspace(JSON.stringify({ ...base, inspector: false }))?.inspector).toBe(false)
    expect(parseWorkspace(JSON.stringify({ ...base, inspector: 'yes' }))).toBeNull()
  })

  // **A FIELD 2b DID NOT WRITE IS NOT AN INVALID FIELD**, for `inspector`'s reason: a workspace stored
  // before Plan 7 part 4a has no `display`, and refusing it would reset every upgrading user's layout.
  it('defaults a missing display to none stored, and refuses a malformed one', () => {
    const base = { version: 2, tree: SPLIT, switches: PRESETS.explorer, speed: 8, focused: 'lambda-0', panels: {} }
    expect(parseWorkspace(JSON.stringify(base))?.display).toEqual({})
    const good = { 'lambda-0': { layout: 'outline', vars: 'names', map: 'icicle' } }
    expect(parseWorkspace(JSON.stringify({ ...base, display: good }))?.display).toEqual(good)
    for (const bad of [
      { 'lambda-0': { layout: 'boxes', vars: 'names', map: 'icicle' } },
      { 'lambda-0': { layout: 'code', vars: 'names' } },
      { 'nowhere-9': { layout: 'code', vars: 'names', map: 'icicle' } },
      { 'lambda-0': { layout: 'code', vars: 'indices', map: 'icicle' } },
      { 'lambda-0': null },
      [],
    ]) {
      expect(parseWorkspace(JSON.stringify({ ...base, display: bad })), JSON.stringify(bad)).toBeNull()
    }
  })

  // **THE SAME FOR A TM VIEW'S DISPLAY**, which Plan 7 part 4b added after 4a's.
  it('defaults a missing TM display to none stored, and refuses a malformed one', () => {
    const base = { version: 2, tree: SPLIT, switches: PRESETS.explorer, speed: 8, focused: 'lambda-0', panels: {} }
    expect(parseWorkspace(JSON.stringify(base))?.tmDisplay).toEqual({})
    const good = { 'tm-0': { level: 'local', edges: 'chips' } }
    expect(parseWorkspace(JSON.stringify({ ...base, tmDisplay: good }))?.tmDisplay).toEqual(good)
    for (const bad of [
      { 'tm-0': { level: 'program', edges: 'boxes' } },
      { 'tm-0': { level: 'states', edges: 'arcs' } },
      { 'tm-0': { edges: 'arcs' } },
      { 'nowhere-9': { level: 'program', edges: 'arcs' } },
      [],
    ]) {
      expect(parseWorkspace(JSON.stringify({ ...base, tmDisplay: bad })), JSON.stringify(bad)).toBeNull()
    }
  })

  // **AND FOR A VIEW'S SHARES** (the view layouts spec §11.4): absent in every workspace stored before a boundary
  // could be dragged, and held to `parsePanels`' rules where present. A share is a finite number above 0.
  it('defaults missing panel sizes to none stored, and refuses a malformed one', () => {
    const base = { version: 2, tree: SPLIT, switches: PRESETS.explorer, speed: 8, focused: 'lambda-0', panels: {} }
    expect(parseWorkspace(JSON.stringify(base))?.panelSizes).toEqual({})
    const good = { 'lambda-0': { term: 1.25, map: 0.75 }, 'pane-1': {} }
    expect(parseWorkspace(JSON.stringify({ ...base, panelSizes: good }))?.panelSizes).toEqual(good)
    for (const bad of [
      { 'lambda-0': { term: 0 } },
      { 'lambda-0': { term: -1 } },
      { 'lambda-0': { term: '1' } },
      { 'lambda-0': { term: null } },
      { 'lambda-0': { term: true } },
      { 'nowhere-9': { term: 1 } },
      { 'lambda-0': null },
      { 'lambda-0': [1, 2] },
      [],
      null,
      1,
    ]) {
      expect(parseWorkspace(JSON.stringify({ ...base, panelSizes: bad })), JSON.stringify(bad)).toBeNull()
    }
    // NOT FINITE: JSON has no way to write one but a number too large to hold, which reads as `Infinity`.
    const raw = JSON.stringify({ ...base, panelSizes: { 'lambda-0': { term: 1 } } }).replace('"term":1', '"term":1e999')
    expect(JSON.parse(raw).panelSizes['lambda-0'].term, 'precondition: the share reads as Infinity').toBe(
      Number.POSITIVE_INFINITY,
    )
    expect(parseWorkspace(raw), 'a share that is not finite').toBeNull()
  })

  it('opens the inspector for a migrated version 1 layout', () => {
    expect(parseWorkspace(serializeLayout(SPLIT))?.inspector).toBe(true)
  })
})

describe('serializeWorkspace', () => {
  it('drops the panel state and the display of a leaf that has left the tree, and a focus on one', () => {
    const outline = { layout: 'outline' as const, vars: 'names' as const, map: 'icicle' as const }
    const ws = {
      ...fourViewWorkspace(),
      focused: 'pane-9',
      panels: { 'pane-9': { rules: false }, 'tm-0': { rules: false } },
      display: { 'pane-9': outline, 'lambda-0': outline },
      tmDisplay: {
        'pane-9': { level: 'program' as const, edges: 'chips' as const },
        'tm-0': { level: 'program' as const, edges: 'chips' as const },
      },
    }
    const back = JSON.parse(serializeWorkspace(ws))
    expect(back.panelSizes, 'no field while no view holds a share').toBeUndefined()
    const sized = { ...ws, panelSizes: { 'pane-9': { rules: 3 }, 'tm-0': { rules: 2.5, diagram: 0.5 } } }
    expect(JSON.parse(serializeWorkspace(sized)).panelSizes).toEqual({ 'tm-0': { rules: 2.5, diagram: 0.5 } })
    expect(
      JSON.parse(serializeWorkspace({ ...ws, panelSizes: { 'pane-9': { rules: 3 } } })).panelSizes,
      'no field where the one view that held a share has left the tree',
    ).toBeUndefined()
    expect(back.panels).toEqual({ 'tm-0': { rules: false } })
    expect(back.display).toEqual({ 'lambda-0': outline })
    expect(back.tmDisplay).toEqual({ 'tm-0': { level: 'program', edges: 'chips' } })
    expect(back.focused).toBe('lambda-0')
    expect(back.inspector).toBe(true)
    expect(JSON.parse(serializeWorkspace({ ...ws, inspector: false })).inspector).toBe(false)
  })
})

describe('withDisplay', () => {
  it('records one view’s display without touching the others', () => {
    const a = { layout: 'code' as const, vars: 'names' as const, map: 'icicle' as const }
    const b = { layout: 'outline' as const, vars: 'debruijn' as const, map: 'minimap' as const }
    expect(withDisplay({ 'lambda-0': a }, 'pane-1', b)).toEqual({ 'lambda-0': a, 'pane-1': b })
  })
})

describe('withTmDisplay', () => {
  it('records one view’s display without touching the others', () => {
    const program = { level: 'program' as const, edges: 'arcs' as const }
    const local = { level: 'local' as const, edges: 'chips' as const }
    expect(withTmDisplay({ 'tm-0': program }, 'pane-1', local)).toEqual({ 'tm-0': program, 'pane-1': local })
  })
})

describe('withPanel', () => {
  it('records one panel of one view without touching the others', () => {
    const next = withPanel({ 'tm-0': { rules: false } }, 'pane-1', 'rules', true)
    expect(next).toEqual({ 'tm-0': { rules: false }, 'pane-1': { rules: true } })
  })
})

describe('withPanelSizes', () => {
  it('records one view’s shares without touching the others, and leaves out a view that holds none', () => {
    const next = withPanelSizes({ 'tm-0': { rules: 2.5 } }, 'pane-1', { term: 1.5, map: 0.5 })
    expect(next).toEqual({ 'tm-0': { rules: 2.5 }, 'pane-1': { term: 1.5, map: 0.5 } })
    expect(withPanelSizes(next, 'pane-1', { term: 2 })).toEqual({ 'tm-0': { rules: 2.5 }, 'pane-1': { term: 2 } })
    expect(withPanelSizes(next, 'tm-0', {})).toEqual({ 'pane-1': { term: 1.5, map: 0.5 } })
    expect(withPanelSizes({}, 'tm-0', {})).toEqual({})
  })
})

describe('defaultWorkspace', () => {
  it('is the source beside the TM view, Explorer, speed 8, focused on the TM view, nothing remembered', () => {
    const ws = defaultWorkspace('wide')
    expect(ws.tree).toEqual(defaultLayout('wide'))
    expect(leaves(ws.tree).map((l) => l.id)).toEqual(['source', 'tm-0'])
    expect(ws.switches).toEqual(PRESETS.explorer)
    expect(ws.speed).toBe(8)
    expect(ws.focused).toBe('tm-0')
    expect(ws.inspector).toBe(true)
    expect(ws.arrangements).toEqual({})
  })

  it('puts the two views one above the other for a tall area', () => {
    expect(defaultWorkspace('tall').tree).toEqual(defaultLayout('tall'))
  })
})

describe('the remembered arrangements', () => {
  const PAIR = defaultLayout('wide')
  const base = (): Record<string, unknown> => ({
    version: 2,
    tree: FOUR,
    switches: PRESETS.explorer,
    speed: 8,
    focused: 'lambda-0',
    panels: {},
  })
  const parsed = (arrangements: unknown) => parseWorkspace(JSON.stringify({ ...base(), arrangements }))

  it('reads a workspace stored before them as remembering nothing', () => {
    expect(parseWorkspace(JSON.stringify(base()))?.arrangements).toEqual({})
    expect(parseWorkspace(serializeLayout(SPLIT))?.arrangements).toEqual({})
  })

  it('writes no field while nothing is remembered, and the trees by key once something is', () => {
    const empty = fourViewWorkspace()
    expect('arrangements' in JSON.parse(serializeWorkspace(empty))).toBe(false)
    const held = { ...empty, arrangements: { 'source+tm': PAIR } }
    expect(JSON.parse(serializeWorkspace(held)).arrangements).toEqual({ 'source+tm': PAIR })
    expect(parseWorkspace(serializeWorkspace(held))).toEqual(held)
  })

  it('takes a tree under its own combination’s key', () => {
    expect(parsed({ 'source+tm': PAIR })?.arrangements).toEqual({ 'source+tm': PAIR })
    expect(parsed({})?.arrangements).toEqual({})
  })

  const one = (id: string): LayoutNode => ({ kind: 'leaf', id, pane: 'lambda' })
  it.each([
    ['a list', [PAIR]],
    ['a string', 'source+tm'],
    ['null', null],
    ['a key that is no combination', { 'source+lisp': PAIR }],
    ['a key out of KIND_ORDER', { 'tm+source': PAIR }],
    ['a tree under another combination’s key', { 'source+lambda': PAIR }],
    ['an entry under the key of the tree on screen', { [treeKey(FOUR)]: FOUR }],
    ['a tree parseTree refuses', { 'source+tm': { kind: 'split', dir: 'row', children: [PAIR], sizes: [1] } }],
    ['a value that is no tree', { 'source+tm': 'row' }],
  ])('refuses %s', (_what, arrangements) => {
    expect(parsed(arrangements)).toBeNull()
  })

  it('bounds the views of every tree together at 64, where each tree alone may hold 64', () => {
    const numbered = (count: number): string[] => Array.from({ length: count }, (_, i) => `pane-${i + 1}`)
    const row = (ids: string[]): LayoutNode => ({
      kind: 'split',
      dir: 'row',
      sizes: ids.map(() => 1 / ids.length),
      children: ids.map(one),
    })
    // 4 on screen and 60 remembered is 64; 61 remembered is 65, in a tree `parseTree` takes alone.
    expect(parsed({ lambda: row(numbered(60)) })).not.toBeNull()
    expect(parsed({ lambda: row(numbered(61)) })).toBeNull()
    // AN ID TWO TREES HOLD IS ONE VIEW: 61 remembered leaves, one of them the λ view on screen, is 64 views.
    expect(parsed({ lambda: row(['lambda-0', ...numbered(60)]) })).not.toBeNull()
  })

  it('keeps the panel state and the display of a view only a remembered tree holds, and refuses one no tree holds', () => {
    const stored = {
      ...base(),
      tree: PAIR,
      focused: 'tm-0',
      arrangements: { [treeKey(FOUR)]: FOUR },
      panels: { 'lambda-0': { map: false } },
      panelSizes: { 'lambda-0': { term: 1.5, map: 0.5 } },
      display: { 'lambda-0': { layout: 'outline', vars: 'names', map: 'icicle' } },
      tmDisplay: { 'tm-0': { level: 'local', edges: 'chips' } },
    }
    const ws = parseWorkspace(JSON.stringify(stored))
    expect(ws?.panels).toEqual(stored.panels)
    expect(ws?.panelSizes).toEqual(stored.panelSizes)
    expect(ws?.display).toEqual(stored.display)
    if (ws === null || ws === undefined) throw new Error('unreachable')
    expect(JSON.parse(serializeWorkspace(ws)).panels).toEqual(stored.panels)
    expect(JSON.parse(serializeWorkspace(ws)).panelSizes).toEqual(stored.panelSizes)
    expect(JSON.parse(serializeWorkspace(ws)).display).toEqual(stored.display)
    expect(parseWorkspace(JSON.stringify({ ...stored, panels: { 'pane-9': { map: false } } }))).toBeNull()
    expect(parseWorkspace(JSON.stringify({ ...stored, panelSizes: { 'pane-9': { map: 1 } } }))).toBeNull()
  })

  /**
   * The case above stores a TM display too, for `tm-0`, which its tree on screen holds. Here the TM view is in the
   * remembered arrangement alone, so this is the one case in which the bound on a TM display's leaf is every live
   * view and not the views on screen, on the way in and on the way out.
   */
  it('keeps the TM display of a view only a remembered tree holds, and refuses one no tree holds', () => {
    const onScreen = defaultArrangement(['source', 'lambda'], 'wide')
    expect(
      leaves(onScreen).map((l) => l.id),
      'precondition: the tree on screen has no TM view',
    ).toEqual(['source', 'lambda-0'])
    const stored = {
      ...base(),
      tree: onScreen,
      arrangements: { [treeKey(FOUR)]: FOUR },
      tmDisplay: { 'tm-0': { level: 'local', edges: 'chips' } },
    }
    const ws = parseWorkspace(JSON.stringify(stored))
    if (ws === null) throw new Error('a TM display for a view a remembered tree holds was refused')
    expect(ws.tmDisplay).toEqual(stored.tmDisplay)
    expect(JSON.parse(serializeWorkspace(ws)).tmDisplay, 'the write dropped it').toEqual(stored.tmDisplay)
    expect(parseWorkspace(serializeWorkspace(ws))).toEqual(ws)
    const unheld = { ...stored, tmDisplay: { 'pane-9': { level: 'local', edges: 'chips' } } }
    expect(parseWorkspace(JSON.stringify(unheld))).toBeNull()
  })

  it('holds the focus to the tree on screen: a view only a remembered tree holds is refused, and not written', () => {
    const stored = { ...base(), tree: PAIR, focused: 'lambda-0', arrangements: { [treeKey(FOUR)]: FOUR } }
    expect(parseWorkspace(JSON.stringify(stored))).toBeNull()
    const ws = { ...defaultWorkspace('wide'), focused: 'lambda-0', arrangements: { [treeKey(FOUR)]: FOUR } }
    expect(JSON.parse(serializeWorkspace(ws)).focused).toBe('tm-0')
  })
})
