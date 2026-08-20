//! Lint rules over the surface AST.
//!
//! These are the first producers of `Severity::Warning` in the crate. The variant was declared,
//! matched and unreachable until this module existed — the same shape of gap `TokenClass::Comment`
//! carried until the printer slice gave it a producer.
//!
//! These rules are syntactic and run only on a program with no error-severity diagnostic, so they
//! never add noise to a file that is already broken.
//!
//! `check` is fully recursive over the surface tree (`block` → `stmt` → `expr` → `block`, mutually).
//! `desugar.rs`'s `free_member_refs` walks the same shape of scoping rule ITERATIVELY instead, and
//! says why: "a recursive walk here would abort the process with an uncatchable stack overflow." This
//! module relies on a guard it never names itself to be safe from the same failure: both of its
//! current callers (`analyze` here, and `redextape-wasm`'s `Session::compile_with_caps`) run `check`
//! only after typechecking has added no error-severity diagnostic, and `typeck.rs`'s `MAX_TYPE_DEPTH`
//! bounds every program that clears that gate to a nesting typeck itself can recurse over — a program
//! deep enough to matter here has already failed typechecking with "expression nested too deeply"
//! first, and `check` never sees it. `check` is `pub`: a caller that skips that gate and hands it an
//! unchecked tree loses this guarantee and can recurse without bound.

use crate::ast::{Block, Expr, Program, Stmt};
use crate::diagnostic::Diagnostic;
use crate::span::Span;

/// One binding, live while the walk is inside the block that introduced it.
///
/// `mutable` is `None` for a binding this module does not report on — a function parameter or a lambda
/// parameter. They are pushed anyway, because a parameter SHADOWS an outer binding and leaving it out
/// would credit the outer one with a use it never had. Folding "is this reportable" and "is it `mut`"
/// into one `Option<bool>` (rather than two independent flags) is also what keeps this struct under
/// `clippy::struct_excessive_bools`'s three-bool threshold — a parameter never carries a mutability
/// this module cares about, so the two were never really separate questions.
struct Local {
    name: String,
    span: Span,
    used: bool,
    assigned: bool,
    mutable: Option<bool>,
}

#[derive(Default)]
struct Lints {
    scope: Vec<Local>,
    out: Vec<Diagnostic>,
}

/// Every binding this program declares `mut` and never assigns, plus every binding (`mut` or not)
/// that nothing ever reads.
///
/// Diagnostics come back ordered by span so the CLI and the editor both render them in source order.
#[must_use]
pub fn check(program: &Program) -> Vec<Diagnostic> {
    let mut l = Lints::default();
    l.block(&program.block);
    l.out.sort_by_key(|d| d.span.start);
    l.out
}

impl Lints {
    fn block(&mut self, b: &Block) {
        let mark = self.scope.len();
        let mut i = 0;
        while i < b.stmts.len() {
            if matches!(b.stmts[i], Stmt::Fn { .. }) {
                // Mirrors `infer_block_inner`: group the maximal run of consecutive `Stmt::Fn`s
                // and scope it as one unit. See `fn_run`.
                let start = i;
                while i < b.stmts.len() && matches!(b.stmts[i], Stmt::Fn { .. }) {
                    i += 1;
                }
                self.fn_run(&b.stmts[start..i]);
            } else {
                self.stmt(&b.stmts[i]);
                i += 1;
            }
        }
        if let Some(tail) = &b.tail {
            self.expr(tail);
        }
        self.close(mark);
    }

    /// Scope a maximal run of consecutive `Stmt::Fn`s the way typeck's `infer_fn_run` types one:
    /// every name in the run is pushed BEFORE any of the run's bodies are walked, so a `fn` may
    /// forward-reference, or mutually recurse with, any other `fn` in the same run — the tree has
    /// fixtures like `fn a(m) { b(m) } fn b(m) { a(m) }`, and `a`'s call to `b` must resolve to the
    /// sibling, not fall through to (or find nothing but) an outer binding of the same name.
    ///
    /// The pushed names are NOT closed here: like typeck's `TyEnv`, which re-binds each name after
    /// `env.truncate(rec_mark)` rather than dropping it, they stay live for the rest of the
    /// enclosing block and are only cleared by that block's own `close`. Each name is
    /// non-reportable (see `Local::mutable`) — this module does not add an "unused function" rule.
    /// `fns` is non-empty and every element is `Stmt::Fn` (the caller's run).
    fn fn_run(&mut self, fns: &[Stmt]) {
        for f in fns {
            if let Stmt::Fn { name, .. } = f {
                self.push_param(name);
            }
        }
        for f in fns {
            if let Stmt::Fn { params, body, .. } = f {
                let mark = self.scope.len();
                for p in params {
                    self.push_param(p);
                }
                self.block(body);
                self.close(mark);
            }
        }
    }

