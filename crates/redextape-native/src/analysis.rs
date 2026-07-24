//! Pure analysis over a register-asm `Program`: partition its flat `code` into per-subroutine
//! bodies (`$main` plus each `fn`, per `lower_asm`'s calling convention — `Call`/`Ret`, `$main`
//! ends in `Halt`), and compute each subroutine's arity, local-register count, and internal block
//! labels. Task 4's Cranelift codegen compiles one native function per `Subroutine`.
//!
//! **Why reachability, not slicing.** `lower_asm` emits every `fn` *inline*, at its definition
//! site, guarded by a `Jmp` that jumps over the body (see `lower_asm::lower_function`):
//! `jmp skip; <fn-entry>: <body>; ret; skip: <rest of the enclosing scope>`. So a top-level `fn`'s
//! body physically sits *between* two pieces of `$main`'s own code (the prologue up to the guard
//! `Jmp`, and everything after `skip`). `$main`'s code is therefore **non-contiguous** in the raw
//! index space. Any "sort entries ascending, slice by adjacent boundary" scheme misattributes
//! `$main`'s epilogue (and its `Halt`) to the textually-last `fn`, and puts `$main`'s resume label
//! into that `fn`'s labels — which would break Task 4's one-native-function-per-subroutine codegen.
//!
//! Instead each subroutine's `body` is the set of instruction indices **reachable from its entry**
//! by following control flow (`Jmp`/`Jz`/fallthrough), stopping at `Ret`/`Halt`, and treating a
//! `Call` as a single fallthrough edge to the instruction *after* it (the callee is a *separate*
//! subroutine, discovered from its own entry — a `Call` target is never pulled into the caller's
//! body). Because `$main` begins with `jmp skip`, its walk follows the jump and *skips over* every
//! inline `fn` body, so the bodies come out pairwise **disjoint**. The walk is an iterative worklist
//! (no native recursion), and it is total: an out-of-bounds successor or an undefined `Jz`/`Jmp`
//! target yields `LowerError::Unsupported` rather than panicking or indexing out of bounds.

use std::collections::{BTreeMap, BTreeSet};

use redextape_core::core::NodeId;
use redextape_core::tm::{Instr, LowerError, Program, Reg};

/// One subroutine: `$main` (always `entry: 0`) or a `fn`'s body, described by the set of
/// instruction indices reachable from its entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Subroutine {
    /// `"$main"` for the program's entry point, or the `fn`'s label name otherwise.
    pub name: String,
    /// The `code` index this subroutine is entered at.
    pub entry: usize,
    /// The instruction indices reachable from `entry` (sorted ascending). Bodies of distinct
    /// subroutines are pairwise disjoint for real `lower_asm` output.
    pub body: Vec<usize>,
    /// `1 + max Arg(i) READ` across `body` (`0` if no `Arg` is ever read).
    pub arity: u32,
    /// `1 + max Loc(i) referenced` (read or written) across `body` (`0` if none).
    pub n_locals: u32,
    /// Labels whose index is in `body` and is not itself a subroutine entry (a `Call` target).
    /// These are the intra-function block labels (`if`/`while` targets, guard `skip`s) Task 4 turns
    /// into Cranelift blocks.
    pub internal_labels: Vec<(String, usize)>,
}

fn unsupported(what: impl Into<String>) -> LowerError {
    LowerError::Unsupported { node: NodeId::default(), what: what.into() }
}

