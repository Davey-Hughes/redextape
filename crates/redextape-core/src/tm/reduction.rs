//! What the three machine-model reductions share: the table every state they generate is created in,
//! capped at a ceiling, and the one shape a refusal takes.
//!
//! **ONE CEILING FOR THREE CONSTRUCTIONS.** `single_tape.rs`, `two_symbol.rs` and `one_way.rs` create
//! every state through a [`StateTable`], so the state ceiling is enforced in one place, and a fourth
//! reduction gets it by using the table. `build.rs`'s `Builder` enforces `MAX_MACHINE_STATES` for
//! lowering; this is the reductions' counterpart to it, not a replacement.
//!
//! **A REFUSAL SURVIVES THE STAGES AFTER IT.** Each stage builds its states under names of its own, so
//! reducing another stage's refusal would erase the refusal's name. Every stage therefore returns a
//! refused input unchanged, and [`refusal`] on the end of a pipeline answers for every stage in it.

use std::collections::HashMap;

use crate::tm::machine::{Machine, State, StateId};

/// The refusal a stage returns when the machine it is building would exceed its state ceiling.
pub const TOO_MANY_STATES: &str = "too-many-states";
/// The single-tape reduction's refusal of a machine with more tapes than its markers can name.
pub const TOO_MANY_TAPES: &str = "too-many-tapes";
/// The single-tape reduction's refusal of a machine whose alphabet collides with its block layout.
pub const ALPHABET_COLLISION: &str = "alphabet-collision";
/// The alphabet reduction's refusal of a code that cannot encode the machine's alphabet.
pub const CODE_DOES_NOT_COVER_ALPHABET: &str = "code-does-not-cover-alphabet";
/// The one-way fold's refusal of a machine whose rules name its marker.
pub const LEFT_END_COLLISION: &str = "left-end-collision";

/// Every refusal name. [`refusal`] recognises a machine only when its one state carries one of these.
pub const REFUSALS: [&str; 5] =
    [TOO_MANY_STATES, TOO_MANY_TAPES, ALPHABET_COLLISION, CODE_DOES_NOT_COVER_ALPHABET, LEFT_END_COLLISION];

/// The degenerate machine a stage returns instead of a construction it cannot build: one non-accept
/// state with no rules, on one tape, named for the reason. It halts at once without accepting.
pub(crate) fn refused(name: &'static str) -> Machine {
    Machine { states: vec![State { name: name.into(), accept: false, rules: vec![] }], start: 0, tapes: 1 }
}

/// The reason `m` is a refusal, or `None` when it is not one.
///
/// **THE SHAPE IS CHECKED, NOT ONLY THE NAME.** A machine is a refusal when it is exactly what
/// [`refused`] builds: one state, which is the start state, is not an accept and has no rules, on one
/// tape, named by one of [`REFUSALS`]. A state that carries a rule or accepts is doing something,
/// whatever it is called.
///
/// **A HAND-WRITTEN MACHINE OF EXACTLY THIS SHAPE IS INDISTINGUISHABLE FROM A REFUSAL**, and every stage
/// passes it through unchanged. That is accepted rather than worked around with a side channel.
#[must_use]
pub fn refusal(m: &Machine) -> Option<&'static str> {
    let [only] = m.states.as_slice() else { return None };
    if m.start != 0 || m.tapes != 1 || only.accept || !only.rules.is_empty() {
        return None;
    }
    REFUSALS.into_iter().find(|name| *name == only.name)
}

/// Assigns a `StateId` to every state a reduction generates, by name, and creates at most `ceiling` of
/// them.
///
/// **PAST THE CEILING, `id` RETURNS STATE 0 WITHOUT CREATING ANYTHING** and sets `overflowed` — the answer
/// `build.rs`'s `Builder::state` gives at `MAX_MACHINE_STATES`. A stage checks `overflowed` as it builds
/// and returns [`refused`] with [`TOO_MANY_STATES`], so a machine that would hold millions of states stops
/// at the ceiling instead of being built first and measured afterwards. A refused name is not recorded,
/// so asking for it again trips again rather than resolving to state 0.
pub(crate) struct StateTable {
    ids: HashMap<String, StateId>,
    states: Vec<State>,
    ceiling: usize,
    overflowed: bool,
}

