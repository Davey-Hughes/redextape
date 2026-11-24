import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { LambdaTrees } from '../../src/lambda-trees'
import type { LinkWiring } from '../../src/link-wiring'
import { PaneCollection } from '../../src/panes'
import type { FramesReply, RecordEnd, RunReply } from '../../src/protocol'
import { CLIF_ABSENT, clifFrameBytes, lambdaFrameBytes, rxmFrameBytes, tmFrameBytes } from '../../src/protocol'
import type { ProgramResult } from '../../src/readout'
import { createReplies } from '../../src/replies'
import type { SessionId } from '../../src/session-client'
import type { ClifHold, LegState, SessionEntry, SessionLegs } from '../../src/sessions'
import { holdClifLeg, rewindLeg, SessionRegistry } from '../../src/sessions'
import type {
  ClifListing,
  ClifState,
  LambdaState,
  RxmProgram,
  RxmState,
  RxmStatus,
  TmProgram,
  TmState,
} from '../../src/types'
import { FACT_95 } from './clif-frames'
import { legState } from './leg-fixture'
import { frameOf } from './rxm-fixtures'
import { fakeClient, lambdaFrame } from './session-fixtures'
import { ONE_RULE_PROGRAM, tmFrame } from './tm-machines'
import { wireOf } from './tree-fixture'

/**
 * **WHAT A SESSION KEEPS FROM ITS OWN `compiled` REPLY** — the retention a TM pane created later is
 * seeded from.
 *
 * Without this retention a TM pane built after the last `compiled` reply would have no route to a
 * program until the next compile: `pane-host.ts` constructs the pane and seeds it from what the entry
 * retained. The browser tier asserts the visible half (`pane-picker.test.ts`,
 * `pane-kind-switch.test.ts`: a pane created from the split menu or a title menu paints tapes and
 * δ-rows). This file asserts the half that has no DOM in it — the entry holds what the panes were
 * told, whether or not any pane was there to be told.
 *
 * **THE COLLECTION IS EMPTY, AND THAT IS THE POINT RATHER THAN A SHORTCUT.** The retention has to
 * survive a reply that reached no pane — that is the only situation it exists for, since a session
 * with a TM pane already open needs nothing retained to look right. A test that registered a pane
 * could not tell "the entry was written" from "the pane was pushed to".
 *
 * **THE STAND-INS DIVIDE IN THREE.** `view` and `links` are REACHED by the arm under test — the
 * `compiled` arm dispatches two CodeMirror effects and installs a link index — so they record, and their
 * calls are asserted below, together with `draw`'s: a green retention over a switch that fell through
 * somewhere else is not a green test. `results` is not reached by the `compiled` arm at all and is `undefined`
 * behind a cast, deliberately: an arm that starts touching it crashes this test loudly rather than passing over a fake
 * that quietly absorbs the call. There is no honester option in the node tier — an `EditorView` and an `HTMLElement`
 * both need a document, which is exactly why the browser tier owns everything about this retention that can be seen.
 *
 * **THE CLEARING ARMS ARE NOT HERE, AND THE REASON IS THAT SAME MISSING `#results`.** `no-session` and
 * `worker-error` clear the retention exactly as they clear every TM pane on the session, and both open by
 * writing `results.dataset.state` — `results` is the `undefined` behind a cast named above, so neither arm
 * can be entered at all in this tier. `tests/browser/pane-picker.test.ts` drives the failed
 * compile through the real app and asserts what it is for: a TM pane created after it is as empty as the
 * panes already on screen.
 */

const SOURCE: SessionId = 'source'

/** A session with every leg and nothing compiled yet, exactly as `main.ts` registers the source one. */
function sourceEntry(): SessionEntry {
  return {
    id: SOURCE,
    label: 'source',
    client: fakeClient(),
    legs: {
      lambda: legState<LambdaState>(false, 1_000_000),
      rxm: legState<RxmState>(false, 1_000_000),
      tm: legState<TmState>(false, 1_000_000),
      clif: legState<ClifState>(false, 1_000_000),
    } satisfies Required<SessionLegs>,
    programs: { rxm: null, tm: null, clif: null },
  }
}

