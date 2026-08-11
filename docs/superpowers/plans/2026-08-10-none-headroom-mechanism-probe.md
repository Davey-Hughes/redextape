# `None` Headroom Mechanism Probe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `inherit_probe.rs`, which answers why #28's 382 "headroom" `None` β-steps sit outside every live tag, and prices two contractum-inherits rules against a pre-registered gate.

**Architecture:** One new example target. A real `trace::LambdaCursor` paces the run; two shadow terms — one per inheritance variant — step alongside it, each produced by a probe-local mirror of `reduce_step_go` built on the public `term.rs` constructors. Every step asserts the shadow's redex path equals the real cursor's, which is the invariant that catches a shadow that has drifted from the reducer it models. Four tables (`[OV]`, `[POS]`, `[MACH]`, `[INH]`) are flushed per program.

**Tech Stack:** Rust edition 2024, `redextape-core` only. No new dependencies. `trace::LambdaCursor`, `lambda::term::{beta, abs, app_tagged_for_rebuild}`, `lambda::reduce::{Owner, reduce_step}`, `sourcemap::SourceMap`.

**Design:** [`../specs/2026-08-10-none-headroom-mechanism-design.md`](../specs/2026-08-10-none-headroom-mechanism-design.md).

## Global Constraints

- **Rust edition 2024**, `max_width = 120`, `use_small_heuristics = "Max"` (`rustfmt.toml`). Run `cargo fmt` before every commit.
- **`clippy --workspace --all-targets -- -D warnings` runs on EVERY commit** via pre-commit, and examples are `--all-targets`. A commit that does not compile clean cannot land. Never `--no-verify`; if a task's commit split turns out infeasible, collapse the commits and say so in the report.
- **This is a probe. It never runs in CI.** Same standing as `owner_probe` and `none_probe`: run manually, by hand, under the cap.
- **RUN IT ONLY LIKE THIS:**
  `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- cargo run --release -p redextape-core --example inherit_probe`
  `MemorySwapMax=0` is the load-bearing half. **An OOM-kill or a timeout is a RESULT to report, not something to work around by raising the cap.**
- **Drive `trace::LambdaCursor`, NEVER `lambda::reduce_trace`.** `reduce_trace` materialises every step's term by contract; that is how an earlier measurement over this family took 60 GiB of RAM and 29 GiB of swap and wedged the machine.
- **Examples are invisible to `cargo llvm-cov nextest`** (`ci.yml` line 246: nextest's default does not instrument example targets). So this probe's `#[cfg(test)] mod tests` never runs in CI and never touches the 90% floor. Run it by hand: `cargo test -p redextape-core --example inherit_probe`.
- **File header:** `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]`, exactly as `none_probe.rs` carries.
- **Commit messages carry no attribution** — no `Co-Authored-By`, no `Generated with`.
- **Deliberate duplication is the convention here.** `count_tagged_apps` and `programs()` are copied from `none_probe.rs` verbatim, each with a comment saying so and why: examples are separate crates and cannot share helpers, and `none_probe` itself copied `programs()` from `owner_probe` for exactly this reason. Copying the source strings verbatim is what makes the rows comparable.

## File Structure

- **Create:** `crates/redextape-core/examples/inherit_probe.rs` — the whole deliverable. One file: it is a probe, and every probe in this tree is one file.
- **Touch nothing else.** No `src/` change is part of this plan. If one appears necessary, stop and report — the design's §2 rejects putting the rule behind a flag in `reduce.rs`, on the grounds that it half-builds the slice the measurement is supposed to decide.

**Reference material the implementer should read once before Task 1:**
- `crates/redextape-core/examples/none_probe.rs` — the probe this succeeds; source of `programs()`, `count_tagged_apps`, the flush-per-program table idiom, and the module-doc conventions.
- `crates/redextape-core/src/lambda/reduce.rs`, `reduce_step_go` — the function Task 4's `shadow_step` mirrors. Read it before writing the mirror.
- `crates/redextape-core/examples/owner_probe.rs`, `percentile`/`median` and the `within_widths` handling — the source of Task 6's M2 computation.

**Exact import paths, verified against the tree at `0f4ff26`:**

```rust
use redextape_core::core::NodeId;                                    // = u32
use redextape_core::lambda::reduce::{Owner, reduce_step};
use redextape_core::lambda::term::{Node, abs, app_tagged_for_rebuild, beta};
use redextape_core::lambda::{self, Dir, LambdaTerm, MAX_REDUCTION_STEPS, Path};
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{self, EncodingKind};
use redextape_core::{parser, trace};
```

---

### Task 1: Scaffold and `[OV]` — reproduce numbers already on the record

**Files:**
- Create: `crates/redextape-core/examples/inherit_probe.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `programs() -> Vec<(&'static str, &'static str)>`; `count_tagged_apps(&LambdaTerm) -> u64`; `line(&str)`; `head(&str)`; `fmt_pct(u64, u64) -> String`; `lower_program(&str) -> Option<(LambdaTerm, SourceMap)>`.

**Why this is its own task:** it proves the corpus and the plumbing are right against four rows already recorded in the roadmap, before any new measurement rides on them. If a source string drifted, the step counts differ and it is caught here rather than blamed on the shadow reducer three tasks later.

- [ ] **Step 1: Create the file with its module doc and the shared helpers**

Create `crates/redextape-core/examples/inherit_probe.rs`:

```rust
//! **Why do the `None` β-steps sit outside the tags that are still alive, and would a contractum
//! -inherits rule reach them?** Successor to `none_probe.rs`, which established that 96.2% of
//! `while4`'s 397 `None` steps happen with tagged `App`s alive elsewhere in the term — a quantity,
//! not a mechanism. This probe supplies the mechanism and prices two candidate rules.
//!
//! # HOW TO RUN THIS
//!
//! ```text
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release -p redextape-core --example inherit_probe
//! ```
//!
//! **The cap is not decoration and `MemorySwapMax=0` is the load-bearing half.** An earlier
//! measurement over this family took 60 GiB of RAM and 29 GiB of swap and wedged the machine. An
//! OOM-kill or a timeout here is a RESULT to report, not something to work around by raising the cap.
//!
//! **Drives `trace::LambdaCursor`, never `reduce_trace`**, which materialises every step's term by
//! contract and is how the 60 GiB run happened.
//!
//! # WHAT THIS MEASURES
//!
//! * `[OV]` — `Owner` totals, for orientation and to prove the corpus matches `none_probe`'s.
//! * `[POS]` — every `None` step split by WHERE the live tags sit relative to the redex: inside its
//!   function subterm, inside its argument, or disjoint from it entirely. That split is exhaustive
//!   because `Owner` is derived purely from the root→redex path, so a live tag is either inside the
//!   redex or in a subtree disjoint from it. There is no third case.
//! * `[MACH]` — a histogram of the applied binder's name. **A HINT, NOT EVIDENCE**, and the printed
//!   header says so: `encode::church` mints `f` and `x`, `encode::diverge`'s `omega` mints `x`, and
//!   the fixpoint combinator `lower.rs` builds mints both. A name is shared by constructs with
//!   nothing else in common.
//! * `[INH]` — two contractum-inherits rules simulated against a real reducer, bracketing the family.
//!
//! Full design, including the pre-registered gate: `docs/superpowers/specs/2026-08-10-none-headroom
//! -mechanism-design.md`.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::HashSet;
use std::io::Write;

use redextape_core::lambda::reduce::Owner;
use redextape_core::lambda::term::Node;
use redextape_core::lambda::{self, LambdaTerm, MAX_REDUCTION_STEPS};
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{self, EncodingKind};
use redextape_core::{parser, trace};

fn line(s: &str) {
    println!("{s}");
    let _ = std::io::stdout().flush();
}

fn head(s: &str) {
    line("");
    line(s);
    line(&"-".repeat(s.len()));
}

fn fmt_pct(n: u64, of: u64) -> String {
    if of == 0 { "-".to_string() } else { format!("{:.1}%", 100.0 * n as f64 / of as f64) }
}

/// The four programs, **copied VERBATIM from `none_probe.rs`'s `programs()`** so the source strings
/// cannot drift between the two probes and every row here is comparable to a row already recorded.
/// `none_probe` copied them from `owner_probe` for the same reason. Examples are separate crates and
/// cannot share a helper; verbatim duplication with this note is the convention in this tree.
fn programs() -> Vec<(&'static str, &'static str)> {
    vec![
        ("while4", "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc"),
        (
            "countdown4",
            "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
        ),
        ("sum5", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"),
        (
            "map_fold",
            "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
             fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
             fn add(a, b) { a + b }\n\
             fn add1(x) { x + 1 }\n\
             fold([3, 1, 2].map(add1), 0, add)",
        ),
    ]
}

/// Number of DISTINCT allocations reachable from `t` that are a tagged `App`. **Copied verbatim from
/// `none_probe.rs`** — see `programs()` for why duplication rather than sharing.
///
/// **Physical, not logical** — deduped by `alloc_id` over an explicit worklist, the same convention
/// `term.rs`'s `max_shared_logical_size` uses: under structural sharing a term can denote an
/// astronomical logical tree from a small number of allocations, so a walk that revisits shared
/// subterms would be a hang, not a measurement. Iterative over an explicit stack, never recursive.
fn count_tagged_apps(t: &LambdaTerm) -> u64 {
    let mut seen: HashSet<usize> = HashSet::new();
    let mut stack: Vec<&LambdaTerm> = vec![t];
    let mut count = 0u64;
    while let Some(node) = stack.pop() {
        if !seen.insert(node.alloc_id()) {
            continue;
        }
        match node.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push(b),
            Node::App(f, a, _) => {
                if node.owner().is_some() {
                    count += 1;
                }
                stack.push(f);
                stack.push(a);
            }
        }
    }
    count
}

/// Parse, build the source map, lower. `None` if the program does not parse or lower — which cannot
/// happen for `programs()` and is handled rather than unwrapped so a future corpus edit degrades to a
/// missing row instead of a panic mid-table.
fn lower_program(src: &str) -> Option<(LambdaTerm, SourceMap)> {
    let (program, _) = parser::parse(src);
    let program = program?;
    let enc = EncodingKind::Unary.at(tm::MIN_FIELD_WIDTH);
    let (core, map) = SourceMap::build_from_program(&program, &*enc);
    let term = lambda::lower(&core).ok()?;
    Some((term, map))
}

/// One program's census. Grows a field group per task; `[OV]` only, for now.
struct Census {
    steps: u64,
    exact: u64,
    within: u64,
    none: u64,
}

/// Drive one program to `MAX_REDUCTION_STEPS` over `trace::LambdaCursor`, counting `Owner`.
fn measure(src: &str) -> Census {
    let Some((term, _map)) = lower_program(src) else {
        return Census { steps: 0, exact: 0, within: 0, none: 0 };
    };
    let mut real = trace::LambdaCursor::new(&term, MAX_REDUCTION_STEPS);
    let (mut exact, mut within, mut none) = (0u64, 0u64, 0u64);
    let mut steps = 0u64;
    while real.next().is_some() {
        steps += 1;
        match real.last_owner() {
            Owner::Exact(_) => exact += 1,
            Owner::Within(_) => within += 1,
            Owner::None => none += 1,
        }
    }
    Census { steps, exact, within, none }
}

fn main() {
    line("inherit_probe — where the None steps are, and what a contractum-inherits rule would reach");
    line("  RUN UNDER: systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0");

    head("[OV] Owner totals (loop family first, then recursive)");
    line(&format!("[OV] {:<11}{:>8}{:>8}{:>8}{:>8}{:>10}", "program", "steps", "Exact", "Within", "None", "tagged%"));

    // Every table's row for a program is flushed immediately after that program's `measure()`
    // finishes — interleaved across tags rather than in separate passes — so a kill mid-run leaves
    // every table complete through the last finished program, never one table ahead of the others.
    // Same fix `none_probe` and `owner_probe` both already apply.
    for (name, src) in &programs() {
        let c = measure(src);
        line(&format!(
            "[OV] {:<11}{:>8}{:>8}{:>8}{:>8}{:>10}",
            name,
            c.steps,
            c.exact,
            c.within,
            c.none,
            fmt_pct(c.exact + c.within, c.steps),
        ));
    }
}
```

- [ ] **Step 2: Confirm it compiles clean under the gate that runs on commit**

Run: `cargo clippy -p redextape-core --all-targets -- -D warnings`
Expected: finishes with no warnings. If it does not, fix before proceeding — this is the gate pre-commit runs.

- [ ] **Step 3: Run the probe under the cap**

Run:
```bash
systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
  cargo run --release -p redextape-core --example inherit_probe
```

- [ ] **Step 4: Check the `[OV]` rows against the numbers already on the record**

Expected, from the roadmap's post-#28 nine-program table:

| program | steps | Exact | Within | None |
| --- | --- | --- | --- | --- |
| `while4` | 470 | 51 | 22 | 397 |
| `countdown4` | 474 | 52 | 25 | 397 |
| `sum5` | 626 | 54 | 402 | 170 |
| `map_fold` | 555 | 158 | 325 | 72 |

**Any mismatch stops the task.** It means the corpus, the encoding, or the lowering differs from what `none_probe` measured, and every later table would be measuring a different program than the one the gate's before-numbers describe. Report the mismatch rather than adjusting the expected values.

- [ ] **Step 5: Commit**

```bash
cargo fmt
git add crates/redextape-core/examples/inherit_probe.rs
git commit -m "probe: inherit_probe scaffold, reproducing none_probe's Owner totals

Corpus and source strings copied verbatim from none_probe so the rows stay
comparable. [OV] reproduces the recorded 470/51/22/397 and the other three rows
cell for cell, which is what makes the later tables about the same programs the
gate's before-numbers describe."
```

---

### Task 2: `[POS]` — where the live tags sit relative to the redex

**Files:**
- Modify: `crates/redextape-core/examples/inherit_probe.rs`

**Interfaces:**
- Consumes: `count_tagged_apps`, `lower_program`, `measure`, `Census` from Task 1.
- Produces: `follow<'a>(&'a LambdaTerm, &[Dir]) -> &'a LambdaTerm`; `Census` gains `pos_fn`, `pos_arg`, `pos_either`, `pos_disjoint`, `pos_no_tags: u64`.

