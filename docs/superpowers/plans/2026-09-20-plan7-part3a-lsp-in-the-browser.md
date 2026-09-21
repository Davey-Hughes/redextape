# Plan 7 part 3a — the LSP in the browser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `redextape-lsp` in a browser worker and serve diagnostics, format, outline, definition and references to all three editors — replacing the synchronous `analyze` lint path and the session worker's diagnostics push.

**Architecture:** A new `redextape-lsp-wasm` crate wraps `redextape_lsp::Server` in one `#[wasm_bindgen]` type whose whole boundary is a JSON string in and a JSON array out. `lsp-worker.ts` owns that handle and holds no policy; `lsp-client.ts` holds all of it — request correlation, the document set, the restart-once rule — behind an injected `LspPort` interface so every rule is testable in the node tier without a thread. The three editors then consume it: the source editor loses `lintFromAnalyze`, λ copies lose the session worker's diagnostics push, and TM copies gain diagnostics for the first time.

**Tech Stack:** Rust (wasm-bindgen, serde_json), wasm-pack, TypeScript, CodeMirror 6 (`@codemirror/lint`), Vitest (node and browser projects).

Design: [`../specs/2026-09-20-plan7-part3-editor-intelligence-design.md`](../specs/2026-09-20-plan7-part3-editor-intelligence-design.md). This is **PR 1 of 2**; 3b (colouring, hover, vim) gets its own plan.

## What the pre-flight already proved, and what it did not

**Tasks 1, 3, 4 and 5 were built and verified before this plan was written.** Their code below is code that compiled, passed its tests, passed `biome ci`, passed `tsc --noEmit` and passed `cargo clippy -- -D warnings` — not a sketch. Four defects were found that way and are already fixed in the code below:

| Found | What |
|---|---|
| `formatting` answers `null`, not `[]` | The spec said the server returns an empty edit list. It returns `Option<Vec<TextEdit>>`, so an unparseable buffer answers JSON `null`. A client that mapped over the result would throw on the most likely buffer of all — one being typed into. |
| 7 unhandled promise rejections | `start()` fired `initialize` with `void` and never handled its rejection, so every worker death raised an uncaught rejection. A sabotage confirmed Vitest exits 1 on this, so the gate is not blind. |
| `PaneKind` has no `asm` | The spec promised diagnostics in an editor that does not exist until part 5. |
| README crate count | Adding a ninth crate falsified `README.md`, caught by `scripts/check-doc-figures.sh`. |

**Then that built code was reviewed, and the review found eight more — two of which the tests could not have.** Every one is fixed, and each carries a regression test that was shown to fail against the pre-fix code:

| Severity | What |
|---|---|
| HIGH | A dead worker's `error` event terminated its own *replacement*. Listeners cannot be removed and `terminate()` cannot unqueue events already dispatched, so a panic with two messages in flight delivered two events; the second ran `#died` again against the new port. Reproduced before fixing: one worker death left `ports[1].terminated === true` and `available === false`. |
| HIGH | `build:lsp-wasm` was never added to `web/package.json`, so `lsp-worker.ts`'s import resolves only because an ad-hoc build happened to be on disk. Verified by deleting `pkg-lsp/`: `tsc` fails with TS2307, and CI would too. |
| MEDIUM | `lsp-worker.ts`'s docblock claimed `vite.config.ts` excludes worker modules from coverage. It excludes exactly one file, and not this one. |
| MEDIUM | `handle`'s doc justified dropping a message by "the client's own timeout", which `lsp-client.ts` refuses to have, in capitals. |
| LOW ×4 | The `failed` path dropped the port without terminating it; the restart notice said "features are back" before the replacement loaded; `m.params` was cast despite being optional; a request made before `start()` queued forever with nothing able to reject it. |

**The coverage question is settled and the answer is "do not exclude it".** `lsp-worker.ts` reports `0 | 0 | 0 | 0` and the merged gate still passes at 95.87 / 89.91 / 97.61 / 97.96 against floors of 95 / 89 / 97 / 97. It is *not* added to `coverage.exclude`, because `session-worker.ts`'s entry is for a module that IS exercised and that v8 cannot see — an instrumentation gap. This one is exercised by nothing yet, so excluding it would hide an untested file behind a comment about instrumentation. **Task 6's browser tests are what make the exclusion arguable**, and the task that writes them gets to make the measurement.

**Tasks 2 and 6 through 11 were NOT fully built.** Task 2's `build:lsp-wasm` script and its CI step are done (they had to be — the HIGH above); its `check-all.sh` wasm32 leg is not. Tasks 6–11 are written from the call sites, each named with the exact line to change, but an implementer should expect to correct them — that is what the per-task review is for. The risk is concentrated in Task 6, which edits a 1,972-line `main.ts`.

## Global Constraints

- **Rust edition 2024**; `rustfmt.toml` sets `max_width = 120`, `use_small_heuristics = "Max"`.
- **No panics on library paths** — `[workspace.lints.clippy]` warns `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`; CI's `-D warnings` makes them fatal. `clippy::pedantic` is on as written.
- **The pre-commit hook runs on every commit** — `cargo fmt`, `cargo clippy`, `biome ci`, `web typecheck`, and six doc/text gates. **Never `--no-verify`.** A task whose commit cannot pass them is a task that needs splitting, not bypassing.
- **`file:line` citations are banned in tracked source** (`scripts/check-citations.sh`) and normal in `docs/`. Cite the symbol.
- **TypeScript is strict with `noUncheckedIndexedAccess`**, and biome enforces `noUnsafeOptionalChaining`. An array index is `T | undefined`; a test that reads one must narrow or throw, never cast.
- **Doc comments are `///` in Rust and `/** */` in TypeScript.** A `///` in a `.ts` file is drift and `biome ci` lints it clean without complaining.
- **`main` is linear and PR-only.** Work on branch `plan7-part3a-lsp-in-the-browser`; squash-merge in the Forgejo web UI.
- **The roadmap entry is written before the PR is opened**, not after (Task 11).
- **The four `languageId` values are `redextape`, `redextape_lambda`, `redextape_tm`, `redextape_asm`.** A wrong one is not an error — the server answers every request with nothing, which on screen is a clean file. This is the one contract in this plan whose breach is silent.

