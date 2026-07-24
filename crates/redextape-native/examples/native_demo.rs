//! A hands-on demo of the native backend: compile the mini-language all the way down to REAL host
//! machine code via Cranelift, run it, and decode the result — the fourth oracle leg (alongside
//! `reference`, `λ`, and the TM).
//!
//! The headline: unlike the TM backend (a genuine Turing machine whose registers are a unary tape
//! fixed at `FIELD_WIDTH = 64` cells), native compiles to real 64-bit machine registers. It has no
//! `FIELD_WIDTH` ceiling — a program whose result the TM literally cannot represent on its tape
//! (`100 * 100 = 10_000`, say) runs on native the same way it would on any compiled language.
//!
//!     cargo run --example native_demo -p redextape-native
//!
//! (Companion to `redextape-core`'s `tm_demo`/`lambda_demo`, which show the other two backends.)

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::run;
use redextape_core::tm::{DEFAULT_CAPS, decode_asm};
use redextape_core::value::Value;
use redextape_native::{NativeRun, run_native};

// The header rows pass column-aligned string literals as width args on purpose.
#[allow(clippy::print_literal)]
fn main() {
    println!("\n════════════════════════════════════════════════════════════════════");
    println!(" Redextape — native backend demo");
    println!(" mini-language  →  register-asm  →  Cranelift JIT  →  real machine code  →  decode,");
    println!(" checked against the reference interpreter (reference == native).");
    println!("════════════════════════════════════════════════════════════════════");

    println!("\n1. Run each program natively and check it agrees with the reference\n");
    println!("   {:<64} {:>10}  {}", "program", "result", "oracle");
    println!("   {}", "─".repeat(94));
    for src in [
        "1 + 2 * 3",
        "3 - 5", // monus: truncated subtraction, 3 - 5 = 0
        "if 2 > 1 { 10 } else { 20 }",
        "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
        "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
        "head(tail([1, 2, 3]))",
    ] {
        report(src);
    }

    // 2. Higher-order programs, defunctionalized first (the same Core→Core pass the TM backend
    //    uses) so the first-order-only asm lowering can compile them.
    println!("\n2. Higher-order programs (defunctionalized, same pass as the TM backend)\n");
    println!("   {:<64} {:>10}  {}", "program", "result", "oracle");
    println!("   {}", "─".repeat(94));
    report(
        "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
         fn add1(x) { x + 1 } [5, 6].map(add1)",
    );

    // 3. The native headline: real 64-bit registers, no unary-tape ceiling.
    println!("\n3. The native headline: values the TM's unary tape CANNOT represent\n");
    println!("   The TM backend's registers are a fixed-width unary field (`FIELD_WIDTH = 64` cells);");
    println!("   a result that exceeds 64 cannot even be decoded off the tape. Native compiles to real");
    println!("   64-bit machine registers, so it has no such ceiling.\n");
    println!("   {:<64} {:>10}  {}", "program", "result", "oracle");
    println!("   {}", "─".repeat(94));
    for src in ["100 * 100", "999 + 1", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(100)"] {
        report(src);
    }

    // 4. Faults and caps: native is total (panic-free, bounded), not just correct on the happy path.
    println!("\n4. Faults and caps: native is total, not just correct on the happy path\n");
    let fault_src = "head(nil)";
    match run_native(&core_of(fault_src), DEFAULT_CAPS) {
        NativeRun::Fault(msg) => {
            println!("   {:<64} → Fault({msg:?})   (matches the reference's runtime error)", fault_src)
        }
        other => println!("   {fault_src:<64} → unexpected: {other:?}"),
    }
    let spin_src = "fn spin(n) { spin(n) } spin(0)";
    match run_native(&core_of(spin_src), DEFAULT_CAPS) {
        NativeRun::HitCap => {
            println!("   {:<64} → HitCap   (infinite recursion trips the depth cap; no stack overflow)", spin_src)
        }
        other => println!("   {spin_src:<64} → unexpected: {other:?}"),
    }
    println!();
}

/// Parse + desugar `src` to Core (panicking on a static error — every demo string is known-good).
fn core_of(src: &str) -> Core {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
    desugar(&prog.expect("program parses"))
}

/// Run one program natively, decode it against the reference value, and print a table row.
fn report(src: &str) {
    let reference = run(src).expect("reference run failed");
    let core = core_of(src);
    let native = run_native(&core, DEFAULT_CAPS);
    let (result, ok) = match &native {
        NativeRun::Ran(o) => {
            let decoded = decode_asm(o, &reference);
            let ok = decoded.as_ref() == Some(&reference);
            (decoded.as_ref().map_or("<none>".to_string(), fmt_value), ok)
        }
        other => (format!("{other:?}"), false),
    };
    println!("   {:<64} {:>10}  {}", truncate(src, 64), result, if ok { "✓ agrees" } else { "✗ DISAGREE" });
}

/// A single-line, whitespace-collapsed, width-truncated view of a (possibly multi-line) demo string.
fn truncate(s: &str, width: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > width { format!("{}…", flat.chars().take(width - 1).collect::<String>()) } else { flat }
}

/// Pretty-print a runtime value (lists flattened, no `Debug` noise).
fn fmt_value(v: &Value) -> String {
    match v {
        Value::Nat(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Nil => "[]".to_string(),
        Value::Cons(..) => {
            let mut items = Vec::new();
            let mut cur = v;
            while let Value::Cons(h, t) = cur {
                items.push(fmt_value(h));
                cur = &**t;
            }
            format!("[{}]", items.join(", "))
        }
        other => format!("{other:?}"),
    }
}
