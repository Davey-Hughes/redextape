//! The `#[wasm_bindgen]` surface. Marshalling only — every decision lives in `session.rs`; see that
//! module's header for why.
//!
//! NO PANIC MAY CROSS THIS BOUNDARY. A Rust panic under wasm is an abort that poisons the module —
//! there is no unwinding to catch it — so every fallible export returns `Result<_, JsValue>`.
//! `console_error_panic_hook` is installed for legibility if one ever escapes, not as a strategy.

// Test code is exempt from `pedantic`, for the reason `clippy.toml` gives for the
// unwrap/expect/panic set: an assertion is a deliberate panic, and a probe that casts a `u64` step
// count to `f64` to print a ratio is not a defect. `cfg_attr` rather than the one module-level
// attribute this crate's own single inline `#[cfg(test)] mod tests` (in `session.rs`) would
// otherwise need — under `--all-targets` each lib compiles twice, and `cfg(test)` holds only in the
// test-harness pass, so production warnings still surface from the other one.
#![cfg_attr(test, allow(clippy::pedantic))]

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
///
/// # Errors
///
/// Returns `Err` when `encoding` is not a name `EncodingKind::parse` recognizes; the JS caller receives
/// a thrown string naming the value it sent (`unknown encoding "..."`) — see `encodings()` for the
/// accepted set. A `to_value`/`Reflect::set` marshalling failure is also possible in principle but not
/// expected for this crate's own types; either way it crosses as a thrown JS exception.
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
///
/// # Errors
///
/// Returns `Err` only if `to_value` cannot marshal the token spans to a JS value. This crate's own
/// types always serialize, so in practice a caller sees this only if `serde-wasm-bindgen` itself
/// changes behaviour; it crosses as a thrown JS exception like any other failure at this boundary.
#[wasm_bindgen(js_name = classifySource)]
pub fn classify_source(src: &str) -> Result<JsValue, JsValue> {
    to_value(&session::classify_source(src))
}

/// `analyze(src)` -> `Diagnostic[]`.
///
/// THE LINT PATH, and the reason it is not `compile`: see `session::analyze`.
///
/// # Errors
///
/// Returns `Err` only if `to_value` cannot marshal the diagnostics list to a JS value; not expected for
/// this crate's own types. It crosses as a thrown JS exception like any other failure at this boundary.
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
///
/// # Errors
///
/// Returns `Err` only if `to_value` cannot marshal the name list to a JS value; not expected for this
/// crate's own types. It crosses as a thrown JS exception like any other failure at this boundary.
#[wasm_bindgen]
pub fn encodings() -> Result<JsValue, JsValue> {
    to_value(&EncodingKind::ALL.iter().map(|k| k.name()).collect::<Vec<_>>())
}

/// `tokenClasses()` -> every `TokenClass` variant's name, in declaration order.
///
/// THE INDEX IS THE DISCRIMINANT, which is the whole reason this exists. `linkIndex` ships span
/// classes as a `Uint8Array` of discriminants rather than as 48,332 interned strings, and a
/// TypeScript array that disagreed about the order would mis-colour every span past the disagreement
/// with nothing failing. `types.ts` asserts its own `TOKEN_CLASSES` against this at startup.
///
/// Same argument as `encodings()` one layer over: a list of names in another language is a second
/// authoritative registry that not even the compiler is watching.
///
/// # Errors
///
/// Returns `Err` only if `to_value` cannot marshal the name list to a JS value; not expected for this
/// crate's own types. It crosses as a thrown JS exception like any other failure at this boundary.
#[wasm_bindgen(js_name = tokenClasses)]
pub fn token_classes() -> Result<JsValue, JsValue> {
    to_value(&redextape_core::analysis::token_class_names())
}