## File Structure

| file | change | responsibility |
| --- | --- | --- |
| `crates/redextape-lsp-wasm/Cargo.toml` | create | The crate manifest. `cdylib` + `rlib`, four dependencies. |
| `crates/redextape-lsp-wasm/src/lib.rs` | create | The `#[wasm_bindgen]` surface: one type, one method, and the tests that pin the server's contract. |
| `Cargo.toml` | modify | Add the crate to `[workspace] members`. |
| `README.md` | modify | "Eight crates" → "Nine", plus the paragraph describing the new one. |
| `.gitignore` | modify | `/pkg-lsp/`, the second wasm out-dir. |
| `web/package.json` | modify | `build:lsp-wasm`, and fold it into `build` and `test`. |
| `scripts/check-all.sh` | modify | A wasm32 leg for the new crate, beside `redextape-core`'s. |
| `.forgejo/workflows/ci.yml` | modify | Nothing new if the wasm leg is inside `check-all.sh`; verify. |
| `web/src/lsp-protocol.ts` | create | The hand-written LSP subset, the four language ids, and URI construction. |
| `web/src/lsp-worker.ts` | create | Owns the `LspServer` handle. No policy. |
| `web/src/lsp-client.ts` | create | Every decision: correlation, documents, restart-once, the five features. |
| `web/src/main.ts` | modify | Build the client, drop `lintFromAnalyze`, route diagnostics, open/change the source document. |
| `web/src/lint.ts` | delete | `lintFromAnalyze` has no callers after Task 6. |
| `web/src/scratch-editor.ts` | modify | Take LSP diagnostics; drop the byte-offset conversion. |
| `web/src/lambda-pane.ts`, `web/src/tm-pane.ts` | modify | Open and close a document per editor; TM gains diagnostics. |
| `web/src/replies.ts` | modify | Stop pushing diagnostics from the run reply. |
| `web/src/diagnostics.ts` | modify | Shrink to what `link.ts` still needs. |
| `web/tests/node/lsp-protocol.test.ts` | create | The drift test against `language.rs`. |
| `web/tests/node/lsp-client.test.ts` | create | The whole client lifecycle against a fake port. |
| `web/tests/browser/lsp-diagnostics.test.ts` | create | One diagnostic per editor, in the gutter. |
| `web/tests/browser/lsp-format.test.ts` | create | Format from the `⋯` menu; unparseable is unchanged. |
| `web/tests/browser/lsp-outline.test.ts` | create | The outline panel; absent for λ. |
| `web/tests/browser/lsp-navigation.test.ts` | create | Definition and references, including across views. |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | modify | The entry, written before the PR opens. |

Eleven tasks. Tasks 1–5 stand alone and could merge without any editor consuming them; Tasks 6–10 are one consumer each; Task 11 closes out.

---

### Task 1: The `redextape-lsp-wasm` crate

**Files:**
- Create: `crates/redextape-lsp-wasm/Cargo.toml`, `crates/redextape-lsp-wasm/src/lib.rs`
- Modify: `Cargo.toml` (workspace members), `README.md`

**Interfaces:**
- Consumes: `redextape_lsp::{Server, Outgoing}` — unchanged, and this task must not edit that crate.
- Produces: `LspServer::new()` and `LspServer::handle(&mut self, msg: &str) -> String`. Task 4's worker is the only caller.

**This task was pre-flight built.** The code below compiled, passed 8 tests, `cargo clippy -- -D warnings` and `cargo fmt --check`.

- [ ] **Step 1: Write the failing test — the crate does not exist yet**

Create `crates/redextape-lsp-wasm/Cargo.toml`:

```toml
[package]
name = "redextape-lsp-wasm"
version = "0.0.0"
edition.workspace = true
license.workspace = true
repository.workspace = true

[lints]
workspace = true

# `rlib` ALONGSIDE `cdylib` FOR THE REASON `redextape-wasm` GIVES: `cdylib` is what wasm-pack links,
# and `rlib` is what lets `cargo test` compile this crate natively. Without it the only way to
# exercise `handle` would be a browser, and `cargo llvm-cov` instruments the native build — the whole
# crate would land in the coverage denominator uncovered.
[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
# The whole point of the crate. `Server::handle` is pure over `gen-lsp-types` structs, which is the
# property `redextape-lsp`'s own module doc argues for at length as what "keeps the web phase
# possible"; this crate is that web phase and adds nothing to the server.
redextape-lsp = { path = "../redextape-lsp" }
wasm-bindgen = "0.2.126"
# THE BOUNDARY IS JSON STRINGS, SO THIS IS THE WHOLE MARSHALLING LAYER — there is no
# `serde-wasm-bindgen` here and no `ts-rs`, unlike `redextape-wasm`. See `lib.rs`'s module doc.
serde_json = "1"
console_error_panic_hook = "0.1.7"
```

Add the crate to the workspace in the root `Cargo.toml`, keeping members alphabetical:

```toml
    "crates/redextape-lsp",
    "crates/redextape-lsp-wasm",
    "crates/redextape-native",
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p redextape-lsp-wasm`
Expected: FAIL — `error: no library targets found in package` or `couldn't read crates/redextape-lsp-wasm/src/lib.rs`.

- [ ] **Step 3: Write `src/lib.rs`**

The full file is in the pre-flight copy at `crates/redextape-lsp-wasm/src/lib.rs`. Its shape:

```rust
//! The `#[wasm_bindgen]` surface for `redextape-lsp`. Marshalling only — every decision lives in
//! `redextape-lsp`, and this crate adds no behaviour to it at all.
//!
//! **THE BOUNDARY IS JSON STRINGS, NOT `serde-wasm-bindgen` AND NOT `ts-rs`, AND THAT IS THE ONE
//! PLACE THIS PROJECT'S WIRE-TYPE CONVENTION DOES NOT APPLY.** `redextape-wasm` generates TypeScript
//! from its own Rust declarations because it owns those declarations. This crate owns none of its
//! types: they are LSP's, generated into `gen-lsp-types` from Microsoft's official `MetaModel`.

