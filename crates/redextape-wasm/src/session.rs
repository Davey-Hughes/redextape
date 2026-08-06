//! The Session, and every decision in this crate.
//!
//! NOTHING HERE IS `#[wasm_bindgen]`, AND THAT IS THE POINT. `lib.rs` is the shell that JavaScript
//! sees; this module is ordinary Rust that `cargo test` compiles natively. `wasm-bindgen-test` runs in
//! a browser while `cargo llvm-cov` instruments the native build, so any logic living in the shell is
//! uncovered by construction and drags the workspace's 80% floor down with it.

use std::rc::Rc;

use redextape_core::core::NodeId;
use redextape_core::lambda::{self, LowerError};
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::machine::Machine;
use redextape_core::tm::{self, EncodingKind, Symbol, TmRun};
use redextape_core::trace::{LambdaCursor, TmCursor};
use redextape_core::viewmodel::{LambdaState, TermNode, TmProgram, TmState};
use redextape_core::{Diagnostic, Severity, Span, parser, typeck};

/// Why the TM leg is absent. `TmRun` already distinguishes these and the UI must not flatten them:
/// `TooLarge` means lowering REFUSED and the program never ran a step; `Overflow` means a value does
/// not fit the encoding at any width up to the ceiling; `Lower` means it could not be lowered at all.
/// `HitCap` is deliberately NOT here — a run that started and ran out of budget produces a working
/// cursor, which is what `raise_cap` exists for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TmDecline {
    TooLarge,
    Overflow,
    Lower(String),
}

/// A method reached a leg that is not there, or a tape that is not there.
///
/// A TYPE RATHER THAN A `String`, because the shell has to tell these apart from each other and from
/// any other failure, and matching on message text is how that stops working. `Display` is the only
/// place a message is produced, so there is exactly one wording per case.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SessionError {
    /// A λ-leg method on a session whose λ backend declined. `lambda_status()` says why.
    LambdaAbsent,
    /// A TM-leg method on a session whose TM backend declined. `tm_status()` says why.
    TmAbsent,
    /// `tape_slice` named a tape the machine does not have.
    NoSuchTape { tape: usize, tapes: usize },
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionError::LambdaAbsent => write!(f, "this program has no λ leg — see lambdaStatus()"),
            SessionError::TmAbsent => write!(f, "this program has no TM leg — see tmStatus()"),
            SessionError::NoSuchTape { tape, tapes } => {
                write!(f, "no tape {tape}: this machine has {tapes}")
            }
        }
    }
}

/// How a leg's run ended, or that it has not ended.
///
/// **WITHOUT THIS, `raiseLambdaCap`/`raiseTmCap` ARE API NOTHING CAN CORRECTLY DECIDE TO CALL.**
/// `step_lambda`/`step_tm` answer `false` for EVERY end condition, so a renderer reading only them
/// cannot tell a finished run from one that spent its budget — and "continue" is meaningful for
/// exactly one of those. §3.3 justifies `raise_cap` existing by §6.4's "still running — hit 50k steps
/// ... continue"; this is the half of that affordance which is data rather than rendering.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum RunStatus {
    /// The run may still advance.
    Running,
    /// Its natural end: the λ term is in normal form, or the machine halted.
    Ended,
    /// It spent its budget. **THE ONLY STATUS FOR WHICH "CONTINUE" IS AN HONEST OFFER.**
    Capped,
    /// λ ONLY: the term is deeper than the reducer can safely recurse over.
    ///
    /// ITS OWN STATUS RATHER THAN `Capped`, because the cursor latches `HitCap` for this too and
    /// raising the cap provably cannot help — `LambdaCursor::raise_cap` refuses to clear it. Folding
    /// the two together would put a "continue" button on the one run that cannot continue, which is
    /// the defect `raise_cap`'s own guard fixed one layer in, reintroduced at the boundary.
    DepthRefused,
}