**The one subtlety, stated because it is easy to get backwards:** the redex path indexes the term ENTERING the step, so the pre-step term must be cloned before `next()` is called. `LambdaCursor::term()` returns "the term as of the last emitted event", and reading it after `next()` returns the term the step produced — in which the just-contracted redex no longer exists and the path no longer means what it meant. The clone is a refcount bump, not a copy.

**On sharing:** the buckets are defined by *reachability from the redex*, which is well-defined even when a tagged allocation is reachable from both inside and outside the redex. `disjoint` means "no tagged `App` is reachable from this redex", never "the tags live only elsewhere".

- [ ] **Step 1: Write the failing tests**

Add to `crates/redextape-core/examples/inherit_probe.rs`, at the end of the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use redextape_core::lambda::term::{app, app_owned, var};
    use redextape_core::lambda::{Dir, Path};

    #[test]
    fn follow_navigates_each_direction() {
        // ((\x. x) 7) applied to 9  =>  App(App(Abs, Var), Var)
        let inner = app(abs("x", var(0)), var(7));
        let t = app(inner.clone(), var(9));

        assert_eq!(follow(&t, &[]).alloc_id(), t.alloc_id(), "an empty path is the root");
        assert_eq!(follow(&t, &[Dir::AppL]).alloc_id(), inner.alloc_id(), "AppL is the function side");
        assert!(matches!(follow(&t, &[Dir::AppR]).node(), Node::Var(9)), "AppR is the argument side");
        assert!(
            matches!(follow(&t, &[Dir::AppL, Dir::AppL, Dir::AbsBody]).node(), Node::Var(0)),
            "AbsBody enters the binder"
        );
    }

    #[test]
    fn a_tag_in_the_argument_classifies_as_arg_and_not_disjoint() {
        // (\x. x) (tagged 5)  — the only tagged App is inside the redex's ARGUMENT.
        let tagged_arg = app_owned(abs("y", var(0)), var(5), 42);
        let redex = app(abs("x", var(0)), tagged_arg);

        let (fn_tags, arg_tags) = redex_tag_counts(&redex);
        assert_eq!(fn_tags, 0, "the function side holds no tagged App");
        assert_eq!(arg_tags, 1, "the argument side holds exactly one");
    }

    #[test]
    fn a_tag_in_the_function_classifies_as_fn() {
        // (\x. tagged) 5  — the only tagged App is inside the redex's FUNCTION.
        let redex = app(abs("x", app_owned(abs("y", var(0)), var(1), 42)), var(5));

        let (fn_tags, arg_tags) = redex_tag_counts(&redex);
        assert_eq!(fn_tags, 1, "the function side holds exactly one tagged App");
        assert_eq!(arg_tags, 0, "the argument side holds none");
    }

    #[test]
    fn an_untagged_redex_with_no_tags_inside_is_disjoint() {
        let redex = app(abs("x", var(0)), var(5));
        let (fn_tags, arg_tags) = redex_tag_counts(&redex);
        assert_eq!(fn_tags + arg_tags, 0, "nothing tagged is reachable from this redex");
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-core --example inherit_probe`
Expected: FAIL to compile — `cannot find function 'follow'` and `cannot find function 'redex_tag_counts'`.

- [ ] **Step 3: Add the two helpers**

Add above `struct Census`:

```rust
/// The subterm of `t` at `path`. Panics if the path does not match the term's shape, which is a bug
/// in the caller and not a condition to tolerate: a `Path` produced by the reducer for a term always
/// matches that term.
fn follow<'a>(t: &'a LambdaTerm, path: &[Dir]) -> &'a LambdaTerm {
    let mut cur = t;
    for d in path {
        cur = match (d, cur.node()) {
            (Dir::AppL, Node::App(f, _, _)) => f,
            (Dir::AppR, Node::App(_, a, _)) => a,
            (Dir::AbsBody, Node::Abs(_, b)) => b,
            _ => panic!("path {path:?} does not match the term's shape at {d:?}"),
        };
    }
    cur
}

