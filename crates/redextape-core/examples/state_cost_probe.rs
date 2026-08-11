//! What a `Machine` state COSTS, and what that makes representable — the measurements behind
//! `tm::build::MAX_MACHINE_STATES` and `core::MAX_NODE_ID`.
//!
//!     cargo run --release --example state_cost_probe -p redextape-core
//!
//! **RUN IT UNDER A MEMORY CAP ANYWAY.** Section F deliberately walks a balanced expression tree
//! upward, and the step past 4,094 tokens was killed by `SIGKILL` under an 8 GB budget WHEN THESE
//! NUMBERS WERE TAKEN — before `MAX_MACHINE_STATES` existed. `Builder::state`/`accept` now bounds
//! every lowering this file can reach at that same ceiling (~727 MB), so a fresh run cannot reproduce
//! that kill; see the post-guard note below for what changed. The cap stays here as the same
//! belt-and-suspenders every `*_probe.rs` in this crate runs under, not because this file is
//! currently expected to need it:
//!
//!     systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet \
//!       cargo run --release --example state_cost_probe -p redextape-core
//!
//! **WHY THIS EXISTS.** Four narrowing casts used to justify themselves with a prose argument that
//! `Program::code.len()` was bounded by ~172 GB of resident memory. It is not, and the prose had
//! already been copied verbatim into a second file. Sections F and G are the refutation: a balanced
//! arithmetic tree of 6 KB — well inside `MAX_TOKENS`, and reachable from the editor through
//! `run_tm_described` — builds an 8.6 million state machine costing 6.0 GB.
//!
//! | section | question | what it fixes |
//! | --- | --- | --- |
//! | H | bytes per state | 700-725 B/state, measured as RSS delta at the row a fresh run can still reach (`size_of::<State>()` of 56 understates it ~13x); the historical 727 was measured at a row this file can no longer reach post-guard — see note below |
//! | A | how big can `code.len()` get from source | not `MAX_TOKENS` — `lower_asm`'s `MAX_LOWER_DEPTH` |
//! | B | states per instruction, by kind and encoding | 1 (`Halt`) to 571 (`Box`); `Call` scales with `n_loc` |
//! | C | the bisected `code.len()` ceiling | 3,472 — and only for depth-limited shapes |
//! | D | the largest machine a depth-limited program builds | 2.8M states, pre-guard — table in design doc §3.2 |
//! | E | the largest `NodeId` minted from source | 80,000, roughly one per token |
//! | G | what the SHIPPED demos cost | 49,135 states worst case — the floor a ceiling must clear |
//! | F | the balanced tree, which no depth guard bounds | the live OOM, pre-guard (see below) |
//!
//! Section G hand-copies every entry of `native_oracle.rs`'s `FIRST_ORDER_DEMOS`
//! (`crates/redextape-native/tests/native_oracle.rs`) as this file's own `FIRST_ORDER_DEMOS` const —
//! `redextape-core` cannot depend on `redextape-native` (the dependency runs the other way), so this
//! file cannot import that array. **That explains why this is a copy, not why the copy could drift
//! unnoticed**: `tests/three_way_oracle.rs`'s `first_order_demos_stay_synced_across_all_seven_copies`
//! is a TEXTUAL, path-based check, not an import — it `read_to_string`s this file and asserts its array
//! is byte-identical to the canonical one, so a drifted copy fails the test suite rather than going
//! quiet. Keep the binding a module-level `const` named `FIRST_ORDER_DEMOS`, exactly as every other
//! copy is shaped: that is both what the sync test's extractor looks for and what `grep -rn
//! FIRST_ORDER_DEMOS` — the audit method that test's own doc names — finds. If `FIRST_ORDER_DEMOS`
//! grows a new entry, re-copy the array from that file into this one and re-run this probe; its
//! `WORST SHIPPED DEMO` line is what `tm/build.rs`'s `MAX_MACHINE_STATES` doc and
//! `guard_counterexamples.rs`'s `WORST_SHIPPED_DEMO` need to match if the maximum moves. G is what
//! pins the "never rejects a legitimate program" half of `MAX_MACHINE_STATES`, and
//! `guard_counterexamples.rs` asserts the relation this section measures.
//!
//! Section order is deliberate: F runs LAST — not because it can still be killed (see below), but
//! because it is the section most likely to grow past that again if a future edit weakens the guard.
//!
//! **READING D, F AND H ONCE `MAX_MACHINE_STATES` EXISTS.** The 8.6M-state / 6.0 GB / `SIGKILL`
//! figures above were measured BEFORE this crate had a ceiling at all, using a scratch copy of this
//! file that called the (then-unguarded) `lower_tm`. `Builder::state`/`accept` (`tm/build.rs`) is
//! the ONE choke point every one of `lower_tm`, `lower_tm_guarded` and `lower_tm_mapped` shares, so
//! now that `MAX_MACHINE_STATES` is live, NOTHING built through any of them can exceed it —
//! including a fresh run of this file. Sections D, F and H below therefore print `REFUSED` rather
//! than a number for any row whose true cost would have crossed the ceiling — `guard_counterexamples.rs`'s
//! `the_balanced_tree_is_admitted_below_the_ceiling_and_refused_above_it` asserts the identical
//! admit/refuse boundary at the identical size. **That is the guard working, not a regression in this
//! probe.** What a fresh run DOES still re-derive: 575,861 states at the 1,022-token row, at roughly
//! 700-725 B/state (RSS delta is allocator- and machine-dependent; the spec's §3.1 table records
//! **725** for this row) — NOT 727. That figure was measured at the 4,094-token row, which this file
//! can no longer reach (now refused outright), so a fresh run cannot reproduce it, and neither can it
//! reproduce the "stable across a 15x size range" claim that rests on comparing the two rows. Also
//! still reproducible: the 49,135-state worst shipped demo, and the 80,000 max `NodeId`. The larger
//! historical figures survive only in
//! `docs/superpowers/specs/2026-08-11-count-bounds-design.md` §3 and in the git history of the
//! scratch probe that produced them — this file cannot reach them again by design, and should not be
//! made to.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use redextape_core::core::BinOp;
use redextape_core::desugar::desugar;
use redextape_core::parser::{MAX_TOKENS, parse};
use redextape_core::tm::asm::{Instr, Program, Reg};
use redextape_core::tm::build::MAX_MACHINE_STATES;
use redextape_core::tm::{Binary, Encoding, Machine, State, Unary, lower_asm, lower_tm_guarded, n_slots_of};

