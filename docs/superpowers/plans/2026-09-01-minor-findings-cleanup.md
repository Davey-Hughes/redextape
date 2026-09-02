# Minor Findings Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four STILL OPEN minor findings this repository's roadmap has carried since 2026-07-30/31, and correct the one filed count that measurement shows is wrong.

**Architecture:** Five independent changes to `redextape-core`, none depending on another: a `debug_assert` plus a source-scanning gate for `LambdaTerm`'s hand-written `Drop`; a public re-export of `Node`; a strengthened sharing assertion with a mandatory sabotage; a documentation-density comparison whose direction is to be measured rather than assumed; and a roadmap correction. No production behaviour changes in release builds.

**Tech Stack:** Rust (workspace `redextape-core`), `cargo nextest`, `pre-commit`, Forgejo PRs.

## Global Constraints

- Clippy: `all = "warn"` and `pedantic = { level = "warn", priority = -1 }` workspace-wide, enforced as `-D warnings` in CI. **No lint may be `#[allow]`ed** — see `docs/superpowers/specs/2026-08-10-clippy-pedantic-design.md`.
- Library code may not `unwrap`/`expect`/`panic!`/`todo!`/`unimplemented!` — five workspace lints. **Test code is exempt via `clippy.toml`**; read that file before adding a test that trips one.
- `pre-commit` runs on **every** commit and includes `cargo clippy` with `-D warnings`. A commit that does not stand alone green is infeasible; collapse commits and say so rather than passing `--no-verify`.
- **No `file:line` citations in tracked source.** `scripts/check-citations.sh` refuses them. `docs/` is out of scope by design (spec §4.2), so the roadmap may cite line numbers; `crates/**` may not.
- Commit messages carry **no attribution trailers** of any kind.
- A roadmap entry is written **before** the PR is opened, not after.
- PR body paragraphs are **one long line each** — Forgejo renders with GFM `breaks: true`, so a hard-wrapped paragraph shows as forced line breaks.
- Every figure quoted in the roadmap entry names the command that produced it and is re-run at the commit it is quoted for.

---

## File Structure

| Path | Action | Responsibility |
| --- | --- | --- |
| `crates/redextape-core/src/lambda/term.rs` | Modify | `Drop` gains the `debug_assert`; the sharing test gains its sibling-identity assertion |
| `crates/redextape-core/tests/no_weak_handles.rs` | Create | The source-scanning gate plus its own self-test |
| `crates/redextape-core/src/lambda.rs` | Modify | Re-export `Node` |
| `crates/redextape-core/src/viewmodel.rs` | Modify | Collapse a two-line import to one |
| `crates/redextape-core/tests/lambda_sharing.rs` | Modify | Collapse a two-line import to one |
| `crates/redextape-core/examples/none_probe.rs` | Modify | Collapse a two-line import to one |
| `crates/redextape-core/tests/viewmodel_contract.rs` | Modify | Collapse a two-line import to one (`fn walk`) |
| `crates/redextape-core/src/lib.rs` | Modify | Task 4's doc-density decision |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | Modify | Correct four STILL OPEN bullets, correct B's count, add the closing entry |

---

## Task 1: The `Drop` trap — `debug_assert` plus a no-`Weak` gate

Closes the roadmap bullet *"STILL OPEN — the `if let Some(root) = Rc::get_mut(..)` in `term.rs`'s `impl Drop for LambdaTerm` has a silently empty else-branch."*

`LambdaTerm`'s `Drop` unlinks the root's children so the compiler's drop glue has nothing deep to descend into. `Rc::get_mut` returns `Some` today because the strong count is 1 (checked) and no `Weak` handle exists anywhere. If a `Weak` is ever introduced, `get_mut` returns `None`, the `if let` falls through silently, and the destructor degenerates to the recursive glue it exists to replace — overflowing the stack on exactly the deep terms it was written for.

