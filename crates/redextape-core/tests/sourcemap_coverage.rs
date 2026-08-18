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
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

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

/// The first node (in an unspecified but deterministic order) matching `pred`, for the hand-checked
/// span fixtures below. Iterative, like every other `Core` walk in this suite.
fn find_first<'a>(core: &'a Core, pred: &dyn Fn(&Core) -> bool) -> Option<&'a Core> {
    let mut stack = vec![core];
    while let Some(n) = stack.pop() {
        if pred(n) {
            return Some(n);
        }
        n.for_each_child(&mut |c| stack.push(c));
    }
    None
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
///   (the `if src != dst` in `lower_asm.rs`'s `lower_inner`, in its `Core::Var` arm) — emits nothing,
///   not even a `Mov`. `dst` only ever equals a variable's own slot while lowering the value of an
///   `Assign` to that same name (`Assign` looks the slot up and lowers its value straight into it),
///   and that identity survives being handed down through `If`'s branches, a non-shadowing
///   `Let`/`LetRec`/`LetRecGroup` body, or `Seq`'s second half — every other position (a
///   `BinOp`/`Apply`/`While` operand, an `Assign`'s own destination, a fresh `Let` binder's value slot)
///   always lowers into a brand-new register, so the identity cannot survive into it. `target_name`
///   below tracks exactly this propagation; every other `Var` emits `Mov`/`Nil`.
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
///
/// THE `lower_asm.rs` POINTER IN THE `Var` BULLET READ line 321 UNTIL THIS COMMIT, AND IT WAS ALREADY
/// WRONG THE DAY IT LANDED. `if src != dst` was exactly line 321 at the parent of `9fbd911` — but
/// `9fbd911`, the commit that added this file, also replaced the `unwrap`s in `Ctx::bind` and
/// `Ctx::bind_fn` with `if let` for the no-panic rule, adding seven lines above the guard. The
/// citation shipped seven lines short of the thing it named, inside the commit that wrote it.
/// `clippy::pedantic` (#31) then moved it 35 further, so the guard now sits where the `Var` bullet
/// above names it, in `lower_inner`'s `Core::Var` arm; this conversion found 321 holding a `"$box"` arm
/// of `lower_builtin_apply`, a different function. A coordinate can be stale before it is even pushed;
/// a symbol cannot.
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

/// Every node the desugar mints resolves to a span, and every span is inside the source. Synthesized
/// nodes — the `Core::Unit` of a tail-less block, `LetRecGroup` scaffolding — inherit the nearest
/// enclosing expression's span rather than mapping to nothing: a highlighter wants the construct that
/// CAUSED the lowering, and `None` would leave holes exactly where the interesting lowering happened.
#[test]
fn every_core_node_resolves_to_an_in_bounds_source_span() {
    for src in BOTH_BACKENDS {
        let (program, _) = redextape_core::parser::parse(src);
        let Some(program) = program else { continue };
        let (core, spans) = redextape_core::desugar::desugar_mapped(&program);
        let by_id: std::collections::BTreeMap<_, _> = spans.into_iter().collect();

        for id in all_ids(&core) {
            let span = by_id.get(&id).unwrap_or_else(|| panic!("{src:?}: node {id} has no source span"));
            assert!(span.end <= src.len(), "{src:?}: node {id} span {span:?} past end of {} bytes", src.len());
            assert!(span.start <= span.end, "{src:?}: node {id} span {span:?} is inverted");
        }
    }
}

/// `build_from_program` is the only way to get the source leg, and it owns both sides so they cannot
/// disagree. `build` stays total and simply has no source leg — the same shape it already uses for a λ
/// backend that declines.
#[test]
fn build_from_program_populates_the_source_leg_and_build_does_not() {
    let src = "let x = 40; x + 2";
    let (program, _) = redextape_core::parser::parse(src);
    let program = program.expect("parses");
    let enc = redextape_core::tm::encoding::Unary::at(64);

    let (core, mapped) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &enc);
    assert!(!mapped.node_to_source.is_empty(), "build_from_program must fill the source leg");
    assert!(mapped.source_span(core.id()).is_some(), "the root must resolve");

    let plain = redextape_core::sourcemap::SourceMap::build(&core, &enc);
    assert!(plain.node_to_source.is_empty(), "build has no Program and must leave the leg empty");
    assert_eq!(plain.node_to_lambda, mapped.node_to_lambda, "the other legs must be identical");
    assert_eq!(plain.node_to_tm, mapped.node_to_tm, "the other legs must be identical");
}

