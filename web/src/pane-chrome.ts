import type { FieldWidth } from './field-width'
import type { MachineCode } from './machine-code'
import type { Shares } from './panel-stack'
import type { ClifLoad, Leg, Listing } from './protocol'
import type { SessionId } from './session-client'
import type { Binding, PaneOption } from './sessions'
import type { ViewMove } from './view-header'
import type { ClifDisplay, LambdaDisplay, Speed, TmDisplay } from './workspace'

export type PaneEvents = {
  back(): void
  forward(): void
  /** `⏭`: to the newest recorded step, the end of what the worker has recorded — never asking it for more. */
  toNewest(): void
  play(): void
  restart(): void
  extend(): void
  /**
   * The workspace's one playback speed, in steps a second — Plan 7 part 2 spec §8. REQUIRED, like `rebind`:
   * every view that steps shows it, and one global setting has no view that could lack it.
   */
  speed(): Speed
  /** Set the one speed; every step control on the page shows the change on the next draw. */
  setSpeed(s: Speed): void
  /**
   * The pane selector picked a `(leg, session)` pair for this pane's slot.
   *
   * REQUIRED, UNLIKE `linkState` AND `linkLambda` BELOW, and the difference is not stylistic. Those two
   * are absent on a pane that genuinely lacks the affordance — the λ pane has no δ-table to click, the
   * TM pane has no λ term — whereas every pane occupies a slot and every slot has a binding
   * (design §3.2b, decision 1). A pane whose rebind did nothing would be a pane whose selector lies.
   *
   * **IT TAKES THE WHOLE `(leg, session)` PAIR.** The pair is what a pick MEANS: the title's menu
   * (`view-header.ts`) lists several legs, and reports which pair was picked, not the session half of it.
   *
   * **ONE CONTROL FOR BOTH AXES BECAUSE THE AXES ARE NOT INDEPENDENT (design §3.2).** A session holds
   * at most one leg per `Leg`, and `SessionRegistry.legOf` THROWS on a binding naming a leg its session lacks.
   * Two independent controls (a kind picker beside a session picker) would therefore have to answer a pick of a leg
   * the chosen session lacks with an invented fallback: silently rebind to some other session, or make the option
   * vanish and reappear as the other control moves. One list of pairs — `SessionRegistry.pairs()`, which
   * enumerates exactly the pairs that provably resolve — makes the invalid combination unrepresentable instead of
   * merely handled.
   *
   * WHAT A HANDLER MAY DO WITH THE LEG IS NOT THIS TYPE'S BUSINESS, AND THE TWO HANDLERS IN THE APP DO
   * DIFFERENT THINGS WITH IT. `transport.ts`'s takes the session on a same-leg pick and THROWS on any
   * other, which is all a handler with no layout tree can do — it cannot answer the question, so it
   * refuses to pretend; `pane-host.ts`'s wraps it, delegates a same-leg pick there and
   * answers a cross-leg one by changing the LEAF's kind and rebuilding the pane in place — `PaneSlot<K>`'s
   * leg has no writer anywhere in the app, so following a pick across legs is the replacement of a
   * whole `PaneEntry` rather than a field write.
   */
  rebind(binding: Binding<Leg>): void
  /**
   * One of this view's own panels was opened or closed — Plan 7 part 2 spec §3. `pane-host.ts` records it
   * per view in the workspace. OPTIONAL: a test builds a pane with only the handlers it drives, and `pane-host.ts`
   * gives every view this one.
   */
  panel?: (name: string, open: boolean) => void
  /** A boundary between this view's regions was moved, or put back: every share the view now holds (spec §11.4). */
  panelSizes?: (sizes: Shares) => void
  /** A λ view's display settings changed — recorded per view, as `panel` is. */
  display?: (d: LambdaDisplay) => void
  /** A TM view's display settings changed — `display`'s twin. */
  tmDisplay?: (d: TmDisplay) => void
  /** A CLIF view's display settings changed — `display`'s twin. */
  clifDisplay?: (d: ClifDisplay) => void
  /**
   * The program's one field width, which a TM view shows and sets in its header (`field-width.ts`).
   * OPTIONAL for `panel`'s reason: a TM view built without it has no width box.
   */
  fieldWidth?: FieldWidth
  /**
   * Where the page's `pkg-clif` load stands, for a CLIF view to say while it has no listing, and `retry`, which asks
   * for the shown listing again after a load that failed. OPTIONAL for `panel`'s reason.
   */
  clifLoad?: { state(): ClifLoad; retry(): void }
  /**
   * The page's machine code, which a CLIF view's machine code panel shows (`machine-code.ts`'s `MachineCode`): each
   * target's load, the program's answers, and the asks for them. OPTIONAL for `panel`'s reason: a CLIF view built
   * without it shows a panel that says it has no machine code.
   */
  machineCode?: Pick<MachineCode, 'load' | 'intent' | 'code' | 'want' | 'retry'>
  /**
   * Why this view's leg cannot run, as its step bar says it, or `''` while nothing stops it: read through the slot, as
   * the controls' handlers are, so it follows a rebind. OPTIONAL for `panel`'s reason.
   */
  legReason?: () => string
  /**
   * The program's one listing, which every CLIF view shows and switches on its bar, as a TM view does the width: the
   * listing now, and `choose`, which `main.ts` records and re-records the CLIF leg for. OPTIONAL for `panel`'s
   * reason: a CLIF view built without it has no switch.
   */
  clifListing?: { current(): Listing; choose(l: Listing): void }
  /** A state row was clicked. Absent on panes that have no table. */
  linkState?: (stateId: number) => void
  /**
   * An instruction row in the rxm or CLIF view's listing was clicked, or Enter pressed on it; `pc` is the rxm
   * instruction it names, `null` for a row that names none.
   */
  linkInstr?: (pc: number | null) => void
  /** A token in the λ view was clicked; `node` is the construct its node belongs to. */
  linkLambda?: (node: number) => void
  /**
   * This pane's split and close gestures.
   *
   * OPTIONAL, LIKE `linkState` AND UNLIKE `rebind`, and the same test applies: a pane has these handlers
   * when it has the affordance. A pane rendered outside a layout tree — which is every pane in
   * `view-title.test.ts` and in `tests/node/sessions.test.ts` — has no tree to split.
   *
   * `close` CARRIES NOTHING. A pane knows it was asked to close; it does not know its own `LeafId`, its
   * path in the tree, or whether it is the last leaf. `pane-host.ts` holds the tree and answers all
   * three, which keeps the pane classes free of the layout entirely.
   *
   * **THE TWO SPLITS CARRY A `PaneChoice`.** A split asks WHAT to create (`view-header.ts`'s `viewMenu`),
   * and the answer is a `(leg, session)` pair or the source pane, which is a fact about the pick rather
   * than about the tree. A handler learns nothing here about where in the tree it is, because the pane
   * does not know — what crosses is exactly what the pane's own menu produced, which is the same rule
   * `rebind` states for the binding selector.
   *
   * **THE `PaneChoice` IS REQUIRED.** `viewMenu` builds NO split control without `choices`, so a split
   * gesture and a pick are the same event. Left optional, every handler here and downstream would branch
   * forever on an `undefined` nothing can produce.
   */
  splitRow?: (choice: PaneChoice) => void
  splitColumn?: (choice: PaneChoice) => void
  close?: () => void
  /** This pane's move items, which carry no `LeafId` for `close`'s reason. */
  move?: ViewMove
}

