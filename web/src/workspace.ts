import { type Arrangements, liveLeaves, parseKey, treeKey } from './arrangements'
import { defaultLayout, type LayoutNode, leaves, MAX_TREE_LEAVES, parseTree, type Shape, SOURCE_LEAF } from './layout'
import type { LeafId } from './panes'

/**
 * THE WORKSPACE — everything persisted about how the page is arranged: the layout tree, the three
 * switches, the playback speed, which view has focus, and each view's panel state (Plan 7 part 2 spec §3).
 *
 * **ONE ENVELOPE UNDER THE KEY `redextape.layout`, AT VERSION 2.** `parseWorkspace` also reads version 1,
 * `{ version: 1, tree }` — the tree shape is the same, so a stored layout is migrated rather than reset. Any
 * other version is `null`, and the caller uses `defaultWorkspace()`.
 *
 * **`arrangements` IS A FIELD THAT MAY BE ABSENT** (the view layouts spec §4.2): the tree each
 * combination of views was last seen in, except the one on screen, which is `tree`. The version is 2 either way.
 *
 * **THE PRESET IS NOT STORED.** `presetOf` derives it from the switches, because a stored preset would be
 * a second copy of three values that could disagree with them.
 */

/** Where the step controls live: in each view's header, or once in a bar along the bottom. */
export type StepsSwitch = 'view' | 'bar'
/** How the views are drawn: tiled, or as one tabbed stage. */
export type ViewsSwitch = 'tiles' | 'stage'
/** How value and steps are shown: a one-line strip, or an inspector panel. */
export type ReadoutSwitch = 'strip' | 'inspector'

/** The three independent switches (spec §2 decision 2 of the umbrella). */
export type Switches = { readonly steps: StepsSwitch; readonly views: ViewsSwitch; readonly readout: ReadoutSwitch }

/**
 * The playback speed ladder, in steps a second (spec §8). Up to 60 the player takes at most one step per
 * animation frame; above it, several — `player.ts`'s `advance` is the arithmetic.
 */
export const SPEEDS = [1, 2, 4, 8, 15, 30, 60, 250, 1000, 5000] as const
export type Speed = (typeof SPEEDS)[number]
/** 8 steps a second. */
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

/** How a λ view draws its term (Plan 7 part 4, spec §5.1 and §6): its layout, its variables, its term map. */
export type LambdaDisplay = {
  readonly layout: 'code' | 'outline'
  readonly vars: 'names' | 'debruijn'
  readonly map: 'icicle' | 'minimap'
}

export const DEFAULT_DISPLAY: LambdaDisplay = { layout: 'code', vars: 'names', map: 'icicle' }

/** Each λ view's display settings, by leaf — a view with none stored draws with `DEFAULT_DISPLAY`. */
export type Displays = Readonly<Record<LeafId, LambdaDisplay>>

/** How a TM view draws its state diagram (Plan 7 part 4, spec §8 and amendment 11): its level, and the edges. */
export type TmDisplay = {
  readonly level: 'program' | 'local'
  readonly edges: 'arcs' | 'chips'
}

export const DEFAULT_TM_DISPLAY: TmDisplay = { level: 'program', edges: 'arcs' }

/** Each TM view's display settings, by leaf — a view with none stored draws with `DEFAULT_TM_DISPLAY`. */
export type TmDisplays = Readonly<Record<LeafId, TmDisplay>>

/**
 * Per view, per region name, the share of the view's height the region takes (the view layouts spec §11.4). A region
 * with no entry has the share it is built with.
 */
export type PanelSizes = Readonly<Record<LeafId, Readonly<Record<string, number>>>>