/// Invoke `f(reg, is_write)` for every register operand `i` touches, `is_write` true iff `i`
/// writes that register (its destination). Order matches the instruction's own field order.
pub(crate) fn for_each_operand(i: &Instr, mut f: impl FnMut(Reg, bool)) {
    match i {
        Instr::Li(rd, _) | Instr::Nil(rd) => f(*rd, true),
        Instr::Mov(rd, rs) => {
            f(*rd, true);
            f(*rs, false);
        }
        Instr::Bin(_, rd, ra, rb) => {
            f(*rd, true);
            f(*ra, false);
            f(*rb, false);
        }
        Instr::Jz(r, _) => f(*r, false),
        Instr::Jmp(_) | Instr::Call(_) | Instr::Ret | Instr::Halt => {}
        Instr::Cons(rd, rh, rt) => {
            f(*rd, true);
            f(*rh, false);
            f(*rt, false);
        }
        Instr::Head(rd, rl)
        | Instr::Tail(rd, rl)
        | Instr::IsEmpty(rd, rl)
        | Instr::Box(rd, rl)
        | Instr::BoxGet(rd, rl) => {
            f(*rd, true);
            f(*rl, false);
        }
        Instr::BoxSet(rb, rv) => {
            f(*rb, false);
            f(*rv, false);
        }
    }
}

/// The set of instruction indices reachable from `entry` by following control flow, stopping at
/// `Ret`/`Halt` and treating `Call` as a single fallthrough edge (the callee is a separate
/// subroutine). Iterative worklist — no native recursion. Returns `Unsupported` for any successor
/// past `code.len()` or any `Jz`/`Jmp` to an undefined label (defensive; never panics).
fn reachable_from(prog: &Program, entry: usize) -> Result<BTreeSet<usize>, LowerError> {
    let mut visited: BTreeSet<usize> = BTreeSet::new();
    let mut work: Vec<usize> = vec![entry];
    while let Some(i) = work.pop() {
        if !visited.insert(i) {
            continue; // already processed
        }
        let Some(instr) = prog.code.get(i) else {
            return Err(unsupported(format!("control flow reaches index {i}, past the end of code")));
        };
        // Resolve a label to its index, faulting (never panicking) on an undefined target.
        let target = |l: &str| prog.label_index(l).ok_or_else(|| unsupported(format!("jump to undefined label `{l}`")));
        match instr {
            // Terminators: reachable, but add no successors.
            Instr::Ret | Instr::Halt => {}
            // Unconditional jump: the only successor is the target.
            Instr::Jmp(l) => work.push(target(l)?),
            // Conditional jump: fallthrough (not-zero) AND the zero-branch target.
            Instr::Jz(_, l) => {
                work.push(i + 1);
                work.push(target(l)?);
            }
            // A `Call` returns to the next instruction; the callee `l` is a SEPARATE subroutine and
            // is deliberately NOT added to this body.
            Instr::Call(_) => work.push(i + 1),
            // Everything else falls through to the next instruction.
            Instr::Li(..)
            | Instr::Mov(..)
            | Instr::Bin(..)
            | Instr::Nil(_)
            | Instr::Cons(..)
            | Instr::Head(..)
            | Instr::Tail(..)
            | Instr::IsEmpty(..)
            | Instr::Box(..)
            | Instr::BoxGet(..)
            | Instr::BoxSet(..) => work.push(i + 1),
        }
    }
    Ok(visited)
}