/// A named source generator: `(label, n -> source)`.
type Gen = (&'static str, fn(usize) -> String);

/// A named source generator paired with the fixed `n` it is run at.
type GenAt = (&'static str, fn(usize) -> String, usize);

/// `lower_tm_guarded`'s machine, or `None` if a guard refused the layout — `MAX_MACHINE_STATES` for
/// every program this file builds, verified by construction (modest `code.len()`/slots, no `Mul`,
/// bounded `Call` counts) the same way `guard_counterexamples.rs` verifies it for the identical
/// balanced-tree shape.
///
/// **PREFER THIS TO BARE `lower_tm` ANYWHERE NEAR THE CEILING.** Past `MAX_MACHINE_STATES`,
/// `lower_tm` does not fail — `Builder::state`/`accept` is the one choke point every lowering
/// function shares, so `lower_tm` silently returns a degenerate machine pinned at EXACTLY the
/// ceiling. Printed bare, `1000000` reads as a real measurement; it is the refusal `lower_tm_guarded`
/// was built to make visible (see that function's own doc comment), wearing the costume of a number.
fn lowered(prog: &Program, enc: &dyn Encoding) -> Option<Machine> {
    lower_tm_guarded(prog, enc).map(|(m, _)| m)
}

/// A table cell for a `lowered` result: the state count, or the refusal spelled out instead of a
/// number that would otherwise look like one.
fn states_col(m: &Option<Machine>) -> String {
    m.as_ref().map_or_else(|| format!("REFUSED(>={MAX_MACHINE_STATES})"), |m| m.states.len().to_string())
}

/// Token-cheap statement whose lowering is instruction-rich: each `let` costs ~6 tokens.
fn wide_src(n: usize) -> String {
    let mut s = String::from("fn main() {\n");
    for i in 0..n {
        s.push_str(&format!("  let v{i} = {i} + 1;\n"));
    }
    s.push_str("  0\n}\nmain()");
    s
}

/// A chain of `Bin` ops in one expression: maximum instructions per token.
fn chain_src(n: usize) -> String {
    let mut s = String::from("1");
    for _ in 0..n {
        s.push_str(" + 1");
    }
    s
}

/// FLAT and WIDE: `n` sibling top-level functions, each of constant depth. This is the direction
/// `MAX_LOWER_DEPTH` does NOT bound — siblings live in a `LetRecGroup`'s `Vec`, not nested.
fn wide_fns_src(n: usize) -> String {
    let mut s = String::new();
    for i in 0..n {
        s.push_str(&format!("fn f{i}(x) {{ x + {i} }}\n"));
    }
    s.push_str("f0(1)");
    s
}

/// BALANCED, so depth is log2(n) and `MAX_LOWER_DEPTH` never bites: this is the shape that can spend
/// the whole `MAX_TOKENS` budget on instructions. `n` is rounded up to a power of two.
fn balanced_src(n: usize) -> String {
    fn build(lo: usize, hi: usize) -> String {
        if hi - lo <= 1 {
            return "1".into();
        }
        let mid = (lo + hi) / 2;
        format!("({} + {})", build(lo, mid), build(mid, hi))
    }
    build(0, n.max(2))
}

fn token_count(src: &str) -> usize {
    redextape_core::lexer::lex(src).0.len()
}

fn part_a() {
    println!("=== A. front-door ceiling: source -> code.len() (MAX_TOKENS = {MAX_TOKENS}) ===");
    println!("{:<14} {:>10} {:>10} {:>10} {:>10}", "generator", "n", "tokens", "code.len", "instr/tok");
    for (name, mk) in
        [("wide_let", wide_src as fn(usize) -> String), ("bin_chain", chain_src), ("wide_fns", wide_fns_src)]
    {
        for n in [100usize, 1_000, 5_000, 8_000, 12_000, 20_000] {
            let src = mk(n);
            let toks = token_count(&src);
            if toks > MAX_TOKENS {
                println!("{name:<14} {n:>10} {toks:>10}   REJECTED at the front door");
                break;
            }
            let (prog, ds) = parse(&src);
            let Some(prog) = prog else {
                println!("{name:<14} {n:>10} {toks:>10}   parse errors: {ds:?}");
                break;
            };
            let core = desugar(&prog);
            match lower_asm(&core) {
                Ok(p) => {
                    let ratio = p.code.len() as f64 / toks as f64;
                    println!(
                        "{name:<14} {n:>10} {toks:>10} {:>10} {ratio:>10.3}   slots={}",
                        p.code.len(),
                        n_slots_of(&p)
                    );
                }
                Err(e) => println!("{name:<14} {n:>10} {toks:>10}   lower_asm {e:?}"),
            }
        }
    }
}

/// One `Program` of `n` copies of `instr`, terminated by `Halt`.
fn repeated(instr: Instr, n: usize) -> Program {
    let mut code: Vec<Instr> = std::iter::repeat_n(instr, n).collect();
    code.push(Instr::Halt);
    Program { code, labels: Vec::new() }
}

fn part_b() {
    println!();
    println!("=== B. states per instruction, by kind and encoding ===");
    println!("{:<12} {:>8} {:>12} {:>12} {:>10} {:>10}", "instr", "n", "unary", "binary", "u/instr", "b/instr");
    let kinds: Vec<(&str, Instr)> = vec![
        ("Halt", Instr::Halt),
        ("Li", Instr::Li(Reg::Loc(1), 7)),
        ("Mov", Instr::Mov(Reg::Loc(1), Reg::Loc(2))),
        ("Bin(Add)", Instr::Bin(BinOp::Add, Reg::Loc(1), Reg::Loc(2), Reg::Loc(3))),
        ("Bin(Lt)", Instr::Bin(BinOp::Lt, Reg::Loc(1), Reg::Loc(2), Reg::Loc(3))),
        ("Nil", Instr::Nil(Reg::Loc(1))),
        ("Cons", Instr::Cons(Reg::Loc(1), Reg::Loc(2), Reg::Loc(3))),
        ("Head", Instr::Head(Reg::Loc(1), Reg::Loc(2))),
        ("Tail", Instr::Tail(Reg::Loc(1), Reg::Loc(2))),
        ("IsEmpty", Instr::IsEmpty(Reg::Loc(1), Reg::Loc(2))),
        ("Box", Instr::Box(Reg::Loc(1), Reg::Loc(2))),
        ("BoxGet", Instr::BoxGet(Reg::Loc(1), Reg::Loc(2))),
        ("BoxSet", Instr::BoxSet(Reg::Loc(1), Reg::Loc(2))),
        ("Jmp", Instr::Jmp("end".into())),
        ("Jz", Instr::Jz(Reg::Loc(1), "end".into())),
    ];
    for (name, instr) in kinds {
        for n in [64usize, 256] {
            let mut prog = repeated(instr.clone(), n);
            // `Jmp`/`Jz` need their target to exist, or the gadget degenerates.
            prog.labels.push(("end".into(), prog.code.len() - 1));
            // `lowered()`, not bare `lower_tm` — see that helper's doc: a refusal printed bare reads as
            // a real state count. None of these small (n <= 256) programs is expected to refuse; this
            // is what makes that honest rather than assumed.
            let mu = lowered(&prog, &Unary::default());
            let mb = lowered(&prog, &Binary::default());
            if n == 256 {
                let u_ratio =
                    mu.as_ref().map_or_else(|| "-".to_string(), |m| format!("{:.2}", m.states.len() as f64 / n as f64));
                let b_ratio =
                    mb.as_ref().map_or_else(|| "-".to_string(), |m| format!("{:.2}", m.states.len() as f64 / n as f64));
                println!(
                    "{name:<12} {n:>8} {:>12} {:>12} {u_ratio:>10} {b_ratio:>10}",
                    states_col(&mu),
                    states_col(&mb)
                );
            }
        }
    }

    println!();
    println!("--- Call/Ret: the O(n_loc^2) frame gadget, scaled in BOTH directions ---");
    println!(
        "{:>8} {:>8} {:>10} {:>12} {:>12} {:>10} {:>10}",
        "n_loc", "calls", "code.len", "unary", "binary", "u/instr", "b/instr"
    );
    for n_loc in [4usize, 16, 64, 128] {
        for n in [16usize, 64] {
            let mut code = vec![Instr::Li(Reg::Loc(n_loc as u32), 1)];
            for _ in 0..n {
                code.push(Instr::Call("sub".into()));
            }
            code.push(Instr::Halt);
            let sub_at = code.len();
            code.push(Instr::Li(Reg::Rr, 1));
            code.push(Instr::Ret);
            let prog = Program { code, labels: vec![("sub".into(), sub_at)] };
            let len = prog.code.len();
            let mu = lowered(&prog, &Unary::default());
            let mb = lowered(&prog, &Binary::default());
            let u_ratio =
                mu.as_ref().map_or_else(|| "-".to_string(), |m| format!("{:.1}", m.states.len() as f64 / len as f64));
            let b_ratio =
                mb.as_ref().map_or_else(|| "-".to_string(), |m| format!("{:.1}", m.states.len() as f64 / len as f64));
            println!(
                "{n_loc:>8} {n:>8} {len:>10} {:>12} {:>12} {u_ratio:>10} {b_ratio:>10}",
                states_col(&mu),
                states_col(&mb)
            );
        }
    }
}

/// The largest `code.len()` each generator reaches before SOMETHING upstream refuses it. Bisects on
/// `n` so the answer is the real ceiling, not the coarsest grid point below it.
fn part_c() {
    println!();
    println!("=== C. bisected ceiling: the largest code.len() reachable from source ===");
    let gens: Vec<Gen> = vec![("wide_let", wide_src), ("bin_chain", chain_src), ("wide_fns", wide_fns_src)];
    for (name, mk) in gens {
        let ok = |n: usize| -> Option<usize> {
            let src = mk(n);
            if token_count(&src) > MAX_TOKENS {
                return None;
            }
            let (prog, ds) = parse(&src);
            if !ds.is_empty() {
                return None;
            }
            let core = desugar(&prog?);
            lower_asm(&core).ok().map(|p| p.code.len())
        };
        let (mut lo, mut hi) = (1usize, 1usize);
        while ok(hi).is_some() && hi < 200_000 {
            lo = hi;
            hi *= 2;
        }
        while lo + 1 < hi {
            let mid = (lo + hi) / 2;
            if ok(mid).is_some() { lo = mid } else { hi = mid }
        }
        let src = mk(lo);
        let code_len = ok(lo).unwrap_or(0);
        println!(
            "{name:<12} max n={lo:<8} tokens={:<8} code.len={code_len:<8}  (n={hi} is the first refusal)",
            token_count(&src)
        );
    }
}

/// What a depth-limited program built BEFORE `MAX_MACHINE_STATES` existed: a PRE-GUARD HISTORICAL
/// row, not a floor the ceiling must clear. Every row here now prints `REFUSED` — 2.8M states exceeds
/// the ceiling — so under this section's old framing the ceiling would fail to clear its own floor.
/// It does not, because this was never the floor: section G is (49,135 states, the worst program this
/// project actually SHIPS), and this section survives only as the historical measurement that forced
/// the correction recorded in the design doc's §3.2.
fn part_d() {
    println!();
    println!("=== D. pre-guard historical machine (depth-limited shape, now refused) ===");
    println!("size_of::<State>() = {} bytes (heap for `name` and `rules` is on top)", size_of::<State>());
    println!("{:<12} {:>8} {:>10} {:>12} {:>12} {:>12}", "generator", "n", "code.len", "unary", "binary", "u rules");
    let gens: Vec<GenAt> = vec![
        ("wide_let", wide_src as fn(usize) -> String, 577),
        ("bin_chain", chain_src, 579),
        ("wide_fns", wide_fns_src, 578),
    ];
    for (name, mk, n) in gens {
        let src = mk(n);
        let (prog, _) = parse(&src);
        let Some(prog) = prog else { continue };
        let core = desugar(&prog);
        let Ok(p) = lower_asm(&core) else { continue };
        let mu = lowered(&p, &Unary::default());
        let mb = lowered(&p, &Binary::default());
        let rules = mu
            .as_ref()
            .map_or_else(|| "-".to_string(), |m| m.states.iter().map(|s| s.rules.len()).sum::<usize>().to_string());
        println!("{name:<12} {n:>8} {:>10} {:>12} {:>12} {rules:>12}", p.code.len(), states_col(&mu), states_col(&mb));
    }
}

/// The largest `NodeId` a program that clears the front door mints. This is the floor a `seeded`
/// ceiling must clear.
fn part_e() {
    println!();
    println!("=== E. largest NodeId minted from source ===");
    let gens: Vec<Gen> =
        vec![("wide_let", wide_src as fn(usize) -> String), ("bin_chain", chain_src), ("wide_fns", wide_fns_src)];
    for (name, mk) in gens {
        // desugar has no depth guard of its own, so push to the TOKEN limit, not lower_asm's.
        let mut best = (0usize, 0u32, 0usize);
        for n in [1_000usize, 5_000, 10_000, 20_000, 40_000] {
            let src = mk(n);
            let toks = token_count(&src);
            if toks > MAX_TOKENS {
                break;
            }
            let (prog, ds) = parse(&src);
            let (Some(prog), true) = (prog, ds.is_empty()) else { break };
            let (_core, spans) = redextape_core::desugar::desugar_mapped(&prog);
            let max_id = spans.iter().map(|(id, _)| *id).max().unwrap_or(0);
            best = (n, max_id, toks);
        }
        println!("{name:<12} n={:<8} tokens={:<8} max NodeId={}", best.0, best.2, best.1);
    }
}

/// THE REAL FRONT-DOOR WORST CASE. A balanced tree is depth-log, so `MAX_LOWER_DEPTH` never fires and
/// the whole `MAX_TOKENS` budget goes into instructions AND slots — both of which the per-instruction
/// state cost scales with. Ramps upward and prints each step, so an OOM kill still leaves the last
/// good row on stdout.
fn part_f() {
    println!();
    println!("=== F. balanced tree: the shape MAX_LOWER_DEPTH does not bound ===");
    println!(
        "{:>8} {:>8} {:>10} {:>8} {:>14} {:>14} {:>10}",
        "n", "tokens", "code.len", "slots", "unary", "binary", "b/instr"
    );
    for n in [64usize, 256, 1_024, 4_096, 8_192, 16_384, 32_768] {
        let src = balanced_src(n);
        let toks = token_count(&src);
        if toks > MAX_TOKENS {
            println!("{n:>8} {toks:>8}   REJECTED at the front door (MAX_TOKENS)");
            break;
        }
        let (prog, ds) = parse(&src);
        let (Some(prog), true) = (prog, ds.is_empty()) else {
            println!("{n:>8} {toks:>8}   parse refused");
            break;
        };
        let core = desugar(&prog);
        let Ok(p) = lower_asm(&core) else {
            println!("{n:>8} {toks:>8}   lower_asm refused (TooDeep)");
            continue;
        };
        let slots = n_slots_of(&p);
        let mu = lowered(&p, &Unary::default());
        let mb = lowered(&p, &Binary::default());
        let b_ratio = mb
            .as_ref()
            .map_or_else(|| "-".to_string(), |m| format!("{:.0}", m.states.len() as f64 / p.code.len() as f64));
        println!(
            "{n:>8} {toks:>8} {:>10} {slots:>8} {:>14} {:>14} {b_ratio:>10}",
            p.code.len(),
            states_col(&mu),
            states_col(&mb)
        );
    }
}

/// Verbatim copy of `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS` — THAT array is the canonical one
/// this copy is checked against, not `crates/redextape-native/tests/native_oracle.rs`, which carries
/// the same array but is just another row in `three_way_oracle.rs`'s own `copies` table (true of this
/// file's copy only by transitivity, through the shared canonical). `redextape-core` cannot depend on
/// `redextape-native` — the dependency runs the other way — so this is a copy, not an import.
///
/// THIS COPY IS COVERED. `three_way_oracle.rs`'s `first_order_demos_stay_synced_across_all_seven_copies`
/// reads this file as text and asserts this array's literals are byte-for-byte equal to the canonical
/// one's — the same protocol every other copy uses (see that test's own doc for why a `read_to_string`
/// check needs no import). THIS WAS NOT ALWAYS TRUE: this array shipped in this same branch as a
/// `part_g` local named `demos`, which neither the sync test nor a `grep -rn FIRST_ORDER_DEMOS` audit
/// could find — see that test's doc for the fix. Nothing here needs a by-hand diff before it is
/// trusted; if `FIRST_ORDER_DEMOS` gains an entry, re-copy it here and re-run this probe, and the sync
/// test's own count (`copies.len() + 1`) is what catches a copy dropped instead of updated.
const FIRST_ORDER_DEMOS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "if 1 == 2 { 10 } else { 20 }",
    "let x = 40; x + 2",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    "let add1 = |x| x + 1; add1(41)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))",
    "is_empty(nil)",
    "is_empty(cons(1, nil))",
    "[1, 2, 3]",
    "cons(1, cons(2, nil))",
    "head(cons(7, nil))",
    "tail(cons(7, nil))",
    "head(cons(1, cons(2, nil)))",
    "tail(cons(1, cons(2, nil)))",
    "head(tail(cons(1, cons(2, nil))))",
    "head([1, 2, 3])",
    "tail([1, 2, 3])",
    "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
    "let n = 5; fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } [1, 2, 3].map(|x| x + n)",
    "\
        fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
        fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
        fn add(a, b) { a + b }\n\
        fn add1(x) { x + 1 }\n\
        fold([3, 1, 2].map(add1), 0, add)",
    "fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)",
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)",
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(5)",
    "fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)",
    "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
     fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
     fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)",
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(4, id)",
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(3, id)",
    "fn ap(h,x){ h(x) } fn f(n){ ap(g, n) } fn g(n){ n + 1 } f(3)",
    "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } fn ap(g, x) { g(x) } ap(sum, 4) + sum(2)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
     fn add1(x) { x + 1 }\n\
     fn ap2(g, a, b) { g(a, b) }\n\
     head(map([1, 2], add1)) + head(ap2(map, [5, 6], add1))",
    "fn v(x) { x * 10 } fn b(x) { x + 1 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)",
    "fn b(x) { x + 1 } fn v(x) { x * 10 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)",
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } head(1) + ap(add1, 2)",
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } head(1) + ap(head, 2)",
    "let n = 7; fn tail(x) { x + 1 } fn ap(g, y) { g(y) } tail(3) + ap(tail, 2) + ap(|y| y + n, 5)",
    "fn nil(x) { x + 5 } fn ap(g, x) { g(x) } ap(nil, 0)",
    "fn nil(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } nil(1) + ap(add1, 2)",
    "fn cons(a, b) { a + b } fn ap2(g, a, b) { g(a, b) } cons(1, 2) + ap2(cons, 3, 4)",
];

