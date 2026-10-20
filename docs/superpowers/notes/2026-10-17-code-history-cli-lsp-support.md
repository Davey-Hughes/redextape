# Code history moved out of comments

Text moved verbatim out of code comments when they were trimmed to their why. Each entry names the file and the line of code the comment sat above.

## `crates/redextape-cli/src/config.rs`, above `use crate::emit::EncodingArg;`

Probed directly with `rustc -D warnings` over three uncalled shapes: an allowed CALLER silences its callee, and its callee's callee; an allowed CALLEE silences nothing above it, its caller still reported. Read that against this module's own call graph and the outermost item is `load`: its allow shielded `discover` and `parse`, and through `parse` everything `parse` reaches. `parse`'s own allow reached only its subtree — `validate`, the range constant, and the two `Error` variants those two construct — and never `load` above it.

## `crates/redextape-cli/src/emit.rs`, above `#[test]`

and until `AsmHeader::for_type` grounded it, `[]` emitted with no header and `run` refused the file.

## `crates/redextape-cli/src/emit.rs`, above `fn emit_described(`

Measured on `40 + 2`: `--field-width 4` refuses under BOTH encodings, and `--encoding binary --field-width 8` emits at exit 0 — so on the pinned path the encoding suggestion was not merely unhelpful, it pointed away from the one setting that actually caused the refusal.

## `crates/redextape-cli/src/emit.rs`, above `let grounded = redextape_core::ty::ground(ty.clone());`

`ty::is_decodable` grounds `ty` for its own round-trip check, and the message below used to ground it again through `ty::ground` for the words alone.

## `crates/redextape-cli/src/emit.rs`, above `if lang != Lang::Tm {`

so the guard below used to read `encoding != EncodingArg::default()` and let `--lang lambda --encoding unary` through at exit 0 while the README promised a 2.

## `crates/redextape-cli/src/fmt.rs`, above `fn tmpdir(name: &str) -> redextape_test_support::ScratchDir {`

Not hypothetical: the two `--check`-on-a-clean-file tests below both ask for "check-clean", and used to fail 4 of 15 `cargo test -p redextape-cli` runs on exactly the collision `redextape_test_support::ScratchDir`'s per-call counter now rules out, while every `cargo nextest` run (one process per test) stayed green — so the gate could not see it and never will.

## `crates/redextape-cli/src/fmt.rs`, above `#[allow(clippy::too_many_arguments)]`

an earlier revision of this comment claimed those two fields "cannot fold into an enclosing struct without losing what each one is for", which is false

## `crates/redextape-cli/src/form.rs`, above `const MATRIX: &[(&str, Option<Form>)] = &[`

DERIVED from design §4.1's matrix, measured against the real front ends before this plan was written — not a copy of it, and the two lists being twelve rows each is a coincidence that hid the difference. Three of §4.1's rows have no counterpart here: a comment-free minimal tm, `42` and `x`.

## `crates/redextape-cli/src/report.rs`, above `let src = "// π\nlet mut x = 1; x + 1";`

Confirmed by making that swap locally: the label moved one column later, exactly as this comment predicts.

## `crates/redextape-cli/src/run.rs`, above `#[test]`

measured directly on commit `a148c6c`, which aborts under a 2 GiB or 4 GiB `ulimit -v`, completing only at 8 GiB

## `crates/redextape-cli/src/run.rs`, above `#[test]`

before the `(pointer, depth)` memo, a heap of `n` cells sharing one spine across two nesting levels reached `MAX_DECODE_NODES` at `n = 6000` (`n² + n + 1` nodes from `n` cells).

Measured directly on commit `a148c6c`, where the fixture this test used before the extraction to `report_asm_decode` still exists (320,000 cells, sharing spread across all 64 `MAX_TY_DEPTH` levels): decoding it aborts with `memory allocation ... failed` under both a 2 GiB and a 4 GiB `ulimit -v`, and only completes at 8 GiB, in ~15s per test. That is unaffordable for the fast tier and marginal even for the slow one run at default (concurrent) thread count. Reaching `BudgetExhausted` at all means `spend` ran `MAX_DECODE_NODES` = 20,000,000 times, so ~20,000,000 live `Value` nodes (roughly 1 GB) exist at the moment of refusal regardless of how few heap cells built them — that memory cost is inherent to reaching the budget at all, not a property of this particular fixture's cell count. So the fixture is gone rather than shrunk: shrinking the CELL COUNT would not have shrunk that memory cost.

neither the favorable (longest-suffix-first, `tails`-shaped) order nor the adversarial (increasing) order Task 3's review once used as a counterexample reaches the budget cheaply

## `crates/redextape-cli/src/run.rs`, above `/// MISMATCH, `.asm` form. `result Bool` over a machine that leaves `rr = 7` (not `0`/`1`)`

`Mismatch` (the file's fault, exit 1) and `BudgetExhausted` (the tool's limit, exit 2) used to be conflated on the `.asm` path (always `ToolFailed`) and on the `.tm` path (always `ProgramFailed` — the pre-existing bug `decode_tape_ty_reason` also fixes). These four tests pin the corrected, SYMMETRIC behaviour: both runners now give the same cause the same exit code and an honest message.

## `crates/redextape-cli/src/run.rs`, above `redextape_core::tm::TmRun::TooLarge => {`

