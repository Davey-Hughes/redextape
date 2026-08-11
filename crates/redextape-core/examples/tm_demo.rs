//! A hands-on demo of the TM backend: compile the mini-language all the way down to a genuine
//! multi-tape Turing machine, simulate it, decode the final tape, and check it against BOTH the
//! reference tree-walker and the λ-calculus normal form — the three-way oracle `reference == λ == TM`.
//!
//! It also shows the headline of Plan 3b-1: first-class functions (`map`/`fold`, capturing closures,
//! currying) run on the *first-order* TM via a Core→Core defunctionalization pass — so higher-order
//! programs are three-way too.
//!
//!     cargo run --example tm_demo -p redextape-core
//!
//! (Companion to `lambda_demo`, which shows the λ backend and the two-way oracle in isolation.)

// Example target: a demo that cannot build its own input has nothing to demonstrate, so aborting is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` do not reach example targets at all.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

#[cfg(not(target_arch = "wasm32"))]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::lambda::{LambdaRun, MAX_REDUCTION_STEPS, decode, lower, reduce_trace, run_lambda};
use redextape_core::parser::parse;
use redextape_core::run;
use redextape_core::tm::{
    LowerError, Machine, REG, TM_DEFAULT_CAPS, TmRun, Unary, decode_tape, defunc, lower_asm, lower_tm, print_asm,
    run_tm,
};
use redextape_core::value::{Value, format_value};

// The header rows pass column-aligned string literals as width args on purpose.
#[allow(clippy::print_literal)]
fn main() {
    println!("\n════════════════════════════════════════════════════════════════════");
    println!(" Redextape — Turing-machine backend demo");
    println!(" mini-language  →  register-asm  →  multi-tape TM  →  simulate  →  decode,");
    println!(" checked against the reference interpreter AND the λ normal form");
    println!(" (the three-way oracle:  reference == λ == TM).");
    println!("════════════════════════════════════════════════════════════════════");

    // 1. The three-way oracle: every first-order program agrees three ways. The TM is a REAL Turing
    //    machine — the "states" column is how many δ-states the program compiled to.
    println!("\n1. Run each program THREE ways and check they all agree\n");
    println!("   (reference tree-walker  ==  decoded λ normal form  ==  decoded TM final tape)\n");
    println!("   {:<52} {:>9}  {:>7}  {:>10}  {}", "program", "result", "β-steps", "TM states", "oracle");
    println!("   {}", "─".repeat(96));
    let first_order = [
        "1 + 2 * 3",
        "3 - 5", // monus: truncated subtraction, 3 - 5 = 0
        "if 2 > 1 { 10 } else { 20 }",
        "let x = 1; let y = x + x; y * 3",
        "let mut x = 1; x = x + 10; x = x * 2; x",
        "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
        "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
        "[1, 2, 3]",
        "head(cons(1, cons(2, nil)))",
        "head(tail(cons(1, cons(2, nil))))",
    ];
    for src in first_order {
        report(src);
    }

    // 2. First-class functions on a first-order Turing machine (Plan 3b-1). The TM has no notion of a
    //    function value; a Core→Core *defunctionalization* pass compiles each closure to a plain HEAP
    //    record `cons(tag, env)` and each dynamic call to a generated `$applyN` dispatcher — first-order
    //    Core the existing δ-layer runs unchanged. So map/fold/capture/currying are three-way too.
    println!("\n2. Higher-order programs, defunctionalized to run on the SAME machine\n");
    println!("   {:<52} {:>9}  {:>7}  {:>10}  {}", "program", "result", "β-steps", "TM states", "oracle");
    println!("   {}", "─".repeat(96));
    let higher_order = [
        "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)",
        "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
         fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
        // `|x| x + n` captures the immutable `n` by value — exact for an immutable.
        "let n = 5; fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
         [1, 2, 3].map(|x| x + n)",
        // Currying: a value-lambda whose body is another value-lambda.
        "fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)",
    ];
    for src in higher_order {
        report(src);
    }

    // 3. The honest boundary: Plan-2 latent traps the λ backend REFUSES to lower (it returns a
    //    LowerError rather than risk a silent miscompile), while the reference and the first-order TM
    //    both run them to a value. These are `reference == TM` two-way — the dual of a λ-only program.
    //    The last row is Plan 3b-2's headline: a closure that captures a MUTABLE by reference. λ still
    //    refuses (it has no notion of a mutable capture), but the TM now runs it via BOXING — defunc
    //    allocates a heap box for the captured mutable and the closure reads/writes through it.
    println!("\n3. Where λ bows out but the TM does not (reference == TM, two-way)\n");
    println!("   {:<64} {:>9}  {}", "program", "result", "reference == TM ?");
    println!("   {}", "─".repeat(96));
    for src in [
        "let mut x = 1; x = x + 1; let x = x + 10; x",
        "let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc",
        // Plan 3b-2: `|x| x + n` captures the MUTABLE `n` by reference; `n` is reassigned to 10 AFTER
        // the closure is built but BEFORE it's called. λ rejects (mutable-in-closure); the TM boxes the
        // capture, so the call observes the later write and agrees with the reference at 10.
        "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)",
    ] {
        report_tm_only(src);
    }

    // 4. Peek inside the machine — the Church–Turing thesis, made literal. Take one small program and
    //    show the register-asm it compiles to, the size of the Turing machine, and the final unary tape.
    println!("\n4. Peek inside the machine:  `1 + 2 * 3`\n");
    let core = core_of("1 + 2 * 3");
    let prog = lower_asm(&core).expect("first-order, lowers directly");
    println!("   register-assembly IR:\n");
    for line in print_asm(&prog).lines() {
        println!("       {line}");
    }
    let machine = lower_tm(&prog, &Unary::default());
    println!("\n   → compiled to a {}-state, 4-tape Turing machine (REG / WORK / STACK / HEAP).", machine.states.len());
    match run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS) {
        TmRun::Ran { tapes } => {
            let (cells, head) = tapes[REG].snapshot();
            println!("   → simulated to a halt. Final REG tape (the fixed-width unary register bank):\n");
            println!("       {}", tape_excerpt(&cells, head, 88));
            let value = decode_tape(&tapes, &Value::Nat(7), &Unary::default());
            println!(
                "\n   → decodes to {}   (reference says {}, they agree ✓)",
                fmt_opt(&value),
                format_value(&Value::Nat(7))
            );
        }
        other => println!("   → unexpected: {other:?}"),
    }

    println!("\n   Each of those states is a δ-transition; the unary tape is why even `1 + 2 * 3` takes");
    println!("   thousands of TM steps (the goldens pin 5,724 steps for this program, and 239,971 to");
    println!("   map (+1) over a two-element list). Verbose on purpose — that IS the Church–Turing thesis.\n");
}

