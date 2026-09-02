//! The two round-trip properties of design §3.4, and the three asymmetries that are the reason there
//! are two rather than one.
//!
//! P1 is over TEXT: anything the printer wrote, the parser reads back to text identical byte for
//! byte. P2 is over PROGRAMS, and only over the ones `lower_asm` can produce — §3 explains why the
//! unrestricted property is false.

// Test target: a fixture that fails to parse IS the failure this file reports. The `allow-*-in-tests`
// keys in `clippy.toml` reach `#[test]` functions and `#[cfg(test)]` modules, not the free helpers
// below, so the exemption is stated per target — the same note `tests/common/mod.rs` carries.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use proptest::prelude::*;
use redextape_test_support::arb_expr_over;

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{AsmHeader, Instr, Program, lower_asm, parse_asm, parse_asm_full, print_asm, print_asm_with};
use redextape_core::ty::Ty;

/// The programs P1 is held over, chosen for `Instr`-variant coverage — which is what P1's evidence
/// base needs, and what the test below MEASURES rather than assumes.
///
/// **Inherited wholesale from `asm_oracle.rs`, then extended deliberately.** The first 11 entries are
/// a byte-for-byte copy, in order, of that file's `demos` array plus the first two `assert_asm_agrees`
/// calls in `asm_oracle_on_the_latent_trap_programs` — a corpus chosen for a different question
/// (backend agreement), reused here because it was already at hand. That inherited part reaches
/// whatever variants it happens to reach; nothing about its selection was coverage-driven. The
/// `tail(cons(7, nil))` entry is the deliberate part: added specifically to reach `Instr::Tail`, which
/// none of the inherited entries touch. There is no shared `const` between the two files, so the two
/// lists can drift — accepted, since they answer different questions and neither constrains the other.
const DEMOS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "let add1 = |x| x + 1; add1(41)",
    "head(cons(7, nil))",
    "is_empty(nil)",
    "[1, 2, 3]",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    "let mut x = 1; x = x + 1; let x = x + 10; x",
    "let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc",
    "tail(cons(7, nil))",
];

fn lower(src: &str) -> Program {
    let (ast, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
    let core = desugar(&ast.unwrap());
    lower_asm(&core).unwrap_or_else(|e| panic!("lowering failed for {src}: {e:?}"))
}

/// P1. The printer's output is the canonical form, and the parser is required to be its exact
/// inverse there — text in, same text out.
#[test]
fn printed_text_reads_back_to_identical_text() {
    for src in DEMOS {
        let text = print_asm(&lower(src));
        let (prog, ds) = parse_asm(&text);
        assert!(ds.is_empty(), "diagnostics reading back {src}: {ds:?}");
        assert_eq!(print_asm(&prog.expect("printer output parses")), text, "P1 failed for {src}");
    }
}

/// The demos are evidence only for the variants they reach. Measured rather than assumed, per design
/// §9 risk 2 — and the count is asserted so that a future change to `DEMOS` or to `lower_asm` which
/// drops coverage fails here instead of silently weakening P1.
///
/// Measured, not guessed: an earlier draft of this test predicted 13 of 16, naming `Box`, `BoxGet`
/// and `BoxSet` as the gap. Running it found 12 of 16 instead — `Tail` was also unreached, because
/// `DEMOS` exercised `head(cons(7, nil))` but no demo called `tail(...)`. Adding `tail(cons(7, nil))`
/// brought the measured count to 13 of 16, leaving `Box`, `BoxGet` and `BoxSet` as the remaining gap.
///
/// That remaining gap is not a fixture problem. `Box`/`BoxGet`/`BoxSet` are emitted only by `defunc`'s
/// mutable-capture boxing rewrite (a `let mut` captured by a closure used as a value), and this file's
/// `lower` helper calls `lower_asm` directly on `desugar`'s output — it never invokes `defunc`, which
/// only runs via `tm.rs`'s `lower_program`. So no string added to `DEMOS` can reach them; the gap is
/// structurally unreachable from this helper, not a matter of picking a better demo.
#[test]
fn the_demo_corpus_covers_thirteen_of_the_sixteen_instr_variants() {
    let mut seen: Vec<&'static str> = DEMOS.iter().flat_map(|src| lower(src).code).map(|i| variant_name(&i)).collect();
    seen.sort_unstable();
    seen.dedup();
    assert_eq!(
        seen.len(),
        13,
        "demo corpus reaches these variants: {seen:?}\n\
         If this number moved, say which variants moved and why in the roadmap entry — the corpus is \
         P1's entire evidence base."
    );
    // `Box`/`BoxGet`/`BoxSet`: structurally unreachable from this helper (see the doc comment above),
    // not a gap a better `DEMOS` string could close.
    for absent in ["Box", "BoxGet", "BoxSet"] {
        assert!(!seen.contains(&absent), "`{absent}` is now covered — update this test and the entry");
    }
}

fn variant_name(i: &Instr) -> &'static str {
    match i {
        Instr::Li(..) => "Li",
        Instr::Mov(..) => "Mov",
        Instr::Bin(..) => "Bin",
        Instr::Jz(..) => "Jz",
        Instr::Jmp(..) => "Jmp",
        Instr::Call(..) => "Call",
        Instr::Ret => "Ret",
        Instr::Halt => "Halt",
        Instr::Nil(..) => "Nil",
        Instr::Cons(..) => "Cons",
        Instr::Head(..) => "Head",
        Instr::Tail(..) => "Tail",
        Instr::IsEmpty(..) => "IsEmpty",
        Instr::Box(..) => "Box",
        Instr::BoxGet(..) => "BoxGet",
        Instr::BoxSet(..) => "BoxSet",
    }
}