**Files:**
- Modify: `crates/redextape-core/src/lambda/term.rs` (the `impl Drop for LambdaTerm` body)
- Create: `crates/redextape-core/tests/no_weak_handles.rs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on. `tests/no_weak_handles.rs` exposes `offending_lines(&str) -> Vec<(usize, String)>` only within its own test binary.

### Two decisions this task is executing, not re-opening

1. **The gate's ban is wider than the invariant, on purpose.** It refuses *any* weak handle in `crates/redextape-core/src`, not only a weak handle to an `Rc<Node>`. Narrowing it to the term type needs type resolution a source walk does not have. The crate has none today, so the over-approximation costs nothing now, and its doc must say so.
2. **The `debug_assert`'s firing is demonstrated by a sabotage, run and reverted — never by a committed test.** A committed test would have to mint a weak handle, which this same gate would then reject. The two checks are in direct conflict. Step 9 runs that sabotage; nothing from it is committed.

- [ ] **Step 1: Write the gate and its self-test**

Create `crates/redextape-core/tests/no_weak_handles.rs`:

```rust
//! The gate behind `LambdaTerm`'s hand-written `Drop`.
//!
//! That destructor unlinks the root's children so the compiler's field drop glue — which runs after
//! it returns — has nothing deep to descend into. It reaches those children through `Rc::get_mut`,
//! which is `Some` only while the strong count is 1 AND no weak handle to the same allocation
//! exists. The strong count is checked at the call site. The second half was, until this file, a
//! grep somebody ran once and wrote into a comment. This runs that grep.
//!
//! THE BAN IS WIDER THAN THE INVARIANT AND THAT IS DELIBERATE. The invariant is about weak handles
//! to a TERM's allocation; this refuses every weak handle anywhere under `src`, because deciding
//! which `Rc` a handle points at needs type resolution a text walk does not have. The crate has
//! none today, so the over-approximation costs nothing; the day one is wanted for an unrelated
//! type, this gate is the conversation about whether the destructor still holds.
//!
//! IT WALKS `src`, NOT THE WHOLE CRATE, and the reason is this file rather than any judgement
//! about the rest of the tree: `NEEDLES` and the self-test's probe fixtures are code lines full of
//! needles, so a walk over the whole crate would flag the gate itself on every run. `tests/` and
//! `examples/` sitting outside the walk is a consequence of that, not a finding that nothing there
//! could matter.
//!
//! THE ROUTES BELOW DEFEAT IT, NAMED HERE RATHER THAN DISCOVERED LATER, in the same spirit as
//! `redextape-test-support`'s derive-site scanner names its own. Naming them is not the same as
//! having enumerated them: `NEEDLES` is a blacklist, and a blacklist holds only the spellings
//! somebody has already thought of. `Rc::new_cyclic` was named here as a route until it was gated
//! instead — it is now the fifth needle below — and that move shortened this list without making it
//! complete.
//!
//! 1. A macro that expands to a downgrade or a cyclic construction only at its call site.
//! 2. A `#[path]` attribute resolving outside `src`.
//! 3. IF a public accessor ever hands out a term's `Rc`, a weak handle minted in `tests/` or
//!    `examples/` would be outside this walk, and a test that then dropped a deep term would still
//!    overflow with nothing here to say why. That route is shut today by privacy rather than by
//!    this gate: `LambdaTerm`'s `Rc` field is private, `crate::lambda::term` has no submodule
//!    outside its own file, and no public function in the crate returns that `Rc` — so
//!    `src/lambda/term.rs` is the whole surface on which a handle to a term can be minted at all.
//!    That is both why banning every file under `src` costs nothing and what makes this route real
//!    the day the field opens up.
//!
//! IT SCANS CODE LINES ONLY. `//`-prefixed lines are skipped, because the destructor's own comment
//! and this file's own prose both discuss weak handles in English and a substring scan over prose
//! would fail against the very explanation it exists to enforce.

// Test target: `clippy.toml`'s `allow-*-in-tests` keys do not reach free helpers in a `tests/`
// target, so the exemption is stated per target, same as every other file under this directory.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::fs;
use std::path::Path;

/// The five spellings that mint or name a weak handle, and what each one is for. `Weak<` catches a
/// type position. `rc::Weak` catches every import route for the type, including
/// `use std::rc::Weak as Alias`. `Rc::downgrade` catches the canonical call. `downgrade` catches
/// that same call under ANY alias for the `Rc` path — `use std::rc::Rc as Handle;` followed by
/// `Handle::downgrade(&t.0)` contains none of the other three and compiles — so the bare form
/// strictly subsumes `Rc::downgrade`, which is kept because it is the spelling the destructor's
/// comment and this file's prose name. The method name is the one part that cannot be aliased the
/// way the type path can, which is what makes the bare form hard to dodge without a macro.
/// `Rc::downgrade` is the only FUNCTION that mints a weak handle from a strong one, but a needle
/// matches a SPELLING, and conflating the two is what let the aliased call above pass this gate.
/// Adding `downgrade` cost nothing when it was added: `grep -rn 'Weak\|downgrade' crates/*/src/`
/// matched no line workspace-wide. `new_cyclic` is the odd one out: it mints nothing from a strong
/// handle, it hands its closure a `&Weak<T>` to the allocation being built, so a call site can reach
/// a weak handle with no `downgrade` and no `Weak` anywhere on the line — the closure's parameter
/// type is inferred, so the call need name neither the type nor the method. It is spelled bare for
/// the same reason `downgrade` is: `use std::rc::Rc as Handle;` then `Handle::new_cyclic(..)`
/// contains no path-qualified form, and that exact alias construction is what defeated this gate
/// once already. It too cost nothing when it was added: `grep -rn 'new_cyclic' crates/` matched no
/// line outside this file's own doc. None of the five appears in ordinary prose about this subject,
/// which is what lets the scan run over string literals as well as code.
const NEEDLES: [&str; 5] = ["Rc::downgrade", "Weak<", "rc::Weak", "downgrade", "new_cyclic"];

/// The 1-based line number and trimmed text of every non-comment line of `src` carrying a needle.
fn offending_lines(src: &str) -> Vec<(usize, String)> {
    src.lines()
        .enumerate()
        .filter(|(_, line)| !line.trim_start().starts_with("//"))
        .filter(|(_, line)| NEEDLES.iter().any(|needle| line.contains(needle)))
        .map(|(i, line)| (i + 1, line.trim().to_string()))
        .collect()
}

