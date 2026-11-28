//! The LLVM view's IR: the module the LLVM backend builds from a program, as `redextape_native::llvm_text`
//! writes it without LLVM, turned into lines for a view to list. Each line carries the rxm pc whose
//! instruction wrote it, so a view can follow a run through the IR.

use redextape_core::tm::{LowerError, Program};
use redextape_native::{LlModule, llvm_text};

pub use redextape_native::decline_reason;

/// What a listing is built from: the `clifInput()` value the clif package takes, of which only the
/// program is read, so its type and caps cross and are ignored.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct LlvmInput {
    pub program: Program,
}

/// One line of the module's text.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct LlvmLine {
    /// The line as LLVM prints it, without its newline.
    pub text: String,
    /// The rxm pc of the instruction whose lowering wrote the line: its `i<pc>` block and the `cont` blocks its
    /// guards opened. `None` for every other line: the header lines, the declarations and each intrinsic's comment,
    /// a function's `define`, `prologue` and `exit` blocks and closing `}`, the `attributes` line and blank lines.
    pub pc: Option<u32>,
}

/// One function the module defines.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct LlvmFunction {
    /// Its name as the text prints it after `@`: `"$main"`, `fact.0`.
    pub name: String,
    /// The rxm subroutine it was built from, as `partition` names it: `$main`, `fact.0`.
    pub label: String,
    /// The index of its `define` line in `LlvmListing::lines`.
    pub first_line: u32,
}

/// The lines of a program's LLVM IR, as built.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct LlvmListing {
    pub functions: Vec<LlvmFunction>,
    pub lines: Vec<LlvmLine>,
}

/// `prog`'s LLVM IR as the LLVM backend builds it, before any pass, as lines.
///
/// # Errors
/// `llvm_text`'s: whatever the LLVM backend refuses.
pub fn llvm_listing(prog: &Program) -> Result<LlvmListing, LowerError> {
    Ok(listing(llvm_text(prog)?))
}

fn listing(module: LlModule) -> LlvmListing {
    let index = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    LlvmListing {
        functions: module
            .functions
            .into_iter()
            .map(|f| LlvmFunction { name: f.name, label: f.label, first_line: index(f.first_line) })
            .collect(),
        lines: module.lines.into_iter().map(|l| LlvmLine { text: l.text, pc: l.pc.map(index) }).collect(),
    }
}
