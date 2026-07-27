//! Rung 2: BOUNDED-EXHAUSTIVE bank safety.
//!
//! Design: `docs/superpowers/specs/2026-07-26-bounded-exhaustive-bank-safety-design.md`.
//!
//! Layer 3 (`tm_bank_invariant.rs`) asserts the right property with the right epistemics — it inspects
//! the actual tape, so it depends on none of my reasoning being correct — but it is an OBSERVATION over
//! the programs that ran. Rung 1 raised that sample; it did not change the kind of claim.
//!
//! This changes the kind of claim, for a bounded space: for EVERY asm `Program` over a fixed small
//! alphabet, at every width in a range, no execution corrupts the register bank. Verified by
//! enumeration rather than sampling, reusing layer 3's checker verbatim so nothing new is trusted.
//!
//! It enumerates the ASM IR rather than source text, because `Program` is the direct input to
//! `lower_tm`, it is small, and `lower_tm` already CLAIMS totality on any `Program` (`MAX_SLOTS`,
//! `MAX_FRAME_LOC`) without ever testing that claim exhaustively. An enumerated program need not be one
//! `lower_asm` would emit — that is the point: the gadget library's safety must not depend on the
//! lowerer's habits.

use redextape_core::core::BinOp;
use redextape_core::tm::Encoding;

mod common;
use common::{reg_bank_is_well_formed, unsafe_rules};
use redextape_core::tm::{
    BOX, Instr, Program, REG, Reg, TAPES, Tape, TmCaps, TmStatus, Unary, lower_tm_guarded, n_slots_of, parse_tm,
    print_tm, simulate_watched,
};

// ================================================================================================
// The alphabet. Every bound the sweep covers is a named constant here, so a reader can see exactly
// what was and was not enumerated — a truncation that is not stated reads as coverage.
// ================================================================================================

/// Distinct register slots. `Rr` is slot 0, `Loc(k)` the middle bank, `Arg(k)` above it, so this set
/// spans all three regions and forces seeks and rewinds across several fields.
const REGS: &[Reg] = &[Reg::Rr, Reg::Loc(0), Reg::Loc(1), Reg::Arg(0)];

/// One representative per `BinOp` CLASS, not all nine. `Add` is the plain arithmetic shape; `Sub`
/// alone truncates at zero; `Mul` alone uses `rd` as a scratch counter while `ra`/`rb` are still live;
/// `Lt` stands for the comparison family, which all derive from the same `monus`/`is_zero` primitive.
const BIN_OPS: &[BinOp] = &[BinOp::Add, BinOp::Sub, BinOp::Mul, BinOp::Lt];

/// The widths swept. Small on purpose: a narrow bank makes overflow the COMMON case rather than a rare
/// one, which is the regime the guard exists for. Width 2 is the narrowest that can hold any value
/// (the bound is strict, so a 2-cell field holds only 0 and 1).
const WIDTHS: &[usize] = &[2, 3, 4, 5];

/// Literals enumerated for `Li`. Expressed relative to the width under test so the sweep always
/// includes the boundary values — `w - 1` (the largest that fits), `w` (exactly full, the
/// `rewind_home` miscount), and `w + 1` (a plain overrun) — which is where the strict bound lives.
fn literals_for(width: usize) -> Vec<u64> {
    let w = width as u64;
    let mut v = vec![0, 1, w.saturating_sub(1), w, w + 1];
    v.sort_unstable();
    v.dedup();
    v
}

/// Every instruction in the alphabet, at a given width. `Jz`/`Jmp`/`Call` target the single label at
/// index 0, which is enough to close a loop.
fn alphabet(width: usize) -> Vec<Instr> {
    let mut out = Vec::new();
    for &d in REGS {
        for &n in &literals_for(width) {
            out.push(Instr::Li(d, n));
        }
        out.push(Instr::Nil(d));
        out.push(Instr::Jz(d, "L".to_string()));
        for &s in REGS {
            out.push(Instr::Mov(d, s));
            out.push(Instr::Head(d, s));
            out.push(Instr::Tail(d, s));
            out.push(Instr::IsEmpty(d, s));
            out.push(Instr::Box(d, s));
            out.push(Instr::BoxGet(d, s));
            out.push(Instr::BoxSet(d, s));
            for &op in BIN_OPS {
                out.push(Instr::Bin(op, d, s, s));
            }
            out.push(Instr::Cons(d, s, s));
        }
    }
    out.push(Instr::Jmp("L".to_string()));
    out.push(Instr::Call("L".to_string()));
    out.push(Instr::Ret);
    out.push(Instr::Halt);
    out
}

