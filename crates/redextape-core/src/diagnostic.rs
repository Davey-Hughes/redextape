//! Spanned diagnostics. Malformed user input turns into these — the front end never panics on it.

use crate::span::Span;

// SERIALIZED FOR THE SAME REASON `Span` AND `TokenClass` ARE, and by the same one-line mechanism: a
// consumer across a serialization boundary needs these, and a second copy of the same shape declared
// on the far side is drift waiting to happen. `redextape-wasm`'s `compile` returns diagnostics, which
// is what made this the third and fourth types to need it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Diagnostic {
    pub span: Span,
    pub severity: Severity,
    pub message: String,
}

impl Diagnostic {
    pub fn error(span: Span, message: impl Into<String>) -> Self {
        Diagnostic { span, severity: Severity::Error, message: message.into() }
    }

    /// A `Severity::Warning` diagnostic. Warnings never block compilation: `analyze` sets `core` from
    /// the presence of an ERROR, so a program that only warns still desugars, runs, and lowers.
    pub fn warning(span: Span, message: impl Into<String>) -> Self {
        Diagnostic { span, severity: Severity::Warning, message: message.into() }
    }
}
