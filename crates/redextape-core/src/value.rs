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

/// ITERATIVE over the `Cons` spine, recursive only into HEADS — the same shape the `Drop` impl below
/// uses, and for the same reason: a runtime list's length is bounded only by the step budget (millions
/// of cells), so a per-cell recursive `eq` would overflow the stack a `Drop` this deep already survives.
/// A head's own nesting is the value's TYPE depth (e.g. `List<List<Nat>>` is 2), never its length, so
/// recursing into `==` on a head is bounded the same way `lambda::decode_lambda_ty`'s spine walk
/// bounds its recursion into heads.
impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        let mut a = self;
        let mut b = other;
        loop {
            match (a, b) {
                (Value::Nat(x), Value::Nat(y)) => return x == y,
                (Value::Bool(x), Value::Bool(y)) => return x == y,
                // Both nullary and trivially self-equal; if either ever gains a payload this arm stops
                // compiling rather than silently comparing it away.
                (Value::Nil, Value::Nil) | (Value::Unit, Value::Unit) => return true,
                (Value::Cons(h1, t1), Value::Cons(h2, t2)) => {
                    if h1 != h2 {
                        return false;
                    }
                    a = t1.as_ref();
                    b = t2.as_ref();
                }
                // Functions and box handles have no structural equality; any other variant mismatch.
                _ => return false,
            }
        }
    }
}

/// ITERATIVE over the `Cons` spine, recursive only into HEADS — same rationale as `PartialEq` above.
/// Formatting a head's `Debug` text may itself recurse (a nested list), but that recursion is bounded
/// by TYPE depth, not this list's length. Writes each `"Cons(h, "` prefix straight to `f` as the spine
/// is walked, then the final tail, then one `")"` per cell walked — no `String` is ever built and
/// reassigned per cell, so this stays O(n) at the "millions of cells" lengths the `Drop` impl's own doc
/// below cites (a per-cell `format!` into a growing accumulator would be O(n²): a hang at that length,
/// not a stack overflow, but no less a totality failure). Output is byte-for-byte what the naive
/// recursive `"Cons({h:?}, {t:?})"` produced.
impl std::fmt::Debug for Value {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Value::Nat(n) => write!(f, "Nat({n})"),
            Value::Bool(b) => write!(f, "Bool({b})"),
            Value::Nil => write!(f, "Nil"),
            Value::Cons(..) => {
                let mut cur: &Value = self;
                let mut depth = 0usize;
                while let Value::Cons(h, t) = cur {
                    write!(f, "Cons({h:?}, ")?;
                    depth += 1;
                    cur = t.as_ref();
                }
                write!(f, "{cur:?}")?;
                for _ in 0..depth {
                    f.write_str(")")?;
                }
                Ok(())
            }
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
    #[must_use]
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
#[must_use]
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

    /// `PartialEq`/`Debug` depth tests, companions to the `Drop` impl's own doc comment above: "a list
    /// built at runtime is a `Value::Cons` spine whose length is bounded only by the step budget
    /// (millions of cells)". `Drop` was hand-written iteratively because of that premise; `PartialEq`
    /// and `Debug` share the same premise but, until this fix, not the same treatment — both still
    /// recursed once per cell. Same technique as `Drop`'s tests and
    /// `lambda::decode::decode_lambda_ty_is_iterative_over_the_list_spine`: an explicit small-stack
    /// thread that today's recursive impl cannot survive at this length.
    #[test]
    fn equal_long_lists_compare_equal_on_a_small_stack() {
        let ns: Vec<u64> = (0..5_000).collect();
        std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(move || {
                let a = Value::list_of_nats(&ns);
                let b = Value::list_of_nats(&ns);
                assert_eq!(a, b);
            })
            .expect("spawn a small-stack thread")
            .join()
            .expect("comparing two long equal lists must not overflow its stack");
    }

