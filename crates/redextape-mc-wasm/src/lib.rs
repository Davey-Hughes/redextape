//! The `#[wasm_bindgen]` surface for `redextape-mc`, built once per target: into `pkg-mc-x86-64/` with the default
//! `x86` feature and into `pkg-mc-arm64/` with `--no-default-features --features arm64`. Marshalling only: every
//! decision lives in `redextape-mc`. It keeps no state, so a page asks again for each program and listing.
//!
//! A panic under wasm aborts the module, so the export returns `Result<_, JsValue>`.

use redextape_mc::{McInput, Target, decline_reason, machine_listing};
use redextape_native::Listing;
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[cfg(all(feature = "x86", feature = "arm64"))]
compile_error!("a machine code package holds one target: build it with `x86` or with `arm64`, not both");
#[cfg(not(any(feature = "x86", feature = "arm64")))]
compile_error!("a machine code package needs its target: build it with `x86` or with `arm64`");

/// The target this package compiles for.
#[cfg(feature = "x86")]
const TARGET: Target = Target::X86_64;
#[cfg(all(feature = "arm64", not(feature = "x86")))]
const TARGET: Target = Target::Arm64;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// `machineCode(input, listing)`, where `input` is a `clifInput()` and `listing` is `"as-built"` or
/// `"optimised"`: the program's machine code on this package's target, an `McListing`.
///
/// # Errors
///
/// `machineCode: not a clifInput(): <error>` when `input` does not deserialize, `unknown listing "<name>"`
/// for a name `Listing::parse` refuses, and `decline_reason`'s sentence when the code cannot be built.
#[wasm_bindgen(js_name = machineCode)]
pub fn machine_code(input: JsValue, listing: &str) -> Result<JsValue, JsValue> {
    let input: McInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("machineCode: not a clifInput(): {e}")))?;
    let listing = Listing::parse(listing).ok_or_else(|| JsValue::from_str(&format!("unknown listing {listing:?}")))?;
    let rows = machine_listing(&input.program, listing, TARGET).map_err(|e| JsValue::from_str(&decline_reason(&e)))?;
    rows.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsValue::from_str(&format!("machineCode: {e}")))
}

/// The target this package compiles for, `x86-64` or `arm64`.
#[wasm_bindgen]
#[must_use]
pub fn target() -> String {
    TARGET.name().to_string()
}
