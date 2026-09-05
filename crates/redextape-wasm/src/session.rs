//! The Session, and every decision in this crate.
//!
//! NOTHING HERE IS `#[wasm_bindgen]`, AND THAT IS THE POINT. `lib.rs` is the shell that JavaScript
//! sees; this module is ordinary Rust that `cargo test` compiles natively. `wasm-bindgen-test` runs in
//! a browser while `cargo llvm-cov` instruments the native build, so any logic living in the shell is
//! uncovered by construction and drags the workspace's 80% floor down with it.

use std::rc::Rc;

use redextape_core::analysis::Classified;
use redextape_core::core::NodeId;
use redextape_core::lambda::{self, LambdaTerm, LowerError};
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::machine::Machine;
use redextape_core::tm::{self, EncodingKind, Symbol, Tape, TmRun};
use redextape_core::trace::{LambdaCursor, TmCursor};
use redextape_core::viewmodel::{LambdaState, LinkIndex, TermTree, TmProgram, TmState};
use redextape_core::{Diagnostic, Severity, Span, lints, parser, typeck};

/// The deepest term any print through the session may walk — the two big-budget prints
/// (`lambda_state`, `link_index`) and the per-frame `lambdaState(FRAME_BYTES)` path alike.
///
/// **1,000, BELOW A MEASURED STEADY-STATE CEILING THAT LIES SOMEWHERE IN [1400, 1497).** That
/// ceiling is the term depth at which a Web Worker's V8 call stack dies mid-print ONCE THE WORKER
/// HAS ALREADY PRINTED A DEEP TERM BEFORE. It is not the same quantity as 1,930, which this constant
/// used to be justified against: 1,930 was measured with a fresh worker per sample, so every sample
/// was that worker's FIRST print — and a worker's ceiling is not fixed. It drops after the first deep
/// print, measured 2026-08-09 by driving one worker through repeated prints at fixed depths: at term
/// depth 1,497, two prints in a row held but by the fourth or fifth it failed with a stack overflow,
/// every time; at term depth 1,400 and below, the SAME worker held for 60 prints straight with no
/// further degradation observed. Those are the endpoints actually sampled — nothing between them was
/// tested, so no single number inside [1400, 1497) is itself a measured ceiling, only the bracket is.
/// That bracket is what governs an app a user keeps typing into, and 1,930 a number that was never a
/// bound on that.
///
/// **THE DEGRADATION DOES NOT ERODE BELOW 1,400 WITHIN 60 PRINTS, AND THAT IS WHAT MAKES A CAP A REAL
/// FIX RATHER THAN A SMALLER GUESS.** The data is five depths across four rep-counts, topping out at
/// 60 repeated prints in one worker — enough to show the ceiling drops from ~1,930 toward the
/// [1400, 1497) bracket without eroding further across that run, but not enough to tell "falls once
/// then holds" apart from "asymptotes somewhere above 1,400", and not a worker's lifetime — a user
/// typing for an hour issues far more than 60 prints. A cap set below 1,400 is a margin good for at
/// least the 60 prints measured, not one stated to be good for the life of the worker.
///
/// **IT IS NOT `MAX_TERM_DEPTH`, AND THE DIFFERENCE IS THE BUG THIS FIXES.** That constant is 3,000
/// and bounds the REDUCER against a native 8 MiB stack. The printer borrowed it, and 3,000 sits above
/// every browser ceiling measured — so the guard could not fire, and past 3,000 it fires at 3,000
/// frames, which is already past the cliff. There is no input size at which the old arrangement saved
/// the module.
///
/// **IT DOES NOT LIVE BESIDE `LAMBDA_BYTE_BUDGET` in `web/src/protocol.ts`, deliberately.** A byte
/// budget is renderer taste — how much text a pane will hold — and getting it wrong makes a pane
/// ugly. This is a fact about an engine call stack no module can size, and getting it wrong poisons
/// the wasm module. A number a UI author can adjust without a browser measurement is a number that
/// drifts back over the cliff.
///
/// **NO `cfg`.** This crate builds `rlib` as well as `cdylib` so `session.rs` compiles natively for
/// tests, so this is the wasm boundary's policy on whichever target the test runs — and the native
/// tests then exercise the same number the browser does.
pub const MAX_PRINT_DEPTH: u32 = 1_000;

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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
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
/// **FIVE STATES RATHER THAN `Option<String>`, for the reason `RunStatus` has four rather than
/// three.** `decode_lambda_ty` and `decode_tape_ty` both answer `Option<Value>`, and "the run has
/// not finished" and "it finished and the result is not a recognizable encoding" are different facts
/// about the program. A renderer that flattens them shows one blank field for two situations that
/// call for different words.
///
/// **NOT EVERY PRODUCER REACHES EVERY STATE, and the asymmetry is real rather than incidental:**
///
/// | | `Value` | `TooLargeToPrint` | `Undecodable` | `Unfinished` | `Fault` |
/// | --- | --- | --- | --- | --- | --- |
/// | `lambda_value` | ✅ | ✅ | ✅ | the cursor has not reached `Ended` | — |
/// | `tm_value` | ✅ | ✅ | ✅ | a capped compile whose cursor has not since halted | — |
/// | `evaluate` | ✅ | ✅ | — | — | ✅ |
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
/// **`TooLargeToPrint` IS A DIFFERENT FACT THAN `Undecodable`, AND THE FIX THAT ADDED IT IS THE WHOLE
/// REASON THIS VARIANT EXISTS.** `Undecodable` means the decode itself found no value of a
/// representable type. `TooLargeToPrint` means the decode SUCCEEDED — `decode_lambda_ty`/
/// `decode_tape_ty` answered `Some(v)`, or the reference interpreter answered `Ok(v)` — and only the
/// PRINT refused, because `v`'s LOGICAL size (an `Rc` DAG's printed size, not its allocation count —
/// see `redextape_core::value::MAX_PRINT_NODES`'s doc) exceeds what `format_value_capped` will walk.
/// Collapsing the two into one `Undecodable` would tell a renderer the value has no encoding when it
/// is, in fact, a real answer this tool merely cannot afford to print — the same distinction
/// `redextape-cli`'s `Outcome::ToolFailed` draws against `Outcome::ProgramFailed` for the identical
/// hazard on the CLI's own five print sites (`run.rs`). Each producer's own test below pins that this
/// state is reachable from a small-in-memory, logically enormous fixture, the same one `run.rs`'s
/// tests use.
///
/// `text` IS `format_value_capped` OUTPUT, AND `Value` ITSELF CANNOT CROSS. `Value::Closure { params,
/// body: Rc<Core>, env: Env }` carries an environment and a Core subtree; it has no serde derive and
/// should not acquire one. That is a property of the type, not a convenience.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Decoded {
    Value {
        text: String,
    },
    /// Decoded to a real value, but its logical size exceeds
    /// `redextape_core::value::MAX_PRINT_NODES` — this tool's limit on the PRINT, not a fact about
    /// whether the program's answer exists. See this enum's own doc for why it is not `Undecodable`.
    TooLargeToPrint,
    Undecodable,
    Unfinished,
    Fault {
        message: String,
    },
}

/// Whether the λ leg is there, why not when it is not, and how far its run has got.
///
/// `reason` IS THE PAYLOAD, which is why both legs answer a struct rather than an `Option`. A UI that
/// only knows a leg is missing has nothing to tell the user; "the λ backend refuses a closure that
/// assigns a captured variable" is the whole point of showing the pane at all. `node` is the Core node
/// the refusal names, so the source pane can highlight it. `run` is `None` exactly when the leg is
/// absent — there is no run to report on.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LambdaStatus {
    pub available: bool,
    pub reason: String,
    pub node: Option<NodeId>,
    pub run: Option<RunStatus>,
}

