# `.tm` Parse Linear Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find a duplicate `state` name and a duplicate header `tape` line in one lookup each, so parsing a `.tm` file takes time linear in its `state` and `tape` lines, with every diagnostic, span, diagnostic order and navigation definition unchanged.

**Architecture:** Two scans become `HashSet` lookups: `parse_tm_nav` checking each `state` line's name against every earlier state, and `HeaderParts::directive` checking each `tape` line's index against every earlier one. The order of the tasks is the test-first order:
1. tests pinning the whole diagnostic list for both duplicate cases, which pass against today's parser;
2. two slow-tier ratio tests, which fail against today's parser;
3. the state-name set, which turns the first ratio test green;
4. the tape-index set, which turns the second green.

**Tech Stack:** Rust (`redextape-core`), cargo-nextest for the fast tier, `cargo test --release` for the slow tier, the repository's pre-commit gates.

**Spec:** `docs/superpowers/specs/2026-09-14-tm-parse-linear-design.md`, committed at `1f0d3e1`. Anything this plan found the spec got wrong is under *Spec corrections found while planning*; the spec itself is unchanged.

## Global Constraints

- **Nothing observable changes.** Every diagnostic keeps its message, span and position in the list; every navigation definition and parse result stays the same.
- **Files:** `crates/redextape-core/src/tm/syntax.rs`, `crates/redextape-core/src/tm/header.rs`, and the new `crates/redextape-core/tests/tm_parse_scaling.rs`. Nothing else.
- **Ratio tests:** files of 16,000 and 64,000 lines, the fastest of 3 parses of each, bound `8.0`, `#[ignore]`, run in `--release`.
- **Build location:** work in the `tm-parse-linear` worktree, and put `CARGO_TARGET_DIR="$P/target"` on every cargo command and on every `git commit`, because the pre-commit hook runs cargo. Never build into the main checkout's `target/`, and never into `/tmp`.
- **Memory cap:** every `--release` run, suite run and sabotage run goes under `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 --`.
- **Hooks:** never `git commit --no-verify`. Tracked source may not cite `file:line`; name symbols instead.
- **Staging:** stage files by name, never with `git add -A`.
- No AI or Claude attribution anywhere: code, comments or commit messages.
- The roadmap entry is not part of this plan.
- **Timings are one machine's.** A ratio, not an absolute time, is what the tests assert; the absolute times below show the scale and nothing more.

## How this plan's code was verified

Every task's end state was built in the scratch worktree `.claude/worktrees/tm-parse-scratch`, on branch `tm-parse-scratch`, started from `1f0d3e1`. Each was committed there through the unmodified pre-commit hooks before this plan was written, and nothing in this plan's verification used `--no-verify`.

| task | scratch commit |
| --- | --- |
| 1 | `eb07b13` Pin every diagnostic a duplicate state or tape line produces |
| 2 | `d77b6aa` Time .tm parsing against four times the state and tape lines |
| 3 | `350651e` Find a duplicate state name in one lookup, not a scan of every state |
| 4 | `734fdcf` Find a duplicate tape line in one lookup, not a scan of every tape line |

**Each task's code below is that commit's `git show --format=` output, embedded verbatim. Apply it; do not retype it.** Each block, expected stat and commit message was compared byte for byte with its commit. The four blocks were also extracted from this file with `block_of` and applied in order, staged and never committed, to a detached `1f0d3e1` in a throwaway worktree; after each one, `git diff --cached --quiet <that task's commit>` succeeded.

**This plan's steps are red-then-green,** because the code was built in that order:
- Task 1's pins PASS on today's parser. That is their job: they record what it does now.
- Task 2's ratio tests FAIL on today's parser, and the step says so with the ratios measured.
- Task 3 turns the state-line ratio test green and leaves the `tape`-line one red; Task 4 turns that one green.

**Baseline:** `cargo nextest run -p redextape-core` at `1f0d3e1` gave `1131 tests run: 1131 passed, 14 skipped`. `1f0d3e1`'s code is `78ebea6`'s: `git diff --stat 78ebea6 1f0d3e1` lists only the spec.

Every embedded file sits between a `<!-- BEGIN name -->` line and an `<!-- END name -->` line. Set these once per shell before any task:

```bash
P=/home/davey/projects/redextape/.claude/worktrees/tm-parse-linear
PLAN="$P/docs/superpowers/plans/2026-09-14-tm-parse-linear.md"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
```

---

### Task 1: Pin every diagnostic a duplicate produces

**Files:**
- Modify: `crates/redextape-core/src/tm/syntax.rs` — two tests in `mod tests`, right after `a_duplicate_state_line_records_both_definitions`

