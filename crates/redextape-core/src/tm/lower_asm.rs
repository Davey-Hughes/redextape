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
        // `scopes` is seeded non-empty in `Ctx::new` and every push is paired with a pop, so `last_mut`
        // always finds a scope; `if let` rather than `unwrap` keeps the no-panic rule mechanical.
        if let Some(scope) = self.scopes.last_mut() {
            scope.push((name.to_string(), r));
        }
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
        // Non-empty for the same reason `scopes` is; see `bind`.
        if let Some(scope) = self.fn_scopes.last_mut() {
            scope.push((name.to_string(), FnInfo { label, arity }));
        }
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
///
/// # Errors
///
/// `Err(LowerError::TooDeep)` if `core`'s nesting exceeds `MAX_LOWER_DEPTH` (see that constant's doc
/// for the measured margin) — the caller's only recourse is a shallower program. `Err(LowerError::
/// Unsupported)` for every construct outside this backend's first-order subset: a function used as a
/// value (`reject_fn_value`), a call of a non-name (higher-order), a call arity mismatch, a call to an
/// unknown/shadowed builtin, or a nested/local function definition. Each carries the offending
/// `NodeId` and a `what` naming the construct; the caller's only recourse is rewriting the source, or
/// routing the program through `defunc` first (see `tm.rs`'s `lower_program`) to eliminate the
/// higher-order constructs this backend does not lower directly.
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
///
/// # Errors
///
/// Exactly `lower_asm_mapped`'s — see that function's `# Errors` section.
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

/// One member of a binding group as `lower_function_group` wants it: `(name, params, body)`.
type FnDef<'a> = (&'a str, &'a [String], &'a Core);

