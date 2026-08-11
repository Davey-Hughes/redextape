//! A composable builder for `Machine`s. `Builder` hands out fresh `StateId`s and appends rules via
//! `RuleSpec`, which defaults every untouched tape to (wildcard read, unchanged write, `Stay`) — so a
//! gadget names only the tapes it touches and stays agnostic to the fixed tape count. Part 2b's
//! `encoding` (gadgets) and `lower_tm` (control flow) build every `Machine` through this.

pub use crate::tm::machine::BLANK;
use crate::tm::machine::{Machine, Move, Rule, State, StateId, Symbol};

/// Fixed multi-tape layout (arity shared by every gadget so they compose).
pub const TAPES: usize = 5;

/// The most tapes a PARSED machine may declare.
///
/// A TOTALITY guard on untrusted input, not a language limit. `tapes N` from a `.tm` file drives
/// `TmHeader::init`'s allocation directly, and a rule-less accept state means the rule-arity check
/// never constrains it — so without this, `tapes 10_000_000_000` parses clean and the documented next
/// step allocates that many `Vec`s. `sim.rs` guards the same scenario one call later, by name.
///
/// This compiler emits `TAPES` (5). 64 leaves an order of magnitude for hand-written machines while
/// bounding the allocation to something a test can survive.
pub const MAX_TAPES: usize = 64;
pub const REG: usize = 0;
pub const WORK: usize = 1;
pub const STACK: usize = 2;
pub const HEAP: usize = 3;
pub const BOX: usize = 4;

/// The lowering's tape layout as display names, indexed by the five constants above.
///
/// A RENDERER NEEDS THIS AND `TmProgram` DOES NOT CARRY IT. `TmProgram` reports `tapes: usize` and no
/// names, so a five-row tape view either labels its rows from here or hardcodes five strings in
/// whatever language it is written in — which is the drift `encodings()` was exported to prevent, one
/// language further out.
///
/// IT DESCRIBES MACHINES THIS COMPILER PRODUCED, AND NOTHING ELSE. `Machine::tapes` is a runtime field
/// and `parse_tm` accepts a hand-written machine declaring up to `MAX_TAPES` (64), so a consumer must
/// label tape `i` positionally when `i >= TAPE_NAMES.len()` rather than assume every machine has five.
pub const TAPE_NAMES: [&str; TAPES] = ["REG", "WORK", "STACK", "HEAP", "BOX"];

/// Tape data symbols. `BLANK` (`_`) comes from `machine`. `MARK` (`1`) is the unary mark, one per unit
/// of a value's count. `SEP` (`#`) delimits register fields.
pub const MARK: Symbol = '1';
pub const SEP: Symbol = '#';
/// The HEAP cons-cell delimiter (`@`): each cell is `@ <head word> # <tail word>`, where a WORD is
/// written in the encoding's own representation — a variable-length mark run under `Unary`, exactly
/// `width` digits under `Binary` (which is what makes a binary cell fixed-size and seekable by counting).
pub const AT: Symbol = '@';

/// The binary zero digit (`0`). `MARK` (`'1'`) doubles as the one digit, so base 2 costs exactly one
/// new symbol. The TM text form needs no change: `syntax::parse_sym` accepts any single char.
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
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// On tape `t`: require reading `r` (`None` = any), write `w` (`None` = unchanged), move `m`.
    #[must_use]
    pub fn on(mut self, t: usize, r: Option<Symbol>, w: Option<Symbol>, m: Move) -> Self {
        self.read[t] = r;
        self.write[t] = w;
        self.moves[t] = m;
        self
    }

    /// Finalize into a `Rule` targeting `next`.
    #[must_use]
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
    #[must_use]
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
        if let Some(s) = self.overflow {
            s
        } else {
            let s = self.state("overflow");
            self.overflow = Some(s);
            s
        }
    }

    /// The overflow state if one has been allocated, without allocating one.
    #[must_use]
    pub fn overflow_state(&self) -> Option<StateId> {
        self.overflow
    }

    /// Allocate a fresh non-accept state; returns its id. Names should be identifiers (no reserved
    /// text-form chars) so the produced machine stays round-trippable.
    ///
    /// Bounded by memory, not by a runtime check. `lower_tm::lower_tm_all` (the caller that can build
    /// the most states) allocates one `pc` entry state per `prog.code.len()` UNCONDITIONALLY: none of
    /// its three guards constrains `prog.code.len()` itself. `MAX_SLOTS` bounds the register footprint
    /// (`SlotMap::n_slots()`, the highest `Loc`/`Arg` index referenced, not the instruction count);
    /// `mul_count_unrepresentable` counts only `Instr::Bin(BinOp::Mul, ..)`; `frame_bank_unrepresentable`
    /// only fires when a `Call` is present, and only gates the `O(n_loc^2)` frame gadgets built later,
    /// not the `pc` allocation. A `Program` of billions of `Instr::Halt` (or any other single
    /// instruction, no `Mul`, no `Call`) passes all three untouched and still drives this to
    /// `prog.code.len()` calls. What actually bounds the cast: `size_of::<Instr>()` is 40 bytes, so a
    /// `code: Vec<Instr>` long enough to push `states.len()` past `StateId::MAX` (u32, ~4.29 billion)
    /// needs ~172 GB resident for `code` alone — before `lower_tm_all`, or anything else in this crate,
    /// is ever called. Not reachable from real input, hand-built or fuzzed alike (`lower_tm_all`'s own
    /// doc names exactly that threat model). Every other caller (`encoding.rs`'s gadgets) builds
    /// O(width) states bounded by `MAX_FIELD_WIDTH` (64).
    #[allow(clippy::cast_possible_truncation)]
    pub fn state(&mut self, name: impl Into<String>) -> StateId {
        let id = self.states.len() as StateId;
        self.states.push(State { name: name.into(), accept: false, rules: Vec::new() });
        id
    }

    /// Allocate a fresh accept (halt) state.
    ///
    /// Bounded the same way `state` is — see that method's doc.
    #[allow(clippy::cast_possible_truncation)]
    pub fn accept(&mut self, name: impl Into<String>) -> StateId {
        let id = self.states.len() as StateId;
        self.states.push(State { name: name.into(), accept: true, rules: Vec::new() });
        id
    }

    /// Number of states allocated so far. States are only ever appended (`state`/`accept` both push),
    /// never inserted or reordered, so a snapshot of this before and after a span of building exactly
    /// brackets the states that span created — the range `before..after` names them precisely.
    #[must_use]
    pub fn state_count(&self) -> usize {
        self.states.len()
    }

    /// Append a rule (built via `RuleSpec`) to state `s`, targeting `next`.
    pub fn add_rule(&mut self, s: StateId, spec: RuleSpec, next: StateId) {
        self.states[s as usize].rules.push(spec.into_rule(next));
    }

    /// Finalize into a `TAPES`-tape `Machine` starting at `start`.
    #[must_use]
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

    /// `TAPE_NAMES` is the display authority and the five constants are the code authority; nothing
    /// but this test stops them drifting apart. Indexing by the constant rather than by a literal is
    /// the whole point — a reordered array fails here rather than mislabelling a tape in the UI.
    #[test]
    fn tape_names_match_their_indices() {
        assert_eq!(TAPE_NAMES.len(), TAPES);
        assert_eq!(TAPE_NAMES[REG], "REG");
        assert_eq!(TAPE_NAMES[WORK], "WORK");
        assert_eq!(TAPE_NAMES[STACK], "STACK");
        assert_eq!(TAPE_NAMES[HEAP], "HEAP");
        assert_eq!(TAPE_NAMES[BOX], "BOX");
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