**What the two tests pin, and why before any fix.** The existing tests hold only that a duplicate produces some diagnostic mentioning `duplicate`. These pin the whole list — every message, span and their order — so a fix that moves the duplicate diagnostic, changes its span, or drops a neighbour goes red.
- `a_duplicate_state_line_keeps_every_diagnostic_in_place`: the second `state s` line also carries `: acceptx`, which the parser reports BEFORE it checks the name, and a later `bogus` line is reported after. It also pins both navigation definitions, `(22, 23)` and `(68, 69)`, because the duplicate line still records its own.
- `a_duplicate_tape_line_keeps_every_diagnostic_in_place`: two `tape 0` lines, then a second `width` line, so the duplicate `tape` diagnostic has a neighbour after it.

Both pass against today's parser. That is correct: they are what Tasks 3 and 4 are held to.

**Interfaces:**
- Consumes (all existing): `parse_tm_nav(src: &str) -> (TmDocument, NameIndex)`, `parse_tm_full(src: &str) -> TmDocument`, `crate::diagnostic::Severity` (already imported by `syntax.rs`, reached through `use super::*`), `NameIndex::definitions`.
- Produces: the two test functions above. Nothing else depends on them by name.

- [ ] **Step 1: Confirm no code has changed yet**

```bash
git -C "$P" diff --quiet HEAD -- crates/ && git -C "$P" diff --cached --quiet -- crates/ && echo clean
```

Expected: `clean`

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task1.patch | git -C "$P" apply --index --check && block_of task1.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/tm/syntax.rs | 40 ++++++++++++++++++++++++++++++++++
 1 file changed, 40 insertions(+)
```

<!-- BEGIN task1.patch -->
````diff
diff --git a/crates/redextape-core/src/tm/syntax.rs b/crates/redextape-core/src/tm/syntax.rs
index 4aa74d3..b24c87e 100644
--- a/crates/redextape-core/src/tm/syntax.rs
+++ b/crates/redextape-core/src/tm/syntax.rs
@@ -1404,6 +1404,46 @@ state s: accept
         }
     }
 
+    /// Everything a duplicated `state` line does to the diagnostics, not just that one mentions
+    /// `duplicate`: every message, every span, and their order. The duplicate line here also carries
+    /// an error the parser reports before it checks the name, and a later line carries one after, so a
+    /// duplicate diagnostic moved earlier or later in the list shows up. The navigation definitions are
+    /// pinned too, since the duplicate line still records its own.
+    #[test]
+    fn a_duplicate_state_line_keeps_every_diagnostic_in_place() {
+        let src = "tapes 1\nstart s\nstate s:\n  [*] -> write [*], move [S], goto s\nstate s: acceptx\n  [*] -> \
+                   write [*], move [S], goto s\nbogus\n";
+        let (doc, nav) = parse_tm_nav(src);
+        let got: Vec<(&str, usize, usize)> =
+            doc.diagnostics.iter().map(|d| (d.message.as_str(), d.span.start, d.span.end)).collect();
+        assert_eq!(
+            got,
+            vec![
+                ("expected `:` or `: accept` after the state name", 62, 78),
+                ("duplicate state name `s`", 62, 78),
+                ("unrecognized line", 116, 121),
+            ]
+        );
+        assert!(doc.diagnostics.iter().all(|d| d.severity == Severity::Error));
+        assert!(doc.machine.is_none());
+        let defs: Vec<(usize, usize)> = nav.definitions().map(|o| (o.span.start, o.span.end)).collect();
+        assert_eq!(defs, vec![(22, 23), (68, 69)], "both `state s` lines, at their own name spans");
+    }
+
+    /// The same for a duplicated `tape` line: the whole diagnostic list, with a later header error so
+    /// the duplicate's position in the list is visible.
+    #[test]
+    fn a_duplicate_tape_line_keeps_every_diagnostic_in_place() {
+        let src = "tapes 1\nstart s\nencoding unary\nwidth 4\nslots 1\nresult Nat\ntape 0 #_#\ntape 0 #_#\nwidth 8\n\n\
+                   state s: accept\n";
+        let doc = parse_tm_full(src);
+        let got: Vec<(&str, usize, usize)> =
+            doc.diagnostics.iter().map(|d| (d.message.as_str(), d.span.start, d.span.end)).collect();
+        assert_eq!(got, vec![("duplicate `tape 0` directive", 69, 79), ("duplicate `width` directive", 80, 87)]);
+        assert!(doc.diagnostics.iter().all(|d| d.severity == Severity::Error));
+        assert!(doc.machine.is_none() && doc.header.is_none());
+    }
+
     #[test]
     fn a_duplicate_start_line_records_its_name_too() {
         // The two duplicate-line arms in `parse_tm_nav` took opposite decisions until this was
````
<!-- END task1.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0` with no diff printed; `clippy exit 0` with no warning.

- [ ] **Step 4: Run this task's tests**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo nextest run -p redextape-core --lib tm::syntax
```

Expected summary line: `45 tests run: 45 passed, 787 skipped`. Both new tests pass here, on the unfixed parser.

- [ ] **Step 5: Run the two text gates**

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 480 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `459 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Pin every diagnostic a duplicate state or tape line produces

