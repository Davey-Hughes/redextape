#![cfg_attr(test, allow(clippy::pedantic))]

//! The authority `web/tests/browser/grammar-differential.test.ts` compares against.
//!
//! **THIS CRATE CANNOT RUN IN A BROWSER**, which is why the comparison goes through a file. `build.rs`
//! compiles four generated `parser.c` into this crate through `cc`, so there is no wasm build of it and
//! no `Language::load`. Emitting what it computes and having the browser recompute the same thing from
//! the committed `.wasm` is what turns "the two agree" into something a test can hold. What that then
//! catches is the set of things only the artefact can break: a grammar ABI that moved, a bumped
//! tree-sitter CLI, or a committed `.wasm` that has stopped matching its own `grammar.js`.
//!
//! **OFFSETS ARE UTF-16 CODE UNITS, NOT BYTES.** `Span` is bytes here and tree-sitter hands the browser
//! UTF-16, so one side must convert and it is this one — the browser side is what this test exists to
//! check, and a conversion there would be a second thing that could be wrong. The λ fixture carries a
//! `λ`, which is the only reason the choice is observable at all: over pure ASCII the two units agree
//! and a comparison between them proves nothing about either.
//!
//! **THE GOLDEN IS VERIFIED HERE, NOT ONLY WRITTEN.** `REDEXTAPE_WRITE_GOLDEN=1` writes it; anything
//! else compares against it and fails. CI sets nothing, so a stale fixture reddens there instead of
//! being silently rewritten — a file a test only ever writes is not a gate, it is an output.
//!
//! **THE COLLAPSE IS `Grammar::captures`'S AND THE BROWSER SIDE MATCHES IT — CONTINGENTLY, NOT
//! ABSOLUTELY.** That function keys captures by `(start_byte, end_byte)` into a `BTreeMap`, rejects two
//! captures on one range that disagree, and drains in offset order. A raw capture list is a different
//! sequence, and comparing one against this would be a reconciliation dressed as an equality.
//! `web/src/colour.ts`'s `colourSpans` collapses the same way, deliberately, and the browser test runs
//! that function rather than a second copy of the rule.
//!
//! **THE TWO COLLAPSES AGREE ONLY BECAUSE BOTH SIDES REFUSE THE ONE CASE WHERE THEY COULD DIVERGE.**
//! This crate walks `cursor.matches()`; `colourSpans` walks `query.captures()`. Both then take
//! last-wins into a map, which is order-dependent, and nothing guarantees those two cursor APIs visit
//! several captures on one range in the same order. That is unobservable today only because neither
//! side lets the collapse resolve a disagreement: this crate errors when two captures on one range
//! disagree, and the browser test separately asserts there is none — over the raw captures, before
//! `colourSpans` ever runs — rather than trusting the collapse to settle it. Remove that refusal from
//! either side and the two could legitimately disagree about which capture wins.
//!
//! **ONE ARM OF THE COMPARISON EXISTS ON ONLY ONE SIDE.** This crate also errors when
//! `cursor.did_exceed_match_limit()` is true; the browser test never calls `didExceedMatchLimit()` at
//! all. Unreachable at tree-sitter's default match limit on either side today, so this is not a live
//! divergence — but the Rust arm has no counterpart keeping it that way if the default ever changes.
//!
//! **THE FOUR LANGUAGES ARE KEPT APART AND THAT IS LOAD-BEARING.** The four capture tables in
//! `capture_map.rs` disagree by design on `@function`, `@variable.parameter` and `@label.reference`, so
//! a fixture set or a comparison that merged languages would hide exactly the defect the per-language
//! tables exist to prevent. `each_language_carries_a_class_no_other_one_does` is the guard.

use redextape_core::analysis::{TokenClass, token_class_names};
use redextape_core::tm::EncodingKind;
use redextape_grammar_check::{ASM, Grammar, LAMBDA, MINI, TM, asm, lambda, mini, tm};

/// The golden, relative to this crate rather than to whatever directory the test was run from.
const GOLDEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../grammars/capture-golden.json");

/// Set this to `1` to rewrite the golden. CI does not set it, which is the whole gate.
const WRITE: &str = "REDEXTAPE_WRITE_GOLDEN";

/// The mini-language program three of the five fixtures are a lowering of.
///
/// **SMALL ON PURPOSE, AND `3` RATHER THAN `21` FOR ONE CONCRETE REASON**: `printed_term` prints a
/// numeral in Church form, so the λ fixture's length is linear in the literal. It carries a comment, a
/// `fn` with a parameter, an operator and a call, which between them reach `@comment`, `@keyword`,
/// `@function`, `@variable.parameter`, `@operator`, `@number`, `@function.call` and both punctuation
/// captures.
const PROGRAM: &str = "// doubles\nfn double(n) { n * 2 }\ndouble(3)\n";

