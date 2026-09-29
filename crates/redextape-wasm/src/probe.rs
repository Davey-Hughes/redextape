//! What only the `probe-asm-copy` build exports: an asm copy built under caps the caller names.
//!
//! **A MODULE OF ITS OWN, COMPILED ONLY UNDER THE FEATURE**, so no product build carries an export no product caller
//! has, and `scripts/check-doc-figures.sh`'s count of `lib.rs`'s free exports stays the product's.

use wasm_bindgen::prelude::*;

use crate::{AsmScratch, session, to_value};

/// `asmScratchWithCaps(src, steps, stack, heap, mem)` -> `{ diagnostics, scratch }`, as `asmScratch` answers, with the
/// copy run under these caps rather than `COPY_CAPS`. `web/tests/browser/asm-copy-memory.test.ts` builds a copy under
/// `DEFAULT_CAPS` and under `COPY_CAPS` with it, to read what each costs the worker's memory. Each cap is a `u32`, which
/// every one of `DEFAULT_CAPS`' four fits, so a caller passes plain numbers.
///
/// # Errors
///
/// As `asmScratch`'s: only if marshalling the diagnostics or assembling the object fails.
#[wasm_bindgen(js_name = asmScratchWithCaps)]
pub fn asm_scratch_with_caps(src: &str, steps: u32, stack: u32, heap: u32, mem: u32) -> Result<JsValue, JsValue> {
    let caps = redextape_core::tm::asm::Caps {
        steps: u64::from(steps),
        stack: u64::from(stack),
        heap: u64::from(heap),
        mem: u64::from(mem),
    };
    let made = session::asm_scratch_with_caps(src, caps);
    let out = js_sys::Object::new();
    js_sys::Reflect::set(&out, &JsValue::from_str("diagnostics"), &to_value(&made.diagnostics)?)?;
    let handle = match made.scratch {
        Some(s) => JsValue::from(AsmScratch(s)),
        None => JsValue::NULL,
    };
    js_sys::Reflect::set(&out, &JsValue::from_str("scratch"), &handle)?;
    Ok(out.into())
}
