import { describe, expect, it } from 'vitest'
import type { ControlState } from '../../src/controls'
import { History } from '../../src/history'
import type { LinkWiring } from '../../src/link-wiring'
import type { Leg, RunReply, RunRequest } from '../../src/protocol'
import type { LambdaScratchpad } from '../../src/scratch'
import type { ClientPort, SessionId } from '../../src/session-client'
import { SessionClient } from '../../src/session-client'
import type { Binding, LegState, PaneOption, PaneView, SessionEntry } from '../../src/sessions'
import { PaneSlot, resetLegs, SessionRegistry } from '../../src/sessions'
import { createTransport } from '../../src/transport'
import type { LambdaState, TmState } from '../../src/types'

/**
 * THE BINDING MODEL, DRIVEN WITHOUT A BROWSER — plan T7's claim at the level where it is decided.
 *
 * The claim is that two panes bound to two DIFFERENT λ sessions render two different terms
 * simultaneously, and the plan is explicit that "anything weaker passes on a single-session
 * implementation". `tests/browser/binding-selector.test.ts` asserts the same thing with real
 * `LambdaPane`s and real text in a real DOM; this file asserts it against the resolution itself, with
 * recording fakes, which is what makes the failure legible when it breaks — a browser failure says
 * "two panes read the same string", this one says which binding resolved to which leg.
 *
 * NEITHER TIER DRIVES THE APP, AND THAT IS A FINDING RATHER THAN A SHORTCUT. `main.ts` registers
 * exactly one session and nothing in this slice can add a second: a `LambdaScratch` session needs a
 * worker message `session-worker.ts` does not have, and creating one by editing a source-derived λ
 * view is design §4.3, which is T8. So an app-level two-λ-sessions test has nothing to bind to. The
 * production path is shared instead of re-implemented: `main.ts`'s `draw()` calls exactly
 * `slot.resolve(reg)` and `slot.render(reg, pane, leg)`, which is what the `it`s below call.
 *
 * **T8 SHIPPED THE MESSAGE AND THE FINDING SURVIVED IT, NARROWED.** The app registers a second session
 * now (`tests/browser/scratch-app.test.ts` clicks the control that does it), so "nothing in this slice
 * can add a second" is history. Two λ PANES is what it still cannot reach — there is one — so the
 * registry below is still built here and for the same reason.
 */

/** A `ClientPort` with no thread behind it — `SessionEntry` needs a client and no test here posts. */
function fakeClient(): SessionClient {
  const port: ClientPort = {
    postMessage: (_m: RunRequest) => undefined,
    addEventListener: (_t: 'message', _h: (e: { data: RunReply }) => void) => undefined,
  }
  return new SessionClient(port, () => undefined)
}

function leg<T>(): LegState<T> {
  return { hist: new History<T>(1_000_000), status: { available: true, reason: '' }, done: null, timer: null }
}

/** A λ frame whose only distinguishing feature is its text — which is the whole discriminator here. */
const lambdaFrame = (text: string, step = 0): LambdaState => ({
  text,
  spans: [],
  cut: null,
  step,
  redex_span: null,
  owner: 'None',
})

const tmFrame = (state: number): TmState => ({
  state,
  step: 0,
  heads: [0],
  window_start: [0],
  window: [['_']],
  source_node: null,
  rule: null,
})

/**
 * One session, its legs seeded with the frames given.
 *
 * A LEG IS OMITTED WHEN ITS ARGUMENT IS, WHICH IS THE POINT rather than convenience: §4.1's scratch
 * types have one leg apiece, and this task is the one that made `SessionLegs` optional so a registry
 * can hold them. A helper that always built both would make every assertion below about `options`
 * vacuous.
 */