use wasm_bindgen::prelude::*;

use redextape_lsp::{Outgoing, Server};

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// The language server, and the one handle that crosses the boundary.
///
/// **IT CANNOT LEAVE THE WORKER THREAD THAT MAKES IT** — the rule `session-worker.ts` states for
/// `Session`, for the same reason: this is an opaque wasm-bindgen object with no serialized form.
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
    /// JS exception, which kills the message handler and leaves the client waiting forever on a
    /// request id that will never be answered.
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
```

Eight tests go in a `#[cfg(test)] mod tests`, and **each one pins a fact the client depends on**:

1. `a_malformed_message_answers_an_empty_array_rather_than_panicking` — `"not json"`, `""`, and `"[1, 2, 3]"` all answer `"[]"`.
2. `initialize_advertises_the_five_features_part_3a_consumes` — the four providers plus `positionEncoding == "utf-16"`. The client depends on that last one: LSP ranges then arrive in the units CodeMirror counts in, so no byte conversion is needed anywhere.
3. `a_broken_program_in_each_language_reports_exactly_one_diagnostic` — over the four `(languageId, ext, text)` rows: `("redextape", "rxt", "let x = ;")`, `("redextape_lambda", "rxlambda", "(\\x. x")`, `("redextape_tm", "tm", "tapes 1\ntapes 2\nstart s\nstate s: accept\n")`, `("redextape_asm", "asm", "    mov r0,\n")`.
4. `an_unserved_language_id_is_silent_rather_than_an_error` — the same document with `languageId: "not-a-language"` publishes `[]`. **This is the test that would have caught the design's bad measurement**, and it asserts the silence is real rather than asserting it away.
5. `a_notification_produces_no_response_and_a_request_produces_one` — `didOpen`'s outgoing messages carry no `id`; `formatting`'s response carries its request's id and one whole-document edit.
6. `formatting_an_unparseable_document_answers_null_rather_than_an_empty_list` — **the defect the spec shipped**. Assert `result == Value::Null`, then assert a parseable document in the same test still answers a one-element list, so the first assertion is about that document rather than about `formatting` never answering one.
7. `definition_and_references_answer_over_a_name_index` — definition from line 1 lands on line 0; references with `includeDeclaration` returns 3.
8. `an_unknown_request_is_answered_with_an_error_rather_than_ignored` — `textDocument/rename` answers an error object carrying id 9. A client that gets no response waits forever, and the wasm driver has no `lsp-server` helper answering on its behalf.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p redextape-lsp-wasm`
Expected: `test result: ok. 8 passed; 0 failed`.

- [ ] **Step 5: Satisfy the lints before committing**

Run: `cargo clippy -p redextape-lsp-wasm --all-targets -- -D warnings`
Expected: `Finished`. **`clippy::doc_markdown` will reject `MetaModel` unbackticked** — write `` `MetaModel` ``. This is the pedantic lint most likely to block this task's commit.

Run: `cargo fmt -p redextape-lsp-wasm -- --check`
Expected: no output.

- [ ] **Step 6: Update `README.md`, which the doc gate now fails**

Run: `bash scripts/check-doc-figures.sh`
Expected: FAIL — `README.md — 'workspace crates under crates/' claims 8, the tree says 9.`

Change `Eight crates under `crates/`.` to `Nine crates under `crates/`.`, and add a paragraph after the `redextape-lsp` one describing the new crate. The README's own section documents twice that a total and an enumeration drift apart; move both in this commit.

Run: `bash scripts/check-doc-figures.sh`
Expected: `check-doc-figures: 43 documented figures match the tree.`

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-lsp-wasm Cargo.toml Cargo.lock README.md
git commit -m "The language server gets a wasm surface: one type, one method, and a JSON boundary

`redextape-lsp` needs no change to run in a browser, which was measured before this crate was
written. The boundary is a JSON string in and a JSON array out rather than serde-wasm-bindgen,
because LSP's types are generated from Microsoft's MetaModel and a TypeScript copy would describe a
shape this project does not own.

Two tests pin facts the client cannot discover for itself: formatting an unparseable document
answers null rather than an empty list, and a languageId the server does not match is silent rather
than an error — which on screen is indistinguishable from a file with no problems in it."
```

---

### Task 2: The build, the gate, and the second out-dir