/// A second mini-language fixture, existing only to reach `TokenClass::Bool`.
///
/// **`PROGRAM` ABOVE NEVER PRODUCES ONE.** It has no `true`/`false`, and none of the three printers
/// lowers to a `Bool`-classified token either, so `("boolean", TokenClass::Bool)` in
/// `capture_map::REDEXTAPE` crossed to the browser in no test until this fixture existed — the one row
/// of the mini-language's table this differential never exercised. A single literal reaches it, so
/// this stays one line rather than growing `PROGRAM` itself or joining the three lowered fixtures
/// below at the size those already carry.
const BOOL_PROGRAM: &str = "true\n";

/// The program the TM fixture is a lowering of, and it is not `PROGRAM`.
///
/// **THE TM FORM IS THE ONE WHERE FIXTURE SIZE IS DECIDED BY THE LOWERING RATHER THAN BY THE SOURCE.**
/// `PROGRAM` lowers to 46,715 bytes of machine — measured, `redextape emit <PROGRAM> --lang tm | wc -c`
/// — every state of it real and none of it reviewable in a golden. `1` is the smallest program this
/// pipeline has: 10 states and 13 rule lines over 1,158 code units, and still a full header, which is
/// what keeps `@comment`, `@variable` and `@type` reachable at all (design §6.3: those three are
/// unreachable from a header-less machine).
const TM_PROGRAM: &str = "1";

/// One fixture: the grammar that computes its spans, the `languageId` that keys it in the golden, a
/// name a failure can print, and the text itself.
///
/// **THE TEXT IS PRODUCED BY A PRINTER, NOT TYPED HERE** — except the mini-language's, whose authority
/// `classify_source` is a function FROM TEXT, so authored source is what it is meant to read. For the
/// other three the only authority is a printer that emits text and spans together, so a hand-typed
/// fixture would be text nothing in this project can classify.
struct Fixture {
    language_id: &'static str,
    name: &'static str,
    grammar: &'static Grammar,
    src: String,
}

/// One fixture's computed answer: the same shape the golden stores, already in UTF-16 code units.
struct Computed {
    language_id: &'static str,
    name: &'static str,
    src: String,
    spans: Vec<(usize, usize, &'static str)>,
}

/// The five fixtures: one per language, and a second mini-language one for `Bool`.
///
/// Panics rather than returning `Result` because a printer that stops lowering `PROGRAM` is a defect in
/// the pipeline, not a fixture this test should skip. `clippy.toml` exempts panics inside `#[test]` fns
/// only, so the allow is here rather than at file level.
#[allow(clippy::expect_used)]
fn fixtures() -> Vec<Fixture> {
    let (lambda_text, _) = lambda::printed_term(PROGRAM).expect("the λ printer must lower PROGRAM");
    let (asm_text, _) = asm::printed_program_with_header(PROGRAM).expect("the asm printer must lower PROGRAM");
    let (tm_text, _) =
        tm::printed_machine_with_header(TM_PROGRAM, EncodingKind::Unary).expect("the TM printer must lower TM_PROGRAM");
    vec![
        Fixture {
            language_id: "redextape",
            name: "a commented function and its call",
            grammar: &MINI,
            src: PROGRAM.to_string(),
        },
        Fixture { language_id: "redextape", name: "a boolean literal", grammar: &MINI, src: BOOL_PROGRAM.to_string() },
        Fixture {
            language_id: "redextape_lambda",
            name: "that program, lowered to λ",
            grammar: &LAMBDA,
            src: lambda_text,
        },
        Fixture {
            language_id: "redextape_tm",
            name: "the numeral 1, lowered to a headered machine",
            grammar: &TM,
            src: tm_text,
        },
        Fixture {
            language_id: "redextape_asm",
            name: "that program, lowered to a headered listing",
            grammar: &ASM,
            src: asm_text,
        },
    ]
}

/// Byte offset to UTF-16 code-unit offset, for every char boundary of `src` plus its end.
///
/// A `None` entry is a byte that is not a boundary. Nothing tree-sitter returns should land on one —
/// it advances by codepoint — but a conversion that silently guessed would be a second thing this test
/// could be wrong about, so a non-boundary offset is reported instead.
fn utf16_index(src: &str) -> Vec<Option<usize>> {
    let mut map = vec![None; src.len() + 1];
    let mut units = 0usize;
    for (byte, ch) in src.char_indices() {
        map[byte] = Some(units);
        units += ch.len_utf16();
    }
    map[src.len()] = Some(units);
    map
}

/// `TokenClass`'s name as the wire spells it — the same string `web/src/types.ts`'s union holds,
/// because both come from this one list.
fn class_name(c: TokenClass) -> &'static str {
    token_class_names()[c as usize]
}

