import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { History } from '../../src/history'
import { LambdaTrees } from '../../src/lambda-trees'
import type { LinkWiring } from '../../src/link-wiring'
import { PaneCollection, type PaneEntry } from '../../src/panes'
import type { RecordEnd, RunReply, RunRequest } from '../../src/protocol'
import { createReplies } from '../../src/replies'
import { ScratchBuffers } from '../../src/scratch'
import type { ClientPort, PoolPort, SessionId } from '../../src/session-client'
import { SessionClient, SessionPool } from '../../src/session-client'
import type { LegState, SessionEntry } from '../../src/sessions'
import { PaneSlot, SessionRegistry } from '../../src/sessions'
import type {
  AsmProgram,
  AsmState,
  AsmStatus,
  Decoded,
  Diagnostic,
  LambdaState,
  TmProgram,
  TmScratchStatus,
  TmState,
} from '../../src/types'
import { frameOf } from './asm-fixtures'

/**
 * **WHAT A SESSION KEEPS FROM ITS OWN `compiled` REPLY** — the retention a TM pane created later is
 * seeded from.
 *
 * `TmPane.setProgram` is only ever called from the reply switch this file drives, so before this
 * retention existed a TM pane built after the last `compiled` reply had no route to a program at all:
 * `pane-host.ts` constructs the pane and nothing hands it one until the next compile. The browser tier
 * asserts the visible half of the repair (`pane-picker.test.ts`, `pane-kind-switch.test.ts`: a pane
 * created from a picker paints tapes and δ-rows). This file asserts the half that has no DOM in it — the
 * entry holds what the panes were told, whether or not any pane was there to be told.
 *
 * **THE COLLECTION IS EMPTY IN BOTH CASES, AND THAT IS THE POINT RATHER THAN A SHORTCUT.** The
 * retention has to survive a reply that reached no pane — that is the only situation it exists for, since
 * a session with a TM pane already open needs nothing retained to look right. A test that registered a
 * pane could not tell "the entry was written" from "the pane was pushed to".
 *
 * **EVERY INJECTED DEPENDENCY IS STOOD IN FOR, AND THEY DIVIDE IN THREE.** (Said without a count, having
 * been written as "the four injected dependencies" and been wrong — a false arity, in a doc, about
 * arities. It named `reconcileEditors` among them, which 5d-ii-c decision 2 has since deleted from the
 * signature along with the retire it swept for.) `view` and
 * `links` are REACHED by the arm under test — the `compiled` arm dispatches two CodeMirror effects and
 * installs a link index — so they record, and their calls are asserted below, together with `draw`'s:
 * a green retention over a switch that fell through somewhere else is not a green test. `editorHome` is
 * an honest no-op, belonging to `onScratchReply`'s arms, which `driver` does not drive. `scratchpad` and
 * `results` are not reached by the `compiled` arm at all and are `undefined`
 * behind a cast, deliberately: an arm that starts touching either crashes this test loudly rather than
 * passing over a fake that quietly absorbs the call. There is no honester option in the node tier — an
 * `EditorView` and an `HTMLElement` both need a document, which is exactly why the browser tier owns
 * everything about this repair that can be seen.
 *
 * **`onScratchReply` IS DRIVEN AT THE FOOT OF THIS FILE, WHICH THE PARAGRAPH ABOVE USED TO SAY IT WAS
 * NOT.** Its `no-session` arm needs neither a document nor a worker — the buffer collection, the
 * registry and the pool are all reachable in this tier — so `scratchDriver` below stands `scratchpad` up
 * for real rather than casting it away. The two harnesses are separate on purpose: `driver`'s
 * `undefined` is an assertion about which arms may touch what, and reusing it would spend that.
 *
 * **THE CLEARING ARMS ARE NOT HERE, AND THE REASON IS THAT SAME MISSING `#results`.** `no-session` and
 * `worker-error` clear the retention exactly as they clear every TM pane on the session, and both open by
 * writing `results.dataset.state` — `results` is the `undefined` behind a cast named above, so neither arm
 * can be entered at all in this tier. `tests/browser/pane-picker.test.ts` drives the failed
 * compile through the real app and asserts what it is for: a TM pane created after it is as empty as the
 * panes already on screen.
 */

const SOURCE: SessionId = 'source'

/** A `ClientPort` with no thread behind it — `SessionEntry` needs a client and nothing here posts. */
function fakeClient(): SessionClient {
  const port: ClientPort = {
    postMessage: (_m: RunRequest) => undefined,
    addEventListener: (_t: 'message', _h: (e: { data: RunReply }) => void) => undefined,
  }
  return new SessionClient(port, () => undefined)
}

function leg<T>(): LegState<T> {
  return { hist: new History<T>(1_000_000), status: { available: false, reason: '' }, done: null, playing: false }
}

/** A session with every leg and nothing compiled yet, exactly as `main.ts` registers the source one. */
function sourceEntry(): SessionEntry {
  return {
    id: SOURCE,
    label: 'source',
    detached: false,
    client: fakeClient(),
    legs: { lambda: leg<LambdaState>(), asm: leg<AsmState>(), tm: leg<TmState>() },
    tmProgram: null,
    tmScratch: null,
    asmProgram: null,
    asmScratch: null,
  }
}

/** A machine small enough to compare by identity, with a state so a `StateIndex` over it is non-empty. */
const PROGRAM: TmProgram = {
  states: [{ name: 'pc0', accept: false, rules: [{ read: ['a'], write: ['b'], moves: ['R'], next: 0 }], instr: null }],
  alphabet: ['a', 'b'],
  tapes: 1,
  width: 8,
  start: 0,
  listing: [],
  labels: [],
}