const compiled = (tmProgram: TmProgram | null, tapeNames: string[]): Extract<RunReply, { kind: 'compiled' }> => ({
  kind: 'compiled',
  gen: 1,
  statuses: {
    lambda: { available: true, reason: '', node: null, run: null },
    rxm: { available: false, reason: 'no rxm leg', run: null, cap: null, total_steps: null },
    tm: { available: true, reason: '', width: 8, run: null, total_steps: null },
    clif: { available: false, reason: '', run: null, cap: null, total_steps: null },
  },
  programs: {
    rxm: null,
    tm: tmProgram === null ? null : { program: tmProgram, tapeNames },
    clif: null,
  },
  declinedSpan: null,
  linkIndex: null,
  first: { lambda: null, rxm: null, tm: null, clif: null },
  lambdaTree: null,
})

/**
 * The switch under test, over a registry holding `entry`, with no pane in the collection.
 *
 * `frame` IS OVERRIDABLE, AND DEFAULTS TO A STAND-IN, a callback run straight. A recording chunk that does not end the
 * recording schedules its redraw on `frame`, and `createReplies`' own default, `requestAnimationFrame`, is not
 * defined in this tier: a `frames` reply sent here without a stand-in would throw.
 */
function driver(
  entry: SessionEntry,
  opts: {
    frame?: (cb: () => void) => void
    trees?: LambdaTrees
    onDraw?: () => void
    clif?: NonNullable<Parameters<typeof createReplies>[0]['clif']>
    /** For the `result` arm alone, which writes `results` and stores what `setProgram` takes. */
    results?: { readonly results: HTMLElement; readonly setProgram: (r: ProgramResult) => void }
  } = {},
) {
  const reg = new SessionRegistry()
  reg.add(entry)
  const dispatched: unknown[] = []
  const indexed: unknown[] = []
  let drawn = 0
  const view = { dispatch: (t: unknown) => dispatched.push(t) } as unknown as EditorView
  const links = { setIndex: (i: unknown) => indexed.push(i) } as unknown as LinkWiring
  const replies = createReplies({
    setProgram: opts.results?.setProgram ?? (() => undefined),
    trees: opts.trees ?? new LambdaTrees(() => ({ gen: 0, awaitingRun: false, tree: () => undefined })),
    sessions: reg,
    results: opts.results?.results ?? (undefined as unknown as HTMLElement),
    view: () => view,
    panes: new PaneCollection(),
    links,
    draw: () => {
      drawn += 1
      opts.onDraw?.()
    },
    frame: opts.frame ?? ((cb: () => void) => cb()),
    ...(opts.clif === undefined ? {} : { clif: opts.clif }),
  })
  return { replies, dispatched, indexed, drawn: () => drawn }
}