/**
 * What a split is asked to create: a `(leg, session)` PAIR, or the source pane when the tree has none.
 *
 * **`{ kind: 'source' }` IS NOT A LEG AND CARRIES NO SESSION, WHICH IS THE WHOLE SHAPE OF THIS
 * TYPE.** The source pane is chrome around the one editor `main.ts` owns — `pane-host.ts`'s
 * `applyLayout` says so directly with `if (l.pane === 'source') continue` — so it has no `PaneSlot`, no
 * `Binding`, and nothing for a `SessionId` here to name. A `{ kind: Leg; session }` shape stretched to
 * cover it would have needed an invented session for a leaf that resolves none, which is the same
 * unrepresentable-invalid-combination standard `PaneEvents.rebind` states for the axes a pick names.
 *
 * IT IS OFFERED ONLY WHILE NO SOURCE LEAF IS IN THE TREE (`viewMenu`'s `sourceAvailable`), because a
 * second source pane would be a second view of one editor rather than a second editor — and that is the
 * design's own reason source is refused a SPLIT (`layout.ts`'s `splitLeaf`). What this makes possible
 * is the way back: a closed source pane returns through any other pane's split menu, with the layout
 * the user built still standing, rather than only through `reset preset`.
 */
export type PaneChoice = { kind: 'source' } | { kind: Leg; session: SessionId }

/**
 * What a split may be asked to create, as the menu reads it: every `(leg, session)` pair on offer,
 * whether the tree is currently without a source leaf, and which pair the pane doing the asking already
 * shows.
 *
 * NAMED, RATHER THAN INLINED AT EVERY SIGNATURE THAT CARRIES IT — `view-header.ts`'s `viewMenu` and
 * `PaneView.setLayoutControls` (`sessions.ts`), which is the per-frame push that fills it in: a shape crossing a
 * module boundary is worth a single spelling.
 *
 * **`current` IS NULLABLE AND THE OTHER TWO ARE NOT, WHICH IS A STATEMENT ABOUT A PANE THAT HAS NEVER
 * BEEN PAINTED.** Each pane class holds its latest `SplitChoices` in a field and hands `viewMenu`
 * a thunk that reads it, so the field needs a value from construction — and the honest one for a pane
 * `draw()` has not reached yet is "nothing on offer, and no pair in force". `options: []` says the first
 * half without inventing anything; a non-null `current` could only have been a `SessionId` the pane was
 * never told, since design §3.2b keeps a pane ignorant of its own binding except through what is pushed
 * to it. Nothing downstream branches on the null — `view-header.ts`'s `viewMenu` `find`s over the empty
 * list at the same moment — and no menu can be opened in that state anyway: the same `update` call that
 * mounts a split button is the one that delivers the real value.
 */
export type SplitChoices = {
  readonly options: readonly PaneOption[]
  readonly sourceAvailable: boolean
  readonly current: Binding<Leg> | null
}
