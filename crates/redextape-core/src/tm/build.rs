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

/// The most states any one `Machine` may contain. Reaching it makes `Builder` stop allocating and
/// raise `overflowed`; `lower_tm_all` then refuses the program rather than laying out the rest.
///
/// MEASURED, not chosen for roundness. At **727 bytes per state** — RSS delta around `lower_tm`,
/// against a `size_of::<State>()` of 56 that understates the heap `String` name and `Vec<Rule>` by
/// 13x — this ceiling is 727 MB, an order-of-magnitude figure rather than three-significant-figure
/// precision. 727 was the larger of two measured rows: 725 at 1,022 tokens (575,861 states) and 727 at
/// 4,094 tokens (8,595,317 states), the pair that established "stable across a 15x size range."
/// **That pairing can no longer be re-verified**: `MAX_MACHINE_STATES` now refuses the 4,094-token row
/// outright (see the "NOT ALL OF THEM" note below), so a fresh run of the probe re-derives only the
/// surviving row — 700-725 B/state depending on machine and allocator, not a pinned 727. Three facts
/// fix the ceiling at 727 MB regardless, none of which needs the retired row:
///
///   * The worst program this project SHIPS (the `map` + `ap2` demo in `native_oracle.rs`'s
///     `FIRST_ORDER_DEMOS`) builds **49,135** states, 35.7 MB, from 97 tokens — roughly 500 states
///     per token. The ceiling is 20x that in states, but the front door a user actually types against
///     is `MAX_TOKENS` (100,000), not a state count. At ~500 states/token (order-of-magnitude only —
///     it varies with program shape) the ceiling is reached around 2,000 tokens of demo-style code, a
///     few hundred lines: **a ~50x gap between what the parser accepts and what this backend can lay
///     out**. That gap, not the 20x in states, is what a reader needs to judge "never rejects a
///     legitimate program" against `MAX_TOKENS`'s own limit.
///   * A balanced arithmetic tree of 1,022 tokens builds 575,861 states (398 MB) and works today;
///     one of 4,094 tokens builds 8,595,317 (6.0 GB) and does not — that is fatal in wasm32, and at
///     16,382 tokens the same shape was killed by `SIGKILL` under an 8 GB budget. The ceiling admits the largest size
///     measured to work and refuses the first size measured not to.
///   * `StateId` is a `u32`, so the `states.len() as StateId` casts below sit a factor of **4,295**
///     under `StateId::MAX`. That is what makes them provable rather than argued.
///
/// **WHY A STATE COUNT AND NOT A `Program::code.len()` CAP.** Cost per instruction is not a
/// constant: 1 state for `Halt`/`Jmp`, 571 for `Box` under `Binary`, and for `Call` it scales with
/// the local bank — 973 states per call site at `n_loc` 4, 34,577 at 128, so ~270,000 (196 MB) for
/// ONE `Call` at the largest `n_loc` that `MAX_FRAME_LOC` permits. A length that bounds the
/// allocation is single digits; a length that admits real programs bounds nothing. `lower_tm_all`'s
/// three guards bound the MULTIPLIERS (`MAX_SLOTS` the register footprint, `MAX_FRAME_LOC` the frame
/// bank, `MAX_MUL_INSTRS` the `Mul` count) and nothing bounded the base, so their product was
/// unbounded. This bounds the product directly.
///
/// **AND WHY COUNTING RATHER THAN PREDICTING.** A `state_count_unrepresentable(prog, sm, enc)` that
/// estimated the cost up front would be symmetric with those three and would refuse before
/// allocating anything. It would also duplicate per-gadget cost knowledge in a second place, which
/// goes stale silently the first time a gadget changes — the same failure mode as the prose this
/// replaces. `Builder::state`/`accept` is the single choke point every state goes through, so a
/// ceiling here is exact and cannot drift from what the gadgets actually build.
///
/// Full measurement tables: `docs/superpowers/specs/2026-08-11-count-bounds-design.md` §3.
/// `cargo run --release --example state_cost_probe -p redextape-core` re-derives most of them.
///
/// **NOT ALL OF THEM, AND THE REASON IS THIS CONSTANT.** Two ROWS that justify the ceiling most
/// directly — the 8,595,317-state machine (4,094 tokens) and the run killed by `SIGKILL` (16,382
/// tokens) — were measured BEFORE the ceiling existed. It is enforced in `state`/`accept` below, the
/// choke point `lower_tm`, `lower_tm_guarded` and `lower_tm_mapped` all share, so no lowering
/// reachable from the probe can exceed it any more: those rows now report a refusal instead of a size.
/// A third casualty follows from the first: the "727 bytes per state, stable across a 15x range" claim
/// above needed BOTH the 1,022-token and the now-refused 4,094-token row, so a fresh run can re-derive
/// the surviving row's figure (700-725 B/state) but not 727, nor the stability claim across the pair.
/// **The evidence for a guard stops being reproducible once the guard is enforced**, which is worth
/// stating rather than leaving a reader to discover that the probe disagrees with this comment.
///
/// To re-derive them, raise this constant temporarily (one line) and re-run the probe under a memory
/// cap — the second row needs more than 8 GB, and being killed IS the measurement.
pub const MAX_MACHINE_STATES: usize = 1_000_000;

