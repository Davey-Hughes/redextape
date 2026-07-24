//! The native backend: Core -> register-asm -> machine code (JIT/AOT via Cranelift, or JIT via
//! LLVM), a fourth oracle leg with two swappable codegen backends behind the `Codegen` seam.
use redextape_core::core::{Core, NodeId};
use redextape_core::tm::{AsmOutcome, Caps, LowerError};
#[cfg(any(feature = "cranelift", feature = "llvm"))]
use redextape_core::tm::{Program, defunc, lower_asm};

pub mod analysis;
#[cfg(feature = "cranelift")]
pub mod aot;
#[cfg(feature = "cranelift")]
pub mod codegen;
#[cfg(feature = "cranelift")]
pub mod jit;
#[cfg(feature = "llvm")]
pub mod llvm;
#[cfg(any(feature = "cranelift", feature = "llvm"))]
pub mod shared;

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
/// Shared by both backends (Cranelift and LLVM), so its cfg is widened to either being enabled.
#[cfg(any(feature = "cranelift", feature = "llvm"))]
fn lower_program(core: &Core) -> Result<Program, LowerError> {
    match lower_asm(core) {
        Ok(p) => return Ok(p),
        Err(LowerError::Unsupported { .. }) => {}
        Err(e @ LowerError::TooDeep { .. }) => return Err(e),
    }
    let defunced = defunc(core)?;
    lower_asm(&defunced)
}

/// A `LowerError::Unsupported` reporting that `redextape-native` was built without `feature`'s
/// codegen backend compiled in. Available in every feature config (including neither), so both
/// `run_native_with` variants below can name it. When BOTH backends are compiled in, every call site
/// is `#[cfg]`'d out (every arm has its real backend), so this legitimately goes unused there.
#[allow(dead_code)]
fn unsupported(feature: &str) -> NativeRun {
    NativeRun::LowerError(LowerError::Unsupported {
        node: NodeId::default(),
        what: format!("redextape-native built without the `{feature}` feature"),
    })
}

/// LLVM optimization level (drives both the IR pass pipeline and the JIT codegen opt level).
/// Unconditional (no feature gate) so downstream code can name it in any build configuration.
///
/// `O0`..`O3` are LLVM's speed-oriented ladder; `Os`/`Oz` are its two SIZE-oriented pipelines, which
/// are not simply points on that ladder — they trade throughput for code size. They are opt-in: `O3`
/// remains the default. See `llvm::pass_pipeline` / `llvm::opt_level` / `llvm::size_attributes` for
/// how each variant reaches LLVM.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum OptLevel {
    /// No optimization: the IR pass pipeline is skipped entirely and codegen runs unoptimized. The
    /// unoptimized leg the `O0 == O1..O3/Os/Oz` differential compares every other level against.
    O0,
    /// `-O1`: the cheap, mostly-local pipeline.
    O1,
    /// `-O2`: the standard optimization pipeline.
    O2,
    /// `-O3`: the most aggressive speed-oriented pipeline (more inlining and unrolling than `-O2`).
    #[default]
    O3,
    /// `-Os`: optimize for SIZE while keeping most of `-O2`'s speed work — the pipeline backs off
    /// the transforms that trade code size for throughput (inlining thresholds, loop unrolling,
    /// vectorization). Carried by the `default<Os>` pipeline plus the `optsize` function attribute.
    Os,
    /// `-Oz`: aggressively MINIMIZE size, accepting a speed cost `Os` would not. Carried by the
    /// `default<Oz>` pipeline plus the `minsize` AND `optsize` function attributes (matching what
    /// `clang -Oz` emits).
    Oz,
}

/// Which native codegen backend to run. Unconditional (no feature gate) for the same reason as
/// `OptLevel`; an arm whose backend isn't compiled in reports `unsupported(..)` at call time.
#[derive(Clone, Copy, Debug)]
pub enum Codegen {
    Cranelift,
    Llvm { opt: OptLevel },
}

/// Lower `core` and run it on the selected native codegen backend. `run_native` == Cranelift.
///
/// This is the `any(cranelift, llvm)` half of `run_native_with`: at least one backend is compiled
/// in, so lowering to `Program` is always worth attempting first; each match arm then runs its own
/// backend if compiled in, or reports `unsupported(..)` otherwise.
#[cfg(any(feature = "cranelift", feature = "llvm"))]
pub fn run_native_with(core: &Core, caps: Caps, codegen: Codegen) -> NativeRun {
    let prog = match lower_program(core) {
        Ok(p) => p,
        Err(e) => return NativeRun::LowerError(e),
    };
    match codegen {
        Codegen::Cranelift => {
            #[cfg(feature = "cranelift")]
            {
                jit::compile_and_run(&prog, caps)
            }
            #[cfg(not(feature = "cranelift"))]
            {
                let _ = (&prog, caps);
                unsupported("cranelift")
            }
        }
        Codegen::Llvm { opt } => {
            #[cfg(feature = "llvm")]
            {
                llvm::compile_and_run(&prog, caps, opt)
            }
            #[cfg(not(feature = "llvm"))]
            {
                let _ = (&prog, caps, opt);
                unsupported("llvm")
            }
        }
    }
}

/// Neither backend is compiled in: there is no codegen to lower a `Program` for, so this variant
/// skips `lower_program` entirely and reports `unsupported(..)` for whichever backend was asked for.
#[cfg(not(any(feature = "cranelift", feature = "llvm")))]
pub fn run_native_with(_core: &Core, caps: Caps, codegen: Codegen) -> NativeRun {
    let _ = caps;
    match codegen {
        Codegen::Cranelift => unsupported("cranelift"),
        Codegen::Llvm { opt } => {
            let _ = opt;
            unsupported("llvm")
        }
    }
}

/// Lower `core` (reusing lower_asm/defunc), JIT-compile, and run on the Cranelift backend.
/// Panic-free, bounded by `caps`. Exactly `run_native_with(core, caps, Codegen::Cranelift)`.
pub fn run_native(core: &Core, caps: Caps) -> NativeRun {
    run_native_with(core, caps, Codegen::Cranelift)
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