impl StateTable {
    /// An empty table that creates at most `ceiling` states.
    pub(crate) fn new(ceiling: usize) -> StateTable {
        StateTable { ids: HashMap::new(), states: Vec::new(), ceiling, overflowed: false }
    }

    /// The id for `name`, creating a non-accept state with no rules on first mention. A name already in
    /// the table still resolves after the ceiling has tripped.
    pub(crate) fn id(&mut self, name: &str) -> StateId {
        if let Some(id) = self.ids.get(name) {
            return *id;
        }
        if self.states.len() >= self.ceiling {
            self.overflowed = true;
            return 0;
        }
        let id = StateId::try_from(self.states.len()).unwrap_or(0);
        self.ids.insert(name.to_string(), id);
        self.states.push(State { name: name.to_string(), accept: false, rules: Vec::new() });
        id
    }

    /// The id `name` already has, without creating a state.
    pub(crate) fn get(&self, name: &str) -> Option<StateId> {
        self.ids.get(name).copied()
    }

    /// The state `id` names, or `None` when the table holds no state `id`.
    pub(crate) fn get_mut(&mut self, id: StateId) -> Option<&mut State> {
        self.states.get_mut(id as usize)
    }

    /// Whether `id` has refused a name for the ceiling.
    pub(crate) fn overflowed(&self) -> bool {
        self.overflowed
    }

    /// The states the table created, in id order.
    pub(crate) fn into_states(self) -> Vec<State> {
        self.states
    }
}