/// Tagged-`App` counts reachable from a redex's function side and its argument side, in that order.
/// `redex` must be an `App` — every redex is, by construction.
fn redex_tag_counts(redex: &LambdaTerm) -> (u64, u64) {
    let Node::App(f, a, _) = redex.node() else {
        panic!("a redex is an App by construction, got {:?}", redex.node());
    };
    (count_tagged_apps(f), count_tagged_apps(a))
}
```

Add the import: change the `lambda` use line to
`use redextape_core::lambda::{self, Dir, LambdaTerm, MAX_REDUCTION_STEPS};`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p redextape-core --example inherit_probe`
Expected: PASS, 4 passed.

- [ ] **Step 5: Wire the split into `measure` and print `[POS]`**

Extend `Census` with the five counters and populate them. Replace `struct Census` and `measure`:

```rust
struct Census {
    steps: u64,
    exact: u64,
    within: u64,
    none: u64,
    /// `None` steps with >=1 tagged `App` reachable from the redex's function side.
    pos_fn: u64,
    /// `None` steps with >=1 tagged `App` reachable from the redex's argument side.
    pos_arg: u64,
    /// `None` steps with >=1 tagged `App` reachable from the redex at all — the union of the two
    /// above, and NOT their sum: a redex can hold tags on both sides.
    pos_either: u64,
    /// `None` steps with tags alive in the term but none reachable from the redex.
    pos_disjoint: u64,
    /// `None` steps with no tagged `App` anywhere in the term. `none_probe`'s "consumed" column;
    /// carried here so the four buckets sum to `none` and a reader can check that they do.
    pos_no_tags: u64,
}

fn measure(src: &str) -> Census {
    let mut c = Census {
        steps: 0,
        exact: 0,
        within: 0,
        none: 0,
        pos_fn: 0,
        pos_arg: 0,
        pos_either: 0,
        pos_disjoint: 0,
        pos_no_tags: 0,
    };
    let Some((term, _map)) = lower_program(src) else {
        return c;
    };
    let mut real = trace::LambdaCursor::new(&term, MAX_REDUCTION_STEPS);
    loop {
        // CLONED BEFORE `next()`: the redex path indexes the term ENTERING the step. Reading
        // `term()` afterwards returns the term the step produced, in which the contracted redex no
        // longer exists and the path means something else. The clone is a refcount bump.
        let pre = real.term().clone();
        if real.next().is_none() {
            break;
        }
        c.steps += 1;
        match real.last_owner() {
            Owner::Exact(_) => c.exact += 1,
            Owner::Within(_) => c.within += 1,
            Owner::None => {
                c.none += 1;
                let path = real.last_redex().expect("a step was taken, so a redex path exists");
                let (fn_tags, arg_tags) = redex_tag_counts(follow(&pre, path));
                if fn_tags > 0 {
                    c.pos_fn += 1;
                }
                if arg_tags > 0 {
                    c.pos_arg += 1;
                }
                if fn_tags + arg_tags > 0 {
                    c.pos_either += 1;
                } else if count_tagged_apps(&pre) > 0 {
                    c.pos_disjoint += 1;
                } else {
                    c.pos_no_tags += 1;
                }
            }
        }
    }
    c
}
```

In `main`, add the header after `[OV]`'s:

```rust
    head("[POS] THE DELIVERABLE — None steps by where the live tags sit RELATIVE TO THE REDEX");
    line("  fn/arg  = >=1 tagged App reachable from the redex's function / argument side (not exclusive)");
    line("  either  = their UNION, not their sum; disjoint = tags alive but none reachable from the redex");
    line("  no-tags = no tagged App anywhere — none_probe's `consumed` column. The last three sum to None.");
    line(&format!(
        "[POS] {:<11}{:>8}{:>8}{:>8}{:>9}{:>11}{:>10}{:>10}",
        "program", "None", "fn", "arg", "either", "disjoint", "disj%", "no-tags"
    ));
```

and inside the loop, after the `[OV]` line:

```rust
        line(&format!(
            "[POS] {:<11}{:>8}{:>8}{:>8}{:>9}{:>11}{:>10}{:>10}",
            name,
            c.none,
            c.pos_fn,
            c.pos_arg,
            c.pos_either,
            c.pos_disjoint,
            fmt_pct(c.pos_disjoint, c.none),
            c.pos_no_tags,
        ));
```

- [ ] **Step 6: Run under the cap and check the arithmetic**

Run:
```bash
systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
  cargo run --release -p redextape-core --example inherit_probe
```

Expected, and check each:
- `[OV]` rows unchanged from Task 1.
- On every row, `either + disjoint + no-tags == None`. If not, the buckets are not exhaustive and the classification is wrong.
- `while4`'s `no-tags` is **15** and `countdown4`'s is **15**, matching `none_probe`'s "zero tags left" column exactly; `sum5` 2, `map_fold` 8. A different number means `[POS]` and `none_probe` disagree about the same quantity, which stops the task.

- [ ] **Step 7: Commit**

```bash
cargo fmt
git add crates/redextape-core/examples/inherit_probe.rs
git commit -m "probe: [POS] — split every None step by where the live tags sit

Owner is derived purely from the root-to-redex path, so a tag alive during a
None step is either reachable from the redex or in a subtree disjoint from it,
with no third case. The no-tags bucket reproduces none_probe's consumed column
(15/15/2/8), which is what pins the two probes to the same quantity."
```

---

### Task 3: `[MACH]` — the binder-name histogram, labelled a hint

**Files:**
- Modify: `crates/redextape-core/examples/inherit_probe.rs`

**Interfaces:**
- Consumes: `follow`, `Census` from Task 2.
- Produces: `Census` gains `mach: HashMap<Rc<str>, u64>`; `top_names(&HashMap<Rc<str>, u64>, usize) -> Vec<(Rc<str>, u64)>`.

- [ ] **Step 1: Write the failing test**

Add inside `mod tests`:

```rust
    #[test]
    fn top_names_ranks_by_count_then_name() {
        let mut h: std::collections::HashMap<std::rc::Rc<str>, u64> = std::collections::HashMap::new();
        h.insert("sel".into(), 3);
        h.insert("x".into(), 9);
        h.insert("f".into(), 9);
        h.insert("n".into(), 1);

        let top = top_names(&h, 3);
        assert_eq!(top.len(), 3, "the cap is honoured");
        assert_eq!(&*top[0].0, "f", "ties break by name so the output is stable run to run");
        assert_eq!(top[0].1, 9);
        assert_eq!(&*top[1].0, "x");
        assert_eq!(&*top[2].0, "sel");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p redextape-core --example inherit_probe`
