import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControlState } from '../../src/controls'
import { LEGS } from '../../src/legs'
import type { LinkWiring } from '../../src/link-wiring'
import type { Leg } from '../../src/protocol'
import { SessionClient, type SessionId } from '../../src/session-client'
import type { Binding, LegState, PaneOption, PaneView, SessionEntry } from '../../src/sessions'
import {
  freshLeg,
  holdClifLeg,
  legControlState,
  PaneSlot,
  resetLegs,
  rewindLeg,
  SessionRegistry,
} from '../../src/sessions'
import { createTransport } from '../../src/transport'
import type { ClifState, LambdaState, RxmState, TmState } from '../../src/types'
import { legState } from './leg-fixture'
import { frameOf } from './rxm-fixtures'
import { fakeClient, fakePort, lambdaFrame, noSessionReply, paint } from './session-fixtures'
import { tmFrame } from './tm-machines'

/**
 * THE BINDING MODEL, DRIVEN WITHOUT A BROWSER, at the level where it is decided.
 *
 * The claim is that two panes bound to two DIFFERENT λ sessions render two different terms
 * simultaneously, because anything weaker passes on a single-session implementation.
 * `tests/browser/view-title.test.ts` asserts the same thing with real `LambdaPane`s and real text in a
 * real DOM; this file asserts it against the resolution itself, with recording fakes, which is what
 * makes the failure legible when it breaks — a browser failure says "two panes read the same string",
 * this one says which binding resolved to which leg.
 *
 * The production path is shared instead of re-implemented: `draw.ts`'s per-pane loop calls exactly
 * `slot.resolve(reg)` and `slot.render(reg, pane, leg)`, which is what the `it`s below call.
 *
 * Section citations here are the 5d-i design's unless they name another.
 */

/**
 * One session, its legs seeded with the frames given.
 *
 * A LEG IS OMITTED WHEN ITS ARGUMENT IS, WHICH IS THE POINT rather than convenience: `SessionLegs` is optional, and a
 * helper that always built every leg would make every assertion below about `options` vacuous.
 */
function entry(
  id: SessionId,
  opts: { label?: string; lambda?: string[]; rxm?: number[]; tm?: number[] } = {},
): SessionEntry {
  const legs: { lambda?: LegState<LambdaState>; rxm?: LegState<RxmState>; tm?: LegState<TmState> } = {}
  if (opts.lambda !== undefined) {
    const l = legState<LambdaState>(true, 1_000_000)
    for (const [i, text] of opts.lambda.entries()) l.hist.push(lambdaFrame(text, i), 1)
    legs.lambda = l
  }
  if (opts.rxm !== undefined) {
    const a = legState<RxmState>(true, 1_000_000)
    for (const [i, pc] of opts.rxm.entries()) a.hist.push(frameOf({ step: i, pc }), 1)
    legs.rxm = a
  }
  if (opts.tm !== undefined) {
    const t = legState<TmState>(true, 1_000_000)
    for (const s of opts.tm) t.hist.push(tmFrame(s, 0, '_'), 1)
    legs.tm = t
  }
  // NO MACHINE ON ANY OF THEM. `SessionEntry.programs.tm` is retained from a `compiled` reply, and this
  // file drives the binding model rather than the reply switch — `tests/node/replies.test.ts` is where
  // the retention itself is asserted.
  return {
    id,
    label: opts.label ?? id,
    client: fakeClient(),
    legs,
    programs: { rxm: null, tm: null, clif: null },
  }
}

/** A `PaneView` that records its render and binding calls instead of touching a DOM. */
function recorder<T>() {
  const frames: (T | null)[] = []
  const controls: ControlState[] = []
  const bindings: { options: PaneOption[]; current: Binding<Leg> }[] = []
  const view: PaneView<T> = {
    render: (frame, c) => {
      frames.push(frame)
      controls.push(c)
    },
    setBindings: (options, current) => bindings.push({ options, current }),
    setLayoutControls: (_canClose, _canSplit) => {},
    setStepsShown: (_shown) => {},
  }
  return { view, frames, controls, bindings }
}

