//! Reduced `.tm` files: a lowered machine after any of the three reductions, written so that the file
//! alone runs and decodes to the program's value.
//!
//! [`reduce`] applies the stages a caller names to a [`DescribedRun`], checks the result by running it,
//! and returns the reduced machine with its `version 2` header. [`decode_reduced`] undoes a header's
//! stages on a run's final tapes and decodes the value. [`run_caps`] and [`value_of_run`] are what a
//! reader of a headered file runs it under and reads its value with. The header's text form belongs to
//! `header.rs`.

use crate::tm::DescribedRun;
use crate::tm::TmRun;
use crate::tm::asm::DecodeFailure;
use crate::tm::build::MAX_MACHINE_STATES;
use crate::tm::decode::decode_tape_ty_reason;
use crate::tm::header::{MAX_REDUCED_STEPS, Reduction, Stage, StageKind, TmHeader, is_stage_list};
use crate::tm::machine::{Machine, StateId, Symbol};
use crate::tm::one_way::{to_one_way_within, unzigzag, zigzag};
use crate::tm::reduction::refusal;
use crate::tm::sim::{Caps, DEFAULT_CAPS, Status, Tape, simulate_final, simulate_origins};
use crate::tm::single_tape::{deinterleave, interleave, layout_collision, to_single_tape_within};
use crate::tm::two_symbol::{Code, bitify, to_two_symbol_within, unbitify};
use crate::value::Value;

/// Blocks of stage 1's skeleton beyond the cells the measuring run's heads visit, on each side.
const PAD_MARGIN: usize = 0;

/// Why [`reduce`] produced no file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReduceError {
    /// The stage list is empty, out of order, or repeats a stage: [`is_stage_list`] refuses it.
    StageList,
    /// The run did not end in `TmRun::Ran`, so there is no value to check a reduction against.
    NotRan,
    /// A stage refused, under the name [`refusal`] gives.
    Refused(&'static str),
    /// A symbol on the machine or its tapes that the single-tape layout reserves.
    LayoutCollision(Symbol),
    /// An initial tape a stage cannot lay out: one holding the fold's marker, or one with a symbol the
    /// two-symbol code does not cover. The second cannot happen here, because the code is built from the
    /// tapes it encodes; it is an error rather than a panic so that the library path cannot panic.
    Layout,
    /// Verification failed, in one of FOUR ways, which this variant does not distinguish: the machine the
    /// single-tape stage measures its skeleton from did not halt within the caps (so [`pads`] has no
    /// width); or the reduced machine took no step, did not halt in an accept state within the step
    /// ceiling, or its tapes did not decode to the value the lowered run's tapes decode to.
    Unverified,
}

/// Reduce `d`'s machine through `stages`, verify it, and return it with its header.
///
/// # Errors
///
/// [`ReduceError`], and nothing is produced: a stage list [`is_stage_list`] refuses, a run that did not
/// end in `TmRun::Ran`, a stage's refusal, a layout collision or unlayable tape, or a reduction that does
/// not verify within `MAX_REDUCED_STEPS` steps — [`ReduceError::Unverified`] names that last one's four
/// shapes, including the measuring run [`pads`] needs to halt.
pub fn reduce(d: &DescribedRun, stages: &[StageKind]) -> Result<(Machine, TmHeader), ReduceError> {
    reduce_within(d, stages, MAX_MACHINE_STATES, MAX_REDUCED_STEPS)
}

