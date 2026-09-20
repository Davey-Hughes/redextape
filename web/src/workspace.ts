import { defaultLayout, type LayoutNode, leaves, parseTree, SOURCE_LEAF } from './layout'
import type { LeafId } from './panes'

/**
 * THE WORKSPACE — everything persisted about how the page is arranged: the layout tree, the three
 * switches, the playback speed, which view has focus, and each view's panel state (Plan 7 part 2 spec §3).
 *
 * **ONE ENVELOPE UNDER THE KEY THE LAYOUT ALREADY USED.** `redextape.layout` held `{ version: 1, tree }`;
 * it holds `{ version: 2, tree, switches, speed, focused, panels }` now, and `parseWorkspace` still reads
 * version 1 — the tree shape did not change, so a stored layout is migrated rather than reset. Any other
 * version is `null`, and the caller uses `defaultWorkspace()`, as `parseLayout`'s callers always have.
 *
 * **THE PRESET IS NOT STORED.** `presetOf` derives it from the switches, because a stored preset would be
 * a second copy of three values that could disagree with them.
 */

/** Where the step controls live: in each view's header, or once in a bar along the bottom (2b). */
export type StepsSwitch = 'view' | 'bar'
/** How the views are drawn: tiled, or as one tabbed stage (2b). */
export type ViewsSwitch = 'tiles' | 'stage'
/** How value and steps are shown: a one-line strip, or an inspector panel (2b). */
export type ReadoutSwitch = 'strip' | 'inspector'

/** The three independent switches (spec §2 decision 2 of the umbrella). */
export type Switches = { readonly steps: StepsSwitch; readonly views: ViewsSwitch; readonly readout: ReadoutSwitch }

/**
 * The playback speed ladder, in steps a second (spec §8). Up to 60 the player takes at most one step per
 * animation frame; above it, several — `player.ts`'s `advance` is the arithmetic.
 */
export const SPEEDS = [1, 2, 4, 8, 15, 30, 60, 250, 1000, 5000] as const
export type Speed = (typeof SPEEDS)[number]
/** The rate the old per-leg interval player ran at — one step every 120 ms, about 8 a second. A default that changes nothing is the point. */
export const DEFAULT_SPEED: Speed = 8

export function isSpeed(v: unknown): v is Speed {
  return typeof v === 'number' && (SPEEDS as readonly number[]).includes(v)
}

export type Preset = 'explorer' | 'debugger' | 'stage'

/** Each preset is one corner of the switch cube (spec §4). */
export const PRESETS: Readonly<Record<Preset, Switches>> = {
  explorer: { steps: 'view', views: 'tiles', readout: 'strip' },
  debugger: { steps: 'bar', views: 'tiles', readout: 'inspector' },
  stage: { steps: 'bar', views: 'stage', readout: 'inspector' },
}

/** Which preset these switches are, or `null` for *custom*. */
export function presetOf(s: Switches): Preset | null {
  for (const name of Object.keys(PRESETS) as Preset[]) {
    const p = PRESETS[name]
    if (p.steps === s.steps && p.views === s.views && p.readout === s.readout) return name
  }
  return null
}

/** Per view, per panel name, whether the panel is open. Only a view's own panels live here — spec §3. */
export type Panels = Readonly<Record<LeafId, Readonly<Record<string, boolean>>>>

export type Workspace = {
  readonly tree: LayoutNode
  readonly switches: Switches
  readonly speed: Speed
  /** The view the user is in — any leaf, the source view included. It drives the readout (spec §9). */
  readonly focused: LeafId
  readonly panels: Panels
  /**
   * Whether the inspector is open — spec §9, and the one field that is NOT a view's panel.
   *
   * **NOT IN `panels`, THOUGH §9's SENTENCE ONCE READ THAT WAY.** `panels` is keyed by `LeafId` and
   * `parseWorkspace` refuses an entry naming a leaf the tree does not hold; there is one inspector, it
   * belongs to the workspace rather than to a view, and keying it on the FOCUSED view would collapse and
   * re-open it as the focus moved between views. The spec was corrected to say so.
   */
  readonly inspector: boolean
}

export const WORKSPACE_VERSION = 2

/**
 * The view a workspace focuses when nothing says otherwise: the first λ or TM leaf in `leaves()` order, or
 * the source leaf when the tree holds nothing else. On a fresh page that is the λ view.
 */
export function defaultFocus(tree: LayoutNode): LeafId {
  const all = leaves(tree)
  return (all.find((l) => l.pane !== 'source') ?? all[0])?.id ?? SOURCE_LEAF
}