describe('SessionRegistry', () => {
  it('throws for a session it does not hold rather than answering with nothing', () => {
    const reg = new SessionRegistry()
    expect(reg.size).toBe(0)
    expect(() => reg.entryOf('source')).toThrow(/not in the registry: source/)
    expect(() => reg.legOf({ session: 'source', leg: 'lambda' })).toThrow(/not in the registry/)
  })

  it('throws for a leg the session does not have', () => {
    const reg = new SessionRegistry()
    reg.add(entry('lambda-only', { lambda: ['x'] }))
    expect(reg.legOf({ session: 'lambda-only', leg: 'lambda' }).hist.length).toBe(1)
    expect(() => reg.legOf({ session: 'lambda-only', leg: 'tm' })).toThrow(/has no tm leg/)
  })

  // `SessionPool.bind`'s refusal, mirrored: a second `add` asks for something unhonourable (the replaced entry's
  // playback would be stranded on a `LegState` nothing can reach).
  it('refuses a duplicate add', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { lambda: ['a'], tm: [0] }))
    expect(() => reg.add(entry('source', { lambda: ['b'] }))).toThrow(/already in the registry: source/)
    expect(reg.legOf({ session: 'source', leg: 'lambda' }).hist.current?.text).toBe('a')
    expect(reg.size).toBe(1)
  })

  /**
   * A session is offered for exactly the legs it has — asserted as the filter it is, which is also the whole content
   * of what a selector may put in front of a user. A slot showing λ must never be
   * offered a session with no λ leg, because `legOf` throws on one, and these two facts are the same
   * fact read from two sides.
   */
  it('offers a leg only the sessions that have it, in registration order', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['a'], tm: [0] }))
    reg.add(entry('lambda-only', { label: 'λ only', lambda: ['b'] }))
    reg.add(entry('tm-only', { label: 'TM only', tm: [1] }))

    expect(reg.options('lambda')).toEqual([
      { id: 'source', label: 'source' },
      { id: 'lambda-only', label: 'λ only' },
    ])
    expect(reg.options('tm')).toEqual([
      { id: 'source', label: 'source' },
      { id: 'tm-only', label: 'TM only' },
    ])
  })
})

