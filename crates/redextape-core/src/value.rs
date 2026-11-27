//! Runtime values for the reference interpreter (the oracle). Lists are cons-cells so the shape
//! matches the Scott encoding the λ backend uses.

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
    /// A function as a backend that cannot look inside one reports it. A machine leg holds a closure as
    /// a tag and an environment, and the λ backend as a term, and neither names the source function in
    /// a form the other legs share, so every backend reports the same opaque `<fn>`. The reference
    /// interpreter never builds one: `observable` turns its `Closure` or `Builtin` into this, which is
    /// what lets the oracles compare a function-typed result across backends.
    Function,
    /// Internal statement result (`while`/assignment); never surfaced to the user.
    Unit,
    /// A mutable box cell. Reuses the frame-slot type; shared by Rc so a box handle
    /// captured by a closure sees later writes. Never a decoded/final result — an intermediate only.
    Box(std::rc::Rc<std::cell::RefCell<Value>>),
}

/// How a type-directed decoder reads a position typed `Ty::Fun`. `Refuse` answers no value, as the
/// `_ty` decoders do and the browser app shows as undecodable; `Opaque` answers
/// `Value::Function`, the one thing every backend can report of a function. One switch shared by the λ
/// and machine decoders, so the two families cannot read a function differently.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Functions {
    Refuse,
    Opaque,
}