export type Workspace = {
  readonly tree: LayoutNode
  readonly switches: Switches
  readonly speed: Speed
  /** The view the user is in — any leaf, the source view included. It drives the readout (spec §9). */
  readonly focused: LeafId
  readonly panels: Panels
  /** Beside `panels`, and kept and dropped with it: a parked view keeps its sizes, a closed view's are dropped. */
  readonly panelSizes: PanelSizes
  /**
   * Whether the inspector is open — spec §9, and the one field that is NOT a view's panel.
   *
   * **NOT IN `panels`.** `panels` is keyed by `LeafId` and `parseWorkspace` refuses an entry naming a leaf
   * the tree does not hold; there is one inspector, it belongs to the workspace rather than to a view, and
   * keying it on the FOCUSED view would collapse and re-open it as the focus moved between views.
   */
  readonly inspector: boolean
  /** Each λ view's display settings — absent in a workspace stored before the field existed. */
  readonly display: Displays
  /**
   * Each TM view's display settings — absent in a workspace stored before the field existed. A field of its
   * own rather than a second shape in `display`, so neither leg's parser has to tell the other's entries apart.
   */
  readonly tmDisplay: TmDisplays
  /**
   * The arrangement each combination of views remembers, by `arrangements.ts`'s key — every combination visited but
   * the one `tree` shows (the view layouts spec §4.2). Absent in a workspace stored before it, and not written
   * while it is empty, so a workspace that has remembered nothing is stored without it, as one stored before the
   * field existed is.
   */
  readonly arrangements: Arrangements
}

export const WORKSPACE_VERSION = 2

/**
 * The view a workspace focuses when nothing says otherwise: the first leaf in `leaves()` order that is not the
 * source, or the source leaf when the tree holds nothing else. On a fresh page that is the TM view.
 */
export function defaultFocus(tree: LayoutNode): LeafId {
  const all = leaves(tree)
  return (all.find((l) => l.pane !== 'source') ?? all[0])?.id ?? SOURCE_LEAF
}

/**
 * The workspace a fresh page opens on. `shape` is the views area's, which decides whether the first load's two views
 * sit side by side or one above the other (`layout.ts`'s `defaultArrangement`); a caller with no area to measure
 * says `wide`, which is what an area of no size reads as (`arrangements.ts`'s `shapeOf`).
 */
export function defaultWorkspace(shape: Shape): Workspace {
  const tree = defaultLayout(shape)
  return {
    tree,
    switches: PRESETS.explorer,
    speed: DEFAULT_SPEED,
    focused: defaultFocus(tree),
    panels: {},
    panelSizes: {},
    inspector: true,
    display: {},
    tmDisplay: {},
    arrangements: {},
  }
}

/** `display` with one λ view's settings recorded — a new object, as `withPanel` returns. */
export function withDisplay(display: Displays, leaf: LeafId, d: LambdaDisplay): Displays {
  return { ...display, [leaf]: d }
}

/** `tmDisplay` with one TM view's settings recorded — `withDisplay`'s twin. */
export function withTmDisplay(tmDisplay: TmDisplays, leaf: LeafId, d: TmDisplay): TmDisplays {
  return { ...tmDisplay, [leaf]: d }
}

/** `panelSizes` with one view's shares recorded, or with the view left out where it holds none. */
export function withPanelSizes(sizes: PanelSizes, leaf: LeafId, own: Readonly<Record<string, number>>): PanelSizes {
  const { [leaf]: _, ...rest } = sizes
  return Object.keys(own).length === 0 ? rest : { ...rest, [leaf]: own }
}

/** `panels` with one panel of one view recorded — a new object, as every operation in `layout.ts` returns. */
export function withPanel(panels: Panels, leaf: LeafId, name: string, open: boolean): Panels {
  return { ...panels, [leaf]: { ...panels[leaf], [name]: open } }
}