/// Whether the TM leg is there, the width it fitted, and how far its run has got.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
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
    ///
    /// **`ts(type = "number | null")`, NOT `ts(type = "number")` — AND THE DESIGN PRESCRIBED THE
    /// SECOND.** `ts-rs` maps `u64` to `bigint` unconditionally, which is not what the wire carries:
    /// `serde_wasm_bindgen` puts it across as a JS number, which
    /// `all_three_legs_agree_across_the_boundary` in `crates/redextape-wasm/tests/browser.rs`
    /// measures directly against a real browser. So an override is needed. But `ts(type = ...)`
    /// substitutes the WHOLE field type, `Option` and all, so the prescribed `ts(type = "number")`
    /// generates `total_steps: number` and silently drops the `| null` that `None` puts on the wire.
    /// `LambdaState::step` and `TmState::step` take that same override correctly, because they are
    /// bare `u64` with no `Option` around them.
    ///
    /// **NO RUST-SIDE GATE CAN SEE THE DROPPED `| null`.** `no_generated_type_carries_bigint` passes
    /// on `total_steps: number` — there is no `bigint` in it to find — and
    /// `the_gate_covers_every_exported_type` only checks which types derive `TS`, not what their
    /// fields say.
    ///
    /// **WHAT CAN CATCH IT IS `tsc`, AND ONLY WHILE `web/src/types.ts` TAKES `TmStatus` FROM
    /// `../bindings/`.** `tsconfig.json`'s `include` is `["src", "tests", "vite.config.ts"]`, so
    /// `web/bindings/TmStatus.ts` enters the TypeScript program at all only through that import.
    ///
    /// **NO PRODUCTION SOURCE FILE CATCHES THIS.** `resultRows` in `web/src/results.ts` reads
    /// `total_steps` and narrows it on `!== null`, and that narrowing compiles clean against the wrong
    /// type — a `number` compared against `null` is not an error TypeScript reports here. What catches
    /// it is three TEST FIXTURES that assign a literal `null` to the field, and nothing else. So the
    /// check exists only because tests happen to construct a `TmStatus` with `total_steps: null` in it;
    /// a refactor that stopped doing so would remove the last thing watching this class, with no other
    /// signal that anything had changed.
    ///
    /// **MEASURED, AT THE COMMIT THAT ADDED THESE DERIVES AND BEFORE `web/src/types.ts` CONSUMED THE
    /// GENERATED FILES: UNDER EXACTLY THIS SABOTAGE, BOTH RUST GATES PASSED AND `pnpm run typecheck`
    /// EXITED 0.** `TmStatus` was still hand-declared there, so nothing imported
    /// `web/bindings/TmStatus.ts` and `tsc` never opened it — the condition above did not hold, and
    /// there was nothing watching to catch it.
    ///
    /// **MEASURED AGAIN, AT THE COMMIT THAT MAKES `web/src/types.ts` THE BARREL: UNDER THE SAME
    /// SABOTAGE, THE RUST GATES STILL PASSED AND `pnpm run typecheck` NOW EXITED 1.** With the override
    /// changed to `ts(type = "number")` and `pnpm run build:bindings` re-run,
    /// `cargo nextest run -p redextape-wasm --features ts -E 'binary(ts_bindings)'` still reported
    /// `2 tests run: 2 passed` — neither Rust gate moved — but `tsc` reported three `TS2322` errors, one
    /// per call site assigning a literal `null` to the now-narrowed field: `replies.test.ts`'s
    /// `compiled` fixture, `results.test.ts`'s `TmLeg` fixture in `'shows the TM reason and no width
    /// when that backend declines'`, and `session-client.test.ts`'s `compiled` fixture, each
    /// `Type 'null' is not assignable to type 'number'.` Restoring
    /// `ts(type = "number | null")` and re-running `build:bindings` returns `pnpm run typecheck` to exit
    /// 0. The condition named above holds, on this tree, on this measurement: with the barrel importing
    /// `TmStatus` from `../bindings/`, `tsc` does refuse the dropped `| null`.
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
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
// `CodeMirror` is deliberately NOT backticked above: the sentence quotes
// docs/superpowers/specs/2026-08-06-wasm-boundary-completion-design.md §6.2 verbatim, and that
// source has no backtick. `clippy --fix` added one and it was reverted — a quotation has to match
// what it cites. The allow keeps `doc_markdown` from re-adding it.
#[allow(clippy::doc_markdown)]
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
    /// The INITIAL lowered term, kept so `link_index` can print step 0 after the cursor has moved.
    ///
    /// ONE `Rc` BUMP, NOT A COPY. `LambdaTerm` is `Rc`-backed and persistent, so retaining the root
    /// costs a refcount. The alternative is re-lowering inside `link_index`, which would do the whole
    /// lowering again on a path the worker calls immediately after compile — and would risk answering
    /// from a lowering that is not the one the cursor is walking.
    ///
    /// `None` exactly when `lambda` is `Err`: a backend that declined produced no term.
    pub(crate) initial_lambda: Option<LambdaTerm>,
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
    ///
    /// **THE HEADER JOINS THE PAIR RATHER THAN SITTING BESIDE IT AS A FOURTH `Option` FIELD, FOR THE
    /// REASON THE PARAGRAPHS ABOVE GIVE FOR THE PAIR ITSELF.** A header exists exactly when this
    /// `Result` is `Ok` — `compile` reads it off `run_tm_described`, which always produces one on a
    /// non-declining arm — so an `Option<TmHeader>` next to this field could spell "an available leg
    /// with no header", a state no program can reach and every reader would have to handle. It is
    /// retained because `tm_text` needs it: `print_tm` without a header reparses to a machine running
    /// from blank tapes at `MIN_FIELD_WIDTH` instead of from this program's input. Cost is
    /// O(tapes x width), not O(states).
    pub(crate) tm: Result<(TmProgram, TmCursor<Rc<Machine>>, tm::TmHeader), TmDecline>,
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
///
/// `header` BY REFERENCE: both uses (`init`, `.width`) only ever read it, and both call sites still own
/// their `TmHeader` afterward — there is nothing here for taking it by value to buy.
///
/// **STILL `&TmHeader` AND NOT `Option<&TmHeader>`, WHICH IS THE OPPOSITE CALL FROM THE ONE `window`
/// TOOK IN T1, AND DELIBERATELY SO.** `TmScratch` also has to build a leg and may have no header
/// (§3.4), so widening this would let both callers share one function. It is not widened, because
/// `source_node: None` was ALREADY reachable on the `Session` path and "blank tapes at
/// `MIN_FIELD_WIDTH`" is not: `compile` reads its header off `run_tm_described`, which always
/// produces one, so a `None` here would be a state no `Session` can reach and every `Session` could
/// spell. Widening would put decision 6's invented width and invented tapes one accidental `None`
/// away from a compiled program. The shared part is factored into `tm_leg_at` instead, which knows
/// nothing about headers.
fn build_tm_leg(header: &tm::TmHeader, machine: Machine, caps: tm::TmCaps) -> (TmProgram, TmCursor<Rc<Machine>>) {
    let init = header.init(machine.tapes);
    tm_leg_at(machine, header.width, &init, caps)
}

/// Project a machine and open a cursor on it at an explicit `width` and initial configuration — the
/// part of building a TM leg that has nothing to do with where those two came from.
///
/// EXTRACTED SO THERE IS ONE PROJECTION SITE, not two. `build_tm_leg` (above) derives `width`/`init`
/// from a `TmHeader`; `tm_scratch` derives them from a header or, absent one, from §3.4's defaults.
/// Both then do the same three things, and the `Rc` sharing between the projection and the cursor is
/// exactly the detail that would rot if it were written twice.
fn tm_leg_at(
    machine: Machine,
    width: usize,
    init: &[Vec<Symbol>],
    caps: tm::TmCaps,
) -> (TmProgram, TmCursor<Rc<Machine>>) {
    let machine = Rc::new(machine);
    // `TmProgram` is projected ONCE, here, and cached — never per step. The `map` demo is 3,203 states
    // over 344,999 steps; re-projecting per `tmState` is the cost the `TmProgram`/`TmState` split
    // exists to avoid.
    let program = TmProgram::of(&machine, width);
    let cursor = TmCursor::new(Rc::clone(&machine), init, caps);
    (program, cursor)
}

/// Where a λ cursor's run stands, as the four-state `RunStatus` a renderer switches on.
///
/// **THE ONE PLACE THIS MAPPING LIVES**, because §3.3 puts the whole λ leg on `LambdaScratch`
/// unchanged and a transplant that copies the mapping is a second chance to get it wrong. The wrong
/// way is specific and known: folding `DepthRefused` back into `Capped`, which puts a "continue"
/// affordance on the one run that provably cannot continue — see `RunStatus`'s own doc and
/// `LambdaCursor::raise_cap`'s refusal to clear the depth latch.
///
/// `depth_capped` is what separates the two: the cursor latches `HitCap` for both producers, and only
/// the step cap can be raised out of.
fn lambda_run_status(c: &LambdaCursor) -> RunStatus {
    match c.status() {
        None => RunStatus::Running,
        Some(lambda::Status::Normalized) => RunStatus::Ended,
        Some(lambda::Status::HitCap) if c.depth_capped() => RunStatus::DepthRefused,
        Some(lambda::Status::HitCap) => RunStatus::Capped,
    }
}

/// Advance `c` up to `budget` β-steps, then report where the run stands. The shared body of
/// `Session::run_lambda` and `LambdaScratch::run_lambda`; the two differ only in how they reach a
/// cursor, and `Session::run_lambda`'s doc carries the argument for why this is chunked at all.
///
/// **A SPENT `budget` LEAVES THE RUN `Running`, AND THAT FALLS OUT OF THE LOOP RATHER THAN BEING
/// ASSERTED.** Nothing here writes a status: the answer comes from `lambda_run_status` reading the
/// cursor afterwards, and a cursor whose own cap is untouched reports `Running` however many chunks
/// have been spent against it. Folding the two together is the defect `RunStatus` was introduced to
/// prevent one layer in.
fn run_lambda_cursor(c: &mut LambdaCursor, budget: u64) -> RunStatus {
    for _ in 0..budget {
        if c.next().is_none() {
            break;
        }
    }
    lambda_run_status(c)
}

/// A `Value` already in hand — decoded or freshly evaluated — printed through the CAPPED printer.
/// **THE ONE PLACE ANY OF THE THREE PRODUCERS (`decoded_of`, `lambda_value`, `tm_value`) TURNS A
/// `Value` INTO EITHER `Decoded::Value` OR `Decoded::TooLargeToPrint`.**
///
/// **THIS IS THE FIX, AND EVERY CALLER MUST GO THROUGH IT RATHER THAN `format_value` DIRECTLY.** All
/// three producers are `#[wasm_bindgen]`-reachable from an ordinary user-typed program (`evaluate`,
/// `evaluateWithBudget`, `lambdaValue`, `tmValue`), and `format_value` is an uncapped tree walk over a
/// `Value` whose printed size is its LOGICAL size once a decoder memoizes sharing — `tm_value`'s own
/// decode (`tm::decode_tape_ty`) is the exact function this branch made sharing-aware, and a
/// `tails`-shaped program that used to be refused around the decode budget now decodes in ~192,000
/// nodes and would hand the uncapped printer a walk of billions. See `redextape_core::value::
/// MAX_PRINT_NODES`'s doc and `redextape-cli/src/run.rs`'s five capped print sites for the same fix on
/// the CLI's own side of this hazard.
fn decoded_value(v: &redextape_core::value::Value) -> Decoded {
    match redextape_core::value::format_value_capped(v, redextape_core::value::MAX_PRINT_NODES) {
        Some(text) => Decoded::Value { text },
        None => Decoded::TooLargeToPrint,
    }
}

/// `decode_lambda_ty`/`decode_tape_ty`'s `Option<Value>` answer, turned into a `Decoded` — the shared
/// "decode answered, print-or-refuse" step for `lambda_value` and `tm_value`. Extracted (mirroring
/// `redextape-cli/src/run.rs`'s `report_tm_decode`/`report_asm_decode`) so a test can drive the
/// too-large-to-print refusal directly from a fixture `Value`, without an actual reduction or
/// simulation that could build the shared DAG itself — forbidden by this task's own safety note.
fn decoded_or_undecodable(v: Option<redextape_core::value::Value>) -> Decoded {
    match v {
        Some(v) => decoded_value(&v),
        None => Decoded::Undecodable,
    }
}