const compiled = (tmProgram: TmProgram | null, tapeNames: string[]): RunReply => ({
  kind: 'compiled',
  gen: 1,
  lambda: { available: true, reason: '', node: null, run: null },
  asm: { available: false, reason: 'no asm leg', run: null, cap: null, total_steps: null },
  tm: { available: true, reason: '', width: 8, run: null, total_steps: null },
  declinedSpan: null,
  tmProgram,
  asmProgram: null,
  tapeNames,
  linkIndex: null,
  tmText: null,
  tmResultDecodable: true,
  asmText: null,
})

/**
 * The switch under test, over a registry holding `entry`, with no pane in the collection.
 *
 * `frame` IS OVERRIDABLE FOR `scratchDriver`'s REASON, AND DEFAULTS TO ITS STAND-IN, a callback run straight. A
 * recording chunk that does not end the recording schedules its redraw on `frame`, and `createReplies`' own default,
 * `requestAnimationFrame`, is not defined in this tier: a `*-frames` reply sent here without a stand-in would throw.
 */
function driver(entry: SessionEntry, opts: { frame?: (cb: () => void) => void } = {}) {
  const reg = new SessionRegistry()
  reg.add(entry)
  const dispatched: unknown[] = []
  const indexed: unknown[] = []
  let drawn = 0
  const view = { dispatch: (t: unknown) => dispatched.push(t) } as unknown as EditorView
  const links = { setIndex: (i: unknown) => indexed.push(i) } as unknown as LinkWiring
  const replies = createReplies({
    setProgram: () => undefined,
    trees: new LambdaTrees(() => undefined),
    sessions: reg,
    scratchpad: undefined as unknown as ScratchBuffers,
    results: undefined as unknown as HTMLElement,
    view: () => view,
    panes: new PaneCollection(),
    links,
    notify: () => undefined,
    draw: () => {
      drawn += 1
    },
    frame: opts.frame ?? ((cb: () => void) => cb()),
    editorHome: () => undefined,
    // NO SCRATCH REPLY REACHES THIS DRIVER — every test built on it sends `compiled` or a recording
    // chunk through `onReply`, and `onBuffersPersist` is called from the `scratch-compiled`
    // arm of the OTHER switch. A no-op rather than a throw, because "this driver does not exercise
    // that arm" is a fact about the fixture and not a claim any test here is making.
    onBuffersPersist: () => undefined,
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

    expect(entry.tmProgram).toBeNull()
    replies.onReply(SOURCE, compiled(PROGRAM, ['TAPE', 'STACK']))

    expect(entry.tmProgram?.program).toBe(PROGRAM)
    expect(entry.tmProgram?.tapeNames).toEqual(['TAPE', 'STACK'])
    // AND THE REST OF THE ARM RAN — see this file's doc: the two reached stubs are what say so.
    expect(dispatched.length).toBe(1)
    expect(indexed).toEqual([null])
    expect(drawn()).toBe(1)
  })

  /**
   * **A COMPILE THAT PRODUCED NO MACHINE RETAINS NOTHING, AND `null` IS NOT A PLACEHOLDER HERE.**
   * `protocol.ts` types `tmProgram` nullable defensively rather than reachably (its own doc), so this is
   * the wire contract being honoured rather than a producer being reproduced — and the seeding in
   * `pane-host.ts` reads exactly this field, so a retention that stored the reply unconditionally would
   * hand a new pane a `null` program wrapped in a non-null envelope and have it paint an empty δ-table
   * over a `width` line with no machine behind it.
   */
  it('retains nothing when the reply carried no machine', () => {
    const entry = sourceEntry()
    const { replies } = driver(entry)

    replies.onReply(SOURCE, compiled(PROGRAM, ['TAPE']))
    expect(entry.tmProgram).not.toBeNull()

    replies.onReply(SOURCE, compiled(null, []))

    expect(entry.tmProgram).toBeNull()
  })

  /**
   * **THE SECOND COMPILE REPLACES THE FIRST RATHER THAN ADDING TO IT.** A recompile invalidates every
   * state id — `setProgram`'s own doc says so, and it drops each pane's links for that reason — so an
   * entry still holding the previous machine would seed a newly created pane with a δ-table whose rows
   * name states the session no longer has.
   */
  it('holds the machine from the latest compile, not the first', () => {
    const entry = sourceEntry()
    const { replies } = driver(entry)
    const second: TmProgram = { ...PROGRAM, states: [{ name: 'pc1', accept: true, rules: [], instr: null }] }

    replies.onReply(SOURCE, compiled(PROGRAM, ['TAPE']))
    replies.onReply(SOURCE, compiled(second, ['REG']))

    expect(entry.tmProgram?.program).toBe(second)
    expect(entry.tmProgram?.tapeNames).toEqual(['REG'])
  })
})

/**
 * A `PoolPort` with no thread behind it, recording what was posted and what a `retire` would have done
 * to it.
 *
 * `sent` ARRIVED WITH TASK 3, matching `scratch.test.ts`'s own `FakePort` rather than inventing a
 * second shape for the same recording — this file's `scratch-compiled` test needs to read back a
 * post the same way that file's `warm posts the buffer text at step 0` does.
 */
function fakePort(): PoolPort & { sent: RunRequest[]; terminated: number } {
  const p: PoolPort & { sent: RunRequest[]; terminated: number } = {
    sent: [],
    terminated: 0,
    postMessage: (m: RunRequest) => p.sent.push(m),
    addEventListener: (_t: 'message', _h: (e: { data: RunReply }) => void) => undefined,
    terminate: () => {
      p.terminated += 1
    },
  }
  return p
}

const DIAGNOSTIC: Diagnostic = { span: { start: 0, end: 3 }, severity: 'Error', message: 'unexpected `(`' }

