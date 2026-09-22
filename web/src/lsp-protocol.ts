/**
 * The slice of the Language Server Protocol this app speaks, hand-written.
 *
 * **NOT GENERATED, AND THAT IS THE ONE PLACE THIS PROJECT'S WIRE-TYPE CONVENTION DOES NOT APPLY.**
 * Every other type crossing the wasm boundary is generated from its Rust declaration by `ts-rs`
 * (`web/bindings/`, built by `scripts/build-web-bindings.sh`) because the Rust side DECLARES those
 * shapes. It does not declare these: LSP's types are generated into `gen-lsp-types` from Microsoft's
 * official MetaModel, so a generated TypeScript copy would be a second description of a shape nobody
 * in this repository owns — and it would be enormous, because the protocol is vastly larger than the
 * nine messages below.
 *
 * **SO THE RISK THIS FILE CARRIES IS DRIFT AGAINST THE SERVER, AND ONE TEST HOLDS IT.**
 * `tests/node/lsp-protocol.test.ts` asserts `LANGUAGE_IDS` is exactly what
 * `Language::from_language_id` matches. That is the one field where a mismatch is SILENT rather than
 * loud: an unmatched id makes the server answer every request with nothing, which on screen is
 * indistinguishable from a file with no problems in it. Every other field here fails visibly.
 */

/** A request id. Monotonic, assigned by `LspClient`; `0` is never used, so it can mean "none". */
export type RequestId = number

/** Zero-based line, and a UTF-16 code-unit offset within it — which is what CodeMirror counts in. */
export type LspPosition = { line: number; character: number }

/** Half-open: `end` is the first position NOT in the range. */
export type LspRange = { start: LspPosition; end: LspPosition }

/**
 * `1` error, `2` warning, `3` information, `4` hint.
 *
 * The server emits only `1` and `2` — `to_lsp_diagnostic` maps `redextape_core::Severity`, which has
 * two variants. The other two are in the type because the protocol defines them and a server that
 * gains a hint later should not need this file edited to be understood.
 */
export type LspSeverity = 1 | 2 | 3 | 4

export type LspDiagnostic = {
  range: LspRange
  severity?: LspSeverity
  message: string
  source?: string
}

export type LspTextEdit = { range: LspRange; newText: string }

export type LspLocation = { uri: string; range: LspRange }

/**
 * One outline entry. `children` is what makes it the hierarchical shape rather than the flat
 * `SymbolInformation[]`, and the server only sends this shape when the client has declared
 * `hierarchicalDocumentSymbolSupport` — see `LspClient`'s `initialize`.
 */
export type LspDocumentSymbol = {
  name: string
  detail?: string
  kind: number
  range: LspRange
  selectionRange: LspRange
  children?: LspDocumentSymbol[]
}

/**
 * The four `languageId` values the server matches, and **the app's half of a contract whose failure
 * is silent**.
 *
 * `Language::from_language_id` answers `None` for anything else, after which every language request
 * returns empty and no diagnostic is ever published for that document. There is no error, no
 * console warning and no visible difference from a clean file. This cost the part 3 design a whole
 * round of measurements that read nine times too fast, in the direction that made the decision they
 * informed look free.
 */
export const LANGUAGE_IDS = ['redextape', 'redextape_lambda', 'redextape_tm', 'redextape_asm'] as const

export type LanguageId = (typeof LANGUAGE_IDS)[number]

/** The app's three editor kinds, and the language each one holds. `asm` has no editor until part 5. */
export const LANGUAGE_OF_PANE = {
  source: 'redextape',
  lambda: 'redextape_lambda',
  tm: 'redextape_tm',
} as const satisfies Record<'source' | 'lambda' | 'tm', LanguageId>

/**
 * How each language reads in a sentence shown to a user — the colourer's failure notice is the one
 * caller, which `main.ts` builds from `colour.ts`'s `createGrammarRegistry`.
 *
 * **THE WORDS ARE THE APP'S EXISTING ONES, NOT NEW ONES**, per the umbrella's rule that every
 * user-visible word is the umbrella's: `source` is what `main.ts`'s `layoutChanged` calls the source
 * view, and `λ`/`TM` are `view-header.ts`'s `legLabel` — the same two glyphs every view title and
 * every menu item already carries. A second vocabulary for the same three surfaces is what this map
 * exists to avoid.
 *
 * `redextape_asm` HAS NO EDITOR UNTIL PART 5, so its entry can never reach a notice today. It is here
 * because `satisfies Record<LanguageId, string>` is what keeps this map total, and a map that went
 * partial the moment a fourth editor appeared would fail at the call site rather than here.
 */
export const LANGUAGE_LABEL = {
  redextape: 'source',
  redextape_lambda: 'λ',
  redextape_tm: 'TM',
  redextape_asm: 'asm',
} as const satisfies Record<LanguageId, string>

/** The file extension each language's synthetic document URI carries. Never fetched, never parsed. */
export const EXTENSION_OF_LANGUAGE = {
  redextape: 'rxt',
  redextape_lambda: 'rxlambda',
  redextape_tm: 'tm',
  redextape_asm: 'asm',
} as const satisfies Record<LanguageId, string>

/**
 * A synthetic, per-view document URI.
 *
 * **PER VIEW RATHER THAN PER LANGUAGE**, because two views can hold the same language over different
 * text — which copies make routine — and the server keys documents by this string. It is never
 * fetched and never parsed: `gen-lsp-types` is taken with default features precisely so `Uri` stays a
 * newtype over `String`, and nothing on either side resolves it.
 */
export function documentUri(viewId: string, language: LanguageId): string {
  return `redextape:///view/${viewId}.${EXTENSION_OF_LANGUAGE[language]}`
}

/** A JSON-RPC response, as the server sends it. Exactly one of `result`/`error` is present. */
export type LspResponse = {
  jsonrpc: '2.0'
  id: RequestId
  result?: unknown
  error?: { code: number; message: string }
}

/** A JSON-RPC notification: no `id`, which is the only thing distinguishing it from a request. */
export type LspNotification = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

/** What the server sends. `id` present means a response; absent means a notification. */
export type LspOutgoing = LspResponse | LspNotification

export function isResponse(m: LspOutgoing): m is LspResponse {
  return 'id' in m && m.id !== undefined
}

/** `textDocument/publishDiagnostics`' payload — the only notification the server sends today. */
export type PublishDiagnosticsParams = {
  uri: string
  version?: number
  diagnostics: LspDiagnostic[]
}

/** Posted to the worker. One JSON-RPC message, already serialized. */
export type LspRequestMessage = { kind: 'msg'; json: string }

/**
 * Posted back by the worker.
 *
 * `ready` is sent once, after `init()` resolves, and it is **load-bearing rather than informational**:
 * the wasm module is fetched and instantiated asynchronously, so a message posted before it lands
 * would be handled by a worker with no `LspServer` in it. The client queues until `ready` arrives.
 *
 * `failed` is sent when the module will not load at all, which is a different outcome from the worker
 * dying and gets a different notice — there is nothing to restart.
 */
export type LspReplyMessage =
  | { kind: 'ready' }
  | { kind: 'failed'; reason: string }
  | { kind: 'out'; messages: LspOutgoing[] }
