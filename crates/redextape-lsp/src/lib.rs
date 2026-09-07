//! `redextape-lsp` — the pure half.
//!
//! **THE SPLIT BETWEEN THIS FILE AND `main.rs` IS NOT STYLISTIC, AND IT BUYS TWO THINGS.**
//!
//! It is what makes the workspace's 90% line-coverage merge gate reachable with a new crate in the
//! tree: `Server::handle` is a function from one client message and the server's state to the
//! messages that go back, so a test constructs a message and asserts on what comes out — no
//! process spawn, no stdio, no threads, no sleeping, no timing.
//!
//! And it is what keeps the web phase possible at no cost to this slice. `web/` is not a consumer
//! and this slice does not make it one; what it does is not foreclose it. `Server::handle` is pure
//! over `gen-lsp-types` structs, which are plain serde types, so a wasm caller could drive the
//! identical code. `lsp-server`'s threads and channels — the part that cannot compile to wasm —
//! live in `main.rs` and nowhere else. That the JSON-RPC envelope types come from
//! `gen_lsp_types::json_rpc` rather than from `lsp-server` is what makes "nowhere else" achievable
//! without hand-writing a second copy of a shape defined elsewhere.

pub mod document;
pub mod language;
pub mod position;

use gen_lsp_types::json_rpc::{Error, Id, RequestObject, ResponseObject};
use gen_lsp_types::{
    BaseSymbolInformation, Definition, DefinitionParams, DefinitionProvider, DefinitionRequest, DefinitionResponse,
    DiagnosticSeverity, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams,
    DocumentFormattingParams, DocumentFormattingProvider, DocumentFormattingRequest, DocumentSymbol,
    DocumentSymbolParams, DocumentSymbolProvider, DocumentSymbolRequest, DocumentSymbolResponse, ErrorCodes,
    InitializeParams, InitializeRequest, InitializeResult, Location, Position, PublishDiagnosticsNotification,
    PublishDiagnosticsParams, Range, ReferenceParams, ReferencesProvider, ReferencesRequest, ServerCapabilities,
    ServerInfo, ShutdownRequest, SymbolInformation, TextDocumentContentChangeEvent, TextDocumentSync,
    TextDocumentSyncKind, TextEdit,
};
use redextape_core::nav::NameIndex;

use crate::document::Documents;
use crate::position::Encoding;

/// One message the server sends because of one message from the client.
///
/// **THE DESIGN SAID `handle(&mut self, Request) -> Response`, AND THAT SHAPE CANNOT CARRY
/// DIAGNOSTICS.** `textDocument/publishDiagnostics` is a server-to-client notification with no
/// request behind it, and the messages that produce it — `didOpen`, `didChange` — are notifications
/// too, so neither the input nor the output of that signature had a place for the traffic this
/// slice exists to serve. This enum is the correction. `handle` is still a pure function of the
/// client's message and the server's state, which is the property the split was for.
#[derive(Debug, PartialEq)]
pub enum Outgoing {
    /// An answer to a request, carrying the request's id.
    Response(ResponseObject),
    /// A server-to-client notification, carrying no id. `RequestObject` is the JSON-RPC envelope
    /// for both, distinguished by whether the id is present.
    Notification(RequestObject),
}

/// The language server, and all of its state.
pub struct Server {
    documents: Documents,
    /// Whether the client said it understands `DocumentSymbol[]`, from
    /// `textDocument.documentSymbol.hierarchicalDocumentSymbolSupport`.
    ///
    /// **THE PROTOCOL MAKES THIS THE PRECONDITION FOR THE RICHER RESPONSE, NOT A PREFERENCE.**
    /// `false` until `initialize` says otherwise, which is both the protocol's default and the
    /// right answer for the window in which nothing has been negotiated — the same rule
    /// `encoding` follows.
    hierarchical_symbols: bool,
    /// Settled by `initialize`. `Utf16` until then, which is the protocol's default and the right
    /// answer for the window in which no negotiation has happened.
    encoding: Encoding,
}

impl Default for Server {
    fn default() -> Self {
        Self::new()
    }
}

impl Server {
    #[must_use]
    pub fn new() -> Self {
        Server { documents: Documents::default(), hierarchical_symbols: false, encoding: Encoding::Utf16 }
    }

    /// The encoding settled by `initialize`.
    #[must_use]
    pub fn encoding(&self) -> Encoding {
        self.encoding
    }

    /// Answer one message from the client.
    ///
    /// A request always produces exactly one response — a client that gets none waits forever. A
    /// notification produces zero or more notifications and never a response, because there is no
    /// id to answer to.
    pub fn handle(&mut self, msg: RequestObject) -> Vec<Outgoing> {
        let (method, id, params) = msg.into_parts();
        let params = params.unwrap_or(serde_json::Value::Null);
        match (method.as_str(), id) {
            ("initialize", Some(id)) => vec![self.initialize(id, params)],
            // ANSWERED HERE, AND UNREACHABLE FROM THE BINARY. `main.rs` calls
            // `Connection::handle_shutdown` before it dispatches, and that helper answers the
            // request itself, so no `shutdown` ever arrives at this arm over stdio — see that
            // file's module doc. The arm is for the OTHER caller this file's own doc argues for: a
            // wasm driver has no `lsp-server` and no `handle_shutdown`, and a request that gets no
            // answer is a client that waits forever.
            ("shutdown", Some(id)) => {
                vec![Outgoing::Response(ResponseObject::from_success::<ShutdownRequest>(id, ()))]
            }
            ("textDocument/didOpen", None) => self.did_open(params),
            ("textDocument/didChange", None) => self.did_change(params),
            ("textDocument/didClose", None) => self.did_close(params),
            ("textDocument/formatting", Some(id)) => vec![self.formatting(id, params)],
            ("textDocument/definition", Some(id)) => vec![self.definition(id, params)],
            ("textDocument/references", Some(id)) => vec![self.references(id, params)],
            ("textDocument/documentSymbol", Some(id)) => vec![self.document_symbol(id, params)],
            (_, Some(id)) => vec![Outgoing::Response(ResponseObject::from_error(
                id,
                Error {
                    code: ErrorCodes::MethodNotFound,
                    message: format!("redextape-lsp does not serve {method}"),
                    data: None,
                },
            ))],
            // `initialized` and `exit` land here along with every notification this server does
            // not recognise: a notification carries no id, so there is never a response to send.
            (_, None) => Vec::new(),
        }
    }

    fn initialize(&mut self, id: Id, params: serde_json::Value) -> Outgoing {
        // A client whose `initialize` params do not deserialize still gets a server: every field
        // this slice reads is optional, so `default()` answers exactly as a client that sent none
        // would be answered. Failing the handshake over an unrecognised extension field would be a
        // worse trade than ignoring it.
        let params: InitializeParams = serde_json::from_value(params).unwrap_or_default();
        let offered = params.capabilities.general.as_ref().and_then(|g| g.position_encodings.as_deref());
        self.encoding = Encoding::negotiate(offered);
        self.hierarchical_symbols = params
            .capabilities
            .text_document
            .as_ref()
            .and_then(|t| t.document_symbol.as_ref())
            .and_then(|d| d.hierarchical_document_symbol_support)
            .unwrap_or(false);

        let capabilities = ServerCapabilities {
            position_encoding: Some(self.encoding.kind()),
            // FULL, deliberately: these files are small, and incremental sync is an optimization
            // that buys a class of bugs before it buys anything else.
            text_document_sync: Some(TextDocumentSync::Kind(TextDocumentSyncKind::Full)),
            document_formatting_provider: Some(DocumentFormattingProvider::Bool(true)),
            definition_provider: Some(DefinitionProvider::Bool(true)),
            references_provider: Some(ReferencesProvider::Bool(true)),
            document_symbol_provider: Some(DocumentSymbolProvider::Bool(true)),
            // Everything else stays `None`. Diagnostics are PUSHED, via `publishDiagnostics`, which
            // needs no capability entry: it is universally supported, where pull diagnostics are a
            // 3.17 addition this slice does not need.
            ..ServerCapabilities::default()
        };

        Outgoing::Response(ResponseObject::from_success::<InitializeRequest>(
            id,
            InitializeResult {
                capabilities,
                server_info: Some(ServerInfo {
                    name: "redextape-lsp".to_string(),
                    version: Some(env!("CARGO_PKG_VERSION").to_string()),
                }),
            },
        ))
    }