Expected: FAIL to compile — `cannot find function 'top_names'`.

- [ ] **Step 3: Add `top_names`**

Add above `struct Census`:

```rust
/// The `n` most frequent names, most frequent first. **Ties break by name**, not by hash order: a
/// `HashMap` iterates differently run to run, and a probe whose table reorders between two runs of
/// the same code invites a reader to see a change that is not there.
fn top_names(h: &HashMap<Rc<str>, u64>, n: usize) -> Vec<(Rc<str>, u64)> {
    let mut v: Vec<(Rc<str>, u64)> = h.iter().map(|(k, c)| (Rc::clone(k), *c)).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    v.truncate(n);
    v
}
```

Add imports: `use std::collections::HashMap;` and `use std::rc::Rc;` alongside the existing `use std::collections::HashSet;`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p redextape-core --example inherit_probe`
Expected: PASS, 5 passed.

- [ ] **Step 5: Populate the histogram and print `[MACH]`**

Add the field to `Census`:

```rust
    /// Binder name of the `Abs` applied in each `None` redex. **A HINT, NOT EVIDENCE** — see the
    /// module doc: names collide across constructs with nothing else in common.
    mach: HashMap<Rc<str>, u64>,
```

and `mach: HashMap::new(),` to its initializer.

In `measure`, inside the `Owner::None` arm, after the `redex_tag_counts` call:

```rust
                let redex = follow(&pre, path);
                if let Node::App(f, _, _) = redex.node()
                    && let Node::Abs(binder, _) = f.node()
                {
                    *c.mach.entry(Rc::clone(binder)).or_insert(0) += 1;
                }
```

and hoist the `let redex = follow(&pre, path);` binding so `redex_tag_counts(redex)` uses it rather than calling `follow` twice.

In `main`, add the header after `[POS]`'s:

```rust
    head("[MACH] A HINT, NOT EVIDENCE — binder name of the Abs applied in each None redex");
    line("  Names COLLIDE across unrelated constructs: encode::church mints `f` and `x`, diverge's");
    line("  omega mints `x`, and lower.rs's fixpoint combinator mints both. Read [POS] for the finding;");
    line("  this table only orients a reader who is about to ask WHICH machinery.");
    line(&format!("[MACH] {:<11}  {}", "program", "top 5: name=count"));
```

and inside the loop:

```rust
        let top = top_names(&c.mach, 5);
        let rendered: Vec<String> = top.iter().map(|(n, k)| format!("{n}={k}")).collect();
        line(&format!("[MACH] {:<11}  {}", name, rendered.join("  ")));
```

- [ ] **Step 6: Run under the cap**

Run the probe command from Task 1 Step 3.
Expected: `[OV]` and `[POS]` unchanged; `[MACH]` prints five `name=count` pairs per program, and each program's counts sum to no more than its `None` total.

- [ ] **Step 7: Commit**

```bash
cargo fmt
git add crates/redextape-core/examples/inherit_probe.rs
git commit -m "probe: [MACH] — binder-name histogram, labelled a hint in its own header

Ties break by name rather than hash order so the table does not reorder between
two runs of the same code. The header states the collision that makes this table
suggestive rather than evidential: church mints f and x, and so does the
fixpoint combinator."
```

---

### Task 4: The shadow reducer and V1 — the conservative rule, path-checked

**Files:**
- Modify: `crates/redextape-core/examples/inherit_probe.rs`

**Interfaces:**
- Consumes: everything above.
- Produces: `enum Variant { V1, V3 }`; `shadow_step(&LambdaTerm, Option<NodeId>, Variant, &mut u64) -> Option<(LambdaTerm, Path, Owner)>`; `inherit(LambdaTerm, Option<NodeId>, Variant, &mut u64) -> LambdaTerm`; `struct VariantStats { tagged, converted, drops }`.

**Read `reduce_step_go` in `crates/redextape-core/src/lambda/reduce.rs` before writing this.** `shadow_step` mirrors it exactly; the *only* difference is the `inherit` call on the contractum. A mirror that quietly diverges elsewhere makes every number in `[INH]` a fact about the mirror.

**ORDER IS LOAD-BEARING: step the real cursor FIRST, then the shadows.** `LambdaCursor::next` applies the depth guard before reducing, and `depth_exceeds` is `pub(crate)` so this example cannot install it. Stepping the pacemaker first, and only stepping the shadows when it returned `Some`, means the shadows only ever reduce terms the guard has already cleared. `shadow_step` is recursive, exactly as `reduce_step_go` is, so this is what keeps it off the native stack's limit.

- [ ] **Step 1: Write the failing tests**

Add inside `mod tests`:

```rust
    /// Drive a term to normal form twice — once through the real `reduce_step`, once through
    /// `shadow_step` — and assert the redex paths agree at every step. **This is the load-bearing
    /// invariant of the whole `[INH]` table**: the rules change tags, never reduction order, because
    /// `reduce_step_go` picks its redex structurally and never reads a tag.
    fn assert_paths_agree(t: &LambdaTerm, v: Variant) {
        let mut real = t.clone();
        let mut shadow = t.clone();
        let mut drops = 0u64;
        let mut step = 0u64;
        loop {
            let r = reduce_step(&real);
            let s = shadow_step(&shadow, None, v, &mut drops);
            match (r, s) {
                (None, None) => break,
                (Some((rt, rp, _)), Some((st, sp, _))) => {
                    assert_eq!(rp, sp, "shadow diverged from the reducer at step {step}");
                    real = rt;
                    shadow = st;
                    step += 1;
                }
                (r, s) => panic!("one reducer halted and the other did not at step {step}: {:?} vs {:?}", r.is_some(), s.is_some()),
            }
        }
        assert!(step > 0, "the fixture must actually reduce, or this asserts nothing");
    }

    #[test]
    fn shadow_v1_reduces_in_the_same_order_as_the_real_reducer() {
        let (term, _map) = lower_program("let mut n = 2; while n > 0 { n = n - 1; } n").expect("fixture lowers");
        assert_paths_agree(&term, Variant::V1);
    }

    #[test]
    fn v1_tags_a_contractum_root_that_is_an_untagged_app() {
        // (\x. (x 1)) (\y. y)  tagged 42  =>  contractum root is App((\y.y), 1), untagged.
        let redex = app_owned(abs("x", app(var(0), var(1))), abs("y", var(0)), 42);
        let mut drops = 0u64;
        let (next, path, owner) = shadow_step(&redex, None, Variant::V1, &mut drops).expect("a redex exists");

        assert_eq!(path, Path::new(), "the redex is at the root");
        assert_eq!(owner, Owner::Exact(42), "the redex carried its own tag");
        assert_eq!(next.owner(), Some(42), "V1 must tag the contractum's root App");
        assert_eq!(drops, 0, "the root was an App, so nothing was dropped");
    }

    #[test]
    fn v1_drops_the_tag_when_the_contractum_root_is_not_an_app() {
        // (\x. \y. x) 7  tagged 42  =>  contractum root is an Abs. V1 has nowhere to put the tag.
        let redex = app_owned(abs("x", abs("y", var(1))), var(7), 42);
        let mut drops = 0u64;
        let (next, _path, owner) = shadow_step(&redex, None, Variant::V1, &mut drops).expect("a redex exists");

        assert_eq!(owner, Owner::Exact(42));
        assert!(matches!(next.node(), Node::Abs(_, _)), "the contractum root is an Abs");
        assert_eq!(drops, 1, "V1 must COUNT the tag it had nowhere to put");
    }

    #[test]
    fn a_none_redex_propagates_nothing() {
        // (\x. (x 1)) (\y. y)  UNTAGGED, with no enclosing tag => Owner::None, nothing to inherit.
        let redex = app(abs("x", app(var(0), var(1))), abs("y", var(0)));
        let mut drops = 0u64;
        let (next, _path, owner) = shadow_step(&redex, None, Variant::V1, &mut drops).expect("a redex exists");

        assert_eq!(owner, Owner::None);
        assert_eq!(next.owner(), None, "there was no owner to propagate");
        assert_eq!(drops, 0, "a None redex is not a dropped tag; it is nothing to drop");
    }