/**
 * The stored form.
 *
 * **A VIEW NO ARRANGEMENT HOLDS LEAVES NO TRACE.** Its panel state and its display are left out of what is written:
 * `parseWorkspace` refuses both, so writing them would make the next load fall back to the default workspace
 * entirely. A view a remembered arrangement holds is live (`arrangements.ts`'s `liveLeaves`) and keeps both, so it
 * comes back as it was left.
 *
 * **A CLOSE DROPS THEM TOO, BEFORE THIS IS ASKED** (`main.ts`'s `enterTree`), and has to: the tree a `✕` left is
 * remembered, so the closed view's id is still live by the test here, and its state would be kept for the view
 * built under that id next.
 *
 * **THE FOCUS IS HELD TO THE TREE ON SCREEN ALONE**: a focus on a view off the page falls back to `defaultFocus`.
 *
 * **`arrangements` IS WRITTEN ONLY WHILE IT HOLDS ONE**, last, so a workspace that remembers nothing is stored without
 * it, as one stored before the field existed is. A share link is written from a workspace whose `arrangements` the
 * caller has emptied (spec §4.7), and so carries none.
 */
export function serializeWorkspace(ws: Workspace): string {
  const live = liveLeaves(ws.tree, ws.arrangements)
  const onScreen = new Set(leaves(ws.tree).map((l) => l.id))
  const panels: Record<LeafId, Record<string, boolean>> = {}
  for (const [leaf, open] of Object.entries(ws.panels)) if (live.has(leaf)) panels[leaf] = { ...open }
  const panelSizes: Record<LeafId, Record<string, number>> = {}
  for (const [leaf, sizes] of Object.entries(ws.panelSizes)) if (live.has(leaf)) panelSizes[leaf] = { ...sizes }
  const display: Record<LeafId, LambdaDisplay> = {}
  for (const [leaf, d] of Object.entries(ws.display)) if (live.has(leaf)) display[leaf] = d
  const tmDisplay: Record<LeafId, TmDisplay> = {}
  for (const [leaf, d] of Object.entries(ws.tmDisplay)) if (live.has(leaf)) tmDisplay[leaf] = d
  return JSON.stringify({
    version: WORKSPACE_VERSION,
    tree: ws.tree,
    switches: ws.switches,
    speed: ws.speed,
    focused: onScreen.has(ws.focused) ? ws.focused : defaultFocus(ws.tree),
    panels,
    inspector: ws.inspector,
    display,
    tmDisplay,
    ...(Object.keys(panelSizes).length === 0 ? {} : { panelSizes }),
    ...(Object.keys(ws.arrangements).length === 0 ? {} : { arrangements: ws.arrangements }),
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

/**
 * A stored `display`, or `null` for a malformed one. **ABSENT IS NOT MALFORMED**: a workspace stored
 * before the field existed has none, and refusing it would reset the upgrading user's layout;
 * `parseWorkspace` maps absence to `{}`.
 */
function parseDisplay(v: unknown, ids: ReadonlySet<string>): Displays | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const out: Record<LeafId, LambdaDisplay> = {}
  for (const [leaf, d] of Object.entries(v as Record<string, unknown>)) {
    if (!ids.has(leaf) || typeof d !== 'object' || d === null) return null
    const { layout, vars, map } = d as Record<string, unknown>
    if (layout !== 'code' && layout !== 'outline') return null
    if (vars !== 'names' && vars !== 'debruijn') return null
    if (map !== 'icicle' && map !== 'minimap') return null
    out[leaf] = { layout, vars, map }
  }
  return out
}

/** A stored `tmDisplay`, or `null` for a malformed one — absent is not malformed, for `parseDisplay`'s reason. */
function parseTmDisplay(v: unknown, ids: ReadonlySet<string>): TmDisplays | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const out: Record<LeafId, TmDisplay> = {}
  for (const [leaf, d] of Object.entries(v as Record<string, unknown>)) {
    if (!ids.has(leaf) || typeof d !== 'object' || d === null) return null
    const { level, edges } = d as Record<string, unknown>
    if (level !== 'program' && level !== 'local') return null
    if (edges !== 'arcs' && edges !== 'chips') return null
    out[leaf] = { level, edges }
  }
  return out
}

/**
 * A stored `arrangements`, or `null` for a malformed one — the view layouts spec §4.2, each rule something a person
 * could type: a key `arrangements.ts`'s `keyOf` would not write, a tree `parseTree` refuses, a tree filed under
 * another combination's key, an entry under the key of the tree on screen, and more ids between them all than one
 * tree may hold.
 *
 * **THE BOUND IS ON EVERY LIVE VIEW** (§5.6): `MAX_TREE_LEAVES` bounds what a link or a stored layout can make the
 * app build, and a view a remembered arrangement holds is built when it is entered.
 */
function parseArrangements(v: unknown, tree: LayoutNode): Arrangements | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const onScreen = treeKey(tree)
  const out: Record<string, LayoutNode> = {}
  for (const [key, stored] of Object.entries(v as Record<string, unknown>)) {
    if (parseKey(key) === null || key === onScreen) return null
    const remembered = parseTree(stored)
    if (remembered === null || treeKey(remembered) !== key) return null
    out[key] = remembered
  }
  return liveLeaves(tree, out).size > MAX_TREE_LEAVES ? null : out
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

/** `parsePanels`' rules, for shares: an entry names a live view, and a share is a finite number above 0. */
function parsePanelSizes(v: unknown, ids: ReadonlySet<string>): PanelSizes | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const out: Record<LeafId, Record<string, number>> = {}
  for (const [leaf, sizes] of Object.entries(v as Record<string, unknown>)) {
    if (!ids.has(leaf)) return null
    if (typeof sizes !== 'object' || sizes === null || Array.isArray(sizes)) return null
    const own: Record<string, number> = {}
    for (const [name, share] of Object.entries(sizes as Record<string, unknown>)) {
      if (typeof share !== 'number' || !Number.isFinite(share) || share <= 0) return null
      own[name] = share
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
      panelSizes: {},
      inspector: true,
      display: {},
      tmDisplay: {},
      arrangements: {},
    }
  }
  if (e.version !== WORKSPACE_VERSION) return null

  const tree = parseTree(e.tree)
  if (tree === null) return null
  const switches = parseSwitches(e.switches)
  if (switches === null) return null
  if (!isSpeed(e.speed)) return null
  // **A MISSING `arrangements` IS NOT AN INVALID ONE**, for `inspector`'s reason below: every workspace stored before
  // the view layouts has none. It is read before the per-view fields, which may name any live view (spec §4.2).
  const arrangements = e.arrangements === undefined ? {} : parseArrangements(e.arrangements, tree)
  if (arrangements === null) return null
  const onScreen = new Set(leaves(tree).map((l) => l.id))
  if (typeof e.focused !== 'string' || !onScreen.has(e.focused)) return null
  const ids = new Set(liveLeaves(tree, arrangements).keys())
  const panels = parsePanels(e.panels, ids)
  if (panels === null) return null
  // A MISSING `panelSizes` IS NOT AN INVALID ONE, for `inspector`'s reason below.
  const panelSizes = e.panelSizes === undefined ? {} : parsePanelSizes(e.panelSizes, ids)
  if (panelSizes === null) return null
  // **A MISSING `inspector` IS NOT AN INVALID ONE.** A version 2 workspace stored before the field existed has
  // none — refusing one would reset the layout of exactly the users the version 2 envelope was built to carry
  // across. A field that IS there and is not a boolean is held to the standard above like every other
  // (Plan 7 part 2 spec §3).
  if (e.inspector !== undefined && typeof e.inspector !== 'boolean') return null
  const display = e.display === undefined ? {} : parseDisplay(e.display, ids)
  if (display === null) return null
  const tmDisplay = e.tmDisplay === undefined ? {} : parseTmDisplay(e.tmDisplay, ids)
  if (tmDisplay === null) return null
  return {
    tree,
    switches,
    speed: e.speed,
    focused: e.focused,
    panels,
    panelSizes,
    inspector: e.inspector ?? true,
    display,
    tmDisplay,
    arrangements,
  }
}