/// The lowering's tape names, in tape order. The NINTH export.
///
/// EXPORTED RATHER THAN HARDCODED, for the reason `encodings()` gives one export up: a TypeScript
/// array of names is a second authoritative registry that not even the compiler is watching. Five
/// unlabeled tape rows are unreadable, so the UI needs names; this is where they come from.
///
/// A CONSUMER MUST NOT TREAT ITS LENGTH AS EVERY MACHINE'S TAPE COUNT. These name the tapes THIS
/// compiler emits. `tmProgram().tapes` is the count for the machine in hand, and Plan 5d's
/// hand-written machines may declare up to `MAX_TAPES`. Label tape `i` with `names[i]` when one
/// exists and positionally otherwise — see `TAPE_NAMES`' own doc.
///
/// # Errors
///
/// Returns `Err` only if `to_value` cannot marshal the name list to a JS value; not expected for this
/// crate's own types. It crosses as a thrown JS exception like any other failure at this boundary.
#[wasm_bindgen(js_name = tapeNames)]
pub fn tape_names() -> Result<JsValue, JsValue> {
    to_value(&redextape_core::tm::TAPE_NAMES)
}

/// `session.rs`'s error type as a JS `Error`-shaped value. The ONE conversion every fallible method
/// below shares, so no method invents its own wording and none of them can panic instead.
///
/// TAKES `SessionError` BY VALUE, AND NOT BECAUSE IT NEEDS TO CONSUME IT: this is used as a bare
/// function item at every one of its twelve call sites below (`.map_err(err)`), which requires
/// `FnOnce(SessionError) -> JsValue` — a `&SessionError`-taking version does not satisfy that and
/// would force a closure (`.map_err(|e| err(&e))`) at all twelve. `SessionError` is a small,
/// cheap-to-copy enum (two unit variants and one `{ usize, usize }`), so there is no cost this would
/// actually save; the twelve-site churn for a private helper is not worth it.
#[allow(clippy::needless_pass_by_value)]
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

    /// # Errors
    ///
    /// Returns `Err` only if `to_value` cannot marshal the status to a JS value; not expected for this
    /// crate's own types.
    #[wasm_bindgen(js_name = lambdaStatus)]
    pub fn lambda_status(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.lambda_status())
    }

    /// # Errors
    ///
    /// Returns `Err` when this session's λ leg is absent — check `lambdaStatus().available` (and read
    /// `.reason`) before stepping. No `to_value` call is involved: the return type is a bare `bool`.
    #[wasm_bindgen(js_name = stepLambda)]
    pub fn step_lambda(&mut self) -> Result<bool, JsValue> {
        self.0.step_lambda().map_err(err)
    }

    /// # Errors
    ///
    /// Returns `Err` when this session's λ leg is absent — check `lambdaStatus().available` first. Also
    /// propagates a `to_value` marshalling failure, structurally possible but not expected for this
    /// crate's own types.
    #[wasm_bindgen(js_name = lambdaState)]
    pub fn lambda_state(&self, byte_budget: usize) -> Result<JsValue, JsValue> {
        let st = self.0.lambda_state(byte_budget).map_err(err)?;
        to_value(&st)
    }

    /// # Errors
    ///
    /// Returns `Err` when this session's λ leg is absent — check `lambdaStatus().available` first. An
    /// exhausted `node_budget` is NOT an error: the print refuses and the caller receives `null`
    /// (`TermTree | null`), not a throw.
    #[wasm_bindgen(js_name = lambdaAst)]
    pub fn lambda_ast(&self, node_budget: usize) -> Result<JsValue, JsValue> {
        to_value(&self.0.lambda_ast(node_budget).map_err(err)?)
    }

    /// `u32` RATHER THAN THE `u64` THE CURSOR TAKES, widened here. wasm-bindgen maps `u64` to JS
    /// `bigint`, so a `u64` parameter would make §5.1's `raiseLambdaCap(extra: number)` a `bigint` at
    /// the call site and force every caller to write `BigInt(n)`. Nothing is lost: the raise is
    /// ADDITIVE and saturating, so a caller wanting more than 4.29e9 extra steps calls it twice.
    ///
    /// # Errors
    ///
    /// Returns `Err` when this session's λ leg is absent. Raising a cap that was not hit is harmless
    /// (`raise_lambda_cap` is additive), so this only ever fires for a session with no λ leg at all.
    #[wasm_bindgen(js_name = raiseLambdaCap)]
    pub fn raise_lambda_cap(&mut self, extra: u32) -> Result<(), JsValue> {
        self.0.raise_lambda_cap(u64::from(extra)).map_err(err)
    }

    /// # Errors
    ///
    /// Returns `Err` when this session's λ leg is absent — check `lambdaStatus().available` first. An
    /// unfinished run is NOT an error: it decodes as `Decoded::Unfinished`, not a throw.
    #[wasm_bindgen(js_name = lambdaValue)]
    pub fn lambda_value(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.lambda_value().map_err(err)?)
    }

    /// `u32` and widened, for the reason `raiseLambdaCap` above records: wasm-bindgen maps `u64` to
    /// JS `bigint`, and §5.1 writes every count as `number`. A caller wanting a chunk larger than
    /// 4.29e9 steps is asking for a freeze, not a chunk.
    ///
    /// # Errors
    ///
    /// Returns `Err` when this session's λ leg is absent — check `lambdaStatus().available` first. A
    /// budget that runs out mid-run is NOT an error: the returned status distinguishes `Running` from
    /// `Ended`, so the caller knows whether to call again.
    #[wasm_bindgen(js_name = runLambda)]
    pub fn run_lambda(&mut self, budget: u32) -> Result<JsValue, JsValue> {
        let st = self.0.run_lambda(u64::from(budget)).map_err(err)?;
        to_value(&st)
    }

    // --- the TM leg ---------------------------------------------------------------------------

    /// # Errors
    ///
    /// Returns `Err` only if `to_value` cannot marshal the status to a JS value; not expected for this
    /// crate's own types.
    #[wasm_bindgen(js_name = tmStatus)]
    pub fn tm_status(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.tm_status())
    }

    /// # Errors
    ///
    /// Returns `Err` when this session's TM leg is absent — check `tmStatus().available` first.
    #[wasm_bindgen(js_name = tmProgram)]
    pub fn tm_program(&self) -> Result<JsValue, JsValue> {
        let p = self.0.tm_program().map_err(err)?;
        to_value(&p)
    }

    /// # Errors
    ///
    /// Returns `Err` when this session's TM leg is absent — check `tmStatus().available` first. No
    /// `to_value` call is involved: the return type is a bare `bool`.
    #[wasm_bindgen(js_name = stepTm)]
    pub fn step_tm(&mut self) -> Result<bool, JsValue> {
        self.0.step_tm().map_err(err)
    }

    /// # Errors
    ///
    /// Returns `Err` when this session's TM leg is absent — check `tmStatus().available` first.
    #[wasm_bindgen(js_name = tmState)]
    pub fn tm_state(&self, radius: usize) -> Result<JsValue, JsValue> {
        let st = self.0.tm_state(radius).map_err(err)?;
        to_value(&st)
    }

    /// # Errors
    ///
    /// Returns `Err` when this session's TM leg is absent, or when `tape` names a tape the machine does
    /// not have — the thrown message carries both the requested index and the machine's actual tape
    /// count, so the caller can tell which failure it hit (and can read the count from
    /// `tmProgram().tapes` up front to avoid the second case).
    #[wasm_bindgen(js_name = tapeSlice)]
    pub fn tape_slice(&self, tape: usize, from: usize, to: usize) -> Result<JsValue, JsValue> {
        let cells = self.0.tape_slice(tape, from, to).map_err(err)?;
        to_value(&cells)
    }

    /// `u32` and widened, for the reason `raiseLambdaCap` above records.
    ///
    /// # Errors
    ///
    /// Returns `Err` when this session's TM leg is absent. Raising a cap that was not hit is harmless
    /// (both caps are additive), so this only ever fires for a session with no TM leg at all.
    #[wasm_bindgen(js_name = raiseTmCap)]
    pub fn raise_tm_cap(&mut self, extra_steps: u32, extra_cells: u32) -> Result<(), JsValue> {
        self.0.raise_tm_cap(u64::from(extra_steps), u64::from(extra_cells)).map_err(err)
    }

    /// # Errors
    ///
    /// Returns `Err` when this session's TM leg is absent — check `tmStatus().available` first. A
    /// capped (not-yet-halted) machine is NOT an error: it decodes as `Decoded::Unfinished`.
    #[wasm_bindgen(js_name = tmValue)]
    pub fn tm_value(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.tm_value().map_err(err)?)
    }

    // --- the reference leg --------------------------------------------------------------------

    /// BLOCKS THE MAIN THREAD FOR UP TO 5,000,000 INTERPRETER STEPS, and cannot be chunked — see
    /// `session::evaluate` for why `eval` has no resumable form. `evaluateWithBudget` is how a caller
    /// bounds that.
    ///
    /// # Errors
    ///
    /// Returns `Err` only if `to_value` cannot marshal the decoded result; not expected for this
    /// crate's own types. The interpreter's own failure modes (budget exhaustion, an undecodable type)
    /// are not errors here — they arrive as `Decoded::Fault`/`Decoded::Undecodable`.
    #[wasm_bindgen]
    pub fn evaluate(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.evaluate())
    }

    /// `evaluateWithBudget(budget)` -> `Decoded`, where an exhausted budget arrives as a `Fault`.
    ///
    /// `u32` and widened, for the reason `raiseLambdaCap` above records.
    ///
    /// # Errors
    ///
    /// Returns `Err` only if `to_value` cannot marshal the decoded result; not expected for this
    /// crate's own types. An exhausted budget is not an error — see this function's own doc above: it
    /// arrives as a tagged `Fault`.
    #[wasm_bindgen(js_name = evaluateWithBudget)]
    pub fn evaluate_with_budget(&self, budget: u32) -> Result<JsValue, JsValue> {
        to_value(&self.0.evaluate_with_budget(u64::from(budget)))
    }

    /// # Errors
    ///
    /// Returns `Err` only if `to_value` cannot marshal the result; not expected for this crate's own
    /// types. A node with no recorded span answers `None` (JS `null`), not a throw.
    #[wasm_bindgen(js_name = sourceSpan)]
    pub fn source_span(&self, node: u32) -> Result<JsValue, JsValue> {
        to_value(&self.0.source_span(node))
    }

    /// `linkIndex(byteBudget)` -> the columnar link index for this compile.
    ///
    /// COLUMNAR, BUILT BY HAND, NOT THROUGH SERDE. `serde_wasm_bindgen` would produce arrays of
    /// objects, and the measurement says no: `list60`'s index is 552 KB that way against ~220 KB as
    /// typed arrays, and `prog200`'s is 1.9 MB against ~689 KB. The app recompiles on every 300 ms
    /// typing pause, so this crosses often. Typed arrays are also transferable, which a structured
    /// clone of 48,332 objects is not.
    ///
    /// This is 5a-ii's row-index trade — one `Int32Array` rather than 127,881 row objects — applied
    /// to all three legs at once.
    ///
    /// # Errors
    ///
    /// `self.0.link_index` itself is infallible — see its own doc. What CAN fail here is assembling the
    /// returned object: every `js_sys::Reflect::set` call below is fallible in principle (a hostile
    /// `Proxy` trap, say), and this function propagates any of those with `?` rather than swallowing
    /// them.
    // EVERY `usize as u32` BELOW IS THE IDENTITY, NOT A TRUNCATION, ON THE ONLY TARGET THIS FUNCTION
    // EVER RUNS ON. `#[wasm_bindgen]`'s generated glue and `js_sys`'s typed-array calls execute only
    // compiled to `wasm32-unknown-unknown`: `Cargo.toml`'s `[lib]` comment says `rlib` exists solely so
    // `cargo test` can link `session.rs` natively, while `cdylib` — what `wasm-pack` actually builds
    // and a browser runs — is wasm32-only. `usize` is 32 bits there, bit-for-bit identical to `u32`, so
    // every cast in this function is a no-op on the only target it executes on. This is not merely an
    // argument from target width; the crate is structured so it is also true operationally — this
    // file's own header states every branch lives in `session.rs`, tested natively, BECAUSE `lib.rs`'s
    // glue (this function included) cannot be exercised outside a browser.
    // `crates/redextape-wasm/tests/browser.rs` says the same from the test side ("neither `cargo clippy
    // --all-targets` nor `cargo test --workspace` compiles or runs this tier"), and
    // `.forgejo/workflows/ci.yml`'s browser job says it again ("`#[wasm_bindgen]`'s generated glue ...
    // only execute[s] in a browser"). The lint still fires because clippy also lints the `rlib` build,
    // which targets the host's 64-bit `usize` — a target this function is never actually run compiled
    // for. The lengths cast here (span/node counts, tape-owner counts) carry no separate numeric bound
    // of their own; the bound that matters is this one, on the target, not on the value.
    #[allow(clippy::cast_possible_truncation)]
    #[wasm_bindgen(js_name = linkIndex)]
    pub fn link_index(&self, byte_budget: usize) -> Result<JsValue, JsValue> {
        let index = self.0.link_index(byte_budget);

        let n_spans = index.lambda_spans.len();
        let span_start = js_sys::Uint32Array::new_with_length(n_spans as u32);
        let span_end = js_sys::Uint32Array::new_with_length(n_spans as u32);
        let span_class = js_sys::Uint8Array::new_with_length(n_spans as u32);
        for (i, (span, class)) in index.lambda_spans.iter().enumerate() {
            let i = i as u32;
            span_start.set_index(i, span.start as u32);
            span_end.set_index(i, span.end as u32);
            span_class.set_index(i, *class as u8);
        }

        let pairs = |v: &[(redextape_core::span::Span, u32)]| {
            let start = js_sys::Uint32Array::new_with_length(v.len() as u32);
            let end = js_sys::Uint32Array::new_with_length(v.len() as u32);
            let id = js_sys::Uint32Array::new_with_length(v.len() as u32);
            for (i, (span, node)) in v.iter().enumerate() {
                let i = i as u32;
                start.set_index(i, span.start as u32);
                end.set_index(i, span.end as u32);
                id.set_index(i, *node);
            }
            (start, end, id)
        };
        let (lam_start, lam_end, lam_id) = pairs(&index.lambda_nodes);
        let (src_start, src_end, src_id) = pairs(&index.source_nodes);

        let owner = js_sys::Int32Array::new_with_length(index.tm_owner.len() as u32);
        for (i, o) in index.tm_owner.iter().enumerate() {
            owner.set_index(i as u32, *o);
        }

        let out = js_sys::Object::new();
        let set = |k: &str, v: &JsValue| js_sys::Reflect::set(&out, &JsValue::from_str(k), v);
        set("lambdaText", &JsValue::from_str(&index.lambda_text))?;
        set(
            "lambdaCut",
            &match index.lambda_cut {
                None => JsValue::NULL,
                Some(redextape_core::lambda::Cut::Bytes) => JsValue::from_str("Bytes"),
                Some(redextape_core::lambda::Cut::Depth) => JsValue::from_str("Depth"),
            },
        )?;
        set("lambdaSpanStart", &span_start)?;
        set("lambdaSpanEnd", &span_end)?;
        set("lambdaSpanClass", &span_class)?;
        set("lambdaNodeStart", &lam_start)?;
        set("lambdaNodeEnd", &lam_end)?;
        set("lambdaNodeId", &lam_id)?;
        set("sourceNodeStart", &src_start)?;
        set("sourceNodeEnd", &src_end)?;
        set("sourceNodeId", &src_id)?;
        set("tmOwner", &owner)?;
        Ok(out.into())
    }
}
