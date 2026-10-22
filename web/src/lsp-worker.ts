/**
 * The worker that owns the `LspServer`.
 *
 * **THE HANDLE CANNOT LEAVE THIS THREAD** — the rule `session-worker.ts` states for `Session`, and
 * for the same reason: `LspServer` is an opaque wasm-bindgen object with no serialized form, so this
 * thread owns it and answers questions about it rather than handing it over.
 *
 * **IT IS A DIFFERENT THREAD FROM THE SESSION'S, AND THAT IS WHAT MAKES THE WHOLE PART VIABLE.**
 * `session-worker.ts` states the rule for what earns a thread of its own: the thread has to have
 * something to own. A free function takes no handle, so a round trip to reach one is lag bought for
 * nothing, which is why that worker holds none of them. `LspServer` is exactly such a handle, and
 * this thread is idle between keystrokes rather than busy running reductions, so the round trip moves
 * work off the main thread instead of adding to it. The design measured that work at 135.2 ms for
 * a document just past `COLOUR_CEILING_UNITS`; how often a `didChange` arrives — per keystroke from
 * the source editor, on the recompile's 300 ms from the scratch editors — changes nothing here,
 * because all of it is paid off the main thread.
 *
 * **EVERY DECISION LIVES IN `lsp-client.ts`, NOT HERE, AND THE REASON IS TESTABILITY.** Policy in a
 * worker can only be exercised by standing up a thread; the same policy behind `LspPort` is
 * exercised by an object with three methods. So this file holds none: not which document is open,
 * not when to format, not what to do about a dead worker. It receives a message, calls `handle`,
 * and posts what comes back.
 *
 * **THIS FILE IS EXCLUDED FROM COVERAGE, AND A TEST EARNED THE ENTRY.**
 * `tests/browser/lsp-diagnostics.test.ts` mounts the real app, which spawns this worker, and asserts
 * diagnostics that can only have come back through it. v8 reports 0% for this file all the same,
 * because coverage collects through CDP against the page and does not attach to a dedicated worker's
 * context. That is an instrumentation gap, which is what the exclusion is for; an untested worker
 * would be a testing gap, which it is not for.
 *
 * **SO A NEW UNTESTED BRANCH IN THIS FILE MOVES NONE OF THE FOUR COVERAGE NUMBERS, AND THAT IS THE
 * COST.** The discipline above — no policy here — is what keeps that cost small.
 */
import init, { LspServer } from '../../pkg-lsp/redextape_lsp_wasm.js'
import type { LspOutgoing, LspReplyMessage, LspRequestMessage } from './lsp-protocol'

const post = (m: LspReplyMessage): void => {
  self.postMessage(m)
}

let server: LspServer | null = null

/**
 * Messages that arrived before the module finished instantiating.
 *
 * **WITHOUT THIS, AN `initialize` POSTED BEFORE `init()` RESOLVES WOULD BE DROPPED, AND NOTHING WOULD
 * EVER RECOVER.** `init()` is a fetch and an instantiation. The client also queues until `ready`, so
 * this is the second of two guards against the same hazard — kept because the two are on opposite
 * sides of a boundary and only this one is ordered with respect to `server` actually existing.
 */
const pending: LspRequestMessage[] = []

function answer(msg: LspRequestMessage): void {
  if (server === null) return
  // `handle` never throws: a message it cannot parse answers `[]` rather than raising, which is that
  // method's documented contract and the reason this call is not wrapped. A throw out of the message
  // listener would reach `LspClient` as this worker's `error` event, which it treats as a dead worker:
  // this thread is terminated and every pending request rejected, then a new one is started or, the
  // second time, language features are turned off.
  const out: LspOutgoing[] = JSON.parse(server.handle(msg.json))
  // Parsed HERE rather than on the main thread: the string arrives from wasm on this side, and
  // handing the main thread a string it must parse would move that cost to the one thread the whole
  // split exists to keep free.
  if (out.length > 0) post({ kind: 'out', messages: out })
}

self.addEventListener('message', (e: MessageEvent<LspRequestMessage>) => {
  if (server === null) {
    pending.push(e.data)
    return
  }
  answer(e.data)
})

init()
  .then(() => {
    server = new LspServer()
    post({ kind: 'ready' })
    for (const m of pending.splice(0)) answer(m)
  })
  .catch((err: unknown) => {
    // A module that will not load is not a worker that died — there is nothing to restart, so the
    // client says so with its own notice rather than retrying — see the `failed` branch of `LspClient`'s
    // receive handler, which terminates this worker and stops rather than spawning a second one.
    post({ kind: 'failed', reason: err instanceof Error ? err.message : String(err) })
  })