    /// The one difference sits in the LAST cell, so the walk cannot short-circuit early and pass by
    /// accident — reaching a correct `false` here requires walking the full 5,000-cell spine.
    #[test]
    fn long_lists_differing_only_in_the_last_cell_compare_unequal_on_a_small_stack() {
        let mut ns: Vec<u64> = (0..5_000).collect();
        std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(move || {
                let a = Value::list_of_nats(&ns);
                *ns.last_mut().expect("non-empty") += 1;
                let b = Value::list_of_nats(&ns);
                assert_ne!(a, b);
            })
            .expect("spawn a small-stack thread")
            .join()
            .expect("comparing two long lists differing only in the last cell must not overflow its stack");
    }

    /// A prefix versus a longer list — the `Cons`-vs-`Nil` transition the catch-all arm handles, and
    /// the case that makes the cross-backend oracle catch a backend returning a SHORTER list wherever
    /// the comparison is `Value`-to-`Value`. Ordinary size: this pins the transition itself, not depth.
    #[test]
    fn lists_of_different_lengths_compare_unequal() {
        assert_ne!(Value::list_of_nats(&[1, 2]), Value::list_of_nats(&[1, 2, 3]));
    }

    /// `expected` is built by an INDEPENDENT non-recursive loop (not by calling `Debug` on a shorter
    /// list and trusting recursion), so this doesn't just re-exercise the impl under test against
    /// itself.
    #[test]
    fn debug_format_of_a_long_list_does_not_overflow_a_small_stack() {
        let ns: Vec<u64> = (0..5_000).collect();
        std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(move || {
                let v = Value::list_of_nats(&ns);
                let s = format!("{v:?}");
                let mut expected = String::from("Nil");
                for i in (0..5_000u64).rev() {
                    expected = format!("Cons(Nat({i}), {expected})");
                }
                assert_eq!(s, expected);
            })
            .expect("spawn a small-stack thread")
            .join()
            .expect("Debug-formatting a long list must not overflow its stack");
    }

    /// Pin: the iterative rewrite must produce byte-for-byte the same `Debug` text as before, on an
    /// ordinary short list where stack depth was never in question.
    #[test]
    fn debug_format_of_a_short_list_is_unchanged() {
        let v = Value::list_of_nats(&[1, 2, 3]);
        assert_eq!(format!("{v:?}"), "Cons(Nat(1), Cons(Nat(2), Cons(Nat(3), Nil)))");
    }

    /// Every test above uses a flat `List<Nat>`, so the "recurses only into HEADS" claim in both
    /// impls' doc comments — that a head's own recursion is bounded by the value's TYPE depth, not its
    /// length — is never exercised. This pins it for `PartialEq` over a `List<List<Nat>>`: two
    /// independently-built nested lists compare equal, and a difference nested inside a HEAD (not the
    /// spine) is still caught. Ordinary size — this is testing correctness of the recursive path, not
    /// stack survival, so no small-stack thread.
    #[test]
    fn nested_lists_compare_by_structural_equality_of_their_heads() {
        let a = Value::Cons(
            Rc::new(Value::list_of_nats(&[1, 2])),
            Rc::new(Value::Cons(Rc::new(Value::list_of_nats(&[3])), Rc::new(Value::Nil))),
        );
        let b = Value::Cons(
            Rc::new(Value::list_of_nats(&[1, 2])),
            Rc::new(Value::Cons(Rc::new(Value::list_of_nats(&[3])), Rc::new(Value::Nil))),
        );
        assert_eq!(a, b);
        let c = Value::Cons(
            Rc::new(Value::list_of_nats(&[1, 9])),
            Rc::new(Value::Cons(Rc::new(Value::list_of_nats(&[3])), Rc::new(Value::Nil))),
        );
        assert_ne!(a, c);
    }

    /// Same claim, pinned for `Debug`: a `List<List<Nat>>` head recurses into `Debug` text (bounded by
    /// TYPE depth) while the outer spine walk stays iterative. Exact string, as the flat pin above.
    #[test]
    fn debug_format_of_a_list_of_lists_is_unchanged() {
        let v = Value::Cons(
            Rc::new(Value::list_of_nats(&[1, 2])),
            Rc::new(Value::Cons(Rc::new(Value::list_of_nats(&[3])), Rc::new(Value::Nil))),
        );
        assert_eq!(format!("{v:?}"), "Cons(Cons(Nat(1), Cons(Nat(2), Nil)), Cons(Cons(Nat(3), Nil), Nil))");
    }
}