/// Hand-checked, because "every node has SOME in-bounds span" (the test above) cannot catch a
/// plausible-but-wrong attribution — only a pinned example can. This one exercises the two synthesized
/// constructs where "the nearest enclosing expression" was a genuine judgment call rather than a
/// mechanical read of an AST field:
///
/// * `LetRecGroup`'s own id has no single member that owns it, so it inherits the HULL of the cycle's
///   own members' spans (the smallest `Span` covering both), not the whole block. This fixture puts the
///   unrelated `fn indep` BEFORE the cycle, which is the one arrangement where that hull happens to be
///   exactly the two members and nothing more — see
///   `letrecgroup_span_is_the_hull_and_can_cover_an_interleaved_non_member` below for the arrangement
///   where it is not.
/// * The `Seq` folded onto an `Assign`/`While` statement has no `Expr` of its own either — it is glue
///   between "do this statement" and "then do the rest" — so it is taken to mean the STATEMENT's span,
///   which is strictly more precise than falling all the way back to the enclosing block.
#[test]
fn letrecgroup_and_statement_seq_spans_are_precise_not_block_wide() {
    let src = "fn indep(n) { n } fn a(m) { b(m) } fn b(m) { a(m) } n = 1; while n < 3 { n = n + 1; } indep(1) + a(2)";
    let (program, ds) = redextape_core::parser::parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let (core, spans) = redextape_core::desugar::desugar_mapped(&program.expect("parses"));
    let by_id: std::collections::BTreeMap<_, _> = spans.into_iter().collect();

    // `a` and `b` call each other and sit back-to-back in the run, right after the unrelated `indep`.
    let ab = "fn a(m) { b(m) } fn b(m) { a(m) }";
    let ab_start = src.find(ab).expect("fixture contains a and b back to back");
    let group = find_first(&core, &|n| matches!(n, Core::LetRecGroup(..))).expect("expected a LetRecGroup");
    let group_span = by_id.get(&group.id()).copied().expect("the group has a span");
    assert_eq!(
        (group_span.start, group_span.end),
        (ab_start, ab_start + ab.len()),
        "the LetRecGroup must span exactly its own two members ({ab:?}), not the preceding `fn indep` \
         and not the trailing tail"
    );

    let assign_seq =
        find_first(&core, &|n| matches!(n, Core::Seq(_, first, _) if matches!(first.as_ref(), Core::Assign(..))))
            .expect("expected the Seq wrapping the assign statement");
    let assign_span = by_id.get(&assign_seq.id()).copied().expect("the assign's Seq has a span");
    assert_eq!(&src[assign_span.start..assign_span.end], "n = 1;", "the assign's Seq must span just that statement");

    let while_seq =
        find_first(&core, &|n| matches!(n, Core::Seq(_, first, _) if matches!(first.as_ref(), Core::While(..))))
            .expect("expected the Seq wrapping the while statement");
    let while_span = by_id.get(&while_seq.id()).copied().expect("the while's Seq has a span");
    assert_eq!(
        &src[while_span.start..while_span.end],
        "while n < 3 { n = n + 1; }",
        "the while's Seq must span just that statement, not the rest of the block"
    );
}