/// Whether the λ leg is there, why not when it is not, and how far its run has got.
///
/// `reason` IS THE PAYLOAD, which is why both legs answer a struct rather than an `Option`. A UI that
/// only knows a leg is missing has nothing to tell the user; "the λ backend refuses a closure that
/// assigns a captured variable" is the whole point of showing the pane at all. `node` is the Core node
/// the refusal names, so the source pane can highlight it. `run` is `None` exactly when the leg is
/// absent — there is no run to report on.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LambdaStatus {
    pub available: bool,
    pub reason: String,
    pub node: Option<NodeId>,
    pub run: Option<RunStatus>,
}

/// Whether the TM leg is there, the width it fitted, and how far its run has got.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TmStatus {
    pub available: bool,
    pub reason: String,
    pub width: Option<usize>,
    pub run: Option<RunStatus>,
}

/// The result of `Session::compile`. `diagnostics` is non-empty for a program the front end objected
/// to; `session` is `None` only when nothing could be built at all.
///
/// A SESSION WITH BOTH LEGS DECLINED IS STILL A SESSION. Declining is a backend's answer about a
/// program, not a failure to process it, and the UI's job is to say which backend declined and why.
pub struct Compiled {
    pub diagnostics: Vec<Diagnostic>,
    pub session: Option<Session>,
}

pub struct Session {
    pub(crate) lambda: Result<LambdaCursor, LowerError>,
    pub(crate) tm: Result<TmCursor<Rc<Machine>>, TmDecline>,
    pub(crate) program: Option<TmProgram>,
    pub(crate) map: SourceMap,
}

impl Session {
    /// Parse, typecheck, and build whichever legs the backends accept.
    ///
    /// THE WIDTH PASSED TO `build_from_program` IS NOT THE WIDTH THE MACHINE RUNS AT, and that is
    /// deliberate rather than sloppy. `SourceMap::build_from_program` needs an `Encoding` only to lower
    /// the Core far enough to record which states belong to which node, and `run_tm_described` then
    /// auto-fits its own width by re-lowering from `MIN_FIELD_WIDTH` upward. The map keys on state
    /// NAMES, which `lower_tm` derives from the instruction stream rather than the field width, so the
    /// two agree on names regardless of which width either used — `tm_state_resolves_its_source_node_through_the_map`
    /// in core pins that the names line up at all, and `the_source_node_resolves_at_the_width_the_run_fitted`
    /// below pins that they still line up after the auto-fit has moved the width.
    pub fn compile(src: &str, kind: EncodingKind) -> Compiled {
        let (program, mut diagnostics) = parser::parse(src);
        let Some(program) = program else {
            return Compiled { diagnostics, session: None };
        };
        diagnostics.extend(typeck::typecheck(&program));
        if diagnostics.iter().any(|d| d.severity == Severity::Error) {
            return Compiled { diagnostics, session: None };
        }
        // A program that typechecked cannot fail this, but the error is mapped into diagnostics rather
        // than unwrapped: `typecheck` and `result_type` run inference twice over the same AST, and a
        // divergence between them must surface as a diagnostic, not as an abort inside a wasm module.
        let ty = match typeck::result_type(&program) {
            Ok(ty) => ty,
            Err(ds) => {
                diagnostics.extend(ds);
                return Compiled { diagnostics, session: None };
            }
        };

        let enc = kind.at(tm::MIN_FIELD_WIDTH);
        let (core, map) = SourceMap::build_from_program(&program, &*enc);

        let lambda = lambda::lower(&core).map(|t| LambdaCursor::new(&t, lambda::MAX_REDUCTION_STEPS));

        // `run_tm_described` ERRS ONLY FOR A PROGRAM THAT NEVER RAN. Checked against `lower_and_size`,
        // its only fallible call: `Err` carries `LowerError` or `TooLarge` and nothing else. `Overflow`
        // is NOT an `Err` — reaching `MAX_FIELD_WIDTH` and still overflowing returns `Ok` with
        // `run: TmRun::Overflow` and a machine attached — so the decline for it is read off `d.run`,
        // which is why this is two matches and not one.
        let tm = match tm::run_tm_described(&core, kind, ty, tm::TM_DEFAULT_CAPS) {
            Err(TmRun::TooLarge) => Err(TmDecline::TooLarge),
            Err(TmRun::LowerError(e)) => Err(TmDecline::Lower(format!("{e:?}"))),
            // `lower_and_size` produces no other `Err`, so this arm is unreachable today. It is a
            // mapping rather than an `unreachable!()` because that macro is a panic, and a panic under
            // wasm aborts the module; a future `Err` variant becomes a legible decline instead.
            Err(other) => Err(TmDecline::Lower(format!("{other:?}"))),
            Ok(d) => match d.run {
                TmRun::Overflow => Err(TmDecline::Overflow),
                TmRun::TooLarge => Err(TmDecline::TooLarge),
                TmRun::LowerError(e) => Err(TmDecline::Lower(format!("{e:?}"))),
                // `Ran` and `HitCap` BOTH yield a working cursor, and that is the point of the split:
                // a run that spent its budget is resumable through `raise_tm_cap`, so flattening it
                // into a decline would throw away a session the user can still drive.
                TmRun::Ran { .. } | TmRun::HitCap => {
                    let init = d.header.init(d.machine.tapes);
                    let width = d.header.width;
                    let machine = Rc::new(d.machine);
                    let program = TmProgram::of(&machine, width);
                    let cursor = TmCursor::new(Rc::clone(&machine), &init, tm::TM_DEFAULT_CAPS);
                    Ok((program, cursor))
                }
            },
        };

        // `TmProgram` is projected ONCE, here, and cached — never per step. The `map` demo is 3,203
        // states over 344,999 steps; re-projecting per `tmState` is the cost the `TmProgram`/`TmState`
        // split exists to avoid.
        let (program, tm) = match tm {
            Ok((p, c)) => (Some(p), Ok(c)),
            Err(d) => (None, Err(d)),
        };

        Compiled { diagnostics, session: Some(Session { lambda, tm, program, map }) }
    }