    fn did_open(&mut self, params: serde_json::Value) -> Vec<Outgoing> {
        let Ok(params) = serde_json::from_value::<DidOpenTextDocumentParams>(params) else {
            return Vec::new();
        };
        let item = params.text_document;
        let uri = item.uri.to_string();
        self.documents.open(uri.clone(), &item.language_id.to_string(), item.version, item.text);
        vec![self.publish(&uri)]
    }

    fn did_change(&mut self, params: serde_json::Value) -> Vec<Outgoing> {
        let Ok(params) = serde_json::from_value::<DidChangeTextDocumentParams>(params) else {
            return Vec::new();
        };
        let uri = params.text_document.text_document_identifier.uri.to_string();
        // `FULL` sync, so the LAST whole-document change is the document. A partial change is not
        // something a client should send us — we advertised `Full` — and taking its text as the
        // whole file would corrupt the buffer, so it is skipped rather than misread.
        let Some(text) = params.content_changes.into_iter().rev().find_map(|c| match c {
            TextDocumentContentChangeEvent::TextDocumentContentChangeWholeDocument(w) => Some(w.text),
            TextDocumentContentChangeEvent::TextDocumentContentChangePartial(_) => None,
        }) else {
            return Vec::new();
        };
        self.documents.replace(&uri, params.text_document.version, text);
        vec![self.publish(&uri)]
    }

    fn did_close(&mut self, params: serde_json::Value) -> Vec<Outgoing> {
        let Ok(params) = serde_json::from_value::<DidCloseTextDocumentParams>(params) else {
            return Vec::new();
        };
        let uri = params.text_document.uri.to_string();
        self.documents.close(&uri);
        // AN EMPTY PUBLISH ON CLOSE IS NOT A FORMALITY. Without it the editor keeps showing the
        // diagnostics of a file that is no longer open, and nothing will ever clear them.
        //
        // This is `publish`, not a hand-built notification, so it DERIVES from the document map
        // rather than assuming what `close` did: an untracked URI already publishes an empty list
        // with no version, which is what this needs, but if `close` failed to remove the document
        // `publish` would find it still present and emit its real diagnostics instead — making a
        // broken `close` observable here rather than silently producing the right-looking output.
        vec![self.publish(&uri)]
    }

    /// Format a whole document.
    ///
    /// **THE ANSWER IS `null`, NOT AN ERROR, FOR EVERY CASE THIS SERVER CANNOT FORMAT** — an
    /// unknown URI, a language it does not serve, a file that does not parse. `null` is what LSP
    /// says "no edits" is, and an error would surface in the editor as a failed command for the
    /// ordinary case of formatting a file that currently has a syntax error in it.
    fn formatting(&self, id: Id, params: serde_json::Value) -> Outgoing {
        let params = match serde_json::from_value::<DocumentFormattingParams>(params) {
            Ok(p) => p,
            Err(e) => return invalid_params(id, "textDocument/formatting", &e),
        };
        let edits = Some(params).and_then(|p| {
            let uri = p.text_document.uri.to_string();
            let doc = self.documents.get(&uri)?;
            let formatted = doc.language?.format(&doc.text)?;
            // ONE EDIT OVER THE WHOLE BUFFER. `textDocumentSync` is `FULL` and the formatter is
            // `print ∘ parse`, so there is no diff to express: the new text IS the file. A
            // range that stopped short would append the formatted file to the remains of the
            // old one.
            Some(vec![TextEdit {
                range: Range::new(Position::new(0, 0), doc.index.end_position(&doc.text, self.encoding)),
                new_text: formatted,
            }])
        });
        Outgoing::Response(ResponseObject::from_success::<DocumentFormattingRequest>(id, edits))
    }

    /// Go to the definition of the name under the cursor.
    ///
    /// `null` for every case with no answer — an unknown URI, a form with no index, a cursor
    /// that is not on a name, a reference to a name nothing defines. `null` is what LSP says
    /// "no definition" is, and an error would surface in the editor as a failed command for the
    /// ordinary case of a cursor sitting on a keyword.
    fn definition(&self, id: Id, params: serde_json::Value) -> Outgoing {
        let params = match serde_json::from_value::<DefinitionParams>(params) {
            Ok(p) => p,
            Err(e) => return invalid_params(id, "textDocument/definition", &e),
        };
        let found = Some(params).and_then(|p| {
            let pos = p.text_document_position_params;
            let (doc, nav, offset) = self.locate(pos.text_document.uri.as_ref(), pos.position)?;
            let (i, _) = nav.at(offset)?;
            let target = nav.get(nav.definition_of(i)?)?;
            Some(DefinitionResponse::Definition(Definition::Location(Location::new(
                pos.text_document.uri,
                doc.index.range(&doc.text, target.span, self.encoding),
            ))))
        });
        Outgoing::Response(ResponseObject::from_success::<DefinitionRequest>(id, found))
    }

    /// Every mention of the name under the cursor, in this document.
    ///
    /// **THE DECLARATION IS INCLUDED ONLY WHEN THE CLIENT ASKS FOR IT.** `include_declaration`
    /// is a parameter, not a preference: answering the same list either way would be ignoring
    /// it. It comes first when present, which is where an editor's quickfix list wants it.
    fn references(&self, id: Id, params: serde_json::Value) -> Outgoing {
        let params = match serde_json::from_value::<ReferenceParams>(params) {
            Ok(p) => p,
            Err(e) => return invalid_params(id, "textDocument/references", &e),
        };
        let found = Some(params).and_then(|p| {
            let include = p.context.include_declaration;
            let pos = p.text_document_position_params;
            let uri = pos.text_document.uri;
            let (doc, nav, offset) = self.locate(uri.as_ref(), pos.position)?;
            let (i, _) = nav.at(offset)?;
            // **A NAME NOTHING DEFINES STILL HAS OTHER MENTIONS, AND THE INDEX IS HOLDING THEM.**
            // This used to short-circuit on `definition_of(i)?` and answer `null`, which tells
            // someone hunting every `jmp nowhere` still to fix that the name under their cursor is
            // not a name — in exactly the mid-edit state `nav.rs`'s module doc calls the moment
            // navigation is worth most. `include_declaration` has nothing to include here, so it
            // is not consulted: with no binding, every occurrence of the name IS a reference,
            // including the one under the cursor.
            let spans: Vec<_> = match nav.definition_of(i) {
                Some(def) => include
                    .then(|| nav.get(def).map(|o| o.span))
                    .flatten()
                    .into_iter()
                    .chain(nav.references_to(def).map(|o| o.span))
                    .collect(),
                None => nav.dangling_like(i).map(|o| o.span).collect(),
            };
            Some(
                spans
                    .into_iter()
                    .map(|s| Location::new(uri.clone(), doc.index.range(&doc.text, s, self.encoding)))
                    .collect::<Vec<_>>(),
            )
        });
        Outgoing::Response(ResponseObject::from_success::<ReferencesRequest>(id, found))
    }

