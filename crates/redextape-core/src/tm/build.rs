//! A composable builder for `Machine`s. `Builder` hands out fresh `StateId`s and appends rules via
//! `RuleSpec`, which defaults every untouched tape to (wildcard read, unchanged write, `Stay`) — so a
//! gadget names only the tapes it touches and stays agnostic to the fixed tape count. Part 2b's
//! `encoding` (gadgets) and `lower_tm` (control flow) build every `Machine` through this.

pub use crate::tm::machine::BLANK;
use crate::tm::machine::{Machine, Move, Rule, State, StateId, Symbol};

/// Fixed multi-tape layout (arity shared by every gadget so they compose).
pub const TAPES: usize = 5;
pub const REG: usize = 0;
pub const WORK: usize = 1;
pub const STACK: usize = 2;
pub const HEAP: usize = 3;
pub const BOX: usize = 4;

/// Tape data symbols. `BLANK` (`_`) comes from `machine`. `SEP` (`#`) delimits register fields.
pub const MARK: Symbol = '1';
pub const SEP: Symbol = '#';
/// The HEAP cons-cell delimiter: each cell is `@ <head word> # <tail word>`, where a WORD is written
/// in the encoding's own representation — a variable-length mark run under `Unary`, exactly `width`
/// digits under `Binary` (which is what makes a binary cell fixed-size and seekable by counting).
pub const AT: Symbol = '@';

/// The binary zero digit. `MARK` (`'1'`) doubles as the one digit, so base 2 costs exactly one new
/// symbol. The TM text form needs no change: `syntax::parse_sym` accepts any single char.
pub const ZERO: Symbol = '0';

/// The narrowest field width `run_tm`'s auto-fit search starts at.
pub const MIN_FIELD_WIDTH: usize = 4;

/// The widest field width: the ceiling of `run_tm`'s auto-fit search, and the default width of BOTH
/// encodings (`Unary::default()`, `Binary::default()`).
///
/// A register field is `width` CELLS. What a field of that many cells can HOLD is the encoding's own
/// business and differs sharply between the two: `Unary` stores `v` as `v` marks left-justified with
/// blank padding, so `v < width`; `Binary` stores exactly `width` LSB-first digits with no padding, so
/// `v < 2^width` and a 64-cell field is a full `u64`. Fixed width is what both share, and it is why a
/// write mutates the field IN PLACE and never has to shift the rest of the tape.
///
/// **The strict `v < width` bound is UNARY's, not this constant's** — see `encoding::unary`, which owns
/// the argument for why the padding blank is load-bearing there (`rewind_home` stops on the first `#`,
/// so a field written exactly full desynchronizes its delimiter-counting walk). `encoding::binary` has
/// no analogous requirement: both digits are content and every field is the same length.
///
/// A value that fits at no width up to this ceiling is reported as `TmRun::Overflow` by the shared
/// overflow guard (see `Builder::overflow`), for either encoding.
pub const MAX_FIELD_WIDTH: usize = 64;

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
    overflow: Option<StateId>,
}

impl Builder {
    pub fn new() -> Self {
        Self::default()
    }

    /// The ONE shared overflow-guard state, allocated on first request. Rule-less and non-accept, so
    /// reaching it halts the machine immediately and `simulate_final` can name it as the reason.
    ///
    /// Every gadget that writes a value into a fixed-width field (the REG bank, the BOX tape) routes its
    /// "this value does not fit" case here, rather than allocating a fault state of its own as the
    /// nil/dangling DEREF faults do. Those spin to a cap on purpose (matching λ's Ω and the reference's
    /// `Runtime`); an overflow is a different thing — the program is fine, the tape is too narrow — and
    /// the caller retries at a wider one, so it must be told apart from divergence.
    pub fn overflow(&mut self) -> StateId {
        match self.overflow {
            Some(s) => s,
            None => {
                let s = self.state("overflow");
                self.overflow = Some(s);
                s
            }
        }
    }

    /// The overflow state if one has been allocated, without allocating one.
    pub fn overflow_state(&self) -> Option<StateId> {
        self.overflow
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

    /// Number of states allocated so far. States are only ever appended (`state`/`accept` both push),
    /// never inserted or reordered, so a snapshot of this before and after a span of building exactly
    /// brackets the states that span created — the range `before..after` names them precisely.
    pub fn state_count(&self) -> usize {
        self.states.len()
    }

    /// Append a rule (built via `RuleSpec`) to state `s`, targeting `next`.
    pub fn add_rule(&mut self, s: StateId, spec: RuleSpec, next: StateId) {
        self.states[s as usize].rules.push(spec.into_rule(next));
    }

    /// Finalize into a `TAPES`-tape `Machine` starting at `start`.
    pub fn finish(self, start: StateId) -> Machine {
        Machine { states: self.states, start, tapes: TAPES }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::sim::{DEFAULT_CAPS as TM_DEFAULT_CAPS, Status, simulate};

    /// The overflow state is ONE shared, rule-less, non-accept state: repeated requests return the same
    /// id, and reaching it halts the machine (no rule matches, and it is not an accept state).
    #[test]
    fn overflow_state_is_shared_ruleless_and_non_accept() {
        let mut b = Builder::new();
        assert_eq!(b.overflow_state(), None, "not allocated until asked for");
        let first = b.overflow();
        let second = b.overflow();
        assert_eq!(first, second, "every gadget must share the one overflow state");
        assert_eq!(b.overflow_state(), Some(first));

        let start = b.state("start");
        b.add_rule(start, RuleSpec::new(), first);
        let m = b.finish(start);
        assert!(!m.states[first as usize].accept, "overflow must NOT be an accept state");
        assert!(m.states[first as usize].rules.is_empty(), "overflow must be rule-less so it halts");
    }

    #[test]
    fn rulespec_defaults_untouched_tapes() {
        // Touch only WORK: write a mark, move R. REG/STACK/HEAP/BOX default to wildcard/unchanged/stay.
        let r = RuleSpec::new().on(WORK, None, Some(MARK), Move::R).into_rule(7);
        assert_eq!(r.next, 7);
        assert_eq!(r.read, vec![None, None, None, None, None]);
        assert_eq!(r.write, vec![None, Some(MARK), None, None, None]);
        assert_eq!(r.moves, vec![Move::S, Move::R, Move::S, Move::S, Move::S]);
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

    #[test]
    fn box_tape_exists_and_is_addressable() {
        // A trivial 5-tape machine that writes a MARK on the BOX tape and halts.
        let mut b = Builder::new();
        let halt = b.accept("halt");
        let s0 = b.state("s0");
        b.add_rule(s0, RuleSpec::new().on(BOX, None, Some(MARK), Move::S), halt);
        let m = b.finish(s0);
        assert_eq!(m.tapes, 5);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        let (tapes, status) = crate::tm::sim::simulate(&m, &vec![Vec::new(); TAPES], crate::tm::sim::DEFAULT_CAPS);
        assert_eq!(status, crate::tm::sim::Status::Halted);
        assert_eq!(tapes[BOX].snapshot().0.first(), Some(&MARK));
    }
}
