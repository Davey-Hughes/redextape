import { History } from './history'
import type { RunReply } from './protocol'
import type { SessionId, SessionPool } from './session-client'
import { resetLegs, type SessionRegistry } from './sessions'
import type { LambdaState } from './types'

/**
 * What retiring a scratchpad needs from a pane slot: which session it is on, and the ability to move
 * it off.
 *
 * A STRUCTURAL TYPE RATHER THAN `PaneSlot<Leg>`, and the reason is variance rather than taste.
 * `PaneSlot<K>`'s `render` takes a `PaneView<LegFrame[K]>` in PARAMETER position, so a
 * `PaneSlot<'lambda'>` and a `PaneSlot<'tm'>` are not two instantiations one signature can name
 * without either a union or method bivariance — and leaning on bivariance to pass a heterogeneous
 * array would be exactly the "the cast a mutation needs is the evidence the types hold" property T4
 * recorded, quietly spent. This type asks for the two members retirement actually uses, both slots
 * satisfy it for free, and `Binding<K>`'s leg parameter is untouched because nothing here can see it.
 *
 * `binding` IS READ-ONLY HERE AND `rebind` IS THE ONLY WRITER, which is `PaneSlot`'s own contract
 * restated at the smallest surface that needs it.
 */
export type Detachable = {
  readonly binding: { readonly session: SessionId }
  rebind(session: SessionId): void
}

/**
 * What a scratchpad needs to exist: the two containers it lives in, its name, and where its replies
 * go.
 *
 * THE ID AND THE LABEL ARE PASSED IN, NOT DECLARED HERE, because `SessionEntry.label`'s doc puts the
 * app's session names in `main.ts` "here and nowhere else" — a module that named its own session would
 * be the second place a name could be wrong, which is the failure `LegState`'s doc refuses one type
 * up.
 */
export type ScratchpadConfig = {
  registry: SessionRegistry
  pool: SessionPool
  id: SessionId
  label: string
  /** The ring's cap for the scratchpad's one leg. `HISTORY_BYTES`, per design §4.4's one knob. */
  historyBytes: number
  onReply: (reply: RunReply) => void
}

/**
 * **THE λ SCRATCHPAD — design §4.3's "detach is a fork, and scratchpads are singletons", and the
 * policy half of plan T8.**
 *
 * Editing a source-derived λ view creates a `LambdaScratch` seeded with that pane's current text and
 * rebinds THAT pane to it. **The source session is untouched and keeps running** — which is the entire
 * reason three sessions exist rather than one mutable one, and the property
 * `tests/browser/scratch-fork.test.ts` asserts by watching the source's step count advance across a
 * detach. Nothing in this class reads or writes the source session's entry, its client or its legs;
 * `detach` touches the registry, the pool and ONE slot.
 *
 * **A CLASS IN ITS OWN MODULE RATHER THAN THREE CLOSURES IN `main()`, AND THE REASON IS THE TEST.**
 * The singleton claim is "two source-derived λ panes edited in turn produce ONE `LambdaScratch`", and
 * the plan is explicit that it must be asserted on POOL SIZE rather than on rendering, because
 * rendering looks right either way. Pool size is not reachable from the DOM, and the app has one λ
 * pane, so an app-driven test could neither see the number nor produce the second edit — the same
 * wall T7 hit and answered by moving the registry out of `main()`. `tests/node/scratch.test.ts` drives
 * this class over a real `SessionRegistry` and a real `SessionPool` with fake ports, which is the
 * whole mechanism minus the thread.
 *
 * **IT IS ALSO WHERE THE COVERAGE GATE CAN SEE IT.** `vite.config.ts` excludes `session-worker.ts`
 * from the include set for a measured instrumentation reason, so logic placed there moves none of the
 * four numbers; the worker therefore holds only the wasm call, and the singleton rule, the rebinding
 * and the retirement order live here.
 *
 * **λ ONLY, AND THE `TmScratch` HALF OF §4.3 IS NOT BUILT — SAID PLAINLY RATHER THAN LEFT TO BE
 * NOTICED.** §4.3 says "at most one `LambdaScratch` and at most one `TmScratch`", and plan T3 built
 * the second type at the boundary. Nothing can create one: a `TmScratch` is built from `.tm` TEXT, and
 * no surface in this app holds any — the TM pane renders a δ-table projected from a compiled program,
 * never the machine source that would have produced one. A second class here, or a `leg` parameter on
 * this one, would be a knob whose only setting is the one it already has. `protocol.ts`'s
 * `lambda-scratch` request carries the same line on the wire.
 */