/// Finding 1's fix: attribution is unchanged (a `LetRecGroup`'s span is still the hull of its members'
/// own spans), but that is a HULL, not a SET — `Span` is one contiguous `[start, end)` range, so it
/// cannot exclude anything sitting inside that range. Put an unrelated `fn indep` BETWEEN the two cycle
/// members instead of before them (the arrangement the test above uses, where the hull happens to be
/// tight) and the hull has no choice but to cover it: the group's span becomes exactly the whole
/// three-`fn` run, `indep` included. That is a direct, unavoidable consequence of representing the
/// attribution as a single `Span` rather than a set of spans — not a bug in the merge.
#[test]
fn letrecgroup_span_is_the_hull_and_can_cover_an_interleaved_non_member() {
    let src = "fn a(m) { b(m) } fn indep(n) { n } fn b(m) { a(m) } indep(1) + a(2)";
    let (program, ds) = redextape_core::parser::parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let (core, spans) = redextape_core::desugar::desugar_mapped(&program.expect("parses"));
    let by_id: std::collections::BTreeMap<_, _> = spans.into_iter().collect();

    // The whole run: `a`, then the unrelated `indep`, then `b` — `a` and `b` still call each other.
    let whole_run = "fn a(m) { b(m) } fn indep(n) { n } fn b(m) { a(m) }";
    let run_start = src.find(whole_run).expect("fixture contains the three-fn run");
    let group = find_first(&core, &|n| matches!(n, Core::LetRecGroup(..))).expect("expected a LetRecGroup");
    let group_span = by_id.get(&group.id()).copied().expect("the group has a span");
    assert_eq!(
        &src[group_span.start..group_span.end],
        whole_run,
        "the hull of `a` and `b`'s spans covers the interleaved `fn indep` sitting between them, so it \
         IS the whole run here — not because the group grew to include `indep`, but because a single \
         Span cannot express the hole `indep` would need"
    );
    assert_eq!((group_span.start, group_span.end), (run_start, run_start + whole_run.len()));
}

