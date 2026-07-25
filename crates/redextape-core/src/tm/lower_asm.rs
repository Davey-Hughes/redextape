//! Core AST -> register-assembly `Program`, first-order subset. Syntax-directed and total (returns
//! `LowerError`, never panics). Emitted code leaves the whole program's result in `Reg::Rr` and ends
//! with `Halt`; each function is emitted inline, jumped over during linear flow and entered by `Call`.

use crate::core::{Core, NodeId};
use crate::tm::asm::{Instr, Program, Reg};

/// Why lowering could not produce a program.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LowerError {
    /// A construct the first-order TM backend does not support (e.g. a function used as a value).
    Unsupported { node: NodeId, what: String },
    /// Core nested deeper than the lowering guard allows (bounds native recursion).
    TooDeep { node: NodeId },
}

/// Bounds `lower_into` recursion so a deeply-nested Core (a huge list literal desugars to a deep
/// `cons`-`Apply` spine) yields `TooDeep` instead of overflowing the native stack. Tuned for the
/// production 8 MiB main thread with a ~2x margin, exactly like the Plan 1 guards (whose real
/// stack-safety invariant is the margin, not a numeric match to any other guard). Empirically, an
/// unguarded `lower_into` overflows the 8 MiB stack at a recursion depth of ~1175 (measured in both
/// debug and coverage-instrumented builds by lowering list literals of increasing length until the
/// native stack aborts; a `lower_into`/`lower_inner` frame is fatter than an `eval` frame, so this
/// crashes shallower than `interp::MAX_EVAL_DEPTH`'s reference point). 580 leaves ~2x margin below
/// that crash and still admits every realistic first-order program — a 580-deep nesting / 580-element
/// list literal is far beyond anything real. Do NOT tune this against a smaller test thread: 580
/// native frames need a few MiB, so an artificially tiny 512 KiB thread would overflow at depth ~90 —
/// long before the guard fires. The deep-Core safety test runs on an explicit 8 MiB thread for
/// exactly this reason.
const MAX_LOWER_DEPTH: u32 = 580;

/// A bound function's calling info: its entry label and the number of arguments it takes.
struct FnInfo {
    label: String,
    arity: usize,
}

struct Ctx {
    code: Vec<Instr>,
    labels: Vec<(String, usize)>,
    /// Lexical scopes of value bindings: name -> local register. Innermost last.
    scopes: Vec<Vec<(String, Reg)>>,
    /// Function bindings in scope: name -> (label, arity). Innermost scope last.
    fn_scopes: Vec<Vec<(String, FnInfo)>>,
    next_local: u32,
    next_label: u32,
    depth: u32,
    /// Parallel to `code`: `origins[i]` is the `Core` node whose lowering emitted `code[i]`.
    origins: Vec<NodeId>,
    /// The node currently being lowered. Instructions with no direct source analogue — jumps, frame
    /// setup, a function's prologue — bill their ENCLOSING construct, which is what a reader wants:
    /// the cost of an `if` should include the branch it required.
    current: NodeId,
}

impl Ctx {
    fn new() -> Self {
        Ctx {
            code: Vec::new(),
            labels: Vec::new(),
            scopes: vec![Vec::new()],
            fn_scopes: vec![Vec::new()],
            next_local: 0,
            next_label: 0,
            depth: 0,
            origins: Vec::new(),
            current: 0,
        }
    }

    fn emit(&mut self, i: Instr) {
        self.code.push(i);
        self.origins.push(self.current);
    }

    fn fresh_local(&mut self) -> Reg {
        let r = Reg::Loc(self.next_local);
        self.next_local += 1;
        r
    }

    fn fresh_label(&mut self, hint: &str) -> String {
        let l = format!("{hint}{}", self.next_label);
        self.next_label += 1;
        l
    }

    /// Bind `name` to a fresh local in the current scope and return that register. Used when
    /// `Lambda` lowering binds several parameters into one shared call-frame scope.
    fn bind(&mut self, name: &str) -> Reg {
        let r = self.fresh_local();
        self.scopes.last_mut().unwrap().push((name.to_string(), r));
        r
    }