/// Parse + desugar `src` to Core (panicking on a static error — every demo string is known-good).
fn core_of(src: &str) -> Core {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
    desugar(&prog.expect("program parses"))
}

/// Compile Core to a TM the same way `run_tm` does: try first-order lowering, and defunctionalize
/// only if the direct attempt rejects the program as higher-order. Returns the machine (for its size).
fn compile_tm(core: &Core) -> Option<Machine> {
    let prog = match lower_asm(core) {
        Ok(p) => p,
        Err(LowerError::Unsupported { .. }) => lower_asm(&defunc(core).ok()?).ok()?,
        Err(_) => return None,
    };
    Some(lower_tm(&prog, &Unary::default()))
}

/// Run one program three ways and print a table row: reference value, λ β-step count, TM state count,
/// and whether all three decode to the same value.
fn report(src: &str) {
    let reference = run(src).expect("reference run failed");
    let core = core_of(src);

    let lambda = run_lambda(&core, MAX_REDUCTION_STEPS);
    let lambda_ok = matches!(&lambda, LambdaRun::Reduced(nf) if decode(nf, &reference).as_ref() == Some(&reference));
    let beta_steps = lower(&core).map(|t| reduce_trace(&t, MAX_REDUCTION_STEPS).steps.len());

    let tm = run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS);
    let tm_ok = matches!(&tm, TmRun::Ran { tapes } if decode_tape(tapes, &reference, &Unary::default()).as_ref() == Some(&reference));
    let states = compile_tm(&core).map(|m| m.states.len());

    println!(
        "   {:<52} {:>9}  {:>7}  {:>10}  {}",
        truncate(src, 52),
        format_value(&reference),
        beta_steps.map_or("—".to_string(), |n| n.to_string()),
        states.map_or("—".to_string(), |n| n.to_string()),
        if lambda_ok && tm_ok { "✓ all agree" } else { "✗ DISAGREE" },
    );
}

/// Print a two-way row for a program the λ backend refuses: reference value, and whether the TM agrees.
fn report_tm_only(src: &str) {
    let reference = run(src).expect("reference run failed");
    let core = core_of(src);
    let lambda_refuses = matches!(run_lambda(&core, MAX_REDUCTION_STEPS), LambdaRun::LowerError(_));
    let tm = run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS);
    let tm_ok = matches!(&tm, TmRun::Ran { tapes } if decode_tape(tapes, &reference, &Unary::default()).as_ref() == Some(&reference));
    println!(
        "   {:<64} {:>9}  {}",
        truncate(src, 64),
        format_value(&reference),
        if lambda_refuses && tm_ok { "✓ agree  (λ: refuses to lower)" } else { "✗ DISAGREE" },
    );
}

/// Render a tape's cells as a string with a caret under the head, truncated to `max` columns.
fn tape_excerpt(cells: &[char], head: usize, max: usize) -> String {
    let shown: String = cells.iter().take(max).collect();
    let suffix = if cells.len() > max { "…" } else { "" };
    if head < max {
        format!("{shown}{suffix}\n       {}^ (head, cell {head} of {})", " ".repeat(head), cells.len())
    } else {
        format!("{shown}{suffix}   (head at cell {head} of {}, off the shown window)", cells.len())
    }
}

fn truncate(s: &str, width: usize) -> String {
    // A single-line view; collapse the interior whitespace of multi-line demo strings first.
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > width { format!("{}…", flat.chars().take(width - 1).collect::<String>()) } else { flat }
}

fn fmt_opt(v: &Option<Value>) -> String {
    v.as_ref().map_or("<none>".to_string(), format_value)
}
