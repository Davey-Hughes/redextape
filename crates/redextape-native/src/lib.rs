//! The native backend: Core -> register-asm -> machine code (JIT), a fourth oracle leg.
use redextape_core::core::Core;
use redextape_core::tm::{AsmOutcome, Caps, LowerError};
#[cfg(feature = "cranelift")]
use redextape_core::tm::{Program, defunc, lower_asm};

pub mod analysis;
#[cfg(feature = "cranelift")]
pub mod aot;
#[cfg(feature = "cranelift")]
pub mod codegen;
#[cfg(feature = "cranelift")]
pub mod jit;

#[cfg(feature = "cranelift")]
pub use aot::{LinkOptions, LinkerChoice, emit_object, link_executable};

/// An ahead-of-time (AOT) object-emission / link failure. Defined unconditionally (not behind the
/// `cranelift` feature) so the no-`cranelift` `emit_object` stub can name it too. `Link`/`NoLinker`/
/// `NoStaticlib` are produced by the linker driver (Task 6); `emit_object` itself only ever yields
/// `Unsupported`/`Lower`/`Codegen`/`Object`.
#[derive(Debug)]
pub enum AotError {
    /// The program is out of scope for AOT emission (higher-order/non-value result type, or an
    /// over-cap register index) — rejected before emitting, never a panic.
    Unsupported(String),
    /// Partitioning the register-asm `Program` into subroutines failed (`analysis::partition`).
    Lower(LowerError),
    /// The shared Cranelift codegen reported an error translating a subroutine.
    Codegen(String),
    /// Building or emitting the object (ISA setup, `declare`/`define`, `emit`) failed.
    Object(String),
    /// Invoking the system linker failed (Task 6).
    Link(String),
    /// No usable system linker was found (Task 6).
    NoLinker,
    /// The runtime static library (`libredextape_native_rt.a`) could not be located (Task 6).
    NoStaticlib,
}

impl std::fmt::Display for AotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AotError::Unsupported(m) => write!(f, "unsupported for AOT emission: {m}"),
            AotError::Lower(e) => write!(f, "lowering/partition error: {e:?}"),
            AotError::Codegen(m) => write!(f, "native codegen error: {m}"),
            AotError::Object(m) => write!(f, "object emission error: {m}"),
            AotError::Link(m) => write!(f, "link error: {m}"),
            AotError::NoLinker => write!(f, "no usable system linker found"),
            AotError::NoStaticlib => write!(f, "runtime static library not found"),
        }
    }
}

impl std::error::Error for AotError {}

/// Without the `cranelift` feature there is no codegen backend to emit an object file; report that
/// as `Unsupported` (mirroring how `run_native` stubs) rather than failing to build the crate.
#[cfg(not(feature = "cranelift"))]
pub fn emit_object(
    _prog: &redextape_core::tm::Program,
    _caps: Caps,
    _ty: &redextape_core::ty::Ty,
) -> Result<Vec<u8>, AotError> {
    Err(AotError::Unsupported("redextape-native built without the `cranelift` feature".into()))
}

/// Which system linker to request via `cc`. Defined here (rather than only in `aot`) so the
/// no-`cranelift` stub `link_executable` below can still name it -- see `aot::LinkerChoice` for the
/// real (feature-gated) type and its selection policy.
#[cfg(not(feature = "cranelift"))]
#[derive(Clone, Debug)]
pub enum LinkerChoice {
    Auto,
    Default,
    Named(String),
}

/// Options for `link_executable`. See `aot::LinkOptions` (the feature-gated real type) for details.
#[cfg(not(feature = "cranelift"))]
#[derive(Clone, Debug)]
pub struct LinkOptions {
    pub linker: LinkerChoice,
    pub strip: bool,
}

#[cfg(not(feature = "cranelift"))]
impl Default for LinkOptions {
    fn default() -> Self {
        LinkOptions { linker: LinkerChoice::Auto, strip: false }
    }
}

/// Without the `cranelift` feature there is no linker driver to invoke; report that as
/// `Unsupported` (mirroring `emit_object`'s stub) rather than failing to build the crate.
#[cfg(not(feature = "cranelift"))]
pub fn link_executable(_obj: &[u8], _out: &std::path::Path, _opts: &LinkOptions) -> Result<(), AotError> {
    Err(AotError::Unsupported("redextape-native built without the `cranelift` feature".into()))
}