fn walk(dir: &Path, hits: &mut Vec<String>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            walk(&path, hits);
        } else if path.extension().is_some_and(|e| e == "rs") {
            let src = fs::read_to_string(&path).unwrap();
            for (line_no, line) in offending_lines(&src) {
                hits.push(format!("{} line {line_no}: {line}", path.display()));
            }
        }
    }
}

/// A gate that has only ever run against a passing tree cannot tell you it still works, so this
/// runs first and feeds the matcher inputs chosen to break it. The benign half matters as much as
/// the offending half: a scan that fired on the destructor's own explanatory comment would be
/// reverted within the hour, and a reverted gate catches nothing. Each benign fixture embeds a
/// needle verbatim inside a comment, so the assertion can only pass because `offending_lines`'
/// comment filter removed the line — not because the fixture happened to dodge the substring it
/// exists to prove the filter catches. One offending fixture — `Handle::downgrade(&t.0)` — spells
/// the call under an aliased `Rc` path and names neither `Rc::downgrade` nor `Weak` at all, because
/// that exact alias route once walked past every other needle and defeated an earlier version of
/// this gate, so pinning it here exercises the `downgrade` needle from this tree rather than only
/// from a report. A second offending fixture spells `Rc::new_cyclic` and was checked character by
/// character to contain none of the other four needles, because a probe that also matches an older
/// needle proves nothing about the new one: `downgrade` shipped for one commit with no probe that
/// could fail for it alone, and every needle added since is pinned by a fixture that is its alone.
#[test]
fn the_scan_catches_every_spelling_it_claims_to_and_no_prose() {
    for probe in [
        "        let handle = Rc::downgrade(&self.0);",
        "struct Holder { back: Weak<Node> }",
        "use std::rc::Weak;",
        "use std::rc::Weak as Backref;",
        "    let w = Handle::downgrade(&t.0);",
        "    let t = Rc::new_cyclic(|me| Node::Leaf(me.clone()));",
    ] {
        assert_eq!(
            offending_lines(probe).len(),
            1,
            "the scan missed a weak-handle spelling it claims to catch: {probe:?}"
        );
    }
    for benign in [
        "// never calls Rc::downgrade anywhere in this crate",
        "/// holds no Weak<Node> field, only strong handles",
        "        // this indented note mentions rc::Weak in passing",
    ] {
        assert!(
            offending_lines(benign).is_empty(),
            "the scan fired on a comment, which would make it unkeepable: {benign:?}"
        );
    }
}

