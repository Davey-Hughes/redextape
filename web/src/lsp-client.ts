import type {
  LanguageId,
  LspDiagnostic,
  LspDocumentSymbol,
  LspLocation,
  LspOutgoing,
  LspPosition,
  LspReplyMessage,
  LspRequestMessage,
  LspTextEdit,
  PublishDiagnosticsParams,
  RequestId,
} from './lsp-protocol'
import { isResponse } from './lsp-protocol'

/**
 * What the client needs from a worker, and nothing more.
 *
 * **AN INTERFACE RATHER THAN `Worker`, SO EVERY RULE IN THIS FILE IS TESTABLE WITHOUT A THREAD** —
 * the reason `session-client.ts`'s `ClientPort` gives, and the reason it matters more here: request
 * correlation, the restart policy and the replay are all logic, and none of them needs wasm to
 * exercise. `tests/node/lsp-client.test.ts` drives the whole lifecycle against a recording fake.
 */
export type LspPort = {
  postMessage(m: LspRequestMessage): void
  addEventListener(type: 'message' | 'error', handler: (e: { data?: LspReplyMessage }) => void): void
  terminate(): void
}

/** One open document, and everything needed to replay it into a restarted worker. */
type OpenDocument = {
  uri: string
  languageId: LanguageId
  text: string
  version: number
  /** Where this document's diagnostics go, and how to jump into it. Set when it is opened. */
  handlers: DocumentHandlers
}

/**
 * What one editor does with its own diagnostics.
 *
 * **PER DOCUMENT RATHER THAN ONE ROUTER FOR THE APP, AND THAT IS WHAT MAKES MISROUTING
 * UNREPRESENTABLE.** A single sink taking a URI would put a lookup — and a way to get it wrong —
 * in whichever module owned the map. The editors that need this are built inside `lambda-pane.ts`
 * and `tm-pane.ts`, so that module would have been neither of them. Opening a document and saying
 * where its diagnostics go is one act here, and `closeDocument` drops the sink with the document.
 */
export type DiagnosticsSink = (diagnostics: LspDiagnostic[]) => void

/**
 * What one editor offers the client, beyond taking its diagnostics.
 *
 * One field today. It is an object rather than a bare sink because a document's handlers are the
 * natural place for anything else an editor offers the client, and because `openDocument` taking
 * five positional arguments was where this was heading.
 */
export type DocumentHandlers = {
  readonly diagnostics: DiagnosticsSink
}

/** How the client reports a state the user should know about. `notice.ts`'s `notify`. */
export type NoticeSink = (text: string) => void

/**
 * The reason a pending request was abandoned. A rejected request must be distinguishable from one
 * that answered `null`, which is an ordinary "no definition here".
 */
export class LspUnavailable extends Error {
  constructor(reason: string) {
    super(`the language server is unavailable: ${reason}`)
    this.name = 'LspUnavailable'
  }
}

/**
 * The main-thread half of the language server, and where every decision lives.
 *
 * **IT OWNS THE WORKER'S LIFECYCLE, UNLIKE `SessionClient`, AND THE ASYMMETRY IS DELIBERATE.** That
 * class holds a port it may not kill, because lifecycle is `SessionPool`'s and one session's damage
 * is contained by terminating its thread. There is exactly one language server for the whole app, so
 * there is no pool for it to be in, and the thing that would own its lifecycle would have this class
 * as its only member. The `spawn` factory is injected for the reason `SessionPool`'s is: so the
 * failure policy — and the DOM a notice needs — stays in `main.ts`.
 *
 * **NO TIMEOUT ON A PENDING REQUEST, AND THAT IS A DECISION.** A request that is never answered is
 * either a dead worker, which the `error` listener below sees and which rejects every pending request
 * at once, or a bug in the server, which a timer would hide behind a generic message. This repository
 * has already paid for the alternative: a prior slice shipped twenty-three timeout ceilings that could
 * never fire, and `tests/node/browser-timeout-invariants.test.ts` exists because of it. A ceiling
 * whose only reachable cause is already handled by a listener is one of those.
 */