    /// Every name this document DEFINES, flat and in source order.
    ///
    /// **FLAT, NOT NESTED.** Rules could hang under their state, but the demo suite contains a
    /// machine of **7,353 states carrying 18,499 rules**, and an outline nesting the second under
    /// the first is not one a human uses. (An earlier version of this sentence said "25,852
    /// states". That is `map_fold`'s ROW count — the states and the rules added together — so it
    /// both inflated the state count 3.5x and named the one quantity that is neither of the two
    /// this decision is about.)
    ///
    /// `range` and `selection_range` are both the name's span. The protocol only requires the
    /// selection range to be contained by the range, and the index stores name spans — a range
    /// enclosing a whole state's rules would mean the parser recording where each state's block
    /// ends, which is more than navigation needs.
    ///
    /// The `SymbolKind` is chosen HERE because this is the one place that knows the document's
    /// language; `nav.rs` deliberately holds no grammar and cannot tell a state from a label.
    fn document_symbol(&self, id: Id, params: serde_json::Value) -> Outgoing {
        let params = match serde_json::from_value::<DocumentSymbolParams>(params) {
            Ok(p) => p,
            Err(e) => return invalid_params(id, "textDocument/documentSymbol", &e),
        };
        let found = Some(params).and_then(|p| {
            let uri = p.text_document.uri;
            let doc = self.documents.get(uri.as_ref())?;
            // `symbol_kind` lives beside `nav` in `language.rs`, so the two lists of languages
            // cannot drift apart unseen; `None` here is the same answer `nav` gives.
            let kind = doc.language?.symbol_kind()?;
            let nav = doc.nav.as_ref()?;
            let symbols = nav.definitions().map(|o| {
                let selection_range = doc.index.range(&doc.text, o.span, self.encoding);
                let range = doc.index.range(&doc.text, enclosing_line(&doc.text, o.span), self.encoding);
                (o.name.clone(), range, selection_range)
            });
            Some(if self.hierarchical_symbols {
                DocumentSymbolResponse::DocumentSymbolList(
                    symbols
                        .map(|(name, range, selection_range)| {
                            // `DocumentSymbol::deprecated` is a #[deprecated] field with no
                            // default and a positional slot in `::new`, so BOTH construction
                            // routes trip the lint that `-D warnings` makes fatal.
                            #[allow(deprecated)]
                            DocumentSymbol {
                                name,
                                detail: None,
                                kind,
                                tags: None,
                                deprecated: None,
                                range,
                                selection_range,
                                children: None,
                            }
                        })
                        .collect(),
                )
            } else {
                // **THE FLAT SHAPE IS NOT A FALLBACK, IT IS WHAT THE PROTOCOL SAYS THIS CLIENT
                // ASKED FOR.** `DocumentSymbol[]` is conditional on
                // `hierarchicalDocumentSymbolSupport`; a client without it expects
                // `SymbolInformation[]`, whose members carry a `location` rather than a `range`.
                // `DocumentSymbolResponse` is `#[serde(untagged)]`, so sending the wrong arm is
                // not a protocol error the client can report — it is an empty outline with
                // nothing logged on either side.
                DocumentSymbolResponse::SymbolInformationList(
                    symbols
                        .map(|(name, range, _)| {
                            #[allow(deprecated)]
                            SymbolInformation {
                                deprecated: None,
                                location: Location::new(uri.clone(), range),
                                base_symbol_information: BaseSymbolInformation {
                                    name,
                                    kind,
                                    tags: None,
                                    container_name: None,
                                },
                            }
                        })
                        .collect(),
                )
            })
        });
        Outgoing::Response(ResponseObject::from_success::<DocumentSymbolRequest>(id, found))
    }

    /// The document, its index and the cursor as a byte offset — the three things every
    /// navigation handler starts from.
    ///
    /// One place, so the three handlers cannot disagree about what "the name under the cursor"
    /// means. `None` for an untracked URI or a form this server does not index.
    fn locate(&self, uri: &str, pos: Position) -> Option<(&crate::document::Document, &NameIndex, usize)> {
        let doc = self.documents.get(uri)?;
        // The index is CACHED per document version beside `LineIndex` — see `Document::nav`. This
        // used to rebuild it per request, which is a whole parse, and then return it by value.
        let nav = doc.nav.as_ref()?;
        let offset = doc.index.offset(&doc.text, pos, self.encoding);
        Some((doc, nav, offset))
    }

    /// The `publishDiagnostics` notification for one document.
    ///
    /// Always a notification, never nothing: an EMPTY list is the message that clears the previous
    /// one, so a server that goes silent when a file becomes clean leaves the editor showing errors
    /// the user has already fixed. An untracked URI and a document in a language this server does
    /// not serve both produce an empty list, for the same reason.
    fn publish(&self, uri: &str) -> Outgoing {
        // ONE LOOKUP FEEDS BOTH FIELDS. The two `get`s this replaces could not disagree — nothing
        // mutates between them — so this changes no behaviour. It is that the diagnostics and the
        // version they are reported against are one answer about one document, and looking the
        // document up twice wrote it as two.
        let doc = self.documents.get(uri);
        let version = doc.map(|d| d.version);
        let diagnostics = doc
            .map(|doc| {
                doc.language.map_or_else(Vec::new, |lang| {
                    lang.diagnostics(&doc.text).into_iter().map(|d| to_lsp_diagnostic(&d, doc, self.encoding)).collect()
                })
            })
            .unwrap_or_default();
        Outgoing::Notification(RequestObject::from_notification::<PublishDiagnosticsNotification>(
            PublishDiagnosticsParams { uri: uri.into(), version, diagnostics },
        ))
    }
}

/// The answer to a request this server could not READ.
///
/// **`null` IS THE ANSWER TO A QUESTION WITH NO ANSWER; IT IS NOT THE ANSWER TO A QUESTION THAT DID
/// NOT PARSE.** All four request handlers used to deserialize with `.ok()`, so a client that sent
/// `textDocument/references` without the required `context`, or a `position.line` as a string, got
/// a SUCCESS response of `null` — indistinguishable from "this name has no references", which is a
/// plausible answer, so the client bug never surfaced to anyone. The `null`-for-no-answer rule
/// `formatting` established is about cases the SERVER cannot answer, and that argument does not
/// reach a request it could not read.
fn invalid_params(id: Id, method: &str, err: &serde_json::Error) -> Outgoing {
    Outgoing::Response(ResponseObject::from_error(
        id,
        Error { code: ErrorCodes::InvalidParams, message: format!("{method}: {err}"), data: None },
    ))
}

/// The span of the whole line `span` sits on, terminator excluded.
///
/// **`DocumentSymbol::range` IS NOT DECORATION, IT IS WHAT A CLIENT TESTS THE CURSOR AGAINST.** The
/// protocol defines it as the region used to decide whether the caret is inside the symbol, and
/// `selectionRange` as the part to reveal — so setting both to the name span made breadcrumbs,
/// sticky scroll and nvim-navic report no symbol for every position except the few columns of the
/// name itself. The name span still goes to `selectionRange`, which is what it is for. Containment
/// holds either way, which is the only requirement the earlier doc comment checked itself against.
///
/// A line rather than a whole `state` block: the index stores name spans, and recording where each
/// block ends is more than navigation needs. A line is the smallest span that makes the cursor test
/// behave, and is exact for `.asm`, where a label IS its line.
fn enclosing_line(text: &str, span: redextape_core::Span) -> redextape_core::Span {
    let start = text.get(..span.start).map_or(span.start, |b| b.rfind('\n').map_or(0, |i| i + 1));
    let rest = text.get(span.end..).unwrap_or("");
    let end = rest.find('\n').map_or(text.len(), |i| span.end + i);
    let end = if text.get(end.saturating_sub(1)..end) == Some("\r") { end - 1 } else { end };
    redextape_core::Span { start, end }
}

