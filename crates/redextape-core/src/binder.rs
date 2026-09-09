//! Which binding each name in a `.rxt` document refers to.
//!
//! `.tm` and `.asm` resolve a name by looking it up in a flat table, which `NameIndex::link` does
//! for both. `.rxt` names are SCOPED: an occurrence resolves to a binding, and in
//! `let x = 1; let x = x + 1;` the two `x`es on the second line resolve to different ones. So this
//! is a pass and not a lookup, and it is why `.rxt` navigation is a separate piece of work from
//! the two forms that shipped first.
//!
//! **ITERATIVE, AND THE GUARANTEE IT CANNOT BORROW IS THE REASON.** `lints.rs`'s `check` walks the
//! same surface tree recursively, and its module doc records that this is safe only because both
//! of its callers run it AFTER typechecking has added no error-severity diagnostic — so
//! `MAX_TYPE_DEPTH` has already rejected anything nested deeper than a recursive walk survives.
//! Navigation runs BEFORE typechecking, on a tree that may not typecheck and, since `.rxt` gained
//! parse recovery, may not have parsed completely either. It cannot borrow that gate, and what it
//! would buy is not a diagnostic: a recursive walk over adversarial nesting is an uncatchable
//! native stack overflow that takes the editor's server process with it. The parser builds
//! left-nested `Binary`/`Call`/`Method` chains up to roughly `MAX_TOKENS`/2 deep — `ast.rs`'s
//! hand-written iterative `Drop` exists for exactly those — so the depth is reachable from
//! ordinary source. `desugar.rs`'s `free_member_refs` already walks this scoping shape over an
//! explicit worklist; this follows it rather than reinventing it.
//!
//! **THE RESOLUTION RULES ARE THE TYPECHECKER'S, NOT A SECOND READING OF THE GRAMMAR.** A jump
//! that disagrees with `typeck` is wrong rather than merely different, so each rule below names
//! the function it copies: `TyEnv::lookup`'s reverse scan for shadowing, `infer_stmt`'s `Let` arm
//! for a value that cannot see its own binding, `infer_block_inner` and `infer_fn_run` for the
//! mutually-recursive run, and `infer_stmt`'s `Assign` arm for a target that is a reference. One
//! divergence: `typeck` seeds its environment from `prelude::type_env()` (`nil`, `cons`, `head`,
//! `tail`, `is_empty`), and this pass starts from an empty chain. The binder's scope is therefore
//! a strict subset of typeck's, so this can never produce a WRONG jump — a builtin resolves to
//! nothing here, which is the right answer for a name with no definition in the source.

use crate::Span;
use crate::ast::{Block, Expr, Param, Program, Stmt, fn_run_at};
use crate::nav::{DefKind, NameIndex};

/// One binding in the shadow chain: `(enclosing scope, the name it binds, the event that defines
/// it)`. Scopes live in a flat arena addressed by index, and `ROOT` is an index no slot can have.
///
/// **PERSISTENT AND NEVER POPPED, WHICH IS WHAT LETS THE WALK BE OUT OF ORDER.** A mutable
/// push/pop scope stack needs the walk to visit in tree order; a worklist does not, so each work
/// item carries its own scope index instead. `free_member_refs`'s `Shadow` is the same structure
/// with one field fewer.
type Scope<'a> = (usize, &'a str, usize);
const ROOT: usize = usize::MAX;

