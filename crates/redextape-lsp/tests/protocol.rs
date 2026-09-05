//! The one test that spawns the binary.
//!
//! Everything else in this crate calls `Server::handle` directly, which is what holds the
//! workspace coverage gate — no process, no stdio, no timing. That is also exactly why this file
//! has to exist: a handler test cannot see the framing, the handshake or the write loop, and all
//! three are in `main.rs`. A server whose `Content-Length` header was wrong would pass every other
//! test in this crate and hang the editor.

// The exemption in `clippy.toml` for `unwrap`/`expect`/`panic` reaches code lexically inside a
// `#[test]` function or a `#[cfg(test)]` module; `send` and `recv` below are free functions in an
// integration-test binary, in neither, so the allow is restated here at file scope.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

/// Write one LSP message: the `Content-Length` header, a blank line, then the JSON.
fn send(stdin: &mut ChildStdin, msg: &serde_json::Value) {
    let body = serde_json::to_string(msg).expect("serializable");
    write!(stdin, "Content-Length: {}\r\n\r\n{body}", body.len()).expect("write");
    stdin.flush().expect("flush");
}

/// Read one LSP message back, framing and all.
fn recv(out: &mut BufReader<ChildStdout>) -> serde_json::Value {
    let mut len = None;
    loop {
        let mut line = String::new();
        let n = out.read_line(&mut line).expect("read header");
        assert_ne!(n, 0, "the server closed its stdout mid-header");
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some(v) = line.strip_prefix("Content-Length: ") {
            len = Some(v.parse::<usize>().expect("a numeric Content-Length"));
        }
    }
    let len = len.expect("every message carries a Content-Length");
    let mut body = vec![0u8; len];
    out.read_exact(&mut body).expect("read body");
    serde_json::from_slice(&body).expect("a JSON body")
}

#[test]
fn server_binary_speaks_the_protocol() {
    let mut child: Child = Command::new(env!("CARGO_BIN_EXE_redextape-lsp"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("the binary is built by the test harness");

    let mut stdin = child.stdin.take().expect("piped");
    let mut stdout = BufReader::new(child.stdout.take().expect("piped"));

    send(
        &mut stdin,
        &serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "capabilities": { "general": { "positionEncodings": ["utf-8"] } } }
        }),
    );
    let reply = recv(&mut stdout);
    assert_eq!(reply["id"], 1);
    assert_eq!(reply["result"]["capabilities"]["positionEncoding"], "utf-8");
    assert_eq!(reply["result"]["capabilities"]["documentFormattingProvider"], true);

    send(
        &mut stdin,
        &serde_json::json!({
            "jsonrpc": "2.0", "method": "initialized", "params": {}
        }),
    );

    // The second line is the duplicate, so a diagnostic reported at 0:0 would be visibly wrong.
    send(
        &mut stdin,
        &serde_json::json!({
            "jsonrpc": "2.0", "method": "textDocument/didOpen",
            "params": { "textDocument": {
                "uri": "file:///a.tm", "languageId": "redextape_tm", "version": 1,
                // TM_DUP from the Verified fixtures section: one error, on line 1.
                "text": "tapes 1\ntapes 2\nstart q0\nstate q0: accept\n"
            }}
        }),
    );
    let note = recv(&mut stdout);
    assert_eq!(note["method"], "textDocument/publishDiagnostics");
    assert_eq!(note["params"]["uri"], "file:///a.tm");
    let diags = note["params"]["diagnostics"].as_array().expect("an array");
    assert_eq!(diags.len(), 1, "expected the duplicate-tapes error: {diags:?}");
    assert_eq!(diags[0]["range"]["start"]["line"], 1);
    let message = diags[0]["message"].as_str().expect("a message string");
    assert!(message.contains("duplicate") && message.contains("tapes"), "not the duplicate-tapes error: {message}");

    // An ordinary, id-bearing request that goes through the main loop's `dispatch` arm and
    // `to_message`'s `Outgoing::Response` arm — the path `initialize` and `shutdown` both bypass.
    // A second document, clean and with comments, so formatting it returns real edits rather than
    // a `null` that would round-trip even if the response path silently dropped the payload.
    send(
        &mut stdin,
        &serde_json::json!({
            "jsonrpc": "2.0", "method": "textDocument/didOpen",
            "params": { "textDocument": {
                "uri": "file:///b.tm", "languageId": "redextape_tm", "version": 1,
                "text": "; a machine\ntapes 1\nstart q0\n\nstate q0:\n  [a] -> write [b], move [R], goto q1 ; and a trailing one\nstate q1: accept\n"
            }}
        }),
    );
    let note = recv(&mut stdout);
    assert_eq!(note["method"], "textDocument/publishDiagnostics");
    assert_eq!(note["params"]["uri"], "file:///b.tm");
    assert_eq!(note["params"]["diagnostics"].as_array().expect("an array").len(), 0, "this fixture parses clean");

    send(
        &mut stdin,
        &serde_json::json!({
            "jsonrpc": "2.0", "id": 3, "method": "textDocument/formatting",
            "params": {
                "textDocument": { "uri": "file:///b.tm" },
                "options": { "tabSize": 2, "insertSpaces": true }
            }
        }),
    );
    let reply = recv(&mut stdout);
    assert_eq!(reply["id"], 3);
    assert!(reply.get("error").is_none(), "formatting a clean file must not error: {reply:?}");
    let edits = reply["result"].as_array().expect("a success response carrying an edit array");
    assert_eq!(edits.len(), 1, "FULL sync, so formatting is one whole-document edit: {edits:?}");
    let new_text = edits[0]["newText"].as_str().expect("a newText string");
    assert!(new_text.contains("; a machine"), "own-line comment lost:\n{new_text}");
    assert!(new_text.contains("; and a trailing one"), "trailing comment lost:\n{new_text}");

    send(&mut stdin, &serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "shutdown" }));
    let reply = recv(&mut stdout);
    assert_eq!(reply["id"], 2);

    send(&mut stdin, &serde_json::json!({ "jsonrpc": "2.0", "method": "exit" }));
    drop(stdin);

    let status = child.wait().expect("the server exits after `exit`");
    assert!(status.success(), "the server exited with {status}");
}
