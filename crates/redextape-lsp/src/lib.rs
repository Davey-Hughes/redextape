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
    DiagnosticSeverity, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams,
    DocumentFormattingParams, DocumentFormattingProvider, DocumentFormattingRequest, ErrorCodes, InitializeParams,
    InitializeRequest, InitializeResult, Position, PublishDiagnosticsNotification, PublishDiagnosticsParams, Range,
    ServerCapabilities, ServerInfo, ShutdownRequest, TextDocumentContentChangeEvent, TextDocumentSync,
    TextDocumentSyncKind, TextEdit,
};

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
        Server { documents: Documents::default(), encoding: Encoding::Utf16 }
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

        let capabilities = ServerCapabilities {
            position_encoding: Some(self.encoding.kind()),
            // FULL, deliberately: these files are small, and incremental sync is an optimization
            // that buys a class of bugs before it buys anything else.
            text_document_sync: Some(TextDocumentSync::Kind(TextDocumentSyncKind::Full)),
            document_formatting_provider: Some(DocumentFormattingProvider::Bool(true)),
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
        let edits = serde_json::from_value::<DocumentFormattingParams>(params).ok().and_then(|p| {
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
        assert_eq!(caps.definition_provider, None);
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
}
