import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControlState } from '../../src/controls'
import type { KeymapSetting } from '../../src/editor-keymap'
import type { LinkWiring } from '../../src/link-wiring'
import type { Leg } from '../../src/protocol'
import { BufferCapReached, MAX_WARM_BUFFERS, type ScratchBuffers } from '../../src/scratch'
import type { SessionId } from '../../src/session-client'
import type { Binding, LegState, PaneOption, PaneView, SessionEntry } from '../../src/sessions'
import { PaneSlot, resetLegs, SessionRegistry } from '../../src/sessions'
import { createTransport } from '../../src/transport'
import type { AsmState, LambdaState, TmProgram, TmState } from '../../src/types'
import { frameOf } from './asm-fixtures'
import { legState } from './leg-fixture'
import { fakeClient, lambdaFrame, paint } from './session-fixtures'
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
 * A LEG IS OMITTED WHEN ITS ARGUMENT IS, WHICH IS THE POINT rather than convenience: §4.1's scratch
 * types have one leg apiece, and `SessionLegs` is optional so a registry can hold them. A helper that
 * always built every leg would make every assertion below about `options` vacuous.
 */
function entry(
  id: SessionId,
  opts: { label?: string; detached?: boolean; lambda?: string[]; asm?: number[]; tm?: number[] } = {},
): SessionEntry {
  const legs: { lambda?: LegState<LambdaState>; asm?: LegState<AsmState>; tm?: LegState<TmState> } = {}
  if (opts.lambda !== undefined) {
    const l = legState<LambdaState>(true, 1_000_000)
    for (const [i, text] of opts.lambda.entries()) l.hist.push(lambdaFrame(text, i), 1)
    legs.lambda = l
  }
  if (opts.asm !== undefined) {
    const a = legState<AsmState>(true, 1_000_000)
    for (const [i, pc] of opts.asm.entries()) a.hist.push(frameOf({ step: i, pc }), 1)
    legs.asm = a
  }
  if (opts.tm !== undefined) {
    const t = legState<TmState>(true, 1_000_000)
    for (const s of opts.tm) t.hist.push(tmFrame(s, 0, '_'), 1)
    legs.tm = t
  }
  // NO MACHINE ON ANY OF THEM. `SessionEntry.tmProgram` is retained from a `compiled` reply, and this
  // file drives the binding model rather than the reply switch — `tests/node/replies.test.ts` is where
  // the retention itself is asserted.
  return {
    id,
    label: opts.label ?? id,
    detached: opts.detached ?? false,
    client: fakeClient(),
    legs,
    tmProgram: null,
    tmScratch: null,
    asmProgram: null,
    asmScratch: null,
  }
}

/** A `PaneView` that records its render, binding and detached calls instead of touching a DOM. */
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
    setStepsShown: (_shown) => {},
  }
  return { view, frames, controls, bindings, detached }
}

/**
 * Inert language-server handle for the transport fixtures below, which drive stepping and binding
 * rather than language features. ONE stub rather than one per fixture: a widened `lspClient` type
 * would otherwise have to be found and widened in every copy by hand.
 */