export function defaultWorkspace(): Workspace {
  const tree = defaultLayout()
  return {
    tree,
    switches: PRESETS.explorer,
    speed: DEFAULT_SPEED,
    focused: defaultFocus(tree),
    panels: {},
    inspector: true,
  }
}

/** `panels` with one panel of one view recorded — a new object, as every operation in `layout.ts` returns. */
export function withPanel(panels: Panels, leaf: LeafId, name: string, open: boolean): Panels {
  return { ...panels, [leaf]: { ...panels[leaf], [name]: open } }
}

/**
 * The stored form.
 *
 * **A VIEW THAT HAS LEFT THE TREE LEAVES NO TRACE.** Its panel state is dropped and a focus on it falls back
 * to `defaultFocus`, here rather than at every close, because the close does not need to know this module
 * exists — and `parseWorkspace` refuses both, so writing them would make the next load fall back to the
 * default workspace entirely.
 */
export function serializeWorkspace(ws: Workspace): string {
  const live = new Set(leaves(ws.tree).map((l) => l.id))
  const panels: Record<LeafId, Record<string, boolean>> = {}
  for (const [leaf, open] of Object.entries(ws.panels)) if (live.has(leaf)) panels[leaf] = { ...open }
  return JSON.stringify({
    version: WORKSPACE_VERSION,
    tree: ws.tree,
    switches: ws.switches,
    speed: ws.speed,
    focused: live.has(ws.focused) ? ws.focused : defaultFocus(ws.tree),
    panels,
    inspector: ws.inspector,
  })
}

/**
 * The switch triple, validated.
 *
 * **EXPORTED BECAUSE THE WORKSPACE MENU IS WHERE A VALUE BECOMES ONE** (spec §4). `app-header.ts`'s
 * `SwitchRow` carries its values as `string` — a table of three two-way choices cannot be typed per row
 * without a discriminated union of three row types — so the one narrowing happens at the write, here.
 */
export function parseSwitches(v: unknown): Switches | null {
  if (typeof v !== 'object' || v === null) return null
  const s = v as Record<string, unknown>
  if (s.steps !== 'view' && s.steps !== 'bar') return null
  if (s.views !== 'tiles' && s.views !== 'stage') return null
  if (s.readout !== 'strip' && s.readout !== 'inspector') return null
  return { steps: s.steps, views: s.views, readout: s.readout }
}

function parsePanels(v: unknown, ids: ReadonlySet<string>): Panels | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const out: Record<LeafId, Record<string, boolean>> = {}
  for (const [leaf, states] of Object.entries(v as Record<string, unknown>)) {
    if (!ids.has(leaf)) return null
    if (typeof states !== 'object' || states === null || Array.isArray(states)) return null
    const own: Record<string, boolean> = {}
    for (const [name, open] of Object.entries(states as Record<string, unknown>)) {
      if (typeof open !== 'boolean') return null
      own[name] = open
    }
    out[leaf] = own
  }
  return out
}

/**
 * The stored workspace, or `null` if there is nothing usable there.
 *
 * **EVERY FIELD IS HELD TO `parseLayout`'s STANDARD**: a value a person could plausibly type that would
 * parse and then misbehave — a switch value no renderer knows, a speed off the ladder, a focus or a panel
 * entry naming a view that is not in the tree — makes the whole envelope `null`, and the caller falls back
 * to the default. A layout is a preference, so the failure stays silent (spec §13).
 */
export function parseWorkspace(raw: string | null): Workspace | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const e = parsed as Record<string, unknown>

  if (e.version === 1) {
    const tree = parseTree(e.tree)
    if (tree === null) return null
    return {
      tree,
      switches: PRESETS.explorer,
      speed: DEFAULT_SPEED,
      focused: defaultFocus(tree),
      panels: {},
      inspector: true,
    }
  }
  if (e.version !== WORKSPACE_VERSION) return null

  const tree = parseTree(e.tree)
  if (tree === null) return null
  const switches = parseSwitches(e.switches)
  if (switches === null) return null
  if (!isSpeed(e.speed)) return null
  const ids = new Set(leaves(tree).map((l) => l.id))
  if (typeof e.focused !== 'string' || !ids.has(e.focused)) return null
  const panels = parsePanels(e.panels, ids)
  if (panels === null) return null
  // **A MISSING `inspector` IS NOT AN INVALID ONE.** Version 2 shipped in part 2a without this field, so
  // every workspace stored before part 2b has none — refusing them would reset the layout of exactly the
  // users the version 2 envelope was built to carry across. A field that IS there and is not a boolean is
  // held to the standard above like every other (spec §3).
  if (e.inspector !== undefined && typeof e.inspector !== 'boolean') return null
  return { tree, switches, speed: e.speed, focused: e.focused, panels, inspector: e.inspector ?? true }
}