/// What checking one `(program, width)` pair found. `Ok(steps)` means the run reached a defined
/// outcome with the bank well-formed at every step.
fn check(program: &Program, width: usize, caps: TmCaps) -> Result<u64, String> {
    let slots = n_slots_of(program) as usize;
    let enc = Unary::at(width);
    let (m, _) = lower_tm_guarded(program, &enc);
    // Free from the same sweep: `lower_tm` claims these for ANY `Program` and never tests them
    // exhaustively.
    let issues = m.validate();
    if !issues.is_empty() {
        return Err(format!("lowered machine fails validate(): {issues:?}"));
    }
    // RUNG 3, applied to every enumerated machine. This is the half of the coverage simulation cannot
    // reach: roughly half of these programs are infinite loops that spend the whole step budget, so
    // the watcher below verifies only a prefix of them. The static check has no such limit — it proves
    // no rule of this machine can EVER write over a delimiter, at any step count.
    for tape in [REG, BOX] {
        let bad = unsafe_rules(&m, tape);
        if !bad.is_empty() {
            return Err(format!("static delimiter safety fails on tape {tape}: {}", bad.join("; ")));
        }
    }
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(slots as u32);
    let mut steps = 0u64;
    let mut failure = None;
    {
        let mut watch = |tapes: &[Tape]| {
            steps += 1;
            let (cells, _) = tapes[REG].snapshot();
            match reg_bank_is_well_formed(&cells, &enc, slots) {
                Ok(()) => true,
                Err(why) => {
                    failure = Some(format!("step {steps}: {why}"));
                    false
                }
            }
        };
        let (_, _, status) = simulate_watched(&m, &init, caps, &mut watch);
        if !matches!(status, TmStatus::Halted | TmStatus::HitCap) {
            return Err(format!("undefined outcome: {status:?}"));
        }
    }
    match failure {
        Some(why) => Err(why),
        None => Ok(steps),
    }
}

/// Render a program for a failure message, so a reported defect is directly reproducible.
fn describe(program: &Program) -> String {
    program.code.iter().map(|i| format!("{i:?}")).collect::<Vec<_>>().join("; ")
}

/// Step budget for the FAST tier. Much smaller than the slow tier's 20,000 because roughly half of all
/// enumerated programs are infinite loops (`Jmp L`, `Call L`, a `Jz` back to index 0) that spend the
/// entire budget going nowhere, and that half dominates the runtime.
///
/// Safe to cut because corruption appears EARLY when it appears at all — the two sabotage reproducers
/// this suite found fail at step 11 and step 64. The slow tier keeps the large budget so its coverage
/// of long-running programs is genuinely deeper, not merely slower.
const FAST_CAPS: TmCaps = TmCaps { steps: 2_000, cells: 2_000 };

/// The exact number of `(length-1 program, width)` pairs the exhaustive sweeps must cover, derived
/// from the alphabet rather than hardcoded. Asserting equality (not `>`) is deliberate: a later edit
/// that shrinks the alphabet — dropping an instruction, deduping a literal away — would otherwise
/// reduce coverage silently while every sweep stayed green.
fn expected_pair_count() -> usize {
    WIDTHS.iter().map(|&w| alphabet(w).len()).sum()
}

/// All length-1 programs, over every width. Fast enough for the default tier, and it is the sweep that
/// covers every INSTRUCTION at every boundary literal at least once.
fn length_one_programs(width: usize) -> Vec<Program> {
    alphabet(width).into_iter().map(|i| Program { code: vec![i], labels: vec![("L".to_string(), 0)] }).collect()
}

