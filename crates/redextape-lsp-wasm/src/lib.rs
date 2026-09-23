//! The `#[wasm_bindgen]` surface for `redextape-lsp`. Marshalling only — every decision lives in
//! `redextape-lsp`, and this crate adds no behaviour to it at all.
//!
//! **THE BOUNDARY IS JSON STRINGS, NOT `serde-wasm-bindgen` AND NOT `ts-rs`, AND THAT IS THE ONE
//! PLACE THIS PROJECT'S WIRE-TYPE CONVENTION DOES NOT APPLY.** `redextape-wasm` generates TypeScript
//! from its own Rust declarations because it owns those declarations. This crate owns none of its
//! types: they are LSP's, generated into `gen-lsp-types` from Microsoft's official `MetaModel`. A
//! generated TypeScript copy of them would be a second description of a shape nobody here controls,
//! and it would be enormous — the protocol is far larger than the handful of messages the web client
//! sends. The client hand-writes the subset it uses instead, and this boundary stays what JSON-RPC
//! already is: a JSON message in, JSON messages out.
//!
//! **THE SERVER IS UNCHANGED BY THIS CRATE EXISTING, WHICH WAS MEASURED BEFORE IT WAS WRITTEN.** A
//! throwaway build of exactly this shape answered `initialize`, `didOpen`, `didChange`,
//! `formatting`, `documentSymbol`, `definition` and `references` correctly under Node, and returned
//! one real diagnostic for broken input in each of the four languages. See the part 3 design's §2.3.

use wasm_bindgen::prelude::*;

use redextape_lsp::{Outgoing, Server};

#[wasm_bindgen(start)]
pub fn init() {
    // Same hook `redextape-wasm` installs, and for the same reason: without it a panic in wasm
    // surfaces as `unreachable executed` with no location, which is indistinguishable from a
    // corrupt module.
    console_error_panic_hook::set_once();
}

/// The language server, and the one handle that crosses the boundary.
///
/// **IT CANNOT LEAVE THE WORKER THREAD THAT MAKES IT** — the rule `session-worker.ts` states for
/// `Session`, for the same reason: this is an opaque wasm-bindgen object with no serialized form,
/// so the worker owns it and answers questions about it rather than handing it over.
#[wasm_bindgen]
pub struct LspServer(Server);

impl Default for LspServer {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl LspServer {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self(Server::new())
    }

    /// Answer one client message. `msg` is one JSON-RPC message; the result is a JSON array of the
    /// messages that go back, which may be empty.
    ///
    /// **A MALFORMED MESSAGE ANSWERS `[]` RATHER THAN THROWING, AND THAT IS NOT LENIENCE.** The one
    /// caller is a worker whose whole job is to stay alive: a throw here crosses the boundary as a
    /// JS exception, which kills that worker's message handler, so every later request dies with
    /// it. `[]` costs one request and keeps the worker serving the rest.
    ///
    /// **WHAT IT COSTS IS STATED PLAINLY, BECAUSE THE CLIENT HAS NO TIMEOUT TO RECOVER WITH.** An
    /// earlier draft of this comment said "the client's own timeout is what reports it";
    /// `lsp-client.ts` says the opposite in capitals, and deliberately — a ceiling whose only
    /// reachable cause is already handled by a listener is a ceiling that never fires, which this
    /// repository has paid for before. So a request dropped here hangs until the worker dies.
    ///
    /// **NOTHING IN THE APP CAN REACH IT.** `LspClient` builds every message with
    /// `JSON.stringify`, so the parse below cannot fail on traffic this project produces; the arm
    /// exists because `from_str` returns a `Result`, not because a caller is expected to trip it.
    /// The same holds for the two `Result`s discarded below: both serialize values this crate has
    /// just built out of `serde_json::Value`s, which have no map keys that are not strings and no
    /// floats that are not finite — the two ways `to_value` and `to_string` fail.
    ///
    /// **A REQUEST ALWAYS PRODUCES EXACTLY ONE RESPONSE AND A NOTIFICATION NEVER PRODUCES ONE** —
    /// `Server::handle`'s contract, restated here because this string boundary is where a caller
    /// would otherwise have to guess the array's shape.
    #[must_use]
    pub fn handle(&mut self, msg: &str) -> String {
        let Ok(request) = serde_json::from_str(msg) else { return EMPTY.to_owned() };
        let out: Vec<serde_json::Value> = self
            .0
            .handle(request)
            .into_iter()
            .filter_map(|o| match o {
                Outgoing::Response(r) => serde_json::to_value(r).ok(),
                Outgoing::Notification(n) => serde_json::to_value(n).ok(),
            })
            .collect();
        serde_json::to_string(&out).unwrap_or_else(|_| EMPTY.to_owned())
    }
}