describe('PaneSlot', () => {
  /**
   * TWO SLOTS, TWO λ SESSIONS, at the level the binding is resolved, painted in the same pass and
   * asserted TOGETHER — a sequential "bind, check, rebind, check" would pass on an implementation with
   * one session and a mutable global.
   *
   * THE FRAMES ARE DIFFERENT STRINGS ON PURPOSE, the same discriminator `pool-isolation.test.ts` uses
   * for three sessions' answers: identical terms would render identically even if both slots resolved
   * to one leg, so the value has to be the assertion and not the shape.
   */
  it('renders two different λ sessions into two panes at the same time', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['(λx. x) 1'], tm: [0] }))
    reg.add(entry('lambda-only', { label: 'λ only', lambda: ['(λy. y y) 2'] }))

    const a = new PaneSlot('lambda', 'source')
    const b = new PaneSlot('lambda', 'lambda-only')
    const paneA = recorder<LambdaState>()
    const paneB = recorder<LambdaState>()

    paint(reg, a, paneA.view)
    paint(reg, b, paneB.view)

    expect(paneA.frames.at(-1)?.text).toBe('(λx. x) 1')
    expect(paneB.frames.at(-1)?.text).toBe('(λy. y y) 2')
    // Stated as an inequality as well as two equalities: resolving every binding to the source session
    // would make both texts `'(λx. x) 1'`, and this is the line that says so in one sentence rather than
    // leaving it to be inferred from two.
    expect(paneA.frames.at(-1)?.text).not.toBe(paneB.frames.at(-1)?.text)
  })

  // The other half of "simultaneously": one slot moves and the other does not. A slot that kept the
  // session it was built on would pass the test above, whose slots never rebind, and fail here, where
  // `b` is built on the source and then rebound.
  it('follows a rebind, and only the slot that rebound', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['from source'], tm: [0] }))
    reg.add(entry('lambda-only', { label: 'λ only', lambda: ['from the second'] }))

    const a = new PaneSlot('lambda', 'source')
    const b = new PaneSlot('lambda', 'source')
    const paneA = recorder<LambdaState>()
    const paneB = recorder<LambdaState>()

    b.rebind('lambda-only')
    expect(b.binding).toEqual({ session: 'lambda-only', leg: 'lambda' })
    // The leg did NOT move, which is `Binding<K>`'s property surviving the selector — `rebind` takes a
    // `SessionId` and there is no writer for `leg` anywhere.
    expect(a.binding).toEqual({ session: 'source', leg: 'lambda' })

    paint(reg, a, paneA.view)
    paint(reg, b, paneB.view)
    expect(paneA.frames.at(-1)?.text).toBe('from source')
    expect(paneB.frames.at(-1)?.text).toBe('from the second')
  })

  /**
   * **THE SESSION AXIS, WHICH IS THE WHOLE OF WHAT `transport.ts`'s HANDLER DECIDES.**
   *
   * A HANDLER THAT KEPT THE SLOT'S LEG AND DISCARDED THE PICKED ONE would mint `{ leg: 'tm',
   * session: 'lambda-only' }` from a TM pane's pick of the λ-only session — `PaneSlot.render` pushes
   * `reg.pairs()` to EVERY pane, so a TM pane's selector lists it — and `draw.ts`'s per-pane loop calls
   * `slot.resolve` with no `try`/`catch`, so `legOf`'s throw would take the whole render pass: not one
   * dropped frame, but every frame after it.
   *
   * **A CROSS-LEG PICK IS ACTED ON, BUT NOT HERE.** `pane-host.ts`'s `paneEvents.rebind` changes the
   * leaf's kind and `applyLayout` rebuilds the entry on the picked leg. The pick cannot be projected onto
   * this slot's leg, and that is what the throw below pins: a silent decline is an ANSWER, and the wrong
   * one; a throw is this layer stating it does not answer. `new LambdaPane(host, transport.events(slot))`
   * typechecks, so "no caller does this" is a fact worth checking rather than asserting.
   *
   * **THE BEHAVIOUR HALF IS IN THE BROWSER TIER, WHICH IS WHERE IT CAN BE DRIVEN AT ALL.** Replacing the
   * pane needs a layout tree, two pane classes and a DOM, so `tests/browser/pane-kind-switch.test.ts`
   * picks the TM leg on a λ view and asserts the pane follows the pick in place.
   *
   * THE SAME-LEG HALF IS HERE. This is the only test that drives `rebind` through `createTransport`
   * rather than calling `slot.rebind` directly, and the same-leg assertions are the two facts the browser
   * tier can only read through several layers of DOM: the pick moves the binding, and it repaints exactly
   * once. A handler that took the pick and skipped the draw would leave the view showing the session it
   * was on before the pick.
   */
  it('takes the session a same-leg pick names, repaints once, and throws on a cross-leg one', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['from source'], tm: [0] }))
    reg.add(entry('lambda-only', { label: 'λ only', lambda: ['from the second'] }))

    const transport = createTransport({
      sessions: reg,
      // `linkWiring` IS NOT REACHED BY `rebind`, AND ITS CAST SAYS SO RATHER THAN BUILDING A FAKE: a `rebind` that
      // consulted it would fail here loudly, which is the point of not supplying it.
      draw: () => draws++,
      speed: () => 8,
      setSpeed: () => undefined,
      linkWiring: () => ({}) as LinkWiring,
    })
    let draws = 0

    const lambda = new PaneSlot('lambda', 'source')
    transport.events(lambda).rebind({ leg: 'lambda', session: 'lambda-only' })
    expect(lambda.binding).toEqual({ session: 'lambda-only', leg: 'lambda' })
    // RESOLVED, NOT JUST RECORDED — the binding having moved and the binding being usable are two claims.
    expect(lambda.resolve(reg).hist.current?.text).toBe('from the second')
    expect(draws).toBe(1)

    // THE CROSS-LEG PICK, WHICH THIS LAYER REFUSES TO ANSWER. The session half is λ-only, so projecting
    // it onto a TM slot would mint the binding `legOf` dies on.
    const tm = new PaneSlot('tm', 'source')
    expect(() => transport.events(tm).rebind({ leg: 'lambda', session: 'lambda-only' })).toThrow(
      /cannot take a lambda pick/,
    )
    // AND THE SLOT DID NOT MOVE ON THE WAY OUT — a throw AFTER `slot.rebind` would leave exactly the
    // state this exists to prevent, reported rather than avoided. Both halves: the assertion that
    // something did not happen is not the assertion that it was announced.
    expect(tm.binding).toEqual({ session: 'source', leg: 'tm' })
    expect(() => tm.resolve(reg)).not.toThrow()
    // NO DRAW ON THE REFUSED PICK — the count is unchanged from the same-leg one above: the throw is
    // ahead of the handler's `draw()`, and with the slot unmoved there is nothing new to paint.
    expect(draws).toBe(1)
  })

  /**
   * The selector's contents are a function of the registry ALONE, and the pair in force is what ties
   * the list to the slot — so a session added while a pane sits still reaches that pane's selector.
   *
   * **EVERY PAIR, NOT THE SLOT'S OWN LEG.** `PaneSlot.render` pushes `reg.pairs()`, so a TM slot's list
   * carries the λ pairs too, and the pairs that never appear are the ones whose SESSION lacks the leg.
   * `tm-only` below is that distinction under test: a TM-only session adds a TM pair and no λ one.
   */
  it('pushes every (leg, session) pair, marking the one in force', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['a'], tm: [0] }))

    const slot = new PaneSlot('tm', 'source')
    const pane = recorder<TmState>()

    paint(reg, slot, pane.view)
    expect(pane.bindings.at(-1)).toEqual({
      options: [
        { leg: 'lambda', id: 'source', label: 'source' },
        { leg: 'tm', id: 'source', label: 'source' },
      ],
      current: { session: 'source', leg: 'tm' },
    })

    reg.add(entry('tm-only', { label: 'TM only', tm: [7] }))
    paint(reg, slot, pane.view)
    expect(pane.bindings.at(-1)).toEqual({
      options: [
        { leg: 'lambda', id: 'source', label: 'source' },
        { leg: 'tm', id: 'source', label: 'source' },
        { leg: 'tm', id: 'tm-only', label: 'TM only' },
      ],
      current: { session: 'source', leg: 'tm' },
    })
  })

  // `controlState`'s output is the slot's job (so this test and the app share one implementation), so
  // the step readout has to come from the bound leg's own head.
  it('drives the control strip from the leg it resolved, not from a shared head', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['a', 'b', 'c'], tm: [0] }))
    reg.add(entry('lambda-only', { label: 'λ only', lambda: ['z'] }))

    const a = new PaneSlot('lambda', 'source')
    const b = new PaneSlot('lambda', 'lambda-only')
    const paneA = recorder<LambdaState>()
    const paneB = recorder<LambdaState>()

    reg.legOf(a.binding).hist.seek(1)
    paint(reg, a, paneA.view)
    paint(reg, b, paneB.view)

    expect(paneA.controls.at(-1)?.stepText).toBe('step 1 of 2…')
    expect(paneB.controls.at(-1)?.stepText).toBe('step 0 of 0…')
  })
})