/// P2's domain, stated as an assertion rather than as prose. Design §3.4 restricts the property to
/// programs that validate and whose labels are index-ordered; `lower_asm` gives both by
/// construction, and this is what checks that claim on every program the property runs over.
fn in_p2_domain(p: &Program) -> bool {
    p.validate().is_empty() && p.labels.windows(2).all(|w| w[0].1 <= w[1].1)
}

/// P2 over the demo corpus. Same programs as P1, opposite direction.
#[test]
fn lowered_programs_survive_print_then_parse() {
    for src in DEMOS {
        let prog = lower(src);
        assert!(in_p2_domain(&prog), "lower_asm produced a program outside P2's domain for {src}");
        let (back, ds) = parse_asm(&print_asm(&prog));
        assert!(ds.is_empty(), "diagnostics for {src}: {ds:?}");
        assert_eq!(back.expect("parses"), prog, "P2 failed for {src}");
    }
}

// The generator is `redextape_test_support::arb_expr_over`, NOT a local one. Its own doc records
// why: four independently-drifting copies of this shape once made a claim nothing enforced, and
// `asm_oracle.rs` still carries one of them. A fifth copy here would be that defect committed
// again, in the file whose subject is two descriptions of one form agreeing.
//
// No new `Arbitrary` for `Program` either: `lower_asm`'s image IS P2's domain, so generating source
// and lowering it produces exactly the programs the property is about, and `in_p2_domain` is what
// keeps that from being an untested claim.
//
// **What this generator reaches, and what it does not.** Its arms are `+`, `-` and three `if`
// shapes, so it exercises `Li`, `Mov`, `Bin`, `Jz`, `Jmp` and `Halt` broadly. It emits no list
// literal and no `fn`, so `Nil`, `Cons`, `Head`, `Tail`, `IsEmpty` and `Call` reach P2 only through
// the demo corpus above — and so does `Ret`, for the same reason: it too needs `fn`, which
// `arb_expr_over` never emits. `Box`, `BoxGet` and `BoxSet` are unreachable even there: they come
// only from `defunc`'s mutable-capture rewrite, and this file's `lower` helper calls `lower_asm`
// directly on `desugar`'s output without ever invoking `defunc` (see the doc comment on
// `the_demo_corpus_covers_thirteen_of_the_sixteen_instr_variants`). Breadth here, coverage there —
// stated so the split is a design rather than a gap someone finds later.
proptest! {
    #![proptest_config(ProptestConfig { cases: 200, ..ProptestConfig::default() })]

    #[test]
    fn p2_holds_on_random_first_order_programs(
        src in arb_expr_over((0u64..1500).prop_map(|n| n.to_string()))
    ) {
        let (ast, ds) = parse(&src);
        prop_assume!(ds.is_empty());
        let core = desugar(&ast.unwrap());
        // Unsupported/TooDeep: outside this property's scope.
        let Ok(prog) = lower_asm(&core) else { return Ok(()) };
        prop_assert!(in_p2_domain(&prog), "lower_asm produced a program outside P2's domain");
        let (back, ds) = parse_asm(&print_asm(&prog));
        prop_assert!(ds.is_empty(), "diagnostics: {:?}", ds);
        prop_assert_eq!(back.unwrap(), prog);
    }
}