a balanced expression tree reaches it from about 6 KB of source, and the allocation before refusal is roughly 700 MB.

## `crates/redextape-cli/src/run.rs`, above `fn print_reference_value(`

this task's safety note forbids constructing a `tails`-shaped result via a running program, and this function needs nothing but a `Value` to test.

## `crates/redextape-cli/src/run.rs`, above `fn run_asm_artifact(`

An earlier revision of this function gave the whole decode ONE treatment — always `ToolFailed`, always "does not decode as `Ty`" — which was backwards for a lying header and right only by coincidence for a budget exhaustion; `run_artifact_text` had the opposite bug, always blaming the file.

## `crates/redextape-cli/src/run.rs`, above `report_tm_decode(decoded, label, &header.result, out, err)`

An earlier revision of this comment argued every failure here was the file's fault, on the strength of `HeaderParts::directive` (D5) already refusing a `result` that is not a value type — true, but not the whole story:

## `crates/redextape-cli/tests/cli.rs`, above `#[test]`

Measured with the ignore file moved aside: `git status --porcelain --untracked-files=all` still lists none of the markers, `git check-ignore -v` reports the path matched by no rule at all, and `git add -f` on one of them silently stages nothing.

verified directly, including with `core.protectHFS`/`core.protectNTFS` off

## `crates/redextape-cli/tests/config_cli.rs`, above `#[test]`

Item 2 (filed during the branch): nothing exercised `main`'s `Err(_) => Source::Defaults` fallback, taken when `std::env::current_dir()` fails.

confirmed directly before writing this test

## `crates/redextape-cli/tests/config_cli.rs`, above `let text = String::from_utf8(pinned.stderr).unwrap();`

— the shape that once let eleven mutations survive a full suite in this repository.

## `crates/redextape-cli/tests/config_cli.rs`, above `#[test]`

**`emit.field-width` WAS THE ONE CONFIG KEY WHOSE EFFECT NO TEST COULD FAIL ON.** The other three keys each had a takes-effect test; this one had only refusal tests, and a sabotage that reads the key, validates it and then ignores it passes every refusal test there is.

Re-measured at this tree with exactly that one argument changed, `cargo nextest run --workspace --no-fail-fast` reports `1615 tests run: 1613 passed, 2 failed, 12 skipped` — and the two are this test and `a_config_pinned_overflow_names_the_key_rather_than_a_flag_nobody_typed` in `emit.rs`. Both arrived in the same commit as the key itself, which is the sense in which nothing could fail on it before.

## `crates/redextape-cli/tests/config_cli.rs`, above `const SRC: &str = "fn f(a) {\n    a\n}\nf([100000, 200000, 300000, 400000, 500000, 600000,`

confirmed directly: `format_with_width(SRC, 120) == SRC` (clean) and `format_with_width(SRC, 40)` wraps the list onto its own lines (dirty). See the task report for both outputs side by side.

## `crates/redextape-cli/tests/fmt_stdin.rs`, above `use assert_cmd::Command;`

(An earlier version of this file claimed rustfmt/black/prettier/gofmt all dump the reformatted file under `--check`; that claim was checked and is false — rustfmt prints a diff, black prints nothing and reports only via the exit code, prettier prints a filename token. None of them dumps reformatted source, so there was never a real precedent for `--check -` doing so here either.)

## `crates/redextape-cli/tests/form_agreement.rs`, above `#![allow(clippy::unwrap_used)]`

An earlier version collapsed the table's second column to `*expected != "rxt"` before comparing, which made `("p.asm", "asm")` and `("p.asm", "tm")` the same test: a defect mapping `.asm` onto `Form::Tm` left every row green, because both forms are equally "an artifact".

## `crates/redextape-grammar-check/src/asm.rs`, above `#[must_use]`

Measured over 64 samples of `arb_expr_over` at the leaf range in use: nothing refused.

## `crates/redextape-grammar-check/src/asm.rs`, above `fn lower_via_program_template(core: &redextape_core::core::Core) -> Option<redextape_core:`

reproduced while `redextape_core::tm::lower_program` was private (it is public now)

## `crates/redextape-grammar-check/src/asm.rs`, above `use crate::grammar::{Grammar, compare_classified};`

which went through review

## `crates/redextape-grammar-check/src/grammar.rs`, above `/// Every capture name this grammar's queries emit has a row in `capture_classes`. Adding `

PROMOTED FROM `tests/captures.rs` AND `tests/lambda.rs`, WHERE THEY WERE DUPLICATED VERBATIM.

## `crates/redextape-grammar-check/src/grammar.rs`, above `pub fn every_query_pattern_fires(&self, corpus: &[(&str, &str)]) -> Result<(), String> {`

The λ grammar shipped one — `(parenthesized_term (identifier) @variable)` — that no corpus entry reached AND that the printer can never produce, so it had zero coverage in the whole pipeline while every test stayed green.

## `crates/redextape-grammar-check/src/lambda.rs`, above `#[must_use]`

A λ measurement that reduces has previously cost this machine 60 GiB of RAM and all of swap — see the roadmap.

## `crates/redextape-grammar-check/src/tm.rs`, above `#[must_use]`

and it is the reason design §6.3's gap is much narrower than that section originally claimed.

## `crates/redextape-grammar-check/src/tm.rs`, above `#[must_use]`