describe('resetLegs', () => {
  it('clears every leg the session has, stops its playback and puts its epoch back to 0', () => {
    const e = entry('source', { lambda: ['a', 'b'], tm: [0, 1] })
    const lambdaLeg = e.legs.lambda
    const tmLeg = e.legs.tm
    if (lambdaLeg === undefined || tmLeg === undefined) throw new Error('the fixture built both legs')
    lambdaLeg.done = 'ended'
    lambdaLeg.playing = true
    lambdaLeg.epoch = 2
    tmLeg.epoch = 1

    resetLegs(e.legs, {}, 'not compiled')

    expect(lambdaLeg.hist.length).toBe(0)
    expect(tmLeg.hist.length).toBe(0)
    expect(lambdaLeg.done).toBe(null)
    expect(lambdaLeg.playing).toBe(false)
    expect([lambdaLeg.epoch, tmLeg.epoch]).toEqual([0, 0])
    expect(lambdaLeg.status).toEqual({ available: false, reason: 'not compiled' })
    expect(tmLeg.status).toEqual({ available: false, reason: 'not compiled' })
  })

  /**
   * THE THIRD LEG TOO. A recompile that left the rxm leg's frames would step through a program the editor no longer
   * holds; the loop reads `LEGS`, and this holds it to the rxm leg as well.
   */
  it('clears every leg, rxm included, and gives each the status its reply sent', () => {
    const e = entry('source', { lambda: ['a'], rxm: [0, 1, 2], tm: [0] })
    const rxmLeg = e.legs.rxm
    if (rxmLeg === undefined) throw new Error('the fixture built the rxm leg')
    rxmLeg.done = 'capped'
    rxmLeg.playing = true
    rxmLeg.epoch = 3

    resetLegs(e.legs, { rxm: { available: false, reason: 'lowering failed' } }, 'not compiled')

    expect(rxmLeg.hist.length).toBe(0)
    expect(rxmLeg.done).toBe(null)
    expect(rxmLeg.playing).toBe(false)
    expect(rxmLeg.epoch).toBe(0)
    expect(rxmLeg.status).toEqual({ available: false, reason: 'lowering failed' })
    expect(e.legs.lambda?.status).toEqual({ available: false, reason: 'not compiled' })
  })

  /**
   * A λ-only session has no TM leg to be "not compiled". The caller passes one reply's worth of status whatever the
   * session's shape; dropping the half that has nowhere to go is the whole behaviour, for a λ-only and a TM-only
   * session alike.
   */
  it('drops a status for a leg the session does not have rather than inventing one', () => {
    const lambdaOnly = entry('lambda-only', { lambda: ['a'] })
    const tmOnly = entry('tm-only', { tm: [0] })
    const lambdaLeg = lambdaOnly.legs.lambda
    const tmLeg = tmOnly.legs.tm
    if (lambdaLeg === undefined || tmLeg === undefined) throw new Error('the fixtures built one leg each')

    const lambda = { available: true, reason: 'ok', node: null, run: 'Running' } as const
    const tm = { available: true, reason: 'ok', width: 4, run: 'Running', total_steps: null } as const
    resetLegs(lambdaOnly.legs, { lambda, tm })
    resetLegs(tmOnly.legs, { lambda, tm })

    expect(lambdaOnly.legs.tm).toBeUndefined()
    expect(lambdaLeg.status).toEqual({ available: true, reason: 'ok' })
    expect(lambdaLeg.hist.length).toBe(0)

    expect(tmOnly.legs.lambda).toBeUndefined()
    expect(tmLeg.status).toEqual({ available: true, reason: 'ok' })
    expect(tmLeg.hist.length).toBe(0)
  })
})

