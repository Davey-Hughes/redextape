//! The Session, and every decision in this crate.
//!
//! NOTHING HERE IS `#[wasm_bindgen]`, AND THAT IS THE POINT. `lib.rs` is the shell that JavaScript
//! sees; this module is ordinary Rust that `cargo test` compiles natively. `wasm-bindgen-test` runs in
//! a browser while `cargo llvm-cov` instruments the native build, so any logic living in the shell is
//! uncovered by construction and drags the workspace's 80% floor down with it.

use std::rc::Rc;

use redextape_core::analysis::Classified;
use redextape_core::core::NodeId;
use redextape_core::lambda::{self, LowerError};
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::machine::Machine;
use redextape_core::tm::{self, EncodingKind, Symbol, Tape, TmRun};
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

/// A leg's answer, or why there is not one.
///
/// **FOUR STATES RATHER THAN `Option<String>`, for the reason `RunStatus` has four rather than
/// three.** `decode_lambda_ty` and `decode_tape_ty` both answer `Option<Value>`, and "the run has
/// not finished" and "it finished and the result is not a recognizable encoding" are different facts
/// about the program. A renderer that flattens them shows one blank field for two situations that
/// call for different words.
///
/// **NOT EVERY PRODUCER REACHES EVERY STATE, and the asymmetry is real rather than incidental:**
///
/// | | `Value` | `Undecodable` | `Unfinished` | `Fault` |
/// | --- | --- | --- | --- | --- |
/// | `lambda_value` | ✅ | ✅ | the cursor has not reached `Ended` | — |
/// | `tm_value` | ✅ | ✅ | a capped compile whose cursor has not since halted | — |
/// | `evaluate` | ✅ | — | — | ✅ |
///
/// `tm_value`'s `Unfinished` is NOT λ-specific: `compile` gives both `Ran` and `HitCap` a working
/// cursor, so a capped machine is a live session with no tapes to decode. It is also not permanent —
/// a raised cap can drive that cursor to a halt, and `tm_value` decodes the configuration it stopped
/// on. There is no state in which the TM leg reports `Ended` and `Unfinished` together.
///
/// **BOTH `Undecodable` MARKS ARE A FIXTURE, NOT AN ARGUMENT.**
/// `a_function_valued_program_decodes_as_undecodable_on_both_legs` pins them against `|x| x + 1`,
/// which types as `Fun([Nat], Nat)` — a type `decode_lambda_ty` and `decode_tape_ty` both bottom out
/// on — and which BOTH backends nonetheless lower and run to an end. A ✅ in a reachability table that
/// no test can demonstrate is a claim, and this one is not.
///
/// `text` IS `format_value` OUTPUT, AND `Value` ITSELF CANNOT CROSS. `Value::Closure { params, body:
/// Rc<Core>, env: Env }` carries an environment and a Core subtree; it has no serde derive and should
/// not acquire one. That is a property of the type, not a convenience.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Decoded {
    Value { text: String },
    Undecodable,
    Unfinished,
    Fault { message: String },
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
    /// Where the CURSOR stands.
    pub run: Option<RunStatus>,
    /// How long the WHOLE run is, in δ-steps, from the run `compile` performed.
    ///
    /// **A DIFFERENT NUMBER ABOUT A DIFFERENT THING THAN `run`**, and both are needed: a renderer
    /// showing "step 40 of 2,870" reads the cursor for the first and this for the second. It does not
    /// move as the cursor advances, because it was never about the cursor.
    ///
    /// **FOR A `HitCap` RUN THIS IS THE CAP IT STOPPED AT, NOT THE LENGTH OF A COMPLETED RUN.** The
    /// machine never reached a final configuration, so there is no length to report — only the budget
    /// it exhausted. `raise_tm_cap` can then extend that budget and drive the cursor PAST this count,
    /// so "step N of `total_steps`" can show N exceeding its own total after a cap raise. A consumer
    /// rendering a progress bar must read `run` to know whether this field is a length or a floor
    /// before trusting it as one.
    ///
    /// **`LambdaStatus` HAS NO COUNTERPART, and the asymmetry is real.** The TM's length is known at
    /// compile time because `compile` already ran the machine; λ's is not, because `compile` builds
    /// the cursor and never reduces. There is no honest number to put there.
    pub total_steps: Option<u64>,
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

/// Token spans for highlighting, with no session and no backend.
///
/// A THIN WRAPPER ON PURPOSE, and it earns its place by existing at all: `analysis::classify_source`
/// is `pub` in core and had no boundary, so §6.2's "CodeMirror's headline feature is already
/// delivered, in Rust" was true of the function and false of anything JavaScript could call.
pub fn classify_source(src: &str) -> Classified {
    redextape_core::analysis::classify_source(src)
}

/// Static diagnostics — parse and typecheck — with no backend and no session.
///
/// **SEPARATE FROM `compile` BECAUSE OF WHAT `compile` COSTS.** `compile` lowers both backends and
/// runs the TM to a halt (`run_tm_described`), which is 344,999 δ-steps on the `map` demo. An editor
/// linting on every keystroke cannot go through that path, and this is the one it goes through
/// instead. `Analysis.core` is dropped: a `Core` has no boundary representation and no consumer here.
pub fn analyze(src: &str) -> Vec<Diagnostic> {
    redextape_core::analyze(src).diagnostics
}

