import { expect, it } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import { LEG_PANELS } from '../../src/panes'
import { RxmPane } from '../../src/rxm-pane'
import { TmPane } from '../../src/tm-pane'
import { fourViewWorkspace, heightOf, host, inertEvents, region } from './harness'

/**
 * **A WORKSPACE THAT HOLDS STATE FOR PANELS NO VIEW DRAWS LOADS, AND EVERY PANEL A VIEW DRAWS READS ITS OWN.** The
 * parse keeps any panel name under a leaf the tree holds, and a view reads its panels by the names `LEG_PANELS` lists,
 * so a `text` or `outline` entry is carried and read by nothing. Each drawn panel is stored as the opposite of what a
 * bare view draws, except the panels in the one pair of regions whose shares are read (`opens`), which are stored open,
 * and that pair is stored at shares of 2 and 1 (`pair`), so a load that dropped the workspace fails whichever way a
 * default falls, for open state and for size. The rxm view's registers are in the region `machine-row.ts` calls
 * `machine`, which is what holds the share.
 */
const GONE = {
  'lambda-0': { leg: 'lambda', open: [], shares: ['text'], opens: ['map'], pair: ['map', 'term'] },
  'tm-0': {
    leg: 'tm',
    open: ['outline'],
    shares: ['text', 'outline'],
    opens: ['diagram', 'rules'],
    pair: ['diagram', 'rules'],
  },
  'rxm-0': {
    leg: 'rxm',
    open: ['outline'],
    shares: ['text', 'outline'],
    opens: ['listing', 'registers'],
    pair: ['listing', 'machine'],
  },
} as const
const BARE = {
  lambda: (el: HTMLElement) => new LambdaPane(el, inertEvents()),
  tm: (el: HTMLElement) => new TmPane(el, inertEvents()),
  rxm: (el: HTMLElement) => new RxmPane(el, inertEvents()),
}
const drawsOpen = (view: ParentNode, name: string): boolean =>
  view.querySelector<HTMLElement>(`[data-panel="${name}"]`)?.dataset.open === 'true'

/** The workspace O1 stores and O2 links, and the open state each drawn panel must come back with. */
export function oldPanels() {
  const panels: Record<string, Record<string, boolean>> = {}
  const panelSizes: Record<string, Record<string, number>> = {}
  const own = new Map<string, Record<string, boolean>>()
  for (const [leaf, gone] of Object.entries(GONE)) {
    const bare = document.createElement('div')
    BARE[gone.leg](bare)
    const flipped: Record<string, boolean> = Object.fromEntries(
      LEG_PANELS[gone.leg].map((name) => [name, !drawsOpen(bare, name)]),
    )
    const drawn = { ...flipped, ...Object.fromEntries(gone.opens.map((n) => [n, true])) }
    own.set(leaf, drawn)
    panels[leaf] = { ...Object.fromEntries(gone.open.map((name) => [name, true])), ...drawn }
    const gonePanels = Object.fromEntries(gone.shares.map((name) => [name, 3]))
    panelSizes[leaf] = { ...gonePanels, [gone.pair[0]]: 2, [gone.pair[1]]: 1 }
  }
  return { workspace: { ...fourViewWorkspace(), panels, panelSizes }, own }
}

/** The region `name` of the view `leaf`. */
const regionOf = (leaf: string, name: string): HTMLElement => region(host(leaf) as HTMLElement, name)

/** O1's and O2's cases, under the `describe` each file names. */
export function holdsOldPanels(own: Map<string, Record<string, boolean>>): void {
  it('opens every panel the views draw as the workspace stored it', () => {
    for (const [leaf, state] of own) {
      const view = host(leaf)
      expect(view, `${leaf}'s view`).not.toBeNull()
      for (const [name, open] of Object.entries(state))
        expect(drawsOpen(view as HTMLElement, name), `${leaf}'s ${name}`).toBe(open)
    }
  })

  it('sizes the panels that stay as stored, and draws no text or outline panel in the λ, TM or rxm view', () => {
    for (const [leaf, gone] of Object.entries(GONE)) {
      const [big, small] = gone.pair.map((name) => heightOf(regionOf(leaf, name))) as [number, number]
      expect(big / small, `${leaf}'s ${gone.pair.join(' over ')}`).toBeCloseTo(2, 1)
      const left = (host(leaf) as HTMLElement).querySelectorAll<HTMLElement>(
        '[data-panel="text"], [data-panel="outline"]',
      )
      for (const el of left) {
        const box = el.getBoundingClientRect()
        expect(box.width * box.height, `${leaf}'s ${el.dataset.panel}`).toBe(0)
      }
    }
  })
}