describe('SessionRegistry.pairs', () => {
  it('omits the pair a session has no leg for', () => {
    // THE CLAIM: an invalid (leg, session) pair is ABSENT FROM THE LIST rather than rejected when
    // selected. `legOf` throws on a binding naming a missing leg, so a selector that offered
    // (tm, second) would be the one way a user gesture could reach that throw.
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['x'], tm: [0] }))
    reg.add(entry('second', { label: 'second', lambda: ['y'] }))

    expect(reg.pairs()).toEqual([
      { leg: 'lambda', id: 'source', label: 'source' },
      { leg: 'lambda', id: 'second', label: 'second' },
      { leg: 'tm', id: 'source', label: 'source' },
    ])
  })

  it('groups by leg and keeps registration order within each', () => {
    const reg = new SessionRegistry()
    reg.add(entry('a', { label: 'a', lambda: ['x'], tm: [0] }))
    reg.add(entry('b', { label: 'b', lambda: ['y'], tm: [1] }))
    expect(reg.pairs().map((p) => `${p.leg}:${p.id}`)).toEqual(['lambda:a', 'lambda:b', 'tm:a', 'tm:b'])
  })
})

/** A transport over `reg` for its step handlers alone: everything else it is given is inert. */
const stepTransport = (reg: SessionRegistry) =>
  createTransport({
    sessions: reg,
    draw: () => undefined,
    speed: () => 8,
    setSpeed: () => undefined,
    linkWiring: () => ({}) as LinkWiring,
  })

/**
 * **A STEP GESTURE TAKES THE LEG FROM ITS LINK** — Plan 7 part 6a spec §5.4 names five: stepping back, stepping
 * forward, play, restart and continue. Each resolves its leg through `transport.ts`'s `taken`, which deletes
 * `LegState.pending`, so the link neither moves the leg nor continues it again. One case for each, through the
 * production handlers, since a handler that resolved its leg some other way would leave the link's step in force.
 * `tests/browser/share-positions.test.ts` holds the gesture a user makes; this holds that each of the five does it.
 */
describe('a step gesture on a leg with a position pending', () => {
  afterEach(() => vi.unstubAllGlobals())

  const GESTURES = [
    ['back', 'back'],
    ['forward', 'forward'],
    ['play', 'play'],
    ['restart', 'restart'],
    ['continue', 'extend'],
  ] as const

  it.each(GESTURES)('is taken from the link by %s', (_, gesture) => {
    // THE PLAYER SCHEDULES ITS LOOP ON ANIMATION FRAMES, which node has none of, and nothing here runs one.
    vi.stubGlobal('requestAnimationFrame', () => 0)
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['a', 'b', 'c'] }))
    const transport = stepTransport(reg)
    const slot = new PaneSlot('lambda', 'source')
    const lambda = slot.resolve(reg)
    lambda.pending = 3000
    expect(lambda.pending).toBe(3000)
    transport.events(slot)[gesture]()
    expect(lambda.pending).toBeUndefined()
    expect('pending' in lambda).toBe(false)
  })
})

