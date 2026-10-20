//! Object-size regression gate. Sizes are deterministic for a given (target triple, toolchain), but
//! NOT across them — so baselines are per target triple and record the toolchain that produced them.
//! A 10% band absorbs unrelated churn.
//!
//! # What this gate does and does not protect (read before trusting it)
//!
//! It catches an **LLVM** pass that has stopped firing, and **not a Cranelift one**. That is
//! arithmetic, not a bug: an optimizer that stops firing makes a level's measured size revert to its
//! `O0` size, and the gate compares that against the OPTIMIZED baseline row. Off this repo's own
//! `baselines/aarch64-apple-darwin.txt` (`O0` size vs the `O3` row it would be measured against),
//! every LLVM row clears the ±10% band (`list30000` by the thinnest margin); every Cranelift row sits
//! an order of magnitude inside it. Cranelift's ISA-level optimizer changes *which* instructions are
//! selected far more than *how many* there are, so its object sizes barely move. Mapping all six
//! levels onto `"none"` in `codegen::cranelift_opt_level` leaves THIS TEST GREEN.
//!
//! **Do not tighten `TOLERANCE` to chase the Cranelift deltas.** A band narrow enough to catch 1%
//! would fire on ordinary codegen churn — a gate that cries wolf gets deleted. Cranelift's
//! opt-level liveness is covered directly instead, by an assertion that unoptimized and optimized
//! output must DIFFER (any amount) rather than by a size band:
//! `jit::tests::the_opt_level_reaches_the_jits_own_isa` (the JIT's ISA, over emitted code bytes) and
//! `aot::tests::the_opt_level_reaches_the_cranelift_isa` (the AOT ISA, over object bytes). Both fail
//! under that mapping.
//!
//! The check is BIDIRECTIONAL, deliberately. Every measured row must have a baseline entry within
//! tolerance (catches a size regression), AND every baseline entry must be claimed by a measured row
//! (catches orphans). Without the second direction the gate has a blind side: shrink `CORPUS` and the
//! removed program's rows sit in the file forever as dead weight that nothing ever flags, and a
//! typo'd program name in a hand-edited baseline would be silently ignored rather than reported.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
#![cfg(all(feature = "cranelift", feature = "llvm"))]

use redextape_native::measure::measure_all;

/// Fraction a measured size may drift from the baseline before the gate fails.
const TOLERANCE: f64 = 0.10;

#[test]
fn object_sizes_match_the_baseline_for_this_target() {
    let triple = env!("TARGET_TRIPLE");
    let path = format!("{}/baselines/{triple}.txt", env!("CARGO_MANIFEST_DIR"));
    let Ok(text) = std::fs::read_to_string(&path) else {
        // A missing baseline must be VISIBLE, never a silent pass — an absent file would otherwise
        // masquerade as a green gate on any new target.
        println!("NOTE: no size baseline for target `{triple}` ({path}); skipping the size gate.");
        println!(
            "      generate one with: cargo run --release --example opt_report -p redextape-native --features llvm -- --write-baseline"
        );
        return;
    };
    let mut baseline = std::collections::HashMap::new();
    for line in text.lines().filter(|l| !l.starts_with('#') && !l.trim().is_empty()) {
        let mut f = line.split('\t');
        let (Some(p), Some(b), Some(o), Some(n)) = (f.next(), f.next(), f.next(), f.next()) else {
            panic!("malformed baseline line: {line:?}");
        };
        baseline.insert((p.to_string(), b.to_string(), o.to_string()), n.parse::<usize>().expect("byte count"));
    }
    assert!(!baseline.is_empty(), "baseline file {path} has no rows");

    // Direction 1: every measured row has a baseline entry, within tolerance. `unclaimed` starts as
    // every baseline key and loses each one a measurement accounts for, leaving exactly the orphans.
    let mut unclaimed: std::collections::HashSet<_> = baseline.keys().cloned().collect();
    let mut drifted = Vec::new();
    for m in measure_all() {
        let key = (m.program.to_string(), m.backend.name().to_string(), format!("{:?}", m.opt));
        let Some(&want) = baseline.get(&key) else {
            panic!("no baseline row for {key:?} — regenerate the baseline");
        };
        unclaimed.remove(&key);
        let delta = (m.object_bytes as f64 - want as f64) / want as f64;
        if delta.abs() > TOLERANCE {
            drifted.push(format!("{key:?}: baseline {want} B, measured {} B ({:+.1}%)", m.object_bytes, delta * 100.0));
        }
    }
    assert!(drifted.is_empty(), "object size drifted beyond {:.0}%:\n  {}", TOLERANCE * 100.0, drifted.join("\n  "));

    // Direction 2: every baseline entry was claimed by a measured row. Sorted so the message is
    // deterministic — `HashSet` iteration order is not.
    let mut orphaned: Vec<_> = unclaimed.into_iter().map(|k| format!("{k:?}")).collect();
    orphaned.sort();
    assert!(
        orphaned.is_empty(),
        "baseline rows no measurement produced (stale after a corpus change?) — regenerate the baseline:\n  {}",
        orphaned.join("\n  ")
    );
}
