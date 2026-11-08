//! The statuses and values `redextape-wasm` answers with beyond core's types, the helpers that build them and the
//! one serializer they cross by, in a crate of their own so that a second wasm module shares them instead of
//! copying them.

use redextape_core::core::NodeId;
use redextape_core::trace::RxmCap;
use serde::Serialize;
use wasm_bindgen::JsValue;

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
    /// the defect `raise_cap`'s own guard rules out one layer in, reintroduced at the boundary.
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
/// | `rxm_value` | ✅ | ✅ | ✅ | a capped compile whose cursor has not since ended | ✅ |
/// | `evaluate` | ✅ | ✅ | — | — | ✅ |
///
/// `tm_value`'s `Unfinished` is NOT λ-specific: `compile` gives both `Ran` and `HitCap` a working
/// cursor, so a capped machine is a live session with no tapes to decode. It is also not permanent —
/// a raised cap can drive that cursor to a halt, and `tm_value` decodes the configuration it stopped
/// on. There is no state in which the TM leg reports `Ended` and `Unfinished` together.
///
/// **`rxm_value` IS `tm_value`'S SHAPE WITH A FAULT ADDED.** It answers from the run `compile` performed and
/// falls back on the cursor after a raised cap, so its `Unfinished` is the TM's; and an rxm program can
/// fault — `head([])` types, and its `head` meets `nil` — which the cursor reports with the instruction and
/// the reason. That run has ENDED (`rxm_status().run` is `Ended`), so the fault is the leg's answer,
/// "head of empty list at pc1", and not a status. Each ✅ in its row has a test of
/// its own in `redextape-wasm`'s session tests, by the program that reaches it.
///
/// **THE λ AND TM `Undecodable` MARKS ARE A FIXTURE, NOT AN ARGUMENT.**
/// `a_function_valued_program_decodes_as_undecodable_on_both_legs` pins them against `|x| x + 1`,
/// which types as `Fun([Nat], Nat)` — a type `decode_lambda_ty` and `decode_tape_ty` both bottom out
/// on — and which BOTH backends nonetheless lower and run to an end. A ✅ in a reachability table that
/// no test can demonstrate is a claim, and this one is not.
///
/// **`TooLargeToPrint` IS A DIFFERENT FACT THAN `Undecodable`.** `Undecodable` means the decode itself found
/// no value of a representable type. `TooLargeToPrint` means the decode SUCCEEDED — `decode_lambda_ty`/
/// `decode_tape_ty` answered `Some(v)`, or the reference interpreter answered `Ok(v)` — and only the PRINT
/// refused, because `v`'s LOGICAL size (an `Rc` DAG's printed size, not its allocation count — see
/// `redextape_core::value::MAX_PRINT_NODES`'s doc) exceeds what `format_value_capped` will walk. Collapsing
/// the two into one `Undecodable` would tell a renderer the value has no encoding when it is, in fact, a
/// real answer this tool merely cannot afford to print — the same distinction `redextape-cli`'s
/// `Outcome::ToolFailed` draws against `Outcome::ProgramFailed` for the identical hazard on the CLI's own
/// five print sites (`run.rs`). Each producer's own test in `redextape-wasm`'s session tests pins that this
/// state is reachable from a small-in-memory, logically enormous fixture, the same one `run.rs`'s tests use.
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
/// `reason` IS THE PAYLOAD, which is why every leg answers a struct rather than an `Option`. A UI that
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
    /// **`ts(type = "number | null")`, NOT `ts(type = "number")`.** `ts-rs` maps `u64` to `bigint`
    /// by default, which is not what the wire carries: `serde_wasm_bindgen` puts it across as a JS number,
    /// which `all_three_legs_agree_across_the_boundary` in `crates/redextape-wasm/tests/browser.rs` measures
    /// directly against a real browser. So an override is needed. But `ts(type = ...)` substitutes the WHOLE
    /// field type, `Option` and all, so `ts(type = "number")` would generate `total_steps: number` and silently
    /// drop the `| null` that `None` puts on the wire. `LambdaState::step` and `TmState::step` take that same
    /// override correctly, because they are bare `u64` with no `Option` around them.
    ///
    /// **`no_override_misstates_a_field_s_nullability` IS THE RUST-SIDE GATE THAT SEES THE DROPPED `| null`.**
    /// `no_generated_type_carries_bigint` passes on `total_steps: number` — there is no `bigint` in it to find —
    /// and `the_gate_covers_every_exported_type` only checks which types derive `TS`, not what their fields say.
    ///
    /// **`tsc` CAN CATCH IT TOO, BUT ONLY WHILE `web/src/types.ts` TAKES `TmStatus` FROM `../bindings/`.**
    /// `tsconfig.json`'s `include` is `["src", "tests", "scripts", "vite.config.ts"]`, so `web/bindings/TmStatus.ts`
    /// enters the TypeScript program at all only through that import.
    ///
    /// **NO PRODUCTION SOURCE FILE CATCHES THIS.** `resultRows` in `web/src/results.ts` reads
    /// `total_steps` and narrows it on `!== null`, and that narrowing compiles clean against the wrong
    /// type — a `number` compared against `null` is not an error TypeScript reports here. On the TypeScript
    /// side, `web/tests/node/bindings-contract.test.ts` catches it: it assigns a literal `null` to
    /// `TmStatus['total_steps']`, so `tsc` (`pnpm run typecheck`) fails once the `| null` is gone.
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub total_steps: Option<u64>,
}