describe('freshLeg', () => {
  /** The ring's budget is `bytes`: three 6-byte frames under 10 keep the newest two, which a larger budget would not. */
  it('builds each leg empty, unplayed, at epoch and generation 0, with a copy of the status given', () => {
    const status = { available: false, reason: 'building…' }
    for (const leg of LEGS) {
      const fresh = freshLeg(leg, 10, status)
      const { done, playing, epoch, gen } = fresh
      expect({ length: fresh.hist.length, done, playing, epoch, gen, status: fresh.status }, leg).toEqual({
        length: 0,
        done: null,
        playing: false,
        epoch: 0,
        gen: 0,
        status,
      })
      expect(fresh.status, leg).not.toBe(status)
    }
    const rxm = freshLeg('rxm', 10, status).hist
    for (const step of [0, 1, 2]) rxm.push(frameOf({ step }), 6)
    expect({ length: rxm.length, evicted: rxm.evicted }).toEqual({ length: 2, evicted: true })
  })
})

describe('rewindLeg', () => {
  it('raises the epoch by one and empties the ring and its end', () => {
    const tm = entry('source', { tm: [0, 1, 2] }).legs.tm
    if (tm === undefined) throw new Error('the fixture built the TM leg')
    tm.done = 'budget'
    tm.epoch = 2

    rewindLeg(tm)

    expect({ epoch: tm.epoch, length: tm.hist.length, done: tm.done }).toEqual({ epoch: 3, length: 0, done: null })
  })

  /**
   * **A REWOUND LEG IS RECORDING FROM STEP 0 UNTIL ITS FIRST FRAMES COME**, where an empty ring with no rewind behind
   * it is a leg nothing has run.
   */
  it('reads as recording from step 0 with its ring empty, where an empty leg at epoch 0 reads not run', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { tm: [0, 1, 2] }))
    reg.add(entry('unrun', { tm: [] }))
    const source = { session: 'source', leg: 'tm' } as const
    const unrun = { session: 'unrun', leg: 'tm' } as const
    const tm = reg.legOf(source)
    tm.done = 'ended'

    rewindLeg(tm)

    const c = legControlState(reg, source, tm)
    expect({ recording: c.recording, stepText: c.stepText }).toEqual({ recording: true, stepText: 'step 0 of 0…' })
    expect(legControlState(reg, unrun, reg.legOf(unrun)).stepText).toBe('not run')
  })
})

/**
 * **A HELD EMPTY RING READS AS IT READ WHEN THE FIRST HOLD BEGAN**, through a hold begun during it, until the listing
 * chosen replaces the line with its first frames: a ring a rewind emptied records from step 0, a recompile claimed
 * meanwhile included, when the leg's frames are no longer the client's generation; a ring a compile emptied is not
 * run, though each hold raises its epoch.
 */
describe('holdClifLeg', () => {
  const setup = () => {
    const port = fakePort()
    const client = new SessionClient(port, () => undefined)
    const clif = legState<ClifState>(true, 1_000_000)
    const reg = new SessionRegistry()
    reg.add({ ...entry('source'), client, legs: { clif } })
    const line = () => legControlState(reg, { session: 'source', leg: 'clif' }, clif).stepText
    /** Claim a run and answer it, as its first reply does, which ends the client's wait. */
    const answered = () => {
      const gen = client.supersede()
      port.deliver({ kind: 'frames', leg: 'clif', gen, epoch: 0, frames: [], done: null })
      return gen
    }
    return { client, clif, line, answered }
  }

  it('keeps a ring a rewind emptied recording from step 0', () => {
    const { client, clif, line, answered } = setup()
    clif.gen = answered()
    rewindLeg(clif)
    expect(line(), 'precondition: the rewound ring reads as recording from step 0').toBe('step 0 of 0…')

    holdClifLeg(clif, undefined)
    expect(line(), 'held').toBe('step 0 of 0…')
    holdClifLeg(clif, undefined)
    expect(line(), 'held again').toBe('step 0 of 0…')
    client.supersede()
    expect(line(), 'a recompile claimed during the hold').toBe('step 0 of 0 — recompiling')
  })

  it('keeps a ring a compile emptied not run', () => {
    const { clif, line, answered } = setup()
    // THE RING HELD THE RUN BEFORE'S FRAMES, and the compile's run has answered with none of its own yet.
    clif.gen = answered()
    answered()
    resetLegs({ clif }, { clif: { available: true, reason: '' } })
    expect(line(), 'precondition: the emptied ring reads not run').toBe('not run')

    holdClifLeg(clif, undefined)
    expect(line(), 'held').toBe('not run')
    holdClifLeg(clif, undefined)
    expect(line(), 'held again').toBe('not run')
  })
})