/// Partition `prog` into subroutines by reachability from each entry. See the module doc for the
/// algorithm. Total and panic-free: an undefined `Call`/`Jz`/`Jmp` target, or control flow that
/// runs past the end of `code`, yields `LowerError::Unsupported` rather than panicking.
pub fn partition(prog: &Program) -> Result<Vec<Subroutine>, LowerError> {
    // Entry set = {0} ("$main") union every resolved `Call` target. `BTreeMap` both dedupes and
    // sorts ascending in one structure; each entry's name is its label's name (recursive/mutual
    // calls to one subroutine all resolve to the same index and name).
    let mut entries: BTreeMap<usize, String> = BTreeMap::new();
    entries.insert(0, "$main".to_string());
    for instr in &prog.code {
        if let Instr::Call(l) = instr {
            let idx = prog.label_index(l).ok_or_else(|| unsupported(format!("call to undefined label `{l}`")))?;
            entries.entry(idx).or_insert_with(|| l.clone());
        }
    }

    // `lower_asm` always emits an unconditional `Jmp` over each inline fn body, so a fn entry is
    // only ever reachable via `Call` and bodies are disjoint in practice (see the module doc). But
    // `partition` must DEFEND against a future producer change (or an adversarial hand-built
    // `Program`) where an entry is *also* reachable via fall-through from an earlier subroutine —
    // that would silently compile the same instruction into two native functions in Task 4. Track
    // every index claimed by an earlier entry's body and fault loudly on any overlap instead.
    let mut claimed: BTreeSet<usize> = BTreeSet::new();

    let mut subs = Vec::with_capacity(entries.len());
    for (&entry, name) in &entries {
        let visited = reachable_from(prog, entry)?;
        if visited.iter().any(|i| claimed.contains(i)) {
            return Err(unsupported("subroutine bodies overlap (non-disjoint partition)"));
        }
        claimed.extend(visited.iter().copied());

        // `Halt` stops the WHOLE program (`run_asm`); `Ret` returns to the caller. Task 4 compiles a
        // non-`$main` subroutine into a native function that can only `return` to its caller, so a
        // `Halt` inside a `fn` body would wrongly resume the caller (returning `rr`) instead of
        // ending the program. `lower_asm` only ever emits `Halt` in `$main` (`entry == 0`), so this
        // never rejects real lowered output — it turns a constructible wrong answer into a loud
        // reject. (`entry == 0` is always `$main`; every other entry is a `Call` target.)
        if entry != 0 && visited.iter().any(|&i| prog.code.get(i) == Some(&Instr::Halt)) {
            return Err(unsupported(
                "a non-`$main` subroutine contains `halt` (halt stops the whole program, not just the callee)",
            ));
        }

        let mut max_arg_read: Option<u32> = None;
        let mut max_loc_ref: Option<u32> = None;
        for &i in &visited {
            // Present by construction: `reachable_from` only inserts indices it successfully read.
            if let Some(instr) = prog.code.get(i) {
                for_each_operand(instr, |reg, is_write| match reg {
                    Reg::Loc(n) => max_loc_ref = Some(max_loc_ref.map_or(n, |m| m.max(n))),
                    Reg::Arg(n) if !is_write => max_arg_read = Some(max_arg_read.map_or(n, |m| m.max(n))),
                    _ => {}
                });
            }
        }

        // A label is internal to this subroutine iff its index is in the body and it is not itself
        // a subroutine entry (a `Call` target).
        let internal_labels: Vec<(String, usize)> = prog
            .labels
            .iter()
            .filter(|(_, idx)| visited.contains(idx) && !entries.contains_key(idx))
            .cloned()
            .collect();

        subs.push(Subroutine {
            name: name.clone(),
            entry,
            body: visited.into_iter().collect(),
            arity: max_arg_read.map_or(0, |m| m + 1),
            n_locals: max_loc_ref.map_or(0, |m| m + 1),
            internal_labels,
        });
    }
    Ok(subs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use redextape_core::core::BinOp;
    use redextape_core::desugar::desugar;
    use redextape_core::parser::parse;
    use redextape_core::tm::{defunc, lower_asm};

    #[test]
    fn partitions_main_and_one_subroutine() {
        // main: call f; halt    |    f: rr = a0 + a0; ret
        let prog = Program {
            code: vec![
                Instr::Call("f".into()),
                Instr::Halt, // 0,1  main
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Arg(0), Reg::Arg(0)),
                Instr::Ret, // 2,3  f
            ],
            labels: vec![("f".into(), 2)],
        };
        let subs = partition(&prog).unwrap();
        assert_eq!(subs.len(), 2);
        assert_eq!(subs[0].name, "$main");
        // `$main` reaches the `call` (fallthrough to next) then `halt`; it does NOT enter `f`.
        assert_eq!(subs[0].body, vec![0, 1]);
        assert_eq!(subs[1].name, "f");
        assert_eq!(subs[1].body, vec![2, 3]);
        assert_eq!(subs[1].arity, 1); // reads Arg(0)
        // Bodies are disjoint.
        assert!(subs[0].body.iter().all(|i| !subs[1].body.contains(i)));
    }

    #[test]
    fn internal_label_is_a_block_not_a_boundary() {
        // one subroutine (main): jmp end; <dead Li>; end: halt. Reachability follows the jump, so
        // index 1 (the `Li`) is UNREACHABLE dead code and is correctly excluded from the body.
        let prog = Program {
            code: vec![Instr::Jmp("end".into()), Instr::Li(Reg::Rr, 9), Instr::Halt],
            labels: vec![("end".into(), 2)],
        };
        let subs = partition(&prog).unwrap();
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0].body, vec![0, 2]); // index 1 (dead `Li`) excluded
        assert_eq!(subs[0].internal_labels, vec![("end".to_string(), 2)]);
    }

    #[test]
    fn partitions_a_real_lower_asm_program() {
        // `lower_asm` emits `sum` inline (guarded by `jmp skip1`). Reachability gives the correct,
        // non-contiguous body for `$main` (prologue index 0, then the post-`skip` epilogue) and a
        // clean, disjoint body for `sum.0` — the inline-layout misattribution is gone.
        let core = desugar(&parse("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(3)").0.unwrap());
        let prog = lower_asm(&core).unwrap();
        let subs = partition(&prog).unwrap();

        let main = subs.iter().find(|s| s.name == "$main").expect("a `$main` subroutine");
        let sum = subs.iter().find(|s| s.name.starts_with("sum")).expect("a `sum` subroutine");

        // (c) sum takes one argument.
        assert_eq!(sum.arity, 1);
        // (b) the two bodies are DISJOINT — the inline-layout bug is fixed.
        let main_set: BTreeSet<usize> = main.body.iter().copied().collect();
        assert!(sum.body.iter().all(|i| !main_set.contains(i)), "main {:?} and sum {:?} overlap", main.body, sum.body);
        // (d) `$main` owns the program's `Halt`; `sum` owns a `Ret`.
        assert!(main.body.iter().any(|&i| prog.code[i] == Instr::Halt), "main body should contain the Halt");
        assert!(!sum.body.iter().any(|&i| prog.code[i] == Instr::Halt), "sum body must NOT contain the Halt");
        assert!(sum.body.iter().any(|&i| prog.code[i] == Instr::Ret), "sum body should contain a Ret");
        // The resume label `skip1` is `$main`'s, not `sum`'s (the misattribution the old slice hit).
        assert!(main.internal_labels.iter().any(|(n, _)| n == "skip1"));
        assert!(!sum.internal_labels.iter().any(|(n, _)| n == "skip1"));
    }

    #[test]
    fn partitions_a_multi_fn_higher_order_program_into_disjoint_bodies() {
        // A higher-order program: `map` takes a function `f`. `lower_asm` rejects it directly (a
        // function-as-value), so defunctionalize first — yielding THREE inline subroutines
        // (`$apply1.*`, `map.*`, plus `$main`), each guarded by its own jump-over. Every fn entry
        // must partition into a disjoint body.
        let src = "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
                   fn add1(x) { x + 1 } [1, 2].map(add1)";
        let core = desugar(&parse(src).0.unwrap());
        let prog = match lower_asm(&core) {
            Ok(p) => p,
            Err(_) => lower_asm(&defunc(&core).expect("defunctionalizes")).expect("lowers after defunc"),
        };
        let subs = partition(&prog).unwrap();

        // At least $main + two lowered functions (map + the $applyN dispatcher).
        assert!(
            subs.len() >= 3,
            "expected $main plus multiple fns, got {:?}",
            subs.iter().map(|s| &s.name).collect::<Vec<_>>()
        );
        assert!(subs.iter().any(|s| s.name == "$main"));
        assert!(subs.iter().any(|s| s.name.starts_with("map")));

        // Every pair of subroutine bodies is disjoint (the whole point of reachability partitioning).
        for a in 0..subs.len() {
            let sa: BTreeSet<usize> = subs[a].body.iter().copied().collect();
            for b in (a + 1)..subs.len() {
                assert!(
                    subs[b].body.iter().all(|i| !sa.contains(i)),
                    "bodies of `{}` and `{}` overlap: {:?} vs {:?}",
                    subs[a].name,
                    subs[b].name,
                    subs[a].body,
                    subs[b].body
                );
            }
        }

        // Exactly one subroutine owns the program's single `Halt` (it is `$main`).
        let halt_owners: Vec<&str> = subs
            .iter()
            .filter(|s| s.body.iter().any(|&i| prog.code[i] == Instr::Halt))
            .map(|s| s.name.as_str())
            .collect();
        assert_eq!(halt_owners, vec!["$main"]);
    }

    #[test]
    fn a_non_main_subroutine_containing_halt_is_unsupported() {
        // main: call f; li rr, 99; halt   |   f: li rr, 7; halt.
        // `f` (a `Call` target, entry 3) contains a `Halt`. Under `run_asm` that `Halt` ends the
        // whole program with rr==7; a native function compiled for `f` could only `return` to the
        // caller (yielding the wrong rr==99). `partition` must reject it loudly, not silently
        // miscompile. (`lower_asm` never emits `Halt` outside `$main`, so real output is unaffected.)
        let prog = Program {
            code: vec![
                Instr::Call("f".into()),
                Instr::Li(Reg::Rr, 99),
                Instr::Halt,
                Instr::Li(Reg::Rr, 7),
                Instr::Halt,
            ],
            labels: vec![("f".into(), 3)],
        };
        assert!(matches!(partition(&prog), Err(LowerError::Unsupported { .. })));
    }

    #[test]
    fn undefined_call_target_is_unsupported_not_a_panic() {
        let prog = Program { code: vec![Instr::Call("missing".into()), Instr::Halt], labels: vec![] };
        assert!(matches!(partition(&prog), Err(LowerError::Unsupported { .. })));
    }

    #[test]
    fn undefined_jump_target_is_unsupported_not_a_panic() {
        let prog = Program { code: vec![Instr::Jmp("nowhere".into())], labels: vec![] };
        assert!(matches!(partition(&prog), Err(LowerError::Unsupported { .. })));
    }

    #[test]
    fn control_flow_past_end_of_code_is_unsupported_not_a_panic() {
        // A `Bin` at the last index falls through to `code.len()` — no terminator. Reachability must
        // fault defensively, never index out of bounds.
        let prog = Program { code: vec![Instr::Bin(BinOp::Add, Reg::Rr, Reg::Arg(0), Reg::Arg(0))], labels: vec![] };
        assert!(matches!(partition(&prog), Err(LowerError::Unsupported { .. })));
    }

    #[test]
    fn overlapping_subroutine_bodies_are_unsupported_not_silently_merged() {
        // main falls through (no guard Jmp) directly into index 1, which is ALSO `f`'s Call-target
        // entry. `lower_asm` never produces this (every inline fn body is guarded by an
        // unconditional `Jmp` over it), but `partition` must defend against a hand-built/adversarial
        // `Program` where it happens, rather than silently emitting two overlapping subroutines.
        let prog = Program {
            code: vec![
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Arg(0), Reg::Arg(0)), // 0  main
                Instr::Ret,                                                // 1  f's entry (overlaps main.body)
                Instr::Call("f".into()),                                   // 2  (dead, but registers `f`)
                Instr::Halt,                                               // 3
            ],
            labels: vec![("f".into(), 1)],
        };
        assert!(matches!(partition(&prog), Err(LowerError::Unsupported { .. })));
    }
}