    /// Resolve a value binding (innermost first).
    fn resolve(&self, name: &str) -> Option<Reg> {
        for scope in self.scopes.iter().rev() {
            if let Some((_, r)) = scope.iter().rev().find(|(n, _)| n == name) {
                return Some(*r);
            }
        }
        None
    }

    /// Resolve a function binding (innermost first).
    fn resolve_fn(&self, name: &str) -> Option<&FnInfo> {
        for scope in self.fn_scopes.iter().rev() {
            if let Some((_, info)) = scope.iter().rev().find(|(n, _)| n == name) {
                return Some(info);
            }
        }
        None
    }

    /// Bind `name` to a function's entry `label` and `arity` in the current function scope.
    fn bind_fn(&mut self, name: &str, label: String, arity: usize) {
        self.fn_scopes.last_mut().unwrap().push((name.to_string(), FnInfo { label, arity }));
    }

    /// Place a label at the current end of `code`.
    fn place(&mut self, label: &str) {
        self.labels.push((label.to_string(), self.code.len()));
    }
}

/// Lower `core` to register-asm, returning the program AND its source map: `origins[i]` is the
/// `Core` node whose lowering emitted `code[i]`.
///
/// The map is returned rather than stored on `Program` deliberately. `Program` derives `PartialEq`
/// and is compared in the asm goldens; a side-table field would change equality and break them for a
/// reason that has nothing to do with what the program computes.
pub fn lower_asm_mapped(core: &Core) -> Result<(Program, Vec<NodeId>), LowerError> {
    let mut ctx = Ctx::new();
    lower_into(&mut ctx, core, Reg::Rr)?;
    // `lower_into` restores `current` to whatever it was on entry once it returns, so without this
    // the final `Halt` (emitted outside any `lower_into` call) would bill a stale node.
    ctx.current = core.id();
    ctx.emit(Instr::Halt);
    Ok((Program { code: ctx.code, labels: ctx.labels }, ctx.origins))
}

/// Lower `core` to register-asm. Exactly `lower_asm_mapped` with the source map discarded — there is
/// ONE lowering implementation, so the mapped and unmapped paths cannot drift.
pub fn lower_asm(core: &Core) -> Result<Program, LowerError> {
    lower_asm_mapped(core).map(|(p, _)| p)
}

/// Emit code that computes `core` into register `dst`.
fn lower_into(ctx: &mut Ctx, core: &Core, dst: Reg) -> Result<(), LowerError> {
    ctx.depth += 1;
    if ctx.depth > MAX_LOWER_DEPTH {
        ctx.depth -= 1;
        return Err(LowerError::TooDeep { node: core.id() });
    }
    let saved = ctx.current;
    ctx.current = core.id();
    let r = lower_inner(ctx, core, dst);
    ctx.current = saved;
    ctx.depth -= 1;
    r
}

/// Emit `params`-arity function `body` as an inline subroutine (jumped over during linear flow).
/// Returns the entry label. The function is registered in `ctx` under `name` before its body is
/// lowered, so it may recurse.
fn lower_function(ctx: &mut Ctx, name: &str, params: &[String], body: &Core) -> Result<String, LowerError> {
    let label = ctx.fresh_label(&format!("{name}."));
    let skip = ctx.fresh_label("skip");
    ctx.bind_fn(name, label.clone(), params.len());
    ctx.emit(Instr::Jmp(skip.clone()));
    ctx.place(&label);
    // Hide the caller's value scopes for the body (not merely push a new one): the body runs in a
    // fresh activation whose locals renumber from 0, so a caller-scope variable would silently alias
    // one of this function's own locals. Hiding them makes any capture resolve to `None`, so the
    // `Var` arm rejects it as unbound -> `Unsupported` — a capturing closure is genuinely
    // higher-order (deferred to defunctionalization, Plan 3b), and a clean error beats a wrong value.
    // `fn_scopes` stays visible so recursion and calls to other functions still resolve.
    let saved_scopes = std::mem::replace(&mut ctx.scopes, vec![Vec::new()]);
    let saved_next = ctx.next_local;
    ctx.next_local = 0; // each activation has its own local space
    for (i, p) in params.iter().enumerate() {
        let slot = ctx.bind(p);
        ctx.emit(Instr::Mov(slot, Reg::Arg(i as u32)));
    }
    lower_into(ctx, body, Reg::Rr)?;
    ctx.emit(Instr::Ret);
    ctx.next_local = saved_next;
    ctx.scopes = saved_scopes;
    ctx.place(&skip);
    Ok(label)
}

