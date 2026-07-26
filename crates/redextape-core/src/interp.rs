//! Reference tree-walker over the Core AST — the oracle later backends are checked against. Every
//! binding is a mutable `Rc<RefCell<Value>>` slot so `while`/assignment and closures share one
//! mechanism. Subtraction is monus (saturating). A step budget guards against nontermination.

use crate::core::{BinOp, Core};
use crate::prelude::runtime_env;
use crate::value::{Builtin, Env, Frame, Value};
use std::cell::RefCell;
use std::rc::Rc;

/// Default step budget for `eval` — high enough for the demo suite, low enough to fail fast in
/// tests instead of hanging. (§6.4 makes caps first-class; this is the interpreter's own guard.)
pub const DEFAULT_BUDGET: u64 = 5_000_000;

/// Maximum total interpreter recursion depth before `eval` returns a `RuntimeError` instead of
/// letting native (Rust) recursion overflow the stack. This bounds EVERY `eval` call — user
/// function calls AND purely structural nesting (deep lists desugar to deep `cons`-Apply chains;
/// long statement sequences desugar to deep `Seq` chains) — not just closure application, because
/// any of those can recurse the tree-walker arbitrarily deep on valid input. The mutually-recursive
/// `eval`/`apply` tree-walker uses fat frames in debug builds — reaching this depth needs on the
/// order of a few MiB of stack — so the guard is only effective when the running thread has enough
/// stack. We ensure that by raising the test/coverage thread stack via `RUST_MIN_STACK` in
/// `.cargo/config.toml`; the CLI runs on the ~8 MiB main thread. (The WASM build, added in a
/// later plan, must size its shadow stack to match — tracked as a Plan 4 follow-up.)
pub const MAX_EVAL_DEPTH: u32 = 700;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeError {
    pub message: String,
}

impl RuntimeError {
    fn new(message: impl Into<String>) -> Self {
        RuntimeError { message: message.into() }
    }
}

type EResult = Result<Value, RuntimeError>;

pub fn eval(core: &Core) -> EResult {
    eval_with_budget(core, DEFAULT_BUDGET)
}

pub fn eval_with_budget(core: &Core, budget: u64) -> EResult {
    let mut env: Env = None;
    for (name, value) in runtime_env() {
        env = Some(Rc::new(Frame { name, slot: Rc::new(RefCell::new(value)), parent: env }));
    }
    let mut ev = Evaluator { steps: 0, budget, depth: 0, letrec_slots: Vec::new() };
    let result = ev.eval(core, &env);
    // Break the `Frame -> slot -> Closure -> env -> Frame` reference cycles that recursive
    // bindings create, so every environment frame this run allocated is reclaimed when `env` and
    // `ev` drop (Rc has no cycle collector). Evaluation has finished, so no slot is borrowed, and
    // the result value (never re-applied) is unaffected.
    for slot in &ev.letrec_slots {
        *slot.borrow_mut() = Value::Unit;
    }
    result
}

struct Evaluator {
    steps: u64,
    budget: u64,
    depth: u32,
    letrec_slots: Vec<Rc<RefCell<Value>>>,
}

impl Evaluator {
    fn tick(&mut self) -> Result<(), RuntimeError> {
        self.steps += 1;
        if self.steps > self.budget {
            return Err(RuntimeError::new(format!("exceeded step budget of {}", self.budget)));
        }
        Ok(())
    }

    /// Wraps `eval_inner` with the total-recursion depth guard so every nested `eval` call (user
    /// calls and structural nesting alike) is counted and every return path decrements `self.depth`.
    fn eval(&mut self, node: &Core, env: &Env) -> EResult {
        self.tick()?;
        self.depth += 1;
        if self.depth > MAX_EVAL_DEPTH {
            self.depth -= 1;
            return Err(RuntimeError::new(format!(
                "evaluation exceeded maximum depth of {MAX_EVAL_DEPTH} (deeply recursive or deeply nested)"
            )));
        }
        let r = self.eval_inner(node, env);
        self.depth -= 1;
        r
    }