**Files:**
- Modify: `.gitignore`, `web/package.json`, `scripts/check-all.sh`
- Verify: `.forgejo/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 1's crate.
- Produces: `pkg-lsp/redextape_lsp_wasm.js` and its `.wasm`, which Task 4's worker imports. A `wasm` leg in `check-all.sh` named `redextape-lsp-wasm`.

**NOT pre-flight built beyond the wasm-pack invocation**, which was run and produced 825,451 bytes raw / 283,076 gzipped.

- [ ] **Step 1: Add the out-dir to `.gitignore`**

`*.wasm` is already global, but the directory should be named beside `/pkg/` so the pairing is legible:

```gitignore
# WebAssembly build output (wasm-pack / wasm-bindgen / trunk)
/pkg/
# ...and the LSP server's own artefact, built by `pnpm run build:lsp-wasm` from
# `crates/redextape-lsp-wasm`. A SECOND OUT-DIR RATHER THAN A SECOND FILE IN `/pkg/`, because
# wasm-pack owns everything it writes to an out-dir and would prune the other crate's output.
/pkg-lsp/
**/pkg/
*.wasm
```

- [ ] **Step 2: Verify the build produces the artefact**

Run: `wasm-pack build crates/redextape-lsp-wasm --release --target web --out-dir ../../pkg-lsp`
Expected: `Your wasm pkg is ready to publish at pkg-lsp.` and `pkg-lsp/redextape_lsp_wasm.js` exists.

Run: `git check-ignore -v pkg-lsp/redextape_lsp_wasm_bg.wasm`
Expected: `.gitignore:11:/pkg-lsp/	pkg-lsp/redextape_lsp_wasm_bg.wasm` — nothing from the build is committable.

- [ ] **Step 3: Add the script, and fold it into the scripts that need it**

In `web/package.json`, beside `build:wasm`:

```json
"build:lsp-wasm": "wasm-pack build ../crates/redextape-lsp-wasm --release --target web --out-dir ../../pkg-lsp",
```

`build` must run it — the app will not load without it. `test` must too, because the browser project imports the worker. Update both:

```json
"build": "pnpm run build:wasm && pnpm run build:lsp-wasm && pnpm run build:bindings && pnpm run build:app",
"test": "pnpm run build:bindings && vitest run",
```

**`test` is deliberately NOT given `build:lsp-wasm`.** It does not build `build:wasm` either — the browser tier expects `pkg/` to be present already, and adding one wasm build to the test script and not the other would be the asymmetry, not the fix. Confirm by running the browser tier on a clean tree and reading the failure before deciding; if it cannot find `pkg-lsp/`, add both rather than one.

- [ ] **Step 4: Add the wasm32 leg to `check-all.sh`**

`redextape-core` already has a `base|wasm|` row. Add the sibling. Read `ensure_wasm_target` and the `LEGS` table first — the script validates its own table at startup, so a row with an unknown kind fails fast and that is the failing test.

Run: `bash scripts/check-all.sh --list`
Expected: the new leg appears in the base tier.

- [ ] **Step 5: Verify CI needs no separate change**

Run: `grep -n "wasm32\|check-all" .forgejo/workflows/ci.yml`
Expected: the `rust` and `rust-scoped` jobs already add `wasm32-unknown-unknown` and already reach `check-all.sh`'s base tier. If they do, this step changes nothing and that is the finding; write it in the commit message rather than editing the workflow to look busy.

- [ ] **Step 6: Commit**

```bash
git add .gitignore web/package.json scripts/check-all.sh
git commit -m "The LSP wasm builds to its own out-dir, and the wasm32 gate covers the new crate

A second out-dir rather than a second file in pkg/: wasm-pack owns everything it writes to an
out-dir and would prune the other crate's output."
```

---

### Task 3: `lsp-protocol.ts` and the drift test

**Files:**
- Create: `web/src/lsp-protocol.ts`, `web/tests/node/lsp-protocol.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LANGUAGE_IDS`, `LanguageId`, `LANGUAGE_OF_PANE`, `EXTENSION_OF_LANGUAGE`, `documentUri(viewId, language)`, `isResponse(m)`, and the types `LspPosition`, `LspRange`, `LspDiagnostic`, `LspTextEdit`, `LspLocation`, `LspDocumentSymbol`, `LspOutgoing`, `LspResponse`, `LspNotification`, `PublishDiagnosticsParams`, `LspRequestMessage`, `LspReplyMessage`, `RequestId`. Tasks 4, 5, 6, 7, 8, 9 and 10 all import from here.

**This task was pre-flight built.** Full source at `web/src/lsp-protocol.ts`.

- [ ] **Step 1: Write the failing test**

`web/tests/node/lsp-protocol.test.ts`. The load-bearing one reads the ids out of the Rust source rather than restating them:

```ts
const LANGUAGE_RS = fileURLToPath(new URL('../../../crates/redextape-lsp/src/language.rs', import.meta.url))

it('are exactly the ids `Language::from_language_id` matches', () => {
  const rust = readFileSync(LANGUAGE_RS, 'utf8')
  const body = rust.slice(rust.indexOf('pub fn from_language_id'))
  const end = body.indexOf('\n    }')
  const arms = [...body.slice(0, end).matchAll(/"([a-z_]+)"\s*=>\s*Some\(/g)].map((m) => m[1])

  expect(arms.length, 'the parse found no arms — the match block has been reshaped').toBeGreaterThan(0)
  expect([...LANGUAGE_IDS].sort()).toEqual([...arms].sort())
})
```

**The `arms.length` assertion is not padding.** A regex that matches nothing would make the test compare `[]` against `[]` and pass while checking nothing — a probe reporting absence is a claim about the probe.

Plus: `LANGUAGE_OF_PANE` covers exactly `lambda`, `source`, `tm` (asm has no editor until part 5); every id has an extension; `documentUri` is per view, so `v1` and `v2` on one language are two documents; and `isResponse` splits on the presence of `id`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm vitest run --project node tests/node/lsp-protocol.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/lsp-protocol"`.

- [ ] **Step 3: Write `web/src/lsp-protocol.ts`**

Use the pre-flight file. The two constants that carry the contract:

```ts
export const LANGUAGE_IDS = ['redextape', 'redextape_lambda', 'redextape_tm', 'redextape_asm'] as const

export type LanguageId = (typeof LANGUAGE_IDS)[number]

/** The app's three editor kinds, and the language each one holds. `asm` has no editor until part 5. */
export const LANGUAGE_OF_PANE = {
  source: 'redextape',
  lambda: 'redextape_lambda',
  tm: 'redextape_tm',
} as const satisfies Record<'source' | 'lambda' | 'tm', LanguageId>

export function documentUri(viewId: string, language: LanguageId): string {
  return `redextape:///view/${viewId}.${EXTENSION_OF_LANGUAGE[language]}`
}
```

`documentUri` is **per view rather than per language**, because two views can hold the same language over different text — which copies make routine — and the server keys documents by this string.

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && pnpm vitest run --project node tests/node/lsp-protocol.test.ts`
Expected: `Tests 4 passed`.

- [ ] **Step 5: Commit**

```bash
git add web/src/lsp-protocol.ts web/tests/node/lsp-protocol.test.ts
git commit -m "The client's LSP subset is hand-written, and one test holds it against the server

Not generated, because the Rust side does not declare these types — they are LSP's, and a generated
copy would describe a shape nobody here owns. The risk that creates is drift in the one field whose
mismatch is silent, so the language ids are read out of language.rs rather than restated."
```