Measured over `arb_expr_over` at both leaf ranges in use, 128 samples each: nothing refused.

## `crates/redextape-grammar-check/src/tm.rs`, above `use crate::grammar::{Grammar, compare_classified};`

, which is the fact design §6.3 got wrong until PR 3's survey corrected it

## `crates/redextape-grammar-check/tests/asm.rs`, above `#[test]`

— the standard every PR in the tree-sitter slice has met, and PR 1's review found `compare_classified` had shipped entirely untested.

## `crates/redextape-grammar-check/tests/asm.rs`, above `#[test]`

fifteen runs observed on 2026-08-26 ranged from 8,384 to 9,620. Even at the top of that range this leg compares less than a sixteenth of what λ's 256-case leg does (163K) and less than a twenty-ninth of TM's 32-case leg (282,006).

measured over 64 samples at this leaf range, `lower_asm` refused nothing.

## `crates/redextape-grammar-check/tests/captures.rs`, above `#[test]`

**THIS CANNOT BE A DIFFERENTIAL TEST, AND THAT IS WHY THE DEFECT SURVIVED PR 1 AND PR 2.**

Measured before the fix — `let x =<VT>1;` gave the grammar 0 error nodes and 5 captures, `classify_source` the same 5 spans as a plain space, and `parser::parse` the diagnostic "unexpected character".

That single disagreement is the whole bug.

## `crates/redextape-grammar-check/tests/captures.rs`, above `#[test]`

REPLACES A TAUTOLOGY. This test used to dedup the returned spans and assert the length was unchanged — which a `BTreeMap` keyed by `(start, end)` guarantees before the test runs, so it could not fail for any implementation that used one. Asserting on real content can.

## `crates/redextape-grammar-check/tests/golden.rs`, above `const TM_PROGRAM: &str = "1";`

measured, `redextape emit <PROGRAM> --lang tm | wc -c`

10 states and 13 rule lines over 1,158 code units

## `crates/redextape-grammar-check/tests/lambda.rs`, above `#[test]`

PR 1 shipped `compare_classified`'s span-for -span comparison completely untested — deletable with the suite still green, caught only by the final whole-branch review — and this is what closes that gap for λ.

verified by actually running it rather than assumed up front

## `crates/redextape-grammar-check/tests/lambda.rs`, above `#[test]`

PROMOTED to `Grammar::every_corpus_program_parses_without_error_nodes` — this test and `tests/corpus.rs`'s identically-named mini-language one were duplicated verbatim, and neither reads anything grammar-specific beyond `self`.

## `crates/redextape-grammar-check/tests/tm.rs`, above `#[test]`

— the standard PR 1 and PR 2 both met, and PR 1's review found `compare_classified` shipped entirely untested.

, which is the true half of what design §6.3 originally claimed

## `crates/redextape-grammar-check/tests/tm.rs`, above `#[test]`

and takes the whole crate from 0.600 s to 0.742 s

measured over 128 samples at both leaf ranges in use, `lower_asm` refused nothing.

## `crates/redextape-grammar-check/tests/tm.rs`, above `#[test]`

and the reason design §6.3's gap is much narrower than that section claimed before PR 3's survey.

## `crates/redextape-grammar-check/tests/tm.rs`, above `#[test]`

PROMOTED to `Grammar::capture_map_is_total` in PR 2, specifically so this grammar would call it rather than become a third verbatim copy.

## `crates/redextape-lsp-wasm/src/lib.rs`, above `#[must_use]`

An earlier draft of this comment said "the client's own timeout is what reports it"; `lsp-client.ts` says the opposite in capitals, and deliberately — a ceiling whose only reachable cause is already handled by a listener is a ceiling that never fires, which this repository has paid for before.

## `crates/redextape-lsp-wasm/src/lib.rs`, above `use wasm_bindgen::prelude::*;`

**THE SERVER IS UNCHANGED BY THIS CRATE EXISTING, WHICH WAS MEASURED BEFORE IT WAS WRITTEN.** A throwaway build of exactly this shape answered `initialize`, `didOpen`, `didChange`, `formatting`, `documentSymbol`, `definition` and `references` correctly under Node, and returned one real diagnostic for broken input in each of the four languages.

## `crates/redextape-lsp/src/document.rs`, above `pub nav: Option<NameIndex>,`

**CACHED FOR THE SAME REASON `index` IS, AND IT WAS NOT UNTIL A REVIEW MEASURED THE DIFFERENCE.**

Measured on a real emitted machine (1,906,914 bytes, 8,610 states): rebuilding is 33.25 ms against `LineIndex::new`'s 0.26 ms, and every navigation request paid it.

## `crates/redextape-lsp/src/language.rs`, above `assert_eq!(Language::Redextape.hover("let x = 1;\nx", 0, None), None);`

Originally (Task 1) `hover::rxt`, `hover::tm` and `hover::asm` were all unconditional `None` stubs, so this test alone could not prove WHICH stub a given `Language` arm called — a mis-wiring that swapped `Tm`'s and `Asm`'s dispatch would have been byte-identical to this assertion passing.

None of the three stubs remain, so each fixture below is instead a position its own live handler genuinely has nothing to say about

## `crates/redextape-lsp/src/language.rs`, above `let out = Language::Tm.format(TM_COMMENTS).expect("the fixture parses");`