/// A `redextape-core` diagnostic as the protocol's.
///
/// `source` names this server so a buffer with several language servers attached shows which one
/// said what. There is no `code`: these diagnostics do not carry one, and inventing a stable
/// identifier here would be a second naming scheme with nothing behind it.
fn to_lsp_diagnostic(
    d: &redextape_core::Diagnostic,
    doc: &crate::document::Document,
    enc: Encoding,
) -> gen_lsp_types::Diagnostic {
    gen_lsp_types::Diagnostic {
        range: doc.index.range(&doc.text, d.span, enc),
        severity: Some(match d.severity {
            redextape_core::Severity::Error => DiagnosticSeverity::Error,
            redextape_core::Severity::Warning => DiagnosticSeverity::Warning,
        }),
        message: d.message.clone().into(),
        source: Some("redextape".to_string()),
        ..gen_lsp_types::Diagnostic::default()
    }
}

#[cfg(test)]
mod tests {
    use gen_lsp_types::json_rpc::{Id, RequestObject};
    use gen_lsp_types::{InitializeParams, InitializeResult, PositionEncodingKind};
    use serde_json::json;

    use super::*;
    use crate::language::Language;
    use crate::position::Encoding;

    /// Exactly ONE diagnostic: "duplicate `tapes` line", on line 1 (0-indexed).
    const TM_DUP: &str = "tapes 1\ntapes 2\nstart q0\nstate q0: accept\n";

    /// Clean — zero diagnostics.
    const TM_CLEAN: &str = "tapes 1\nstart q0\nstate q0: accept\n";

    /// Clean. Seven `\n` characters, and it ends with one — so the document ends at line 7, character 0.
    const TM_COMMENTS: &str = "\
; a machine
tapes 1
start q0

state q0:
  [a] -> write [b], move [R], goto q1 ; and a trailing one
state q1: accept
";

    /// Build a client request. Named rather than inlined because every test below needs one and
    /// `RequestObject`'s fields are private — `serde_json::from_value` is the constructor.
    ///
    /// Takes `params` by reference: `json!` only ever borrows it to build the envelope, and a
    /// by-value parameter that is never consumed is `clippy::needless_pass_by_value`.
    fn request(id: i64, method: &str, params: &serde_json::Value) -> RequestObject {
        serde_json::from_value(json!({
            "jsonrpc": "2.0", "id": id, "method": method, "params": params
        }))
        .expect("a well-formed request object")
    }