pub struct Session {
    /// KEPT RATHER THAN DROPPED, so `evaluate` needs no second front end. A free `evaluate(src)`
    /// would re-run parse, typecheck and desugar — work `compile` has already done — purely to reach
    /// a `Core` this struct could have held.
    pub(crate) core: redextape_core::core::Core,
    /// The program's top-level type, which BOTH decoders need — `decode_lambda_ty(nf, &ty)` and
    /// `decode_tape_ty(&tapes, &ty, enc)`. `compile` computes it for `run_tm_described` and passed
    /// it away; decoding is type-directed, so a session that discarded it could not decode anything.
    pub(crate) ty: redextape_core::ty::Ty,
    pub(crate) lambda: Result<LambdaCursor, LowerError>,
    /// The TM leg: the projected program AND the cursor that walks it, TRAVELLING TOGETHER IN ONE
    /// `Result` RATHER THAN IN TWO FIELDS.
    ///
    /// **THE PAIRING IS WHAT MAKES A CURSOR WITHOUT ITS PROGRAM UNREPRESENTABLE.** `build_tm_leg`
    /// derives both from one machine and hands them back as a pair, so that combination was never a
    /// state this code could REACH — only one the earlier shape, a `Result` beside an `Option`, could
    /// SPELL. Spelling it was not free. `tm_status` had to match on both fields, and the arm for the
    /// combination that cannot occur could not be an `unreachable!()` — a panic under wasm aborts the
    /// module — so it fabricated a user-facing status instead: an error message describing a
    /// situation no program can produce, untriggerable and therefore permanently uncovered.
    ///
    /// It also put TWO SOURCES UNDER ONE FACT. `tm_program` read availability off the `Option` while
    /// `tm_status` read it off the `Result`, two encodings of one boolean that only the constructor
    /// kept in step. One `Result` collapses both costs: the type now states what `compile` always
    /// guaranteed.
    ///
    /// The projection is still built ONCE and cached — see `build_tm_leg`. Pairing changes where it
    /// is stored, not how often it is computed.
    pub(crate) tm: Result<(TmProgram, TmCursor<Rc<Machine>>), TmDecline>,
    pub(crate) map: SourceMap,
    /// The halted run's final tapes, from `TmRun::Ran`. `None` for `HitCap` — a capped run never
    /// reached a final configuration, which is what `tm_value` reports as `Unfinished` rather than
    /// as `Undecodable`.
    ///
    /// **WRITTEN ONCE, BY `compile`, AND NEVER UPDATED.** A cap raised afterwards can carry the CURSOR
    /// to a halt, and that halt is not recorded here; `tm_value` reads the cursor as a fallback for
    /// exactly that case. Nothing else may treat this field as "has the run finished" — `tm_status().run`
    /// is the only honest answer to that question.
    pub(crate) final_tapes: Option<Vec<Tape>>,
    /// The encoding the tapes were produced under. NO WIDTH IS KEPT ALONGSIDE IT: `TmRun::Ran`'s own
    /// doc records that both encodings decode structurally, delimiter to delimiter, so any instance
    /// decodes tapes produced at any width. There is therefore no second object that can disagree
    /// with the first — the shape that once mis-attributed 1,049 of 1,374 spans.
    pub(crate) kind: EncodingKind,
    /// δ-steps the run `compile` performed took, from `DescribedRun.steps`. `None` when
    /// `run_tm_described` answered `Err`, which is exactly the program that never ran a step.
    ///
    /// **`Some` HERE DOES NOT MEAN THE LEG IS AVAILABLE.** `Overflow` and `TooLarge` arrive inside an
    /// `Ok`, carrying the real count of the attempt that produced them, and still decline the leg —
    /// the runaway counter in `a_declined_tm_leg_reports_no_total_steps` reaches 740,183. `tm_status`
    /// is where that is withheld: a declined leg reports `None` however this field reads, because a
    /// length beside `available: false` describes a run the caller has no cursor to reach.
    pub(crate) total_steps: Option<u64>,
}

/// The shared tail of `compile`'s two non-declining arms. `Ran` and `HitCap` build the same cursor
/// and the same projected program; they differ only in whether a final configuration exists.
///
/// **THE FINAL TAPES ARE PAIRED ON AT THE CALL SITE RATHER THAN PASSED THROUGH HERE.** This function
/// once took them as a third parameter and returned them untouched, purely to shape the return tuple —
/// a parameter that could not affect the result, which reads as though it might. What the helper is
/// actually for is that both arms build the leg identically, so the `match` in `compile` can stay
/// exhaustive with no catch-all; that property is unaffected by where the tapes are attached.
///
/// `caps` IS THE BUDGET THE DESCRIBED RUN ALREADY SPENT, handed on so the cursor starts life with the
/// same one. A cursor budgeted differently from the run whose outcome the session reports would stop
/// somewhere that outcome never mentions.
fn build_tm_leg(header: tm::TmHeader, machine: Machine, caps: tm::TmCaps) -> (TmProgram, TmCursor<Rc<Machine>>) {
    let init = header.init(machine.tapes);
    let width = header.width;
    let machine = Rc::new(machine);
    // `TmProgram` is projected ONCE, here, and cached — never per step. The `map` demo is 3,203 states
    // over 344,999 steps; re-projecting per `tmState` is the cost the `TmProgram`/`TmState` split
    // exists to avoid.
    let program = TmProgram::of(&machine, width);
    let cursor = TmCursor::new(Rc::clone(&machine), &init, caps);
    (program, cursor)
}

