//! A hands-on demo of the lambda backend: compile the mini-language to lambda-calculus, run it,
//! watch a reduction step by step, and round-trip the lambda text form.
//!
//!     cargo run --example lambda_demo -p redextape-core

use redextape_core::desugar::desugar;
use redextape_core::lambda::{MAX_REDUCTION_STEPS, decode, lower, parse_lambda, print_lambda, reduce_trace};
use redextape_core::parser::parse;
use redextape_core::run;
use redextape_core::value::Value;

// The header rows pass column-aligned string literals as `{:<56}` args on purpose.
#[allow(clippy::print_literal)]
fn main() {
    println!("\n════════════════════════════════════════════════════════════════════");
    println!(" Redextape — lambda backend demo");
    println!(" mini-language  →  λ-calculus  →  reduce  →  decode, checked against");
    println!(" the reference interpreter (the two-way oracle).");
    println!("════════════════════════════════════════════════════════════════════");

    // 1. The oracle in action: reference result == decoded lambda normal form.
    println!("\n1. Run each program TWO ways and check they agree\n");
    let demos = [
        "1 + 2 * 3",
        "3 - 5", // monus: truncated subtraction, 3 - 5 = 0
        "if 2 > 1 { 10 } else { 20 }",
        "let add1 = |x| x + 1; add1(41)",
        "[1, 2, 3]",
        "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
        "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    ];
    println!("   {:<56} {:>7}  {:>8}  {}", "program", "β-steps", "result", "oracle");
    println!("   {}", "─".repeat(84));
    for src in demos {
        let reference = run(src).expect("reference run failed");
        let core = desugar(&parse(src).0.expect("parse"));
        let term = lower(&core).expect("lowering");
        let trace = reduce_trace(&term, MAX_REDUCTION_STEPS);
        let decoded = decode(&trace.normal_form, &reference);
        let agree = decoded.as_ref() == Some(&reference);
        let shown = if src.len() > 54 { format!("{}…", &src[..53]) } else { src.to_string() };
        println!(
            "   {:<56} {:>7}  {:>8}  {}",
            shown,
            trace.steps.len(),
            fmt_value(&reference),
            if agree { "✓ agree" } else { "✗ DISAGREE" },
        );
    }

    // 2. A lambda-term you can actually read.
    println!("\n2. What a program compiles to (the honest, sugar-free λ-term)\n");
    for src in ["true", "1", "3", "|x| x"] {
        let term = lower(&desugar(&parse(src).0.unwrap())).unwrap();
        println!("   {:<14} ⟶   {}", src, print_lambda(&term));
    }
    println!("\n   (arithmetic and recursion expand to much larger terms — that verbosity is the");
    println!("    point: functional code is λ-native, imperative code inherently is not.)");

    // 3. Watch β-reduction happen, one redex at a time.
    println!("\n3. Watch normal-order β-reduction, step by step\n");
    let start = parse_lambda("(\\x. x x) (\\y. y)").0.expect("parse λ");
    let trace = reduce_trace(&start, MAX_REDUCTION_STEPS);
    println!("   start    {}", print_lambda(&start));
    for (i, step) in trace.steps.iter().enumerate() {
        let after = trace.steps.get(i + 1).map_or(&trace.normal_form, |s| &s.term);
        println!("   β-step   {}      (reduced the redex at path {:?})", print_lambda(after), step.redex);
    }
    println!("   result   {}   [{:?}]", print_lambda(&trace.normal_form), trace.status);

    // 4. The lambda text form round-trips (print ∘ parse is stable).
    println!("\n4. The λ text form is real: parse ∘ print round-trips\n");
    let church_two = lower(&desugar(&parse("2").0.unwrap())).unwrap();
    let printed = print_lambda(&church_two);
    let (reparsed, diags) = parse_lambda(&printed);
    println!("   `2` compiles to        {}", printed);
    println!("   re-parses identically: {}   (diagnostics: {})", reparsed.as_ref() == Some(&church_two), diags.len(),);

    println!("\nAll of the above is the data the future web UI (Plan 5) will render.\n");
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
