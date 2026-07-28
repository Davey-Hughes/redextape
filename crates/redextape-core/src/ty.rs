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

/// Parse a VALUE type — `Nat | Bool | Unit | List<T>` — from its `show` form. `None` for anything
/// else, INCLUDING the well-formed-but-undecodable `Fun` and `Var`: they are not first-class values
/// on the tape, so a file naming one is rejected where it is written rather than decoding to a silent
/// `None` where it is read.
///
/// ITERATIVE on the `List` spine (recursion would be on untrusted nesting depth), and capped at
/// `MAX_TY_DEPTH` so the built value's recursive `Drop` is bounded too.
pub fn parse_ty(s: &str) -> Option<Ty> {
    let mut s = s.trim();
    let mut depth = 0usize;
    // Peel `List<` off the front and its matching `>` off the back together, so the two counts cannot
    // disagree: `List<Nat>>` peels to the base `Nat>`, which matches no base type and is rejected.
    while let Some(rest) = s.strip_prefix("List<") {
        // `>` is ASCII, so `len() - 1` is a char boundary whenever `ends_with` holds.
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
}