describe('a session retains its last compiled machine', () => {
  /**
   * THE RETENTION ITSELF. `tapeNames` is retained beside the program rather than derived from it —
   * `TmProgram` carries `tapes: 1` and no names at all, so a pane seeded from the program alone would
   * label its tapes by index while every pane seeded from a reply labelled them properly.
   */
  it('holds the program and the tape names a `compiled` reply carried', () => {
    const entry = sourceEntry()
    const { replies, dispatched, indexed, drawn } = driver(entry)

    expect(entry.programs.tm).toBeNull()
    replies.onReply(SOURCE, compiled(ONE_RULE_PROGRAM, ['TAPE', 'STACK']))

    expect(entry.programs.tm?.program).toBe(ONE_RULE_PROGRAM)
    expect(entry.programs.tm?.tapeNames).toEqual(['TAPE', 'STACK'])
    // AND THE REST OF THE ARM RAN — see this file's doc: the two reached stubs are what say so.
    expect(dispatched.length).toBe(1)
    expect(indexed).toEqual([null])
    expect(drawn()).toBe(1)
  })

  /**
   * **A COMPILE THAT PRODUCED NO MACHINE RETAINS NOTHING, AND `null` IS NOT A PLACEHOLDER HERE.** The
   * worker sends `programs.tm: null` for a program whose TM leg is declined, and the seeding in
   * `pane-host.ts` reads exactly this field, so a retention that kept the last machine instead would
   * hand a new pane the previous compile's δ-table over a `width` line with no machine behind it.
   */
  it('retains nothing when the reply carried no machine', () => {
    const entry = sourceEntry()
    const { replies } = driver(entry)

    replies.onReply(SOURCE, compiled(ONE_RULE_PROGRAM, ['TAPE']))
    expect(entry.programs.tm).not.toBeNull()

    replies.onReply(SOURCE, compiled(null, []))

    expect(entry.programs.tm).toBeNull()
  })

  /**
   * **THE SECOND COMPILE REPLACES THE FIRST RATHER THAN ADDING TO IT.** A recompile invalidates every
   * state id — `TmPane.setProgram`'s body says so, and it drops each pane's links for that reason — so an
   * entry still holding the previous machine would seed a newly created pane with a δ-table whose rows
   * name states the session no longer has.
   */
  it('holds the machine from the latest compile, not the first', () => {
    const entry = sourceEntry()
    const { replies } = driver(entry)
    const second: TmProgram = { ...ONE_RULE_PROGRAM, states: [{ name: 'pc1', accept: true, rules: [], instr: null }] }

    replies.onReply(SOURCE, compiled(ONE_RULE_PROGRAM, ['TAPE']))
    replies.onReply(SOURCE, compiled(second, ['REG']))

    expect(entry.programs.tm?.program).toBe(second)
    expect(entry.programs.tm?.tapeNames).toEqual(['REG'])
  })
})

/**
 * **A `clif-listing` WITH NO LISTING SAYS THE CLIF LEG HAS NO STEPPER**, so the page takes the leg's part out of the
 * result it stored: a stepper that throws is dropped with no `result` after it to say so.
 */
describe('a `clif-listing` reply with no listing', () => {
  it("tells the page the CLIF leg has no stepper, at the leg's epoch alone, and draws", () => {
    const entry = sourceEntry()
    let absent = 0
    const clif = {
      loaded: () => undefined,
      settled: () => undefined,
      absent: () => {
        absent += 1
      },
    }
    const { replies, drawn } = driver(entry, { clif })

    replies.onReply(SOURCE, {
      kind: 'clif-listing',
      gen: 1,
      epoch: 0,
      listing: { functions: [], rows: [] },
      error: null,
    })
    expect(absent, 'a listing').toBe(0)
    replies.onReply(SOURCE, { kind: 'clif-listing', gen: 1, epoch: 1, listing: null, error: 'the stepper threw' })
    expect(absent, "another epoch's").toBe(0)
    expect(drawn()).toBe(1)

    replies.onReply(SOURCE, { kind: 'clif-listing', gen: 1, epoch: 0, listing: null, error: 'the stepper threw' })
    expect(absent, "none, at the leg's epoch").toBe(1)
    expect(entry.legs.clif?.status).toEqual({ available: false, reason: 'the stepper threw' })
    expect(drawn()).toBe(2)
  })
})

/**
 * **A CLIF LEG HELD FOR A LISTING CHOSEN CHANGES IN ONE DRAW** (`ClifHold`): its ring, end and listing stay as they
 * are until the first chunk of the hold's epoch, which comes with the listing that came for it, and the readout keeps
 * the CLIF part it held. The leg holds two frames of `fact.rxt`'s step 95, so a ring emptied for the new chunk's one
 * frame is told from one it was pushed onto.
 */