    // --- the λ leg ----------------------------------------------------------------------------

    pub fn lambda_status(&self) -> LambdaStatus {
        match &self.lambda {
            Ok(c) => {
                // `depth_capped` is what separates `Capped` from `DepthRefused`: the cursor latches
                // `HitCap` for both, and only the first can be continued.
                let run = match c.status() {
                    None => RunStatus::Running,
                    Some(lambda::Status::Normalized) => RunStatus::Ended,
                    Some(lambda::Status::HitCap) if c.depth_capped() => RunStatus::DepthRefused,
                    Some(lambda::Status::HitCap) => RunStatus::Capped,
                };
                LambdaStatus { available: true, reason: String::new(), node: None, run: Some(run) }
            }
            Err(e) => {
                let (reason, node) = match e {
                    LowerError::StatefulClosure { node } => {
                        ("a closure assigns a variable captured from an outer scope".to_string(), *node)
                    }
                    LowerError::Unsupported { node, what } => (format!("the λ backend does not support {what}"), *node),
                    LowerError::TooDeep { node } => {
                        ("the program nests deeper than the λ lowering guard allows".to_string(), *node)
                    }
                };
                LambdaStatus { available: false, reason, node: Some(node), run: None }
            }
        }
    }

    /// Advance one β-step. `false` once the run has ended — normalized, capped, or depth-refused — and
    /// it keeps answering `false` rather than restarting.
    ///
    /// **`false` DOES NOT SAY WHICH; `lambda_status().run` DOES.** Deciding whether to offer a
    /// "continue" affordance means telling `Capped` from the other two, and this return value cannot.
    pub fn step_lambda(&mut self) -> Result<bool, SessionError> {
        let c = self.lambda.as_mut().map_err(|_| SessionError::LambdaAbsent)?;
        Ok(c.next().is_some())
    }

    /// `LambdaState::render(cursor, byte_budget)` and nothing else — PR 2 removed the map and redex
    /// parameters along with the `source_node` field they existed to compute.
    pub fn lambda_state(&self, byte_budget: usize) -> Result<LambdaState, SessionError> {
        let c = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
        Ok(LambdaState::render(c, byte_budget))
    }