    fn eval_inner(&mut self, node: &Core, env: &Env) -> EResult {
        match node {
            Core::Nat(_, n) => Ok(Value::Nat(*n)),
            Core::Bool(_, b) => Ok(Value::Bool(*b)),
            Core::Unit(_) => Ok(Value::Unit),
            Core::Var(_, name) => {
                lookup(env, name).ok_or_else(|| RuntimeError::new(format!("unbound variable `{name}`")))
            }
            Core::BinOp(_, op, a, b) => {
                let x = self.eval(a, env)?;
                let y = self.eval(b, env)?;
                eval_binop(*op, x, y)
            }
            Core::If(_, c, t, e) => match self.eval(c, env)? {
                Value::Bool(true) => self.eval(t, env),
                Value::Bool(false) => self.eval(e, env),
                other => Err(RuntimeError::new(format!("`if` condition was not a Bool: {other:?}"))),
            },
            Core::Lambda(_, params, body) => {
                Ok(Value::Closure { params: params.clone(), body: Rc::new((**body).clone()), env: env.clone() })
            }
            Core::Apply(_, callee, args) => {
                let f = self.eval(callee, env)?;
                let mut argv = Vec::with_capacity(args.len());
                for a in args {
                    argv.push(self.eval(a, env)?);
                }
                self.apply(f, argv)
            }
            Core::Let { name, value, body, .. } => {
                let v = self.eval(value, env)?;
                let env2 = push(env, name, v);
                self.eval(body, &env2)
            }
            Core::LetRec { name, value, body, .. } => {
                // Pre-bind the name to a placeholder slot, evaluate the (lambda) value in that
                // extended env so it can see itself, then patch the slot.
                let slot = Rc::new(RefCell::new(Value::Unit));
                self.letrec_slots.push(slot.clone());
                let env2 = Some(Rc::new(Frame { name: name.clone(), slot: slot.clone(), parent: env.clone() }));
                let v = self.eval(value, &env2)?;
                *slot.borrow_mut() = v;
                self.eval(body, &env2)
            }
            Core::LetRecGroup(_, bindings, body) => {
                // Same shape as `LetRec`, N-ary: pre-bind EVERY name to a placeholder slot (so each
                // value, and the body, can see every name), then evaluate the values in that fully
                // extended env and patch each slot in turn.
                let mut env2 = env.clone();
                let mut slots = Vec::with_capacity(bindings.len());
                for (name, _) in bindings {
                    let slot = Rc::new(RefCell::new(Value::Unit));
                    self.letrec_slots.push(slot.clone());
                    slots.push(slot.clone());
                    env2 = Some(Rc::new(Frame { name: name.clone(), slot, parent: env2 }));
                }
                for ((_, value), slot) in bindings.iter().zip(&slots) {
                    let v = self.eval(value, &env2)?;
                    *slot.borrow_mut() = v;
                }
                self.eval(body, &env2)
            }
            Core::Seq(_, first, then) => {
                self.eval(first, env)?;
                self.eval(then, env)
            }
            Core::Assign(_, name, value) => {
                let v = self.eval(value, env)?;
                let slot =
                    find_slot(env, name).ok_or_else(|| RuntimeError::new(format!("unbound variable `{name}`")))?;
                *slot.borrow_mut() = v;
                Ok(Value::Unit)
            }
            Core::While(_, cond, body) => {
                loop {
                    self.tick()?;
                    match self.eval(cond, env)? {
                        Value::Bool(true) => {
                            self.eval(body, env)?;
                        }
                        Value::Bool(false) => break,
                        other => return Err(RuntimeError::new(format!("`while` condition was not a Bool: {other:?}"))),
                    }
                }
                Ok(Value::Unit)
            }
        }
    }

