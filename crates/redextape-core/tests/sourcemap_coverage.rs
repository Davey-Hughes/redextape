//! §10.4: every Core node maps into BOTH backends — with the exclusions the module doc of
//! `sourcemap.rs` spells out, each pinned here rather than papered over.
//!
//! The TM half's claim is deliberately NOT "every node has a state block". `lower_asm` emits no
//! instruction at all for a transparent binder, so demanding a block for one can only be satisfied by
//! inventing an owner — which is exactly the fallback this suite exists to forbid. The claim is
//! "every node OF A KIND THAT EMITS CODE has a non-empty block", and its complement
//! (`transparent_nodes_map_to_none`) is asserted just as hard: an empty map would fail the first test
//! and a nearest-ancestor fallback would fail the second, so neither half can go vacuous alone.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use redextape_core::core::{Core, NodeId};
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{Unary, lower_asm};

mod common;
use common::core_of;

/// First-order demos, copied from `examples/tm_demo.rs`'s `first_order` array, plus three programs
/// that array does not contain: a `Let`-bound lambda and a mutually recursive group, each nested under
/// an outer `let` so the construct itself is NOT the root (the root always emits regardless of what
/// `classify` says about its kind — see `classify`'s doc — so a root example cannot pin these arms);
/// and a self-assigning `Var` that exercises `lower_asm`'s `src == dst` short-circuit through an `If`.
/// Both backends accept all of these, so both halves of the map must cover them.
const BOTH_BACKENDS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "[1, 2, 3]",
    "head(cons(1, cons(2, nil)))",
    "let a = 1; let f = |x| x + 1; f(2) + a",
    "let a = 1; fn even(n) { if n == 0 { 1 } else { odd(n - 1) } } \
     fn odd(n) { if n == 0 { 0 } else { even(n - 1) } } even(4) + a",
    "let mut x = 1; x = if x > 0 { x } else { 0 }; x",
];

/// Higher-order demos, from `examples/tm_demo.rs`'s `higher_order` array. EVERY ONE of these is
/// rejected by `lower_asm` and reaches the TM half only through `defunc` — which is the point: a
/// corpus that is entirely first-order never runs `tm_half`'s defunc branch, and an invariant that
/// holds only on the direct path (such as "the root is always covered") looks true forever. The λ
/// backend accepts all four, so the λ half is still exhaustive for them; the TM half is NOT, because
/// `defunc` rewrites the tree and a node it dissolves has no lowering left to point at.
const HIGHER_ORDER: &[&str] = &[
    "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
     fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
    "let n = 5; fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
     [1, 2, 3].map(|x| x + n)",
    "fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)",
];

/// Every `NodeId` appearing anywhere in the tree. Iterative on purpose — see the note below.
fn all_ids(core: &redextape_core::core::Core) -> Vec<u32> {
    let mut out = Vec::new();
    let mut stack = vec![core];
    while let Some(n) = stack.pop() {
        out.push(n.id());
        n.for_each_child(&mut |c| stack.push(c));
    }
    out
}

