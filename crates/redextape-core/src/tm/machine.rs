//! The multi-tape Turing machine model: a finite `Vec` of named control states, each with an ordered
//! list of transition rules over `tapes` two-way-infinite tapes. Deterministic (first matching rule
//! wins; `read[i] = None` is a per-tape wildcard) and flat (`Vec`-backed, no recursive tree — so no
//! hand-written `Drop`). Part 2b's `encoding`/`lower_tm` build `Machine`s; this module is data + checks.

use std::collections::{BTreeSet, HashSet};

/// A tape symbol. `BLANK` is the contents of an unwritten cell.
pub type Symbol = char;

/// The blank symbol. Also reserved (with `*`) by the text form.
pub const BLANK: Symbol = '_';

/// Index of a state in `Machine::states`.
pub type StateId = u32;

/// A head move.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub enum Move {
    L,
    R,
    S,
}

/// One transition rule. `read`/`write`/`moves` are per-tape (length == `Machine::tapes`).
/// `read[i] == None` matches any symbol under tape `i`'s head; `write[i] == None` leaves it unchanged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rule {
    pub read: Vec<Option<Symbol>>,
    pub write: Vec<Option<Symbol>>,
    pub moves: Vec<Move>,
    pub next: StateId,
}

/// A control state: a legible name (also its identity in the text form), an accept flag (accept =
/// halt), and rules matched in order (first match wins).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct State {
    pub name: String,
    pub accept: bool,
    pub rules: Vec<Rule>,
}

/// A multi-tape Turing machine. `states` is indexed by `StateId`; `start` is the initial state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Machine {
    pub states: Vec<State>,
    pub start: StateId,
    pub tapes: usize,
}

impl Machine {
    /// The sorted set of concrete symbols appearing in any rule (wildcards excluded). Derived — the
    /// text form and Plan 4's view model present it; it is not stored.
    #[must_use]
    pub fn alphabet(&self) -> Vec<Symbol> {
        let mut set: BTreeSet<Symbol> = BTreeSet::new();
        for s in &self.states {
            for r in &s.rules {
                for sym in r.read.iter().chain(r.write.iter()).flatten() {
                    set.insert(*sym);
                }
            }
        }
        set.into_iter().collect()
    }

    /// Structural invariants: `start` in range; every rule's `read`/`write`/`moves` have length
    /// `tapes`; every `next` in range. Plus text-form well-formedness (so `print_tm`/`parse_tm`
    /// round-trip without silent corruption): every state name is non-empty and free of whitespace
    /// and the reserved chars `; * : [ ]`, every concrete rule symbol is outside the reserved
    /// set `* ; [ ]` and not whitespace (the blank `_` is allowed), every state name is unique (the
    /// text form's identity), and an accept state carries no rules (`print_tm` drops them). Returns
    /// the problems (empty == valid). Never panics.
    #[must_use]
    pub fn validate(&self) -> Vec<String> {
        let mut errs = Vec::new();
        // Compare in `usize` space (widen `start`/`next` up, never narrow `states.len()` down):
        // `states.len() as u32` would truncate past `u32::MAX` states, and a truncated `n` would make
        // this out-of-range check compare `start`/`next` against the WRONG bound — the same class of
        // bug `mul_count_unrepresentable` avoids the same way, in `lower_tm.rs`.
        let n = self.states.len();
        if self.start as usize >= n {
            errs.push(format!("start state {} out of range (states: {n})", self.start));
        }
        let mut seen_names: HashSet<&str> = HashSet::new();
        for (i, s) in self.states.iter().enumerate() {
            if !name_representable(&s.name) {
                errs.push(format!(
                    "state {i} name {:?} is not representable (whitespace or reserved char ; * : [ ])",
                    s.name
                ));
            }
            if !seen_names.insert(s.name.as_str()) {
                errs.push(format!("duplicate state name `{}`", s.name));
            }
            if s.accept && !s.rules.is_empty() {
                errs.push(format!("accept state `{}` must have no rules", s.name));
            }
            for (j, r) in s.rules.iter().enumerate() {
                if r.read.len() != self.tapes || r.write.len() != self.tapes || r.moves.len() != self.tapes {
                    errs.push(format!("state {i} `{}` rule {j}: arity != {} tapes", s.name, self.tapes));
                }
                if r.next as usize >= n {
                    errs.push(format!("state {i} `{}` rule {j}: next {} out of range", s.name, r.next));
                }
                for sym in r.read.iter().chain(r.write.iter()).flatten() {
                    if !symbol_representable(*sym) {
                        errs.push(format!(
                            "state {i} `{}` rule {j}: symbol {sym:?} is not representable (whitespace or reserved char * ; [ ])",
                            s.name
                        ));
                    }
                }
            }
        }
        errs
    }
}