/**
 * **↺ REWINDS ONLY WHERE STEP 0 WAS DROPPED AND THE WORKER STILL HOLDS THE LEG'S RECORDING**, and seeks everywhere
 * else, where the worker would answer a rewind with nothing the page keeps. Through the production handler, over a
 * client whose posts are kept. Each branch's leg holds six frames of the generation a frames reply answered: `kept` in
 * a ring that holds them all; the rest in one that keeps the newest three. `awaiting` then claims a generation no reply
 * has answered, and `unparsed` one a `no-session` reply answered, which clears `awaitingRun` while the frames stay
 * the generation before.
 */
describe('↺ on a leg', () => {
  const setup = (branch: 'evicted' | 'kept' | 'awaiting' | 'unparsed') => {
    const port = fakePort()
    const client = new SessionClient(port, () => undefined)
    const tm = legState<TmState>(true, branch === 'kept' ? 1_000_000 : 2)
    for (let i = 0; i < 6; i += 1) tm.hist.push(tmFrame(0, i, '_'), 1)
    tm.hist.seek(tm.hist.length - 1)
    tm.done = 'budget'
    const gen = client.supersede()
    port.deliver({ kind: 'frames', leg: 'tm', gen, epoch: 0, frames: [], done: 'budget' })
    tm.gen = gen
    if (branch === 'awaiting') client.supersede()
    if (branch === 'unparsed') port.deliver(noSessionReply(client.supersede()))
    const reg = new SessionRegistry()
    reg.add({ ...entry('source'), client, legs: { tm } })
    const restart = stepTransport(reg).events(new PaneSlot('tm', 'source')).restart
    return { port, client, tm, restart }
  }

  it('rewinds the leg when step 0 was dropped and its frames are the generation the worker holds', () => {
    const { port, tm, restart } = setup('evicted')
    expect(tm.hist.evicted, 'precondition: the ring dropped step 0').toBe(true)

    restart()

    expect(port.sent).toEqual([{ kind: 'rewind', gen: 1, leg: 'tm', epoch: 1 }])
    expect({ epoch: tm.epoch, length: tm.hist.length, done: tm.done }).toEqual({ epoch: 1, length: 0, done: null })
  })

  it('seeks to step 0 and posts nothing while step 0 is kept', () => {
    const { port, tm, restart } = setup('kept')
    expect(tm.hist.evicted, 'precondition: the ring kept step 0').toBe(false)

    restart()

    expect({ head: tm.hist.head, step: tm.hist.currentStep, length: tm.hist.length }).toEqual({
      head: 0,
      step: 0,
      length: 6,
    })
    expect({ sent: port.sent, epoch: tm.epoch, done: tm.done }).toEqual({ sent: [], epoch: 0, done: 'budget' })
  })

  it.each([
    ['awaiting', 'a recompile no reply has answered', true],
    ['unparsed', 'an edit the worker answered with no session', false],
  ] as const)('seeks as far back as the ring keeps and posts nothing while %s: %s', (branch, _, awaiting) => {
    const { port, client, tm, restart } = setup(branch)
    expect(
      { evicted: tm.hist.evicted, awaitingRun: client.awaitingRun, behind: tm.gen < client.gen },
      'precondition: step 0 was dropped, and the frames are a generation behind the client',
    ).toEqual({ evicted: true, awaitingRun: awaiting, behind: true })

    restart()

    expect({ head: tm.hist.head, step: tm.hist.currentStep, length: tm.hist.length }).toEqual({
      head: 0,
      step: 3,
      length: 3,
    })
    expect({ sent: port.sent, epoch: tm.epoch, done: tm.done }).toEqual({ sent: [], epoch: 0, done: 'budget' })
  })
})
