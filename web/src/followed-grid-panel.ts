import { createPanel, type Panel } from './panel'
import { type GridOptions, type GridRows, VirtualGrid } from './virtual-grid'

/**
 * A `VirtualGrid` as a panel's body, with the button in the panel's header that sets it following again: the TM view's
 * rule table and the rxm view's listing.
 *
 * **`idPrefix` IS THE CALLER'S**, minted per view class: `aria-activedescendant` names a cell by that id, across the
 * whole page, so no two grids on a page may share a prefix.
 */
export function followedGridPanel(o: {
  readonly name: string
  readonly label: string
  readonly open: boolean
  readonly reattachText: string
  readonly classes: GridOptions['classes']
  readonly idPrefix: string
  /** Whether the grid has anything to follow: with nothing, re-attaching means nothing. */
  hasContent(): boolean
  rows(): GridRows
  activate(i: number): void
  /** A gesture on the panel's disclosure, after the grid has redrawn for it. */
  onToggle(open: boolean): void
}): { readonly panel: Panel; readonly grid: VirtualGrid } {
  // ADDED AND REMOVED, NEVER DISABLED — same idiom `step-controls.ts` states for the continue button.
  // A reattach only does something while the table is detached, so it exists only then; the grid's
  // `beforeDraw`, below, keeps `hidden` in sync every frame and every scroll, the one place both happen.
  const reattach = document.createElement('button')
  reattach.type = 'button'
  reattach.className = 'table-reattach'
  reattach.textContent = o.reattachText
  reattach.hidden = true
  reattach.addEventListener('click', () => {
    const had = document.activeElement === reattach
    // Follows and redraws now, not at the next step — otherwise the current row stays wherever the manual
    // scroll left it until the machine happens to advance.
    grid.attach()
    // THE BUTTON HIDES ITSELF — the draw sets `reattach.hidden` once the table follows again — AND
    // MUST NOT TAKE THE FOCUS WITH IT (spec §11): the panel's toggle, beside it, takes it.
    if (had && reattach.hidden) panel.toggle.focus()
  })

  const grid = new VirtualGrid({
    classes: o.classes,
    idPrefix: o.idPrefix,
    isOpen: () => panel.isOpen(),
    rows: () => o.rows(),
    activate: (i) => o.activate(i),
    // KEPT IN SYNC HERE, not in the click handlers, because a draw is the one thing that runs on every frame AND
    // every scroll — the two ways following can change. Hidden with no program at all (reattaching means nothing
    // against an empty table) and while the table is closed, where the button would offer to reposition something
    // nobody can see — the same idiom the control itself follows, which exists so a control is present only when
    // it does something.
    beforeDraw: () => {
      reattach.hidden = !o.hasContent() || grid.following || !panel.isOpen()
    },
  })

  // THE GRID IS A PANEL. `panel.ts` hides the grid's box itself and carries the state in
  // `aria-expanded` rather than relabelling — accessibility item 2 — and keeps the box's `grid` role, labelled
  // by the panel's own toggle. The re-attach rides in the panel's header, beside the thing it acts on.
  //
  // REDRAW IN BOTH DIRECTIONS, and the closing one is not symmetry for its own sake. A draw is where
  // `reattach.hidden` is maintained, so skipping it on the way down would leave a live "follow" button
  // over a table that is not on screen — the idiom's own rule broken, and the closed-table term written
  // for it could never fire because the draw, where it is evaluated, would not run. Reopening matters
  // for a different reason: a hidden box has `clientHeight` 0, so a step taken while the table is closed
  // computes its scroll target against a zero-height viewport, and without a redraw on reopening the head
  // would stay parked off centre until some later step happened to recentre it.
  const panel = createPanel({
    name: o.name,
    label: o.label,
    body: grid.el,
    open: o.open,
    onToggle: (open) => {
      grid.draw()
      o.onToggle(open)
    },
    onDrawn: () => grid.draw(),
  })
  panel.actions.append(reattach)
  return { panel, grid }
}