describe('a CLIF leg held for a listing chosen', () => {
  /** The listing the leg shows when the hold begins, and the one the hold's `clif-listing` brings. */
  const LEFT: ClifListing = { functions: [], rows: [] }
  const CHOSEN: ClifListing = { functions: [], rows: [] }
  /** The listing `entry` holds as its CLIF program, told by identity: the two above are equal in value. */
  const shown = (entry: SessionEntry) => {
    const p = entry.programs.clif
    return p !== null && 'listing' in p ? p.listing : null
  }

  function held(part?: ClifHold['part']) {
    const entry = sourceEntry()
    const clif = legState<ClifState>(true, 1_000_000)
    for (let i = 0; i < 2; i++) clif.hist.push(FACT_95, clifFrameBytes(FACT_95))
    clif.done = 'ended'
    clif.gen = 1
    const withClif: SessionEntry = {
      ...entry,
      legs: { ...entry.legs, clif },
      programs: { ...entry.programs, clif: { listing: LEFT } },
    }
    holdClifLeg(clif, part)
    return { entry: withClif, clif }
  }
  const listing = (epoch: number, gen = 1): RunReply => ({
    kind: 'clif-listing',
    gen,
    epoch,
    listing: CHOSEN,
    error: null,
  })
  const chunk = (epoch: number, gen = 1): RunReply => ({
    kind: 'frames',
    leg: 'clif',
    gen,
    epoch,
    frames: [FACT_95],
    done: null,
  })

  it('keeps the listing a clif-listing brings until its first chunk, then shows the two in one task', () => {
    const { entry, clif } = held()
    let drawn = 0
    const { replies } = driver(entry, { onDraw: () => (drawn += 1) })
    replies.onReply(SOURCE, listing(clif.epoch))
    expect(shown(entry), 'the listing the hold keeps, until the chunk').toBe(LEFT)
    expect(clif.hist.length, 'the frames the hold keeps').toBe(2)
    expect(clif.done, 'the end the hold keeps').toBe('ended')
    expect(drawn, 'no draw for the listing alone').toBe(0)
    replies.onReply(SOURCE, chunk(clif.epoch))
    expect(shown(entry), 'the listing chosen, with its chunk').toBe(CHOSEN)
    expect(clif.hist.length, "the chunk's frame alone").toBe(1)
    expect(clif.clifHold).toBeUndefined()
    expect(drawn).toBe(1)
  })

  it('drops a first chunk no listing came for, and stays held', () => {
    const { entry, clif } = held()
    const { replies } = driver(entry)
    replies.onReply(SOURCE, chunk(clif.epoch))
    replies.onReply(SOURCE, listing(clif.epoch, 1))
    replies.onReply(SOURCE, chunk(clif.epoch, 2))
    expect(shown(entry), 'the listing the hold keeps').toBe(LEFT)
    expect(clif.hist.length, 'the frames the hold keeps, none pushed').toBe(2)
    expect(clif.done).toBe('ended')
    expect(clif.clifHold, 'still held').toBeDefined()
  })

  it('lets go of the listing it kept at a compile and at a rewind', () => {
    for (const end of ['compiled', 'rewind'] as const) {
      const { entry, clif } = held()
      const { replies } = driver(entry)
      replies.onReply(SOURCE, listing(clif.epoch))
      expect(clif.clifHold?.landing?.compiled, `precondition: the listing is kept on the leg (${end})`).toEqual({
        listing: CHOSEN,
      })
      if (end === 'compiled') replies.onReply(SOURCE, compiled(null, []))
      else rewindLeg(clif)
      expect(clif.clifHold, end).toBeUndefined()
    }
  })

  it("keeps the CLIF part it held in a result of its generation, and not in one of another's", () => {
    const part = { held: 'the CLIF part at the press' } as never
    const { entry } = held({ gen: 1, clif: part })
    const stored: ProgramResult[] = []
    const { replies } = driver(entry, {
      results: { results: { dataset: {} } as HTMLElement, setProgram: (r) => stored.push(r) },
    })
    const result = (gen: number): RunReply =>
      ({ kind: 'result', gen, legs: { lambda: 'λ', rxm: 'rxm', tm: 'tm', clif: CLIF_ABSENT }, pinned: false }) as never
    replies.onReply(SOURCE, result(1))
    replies.onReply(SOURCE, result(2))
    const clifOf = (r: ProgramResult | undefined) => (r?.kind === 'result' ? r.legs.clif : 'no result')
    expect(clifOf(stored[0]), 'its generation').toBe(part)
    expect(clifOf(stored[1]), "another generation's").toBe(CLIF_ABSENT)
    expect(stored[0]?.kind === 'result' && stored[0].legs.tm, 'the other legs, as they came').toBe('tm')
  })
})