function entry(
  id: SessionId,
  opts: { label?: string; detached?: boolean; lambda?: string[]; tm?: number[] } = {},
): SessionEntry {
  const legs: { lambda?: LegState<LambdaState>; tm?: LegState<TmState> } = {}
  if (opts.lambda !== undefined) {
    const l = leg<LambdaState>()
    for (const [i, text] of opts.lambda.entries()) l.hist.push(lambdaFrame(text, i), 1)
    legs.lambda = l
  }
  if (opts.tm !== undefined) {
    const t = leg<TmState>()
    for (const s of opts.tm) t.hist.push(tmFrame(s), 1)
    legs.tm = t
  }
  // NO MACHINE ON ANY OF THEM. `SessionEntry.tmProgram` is retained from a `compiled` reply, and this
  // file drives the binding model rather than the reply switch — `tests/node/replies.test.ts` is where
  // the retention itself is asserted.
  return { id, label: opts.label ?? id, detached: opts.detached ?? false, client: fakeClient(), legs, tmProgram: null }
}

/** A `PaneView` that records every call instead of touching a DOM. */
function recorder<T>() {
  const frames: (T | null)[] = []
  const controls: ControlState[] = []
  const bindings: { options: PaneOption[]; current: Binding<Leg> }[] = []
  const detached: boolean[] = []
  const view: PaneView<T> = {
    render: (frame, c) => {
      frames.push(frame)
      controls.push(c)
    },
    setBindings: (options, current) => bindings.push({ options, current }),
    setDetached: (d) => detached.push(d),
    setLayoutControls: (_canClose, _canSplit) => {},
  }
  return { view, frames, controls, bindings, detached }
}

/**
 * `main.ts`'s `draw()`, for one slot: resolve once, then paint from what was resolved.
 *
 * TWO MONOMORPHIC HELPERS RATHER THAN ONE GENERIC IN `K`, mirroring `draw()`, which also has exactly
 * two call sites and no loop over legs. A helper generic over `K` needs the correlation between the
 * leg's frame type and the pane's frame type — which is what `PaneSlot.render`'s own signature
 * carries — restated in the helper, and the only spellings that compile go through `any`. Two lines
 * are cheaper than a cast, and they are the two lines the app actually runs.
 */
const paintLambda = (reg: SessionRegistry, slot: PaneSlot<'lambda'>, pane: PaneView<LambdaState>) =>
  slot.render(reg, pane, slot.resolve(reg))

const paintTm = (reg: SessionRegistry, slot: PaneSlot<'tm'>, pane: PaneView<TmState>) =>
  slot.render(reg, pane, slot.resolve(reg))

describe('SessionRegistry', () => {
  it('throws for a session it does not hold rather than answering with nothing', () => {
    const reg = new SessionRegistry()
    expect(reg.size).toBe(0)
    expect(reg.has('source')).toBe(false)
    expect(() => reg.entryOf('source')).toThrow(/not in the registry: source/)
    expect(() => reg.legOf({ session: 'source', leg: 'lambda' })).toThrow(/not in the registry/)
  })

  it('throws for a leg the session does not have', () => {
    const reg = new SessionRegistry()
    reg.add(entry('lambda-scratch', { lambda: ['x'] }))
    expect(reg.legOf({ session: 'lambda-scratch', leg: 'lambda' }).hist.length).toBe(1)
    expect(() => reg.legOf({ session: 'lambda-scratch', leg: 'tm' })).toThrow(/has no tm leg/)
  })

  // `SessionPool.bind`'s asymmetry, mirrored: a second `add` asks for something unhonourable (the
  // replaced entry's play timer would be stranded on a `LegState` nothing can reach), a second
  // `remove` asks for a state already true.
  it('refuses a duplicate add and tolerates a duplicate remove', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { lambda: ['a'], tm: [0] }))
    expect(() => reg.add(entry('source', { lambda: ['b'] }))).toThrow(/already in the registry: source/)
    expect(reg.legOf({ session: 'source', leg: 'lambda' }).hist.current?.text).toBe('a')

    reg.remove('source')
    reg.remove('source')
    expect(reg.size).toBe(0)
  })

  /**
   * "THE SOURCE SESSION OFFERS source/λ/TM; A `LambdaScratch` OFFERS ONLY λ; A `TmScratch` ONLY TM"
   * (plan T7) — asserted as the filter it is, which is also the whole content of what a selector may
   * put in front of a user. A slot showing λ must never be offered a session with no λ leg, because
   * `legOf` throws on one, and these two facts are the same fact read from two sides.
   */
  it('offers a leg only the sessions that have it, in registration order', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['a'], tm: [0] }))
    reg.add(entry('lambda-scratch', { label: 'λ scratchpad', detached: true, lambda: ['b'] }))
    reg.add(entry('tm-scratch', { label: 'TM scratchpad', detached: true, tm: [1] }))

    expect(reg.options('lambda')).toEqual([
      { id: 'source', label: 'source' },
      { id: 'lambda-scratch', label: 'λ scratchpad' },
    ])
    expect(reg.options('tm')).toEqual([
      { id: 'source', label: 'source' },
      { id: 'tm-scratch', label: 'TM scratchpad' },
    ])
  })
})