    fn apply(&mut self, callee: Value, args: Vec<Value>) -> EResult {
        // Match by reference: `Value` now has a hand-written `Drop`, so its fields cannot be moved
        // out by value. Borrowing the closure's parts is sufficient here (`env`/`body` are only
        // cloned/borrowed) and keeps behavior identical.
        match &callee {
            Value::Closure { params, body, env } => {
                if params.len() != args.len() {
                    return Err(RuntimeError::new(format!(
                        "closure expects {} argument(s), got {}",
                        params.len(),
                        args.len()
                    )));
                }
                let mut env2 = env.clone();
                for (p, a) in params.iter().zip(args) {
                    env2 = push(&env2, p, a);
                }
                self.eval(body, &env2)
            }
            Value::Builtin(b) => apply_builtin(*b, args),
            other => Err(RuntimeError::new(format!("attempted to call a non-function: {other:?}"))),
        }
    }
}

fn eval_binop(op: BinOp, x: Value, y: Value) -> EResult {
    let (a, b) = match (x, y) {
        (Value::Nat(a), Value::Nat(b)) => (a, b),
        (x, y) => return Err(RuntimeError::new(format!("arithmetic on non-Nat operands: {x:?}, {y:?}"))),
    };
    Ok(match op {
        BinOp::Add => Value::Nat(a.saturating_add(b)),
        BinOp::Sub => Value::Nat(a.saturating_sub(b)), // monus
        BinOp::Mul => Value::Nat(a.saturating_mul(b)),
        BinOp::Eq => Value::Bool(a == b),
        BinOp::Ne => Value::Bool(a != b),
        BinOp::Lt => Value::Bool(a < b),
        BinOp::Le => Value::Bool(a <= b),
        BinOp::Gt => Value::Bool(a > b),
        BinOp::Ge => Value::Bool(a >= b),
    })
}

fn apply_builtin(b: Builtin, args: Vec<Value>) -> EResult {
    match (b, args.as_slice()) {
        (Builtin::Cons, [h, t]) => Ok(Value::Cons(Rc::new(h.clone()), Rc::new(t.clone()))),
        (Builtin::Head, [Value::Cons(h, _)]) => Ok((**h).clone()),
        (Builtin::Head, [Value::Nil]) => Err(RuntimeError::new("head of empty list")),
        (Builtin::Tail, [Value::Cons(_, t)]) => Ok((**t).clone()),
        (Builtin::Tail, [Value::Nil]) => Err(RuntimeError::new("tail of empty list")),
        (Builtin::IsEmpty, [Value::Nil]) => Ok(Value::Bool(true)),
        (Builtin::IsEmpty, [Value::Cons(_, _)]) => Ok(Value::Bool(false)),
        (Builtin::Box, [init]) => Ok(Value::Box(Rc::new(RefCell::new(init.clone())))),
        (Builtin::BoxGet, [Value::Box(cell)]) => Ok(cell.borrow().clone()),
        (Builtin::BoxSet, [Value::Box(cell), v]) => {
            *cell.borrow_mut() = v.clone();
            Ok(Value::Unit)
        }
        _ => Err(RuntimeError::new(format!("builtin {b:?} applied to bad arguments: {args:?}"))),
    }
}

fn push(env: &Env, name: &str, value: Value) -> Env {
    Some(Rc::new(Frame { name: name.to_string(), slot: Rc::new(RefCell::new(value)), parent: env.clone() }))
}

fn find_slot(env: &Env, name: &str) -> Option<Rc<RefCell<Value>>> {
    let mut cur = env.clone();
    while let Some(frame) = cur {
        if frame.name == name {
            return Some(frame.slot.clone());
        }
        cur = frame.parent.clone();
    }
    None
}

