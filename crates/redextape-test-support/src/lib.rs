//! Test-only helpers shared across this workspace's crates.
//!
//! **A DEV-DEPENDENCY ONLY, and that is the reason this crate exists.** The natural home for
//! `arb_expr_over` would be a feature-gated module inside `redextape-core` — but that would put
//! `proptest` in core's `[dependencies]` as an optional entry, and core's `[dependencies]` is EMPTY by
//! design: the crate is deliberately WASM-clean. A separate crate keeps that invariant intact while
//! still letting `redextape-core` and `redextape-native` share one definition.
//!
//! `ScratchDir` (below) needs no `proptest` at all, so `arb_expr_over` and its `proptest` dependency
//! now sit behind this crate's own `proptest` feature (default-on, so `redextape-core` and
//! `redextape-native`'s existing bare `{ path = ... }` dev-dependency declarations are unaffected).
//! `redextape-cli` only wants the directory guard, and declares `default-features = false` on its
//! dev-dependency so building it alone never pulls `proptest` in at all.

// Test code is exempt from `pedantic`, for the reason `clippy.toml` gives for the
// unwrap/expect/panic set: an assertion is a deliberate panic, and a probe that casts a `u64` step
// count to `f64` to print a ratio is not a defect. This crate has no inline `#[cfg(test)]` module of
// its own — it is itself a test-only helper library, consumed by other crates' tests, not a holder
// of tests — so there is no module-level attribute for `cfg_attr` to stand in for here; kept for
// consistency with the other crates in this workspace, which do have inline test modules.
#![cfg_attr(test, allow(clippy::pedantic))]

//! `ts_derive_scan` (below) is the second thing this crate holds for the same structural reason as
//! the first: two crates need one definition and neither can own it. It needs no `proptest` and is
//! not behind that feature — it is plain `std`, so a consumer that opts out of `proptest` compiles it
//! at no dependency cost.

pub mod ts_derive_scan;

#[cfg(feature = "proptest")]
use proptest::prelude::*;

/// The first-order expression-generator shape shared by four call sites, parameterised by its LEAF
/// strategy. (`arb_wide_ranging_expr` in `redextape-core`'s `tm_width_equivalence.rs` is a separate,
/// DELIBERATELY DIFFERENT generator with the same `prop_recursive(3, 8, 3, …)` parameters but a
/// different four-arm set, whose leaves deliberately cross `MAX_FIELD_WIDTH` to exercise the TM
/// auto-fit retry path and its `Overflow` outcome — not sharing this function there is correct, not an
/// oversight.)
///
/// Every one of the four callers shares this shape — `prop_recursive(3, 8, 3, …)` over five arms: `+`,
/// `-`, a `>` comparison, an `==` comparison, and a three-argument `if`. Callers differ ONLY in what a
/// leaf is: a wide range, a narrow one, or a mix. That is deliberate. Several tests compare results
/// across backends and encodings, and those comparisons only mean something if the programs are drawn
/// from the same distribution shape — four copies of this that could drift independently made a claim
/// nothing enforced.
///
/// DO NOT change the recursion parameters or the arm set without re-measuring every caller that
/// records a rate or a fire count against them. `binary_tm_agrees_while_unary_tm_is_never_wrong_on_
/// random_programs` (in `redextape-native`) documents a measured 60.4% unary fire rate that is a
/// property of THIS shape combined with its leaf strategy. The stronger stake is `redextape-core`'s
/// `three_way_oracle.rs` (`arb_tm_safe_expr`'s doc): its whole `MAX_FIELD_WIDTH`-safety argument — every
/// generated value staying under the TM's fixed-width unary fields — rests on `depth=3` (this
/// function's `prop_recursive` first argument, not `desired_size`) bounding the worst case, measured at
/// a max of 27 over 2M samples. Raising the depth here silently raises that worst case too.
#[cfg(feature = "proptest")]
pub fn arb_expr_over(leaf: impl Strategy<Value = String> + 'static) -> impl Strategy<Value = String> {
    leaf.prop_recursive(3, 8, 3, |inner| {
        prop_oneof![
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} + {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} - {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("if {a} > {b} {{ 1 }} else {{ 0 }}")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("if {a} == {b} {{ 1 }} else {{ 0 }}")),
            (inner.clone(), inner.clone(), inner).prop_map(|(c, a, b)| format!("if {c} > 0 {{ {a} }} else {{ {b} }}")),
        ]
    })
}