/// One name occurrence, before it has an index. `Ref`'s `def` is an EVENT id, not an occurrence
/// index: occurrences are numbered only once the events are in source order.
enum Ev<'a> {
    Def { name: &'a str, span: Span, kind: DefKind, extent: Option<Span> },
    Ref { name: &'a str, span: Span, def: Option<usize> },
}

/// Worklist item. `Expr` and `Block` are mutually recursive, so one type is not enough — the same
/// reason `ast.rs`'s iterative `Drop` carries three.
enum Work<'a> {
    E(&'a Expr, usize),
    B(&'a Block, usize),
}

#[derive(Default)]
struct Binder<'a> {
    chain: Vec<Scope<'a>>,
    events: Vec<Ev<'a>>,
}

/// Every name written in one `.rxt` document, each reference pointed at the binding it resolves
/// to. `None` when the document was never parsed.
///
/// Built from `parse_for_nav`, never `parse` or `parse_full`: those answer `None` for exactly the
/// broken files navigation is worth most on. `parse_for_nav` rather than `parse_recovering`
/// because the two disagree in one case — above `MAX_TOKENS`, where `parse_recovering` answers an
/// empty tree and this must not answer an empty index, since an empty index is the claim that the
/// document contains no names.
#[must_use]
pub fn nav_rxt(src: &str) -> Option<NameIndex> {
    let (parsed, _diags) = crate::parser::parse_for_nav(src);
    let parsed = parsed?;
    let mut b = Binder::default();
    b.walk(&parsed.program);
    Some(b.finish())
}

impl<'a> Binder<'a> {
    /// Introduce `name`, and answer the scope that has it. Emits the definition event here, so a
    /// binding and the occurrence that records it cannot get out of step.
    fn bind(&mut self, scope: usize, name: &'a str, span: Span, kind: DefKind, extent: Option<Span>) -> usize {
        let ev = self.events.len();
        self.events.push(Ev::Def { name, span, kind, extent });
        self.chain.push((scope, name, ev));
        self.chain.len() - 1
    }

    /// The event that defines `name` at `scope`, or `None` when nothing does.
    ///
    /// Walks the chain to the root and takes the FIRST match, which is the innermost and latest
    /// binding — the same answer as `TyEnv::lookup`'s reverse scan over its stack. A loop, not
    /// recursion. Cost is the number of bindings in scope at this point — **not only nesting
    /// depth**: `block` threads `cur` across CONSECUTIVE statements, so a flat run of N `let`s at
    /// one nesting depth still produces a chain N deep. `resolve` returns on the FIRST match, so
    /// that N is a worst case, not every case: a miss, or a name bound near the root of the chain,
    /// walks all N, while the most recently bound name resolves after one link.
    ///
    /// `TyEnv::lookup` pays the same reverse scan, to the same depth, on every program that
    /// typechecks. `lints.rs`'s scope walk pays it too, but only when `check` runs at all, and its
    /// own module doc says that is after typechecking has added no error-severity diagnostic: a
    /// file that does not parse completely or does not typecheck cleanly — exactly the files this
    /// pass exists for — never reaches `lints.rs`, so this pass pays a cost there that `lints.rs`
    /// does not. It is written down because the obvious reading of an arena chain — that it holds
    /// only enclosing blocks — is the wrong one.
    fn resolve(&self, scope: usize, name: &str) -> Option<usize> {
        let mut cur = scope;
        // `get` answers `None` for `ROOT`, which ends the walk.
        while let Some(&(parent, bound, ev)) = self.chain.get(cur) {
            if bound == name {
                return Some(ev);
            }
            cur = parent;
        }
        None
    }

    /// Record a mention, resolved against `scope` as it is written.
    fn note(&mut self, scope: usize, name: &'a str, span: Span) {
        let def = self.resolve(scope, name);
        self.events.push(Ev::Ref { name, span, def });
    }

    fn params(&mut self, scope: usize, params: &'a [Param]) -> usize {
        let mut inner = scope;
        for p in params {
            inner = self.bind(inner, p.name.as_str(), p.span, DefKind::Param, None);
        }
        inner
    }
}

impl<'a> Binder<'a> {
    fn walk(&mut self, program: &'a Program) {
        let mut work = vec![Work::B(&program.block, ROOT)];
        while let Some(item) = work.pop() {
            match item {
                Work::E(e, scope) => self.expr(e, scope, &mut work),
                Work::B(b, scope) => self.block(b, scope, &mut work),
            }
        }
    }

    fn expr(&mut self, e: &'a Expr, scope: usize, work: &mut Vec<Work<'a>>) {
        match e {
            Expr::Nat { .. } | Expr::Bool { .. } | Expr::Error { .. } => {}
            Expr::Var { name, span } => self.note(scope, name.as_str(), *span),
            // A list literal's synthetic `cons`/`nil` are deliberately not references: `typeck`
            // types a list structurally without consulting either name, so recording them would
            // make navigation disagree with the scope the typechecker checked against.
            Expr::List { items, .. } => work.extend(items.iter().map(|i| Work::E(i, scope))),
            Expr::Binary { lhs, rhs, .. } => {
                work.push(Work::E(lhs, scope));
                work.push(Work::E(rhs, scope));
            }
            Expr::If { cond, then_blk, else_blk, .. } => {
                work.push(Work::E(cond, scope));
                work.push(Work::B(then_blk, scope));
                work.push(Work::B(else_blk, scope));
            }
            Expr::Block { block, .. } => work.push(Work::B(block, scope)),
            Expr::Lambda { params, body, .. } => {
                let inner = self.params(scope, params);
                work.push(Work::E(body, inner));
            }
            Expr::Call { callee, args, .. } => {
                work.push(Work::E(callee, scope));
                work.extend(args.iter().map(|a| Work::E(a, scope)));
            }
            Expr::Method { recv, name, name_span, args, .. } => {
                // UFCS: `recv.m(args)` is a reference to whatever `m` names in scope, which is how
                // `typeck` resolves it and how `free_member_refs` counts it.
                self.note(scope, name.as_str(), *name_span);
                work.push(Work::E(recv, scope));
                work.extend(args.iter().map(|a| Work::E(a, scope)));
            }
        }
    }

    /// Statements bind progressively: a `let`'s name covers the rest of the block but NOT its own
    /// value, which is why the value is pushed against the scope in hand before `bind` replaces it.
    fn block(&mut self, b: &'a Block, scope: usize, work: &mut Vec<Work<'a>>) {
        let mut cur = scope;
        let mut i = 0;
        while let Some(stmt) = b.stmts.get(i) {
            match stmt {
                Stmt::Fn { .. } => {
                    // The maximal run of consecutive `Stmt::Fn`, which is the unit
                    // `infer_block_inner` groups and `infer_fn_run` binds. Every name in the run
                    // is bound before ANY body is walked, so a member may forward-reference or
                    // mutually recurse with any other member; a non-`fn` statement ends the run
                    // and a `fn` after it starts a fresh one that the earlier run cannot see.
                    let range = fn_run_at(&b.stmts, i);
                    i = range.end;
                    let run = &b.stmts[range];
                    for stmt in run {
                        if let Stmt::Fn { name, name_span, span, .. } = stmt {
                            cur = self.bind(cur, name.as_str(), *name_span, DefKind::Fn, Some(*span));
                        }
                    }
                    for stmt in run {
                        if let Stmt::Fn { params, body, .. } = stmt {
                            // Each body gets its OWN parameter scope branching off the run's
                            // shared one, so one member's parameters never reach the next.
                            let inner = self.params(cur, params);
                            work.push(Work::B(body, inner));
                        }
                    }
                }
                Stmt::Let { name, name_span, span, value, .. } => {
                    work.push(Work::E(value, cur));
                    cur = self.bind(cur, name.as_str(), *name_span, DefKind::Let, Some(*span));
                    i += 1;
                }
                Stmt::Assign { target, target_span, value, .. } => {
                    // A REFERENCE, not a definition: `infer_stmt`'s `Assign` arm looks the target
                    // up and reports `unbound variable` when it is not there.
                    self.note(cur, target.as_str(), *target_span);
                    work.push(Work::E(value, cur));
                    i += 1;
                }
                Stmt::While { cond, body, .. } => {
                    work.push(Work::E(cond, cur));
                    work.push(Work::B(body, cur));
                    i += 1;
                }
                Stmt::Expr(e) => {
                    work.push(Work::E(e, cur));
                    i += 1;
                }
                // An error statement binds nothing and mentions nothing: the source it covers is
                // the source the parser could not read.
                Stmt::Error { .. } => {
                    i += 1;
                }
            }
        }
        if let Some(tail) = &b.tail {
            work.push(Work::E(tail, cur));
        }
    }
}

impl Binder<'_> {
    /// Order the events by position and hand them to `NameIndex`.
    ///
    /// **SOURCE ORDER IS A PROPERTY OF THIS SORT, NOT OF THE PUSH SITES.** `NameIndex::definitions`
    /// promises source order and `documentSymbol` renders it, but a worklist pops LIFO — the `if`
    /// arm above pushes `cond`, `then_blk`, `else_blk` and pops them backwards. The alternative was
    /// to push every child reversed so that pop order is source order, which is a discipline held
    /// at ten sites with nothing to enforce it, and getting it wrong is close to invisible: `at`
    /// finds an occurrence by containment and is indifferent to order, so `definition` and
    /// `references` would both still be right and only the outline would be scrambled.
    ///
    /// A reference's `def` is an EVENT id until here, because an occurrence index does not exist
    /// until the order does. `remap` is that renumbering.
    fn finish(self) -> NameIndex {
        let span_of = |e: &Ev<'_>| match e {
            Ev::Def { span, .. } | Ev::Ref { span, .. } => (span.start, span.end),
        };
        let mut order: Vec<usize> = (0..self.events.len()).collect();
        order.sort_by_key(|&i| span_of(&self.events[i]));
        let mut remap = vec![0usize; self.events.len()];
        for (occurrence, &event) in order.iter().enumerate() {
            remap[event] = occurrence;
        }
        let mut index = NameIndex::default();
        for &event in &order {
            match &self.events[event] {
                Ev::Def { name, span, kind, extent } => index.push_definition(name, *span, *kind, *extent),
                Ev::Ref { name, span, def } => {
                    index.push_resolved_reference(name, *span, def.map(|d| remap[d]));
                }
            }
        }
        index
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every fixture in this module was run through `parse_recovering` before being written down.
    /// Three earlier candidates did not hold the property their test asserted — see the design's
    /// §9. Byte offsets below are from that probe, not from counting characters by eye.

    #[test]
    fn a_reference_resolves_to_the_binding_in_scope_and_not_to_the_name() {
        // `let x = 1; let x = x + 1; x`
        //  ^4          ^15   ^19       ^26
        // The value of the second `let` is walked BEFORE its own name is bound, so the `x` at 19
        // is the FIRST binding and the tail at 26 is the second. Asserting INDICES: every
        // occurrence here is spelled `x`, so a name-only assertion passes against everything.
        let n = nav_rxt("let x = 1; let x = x + 1; x").expect("within the token cap");
        let rhs = n.at(19).expect("a name at 19").0;
        let tail = n.at(26).expect("a name at 26").0;
        assert_eq!(n.definition_of(rhs), Some(0), "the right-hand x is the FIRST let");
        assert_eq!(n.definition_of(tail), Some(1), "the tail x is the SECOND let");
        assert_eq!(n.get(0).map(|o| o.span), Some(Span::new(4, 5)));
        assert_eq!(n.get(1).map(|o| o.span), Some(Span::new(15, 16)));
    }

    #[test]
    fn a_parameter_shadows_an_outer_binding_inside_its_body_and_not_outside_it() {
        // `let x = 1; fn f(x) { x } x`
        //      ^4        ^14 ^16   ^21  ^25
        let n = nav_rxt("let x = 1; fn f(x) { x } x").expect("within the token cap");
        let body = n.at(21).expect("a name at 21").0;
        let tail = n.at(25).expect("a name at 25").0;
        assert_eq!(n.get(n.definition_of(body).expect("resolved")).map(|o| o.span), Some(Span::new(16, 17)));
        assert_eq!(n.get(n.definition_of(tail).expect("resolved")).map(|o| o.span), Some(Span::new(4, 5)));
    }

    #[test]
    fn a_block_scoped_binding_does_not_escape_its_block() {
        // `let g = { let y = 1; y }; y`
        //      ^4        ^14      ^21  ^26
        // The bare-block form `{ let y = 1; y } y` cannot be used: its trailing `y` parses as a
        // `Stmt::Error`, so there is no occurrence to assert on.
        let n = nav_rxt("let g = { let y = 1; y }; y").expect("within the token cap");
        let inner = n.at(21).expect("a name at 21").0;
        let outer = n.at(26).expect("a name at 26").0;
        assert_eq!(n.get(n.definition_of(inner).expect("resolved")).map(|o| o.span), Some(Span::new(14, 15)));
        assert_eq!(n.definition_of(outer), None, "the block's y does not escape it");
    }

    #[test]
    fn an_assignment_target_is_a_reference_and_not_a_definition() {
        // `let mut x = 1; x = 2; x` — three occurrences of `x`, ONE definition.
        let n = nav_rxt("let mut x = 1; x = 2; x").expect("within the token cap");
        assert_eq!(n.definitions().count(), 1, "an assignment must not define");
        let target = n.at(15).expect("a name at 15").0;
        assert_eq!(n.definition_of(target), Some(0));
        assert_eq!(n.definition_of(n.at(22).expect("a name at 22").0), Some(0));
    }

    #[test]
    fn a_method_name_resolves_to_the_binding_it_calls() {
        // `fn m(v) { v } 1.m()` — UFCS: typeck looks `m` up in the environment, so it is a
        //  ^3 ^5     ^10   ^16     reference like any other and navigation must agree.
        let n = nav_rxt("fn m(v) { v } 1.m()").expect("within the token cap");
        let call = n.at(16).expect("a name at 16").0;
        assert_eq!(n.definition_of(call), Some(0));
        assert_eq!(n.get(0).map(|o| o.span), Some(Span::new(3, 4)));
    }

    #[test]
    fn definitions_come_back_in_source_order_when_the_walk_order_is_not() {
        // The worklist pops `else_blk` before `then_blk`, so without the sort `a` precedes `z`.
        // Names chosen so source order and alphabetical order DISAGREE — against `c, p, q` the
        // two are the same list and this test would pass against a sort by name.
        let n = nav_rxt("let c = true; if c { let z = 1; z } else { let a = 2; a }").expect("within the token cap");
        let defs: Vec<_> = n.definitions().map(|o| (o.name.as_str(), o.span)).collect();
        assert_eq!(
            defs,
            vec![("c", Span::new(4, 5)), ("z", Span::new(25, 26)), ("a", Span::new(47, 48))],
            "source order, which is neither walk order nor alphabetical order"
        );
    }

    #[test]
    fn a_file_that_does_not_parse_still_indexes_what_it_has() {
        // THE POINT OF THE PARSE-RECOVERY PR THIS ONE SPENDS. Both fixtures were probed: each
        // reports exactly one diagnostic and each keeps the occurrences asserted here.
        let n = nav_rxt("let x = ; x").expect("within the token cap");
        assert_eq!(n.definitions().count(), 1, "the binding survives losing its value");
        assert_eq!(n.definition_of(n.at(10).expect("a name at 10").0), Some(0));

        let n = nav_rxt("fn f(a) { a").expect("within the token cap");
        assert_eq!(n.definitions().count(), 2, "the fn and its parameter");
        let body = n.at(10).expect("a name at 10").0;
        assert_eq!(n.get(n.definition_of(body).expect("resolved")).map(|o| o.span), Some(Span::new(5, 6)));
    }

    #[test]
    fn a_fn_forward_references_its_own_run() {
        // `fn a(n) { b(n) } fn b(n) { a(n) } 0`
        //     ^3 ^5   ^10 ^12        ^20 ^22   ^27 ^29
        // `infer_block_inner` binds every name in a maximal run of consecutive `fn`s before
        // checking any body, so `b` inside `a` is a forward reference the language allows.
        let n = nav_rxt("fn a(n) { b(n) } fn b(n) { a(n) } 0").expect("within the token cap");
        let b_in_a = n.at(10).expect("a name at 10").0;
        let a_in_b = n.at(27).expect("a name at 27").0;
        assert_eq!(n.get(n.definition_of(b_in_a).expect("resolved")).map(|o| o.span), Some(Span::new(20, 21)));
        assert_eq!(n.get(n.definition_of(a_in_b).expect("resolved")).map(|o| o.span), Some(Span::new(3, 4)));

        // The two parameters are both spelled `n` and must NOT cross-link. This is what separates
        // run binding done right from a run that leaks one body's parameters into the next.
        let n_in_a = n.at(12).expect("a name at 12").0;
        let n_in_b = n.at(29).expect("a name at 29").0;
        assert_eq!(n.get(n.definition_of(n_in_a).expect("resolved")).map(|o| o.span), Some(Span::new(5, 6)));
        assert_eq!(n.get(n.definition_of(n_in_b).expect("resolved")).map(|o| o.span), Some(Span::new(22, 23)));
    }

    #[test]
    fn a_fn_does_not_forward_reference_past_a_run_boundary() {
        // `fn a(n) { b(n) } let z = 1; fn b(n) { n } 0`
        //              ^10                  ^31
        // A non-`fn` statement ends the run, so `b` is not yet bound inside `a`. THE LANGUAGE'S
        // OWN ANSWER, not this pass's invention: `analyze` on this source reports exactly
        // "unbound variable `b`".
        let src = "fn a(n) { b(n) } let z = 1; fn b(n) { n } 0";
        let diags = crate::analyze(src).diagnostics;
        assert!(
            diags.iter().any(|d| d.message.contains("unbound variable `b`")),
            "the fixture must be one the language rejects: {diags:?}"
        );
        let n = nav_rxt(src).expect("within the token cap");
        assert_eq!(n.definition_of(n.at(10).expect("a name at 10").0), None, "b is not bound yet");
        // The later `fn b` is still a definition — it is only unreachable FROM `a`.
        assert!(n.definitions().any(|o| o.span == Span::new(31, 32)), "fn b is still defined");
    }

    #[test]
    fn a_deep_chain_indexes_without_overflowing_the_stack() {
        // **A DEFAULT TEST THREAD CANNOT FAIL THIS.** `.cargo/config.toml` sets RUST_MIN_STACK to
        // 32 MiB, so a recursive binder would pass at any depth this input can reach. The
        // `drop_tests` module carries the same problem and the same remedy: an EXPLICIT 512 KiB
        // thread, at the same 40,000 depth. `nav_rxt` and nothing else is called inside it —
        // `analyze` recurses to MAX_TYPE_DEPTH and overflows 512 KiB on its own, which would
        // redden this test for a reason that is not the one it is about.
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                let src = format!("let x = 1; {}", vec!["x"; 40_000].join(" + "));
                let n = nav_rxt(&src).expect("within the token cap");
                assert_eq!(n.definitions().count(), 1);
                let last = n.at(src.len() - 1).expect("a name at the end").0;
                assert_eq!(n.definition_of(last), Some(0), "every x in the chain is the one binding");
            })
            .expect("spawn")
            // A genuine stack overflow here aborts the whole process (SIGABRT) rather than making
            // `join` return `Err`, so this `expect` can only ever fire on an ordinary assertion
            // panic inside the closure. The test still fails under the recursive-walk sabotage —
            // not because this message prints, but because there is no process left to print it.
            .join()
            .expect("the spawned thread panicked");
    }

    #[test]
    fn a_lambda_branches_its_own_scope_a_list_walks_every_element_and_a_while_walks_both_arms() {
        // `let x = 1; let f = |x| [x, x]; while f(0) { x }`
        //      ^4          ^15   ^20 ^24 ^27       ^37 ^44
        // Three arms nothing else in this module reaches. A STANDALONE `Expr::Lambda`: its param
        // `x` at 20 shadows the outer one, and its body is `Expr::List`, so both list elements
        // (24 and 27) must resolve to the PARAMETER, not the outer `let` — which also exercises
        // `Expr::List` walking every item rather than just the first. And `Stmt::While`, whose
        // `cond` (the `f` at 37) and `body` (the `x` at 44) are both reachable only if the arm
        // pushes both. The `x` inside `while`'s body is the OUTER `x`: the lambda's branched scope
        // must not have leaked into it.
        let n = nav_rxt("let x = 1; let f = |x| [x, x]; while f(0) { x }").expect("within the token cap");
        let outer_x = n.at(4).expect("a name at 4").0;
        let f = n.at(15).expect("a name at 15").0;
        let param_x = n.at(20).expect("a name at 20").0;
        let list_first = n.at(24).expect("a name at 24").0;
        let list_second = n.at(27).expect("a name at 27").0;
        let cond_f = n.at(37).expect("a name at 37").0;
        let body_x = n.at(44).expect("a name at 44").0;

        assert_eq!(n.definition_of(list_first), Some(param_x), "the list's first element is the PARAMETER");
        assert_eq!(n.definition_of(list_second), Some(param_x), "and so is its second — the whole list is walked");
        assert_eq!(n.definition_of(cond_f), Some(f), "while's cond resolves `f`");
        assert_eq!(n.definition_of(body_x), Some(outer_x), "while's body sees the OUTER x, not the lambda's");
    }

    #[test]
    fn a_leading_parse_error_binds_nothing_and_does_not_disturb_what_follows() {
        // `} let z = 1; z` — the stray `}` recovers into a `Stmt::Error` at 0..1 (see
        // `parser::recovery_makes_progress_on_a_token_it_cannot_start_a_statement_with`), and the
        // `let` after it must resolve exactly as if the `Stmt::Error` were not there.
        let n = nav_rxt("} let z = 1; z").expect("within the token cap");
        assert_eq!(n.definitions().count(), 1, "the error binds nothing");
        let def = n.at(6).expect("a name at 6").0;
        let reference = n.at(13).expect("a name at 13").0;
        assert_eq!(n.definition_of(reference), Some(def));
    }

    /// `let a0 = 0; let a1 = a0; … let a<n-1> = a0;` — five tokens per statement plus `Eof`.
    fn let_chain(n: usize) -> String {
        let mut s = String::from("let a0 = 0;");
        for i in 1..n {
            s.push_str(&format!(" let a{i} = a0;"));
        }
        s
    }

    /// An over-cap file is NOT indexed, which is a different claim from containing no names.
    ///
    /// **THE TOKEN COUNTS ARE ASSERTED, NOT ASSUMED.** The fixture is generated, so a lexer change
    /// that moves the boundary would otherwise leave this quietly comparing two under-cap
    /// programs and passing for the wrong reason. Measured on 6e0ad6e: 19,999 statements is
    /// 99,996 tokens and 20,000 is 100,001, against a cap of 100,000.
    #[test]
    fn a_program_over_the_token_cap_is_not_indexed_and_one_under_it_is() {
        let under = let_chain(19_999);
        let over = let_chain(20_000);
        assert_eq!(crate::parser::MAX_TOKENS, 100_000);
        assert_eq!(crate::lexer::lex(&under).0.len(), 99_996);
        assert_eq!(crate::lexer::lex(&over).0.len(), 100_001);

        let indexed = nav_rxt(&under).expect("99,996 tokens is within the cap");
        assert_eq!(indexed.definitions().count(), 19_999);
        assert_eq!(nav_rxt(&over), None);
    }

    /// Recovery is not refusal, and this is the assertion that separates the two states.
    ///
    /// A sabotage mapping `Completeness::Recovered` to `None` leaves the cap test above green and
    /// reddens only this one, which is what makes the three-state enum earn its third state.
    #[test]
    fn a_file_that_did_not_parse_completely_is_still_indexed() {
        let n = nav_rxt("fn f(a) { a").expect("a recovered file is indexed");
        // Probed on 6e0ad6e: `f` and its parameter `a`.
        assert_eq!(n.definitions().count(), 2);
    }

    /// A `.rxt` definition carries the span of the statement that introduces it, which is the
    /// span `documentSymbol` needs and the name span cannot supply.
    ///
    /// Offsets probed on 6e0ad6e, not counted by eye.
    #[test]
    fn a_definition_carries_the_extent_of_its_statement() {
        let src = "fn f(a) {\n  let x = 1;\n  x\n}\nlet y = 2;\ny";
        let n = nav_rxt(src).expect("within the token cap");
        let extents: Vec<_> = n
            .definitions()
            .map(|o| (o.name.as_str(), o.def_kind(), (o.span.start, o.span.end), o.extent().map(|e| (e.start, e.end))))
            .collect();
        assert_eq!(
            extents,
            vec![
                ("f", Some(DefKind::Fn), (3, 4), Some((0, 28))),
                ("a", Some(DefKind::Param), (5, 6), None),
                ("x", Some(DefKind::Let), (16, 17), Some((12, 22))),
                ("y", Some(DefKind::Let), (33, 34), Some((29, 39))),
            ]
        );
    }

    /// A parameter is navigable and has no extent: its statement is the whole `fn`, which is its
    /// parent's extent and not its own.
    #[test]
    fn a_parameter_has_no_extent() {
        let n = nav_rxt("fn f(a) { a }").expect("within the token cap");
        let a = n.definitions().find(|o| o.name == "a").expect("the parameter is indexed");
        assert_eq!(a.extent(), None);
    }
}
