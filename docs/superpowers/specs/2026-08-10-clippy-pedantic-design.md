# Turning on `clippy::pedantic` — 294 warnings, not 1003

**Status:** design. No behaviour change is intended by any commit in this slice; the deliverable is a
lint gate plus whatever the gate forces us to look at.

**This is a policy change with a mechanical tail.** The interesting part is §1 (what the number
actually is) and §4 (why the commit order is not free). Everything else is bookkeeping.

## §0 The measurement, and the correction it forced

`cargo clippy --workspace --all-targets -- -W clippy::pedantic` at `32e0f79` reports **1003**
warnings. That figure was the basis of a first estimate of "~750 in `src/`", and **it was wrong** —
it split production from test code by file path, which counts the 54 inline `#[cfg(test)]` modules
living inside `src/` as production.

Dropping `--all-targets` compiles lib and bin targets only, with no `cfg(test)`, which is exactly the
production surface:

| surface | warnings | disposition |
| --- | --- | --- |
| `tests/` + `examples/` targets (51 files) | 330 | relaxed |
| inline `#[cfg(test)]` modules in `src/` (54) | 379 | relaxed |
| **production lib + bin code** | **294** | **the work** |

The 379 is a derived figure (673 path-matched `src/` warnings minus 294 production), not an
independent count. The 294 and the 330 are measured directly.

Of the 294, **159 carry a `MachineApplicable` suggestion** and 135 do not — measured by counting
`suggestion_applicability` in clippy's JSON, not by trusting the "run `cargo clippy --fix` to apply N
suggestions" summary line, which counts per-target and double-counts across the lib/lib-test pair.

### Distribution

By crate: `redextape-core` 213, `redextape-wasm` 42, `redextape-native-rt` 21, `redextape-native` 18.

By lint, the full production set:

| lint | n | note |
| --- | --- | --- |
| `must_use_candidate` | 125 | all machine-applicable; adds `#[must_use]` across the public API |
| `missing_errors_doc` | 40 | doc prose, no suggestion |
| `cast_possible_truncation` | 40 | core 21, wasm 14, native-rt 5 |
| `single_match_else` | 14 | |
| `doc_markdown` | 13 | |
| `match_same_arms` | 10 | |
| `similar_names` | 8 | |
| `too_many_lines` / `many_single_char_names` | 6 each | |
| `needless_pass_by_value` | 5 | |
| `trivially_copy_pass_by_ref` / `cast_possible_wrap` | 3 each | |
| 9 lints at 2 | 18 | `borrow_as_ptr`, `map_unwrap_or`, `manual_let_else`, … |
| 6 lints at 1 | 6 | includes the only `cast_sign_loss` and `missing_panics_doc` |

**`must_use_candidate` is 43% of the whole thing and is entirely mechanical.** The genuinely
interesting residue is the 44 cast lints.

> **Correction, found during execution of this slice:** 294 was the default-build figure only. `cargo clippy --workspace`
> never compiles `redextape-native` under `--no-default-features` or `--features llvm` — only its
> default `cranelift` feature — so those two configurations' warnings never entered this count.
> They held 14 more: 6 production, 6 inside `#[cfg(test)]`, and 2 in `--no-default-features`
> stubs. The true production figure was **300**, not 294. This document is left as written
> otherwise; it is a point-in-time design record, not the count's permanent home.

## §1 Policy

No global allows. `pedantic` is enabled as written and every production warning is resolved on its
merits, not silenced in the manifest:

```toml
[workspace.lints.clippy]
all = "warn"
pedantic = { level = "warn", priority = -1 }
```

`priority = -1` is defensive rather than currently load-bearing: the five existing per-lint entries
(`unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`) are all `clippy::restriction`, which
is disjoint from both `all` and `pedantic`, so nothing conflicts today. It costs one field and makes
a future per-lint `allow` work rather than error. **Verify it compiles before relying on the
reasoning** — group priority rules have moved between Cargo versions.

Test and example code is exempt. This extends the precedent already set in `clippy.toml`, whose
header explains why an assertion is a deliberate panic; the same argument covers a probe that casts
`u64` step counts to `f64` to print a ratio.

## §2 Mechanism for the exemption

Two different mechanisms, because the two surfaces differ:

**Inline `#[cfg(test)]` modules — one line per crate**, in each `lib.rs`:

```rust
#![cfg_attr(test, allow(clippy::pedantic))]
```