    /// The term as a tree, or `None` when it exceeds `node_budget` — `None` rather than a partial
    /// tree, because a truncated AST is a lie about the term's shape.
    pub fn lambda_ast(&self, node_budget: usize) -> Result<Option<TermNode>, SessionError> {
        let c = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
        Ok(LambdaState::ast(c, node_budget))
    }

    /// Extend a capped run's budget. Additive and saturating; clears `HitCap` only when the STEP CAP
    /// produced it, never the depth guard — extending a budget cannot make a term shallower.
    pub fn raise_lambda_cap(&mut self, extra: u64) -> Result<(), SessionError> {
        let c = self.lambda.as_mut().map_err(|_| SessionError::LambdaAbsent)?;
        c.raise_cap(extra);
        Ok(())
    }

    /// Rebuild the λ cursor with a small cap, so a test has something to raise from. TEST-ONLY: there
    /// is no product reason to lower a budget, and `LambdaCursor` has no API for it — this restarts
    /// the run from the term the cursor currently holds, which is fine for a fresh session and would
    /// silently discard progress on any other.
    #[cfg(test)]
    fn cap_lambda_at(&mut self, cap: u64) {
        if let Ok(c) = &mut self.lambda {
            let fresh = LambdaCursor::new(c.term(), cap);
            *c = fresh;
        }
    }

    // --- the TM leg ---------------------------------------------------------------------------

    pub fn tm_status(&self) -> TmStatus {
        match (&self.tm, &self.program) {
            (Ok(c), Some(p)) => {
                // No depth guard on this leg — the machine has no term to recurse over — so `HitCap`
                // has one producer and `Capped` is unambiguous here in a way it is not for λ.
                let run = match c.status() {
                    None => RunStatus::Running,
                    Some(tm::TmStatus::Halted) => RunStatus::Ended,
                    Some(tm::TmStatus::HitCap) => RunStatus::Capped,
                };
                TmStatus { available: true, reason: String::new(), width: Some(p.width), run: Some(run) }
            }
            // `program` is `Some` exactly when `tm` is `Ok` — both are set from the same match arm in
            // `compile`. This arm cannot be reached, and reports rather than panics because a panic
            // under wasm aborts the module.
            (Ok(_), None) => TmStatus {
                available: false,
                reason: "internal: a TM leg with no projected program".to_string(),
                width: None,
                run: None,
            },
            (Err(d), _) => {
                let reason = match d {
                    TmDecline::TooLarge => "the machine this program needs is too large to build".to_string(),
                    TmDecline::Overflow => {
                        "a value does not fit the encoding at any width up to the ceiling".to_string()
                    }
                    TmDecline::Lower(what) => format!("the program could not be lowered: {what}"),
                };
                TmStatus { available: false, reason, width: None, run: None }
            }
        }
    }

    /// The cached projection, cloned — never a re-walk. The `map` demo is 3,203 states over 344,999
    /// steps, and re-projecting per step is the cost the `TmProgram`/`TmState` split exists to avoid.
    pub fn tm_program(&self) -> Result<TmProgram, SessionError> {
        self.program.clone().ok_or(SessionError::TmAbsent)
    }

    /// Advance one δ-step. `false` once the run has halted or hit a cap — `tm_status().run` says
    /// which, and is the only thing that can.
    pub fn step_tm(&mut self) -> Result<bool, SessionError> {
        let c = self.tm.as_mut().map_err(|_| SessionError::TmAbsent)?;
        Ok(c.next().is_some())
    }

    pub fn tm_state(&self, radius: usize) -> Result<TmState, SessionError> {
        let c = self.tm.as_ref().map_err(|_| SessionError::TmAbsent)?;
        Ok(TmState::window(c, &self.map, radius))
    }

    /// Cells `from..to` of tape `tape`, in the same materialized coordinates `tm_state` reports its
    /// `heads` and `window_start` in — so a scrolling renderer can relate the two.
    ///
    /// `get`, NEVER `[]`: an absent tape answers `Err` rather than indexing out of bounds. `from`/`to`
    /// need no such guard because `Tape::slice` clamps both.
    pub fn tape_slice(&self, tape: usize, from: usize, to: usize) -> Result<Vec<Symbol>, SessionError> {
        let c = self.tm.as_ref().map_err(|_| SessionError::TmAbsent)?;
        let tapes = c.tapes();
        let t = tapes.get(tape).ok_or(SessionError::NoSuchTape { tape, tapes: tapes.len() })?;
        Ok(t.slice(from, to))
    }