/// The answer to a message that could not be parsed, and the fallback for one that could not be
/// serialized. Named rather than repeated so the two sites cannot drift into different empties.
const EMPTY: &str = "[]";

#[cfg(test)]
mod tests {
    use super::*;

    /// Drive the server the way the worker does, and return the parsed array.
    fn call(server: &mut LspServer, msg: &serde_json::Value) -> Vec<serde_json::Value> {
        let out = server.handle(&msg.to_string());
        serde_json::from_str(&out).unwrap_or_default()
    }

    fn initialized() -> LspServer {
        let mut s = LspServer::new();
        let _ = call(
            &mut s,
            &serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "capabilities": {} } }),
        );
        s
    }

    #[test]
    fn a_malformed_message_answers_an_empty_array_rather_than_panicking() {
        let mut s = LspServer::new();
        assert_eq!(s.handle("this is not json"), "[]");
        assert_eq!(s.handle(""), "[]");
        // Well-formed JSON that is not a JSON-RPC message takes the same path.
        assert_eq!(s.handle("[1, 2, 3]"), "[]");
    }

    #[test]
    fn initialize_advertises_the_five_features_part_3a_consumes() {
        let mut s = LspServer::new();
        let out = call(
            &mut s,
            &serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "capabilities": {} } }),
        );
        assert_eq!(out.len(), 1, "a request must produce exactly one response");
        let caps = &out[0]["result"]["capabilities"];
        assert_eq!(caps["definitionProvider"], serde_json::json!(true));
        assert_eq!(caps["referencesProvider"], serde_json::json!(true));
        assert_eq!(caps["documentFormattingProvider"], serde_json::json!(true));
        assert_eq!(caps["documentSymbolProvider"], serde_json::json!(true));
        // The client relies on this: LSP ranges arrive as UTF-16 line/character, which is what
        // CodeMirror already counts in, so no byte conversion is needed anywhere in the client.
        assert_eq!(caps["positionEncoding"], serde_json::json!("utf-16"));
    }

    /// **THE ONE FOOTGUN OF THIS BOUNDARY, PINNED.** A `languageId` the server does not match is not
    /// an error — `Language::from_language_id` answers `None` and every language request returns
    /// empty, so a wrong id looks exactly like a clean file. It cost the part 3 design a whole round
    /// of wrong measurements before the spec was written.
    #[test]
    fn a_broken_program_in_each_language_reports_exactly_one_diagnostic() {
        for (language_id, ext, text) in [
            ("redextape", "rxt", "let x = ;"),
            ("redextape_lambda", "rxlambda", "(\\x. x"),
            ("redextape_tm", "tm", "tapes 1\ntapes 2\nstart s\nstate s: accept\n"),
            ("redextape_asm", "asm", "    mov r0,\n"),
        ] {
            let mut s = initialized();
            let out = call(
                &mut s,
                &serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": "textDocument/didOpen",
                    "params": { "textDocument": {
                        "uri": format!("redextape:///view/v1.{ext}"), "languageId": language_id, "version": 1, "text": text,
                    } },
                }),
            );
            let diagnostics = &out[0]["params"]["diagnostics"];
            assert_eq!(
                diagnostics.as_array().map(Vec::len),
                Some(1),
                "{language_id} should report exactly one diagnostic for {text:?}, got {diagnostics}"
            );
        }
    }

    /// The same documents with an id the server does not serve. **This is the test that would have
    /// caught the design's bad measurement**, and it asserts the silence is real rather than
    /// asserting it away.
    #[test]
    fn an_unserved_language_id_is_silent_rather_than_an_error() {
        let mut s = initialized();
        let out = call(
            &mut s,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didOpen",
                "params": { "textDocument": {
                    "uri": "redextape:///view/v1.rxt", "languageId": "not-a-language", "version": 1, "text": "let x = ;",
                } },
            }),
        );
        assert_eq!(out[0]["params"]["diagnostics"], serde_json::json!([]));
    }

    #[test]
    fn a_notification_produces_no_response_and_a_request_produces_one() {
        let mut s = initialized();
        let opened = call(
            &mut s,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didOpen",
                "params": { "textDocument": {
                    "uri": "redextape:///view/v1.rxt", "languageId": "redextape", "version": 1,
                    "text": "fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(3)\n",
                } },
            }),
        );
        // `publishDiagnostics` carries no id, which is what makes it a notification.
        assert!(opened.iter().all(|m| m.get("id").is_none()), "a notification must carry no id: {opened:?}");

        let formatted = call(
            &mut s,
            &serde_json::json!({
                "jsonrpc": "2.0", "id": 7, "method": "textDocument/formatting",
                "params": { "textDocument": { "uri": "redextape:///view/v1.rxt" }, "options": { "tabSize": 4, "insertSpaces": true } },
            }),
        );
        assert_eq!(formatted.len(), 1);
        assert_eq!(formatted[0]["id"], serde_json::json!(7), "a response must carry its request's id");
        let edits = formatted[0]["result"].as_array().map(Vec::len);
        assert_eq!(edits, Some(1), "the unformatted program should produce one whole-document edit");
    }

    /// `Language::format` answers `None` for text that does not parse, and its doc is emphatic that
    /// this is the answer rather than an error path.
    ///
    /// **IT ARRIVES AS `null`, NOT AS `[]`, AND THE CLIENT MUST NOT MAP OVER IT.** `formatting`
    /// builds an `Option<Vec<TextEdit>>` and hands it straight to `from_success`, so a document that
    /// does not parse answers `"result": null`. The part 3 design said the server produced an empty
    /// edit list and it does not; this test is what found that, and `lsp-client.ts` treats a `null`
    /// result and an empty array as the same answer because of it.
    #[test]
    fn formatting_an_unparseable_document_answers_null_rather_than_an_empty_list() {
        let mut s = initialized();
        let _ = call(
            &mut s,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didOpen",
                "params": { "textDocument": {
                    "uri": "redextape:///view/v1.rxt", "languageId": "redextape", "version": 1, "text": "let x = ;",
                } },
            }),
        );
        let out = call(
            &mut s,
            &serde_json::json!({
                "jsonrpc": "2.0", "id": 2, "method": "textDocument/formatting",
                "params": { "textDocument": { "uri": "redextape:///view/v1.rxt" }, "options": { "tabSize": 4, "insertSpaces": true } },
            }),
        );
        assert_eq!(out[0]["result"], serde_json::Value::Null);
        // And the parseable case still answers a list, so the assertion above is about THIS
        // document rather than about `formatting` never answering one.
        let _ = call(
            &mut s,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didOpen",
                "params": { "textDocument": {
                    "uri": "redextape:///view/v2.rxt", "languageId": "redextape", "version": 1, "text": "let x = 1;\n",
                } },
            }),
        );
        let ok = call(
            &mut s,
            &serde_json::json!({
                "jsonrpc": "2.0", "id": 3, "method": "textDocument/formatting",
                "params": { "textDocument": { "uri": "redextape:///view/v2.rxt" }, "options": { "tabSize": 4, "insertSpaces": true } },
            }),
        );
        assert_eq!(ok[0]["result"].as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn definition_and_references_answer_over_a_name_index() {
        let mut s = initialized();
        let _ = call(
            &mut s,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didOpen",
                "params": { "textDocument": {
                    "uri": "redextape:///view/v1.rxt", "languageId": "redextape", "version": 1,
                    "text": "fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(3)\n",
                } },
            }),
        );
        // `fact` on line 1 is the call; its definition is the `fn` on line 0.
        let def = call(
            &mut s,
            &serde_json::json!({
                "jsonrpc": "2.0", "id": 3, "method": "textDocument/definition",
                "params": { "textDocument": { "uri": "redextape:///view/v1.rxt" }, "position": { "line": 1, "character": 1 } },
            }),
        );
        assert_eq!(def[0]["result"]["range"]["start"]["line"], serde_json::json!(0));

        let refs = call(
            &mut s,
            &serde_json::json!({
                "jsonrpc": "2.0", "id": 4, "method": "textDocument/references",
                "params": {
                    "textDocument": { "uri": "redextape:///view/v1.rxt" }, "position": { "line": 0, "character": 4 },
                    "context": { "includeDeclaration": true },
                },
            }),
        );
        // The declaration, the recursive call, and the call on line 1.
        assert_eq!(refs[0]["result"].as_array().map(Vec::len), Some(3));
    }

    /// An unknown request must still be answered. A client that gets no response waits forever, and
    /// the wasm driver has no `lsp-server` helper answering on its behalf the way `main.rs` does.
    #[test]
    fn an_unknown_request_is_answered_with_an_error_rather_than_ignored() {
        let mut s = initialized();
        let out = call(
            &mut s,
            &serde_json::json!({ "jsonrpc": "2.0", "id": 9, "method": "textDocument/rename", "params": {} }),
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["id"], serde_json::json!(9));
        assert!(out[0]["error"].is_object(), "an unserved request must answer an error: {:?}", out[0]);
    }

    /// **ASM HAS NO EDITOR UNTIL PART 5, WHICH IS WHY THIS RUNS HERE.** There is nowhere in the app
    /// yet to place a cursor in an `.asm` document, so its hover answers cannot be proven by driving
    /// the UI — this test drives `handle`'s JSON instead, exactly as a worker would, so that once
    /// part 5 mounts an asm editor it inherits a language already proven at the boundary rather than
    /// an untested one.
    ///
    /// **THE REFERENCE ARM HAD ZERO COVERAGE.** `hover::asm`'s `Role::Reference` branch
    /// (`"A jump or call target."`) was never exercised anywhere in the tree — Task 5's fixtures only
    /// ever hovered a label DEFINITION (`f:`). A bug that swapped the two arms' messages would have
    /// passed every existing test. The fixture below carries a label defined once and referenced
    /// twice, so both roles get hovered and their answers are checked to actually differ.
    #[test]
    fn asm_answers_hover_at_the_boundary_though_no_editor_mounts_it() {
        // The same fixture `asm_syntax.rs`'s `NAV_ASM` uses, whose own doc comment records it as
        // parsing clean: `g` is defined once (`g:`) and referenced twice (`jz`'s second operand,
        // `jmp`'s first).
        const ASM: &str = "result Nat\nf:\n\tli\tr0, #1\n\tjz\tr0, g\n\tjmp\tg\ng:\n\tret\n";

        let mut s = initialized();
        let opened = call(
            &mut s,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didOpen",
                "params": { "textDocument": {
                    "uri": "redextape:///view/a.asm", "languageId": "redextape_asm", "version": 1, "text": ASM,
                } },
            }),
        );
        // A hover over a broken document answers nothing, which could look like a passing test for
        // the wrong reason, so the fixture's cleanliness is asserted rather than assumed.
        assert_eq!(opened[0]["params"]["diagnostics"], serde_json::json!([]), "the fixture must parse clean");

        let hover = |s: &mut LspServer, line: u64, character: u64| {
            call(
                s,
                &serde_json::json!({
                    "jsonrpc": "2.0", "id": 2, "method": "textDocument/hover",
                    "params": { "textDocument": { "uri": "redextape:///view/a.asm" },
                                "position": { "line": line, "character": character } },
                }),
            )[0]["result"]
                .clone()
        };

        // 1. An instruction answers: `li` on line 2, the tab padding one column before it.
        let instr = hover(&mut s, 2, 1);
        assert!(
            instr["contents"]["value"].as_str().is_some_and(|v| v.contains("immediate")),
            "hovering `li` should describe it: {instr}"
        );
        // `initialized()` advertises no `contentFormat`, so the answer must come back plaintext.
        assert_eq!(instr["contents"]["kind"], serde_json::json!("plaintext"));

        // 2. The label REFERENCE: `jmp`'s operand `g`, line 4 character 5.
        let reference = hover(&mut s, 4, 5);
        let reference_text = reference["contents"]["value"].as_str().expect("a hover answer");
        assert!(
            reference_text.contains("A jump or call target."),
            "a jmp target should read as a reference: {reference_text}"
        );
        assert!(
            !reference_text.contains("Defined here."),
            "a reference must not read as a definition: {reference_text}"
        );

        // 3. The label DEFINITION: `g:`, line 5 character 0.
        let definition = hover(&mut s, 5, 0);
        let definition_text = definition["contents"]["value"].as_str().expect("a hover answer");
        assert!(
            definition_text.contains("Defined here."),
            "a label line should read as a definition: {definition_text}"
        );
        assert!(
            !definition_text.contains("A jump or call target."),
            "a definition must not read as a reference: {definition_text}"
        );

        // This is the gap the task closes: a swap of the two arms' messages would leave every other
        // assertion in this file untouched, so the two answers must be checked against each other,
        // not just against their own expected substring.
        assert_ne!(reference_text, definition_text, "a reference and a definition must say different things");
    }
}