/// The ONE place an interpreter run becomes a `Decoded`. `evaluate` and `evaluate_with_budget` differ
/// only in the budget they pass, so they must not be able to differ in the shape they answer with.
fn decoded_of(run: Result<redextape_core::value::Value, redextape_core::interp::RuntimeError>) -> Decoded {
    match run {
        Ok(v) => Decoded::Value { text: redextape_core::value::format_value(&v) },
        Err(e) => Decoded::Fault { message: e.message },
    }
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
        Session::compile_with_caps(src, kind, tm::TM_DEFAULT_CAPS)
    }

    /// `compile` with the TM run's budget as a parameter rather than a constant.
    ///
    /// PRIVATE, AND EVERY PRODUCT CALLER PASSES `TM_DEFAULT_CAPS` — the boundary exposes no way to
    /// choose. It is a parameter because `TM_DEFAULT_CAPS` is 5,000,000 δ-steps, so the `HitCap` arm
    /// below is otherwise only reachable by simulating five million steps and then five million more
    /// through the cursor to reach the same wall. A test that cannot afford that is a test that never
    /// runs, and the arm it cannot reach is the one where `final_tapes` is `None` and every question
    /// about a continued run is decided. With a budget of ten the same arm is reached in milliseconds,
    /// by the same code, from the same source program.
    fn compile_with_caps(src: &str, kind: EncodingKind, caps: tm::TmCaps) -> Compiled {
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
        let described = tm::run_tm_described(&core, kind, ty.clone(), caps);
        // Read off the `Ok` BEFORE the match consumes it, so every run that STARTED reports its own
        // count — including `Overflow` and `TooLarge` arriving inside an `Ok`, which decline the leg
        // and still ran. See the field's doc for where a declined leg's length is withheld.
        let total_steps = described.as_ref().ok().map(|d| d.steps);
        let tm = match described {
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
                TmRun::Ran { tapes } => Ok((build_tm_leg(d.header, d.machine, caps), Some(tapes))),
                TmRun::HitCap => Ok((build_tm_leg(d.header, d.machine, caps), None)),
            },
        };

        // The LEG stays paired; only the final tapes are split off, because they are genuinely a
        // separate fact — `Ran` has them and `HitCap` does not, while both build the same leg.
        let (tm, final_tapes) = match tm {
            Ok((leg, t)) => (Ok(leg), t),
            Err(d) => (Err(d), None),
        };

        Compiled { diagnostics, session: Some(Session { core, ty, kind, lambda, tm, map, final_tapes, total_steps }) }
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

    /// Advance up to `budget` β-steps, then report how the run stands.
    ///
    /// **CHUNKED RATHER THAN RUN-TO-CAP, AND THAT IS A UI REQUIREMENT.** `MAX_REDUCTION_STEPS` is
    /// 5,000,000; a single call that spends all of it blocks the browser's main thread with no
    /// progress and no way to cancel. A caller loops on `Running` and yields between chunks, which
    /// costs ~100 crossings at a 50,000-step chunk instead of five million.
    ///
    /// **A SPENT `budget` IS NOT A SPENT CAP.** Exhausting `budget` leaves the run `Running`; only
    /// the cursor's own cap yields `Capped`. This is the same distinction `RunStatus` was introduced
    /// for one layer in — folding them together would offer "continue" on a run that has merely
    /// paused, and hide it from the one run that can actually take it.
    ///
    /// Returns `RunStatus` rather than `bool` for the reason `step_lambda`'s doc records: `false`
    /// answers every end condition identically, and a renderer cannot act on that.
    pub fn run_lambda(&mut self, budget: u64) -> Result<RunStatus, SessionError> {
        let c = self.lambda.as_mut().map_err(|_| SessionError::LambdaAbsent)?;
        for _ in 0..budget {
            if c.next().is_none() {
                break;
            }
        }
        // `run` is `None` only for an absent leg, which the `?` above has already ruled out — so the
        // fallback is unreachable today. It is a fallback rather than an unwrap because unwrapping is a
        // panic and a panic under wasm aborts the module; if `lambda_status` ever grows a case that
        // withholds `run` from a leg that is present, this reports "still running" instead of dying.
        Ok(self.lambda_status().run.unwrap_or(RunStatus::Running))
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

    /// The λ leg's answer, decoded against the program's type.
    ///
    /// `Unfinished` UNTIL THE RUN ENDS, and that is a check on `RunStatus` rather than on the shape
    /// of the term. A term mid-reduction can happen to *look* like a Church numeral — a partially
    /// reduced `40 + 2` passes through terms that decode — so decoding whatever the cursor currently
    /// holds would report an answer that is not the program's.
    ///
    /// `Undecodable` IS A REAL OUTCOME, not a failure: a normal form of a type the decoder has no
    /// encoding for is a fact about this pair of program and backend, and the UI should say so
    /// rather than show an empty field.
    pub fn lambda_value(&self) -> Result<Decoded, SessionError> {
        let c = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
        if self.lambda_status().run != Some(RunStatus::Ended) {
            return Ok(Decoded::Unfinished);
        }
        Ok(match lambda::decode_lambda_ty(c.term(), &self.ty) {
            Some(v) => Decoded::Value { text: redextape_core::value::format_value(&v) },
            None => Decoded::Undecodable,
        })
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
        match &self.tm {
            Ok((p, c)) => {
                // No depth guard on this leg — the machine has no term to recurse over — so `HitCap`
                // has one producer and `Capped` is unambiguous here in a way it is not for λ.
                let run = match c.status() {
                    None => RunStatus::Running,
                    Some(tm::TmStatus::Halted) => RunStatus::Ended,
                    Some(tm::TmStatus::HitCap) => RunStatus::Capped,
                };
                TmStatus {
                    available: true,
                    reason: String::new(),
                    width: Some(p.width),
                    run: Some(run),
                    total_steps: self.total_steps,
                }
            }
            Err(d) => {
                let reason = match d {
                    TmDecline::TooLarge => "the machine this program needs is too large to build".to_string(),
                    TmDecline::Overflow => {
                        "a value does not fit the encoding at any width up to the ceiling".to_string()
                    }
                    TmDecline::Lower(what) => format!("the program could not be lowered: {what}"),
                };
                // `total_steps` is `None` here even when the field is `Some` — an `Overflow` decline
                // arrives with a real δ-count for the attempt that overflowed, and there is no cursor
                // for a caller to relate it to.
                TmStatus { available: false, reason, width: None, run: None, total_steps: None }
            }
        }
    }

    /// The cached projection, cloned — never a re-walk. The `map` demo is 3,203 states over 344,999
    /// steps, and re-projecting per step is the cost the `TmProgram`/`TmState` split exists to avoid.
    ///
    /// AVAILABILITY IS READ OFF `tm`, the same place `tm_status` reads it, so the two cannot disagree
    /// about whether this leg is there.
    pub fn tm_program(&self) -> Result<TmProgram, SessionError> {
        let (p, _) = self.tm.as_ref().map_err(|_| SessionError::TmAbsent)?;
        Ok(p.clone())
    }

    /// Advance one δ-step. `false` once the run has halted or hit a cap — `tm_status().run` says
    /// which, and is the only thing that can.
    pub fn step_tm(&mut self) -> Result<bool, SessionError> {
        let (_, c) = self.tm.as_mut().map_err(|_| SessionError::TmAbsent)?;
        Ok(c.next().is_some())
    }

    pub fn tm_state(&self, radius: usize) -> Result<TmState, SessionError> {
        let (_, c) = self.tm.as_ref().map_err(|_| SessionError::TmAbsent)?;
        Ok(TmState::window(c, &self.map, radius))
    }

    /// Cells `from..to` of tape `tape`, in the same materialized coordinates `tm_state` reports its
    /// `heads` and `window_start` in — so a scrolling renderer can relate the two.
    ///
    /// `get`, NEVER `[]`: an absent tape answers `Err` rather than indexing out of bounds. `from`/`to`
    /// need no such guard because `Tape::slice` clamps both.
    pub fn tape_slice(&self, tape: usize, from: usize, to: usize) -> Result<Vec<Symbol>, SessionError> {
        let (_, c) = self.tm.as_ref().map_err(|_| SessionError::TmAbsent)?;
        let tapes = c.tapes();
        let t = tapes.get(tape).ok_or(SessionError::NoSuchTape { tape, tapes: tapes.len() })?;
        Ok(t.slice(from, to))
    }

    /// Extend a capped run's budget. Additive and saturating, like the λ leg's.
    pub fn raise_tm_cap(&mut self, extra_steps: u64, extra_cells: u64) -> Result<(), SessionError> {
        let (_, c) = self.tm.as_mut().map_err(|_| SessionError::TmAbsent)?;
        c.raise_cap(extra_steps, extra_cells);
        Ok(())
    }

    /// The TM leg's answer, decoded from the run `compile` already performed.
    ///
    /// **NO SECOND RUN.** `compile` calls `run_tm_described`, which simulates the machine to a halt;
    /// driving the cursor for the same answer would simulate the `map` demo's 344,999 steps twice.
    /// The cursor exists for WATCHING a run, which is Plan 5's job.
    ///
    /// **THE CURSOR IS THE FALLBACK, AND ONLY THE FALLBACK.** `final_tapes` is written once, by
    /// `compile`, and a `HitCap` compile writes `None` — but `raise_tm_cap` then lets a caller drive
    /// the cursor to a halt, at which point the session holds a final configuration that `final_tapes`
    /// does not. Reading `final_tapes` alone answered `Unfinished` forever for exactly the run
    /// `RunStatus::Capped` invites the caller to continue, so `tm_status().run` said `Ended` while this
    /// said `Unfinished` and both were reporting on the same machine. The fallback decodes tapes the
    /// cursor ALREADY HOLDS, so the "no second run" property above survives it intact.
    ///
    /// `Unfinished` therefore means there is no final configuration ANYWHERE — no halted run recorded
    /// at compile time and a cursor that has not itself halted.
    ///
    /// **THE `HitCap` THAT PUTS IT THERE HAS TWO PRODUCERS, NOT ONE.** `TmCursor` caps on the step
    /// budget and on the live-CELL budget, and `trace.rs` says outright that no test can tell those two
    /// apart. Under the second, `total_steps` is the count reached when cells ran out — well below
    /// `caps.steps` — so a reader must not take a capped run's length as evidence of which wall it hit.
    pub fn tm_value(&self) -> Result<Decoded, SessionError> {
        let (_, cursor) = self.tm.as_ref().map_err(|_| SessionError::TmAbsent)?;
        let tapes: &[Tape] = match &self.final_tapes {
            Some(t) => t,
            None if cursor.status() == Some(tm::TmStatus::Halted) => cursor.tapes(),
            None => return Ok(Decoded::Unfinished),
        };
        let enc = self.kind.at(tm::MIN_FIELD_WIDTH);
        Ok(match tm::decode_tape_ty(tapes, &self.ty, &*enc) {
            Some(v) => Decoded::Value { text: redextape_core::value::format_value(&v) },
            None => Decoded::Undecodable,
        })
    }

    // --- the reference leg --------------------------------------------------------------------

    /// The reference interpreter's answer — the ground truth `three_way_oracle.rs` checks both
    /// backends against, surfaced so a disagreement is visible in the product rather than only in CI.
    ///
    /// A METHOD RATHER THAN A FREE `evaluate(src)`, so the front end runs once. See the `core` field.
    ///
    /// `RunError::Static` IS STRUCTURALLY UNREACHABLE HERE: `compile` answers `session: None` for any
    /// program with an error-severity diagnostic, so a `Session` existing at all means the static
    /// half already passed. Only `RuntimeError` can arrive.
    ///
    /// **THIS BLOCKS ITS CALLER FOR ITS WHOLE WORST CASE, AND CANNOT BE CHUNKED.** `interp::eval` runs
    /// at `DEFAULT_BUDGET` — 5,000,000 steps — inside one uninterruptible call. That is precisely the
    /// cost `run_lambda`'s chunking exists to avoid, and its justification applies here word for word:
    /// a five-million-step run in one call blocks the main thread with no progress and no cancellation.
    /// It is not hypothetical. This branch's own TM-decline fixture,
    /// `let mut n = 1; while n > 0 { n = n + 1; } n`, spends the entire budget inside one boundary call
    /// before answering `Fault`.
    ///
    /// **`eval` IS NOT RESUMABLE, so there is no chunked version to write.** It is a recursive
    /// tree-walker with no cursor, no saved continuation and no way to be stopped halfway and
    /// re-entered — unlike `LambdaCursor`, which is why `run_lambda` could be chunked and this cannot.
    /// A future reader should not go looking for the trick; the affordance is `evaluate_with_budget`,
    /// which lets a caller choose how long a freeze it is willing to take.
    ///
    /// **NEITHER METHOD IS CACHED, and that is a known cost rather than an oversight.** Every call
    /// re-runs the interpreter from the top, so a renderer that calls this twice pays twice. It is left
    /// that way deliberately: a cache would have to be keyed by budget, since a `Fault` produced by
    /// exhausting a small budget is not an answer about the program and must not be served to a caller
    /// who asked for a larger one.
    pub fn evaluate(&self) -> Decoded {
        decoded_of(redextape_core::interp::eval(&self.core))
    }

    /// The reference interpreter's answer under a budget the CALLER chooses, instead of
    /// `interp::DEFAULT_BUDGET`.
    ///
    /// **IT BOUNDS THE FREEZE, NOT THE ANSWER.** `evaluate` cannot be chunked — see its doc — so the
    /// only thing a caller can control is how many steps it is willing to stop for. Everything else is
    /// identical: same interpreter, same `Decoded`, and on any program that finishes inside the budget,
    /// the same value `evaluate` gives.
    ///
    /// A BUDGET TOO SMALL IS NOT AN ERROR CONDITION. It arrives as `Fault { message }`, the same shape a
    /// genuine runtime fault takes, with the message naming the budget it exceeded — so a caller
    /// wanting to tell "it needs longer" from "it is wrong" reads the message. Flattening them would
    /// have needed a fifth `Decoded` state for something the interpreter itself does not distinguish.
    ///
    /// NOT CACHED, exactly like `evaluate`, and for the reason recorded there.
    pub fn evaluate_with_budget(&self, budget: u64) -> Decoded {
        decoded_of(redextape_core::interp::eval_with_budget(&self.core, budget))
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

    /// THE LOAD-BEARING DISTINCTION OF THIS METHOD. A spent CHUNK budget leaves the run `Running`; only
    /// the cursor's own cap yields `Capped`. Getting it backwards puts a "continue" affordance on a run
    /// that has merely paused, and withholds it from the one run that can actually continue.
    #[test]
    fn a_spent_chunk_budget_is_running_not_capped() {
        let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
        let mut s = c.session.expect("compiles");

        // 3 of the 7 β-steps this program takes.
        assert_eq!(s.run_lambda(3).expect("λ leg is present"), RunStatus::Running);
        assert_eq!(s.lambda_state(1_000_000).expect("present").step, 3, "the chunk ran exactly its budget");

        assert_eq!(s.run_lambda(3).expect("present"), RunStatus::Running);
        assert_eq!(s.run_lambda(3).expect("present"), RunStatus::Ended, "the 7th step ends it mid-chunk");
        assert_eq!(s.lambda_state(1_000_000).expect("present").step, 7);
    }

    /// A budget larger than the run reaches the end in one call, which is the shape a caller uses when it
    /// does not care about progress.
    #[test]
    fn a_budget_larger_than_the_run_ends_it_in_one_call() {
        let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
        let mut s = c.session.expect("compiles");
        assert_eq!(s.run_lambda(1_000_000).expect("present"), RunStatus::Ended);
        assert_eq!(s.lambda_state(1_000_000).expect("present").step, 7);
    }

    /// The cursor's OWN cap is what produces `Capped`, and it must not be confused with a chunk budget
    /// that happens to be the same size.
    #[test]
    fn the_cursors_cap_yields_capped_not_running() {
        let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
        let mut s = c.session.expect("compiles");
        s.cap_lambda_at(3);
        assert_eq!(s.run_lambda(1_000_000).expect("present"), RunStatus::Capped, "the CURSOR ran out, not the chunk");
    }

    /// A run that has already ended stays ended and takes no further steps, however large the budget.
    #[test]
    fn running_an_ended_cursor_is_a_no_op() {
        let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
        let mut s = c.session.expect("compiles");
        assert_eq!(s.run_lambda(1_000_000).expect("present"), RunStatus::Ended);
        assert_eq!(s.run_lambda(1_000_000).expect("present"), RunStatus::Ended);
        assert_eq!(s.lambda_state(1_000_000).expect("present").step, 7, "no step was taken after the end");
    }

    /// A zero budget is a legitimate call — a caller polling status without advancing — and must not be
    /// mistaken for an ended run.
    #[test]
    fn a_zero_budget_advances_nothing_and_reports_running() {
        let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
        let mut s = c.session.expect("compiles");
        assert_eq!(s.run_lambda(0).expect("present"), RunStatus::Running);
        assert_eq!(s.lambda_state(1_000_000).expect("present").step, 0);
    }

    /// **A DEPTH REFUSAL MUST SURVIVE `run_lambda` AS ITSELF, NEVER AS `Capped`.** The distinction was
    /// asserted only through `step_lambda`, and `run_lambda` reaches its answer by a different route —
    /// one `lambda_status()` read after the chunk rather than one per step — so a regression that folded
    /// the two together here would have left that test green. `Capped` is the only status for which
    /// "continue" is an honest offer, and this is the one run that provably cannot take it.
    #[test]
    fn run_lambda_reports_a_depth_refusal_as_itself_not_as_capped() {
        // A Church numeral is a spine as deep as its value, so a literal above `reduce::MAX_TERM_DEPTH`
        // (3,000) lowers to a term the reducer refuses to recurse over.
        let mut s = Session::compile("let x = 5000; x + 1", EncodingKind::Unary).session.expect("compiles");
        assert_eq!(
            s.run_lambda(1_000_000).expect("λ leg present"),
            RunStatus::DepthRefused,
            "a term past MAX_TERM_DEPTH must not be reported as continuable"
        );

        // And raising the cap must not appear to have helped — extending a budget cannot make a term
        // shallower. `LambdaCursor::raise_cap` refuses to clear the depth latch, and this is that
        // guarantee re-checked at the boundary, through the method a renderer's run loop calls.
        s.raise_lambda_cap(1_000_000).expect("λ available");
        assert_eq!(s.run_lambda(1_000_000).expect("λ leg present"), RunStatus::DepthRefused);
    }

    /// **`Decoded::Undecodable` HAS A FIXTURE**, and until this test the two ✅ marks in `Decoded`'s own
    /// reachability table rested on argument alone — the state was asserted nowhere, for either producer.
    ///
    /// The mechanism is a top-level type neither decoder has an encoding for. `decode_lambda_ty` answers
    /// `None` for `Ty::Fun` and `Ty::Var` — "well-formed but not first-class values, exactly as
    /// `ty::parse_ty` refuses them" — and `tm::decode_tape_ty` bottoms out the same way.
    ///
    /// `|x| x + 1` TYPES AS `Fun([Nat], Nat)` AND BOTH BACKENDS ACCEPT IT, which is what makes it a
    /// fixture rather than a decline: the leg is available, the run reaches its end, and there is simply
    /// nothing in the answer a decoder can read. The availability assertions are load-bearing — against
    /// a program either backend refused, this test would pass while exercising nothing.
    ///
    /// **`Undecodable`, NOT `Unfinished`, AND THAT IS WHY THERE ARE FOUR STATES.** "the run has not
    /// finished" and "it finished and the result is not a recognizable encoding" are different facts
    /// about the program, and a UI that renders one blank field for both is wrong about one of them.
    #[test]
    fn a_function_valued_program_decodes_as_undecodable_on_both_legs() {
        let mut s = Session::compile("|x| x + 1", EncodingKind::Unary).session.expect("compiles");
        assert!(matches!(s.ty, redextape_core::ty::Ty::Fun(..)), "the fixture's top-level type is {:?}", s.ty);

        assert!(s.lambda_status().available, "the λ backend lowers this — against a decline this proves nothing");
        assert_eq!(
            s.run_lambda(1_000_000).expect("λ leg present"),
            RunStatus::Ended,
            "and reduces it to a normal form"
        );
        assert_eq!(s.lambda_value(), Ok(Decoded::Undecodable), "a normal form of a function type decodes to nothing");

        assert!(s.tm_status().available, "the TM backend lowers and runs it too");
        assert_eq!(s.tm_value(), Ok(Decoded::Undecodable), "and its halted tapes decode to nothing either");
    }

    /// An absent λ leg throws rather than aborting, the same as every other λ method.
    #[test]
    fn run_lambda_on_an_absent_leg_is_an_error() {
        let c = Session::compile(LAMBDA_DECLINES, EncodingKind::Unary);
        let mut s = c.session.expect("the TM leg handles this program");
        assert_eq!(s.run_lambda(10), Err(SessionError::LambdaAbsent));
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

    /// `classify_source` must reach the boundary WITHOUT a session, and must classify a file that does
    /// not analyze. Highlighting a broken file is when highlighting matters most, which is why
    /// `analysis::classify_source` discards the lexer's diagnostics — they come back through `analyze`.
    #[test]
    fn classify_source_works_on_a_program_that_does_not_analyze() {
        let spans = classify_source("let x = ;");
        assert!(!spans.is_empty(), "a file with a parse error still has tokens to highlight");
        let (span, _) = spans[0];
        assert!(span.end > span.start, "spans are well-formed ranges");
        assert_eq!(spans, redextape_core::analysis::classify_source("let x = ;"), "the boundary adds nothing");
    }

    /// `analyze` is the CHEAP diagnostics path, and its separation from `compile` is the whole point:
    /// linting through `compile` would lower both backends and simulate a Turing machine to a halt on
    /// every keystroke.
    #[test]
    fn analyze_reports_diagnostics_without_building_a_session() {
        let clean = analyze("let x = 40; x + 2");
        assert!(clean.is_empty(), "a clean program has no diagnostics, got {clean:?}");

        let broken = analyze("let x = ;");
        assert!(!broken.is_empty(), "a parse error must be reported");
        assert!(broken.iter().any(|d| d.severity == Severity::Error));

        assert_eq!(
            broken,
            Session::compile("let x = ;", EncodingKind::Unary).diagnostics,
            "analyze and compile must not disagree about what is wrong with a program"
        );
    }

    /// Church 42 decodes to 42, but only after the run reaches its end.
    #[test]
    fn lambda_value_decodes_the_normal_form() {
        let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
        let mut s = c.session.expect("compiles");
        assert_eq!(s.lambda_value(), Ok(Decoded::Unfinished), "nothing to decode before the run ends");
        assert_eq!(s.run_lambda(1_000_000).expect("present"), RunStatus::Ended);
        assert_eq!(s.lambda_value(), Ok(Decoded::Value { text: "42".to_string() }));
    }

    /// The λ answer must equal the reference answer. This is the three-way oracle's λ half, asserted at
    /// the layer the product reads rather than at core's.
    #[test]
    fn the_lambda_leg_agrees_with_the_reference() {
        for src in ["let x = 40; x + 2", "[1, 2, 3]", "true", "1 + 2 * 3"] {
            let c = Session::compile(src, EncodingKind::Unary);
            let mut s = c.session.unwrap_or_else(|| panic!("{src} compiles"));
            assert_eq!(s.run_lambda(1_000_000).expect("λ leg present"), RunStatus::Ended, "{src}");
            assert_eq!(s.lambda_value(), Ok(s.evaluate()), "{src}: the λ leg and the reference disagree");
        }
    }

    /// A capped run is `Unfinished`, not `Undecodable` — it has a term, it is simply not a normal form.
    #[test]
    fn a_capped_lambda_run_is_unfinished() {
        let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
        let mut s = c.session.expect("compiles");
        s.cap_lambda_at(3);
        assert_eq!(s.run_lambda(1_000_000).expect("present"), RunStatus::Capped);
        assert_eq!(s.lambda_value(), Ok(Decoded::Unfinished));
    }

    /// An absent λ leg is an error, not a `Decoded` variant — "this program has no λ backend" is a fact
    /// about the program, and flattening it into "no value" loses the reason.
    #[test]
    fn lambda_value_on_an_absent_leg_is_an_error() {
        let c = Session::compile(LAMBDA_DECLINES, EncodingKind::Unary);
        let s = c.session.expect("the TM leg handles this program");
        assert_eq!(s.lambda_value(), Err(SessionError::LambdaAbsent));
    }

    /// The TM's answer comes from the run `compile` ALREADY performed. Driving the cursor for the same
    /// answer would simulate the machine a second time.
    #[test]
    fn tm_value_decodes_the_run_compile_already_performed() {
        let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
        let s = c.session.expect("compiles");
        // No stepping: the cursor is still at 0 and the value is already known.
        assert_eq!(s.tm_state(1).expect("present").step, 0);
        assert_eq!(s.tm_value(), Ok(Decoded::Value { text: "42".to_string() }));
    }

    /// All three legs must agree. This is the three-way oracle asserted at the layer the product reads.
    #[test]
    fn all_three_legs_agree() {
        for src in ["let x = 40; x + 2", "[1, 2, 3]", "true", "1 + 2 * 3"] {
            let c = Session::compile(src, EncodingKind::Unary);
            let mut s = c.session.unwrap_or_else(|| panic!("{src} compiles"));
            assert_eq!(s.run_lambda(1_000_000).expect("λ leg present"), RunStatus::Ended, "{src}");
            let reference = s.evaluate();
            assert_eq!(s.lambda_value(), Ok(reference.clone()), "{src}: λ disagrees with the reference");
            assert_eq!(s.tm_value(), Ok(reference), "{src}: TM disagrees with the reference");
        }
    }

    /// `total_steps` describes the WHOLE run; `run` describes where the CURSOR is. A renderer showing
    /// "step 40 of 2,870" reads both, and they are different numbers about different things.
    #[test]
    fn tm_status_reports_the_whole_runs_length_alongside_the_cursors_position() {
        let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
        let mut s = c.session.expect("compiles");
        assert_eq!(s.tm_status().total_steps, Some(2870), "the length of the whole run");
        assert_eq!(s.tm_status().run, Some(RunStatus::Running), "the cursor has not moved");

        let mut driven = 0;
        while s.step_tm().expect("present") {
            driven += 1;
        }
        assert_eq!(driven, 2870, "the cursor reaches the length the fitting run reported");
        assert_eq!(s.tm_status().total_steps, Some(2870), "unchanged: it was never about the cursor");
    }

    /// A declined TM leg has no run, so no length.
    ///
    /// BOTH SHAPES OF DECLINE, because they reach the field by different routes and only one of them is
    /// obvious. A `Lower` decline is an `Err` out of `run_tm_described`, so `total_steps` is genuinely
    /// `None`; an `Overflow` decline arrives inside an `Ok` carrying the real δ-count of the attempt
    /// that overflowed, and `tm_status` withholds it anyway. A status offering a length beside
    /// `available: false` would be describing a run the caller has no cursor to reach.
    #[test]
    fn a_declined_tm_leg_reports_no_total_steps() {
        let s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        assert!(s.tm_status().total_steps.is_some(), "an available leg has a length");

        // `TooDeep` out of the TM lowering: the program never ran a step, so there is no count at all.
        let src = format!("[{}]", (0..2048).map(|i| i.to_string()).collect::<Vec<_>>().join(", "));
        let s = Session::compile(&src, EncodingKind::Unary).session.expect("a declined leg is still a session");
        assert!(!s.tm_status().available, "2048 elements must still be above the TM lowering guard");
        assert_eq!(s.total_steps, None, "a program that never ran has no δ-count");
        assert_eq!(s.tm_status().total_steps, None);

        // `Overflow`: the attempts DID run, and the field holds the last one's count.
        let s = Session::compile("let mut n = 1; while n > 0 { n = n + 1; } n", EncodingKind::Unary)
            .session
            .expect("a declined leg is still a session");
        assert!(!s.tm_status().available, "no width up to the ceiling fits an unbounded counter");
        assert!(s.total_steps.is_some(), "the overflowing attempt ran, and its count is real");
        assert_eq!(s.tm_status().total_steps, None, "but a declined leg still reports no length");
    }

    /// **`tmValue()` AND `tmStatus().run` MUST NOT CONTRADICT EACH OTHER**, and a raised cap is the one
    /// place they could. `RunStatus::Capped` exists specifically so a renderer can offer "continue";
    /// taking that offer used to produce a UI showing a halted machine with no answer, permanently,
    /// because `final_tapes` is written once in `compile` and a capped compile writes `None`.
    ///
    /// THE SEQUENCE IS DRIVEN, NOT CONSTRUCTED. Every step here is one a renderer takes: step until the
    /// cursor stops, read `run` to learn the run may continue, raise, step again, read the answer.
    ///
    /// `[1, 2, 3]` auto-fits to `MIN_FIELD_WIDTH`, so the machine this budget stops early is the same
    /// machine an unbudgeted run would have built — the tapes it halts on decode at the width
    /// `tm_value` decodes at, rather than at some wider one the fitting loop never got to try.
    #[test]
    fn a_raised_tm_cap_driven_to_a_halt_answers_what_the_status_claims() {
        let caps = tm::TmCaps { steps: 10, cells: tm::TM_DEFAULT_CAPS.cells };
        let mut s = Session::compile_with_caps("[1, 2, 3]", EncodingKind::Unary, caps)
            .session
            .expect("a capped run yields a working session, which is the point of the HitCap arm");
        assert!(s.final_tapes.is_none(), "a capped compile reached no final configuration to record");

        while s.step_tm().expect("TM available") {}
        assert_eq!(s.tm_status().run, Some(RunStatus::Capped), "a spent budget is Capped, not Ended");
        assert_eq!(s.tm_value(), Ok(Decoded::Unfinished), "and there is genuinely nothing to decode yet");

        // Taking the "continue" offer that `Capped` exists to make honest.
        s.raise_tm_cap(1_000_000, 0).expect("TM available");
        while s.step_tm().expect("TM available") {}

        assert_eq!(s.tm_status().run, Some(RunStatus::Ended), "the raised cap carried the cursor to a halt");
        assert_eq!(
            s.tm_value(),
            Ok(Decoded::Value { text: "[1, 2, 3]".to_string() }),
            "the status says this machine halted, so the value must be the halted machine's"
        );
    }

    /// An absent TM leg is an error, matching every other TM method.
    ///
    /// THE FIXTURE IS A PROGRAM THIS BACKEND ACTUALLY DECLINES, and the assertion above the one under
    /// test is what keeps that true rather than an early return: a fixture that starts lowering must
    /// FAIL this test, not pass it while proving nothing.
    #[test]
    fn tm_value_on_an_absent_leg_is_an_error() {
        let s = Session::compile("let mut n = 1; while n > 0 { n = n + 1; } n", EncodingKind::Unary)
            .session
            .expect("a declined TM leg is still a session");
        assert!(!s.tm_status().available, "the fixture must decline, or this test asserts nothing");
        assert_eq!(s.tm_value(), Err(SessionError::TmAbsent));
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

    /// The reference interpreter is the ground truth the three-way oracle checks both backends against.
    /// Surfacing it means a disagreement is visible in the product, not only in CI.
    #[test]
    fn evaluate_answers_the_reference_value() {
        let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
        let s = c.session.expect("compiles");
        assert_eq!(s.evaluate(), Decoded::Value { text: "42".to_string() });
    }

    /// A list renders through `format_value`, which is what the product shows. `Value` itself cannot
    /// cross: `Value::Closure` holds an `Env` and an `Rc<Core>`.
    #[test]
    fn evaluate_renders_a_list_through_format_value() {
        let c = Session::compile("[1, 2, 3]", EncodingKind::Unary);
        let s = c.session.expect("compiles");
        assert_eq!(s.evaluate(), Decoded::Value { text: "[1, 2, 3]".to_string() });
    }

    /// `RunError::Runtime` is the one genuinely new failure shape this slice adds, and it must arrive as
    /// a message rather than as an abort.
    ///
    /// THE MESSAGE IS MATCHED ON A SUBSTRING, not merely checked non-empty. Every runtime fault carries
    /// a non-empty message — including "exceeded step budget" — so `!is_empty()` alone would stay green
    /// if `head([])` ever started faulting for some other reason entirely, proving only that SOMETHING
    /// went wrong. `head` is the word the intended fault names, and coupling to the full wording instead
    /// would make this a change-detector. Same convention as `every_session_error_says_what_went_wrong`.
    #[test]
    fn a_runtime_fault_is_reported_as_a_fault_not_an_abort() {
        let c = Session::compile("head([])", EncodingKind::Unary);
        let s = c.session.expect("the program is well-typed; it faults at runtime");
        match s.evaluate() {
            Decoded::Fault { message } => {
                assert!(message.contains("head"), "the fault must name what failed, got {message:?}");
            }
            other => panic!("expected a runtime fault, got {other:?}"),
        }
    }

    /// A BUDGET SMALLER THAN THE PROGRAM NEEDS FAULTS RATHER THAN RUNNING ON. The fixture is this
    /// branch's own runaway counter, which never terminates at all — so the only thing bounding
    /// `evaluate` on it is `DEFAULT_BUDGET`'s five million steps, spent inside one uninterruptible call.
    /// That is the freeze this method exists to let a caller bound.
    #[test]
    fn a_small_budget_faults_instead_of_running_long() {
        let s = Session::compile("let mut n = 1; while n > 0 { n = n + 1; } n", EncodingKind::Unary)
            .session
            .expect("a declined TM leg is still a session");
        match s.evaluate_with_budget(1_000) {
            Decoded::Fault { message } => {
                assert!(message.contains("budget"), "the fault must name what ran out, got {message:?}");
            }
            other => panic!("a nonterminating program under a 1,000-step budget must fault, got {other:?}"),
        }
    }

    /// A budget the program finishes inside changes NOTHING — same value, and same fault for a program
    /// that faults. That is what makes this a bound on the freeze rather than on the answer, and
    /// `head([])` is in the list so the agreement covers `Fault` and not only `Value`.
    #[test]
    fn a_generous_budget_answers_exactly_what_evaluate_answers() {
        for src in ["let x = 40; x + 2", "[1, 2, 3]", "true", "head([])"] {
            let s = Session::compile(src, EncodingKind::Unary).session.unwrap_or_else(|| panic!("{src} compiles"));
            assert_eq!(s.evaluate_with_budget(1_000_000), s.evaluate(), "{src}: the budget changed the answer");
        }
    }

    /// `evaluate` reaches NEITHER middle state, and that asymmetry is the point of the reachability
    /// table in the design's §3: `interp::eval` answers a `Value` or a `RuntimeError`, with no decoding
    /// step to fail and no partial run to report.
    #[test]
    fn evaluate_never_answers_unfinished_or_undecodable() {
        for src in ["let x = 40; x + 2", "[1, 2, 3]", "true", "head([])"] {
            let c = Session::compile(src, EncodingKind::Unary);
            let s = c.session.unwrap_or_else(|| panic!("{src} compiles"));
            assert!(
                !matches!(s.evaluate(), Decoded::Unfinished | Decoded::Undecodable),
                "{src}: evaluate reached a state it has no producer for"
            );
        }
    }

    /// `RunError::Static` is unreachable from a Session method, and this is what makes that structural
    /// rather than incidental: a session exists only for a program with no error-severity diagnostics.
    #[test]
    fn a_session_never_exists_for_a_program_with_static_errors() {
        assert!(Session::compile("let x = ;", EncodingKind::Unary).session.is_none());
        assert!(Session::compile("1 + true", EncodingKind::Unary).session.is_none());
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
        let (program, mut c) = s.tm.expect("the TM leg runs this");
        let fitted = program.width;

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