/// Whether the rxm leg is there, why not when it is not, how far its cursor has got, which cap stopped it,
/// and how long the whole run is.
///
/// **`TmStatus`'S SHAPE, LESS `width` AND PLUS `cap`.** An rxm program has no encoding to fit, so it has no
/// width. And `RunStatus::Capped` cannot say by itself whether "continue" is an honest offer, which on the TM
/// it always is: the rxm cursor has four caps and only the step cap resumes — `RxmCursor::raise_cap` leaves a
/// run its stack, heap or saved-frame memory stopped where it is, since more steps cannot deepen a stack —
/// so a renderer that offered "continue" on `Capped` alone would offer it to three runs that cannot take it.
/// `cap` says which cap it was, and the step line names it (Plan 7 part 5 spec amendment 10).
///
/// **A FIELD, NOT MORE `RunStatus` VARIANTS.** λ's depth refusal is `RunStatus::DepthRefused` because it is
/// one fact with one sentence. Three hard caps each need a sentence of their own, and a variant apiece would
/// put three rxm-only states into the vocabulary every leg's `run` shares, for the λ and TM renderers to
/// match and never meet. The TM's `Capped` needs no cap beside it: both of its caps, steps and live cells,
/// are ones `raise_tm_cap` raises.
///
/// **A FAULT IS AN END.** `run` is `Ended` for a run that halted and for one that faulted, and `rxm_value`
/// carries the difference: the program's value, or `Decoded::Fault` naming the instruction and the reason
/// (spec §8). A fault is the program's answer — `head([])` faults in the reference interpreter too — not a
/// limit of this tool, so nothing about it invites continuing.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RxmStatus {
    pub available: bool,
    /// Why the leg is absent — which way `tm::lower_program` refused the program — or empty when it is not.
    ///
    /// **NO `node`, AS `TmStatus` HAS NONE.** The TM leg lowers through the same function, so a program the
    /// rxm lowering refuses declines the TM leg too, with the same refusal behind it, and neither status
    /// names a construct; `LambdaStatus::node` exists because the λ backend refuses things of its own.
    pub reason: String,
    /// Where the CURSOR stands: `Running`, `Ended` for a halt or a fault, or `Capped`. `None` exactly when
    /// the leg is absent. `DepthRefused` is λ's and never appears here.
    pub run: Option<RunStatus>,
    /// Which cap stopped the cursor. `Some` exactly when `run` is `Capped` — a cap beside `Running` or
    /// `Ended` would name a stop that did not happen — and only `Some(RxmCap::Steps)` names one that
    /// `raise_rxm_cap` resumes.
    pub cap: Option<RxmCap>,
    /// How long the WHOLE run is, in instructions, from the run `compile` performed (Plan 7 part 5 spec amendment 13).
    ///
    /// **`compile` RUNS THE PROGRAM TO ITS END TO KNOW THIS, AS IT RUNS THE TM.** `run_rxm` returns no step
    /// count, so `compile` drives an `RxmCursor` to the end and keeps the count and the outcome, and the
    /// cursor a view records is a fresh one. It is a different number about a different thing than `run`,
    /// for `TmStatus::total_steps`'s reason: "instruction 23 of 55" reads the cursor for the first number
    /// and this for the second, and this does not move as the cursor does.
    ///
    /// **FOR A CAPPED RUN IT IS WHERE THE CAP FIRED, NOT THE LENGTH OF A COMPLETED RUN**: 5,000,000 under
    /// `DEFAULT_CAPS`' step cap, and the instructions completed before the refused one under a stack, heap or
    /// memory cap. A raised step cap can drive the cursor past it, so a renderer reads `run` before it takes
    /// this for a length — `TmStatus::total_steps`'s caveat.
    ///
    /// **`Some` EXACTLY WHEN THE LEG IS AVAILABLE.** The only decline is a lowering that failed, and a program
    /// that never lowered never ran a step, so there is no count to withhold, unlike the TM's `Overflow`.
    ///
    /// `ts(type = "number | null")`, for the reason `TmStatus::total_steps`'s doc records at length: `ts-rs`
    /// maps `u64` to `bigint`, the wire carries a JS number, and `ts(type = ...)` replaces the whole field
    /// type, `Option` and all.
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub total_steps: Option<u64>,
}