/// Split every node into (emits at least one instruction of its own, emits none), by the rule
/// `lower_asm::lower_inner` actually follows: an instruction is billed to `ctx.current`, which each
/// `lower_into` sets to the node it is lowering, so a node "emits code" iff its own arm calls
/// `ctx.emit`/`lower_function*` outside of a nested `lower_into`. Reading it off that function:
///
/// * `Lambda` — never reaches `lower_into` at all in a program that lowers. The `Let`/`LetRec` arms
///   destructure its params and body and lower the BODY under its own id; a `Lambda` that does reach
///   `lower_into` is a function-as-a-value, i.e. `Unsupported`, i.e. no lowering to map.
/// * `Seq` — two `lower_into` calls and nothing else.
/// * `Let` with a non-`Lambda` value (mutable or not) — a register allocation, then two `lower_into`
///   calls. The binder itself is free. A `Let` whose value IS a `Lambda` takes the
///   `lower_function` path instead and emits that subroutine's `jmp`/`mov`/`ret` under the LET's id.
/// * the callee `Var` of an `Apply` — read off as a label by the `Apply` arm (user function OR
///   builtin), never lowered into a register.
/// * a non-callee `Var` whose resolved register is the SAME register `lower_into` is asked to fill
///   (`lower_asm.rs:321`'s `if src != dst`) — emits nothing, not even a `Mov`. `dst` only ever equals a
///   variable's own slot while lowering the value of an `Assign` to that same name (`Assign` looks the
///   slot up and lowers its value straight into it), and that identity survives being handed down
///   through `If`'s branches, a non-shadowing `Let`/`LetRec`/`LetRecGroup` body, or `Seq`'s second half
///   — every other position (a `BinOp`/`Apply`/`While` operand, an `Assign`'s own destination, a fresh
///   `Let` binder's value slot) always lowers into a brand-new register, so the identity cannot survive
///   into it. `target_name` below tracks exactly this propagation; every other `Var` emits `Mov`/`Nil`.
///
/// Everything else emits: `Nat`/`Bool`/`Unit` (`Li`), `BinOp` (`Bin`), `If` (`Jz`+`Jmp`), `While`
/// (`Jz`+`Jmp`+`Li`), `Assign` (`Li`), `Apply` (`Call` or a builtin instruction), `LetRec` /
/// `LetRecGroup` (the group's `jmp skip` and each body's `ret`).
///
/// THE ROOT ALWAYS EMITS, whatever its kind: `lower_asm_mapped` sets `ctx.current = core.id()` and
/// emits the program's terminating `Halt` itself, so a transparent construct at top level still owns
/// that one block. (This is the invariant `tm_half` used to lean on for its fallback — true here, and
/// false on the defunc path, where the root of the tree that gets lowered is `defunc`'s, not this one.)
///
/// Iterative, like every other `Core` walk — see `Core::for_each_child`'s doc.
fn classify(core: &Core) -> (Vec<NodeId>, Vec<NodeId>) {
    let (mut emits, mut transparent) = (Vec::new(), Vec::new());
    // Third field: `target_name`, `Some(x)` iff this node is lowered with `dst` == the register
    // `Assign(x, ..)` resolved for `x` — see `classify`'s doc's `Var` bullet. Only `Assign`'s `value`
    // starts a chain, and only `If`'s branches / a non-shadowing `Let`/`LetRec`/`LetRecGroup` body /
    // `Seq`'s second half carry it further; every other position resets it to `None` because that
    // position always lowers into a freshly allocated register instead.
    let mut stack: Vec<(&Core, bool, Option<&str>)> = vec![(core, false, None)];
    while let Some((n, is_callee, target_name)) = stack.pop() {
        let emits_here = n.id() == core.id()
            || match n {
                Core::Lambda(..) | Core::Seq(..) => false,
                Core::Var(_, name) => !is_callee && target_name != Some(name.as_str()),
                Core::Let { value, .. } => matches!(value.as_ref(), Core::Lambda(..)),
                _ => true,
            };
        if emits_here {
            emits.push(n.id())
        } else {
            transparent.push(n.id())
        }
        match n {
            // Not `for_each_child`: only here does the callee/argument distinction exist.
            Core::Apply(_, callee, args) => {
                stack.push((callee, true, None));
                stack.extend(args.iter().map(|a| (a, false, None)));
            }
            Core::Assign(_, name, value) => stack.push((value, false, Some(name.as_str()))),
            Core::If(_, c, t, e) => {
                stack.push((c, false, None));
                stack.push((t, false, target_name));
                stack.push((e, false, target_name));
            }
            Core::Seq(_, first, then) => {
                stack.push((first, false, None));
                stack.push((then, false, target_name));
            }
            Core::Let { name, value, body, .. } => {
                // A `Let`-bound lambda's name is a call label (`ctx.fn_scopes`), never a value slot
                // (`ctx.scopes`), so it cannot shadow `target_name` in `ctx.resolve`.
                let is_fn_let = matches!(value.as_ref(), Core::Lambda(..));
                let shadowed = !is_fn_let && target_name == Some(name.as_str());
                stack.push((value, false, None));
                stack.push((body, false, if shadowed { None } else { target_name }));
            }
            Core::LetRec { value, body, .. } => {
                // The bound name is a call label too, same as a `Let`-bound lambda: never shadows.
                stack.push((value, false, None));
                stack.push((body, false, target_name));
            }
            Core::LetRecGroup(_, bindings, body) => {
                stack.extend(bindings.iter().map(|(_, v)| (v, false, None)));
                stack.push((body, false, target_name));
            }
            _ => n.for_each_child(&mut |c| stack.push((c, false, None))),
        }
    }
    (emits, transparent)
}

#[test]
fn every_core_node_maps_into_both_backends() {
    for src in BOTH_BACKENDS {
        let core = core_of(src);
        // `classify` is honest only about the first-order path; a corpus entry that silently routes
        // through defunc would still pass the loop below (its TM keys would just be a subset of
        // `defunc`'s rewritten tree) with a misleading "inherited a TM block" failure mode instead.
        assert!(lower_asm(&core).is_ok(), "{src:?}: does not lower first-order, so `classify` is not valid for it");
        let map = SourceMap::build(&core, &Unary::default());
        for id in all_ids(&core) {
            assert!(map.lambda_path(id).is_some(), "{src:?}: node {id} has no lambda path");
        }
        let (emits, _) = classify(&core);
        assert!(!emits.is_empty(), "{src:?}: no node emits code — the TM half of this case is vacuous");
        for id in emits {
            let block = map.tm_block(id).unwrap_or(&[]);
            assert!(!block.is_empty(), "{src:?}: node {id} emits code but has an empty TM block");
        }
    }
}

