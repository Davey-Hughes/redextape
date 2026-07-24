//! Runtime values for the reference interpreter (the oracle). Lists are cons-cells so the shape
//! matches the Scott encoding the λ backend will use later.

use crate::core::Core;
use std::cell::RefCell;
use std::rc::Rc;

/// The environment is a cons-list of `name -> mutable slot` frames; closures capture it by `Rc`.
pub type Env = Option<Rc<Frame>>;

pub struct Frame {
    pub name: String,
    pub slot: Rc<RefCell<Value>>,
    pub parent: Env,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Builtin {
    Cons,
    Head,
    Tail,
    IsEmpty,
    Box,
    BoxGet,
    BoxSet,
}

#[derive(Clone)]
pub enum Value {
    Nat(u64),
    Bool(bool),
    Nil,
    Cons(Rc<Value>, Rc<Value>),
    Closure {
        params: Vec<String>,
        body: Rc<Core>,
        env: Env,
    },
    Builtin(Builtin),
    /// Internal statement result (`while`/assignment); never surfaced to the user.
    Unit,
    /// A mutable box cell (Plan 3b-2). Reuses the frame-slot type; shared by Rc so a box handle
    /// captured by a closure sees later writes. Never a decoded/final result — an intermediate only.
    Box(std::rc::Rc<std::cell::RefCell<Value>>),
}

impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Value::Nat(a), Value::Nat(b)) => a == b,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Nil, Value::Nil) => true,
            (Value::Unit, Value::Unit) => true,
            (Value::Cons(h1, t1), Value::Cons(h2, t2)) => h1 == h2 && t1 == t2,
            // Functions and box handles have no structural equality.
            _ => false,
        }
    }
}

impl std::fmt::Debug for Value {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Value::Nat(n) => write!(f, "Nat({n})"),
            Value::Bool(b) => write!(f, "Bool({b})"),
            Value::Nil => write!(f, "Nil"),
            Value::Cons(h, t) => write!(f, "Cons({h:?}, {t:?})"),
            Value::Closure { params, .. } => write!(f, "Closure(|{}|)", params.join(", ")),
            Value::Builtin(b) => write!(f, "Builtin({b:?})"),
            Value::Unit => write!(f, "Unit"),
            Value::Box(_) => write!(f, "<box>"),
        }
    }
}

/// Hand-written iterative destructor. A list built at runtime is a `Value::Cons` spine whose length
/// is bounded only by the step budget (millions of cells), so the compiler-generated recursive
/// `drop_in_place` would recurse once per cell and abort the process (SIGABRT) when that list is
/// dropped — e.g. the deep list a `run` leaves in the environment when `eval` returns. We unlink the
/// cons cells we uniquely own into an explicit worklist and drain it, using bounded stack.
impl Drop for Value {
    fn drop(&mut self) {
        let mut stack: Vec<Value> = Vec::new();
        take_owned_value_children(self, &mut stack);
        while let Some(mut v) = stack.pop() {
            take_owned_value_children(&mut v, &mut stack);
            // `v` is now a childless cell (or a leaf), so its re-entrant drop here is shallow.
        }
    }
}

/// Move the head/tail cells of a `Cons` (or the inner value of a `Box`) that this owner UNIQUELY
/// holds into `stack`. Shared cells (`Rc` strong count > 1) stay alive via their other owners, so we
/// must not descend into them — `Rc::try_unwrap` only yields the inner `Value` when we were the last
/// owner. This is what keeps a `Box` holding a deep list from stack-overflowing on drop: the list
/// gets unlinked into the same iterative worklist a bare `Cons` spine would use. `Closure`'s `body`
/// (`Rc<Core>`, torn down by `Core`'s own iterative Drop) and `env` (a depth-bounded `Frame` chain)
/// need no special handling and drop normally after this returns.
fn take_owned_value_children(v: &mut Value, stack: &mut Vec<Value>) {
    match v {
        Value::Cons(h, t) => {
            for slot in [h, t] {
                let rc = std::mem::replace(slot, Rc::new(Value::Nil));
                if let Ok(inner) = Rc::try_unwrap(rc) {
                    stack.push(inner);
                }
            }
        }
        Value::Box(cell) => {
            let rc = std::mem::replace(cell, Rc::new(RefCell::new(Value::Nil)));
            if let Ok(inner) = Rc::try_unwrap(rc) {
                stack.push(inner.into_inner());
            }
        }
        _ => {}
    }
}

impl Value {
    /// Build a `Value` list from a slice of `Nat`s (test helper + used by `run` result decoding).
    pub fn list_of_nats(ns: &[u64]) -> Value {
        let mut acc = Value::Nil;
        for &n in ns.iter().rev() {
            acc = Value::Cons(Rc::new(Value::Nat(n)), Rc::new(acc));
        }
        acc
    }
}

/// Canonical textual form of a decoded value, shared by the AOT runtime (which prints it) and the
/// oracle (which compares it to the binary's stdout). Lists render `[a, b, c]`; `Nat`/`Bool` render
/// plainly; `Unit` renders `()`. Non-value variants (closures/builtins/boxes) never reach here as a
/// top-level result, but render a stable placeholder to keep this total.
pub fn format_value(v: &Value) -> String {
    match v {
        Value::Nat(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Unit => "()".to_string(),
        Value::Nil => "[]".to_string(),
        Value::Cons(_, _) => {
            let mut out = String::from("[");
            let mut cur: &Value = v;
            let mut first = true;
            while let Value::Cons(h, t) = cur {
                if !first {
                    out.push_str(", ");
                }
                first = false;
                out.push_str(&format_value(h));
                cur = t.as_ref();
            }
            out.push(']');
            out
        }
        Value::Closure { .. } | Value::Builtin(_) | Value::Box(_) => "<non-value>".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_value_canonical_forms() {
        use super::format_value;
        assert_eq!(format_value(&Value::Nat(5050)), "5050");
        assert_eq!(format_value(&Value::Bool(true)), "true");
        assert_eq!(format_value(&Value::Bool(false)), "false");
        assert_eq!(format_value(&Value::Nil), "[]");
        assert_eq!(format_value(&Value::list_of_nats(&[1, 2, 3])), "[1, 2, 3]");
        assert_eq!(format_value(&Value::Unit), "()");
        // Nested lists: [[1], [2, 3]] — each element is itself rendered via the same recursive
        // `format_value(h)` call, not just a flat top-level list of Nats.
        let inner1 = Value::list_of_nats(&[1]);
        let inner2 = Value::list_of_nats(&[2, 3]);
        let nested = Value::Cons(Rc::new(inner1), Rc::new(Value::Cons(Rc::new(inner2), Rc::new(Value::Nil))));
        assert_eq!(format_value(&nested), "[[1], [2, 3]]");
    }
}