The existing tests hold only that a duplicate state name or tape
directive produces some diagnostic mentioning "duplicate". These pin
the whole diagnostic list for each case - every message, span and
their order - and the navigation definitions a duplicate state line
still records, before the two duplicate checks change how they find a
repeated name.
EOF
```

Expected: every hook reports `Passed` or `Skipped`, `cargo fmt` and `cargo clippy` among the `Passed`.

---

### Task 2: The ratio tests, red against today's parser

**Files:**
- Create: `crates/redextape-core/tests/tm_parse_scaling.rs`

**What the file does.**
- `state_lines(n)` builds a one-tape machine of `n` accept states, `s0` to `s{n-1}`, which parses with no diagnostics.
- `tape_lines(n)` builds a one-state machine whose header carries `n` `tape` lines with indices 1 to `n`. Every index is out of range for `tapes 1`, so the parse yields exactly `n` diagnostics — which is how the test knows every line was read as a `tape` directive.
- `assert_linear` parses the 16,000-line and 64,000-line file of one family, the fastest of 3 each, checks each file's diagnostic count, prints the times and the ratio, and asserts the ratio is below `MAX_RATIO`, `8.0`.
- One test per family, so a regression in one scan reddens a test that measures that scan.

**Interfaces:**
- Consumes: `redextape_core::tm::parse_tm_full`.
- Produces: `parse_time_grows_linearly_with_state_lines` and `parse_time_grows_linearly_with_tape_lines`, both `#[ignore]`. Tasks 3 and 4 run them by that test target, `--test tm_parse_scaling`.

- [ ] **Step 1: Confirm Task 1 is the last commit and nothing else has changed**

```bash
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD -- crates/ && git -C "$P" diff --cached --quiet -- crates/ && echo clean
```

Expected: the Task 1 commit's subject, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task2.patch | git -C "$P" apply --index --check && block_of task2.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/tests/tm_parse_scaling.rs | 88 +++++++++++++++++++++++++
 1 file changed, 88 insertions(+)
```

<!-- BEGIN task2.patch -->
````diff
diff --git a/crates/redextape-core/tests/tm_parse_scaling.rs b/crates/redextape-core/tests/tm_parse_scaling.rs
new file mode 100644
index 0000000..5f5286f
--- /dev/null
+++ b/crates/redextape-core/tests/tm_parse_scaling.rs
@@ -0,0 +1,88 @@
+//! Parsing a `.tm` file takes time in proportion to its size, for the two line kinds whose duplicate
+//! checks once compared each line with every line of its kind before it: `state` lines and header
+//! `tape` lines.
+//!
+//! A timing test is only as good as its margin. Each test parses a file and one with four times the
+//! lines, and allows the larger 8x as long, where linear growth gives about 4x. Against the scans
+//! these tests replaced, the same files measured 23.08x for `state` lines and 17.17x for `tape` lines
+//! in a `--release` build when the tests were written.
+//!
+//! Slow tier: both tests are `#[ignore]`, and `scripts/check-slow.sh` runs them in `--release`.
+
+// Test target: a generated file that does not parse as generated is the failure these tests report, so
+// panicking is deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]`
+// functions and `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
+#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
+
+use std::fmt::Write as _;
+use std::time::{Duration, Instant};
+
+use redextape_core::tm::parse_tm_full;
+
+/// How much longer the file with four times the lines may take to parse.
+const MAX_RATIO: f64 = 8.0;
+/// Lines in the smaller file of each pair.
+const SMALL: usize = 16_000;
+/// Lines in the larger file of each pair: four times `SMALL`.
+const LARGE: usize = 64_000;
+
+/// The fastest of three parses of `src`, with the diagnostic count every parse of it produces.
+fn fastest_of_3(src: &str) -> (Duration, usize) {
+    let mut best = Duration::MAX;
+    let mut diagnostics = 0;
+    for _ in 0..3 {
+        let started = Instant::now();
+        let doc = parse_tm_full(src);
+        best = best.min(started.elapsed());
+        diagnostics = doc.diagnostics.len();
+    }
+    (best, diagnostics)
+}
+
+/// A one-tape machine of `n` accept states named `s0` to `s{n-1}`. It parses with no diagnostics.
+fn state_lines(n: usize) -> String {
+    let mut src = String::from("tapes 1\nstart s0\n");
+    for i in 0..n {
+        writeln!(src, "state s{i}: accept").unwrap();
+    }
+    src
+}
+
+/// A one-state machine whose header carries `n` `tape` lines, indices 1 to `n`. Every index is out of
+/// range for `tapes 1`, so the parse yields exactly one diagnostic per line, and that count shows every
+/// line was read as a `tape` directive.
+fn tape_lines(n: usize) -> String {
+    let mut src = String::from("tapes 1\nstart s\nencoding unary\nwidth 4\nslots 1\nresult Nat\n");
+    for i in 1..=n {
+        writeln!(src, "tape {i} _1").unwrap();
+    }
+    src.push_str("state s: accept\n");
+    src
+}
+
+/// Parse `small` and `large`, check each produced `diagnostics`, and hold the time ratio under `MAX_RATIO`.
+fn assert_linear(what: &str, small: &str, large: &str, diagnostics: (usize, usize)) {
+    let (small_time, small_diagnostics) = fastest_of_3(small);
+    let (large_time, large_diagnostics) = fastest_of_3(large);
+    assert_eq!((small_diagnostics, large_diagnostics), diagnostics, "{what}: a file did not parse as generated");
+    let ratio = large_time.as_secs_f64() / small_time.as_secs_f64();
+    println!(
+        "{what}: {SMALL} lines {small_time:.2?}, {LARGE} lines {large_time:.2?}, ratio {ratio:.2} (bound {MAX_RATIO})"
+    );
+    assert!(
+        ratio < MAX_RATIO,
+        "{what}: four times the lines took {ratio:.2}x as long ({small_time:?} -> {large_time:?})"
+    );
+}
+
+#[test]
+#[ignore = "slow tier: times real parses; run via scripts/check-slow.sh"]
+fn parse_time_grows_linearly_with_state_lines() {
+    assert_linear("state lines", &state_lines(SMALL), &state_lines(LARGE), (0, 0));
+}
+
+#[test]
+#[ignore = "slow tier: times real parses; run via scripts/check-slow.sh"]
+fn parse_time_grows_linearly_with_tape_lines() {
+    assert_linear("tape lines", &tape_lines(SMALL), &tape_lines(LARGE), (SMALL, LARGE));
+}
````
<!-- END task2.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0`, `clippy exit 0`, no warning.

- [ ] **Step 4: Run the ratio tests and watch both FAIL**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- \
  cargo test --release -p redextape-core --test tm_parse_scaling -- --ignored --nocapture --test-threads 1
```

