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
    ]
}
