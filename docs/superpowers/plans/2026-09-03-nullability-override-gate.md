# Nullability Override Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `ts-rs` field override that misstates whether a field can be `null` fails at the commit, in both directions, and the eleven nullable sites in the generated TypeScript stop depending on incidental test fixtures to stay honest.

**Architecture:** One new public function in `redextape-test-support::ts_derive_scan` scans each crate's own `.rs` files for `ts(type = ...)` / `ts(as = ...)` attributes, resolves each forward to the field it decorates, and panics when the override's replacement type disagrees with whether the Rust field is an `Option`. Both crates' `tests/ts_bindings.rs` gain a third test that calls it — one implementation, two callers, because two copies drift. Separately, `web/tests/node/bindings-contract.test.ts` pins the eleven nullable sites against the *generated* file, which `pnpm run typecheck` builds before `tsc` runs.

**Tech Stack:** Rust 2024, `std` only (no regex — the word-boundary check is a byte comparison), `cargo nextest`, `ts-rs`, TypeScript 5 with `strict`, vitest.

**Design:** [`../specs/2026-09-03-nullability-override-gate-design.md`](../specs/2026-09-03-nullability-override-gate-design.md).

## Global Constraints

- **The canonical derive line is one exact string**, written verbatim at every derive site: `#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]`. Do not add, reflow, or reformat one.
- **Never write `ts_rs` with an underscore in prose inside `redextape-core` or `redextape-wasm`** — doc comments included. Both crates' gates whitelist that byte sequence to the canonical derive line and refuse any other line carrying it. Write `ts-rs` with a hyphen. This does not apply to `redextape-test-support`, which neither gate scans.
- **`pre-commit` runs clippy `-D warnings` on every commit.** Never pass `--no-verify`. If a step's commit cannot pass the gate on its own, collapse it into the next commit and say so.
- **`docs/` is out of scope for the `file:line` citation gate; every other tracked path is not.** Do not write `path.rs:123` in a Rust or TypeScript file. Name the symbol instead.
- **The `ts` feature is default-off on both crates and `ts-rs` must never enter the wasm32 graph.** The invocation that demonstrates it is `cargo check --target wasm32-unknown-unknown -p redextape-wasm --all-targets` — `--all-targets`, not `--lib`, because dev-dependencies only appear there.
- **Every figure written into a doc names the command that produced it and is run before the commit that writes it.** Do not carry a figure forward from an earlier commit on this branch.
- **The shell refuses `>` onto an existing path** (`noclobber`). Capture each measurement into a freshly-named file, or a `tail` returns an earlier session's output looking exactly like this run's.

---

## File Structure

| path | responsibility | task |
|---|---|---|
| `crates/redextape-test-support/src/ts_derive_scan.rs` | Modify. Gains the anchor, the parser, the field resolver, the rule, the walk, and an inline `#[cfg(test)]` module. | 1 |
| `crates/redextape-test-support/src/lib.rs` | Modify. One sentence saying this crate has no inline test module goes false. | 1 |
| `crates/redextape-core/tests/ts_bindings.rs` | Modify. Third `#[test]`, calling the shared rule. | 2 |
| `crates/redextape-wasm/tests/ts_bindings.rs` | Modify. Third `#[test]`, calling the shared rule. | 2 |
| `web/tests/node/bindings-contract.test.ts` | Create. Eleven typed constants over the generated bindings. | 3 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | Modify. One `####` entry, appended, before the PR opens. | 4 |

---

### Task 1: The rule, unit-tested against synthetic source