/**
 * **THE NEW PROGRAM'S STEP 0 IS ON THE PAGE IN THE ONE DRAW ITS `compiled` REPLY MAKES** (recompile-flash design): each
 * leg's step-0 frame in its ring and λ's step-0 tree in the cache, so no view draws an empty ring or flat text first.
 */
describe("a `compiled` reply's step-0 pictures", () => {
  it('are in the rings and the tree cache when the arm draws, and no tree is asked for', () => {
    const entry = sourceEntry()
    const asked: number[] = []
    const trees = new LambdaTrees(() => ({ gen: 1, awaitingRun: false, tree: (step: number) => asked.push(step) }))
    const seen: unknown[] = []
    const { replies, drawn } = driver(entry, {
      trees,
      onDraw: () =>
        seen.push({
          lambda: entry.legs.lambda?.hist.current,
          rxm: entry.legs.rxm?.hist.length,
          tm: entry.legs.tm?.hist.current,
          gens: [entry.legs.lambda?.gen, entry.legs.tm?.gen],
          tree: trees.want(SOURCE, 0),
          build: trees.buildOf(SOURCE),
        }),
    })
    const tree = wireOf('(λx. x) (λy. y)')
    const [lambda, tm] = [lambdaFrame('(λx. x) (λy. y)'), tmFrame(0, 0, '#')]

    replies.onReply(SOURCE, {
      ...compiled(ONE_RULE_PROGRAM, ['TAPE']),
      first: { lambda, rxm: null, tm, clif: null },
      lambdaTree: tree,
    })

    expect(drawn()).toBe(1)
    expect(seen).toEqual([{ lambda, rxm: 0, tm, gens: [1, 1], tree: { kind: 'tree', tree }, build: 1 }])
    expect(asked).toEqual([])
  })
})

/**
 * A hand-driven stand-in for `requestAnimationFrame`: `frame` queues a callback and `fire` runs one frame.
 *
 * A REAL `requestAnimationFrame` HANDS EACH QUEUED CALLBACK THE SAME FRAME — draining what is queued NOW, not what a
 * callback queues while this drain runs, is what a fake stands in for here.
 */
function frameQueue() {
  const pending: Array<() => void> = []
  return {
    pending,
    frame: (cb: () => void): void => {
      pending.push(cb)
    },
    fire: (): void => {
      const due = pending.splice(0, pending.length)
      for (const cb of due) cb()
    },
  }
}

/**
 * **A RECORDING CHUNK'S REDRAW IS COALESCED TO ONE PER FRAME** — the `frames` arm, over three legs.
 * `record-loop.ts`'s `recordLeg` posts one chunk per `RECORD_CHUNK` steps while any leg records, far more often than a
 * display paints, so the arm pushes the chunk's frames at once and leaves only the paint for the next frame; the chunk
 * that ends the recording paints at once, since a rewound leg's recording gets no `result` reply to paint its last
 * frame.
 *
 * EVERY CASE RUNS FOR ALL THREE LEGS. The arm sizes a chunk by its leg's `LEG_FRAME_BYTES` entry, and a wrong entry is
 * wrong for that leg alone, so one leg's case says nothing of the rest.
 */