---

### Task 4: `lsp-worker.ts`

**Files:**
- Create: `web/src/lsp-worker.ts`

**Interfaces:**
- Consumes: Task 1's `LspServer` via `../../pkg-lsp/redextape_lsp_wasm.js`; Task 3's `LspRequestMessage`, `LspReplyMessage`, `LspOutgoing`.
- Produces: a module Task 5 spawns as `new Worker(new URL('./lsp-worker.ts', import.meta.url), { type: 'module' })`. Posts `{kind:'ready'}`, `{kind:'failed',reason}` or `{kind:'out',messages}`.

**This task was pre-flight built.** Full source at `web/src/lsp-worker.ts`.

- [ ] **Step 1: Write the module**

It holds **no policy**, and the module doc must say why: `vite.config.ts` excludes worker modules from `coverage.include` for a measured instrumentation reason, so a branch here moves none of the four coverage numbers.

The two non-obvious parts:

```ts
/**
 * Messages that arrived before the module finished instantiating.
 *
 * **WITHOUT THIS, THE FIRST `initialize` IS DROPPED AND NOTHING EVER RECOVERS.** `init()` is a fetch
 * and an instantiation; the client posts as soon as it has constructed the worker, which is sooner.
 */
const pending: LspRequestMessage[] = []

init()
  .then(() => {
    server = new LspServer()
    post({ kind: 'ready' })
    for (const m of pending.splice(0)) answer(m)
  })
  .catch((err: unknown) => {
    // A module that will not load is not a worker that died — there is nothing to restart.
    post({ kind: 'failed', reason: err instanceof Error ? err.message : String(err) })
  })
```

And the parse happens **here, not on the main thread**: the string arrives from wasm on this side, and handing the main thread a string to parse would move that cost to the one thread the whole split exists to keep free.

- [ ] **Step 2: Verify it typechecks against the real wasm bindings**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: 0 errors. This is the step that fails if Task 2's build has not been run — `pkg-lsp/redextape_lsp_wasm.js` must exist for the import to resolve.

- [ ] **Step 3: Commit**

```bash
git add web/src/lsp-worker.ts
git commit -m "The LSP worker owns the server handle and holds no policy

The handle cannot leave this thread, the same rule session-worker.ts states for Session. Policy stays
in the client because vite.config.ts excludes worker modules from coverage for a measured
instrumentation reason, so a branch in here moves none of the four numbers."
```

---

### Task 5: `lsp-client.ts`

**Files:**
- Create: `web/src/lsp-client.ts`, `web/tests/node/lsp-client.test.ts`

**Interfaces:**
- Consumes: Task 3's types.
- Produces: `LspClient`, `LspPort`, `LspUnavailable`, `DiagnosticsSink`, `NoticeSink`. Its public surface, which Tasks 6–10 consume:
  - `start(): void`
  - `get available(): boolean`, `get openDocumentCount(): number`
  - `openDocument(uri: string, languageId: LanguageId, text: string): void`
  - `changeDocument(uri: string, text: string): void`
  - `closeDocument(uri: string): void`
  - `format(uri: string): Promise<LspTextEdit[]>`
  - `documentSymbols(uri: string): Promise<LspDocumentSymbol[]>`
  - `definition(uri: string, position: LspPosition): Promise<LspLocation | null>`
  - `references(uri: string, position: LspPosition): Promise<LspLocation[]>`

**This task was pre-flight built.** Full source at `web/src/lsp-client.ts`, 17 tests at `web/tests/node/lsp-client.test.ts`.

- [ ] **Step 1: Write the failing tests**

`LspPort` is an interface, not `Worker`, **so every rule is testable without a thread** — the reason `session-client.ts`'s `ClientPort` exists, and it matters more here because correlation, restart and replay are all logic.

```ts
export type LspPort = {
  postMessage(m: LspRequestMessage): void
  addEventListener(type: 'message' | 'error', handler: (e: { data?: LspReplyMessage }) => void): void
  terminate(): void
}
```

The harness's accessor must throw rather than return `undefined` — `noUncheckedIndexedAccess` is on, and a test that silently reads `undefined` asserts against nothing:

```ts
const port = (): FakePort => {
  const p = ports[ports.length - 1]
  if (p === undefined) throw new Error('no port has been spawned — call client.start() first')
  return p
}
```

Seventeen tests, grouped:

- **starting up** — `initialize` declares `hierarchicalDocumentSymbolSupport` (the protocol's precondition for a nested outline, not a preference); messages sent before `ready` are queued, not dropped, and arrive in order `initialize, initialized, textDocument/didOpen`.
- **request correlation** — a response resolves its request; a response with an unknown id is dropped without throwing (a restarted worker can answer the previous instance's request); an error response rejects.
- **null-versus-empty** — `format` turns `result: null` into `[]`; `definition` turns it into `null`, which is an ordinary "no definition here" and must stay distinguishable from a rejection.
- **diagnostics** — `publishDiagnostics` routes to the sink by URI.
- **documents** — version bumps on every change (`textDocumentSync` is Full); a change to an unopened document is ignored; **a closed document leaves the replay set**, or a restart would reopen it after its view was gone.
- **worker death** — restarts once and replays every open document as `didOpen` (a fresh server has no document, so `didChange` would name a URI it has never seen); pending requests reject with `LspUnavailable`; a second death stays off and spawns no third worker; requests after that reject immediately.
- **module load failure** — no restart, because a second worker would fetch the same bytes.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && pnpm vitest run --project node tests/node/lsp-client.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/lsp-client"`.

- [ ] **Step 3: Write the client**

Use the pre-flight file. **The one line most likely to be written wrong:**

```ts
    this.#request('initialize', { /* ... */ }).catch(() => {
      // **SWALLOWED, AND NOT BECAUSE THE FAILURE DOES NOT MATTER.** This is the client's own
      // request rather than a caller's, so nothing is waiting on it: `#died` and `#receive` both
      // reject every pending request, and this one would have no consumer to catch it. An
      // unhandled rejection in a browser reaches `window.onunhandledrejection` and prints as an
      // uncaught error.
    })