```

Add to the `mod tests` imports: `use redextape_core::lambda::reduce::reduce_step;`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-core --example inherit_probe`
Expected: FAIL to compile — `cannot find type 'Variant'`, `cannot find function 'shadow_step'`.

- [ ] **Step 3: Add `Variant`, `inherit` and `shadow_step`**

Add above `struct Census`:

```rust
/// Which contractum-inherits rule a shadow term is running. The two BRACKET the rule family: V1 is a
/// lower bound on what inheritance converts, V3 an upper bound. The intermediate rules are a family
/// nobody has enumerated, and this probe is not the place to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Variant {
    /// Conservative: tag the contractum's root if it is an untagged `App`, else nothing.
    V1,
    /// Aggressive: every untagged `App` in the contractum inherits the tag. Added in Task 5.
    V3,
}

/// Apply the inheritance rule to a contractum. `o` is the owner of the redex just contracted; `None`
/// means the redex belonged to no construct, and **a `None` redex propagates nothing** — there is no
/// tag to inherit, and inventing one would be recomputing provenance rather than inheriting it.
///
/// `drops` counts the V1 contractions whose contractum root was not an `App`, i.e. the tags V1 had
/// nowhere to put. That count is reported, not swallowed: it is the size of V1's built-in leak.
fn inherit(t: LambdaTerm, o: Option<NodeId>, v: Variant, drops: &mut u64) -> LambdaTerm {
    let Some(o) = o else { return t };
    match v {
        Variant::V1 => match t.node() {
            Node::App(f, a, None) => app_tagged_for_rebuild(f.clone(), a.clone(), Some(o)),
            _ => {
                *drops += 1;
                t
            }
        },
        // Task 5 replaces this arm.
        Variant::V3 => t,
    }
}

/// One leftmost-outermost β-step with the inheritance rule applied to the contractum.
///
/// **MIRRORS `reduce::reduce_step_go` EXACTLY, and the only difference is the `inherit` call.** Read
/// that function before changing this one. `enclosing` is the innermost tag on the path from the root
/// to `t`, EXCLUDING `t` itself, so the root-redex arm can prefer the redex's own tag.
///
/// Recursive, exactly as the function it mirrors is. **The caller must step a real `LambdaCursor`
/// first and call this only when that cursor advanced** — `LambdaCursor::next` applies the depth
/// guard, `depth_exceeds` is `pub(crate)` and unavailable here, and following the real cursor is how
/// this inherits the guard instead of reimplementing it.
fn shadow_step(
    t: &LambdaTerm,
    enclosing: Option<NodeId>,
    v: Variant,
    drops: &mut u64,
) -> Option<(LambdaTerm, Path, Owner)> {
    if let Node::App(f, a, owner) = t.node()
        && let Node::Abs(_, body) = f.node()
    {
        let who = match (owner, enclosing) {
            (Some(id), _) => Owner::Exact(*id),
            (None, Some(id)) => Owner::Within(id),
            (None, None) => Owner::None,
        };
        return Some((inherit(beta(body, a), who.node(), v, drops), Vec::new(), who));
    }
    match t.node() {
        Node::App(f, a, owner) => {
            let inner = (*owner).or(enclosing);
            if let Some((f2, mut path, who)) = shadow_step(f, inner, v, drops) {
                path.insert(0, Dir::AppL);
                Some((app_tagged_for_rebuild(f2, a.clone(), *owner), path, who))
            } else if let Some((a2, mut path, who)) = shadow_step(a, inner, v, drops) {
                path.insert(0, Dir::AppR);
                Some((app_tagged_for_rebuild(f.clone(), a2, *owner), path, who))
            } else {
                None
            }
        }
        Node::Abs(n, b) => shadow_step(b, enclosing, v, drops).map(|(b2, mut path, who)| {
            path.insert(0, Dir::AbsBody);
            (abs(Rc::clone(n), b2), path, who)
        }),
        Node::Var(_) => None,
    }
}
```

Add imports: `use redextape_core::core::NodeId;`, `use redextape_core::lambda::term::{abs, app_tagged_for_rebuild, beta};`, and extend the `lambda` line to `use redextape_core::lambda::{self, Dir, LambdaTerm, MAX_REDUCTION_STEPS, Path};`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p redextape-core --example inherit_probe`
Expected: PASS, 10 passed.

- [ ] **Step 5: Drive the V1 shadow in lockstep and count**

Add to `Census`:

```rust
    /// Per-variant simulation results. `V3`'s fields stay zero until Task 5.
    v1: VariantStats,
```

Add above `Census`:

```rust
/// What one simulated rule produced over a whole run.
#[derive(Default)]
struct VariantStats {
    /// Steps whose shadow `Owner` was not `None` — the numerator of the gate's tagged rate.
    tagged: u64,
    /// Steps the real reducer reported `None` and the shadow did not. A subset of `tagged`.
    converted: u64,
    /// Contractions whose contractum root was not an `App` (V1 only).
    drops: u64,
}
```

In `measure`, before the loop:

```rust
    let mut shadow_v1 = term.clone();
```

and inside the loop, after the real cursor advanced and before the `match real.last_owner()`:

```rust
        // STEPPED AFTER THE PACEMAKER, DELIBERATELY — see `shadow_step`'s doc on the depth guard.
        let (next_v1, path_v1, owner_v1) =
            shadow_step(&shadow_v1, None, Variant::V1, &mut c.v1.drops).expect("the real cursor advanced, so a redex exists");
        assert_eq!(
            real.last_redex().expect("a step was taken"),
            &path_v1,
            "V1 shadow diverged from the reducer at step {}: the rules change tags, never order",
            c.steps
        );
        shadow_v1 = next_v1;
        if owner_v1 != Owner::None {
            c.v1.tagged += 1;
            if real.last_owner() == Owner::None {
                c.v1.converted += 1;
            }
        }
```

In `main`, add the header:

```rust
    head("[INH] Simulated contractum-inherits rules. V1 = conservative (gates); V3 = aggressive (ceiling)");
    line(&format!(
        "[INH] {:<11}{:>8}{:>12}{:>12}{:>10}{:>10}",
        "program", "steps", "V1 tagged", "V1 conv", "V1 rate", "V1 drops"
    ));
```

and inside the loop:

```rust
        line(&format!(
            "[INH] {:<11}{:>8}{:>12}{:>12}{:>10}{:>10}",
            name,
            c.steps,
            c.v1.tagged,
            c.v1.converted,
            fmt_pct(c.v1.tagged, c.steps),
            c.v1.drops,
        ));
```

- [ ] **Step 6: Run under the cap**

Run the probe command from Task 1 Step 3.
Expected: no assertion fires (the path check passes on all four programs, ~2,125 steps in total), and `[INH]` prints a V1 tagged count that is **at least** each program's existing `Exact + Within` — the rule only ever adds tags, so a lower number means the shadow lost one.

- [ ] **Step 7: Commit**

```bash
cargo fmt
git add crates/redextape-core/examples/inherit_probe.rs
git commit -m "probe: the shadow reducer and V1, checked against the real reducer every step

shadow_step mirrors reduce_step_go and differs only in the inherit call on the
contractum. Every step asserts the shadow's redex path equals the pacemaker's,
which is the invariant that catches a mirror that has drifted: the rules change
tags and never reduction order, because reduce_step_go picks its redex
structurally and never reads a tag.

The pacemaker steps FIRST. LambdaCursor::next applies the depth guard,
depth_exceeds is pub(crate) and unavailable to an example, and stepping the
shadow only when the real cursor advanced is what keeps a recursive mirror off
the native stack's limit.