    /// Drop every binding introduced since `mark`, reporting the ones nothing used.
    ///
    /// A binding can trip both rules at once (`let mut x = 1;` alone is neither read nor assigned),
    /// but only ONE diagnostic comes out of it: unused-variable takes priority and the
    /// does-not-need-`mut` warning is suppressed for a binding that is unused outright. The two
    /// warnings would name the same span and the same fix (rename to `_x`, or delete the binding),
    /// so reporting both is repetition, not more information.
    fn close(&mut self, mark: usize) {
        while self.scope.len() > mark {
            let Some(l) = self.scope.pop() else { break };
            let Some(mutable) = l.mutable else { continue };
            if !l.used && !l.name.starts_with('_') {
                self.out.push(Diagnostic::warning(l.span, format!("unused variable: `{}`", l.name)));
            } else if mutable && !l.assigned {
                self.out
                    .push(Diagnostic::warning(l.span, format!("variable `{}` does not need to be mutable", l.name)));
            }
        }
    }

    /// Mark the INNERMOST binding of `name`. Later pushes shadow earlier ones, so the search runs
    /// from the top of the stack down.
    fn mark_use(&mut self, name: &str) {
        if let Some(l) = self.scope.iter_mut().rev().find(|l| l.name == name) {
            l.used = true;
        }
    }

    fn mark_assign(&mut self, name: &str) {
        if let Some(l) = self.scope.iter_mut().rev().find(|l| l.name == name) {
            l.assigned = true;
        }
    }

    fn stmt(&mut self, s: &Stmt) {
        match s {
            // The value is inferred in the scope BEFORE the binding exists, so it is walked first.
            Stmt::Let { name, mutable, value, span } => {
                self.expr(value);
                self.scope.push(Local {
                    name: name.clone(),
                    span: *span,
                    used: false,
                    assigned: false,
                    mutable: Some(*mutable),
                });
            }
            // An assignment is not a READ. `let mut x = 1; x = 2;` never reads `x`, and both rules
            // should say so independently — this is the behaviour rustc has for the same shapes.
            Stmt::Assign { target, value, .. } => {
                self.expr(value);
                self.mark_assign(target);
            }
            // A lone `fn` is the degenerate case of a run of one; `block`'s loop is the normal call
            // site (it groups consecutive `Stmt::Fn`s before reaching here), but routing a
            // singleton through `fn_run` keeps this arm correct — rather than a second, driftable
            // copy — if `stmt` is ever called on a `Stmt::Fn` directly. Mirrors typeck's
            // `infer_stmt`.
            Stmt::Fn { .. } => self.fn_run(std::slice::from_ref(s)),
            Stmt::While { cond, body, .. } => {
                self.expr(cond);
                self.block(body);
            }
            Stmt::Expr(e) => self.expr(e),
        }
    }

    /// A parameter shadows but is never reported. See `Local::mutable`.
    fn push_param(&mut self, name: &str) {
        self.scope.push(Local {
            name: name.to_string(),
            span: Span { start: 0, end: 0 },
            used: false,
            assigned: false,
            mutable: None,
        });
    }