    fn notification(method: &str, params: &serde_json::Value) -> RequestObject {
        serde_json::from_value(json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .expect("a well-formed notification object")
    }

    fn initialize_result(out: &[Outgoing]) -> InitializeResult {
        let [Outgoing::Response(r)] = out else { panic!("expected exactly one response, got {out:?}") };
        serde_json::from_value(r.result().expect("a success response").clone()).expect("an InitializeResult")
    }

    /// The raw JSON value of one successful response. Untyped, unlike `initialize_result` and
    /// `format_edits`: the navigation tests below assert on individual fields of a `Location` or
    /// on `null`, and a single shared shape for both would have to be `Option<Location>` anyway.
    fn success_value(out: &[Outgoing]) -> serde_json::Value {
        let [Outgoing::Response(r)] = out else { panic!("expected exactly one response, got {out:?}") };
        r.result().expect("a success response").clone()
    }

    /// The error half of `success_value`.
    fn error_of(out: &[Outgoing]) -> gen_lsp_types::json_rpc::Error {
        let [Outgoing::Response(r)] = out else { panic!("expected exactly one response, got {out:?}") };
        r.error().expect("an error response").clone()
    }

    #[test]
    fn references_on_a_name_nothing_defines_lists_its_other_mentions() {
        // Probed: this parses with `program: Some` and ZERO diagnostics — asm never checks jump
        // targets — and records two dangling references to `nowhere`. This used to answer `null`,
        // which tells someone hunting every jump still to fix that the name under their cursor is
        // not a name. `include_declaration` has nothing to include: with no binding, every
        // occurrence IS a reference, so both are listed either way.
        let mut server = Server::new();
        server.handle(notification(
            "textDocument/didOpen",
            &json!({"textDocument": {
                "uri": "file:///d.asm", "languageId": "redextape_asm", "version": 1,
                "text": "result Nat\nf:\n\tjmp\tnowhere\n\tjz\tr0, nowhere\n\tret\n"
            }}),
        ));
        for include in [false, true] {
            let out = server.handle(request(
                3,
                "textDocument/references",
                &json!({
                    "textDocument": {"uri": "file:///d.asm"},
                    "position": {"line": 2, "character": 5},
                    "context": {"includeDeclaration": include}
                }),
            ));
            let v = success_value(&out);
            let lines: Vec<_> =
                v.as_array().expect("an array").iter().map(|l| l["range"]["start"]["line"].as_u64()).collect();
            assert_eq!(lines, vec![Some(2), Some(3)], "both jumps, includeDeclaration={include}");
        }
    }

    #[test]
    fn a_request_this_server_cannot_read_is_an_error_not_a_null() {
        // **`null` IS THE ANSWER TO A QUESTION WITH NO ANSWER, NOT TO ONE THAT DID NOT PARSE.**
        // All four handlers deserialized with `.ok()`, so a client omitting `context` — a required
        // field with no serde default — was told the name has no references, which is a plausible
        // answer and therefore one nobody investigates.
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        let cases = [
            // `references` with no `context` at all.
            (
                "textDocument/references",
                json!({"textDocument": {"uri": "file:///a.tm"}, "position": {"line": 1, "character": 6}}),
            ),
            // `definition` with no `position`.
            ("textDocument/definition", json!({"textDocument": {"uri": "file:///a.tm"}})),
            // `definition` with a `line` of the wrong type.
            (
                "textDocument/definition",
                json!({"textDocument": {"uri": "file:///a.tm"}, "position": {"line": "1", "character": 6}}),
            ),
            // `documentSymbol` with no `textDocument`.
            ("textDocument/documentSymbol", json!({})),
            // `formatting`, which established the `null` rule and is corrected with the rest.
            // NOTE it needs a missing `textDocument`, not a missing `options`: `FormattingOptions`
            // deserializes from an absent field, so the obvious malformed formatting request is
            // not malformed at all — checked rather than assumed.
            ("textDocument/formatting", json!({})),
        ];
        for (method, params) in cases {
            let out = server.handle(request(9, method, &params));
            assert!(
                matches!(&out[..], [Outgoing::Response(r)] if r.error().is_some()),
                "{method} with {params} was not an error: {out:?}"
            );
            let e = error_of(&out);
            assert_eq!(e.code, ErrorCodes::InvalidParams, "{method} with {params}");
            assert!(e.message.starts_with(method), "the message names the method: {:?}", e.message);
        }
    }

    #[test]
    fn initialize_advertises_full_sync_and_formatting() {
        let mut server = Server::new();
        let out = server.handle(request(1, "initialize", &json!(InitializeParams::default())));
        let caps = initialize_result(&out).capabilities;

        assert_eq!(caps.text_document_sync, Some(TextDocumentSync::Kind(TextDocumentSyncKind::Full)));
        assert_eq!(caps.document_formatting_provider, Some(DocumentFormattingProvider::Bool(true)));
        // Slice 1 advertises no semantic tokens: the four grammars already highlight all four forms
        // in the target editor, so the server would be a second, competing answer to a solved
        // question. Asserted so that adding one is a deliberate edit to this line.
        assert_eq!(caps.semantic_tokens_provider, None);
        assert_eq!(caps.hover_provider, None);
        // Slice 2 serves definition. The two assertions above it stay: they are what keeps a
        // capability this server does not serve from appearing without a decision.
        assert_eq!(caps.definition_provider, Some(DefinitionProvider::Bool(true)));
    }

    #[test]
    fn the_negotiated_encoding_is_echoed_in_the_capabilities() {
        // The client's offer and the server's answer are two halves of one handshake, and a server
        // that negotiates utf-8 internally while echoing utf-16 would place every diagnostic
        // wrongly in exactly the files where the two differ.
        let mut server = Server::new();
        let params = json!({ "capabilities": { "general": { "positionEncodings": ["utf-8", "utf-16"] } } });
        let out = server.handle(request(1, "initialize", &params));
        assert_eq!(initialize_result(&out).capabilities.position_encoding, Some(PositionEncodingKind::UTF8));
        assert_eq!(server.encoding(), Encoding::Utf8);

        let mut server = Server::new();
        let params = json!({ "capabilities": { "general": { "positionEncodings": ["utf-16"] } } });
        let out = server.handle(request(1, "initialize", &params));
        assert_eq!(initialize_result(&out).capabilities.position_encoding, Some(PositionEncodingKind::UTF16));
        assert_eq!(server.encoding(), Encoding::Utf16);

        let mut server = Server::new();
        let out = server.handle(request(1, "initialize", &json!({ "capabilities": {} })));
        assert_eq!(initialize_result(&out).capabilities.position_encoding, Some(PositionEncodingKind::UTF16));
        assert_eq!(server.encoding(), Encoding::Utf16);
    }

    #[test]
    fn shutdown_is_answered_and_initialized_and_exit_are_silent() {
        let mut server = Server::new();
        let out = server.handle(request(2, "shutdown", &json!(null)));
        let [Outgoing::Response(r)] = out.as_slice() else { panic!("expected one response") };
        assert!(r.is_ok());
        assert_eq!(r.id(), &Id::from(2i64));

        assert!(server.handle(notification("initialized", &json!({}))).is_empty());
        assert!(server.handle(notification("exit", &json!(null))).is_empty());
    }

    #[test]
    fn an_unhandled_request_gets_method_not_found_and_an_unhandled_notification_gets_silence() {
        // A request MUST be answered or the client waits forever; a notification MUST NOT be,
        // because there is no id to answer to. The two halves are why this is one test.
        let mut server = Server::new();
        let out = server.handle(request(3, "textDocument/hover", &json!({})));
        let [Outgoing::Response(r)] = out.as_slice() else { panic!("expected one response") };
        assert_eq!(r.error().map(|e| e.code), Some(ErrorCodes::MethodNotFound));

        assert!(server.handle(notification("$/setTrace", &json!({ "value": "off" }))).is_empty());
    }

    fn published(out: &[Outgoing]) -> PublishDiagnosticsParams {
        let [Outgoing::Notification(n)] = out else { panic!("expected exactly one notification, got {out:?}") };
        assert_eq!(n.method(), "textDocument/publishDiagnostics");
        serde_json::from_value(n.params().expect("params").clone()).expect("PublishDiagnosticsParams")
    }

    fn did_open(server: &mut Server, uri: &str, language_id: &str, text: &str) -> Vec<Outgoing> {
        server.handle(notification(
            "textDocument/didOpen",
            &json!({ "textDocument": { "uri": uri, "languageId": language_id, "version": 1, "text": text } }),
        ))
    }

    fn format_edits(server: &mut Server, uri: &str) -> Option<Vec<TextEdit>> {
        let out = server.handle(request(
            9,
            "textDocument/formatting",
            &json!({
                "textDocument": { "uri": uri },
                "options": { "tabSize": 2, "insertSpaces": true }
            }),
        ));
        let [Outgoing::Response(r)] = out.as_slice() else { panic!("expected one response, got {out:?}") };
        serde_json::from_value(r.result().expect("a success response").clone()).expect("Option<Vec<TextEdit>>")
    }

    #[test]
    fn formatting_replaces_the_whole_document_and_keeps_every_comment() {
        let mut server = Server::new();
        server.handle(request(
            1,
            "initialize",
            &json!({ "capabilities": { "general": { "positionEncodings": ["utf-8"] } } }),
        ));

        did_open(&mut server, "file:///a.tm", "redextape_tm", TM_COMMENTS);

        let edits = format_edits(&mut server, "file:///a.tm").expect("a formattable file");
        assert_eq!(edits.len(), 1, "FULL sync, so formatting is one whole-document edit");

        // The range covers the whole buffer: from the very start to the very end. Getting this
        // wrong appends the formatted file to the unformatted one rather than replacing it.
        assert_eq!(edits[0].range.start, Position::new(0, 0));
        assert_eq!(edits[0].range.end, Position::new(7, 0), "TM_COMMENTS has 7 newlines and ends with one");

        assert!(edits[0].new_text.contains("; a machine"), "own-line comment lost:\n{}", edits[0].new_text);
        assert!(edits[0].new_text.contains("; and a trailing one"), "trailing comment lost:\n{}", edits[0].new_text);

        // The three assertions above would ALSO pass if the handler returned the raw, unformatted
        // `doc.text` instead of the printer's output — `TM_COMMENTS` already contains both comment
        // substrings verbatim. This one only the printer can satisfy: it normalises the single
        // space before a trailing comment to two, so a real `format ∘ parse` round trip must differ
        // from the input, byte for byte.
        assert_ne!(
            edits[0].new_text, TM_COMMENTS,
            "the edit must carry the PRINTER's output, not the buffer's own text — these assertions \
             would otherwise pass against a handler that returned doc.text unchanged"
        );
    }

    #[test]
    fn formatting_a_file_that_does_not_parse_answers_null_rather_than_a_partial_buffer() {
        let mut server = Server::new();
        server.handle(request(1, "initialize", &json!(InitializeParams::default())));
        did_open(&mut server, "file:///a.tm", "redextape_tm", "tapes\n");
        assert_eq!(format_edits(&mut server, "file:///a.tm"), None);
    }

    #[test]
    fn formatting_an_untracked_uri_answers_null_rather_than_erroring() {
        let mut server = Server::new();
        server.handle(request(1, "initialize", &json!(InitializeParams::default())));
        assert_eq!(format_edits(&mut server, "file:///never-opened.tm"), None);
    }

    #[test]
    fn opening_a_file_publishes_its_diagnostics_at_the_right_span() {
        let mut server = Server::new();
        server.handle(request(
            1,
            "initialize",
            &json!({ "capabilities": { "general": { "positionEncodings": ["utf-8"] } } }),
        ));

        // A `.tm` whose second line is the error, so a handler that reported everything at 0:0
        // would be visibly wrong rather than accidentally right.
        let out = did_open(&mut server, "file:///a.tm", "redextape_tm", TM_DUP);
        let p = published(&out);

        assert_eq!(p.uri.to_string(), "file:///a.tm");
        assert_eq!(p.version, Some(1));
        assert_eq!(p.diagnostics.len(), 1, "expected the duplicate-tapes error: {:?}", p.diagnostics);
        assert_eq!(p.diagnostics[0].range.start.line, 1, "the SECOND line is the duplicate");
        assert_eq!(p.diagnostics[0].severity, Some(DiagnosticSeverity::Error));
    }

    #[test]
    fn a_clean_file_publishes_an_empty_list_rather_than_nothing() {
        // AN EMPTY PUBLISH IS THE MESSAGE THAT CLEARS THE PREVIOUS ONE. A server that stays silent
        // when a file becomes clean leaves the editor showing errors the user has already fixed —
        // which is worse than never having shown them.
        let mut server = Server::new();
        server.handle(request(1, "initialize", &json!(InitializeParams::default())));

        assert_eq!(published(&did_open(&mut server, "file:///a.tm", "redextape_tm", TM_DUP)).diagnostics.len(), 1);

        let out = server.handle(notification(
            "textDocument/didChange",
            &json!({
                "textDocument": { "uri": "file:///a.tm", "version": 2 },
                "contentChanges": [{ "text": TM_CLEAN }]
            }),
        ));
        let p = published(&out);
        assert_eq!(p.diagnostics, vec![], "a fixed file must publish an EMPTY list, not stay silent");
        assert_eq!(p.version, Some(2));
    }

    #[test]
    fn a_partial_change_is_skipped_rather_than_taken_for_the_whole_file() {
        // `FULL` sync is what this server advertises, so a partial change is not something a client
        // should send — and taking its `text` for the whole document would replace the buffer with
        // the fragment. The skip is the behaviour under test, and it is only observable from here:
        // nothing is stored, so the editor keeps the file and the diagnostics it already has rather
        // than being told a five-character document is clean.
        let mut server = Server::new();
        server.handle(request(1, "initialize", &json!(InitializeParams::default())));
        assert_eq!(published(&did_open(&mut server, "file:///a.tm", "redextape_tm", TM_DUP)).diagnostics.len(), 1);

        let out = server.handle(notification(
            "textDocument/didChange",
            &json!({
                "textDocument": { "uri": "file:///a.tm", "version": 2 },
                "contentChanges": [{
                    "range": {
                        "start": { "line": 0, "character": 0 },
                        "end": { "line": 0, "character": 5 }
                    },
                    "text": "tapes"
                }]
            }),
        ));
        assert!(out.is_empty(), "a partial change must publish nothing, got {out:?}");

        let doc = server.documents.get("file:///a.tm").expect("the document is still tracked");
        assert_eq!(doc.text, TM_DUP, "the buffer must keep its own text, not become the fragment");
        assert_eq!(doc.version, 1, "a change that was not applied must not advance the version");

        // The same else-arm reached the other way: `contentChanges` empty. There is nothing to
        // apply, so there is nothing to publish, and the document is left exactly as it was.
        let out = server.handle(notification(
            "textDocument/didChange",
            &json!({ "textDocument": { "uri": "file:///a.tm", "version": 3 }, "contentChanges": [] }),
        ));
        assert!(out.is_empty(), "an empty contentChanges must publish nothing, got {out:?}");
        let doc = server.documents.get("file:///a.tm").expect("the document is still tracked");
        assert_eq!(doc.text, TM_DUP);
        assert_eq!(doc.version, 1);
    }

    #[test]
    fn closing_a_file_clears_its_diagnostics_and_forgets_it() {
        let mut server = Server::new();
        server.handle(request(1, "initialize", &json!(InitializeParams::default())));
        did_open(&mut server, "file:///a.tm", "redextape_tm", TM_DUP);

        let out =
            server.handle(notification("textDocument/didClose", &json!({ "textDocument": { "uri": "file:///a.tm" } })));
        assert_eq!(published(&out).diagnostics, vec![]);

        // The document is gone, so formatting it answers null rather than erroring — the same
        // "cannot serve this" answer as any other untracked URI.
        let out = server.handle(request(
            9,
            "textDocument/formatting",
            &json!({
                "textDocument": { "uri": "file:///a.tm" },
                "options": { "tabSize": 2, "insertSpaces": true }
            }),
        ));
        let [Outgoing::Response(r)] = out.as_slice() else { panic!("expected one response") };
        assert_eq!(r.result(), Some(&serde_json::Value::Null));
    }

    #[test]
    fn unknown_language_id_is_answered() {
        // §3.2's fallback, asserted rather than assumed. The document is tracked — it must not
        // vanish — and every language-specific answer is empty.
        let mut server = Server::new();
        server.handle(request(1, "initialize", &json!(InitializeParams::default())));

        let out = did_open(&mut server, "file:///a.rs", "rust", "fn main() { let x: i32 = \"\"; }\n");
        assert_eq!(published(&out).diagnostics, vec![], "a Rust buffer must not get redextape errors");

        // Rust is not one of the four forms this server serves, so formatting it answers null
        // rather than erroring — same "cannot serve this" answer as an unparseable file.
        let out = server.handle(request(
            9,
            "textDocument/formatting",
            &json!({
                "textDocument": { "uri": "file:///a.rs" },
                "options": { "tabSize": 4, "insertSpaces": true }
            }),
        ));
        let [Outgoing::Response(r)] = out.as_slice() else { panic!("expected one response") };
        assert_eq!(r.result(), Some(&serde_json::Value::Null));
    }

    #[test]
    fn all_four_forms_publish_the_diagnostics_their_front_ends_report() {
        let mut server = Server::new();
        server.handle(request(1, "initialize", &json!(InitializeParams::default())));
        for (uri, id, src) in [
            ("file:///a.rxt", "redextape", "1 + true"),
            ("file:///a.rxlambda", "redextape_lambda", "λx."),
            ("file:///a.tm", "redextape_tm", "tapes\n"),
            ("file:///a.asm", "redextape_asm", "li\n"),
        ] {
            let out = did_open(&mut server, uri, id, src);
            let p = published(&out);
            let expected = Language::from_language_id(id).expect("one of the four").diagnostics(src).len();
            assert_eq!(p.diagnostics.len(), expected, "{id} published the wrong count");
            assert!(expected > 0, "{id}'s fixture must actually error or this proves nothing");
        }
    }

    /// `scan` is defined at 25 and referenced at 14 (`start`) and 66 (`goto`). Three
    /// occurrences of one name, so a handler that returns "some scan" is distinguishable
    /// from one that returns the right one.
    const NAV_TM: &str = "tapes 1\nstart scan\nstate scan:\n  [1] -> write [*], move [R], goto scan\n  [*] -> write [1], move [S], goto halt\nstate halt: accept\n";

    /// `initialize` with `hierarchicalDocumentSymbolSupport`, which is what Neovim and VS Code
    /// both send. Without it the server answers `documentSymbol` with `SymbolInformation[]`, which
    /// the protocol says is what a client that does not advertise it asked for.
    fn init_hierarchical(server: &mut Server) {
        server.handle(request(
            1,
            "initialize",
            &json!({"capabilities": {"textDocument": {"documentSymbol": {"hierarchicalDocumentSymbolSupport": true}}}}),
        ));
    }

    fn open_tm(server: &mut Server, uri: &str, text: &str) {
        server.handle(notification(
            "textDocument/didOpen",
            &json!({"textDocument": {"uri": uri, "languageId": "redextape_tm", "version": 1, "text": text}}),
        ));
    }

    #[test]
    fn definition_on_a_goto_answers_the_state_that_defines_it() {
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        // The `goto scan` at byte 66 is on line 3. Under the default (utf-16) encoding with no
        // multi-byte characters in this fixture, the character column is the byte column.
        let out = server.handle(request(
            2,
            "textDocument/definition",
            &json!({"textDocument": {"uri": "file:///a.tm"}, "position": {"line": 3, "character": 35}}),
        ));
        let v = success_value(&out);
        // Line 2 is `state scan:`; the name begins at character 6. NOT line 1 (`start scan`),
        // which is the other place the string `scan` appears before this one.
        assert_eq!(v["uri"], "file:///a.tm");
        assert_eq!(v["range"]["start"], json!({"line": 2, "character": 6}));
        assert_eq!(v["range"]["end"], json!({"line": 2, "character": 10}));
    }

    #[test]
    fn definition_off_a_name_is_null_rather_than_an_error() {
        // A cursor on whitespace, on a keyword, in a file this server does not serve, or in a
        // file it has never opened. All four are ordinary, and an error would surface in the
        // editor as a failed command.
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        for (uri, line, character) in
            [("file:///a.tm", 0, 0), ("file:///a.tm", 3, 2), ("file:///nope.tm", 2, 6), ("file:///a.tm", 99, 0)]
        {
            let out = server.handle(request(
                2,
                "textDocument/definition",
                &json!({"textDocument": {"uri": uri}, "position": {"line": line, "character": character}}),
            ));
            assert_eq!(success_value(&out), serde_json::Value::Null, "{uri} {line}:{character}");
        }
    }

    #[test]
    fn definition_in_a_broken_file_still_answers() {
        // THE REASON THE INDEX SURVIVES A FAILED PARSE. This file has an unknown goto target,
        // so `machine` is None and it publishes a diagnostic — and go-to-definition on the
        // `start scan` reference still lands on `state scan:`.
        let mut server = Server::new();
        let broken = "tapes 1\nstart scan\nstate scan:\n  [*] -> write [*], move [S], goto nowhere\n";
        open_tm(&mut server, "file:///b.tm", broken);
        let out = server.handle(request(
            2,
            "textDocument/definition",
            &json!({"textDocument": {"uri": "file:///b.tm"}, "position": {"line": 1, "character": 6}}),
        ));
        // The WHOLE location, as the sibling test does: a range whose end or uri were wrong would
        // still satisfy a start-only assertion, and this test's own claim is that navigation is
        // fully answerable in a file that does not parse.
        let v = success_value(&out);
        assert_eq!(v["uri"], "file:///b.tm");
        assert_eq!(v["range"]["start"], json!({"line": 2, "character": 6}));
        assert_eq!(v["range"]["end"], json!({"line": 2, "character": 10}));
    }

    #[test]
    fn definition_works_with_the_cursor_at_the_end_of_a_name() {
        // WHERE THE CARET ACTUALLY SITS after typing a name, after `e`/`w` in Vim, and after a
        // double-click or `End`. `NameIndex::at` answered `null` one past the last byte until it
        // was taught that adjacency counts, under a test asserting "the end is exclusive" as
        // though that were the contract. `start scan` occupies characters 6..10 on line 1, so
        // character 10 is one past the final `n`.
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        for character in [6, 9, 10] {
            let out = server.handle(request(
                2,
                "textDocument/definition",
                &json!({"textDocument": {"uri": "file:///a.tm"}, "position": {"line": 1, "character": character}}),
            ));
            assert_eq!(
                success_value(&out)["range"]["start"],
                json!({"line": 2, "character": 6}),
                "cursor at character {character}"
            );
        }
        // **AND A COLUMN PAST THE END OF THE LINE CANNOT BE THE NEGATIVE CASE ON THIS LINE, WHICH
        // IS WORTH KNOWING RATHER THAN WORKING AROUND.** `LineIndex::offset` clamps such a column
        // to the line's CONTENT end, and line 1 ends with `scan` — so character 11, or 400, is
        // the same byte offset as character 10 and resolves to the same name. That is the right
        // answer (the caret is visually at the end of the name, and there is nothing else on the
        // line) but it means the negative case needs a line with something AFTER the name.
        // Line 2 is `state scan:`, so character 11 is past the colon.
        let out = server.handle(request(
            2,
            "textDocument/definition",
            &json!({"textDocument": {"uri": "file:///a.tm"}, "position": {"line": 2, "character": 11}}),
        ));
        assert_eq!(success_value(&out), serde_json::Value::Null, "past the colon is not the name");
    }

    #[test]
    fn definition_on_a_form_this_server_does_not_serve_is_null() {
        // Coverage for `locate`'s `doc.language?` check. An unrecognised `languageId` still
        // tracks the document — see `unknown_language_id_is_answered` — but `language` is `None`
        // for it, and nothing here may hand that document to any form's `nav`.
        //
        // THE TEXT IS DELIBERATELY VALID `.tm` SYNTAX. A sabotage that drops the check and falls
        // back to some default `Language` would answer this with a real location rather than
        // null, and an arbitrary non-TM fixture (Rust source, say) would not tell the two apart:
        // it parses to an empty index either way, so `null` comes out whether or not the check
        // ran. Sabotage-verified against `doc.language.unwrap_or(Language::Tm)`, which this
        // fixture turns red.
        let mut server = Server::new();
        server.handle(request(1, "initialize", &json!(InitializeParams::default())));
        did_open(&mut server, "file:///a.rs", "rust", NAV_TM);
        let out = server.handle(request(
            2,
            "textDocument/definition",
            &json!({"textDocument": {"uri": "file:///a.rs"}, "position": {"line": 3, "character": 35}}),
        ));
        assert_eq!(success_value(&out), serde_json::Value::Null);
    }

    #[test]
    fn initialize_advertises_the_three_navigation_providers() {
        let mut server = Server::new();
        let out = server.handle(request(1, "initialize", &json!(InitializeParams::default())));
        let caps = initialize_result(&out).capabilities;
        assert_eq!(caps.definition_provider, Some(DefinitionProvider::Bool(true)));
        assert_eq!(caps.references_provider, Some(ReferencesProvider::Bool(true)));
        assert_eq!(caps.document_symbol_provider, Some(DocumentSymbolProvider::Bool(true)));
    }

    #[test]
    fn references_lists_every_mention_and_honours_include_declaration() {
        // `scan` is referenced twice — `start scan` on line 1 and `goto scan` on line 3 — and
        // defined once on line 2. The declaration's inclusion is the CLIENT's choice, so the
        // two calls below must differ; a handler that ignored the flag would pass one of them.
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);

        let ask = |server: &mut Server, include: bool| {
            let out = server.handle(request(
                3,
                "textDocument/references",
                &json!({
                    "textDocument": {"uri": "file:///a.tm"},
                    "position": {"line": 2, "character": 6},
                    "context": {"includeDeclaration": include}
                }),
            ));
            success_value(&out)
                .as_array()
                .expect("an array")
                .iter()
                .map(|l| (l["range"]["start"]["line"].as_u64(), l["range"]["start"]["character"].as_u64()))
                .collect::<Vec<_>>()
        };

        assert_eq!(ask(&mut server, false), vec![(Some(1), Some(6)), (Some(3), Some(35))]);
        assert_eq!(ask(&mut server, true), vec![(Some(2), Some(6)), (Some(1), Some(6)), (Some(3), Some(35))]);
    }