describe('PaneSlot', () => {
  /**
   * THE TEST PLAN T7 NAMES, at the level the binding is resolved. Two slots, two λ sessions, painted
   * in the same pass and asserted TOGETHER — a sequential "bind, check, rebind, check" would pass on
   * an implementation with one session and a mutable global, which is precisely what the plan means
   * by "anything weaker".
   *
   * THE FRAMES ARE DIFFERENT STRINGS ON PURPOSE, the same discriminator `pool-isolation.test.ts` uses
   * for three sessions' answers: identical terms would render identically even if both slots resolved
   * to one leg, so the value has to be the assertion and not the shape.
   */
  it('renders two different λ sessions into two panes at the same time', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['(λx. x) 1'], tm: [0] }))
    reg.add(entry('lambda-scratch', { label: 'λ scratchpad', detached: true, lambda: ['(λy. y y) 2'] }))

    const a = new PaneSlot('lambda', 'source')
    const b = new PaneSlot('lambda', 'lambda-scratch')
    const paneA = recorder<LambdaState>()
    const paneB = recorder<LambdaState>()

    paintLambda(reg, a, paneA.view)
    paintLambda(reg, b, paneB.view)

    expect(paneA.frames.at(-1)?.text).toBe('(λx. x) 1')
    expect(paneB.frames.at(-1)?.text).toBe('(λy. y y) 2')
    // Stated as an inequality as well as two equalities: the mutation this task runs — resolving every
    // binding to the source session — makes both texts `'(λx. x) 1'`, and this is the line that says
    // so in one sentence rather than leaving it to be inferred from two.
    expect(paneA.frames.at(-1)?.text).not.toBe(paneB.frames.at(-1)?.text)
  })

  // The other half of "simultaneously": one slot moves and the other does not. A `draw()` that
  // repainted every pane from one resolved leg would pass the test above on the FIRST paint and fail
  // here on the second.
  it('follows a rebind, and only the slot that rebound', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['from source'], tm: [0] }))
    reg.add(entry('lambda-scratch', { label: 'λ scratchpad', detached: true, lambda: ['from scratch'] }))

    const a = new PaneSlot('lambda', 'source')
    const b = new PaneSlot('lambda', 'source')
    const paneA = recorder<LambdaState>()
    const paneB = recorder<LambdaState>()

    b.rebind('lambda-scratch')
    expect(b.binding).toEqual({ session: 'lambda-scratch', leg: 'lambda' })
    // The leg did NOT move, which is `Binding<K>`'s property surviving the selector — `rebind` takes a
    // `SessionId` and there is no writer for `leg` anywhere.
    expect(a.binding).toEqual({ session: 'source', leg: 'lambda' })

    paintLambda(reg, a, paneA.view)
    paintLambda(reg, b, paneB.view)
    expect(paneA.frames.at(-1)?.text).toBe('from source')
    expect(paneB.frames.at(-1)?.text).toBe('from scratch')
  })

  /**
   * **THE SESSION AXIS, WHICH IS THE WHOLE OF WHAT `transport.ts`'s HANDLER DECIDES — and this test used
   * to assert one more thing, which moved.**
   *
   * It was written for a Critical, found in review of the commit that widened the selector to
   * `(leg, session)` pairs. The chain, all four links live: `PaneSlot.render` pushes `reg.pairs()` to
   * EVERY pane, so a TM pane's selector listed the λ-only scratch; `transport.ts`'s handler kept the
   * slot's leg and discarded the picked one, minting `{ leg: 'tm', session: 'lambda-scratch' }`; and
   * `draw.ts`'s per-pane loop calls `slot.resolve` with no `try`/`catch`, so `legOf`'s throw took the
   * whole render pass — not one dropped frame, but every frame after it. Three clicks from a fresh page:
   * compile, fork the λ pane, then pick `λ scratchpad` on the TM pane's selector. The fix was a guard in
   * that handler, and this test asserted the refusal: the slot unmoved, and — the assertion the render
   * loop was implicitly making — the binding still resolving.
   *
   * **THE REFUSAL BECAME A THROW, AND WHAT IT MEANS MOVED WITH IT.** A cross-leg pick is ACTED ON now:
   * `pane-host.ts`'s `paneEvents.rebind` changes the leaf's kind and `applyLayout` rebuilds the entry on
   * the picked leg. So "ignored" is no longer the app's answer and this test no longer asserts it — but
   * the pick still cannot be projected onto this slot's leg, and that is what the throw below pins. The
   * distinction is the whole of why the comparison came back after one commit without it: a silent
   * decline is an ANSWER, and the wrong one now; a throw is this layer stating it does not answer.
   * `new LambdaPane(host, transport.events(slot))` typechecks, and `scratch-fork.test.ts` writes that
   * shape twice with hand-built events, so "no caller does this" is a fact worth checking rather than
   * asserting.
   *
   * **THE BEHAVIOUR HALF MOVED TO THE BROWSER TIER, WHICH IS WHERE IT CAN BE DRIVEN AT ALL.** The
   * replacement needs a layout tree, two pane classes and a DOM, so `tests/browser/pane-kind-switch.test.ts`
   * drives the Critical's own three clicks — compile, fork, pick the λ-only scratch on the TM pane — and
   * asserts the pane follows the pick AND keeps painting afterwards, the second half being `legOf` not
   * throwing on a LATER frame, which was the Critical's actual signature.
   *
   * WHAT IS LEFT HERE IS NOT PADDING. This is still the only test that drives `rebind` through
   * `createTransport` rather than calling `slot.rebind` directly, and the same-leg assertions are the
   * two facts the browser tier can only read through several layers of DOM: the pick moves the binding,
   * and it repaints exactly once. A handler that took the pick and skipped the draw would leave the
   * `<select>` naming a pair the pane is not showing.
   */
  it('takes the session a same-leg pick names, repaints once, and throws on a cross-leg one', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['from source'], tm: [0] }))
    reg.add(entry('lambda-scratch', { label: 'λ scratchpad', detached: true, lambda: ['from scratch'] }))

    const transport = createTransport({
      sessions: reg,
      // NEITHER IS REACHED BY `rebind`, AND THE CASTS SAY SO RATHER THAN BUILDING TWO FAKES. The
      // scratchpad is touched only by `detach`/`editScratch` and `linkWiring` only by
      // `detach`/`linkState`/`linkLambda`; a `rebind` that consulted either would fail here loudly,
      // which is the point of not supplying them.
      scratchpad: {} as LambdaScratchpad,
      draw: () => draws++,
      linkWiring: () => ({}) as LinkWiring,
    })
    let draws = 0

    const lambda = new PaneSlot('lambda', 'source')
    transport.events(lambda).rebind({ leg: 'lambda', session: 'lambda-scratch' })
    expect(lambda.binding).toEqual({ session: 'lambda-scratch', leg: 'lambda' })
    // RESOLVED, NOT JUST RECORDED — the binding having moved and the binding being usable are two
    // claims, and it was the second one the Critical broke.
    expect(lambda.resolve(reg).hist.current?.text).toBe('from scratch')
    expect(draws).toBe(1)

    // THE CROSS-LEG PICK, WHICH THIS LAYER REFUSES TO ANSWER. The exact pick that produced the
    // Critical: the session half is λ-only, so projecting it onto a TM slot mints the binding `legOf`
    // dies on.
    const tm = new PaneSlot('tm', 'source')
    expect(() => transport.events(tm).rebind({ leg: 'lambda', session: 'lambda-scratch' })).toThrow(
      /cannot take a lambda pick/,
    )
    // AND THE SLOT DID NOT MOVE ON THE WAY OUT — a throw AFTER `slot.rebind` would leave exactly the
    // state this exists to prevent, reported rather than avoided. Both halves, for `detached-badge`'s
    // reason: the assertion that something did not happen is not the assertion that it was announced.
    expect(tm.binding).toEqual({ session: 'source', leg: 'tm' })
    expect(() => tm.resolve(reg)).not.toThrow()
    // NO DRAW ON THE REFUSED PICK — the count is unchanged from the same-leg one above. The `<select>`
    // is left showing the pick, which is correct here and is NOT the "a refused pick still paints"
    // rule the old guard followed: that rule was for a decline a user could reach, and this is a
    // wiring bug no user can.
    expect(draws).toBe(1)
  })

  /**
   * §5's JOINT DETACHMENT CASE, WHICH THE DESIGN OWED TO "THE TASK THAT WIRES `main.ts`". Its words:
   * "bind a pane to a scratch, see both, rebind, see neither — CANNOT be written in this slice ... It
   * needs a binding to flip, and per §3.2b none exists." A binding exists now, and it flips here.
   *
   * ASSERTED ABSENT AFTER THE REBIND, not only present before it — an implementation that sets the
   * badge and never clears it passes the first half. That is the same rule `detached-badge.test.ts`
   * states for the surface itself; this is the rule applied to what DRIVES it.
   */
  it('reports detachment from the session it is bound to, and stops when rebound', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['a'], tm: [0] }))
    reg.add(entry('lambda-scratch', { label: 'λ scratchpad', detached: true, lambda: ['b'] }))

    const slot = new PaneSlot('lambda', 'lambda-scratch')
    const pane = recorder<LambdaState>()

    paintLambda(reg, slot, pane.view)
    expect(pane.detached.at(-1)).toBe(true)

    slot.rebind('source')
    paintLambda(reg, slot, pane.view)
    expect(pane.detached.at(-1)).toBe(false)
  })

  /**
   * The selector's contents are a function of the registry ALONE now, and the pair in force is what
   * ties the list to the slot — so a session added while a pane sits still reaches that pane's
   * selector.
   *
   * **EVERY PAIR, NOT THE SLOT'S OWN LEG, AND THAT REVERSES WHAT THIS TEST USED TO ASSERT.** It was
   * "pushes the options for its own leg, marking the session in force", and it pinned
   * `reg.options(b.leg)` — a list that could never mention the other leg. `PaneSlot.render` pushes
   * `reg.pairs()` now, so a TM slot's list carries the λ pairs too, and the pairs that never appear
   * are the ones whose SESSION lacks the leg. `tm-scratch` below is that distinction under test: a
   * TM-only session adds a TM pair and no λ one.
   */
  it('pushes every (leg, session) pair, marking the one in force', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['a'], tm: [0] }))

    const slot = new PaneSlot('tm', 'source')
    const pane = recorder<TmState>()

    paintTm(reg, slot, pane.view)
    expect(pane.bindings.at(-1)).toEqual({
      options: [
        { leg: 'lambda', id: 'source', label: 'source' },
        { leg: 'tm', id: 'source', label: 'source' },
      ],
      current: { session: 'source', leg: 'tm' },
    })

    reg.add(entry('tm-scratch', { label: 'TM scratchpad', detached: true, tm: [7] }))
    paintTm(reg, slot, pane.view)
    expect(pane.bindings.at(-1)).toEqual({
      options: [
        { leg: 'lambda', id: 'source', label: 'source' },
        { leg: 'tm', id: 'source', label: 'source' },
        { leg: 'tm', id: 'tm-scratch', label: 'TM scratchpad' },
      ],
      current: { session: 'source', leg: 'tm' },
    })
  })

  // `controlState`'s output is the slot's job now (it moved out of `draw()` so this test and the app
  // share one implementation), so the step readout has to come from the bound leg's own head.
  it('drives the control strip from the leg it resolved, not from a shared head', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['a', 'b', 'c'], tm: [0] }))
    reg.add(entry('lambda-scratch', { label: 'λ scratchpad', detached: true, lambda: ['z'] }))

    const a = new PaneSlot('lambda', 'source')
    const b = new PaneSlot('lambda', 'lambda-scratch')
    const paneA = recorder<LambdaState>()
    const paneB = recorder<LambdaState>()

    reg.legOf(a.binding).hist.seek(1)
    paintLambda(reg, a, paneA.view)
    paintLambda(reg, b, paneB.view)

    expect(paneA.controls.at(-1)?.stepText).toBe('step 1 of 2…')
    expect(paneB.controls.at(-1)?.stepText).toBe('step 0 of 0…')
  })
})