THE WHOLE REASON PR A EXISTS. Before it, `print ∘ parse` over these two forms deleted every comment in the file

## `crates/redextape-lsp/src/language.rs`, above `pub(crate) fn outline_kind(kind: DefKind) -> Option<SymbolKind> {`

**THIS TAKES NO `Language`, AND THAT IS WHAT REPLACED A TEST.** `Language::symbol_kind` answered one fixed kind per form, and `every_form_with_an_index_has_a_symbol_kind` existed to stop `nav` and that match drifting apart — because a form gaining an index without gaining a kind reports nothing in an outline, with no compile error. `DefKind` moves the answer to the push site, so the match is exhaustive over kinds and a new one is a compile error here. The test is gone; the compiler holds what it held.

The name is `outline_kind` rather than `symbol_kind` because those are two different questions and the old name answered one.

## `crates/redextape-lsp/src/language.rs`, above `#[must_use]`

Core's three functions used to call `parse_tm_nav`/`parse_asm_nav`/`nav_rxt` themselves — a full re-parse on every hover request, on top of the one `Document::nav` already pays and caches per version.

## `crates/redextape-lsp/src/lib.rs`, above `let mut server = Server::new();`

**THIS USED TO DRIVE THE SAME REQUEST THROUGH ALL THREE AT POSITIONS CHOSEN TO HAVE NOTHING TO SAY, BECAUSE `hover::asm` WAS AN UNCONDITIONAL STUB AND "STILL NULL" WAS THE ONLY THING THERE WAS TO ASSERT.** All three forms now answer real content, and three `null`s prove far less than three distinct sentences would

## `crates/redextape-lsp/src/lib.rs`, above `let mut server = Server::new();`

AND THE REASON THE INDEX WAS NOT CACHED BEFORE IS THAT NOTHING MADE IT CHEAP TO GET WRONG.

## `crates/redextape-lsp/src/lib.rs`, above `#[test]`

Both stay, but not for the reason once written here:

## `crates/redextape-lsp/src/lib.rs`, above `let out = server.handle(request(3, "textDocument/rename", &json!({})));`

`textDocument/rename` rather than `textDocument/hover`: this test is about the arm that answers a method this server does not serve, and hover — which it used to name — is served as of part 3c. Swapping the assertion would have deleted the test's subject.

## `crates/redextape-lsp/src/lib.rs`, above `let mut server = Server::new();`

Probed:

This used to answer `null`, which tells someone hunting every jump still to fix that the name under their cursor is not a name.

## `crates/redextape-lsp/src/lib.rs`, above `fn invalid_params(id: Id, method: &str, err: &serde_json::Error) -> Outgoing {`

All four request handlers used to deserialize with `.ok()`, so

## `crates/redextape-lsp/src/lib.rs`, above `let nav = doc.nav.as_ref()?;`

This used to rebuild it per request, which is a whole parse, and then return it by value.

## `crates/redextape-lsp/src/lib.rs`, above `fn document_symbol(&self, id: Id, params: serde_json::Value) -> Outgoing {`

