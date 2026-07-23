//! A composable builder for `Machine`s. `Builder` hands out fresh `StateId`s and appends rules via
//! `RuleSpec`, which defaults every untouched tape to (wildcard read, unchanged write, `Stay`) — so a
//! gadget names only the tapes it touches and stays agnostic to the fixed tape count. Part 2b's
//! `encoding` (gadgets) and `lower_tm` (control flow) build every `Machine` through this.

pub use crate::tm::machine::BLANK;
use crate::tm::machine::{Machine, Move, Rule, State, StateId, Symbol};

/// Fixed multi-tape layout (arity shared by every gadget so they compose).
pub const TAPES: usize = 4;
pub const REG: usize = 0;
pub const WORK: usize = 1;
pub const STACK: usize = 2;
pub const HEAP: usize = 3;

/// Tape data symbols. `BLANK` (`_`) comes from `machine`. `SEP` (`#`) delimits register fields.
pub const MARK: Symbol = '1';
pub const SEP: Symbol = '#';
/// The HEAP cons-cell delimiter: each cell is `@ <head marks> # <tail marks>`.
pub const AT: Symbol = '@';

/// Fixed width (cells) of every register field: a value `v` is `v` `MARK`s left-justified, then
/// `FIELD_WIDTH - v` `BLANK`s. Fixed width means a write mutates the field IN PLACE (blank the window,
/// write the marks) and never has to shift the rest of the tape. The bound is STRICT: `v` must stay
/// `< FIELD_WIDTH`, so at least one padding blank always remains. This is load-bearing, not cosmetic —
/// `rewind_home` walks left and stops on the first `#` it meets; a field written EXACTLY full (zero
/// padding) has no interior blank for the copy/write/erase loops to land on, so they instead stop on the
/// field's trailing `#`, and `rewind_home` then crosses one delimiter too many and lands the REG head one
/// field to the RIGHT of home (2b-2 sizes this per program / the value bound; 64 is ample for 2b-1's
/// small test values).
pub const FIELD_WIDTH: usize = 64;

/// A register-bank field index.
pub type Slot = u32;

/// A partial transition rule under construction: name only the tapes you touch; the rest default to
/// (wildcard read, unchanged write, `Stay`).
pub struct RuleSpec {
    read: [Option<Symbol>; TAPES],
    write: [Option<Symbol>; TAPES],
    moves: [Move; TAPES],
}

impl Default for RuleSpec {
    fn default() -> Self {
        RuleSpec { read: [None; TAPES], write: [None; TAPES], moves: [Move::S; TAPES] }
    }
}

impl RuleSpec {
    pub fn new() -> Self {
        Self::default()
    }

    /// On tape `t`: require reading `r` (`None` = any), write `w` (`None` = unchanged), move `m`.
    pub fn on(mut self, t: usize, r: Option<Symbol>, w: Option<Symbol>, m: Move) -> Self {
        self.read[t] = r;
        self.write[t] = w;
        self.moves[t] = m;
        self
    }

    /// Finalize into a `Rule` targeting `next`.
    pub fn into_rule(self, next: StateId) -> Rule {
        Rule { read: self.read.to_vec(), write: self.write.to_vec(), moves: self.moves.to_vec(), next }
    }
}

/// Incrementally builds a `Machine`'s states.
#[derive(Default)]
pub struct Builder {
    states: Vec<State>,
}

impl Builder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Allocate a fresh non-accept state; returns its id. Names should be identifiers (no reserved
    /// text-form chars) so the produced machine stays round-trippable.
    pub fn state(&mut self, name: impl Into<String>) -> StateId {
        let id = self.states.len() as StateId;
        self.states.push(State { name: name.into(), accept: false, rules: Vec::new() });
        id
    }

    /// Allocate a fresh accept (halt) state.
    pub fn accept(&mut self, name: impl Into<String>) -> StateId {
        let id = self.states.len() as StateId;
        self.states.push(State { name: name.into(), accept: true, rules: Vec::new() });
        id
    }

    /// Append a rule (built via `RuleSpec`) to state `s`, targeting `next`.
    pub fn add_rule(&mut self, s: StateId, spec: RuleSpec, next: StateId) {
        self.states[s as usize].rules.push(spec.into_rule(next));
    }

    /// Finalize into a 4-tape `Machine` starting at `start`.
    pub fn finish(self, start: StateId) -> Machine {
        Machine { states: self.states, start, tapes: TAPES }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::sim::{DEFAULT_CAPS as TM_DEFAULT_CAPS, Status, simulate};

    #[test]
    fn rulespec_defaults_untouched_tapes() {
        // Touch only WORK: write a mark, move R. REG/STACK/HEAP default to wildcard/unchanged/stay.
        let r = RuleSpec::new().on(WORK, None, Some(MARK), Move::R).into_rule(7);
        assert_eq!(r.next, 7);
        assert_eq!(r.read, vec![None, None, None, None]);
        assert_eq!(r.write, vec![None, Some(MARK), None, None]);
        assert_eq!(r.moves, vec![Move::S, Move::R, Move::S, Move::S]);
    }

    #[test]
    fn builds_and_runs_a_two_state_machine() {
        // A machine that writes one MARK on WORK then halts (proves Builder + sim integrate).
        let mut b = Builder::new();
        let go = b.state("go");
        let halt = b.accept("halt");
        b.add_rule(go, RuleSpec::new().on(WORK, None, Some(MARK), Move::S), halt);
        let m = b.finish(go);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        let (tapes, status) = simulate(&m, &[], TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(tapes[WORK].snapshot().0, vec![MARK]);
    }
}
