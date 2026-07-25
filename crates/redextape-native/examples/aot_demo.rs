//! `cargo run --example aot_demo -p redextape-native` — compile a mini-language program to a real
//! standalone native binary, run it, and show its output.
#[cfg(feature = "cranelift")]
fn main() {
    use redextape_core::tm::{DEFAULT_CAPS, lower_asm};
    use redextape_core::typeck::result_type;
    use redextape_core::{desugar::desugar, parser::parse};
    use redextape_native::{LinkOptions, OptLevel, emit_object, link_executable};

    let src = "fn sum(n){ if n == 0 { 0 } else { n + sum(n - 1) } } sum(100)";
    let ast = parse(src).0.unwrap();
    let ty = result_type(&ast).unwrap();
    let prog = lower_asm(&desugar(&ast)).unwrap();
    let obj = emit_object(&prog, DEFAULT_CAPS, &ty, OptLevel::default()).unwrap();
    println!("program : {src}");
    println!("emitted : {} bytes of native object code (type {ty:?})", obj.len());

    let out = std::env::temp_dir().join("redextape_aot_demo");
    match link_executable(&obj, &out, &LinkOptions::default()) {
        Ok(()) => {
            let output = std::process::Command::new(&out).output().expect("run");
            print!("binary  : {}", String::from_utf8_lossy(&output.stdout));
            println!("(exit {}) — a real native binary at {}", output.status.code().unwrap_or(-1), out.display());
        }
        Err(e) => println!("link    : skipped ({e:?}); the .o is valid and was emitted above"),
    }
}

#[cfg(not(feature = "cranelift"))]
fn main() {
    println!("build with the `cranelift` feature to run the AOT demo");
}