export class LambdaScratchpad {
  #reg: SessionRegistry
  #pool: SessionPool
  #id: SessionId
  #label: string
  #bytes: number
  #onReply: (reply: RunReply) => void

  constructor(config: ScratchpadConfig) {
    this.#reg = config.registry
    this.#pool = config.pool
    this.#id = config.id
    this.#label = config.label
    this.#bytes = config.historyBytes
    this.#onReply = config.onReply
  }

  /**
   * NO `id` OR `live` ACCESSOR, AND THE ABSENCE IS DELIBERATE. Both were written and both had exactly
   * one caller: a test. The registry and the pool already answer "does the scratchpad exist" —
   * `reg.has(id)` and `pool.has(id)` — and the plan requires the singleton be asserted on POOL SIZE
   * anyway, so a getter here would be a third spelling of a fact two containers already hold, kept
   * alive by the assertions that use it. §4.1 records the same call on `LambdaScratch.initial_lambda`:
   * a field retained for nobody is not made worth having by being cheap.
   */

  /**
   * Fork `slot` onto the λ scratchpad, seeded with `src` — creating the scratchpad if this is the
   * first detach.
   *
   * **THE SINGLETON IS THE `has` BRANCH, AND BOTH CONTAINERS ANSWER IT AT ONCE.** A second detach
   * rebinds to the EXISTING scratch rather than making another (§4.3), so nothing here spawns a
   * second worker or overwrites the first seed. `SessionRegistry.add` and `SessionPool.bind` both
   * THROW on an id they already hold, and both of their docs name this call site as the reason:
   * "§4.3's singleton rebinding is served by asking `has` first, which is one branch at the call site
   * against a leak here that nothing would report". This is that one branch.
   *
   * **THE SECOND DETACH DOES NOT RE-SEED, AND THAT IS §4.3's SENTENCE RATHER THAN A SHORTCUT.** "A
   * second edit to another source-derived λ view REBINDS TO THE EXISTING SCRATCH" — so the second
   * pane joins the scratchpad already running, it does not replace its term with its own. Re-seeding
   * would make the singleton observable only in the pool's size and not in what the user sees, and
   * would silently discard the first pane's scratchpad the moment a second pane detached.
   *
   * THE SEED IS THE CALLER'S TEXT AND THIS FUNCTION DOES NOT GO LOOKING FOR IT. "That pane's current
   * text" is a fact about what is on screen, and the pane is what has it — `LambdaPane` passes the
   * term it is currently rendering. Resolving `slot`'s leg here and printing its head would be the
   * same string most of the time and a different one whenever the pane is showing something else,
   * which is a disagreement between the seed and the screen that nothing would report.
   *
   * REBINDING IS UNCONDITIONAL AND CREATION IS NOT. A pane already bound to the scratchpad rebinding
   * to it is a no-op that costs one object; branching to avoid it would be a second place the
   * singleton rule is written down.
   */
  detach(slot: Detachable, src: string): void {
    if (!this.#reg.has(this.#id)) {
      const client = this.#pool.bind(this.#id, this.#onReply)
      this.#reg.add({
        id: this.#id,
        label: this.#label,
        // `detached: true` BY CONSTRUCTION, AND NOTHING CAN SET IT OTHERWISE. §3.3 is why it is
        // knowable at creation: `linkIndex` and `sourceSpan` exist on neither scratch type, so a
        // scratch session can never participate in the sync anchor. `main.ts`'s source entry is the
        // only one in the app that may say `false`, and its own comment says so.
        detached: true,
        client,
        legs: {
          lambda: {
            hist: new History<LambdaState>(this.#bytes),
            // NOT AVAILABLE YET, WITH A REASON A PANE CAN READ. `controlState` renders `reason` as the
            // step readout while `!available`, and the worker's `scratch-compiled` reply is one
            // message away — so this is what the pane says for the frame or two between the fork and
            // the first batch. Leaving it `''` is what `resetLegs`'s doc records as having left the
            // panes reading nothing.
            status: { available: false, reason: 'building…' },
            done: null,
            timer: null,
          },
        },
      })
      // SUPERSEDE THEN POST, the pattern `main.ts`'s `schedule` uses and for the same reason
      // (`SessionClient.supersede`'s doc): a fresh client is at generation 0, which matches nothing,
      // so the claim has to happen before the post or `scratch` would drop its own message.
      client.scratch(client.supersede(), src)
    }
    slot.rebind(this.#id)
  }