    #[test]
    fn references_from_a_reference_finds_its_siblings_not_just_itself() {
        // Asking from `goto scan` on line 3 must give the same set as asking from the
        // definition. A handler that returned only the occurrence under the cursor would pass
        // a test that asked from the definition and nothing else.
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        let out = server.handle(request(
            3,
            "textDocument/references",
            &json!({
                "textDocument": {"uri": "file:///a.tm"},
                "position": {"line": 3, "character": 35},
                "context": {"includeDeclaration": false}
            }),
        ));
        let lines: Vec<_> = success_value(&out)
            .as_array()
            .expect("an array")
            .iter()
            .map(|l| l["range"]["start"]["line"].as_u64())
            .collect();
        assert_eq!(lines, vec![Some(1), Some(3)]);
    }

    #[test]
    fn references_from_a_reference_can_include_the_declaration() {
        // The fourth cell of the (start position × `include_declaration`) square; the other three
        // are covered above. `include` is read before `locate` and is independent of which
        // occurrence the lookup began from, so this cell FOLLOWS from the other three — which is
        // an argument, and an argument is what a test replaces.
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        let out = server.handle(request(
            3,
            "textDocument/references",
            &json!({
                "textDocument": {"uri": "file:///a.tm"},
                "position": {"line": 3, "character": 35},
                "context": {"includeDeclaration": true}
            }),
        ));
        let lines: Vec<_> = success_value(&out)
            .as_array()
            .expect("an array")
            .iter()
            .map(|l| l["range"]["start"]["line"].as_u64())
            .collect();
        assert_eq!(lines, vec![Some(2), Some(1), Some(3)], "the declaration first, then both references");
    }

