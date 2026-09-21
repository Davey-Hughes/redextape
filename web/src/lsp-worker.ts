/**
 * The worker that owns the `LspServer`.
 *
 * **THE HANDLE CANNOT LEAVE THIS THREAD** — the rule `session-worker.ts` states for `Session`, and
 * for the same reason: `LspServer` is an opaque wasm-bindgen object with no serialized form, so this
 * thread owns it and answers questions about it rather than handing it over.
 *
 * **IT IS A DIFFERENT THREAD FROM THE SESSION'S, AND THAT IS WHAT MAKES THE WHOLE PART VIABLE.**
 * `session-worker.ts` records why `analyze` was NOT put in a worker: "they are what the editor calls
 * on every keystroke, and a round trip per keystroke is exactly the lag this split exists to avoid."
 * That reasoning is about a thread busy running reductions. This one owns a `Server` and is idle
 * between keystrokes, and the design measured what it costs: 0.15 ms for a source document,
 * 14.58 ms for an 814 KB TM, against the 100 ms debounce `@codemirror/lint` already imposes.
 *
 * **EVERY DECISION LIVES IN `lsp-client.ts`, NOT HERE, AND THE REASON IS TESTABILITY.** Policy in a
 * worker can only be exercised by standing up a thread; the same policy behind `LspPort` is
 * exercised by an object with three methods. So this file holds none: not which document is open,
 * not when to format, not what to do about a dead worker. It receives a message, calls `handle`,
 * and posts what comes back.
 *
 * **THIS FILE IS EXCLUDED FROM COVERAGE, AND THE ENTRY WAS EARNED RATHER THAN INHERITED.** An
 * earlier draft of this comment claimed `vite.config.ts` excludes worker modules generally. It did
 * not — it excluded exactly one file, `src/session-worker.ts` — and for a window this module sat in
 * the denominator at 0% while that claim sat here.
 *
 * It is excluded now, on a measurement taken once a test drove it: `tests/browser/lsp-diagnostics.test.ts`
 * mounts the real app, which spawns this worker, and asserts diagnostics that can only have come
 * back through it. That it is genuinely exercised is not inferred from the test passing — removing
 * either `lspClient.changeDocument` or `lspClient.openDocument` reddens all four of that file's
 * tests. v8 still reports 0%, because coverage collects through CDP against the page and does not
 * attach to a dedicated worker's context. That is an instrumentation gap, which is what the
 * exclusion is for; before the test existed it would have been a testing gap, which it is not for.
 *
 * **SO A NEW UNTESTED BRANCH IN THIS FILE MOVES NONE OF THE FOUR NUMBERS, AND THAT IS THE COST.**
 * The discipline above — no policy here — is what keeps that cost small.
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
 * **WITHOUT THIS, THE FIRST `initialize` IS DROPPED AND NOTHING EVER RECOVERS.** `init()` is a fetch
 * and an instantiation; the client posts as soon as it has constructed the worker, which is sooner.
 * The client also queues until `ready`, so this is the second of two guards against the same hazard
 * — kept because the two are on opposite sides of a boundary and only this one is ordered with
 * respect to `server` actually existing.
 */
const pending: LspRequestMessage[] = []

function answer(msg: LspRequestMessage): void {
  if (server === null) return
  // `handle` never throws: a message it cannot parse answers `[]` rather than raising, which is that
  // method's documented contract and the reason this call is not wrapped. A throw here would kill the
  // message handler and leave every later request unanswered.
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
