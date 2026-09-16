# Reduced `.tm` Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a program's machine as a `.tm` file after any subset of the three reductions, with a `version 2` header from which the file alone runs under its own step count and decodes to the program's value, through `redextape emit --lang tm --reduce` and `redextape run`.

**Architecture:** Five tasks:
1. `Code::from_symbols`, which rebuilds a two-symbol code from the symbol order a header can carry;
2. the `version 2` header: its `reduced` and `steps` lines, their parsing, and their comment anchors;
3. `tm/reduced_file.rs`: `reduce`, which applies the stages, pads stage 1 to exactly the cells a run visits, and checks the reduced machine's value before returning it, and `decode_reduced`, which undoes a header's stages;
4. the command line: `emit --reduce`, and `run` on a `version 2` file;
5. the TM tree-sitter grammar and `redextape-grammar-check`.

**Tech Stack:** Rust (`redextape-core`, `redextape-cli`, `redextape-grammar-check`), clap and trycmd, the tree-sitter CLI 0.25.10, cargo-nextest for the fast tier, `cargo nextest run --release --run-ignored only` for the slow tier, and the repository's pre-commit gates. No dependency is added.

**Spec:** `docs/superpowers/specs/2026-09-14-reduced-tm-files-design.md`, committed at `68328f1`. This plan does not amend it; *Decisions and spec corrections found while planning* records where the built code departs from it, and why.

## Global Constraints

From the spec, in its words:
- **What a reduced file lets a reader do:** "Run it, and decode the result to a value, from the file alone."
- **Stage lists:** "Any non-empty subset of `fold, single-tape, two-symbol`, in that order."
- **The version:** "`version 2`, for reduced files only." Lowered files stay at `version 1`.
- **The step ceiling:** "10^9 steps." A `steps N` line is "the step count `emit` measured, with `1 <= N <= 10^9`."
- **The web app:** "No web or wasm change."
- **The producer's module:** "a new core module `tm/reduced_file.rs`, whose name matches no tracked file, declared in `tm.rs` between `pub mod one_way;` and `pub mod reduction;`."
- **A refused reduction writes no file:** "Checked in core through the guard's crate-private ceiling."

For building it:
- **Build location:** work in the `reduced-tm-header` worktree, and put `CARGO_TARGET_DIR="$P/target"` on every cargo command and on every `git commit`, because the pre-commit hook runs cargo. Never build into the main checkout's `target/`, and never into `/tmp`.
- **Memory cap:** every test run, suite run, slow-tier run and sabotage run goes under `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 --`. An OOM kill is a result to record, never a reason to raise the cap.
- **Shell:** the Bash tool runs zsh, which passes an unquoted variable as one word where bash would split it, so every command gives each argument as its own word. Each Bash tool call is a new shell: every block below sets the variables and defines the functions it uses, and uses them. Run each block as one Bash tool call.
- **Hooks:** never `git commit --no-verify`, and never `git stash`. Tracked source may not cite `file:line`; name symbols instead, and keep a "`file.rs`'s `symbol`" citation on one line.
- **Staging:** stage files by name, never with `git add -A`.
- **tree-sitter:** the pinned CLI 0.25.10, installed into the gitignored `$P/.tools` by `scripts/install-treesitter-ci.sh`, and never whatever `tree-sitter` is on `PATH`.
- No AI or Claude attribution anywhere: code, comments or commit messages.
- The roadmap entry is not part of this plan.
- **Timings are one machine's,** taken while other agents loaded it; each gives the load average it started at.

## How this plan's code was verified

Every task's end state was built in the scratch worktree `.claude/worktrees/reduced-tm-scratch`, on branch `reduced-tm-scratch-5`, whose history starts at `68328f1`. Each was committed there through the unmodified pre-commit hooks before this plan was written, and nothing in this plan's verification used `--no-verify`.

| task | scratch commit |
| --- | --- |
| 1 | `58316d4` Rebuild a two-symbol code from its symbol order alone |
| 2 | `d8f6372` Read and write version 2 .tm headers, which record a reduction |
| 3 | `ec37a6e` Reduce a lowered run into a checked reduced .tm file, and decode one |
| 4 | `1f829f9` emit --reduce writes a reduced .tm file, and run runs one |
| 5 | `5e22a3d` The TM grammar reads reduced headers |

**Each task's code below is that commit's `git show --format=` output, embedded verbatim. Apply it; do not retype it.** The five blocks were extracted from this file with `block_of` and applied in order to a `68328f1` checked out in the scratch worktree on a branch `reduced-tm-replay`, and every step of every task below then ran there as written, each block as one Bash tool call, with only its `P` line pointed at that worktree and its `PLAN` line at this file. After each task's commit, `git diff --quiet <that task's scratch commit> HEAD` succeeded. The stats, summaries, gate counts and sabotage results each step expects are that replay's.

Task 1's sabotage block first ran at its own replay commit with an earlier `restore`, and was rerun as written here at Task 2's replay commit, after Task 2's block showed a regressions file could survive a row: the same four rows went red with the same tests and the same passed and failed counts, the summaries reading `909 skipped` where Task 1's own commit gives `898 skipped`, and no row left a file behind.

**No step shows a red-first run of a new test,** because the code existed before the plan. Each task instead runs sabotages on its committed code, each breaking one rule, and records which tests go red.

**Test selection uses filtersets, never a positional name.** A positional filter applies to every selected binary's test names, and silently drops a test whose name does not contain it.

**Baseline:** `cargo nextest run --workspace` at `68328f1`, under the cap, in the scratch worktree: `1699 tests run: 1699 passed, 29 skipped`, in 35.192 s, starting at a load average of 0.97.

Every embedded file sits between a `<!-- BEGIN name -->` line and an `<!-- END name -->` line, and each block that reads one defines `block_of` to extract it. `$S` holds only the small sabotage helper; any directory outside the worktree works.

---

### Task 1: `Code::from_symbols`, a two-symbol code from its symbol order

**Files:**
- Modify: `crates/redextape-core/src/tm/two_symbol.rs` — `Code::from_symbols`, and one width computation shared with `Code::new`
- Modify: `crates/redextape-core/tests/two_symbol_oracle.rs` — the leg asserts the symbol order rebuilds its code
- Modify: `crates/redextape-core/tests/one_way_oracle.rs` — so does the fold composed with stage 2

**Why.** A reduced file's header carries its two-symbol code as the symbol order, because the machine `Code::new` needs is gone once the reduction has run.

**Tests:**
- In `two_symbol.rs`: `from_symbols_rebuilds_the_code_new_built`, `from_symbols_keeps_the_order_it_is_given`, `from_symbols_refuses_a_first_symbol_that_is_not_blank` and `from_symbols_refuses_a_repeated_symbol`.
- `two_symbol_oracle.rs`'s `assert_two_symbol_agrees` and `one_way_oracle.rs`'s `the_fold_composes_with_the_alphabet_reduction_and_stays_right` assert that `Code::from_symbols(code.symbols())` is `Some(code)` for every machine they reduce.

**Interfaces:**
- Consumes: nothing new.
- Produces, in `crate::tm::two_symbol`: `pub fn Code::from_symbols(symbols: &[Symbol]) -> Option<Code>`, `None` unless `BLANK` comes first and no symbol repeats, keeping the order after `BLANK` as given.

- [ ] **Step 1: Confirm no code has changed yet**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
git -C "$P" diff --quiet HEAD -- crates/ grammars/ && git -C "$P" diff --cached --quiet -- crates/ grammars/ && echo clean
```

Expected: `clean`

- [ ] **Step 2: Apply the patch, staged**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
PLAN="$P/docs/superpowers/plans/2026-09-15-reduced-tm-files.md"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
block_of task1.patch | git -C "$P" apply --index --check && block_of task1.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/tm/two_symbol.rs       | 51 ++++++++++++++++++++++++
 crates/redextape-core/tests/one_way_oracle.rs    |  5 +++
 crates/redextape-core/tests/two_symbol_oracle.rs |  6 +++
 3 files changed, 62 insertions(+)
```

<!-- BEGIN task1.patch -->
````diff
diff --git a/crates/redextape-core/src/tm/two_symbol.rs b/crates/redextape-core/src/tm/two_symbol.rs
index fcca39f..49f8752 100644
--- a/crates/redextape-core/src/tm/two_symbol.rs
+++ b/crates/redextape-core/src/tm/two_symbol.rs
@@ -76,6 +76,28 @@ impl Code {
         let mut order = Vec::with_capacity(set.len() + 1);
         order.push(BLANK);
         order.extend(set);
+        Code::from_order(order)
+    }
+
+    /// The code whose [`Code::symbols`] is `symbols`, which is how a reduced `.tm` file's header carries
+    /// one: the order alone, since the machine `Code::new` would need is gone after the reduction.
+    ///
+    /// `None` unless `BLANK` comes first and no symbol repeats. The rest may come in any order, because
+    /// the order IS the code: a symbol's index is its bit pattern.
+    #[must_use]
+    pub fn from_symbols(symbols: &[Symbol]) -> Option<Code> {
+        if symbols.first() != Some(&BLANK) {
+            return None;
+        }
+        let mut seen = BTreeSet::new();
+        if !symbols.iter().all(|s| seen.insert(*s)) {
+            return None;
+        }
+        Some(Code::from_order(symbols.to_vec()))
+    }
+
+    /// The block width for `order`, computed once for both constructors.
+    fn from_order(order: Vec<Symbol>) -> Code {
         let mut bits = 1usize;
         while (1usize << bits) < order.len() {
             bits += 1;
@@ -548,6 +570,35 @@ mod tests {
         }
     }
 
+    #[test]
+    fn from_symbols_rebuilds_the_code_new_built() {
+        for syms in [&[][..], &['a'][..], &['c', 'a', 'b'][..], &['#', '1', '@', '0', 'x'][..]] {
+            let code = Code::new(&machine_over(syms), &[]);
+            assert_eq!(Code::from_symbols(code.symbols()), Some(code.clone()), "for {syms:?}");
+        }
+    }
+
+    /// The order is the code, so `from_symbols` keeps it rather than sorting: `b` before `a` gives `b`
+    /// index 1.
+    #[test]
+    fn from_symbols_keeps_the_order_it_is_given() {
+        let code = Code::from_symbols(&[BLANK, 'b', 'a']).expect("BLANK first and no repeat");
+        assert_eq!(code.pattern('b'), Some(vec![ZERO, ONE]));
+        assert_eq!(code.pattern('a'), Some(vec![ONE, ZERO]));
+    }
+
+    #[test]
+    fn from_symbols_refuses_a_first_symbol_that_is_not_blank() {
+        assert_eq!(Code::from_symbols(&['a', BLANK]), None);
+        assert_eq!(Code::from_symbols(&[]), None, "no symbols at all has no BLANK first either");
+    }
+
+    #[test]
+    fn from_symbols_refuses_a_repeated_symbol() {
+        assert_eq!(Code::from_symbols(&[BLANK, 'a', 'a']), None);
+        assert_eq!(Code::from_symbols(&[BLANK, 'a', BLANK]), None, "BLANK counts as a repeat too");
+    }
+
     #[test]
     fn width_is_ceil_log2_and_never_zero() {
         // `BLANK` is always in the set, so n is syms.len() + 1 for these.
diff --git a/crates/redextape-core/tests/one_way_oracle.rs b/crates/redextape-core/tests/one_way_oracle.rs
index 48afccd..e2574f2 100644
--- a/crates/redextape-core/tests/one_way_oracle.rs
+++ b/crates/redextape-core/tests/one_way_oracle.rs
@@ -250,6 +250,11 @@ fn the_fold_composes_with_the_alphabet_reduction_and_stays_right() {
         let folded = to_one_way(&m);
         let cells = zigzag(&inits, m.tapes).expect("no initial tape holds LEFT_END");
         let code = Code::new(&folded, &cells);
+        assert_eq!(
+            Code::from_symbols(code.symbols()).as_ref(),
+            Some(&code),
+            "the symbol order must rebuild the code for {src:?}"
+        );
         let reduced = to_two_symbol(&folded, &code);
         assert_eq!(reduced.validate(), Vec::<String>::new(), "for {src:?}");
         assert_eq!(reduced.alphabet().len(), 2, "two symbols, for {src:?}");
diff --git a/crates/redextape-core/tests/two_symbol_oracle.rs b/crates/redextape-core/tests/two_symbol_oracle.rs
index 603a618..b043c9a 100644
--- a/crates/redextape-core/tests/two_symbol_oracle.rs
+++ b/crates/redextape-core/tests/two_symbol_oracle.rs
@@ -33,6 +33,12 @@ const PAD: usize = 2;
 /// image without a second copy of the assertions.
 fn assert_two_symbol_agrees(label: &str, m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> (u64, u64) {
     let code = Code::new(m, inits);
+    // What a reduced `.tm` file's header carries is this order alone, so it must rebuild the whole code.
+    assert_eq!(
+        Code::from_symbols(code.symbols()).as_ref(),
+        Some(&code),
+        "the symbol order must rebuild the code for {label}"
+    );
     let (want, _ws, want_status, want_steps) = simulate_final(m, inits, caps);
     assert_eq!(want_status, Status::Halted, "the source run must halt for {label}");
 
````
<!-- END task1.patch -->

- [ ] **Step 3: Format check and lint**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo clippy --workspace --all-targets -- -D warnings 2>&1 | grep -E "^(warning|error)"; echo "clippy done"
```

Expected: `fmt exit 0` with no diff printed, and `clippy done` with no `warning` or `error` line before it.

- [ ] **Step 4: Run this task's tests**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core --lib --test two_symbol_oracle --test one_way_oracle -E 'test(/^tm::two_symbol::tests::from_symbols/) | binary_id(redextape-core::two_symbol_oracle) | test(=the_fold_composes_with_the_alphabet_reduction_and_stays_right)' 2>&1 | grep -E "FAIL|Summary"
```

Expected summary line: `11 tests run: 11 passed, 898 skipped`

- [ ] **Step 5: Run the two text gates**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 493 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `471 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Rebuild a two-symbol code from its symbol order alone

Code::from_symbols takes the order Code::symbols returns and gives back
the code, or None unless BLANK comes first and no symbol repeats. A
reduced .tm file's header will carry that order, since the machine
Code::new needs is gone once the reduction has run. Both constructors
share one width computation.

The two-symbol oracle's leg and the fold composed with the alphabet
reduction now assert that the order rebuilds the code for every machine
they reduce.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

- [ ] **Step 7: Run the sabotages, restoring after each**

Each edit is an exact-text replacement that must match exactly once, applied by the helper below. `restore` puts `crates/` back to the commit, removes with `git clean` every untracked file a row left there, and prints `git status --short` for `crates/`, which must be empty. A failing proptest writes such a file: a unit test's `proptest-regressions/` directory, or an integration test's `tests/<name>.proptest-regressions`, which would replay its failing case in every row after it. `git clean` removes only untracked files, because the crate tracks regression files of its own.

<!-- BEGIN sab.py -->
```python
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
n = text.count(old)
if n != 1:
    sys.exit(f"SABOTAGE NOT APPLIED: expected exactly 1 match in {path}, found {n}")
open(path, "w").write(text.replace(old, new))
```
<!-- END sab.py -->

Run the whole block in a single Bash tool call, with a timeout of 600000 ms.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
PLAN="$P/docs/superpowers/plans/2026-09-15-reduced-tm-files.md"
S=/tmp/claude-1000/-home-davey-projects-redextape/c6a1cf33-0c42-448c-a0ee-76239e25a1eb/scratchpad/reduced-tm-exec
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
fast() { cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core --lib --test two_symbol_oracle --test one_way_oracle -E 'test(/^tm::two_symbol::tests::from_symbols/) | binary_id(redextape-core::two_symbol_oracle) | test(=the_fold_composes_with_the_alphabet_reduction_and_stays_right)' --no-fail-fast 2>&1 | grep -E "^\s+FAIL \[|Summary|^error"; }
restore() { git -C "$P" checkout -- crates/ && git -C "${P:?}" clean -fdq -- crates/ && git -C "$P" status --short -- crates/; }
block_of sab.py >| "$S/sab.py"
F="$P/crates/redextape-core/src/tm/two_symbol.rs"

# T1-S1: a first symbol that is not BLANK is admitted
python3 "$S/sab.py" "$F" '        if symbols.first() != Some(&BLANK) {' '        if false {' && fast; restore

# T1-S2: a repeated symbol is admitted
python3 "$S/sab.py" "$F" '        if !symbols.iter().all(|s| seen.insert(*s)) {' '        if !symbols.iter().all(|s| seen.insert(*s) || true) {' && fast; restore

# T1-S3: the order is sorted rather than kept
python3 "$S/sab.py" "$F" '        Some(Code::from_order(symbols.to_vec()))' '        Some(Code::new(&Machine { states: vec![], start: 0, tapes: 1 }, &[symbols.to_vec()]))' && fast; restore

# T1-S4: the block width is not computed
python3 "$S/sab.py" "$F" '        Some(Code::from_order(symbols.to_vec()))' '        Some(Code { order: symbols.to_vec(), bits: 1 })' && fast; restore
```

Expected, as measured. The clean run is `11 tests run: 11 passed, 898 skipped`:

| row | sabotage | red | summary |
| --- | --- | --- | --- |
| T1-S1 | a first symbol that is not `BLANK` is admitted | `from_symbols_refuses_a_first_symbol_that_is_not_blank` | `10 passed, 1 failed` |
| T1-S2 | a repeated symbol is admitted | `from_symbols_refuses_a_repeated_symbol` | `10 passed, 1 failed` |
| T1-S3 | the order is sorted rather than kept | `from_symbols_keeps_the_order_it_is_given` | `10 passed, 1 failed` |
| T1-S4 | the block width is not computed | `from_symbols_rebuilds_the_code_new_built`, `from_symbols_keeps_the_order_it_is_given`, and the two-symbol oracle's `the_two_symbol_leg_agrees_on_small_programs`, `the_leg_holds_where_the_encoding_widens_the_alphabet` and `the_composed_machine_runs`, and the fold's `the_fold_composes_with_the_alphabet_reduction_and_stays_right` | `5 passed, 6 failed` |

T1-S3 reddens only the order test: every code `Code::new` builds is already sorted, so the rebuild tests cannot see a sort. The block took 6 s, starting at a load average of 1.42.

---

### Task 2: The `version 2` header

**Files:**
- Modify: `crates/redextape-core/src/tm/header.rs` — `REDUCED_HEADER_VERSION`, `MAX_REDUCED_STEPS`, `StageKind`, `is_stage_list`, `Stage`, `Reduction`, `TmHeader::reduction`; writing and reading `reduced` and `steps`; the version rules
- Modify: `crates/redextape-core/src/tm/comments.rs` — `TmDirective::Reduced` and `TmDirective::Steps`
- Modify: `crates/redextape-core/src/tm/syntax.rs` — both keys in the header dispatch and in `directive_anchor`, and the header tests
- Modify: `crates/redextape-core/src/tm.rs` — re-exports
- Modify: `crates/redextape-core/tests/tm_comments.rs` — the directive-anchor fixtures and generator reach both new variants

**What changes.**
1. **Writing.** A header whose `reduction` is `Some` prints `version 2`, then `reduced` and `steps` after `result`. The stages are comma-separated, in the order they ran: `fold`; `single-tape <k>`; `two-symbol <symbols>`, the code's symbols as one run to the end of the line, since a symbol can be `,`. A stage name is a `Keyword` span, a count a `Nat`, the comma a `Punct`, and the symbols one `TapeSymbol`. A reduced header's `tape` lines carry no generated `; reg` label: the reduced machine's tapes are not the lowered layout's.
2. **Reading.** `version` accepts 1 and 2. `reduced` parses to stages only when the list is one `is_stage_list` admits, `k` is in `1..=MAX_ENCODABLE_TAPES`, and the symbols are ones `Code::from_symbols` accepts. `steps` is `1..=MAX_REDUCED_STEPS`. A duplicate of either is an error, and so is either one with none of the four recipe directives.
3. **The version rules**, in `HeaderParts::finish`: `version 2` requires both lines; under `version 1`, written or absent, each is an error pointing at its own line. A `version` line that did not parse adds no rule diagnostic of its own.

**Tests:**
- In `header.rs`: the exact text of a reduced header, the class of every token in it, and the stage names and stage-list rule.
- In `syntax.rs`: a reduced header round-trips for each stage alone and all three, at both ends of `k`'s and `steps`'s ranges, with a `,` among the symbols; the version rules each way; `steps` refused past both ends; a malformed value for each new key refused by that key's own arm; duplicates; a lone `reduced` or `steps`; and an unparsable `version` adding nothing.
- In `tm_comments.rs`: every directive variant, `Reduced` and `Steps` included, carries a comment through a print, and the idempotence proptest now generates version 2 headers.

**Interfaces:**
- Consumes: Task 1's `Code::from_symbols`.
- Produces, in `crate::tm::header` and re-exported from `crate::tm`:
  - `pub const REDUCED_HEADER_VERSION: u32 = 2`, `pub const MAX_REDUCED_STEPS: u64 = 1_000_000_000`
  - `pub enum StageKind { Fold, SingleTape, TwoSymbol }`, `Copy` and `Ord` in that order, with `pub const ALL: [StageKind; 3]`, `pub fn name(self) -> &'static str` and `pub fn parse(s: &str) -> Option<StageKind>`
  - `pub fn is_stage_list(kinds: &[StageKind]) -> bool`
  - `pub enum Stage { Fold, SingleTape { k: usize }, TwoSymbol { symbols: Vec<Symbol> } }`, with `pub fn kind(&self) -> StageKind`
  - `pub struct Reduction { pub stages: Vec<Stage>, pub steps: u64 }`
  - `TmHeader` gains `pub reduction: Option<Reduction>`; `TmHeader::new` leaves it `None`
- Produces, in `crate::tm::comments`: `TmDirective::Reduced` and `TmDirective::Steps`.

- [ ] **Step 1: Confirm Task 1 is the last commit and nothing is pending**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD -- crates/ grammars/ && git -C "$P" diff --cached --quiet -- crates/ grammars/ && echo clean
```

Expected: a line ending `Rebuild a two-symbol code from its symbol order alone`, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
PLAN="$P/docs/superpowers/plans/2026-09-15-reduced-tm-files.md"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
block_of task2.patch | git -C "$P" apply --index --check && block_of task2.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/tm.rs            |   5 +-
 crates/redextape-core/src/tm/comments.rs   |   4 +
 crates/redextape-core/src/tm/header.rs     | 398 ++++++++++++++++++++++++++---
 crates/redextape-core/src/tm/syntax.rs     | 194 +++++++++++++-
 crates/redextape-core/tests/tm_comments.rs |  84 ++++--
 5 files changed, 624 insertions(+), 61 deletions(-)
```

<!-- BEGIN task2.patch -->
````diff
diff --git a/crates/redextape-core/src/tm.rs b/crates/redextape-core/src/tm.rs
index cc411f8..f2ba9a9 100644
--- a/crates/redextape-core/src/tm.rs
+++ b/crates/redextape-core/src/tm.rs
@@ -38,7 +38,10 @@ pub use build::{
 pub use decode::{decode_tape, decode_tape_reason, decode_tape_ty, decode_tape_ty_reason};
 pub use defunc::{defunc, defunc_mapped};
 pub use encoding::{Binary, Encoding, Unary};
-pub use header::{EncodingKind, HEADER_VERSION, TmHeader};
+pub use header::{
+    EncodingKind, HEADER_VERSION, MAX_REDUCED_STEPS, REDUCED_HEADER_VERSION, Reduction, Stage, StageKind, TmHeader,
+    is_stage_list,
+};
 pub use lower_asm::{LowerError, lower_asm, lower_asm_mapped};
 pub use lower_tm::{lower_tm, lower_tm_guarded, lower_tm_mapped, n_slots_of};
 pub use machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
diff --git a/crates/redextape-core/src/tm/comments.rs b/crates/redextape-core/src/tm/comments.rs
index ffbadd3..1f8a468 100644
--- a/crates/redextape-core/src/tm/comments.rs
+++ b/crates/redextape-core/src/tm/comments.rs
@@ -44,6 +44,10 @@ pub enum TmDirective {
     Width,
     Slots,
     Result,
+    /// A reduced file's `reduced` line.
+    Reduced,
+    /// A reduced file's `steps` line.
+    Steps,
     /// `tape <i>`, by the tape index the line names.
     Tape(usize),
 }
diff --git a/crates/redextape-core/src/tm/header.rs b/crates/redextape-core/src/tm/header.rs
index 87c454f..16fac14 100644
--- a/crates/redextape-core/src/tm/header.rs
+++ b/crates/redextape-core/src/tm/header.rs
@@ -24,21 +24,114 @@ use crate::Span;
 use crate::tm::build::{BOX, HEAP, MAX_FIELD_WIDTH, REG, STACK, WORK};
 use crate::tm::encoding::{Binary, Encoding, Unary};
 use crate::tm::lower_tm::MAX_SLOTS;
-use crate::tm::machine::Symbol;
+use crate::tm::machine::{BLANK, Symbol};
+use crate::tm::single_tape::MAX_ENCODABLE_TAPES;
+use crate::tm::two_symbol::Code;
 use crate::ty::Ty;
 use crate::ty::parse_ty;
 
-/// The `.tm` header format version this build writes and accepts.
+/// The `.tm` header format version of a LOWERED machine's file, and what an absent `version` means.
 ///
 /// An ABSENT `version` directive means 1, so every file written before this directive existed stays
-/// valid. An unknown version is a hard parse ERROR rather than a warning: a future version could
-/// change what `width` or `slots` MEAN, and decoding a v2 file under v1 rules would produce a
+/// valid. An unknown version is a hard parse ERROR rather than a warning: a version can change what
+/// the header's fields MEAN, and decoding a file under the wrong version's rules would produce a
 /// confidently wrong value — the exact failure the header exists to prevent.
+/// [`REDUCED_HEADER_VERSION`] is that case.
 ///
 /// NOT a member of the four-directive header set (`encoding`/`width`/`slots`/`result`), so the four
 /// optionality properties are unaffected and a header-less file is still header-less.
 pub const HEADER_VERSION: u32 = 1;
 
+/// The header version of a REDUCED machine's file. Its `tape` lines are the reduced machine's tapes
+/// rather than the layout `encoding`, `width` and `slots` describe, so it is a version of its own, and
+/// it carries `reduced` and `steps` — see [`Reduction`].
+pub const REDUCED_HEADER_VERSION: u32 = 2;
+
+/// The most steps a `steps` directive may record. A reduced file runs under its own `steps` rather than
+/// `TM_DEFAULT_CAPS`, so this bounds how long a file can make a reader simulate.
+pub const MAX_REDUCED_STEPS: u64 = 1_000_000_000;
+
+/// One of the three reductions, without the data undoing it needs. Declared in the one order a reduced
+/// file may list them, so `Ord` is that order.
+#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
+pub enum StageKind {
+    /// The fold onto one-way tapes, `to_one_way`.
+    Fold,
+    /// The reduction to one tape, `to_single_tape`.
+    SingleTape,
+    /// The reduction to two symbols, `to_two_symbol`.
+    TwoSymbol,
+}
+
+impl StageKind {
+    /// Every stage, in the order a reduced file lists them.
+    pub const ALL: [StageKind; 3] = [StageKind::Fold, StageKind::SingleTape, StageKind::TwoSymbol];
+
+    /// The stage's name in a `reduced` directive.
+    #[must_use]
+    pub fn name(self) -> &'static str {
+        match self {
+            StageKind::Fold => "fold",
+            StageKind::SingleTape => "single-tape",
+            StageKind::TwoSymbol => "two-symbol",
+        }
+    }
+
+    /// The inverse of `name`.
+    #[must_use]
+    pub fn parse(s: &str) -> Option<StageKind> {
+        StageKind::ALL.into_iter().find(|k| k.name() == s)
+    }
+}
+
+/// Whether `kinds` is a stage list a reduced file may carry: at least one stage, in the order of
+/// [`StageKind::ALL`], and none repeated.
+#[must_use]
+pub fn is_stage_list(kinds: &[StageKind]) -> bool {
+    !kinds.is_empty() && kinds.windows(2).all(|w| w[0] < w[1])
+}
+
+/// One reduction a file's machine went through, with what undoing it needs.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub enum Stage {
+    /// Nothing: a folded tape reads back with no outside information.
+    Fold,
+    /// The tape count before the stage, `1..=MAX_ENCODABLE_TAPES`, which splitting the one tape back
+    /// into its tapes needs.
+    SingleTape { k: usize },
+    /// The code's symbols in `Code::symbols` order, which `Code::from_symbols` rebuilds the code from.
+    TwoSymbol { symbols: Vec<Symbol> },
+}
+
+impl Stage {
+    /// Which reduction this is.
+    #[must_use]
+    pub fn kind(&self) -> StageKind {
+        match self {
+            Stage::Fold => StageKind::Fold,
+            Stage::SingleTape { .. } => StageKind::SingleTape,
+            Stage::TwoSymbol { .. } => StageKind::TwoSymbol,
+        }
+    }
+}
+
+/// What makes a header a reduced one: the stages its machine went through, in the order they ran, and the
+/// steps the reduced machine takes to halt.
+///
+/// **THE `tape` LINES OF A REDUCED FILE ARE THE REDUCED MACHINE'S OWN TAPES**, so any simulator can still
+/// run it, while `encoding`, `width`, `slots` and `result` stay the recipe for the tapes once every stage
+/// is undone.
+///
+/// **PRECONDITION for the round-trip, unenforced here**, as for `TmHeader::new`: `stages` must satisfy
+/// [`is_stage_list`], each stage's data must be what the parser admits (`k` in `1..=MAX_ENCODABLE_TAPES`,
+/// symbols that `Code::from_symbols` accepts), and `steps` must be in `1..=MAX_REDUCED_STEPS`. A reduction
+/// outside those prints and does not parse back.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub struct Reduction {
+    pub stages: Vec<Stage>,
+    pub steps: u64,
+}
+
 /// Declares `EncodingKind` and every list that must know about it, from ONE invocation.
 ///
 /// THE POINT: `ALL`, `at`, `name` and `parse` are generated from the same rows, so they cannot drift.
@@ -146,6 +239,9 @@ pub struct TmHeader {
     /// Literal initial contents by tape INDEX, ascending, with EMPTY TAPES OMITTED. Private because
     /// `new` maintains that normal form and the round-trip depends on it — see `new`.
     tapes: Vec<(usize, Vec<Symbol>)>,
+    /// `Some` for a reduced machine's file, which is `version 2`; `new` leaves it `None`. See
+    /// [`Reduction`] for what the other fields mean then.
+    pub reduction: Option<Reduction>,
 }
 
 impl TmHeader {
@@ -183,7 +279,7 @@ impl TmHeader {
         let mut tapes: Vec<(usize, Vec<Symbol>)> = tapes.into_iter().filter(|(_, c)| !c.is_empty()).collect();
         tapes.sort_by_key(|(i, _)| *i);
         tapes.dedup_by_key(|(i, _)| *i); // duplicates are sorted adjacent, so this keeps the first
-        TmHeader { encoding, width, slots, result, tapes }
+        TmHeader { encoding, width, slots, result, tapes, reduction: None }
     }
 
     /// The literal initial tapes, by index, ascending, empties omitted.
@@ -228,11 +324,12 @@ use crate::ty::show;
 /// buffer — so the offsets recorded here are already absolute in the finished file, with no rebasing.
 /// `cw` is that same call's `CommentWriter`, so an authored comment against a header line lands on it.
 ///
-/// The order — `version`, `encoding`, `width`, `slots`, `result`, then `tape` lines ascending — is
-/// FIXED, even though the parser accepts any order. A printer has to choose one, and a fixed choice is
-/// what makes re-printing a re-parse idempotent. `version` leads: it is not one of the four directives
-/// `TmHeader` carries (there is no field for it — see `HEADER_VERSION`'s doc), but a reader needs to
-/// know which rules govern the rest of the block before it makes sense of them.
+/// The order — `version`, `encoding`, `width`, `slots`, `result`, then a reduced header's `reduced` and
+/// `steps`, then `tape` lines ascending — is FIXED, even though the parser accepts any order. A printer
+/// has to choose one, and a fixed choice is what makes re-printing a re-parse idempotent. `version`
+/// leads: `TmHeader` has no field for it, since it is `REDUCED_HEADER_VERSION` exactly when `reduction`
+/// is `Some`, but a reader needs to know which rules govern the rest of the block before it makes sense
+/// of them.
 ///
 /// KNOWN LIMIT: a tape cell equal to `;` would open a comment and not round-trip. No `Encoding` in
 /// this tree writes one — the tape alphabet is `_ # 1 0 @` — and `Machine::validate()` already
@@ -248,13 +345,18 @@ pub(crate) fn write_header(out: &mut String, spans: &mut Classified, h: &TmHeade
             cw.trailing(out, spans, TmAnchor::Directive(anchor));
             out.push('\n');
         };
+    let version = if h.reduction.is_some() { REDUCED_HEADER_VERSION } else { HEADER_VERSION };
     // `encoding` and `result` name an encoding and a type; neither has a class of its own, and `Ident`
     // is the vocabulary's word for "a name whose meaning comes from elsewhere in the file".
-    directive(out, spans, "version", &HEADER_VERSION.to_string(), TokenClass::Nat, TmDirective::Version);
+    directive(out, spans, "version", &version.to_string(), TokenClass::Nat, TmDirective::Version);
     directive(out, spans, "encoding", h.encoding.name(), TokenClass::Ident, TmDirective::Encoding);
     directive(out, spans, "width", &h.width.to_string(), TokenClass::Nat, TmDirective::Width);
     directive(out, spans, "slots", &h.slots.to_string(), TokenClass::Nat, TmDirective::Slots);
     directive(out, spans, "result", &show(&h.result), TokenClass::Ident, TmDirective::Result);
+    if let Some(r) = &h.reduction {
+        write_reduced(out, spans, &r.stages, cw);
+        directive(out, spans, "steps", &r.steps.to_string(), TokenClass::Nat, TmDirective::Steps);
+    }
     for (i, cells) in &h.tapes {
         let anchor = TmDirective::Tape(*i);
         cw.own_line(out, spans, TmAnchor::Directive(anchor), "");
@@ -276,7 +378,11 @@ pub(crate) fn write_header(out: &mut String, spans: &mut Classified, h: &TmHeade
         //
         // Reachable, not defensive: `tape_name` labels tape 0 `reg` and tape 1 `work`, and
         // `tests/fixtures/list_1_2.tm` carries `; reg` on its `tape 0` line today.
-        if !cw.has_trailing(TmAnchor::Directive(anchor))
+        //
+        // A reduced header's tapes are the reduced machine's, which `tape_name` does not name, so they
+        // carry no label at all.
+        if h.reduction.is_none()
+            && !cw.has_trailing(TmAnchor::Directive(anchor))
             && let Some(name) = tape_name(*i)
         {
             out.push_str("  ");
@@ -287,6 +393,40 @@ pub(crate) fn write_header(out: &mut String, spans: &mut Classified, h: &TmHeade
     }
 }
 
+/// A reduced header's `reduced` line: the stages comma-separated, each with the data undoing it needs.
+/// A stage name is a `Keyword` like the directive's own, a tape count a `Nat`, and the code's symbols ONE
+/// `TapeSymbol` span, for the reason a `tape` line's cells are one.
+fn write_reduced(out: &mut String, spans: &mut Classified, stages: &[Stage], cw: &CommentWriter<'_, TmAnchor>) {
+    let anchor = TmAnchor::Directive(TmDirective::Reduced);
+    cw.own_line(out, spans, anchor, "");
+    push_span(out, spans, "reduced", TokenClass::Keyword);
+    for (i, stage) in stages.iter().enumerate() {
+        if i > 0 {
+            push_span(out, spans, ",", TokenClass::Punct);
+        }
+        out.push(' ');
+        push_span(out, spans, stage.kind().name(), TokenClass::Keyword);
+        match stage {
+            Stage::Fold => {}
+            Stage::SingleTape { k } => {
+                out.push(' ');
+                push_span(out, spans, &k.to_string(), TokenClass::Nat);
+            }
+            Stage::TwoSymbol { symbols } => {
+                out.push(' ');
+                let run: String = symbols.iter().collect();
+                // `Code::from_symbols` refuses an empty order, so the guard only keeps a hand-built
+                // header from pushing a zero-width span.
+                if !run.is_empty() {
+                    push_span(out, spans, &run, TokenClass::TapeSymbol);
+                }
+            }
+        }
+    }
+    cw.trailing(out, spans, anchor);
+    out.push('\n');
+}
+
 /// Unpack a `tape` line's cell run: strip a trailing `;` comment, trim, and take one `Symbol` per
 /// char. The inverse of `print_header`'s packing (D4).
 pub(crate) fn parse_cells(s: &str) -> Vec<Symbol> {
@@ -302,12 +442,20 @@ pub(crate) struct HeaderParts {
     slots: Option<u32>,
     result: Option<Ty>,
     /// The parsed, VALIDATED version — `Some` only once a `version` directive has been seen naming
-    /// exactly `HEADER_VERSION`. Not surfaced on `TmHeader` (see `HEADER_VERSION`'s doc: version is a
-    /// property of the FORMAT, validated here and re-emitted as a constant, not a property of any one
-    /// machine's header). Its ONLY job is detecting a duplicate directive — `finish` never reads it,
-    /// consulting `saw_version` below instead, because a `version` line that FAILED to validate still
-    /// means the file was trying to carry a header.
+    /// `HEADER_VERSION` or `REDUCED_HEADER_VERSION`. Not surfaced on `TmHeader`, which prints the one
+    /// that `reduction` implies. It detects a duplicate directive, and `finish` reads it for the version
+    /// rules; whether a header was being attempted at all is `saw_version`'s question instead, because a
+    /// `version` line that FAILED to validate still means the file was trying to carry a header.
     version: Option<u32>,
+    /// The stages of the first `reduced` directive that parsed.
+    reduced: Option<Vec<Stage>>,
+    /// The span of the first `reduced` line, whether or not it parsed, so `finish` can both tell that
+    /// one was written and point at it.
+    saw_reduced: Option<Span>,
+    /// The count of the first `steps` directive that parsed.
+    steps: Option<u64>,
+    /// The span of the first `steps` line, whether or not it parsed, for the reason `saw_reduced` gives.
+    saw_steps: Option<Span>,
     /// Each entry carries the `Span` of the `tape` line it came from, so a diagnostic about ONE
     /// specific entry (the out-of-range check in `finish`) can point at the line that caused it
     /// instead of the whole file. The span is parse-time-only: `finish` strips it before handing the
@@ -346,23 +494,54 @@ impl HeaderParts {
         let val = content_before_comment(rest);
         match key {
             // Unlike the four directives below, an unrecognized version is not "incomplete" — it is
-            // refused outright, here, at the earliest point it can be: a v2 file parsed under v1 rules
-            // would not fail to parse, it would parse to a CONFIDENTLY WRONG value, because a future
-            // version could redefine what `width` or `slots` mean. A duplicate is an error for the same
-            // reason as the other four, and on the same rule: the file states a thing once, so two
-            // AGREEING `version 1` lines are refused as well.
+            // refused outright, here, at the earliest point it can be: a file parsed under the wrong
+            // version's rules would not fail to parse, it would parse to a CONFIDENTLY WRONG value,
+            // because a version can redefine what the other directives mean. A duplicate is an error for
+            // the same reason as the other four, and on the same rule: the file states a thing once, so
+            // two AGREEING `version 1` lines are refused as well.
             "version" => {
                 self.saw_version = true;
                 Some(match (self.version, val.parse::<u32>()) {
                     (Some(_), _) => Err("duplicate `version` directive".into()),
-                    (None, Ok(v)) if v == HEADER_VERSION => {
+                    (None, Ok(v)) if v == HEADER_VERSION || v == REDUCED_HEADER_VERSION => {
                         self.version = Some(v);
                         Ok(())
                     }
                     (None, Ok(v)) => Err(format!(
-                        "unsupported header version `{v}` (this build reads version {HEADER_VERSION} only)"
+                        "unsupported header version `{v}` (this build reads versions {HEADER_VERSION} and \
+                         {REDUCED_HEADER_VERSION})"
+                    )),
+                    (None, Err(_)) => Err(format!(
+                        "expected `version {HEADER_VERSION}` or `version {REDUCED_HEADER_VERSION}`, found `{val}`"
                     )),
-                    (None, Err(_)) => Err(format!("expected `version {HEADER_VERSION}`, found `{val}`")),
+                })
+            }
+            // Whether a `reduced` or `steps` line is allowed at all is the version's business, and the
+            // version may come later in the file, so `finish` decides that; these arms parse the value.
+            "reduced" => {
+                self.saw_reduced = self.saw_reduced.or(Some(span));
+                Some(match (&self.reduced, parse_stages(val)) {
+                    (Some(_), _) => Err("duplicate `reduced` directive".into()),
+                    (None, Some(stages)) => {
+                        self.reduced = Some(stages);
+                        Ok(())
+                    }
+                    (None, None) => Err(format!(
+                        "expected `reduced` followed by `fold`, `single-tape <1..={MAX_ENCODABLE_TAPES}>` and \
+                         `two-symbol <symbols>`, comma-separated, in that order and each at most once, with \
+                         the symbols starting at `{BLANK}` and none repeated; found `{val}`"
+                    )),
+                })
+            }
+            "steps" => {
+                self.saw_steps = self.saw_steps.or(Some(span));
+                Some(match (self.steps, val.parse::<u64>()) {
+                    (Some(_), _) => Err("duplicate `steps` directive".into()),
+                    (None, Ok(n)) if (1..=MAX_REDUCED_STEPS).contains(&n) => {
+                        self.steps = Some(n);
+                        Ok(())
+                    }
+                    (None, _) => Err(format!("expected `steps <1..={MAX_REDUCED_STEPS}>`, found `{val}`")),
                 })
             }
             "encoding" => Some(match (self.encoding, EncodingKind::parse(val)) {
@@ -448,10 +627,13 @@ impl HeaderParts {
     /// - **One to three present** -> `(None, [(msg, None)])` naming the missing ones. Not a silent
     ///   `None`, because discarding a half-written header would turn a typo into "this file has no
     ///   header". Spanless: there is no single offending line for an ABSENT directive.
-    /// - **`tape` and/or `version` lines but none of the four** -> an error for the same reason: that
-    ///   data would otherwise vanish without a word. Also spanless, for the same reason. `version` is
-    ///   folded in here rather than getting its own case because a LONE `version` has exactly the same
-    ///   shape as a lone `tape`: a directive with no header for it to belong to.
+    /// - **`tape`, `version`, `reduced` and/or `steps` lines but none of the four** -> an error for the
+    ///   same reason: that data would otherwise vanish without a word. Also spanless, for the same
+    ///   reason. The other three are folded in here rather than getting cases of their own because a
+    ///   LONE one has exactly the same shape as a lone `tape`: a directive with no header for it to
+    ///   belong to.
+    /// - **The version rules** -> `version 2` requires `reduced` and `steps`, and under `version 1`,
+    ///   written or absent, either is an error pointing at its line. See `version_errors`.
     pub(crate) fn finish(self, n_tapes: usize) -> (Option<TmHeader>, Vec<(String, Option<Span>)>) {
         let missing: Vec<&str> = [
             ("encoding", self.encoding.is_none()),
@@ -464,12 +646,12 @@ impl HeaderParts {
         .collect();
 
         if missing.len() == 4 {
-            return if self.saw_tape || self.saw_version {
+            return if self.saw_tape || self.saw_version || self.saw_reduced.is_some() || self.saw_steps.is_some() {
                 (
                     None,
                     vec![(
-                        "`tape`/`version` directives without a header (needs `encoding`, `width`, `slots`, \
-                         `result`)"
+                        "`tape`/`version`/`reduced`/`steps` directives without a header (needs `encoding`, \
+                         `width`, `slots`, `result`)"
                             .into(),
                         None,
                     )],
@@ -481,6 +663,10 @@ impl HeaderParts {
         if !missing.is_empty() {
             return (None, vec![(format!("incomplete header: missing {}", missing.join(", ")), None)]);
         }
+        let errs = self.version_errors();
+        if !errs.is_empty() {
+            return (None, errs);
+        }
 
         // The range check lives HERE, not in `directive`, because directives are order-independent:
         // a `tape 7` line may precede the `tapes 5` that makes it out of range. Unlike the diagnostics
@@ -505,10 +691,77 @@ impl HeaderParts {
             return (None, vec![("incomplete header: missing a required directive".into(), None)]);
         };
         let tapes: Vec<(usize, Vec<Symbol>)> = self.tapes.into_iter().map(|(i, cells, _)| (i, cells)).collect();
-        (Some(TmHeader::new(encoding, width, slots, result, tapes)), Vec::new())
+        let mut header = TmHeader::new(encoding, width, slots, result, tapes);
+        header.reduction = self.reduced.zip(self.steps).map(|(stages, steps)| Reduction { stages, steps });
+        (Some(header), Vec::new())
+    }
+
+    /// `version 2` exactly when `reduced` and `steps` are both written: under `version 2` a missing one is
+    /// an error, and under `version 1`, written or absent, a written one is an error pointing at its line.
+    ///
+    /// Asked only once the version is known. A `version` line that did not parse has been reported
+    /// already, and it says nothing about which rules the rest of the header meant, so a guess here would
+    /// only add a second diagnostic about the same line.
+    fn version_errors(&self) -> Vec<(String, Option<Span>)> {
+        if self.saw_version && self.version.is_none() {
+            return Vec::new();
+        }
+        if self.version == Some(REDUCED_HEADER_VERSION) {
+            [("reduced", self.saw_reduced), ("steps", self.saw_steps)]
+                .into_iter()
+                .filter(|(_, seen)| seen.is_none())
+                .map(|(key, _)| (format!("`version {REDUCED_HEADER_VERSION}` requires a `{key}` directive"), None))
+                .collect()
+        } else {
+            [("reduced", self.saw_reduced), ("steps", self.saw_steps)]
+                .into_iter()
+                .filter_map(|(key, seen)| {
+                    let msg = format!(
+                        "`{key}` requires `version {REDUCED_HEADER_VERSION}`; this header is version {HEADER_VERSION}"
+                    );
+                    seen.map(|span| (msg, Some(span)))
+                })
+                .collect()
+        }
     }
 }
 
+/// A `reduced` directive's stages, or `None` unless every stage parses, its data is in range, and the list
+/// is one [`is_stage_list`] admits.
+///
+/// **`two-symbol` IS ALWAYS LAST, SO ITS SYMBOLS ARE THE REST OF THE LINE.** A symbol can be `,`, so
+/// splitting the line on commas first would cut the symbols in two; a symbol cannot be `;`, which is
+/// what lets `content_before_comment` strip a trailing comment before this sees the value.
+fn parse_stages(val: &str) -> Option<Vec<Stage>> {
+    let mut stages = Vec::new();
+    let mut rest = val;
+    loop {
+        if let Some(run) = rest.strip_prefix(StageKind::TwoSymbol.name()).and_then(|r| r.strip_prefix(' ')) {
+            let symbols: Vec<Symbol> = run.chars().collect();
+            Code::from_symbols(&symbols)?;
+            stages.push(Stage::TwoSymbol { symbols });
+            break;
+        }
+        let (item, tail) = match rest.split_once(", ") {
+            Some((item, tail)) => (item, Some(tail)),
+            None => (rest, None),
+        };
+        stages.push(match item.split_once(' ') {
+            None if item == StageKind::Fold.name() => Stage::Fold,
+            Some((name, k)) if name == StageKind::SingleTape.name() => {
+                Stage::SingleTape { k: k.parse().ok().filter(|k| (1..=MAX_ENCODABLE_TAPES).contains(k))? }
+            }
+            _ => return None,
+        });
+        match tail {
+            Some(t) => rest = t,
+            None => break,
+        }
+    }
+    let kinds: Vec<StageKind> = stages.iter().map(Stage::kind).collect();
+    is_stage_list(&kinds).then_some(stages)
+}
+
 #[cfg(test)]
 mod tests {
     use super::*;
@@ -649,6 +902,85 @@ tape 1 #0000#  ; work
         assert_eq!(print_header(&h), expected);
     }
 
+    /// `a_header`'s recipe with a one-tape reduced machine's tape, through all three stages.
+    fn a_reduced_header() -> TmHeader {
+        let mut h = TmHeader::new(EncodingKind::Unary, 8, 4, Ty::Nat, vec![(REG, vec!['1', '_', '1'])]);
+        h.reduction = Some(Reduction {
+            stages: vec![Stage::Fold, Stage::SingleTape { k: 5 }, Stage::TwoSymbol { symbols: vec!['_', '#', ','] }],
+            steps: 7_088_578,
+        });
+        h
+    }
+
+    /// A reduced header's canonical text: `version 2`, then `reduced` and `steps` after `result`, and no
+    /// generated label on a `tape` line, since the reduced machine's tape 0 is not REG.
+    #[test]
+    fn a_reduced_header_prints_version_2_its_stages_and_steps_and_no_tape_label() {
+        let expected = "\
+version 2
+encoding unary
+width 8
+slots 4
+result Nat
+reduced fold, single-tape 5, two-symbol _#,
+steps 7088578
+tape 0 1_1
+";
+        assert_eq!(print_header(&a_reduced_header()), expected);
+    }
+
+    /// Every token of a reduced header carries a class, in order: a stage name is a `Keyword`, a tape
+    /// count a `Nat`, the separator a `Punct`, and the code's symbols one `TapeSymbol` span.
+    #[test]
+    fn a_reduced_header_classifies_every_token() {
+        use TokenClass::{Ident as Id, Keyword as Kw, Nat as Nt, Punct as Pu, TapeSymbol as Ts};
+        let (mut out, mut spans) = (String::new(), Vec::new());
+        write_header(&mut out, &mut spans, &a_reduced_header(), &CommentWriter::new(&[]));
+        let named: Vec<(&str, TokenClass)> = spans.iter().map(|(s, c)| (&out[s.start..s.end], *c)).collect();
+        assert_eq!(
+            named,
+            vec![
+                ("version", Kw),
+                ("2", Nt),
+                ("encoding", Kw),
+                ("unary", Id),
+                ("width", Kw),
+                ("8", Nt),
+                ("slots", Kw),
+                ("4", Nt),
+                ("result", Kw),
+                ("Nat", Id),
+                ("reduced", Kw),
+                ("fold", Kw),
+                (",", Pu),
+                ("single-tape", Kw),
+                ("5", Nt),
+                (",", Pu),
+                ("two-symbol", Kw),
+                ("_#,", Ts),
+                ("steps", Kw),
+                ("7088578", Nt),
+                ("tape", Kw),
+                ("0", Nt),
+                ("1_1", Ts),
+            ]
+        );
+    }
+
+    #[test]
+    fn stage_names_round_trip_and_only_the_canonical_order_is_a_stage_list() {
+        for k in StageKind::ALL {
+            assert_eq!(StageKind::parse(k.name()), Some(k));
+        }
+        assert_eq!(StageKind::parse("Fold"), None);
+        use StageKind::{Fold, SingleTape, TwoSymbol};
+        assert!(is_stage_list(&[Fold, SingleTape, TwoSymbol]));
+        assert!(is_stage_list(&[SingleTape]));
+        assert!(!is_stage_list(&[]), "empty");
+        assert!(!is_stage_list(&[TwoSymbol, Fold]), "out of order");
+        assert!(!is_stage_list(&[Fold, Fold]), "repeated");
+    }
+
     /// D4: cells are PACKED, not space-separated. Rules use space-separated symbol lists because a
     /// rule's entries may be the wildcard `*`; a tape has no wildcards and `Symbol` is a `char`, so
     /// packing keeps a 120-cell bank on one readable line.
diff --git a/crates/redextape-core/src/tm/syntax.rs b/crates/redextape-core/src/tm/syntax.rs
index 03240a3..7653ce4 100644
--- a/crates/redextape-core/src/tm/syntax.rs
+++ b/crates/redextape-core/src/tm/syntax.rs
@@ -378,6 +378,8 @@ fn directive_anchor(key: &str, rest: &str) -> Option<TmDirective> {
         "width" => TmDirective::Width,
         "slots" => TmDirective::Slots,
         "result" => TmDirective::Result,
+        "reduced" => TmDirective::Reduced,
+        "steps" => TmDirective::Steps,
         "tape" => TmDirective::Tape(rest.split_whitespace().next()?.parse().ok()?),
         _ => return None,
     })
@@ -478,10 +480,9 @@ pub fn parse_tm_nav(src: &str) -> (TmDocument, NameIndex) {
                     _ => diags.push(err(span, format!("expected `tapes <1..={MAX_TAPES}>`"))),
                 }
             }
-        } else if let Some((key, rest)) = trimmed
-            .split_once(' ')
-            .filter(|(k, _)| matches!(*k, "version" | "encoding" | "width" | "slots" | "result" | "tape"))
-        {
+        } else if let Some((key, rest)) = trimmed.split_once(' ').filter(|(k, _)| {
+            matches!(*k, "version" | "encoding" | "width" | "slots" | "result" | "reduced" | "steps" | "tape")
+        }) {
             if let Err(msg) = header_position(key, &states) {
                 diags.push(err(span, msg));
             } else if let Some(Err(msg)) = header.directive(key, rest, span) {
@@ -1288,18 +1289,26 @@ state s: accept
         assert!(doc.diagnostics.is_empty(), "an absent version is not a diagnostic: {:?}", doc.diagnostics);
     }
 
-    /// An unknown version is a hard ERROR, not a warning. A future version could change what `width` or
-    /// `slots` MEAN, so decoding a v2 file under v1 rules would produce a confidently wrong value — the
-    /// exact failure the header exists to prevent.
+    /// An unknown version is a hard ERROR, not a warning. A version can change what the header's fields
+    /// MEAN, so decoding a file under the wrong version's rules would produce a confidently wrong value —
+    /// the exact failure the header exists to prevent.
     #[test]
     fn an_unknown_version_is_an_error_not_a_warning() {
-        for bad in ["version 2", "version 0", "version foo", "version"] {
+        for bad in ["version 3", "version 0", "version foo", "version"] {
             let src =
                 format!("tapes 1\nstart s\n{bad}\nencoding unary\nwidth 4\nslots 1\nresult Nat\n\nstate s: accept\n");
             let doc = parse_tm_full(&src);
             assert!(doc.machine.is_none() && doc.header.is_none(), "{bad:?} must be refused");
             assert!(doc.diagnostics.iter().any(|d| d.message.contains("version")), "{bad:?}: {:?}", doc.diagnostics);
         }
+        let doc = parse_tm_full(
+            "tapes 1\nstart s\nversion 3\nencoding unary\nwidth 4\nslots 1\nresult Nat\n\nstate s: accept\n",
+        );
+        assert!(
+            doc.diagnostics.iter().any(|d| d.message.contains("this build reads versions 1 and 2")),
+            "the refusal names what this build reads: {:?}",
+            doc.diagnostics
+        );
     }
 
     /// `version` is NOT a member of the four-directive header set, so the four optionality properties are
@@ -1321,6 +1330,175 @@ state s: accept
         assert_eq!(block, vec!["version 1"], "got:\n{out}");
     }
 
+    use crate::tm::header::{MAX_REDUCED_STEPS, Reduction, Stage};
+    use crate::tm::single_tape::MAX_ENCODABLE_TAPES;
+
+    /// `a_header` as a reduced one.
+    fn a_reduced_header(stages: Vec<Stage>, steps: u64) -> TmHeader {
+        let mut h = a_header();
+        h.reduction = Some(Reduction { stages, steps });
+        h
+    }
+
+    /// A one-state file whose header is `lines` on top of `a_header`'s recipe.
+    fn parse_header_lines(lines: &str) -> TmDocument {
+        parse_tm_full(&format!(
+            "tapes 1\nstart s\n{lines}encoding unary\nwidth 4\nslots 1\nresult Nat\n\nstate s: accept\n"
+        ))
+    }
+
+    /// Property 2 for reduced headers: every stage alone and all three together, `single-tape` at both
+    /// ends of its range, `steps` at both ends of its range, and a `,` among the code's symbols, which
+    /// is why the symbols are the rest of the line rather than one comma-separated item.
+    #[test]
+    fn a_reduced_header_round_trips_through_the_text_form() {
+        let lists = [
+            vec![Stage::Fold],
+            vec![Stage::SingleTape { k: 1 }],
+            vec![Stage::TwoSymbol { symbols: vec!['_'] }],
+            vec![
+                Stage::Fold,
+                Stage::SingleTape { k: MAX_ENCODABLE_TAPES },
+                Stage::TwoSymbol { symbols: vec!['_', ',', '#'] },
+            ],
+        ];
+        for stages in lists {
+            for steps in [1, MAX_REDUCED_STEPS] {
+                let h = a_reduced_header(stages.clone(), steps);
+                let text = print_tm_with(&increment(), &h);
+                let doc = parse_tm_full(&text);
+                assert_eq!((doc.machine, doc.header, doc.diagnostics), (Some(increment()), Some(h), vec![]), "{text}");
+            }
+        }
+    }
+
+    /// Under version 1, explicit or absent, `reduced` and `steps` are errors, each pointing at its line.
+    #[test]
+    fn reduced_and_steps_are_errors_under_version_1() {
+        for version in ["version 1\n", ""] {
+            for line in ["reduced fold", "steps 5"] {
+                let src = format!("{version}{line}\n");
+                let doc = parse_header_lines(&src);
+                let key = line.split(' ').next().unwrap_or_default();
+                let want = format!("`{key}` requires `version 2`; this header is version 1");
+                let d = doc
+                    .diagnostics
+                    .iter()
+                    .find(|d| d.message == want)
+                    .unwrap_or_else(|| panic!("{src:?}: no {want:?} in {:?}", doc.diagnostics));
+                let full = format!("tapes 1\nstart s\n{src}");
+                assert_eq!(&full[d.span.start..d.span.end], line, "{src:?}: the diagnostic points at the line");
+                assert!(doc.header.is_none(), "{src:?}");
+            }
+        }
+    }
+
+    /// Under version 2, each of `reduced` and `steps` is required.
+    #[test]
+    fn version_2_requires_reduced_and_steps() {
+        for (lines, missing) in [("version 2\nsteps 5\n", "reduced"), ("version 2\nreduced fold\n", "steps")] {
+            let doc = parse_header_lines(lines);
+            let want = format!("`version 2` requires a `{missing}` directive");
+            assert!(
+                doc.diagnostics.iter().any(|d| d.message == want),
+                "{lines:?}: no {want:?} in {:?}",
+                doc.diagnostics
+            );
+            assert!(doc.header.is_none(), "{lines:?}");
+        }
+    }
+
+    /// `steps` outside `1..=MAX_REDUCED_STEPS` is refused, and both ends are admitted — a cap tested only
+    /// from outside proves the refusal fires, never that it fires at the right place.
+    #[test]
+    fn steps_is_refused_outside_one_to_its_ceiling_and_admitted_at_both_ends() {
+        for steps in [1, MAX_REDUCED_STEPS] {
+            let doc = parse_header_lines(&format!("version 2\nreduced fold\nsteps {steps}\n"));
+            assert!(doc.diagnostics.is_empty() && doc.header.is_some(), "steps {steps}: {:?}", doc.diagnostics);
+        }
+        for steps in [0, MAX_REDUCED_STEPS + 1] {
+            let doc = parse_header_lines(&format!("version 2\nreduced fold\nsteps {steps}\n"));
+            let want = format!("expected `steps <1..={MAX_REDUCED_STEPS}>`, found `{steps}`");
+            assert!(doc.diagnostics.iter().any(|d| d.message == want), "steps {steps}: {:?}", doc.diagnostics);
+        }
+    }
+
+    /// THE KNOWN TRAP: a key in `parse_tm_nav`'s header filter with no arm in `HeaderParts::directive`
+    /// is skipped with no diagnostic at all. So every new key gets malformed values, and each must be
+    /// refused BY that key's own arm, naming the key.
+    #[test]
+    fn a_malformed_value_for_each_new_key_is_refused_by_that_key() {
+        let over = MAX_ENCODABLE_TAPES + 1;
+        let reduced = [
+            String::new(),
+            "fold,".into(),
+            "fold, fold".into(),
+            "single-tape 5, fold".into(),
+            "single-tape 0".into(),
+            format!("single-tape {over}"),
+            "single-tape x".into(),
+            "single-tape".into(),
+            "two-symbol".into(),
+            "two-symbol a_".into(),
+            "two-symbol _aa".into(),
+            "unfold".into(),
+        ];
+        for val in &reduced {
+            let doc = parse_header_lines(&format!("version 2\nreduced {val}\nsteps 5\n"));
+            assert!(
+                doc.diagnostics.iter().any(|d| d.message.starts_with("expected `reduced`")),
+                "reduced {val:?}: {:?}",
+                doc.diagnostics
+            );
+            assert!(doc.header.is_none(), "reduced {val:?}");
+        }
+        for val in ["", "x", "-1"] {
+            let doc = parse_header_lines(&format!("version 2\nreduced fold\nsteps {val}\n"));
+            assert!(
+                doc.diagnostics.iter().any(|d| d.message.starts_with("expected `steps")),
+                "steps {val:?}: {:?}",
+                doc.diagnostics
+            );
+            assert!(doc.header.is_none(), "steps {val:?}");
+        }
+    }
+
+    #[test]
+    fn a_duplicate_reduced_or_steps_directive_is_an_error() {
+        for (lines, key) in [
+            ("version 2\nreduced fold\nreduced fold\nsteps 5\n", "reduced"),
+            ("version 2\nreduced fold\nsteps 5\nsteps 5\n", "steps"),
+        ] {
+            let doc = parse_header_lines(lines);
+            let want = format!("duplicate `{key}` directive");
+            assert!(doc.diagnostics.iter().any(|d| d.message == want), "{lines:?}: {:?}", doc.diagnostics);
+        }
+    }
+
+    /// A `version` line that does not parse is reported once. It says nothing about which version's rules
+    /// the rest of the header meant, so no version rule adds a diagnostic of its own.
+    #[test]
+    fn a_version_that_does_not_parse_adds_no_version_rule_diagnostic() {
+        let doc = parse_header_lines("version foo\nreduced fold\nsteps 5\n");
+        let messages: Vec<&str> = doc.diagnostics.iter().map(|d| d.message.as_str()).collect();
+        assert_eq!(messages, vec!["expected `version 1` or `version 2`, found `foo`"]);
+    }
+
+    /// A lone `reduced` or `steps`, with none of the four directives, must not read as "no header" — the
+    /// same reasoning as a stray `tape` or `version` line.
+    #[test]
+    fn a_lone_reduced_or_steps_without_a_header_is_a_diagnostic() {
+        for line in ["reduced fold", "steps 5"] {
+            let doc = parse_tm_full(&format!("tapes 1\nstart s\n{line}\n\nstate s: accept\n"));
+            assert!(doc.header.is_none(), "{line:?}");
+            assert!(
+                doc.diagnostics.iter().any(|d| d.message.contains("without a header")),
+                "{line:?}: {:?}",
+                doc.diagnostics
+            );
+        }
+    }
+
     /// Probed at `64c1164`: parses clean, and `scan` appears at 14, 25 and 66 while `halt`
     /// appears at 106 and 117. Three occurrences of one name is the point — an assertion that
     /// only checked the NAME would be satisfied by any of them.
diff --git a/crates/redextape-core/tests/tm_comments.rs b/crates/redextape-core/tests/tm_comments.rs
index 2eb4310..746692e 100644
--- a/crates/redextape-core/tests/tm_comments.rs
+++ b/crates/redextape-core/tests/tm_comments.rs
@@ -203,33 +203,41 @@ state q1: accept  ; done
 /// `Tape`'s trailing/displacement path in `an_authored_comment_takes_the_tape_line_over_the_generated_name`.
 #[test]
 fn printing_a_header_emits_a_comment_on_every_directive_variant() {
+    // Version 2, because `reduced` and `steps` exist only there, and a variant no fixture here could
+    // reach would be a directive whose comments nothing checks.
     const SRC: &str = "\
 tapes 2
 start q0
-version 1 ; the format version
+version 2 ; the format version
 ; how symbols pack
 encoding unary
 width 8 ; cells per tape
 slots 1 ; how many slots
 result Nat ; what comes back
+reduced single-tape 2 ; how it was reduced
+; how long it runs
+steps 40
 tape 1 #________#  ; second tape
 
 state q0: accept
 ";
 
     // `write_header` emits directives in its own fixed order (version, encoding, width, slots,
-    // result, then tape lines ascending) regardless of the order the fixture wrote them in — here
-    // that happens to match the source order too, but the expected string below follows the
-    // printer's order on principle, not the fixture's.
+    // result, reduced, steps, then tape lines ascending) regardless of the order the fixture wrote
+    // them in — here that happens to match the source order too, but the expected string below
+    // follows the printer's order on principle, not the fixture's.
     const EXPECTED: &str = "\
 tapes 2
 start q0
-version 1  ; the format version
+version 2  ; the format version
 ; how symbols pack
 encoding unary
 width 8  ; cells per tape
 slots 1  ; how many slots
 result Nat  ; what comes back
+reduced single-tape 2  ; how it was reduced
+; how long it runs
+steps 40
 tape 1 #________#  ; second tape
 
 state q0: accept
@@ -238,8 +246,8 @@ state q0: accept
     let d = parse_tm_full(SRC);
     assert_eq!(d.diagnostics, vec![], "fixture must parse clean");
 
-    // Precondition: every one of the six `TmDirective` variants is actually anchored by a comment
-    // here, source order preserved by the drain — so the assertion below is exercising all six
+    // Precondition: every one of the eight `TmDirective` variants is actually anchored by a comment
+    // here, source order preserved by the drain — so the assertion below is exercising all eight
     // and not silently exercising fewer.
     let anchors: Vec<(&str, TmAnchor, bool)> =
         d.comments.iter().map(|c| (c.text.as_str(), c.anchor, c.own_line)).collect();
@@ -251,6 +259,8 @@ state q0: accept
             ("cells per tape", TmAnchor::Directive(TmDirective::Width), false),
             ("how many slots", TmAnchor::Directive(TmDirective::Slots), false),
             ("what comes back", TmAnchor::Directive(TmDirective::Result), false),
+            ("how it was reduced", TmAnchor::Directive(TmDirective::Reduced), false),
+            ("how long it runs", TmAnchor::Directive(TmDirective::Steps), true),
             ("second tape", TmAnchor::Directive(TmDirective::Tape(1)), false),
         ]
     );
@@ -439,7 +449,8 @@ fn tape_line_cand() -> impl Strategy<Value = TapeLineCand> {
     })
 }
 
-/// The five single-line header directives that are not `tape` lines, each with its own slot.
+/// The five single-line header directives every header has that are not `tape` lines, each with its
+/// own slot.
 #[derive(Clone, Debug)]
 struct HeaderSlots {
     version: Slot,
@@ -459,10 +470,28 @@ fn header_slots() -> impl Strategy<Value = HeaderSlots> {
     })
 }
 
-/// A candidate header: `TmHeader`'s five directives plus up to `MAX_TAPE_LINES` candidate `tape`
-/// lines, one per index `0..MAX_TAPE_LINES` — rendered only for the indices actually below the
-/// document's `tapes` count, so every index used is in range, and each index has exactly one
-/// candidate, so none collide.
+/// Stage lists a `reduced` line may carry. Fixed rather than generated: what this file varies is where
+/// comments sit, and `tm/syntax.rs`'s tests hold the list grammar on their own.
+const STAGE_LISTS: [&str; 3] = ["fold", "single-tape 3, two-symbol _#1", "fold, single-tape 1, two-symbol _"];
+
+/// A candidate `reduced` and `steps` pair, which makes the header `version 2`, each line with its own slot.
+#[derive(Clone, Debug)]
+struct ReductionCand {
+    stages_idx: usize,
+    steps: u64,
+    reduced: Slot,
+    steps_slot: Slot,
+}
+
+fn reduction_cand() -> impl Strategy<Value = ReductionCand> {
+    (0usize..STAGE_LISTS.len(), 1u64..=1000, slot(), slot())
+        .prop_map(|(stages_idx, steps, reduced, steps_slot)| ReductionCand { stages_idx, steps, reduced, steps_slot })
+}
+
+/// A candidate header: `TmHeader`'s five directives, a reduced header's two more when `reduction` is
+/// `Some`, and up to `MAX_TAPE_LINES` candidate `tape` lines, one per index `0..MAX_TAPE_LINES` —
+/// rendered only for the indices actually below the document's `tapes` count, so every index used is
+/// in range, and each index has exactly one candidate, so none collide.
 #[derive(Clone, Debug)]
 struct HeaderCand {
     width: usize,
@@ -470,6 +499,7 @@ struct HeaderCand {
     encoding_binary: bool,
     result_idx: usize,
     lines: HeaderSlots,
+    reduction: Option<ReductionCand>,
     tape_lines: Vec<TapeLineCand>,
 }
 
@@ -480,24 +510,27 @@ fn header_cand() -> impl Strategy<Value = HeaderCand> {
         proptest::bool::ANY,
         0usize..RESULT_TYS.len(),
         header_slots(),
+        proptest::option::weighted(0.5, reduction_cand()),
         proptest::collection::vec(tape_line_cand(), MAX_TAPE_LINES),
     )
-        .prop_map(|(width, slots, encoding_binary, result_idx, lines, tape_lines)| HeaderCand {
+        .prop_map(|(width, slots, encoding_binary, result_idx, lines, reduction, tape_lines)| HeaderCand {
             width,
             slots,
             encoding_binary,
             result_idx,
             lines,
+            reduction,
             tape_lines,
         })
 }
 
 /// A whole candidate document: every position `print_tm_inner` can anchor a comment to, each with
-/// its own independently-drawn `Slot` — `Tapes`, `Start`, an optional header (reaching all six
+/// its own independently-drawn `Slot` — `Tapes`, `Start`, an optional header (reaching all eight
 /// `TmDirective` variants), up to `MAX_STATES` states each with up to `MAX_RULES` rules, and an EOF
 /// slot. Built so every rendering is diagnostic-free BY CONSTRUCTION — unique state names in
 /// definition order, in-range goto targets, matching rule arity, in-range and non-colliding tape
-/// indices, exactly the five required directives together or not at all — so the `prop_assume!` in
+/// indices, exactly the five required directives together or not at all, and `reduced` and `steps`
+/// together with `version 2` or neither with `version 1` — so the `prop_assume!` in
 /// the property below is a safety net, not the mechanism that keeps cases from being discarded.
 #[derive(Clone, Debug)]
 struct DocSpec {
@@ -542,12 +575,17 @@ fn render(spec: &DocSpec) -> String {
     emit(&mut src, &spec.start_slot, "", &format!("start q{}", spec.start));
 
     if let Some(h) = &spec.header {
-        emit(&mut src, &h.lines.version, "", "version 1");
+        let version = if h.reduction.is_some() { "version 2" } else { "version 1" };
+        emit(&mut src, &h.lines.version, "", version);
         let enc = if h.encoding_binary { "binary" } else { "unary" };
         emit(&mut src, &h.lines.encoding, "", &format!("encoding {enc}"));
         emit(&mut src, &h.lines.width, "", &format!("width {}", h.width));
         emit(&mut src, &h.lines.slots, "", &format!("slots {}", h.slots));
         emit(&mut src, &h.lines.result, "", &format!("result {}", RESULT_TYS[h.result_idx]));
+        if let Some(r) = &h.reduction {
+            emit(&mut src, &r.reduced, "", &format!("reduced {}", STAGE_LISTS[r.stages_idx]));
+            emit(&mut src, &r.steps_slot, "", &format!("steps {}", r.steps));
+        }
         for (idx, cand) in h.tape_lines.iter().enumerate() {
             if cand.include && idx < spec.tapes {
                 emit(&mut src, &cand.slot, "", &format!("tape {idx} {}", cand.cells));
@@ -602,7 +640,7 @@ tapes 2 ; tapes trailing
 ; about start
 start q0 ; start trailing
 ; about version
-version 1 ; version trailing
+version 2 ; version trailing
 ; about encoding
 encoding unary ; encoding trailing
 ; about width
@@ -611,6 +649,10 @@ width 8 ; width trailing
 slots 1 ; slots trailing
 ; about result
 result Nat ; result trailing
+; about reduced
+reduced fold ; reduced trailing
+; about steps
+steps 9 ; steps trailing
 ; about tape 1
 tape 1 #____# ; tape trailing
 
@@ -646,6 +688,10 @@ fn every_anchor_and_own_line_combination_reaches_a_fixed_point() {
             ("slots trailing", TmAnchor::Directive(TmDirective::Slots), false),
             ("about result", TmAnchor::Directive(TmDirective::Result), true),
             ("result trailing", TmAnchor::Directive(TmDirective::Result), false),
+            ("about reduced", TmAnchor::Directive(TmDirective::Reduced), true),
+            ("reduced trailing", TmAnchor::Directive(TmDirective::Reduced), false),
+            ("about steps", TmAnchor::Directive(TmDirective::Steps), true),
+            ("steps trailing", TmAnchor::Directive(TmDirective::Steps), false),
             ("about tape 1", TmAnchor::Directive(TmDirective::Tape(1)), true),
             ("tape trailing", TmAnchor::Directive(TmDirective::Tape(1)), false),
             ("about q0", TmAnchor::State(0), true),
@@ -661,7 +707,7 @@ fn every_anchor_and_own_line_combination_reaches_a_fixed_point() {
     // authored trailing comment on every anchor, including its one `tape` line, so `write_header`'s
     // generated-label path never fires for it — but the FIRST print does NOT equal `ALL_ANCHORS`
     // byte-for-byte: the source writes one space before each trailing `;` and `CommentWriter::trailing`
-    // writes two, so every one of the ten trailing-comment lines above differs by that one space. No
+    // writes two, so every one of the twelve trailing-comment lines above differs by that one space. No
     // assertion here depends on the first print matching the source; see
     // `printing_twice_after_a_reparse_is_idempotent`'s doc comment for why a literal round trip is
     // false in general.)
@@ -769,7 +815,7 @@ proptest! {
     /// because whatever changed is now indistinguishable, to the printer, from something the author
     /// wrote.
     ///
-    /// `doc_spec`/`render` still range over every `TmAnchor` variant — `Tapes`, `Start`, all six
+    /// `doc_spec`/`render` still range over every `TmAnchor` variant — `Tapes`, `Start`, all eight
     /// `TmDirective` variants, `State`, `Rule` and `Eof` — with both `own_line` values independently
     /// possible at each one (`Eof` excepted: the parser only ever drains it as `own_line: true`, so
     /// that is the one combination no document can produce). A typical case touches most of these at
````
<!-- END task2.patch -->

- [ ] **Step 3: Format check and lint**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo clippy --workspace --all-targets -- -D warnings 2>&1 | grep -E "^(warning|error)"; echo "clippy done"
```

Expected: `fmt exit 0` with no diff printed, and `clippy done` with no `warning` or `error` line before it.

- [ ] **Step 4: Run this task's tests**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core --lib --test tm_comments --test tm_header --test tm_header_proptest --test span_wellformed --test tm_foreign_reader -E 'test(/^tm::(header|syntax)::/) | binary_id(redextape-core::tm_comments) | binary_id(redextape-core::tm_header) | binary_id(redextape-core::tm_header_proptest) | binary_id(redextape-core::span_wellformed) | binary_id(redextape-core::tm_foreign_reader)' 2>&1 | grep -E "FAIL|Summary"
```

Expected summary line: `103 tests run: 103 passed, 835 skipped`

- [ ] **Step 5: Run the two text gates**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 493 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `471 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Read and write version 2 .tm headers, which record a reduction

A header whose reduction is Some prints as version 2, with a reduced
line listing its stages and a steps line after result. The stages come
in the order fold, single-tape, two-symbol, each at most once, each
with what undoing it needs: nothing for the fold, the tape count before
stage 1, and the two-symbol code's symbols, which run to the end of the
line because a symbol can be a comma. steps is 1 to 1,000,000,000. A
reduced header's tape lines carry no generated label.

The parser reads versions 1 and 2. Under version 1, written or absent,
a reduced or steps line is an error at that line; version 2 without
either is an error. TmDirective gains Reduced and Steps, and both keys
join the header dispatch and the comment anchors, with a malformed
value for each key refused by that key's own arm.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

- [ ] **Step 7: Run the sabotages, restoring after each**

The helper is Task 1 Step 7's `sab.py`. Run the whole block in a single Bash tool call, with a timeout of 600000 ms.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
PLAN="$P/docs/superpowers/plans/2026-09-15-reduced-tm-files.md"
S=/tmp/claude-1000/-home-davey-projects-redextape/c6a1cf33-0c42-448c-a0ee-76239e25a1eb/scratchpad/reduced-tm-exec
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
fast() { cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core --lib --test tm_comments --test tm_header --test tm_header_proptest --test span_wellformed --test tm_foreign_reader -E 'test(/^tm::(header|syntax)::/) | binary_id(redextape-core::tm_comments) | binary_id(redextape-core::tm_header) | binary_id(redextape-core::tm_header_proptest) | binary_id(redextape-core::span_wellformed) | binary_id(redextape-core::tm_foreign_reader)' --no-fail-fast 2>&1 | grep -E "^\s+FAIL \[|Summary|^error"; }
restore() { git -C "$P" checkout -- crates/ && git -C "${P:?}" clean -fdq -- crates/ && git -C "$P" status --short -- crates/; }
block_of sab.py >| "$S/sab.py"
H="$P/crates/redextape-core/src/tm/header.rs"
Y="$P/crates/redextape-core/src/tm/syntax.rs"

# T2-S1, the spec's last row: `reduced` and `steps` are accepted under version 1
python3 "$S/sab.py" "$H" '        if self.saw_version && self.version.is_none() {' '        if self.version != Some(REDUCED_HEADER_VERSION) {' && fast; restore

# T2-S2: version 2 does not require `reduced` and `steps`
python3 "$S/sab.py" "$H" '                .filter(|(_, seen)| seen.is_none())' '                .filter(|_| false)' && fast; restore

# T2-S3: `version 2` is refused
python3 "$S/sab.py" "$H" '                    (None, Ok(v)) if v == HEADER_VERSION || v == REDUCED_HEADER_VERSION => {' '                    (None, Ok(v)) if v == HEADER_VERSION => {' && fast; restore

# T2-S4: a `version` that did not parse still gets the version rules
python3 "$S/sab.py" "$H" '        if self.saw_version && self.version.is_none() {' '        if false {' && fast; restore

# T2-S5: `steps 0` is admitted
python3 "$S/sab.py" "$H" '                    (None, Ok(n)) if (1..=MAX_REDUCED_STEPS).contains(&n) => {' '                    (None, Ok(n)) if (0..=MAX_REDUCED_STEPS).contains(&n) => {' && fast; restore

# T2-S6: one step past the ceiling is admitted
python3 "$S/sab.py" "$H" '                    (None, Ok(n)) if (1..=MAX_REDUCED_STEPS).contains(&n) => {' '                    (None, Ok(n)) if (1..=MAX_REDUCED_STEPS + 1).contains(&n) => {' && fast; restore

# T2-S7: a stage list out of order or repeated is admitted
python3 "$S/sab.py" "$H" '    is_stage_list(&kinds).then_some(stages)' '    Some(stages)' && fast; restore

# T2-S8: a `single-tape` count outside its range is admitted
python3 "$S/sab.py" "$H" '                Stage::SingleTape { k: k.parse().ok().filter(|k| (1..=MAX_ENCODABLE_TAPES).contains(k))? }' '                Stage::SingleTape { k: k.parse().ok()? }' && fast; restore

# T2-S9: `two-symbol` symbols no code accepts are admitted
python3 "$S/sab.py" "$H" '            Code::from_symbols(&symbols)?;' '            let _ = Code::from_symbols(&symbols);' && fast; restore

# T2-S10, the known trap: `steps` is in the dispatch filter but has no arm
python3 "$S/sab.py" "$H" '            "steps" => {' '            "steps-unread" => {' && fast; restore

# T2-S11: a lone `reduced` with no header is dropped without a word
python3 "$S/sab.py" "$H" '            return if self.saw_tape || self.saw_version || self.saw_reduced.is_some() || self.saw_steps.is_some() {' '            return if self.saw_tape || self.saw_version || self.saw_steps.is_some() {' && fast; restore

# T2-S12: a duplicate `reduced` is accepted
python3 "$S/sab.py" "$H" '                    (Some(_), _) => Err("duplicate `reduced` directive".into()),' '                    (Some(_), _) => Ok(()),' && fast; restore

# T2-S13: a reduced header prints `version 1`
python3 "$S/sab.py" "$H" '    let version = if h.reduction.is_some() { REDUCED_HEADER_VERSION } else { HEADER_VERSION };' '    let version = HEADER_VERSION;' && fast; restore

# T2-S14: a reduced header's tape lines get generated labels
python3 "$S/sab.py" "$H" '        if h.reduction.is_none()' '        if true' && fast; restore

# T2-S15: the comma between stages carries no span
python3 "$S/sab.py" "$H" '            push_span(out, spans, ",", TokenClass::Punct);' '            out.push_str(",");' && fast; restore

# T2-S16: a comment on a `reduced` line anchors to `result`
python3 "$S/sab.py" "$Y" '        "reduced" => TmDirective::Reduced,' '        "reduced" => TmDirective::Result,' && fast; restore
```

Expected, as measured. The clean run is `103 tests run: 103 passed, 835 skipped`:

| row | sabotage | red | summary |
| --- | --- | --- | --- |
| T2-S1 | `reduced` and `steps` accepted under version 1 | `reduced_and_steps_are_errors_under_version_1` | `102 passed, 1 failed` |
| T2-S2 | version 2 does not require them | `version_2_requires_reduced_and_steps` | `102 passed, 1 failed` |
| T2-S3 | `version 2` refused | `a_reduced_header_round_trips_through_the_text_form`, `steps_is_refused_outside_one_to_its_ceiling_and_admitted_at_both_ends`, `version_2_requires_reduced_and_steps`, and `tm_comments.rs`'s `printing_a_header_emits_a_comment_on_every_directive_variant` and `every_anchor_and_own_line_combination_reaches_a_fixed_point` | `98 passed, 5 failed` |
| T2-S4 | an unparsed `version` still gets the rules | `a_version_that_does_not_parse_adds_no_version_rule_diagnostic` | `102 passed, 1 failed` |
| T2-S5 | `steps 0` admitted | `steps_is_refused_outside_one_to_its_ceiling_and_admitted_at_both_ends` | `102 passed, 1 failed` |
| T2-S6 | one step past the ceiling admitted | the same | `102 passed, 1 failed` |
| T2-S7 | a list out of order or repeated admitted | `a_malformed_value_for_each_new_key_is_refused_by_that_key` | `102 passed, 1 failed` |
| T2-S8 | a count outside its range admitted | the same | `102 passed, 1 failed` |
| T2-S9 | symbols no code accepts admitted | the same | `102 passed, 1 failed` |
| T2-S10 | the known trap: `steps` has no arm | the same, and `a_reduced_header_round_trips_through_the_text_form`, `steps_is_refused_outside_one_to_its_ceiling_and_admitted_at_both_ends`, `reduced_and_steps_are_errors_under_version_1`, `a_lone_reduced_or_steps_without_a_header_is_a_diagnostic`, `a_duplicate_reduced_or_steps_directive_is_an_error`, and `tm_comments.rs`'s two fixture tests | `95 passed, 8 failed` |
| T2-S11 | a lone `reduced` dropped | `a_lone_reduced_or_steps_without_a_header_is_a_diagnostic` | `102 passed, 1 failed` |
| T2-S12 | a duplicate `reduced` accepted | `a_duplicate_reduced_or_steps_directive_is_an_error` | `102 passed, 1 failed` |
| T2-S13 | a reduced header prints `version 1` | `a_reduced_header_prints_version_2_its_stages_and_steps_and_no_tape_label`, `a_reduced_header_classifies_every_token`, `a_reduced_header_round_trips_through_the_text_form`, and `tm_comments.rs`'s two fixture tests and `printing_twice_after_a_reparse_is_idempotent` | `97 passed, 6 failed` |
| T2-S14 | a reduced header's tape lines labelled | `a_reduced_header_prints_version_2_its_stages_and_steps_and_no_tape_label`, `a_reduced_header_classifies_every_token` | `101 passed, 2 failed` |
| T2-S15 | the comma carries no span | `a_reduced_header_classifies_every_token` | `102 passed, 1 failed` |
| T2-S16 | a comment on `reduced` anchors to `result` | `tm_comments.rs`'s two fixture tests and `printing_twice_after_a_reparse_is_idempotent` | `100 passed, 3 failed` |

The block took 34 s, starting at a load average of 0.87.

---

### Task 3: `tm/reduced_file.rs`, producing and decoding a reduced file

**Files:**
- Create: `crates/redextape-core/src/tm/reduced_file.rs` — `reduce`, `reduce_within`, `ReduceError`, `decode_reduced`
- Modify: `crates/redextape-core/src/tm/sim.rs` — `simulate_origins`, and `Tape::from_snapshot`
- Modify: `crates/redextape-core/src/tm.rs` — `pub mod reduced_file;` between `pub mod one_way;` and `pub mod reduction;`, and re-exports
- Modify: `crates/redextape-core/tests/common/mod.rs` — `run_with_origins` reads its origins from `simulate_origins`
- Create: `crates/redextape-core/tests/reduced_tm_file.rs` — end to end, through the printed text

**What changes.**
1. **`reduce_within(d, stages, ceiling, max_steps)`** refuses a stage list `is_stage_list` refuses, then a run that is not `TmRun::Ran`. It applies the stages in order, checking `refusal` after each, so no layout is built for a refusal's one tape:
   - fold: `to_one_way_within`, then `zigzag`, whose `None` is `ReduceError::Layout`;
   - single-tape: `to_single_tape_within`, then `layout_collision` on the machine and its tapes, then `interleave` padded by `pads`;
   - two-symbol: `Code::new`, `to_two_symbol_within`, then `bitify`, whose `None` cannot happen here because the code is built from those tapes.
2. **`pads`** runs the machine stage 1 receives through `simulate_origins`, which counts each tape's growth on its left. The skeleton then reaches exactly the cells the run's heads visit: the largest left growth on the left, and on the right the farthest cell from any origin beyond the longest initial tape. `PAD_MARGIN` is `0`, measured: every reduction this plan runs across the corpus verified with no margin at all.
3. **Verification.** The reduced machine runs under `max_steps`, and must halt in an accept state after at least one step. Its tapes, every stage undone by `decode_reduced`, must decode to what the lowered run's tapes decode to. Anything else is `ReduceError::Unverified`. `reduce` is `reduce_within` at `MAX_MACHINE_STATES` and `MAX_REDUCED_STEPS`.
4. **`decode_reduced(tapes, h)`** decodes a lowered header as `decode_tape_ty_reason` does. For a reduced header it undoes the stages last first: `unbitify` through `Code::from_symbols`, `deinterleave` of the one tape, `unzigzag`. A tape that does not undo is `DecodeFailure::Mismatch`. `Tape::from_snapshot` rebuilds each undone tape with its head, since `unzigzag` refuses a head on physical cell 0.

**Tests:**
- In `reduced_file.rs`, on hand-built five-tape runs and on tapes stage 1 really produces: a non-canonical stage list, an unfinished run, each stage refusing at a ceiling of one state, a layout symbol on an initial tape, the fold's marker on an initial tape, a value the reduction does not reproduce, a halt outside an accept state, an accept before any step, the step ceiling each way, the exact pads of a known walk, a lowered header decoding as before, and every inverse refusing tapes its stage did not produce.
- In `sim.rs`: `from_snapshot` inverts `snapshot` at every head, and fills blanks past the end.
- In `reduced_tm_file.rs`: six stage subsets of `5 - 3` reduced, printed, parsed back to the same machine and header, run under the header's own `steps` to an accept state in exactly that many steps, and decoded to the reference interpreter's value. **Its value is 2, not 0**, because the spec's first sabotage row, reversing two symbols in the header's `two-symbol` run, stays green on a program whose value is 0. All three stages on `5 - 3` and on three larger programs, and stage 1 on a recursive sum, are in the slow tier.

**Interfaces:**
- Consumes: Task 2's `Reduction`, `Stage`, `StageKind`, `is_stage_list`, `MAX_REDUCED_STEPS` and `TmHeader::reduction`; Task 1's `Code::from_symbols`.
- Produces, in `crate::tm::reduced_file` and re-exported from `crate::tm`:
  - `pub enum ReduceError { StageList, NotRan, Refused(&'static str), LayoutCollision(Symbol), Layout, Unverified }`
  - `pub fn reduce(d: &DescribedRun, stages: &[StageKind]) -> Result<(Machine, TmHeader), ReduceError>`
  - `pub fn decode_reduced(tapes: &[Tape], h: &TmHeader) -> Result<Value, DecodeFailure>`
- Produces, crate-private: `reduce_within(d: &DescribedRun, stages: &[StageKind], ceiling: usize, max_steps: u64)`.
- Produces, in `crate::tm::sim`: `pub fn simulate_origins(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<Tape>, Vec<usize>, StateId, Status, u64)`, and the crate-private `Tape::from_snapshot(cells: &[Symbol], head: usize) -> Tape`.

- [ ] **Step 1: Confirm Task 2 is the last commit and nothing is pending**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD -- crates/ grammars/ && git -C "$P" diff --cached --quiet -- crates/ grammars/ && echo clean
```

Expected: a line ending `Read and write version 2 .tm headers, which record a reduction`, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
PLAN="$P/docs/superpowers/plans/2026-09-15-reduced-tm-files.md"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
block_of task3.patch | git -C "$P" apply --index --check && block_of task3.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/tm.rs                |   2 +
 crates/redextape-core/src/tm/reduced_file.rs   | 373 +++++++++++++++++++++++++
 crates/redextape-core/src/tm/sim.rs            |  56 ++++
 crates/redextape-core/tests/common/mod.rs      |  33 +--
 crates/redextape-core/tests/reduced_tm_file.rs | 105 +++++++
 5 files changed, 545 insertions(+), 24 deletions(-)
```

<!-- BEGIN task3.patch -->
````diff
diff --git a/crates/redextape-core/src/tm.rs b/crates/redextape-core/src/tm.rs
index f2ba9a9..e5b9920 100644
--- a/crates/redextape-core/src/tm.rs
+++ b/crates/redextape-core/src/tm.rs
@@ -17,6 +17,7 @@ pub mod lower_asm;
 pub mod lower_tm;
 pub mod machine;
 pub mod one_way;
+pub mod reduced_file;
 pub mod reduction;
 pub mod sim;
 pub mod single_tape;
@@ -45,6 +46,7 @@ pub use header::{
 pub use lower_asm::{LowerError, lower_asm, lower_asm_mapped};
 pub use lower_tm::{lower_tm, lower_tm_guarded, lower_tm_mapped, n_slots_of};
 pub use machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
+pub use reduced_file::{ReduceError, decode_reduced, reduce};
 pub use sim::{
     Caps as TmCaps, DEFAULT_CAPS as TM_DEFAULT_CAPS, Status as TmStatus, Step, Tape, Trace, Watcher, simulate,
     simulate_counts, simulate_final, simulate_trace, simulate_watched,
diff --git a/crates/redextape-core/src/tm/reduced_file.rs b/crates/redextape-core/src/tm/reduced_file.rs
new file mode 100644
index 0000000..bf1a716
--- /dev/null
+++ b/crates/redextape-core/src/tm/reduced_file.rs
@@ -0,0 +1,373 @@
+//! Reduced `.tm` files: a lowered machine after any of the three reductions, written so that the file
+//! alone runs and decodes to the program's value.
+//!
+//! [`reduce`] applies the stages a caller names to a [`DescribedRun`], checks the result by running it,
+//! and returns the reduced machine with its `version 2` header. [`decode_reduced`] undoes a header's
+//! stages on a run's final tapes and decodes the value. The header's text form belongs to `header.rs`.
+
+use crate::tm::DescribedRun;
+use crate::tm::TmRun;
+use crate::tm::asm::DecodeFailure;
+use crate::tm::build::MAX_MACHINE_STATES;
+use crate::tm::decode::decode_tape_ty_reason;
+use crate::tm::header::{MAX_REDUCED_STEPS, Reduction, Stage, StageKind, TmHeader, is_stage_list};
+use crate::tm::machine::{Machine, Symbol};
+use crate::tm::one_way::{to_one_way_within, unzigzag, zigzag};
+use crate::tm::reduction::refusal;
+use crate::tm::sim::{Caps, DEFAULT_CAPS, Tape, simulate_final, simulate_origins};
+use crate::tm::single_tape::{deinterleave, interleave, layout_collision, to_single_tape_within};
+use crate::tm::two_symbol::{Code, bitify, to_two_symbol_within, unbitify};
+use crate::value::Value;
+
+/// Blocks of stage 1's skeleton beyond the cells the measuring run's heads visit, on each side.
+const PAD_MARGIN: usize = 0;
+
+/// Why [`reduce`] produced no file.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub enum ReduceError {
+    /// The stage list is empty, out of order, or repeats a stage: [`is_stage_list`] refuses it.
+    StageList,
+    /// The run did not end in `TmRun::Ran`, so there is no value to check a reduction against.
+    NotRan,
+    /// A stage refused, under the name [`refusal`] gives.
+    Refused(&'static str),
+    /// A symbol on the machine or its tapes that the single-tape layout reserves.
+    LayoutCollision(Symbol),
+    /// An initial tape a stage cannot lay out: one holding the fold's marker, or one with a symbol the
+    /// two-symbol code does not cover. The second cannot happen here, because the code is built from the
+    /// tapes it encodes; it is an error rather than a panic so that the library path cannot panic.
+    Layout,
+    /// The reduced machine did not halt in an accept state within the step ceiling, took no step, or its
+    /// tapes did not decode to the value the lowered run's tapes decode to.
+    Unverified,
+}
+
+/// Reduce `d`'s machine through `stages`, verify it, and return it with its header.
+///
+/// # Errors
+///
+/// [`ReduceError`], and nothing is produced: a stage list [`is_stage_list`] refuses, a run that did not
+/// end in `TmRun::Ran`, a stage's refusal, a layout collision or unlayable tape, or a reduced machine
+/// that does not reproduce the lowered run's value within `MAX_REDUCED_STEPS` steps.
+pub fn reduce(d: &DescribedRun, stages: &[StageKind]) -> Result<(Machine, TmHeader), ReduceError> {
+    reduce_within(d, stages, MAX_MACHINE_STATES, MAX_REDUCED_STEPS)
+}
+
+/// [`reduce`] under a caller's state ceiling and step ceiling, so a test can trip either on a machine
+/// small enough to run in the fast tier.
+///
+/// **THE STAGES RUN IN [`StageKind::ALL`]'S ORDER, AND A REFUSAL IS CHECKED AFTER EACH ONE.** A later
+/// stage would hand a refusal back unchanged, but its layout would be built for the refused machine's
+/// one tape rather than the tapes it was given.
+///
+/// **THE VALUE IS CHECKED, NOT ONLY THE HALT.** The reduced machine runs under `max_steps`, must stop in an
+/// accept state after at least one step, and its tapes, with every stage undone, must decode to what the
+/// lowered run's tapes decode to. A capped run stops in a state that is not an accept, since the cursor
+/// checks for an accept before the cap, so the accept check covers the cap too.
+pub(crate) fn reduce_within(
+    d: &DescribedRun,
+    stages: &[StageKind],
+    ceiling: usize,
+    max_steps: u64,
+) -> Result<(Machine, TmHeader), ReduceError> {
+    if !is_stage_list(stages) {
+        return Err(ReduceError::StageList);
+    }
+    let TmRun::Ran { tapes: lowered } = &d.run else { return Err(ReduceError::NotRan) };
+    let caps = Caps { steps: max_steps, cells: DEFAULT_CAPS.cells };
+    let mut m = d.machine.clone();
+    let mut inits = d.header.init(m.tapes);
+    let mut done = Vec::with_capacity(stages.len());
+    for &kind in stages {
+        let (next, next_inits, stage) = match kind {
+            StageKind::Fold => {
+                let folded = unrefused(to_one_way_within(&m, ceiling).0)?;
+                (folded, zigzag(&inits, m.tapes).ok_or(ReduceError::Layout)?, Stage::Fold)
+            }
+            StageKind::SingleTape => {
+                let single = unrefused(to_single_tape_within(&m, ceiling).0)?;
+                if let Some(s) = layout_collision(&m, &inits) {
+                    return Err(ReduceError::LayoutCollision(s));
+                }
+                let (left, right) = pads(&m, &inits, caps).ok_or(ReduceError::Unverified)?;
+                (single, vec![interleave(&inits, m.tapes, left, right)], Stage::SingleTape { k: m.tapes })
+            }
+            StageKind::TwoSymbol => {
+                let code = Code::new(&m, &inits);
+                let reduced = unrefused(to_two_symbol_within(&m, &code, ceiling).0)?;
+                let bits = bitify(&inits, &code).ok_or(ReduceError::Layout)?;
+                (reduced, bits, Stage::TwoSymbol { symbols: code.symbols().to_vec() })
+            }
+        };
+        (m, inits) = (next, next_inits);
+        done.push(stage);
+    }
+
+    let (tapes, state, _status, steps) = simulate_final(&m, &inits, caps);
+    if steps == 0 || !m.states.get(state as usize).is_some_and(|s| s.accept) {
+        return Err(ReduceError::Unverified);
+    }
+    let want = decode_tape_ty_reason(lowered, &d.header.result, &*d.header.encoding());
+    let tapes_by_index = inits.into_iter().enumerate().collect();
+    let mut header =
+        TmHeader::new(d.header.encoding, d.header.width, d.header.slots, d.header.result.clone(), tapes_by_index);
+    header.reduction = Some(Reduction { stages: done, steps });
+    match (decode_reduced(&tapes, &header), want) {
+        (Ok(got), Ok(want)) if got == want => Ok((m, header)),
+        _ => Err(ReduceError::Unverified),
+    }
+}
+
+/// `m`, or the error naming its refusal.
+fn unrefused(m: Machine) -> Result<Machine, ReduceError> {
+    match refusal(&m) {
+        Some(name) => Err(ReduceError::Refused(name)),
+        None => Ok(m),
+    }
+}
+
+/// The blocks stage 1's skeleton needs left of cell 0 and right of the longest initial tape, from a run of
+/// `m` itself: a head that leaves the skeleton halts the single-tape machine in `OVERFLOW`, so the skeleton
+/// must reach every cell a head visits, plus [`PAD_MARGIN`].
+///
+/// A `Tape` materializes a cell only when a head reaches it and never discards one, so after the run the
+/// cells left of a tape's origin are the cells its head visited there, and the cells from the origin on are
+/// its initial contents or the farthest cell its head reached, whichever is longer. `None` when the run
+/// does not halt within `caps`.
+fn pads(m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> Option<(usize, usize)> {
+    let (tapes, origins, _state, status, _steps) = simulate_origins(m, inits, caps);
+    if status != crate::tm::sim::Status::Halted {
+        return None;
+    }
+    let left = origins.iter().copied().max().unwrap_or(0);
+    let right = tapes.iter().zip(&origins).map(|(t, o)| t.cells().saturating_sub(*o)).max().unwrap_or(0);
+    let longest = inits.iter().map(Vec::len).max().unwrap_or(0).max(1);
+    Some((left + PAD_MARGIN, right.saturating_sub(longest) + PAD_MARGIN))
+}
+
+/// The value `tapes` hold under `h`: decoded as they are for a lowered header, and with every stage undone
+/// in reverse for a reduced one.
+///
+/// # Errors
+///
+/// `DecodeFailure::Mismatch` when a stage cannot be undone — the tapes disagree with the header's own
+/// stages — and otherwise whatever `decode_tape_ty_reason` answers on the undone tapes.
+pub fn decode_reduced(tapes: &[Tape], h: &TmHeader) -> Result<Value, DecodeFailure> {
+    let Some(r) = &h.reduction else { return decode_tape_ty_reason(tapes, &h.result, &*h.encoding()) };
+    let mut undone: Option<Vec<Tape>> = None;
+    for stage in r.stages.iter().rev() {
+        let current = undone.as_deref().unwrap_or(tapes);
+        undone = Some(undo(stage, current).ok_or(DecodeFailure::Mismatch)?);
+    }
+    decode_tape_ty_reason(undone.as_deref().unwrap_or(tapes), &h.result, &*h.encoding())
+}
+
+/// One stage's inverse over a run's tapes, or `None` when they are not tapes that stage produces.
+///
+/// **THE HEAD SURVIVES EVERY STAGE BUT THE FOLD.** `unzigzag` refuses a head on physical cell 0, so a
+/// folded tape rebuilt from an earlier inverse must carry its head; decoding a value reads no head at all,
+/// so the fold's own inverse drops it.
+fn undo(stage: &Stage, tapes: &[Tape]) -> Option<Vec<Tape>> {
+    match stage {
+        Stage::TwoSymbol { symbols } => {
+            let code = Code::from_symbols(symbols)?;
+            tapes.iter().map(|t| unbitify(t, &code).map(|(cells, head)| Tape::from_snapshot(&cells, head))).collect()
+        }
+        Stage::SingleTape { k } => {
+            let [tape] = tapes else { return None };
+            Some(deinterleave(tape, *k)?.iter().map(|(cells, head)| Tape::from_snapshot(cells, *head)).collect())
+        }
+        Stage::Fold => tapes.iter().map(|t| unzigzag(t).map(|s| Tape::new(&s.cells))).collect(),
+    }
+}
+
+#[cfg(test)]
+mod tests {
+    use super::*;
+    use crate::tm::build::{REG, TAPES};
+    use crate::tm::header::EncodingKind;
+    use crate::tm::machine::{Move, Rule, State};
+    use crate::tm::one_way::LEFT_END;
+    use crate::tm::reduction::TOO_MANY_STATES;
+    use crate::tm::single_tape::head_away;
+    use crate::ty::Ty;
+
+    /// A REG bank that decodes, under `Unary` at width 4, to `Nat(0)`, or to `Nat(1)` with `mark`.
+    fn bank(mark: bool) -> Vec<Symbol> {
+        vec!['#', if mark { '1' } else { '_' }, '_', '_', '_', '#']
+    }
+
+    /// `walk` states on `TAPES` tapes, each moving every head in `moves` order, then `last`.
+    fn walk(moves: &[Move], last: State) -> Machine {
+        let mut states: Vec<State> = moves
+            .iter()
+            .enumerate()
+            .map(|(i, mv)| State {
+                name: format!("w{i}"),
+                accept: false,
+                rules: vec![Rule {
+                    read: vec![None; TAPES],
+                    write: vec![None; TAPES],
+                    moves: vec![*mv; TAPES],
+                    next: u32::try_from(i + 1).unwrap_or(0),
+                }],
+            })
+            .collect();
+        states.push(last);
+        Machine { states, start: 0, tapes: TAPES }
+    }
+
+    fn accept() -> State {
+        State { name: "done".into(), accept: true, rules: vec![] }
+    }
+
+    /// `m` run on a REG tape holding `reg`, described as `run_tm_described` would describe it: a hand-built
+    /// lowered run, so a ceiling can be tripped without lowering a program.
+    fn run_of(m: Machine, reg: Vec<Symbol>) -> DescribedRun {
+        let header = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![(REG, reg)]);
+        let (tapes, _state, _status, steps) = simulate_final(&m, &header.init(m.tapes), DEFAULT_CAPS);
+        DescribedRun { run: TmRun::Ran { tapes }, machine: m, header, steps }
+    }
+
+    #[test]
+    fn a_stage_list_that_is_not_canonical_is_refused() {
+        let d = run_of(walk(&[Move::R], accept()), bank(false));
+        for stages in [&[][..], &[StageKind::SingleTape, StageKind::Fold][..], &[StageKind::Fold, StageKind::Fold][..]]
+        {
+            assert_eq!(reduce(&d, stages), Err(ReduceError::StageList), "{stages:?}");
+        }
+    }
+
+    #[test]
+    fn a_run_that_did_not_finish_is_refused() {
+        for run in [TmRun::HitCap, TmRun::Overflow] {
+            let mut d = run_of(walk(&[Move::R], accept()), bank(false));
+            d.run = run;
+            assert_eq!(reduce(&d, &[StageKind::Fold]), Err(ReduceError::NotRan), "{:?}", d.run);
+        }
+    }
+
+    /// Each stage alone under a ceiling of one state, so a stage that stopped passing the ceiling on is
+    /// the one whose row fails.
+    #[test]
+    fn every_stage_refuses_at_its_state_ceiling() {
+        let d = run_of(walk(&[Move::R], accept()), bank(false));
+        for kind in StageKind::ALL {
+            assert_eq!(
+                reduce_within(&d, &[kind], 1, MAX_REDUCED_STEPS),
+                Err(ReduceError::Refused(TOO_MANY_STATES)),
+                "{kind:?}"
+            );
+        }
+    }
+
+    /// `to_single_tape` sees only the machine's alphabet; a marker arriving on an initial tape is the
+    /// collision `layout_collision` exists for.
+    #[test]
+    fn a_layout_symbol_on_an_initial_tape_is_a_collision() {
+        let marker = head_away(0);
+        let d = run_of(walk(&[Move::R], accept()), vec!['#', marker, '#']);
+        assert_eq!(reduce(&d, &[StageKind::SingleTape]), Err(ReduceError::LayoutCollision(marker)));
+    }
+
+    #[test]
+    fn the_folds_marker_on_an_initial_tape_cannot_be_laid_out() {
+        let d = run_of(walk(&[Move::R], accept()), vec!['#', LEFT_END, '#']);
+        assert_eq!(reduce(&d, &[StageKind::Fold]), Err(ReduceError::Layout));
+    }
+
+    #[test]
+    fn a_reduction_that_does_not_reproduce_the_lowered_value_is_unverified() {
+        let mut d = run_of(walk(&[Move::R], accept()), bank(false));
+        assert!(reduce(&d, &[StageKind::Fold]).is_ok(), "the fixture reduces while the values agree");
+        d.run = run_of(walk(&[Move::R], accept()), bank(true)).run;
+        assert_eq!(reduce(&d, &[StageKind::Fold]), Err(ReduceError::Unverified));
+    }
+
+    #[test]
+    fn a_reduced_machine_that_halts_outside_an_accept_state_is_unverified() {
+        let stuck = State { name: "stuck".into(), accept: false, rules: vec![] };
+        let d = run_of(walk(&[Move::R], stuck), bank(false));
+        assert_eq!(reduce(&d, &[StageKind::Fold]), Err(ReduceError::Unverified));
+    }
+
+    /// A `steps 0` line does not parse, so a reduction that accepts before its first step has no file.
+    #[test]
+    fn a_reduced_machine_that_accepts_before_a_step_is_unverified() {
+        let d = run_of(walk(&[], accept()), bank(false));
+        assert_eq!(reduce(&d, &[StageKind::TwoSymbol]), Err(ReduceError::Unverified));
+    }
+
+    #[test]
+    fn a_reduced_machine_is_held_to_the_step_ceiling_it_is_given() {
+        let d = run_of(walk(&[Move::R; 20], accept()), bank(false));
+        assert_eq!(reduce_within(&d, &[StageKind::Fold], MAX_MACHINE_STATES, 10), Err(ReduceError::Unverified));
+        assert!(reduce_within(&d, &[StageKind::Fold], MAX_MACHINE_STATES, 1_000).is_ok());
+    }
+
+    /// Three cells left of cell 0, and the farthest head at cell 6 of a longest initial tape of 6 cells, is
+    /// three blocks on the left and one on the right.
+    #[test]
+    fn the_skeleton_reaches_every_cell_a_head_visits() {
+        let mut moves = vec![Move::L; 3];
+        moves.extend([Move::R; 9]);
+        let m = walk(&moves, accept());
+        let inits = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![(REG, bank(false))]).init(TAPES);
+        assert_eq!(pads(&m, &inits, DEFAULT_CAPS), Some((3 + PAD_MARGIN, 1 + PAD_MARGIN)));
+        let looping = Machine {
+            states: vec![State {
+                name: "loop".into(),
+                accept: false,
+                rules: vec![Rule {
+                    read: vec![None; TAPES],
+                    write: vec![None; TAPES],
+                    moves: vec![Move::S; TAPES],
+                    next: 0,
+                }],
+            }],
+            start: 0,
+            tapes: TAPES,
+        };
+        assert_eq!(
+            pads(&looping, &inits, Caps { steps: 10, cells: DEFAULT_CAPS.cells }),
+            None,
+            "a run that does not halt"
+        );
+    }
+
+    #[test]
+    fn a_lowered_header_decodes_as_it_always_has() {
+        let d = run_of(walk(&[Move::R], accept()), bank(true));
+        let TmRun::Ran { tapes } = &d.run else { panic!("run_of always runs") };
+        let want = decode_tape_ty_reason(tapes, &d.header.result, &*d.header.encoding());
+        assert_eq!(want, Ok(Value::Nat(1)), "the fixture decodes");
+        assert_eq!(decode_reduced(tapes, &d.header), want);
+    }
+
+    /// Each inverse, handed tapes its stage never produces, is a mismatch rather than a guess.
+    #[test]
+    fn tapes_a_stage_did_not_produce_are_a_mismatch() {
+        let mut h = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![]);
+        let plain = || vec![Tape::new(&['#', '_', '#'])];
+        // A tape stage 1 really produces, from the bank `run_of` runs on. The pair below is then refused
+        // for holding two tapes, not for holding one that would not have split anyway.
+        let interleaved = || vec![Tape::new(&interleave(&[bank(false)], TAPES, 0, 0))];
+        h.reduction = Some(Reduction { stages: vec![Stage::SingleTape { k: TAPES }], steps: 1 });
+        assert_eq!(decode_reduced(&interleaved(), &h), Ok(Value::Nat(0)), "that one tape alone decodes");
+        let cases: [(&str, Stage, Vec<Tape>); 5] = [
+            ("a fold with no marker at cell 0", Stage::Fold, plain()),
+            ("a single tape with no sentinels", Stage::SingleTape { k: 1 }, plain()),
+            (
+                "two tapes, the first of which decodes alone",
+                Stage::SingleTape { k: TAPES },
+                [interleaved(), plain()].concat(),
+            ),
+            ("a code that does not rebuild", Stage::TwoSymbol { symbols: vec!['a'] }, plain()),
+            ("a cell that is not a bit", Stage::TwoSymbol { symbols: vec!['_', '#'] }, plain()),
+        ];
+        for (what, stage, tapes) in cases {
+            h.reduction = Some(Reduction { stages: vec![stage], steps: 1 });
+            assert_eq!(decode_reduced(&tapes, &h), Err(DecodeFailure::Mismatch), "{what}");
+        }
+    }
+}
diff --git a/crates/redextape-core/src/tm/sim.rs b/crates/redextape-core/src/tm/sim.rs
index 0838c43..eda29ae 100644
--- a/crates/redextape-core/src/tm/sim.rs
+++ b/crates/redextape-core/src/tm/sim.rs
@@ -76,6 +76,16 @@ impl Tape {
         (cells, head)
     }
 
+    /// The inverse of [`Tape::snapshot`]: a tape holding `cells` with its head on index `head`. A head past
+    /// the end reads `BLANK`, with `BLANK` cells up to it, as a head that walked there would leave them.
+    #[must_use]
+    pub(crate) fn from_snapshot(cells: &[Symbol], head: usize) -> Tape {
+        let mut left: Vec<Symbol> = cells.iter().take(head).copied().collect();
+        left.resize(head, BLANK);
+        let right = cells.iter().skip(head.saturating_add(1)).rev().copied().collect();
+        Tape { left, head: cells.get(head).copied().unwrap_or(BLANK), right }
+    }
+
     /// The head's index into the tape *as currently materialized* — `left.len()` cells lie to its
     /// left. O(1), unlike `snapshot`, which clones the whole tape before computing the same value; a
     /// per-step caller (`viewmodel::TmState::window`) cannot pay that cost just to learn this index.
@@ -304,6 +314,38 @@ pub fn simulate_watched(
     (tapes, final_state, status)
 }
 
+/// Simulate, also counting how many cells each tape grew on its left: the index its starting cell 0 ends
+/// at in [`Tape::snapshot`]'s coordinates, which a `Tape` does not record.
+///
+/// **A TAPE GROWS ON ITS LEFT EXACTLY WHEN, AFTER A STEP, IT HOLDS MORE CELLS AND ITS HEAD IS AT INDEX 0.**
+/// A step moves a head at most one cell, so a tape grows by at most one; growth on the right leaves the
+/// head at index 1 or beyond.
+#[must_use]
+pub fn simulate_origins(
+    m: &Machine,
+    init: &[Vec<Symbol>],
+    caps: Caps,
+) -> (Vec<Tape>, Vec<usize>, StateId, Status, u64) {
+    let mut cells: Vec<usize> = (0..m.tapes).map(|i| init.get(i).map_or(1, |t| t.len().max(1))).collect();
+    let mut origins = vec![0usize; m.tapes];
+    let (tapes, state, status, steps) = {
+        let mut watch = |tapes: &[Tape]| {
+            for (i, t) in tapes.iter().enumerate() {
+                if let (Some(before), Some(origin)) = (cells.get_mut(i), origins.get_mut(i)) {
+                    let now = t.cells();
+                    if now > *before && t.head_index() == 0 {
+                        *origin += 1;
+                    }
+                    *before = now;
+                }
+            }
+            true
+        };
+        run(m, init, caps, None, None, Some(&mut watch))
+    };
+    (tapes, origins, state, status, steps)
+}
+
 /// Simulate, recording every step (before it is applied) for the scrubbable trace / view models.
 pub fn simulate_trace(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> Trace {
     let mut steps = Vec::new();
@@ -329,6 +371,20 @@ mod tests {
     use super::*;
     use crate::tm::machine::State;
 
+    #[test]
+    fn from_snapshot_inverts_snapshot_at_every_head() {
+        let cells = vec!['a', 'b', 'c'];
+        for head in 0..cells.len() {
+            assert_eq!(Tape::from_snapshot(&cells, head).snapshot(), (cells.clone(), head), "head {head}");
+        }
+    }
+
+    /// Past the end, the tape reads what a head that walked there would have left: blanks up to it.
+    #[test]
+    fn from_snapshot_past_the_end_fills_blanks_up_to_the_head() {
+        assert_eq!(Tape::from_snapshot(&['a'], 3).snapshot(), (vec!['a', BLANK, BLANK, BLANK], 3));
+    }
+
     fn increment() -> Machine {
         Machine {
             tapes: 1,
diff --git a/crates/redextape-core/tests/common/mod.rs b/crates/redextape-core/tests/common/mod.rs
index 6f64388..6970bc5 100644
--- a/crates/redextape-core/tests/common/mod.rs
+++ b/crates/redextape-core/tests/common/mod.rs
@@ -29,7 +29,7 @@ use redextape_core::desugar::desugar;
 use redextape_core::parser::parse;
 use redextape_core::tm::machine::{Move, Rule, State, StateId};
 use redextape_core::tm::one_way::OriginSnapshot;
-use redextape_core::tm::sim::{Caps, Status, Tape, simulate_watched};
+use redextape_core::tm::sim::{Caps, Status, simulate_origins};
 use redextape_core::tm::{
     AT, BLANK, BOX, Encoding, EncodingKind, Machine, REG, SEP, Symbol, TM_DEFAULT_CAPS, TmRun, WORK, run_tm_described,
 };
@@ -345,33 +345,18 @@ pub fn stack_is_empty(cells: &[char]) -> Result<(), String> {
     }
 }
 
-/// Run `m` and record where each tape's origin ends up in its final snapshot.
+/// Run `m` and record where each tape's origin ends up in its final snapshot, from the count of left
+/// growths `sim.rs`'s `simulate_origins` keeps.
 ///
-/// **A TAPE GROWS ON ITS LEFT EXACTLY WHEN, AFTER A STEP, IT IS LONGER AND ITS HEAD IS AT INDEX 0.** A
-/// step moves a head at most one cell, so a tape grows by at most one; growth on the right leaves the
-/// head at index 1 or beyond. The count of left growths is the origin's index. `slice(0, usize::MAX)`
-/// is the tape's length, O(tape) per step.
+/// **SOUND AS AN INSTRUMENT FOR THE FOLD, THOUGH THE LIBRARY COUNTS THE ORIGINS.** The fold's side of each
+/// comparison finds its origin from the zig-zag layout, not from growth, so an origin count that went wrong
+/// would disagree with it rather than agree.
 pub fn run_with_origins(m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> (Vec<OriginSnapshot>, StateId, Status, u64) {
-    let mut len: Vec<usize> = (0..m.tapes).map(|i| inits.get(i).map_or(1, |t| t.len().max(1))).collect();
-    let mut grown = vec![0usize; m.tapes];
-    let mut steps = 0u64;
-    let (tapes, state, status) = {
-        let mut watch = |tapes: &[Tape]| {
-            steps += 1;
-            for (i, t) in tapes.iter().enumerate() {
-                let l = t.slice(0, usize::MAX).len();
-                if l > len[i] && t.head_index() == 0 {
-                    grown[i] += l - len[i];
-                }
-                len[i] = l;
-            }
-            true
-        };
-        simulate_watched(m, inits, caps, &mut watch)
-    };
+    let (tapes, origins, state, status, steps) = simulate_origins(m, inits, caps);
+    assert_eq!(tapes.len(), origins.len(), "one origin per tape");
     let snaps = tapes
         .iter()
-        .zip(&grown)
+        .zip(&origins)
         .map(|(t, &origin)| {
             let (cells, head) = t.snapshot();
             OriginSnapshot { cells, head, origin }
diff --git a/crates/redextape-core/tests/reduced_tm_file.rs b/crates/redextape-core/tests/reduced_tm_file.rs
new file mode 100644
index 0000000..df95939
--- /dev/null
+++ b/crates/redextape-core/tests/reduced_tm_file.rs
@@ -0,0 +1,105 @@
+//! Reduced `.tm` files end to end: reduce a lowered run, print the file, parse the text back, run it under
+//! the steps its own header records, and decode the program's value with nothing but the file.
+
+// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
+// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
+// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
+#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
+
+use redextape_core::tm::StageKind::{Fold, SingleTape, TwoSymbol};
+use redextape_core::tm::{
+    EncodingKind, StageKind, TM_DEFAULT_CAPS, TmCaps, decode_reduced, parse_tm_full, print_tm_with, reduce,
+    run_tm_described, simulate_final,
+};
+
+mod common;
+use common::core_and_ty;
+
+/// Reduce `src`'s lowered run through `stages`, and hold the file to the reference interpreter.
+///
+/// The file must parse back to the same machine and header, its run under the header's own `steps` must
+/// halt in an accept state after exactly those steps, and `decode_reduced` must give the reference's value.
+fn round_trip(src: &str, stages: &[StageKind]) {
+    let label = format!("{src} through {stages:?}");
+    let (core, ty) = core_and_ty(src);
+    // `interp::eval` is this project's reference interpreter for the mini-language, run on a fixed corpus.
+    let expected = redextape_core::interp::eval(&core).unwrap_or_else(|e| panic!("reference failed for {src}: {e:?}"));
+    let d = run_tm_described(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS)
+        .unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
+    let (m, h) = reduce(&d, stages).unwrap_or_else(|e| panic!("{label}: {e:?}"));
+    let text = print_tm_with(&m, &h);
+
+    let doc = parse_tm_full(&text);
+    assert!(doc.diagnostics.is_empty(), "{label}: {:?}", doc.diagnostics);
+    let (parsed_m, parsed_h) = (doc.machine.expect("a machine"), doc.header.expect("a header"));
+    // `assert!` rather than `assert_eq!`: a failure would print millions of rules.
+    assert!(parsed_m == m, "{label}: the machine must round-trip");
+    assert_eq!(parsed_h, h, "{label}: the header must round-trip");
+    let r = parsed_h.reduction.as_ref().expect("a reduced header");
+    let kinds: Vec<StageKind> = r.stages.iter().map(|s| s.kind()).collect();
+    assert_eq!(kinds, stages, "{label}: the header records the stages that ran");
+
+    let caps = TmCaps { steps: r.steps, cells: TM_DEFAULT_CAPS.cells };
+    let (tapes, state, _status, steps) = simulate_final(&parsed_m, &parsed_h.init(parsed_m.tapes), caps);
+    let halted_in = &parsed_m.states[state as usize];
+    assert!(halted_in.accept, "{label}: halted in `{}`, not an accept state", halted_in.name);
+    assert_eq!(steps, r.steps, "{label}: the header records the steps its run takes");
+    assert_eq!(decode_reduced(&tapes, &parsed_h), Ok(expected), "{label}");
+    println!("{label}: {steps} steps, {} bytes", text.len());
+}
+
+/// The fast tier's program. Its value is 2, not 0: a decode that goes wrong on a tape whose value is 0
+/// reads 0 anyway, and `3 - 5` hid a header whose code had two of its symbols swapped.
+const FIVE_MINUS_THREE: &str = "5 - 3";
+
+#[test]
+fn the_fold_alone_decodes() {
+    round_trip(FIVE_MINUS_THREE, &[Fold]);
+}
+
+#[test]
+fn stage_one_alone_decodes() {
+    round_trip(FIVE_MINUS_THREE, &[SingleTape]);
+}
+
+#[test]
+fn stage_two_alone_decodes() {
+    round_trip(FIVE_MINUS_THREE, &[TwoSymbol]);
+}
+
+#[test]
+fn the_fold_then_stage_one_decodes() {
+    round_trip(FIVE_MINUS_THREE, &[Fold, SingleTape]);
+}
+
+#[test]
+fn the_fold_then_stage_two_decodes() {
+    round_trip(FIVE_MINUS_THREE, &[Fold, TwoSymbol]);
+}
+
+#[test]
+fn stages_one_then_two_decode() {
+    round_trip(FIVE_MINUS_THREE, &[SingleTape, TwoSymbol]);
+}
+
+/// Over 1 s in debug even alone: its reduction is verified at over seven million steps, then run again from
+/// the text.
+#[test]
+#[ignore = "slow tier: run via scripts/check-slow.sh"]
+fn all_three_stages_decode() {
+    round_trip(FIVE_MINUS_THREE, &[Fold, SingleTape, TwoSymbol]);
+}
+
+#[test]
+#[ignore = "slow tier: run via scripts/check-slow.sh"]
+fn all_three_stages_decode_on_larger_programs() {
+    for src in ["cons(1, cons(2, nil))", "if 2 > 1 { 10 } else { 20 }", "1 + 2 * 3"] {
+        round_trip(src, &[Fold, SingleTape, TwoSymbol]);
+    }
+}
+
+#[test]
+#[ignore = "slow tier: run via scripts/check-slow.sh"]
+fn stage_one_decodes_on_a_recursive_sum() {
+    round_trip("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)", &[SingleTape]);
+}
````
<!-- END task3.patch -->

- [ ] **Step 3: Format check and lint**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo clippy --workspace --all-targets -- -D warnings 2>&1 | grep -E "^(warning|error)"; echo "clippy done"
```

Expected: `fmt exit 0` with no diff printed, and `clippy done` with no `warning` or `error` line before it.

- [ ] **Step 4: Run this task's tests**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core --lib --test reduced_tm_file --test one_way_oracle --test universal_oracle -E 'test(/^tm::(reduced_file|sim)::/) | binary_id(redextape-core::reduced_tm_file) | binary_id(redextape-core::one_way_oracle) | binary_id(redextape-core::universal_oracle)' 2>&1 | grep -E "FAIL|Summary"
```

Expected summary line: `45 tests run: 45 passed, 900 skipped`

- [ ] **Step 5: Run the two text gates**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 494 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `473 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Reduce a lowered run into a checked reduced .tm file, and decode one

reduced_file::reduce applies fold, single-tape and two-symbol, in that
order, to a DescribedRun whose run finished. Stage 1's skeleton reaches
exactly the cells a run of the machine it receives visits, counted by
the new sim::simulate_origins. A stage's refusal, a layout collision or
a tape that cannot be laid out is an error. The reduced machine then
runs under 1,000,000,000 steps, and must halt in an accept state after
at least one step with tapes that decode, every stage undone, to the
lowered run's value; otherwise nothing is produced.

decode_reduced undoes a header's stages in reverse before decoding, and
decodes a version 1 header exactly as before. tests/common's
run_with_origins now reads its origins from simulate_origins.
reduced_tm_file.rs holds six stage subsets of 3 - 5 to the reference
interpreter through the printed text; all three stages on 3 - 5 and on
larger programs, and stage 1 on a recursive sum, are in the slow tier.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

- [ ] **Step 7: Run the sabotages, restoring after each**

The helper is Task 1 Step 7's `sab.py`. Rows T3-S16 to T3-S19 are the spec's first four sabotage rows; the spec's fifth, zero padding margin, cannot be run, because the margin this plan measured is already zero, so T3-S12 and T3-S13 take its place by taking a block away. Run the whole block in a single Bash tool call, with a timeout of 600000 ms.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
PLAN="$P/docs/superpowers/plans/2026-09-15-reduced-tm-files.md"
S=/tmp/claude-1000/-home-davey-projects-redextape/c6a1cf33-0c42-448c-a0ee-76239e25a1eb/scratchpad/reduced-tm-exec
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
fast() { cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core --lib --test reduced_tm_file --test one_way_oracle --test universal_oracle -E 'test(/^tm::(reduced_file|sim)::/) | binary_id(redextape-core::reduced_tm_file) | binary_id(redextape-core::one_way_oracle) | binary_id(redextape-core::universal_oracle)' --no-fail-fast 2>&1 | grep -E "^\s+FAIL \[|Summary|^error"; }
restore() { git -C "$P" checkout -- crates/ && git -C "${P:?}" clean -fdq -- crates/ && git -C "$P" status --short -- crates/; }
block_of sab.py >| "$S/sab.py"
R="$P/crates/redextape-core/src/tm/reduced_file.rs"
M="$P/crates/redextape-core/src/tm/sim.rs"

# T3-S1: a stage list `is_stage_list` refuses is reduced anyway
python3 "$S/sab.py" "$R" '    if !is_stage_list(stages) {' '    if false {' && fast; restore

# T3-S2: a run that did not finish is reduced against no tapes
python3 "$S/sab.py" "$R" '    let TmRun::Ran { tapes: lowered } = &d.run else { return Err(ReduceError::NotRan) };' '    let lowered = match &d.run { TmRun::Ran { tapes } => tapes.clone(), _ => Vec::new() }; let lowered = &lowered;' && fast; restore

# T3-S3: the fold ignores the ceiling it is given
python3 "$S/sab.py" "$R" '                let folded = unrefused(to_one_way_within(&m, ceiling).0)?;' '                let folded = unrefused(to_one_way_within(&m, MAX_MACHINE_STATES).0)?;' && fast; restore

# T3-S4: stage 1 ignores the ceiling it is given
python3 "$S/sab.py" "$R" '                let single = unrefused(to_single_tape_within(&m, ceiling).0)?;' '                let single = unrefused(to_single_tape_within(&m, MAX_MACHINE_STATES).0)?;' && fast; restore

# T3-S5: stage 2 ignores the ceiling it is given
python3 "$S/sab.py" "$R" '                let reduced = unrefused(to_two_symbol_within(&m, &code, ceiling).0)?;' '                let reduced = unrefused(to_two_symbol_within(&m, &code, MAX_MACHINE_STATES).0)?;' && fast; restore

# T3-S6: a layout symbol on an initial tape goes unchecked
python3 "$S/sab.py" "$R" '                if let Some(s) = layout_collision(&m, &inits) {' '                if let Some(s) = None::<Symbol> {' && fast; restore

# T3-S7: a tape the fold cannot lay out is reported as unverified
python3 "$S/sab.py" "$R" '                (folded, zigzag(&inits, m.tapes).ok_or(ReduceError::Layout)?, Stage::Fold)' '                (folded, zigzag(&inits, m.tapes).ok_or(ReduceError::Unverified)?, Stage::Fold)' && fast; restore

# T3-S8: a halt outside an accept state verifies
python3 "$S/sab.py" "$R" '    if steps == 0 || !m.states.get(state as usize).is_some_and(|s| s.accept) {' '    if steps == 0 {' && fast; restore

# T3-S9: an accept before any step verifies
python3 "$S/sab.py" "$R" '    if steps == 0 || !m.states.get(state as usize).is_some_and(|s| s.accept) {' '    if !m.states.get(state as usize).is_some_and(|s| s.accept) {' && fast; restore

# T3-S10: the step ceiling passed in is ignored
python3 "$S/sab.py" "$R" '    let caps = Caps { steps: max_steps, cells: DEFAULT_CAPS.cells };' '    let caps = Caps { steps: MAX_REDUCED_STEPS, cells: DEFAULT_CAPS.cells };' && fast; restore

# T3-S11: the reduced value is never compared with the lowered one
python3 "$S/sab.py" "$R" '        (Ok(got), Ok(want)) if got == want => Ok((m, header)),' '        (Ok(_), Ok(_)) => Ok((m, header)),' && fast; restore

# T3-S12, in place of the spec's fifth row: no block left of cell 0
python3 "$S/sab.py" "$R" '    let left = origins.iter().copied().max().unwrap_or(0);' '    let left = 0;' && fast; restore

# T3-S13, in place of the spec's fifth row: one block short on the right
python3 "$S/sab.py" "$R" '    Some((left + PAD_MARGIN, right.saturating_sub(longest) + PAD_MARGIN))' '    Some((left + PAD_MARGIN, right.saturating_sub(longest + 1) + PAD_MARGIN))' && fast; restore

# T3-S14: stage 1's inverse splits the first of several tapes
python3 "$S/sab.py" "$R" '            let [tape] = tapes else { return None };' '            let Some(tape) = tapes.first() else { return None };' && fast; restore

# T3-S15: the stages are undone first first
python3 "$S/sab.py" "$R" '    for stage in r.stages.iter().rev() {' '    for stage in r.stages.iter() {' && fast; restore

# T3-S16, the spec's first row: two symbols of the header's `two-symbol` run swapped
python3 "$S/sab.py" "$R" '                (reduced, bits, Stage::TwoSymbol { symbols: code.symbols().to_vec() })' '                (reduced, bits, Stage::TwoSymbol { symbols: { let mut s = code.symbols().to_vec(); if s.len() > 2 { s.swap(1, 2); } s } })' && fast; restore

# T3-S17, the spec's second row: `k - 1` written for `single-tape`
python3 "$S/sab.py" "$R" '                (single, vec![interleave(&inits, m.tapes, left, right)], Stage::SingleTape { k: m.tapes })' '                (single, vec![interleave(&inits, m.tapes, left, right)], Stage::SingleTape { k: m.tapes - 1 })' && fast; restore

# T3-S18, the spec's third row: `fold` dropped from `reduced`
python3 "$S/sab.py" "$R" '        done.push(stage);' '        if stage != Stage::Fold { done.push(stage); }' && fast; restore

# T3-S19, the spec's fourth row: `steps` one lower than measured
python3 "$S/sab.py" "$R" '    header.reduction = Some(Reduction { stages: done, steps });' '    header.reduction = Some(Reduction { stages: done, steps: steps - 1 });' && fast; restore

# T3-S20: growth on the right is counted as growth on the left
python3 "$S/sab.py" "$M" '                    if now > *before && t.head_index() == 0 {' '                    if now > *before {' && fast; restore

# T3-S21: a rebuilt tape loses the cell left of its head
python3 "$S/sab.py" "$M" '        let mut left: Vec<Symbol> = cells.iter().take(head).copied().collect();' '        let mut left: Vec<Symbol> = cells.iter().take(head.saturating_sub(1)).copied().collect();' && fast; restore
```

Expected, as measured. The clean run is `45 tests run: 45 passed, 900 skipped`:

| row | sabotage | red | summary |
| --- | --- | --- | --- |
| T3-S1 | a stage list `is_stage_list` refuses is reduced | `a_stage_list_that_is_not_canonical_is_refused` | `44 passed, 1 failed` |
| T3-S2 | a run that did not finish is reduced | `a_run_that_did_not_finish_is_refused` | `44 passed, 1 failed` |
| T3-S3 | the fold ignores its ceiling | `every_stage_refuses_at_its_state_ceiling` | `44 passed, 1 failed` |
| T3-S4 | stage 1 ignores its ceiling | the same | `44 passed, 1 failed` |
| T3-S5 | stage 2 ignores its ceiling | the same | `44 passed, 1 failed` |
| T3-S6 | a layout symbol on an initial tape unchecked | `a_layout_symbol_on_an_initial_tape_is_a_collision` | `44 passed, 1 failed` |
| T3-S7 | the fold's unlayable tape reported as unverified | `the_folds_marker_on_an_initial_tape_cannot_be_laid_out` | `44 passed, 1 failed` |
| T3-S8 | a halt outside an accept state verifies | `a_reduced_machine_that_halts_outside_an_accept_state_is_unverified`, and `a_reduced_machine_is_held_to_the_step_ceiling_it_is_given`, whose capped run also stops outside one | `43 passed, 2 failed` |
| T3-S9 | an accept before any step verifies | `a_reduced_machine_that_accepts_before_a_step_is_unverified` | `44 passed, 1 failed` |
| T3-S10 | the step ceiling passed in is ignored | `a_reduced_machine_is_held_to_the_step_ceiling_it_is_given` | `44 passed, 1 failed` |
| T3-S11 | the value is never compared | `a_reduction_that_does_not_reproduce_the_lowered_value_is_unverified` | `44 passed, 1 failed` |
| T3-S12 | no block left of cell 0 | `the_skeleton_reaches_every_cell_a_head_visits`, `stage_one_alone_decodes`, `stages_one_then_two_decode` | `42 passed, 3 failed` |
| T3-S13 | one block short on the right | `the_skeleton_reaches_every_cell_a_head_visits` alone, the right pad being 0 on this corpus | `44 passed, 1 failed` |
| T3-S14 | stage 1's inverse splits the first of several tapes | `tapes_a_stage_did_not_produce_are_a_mismatch` | `44 passed, 1 failed` |
| T3-S15 | the stages are undone first first | `the_fold_then_stage_two_decodes`, `the_fold_then_stage_one_decodes`, `stages_one_then_two_decode` | `42 passed, 3 failed` |
| T3-S16 | the spec's first row: two symbols swapped | `stage_two_alone_decodes`, `the_fold_then_stage_two_decodes`, `stages_one_then_two_decode` — every subset with stage 2, and no other | `42 passed, 3 failed` |
| T3-S17 | the spec's second row: `k - 1` written | `stage_one_alone_decodes`, `the_fold_then_stage_one_decodes`, `stages_one_then_two_decode` — every subset with stage 1 | `42 passed, 3 failed` |
| T3-S18 | the spec's third row: `fold` dropped | `the_fold_alone_decodes`, `the_fold_then_stage_two_decodes`, `the_fold_then_stage_one_decodes` — every subset with the fold | `42 passed, 3 failed` |
| T3-S19 | the spec's fourth row: `steps` one lower | all six end-to-end subsets | `39 passed, 6 failed` |
| T3-S20 | growth on the right counted as growth on the left | `the_skeleton_reaches_every_cell_a_head_visits`, `the_fold_then_stage_one_decodes`, and the fold's and the universal machine's oracle legs — `the_origin_watcher_counts_left_growth_and_nothing_else` among them | `33 passed, 12 failed` |
| T3-S21 | a rebuilt tape loses the cell left of its head | `from_snapshot_inverts_snapshot_at_every_head`, `the_fold_then_stage_two_decodes`, `the_fold_then_stage_one_decodes`, `stages_one_then_two_decode` | `41 passed, 4 failed` |

Rows T3-S16 to T3-S19 are the spec's first four, and each reddens exactly the subsets its stage reaches. The block took 57 s, starting at a load average of 2.37.

---

### Task 4: `emit --reduce`, and `run` on a `version 2` file

**Files:**
- Modify: `crates/redextape-cli/src/cli.rs` — `--reduce <STAGES>`
- Modify: `crates/redextape-cli/src/main.rs` — passes it on
- Modify: `crates/redextape-cli/src/emit.rs` — `Options::reduce`, the target guard, `stage_list`, `emit_reduced`, `reduce_refusal`
- Modify: `crates/redextape-cli/src/run.rs` — `run_artifact_text` on a `version 2` file
- Modify: `crates/redextape-cli/tests/roundtrip.rs` — `emit --reduce` then `run`, through the binary
- Modify: `crates/redextape-cli/tests/cmd/emit_help.stdout`
- Create: `crates/redextape-cli/tests/cmd/emit_reduce_off_target.{toml,stdout,stderr}`, `emit_reduce_off_target.in/p.rxt`, `emit_reduce_bad_list.{toml,stdout,stderr}` and `emit_reduce_bad_list.in/p.rxt`
- Modify: `crates/redextape-cli/README.md` — `--reduce`, and running a reduced file

**What changes.**
1. **`emit --reduce`** takes stage names separated by commas, with spaces around a comma allowed. It is refused off `--lang tm`, like `--encoding` and `--field-width`. A list `is_stage_list` refuses is an error naming the order `fold, single-tape, two-symbol`, before the input is read. `Options` gains a lifetime so it stays `Copy`.
2. **`emit_reduced`** reduces only a fitting run that finished. An overflow is refused by the message it has without `--reduce`. A capped fitting run writes nothing, where without `--reduce` it is written with a note, because there is no value to check a reduction against. Every `ReduceError` is an error, written by `reduce_refusal`, and no file is written.
3. **`run` on a `version 2` file** simulates under the header's `steps`, with `TM_DEFAULT_CAPS`'s cell cap, refuses a halt outside an accept state, and decodes through `decode_reduced`. A `version 1` file runs exactly as before.

**Tests:**
- In `emit.rs`: `--reduce` refused off `tm`; an empty, out-of-order, repeated and unknown list each refused with the exact message; spaces around commas; a capped fitting run not reduced; an overflow refused word for word as without `--reduce`; and each `ReduceError`'s message.
- In `run.rs`: a reduced file whose machine accepts after more steps than its header records, refused at the header's count, and one that halts outside an accept state.
- In `roundtrip.rs`, through the real binary: a file reduced to one tape runs to `run --backend reference`'s answer for `5 - 3`, and must be a `version 2` file with a `reduced` line. All three stages is in the slow tier.
- Two trycmd transcripts: `--reduce` off target, and a list out of order.

**Interfaces:**
- Consumes: Task 3's `reduce`, `decode_reduced` and `ReduceError`; Task 2's `StageKind`, `is_stage_list` and `MAX_REDUCED_STEPS`.
- Produces: `emit::Options<'a>` with `pub reduce: Option<&'a str>`, and `redextape emit --reduce <STAGES>`.

- [ ] **Step 1: Confirm Task 3 is the last commit and nothing is pending**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD -- crates/ grammars/ && git -C "$P" diff --cached --quiet -- crates/ grammars/ && echo clean
```

Expected: a line ending `Reduce a lowered run into a checked reduced .tm file, and decode one`, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
PLAN="$P/docs/superpowers/plans/2026-09-15-reduced-tm-files.md"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
block_of task4.patch | git -C "$P" apply --index --check && block_of task4.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-cli/README.md                     |  23 ++-
 crates/redextape-cli/src/cli.rs                    |   7 +
 crates/redextape-cli/src/emit.rs                   | 202 ++++++++++++++++++++-
 crates/redextape-cli/src/main.rs                   |   3 +-
 crates/redextape-cli/src/run.rs                    |  79 ++++++--
 crates/redextape-cli/tests/cmd/emit_help.stdout    |   3 +
 .../tests/cmd/emit_reduce_bad_list.in/p.rxt        |   1 +
 .../tests/cmd/emit_reduce_bad_list.stderr          |   1 +
 .../tests/cmd/emit_reduce_bad_list.stdout          |   0
 .../tests/cmd/emit_reduce_bad_list.toml            |   4 +
 .../tests/cmd/emit_reduce_off_target.in/p.rxt      |   1 +
 .../tests/cmd/emit_reduce_off_target.stderr        |   1 +
 .../tests/cmd/emit_reduce_off_target.stdout        |   0
 .../tests/cmd/emit_reduce_off_target.toml          |   4 +
 crates/redextape-cli/tests/roundtrip.rs            |  42 +++++
 15 files changed, 348 insertions(+), 23 deletions(-)
```

<!-- BEGIN task4.patch -->
````diff
diff --git a/crates/redextape-cli/README.md b/crates/redextape-cli/README.md
index 2c4c486..e103eca 100644
--- a/crates/redextape-cli/README.md
+++ b/crates/redextape-cli/README.md
@@ -161,7 +161,14 @@ width, the slot count and the result type — exactly what `TmHeader::init` need
 tapes and what `decode_tape_ty` needs to read the final ones. A header-less `.tm` still parses, and
 `run` still refuses it, with a message saying to re-emit through `redextape emit --lang tm`, which
 always writes a header. A machine that does not halt inside `TM_DEFAULT_CAPS` exits `1` and prints
-nothing: a partial tape that happens to decode is not an answer. A file whose final tapes fail to
+nothing: a partial tape that happens to decode is not an answer.
+
+**A reduced `.tm` file runs from its own header too.** `emit --reduce` writes one as `version 2`, and
+`run` simulates it under the `steps` its header records rather than `TM_DEFAULT_CAPS`'s step count,
+which a reduced machine far exceeds, keeping that cap's cell count. A reduced machine that does not
+halt within those steps, or that halts in a state that is not an accept state, exits `1`. One that
+halts in an accept state has every reduction on its `reduced` line undone, last first, and its tapes
+decode as any other file's do. A file whose final tapes fail to
 decode as the `result` its own header declares is not one failure but two, with opposite fault
 attributions (`DecodeFailure::Mismatch` and `DecodeFailure::BudgetExhausted`). Tapes that contradict
 the header's own declared type — a `Bool` slot holding neither `0` nor `1`, a heap pointer out of
@@ -217,6 +224,20 @@ section below shows — but with a *different message*, because on a pinned run
 never attempted and `--encoding binary` is not the remedy. The pinned refusal names the width it
 actually tried and the setting that chose it; the two are written out at the end of this file.
 
+`--reduce STAGES` writes the machine after the reductions it lists — `fold`, `single-tape` and
+`two-symbol`, comma-separated, in that order and each at most once — and is `--lang tm`-only under the
+same rule:
+
+    redextape emit p.rxt --lang tm --reduce fold,single-tape,two-symbol -o p.tm
+
+The reduced machine is run before anything is written: it must halt in an accept state within
+1,000,000,000 steps, and its tapes, with every reduction undone, must decode to the value the fitting
+run computed. Otherwise `emit` exits `2` and writes no file, and it does the same when the fitting run
+itself hit `TM_DEFAULT_CAPS`, since there is then no value to check against. The file it writes is a
+`version 2` `.tm`, whose `tape` lines are the reduced machine's own initial tapes, with a `reduced`
+line recording what undoing each reduction needs and a `steps` line recording how many steps that
+check took. `redextape run` takes it like any other `.tm` file; see `run` above.
+
 | target | what it writes | can `redextape` read it back? |
 |---|---|---|
 | `tm` | a complete self-describing machine, header included | yes — `parse_tm_full`, and `redextape run` |
diff --git a/crates/redextape-cli/src/cli.rs b/crates/redextape-cli/src/cli.rs
index 6a15aaf..0f1ad39 100644
--- a/crates/redextape-cli/src/cli.rs
+++ b/crates/redextape-cli/src/cli.rs
@@ -85,6 +85,13 @@ pub enum Command {
         /// rather than a silent no-op.
         #[arg(long, value_name = "CELLS")]
         field_width: Option<usize>,
+        /// Reduce the machine before writing it, through a comma-separated list of `fold`, `single-tape`
+        /// and `two-symbol`, in that order and each at most once. The reduced machine is run and its value
+        /// checked against the program's before anything is written, and the file it writes still runs
+        /// under `redextape run`. `--lang tm` only: passing it with any other target is an error rather
+        /// than a silent no-op.
+        #[arg(long, value_name = "STAGES")]
+        reduce: Option<String>,
         /// Write here instead of standard output.
         #[arg(short = 'o', long)]
         out: Option<PathBuf>,
diff --git a/crates/redextape-cli/src/emit.rs b/crates/redextape-cli/src/emit.rs
index 4ea537d..e27aaec 100644
--- a/crates/redextape-cli/src/emit.rs
+++ b/crates/redextape-cli/src/emit.rs
@@ -8,7 +8,7 @@
 
 use crate::input::{Input, write_atomic};
 use crate::report;
-use redextape_core::tm::EncodingKind;
+use redextape_core::tm::{EncodingKind, ReduceError, StageKind};
 use std::path::Path;
 
 /// Which text form to write.
@@ -108,11 +108,13 @@ impl Width {
 /// value is in effect", and merging the two before the guard is the bug design §7 is about. Keeping
 /// them in different fields makes the wrong version hard to write by accident.
 #[derive(Clone, Copy, Debug, Default)]
-pub struct Options {
+pub struct Options<'a> {
     /// `--encoding`, or `None` when it was not passed.
     pub encoding: Option<EncodingArg>,
     /// `--field-width`, or `None` when it was not passed.
     pub field_width: Option<usize>,
+    /// `--reduce`'s list as typed, or `None` when it was not passed. It has no config key.
+    pub reduce: Option<&'a str>,
     /// `[emit]` from `redextape.toml`, or `Defaults::default()` under `--no-config`.
     pub defaults: Defaults,
 }
@@ -126,7 +128,7 @@ pub struct Options {
 pub fn run(
     input: &Input,
     lang: Lang,
-    opts: Options,
+    opts: Options<'_>,
     dest: Option<&Path>,
     out: &mut impl std::io::Write,
     err: &mut impl std::io::Write,
@@ -156,10 +158,30 @@ pub fn run(
             writeln!(err, "error: `--field-width` applies to `--lang tm` only")?;
             return Ok(Outcome::ToolFailed);
         }
+        if opts.reduce.is_some() {
+            writeln!(err, "error: `--reduce` applies to `--lang tm` only")?;
+            return Ok(Outcome::ToolFailed);
+        }
     }
     // AFTER the guard, never before. See the comment above and design §7.
     let encoding = opts.encoding.unwrap_or(opts.defaults.encoding);
     let width = Width::resolve(opts.field_width, opts.defaults.field_width);
+    // Before the input is read, so a list that can never be valid costs nothing: the same reason `main`
+    // range-checks `--field-width` before any work.
+    let stages = match opts.reduce {
+        None => None,
+        Some(list) => {
+            let Some(stages) = stage_list(list) else {
+                writeln!(
+                    err,
+                    "error: `--reduce` takes stages from `fold, single-tape, two-symbol`, comma-separated, in \
+                     that order and each at most once; got `{list}`"
+                )?;
+                return Ok(Outcome::ToolFailed);
+            };
+            Some(stages)
+        }
+    };
     let src = match input.read() {
         Ok(s) => s,
         Err(e) => {
@@ -182,7 +204,7 @@ pub fn run(
     };
     let core = redextape_core::desugar::desugar(&program);
     let text = match lang {
-        Lang::Tm => match emit_tm(&core, ty, encoding, width, err)? {
+        Lang::Tm => match emit_tm(&core, ty, encoding, width, stages.as_deref(), err)? {
             Some(t) => t,
             None => return Ok(Outcome::ToolFailed),
         },
@@ -229,11 +251,15 @@ pub fn run(
 /// `Overflow` included — because a header records the initial tapes and the decoding recipe, never
 /// the answer, so it is complete however the run ended. Only `d.run` separates a machine that is
 /// faithful from one that is not; `emit_described` is where that decision lives.
+///
+/// `stages` is `--reduce`'s parsed list. The machine is still fitted and run first, since a reduction
+/// starts from that run and is checked against its value; `emit_reduced` decides what is written.
 fn emit_tm(
     core: &redextape_core::core::Core,
     ty: redextape_core::ty::Ty,
     encoding: EncodingArg,
     width: Width,
+    stages: Option<&[StageKind]>,
     err: &mut impl std::io::Write,
 ) -> std::io::Result<Option<String>> {
     // `AutoFit` is the fitting search, which is what this command has always done. A pin skips the
@@ -248,7 +274,10 @@ fn emit_tm(
         }
     };
     match described {
-        Ok(d) => emit_described(&d, encoding, width, err),
+        Ok(d) => match stages {
+            Some(stages) => emit_reduced(&d, stages, encoding, width, err),
+            None => emit_described(&d, encoding, width, err),
+        },
         Err(redextape_core::tm::TmRun::TooLarge) => {
             writeln!(
                 err,
@@ -379,6 +408,73 @@ fn emit_described(
     }
 }
 
+/// `emit_described` under `--reduce`. **ONLY A FITTING RUN THAT FINISHED IS REDUCED**, because a reduction
+/// is checked against the value the lowered machine computes: an overflow is refused exactly as it is
+/// without `--reduce`, and a capped run, which `emit_described` would write, writes nothing here.
+fn emit_reduced(
+    d: &redextape_core::tm::DescribedRun,
+    stages: &[StageKind],
+    encoding: EncodingArg,
+    width: Width,
+    err: &mut impl std::io::Write,
+) -> std::io::Result<Option<String>> {
+    match d.run {
+        redextape_core::tm::TmRun::Ran { .. } => {}
+        redextape_core::tm::TmRun::HitCap => {
+            writeln!(
+                err,
+                "error: no reduced machine was written: the fitting run did not halt within {} steps or {} tape \
+                 cells (`TM_DEFAULT_CAPS`)\n  a reduction is checked against the value the machine computes, and \
+                 this run computed none",
+                redextape_core::tm::TM_DEFAULT_CAPS.steps,
+                redextape_core::tm::TM_DEFAULT_CAPS.cells
+            )?;
+            return Ok(None);
+        }
+        redextape_core::tm::TmRun::Overflow
+        | redextape_core::tm::TmRun::TooLarge
+        | redextape_core::tm::TmRun::LowerError(_) => return emit_described(d, encoding, width, err),
+    }
+    match redextape_core::tm::reduce(d, stages) {
+        Ok((machine, header)) => Ok(Some(redextape_core::tm::print_tm_with(&machine, &header))),
+        Err(e) => {
+            writeln!(err, "error: no reduced machine was written: {}", reduce_refusal(&e))?;
+            Ok(None)
+        }
+    }
+}
+
+/// `--reduce`'s list: stage names separated by commas, with spaces around a comma allowed, or `None` unless
+/// every name is a stage and the list is one `is_stage_list` admits.
+fn stage_list(list: &str) -> Option<Vec<StageKind>> {
+    let stages = list.split(',').map(|s| StageKind::parse(s.trim())).collect::<Option<Vec<_>>>()?;
+    redextape_core::tm::is_stage_list(&stages).then_some(stages)
+}
+
+/// Why `reduce` wrote nothing, as `emit` says it. Every variant is spelled out, so a new one fails to compile
+/// here rather than arriving as a `Debug` dump.
+fn reduce_refusal(e: &ReduceError) -> String {
+    match e {
+        ReduceError::Refused(name) => format!(
+            "a stage refused this machine, with `{name}`\n  each stage builds at most `MAX_MACHINE_STATES` \
+             ({}) states, and refuses a machine it cannot represent",
+            redextape_core::tm::MAX_MACHINE_STATES
+        ),
+        ReduceError::LayoutCollision(s) => {
+            format!("the symbol `{s}` on this machine or its tapes is one the single-tape layout reserves")
+        }
+        ReduceError::Layout => "an initial tape cannot be laid out for the reduction".to_owned(),
+        ReduceError::Unverified => format!(
+            "the reduced machine did not reproduce the program's value within {} steps (`MAX_REDUCED_STEPS`)",
+            redextape_core::tm::MAX_REDUCED_STEPS
+        ),
+        // `run` parses the list and `emit_reduced` checks the run before `reduce` is called, so neither
+        // reaches here; they are spelled out for the reason this function's doc gives.
+        ReduceError::StageList => "the stage list is not `fold, single-tape, two-symbol` in order".to_owned(),
+        ReduceError::NotRan => "the fitting run did not finish".to_owned(),
+    }
+}
+
 #[cfg(test)]
 mod tests {
     use super::*;
@@ -409,7 +505,7 @@ mod tests {
 
     /// The common case: no width anywhere, so every existing test still exercises auto-fit.
     fn emit_case(case: &str, src: &str, lang: Lang, encoding: Option<EncodingArg>) -> (String, String, Outcome) {
-        emit_opts(case, src, lang, Options { encoding, field_width: None, defaults: Defaults::default() })
+        emit_opts(case, src, lang, Options { encoding, field_width: None, reduce: None, defaults: Defaults::default() })
     }
 
     /// Values needing more than four cells under unary, so a pin at 4 overflows. The same source
@@ -435,7 +531,7 @@ mod tests {
     /// `--encoding binary --field-width 8` emits.
     #[test]
     fn a_pinned_overflow_names_the_width_tried_and_the_flag_that_pinned_it() {
-        let opts = Options { encoding: None, field_width: Some(4), defaults: Defaults::default() };
+        let opts = Options { encoding: None, field_width: Some(4), reduce: None, defaults: Defaults::default() };
         let (out, err, outcome) = emit_opts("pin-flag", PIN_SRC, Lang::Tm, opts);
         assert_eq!(out, "", "an overflowing program writes no machine, pinned or not");
         assert!(matches!(outcome, Outcome::ToolFailed));
@@ -453,6 +549,7 @@ mod tests {
         let opts = Options {
             encoding: None,
             field_width: None,
+            reduce: None,
             defaults: Defaults { encoding: EncodingArg::Unary, field_width: 4 },
         };
         let (out, err, outcome) = emit_opts("pin-config", PIN_SRC, Lang::Tm, opts);
@@ -563,13 +660,16 @@ mod tests {
         assert!(doc.machine.is_some() && doc.header.is_some());
     }
 
+    /// A program whose fitting run hits `TM_DEFAULT_CAPS` without overflowing.
+    const CAPPED_SRC: &str =
+        "let mut i = 0; let mut s = 0; while i < 30 { let mut j = 0; while j < 30 { s = 1; j = j + 1; } i = i + 1; } s";
+
     /// A capped fitting run is NOT the overflow case. The header records the initial tapes and the
     /// decoding recipe, never the answer, so the file describes exactly the machine that was built —
     /// it is emitted, exit 0, and stderr says it will meet the same cap when run.
     #[test]
     fn a_capped_fitting_run_still_emits_and_says_so() {
-        let src = "let mut i = 0; let mut s = 0; while i < 30 { let mut j = 0; while j < 30 { s = 1; j = j + 1; } i = i + 1; } s";
-        let (text, err, outcome) = emit_case("hitcap", src, Lang::Tm, Some(EncodingArg::Unary));
+        let (text, err, outcome) = emit_case("hitcap", CAPPED_SRC, Lang::Tm, Some(EncodingArg::Unary));
         assert!(matches!(outcome, Outcome::Emitted), "a capped fitting run still emits; stderr: {err}");
         assert!(err.starts_with("note:"), "the note must not read as an error, got: {err}");
         assert!(err.contains("TM_DEFAULT_CAPS"), "the note must name the cap, got: {err}");
@@ -582,6 +682,90 @@ mod tests {
         assert!(doc.machine.is_some() && doc.header.is_some());
     }
 
+    /// `--reduce` as typed, with nothing else set.
+    fn reduce_opts(list: &str) -> Options<'_> {
+        Options { encoding: None, field_width: None, reduce: Some(list), defaults: Defaults::default() }
+    }
+
+    #[test]
+    fn reduce_is_rejected_off_the_tm_target() {
+        for lang in [Lang::Lambda, Lang::Asm] {
+            let (out, err, outcome) =
+                emit_opts(&format!("reduce-off-target-{lang:?}"), "1 + 2", lang, reduce_opts("fold"));
+            assert_eq!(out, "", "{lang:?}");
+            assert_eq!(err, "error: `--reduce` applies to `--lang tm` only\n", "{lang:?}");
+            assert!(matches!(outcome, Outcome::ToolFailed), "{lang:?}");
+        }
+    }
+
+    #[test]
+    fn a_stage_list_that_is_empty_out_of_order_repeated_or_unknown_is_refused_naming_the_order() {
+        for (i, list) in ["", "single-tape,fold", "fold,fold", "fold,unfold"].into_iter().enumerate() {
+            let (out, err, outcome) = emit_opts(&format!("reduce-list-{i}"), "1 + 2", Lang::Tm, reduce_opts(list));
+            assert_eq!(out, "", "{list:?}");
+            let want = format!(
+                "error: `--reduce` takes stages from `fold, single-tape, two-symbol`, comma-separated, in that \
+                 order and each at most once; got `{list}`\n"
+            );
+            assert_eq!(err, want, "{list:?}");
+            assert!(matches!(outcome, Outcome::ToolFailed), "{list:?}");
+        }
+    }
+
+    #[test]
+    fn a_stage_list_allows_spaces_around_its_commas() {
+        let all = vec![StageKind::Fold, StageKind::SingleTape, StageKind::TwoSymbol];
+        assert_eq!(stage_list(" fold , single-tape,two-symbol "), Some(all));
+    }
+
+    /// A reduction is checked against the value the fitting run computed, so a capped fitting run, which
+    /// `emit` writes without `--reduce`, writes nothing with it.
+    ///
+    /// The run's outcome is set to `HitCap` by hand: a program that really reaches `TM_DEFAULT_CAPS` takes
+    /// over a second in a debug build, and `emit_reduced` reads nothing of the run but its outcome here.
+    #[test]
+    fn a_capped_fitting_run_is_not_reduced() {
+        let (program, _) = redextape_core::parser::parse("1 + 2");
+        let core = redextape_core::desugar::desugar(&program.unwrap());
+        let mut d = redextape_core::tm::run_tm_described(
+            &core,
+            EncodingKind::Unary,
+            redextape_core::ty::Ty::Nat,
+            redextape_core::tm::TM_DEFAULT_CAPS,
+        )
+        .unwrap();
+        d.run = redextape_core::tm::TmRun::HitCap;
+        let mut err = Vec::new();
+        let written = emit_reduced(&d, &[StageKind::Fold], EncodingArg::Unary, Width::AutoFit, &mut err).unwrap();
+        let err = String::from_utf8(err).unwrap();
+        assert_eq!(written, None, "no file");
+        assert!(err.starts_with("error: no reduced machine was written: the fitting run did not halt"), "{err}");
+    }
+
+    #[test]
+    fn an_overflowing_program_is_refused_under_reduce_as_it_is_without() {
+        let (out, err, outcome) = emit_opts("reduce-overflow", OVERFLOW_SRC, Lang::Tm, reduce_opts("fold"));
+        let (_, plain, _) = emit_case("reduce-overflow-plain", OVERFLOW_SRC, Lang::Tm, None);
+        assert_eq!(out, "");
+        assert_eq!(err, plain, "the same refusal, word for word");
+        assert!(matches!(outcome, Outcome::ToolFailed));
+    }
+
+    #[test]
+    fn every_reduce_refusal_names_its_cause() {
+        for (e, cause) in [
+            (ReduceError::Refused("too-many-states"), "with `too-many-states`"),
+            (ReduceError::LayoutCollision('a'), "the symbol `a`"),
+            (ReduceError::Layout, "cannot be laid out"),
+            (ReduceError::Unverified, "value within 1000000000 steps"),
+            (ReduceError::StageList, "not `fold, single-tape, two-symbol` in order"),
+            (ReduceError::NotRan, "did not finish"),
+        ] {
+            let said = reduce_refusal(&e);
+            assert!(said.contains(cause), "{e:?}: {said}");
+        }
+    }
+
     /// `emit --lang asm`'s new behavior: the common path's `ty` (already computed before `match lang`)
     /// becomes a header when `parse_ty(show(ty))` round-trips. A distinct case name from
     /// `emitted_asm_parses_back`'s `"asm"` — `emit_case` keys a temp directory by case, and reusing
diff --git a/crates/redextape-cli/src/main.rs b/crates/redextape-cli/src/main.rs
index 66e83e6..3fed61d 100644
--- a/crates/redextape-cli/src/main.rs
+++ b/crates/redextape-cli/src/main.rs
@@ -106,7 +106,7 @@ fn main() -> ExitCode {
                 }
             }
         }
-        cli::Command::Emit { path, lang, encoding, field_width, out: dest } => {
+        cli::Command::Emit { path, lang, encoding, field_width, reduce, out: dest } => {
             // **THE FLAG IS RANGE-CHECKED HERE, BECAUSE THE CONFIG KEY IT OVERRIDES ALREADY WAS.**
             // `config::validate` refuses `emit.field-width` outside `0 | MIN..=MAX` at exit 2, and
             // the flag that beats it checked nothing: `--field-width 65` wrote a `.tm` carrying
@@ -132,6 +132,7 @@ fn main() -> ExitCode {
             let opts = emit::Options {
                 encoding,
                 field_width,
+                reduce: reduce.as_deref(),
                 defaults: emit::Defaults { encoding: cfg.emit.encoding, field_width: cfg.emit.field_width },
             };
             let input = Input::from_arg(&path);
diff --git a/crates/redextape-cli/src/run.rs b/crates/redextape-cli/src/run.rs
index af0787f..e760c8d 100644
--- a/crates/redextape-cli/src/run.rs
+++ b/crates/redextape-cli/src/run.rs
@@ -107,6 +107,13 @@ pub fn run(
 /// Simulate a `.tm` file. **The header is what makes this possible**: `TmHeader::init` builds the
 /// initial tapes and the header's `result` type is what `decode_tape_ty` decodes against, so a
 /// header-less file cannot be run even though it parses perfectly.
+///
+/// **A REDUCED FILE, `version 2`, RUNS UNDER THE STEPS ITS OWN HEADER RECORDS**, with
+/// `TM_DEFAULT_CAPS`'s cell cap, because a reduced machine takes far more steps than that cap's
+/// step count allows. It must halt in an accept state, since a reduction's run ends in one, and
+/// `decode_reduced` undoes its stages before the value is decoded. A `version 1` file is simulated and
+/// decoded as it always was: `decode_reduced` decodes a header with no reduction exactly as
+/// `decode_tape_ty_reason` does.
 fn run_artifact_text(
     src: &str,
     label: &str,
@@ -133,15 +140,36 @@ fn run_artifact_text(
         )?;
         return Ok(Outcome::ToolFailed);
     };
-    let enc = header.encoding.at(header.width);
     let init = header.init(machine.tapes);
-    let (tapes, status) = redextape_core::tm::simulate(&machine, &init, redextape_core::tm::TM_DEFAULT_CAPS);
+    let defaults = redextape_core::tm::TM_DEFAULT_CAPS;
+    let caps = header
+        .reduction
+        .as_ref()
+        .map_or(defaults, |r| redextape_core::tm::TmCaps { steps: r.steps, cells: defaults.cells });
+    let (tapes, state, status, _steps) = redextape_core::tm::simulate_final(&machine, &init, caps);
     if status == redextape_core::tm::TmStatus::HitCap {
+        match &header.reduction {
+            None => writeln!(
+                err,
+                "error: the machine did not halt within {} steps or {} tape cells (`TM_DEFAULT_CAPS`)",
+                defaults.steps, defaults.cells
+            )?,
+            Some(r) => writeln!(
+                err,
+                "error: the reduced machine did not halt within the {} steps its header records, or {} tape cells",
+                r.steps, defaults.cells
+            )?,
+        }
+        return Ok(Outcome::ProgramFailed);
+    }
+    if header.reduction.is_some()
+        && let Some(halted_in) = machine.states.get(state as usize).filter(|s| !s.accept)
+    {
         writeln!(
             err,
-            "error: the machine did not halt within {} steps or {} tape cells (`TM_DEFAULT_CAPS`)",
-            redextape_core::tm::TM_DEFAULT_CAPS.steps,
-            redextape_core::tm::TM_DEFAULT_CAPS.cells
+            "error: `{label}`'s reduced machine halted in `{}`, which is not an accept state\n  \
+             a reduction's run ends in an accept state, so these tapes hold no value",
+            halted_in.name
         )?;
         return Ok(Outcome::ProgramFailed);
     }
@@ -156,13 +184,7 @@ fn run_artifact_text(
     // the SAME distinction `run_asm_artifact` draws for the identical two causes on the `.asm` form; the
     // two runners used to give it opposite, and each individually wrong, treatments (see that function's
     // doc).
-    report_tm_decode(
-        redextape_core::tm::decode_tape_ty_reason(&tapes, &header.result, &*enc),
-        label,
-        &header.result,
-        out,
-        err,
-    )
+    report_tm_decode(redextape_core::tm::decode_reduced(&tapes, &header), label, &header.result, out, err)
 }
 
 /// `run_artifact_text`'s final `match`, on the two `DecodeFailure` causes — extracted so the MAPPING
@@ -749,6 +771,39 @@ mod tests {
         assert!(matches!(outcome, Outcome::ProgramFailed), "a self-contradicting file is exit 1, not 2");
     }
 
+    /// A reduced file runs under the steps its own header records, not `TM_DEFAULT_CAPS`. This machine
+    /// reaches its accept state after 10 steps, well inside the default cap, and its header records 5, so
+    /// it is refused at 5 and the message says whose count that was.
+    #[test]
+    fn a_reduced_file_that_does_not_halt_within_its_own_steps_is_the_files_fault() {
+        use std::fmt::Write as _;
+        let mut text = String::from(
+            "tapes 1\nstart w0\nversion 2\nencoding unary\nwidth 4\nslots 0\nresult Nat\nreduced single-tape 5\nsteps 5\n\n",
+        );
+        for i in 0..10 {
+            let next = if i == 9 { "done".to_owned() } else { format!("w{}", i + 1) };
+            writeln!(text, "state w{i}:\n  [*] -> write [*], move [R], goto {next}").unwrap();
+        }
+        text.push_str("state done: accept\n");
+        let (out, err, outcome) = run_case("reduced-hitcap", "m.tm", &text, Backend::Reference);
+        assert_eq!(out, "");
+        assert!(err.contains("did not halt within the 5 steps its header records"), "got: {err}");
+        assert!(matches!(outcome, Outcome::ProgramFailed));
+    }
+
+    /// A reduction's run ends in an accept state, so a halt anywhere else, a stuck state included, has no
+    /// value on its tapes — even when those tapes happen to decode.
+    #[test]
+    fn a_reduced_file_that_halts_outside_an_accept_state_is_the_files_fault() {
+        let text = "tapes 1\nstart stuck\nversion 2\nencoding unary\nwidth 4\nslots 0\nresult Nat\n\
+                    reduced single-tape 5\nsteps 1\n\n\
+                    state stuck:\n";
+        let (out, err, outcome) = run_case("reduced-stuck", "m.tm", text, Backend::Reference);
+        assert_eq!(out, "");
+        assert!(err.contains("halted in `stuck`, which is not an accept state"), "got: {err}");
+        assert!(matches!(outcome, Outcome::ProgramFailed));
+    }
+
     #[test]
     fn a_header_less_tm_cannot_be_run_and_says_why() {
         // `print_tm` (no header) records the transition function and start state and no tapes.
diff --git a/crates/redextape-cli/tests/cmd/emit_help.stdout b/crates/redextape-cli/tests/cmd/emit_help.stdout
index 5ff9cdc..1a54080 100644
--- a/crates/redextape-cli/tests/cmd/emit_help.stdout
+++ b/crates/redextape-cli/tests/cmd/emit_help.stdout
@@ -31,6 +31,9 @@ Options:
       --field-width <CELLS>
           TM tape field width in cells, overriding `emit.field-width` in `redextape.toml`. The same values that key accepts: 4..=64 to pin a width, or 0 to auto-fit — which is also what omitting the flag means, a search that starts narrow and widens until the values fit. Anything else exits 2. `--lang tm` only: passing it with any other target is an error rather than a silent no-op
 
+      --reduce <STAGES>
+          Reduce the machine before writing it, through a comma-separated list of `fold`, `single-tape` and `two-symbol`, in that order and each at most once. The reduced machine is run and its value checked against the program's before anything is written, and the file it writes still runs under `redextape run`. `--lang tm` only: passing it with any other target is an error rather than a silent no-op
+
   -o, --out <OUT>
           Write here instead of standard output
 
diff --git a/crates/redextape-cli/tests/cmd/emit_reduce_bad_list.in/p.rxt b/crates/redextape-cli/tests/cmd/emit_reduce_bad_list.in/p.rxt
new file mode 100644
index 0000000..e0ef584
--- /dev/null
+++ b/crates/redextape-cli/tests/cmd/emit_reduce_bad_list.in/p.rxt
@@ -0,0 +1 @@
+1 + 2
diff --git a/crates/redextape-cli/tests/cmd/emit_reduce_bad_list.stderr b/crates/redextape-cli/tests/cmd/emit_reduce_bad_list.stderr
new file mode 100644
index 0000000..b7fe091
--- /dev/null
+++ b/crates/redextape-cli/tests/cmd/emit_reduce_bad_list.stderr
@@ -0,0 +1 @@
+error: `--reduce` takes stages from `fold, single-tape, two-symbol`, comma-separated, in that order and each at most once; got `two-symbol,fold`
diff --git a/crates/redextape-cli/tests/cmd/emit_reduce_bad_list.stdout b/crates/redextape-cli/tests/cmd/emit_reduce_bad_list.stdout
new file mode 100644
index 0000000..e69de29
diff --git a/crates/redextape-cli/tests/cmd/emit_reduce_bad_list.toml b/crates/redextape-cli/tests/cmd/emit_reduce_bad_list.toml
new file mode 100644
index 0000000..db84948
--- /dev/null
+++ b/crates/redextape-cli/tests/cmd/emit_reduce_bad_list.toml
@@ -0,0 +1,4 @@
+bin.name = "redextape"
+args = ["emit", "p.rxt", "--lang", "tm", "--reduce", "two-symbol,fold"]
+fs.sandbox = true
+status.code = 2
diff --git a/crates/redextape-cli/tests/cmd/emit_reduce_off_target.in/p.rxt b/crates/redextape-cli/tests/cmd/emit_reduce_off_target.in/p.rxt
new file mode 100644
index 0000000..e0ef584
--- /dev/null
+++ b/crates/redextape-cli/tests/cmd/emit_reduce_off_target.in/p.rxt
@@ -0,0 +1 @@
+1 + 2
diff --git a/crates/redextape-cli/tests/cmd/emit_reduce_off_target.stderr b/crates/redextape-cli/tests/cmd/emit_reduce_off_target.stderr
new file mode 100644
index 0000000..ea4d1fe
--- /dev/null
+++ b/crates/redextape-cli/tests/cmd/emit_reduce_off_target.stderr
@@ -0,0 +1 @@
+error: `--reduce` applies to `--lang tm` only
diff --git a/crates/redextape-cli/tests/cmd/emit_reduce_off_target.stdout b/crates/redextape-cli/tests/cmd/emit_reduce_off_target.stdout
new file mode 100644
index 0000000..e69de29
diff --git a/crates/redextape-cli/tests/cmd/emit_reduce_off_target.toml b/crates/redextape-cli/tests/cmd/emit_reduce_off_target.toml
new file mode 100644
index 0000000..caea5d6
--- /dev/null
+++ b/crates/redextape-cli/tests/cmd/emit_reduce_off_target.toml
@@ -0,0 +1,4 @@
+bin.name = "redextape"
+args = ["emit", "p.rxt", "--lang", "asm", "--reduce", "fold"]
+fs.sandbox = true
+status.code = 2
diff --git a/crates/redextape-cli/tests/roundtrip.rs b/crates/redextape-cli/tests/roundtrip.rs
index f3e8e65..fb00d99 100644
--- a/crates/redextape-cli/tests/roundtrip.rs
+++ b/crates/redextape-cli/tests/roundtrip.rs
@@ -25,6 +25,48 @@ fn emit_then_run_reproduces_the_reference_answer() {
         .stdout("[1, 2, 3]\n");
 }
 
+/// `emit --lang tm --reduce <list>` on `5 - 3`, then `run` on the reduced file and `run --backend
+/// reference` on the program, returning both answers. Its value is 2 rather than 0, for the reason
+/// `reduced_tm_file.rs`'s corpus gives: a decode that goes wrong on a tape whose value is 0 reads 0 anyway. The file must be a reduced one: a `--reduce`
+/// that wrote a lowered file would give the same answer, and nothing else here could tell.
+#[allow(clippy::unwrap_used)]
+fn reduced_and_reference_answers(case: &str, list: &str) -> (String, String) {
+    let dir = redextape_test_support::ScratchDir::new(case).unwrap();
+    let src = dir.join("p.rxt");
+    let art = dir.join("p.tm");
+    std::fs::write(&src, "5 - 3").unwrap();
+
+    assert_cmd::Command::cargo_bin("redextape")
+        .unwrap()
+        .args(["emit", src.to_str().unwrap(), "--lang", "tm", "--reduce", list, "-o", art.to_str().unwrap()])
+        .assert()
+        .success();
+    let text = std::fs::read_to_string(&art).unwrap();
+    assert!(text.contains("\nversion 2\n"), "`--reduce {list}` must write a version 2 file");
+    assert!(text.lines().any(|l| l.starts_with("reduced ")), "`--reduce {list}` must write a `reduced` line");
+
+    let run = |args: &[&str]| {
+        let done = assert_cmd::Command::cargo_bin("redextape").unwrap().args(args).assert().success();
+        String::from_utf8(done.get_output().stdout.clone()).unwrap()
+    };
+    (run(&["run", art.to_str().unwrap()]), run(&["run", src.to_str().unwrap(), "--backend", "reference"]))
+}
+
+#[test]
+fn a_file_reduced_to_one_tape_runs_to_the_reference_answer() {
+    let (reduced, reference) = reduced_and_reference_answers("roundtrip-single-tape", "single-tape");
+    assert_eq!(reference, "2\n", "the reference answer for `5 - 3`");
+    assert_eq!(reduced, reference);
+}
+
+#[test]
+#[ignore = "slow tier: run via scripts/check-slow.sh"]
+fn a_file_reduced_through_all_three_stages_runs_to_the_reference_answer() {
+    let (reduced, reference) = reduced_and_reference_answers("roundtrip-all-three", "fold, single-tape, two-symbol");
+    assert_eq!(reference, "2\n", "the reference answer for `5 - 3`");
+    assert_eq!(reduced, reference);
+}
+
 /// The same oracle, the second of the two artifact forms `run` executes (`.tm`'s, above, is the
 /// first): `emit --lang asm` then `run` on the emitted `.asm` file, compiled to the register
 /// machine rather than a Turing machine. Task 5 is what makes this pair expressible — before it,
````
<!-- END task4.patch -->

- [ ] **Step 3: Format check and lint**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo clippy --workspace --all-targets -- -D warnings 2>&1 | grep -E "^(warning|error)"; echo "clippy done"
```

Expected: `fmt exit 0` with no diff printed, and `clippy done` with no `warning` or `error` line before it.

- [ ] **Step 4: Run this task's tests**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-cli 2>&1 | grep -E "FAIL|Summary"
```

Expected summary line: `164 tests run: 164 passed, 1 skipped`

- [ ] **Step 5: Run the two text gates**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 494 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `477 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
emit --reduce writes a reduced .tm file, and run runs one

emit --lang tm --reduce takes fold, single-tape and two-symbol,
comma-separated, in that order and each at most once, and is an error
with any other target. A list in any other shape is refused naming
the order. The machine is fitted and run as before, then reduced and
checked; a refused or unverified reduction, or a fitting run that hit
TM_DEFAULT_CAPS, writes nothing. An overflow is refused with the
message it has without --reduce.

run on a version 2 file simulates under the steps its header records,
with TM_DEFAULT_CAPS's cell cap, refuses a halt outside an accept
state, and decodes through decode_reduced. A version 1 file runs as
before. The emit --help snapshot gains --reduce, two transcripts pin
the refusals, and a round trip through the real binary compares a file
reduced to one tape with run --backend reference, with all three
stages in the slow tier.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

- [ ] **Step 7: Run the sabotages, restoring after each**

The helper is Task 1 Step 7's `sab.py`. Run the whole block in a single Bash tool call, with a timeout of 600000 ms.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
PLAN="$P/docs/superpowers/plans/2026-09-15-reduced-tm-files.md"
S=/tmp/claude-1000/-home-davey-projects-redextape/c6a1cf33-0c42-448c-a0ee-76239e25a1eb/scratchpad/reduced-tm-exec
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
fast() { cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-cli --no-fail-fast 2>&1 | grep -E "^\s+FAIL \[|Summary|^error"; }
restore() { git -C "$P" checkout -- crates/ && git -C "${P:?}" clean -fdq -- crates/ && git -C "$P" status --short -- crates/; }
block_of sab.py >| "$S/sab.py"
E="$P/crates/redextape-cli/src/emit.rs"
U="$P/crates/redextape-cli/src/run.rs"

# T4-S1: `--reduce` is accepted off `--lang tm`
python3 "$S/sab.py" "$E" '        if opts.reduce.is_some() {' '        if false {' && fast; restore

# T4-S2: a stage list out of order or repeated is accepted
python3 "$S/sab.py" "$E" '    redextape_core::tm::is_stage_list(&stages).then_some(stages)' '    Some(stages)' && fast; restore

# T4-S3: a capped fitting run is reduced anyway
python3 "$S/sab.py" "$E" '        redextape_core::tm::TmRun::Ran { .. } => {}' '        redextape_core::tm::TmRun::Ran { .. } | redextape_core::tm::TmRun::HitCap => {}' && fast; restore

# T4-S4: a reduced file runs under `TM_DEFAULT_CAPS` rather than its own `steps`
python3 "$S/sab.py" "$U" '        .map_or(defaults, |r| redextape_core::tm::TmCaps { steps: r.steps, cells: defaults.cells });' '        .map_or(defaults, |_| defaults);' && fast; restore

# T4-S5: a reduced file that halts outside an accept state is decoded
python3 "$S/sab.py" "$U" '    if header.reduction.is_some()' '    if false' && fast; restore

# T4-S6: a reduced file is decoded as a lowered one
python3 "$S/sab.py" "$U" '    report_tm_decode(redextape_core::tm::decode_reduced(&tapes, &header), label, &header.result, out, err)' '    report_tm_decode(redextape_core::tm::decode_tape_ty_reason(&tapes, &header.result, &*header.encoding()), label, &header.result, out, err)' && fast; restore

# T4-S7: an overflow under `--reduce` is given the capped run's message
python3 "$S/sab.py" "$E" $'        redextape_core::tm::TmRun::Overflow\n        | redextape_core::tm::TmRun::TooLarge' '        redextape_core::tm::TmRun::TooLarge' && python3 "$S/sab.py" "$E" $'        redextape_core::tm::TmRun::Ran { .. } => {}\n        redextape_core::tm::TmRun::HitCap => {' $'        redextape_core::tm::TmRun::Ran { .. } => {}\n        redextape_core::tm::TmRun::HitCap | redextape_core::tm::TmRun::Overflow => {' && fast; restore
```

Expected, as measured. The clean run is `164 tests run: 164 passed, 1 skipped`:

| row | sabotage | red | summary |
| --- | --- | --- | --- |
| T4-S1 | `--reduce` accepted off `--lang tm` | `reduce_is_rejected_off_the_tm_target`, and `cli_transcripts`, which runs `emit_reduce_off_target` | `162 passed, 2 failed` |
| T4-S2 | a list out of order or repeated accepted | `a_stage_list_that_is_empty_out_of_order_repeated_or_unknown_is_refused_naming_the_order`, and `cli_transcripts`, which runs `emit_reduce_bad_list` | `162 passed, 2 failed` |
| T4-S3 | a capped fitting run reduced anyway | `a_capped_fitting_run_is_not_reduced` | `163 passed, 1 failed` |
| T4-S4 | a reduced file run under `TM_DEFAULT_CAPS` | `a_reduced_file_that_does_not_halt_within_its_own_steps_is_the_files_fault` | `163 passed, 1 failed` |
| T4-S5 | a halt outside an accept state decoded | `a_reduced_file_that_halts_outside_an_accept_state_is_the_files_fault` | `163 passed, 1 failed` |
| T4-S6 | a reduced file decoded as a lowered one | `a_file_reduced_to_one_tape_runs_to_the_reference_answer`, through the real binary | `163 passed, 1 failed` |
| T4-S7 | an overflow given the capped run's message | `an_overflowing_program_is_refused_under_reduce_as_it_is_without` | `163 passed, 1 failed` |

T4-S4 is the row the first version of that test could not have shown: it looped forever, so a `run` ignoring the header's `steps` hit `TM_DEFAULT_CAPS` and printed the same sentence. The machine now reaches its accept state after 10 steps, inside that cap and outside the 5 its header records. The block took 11 s, starting at a load average of 1.85.

---

### Task 5: The TM grammar reads reduced headers

**Files:**
- Modify: `grammars/tree-sitter-redextape-tm/grammar.js` — `reduced` and `steps`
- Modify: `grammars/tree-sitter-redextape-tm/queries/highlights.scm` — a stage name and a two-symbol code's symbols
- Modify: `grammars/tree-sitter-redextape-tm/src/grammar.json`, `src/node-types.json` and `src/parser.c` — regenerated by the pinned CLI
- Create: `grammars/tree-sitter-redextape-tm/test/corpus/reduced.txt`
- Modify: `grammars/tree-sitter-redextape-tm/README.md` — the figures `scripts/check-doc-figures.sh` holds, and the stage names
- Modify: `crates/redextape-grammar-check/src/tm.rs` — a hand-written reduced entry in `CORPUS`, `printed_reduced`, `REDUCED_CORPUS`
- Modify: `crates/redextape-grammar-check/tests/tm.rs` — the reduced files join the pattern and authority checks, and a differential of their own

**What changes.**
1. **`reduced`** is `seq('reduced', stage, repeat(seq(',', stage)))`: `fold`; `single_tape`, its name and a `number`; and `two_symbol`, its name and `symbols: (identifier)`. Each stage name is a regex token aliased to one `stage` node. **`fold` is `/fold\r?/`**: the generator extracts an all-letter token as a keyword of `identifier`, which admits `,`, so the printer's `fold,` lexed as one word and parsed as an `ERROR`. A string literal and a bare regex both did. `identifier` cannot match a `\r`, and `parse_tm_full` strips one from every line, so the token admits nothing the authority refuses.
2. **`steps`** is `seq('steps', number)`.
3. **Captures:** `(stage) @keyword` and `(two_symbol symbols: (identifier) @character)`. The capture map is unchanged.
4. **Grammar-check:** `REDUCED_CORPUS` is `3 - 5` through each stage alone and through the fold then stage 2, the smallest file with a comma in its stage list. `the_tm_grammar_agrees_with_the_reduced_printer` compares them with the printer, `every_tm_query_pattern_fires_over_the_corpus` and `parse_tm_accepts_every_corpus_entry` read them too, and `CORPUS` gains a hand-written header through all three stages.

**Interfaces:**
- Consumes: Task 3's `reduce`; Task 2's `StageKind` and the reduced header's spans.
- Produces, in `redextape_grammar_check::tm`: `pub fn printed_reduced(src: &str, stages: &[StageKind]) -> Option<(String, Vec<(Span, TokenClass)>)>` and `pub const REDUCED_CORPUS: &[(&str, &[StageKind])]`.

- [ ] **Step 1: Confirm Task 4 is the last commit and nothing is pending**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD -- crates/ grammars/ && git -C "$P" diff --cached --quiet -- crates/ grammars/ && echo clean
```

Expected: a line ending `emit --reduce writes a reduced .tm file, and run runs one`, then `clean`.

- [ ] **Step 2: Install the pinned tree-sitter CLI**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
mkdir -p "$P/.tools" && cd "$P" && bash scripts/install-treesitter-ci.sh "$P/.tools" && "$P/.tools/tree-sitter" --version
```

Expected: a line saying tree-sitter 0.25.10 is installed to, or already at, `$P/.tools`, then `tree-sitter 0.25.10 (da6fe9beb4f7f67beb75914ca8e0d48ae48d6406)`.

- [ ] **Step 3: Apply the patch, staged**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
PLAN="$P/docs/superpowers/plans/2026-09-15-reduced-tm-files.md"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
block_of task5.patch | git -C "$P" apply --index --check && block_of task5.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-grammar-check/src/tm.rs           |   48 +-
 crates/redextape-grammar-check/tests/tm.rs         |   58 +-
 grammars/tree-sitter-redextape-tm/README.md        |   34 +-
 grammars/tree-sitter-redextape-tm/grammar.js       |   20 +-
 .../queries/highlights.scm                         |    7 +
 grammars/tree-sitter-redextape-tm/src/grammar.json |  125 +
 .../tree-sitter-redextape-tm/src/node-types.json   |  118 +
 grammars/tree-sitter-redextape-tm/src/parser.c     | 2473 ++++++++++++++------
 .../test/corpus/reduced.txt                        |   91 +
 9 files changed, 2286 insertions(+), 688 deletions(-)
```

<!-- BEGIN task5.patch -->
````diff
diff --git a/crates/redextape-grammar-check/src/tm.rs b/crates/redextape-grammar-check/src/tm.rs
index 1688999..2b4a42c 100644
--- a/crates/redextape-grammar-check/src/tm.rs
+++ b/crates/redextape-grammar-check/src/tm.rs
@@ -20,7 +20,7 @@
 use crate::grammar::{Grammar, compare_classified};
 use redextape_core::Span;
 use redextape_core::analysis::TokenClass;
-use redextape_core::tm::EncodingKind;
+use redextape_core::tm::{EncodingKind, StageKind};
 use tree_sitter_language::LanguageFn;
 
 unsafe extern "C" {
@@ -38,7 +38,8 @@ unsafe extern "C" {
 /// (`every_tm_query_pattern_fires_over_the_corpus`). Four of those patterns — `encoding`'s operand,
 /// `result`'s operand, a `tape` line's packed run, and `@comment` — are reachable ONLY from a headered
 /// file, so a corpus of header-less machines would leave them at zero coverage with every other test
-/// still green. That is the gap `every_query_pattern_fires` was promoted onto `Grammar` to catch.
+/// still green. That is the gap `every_query_pattern_fires` was promoted onto `Grammar` to catch. Two
+/// more — a stage name and a two-symbol code's symbols — are reachable only from a REDUCED file.
 ///
 /// The last two entries are design §6.3's residue: comment positions **no printer can produce**, so
 /// they have no differential authority and rest on this corpus plus `tree-sitter test`.
@@ -67,6 +68,14 @@ pub const CORPUS: &[(&str, &str)] = &[
         "a tape line with no comment, and a nested result type",
         "tapes 10\nstart s\nversion 1\nencoding unary\nwidth 4\nslots 1\nresult List<List<Nat>>\ntape 9 #\n\nstate s: accept\n",
     ),
+    // A REDUCED HEADER, `version 2` with `reduced` and `steps` after `result`. Its stage list has a comma
+    // straight after `fold`, which is the text a stage name extracted as a keyword would lex as one word,
+    // and its symbols end in a `,`, which the authority reads as a symbol because they run to the end of
+    // the line.
+    (
+        "a reduced header through all three stages",
+        "tapes 1\nstart pre\nversion 2\nencoding unary\nwidth 8\nslots 4\nresult Nat\nreduced fold, single-tape 5, two-symbol _#1<>ABab|,\nsteps 7088578\ntape 0 _1\n\nstate pre: accept\n",
+    ),
     // ---- design §6.3's residue: nothing in this project's pipeline emits any of these ----
     ("a whole-line comment", "; what this machine does\ntapes 1\nstart s\n\nstate s: accept\n"),
     // `; stack` is the third residue shape and it is the subtlest: unlike the two below it, the
@@ -186,13 +195,31 @@ pub fn printed_machine(src: &str) -> Option<(String, Vec<(Span, TokenClass)>)> {
 /// stay in §6.3's residue alongside the whole-line comment.
 #[must_use]
 pub fn printed_machine_with_header(src: &str, kind: EncodingKind) -> Option<(String, Vec<(Span, TokenClass)>)> {
+    let d = described(src, kind)?;
+    Some(redextape_core::tm::print_tm_with_mapped(&d.machine, &d.header))
+}
+
+/// `src`'s described run under `kind`, or `None` when it does not parse, type or lower: the one place
+/// the two corpus builders that simulate reach `run_tm_described`.
+fn described(src: &str, kind: EncodingKind) -> Option<redextape_core::tm::DescribedRun> {
     let (program, _diagnostics) = redextape_core::parser::parse(src);
     let program = program?;
     let result = redextape_core::typeck::result_type(&program).ok()?;
     let core = redextape_core::desugar::desugar(&program);
-    let described =
-        redextape_core::tm::run_tm_described(&core, kind, result, redextape_core::tm::TM_DEFAULT_CAPS).ok()?;
-    Some(redextape_core::tm::print_tm_with_mapped(&described.machine, &described.header))
+    redextape_core::tm::run_tm_described(&core, kind, result, redextape_core::tm::TM_DEFAULT_CAPS).ok()
+}
+
+/// Lower a mini-language program, reduce its run through `stages`, and print the reduced file with its
+/// classification, or `None` when the program does not run or its run does not reduce.
+///
+/// **IT SIMULATES MORE THAN `printed_machine_with_header` DOES, UNDER THE SAME BOUNDS.** `reduce` runs the
+/// reduced machine to check it before any text exists, so this is held to the three bounds that
+/// function's doc gives, under `Unary`, and only `REDUCED_CORPUS` reaches it.
+#[must_use]
+pub fn printed_reduced(src: &str, stages: &[StageKind]) -> Option<(String, Vec<(Span, TokenClass)>)> {
+    let d = described(src, EncodingKind::Unary)?;
+    let (machine, header) = redextape_core::tm::reduce(&d, stages).ok()?;
+    Some(redextape_core::tm::print_tm_with_mapped(&machine, &header))
 }
 
 /// The FIXED list of programs the headered corpus is built from, with the encoding each is printed
@@ -209,6 +236,17 @@ pub const HEADERED_CORPUS: &[(&str, EncodingKind)] = &[
     ("cons(1, cons(2, nil))", EncodingKind::Binary),
 ];
 
+/// The FIXED list of reduced files the headered leg compares too, as a program and its stages: `3 - 5`
+/// through each stage alone, and through the fold then stage 2, whose `reduced` line is the one here with
+/// a comma in it. Fixed for the reason `HEADERED_CORPUS` is. Stage 1 paired with another stage prints many
+/// times larger for this program, so no such pair is here.
+pub const REDUCED_CORPUS: &[(&str, &[StageKind])] = &[
+    ("3 - 5", &[StageKind::Fold]),
+    ("3 - 5", &[StageKind::SingleTape]),
+    ("3 - 5", &[StageKind::TwoSymbol]),
+    ("3 - 5", &[StageKind::Fold, StageKind::TwoSymbol]),
+];
+
 /// Compare the TM grammar's projected captures against the printer's own classification of the same
 /// printed text.
 ///
diff --git a/crates/redextape-grammar-check/tests/tm.rs b/crates/redextape-grammar-check/tests/tm.rs
index 3319065..6b5dfb7 100644
--- a/crates/redextape-grammar-check/tests/tm.rs
+++ b/crates/redextape-grammar-check/tests/tm.rs
@@ -2,13 +2,31 @@
 
 use proptest::prelude::*;
 use proptest::test_runner::TestRunner;
+use redextape_core::Span;
 use redextape_core::analysis::TokenClass;
 use redextape_grammar_check::TM;
 use redextape_grammar_check::tm::{
-    CORPUS, HEADERED_CORPUS, compare_printed, printed_machine, printed_machine_with_header,
+    CORPUS, HEADERED_CORPUS, REDUCED_CORPUS, compare_printed, printed_machine, printed_machine_with_header,
+    printed_reduced,
 };
 use redextape_test_support::arb_expr_over;
 
+/// One printed file: a name for it, its text and the printer's own classification of that text.
+type Printed = (String, String, Vec<(Span, TokenClass)>);
+
+/// `REDUCED_CORPUS`, printed.
+#[allow(clippy::panic)]
+fn printed_reduced_corpus() -> Vec<Printed> {
+    REDUCED_CORPUS
+        .iter()
+        .map(|(src, stages)| {
+            let (text, want) = printed_reduced(src, stages)
+                .unwrap_or_else(|| panic!("`{src}` through {stages:?} must reduce and print"));
+            (format!("`{src}` through {stages:?}"), text, want)
+        })
+        .collect()
+}
+
 /// Every capture name any query emits must have a class.
 ///
 /// PROMOTED to `Grammar::capture_map_is_total` in PR 2, specifically so this grammar would call it
@@ -141,9 +159,15 @@ fn every_corpus_program_parses_without_error_nodes() {
 /// `result`'s operand, a `tape` line's packed run, a comment — are reachable ONLY from a headered
 /// file. A `CORPUS` of header-less machines would leave four patterns with zero coverage while every
 /// other test in this file stayed green.
+///
+/// The printed reduced files join the hand-written corpus here, so a reduced file's own patterns are
+/// reached by text the printer wrote as well as by text typed for this corpus.
 #[test]
 fn every_tm_query_pattern_fires_over_the_corpus() {
-    if let Err(why) = TM.every_query_pattern_fires(CORPUS) {
+    let printed = printed_reduced_corpus();
+    let mut corpus: Vec<(&str, &str)> = CORPUS.to_vec();
+    corpus.extend(printed.iter().map(|(name, text, _)| (name.as_str(), text.as_str())));
+    if let Err(why) = TM.every_query_pattern_fires(&corpus) {
         panic!("{why}");
     }
 }
@@ -156,6 +180,9 @@ fn every_tm_query_pattern_fires_over_the_corpus() {
 /// it exists for the same reason: design §6.3's residue — a whole-line comment, and a trailing comment
 /// on a line the printer never writes one on — has no printer to be compared against, so "the grammar
 /// accepts it" and "the authority accepts it" have to be checked as two separate facts.
+///
+/// The printed reduced files are held to the same check. They come from the printer, but a reduced
+/// header the parser refused would leave the differential below comparing text no reader accepts.
 #[test]
 fn parse_tm_accepts_every_corpus_entry() {
     for (name, src) in CORPUS {
@@ -163,6 +190,11 @@ fn parse_tm_accepts_every_corpus_entry() {
         assert!(diagnostics.is_empty(), "`{name}` must parse under the real authority cleanly, got: {diagnostics:?}");
         assert!(machine.is_some(), "`{name}` produced no machine despite no diagnostics");
     }
+    for (name, text, _) in printed_reduced_corpus() {
+        let (machine, diagnostics) = redextape_core::tm::parse_tm(&text);
+        assert!(diagnostics.is_empty(), "{name} must parse under the real authority cleanly, got: {diagnostics:?}");
+        assert!(machine.is_some(), "{name} produced no machine despite no diagnostics");
+    }
 }
 
 /// Design §6.3's residue, pinned by name so a corpus edit cannot quietly drop it. These are the
@@ -214,6 +246,28 @@ fn the_tm_grammar_agrees_with_the_headered_printer() {
     assert_eq!(idents, 2 * HEADERED_CORPUS.len(), "every headered file carries exactly `encoding` and `result`");
 }
 
+/// The reduced leg: `REDUCED_CORPUS`, printed by the same printer as the headered leg above, for the text only
+/// a reduced header carries.
+///
+/// **ITS OWN TEST RATHER THAN MORE OF THE ONE ABOVE**, because together the two took over a second in a debug
+/// build, timed alone, and this project's fast tier is under one.
+///
+/// The comma floor is what stops an edit to `REDUCED_CORPUS` from quietly leaving every stage list one stage
+/// long, which would leave the one token here that follows a stage name directly uncompared.
+#[test]
+fn the_tm_grammar_agrees_with_the_reduced_printer() {
+    let printed = printed_reduced_corpus();
+    assert!(
+        printed.iter().any(|(_, text, _)| text.lines().any(|l| l.starts_with("reduced ") && l.contains(", "))),
+        "the reduced corpus must print a stage list with a comma in it"
+    );
+    for (name, text, want) in printed {
+        if let Err(why) = compare_printed(&text, &want) {
+            panic!("{name} diverged:\n{why}");
+        }
+    }
+}
+
 /// The header-less leg, generated.
 ///
 /// **`cases` IS SET EXPLICITLY AND THE NUMBER IS A MEASUREMENT, NOT A DEFAULT** — design §11.5. One
diff --git a/grammars/tree-sitter-redextape-tm/README.md b/grammars/tree-sitter-redextape-tm/README.md
index 54ed580..1eaee19 100644
--- a/grammars/tree-sitter-redextape-tm/README.md
+++ b/grammars/tree-sitter-redextape-tm/README.md
@@ -16,7 +16,7 @@ file       := line*
 line       := blank | ';' ...            whole-line comment, after leading whitespace
             | 'tapes' NAT                1..=MAX_TAPES (64)
             | 'start' NAME
-            | DIRECTIVE REST             version | encoding | width | slots | result | tape
+            | DIRECTIVE REST             version | encoding | width | slots | result | reduced | steps | tape
             | 'state' NAME ':' ['accept']
             | RULE
 RULE       := '[' SYM* ']' '->' 'write' '[' SYM* ']' ',' 'move' '[' MOVE* ']' ',' 'goto' NAME
@@ -55,6 +55,14 @@ and the header `Option` is the only difference between the entry points:
 
 Measured on `1 + 2` lowered at `Unary::at(8)`: 3,163 spans header-less, 3,177 headered.
 
+**A reduced header's stage names cannot be keywords.** `word` makes the generator extract a token whose
+characters are all letters as a keyword of `identifier`, and a keyword is lexed as the whole
+`identifier` it starts. `identifier` admits `,`, so `fold` in the printer's `reduced fold, single-tape 5`
+would lex as `fold,` and parse as an `ERROR`. `single-tape` and `two-symbol` are safe as written, since
+`-` is not a letter. `fold` is written `/fold\r?/`: a string literal and a bare regex both still parsed
+`fold,` as an `ERROR`, and `\r?` keeps it out because `identifier` cannot match a `\r`. It admits
+nothing `parse_tm_full` refuses, since that parser strips a `\r` from the end of every line.
+
 ## What it is NOT, and may never become
 
 - **Not a second parser.** The roadmap forbids two authoritative grammars; its test for
@@ -84,12 +92,18 @@ unclassified text a query could legitimately miss, and a dropped pattern shows u
 mismatch rather than as a merely uncoloured character. `every_printed_token_is_captured` names that
 property directly.
 
-Two corpora, because the two printers reach different classes:
+Three corpora, because the two printers reach different classes and a reduced header reaches tokens no
+other file carries:
 
 | corpus | printer | how it is built | size |
 |---|---|---|---|
 | generated | `print_tm_mapped` | `parse` → `desugar` → `lower_asm` → `lower_tm` | 32 proptest cases |
 | headered | `print_tm_with_mapped` | `parse` → `result_type` → `desugar` → `run_tm_described` | 5 fixed programs |
+| reduced | `print_tm_with_mapped` | the headered path, then `reduce` | 4 fixed reductions of `3 - 5` |
+
+**The reduced row reuses the headered printer** and is there for the text only a reduced header
+carries: a `reduced` line's stage names, its tape counts, its commas and its symbols. One of the four
+reductions lists two stages, so a comma is compared too.
 
 **32 is a measurement, not a default.** A printed TM machine averages 18,905 bytes and 6,865 spans
 against λ's 912 and 637, so proptest's default 256 would have this leg parsing ~4.8 MB and comparing
@@ -447,12 +461,13 @@ Three things worth knowing before taking the Zed route:
 
 ## What the grammar covers
 
-`grammar.js` is **147 lines** — close to the mini-language's 171 and nearly twice λ's 78, which is
-what a thirteen-keyword, line-oriented form costs. `queries/highlights.scm` holds **13 patterns** over **11
-capture names**, and `tm::CAPTURE_CLASSES` has **11 rows**, checked total in both directions
-(`the_capture_map_is_total_over_the_queries`, `every_map_row_is_used_by_a_query`) and each one
-exercised at least once over the corpus (`every_tm_query_pattern_fires_over_the_corpus`).
-`src/parser.c` is **42,220 bytes** at ABI 15. `test/corpus/` holds **12** `tree-sitter test` cases.
+`grammar.js` is **165 lines** — close to the mini-language's 171 and nearly twice λ's 78, which is
+what a fifteen-keyword, line-oriented form with three stage names costs. `queries/highlights.scm`
+holds **15 patterns** over **11 capture names**, and `tm::CAPTURE_CLASSES` has **11 rows**, checked
+total in both directions (`the_capture_map_is_total_over_the_queries`,
+`every_map_row_is_used_by_a_query`) and each one exercised at least once over the corpus
+(`every_tm_query_pattern_fires_over_the_corpus`). `src/parser.c` is **74,423 bytes** at ABI 15.
+`test/corpus/` holds **14** `tree-sitter test` cases.
 
 **Eleven capture names for nine classes**, and both duplicate pairs are deliberate. `@variable`
 (`encoding`'s operand) and `@type` (`result`'s operand) both project to `Ident` — `write_header`'s own
@@ -485,6 +500,7 @@ the choice between `accept` and a rule list is exclusive here too.
 
 **Every field name is load-bearing**, so renaming one means editing `queries/highlights.scm` and
 rerunning the differential: `state` `name:`, `start`/`rule` `target:`, `encoding` `name:`, `result`
-`type:`, `tape` `index:`/`cells:`, and `rule` `read:`/`write:`/`move:`. Unlike the mini-language
+`type:`, `tape` `index:`/`cells:`, `two_symbol` `symbols:`, and `rule` `read:`/`write:`/`move:`.
+Unlike the mini-language
 grammar, which defines several fields no query reads, there are no spare fields here — telling one
 bare-word token apart by position is the whole mechanism.
diff --git a/grammars/tree-sitter-redextape-tm/grammar.js b/grammars/tree-sitter-redextape-tm/grammar.js
index d448897..4e324df 100644
--- a/grammars/tree-sitter-redextape-tm/grammar.js
+++ b/grammars/tree-sitter-redextape-tm/grammar.js
@@ -96,7 +96,7 @@ module.exports = grammar({
     // give `encoding`'s operand and `result`'s operand DIFFERENT captures (`@variable` and `@type`,
     // both projecting to `Ident`) and `captures_with` does not evaluate query predicates — an
     // `#eq?` on the key would be ignored and would over-capture.
-    _directive: $ => choice($.version, $.encoding, $.width, $.slots, $.result),
+    _directive: $ => choice($.version, $.encoding, $.width, $.slots, $.result, $.reduced, $.steps),
 
     version: $ => seq('version', $.number),
     encoding: $ => seq('encoding', field('name', $.identifier)),
@@ -104,6 +104,24 @@ module.exports = grammar({
     slots: $ => seq('slots', $.number),
     result: $ => seq('result', field('type', $.identifier)),
 
+    // A reduced file's stages. A stage name must NOT be extracted as a keyword of `identifier` (see `word`
+    // above): a keyword is lexed as the whole `identifier` it starts, and `identifier` admits `,`, so the
+    // printer's `fold, single-tape 5` would lex `fold,` as one word and parse as an ERROR.
+    //
+    // `single-tape` and `two-symbol` are safe as they are, because the generator only extracts a token
+    // whose characters are all letters, and `-` is not one. `fold` is all letters, and neither a string
+    // literal nor a bare regex keeps it out: both were tried, and both still parsed `fold,` as an ERROR.
+    // `\r?` does, because `identifier` cannot match a `\r`. It admits nothing the authority refuses:
+    // `parse_tm_full` strips a `\r` from the end of every line, so a stage ending in one was always read.
+    reduced: $ => seq('reduced', $._stage, repeat(seq(',', $._stage))),
+    _stage: $ => choice($.fold, $.single_tape, $.two_symbol),
+    fold: $ => alias(token(/fold\r?/), $.stage),
+    single_tape: $ => seq(alias(token(/single-tape/), $.stage), $.number),
+    // The authority takes the code's symbols as the rest of the line, a `,` among them, and one
+    // `identifier` token is exactly that: it stops only at whitespace or a reserved `; * : [ ]`.
+    two_symbol: $ => seq(alias(token(/two-symbol/), $.stage), field('symbols', $.identifier)),
+    steps: $ => seq('steps', $.number),
+
     // `cells` is optional: `TmHeader::new` drops empty tapes, so a written `tape` line always has a
     // run — but `parse_cells` answers `[]` for an empty one, so the form admits it.
     tape: $ => seq('tape', field('index', $.number), optional(field('cells', $.identifier))),
diff --git a/grammars/tree-sitter-redextape-tm/queries/highlights.scm b/grammars/tree-sitter-redextape-tm/queries/highlights.scm
index c410a44..ea68d7b 100644
--- a/grammars/tree-sitter-redextape-tm/queries/highlights.scm
+++ b/grammars/tree-sitter-redextape-tm/queries/highlights.scm
@@ -26,8 +26,14 @@
   "slots"
   "tape"
   "result"
+  "reduced"
+  "steps"
 ] @keyword
 
+; A reduced file's stage names are keywords to the printer, but tokens of their own here, for the reason
+; the comment on `reduced` in `grammar.js` gives.
+(stage) @keyword
+
 (number) @number
 
 ; A state name in DEFINING position is a `Label`; the same name as a `start` or `goto` target is a
@@ -50,6 +56,7 @@
 ; A packed cell run is ONE span (`write_header`), a symbol inside `[..]` is one span EACH
 ; (`write_syms`). Two nodes, same capture, same class.
 (tape cells: (identifier) @character)
+(two_symbol symbols: (identifier) @character)
 (symbol) @character
 
 (head_move) @constant.builtin
diff --git a/grammars/tree-sitter-redextape-tm/src/grammar.json b/grammars/tree-sitter-redextape-tm/src/grammar.json
index a5e58fb..81c7f5c 100644
--- a/grammars/tree-sitter-redextape-tm/src/grammar.json
+++ b/grammars/tree-sitter-redextape-tm/src/grammar.json
@@ -87,6 +87,14 @@
         {
           "type": "SYMBOL",
           "name": "result"
+        },
+        {
+          "type": "SYMBOL",
+          "name": "reduced"
+        },
+        {
+          "type": "SYMBOL",
+          "name": "steps"
         }
       ]
     },
@@ -163,6 +171,123 @@
         }
       ]
     },
+    "reduced": {
+      "type": "SEQ",
+      "members": [
+        {
+          "type": "STRING",
+          "value": "reduced"
+        },
+        {
+          "type": "SYMBOL",
+          "name": "_stage"
+        },
+        {
+          "type": "REPEAT",
+          "content": {
+            "type": "SEQ",
+            "members": [
+              {
+                "type": "STRING",
+                "value": ","
+              },
+              {
+                "type": "SYMBOL",
+                "name": "_stage"
+              }
+            ]
+          }
+        }
+      ]
+    },
+    "_stage": {
+      "type": "CHOICE",
+      "members": [
+        {
+          "type": "SYMBOL",
+          "name": "fold"
+        },
+        {
+          "type": "SYMBOL",
+          "name": "single_tape"
+        },
+        {
+          "type": "SYMBOL",
+          "name": "two_symbol"
+        }
+      ]
+    },
+    "fold": {
+      "type": "ALIAS",
+      "content": {
+        "type": "TOKEN",
+        "content": {
+          "type": "PATTERN",
+          "value": "fold\\r?"
+        }
+      },
+      "named": true,
+      "value": "stage"
+    },
+    "single_tape": {
+      "type": "SEQ",
+      "members": [
+        {
+          "type": "ALIAS",
+          "content": {
+            "type": "TOKEN",
+            "content": {
+              "type": "PATTERN",
+              "value": "single-tape"
+            }
+          },
+          "named": true,
+          "value": "stage"
+        },
+        {
+          "type": "SYMBOL",
+          "name": "number"
+        }
+      ]
+    },
+    "two_symbol": {
+      "type": "SEQ",
+      "members": [
+        {
+          "type": "ALIAS",
+          "content": {
+            "type": "TOKEN",
+            "content": {
+              "type": "PATTERN",
+              "value": "two-symbol"
+            }
+          },
+          "named": true,
+          "value": "stage"
+        },
+        {
+          "type": "FIELD",
+          "name": "symbols",
+          "content": {
+            "type": "SYMBOL",
+            "name": "identifier"
+          }
+        }
+      ]
+    },
+    "steps": {
+      "type": "SEQ",
+      "members": [
+        {
+          "type": "STRING",
+          "value": "steps"
+        },
+        {
+          "type": "SYMBOL",
+          "name": "number"
+        }
+      ]
+    },
     "tape": {
       "type": "SEQ",
       "members": [
diff --git a/grammars/tree-sitter-redextape-tm/src/node-types.json b/grammars/tree-sitter-redextape-tm/src/node-types.json
index 74e5ca2..bc415b9 100644
--- a/grammars/tree-sitter-redextape-tm/src/node-types.json
+++ b/grammars/tree-sitter-redextape-tm/src/node-types.json
@@ -15,6 +15,21 @@
       }
     }
   },
+  {
+    "type": "fold",
+    "named": true,
+    "fields": {},
+    "children": {
+      "multiple": false,
+      "required": true,
+      "types": [
+        {
+          "type": "stage",
+          "named": true
+        }
+      ]
+    }
+  },
   {
     "type": "group",
     "named": true,
@@ -45,6 +60,29 @@
       ]
     }
   },
+  {
+    "type": "reduced",
+    "named": true,
+    "fields": {},
+    "children": {
+      "multiple": true,
+      "required": true,
+      "types": [
+        {
+          "type": "fold",
+          "named": true
+        },
+        {
+          "type": "single_tape",
+          "named": true
+        },
+        {
+          "type": "two_symbol",
+          "named": true
+        }
+      ]
+    }
+  },
   {
     "type": "result",
     "named": true,
@@ -107,6 +145,25 @@
       }
     }
   },
+  {
+    "type": "single_tape",
+    "named": true,
+    "fields": {},
+    "children": {
+      "multiple": true,
+      "required": true,
+      "types": [
+        {
+          "type": "number",
+          "named": true
+        },
+        {
+          "type": "stage",
+          "named": true
+        }
+      ]
+    }
+  },
   {
     "type": "slots",
     "named": true,
@@ -135,6 +192,10 @@
           "type": "encoding",
           "named": true
         },
+        {
+          "type": "reduced",
+          "named": true
+        },
         {
           "type": "result",
           "named": true
@@ -151,6 +212,10 @@
           "type": "state",
           "named": true
         },
+        {
+          "type": "steps",
+          "named": true
+        },
         {
           "type": "tape",
           "named": true
@@ -212,6 +277,21 @@
       ]
     }
   },
+  {
+    "type": "steps",
+    "named": true,
+    "fields": {},
+    "children": {
+      "multiple": false,
+      "required": true,
+      "types": [
+        {
+          "type": "number",
+          "named": true
+        }
+      ]
+    }
+  },
   {
     "type": "symbol",
     "named": true,
@@ -258,6 +338,32 @@
       ]
     }
   },
+  {
+    "type": "two_symbol",
+    "named": true,
+    "fields": {
+      "symbols": {
+        "multiple": false,
+        "required": true,
+        "types": [
+          {
+            "type": "identifier",
+            "named": true
+          }
+        ]
+      }
+    },
+    "children": {
+      "multiple": false,
+      "required": true,
+      "types": [
+        {
+          "type": "stage",
+          "named": true
+        }
+      ]
+    }
+  },
   {
     "type": "version",
     "named": true,
@@ -345,6 +451,10 @@
     "type": "number",
     "named": true
   },
+  {
+    "type": "reduced",
+    "named": false
+  },
   {
     "type": "result",
     "named": false
@@ -353,6 +463,10 @@
     "type": "slots",
     "named": false
   },
+  {
+    "type": "stage",
+    "named": true
+  },
   {
     "type": "start",
     "named": false
@@ -361,6 +475,10 @@
     "type": "state",
     "named": false
   },
+  {
+    "type": "steps",
+    "named": false
+  },
   {
     "type": "tape",
     "named": false
diff --git a/grammars/tree-sitter-redextape-tm/src/parser.c b/grammars/tree-sitter-redextape-tm/src/parser.c
index be2fc6a..d979149 100644
--- a/grammars/tree-sitter-redextape-tm/src/parser.c
+++ b/grammars/tree-sitter-redextape-tm/src/parser.c
@@ -7,16 +7,16 @@
 #endif
 
 #define LANGUAGE_VERSION 15
-#define STATE_COUNT 49
-#define LARGE_STATE_COUNT 4
-#define SYMBOL_COUNT 45
+#define STATE_COUNT 62
+#define LARGE_STATE_COUNT 2
+#define SYMBOL_COUNT 57
 #define ALIAS_COUNT 0
-#define TOKEN_COUNT 25
+#define TOKEN_COUNT 30
 #define EXTERNAL_TOKEN_COUNT 0
-#define FIELD_COUNT 8
+#define FIELD_COUNT 9
 #define MAX_ALIAS_SEQUENCE_LENGTH 10
 #define MAX_RESERVED_WORD_SET_SIZE 0
-#define PRODUCTION_ID_COUNT 7
+#define PRODUCTION_ID_COUNT 8
 #define SUPERTYPE_COUNT 0
 
 enum ts_symbol_identifiers {
@@ -28,42 +28,54 @@ enum ts_symbol_identifiers {
   anon_sym_width = 6,
   anon_sym_slots = 7,
   anon_sym_result = 8,
-  anon_sym_tape = 9,
-  anon_sym_state = 10,
-  anon_sym_COLON = 11,
-  anon_sym_accept = 12,
-  anon_sym_DASH_GT = 13,
-  anon_sym_write = 14,
-  anon_sym_COMMA = 15,
-  anon_sym_move = 16,
-  anon_sym_goto = 17,
-  anon_sym_LBRACK = 18,
-  anon_sym_RBRACK = 19,
-  anon_sym_STAR = 20,
-  sym__symbol_char = 21,
-  sym_head_move = 22,
-  sym_number = 23,
-  sym_comment = 24,
-  sym_source_file = 25,
-  sym__line = 26,
-  sym_tapes = 27,
-  sym_start = 28,
-  sym__directive = 29,
-  sym_version = 30,
-  sym_encoding = 31,
-  sym_width = 32,
-  sym_slots = 33,
-  sym_result = 34,
-  sym_tape = 35,
-  sym_state = 36,
-  sym_rule = 37,
-  sym_group = 38,
-  sym_move_group = 39,
-  sym_symbol = 40,
-  aux_sym_source_file_repeat1 = 41,
-  aux_sym_state_repeat1 = 42,
-  aux_sym_group_repeat1 = 43,
-  aux_sym_move_group_repeat1 = 44,
+  anon_sym_reduced = 9,
+  anon_sym_COMMA = 10,
+  aux_sym_fold_token1 = 11,
+  aux_sym_single_tape_token1 = 12,
+  aux_sym_two_symbol_token1 = 13,
+  anon_sym_steps = 14,
+  anon_sym_tape = 15,
+  anon_sym_state = 16,
+  anon_sym_COLON = 17,
+  anon_sym_accept = 18,
+  anon_sym_DASH_GT = 19,
+  anon_sym_write = 20,
+  anon_sym_move = 21,
+  anon_sym_goto = 22,
+  anon_sym_LBRACK = 23,
+  anon_sym_RBRACK = 24,
+  anon_sym_STAR = 25,
+  sym__symbol_char = 26,
+  sym_head_move = 27,
+  sym_number = 28,
+  sym_comment = 29,
+  sym_source_file = 30,
+  sym__line = 31,
+  sym_tapes = 32,
+  sym_start = 33,
+  sym__directive = 34,
+  sym_version = 35,
+  sym_encoding = 36,
+  sym_width = 37,
+  sym_slots = 38,
+  sym_result = 39,
+  sym_reduced = 40,
+  sym__stage = 41,
+  sym_fold = 42,
+  sym_single_tape = 43,
+  sym_two_symbol = 44,
+  sym_steps = 45,
+  sym_tape = 46,
+  sym_state = 47,
+  sym_rule = 48,
+  sym_group = 49,
+  sym_move_group = 50,
+  sym_symbol = 51,
+  aux_sym_source_file_repeat1 = 52,
+  aux_sym_reduced_repeat1 = 53,
+  aux_sym_state_repeat1 = 54,
+  aux_sym_group_repeat1 = 55,
+  aux_sym_move_group_repeat1 = 56,
 };
 
 static const char * const ts_symbol_names[] = {
@@ -76,13 +88,18 @@ static const char * const ts_symbol_names[] = {
   [anon_sym_width] = "width",
   [anon_sym_slots] = "slots",
   [anon_sym_result] = "result",
+  [anon_sym_reduced] = "reduced",
+  [anon_sym_COMMA] = ",",
+  [aux_sym_fold_token1] = "stage",
+  [aux_sym_single_tape_token1] = "stage",
+  [aux_sym_two_symbol_token1] = "stage",
+  [anon_sym_steps] = "steps",
   [anon_sym_tape] = "tape",
   [anon_sym_state] = "state",
   [anon_sym_COLON] = ":",
   [anon_sym_accept] = "accept",
   [anon_sym_DASH_GT] = "->",
   [anon_sym_write] = "write",
-  [anon_sym_COMMA] = ",",
   [anon_sym_move] = "move",
   [anon_sym_goto] = "goto",
   [anon_sym_LBRACK] = "[",
@@ -102,6 +119,12 @@ static const char * const ts_symbol_names[] = {
   [sym_width] = "width",
   [sym_slots] = "slots",
   [sym_result] = "result",
+  [sym_reduced] = "reduced",
+  [sym__stage] = "_stage",
+  [sym_fold] = "fold",
+  [sym_single_tape] = "single_tape",
+  [sym_two_symbol] = "two_symbol",
+  [sym_steps] = "steps",
   [sym_tape] = "tape",
   [sym_state] = "state",
   [sym_rule] = "rule",
@@ -109,6 +132,7 @@ static const char * const ts_symbol_names[] = {
   [sym_move_group] = "move_group",
   [sym_symbol] = "symbol",
   [aux_sym_source_file_repeat1] = "source_file_repeat1",
+  [aux_sym_reduced_repeat1] = "reduced_repeat1",
   [aux_sym_state_repeat1] = "state_repeat1",
   [aux_sym_group_repeat1] = "group_repeat1",
   [aux_sym_move_group_repeat1] = "move_group_repeat1",
@@ -124,13 +148,18 @@ static const TSSymbol ts_symbol_map[] = {
   [anon_sym_width] = anon_sym_width,
   [anon_sym_slots] = anon_sym_slots,
   [anon_sym_result] = anon_sym_result,
+  [anon_sym_reduced] = anon_sym_reduced,
+  [anon_sym_COMMA] = anon_sym_COMMA,
+  [aux_sym_fold_token1] = aux_sym_fold_token1,
+  [aux_sym_single_tape_token1] = aux_sym_fold_token1,
+  [aux_sym_two_symbol_token1] = aux_sym_fold_token1,
+  [anon_sym_steps] = anon_sym_steps,
   [anon_sym_tape] = anon_sym_tape,
   [anon_sym_state] = anon_sym_state,
   [anon_sym_COLON] = anon_sym_COLON,
   [anon_sym_accept] = anon_sym_accept,
   [anon_sym_DASH_GT] = anon_sym_DASH_GT,
   [anon_sym_write] = anon_sym_write,
-  [anon_sym_COMMA] = anon_sym_COMMA,
   [anon_sym_move] = anon_sym_move,
   [anon_sym_goto] = anon_sym_goto,
   [anon_sym_LBRACK] = anon_sym_LBRACK,
@@ -150,6 +179,12 @@ static const TSSymbol ts_symbol_map[] = {
   [sym_width] = sym_width,
   [sym_slots] = sym_slots,
   [sym_result] = sym_result,
+  [sym_reduced] = sym_reduced,
+  [sym__stage] = sym__stage,
+  [sym_fold] = sym_fold,
+  [sym_single_tape] = sym_single_tape,
+  [sym_two_symbol] = sym_two_symbol,
+  [sym_steps] = sym_steps,
   [sym_tape] = sym_tape,
   [sym_state] = sym_state,
   [sym_rule] = sym_rule,
@@ -157,6 +192,7 @@ static const TSSymbol ts_symbol_map[] = {
   [sym_move_group] = sym_move_group,
   [sym_symbol] = sym_symbol,
   [aux_sym_source_file_repeat1] = aux_sym_source_file_repeat1,
+  [aux_sym_reduced_repeat1] = aux_sym_reduced_repeat1,
   [aux_sym_state_repeat1] = aux_sym_state_repeat1,
   [aux_sym_group_repeat1] = aux_sym_group_repeat1,
   [aux_sym_move_group_repeat1] = aux_sym_move_group_repeat1,
@@ -199,6 +235,30 @@ static const TSSymbolMetadata ts_symbol_metadata[] = {
     .visible = true,
     .named = false,
   },
+  [anon_sym_reduced] = {
+    .visible = true,
+    .named = false,
+  },
+  [anon_sym_COMMA] = {
+    .visible = true,
+    .named = false,
+  },
+  [aux_sym_fold_token1] = {
+    .visible = true,
+    .named = true,
+  },
+  [aux_sym_single_tape_token1] = {
+    .visible = true,
+    .named = true,
+  },
+  [aux_sym_two_symbol_token1] = {
+    .visible = true,
+    .named = true,
+  },
+  [anon_sym_steps] = {
+    .visible = true,
+    .named = false,
+  },
   [anon_sym_tape] = {
     .visible = true,
     .named = false,
@@ -223,10 +283,6 @@ static const TSSymbolMetadata ts_symbol_metadata[] = {
     .visible = true,
     .named = false,
   },
-  [anon_sym_COMMA] = {
-    .visible = true,
-    .named = false,
-  },
   [anon_sym_move] = {
     .visible = true,
     .named = false,
@@ -303,6 +359,30 @@ static const TSSymbolMetadata ts_symbol_metadata[] = {
     .visible = true,
     .named = true,
   },
+  [sym_reduced] = {
+    .visible = true,
+    .named = true,
+  },
+  [sym__stage] = {
+    .visible = false,
+    .named = true,
+  },
+  [sym_fold] = {
+    .visible = true,
+    .named = true,
+  },
+  [sym_single_tape] = {
+    .visible = true,
+    .named = true,
+  },
+  [sym_two_symbol] = {
+    .visible = true,
+    .named = true,
+  },
+  [sym_steps] = {
+    .visible = true,
+    .named = true,
+  },
   [sym_tape] = {
     .visible = true,
     .named = true,
@@ -331,6 +411,10 @@ static const TSSymbolMetadata ts_symbol_metadata[] = {
     .visible = false,
     .named = false,
   },
+  [aux_sym_reduced_repeat1] = {
+    .visible = false,
+    .named = false,
+  },
   [aux_sym_state_repeat1] = {
     .visible = false,
     .named = false,
@@ -351,9 +435,10 @@ enum ts_field_identifiers {
   field_move = 3,
   field_name = 4,
   field_read = 5,
-  field_target = 6,
-  field_type = 7,
-  field_write = 8,
+  field_symbols = 6,
+  field_target = 7,
+  field_type = 8,
+  field_write = 9,
 };
 
 static const char * const ts_field_names[] = {
@@ -363,6 +448,7 @@ static const char * const ts_field_names[] = {
   [field_move] = "move",
   [field_name] = "name",
   [field_read] = "read",
+  [field_symbols] = "symbols",
   [field_target] = "target",
   [field_type] = "type",
   [field_write] = "write",
@@ -373,8 +459,9 @@ static const TSMapSlice ts_field_map_slices[PRODUCTION_ID_COUNT] = {
   [2] = {.index = 1, .length = 1},
   [3] = {.index = 2, .length = 1},
   [4] = {.index = 3, .length = 1},
-  [5] = {.index = 4, .length = 2},
-  [6] = {.index = 6, .length = 4},
+  [5] = {.index = 4, .length = 1},
+  [6] = {.index = 5, .length = 2},
+  [7] = {.index = 7, .length = 4},
 };
 
 static const TSFieldMapEntry ts_field_map_entries[] = {
@@ -387,9 +474,11 @@ static const TSFieldMapEntry ts_field_map_entries[] = {
   [3] =
     {field_index, 1},
   [4] =
+    {field_symbols, 1},
+  [5] =
     {field_cells, 2},
     {field_index, 1},
-  [6] =
+  [7] =
     {field_move, 6},
     {field_read, 0},
     {field_target, 9},
@@ -454,6 +543,19 @@ static const TSStateId ts_primary_state_ids[STATE_COUNT] = {
   [46] = 46,
   [47] = 47,
   [48] = 48,
+  [49] = 49,
+  [50] = 50,
+  [51] = 51,
+  [52] = 52,
+  [53] = 53,
+  [54] = 54,
+  [55] = 55,
+  [56] = 56,
+  [57] = 57,
+  [58] = 58,
+  [59] = 59,
+  [60] = 60,
+  [61] = 61,
 };
 
 static bool ts_lex(TSLexer *lexer, TSStateId state) {
@@ -461,24 +563,24 @@ static bool ts_lex(TSLexer *lexer, TSStateId state) {
   eof = lexer->eof(lexer);
   switch (state) {
     case 0:
-      if (eof) ADVANCE(5);
-      if (lookahead == '*') ADVANCE(12);
-      if (lookahead == ',') ADVANCE(9);
-      if (lookahead == ':') ADVANCE(6);
-      if (lookahead == ';') ADVANCE(17);
-      if (lookahead == '[') ADVANCE(10);
-      if (lookahead == ']') ADVANCE(11);
+      if (eof) ADVANCE(65);
+      if (lookahead == '*') ADVANCE(98);
+      if (lookahead == ',') ADVANCE(83);
+      if (lookahead == ':') ADVANCE(94);
+      if (lookahead == ';') ADVANCE(142);
+      if (lookahead == '[') ADVANCE(96);
+      if (lookahead == ']') ADVANCE(97);
       if (lookahead == '\t' ||
           lookahead == '\n' ||
           lookahead == '\r' ||
           lookahead == ' ') SKIP(0);
       if (lookahead != 0 &&
-          (lookahead < '\t' || '\r' < lookahead)) ADVANCE(14);
+          (lookahead < '\t' || '\r' < lookahead)) ADVANCE(100);
       END_STATE();
     case 1:
-      if (lookahead == '*') ADVANCE(12);
-      if (lookahead == ';') ADVANCE(17);
-      if (lookahead == ']') ADVANCE(11);
+      if (lookahead == '*') ADVANCE(98);
+      if (lookahead == ';') ADVANCE(142);
+      if (lookahead == ']') ADVANCE(97);
       if (lookahead == '\t' ||
           lookahead == '\n' ||
           lookahead == '\r' ||
@@ -487,26 +589,17 @@ static bool ts_lex(TSLexer *lexer, TSStateId state) {
           (lookahead < '\t' || '\r' < lookahead) &&
           lookahead != ':' &&
           lookahead != ';' &&
-          lookahead != '[') ADVANCE(13);
+          lookahead != '[') ADVANCE(99);
       END_STATE();
     case 2:
-      if (lookahead == ',') ADVANCE(8);
-      if (lookahead == '-') ADVANCE(3);
-      if (lookahead == ';') ADVANCE(17);
-      if (lookahead == '\t' ||
-          lookahead == '\n' ||
-          lookahead == '\r' ||
-          lookahead == ' ') SKIP(2);
-      if (('0' <= lookahead && lookahead <= '9')) ADVANCE(15);
+      if (lookahead == '-') ADVANCE(53);
       END_STATE();
     case 3:
-      if (lookahead == '>') ADVANCE(7);
+      if (lookahead == '-') ADVANCE(58);
       END_STATE();
     case 4:
-      if (eof) ADVANCE(5);
-      if (lookahead == ';') ADVANCE(17);
-      if (lookahead == '[') ADVANCE(10);
-      if (lookahead == ']') ADVANCE(11);
+      if (lookahead == ';') ADVANCE(142);
+      if (lookahead == ']') ADVANCE(97);
       if (lookahead == '\t' ||
           lookahead == '\n' ||
           lookahead == '\r' ||
@@ -515,413 +608,1126 @@ static bool ts_lex(TSLexer *lexer, TSStateId state) {
           (lookahead < '\t' || '\r' < lookahead) &&
           lookahead != '*' &&
           lookahead != ':' &&
-          lookahead != ';') ADVANCE(16);
-      END_STATE();
-    case 5:
-      ACCEPT_TOKEN(ts_builtin_sym_end);
-      END_STATE();
-    case 6:
-      ACCEPT_TOKEN(anon_sym_COLON);
-      END_STATE();
-    case 7:
-      ACCEPT_TOKEN(anon_sym_DASH_GT);
-      END_STATE();
-    case 8:
-      ACCEPT_TOKEN(anon_sym_COMMA);
-      END_STATE();
-    case 9:
-      ACCEPT_TOKEN(anon_sym_COMMA);
-      if (lookahead != 0 &&
-          (lookahead < '\t' || '\r' < lookahead) &&
-          lookahead != ' ' &&
-          lookahead != '*' &&
-          lookahead != ':' &&
-          lookahead != ';' &&
-          lookahead != '[' &&
-          lookahead != ']') ADVANCE(16);
-      END_STATE();
-    case 10:
-      ACCEPT_TOKEN(anon_sym_LBRACK);
-      END_STATE();
-    case 11:
-      ACCEPT_TOKEN(anon_sym_RBRACK);
-      END_STATE();
-    case 12:
-      ACCEPT_TOKEN(anon_sym_STAR);
-      END_STATE();
-    case 13:
-      ACCEPT_TOKEN(sym__symbol_char);
-      END_STATE();
-    case 14:
-      ACCEPT_TOKEN(sym__symbol_char);
-      if (lookahead != 0 &&
-          (lookahead < '\t' || '\r' < lookahead) &&
-          lookahead != ' ' &&
-          lookahead != '*' &&
-          lookahead != ':' &&
-          lookahead != ';' &&
-          lookahead != '[' &&
-          lookahead != ']') ADVANCE(16);
-      END_STATE();
-    case 15:
-      ACCEPT_TOKEN(sym_number);
-      if (('0' <= lookahead && lookahead <= '9')) ADVANCE(15);
-      END_STATE();
-    case 16:
-      ACCEPT_TOKEN(sym_identifier);
-      if (lookahead != 0 &&
-          (lookahead < '\t' || '\r' < lookahead) &&
-          lookahead != ' ' &&
-          lookahead != '*' &&
-          lookahead != ':' &&
           lookahead != ';' &&
-          lookahead != '[' &&
-          lookahead != ']') ADVANCE(16);
-      END_STATE();
-    case 17:
-      ACCEPT_TOKEN(sym_comment);
-      if (lookahead != 0 &&
-          lookahead != '\n') ADVANCE(17);
-      END_STATE();
-    default:
-      return false;
-  }
-}
-
-static bool ts_lex_keywords(TSLexer *lexer, TSStateId state) {
-  START_LEXER();
-  eof = lexer->eof(lexer);
-  switch (state) {
-    case 0:
-      ADVANCE_MAP(
-        'a', 1,
-        'e', 2,
-        'g', 3,
-        'm', 4,
-        'r', 5,
-        's', 6,
-        't', 7,
-        'v', 8,
-        'w', 9,
-        'L', 10,
-        'R', 10,
-        'S', 10,
-      );
-      if (lookahead == '\t' ||
-          lookahead == '\n' ||
-          lookahead == '\r' ||
-          lookahead == ' ') SKIP(0);
-      END_STATE();
-    case 1:
-      if (lookahead == 'c') ADVANCE(11);
-      END_STATE();
-    case 2:
-      if (lookahead == 'n') ADVANCE(12);
-      END_STATE();
-    case 3:
-      if (lookahead == 'o') ADVANCE(13);
-      END_STATE();
-    case 4:
-      if (lookahead == 'o') ADVANCE(14);
+          lookahead != '[') ADVANCE(141);
       END_STATE();
     case 5:
-      if (lookahead == 'e') ADVANCE(15);
+      if (lookahead == '>') ADVANCE(95);
       END_STATE();
     case 6:
-      if (lookahead == 'l') ADVANCE(16);
-      if (lookahead == 't') ADVANCE(17);
+      if (lookahead == 'a') ADVANCE(46);
+      if (lookahead == 'w') ADVANCE(42);
       END_STATE();
     case 7:
-      if (lookahead == 'a') ADVANCE(18);
+      if (lookahead == 'a') ADVANCE(50);
+      if (lookahead == 'e') ADVANCE(47);
       END_STATE();
     case 8:
-      if (lookahead == 'e') ADVANCE(19);
+      if (lookahead == 'a') ADVANCE(48);
       END_STATE();
     case 9:
-      if (lookahead == 'i') ADVANCE(20);
-      if (lookahead == 'r') ADVANCE(21);
+      if (lookahead == 'b') ADVANCE(45);
       END_STATE();
     case 10:
-      ACCEPT_TOKEN(sym_head_move);
+      if (lookahead == 'c') ADVANCE(43);
       END_STATE();
     case 11:
-      if (lookahead == 'c') ADVANCE(22);
+      if (lookahead == 'c') ADVANCE(23);
       END_STATE();
     case 12:
-      if (lookahead == 'c') ADVANCE(23);
+      if (lookahead == 'd') ADVANCE(60);
+      if (lookahead == 's') ADVANCE(61);
       END_STATE();
     case 13:
-      if (lookahead == 't') ADVANCE(24);
+      if (lookahead == 'd') ADVANCE(85);
       END_STATE();
     case 14:
-      if (lookahead == 'v') ADVANCE(25);
+      if (lookahead == 'd') ADVANCE(80);
       END_STATE();
     case 15:
-      if (lookahead == 's') ADVANCE(26);
+      if (lookahead == 'd') ADVANCE(55);
       END_STATE();
     case 16:
-      if (lookahead == 'o') ADVANCE(27);
+      if (lookahead == 'd') ADVANCE(29);
       END_STATE();
     case 17:
-      if (lookahead == 'a') ADVANCE(28);
+      if (lookahead == 'e') ADVANCE(12);
       END_STATE();
     case 18:
-      if (lookahead == 'p') ADVANCE(29);
+      if (lookahead == 'e') ADVANCE(49);
       END_STATE();
     case 19:
-      if (lookahead == 'r') ADVANCE(30);
+      if (lookahead == 'e') ADVANCE(90);
       END_STATE();
     case 20:
-      if (lookahead == 'd') ADVANCE(31);
+      if (lookahead == 'e') ADVANCE(92);
       END_STATE();
     case 21:
-      if (lookahead == 'i') ADVANCE(32);
+      if (lookahead == 'e') ADVANCE(86);
       END_STATE();
     case 22:
-      if (lookahead == 'e') ADVANCE(33);
+      if (lookahead == 'e') ADVANCE(3);
       END_STATE();
     case 23:
-      if (lookahead == 'o') ADVANCE(34);
+      if (lookahead == 'e') ADVANCE(14);
       END_STATE();
     case 24:
-      if (lookahead == 'o') ADVANCE(35);
+      if (lookahead == 'g') ADVANCE(72);
       END_STATE();
     case 25:
-      if (lookahead == 'e') ADVANCE(36);
+      if (lookahead == 'g') ADVANCE(34);
       END_STATE();
     case 26:
-      if (lookahead == 'u') ADVANCE(37);
+      if (lookahead == 'h') ADVANCE(74);
       END_STATE();
     case 27:
-      if (lookahead == 't') ADVANCE(38);
+      if (lookahead == 'i') ADVANCE(15);
       END_STATE();
     case 28:
-      if (lookahead == 'r') ADVANCE(39);
-      if (lookahead == 't') ADVANCE(40);
+      if (lookahead == 'i') ADVANCE(37);
+      if (lookahead == 'l') ADVANCE(41);
+      if (lookahead == 't') ADVANCE(7);
       END_STATE();
     case 29:
-      if (lookahead == 'e') ADVANCE(41);
+      if (lookahead == 'i') ADVANCE(39);
       END_STATE();
     case 30:
-      if (lookahead == 's') ADVANCE(42);
+      if (lookahead == 'i') ADVANCE(44);
       END_STATE();
     case 31:
-      if (lookahead == 't') ADVANCE(43);
+      if (lookahead == 'l') ADVANCE(87);
       END_STATE();
     case 32:
-      if (lookahead == 't') ADVANCE(44);
+      if (lookahead == 'l') ADVANCE(13);
       END_STATE();
     case 33:
-      if (lookahead == 'p') ADVANCE(45);
+      if (lookahead == 'l') ADVANCE(57);
       END_STATE();
     case 34:
-      if (lookahead == 'd') ADVANCE(46);
+      if (lookahead == 'l') ADVANCE(22);
       END_STATE();
     case 35:
-      ACCEPT_TOKEN(anon_sym_goto);
+      if (lookahead == 'm') ADVANCE(9);
       END_STATE();
     case 36:
-      ACCEPT_TOKEN(anon_sym_move);
+      if (lookahead == 'n') ADVANCE(10);
       END_STATE();
     case 37:
-      if (lookahead == 'l') ADVANCE(47);
+      if (lookahead == 'n') ADVANCE(25);
       END_STATE();
     case 38:
-      if (lookahead == 's') ADVANCE(48);
+      if (lookahead == 'n') ADVANCE(70);
       END_STATE();
     case 39:
-      if (lookahead == 't') ADVANCE(49);
+      if (lookahead == 'n') ADVANCE(24);
       END_STATE();
     case 40:
-      if (lookahead == 'e') ADVANCE(50);
+      if (lookahead == 'o') ADVANCE(32);
       END_STATE();
     case 41:
-      ACCEPT_TOKEN(anon_sym_tape);
-      if (lookahead == 's') ADVANCE(51);
+      if (lookahead == 'o') ADVANCE(59);
       END_STATE();
     case 42:
-      if (lookahead == 'i') ADVANCE(52);
+      if (lookahead == 'o') ADVANCE(2);
       END_STATE();
     case 43:
-      if (lookahead == 'h') ADVANCE(53);
+      if (lookahead == 'o') ADVANCE(16);
       END_STATE();
     case 44:
-      if (lookahead == 'e') ADVANCE(54);
+      if (lookahead == 'o') ADVANCE(38);
       END_STATE();
     case 45:
-      if (lookahead == 't') ADVANCE(55);
+      if (lookahead == 'o') ADVANCE(31);
       END_STATE();
     case 46:
-      if (lookahead == 'i') ADVANCE(56);
+      if (lookahead == 'p') ADVANCE(19);
       END_STATE();
     case 47:
-      if (lookahead == 't') ADVANCE(57);
+      if (lookahead == 'p') ADVANCE(52);
       END_STATE();
     case 48:
-      ACCEPT_TOKEN(anon_sym_slots);
+      if (lookahead == 'p') ADVANCE(21);
       END_STATE();
     case 49:
-      ACCEPT_TOKEN(anon_sym_start);
+      if (lookahead == 'r') ADVANCE(54);
       END_STATE();
     case 50:
-      ACCEPT_TOKEN(anon_sym_state);
+      if (lookahead == 'r') ADVANCE(56);
+      if (lookahead == 't') ADVANCE(20);
       END_STATE();
     case 51:
-      ACCEPT_TOKEN(anon_sym_tapes);
+      if (lookahead == 's') ADVANCE(76);
       END_STATE();
     case 52:
-      if (lookahead == 'o') ADVANCE(58);
+      if (lookahead == 's') ADVANCE(88);
       END_STATE();
     case 53:
-      ACCEPT_TOKEN(anon_sym_width);
+      if (lookahead == 's') ADVANCE(62);
       END_STATE();
     case 54:
-      ACCEPT_TOKEN(anon_sym_write);
+      if (lookahead == 's') ADVANCE(30);
       END_STATE();
     case 55:
-      ACCEPT_TOKEN(anon_sym_accept);
+      if (lookahead == 't') ADVANCE(26);
       END_STATE();
     case 56:
-      if (lookahead == 'n') ADVANCE(59);
+      if (lookahead == 't') ADVANCE(68);
       END_STATE();
     case 57:
-      ACCEPT_TOKEN(anon_sym_result);
+      if (lookahead == 't') ADVANCE(78);
       END_STATE();
     case 58:
-      if (lookahead == 'n') ADVANCE(60);
+      if (lookahead == 't') ADVANCE(8);
       END_STATE();
     case 59:
-      if (lookahead == 'g') ADVANCE(61);
+      if (lookahead == 't') ADVANCE(51);
       END_STATE();
     case 60:
-      ACCEPT_TOKEN(anon_sym_version);
+      if (lookahead == 'u') ADVANCE(11);
       END_STATE();
     case 61:
+      if (lookahead == 'u') ADVANCE(33);
+      END_STATE();
+    case 62:
+      if (lookahead == 'y') ADVANCE(35);
+      END_STATE();
+    case 63:
+      if (eof) ADVANCE(65);
+      ADVANCE_MAP(
+        ',', 82,
+        '-', 5,
+        ';', 142,
+        '[', 96,
+        'e', 36,
+        'f', 40,
+        'r', 17,
+        's', 28,
+        't', 6,
+        'v', 18,
+        'w', 27,
+      );
+      if (lookahead == '\t' ||
+          lookahead == '\n' ||
+          lookahead == '\r' ||
+          lookahead == ' ') SKIP(63);
+      if (('0' <= lookahead && lookahead <= '9')) ADVANCE(101);
+      END_STATE();
+    case 64:
+      if (eof) ADVANCE(65);
+      ADVANCE_MAP(
+        ';', 142,
+        '[', 96,
+        'e', 122,
+        'r', 110,
+        's', 120,
+        't', 102,
+        'v', 111,
+        'w', 117,
+      );
+      if (lookahead == '\t' ||
+          lookahead == '\n' ||
+          lookahead == '\r' ||
+          lookahead == ' ') SKIP(64);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 65:
+      ACCEPT_TOKEN(ts_builtin_sym_end);
+      END_STATE();
+    case 66:
+      ACCEPT_TOKEN(anon_sym_tapes);
+      END_STATE();
+    case 67:
+      ACCEPT_TOKEN(anon_sym_tapes);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 68:
+      ACCEPT_TOKEN(anon_sym_start);
+      END_STATE();
+    case 69:
+      ACCEPT_TOKEN(anon_sym_start);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 70:
+      ACCEPT_TOKEN(anon_sym_version);
+      END_STATE();
+    case 71:
+      ACCEPT_TOKEN(anon_sym_version);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 72:
       ACCEPT_TOKEN(anon_sym_encoding);
       END_STATE();
-    default:
-      return false;
-  }
-}
-
-static const TSLexerMode ts_lex_modes[STATE_COUNT] = {
-  [0] = {.lex_state = 0},
-  [1] = {.lex_state = 4},
-  [2] = {.lex_state = 4},
-  [3] = {.lex_state = 4},
-  [4] = {.lex_state = 4},
-  [5] = {.lex_state = 4},
-  [6] = {.lex_state = 4},
-  [7] = {.lex_state = 4},
-  [8] = {.lex_state = 4},
-  [9] = {.lex_state = 4},
-  [10] = {.lex_state = 4},
-  [11] = {.lex_state = 4},
-  [12] = {.lex_state = 4},
-  [13] = {.lex_state = 4},
-  [14] = {.lex_state = 4},
-  [15] = {.lex_state = 4},
-  [16] = {.lex_state = 4},
-  [17] = {.lex_state = 4},
-  [18] = {.lex_state = 1},
-  [19] = {.lex_state = 1},
-  [20] = {.lex_state = 1},
-  [21] = {.lex_state = 4},
-  [22] = {.lex_state = 1},
-  [23] = {.lex_state = 4},
-  [24] = {.lex_state = 4},
-  [25] = {.lex_state = 2},
-  [26] = {.lex_state = 2},
-  [27] = {.lex_state = 0},
-  [28] = {.lex_state = 0},
-  [29] = {.lex_state = 2},
-  [30] = {.lex_state = 0},
-  [31] = {.lex_state = 2},
-  [32] = {.lex_state = 2},
-  [33] = {.lex_state = 4},
-  [34] = {.lex_state = 2},
-  [35] = {.lex_state = 2},
-  [36] = {.lex_state = 4},
-  [37] = {.lex_state = 4},
-  [38] = {.lex_state = 2},
-  [39] = {.lex_state = 0},
-  [40] = {.lex_state = 2},
-  [41] = {.lex_state = 4},
-  [42] = {.lex_state = 2},
-  [43] = {.lex_state = 2},
-  [44] = {.lex_state = 4},
-  [45] = {.lex_state = 2},
-  [46] = {.lex_state = 4},
-  [47] = {.lex_state = 4},
-  [48] = {.lex_state = 4},
-};
-
-static const uint16_t ts_parse_table[LARGE_STATE_COUNT][SYMBOL_COUNT] = {
-  [STATE(0)] = {
-    [ts_builtin_sym_end] = ACTIONS(1),
-    [sym_identifier] = ACTIONS(1),
-    [anon_sym_tapes] = ACTIONS(1),
-    [anon_sym_start] = ACTIONS(1),
-    [anon_sym_version] = ACTIONS(1),
-    [anon_sym_encoding] = ACTIONS(1),
-    [anon_sym_width] = ACTIONS(1),
-    [anon_sym_slots] = ACTIONS(1),
-    [anon_sym_result] = ACTIONS(1),
-    [anon_sym_tape] = ACTIONS(1),
-    [anon_sym_state] = ACTIONS(1),
-    [anon_sym_COLON] = ACTIONS(1),
-    [anon_sym_accept] = ACTIONS(1),
-    [anon_sym_write] = ACTIONS(1),
-    [anon_sym_COMMA] = ACTIONS(1),
-    [anon_sym_move] = ACTIONS(1),
-    [anon_sym_goto] = ACTIONS(1),
-    [anon_sym_LBRACK] = ACTIONS(1),
-    [anon_sym_RBRACK] = ACTIONS(1),
-    [anon_sym_STAR] = ACTIONS(1),
-    [sym__symbol_char] = ACTIONS(1),
-    [sym_head_move] = ACTIONS(1),
-    [sym_comment] = ACTIONS(3),
-  },
-  [STATE(1)] = {
-    [sym_source_file] = STATE(30),
-    [sym__line] = STATE(2),
-    [sym_tapes] = STATE(2),
-    [sym_start] = STATE(2),
-    [sym__directive] = STATE(2),
-    [sym_version] = STATE(2),
-    [sym_encoding] = STATE(2),
-    [sym_width] = STATE(2),
-    [sym_slots] = STATE(2),
-    [sym_result] = STATE(2),
-    [sym_tape] = STATE(2),
-    [sym_state] = STATE(2),
-    [aux_sym_source_file_repeat1] = STATE(2),
-    [ts_builtin_sym_end] = ACTIONS(5),
-    [anon_sym_tapes] = ACTIONS(7),
-    [anon_sym_start] = ACTIONS(9),
-    [anon_sym_version] = ACTIONS(11),
-    [anon_sym_encoding] = ACTIONS(13),
-    [anon_sym_width] = ACTIONS(15),
-    [anon_sym_slots] = ACTIONS(17),
-    [anon_sym_result] = ACTIONS(19),
-    [anon_sym_tape] = ACTIONS(21),
-    [anon_sym_state] = ACTIONS(23),
+    case 73:
+      ACCEPT_TOKEN(anon_sym_encoding);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 74:
+      ACCEPT_TOKEN(anon_sym_width);
+      END_STATE();
+    case 75:
+      ACCEPT_TOKEN(anon_sym_width);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 76:
+      ACCEPT_TOKEN(anon_sym_slots);
+      END_STATE();
+    case 77:
+      ACCEPT_TOKEN(anon_sym_slots);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 78:
+      ACCEPT_TOKEN(anon_sym_result);
+      END_STATE();
+    case 79:
+      ACCEPT_TOKEN(anon_sym_result);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 80:
+      ACCEPT_TOKEN(anon_sym_reduced);
+      END_STATE();
+    case 81:
+      ACCEPT_TOKEN(anon_sym_reduced);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 82:
+      ACCEPT_TOKEN(anon_sym_COMMA);
+      END_STATE();
+    case 83:
+      ACCEPT_TOKEN(anon_sym_COMMA);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 84:
+      ACCEPT_TOKEN(aux_sym_fold_token1);
+      END_STATE();
+    case 85:
+      ACCEPT_TOKEN(aux_sym_fold_token1);
+      if (lookahead == '\r') ADVANCE(84);
+      END_STATE();
+    case 86:
+      ACCEPT_TOKEN(aux_sym_single_tape_token1);
+      END_STATE();
+    case 87:
+      ACCEPT_TOKEN(aux_sym_two_symbol_token1);
+      END_STATE();
+    case 88:
+      ACCEPT_TOKEN(anon_sym_steps);
+      END_STATE();
+    case 89:
+      ACCEPT_TOKEN(anon_sym_steps);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 90:
+      ACCEPT_TOKEN(anon_sym_tape);
+      if (lookahead == 's') ADVANCE(66);
+      END_STATE();
+    case 91:
+      ACCEPT_TOKEN(anon_sym_tape);
+      if (lookahead == 's') ADVANCE(67);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 92:
+      ACCEPT_TOKEN(anon_sym_state);
+      END_STATE();
+    case 93:
+      ACCEPT_TOKEN(anon_sym_state);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 94:
+      ACCEPT_TOKEN(anon_sym_COLON);
+      END_STATE();
+    case 95:
+      ACCEPT_TOKEN(anon_sym_DASH_GT);
+      END_STATE();
+    case 96:
+      ACCEPT_TOKEN(anon_sym_LBRACK);
+      END_STATE();
+    case 97:
+      ACCEPT_TOKEN(anon_sym_RBRACK);
+      END_STATE();
+    case 98:
+      ACCEPT_TOKEN(anon_sym_STAR);
+      END_STATE();
+    case 99:
+      ACCEPT_TOKEN(sym__symbol_char);
+      END_STATE();
+    case 100:
+      ACCEPT_TOKEN(sym__symbol_char);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 101:
+      ACCEPT_TOKEN(sym_number);
+      if (('0' <= lookahead && lookahead <= '9')) ADVANCE(101);
+      END_STATE();
+    case 102:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'a') ADVANCE(128);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 103:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'a') ADVANCE(131);
+      if (lookahead == 'e') ADVANCE(129);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 104:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'c') ADVANCE(126);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 105:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'c') ADVANCE(114);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 106:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'd') ADVANCE(140);
+      if (lookahead == 's') ADVANCE(139);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 107:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'd') ADVANCE(81);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 108:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'd') ADVANCE(135);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 109:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'd') ADVANCE(118);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 110:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'e') ADVANCE(106);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 111:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'e') ADVANCE(130);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 112:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'e') ADVANCE(91);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 113:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'e') ADVANCE(93);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 114:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'e') ADVANCE(107);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 115:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'g') ADVANCE(73);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 116:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'h') ADVANCE(75);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 117:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'i') ADVANCE(108);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 118:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'i') ADVANCE(123);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 119:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'i') ADVANCE(127);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 120:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'l') ADVANCE(125);
+      if (lookahead == 't') ADVANCE(103);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 121:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'l') ADVANCE(137);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 122:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'n') ADVANCE(104);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 123:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'n') ADVANCE(115);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 124:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'n') ADVANCE(71);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 125:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'o') ADVANCE(138);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 126:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'o') ADVANCE(109);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 127:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'o') ADVANCE(124);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 128:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'p') ADVANCE(112);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 129:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'p') ADVANCE(133);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 130:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'r') ADVANCE(134);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 131:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'r') ADVANCE(136);
+      if (lookahead == 't') ADVANCE(113);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 132:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 's') ADVANCE(77);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 133:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 's') ADVANCE(89);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 134:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 's') ADVANCE(119);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 135:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 't') ADVANCE(116);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 136:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 't') ADVANCE(69);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 137:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 't') ADVANCE(79);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 138:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 't') ADVANCE(132);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 139:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'u') ADVANCE(121);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 140:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead == 'u') ADVANCE(105);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 141:
+      ACCEPT_TOKEN(sym_identifier);
+      if (lookahead != 0 &&
+          (lookahead < '\t' || '\r' < lookahead) &&
+          lookahead != ' ' &&
+          lookahead != '*' &&
+          lookahead != ':' &&
+          lookahead != ';' &&
+          lookahead != '[' &&
+          lookahead != ']') ADVANCE(141);
+      END_STATE();
+    case 142:
+      ACCEPT_TOKEN(sym_comment);
+      if (lookahead != 0 &&
+          lookahead != '\n') ADVANCE(142);
+      END_STATE();
+    default:
+      return false;
+  }
+}
+
+static bool ts_lex_keywords(TSLexer *lexer, TSStateId state) {
+  START_LEXER();
+  eof = lexer->eof(lexer);
+  switch (state) {
+    case 0:
+      if (lookahead == 'a') ADVANCE(1);
+      if (lookahead == 'g') ADVANCE(2);
+      if (lookahead == 'm') ADVANCE(3);
+      if (lookahead == 'w') ADVANCE(4);
+      if (lookahead == 'L' ||
+          lookahead == 'R' ||
+          lookahead == 'S') ADVANCE(5);
+      if (lookahead == '\t' ||
+          lookahead == '\n' ||
+          lookahead == '\r' ||
+          lookahead == ' ') SKIP(0);
+      END_STATE();
+    case 1:
+      if (lookahead == 'c') ADVANCE(6);
+      END_STATE();
+    case 2:
+      if (lookahead == 'o') ADVANCE(7);
+      END_STATE();
+    case 3:
+      if (lookahead == 'o') ADVANCE(8);
+      END_STATE();
+    case 4:
+      if (lookahead == 'r') ADVANCE(9);
+      END_STATE();
+    case 5:
+      ACCEPT_TOKEN(sym_head_move);
+      END_STATE();
+    case 6:
+      if (lookahead == 'c') ADVANCE(10);
+      END_STATE();
+    case 7:
+      if (lookahead == 't') ADVANCE(11);
+      END_STATE();
+    case 8:
+      if (lookahead == 'v') ADVANCE(12);
+      END_STATE();
+    case 9:
+      if (lookahead == 'i') ADVANCE(13);
+      END_STATE();
+    case 10:
+      if (lookahead == 'e') ADVANCE(14);
+      END_STATE();
+    case 11:
+      if (lookahead == 'o') ADVANCE(15);
+      END_STATE();
+    case 12:
+      if (lookahead == 'e') ADVANCE(16);
+      END_STATE();
+    case 13:
+      if (lookahead == 't') ADVANCE(17);
+      END_STATE();
+    case 14:
+      if (lookahead == 'p') ADVANCE(18);
+      END_STATE();
+    case 15:
+      ACCEPT_TOKEN(anon_sym_goto);
+      END_STATE();
+    case 16:
+      ACCEPT_TOKEN(anon_sym_move);
+      END_STATE();
+    case 17:
+      if (lookahead == 'e') ADVANCE(19);
+      END_STATE();
+    case 18:
+      if (lookahead == 't') ADVANCE(20);
+      END_STATE();
+    case 19:
+      ACCEPT_TOKEN(anon_sym_write);
+      END_STATE();
+    case 20:
+      ACCEPT_TOKEN(anon_sym_accept);
+      END_STATE();
+    default:
+      return false;
+  }
+}
+
+static const TSLexerMode ts_lex_modes[STATE_COUNT] = {
+  [0] = {.lex_state = 0},
+  [1] = {.lex_state = 63},
+  [2] = {.lex_state = 63},
+  [3] = {.lex_state = 63},
+  [4] = {.lex_state = 64},
+  [5] = {.lex_state = 63},
+  [6] = {.lex_state = 63},
+  [7] = {.lex_state = 63},
+  [8] = {.lex_state = 63},
+  [9] = {.lex_state = 63},
+  [10] = {.lex_state = 63},
+  [11] = {.lex_state = 64},
+  [12] = {.lex_state = 63},
+  [13] = {.lex_state = 63},
+  [14] = {.lex_state = 63},
+  [15] = {.lex_state = 63},
+  [16] = {.lex_state = 63},
+  [17] = {.lex_state = 63},
+  [18] = {.lex_state = 63},
+  [19] = {.lex_state = 63},
+  [20] = {.lex_state = 63},
+  [21] = {.lex_state = 63},
+  [22] = {.lex_state = 63},
+  [23] = {.lex_state = 63},
+  [24] = {.lex_state = 63},
+  [25] = {.lex_state = 63},
+  [26] = {.lex_state = 63},
+  [27] = {.lex_state = 63},
+  [28] = {.lex_state = 1},
+  [29] = {.lex_state = 1},
+  [30] = {.lex_state = 1},
+  [31] = {.lex_state = 1},
+  [32] = {.lex_state = 4},
+  [33] = {.lex_state = 4},
+  [34] = {.lex_state = 4},
+  [35] = {.lex_state = 0},
+  [36] = {.lex_state = 63},
+  [37] = {.lex_state = 63},
+  [38] = {.lex_state = 0},
+  [39] = {.lex_state = 4},
+  [40] = {.lex_state = 4},
+  [41] = {.lex_state = 63},
+  [42] = {.lex_state = 63},
+  [43] = {.lex_state = 63},
+  [44] = {.lex_state = 4},
+  [45] = {.lex_state = 0},
+  [46] = {.lex_state = 4},
+  [47] = {.lex_state = 63},
+  [48] = {.lex_state = 0},
+  [49] = {.lex_state = 4},
+  [50] = {.lex_state = 63},
+  [51] = {.lex_state = 63},
+  [52] = {.lex_state = 4},
+  [53] = {.lex_state = 63},
+  [54] = {.lex_state = 63},
+  [55] = {.lex_state = 63},
+  [56] = {.lex_state = 4},
+  [57] = {.lex_state = 4},
+  [58] = {.lex_state = 63},
+  [59] = {.lex_state = 63},
+  [60] = {.lex_state = 4},
+  [61] = {.lex_state = 63},
+};
+
+static const uint16_t ts_parse_table[LARGE_STATE_COUNT][SYMBOL_COUNT] = {
+  [STATE(0)] = {
+    [ts_builtin_sym_end] = ACTIONS(1),
+    [sym_identifier] = ACTIONS(1),
+    [anon_sym_COMMA] = ACTIONS(1),
+    [anon_sym_COLON] = ACTIONS(1),
+    [anon_sym_accept] = ACTIONS(1),
+    [anon_sym_write] = ACTIONS(1),
+    [anon_sym_move] = ACTIONS(1),
+    [anon_sym_goto] = ACTIONS(1),
+    [anon_sym_LBRACK] = ACTIONS(1),
+    [anon_sym_RBRACK] = ACTIONS(1),
+    [anon_sym_STAR] = ACTIONS(1),
+    [sym__symbol_char] = ACTIONS(1),
+    [sym_head_move] = ACTIONS(1),
     [sym_comment] = ACTIONS(3),
   },
-  [STATE(2)] = {
-    [sym__line] = STATE(3),
-    [sym_tapes] = STATE(3),
-    [sym_start] = STATE(3),
-    [sym__directive] = STATE(3),
-    [sym_version] = STATE(3),
-    [sym_encoding] = STATE(3),
-    [sym_width] = STATE(3),
-    [sym_slots] = STATE(3),
-    [sym_result] = STATE(3),
-    [sym_tape] = STATE(3),
-    [sym_state] = STATE(3),
-    [aux_sym_source_file_repeat1] = STATE(3),
-    [ts_builtin_sym_end] = ACTIONS(25),
+  [STATE(1)] = {
+    [sym_source_file] = STATE(48),
+    [sym__line] = STATE(2),
+    [sym_tapes] = STATE(2),
+    [sym_start] = STATE(2),
+    [sym__directive] = STATE(2),
+    [sym_version] = STATE(2),
+    [sym_encoding] = STATE(2),
+    [sym_width] = STATE(2),
+    [sym_slots] = STATE(2),
+    [sym_result] = STATE(2),
+    [sym_reduced] = STATE(2),
+    [sym_steps] = STATE(2),
+    [sym_tape] = STATE(2),
+    [sym_state] = STATE(2),
+    [aux_sym_source_file_repeat1] = STATE(2),
+    [ts_builtin_sym_end] = ACTIONS(5),
     [anon_sym_tapes] = ACTIONS(7),
     [anon_sym_start] = ACTIONS(9),
     [anon_sym_version] = ACTIONS(11),
@@ -929,53 +1735,114 @@ static const uint16_t ts_parse_table[LARGE_STATE_COUNT][SYMBOL_COUNT] = {
     [anon_sym_width] = ACTIONS(15),
     [anon_sym_slots] = ACTIONS(17),
     [anon_sym_result] = ACTIONS(19),
-    [anon_sym_tape] = ACTIONS(21),
-    [anon_sym_state] = ACTIONS(23),
-    [sym_comment] = ACTIONS(3),
-  },
-  [STATE(3)] = {
-    [sym__line] = STATE(3),
-    [sym_tapes] = STATE(3),
-    [sym_start] = STATE(3),
-    [sym__directive] = STATE(3),
-    [sym_version] = STATE(3),
-    [sym_encoding] = STATE(3),
-    [sym_width] = STATE(3),
-    [sym_slots] = STATE(3),
-    [sym_result] = STATE(3),
-    [sym_tape] = STATE(3),
-    [sym_state] = STATE(3),
-    [aux_sym_source_file_repeat1] = STATE(3),
-    [ts_builtin_sym_end] = ACTIONS(27),
-    [anon_sym_tapes] = ACTIONS(29),
-    [anon_sym_start] = ACTIONS(32),
-    [anon_sym_version] = ACTIONS(35),
-    [anon_sym_encoding] = ACTIONS(38),
-    [anon_sym_width] = ACTIONS(41),
-    [anon_sym_slots] = ACTIONS(44),
-    [anon_sym_result] = ACTIONS(47),
-    [anon_sym_tape] = ACTIONS(50),
-    [anon_sym_state] = ACTIONS(53),
+    [anon_sym_reduced] = ACTIONS(21),
+    [anon_sym_steps] = ACTIONS(23),
+    [anon_sym_tape] = ACTIONS(25),
+    [anon_sym_state] = ACTIONS(27),
     [sym_comment] = ACTIONS(3),
   },
 };
 
 static const uint16_t ts_small_parse_table[] = {
-  [0] = 7,
+  [0] = 14,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(58), 1,
+    ACTIONS(7), 1,
+      anon_sym_tapes,
+    ACTIONS(9), 1,
+      anon_sym_start,
+    ACTIONS(11), 1,
+      anon_sym_version,
+    ACTIONS(13), 1,
+      anon_sym_encoding,
+    ACTIONS(15), 1,
+      anon_sym_width,
+    ACTIONS(17), 1,
+      anon_sym_slots,
+    ACTIONS(19), 1,
+      anon_sym_result,
+    ACTIONS(21), 1,
+      anon_sym_reduced,
+    ACTIONS(23), 1,
+      anon_sym_steps,
+    ACTIONS(25), 1,
       anon_sym_tape,
+    ACTIONS(27), 1,
+      anon_sym_state,
+    ACTIONS(29), 1,
+      ts_builtin_sym_end,
+    STATE(3), 14,
+      sym__line,
+      sym_tapes,
+      sym_start,
+      sym__directive,
+      sym_version,
+      sym_encoding,
+      sym_width,
+      sym_slots,
+      sym_result,
+      sym_reduced,
+      sym_steps,
+      sym_tape,
+      sym_state,
+      aux_sym_source_file_repeat1,
+  [56] = 14,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(31), 1,
+      ts_builtin_sym_end,
+    ACTIONS(33), 1,
+      anon_sym_tapes,
+    ACTIONS(36), 1,
+      anon_sym_start,
+    ACTIONS(39), 1,
+      anon_sym_version,
+    ACTIONS(42), 1,
+      anon_sym_encoding,
+    ACTIONS(45), 1,
+      anon_sym_width,
+    ACTIONS(48), 1,
+      anon_sym_slots,
+    ACTIONS(51), 1,
+      anon_sym_result,
+    ACTIONS(54), 1,
+      anon_sym_reduced,
+    ACTIONS(57), 1,
+      anon_sym_steps,
     ACTIONS(60), 1,
+      anon_sym_tape,
+    ACTIONS(63), 1,
+      anon_sym_state,
+    STATE(3), 14,
+      sym__line,
+      sym_tapes,
+      sym_start,
+      sym__directive,
+      sym_version,
+      sym_encoding,
+      sym_width,
+      sym_slots,
+      sym_result,
+      sym_reduced,
+      sym_steps,
+      sym_tape,
+      sym_state,
+      aux_sym_source_file_repeat1,
+  [112] = 7,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(68), 1,
+      anon_sym_tape,
+    ACTIONS(70), 1,
       anon_sym_accept,
-    ACTIONS(62), 1,
+    ACTIONS(72), 1,
       anon_sym_LBRACK,
-    STATE(31), 1,
+    STATE(41), 1,
       sym_group,
-    STATE(5), 2,
+    STATE(6), 2,
       sym_rule,
       aux_sym_state_repeat1,
-    ACTIONS(56), 9,
+    ACTIONS(66), 11,
       ts_builtin_sym_end,
       anon_sym_tapes,
       anon_sym_start,
@@ -984,20 +1851,22 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
       anon_sym_state,
-  [31] = 6,
+  [145] = 6,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(62), 1,
-      anon_sym_LBRACK,
-    ACTIONS(66), 1,
+    ACTIONS(76), 1,
       anon_sym_tape,
-    STATE(31), 1,
+    ACTIONS(78), 1,
+      anon_sym_LBRACK,
+    STATE(41), 1,
       sym_group,
-    STATE(6), 2,
+    STATE(5), 2,
       sym_rule,
       aux_sym_state_repeat1,
-    ACTIONS(64), 9,
+    ACTIONS(74), 11,
       ts_builtin_sym_end,
       anon_sym_tapes,
       anon_sym_start,
@@ -1006,20 +1875,102 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
       anon_sym_state,
-  [59] = 6,
+  [175] = 6,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(70), 1,
-      anon_sym_tape,
     ACTIONS(72), 1,
       anon_sym_LBRACK,
-    STATE(31), 1,
+    ACTIONS(83), 1,
+      anon_sym_tape,
+    STATE(41), 1,
       sym_group,
-    STATE(6), 2,
+    STATE(5), 2,
       sym_rule,
       aux_sym_state_repeat1,
-    ACTIONS(68), 9,
+    ACTIONS(81), 11,
+      ts_builtin_sym_end,
+      anon_sym_tapes,
+      anon_sym_start,
+      anon_sym_version,
+      anon_sym_encoding,
+      anon_sym_width,
+      anon_sym_slots,
+      anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
+      anon_sym_state,
+  [205] = 5,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(87), 1,
+      anon_sym_COMMA,
+    ACTIONS(89), 1,
+      anon_sym_tape,
+    STATE(9), 1,
+      aux_sym_reduced_repeat1,
+    ACTIONS(85), 11,
+      ts_builtin_sym_end,
+      anon_sym_tapes,
+      anon_sym_start,
+      anon_sym_version,
+      anon_sym_encoding,
+      anon_sym_width,
+      anon_sym_slots,
+      anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
+      anon_sym_state,
+  [231] = 5,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(87), 1,
+      anon_sym_COMMA,
+    ACTIONS(93), 1,
+      anon_sym_tape,
+    STATE(7), 1,
+      aux_sym_reduced_repeat1,
+    ACTIONS(91), 11,
+      ts_builtin_sym_end,
+      anon_sym_tapes,
+      anon_sym_start,
+      anon_sym_version,
+      anon_sym_encoding,
+      anon_sym_width,
+      anon_sym_slots,
+      anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
+      anon_sym_state,
+  [257] = 5,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(97), 1,
+      anon_sym_COMMA,
+    ACTIONS(100), 1,
+      anon_sym_tape,
+    STATE(9), 1,
+      aux_sym_reduced_repeat1,
+    ACTIONS(95), 11,
+      ts_builtin_sym_end,
+      anon_sym_tapes,
+      anon_sym_start,
+      anon_sym_version,
+      anon_sym_encoding,
+      anon_sym_width,
+      anon_sym_slots,
+      anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
+      anon_sym_state,
+  [283] = 3,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(104), 1,
+      anon_sym_tape,
+    ACTIONS(102), 12,
       ts_builtin_sym_end,
       anon_sym_tapes,
       anon_sym_start,
@@ -1028,15 +1979,18 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_COMMA,
+      anon_sym_steps,
       anon_sym_state,
-  [87] = 4,
+  [304] = 4,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(75), 1,
+    ACTIONS(106), 1,
       ts_builtin_sym_end,
-    ACTIONS(77), 1,
+    ACTIONS(108), 1,
       sym_identifier,
-    ACTIONS(79), 9,
+    ACTIONS(110), 11,
       anon_sym_tapes,
       anon_sym_start,
       anon_sym_version,
@@ -1044,14 +1998,70 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
       anon_sym_tape,
       anon_sym_state,
-  [108] = 3,
+  [327] = 3,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(83), 1,
+    ACTIONS(114), 1,
+      anon_sym_tape,
+    ACTIONS(112), 12,
+      ts_builtin_sym_end,
+      anon_sym_tapes,
+      anon_sym_start,
+      anon_sym_version,
+      anon_sym_encoding,
+      anon_sym_width,
+      anon_sym_slots,
+      anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_COMMA,
+      anon_sym_steps,
+      anon_sym_state,
+  [348] = 3,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(118), 1,
+      anon_sym_tape,
+    ACTIONS(116), 12,
+      ts_builtin_sym_end,
+      anon_sym_tapes,
+      anon_sym_start,
+      anon_sym_version,
+      anon_sym_encoding,
+      anon_sym_width,
+      anon_sym_slots,
+      anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_COMMA,
+      anon_sym_steps,
+      anon_sym_state,
+  [369] = 3,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(100), 1,
+      anon_sym_tape,
+    ACTIONS(95), 12,
+      ts_builtin_sym_end,
+      anon_sym_tapes,
+      anon_sym_start,
+      anon_sym_version,
+      anon_sym_encoding,
+      anon_sym_width,
+      anon_sym_slots,
+      anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_COMMA,
+      anon_sym_steps,
+      anon_sym_state,
+  [390] = 3,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(122), 1,
       anon_sym_tape,
-    ACTIONS(81), 10,
+    ACTIONS(120), 12,
       ts_builtin_sym_end,
       anon_sym_tapes,
       anon_sym_start,
@@ -1060,14 +2070,33 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
       anon_sym_state,
       anon_sym_LBRACK,
-  [127] = 3,
+  [411] = 3,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(87), 1,
+    ACTIONS(126), 1,
+      anon_sym_tape,
+    ACTIONS(124), 11,
+      ts_builtin_sym_end,
+      anon_sym_tapes,
+      anon_sym_start,
+      anon_sym_version,
+      anon_sym_encoding,
+      anon_sym_width,
+      anon_sym_slots,
+      anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
+      anon_sym_state,
+  [431] = 3,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(130), 1,
       anon_sym_tape,
-    ACTIONS(85), 9,
+    ACTIONS(128), 11,
       ts_builtin_sym_end,
       anon_sym_tapes,
       anon_sym_start,
@@ -1076,13 +2105,15 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
       anon_sym_state,
-  [145] = 3,
+  [451] = 3,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(91), 1,
+    ACTIONS(134), 1,
       anon_sym_tape,
-    ACTIONS(89), 9,
+    ACTIONS(132), 11,
       ts_builtin_sym_end,
       anon_sym_tapes,
       anon_sym_start,
@@ -1091,13 +2122,15 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
       anon_sym_state,
-  [163] = 3,
+  [471] = 3,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(95), 1,
+    ACTIONS(138), 1,
       anon_sym_tape,
-    ACTIONS(93), 9,
+    ACTIONS(136), 11,
       ts_builtin_sym_end,
       anon_sym_tapes,
       anon_sym_start,
@@ -1106,13 +2139,15 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
       anon_sym_state,
-  [181] = 3,
+  [491] = 3,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(99), 1,
+    ACTIONS(142), 1,
       anon_sym_tape,
-    ACTIONS(97), 9,
+    ACTIONS(140), 11,
       ts_builtin_sym_end,
       anon_sym_tapes,
       anon_sym_start,
@@ -1121,13 +2156,15 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
       anon_sym_state,
-  [199] = 3,
+  [511] = 3,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(103), 1,
+    ACTIONS(146), 1,
       anon_sym_tape,
-    ACTIONS(101), 9,
+    ACTIONS(144), 11,
       ts_builtin_sym_end,
       anon_sym_tapes,
       anon_sym_start,
@@ -1136,13 +2173,15 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
       anon_sym_state,
-  [217] = 3,
+  [531] = 3,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(107), 1,
+    ACTIONS(83), 1,
       anon_sym_tape,
-    ACTIONS(105), 9,
+    ACTIONS(81), 11,
       ts_builtin_sym_end,
       anon_sym_tapes,
       anon_sym_start,
@@ -1151,13 +2190,15 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
       anon_sym_state,
-  [235] = 3,
+  [551] = 3,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(111), 1,
+    ACTIONS(150), 1,
       anon_sym_tape,
-    ACTIONS(109), 9,
+    ACTIONS(148), 11,
       ts_builtin_sym_end,
       anon_sym_tapes,
       anon_sym_start,
@@ -1166,13 +2207,15 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
       anon_sym_state,
-  [253] = 3,
+  [571] = 3,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(66), 1,
+    ACTIONS(154), 1,
       anon_sym_tape,
-    ACTIONS(64), 9,
+    ACTIONS(152), 11,
       ts_builtin_sym_end,
       anon_sym_tapes,
       anon_sym_start,
@@ -1181,13 +2224,15 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
       anon_sym_state,
-  [271] = 3,
+  [591] = 3,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(115), 1,
+    ACTIONS(158), 1,
       anon_sym_tape,
-    ACTIONS(113), 9,
+    ACTIONS(156), 11,
       ts_builtin_sym_end,
       anon_sym_tapes,
       anon_sym_start,
@@ -1196,248 +2241,308 @@ static const uint16_t ts_small_parse_table[] = {
       anon_sym_width,
       anon_sym_slots,
       anon_sym_result,
+      anon_sym_reduced,
+      anon_sym_steps,
       anon_sym_state,
-  [289] = 4,
+  [611] = 5,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(160), 1,
+      aux_sym_fold_token1,
+    ACTIONS(162), 1,
+      aux_sym_single_tape_token1,
+    ACTIONS(164), 1,
+      aux_sym_two_symbol_token1,
+    STATE(14), 4,
+      sym__stage,
+      sym_fold,
+      sym_single_tape,
+      sym_two_symbol,
+  [630] = 5,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(160), 1,
+      aux_sym_fold_token1,
+    ACTIONS(162), 1,
+      aux_sym_single_tape_token1,
+    ACTIONS(164), 1,
+      aux_sym_two_symbol_token1,
+    STATE(8), 4,
+      sym__stage,
+      sym_fold,
+      sym_single_tape,
+      sym_two_symbol,
+  [649] = 4,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(117), 1,
+    ACTIONS(166), 1,
       anon_sym_RBRACK,
-    ACTIONS(119), 2,
+    ACTIONS(168), 2,
       anon_sym_STAR,
       sym__symbol_char,
-    STATE(19), 2,
+    STATE(29), 2,
       sym_symbol,
       aux_sym_group_repeat1,
-  [304] = 4,
+  [664] = 4,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(121), 1,
+    ACTIONS(170), 1,
       anon_sym_RBRACK,
-    ACTIONS(119), 2,
+    ACTIONS(168), 2,
       anon_sym_STAR,
       sym__symbol_char,
-    STATE(20), 2,
+    STATE(30), 2,
       sym_symbol,
       aux_sym_group_repeat1,
-  [319] = 4,
+  [679] = 4,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(123), 1,
+    ACTIONS(172), 1,
       anon_sym_RBRACK,
-    ACTIONS(125), 2,
+    ACTIONS(174), 2,
       anon_sym_STAR,
       sym__symbol_char,
-    STATE(20), 2,
+    STATE(30), 2,
       sym_symbol,
       aux_sym_group_repeat1,
-  [334] = 4,
+  [694] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(128), 1,
+    ACTIONS(177), 3,
       anon_sym_RBRACK,
-    ACTIONS(130), 1,
-      sym_head_move,
-    STATE(24), 1,
-      aux_sym_move_group_repeat1,
-  [347] = 2,
+      anon_sym_STAR,
+      sym__symbol_char,
+  [703] = 4,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(132), 3,
+    ACTIONS(179), 1,
       anon_sym_RBRACK,
-      anon_sym_STAR,
-      sym__symbol_char,
-  [356] = 4,
+    ACTIONS(181), 1,
+      sym_head_move,
+    STATE(33), 1,
+      aux_sym_move_group_repeat1,
+  [716] = 4,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(134), 1,
+    ACTIONS(183), 1,
       anon_sym_RBRACK,
-    ACTIONS(136), 1,
+    ACTIONS(185), 1,
       sym_head_move,
-    STATE(23), 1,
+    STATE(34), 1,
       aux_sym_move_group_repeat1,
-  [369] = 4,
+  [729] = 4,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(139), 1,
+    ACTIONS(187), 1,
       anon_sym_RBRACK,
-    ACTIONS(141), 1,
+    ACTIONS(189), 1,
       sym_head_move,
-    STATE(23), 1,
+    STATE(34), 1,
       aux_sym_move_group_repeat1,
-  [382] = 2,
+  [742] = 3,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(143), 2,
-      anon_sym_DASH_GT,
-      anon_sym_COMMA,
-  [390] = 2,
+    ACTIONS(72), 1,
+      anon_sym_LBRACK,
+    STATE(51), 1,
+      sym_group,
+  [752] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(145), 2,
+    ACTIONS(192), 2,
+      anon_sym_COMMA,
       anon_sym_DASH_GT,
+  [760] = 2,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(194), 2,
       anon_sym_COMMA,
-  [398] = 3,
+      anon_sym_DASH_GT,
+  [768] = 3,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(147), 1,
+    ACTIONS(196), 1,
       anon_sym_LBRACK,
-    STATE(43), 1,
+    STATE(54), 1,
       sym_move_group,
-  [408] = 3,
+  [778] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(62), 1,
-      anon_sym_LBRACK,
-    STATE(40), 1,
-      sym_group,
-  [418] = 2,
+    ACTIONS(198), 1,
+      sym_identifier,
+  [785] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(149), 1,
-      sym_number,
-  [425] = 2,
+    ACTIONS(200), 1,
+      sym_identifier,
+  [792] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(151), 1,
-      ts_builtin_sym_end,
-  [432] = 2,
+    ACTIONS(202), 1,
+      anon_sym_DASH_GT,
+  [799] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(153), 1,
-      anon_sym_DASH_GT,
-  [439] = 2,
+    ACTIONS(204), 1,
+      sym_number,
+  [806] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(155), 1,
+    ACTIONS(206), 1,
       sym_number,
-  [446] = 2,
+  [813] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(157), 1,
+    ACTIONS(208), 1,
       sym_identifier,
-  [453] = 2,
+  [820] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(159), 1,
-      sym_number,
-  [460] = 2,
+    ACTIONS(210), 1,
+      anon_sym_COLON,
+  [827] = 2,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(212), 1,
+      anon_sym_write,
+  [834] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(161), 1,
+    ACTIONS(214), 1,
       sym_number,
-  [467] = 2,
+  [841] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(163), 1,
-      anon_sym_write,
-  [474] = 2,
+    ACTIONS(216), 1,
+      ts_builtin_sym_end,
+  [848] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(165), 1,
+    ACTIONS(218), 1,
       sym_identifier,
-  [481] = 2,
+  [855] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(167), 1,
+    ACTIONS(220), 1,
       sym_number,
-  [488] = 2,
-    ACTIONS(3), 1,
-      sym_comment,
-    ACTIONS(169), 1,
-      anon_sym_COLON,
-  [495] = 2,
+  [862] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(171), 1,
+    ACTIONS(222), 1,
       anon_sym_COMMA,
-  [502] = 2,
+  [869] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(173), 1,
+    ACTIONS(224), 1,
       anon_sym_move,
-  [509] = 2,
+  [876] = 2,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(226), 1,
+      sym_number,
+  [883] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(175), 1,
+    ACTIONS(228), 1,
       anon_sym_COMMA,
-  [516] = 2,
+  [890] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(177), 1,
+    ACTIONS(230), 1,
       anon_sym_COMMA,
-  [523] = 2,
+  [897] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(179), 1,
+    ACTIONS(232), 1,
+      sym_identifier,
+  [904] = 2,
+    ACTIONS(3), 1,
+      sym_comment,
+    ACTIONS(234), 1,
       anon_sym_goto,
-  [530] = 2,
+  [911] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(181), 1,
+    ACTIONS(236), 1,
       anon_sym_COMMA,
-  [537] = 2,
+  [918] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(183), 1,
-      sym_identifier,
-  [544] = 2,
+    ACTIONS(238), 1,
+      sym_number,
+  [925] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(185), 1,
+    ACTIONS(240), 1,
       sym_identifier,
-  [551] = 2,
+  [932] = 2,
     ACTIONS(3), 1,
       sym_comment,
-    ACTIONS(187), 1,
-      sym_identifier,
+    ACTIONS(242), 1,
+      sym_number,
 };
 
 static const uint32_t ts_small_parse_table_map[] = {
-  [SMALL_STATE(4)] = 0,
-  [SMALL_STATE(5)] = 31,
-  [SMALL_STATE(6)] = 59,
-  [SMALL_STATE(7)] = 87,
-  [SMALL_STATE(8)] = 108,
-  [SMALL_STATE(9)] = 127,
-  [SMALL_STATE(10)] = 145,
-  [SMALL_STATE(11)] = 163,
-  [SMALL_STATE(12)] = 181,
-  [SMALL_STATE(13)] = 199,
-  [SMALL_STATE(14)] = 217,
-  [SMALL_STATE(15)] = 235,
-  [SMALL_STATE(16)] = 253,
-  [SMALL_STATE(17)] = 271,
-  [SMALL_STATE(18)] = 289,
-  [SMALL_STATE(19)] = 304,
-  [SMALL_STATE(20)] = 319,
-  [SMALL_STATE(21)] = 334,
-  [SMALL_STATE(22)] = 347,
-  [SMALL_STATE(23)] = 356,
-  [SMALL_STATE(24)] = 369,
-  [SMALL_STATE(25)] = 382,
-  [SMALL_STATE(26)] = 390,
-  [SMALL_STATE(27)] = 398,
-  [SMALL_STATE(28)] = 408,
-  [SMALL_STATE(29)] = 418,
-  [SMALL_STATE(30)] = 425,
-  [SMALL_STATE(31)] = 432,
-  [SMALL_STATE(32)] = 439,
-  [SMALL_STATE(33)] = 446,
-  [SMALL_STATE(34)] = 453,
-  [SMALL_STATE(35)] = 460,
-  [SMALL_STATE(36)] = 467,
-  [SMALL_STATE(37)] = 474,
-  [SMALL_STATE(38)] = 481,
-  [SMALL_STATE(39)] = 488,
-  [SMALL_STATE(40)] = 495,
-  [SMALL_STATE(41)] = 502,
-  [SMALL_STATE(42)] = 509,
-  [SMALL_STATE(43)] = 516,
-  [SMALL_STATE(44)] = 523,
-  [SMALL_STATE(45)] = 530,
-  [SMALL_STATE(46)] = 537,
-  [SMALL_STATE(47)] = 544,
-  [SMALL_STATE(48)] = 551,
+  [SMALL_STATE(2)] = 0,
+  [SMALL_STATE(3)] = 56,
+  [SMALL_STATE(4)] = 112,
+  [SMALL_STATE(5)] = 145,
+  [SMALL_STATE(6)] = 175,
+  [SMALL_STATE(7)] = 205,
+  [SMALL_STATE(8)] = 231,
+  [SMALL_STATE(9)] = 257,
+  [SMALL_STATE(10)] = 283,
+  [SMALL_STATE(11)] = 304,
+  [SMALL_STATE(12)] = 327,
+  [SMALL_STATE(13)] = 348,
+  [SMALL_STATE(14)] = 369,
+  [SMALL_STATE(15)] = 390,
+  [SMALL_STATE(16)] = 411,
+  [SMALL_STATE(17)] = 431,
+  [SMALL_STATE(18)] = 451,
+  [SMALL_STATE(19)] = 471,
+  [SMALL_STATE(20)] = 491,
+  [SMALL_STATE(21)] = 511,
+  [SMALL_STATE(22)] = 531,
+  [SMALL_STATE(23)] = 551,
+  [SMALL_STATE(24)] = 571,
+  [SMALL_STATE(25)] = 591,
+  [SMALL_STATE(26)] = 611,
+  [SMALL_STATE(27)] = 630,
+  [SMALL_STATE(28)] = 649,
+  [SMALL_STATE(29)] = 664,
+  [SMALL_STATE(30)] = 679,
+  [SMALL_STATE(31)] = 694,
+  [SMALL_STATE(32)] = 703,
+  [SMALL_STATE(33)] = 716,
+  [SMALL_STATE(34)] = 729,
+  [SMALL_STATE(35)] = 742,
+  [SMALL_STATE(36)] = 752,
+  [SMALL_STATE(37)] = 760,
+  [SMALL_STATE(38)] = 768,
+  [SMALL_STATE(39)] = 778,
+  [SMALL_STATE(40)] = 785,
+  [SMALL_STATE(41)] = 792,
+  [SMALL_STATE(42)] = 799,
+  [SMALL_STATE(43)] = 806,
+  [SMALL_STATE(44)] = 813,
+  [SMALL_STATE(45)] = 820,
+  [SMALL_STATE(46)] = 827,
+  [SMALL_STATE(47)] = 834,
+  [SMALL_STATE(48)] = 841,
+  [SMALL_STATE(49)] = 848,
+  [SMALL_STATE(50)] = 855,
+  [SMALL_STATE(51)] = 862,
+  [SMALL_STATE(52)] = 869,
+  [SMALL_STATE(53)] = 876,
+  [SMALL_STATE(54)] = 883,
+  [SMALL_STATE(55)] = 890,
+  [SMALL_STATE(56)] = 897,
+  [SMALL_STATE(57)] = 904,
+  [SMALL_STATE(58)] = 911,
+  [SMALL_STATE(59)] = 918,
+  [SMALL_STATE(60)] = 925,
+  [SMALL_STATE(61)] = 932,
 };
 
 static const TSParseActionEntry ts_parse_actions[] = {
@@ -1445,91 +2550,117 @@ static const TSParseActionEntry ts_parse_actions[] = {
   [1] = {.entry = {.count = 1, .reusable = false}}, RECOVER(),
   [3] = {.entry = {.count = 1, .reusable = true}}, SHIFT_EXTRA(),
   [5] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_source_file, 0, 0, 0),
-  [7] = {.entry = {.count = 1, .reusable = true}}, SHIFT(34),
-  [9] = {.entry = {.count = 1, .reusable = true}}, SHIFT(48),
-  [11] = {.entry = {.count = 1, .reusable = true}}, SHIFT(29),
-  [13] = {.entry = {.count = 1, .reusable = true}}, SHIFT(46),
-  [15] = {.entry = {.count = 1, .reusable = true}}, SHIFT(38),
-  [17] = {.entry = {.count = 1, .reusable = true}}, SHIFT(35),
-  [19] = {.entry = {.count = 1, .reusable = true}}, SHIFT(37),
-  [21] = {.entry = {.count = 1, .reusable = false}}, SHIFT(32),
-  [23] = {.entry = {.count = 1, .reusable = true}}, SHIFT(33),
-  [25] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_source_file, 1, 0, 0),
-  [27] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0),
-  [29] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(34),
-  [32] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(48),
-  [35] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(29),
-  [38] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(46),
-  [41] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(38),
-  [44] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(35),
-  [47] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(37),
-  [50] = {.entry = {.count = 2, .reusable = false}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(32),
-  [53] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(33),
-  [56] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_state, 3, 0, 2),
-  [58] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_state, 3, 0, 2),
-  [60] = {.entry = {.count = 1, .reusable = true}}, SHIFT(16),
-  [62] = {.entry = {.count = 1, .reusable = true}}, SHIFT(18),
-  [64] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_state, 4, 0, 2),
-  [66] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_state, 4, 0, 2),
-  [68] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_state_repeat1, 2, 0, 0),
-  [70] = {.entry = {.count = 1, .reusable = false}}, REDUCE(aux_sym_state_repeat1, 2, 0, 0),
-  [72] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_state_repeat1, 2, 0, 0), SHIFT_REPEAT(18),
-  [75] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_tape, 2, 0, 4),
-  [77] = {.entry = {.count = 1, .reusable = false}}, SHIFT(15),
-  [79] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_tape, 2, 0, 4),
-  [81] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_rule, 10, 0, 6),
-  [83] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_rule, 10, 0, 6),
-  [85] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_start, 2, 0, 1),
-  [87] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_start, 2, 0, 1),
-  [89] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_encoding, 2, 0, 2),
-  [91] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_encoding, 2, 0, 2),
-  [93] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_width, 2, 0, 0),
-  [95] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_width, 2, 0, 0),
-  [97] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_tapes, 2, 0, 0),
-  [99] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_tapes, 2, 0, 0),
-  [101] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_result, 2, 0, 3),
-  [103] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_result, 2, 0, 3),
-  [105] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_version, 2, 0, 0),
-  [107] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_version, 2, 0, 0),
-  [109] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_tape, 3, 0, 5),
-  [111] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_tape, 3, 0, 5),
-  [113] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_slots, 2, 0, 0),
-  [115] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_slots, 2, 0, 0),
-  [117] = {.entry = {.count = 1, .reusable = true}}, SHIFT(26),
-  [119] = {.entry = {.count = 1, .reusable = true}}, SHIFT(22),
-  [121] = {.entry = {.count = 1, .reusable = true}}, SHIFT(25),
-  [123] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_group_repeat1, 2, 0, 0),
-  [125] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_group_repeat1, 2, 0, 0), SHIFT_REPEAT(22),
-  [128] = {.entry = {.count = 1, .reusable = true}}, SHIFT(42),
-  [130] = {.entry = {.count = 1, .reusable = true}}, SHIFT(24),
-  [132] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_symbol, 1, 0, 0),
-  [134] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_move_group_repeat1, 2, 0, 0),
-  [136] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_move_group_repeat1, 2, 0, 0), SHIFT_REPEAT(23),
-  [139] = {.entry = {.count = 1, .reusable = true}}, SHIFT(45),
-  [141] = {.entry = {.count = 1, .reusable = true}}, SHIFT(23),
-  [143] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_group, 3, 0, 0),
-  [145] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_group, 2, 0, 0),
-  [147] = {.entry = {.count = 1, .reusable = true}}, SHIFT(21),
-  [149] = {.entry = {.count = 1, .reusable = true}}, SHIFT(14),
-  [151] = {.entry = {.count = 1, .reusable = true}},  ACCEPT_INPUT(),
-  [153] = {.entry = {.count = 1, .reusable = true}}, SHIFT(36),
-  [155] = {.entry = {.count = 1, .reusable = true}}, SHIFT(7),
-  [157] = {.entry = {.count = 1, .reusable = true}}, SHIFT(39),
-  [159] = {.entry = {.count = 1, .reusable = true}}, SHIFT(12),
-  [161] = {.entry = {.count = 1, .reusable = true}}, SHIFT(17),
-  [163] = {.entry = {.count = 1, .reusable = true}}, SHIFT(28),
-  [165] = {.entry = {.count = 1, .reusable = true}}, SHIFT(13),
-  [167] = {.entry = {.count = 1, .reusable = true}}, SHIFT(11),
-  [169] = {.entry = {.count = 1, .reusable = true}}, SHIFT(4),
-  [171] = {.entry = {.count = 1, .reusable = true}}, SHIFT(41),
-  [173] = {.entry = {.count = 1, .reusable = true}}, SHIFT(27),
-  [175] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_move_group, 2, 0, 0),
-  [177] = {.entry = {.count = 1, .reusable = true}}, SHIFT(44),
-  [179] = {.entry = {.count = 1, .reusable = true}}, SHIFT(47),
-  [181] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_move_group, 3, 0, 0),
-  [183] = {.entry = {.count = 1, .reusable = true}}, SHIFT(10),
-  [185] = {.entry = {.count = 1, .reusable = true}}, SHIFT(8),
-  [187] = {.entry = {.count = 1, .reusable = true}}, SHIFT(9),
+  [7] = {.entry = {.count = 1, .reusable = true}}, SHIFT(59),
+  [9] = {.entry = {.count = 1, .reusable = true}}, SHIFT(44),
+  [11] = {.entry = {.count = 1, .reusable = true}}, SHIFT(47),
+  [13] = {.entry = {.count = 1, .reusable = true}}, SHIFT(49),
+  [15] = {.entry = {.count = 1, .reusable = true}}, SHIFT(50),
+  [17] = {.entry = {.count = 1, .reusable = true}}, SHIFT(53),
+  [19] = {.entry = {.count = 1, .reusable = true}}, SHIFT(56),
+  [21] = {.entry = {.count = 1, .reusable = true}}, SHIFT(27),
+  [23] = {.entry = {.count = 1, .reusable = true}}, SHIFT(61),
+  [25] = {.entry = {.count = 1, .reusable = false}}, SHIFT(42),
+  [27] = {.entry = {.count = 1, .reusable = true}}, SHIFT(40),
+  [29] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_source_file, 1, 0, 0),
+  [31] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0),
+  [33] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(59),
+  [36] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(44),
+  [39] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(47),
+  [42] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(49),
+  [45] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(50),
+  [48] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(53),
+  [51] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(56),
+  [54] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(27),
+  [57] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(61),
+  [60] = {.entry = {.count = 2, .reusable = false}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(42),
+  [63] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_source_file_repeat1, 2, 0, 0), SHIFT_REPEAT(40),
+  [66] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_state, 3, 0, 2),
+  [68] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_state, 3, 0, 2),
+  [70] = {.entry = {.count = 1, .reusable = true}}, SHIFT(22),
+  [72] = {.entry = {.count = 1, .reusable = true}}, SHIFT(28),
+  [74] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_state_repeat1, 2, 0, 0),
+  [76] = {.entry = {.count = 1, .reusable = false}}, REDUCE(aux_sym_state_repeat1, 2, 0, 0),
+  [78] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_state_repeat1, 2, 0, 0), SHIFT_REPEAT(28),
+  [81] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_state, 4, 0, 2),
+  [83] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_state, 4, 0, 2),
+  [85] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_reduced, 3, 0, 0),
+  [87] = {.entry = {.count = 1, .reusable = true}}, SHIFT(26),
+  [89] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_reduced, 3, 0, 0),
+  [91] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_reduced, 2, 0, 0),
+  [93] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_reduced, 2, 0, 0),
+  [95] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_reduced_repeat1, 2, 0, 0),
+  [97] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_reduced_repeat1, 2, 0, 0), SHIFT_REPEAT(26),
+  [100] = {.entry = {.count = 1, .reusable = false}}, REDUCE(aux_sym_reduced_repeat1, 2, 0, 0),
+  [102] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_two_symbol, 2, 0, 5),
+  [104] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_two_symbol, 2, 0, 5),
+  [106] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_tape, 2, 0, 4),
+  [108] = {.entry = {.count = 1, .reusable = false}}, SHIFT(21),
+  [110] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_tape, 2, 0, 4),
+  [112] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_fold, 1, 0, 0),
+  [114] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_fold, 1, 0, 0),
+  [116] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_single_tape, 2, 0, 0),
+  [118] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_single_tape, 2, 0, 0),
+  [120] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_rule, 10, 0, 7),
+  [122] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_rule, 10, 0, 7),
+  [124] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_steps, 2, 0, 0),
+  [126] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_steps, 2, 0, 0),
+  [128] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_result, 2, 0, 3),
+  [130] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_result, 2, 0, 3),
+  [132] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_tapes, 2, 0, 0),
+  [134] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_tapes, 2, 0, 0),
+  [136] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_slots, 2, 0, 0),
+  [138] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_slots, 2, 0, 0),
+  [140] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_width, 2, 0, 0),
+  [142] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_width, 2, 0, 0),
+  [144] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_tape, 3, 0, 6),
+  [146] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_tape, 3, 0, 6),
+  [148] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_version, 2, 0, 0),
+  [150] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_version, 2, 0, 0),
+  [152] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_start, 2, 0, 1),
+  [154] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_start, 2, 0, 1),
+  [156] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_encoding, 2, 0, 2),
+  [158] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_encoding, 2, 0, 2),
+  [160] = {.entry = {.count = 1, .reusable = true}}, SHIFT(12),
+  [162] = {.entry = {.count = 1, .reusable = true}}, SHIFT(43),
+  [164] = {.entry = {.count = 1, .reusable = true}}, SHIFT(39),
+  [166] = {.entry = {.count = 1, .reusable = true}}, SHIFT(37),
+  [168] = {.entry = {.count = 1, .reusable = true}}, SHIFT(31),
+  [170] = {.entry = {.count = 1, .reusable = true}}, SHIFT(36),
+  [172] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_group_repeat1, 2, 0, 0),
+  [174] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_group_repeat1, 2, 0, 0), SHIFT_REPEAT(31),
+  [177] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_symbol, 1, 0, 0),
+  [179] = {.entry = {.count = 1, .reusable = true}}, SHIFT(55),
+  [181] = {.entry = {.count = 1, .reusable = true}}, SHIFT(33),
+  [183] = {.entry = {.count = 1, .reusable = true}}, SHIFT(58),
+  [185] = {.entry = {.count = 1, .reusable = true}}, SHIFT(34),
+  [187] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_move_group_repeat1, 2, 0, 0),
+  [189] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_move_group_repeat1, 2, 0, 0), SHIFT_REPEAT(34),
+  [192] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_group, 3, 0, 0),
+  [194] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_group, 2, 0, 0),
+  [196] = {.entry = {.count = 1, .reusable = true}}, SHIFT(32),
+  [198] = {.entry = {.count = 1, .reusable = true}}, SHIFT(10),
+  [200] = {.entry = {.count = 1, .reusable = true}}, SHIFT(45),
+  [202] = {.entry = {.count = 1, .reusable = true}}, SHIFT(46),
+  [204] = {.entry = {.count = 1, .reusable = true}}, SHIFT(11),
+  [206] = {.entry = {.count = 1, .reusable = true}}, SHIFT(13),
+  [208] = {.entry = {.count = 1, .reusable = true}}, SHIFT(24),
+  [210] = {.entry = {.count = 1, .reusable = true}}, SHIFT(4),
+  [212] = {.entry = {.count = 1, .reusable = true}}, SHIFT(35),
+  [214] = {.entry = {.count = 1, .reusable = true}}, SHIFT(23),
+  [216] = {.entry = {.count = 1, .reusable = true}},  ACCEPT_INPUT(),
+  [218] = {.entry = {.count = 1, .reusable = true}}, SHIFT(25),
+  [220] = {.entry = {.count = 1, .reusable = true}}, SHIFT(20),
+  [222] = {.entry = {.count = 1, .reusable = true}}, SHIFT(52),
+  [224] = {.entry = {.count = 1, .reusable = true}}, SHIFT(38),
+  [226] = {.entry = {.count = 1, .reusable = true}}, SHIFT(19),
+  [228] = {.entry = {.count = 1, .reusable = true}}, SHIFT(57),
+  [230] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_move_group, 2, 0, 0),
+  [232] = {.entry = {.count = 1, .reusable = true}}, SHIFT(17),
+  [234] = {.entry = {.count = 1, .reusable = true}}, SHIFT(60),
+  [236] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_move_group, 3, 0, 0),
+  [238] = {.entry = {.count = 1, .reusable = true}}, SHIFT(18),
+  [240] = {.entry = {.count = 1, .reusable = true}}, SHIFT(15),
+  [242] = {.entry = {.count = 1, .reusable = true}}, SHIFT(16),
 };
 
 #ifdef __cplusplus
diff --git a/grammars/tree-sitter-redextape-tm/test/corpus/reduced.txt b/grammars/tree-sitter-redextape-tm/test/corpus/reduced.txt
new file mode 100644
index 0000000..46dacc6
--- /dev/null
+++ b/grammars/tree-sitter-redextape-tm/test/corpus/reduced.txt
@@ -0,0 +1,91 @@
+================================================================================
+a reduced header through all three stages, in the order the printer emits it
+================================================================================
+
+tapes 1
+start pre
+version 2
+encoding unary
+width 8
+slots 4
+result Nat
+reduced fold, single-tape 5, two-symbol _#1<>ABab|,
+steps 7088578
+tape 0 _1
+
+state pre: accept
+
+--------------------------------------------------------------------------------
+
+(source_file
+  (tapes
+    (number))
+  (start
+    target: (identifier))
+  (version
+    (number))
+  (encoding
+    name: (identifier))
+  (width
+    (number))
+  (slots
+    (number))
+  (result
+    type: (identifier))
+  (reduced
+    (fold
+      (stage))
+    (single_tape
+      (stage)
+      (number))
+    (two_symbol
+      (stage)
+      symbols: (identifier)))
+  (steps
+    (number))
+  (tape
+    index: (number)
+    cells: (identifier))
+  (state
+    name: (identifier)))
+
+================================================================================
+the fold alone, at the end of its line
+================================================================================
+
+tapes 1
+start s
+version 2
+encoding unary
+width 4
+slots 1
+result Nat
+reduced fold
+steps 3
+
+state s: accept
+
+--------------------------------------------------------------------------------
+
+(source_file
+  (tapes
+    (number))
+  (start
+    target: (identifier))
+  (version
+    (number))
+  (encoding
+    name: (identifier))
+  (width
+    (number))
+  (slots
+    (number))
+  (result
+    type: (identifier))
+  (reduced
+    (fold
+      (stage)))
+  (steps
+    (number))
+  (state
+    name: (identifier)))
````
<!-- END task5.patch -->

- [ ] **Step 4: Regenerate the grammar and run its corpus**

`scripts/check-all.sh`'s grammar leg does this for every grammar; this is its TM row.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P/grammars/tree-sitter-redextape-tm" && cap "$P/.tools/tree-sitter" generate && cap "$P/.tools/tree-sitter" test 2>&1 | grep -E "Total parses"
git -C "$P" diff --quiet -- grammars/ && echo "src matches grammar.js"; git -C "$P" ls-files --others --exclude-standard -- grammars/
```

Expected: `Total parses: 14; successful parses: 14; failed parses: 0; success percentage: 100.00%`, then `src matches grammar.js`, and no untracked file listed.

- [ ] **Step 5: Format check and lint**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo clippy --workspace --all-targets -- -D warnings 2>&1 | grep -E "^(warning|error)"; echo "clippy done"
```

Expected: `fmt exit 0` with no diff printed, and `clippy done` with no `warning` or `error` line before it.

- [ ] **Step 6: Run this task's tests**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-grammar-check 2>&1 | grep -E "FAIL|Summary"
```

Expected summary line: `61 tests run: 61 passed, 0 skipped`

- [ ] **Step 7: Run the text gates**

The README's figures are `scripts/check-doc-figures.sh`'s.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1; bash scripts/check-doc-figures.sh | tail -1
```

Expected:
- `checked 494 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `478 files scanned, 0 violations`
- `check-doc-figures: 42 documented figures match the tree.`

- [ ] **Step 8: Commit**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
The TM grammar reads reduced headers

grammar.js gains the reduced and steps directives. A reduced line is
its stages, comma-separated: fold, single-tape with its count, and
two-symbol with its symbols as one identifier. The stage names are
regex tokens aliased to one stage node, and fold is written
/fold\r?/: the generator extracts an all-letter token as a keyword of
identifier, which admits a comma, so the printer's "fold," lexed as one
word and parsed as an ERROR. The optional carriage return keeps fold
out, and admits nothing parse_tm_full refuses. highlights.scm captures
a stage name as @keyword and a two-symbol code's symbols as
@character. src/ is regenerated with the pinned CLI 0.25.10.

The tree-sitter corpus gains two reduced headers and grammar-check's
hand-written corpus one. A new differential compares 3 - 5 reduced
through each stage alone, and through the fold then stage 2, against
the printer, and the pattern and authority checks read those files
too. The README's figures follow.
EOF
```

Expected: every hook reports `Passed` or `Skipped`, `lua parses and parser names agree` among them.

- [ ] **Step 9: Run the sabotages, restoring after each**

The helper is Task 1 Step 7's `sab.py`. `corpus` regenerates the grammar from the sabotaged `grammar.js` before `fast` builds grammar-check over it, and says whether the corpus still parses. **It reports rather than gates**: `tree-sitter test` prints its `Total parses` line only when every case passes, so a `corpus` that ended in a `grep` for that line returned non-zero exactly when a sabotage worked, and `&& fast` then skipped the row in silence. Run the whole block in a single Bash tool call, with a timeout of 600000 ms.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
PLAN="$P/docs/superpowers/plans/2026-09-15-reduced-tm-files.md"
S=/tmp/claude-1000/-home-davey-projects-redextape/c6a1cf33-0c42-448c-a0ee-76239e25a1eb/scratchpad/reduced-tm-exec
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
fast() { cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-grammar-check --no-fail-fast 2>&1 | grep -E "^\s+FAIL \[|Summary|^error"; }
corpus() { cd "$P/grammars/tree-sitter-redextape-tm" && cap "$P/.tools/tree-sitter" generate >/dev/null 2>&1 && { cap "$P/.tools/tree-sitter" test >/dev/null 2>&1 && echo "corpus: every case parses as written" || echo "corpus: a case does not parse as written"; }; }
restore() { git -C "$P" checkout -- crates/ grammars/ && git -C "${P:?}" clean -fdq -- crates/ grammars/ && git -C "$P" status --short -- crates/ grammars/; }
block_of sab.py >| "$S/sab.py"
G="$P/grammars/tree-sitter-redextape-tm"
T="$P/crates/redextape-grammar-check/src/tm.rs"

# T5-S1: `fold` is an ordinary regex, which the generator extracts as a keyword
python3 "$S/sab.py" "$G/grammar.js" '    fold: $ => alias(token(/fold\r?/), $.stage),' '    fold: $ => alias(token(/fold/), $.stage),' && corpus && fast; restore

# T5-S2: a stage name is not captured
python3 "$S/sab.py" "$G/queries/highlights.scm" $'(stage) @keyword\n' '' && fast; restore

# T5-S3: a two-symbol code's symbols are not captured
python3 "$S/sab.py" "$G/queries/highlights.scm" $'(two_symbol symbols: (identifier) @character)\n' '' && fast; restore

# T5-S4: no stage list in the reduced corpus has a comma
python3 "$S/sab.py" "$T" '    ("3 - 5", &[StageKind::Fold, StageKind::TwoSymbol]),' '    ("3 - 5", &[StageKind::TwoSymbol]),' && fast; restore
```

Expected, as measured. The clean run is `61 tests run: 61 passed, 0 skipped`:

| row | sabotage | red | summary |
| --- | --- | --- | --- |
| T5-S1 | `fold` an ordinary regex, which the generator extracts as a keyword | `corpus: a case does not parse as written`, then `every_corpus_program_parses_without_error_nodes` and `the_tm_grammar_agrees_with_the_reduced_printer` | `59 passed, 2 failed` |
| T5-S2 | a stage name not captured | `the_tm_grammar_agrees_with_the_reduced_printer` | `60 passed, 1 failed` |
| T5-S3 | a two-symbol code's symbols not captured | the same | `60 passed, 1 failed` |
| T5-S4 | no stage list in the reduced corpus has a comma | the same, on its comma floor | `60 passed, 1 failed` |

T5-S1 is the row that shows why `fold` is written `/fold\r?/`: with a plain regex the printer's `fold,` lexes as one word, the hand-written corpus entry gains `ERROR` nodes, and the differential has nothing to compare. The block took 7 s, starting at a load average of 20.14.

- [ ] **Step 10: Run the whole workspace's normal tier**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run --workspace 2>&1 | grep -E "^\s+FAIL|Summary"
```

Expected: `1744 tests run: 1744 passed, 33 skipped`, in 37.902 s, starting at a load average of 19.19. Against the baseline's `1699 passed, 29 skipped`, that is this plan's 45 new tests, and the four it leaves in the slow tier.

- [ ] **Step 11: Run the wasm32 rows of `scripts/check-all.sh`**

These are that script's `wasm` rows, run directly, each calling `wasm` with its arguments as separate words.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
wasm() { cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo check --target wasm32-unknown-unknown "$@" >/dev/null 2>&1; echo "wasm32 $*: exit $?"; }
wasm -p redextape-core --lib
wasm -p redextape-core --lib --features serde
wasm -p redextape-core --lib --features ts
wasm -p redextape-wasm --lib
wasm -p redextape-wasm --lib --features ts
```

Expected: each of the five rows prints `exit 0`.

- [ ] **Step 12: Run this slice's slow tier in release**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/reduced-tm-header
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run --release -p redextape-core -p redextape-cli -E 'binary_id(redextape-core::reduced_tm_file) | binary_id(redextape-cli::roundtrip)' --run-ignored only --no-capture 2>&1 | grep -E "PASS|FAIL|Summary|steps,"
```

Expected: every test passes. As measured, `4 tests run: 4 passed, 9 skipped` in 15.053 s, starting at a load average of 22.08:

| test | time | printed |
| --- | --- | --- |
| `a_file_reduced_through_all_three_stages_runs_to_the_reference_answer` | 0.507 s | — |
| `all_three_stages_decode` | 0.722 s | `5 - 3` through all three: 7,271,090 steps, 11,571,235 bytes |
| `all_three_stages_decode_on_larger_programs` | 8.417 s | `cons(1, cons(2, nil))` 15,051,455 steps and 73,635,613 bytes; `if 2 > 1 { 10 } else { 20 }` 43,060,457 and 20,916,161; `1 + 2 * 3` 45,085,521 and 37,923,527 |
| `stage_one_decodes_on_a_recursive_sum` | 5.406 s | `sum(5)` through stage 1: 298,696,070 steps, 2,710,205 bytes |

---

## Figures, measured while planning

**These are not steps.** Each was taken at the scratch commit it names, under `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 --`, on a machine other agents were loading; each gives the load average it started at.

### Reduced files: steps and sizes

The reduced run's steps and the printed file's bytes, from `reduced_tm_file.rs`'s own output at `ec37a6e`: the fast tier's six in a debug build, the slow tier in release.

| program | stages | steps | bytes |
| --- | --- | --- | --- |
| `5 - 3` | fold | 540 | 87,957 |
| `5 - 3` | two-symbol | 1,793 | 79,480 |
| `5 - 3` | fold, two-symbol | 2,773 | 471,669 |
| `5 - 3` | single-tape | 241,666 | 103,028 |
| `5 - 3` | fold, single-tape | 910,258 | 794,629 |
| `5 - 3` | single-tape, two-symbol | 2,036,385 | 1,516,707 |
| `5 - 3` | all three | 7,271,090 | 11,571,235 |
| `cons(1, cons(2, nil))` | all three | 15,051,455 | 73,635,613 |
| `if 2 > 1 { 10 } else { 20 }` | all three | 43,060,457 | 20,916,161 |
| `1 + 2 * 3` | all three | 45,085,521 | 37,923,527 |
| `fn sum(n) ... sum(5)` | single-tape | 298,696,070 | 2,710,205 |

- **Against the spec's table**, which composed the stages as the oracles do, with stage 1 padded by 2 blocks alone and by 0 and 1 after the fold: `cons` all three 15,051,455 against 15,249,613; `if` 43,060,457 against 43,262,547; `1 + 2 * 3` 45,085,521 against 45,412,211; `sum(5)` stage 1 298,696,070 against 303,610,850. The spec's remaining row is `3 - 5`, which this plan's fast tier replaced with `5 - 3` (*Findings*); measured before that change, `3 - 5` through all three took 7,007,238 steps against the spec's 7,088,578, printing 11,571,215 bytes. `pads` reaches only the cells a run visits, so every count is lower. `cons` all three prints 73,635,613 bytes against the spec's 73,632,864.
- **Every run above verified at `PAD_MARGIN` 0**, stage 1 included, so no margin was needed over the corpus.

### The slow tier's cost, and emitting and running the largest file

At `5e22a3d`, each measured alone, peak memory as the process's `ru_maxrss` through a `resource.getrusage` wrapper:

| what | wall | peak RSS | load average at the start |
| --- | --- | --- | --- |
| all three on `5 - 3` | 0.628 s | 233,692 KB | 12.21 |
| all three on `cons(1, cons(2, nil))`, `if 2 > 1 { 10 } else { 20 }` and `1 + 2 * 3` | 7.084 s | 1,395,960 KB | 13.72 |
| stage 1 on `fn sum(n) ... sum(5)` | 5.083 s | 49,436 KB | 13.90 |
| the command line's all-three round trip, in release | 0.514 s | not measured | 13.27 |

**The `redextape` release binary on `cons(1, cons(2, nil))` through all three stages**, three runs each, starting at load averages of 13.90 to 13.98:
- `emit --lang tm --reduce fold,single-tape,two-symbol`: 1.142 to 1.445 s, 1,020,772 to 1,021,532 KB, writing 73,635,613 bytes;
- `run` on that file: 1.792 to 1.974 s, 940,304 to 942,872 KB, printing `[1, 2]`.

The same pair on a quiet machine, at `c721a56`, whose command-line source differs from `5e22a3d`'s only in `tests/roundtrip.rs`, starting at load averages of 1.26 to 1.28: `emit` 0.975 to 1.005 s at 1,020,216 to 1,020,800 KB, and `run` 1.575 to 1.593 s at 942,348 to 943,764 KB. The peak memory is the same to within 600 KB; only the time moves with the load.

### Tapes rebuilt through the fold decode

`decode_tape_ty_reason` accepted the tapes `decode_reduced` rebuilds from `OriginSnapshot::cells` for every subset containing the fold: the fold alone, the fold then stage 1, and the fold then stage 2 on `5 - 3` in the fast tier; all three on `5 - 3`, `cons(1, cons(2, nil))`, `if 2 > 1 { 10 } else { 20 }` and `1 + 2 * 3` in the slow tier. Each decoded to the reference interpreter's value.

### Test times, for the tiers

Debug, `cargo nextest` with `--test-threads 1`, three runs each.

**`reduced_tm_file.rs` at `5e22a3d`**, starting at load averages of 11.79, 11.16 and 10.75 — another agent was loading the machine, so these are upper bounds:

| test | times |
| --- | --- |
| `the_fold_alone_decodes` | 0.011, 0.011, 0.012 s |
| `stage_two_alone_decodes` | 0.011, 0.012, 0.011 s |
| `the_fold_then_stage_two_decodes` | 0.052, 0.050, 0.051 s |
| `stage_one_alone_decodes` | 0.086, 0.087, 0.089 s |
| `the_fold_then_stage_one_decodes` | 0.343, 0.347, 0.368 s |
| `stages_one_then_two_decode` | 0.659, 0.662, 0.664 s |
| `all_three_stages_decode` | 2.953, 3.101, 3.338 s — over 1 s, so it is in the slow tier |

**`redextape-cli` at `5e22a3d`**: `a_file_reduced_to_one_tape_runs_to_the_reference_answer` 0.094, 0.094 and 0.096 s. Measured earlier at `0f09a1a`, starting at a load average of 0.97: `a_capped_fitting_run_is_not_reduced` took 1.149 to 1.157 s while it ran a program to `TM_DEFAULT_CAPS`, which is why it now sets the run's outcome by hand; the existing `a_capped_fitting_run_still_emits_and_says_so`, which this plan leaves alone, took 1.152 to 1.196 s.

**`redextape-grammar-check`'s `tm` binary at `8484c10`**, whose Task 5 content is `5e22a3d`'s, starting at load averages of 6.99, 6.99 and 6.51: `the_tm_grammar_agrees_with_the_reduced_printer` 0.842 to 0.849 s; `every_tm_query_pattern_fires_over_the_corpus` 0.445 to 0.455 s; `parse_tm_accepts_every_corpus_entry` 0.108 to 0.110 s; the existing generated leg 0.614 to 1.107 s. With the reduced files inside the headered differential, as the spec named it, that test took 0.943 to 1.240 s, starting at 2.35 to 5.29.

## Decisions and spec corrections found while planning

1. **Stage 1 is padded to exactly the cells a run visits, with a margin of 0.** The spec left the margin to this plan. `pads` runs the machine stage 1 receives and counts each tape's growth on its left, and every reduction in *Figures* verified with no margin at all.
2. **`sim::simulate_origins` counts the growth, and `tests/common`'s `run_with_origins` reads it.** Two copies of one growth rule, one in the library and one in test support, are what this project's review keeps finding. The fold's oracle stays sound: its side of the comparison finds each origin from the zig-zag layout, not from growth.
3. **The inverses before the fold rebuild their tapes with the head, through `Tape::from_snapshot`.** The spec's decoder names `Tape::new(&snapshot.cells)` for the fold's own inverse, and that is what runs. But `unzigzag` refuses a head on physical cell 0, where `Tape::new` puts one, so a tape out of `unbitify` or `deinterleave` that the fold's inverse reads next must keep its head. **Spec correction.**
4. **A reduced machine must take at least one step.** The spec requires `1 <= N` of `steps`, and verification now refuses a run of zero steps, which only a hand-built run can produce, rather than writing a `steps 0` no reader accepts.
5. **`ReduceError` has six variants:** `StageList`, `NotRan`, `Refused`, `LayoutCollision`, `Layout` for a `None` from `zigzag` or `bitify`, and `Unverified`. `bitify`'s `None` cannot happen in `reduce`, which builds the code from the tapes it encodes, so no test reaches that half of `Layout`.
6. **The header's constants:** `REDUCED_HEADER_VERSION` is 2 and `MAX_REDUCED_STEPS` is `1_000_000_000`; `HEADER_VERSION` stays 1, meaning a lowered file and an absent `version`. The unknown-version message now reads `(this build reads versions 1 and 2)`, and the existing test that refused `version 2` refuses `version 3`.
7. **A reduced header's `tape` lines carry no generated `; reg` label.** `tape_name` names the lowered layout's tapes, which a reduced machine's are not.
8. **`all_three_stages_decode` is in the slow tier.** The spec puts all seven subsets in the fast tier, and the all-three test takes 2.953 to 3.338 s alone in debug; this project's fast tier is under 1 s. The six other subsets are fast, the longest at 0.664 s. **Spec correction.**
9. **The command-line round trip with all three stages is in the slow tier** for the same reason; the one-tape round trip is fast. `emit.rs`'s capped-run test sets the run's outcome by hand, because a program that reaches `TM_DEFAULT_CAPS` took over a second.
10. **`fold` is `/fold\r?/` in the grammar.** See Task 5. Reproduced on a copy of the grammar: a string literal with lexical precedence and a bare regex both left `fold,` an `ERROR`, and so did the first version, `token(/fold/)`. `/fold[:]?/` parsed but admitted `reduced fold:`, which the authority refuses. No existing accept-more divergence changes.
11. **Grammar-check's reduced files have a differential of their own,** `the_tm_grammar_agrees_with_the_reduced_printer`, rather than joining `the_tm_grammar_agrees_with_the_headered_printer` and `every_printed_token_is_captured` as the spec names. Joined, the headered differential took 0.943 to 1.240 s alone. The reduced differential's length check is `every_printed_token_is_captured`'s property for those files. **Spec correction.**
12. **`emit::Options` gains a lifetime** so that `--reduce`'s `&str` keeps it `Copy`, rather than adding an eighth argument to `emit::run`.
13. **The fast tier reduces `5 - 3`, not `3 - 5`.** The spec names `3 - 5`, whose value is 0, and *Findings* records the sabotage that stayed green on it and went red on `5 - 3`. Nothing else about the corpus changes, and the command line's round trip follows it. **Spec correction.**
14. **The commands are written for zsh, the Bash tool's shell,** and every block defines what it uses. Every block sets its own variables and defines the functions it uses in the same call, because neither survives into the next one. Two instruments were corrected while the sabotages ran, and both had hidden a row rather than failed loudly: `restore` deleted only a unit test's `proptest-regressions/` directory, so an integration test's regressions file survived a row and replayed its failing case into the rows after it — it now removes every untracked file under the paths it restores, with `git clean`, which leaves the regression files this crate tracks alone; and Task 5's `corpus` ended in a `grep` for a line `tree-sitter test` prints only when every case passes, so it returned non-zero exactly when a sabotage worked and `&& fast` skipped that row in silence.

## Findings

1. **The spec's first sabotage row stays green on a program whose value is 0, which is what `3 - 5` is.**
   Swapping two symbols of the header's `two-symbol` run makes the decoder read every tape through a code
   that maps one symbol onto another, and `3 - 5`'s tapes still decoded to 0: all six end-to-end subsets
   passed. Measured on the same tree with the program changed to `5 - 3`, whose value is 2, the same row
   reddens exactly the three subsets that contain stage 2 — `stage_two_alone_decodes`,
   `the_fold_then_stage_two_decodes` and `stages_one_then_two_decode` — and leaves the fold-only and
   stage-1-only subsets green, which never build a code. **The fast tier's program is now `5 - 3`.** The
   spec names `3 - 5` for that tier; a value of 0 is the one value a wrong decode is likeliest to produce.
2. **That row's first version reddened by panicking, not by decoding.** `s.swap(1, 2)` indexes past the end
   of a two-symbol code, which one hand-built fixture has, so the row went red on an index rather than on a
   value. It is guarded by `if s.len() > 2` now, and the fixture's own test passes under it.
3. **The mismatch test's two-tape case could not fail.** It handed the inverse two tapes whose first had no
   sentinels, so stage 1's inverse refused the pair whether or not it checked for exactly one tape: T3-S14
   ran green. The case now hands a tape `interleave` really produces, with a positive control asserting
   that tape decodes alone, and the row reddens.
4. **The spec's fifth row cannot be run at all.** It produces "with zero padding margin", and the margin
   measured is zero: `pads` reaches exactly the cells a run visits. T3-S12 and T3-S13 take its place by
   taking a block away — one on the left, one on the right.
5. **A skeleton one block short on the right is invisible to this corpus.** T3-S13 reddens only
   `the_skeleton_reaches_every_cell_a_head_visits`, the unit test with a constructed walk: on `5 - 3` no
   head ever passes the longest initial tape, so the right pad is 0 and one block fewer is still 0. The
   left pad is not: T3-S12 reddens the end-to-end subsets with stage 1 as well.
6. **The spec's first three rows redden at the producer, not at the file.** `reduce` verifies by decoding
   the reduced machine's own tapes, so a header that lies about its stages fails there, before any file
   exists, and the end-to-end tests report `Unverified` from `reduce` rather than a decode of printed text.
   The spec's fourth row, `steps` one lower, is the one that reaches a file: it is written, parses back, and
   fails when run at the count it records.

## Left for the controller

- **The spec is not amended.** Decisions 3, 8, 11 and 13 are its corrections, and *Findings* is what the sabotages measured.
- **The roadmap entry.**
- **The scratch worktree** `.claude/worktrees/reduced-tm-scratch` holds branch `reduced-tm-scratch-5`, the five commits this plan embeds; the superseded branches `reduced-tm-scratch` and `reduced-tm-scratch-2` to `reduced-tm-scratch-4`, whose Tasks 3 and 4 lacked the tests *Findings* names; branch `reduced-tm-replay`, the replay; its own `target/`; and the pinned tree-sitter CLI in `.tools/`. All of it can be deleted without losing anything this plan does not embed.
- **`emit.rs`'s existing `a_capped_fitting_run_still_emits_and_says_so` takes over 1 s alone in debug**, 1.152 to 1.196 s. This plan leaves it as it was.
