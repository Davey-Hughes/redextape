#![cfg(feature = "cranelift")]
//! The AOT oracle leg (B1): compile a program all the way through `emit_object` -> `link_executable`
//! into a REAL standalone native binary, run that binary as a subprocess, and check its stdout + exit
//! code against the reference interpreter. This is the bounded end-to-end validation of the whole
//! Phase-3 pipeline (Tasks 4-6): emit -> link -> run -> decode/print/exit.
//!
//! Exit-code taxonomy the linked binary uses (`redextape-native-rt`'s `rt_run`), asserted here:
//!   0 = value (printed to stdout as `format_value(result)`), 2 = fault, 3 = cap hit.
//!
//! Gated on `cc` being present on `$PATH` (the linker driver's own requirement); prints a SKIP notice
//! rather than silently passing when it is absent, since `emit_object` alone is already covered by
//! `aot.rs`'s unit tests (`emits_a_valid_object_with_main_and_rt_run` et al).

use redextape_core::tm::{DEFAULT_CAPS, defunc, lower_asm};
use redextape_core::ty::Ty;
use redextape_core::typeck::result_type;
use redextape_core::value::format_value;
use redextape_core::{desugar::desugar, parser::parse, run};
use redextape_native::{LinkOptions, emit_object, link_executable};

fn cc_available() -> bool {
    std::env::var_os("PATH").is_some_and(|p| std::env::split_paths(&p).any(|d| d.join("cc").is_file()))
}

/// `result_type` can legitimately return an unresolved type variable for a program whose result type
/// is never pinned down by anything (`head(nil)`: the reference `typeck` module documents this exact
/// case as "nil-typed head is polymorphic but well-typed" in `result_type_infers_top_level`). But
/// `emit_object` needs a *concrete* `Ty` to serialize into the CONFIG blob's decode/print branch --
/// and that branch is provably dead for a program that faults or hits the depth cap: `rt_run` returns
/// (exit 2 / exit 3) before ever reading `ty` on either path (see
/// `redextape_native_rt::{rt_run, print_outcome}`). So substituting any concrete placeholder for a
/// leftover `Var` here is safe on those paths and never masks a real value-decoding disagreement --
/// the value cases below all resolve to genuinely concrete types already (`Nat`/`Bool`/`List<Nat>`)
/// and never touch this substitution.
fn concretize(ty: Ty) -> Ty {
    match ty {
        Ty::Var(_) => Ty::Nat,
        Ty::List(t) => Ty::List(Box::new(concretize(*t))),
        Ty::Fun(ps, r) => Ty::Fun(ps.into_iter().map(concretize).collect(), Box::new(concretize(*r))),
        other => other,
    }
}

/// Compile `src` to a native binary, run it, return (stdout, exit_code).
///
/// Mirrors `run_native`'s (private) lowering template exactly: try `lower_asm` first, only retry
/// through `defunc` when it rejects the program as higher-order -- see this crate's `lib.rs`.
fn run_binary(src: &str, name: &str) -> (String, i32) {
    let ast = parse(src).0.unwrap();
    let ty = concretize(result_type(&ast).unwrap());
    let core = desugar(&ast);
    let prog = lower_asm(&core).or_else(|_| defunc(&core).and_then(|d| lower_asm(&d))).unwrap();
    let obj = emit_object(&prog, DEFAULT_CAPS, &ty).unwrap();
    let out = std::env::temp_dir().join(format!("redextape_aot_{name}"));
    link_executable(&obj, &out, &LinkOptions::default()).expect("link");
    let output = std::process::Command::new(&out).output().expect("run binary");
    (String::from_utf8_lossy(&output.stdout).trim().to_string(), output.status.code().unwrap_or(-1))
}

#[test]
fn aot_binary_matches_reference() {
    if !cc_available() {
        eprintln!("SKIP aot_binary_matches_reference: no `cc` on PATH (the .o still emits; see the smoke test)");
        return;
    }
    let value_cases = [
        ("nat", "2 + 3 * 4"),
        ("bool", "10 > 3"),
        ("list", "[1, 2, 3]"),
        ("recursion", "fn sum(n){ if n == 0 { 0 } else { n + sum(n - 1) } } sum(100)"),
        (
            "higher_order",
            "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} [5,6].map(add1)",
        ),
    ];
    for (name, src) in value_cases {
        let expected = format_value(&run(src).unwrap());
        let (stdout, code) = run_binary(src, name);
        assert_eq!(stdout, expected, "stdout mismatch for {name} ({src})");
        assert_eq!(code, 0, "exit code for a value should be 0 ({name})");
    }
    // Fault -> exit 2.
    let (_out, code) = run_binary("head(nil)", "fault");
    assert_eq!(code, 2, "head(nil) should fault with exit 2");
    // Cap -> exit 3.
    let (_out, code) = run_binary("fn spin(n){ spin(n) } spin(0)", "cap");
    assert_eq!(code, 3, "infinite recursion should hit the cap with exit 3");
}