/// `Ok(())` iff `fname` is used in `body` only as the callee of an `Apply` (never as a bare value).
/// Any other occurrence is a function-as-a-value use -> `Unsupported`.
fn reject_fn_value(body: &Core, fname: &str) -> Result<(), LowerError> {
    fn walk(c: &Core, fname: &str) -> Option<NodeId> {
        match c {
            Core::Var(id, name) => (name == fname).then_some(*id),
            Core::Apply(_, callee, args) => {
                // The callee being exactly `fname` is allowed; still scan the args.
                let callee_ok = matches!(callee.as_ref(), Core::Var(_, n) if n == fname);
                if !callee_ok && let Some(id) = walk(callee, fname) {
                    return Some(id);
                }
                args.iter().find_map(|a| walk(a, fname))
            }
            Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) | Core::While(_, a, b) => {
                walk(a, fname).or_else(|| walk(b, fname))
            }
            Core::If(_, a, b, d) => walk(a, fname).or_else(|| walk(b, fname)).or_else(|| walk(d, fname)),
            Core::Lambda(_, _, b) | Core::Assign(_, _, b) => walk(b, fname),
            Core::Let { value, body, .. } | Core::LetRec { value, body, .. } => {
                walk(value, fname).or_else(|| walk(body, fname))
            }
            Core::Nat(..) | Core::Bool(..) | Core::Unit(..) => None,
        }
    }
    match walk(body, fname) {
        Some(node) => Err(LowerError::Unsupported { node, what: format!("`{fname}` used as a value") }),
        None => Ok(()),
    }
}

/// Lower a prelude list builtin applied to `args`, or `Unsupported` for an unknown callee. `nil` in
/// callee position is unusual (it is a value, handled as a `Var`), so only the functions appear here.
fn lower_builtin_apply(ctx: &mut Ctx, id: NodeId, name: &str, args: &[Core], dst: Reg) -> Result<(), LowerError> {
    // Any of these being shadowed by a local binding is a function-as-a-value use we do not support.
    let expected_arity = match name {
        "cons" => 2,
        "head" | "tail" | "is_empty" => 1,
        "$box" | "$box_get" => 1,
        "$box_set" => 2,
        _ => return Err(LowerError::Unsupported { node: id, what: format!("call of unknown function `{name}`") }),
    };
    if args.len() != expected_arity {
        return Err(LowerError::Unsupported { node: id, what: format!("arity mismatch calling `{name}`") });
    }
    // Lower the argument expressions into fresh locals first.
    let mut regs = Vec::with_capacity(args.len());
    for a in args {
        let r = ctx.fresh_local();
        lower_into(ctx, a, r)?;
        regs.push(r);
    }
    match name {
        "cons" => ctx.emit(Instr::Cons(dst, regs[0], regs[1])),
        "head" => ctx.emit(Instr::Head(dst, regs[0])),
        "tail" => ctx.emit(Instr::Tail(dst, regs[0])),
        "is_empty" => ctx.emit(Instr::IsEmpty(dst, regs[0])),
        "$box" => ctx.emit(Instr::Box(dst, regs[0])),
        "$box_get" => ctx.emit(Instr::BoxGet(dst, regs[0])),
        "$box_set" => {
            ctx.emit(Instr::BoxSet(regs[0], regs[1]));
            ctx.emit(Instr::Li(dst, 0)); // $box_set evaluates to unit
        }
        _ => unreachable!("arity table and dispatch agree"),
    }
    Ok(())
}