**Files:**
- Modify: `crates/redextape-test-support/src/ts_derive_scan.rs`
- Modify: `crates/redextape-test-support/src/lib.rs`
- Test: `crates/redextape-test-support/src/ts_derive_scan.rs` (inline `#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `CANONICAL_TS_DERIVE` (already in this module).
- Produces: `pub fn assert_overrides_match_field_nullability(crate_root: &Path, scanner_path: &Path)`. Task 2 calls exactly this, with the same two arguments `ts_deriving_type_names_in_crate` already takes.

**Why the tests come first here and the sabotages come in Task 2.** The rule is a pure function over source text, so it can be driven from fixtures in this crate with no `ts-rs`, no generation and no feature flags. Task 2's sabotages then check the *wiring* — that the walk reaches real files and that the two gate binaries actually run it. Neither substitutes for the other: fifteen green fixtures over a function nobody calls is exactly the failure this repo's gate history is made of.

- [ ] **Step 1: Write the failing tests**

Append to `crates/redextape-test-support/src/ts_derive_scan.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// A source fixture as `check_source` sees it: a path that only appears in panic messages, and
    /// text that never reaches a compiler.
    fn check(src: &str) {
        check_source(Path::new("fixture.rs"), src);
    }

    const OPTION_FIELD: &str = r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub total_steps: Option<u64>,
}
"#;

    #[test]
    fn an_option_field_whose_override_keeps_the_null_passes() {
        check(OPTION_FIELD);
    }

    #[test]
    #[should_panic(expected = "total_steps")]
    fn an_option_field_whose_override_drops_the_null_panics() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    #[test]
    fn a_bare_field_overridden_to_number_passes() {
        check(
            r#"
pub struct TmState {
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub step: u64,
}
"#,
        );
    }

    #[test]
    #[should_panic(expected = "is not an `Option`")]
    fn a_bare_field_whose_override_invents_a_null_panics() {
        check(
            r#"
pub struct TmState {
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub step: u64,
}
"#,
        );
    }

    #[test]
    fn an_option_field_routed_through_as_option_passes() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(as = "Option<u32>"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    #[test]
    #[should_panic(expected = "total_steps")]
    fn an_option_field_routed_through_a_bare_as_panics() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(as = "u32"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// The case a `#[`-prefix anchor passes silently. This compiles as Rust.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn an_override_split_across_two_lines_is_still_read() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts",
        ts(type = "number"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// 143 of the 184 occurrences of the bytes `ts(` in the two scanned crates are this shape.
    #[test]
    fn an_identifier_ending_in_ts_is_not_an_anchor() {
        check(
            r#"
fn sweep_targets() -> usize {
    let counts = simulate_counts();
    list_of_nats(counts)
}
"#,
        );
    }

    /// `crates/redextape-wasm/src/session.rs` really does quote the wrong override, four times, in
    /// the doc comment directly above the field it warns about.
    #[test]
    fn a_comment_quoting_the_wrong_override_is_not_an_anchor() {
        check(
            r#"
pub struct TmStatus {
    /// Do not write `ts(type = "number")` here: it drops the `| null`.
    // ts(type = "number") is likewise wrong
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    #[test]
    fn the_canonical_derive_line_is_not_an_anchor() {
        check(
            r#"
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Span {
    pub start: usize,
}
"#,
        );
    }

    #[test]
    fn a_rename_key_carries_no_nullability_claim() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(rename = "totalSteps"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// Parsing only the FIRST key would let this through.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_type_key_after_a_rename_key_is_still_checked() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(rename = "totalSteps", type = "number"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    #[test]
    #[should_panic(expected = "cannot parse")]
    fn an_unquoted_value_panics_rather_than_passing() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = number))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// A whitespace variant is a RULE violation, not an unparseable line: `cargo fmt` normalises
    /// spacing, and a gate that treated formatting as an unrecognized spelling would be noise.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_whitespace_variant_is_judged_by_the_rule() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type="number"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    #[test]
    #[should_panic(expected = "Teach this scan the new shape")]
    fn a_field_shape_the_scan_cannot_resolve_panics() {
        check(
            r#"
pub enum Decoded {
    #[cfg_attr(feature = "ts", ts(type = "string"))]
    Text(String),
}
"#,
        );
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cargo nextest run -p redextape-test-support
```

Expected: FAIL to compile — `cannot find function 'check_source' in this scope`.

- [ ] **Step 3: Write the implementation**

Insert into `crates/redextape-test-support/src/ts_derive_scan.rs`, above the `#[cfg(test)]` module and below `ts_deriving_type_names_in_crate`:

```rust
/// Refuse any `ts-rs` field override whose replacement type disagrees with whether the Rust field is
/// an `Option`, in either direction.
///
/// **THE DEFECT THIS EXISTS FOR WAS SHIPPED TWICE BY THE SAME MECHANISM, AND BOTH RUST GATES PASS ON
/// IT.** `ts(type = "...")` substitutes the WHOLE field type, `Option` and all, so
/// `ts(type = "number")` on an `Option<u64>` generates `number` and silently drops the `| null` that
/// `None` puts on the wire. `no_generated_type_carries_bigint` finds no `bigint` in `number`, and
/// `the_gate_covers_every_exported_type` reads which types carry the derive, never a field. What
/// caught it was `tsc`, and only while a consumer assigned a literal `null` to the field.
///
/// **THE ANCHOR IS THE BYTE PATTERN WITH A WORD BOUNDARY, NOT A `#[` PREFIX, AND THAT IS A HOLE
/// RATHER THAN A PREFERENCE.** An override split across two lines compiles, and its second line
/// begins with `ts(` rather than `#[` — a prefix anchor skips it in silence. Anchoring on the bytes
/// alone is worse in the other direction: `ts(` is the tail of every identifier ending in `ts`
/// followed by an open paren, and `sweep_targets(`, `list_of_nats(` and `simulate_counts(` account
/// for 143 of the 184 occurrences across the two scanned crates. Requiring no ASCII letter, digit or
/// underscore before the `t` narrows 184 to 41; excluding comment lines narrows it to 27; the
/// caller's own gate file and the canonical derive line take it to the four real override sites.
///
/// **COMMENT LINES ARE EXCLUDED ON PURPOSE AND THE EXCLUSION IS LOAD-BEARING.** Fourteen of the 41
/// are comments, four of them in the doc comment sitting directly above the one `Option` field that
/// carries an override, quoting the wrong form in order to explain why it is wrong. Without the
/// exclusion this gate fails on the prose written to prevent the bug it checks for.
///
/// **RESOLUTION IS FORWARD, AND THE TREE PUNISHES GETTING THAT WRONG.** `redextape-core`'s
/// `viewmodel.rs` declares `cut: Option<Cut>`, then the override, then `step: u64`. A scan that
/// resolved backward would read `Option<Cut>` for an override belonging to a bare `u64` and demand a
/// `| null` that must not be there — so it fails on the UNMODIFIED tree, before any sabotage. A green
/// run on a clean tree is itself the check that this resolves in the right direction.
///
/// EVERY LINE THIS FUNCTION CANNOT RESOLVE IS A PANIC NAMING THE FILE AND LINE, NEVER A SKIP — the
/// rule [`ts_deriving_type_names_in_crate`] states for its own forward scan, applied one layer over.
///
/// **WHAT THIS DOES NOT COVER, NAMED RATHER THAN DENIED.** An `Option` field with NO override is
/// never examined: `ts-rs` maps it to `| null` on its own, and nothing here would notice that
/// changing. Nullability INSIDE a generic is invisible too — `RuleView::read` is
/// `Vec<Option<Symbol>>`, and an override rewriting the element type passes a rule that reads only
/// the outermost `Option<`. Closing that means parsing the Rust type rather than matching its prefix,
/// which is a different mechanism, not a wider prefix. `web/tests/node/bindings-contract.test.ts` is
/// what covers the generated output for the fields it names.
pub fn assert_overrides_match_field_nullability(crate_root: &Path, scanner_path: &Path) {
    fn walk(dir: &Path, self_path: &Path) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                if path.file_name().is_some_and(|n| n == "target") {
                    continue;
                }
                walk(&path, self_path);
            } else if path != self_path && path.extension().is_some_and(|e| e == "rs") {
                check_source(&path, &fs::read_to_string(&path).unwrap());
            }
        }
    }
    walk(crate_root, scanner_path);
}

/// Every anchored `ts(...)` in `src`, checked against the field below it. Split out from the walk so
/// the rule can be driven from source fixtures that never touch the filesystem.
fn check_source(path: &Path, src: &str) {
    let lines: Vec<&str> = src.lines().collect();
    for (i, line) in lines.iter().enumerate() {
        let Some(open) = anchored_ts_call(line) else {
            continue;
        };
        let Some(keys) = parse_ts_keys(&line[open + 3..]) else {
            panic!(
                "{}:{} carries a `ts(...)` attribute this scan cannot parse into keys and quoted \
                 values: {line:?}. Every override must be readable, because one this scan skips is \
                 one it cannot check. Spell it `ts(type = \"...\")` or `ts(as = \"...\")`, or teach \
                 this scan the new shape.",
                path.display(),
                i + 1
            );
        };
        let overrides: Vec<(&str, &str)> = keys
            .iter()
            .filter(|(k, _)| k == "type" || k == "as")
            .filter_map(|(k, v)| v.as_deref().map(|v| (k.as_str(), v)))
            .collect();
        if overrides.is_empty() {
            continue;
        }
        let (field_name, field_type) = resolve_field(path, &lines, i);
        for (key, value) in overrides {
            check_override(path, i, key, value, &field_name, &field_type);
        }
    }
}

/// The byte offset of a `ts(` in `line` with no ASCII letter, digit or underscore before it, when
/// `line` is neither a comment nor the canonical derive line.
fn anchored_ts_call(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    if trimmed.starts_with("//") || trimmed.starts_with('*') {
        return None;
    }
    if line.trim() == CANONICAL_TS_DERIVE {
        return None;
    }
    let bytes = line.as_bytes();
    let mut from = 0;
    while let Some(rel) = line[from..].find("ts(") {
        let at = from + rel;
        let joined = at > 0 && matches!(bytes[at - 1], b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_');
        if !joined {
            return Some(at);
        }
        from = at + 1;
    }
    None
}

/// The whole key list of a `ts(...)` attribute, from just past its opening paren. `None` for any
/// shape this cannot read — the caller turns that into a panic, because a skipped key is an
/// unchecked override. Reads EVERY key rather than the first: `ts(rename = "x", type = "number")`
/// carries the override in second position.
fn parse_ts_keys(after_open: &str) -> Option<Vec<(String, Option<String>)>> {
    let mut keys = Vec::new();
    let mut rest = after_open;
    loop {
        rest = rest.trim_start();
        let end = rest.find(|c: char| !c.is_ascii_alphanumeric() && c != '_')?;
        if end == 0 {
            return None;
        }
        let key = rest[..end].to_string();
        rest = rest[end..].trim_start();
        let value = if let Some(after_eq) = rest.strip_prefix('=') {
            let after_quote = after_eq.trim_start().strip_prefix('"')?;
            let close = after_quote.find('"')?;
            rest = &after_quote[close + 1..];
            Some(after_quote[..close].to_string())
        } else {
            None
        };
        keys.push((key, value));
        rest = rest.trim_start();
        if let Some(next) = rest.strip_prefix(',') {
            rest = next;
        } else if rest.starts_with(')') {
            return Some(keys);
        } else {
            return None;
        }
    }
}

/// From the anchored line, scan forward over further attribute and doc-comment lines to the field it
/// decorates, and return its name and its Rust type as written.
fn resolve_field(path: &Path, lines: &[&str], marker: usize) -> (String, String) {
    let mut i = marker + 1;
    loop {
        let Some(line) = lines.get(i) else {
            panic!(
                "{}:{} carries a `ts(...)` override but no field declaration followed before the \
                 file ended. Teach this scan the new shape.",
                path.display(),
                marker + 1
            );
        };
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with("//") || trimmed.is_empty() {
            i += 1;
            continue;
        }
        let decl = trimmed
            .strip_prefix("pub(crate) ")
            .or_else(|| trimmed.strip_prefix("pub "))
            .unwrap_or(trimmed);
        let Some((name, ty)) = decl.split_once(':') else {
            panic!(
                "{}:{} carries a `ts(...)` override but line {} is neither another attribute, a \
                 comment, nor a `NAME: TYPE,` field declaration: {line:?}. An override on an enum \
                 variant or a tuple field is a shape this rule has never been measured against. \
                 Teach this scan the new shape.",
                path.display(),
                marker + 1,
                i + 1
            );
        };
        return (name.trim().to_string(), ty.trim().trim_end_matches(',').trim().to_string());
    }
}

/// The rule itself, in both directions.
fn check_override(path: &Path, marker: usize, key: &str, value: &str, field_name: &str, field_type: &str) {
    let is_option = field_type.starts_with("Option<");
    let value_admits_null = match key {
        "type" => value.ends_with(" | null"),
        _ => value.starts_with("Option<"),
    };
    if is_option == value_admits_null {
        return;
    }
    let remedy = if is_option {
        "the field is an `Option`, so the override must say so too: `ts(type = \"... | null\")`, \
         with that exact suffix, or `ts(as = \"Option<...>\")`, which routes through a Rust type \
         that carries the optionality by construction"
    } else {
        "the field is not an `Option`, so nothing on the wire can be null and the override must not \
         claim otherwise — drop the `| null`"
    };
    panic!(
        "{}:{} overrides `{field_name}: {field_type}` with `ts({key} = \"{value}\")`, and the two \
         disagree about whether the field can be null. `ts(type = ...)` replaces the WHOLE field \
         type, `Option` and all, rather than the part of it that needed changing — which is how this \
         defect shipped twice. Here, {remedy}.",
        path.display(),
        marker + 1
    );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```
cargo nextest run -p redextape-test-support
```

Expected: PASS — 15 tests from the `ts_derive_scan::tests` module, plus whatever this crate already
runs.

**Check the four `#[should_panic]` messages actually matched rather than merely panicking.** A
`#[should_panic(expected = "...")]` that never matches its substring still fails, but one whose
substring is too loose passes on the wrong panic — `expected = "total_steps"` would be satisfied by a
`resolve_field` panic as readily as by a rule violation. Run
`cargo nextest run -p redextape-test-support --no-capture` once and read the panic text of
`an_option_field_whose_override_drops_the_null_panics`: it must be the `check_override` message
naming both the field type and the remedy, not a "Teach this scan the new shape" message.

- [ ] **Step 5: Correct `lib.rs`'s claim that this crate holds no tests**

In `crates/redextape-test-support/src/lib.rs`, the comment above `#![cfg_attr(test, allow(clippy::pedantic))]` says this crate "has no inline `#[cfg(test)]` module of its own — it is itself a test-only helper library, consumed by other crates' tests, not a holder of tests — so there is no module-level attribute for `cfg_attr` to stand in for here; kept for consistency with the other crates in this workspace, which do have inline test modules."

Replace that clause with:

```rust
// module-level attribute for `cfg_attr` to stand in for here — which stopped being true when
// `ts_derive_scan` gained an inline `#[cfg(test)] mod tests`. That module drives the override rule
// from source fixtures rather than from the filesystem, so the rule is checked here and its WIRING
// is checked by the two crates' gate binaries that call it. The attribute above now does real work
// rather than standing by for consistency.
```

- [ ] **Step 6: Run the whole workspace and commit**

```
cargo nextest run --workspace
cargo clippy --workspace --all-targets
```

Expected: both green. Then:

```
git add crates/redextape-test-support/src/ts_derive_scan.rs crates/redextape-test-support/src/lib.rs
git commit -m "Add the nullability rule to ts_derive_scan, driven from source fixtures"
```

---

### Task 2: Wire the rule into both crates' gates, and run the sabotages

**Files:**
- Modify: `crates/redextape-core/tests/ts_bindings.rs`
- Modify: `crates/redextape-wasm/tests/ts_bindings.rs`

**Interfaces:**
- Consumes: `redextape_test_support::ts_derive_scan::assert_overrides_match_field_nullability(crate_root: &Path, scanner_path: &Path)` from Task 1.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Add the third test to both gate files**

In **both** `crates/redextape-core/tests/ts_bindings.rs` and `crates/redextape-wasm/tests/ts_bindings.rs`, extend the existing import:

```rust
use redextape_test_support::ts_derive_scan::{
    assert_overrides_match_field_nullability, ts_deriving_type_names_in_crate, without_doc_comments,
};
```

and append, verbatim in both files:

```rust
/// No field override may misstate whether the field can be null.
///
/// **NEITHER TEST ABOVE CAN SEE THIS CLASS, WHICH IS WHY IT IS A THIRD TEST RATHER THAN A WIDENING
/// OF EITHER.** `ts(type = "number")` on an `Option<u64>` generates `number`: no `bigint` for the
/// gate above to find, and the type still carries the derive, so the coverage gate is satisfied too.
/// The `| null` that `None` puts on the wire is simply gone.
///
/// THE RULE AND ITS REASONING LIVE IN `redextape_test_support::ts_derive_scan` — read
/// `assert_overrides_match_field_nullability`'s own doc for the anchor, the forward resolution, and
/// the two things it names as outside its reach rather than closed. One implementation with two
/// callers is deliberate: a second copy drifts the moment one is widened and the other is not.
#[test]
fn no_override_misstates_a_field_s_nullability() {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    assert_overrides_match_field_nullability(crate_root, &crate_root.join("tests").join("ts_bindings.rs"));
}
```

- [ ] **Step 2: Run both gates on the clean tree — this is the direction check**

```
cargo nextest run -p redextape-core --features ts -E 'binary(ts_bindings)'
cargo nextest run -p redextape-wasm --features ts -E 'binary(ts_bindings)'
```

Expected: `3 tests run: 3 passed, 0 skipped` from each.

**A failure here on the unmodified tree means the scan resolved backward** and read `cut: Option<Cut>` for the override belonging to `step: u64` in `redextape-core`'s `viewmodel.rs`. Fix the direction before going on; do not adjust the rule to accommodate it.

- [ ] **Step 3: Commit the wiring**

```
git add crates/redextape-core/tests/ts_bindings.rs crates/redextape-wasm/tests/ts_bindings.rs
git commit -m "Run the nullability rule from both crates' ts_bindings gates"
```

- [ ] **Step 4: Run sabotages 1 through 3 and record each**

For each, apply the edit, run **both** commands from Step 2, record the output, then `git checkout --` the file before the next one.

| # | edit | expected |
|---|---|---|
| 1 | `crates/redextape-wasm/src/session.rs`: change `ts(type = "number \| null")` to `ts(type = "number")` on `total_steps` | wasm gate FAILS naming `total_steps` and `Option<u64>`; core gate still `3 passed` |
| 2 | `crates/redextape-core/src/viewmodel.rs`: change `ts(type = "number")` to `ts(type = "number \| null")` on `TmState::step` | core gate FAILS saying the field is not an `Option`; wasm gate still `3 passed` |
| 3 | `crates/redextape-wasm/src/session.rs`: change the override on `total_steps` to `ts(as = "u32")` | wasm gate FAILS naming `total_steps` |

Under every one of the three, the other two tests in the failing binary must still be reported as passing — the argument of this slice is that they cannot see any of it.

- [ ] **Step 5: Run sabotages 4 through 7 and record each**

| # | edit on `total_steps` unless stated | expected |
|---|---|---|
| 4 | `ts(type="number")`, no spaces | FAILS as a **rule violation**, naming `total_steps` — not as an unparseable line |
| 5 | split the attribute: `#[cfg_attr(feature = "ts",` then `    ts(type = "number"))]` | FAILS. A `#[`-prefix anchor would pass this silently |
| 6 | `ts(type = r#"number"#)` | EITHER the crate fails to compile, OR the gate panics with `cannot parse`. Record which occurred. A silent pass fails this sabotage |
| 7 | add `#[cfg_attr(feature = "ts", ts(rename = "renamedStep"))]` above `TmState::step` in `viewmodel.rs` | core gate STAYS GREEN at `3 passed`: a key that is neither `type` nor `as` makes no nullability claim |

Sabotage 5 must be written so it compiles — confirm with `cargo check -p redextape-wasm --features ts` before reading the gate's result. A sabotage that fails to build has measured nothing.

- [ ] **Step 6: Confirm the tree is clean and the wasm32 graph is unchanged**

```
git status --porcelain
cargo check --target wasm32-unknown-unknown -p redextape-wasm --all-targets
```

Expected: `git status --porcelain` prints nothing — every sabotage reverted — and the wasm32 check exits 0. `--all-targets`, not `--lib`: dev-dependencies appear only there, and `redextape-test-support` is one.

---

### Task 3: The generated-output pin

**Files:**
- Create: `web/tests/node/bindings-contract.test.ts`

**Interfaces:**
- Consumes: the barrel `web/src/types.ts`, which re-exports `LambdaState`, `LambdaStatus`, `RuleView`, `TmState` and `TmStatus` from `../bindings/`.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Write the test**

Create `web/tests/node/bindings-contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { LambdaState, LambdaStatus, RuleView, TmState, TmStatus } from '../../src/types'

/**
 * The eleven places the wire carries a null, pinned against the GENERATED types rather than against
 * a hand-written declaration.
 *
 * WHAT THIS IS FOR. `pnpm run typecheck` and `pnpm run test` both run `build:bindings` first, so the
 * annotations below are checked against the file the Rust declarations actually produce. A `ts-rs`
 * override that dropped a `| null` — the defect this file's sibling gate in
 * `redextape-test-support::ts_derive_scan` refuses at the derive site — reddens `tsc` here.
 *
 * WHY IT IS NOT ENOUGH TO LEAVE THIS TO THE FIXTURES. Before this file existed, the whole check was
 * that a few tests happened to construct objects with a literal `null` in them. None of them existed
 * to check nullability, so a refactor that stopped building fixtures that way would have removed the
 * last thing watching this class with nothing firing to say so.
 *
 * WHAT THIS DOES NOT COVER. The list is written by hand. A twelfth nullable field added to a
 * generated type later will not be in it, and nothing here will say so — the derive-site rule is
 * what watches the override that would cause it, and neither watches an `Option` field that never
 * had an override at all.
 *
 * The imports come from the barrel rather than from `../../bindings/` directly, deliberately: the
 * barrel's import is the condition that puts the generated files into the TypeScript program at all,
 * and a test that reached around it would be checking a different statement.
 */
describe('the generated bindings keep the nullability the wire carries', () => {
  it('admits null at every nullable site', () => {
    const lambdaStatusNode: LambdaStatus['node'] = null
    const lambdaStatusRun: LambdaStatus['run'] = null
    const lambdaStateCut: LambdaState['cut'] = null
    const lambdaStateRedexSpan: LambdaState['redex_span'] = null
    const tmStateSourceNode: TmState['source_node'] = null
    const tmStateRule: TmState['rule'] = null
    const tmStatusWidth: TmStatus['width'] = null
    const tmStatusRun: TmStatus['run'] = null
    const tmStatusTotalSteps: TmStatus['total_steps'] = null
    const ruleViewRead: RuleView['read'][number] = null
    const ruleViewWrite: RuleView['write'][number] = null

    expect(lambdaStatusNode).toBeNull()
    expect(lambdaStatusRun).toBeNull()
    expect(lambdaStateCut).toBeNull()
    expect(lambdaStateRedexSpan).toBeNull()
    expect(tmStateSourceNode).toBeNull()
    expect(tmStateRule).toBeNull()
    expect(tmStatusWidth).toBeNull()
    expect(tmStatusRun).toBeNull()
    expect(tmStatusTotalSteps).toBeNull()
    expect(ruleViewRead).toBeNull()
    expect(ruleViewWrite).toBeNull()
  })
})
```

- [ ] **Step 2: Run typecheck and the node tests**

```
cd web && pnpm run typecheck
cd web && pnpm run test:node
```

Expected: typecheck exits 0; the node project reports one more test file and one more test than it did before.

Record the before-and-after file and test counts by running `pnpm run test:node` once before creating the file and once after — the roadmap entry in Task 4 quotes both.

- [ ] **Step 3: Commit**

```
git add web/tests/node/bindings-contract.test.ts
git commit -m "Pin the eleven nullable sites against the generated bindings"
```

- [ ] **Step 4: Run sabotage 8 and settle the three-versus-four question**

Apply sabotage 1 again — `ts(type = "number")` on `total_steps` in `crates/redextape-wasm/src/session.rs` — then:

```
cd web && pnpm run typecheck
```

Expected: exit 1. Record **every** `TS2322` error `tsc` prints, with its file. The design's §1 records three errors measured at `2df9a58` and a grep that finds four assignment sites today; this run is what settles which number describes the check, and the answer goes into the roadmap entry with this command beside it.

`bindings-contract.test.ts` must be among the files named. If it is not, the pin is not reaching the generated file and the fault is in this task, not in the sabotage.

- [ ] **Step 5: Run sabotage 9**

With sabotage 1 still applied, delete the `tmStatusTotalSteps` constant and its `expect`, and re-run `pnpm run typecheck`. Expected: still exit 1, on the remaining fixtures — the pin is not the only thing holding, and no single line in it is load-bearing.

- [ ] **Step 6: Revert everything and confirm green**

```
git checkout -- crates/redextape-wasm/src/session.rs web/tests/node/bindings-contract.test.ts
git status --porcelain
cd web && pnpm run typecheck && pnpm run test
```

Expected: `git status --porcelain` prints nothing; typecheck exits 0; the full vitest run is green.

---

### Task 4: The roadmap entry and the pull request

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**Interfaces:** none.

- [ ] **Step 1: Run the full local gate and capture the figures**

```
scripts/check-all.sh
```

Then, each into a freshly-named scratch file (the shell refuses `>` onto an existing path):

```
git rev-list --count main..HEAD
git diff --shortstat main..HEAD
cargo nextest run -p redextape-core --features ts -E 'binary(ts_bindings)'
cargo nextest run -p redextape-wasm --features ts -E 'binary(ts_bindings)'
cd web && pnpm run test
```

Every figure the entry quotes must come from these runs, at the branch head, not from a task report written at an earlier commit.

- [ ] **Step 2: Write the roadmap entry**

Append one `####` section to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, following the shape of the entry above it. It must carry:

- What this closes, and that it is the third bullet of PR #71's WHAT STAYS OPEN list rather than new work.
- **The anchor correction found while planning**, with both directions: a `#[`-prefix anchor skips a two-line attribute silently, and the byte pattern without a word boundary fires on `sweep_targets(`. The spec prescribed the first and the plan measured it — the same shape of defect as PR #71's "that script needs no change", caught earlier this time because the anchor was measured rather than reasoned about.
- The sabotage results from Tasks 2 and 3, each with the command that produced it, including sabotage 6's actual outcome rather than a prediction.
- **What sabotage 8 reported**, and whether it was three errors or four, with the note that a grep for `total_steps: null` and a count of `TS2322` errors are different quantities.
- A `##### WHAT STAYS OPEN` list carrying forward: an `Option` field with no override, nullability inside a generic (`RuleView::read`/`write`), nothing comparing generated types against the measured wire, `LinkIndexWire`, `TermTree`/`TermNode`, the coverage scan's three named routes, and a stale `web/bindings/` that still typechecks.
- A `##### VERIFICATION` block with the Step 1 figures, each naming its command.
- The `docker` job's pull-request exemption, restated, with a check of whether this branch touched anything that job builds: `git diff --name-only main..HEAD`.

**No CI paragraph.** No pull request exists yet and no run has happened; say that rather than leaving a gap.

- [ ] **Step 3: Commit the entry**

```
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "Record the nullability override gate and the anchor the spec got wrong"
```

- [ ] **Step 4: Push and open the pull request**

```
git push -u origin nullability-override-gate
```

Open the PR against `main` via the gitea MCP. **The body must be one long line per paragraph, never hard-wrapped** — Forgejo renders bodies with GFM `breaks: true`, so a wrapped paragraph shows as forced line breaks.

- [ ] **Step 5: Watch CI to a terminal status**

Poll with the gitea MCP, not `tea api get` — that route answers 404 for everything and exits 0, so a bash poll must test for a positive terminal status rather than the absence of an error. The API's run id is not the run number in the URL; record both. There is no rerun endpoint — to re-trigger, edit the PR body.

Add the CI paragraph to the roadmap entry once every job has reached a terminal status, naming the head sha read from the pull request's own `head.sha` rather than assumed from the branch, and commit that as a separate change.

---

## Self-Review

**Spec coverage.** §4.1 → Task 1 Step 3 and Task 2 Step 1. §4.2 (anchor, forward resolution, the two-line hole) → Task 1's `anchored_ts_call` and `resolve_field`, tested by `an_override_split_across_two_lines_is_still_read` and `an_identifier_ending_in_ts_is_not_an_anchor`. §4.3 (the rule, both directions) → `check_override`, tested by four fixtures. §4.4 (panics, comment exclusion, `scanner_path`) → `check_source`'s panic, `a_comment_quoting_the_wrong_override_is_not_an_anchor`, and the `path != self_path` arm of the walk. §4.5 (boundaries) → stated in the function's doc comment and in `bindings-contract.test.ts`'s header. §5 → Task 3. §6's nine sabotages → Task 2 Steps 4–5 (1–7) and Task 3 Steps 4–5 (8–9), with the clean-tree run as Task 2 Step 2. §7 → Task 4 Step 2's WHAT STAYS OPEN list.

**Placeholder scan.** No `TBD`, no "handle edge cases", no "similar to Task N". Every code step carries its code. The one step describing prose rather than showing it is Task 4 Step 2, the roadmap entry — it lists the seven things that entry must carry, because its content is the sabotage results, which do not exist until Tasks 2 and 3 have run and must not be predicted here.

**One risk this plan cannot close by construction.** Four tests use `#[should_panic(expected = "total_steps")]`, and that substring appears in both `check_override`'s panic and `resolve_field`'s. Task 1 Step 4 makes reading the actual panic text an explicit step for exactly that reason: an assertion loose enough to pass on the wrong panic is a green test that checks nothing, which is the failure mode this whole slice exists to refuse.

**Type consistency.** `assert_overrides_match_field_nullability(&Path, &Path)` is named identically in Task 1's implementation, Task 1's Interfaces block, Task 2's import and Task 2's call. `check_source(&Path, &str)` is what the test helper calls and what the walk calls. `parse_ts_keys` returns `Vec<(String, Option<String>)>` and `check_source` reads it as such. The eleven constant names in Task 3 Step 1 match the eleven `expect` calls below them.