Expected: `test result: FAILED. 0 passed; 2 failed`, each failure naming a ratio well above 8. Planning measured:
- `state lines: 16000 lines 109.54ms, 64000 lines 2.53s, ratio 23.08 (bound 8)`
- `tape lines: 16000 lines 48.72ms, 64000 lines 836.31ms, ratio 17.17 (bound 8)`

Any ratio above 8 on both is the expected result. A ratio below 8 on either means the test cannot see the scan it exists for: stop and report it.

- [ ] **Step 5: Run the two text gates**

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 480 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `460 files scanned, 0 violations`

- [ ] **Step 6: Commit**

The hooks run no `#[ignore]` test, so the failing ratio tests do not block this commit; the scratch commit went through the same way.

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Time .tm parsing against four times the state and tape lines

Two slow-tier tests parse generated files of 16,000 and 64,000 state
lines, and of 16,000 and 64,000 header tape lines, and hold the larger
file's parse under 8x the smaller's, where linear growth gives about
4x. Against today's duplicate checks, each of which compares a line
with every earlier line of its kind, they fail at 23.08x and 17.17x.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

---

### Task 3: A set of state names in `parse_tm_nav`

**Files:**
- Modify: `crates/redextape-core/src/tm/syntax.rs` — `parse_tm_nav` only

**What changes.**
1. A `state_names: HashSet<&str>` declared beside `states`. Its keys are slices of `src`, so nothing is copied.
2. The duplicate check reads `state_names.contains(name.as_str())` in place of `states.iter().any(|s| s.name == name)`.
3. The name enters the set right before `states.push`, AFTER the check and after the navigation definition, so the SECOND line to name a state is the one reported, exactly as before, and a duplicate line still records its definition and its `RawState`.

**Interfaces:**
- Consumes: nothing new.
- Produces: no new item; `parse_tm_nav`'s signature and output are unchanged, which Task 1's pins hold.

- [ ] **Step 1: Confirm Task 2 is the last commit and nothing else has changed**

```bash
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD -- crates/ && git -C "$P" diff --cached --quiet -- crates/ && echo clean
```

Expected: the Task 2 commit's subject, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task3.patch | git -C "$P" apply --index --check && block_of task3.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/tm/syntax.rs | 8 +++++++-
 1 file changed, 7 insertions(+), 1 deletion(-)