V1 counts the contractions whose contractum root was not an App rather than
swallowing them: that is the size of the rule's built-in leak."
```

---

### Task 5: V3 — the aggressive rule, and the sharing hazard it carries

**Files:**
- Modify: `crates/redextape-core/examples/inherit_probe.rs`

**Interfaces:**
- Consumes: `Variant`, `inherit`, `shadow_step`, `VariantStats` from Task 4.
- Produces: `retag_all(&LambdaTerm, NodeId) -> LambdaTerm`; `Census` gains `v3: VariantStats`.

**THE HAZARD, and why the memo is not an optimization.** Re-tagging every untagged `App` in a contractum means rebuilding nodes, and a naive walk rebuilds a shared subterm once per reference — deep-copying the DAG into the tree it denotes. That is the structural-sharing blowup `max_shared_logical_size` exists to guard against and the mechanism behind the 60 GiB run this probe family's discipline was written from. Memoizing by `alloc_id` rebuilds each allocation once and re-shares it, so sharing is preserved exactly.

- [ ] **Step 1: Write the failing tests**

Add inside `mod tests`:

```rust
    #[test]
    fn retag_all_tags_every_untagged_app_and_leaves_existing_tags_alone() {
        // App( App(\x.x, 1) [tagged 7], \y.y )  — outer App untagged, inner App already tagged 7.
        let inner = app_owned(abs("x", var(0)), var(1), 7);
        let t = app(inner, abs("y", var(0)));

        let out = retag_all(&t, 42);
        assert_eq!(out.owner(), Some(42), "the untagged outer App inherits");
        let Node::App(f, _, _) = out.node() else { panic!("shape preserved") };
        assert_eq!(f.owner(), Some(7), "an App that already had a tag KEEPS it");
    }

    #[test]
    fn retag_all_preserves_structural_sharing() {
        // One allocation referenced twice. After re-tagging, the two positions must STILL be one
        // allocation — a walk without the alloc_id memo rebuilds it twice and silently deep-copies
        // the DAG, which is the blowup this probe is capped against.
        let shared = app(abs("x", app(var(0), var(0))), abs("y", var(0)));
        let t = app(shared.clone(), shared.clone());

        let out = retag_all(&t, 42);
        let Node::App(l, r, _) = out.node() else { panic!("shape preserved") };
        assert_eq!(l.alloc_id(), r.alloc_id(), "the shared subterm must be rebuilt ONCE and re-shared");
    }

    #[test]
    fn retag_all_leaves_vars_and_abs_shapes_intact() {
        let t = abs("x", app(var(0), var(1)));
        let out = retag_all(&t, 42);
        let Node::Abs(name, body) = out.node() else { panic!("an Abs stays an Abs") };
        assert_eq!(&**name, "x", "the binder name is preserved");
        assert_eq!(body.owner(), Some(42), "the App inside inherits");
    }

    #[test]
    fn shadow_v3_reduces_in_the_same_order_as_the_real_reducer() {
        let (term, _map) = lower_program("let mut n = 2; while n > 0 { n = n - 1; } n").expect("fixture lowers");
        assert_paths_agree(&term, Variant::V3);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-core --example inherit_probe`
Expected: FAIL to compile — `cannot find function 'retag_all'`. (`shadow_v3_reduces_...` compiles but would pass vacuously against Task 4's stub arm; it becomes meaningful once Step 3 lands.)

- [ ] **Step 3: Add `retag_all` and wire the V3 arm**

Add above `inherit`:

```rust
/// Rebuild `t` with every untagged `App` carrying `o`, **PRESERVING STRUCTURAL SHARING**. An `App`
/// that already carries a tag keeps it: the nearer tag is the more precise claim, and overwriting it
/// would make an inherited tag beat a lowered one.
///
/// **THE `alloc_id` MEMO IS NOT AN OPTIMIZATION.** Without it a shared subterm is rebuilt once per
/// reference, which deep-copies the DAG into the tree it denotes — the blowup `max_shared_logical_size`
/// guards against, and why this probe runs under a hard memory cap. With it, each allocation is
/// rebuilt once and re-shared, and the walk is O(physical allocations): the same order as the
/// `count_tagged_apps` walk already running per step.
///
/// Iterative over an explicit stack with a children-done marker, never recursive — a walk added to a
/// probe whose reason to exist is capped-memory safety must not risk a native stack overflow itself.
/// A node reached twice before either visit completes may be pushed twice; the memo check makes the
/// second pass a no-op and the result identical.
fn retag_all(t: &LambdaTerm, o: NodeId) -> LambdaTerm {
    let mut memo: HashMap<usize, LambdaTerm> = HashMap::new();
    let mut stack: Vec<(&LambdaTerm, bool)> = vec![(t, false)];
    while let Some((node, expanded)) = stack.pop() {
        if memo.contains_key(&node.alloc_id()) {
            continue;
        }
        if expanded {
            let rebuilt = match node.node() {
                Node::Var(_) => node.clone(),
                Node::Abs(n, b) => abs(Rc::clone(n), memo[&b.alloc_id()].clone()),
                Node::App(f, a, owner) => app_tagged_for_rebuild(
                    memo[&f.alloc_id()].clone(),
                    memo[&a.alloc_id()].clone(),
                    owner.or(Some(o)),
                ),
            };
            memo.insert(node.alloc_id(), rebuilt);
        } else {
            stack.push((node, true));
            match node.node() {
                Node::Var(_) => {}
                Node::Abs(_, b) => stack.push((b, false)),
                Node::App(f, a, _) => {
                    stack.push((f, false));
                    stack.push((a, false));
                }
            }
        }
    }
    memo[&t.alloc_id()].clone()
}
```

Replace `inherit`'s V3 arm:

```rust
        Variant::V3 => retag_all(&t, o),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p redextape-core --example inherit_probe`
Expected: PASS, 14 passed.

- [ ] **Step 5: Drive the V3 shadow alongside V1**

Add `v3: VariantStats,` to `Census` and its initializer. In `measure`, add `let mut shadow_v3 = term.clone();` beside `shadow_v1`, and after the V1 block:

```rust
        let (next_v3, path_v3, owner_v3) =
            shadow_step(&shadow_v3, None, Variant::V3, &mut c.v3.drops).expect("the real cursor advanced, so a redex exists");
        assert_eq!(
            real.last_redex().expect("a step was taken"),
            &path_v3,
            "V3 shadow diverged from the reducer at step {}",
            c.steps
        );
        shadow_v3 = next_v3;
        if owner_v3 != Owner::None {
            c.v3.tagged += 1;
            if real.last_owner() == Owner::None {
                c.v3.converted += 1;
            }
        }
```

Extend `[INH]`'s header and row with `V3 tagged`, `V3 conv`, `V3 rate`:

```rust
    line(&format!(
        "[INH] {:<11}{:>8}{:>12}{:>12}{:>10}{:>10}{:>12}{:>12}{:>10}",
        "program", "steps", "V1 tagged", "V1 conv", "V1 rate", "V1 drops", "V3 tagged", "V3 conv", "V3 rate"
    ));
```

```rust
        line(&format!(
            "[INH] {:<11}{:>8}{:>12}{:>12}{:>10}{:>10}{:>12}{:>12}{:>10}",
            name,
            c.steps,
            c.v1.tagged,
            c.v1.converted,
            fmt_pct(c.v1.tagged, c.steps),
            c.v1.drops,
            c.v3.tagged,
            c.v3.converted,
            fmt_pct(c.v3.tagged, c.steps),
        ));
```

- [ ] **Step 6: Run under the cap — this is the step that could OOM**

Run the probe command from Task 1 Step 3.
Expected: completes within the 2G cap; `V3 tagged >= V1 tagged` on every row, since V3 tags a superset of what V1 tags.

**If it OOM-kills or hangs, that is a RESULT.** Do not raise the cap. Record which program it died on and how far the tables got (they flush per program, so the completed rows are trustworthy), and report.

- [ ] **Step 7: Commit**

```bash
cargo fmt
git add crates/redextape-core/examples/inherit_probe.rs
git commit -m "probe: V3, the aggressive rule, and the alloc_id memo that makes it safe

Re-tagging every untagged App in a contractum rebuilds nodes, and without a memo
a shared subterm is rebuilt once per reference — deep-copying the DAG into the
tree it denotes, which is the blowup max_shared_logical_size guards against.
Memoized by alloc_id, each allocation is rebuilt once and re-shared, and a test
pins that the two references to a shared subterm are still one allocation after
re-tagging.

An App that already carries a tag keeps it: the nearer tag is the more precise
claim, and an inherited tag must not beat a lowered one."
```

---

### Task 6: M2 span widths and the gate verdict

**Files:**
- Modify: `crates/redextape-core/examples/inherit_probe.rs`

**Interfaces:**
- Consumes: `VariantStats`, `lower_program`'s `SourceMap`.
- Produces: `percentile(&[f64], f64) -> Option<f64>`; `median(&[f64]) -> Option<f64>`; `VariantStats` gains `within_widths: Vec<f64>`; a printed `[GATE]` block.

**The gate, copied from the design so it is not re-derived here.** FLOOR: V1 lifts `while4` to **≥31.1%** and `countdown4` to **≥32.5%**. CEILING: the count of programs whose median `Within` span exceeds 60% of program length must not increase — today **1 of these 4** (`sum5`, at 65.0%). The gate reads **V1 only**; V3 is reported beside it. **Both must hold or the contractum-inherits slice is not built.**

**Do not adjust these numbers.** If the gate binds, stop and report — that is what #28's plan instructed on the same situation, and shipping anyway was then an explicit human decision taken with the shortfall on the table.

- [ ] **Step 1: Write the failing tests**

Add inside `mod tests`:

```rust
    #[test]
    fn percentile_is_nearest_rank_over_sorted_values() {
        let xs = vec![10.0, 30.0, 20.0, 40.0];
        assert_eq!(percentile(&xs, 0.0), Some(10.0), "p0 is the smallest VALUE, not the first element");
        assert_eq!(percentile(&xs, 1.0), Some(40.0));
        assert_eq!(median(&xs), Some(20.0), "even length takes the lower of the two middles");
    }

    #[test]
    fn an_empty_width_list_has_no_median_rather_than_a_zero() {
        // A program with zero `Within` steps has NO span width to report, which is a different fact
        // from a width of zero. Collapsing them would print a degenerate-looking 0.0% for a program
        // that simply never reported Within.
        assert_eq!(median(&[]), None);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-core --example inherit_probe`
Expected: FAIL to compile — `cannot find function 'percentile'`.

- [ ] **Step 3: Add `percentile` and `median`**

Add above `struct Census` (this mirrors `owner_probe.rs`'s pair — read it, and keep the same nearest-rank convention so the two probes' medians mean the same thing):

> **⚠ PLAN DEFECT — THE SKETCH BELOW IS WRONG AND WAS NOT SHIPPED. Do not copy it.**
> Annotated after execution rather than corrected in place, per this tree's convention of keeping the
> record. **Its `.round()`-based rank contradicts Step 1's own test**: on that test's fixture
> `[10, 30, 20, 40]`, `(0.5 * 3).round() == 2`, which indexes the sorted slice at `20, 30` → `30.0`,
> while the test asserts `Some(20.0)`. `owner_probe.rs` uses a **`ceil`-based** rank
> (`ceil(q * len).clamp(1, len) - 1`), which yields `20.0` and is what the implementer used after
> checking the real source. **The plan prescribed both an assertion and the code meant to satisfy it,
> and never checked that the two agree** — the same defect #28's closing entry wrote its transferable
> rule against, and a rule this plan followed and still tripped over. Read `owner_probe.rs`; do not
> read this block.

```rust
/// Nearest-rank percentile over VALUES: sorts a copy and indexes it. `q` in `0.0..=1.0`.
/// `None` for an empty slice — a program with no `Within` step has no width to report, which is a
/// different fact from a width of zero. Same convention as `owner_probe.rs`.
fn percentile(xs: &[f64], q: f64) -> Option<f64> {
    if xs.is_empty() {
        return None;
    }
    let mut v = xs.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).expect("span widths are finite"));
    let idx = ((q * (v.len() - 1) as f64).round() as usize).min(v.len() - 1);
    Some(v[idx])
}

