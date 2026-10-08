import { canRecordFurther } from './controls'
import { n } from './format'
import { LEG_NAME, LEGS } from './legs'
import type { Leg, RunReply } from './protocol'
import type { LegState } from './sessions'
import type { Positions } from './share-link'

/**
 * A LINK'S POSITIONS, HELD UNTIL THE FRAMES REACH THEM — Plan 7 part 6a spec §5.4. A link names a step per program
 * leg; the opener's run records them, and each is applied as the frames that hold it arrive, or continued towards, or
 * clamped, as the run allows.
 *
 * **A POSITION IS PENDING ON ITS LEG, AS `LegState.pending`**, where the leg's step line reads it and a gesture on the
 * leg's step controls takes it away (`transport.ts`). This holds the rest: which compile the link's positions belong
 * to, those not yet given to a leg, and how many times each leg has been continued.
 *
 * **EVERY WAY A LINK'S POSITIONS END BUT A GESTURE IS A RECOMPILE, AND ONE REPLY ANSWERS THEM ALL.** A keystroke, an
 * encoding chosen, an example picked, another link and an open's undo each replace the program, so each supersedes the
 * link's compile, and the first reply of the next one drops every position (`onReply`).
 *
 * **NO DOM, SO IT IS TESTED IN NODE**, against the replies a session worker sends.
 */

/** How many times a position may continue its leg's recording, per leg and per open (spec row 16). */
export const MAX_LINK_CONTINUES = 10

/** Why a leg stopped short of its link's step: its run ended there, or `MAX_LINK_CONTINUES` did not reach it. */
export type ShortOf = 'ended' | 'continues'

/** A leg stopped short of its link's step: the step the link named, the step it shows instead, and why. */
export type Short = { readonly leg: Leg; readonly wanted: number; readonly shown: number; readonly why: ShortOf }

const WHY: Readonly<Record<ShortOf, string>> = {
  ended: 'past the end of this run',
  continues: `further on than ${MAX_LINK_CONTINUES} continues went`,
}

/** `a`, `a and b`, `a, b and c`. */
const listed = (items: readonly string[]): string =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

/**
 * What the open's notice says about the legs stopped short of the link's steps — spec §5.4's note of 2026-10-01: each
 * leg, why it stopped, and the step it shows. **ONE LEG IN THE WORDS IT HAD BEFORE THE NOTE**; several stopped for the
 * same reason in one clause, naming the leg of each step shown; and a clause for each reason, the one with the first
 * leg first. The legs go λ, asm, TM, whatever order they stopped in.
 */
export function shortNotice(shorts: readonly Short[]): string {
  const clauses: Short[][] = []
  for (const short of [...shorts].sort((a, b) => LEGS.indexOf(a.leg) - LEGS.indexOf(b.leg))) {
    const clause = clauses.find((c) => c[0]?.why === short.why)
    if (clause === undefined) clauses.push([short])
    else clause.push(short)
  }
  const said = clauses.map((clause) => {
    const [first] = clause as [Short, ...Short[]]
    if (clause.length === 1) {
      return `${LEG_NAME[first.leg]} step ${n(first.wanted)} is ${WHY[first.why]} — showing step ${n(first.shown)}`
    }
    const wanted = listed(clause.map((s) => `${LEG_NAME[s.leg]} step ${n(s.wanted)}`))
    const shown = listed(clause.map((s) => `${LEG_NAME[s.leg]} step ${n(s.shown)}`))
    return `${wanted} are ${WHY[first.why]} — showing ${shown}`
  })
  return `the link's ${said.join('; its ')}`
}

export type PositionsDeps = {
  /** The program session's leg. */
  readonly legOf: (leg: Leg) => LegState<unknown>
  /** Post the leg's `extend` — what *continue* posts. */
  readonly extend: (leg: Leg) => void
  /** Whether the program session is awaiting a run: nothing can be recorded further while it is. */
  readonly awaitingRun: () => boolean
  /** Say every leg stopped short of its link's step so far in this open, in the order they stopped. */
  readonly short: (shorts: readonly Short[]) => void
  /** Repaint: a seek moves every view of the leg. */
  readonly draw: () => void
}

export class LinkPositions {
  readonly #deps: PositionsDeps
  /** The generation of the link's compile, or `null` when no link's positions are held. */
  #gen: number | null = null
  /** The positions not yet given to a leg: all of them, until the link's compile says which legs exist. */
  #held: Positions = {}
  #continues: Record<Leg, number> = { lambda: 0, asm: 0, tm: 0 }
  /** The legs stopped short of their link's steps in this open, which its one notice names together. */
  #shorts: Short[] = []

  constructor(deps: PositionsDeps) {
    this.#deps = deps
  }

  /**
   * Hold a link's `positions` for the compile of generation `gen`, the compile of the link's program — a pasted link's
   * open scheduled it, and at start-up `main()` did — in place of any other link's (spec §5.4). **BEFORE THAT COMPILE'S
   * `compiled` REPLY**, which gives each leg its position.
   */
  hold(gen: number, positions: Positions): void {
    this.#drop()
    this.#gen = gen
    this.#held = positions
  }