/// [`reduce`] under a caller's state ceiling and step ceiling, so a test can trip either on a machine
/// small enough to run in the fast tier.
///
/// **THE STAGES RUN IN [`StageKind::ALL`]'S ORDER, AND A REFUSAL IS CHECKED AFTER EACH ONE.** A later
/// stage would hand a refusal back unchanged, but its layout would be built for the refused machine's
/// one tape rather than the tapes it was given.
///
/// **THE VALUE IS CHECKED, NOT ONLY THE HALT.** The reduced machine runs under `max_steps`, must stop in an
/// accept state after at least one step, and its tapes, with every stage undone, must decode to what the
/// lowered run's tapes decode to. A capped run stops in a state that is not an accept, since the cursor
/// checks for an accept before the cap, so the accept check covers the cap too.
pub(crate) fn reduce_within(
    d: &DescribedRun,
    stages: &[StageKind],
    ceiling: usize,
    max_steps: u64,
) -> Result<(Machine, TmHeader), ReduceError> {
    if !is_stage_list(stages) {
        return Err(ReduceError::StageList);
    }
    let TmRun::Ran { tapes: lowered } = &d.run else { return Err(ReduceError::NotRan) };
    let caps = Caps { steps: max_steps, cells: DEFAULT_CAPS.cells };
    let mut m = d.machine.clone();
    let mut inits = d.header.init(m.tapes);
    let mut done = Vec::with_capacity(stages.len());
    for &kind in stages {
        let (next, next_inits, stage) = match kind {
            StageKind::Fold => {
                let folded = unrefused(to_one_way_within(&m, ceiling).0)?;
                (folded, zigzag(&inits, m.tapes).ok_or(ReduceError::Layout)?, Stage::Fold)
            }
            StageKind::SingleTape => {
                let single = unrefused(to_single_tape_within(&m, ceiling).0)?;
                if let Some(s) = layout_collision(&m, &inits) {
                    return Err(ReduceError::LayoutCollision(s));
                }
                let (left, right) = pads(&m, &inits, caps).ok_or(ReduceError::Unverified)?;
                (single, vec![interleave(&inits, m.tapes, left, right)], Stage::SingleTape { k: m.tapes })
            }
            StageKind::TwoSymbol => {
                let code = Code::new(&m, &inits);
                let reduced = unrefused(to_two_symbol_within(&m, &code, ceiling).0)?;
                let bits = bitify(&inits, &code).ok_or(ReduceError::Layout)?;
                (reduced, bits, Stage::TwoSymbol { symbols: code.symbols().to_vec() })
            }
        };
        (m, inits) = (next, next_inits);
        done.push(stage);
    }

    let (tapes, state, _status, steps) = simulate_final(&m, &inits, caps);
    if steps == 0 || !m.states.get(state as usize).is_some_and(|s| s.accept) {
        return Err(ReduceError::Unverified);
    }
    let want = decode_tape_ty_reason(lowered, &d.header.result, &*d.header.encoding());
    let tapes_by_index = inits.into_iter().enumerate().collect();
    let mut header =
        TmHeader::new(d.header.encoding, d.header.width, d.header.slots, d.header.result.clone(), tapes_by_index);
    header.reduction = Some(Reduction { stages: done, steps });
    match (decode_reduced(&tapes, &header), want) {
        (Ok(got), Ok(want)) if got == want => Ok((m, header)),
        _ => Err(ReduceError::Unverified),
    }
}

/// `m`, or the error naming its refusal.
fn unrefused(m: Machine) -> Result<Machine, ReduceError> {
    match refusal(&m) {
        Some(name) => Err(ReduceError::Refused(name)),
        None => Ok(m),
    }
}