/// A state name is representable in the text form iff it is non-empty and has no whitespace or
/// reserved char (`;` comment, `*` wildcard, `:` state-header separator, `[` `]` symbol brackets).
fn name_representable(name: &str) -> bool {
    !name.is_empty() && !name.chars().any(|c| c.is_whitespace() || matches!(c, ';' | '*' | ':' | '[' | ']'))
}

/// A concrete rule symbol is representable iff it is not whitespace and not one of the reserved
/// text-form chars `* ; [ ]`. The blank symbol `_` is representable (it prints/parses as `_`).
fn symbol_representable(c: Symbol) -> bool {
    !(c.is_whitespace() || matches!(c, '*' | ';' | '[' | ']'))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1-tape "increment unary" machine: scan right over `1`s, write a `1` in the first blank, halt.
    fn increment() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "scan".into(),
                    accept: false,
                    rules: vec![
                        Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::R], next: 0 },
                        Rule { read: vec![None], write: vec![Some('1')], moves: vec![Move::S], next: 1 },
                    ],
                },
                State { name: "halt".into(), accept: true, rules: vec![] },
            ],
        }
    }

    #[test]
    fn valid_machine_has_no_validation_errors() {
        assert!(increment().validate().is_empty());
    }

    #[test]
    fn alphabet_is_the_symbols_used_in_rules() {
        assert_eq!(increment().alphabet(), vec!['1']);
    }

    #[test]
    fn validate_flags_out_of_range_targets_and_bad_arity() {
        let mut m = increment();
        m.states[0].rules[0].next = 99; // out of range
        m.states[0].rules[1].read = vec![]; // arity 0 != 1 tape
        m.start = 42; // out of range
        let errs = m.validate();
        assert!(errs.iter().any(|e| e.contains("start")));
        assert!(errs.iter().any(|e| e.contains("next")));
        assert!(errs.iter().any(|e| e.contains("arity")));
    }

    // Each of these three starts from an otherwise-VALID machine with exactly ONE text-form
    // violation and asserts `validate()` returns exactly that one error. The `errs.len() == 1` on an
    // otherwise-valid machine is what makes them discriminating: a broken/stubbed symbol check would
    // yield 0 errors on the symbol cases and fail, and the name-error message (which itself lists the
    // reserved chars) cannot masquerade as symbol coverage because each case isolates one path.

    #[test]
    fn validate_flags_a_whitespace_state_name() {
        let mut m = increment();
        m.states[0].name = "s x".into(); // the only issue: whitespace in a state name
        let errs = m.validate();
        assert_eq!(errs.len(), 1, "expected exactly one error: {errs:?}");
        assert!(errs[0].contains("name") && errs[0].contains("s x"), "{errs:?}");
    }

    #[test]
    fn validate_flags_a_star_data_symbol() {
        let mut m = increment();
        m.states[0].rules[0].write = vec![Some('*')]; // the only issue: `*` as a concrete symbol
        let errs = m.validate();
        assert_eq!(errs.len(), 1, "expected exactly one error: {errs:?}");
        assert!(errs[0].contains("symbol"), "{errs:?}");
    }

    #[test]
    fn validate_flags_a_semicolon_data_symbol() {
        let mut m = increment();
        m.states[0].rules[0].write = vec![Some(';')]; // the only issue: `;` as a concrete symbol
        let errs = m.validate();
        assert_eq!(errs.len(), 1, "expected exactly one error: {errs:?}");
        assert!(errs[0].contains("symbol"), "{errs:?}");
    }

    #[test]
    fn validate_flags_duplicate_state_names() {
        // Two states named "s": the text form's identity is the name, so `print_tm` would emit two
        // `state s:` headers and `parse_tm` would reject the second as a duplicate.
        let m = Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State { name: "s".into(), accept: true, rules: vec![] },
                State { name: "s".into(), accept: true, rules: vec![] },
            ],
        };
        let errs = m.validate();
        assert!(errs.iter().any(|e| e.contains("duplicate") && e.contains("s")), "{errs:?}");
    }

    #[test]
    fn validate_flags_an_accept_state_with_rules() {
        // `print_tm`'s accept branch prints only `state <name>: accept` and drops any rules, so an
        // accept state carrying a rule would silently lose it on a round-trip.
        let mut m = increment();
        m.states[1].accept = true;
        m.states[1].rules = vec![Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::R], next: 0 }];
        let errs = m.validate();
        assert!(errs.iter().any(|e| e.contains("accept") && e.contains("halt")), "{errs:?}");
    }

    #[test]
    fn validate_allows_identifier_names_and_blank_symbol() {
        // Identifier-ish names (`.`, digits, letters, `_`, `-`) and `_` data symbols are fine.
        let m = Machine {
            tapes: 1,
            start: 0,
            states: vec![State {
                name: "sum.rec".into(),
                accept: false,
                rules: vec![Rule { read: vec![Some('_')], write: vec![Some('1')], moves: vec![Move::S], next: 0 }],
            }],
        };
        assert!(m.validate().is_empty(), "unexpected: {:?}", m.validate());
    }
}