fn lookup(env: &Env, name: &str) -> Option<Value> {
    find_slot(env, name).map(|slot| slot.borrow().clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::parser::parse;

    fn run(src: &str) -> Value {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        eval(&core).expect("runtime error")
    }

    #[test]
    fn arithmetic_with_monus() {
        assert_eq!(run("1 + 2 * 3"), Value::Nat(7));
        assert_eq!(run("3 - 5"), Value::Nat(0)); // monus
    }

    #[test]
    fn comparisons_and_if() {
        assert_eq!(run("if 2 > 1 { 10 } else { 20 }"), Value::Nat(10));
        assert_eq!(run("if 1 == 2 { 10 } else { 20 }"), Value::Nat(20));
    }

    #[test]
    fn all_comparison_operators_evaluate() {
        // `==`, `>`, `<` are covered above/below; this pins the remaining three (`!=`, `<=`, `>=`).
        assert_eq!(run("1 != 2"), Value::Bool(true));
        assert_eq!(run("2 != 2"), Value::Bool(false));
        assert_eq!(run("1 <= 1"), Value::Bool(true));
        assert_eq!(run("2 <= 1"), Value::Bool(false));
        assert_eq!(run("2 >= 1"), Value::Bool(true));
        assert_eq!(run("1 >= 2"), Value::Bool(false));
        assert_eq!(run("1 < 2"), Value::Bool(true));
    }

    #[test]
    fn let_closure_application() {
        assert_eq!(run("let add1 = |x| x + 1; add1(41)"), Value::Nat(42));
    }

    #[test]
    fn list_builtins() {
        assert_eq!(run("head(cons(7, nil))"), Value::Nat(7));
        assert_eq!(run("is_empty(nil)"), Value::Bool(true));
        assert_eq!(run("is_empty(cons(1, nil))"), Value::Bool(false));
        assert_eq!(run("[1, 2, 3]"), Value::list_of_nats(&[1, 2, 3]));
    }

    #[test]
    fn recursion_via_fn() {
        let src = "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)";
        assert_eq!(run(src), Value::Nat(15));
    }

    #[test]
    fn while_and_mutation() {
        let src = "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)";
        assert_eq!(run(src), Value::Nat(4));
    }

    #[test]
    fn map_and_fold_library_programs_run() {
        let src = "\
            fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
            fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
            fn add(a, b) { a + b }\n\
            fn add1(x) { x + 1 }\n\
            fold([3, 1, 2].map(add1), 0, add)";
        // map(add1) -> [4,2,3]; fold add from 0 -> 9
        assert_eq!(run(src), Value::Nat(9));
    }

    #[test]
    fn head_of_empty_is_a_runtime_error() {
        let (prog, _) = parse("head(nil)");
        let core = desugar(&prog.unwrap());
        let err = eval(&core).unwrap_err();
        assert!(err.message.contains("empty list"), "message: {}", err.message);
    }

    #[test]
    fn tail_of_empty_is_a_runtime_error() {
        let (prog, _) = parse("tail(nil)");
        let core = desugar(&prog.unwrap());
        let err = eval(&core).unwrap_err();
        assert!(err.message.contains("empty list"), "message: {}", err.message);
    }

    #[test]
    fn budget_exhaustion_is_an_error_not_a_hang() {
        let (prog, _) = parse("fn loop_forever(n) { let mut x = 0; while 0 == 0 { x = x + 1; } x } loop_forever(0)");
        let core = desugar(&prog.unwrap());
        let err = eval_with_budget(&core, 1000).unwrap_err();
        assert!(err.message.contains("step budget"), "message: {}", err.message);
    }

    #[test]
    fn deep_recursion_is_an_error_not_a_stack_overflow() {
        // Unbounded user recursion must surface as a RuntimeError, never a native stack overflow
        // (which aborts the process uncatchably). The depth guard trips well before the step budget.
        let (prog, _) = parse("fn f(n) { if n == 0 { 0 } else { 1 + f(n - 1) } } f(100000)");
        let core = desugar(&prog.unwrap());
        let err = eval(&core).unwrap_err();
        assert!(err.message.contains("maximum depth"), "message: {}", err.message);
    }

    #[test]
    fn huge_list_literal_is_a_runtime_error_not_a_stack_overflow() {
        // A list literal desugars to a deep `cons`-Apply chain; evaluating one well above
        // MAX_EVAL_DEPTH must surface as a RuntimeError, never a native eval stack overflow.
        let src = format!("[{}]", vec!["1"; 10_000].join(", "));
        let (prog, ds) = parse(&src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let err = eval(&core).unwrap_err();
        assert!(err.message.contains("maximum depth"), "message: {}", err.message);
    }

    #[test]
    fn long_statement_sequence_is_a_runtime_error_not_a_stack_overflow() {
        // A long statement sequence desugars to a deep Seq chain (desugar itself is now iterative
        // and won't overflow, but evaluating the resulting deep tree still must not overflow eval).
        let stmts: Vec<String> = (0..10_000).map(|i| format!("{i};")).collect();
        let src = stmts.join("");
        let (prog, ds) = parse(&src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let err = eval(&core).unwrap_err();
        assert!(err.message.contains("maximum depth"), "message: {}", err.message);
    }

    #[test]
    fn tail_less_block_is_unit_not_zero() {
        // A program that is only statements (no tail expression) evaluates to the internal Unit value,
        // distinct from the literal `0` — pins the oracle's observable result for later backends.
        assert_eq!(run("let x = 1;"), Value::Unit);
        assert_ne!(run("let x = 1;"), Value::Nat(0));
    }

    #[test]
    fn box_get_reads_what_box_set_wrote() {
        use crate::core::{Core, NodeGen};
        // let h = $box(1) in { $box_set(h, 9); $box_get(h) }  ==> 9
        let mut g = NodeGen::default();
        let apply = |g: &mut NodeGen, name: &str, args: Vec<Core>| {
            Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), name.into())), args)
        };
        let one = Core::Nat(g.fresh(), 1);
        let boxed = apply(&mut g, "$box", vec![one]);
        // Args are built into a local `Vec` first (rather than inline inside the `apply(&mut g, ...)`
        // call) so evaluating them doesn't need a second concurrent `&mut g` while the first is live.
        let hset_args = vec![Core::Var(g.fresh(), "h".into()), Core::Nat(g.fresh(), 9)];
        let hset = apply(&mut g, "$box_set", hset_args);
        let hget_args = vec![Core::Var(g.fresh(), "h".into())];
        let hget = apply(&mut g, "$box_get", hget_args);
        let seq = Core::Seq(g.fresh(), Box::new(hset), Box::new(hget));
        let prog =
            Core::Let { id: g.fresh(), name: "h".into(), mutable: false, value: Box::new(boxed), body: Box::new(seq) };
        assert_eq!(crate::interp::eval(&prog).unwrap(), Value::Nat(9));
    }

    #[test]
    fn a_shared_box_is_seen_by_reference_through_a_closure() {
        // Mirrors the by-reference contract: two handles to the SAME cell (via a let binding)
        // observe each other's writes.  let h = $box(0) in let g = h in { $box_set(g, 5); $box_get(h) } == 5
        use crate::core::{Core, NodeGen};
        let mut g = NodeGen::default();
        let apply = |g: &mut NodeGen, name: &str, args: Vec<Core>| {
            Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), name.into())), args)
        };
        // As above: args are hoisted into locals so we never need a second `&mut g` while the
        // `&mut g` passed to `apply` is still live.
        let boxed_args = vec![Core::Nat(g.fresh(), 0)];
        let boxed = apply(&mut g, "$box", boxed_args);
        let set_args = vec![Core::Var(g.fresh(), "g2".into()), Core::Nat(g.fresh(), 5)];
        let set = apply(&mut g, "$box_set", set_args);
        let get_args = vec![Core::Var(g.fresh(), "h".into())];
        let get = apply(&mut g, "$box_get", get_args);
        let seq = Core::Seq(g.fresh(), Box::new(set), Box::new(get));
        let inner = Core::Let {
            id: g.fresh(),
            name: "g2".into(),
            mutable: false,
            value: Box::new(Core::Var(g.fresh(), "h".into())),
            body: Box::new(seq),
        };
        let prog = Core::Let {
            id: g.fresh(),
            name: "h".into(),
            mutable: false,
            value: Box::new(boxed),
            body: Box::new(inner),
        };
        assert_eq!(crate::interp::eval(&prog).unwrap(), Value::Nat(5));
    }

    #[test]
    fn box_get_of_a_non_box_is_a_runtime_error() {
        use crate::core::{Core, NodeGen};
        let mut g = NodeGen::default();
        let get =
            Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), "$box_get".into())), vec![Core::Nat(g.fresh(), 3)]);
        assert!(crate::interp::eval(&get).is_err());
    }

    // --- `Core::LetRecGroup` (mutually recursive binding groups) ---

    use crate::core::NodeGen;

    fn var_node(g: &mut NodeGen, name: &str) -> Core {
        Core::Var(g.fresh(), name.to_string())
    }

    fn nat_node(g: &mut NodeGen, n: u64) -> Core {
        Core::Nat(g.fresh(), n)
    }

    /// `name(arg)` — a single-argument call, built fresh each time.
    fn call(g: &mut NodeGen, name: &str, arg: u64) -> Core {
        Core::Apply(g.fresh(), Box::new(var_node(g, name)), vec![nat_node(g, arg)])
    }

    /// `\n. if n == 0 { true } else { is_odd(n - 1) }`
    fn even_lambda(g: &mut NodeGen) -> Core {
        let cond = Core::BinOp(g.fresh(), BinOp::Eq, Box::new(var_node(g, "n")), Box::new(nat_node(g, 0)));
        let then_branch = Core::Bool(g.fresh(), true);
        let n_minus_1 = Core::BinOp(g.fresh(), BinOp::Sub, Box::new(var_node(g, "n")), Box::new(nat_node(g, 1)));
        let else_branch = Core::Apply(g.fresh(), Box::new(var_node(g, "is_odd")), vec![n_minus_1]);
        let body = Core::If(g.fresh(), Box::new(cond), Box::new(then_branch), Box::new(else_branch));
        Core::Lambda(g.fresh(), vec!["n".to_string()], Box::new(body))
    }

    /// `\n. if n == 0 { false } else { is_even(n - 1) }`
    fn odd_lambda(g: &mut NodeGen) -> Core {
        let cond = Core::BinOp(g.fresh(), BinOp::Eq, Box::new(var_node(g, "n")), Box::new(nat_node(g, 0)));
        let then_branch = Core::Bool(g.fresh(), false);
        let n_minus_1 = Core::BinOp(g.fresh(), BinOp::Sub, Box::new(var_node(g, "n")), Box::new(nat_node(g, 1)));
        let else_branch = Core::Apply(g.fresh(), Box::new(var_node(g, "is_even")), vec![n_minus_1]);
        let body = Core::If(g.fresh(), Box::new(cond), Box::new(then_branch), Box::new(else_branch));
        Core::Lambda(g.fresh(), vec!["n".to_string()], Box::new(body))
    }

    #[test]
    fn a_binding_group_lets_its_members_see_each_other() {
        // letrec is_even = \n. if n == 0 { true } else { is_odd(n-1) }
        //    and is_odd  = \n. if n == 0 { false } else { is_even(n-1) }
        // in is_even(4)
        let mut g = NodeGen::default();
        let group = Core::LetRecGroup(
            g.fresh(),
            vec![("is_even".into(), even_lambda(&mut g)), ("is_odd".into(), odd_lambda(&mut g))],
            Box::new(call(&mut g, "is_even", 4)),
        );
        assert_eq!(eval(&group).unwrap(), Value::Bool(true));
    }
}
