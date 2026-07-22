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