// ---------------------------------------------------------------------------
// The three asymmetries. Each demonstrates the BOUNDARY of P2's domain — a program just outside it,
// and what the round trip does to it. They are the reason the property is restricted, so they are
// tested as facts rather than left as prose in the design.
// ---------------------------------------------------------------------------

/// §3.1. `print_asm` buckets labels into `code.len() + 1` slots and drops anything past that.
#[test]
fn a_label_past_the_end_is_dropped_by_the_printer() {
    let prog = Program { code: vec![Instr::Halt], labels: vec![("far".to_string(), 5)] };
    assert!(!prog.validate().is_empty(), "validate names it, which is how the loss stops being silent");
    let (back, ds) = parse_asm(&print_asm(&prog));
    assert!(ds.is_empty(), "the printed text is well-formed — that is the problem: {ds:?}");
    assert_eq!(back.expect("parses").labels, Vec::new(), "the label is gone, not relocated");
}

/// §3.2. Order across indices is normalized; order within one index is preserved.
#[test]
fn label_order_is_normalized_across_indices_and_kept_within_one() {
    let prog = Program {
        code: vec![Instr::Halt, Instr::Halt],
        labels: vec![("b".to_string(), 1), ("a2".to_string(), 0), ("a1".to_string(), 0)],
    };
    assert!(prog.validate().is_empty(), "this program is perfectly valid — only its Vec order differs");
    assert!(!in_p2_domain(&prog), "and it is outside P2's domain for exactly that reason");
    let (back, ds) = parse_asm(&print_asm(&prog));
    assert!(ds.is_empty(), "{ds:?}");
    assert_eq!(
        back.expect("parses").labels,
        vec![("a2".to_string(), 0), ("a1".to_string(), 0), ("b".to_string(), 1)],
        "sorted by index; `a2` still precedes `a1` because the printer keeps within-index order"
    );
}

/// §3.3, measured rather than assumed under this test's original name in
/// `2026-08-24-asm-reader.md` (`a_label_name_with_a_space_does_not_survive_the_trip`).
/// `validate()` does correctly reject this
/// name — whitespace is one of `label_name_representable`'s own separators — but that check is about
/// what a label may be USED as (a jump target, where an operand list splits on whitespace); it is not
/// what the *label-declaration* line actually enforces. `parse_asm`'s label arm strips a trailing `:`
/// and trims only leading/trailing whitespace; it never splits the interior on whitespace the way
/// `parse_instr`'s operand reader does. So the printed line `two words:` reads back as the identical
/// name, with no diagnostic — a third outcome, neither of the two this test was drafted to
/// distinguish (a parse error, or a different name coming back).
#[test]
fn a_label_name_with_an_embedded_space_silently_round_trips_despite_failing_validate() {
    let prog = Program { code: vec![Instr::Halt], labels: vec![("two words".to_string(), 0)] };
    assert!(!prog.validate().is_empty(), "validate rejects the name before anything prints it");
    let text = print_asm(&prog);
    assert_eq!(text, "two words:\n    halt\n", "the name is written unquoted, verbatim");
    let (back, ds) = parse_asm(&text);
    assert!(ds.is_empty(), "the label-declaration grammar does not tokenize on interior whitespace: {ds:?}");
    assert_eq!(
        back.expect("parses").labels,
        prog.labels,
        "the SAME name comes back — validate() is stricter here than the round trip actually requires"
    );
}