/// The state-0 sentinel `state`/`accept` return past the ceiling is only addressable because a
/// state 0 EXISTS by then, which needs the ceiling to be positive. Checked at COMPILE time rather
/// than in a test: a test asserting a property of a literal constant proves nothing a reader cannot
/// see, where this makes a future edit to zero fail the build.
const _: () = assert!(MAX_MACHINE_STATES > 0, "a zero ceiling would put the state-0 sentinel out of range");

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
    overflowed: bool,
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
    ///
    /// Callable past `MAX_MACHINE_STATES` (the encoding gadgets call it lazily, not just eagerly like
    /// `lower_tm_all` does), so it must not cache a refused allocation — see the comment inline below.
    pub fn overflow(&mut self) -> StateId {
        if let Some(s) = self.overflow {
            return s;
        }
        let s = self.state("overflow");
        // DO NOT CACHE A REFUSED ALLOCATION. Past `MAX_MACHINE_STATES`, `state` returns the state-0
        // sentinel without allocating, so caching here would pin `overflow` to whatever state 0
        // happens to be — `halt`, under `lower_tm_all` — and every later `overflow()`/`overflow_state()`
        // would hand back a wrong-but-plausible id rather than an overflow guard. The machine is
        // discarded in that case anyway; the point is that the wrongness cannot outlive the trip and
        // reach a caller that only checks `overflow_state()`.
        if !self.overflowed {
            self.overflow = Some(s);
        }
        s
    }

    /// The overflow state if one has been allocated, without allocating one.
    #[must_use]
    pub fn overflow_state(&self) -> Option<StateId> {
        self.overflow
    }

    /// Allocate a fresh non-accept state; returns its id. Names should be identifiers (no reserved
    /// text-form chars) so the produced machine stays round-trippable.
    ///
    /// **BOUNDED BY `MAX_MACHINE_STATES`, CHECKED ONE LINE BELOW** — which is what makes the cast
    /// provable rather than argued. `states.len()` cannot exceed the ceiling, and the ceiling is
    /// 4,295x under `StateId::MAX`, so the `as StateId` narrowing cannot truncate. The `#[allow]`
    /// stays only because clippy cannot see the guard above it.
    ///
    /// **PAST THE CEILING THIS RETURNS STATE 0 WITHOUT PUSHING**, and sets `overflowed`. State 0 is
    /// necessarily in range by then — a million states exist before the ceiling can trip — so a
    /// caller that goes on to `add_rule` against the returned id indexes a live state instead of
    /// panicking. It builds nonsense, which is exactly why `overflowed()` must be checked before the
    /// machine is used; being total here and refusing at the caller is the same shape of answer
    /// `lower_tm_all`'s three existing guards already give.
    ///
    /// **THIS REPLACES A PROSE ARGUMENT THAT WAS WRONG.** The previous doc reasoned that
    /// `prog.code.len()` was bounded by ~172 GB of resident memory and so the cast was unreachable.
    /// Measurement found a 6 KB balanced expression building an 8.6M-state, 6.0 GB machine and a
    /// 24 KB one getting killed by `SIGKILL` under an 8 GB budget — both reachable from the editor through
    /// `run_tm_described`. The cast was never the defect; the unbounded product was, and the process
    /// died at ~0.2% of the way to `StateId::MAX`. See `MAX_MACHINE_STATES` and
    /// `docs/superpowers/specs/2026-08-11-count-bounds-design.md` §3.
    #[allow(clippy::cast_possible_truncation)]
    pub fn state(&mut self, name: impl Into<String>) -> StateId {
        if self.states.len() >= MAX_MACHINE_STATES {
            self.overflowed = true;
            return 0;
        }
        let id = self.states.len() as StateId;
        self.states.push(State { name: name.into(), accept: false, rules: Vec::new() });
        id
    }

    /// Allocate a fresh accept (halt) state.
    ///
    /// Bounded and total the same way `state` is, and sharing the same counter — see that method's
    /// doc. Sharing matters: a ceiling on one door only would let a machine smuggle unbounded states
    /// in through the other.
    #[allow(clippy::cast_possible_truncation)]
    pub fn accept(&mut self, name: impl Into<String>) -> StateId {
        if self.states.len() >= MAX_MACHINE_STATES {
            self.overflowed = true;
            return 0;
        }
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

    /// Whether allocation has hit `MAX_MACHINE_STATES`.
    ///
    /// Once true, every `state`/`accept` call has returned the state-0 sentinel without pushing, so
    /// the part-built machine is nonsense — rules have been attached to a state that means nothing —
    /// and it must be DISCARDED rather than finished. Any caller that keeps building after this turns
    /// true — `lower_tm_all` builds one state per instruction, so it can — MUST check it and refuse
    /// the program rather than call `finish` and hand out the nonsense machine.
    ///
    /// NOT THE SAME THING AS `overflow_state()`, despite the names sitting next to each other.
    /// That one is the machine's own runtime overflow guard — a value too wide for its field, a
    /// property of the program being run. This one is a build-time refusal: the machine was too big
    /// to lay out and no machine exists.
    #[must_use]
    pub fn overflowed(&self) -> bool {
        self.overflowed
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

    /// `Builder` stops allocating at `MAX_MACHINE_STATES` and says so, rather than growing until the
    /// allocator gives up.
    ///
    /// THE ONE TEST THAT TRIPS THE CEILING DIRECTLY. It allocates the full ceiling in rule-less
    /// states with a 1-char name — a `Vec<State>` of 1,000,000 entries at `size_of::<State>()` = 56
    /// bytes is 56 MB, plus 1,000,000 one-byte heap `String`s at glibc's 32-byte minimum chunk (~32
    /// MB), so ~90 MB and a second or two — still far cheaper than the ~727 bytes a real state (name
    /// plus `Vec<Rule>`, as `lower_tm` produces) costs — see `MAX_MACHINE_STATES`. This runs in the
    /// DEFAULT (fast) tier, in parallel under `cargo nextest`, alongside
    /// `overflow_does_not_cache_a_refused_allocation` below (another ~90 MB) and two
    /// `vec![Instr::Halt; MAX_MACHINE_STATES + 1]` allocations elsewhere in the same tier (`tm.rs`,
    /// `tests/guard_counterexamples.rs`, ~40 MB each) — it is the fast tier's COMBINED peak that
    /// matters for a memory budget, not any one of these tests' number alone.
    #[test]
    fn the_builder_stops_at_the_state_ceiling_and_reports_it() {
        let mut b = Builder::new();
        for _ in 0..MAX_MACHINE_STATES {
            b.state("s");
        }
        assert!(!b.overflowed(), "exactly the ceiling is allowed, not one less");
        assert_eq!(b.state_count(), MAX_MACHINE_STATES);

        let past = b.state("one too many");
        assert!(b.overflowed(), "one past the ceiling must raise the flag");
        assert_eq!(past, 0, "a refused allocation returns state 0, which is always in range by then");
        assert_eq!(b.state_count(), MAX_MACHINE_STATES, "and must not have pushed");

        // `accept` shares the ceiling: a machine cannot smuggle extra states in through the other door.
        assert_eq!(b.accept("also refused"), 0);
        assert_eq!(b.state_count(), MAX_MACHINE_STATES);
    }

    /// `overflow()` must not cache a refused allocation. Past the ceiling, `state(..)` returns the
    /// state-0 sentinel WITHOUT pushing; if `overflow()` cached that return unconditionally, the
    /// FIRST call made once the ceiling has tripped would permanently pin `self.overflow` to
    /// `Some(0)` — the id of whatever real state occupies index 0 — and every later
    /// `overflow()`/`overflow_state()` would hand back that wrong-but-plausible id as if it were a
    /// real overflow guard.
    ///
    /// This drives the builder to EXACTLY the ceiling with rule-less `state("s")` calls, then makes
    /// `overflow()` itself the call that trips it — the one case the old code got wrong. If the `if
    /// !self.overflowed` guard in `overflow()` is removed, `overflow_state()` below reports
    /// `Some(0)` instead of `None` and this test fails.
    ///
    /// Allocates the full ceiling in rule-less states — ~90 MB (56 MB `Vec<State>` + ~32 MB of
    /// one-byte heap `String`s at glibc's 32-byte minimum chunk) and a second or two, same as
    /// `the_builder_stops_at_the_state_ceiling_and_reports_it` above — see that test's doc for why the
    /// fast tier's COMBINED peak, not this number alone, is what a memory budget has to clear.
    #[test]
    fn overflow_does_not_cache_a_refused_allocation() {
        let mut b = Builder::new();
        for _ in 0..MAX_MACHINE_STATES {
            b.state("s");
        }
        assert!(!b.overflowed(), "exactly the ceiling is allowed, not one less");
        assert_eq!(b.overflow_state(), None, "not allocated until asked for");

        // `overflow`'s own allocation is the one that trips the ceiling: this is the "first call
        // after the trip" scenario the caching bug got wrong.
        let s = b.overflow();
        assert!(b.overflowed(), "overflow's own allocation must trip the ceiling");
        assert_eq!(s, 0, "past the ceiling, overflow returns the state-0 sentinel, same as state/accept");
        assert_eq!(
            b.overflow_state(),
            None,
            "a refused allocation must NOT be cached — overflow_state() must not report Some(0) as \
             though state 0 were a real overflow guard"
        );

        // A later, genuinely-answerable question about the same builder must not see a poisoned
        // cache either: still refused, still uncached, every time.
        assert_eq!(b.overflow(), 0);
        assert_eq!(b.overflow_state(), None);
    }
}