  /** Drop every position, held or pending: a recompile's, or a compile that answered with no run. */
  #drop(): void {
    this.#gen = null
    this.#held = {}
    this.#continues = { lambda: 0, asm: 0, tm: 0 }
    this.#shorts = []
    for (const leg of LEGS) delete this.#deps.legOf(leg).pending
  }

  /**
   * The link's steps not yet reached, for the program session's generation `gen` — spec §5.1's note of 2026-10-01: held
   * while the link's compile runs, and pending on their legs after, until the frames reach them. **NONE FOR ANY OTHER
   * GENERATION**: an edit claims the next one at once, so a step still pending then is the earlier program's, until the
   * new compile's first reply drops it (`onReply`).
   */
  pendingFor(gen: number): Positions {
    if (gen !== this.#gen) return {}
    const steps: { [L in Leg]?: number } = { ...this.#held }
    for (const leg of LEGS) {
      const step = this.#deps.legOf(leg).pending
      if (step !== undefined) steps[leg] = step
    }
    return steps
  }

  /**
   * Hear a reply of the program session, after the app has taken it in: the frames are in their rings by now.
   *
   * **A REPLY OF ANOTHER GENERATION ENDS THE LINK'S POSITIONS**: the program session answers only its current
   * generation, so it is a recompile's, and a recompile drops them (spec §5.4). Until it answers, the step line says the
   * leg is recompiling in place of where it was going.
   */
  onReply(reply: RunReply): void {
    if (this.#gen === null || reply.kind === 'lambda-tree') return
    if (reply.gen !== this.#gen) {
      this.#drop()
      return
    }
    switch (reply.kind) {
      case 'compiled':
        // A POSITION FOR A DECLINED LEG IS DROPPED SILENTLY: the leg's view already says why it is absent.
        for (const leg of LEGS) {
          const step = this.#held[leg]
          if (step !== undefined && reply[leg].available) this.#deps.legOf(leg).pending = step
        }
        this.#held = {}
        return
      case 'lambda-frames':
        this.#frames('lambda')
        return
      case 'asm-frames':
        this.#frames('asm')
        return
      case 'tm-frames':
        this.#frames('tm')
        return
      case 'result':
        this.#result()
        return
      case 'no-session':
      case 'worker-error':
        this.#drop()
        return
      default:
        return
    }
  }

  /**
   * A leg's frames arrived. **ONCE THE RING HOLDS A FRAME PAST THE POSITION, THE HEAD GOES THERE AND IT IS SPENT** —
   * mid-recording too: a seek short of the newest frame stops following, so the rest of the recording does not move the
   * view, and a frame the ring drops later moves the head with it. A position the ring has already dropped lands on the
   * oldest kept step.
   *
   * **PAST IT, NOT AT IT, WHILE THE RECORDING GOES ON.** `History.seek` onto the newest frame goes on following the
   * frontier, so a position that is the last frame of a chunk would be carried off by the next one; it waits for that
   * chunk instead, or for the recording to stop with it as its last frame, when nothing more arrives to move it.
   *
   * **A RECORDING THAT ENDED SHORT OF IT, WITH NOTHING TO CONTINUE, CLAMPS IT**: the leg stays on its last step, and
   * the open's notice says so.
   */
  #frames(leg: Leg): void {
    const state = this.#deps.legOf(leg)
    const wanted = state.pending
    if (wanted === undefined || state.hist.length === 0) return
    const newest = state.hist.newestStep
    if (newest > wanted || (newest === wanted && state.done !== null)) {
      state.hist.seek(wanted - state.hist.oldestStep)
      delete state.pending
      this.#deps.draw()
      return
    }
    if (state.done === null || canRecordFurther(state.done, false)) return
    this.#stop(leg, wanted, 'ended')
  }

  /**
   * A run's or a continue's `result`. **NOT BEFORE IT, AND ONE LEG AT A TIME, λ THEN asm THEN TM**: a continue posted
   * while the run still records a later leg would interleave the two recordings, and post its `result` before the run's
   * (spec §5.4). The first leg in order still short of its position continues, up to `MAX_LINK_CONTINUES` times; past
   * that it stops at its furthest step, and the next leg is asked.
   */
  #result(): void {
    for (const leg of LEGS) {
      const state = this.#deps.legOf(leg)
      const wanted = state.pending
      if (wanted === undefined || !canRecordFurther(state.done, this.#deps.awaitingRun())) continue
      if (this.#continues[leg] < MAX_LINK_CONTINUES) {
        this.#continues[leg] += 1
        this.#deps.extend(leg)
        return
      }
      this.#stop(leg, wanted, 'continues')
    }
  }

  /**
   * Spend `leg`'s position, `wanted`, where it stopped short, and say how far short, at which step: **WITH EVERY LEG
   * STOPPED SHORT BEFORE IT IN THIS OPEN**, since the open's clamps share one notice (spec §5.4's note of 2026-10-01),
   * and a later one would otherwise draw over the earlier unseen and unheard.
   *
   * **THE HEAD GOES TO THE LEG'S LAST STEP**, which is where the spec puts it: a run opens on step 0, and the head has
   * stayed there or on the oldest step kept, since what else could move it — this position, reached, or a gesture on
   * the leg's step controls — would have spent it or taken it away.
   */
  #stop(leg: Leg, wanted: number, why: ShortOf): void {
    const state = this.#deps.legOf(leg)
    state.hist.seek(state.hist.length - 1)
    delete state.pending
    this.#deps.draw()
    this.#shorts.push({ leg, wanted, shown: state.hist.currentStep, why })
    this.#deps.short([...this.#shorts])
  }
}