const noSession = (diagnostics: Diagnostic[]): RunReply => ({ kind: 'no-session', gen: 1, diagnostics })

/**
 * The scratch arm's own driver: `createReplies` over a REAL `ScratchBuffers`, a real `SessionRegistry`
 * and a real `SessionPool` with fake threads.
 *
 * **`driver` ABOVE CANNOT BE REUSED, AND ITS `scratchpad: undefined` IS THE REASON — deliberately, per
 * this file's own doc**: an arm that starts touching the buffer collection is meant to crash there
 * rather than pass over a fake. The `no-session` arm touches it on purpose, so it needs the real thing;
 * everything except the thread is the app's own object, which is what makes "the buffer is still
 * listed" a claim about `ScratchBuffers` rather than about a stub that agreed to say so.
 *
 * `notify` RECORDS WHAT IS SAID BECAUSE A NOTICE IS WHERE THE DIAGNOSTICS SURFACE on the path where no
 * editor was ever mounted (`notice.ts`'s `createNotices`). `results` and `view` stay `undefined`
 * behind a cast for the reason the file's doc gives — this arm reaches neither, and an arm that starts
 * to should say so loudly.
 *
 * **THE SLOT IS IN THE PANE COLLECTION, AND THAT IS NOT DECORATION.** The retire this task removes was
 * handed `panes.all().map((p) => p.slot)`, so it could only ever move a pane the COLLECTION held: with
 * an empty collection, "the pane stayed on the buffer" is satisfied by the old behaviour too, and the
 * assertion that reads best is the one that would have been vacuous. It also gives the live-edit branch
 * somewhere to deliver diagnostics to. The pane itself is a recording stub of the two members these arms
 * touch, in `panes.test.ts`'s own idiom — a real `LambdaPane` needs a document, which is the browser
 * tier's business (`tests/browser/scratch-edit.test.ts`).
 */
/**
 * `draw` and `frame` are overridable for the tests below that assert how often `draw()` runs —
 * `case 'tm-value'`'s frame coalescing, and the recording chunks' — and every other caller takes the
 * defaults, a no-op `draw` and a `frame` that runs its callback synchronously. **THE DEFAULT `frame` MUST
 * NOT BE `createReplies`'s OWN DEFAULT**, which is `requestAnimationFrame` itself: this tier's
 * `environment: 'node'` has no such global (unlike jsdom or a real page), so a test that sends a `Running`
 * tm-value reply, or a recording chunk that does not end its recording, without overriding `frame` would
 * throw `ReferenceError: requestAnimationFrame is not defined` the moment its arm schedules one. Running
 * the callback synchronously instead keeps every existing retention test's behaviour identical to `draw()`
 * being called straight, since none of them assert on `draw`'s call count or timing — only the coalescing
 * tests do, and they pass both overrides.
 */
function scratchDriver(opts: { draw?: () => void; frame?: (cb: () => void) => void } = {}) {
  const reg = new SessionRegistry()
  const ports: (PoolPort & { sent: RunRequest[]; terminated: number })[] = []
  const pool = new SessionPool(
    () => {
      const p = fakePort()
      ports.push(p)
      return p
    },
    () => {},
  )
  const notified: string[] = []
  // COUNTED RATHER THAN STUBBED OUT, because the text of record and the write of it are two claims:
  // `setText` puts a term in memory and only this callback puts it where a reload can find it, and the
  // arm below can satisfy the first while dropping the second (5d-ii-d T5).
  let persists = 0
  const buffers = new ScratchBuffers({
    registry: reg,
    pool,
    historyBytes: 1_000_000,
    onReply: () => undefined,
  })
  const links = {} as unknown as LinkWiring
  const gutter: Diagnostic[][] = []
  const slot = new PaneSlot('lambda', SOURCE)
  const panes = new PaneCollection()
  panes.add({
    id: 'lambda-0',
    kind: 'lambda',
    slot,
    pane: {
      render: () => undefined,
      setBindings: () => undefined,
      setDetached: () => undefined,
      setLayoutControls: () => undefined,
      setDiagnostics: (ds: readonly Diagnostic[]) => gutter.push([...ds]),
    } as unknown as PaneEntry<'lambda'>['pane'],
    host: {} as HTMLElement,
  })
  const replies = createReplies({
    setProgram: () => undefined,
    trees: new LambdaTrees(() => undefined),
    sessions: reg,
    scratchpad: buffers,
    results: undefined as unknown as HTMLElement,
    view: () => undefined as unknown as EditorView,
    panes,
    links,
    draw: opts.draw ?? (() => undefined),
    frame: opts.frame ?? ((cb: () => void) => cb()),
    editorHome: () => undefined,
    onBuffersPersist: () => {
      persists += 1
    },
    notify: (t: string) => {
      notified.push(t)
    },
  })
  // THE MOST RECENT PORT'S MOST RECENT `lambda-scratch` REQUEST — `scratch.test.ts`'s `harness()`
  // defines the identical helper under the identical name, for the identical reason: `cool`/`warm`'s
  // round trip opens a NEW port, so "most recent port" is what "the build `warm` just posted" means.
  const lastScratchPost = (): { src: string; step: number } | undefined => {
    const req = ports.at(-1)?.sent.at(-1)
    return req?.kind === 'lambda-scratch' ? { src: req.src, step: req.step } : undefined
  }
  return {
    reg,
    pool,
    buffers,
    ports,
    replies,
    panes,
    slot,
    gutter,
    notified: () => notified,
    lastScratchPost,
    persists: () => persists,
  }
}

const lambdaFrame = (text: string): LambdaState => ({
  text,
  spans: [],
  cut: null,
  step: 0,
  redex_span: null,
  owner: 'None',
})

