import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { History } from '../../src/history'
import type { LinkWiring } from '../../src/link-wiring'
import { PaneCollection } from '../../src/panes'
import type { RunReply, RunRequest } from '../../src/protocol'
import { createReplies } from '../../src/replies'
import type { LambdaScratchpad } from '../../src/scratch'
import type { ClientPort, SessionId } from '../../src/session-client'
import { SessionClient } from '../../src/session-client'
import type { LegState, SessionEntry } from '../../src/sessions'
import { SessionRegistry } from '../../src/sessions'
import type { LambdaState, TmProgram, TmState } from '../../src/types'

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
 * been written as "the four injected dependencies" and been wrong: `editorHome` and `reconcileEditors`
 * are no-ops here too, and `draw` is a counter — a false arity, in a doc, about arities.) `view` and
 * `links` are REACHED by the arm under test — the `compiled` arm dispatches two CodeMirror effects and
 * installs a link index — so they record, and their calls are asserted below, together with `draw`'s:
 * a green retention over a switch that fell through somewhere else is not a green test. `editorHome` and
 * `reconcileEditors` are honest no-ops, both belonging to `onScratchReply`'s arms, which this file does
 * not drive. `scratchpad` and `results` are not reached by the `compiled` arm at all and are `undefined`
 * behind a cast, deliberately: an arm that starts touching either crashes this test loudly rather than
 * passing over a fake that quietly absorbs the call. There is no honester option in the node tier — an
 * `EditorView` and an `HTMLElement` both need a document, which is exactly why the browser tier owns
 * everything about this repair that can be seen.
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
    scratchpad: undefined as unknown as LambdaScratchpad,
    results: undefined as unknown as HTMLElement,
    view: () => view,
    panes: new PaneCollection(),
    links,
    draw: () => {
      drawn += 1
    },
    sourceSession: SOURCE,
    editorHome: () => undefined,
    reconcileEditors: () => undefined,
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