```

<!-- BEGIN task3.patch -->
````diff
diff --git a/crates/redextape-core/src/tm/syntax.rs b/crates/redextape-core/src/tm/syntax.rs
index b24c87e..f617cde 100644
--- a/crates/redextape-core/src/tm/syntax.rs
+++ b/crates/redextape-core/src/tm/syntax.rs
@@ -417,6 +417,10 @@ pub fn parse_tm_nav(src: &str) -> (TmDocument, NameIndex) {
     let mut tapes: Option<usize> = None;
     let mut start_name: Option<(String, Span)> = None;
     let mut states: Vec<RawState> = Vec::new();
+    // The name of every `state` line seen so far, as slices of `src`, so a duplicate is found in one
+    // lookup. Scanning `states` for it compared each line's name with every earlier one, which made
+    // parsing quadratic in the number of states.
+    let mut state_names: std::collections::HashSet<&str> = std::collections::HashSet::new();
     let mut header = HeaderParts::default();
     let mut comments: Vec<AnchoredComment<TmAnchor>> = Vec::new();
     // Own-line comments seen but not yet attached: they belong to the NEXT line that parses, which
@@ -543,7 +547,7 @@ pub fn parse_tm_nav(src: &str) -> (TmDocument, NameIndex) {
             if !accept && !tail.is_empty() {
                 diags.push(err(span, "expected `:` or `: accept` after the state name"));
             }
-            if states.iter().any(|s| s.name == name) {
+            if state_names.contains(name.as_str()) {
                 diags.push(err(span, format!("duplicate state name `{name}`")));
             }
             // Recorded even when this line also produced a `duplicate state name` diagnostic:
@@ -553,6 +557,8 @@ pub fn parse_tm_nav(src: &str) -> (TmDocument, NameIndex) {
                 let at = line_start + indent + "state ".len() + pad;
                 nav.push_definition(&name, Span { start: at, end: at + name.len() }, DefKind::State, None);
             }
+            // Entered only after the check above, so the line reported is the SECOND to name a state.
+            state_names.insert(name_part.trim());
             states.push(RawState { name, accept, rules: Vec::new() });
             #[allow(clippy::cast_possible_truncation)] // see the `ids` map below for why this is sound
             let id = (states.len() - 1) as StateId;
````
<!-- END task3.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0`, `clippy exit 0`, no warning.

- [ ] **Step 4: Run the parser tests; the pins must not move**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo nextest run -p redextape-core --lib tm::syntax
```

Expected summary line: `45 tests run: 45 passed, 787 skipped`, Task 1's two pins among them.

- [ ] **Step 5: Run the ratio tests: state lines green, `tape` lines still red**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- \
  cargo test --release -p redextape-core --test tm_parse_scaling -- --ignored --nocapture --test-threads 1
```

Expected: `test result: FAILED. 1 passed; 1 failed`, the failure being `parse_time_grows_linearly_with_tape_lines`. Planning measured:
- `state lines: 16000 lines 4.95ms, 64000 lines 19.57ms, ratio 3.95 (bound 8)`
- `tape lines: 16000 lines 48.10ms, 64000 lines 875.32ms, ratio 18.20 (bound 8)`

- [ ] **Step 6: Run the two text gates**

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 480 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `460 files scanned, 0 violations`

- [ ] **Step 7: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Find a duplicate state name in one lookup, not a scan of every state

parse_tm_nav compared each state line's name with every earlier
state's, so parsing was quadratic in state count. A set of the names
seen, filled after the check so the second line to name a state is the
one reported, finds a duplicate in one lookup. The pinned diagnostics
and navigation definitions are unchanged, and the state-line ratio
test passes at 3.95x.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

---

### Task 4: A set of `tape` indices in `HeaderParts`, and the finished-code checks

**Files:**
- Modify: `crates/redextape-core/src/tm/header.rs` — `HeaderParts` and `HeaderParts::directive`

**What changes.**
1. `HeaderParts` gains `tape_indices: HashSet<usize>`, the index of every entry in `tapes`. `HeaderParts` derives `Default`, and so does `HashSet`, so `HeaderParts::default()` needs no change.
2. The `tape` arm's duplicate guard reads `self.tape_indices.contains(&i)` in place of `self.tapes.iter().any(|(j, _, _)| *j == i)`.
3. An accepted `tape` line inserts its index before pushing to `tapes`. `tapes` keeps its order and contents, because `finish` and its range check read it.

**Interfaces:**
- Consumes: nothing new.
- Produces: no new item.

- [ ] **Step 1: Confirm Task 3 is the last commit and nothing else has changed**

```bash
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD -- crates/ && git -C "$P" diff --cached --quiet -- crates/ && echo clean
```

Expected: the Task 3 commit's subject, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task4.patch | git -C "$P" apply --index --check && block_of task4.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/tm/header.rs | 9 ++++++---
 1 file changed, 6 insertions(+), 3 deletions(-)
```

<!-- BEGIN task4.patch -->
````diff
diff --git a/crates/redextape-core/src/tm/header.rs b/crates/redextape-core/src/tm/header.rs
index 7f30216..87c454f 100644
--- a/crates/redextape-core/src/tm/header.rs
+++ b/crates/redextape-core/src/tm/header.rs
@@ -313,6 +313,10 @@ pub(crate) struct HeaderParts {
     /// instead of the whole file. The span is parse-time-only: `finish` strips it before handing the
     /// tapes to `TmHeader::new`, which never carries one (see that type's doc).
     tapes: Vec<(usize, Vec<Symbol>, Span)>,
+    /// The index of every entry in `tapes`, so a duplicate `tape` line is found in one lookup.
+    /// Scanning `tapes` for it compared each line's index with every earlier one, which made a header
+    /// of many `tape` lines quadratic to parse.
+    tape_indices: std::collections::HashSet<usize>,
     /// Whether any `tape` line was seen. Tracked separately from `tapes` because a `tape` line that
     /// FAILED to parse still means the file was trying to carry a header, and `finish` must not then
     /// report "no header".
@@ -416,10 +420,9 @@ impl HeaderParts {
                 };
                 Some(match idx.trim().parse::<usize>() {
                     Err(_) => Err(format!("expected `tape <index> <cells>`, found index `{idx}`")),
-                    Ok(i) if self.tapes.iter().any(|(j, _, _)| *j == i) => {
-                        Err(format!("duplicate `tape {i}` directive"))
-                    }
+                    Ok(i) if self.tape_indices.contains(&i) => Err(format!("duplicate `tape {i}` directive")),
                     Ok(i) => {
+                        self.tape_indices.insert(i);
                         self.tapes.push((i, parse_cells(cells), span));
                         Ok(())
                     }
````
<!-- END task4.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0`, `clippy exit 0`, no warning.