/**
 * **A BUFFER THAT FAILED TO BUILD IS STILL A BUFFER** — 5d-ii-c decision 2, design §4.3's row for
 * "worker error / poison": *ended it* -> **survives; retire is the escape**.
 *
 * **WHAT THIS ARM USED TO DO.** `ScratchBuffers.noSessionReply` retired the buffer synchronously on the
 * path where its fork's build never succeeded even once — terminating its worker, dropping it from the
 * registry and the pool, and rebinding every pane on it back to the source session — and handed the
 * diagnostics back so the caller could report them on a surface that survived the rebind. The
 * diagnostics half is unchanged. The retire is gone: the governing rule is that nothing ends a buffer
 * implicitly, and a build that failed is not a user asking for the buffer to end.
 *
 * **WHAT THAT COSTS, SAID HERE RATHER THAN ONLY IN A PLAN.** The retire was also what put the pane back
 * on the source session and so made `✎ edit a copy` offerable again (design §4.1a's promised remedy). It is
 * not offerable now: the pane stays on a buffer that will never produce a frame, reading `building…`,
 * until the user retires it from the header list (design §4.2/§4.4), which is wired and is where that
 * gesture lives. Retiring rebinds the pane to source and `✎ edit a copy` comes back with the binding. That gap
 * is the same one `compile.ts`'s `schedule` records for the recompile path, widened — and the escape is
 * the same escape, moved from a keystroke nobody aimed to a control they do.
 */
describe('a poisoned buffer survives its own no-session reply', () => {
  /**
   * THE TASK'S OWN ASSERTION: the buffer is still in `list()`, which is the header control's input and
   * therefore the only place a user could reach it from. A retire deletes the entry `list()` reads
   * (`retire`'s own "the collection's own entry goes last of all"), so this fails against the old
   * behaviour rather than describing it.
   *
   * THE POOL AND THE REGISTRY ARE ASSERTED BESIDE IT, AND `terminated` IS THE ONE THAT CANNOT BE
   * SATISFIED BY ACCIDENT. A `list()` that kept its row while `retire` still ran underneath would leave
   * a name pointing at a dead thread — the phantom `buffer-list.ts` is written to refuse — so the claim
   * is made on the thread as well as on the menu, the same axis `scratch.test.ts` uses for the retire.
   */
  it('keeps the buffer listed, registered and running after a no-session reply', () => {
    const { reg, pool, buffers, ports, replies, slot } = scratchDriver()
    const id = buffers.fork(slot, 'not a term (((', 0, 'lambda')

    replies.onScratchReply(id, noSession([DIAGNOSTIC]))

    expect(buffers.list().map((b) => b.id)).toContain(id)
    expect(reg.has(id)).toBe(true)
    expect(pool.has(id)).toBe(true)
    expect(ports[0]?.terminated).toBe(0)
  })

  /**
   * THE PANE STAYS WHERE THE FORK PUT IT. Rebinding it home was the retire's other visible effect, and
   * it is the one a reader is most likely to assume survived — the pane is showing a buffer that will
   * never build, so "put it back" is the intuitive repair. It is exactly the implicit ending decision 2
   * refuses: the buffer would still be live and the pane would have left it without being asked to.
   */
  it('leaves the pane on the buffer rather than dragging it home', () => {
    const { buffers, replies, slot } = scratchDriver()
    const id = buffers.fork(slot, 'not a term (((', 0, 'lambda')

    replies.onScratchReply(id, noSession([DIAGNOSTIC]))

    expect(slot.binding.session).toBe(id)
  })

  /**
   * **THE DIAGNOSTICS STILL SURFACE, WHICH IS THE HALF THAT DID NOT CHANGE.** A notice (`notice.ts`) is
   * the surface for this path because no editor was ever mounted to hold a gutter: `scratch-compiled` never
   * fired for a build that never succeeded, so `LambdaPane.setDiagnostics` is a silent no-op. That
   * argument used to end "…and the retire has just moved the pane anyway"; the rebind is gone and the
   * no-editor half is what carries it now, unchanged.
   */
  it('reports the reason in a notice, since no editor was ever mounted to hold a gutter', () => {
    const { buffers, replies, slot, gutter, notified } = scratchDriver()
    const id = buffers.fork(slot, 'not a term (((', 0, 'lambda')

    replies.onScratchReply(id, noSession([DIAGNOSTIC]))

    expect(notified().join(' ')).toContain('unexpected `(`')
    // AND NOT INTO THE PANE, which is the branch's other half: there is no editor behind
    // `setDiagnostics` on a build that never reached `scratch-compiled`, so routing it there is the
    // silent no-op the notice exists to replace.
    expect(gutter).toEqual([])
  })

  /**
   * **A COPY'S THREAD THREW, AND THE PROGRAM'S READOUT IS NOT WHERE THAT GOES — Plan 7 part 2 spec §9,
   * §13, and the pre-flight build's finding 9.5.** This arm used to render into `#results`, which was
   * one surface for the whole app; the strip reads the FOCUSED view's session now, so a copy's failure
   * stored as the program's result would replace a program result that is still valid and then show up
   * only while the program is focused — nowhere at all while the copy's own view is on screen. It is a
   * notice that names the copy, and the copy's own leg carries the reason its readout reads.
   *
   * **DRIVABLE IN THIS TIER ONLY SINCE THAT CHANGE.** The arm's `document.createElement` went with
   * `showWorkerError`; the file's own `scratchDriver` doc records why a `document` in an arm makes it
   * unreachable here.
   */
  it('says a copy stopped, by name, and leaves the program alone', () => {
    const { reg, buffers, replies, slot, notified } = scratchDriver()
    const id = buffers.fork(slot, 'λx. x', 0, 'lambda')

    replies.onScratchReply(id, { kind: 'worker-error', gen: 1, message: 'RuntimeError: unreachable' })

    expect(notified()).toEqual(['λ copy 1 stopped — RuntimeError: unreachable'])
    // THE COPY'S OWN LEG CARRIES WHAT ITS READOUT SAYS, and its frames are gone rather than left under
    // a message saying the thread broke.
    const leg = reg.legOf({ session: id, leg: 'lambda' })
    expect(leg.status).toEqual({ available: false, reason: 'the copy failed' })
    expect(leg.hist.length).toBe(0)
  })

  /**
   * THE LIVE-EDIT PATH IS UNTOUCHED AND STILL DISTINGUISHED. A buffer with a frame behind it takes the
   * other branch — nothing is reported as a failed fork and the buffer survives — and that
   * discrimination is the whole reason `noSessionReply` still returns something rather than nothing.
   * Without this case the arm could report every parse failure as a fork failure and every assertion
   * above would still pass.
   *
   * **THE GUTTER IS NO LONGER PART OF THAT DISCRIMINATION, AND THIS TEST USED TO ASSERT IT.** The
   * diagnostics on this reply went to `LambdaPane.setDiagnostics`, which served λ copies and left TM
   * copies with an empty gutter whatever was wrong with them. Every editor is an LSP document now and
   * its diagnostics arrive on that document's own sink. What this case still pins — no notice, buffer
   * retained — is the whole of what the branch decides.
   */
  it('does not report a mid-edit parse failure as a failed fork', () => {
    const { reg, buffers, replies, slot, notified } = scratchDriver()
    const id = buffers.fork(slot, 'λx. x', 0, 'lambda')
    reg.legOf({ session: id, leg: 'lambda' }).hist.push(lambdaFrame('λx. x'), 1)

    replies.onScratchReply(id, noSession([DIAGNOSTIC]))

    expect(notified()).toEqual([])
    expect(buffers.list().map((b) => b.id)).toContain(id)
  })
})

