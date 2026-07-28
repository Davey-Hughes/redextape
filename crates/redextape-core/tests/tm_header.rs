//! The self-describing TM text form, end to end: a `.tm` file that any simulator can RUN and that this
//! project can INTERPRET, with nothing but the file.

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{
    DescribedRun, EncodingKind, TM_DEFAULT_CAPS, TmRun, TmStatus, decode_tape_ty, parse_tm_full, print_tm_with,
    run_tm_described, simulate,
};
use redextape_core::ty::Ty;
use redextape_core::typeck::result_type;
use redextape_core::value::Value;

/// Programs small enough to print in full and varied enough to reach REG, WORK, HEAP and the stack.
const CORPUS: &[&str] = &[
    "1 + 2 * 3",
    "if 1 == 2 { 10 } else { 20 }",
    "cons(1, cons(2, nil))",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
];

/// Parse, typecheck and desugar `src`, returning the `Core` and its top-level type together — the
/// shared prelude every test below needs before it can call `run_tm_described` (which wants `Core`) or
/// the reference interpreter (which also wants `Core`, but needs no type).
fn core_and_ty(src: &str) -> (Core, Ty) {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
    let prog = prog.expect("a program");
    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
    (desugar(&prog), ty)
}

fn described(src: &str, kind: EncodingKind) -> DescribedRun {
    let (core, ty) = core_and_ty(src);
    run_tm_described(&core, kind, ty, TM_DEFAULT_CAPS).unwrap_or_else(|r| panic!("{src} did not run: {r:?}"))
}

/// THE CONSISTENCY CHECK (spec §3). The header carries the initial tapes LITERALLY, so any simulator
/// can run the file, AND the recipe needed to decode the result. The two are redundant by
/// construction — and that redundancy is turned into a checked invariant, which is the move this
/// project makes everywhere else: the oracle IS redundancy, checked.
///
/// It runs THROUGH THE TEXT, so serialization is inside the loop being checked rather than beside it.
///
/// This is only a real check because the literal tapes were CAPTURED from the configuration
/// `simulate` was actually handed (see `attempt` in `tm.rs`), not regenerated from the header's own
/// fields. Regenerating them would compare `init_reg(slots)` with a copy of itself.
#[test]
fn the_headers_recipe_reproduces_its_literal_tapes() {
    for &src in CORPUS {
        for kind in [EncodingKind::Unary, EncodingKind::Binary] {
            let d = described(src, kind);
            let file = print_tm_with(&d.machine, &d.header);
            let (pm, h, ds) = parse_tm_full(&file);
            assert!(ds.is_empty(), "{src} under {kind:?}: {ds:?}");
            let h = h.expect("a header");

            // Optionality property 2, on the combination with the most moving parts — which is
            // `cons(1, cons(2, nil))` under `Binary`: a 5-tape COMPILED machine (every compiled
            // machine is 5-tape, since `build::TAPES` is fixed), a header with a NON-EMPTY WORK tape
            // line (only `Binary` has one — `Unary::init_work()` is empty), `result List<Nat>`, at a
            // fitted width. Property 2's own test uses a hand-built 2-state machine with one 6-cell
            // unary tape — so without these two lines the spec's Testing §2 ("both encodings, at
            // their fitted widths") is asserted nowhere.
            //
            // Naming the program matters: a review read this comment as describing `sum(5)` (which is
            // `result Nat`) and reported it as a false claim. The claim was true of a different
            // corpus entry; an unnamed "combination" invites exactly that misreading.
            assert_eq!(pm.as_ref(), Some(&d.machine), "{src} under {kind:?}: machine must round-trip");
            assert_eq!(h, d.header, "{src} under {kind:?}: header must round-trip");

            let enc = h.encoding();
            let init = h.init(d.machine.tapes);
            assert_eq!(init[0], enc.init_reg(h.slots), "{src} under {kind:?}: REG recipe != literal");
            // This does NOT check anything under Unary: `Unary::init_work()` unconditionally returns
            // `Vec::new()` (unary.rs), and `TmHeader::new` drops empty tapes, so under `Unary` the
            // header carries no WORK entry and `init[1]` is `Vec::new()` by construction — the
            // assertion reduces to `Vec::new() == Vec::new()` and cannot fail regardless of whether the
            // capture is genuine. It is real only under `Binary`, where WORK is a structured, nonempty
            // recipe. The REG equation above is meaningful for both.
            assert_eq!(init[1], enc.init_work(), "{src} under {kind:?}: WORK recipe != literal");
        }
    }
}