fn lower_inner(ctx: &mut Ctx, core: &Core, dst: Reg) -> Result<(), LowerError> {
    match core {
        Core::Nat(_, n) => {
            ctx.emit(Instr::Li(dst, *n));
            Ok(())
        }
        Core::Bool(_, b) => {
            ctx.emit(Instr::Li(dst, u64::from(*b)));
            Ok(())
        }
        Core::Var(id, name) => {
            if name == "nil" && ctx.resolve(name).is_none() {
                ctx.emit(Instr::Nil(dst));
                return Ok(());
            }
            match ctx.resolve(name) {
                Some(src) => {
                    if src != dst {
                        ctx.emit(Instr::Mov(dst, src));
                    }
                    Ok(())
                }
                None => Err(LowerError::Unsupported { node: *id, what: format!("unbound `{name}`") }),
            }
        }
        Core::BinOp(_, op, a, b) => {
            let ra = ctx.fresh_local();
            lower_into(ctx, a, ra)?;
            let rb = ctx.fresh_local();
            lower_into(ctx, b, rb)?;
            ctx.emit(Instr::Bin(*op, dst, ra, rb));
            Ok(())
        }
        Core::If(_, c, t, e) => {
            let rc = ctx.fresh_local();
            lower_into(ctx, c, rc)?;
            let else_l = ctx.fresh_label("else");
            let end_l = ctx.fresh_label("endif");
            ctx.emit(Instr::Jz(rc, else_l.clone()));
            lower_into(ctx, t, dst)?;
            ctx.emit(Instr::Jmp(end_l.clone()));
            ctx.place(&else_l);
            lower_into(ctx, e, dst)?;
            ctx.place(&end_l);
            Ok(())
        }
        Core::Let { name, mutable: false, value, body, .. } => {
            // A call-only-bound lambda lowers as a named function; otherwise it is used as a value
            // -> Unsupported (falls through to the general value path, which hits the Lambda arm).
            if let Core::Lambda(_, params, fn_body) = value.as_ref()
                && reject_fn_value(body, name).is_ok()
            {
                ctx.fn_scopes.push(Vec::new());
                lower_function(ctx, name, params, fn_body)?;
                let r = lower_into(ctx, body, dst);
                ctx.fn_scopes.pop();
                return r;
            }
            let slot = ctx.fresh_local();
            lower_into(ctx, value, slot)?;
            ctx.scopes.push(vec![(name.clone(), slot)]);
            let r = lower_into(ctx, body, dst);
            ctx.scopes.pop();
            r
        }
        Core::Seq(_, first, then) => {
            let throwaway = ctx.fresh_local();
            lower_into(ctx, first, throwaway)?;
            lower_into(ctx, then, dst)
        }
        Core::Let { name, mutable: true, value, body, .. } => {
            let slot = ctx.fresh_local();
            lower_into(ctx, value, slot)?;
            ctx.scopes.push(vec![(name.clone(), slot)]);
            let r = lower_into(ctx, body, dst);
            ctx.scopes.pop();
            r
        }
        Core::Assign(id, name, value) => {
            let slot = ctx
                .resolve(name)
                .ok_or_else(|| LowerError::Unsupported { node: *id, what: format!("assign to unbound `{name}`") })?;
            lower_into(ctx, value, slot)?; // recompute into the variable's own register
            ctx.emit(Instr::Li(dst, 0)); // the assignment expression's Unit result
            Ok(())
        }
        Core::While(_, cond, body) => {
            let top = ctx.fresh_label("while");
            let done = ctx.fresh_label("endwhile");
            ctx.place(&top);
            let rc = ctx.fresh_local();
            lower_into(ctx, cond, rc)?;
            ctx.emit(Instr::Jz(rc, done.clone()));
            let throwaway = ctx.fresh_local();
            lower_into(ctx, body, throwaway)?;
            ctx.emit(Instr::Jmp(top.clone()));
            ctx.place(&done);
            ctx.emit(Instr::Li(dst, 0)); // the loop's Unit result
            Ok(())
        }
        Core::Unit(_) => {
            ctx.emit(Instr::Li(dst, 0));
            Ok(())
        }
        Core::LetRec { name, value, body, .. } => {
            let Core::Lambda(_, params, fn_body) = value.as_ref() else {
                return Err(LowerError::Unsupported {
                    node: core.id(),
                    what: "letrec value is not a function".to_string(),
                });
            };
            reject_fn_value(body, name)?; // the fn name must be call-only in the body
            ctx.fn_scopes.push(Vec::new());
            lower_function(ctx, name, params, fn_body)?;
            let r = lower_into(ctx, body, dst);
            ctx.fn_scopes.pop();
            r
        }
        Core::Lambda(id, ..) => {
            // A bare lambda in value position is a function-as-a-value use (a call-only Let binding
            // is handled by the Let arm above).
            Err(LowerError::Unsupported { node: *id, what: "function used as a value".to_string() })
        }
        Core::Apply(id, callee, args) => {
            let Core::Var(_, fname) = callee.as_ref() else {
                return Err(LowerError::Unsupported {
                    node: *id,
                    what: "call of a non-name (higher-order)".to_string(),
                });
            };
            // Prelude list builtins are handled in Task 9; defer to it if not a known function.
            if let Some(info) = ctx.resolve_fn(fname) {
                if info.arity != args.len() {
                    return Err(LowerError::Unsupported {
                        node: *id,
                        what: format!("arity mismatch calling `{fname}`"),
                    });
                }
                let label = info.label.clone();
                // Stage each argument into its own fresh (frame-saved) `Loc` register before moving
                // them into the volatile `Arg` bank right before `Call`. Writing straight into
                // `Arg(i)` while evaluating argument i would be clobbered if a *later* argument's
                // evaluation itself calls a function, since that nested call's own arg setup reuses
                // low-numbered `Arg` registers (they are not saved/restored across `call`/`ret`).
                let staged: Vec<Reg> = args.iter().map(|_| ctx.fresh_local()).collect();
                for (a, r) in args.iter().zip(&staged) {
                    lower_into(ctx, a, *r)?;
                }
                for (i, r) in staged.iter().enumerate() {
                    ctx.emit(Instr::Mov(Reg::Arg(i as u32), *r));
                }
                ctx.emit(Instr::Call(label));
                if dst != Reg::Rr {
                    ctx.emit(Instr::Mov(dst, Reg::Rr));
                }
                Ok(())
            } else {
                lower_builtin_apply(ctx, *id, fname, args, dst) // Task 9
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::parser::parse;
    use crate::tm::asm::{AsmRun, DEFAULT_CAPS, decode_asm, run_asm};
    use crate::value::Value;

    /// Every owned `Core` id, reachable from `core` by an ITERATIVE walk (mirrors `Core`'s own
    /// hand-written iterative `Drop`): a big list literal desugars to a spine tens of thousands of
    /// nodes deep, and a recursive walk here would overflow the native stack just like an unguarded
    /// recursive `Drop` would.
    fn all_node_ids(core: &Core) -> std::collections::BTreeSet<NodeId> {
        let mut out = std::collections::BTreeSet::new();
        let mut stack = vec![core];
        while let Some(n) = stack.pop() {
            out.insert(n.id());
            push_children(n, &mut stack);
        }
        out
    }

    /// Push every child of `core` onto `stack`. Mirrors `core::take_core_children`'s match arms
    /// exactly (grouping and all) so a new `Core` variant cannot be silently missed here: that
    /// function is the authority on which children each variant has, since it must already enumerate
    /// all of them for `Core`'s iterative `Drop` to be correct.
    fn push_children<'a>(core: &'a Core, stack: &mut Vec<&'a Core>) {
        match core {
            Core::BinOp(_, _, a, b) => {
                stack.push(a);
                stack.push(b);
            }
            Core::Seq(_, a, b) | Core::While(_, a, b) => {
                stack.push(a);
                stack.push(b);
            }
            Core::If(_, a, b, c) => {
                stack.push(a);
                stack.push(b);
                stack.push(c);
            }
            Core::Lambda(_, _, b) | Core::Assign(_, _, b) => {
                stack.push(b);
            }
            Core::Apply(_, f, args) => {
                stack.push(f);
                stack.extend(args.iter());
            }
            Core::Let { value, body, .. } | Core::LetRec { value, body, .. } => {
                stack.push(value);
                stack.push(body);
            }
            // Truly childless leaves.
            Core::Nat(..) | Core::Bool(..) | Core::Unit(..) | Core::Var(..) => {}
        }
    }

    #[test]
    fn every_instruction_has_an_origin_from_the_program_it_lowered() {
        let core = desugar(&parse("fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(3)").0.unwrap());
        let (prog, origins) = lower_asm_mapped(&core).expect("lowers");
        assert_eq!(origins.len(), prog.code.len(), "origins must be parallel to code");
        // Every origin must be a real node id in the program being lowered.
        let ids = all_node_ids(&core);
        for (i, id) in origins.iter().enumerate() {
            assert!(ids.contains(id), "instruction {i} ({:?}) has origin {id}, not a node in the Core", prog.code[i]);
        }
    }

    /// The program's terminating `Halt` must bill the top-level node, not a stale one.
    ///
    /// `Halt` is the one instruction `lower_asm_mapped` emits itself, AFTER `lower_into` has already
    /// restored `current` to its pre-call value (0) — so it needs the explicit `ctx.current =
    /// core.id()` that precedes it. Without that line the `Halt` silently bills node id 0, which is a
    /// perfectly real node (the first leaf `desugar` mints) and therefore slips past
    /// `every_instruction_has_an_origin_from_the_program_it_lowered`'s membership check. This test
    /// pins the attribution itself, so deleting that line fails a test instead of quietly
    /// mis-attributing the whole program's terminator.
    #[test]
    fn the_final_halt_bills_the_top_level_node() {
        let core = desugar(&parse("1 + 2 * 3").0.unwrap());
        // Guards against the test going vacuous: it can only distinguish "billed the root" from
        // "billed the leftover 0" while the root's id is not itself 0.
        assert_ne!(core.id(), 0, "root id must differ from Ctx::new's initial `current`");
        let (prog, origins) = lower_asm_mapped(&core).expect("lowers");
        assert!(matches!(prog.code.last(), Some(Instr::Halt)), "the program ends in Halt: {:?}", prog.code.last());
        assert_eq!(
            *origins.last().expect("a non-empty program"),
            core.id(),
            "the final Halt must bill the top-level node, not whatever `current` was left holding"
        );
    }

    #[test]
    fn arithmetic_attributes_to_its_own_binop_node() {
        // `2 * 3` lowers to two `Li`s and a `Bin`; the `Bin` must bill the BinOp node, not a literal.
        let core = desugar(&parse("2 * 3").0.unwrap());
        let (prog, origins) = lower_asm_mapped(&core).expect("lowers");
        let bin = prog.code.iter().position(|i| matches!(i, Instr::Bin(..))).expect("a Bin instruction");
        assert_eq!(origins[bin], core.id(), "the multiply must bill the BinOp node");
    }

    /// source -> desugar -> lower_asm -> run_asm -> decode_asm, using the reference result as the
    /// type witness. Returns the decoded value (equals the reference iff asm computed the right one).
    fn run(src: &str) -> Value {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let expected = crate::run(src).expect("reference run failed");
        let program = lower_asm(&core).expect("lowering failed");
        match run_asm(&program, DEFAULT_CAPS) {
            AsmRun::Ran(o) => decode_asm(&o, &expected).expect("decode failed"),
            other => panic!("asm did not run: {other:?}"),
        }
    }

    #[test]
    fn arithmetic_and_monus() {
        assert_eq!(run("1 + 2 * 3"), Value::Nat(7));
        assert_eq!(run("3 - 5"), Value::Nat(0));
    }

    #[test]
    fn comparisons_and_if() {
        assert_eq!(run("if 2 > 1 { 10 } else { 20 }"), Value::Nat(10));
        assert_eq!(run("if 1 == 2 { 10 } else { 20 }"), Value::Nat(20));
    }

    #[test]
    fn let_bindings() {
        assert_eq!(run("let x = 40; x + 2"), Value::Nat(42));
        assert_eq!(run("let x = 1; let y = x + x; y * 3"), Value::Nat(6));
    }

    #[test]
    fn while_loop_and_mutation() {
        // count_down's loop body inlined (a top-level call needs Task 8).
        let inline = "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc";
        assert_eq!(run(inline), Value::Nat(4));
    }

    #[test]
    fn assignment_updates_in_place() {
        assert_eq!(run("let mut x = 1; x = x + 10; x = x * 2; x"), Value::Nat(22));
    }

    #[test]
    fn recursion_via_fn() {
        assert_eq!(run("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"), Value::Nat(15));
    }

    #[test]
    fn count_down_with_a_call() {
        let src = "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)";
        assert_eq!(run(src), Value::Nat(4));
    }

    #[test]
    fn directly_applied_lambda_is_a_named_subroutine() {
        assert_eq!(run("let add1 = |x| x + 1; add1(41)"), Value::Nat(42));
    }

    #[test]
    fn function_as_a_value_is_unsupported() {
        // `apply2` receives a function argument -> higher-order -> Unsupported (deferred to 3b).
        let src = "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)";
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        assert!(matches!(lower_asm(&core), Err(LowerError::Unsupported { .. })));
    }

    #[test]
    fn multi_arg_call_with_a_nested_call_in_a_later_argument() {
        // A regression test for argument staging: evaluating `add1(2)` for the second argument must
        // not clobber the first argument (`1`), which was already computed into `Arg(0)`.
        let src = "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))";
        assert_eq!(run(src), Value::Nat(4));
    }

    #[test]
    fn list_builtins_and_literals() {
        assert_eq!(run("head(cons(7, nil))"), Value::Nat(7));
        assert_eq!(run("is_empty(nil)"), Value::Bool(true));
        assert_eq!(run("is_empty(cons(1, nil))"), Value::Bool(false));
        assert_eq!(run("[1, 2, 3]"), Value::list_of_nats(&[1, 2, 3]));
    }

    #[test]
    fn a_capturing_closure_is_unsupported_not_a_wrong_answer() {
        // `f` captures the outer `c`. Lowering it as a subroutine would silently alias `c` to the
        // callee's own local frame (computing `x + x`), so a capture must be rejected, not miscompiled.
        let src = "let c = 5; let f = |x| x + c; f(1)";
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        assert!(matches!(lower_asm(&core), Err(LowerError::Unsupported { .. })));
    }

    #[test]
    fn box_builtins_lower_and_run_on_the_asm_interpreter() {
        use crate::core::{Core, NodeGen};
        use crate::tm::asm::{AsmRun, DEFAULT_CAPS, run_asm};
        // let h = $box(1) in { $box_set(h, 6); $box_get(h) }  ==> reference 6 == asm-interp 6
        let mut g = NodeGen::default();
        let ap = |g: &mut NodeGen, n: &str, a: Vec<Core>| {
            Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), n.into())), a)
        };
        // Each call's arguments are built into a local `Vec` first (rather than inline inside the
        // `ap(&mut g, ...)` call) so evaluating them doesn't need a second concurrent `&mut g` while
        // the first is still live.
        let boxed_args = vec![Core::Nat(g.fresh(), 1)];
        let boxed = ap(&mut g, "$box", boxed_args);
        let set_args = vec![Core::Var(g.fresh(), "h".into()), Core::Nat(g.fresh(), 6)];
        let set = ap(&mut g, "$box_set", set_args);
        let get_args = vec![Core::Var(g.fresh(), "h".into())];
        let get = ap(&mut g, "$box_get", get_args);
        let body = Core::Seq(g.fresh(), Box::new(set), Box::new(get));
        let prog =
            Core::Let { id: g.fresh(), name: "h".into(), mutable: false, value: Box::new(boxed), body: Box::new(body) };
        let expected = crate::interp::eval(&prog).unwrap();
        assert_eq!(expected, crate::value::Value::Nat(6));
        let asm = lower_asm(&prog).expect("box builtins lower");
        match run_asm(&asm, DEFAULT_CAPS) {
            AsmRun::Ran(out) => assert_eq!(out.result, 6),
            other => panic!("asm did not run: {other:?}"),
        }
    }
}