/// ITERATIVE over the `Cons` spine, recursive only into HEADS — the same shape the `Drop` impl below
/// uses, and for the same reason: a runtime list's length is bounded only by the step budget (millions
/// of cells), so a per-cell recursive `eq` would overflow the stack a `Drop` this deep already survives.
/// A head's own nesting is the value's TYPE depth (e.g. `List<List<Nat>>` is 2), never its length, so
/// recursing into `==` on a head is bounded the same way `lambda::decode_lambda_ty`'s spine walk
/// bounds its recursion into heads.
///
/// **THIS WALKS THE VALUE'S LOGICAL SIZE, NOT ITS DISTINCT-NODE COUNT, AND THAT IS A KNOWN, UNCLOSED
/// PART OF THE SAME HAZARD CLASS `MAX_PRINT_NODES` CLOSES FOR PRINTING.** There is no `Rc::ptr_eq`
/// short-circuit here: a shared head reached through two different spine positions is re-walked in full
/// each time it is compared, so `==` on a DAG-shaped decoded value pays the same super-linear blowup
/// `format_value` (uncapped) pays and `format_value_capped` refuses rather than pay — cost scales with
/// the shared heads' own logical sizes, not with either value's distinct-node count. **Currently safe
/// because nothing on a production path ever compares a decoded `Value`** — neither the CLI
/// (`redextape-cli`) nor the WASM UI (`redextape-wasm`) does; every `==` on a decoded value in this
/// workspace is test or oracle code running a small, trusted program. See this crate's
/// `tests/sharing_aware_decode.rs`, whose `tails_decodes_far_past_the_unmemoized_budget` compares two
/// `m = 64,000` values with `==` — an O(m²) walk that is CPU-bound rather than memory-bound and does
/// complete. `Drop` (below) does not share this defect: its `Rc::try_unwrap`-gated worklist already refuses
/// to descend into a cell it does not uniquely own.
impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        let mut a = self;
        let mut b = other;
        loop {
            match (a, b) {
                (Value::Nat(x), Value::Nat(y)) => return x == y,
                (Value::Bool(x), Value::Bool(y)) => return x == y,
                // All nullary and trivially self-equal; if any ever gains a payload this arm stops
                // compiling rather than silently comparing it away.
                (Value::Nil, Value::Nil) | (Value::Unit, Value::Unit) | (Value::Function, Value::Function) => {
                    return true;
                }
                (Value::Cons(h1, t1), Value::Cons(h2, t2)) => {
                    if h1 != h2 {
                        return false;
                    }
                    a = t1.as_ref();
                    b = t2.as_ref();
                }
                // A closure, a builtin and a box handle have no structural equality, and an opaque
                // `Function` equals no closure: compare `observable()` forms to ask whether both are
                // functions. Any other variant mismatch.
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
/// not a stack overflow, but no less a totality failure). Output is byte-for-byte what a naive
/// recursive `"Cons({h:?}, {t:?})"` would produce.
///
/// **SAME GAP AS `PartialEq` ABOVE, FOR THE SAME REASON: NO `Rc::ptr_eq` SHORT-CIRCUIT ON HEADS.**
/// Formatting a shared head reached from two spine positions walks it twice in full, so `Debug`-ing a
/// DAG-shaped decoded value costs its LOGICAL size, not its distinct-node count — see `PartialEq`'s own
/// doc for why that is currently safe (no production path ever `Debug`-formats a decoded value) and for
/// the one test that exercises it at scale.
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
            Value::Function => write!(f, "Function"),
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
    /// Build a `Value` list from a slice of `Nat`s (a test helper).
    #[must_use]
    pub fn list_of_nats(ns: &[u64]) -> Value {
        let mut acc = Value::Nil;
        for &n in ns.iter().rev() {
            acc = Value::Cons(Rc::new(Value::Nat(n)), Rc::new(acc));
        }
        acc
    }

    /// This value as every backend can report it: a `Closure` or a `Builtin`, at the top or inside a
    /// list, becomes the opaque `Function`, and everything else is unchanged. The oracles compare a
    /// decoded result with the reference's through this, because a machine leg or a λ normal form can
    /// say that a value is a function and nothing more.
    ///
    /// ITERATIVE over the spine and recursive only into heads, for the reason `PartialEq` gives. It
    /// rebuilds every cell it walks, so a value whose heads share structure costs its LOGICAL size,
    /// the gap `PartialEq`'s doc describes; it is safe for the same reason, since only oracle and test
    /// code calls it, on small trusted programs.
    #[must_use]
    pub fn observable(&self) -> Value {
        let mut heads = Vec::new();
        let mut cur = self;
        while let Value::Cons(h, t) = cur {
            heads.push(h.observable());
            cur = t.as_ref();
        }
        let mut acc = match cur {
            Value::Closure { .. } | Value::Builtin(_) => Value::Function,
            other => other.clone(),
        };
        for h in heads.into_iter().rev() {
            acc = Value::Cons(Rc::new(h), Rc::new(acc));
        }
        acc
    }
}

/// The most LOGICAL value nodes `format_value_capped` will walk.
///
/// A totality guard on untrusted input, and it exists because the decode budget does not cover this
/// case. `MAX_DECODE_NODES` bounds how many DISTINCT nodes a decode builds; once the decoder
/// memoizes, distinct and logical diverge without limit — a 65-allocation value can have 2^64 logical
/// nodes. Printing is a tree walk, so printing pays the logical size. The decode budget does not
/// refuse such a value before the printer can see it, so this cap is the guard on the printing half.
///
/// DERIVED, not picked: a run under `tm::DEFAULT_CAPS` may build `5_000_000` heap cells. `fmt_into`
/// charges one unit to enter the outer value, one per spine step, and one per head entry (see that
/// function's doc for why the charge is split that way) — `2L + 1` for a flat `List<Nat>` of length
/// `L`, `10_000_001` at `L = 5_000_000`. This sits at `20_000_000`, just under 2x that, so no FLAT
/// output a correct program can produce is refused.
///
/// Shared output above the cap is a different story, and refusing it is the whole point, not an
/// accident of the arithmetic above: a correct, cap-respecting program using `Instr::Tail`-style
/// sharing (`tails` at `m` ~= 4,471, far under every run cap) is *supposed* to be refused here,
/// because its LOGICAL size, not its allocation count, is what this cap bounds.
///
/// `MAX_PRINT_NODES` is numerically equal to `MAX_DECODE_NODES` because the same run cap drives both
/// derivations, NOT because either is defined in terms of the other — they are independently
/// changeable and bound different quantities.
pub const MAX_PRINT_NODES: usize = 20_000_000;

/// `format_value`, refusing rather than walking forever when the value's LOGICAL size exceeds
/// `budget`. Returns `None` on refusal — the caller reports it as the tool's limit, never as the
/// file's fault, exactly as `DecodeFailure::BudgetExhausted` is reported.
///
/// Use this on any value that came from a FILE. `format_value` remains correct for values the tree
/// produced itself, and the AOT oracle depends on its exact output.
#[must_use]
pub fn format_value_capped(v: &Value, budget: usize) -> Option<String> {
    let mut out = String::new();
    let mut left = budget;
    fmt_into(v, &mut out, &mut left).then_some(out)
}

/// Canonical textual form of a decoded value, shared by the AOT runtime (which prints it) and the
/// oracle (which compares it to the binary's stdout). Lists render `[a, b, c]`; `Nat`/`Bool` render
/// plainly; `Unit` renders `()`. A function renders `<fn>`, whether the reference's closure or builtin
/// or a decoder's opaque `Function`, so every backend prints a function-typed result the same way. A
/// box never reaches here as a result, but renders `<non-value>` to keep this total.
#[must_use]
pub fn format_value(v: &Value) -> String {
    let mut out = String::new();
    let mut left = usize::MAX;
    // On a 64-bit target, `usize::MAX` (~1.8e19) cannot be reached by a walk that terminates at
    // all, so this is the uncapped walk and the bool is always true there. That is NOT true on a
    // 32-bit target such as wasm32 — a gate `redextape-core` must build for — where `usize::MAX` is
    // only ~4.29e9, below logical sizes that are reachable (see `value::tests`'s 65-allocation,
    // 2^64-logical-node DAG). There, this same walk would not run forever; it would silently STOP EARLY and
    // return truncated text once the budget hit zero. Ignored rather than asserted: an `assert!` here would
    // be a panic in a library path, and `debug_assert!` would drop the call in release.
    let _ = fmt_into(v, &mut out, &mut left);
    out
}

/// The one value-printing walk, shared by `format_value` and `format_value_capped` so the two
/// cannot drift. Returns `false` once `budget` would go negative, leaving `out` truncated —
/// callers discard it in that case.
///
/// **Charges two units per list cell, not one, and that is what makes `2L + 1` the cost of a flat
/// `List<Nat>` of length `L` (`L` `Nat`s + `L` `Cons`es + one `Nil`).** The `checked_sub` at the
/// top of this function charges for entering a node at all — a `Nat`, `Nil`, or a `Cons`'s head —
/// and that alone would charge only the OUTERMOST `Cons` once, because the `Cons` arm below walks
/// the rest of the spine ITERATIVELY (`cur = t.as_ref()`), never re-entering `fmt_into` for the
/// cells it steps past. That iteration is deliberate, not incidental: a runtime list's spine length
/// is bounded only by the step budget (millions of cells), so recursing once per cell would
/// overflow the stack long before any budget check fired. So the `while` loop spends a SECOND
/// charge itself, once per spine step, to account for the cell the entry charge does not reach. A
/// flat list of `L` elements is then: 1 (the entry charge for the outer value) + `L` (one
/// spine-step charge per cell) + `L` (one entry charge per head, via the recursive
/// `fmt_into(h, ..)` call) = `2L + 1`. Drop the spine-step charge and a long flat list is bounded
/// only by the budget spent on its elements — the spine itself would be free to grow forever, which
/// is exactly the shape a `.tm` file can hand this printer.
fn fmt_into(v: &Value, out: &mut String, budget: &mut usize) -> bool {
    let Some(next) = budget.checked_sub(1) else { return false };
    *budget = next;
    match v {
        Value::Nat(n) => out.push_str(&n.to_string()),
        Value::Bool(b) => out.push_str(&b.to_string()),
        Value::Unit => out.push_str("()"),
        Value::Nil => out.push_str("[]"),
        Value::Cons(_, _) => {
            out.push('[');
            let mut cur: &Value = v;
            let mut first = true;
            while let Value::Cons(h, t) = cur {
                // The spine-step charge: see this function's doc for why the entry charge above
                // does not already cover it.
                let Some(next) = budget.checked_sub(1) else { return false };
                *budget = next;
                if !first {
                    out.push_str(", ");
                }
                first = false;
                if !fmt_into(h, out, budget) {
                    return false;
                }
                cur = t.as_ref();
            }
            out.push(']');
        }
        Value::Closure { .. } | Value::Builtin(_) | Value::Function => out.push_str("<fn>"),
        Value::Box(_) => out.push_str("<non-value>"),
    }
    true
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
    /// (millions of cells)". `Drop` is hand-written iteratively because of that premise, and `PartialEq`
    /// and `Debug`, which share it, walk the spine iteratively too. Same technique as `Drop`'s tests and
    /// `lambda::decode::decode_lambda_ty_is_iterative_over_the_list_spine`: an explicit small-stack
    /// thread that a recursive impl cannot survive at this length.
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

    /// Pin: the exact `Debug` text of an ordinary short list, where stack depth is not in question.
    #[test]
    fn debug_format_of_a_short_list_is_exact() {
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
    fn debug_format_of_a_list_of_lists_is_exact() {
        let v = Value::Cons(
            Rc::new(Value::list_of_nats(&[1, 2])),
            Rc::new(Value::Cons(Rc::new(Value::list_of_nats(&[3])), Rc::new(Value::Nil))),
        );
        assert_eq!(format!("{v:?}"), "Cons(Cons(Nat(1), Cons(Nat(2), Nil)), Cons(Cons(Nat(3), Nil), Nil))");
    }

    /// A value can be SMALL in memory and astronomically large printed, because `Value::Cons` holds
    /// `Rc`s and a decoded value is a DAG. 64 levels of self-sharing is 65 allocations and 2^64
    /// logical nodes — the shape a `.tm` file can hand the CLI, since the decoder memoizes.
    ///
    /// `format_value` walks it as a tree and would not return in any useful time; `format_value_capped`
    /// must refuse. The test asserts the refusal, and never calls the uncapped form on this value.
    #[test]
    fn a_shared_dag_is_small_in_memory_and_refused_by_the_capped_printer() {
        let mut v = Value::Cons(Rc::new(Value::Nat(1)), Rc::new(Value::Nil));
        for _ in 0..64 {
            let shared = Rc::new(v);
            v = Value::Cons(Rc::clone(&shared), Rc::new(Value::Cons(shared, Rc::new(Value::Nil))));
        }
        assert_eq!(format_value_capped(&v, MAX_PRINT_NODES), None);
    }

    /// The cap does not refuse anything a correct program can produce. The derivation in
    /// `MAX_PRINT_NODES`'s doc says a flat `List<Nat>` at the heap cap costs `2L + 1` logical nodes;
    /// this pins the equation at a small `L` so a constant offset cannot pass.
    #[test]
    fn the_capped_printer_agrees_with_the_uncapped_one_below_the_cap() {
        for l in [0_u64, 1, 3, 50] {
            let ns: Vec<u64> = (1..=l).collect();
            let v = Value::list_of_nats(&ns);
            assert_eq!(format_value_capped(&v, MAX_PRINT_NODES).as_deref(), Some(format_value(&v).as_str()));
            // `2L + 1` logical nodes: L `Nat`s, L `Cons`es, one `Nil`. One unit short must refuse.
            let exact = 2 * l as usize + 1;
            assert!(format_value_capped(&v, exact).is_some(), "L={l} must fit in exactly 2L+1");
            assert_eq!(format_value_capped(&v, exact - 1), None, "L={l} must refuse at 2L");
        }
    }

    /// A closure, a builtin and the opaque `Function` all print `<fn>`, so every backend prints a
    /// function-typed result alike; a box keeps `<non-value>`, since no program's result is one.
    #[test]
    fn a_function_prints_fn_and_a_box_prints_non_value() {
        let closure = crate::run("|x| x + 1").expect("evaluates");
        assert!(matches!(closure, Value::Closure { .. }), "{closure:?}");
        let builtin = crate::run("head").expect("evaluates");
        assert!(matches!(builtin, Value::Builtin(Builtin::Head)), "{builtin:?}");
        for v in [&closure, &builtin, &Value::Function] {
            assert_eq!(format_value(v), "<fn>", "{v:?}");
            assert_eq!(format_value_capped(v, MAX_PRINT_NODES).as_deref(), Some("<fn>"), "{v:?}");
        }
        let list = Value::Cons(Rc::new(closure), Rc::new(Value::Cons(Rc::new(Value::Function), Rc::new(Value::Nil))));
        assert_eq!(format_value(&list), "[<fn>, <fn>]");
        let boxed = Value::Box(Rc::new(RefCell::new(Value::Nat(1))));
        assert_eq!(format_value(&boxed), "<non-value>");
    }

    /// `observable` is what the oracles compare: a closure or builtin becomes `Function` at any depth
    /// of a list, which then equals another leg's `Function`, while the raw closure equals nothing.
    #[test]
    fn observable_turns_every_function_into_the_opaque_function() {
        let closure = crate::run("|x| x + 1").expect("evaluates");
        assert_ne!(closure, Value::Function, "a raw closure is not the opaque function");
        assert_eq!(closure.observable(), Value::Function);
        assert_eq!(crate::run("cons").expect("evaluates").observable(), Value::Function);
        let nested = crate::run("[[|x| x], [], [|y| y + 1, |z| z]]").expect("evaluates");
        let list =
            |items: Vec<Value>| items.into_iter().rev().fold(Value::Nil, |t, h| Value::Cons(Rc::new(h), Rc::new(t)));
        let want = list(vec![list(vec![Value::Function]), Value::Nil, list(vec![Value::Function, Value::Function])]);
        assert_eq!(nested.observable(), want);
        assert_eq!(format_value(&nested.observable()), "[[<fn>], [], [<fn>, <fn>]]");
        for plain in ["[1, 2]", "true", "7", "[]"] {
            let v = crate::run(plain).expect("evaluates");
            assert_eq!(v.observable(), v, "{plain} holds no function and must be unchanged");
        }
    }

    /// Iterative over the spine, like `PartialEq` and `Debug`: a long list of closures must not need a
    /// stack frame per cell.
    #[test]
    fn observable_of_a_long_list_does_not_overflow_a_small_stack() {
        std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(|| {
                let closure = crate::run("|x| x").expect("evaluates");
                let mut v = Value::Nil;
                for _ in 0..5_000 {
                    v = Value::Cons(Rc::new(closure.clone()), Rc::new(v));
                }
                let seen = v.observable();
                let mut cur = &seen;
                let mut n = 0;
                while let Value::Cons(h, t) = cur {
                    assert_eq!(**h, Value::Function);
                    n += 1;
                    cur = t.as_ref();
                }
                assert_eq!(n, 5_000);
            })
            .expect("spawn a small-stack thread")
            .join()
            .expect("`observable` on a long list must not overflow its stack");
    }
}
