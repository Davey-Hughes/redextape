//! The CLIF leg: a cursor a view records and a scout that finds the run's end, both over one program's
//! functions, served as `redextape-wasm`'s rxm leg serves its cursor.

use cranelift_codegen::ir::Function;
use redextape_core::tm::{self, Caps, LowerError, Program};
use redextape_core::trace::RxmCap;
use redextape_core::ty::Ty;
use redextape_native::analysis::partition;
use redextape_native::{Listing, build_listing};
use redextape_wire::{Decoded, RunStatus, decoded_or_undecodable, rxm_fault};

use crate::listing::ClifListing;
use crate::state::{ClifState, ClifWindow};
use crate::stepper::{ClifEnd, Stepper};

/// What a leg is built from: the program the rxm leg runs, the type its end value decodes by, and the caps
/// the session ran it under.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct ClifInput {
    pub program: Program,
    pub ty: Ty,
    pub caps: Caps,
}

/// How the leg stands, as `RxmStatus` says it for the rxm leg.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ClifStatus {
    /// The cursor's: `Running` while it can step, `Capped` at a pause, and `Ended` for any other end.
    pub run: RunStatus,
    /// The cap the cursor paused at, set exactly when `run` is `Capped`.
    pub cap: Option<RxmCap>,
    /// The whole run's steps: the scout's once `ClifLeg::find_end` has found its end, else the cursor's once
    /// it has ended at any end but a pause, and `None` before either. For a run that pauses at a cap it is
    /// where the scout paused, or the cursor's steps once a raised cap has carried the cursor further.
    pub total_steps: Option<u64>,
}

/// A program's CLIF functions and their listing, with a cursor and a scout that step them.
pub struct ClifLeg {
    runs: Runs,
    listing: ClifListing,
    ty: Ty,
    /// The input's caps, which a rewind opens the cursor under, whatever a raise has made the cursor's.
    caps: Caps,
}

self_cell::self_cell!(
    /// The functions, and the steppers that borrow them.
    struct Runs {
        owner: Vec<Function>,
        #[covariant]
        dependent: Steppers,
    }
);

/// The two runs of the leg's functions.
struct Steppers<'f> {
    /// The run a view records.
    cursor: Stepper<'f>,
    scout: Scout<'f>,
}

/// A run ahead of the cursor that learns how the run ends, a budget at a time, so that no single call
/// steps the whole program; once it has ended only its end and its steps are kept.
enum Scout<'f> {
    Running(Box<Stepper<'f>>),
    Ended { end: ClifEnd, steps: u64 },
}

impl ClifLeg {
    /// `input`'s program built as `listing`, its rows named by `partition`, with the cursor and the scout
    /// at step 0 under `input.caps`.
    ///
    /// # Errors
    /// `build_listing`'s and `partition`'s.
    pub fn new(input: ClifInput, listing: Listing) -> Result<ClifLeg, LowerError> {
        let funcs = build_listing(&input.program, listing)?;
        let names: Vec<String> = partition(&input.program)?.into_iter().map(|sub| sub.name).collect();
        let rows = crate::listing::listing(&funcs, &names);
        let caps = input.caps;
        let runs = Runs::new(funcs, |funcs| Steppers {
            cursor: Stepper::new(funcs, caps),
            scout: Scout::Running(Box::new(Stepper::new(funcs, caps))),
        });
        Ok(ClifLeg { runs, listing: rows, ty: input.ty, caps })
    }

    /// The rows of the leg's functions.
    #[must_use]
    pub fn listing(&self) -> &ClifListing {
        &self.listing
    }

    /// Steps the scout at most `budget` steps: true once it has ended, at any end, a pause included.
    pub fn find_end(&mut self, budget: u64) -> bool {
        self.runs.with_dependent_mut(|_, runs| {
            let Scout::Running(scout) = &mut runs.scout else {
                return true;
            };
            scout.run(budget);
            let Some(end) = scout.status().cloned() else {
                return false;
            };
            runs.scout = Scout::Ended { end, steps: scout.steps_taken() };
            true
        })
    }