/// A uniquely-named directory under the system temp directory, removed on [`Drop`] — but only when the
/// owning thread is not already unwinding from a panic.
///
/// **REPLACES EIGHT NEARLY-IDENTICAL `tmpdir`/`tree` FIXTURE HELPERS** that used to live one per module
/// across `redextape-cli` and `redextape-native`. Every one of them called `std::fs::remove_dir_all` at
/// the START of a fixture, purely to clear whatever a PREVIOUS run of the same binary had left behind
/// — and never at the end, so a passing run's directory and a failing one's alike accumulated forever
/// under `std::env::temp_dir()`. Measured on one machine before this type existed: 1180
/// `redextape-config-*` and 1106 `redextape-lint-*` directories, 5.6 MB — and that machine's `/tmp` is
/// a 30 GiB RAM tmpfs with its own documented history of OOM from exactly this kind of pressure, so
/// this is not merely tidiness.
///
/// **UNIQUE PER CALL, not merely per `label`.** Carries the pid-plus-atomic-counter idiom every one of
/// those helpers already had its own copy of (`redextape-cli`'s `fmt::tests::tmpdir` has the fullest
/// account of why): under `cargo test`, every test in one binary shares a single process id, so two
/// calls with the same `label` would otherwise collide on the same path, and the second call's fixture
/// setup would tread on the first's while it might still be running.
///
/// **REMOVAL IS GATED ON [`std::thread::panicking`], AND THAT IS THE ENTIRE REASON THIS TYPE EXISTS**
/// rather than each call site growing its own `Drop`. A directory left by a PASSING run has nothing
/// left to say and is removed. A directory left by a FAILING one is the evidence a person needs to
/// debug it, and survives — unconditional cleanup (what every helper this replaces did, when it
/// cleaned up at all) throws that evidence away right when it matters most.
///
/// This crate is a plain dependency to every one of its consumers' test targets, not a `#[cfg(test)]`
/// module of its own — so the `Drop` impl below is library code, and this workspace's clippy
/// configuration denies `unwrap`/`expect`/`panic!` in library code. It would be wrong even without
/// that rule: a cleanup that panics while another panic is already unwinding aborts the process
/// instead of reporting either failure. Removal is therefore best-effort and silent — a
/// `remove_dir_all` that fails (permissions, or the directory already gone) is not itself worth
/// surfacing.
pub struct ScratchDir {
    path: std::path::PathBuf,
}

impl ScratchDir {
    /// Create a fresh, uniquely-named directory under [`std::env::temp_dir`], named
    /// `redextape-{label}-{pid}-{seq}`.
    ///
    /// # Errors
    ///
    /// Returns the underlying [`std::io::Error`] if the directory cannot be created (for example, the
    /// system temp directory is missing or not writable).
    pub fn new(label: &str) -> std::io::Result<Self> {
        static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("redextape-{label}-{}-{seq}", std::process::id()));
        // Defensive, not load-bearing: the pid+counter pair above is unique for every call this
        // process makes, so only a pid wraparound landing on the exact same counter value could leave
        // something here already — and even then, only because that earlier run's own `Drop` never ran
        // at all (a hard process abort, not a panic; a panicking thread is exactly the case `Drop`
        // below deliberately leaves standing). Ignored rather than propagated, for the same reason
        // `Drop` ignores its own failure below.
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path)?;
        Ok(Self { path })
    }

    /// This directory's path.
    #[must_use]
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl Drop for ScratchDir {
    fn drop(&mut self) {
        if !std::thread::panicking() {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

/// Lets a `ScratchDir` stand in for the paths under it directly (`dir.join("a.rxt")`,
/// `Command::current_dir(&dir)`) at every call site this type replaces, rather than requiring
/// `dir.path()` at each one.
impl std::ops::Deref for ScratchDir {
    type Target = std::path::Path;

    fn deref(&self) -> &std::path::Path {
        &self.path
    }
}

impl AsRef<std::path::Path> for ScratchDir {
    fn as_ref(&self) -> &std::path::Path {
        &self.path
    }
}

impl std::fmt::Debug for ScratchDir {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.path.fmt(f)
    }
}