/// The blocks stage 1's skeleton needs left of cell 0 and right of the longest initial tape, from a run of
/// `m` itself: a head that leaves the skeleton halts the single-tape machine in `OVERFLOW`, so the skeleton
/// must reach every cell a head visits, plus [`PAD_MARGIN`].
///
/// A `Tape` materializes a cell only when a head reaches it and never discards one, so after the run the
/// cells left of a tape's origin are the cells its head visited there, and the cells from the origin on are
/// its initial contents or the farthest cell its head reached, whichever is longer. `None` when the run
/// does not halt within `caps`.
fn pads(m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> Option<(usize, usize)> {
    let (tapes, origins, _state, status, _steps) = simulate_origins(m, inits, caps);
    if status != crate::tm::sim::Status::Halted {
        return None;
    }
    let left = origins.iter().copied().max().unwrap_or(0);
    let right = tapes.iter().zip(&origins).map(|(t, o)| t.cells().saturating_sub(*o)).max().unwrap_or(0);
    let longest = inits.iter().map(Vec::len).max().unwrap_or(0).max(1);
    Some((left + PAD_MARGIN, right.saturating_sub(longest) + PAD_MARGIN))
}

/// The value `tapes` hold under `h`: decoded as they are for a lowered header, and with every stage undone
/// in reverse for a reduced one.
///
/// # Errors
///
/// `DecodeFailure::Mismatch` when a stage cannot be undone — the tapes disagree with the header's own
/// stages — and otherwise whatever `decode_tape_ty_reason` answers on the undone tapes.
pub fn decode_reduced(tapes: &[Tape], h: &TmHeader) -> Result<Value, DecodeFailure> {
    let Some(r) = &h.reduction else { return decode_tape_ty_reason(tapes, &h.result, &*h.encoding()) };
    let mut undone: Option<Vec<Tape>> = None;
    for stage in r.stages.iter().rev() {
        let current = undone.as_deref().unwrap_or(tapes);
        undone = Some(undo(stage, current).ok_or(DecodeFailure::Mismatch)?);
    }
    decode_tape_ty_reason(undone.as_deref().unwrap_or(tapes), &h.result, &*h.encoding())
}

/// The caps a headered file runs under: the step count a reduced header records, or `DEFAULT_CAPS`' steps
/// for a lowered one, and `DEFAULT_CAPS`' cells either way.
///
/// **A REDUCED FILE CANNOT RUN UNDER THE DEFAULT STEP CAP.** A reduction multiplies a machine's steps, and
/// `reduce` records the count its own verifying run took, up to `MAX_REDUCED_STEPS`, so that the file alone
/// says how long it runs.
#[must_use]
pub fn run_caps(h: &TmHeader) -> Caps {
    match &h.reduction {
        Some(r) => Caps { steps: r.steps, cells: DEFAULT_CAPS.cells },
        None => DEFAULT_CAPS,
    }
}

/// Why a finished run under a header holds no value. [`value_of_run`] is the one producer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunFailure {
    /// The run stopped at a cap rather than halting. A caller says whose count it was from the header's
    /// `reduction`.
    HitCap,
    /// A reduced run halted in this state, which is not an accept state. A reduction's run ends in an accept
    /// state, so these tapes hold no value even when they decode. Never produced under a lowered header.
    /// The state always exists in the machine, because [`value_of_run`] produces this only when `states.get` finds
    /// it, so a caller may index the machine's states by it, as `redextape run` does.
    NotAccept(StateId),
    /// [`decode_reduced`] refused the tapes, for either of `DecodeFailure`'s causes.
    Decode(DecodeFailure),
}

/// The value a finished run's tapes hold under `h`: a capped run first, then a reduced run halting outside an
/// accept state, then [`decode_reduced`].
///
/// **THE ONE DECISION `redextape run` AND THE WEB APP'S TM BUFFERS BOTH READ A VALUE WITH.** Neither restates
/// these checks; each words the failures for its own surface.
///
/// # Errors
///
/// [`RunFailure`]: `HitCap` for a capped run, `NotAccept` for a reduced run whose final state exists and is not
/// an accept state, and `Decode` when [`decode_reduced`] refuses.
pub fn value_of_run(
    m: &Machine,
    h: &TmHeader,
    tapes: &[Tape],
    state: StateId,
    status: Status,
) -> Result<Value, RunFailure> {
    if status == Status::HitCap {
        return Err(RunFailure::HitCap);
    }
    if h.reduction.is_some() && m.states.get(state as usize).is_some_and(|s| !s.accept) {
        return Err(RunFailure::NotAccept(state));
    }
    decode_reduced(tapes, h).map_err(RunFailure::Decode)
}