/// THE ACTUAL FLOOR: what the programs this project ships as demos cost. A cap must clear the
/// largest of these by a wide margin, or it rejects the product's own examples.
///
/// Uses `lowered()`, not bare `lower_tm` — see that helper's doc. A refused entry printed bare would
/// read as a real state count in the one section that recalibrates `MAX_MACHINE_STATES`; none of the
/// 46 demos is expected to refuse (that is what "the never-rejects half of the ceiling" means), but
/// `states_col` says so honestly if a future entry ever does, instead of printing a number that lies.
fn part_g() {
    println!();
    println!("=== G. the shipped demo suite ===");
    println!("{:>6} {:>8} {:>8} {:>10} {:>10}  program", "tokens", "code.len", "slots", "unary", "binary");
    let (mut worst_u, mut worst_b) = (0usize, 0usize);
    for src in FIRST_ORDER_DEMOS {
        let toks = token_count(src);
        let (prog, ds) = parse(src);
        let (Some(prog), true) = (prog, ds.is_empty()) else {
            println!("  parse refused: {src:.40}");
            continue;
        };
        let core = desugar(&prog);
        // `lower_program`'s own order: direct, then `defunc` on `Unsupported`.
        let asm = lower_asm(&core).or_else(|_| redextape_core::tm::defunc(&core).and_then(|d| lower_asm(&d)));
        let Ok(p) = asm else {
            println!("  lower refused: {src:.40}");
            continue;
        };
        let mu = lowered(&p, &Unary::default());
        let mb = lowered(&p, &Binary::default());
        if let Some(m) = &mu {
            worst_u = worst_u.max(m.states.len());
        }
        if let Some(m) = &mb {
            worst_b = worst_b.max(m.states.len());
        }
        let short: String = src.chars().take(46).collect();
        println!(
            "{toks:>6} {:>8} {:>8} {:>10} {:>10}  {short}",
            p.code.len(),
            n_slots_of(&p),
            states_col(&mu),
            states_col(&mb)
        );
    }
    println!("WORST SHIPPED DEMO: unary={worst_u} binary={worst_b}");
}