/// Emit every function in `group` as an inline subroutine, all jumped over during linear flow:
/// `jmp skip; f1: <body1> ret; … fn: <bodyn> ret; skip:`.
///
/// **EVERY member's `(label, arity)` is registered in `ctx` before ANY body is lowered.** That
/// ordering *is* mutual recursion: allocating a label and binding it immediately before lowering
/// that one body — what this function did when it only ever took one function — is exactly why a
/// member could not call a sibling. It is pinned by
/// `a_binding_group_lowers_and_runs_on_the_asm_interpreter`, which cannot lower at all if a name is
/// bound late.
///
/// `lower_function` is the n == 1 case and calls straight through, so the single-`LetRec` path and
/// the group path are ONE implementation and cannot drift. For n == 1 the emitted code and the label
/// numbering (`{name}.` then `skip`) are byte-identical to what a single `fn` produced before, which
/// is what keeps the captured step-count goldens still.
fn lower_function_group(ctx: &mut Ctx, group: &[FnDef<'_>]) -> Result<(), LowerError> {
    let labels: Vec<String> = group.iter().map(|(name, ..)| ctx.fresh_label(&format!("{name}."))).collect();
    let skip = ctx.fresh_label("skip");
    for ((name, params, _), label) in group.iter().zip(&labels) {
        ctx.bind_fn(name, label.clone(), params.len());
    }
    ctx.emit(Instr::Jmp(skip.clone()));
    // Iterative over the members (never one recursive call per member): a group's size is a source
    // property, and `MAX_LOWER_DEPTH` bounds the nesting of each body, not how many siblings it has.
    for ((_, params, body), label) in group.iter().zip(&labels) {
        ctx.place(label);
        // Hide the caller's value scopes for the body (not merely push a new one): the body runs in a
        // fresh activation whose locals renumber from 0, so a caller-scope variable would silently
        // alias one of this function's own locals. Hiding them makes any capture resolve to `None`,
        // so the `Var` arm rejects it as unbound -> `Unsupported` — a capturing closure is genuinely
        // higher-order (deferred to defunctionalization, Plan 3b), and a clean error beats a wrong
        // value. `fn_scopes` stays visible so recursion and calls to other functions still resolve —
        // including, now, to the other members of this same group.
        let saved_scopes = std::mem::replace(&mut ctx.scopes, vec![Vec::new()]);
        let saved_next = ctx.next_local;
        ctx.next_local = 0; // each activation has its own local space
        // Bounded by `params.len()`, an ACTUAL `Vec<String>` already resident in memory — unlike
        // `build::MAX_TAPES`'s `tapes N` (a few bytes of text driving an allocation of that size),
        // there is no compact input that forces `i` past `u32::MAX` here: reaching it needs >4 billion
        // parameter strings already parsed and held in memory, far beyond anything this process could
        // allocate. No cap on source-level arity exists or is needed for the same reason `MAX_REGISTERS`
        // gives for register indices (see its doc): the amplifying case this cast could misbehave on is
        // not reachable from real input.
        #[allow(clippy::cast_possible_truncation)]
        for (i, p) in params.iter().enumerate() {
            let slot = ctx.bind(p);
            ctx.emit(Instr::Mov(slot, Reg::Arg(i as u32)));
        }
        lower_into(ctx, body, Reg::Rr)?;
        ctx.emit(Instr::Ret);
        ctx.next_local = saved_next;
        ctx.scopes = saved_scopes;
    }
    ctx.place(&skip);
    Ok(())
}

/// Emit `params`-arity function `body` as an inline subroutine (jumped over during linear flow). The
/// function is registered in `ctx` under `name` before its body is lowered, so it may recurse.
/// Exactly the one-member case of `lower_function_group` — there is ONE emitter, so the single and
/// group paths cannot drift.
fn lower_function(ctx: &mut Ctx, name: &str, params: &[String], body: &Core) -> Result<(), LowerError> {
    lower_function_group(ctx, &[(name, params, body)])
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
            Core::LetRecGroup(_, bindings, body) => {
                bindings.iter().find_map(|(_, v)| walk(v, fname)).or_else(|| walk(body, fname))
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
    //
    // `clippy::match_same_arms`: several names share an arity NUMBER here (`cons`/`$box_set` both 2;
    // `head`/`tail`/`is_empty`/`$head`/`$tail`/`$box`/`$box_get` all 1), but they are not the same
    // case — the dispatch `match` just below sends every one of these names to a DIFFERENT `Instr`.
    // Keeping this table's grouping exactly as written (rather than merged by arity) is what lets a
    // reader check the two matches stay in sync by eye when a builtin is added or removed.
    #[allow(clippy::match_same_arms)]
    let expected_arity = match name {
        "cons" | "$cons" => 2,
        "head" | "tail" | "is_empty" => 1,
        "$head" | "$tail" => 1,
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
        "cons" | "$cons" => ctx.emit(Instr::Cons(dst, regs[0], regs[1])),
        "head" | "$head" => ctx.emit(Instr::Head(dst, regs[0])),
        "tail" | "$tail" => ctx.emit(Instr::Tail(dst, regs[0])),
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

/// `clippy::too_many_lines`: syntax-directed lowering, one arm per `Core` variant — the length comes
/// from the number of variants `Core` has, not from any one arm doing too much. Splitting arms into
/// helpers would scatter a single dispatch that is easiest to audit kept together (a reader checking
/// "does every `Core` variant lower correctly" wants one `match`, not a function per variant).
#[allow(clippy::too_many_lines)]
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
            // `$nil` is `defunc`'s uncapturable scaffolding alias for the empty list (see its module
            // doc and `prelude::runtime_env`'s doc comment): resolve it UNCONDITIONALLY. Unlike bare
            // `nil` below, `$nil` never yields to a local binding — `$` is rejected by the lexer in a
            // user identifier, so no local can ever be named `$nil`, and there is no "yield" case to
            // guard against.
            if name == "$nil" {
                ctx.emit(Instr::Nil(dst));
                return Ok(());
            }
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
        // A mutually recursive binding group: the n-ary `LetRec`, and the same lowering — except
        // every member is registered before any body is lowered, which is what lets the members call
        // one another. Each is a plain named subroutine afterwards; the cycle costs nothing extra at
        // run time (no closure, no dispatch), it is purely a question of when names are bound.
        Core::LetRecGroup(_, bindings, body) => {
            // Validate EVERY value is a function before lowering anything: a non-function member has
            // no entry label to call, and half-emitting a group before discovering that would leave
            // dead subroutines in the program. Unreachable from source (`desugar` builds a group only
            // out of `fn`s), but `Core` is public and this must stay total either way.
            let mut group: Vec<FnDef<'_>> = Vec::with_capacity(bindings.len());
            for (name, value) in bindings {
                let Core::Lambda(_, params, fn_body) = value else {
                    return Err(LowerError::Unsupported {
                        node: value.id(),
                        what: format!("group binding `{name}` is not a function"),
                    });
                };
                group.push((name.as_str(), params.as_slice(), fn_body));
            }
            // EVERY member's name must be call-only in the body, not just the first: a member reached
            // as a bare value is a function-as-a-value use this first-order backend cannot represent.
            for (name, _) in bindings {
                reject_fn_value(body, name)?;
            }
            // ONE `fn_scopes` frame for the whole group — the names are simultaneous, not nested.
            // Shaped exactly like the `LetRec` arm above, down to lowering the body from THIS frame
            // rather than from a combinator's closure: a chain of nested groups recurses once per
            // level here, and `MAX_LOWER_DEPTH`'s stack margin is calibrated against this frame.
            ctx.fn_scopes.push(Vec::new());
            lower_function_group(ctx, &group)?;
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
                // Bounded the same way the params loop in `lower_function_group` is: `staged` is an
                // actual `Vec<Reg>` sized by `args.len()`, so reaching `u32::MAX` here needs a call
                // site with >4 billion argument expressions already parsed into `Core` — not reachable
                // from real input (see that loop's comment for the fuller argument).
                #[allow(clippy::cast_possible_truncation)]
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
            Core::LetRecGroup(_, bindings, body) => {
                for (_, value) in bindings {
                    stack.push(value);
                }
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

    /// The headline: a mutually recursive `fn` pair lowers and computes the reference's answer.
    ///
    /// NEITHER body can be lowered until the OTHER name is already bound — which is exactly the
    /// ordering `lower_function_group` exists to establish. Registering names one-at-a-time, as the
    /// single-`LetRec` path used to, leaves `is_odd` unknown while `is_even`'s body is lowered, and
    /// the call falls through to `lower_builtin_apply` -> `Unsupported`.
    #[test]
    fn a_binding_group_lowers_and_runs_on_the_asm_interpreter() {
        let src = "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
                   fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)";
        assert_eq!(run(src), Value::Bool(true));
        // An odd argument, so the answer comes out of the OTHER member's base case.
        let odd = "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
                   fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(5)";
        assert_eq!(run(odd), Value::Bool(false));
    }

    /// A call inside a group must reach the member it NAMES. Binding a name to a SIBLING's entry
    /// label — a mis-zip of names against labels, which the ordering fix newly makes possible — still
    /// lowers and still terminates, so it is a silent wrong VALUE rather than an error, and only a
    /// program whose two members do different arithmetic can see it.
    ///
    /// Each level contributes its own member's constant, so the answer is a sum over the ALTERNATION:
    /// 1 + 10 + 1 + 0 = 12. Under a swap every call lands in `odd_step`'s body instead (the swap
    /// composes: entering the wrong body, its call to the other name lands wrong again), giving
    /// 10 + 10 + 10 + 0 = 30. A pair that differed only in its base case would NOT catch this — it was
    /// tried, and the swapped program still returned the right number.
    #[test]
    fn each_call_in_a_group_reaches_the_member_it_names() {
        let src = "fn even_step(n){ if n == 0 { 0 } else { 1 + odd_step(n - 1) } } \
                   fn odd_step(n){ if n == 0 { 0 } else { 10 + even_step(n - 1) } } even_step(3)";
        assert_eq!(run(src), Value::Nat(12));
    }

    /// THREE members, not two — an n-ary bug that happens to work at n = 2 is exactly the shape of
    /// defect this codebase keeps finding, and every guard above this one uses a PAIR. `lower_asm`'s
    /// group loop indexes nothing by size, but "it is size-agnostic" is an argument, not evidence.
    ///
    /// Each member contributes its OWN constant at its own level (1 / 2 / 4), so the answer is a
    /// positional sum over the cycle: `s0(4) = 1 + 2 + 4 + 1 + 0 = 8`. A ROTATION (each name bound to
    /// the NEXT member's label) walks the bodies `s1, s0, s2, s1` instead, giving `2 + 1 + 4 + 2 = 9`,
    /// and either transposition gives a different number again. A trio differing only in its base case
    /// would return the same 0 either way, which is the vacuity Task 5 already caught once.
    ///
    /// **The ARGUMENT is what makes a rotation visible, not the constants** — a rotation permutes which
    /// constant lands at which level, so it is observable only when the walk does not consume a whole
    /// number of laps: measured, `s0(n)` differs from the correct answer exactly at `n ≡ 1 (mod 3)`
    /// (`n = 0, 2, 3, 5, 6` all give the rotated and correct sums alike). `4` is chosen for that, and
    /// `s1(4) == 9` enters the same cycle one phase along.
    #[test]
    fn a_three_member_group_lowers_and_each_member_keeps_its_own_body() {
        let src = "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
                   fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
                   fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)";
        assert_eq!(run(src), Value::Nat(8));
        // Entering at a DIFFERENT member walks the same cycle from a different phase, so a lowering
        // that collapsed the group to one body (or bound every name to one label) cannot satisfy
        // both: `s1(4) = 2 + 4 + 1 + 2 + 0 = 9`.
        let from_s1 = "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
                       fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
                       fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s1(4)";
        assert_eq!(run(from_s1), Value::Nat(9));
    }

    /// `reject_fn_value` must run for EVERY member, not just the first: any member used as a bare
    /// value in the body is a function-as-a-value use this backend cannot represent.
    ///
    /// The message is asserted, not merely `Unsupported`: without the per-member check the bare
    /// `is_odd` still fails, but as the generic `unbound` fallback from the `Var` arm — so a
    /// `matches!(.., Unsupported { .. })` assertion here would pass with the guard deleted.
    #[test]
    fn a_group_member_used_as_a_value_in_the_body_is_rejected_by_name() {
        let src = "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
                   fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } \
                   let g = is_odd; is_even(4)";
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        match lower_asm(&core) {
            Err(LowerError::Unsupported { what, .. }) => {
                assert_eq!(what, "`is_odd` used as a value", "the group's own check must be what fires");
            }
            other => panic!("expected the group member's value use to be rejected, got {other:?}"),
        }
    }

    /// Every binding's value must be a `Lambda` before anything is lowered, and the error must name
    /// the offending binding. Unreachable from source (`desugar` only ever builds a group out of
    /// `fn`s), so the group is built by hand.
    #[test]
    fn a_group_binding_that_is_not_a_function_names_itself() {
        use crate::core::NodeGen;
        let mut g = NodeGen::default();
        let lam = Core::Lambda(g.fresh(), vec!["x".into()], Box::new(Core::Var(g.fresh(), "x".into())));
        let group = Core::LetRecGroup(
            g.fresh(),
            vec![("f".to_string(), lam), ("g".to_string(), Core::Nat(g.fresh(), 1))],
            Box::new(Core::Nat(g.fresh(), 0)),
        );
        match lower_asm(&group) {
            // The message names the OFFENDING binding (`g`), not the group and not the first member.
            Err(LowerError::Unsupported { what, .. }) => {
                assert_eq!(what, "group binding `g` is not a function");
            }
            other => panic!("expected a non-function binding to be rejected, got {other:?}"),
        }
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

    /// `$cons`/`$head`/`$tail`/`$nil` are aliases for the bare builtins/value, existing so `defunc`'s
    /// synthesized scaffolding cannot be captured by a user `fn`/value of the same name (`$` is
    /// unforgeable in user source). An alias that behaved even slightly differently would be worse
    /// than the bug it fixes, so pin equivalence on both a value and a fault.
    ///
    /// `$` is rejected by the lexer in an identifier, so (unlike most tests in this module) there is
    /// no source string to `parse` for the dollar side — each program is built by hand, exactly like
    /// `box_builtins_lower_and_run_on_the_asm_interpreter` above. The reference interpreter doesn't
    /// know the dollar names either (they exist only in `defunc`'s output, never typechecked or
    /// evaluated on their own), so the BARE program's reference value stands in as `decode_asm`'s type
    /// witness for both sides of each pair.
    #[test]
    fn dollar_aliases_match_their_bare_builtins() {
        use crate::core::NodeGen;

        fn lower_and_run(core: &Core, witness: &Value) -> Value {
            let program = lower_asm(core).expect("lowering failed");
            match run_asm(&program, DEFAULT_CAPS) {
                AsmRun::Ran(o) => decode_asm(&o, witness).expect("decode failed"),
                other => panic!("asm did not run: {other:?}"),
            }
        }
        // The fault side of the equivalence: `AsmRun::Fault` carries the message directly, no
        // `witness`/`decode_asm` needed (there is no value to decode).
        fn lower_and_fault(core: &Core) -> String {
            let program = lower_asm(core).expect("lowering failed");
            match run_asm(&program, DEFAULT_CAPS) {
                AsmRun::Fault(msg) => msg,
                other => panic!("expected a fault, got: {other:?}"),
            }
        }
        let mut g = NodeGen::default();
        let ap = |g: &mut NodeGen, n: &str, a: Vec<Core>| {
            Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), n.into())), a)
        };

        // `cons(7, nil)` vs `$cons(7, nil)`.
        let bare_args = vec![Core::Nat(g.fresh(), 7), Core::Var(g.fresh(), "nil".into())];
        let bare_cons = ap(&mut g, "cons", bare_args);
        let witness = crate::interp::eval(&bare_cons).expect("reference eval failed");
        let want = lower_and_run(&bare_cons, &witness);
        let dollar_args = vec![Core::Nat(g.fresh(), 7), Core::Var(g.fresh(), "nil".into())];
        let dollar_cons = ap(&mut g, "$cons", dollar_args);
        let got = lower_and_run(&dollar_cons, &witness);
        assert_eq!(got, want, "`$cons(7, nil)` must behave exactly as `cons(7, nil)`");

        // `head(cons(7, nil))` vs `$head(cons(7, nil))`.
        let inner_args = vec![Core::Nat(g.fresh(), 7), Core::Var(g.fresh(), "nil".into())];
        let inner = ap(&mut g, "cons", inner_args);
        let bare_head = ap(&mut g, "head", vec![inner]);
        let witness = crate::interp::eval(&bare_head).expect("reference eval failed");
        let want = lower_and_run(&bare_head, &witness);
        let inner_args2 = vec![Core::Nat(g.fresh(), 7), Core::Var(g.fresh(), "nil".into())];
        let inner2 = ap(&mut g, "cons", inner_args2);
        let dollar_head = ap(&mut g, "$head", vec![inner2]);
        let got = lower_and_run(&dollar_head, &witness);
        assert_eq!(got, want, "`$head(cons(7, nil))` must behave exactly as `head(cons(7, nil))`");

        // `tail(cons(7, nil))` vs `$tail(cons(7, nil))`.
        let inner_args3 = vec![Core::Nat(g.fresh(), 7), Core::Var(g.fresh(), "nil".into())];
        let inner3 = ap(&mut g, "cons", inner_args3);
        let bare_tail = ap(&mut g, "tail", vec![inner3]);
        let witness = crate::interp::eval(&bare_tail).expect("reference eval failed");
        let want = lower_and_run(&bare_tail, &witness);
        let inner_args4 = vec![Core::Nat(g.fresh(), 7), Core::Var(g.fresh(), "nil".into())];
        let inner4 = ap(&mut g, "cons", inner_args4);
        let dollar_tail = ap(&mut g, "$tail", vec![inner4]);
        let got = lower_and_run(&dollar_tail, &witness);
        assert_eq!(got, want, "`$tail(cons(7, nil))` must behave exactly as `tail(cons(7, nil))`");

        // The FAULT side of the equivalence, not just the value side: `head(nil)` vs `$head(nil)`.
        let nil1 = Core::Var(g.fresh(), "nil".into());
        let bare_head_nil = ap(&mut g, "head", vec![nil1]);
        let want = lower_and_fault(&bare_head_nil);
        let nil2 = Core::Var(g.fresh(), "nil".into());
        let dollar_head_nil = ap(&mut g, "$head", vec![nil2]);
        let got = lower_and_fault(&dollar_head_nil);
        assert_eq!(got, want, "`$head(nil)` must fault exactly as `head(nil)`");

        // `tail(nil)` vs `$tail(nil)`.
        let nil3 = Core::Var(g.fresh(), "nil".into());
        let bare_tail_nil = ap(&mut g, "tail", vec![nil3]);
        let want = lower_and_fault(&bare_tail_nil);
        let nil4 = Core::Var(g.fresh(), "nil".into());
        let dollar_tail_nil = ap(&mut g, "$tail", vec![nil4]);
        let got = lower_and_fault(&dollar_tail_nil);
        assert_eq!(got, want, "`$tail(nil)` must fault exactly as `tail(nil)`");

        // Bare `nil` vs bare `$nil`. Unlike the other three, `nil` is a VALUE, not a function — so
        // there is no wrapping `Apply` to build; the whole program is just the one `Var`.
        let bare_nil = Core::Var(g.fresh(), "nil".into());
        let witness = crate::interp::eval(&bare_nil).expect("reference eval failed");
        let want = lower_and_run(&bare_nil, &witness);
        let dollar_nil = Core::Var(g.fresh(), "$nil".into());
        let got = lower_and_run(&dollar_nil, &witness);
        assert_eq!(got, want, "`$nil` must behave exactly as `nil`");
    }
}