```

Written as `void this.#request(...)` it produces **seven unhandled rejections across four passing tests**. See Step 5.

Two design decisions the implementer must not "simplify" away:

- **No timeout on a pending request.** The only reachable cause of a never-answered request is a dead worker, which the `error` listener already handles by rejecting everything pending. A timer for a cause already covered is exactly the dead ceiling `tests/node/browser-timeout-invariants.test.ts` exists because of.
- **The client owns the worker's lifecycle**, unlike `SessionClient`. There is one language server for the whole app, so there is no pool for it to sit in; `spawn` is still injected so the failure policy — and the DOM a notice needs — stays in `main.ts`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd web && pnpm vitest run --project node tests/node/lsp-client.test.ts`
Expected: `Tests 17 passed`, **and `Errors 0`**. If the summary reads `Tests 17 passed` with `Errors 7`, Step 3's `.catch` was written as `void`.

- [ ] **Step 5: Prove the unhandled-rejection guard is real**

Temporarily change the `.catch(() => {})` back to `void this.#request(...)`.

Run: `cd web && pnpm vitest run --project node tests/node/lsp-client.test.ts; echo $?`
Expected: `1` — Vitest fails the run on unhandled rejections, so the guard is gated rather than merely tidy. Restore the `.catch` and confirm `0`.

- [ ] **Step 6: Satisfy the linters**

Run: `cd web && pnpm exec biome check --write src/lsp-*.ts tests/node/lsp-*.test.ts && pnpm exec biome ci src/lsp-*.ts tests/node/lsp-*.test.ts`
Expected: `No fixes applied.` then no errors. `noUnsafeOptionalChaining` will reject `(m.params?.x as T).y`; type `params` as present rather than casting through an optional chain.

Run: `cd web && pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/lsp-client.ts web/tests/node/lsp-client.test.ts
git commit -m "The LSP client holds every decision, behind a port interface with no thread in it

Correlation, the document set and the restart-once rule are logic, so they are exercised against a
recording fake rather than a worker. Two facts the server taught us are encoded here: formatting an
unparseable document answers null rather than an empty list, and initialize's own rejection must be
caught or a worker death raises an uncaught rejection in the browser."
```

---

### Task 6: Diagnostics in the source editor, and the end of the `analyze` lint path

**Files:**
- Modify: `web/src/main.ts` — the `EditorView` construction, its `lintFromAnalyze` extension and its `updateListener`
- Delete: `web/src/lint.ts`
- Modify: `web/src/diagnostics.ts`
- Create: `web/tests/browser/lsp-diagnostics.test.ts`

**Interfaces:**
- Consumes: Task 5's `LspClient`.
- Produces: a module-level `lspClient` in `main.ts`, passed to Tasks 7–10.

**NOT pre-flight built. This is the riskiest task in the plan** — `main.ts` is 1,972 lines and this removes a synchronous path the app has depended on since Plan 5.

- [ ] **Step 1: Write the failing browser test**

`web/tests/browser/lsp-diagnostics.test.ts`: type `let x = ;` into the source editor and assert one `.cm-lintRange-error` appears, and that the gutter marker is present. Follow `web/tests/browser/harness.ts`'s existing mount helper.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm vitest run --project browser tests/browser/lsp-diagnostics.test.ts`
Expected: FAIL. **Note what it fails with**: today `lintFromAnalyze` already puts that marker there, so the test may *pass* before any change. If it does, the test is not yet testing this task — rewrite it against a language that has no diagnostics today (a TM copy, Task 7) or assert provenance, and record that in the commit.

- [ ] **Step 3: Build the client in `main.ts`**

Beside the session pool's spawn factory, which is where the app's other failure policy lives:

```ts
const lspClient = new LspClient(
  () => new Worker(new URL('./lsp-worker.ts', import.meta.url), { type: 'module' }),
  (uri, ds) => routeDiagnostics(uri, ds),
  notify,
)
lspClient.start()
```

- [ ] **Step 4: Replace the lint extension**

In the `EditorView` extension list, delete `lintFromAnalyze((src) => analyze(src) as Diagnostic[])` and keep `lintGutter()`. Diagnostics now arrive by push, so the editor takes them through `setDiagnostics` the way `ScratchEditor` already does.

In the same `updateListener` that dispatches `setSpans`, add the document change:

```ts
lspClient.changeDocument(SOURCE_URI, src)
```

**Not debounced here.** `@codemirror/lint`'s 100 ms delay was a pull-side debounce and there is no pull any more; the server's own cost is 0.15 ms for a source document. If a debounce turns out to be wanted, measure first and put the figure in the commit.

Open the document once, after the editor is constructed and before `compile.schedule(SAMPLE)`:

```ts
lspClient.openDocument(SOURCE_URI, 'redextape', SAMPLE)
```

- [ ] **Step 5: Delete `lint.ts` and shrink `diagnostics.ts`**

Run: `grep -rn "lintFromAnalyze\|from './lint'" web/src web/tests`
Expected: no hits outside `lint.ts` itself. Then delete the file.

`diagnostics.ts`'s `lintRanges` converts Rust byte offsets to UTF-16 indices. LSP ranges are already UTF-16 line/character, so that conversion is not needed for diagnostics. Run `grep -rn "lintRanges\|byteToIndex\|byteIndexAt" web/src` and keep only what `link.ts` and `lambda-pane.ts` still use. **Do not delete `spans.ts`** — the λ pane's frame rendering depends on it and is not part 3's to touch.

- [ ] **Step 6: Run the test and the whole suite**

Run: `cd web && pnpm vitest run --project browser tests/browser/lsp-diagnostics.test.ts`
Expected: PASS.

Run: `cd web && pnpm vitest run`
Expected: all pass. **Expect fallout**: `tests/node/diagnostics.test.ts` tests `lintRanges`, and any test importing `lint.ts` now fails to resolve. Update them in this commit rather than a later one.