/// Every fixture's captures, collapsed by `Grammar::captures` and converted to UTF-16 code units.
///
/// # Errors
///
/// Whatever `captures` reports, a span endpoint that is not a char boundary, or an EMPTY span — see
/// below for why that last one is an error here rather than a value to write.
fn computed() -> Result<Vec<Computed>, String> {
    let mut out = Vec::new();
    for f in fixtures() {
        let map = utf16_index(&f.src);
        let mut spans = Vec::new();
        for (s, class) in f.grammar.captures(&f.src)? {
            let at = |byte: usize| {
                map.get(byte).copied().flatten().ok_or_else(|| {
                    format!("{}: `{}`: byte {byte} is not a character boundary of the fixture", f.language_id, f.name)
                })
            };
            let (start, end) = (at(s.start)?, at(s.end)?);
            // **AN EMPTY SPAN CANNOT CROSS TO THE BROWSER AND MUST NOT BE WRITTEN AS IF IT COULD.**
            // `captures_with` keeps a zero-width range; `colourSpans` skips one, because an empty
            // decoration is not a range CodeMirror accepts. The two therefore disagree on such a span
            // by construction, and a golden carrying one could never compare equal however correct
            // both sides were. The shipped queries capture leaves of a cleanly-parsing file, so none
            // occurs; this says so loudly rather than leaving the browser to report a length mismatch
            // with no cause attached.
            if start >= end {
                return Err(format!(
                    "{}: `{}`: a zero-width capture at {start} ({class:?}); the browser's `colourSpans` skips one and this side keeps it, so no golden carrying one can compare equal",
                    f.language_id, f.name
                ));
            }
            spans.push((start, end, class_name(class)));
        }
        out.push(Computed { language_id: f.language_id, name: f.name, src: f.src, spans });
    }
    Ok(out)
}

/// `s` as a JSON string literal.
fn quoted(s: &str) -> Result<String, String> {
    serde_json::to_string(s).map_err(|e| format!("{GOLDEN}: could not encode {s:?} as JSON: {e}"))
}

/// The golden's text: one span per line, languages in fixture order.
///
/// Hand-rolled rather than `serde_json::to_string_pretty`, and the line shape is the reason. Pretty
/// printing expands a `[start, end, "Class"]` triple onto five lines, which would turn the 554 spans
/// this emits into thousands of lines of golden that no reviewer reads. One line per span is what makes
/// a diff of this file say which spans moved.
fn render(computed: &[Computed]) -> Result<String, String> {
    let mut languages: Vec<&'static str> = Vec::new();
    for c in computed {
        if !languages.contains(&c.language_id) {
            languages.push(c.language_id);
        }
    }
    let mut out = String::from("{\n");
    for (li, language) in languages.iter().enumerate() {
        out.push_str(&format!("  {}: {{\n", quoted(language)?));
        let group: Vec<&Computed> = computed.iter().filter(|c| c.language_id == *language).collect();
        for (fi, f) in group.iter().enumerate() {
            out.push_str(&format!("    {}: {{\n", quoted(f.name)?));
            out.push_str(&format!("      \"src\": {},\n", quoted(&f.src)?));
            out.push_str("      \"spans\": [\n");
            for (si, (start, end, class)) in f.spans.iter().enumerate() {
                let tail = if si + 1 == f.spans.len() { "" } else { "," };
                out.push_str(&format!("        [{start}, {end}, {}]{tail}\n", quoted(class)?));
            }
            out.push_str("      ]\n");
            out.push_str(if fi + 1 == group.len() { "    }\n" } else { "    },\n" });
        }
        out.push_str(if li + 1 == languages.len() { "  }\n" } else { "  },\n" });
    }
    out.push_str("}\n");
    Ok(out)
}

