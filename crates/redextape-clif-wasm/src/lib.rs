//! The `#[wasm_bindgen]` surface for `redextape-clif`, built into `pkg-clif/`. Marshalling only: every decision lives
//! in `redextape-clif`.
//!
//! A panic under wasm aborts the module, so every export that can fail returns `Result<_, JsValue>`.

use redextape_clif::{ClifInput, ClifLeg, ClifWindow};
use redextape_native::Listing;
use redextape_wire::to_value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// One compile's CLIF leg, built from what `pkg/`'s `Session::clifInput` wrote.
#[wasm_bindgen]
pub struct ClifSession(ClifLeg);

#[wasm_bindgen]
impl ClifSession {
    /// `new ClifSession(input, listing)`, where `input` is a `clifInput()` and `listing` is `"as-built"` or
    /// `"optimised"`, with the cursor and the scout at step 0 under the input's caps.
    ///
    /// # Errors
    ///
    /// `ClifSession: not a clifInput(): <error>` when `input` does not deserialize, `unknown listing "<name>"` for a
    /// name `Listing::parse` refuses, and `ClifSession: <error>` when the CLIF cannot be built.
    #[wasm_bindgen(constructor)]
    pub fn new(input: JsValue, listing: &str) -> Result<ClifSession, JsValue> {
        let input: ClifInput = serde_wasm_bindgen::from_value(input)
            .map_err(|e| JsValue::from_str(&format!("ClifSession: not a clifInput(): {e}")))?;
        let listing =
            Listing::parse(listing).ok_or_else(|| JsValue::from_str(&format!("unknown listing {listing:?}")))?;
        let leg = ClifLeg::new(input, listing).map_err(|e| JsValue::from_str(&format!("ClifSession: {e:?}")))?;
        Ok(ClifSession(leg))
    }

    /// # Errors
    ///
    /// Returns `Err` only if `to_value` cannot marshal the listing; not expected for the types this crate marshals.
    pub fn listing(&self) -> Result<JsValue, JsValue> {
        to_value(self.0.listing())
    }

    /// Steps the scout at most `budget` steps; `true` once it has found the run's end. `u32` and widened, so that
    /// the budget crosses as a number rather than a `BigInt`.
    #[wasm_bindgen(js_name = findEnd)]
    pub fn find_end(&mut self, budget: u32) -> bool {
        self.0.find_end(u64::from(budget))
    }

    /// # Errors
    ///
    /// Returns `Err` only if `to_value` cannot marshal the status; not expected for the types this crate marshals.
    pub fn status(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.status())
    }

    /// Back to step 0 under the input's caps.
    pub fn rewind(&mut self) {
        self.0.rewind();
    }

    /// `false` once the cursor has ended or paused at a cap; `status()` says which.
    pub fn step(&mut self) -> bool {
        self.0.step()
    }

    /// `state(window)`, where `window` is a `ClifWindow`, `{ values, frames, cells, boxes }`, each a count, read as
    /// `Session::rxmState` reads an `RxmWindow`.
    ///
    /// # Errors
    ///
    /// Returns `Err` when `window` is not a `ClifWindow`, with the deserializer's message.
    pub fn state(&self, window: JsValue) -> Result<JsValue, JsValue> {
        let window: ClifWindow = serde_wasm_bindgen::from_value(window)
            .map_err(|e| JsValue::from_str(&format!("state: not a ClifWindow: {e}")))?;
        to_value(&self.0.state(window))
    }

    /// # Errors
    ///
    /// Returns `Err` only if `to_value` cannot marshal the `Decoded`; not expected for the types this crate marshals.
    pub fn value(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.value())
    }

    /// `u32` and widened, for `findEnd`'s reason.
    #[wasm_bindgen(js_name = raiseCap)]
    pub fn raise_cap(&mut self, extra_steps: u32) {
        self.0.raise_cap(u64::from(extra_steps));
    }
}