    fn expr(&mut self, e: &Expr) {
        match e {
            Expr::Nat { .. } | Expr::Bool { .. } => {}
            Expr::Var { name, .. } => self.mark_use(name),
            Expr::List { items, .. } => {
                for i in items {
                    self.expr(i);
                }
            }
            Expr::Binary { lhs, rhs, .. } => {
                self.expr(lhs);
                self.expr(rhs);
            }
            Expr::If { cond, then_blk, else_blk, .. } => {
                self.expr(cond);
                self.block(then_blk);
                self.block(else_blk);
            }
            Expr::Block { block, .. } => self.block(block),
            Expr::Lambda { params, body, .. } => {
                let mark = self.scope.len();
                for p in params {
                    self.push_param(p);
                }
                self.expr(body);
                self.close(mark);
            }
            Expr::Call { callee, args, .. } => {
                self.expr(callee);
                for a in args {
                    self.expr(a);
                }
            }
            // UFCS: typeck resolves `recv.name(args)` as `name(recv, args)` and looks `name` up in
            // the environment exactly like a call target — so `name` is a genuine binding
            // reference, not just a field-style accessor, and a binding used ONLY as a method
            // target must count as read.
            Expr::Method { recv, name, args, .. } => {
                self.expr(recv);
                self.mark_use(name);
                for a in args {
                    self.expr(a);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::diagnostic::Severity;

    #[test]
    fn a_mut_binding_that_is_never_assigned_warns() {
        let ds = crate::analyze("let mut x = 1; x + 1").diagnostics;
        assert_eq!(ds.len(), 1, "expected exactly one diagnostic, got {ds:?}");
        assert_eq!(ds[0].severity, Severity::Warning);
        assert!(ds[0].message.contains("does not need to be mutable"), "got {:?}", ds[0].message);
    }

    #[test]
    fn a_mut_binding_that_is_assigned_does_not_warn() {
        let ds = crate::analyze("let mut x = 1; x = 2; x + 1").diagnostics;
        assert!(ds.is_empty(), "an assigned `mut` is used as intended: {ds:?}");
    }

    #[test]
    fn an_immutable_binding_never_triggers_the_mut_rule() {
        let ds = crate::analyze("let x = 1; x + 1").diagnostics;
        assert!(ds.is_empty(), "{ds:?}");
    }

    #[test]
    fn the_rule_reads_the_innermost_binding_when_a_name_is_shadowed() {
        // The inner `mut y` is assigned; the OUTER `mut y` never is, so exactly one warning fires and
        // it names the outer binding's span, which starts at offset 0.
        let ds = crate::analyze("let mut y = 1; { let mut y = 2; y = 3; y }; y").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert_eq!(ds[0].span.start, 0, "the OUTER binding is the unassigned one: {ds:?}");
    }

    #[test]
    fn lints_do_not_run_on_a_program_that_already_has_an_error() {
        // `nope` is unbound. That is an error, and a broken program must not also be nagged.
        let ds = crate::analyze("let mut x = 1; nope").diagnostics;
        assert!(ds.iter().all(|d| d.severity == Severity::Error), "no warnings beside an error: {ds:?}");
    }

    #[test]
    fn push_param_credits_the_inner_fn_parameter_not_the_outer_shadowed_binding() {
        // The fn parameter `n` shadows the outer `mut n` and IS assigned inside the body; the
        // OUTER `mut n` is never assigned. Pins `push_param`: without it, the inner assignment
        // has nothing to resolve against but the outer `n` (the only one left on the stack) and
        // wrongly marks IT assigned, silencing the warning this test exists to catch.
        let ds = crate::analyze("let mut n = 1; fn f(n) { n = n + 1; n } f(2) + n").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert_eq!(ds[0].span.start, 0, "the OUTER `n` is the unassigned one: {ds:?}");
        // Count and span alone stay put even if `fn_run` forgets to `close` the inner scope — only
        // the MESSAGE would flip, from "does not need to be mutable" to "unused variable", because an
        // inner `n` left on the stack marks the outer `n` used by name lookup instead of being popped
        // and reported itself. Assert the message so that swap cannot pass silently.
        assert!(ds[0].message.contains("does not need to be mutable"), "got {:?}", ds[0].message);
    }

    #[test]
    fn push_param_credits_the_inner_lambda_parameter_not_the_outer_shadowed_binding() {
        // The `|…|` analogue of the previous test: a lambda's own `n` parameter shadows the outer
        // `mut n`, and only the inner one gets assigned.
        let ds = crate::analyze("let mut n = 1; (|n| { n = n + 1; n })(2) + n").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert_eq!(ds[0].span.start, 0, "the OUTER `n` is the unassigned one: {ds:?}");
        // Same reason as the `fn` sibling test above: count and span survive a missing `close` after
        // `Expr::Lambda`'s body, and only the message would flip. Assert it.
        assert!(ds[0].message.contains("does not need to be mutable"), "got {:?}", ds[0].message);
    }

    #[test]
    fn a_mut_declared_inside_a_fn_body_still_warns() {
        // Pins `Stmt::Fn`'s descent into `body`: without it, `b` is never pushed onto the scope
        // stack at all, so nothing reports it.
        let ds = crate::analyze("fn f(a) { let mut b = 1; b + a } f(2)").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
    }

    #[test]
    fn a_while_body_can_assign_an_outer_mut_while_its_own_inner_mut_still_warns() {
        // `k` is declared and never assigned inside the loop body, so it must warn; `i` IS
        // assigned inside that same body, so it must not. Both facts depend on `Stmt::While`
        // descending into `body` — without it, `k`'s declaration is never seen (no warning for
        // `k`) and `i`'s assignment is never seen either (a wrong warning for `i` instead).
        let ds = crate::analyze("let mut i = 3; while i > 0 { let mut k = 1; i = i - k; } i").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains('k'), "the warning should name `k`, not `i`: {ds:?}");
    }

    #[test]
    fn a_mut_declared_inside_an_if_branch_still_warns() {
        // Pins `Expr::If`'s descent into `then_blk`/`else_blk`.
        let ds = crate::analyze("if true { let mut m = 1; m } else { 0 }").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
    }

    #[test]
    fn a_mut_declared_inside_a_list_element_still_warns() {
        // Pins `Expr::List`'s descent into `items`.
        let ds = crate::analyze("[{ let mut m = 1; m }]").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
    }

    #[test]
    fn a_mut_declared_inside_a_binary_operand_still_warns() {
        // Pins `Expr::Binary`'s descent into `lhs`/`rhs`.
        let ds = crate::analyze("{ let mut m = 1; m } + 1").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
    }

    #[test]
    fn a_mut_declared_inside_a_call_argument_still_warns() {
        // Pins `Expr::Call`'s descent into `args`.
        let ds = crate::analyze("fn id(x) { x } id({ let mut m = 1; m })").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
    }

    #[test]
    fn a_mut_declared_inside_a_method_receiver_still_warns() {
        // Pins `Expr::Method`'s descent into `recv`.
        let ds = crate::analyze("fn id2(x) { x } { let mut m = 1; m }.id2()").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
    }

    #[test]
    fn a_mut_declared_inside_a_lambda_body_still_warns() {
        // Pins `Expr::Lambda`'s descent into `body`.
        let ds = crate::analyze("let f = |x| { let mut m = 1; m + x }; f(1)").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
    }

    #[test]
    fn a_binding_that_is_never_read_warns() {
        let ds = crate::analyze("let x = 1; 2").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("unused variable"), "got {:?}", ds[0].message);
    }

    #[test]
    fn an_underscore_name_is_exempt() {
        let ds = crate::analyze("let _x = 1; 2").diagnostics;
        assert!(ds.is_empty(), "a leading underscore suppresses the rule: {ds:?}");
    }

    #[test]
    fn a_bare_underscore_is_exempt_too() {
        let ds = crate::analyze("let _ = 1; 2").diagnostics;
        assert!(ds.is_empty(), "{ds:?}");
    }

    #[test]
    fn assigning_to_a_binding_is_not_reading_it() {
        // `x = 2` is an assignment, not a read, so `x` is still unused even though it was written
        // to. The does-not-need-`mut` rule does not fire here either way: `x` IS assigned, so its
        // own `mutable && !assigned` condition is false, regardless of `close`'s `if`/`else if`.
        let ds = crate::analyze("let mut x = 1; x = 2; 3").diagnostics;
        assert_eq!(ds.len(), 1, "only the unused-variable rule fires: {ds:?}");
        assert!(ds[0].message.contains("unused variable"), "got {:?}", ds[0].message);
    }

    #[test]
    fn a_shadowed_binding_is_reported_when_only_the_inner_one_is_read() {
        let ds = crate::analyze("let z = 1; { let z = 2; z }").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert_eq!(ds[0].span.start, 0, "the OUTER `z` is the unread one: {ds:?}");
    }

    #[test]
    fn rebinding_a_name_with_its_own_old_value_reads_the_old_binding_not_the_new_one() {
        // The commonest shadowing idiom: `let x = x + 1;` must resolve the `x` on its RIGHT-hand side
        // to the binding that already exists, not to the one this very statement is about to
        // introduce. `stmt`'s `Stmt::Let` arm is documented to walk `value` before pushing the new
        // `Local` for exactly this reason ("The value is inferred in the scope BEFORE the binding
        // exists") but nothing exercised that claim: both the first `x` and the second are read, so
        // this must produce zero diagnostics. Pushing the new `Local` before walking `value` would
        // instead make the second `let`'s value expression read ITSELF, leaving the first `x` never
        // read and wrongly warned "unused variable".
        let ds = crate::analyze("let x = 1; let x = x + 1; x").diagnostics;
        assert!(ds.is_empty(), "both bindings are read; the outer one via the inner's own value: {ds:?}");
    }

    #[test]
    fn a_lambda_parameter_is_not_reported() {
        let ds = crate::analyze("let f = |a| 1; f(2)").diagnostics;
        assert!(ds.is_empty(), "parameters are out of scope for these rules: {ds:?}");
    }

    #[test]
    fn a_binding_that_is_neither_read_nor_assigned_warns_exactly_once() {
        // `x` is `mut`, never assigned, AND never read: both rules' conditions are met, but this
        // module deliberately reports only the unused-variable warning and suppresses the
        // does-not-need-to-be-mutable one as redundant — renaming to `_x` fixes both problems in a
        // single edit, so telling the user about both is noise, not more information.
        let ds = crate::analyze("let mut x = 1; 2").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("unused variable"), "got {:?}", ds[0].message);
    }

    #[test]
    fn an_underscore_prefixed_mut_binding_that_is_never_assigned_still_warns() {
        // `_x` is exempt from the unused-variable rule, so `close`'s `if` is false and falls
        // through to `else if`: `_x` is still `mut` and never assigned, so the does-not-need-`mut`
        // warning fires anyway. A leading underscore says "I mean for this to go unread," not "I
        // mean for this to stay needlessly `mut`" — the two exemptions are independent.
        let ds = crate::analyze("let mut _x = 1; 2").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("does not need to be mutable"), "got {:?}", ds[0].message);
    }