fn median(xs: &[f64]) -> Option<f64> {
    percentile(xs, 0.5)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p redextape-core --example inherit_probe`
Expected: PASS, 16 passed.

- [ ] **Step 5: Collect widths under each variant and print `[GATE]`**

Add `within_widths: Vec<f64>,` to `VariantStats`. In `measure`, keep the `SourceMap` (`let Some((term, map)) = lower_program(src)`) and inside each variant's block, when the shadow owner is `Owner::Within(id)`:

```rust
        if let Owner::Within(id) = owner_v1
            && let Some(s) = map.source_span(id)
        {
            c.v1.within_widths.push((s.end - s.start) as f64 / src.len() as f64 * 100.0);
        }
```

and the same for `owner_v3` into `c.v3.within_widths`.

Add this lookup beside `median`, at module level:

```rust
/// One program's V1 tagged rate, by name. `None` when that program produced no row at all — which
/// the gate must treat as a FAIL rather than a skip, since a program that did not run cannot have
/// cleared a floor.
fn rate_of(rows: &[(&str, f64, Option<f64>, Option<f64>)], name: &str) -> Option<f64> {
    rows.iter().find(|(n, _, _, _)| *n == name).map(|(_, r, _, _)| *r)
}
```

In `main`, before the per-program loop:

```rust
    // (name, V1 tagged rate, V1 Within median, V3 Within median). Collected as the loop runs so the
    // gate is evaluated once, at the end, over all four rows.
    let mut rows: Vec<(&str, f64, Option<f64>, Option<f64>)> = Vec::new();
```

inside the loop, after the `[INH]` line:

```rust
        let v1_rate = if c.steps == 0 { 0.0 } else { 100.0 * c.v1.tagged as f64 / c.steps as f64 };
        rows.push((name, v1_rate, median(&c.v1.within_widths), median(&c.v3.within_widths)));
```

and after the loop:

```rust
    head("[GATE] The pre-registered rule. FLOOR: V1 >= 31.1% on while4 and >= 32.5% on countdown4.");
    line("  CEILING: the count of programs with a V1 Within median > 60% must not exceed 1 (sum5 today).");
    line("  THE GATE READS V1 ONLY. V3 is the ceiling of the rule family, not the thing being admitted.");
    for (name, v1_rate, v1_med, v3_med) in &rows {
        line(&format!(
            "[GATE] {name:<11} V1 rate {:>7}   V1 Within median {:>8}   V3 Within median {:>8}",
            format!("{v1_rate:.1}%"),
            v1_med.map_or_else(|| "-".to_string(), |m| format!("{m:.1}%")),
            v3_med.map_or_else(|| "-".to_string(), |m| format!("{m:.1}%")),
        ));
    }
    // `is_some_and`, so a program missing from `rows` fails the floor rather than passing it by
    // absence. The two constants are the pre-registered thresholds and are not to be adjusted.
    let floor_ok = rate_of(&rows, "while4").is_some_and(|r| r >= 31.1)
        && rate_of(&rows, "countdown4").is_some_and(|r| r >= 32.5);
    let degenerate = rows.iter().filter(|(_, _, m, _)| m.is_some_and(|m| m > 60.0)).count();
    line(&format!(
        "[GATE] FLOOR {}   CEILING {} ({degenerate} degenerate, was 1)   => SLICE {}",
        if floor_ok { "PASS" } else { "FAIL" },
        if degenerate <= 1 { "PASS" } else { "FAIL" },
        if floor_ok && degenerate <= 1 { "BUILD" } else { "DO NOT BUILD" },
    ));
```

Note `name` is `&&str` inside `for (name, src) in &programs()`, so the `rows.push` above takes it as-is and the tuple's first field is `&str` after deref coercion at the push site; if the compiler asks for it, write `*name`.

- [ ] **Step 6: Run under the cap and read the verdict**

Run the probe command from Task 1 Step 3.
Expected: a `[GATE]` block ending in `SLICE BUILD` or `SLICE DO NOT BUILD`.

**Whichever it says is the result.** Do not adjust the thresholds. Task 7 reports it either way.

- [ ] **Step 7: Commit**

```bash
cargo fmt
git add crates/redextape-core/examples/inherit_probe.rs
git commit -m "probe: M2 span widths under each variant, and the pre-registered gate

Floor and ceiling both read V1: a rule admitted on the strength of its most
aggressive variant has been chosen by its best case. Median is nearest-rank over
values, the same convention owner_probe uses, and an empty width list has no
median rather than a zero — a program with no Within step has no width to
report, which is a different fact from a width of zero."
```

---

### Task 7: Run the measurement, execute the mutation table, report

**Files:**
- Modify: none permanently. Each mutation is applied, observed, and reverted.

**Interfaces:**
- Consumes: the finished probe.
- Produces: the numbers, and a report. **No roadmap entry is written by this task** — the closing entry is written after the human decides what to do with the verdict, which is #28's sequence and the reason its record is legible.

**Why this is a task and not a footnote.** #28's closing rule: *an assertion prescribed by a plan is not evidence that the assertion works. Every acceptance step should name a mutation AND state the expected failure, so that writing one forces checking the other.* That plan prescribed an assertion **and** the mutation meant to prove it bites, and never checked that the one detects the other — the assertion did not. Observing each failure is the deliverable here; the assertion's existence is not.

- [ ] **Step 1: Take the clean measurement**

Run:
```bash
systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
  cargo run --release -p redextape-core --example inherit_probe 2>&1 | tee /tmp/claude-1000/-home-davey-projects-redextape/inherit_probe_run.txt
```

Record all four tables and the `[GATE]` verdict verbatim.

- [ ] **Step 2: Mutation 1 — the shadow must track the real reducer's order**

Apply: in `shadow_step`'s non-root `App` arm, try the argument side before the function side (swap the two `if let` branches).
Run: `cargo test -p redextape-core --example inherit_probe`
Expected failure: `shadow_v1_reduces_in_the_same_order_as_the_real_reducer` fails with `shadow diverged from the reducer at step 0` (or an early step).
**Revert.**

- [ ] **Step 3: Mutation 2 — V1 must actually tag something**

Apply: make `inherit`'s `Variant::V1` arm return `t` unchanged in every case.
Run the probe under the cap.
Expected failure: `[INH]`'s `V1 conv` column reads `0` on all four rows, and `V1 tagged` collapses to each program's existing `Exact + Within`.
**Revert.**

- [ ] **Step 4: Mutation 3 — the memo is what keeps V3 inside the cap**

Apply: in `retag_all`, remove the `if memo.contains_key(&node.alloc_id()) { continue; }` guard **and** the memo lookup reuse, rebuilding each node's children unconditionally (i.e. make it a plain recursive rebuild).
Run the probe under the cap.
Expected failure: OOM-kill under `MemoryMax=2G`, or a run that does not finish. Record which program it died on.
**Revert.** If it does *not* blow up, that is a finding worth reporting — it would mean these four programs carry less sharing than assumed, and the memo's justification is theoretical on this corpus.

- [ ] **Step 5: Mutation 4 — `[POS]` must read the term entering the step**

Apply: in `measure`, classify against `real.term()` after `next()` instead of the cloned `pre`.
Run the probe under the cap.
Expected failure: either a panic from `follow` (the path no longer matches the post-step term's shape) or a visibly different `disjoint` share on `while4`. Either outcome demonstrates the pre/post distinction; record which one happened.
**Revert.**

- [ ] **Step 6: Mutation 5 — the ceiling must be able to bite**

Apply: in the `[GATE]` block, count degenerate programs from `v3_med` instead of `v1_med`.
Run the probe under the cap.
Expected failure: the `CEILING` line changes verdict — if V3 degenerates a second program, `CEILING FAIL`. If it does not change, **the ceiling is not currently able to bite on this corpus and that must be reported as a limitation of the gate**, not passed over.
**Revert.**

- [ ] **Step 7: Confirm the tree is clean and the tests still pass**

Run: `git diff --stat` — expected: empty (every mutation reverted).
Run: `cargo test -p redextape-core --example inherit_probe` — expected: PASS, 16 passed.
Run: `cargo clippy -p redextape-core --all-targets -- -D warnings` — expected: no warnings.

- [ ] **Step 8: Report**

Write the report to the human. It must contain, in this order:

1. The `[GATE]` verdict, stated first and plainly — `BUILD` or `DO NOT BUILD`.
2. All four tables.
3. **The `[POS]` finding in words**: what share of the `None` steps are `disjoint`, and therefore whether §0's two readings — #28's "misplaced tags, real headroom" and `reduce.rs`'s "combinator interiors, no repair" — are still both alive.
4. The five mutation outcomes, each as *observed*, including any that did not fail as predicted.
5. What the run could not establish.

**If the gate binds, stop there.** Do not adjust a threshold, do not propose a softer reading, and do not start the slice. The decision to override a bound threshold is the human's, taken explicitly with the shortfall on the table — that is the precedent #28 set and the reason its record reads honestly.

---

## Self-Review

**Spec coverage.** §1's `[POS]` split → Task 2. §1's `[MACH]` histogram and its hint caveat → Task 3. §2's V1, the lockstep construction and the path assertion → Task 4. §2's V3 and the `alloc_id` memo → Task 5. §3's floor, ceiling and V1-only reading → Task 6. §4's four programs and flush-per-program → Task 1. §5's five mutations, each with its expected failure → Task 7. §6's "does not build anything" → the Global Constraint that no `src/` file is touched, with an instruction to stop if one seems necessary.

**Type consistency.** `Variant`, `VariantStats`, `Census`, `shadow_step`, `inherit`, `retag_all`, `follow`, `redex_tag_counts`, `top_names`, `percentile`, `median`, `lower_program` are each defined once and used under the same name and signature everywhere after. `Census` grows fields across Tasks 2, 3, 4, 5 and 6; each task states which fields it adds and updates the initializer in the same step.

**Placeholder scan.** One found and fixed: Task 6 Step 5 originally left `floor_ok` as a comment and described how to compute it in prose. It now ships `rate_of` and the two `is_some_and` comparisons as code, with the missing-program case resolved explicitly to FAIL. No `TBD`, no "similar to Task N", no step that describes a code change without showing the code.

## Defects found during execution, kept rather than silently corrected

**Five, and the rate did not improve on the two preceding slices.** #28 ran four sketch failures in
five tasks and 5c two in five; this plan ran four, plus one wrong prediction.

1. **Task 1's Step 1 code fails `-D warnings` as written** — `count_tagged_apps` is unused until Task
   2 calls it, and the pre-commit clippy gate treats dead code as a hard error. Resolved in execution
   with a scoped `#[allow(dead_code)]` carrying a reason, removed by Task 2.
2. **Task 2's test block could not observe the property it named.** `an_untagged_redex_with_no_tags_inside_is_disjoint`
   asserts only that the redex's tag counts are `(0, 0)` — identical for a `disjoint` step and a
   `no-tags` step, since that distinction lives in a whole-term check no test touched. **Swapping the
   two branches left all four tests green.** Fixed in execution by extracting a pure classifier.
3. **Task 2's replacement snippets dropped `Census`'s and `measure`'s doc comments**, so a faithful
   implementer deletes documentation as a side effect of following the plan.
4. **Task 6's `percentile` sketch contradicts its own test** — see the annotation at Step 3 above.
5. **Task 6 never asked for tests of the gate arithmetic itself**, so `floor_ok`, the degenerate count
   and `rate_of` shipped with no coverage: a flipped inequality, a `< 1` ceiling, or a ceiling reading
   the wrong variant would have compiled and passed all twenty tests, **on the one piece of code whose
   output is the word `BUILD`.** Caught by the whole-branch review and fixed before merge.

**And one prediction that was simply wrong.** §5's acceptance table asserted that dropping the
`alloc_id` memo would make `map_fold` OOM-kill under the 2G cap. It does not: the unmemoized walk ran
all four programs to completion with byte-identical output. Sharing IS lost without the memo — a unit
test pins that — but the cost is undemonstrated on this corpus. **The mutation-plus-expected-failure
discipline worked exactly as intended there: it caught the plan's own unearned claim.**

**The step counts in "Expected: PASS, N passed" lines are as-planned and are now historical.** Fix
passes added tests at Tasks 2, 4 and 6; the shipped suite is larger than any figure in this document.

**One deliberate deviation from the skill's default, stated so a reviewer can reject it.** The skill's TDD cycle assumes a test suite the CI runs. This deliverable is a probe, and `ci.yml` line 246 records that nextest does not instrument example targets — so `cargo test -p redextape-core --example inherit_probe` is a manual command and nothing here reaches the 90% coverage floor. Tasks 2 through 6 still open with a failing test and close with a passing one; Tasks 1 and 7 are gated on a measured run instead, because what they deliver is a number and not a behaviour. This matches how `owner_probe` and `none_probe` are already treated in this tree.