    /// Extend a capped run's budget. Additive and saturating, like the λ leg's.
    pub fn raise_tm_cap(&mut self, extra_steps: u64, extra_cells: u64) -> Result<(), SessionError> {
        let c = self.tm.as_mut().map_err(|_| SessionError::TmAbsent)?;
        c.raise_cap(extra_steps, extra_cells);
        Ok(())
    }

    /// The source text a Core node came from. NOT a leg method — the map exists whenever a session
    /// does, so this needs no `Result`. `None` where the lowering recorded nothing, with deliberately
    /// no fallback to a nearby node.
    pub fn source_span(&self, node: NodeId) -> Option<Span> {
        self.map.source_span(node)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use redextape_core::tm::EncodingKind;

    /// From `three_way_oracle.rs`'s `LAMBDA_LIMITATION_DEMOS` — the corpus of programs the λ backend
    /// refuses and the TM backend runs. Copied rather than imported: integration tests are separate
    /// crates and this is a different crate again.
    const LAMBDA_DECLINES: &str = "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)";

    #[test]
    fn a_clean_program_compiles_to_a_session_with_no_diagnostics() {
        let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
        assert!(c.diagnostics.is_empty(), "{:?}", c.diagnostics);
        assert!(c.session.is_some());
    }

    #[test]
    fn a_malformed_program_yields_diagnostics_and_no_session() {
        let c = Session::compile("let x = ;", EncodingKind::Unary);
        assert!(!c.diagnostics.is_empty(), "a parse error must be reported");
        assert!(c.session.is_none(), "no session for a program that does not analyze");
    }

    /// Both legs declining is a NORMAL outcome, not an error. A closure that captures a `let mut` is
    /// refused by the λ backend and runs fine on the TM, and a TM-only session is the correct result
    /// rather than a failure.
    #[test]
    fn a_lambda_limitation_program_still_produces_a_tm_only_session() {
        let c = Session::compile(LAMBDA_DECLINES, EncodingKind::Unary);
        assert!(c.diagnostics.is_empty(), "{:?}", c.diagnostics);
        let s = c.session.expect("the TM leg handles this program");
        assert!(s.lambda.is_err(), "the λ backend declines a closure over a `let mut`");
        assert!(s.tm.is_ok(), "the TM backend does not");
    }

    // --- the λ leg ----------------------------------------------------------------------------

    #[test]
    fn stepping_the_lambda_leg_advances_its_state_and_stops_at_the_end() {
        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        let before = s.lambda_state(usize::MAX).expect("λ available").step;
        assert!(s.step_lambda().expect("λ available"), "this program takes at least one step");
        assert!(s.lambda_state(usize::MAX).expect("λ available").step > before);

        while s.step_lambda().unwrap_or(false) {}
        assert!(!s.step_lambda().expect("λ available"), "a finished run keeps reporting false");
    }

    #[test]
    fn a_declined_lambda_leg_reports_why_and_refuses_its_methods() {
        let s = Session::compile(LAMBDA_DECLINES, EncodingKind::Unary).session.expect("TM handles it");
        assert!(!s.lambda_status().available);
        assert!(!s.lambda_status().reason.is_empty(), "the reason is the payload the UI needs");
        assert!(s.lambda_status().node.is_some(), "the refusal names a Core node for the source pane");
        assert_eq!(s.lambda_state(usize::MAX), Err(SessionError::LambdaAbsent), "no state without a leg");
        assert_eq!(s.lambda_ast(usize::MAX), Err(SessionError::LambdaAbsent));
    }

    /// `step_lambda() == false` is the SAME answer for three different endings, and only one of them
    /// can be continued. This is the test that `run` tells them apart — without it `raise_lambda_cap`
    /// is API nothing can correctly decide to call.
    #[test]
    fn the_lambda_run_status_separates_finished_from_capped_from_depth_refused() {
        // Running, then Ended.
        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        assert_eq!(s.lambda_status().run, Some(RunStatus::Running), "a fresh cursor has not ended");
        while s.step_lambda().expect("λ available") {}
        assert_eq!(s.lambda_status().run, Some(RunStatus::Ended), "a normalized run has ended, not capped");

        // Capped — and raising the cap really does return it to Running.
        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        s.cap_lambda_at(1);
        while s.step_lambda().expect("λ available") {}
        assert_eq!(s.lambda_status().run, Some(RunStatus::Capped), "a spent budget is Capped, not Ended");
        s.raise_lambda_cap(1_000_000).expect("λ available");
        assert_eq!(s.lambda_status().run, Some(RunStatus::Running), "continuing is honest here");

        // DepthRefused — a Church numeral is a spine as deep as its value, so a literal above
        // `reduce::MAX_TERM_DEPTH` (3,000) lowers to a term the reducer refuses to recurse over. It is
        // NOT `Capped`: raising the cap cannot make a term shallower, and the status must not invite
        // the caller to try.
        let mut s = Session::compile("let x = 5000; x + 1", EncodingKind::Unary).session.expect("compiles");
        while s.step_lambda().expect("λ available") {}
        assert_eq!(
            s.lambda_status().run,
            Some(RunStatus::DepthRefused),
            "a term past MAX_TERM_DEPTH must not be reported as continuable"
        );
        s.raise_lambda_cap(1_000_000).expect("λ available");
        assert_eq!(
            s.lambda_status().run,
            Some(RunStatus::DepthRefused),
            "and raising the cap must not appear to have helped"
        );
    }

    #[test]
    fn the_tm_run_status_separates_running_from_halted() {
        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        assert_eq!(s.tm_status().run, Some(RunStatus::Running));
        while s.step_tm().expect("TM available") {}
        assert_eq!(s.tm_status().run, Some(RunStatus::Ended), "a halted machine has ended, not capped");
    }

    /// A declined leg has no run to report on, so `run` is `None` rather than a made-up `Ended`.
    #[test]
    fn a_declined_leg_reports_no_run_status_at_all() {
        let s = Session::compile(LAMBDA_DECLINES, EncodingKind::Unary).session.expect("TM handles it");
        assert_eq!(s.lambda_status().run, None, "there is no λ run to have a status");
        assert_eq!(s.tm_status().run, Some(RunStatus::Running), "the TM leg is unaffected");
    }

    /// `Display` is the ONLY wording JavaScript ever sees — every `throw` from the shell goes through
    /// it — and nothing else in this suite exercises it.
    #[test]
    fn every_session_error_says_what_went_wrong() {
        assert!(SessionError::LambdaAbsent.to_string().contains("lambdaStatus"), "point the caller at the reason");
        assert!(SessionError::TmAbsent.to_string().contains("tmStatus"));
        let msg = SessionError::NoSuchTape { tape: 9, tapes: 5 }.to_string();
        assert!(msg.contains('9') && msg.contains('5'), "name both the index asked for and the count: {msg}");
    }

    /// `TmDecline::Overflow` is the arm reached when NO width up to the ceiling fits a value — a
    /// counter that runs away is the cheap way there, and it is distinct from `Lower`/`TooLarge`.
    #[test]
    fn a_value_that_fits_no_width_declines_the_tm_leg_as_overflow() {
        let c = Session::compile("let mut n = 1; while n > 0 { n = n + 1; } n", EncodingKind::Unary);
        assert!(c.diagnostics.is_empty(), "the program is well-formed; only the encoding refuses it");
        let s = c.session.expect("a declined TM leg is still a session");
        assert_eq!(s.tm.as_ref().err(), Some(&TmDecline::Overflow), "the encoding, not the lowering, refused");
        let st = s.tm_status();
        assert!(!st.available);
        assert!(st.reason.contains("width"), "the reason must name what overflowed: {}", st.reason);
    }

    /// An available leg reports available with nothing to explain — the other half of the status
    /// contract, which the declining test alone cannot pin.
    #[test]
    fn an_available_lambda_leg_has_no_reason_to_give() {
        let s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        let st = s.lambda_status();
        assert!(st.available);
        assert!(st.reason.is_empty());
        assert_eq!(st.node, None);
    }

    #[test]
    fn raising_the_lambda_cap_lets_a_capped_run_continue() {
        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        s.cap_lambda_at(1); // test-only helper
        while s.step_lambda().unwrap_or(false) {}
        let stalled = s.lambda_state(usize::MAX).expect("λ available").step;
        s.raise_lambda_cap(1_000_000).expect("λ available");
        assert!(s.step_lambda().expect("λ available"), "raising the cap must let it proceed");
        assert!(s.lambda_state(usize::MAX).expect("λ available").step > stalled);
    }

    #[test]
    fn the_lambda_ast_refuses_a_budget_it_cannot_meet_and_answers_one_it_can() {
        let s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        assert!(s.lambda_ast(1).expect("λ available").is_none(), "a 1-node budget must refuse, not truncate");
        assert!(s.lambda_ast(usize::MAX).expect("λ available").is_some());
    }

    // --- the TM leg ---------------------------------------------------------------------------

    #[test]
    fn the_machine_crosses_once_and_the_state_is_windowed() {
        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        let p = s.tm_program().expect("TM available");
        assert!(!p.states.is_empty());
        assert!(p.states.get(p.start as usize).is_some(), "the entry state must name a state that exists");
        assert_eq!(s.tm_status().width, Some(p.width), "tmStatus and tmProgram must agree on the width");

        for _ in 0..50 {
            if !s.step_tm().expect("TM available") {
                break;
            }
        }
        let st = s.tm_state(3).expect("TM available");
        assert_eq!(st.window.len(), p.tapes);
        for w in &st.window {
            assert!(w.len() <= 7, "radius 3 yields at most 7 cells, got {}", w.len());
        }
    }

    /// The slice must speak the same coordinates the window reports, or a scrolling renderer cannot
    /// relate the two.
    #[test]
    fn tape_slice_agrees_with_the_window_it_overlaps() {
        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        for _ in 0..50 {
            if !s.step_tm().expect("TM available") {
                break;
            }
        }
        let st = s.tm_state(3).expect("TM available");
        let from = st.window_start[0];
        let got = s.tape_slice(0, from, from + st.window[0].len()).expect("TM available");
        assert_eq!(got, st.window[0]);
    }

    #[test]
    fn a_source_span_resolves_for_a_node_the_map_knows() {
        let s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        let st = s.tm_state(1).expect("TM available");
        if let Some(node) = st.source_node {
            assert!(s.source_span(node).is_some(), "a node the TM leg named must resolve in the source leg");
        }
    }

    #[test]
    fn an_out_of_range_tape_index_is_an_error_not_a_panic() {
        let s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        let tapes = s.tm_program().expect("TM available").tapes;
        assert_eq!(
            s.tape_slice(9_999, 0, 10),
            Err(SessionError::NoSuchTape { tape: 9_999, tapes }),
            "an absent tape must not index out of bounds"
        );
    }

    /// Raising the TM cap is reachable and harmless on a run that already halted — it clears `HitCap`
    /// and nothing else, so a halted run stays halted rather than restarting.
    #[test]
    fn raising_the_tm_cap_leaves_a_halted_run_halted() {
        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        while s.step_tm().unwrap_or(false) {}
        let ended = s.tm_state(0).expect("TM available").step;
        s.raise_tm_cap(1_000_000, 1_000_000).expect("TM available");
        assert!(!s.step_tm().expect("TM available"), "a halted machine does not resume");
        assert_eq!(s.tm_state(0).expect("TM available").step, ended);
    }

    /// The mirror of the λ case: every TM method answers `Err` when the leg is absent rather than
    /// panicking. `TooDeep` reaches the TM lowering too, so a deep-enough list literal declines both.
    #[test]
    fn a_declined_tm_leg_reports_why_and_refuses_its_methods() {
        let src = format!("[{}]", (0..2048).map(|i| i.to_string()).collect::<Vec<_>>().join(", "));
        let c = Session::compile(&src, EncodingKind::Unary);
        assert!(c.diagnostics.is_empty(), "this program is well-formed; only the backends refuse it");
        let mut s = c.session.expect("a session with two declined legs is still a session");

        let st = s.tm_status();
        assert!(!st.available, "a Core this deep is refused by the TM lowering");
        assert!(!st.reason.is_empty(), "the reason is the payload the UI needs");
        assert_eq!(st.width, None);
        assert_eq!(s.tm_program(), Err(SessionError::TmAbsent));
        assert_eq!(s.tm_state(1), Err(SessionError::TmAbsent));
        assert_eq!(s.tape_slice(0, 0, 4), Err(SessionError::TmAbsent));
        assert_eq!(s.step_tm(), Err(SessionError::TmAbsent));
        assert_eq!(s.raise_tm_cap(1, 1), Err(SessionError::TmAbsent));

        // 2048 is above BOTH lowering guards, so this is also the case where every method on the
        // session refuses — the shape §7 says the UI must render honestly rather than as an error.
        assert!(!s.lambda_status().available, "2048 is above the λ lowering guard too");
        assert_eq!(s.step_lambda(), Err(SessionError::LambdaAbsent));
        assert_eq!(s.raise_lambda_cap(1), Err(SessionError::LambdaAbsent));
    }

    /// THE NUMBERS `tests/browser.rs` PINS, PINNED HERE TOO. That file asserts the values coming back
    /// across the wasm boundary are "the ones a native run produces", which is only a claim if a native
    /// run names the same ones. Both sides therefore hardcode this program's figures, and a change to
    /// either backend fails HERE first — natively, with a legible diff — rather than in a browser.
    #[test]
    fn the_reference_program_produces_the_figures_the_browser_test_pins() {
        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");

        let p = s.tm_program().expect("TM available");
        assert_eq!(p.tapes, 5);
        assert_eq!(p.width, 64);
        assert_eq!(p.states.len(), 123);
        assert_eq!(p.start, 2);

        let mut delta = 0u64;
        while s.step_tm().expect("TM available") {
            delta += 1;
        }
        assert_eq!(delta, 2_870, "δ step count");
        assert_eq!(s.tm_state(3).expect("TM available").step, 2_870);

        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        let mut beta = 0u64;
        while s.step_lambda().expect("λ available") {
            beta += 1;
        }
        assert_eq!(beta, 7, "β step count");

        // Church 42: `λf. λx.` then `f` applied 42 times. `40 + 2` is the whole point of the fixture.
        let text = s.lambda_state(usize::MAX).expect("λ available").text;
        assert!(text.starts_with("λf. λx. f "), "the normal form is Church 42, got {text:?}");
        assert_eq!(text.matches("f (").count() + 1, 42, "Church 42 applies `f` 42 times, got {text:?}");
    }

    /// `compile` builds the map at `MIN_FIELD_WIDTH` and lets `run_tm_described` auto-fit the width the
    /// machine actually runs at, so the two can differ. That is only sound because `lower_tm` derives
    /// state NAMES from the instruction stream rather than the field width.
    ///
    /// PINNED RATHER THAN ASSUMED, because the failure would be silent: if a future encoding put the
    /// width into a state name, `tm_owner` would stop matching and `source_node` would read `None`
    /// everywhere — which is also what it honestly reads for scaffolding, so nothing downstream could
    /// tell the difference. This test fails instead.
    #[test]
    fn the_source_node_resolves_at_the_width_the_run_fitted() {
        use redextape_core::viewmodel::TmState;

        let s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        let mut c = s.tm.expect("the TM leg runs this");
        let fitted = s.program.expect("a TM leg has a program").width;

        let mut saw_some = false;
        for _ in 0..200 {
            if TmState::window(&c, &s.map, 2).source_node.is_some() {
                saw_some = true;
                break;
            }
            if c.next().is_none() {
                break;
            }
        }
        assert!(
            saw_some,
            "no visited state resolved to a Core node at fitted width {fitted} — the map was built at \
             {}, so state names have started depending on the width",
            tm::MIN_FIELD_WIDTH
        );
    }
}
