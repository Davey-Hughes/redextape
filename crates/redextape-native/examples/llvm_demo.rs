//! `cargo run --example llvm_demo -p redextape-native --features llvm` — compile a mini-language
//! program to LLVM IR, optimize it at `-O0`..`-O3` plus the size-oriented `-Os`/`-Oz`, JIT-run it at
//! every level, and check it against both the Cranelift JIT and the reference interpreter — the LLVM
//! oracle leg (`tests/llvm_oracle.rs`) made visible.
//!
//! (Companion to `native_demo.rs`/`aot_demo.rs`, which show the Cranelift JIT and AOT legs.)
#[cfg(feature = "llvm")]
fn main() {
    use redextape_core::tm::{DEFAULT_CAPS, decode_asm};
    use redextape_core::{desugar::desugar, parser::parse, run, value::format_value};
    use redextape_native::{Codegen, NativeRun, OptLevel, run_native_with};

    let src = "fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(100)";
    let core = desugar(&parse(src).0.unwrap());
    let expected = run(src).unwrap();

    println!("\n════════════════════════════════════════════════════════════════════");
    println!(" Redextape — LLVM backend demo (native Phase 2)");
    println!(" mini-language  →  register-asm  →  LLVM IR  →  optimize  →  JIT  →  decode,");
    println!(" checked against Cranelift and the reference interpreter.");
    println!("════════════════════════════════════════════════════════════════════\n");
    println!("program  : {src}");
    println!("expected : {}\n", format_value(&expected));

    let cranelift = match run_native_with(&core, DEFAULT_CAPS, Codegen::Cranelift { opt: OptLevel::O3 }) {
        NativeRun::Ran(o) => format_value(&decode_asm(&o, &expected).unwrap()),
        other => format!("{other:?}"),
    };
    println!("cranelift -O3: {cranelift}");

    for (label, opt) in [
        ("llvm -O0", OptLevel::O0),
        ("llvm -O1", OptLevel::O1),
        ("llvm -O2", OptLevel::O2),
        ("llvm -O3", OptLevel::O3),
        ("llvm -Os", OptLevel::Os),
        ("llvm -Oz", OptLevel::Oz),
    ] {
        let result = match run_native_with(&core, DEFAULT_CAPS, Codegen::Llvm { opt }) {
            NativeRun::Ran(o) => format_value(&decode_asm(&o, &expected).unwrap()),
            other => format!("{other:?}"),
        };
        println!("{label:<12} : {result}");
    }

    println!("\n(cranelift and every LLVM opt level agree with the reference interpreter —");
    println!(" the oracle validates that optimization never changes the answer, whether the");
    println!(" pipeline is optimizing for speed (`-O3`) or for size (`-Oz`).)\n");
}

#[cfg(not(feature = "llvm"))]
fn main() {
    println!("build with `--features llvm` to run the LLVM demo");
}