  /**
   * Retire the scratchpad: rebind its panes to `home`, stop its playback, forget it, and **terminate
   * its worker**. Answers whether there was one to retire.
   *
   * **THE CALLER IS RECOMPILE-FROM-SOURCE, AND §4.3 MAKES THAT DELIBERATELY THE SAME MECHANISM AS
   * POISON RECOVERY.** `SessionPool.unbind` is the cure §4.2 names for both findings the
   * print-depth-cap slice paid for — a borrow left taken poisons a module permanently, and a worker's
   * print-stack ceiling drops after its first deep print — because `terminate()` kills a thread that
   * cannot be asked to clean up after itself. Reusing it here is what keeps the app to ONE recovery
   * path rather than two.
   *
   * **THE ORDER IS LOAD-BEARING AND IT IS PANES, LEGS, REGISTRY, POOL.** Panes first: `legOf` and
   * `entryOf` throw for a session the registry does not hold, and `draw()` resolves through both, so a
   * slot still pointing at a removed entry is an exception on the next frame rather than a blank pane.
   * Legs second, through `resetLegs`, and that call is the one that is easy to leave out —
   * `SessionRegistry.remove` deletes a map key and cannot see a running `setInterval`, and `add`'s doc
   * names exactly this leak ("a stranded `setInterval` on a `LegState` nothing can reach any more").
   * Registry third and pool last, because `remove`'s own doc says a caller retiring a session calls
   * both and that terminating a thread is never the registry's job.
   *
   * **IT RETURNS A BOOLEAN BECAUSE ITS CALLER RUNS ON EVERY KEYSTROKE.** `main.ts` calls this from
   * `schedule`, which fires per keystroke while the post itself is debounced, and a repaint per
   * keystroke is the waste the editor's update listener explicitly declines to pay. The answer is
   * "did anything move", so the caller draws on the one keystroke that retired a scratchpad and not
   * on the others.
   *
   * IDEMPOTENT, MIRRORING `SessionPool.unbind` AND `SessionRegistry.remove`: most recompiles happen
   * when no scratchpad exists at all, and a guard every caller must write is a guard the callee
   * should have.
   */
  retire(home: SessionId, slots: readonly Detachable[]): boolean {
    if (!this.#reg.has(this.#id)) return false
    for (const slot of slots) {
      if (slot.binding.session === this.#id) slot.rebind(home)
    }
    // 'not compiled' IS THE REASON THE PANE READS FOR THE INSTANT BETWEEN THIS AND THE REBOUND
    // SESSION'S NEXT FRAME — the same wording `main.ts` gives a source session with no program, and
    // true here for the same reason: there is nothing behind this leg any more.
    resetLegs(this.#reg.entryOf(this.#id).legs, null, null, 'not compiled')
    this.#reg.remove(this.#id)
    this.#pool.unbind(this.#id)
    return true
  }
}