// ================================================================================================
// Task 1: measure, so the bounds in the spec are derived from data rather than from my estimate.
// ================================================================================================

/// Prints the real cost of the sweep and the alphabet's real size, which is what the exhaustive
/// bounds must be derived from. Informational — it asserts only that the measurement is meaningful.
#[test]
#[ignore = "slow tier: measures enumeration cost to size the exhaustive sweep; run via scripts/check-slow.sh"]
fn measure_enumeration_cost() {
    let caps = TmCaps { steps: 20_000, cells: 20_000 };
    println!("\n  width | alphabet | length-1 programs | checked | total steps");
    for &width in WIDTHS {
        let alpha = alphabet(width).len();
        let programs = length_one_programs(width);
        let mut total_steps = 0u64;
        for p in &programs {
            match check(p, width, caps) {
                Ok(s) => total_steps += s,
                Err(why) => panic!("length-1 program `{}` at width {width}: {why}", describe(p)),
            }
        }
        println!("  {width:>5} | {alpha:>8} | {:>17} | {:>7} | {total_steps:>11}", programs.len(), programs.len());
    }
    let alpha = alphabet(4).len();
    println!("\n  alphabet size at width 4: {alpha}");
    println!("  length-2 enumeration would be {} programs per width", alpha * alpha);
    println!("  length-3 enumeration would be {} programs per width", (alpha as u64).pow(3));
    assert!(alpha > 100, "the alphabet must be large enough for the sweep to mean something: {alpha}");
}

/// THE HEADLINE SWEEP: every ORDERED PAIR of instructions from the alphabet, at every swept width.
///
/// Length 2 is the shortest length at which instructions INTERACT — one stores, the next reads or
/// overwrites — and interaction is what the bank invariant is about. A length-1 program can only
/// corrupt the bank by itself; a length-2 one can corrupt it through a state the first instruction
/// left behind, which is the whole class of defect that head-position reasoning gets wrong.
///
/// Measured cost, not estimated: the length-1 sweep runs 892 pairs in 0.46s release (~0.52 ms/pair),
/// so this is ~200k pairs in roughly two minutes. That measurement is why the spec's original plan to
/// sample length 2 was dropped in favour of enumerating it outright.
///
/// Reports the outcome mix rather than only pass/fail, because a sweep where every program instantly
/// halted would be green while covering nothing.
#[test]
#[ignore = "slow tier: exhaustive over ~200k (program, width) pairs, ~2 min; run via scripts/check-slow.sh"]
fn every_two_instruction_program_keeps_the_bank_well_formed() {
    let caps = TmCaps { steps: 20_000, cells: 20_000 };
    let mut total = 0usize;
    let mut capped = 0usize;
    let mut total_steps = 0u64;
    for &width in WIDTHS {
        let alpha = alphabet(width);
        let mut per_width = 0usize;
        for first in &alpha {
            for second in &alpha {
                let p = Program { code: vec![first.clone(), second.clone()], labels: vec![("L".to_string(), 0)] };
                match check(&p, width, caps) {
                    Ok(steps) => {
                        total_steps += steps;
                        // A run that used the whole budget did not finish; count it so the report
                        // cannot present a sweep of timeouts as a sweep of completed executions.
                        if steps >= caps.steps {
                            capped += 1;
                        }
                    }
                    Err(why) => panic!("width {width}, program `{}`: {why}", describe(&p)),
                }
                per_width += 1;
            }
        }
        println!("  width {width}: {per_width} programs checked");
        total += per_width;
    }
    let expected: usize = WIDTHS.iter().map(|&w| alphabet(w).len().pow(2)).sum();
    assert_eq!(total, expected, "the sweep covered fewer pairs than the alphabet defines");
    println!(
        "\n  EXHAUSTIVE over {total} (length-2 program, width) pairs, {total_steps} steps total.\n  \
         {capped} of them ({:.1}%) used the whole step budget rather than halting — they are infinite \
         loops through the single label. SIMULATION therefore verifies only a prefix of those, which is \
         precisely why every machine here also gets the STATIC delimiter check (rung 3): that half is \
         covered for the delimiter property at any step count, terminating or not. What remains \
         prefix-only for them is the LENGTH half of the skeleton, which no per-rule check can see.",
        capped as f64 / total as f64 * 100.0
    );
}