/// THE POINT OF THE SLICE: a file, and only a file, becomes a value.
///
/// No `Core`, no `lower_asm`, no `lower_tm`, no reference run — the input is a checked-in `.tm` file
/// read off disk. If any piece of the header were insufficient, this is the test that could not be
/// written.
#[test]
fn a_tm_file_becomes_a_value_with_nothing_but_the_file() {
    let file = include_str!("fixtures/list_1_2.tm");

    let (m, h, ds) = parse_tm_full(file);
    assert!(ds.is_empty(), "diagnostics: {ds:?}");
    let (m, h) = (m.expect("a machine"), h.expect("a header"));

    // 1. Build the initial configuration from the file and simulate. A generic simulator can do this
    //    much with no knowledge of this project.
    let (tapes, status) = simulate(&m, &h.init(m.tapes), TM_DEFAULT_CAPS);
    assert_eq!(status, TmStatus::Halted);

    // 2. Interpret the answer. THIS half needs the encoding's semantics, which the header NAMES but
    //    cannot inline — the gap the spec states rather than pretends to close.
    let got = decode_tape_ty(&tapes, &h.result, &*h.encoding());
    assert_eq!(got, Some(Value::list_of_nats(&[1, 2])));
}

/// The binary twin of the test above — the only fixture whose header carries a `tape 1` (WORK) line, so
/// this is the one that actually exercises a multi-tape-line file being read back with nothing but the
/// file itself.
#[test]
fn a_binary_tm_file_becomes_a_value_with_nothing_but_the_file() {
    let file = include_str!("fixtures/list_1_2_binary.tm");

    let (m, h, ds) = parse_tm_full(file);
    assert!(ds.is_empty(), "diagnostics: {ds:?}");
    let (m, h) = (m.expect("a machine"), h.expect("a header"));

    let (tapes, status) = simulate(&m, &h.init(m.tapes), TM_DEFAULT_CAPS);
    assert_eq!(status, TmStatus::Halted);

    let got = decode_tape_ty(&tapes, &h.result, &*h.encoding());
    assert_eq!(got, Some(Value::list_of_nats(&[1, 2])));
}

/// The fixture is a real artifact of today's compiler, not a hand-tuned file that drifted from it.
/// A codegen change updates the fixture deliberately, with this test as the prompt.
#[test]
fn the_fixture_is_what_the_compiler_emits_today() {
    let d = described("cons(1, cons(2, nil))", EncodingKind::Unary);
    assert_eq!(
        print_tm_with(&d.machine, &d.header),
        include_str!("fixtures/list_1_2.tm"),
        "regenerate with: cargo run --example regen_fixtures -p redextape-core"
    );
}

/// The binary twin of the check above. `Binary::init_work()` lays out a real `#`-delimited bank (unlike
/// `Unary::init_work()`, which is empty), so this fixture is the only one carrying a `tape 1` line —
/// the WORK-tape path had never round-tripped through an actual file before this one existed.
#[test]
fn the_binary_fixture_is_what_the_compiler_emits_today() {
    let d = described("cons(1, cons(2, nil))", EncodingKind::Binary);
    assert_eq!(
        print_tm_with(&d.machine, &d.header),
        include_str!("fixtures/list_1_2_binary.tm"),
        "regenerate with: cargo run --example regen_fixtures -p redextape-core"
    );
}

/// SABOTAGE, each aimed at the check that can actually see it.
///
/// The width row is the one worth reading twice. Structural decode made both encodings
/// width-independent — `Binary::decode_nat` and `parse_heap_cells` each say outright that
/// `self.width` is never consulted — so a width off by one is INVISIBLE to the end-to-end test and
/// visible only here, where `init_reg` writes `width` cells per field. An earlier draft of the spec
/// aimed it at the end-to-end test, where it would have proved nothing.
#[test]
fn sabotaging_the_recipe_is_caught_by_the_consistency_check() {
    let d = described("1 + 2 * 3", EncodingKind::Binary);
    let h = &d.header;
    let literal_reg = h.init(d.machine.tapes)[0].clone();

    // Baseline: the true recipe reproduces the literal tape.
    assert_eq!(h.encoding().init_reg(h.slots), literal_reg);
    // Width off by one: caught.
    assert_ne!(EncodingKind::Binary.at(h.width + 1).init_reg(h.slots), literal_reg);
    assert_ne!(EncodingKind::Binary.at(h.width - 1).init_reg(h.slots), literal_reg);
    // One field too many: caught.
    assert_ne!(h.encoding().init_reg(h.slots + 1), literal_reg);
    // The wrong encoding at the right width: caught.
    assert_ne!(EncodingKind::Unary.at(h.width).init_reg(h.slots), literal_reg);
}