    #[test]
    fn references_off_a_name_is_null() {
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        let out = server.handle(request(
            3,
            "textDocument/references",
            &json!({
                "textDocument": {"uri": "file:///a.tm"},
                "position": {"line": 0, "character": 0},
                "context": {"includeDeclaration": true}
            }),
        ));
        assert_eq!(success_value(&out), serde_json::Value::Null);
    }

    #[test]
    fn document_symbol_lists_the_states_a_tm_file_defines() {
        let mut server = Server::new();
        init_hierarchical(&mut server);
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        let out =
            server.handle(request(4, "textDocument/documentSymbol", &json!({"textDocument": {"uri": "file:///a.tm"}})));
        let v = success_value(&out);
        let syms = v.as_array().expect("an array");
        let names: Vec<_> = syms.iter().map(|s| s["name"].as_str()).collect();
        // The DEFINITIONS, in source order. `start scan` is a reference and must not appear.
        assert_eq!(names, vec![Some("scan"), Some("halt")]);
        // `range` is the whole `state scan:` LINE and `selectionRange` is the name inside it.
        // They were both the name span until a review pointed out that `range` is what a client
        // tests the cursor against — so an outline reported no symbol anywhere except the four
        // columns of the name.
        assert_eq!(
            syms[0]["range"],
            json!({"start": {"line": 2, "character": 0}, "end": {"line": 2, "character": 11}})
        );
        assert_eq!(
            syms[0]["selectionRange"],
            json!({"start": {"line": 2, "character": 6}, "end": {"line": 2, "character": 10}})
        );
        assert!(syms[0]["children"].is_null(), "flat, not nested: 18,499 rules under 7,353 states is not an outline");
    }