/// The outcome of running a program natively. Decoding to a `Value` is separate (`decode_asm`),
/// mirroring `run_tm` + `decode_tape`.
#[derive(Clone, Debug)]
pub enum NativeRun {
    Ran(AsmOutcome),
    HitCap,
    Fault(String),
    LowerError(LowerError),
}

/// Lower `core` to asm, trying direct (first-order) lowering before defunctionalizing.
///
/// This mirrors `redextape_core::tm`'s own (private) `lower_program` template exactly: try
/// `lower_asm(core)` first; only retry through `defunc` when it rejects the program as higher-order
/// (`LowerError::Unsupported`). A `LowerError::TooDeep` (the deep-Core stack-safety guard) is
/// returned immediately rather than retried -- see that function's doc comment for the rationale.
#[cfg(feature = "cranelift")]
fn lower_program(core: &Core) -> Result<Program, LowerError> {
    match lower_asm(core) {
        Ok(p) => return Ok(p),
        Err(LowerError::Unsupported { .. }) => {}
        Err(e @ LowerError::TooDeep { .. }) => return Err(e),
    }
    let defunced = defunc(core)?;
    lower_asm(&defunced)
}

/// Lower `core` (reusing lower_asm/defunc), JIT-compile, and run. Panic-free, bounded by `caps`.
#[cfg(feature = "cranelift")]
pub fn run_native(core: &Core, caps: Caps) -> NativeRun {
    match lower_program(core) {
        Ok(prog) => jit::compile_and_run(&prog, caps),
        Err(e) => NativeRun::LowerError(e),
    }
}

/// Without the `cranelift` feature there is no codegen backend to run the lowered program on; report
/// that plainly (as an unsupported-lowering outcome) rather than making the crate fail to build.
#[cfg(not(feature = "cranelift"))]
pub fn run_native(_core: &Core, _caps: Caps) -> NativeRun {
    NativeRun::LowerError(LowerError::Unsupported {
        node: redextape_core::core::NodeId::default(),
        what: "redextape-native built without the `cranelift` feature".into(),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn crate_builds_and_exposes_run_native() {
        // A trivial smoke test: the public surface exists and links.
        use redextape_core::desugar::desugar;
        use redextape_core::parser::parse;
        use redextape_core::tm::DEFAULT_CAPS;
        let core = desugar(&parse("1 + 2").0.unwrap());
        let _ = crate::run_native(&core, DEFAULT_CAPS);
    }
}

#[cfg(all(test, feature = "cranelift"))]
mod run_native_tests {
    use super::*;
    use redextape_core::tm::{DEFAULT_CAPS, decode_asm};
    use redextape_core::{desugar::desugar, parser::parse, run, value::Value};

    fn native_value(src: &str) -> Value {
        let core = desugar(&parse(src).0.unwrap());
        let expected = run(src).unwrap();
        match run_native(&core, DEFAULT_CAPS) {
            NativeRun::Ran(o) => decode_asm(&o, &expected).expect("decode"),
            other => panic!("native did not run {src}: {other:?}"),
        }
    }

    #[test]
    fn end_to_end_values() {
        assert_eq!(native_value("1 + 2 * 3"), Value::Nat(7));
        assert_eq!(native_value("3 - 5"), Value::Nat(0));
        assert_eq!(native_value("if 2 > 1 { 10 } else { 20 }"), Value::Nat(10));
        assert_eq!(native_value("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"), Value::Nat(15));
        assert_eq!(native_value("head(tail([1, 2, 3]))"), Value::Nat(2));
        // Escapes FIELD_WIDTH: a value the TM can't represent (> 64).
        assert_eq!(native_value("100 * 100"), Value::Nat(10_000));
    }

    #[test]
    fn higher_order_defuncs_and_runs() {
        assert_eq!(
            native_value(
                "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} \
                 head([5,6].map(add1))"
            ),
            Value::Nat(6)
        );
    }

    #[test]
    fn faults_and_caps() {
        let core = desugar(&parse("head(nil)").0.unwrap());
        assert!(matches!(run_native(&core, DEFAULT_CAPS), NativeRun::Fault(_)));
        let spin = desugar(&parse("fn spin(n){ spin(n) } spin(0)").0.unwrap());
        assert!(matches!(run_native(&spin, DEFAULT_CAPS), NativeRun::HitCap));
    }
}