/// SABOTAGE of the end-to-end path: the three header fields it genuinely depends on.
#[test]
fn sabotaging_the_header_is_caught_by_the_end_to_end_decode() {
    let file = include_str!("fixtures/list_1_2.tm");
    let (m, h, _) = parse_tm_full(file);
    let (m, h) = (m.expect("a machine"), h.expect("a header"));
    let (tapes, _) = simulate(&m, &h.init(m.tapes), TM_DEFAULT_CAPS);
    let truth = Some(Value::list_of_nats(&[1, 2]));
    assert_eq!(decode_tape_ty(&tapes, &h.result, &*h.encoding()), truth);

    // Wrong encoding: a unary mark run read as binary digits is a different number.
    assert_ne!(decode_tape_ty(&tapes, &h.result, &*EncodingKind::Binary.at(h.width)), truth);
    // Wrong result type: the list POINTER decodes as a bare Nat.
    assert_ne!(decode_tape_ty(&tapes, &redextape_core::ty::Ty::Nat, &*h.encoding()), truth);
    // Wrong initial tapes: corrupt the leading delimiter of REG's OWN result field (slot 0, `Rr`).
    //
    // A DELIMITER, deliberately, not a data cell. Measured, not assumed: every register
    // `lower_asm`/`lower_tm` ever compiles -- `Rr` included -- is write-before-read (a well-typed
    // program never reads a variable it has not just assigned, and lowering realizes that as an
    // unconditional, absolute write before any read; even `nil` compiles to an explicit `nil rr`
    // rather than relying on `rr` starting blank). Consequently no DATA cell of the literal REG or
    // WORK bank survives to influence the final decoded value -- flipping any single one, for every
    // program in `CORPUS` under both encodings, decodes identically to the untouched run. A delimiter
    // is different: the scanning gadgets that locate field boundaries read it before any register is
    // (re)written, so corrupting one is genuinely visible.
    let mut bad_init = h.init(m.tapes);
    bad_init[0][0] = '_';
    let (bad_tapes, _) = simulate(&m, &bad_init, TM_DEFAULT_CAPS);
    assert_ne!(decode_tape_ty(&bad_tapes, &h.result, &*h.encoding()), truth);
}

/// The `tm_emit` example's exact sequence, in-process (no shelling out): `emit` produces the text via
/// `run_tm_described` + `print_tm_with`; `run` reads it back via `parse_tm_full`, builds `init` from
/// the header, `simulate`s, and `decode_tape_ty`s. This is what CI protects — the example itself is
/// only the demo.
///
/// Distinct from `a_described_run_computes_what_an_ordinary_run_computes` below: that test compares
/// `d.run`'s tapes directly, never round-tripping through text. This one goes through the file format
/// on purpose, so serialization is inside the loop being checked rather than beside it.
#[test]
fn emit_then_run_round_trip_matches_the_reference() {
    for &src in CORPUS {
        for kind in [EncodingKind::Unary, EncodingKind::Binary] {
            let (core, ty) = core_and_ty(src);
            let expected =
                redextape_core::interp::eval(&core).unwrap_or_else(|e| panic!("reference failed for {src}: {e:?}"));

            // `emit`: parse -> typecheck -> desugar already happened in `core_and_ty`; compile, run,
            // and write the self-describing text.
            let d = run_tm_described(&core, kind, ty, TM_DEFAULT_CAPS)
                .unwrap_or_else(|r| panic!("{src} under {kind:?} did not run: {r:?}"));
            let text = print_tm_with(&d.machine, &d.header);

            // `run`: read the file (here, the in-memory text) -> parse -> build init from the header
            // -> simulate -> decode.
            let (m, h, ds) = parse_tm_full(&text);
            assert!(ds.is_empty(), "{src} under {kind:?}: {ds:?}");
            let m = m.unwrap_or_else(|| panic!("{src} under {kind:?}: file did not parse to a machine"));
            let h = h.unwrap_or_else(|| panic!("{src} under {kind:?}: file has no header"));

            let init = h.init(m.tapes);
            let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
            assert_eq!(status, TmStatus::Halted, "{src} under {kind:?}: did not halt");

            let got = decode_tape_ty(&tapes, &h.result, &*h.encoding());
            assert_eq!(got, Some(expected), "{src} under {kind:?}");
        }
    }
}

/// A described run computes what the REFERENCE computes — not merely "something". The producer must
/// not become a second, divergent path to a result.
#[test]
fn a_described_run_computes_what_an_ordinary_run_computes() {
    for &src in CORPUS {
        for kind in [EncodingKind::Unary, EncodingKind::Binary] {
            let (core, ty) = core_and_ty(src);
            // `interp::eval` is this project's reference interpreter for the mini-language `Core` AST
            // built above from a fixed test corpus — not a dynamic/untrusted code-execution primitive.
            let expected =
                redextape_core::interp::eval(&core).unwrap_or_else(|e| panic!("reference failed for {src}: {e:?}"));
            let d = run_tm_described(&core, kind, ty, TM_DEFAULT_CAPS)
                .unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
            let TmRun::Ran { tapes } = &d.run else { panic!("{src} under {kind:?}: {:?}", d.run) };
            let got = decode_tape_ty(tapes, &d.header.result, &*d.header.encoding());
            assert_eq!(got, Some(expected), "{src} under {kind:?}");
        }
    }
}