/// Where a `TmScratch`'s machine stands. **NOT `TmStatus`, AND THE DIFFERENCE IS A TRAP.**
///
/// `TmStatus::total_steps` is "how long the WHOLE run is, in δ-steps, from the run `compile` performed" — it
/// comes from `run_tm_described_program`, and a scratch is never described-run. It is *stepped*. So there is no
/// such total to report, and the two candidate ways to report one anyway are both worse than not having the
/// field: `Some(0)` is a lie a progress bar would render as "step 40 of 0", and `None` beside `available: true`
/// is a shape `TmStatus`'s own doc reserves for a DECLINED leg. The doc on `Session`'s `tm` field records at
/// length what a fabricated status for an unreachable state costs; this type does not fabricate one.
///
/// The Rust side pins the field list by an exhaustive destructuring in `redextape-wasm`'s session tests
/// (`let TmScratchStatus { available, reason, width, run, header, reduction } = sc.tm_status();`), so a seventh
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
    /// over, which is the same asymmetry `redextape-wasm`'s `tm_run_status` notes.
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
    /// The stages a `version 2` header names and the step count it records, or `None` for a lowered or
    /// headerless file. The pane says both, because a reduced file's tapes mean nothing read as lowered ones.
    pub reduction: Option<ReductionStatus>,
}

/// A reduced file's stages, by `StageKind::name`, and the steps its header records.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ReductionStatus {
    pub stages: Vec<String>,
    /// `number`, not `bigint`, for the reason `TmStatus::total_steps` records.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub steps: u64,
}

/// How far a `TmValueRun` has got.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ValueRun {
    /// `Running` while `run` may advance it, `Ended` once it halted, `Capped` once it spent `cap`. Never
    /// `DepthRefused`, which is λ's alone.
    pub run: RunStatus,
    /// `number`, not `bigint`, for the reason `TmStatus::total_steps` records.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub steps: u64,
    /// The steps this run may take: the header's recorded count for a reduced file, `TM_DEFAULT_CAPS`' otherwise.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub cap: u64,
}

/// THE ONE SERIALIZER, so the boundary answers `None` the same way everywhere.
///
/// `serde_wasm_bindgen`'s default renders `Option::None` as `undefined`, and §5.1's TypeScript writes
/// every optional as `T | null` — a renderer testing `x === null` would get it wrong. Getting this
/// right only for top-level returns (`sourceSpan`) and leaving struct FIELDS on the
/// default would be worse than either choice alone: `lambdaStatus().run` would be `undefined` while
/// `sourceSpan()` is `null`, so one boundary would need two rules in the renderer. One serializer,
/// one rule.
///
/// # Errors
///
/// When `serde_wasm_bindgen` cannot represent `v`, as with a `u64` or `i64` outside JavaScript's safe-integer
/// range: this serializer writes 64-bit integers as numbers, not `BigInt`s.
// `#[inline]` so each caller's instantiation inlines into its export rather than costing a call per answer.
#[inline]
pub fn to_value<T: Serialize>(v: &T) -> Result<JsValue, JsValue> {
    let s = serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true);
    Ok(v.serialize(&s)?)
}