- [ ] **Step 4: Run the parser and header tests**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo nextest run -p redextape-core --lib tm::syntax tm::header
```

Expected summary line: `56 tests run: 56 passed, 776 skipped`.

- [ ] **Step 5: Run the ratio tests: both green**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- \
  cargo test --release -p redextape-core --test tm_parse_scaling -- --ignored --nocapture --test-threads 1
```

Expected: `test result: ok. 2 passed; 0 failed`. Planning measured, at this commit's tree:
- `state lines: 16000 lines 5.01ms, 64000 lines 19.85ms, ratio 3.96 (bound 8)`
- `tape lines: 16000 lines 2.75ms, 64000 lines 11.26ms, ratio 4.10 (bound 8)`

**The spread, and the threading `check-slow.sh` uses.** Five runs of this exact command at `734fdcf` gave state lines 3.86–4.78 and `tape` lines 4.08–4.21. `scripts/check-slow.sh` passes no `--test-threads`, so there the two tests run at the same time; five runs of the same command without `--test-threads 1` gave state lines 3.91–4.29 and `tape` lines 3.63–4.00. The bound is 8 either way.

- [ ] **Step 6: Run the two text gates**

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 480 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `460 files scanned, 0 violations`

- [ ] **Step 7: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Find a duplicate tape line in one lookup, not a scan of every tape line

HeaderParts::directive compared each tape line's index with every
earlier tape line's, so a header of many tape lines was quadratic to
parse. A set of the indices seen finds a duplicate in one lookup; the
pinned diagnostics are unchanged, and the tape-line ratio test passes
at 4.10x.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

- [ ] **Step 8: Run the full crate suite and the language server's**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-lsp
```

Expected summary lines:
- `redextape-core`: `1133 tests run: 1133 passed, 16 skipped` — the baseline's 1,131 and 14 plus Task 1's two pins and Task 2's two ignored tests.
- `redextape-lsp`: `70 tests run: 70 passed, 0 skipped`. It runs here because the language server reads every `.tm` file through `parse_tm_nav`; its own duplicate tests pin the duplicate `tapes` line error, which this plan does not touch.

- [ ] **Step 9: Run the sabotages, each on its own, restoring after each**

Each sabotage edits one tracked file with `perl`, runs one command, and is restored with `git checkout` before the next. Run them in this order and in one shell, so nothing else builds while a sabotage is applied. After each restore, `git -C "$P" diff --quiet -- crates/ && echo restored` must print `restored`.

**S1 — put the state-name scan back.**

```bash
perl -pi -e 's/if state_names\.contains\(name\.as_str\(\)\) \{/if states.iter().any(|s| s.name == name) {/' "$P/crates/redextape-core/src/tm/syntax.rs"
git -C "$P" diff --stat -- crates/
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- \
  cargo test --release -p redextape-core --test tm_parse_scaling -- --ignored --nocapture --test-threads 1
git -C "$P" checkout -- crates/redextape-core/src/tm/syntax.rs && git -C "$P" diff --quiet -- crates/ && echo restored
```

**S2 — put the `tape`-index scan back.**

```bash
perl -pi -e 's/Ok\(i\) if self\.tape_indices\.contains\(&i\) =>/Ok(i) if self.tapes.iter().any(|(j, _, _)| *j == i) =>/' "$P/crates/redextape-core/src/tm/header.rs"
git -C "$P" diff --stat -- crates/
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- \
  cargo test --release -p redextape-core --test tm_parse_scaling -- --ignored --nocapture --test-threads 1
git -C "$P" checkout -- crates/redextape-core/src/tm/header.rs && git -C "$P" diff --quiet -- crates/ && echo restored
```

**S3 — enter the name into the set BEFORE the duplicate check.** The first substitution deletes the insert and its comment after the navigation definition; the second puts the insert in front of the check.

```bash
perl -0pi -e 's/\n\s*\/\/ Entered only after the check above[^\n]*\n\s*state_names\.insert\(name_part\.trim\(\)\);//; s/(\n\s*)if state_names\.contains\(name\.as_str\(\)\) \{/$1state_names.insert(name_part.trim());$1if state_names.contains(name.as_str()) {/' "$P/crates/redextape-core/src/tm/syntax.rs"
git -C "$P" diff -U1 -- crates/
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- \
  cargo nextest run -p redextape-core --lib tm::syntax tm::header --no-fail-fast