/// §3.3's worst case — the second of its two tests, after the correction — and the only one of the
/// four tests pinning the three asymmetries where the round trip loses an INSTRUCTION rather than a
/// label: a name that itself ENDS in `:`, used as a jump target. The printed operand line is
/// `    jmp\ttarget:` — which itself ends in `:` — so `parse_asm`'s
/// line-level label check reads the WHOLE LINE, mnemonic included, as a declaration of a label named
/// `jmp\ttarget`. Measured, not assumed: the genuine declaration of `target:` immediately below it is
/// ALSO read as a label line (`target::` strips back to `target:`), so nothing here raises a
/// diagnostic — the text is well-formed, just not what was meant. The round trip leaves two spurious
/// labels and zero jumps where there was one jump and one label; this is what `validate()` exists to
/// keep out of any program the project itself produces.
#[test]
fn a_label_name_ending_in_a_colon_used_as_an_operand_silently_drops_the_instruction() {
    let prog = Program {
        code: vec![Instr::Jmp("target:".to_string()), Instr::Halt],
        labels: vec![("target:".to_string(), 1)],
    };
    assert!(!prog.validate().is_empty(), "validate rejects the name before anything prints it");
    let text = print_asm(&prog);
    assert_eq!(text, "    jmp\ttarget:\ntarget::\n    halt\n", "the operand is written unquoted, verbatim");
    let (back, ds) = parse_asm(&text);
    assert!(ds.is_empty(), "no diagnostic — both lines parse as well-formed label declarations: {ds:?}");
    let back = back.expect("parses");
    assert_eq!(back.code, vec![Instr::Halt], "the jmp is gone, not merely mis-parsed");
    assert_eq!(
        back.labels,
        vec![("jmp\ttarget".to_string(), 0), ("target:".to_string(), 0)],
        "two spurious labels replace the one real label and the one real jump"
    );
}

// ---------------------------------------------------------------------------
// The headered form: design §5's optionality property, restated over `parse_asm_full` and
// `print_asm_with` rather than the bare printer/parser pair above.
// ---------------------------------------------------------------------------

/// P1 for the headered form: what `print_asm_with` writes reads back to identical text.
#[test]
fn headered_text_reads_back_to_identical_text() {
    for src in DEMOS {
        let prog = lower(src);
        let h = AsmHeader { result: Ty::Nat };
        let text = print_asm_with(&prog, &h);
        let (back, header, ds) = parse_asm_full(&text);
        assert!(ds.is_empty(), "diagnostics for {src}: {ds:?}");
        assert_eq!(header, Some(h.clone()), "the header survives for {src}");
        assert_eq!(print_asm_with(&back.expect("parses"), &h), text, "headered P1 failed for {src}");
    }
}

/// Every result type the header admits must survive the trip, not just the common one.
#[test]
fn every_admissible_result_type_round_trips() {
    let prog = lower("1 + 2");
    for ty in
        [Ty::Nat, Ty::Bool, Ty::Unit, Ty::List(Box::new(Ty::Nat)), Ty::List(Box::new(Ty::List(Box::new(Ty::Bool))))]
    {
        let h = AsmHeader { result: ty.clone() };
        let (_, header, ds) = parse_asm_full(&print_asm_with(&prog, &h));
        assert!(ds.is_empty(), "{ty:?}: {ds:?}");
        assert_eq!(header, Some(h), "{ty:?} did not survive");
    }
}

/// The optionality property design §5 rests on: the same bytes, read two ways, give the same program.
#[test]
fn a_header_changes_the_program_not_at_all() {
    for src in DEMOS {
        let prog = lower(src);
        let bare = parse_asm(&print_asm(&prog)).0.expect("bare parses");
        let with = parse_asm(&print_asm_with(&prog, &AsmHeader { result: Ty::Nat })).0.expect("headered parses");
        assert_eq!(bare, with, "the header must not perturb the program for {src}");
    }
}
