//! Builtin bindings shared by the typechecker and the interpreter. The list primitives live here
//! so `map`/`fold` can be written in the language itself. (`nil`/`cons`/`head`/`tail`/`is_empty`
//! are first-class values, not keywords.)

use crate::ty::{Scheme, Ty};
use crate::value::{Builtin, Value};

/// Names of the builtin values, in a stable order.
pub const BUILTIN_NAMES: [&str; 5] = ["nil", "cons", "head", "tail", "is_empty"];

/// The initial type environment: `name -> polymorphic scheme`.
pub fn type_env() -> Vec<(String, Scheme)> {
    // Type variable 0 stands for the list element type `a`; each scheme quantifies over it.
    let a = || Ty::Var(0);
    let list = || Ty::List(Box::new(a()));
    vec![
        ("nil".into(), Scheme { vars: vec![0], ty: list() }),
        ("cons".into(), Scheme { vars: vec![0], ty: Ty::Fun(vec![a(), list()], Box::new(list())) }),
        ("head".into(), Scheme { vars: vec![0], ty: Ty::Fun(vec![list()], Box::new(a())) }),
        ("tail".into(), Scheme { vars: vec![0], ty: Ty::Fun(vec![list()], Box::new(list())) }),
        ("is_empty".into(), Scheme { vars: vec![0], ty: Ty::Fun(vec![list()], Box::new(Ty::Bool)) }),
    ]
}

/// The initial runtime environment: `name -> builtin value`.
pub fn runtime_env() -> Vec<(String, Value)> {
    vec![
        ("nil".into(), Value::Nil),
        ("cons".into(), Value::Builtin(Builtin::Cons)),
        ("head".into(), Value::Builtin(Builtin::Head)),
        ("tail".into(), Value::Builtin(Builtin::Tail)),
        ("is_empty".into(), Value::Builtin(Builtin::IsEmpty)),
        ("$box".into(), Value::Builtin(Builtin::Box)),
        ("$box_get".into(), Value::Builtin(Builtin::BoxGet)),
        ("$box_set".into(), Value::Builtin(Builtin::BoxSet)),
        // `defunc` synthesizes closure scaffolding (`$applyN`'s tag test, the `cons(tag, env)`
        // representation, and the empty-list terminator that closes a closed closure's env / a
        // captured-value env list / a dispatcher's fault sentinel) and must not have those
        // references captured by a user `fn`/value of the same name. `$` is unforgeable in user
        // source, so these FOUR aliases are uncapturable — confirmed by reading every `Var` node
        // `defunc` mints (every `var(g, ...)` call and `Core::Var` construction in its rewrite
        // passes): `$cons`/`$head`/`$tail`/`$nil` are the ONLY synthesized names that alias one a
        // user program can otherwise bind (`cons`/`head`/`tail`/`nil`, all four in `BUILTIN_NAMES`
        // below); every OTHER synthesized name — `$a{i}`/`$env`/`$clos`/`$apply{arity}`/`$boxh{k}`/
        // `$box`/`$box_get`/`$box_set` — is already `$`-prefixed at its one and only spelling, so it
        // has no bare form to shadow. Same `Value`/`Builtin` variant as the bare name — identical
        // behaviour, including faults (`$nil` is `Value::Nil`, same as `nil`, not a `Builtin` — it
        // is a value, not a function), for `lower_asm`/`run_asm` evaluating an already-lowered call —
        // see `lower_asm.rs`'s `dollar_aliases_match_their_bare_builtins`, which pins both a value and
        // a fault pair per alias. One hop upstream this is not quite true: `lower_program`'s retry
        // through `defunc` treats a bare `$cons`/`$head`/`$tail`/`$nil` as UNBOUND (deliberately absent
        // from `defunc::BUILTIN_FNS`), so a *wrong-arity* alias call reports `call of unbound `$cons``
        // there instead of `arity mismatch calling `$cons`` — same fault CLASS, different text.
        // Unreachable from user source (the lexer rejects `$`) and from `defunc`'s own output (which
        // only ever calls these at their correct arity), so this is a documented asymmetry, not a live
        // behavioural gap. Runtime env ONLY, by convention rather than anything that enforces it: like
        // `$box*`, these are not added to the typecheck env or to `BUILTIN_NAMES` above, but neither
        // omission is load-bearing — nothing in this workspace reads `BUILTIN_NAMES`, and `typeck` only
        // ever sees a user AST, which the lexer already guarantees is `$`-free. So this is a discipline
        // for readers of this file, not a mechanism anything depends on.
        ("$cons".into(), Value::Builtin(Builtin::Cons)),
        ("$head".into(), Value::Builtin(Builtin::Head)),
        ("$tail".into(), Value::Builtin(Builtin::Tail)),
        ("$nil".into(), Value::Nil),
    ]
}