/// The ONE place an interpreter run becomes a `Decoded`. `evaluate` and `evaluate_with_budget` differ
/// only in the budget they pass, so they must not be able to differ in the shape they answer with.
fn decoded_of(run: Result<redextape_core::value::Value, redextape_core::interp::RuntimeError>) -> Decoded {
    match run {
        Ok(v) => decoded_value(&v),
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
        // MIRRORS `analyze`'s OWN GATE, so the two paths cannot disagree about which programs get
        // linted: a program with no error-severity diagnostic — parse succeeded and `typecheck` above
        // added none — runs lints exactly once, here, before any of the fallible steps below get a
        // chance to add more diagnostics of their own. A warning is not a blocker: `session` is still
        // built past this point, unlike the early return above.
        diagnostics.extend(lints::check(&program));
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

        let (lambda, initial_lambda) = match lambda::lower(&core) {
            Ok(t) => (Ok(LambdaCursor::new(&t, lambda::MAX_REDUCTION_STEPS)), Some(t)),
            Err(e) => (Err(e), None),
        };

        // `run_tm_described` ERRS ONLY FOR A PROGRAM THAT NEVER RAN. It has TWO fallible calls, not
        // one: `lower_and_size` (the three pre-checked layout refusals, `Err(LowerError)` or
        // `Err(TooLarge)`) and `attempt`'s `Option` (the fourth — the state ceiling, only knowable once
        // that width's gadgets are built — folded into `Err(TooLarge)` the same way). Between them,
        // `Err` carries `LowerError` or `TooLarge` and nothing else. `Overflow` is NOT an `Err` —
        // reaching `MAX_FIELD_WIDTH` and still overflowing returns `Ok` with `run: TmRun::Overflow` and
        // a machine attached — so the decline for it is read off `d.run`, which is why this is two
        // matches and not one.
        let described = tm::run_tm_described(&core, kind, ty.clone(), caps);
        // Read off the `Ok` BEFORE the match consumes it, so every run that STARTED reports its own
        // count — including `Overflow` and `TooLarge` arriving inside an `Ok`, which decline the leg
        // and still ran. See the field's doc for where a declined leg's length is withheld.
        let total_steps = described.as_ref().ok().map(|d| d.steps);
        let tm = match described {
            Err(TmRun::TooLarge) => Err(TmDecline::TooLarge),
            Err(TmRun::LowerError(e)) => Err(TmDecline::Lower(format!("{e:?}"))),
            // `run_tm_described`'s `Err` is only ever `LowerError` or `TooLarge` — both matched above —
            // so this arm is unreachable today. That rests on two facts now, not one: `lower_and_size`
            // produces no other `Err`, AND `attempt`'s `None` (the state-ceiling refusal) is folded
            // into `TooLarge` rather than surfacing as a distinct variant. It is a mapping rather than
            // an `unreachable!()` because that macro is a panic, and a panic under wasm aborts the
            // module; a future `Err` variant becomes a legible decline instead.
            Err(other) => Err(TmDecline::Lower(format!("{other:?}"))),
            Ok(d) => match d.run {
                TmRun::Overflow => Err(TmDecline::Overflow),
                TmRun::TooLarge => Err(TmDecline::TooLarge),
                TmRun::LowerError(e) => Err(TmDecline::Lower(format!("{e:?}"))),
                // `Ran` and `HitCap` BOTH yield a working cursor, and that is the point of the split:
                // a run that spent its budget is resumable through `raise_tm_cap`, so flattening it
                // into a decline would throw away a session the user can still drive.
                TmRun::Ran { tapes } => {
                    let (p, c) = build_tm_leg(&d.header, d.machine, caps);
                    Ok(((p, c, d.header), Some(tapes)))
                }
                TmRun::HitCap => {
                    let (p, c) = build_tm_leg(&d.header, d.machine, caps);
                    Ok(((p, c, d.header), None))
                }
            },
        };

        // The LEG stays paired; only the final tapes are split off, because they are genuinely a
        // separate fact — `Ran` has them and `HitCap` does not, while both build the same leg.
        let (tm, final_tapes) = match tm {
            Ok((leg, t)) => (Ok(leg), t),
            Err(d) => (Err(d), None),
        };

        Compiled {
            diagnostics,
            session: Some(Session { core, ty, lambda, initial_lambda, tm, map, final_tapes, kind, total_steps }),
        }
    }

    // --- the λ leg ----------------------------------------------------------------------------

    pub fn lambda_status(&self) -> LambdaStatus {
        match &self.lambda {
            Ok(c) => {
                LambdaStatus { available: true, reason: String::new(), node: None, run: Some(lambda_run_status(c)) }
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
    /// **NO LONGER RE-READS `lambda_status()` FOR ITS ANSWER, AND THAT DELETED AN UNREACHABLE
    /// FALLBACK.** It used to end `self.lambda_status().run.unwrap_or(RunStatus::Running)` — `run` is
    /// `None` only for an absent leg, which the `?` above has already ruled out, so the `unwrap_or` was
    /// a branch no input could take, written that way only because unwrapping is a panic and a panic
    /// under wasm aborts the module. `run_lambda_cursor` answers a bare `RunStatus` off the cursor it
    /// was handed, so there is no `Option` to unwrap and no unreachable arm to justify. Same values,
    /// one fewer state spellable — the shape argument the `tm` field's own doc makes.
    pub fn run_lambda(&mut self, budget: u64) -> Result<RunStatus, SessionError> {
        let c = self.lambda.as_mut().map_err(|_| SessionError::LambdaAbsent)?;
        Ok(run_lambda_cursor(c, budget))
    }

    /// `LambdaState::render(cursor, byte_budget, depth_cap)` and nothing else — PR 2 removed the map and redex
    /// PARAMETERS along with the `source_node` field they existed to compute. Still three arguments today: the
    /// `redex`/`redex_span`/`owner` fields 5c added to the returned `LambdaState` are all read off the cursor
    /// inside `render`, so nothing had to come back in here.
    pub fn lambda_state(&self, byte_budget: usize) -> Result<LambdaState, SessionError> {
        let c = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
        Ok(LambdaState::render(c, byte_budget, MAX_PRINT_DEPTH))
    }

    /// The term as a flat tree, or `None` when it exceeds `node_budget` — `None` rather than a partial
    /// tree, because a truncated AST is a lie about the term's shape.
    ///
    /// The payload is an ARENA (`TermTree`), not a tree of boxes, so neither serializing it across the
    /// boundary nor dropping it afterwards recurses. See `viewmodel::TermTree`.
    pub fn lambda_ast(&self, node_budget: usize) -> Result<Option<TermTree>, SessionError> {
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
    ///
    /// `TooLargeToPrint` IS A THIRD OUTCOME, DISTINCT FROM BOTH: `decode_lambda_ty` answered
    /// `Some(v)` — the decode succeeded — and only `decoded_value`'s capped print refused, because
    /// `v`'s logical size exceeds `MAX_PRINT_NODES`. See `Decoded`'s own doc.
    pub fn lambda_value(&self) -> Result<Decoded, SessionError> {
        let c = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
        if self.lambda_status().run != Some(RunStatus::Ended) {
            return Ok(Decoded::Unfinished);
        }
        Ok(decoded_or_undecodable(lambda::decode_lambda_ty(c.term(), &self.ty)))
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
            Ok((p, c, _)) => {
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
        let (p, _, _) = self.tm.as_ref().map_err(|_| SessionError::TmAbsent)?;
        Ok(p.clone())
    }

    /// This session's machine as `.tm` text, or `None` for a declined leg.
    ///
    /// **UNCONDITIONAL ON SIZE.** Asked, it prints, however many rules the machine has — `list60` is
    /// 94,182 of them (127,881 is the δ-table's ROW count, states plus rules; see `protocol.ts`'s
    /// `ruleCount`) and about 7.8 MB of text. The size decision belongs to the caller and lives in
    /// `protocol.ts`'s `forkable`, for the reason that module's own constant records: the app needs the
    /// rule count to WORD its refusal as well as to make it, so a threshold here would be a second home
    /// for one number.
    ///
    /// `print_tm_with` AND NOT `print_tm`: without the header the text reparses to a machine running
    /// from blank tapes at `MIN_FIELD_WIDTH`, which is decision 6's state and is not this machine.
    pub fn tm_text(&self) -> Option<String> {
        let (_, cursor, header) = self.tm.as_ref().ok()?;
        Some(tm::print_tm_with(cursor.machine(), header))
    }

    /// Advance one δ-step. `false` once the run has halted or hit a cap — `tm_status().run` says
    /// which, and is the only thing that can.
    pub fn step_tm(&mut self) -> Result<bool, SessionError> {
        let (_, c, _) = self.tm.as_mut().map_err(|_| SessionError::TmAbsent)?;
        Ok(c.next().is_some())
    }

    pub fn tm_state(&self, radius: usize) -> Result<TmState, SessionError> {
        let (_, c, _) = self.tm.as_ref().map_err(|_| SessionError::TmAbsent)?;
        Ok(TmState::window(c, Some(&self.map), radius))
    }

    /// Cells `from..to` of tape `tape`, in the same materialized coordinates `tm_state` reports its
    /// `heads` and `window_start` in — so a scrolling renderer can relate the two.
    ///
    /// `get`, NEVER `[]`: an absent tape answers `Err` rather than indexing out of bounds. `from`/`to`
    /// need no such guard because `Tape::slice` clamps both.
    pub fn tape_slice(&self, tape: usize, from: usize, to: usize) -> Result<Vec<Symbol>, SessionError> {
        let (_, c, _) = self.tm.as_ref().map_err(|_| SessionError::TmAbsent)?;
        let tapes = c.tapes();
        let t = tapes.get(tape).ok_or(SessionError::NoSuchTape { tape, tapes: tapes.len() })?;
        Ok(t.slice(from, to))
    }

    /// Extend a capped run's budget. Additive and saturating, like the λ leg's.
    pub fn raise_tm_cap(&mut self, extra_steps: u64, extra_cells: u64) -> Result<(), SessionError> {
        let (_, c, _) = self.tm.as_mut().map_err(|_| SessionError::TmAbsent)?;
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
    /// `TooLargeToPrint` IS A REAL OUTCOME TOO: `decode_tape_ty` answered `Some(v)` and only
    /// `decoded_value`'s capped print refused — `decode_tape_ty` is the exact function this branch
    /// memoized, so a `tails`-shaped program reaches this at ~4,471 elements, far below any run cap.
    ///
    /// **THE `HitCap` THAT PUTS IT THERE HAS TWO PRODUCERS, NOT ONE.** `TmCursor` caps on the step
    /// budget and on the live-CELL budget, and `trace.rs` says outright that no test can tell those two
    /// apart. Under the second, `total_steps` is the count reached when cells ran out — well below
    /// `caps.steps` — so a reader must not take a capped run's length as evidence of which wall it hit.
    pub fn tm_value(&self) -> Result<Decoded, SessionError> {
        let (_, cursor, _) = self.tm.as_ref().map_err(|_| SessionError::TmAbsent)?;
        let tapes: &[Tape] = match &self.final_tapes {
            Some(t) => t,
            None if cursor.status() == Some(tm::TmStatus::Halted) => cursor.tapes(),
            None => return Ok(Decoded::Unfinished),
        };
        let enc = self.kind.at(tm::MIN_FIELD_WIDTH);
        Ok(decoded_or_undecodable(tm::decode_tape_ty(tapes, &self.ty, &*enc)))
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
    ///
    /// **CAN ANSWER `Decoded::TooLargeToPrint`, THE SAME AS THE TWO DECODED LEGS.** `Builtin::Tail` is
    /// `Ok((**t).clone())` — an `Rc` clone, O(1), no allocation — structurally the same sharing
    /// mechanism `Instr::Tail` uses on the asm heap, so an ordinary non-recursive `tails`-style program
    /// builds an `m`-suffix shared `Value` in O(m) interpreter steps, and `decoded_value` refuses to
    /// print it past `MAX_PRINT_NODES` rather than handing it to the uncapped `format_value`.
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
    /// have needed a `Decoded` state of its own for something the interpreter itself does not
    /// distinguish.
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

    /// Everything a renderer needs to link one construct across three panes, for THIS compile.
    ///
    /// BUILT ON DEMAND RATHER THAN CACHED, and called once per compile by the worker. Caching it
    /// would pay the print for every program including the ones nobody clicks into, and the caller
    /// already knows how often it wants one.
    ///
    /// INFALLIBLE. Both halves are optional and `LinkIndex::build` is total over either absence, so a
    /// declined leg yields an empty leg rather than an error — the same shape `SourceMap::build`
    /// already has. There is nothing here for a caller to handle.
    pub fn link_index(&self, byte_budget: usize) -> LinkIndex {
        let program = self.tm.as_ref().ok().map(|(p, _, _)| p);
        LinkIndex::build(self.initial_lambda.as_ref(), program, &self.map, byte_budget, MAX_PRINT_DEPTH)
    }
}

// --- the scratchpads --------------------------------------------------------------------------

/// What a scratchpad constructor answers: the thing, or the diagnostics saying why not.
///
/// **THE SAME SHAPE AS `Compiled`, AND GENERIC RATHER THAN WRITTEN TWICE.** Both scratch parsers
/// (`lambda::parse_lambda`, `tm::parse_tm_full`) return a value alongside diagnostics, so both
/// constructors answer the same pair; `Compiled` stays its own struct only because its payload field
/// is named `session` and nothing is gained by renaming it. See the design's §4.1.
///
/// **A `None` HERE IS "THE TEXT DID NOT PARSE", NOT "A BACKEND DECLINED"** — the distinction `Compiled`
/// draws in the other direction. A `Session` with both legs declined is still a session, because
/// declining is a backend's answer about a program; a scratchpad IS its parsed artifact, so text that
/// does not parse leaves nothing to hold.
pub struct Scratched<T> {
    pub diagnostics: Vec<Diagnostic>,
    pub scratch: Option<T>,
}

/// A λ term typed straight into a pane: **a `LambdaCursor`, and nothing else** (design §4.1).
///
/// **NO `ty`, SO NO `lambda_value`.** Decoding is type-directed — `decode_lambda_ty(nf, &ty)` — and λ
/// text carries no result type (`lambda/syntax.rs`'s module doc: `\a.\b. b` is `false` and `church(0)`
/// at once). So the method is not merely unavailable here, there is nothing to decode *against*, which
/// is decision 2 stated precisely: a method that needs a `ty` DOES NOT EXIST on a scratch rather than
/// being available-and-declining. `tests/browser.rs` pins that absence at compile time.
///
/// **NO `initial_lambda`, AND CHECKING WHY IS WHAT CORRECTED THE FIRST DRAFT OF THE DESIGN.** That
/// field's doc on `Session` says it is kept "so `link_index` can print step 0 after the cursor has
/// moved", and `link_index` is its only consumer in this file. §3.3 puts `linkIndex` off both scratch
/// types — it needs a `SourceMap` as well, and a scratch has none — so the field would be retained for
/// nobody. `lambda_state` prints from the cursor, not from it. A first draft added it anyway "for the
/// same `Rc`-bump reason as `Session`", which is a reason to keep a field cheap, not a reason to have
/// one.
///
/// **NO `SourceMap` EITHER, WHICH IS WHAT DETACHED MEANS.** `sourceSpan` and `linkIndex` are the two
/// linking affordances 5b and 5c built, and neither exists here — see §4.5 for why that has to be said
/// out loud in the UI rather than merely being true.
pub struct LambdaScratch {
    lambda: LambdaCursor,
}

/// Build a λ scratchpad from λ TEXT — not from source, and not from a `Session`.
///
/// A FREE FUNCTION BESIDE `compile`, because there is no compilation step to hang it off: §4.1's
/// scratchpads are built from text a user typed, so the front end (parse, typecheck, desugar, lower)
/// never runs and there is no `Core`, no `Ty` and no `SourceMap` to produce.
///
/// **THE CAP IS `MAX_REDUCTION_STEPS`, THE SAME ONE `compile_with_caps` HANDS `LambdaCursor::new`.** A
/// scratch reduces the same reducer under the same guard; a different number here would make the same
/// term reach `Capped` at two different step counts depending only on which pane it was typed into.
///
/// `parse_lambda` answers `(Option<LambdaTerm>, Vec<Diagnostic>)` and its `None` is always accompanied
/// by a diagnostic, so this cannot produce a silent empty answer.
pub fn lambda_scratch(src: &str) -> Scratched<LambdaScratch> {
    let (term, diagnostics) = lambda::parse_lambda(src);
    let scratch = term.map(|t| LambdaScratch { lambda: LambdaCursor::new(&t, lambda::MAX_REDUCTION_STEPS) });
    Scratched { diagnostics, scratch }
}

/// A λ scratchpad forked from step `step` of `src`, **and the text that built it**.
///
/// A THIRD FIELD RATHER THAN `Scratched<LambdaScratch>`, because the caller needs the string. Design
/// §4.1: the editor is seeded from the same text that created the scratch rather than from a second
/// print that could disagree with it, and a `Scratched` has no room to say what that was.
///
/// **`text` IS `None` FOR EXACTLY THE CASES `scratch` IS**, which is one fact rather than two: no
/// scratch was built, so there is no string that built one. A non-null text beside a null scratch
/// would be a fourth state for a renderer to switch on — the redundancy `protocol.ts`'s
/// `scratch-compiled` doc already refused for a `no-scratch` variant.
pub struct ForkedAt {
    pub diagnostics: Vec<Diagnostic>,
    pub scratch: Option<LambdaScratch>,
    pub text: Option<String>,
}

/// Fork a λ scratchpad from **step `step`** of `src`, printing the forked term at `byte_budget`.
///
/// **TWO REDUCTIONS IN ONE CALL, AND THE SECOND PARSE IS THE POINT RATHER THAN THE PRICE** (design
/// §4.1). `lambda_scratch` builds from λ TEXT, so for the fork's step 0 to BE the term that was on
/// screen, that term's text has to exist. It does not: history frames print at 512 bytes and the
/// full-fidelity print exists only at step 0, in the `compiled` reply. Re-deriving it here and then
/// building the scratch from the derived string is what makes the editor's contents, the scratch's
/// step 0, and the term the user was looking at one object instead of three that agree until they do
/// not — and it puts the whole path through `lambda/syntax.rs`'s round-trip guarantee.
///
/// **`step` IS CLAMPED BY THE REDUCTION, NOT VALIDATED.** `step_lambda` answers `false` at the normal
/// form, so a step past the end lands on the normal form. A history's step count and a fresh
/// reduction's cannot disagree today, but a caller is a pane and a pane is not a proof.
///
/// **A CUT REFUSES THE FORK, AND THAT IS §4.1's MOVED REFUSAL RATHER THAN A NEW ONE.** `detachButton`
/// already declines a truncated 512-byte frame because a `Bytes` cut is a prefix that will not parse
/// and a `Depth` cut is not even a prefix. At `byte_budget` the same hazard is 128x further out, not
/// gone, so the same refusal applies with a message a pane can show.
#[must_use]
pub fn lambda_scratch_at(src: &str, step: u32, byte_budget: usize) -> ForkedAt {
    let Scratched { diagnostics, scratch } = lambda_scratch(src);
    let Some(mut tmp) = scratch else {
        return ForkedAt { diagnostics, scratch: None, text: None };
    };
    for _ in 0..step {
        if !tmp.step_lambda() {
            break;
        }
    }
    let state = tmp.lambda_state(byte_budget);
    if state.cut.is_some() {
        // A ZERO-WIDTH SPAN AT THE ORIGIN, because this diagnostic is about the TERM and not about a
        // location in the text the user typed — there is no offset in `src` that names "the result of
        // reducing this 40,000 times is too big to print".
        return ForkedAt {
            diagnostics: vec![Diagnostic::error(
                Span { start: 0, end: 0 },
                "the term at this step is too large to fork — scrub to an earlier step",
            )],
            scratch: None,
            text: None,
        };
    }
    let Scratched { diagnostics: reparse_diagnostics, scratch } = lambda_scratch(&state.text);
    // `text` FOLLOWS `scratch`, never independently. The second parse can still fail — a printed term
    // that does not re-parse would be a round-trip bug in `lambda/syntax.rs` rather than a user error,
    // and reporting a text that built nothing would hide it behind a seeded editor.
    let text = scratch.is_some().then_some(state.text);
    ForkedAt { diagnostics: reparse_diagnostics, scratch, text }
}

impl LambdaScratch {
    /// **`available` IS ALWAYS `true` AND `reason` IS ALWAYS EMPTY, AND THAT IS NOT A FABRICATION.**
    /// A `LambdaScratch` exists only for text that parsed, so the leg genuinely is there and there
    /// genuinely is nothing to explain — degenerate values that are TRUE, unlike the `total_steps` a
    /// `TmScratch` would have to invent (see `TmScratch::tm_status`, and the `tm` field's doc on what
    /// fabricating a status for an unreachable state cost this file once already).
    ///
    /// The struct is shared with `Session` rather than narrowed so one renderer can read either kind of
    /// session's λ leg through one shape; `run` is the field it actually switches on.
    pub fn lambda_status(&self) -> LambdaStatus {
        LambdaStatus { available: true, reason: String::new(), node: None, run: Some(lambda_run_status(&self.lambda)) }
    }

    /// Advance one β-step. `false` once the run has ended — `lambda_status().run` says which.
    ///
    /// **NO `Result`, AND THE DIFFERENCE FROM `Session::step_lambda` IS THE POINT.** There is the
    /// `SessionError::LambdaAbsent` a `Session` can answer, and there is no state of this type that
    /// could produce it: the cursor is not a `Result` here, so a "leg absent" error would be a variant
    /// no input can reach — exactly the shape the `tm` field's doc records as costly. The JS-facing
    /// type is unchanged either way (`Result<bool, JsValue>` and `bool` both cross as `boolean`), so
    /// nothing on the TypeScript side pays for this.
    pub fn step_lambda(&mut self) -> bool {
        self.lambda.next().is_some()
    }

    /// Advance up to `budget` β-steps, then report how the run stands. Chunked for the reason
    /// `Session::run_lambda`'s doc gives — a five-million-step call blocks the thread with no progress
    /// and no cancellation — and through the same shared loop, so the two cannot drift.
    pub fn run_lambda(&mut self, budget: u64) -> RunStatus {
        run_lambda_cursor(&mut self.lambda, budget)
    }

    /// The current term, printed at `byte_budget` under the boundary's `MAX_PRINT_DEPTH`.
    ///
    /// THE DEPTH CAP IS NOT NEGOTIABLE PER SESSION KIND. It is a fact about a Web Worker's call stack
    /// (see `MAX_PRINT_DEPTH`), and a scratch prints through the same worker; a scratch that printed
    /// deeper would poison the module the same way.
    pub fn lambda_state(&self, byte_budget: usize) -> LambdaState {
        LambdaState::render(&self.lambda, byte_budget, MAX_PRINT_DEPTH)
    }

    /// The term as a flat arena, or `None` over `node_budget` — never a partial tree.
    pub fn lambda_ast(&self, node_budget: usize) -> Option<TermTree> {
        LambdaState::ast(&self.lambda, node_budget)
    }

    /// Extend a capped run's budget. Additive and saturating; clears `HitCap` only when the STEP CAP
    /// produced it, never the depth guard.
    pub fn raise_lambda_cap(&mut self, extra: u64) {
        self.lambda.raise_cap(extra);
    }

    /// Rebuild the cursor with a small cap, so a test has something to raise from. TEST-ONLY, for the
    /// reason `Session::cap_lambda_at` records: there is no product reason to lower a budget, and
    /// `MAX_REDUCTION_STEPS` is 5,000,000, so `Capped` is otherwise only reachable by actually spending
    /// five million β-steps on a divergent term.
    #[cfg(test)]
    fn cap_lambda_at(&mut self, cap: u64) {
        self.lambda = LambdaCursor::new(self.lambda.term(), cap);
    }
}

/// Where a `TmScratch`'s machine stands. **NOT `TmStatus`, AND THE DIFFERENCE IS THIS TASK'S TRAP.**
///
/// `TmStatus::total_steps` is "how long the WHOLE run is, in δ-steps, from the run `compile`
/// performed" — it comes from `run_tm_described`, and a scratch is never described-run. It is
/// *stepped*. So there is no such total to report, and the two candidate ways to report one anyway are
/// both worse than not having the field: `Some(0)` is a lie a progress bar would render as "step 40 of
/// 0", and `None` beside `available: true` is a shape `TmStatus`'s own doc reserves for a DECLINED
/// leg. The `tm` field's doc records at length what the last fabricated-status-for-an-unreachable-state
/// cost this file; this type is that lesson applied before the fact.
///
/// The Rust side pins the field list by an exhaustive destructuring in this module's own tests
/// (`let TmScratchStatus { available, reason, width, run, header } = sc.tm_status();`), so a sixth
/// field added here fails to compile there with `E0027` rather than merely going unrendered.
///
/// **`width` AND `run` ARE NOT `Option`, WHICH IS THE SAME ARGUMENT IN THE OTHER DIRECTION.** They are
/// optional on `TmStatus` because a `Session`'s TM backend can decline; a `TmScratch` exists only for
/// text that parsed to a machine, so both are always answerable and an `Option` would be a state
/// nothing can produce.
///
/// **`available` AND `reason` ARE DEGENERATE AND KEPT ANYWAY**, because they are TRUE rather than
/// fabricated — the leg genuinely is there and there genuinely is nothing to explain — and because one
/// renderer reads a status off either session kind. That is the same call `LambdaScratch::lambda_status`
/// makes; `total_steps` is different in kind, not merely in degeneracy, which is why it is absent
/// rather than constant.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TmScratchStatus {
    pub available: bool,
    pub reason: String,
    /// The field width the machine's encoding uses. **INVENTED WHEN `header` IS `false`** — see that
    /// field.
    pub width: usize,
    /// Where the CURSOR stands. `Ended` for a halted machine, `Capped` for one that spent its budget,
    /// `Running` otherwise. `DepthRefused` is λ-only and unreachable here: there is no term to recurse
    /// over, which is the same asymmetry `Session::tm_status` notes.
    pub run: RunStatus,
    /// Whether the text carried a header at all.
    ///
    /// **`false` MEANS THE PANE IS SHOWING SOMETHING THE FILE DID NOT SAY, AND MUST SAY SO** — design
    /// decision 6, where "and the pane says so" is load-bearing rather than decoration. A headerless
    /// `.tm` file records δ and the start state and nothing about an initial configuration, so the
    /// `width` above and the blank tapes the cursor started on were both chosen by this boundary. This
    /// field is the only thing that lets a renderer distinguish that from a file that asked for exactly
    /// those values.
    pub header: bool,
}

/// A Turing machine typed straight into a pane: the projected program, the cursor walking it, and the
/// header the text carried — **if it carried one** (design §4.1).
///
/// **NO `ty`, SO NO `tm_value`.** `Session::tm_value` reads `self.ty`, `self.final_tapes` and
/// `self.kind`; decoding is type-directed and TM text carries a `result` type only inside a header,
/// which may be absent, and there is no compile-time run to have recorded final tapes from. Decision
/// 2: the method does not exist rather than existing and declining. `tests/browser.rs` pins that at
/// compile time.
///
/// **NO `SourceMap`, WHICH IS WHY T1 HAPPENED.** `tm_state` is the method a TM pane renders from every
/// frame, and it needed a map. `TmState::window` now takes `Option<&SourceMap>` and this passes `None`,
/// so `source_node` is `None` on exactly the leg where a Core node would be meaningless — see §3.1 and
/// that function's own doc.
///
/// **`Option<TmHeader>` AND THAT `None` IS NOT AN ERROR.** `parse_tm_full` already answers
/// `Option<TmHeader>` and explicitly does not treat absence as a failure (`HeaderParts::finish`).
/// Decision 6 is what `None` MEANS at the pane, and `tm_status().header` is how the pane learns it.
pub struct TmScratch {
    program: TmProgram,
    cursor: TmCursor<Rc<Machine>>,
    /// Kept whole rather than reduced to the `width` the cursor already runs at, because the pane has
    /// more than one question for it — `result`, `encoding` and the literal `tape` lines are all in
    /// here — and because `tm_status().header` is a fact about the FILE, not about the width.
    header: Option<tm::TmHeader>,
}

/// Build a TM scratchpad from TM TEXT — the `.tm` form, not asm and not source.
///
/// **A HEADERLESS FILE RUNS FROM BLANK TAPES AT `MIN_FIELD_WIDTH`, WHICH REVERSES AN EXPLICIT REFUSAL
/// ALREADY IN THE TREE.** `examples/tm_emit.rs`'s `run` declines exactly this file, on the grounds that
/// it "genuinely cannot be run without the caller supplying `init` by hand". That remains true, and the
/// difference is who is present: `tm_emit` is a batch tool with nobody to supply anything, and **a
/// scratchpad IS the caller supplying `init` by hand** — the user typed the machine into a pane and is
/// looking at it. Design §3.4 takes that decision deliberately rather than by drift, and `tm_emit`'s
/// own comment now names this path so the tree does not assert two opposite things about one
/// condition. Because the values are invented, `tm_status().header` reports `false` and the pane is
/// obliged to say so (decision 6).
///
/// `TM_DEFAULT_CAPS`, THE SAME BUDGET `compile` USES. `compile_with_caps` hands `build_tm_leg` the caps
/// the described run already spent, so its cursor and its reported outcome agree; a scratch has no
/// described run to agree with, so it takes the product default the boundary exposes no way to change.
pub fn tm_scratch(src: &str) -> Scratched<TmScratch> {
    tm_scratch_with_caps(src, tm::TM_DEFAULT_CAPS)
}

/// `tm_scratch` with the cursor's budget as a parameter rather than a constant.
///
/// PRIVATE, AND EVERY PRODUCT CALLER TAKES THE DEFAULT — the boundary exposes no way to choose, exactly
/// as `Session::compile_with_caps` does and for the identical reason: `TM_DEFAULT_CAPS` is 5,000,000
/// δ-steps, so the `Capped` state, and therefore everything `raise_tm_cap` exists for, is otherwise
/// only reachable by actually simulating five million steps. A test that cannot afford that is a test
/// that never runs. With a budget of three the same states are reached in microseconds, by the same
/// code, from the same text.
fn tm_scratch_with_caps(src: &str, caps: tm::TmCaps) -> Scratched<TmScratch> {
    let doc = tm::parse_tm_full(src);
    let header = doc.header;
    let scratch = doc.machine.map(|m| {
        let (program, cursor) = match &header {
            // The IDENTICAL function `compile` builds its leg with, not a copy of it — which is what
            // makes "a headered scratch matches the `Session` path" a property of one code path rather
            // than an agreement between two.
            Some(h) => build_tm_leg(h, m, caps),
            // BLANK TAPES, SPELLED AS AN EMPTY `init` RATHER THAN AS `vec![Vec::new(); m.tapes]`.
            // `TmCursor::new` reads `init.get(i)` and falls back to an empty slice per tape, so the two
            // are the same configuration — and it is also exactly what `TmHeader::init`
            // (`tm/header.rs`) yields for a header carrying no `tape` directives, which is the sense in
            // which decision 6's default is not a new kind of configuration, only a new way to reach
            // one.
            None => tm_leg_at(m, tm::MIN_FIELD_WIDTH, &[], caps),
        };
        TmScratch { program, cursor, header }
    });
    Scratched { diagnostics: doc.diagnostics, scratch }
}

impl TmScratch {
    /// See `TmScratchStatus` for why this is a different type from `TmStatus` rather than the same one
    /// with a hole in it.
    pub fn tm_status(&self) -> TmScratchStatus {
        // No depth guard on this leg — the machine has no term to recurse over — so `HitCap` has one
        // producer and `Capped` is unambiguous, exactly as in `Session::tm_status`.
        let run = match self.cursor.status() {
            None => RunStatus::Running,
            Some(tm::TmStatus::Halted) => RunStatus::Ended,
            Some(tm::TmStatus::HitCap) => RunStatus::Capped,
        };
        TmScratchStatus {
            available: true,
            reason: String::new(),
            width: self.program.width,
            run,
            header: self.header.is_some(),
        }
    }

    /// The cached projection, cloned — never a re-walk, for the reason `Session::tm_program` records.
    ///
    /// NO `Result`: there is no absent leg here for `SessionError::TmAbsent` to describe, so declaring
    /// one would put an unreachable throw on the boundary. Same call as `LambdaScratch::step_lambda`.
    pub fn tm_program(&self) -> TmProgram {
        self.program.clone()
    }

    /// Advance one δ-step. `false` once the run has halted or hit a cap — `tm_status().run` says which.
    pub fn step_tm(&mut self) -> bool {
        self.cursor.next().is_some()
    }

    /// **THE METHOD T1 EXISTED FOR.** `source_node` is `None` for every state this renders, because a
    /// scratch has no lowering that could have recorded an owner — which is what "detached" means at
    /// §4.5 and why the pane has to announce it rather than merely show nothing highlighted.
    pub fn tm_state(&self, radius: usize) -> TmState {
        TmState::window(&self.cursor, None, radius)
    }

    /// Cells `from..to` of tape `tape`, in the same materialized coordinates `tm_state` reports.
    ///
    /// **THE ONE SCRATCH METHOD THAT KEEPS ITS `Result`**, and the reason is that its error is
    /// reachable: `SessionError::NoSuchTape` is a caller naming a tape the machine does not have, which
    /// has nothing to do with whether a leg is present. `TmAbsent` is what a scratch cannot produce.
    ///
    /// # Errors
    ///
    /// Returns `Err(SessionError::NoSuchTape)` when `tape` is past the machine's tape count. `from`/`to`
    /// need no guard because `Tape::slice` clamps both.
    pub fn tape_slice(&self, tape: usize, from: usize, to: usize) -> Result<Vec<Symbol>, SessionError> {
        let tapes = self.cursor.tapes();
        let t = tapes.get(tape).ok_or(SessionError::NoSuchTape { tape, tapes: tapes.len() })?;
        Ok(t.slice(from, to))
    }

    /// Extend a capped run's budget. Additive and saturating, like every other cap raise here.
    pub fn raise_tm_cap(&mut self, extra_steps: u64, extra_cells: u64) {
        self.cursor.raise_cap(extra_steps, extra_cells);
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

    /// The same fixture `redextape-cli/src/run.rs`'s tests use: 64 levels of self-sharing, 65
    /// allocations, 2^64 logical nodes — small enough to build here, but far too large for
    /// `format_value_capped` to walk within `MAX_PRINT_NODES`. Never fed to the UNCAPPED
    /// `format_value`; every test below drives it through `decoded_value`/`decoded_of`/
    /// `decoded_or_undecodable`, the capped seams this fix pass adds.
    fn tiny_but_logically_enormous_dag() -> redextape_core::value::Value {
        use redextape_core::value::Value;
        let mut v = Value::Cons(Rc::new(Value::Nat(1)), Rc::new(Value::Nil));
        for _ in 0..64 {
            let shared = Rc::new(v);
            v = Value::Cons(Rc::clone(&shared), Rc::new(Value::Cons(shared, Rc::new(Value::Nil))));
        }
        v
    }

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

    /// A literal past the print cap must yield a BOUNDED print rather than an unbounded walk. Natively
    /// there is stack enough for either, so this pins the cap's arithmetic, not its safety — the
    /// browser tests in Task 5 are what pin the safety.
    #[test]
    fn a_literal_past_the_print_cap_prints_bounded() {
        let src = format!("let x = {}; x + 1", MAX_PRINT_DEPTH + 200);
        let c = Session::compile(&src, EncodingKind::Unary);
        let s = c.session.expect("a large literal still compiles");
        let st = s.lambda_state(65_536).expect("λ leg present");
        // Depth, not bytes: this term prints small (well under the 65,536-byte budget) and is cut only
        // because it is deeper than `MAX_PRINT_DEPTH` — the exact case `Cut` exists to name.
        assert_eq!(st.cut, Some(lambda::Cut::Depth), "a term deeper than MAX_PRINT_DEPTH must report a depth cut");

        let shallow = Session::compile("let x = 40; x + 1", EncodingKind::Unary).session.expect("compiles");
        let ok = shallow.lambda_state(65_536).expect("λ leg present");
        assert!(ok.cut.is_none(), "a shallow term must still print whole");
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

    // --- the λ scratchpad ------------------------------------------------------------------------

    #[test]
    fn a_lambda_scratch_parses_text_and_reduces_it() {
        let made = lambda_scratch("(\\x. x) (\\y. y)");
        assert!(made.diagnostics.is_empty(), "{:?}", made.diagnostics);
        let mut sc = made.scratch.expect("a well-formed term yields a scratch");

        let st = sc.lambda_status();
        assert!(st.available, "a scratch that exists has its leg");
        assert!(st.reason.is_empty(), "and nothing to explain");
        assert_eq!(st.node, None, "no lowering refused anything, so no node is named");
        assert_eq!(st.run, Some(RunStatus::Running), "a fresh cursor has not ended");

        assert_eq!(sc.lambda_state(usize::MAX).step, 0);
        assert!(sc.step_lambda(), "this term takes a step");
        assert!(!sc.step_lambda(), "and exactly one");
        assert_eq!(sc.lambda_status().run, Some(RunStatus::Ended));
        assert_eq!(sc.lambda_state(usize::MAX).text, "λy. y", "the identity applied to the identity");
    }

    /// **THE FIXTURE FOR T8's DETACH, ASSERTED HERE WHERE IT IS CHEAP.** Detaching a source-derived λ
    /// pane seeds a `LambdaScratch` with that pane's current TEXT (design §4.3), so the scratch's whole
    /// value depends on the round trip: `print_lambda` -> `parse_lambda` -> the same reduction.
    ///
    /// **IT IS ALSO WHAT PINS THE CAP.** `lambda_scratch` hands `LambdaCursor::new` the same
    /// `MAX_REDUCTION_STEPS` `compile_with_caps` does; a different constant here would show up as the
    /// same term reaching `Capped` in one pane and `Ended` in another. Seven β-steps to Church 42 is
    /// the figure `the_reference_program_produces_the_figures_the_browser_test_pins` owns for the
    /// session path, and this asserts the scratch path reaches it identically.
    ///
    /// The binder is REPRINTED AS `x0`, not `x`: `print_lambda` renames so no binder shadows an
    /// enclosing one, and `λf. λx.` re-prints from the reparsed term with the hint already taken. That
    /// is the text form's documented behaviour, not a defect, so the assertion is on the applications
    /// rather than on the binder spelling.
    #[test]
    fn a_scratch_seeded_from_a_sessions_own_lambda_text_reduces_identically() {
        let s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        let text = s.lambda_state(usize::MAX).expect("λ available").text;

        let made = lambda_scratch(&text);
        assert!(made.diagnostics.is_empty(), "a printed term must reparse: {:?}", made.diagnostics);
        let mut sc = made.scratch.expect("a printed term must reparse");

        let mut beta = 0u64;
        while sc.step_lambda() {
            beta += 1;
        }
        assert_eq!(beta, 7, "β step count must match the session leg the text came from");
        assert_eq!(sc.lambda_status().run, Some(RunStatus::Ended));

        let nf = sc.lambda_state(usize::MAX).text;
        assert!(nf.starts_with("λf. λx0. f "), "the normal form is Church 42, got {nf:?}");
        assert_eq!(nf.matches("f (").count() + 1, 42, "Church 42 applies `f` 42 times, got {nf:?}");
    }

    /// Text that does not parse is diagnostics and no scratch — the "the parser refused" case, which is
    /// NOT `compile`'s "a backend declined" case. There is no backend here to decline.
    #[test]
    fn unparseable_lambda_text_yields_diagnostics_and_no_scratch() {
        let made = lambda_scratch("(\\x.");
        assert!(!made.diagnostics.is_empty(), "an unterminated abstraction must be reported");
        assert!(made.scratch.is_none(), "and must not yield a scratch to step");

        // Trailing input is the OTHER `None` producer in `parse_lambda`, and it is the one a user
        // typing into a pane actually hits — a second term pasted after the first.
        let trailing = lambda_scratch("(\\x. x) )");
        assert!(!trailing.diagnostics.is_empty());
        assert!(trailing.scratch.is_none());
    }

    /// `runLambda`'s chunk/cap distinction has to hold on a scratch too, and it is the same shared loop
    /// — so this is a check that the transplant reached it, not a re-test of the loop.
    ///
    /// THE DIVERGENT TERM IS ω = `(λx. x x) (λx. x x)`, which β-reduces to itself forever. A spent
    /// CHUNK leaves it `Running`; only the cursor's own cap yields `Capped`, which `cap_lambda_at`
    /// reaches without spending `MAX_REDUCTION_STEPS`' five million steps.
    #[test]
    fn a_scratch_separates_a_spent_chunk_from_a_spent_cap() {
        let mut sc = lambda_scratch("(\\x. x x) (\\x. x x)").scratch.expect("omega parses");
        assert_eq!(sc.run_lambda(3), RunStatus::Running, "a spent chunk budget has not capped anything");
        assert_eq!(sc.lambda_state(usize::MAX).step, 3, "the chunk ran exactly its budget");

        sc.cap_lambda_at(2);
        assert_eq!(sc.run_lambda(1_000_000), RunStatus::Capped, "the CURSOR ran out, not the chunk");
        sc.raise_lambda_cap(5);
        assert_eq!(sc.lambda_status().run, Some(RunStatus::Running), "continuing is honest here");
        assert!(sc.step_lambda(), "and the raise really does let it proceed");
    }

    #[test]
    fn the_lambda_ast_on_a_scratch_refuses_a_budget_it_cannot_meet() {
        let sc = lambda_scratch("(\\x. x) (\\y. y)").scratch.expect("parses");
        assert!(sc.lambda_ast(1).is_none(), "a 1-node budget must refuse, not truncate");
        assert!(sc.lambda_ast(usize::MAX).is_some());
    }

    // --- the fork -------------------------------------------------------------------------------

    #[test]
    fn lambda_scratch_at_step_zero_round_trips() {
        // The identity case, and the free test of the whole path design §4.1 names: the replay is a
        // no-op, so both `lambda_scratch` calls must produce the same term from the same text.
        //
        // The expected text is the PRINTER's spelling, `λ`, not the `\` the source used — `print_lambda`
        // emits only `λ` (`lambda/syntax.rs`'s module doc), and `lambda_scratch_at`'s output is a
        // reparse of a print, never the original source string.
        let out = lambda_scratch_at("(\\x. x) (\\y. y)", 0, 65_536);
        assert!(out.diagnostics.is_empty());
        assert!(out.scratch.is_some());
        assert_eq!(out.text.as_deref(), Some("(λx. x) (λy. y)"));
    }

    #[test]
    fn lambda_scratch_at_replays_to_the_requested_step() {
        // One β-step of `(\x. x) (\y. y)` is `\y. y`, and the scratch that comes back must be at ITS
        // step 0 holding that term — not at step 1 of the original.
        let out = lambda_scratch_at("(\\x. x) (\\y. y)", 1, 65_536);
        assert_eq!(out.text.as_deref(), Some("λy. y"));
        let scratch = out.scratch.expect("a scratch for a term that parsed");
        assert_eq!(scratch.lambda_state(65_536).step, 0, "the fork's step 0 is the term forked");
    }

    #[test]
    fn lambda_scratch_at_clamps_a_step_past_the_end() {
        // `step` is what a pane was showing, and a history can outlive nothing — asking for step 500
        // of a 1-step reduction must still answer the term the reduction actually ended on.
        //
        // THIS DOES NOT PIN THE REPLAY LOOP'S `break` (final whole-branch review, T1's mutation
        // result). `LambdaCursor::next` latches permanently once ended (`trace.rs`:
        // `self.status.is_some()` short-circuits every call after the first `None`), so `step_lambda`
        // answers `false` forever past the end — looping the full 500 iterations and breaking out
        // early reach bit-identical state, which is why deleting the `break` kills nothing here. What
        // this genuinely pins is that `lambda_scratch_at` survives a step far past the reduction's
        // length and reports the right term, rather than panicking or spinning.
        let out = lambda_scratch_at("(\\x. x) (\\y. y)", 500, 65_536);
        assert_eq!(out.text.as_deref(), Some("λy. y"));
    }

    #[test]
    fn lambda_scratch_at_refuses_unparseable_text() {
        let out = lambda_scratch_at("(\\x.", 0, 65_536);
        assert!(out.scratch.is_none());
        assert!(out.text.is_none(), "no string built a scratch, so there is no string to report");
        assert!(!out.diagnostics.is_empty());
    }

    #[test]
    fn lambda_scratch_at_refuses_a_term_over_budget() {
        // Design §4.1's moved refusal: a term that does not fit the print budget yields a CUT, and a
        // cut is a prefix that will not parse (or worse, parses to a different term). A tiny budget
        // reproduces at 8 bytes what 64 KiB does for a genuinely enormous term.
        let out = lambda_scratch_at("(\\xxxxxxxx. xxxxxxxx) (\\yyyyyyyy. yyyyyyyy)", 0, 8);
        assert!(out.scratch.is_none(), "a cut term must not seed a scratch");
        assert!(out.text.is_none());
        assert_eq!(out.diagnostics.len(), 1);
        assert!(out.diagnostics[0].message.contains("too large to fork"));
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

        // A parse error is the one place lints structurally cannot run on EITHER path, so the assertion
        // above cannot tell "compile also runs lints" apart from "compile has no error diagnostics to
        // compare against". A warning-only program closes that gap: `x` is declared `mut` and never
        // assigned, which is exactly `lints::check`'s does-not-need-`mut` rule and nothing else.
        let warned = analyze("let mut x = 1; x + 1");
        assert!(!warned.is_empty(), "an unnecessary `mut` must be reported");
        assert!(warned.iter().all(|d| d.severity == Severity::Warning), "this program has no error, only a lint");

        let compiled = Session::compile("let mut x = 1; x + 1", EncodingKind::Unary);
        assert_eq!(warned, compiled.diagnostics, "analyze and compile must not disagree about a warning either");
        assert!(compiled.session.is_some(), "a warning must not block a session from being built");
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

    // --- the TM scratchpad -----------------------------------------------------------------------

    /// A hand-written unary incrementer with NO header — δ and a start state and nothing else, which is
    /// exactly the file `examples/tm_emit.rs`'s `run` declines. Copied from `tm/syntax.rs`'s own
    /// round-trip fixture rather than invented, so the text form it exercises is one that file already
    /// pins as representable.
    ///
    /// ON BLANK TAPES IT TAKES EXACTLY ONE STEP: the head reads `_`, which the second rule's `*`
    /// wildcard matches, writes `1`, stays put and goes to the accept state. That is short enough to
    /// assert the whole configuration and long enough that the cursor is genuinely stepped rather than
    /// merely constructed.
    const HEADERLESS_TM: &str = "\
; a hand-written incrementer, header-free
tapes 1
start scan

state scan:
  [1] -> write [*], move [R], goto scan
  [*] -> write [1], move [S], goto halt
state halt: accept
";

    /// **DECISION 6, AND IT REVERSES A REFUSAL ALREADY IN THE TREE** (`examples/tm_emit.rs`, whose
    /// comment now names this path). A headerless machine runs, from blank tapes, at
    /// `MIN_FIELD_WIDTH` — and `tm_status().header` is `false`, which is the ONLY thing that lets a
    /// pane tell an invented configuration from one the file asked for.
    ///
    /// THE WIDTH IS ASSERTED AGAINST THE CONSTANT AND AGAINST ITS VALUE. `MIN_FIELD_WIDTH` alone would
    /// stay green if the constant itself moved; `4` alone would break for a reason that has nothing to
    /// do with this code. Both together fail loudly for the right one — and a default taken from some
    /// other width (`MAX_FIELD_WIDTH`, say) fails with a concrete number rather than a shape error.
    #[test]
    fn a_headerless_machine_runs_from_blank_tapes_at_the_minimum_width() {
        let made = tm_scratch(HEADERLESS_TM);
        assert!(made.diagnostics.is_empty(), "a missing header is not a diagnostic: {:?}", made.diagnostics);
        let mut sc = made.scratch.expect("a headerless file is still a machine");

        let st = sc.tm_status();
        assert!(st.available, "the machine parsed, so the leg is there");
        assert!(st.reason.is_empty());
        assert!(!st.header, "this file carried no header, and the pane has to be able to say so");
        assert_eq!(st.width, tm::MIN_FIELD_WIDTH, "a headerless machine takes the narrowest width");
        assert_eq!(st.width, 4, "and `MIN_FIELD_WIDTH` is 4 — pinned so a moved constant is visible here");
        assert_eq!(st.run, RunStatus::Running, "a fresh cursor has not ended");

        // BLANK, not merely short: the one materialized cell is the blank symbol, so nothing was
        // seeded. This is the assertion a fabricated `init` would fail.
        let before = sc.tm_state(3);
        assert_eq!(before.step, 0);
        assert_eq!(before.window, vec![vec!['_']], "a headerless machine starts on blank tape");
        assert_eq!(before.source_node, None, "a scratch has no lowering, so no state can own a Core node");

        assert!(sc.step_tm(), "the wildcard rule fires on the blank");
        assert!(!sc.step_tm(), "and lands in the accept state, which has no rules");
        assert_eq!(sc.tm_status().run, RunStatus::Ended, "a halted machine has ended, not capped");

        let after = sc.tm_state(3);
        assert_eq!(after.step, 1);
        assert_eq!(after.window, vec![vec!['1']], "the rule wrote its mark");
        assert_eq!(sc.tm_program().width, tm::MIN_FIELD_WIDTH, "tmProgram and tmStatus must agree on the width");
        assert_eq!(sc.tm_program().tapes, 1);
    }

    /// **THE TEST THAT CATCHES A HEADERLESS DEFAULT LEAKING INTO THE MAPPED PATH.** A `.tm` file WITH a
    /// header, pasted into a scratch pane, must produce exactly what the `Session` path produces for
    /// the program it came from — same projection, same frame — because both go through the same
    /// `build_tm_leg`. If the scratch ever reached for `MIN_FIELD_WIDTH` or blank tapes when a header
    /// was present, this fails on the width and on the tapes at once.
    ///
    /// THE TEXT IS PRODUCED THE WAY `tm_emit emit` PRODUCES IT — `run_tm_described` then
    /// `print_tm_with` — rather than hand-written, so this also exercises the round trip a user
    /// actually performs: emit a file, paste it into a pane.
    ///
    /// **`source_node` IS THE ONE FIELD ALLOWED TO DIFFER, AND THE STRUCT-UPDATE ASSERTION IS WHAT SAYS
    /// SO.** That is T1's whole contract seen from the consumer side: the scratch passes `None` to
    /// `TmState::window`, so it loses the sync anchor and nothing else. `core`'s
    /// `an_absent_map_zeroes_the_source_node_and_leaves_every_other_field_alone` pins the same property
    /// at the builder; this pins that the boundary actually wired it that way.
    #[test]
    fn a_headered_scratch_matches_the_session_path_except_for_the_source_node() {
        let src = "let x = 40; x + 2";
        let kind = EncodingKind::Unary;

        let (program, ds) = parser::parse(src);
        assert!(ds.is_empty(), "{ds:?}");
        let program = program.expect("the fixture parses");
        let ty = typeck::result_type(&program).expect("the fixture types");
        let enc = kind.at(tm::MIN_FIELD_WIDTH);
        let (core, _map) = SourceMap::build_from_program(&program, &*enc);
        let described =
            tm::run_tm_described(&core, kind, ty, tm::TM_DEFAULT_CAPS).expect("the fixture lowers and runs");
        let text = tm::print_tm_with(&described.machine, &described.header);

        let made = tm_scratch(&text);
        assert!(made.diagnostics.is_empty(), "an emitted file must reparse: {:?}", made.diagnostics);
        let mut sc = made.scratch.expect("an emitted file must reparse");

        let st = sc.tm_status();
        assert!(st.header, "this file HAS a header, and nothing invented its width");
        assert_eq!(st.width, 64, "the width the auto-fit chose, not `MIN_FIELD_WIDTH`");

        let mut s = Session::compile(src, kind).session.expect("compiles");
        assert_eq!(sc.tm_program(), s.tm_program().expect("TM available"), "same machine, same projection");

        // Driven in lockstep rather than compared only at step 0: a wrong `init` can still agree on an
        // empty tape at step 0 and diverge the moment the machine reads one.
        //
        // `owned` IS LOAD-BEARING. If the mapped side resolved no owner anywhere in this window, both
        // sides would carry `source_node: None` and the struct-update assertion would hold for a reason
        // that has nothing to do with the scratch — a green test proving nothing, which is the trap
        // core's `tm_state_resolves_its_source_node_through_the_map` steps past the same way.
        let mut owned = 0usize;
        for step in 0..50u32 {
            let mapped = s.tm_state(3).expect("TM available");
            owned += usize::from(mapped.source_node.is_some());
            assert_eq!(
                sc.tm_state(3),
                TmState { source_node: None, ..mapped.clone() },
                "step {step}: the scratch loses `source_node` and must lose nothing else"
            );
            assert_eq!(sc.step_tm(), s.step_tm().expect("TM available"), "step {step}: the two must stop together");
        }
        assert!(owned > 0, "the mapped side resolved no owner in 50 steps, so the comparison proves nothing");
    }

    /// **`tm_text` MUST PRODUCE TEXT THAT REBUILDS THE SAME MACHINE, NOT MERELY TEXT THAT PARSES.**
    /// `a_headered_scratch_matches_the_session_path_except_for_the_source_node` already proves that
    /// property for text produced by a hand-assembled `print_tm_with` call. This proves it for the
    /// SHIPPED path — the method the app will actually call — which is the one that can regress.
    ///
    /// **THE WIDTH ASSERTION IS WHAT CATCHES A DROPPED HEADER.** Without one, `tm_scratch` falls back
    /// to `MIN_FIELD_WIDTH` (4) and blank tapes; this fixture's auto-fit chooses 64, so a header lost
    /// anywhere between `compile` and `print_tm_with` fails here rather than showing up as a machine
    /// that quietly computes nothing.
    #[test]
    fn tm_text_round_trips_through_tm_scratch_to_the_same_machine() {
        let src = "let x = 40; x + 2";
        let mut s = Session::compile(src, EncodingKind::Unary).session.expect("compiles");

        let text = s.tm_text().expect("an available TM leg has text");
        let made = tm_scratch(&text);
        assert!(made.diagnostics.is_empty(), "a printed machine must reparse: {:?}", made.diagnostics);
        let mut sc = made.scratch.expect("a printed machine must reparse");

        let st = sc.tm_status();
        assert!(st.header, "the header survived `compile` and reached the printer");
        assert_eq!(st.width, 64, "the auto-fit width, not `MIN_FIELD_WIDTH`");
        assert_eq!(sc.tm_program(), s.tm_program().expect("TM available"), "same machine, same projection");

        // Lockstep rather than a step-0 comparison: a wrong `init` can agree on an empty tape at step 0
        // and diverge the moment the machine reads one.
        let mut owned = 0usize;
        for step in 0..50u32 {
            let mapped = s.tm_state(3).expect("TM available");
            owned += usize::from(mapped.source_node.is_some());
            assert_eq!(
                sc.tm_state(3),
                TmState { source_node: None, ..mapped.clone() },
                "step {step}: the scratch loses `source_node` and must lose nothing else"
            );
            assert_eq!(sc.step_tm(), s.step_tm().expect("TM available"), "step {step}: the two must stop together");
        }
        assert!(owned > 0, "the mapped side resolved no owner in 50 steps, so the comparison proves nothing");
    }

    /// **A DECLINED TM LEG HAS NO TEXT, AND `None` IS THE ONLY HONEST ANSWER.** There is no machine to
    /// print. This is the same condition `tm_program` answers `SessionError::TmAbsent` on, read off the
    /// same `Result`, so the two cannot disagree about whether a leg exists.
    #[test]
    fn a_declined_tm_leg_has_no_text() {
        let s = Session::compile("let mut n = 1; while n > 0 { n = n + 1; } n", EncodingKind::Unary)
            .session
            .expect("compiles");
        assert!(s.tm_program().is_err(), "this fixture's TM leg must decline for the test to mean anything");
        assert_eq!(s.tm_text(), None);
    }

    /// **`TmScratchStatus` HAS EXACTLY THESE FIVE FIELDS, AND A SIXTH FAILS TO COMPILE HERE.** The
    /// field this type exists in order NOT to have is `total_steps` — `Session::tm_status` reports one
    /// from the run `compile` performed, and a scratch is stepped rather than described-run, so any
    /// value it put there would be invented. See `TmScratchStatus`'s own doc.
    ///
    /// **A DESTRUCTURING PATTERN RATHER THAN FIVE FIELD READS, BECAUSE ONLY THE PATTERN IS EXHAUSTIVE.**
    /// Rust requires a struct pattern to name every field (or say `..`), so adding one to the type
    /// breaks this line with `missing field in pattern` — while five `assert_eq!(st.field, ..)` lines
    /// would happily keep passing beside a newly fabricated sixth.
    ///
    /// **THIS EXISTS BECAUSE THE MUTATION PROVED IT WAS MISSING.** Adding `total_steps: Some(0)` to the
    /// struct was caught by `tests/browser.rs`'s wire assertion and by NOTHING in the native suite —
    /// 894 tests green. The browser tier needs Chrome and is skippable; the trap this task's own plan
    /// flags as its biggest should not depend on a tier that can be skipped.
    #[test]
    fn the_tm_scratch_status_has_no_field_for_a_total_it_cannot_know() {
        let sc = tm_scratch(HEADERLESS_TM).scratch.expect("parses");
        let TmScratchStatus { available, reason, width, run, header } = sc.tm_status();
        assert!(available);
        assert!(reason.is_empty());
        assert_eq!(width, tm::MIN_FIELD_WIDTH);
        assert_eq!(run, RunStatus::Running);
        assert!(!header);
    }

    /// Text that does not parse to a machine is diagnostics and a `None` scratch — and a MISSING HEADER
    /// is not one of those cases, which is the half worth pinning: `parse_tm_full` deliberately does not
    /// treat header absence as failure, and `a_headerless_machine_runs_from_blank_tapes_at_the_minimum
    /// _width` above depends on that staying true.
    #[test]
    fn unparseable_tm_text_yields_diagnostics_and_no_scratch() {
        let made = tm_scratch("tapes 1\nstart s\nstate s:\n  [*] -> write [*], move [S], goto nowhere\n");
        assert!(made.diagnostics.iter().any(|d| d.message.contains("nowhere")), "{:?}", made.diagnostics);
        assert!(made.scratch.is_none(), "an unresolvable goto leaves no machine to step");

        let garbage = tm_scratch("this is not a machine");
        assert!(!garbage.diagnostics.is_empty());
        assert!(garbage.scratch.is_none());
    }

    /// `tapeSlice` speaks the same coordinates `tmState` reports, and names an absent tape rather than
    /// indexing out of bounds — the one error a scratch CAN produce, which is why it is the one method
    /// here that keeps a `Result`.
    #[test]
    fn a_scratch_tape_slice_agrees_with_its_window_and_refuses_an_absent_tape() {
        let mut sc = tm_scratch(HEADERLESS_TM).scratch.expect("parses");
        assert!(sc.step_tm());

        let st = sc.tm_state(3);
        let from = st.window_start[0];
        let got = sc.tape_slice(0, from, from + st.window[0].len()).expect("tape 0 exists");
        assert_eq!(got, st.window[0], "slice and window must agree in the same space");

        assert_eq!(
            sc.tape_slice(9, 0, 4),
            Err(SessionError::NoSuchTape { tape: 9, tapes: 1 }),
            "an absent tape must not index out of bounds"
        );
    }

    /// `Capped` and `raise_tm_cap` on a scratch, reached through `tm_scratch_with_caps` rather than by
    /// spending `TM_DEFAULT_CAPS`' five million δ-steps — the same affordance `compile_with_caps`
    /// exists to give the `Session` tests.
    ///
    /// THE FIXTURE NEVER HALTS: `scan` on a tape of marks moves right forever once it is seeded, and
    /// the seeding rule fires on the first blank. Two steps in, the three-step budget is spent.
    #[test]
    fn a_capped_scratch_machine_can_be_raised_and_continued() {
        let spin = "tapes 1\nstart go\n\nstate go:\n  [*] -> write [*], move [R], goto go\n";
        let caps = tm::TmCaps { steps: 3, cells: tm::TM_DEFAULT_CAPS.cells };
        let mut sc = tm_scratch_with_caps(spin, caps).scratch.expect("parses");

        let mut driven = 0;
        while sc.step_tm() {
            driven += 1;
        }
        assert_eq!(driven, 3, "the cursor spends exactly its budget");
        assert_eq!(sc.tm_status().run, RunStatus::Capped, "a spent budget is Capped, not Ended");

        sc.raise_tm_cap(2, 0);
        assert_eq!(sc.tm_status().run, RunStatus::Running, "continuing is honest here");
        assert!(sc.step_tm(), "and the raise really does let it proceed");
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

    /// **THE CRITICAL FINDING THIS TEST PINS.** `evaluate`/`evaluateWithBudget` are
    /// `#[wasm_bindgen]`-reachable from an ordinary user-typed program, and before this fix both
    /// printed through the uncapped `format_value` — a `tails`-shaped program builds a small-in-memory,
    /// logically enormous `Value` in O(m) interpreter steps (`Builtin::Tail` is an O(1) `Rc` clone) and
    /// the uncapped printer would then walk it forever. `decoded_of` now routes every `Ok(v)` through
    /// `decoded_value`, which refuses past `MAX_PRINT_NODES` instead. Drives `decoded_of` directly with
    /// the fixture rather than running a program that builds one, per this task's own safety note.
    #[test]
    fn evaluate_reports_too_large_to_print_for_a_logically_enormous_value() {
        assert_eq!(decoded_of(Ok(tiny_but_logically_enormous_dag())), Decoded::TooLargeToPrint);
    }

    /// `lambda_value` sibling of the test above. `lambda_value` calls `decoded_or_undecodable` directly
    /// with `decode_lambda_ty`'s answer, so driving THAT function with `Some(fixture)` exercises the
    /// exact code path `lambdaValue()` runs, without a reduction that could build the shared term
    /// itself.
    #[test]
    fn lambda_value_reports_too_large_to_print_for_a_logically_enormous_decode() {
        assert_eq!(decoded_or_undecodable(Some(tiny_but_logically_enormous_dag())), Decoded::TooLargeToPrint);
    }

    /// `tm_value` sibling of the test above. `tm_value` calls the SAME `decoded_or_undecodable` with
    /// `decode_tape_ty`'s answer — `decode_tape_ty` is the exact function this branch made
    /// sharing-aware, so this is the sharpest of the three: a `tails`-shaped `.tm` program reaches this
    /// refusal at ~4,471 elements, far below any run cap.
    #[test]
    fn tm_value_reports_too_large_to_print_for_a_logically_enormous_decode() {
        assert_eq!(decoded_or_undecodable(Some(tiny_but_logically_enormous_dag())), Decoded::TooLargeToPrint);
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
        let (program, mut c, _) = s.tm.expect("the TM leg runs this");
        let fitted = program.width;

        let mut saw_some = false;
        for _ in 0..200 {
            if TmState::window(&c, Some(&s.map), 2).source_node.is_some() {
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