    /// How the cursor stands, and how long the whole run is: known once the scout has found its end, or once
    /// the cursor has ended at any end but a pause.
    #[must_use]
    pub fn status(&self) -> ClifStatus {
        let runs = self.runs.borrow_dependent();
        let (run, cap) = match runs.cursor.status() {
            None => (RunStatus::Running, None),
            Some(ClifEnd::Capped(cap)) => (RunStatus::Capped, Some(*cap)),
            Some(ClifEnd::Ran(_) | ClifEnd::Fault { .. } | ClifEnd::Trap(_) | ClifEnd::Broken(_)) => {
                (RunStatus::Ended, None)
            }
        };
        // A raised cap can carry the cursor past where the scout paused, and the run is then as long as the
        // cursor has gone, as `RxmLeg::status` reckons it. A cursor that has ended before the scout has gone
        // the whole run, so a worker that never sends the scout ahead still learns the length; a pause is
        // not an end, since a raise can carry the cursor on.
        let total_steps = match &runs.scout {
            Scout::Running(_) => matches!(run, RunStatus::Ended).then(|| runs.cursor.steps_taken()),
            Scout::Ended { end: ClifEnd::Capped(_), steps } => Some((*steps).max(runs.cursor.steps_taken())),
            Scout::Ended { steps, .. } => Some(*steps),
        };
        ClifStatus { run, cap, total_steps }
    }

    /// Back to step 0 under the input's caps.
    pub fn rewind(&mut self) {
        let caps = self.caps;
        self.runs.with_dependent_mut(|funcs, runs| runs.cursor = Stepper::new(funcs, caps));
    }

    /// Steps the cursor one instruction; `false` once it has ended or paused.
    pub fn step(&mut self) -> bool {
        self.runs.with_dependent_mut(|_, runs| runs.cursor.step())
    }

    /// The cursor's frame cut to `window`.
    #[must_use]
    pub fn state(&self, window: ClifWindow) -> ClifState {
        self.runs.borrow_dependent().cursor.state(window)
    }

    /// The run's answer: from the scout's end, else from the cursor's once it has ended, else `Unfinished`.
    /// A scout that paused has no answer, and the cursor may since have gone past it under a raised cap.
    #[must_use]
    pub fn value(&self) -> Decoded {
        let runs = self.runs.borrow_dependent();
        let end = match &runs.scout {
            Scout::Ended { end, .. } if !matches!(end, ClifEnd::Capped(_)) => Some(end),
            Scout::Running(_) | Scout::Ended { .. } => runs.cursor.status(),
        };
        match end {
            Some(ClifEnd::Ran(outcome)) => decoded_or_undecodable(tm::decode_rxm_ty(outcome, &self.ty)),
            Some(ClifEnd::Fault { pc: Some(pc), why }) => rxm_fault(*pc as usize, why),
            Some(ClifEnd::Fault { pc: None, why }) => Decoded::Fault { message: why.clone() },
            Some(ClifEnd::Trap(text) | ClifEnd::Broken(text)) => Decoded::Fault { message: text.clone() },
            Some(ClifEnd::Capped(_)) | None => Decoded::Unfinished,
        }
    }

    /// Raises the cursor's steps cap by `extra_steps`, saturating. It resumes a steps pause and no other:
    /// `Stepper::raise_caps` continues any pause, and a stack, heap or memory pause would only stop again
    /// at the same call, so it is left as it stands, as `RxmCursor::raise_cap` leaves it.
    pub fn raise_cap(&mut self, extra_steps: u64) {
        self.runs.with_dependent_mut(|_, runs| {
            let cursor = &mut runs.cursor;
            if matches!(cursor.status(), None | Some(ClifEnd::Capped(RxmCap::Steps))) {
                let mut caps = cursor.runtime().caps;
                caps.steps = caps.steps.saturating_add(extra_steps);
                cursor.raise_caps(caps);
            }
        });
    }
}