#[test]
fn no_weak_handle_to_a_term_is_ever_created() {
    let src_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut hits = Vec::new();
    walk(&src_root, &mut hits);
    assert!(
        hits.is_empty(),
        "a weak handle now exists under `redextape-core/src`, and `LambdaTerm`'s hand-written \
         `Drop` assumes none does. `Rc::get_mut` returns `None` while a weak handle to the same \
         allocation is alive, so that destructor silently degenerates to the compiler's recursive \
         drop glue and a deep term overflows the stack on teardown — the exact failure it was \
         written to prevent. If the new handle genuinely cannot point at a term's allocation, this \
         gate's own doc explains why it bans the whole crate anyway and what narrowing it would \
         cost. Sites:\n{}",
        hits.join("\n")
    );
}
```

- [ ] **Step 2: Run the gate against the tree unchanged**

Run: `cargo nextest run -p redextape-core -E 'binary(no_weak_handles)'`
Expected: `2 tests run: 2 passed, 0 skipped`.

If `no_weak_handle_to_a_term_is_ever_created` fails here, **stop and report** — that means a weak handle already exists and the destructor is already degenerate, which is a Critical rather than a cleanup.

- [ ] **Step 3: Prove the gate can fail (sabotage 1 of 2)**

Append to any file under `crates/redextape-core/src`, e.g. at the end of `src/lambda/term.rs`:

```rust
#[allow(dead_code)]
fn planted_sabotage(t: &LambdaTerm) -> std::rc::Weak<Node> {
    Rc::downgrade(&t.0)
}
```

Run: `cargo nextest run -p redextape-core -E 'binary(no_weak_handles)'`
Expected: FAIL, `no_weak_handle_to_a_term_is_ever_created`, the message naming `term.rs` and the line.

Record the exact failure line for the roadmap entry, then **revert the sabotage** (`git checkout -- crates/redextape-core/src/lambda/term.rs`) and re-run to confirm 2 passed.

- [ ] **Step 4: Add the `debug_assert` to the destructor**

In `crates/redextape-core/src/lambda/term.rs`, replace this:

```rust
        // Unlink the root's children so the drop glue that runs after this function returns has
        // nothing to descend into. `get_mut` is `Some`: the strong count is 1 (checked above) and no
        // `Weak` handle to a term is ever created.
        if let Some(root) = Rc::get_mut(&mut self.0) {
```

with this:

```rust
        // Unlink the root's children so the drop glue that runs after this function returns has
        // nothing to descend into. `get_mut` is `Some`: the strong count is 1 (checked above) and no
        // weak handle to a term is ever created — which `tests/no_weak_handles.rs` enforces rather
        // than asserting in prose, and which this `debug_assert` catches at the moment of failure
        // for anything that gate's four named routes let through.
        //
        // BOUND TO A LOCAL FIRST, RATHER THAN ASSERTED INSIDE THE `if let`. `debug_assert!(false)`
        // in an `else` arm is `clippy::assertions_on_constants`, which `pedantic` warns on and this
        // workspace forbids `#[allow]`ing.
        //
        // THE MESSAGE BELOW SAYS "a weak handle" IN LOWERCASE PROSE AND MUST NOT NAME ANY BANNED
        // SPELLING: its continuation lines are ordinary code lines, and that gate scans code lines
        // INCLUDING STRING LITERALS, so rewording this panic in the vocabulary it is about would
        // make the gate fire on the prose explaining it. Comment lines like this one are skipped
        // and are the safe place to be specific. The same rule is why that gate walks `src` rather
        // than the whole crate: its own needle list would be its first hit.
        let root = Rc::get_mut(&mut self.0);
        debug_assert!(
            root.is_some(),
            "a weak handle to this term's allocation exists, so this destructor has degenerated to \
             the compiler's recursive drop glue: a deep term overflows the stack on teardown, which \
             is the one outcome this impl exists to prevent. See tests/no_weak_handles.rs."
        );
        if let Some(root) = root {
```

- [ ] **Step 5: Confirm the crate still builds clean**

Run: `cargo clippy -p redextape-core --all-targets -- -D warnings`
Expected: exit 0, no output.

If `clippy` objects to the `let`-then-`debug_assert` shape, adapt the code — **do not** add an `#[allow]`; the workspace forbids it.

- [ ] **Step 6: Run the λ drop tests**

Run: `cargo nextest run -p redextape-core -E 'test(dropping_deep_lambda)'`
Expected: `4 tests run: 4 passed, 0 skipped`.

- [ ] **Step 7: Run the full crate suite**

Run: `cargo nextest run -p redextape-core`
Expected: all pass. Record the total, which is the baseline Task 3 will move.

- [ ] **Step 8: Confirm the gate's message does not trip the citation gate**

Run: `pre-commit run check-citations --all-files`
Expected: Passed.

The gate builds its message with `format!("{} line {line_no}: …")` rather than `{}:{line_no}` for exactly this reason — a `path.rs:123` literal in tracked source is what `check-citations` refuses. If it objects anyway, reshape the message; do not exempt the file.

- [ ] **Step 9: Prove the `debug_assert` fires (sabotage 2 of 2)**

Temporarily add to `term.rs`'s `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn planted_sabotage_the_debug_assert_fires() {
        let t = abs("x", var(0));
        let _keep = Rc::downgrade(&t.0);
        drop(t);
    }
```

Run: `cargo nextest run -p redextape-core -E 'test(planted_sabotage)'`
Expected: FAIL with the panic message from Step 4 — the `debug_assert` fires because the live weak handle makes `get_mut` return `None`.

Record the panic text for the roadmap entry, then **revert** and confirm `cargo nextest run -p redextape-core -E 'binary(no_weak_handles)'` reads 2 passed and `git status --porcelain` is empty apart from the two intended files.

- [ ] **Step 10: Commit**

```bash
git add crates/redextape-core/src/lambda/term.rs crates/redextape-core/tests/no_weak_handles.rs
git commit -m "The Drop impl's silently empty else-branch gets a trap and the grep behind it gets a gate"
```

---

## Task 2: Re-export `Node` from `lambda`

Closes the roadmap bullet *"STILL OPEN — `lambda.rs:16` re-exports `Dir`, `LambdaTerm` and `Path` but not `Node`, so every consumer that matches on a term needs two imports."*

**Files:**
- Modify: `crates/redextape-core/src/lambda.rs` (the `pub use term::{…}` line)
- Modify: `crates/redextape-core/src/viewmodel.rs` (lines 20–21)
- Modify: `crates/redextape-core/tests/lambda_sharing.rs` (lines 23–24)
- Modify: `crates/redextape-core/examples/none_probe.rs` (lines 45–46)
- Modify: `crates/redextape-core/tests/viewmodel_contract.rs` (`fn walk`'s two `use` lines)

**Interfaces:**
- Consumes: nothing.
- Produces: `redextape_core::lambda::Node` becomes a public path. Purely additive — `lambda::term::Node` keeps working, so nothing breaks.

### The churn is bounded, and measuring is what bounds it

Twenty-odd sites import `Node`, but most spell it inside a combined import that also pulls `abs`, `app`, `var`, `shift` or `logical_size` — **none of which `lambda.rs` re-exports**. Collapsing those would turn one `use` line into two and make the papercut worse. Only sites importing a *bare* `Node` alongside a separate `lambda::…` import it can merge INTO get shorter, and that sibling counts whether it is braced (`lambda::{…}`) or a bare single-item `use` — the second form is the one an earlier pass overlooked. **There are four.** Change exactly those. Step 3 below lists three of them and then the fourth.

- [ ] **Step 1: Add the re-export**

In `crates/redextape-core/src/lambda.rs`, change:

```rust
pub use term::{Dir, LambdaTerm, Path};
```

to:

```rust
pub use term::{Dir, LambdaTerm, Node, Path};
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check -p redextape-core`
Expected: exit 0.

- [ ] **Step 3: Collapse the four sites that get shorter**

`crates/redextape-core/src/viewmodel.rs`, replace lines 20–21:

```rust
use crate::lambda::term::Node;
use crate::lambda::{Cut, LambdaTerm, Path, print_lambda_linked};
```

with:

```rust
use crate::lambda::{Cut, LambdaTerm, Node, Path, print_lambda_linked};
```

`crates/redextape-core/tests/lambda_sharing.rs`, replace lines 23–24:

```rust
use redextape_core::lambda::term::Node;
use redextape_core::lambda::{LambdaTerm, MAX_REDUCTION_STEPS, lower, reduce_trace};
```

with:

```rust
use redextape_core::lambda::{LambdaTerm, MAX_REDUCTION_STEPS, Node, lower, reduce_trace};
```

`crates/redextape-core/examples/none_probe.rs`, replace lines 45–46:

```rust
use redextape_core::lambda::term::Node;
use redextape_core::lambda::{self, LambdaTerm, MAX_REDUCTION_STEPS};
```

with:

```rust
use redextape_core::lambda::{self, LambdaTerm, MAX_REDUCTION_STEPS, Node};
```

The fourth site is `fn walk` in `tests/viewmodel_contract.rs`, which has a bare `use redextape_core::lambda::term::Node;` next to a bare `use redextape_core::lambda::Dir;`; those two collapse into one `use redextape_core::lambda::{Dir, Node};` line the same way the three above do. It was originally filed in the "leave alone" set because the reasoning only checked for an already-braced `lambda::{…}` sibling to merge into and never considered a bare single-item `use` as a mergeable sibling — the miss that commit `42c985c` corrected and that the rationale above now states once. Leave every other `lambda::term::` import alone. `tests/viewmodel_contract.rs`'s `fn arena_matches_term` has no sibling `lambda::` import at all, so it stays as-is. `src/lambda/lower.rs`'s `mod tests` is different again: its siblings `use crate::lambda::decode::decode;` and `use crate::lambda::reduce::{MAX_REDUCTION_STEPS, reduce_to_normal_form};` name symbols also re-exported from `lambda`, so all three lines there could technically merge into one too -- but doing so is general import tidying unrelated to `Node`'s absence, which is the only defect this task fixes, so that site is deliberately left alone rather than overlooked.

- [ ] **Step 4: Verify the whole workspace still compiles, examples included**

Run: `cargo clippy -p redextape-core --all-targets --examples -- -D warnings`
Expected: exit 0, no output. `rustfmt` orders `use` braces case-sensitively with uppercase first, so `MAX_REDUCTION_STEPS, Node, lower` is the sorted order — run `cargo fmt` and let it settle any disagreement.

- [ ] **Step 5: Measure the result**

Run: `grep -rn 'lambda::term::Node' crates/redextape-core | wc -l`
Expected: `2` — the two sites deliberately left alone, both `#[cfg(test)]`-scoped: `tests/viewmodel_contract.rs`'s `fn arena_matches_term` (no sibling `lambda::` import to merge into) and `src/lambda/lower.rs`'s `mod tests` (left alone as general import tidying, per Step 3). The framing for the roadmap entry is **6 → 2**: six sites named `lambda::term::Node` before this task, the four of Step 3 collapse, and those two stay by decision rather than by oversight. Record the figure and the "was 6" baseline.

- [ ] **Step 6: Run the affected suites**

Run: `cargo nextest run -p redextape-core`
Expected: the same total as Task 1 Step 7, all passing.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/lambda.rs crates/redextape-core/src/viewmodel.rs crates/redextape-core/tests/lambda_sharing.rs crates/redextape-core/examples/none_probe.rs crates/redextape-core/tests/viewmodel_contract.rs
git commit -m "lambda re-exports Node, and the three imports that actually get shorter are the three that change"
```

That subject line is quoted as it actually landed (`bd3e211`), before the fourth site was found; the count it names is the one commit `42c985c` corrected. It is left as-is because it is git history, not a claim this document is making — every count the document itself asserts says four.

---

## Task 3: Strengthen the across-step sharing assertion

Closes the roadmap bullet *"STILL OPEN — the across-step sharing assertion in `term.rs`'s `a_real_multi_step_reduction_still_shares_allocations_across_steps` is weaker than its message."*

The test's message claims *"every step whose redex path passes through an `App` must inherit at least one allocation from its predecessor."* What it checks is that the before- and after-terms share **some** allocation anywhere. A regression that broke sharing at one `App` level while preserving it at another passes.

**Files:**
- Modify: `crates/redextape-core/src/lambda/term.rs` (the test at `a_real_multi_step_reduction_still_shares_allocations_across_steps`)

**Interfaces:**
- Consumes: `LambdaTerm::alloc_id() -> usize`, `LambdaTerm::node() -> &Node`, `Dir::{AppL, AppR, AbsBody}`, `reduce_trace`, all already in scope in that module.
- Produces: nothing.

### What replaces what

Reduction rewrites the redex and rebuilds the spine above it; every subterm hanging *off* that spine is carried by an `Rc` bump and keeps its allocation id. So at each `AppL`/`AppR` on the redex path there is a specific untouched sibling, and its id must be identical before and after. That is the claim the message makes, and it is checkable position by position.

- [ ] **Step 1: Replace the assertion**

In `crates/redextape-core/src/lambda/term.rs`, inside `a_real_multi_step_reduction_still_shares_allocations_across_steps`, delete the `alloc_ids` helper and the `inheriting_steps` counting loop, and write the test as:

```rust
    #[test]
    fn a_real_multi_step_reduction_still_shares_allocations_across_steps() {
        use crate::lambda::encode::{church, plus};
        use crate::lambda::reduce::{MAX_REDUCTION_STEPS, reduce_trace};

        /// The allocation id of the UNTOUCHED SIBLING at every `App` branch on `path`, paired with
        /// that branch's index so a mismatch names the level rather than just the count. Walking
        /// `path` is valid in the after-term as well as the before-term: reduction rebuilds the
        /// spine above the redex and leaves its shape intact, so the same directions reach the same
        /// positions in both.
        ///
        /// `side` is in the panic because that claim is exactly what a panic from the after-term
        /// walk falsifies, and the two calls sit inside one `assert_eq!`. Without the label the
        /// reader is told a path step disagreed with a node shape but not which of the two terms
        /// was being walked — which is the whole difference between a mis-stated path and
        /// reduction having reshaped the spine.
        fn sibling_ids_along(t: &LambdaTerm, path: &[Dir], side: &'static str) -> Vec<(usize, usize)> {
            let mut cur = t;
            let mut out = Vec::new();
            for (i, d) in path.iter().enumerate() {
                cur = match (cur.node(), d) {
                    (Node::Abs(_, b), Dir::AbsBody) => b,
                    (Node::App(f, a, _), Dir::AppL) => {
                        out.push((i, a.alloc_id()));
                        f
                    }
                    (Node::App(f, a, _), Dir::AppR) => {
                        out.push((i, f.alloc_id()));
                        a
                    }
                    (node, dir) => {
                        panic!("in the {side} term, redex path step {i} is {dir:?} but the term is {node:?}")
                    }
                };
            }
            out
        }

        let t = app(app(plus(), church(2)), church(3));
        let trace = reduce_trace(&t, MAX_REDUCTION_STEPS);
        assert!(trace.steps.len() > 1, "a multi-step reduction is the whole point of this test");

        let mut app_branching_steps = 0usize;
        for (i, step) in trace.steps.iter().enumerate() {
            if !step.redex.iter().any(|d| matches!(d, Dir::AppL | Dir::AppR)) {
                continue; // no App branch on the path to this redex, so no sibling exists to inherit
            }
            app_branching_steps += 1;
            let after = trace.steps.get(i + 1).map_or(&trace.normal_form, |s| &s.term);
            assert_eq!(
                sibling_ids_along(&step.term, &step.redex, "before"),
                sibling_ids_along(after, &step.redex, "after"),
                "step {i}: the untouched sibling at every App branch on the redex path must survive \
                 the step as the SAME allocation. Each pair is (branch index along the redex path, \
                 allocation id); a disagreement names the level that stopped being shared. This is \
                 what makes `==` take the `ptr_eq` path, and checking the specific sibling at every \
                 level is what the previous form of this assertion did not do — it accepted any one \
                 surviving allocation anywhere in the term."
            );
        }
        assert!(app_branching_steps > 0, "expected at least one step whose redex path branches through an App");
    }
```

- [ ] **Step 2: Run it**

Run: `cargo nextest run -p redextape-core -E 'test(a_real_multi_step_reduction_still_shares_allocations_across_steps)'`
Expected: `1 test run: 1 passed`.

**If it FAILS, that is the finding and it is not to be smoothed away.** It would mean sibling identity does not in fact hold at every `App` branch on this corpus — β-fusion rewriting more than the spine is the named suspect. In that case: stop, capture the failing pair and the step index, and report it. Do not weaken the assertion back to make it green.

- [ ] **Step 3: Prove the new assertion is strictly stronger (sabotage)**

Find the site where the reducer rebuilds the spine and carries the untouched sibling by an `Rc` bump — `crates/redextape-core/src/lambda/reduce.rs` and `crates/redextape-core/src/trace/zipper.rs` are where the rebuild lives, `app_tagged_for_rebuild` is the constructor both use. Replace that carry with a fresh allocation **for one branch direction only** (e.g. rebuild the sibling structurally when the direction is `AppR`, leave `AppL` sharing untouched).

Run: `cargo nextest run -p redextape-core -E 'test(a_real_multi_step_reduction_still_shares_allocations_across_steps)'`
Expected: FAIL, the message naming the branch index whose id changed.

Then restore the old assertion body temporarily alongside the sabotage and confirm the **old** form passes under it — that contrast is the whole claim of this task and the roadmap entry must quote both halves.

Revert the sabotage. Run `git status --porcelain` and confirm only `term.rs` is modified.

**If no such sabotage can be constructed**, that is itself the finding: record why in the roadmap entry and do not claim the assertion is stronger than it was.

- [ ] **Step 4: Run the full crate suite**

Run: `cargo nextest run -p redextape-core`
Expected: the same total as Task 2 Step 6, all passing.

- [ ] **Step 5: Clippy**

Run: `cargo clippy -p redextape-core --all-targets -- -D warnings`
Expected: exit 0. `panic!` inside a `#[cfg(test)]` module is exempted by `clippy.toml`; read that file before changing the shape if it objects.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/lambda/term.rs
git commit -m "The sharing assertion checks the sibling its message names, not any surviving allocation"
```

---

## Task 4: The doc-density comparison, measured in both directions

Closes the roadmap bullet *"STILL OPEN, cosmetic — doc-comment density on `lib.rs`'s new `App` drop-test trio diverges from the `LetRecGroup` pair it invokes as its model."*

**Files:**
- Modify: `crates/redextape-core/src/lib.rs`

**Interfaces:**
- Consumes: nothing. Produces: nothing. Documentation only.

### This finding was filed pointing the wrong way, and the task is to confirm that before acting

The bullet reads as *"the trio is over-documented relative to the pair; trim it."* Reading both says the opposite:

- The `LetRecGroup` pair states the shared "why two chains" reason once, on `dropping_deep_letrecgroup_chain_through_body_does_not_overflow`. Its twin, `dropping_deep_letrecgroup_chain_through_a_binding_value_does_not_overflow`, carries **no doc comment at all**.
- The λ pair splits genuinely different content across its two members. `dropping_deep_lambda_app_chain_does_not_overflow` names the device; `dropping_deep_lambda_app_chain_through_the_argument_does_not_overflow` carries the falsifiability argument *and its evidence* — *"a destructor that unlinked `f` and forgot `a` would leave `a` to the compiler's recursive drop glue — which is O(1) when `a` is always `var(1)`, so the left-nested test PASSES with that half broken. Verified by sabotage, not reasoned about."*

Trimming the λ pair to match would delete a sabotage record to satisfy a symmetry argument. The two shapes should agree; the λ shape is the better one.

- [ ] **Step 1: Confirm the reading before changing anything**

Read `crates/redextape-core/src/lib.rs` from the doc above `dropping_deep_letrecgroup_chain_through_body_does_not_overflow` through the end of `dropping_deep_lambda_shared_child_chain_does_not_overflow`.

Confirm both facts: the `LetRecGroup` twin has no doc comment, and the λ right-nested twin's doc contains content its sibling's does not. **If either is false, stop and report** — the plan's direction depends on both.

- [ ] **Step 2: Level up the under-documented twin**

Add a doc comment to `dropping_deep_letrecgroup_chain_through_a_binding_value_does_not_overflow`, immediately above its `#[test]`:

```rust
    /// The binding-value half of the pair: bindings deep, `body` shallow. Its twin above carries
    /// the shared reason for building two chains rather than one; this one is what makes a
    /// forgotten bindings-vec drain falsifiable. Verified by sabotage, not reasoned about: deleting
    /// the bindings drain from `take_core_children`'s `LetRecGroup` arm aborts THIS test alone with
    /// a stack overflow while the twin still passes, and deleting the `body` unlink instead aborts
    /// the TWIN alone while this one still passes.
```

- [ ] **Step 3: Record the direction in the λ pair**

Append one sentence to `dropping_deep_lambda_app_chain_does_not_overflow`'s doc, after the sentence naming the `LetRecGroup` pair as its model:

```rust
    /// The model was the weaker of the two when this was written: that pair left its second member
    /// undocumented entirely. It carries a doc now, and this pair is why.
```

- [ ] **Step 4: Verify the tests still compile and run**

Run: `cargo nextest run -p redextape-core -E 'test(dropping_deep)'`
Expected: `9 tests run: 9 passed, 0 skipped`.

- [ ] **Step 5: Fmt and clippy**

Run: `cargo fmt --check && cargo clippy -p redextape-core --all-targets -- -D warnings`
Expected: exit 0 for both.

- [ ] **Step 6: Confirm the shared-doc-region gate is unaffected**

Run: `pre-commit run --all-files`
Expected: every hook Passed. `shared doc regions match their source` is the one to watch — these doc comments are not in a shared region today, and this task must not put them in one.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/lib.rs
git commit -m "The drop-test pair filed as over-documented was the model, and the pair it was measured against was the one missing a doc"
```

---

## Task 5: Correct the roadmap and write the closing entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**Interfaces:**
- Consumes: every figure and sabotage transcript recorded in Tasks 1–4.
- Produces: the entry the PR body summarises.

### Two edits in place plus one new entry

- [ ] **Step 1: Correct B's count in place**

Find the paragraph beginning `**STILL OPEN — five `unreachable!` on library paths.**`. It names five sites: two in `tm/encoding/binary.rs`, two in `tm/encoding/unary.rs`, one in `tm/lower_asm.rs`. Measurement at this branch's base finds **eight**. Rewrite the paragraph to:

- state eight, not five;
- name the three the list never learned about — `trace/zipper.rs`'s two seek-invariant sites in `reduce_here` (`"the seek invariant guarantees an Abs focus"` and `"the seek invariant guarantees an AppL top frame"`), and `lambda/term.rs`'s `shift` bound (`"shift bound already checked above"`), which is already documented in place at its own site and in `Cargo.toml`'s `[workspace.lints.clippy]` comment;
- say *why* the list drifted: it has no gate, unlike the four grammar READMEs, and three later slices added sites without touching it;
- keep the standing verdict unchanged — removing them still means changing the types so the impossible arm cannot be written, still a design change, still not taken here.

Cite by **symbol and file**, not `file:line`. `docs/` is out of the citation gate's scope, but the roadmap has 37-of-57 history with rotting line numbers.

- [ ] **Step 2: Mark the four closed bullets**

Strike through and annotate, in the same style the file already uses for closed items:

- The `Rc::get_mut` empty-else bullet under *"Minor findings from the λ structural-sharing review"* → closed by Task 1, naming both the `debug_assert` and `tests/no_weak_handles.rs`.
- The `lambda.rs:16` / `Node` re-export bullet → closed by Task 2, with the measured before/after count.
- The across-step sharing assertion bullet → closed by Task 3, with the sabotage contrast.
- The doc-comment density bullet → closed by Task 4, **and recording that it was filed pointing the wrong way**: the pair it named as the model was the one missing a doc.

- [ ] **Step 3: Write the closing entry**

Append a `####` section at the end of the file, following the shape every recent entry uses. It must carry:

- what shipped, in one paragraph per task;
- **the `unreachable!` drift as the branch's transferable lesson** — a list of instances with no gate grows stale silently, which is the same failure mode the a11y standing list names about itself, and this is the second list in this file measured against the tree and found wrong;
- **F's inverted filing** — a cosmetic finding that survived a month because nobody re-read the thing it was measured against;
- a `##### WHAT STAYS OPEN` list: the third direct-then-defunc copy (`tm.rs`'s `lower_program`, `sourcemap.rs`, `tm/attribute.rs`'s `lower_mapped`); the eight `unreachable!` and their unchanged verdict; the no-`Weak` gate's four named routes; and that the gate's ban is wider than the invariant;
- a `##### VERIFICATION` block, every figure naming the command that produced it, all re-run at the branch head rather than carried from a task report, and each captured into a freshly-named file (this shell refuses `>` onto an existing path).

Figures the block must carry, each with its command:

```
<n>   commits                          git rev-list --count 65e8fac..<branch head>
<n>   files, +x/-y whole-branch diff    git diff --shortstat 65e8fac..<branch head>
2     lambda::term::Node imports left   grep -rn 'lambda::term::Node' crates/redextape-core | wc -l
0     weak handles under src            cargo nextest run -p redextape-core -E 'binary(no_weak_handles)'
```

**TWO ROWS OF THAT TABLE WERE WRONG AS FIRST WRITTEN, AND CORRECTING THEM IN PLACE RATHER THAN QUIETLY IS THE POINT.** The `Node` row said **3**; the tree reads **2**, because this plan's own Task 2 rationale undercounted the sites that shorten — see the correction in Task 2 Step 3 above. The `unreachable!` row said **8** and prescribed a command that prints **17**, because that command's filter strips `//` only at column one; the whole-branch review then measured **9**. The row is deleted rather than corrected to 9: the repository's owner settled it by dropping the count and stating the property instead, so there is no figure left for this table to carry. The base SHA in the first two rows was also written `65eded...`, which is not a commit in this repository.
Plus the two sabotage transcripts from Task 1 (gate fires; `debug_assert` fires), the Task 3 contrast (old assertion passes under the sabotage, new one fails), and `pre-commit run --all-files` with every hook named.

**No CI paragraph** — no PR exists at the time this entry is written, and this file's convention forbids quoting a run that has not happened.

- [ ] **Step 4: Verify the roadmap edit passes the gates**

Run: `pre-commit run --all-files`
Expected: every hook Passed, including `documented figures match the tree`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "The four minor findings close, and the count of unreachable sites the list has carried since July is off by three"
```

- [ ] **Step 6: Full gate before the PR**

Run: `scripts/check-all.sh`
Expected: exit 0. If any tier is skipped, quote its own closing line rather than calling the run green.

- [ ] **Step 7: Open the PR**

Branch name: `minor-findings-cleanup`. PR body paragraphs are **one long line each**. Body cites the design decisions made in-session (no spec document was written — both forks were settled before the plan) and the roadmap entry.

---

## Self-Review

**Spec coverage.** Task 1 → finding C, both halves the design named (runtime trap and the gate), plus the sabotage conflict the design flagged. Task 2 → finding D. Task 3 → finding E, including the mandatory sabotage and the named β-fusion risk. Task 4 → finding F, in the direction measurement supports. Task 5 → the B re-file and the roadmap entry. Finding A (the third direct-then-defunc copy) is out of scope by decision and appears only under WHAT STAYS OPEN, as designed.

**Type consistency.** `offending_lines(&str) -> Vec<(usize, String)>` is defined in Task 1 Step 1 and used only there. `sibling_ids_along(&LambdaTerm, &[Dir], &'static str) -> Vec<(usize, usize)>` is defined and used inside one test in Task 3; the `&'static str` is the "before"/"after" label the panic interpolates. `Dir::{AppL, AppR, AbsBody}` matches the enum as declared in `term.rs`. `Node::{Var, Abs, App}` matches the arms the existing `Drop` impl already destructures.

**Known risks, each with a stated stop condition.** Task 1 Step 2 stops if a weak handle already exists. Task 3 Step 2 stops rather than weakening if sibling identity does not hold. Task 3 Step 3 records the outcome rather than claiming strength if no sabotage can be built. Task 4 Step 1 stops if either fact behind the inverted filing is false.
