//! The type language: monomorphic types `Ty` and polymorphic `Scheme`s (`forall vars. ty`).
//! `Unit` is internal — it types `while`/assignment/tail-less blocks and is never written by the
//! user.

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Ty {
    Nat,
    Bool,
    Unit,
    List(Box<Ty>),
    Fun(Vec<Ty>, Box<Ty>),
    Var(u32),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Scheme {
    pub vars: Vec<u32>,
    pub ty: Ty,
}

impl Scheme {
    /// A monomorphic scheme (no quantified variables).
    #[must_use]
    pub fn mono(ty: Ty) -> Self {
        Scheme { vars: Vec::new(), ty }
    }
}

/// The deepest `List<…>` nesting `parse_ty` will build.
///
/// This is a TOTALITY guard on untrusted input, not a language limit. The parse below is iterative,
/// so parsing itself cannot overflow — but `Ty::List` holds a `Box<Ty>`, so a 100,000-deep type
/// overflows the stack in its recursive `Drop` on the way out of the function that built it. Refusing
/// to build it is the fix. Nothing the typechecker infers from real source comes close to 64.
pub const MAX_TY_DEPTH: usize = 64;

/// Render `ty` in the surface type syntax: `Nat`, `Bool`, `Unit`, `List<Nat>`, `(Nat) -> Bool`, `t0`.
///
/// Moved here from `typeck`, which used it only for error messages, because the TM text form's
/// `result` directive needs the same rendering and a second printer would be a second thing to keep
/// in agreement. `parse_ty` is its partial inverse — partial because `Fun`/`Var` print but do not
/// parse back (see `parse_ty`).
///
/// ```
/// use redextape_core::ty::{Ty, show};
/// assert_eq!(show(&Ty::List(Box::new(Ty::Nat))), "List<Nat>");
/// ```
///
/// That example is also this tree's ONLY doctest, and it is load-bearing beyond documenting `show`.
/// The test runner is `cargo-nextest`, which does not run doctests at all — so `scripts/check-all.sh`
/// pairs every config with an explicit `cargo test --doc`. With no doctest anywhere, that paired run
/// would execute nothing and assert nothing, and a config added later with a bare `cargo nextest run`
/// would drop doctests with no failure to show for it. One real doctest makes the wiring OBSERVABLE:
/// the gate prints `1 passed` per config, so a dropped pairing shows up as a zero. Same reasoning as
/// the slow tier's `#[ignore]` marker, which was chosen over an env-var guard because `cargo test`
/// prints the ignored count.
pub fn show(ty: &Ty) -> String {
    match ty {
        Ty::Nat => "Nat".into(),
        Ty::Bool => "Bool".into(),
        Ty::Unit => "Unit".into(),
        Ty::List(t) => format!("List<{}>", show(t)),
        Ty::Fun(ps, r) => {
            let ps: Vec<String> = ps.iter().map(show).collect();
            format!("({}) -> {}", ps.join(", "), show(r))
        }
        Ty::Var(v) => format!("t{v}"),
    }
}

/// `ty` with every free type variable written as `Nat`: what a `result` directive names for a program
/// whose type still has one — `[]` types as `List<t0>`, and `head([])` as `t0`.
///
/// **SOUND FOR A VALUE, BECAUSE A CLOSED VALUE HOLDS NOTHING OF A FREE VARIABLE'S TYPE.** `[]` has no
/// element and `[[]]` no element's element, so reading either as a list of `Nat` reads the same value;
/// and a program of bare type `t0` has no value to read at all (`head([])` faults). `Nat` is a
/// choice, not a finding — any value type would read the same — and it is the one `parse_ty` reads
/// back, so the header a writer builds from this is one its reader accepts.
///
/// **A `Fun` STAYS A `Fun`**, its variables grounded like any other: a function value has no decoding,
/// so no directive names it, grounded or not.
#[must_use]
pub fn ground(ty: Ty) -> Ty {
    match ty {
        Ty::Var(_) => Ty::Nat,
        Ty::List(t) => Ty::List(Box::new(ground(*t))),
        Ty::Fun(ps, r) => Ty::Fun(ps.into_iter().map(ground).collect(), Box::new(ground(*r))),
        other @ (Ty::Nat | Ty::Bool | Ty::Unit) => other,
    }
}

/// Parse a VALUE type — `Nat | Bool | Unit | List<T>` — from its `show` form. `None` for anything
/// else, INCLUDING the well-formed-but-undecodable `Fun` and `Var`: they are not first-class values
/// on the tape, so a file naming one is rejected where it is written rather than decoding to a silent
/// `None` where it is read.
///
/// ITERATIVE on the `List` spine (recursion would be on untrusted nesting depth), and capped at
/// `MAX_TY_DEPTH` so the built value's recursive `Drop` is bounded too.
#[must_use]
pub fn parse_ty(s: &str) -> Option<Ty> {
    let mut s = s.trim();
    let mut depth = 0usize;
    // Peel `List<` off the front and its matching `>` off the back together, so the two counts cannot
    // disagree: `List<Nat>>` peels to the base `Nat>`, which matches no base type and is rejected.
    while let Some(rest) = s.strip_prefix("List<") {
        let rest = rest.strip_suffix('>')?;
        s = rest.trim();
        depth += 1;
        if depth > MAX_TY_DEPTH {
            return None;
        }
    }
    let mut ty = match s {
        "Nat" => Ty::Nat,
        "Bool" => Ty::Bool,
        "Unit" => Ty::Unit,
        _ => return None,
    };
    for _ in 0..depth {
        ty = Ty::List(Box::new(ty));
    }
    Some(ty)
}

/// The round-trip half of `is_decodable` alone — `ty` MUST already be grounded, and this asks nothing
/// about whether it is. Split out so a caller that has already run `ground` for its own reasons, as
/// `AsmHeader::for_type` has (its own `result` field holds exactly the value this checks), asks this
/// directly rather than paying for a second walk of the same tree through `is_decodable`'s own
/// grounding.
///
/// `pub`, NOT `pub(crate)`: `redextape-cli`'s `emit_tm` and `redextape-wasm`'s `Session::tm_text` are
/// each in a caller's hands that grounded `ty` already — a refusal's own message and an already-grounded
/// header's `result` — so they ask this directly too, for the identical reason `AsmHeader::for_type` does.
#[must_use]
pub fn is_decodable_ground(ty: &Ty) -> bool {
    parse_ty(&show(ty)).is_some()
}

/// Whether `ty` names a type a header's `result` line can carry: grounded, shown, and read back
/// through `parse_ty`. `Fun` never round-trips — a function value has no decoding — nor does a list
/// nested past `MAX_TY_DEPTH`; a free variable always does, once `ground` writes it as `Nat`.
///
/// **THE ONE PREDICATE A HEADER WRITER ASKS BEFORE NAMING A `result` LINE — THROUGH `is_decodable_ground`
/// ABOVE, NOT THIS FUNCTION, ONCE A CALLER HAS ALREADY GROUNDED ITS OWN TYPE.** `AsmHeader::for_type`,
/// `redextape emit --lang tm`'s refusal (`emit_tm`) and the wasm session's `tmText` each already hold a
/// type they grounded themselves — `for_type`'s own `result` field, `emit_tm`'s local `grounded`,
/// `tmText`'s `header.result` (`describe_at`'s own doc) — so all three ask `is_decodable_ground` of it
/// directly, for the reason its own doc gives. THIS function is for a caller that has not: it grounds
/// `ty` itself before asking, which is what `Session::tm_result_decodable` needs of `self.ty` (never
/// grounded on its own) and what the tests below ask of a bare `Ty`. Both halves round-trip through the
/// identical `parse_ty(&show(..))`, so the CLI, the session and the asm header cannot disagree with each
/// other, or with `run`'s own refusal, about which programs get a header.
#[must_use]
pub fn is_decodable(ty: &Ty) -> bool {
    is_decodable_ground(&ground(ty.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_types_round_trip_through_their_text_form() {
        for ty in
            [Ty::Nat, Ty::Bool, Ty::Unit, Ty::List(Box::new(Ty::Nat)), Ty::List(Box::new(Ty::List(Box::new(Ty::Bool))))]
        {
            assert_eq!(parse_ty(&show(&ty)), Some(ty.clone()), "round-trip failed for {ty:?}");
        }
    }

    /// D5: `Fun` and `Var` are not first-class values on the tape, so a file naming one is rejected
    /// where it is WRITTEN rather than decoding to a silent `None` where it is read. They still
    /// `show` — `typeck` prints them in error messages — they just do not parse back.
    #[test]
    fn non_value_types_show_but_do_not_parse() {
        let fun = Ty::Fun(vec![Ty::Nat], Box::new(Ty::Bool));
        assert_eq!(show(&fun), "(Nat) -> Bool");
        assert_eq!(parse_ty("(Nat) -> Bool"), None);
        assert_eq!(show(&Ty::Var(3)), "t3");
        assert_eq!(parse_ty("t3"), None);
    }

    /// A free variable is `Nat` wherever it sits — bare, under lists, and inside a function's
    /// parameters and result — and a type with none is returned unchanged.
    #[test]
    fn ground_writes_every_free_variable_as_nat_and_leaves_the_rest() {
        let list = |t: Ty| Ty::List(Box::new(t));
        assert_eq!(ground(Ty::Var(3)), Ty::Nat);
        assert_eq!(ground(list(Ty::Var(0))), list(Ty::Nat));
        assert_eq!(ground(list(list(Ty::Var(2)))), list(list(Ty::Nat)));
        assert_eq!(
            ground(Ty::Fun(vec![Ty::Var(0), Ty::Bool], Box::new(list(Ty::Var(1))))),
            Ty::Fun(vec![Ty::Nat, Ty::Bool], Box::new(list(Ty::Nat)))
        );
        for ty in [Ty::Nat, Ty::Bool, Ty::Unit, list(list(Ty::Bool)), Ty::Fun(vec![Ty::Nat], Box::new(Ty::Unit))] {
            assert_eq!(ground(ty.clone()), ty);
        }
    }

    /// Malformed input yields `None`, never a panic. `List<Nat>>` is the interesting one: a naive
    /// peel-the-prefix parser accepts it by ignoring the extra `>`.
    #[test]
    fn malformed_type_text_is_none_not_a_panic() {
        for s in ["", "  ", "List", "List<", "List<>", "List<Nat", "List<Nat>>", "ListNat", "nat", "List<Fun>"] {
            assert_eq!(parse_ty(s), None, "expected None for {s:?}");
        }
    }

    /// A `.tm` file is untrusted input. A hostile nesting depth must be REFUSED, not parsed into a
    /// `Ty` whose recursive `Drop` then overflows the stack on the way out. The parse itself is
    /// iterative; the cap exists for the drop.
    #[test]
    fn absurd_nesting_is_refused_rather_than_built() {
        let deep = format!("{}Nat{}", "List<".repeat(100_000), ">".repeat(100_000));
        assert_eq!(parse_ty(&deep), None);
        // At the cap it still parses; one past it does not.
        let at_cap = format!("{}Nat{}", "List<".repeat(MAX_TY_DEPTH), ">".repeat(MAX_TY_DEPTH));
        assert!(parse_ty(&at_cap).is_some());
        let over = format!("{}Nat{}", "List<".repeat(MAX_TY_DEPTH + 1), ">".repeat(MAX_TY_DEPTH + 1));
        assert_eq!(parse_ty(&over), None);
    }

    /// Every value type is decodable, grounded or not; a bare `Fun` and one nested under `List` are
    /// not, wherever a free variable sits alongside it — grounding a `Var` cannot make a `Fun` in the
    /// same type decodable, since `ground` leaves `Fun` a `Fun` (its own doc).
    #[test]
    fn is_decodable_answers_false_only_for_a_type_holding_a_function() {
        let list = |t: Ty| Ty::List(Box::new(t));
        for ty in [Ty::Nat, Ty::Bool, Ty::Unit, list(Ty::Nat), list(list(Ty::Bool)), Ty::Var(0), list(Ty::Var(1))] {
            assert!(is_decodable(&ty), "expected decodable: {ty:?}");
        }
        for ty in [
            Ty::Fun(vec![Ty::Nat], Box::new(Ty::Nat)),
            list(Ty::Fun(vec![Ty::Var(0)], Box::new(Ty::Var(0)))),
            Ty::Fun(vec![Ty::Var(0), Ty::Bool], Box::new(list(Ty::Nat))),
        ] {
            assert!(!is_decodable(&ty), "expected undecodable: {ty:?}");
        }
    }
}