- [ ] **Step 7: Commit**

```bash
git add -A web/src web/tests
git commit -m "Source diagnostics come from the language server, and the synchronous analyze path is gone

The content does not change and that is provable rather than hoped: Language::Redextape's
diagnostics ARE analyze's, asserted by a test in language.rs. What changes is the thread and the
position units — LSP ranges arrive as UTF-16 line/character, so diagnostics.ts's byte conversion is
deleted rather than ported."
```

---

### Task 7: Diagnostics in λ and TM copies

**Files:**
- Modify: `web/src/scratch-editor.ts`, `web/src/lambda-pane.ts`, `web/src/tm-pane.ts`, `web/src/replies.ts`
- Modify: `web/tests/browser/lsp-diagnostics.test.ts`

**Interfaces:**
- Consumes: Task 5's `LspClient`, Task 3's `LANGUAGE_OF_PANE` and `documentUri`.
- Produces: every editor in the app is an LSP document.

**NOT pre-flight built.** The TM half is the umbrella's headline — `setDiagnostics` has callers in `lambda-pane.ts` and nowhere else today, so a TM copy shows nothing.

- [ ] **Step 1: Extend the browser test to all three editors**

Add a TM copy case: open a TM copy, type `tapes 1\ntapes 2\nstart s\nstate s: accept\n`, assert one error marker reading `duplicate \`tapes\` line`. **This case fails today and cannot pass before this task**, which is what makes it the failing test.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm vitest run --project browser tests/browser/lsp-diagnostics.test.ts`
Expected: FAIL on the TM case — no marker at all.

- [ ] **Step 3: Make a `ScratchEditor` an LSP document**

`ScratchEditor` gains a URI and a language, opens its document on construction and closes it on `destroy()`. Its `#schedule` already debounces edits; route them to `changeDocument` as well as `onEdit`.

`setDiagnostics` changes shape: it takes `LspDiagnostic[]` and no longer calls `lintRanges`, because LSP ranges are already UTF-16. Convert line/character to a CodeMirror offset with `view.state.doc.line(d.range.start.line + 1).from + d.range.start.character`.

**The zero-width case is still the common one.** `diagnostics.ts`'s widening existed because `let x = ;` reports at a point and CodeMirror renders nothing for `from === to`. That is a property of CodeMirror, not of byte offsets, so **the widening must survive the conversion change even though the byte arithmetic does not.** Carry it over and keep its test.

- [ ] **Step 4: Stop the session worker pushing diagnostics**

In `replies.ts`, delete the `for (const p of panes.ofSession('lambda', session)) (p.pane as LambdaPane).setDiagnostics(reply.diagnostics)` line and whatever becomes unused with it. Check whether `RunReply` still needs its `diagnostics` field; if nothing reads it, that is a protocol simplification — but **verify with a grep before removing a wire field**, and if it is still read, say so rather than removing it.

- [ ] **Step 5: Run the suite**

Run: `cd web && pnpm vitest run`
Expected: all pass, TM case included.

- [ ] **Step 6: Commit**

```bash
git add -A web/src web/tests
git commit -m "Every editor is a language-server document, and a TM copy shows a diagnostic for the first time

setDiagnostics had callers in lambda-pane.ts and nowhere else, which is what the umbrella's 'closes
the TM gutter showing none' meant, literally. The zero-width widening survives the move even though
the byte arithmetic under it does not: rendering nothing for from === to is a property of
CodeMirror, not of the offsets."
```

---

### Task 8: Format, and format on blur

**Files:**
- Modify: `web/src/pane-chrome.ts` (the `⋯` menu), `web/src/app-header.ts` (the settings menu), `web/src/workspace.ts` (the setting)
- Create: `web/tests/browser/lsp-format.test.ts`

**Interfaces:**
- Consumes: `LspClient.format`.
- Produces: a `formatOnBlur: boolean` in the persisted workspace state.

**NOT pre-flight built.** Part 2a left the `⋯` menu slot and the settings menu for exactly this.

- [ ] **Step 1: Write the failing test**

Format an unformatted program from the `⋯` menu and assert the editor text becomes the formatted form. Then a second case: an unparseable buffer is **unchanged and raises no error**. That second case is the one the server's `null` makes interesting.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm vitest run --project browser tests/browser/lsp-format.test.ts`
Expected: FAIL — no `format` item in the menu.

- [ ] **Step 3: Add the menu item and apply the edits**

```ts
const edits = await lspClient.format(uri)
if (edits.length === 0) return
// `textDocumentSync` is Full and the formatter is `print ∘ parse`, so the server sends ONE edit
// over the whole document — a range that stopped short would append the formatted file to the
// remains of the old one.
```

Apply as a CodeMirror transaction, converting each edit's range the same way Task 7 converts a diagnostic's.

- [ ] **Step 4: Add the setting**