(An earlier version of this sentence said "25,852 states". That is `map_fold`'s ROW count — the states and the rules added together — so it both inflated the state count 3.5x and named the one quantity that is neither of the two this decision is about.)

they shipped with

## `crates/redextape-lsp/src/lib.rs`, above `let spans: Vec<_> = match nav.definition_of(i) {`

This used to short-circuit on `definition_of(i)?` and answer `null`, which tells someone hunting every `jmp nowhere` still to fix that the name under their cursor is not a name — in exactly the mid-edit state `nav.rs`'s module doc calls the moment navigation is worth most.

## `crates/redextape-lsp/src/lib.rs`, above `fn hover(&self, id: Id, params: serde_json::Value) -> Outgoing {`

and re-parsing it per request was never necessary: `doc.nav.as_ref()` is passed straight through to `Language::hover`, which is why hover takes a third argument now

## `crates/redextape-lsp/src/outline.rs`, above `let src = nested_fn_source(3, 3);`

Measured on this branch:

## `crates/redextape-lsp/src/outline.rs`, above `#[test]`

Measured on this branch,

## `crates/redextape-lsp/src/outline.rs`, above `fn assert_definitions_match_tree(nav: &NameIndex, src: &str, ctx: &str) {`

measured on `"fn f(p) { fn f(q) { let z = 1; z } f(0) } 0"`, with `attach` sabotaged to prefer the OUTERMOST open extent instead of the innermost, `z` (correctly the inner `f`'s child) is misattached to the outer `f` instead — and because both parents are named `f`, the name-only form of this check (comparing `container.map(str::to_string)` against `expected_parent`'s name alone, as this function did before this paragraph) produced an identical sorted multiset for the correct and the misplaced tree, so it passed against the misplaced one.

## `crates/redextape-lsp/src/outline.rs`, above `#[test]`

Probed on 6e0ad6e:

## `crates/redextape-lsp/src/outline.rs`, above `#[test]`

Offsets measured on a real run: `f@3-4[x@14-15] z@29-30`.

## `crates/redextape-lsp/src/outline.rs`, above `#[test]`

Probed on 6e0ad6e:

## `crates/redextape-lsp/src/outline.rs`, above `#[test]`

Probed on 6e0ad6e:

Offsets measured on a real run of this source, not computed by hand:

## `crates/redextape-lsp/src/outline.rs`, above `pub(crate) fn enclosing_line(text: &str, span: Span) -> Span {`

Containment holds either way, which is the only requirement the earlier doc comment checked itself against.

## `crates/redextape-test-support/Cargo.toml`, above `syn = { version = "2", features = ["full", "parsing", "printing", "visit"] }`

the text-scanning version of that rule was defeated by ordinary Rust four times across three review rounds — a qualified `std::option::Option`, two `ts(...)` groups on one line, an anchor inside an already-open attribute, and a comment lexer that mistook a char literal for a string. Every one of those is a question about Rust's grammar, which is a closed and finite thing that `syn` already answers.

stated per crate because "every consumer" was written here first and was false.

`cargo tree -i redextape-test-support --target wasm32-unknown-unknown -p redextape-wasm --edges normal,build,dev` prints `nothing to print`, and `cargo check --target wasm32-unknown-unknown -p redextape-wasm --all-targets` exits 0.

`cargo check --target wasm32-unknown-unknown -p redextape-core --all-targets` fails on `wait-timeout`, as it did before.

## `crates/redextape-test-support/src/lib.rs`, above `pub struct ScratchDir {`

**REPLACES EIGHT NEARLY-IDENTICAL `tmpdir`/`tree` FIXTURE HELPERS** that used to live one per module across `redextape-cli` and `redextape-native`. Every one of them called `std::fs::remove_dir_all` at the START of a fixture, purely to clear whatever a PREVIOUS run of the same binary had left behind — and never at the end, so a passing run's directory and a failing one's alike accumulated forever under `std::env::temp_dir()`. Measured on one machine before this type existed: 1180 `redextape-config-*` and 1106 `redextape-lint-*` directories, 5.6 MB — and that machine's `/tmp` is a 30 GiB RAM tmpfs with its own documented history of OOM from exactly this kind of pressure, so this is not merely tidiness.

Carries the pid-plus-atomic-counter idiom every one of those helpers already had its own copy of (`redextape-cli`'s `fmt::tests::tmpdir` has the fullest account of why)

(what every helper this replaces did, when it cleaned up at all)

## `crates/redextape-test-support/src/lib.rs`, above `pub mod ts_derive_scan;`

**IT IS NO LONGER FREE, AND THIS SENTENCE USED TO SAY IT WAS.** It read "it is plain `std`, so a consumer that opts out of `proptest` compiles it at no dependency cost" — true until the nullability rule started parsing Rust instead of scanning it, which put `syn` and `quote` in this crate's unconditional `[dependencies]`.

Measured: `cargo tree -p redextape-cli -e normal,dev -i syn@2.0.119` prints `syn` beneath `redextape-test-support` beneath `redextape-cli`

## `crates/redextape-test-support/src/lib.rs`, above `#![cfg_attr(test, allow(clippy::pedantic))]`

This crate was for a long time a test-only helper library with no inline `#[cfg(test)]` module of its own; `ts_derive_scan` now has one, whose tests drive the override rule from source fixtures rather than from the filesystem

AND AN EARLIER VERSION OF THIS COMMENT CLAIMED OTHERWISE.

MEASURED rather than reasoned, which is what the first version of this sentence was not:

which is what it was doing before and what it is still doing.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[test]`

This used to leave the flag false and re-bless the whole-file skip in silence.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[test]`

Worse than a false red before the fix: this anchored and reported a violation against the NEXT field, naming an override that field does not carry.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `if escaped {`

— the same false-red class the quote handling was added to fix, one level down.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `struct TsKeys(Vec<(String, Option<String>)>);`

A previous version of this parser demanded a string literal, so it panicked `cannot parse` on the only spelling a real crate can contain — and its message then told the reader to write that spelling, which panicked again. **The fixture that claimed to prove the good case passed used the quoted form**, a shape no compiling tree can hold: the test and the parser agreed with each other about a thing that does not exist.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `fn check_fields(path: &Path, owner: &str, fields: &syn::Fields) {`

— the shape `resolve_field` used to refuse outright as one it had never been measured against.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `struct FieldWalk<'a> {`

The over-claim is worth correcting rather than softening: an earlier version of this paragraph said the visitor makes the two gates in this binary unable to answer differently about the same type, and that is still FALSE

Three rounds of "descend into `mod`", then "and into `fn` bodies", then "and into `impl` methods" were each correct and each left the next container out:

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `pub fn assert_overrides_match_field_nullability(crate_root: &Path) {`

**THE DEFECT THIS EXISTS FOR WAS SHIPPED TWICE BY THE SAME MECHANISM, AND BOTH RUST GATES PASS ON IT.**

**THIS PARSES RUST WITH `syn`. THE VERSION THAT SCANNED IT AS TEXT WAS DEFEATED BY ORDINARY RUST FOUR TIMES ACROSS THREE REVIEW ROUNDS, AND EVERY ONE OF THOSE WAS A SILENT PASS.** In order: a qualified `std::option::Option<u64>` read as not-an-`Option`; two `ts(...)` groups on one line, of which only the first was read; an anchor sitting inside an attribute opened on an earlier line, which made a `serde(... = "crate::de::opt")` continuation split on its `::` into a fabricated field name and type; and a comment lexer that took the `'"'` char literal — which really appears in `redextape-core`'s tests — for an open string.

**THIS WALK SKIPS NOTHING, AND THAT IS WHAT THREE ROUNDS OF GUARDING A SKIP WERE ACTUALLY FOR.** Both walks in this module used to exclude the caller's gate file whole, because that file quotes `ts(type = ...)` inside its own assertion messages.

measured before the exclusion was removed rather than after. The exclusion predated the parser and outlived its reason by three review rounds, each of which found a way past the guard protecting it: a `pub(crate) struct` past two line prefixes, a `macro_rules!` body past a parse, and `#[path = "../../elsewhere.rs"] mod m;` past a parse plus a text scan plus an item-macro refusal. **Removing the skip retires that whole class instead of refusing its members one at a time**, including the members nobody has found yet.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `fn resolve_item_name(path: &Path, lines: &[&str], marker: usize) -> String {`

is exactly Finding 1's failure mode one layer down:

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `assert_scanner_file_declares_no_types(&path);`

It used to be shared with `assert_overrides_match_field_nullability`'s walk; that walk excludes nothing as of this branch, so this exclusion and its guard are now this scan's alone.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `pub fn ts_deriving_type_names_in_crate(crate_root: &Path, scanner_path: &Path) -> BTreeSet`

stated plainly because four review rounds each compiled a counterexample past the previous wording of this claim.

AND THAT INVERSION IS THE FIX FOR ALL FOUR PRIOR ROUNDS AT ONCE, NOT A FIFTH WIDENING.** Every earlier version of this function asked "does this line avoid the spellings I have banned so far", and each round's answer was a new spelling that had not been banned yet: keying on the substring `ts(export)` missed `ts(rename = "Foo", export)`; keying on `derive(ts_rs::TS)` missed `derive(Default, ts_rs::TS)`; banning `use ts_rs::` (colon-qualified) missed `use ts_rs::TS;` then bare `derive(TS)`, which carries the derive with the path `ts_rs::TS` never appearing on that line at all; and banning that still missed `use ts_rs as tsrs;` then `derive(tsrs::TS)` — a crate alias, which puts `tsrs::TS` on the derive line, not `ts_rs::TS`, so a check for that path never even looked at the line that mattered. Four rounds, four spellings, because a blacklist can only ever enumerate the spellings someone has already thought of, and there is always one more — this function's own history is the proof.

**`src/`-ONLY WAS ITSELF ONE MORE GAP OF EXACTLY THIS SHAPE, FOUND BY THE WHOLE-BRANCH REVIEW PAST THE VERSION THAT SCANNED ONLY `src/`.**

Both tests in `redextape-core`'s gate file passed at the time, and `web/bindings/Sneaky.ts` was really written carrying `bigint`. Widening the walk to the whole crate (below) closes exactly this route

FOUND BY THE WHOLE-BRANCH REVIEW PAST THE VERSION THAT WALKED THE WHOLE CRATE.**

Four widenings have each bought one more round before the next `#[path]` moved the boundary again; a fifth walk starting one directory higher is defeated by the same construction moved one directory higher still, forever.

`cargo test -p redextape-core --features ts --lib export_bindings -- --list` reads `12 tests, 0 benchmarks` on `redextape-core`'s clean tree today and 13 under every construction above (the crate-alias, the `src/`-only gap, and this `#[path]`-outside-the-root gap alike) — the unfiltered `-- --list` reads the crate's WHOLE test count instead, 707 today, a figure this comment does not track and the wrong one to quote here.

which is where those same sabotages were re-run against this function after it was moved into this crate, and all four still fired.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `let parsed = syn::parse_file(&own_src).unwrap_or_else(|e| {`

This used to be `if let Ok(parsed) = …`, so a gate file that did not parse left every flag false and re-blessed the whole-file skip in silence

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `fn check_meta(&mut self, meta: &syn::Meta) {`

**THROUGH `cfg_attr`, BECAUSE ONE OF THEM WALKED A REAL PROC MACRO PAST THIS.** `#[cfg_attr(all(), wasm_bindgen::prelude::wasm_bindgen)]` compiles, expands, and was measured leaving a gate file at `3 passed; 0 failed`

This is the identical class `ts_keys_under` in this same file records fixing for the key scan, left open here: fixing a class in one function and not in its neighbour is how this module keeps paying for the same lesson.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[derive(Default)]`

Three rounds of answering the first each shipped a hole: line prefixes missed `pub(crate)`; the parse that replaced them missed a type inside `declare_it! { … }`; and adding a text scan for the words missed `#[path = "../../elsewhere.rs"] mod m;`, which spells nothing and was demonstrated writing a real binding with all three green.

**MODULE SCOPE IS THE WHOLE OF IT, AND A ROUND WAS SPENT ON POSITIONS THAT ARE NOT.** A previous round added checks for macros in statement, expression, `impl`, trait, `extern` and type position, on a review's report that one had declared a type and written a real binding. **That report was never independently verified and does not reproduce.**

Measured here: a canonically-derived type declared inside a `#[test] fn` in the real gate file yields no `export_bindings_*` and no `bindings/` directory at all.

It is deleted rather than extended. **A subagent's finding is a claim to check, not a result**, and this file now carries the cost of having taken one on trust.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `fn assert_scanner_file_declares_no_types(path: &Path) {`

It used to be both. The nullability rule stopped needing the skip the moment it started parsing rather than scanning, and dropping it there deleted every route past this guard for that walk at once

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `const NULLABILITY_KEYS: [&str; 3] = ["type", "as", "optional"];`

AND IT WAS NEITHER CHECKED NOR NAMED UNTIL THE SECOND WHOLE-BRANCH REVIEW READ THE VENDORED MACRO CRATE.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

The scanning logic below took four revisions plus three more in review, every one of them defeated within minutes by an ordinary spelling of the same attribute — a history recorded in full on `ts_deriving_type_names_in_crate`.

a silent `continue` on an unrecognized line is precisely the defect an earlier revision shipped.

## `crates/redextape-cli/src/emit.rs`, above `#[test]`

The shipped message named every refusal and then explained the ceiling regardless of which one it was — true only of `TOO_MANY_STATES` — so a left-end collision or an uncovered alphabet sent a reader to look at a state count.

the whole-branch review found the fix above had swept `Refused` and left this sibling blaming the step ceiling for a measuring run that never reached it.

## `crates/redextape-cli/src/emit.rs`, above `Err(redextape_core::tm::TmRun::LowerError(e)) => {`

It read "cannot build a self-describing machine … a header needs the initial tapes" until the whole-branch review — one condition in two voices, and the wrong voice here: nothing was built, so header construction is not what went wrong. That sentence now survives only where the subject genuinely is a header that could not be assembled.

## `crates/redextape-cli/tests/config_cli.rs`, above `#[test]`

Plan 6's first half found eleven mutations surviving a full suite, four of them because their tests asserted a diagnostic's count and span and never its message.

## `crates/redextape-grammar-check/tests/differential.rs`, above `let err = compare("let x = @@@;").expect_err("the comparison must reject un-lexable input"`

, the same gap `the_lambda_comparison_can_fail` was found to have left open on this branch.

## `crates/redextape-lsp-wasm/src/lib.rs`, above `#[test]`

**THE REFERENCE ARM HAD ZERO COVERAGE.** `hover::asm`'s `Role::Reference` branch (`"A jump or call target."`) was never exercised anywhere in the tree — Task 5's fixtures only ever hovered a label DEFINITION (`f:`). A bug that swapped the two arms' messages would have passed every existing test.

## `crates/redextape-lsp/src/language.rs`, above `let src = "let x = 42;\nx\n";`

Task 1 could not write this: with all three of `hover::rxt`, `hover::tm` and `hover::asm` returning `None` unconditionally, a `Language::hover` match with `Redextape` and `Tm` swapped was byte-identical to a correct one — there was no input for which the two disagreed.

## `crates/redextape-lsp/src/lib.rs`, above `for (uri, line, character, own_content) in`

which is why the old null-answering version of this test sat there instead

UNCHANGED from the position this test used when `.asm` was a stub, now answering `ret`'s hover row instead of `null`.

## `crates/redextape-lsp/src/outline.rs`, above `assert!(`

Measured on this branch: the deepest corpus file is `run_nested_scopes.in/p.rxt` at depth 3; the floor sits under that

## `crates/redextape-lsp/src/outline.rs`, above `assert!(nodes_built >= 15, "expected the corpus to build outline nodes, got {nodes_built}"`

Measured on this branch: 20 outline nodes built across the corpus, 8 of them from the one fixture that nests (`run_nested_scopes.in/p.rxt`); the floor is raised from the previous 10 to sit above the 12 the corpus built before that fixture existed, so losing that fixture fails this assertion where the old floor of 10 would not have. It is not exclusive to it — removing six of the eleven flat contributing fixtures also drops below 15 — but it is slack measured against the corpus rather than an arbitrary round number.

## `crates/redextape-lsp/src/outline.rs`, above `assert!(files.len() >= 20, "expected the tree's .rxt fixtures, found {}", files.len());`

Measured on this branch: 10 of the 22 fixtures parse but contribute zero outline-eligible definitions

## `crates/redextape-lsp/src/outline.rs`, above `let root = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));`

Measured on this branch: 22 `.rxt` files,

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[test]`

and a rule guessing at it would be the thing this branch spent three review rounds learning not to write. Found while correcting a fixture in this very module that had put the attribute on the variant by mistake and passed vacuously because of it.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[test]`

Both of these were `true` before the arrow guard landed and `false` after

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[test]`

the one spelling the old rule accepted.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[test]`

The false-red half of the same defect: no `::` on the continuation line, so the old resolver panicked on legal source instead of fabricating a field.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[test]`

SILENT PASS, found by the whole-branch review building the fixture and running it.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `let mut quote: Option<char> = None;`

AND THIS WAS A REGRESSION THE ARROW GUARD INTRODUCED.

once a depth-zero `=>` began ENDING the scan rather than merely being skipped, a quoted arrow terminated it before the `null` member was ever reached. Both returned true before that change and false after:

## `crates/redextape-lsp-wasm/src/lib.rs`, above `#[test]`

The part 3 design said the server produced an empty edit list and it does not; this test is what found that, and `lsp-client.ts` treats a `null` result and an empty array as the same answer because of it.

## `crates/redextape-lsp-wasm/src/lib.rs`, above `#[test]`

It cost the part 3 design a whole round of wrong measurements before the spec was written.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[test]`

HIGH, seventh review: this got a type past ALL THREE layers of the previous guard and wrote a real binding with every gate green.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[test]`

CRITICAL REGRESSION, sixth review: replacing the line-prefix guard with a parse traded a `pub(crate)` hole for a `macro_rules!` one.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[test]`

The fifth review appended a `pub(crate) struct` carrying the canonical derive and a bad override to a gate file and got every gate silent with a binding really generated — through a guard matching two prefixes.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[test]`

SILENT PASS, second review: the `as` arm kept its own `starts_with("Option<")` one line below the fix that removed the same test from the field side.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[test]`

SILENT PASSES, fifth review — four containers the hand-written descent did not reach, all ordinary Rust.

## `crates/redextape-test-support/src/ts_derive_scan.rs`, above `#[test]`

**THE LAYER THIS REPLACES WAS DELETED, AND THIS PINS WHY.** A round added checks for macros in statement, expression, `impl`, trait, `extern` and type position on a report that one had declared a type and written a binding.

## `crates/redextape-grammar-check/src/asm.rs`, above `pub const FIXED_CORPUS: &[&str] = &[`

measured, `DEMOS` plus the closure reaches 20 of 24 mnemonics and this list reaches all 24 (`the_fixed_corpus_reaches_every_mnemonic`).

## `crates/redextape-grammar-check/src/tm.rs`, above `#[must_use]`

**roughly 700 MB at the 700-725 bytes per state `examples/state_cost_probe.rs` measures**

## `crates/redextape-grammar-check/tests/asm.rs`, above `#[test]`

One printed asm listing averages 146 bytes and 36 spans against λ's 912/637 and TM's 18,905/6,865. Both asm figures are FLOORS of a measured 256-case total rather than figures a total can be derived from, so multiplying either out undercounts. The measured span total is roughly 9,000 and moves with the seed

**Reproducible on demand**: this is what `arb_expr_over` at this leaf range, through `printed_program`, actually produces at 256 cases

## `crates/redextape-grammar-check/tests/tm.rs`, above `#[test]`

together the two took over a second in a debug build, timed alone

## `crates/redextape-grammar-check/tests/tm.rs`, above `#[test]`

**AT 32 THIS LEG COMPARES 282,006 SPANS IN 0.74 s**, measured, which is already 1.7x what λ's 256-case leg compares (163K)

Raising it is affordable and was deliberately not done

## `crates/redextape-lsp/src/outline.rs`, above `fn assert_definitions_match_tree(nav: &NameIndex, src: &str, ctx: &str) {`

Carrying the parent's `selection_range` alongside its name — via `flatten_with_parent_span` rather than `flatten` — tells the two `f`s apart and reddens on that same sabotage.

## `grammars/tree-sitter-redextape/grammar.js`, above `module.exports = grammar({`

NO KNOWN DIVERGENCE FROM THE REAL PARSER, and an earlier draft of this file had one. That draft excluded braced blocks from callee, receiver and condition position — `_expression_except_block`, the device Rust's own tree-sitter grammar uses — assuming `while n > 0 { .. }` would otherwise be ambiguous. It is not: the generated parser resolves all three positions with no declared conflict. The exclusion was REJECTING INPUT THE REAL PARSER ACCEPTS: `parse_postfix` runs its call and method postfixes on any atom `parse_atom` produced, blocks included, so `{ f }(1)`, `{ f }.m(1)` and `while { a } { b }` are all legal and all came back as ERROR nodes. In an editor that shows a valid file as an error region, and nothing in CI would have caught it — the differential refuses a source that produces ERROR nodes rather than comparing it.

## `grammars/tree-sitter-redextape/grammar.js`, above `extras: $ => [/[\t\n\f\r ]/, $.comment],`

It was `/\s/`, which is nearly right and diverges on ONE code point, U+000B VERTICAL TAB: `/\s/` accepts it and the lexer's `is_ascii_whitespace()` rejects it, so the grammar parsed a file the front end refuses.

## `grammars/tree-sitter-redextape-tm/grammar.js`, above `reduced: $ => seq('reduced', $._stage, repeat(seq(',', $._stage))),`

MEASURED: each form regenerated, `ts_lex_keywords` read out of `src/parser.c`, and `reduced fold, single-tape 5` parsed.

```text
  token('fold')     extracted, as `anon_sym_fold`        ERROR
  token(/fold/)     extracted, as `aux_sym_fold_token1`  ERROR
  token(/fold\r?/)  NOT extracted                        parses
```

Extraction tracks the outcome across all three. A regex token is extracted under a generated `aux_sym_*` name, which is why `/fold/` reads as absent to a grep for `anon_sym_fold`

BEING ALL LETTERS NEITHER CAUSES NOR PREVENTS EXTRACTION, which this comment also once claimed: the keyword lexer here holds `head_move`, which is `/[LRS]/`, and omits the all-letter `version`, `encoding` and `result`, all three of which main's holds.

## `grammars/tree-sitter-redextape-asm/grammar.js`, above `const NULLARY = ['ret', 'halt'];`

This was probed against `.tools/tree-sitter` 0.25.10 before it was written: a minimal grammar without the aliases parsed `add:` as `(ERROR [0, 0] - [0, 4])` while `foo:` parsed clean; with the aliases, `add:`, `halt:` and `foo:` all parsed as `(label name: (identifier))` and `add r0, r1` still parsed as an instruction.