    #[test]
    fn a_method_target_is_a_use() {
        // Typeck resolves `recv.m(args)` UFCS-style: `m` is looked up in the environment exactly
        // like a call target would be, so a binding used only as a method name is a genuine read.
        let ds = crate::analyze("let hd = |xs| 1; [1].hd()").diagnostics;
        assert!(ds.is_empty(), "the method target IS a use of `hd`: {ds:?}");
    }

    #[test]
    fn a_fn_shadows_an_outer_let_of_the_same_name() {
        // Before the fix, `Stmt::Fn` never pushed its own name onto the scope at all, so `f(2)`
        // had nothing to resolve against but the outer `let f`, and wrongly marked IT used — hiding
        // a genuinely dead binding. The `fn`'s own name must shadow it, exactly as typeck's `TyEnv`
        // does (a later `insert` shadows on lookup regardless of statement kind).
        let ds = crate::analyze("let f = 1; fn f(x) { x } f(2)").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("unused variable"), "got {:?}", ds[0].message);
        assert_eq!(ds[0].span.start, 0, "the OUTER `let f` is the unread one: {ds:?}");
    }

    #[test]
    fn a_fn_run_pre_binds_every_sibling_before_any_body_is_walked() {
        // `a` and `b` are one maximal run of consecutive `Stmt::Fn`s. Typeck's `infer_fn_run`
        // pre-binds every name in the run before checking ANY body, so `a`'s call to `b` resolves
        // to the SIBLING fn even though `b` is declared textually after `a` — not to the outer
        // `let b`, which is why the outer `let b` is reported unused here.
        let ds = crate::analyze("let b = 99; fn a(m) { b(m) } fn b(m) { a(m) } a(1)").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("unused variable"), "got {:?}", ds[0].message);
        assert_eq!(ds[0].span.start, 0, "the outer `let b` is the unread one: {ds:?}");
    }

    #[test]
    fn two_unused_bindings_come_back_in_source_order_not_close_s_pop_order() {
        // `close` pops one flat scope LIFO — `b` was pushed after `a`, so it is popped, and pushed
        // onto `out`, FIRST. Without `check`'s own `sort_by_key(|d| d.span.start)`, this pair would
        // come back as `b` then `a`: backwards from how they read in the source. `check`'s own doc
        // says diagnostics come back ordered by span "so the CLI and the editor both render them in
        // source order" — this is the test that fails if that sort is ever dropped.
        let ds = crate::analyze("let a = 1; let b = 2; 3").diagnostics;
        assert_eq!(ds.len(), 2, "{ds:?}");
        assert!(ds[0].message.contains("`a`"), "the FIRST-declared binding must be reported first: {ds:?}");
        assert!(ds[1].message.contains("`b`"), "the SECOND-declared binding must be reported second: {ds:?}");
        assert!(ds[0].span.start < ds[1].span.start, "span order must match declaration order: {ds:?}");
    }
}