export class LspClient {
  #spawn: () => LspPort
  #port: LspPort | null = null
  #ready = false
  /** Requests posted before `ready`, replayed in order once the module has instantiated. */
  #queued: LspRequestMessage[] = []
  #nextId: RequestId = 1
  #pending = new Map<RequestId, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  #documents = new Map<string, OpenDocument>()
  #notify: NoticeSink
  /**
   * How many times the worker has been restarted. **The policy is restart once, then stay off** —
   * the umbrella's §7. A server that dies twice is not going to survive a third start, and a restart
   * loop would replay every open document into it each time.
   */
  #restarts = 0
  #off = false
  /**
   * Whether `start()` has ever run. **Without it a request made on a constructed-but-unstarted
   * client queues forever**: `#send` queues whenever there is no ready port, `#off` is still
   * false, and nothing would ever reject the entry left in `#pending`. That is the one
   * never-settling cause this class's "no timeout" argument does NOT cover, because no listener
   * exists yet to cover it.
   */
  #started = false
  /** Set while a restart is in flight, so the "it is back" notice waits until it really is. */
  #restarting = false

  constructor(spawn: () => LspPort, notify: NoticeSink) {
    this.#spawn = spawn
    this.#notify = notify
  }

  /** Whether language features are available. `false` once the server has stopped for good. */
  get available(): boolean {
    return !this.#off
  }

  /** How many documents the client believes are open — the replay set's size. */
  get openDocumentCount(): number {
    return this.#documents.size
  }