describe('resetLegs', () => {
  it('clears every leg the session has and stops its playback', () => {
    const e = entry('source', { lambda: ['a', 'b'], tm: [0, 1] })
    const lambdaLeg = e.legs.lambda
    const tmLeg = e.legs.tm
    if (lambdaLeg === undefined || tmLeg === undefined) throw new Error('the fixture built both legs')
    lambdaLeg.done = 'ended'
    lambdaLeg.timer = setInterval(() => undefined, 1_000)

    resetLegs(e.legs, null, null, 'not compiled')

    expect(lambdaLeg.hist.length).toBe(0)
    expect(tmLeg.hist.length).toBe(0)
    expect(lambdaLeg.done).toBe(null)
    expect(lambdaLeg.timer).toBe(null)
    expect(lambdaLeg.status).toEqual({ available: false, reason: 'not compiled' })
    expect(tmLeg.status).toEqual({ available: false, reason: 'not compiled' })
  })

  /**
   * A `LambdaScratch` has no TM leg to be "not compiled", and writing one so the record is square is
   * the shape `session.rs:257-273` records the cost of. The caller passes one reply's worth of status
   * whatever the session's shape; dropping the half that has nowhere to go is the whole behaviour.
   *
   * BOTH ONE-LEGGED SHAPES, NOT JUST THE λ ONE. §4.1 has two scratch types and this function has two
   * independent guards; testing one leaves the other's absent-arm unexercised, which is the direction
   * a coverage number will not report as missing because the function is called.
   */
  it('drops a status for a leg the session does not have rather than inventing one', () => {
    const lambdaOnly = entry('lambda-scratch', { lambda: ['a'] })
    const tmOnly = entry('tm-scratch', { tm: [0] })
    const lambdaLeg = lambdaOnly.legs.lambda
    const tmLeg = tmOnly.legs.tm
    if (lambdaLeg === undefined || tmLeg === undefined) throw new Error('the fixtures built one leg each')

    const lambda = { available: true, reason: 'ok', node: null, run: 'Running' } as const
    const tm = { available: true, reason: 'ok', width: 4, run: 'Running', total_steps: null } as const
    resetLegs(lambdaOnly.legs, lambda, tm)
    resetLegs(tmOnly.legs, lambda, tm)

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
    // (tm, scratch) would be the one way a user gesture could reach that throw.
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['x'], tm: [0] }))
    reg.add(entry('scratch-1', { label: 'scratch 1', detached: true, lambda: ['y'] }))

    expect(reg.pairs()).toEqual([
      { leg: 'lambda', id: 'source', label: 'source' },
      { leg: 'lambda', id: 'scratch-1', label: 'scratch 1' },
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