/// A fault as the rxm leg's value, "head of empty list at pc1" — the one wording for the two places a
/// `redextape-wasm` run can fault, `compile`'s run and the recording cursor after a raised cap.
///
/// **WHAT FAULTED, THEN WHERE, AND NO "FAULTED".** Spec §8 wrote "faulted at pc12: head of empty list", but every
/// reader of a `Decoded::Fault` already says it is one — `web/src/types.ts`'s `decodedText` prints `fault: ` before
/// the message — so the spec's words would read "fault: faulted at pc12: …". The message carries the fault and the
/// instruction, and the readout reads "fault: head of empty list at pc12".
#[must_use]
pub fn rxm_fault(pc: usize, why: &str) -> Decoded {
    Decoded::Fault { message: format!("{why} at pc{pc}") }
}

/// A `Value` already in hand — decoded or freshly evaluated — printed through the CAPPED printer.
/// **THE ONE PLACE ANY `redextape-wasm` PRODUCER TURNS A `Value` INTO EITHER `Decoded::Value` OR
/// `Decoded::TooLargeToPrint`**, directly or through `decoded_or_undecodable` or `decoded_of`.
///
/// **EVERY CALLER MUST GO THROUGH IT RATHER THAN `format_value` DIRECTLY.** Every producer is
/// `#[wasm_bindgen]`-reachable from an ordinary user-typed program, and `format_value` is an uncapped tree walk
/// over a `Value` whose printed size is its LOGICAL size once a decoder memoizes sharing —
/// `tm_value`'s own decode (`tm::decode_tape_ty`) does — and a `tails`-shaped program decodes in
/// ~192,000 nodes and would hand the uncapped printer a walk of billions. See
/// `redextape_core::value::MAX_PRINT_NODES`'s doc and `redextape-cli/src/run.rs`'s five capped
/// print sites for the same fix on the CLI's own side of this hazard.
#[must_use]
pub fn decoded_value(v: &redextape_core::value::Value) -> Decoded {
    match redextape_core::value::format_value_capped(v, redextape_core::value::MAX_PRINT_NODES) {
        Some(text) => Decoded::Value { text },
        None => Decoded::TooLargeToPrint,
    }
}

/// `n` with a comma between every three digits: `6100000` reads `6,100,000`.
///
/// **FOR THE COUNTS `redextape-wasm` WRITES INTO A MESSAGE A PANE SHOWS**, beside lines the pane composes itself with
/// `web/src/format.ts`'s `n`, which groups the same way; a raw `11571215` next to `241,666 steps` reads as a
/// different kind of number. Written here because nothing in the workspace groups digits.
#[must_use]
pub fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, d) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(d);
    }
    out
}

/// A decoder's `Option<Value>` answer (`decode_lambda_ty`, `decode_tape_ty`, `decode_rxm_ty`), turned into a
/// `Decoded` — the shared "decode answered, print-or-refuse" step for the value of each `redextape-wasm` leg.
/// Extracted (mirroring `redextape-cli/src/run.rs`'s `report_tm_decode`/`report_rxm_decode`) so a test can drive the
/// too-large-to-print refusal directly from a fixture `Value`, without an actual reduction or
/// simulation that could build the shared DAG itself.
#[must_use]
pub fn decoded_or_undecodable(v: Option<redextape_core::value::Value>) -> Decoded {
    match v {
        Some(v) => decoded_value(&v),
        None => Decoded::Undecodable,
    }
}

/// The ONE place an interpreter run becomes a `Decoded`. `redextape-wasm`'s `evaluate` and `evaluate_with_budget`
/// differ only in the budget they pass, so they must not be able to differ in the shape they answer with.
#[must_use]
pub fn decoded_of(run: Result<redextape_core::value::Value, redextape_core::interp::RuntimeError>) -> Decoded {
    match run {
        Ok(v) => decoded_value(&v),
        Err(e) => Decoded::Fault { message: e.message },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Commas every three digits from the right, and none in a number of three digits or fewer.
    #[test]
    fn grouped_puts_a_comma_between_every_three_digits() {
        let cases = [
            (0, "0"),
            (7, "7"),
            (999, "999"),
            (1_000, "1,000"),
            (241_666, "241,666"),
            (6_100_000, "6,100,000"),
            (11_571_215, "11,571,215"),
            (u64::MAX, "18,446,744,073,709,551,615"),
        ];
        for (n, want) in cases {
            assert_eq!(grouped(n), want);
        }
    }
}