/// Bytes per state, measured as RSS delta rather than estimated from `size_of`. `State` carries a
/// heap `String` name and a `Vec<Rule>`, so `size_of::<State>()` understates it badly.
fn part_h() {
    println!();
    println!("=== H. measured bytes per state (RSS delta) ===");
    fn rss_kb() -> usize {
        std::fs::read_to_string("/proc/self/statm")
            .ok()
            .and_then(|s| s.split_whitespace().nth(1).and_then(|v| v.parse::<usize>().ok()))
            .map_or(0, |pages| pages * 4)
    }
    println!("{:>10} {:>12} {:>12} {:>14} {:>12}", "tokens", "code.len", "states", "RSS delta MB", "bytes/state");
    for n in [256usize, 1_024, 2_048] {
        let src = balanced_src(n);
        let (prog, _) = parse(&src);
        let Some(prog) = prog else { continue };
        let core = desugar(&prog);
        let Ok(p) = lower_asm(&core) else { continue };
        let before = rss_kb();
        let m = lowered(&p, &Binary::default());
        let after = rss_kb();
        let delta_kb = after.saturating_sub(before);
        match &m {
            Some(mach) => {
                let states = mach.states.len();
                println!(
                    "{:>10} {:>12} {states:>12} {:>14.1} {:>12.0}",
                    token_count(&src),
                    p.code.len(),
                    delta_kb as f64 / 1024.0,
                    (delta_kb * 1024) as f64 / states as f64
                );
            }
            None => println!(
                "{:>10} {:>12} {:>12} {:>14.1}   REFUSED(>={MAX_MACHINE_STATES}) -- bytes/state cannot be measured past the ceiling",
                token_count(&src),
                p.code.len(),
                "-",
                delta_kb as f64 / 1024.0
            ),
        }
        drop(m);
    }
}

fn main() {
    part_h();
    part_a();
    part_b();
    part_c();
    part_d();
    part_e();
    part_g();
    part_f();
}