A `format on blur` checkbox in the settings menu, persisted in workspace state, default **off**. On editor blur, when on, run the same path. It is safe to leave on because an unparseable buffer formats to nothing (Step 1's second case).

- [ ] **Step 5: Run and commit**

Run: `cd web && pnpm vitest run --project browser tests/browser/lsp-format.test.ts`
Expected: PASS.

```bash
git add -A web/src web/tests
git commit -m "Format lands in the view menu and behind an opt-in blur setting

An unparseable buffer formats to nothing rather than to an error, because Language::format answers
None and the client turns the server's null into an empty edit list. That is what makes format on
blur safe to leave on."
```

---

### Task 9: The outline panel

**Files:**
- Modify: `web/src/pane-host.ts` or the view that mounts panels
- Create: `web/tests/browser/lsp-outline.test.ts`

**Interfaces:**
- Consumes: `LspClient.documentSymbols`, `createPanel` from `panel.ts`.
- Produces: a `panel.ts` consumer named `outline`.

**NOT pre-flight built.**

- [ ] **Step 1: Write the failing test**

The outline panel for a source view listing `fact`; clicking the entry moves the caret to its definition. And: **the panel is absent for a λ view**, not present-and-empty — the umbrella's §4 rule 4 removes a control where it can never apply, and `.rxlambda` answers no symbols by design.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm vitest run --project browser tests/browser/lsp-outline.test.ts`
Expected: FAIL — no `[data-panel="outline"]`.

- [ ] **Step 3: Build the panel**

`createPanel({ name: 'outline', label: 'Outline', body, open, onToggle })`. Its open state persists per view in the workspace state, which `panel.ts`'s doc already describes as the mechanism.

Render `LspDocumentSymbol[]` as a tree — the nested shape is available because Task 5's `initialize` declared `hierarchicalDocumentSymbolSupport`.

**This was verified end to end before the plan was finished, and it is not a guess.** The real `LspClient` was driven against the real wasm server in Node: with the client's `initialize`, `documentSymbols` returns entries carrying `selectionRange` and no `location` — the `DocumentSymbol` shape. An earlier probe that sent `capabilities: {}` got the flat `SymbolInformation` shape back from the same server, so the declaration is what makes the difference, and it works. If entries ever come back flat, the capability stopped reaching the server; fix that rather than rendering the flat shape.

- [ ] **Step 4: Run and commit**

Run: `cd web && pnpm vitest run --project browser tests/browser/lsp-outline.test.ts`
Expected: PASS.

```bash
git add -A web/src web/tests
git commit -m "The outline is a panel, and it is removed rather than emptied for lambda

A λ term carries no source positions, so the server answers no symbols by design. A panel that can
never have content is removed, which is the umbrella's rule for a control that cannot apply."
```

---

### Task 10: Definition and references, across views

**Files:**
- Modify: the source and copy editors' keymaps; `web/src/notice.ts` consumers
- Create: `web/tests/browser/lsp-navigation.test.ts`

**Interfaces:**
- Consumes: `LspClient.definition`, `LspClient.references`.
- Produces: nothing later tasks depend on.

**NOT pre-flight built.**

- [ ] **Step 1: Write the failing test**

Three cases: definition within one document moves the caret; references lists all three occurrences in `fact`; and **a result in another open view focuses that view and scrolls it**. A fourth: a result in a document no view holds shows a notice and opens nothing.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm vitest run --project browser tests/browser/lsp-navigation.test.ts`
Expected: FAIL — the keybinding does nothing.

- [ ] **Step 3: Wire it**

A keymap entry per editor, reachable from the keyboard (umbrella §4 rule 5), announcing the jump through part 2a's live region. `definition` answering `null` is the ordinary case for a cursor on a keyword and must do nothing visible — **not show an error**.

Cross-view: map the returned URI back to a view via Task 3's `documentUri`. **Part 3 does not create views** — if nothing holds that URI, notify rather than opening one.

- [ ] **Step 4: Run and commit**

```bash
git add -A web/src web/tests
git commit -m "Definition and references jump, including across views, and announce it

A null definition is a cursor on a keyword, not a failure, so it does nothing visible. A target no
view holds says so rather than opening one — part 3 does not get to change the layout."
```

---

### Task 11: Accessible names, the whole-branch checks, and the roadmap entry

**Files:**
- Modify: `web/src/main.ts`, `web/src/scratch-editor.ts` (editor accessible names)
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the PR.

- [ ] **Step 1: Close accessibility item 16**

"Neither editable text region carries an accessible name" — the umbrella's §9 assigns item 16 to part 3. Give each editor an `aria-label` naming its view and language. Assert it in the existing class-level control test rather than a new file.

- [ ] **Step 2: Run everything the merge gate runs**

`scripts/check-all.sh` is not all of CI. Run each:

```bash
bash scripts/check-all.sh
cargo llvm-cov nextest --workspace --fail-under-lines 90
bash scripts/check-slow.sh
cd web && pnpm run test:coverage
```

Expected: all pass. **The web coverage thresholds are `lines 97, functions 97, branches 89, statements 95`.** This branch adds a worker module that v8 cannot instrument — add `src/lsp-worker.ts` to `vite.config.ts`'s `coverage.exclude` **only after measuring that it reports 0%**, and write the measurement into the comment the way the existing `session-worker.ts` entry does. Do not adjust a floor to make a number fit.

- [ ] **Step 3: Write the roadmap entry before opening the PR**

A `####` heading in the house style, recording what shipped, what the pre-flight found before any implementer saw the plan, and every figure with the command that produced it.

- [ ] **Step 4: Open the PR**

Body in one long line per paragraph — Forgejo renders with GFM `breaks: true`, so a hard-wrapped paragraph renders ragged. Fact-check every claim in the body against the branch before opening.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Editors carry accessible names, and the roadmap records what the pre-flight found"
```

---

## Self-review

**Spec coverage.** §3.1 → Task 1. §3.2 → Task 4. §3.3 → Task 5. §4 → Task 3. §5.1 → Tasks 6 and 7. §5.2 → Task 8. §5.3 → Task 9. §5.4 → Task 10. §10's failure table → Task 5's tests (worker death, module failure) and Tasks 8/10 (unparseable format, missing target). §11.2 → Tasks 6–10's browser tests. §11.4 → Task 3. §12 → Task 11. **§5.1.1's ceiling is not in this plan** — it is measured in the browser during 3b, because the ceiling covers colouring and diagnostics together and 3b is where colouring lands. That is a deliberate deferral, recorded here so it is not simply missing.

**Type consistency.** `LspClient`'s surface in Task 5 is the one Tasks 6–10 call; `documentUri` and `LANGUAGE_OF_PANE` are defined in Task 3 and used in Tasks 6, 7 and 10; `LspDiagnostic` is what `setDiagnostics` takes after Task 7, not `Diagnostic`.

**Known gap.** Tasks 2 and 6–11 were not pre-flight built. Task 6 is the one to review hardest: it deletes a synchronous path from a 1,972-line file, and its Step 2 explicitly warns that the obvious failing test may pass before the change.
