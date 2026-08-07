//! The `#[wasm_bindgen]` surface. Marshalling only — every decision lives in `session.rs`; see that
//! module's header for why.
//!
//! NO PANIC MAY CROSS THIS BOUNDARY. A Rust panic under wasm is an abort that poisons the module —
//! there is no unwinding to catch it — so every fallible export returns `Result<_, JsValue>`.
//! `console_error_panic_hook` is installed for legibility if one ever escapes, not as a strategy.

mod session;

use redextape_core::tm::EncodingKind;
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// A compiled program with both legs already built. Owns the cursors; every method below reads or
/// advances them.
#[wasm_bindgen]
pub struct Session(session::Session);

/// `compile(src, encoding)` -> `{ diagnostics: Diagnostic[], session: Session | null }`.
///
/// BUILT WITH `js_sys::Object` RATHER THAN SERIALIZED WHOLE, because the two halves cross the boundary
/// differently and cannot both go through serde: `diagnostics` is plain data, while `session` is an
/// exported class whose Rust value stays on this side of the wall with only a handle going over.
/// `serde_wasm_bindgen` has no way to place that handle inside a serialized object, which is what
/// `js-sys` is in the dependency table for.
///
/// `encoding` parses through `EncodingKind::parse`, which answers `None` for an unknown name — a
/// renderer sending a typo gets an error rather than a silent default decoding the tape as something
/// else entirely.
#[wasm_bindgen]
pub fn compile(src: &str, encoding: &str) -> Result<JsValue, JsValue> {
    let kind =
        EncodingKind::parse(encoding).ok_or_else(|| JsValue::from_str(&format!("unknown encoding {encoding:?}")))?;
    let compiled = session::Session::compile(src, kind);

    let out = js_sys::Object::new();
    let diagnostics = to_value(&compiled.diagnostics)?;
    js_sys::Reflect::set(&out, &JsValue::from_str("diagnostics"), &diagnostics)?;
    let handle = match compiled.session {
        Some(s) => JsValue::from(Session(s)),
        None => JsValue::NULL,
    };
    js_sys::Reflect::set(&out, &JsValue::from_str("session"), &handle)?;
    Ok(out.into())
}

/// `classifySource(src)` -> `[Span, TokenClass][]`.
///
/// NO SESSION, BY DESIGN. An editor highlights while a program is mid-edit and unparseable, so this
/// path must not depend on anything a compile produces.
#[wasm_bindgen(js_name = classifySource)]
pub fn classify_source(src: &str) -> Result<JsValue, JsValue> {
    to_value(&session::classify_source(src))
}

/// `analyze(src)` -> `Diagnostic[]`.
///
/// THE LINT PATH, and the reason it is not `compile`: see `session::analyze`.
#[wasm_bindgen]
pub fn analyze(src: &str) -> Result<JsValue, JsValue> {
    to_value(&session::analyze(src))
}

/// `encodings()` -> every encoding name `compile` accepts, in `EncodingKind::ALL`'s declaration order.
///
/// EXPORTED RATHER THAN HARDCODED IN THE UI. A TypeScript array of names would be a second
/// authoritative registry, which is precisely what `encoding_kinds!` exists to prevent — and worse
/// than the Rust case it prevents, because not even the compiler is watching a list in another
/// language. Generated from the same rows as `ALL`, `name` and `parse`, so a third encoding reaches
/// the picker with no TypeScript edit.
#[wasm_bindgen]
pub fn encodings() -> Result<JsValue, JsValue> {
    to_value(&EncodingKind::ALL.iter().map(|k| k.name()).collect::<Vec<_>>())
}

/// `session.rs`'s error type as a JS `Error`-shaped value. The ONE conversion every fallible method
/// below shares, so no method invents its own wording and none of them can panic instead.
fn err(e: session::SessionError) -> JsValue {
    JsValue::from_str(&e.to_string())
}

/// THE ONE SERIALIZER, so the boundary answers `None` the same way everywhere.
///
/// `serde_wasm_bindgen`'s default renders `Option::None` as `undefined`, and §5.1's TypeScript writes
/// every optional as `T | null` — a renderer testing `x === null` would get it wrong. Getting this
/// right only for top-level returns (`lambdaAst`, `sourceSpan`) and leaving struct FIELDS on the
/// default was worse than either choice alone: `lambdaStatus().run` would have been `undefined` while
/// `lambdaAst()` was `null`, so one boundary would need two rules in the renderer. One serializer,
/// one rule.
fn to_value<T: Serialize>(v: &T) -> Result<JsValue, JsValue> {
    let s = serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true);
    Ok(v.serialize(&s)?)
}

#[wasm_bindgen]
impl Session {
    // --- the λ leg ----------------------------------------------------------------------------

