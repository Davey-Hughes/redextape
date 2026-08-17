import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { History } from '../../src/history'
import type { LinkWiring } from '../../src/link-wiring'
import { PaneCollection, type PaneEntry } from '../../src/panes'
import type { RunReply, RunRequest } from '../../src/protocol'
import { createReplies } from '../../src/replies'
import { ScratchBuffers } from '../../src/scratch'
import type { ClientPort, PoolPort, SessionId } from '../../src/session-client'
import { SessionClient, SessionPool } from '../../src/session-client'
import type { LegState, SessionEntry } from '../../src/sessions'
import { PaneSlot, SessionRegistry } from '../../src/sessions'
import type { Diagnostic, LambdaState, TmProgram, TmState } from '../../src/types'

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
 * **THE CLEARING ARMS ARE NOT HERE, AND THE REASON IS THAT SAME MISSING DOCUMENT.** `no-session` and
 * `worker-error` clear the retention exactly as they clear every TM pane on the session, and both start
 * by writing into `#results` — `renderRows` and `showWorkerError` each call `document.createElement`, so
 * neither arm can be entered at all in this tier. `tests/browser/pane-picker.test.ts` drives the failed
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
  return { hist: new History<T>(1_000_000), status: { available: false, reason: '' }, done: null, timer: null }
}

/** A session with both legs and nothing compiled yet, exactly as `main.ts` registers the source one. */
function sourceEntry(): SessionEntry {
  return {
    id: SOURCE,
    label: 'source',
    detached: false,
    client: fakeClient(),
    legs: { lambda: leg<LambdaState>(), tm: leg<TmState>() },
    tmProgram: null,
  }
}

/** A machine small enough to compare by identity, with a state so a `StateIndex` over it is non-empty. */
const PROGRAM: TmProgram = {
  states: [{ name: 'pc0', accept: false, rules: [{ read: ['a'], write: ['b'], moves: ['R'], next: 0 }] }],
  alphabet: ['a', 'b'],
  tapes: 1,
  width: 8,
  start: 0,
}

const compiled = (tmProgram: TmProgram | null, tapeNames: string[]): RunReply => ({
  kind: 'compiled',
  gen: 1,
  lambda: { available: true, reason: '', node: null, run: null },
  tm: { available: true, reason: '', width: 8, run: null, total_steps: null },
  declinedSpan: null,
  tmProgram,
  tapeNames,
  linkIndex: null,
})

/** The switch under test, over a registry holding `entry`, with no pane in the collection. */
function driver(entry: SessionEntry) {
  const reg = new SessionRegistry()
  reg.add(entry)
  const dispatched: unknown[] = []
  const indexed: unknown[] = []
  let drawn = 0
  const view = { dispatch: (t: unknown) => dispatched.push(t) } as unknown as EditorView
  const links = { setIndex: (i: unknown) => indexed.push(i) } as unknown as LinkWiring
  const replies = createReplies({
    sessions: reg,
    scratchpad: undefined as unknown as ScratchBuffers,
    results: undefined as unknown as HTMLElement,
    view: () => view,
    panes: new PaneCollection(),
    links,
    draw: () => {
      drawn += 1
    },
    editorHome: () => undefined,
    // NO SCRATCH REPLY REACHES THIS DRIVER — every test built on it sends `compiled`, `error` or
    // `worker-error` through `onReply`, and `onBuffersPersist` is called from the `scratch-compiled`
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
    const second: TmProgram = { ...PROGRAM, states: [{ name: 'pc1', accept: true, rules: [] }] }

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
 * `links` RECORDS `setForkFailed` BECAUSE THAT IS WHERE THE DIAGNOSTICS SURFACE on the path where no
 * editor was ever mounted (`link-status.ts`'s `forkFailed`). `results` and `view` stay `undefined`
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
function scratchDriver() {
  const reg = new SessionRegistry()
  const ports: (PoolPort & { sent: RunRequest[]; terminated: number })[] = []
  const pool = new SessionPool(() => {
    const p = fakePort()
    ports.push(p)
    return p
  })
  let forkFailed: string | null = null
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
  const links = {
    setForkFailed: (reason: string | null) => {
      forkFailed = reason
    },
  } as unknown as LinkWiring
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
    sessions: reg,
    scratchpad: buffers,
    results: undefined as unknown as HTMLElement,
    view: () => undefined as unknown as EditorView,
    panes,
    links,
    draw: () => undefined,
    editorHome: () => undefined,
    onBuffersPersist: () => {
      persists += 1
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
    slot,
    gutter,
    forkFailed: () => forkFailed,
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
 * on the source session and so made `✎ fork` offerable again (design §4.1a's promised remedy). It is
 * not offerable now: the pane stays on a buffer that will never produce a frame, reading `building…`,
 * until the user retires it from the header list (design §4.2/§4.4), which is wired and is where that
 * gesture lives. Retiring rebinds the pane to source and `✎ fork` comes back with the binding. That gap
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
    const id = buffers.fork(slot, 'not a term (((', 0)

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
    const id = buffers.fork(slot, 'not a term (((', 0)

    replies.onScratchReply(id, noSession([DIAGNOSTIC]))

    expect(slot.binding.session).toBe(id)
  })

  /**
   * **THE DIAGNOSTICS STILL SURFACE, WHICH IS THE HALF THAT DID NOT CHANGE.** `#link-status` is the
   * surface for this path because no editor was ever mounted to hold a gutter: `scratch-compiled` never
   * fired for a build that never succeeded, so `LambdaPane.setDiagnostics` is a silent no-op. That
   * argument used to end "…and the retire has just moved the pane anyway"; the rebind is gone and the
   * no-editor half is what carries it now, unchanged.
   */
  it('reports the reason on the fork-failed surface', () => {
    const { buffers, replies, slot, gutter, forkFailed } = scratchDriver()
    const id = buffers.fork(slot, 'not a term (((', 0)

    replies.onScratchReply(id, noSession([DIAGNOSTIC]))

    expect(forkFailed()).toContain('unexpected `(`')
    // AND NOT INTO THE PANE, which is the branch's other half: there is no editor behind
    // `setDiagnostics` on a build that never reached `scratch-compiled`, so routing it there is the
    // silent no-op `#link-status` exists to replace.
    expect(gutter).toEqual([])
  })

  /**
   * THE LIVE-EDIT PATH IS UNTOUCHED AND STILL DISTINGUISHED. A buffer with a frame behind it takes the
   * other branch — the diagnostics go to the pane's own gutter and nothing is reported as a failed fork
   * — and that discrimination is the whole reason `noSessionReply` still returns something rather than
   * nothing. Without this case the arm could report every parse failure as a fork failure and every
   * assertion above would still pass.
   */
  it('does not report a mid-edit parse failure as a failed fork', () => {
    const { reg, buffers, replies, slot, gutter, forkFailed } = scratchDriver()
    const id = buffers.fork(slot, 'λx. x', 0)
    reg.legOf({ session: id, leg: 'lambda' }).hist.push(lambdaFrame('λx. x'), 1)

    replies.onScratchReply(id, noSession([DIAGNOSTIC]))

    expect(forkFailed()).toBeNull()
    expect(gutter).toEqual([[DIAGNOSTIC]])
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
    const id = buffers.fork(slot, 'seed', 0)

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
    const id = buffers.fork(slot, 'not a term (((', 0)

    replies.onScratchReply(id, {
      kind: 'scratch-compiled',
      gen: 1,
      lambda: { available: false, reason: 'no scratch', node: null, run: null },
      text: null,
    })

    expect(persists()).toBe(0)
  })
})