/// The complement, and the regression guard for the fallback this module used to have: a node whose
/// lowering emitted nothing maps to `None`, NOT to the block of whatever encloses it. Deleting the
/// `emits_here` distinction cannot pass both this test and the one above.
#[test]
fn transparent_nodes_map_to_none() {
    let mut seen_kinds: Vec<&str> = Vec::new();
    for src in BOTH_BACKENDS {
        let core = core_of(src);
        let map = SourceMap::build(&core, &Unary::default());
        let (_, transparent) = classify(&core);
        for id in transparent {
            assert!(map.tm_block(id).is_none(), "{src:?}: transparent node {id} inherited a TM block");
        }
        let mut stack = vec![&core];
        while let Some(n) = stack.pop() {
            let kind = match n {
                Core::Lambda(..) => "Lambda",
                Core::Seq(..) => "Seq",
                Core::Let { value, .. } if !matches!(value.as_ref(), Core::Lambda(..)) => "Let",
                Core::Apply(_, callee, _) if matches!(callee.as_ref(), Core::Var(..)) => "callee Var",
                _ => "",
            };
            if !kind.is_empty() && !seen_kinds.contains(&kind) {
                seen_kinds.push(kind);
            }
            n.for_each_child(&mut |c| stack.push(c));
        }
    }
    // Naming the kinds explicitly: if a future lowering starts billing one of these, the assertion
    // above starts failing and this list says which construct changed meaning.
    seen_kinds.sort_unstable();
    assert_eq!(seen_kinds, ["Lambda", "Let", "Seq", "callee Var"], "the corpus must exercise every transparent kind");
}

/// Finding 3: the defunc branch of `tm_half`, which a first-order corpus never reaches. The two halves
/// are asserted SEPARATELY here — see `HIGHER_ORDER`'s doc for why the TM half cannot be exhaustive.
#[test]
fn higher_order_programs_exercise_the_defunc_branch() {
    for src in HIGHER_ORDER {
        let core = core_of(src);
        assert!(lower_asm(&core).is_err(), "{src:?}: lowers first-order, so it does not test the defunc branch");
        let map = SourceMap::build(&core, &Unary::default());
        let ids = all_ids(&core);
        for id in &ids {
            assert!(map.lambda_path(*id).is_some(), "{src:?}: node {id} has no lambda path");
        }
        assert!(!map.node_to_tm.is_empty(), "{src:?}: the TM half must be usable through defunc");
        for id in map.node_to_tm.keys() {
            // Every key is a node of the ORIGINAL program: the ids `defunc` minted are excluded, so a
            // consumer never gets a key it cannot resolve back to source. (Not asserting the block is
            // non-empty here: every value in `node_to_tm` is built by `or_default().push(..)`, so it
            // cannot be empty — that would be an assertion with no way to fail.)
            assert!(ids.contains(id), "{src:?}: TM key {id} is not a node of the source program");
        }
    }
}

/// Finding 5: a golden that pins the actual composition, not just its non-emptiness. Everything else
/// here checks *whether* a node has a block; this checks *which states* it has, so an off-by-one in
/// `origins.get(*code_index)` — the exact inversion this module exists to perform — fails a test.
///
/// `3 - 5` lowers to `Li(l0,3); Li(l1,5); Bin(Sub,rr,l0,l1); Halt`, so `origins` is
/// `[Nat(3), Nat(5), BinOp, BinOp]` and shifting the lookup by one silently re-bills every state to
/// the next instruction's node (and drops `Nat(3)` from the map entirely).
#[test]
fn a_known_node_maps_to_its_exact_state_block() {
    let core = core_of("3 - 5");
    let map = SourceMap::build(&core, &Unary::default());
    // Ids are minted left to right by `desugar`: 0 = `3`, 1 = `5`, 2 = the `BinOp` (the root).
    assert!(matches!(&core, Core::BinOp(2, ..)), "the golden assumes this exact id assignment");
    assert_eq!(map.tm_block(0), Some([2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].as_slice()), "the `3` literal");
    assert_eq!(
        map.tm_block(1),
        Some([3, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29].as_slice()),
        "the `5` literal"
    );
    // The root's block starts with the two states that decode the operands and ends at the `Halt`.
    let root = map.tm_block(2).expect("the BinOp emits `Bin` and the program's `Halt`");
    assert_eq!(root.first(), Some(&4), "the `Bin` instruction's first state");
    assert_eq!(root.last(), Some(&59), "the trailing `Halt`");
    assert_eq!(root.len(), 32, "the `Bin` block plus the `Halt` block");
}
