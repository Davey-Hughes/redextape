import { describe, expect, it } from 'vitest'
import type { ControlState } from '../../src/controls'
import { History } from '../../src/history'
import type { RunReply, RunRequest } from '../../src/protocol'
import type { ClientPort, SessionId } from '../../src/session-client'
import { SessionClient } from '../../src/session-client'
import type { BindingOption, LegState, PaneView, SessionEntry } from '../../src/sessions'
import { PaneSlot, resetLegs, SessionRegistry } from '../../src/sessions'
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
  return { id, label: opts.label ?? id, detached: opts.detached ?? false, client: fakeClient(), legs }
}

/** A `PaneView` that records every call instead of touching a DOM. */
function recorder<T>() {
  const frames: (T | null)[] = []
  const controls: ControlState[] = []
  const bindings: { options: BindingOption[]; current: SessionId }[] = []
  const detached: boolean[] = []
  const view: PaneView<T> = {
    render: (frame, c) => {
      frames.push(frame)
      controls.push(c)
    },
    setBindings: (options, current) => bindings.push({ options, current }),
    setDetached: (d) => detached.push(d),
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

  // The selector's contents are a function of the registry AND of the slot's leg, and both are read
  // on the render path — so a session added while a pane sits still reaches that pane's selector.
  it('pushes the options for its own leg, marking the session in force', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['a'], tm: [0] }))

    const slot = new PaneSlot('tm', 'source')
    const pane = recorder<TmState>()

    paintTm(reg, slot, pane.view)
    expect(pane.bindings.at(-1)).toEqual({ options: [{ id: 'source', label: 'source' }], current: 'source' })

    reg.add(entry('tm-scratch', { label: 'TM scratchpad', detached: true, tm: [7] }))
    paintTm(reg, slot, pane.view)
    expect(pane.bindings.at(-1)).toEqual({
      options: [
        { id: 'source', label: 'source' },
        { id: 'tm-scratch', label: 'TM scratchpad' },
      ],
      current: 'source',
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