/// One golden span as `(start, end, class)`, or a message saying what it was instead.
fn triple(v: &serde_json::Value, language: &str, name: &str, i: usize) -> Result<(usize, usize, String), String> {
    let bad = || format!("{language}: `{name}`: span {i} is {v}, not a `[start, end, \"Class\"]` triple");
    let a = v.as_array().ok_or_else(bad)?;
    if a.len() != 3 {
        return Err(bad());
    }
    let n = |k: usize| -> Result<usize, String> {
        usize::try_from(a.get(k).and_then(serde_json::Value::as_u64).ok_or_else(bad)?).map_err(|_| bad())
    };
    let class = a.get(2).and_then(serde_json::Value::as_str).ok_or_else(bad)?;
    Ok((n(0)?, n(1)?, class.to_string()))
}

/// Hold the committed golden to what this crate computes now.
///
/// # Errors
///
/// A message naming the language and the fixture in every case, and the span index and both offsets
/// whenever a span is what differs.
fn verify(text: &str, computed: &[Computed]) -> Result<(), String> {
    let doc: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("{GOLDEN} is not JSON: {e}; re-run with {WRITE}=1"))?;
    let top = doc.as_object().ok_or_else(|| format!("{GOLDEN}: the top level is not an object"))?;
    for c in computed {
        let language = top
            .get(c.language_id)
            .ok_or_else(|| format!("{GOLDEN}: no entry for `{}`; re-run with {WRITE}=1", c.language_id))?;
        let fixture = language
            .get(c.name)
            .ok_or_else(|| format!("{GOLDEN}: {}: no fixture `{}`; re-run with {WRITE}=1", c.language_id, c.name))?;
        let src = fixture
            .get("src")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("{GOLDEN}: {}: `{}` has no `src` string", c.language_id, c.name))?;
        if src != c.src {
            return Err(format!(
                "{}: `{}`: the golden's text is not what the printer produces now.\n  golden:  {src:?}\n  printer: {:?}\nre-run with {WRITE}=1",
                c.language_id, c.name, c.src
            ));
        }
        let spans = fixture
            .get("spans")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| format!("{GOLDEN}: {}: `{}` has no `spans` array", c.language_id, c.name))?;
        for (i, (start, end, class)) in c.spans.iter().enumerate() {
            let Some(v) = spans.get(i) else {
                return Err(format!(
                    "{}: `{}`: the golden has {} span(s), this crate computes {}; the first missing one is {class} at {start}..{end}",
                    c.language_id,
                    c.name,
                    spans.len(),
                    c.spans.len()
                ));
            };
            let got = triple(v, c.language_id, c.name, i)?;
            if got != (*start, *end, (*class).to_string()) {
                return Err(format!(
                    "{}: `{}`: at span {i}: the golden says {} at {}..{}, this crate computes {class} at {start}..{end}",
                    c.language_id, c.name, got.2, got.0, got.1
                ));
            }
        }
        if spans.len() > c.spans.len() {
            let extra = triple(&spans[c.spans.len()], c.language_id, c.name, c.spans.len())?;
            return Err(format!(
                "{}: `{}`: the golden has {} span(s), this crate computes {}; the first extra one is {} at {}..{}",
                c.language_id,
                c.name,
                spans.len(),
                c.spans.len(),
                extra.2,
                extra.0,
                extra.1
            ));
        }
    }
    // A LANGUAGE OR FIXTURE THE GOLDEN STILL CARRIES AND THIS CRATE NO LONGER COMPUTES is a leftover,
    // and the browser side iterates the FILE — so it would keep checking it against a grammar nothing
    // here holds to anything.
    for (language, fixtures) in top {
        let names: Vec<&str> = computed.iter().filter(|c| c.language_id == language).map(|c| c.name).collect();
        if names.is_empty() {
            return Err(format!(
                "{GOLDEN}: `{language}` is in the golden and no fixture computes it; re-run with {WRITE}=1"
            ));
        }
        let object =
            fixtures.as_object().ok_or_else(|| format!("{GOLDEN}: `{language}` is not an object of fixtures"))?;
        for name in object.keys() {
            if !names.contains(&name.as_str()) {
                return Err(format!(
                    "{GOLDEN}: {language}: `{name}` is in the golden and no fixture computes it; re-run with {WRITE}=1"
                ));
            }
        }
    }
    Ok(())
}