git -C "$P" checkout -- crates/redextape-core/src/tm/syntax.rs && git -C "$P" diff --quiet -- crates/ && echo restored
```

**S4 — skip the navigation definition on a duplicate line.**

```bash
perl -0pi -e 's/if state_names\.contains\(name\.as_str\(\)\) \{/let duplicate = state_names.contains(name.as_str());\n            if duplicate {/; s/(nav\.push_definition\(&name, [^\n]*\);)/if !duplicate { $1 }/' "$P/crates/redextape-core/src/tm/syntax.rs"
git -C "$P" diff -U1 -- crates/
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- \
  cargo nextest run -p redextape-core --lib tm::syntax tm::header --no-fail-fast
git -C "$P" checkout -- crates/redextape-core/src/tm/syntax.rs && git -C "$P" diff --quiet -- crates/ && echo restored
```

Each `git diff` must show exactly the one-file change the sabotage names; if a substitution matched nothing, the diff is empty and the run proves nothing. Expected, as measured at `734fdcf`:

| row | sabotage | red | green |
| --- | --- | --- | --- |
| S1 | `parse_tm_nav` checks `states.iter().any(\|s\| s.name == name)` again | `parse_time_grows_linearly_with_state_lines`, ratio 26.08 (105.74 ms → 2.76 s) — `1 passed; 1 failed` | `parse_time_grows_linearly_with_tape_lines`, 4.28 |
| S2 | `HeaderParts::directive` checks `self.tapes.iter().any(\|(j, _, _)\| *j == i)` again | `parse_time_grows_linearly_with_tape_lines`, ratio 17.63 (48.83 ms → 860.61 ms) — `1 passed; 1 failed` | `parse_time_grows_linearly_with_state_lines`, 4.12 |
| S3 | the name enters the set before the duplicate check | `56 tests run: 38 passed, 18 failed, 776 skipped` — every state line now reports itself as a duplicate; both Task 1 pins are among the 18, the `tape` pin because its file has a `state` line | the other 38 |
| S4 | a duplicate line records no navigation definition | `a_duplicate_state_line_records_both_definitions` and `a_duplicate_state_line_keeps_every_diagnostic_in_place` — `56 tests run: 54 passed, 2 failed, 776 skipped` | the other 54 |

**S1 and S2 under `check-slow.sh`'s threading.** Run once more without `--test-threads 1`, each still reddened only its own test: S1 at 25.15 (106.43 ms → 2.68 s), `tape` lines green at 3.99; S2 at 17.32 (48.92 ms → 847.11 ms), state lines green at 3.55.

---

## Figures for the roadmap entry, measured while planning

**These are not steps.** They are the spec's before-and-after figures, taken with the same untracked probes the spec's figures came from. The probes live in `.claude/worktrees/agent-a389527aeb539cd2c/crates/redextape-core/examples/`, and were copied, untracked, into the scratch worktree at `734fdcf` and run there with `CARGO_TARGET_DIR` pointing at its own `target/`:

```bash
systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo run --release --example parse_cost_today_probe -p redextape-core
systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo run --release --example reduced_text_size_probe -p redextape-core
```

The "before" column is the spec's, measured at `78ebea6` by the same probes.

**Real files**, `print_tm` then `parse_tm`, every row round-tripping exactly:

| machine | rules | parse before | parse after |
| --- | --- | --- | --- |
| `3 - 5`, stages 1+2 | 21,621 | 187 ms | 13.89 ms |
| `cons(1, cons(2, nil))`, stages 1+2 | 60,422 | 1.31 s | 37.68 ms |
| `3 - 5`, all three stages | 160,994 | 10.88 s | 162.44 ms |
| `cons(1, cons(2, nil))`, all three stages | 1,002,222 | 1,233.57 s | 1.36 s |

**The largest shipped demo**, lowered, 49,135 states, 11,526,427 bytes, `parse_tm_full` fastest of 3: **1.08 s before, 68.40 ms after**.

**Extra `tape` lines** in a one-state machine's header, `parse_tm_full` fastest of 3:

| extra `tape` lines | 1k | 4k | 16k | 64k | 128k |
| --- | --- | --- | --- | --- | --- |
| before | 0.26 ms | 3.43 ms | 50 ms | 826 ms | 3.52 s |
| after | 149.38 µs | 606.14 µs | 2.46 ms | 9.94 ms | 20.66 ms |

**Findings from these figures.**
- **Parse cost per rule still rises on reduced machines.** 13.89 ms for 21,621 rules is 0.64 µs a rule; 37.68 ms for 60,422 is 0.62; 162.44 ms for 160,994 is 1.01; 1.36 s for 1,002,222 is 1.36. That is not the quadratic scan — four times the rules would cost sixteen times — but it is not flat, and the ratio tests, whose files have short names and no rules, cannot see it. The cause was not investigated; the spec puts any parse cost beyond the two scans out of scope.
- **The 1,002,222-rule row ran before the rows it was conditioned on were judged.** The brief said to run it only if the three smaller rows parsed in linear time. All rows came from one probe run, so it ran first and was judged after: from 21,621 to 60,422 rules (×2.79) the parse grew ×2.71, but from 60,422 to 160,994 (×2.66) it grew ×4.31. By that rule it would have been skipped. It finished in 1.36 s.
- **The machine was not idle.** The state-guard implementers were working in another worktree during this session, and no run controlled for load. The ratio spread above is the only evidence of how much that moved.

## Spec corrections found while planning

The spec is unchanged; these are for whoever corrects it.

1. **The "before" ratios in §4 are the diagnosis probe's files, not the test's.** The spec gives 30× for state lines (125 ms → 3.76 s) and 16.5× for `tape` lines (50 ms → 826 ms). The state figures came from files with one rule per state; the test's files have accept states and no rules. Against the unfixed parser the test's own files measured 23.08× (109.54 ms → 2.53 s) and 17.17× (48.72 ms → 836.31 ms), in Task 2 Step 4. Both are still far above 8.
2. **§4 does not say the `tape`-line files produce diagnostics.** They do, by construction: every index from 1 to `n` is out of range for `tapes 1`. The count alone cannot show that every line reached the duplicate check, because a `tape` line malformed before the check also yields one diagnostic. So since `9bf71c8` the test also requires every diagnostic to say `out of range`, which `HeaderParts::finish` reports only for an index that got past the check.
3. **§4 is silent on threading.** `check-slow.sh`'s `cargo test --release --workspace -- --ignored` runs the two ratio tests concurrently. This plan's steps pass `--test-threads 1`; both ways were measured on the harness that kept the fastest of 3, and both stayed under the bound of 8 (Task 4 Step 5). The concurrent case, which is how `check-slow.sh` runs them, has not been re-measured on the harness `9bf71c8` introduced or at bound 10.
4. **§1's step-1 pins redden under more sabotages than the spec's table names.** The table predicts only the pins for "insert a name into the set BEFORE the duplicate check"; measured, 18 of 56 tests go red, both pins among them — the `tape` pin too, because its file has a `state` line. And "skip the navigation definition" reddens `a_duplicate_state_line_keeps_every_diagnostic_in_place` as well as the test the spec names, because the pin asserts the definitions too.
5. **A sentence this branch makes further out of date, left alone by the plan and fixed after review.** `parse_tm_nav`'s doc says its loop shares "six mutable accumulators (`diags`, `tapes`, `start_name`, `states`, `header`, `offset`)". At `1f0d3e1` the list already omitted `comments`, `pending` and `nav`; Task 3 adds `state_names`. The spec's plan has no sweep item for it, and this plan leaves it alone. The fixes after the whole-branch review replaced the count and the list with the property, at `db22ad1`.

Corrections 6 and 7 were found by the whole-branch review of `78ebea6..cfb2275`, after planning.

6. **"Every other hit is inside a test" is false.** The spec's search, re-run as `git grep -n -F -e '.iter().any(' -e '.contains(&' 78ebea6 --` over the seven files it names, finds three hits outside a test module besides the two scans and `fresh`: `tm/syntax.rs:472`, the range check on a `tapes` line, `(1..=MAX_TAPES).contains(&n)`; `tm/syntax.rs:649`, the error gate after the loop, `diags.iter().any(|d| d.severity == Severity::Error)`; and `tm/header.rs:381`, the range check on `width`, `(1..=MAX_FIELD_WIDTH).contains(&n)`. The test modules open at `#[cfg(test)]` on `tm/syntax.rs:680` and `tm/header.rs:509`. None of the three is a per-line scan: two test one value against a range, and the gate runs once per parse. The spec's conclusion holds.
7. **The `.tm` header bullet is the fifth, not the second.** The spec's roadmap note places the reduced-machine `.tm` header at stage 3's *What this did not close*, second bullet. At `78ebea6` that section (roadmap line 17021) lists it fifth, as "**A `.tm` header for folded machines** stays open" (line 17027); the second bullet (line 17024) says leg 6's corpus never goes below cell -1.
8. **The bound is 10, not 8.** §4 asserts `large < 8 × small`. After the fixes for the whole-branch review, the state-line test measured 6.64× under load at `ead0416`, and the bound was raised to 10 by decision, at `9d697df`. At `9d697df`, S1 reddened only the state-line test, at 23.24×, and S2 only the `tape`-line test, at 15.00×. The harness changed too: §4 keeps the fastest of 3 parses of each file, and since `9bf71c8` the test instead parses the small and large files in turn for 5 rounds and keeps each file's fastest parse.

## Left for the controller

- **The roadmap entry**, with the figures above.
- **The scratch worktree** `.claude/worktrees/tm-parse-scratch`, branch `tm-parse-scratch`, holds the four commits this plan embeds, plus the two probes copied in untracked. All of it can be deleted without losing anything this plan does not embed.
