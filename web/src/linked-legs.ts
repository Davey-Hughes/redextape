import type { ClifPane } from './clif-pane'
import type { Link, LinkIndex, Pin } from './link'
import type { LinkWiring } from './link-wiring'
import type { PaneEntry } from './panes'
import type { Leg, LegFrame } from './protocol'
import type { RxmPane } from './rxm-pane'
import type { TmPane } from './tm-pane'

/**
 * A leg a link reaches through rows of its view. **λ IS NOT ONE**: a `Link` has no λ column, because the λ view finds
 * a construct's nodes in the tree it draws, at whatever step is on screen.
 */
export type LinkedLeg = Exclude<Leg, 'lambda'>

/** What a link asks of a linked leg's view. `LINKED` returns each view class as this, so `tsc` checks the class. */
export type LinkedPane = {
  setLink(rows: number[], scrollTo: boolean): void
  setFocus(rows: number[]): void
  /**
   * Whether the frame the next `render` draws is the run's result, which the view marks: `result-mark.ts`'s decision,
   * made by `draw.ts` before that `render`. `littleEndian` says the run's fields read least significant digit first
   * (`result-mark.ts`'s `BINARY`), which the TM view says beside its mark; the rxm and clif views take `on` alone.
   */
  setResult(on: boolean, littleEndian: boolean): void
}

/**
 * Each linked leg's part in a link: its rows of the `Link`, its view, what a click on one of its rows does, the
 * construct its running frame belongs to, and its words on the status line. `rows` is given the pin too, `null` for a
 * running focus, which has none. `click.event` names the `PaneEvents` member its view calls with a row; `link` is that
 * row's gesture, a row that names no instruction being `null`. `emits` names what a construct can emit none of, `null`
 * for a leg never named, and `here` says the leg's running focus is on the pinned construct.
 *
 * **THE ENTRIES' ORDER IS THE STATUS LINE'S CLAUSE ORDER** (`link-status.ts`'s `linkStatus`), so swapping two changes
 * what a user reads.
 *
 * `pane` CASTS BECAUSE `PaneEntry<Leg>` TYPES A VIEW ONLY BY ITS FRAMES. The caller passes an entry of this leg.
 */
export const LINKED: {
  readonly [K in LinkedLeg]: {
    rows(l: Link, pin: Pin | null): number[]
    pane(p: PaneEntry<Leg>): LinkedPane
    click: { readonly event: 'linkInstr' | 'linkState'; link(w: LinkWiring, row: number | null): void }
    /** The construct the leg's running frame belongs to, `null` for a frame no construct owns. */
    focusNode(frame: LegFrame[K], index: LinkIndex): number | null
    emits: string | null
    here: string
  }
} = {
  rxm: {
    // A PIN FROM A CLIF ROW NAMES ONE INSTRUCTION, the one that row was lowered from (CLIF view design §4, *Links*), so
    // the rxm view marks that one and not every instruction of its construct; any other pin names the construct.
    rows: (l, pin) => (pin?.origin === 'clif' && pin.pc !== undefined ? [pin.pc] : l.instrs),
    pane: (p) => p.pane as unknown as RxmPane,
    click: { event: 'linkInstr', link: (w, pc) => w.linkInstr(pc, 'rxm') },
    focusNode: (f) => f.source_node,
    emits: 'instructions',
    /**
     * The clause said while the rxm leg's running focus — the construct its CURRENT instruction belongs to,
     * `RxmState.source_node` — names this same pinned construct right now: TM's `here` one leg over (spec §6.6). The
     * rxm view marks its focus rows beside its linked ones, so unlike the TM table's this is not the leg's only signal,
     * but it is the only one a user watching another view hears of.
     */
    here: 'the rxm run is here right now',
  },
  tm: {
    rows: (l) => l.states,
    pane: (p) => p.pane as unknown as TmPane,
    click: {
      event: 'linkState',
      link: (w, id) => {
        if (!w.linkable || w.index === null) return
        w.setLinkTo(id === null ? null : w.index.nodeForState(id), 'tm')
      },
    },
    focusNode: (f) => f.source_node,
    emits: 'machine states',
    /**
     * The clause said while the TM leg's running focus — the construct its CURRENT δ-step belongs to,
     * `TmState.source_node` — names this SAME pinned construct right now (`link.ts`'s
     * `isCoincident`). "The moment the app exists to show" (`2026-08-10-plan5c-dual-focus-design.md`
     * §4.3), and worth a word here because THE δ-TABLE HAS NO SIGNAL OF ITS OWN FOR IT.
     * `.state-row.is-focus` landing on an already-`.is-linked` row does not combine into a third class
     * the way the source pane's `.is-focus-coincident` does: both rules set `background` at equal
     * specificity and `.is-focus` is declared second in `style.css`, so the focus wash replaces the
     * pin's. `TmPane.setFocus` never scrolls either, so the row can be off-screen entirely. THIS LINE IS
     * THEREFORE THE TM LEG'S ONE SIGNAL THAT NAMES THE COINCIDENCE — which is more weight than a status
     * line usually carries, and the reason to think twice before dropping it.
     *
     * `#link-status` IS A PLAIN `<div>` THAT ANNOUNCES NOTHING TO A SCREEN READER. This is its
     * SECOND live-updating job (its first is the pin's own answer, in `link-status.ts`'s `linkStatus`) — both are
     * deferred to this project's accessibility pass rather than fixed here; see the roadmap's deferred-a11y list.
     */
    here: 'the machine is here right now',
  },
  clif: {
    /**
     * RXM PCS, WHICH THE CLIF VIEW MAPS TO THE ROWS WHOSE SRCLOC EACH IS. A pin from an rxm or CLIF row names one
     * instruction, so the view marks that instruction's rows and not the rows of its construct's other instructions; a
     * construct pinned elsewhere, and a running focus, mark the rows of all of them.
     */
    rows: (l, pin) => (pin?.pc !== undefined && (pin.origin === 'rxm' || pin.origin === 'clif') ? [pin.pc] : l.instrs),
    pane: (p) => p.pane as unknown as ClifPane,
    click: { event: 'linkInstr', link: (w, pc) => w.linkInstr(pc, 'clif') },
    /**
     * THE OWNER OF THE RXM INSTRUCTION THE FRAME'S INSTRUCTION WAS LOWERED FROM: a CLIF frame carries its srcloc, not
     * a construct, so it is resolved through the same index a click on its row is.
     */
    focusNode: (f, index) => (f.pc === null ? null : index.nodeForInstr(f.pc)),
    /**
     * NEVER NAMED: an optimiser's merge leaves some rxm instructions no CLIF row, which is expected and needs no
     * message (CLIF view design §4, *Links*), and a construct with no instruction is already said to emit none.
     */
    emits: null,
    /** The rxm leg's `here`, one lowering further on: the clause a user watching another view hears of the CLIF run. */
    here: 'the clif run is here right now',
  },
}

/** The linked legs in `LINKED`'s order, read off its keys so that the list cannot lack a leg the table has. */
export const LINKED_LEGS: readonly LinkedLeg[] = Object.keys(LINKED) as LinkedLeg[]

/** A table with one entry per linked leg, each entry `value(leg)`: `legs.ts`'s `perLeg`, over `LINKED_LEGS`. */
export function perLinkedLeg<T>(value: (leg: LinkedLeg) => T): Record<LinkedLeg, T> {
  return Object.fromEntries(LINKED_LEGS.map((leg) => [leg, value(leg)])) as Record<LinkedLeg, T>
}

export function isLinkedLeg(leg: Leg): leg is LinkedLeg {
  return leg in LINKED
}