/// The golden is what this crate computes — or, under `REDEXTAPE_WRITE_GOLDEN=1`, becomes it.
///
/// **THE WRITE IS FOLLOWED BY THE SAME VERIFY, DELIBERATELY.** A writer that agreed with itself by
/// never reading what it wrote would pass while emitting a file the reader cannot parse, and the
/// reader is the half that runs on CI.
#[test]
fn the_golden_matches_this_crates_captures() {
    let computed = computed().unwrap_or_else(|why| panic!("{why}"));
    if std::env::var(WRITE).is_ok_and(|v| v == "1") {
        let text = render(&computed).unwrap_or_else(|why| panic!("{why}"));
        std::fs::write(GOLDEN, &text).unwrap_or_else(|e| panic!("could not write {GOLDEN}: {e}"));
    }
    let text = std::fs::read_to_string(GOLDEN).unwrap_or_else(|e| {
        panic!(
            "could not read {GOLDEN}: {e}; write it with {WRITE}=1 cargo test -p redextape-grammar-check --test golden"
        )
    });
    if let Err(why) = verify(&text, &computed) {
        panic!("{why}");
    }
}

/// The spans the golden carries are the ones the hand-written front end would put there too.
///
/// **WITHOUT THIS THE GOLDEN WOULD BE "WHATEVER TREE-SITTER SAID", AND THE BROWSER WOULD BE HELD TO
/// THAT.** These five fixtures are in no corpus — they are printed here — so no other test in this
/// crate compares them against an authority. `compare_printed` and `compare` are the same functions the
/// existing differential uses, run over the same text the golden stores.
#[test]
fn every_fixture_agrees_with_its_own_authority() {
    if let Err(why) = mini::compare(PROGRAM) {
        panic!("the mini-language fixture diverges from classify_source:\n{why}");
    }
    if let Err(why) = mini::compare(BOOL_PROGRAM) {
        panic!("the boolean-literal fixture diverges from classify_source:\n{why}");
    }
    let (text, want) = lambda::printed_term(PROGRAM).expect("the λ printer must lower PROGRAM");
    if let Err(why) = lambda::compare_printed(&text, &want) {
        panic!("the λ fixture diverges from print_lambda_mapped:\n{why}");
    }
    let (text, want) =
        tm::printed_machine_with_header(TM_PROGRAM, EncodingKind::Unary).expect("the TM printer must lower TM_PROGRAM");
    if let Err(why) = tm::compare_printed(&text, &want) {
        panic!("the TM fixture diverges from print_tm_with_mapped:\n{why}");
    }
    let (text, want) = asm::printed_program_with_header(PROGRAM).expect("the asm printer must lower PROGRAM");
    if let Err(why) = asm::compare_printed(&text, &want) {
        panic!("the asm fixture diverges from print_asm_with_mapped:\n{why}");
    }
}

/// Each language's fixture carries a class none of the other three produce.
///
/// **THE FOUR TABLES DISAGREE ON `@function`, `@variable.parameter` AND `@label.reference`, AND A
/// COMPARISON THAT MERGED LANGUAGES WOULD HIDE EXACTLY THAT.** Two of the four witnesses below are
/// produced by one capture name and nothing else: `Mnemonic` only by asm's `@function` — the mini
/// language's `@function` is an `Ident` — and `StateName` only by TM's `@label.reference`, where asm's
/// is a `Label`. `Binder` is λ's `@keyword.function`/`@variable.parameter` pair, whose
/// `@variable.parameter` is an `Ident` in the mini-language. `Operator` is the mini-language's, and it
/// is exclusive because neither TM's table nor asm's has an `@operator` row at all.
///
/// **THE MINI-LANGUAGE HAS TWO FIXTURES, AND `Operator` NEED ONLY LIVE ON ONE OF THEM.** The
/// boolean-literal fixture added for `Bool` coverage carries no `@operator` capture, so the check below
/// asks whether ANY of a language's fixtures carries its witness — not every one — while still asking
/// whether NONE of the other three languages' fixtures do, whichever of theirs is checked.
///
/// So this fails if a fixture is coloured by the wrong grammar, if two tables are merged, or if a
/// language's fixtures are all replaced by ones that no longer reach its own disagreement.
#[test]
fn each_language_carries_a_class_no_other_one_does() {
    let computed = computed().unwrap_or_else(|why| panic!("{why}"));
    let witnesses = [
        ("redextape", "Operator"),
        ("redextape_lambda", "Binder"),
        ("redextape_tm", "StateName"),
        ("redextape_asm", "Mnemonic"),
    ];
    for (language, witness) in witnesses {
        let mut any_carries = false;
        for c in &computed {
            let carries = c.spans.iter().any(|(_, _, class)| *class == witness);
            if c.language_id == language {
                any_carries |= carries;
            } else {
                assert!(
                    !carries,
                    "{}: the fixture `{}` produces a {witness} span, which only {language} should: the tables or the grammars have been crossed",
                    c.language_id, c.name
                );
            }
        }
        assert!(any_carries, "{language}: no fixture produces a {witness} span");
    }
}