/**
 * **THE FORK'S WRITER OF THE TEXT OF RECORD** (design §4.3) — `scratch.test.ts`'s `recompile records
 * the text it posts` covers the OTHER writer, the user's own typed text. This is the worker's, and it
 * is the only one that can record a term for a buffer whose editor never mounts at all (a fork whose
 * build failed never reaches `setEditor`).
 *
 * READ BACK THE SAME WAY, because there is no `textOf` accessor: cool the buffer, clear the recorded
 * posts, warm it again, and check what the rebuild posted.
 */
describe('onScratchReply records a buffer’s text from its own scratch-compiled reply', () => {
  it('records the built term as the buffer’s text and asks for it to be persisted', () => {
    const { buffers, ports, replies, slot, lastScratchPost, persists } = scratchDriver()
    const id = buffers.fork(slot, 'seed', 0, 'lambda')

    replies.onScratchReply(id, {
      kind: 'scratch-compiled',
      gen: 1,
      lambda: { available: true, reason: '', node: null, run: null },
      text: 'built-term',
    })

    expect(buffers.cool(id, SOURCE, [])).toBe(true)
    ports.length = 0
    buffers.warm(id)

    expect(lastScratchPost()).toEqual({ src: 'built-term', step: 0 })
    // **THE WRITE IS A SECOND CLAIM FROM THE RECORDING** (5d-ii-d T5, design §4.9). `setText` alone
    // leaves the term in memory: this is the only moment a FORKED buffer's term exists at all, and
    // without this call it would reach `localStorage` only if the user later typed into it. An
    // implementation that kept the `setText` and dropped this line passes every other assertion here.
    expect(persists()).toBe(1)
  })

  /**
   * THE `null` ARM — a build that produced no scratch (design §4.1a: unparseable text, or a term over
   * `LAMBDA_BYTE_BUDGET`). `setText` is skipped for it, so there is nothing new for a write to carry,
   * and an unconditional persist here would be a `localStorage` round trip per failed fork.
   *
   * IT ALSO PINS WHICH GUARD THE WRITE SITS UNDER. `text: null` is the one reachable reply that
   * distinguishes "persist whenever this arm runs" from "persist when the text changed"; both pass the
   * test above.
   */
  it('does not ask for a write when the build produced no scratch', () => {
    const { buffers, replies, slot, persists } = scratchDriver()
    const id = buffers.fork(slot, 'not a term (((', 0, 'lambda')

    replies.onScratchReply(id, {
      kind: 'scratch-compiled',
      gen: 1,
      lambda: { available: false, reason: 'no scratch', node: null, run: null },
      text: null,
    })

    expect(persists()).toBe(0)
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

describe('a TM buffer retains what its panes were last told', () => {
  const STATUS: TmScratchStatus = {
    available: true,
    reason: '',
    width: 8,
    run: 'Running',
    header: true,
    reduction: { stages: ['single-tape'], steps: 241_666 },
  }

  const built = (tapeNames: string[]): RunReply => ({
    kind: 'tm-scratch-compiled',
    gen: 1,
    tm: STATUS,
    tmProgram: PROGRAM,
    tapeNames,
  })

  /**
   * THE NAMES COME FROM THE REPLY, NOT FROM THE FIXED EXPORT. A label no bank list contains is the only value that
   * tells the two apart, since the fixed export answers the bank names for every machine.
   */
  it('holds the status and the tape names its own reply carried, with no pane to tell', () => {
    const { buffers, reg, replies } = scratchDriver()
    const id = buffers.forkBlank('tm')
    replies.onScratchReply(id, built(['5 tapes, interleaved']))
    expect(reg.entryOf(id).tmProgram?.tapeNames).toEqual(['5 tapes, interleaved'])
    expect(reg.entryOf(id).tmScratch).toEqual({ status: STATUS, value: null })
  })

  it('holds the latest value reading beside that status', () => {
    const { buffers, reg, replies } = scratchDriver()
    const id = buffers.forkBlank('tm')
    replies.onScratchReply(id, built(['REG']))
    const running = { run: 'Running', steps: 200_000, cap: 241_666 } as const
    replies.onScratchReply(id, { kind: 'tm-value', gen: 1, run: running, value: 'Unfinished' })
    const ended = { run: 'Ended', steps: 241_666, cap: 241_666 } as const
    replies.onScratchReply(id, { kind: 'tm-value', gen: 1, run: ended, value: { Value: { text: '2' } } })
    expect(reg.entryOf(id).tmScratch).toEqual({
      status: STATUS,
      value: { run: ended, value: { Value: { text: '2' } } },
    })
  })

  /**
   * **A RUNNING VALUE'S REDRAW IS COALESCED TO ONE PER FRAME, NOT ONE PER REPLY.** `case 'tm-value'`'s own
   * comment in `replies.ts` has the reason: the worker posts a chunk far more often than a display paints,
   * so a `draw()` per chunk is a synchronous redraw the browser cannot skip. This test drives the fake
   * `frame` scheduler by hand instead of the default synchronous stand-in, so it can tell "several replies
   * landed before the frame fired" from "each reply drew on its own" — the default stand-in (`cb()` run
   * straight) collapses that distinction, which is why only the tests that count draws — this one and the
   * recording chunks' further down — replace it.
   */
  it('coalesces a burst of running replies to one draw per frame, and flushes the ending reply at once', () => {
    let drawn = 0
    const { pending, frame, fire: fireFrame } = frameQueue()
    const { buffers, reg, replies } = scratchDriver({ draw: () => (drawn += 1), frame })
    const id = buffers.forkBlank('tm')
    replies.onScratchReply(id, built(['REG']))
    // PRECONDITION: the build itself draws once, straight, exactly as `tm-scratch-compiled`'s own arm
    // always has — a build is not one of the streamed replies whose redraw is coalesced. Reset the counter
    // so the burst below is read against a known zero, not against this unrelated draw.
    expect(drawn).toBe(1)
    drawn = 0
    const running = (steps: number) =>
      ({ kind: 'tm-value', gen: 1, run: { run: 'Running', steps, cap: 2_000_000 }, value: 'Unfinished' }) as const

    // Three chunks land before any frame fires: one redraw is scheduled, not three.
    replies.onScratchReply(id, running(500_000))
    replies.onScratchReply(id, running(1_000_000))
    replies.onScratchReply(id, running(1_500_000))
    expect(drawn).toBe(0)
    expect(pending.length).toBe(1)
    fireFrame()
    expect(drawn).toBe(1)

    // A frame with nothing newly scheduled draws nothing a second time.
    fireFrame()
    expect(drawn).toBe(1)

    // A fourth chunk schedules exactly one more pending frame.
    replies.onScratchReply(id, running(2_000_000))
    expect(drawn).toBe(1)
    expect(pending.length).toBe(1)

    // The reply that ends the run draws AT ONCE, without waiting on the frame already pending —
    // the whole point: the final value must not wait on a frame a hidden tab may never paint.
    const ended = { run: 'Ended', steps: 2_000_000, cap: 2_000_000 } as const
    replies.onScratchReply(id, { kind: 'tm-value', gen: 1, run: ended, value: { Value: { text: '2' } } })
    expect(drawn).toBe(2)

    // The frame the fourth chunk scheduled still fires later — nothing cancels a browser's own callback —
    // but it must not draw again for a run that has already ended and already flushed.
    fireFrame()
    expect(drawn).toBe(2)
    expect(reg.entryOf(id).tmScratch?.value).toEqual({ run: ended, value: { Value: { text: '2' } } })
  })

  it('a new build forgets the previous value', () => {
    const { buffers, reg, replies } = scratchDriver()
    const id = buffers.forkBlank('tm')
    replies.onScratchReply(id, built(['REG']))
    replies.onScratchReply(id, {
      kind: 'tm-value',
      gen: 1,
      run: { run: 'Ended', steps: 1, cap: 1 },
      value: { Value: { text: '2' } },
    })
    replies.onScratchReply(id, built(['REG']))
    expect(reg.entryOf(id).tmScratch?.value).toBeNull()
  })

  it('forgets a reading that was still running when the next text does not build', () => {
    const { buffers, reg, replies } = scratchDriver()
    const id = buffers.forkBlank('tm')
    replies.onScratchReply(id, built(['REG']))
    replies.onScratchReply(id, {
      kind: 'tm-value',
      gen: 1,
      run: { run: 'Running', steps: 200_000, cap: 241_666 },
      value: 'Unfinished',
    })
    replies.onScratchReply(id, { kind: 'no-session', gen: 1, diagnostics: [] })
    expect(reg.entryOf(id).tmScratch).toEqual({ status: STATUS, value: null })
  })

  it('keeps a finished reading when the next text does not build', () => {
    const { buffers, reg, replies } = scratchDriver()
    const id = buffers.forkBlank('tm')
    replies.onScratchReply(id, built(['REG']))
    replies.onScratchReply(id, {
      kind: 'tm-value',
      gen: 1,
      run: { run: 'Ended', steps: 241_666, cap: 241_666 },
      value: { Value: { text: '2' } },
    })
    replies.onScratchReply(id, { kind: 'no-session', gen: 1, diagnostics: [] })
    expect(reg.entryOf(id).tmScratch?.value).toEqual({
      run: { run: 'Ended', steps: 241_666, cap: 241_666 },
      value: { Value: { text: '2' } },
    })
  })
})

/**
 * **A RECORDING CHUNK'S REDRAW IS COALESCED TO ONE PER FRAME, AS A RUNNING VALUE'S IS** — the six `*-frames` arms,
 * three in each switch. `record-loop.ts`'s `recordLeg` posts one chunk per `RECORD_CHUNK` steps while any leg records,
 * far more often than a display paints, and each arm drew once per chunk. The arms now push the chunk's frames at once
 * and leave only the paint for the next frame; the chunk that ends the recording paints at once, since a copy's run
 * gets no `result` reply to paint its last frame.
 *
 * EVERY CASE RUNS FOR BOTH SWITCHES AND ALL THREE LEGS. The six arms are written out separately, so a case run against
 * one of them says nothing about the other five.
 */
describe('a recording chunk redraws once per frame', () => {
  const FRAMES_LEGS = ['lambda', 'tm', 'asm'] as const
  type FramesLeg = (typeof FRAMES_LEGS)[number]
  const CASES = (['onReply', 'onScratchReply'] as const).flatMap((sw) => FRAMES_LEGS.map((l) => [sw, l] as const))

  const tmFrame = (step: number): TmState => ({
    state: 0,
    step,
    heads: [0],
    window_start: [0],
    window: [['a']],
    source_node: null,
    rule: null,
  })

  /** A `*-frames` reply for `leg` carrying steps `from` to `from + 1`, and the frames it carries. */
  const chunk = (leg: FramesLeg, from: number, done: RecordEnd | null): { reply: RunReply; frames: unknown[] } => {
    const steps = [from, from + 1]
    switch (leg) {
      case 'lambda': {
        const frames = steps.map((step) => ({ ...lambdaFrame(`t${step}`), step }))
        return { reply: { kind: 'lambda-frames', gen: 1, frames, done }, frames }
      }
      case 'tm': {
        const frames = steps.map(tmFrame)
        return { reply: { kind: 'tm-frames', gen: 1, frames, done }, frames }
      }
      case 'asm': {
        const frames = steps.map((step) => frameOf({ step }))
        return { reply: { kind: 'asm-frames', gen: 1, frames, done }, frames }
      }
    }
  }

  /**
   * `sw`'s switch over a session with a `leg` leg: the program's session through `driver`, or a blank copy through
   * `scratchDriver`. Both take the same hand-driven frame queue, and `drawn` counts from zero.
   */
  const harness = (sw: 'onReply' | 'onScratchReply', leg: FramesLeg) => {
    const q = frameQueue()
    if (sw === 'onReply') {
      const entry = sourceEntry()
      const d = driver(entry, { frame: q.frame })
      return {
        q,
        send: (r: RunReply) => d.replies.onReply(SOURCE, r),
        leg: () => entry.legs[leg] as LegState<unknown>,
        drawn: d.drawn,
      }
    }
    let drawn = 0
    const d = scratchDriver({ draw: () => (drawn += 1), frame: q.frame })
    const id = d.buffers.forkBlank(leg)
    return {
      q,
      send: (r: RunReply) => d.replies.onScratchReply(id, r),
      leg: () => d.reg.legOf({ session: id, leg }) as LegState<unknown>,
      drawn: () => drawn,
    }
  }

  /**
   * THE HISTORY IS ASSERTED FIRST, BEFORE ANY COUNT. Only the paint may wait for the frame: the step bar, the
   * controls and the next chunk all read the leg straight, so every frame the burst carried must already be there.
   */
  it.each(CASES)('%s, %s: a burst of chunks draws once, on the frame, with the history already current', (sw, leg) => {
    const h = harness(sw, leg)
    const last = chunk(leg, 4, null)
    h.send(chunk(leg, 0, null).reply)
    h.send(chunk(leg, 2, null).reply)
    h.send(last.reply)

    expect({ length: h.leg().hist.length, current: h.leg().hist.current }).toEqual({
      length: 6,
      current: last.frames.at(-1),
    })
    expect(h.drawn()).toBe(0)
    expect(h.q.pending.length).toBe(1)
    h.q.fire()
    expect(h.drawn()).toBe(1)
  })

  it.each(CASES)('%s, %s: the chunk that ends the recording draws at once', (sw, leg) => {
    const h = harness(sw, leg)
    h.send(chunk(leg, 0, 'budget').reply)

    expect(h.leg().done).toBe('budget')
    expect(h.drawn()).toBe(1)
    expect(h.q.pending.length).toBe(0)
  })

  /**
   * A BROWSER'S FRAME CANNOT BE UNCALLED, so the one a burst scheduled still fires after the ending chunk has drawn,
   * and must find nothing left to draw.
   */
  it.each(CASES)('%s, %s: the frame left pending when the recording ends draws nothing', (sw, leg) => {
    const h = harness(sw, leg)
    h.send(chunk(leg, 0, null).reply)
    expect(h.q.pending.length).toBe(1)
    h.send(chunk(leg, 2, 'ended').reply)
    expect(h.drawn()).toBe(1)

    h.q.fire()
    expect(h.drawn()).toBe(1)
  })

  /**
   * **ONE PENDING FLAG FOR EVERY ARM, NOT ONE PER ARM.** `draw()` repaints the whole app from live state, so a frame
   * scheduled by either reply paints what both brought. A TM copy's value run and its recording are the pair that
   * really do land together.
   */
  it('a running TM value and a TM chunk landing before one frame share its one draw', () => {
    const h = harness('onScratchReply', 'tm')
    h.send({ kind: 'tm-value', gen: 1, run: { run: 'Running', steps: 500_000, cap: 2_000_000 }, value: 'Unfinished' })
    h.send(chunk('tm', 0, null).reply)

    expect(h.drawn()).toBe(0)
    expect(h.q.pending.length).toBe(1)
    h.q.fire()
    expect(h.drawn()).toBe(1)
  })

  /**
   * **AND ACROSS BOTH SWITCHES AND EVERY LEG.** The program's session records its three legs at once and a copy records
   * beside it, so a flag kept per switch, or per leg, would give each of them a frame of its own; the pair above lands in
   * one switch on one leg and cannot tell. One `createReplies` serves both switches here, as it does in the app.
   */
  it("the program's λ and TM chunks and a copy's asm chunk landing before one frame share its one draw", () => {
    const q = frameQueue()
    let drawn = 0
    const d = scratchDriver({ draw: () => (drawn += 1), frame: q.frame })
    d.reg.add(sourceEntry())
    const copy = d.buffers.forkBlank('asm')
    d.replies.onReply(SOURCE, chunk('lambda', 0, null).reply)
    d.replies.onReply(SOURCE, chunk('tm', 0, null).reply)
    d.replies.onScratchReply(copy, chunk('asm', 0, null).reply)

    expect(drawn).toBe(0)
    expect(q.pending.length).toBe(1)
    q.fire()
    expect(drawn).toBe(1)
  })
})

/**
 * An asm copy retains what its views were last told, as a TM copy does: its listing, its status and its value, all from
 * the one build reply (Plan 7 part 5 spec, amendment 26), the value replaced by an `asm-value`, the frames recorded
 * into its asm leg, and all of it written to storage with the build.
 */
describe('an asm copy retains what its views were last told', () => {
  const STATUS: AsmStatus = { available: true, reason: '', run: 'Running', cap: null, total_steps: 1 }
  const LISTING: AsmProgram = { listing: ['halt'], labels: [] }
  const built = (value: Decoded): RunReply => ({
    kind: 'asm-scratch-compiled',
    gen: 1,
    asm: STATUS,
    asmProgram: LISTING,
    value,
  })

  it('holds the listing, the status and the value its build reply carried, and persists the copy', () => {
    const { buffers, reg, replies, persists } = scratchDriver()
    const id = buffers.forkBlank('asm')
    replies.onScratchReply(id, built({ Value: { text: '0 (no result type)' } }))
    const entry = reg.entryOf(id)
    expect(entry.asmProgram).toEqual({ program: LISTING, asmText: null })
    expect(entry.asmScratch).toEqual({ status: STATUS, value: { Value: { text: '0 (no result type)' } } })
    expect(entry.legs.asm?.status).toEqual({ available: true, reason: '' })
    expect(persists()).toBe(1)
  })

  it('records its frames into its asm leg', () => {
    const { buffers, reg, replies } = scratchDriver()
    const id = buffers.forkBlank('asm')
    replies.onScratchReply(id, built('Unfinished'))
    replies.onScratchReply(id, { kind: 'asm-frames', gen: 1, frames: [frameOf(), frameOf({ step: 1 })], done: 'ended' })
    const leg = reg.legOf({ session: id, leg: 'asm' })
    expect(leg.hist.current?.step).toBe(1)
    expect(leg.done).toBe('ended')
  })

  it('takes the value a [continue] brings in place of the build’s', () => {
    const { buffers, reg, replies } = scratchDriver()
    const id = buffers.forkBlank('asm')
    replies.onScratchReply(id, built('Unfinished'))
    replies.onScratchReply(id, { kind: 'asm-value', gen: 1, value: { Value: { text: '[1, 2, 3]' } } })
    expect(reg.entryOf(id).asmScratch).toEqual({ status: STATUS, value: { Value: { text: '[1, 2, 3]' } } })
  })

  it('tells every view on the copy the value a [continue] brings, and the null a dead worker leaves', () => {
    const { buffers, reg, replies, panes } = scratchDriver()
    const id = buffers.forkBlank('asm')
    const told: unknown[] = []
    panes.add({
      id: 'asm-0',
      kind: 'asm',
      slot: new PaneSlot('asm', id),
      pane: { setScratch: (r: unknown) => told.push(r) } as unknown as PaneEntry<'asm'>['pane'],
      host: {} as HTMLElement,
    })
    reg.entryOf(id).asmScratch = { status: STATUS, value: 'Unfinished' }
    replies.onScratchReply(id, { kind: 'asm-value', gen: 1, value: { Value: { text: '6' } } })
    replies.onScratchReply(id, { kind: 'worker-error', gen: 1, message: 'boom' })
    expect(told).toEqual([{ status: STATUS, value: { Value: { text: '6' } } }, null])
  })

  it('forgets its reading when its worker throws', () => {
    const { buffers, reg, replies } = scratchDriver()
    const id = buffers.forkBlank('asm')
    replies.onScratchReply(id, built('Unfinished'))
    replies.onScratchReply(id, { kind: 'worker-error', gen: 1, message: 'boom' })
    expect(reg.entryOf(id).asmScratch).toBeNull()
  })
})

/** The program's asm text rides `compiled` beside its listing, for *edit a copy* — `tmText`'s arrangement. */
describe('a session retains its asm text beside its listing', () => {
  const LISTING: AsmProgram = { listing: ['li\trr, #1', 'halt'], labels: [] }

  it('holds the text a `compiled` reply carried, and nothing when it carried no listing', () => {
    const entry = sourceEntry()
    const { replies } = driver(entry)
    const asm: AsmStatus = { available: true, reason: '', run: 'Running', cap: null, total_steps: 2 }
    const text = 'result Nat\n\n    li\trr, #1\n    halt\n'
    replies.onReply(SOURCE, { ...compiled(PROGRAM, ['TAPE']), asm, asmProgram: LISTING, asmText: text } as RunReply)
    expect(entry.asmProgram).toEqual({ program: LISTING, asmText: text })

    replies.onReply(SOURCE, compiled(PROGRAM, ['TAPE']))
    expect(entry.asmProgram).toBeNull()
  })
})