  /**
   * Start the worker and send `initialize`.
   *
   * **`initialize` DECLARES `hierarchicalDocumentSymbolSupport`, AND THAT IS THE PROTOCOL'S
   * PRECONDITION FOR THE OUTLINE'S SHAPE** rather than a preference. The server reads it into
   * `hierarchical_symbols` and, without it, answers `documentSymbol` with the flat
   * `SymbolInformation[]` — which has no `children` and so cannot render a tree.
   */
  start(): void {
    if (this.#off || this.#port !== null) return
    this.#started = true
    const port = this.#spawn()
    this.#port = port
    // **EVERY LISTENER IDENTIFIES ITS OWN PORT, AND THIS IS THE GUARD THE WHOLE RESTART POLICY
    // RESTS ON.** A dead worker's listeners cannot be removed and `terminate()` cannot unqueue
    // events already dispatched to this thread, so a worker that throws while several messages are
    // in flight — `didChange` and `documentSymbol` together is the ordinary shape, not an exotic
    // one — delivers two `error` events. Without this check the second one runs `#died` again,
    // which terminates `this.#port`: by then the BRAND NEW worker. Measured before it was fixed:
    // `first.crash(); first.crash()` left `ports[1].terminated === true`, `available === false`,
    // and a notice reading "stopped twice" after exactly one worker had died. A stale `failed` or
    // `out` from the same dead port does the same damage through `#receive`.
    const mine = (): boolean => this.#port === port
    port.addEventListener('message', (e) => {
      if (!mine()) return
      if (e.data !== undefined) this.#receive(e.data)
    })
    // A `Worker`'s `error` event fires for an uncaught throw on that thread. `failed` below is the
    // different case — the module never loaded — and it is reported by the worker itself.
    port.addEventListener('error', () => {
      if (!mine()) return
      this.#died('the language server stopped')
    })
    this.#request('initialize', {
      processId: null,
      rootUri: null,
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } },
      },
    }).catch(() => {
      // **SWALLOWED, AND NOT BECAUSE THE FAILURE DOES NOT MATTER.** This is the client's own
      // request rather than a caller's, so nothing is waiting on it: `#died` and `#receive` both
      // reject every pending request, and this one would have no consumer to catch it. An
      // unhandled rejection in a browser reaches `window.onunhandledrejection` and prints as an
      // uncaught error — noise that names the language server on a path the client has already
      // reported through a notice. Found by the node suite reporting seven unhandled rejections
      // across four passing tests, which is a failure the assertions could not see.
    })
    this.#notifyServer('initialized', {})
  }

  #receive(reply: LspReplyMessage): void {
    if (reply.kind === 'failed') {
      // Nothing to restart: the module will not load, and starting a second worker would fetch the
      // same bytes. This is a different outcome from a worker that died, and gets its own notice.
      //
      // TERMINATED BEFORE THE REFERENCE IS DROPPED, the order `#died` already uses and the order
      // `SessionPool.unbind` argues for: once `#port` is null nothing can terminate it, and the
      // thread would stay resident for the life of the page.
      this.#off = true
      this.#restarting = false
      this.#port?.terminate()
      this.#port = null
      this.#rejectAll(new LspUnavailable(reply.reason))
      this.#notify('Language features are unavailable — the language server could not be loaded.')
      return
    }
    if (reply.kind === 'ready') {
      this.#ready = true
      const port = this.#port
      if (port !== null) for (const m of this.#queued.splice(0)) port.postMessage(m)
      // **SAID WHEN IT IS TRUE, NOT WHEN IT IS ATTEMPTED.** Announced from `#died` instead, a
      // restart whose replacement fails to load reads "Language features are back." immediately
      // followed by "Language features are unavailable".
      if (this.#restarting) {
        this.#restarting = false
        this.#notify('The language server restarted. Language features are back.')
      }
      return
    }
    for (const m of reply.messages) this.#dispatch(m)
  }

  #dispatch(m: LspOutgoing): void {
    if (isResponse(m)) {
      const waiting = this.#pending.get(m.id)
      // **DROPPED RATHER THAN THROWN, AND THE CASE IS REAL.** A restarted worker can answer a request
      // the previous instance was sent, and the ids are per-client rather than per-worker. The
      // request it belongs to was already rejected by `#died`.
      if (waiting === undefined) return
      this.#pending.delete(m.id)
      if (m.error !== undefined) waiting.reject(new Error(m.error.message))
      else waiting.resolve(m.result)
      return
    }
    if (m.method === 'textDocument/publishDiagnostics') {
      // GUARDED RATHER THAN CAST. `LspNotification.params` is optional because the protocol says
      // so; today's server always sends it, but a cast that denies a case the type admits turns a
      // malformed notification into a TypeError thrown out of the worker's message handler.
      const params = m.params as PublishDiagnosticsParams | undefined
      if (params === undefined || !Array.isArray(params.diagnostics)) return
      // A document closed while its diagnostics were in flight has no sink, which is an ordinary
      // race rather than an error: the editor they were for is gone.
      this.#documents.get(params.uri)?.handlers.diagnostics(params.diagnostics)
    }
  }

  #died(reason: string): void {
    this.#port?.terminate()
    this.#port = null
    this.#ready = false
    this.#queued = []
    this.#rejectAll(new LspUnavailable(reason))
    if (this.#restarts >= 1) {
      this.#off = true
      this.#notify('Language features are off — the language server stopped twice.')
      return
    }
    this.#restarts += 1
    this.#restarting = true
    this.start()
    // **REPLAYED AS `didOpen`, NOT AS `didChange`.** A fresh server has no document at all, so a
    // change to one would name a URI it has never seen. Diagnostics arrive on their own from these,
    // which is why nothing is re-requested here.
    for (const doc of this.#documents.values()) {
      this.#notifyServer('textDocument/didOpen', {
        textDocument: { uri: doc.uri, languageId: doc.languageId, version: doc.version, text: doc.text },
      })
    }
  }

  #rejectAll(err: Error): void {
    for (const waiting of this.#pending.values()) waiting.reject(err)
    this.#pending.clear()
  }

  #send(json: string): void {
    const m: LspRequestMessage = { kind: 'msg', json }
    // Queued until the worker says `ready`: the module is fetched and instantiated asynchronously,
    // and a message posted before that lands would reach a worker with no server in it. The worker
    // queues too — two guards, on opposite sides of the boundary, and only its own is ordered with
    // respect to the handle actually existing.
    if (this.#port === null || !this.#ready) this.#queued.push(m)
    else this.#port.postMessage(m)
  }

  #notifyServer(method: string, params: unknown): void {
    if (this.#off) return
    this.#send(JSON.stringify({ jsonrpc: '2.0', method, params }))
  }

  #request(method: string, params: unknown): Promise<unknown> {
    if (this.#off) return Promise.reject(new LspUnavailable('it stopped'))
    // See `#started`. Queuing here would leave a promise nothing can ever settle, and no
    // listener exists yet to reject it — the one never-settling cause the "no timeout"
    // argument above does not already cover.
    if (!this.#started) return Promise.reject(new LspUnavailable('it was never started'))
    const id = this.#nextId
    this.#nextId += 1
    return new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  /**
   * Open one editor's document, and say where its diagnostics go.
   *
   * **RE-OPENING A URI IS LEGITIMATE AND HAPPENS ROUTINELY.** A copy's editor is destroyed when
   * its pane rebinds away and built again when a pane shows that buffer next, so the same
   * document opens more than once in a page's life with a new sink each time. The version
   * restarts at 1 because the server replaces its copy outright.
   */
  openDocument(uri: string, languageId: LanguageId, text: string, handlers: DocumentHandlers): void {
    this.#documents.set(uri, { uri, languageId, text, version: 1, handlers })
    this.#notifyServer('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text },
    })
  }

  /**
   * Replace a document's text.
   *
   * **A WHOLE-DOCUMENT CHANGE, BECAUSE `textDocumentSync` IS `Full`.** The server replaces its copy
   * outright, so there is no incremental edit to express — and the design measured what that costs:
   * `structuredClone` of a 6,100,000-byte string is 0.512 ms, so the copy is a rounding error beside
   * the re-analysis it triggers.
   */
  changeDocument(uri: string, text: string): void {
    const doc = this.#documents.get(uri)
    if (doc === undefined) return
    doc.text = text
    doc.version += 1
    this.#notifyServer('textDocument/didChange', {
      textDocument: { uri, version: doc.version },
      contentChanges: [{ text }],
    })
  }

  /**
   * Close a document.
   *
   * **IT MUST BE REMOVED FROM THE REPLAY SET TOO**, not only told to the server: a restart replays
   * `#documents`, so a document left here would be reopened into the new worker after the view that
   * held it was gone, and its diagnostics would be published to a URI nothing routes.
   */
  closeDocument(uri: string): void {
    if (!this.#documents.delete(uri)) return
    this.#notifyServer('textDocument/didClose', { textDocument: { uri } })
  }

  /**
   * The formatted document as a list of edits — empty when there is nothing to do.
   *
   * **THE SERVER ANSWERS `null`, NOT `[]`, FOR TEXT THAT DOES NOT PARSE, AND THIS IS WHERE THAT IS
   * NORMALISED.** `Server::formatting` builds an `Option<Vec<TextEdit>>` and hands it straight to
   * `from_success`, so an unparseable buffer's `result` is JSON `null`. The part 3 design asserted
   * the server produced an empty list; it does not, and a client that mapped over the result would
   * have thrown on the single most likely buffer — one being typed into. Found by a test in
   * `redextape-lsp-wasm`, not by reading.
   */
  async format(uri: string): Promise<LspTextEdit[]> {
    const result = await this.#request('textDocument/formatting', {
      textDocument: { uri },
      options: { tabSize: 4, insertSpaces: true },
    })
    return (result ?? []) as LspTextEdit[]
  }

  /** The document's outline. `[]` for a language that has none — λ answers no symbols by design. */
  async documentSymbols(uri: string): Promise<LspDocumentSymbol[]> {
    const result = await this.#request('textDocument/documentSymbol', { textDocument: { uri } })
    return (result ?? []) as LspDocumentSymbol[]
  }

  /**
   * Where the name under `position` is defined, or `null`.
   *
   * `null` is the ordinary answer for a cursor on a keyword, not a failure — which is why it is
   * distinct from the `LspUnavailable` rejection a dead server produces.
   */
  async definition(uri: string, position: LspPosition): Promise<LspLocation | null> {
    const result = await this.#request('textDocument/definition', { textDocument: { uri }, position })
    return (result ?? null) as LspLocation | null
  }

  /** Every reference to the name under `position`, including its declaration. */
  async references(uri: string, position: LspPosition): Promise<LspLocation[]> {
    const result = await this.#request('textDocument/references', {
      textDocument: { uri },
      position,
      context: { includeDeclaration: true },
    })
    return (result ?? []) as LspLocation[]
  }
}