/// The other synthesized-node judgment calls: a tail-less block's `Core::Unit` is scoped to THAT
/// block, not to whatever encloses it (pinning that "nearest enclosing" means the nearest one, not the
/// outermost one); a list literal's synthetic `nil` inherits the whole list literal's span (its `cons`
/// cells instead inherit their own element's span — the one case where "nearest enclosing" and "what
/// produced this node" diverge, pinned separately below by
/// `list_literal_cons_cells_point_at_their_own_elements`); and a UFCS method call's synthesized callee
/// `Var` (the method name has no span of its own in this AST) inherits the whole call's span.
#[test]
fn synthesized_leaves_inherit_the_span_of_what_caused_them() {
    // `fn f(n) { n; }`: the OUTER program block is itself tail-less (just one `fn` statement), and so
    // is `f`'s BODY (it ends in `n;`, not a tail) — two distinct `Core::Unit`s, at two distinct spans,
    // which is exactly the case a program-wide fallback would get wrong.
    let src = "fn f(n) { n; }";
    let (program, ds) = redextape_core::parser::parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let (core, spans) = redextape_core::desugar::desugar_mapped(&program.expect("parses"));
    let by_id: std::collections::BTreeMap<_, _> = spans.into_iter().collect();

    let Core::LetRec { value, body: outer_unit, .. } = &core else {
        panic!("expected an outer LetRec for `f`, got {core:?}")
    };
    assert!(matches!(outer_unit.as_ref(), Core::Unit(..)), "the tail-less program block needs a Unit");
    let outer_span = by_id.get(&outer_unit.id()).copied().expect("the outer Unit has a span");
    assert_eq!(
        (outer_span.start, outer_span.end),
        (0, src.len()),
        "the outer block's Unit must span the whole (tail-less) program"
    );

    let Core::Lambda(_, _, lambda_body) = value.as_ref() else { panic!("expected a Lambda value, got {value:?}") };
    let Core::Seq(_, _, inner_unit) = lambda_body.as_ref() else {
        panic!("expected `f`'s body to lower to a Seq ending in a Unit, got {lambda_body:?}")
    };
    let inner_span = by_id.get(&inner_unit.id()).copied().expect("the inner Unit has a span");
    // The expected string looks odd — it starts mid-statement, past the `{` — because `Block.span` is
    // itself asymmetric: `parse_block_body` (parser.rs) takes `start` from the first token AFTER `{`
    // (never the brace) and `end` from the token the loop stops ON, which for a nested block is `}`
    // itself. So a block's span starts just past its opening brace but ends ON, not past, its closing
    // one. That is a PARSER-side observation, not the highlight this desugar pass intends — this
    // `Core::Unit` is still correctly scoped to `f`'s body, just through a span whose own edges are
    // uneven. Not something to fix here.
    assert_eq!(
        &src[inner_span.start..inner_span.end],
        "n; }",
        "`f`'s body's Unit must span just `f`'s BODY block, not the whole (differently-tail-less) program"
    );

    // `[1, 2]`: `nil` has no source text of its own — it marks the literal's END, not any element —
    // so it inherits the whole literal. (Its `cons` cells are the divergent case, and get their own
    // dedicated fixture below rather than being checked here.)
    let list_src = "[1, 2]";
    let (list_program, ds) = redextape_core::parser::parse(list_src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let (list_core, list_spans) = redextape_core::desugar::desugar_mapped(&list_program.expect("parses"));
    let list_by_id: std::collections::BTreeMap<_, _> = list_spans.into_iter().collect();
    let nil = find_first(&list_core, &|n| matches!(n, Core::Var(_, name) if name == "nil")).expect("expected `nil`");
    let nil_span = list_by_id.get(&nil.id()).copied().expect("`nil` has a span");
    assert_eq!(&list_src[nil_span.start..nil_span.end], list_src, "`nil` must inherit the whole list literal");

    // `helper(1).double()`: the synthesized UFCS callee `Var("double")` inherits the whole method-call
    // span. `helper` (a plain `Call`, whose callee `Var` keeps its own real, narrow span) is there so
    // the search below has only one `Var("double")` to find — nothing else in this fixture is named
    // `double`, so there is no ambiguity between a real callee span and a synthesized one to sort out.
    let method_src = "fn helper(x) { x } fn double(x) { x + x } helper(1).double()";
    let (method_program, ds) = redextape_core::parser::parse(method_src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let (method_core, method_spans) = redextape_core::desugar::desugar_mapped(&method_program.expect("parses"));
    let method_by_id: std::collections::BTreeMap<_, _> = method_spans.into_iter().collect();
    let whole_call = "helper(1).double()";
    let call_start = method_src.find(whole_call).expect("fixture contains the call");
    let callee =
        find_first(&method_core, &|n| matches!(n, Core::Var(_, name) if name == "double")).expect("expected `double`");
    let callee_span = method_by_id.get(&callee.id()).copied().expect("the callee `Var` has a span");
    assert_eq!(
        (callee_span.start, callee_span.end),
        (call_start, call_start + whole_call.len()),
        "the UFCS callee must inherit the whole method-call span, not just the method name"
    );
}

/// The list-literal `cons`-cell divergence `desugar_mapped`'s doc calls out: each cell answers "what
/// element produced this node", not "which literal contains it". The OLD behaviour attributed every
/// cell to the whole literal, so a three-element list produced three IDENTICAL spans — and every test
/// committed at the time passed, because none of them checked for distinctness, only for "in bounds"
/// (`every_core_node_resolves_to_an_in_bounds_source_span`) or for a single hand-picked cell
/// (`synthesized_leaves_inherit_the_span_of_what_caused_them`, before this commit). So the load-bearing
/// assertion here is that the three spans DIFFER from each other, not merely that each one is valid.
#[test]
fn list_literal_cons_cells_point_at_their_own_elements() {
    let src = "[1, 2, 3]";
    let (program, ds) = redextape_core::parser::parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let (core, spans) = redextape_core::desugar::desugar_mapped(&program.expect("parses"));
    let by_id: std::collections::BTreeMap<_, _> = spans.into_iter().collect();

    // cons(1, cons(2, cons(3, nil))): walk the spine directly (rather than searching) so which
    // `Apply`/`Var` is cons_1 vs cons_3 is unambiguous — the desugar arm builds it outer-to-inner in
    // first-to-last element order, so the root `Apply` is cons_1.
    let Core::Apply(cons1_id, callee1, args1) = &core else {
        panic!("expected the outermost cons Apply, got {core:?}")
    };
    let Core::Var(callee1_id, name1) = callee1.as_ref() else {
        panic!("expected the outermost cons Var, got {callee1:?}")
    };
    assert_eq!(name1, "cons");
    let [_, rest1] = args1.as_slice() else { panic!("expected two args, got {args1:?}") };

    let Core::Apply(cons2_id, callee2, args2) = rest1 else { panic!("expected the middle cons Apply, got {rest1:?}") };
    let Core::Var(callee2_id, name2) = callee2.as_ref() else {
        panic!("expected the middle cons Var, got {callee2:?}")
    };
    assert_eq!(name2, "cons");
    let [_, rest2] = args2.as_slice() else { panic!("expected two args, got {args2:?}") };

    let Core::Apply(cons3_id, callee3, args3) = rest2 else {
        panic!("expected the innermost cons Apply, got {rest2:?}")
    };
    let Core::Var(callee3_id, name3) = callee3.as_ref() else {
        panic!("expected the innermost cons Var, got {callee3:?}")
    };
    assert_eq!(name3, "cons");
    let [_, nil_node] = args3.as_slice() else { panic!("expected two args, got {args3:?}") };
    let Core::Var(nil_id, nil_name) = nil_node else { panic!("expected the nil Var, got {nil_node:?}") };
    assert_eq!(nil_name, "nil");

    let span1 = by_id.get(cons1_id).copied().expect("cons_1's Apply has a span");
    let span2 = by_id.get(cons2_id).copied().expect("cons_2's Apply has a span");
    let span3 = by_id.get(cons3_id).copied().expect("cons_3's Apply has a span");
    let nil_span = by_id.get(nil_id).copied().expect("nil has a span");

    assert_eq!(&src[span1.start..span1.end], "1", "cons_1's Apply must point at its own element, `1`");
    assert_eq!(&src[span2.start..span2.end], "2", "cons_2's Apply must point at its own element, `2`");
    assert_eq!(&src[span3.start..span3.end], "3", "cons_3's Apply must point at its own element, `3`");
    assert_eq!(&src[nil_span.start..nil_span.end], src, "`nil` must still point at the whole literal");

    // Each cell's callee `Var` must match its own `Apply` — both were minted from the same
    // `elem_span`, not just one of the pair.
    assert_eq!(by_id.get(callee1_id).copied(), Some(span1), "cons_1's callee Var must match its Apply's span");
    assert_eq!(by_id.get(callee2_id).copied(), Some(span2), "cons_2's callee Var must match its Apply's span");
    assert_eq!(by_id.get(callee3_id).copied(), Some(span3), "cons_3's callee Var must match its Apply's span");

    // The load-bearing check: three DISTINCT spans, not merely three in-bounds ones.
    assert_ne!(span1, span2, "cons_1 and cons_2 must not share a span");
    assert_ne!(span2, span3, "cons_2 and cons_3 must not share a span");
    assert_ne!(span1, span3, "cons_1 and cons_3 must not share a span");
}

/// Finding 7: `desugar.rs` deliberately preserves `NodeId` ALLOCATION ORDER — every id-minting site
/// reads its own id BEFORE lowering its children, a single constructor call's arguments evaluating left
/// to right — because ids are the join key `node_to_lambda` and `node_to_tm` resolve through. A site
/// that instead minted its id AFTER lowering its children would produce an equally well-formed `Core`
/// (every id still unique, every tree still shaped the same), just with each affected node's id shifted
/// to wherever `NodeGen` happened to be once its children were done — silently re-pointing both legs at
/// different constructs while nothing else notices, because nothing else compares ids across two
/// orderings. `a_known_node_maps_to_its_exact_state_block` runs on `"3 - 5"`, which has none of the five
/// order-sensitive sites below, so it does not guard this.
///
/// One fixture exercises all five (see `desugar.rs`'s `Stmt::Assign`/`Stmt::While` arms of
/// `lower_stmts_at`, the `[i]` and multi-member arms of `lower_fn_run_at`, and the `Expr::Lambda` arm of
/// `lower_expr_at`) and pins the exact id each one gets. The values below were read off one known-good
/// run of this exact fixture (`cargo test -p redextape-core --test sourcemap_coverage`), not computed by
/// hand — see the commit that added this test for the reorder-and-observe-a-failure demonstration.
#[test]
fn node_id_allocation_order_is_pinned_for_every_mint_before_children_site() {
    let src = "fn helper(x) { x }\nfn a(m) { b(m) }\nfn b(m) { a(m) }\nlet mut n = 0;\nn = 1;\n\
               while n < 3 { n = n + 1; }\nlet f = |y| y + 1;\nf(n)";
    let (program, ds) = redextape_core::parser::parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = redextape_core::desugar::desugar(&program.expect("parses"));

    // `fn helper` groups with nothing (no cycle), so it stays a singleton LetRec at the root, wrapping
    // the LetRecGroup for the `a`/`b` cycle that follows it in the same run.
    let Core::LetRec { id: helper_letrec_id, value: helper_value, body: after_helper, .. } = &core else {
        panic!("expected the outer LetRec for `helper`, got {core:?}");
    };
    let Core::Lambda(helper_lam_id, ..) = helper_value.as_ref() else {
        panic!("expected `helper`'s value to be a Lambda, got {helper_value:?}");
    };

    let Core::LetRecGroup(_, bindings, after_group) = after_helper.as_ref() else {
        panic!("expected a LetRecGroup for the `a`/`b` cycle, got {after_helper:?}");
    };
    let [(name_a, lambda_a), (name_b, lambda_b)] = bindings.as_slice() else {
        panic!("expected exactly two group members, got {bindings:?}");
    };
    let Core::Lambda(lam_a_id, ..) = lambda_a else { panic!("expected a Lambda for `a`, got {lambda_a:?}") };
    let Core::Lambda(lam_b_id, ..) = lambda_b else { panic!("expected a Lambda for `b`, got {lambda_b:?}") };

    let Core::Let { body: after_n, .. } = after_group.as_ref() else {
        panic!("expected the `let mut n = 0;` Let, got {after_group:?}");
    };
    let Core::Seq(_, assign_n1, after_assign) = after_n.as_ref() else {
        panic!("expected the Seq wrapping `n = 1;`, got {after_n:?}");
    };
    let Core::Assign(assign_id, ..) = assign_n1.as_ref() else {
        panic!("expected an Assign for `n = 1;`, got {assign_n1:?}");
    };

    let Core::Seq(_, while_node, after_while) = after_assign.as_ref() else {
        panic!("expected the Seq wrapping the while loop, got {after_assign:?}");
    };
    let Core::While(while_id, ..) = while_node.as_ref() else { panic!("expected a While, got {while_node:?}") };

    let Core::Let { value: f_value, .. } = after_while.as_ref() else {
        panic!("expected the Let for `f`, got {after_while:?}");
    };
    let Core::Lambda(expr_lambda_id, ..) = f_value.as_ref() else {
        panic!("expected `f`'s value to be a Lambda, got {f_value:?}");
    };

    assert_eq!(name_a, "a");
    assert_eq!(name_b, "b");
    // Each assertion below stands alone: reordering one mint site changes only ITS OWN id and the ids of
    // the children it wraps (they shift into the numbers the site's own mint vacated) — `NodeGen`'s
    // total call count is unchanged, so every other construct's own id, including ones minted later in
    // program order, keeps its value. Any one of these seven failing already pins the reorder to a
    // specific site.
    assert_eq!(*helper_lam_id, 33, "singleton Stmt::Fn lambda (`helper`)'s id");
    assert_eq!(*helper_letrec_id, 35, "the LetRec wrapping `helper` mints AFTER `helper`'s body lowers");
    assert_eq!(*lam_a_id, 24, "group-member lambda (`a`)'s id");
    assert_eq!(*lam_b_id, 28, "group-member lambda (`b`)'s id");
    assert_eq!(*assign_id, 19, "Stmt::Assign (`n = 1;`)'s id");
    assert_eq!(*while_id, 8, "Stmt::While's id");
    assert_eq!(*expr_lambda_id, 3, "Expr::Lambda (`|y| y + 1`)'s id");
}