    #[wasm_bindgen(js_name = lambdaStatus)]
    pub fn lambda_status(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.lambda_status())
    }

    #[wasm_bindgen(js_name = stepLambda)]
    pub fn step_lambda(&mut self) -> Result<bool, JsValue> {
        self.0.step_lambda().map_err(err)
    }

    #[wasm_bindgen(js_name = lambdaState)]
    pub fn lambda_state(&self, byte_budget: usize) -> Result<JsValue, JsValue> {
        let st = self.0.lambda_state(byte_budget).map_err(err)?;
        to_value(&st)
    }

    #[wasm_bindgen(js_name = lambdaAst)]
    pub fn lambda_ast(&self, node_budget: usize) -> Result<JsValue, JsValue> {
        to_value(&self.0.lambda_ast(node_budget).map_err(err)?)
    }

    /// `u32` RATHER THAN THE `u64` THE CURSOR TAKES, widened here. wasm-bindgen maps `u64` to JS
    /// `bigint`, so a `u64` parameter would make §5.1's `raiseLambdaCap(extra: number)` a `bigint` at
    /// the call site and force every caller to write `BigInt(n)`. Nothing is lost: the raise is
    /// ADDITIVE and saturating, so a caller wanting more than 4.29e9 extra steps calls it twice.
    #[wasm_bindgen(js_name = raiseLambdaCap)]
    pub fn raise_lambda_cap(&mut self, extra: u32) -> Result<(), JsValue> {
        self.0.raise_lambda_cap(u64::from(extra)).map_err(err)
    }

    #[wasm_bindgen(js_name = lambdaValue)]
    pub fn lambda_value(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.lambda_value().map_err(err)?)
    }

    /// `u32` and widened, for the reason `raiseLambdaCap` above records: wasm-bindgen maps `u64` to
    /// JS `bigint`, and §5.1 writes every count as `number`. A caller wanting a chunk larger than
    /// 4.29e9 steps is asking for a freeze, not a chunk.
    #[wasm_bindgen(js_name = runLambda)]
    pub fn run_lambda(&mut self, budget: u32) -> Result<JsValue, JsValue> {
        let st = self.0.run_lambda(u64::from(budget)).map_err(err)?;
        to_value(&st)
    }

    // --- the TM leg ---------------------------------------------------------------------------

    #[wasm_bindgen(js_name = tmStatus)]
    pub fn tm_status(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.tm_status())
    }

    #[wasm_bindgen(js_name = tmProgram)]
    pub fn tm_program(&self) -> Result<JsValue, JsValue> {
        let p = self.0.tm_program().map_err(err)?;
        to_value(&p)
    }

    #[wasm_bindgen(js_name = stepTm)]
    pub fn step_tm(&mut self) -> Result<bool, JsValue> {
        self.0.step_tm().map_err(err)
    }

    #[wasm_bindgen(js_name = tmState)]
    pub fn tm_state(&self, radius: usize) -> Result<JsValue, JsValue> {
        let st = self.0.tm_state(radius).map_err(err)?;
        to_value(&st)
    }

    #[wasm_bindgen(js_name = tapeSlice)]
    pub fn tape_slice(&self, tape: usize, from: usize, to: usize) -> Result<JsValue, JsValue> {
        let cells = self.0.tape_slice(tape, from, to).map_err(err)?;
        to_value(&cells)
    }

    /// `u32` and widened, for the reason `raiseLambdaCap` above records.
    #[wasm_bindgen(js_name = raiseTmCap)]
    pub fn raise_tm_cap(&mut self, extra_steps: u32, extra_cells: u32) -> Result<(), JsValue> {
        self.0.raise_tm_cap(u64::from(extra_steps), u64::from(extra_cells)).map_err(err)
    }

    #[wasm_bindgen(js_name = tmValue)]
    pub fn tm_value(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.tm_value().map_err(err)?)
    }

    // --- the reference leg --------------------------------------------------------------------

    /// BLOCKS THE MAIN THREAD FOR UP TO 5,000,000 INTERPRETER STEPS, and cannot be chunked — see
    /// `session::evaluate` for why `eval` has no resumable form. `evaluateWithBudget` is how a caller
    /// bounds that.
    #[wasm_bindgen]
    pub fn evaluate(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.evaluate())
    }

    /// `evaluateWithBudget(budget)` -> `Decoded`, where an exhausted budget arrives as a `Fault`.
    ///
    /// `u32` and widened, for the reason `raiseLambdaCap` above records.
    #[wasm_bindgen(js_name = evaluateWithBudget)]
    pub fn evaluate_with_budget(&self, budget: u32) -> Result<JsValue, JsValue> {
        to_value(&self.0.evaluate_with_budget(u64::from(budget)))
    }

    #[wasm_bindgen(js_name = sourceSpan)]
    pub fn source_span(&self, node: u32) -> Result<JsValue, JsValue> {
        to_value(&self.0.source_span(node))
    }
}