/// The largest machine the shipped demos build, with the initial tapes it runs on: the `map` + `ap2` entry
/// of `native_oracle.rs`'s `FIRST_ORDER_DEMOS`, which `state_cost_probe`'s section G finds as the corpus's
/// maximum, lowered as section G lowers it — under `Binary` at `MAX_FIELD_WIDTH`, 49,135 states.
///
/// The source is byte-identical to `guard_counterexamples.rs`'s `WORST_SHIPPED_DEMO`, which an
/// integration test cannot share. Within this crate's unit tests it is written once, here, for
/// `single_tape.rs`'s `the_worst_shipped_demo_measured_directly` and the three slow-tier tests below.
///
/// **ONE HAND-COPIED PROGRAM RATHER THAN THE WHOLE 46-ENTRY CORPUS.**
/// `single_tape.rs`'s `real_lowered_machines_cost_far_more_than_the_toy_fixtures` already hand-copies
/// individual `FIRST_ORDER_DEMOS` entries the same way, and which entry is the corpus's maximum is section G's
/// job to re-derive, not this crate's unit tests' — this lowers the one entry that job has already named.
///
/// **`run_tm_described_at(..., MAX_FIELD_WIDTH)` REPRODUCES SECTION G'S OWN METHOD** (`Binary::default()` is
/// `MAX_FIELD_WIDTH`, not an auto-fitted width): confirmed by getting the identical 49,135 states back, where
/// `run_tm_described`'s normal auto-fit search — the sequence
/// `real_lowered_machines_cost_far_more_than_the_toy_fixtures` uses — lands on a narrower width and only
/// 12,295 states for this same program, understating the ratio `single_tape.rs`'s `CEILING` actually needs
/// (single-tape ratios measured 28.29 at the auto-fitted width against 39.51 at `MAX_FIELD_WIDTH`, before the
/// no-write split in `single_tape.rs`'s `emit_one_tape_pass`).
#[cfg(test)]
pub(crate) fn worst_shipped_demo() -> (Machine, Vec<Vec<crate::tm::machine::Symbol>>) {
    use crate::tm::{EncodingKind, MAX_FIELD_WIDTH, TM_DEFAULT_CAPS, run_tm_described_at};

    const WORST_SHIPPED_DEMO: &str = "\
        fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
        fn add1(x) { x + 1 }\n\
        fn ap2(g, a, b) { g(a, b) }\n\
        head(map([1, 2], add1)) + head(ap2(map, [5, 6], add1))";

    let (prog, ds) = crate::parser::parse(WORST_SHIPPED_DEMO);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let prog = prog.unwrap_or_else(|| panic!("no program for the worst shipped demo"));
    let ty = crate::typeck::result_type(&prog).unwrap_or_else(|e| panic!("type errors: {e:?}"));
    let core = crate::desugar::desugar(&prog);
    let d = run_tm_described_at(&core, EncodingKind::Binary, ty, TM_DEFAULT_CAPS, MAX_FIELD_WIDTH)
        .unwrap_or_else(|r| panic!("the worst shipped demo did not run: {r:?}"));
    let init = d.header.init(d.machine.tapes);
    (d.machine, init)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::machine::{Move, Rule};

    /// **THE REAL CEILING, ON THE LARGEST SHIPPED DEMO.** Every ceiling test beside a stage passes its
    /// ceiling in by hand, so a public `to_*` that stopped passing `MAX_MACHINE_STATES` would leave all of
    /// them green; only a trip at the real ceiling can see it. One test per stage rather than one test with
    /// three assertions, because a failed assertion ends its test and would hide the stages after it.
    ///
    /// Unguarded, [`worst_shipped_demo`] builds 1,811,054 states through stage 1, 2,601,972 through stage 2
    /// applied to the lowered machine, and 7,363,253 through the fold
    /// (`docs/superpowers/specs/2026-09-14-reduction-state-guard-design.md`), so each stage fills its table
    /// to the ceiling before it refuses. Each test then asserts that its stage's `states_per_original` is
    /// `None` on the same demo, which builds that stage's table to the ceiling a second time.
    ///
    /// Peak RSS of this test alone, as the release test binary's `ru_maxrss`: 746,100 KB, in 2.3 s.
    #[test]
    #[ignore = "slow tier: builds a ceiling's worth of states before refusing; run via scripts/check-slow.sh"]
    fn stage_one_refuses_the_worst_shipped_demo_at_the_real_ceiling() {
        use crate::tm::single_tape::{states_per_original, to_single_tape};
        let (m, _inits) = worst_shipped_demo();
        assert_eq!(refusal(&to_single_tape(&m)), Some(TOO_MANY_STATES));
        assert_eq!(states_per_original(&m), None, "a refusal must not be reported as a ratio");
    }

    /// Stage 2 on the lowered machine, with the `Code` its initial tapes need. See
    /// `stage_one_refuses_the_worst_shipped_demo_at_the_real_ceiling` for why each stage has its own test.
    ///
    /// Peak RSS of this test alone, as the release test binary's `ru_maxrss`: 675,104 KB, in 2.0 s.
    #[test]
    #[ignore = "slow tier: builds a ceiling's worth of states before refusing; run via scripts/check-slow.sh"]
    fn stage_two_refuses_the_worst_shipped_demo_at_the_real_ceiling() {
        use crate::tm::two_symbol::{Code, states_per_original, to_two_symbol};
        let (m, inits) = worst_shipped_demo();
        let code = Code::new(&m, &inits);
        assert_eq!(refusal(&to_two_symbol(&m, &code)), Some(TOO_MANY_STATES));
        assert_eq!(states_per_original(&m, &code), None, "a refusal must not be reported as a ratio");
    }

    /// The fold on the lowered machine. See `stage_one_refuses_the_worst_shipped_demo_at_the_real_ceiling`
    /// for why each stage has its own test.
    ///
    /// Peak RSS of this test alone, as the release test binary's `ru_maxrss`: 722,860 KB, in 2.4 s.
    #[test]
    #[ignore = "slow tier: builds a ceiling's worth of states before refusing; run via scripts/check-slow.sh"]
    fn the_fold_refuses_the_worst_shipped_demo_at_the_real_ceiling() {
        use crate::tm::one_way::{states_per_original, to_one_way};
        let (m, _inits) = worst_shipped_demo();
        assert_eq!(refusal(&to_one_way(&m)), Some(TOO_MANY_STATES));
        assert_eq!(states_per_original(&m), None, "a refusal must not be reported as a ratio");
    }

    #[test]
    fn a_state_table_refuses_the_first_new_name_past_its_ceiling() {
        let mut t = StateTable::new(3);
        assert_eq!([t.id("a"), t.id("b"), t.id("c")], [0, 1, 2]);
        assert!(!t.overflowed(), "three states fit a ceiling of three");
        assert_eq!(t.id("d"), 0, "past the ceiling, state 0 without creating a state");
        assert!(t.overflowed());
        assert_eq!(t.id("b"), 1, "a name already in the table still resolves after the trip");
        assert_eq!(t.get("d"), None, "a refused name is not recorded, so asking again trips again");
        let names: Vec<String> = t.into_states().into_iter().map(|s| s.name).collect();
        assert_eq!(names, ["a", "b", "c"], "`d` was never created");
    }

    #[test]
    fn refusal_names_every_machine_refused_builds() {
        for name in REFUSALS {
            assert_eq!(refusal(&refused(name)), Some(name));
        }
    }

    /// **A REFUSAL SURVIVES EVERY STAGE AFTER IT**, in the orders the oracles compose the stages: stage 1
    /// then stage 2, the fold then stage 2, and the fold then stage 1 then stage 2. Each stage's own test
    /// shows it passing a refusal through alone; this runs the chains a pipeline relies on when it calls
    /// [`refusal`] once, at its end.
    #[test]
    fn a_refusal_survives_every_stage_after_it() {
        use crate::tm::one_way::to_one_way;
        use crate::tm::single_tape::to_single_tape;
        use crate::tm::two_symbol::{Code, to_two_symbol};
        let two_symbol = |m: &Machine| to_two_symbol(m, &Code::new(m, &[]));
        for name in REFUSALS {
            let r = refused(name);
            assert_eq!(refusal(&two_symbol(&to_single_tape(&r))), Some(name), "stage 1 then stage 2, for {name}");
            assert_eq!(refusal(&two_symbol(&to_one_way(&r))), Some(name), "the fold then stage 2, for {name}");
            assert_eq!(
                refusal(&two_symbol(&to_single_tape(&to_one_way(&r)))),
                Some(name),
                "the fold then stage 1 then stage 2, for {name}"
            );
        }
    }

    fn one_state(name: &str, accept: bool, rules: Vec<Rule>, tapes: usize) -> Machine {
        Machine { states: vec![State { name: name.into(), accept, rules }], start: 0, tapes }
    }

    #[test]
    fn refusal_checks_the_shape_and_not_only_the_name() {
        let rule = Rule { read: vec![None], write: vec![None], moves: vec![Move::S], next: 0 };
        for (what, m) in [
            ("a rule", one_state(TOO_MANY_STATES, false, vec![rule], 1)),
            ("an accept", one_state(TOO_MANY_STATES, true, vec![], 1)),
            ("two tapes", one_state(TOO_MANY_STATES, false, vec![], 2)),
            ("a name no refusal carries", one_state("q0.stuck", false, vec![], 1)),
        ] {
            assert_eq!(refusal(&m), None, "a one-state machine with {what}");
        }
        let mut two = refused(TOO_MANY_STATES);
        two.states.push(State { name: "extra".into(), accept: false, rules: vec![] });
        assert_eq!(refusal(&two), None, "a refusal with a second state");
        let mut elsewhere = refused(TOO_MANY_STATES);
        elsewhere.start = 1;
        assert_eq!(refusal(&elsewhere), None, "a refusal whose start is not its one state");
    }
}
