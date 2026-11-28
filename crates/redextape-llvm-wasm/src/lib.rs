//! The `#[wasm_bindgen]` surface for `redextape-llvm`, built into `pkg-llvm/`. Marshalling only: every decision
//! lives in `redextape-llvm`. It keeps no state, so a page asks again for each program.
//!
//! A panic under wasm aborts the module, so the export returns `Result<_, JsValue>`.

use redextape_llvm::{LlvmInput, decline_reason, llvm_listing};
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// `llvmIr(input)`, where `input` is a `clifInput()`: the LLVM IR the LLVM backend builds from the program,
/// before any pass, an `LlvmListing`.
///
/// # Errors
///
/// `llvmIr: not a clifInput(): <error>` when `input` does not deserialize, and `decline_reason`'s sentence when
/// the LLVM backend would refuse the program.
#[wasm_bindgen(js_name = llvmIr)]
pub fn llvm_ir(input: JsValue) -> Result<JsValue, JsValue> {
    let input: LlvmInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("llvmIr: not a clifInput(): {e}")))?;
    let listing = llvm_listing(&input.program).map_err(|e| JsValue::from_str(&decline_reason(&e)))?;
    listing
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsValue::from_str(&format!("llvmIr: {e}")))
}