Under `--all-targets` each lib is compiled twice — once as the lib target, once as its test harness.
`cfg(test)` holds only in the second, so this weakens the test pass and leaves production warnings
surfacing from the first. Five lines replace what would otherwise be 54 module-level attributes.

This also covers the four `#[cfg(all(test, feature = "..."))]` modules in `redextape-native` that
`clippy.toml`'s header calls out as *not* reachable by clippy's own in-test detection. That
limitation is specific to clippy's `is_in_test` heuristic; a crate-level `cfg_attr` is ordinary `cfg`
evaluation and is unaffected.

**`tests/` and `examples/` targets — 51 file-level attributes**, one per file:

```rust
#![allow(clippy::pedantic)]
```

There is no per-target lint configuration in Cargo, so this cannot be collapsed. Several of these
files already carry a file-level `#![allow(...)]` for the `unwrap`/`expect`/`panic` set, for the
reason `clippy.toml` documents; this extends the existing attribute where one is present rather than
adding a second.

## §3 The residue worth actual attention

**The 44 cast lints are the only place a "fix" can change behaviour.** Resolving
`cast_possible_truncation` as `u32::try_from(x)?` introduces an error path that did not exist;
resolving it as `#[allow]` with a bounds argument does not. Each site gets one of three outcomes:

1. the cast is provably in range → `#[allow]` plus a comment stating the bound and where it is
   enforced;
2. the cast is not provably in range and the failure is representable → `try_from` with a typed
   error, per the no-panic rule the manifest already encodes;
3. the cast is not provably in range and the failure is not representable → this is a bug, and it is
   the outcome that justifies the exercise.

Outcome 3 is the reason to prefer the minimal allow-list. It has not been observed yet and may not
occur; the design does not assume it will.

**`must_use_candidate` touches the public API.** 125 `#[must_use]` attributes make previously silent
call sites warn. Consumers are `web/` (via `redextape-wasm`) and the workspace's own crates, so blast
radius is bounded and CI covers it — but `redextape-wasm`'s `wasm_bindgen` exports should be spot
checked, since the attribute interacts with generated bindings.

## §4 Commit order is forced, not chosen

The pre-commit hook runs `cargo clippy --workspace --all-targets -- -D warnings` on every commit
touching `*.rs`. **A "config first, fixes later" split therefore cannot exist** — the commit that
adds `pedantic = "warn"` would fail its own hook against 294 outstanding warnings. Inverting it:

1. the machine-applicable batch (159), reviewed rather than trusted — this already absorbs all 125
   `must_use_candidate`, all 13 `doc_markdown` and all 14 `single_match_else`, so those do not
   reappear below
2. `missing_errors_doc` (40) — prose, no suggestion to apply
3. the cast lints (44 = 40 `cast_possible_truncation` + 3 `cast_possible_wrap` + 1 `cast_sign_loss`)
   — §3's three-way disposition, one commit per crate if it gets large. None is machine-applicable:
   clippy's `try_from` suggestion here is `MaybeIncorrect`, which is why these are the residue and
   not the easy part
4. the remainder (51)
5. **the gate**: `Cargo.toml`, the five `cfg_attr` lines, the 51 file-level allows

Commits 1–4 are each clean under the *current* configuration, because resolving a pedantic warning
does not create an `all` warning. Commit 5 turns the gate on against a tree that already satisfies
it. No commit needs `--no-verify`, which the repo does not permit.

## §5 New standing risk this introduces

`rust-toolchain.toml` tracks `channel = "stable"` unpinned, and its header already warns that a new
stable can surface fmt or `-D warnings` failures with no code change. **`pedantic` materially raises
that probability**: it is a much larger and more actively-extended group than `all`, and new pedantic
lints land regularly.

This design does not change the toolchain policy — it notes that the first unexplained red CI run
after a stable release is now more likely to be a new pedantic lint than anything else, and that the
remedy is a per-lint entry in `[workspace.lints.clippy]`, which §1's `priority = -1` exists to
enable.

## §6 Success criteria

- `cargo clippy --workspace --all-targets -- -D warnings` is green with `pedantic` enabled.
- `./scripts/check-all.sh` is green — all four configurations, not just the base one, since three of
  them lint `redextape-native` under feature combinations the default pass never sees.
- The full test suite passes with no test edited to accommodate a lint fix. A fix that requires a
  test change is a behaviour change and belongs in its own commit with its own justification.
- No `#[allow]` is added without an adjacent comment stating why, per the convention the existing
  lint block and `clippy.toml` both follow.