// ================================================================================================
// The default (fast) tier
// ================================================================================================

/// EXHAUSTIVE over every length-1 program at every swept width. This is the strongest statement the
/// project makes about the bank, and it is cheap enough to run on every commit: it covers every
/// instruction in the alphabet against every boundary literal.
#[test]
fn every_single_instruction_program_keeps_the_bank_well_formed() {
    let caps = FAST_CAPS;
    let mut checked = 0usize;
    for &width in WIDTHS {
        for p in length_one_programs(width) {
            if let Err(why) = check(&p, width, caps) {
                panic!("width {width}, program `{}`: {why}", describe(&p));
            }
            checked += 1;
        }
    }
    assert_eq!(
        checked,
        expected_pair_count(),
        "the sweep covered fewer pairs than the alphabet defines — coverage shrank silently"
    );
    println!("exhaustive over {checked} (length-1 program, width) pairs");
}

/// The fast tier's length-2 subset: every `(Li, anything)` pair. Cheap, and it covers the one class of
/// defect the length-1 sweep provably CANNOT reach.
///
/// This exists because of a measured gap, not a guess. Deleting `append_work_to_field`'s overflow guard
/// leaves the length-1 sweep entirely GREEN: every field starts at zero, so a single instruction can
/// only compute from zeros, and no computed value ever reaches the width. The guard on the universal
/// REG store is therefore invisible to length-1 programs. Seeding a value with `Li` first makes it
/// reachable in two instructions, which is exactly what the full length-2 sweep found
/// (`Box(Rr, Rr); Box(Rr, Rr)` at width 2, where the second pointer is 2 and does not fit).
///
/// So the fast tier is not a scaled-down version of the slow one — it is chosen to keep the specific
/// coverage that matters on every commit.
#[test]
fn every_seeded_two_instruction_program_keeps_the_bank_well_formed() {
    let caps = FAST_CAPS;
    let mut checked = 0usize;
    for &width in WIDTHS {
        let alpha = alphabet(width);
        let seeds: Vec<&Instr> = alpha.iter().filter(|i| matches!(i, Instr::Li(..))).collect();
        assert!(!seeds.is_empty(), "the alphabet must contain `Li` seeds at width {width}");
        for seed in &seeds {
            for second in &alpha {
                let p = Program { code: vec![(*seed).clone(), second.clone()], labels: vec![("L".to_string(), 0)] };
                if let Err(why) = check(&p, width, caps) {
                    panic!("width {width}, program `{}`: {why}", describe(&p));
                }
                checked += 1;
            }
        }
    }
    let expected: usize = WIDTHS
        .iter()
        .map(|&w| {
            let a = alphabet(w);
            a.iter().filter(|i| matches!(i, Instr::Li(..))).count() * a.len()
        })
        .sum();
    assert_eq!(checked, expected, "the seeded sweep covered fewer pairs than the alphabet defines");
    println!("exhaustive over {checked} (Li-seeded length-2 program, width) pairs");
}

/// The TM text form round-trips every machine the length-1 sweep builds. `parse_tm(print_tm(m)) == m`
/// is currently checked on a handful of compiled machines; this checks it over the whole alphabet,
/// including instructions no source program produces in isolation.
#[test]
fn every_single_instruction_machine_round_trips_through_the_text_form() {
    let mut checked = 0usize;
    for &width in WIDTHS {
        for p in length_one_programs(width) {
            let (m, _) = lower_tm_guarded(&p, &Unary::at(width));
            let (parsed, errors) = parse_tm(&print_tm(&m));
            assert!(errors.is_empty(), "width {width}, `{}`: text form has errors: {errors:?}", describe(&p));
            assert_eq!(parsed.as_ref(), Some(&m), "width {width}, `{}`: does not round-trip", describe(&p));
            checked += 1;
        }
    }
    assert_eq!(checked, expected_pair_count(), "fewer machines round-tripped than the alphabet defines");
}
