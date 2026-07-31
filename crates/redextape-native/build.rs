// Build script: Cargo guarantees `TARGET`, and a build script has no diagnostic channel to degrade
// into — aborting the build is the only honest failure here.
#![allow(clippy::unwrap_used)]

fn main() {
    // Cargo sets TARGET for build scripts but not for the crate itself; re-export it so tests can
    // select the right per-triple baseline.
    println!("cargo:rustc-env=TARGET_TRIPLE={}", std::env::var("TARGET").unwrap());

    // Record the codegen toolchain versions the size baseline was produced with. Read from the
    // lockfile: there is no Cargo-provided env var for a dependency's resolved version.
    let lock_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../Cargo.lock");
    let lock = std::fs::read_to_string(lock_path).unwrap_or_default();
    let version_of = |name: &str| -> String {
        let needle = format!("name = \"{name}\"");
        lock.split("[[package]]")
            .find(|block| block.contains(&needle))
            .and_then(|block| block.lines().find(|l| l.trim_start().starts_with("version = ")))
            .map(|l| l.trim().trim_start_matches("version = ").trim_matches('"').to_string())
            .unwrap_or_else(|| "unknown".into())
    };
    println!("cargo:rustc-env=CRANELIFT_VERSION={}", version_of("cranelift-codegen"));
    println!("cargo:rustc-env=LLVM_VERSION={}", version_of("llvm-sys"));

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={lock_path}");
}