describe('a recording chunk redraws once per frame', () => {
  const FRAMES_LEGS = ['lambda', 'tm', 'rxm'] as const
  type FramesLeg = (typeof FRAMES_LEGS)[number]

  /** A `frames` reply for `leg` carrying steps `from` to `from + 1` under `epoch`, and the frames it carries. */
  const chunk = (
    leg: FramesLeg,
    from: number,
    done: RecordEnd | null,
    epoch = 0,
  ): { reply: FramesReply; frames: unknown[] } => {
    const steps = [from, from + 1]
    switch (leg) {
      case 'lambda': {
        const frames = steps.map((step) => ({ ...lambdaFrame(`t${step}`), step }))
        return { reply: { kind: 'frames', leg: 'lambda', gen: 1, epoch, frames, done }, frames }
      }
      case 'tm': {
        const frames = steps.map((step) => tmFrame(0, step, 'a'))
        return { reply: { kind: 'frames', leg: 'tm', gen: 1, epoch, frames, done }, frames }
      }
      case 'rxm': {
        const frames = steps.map((step) => frameOf({ step }))
        return { reply: { kind: 'frames', leg: 'rxm', gen: 1, epoch, frames, done }, frames }
      }
    }
  }

  /**
   * The program's session, its `leg` leg and the switch over it, on a hand-driven frame queue; `drawn` counts from
   * zero.
   */
  const harness = (leg: FramesLeg) => {
    const q = frameQueue()
    const entry = sourceEntry()
    const d = driver(entry, { frame: q.frame })
    return {
      q,
      send: (r: RunReply) => d.replies.onReply(SOURCE, r),
      leg: () => entry.legs[leg] as LegState<unknown>,
      drawn: d.drawn,
    }
  }

  /**
   * THE HISTORY IS ASSERTED FIRST, BEFORE ANY COUNT. Only the paint may wait for the frame: the step bar, the
   * controls and the next chunk all read the leg straight, so every frame the burst carried must already be there.
   */
  it.each(FRAMES_LEGS)('%s: a burst of chunks draws once, on the frame, with the history already current', (leg) => {
    const h = harness(leg)
    const first = chunk(leg, 0, null)
    const last = chunk(leg, 4, null)
    h.send(first.reply)
    h.send(chunk(leg, 2, null).reply)
    h.send(last.reply)

    // THE RUN OPENS ON ITS FIRST FRAME, with the burst's last already behind it.
    const { hist } = h.leg()
    expect({ length: hist.length, current: hist.current }).toEqual({ length: 6, current: first.frames[0] })
    expect(h.drawn()).toBe(0)
    expect(h.q.pending.length).toBe(1)
    h.q.fire()
    expect(h.drawn()).toBe(1)
    hist.seek(hist.length - 1)
    expect(hist.current).toEqual(last.frames.at(-1))
  })

  it.each(FRAMES_LEGS)('%s: the chunk that ends the recording draws at once', (leg) => {
    const h = harness(leg)
    h.send(chunk(leg, 0, 'budget').reply)

    expect(h.leg().done).toBe('budget')
    expect(h.drawn()).toBe(1)
    expect(h.q.pending.length).toBe(0)
  })

  /**
   * **A CHUNK OF ANOTHER EPOCH THAN ITS LEG'S IS FROM A RECORDING A REWIND REPLACED**, posted before the worker took
   * the rewind: it pushes nothing, leaves the leg's end and draws nothing, and a chunk at the leg's epoch lands.
   */
  it.each(FRAMES_LEGS)('%s: a chunk of another epoch is dropped whole, and one of the leg’s own lands', (leg) => {
    const h = harness(leg)
    h.leg().epoch = 1
    h.send(chunk(leg, 0, null).reply)
    h.send(chunk(leg, 2, 'ended').reply)

    expect({ length: h.leg().hist.length, done: h.leg().done }).toEqual({ length: 0, done: null })
    expect({ drawn: h.drawn(), pending: h.q.pending.length }).toEqual({ drawn: 0, pending: 0 })

    const own = chunk(leg, 0, 'budget', 1)
    h.send(own.reply)
    expect({ length: h.leg().hist.length, done: h.leg().done }).toEqual({ length: 2, done: 'budget' })
    expect(h.leg().hist.current).toEqual(own.frames[0])
    expect(h.drawn()).toBe(1)
  })

  /**
   * **A LEG'S `gen` IS THE GENERATION OF THE FRAMES ITS RING HOLDS**, which `restart` reads to tell whether the
   * worker still holds their recording: set from each chunk the leg takes, and left by one it drops.
   */
  it.each(FRAMES_LEGS)('%s: a chunk of the leg’s epoch sets its gen, and one of another epoch leaves it', (leg) => {
    const h = harness(leg)
    h.leg().epoch = 1
    h.send({ ...chunk(leg, 0, null).reply, gen: 3 })
    expect(h.leg().gen).toBe(0)

    h.send({ ...chunk(leg, 0, null, 1).reply, gen: 3 })
    expect(h.leg().gen).toBe(3)
  })

  /**
   * A BROWSER'S FRAME CANNOT BE UNCALLED, so the one a burst scheduled still fires after the ending chunk has drawn,
   * and must find nothing left to draw.
   */
  it.each(FRAMES_LEGS)('%s: the frame left pending when the recording ends draws nothing', (leg) => {
    const h = harness(leg)
    h.send(chunk(leg, 0, null).reply)
    expect(h.q.pending.length).toBe(1)
    h.send(chunk(leg, 2, 'ended').reply)
    expect(h.drawn()).toBe(1)

    h.q.fire()
    expect(h.drawn()).toBe(1)
  })

  /**
   * **ONE PENDING FLAG FOR EVERY LEG.** The program's session records its three legs at once, so a flag kept per leg
   * would give each of them a frame of its own.
   */
  it("the program's λ, TM and rxm chunks landing before one frame share its one draw", () => {
    const q = frameQueue()
    const d = driver(sourceEntry(), { frame: q.frame })
    d.replies.onReply(SOURCE, chunk('lambda', 0, null).reply)
    d.replies.onReply(SOURCE, chunk('tm', 0, null).reply)
    d.replies.onReply(SOURCE, chunk('rxm', 0, null).reply)

    expect(d.drawn()).toBe(0)
    expect(q.pending.length).toBe(1)
    q.fire()
    expect(d.drawn()).toBe(1)
  })

  /** `frames`, charged by `leg`'s own function, named here rather than read off `LEG_FRAME_BYTES`. */
  const ownCharge = (leg: FramesLeg, frames: unknown[]): number[] => {
    switch (leg) {
      case 'lambda':
        return (frames as LambdaState[]).map((f) => lambdaFrameBytes(f))
      case 'tm':
        return (frames as TmState[]).map((f) => tmFrameBytes(f))
      case 'rxm':
        return (frames as RxmState[]).map((f) => rxmFrameBytes(f))
    }
  }

  /**
   * **EACH LEG'S FRAMES ARE CHARGED BY THAT LEG'S OWN FUNCTION.** The arm sizes a chunk through `LEG_FRAME_BYTES`, and
   * an entry that charges a leg's frame otherwise fills or empties the ring early with nothing on screen to say so. The
   * charge is read where the ring takes it, at its `push`, and checked against `ownCharge`, so that the table is
   * checked against something other than itself.
   */
  it('charges each leg’s frames by that leg’s own function', () => {
    for (const leg of FRAMES_LEGS) {
      const h = harness(leg)
      const { hist } = h.leg()
      const charged: number[] = []
      const push = hist.push.bind(hist)
      hist.push = (frame, bytes) => {
        charged.push(bytes)
        push(frame, bytes)
      }
      const { reply, frames } = chunk(leg, 0, 'ended')
      h.send(reply)
      expect(charged, leg).toEqual(ownCharge(leg, frames))
    }
  })
})

/** The program's rxm listing rides `compiled`, kept on the session for a view built after the reply. */
describe('a session retains its rxm listing', () => {
  const LISTING: RxmProgram = { listing: ['li\trr, #1', 'halt'], labels: [] }

  it('holds the listing a `compiled` reply carried, and nothing when it carried none', () => {
    const entry = sourceEntry()
    const { replies } = driver(entry)
    const rxm: RxmStatus = { available: true, reason: '', run: 'Running', cap: null, total_steps: 2 }
    const base = compiled(ONE_RULE_PROGRAM, ['TAPE'])
    replies.onReply(SOURCE, {
      ...base,
      statuses: { ...base.statuses, rxm },
      programs: { ...base.programs, rxm: { program: LISTING } },
    })
    expect(entry.programs.rxm).toEqual({ program: LISTING })

    replies.onReply(SOURCE, compiled(ONE_RULE_PROGRAM, ['TAPE']))
    expect(entry.programs.rxm).toBeNull()
  })
})