/// One stage's inverse over a run's tapes, or `None` when they are not tapes that stage produces.
///
/// **THE HEAD SURVIVES EVERY STAGE BUT THE FOLD.** `unzigzag` refuses a head on physical cell 0, so a
/// folded tape rebuilt from an earlier inverse must carry its head; decoding a value reads no head at all,
/// so the fold's own inverse drops it.
fn undo(stage: &Stage, tapes: &[Tape]) -> Option<Vec<Tape>> {
    match stage {
        Stage::TwoSymbol { symbols } => {
            let code = Code::from_symbols(symbols)?;
            tapes.iter().map(|t| unbitify(t, &code).map(|(cells, head)| Tape::from_snapshot(&cells, head))).collect()
        }
        Stage::SingleTape { k } => {
            let [tape] = tapes else { return None };
            Some(deinterleave(tape, *k)?.iter().map(|(cells, head)| Tape::from_snapshot(cells, *head)).collect())
        }
        Stage::Fold => tapes.iter().map(|t| unzigzag(t).map(|s| Tape::new(&s.cells))).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::build::{REG, TAPES};
    use crate::tm::header::EncodingKind;
    use crate::tm::machine::{Move, Rule, State};
    use crate::tm::one_way::LEFT_END;
    use crate::tm::reduction::TOO_MANY_STATES;
    use crate::tm::single_tape::head_away;
    use crate::ty::Ty;

    /// A REG bank that decodes, under `Unary` at width 4, to `Nat(0)`, or to `Nat(1)` with `mark`.
    fn bank(mark: bool) -> Vec<Symbol> {
        vec!['#', if mark { '1' } else { '_' }, '_', '_', '_', '#']
    }

    /// `walk` states on `TAPES` tapes, each moving every head in `moves` order, then `last`.
    fn walk(moves: &[Move], last: State) -> Machine {
        let mut states: Vec<State> = moves
            .iter()
            .enumerate()
            .map(|(i, mv)| State {
                name: format!("w{i}"),
                accept: false,
                rules: vec![Rule {
                    read: vec![None; TAPES],
                    write: vec![None; TAPES],
                    moves: vec![*mv; TAPES],
                    next: u32::try_from(i + 1).unwrap_or(0),
                }],
            })
            .collect();
        states.push(last);
        Machine { states, start: 0, tapes: TAPES }
    }

    fn accept() -> State {
        State { name: "done".into(), accept: true, rules: vec![] }
    }

    /// `m` run on a REG tape holding `reg`, described as `run_tm_described` would describe it: a hand-built
    /// lowered run, so a ceiling can be tripped without lowering a program.
    fn run_of(m: Machine, reg: Vec<Symbol>) -> DescribedRun {
        let header = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![(REG, reg)]);
        let (tapes, _state, _status, steps) = simulate_final(&m, &header.init(m.tapes), DEFAULT_CAPS);
        DescribedRun { run: TmRun::Ran { tapes }, machine: m, header, steps }
    }

    #[test]
    fn a_stage_list_that_is_not_canonical_is_refused() {
        let d = run_of(walk(&[Move::R], accept()), bank(false));
        for stages in [&[][..], &[StageKind::SingleTape, StageKind::Fold][..], &[StageKind::Fold, StageKind::Fold][..]]
        {
            assert_eq!(reduce(&d, stages), Err(ReduceError::StageList), "{stages:?}");
        }
    }

    #[test]
    fn a_run_that_did_not_finish_is_refused() {
        for run in [TmRun::HitCap, TmRun::Overflow] {
            let mut d = run_of(walk(&[Move::R], accept()), bank(false));
            d.run = run;
            assert_eq!(reduce(&d, &[StageKind::Fold]), Err(ReduceError::NotRan), "{:?}", d.run);
        }
    }

    /// Each stage alone under a ceiling of one state, so a stage that stopped passing the ceiling on is
    /// the one whose row fails.
    #[test]
    fn every_stage_refuses_at_its_state_ceiling() {
        let d = run_of(walk(&[Move::R], accept()), bank(false));
        for kind in StageKind::ALL {
            assert_eq!(
                reduce_within(&d, &[kind], 1, MAX_REDUCED_STEPS),
                Err(ReduceError::Refused(TOO_MANY_STATES)),
                "{kind:?}"
            );
        }
    }

    /// `to_single_tape` sees only the machine's alphabet; a marker arriving on an initial tape is the
    /// collision `layout_collision` exists for.
    #[test]
    fn a_layout_symbol_on_an_initial_tape_is_a_collision() {
        let marker = head_away(0);
        let d = run_of(walk(&[Move::R], accept()), vec!['#', marker, '#']);
        assert_eq!(reduce(&d, &[StageKind::SingleTape]), Err(ReduceError::LayoutCollision(marker)));
    }

    #[test]
    fn the_folds_marker_on_an_initial_tape_cannot_be_laid_out() {
        let d = run_of(walk(&[Move::R], accept()), vec!['#', LEFT_END, '#']);
        assert_eq!(reduce(&d, &[StageKind::Fold]), Err(ReduceError::Layout));
    }

    #[test]
    fn a_reduction_that_does_not_reproduce_the_lowered_value_is_unverified() {
        let mut d = run_of(walk(&[Move::R], accept()), bank(false));
        assert!(reduce(&d, &[StageKind::Fold]).is_ok(), "the fixture reduces while the values agree");
        d.run = run_of(walk(&[Move::R], accept()), bank(true)).run;
        assert_eq!(reduce(&d, &[StageKind::Fold]), Err(ReduceError::Unverified));
    }

    #[test]
    fn a_reduced_machine_that_halts_outside_an_accept_state_is_unverified() {
        let stuck = State { name: "stuck".into(), accept: false, rules: vec![] };
        let d = run_of(walk(&[Move::R], stuck), bank(false));
        assert_eq!(reduce(&d, &[StageKind::Fold]), Err(ReduceError::Unverified));
    }

    /// A `steps 0` line does not parse, so a reduction that accepts before its first step has no file.
    #[test]
    fn a_reduced_machine_that_accepts_before_a_step_is_unverified() {
        let d = run_of(walk(&[], accept()), bank(false));
        assert_eq!(reduce(&d, &[StageKind::TwoSymbol]), Err(ReduceError::Unverified));
    }

    #[test]
    fn a_reduced_machine_is_held_to_the_step_ceiling_it_is_given() {
        let d = run_of(walk(&[Move::R; 20], accept()), bank(false));
        assert_eq!(reduce_within(&d, &[StageKind::Fold], MAX_MACHINE_STATES, 10), Err(ReduceError::Unverified));
        assert!(reduce_within(&d, &[StageKind::Fold], MAX_MACHINE_STATES, 1_000).is_ok());
    }

    /// Three cells left of cell 0, and the farthest head at cell 6 of a longest initial tape of 6 cells, is
    /// three blocks on the left and one on the right.
    #[test]
    fn the_skeleton_reaches_every_cell_a_head_visits() {
        let mut moves = vec![Move::L; 3];
        moves.extend([Move::R; 9]);
        let m = walk(&moves, accept());
        let inits = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![(REG, bank(false))]).init(TAPES);
        assert_eq!(pads(&m, &inits, DEFAULT_CAPS), Some((3 + PAD_MARGIN, 1 + PAD_MARGIN)));
        let looping = Machine {
            states: vec![State {
                name: "loop".into(),
                accept: false,
                rules: vec![Rule {
                    read: vec![None; TAPES],
                    write: vec![None; TAPES],
                    moves: vec![Move::S; TAPES],
                    next: 0,
                }],
            }],
            start: 0,
            tapes: TAPES,
        };
        assert_eq!(
            pads(&looping, &inits, Caps { steps: 10, cells: DEFAULT_CAPS.cells }),
            None,
            "a run that does not halt"
        );
    }

    #[test]
    fn a_lowered_header_decodes_as_it_always_has() {
        let d = run_of(walk(&[Move::R], accept()), bank(true));
        let TmRun::Ran { tapes } = &d.run else { panic!("run_of always runs") };
        let want = decode_tape_ty_reason(tapes, &d.header.result, &*d.header.encoding());
        assert_eq!(want, Ok(Value::Nat(1)), "the fixture decodes");
        assert_eq!(decode_reduced(tapes, &d.header), want);
    }

    #[test]
    fn a_reduced_header_runs_under_its_own_step_count() {
        let caps = |h: &TmHeader| (run_caps(h).steps, run_caps(h).cells);
        let mut h = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![]);
        assert_eq!(caps(&h), (DEFAULT_CAPS.steps, DEFAULT_CAPS.cells), "a lowered header runs under the defaults");
        h.reduction = Some(Reduction { stages: vec![Stage::Fold], steps: 7 });
        assert_eq!(caps(&h), (7, DEFAULT_CAPS.cells));
    }

    /// A lowered run, finished in its accept state, with tapes holding `Nat(1)`: every `value_of_run` test
    /// below starts here, so the one thing each changes is the one check it is about.
    fn finished() -> DescribedRun {
        run_of(walk(&[Move::R], accept()), bank(true))
    }

    /// `finished`'s header and tapes re-expressed as a two-symbol reduction's, which also decode to `Nat(1)`.
    fn bits_of(d: &DescribedRun) -> (TmHeader, Vec<Tape>) {
        let code = Code::from_symbols(&['_', '#', '1']).unwrap();
        let mut h = d.header.clone();
        h.reduction = Some(Reduction { stages: vec![Stage::TwoSymbol { symbols: code.symbols().to_vec() }], steps: 1 });
        let tapes = bitify(&d.header.init(d.machine.tapes), &code).unwrap().iter().map(|b| Tape::new(b)).collect();
        (h, tapes)
    }

    const DONE: StateId = 1;
    const WALKING: StateId = 0;

    #[test]
    fn a_finished_run_under_either_header_is_its_value() {
        let d = finished();
        let TmRun::Ran { tapes } = &d.run else { panic!("run_of always runs") };
        assert_eq!(value_of_run(&d.machine, &d.header, tapes, DONE, Status::Halted), Ok(Value::Nat(1)));
        let (h, bits) = bits_of(&d);
        assert_eq!(value_of_run(&d.machine, &h, &bits, DONE, Status::Halted), Ok(Value::Nat(1)));
    }

    /// The tapes decode; only the status says the run never finished.
    #[test]
    fn a_capped_run_has_no_value_even_when_its_tapes_decode() {
        let d = finished();
        let TmRun::Ran { tapes } = &d.run else { panic!("run_of always runs") };
        assert_eq!(value_of_run(&d.machine, &d.header, tapes, DONE, Status::HitCap), Err(RunFailure::HitCap));
    }

    /// The bits decode; only the final state says a reduced run went wrong.
    #[test]
    fn a_reduced_run_that_stops_outside_an_accept_state_has_no_value() {
        let d = finished();
        let (h, bits) = bits_of(&d);
        assert_eq!(value_of_run(&d.machine, &h, &bits, WALKING, Status::Halted), Err(RunFailure::NotAccept(WALKING)));
    }

    /// The accept check is `reduce`'s promise about a reduced run. A lowered file reads exactly as it did before
    /// reductions existed, whatever state it halts in.
    #[test]
    fn a_lowered_run_is_not_held_to_an_accept_state() {
        let d = finished();
        let TmRun::Ran { tapes } = &d.run else { panic!("run_of always runs") };
        assert_eq!(value_of_run(&d.machine, &d.header, tapes, WALKING, Status::Halted), Ok(Value::Nat(1)));
    }

    #[test]
    fn tapes_the_header_does_not_describe_are_a_decode_failure() {
        let d = finished();
        let TmRun::Ran { tapes } = &d.run else { panic!("run_of always runs") };
        let (h, _bits) = bits_of(&d);
        assert_eq!(
            value_of_run(&d.machine, &h, tapes, DONE, Status::Halted),
            Err(RunFailure::Decode(DecodeFailure::Mismatch))
        );
    }

    /// Each inverse, handed tapes its stage never produces, is a mismatch rather than a guess.
    #[test]
    fn tapes_a_stage_did_not_produce_are_a_mismatch() {
        let mut h = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![]);
        let plain = || vec![Tape::new(&['#', '_', '#'])];
        // A tape stage 1 really produces, from the bank `run_of` runs on. The pair below is then refused
        // for holding two tapes, not for holding one that would not have split anyway.
        let interleaved = || vec![Tape::new(&interleave(&[bank(false)], TAPES, 0, 0))];
        h.reduction = Some(Reduction { stages: vec![Stage::SingleTape { k: TAPES }], steps: 1 });
        assert_eq!(decode_reduced(&interleaved(), &h), Ok(Value::Nat(0)), "that one tape alone decodes");
        let cases: [(&str, Stage, Vec<Tape>); 5] = [
            ("a fold with no marker at cell 0", Stage::Fold, plain()),
            ("a single tape with no sentinels", Stage::SingleTape { k: 1 }, plain()),
            (
                "two tapes, the first of which decodes alone",
                Stage::SingleTape { k: TAPES },
                [interleaved(), plain()].concat(),
            ),
            ("a code that does not rebuild", Stage::TwoSymbol { symbols: vec!['a'] }, plain()),
            ("a cell that is not a bit", Stage::TwoSymbol { symbols: vec!['_', '#'] }, plain()),
        ];
        for (what, stage, tapes) in cases {
            h.reduction = Some(Reduction { stages: vec![stage], steps: 1 });
            assert_eq!(decode_reduced(&tapes, &h), Err(DecodeFailure::Mismatch), "{what}");
        }
    }
}