    #[test]
    fn a_tm_state_and_an_asm_label_get_different_symbol_kinds() {
        // `nav.rs` is language-agnostic on purpose, so the kind is chosen here — the one place
        // that knows the document's language. A single hardcoded kind would pass a test that
        // only looked at one form.
        let mut server = Server::new();
        init_hierarchical(&mut server);
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        server.handle(notification(
            "textDocument/didOpen",
            &json!({"textDocument": {
                "uri": "file:///a.asm", "languageId": "redextape_asm", "version": 1,
                "text": "result Nat\nf:\n\tret\n"
            }}),
        ));
        let kind = |server: &mut Server, uri: &str| {
            let out = server.handle(request(4, "textDocument/documentSymbol", &json!({"textDocument": {"uri": uri}})));
            success_value(&out)[0]["kind"].as_u64()
        };
        let tm = kind(&mut server, "file:///a.tm");
        let asm = kind(&mut server, "file:///a.asm");
        assert!(tm.is_some() && asm.is_some());
        assert_ne!(tm, asm, "a state and a label are not the same kind of thing");
    }

    #[test]
    fn a_client_without_hierarchical_support_gets_symbol_information() {
        // **THE SHAPE IS THE CLIENT'S CHOICE, AND `DocumentSymbolResponse` IS `#[serde(untagged)]`
        // SO A WRONG CHOICE IS SILENT.** A client that does not advertise
        // `hierarchicalDocumentSymbolSupport` expects `SymbolInformation[]`, whose members carry a
        // `location` rather than a `range` — sending the other arm gives it objects with no
        // `location` field, which it cannot report as a protocol error and renders as an empty
        // outline. This server always sent the hierarchical arm until that was noticed.
        let mut server = Server::new();
        server.handle(request(1, "initialize", &json!(InitializeParams::default())));
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        let out =
            server.handle(request(4, "textDocument/documentSymbol", &json!({"textDocument": {"uri": "file:///a.tm"}})));
        let syms = success_value(&out);
        let first = &syms.as_array().expect("an array")[0];
        assert_eq!(first["name"], "scan");
        // The distinguishing field: `location`, carrying the uri, and NO bare `range`.
        assert_eq!(first["location"]["uri"], "file:///a.tm");
        assert_eq!(first["location"]["range"]["start"], json!({"line": 2, "character": 0}));
        assert!(first["range"].is_null(), "a SymbolInformation has no bare `range`: {first}");
        assert!(first["selectionRange"].is_null(), "nor a selectionRange");
    }

    #[test]
    fn the_cached_index_is_rebuilt_when_the_document_changes() {
        // THE CLASSIC CACHE DEFECT, AND THE REASON THE INDEX WAS NOT CACHED BEFORE IS THAT NOTHING
        // MADE IT CHEAP TO GET WRONG. `Document::replace` rebuilds `index` and `nav` together and
        // nowhere else; a stale `nav` would answer navigation against text the buffer no longer
        // holds, which is worse than the parse-per-request it replaced.
        let mut server = Server::new();
        init_hierarchical(&mut server);
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        server.handle(notification(
            "textDocument/didChange",
            &json!({
                "textDocument": {"uri": "file:///a.tm", "version": 2},
                "contentChanges": [{"text": "tapes 1\nstart only\nstate only: accept\n"}]
            }),
        ));
        let out =
            server.handle(request(4, "textDocument/documentSymbol", &json!({"textDocument": {"uri": "file:///a.tm"}})));
        let v = success_value(&out);
        let names: Vec<_> = v.as_array().expect("an array").iter().map(|s| s["name"].as_str()).collect();
        assert_eq!(names, vec![Some("only")], "the NEW text's definitions, not the opened text's");
    }

    #[test]
    fn document_symbol_is_null_for_a_form_this_server_does_not_index() {
        // A `.rxt` buffer is served diagnostics and formatting and no navigation. Null, not an
        // empty array: an empty array claims the file defines nothing.
        let mut server = Server::new();
        init_hierarchical(&mut server);
        server.handle(notification(
            "textDocument/didOpen",
            &json!({"textDocument": {
                "uri": "file:///a.rxt", "languageId": "redextape", "version": 1, "text": "fn f() { 1 }\nf()\n"
            }}),
        ));
        let out = server.handle(request(
            4,
            "textDocument/documentSymbol",
            &json!({"textDocument": {"uri": "file:///a.rxt"}}),
        ));
        assert_eq!(success_value(&out), serde_json::Value::Null);

        let out = server.handle(request(
            4,
            "textDocument/documentSymbol",
            &json!({"textDocument": {"uri": "file:///gone.tm"}}),
        ));
        assert_eq!(success_value(&out), serde_json::Value::Null, "an untracked URI too");
    }
}