const LSP_STUB = {
  openDocument() {},
  changeDocument() {},
  closeDocument() {},
  format: async () => [],
  documentSymbols: async () => [],
  definition: async () => null,
  references: async () => [],
  hover: async () => null,
}

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
  // replaced entry's playback would be stranded on a `LegState` nothing can reach), a second
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
   * (5d-i decision 1, in the words of 5d-i's plan, T7) — asserted as the filter it is, which is also
   * the whole content of what a selector may put in front of a user. A slot showing λ must never be
   * offered a session with no λ leg, because `legOf` throws on one, and these two facts are the same
   * fact read from two sides.
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
    reg.add(entry('lambda-scratch', { label: 'λ scratchpad', detached: true, lambda: ['(λy. y y) 2'] }))

    const a = new PaneSlot('lambda', 'source')
    const b = new PaneSlot('lambda', 'lambda-scratch')
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

    paint(reg, a, paneA.view)
    paint(reg, b, paneB.view)
    expect(paneA.frames.at(-1)?.text).toBe('from source')
    expect(paneB.frames.at(-1)?.text).toBe('from scratch')
  })

  /**
   * **THE SESSION AXIS, WHICH IS THE WHOLE OF WHAT `transport.ts`'s HANDLER DECIDES.**
   *
   * A HANDLER THAT KEPT THE SLOT'S LEG AND DISCARDED THE PICKED ONE would mint `{ leg: 'tm',
   * session: 'lambda-scratch' }` from a TM pane's pick of the λ-only scratch — `PaneSlot.render` pushes
   * `reg.pairs()` to EVERY pane, so a TM pane's selector lists it — and `draw.ts`'s per-pane loop calls
   * `slot.resolve` with no `try`/`catch`, so `legOf`'s throw would take the whole render pass: not one
   * dropped frame, but every frame after it.
   *
   * **A CROSS-LEG PICK IS ACTED ON, BUT NOT HERE.** `pane-host.ts`'s `paneEvents.rebind` changes the
   * leaf's kind and `applyLayout` rebuilds the entry on the picked leg. The pick cannot be projected onto
   * this slot's leg, and that is what the throw below pins: a silent decline is an ANSWER, and the wrong
   * one; a throw is this layer stating it does not answer. `new LambdaPane(host, transport.events(slot))`
   * typechecks, and `scratch-fork.test.ts` writes that shape twice with hand-built events, so "no caller
   * does this" is a fact worth checking rather than asserting.
   *
   * **THE BEHAVIOUR HALF IS IN THE BROWSER TIER, WHICH IS WHERE IT CAN BE DRIVEN AT ALL.** Replacing the
   * pane needs a layout tree, two pane classes and a DOM, so `tests/browser/pane-kind-switch.test.ts`
   * drives three clicks — compile, fork, pick the λ-only scratch on the TM pane — and asserts the pane
   * follows the pick AND keeps painting afterwards, the second half being `legOf` not throwing on a
   * LATER frame.
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
    reg.add(entry('lambda-scratch', { label: 'λ scratchpad', detached: true, lambda: ['from scratch'] }))

    const transport = createTransport({
      sessions: reg,
      // NEITHER `scratchpad` NOR `linkWiring` IS REACHED BY `rebind`, AND THEIR CASTS SAY SO RATHER THAN
      // BUILDING TWO FAKES: a `rebind` that consulted either would fail here loudly, which is the point of
      // not supplying them.
      scratchpad: {} as ScratchBuffers,
      draw: () => draws++,
      speed: () => 8,
      setSpeed: () => undefined,
      // Inert: these fixtures drive stepping and binding, neither language features nor colour.
      lspClient: LSP_STUB,
      colour: () => [],
      formatOnBlur: () => false,
      // NEVER REACHED, AND A CAST FOR `scratchpad`'s REASON: a keymap setting is joined by an EDITOR,
      // and no fixture in this file builds one.
      keymap: {} as KeymapSetting,
      linkWiring: () => ({}) as LinkWiring,
      notify: () => undefined,
      // A THROW RATHER THAN A NO-OP, FOR THE SAME REASON THE CASTS ABOVE ARE CASTS: only a fork
      // announces a new buffer, and a `rebind` that told the header list its count had changed would be
      // reporting a gesture that creates nothing. This test would say so.
      onBuffersChanged: () => {
        throw new Error('a rebind must not report a change to the buffer count')
      },
      // COUNTED WHERE `onBuffersChanged` THROWS, AND THE PAIR IS THE WHOLE DISTINCTION THE SECOND
      // DEPENDENCY EXISTS FOR: a rebind changes no buffer and therefore no COUNT, while the stored
      // `bindings` map is exactly what it does change. One of these two must fire and the other must not,
      // and only asserting both says so.
      onBuffersPersist: () => persists++,
    })
    let draws = 0
    let persists = 0

    const lambda = new PaneSlot('lambda', 'source')
    transport.events(lambda).rebind({ leg: 'lambda', session: 'lambda-scratch' })
    expect(lambda.binding).toEqual({ session: 'lambda-scratch', leg: 'lambda' })
    // RESOLVED, NOT JUST RECORDED — the binding having moved and the binding being usable are two claims.
    expect(lambda.resolve(reg).hist.current?.text).toBe('from scratch')
    expect(draws).toBe(1)
    // THE STORED BINDINGS FOLLOWED THE SLOT. `main.ts`'s `persistBuffers` reads them off `panes.all()`
    // at write time, so a rebind that moved the slot without asking for a write would leave
    // `localStorage` naming the session this pane was on BEFORE the pick — and the next reload would
    // undo the gesture with nothing on screen to say so.
    expect(persists).toBe(1)

    // THE CROSS-LEG PICK, WHICH THIS LAYER REFUSES TO ANSWER. The session half is λ-only, so projecting
    // it onto a TM slot would mint the binding `legOf` dies on.
    const tm = new PaneSlot('tm', 'source')
    expect(() => transport.events(tm).rebind({ leg: 'lambda', session: 'lambda-scratch' })).toThrow(
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
    // AND NO WRITE ON THE REFUSED PICK EITHER, for the reason the slot did not move: the throw is
    // ahead of `slot.rebind`, so there is nothing new to record and a write here would persist the
    // state a wiring bug tried to reach.
    expect(persists).toBe(1)
  })

  /**
   * **THE `catch` AROUND THE FORK LETS A WIRING BUG THROUGH AND KEEPS A REFUSAL.**
   *
   * `detach` is the last frame before the raw DOM dispatch of `✎ edit a copy`'s click listener, and there is no
   * `window` error handler anywhere in `src/` behind it. That is what makes the catch necessary — a cap
   * refusal would otherwise reach the console and nothing else — and it is also exactly what makes the
   * `instanceof` load-bearing: a BARE catch would take `SessionRegistry.add`'s and
   * `SessionPool.bind`'s invariant guards, which are wiring bugs, and show them as a notice
   * that says `cannot make a copy — …`. The bug would look like a refusal, and the user would be told to
   * pause or delete a copy.
   *
   * **BOTH ARMS IN ONE TEST, BECAUSE EITHER ALONE PASSES ON THE WRONG IMPLEMENTATION.** A bare `catch`
   * satisfies the cap half; `throw e` with no catch at all satisfies the re-throw half. Only the pair
   * pins the discrimination, which is the whole content of the line under test.
   *
   * DRIVEN THROUGH `transport.events(slot).detach(...)`, NOT BY CALLING `fork` DIRECTLY.
   * `tests/node/scratch.test.ts` asserts that `fork` throws `BufferCapReached` and explains this catch in
   * a comment; this executes the catch. The seam is the same one the rebind test above uses: it is the
   * production handler, not a re-statement of it.
   */
  it('re-throws a non-cap error out of the fork handler and keeps only the cap refusal', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['from source'], tm: [0] }))

    const notified: string[] = []
    let draws = 0
    let buffersChanged = 0
    let thrown: unknown = new Error('a pool invariant broke')

    const transport = createTransport({
      sessions: reg,
      // THE ONLY METHOD `detach` CALLS ON IT WHEN `fork` THROWS, so a fake with one property is the
      // whole dependency rather than a stub standing in for an object with a surface.
      scratchpad: {
        fork: () => {
          throw thrown
        },
      } as unknown as ScratchBuffers,
      draw: () => draws++,
      speed: () => 8,
      setSpeed: () => undefined,
      // Inert: these fixtures drive stepping and binding, neither language features nor colour.
      lspClient: LSP_STUB,
      colour: () => [],
      formatOnBlur: () => false,
      // NEVER REACHED, SO A CAST: a keymap setting is joined by an EDITOR, and no fixture in this file builds one.
      keymap: {} as KeymapSetting,
      // `index.lambdaText` IS THE ONE FIELD OF `index` THAT `detach`'s GUARD READS — an empty string makes
      // `detach` return before `forkCopy` ever calls `fork`, so the fake `fork` above would never throw.
      linkWiring: () => ({ index: { lambdaText: 'λx. x' } }) as unknown as LinkWiring,
      notify: (t: string) => {
        notified.push(t)
      },
      onBuffersChanged: () => buffersChanged++,
      // A THROW, SO A `detach` THAT REACHED IT WOULD FAIL HERE LOUDLY: `detach` is not a rebind, and the
      // fork it performs persists through `onBuffersChanged` reaching `main.ts`'s `refreshBuffers`. A
      // `detach` that wrote storage itself would be a second writer for one gesture, and this says so.
      onBuffersPersist: () => {
        throw new Error('a fork must not persist through the rebind dependency')
      },
    })

    const slot = new PaneSlot('lambda', 'source')
    const events = transport.events(slot)

    // THE WIRING BUG. It leaves the handler unchanged and reaches nothing that renders — which is the
    // behaviour that keeps it loud, and the reason nothing may have been notified afterwards.
    expect(() => events.detach?.(0)).toThrow(/a pool invariant broke/)
    expect(notified).toEqual([])
    // AND NOTHING WAS REPORTED AS IF IT HAD HAPPENED: no repaint, no count change.
    expect(draws).toBe(0)
    expect(buffersChanged).toBe(0)

    // THE REFUSAL, THROUGH THE SAME HANDLER — the contrast that makes the assertions above about the
    // `instanceof` rather than about there being no catch.
    // **BUILT FROM `MAX_WARM_BUFFERS`**, because a hand-spelled figure is invisible to a sweep for the
    // constant's name. The words are copied from `#refuseAtCap`'s, and nothing here fails if they change.
    //
    // What this test is about: the `instanceof` branch in `transport.ts`'s `forkCopy` reports a
    // `BufferCapReached` rather than re-throwing it, and the message reaches `notify` intact.
    thrown = new BufferCapReached(
      `cannot make a copy — all ${MAX_WARM_BUFFERS} copies are running; pause or delete one from the copies menu to make room`,
    )
    expect(() => events.detach?.(0)).not.toThrow()
    expect(notified.join(' ')).toContain('pause or delete one')
    // THE NOTICE IS THE ONE THING THAT CHANGED, so a draw and no buffer-count report.
    expect(draws).toBe(1)
    expect(buffersChanged).toBe(0)
  })

  /**
   * **THE IDENTICAL DISCRIMINATION, ON THE TM LEG'S OWN HANDLER.** `detachMachine` reaches the same
   * `instanceof BufferCapReached` catch as `detach` above (`transport.ts`'s `forkCopy`), over a fake
   * `scratchpad.fork` that throws — cheap, since no worker is needed to prove which branch a throw takes.
   * What differs from the λ test is what `detachMachine` resolves BEFORE the `try`:
   * `sessions.entryOf(session).tmProgram?.tmText`, not `linkWiring().index.lambdaText`, so the session
   * here is seeded with a `tmProgram` a real `compiled` reply would have left rather than with an `index`.
   */
  it('re-throws a non-cap error out of the machine-fork handler and keeps only the cap refusal', () => {
    const reg = new SessionRegistry()
    const source = entry('source', { label: 'source', tm: [0] })
    const program: TmProgram = {
      states: [{ name: 'pc0', accept: false, rules: [], instr: null }],
      alphabet: ['a'],
      tapes: 1,
      width: 8,
      start: 0,
      listing: [],
      labels: [],
    }
    source.tmProgram = {
      program,
      tapeNames: ['TAPE'],
      tmText: 'tapes 1\nstart pc0\nstate pc0:\n',
      tmResultDecodable: true,
    }
    reg.add(source)

    const notified: string[] = []
    let draws = 0
    let buffersChanged = 0
    let thrown: unknown = new Error('a pool invariant broke')

    const transport = createTransport({
      sessions: reg,
      // THE ONLY METHOD `detachMachine` CALLS ON IT WHEN `fork` THROWS, mirroring the λ test's fake above.
      scratchpad: {
        fork: () => {
          throw thrown
        },
      } as unknown as ScratchBuffers,
      draw: () => draws++,
      speed: () => 8,
      setSpeed: () => undefined,
      // Inert: these fixtures drive stepping and binding, neither language features nor colour.
      lspClient: LSP_STUB,
      colour: () => [],
      formatOnBlur: () => false,
      // NEVER REACHED, SO A CAST: a keymap setting is joined by an EDITOR, and no fixture in this file builds one.
      keymap: {} as KeymapSetting,
      // NO `index` FIELD HERE, UNLIKE THE λ TEST'S FAKE — `detachMachine` never reads `linkWiring()`
      // for its text (`sessions.entryOf(...).tmProgram?.tmText` is the whole resolution), so a fake
      // that omitted `index` would still be exercising the real handler rather than papering over a
      // read it does not perform.
      linkWiring: () => ({}) as unknown as LinkWiring,
      notify: (t: string) => {
        notified.push(t)
      },
      onBuffersChanged: () => buffersChanged++,
      onBuffersPersist: () => {
        throw new Error('a machine fork must not persist through the rebind dependency')
      },
    })

    const slot = new PaneSlot('tm', 'source')
    const events = transport.events(slot)

    // THE WIRING BUG, IDENTICAL IN SHAPE TO THE λ CASE ABOVE.
    expect(() => events.detachMachine?.()).toThrow(/a pool invariant broke/)
    expect(notified).toEqual([])
    expect(draws).toBe(0)
    expect(buffersChanged).toBe(0)

    // THE REFUSAL, THROUGH THE SAME HANDLER.
    thrown = new BufferCapReached(
      `cannot make a copy — all ${MAX_WARM_BUFFERS} copies are running; pause or delete one from the copies menu to make room`,
    )
    expect(() => events.detachMachine?.()).not.toThrow()
    expect(notified.join(' ')).toContain('pause or delete one')
    expect(draws).toBe(1)
    expect(buffersChanged).toBe(0)
  })

  /**
   * **THE IDENTICAL DISCRIMINATION, ON THE ASM LEG'S OWN HANDLER.** `detachAsm` reaches the same
   * `instanceof BufferCapReached` catch as `detach` and `detachMachine` above (`transport.ts`'s
   * `forkCopy`). What it resolves BEFORE the `try` is `sessions.entryOf(session).asmProgram?.asmText`, so
   * the session here is seeded with the `asmProgram` a real `compiled` reply would have left, as the TM
   * test's is with a `tmProgram`.
   */
  it('re-throws a non-cap error out of the asm-fork handler and keeps only the cap refusal', () => {
    const reg = new SessionRegistry()
    const source = entry('source', { label: 'source', asm: [0] })
    source.asmProgram = {
      program: { listing: ['li\trr, #1', 'halt'], labels: [] },
      asmText: 'result Nat\n\n    li\trr, #1\n    halt\n',
    }
    reg.add(source)

    const notified: string[] = []
    let draws = 0
    let buffersChanged = 0
    let thrown: unknown = new Error('a pool invariant broke')

    const transport = createTransport({
      sessions: reg,
      // THE ONLY METHOD `detachAsm` CALLS ON IT WHEN `fork` THROWS, mirroring the λ test's fake above.
      scratchpad: {
        fork: () => {
          throw thrown
        },
      } as unknown as ScratchBuffers,
      draw: () => draws++,
      speed: () => 8,
      setSpeed: () => undefined,
      // Inert: these fixtures drive stepping and binding, neither language features nor colour.
      lspClient: LSP_STUB,
      colour: () => [],
      formatOnBlur: () => false,
      // NEVER REACHED, SO A CAST: a keymap setting is joined by an EDITOR, and no fixture in this file builds one.
      keymap: {} as KeymapSetting,
      // NO `index` FIELD HERE, AS IN THE TM TEST'S FAKE — `detachAsm` resolves its text from the session's
      // `asmProgram`, not from `linkWiring()`.
      linkWiring: () => ({}) as unknown as LinkWiring,
      notify: (t: string) => {
        notified.push(t)
      },
      onBuffersChanged: () => buffersChanged++,
      onBuffersPersist: () => {
        throw new Error('an asm fork must not persist through the rebind dependency')
      },
    })

    const slot = new PaneSlot('asm', 'source')
    const events = transport.events(slot)

    // THE WIRING BUG, IDENTICAL IN SHAPE TO THE λ AND TM CASES ABOVE.
    expect(() => events.detachAsm?.()).toThrow(/a pool invariant broke/)
    expect(notified).toEqual([])
    expect(draws).toBe(0)
    expect(buffersChanged).toBe(0)

    // THE REFUSAL, THROUGH THE SAME HANDLER.
    thrown = new BufferCapReached(
      `cannot make a copy — all ${MAX_WARM_BUFFERS} copies are running; pause or delete one from the copies menu to make room`,
    )
    expect(() => events.detachAsm?.()).not.toThrow()
    expect(notified.join(' ')).toContain('pause or delete one')
    expect(draws).toBe(1)
    expect(buffersChanged).toBe(0)
  })

  /**
   * **`detachMachine` REACHED WITH NO MACHINE TEXT IS A WIRING BUG, NOT A REFUSAL — `transport.ts`'s
   * own doc on the guard.** The control is withdrawn or disabled whenever `tmText === null`
   * (`CopyEditor.#refreshDetach`), so a click that reaches this handler with one names a gap between the
   * button's own state and what the handler reads, not a state a user chose. Asserted on a session with
   * no `tmProgram` at all (the ordinary case — nothing has compiled a machine to this session yet), the
   * cheapest way to reach `tmText === null` without also building a real one that IS forkable.
   */
  it('throws loudly rather than forking with no machine text', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', tm: [0] }))

    const transport = createTransport({
      sessions: reg,
      scratchpad: {
        fork: () => {
          throw new Error('fork must not be called with no machine text')
        },
      } as unknown as ScratchBuffers,
      draw: () => undefined,
      speed: () => 8,
      setSpeed: () => undefined,
      // Inert: these fixtures drive stepping and binding, neither language features nor colour.
      lspClient: LSP_STUB,
      colour: () => [],
      formatOnBlur: () => false,
      // NEVER REACHED, SO A CAST: a keymap setting is joined by an EDITOR, and no fixture in this file builds one.
      keymap: {} as KeymapSetting,
      linkWiring: () => ({}) as unknown as LinkWiring,
      notify: () => undefined,
      onBuffersChanged: () => undefined,
      onBuffersPersist: () => undefined,
    })

    const events = transport.events(new PaneSlot('tm', 'source'))
    expect(() => events.detachMachine?.()).toThrow(/detachMachine reached with no machine text/)
  })

  /**
   * §5's JOINT DETACHMENT CASE — "bind a pane to a scratch, see both, rebind, see neither".
   *
   * ASSERTED ABSENT AFTER THE REBIND, not only present before it — an implementation that calls
   * `setDetached(true)` and never clears it passes the first half. That is the same rule
   * `view-status.test.ts` states for the surface itself; this is the rule applied to what DRIVES it.
   */
  it('reports detachment from the session it is bound to, and stops when rebound', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['a'], tm: [0] }))
    reg.add(entry('lambda-scratch', { label: 'λ scratchpad', detached: true, lambda: ['b'] }))

    const slot = new PaneSlot('lambda', 'lambda-scratch')
    const pane = recorder<LambdaState>()

    paint(reg, slot, pane.view)
    expect(pane.detached.at(-1)).toBe(true)

    slot.rebind('source')
    paint(reg, slot, pane.view)
    expect(pane.detached.at(-1)).toBe(false)
  })

  /**
   * The selector's contents are a function of the registry ALONE, and the pair in force is what ties
   * the list to the slot — so a session added while a pane sits still reaches that pane's selector.
   *
   * **EVERY PAIR, NOT THE SLOT'S OWN LEG.** `PaneSlot.render` pushes `reg.pairs()`, so a TM slot's list
   * carries the λ pairs too, and the pairs that never appear are the ones whose SESSION lacks the leg.
   * `tm-scratch` below is that distinction under test: a TM-only session adds a TM pair and no λ one.
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

    reg.add(entry('tm-scratch', { label: 'TM scratchpad', detached: true, tm: [7] }))
    paint(reg, slot, pane.view)
    expect(pane.bindings.at(-1)).toEqual({
      options: [
        { leg: 'lambda', id: 'source', label: 'source' },
        { leg: 'tm', id: 'source', label: 'source' },
        { leg: 'tm', id: 'tm-scratch', label: 'TM scratchpad' },
      ],
      current: { session: 'source', leg: 'tm' },
    })
  })

  // `controlState`'s output is the slot's job (so this test and the app share one implementation), so
  // the step readout has to come from the bound leg's own head.
  it('drives the control strip from the leg it resolved, not from a shared head', () => {
    const reg = new SessionRegistry()
    reg.add(entry('source', { label: 'source', lambda: ['a', 'b', 'c'], tm: [0] }))
    reg.add(entry('lambda-scratch', { label: 'λ scratchpad', detached: true, lambda: ['z'] }))

    const a = new PaneSlot('lambda', 'source')
    const b = new PaneSlot('lambda', 'lambda-scratch')
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
  it('clears every leg the session has and stops its playback', () => {
    const e = entry('source', { lambda: ['a', 'b'], tm: [0, 1] })
    const lambdaLeg = e.legs.lambda
    const tmLeg = e.legs.tm
    if (lambdaLeg === undefined || tmLeg === undefined) throw new Error('the fixture built both legs')
    lambdaLeg.done = 'ended'
    lambdaLeg.playing = true

    resetLegs(e.legs, {}, 'not compiled')

    expect(lambdaLeg.hist.length).toBe(0)
    expect(tmLeg.hist.length).toBe(0)
    expect(lambdaLeg.done).toBe(null)
    expect(lambdaLeg.playing).toBe(false)
    expect(lambdaLeg.status).toEqual({ available: false, reason: 'not compiled' })
    expect(tmLeg.status).toEqual({ available: false, reason: 'not compiled' })
  })

  /**
   * THE THIRD LEG TOO. A recompile that left the asm leg's frames would step through a program the editor no longer
   * holds; the loop reads `LEGS`, and this holds it to the asm leg as well.
   */
  it('clears every leg, asm included, and gives each the status its reply sent', () => {
    const e = entry('source', { lambda: ['a'], asm: [0, 1, 2], tm: [0] })
    const asmLeg = e.legs.asm
    if (asmLeg === undefined) throw new Error('the fixture built the asm leg')
    asmLeg.done = 'capped'
    asmLeg.playing = true

    resetLegs(e.legs, { asm: { available: false, reason: 'lowering failed' } }, 'not compiled')

    expect(asmLeg.hist.length).toBe(0)
    expect(asmLeg.done).toBe(null)
    expect(asmLeg.playing).toBe(false)
    expect(asmLeg.status).toEqual({ available: false, reason: 'lowering failed' })
    expect(e.legs.lambda?.status).toEqual({ available: false, reason: 'not compiled' })
  })

  /**
   * A `LambdaScratch` has no TM leg to be "not compiled", and writing one so the record is square is
   * the shape `session.rs`'s `Session::tm` records the cost of. The caller passes one reply's worth of
   * status whatever the session's shape; dropping the half that has nowhere to go is the whole
   * behaviour.
   *
   * THE λ AND TM ONE-LEGGED SHAPES, NOT JUST THE λ ONE: §4.1 has two scratch types. An asm copy is a
   * third one-legged shape, which this case does not build.
   */
  it('drops a status for a leg the session does not have rather than inventing one', () => {
    const lambdaOnly = entry('lambda-scratch', { lambda: ['a'] })
    const tmOnly = entry('tm-scratch', { tm: [0] })
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
    const transport = createTransport({
      sessions: reg,
      scratchpad: {} as ScratchBuffers,
      draw: () => undefined,
      speed: () => 8,
      setSpeed: () => undefined,
      lspClient: LSP_STUB,
      colour: () => [],
      formatOnBlur: () => false,
      keymap: {} as KeymapSetting,
      linkWiring: () => ({}) as LinkWiring,
      notify: () => undefined,
      onBuffersChanged: () => undefined,
      onBuffersPersist: () => undefined,
    })
    const slot = new PaneSlot('lambda', 'source')
    const lambda = slot.resolve(reg)
    lambda.pending = 3000
    expect(lambda.pending).toBe(3000)
    transport.events(slot)[gesture]()
    expect(lambda.pending).toBeUndefined()
    expect('pending' in lambda).toBe(false)
  })
})
