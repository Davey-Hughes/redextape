# TM Buffers Run Reduced Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TM buffer in the web app shows a reduced `.tm` file truthfully and reads its value, as `redextape run` does, from a run an edit can supersede, and refuses text too large to build within the app's gesture budget.

**Architecture:** Six tasks, each one commit:
1. `run_caps` and `value_of_run` in core, which `redextape run` reads a value through;
2. `TmValueRun`, a second, frame-less cursor that `tmScratch` returns beside the scratch for a headered file, plus the scratch's own tape names and reduction status;
3. `MAX_SCRATCH_TM_BYTES`, refused before the parse;
4. the worker's value run loop, the `tm-value` reply, and its retention on the session entry;
5. the pane's reduced sentence and value line, pushed and seeded;
6. a checked-in fixture and the end-to-end tests in the real app.

**Tech Stack:** Rust (`redextape-core`, `redextape-cli`, `redextape-wasm`), wasm-bindgen and ts-rs, TypeScript with Vite, Vitest (node and browser projects) and Biome, cargo-nextest, wasm-pack in Chrome, and the repository's pre-commit gates. No dependency is added.

**Spec:** `docs/superpowers/specs/2026-09-16-web-reduced-files-design.md`, as amended before any code. *Decisions and spec corrections found while planning* records where the built code departs from it, and why.

## Global Constraints

From the spec, in its words:
- **What a user can do:** "Run a reduced file and read its value, as `redextape run` does."
- **How a buffer gets through its header's step count:** "A second, frame-less run, advanced in chunks that yield to the event loop."
- **Decision 2 stands:** "`tmScratch(src)` answers `{ diagnostics, scratch, value }`", and "`TmScratch` still has no `tm_value`". Both pins in `crates/redextape-wasm/tests/browser.rs` pass unedited.
- **One decision, two surfaces:** "The decision is shared with the CLI; the wording is not." No CLI message, exit code or snapshot changes.
- **The ceiling:** "N is measured, not chosen", against "250 ms, the budget `MAX_FORK_RULES` was measured against".
- **The value line:** "created with `role=\"status\"`", and "not the deferred accessibility pass".

For building it:
- **Worktree:** work in `.claude/worktrees/web-reduced-files`, on branch `web-reduced-files`. Every block below sets `P` to it. Put `CARGO_TARGET_DIR="$P/target"` on every cargo command and every `git commit`, because the pre-commit hook runs cargo. Never build into the main checkout's `target/`, and never into `/tmp`.
- **Memory cap:** every cargo test run, suite run and sabotage run goes under `cap` (`systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 --`). An OOM kill is a result to record, never a reason to raise the cap. The one exception is written into its block with its measurement: CI's web coverage gate peaked at 8.5 GiB and runs under 16 GiB.
- **Shell:** the Bash tool runs zsh, which passes an unquoted variable as one word. Every block below gives each argument as its own word, sets its own variables and defines its own functions. Run each block as one Bash tool call.
- **Hooks:** never `git commit --no-verify`, and never `git stash`. Tracked source may not cite `file:line`; name symbols instead.
- **Staging:** stage files by name or by an applied patch, never with `git add -A` or a directory. A probe file or fixture left untracked in the tree is swept into a directory `git add`.
- **The browser tier:** Chrome is `google-chrome-stable` in `/usr/sbin`, off the interactive `PATH`, so every browser command puts `/usr/sbin` first. `scripts/check-all.sh` then also needs `TREE_SITTER` pointed at the pinned 0.25.10 in the main checkout's `.tools/`, because `/usr/sbin` also holds a newer one.
- **Sabotage runs:** always `cargo nextest run --no-fail-fast`, and read the `Summary` line; the default stops at the first failure and truncates the red list. Every sabotage goes through `sab.py`, which exits 2 when its target text is not in the file exactly once, so a sabotage that does not apply cannot read as one that stayed green.
- No AI or Claude attribution anywhere: code, comments or commit messages.
- The roadmap entry is not part of this plan.
- **Timings are one machine's,** taken while other agents loaded it; each gives the load average it started at.

## How this plan's code was verified

Every task's end state was built and committed, through the unmodified pre-commit hooks, on a throwaway scratch branch. At its Task 6 commit it passed `scripts/check-all.sh`, "all configs green — base, LLVM and browser" with 1,764 workspace tests. With Task 6's supersession test fixed as it appears here, it passed CI's `web` job sequence (`biome ci --error-on-warnings`, `typecheck`, `test:coverage`, `build:app`) with 724 of 724 web tests. The scratch tasks were then rebuilt one commit each, with their final commit messages and the doc corrections the build had shown were needed, on a second throwaway branch:

| task | commit message |
| --- | --- |
| 1 | Decide a headered run's value in one function the CLI reads through |
| 2 | A TM scratch builds a value run beside it, and names its tapes per file |
| 3 | Refuse TM scratch text over 6,100,000 bytes before parsing it |
| 4 | Carry a TM buffer's value run to the main thread |
| 5 | A TM pane says a file is reduced and shows its value |
| 6 | Hold a reduced file in a TM buffer to its value through the real app |

Both branches, and the replay branch below, were local and are deleted once this plan's PR merges, so their commits are named by task here rather than by hash. The embedded patches below are the record of the second branch's commits, less Task 6's fixture, which Task 6 regenerates and checks by hash.

**Each task's patch below is that commit's `git show --format=` output, embedded verbatim. Apply it; do not retype it.** Task 6's omits the 103,028-byte fixture, which Task 6 regenerates with `redextape emit` and checks by hash. The blocks were extracted from this file with `block_of` and applied in order on a replay branch from `bbc35ba` with the spec committed on top, and every step of every task ran there as written, with only `P` and `PLAN` pointed at the replay. After each task's commit, `git diff --quiet <that task's commit> HEAD -- . ':!docs/superpowers/plans'` succeeded: the replay branch carries this plan and the rebuilt branch does not. The summaries, counts and sabotage results each step expects are the replay's. The two whole-branch gate blocks after Task 6 were rewritten once the replay's first run of them showed a pipe hiding an OOM kill, and ran again as they stand here.

**No step shows a red-first run of a new test,** because the code existed before the plan. Each task instead runs sabotages on its committed code, each breaking one rule, and records which tests go red.

**Baseline:** `cargo nextest run --workspace` on `bbc35ba` with the spec committed on top, under the cap: `Summary 1744 tests run: 1744 passed, 33 skipped`

Every embedded file sits between a `<!-- BEGIN name -->` line and an `<!-- END name -->` line, and each block that reads one defines `block_of` to extract it.

### The sabotage helper

Every sabotage block writes this file to `$S/sab.py` first.

<!-- BEGIN sab.py -->
````python
"""Apply one sabotage: replace the single occurrence of OLD in FILE with NEW.

Exits 2, naming the count, unless OLD occurs exactly once, so a sabotage that does not apply can never read as a
sabotage that stayed green. Formatters rewrap lines, and the sabotage text must match the file as committed.
"""
import sys

path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
count = text.count(old)
if count != 1:
    print(f"SABOTAGE NOT APPLIED: {count} occurrences in {path} of:\n{old}", file=sys.stderr)
    sys.exit(2)
open(path, "w", encoding="utf-8").write(text.replace(old, new))
print(f"applied to {path}")
````
<!-- END sab.py -->

### Before Task 1: set up the worktree

A fresh worktree has no `web/node_modules` and no `pkg/`, and the pre-commit hook's `web typecheck` needs both.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
pnpm --dir "$P/web" install --frozen-lockfile 2>&1 | tail -1
cd "$P/web" && CARGO_TARGET_DIR="$P/target" pnpm run build:wasm:dev 2>&1 | tail -1
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run --workspace 2>&1 | grep -E "FAIL|Summary"
```

Expected: a `Done in` line, `[INFO]: 📦   Your wasm pkg is ready to publish at ../pkg.`, and the baseline summary above.

---

### Task 1: One decision for a run's value, and `redextape run` over it

**Files:**
- Modify: `crates/redextape-core/src/tm/reduced_file.rs` — `run_caps`, `RunFailure`, `value_of_run`, and six unit tests
- Modify: `crates/redextape-core/src/tm.rs` — re-export the three
- Modify: `crates/redextape-cli/src/run.rs` — `run_artifact_text` reads its value through them

**What changes.**
1. **`run_caps(h)`** is a reduced header's recorded step count with `TM_DEFAULT_CAPS`' cells, or `TM_DEFAULT_CAPS` for a lowered header.
2. **`value_of_run(m, h, tapes, state, status)`** answers `RunFailure::HitCap` for a capped run, `RunFailure::NotAccept(state)` for a reduced run whose final state exists and is not an accept state, and otherwise `decode_reduced`, its failure wrapped in `RunFailure::Decode`.
3. **`run_artifact_text`** calls `run_caps`, `simulate_final` and `value_of_run`, and maps each `RunFailure` onto the sentence and `Outcome` it produced before. `report_tm_decode` is unchanged and still words both `DecodeFailure` causes.

**Tests:** one core unit test per answer (`a_reduced_header_runs_under_its_own_step_count`, `a_finished_run_under_either_header_is_its_value`, `a_capped_run_has_no_value_even_when_its_tapes_decode`, `a_reduced_run_that_stops_outside_an_accept_state_has_no_value`, `a_lowered_run_is_not_held_to_an_accept_state`, `tapes_the_header_does_not_describe_are_a_decode_failure`). No CLI test changes: every existing `run.rs` test and `tests/cmd` snapshot passes unedited, which is the evidence that no message or exit code moved.

**Interfaces:**
- Produces, re-exported from `redextape_core::tm`:
  - `pub fn run_caps(h: &TmHeader) -> TmCaps`
  - `pub enum RunFailure { HitCap, NotAccept(StateId), Decode(DecodeFailure) }` (`Clone, Copy, Debug, PartialEq, Eq`)
  - `pub fn value_of_run(m: &Machine, h: &TmHeader, tapes: &[Tape], state: StateId, status: TmStatus) -> Result<Value, RunFailure>`

- [ ] **Step 1: Confirm the starting commit and a clean tree**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD && git -C "$P" diff --cached --quiet && echo clean
```

Expected: a line ending `Plan: TM buffers run reduced files`, then `clean`.

- [ ] **Step 2: Apply the patch**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
block_of task1.patch | git -C "$P" apply --index --check && block_of task1.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat | tail -1
```

Expected: `3 files changed, 163 insertions(+), 33 deletions(-)`
<!-- BEGIN task1.patch -->
````diff
diff --git a/crates/redextape-cli/src/run.rs b/crates/redextape-cli/src/run.rs
index e760c8d..e67f345 100644
--- a/crates/redextape-cli/src/run.rs
+++ b/crates/redextape-cli/src/run.rs
@@ -114,6 +114,10 @@ pub fn run(
 /// `decode_reduced` undoes its stages before the value is decoded. A `version 1` file is simulated and
 /// decoded as it always was: `decode_reduced` decodes a header with no reduction exactly as
 /// `decode_tape_ty_reason` does.
+///
+/// **THOSE CHECKS ARE `run_caps` AND `value_of_run`, NOT CODE IN THIS FUNCTION.** The web app's TM buffers
+/// read a value through the same two, so the CLI and the browser cannot disagree about one; what stays
+/// here is only the wording of each `RunFailure` for a terminal.
 fn run_artifact_text(
     src: &str,
     label: &str,
@@ -142,37 +146,36 @@ fn run_artifact_text(
     };
     let init = header.init(machine.tapes);
     let defaults = redextape_core::tm::TM_DEFAULT_CAPS;
-    let caps = header
-        .reduction
-        .as_ref()
-        .map_or(defaults, |r| redextape_core::tm::TmCaps { steps: r.steps, cells: defaults.cells });
+    let caps = redextape_core::tm::run_caps(&header);
     let (tapes, state, status, _steps) = redextape_core::tm::simulate_final(&machine, &init, caps);
-    if status == redextape_core::tm::TmStatus::HitCap {
-        match &header.reduction {
-            None => writeln!(
-                err,
-                "error: the machine did not halt within {} steps or {} tape cells (`TM_DEFAULT_CAPS`)",
-                defaults.steps, defaults.cells
-            )?,
-            Some(r) => writeln!(
+    let decoded = match redextape_core::tm::value_of_run(&machine, &header, &tapes, state, status) {
+        Err(redextape_core::tm::RunFailure::HitCap) => {
+            match &header.reduction {
+                None => writeln!(
+                    err,
+                    "error: the machine did not halt within {} steps or {} tape cells (`TM_DEFAULT_CAPS`)",
+                    defaults.steps, defaults.cells
+                )?,
+                Some(r) => writeln!(
+                    err,
+                    "error: the reduced machine did not halt within the {} steps its header records, or {} tape cells",
+                    r.steps, defaults.cells
+                )?,
+            }
+            return Ok(Outcome::ProgramFailed);
+        }
+        Err(redextape_core::tm::RunFailure::NotAccept(halted_in)) => {
+            writeln!(
                 err,
-                "error: the reduced machine did not halt within the {} steps its header records, or {} tape cells",
-                r.steps, defaults.cells
-            )?,
+                "error: `{label}`'s reduced machine halted in `{}`, which is not an accept state\n  \
+                 a reduction's run ends in an accept state, so these tapes hold no value",
+                machine.states[halted_in as usize].name
+            )?;
+            return Ok(Outcome::ProgramFailed);
         }
-        return Ok(Outcome::ProgramFailed);
-    }
-    if header.reduction.is_some()
-        && let Some(halted_in) = machine.states.get(state as usize).filter(|s| !s.accept)
-    {
-        writeln!(
-            err,
-            "error: `{label}`'s reduced machine halted in `{}`, which is not an accept state\n  \
-             a reduction's run ends in an accept state, so these tapes hold no value",
-            halted_in.name
-        )?;
-        return Ok(Outcome::ProgramFailed);
-    }
+        Err(redextape_core::tm::RunFailure::Decode(failure)) => Err(failure),
+        Ok(v) => Ok(v),
+    };
     // **TWO CAUSES REACH THIS DECODE, WITH OPPOSITE FAULT ATTRIBUTIONS — SEE `DecodeFailure`.** An
     // earlier revision of this comment argued every failure here was the file's fault, on the strength
     // of `HeaderParts::directive` (D5) already refusing a `result` that is not a value type — true, but
@@ -184,7 +187,7 @@ fn run_artifact_text(
     // the SAME distinction `run_asm_artifact` draws for the identical two causes on the `.asm` form; the
     // two runners used to give it opposite, and each individually wrong, treatments (see that function's
     // doc).
-    report_tm_decode(redextape_core::tm::decode_reduced(&tapes, &header), label, &header.result, out, err)
+    report_tm_decode(decoded, label, &header.result, out, err)
 }
 
 /// `run_artifact_text`'s final `match`, on the two `DecodeFailure` causes — extracted so the MAPPING
diff --git a/crates/redextape-core/src/tm.rs b/crates/redextape-core/src/tm.rs
index e5b9920..5a28af5 100644
--- a/crates/redextape-core/src/tm.rs
+++ b/crates/redextape-core/src/tm.rs
@@ -46,7 +46,7 @@ pub use header::{
 pub use lower_asm::{LowerError, lower_asm, lower_asm_mapped};
 pub use lower_tm::{lower_tm, lower_tm_guarded, lower_tm_mapped, n_slots_of};
 pub use machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
-pub use reduced_file::{ReduceError, decode_reduced, reduce};
+pub use reduced_file::{ReduceError, RunFailure, decode_reduced, reduce, run_caps, value_of_run};
 pub use sim::{
     Caps as TmCaps, DEFAULT_CAPS as TM_DEFAULT_CAPS, Status as TmStatus, Step, Tape, Trace, Watcher, simulate,
     simulate_counts, simulate_final, simulate_trace, simulate_watched,
diff --git a/crates/redextape-core/src/tm/reduced_file.rs b/crates/redextape-core/src/tm/reduced_file.rs
index 8536c32..093e5ae 100644
--- a/crates/redextape-core/src/tm/reduced_file.rs
+++ b/crates/redextape-core/src/tm/reduced_file.rs
@@ -3,7 +3,9 @@
 //!
 //! [`reduce`] applies the stages a caller names to a [`DescribedRun`], checks the result by running it,
 //! and returns the reduced machine with its `version 2` header. [`decode_reduced`] undoes a header's
-//! stages on a run's final tapes and decodes the value. The header's text form belongs to `header.rs`.
+//! stages on a run's final tapes and decodes the value. [`run_caps`] and [`value_of_run`] are what a
+//! reader of a headered file runs it under and reads its value with. The header's text form belongs to
+//! `header.rs`.
 
 use crate::tm::DescribedRun;
 use crate::tm::TmRun;
@@ -11,10 +13,10 @@ use crate::tm::asm::DecodeFailure;
 use crate::tm::build::MAX_MACHINE_STATES;
 use crate::tm::decode::decode_tape_ty_reason;
 use crate::tm::header::{MAX_REDUCED_STEPS, Reduction, Stage, StageKind, TmHeader, is_stage_list};
-use crate::tm::machine::{Machine, Symbol};
+use crate::tm::machine::{Machine, StateId, Symbol};
 use crate::tm::one_way::{to_one_way_within, unzigzag, zigzag};
 use crate::tm::reduction::refusal;
-use crate::tm::sim::{Caps, DEFAULT_CAPS, Tape, simulate_final, simulate_origins};
+use crate::tm::sim::{Caps, DEFAULT_CAPS, Status, Tape, simulate_final, simulate_origins};
 use crate::tm::single_tape::{deinterleave, interleave, layout_collision, to_single_tape_within};
 use crate::tm::two_symbol::{Code, bitify, to_two_symbol_within, unbitify};
 use crate::value::Value;
@@ -165,6 +167,59 @@ pub fn decode_reduced(tapes: &[Tape], h: &TmHeader) -> Result<Value, DecodeFailu
     decode_tape_ty_reason(undone.as_deref().unwrap_or(tapes), &h.result, &*h.encoding())
 }
 
+/// The caps a headered file runs under: the step count a reduced header records, or `DEFAULT_CAPS`' steps
+/// for a lowered one, and `DEFAULT_CAPS`' cells either way.
+///
+/// **A REDUCED FILE CANNOT RUN UNDER THE DEFAULT STEP CAP.** A reduction multiplies a machine's steps, and
+/// `reduce` records the count its own verifying run took, up to `MAX_REDUCED_STEPS`, so that the file alone
+/// says how long it runs.
+#[must_use]
+pub fn run_caps(h: &TmHeader) -> Caps {
+    match &h.reduction {
+        Some(r) => Caps { steps: r.steps, cells: DEFAULT_CAPS.cells },
+        None => DEFAULT_CAPS,
+    }
+}
+
+/// Why a finished run under a header holds no value. [`value_of_run`] is the one producer.
+#[derive(Clone, Copy, Debug, PartialEq, Eq)]
+pub enum RunFailure {
+    /// The run stopped at a cap rather than halting. A caller says whose count it was from the header's
+    /// `reduction`.
+    HitCap,
+    /// A reduced run halted in this state, which is not an accept state. A reduction's run ends in an accept
+    /// state, so these tapes hold no value even when they decode. Never produced under a lowered header.
+    NotAccept(StateId),
+    /// [`decode_reduced`] refused the tapes, for either of `DecodeFailure`'s causes.
+    Decode(DecodeFailure),
+}
+
+/// The value a finished run's tapes hold under `h`: a capped run first, then a reduced run halting outside an
+/// accept state, then [`decode_reduced`].
+///
+/// **THE ONE DECISION `redextape run` AND THE WEB APP'S TM BUFFERS BOTH READ A VALUE WITH.** Neither restates
+/// these checks; each words the failures for its own surface.
+///
+/// # Errors
+///
+/// [`RunFailure`]: `HitCap` for a capped run, `NotAccept` for a reduced run whose final state exists and is not
+/// an accept state, and `Decode` when [`decode_reduced`] refuses.
+pub fn value_of_run(
+    m: &Machine,
+    h: &TmHeader,
+    tapes: &[Tape],
+    state: StateId,
+    status: Status,
+) -> Result<Value, RunFailure> {
+    if status == Status::HitCap {
+        return Err(RunFailure::HitCap);
+    }
+    if h.reduction.is_some() && m.states.get(state as usize).is_some_and(|s| !s.accept) {
+        return Err(RunFailure::NotAccept(state));
+    }
+    decode_reduced(tapes, h).map_err(RunFailure::Decode)
+}
+
 /// One stage's inverse over a run's tapes, or `None` when they are not tapes that stage produces.
 ///
 /// **THE HEAD SURVIVES EVERY STAGE BUT THE FOLD.** `unzigzag` refuses a head on physical cell 0, so a
@@ -347,6 +402,78 @@ mod tests {
         assert_eq!(decode_reduced(tapes, &d.header), want);
     }
 
+    #[test]
+    fn a_reduced_header_runs_under_its_own_step_count() {
+        let caps = |h: &TmHeader| (run_caps(h).steps, run_caps(h).cells);
+        let mut h = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![]);
+        assert_eq!(caps(&h), (DEFAULT_CAPS.steps, DEFAULT_CAPS.cells), "a lowered header runs under the defaults");
+        h.reduction = Some(Reduction { stages: vec![Stage::Fold], steps: 7 });
+        assert_eq!(caps(&h), (7, DEFAULT_CAPS.cells));
+    }
+
+    /// A lowered run, finished in its accept state, with tapes holding `Nat(1)`: every `value_of_run` test
+    /// below starts here, so the one thing each changes is the one check it is about.
+    fn finished() -> DescribedRun {
+        run_of(walk(&[Move::R], accept()), bank(true))
+    }
+
+    /// `finished`'s header and tapes re-expressed as a two-symbol reduction's, which also decode to `Nat(1)`.
+    fn bits_of(d: &DescribedRun) -> (TmHeader, Vec<Tape>) {
+        let code = Code::from_symbols(&['_', '#', '1']).unwrap();
+        let mut h = d.header.clone();
+        h.reduction = Some(Reduction { stages: vec![Stage::TwoSymbol { symbols: code.symbols().to_vec() }], steps: 1 });
+        let tapes = bitify(&d.header.init(d.machine.tapes), &code).unwrap().iter().map(|b| Tape::new(b)).collect();
+        (h, tapes)
+    }
+
+    const DONE: StateId = 1;
+    const WALKING: StateId = 0;
+
+    #[test]
+    fn a_finished_run_under_either_header_is_its_value() {
+        let d = finished();
+        let TmRun::Ran { tapes } = &d.run else { panic!("run_of always runs") };
+        assert_eq!(value_of_run(&d.machine, &d.header, tapes, DONE, Status::Halted), Ok(Value::Nat(1)));
+        let (h, bits) = bits_of(&d);
+        assert_eq!(value_of_run(&d.machine, &h, &bits, DONE, Status::Halted), Ok(Value::Nat(1)));
+    }
+
+    /// The tapes decode; only the status says the run never finished.
+    #[test]
+    fn a_capped_run_has_no_value_even_when_its_tapes_decode() {
+        let d = finished();
+        let TmRun::Ran { tapes } = &d.run else { panic!("run_of always runs") };
+        assert_eq!(value_of_run(&d.machine, &d.header, tapes, DONE, Status::HitCap), Err(RunFailure::HitCap));
+    }
+
+    /// The bits decode; only the final state says a reduced run went wrong.
+    #[test]
+    fn a_reduced_run_that_stops_outside_an_accept_state_has_no_value() {
+        let d = finished();
+        let (h, bits) = bits_of(&d);
+        assert_eq!(value_of_run(&d.machine, &h, &bits, WALKING, Status::Halted), Err(RunFailure::NotAccept(WALKING)));
+    }
+
+    /// The accept check is `reduce`'s promise about a reduced run. A lowered file reads exactly as it did before
+    /// reductions existed, whatever state it halts in.
+    #[test]
+    fn a_lowered_run_is_not_held_to_an_accept_state() {
+        let d = finished();
+        let TmRun::Ran { tapes } = &d.run else { panic!("run_of always runs") };
+        assert_eq!(value_of_run(&d.machine, &d.header, tapes, WALKING, Status::Halted), Ok(Value::Nat(1)));
+    }
+
+    #[test]
+    fn tapes_the_header_does_not_describe_are_a_decode_failure() {
+        let d = finished();
+        let TmRun::Ran { tapes } = &d.run else { panic!("run_of always runs") };
+        let (h, _bits) = bits_of(&d);
+        assert_eq!(
+            value_of_run(&d.machine, &h, tapes, DONE, Status::Halted),
+            Err(RunFailure::Decode(DecodeFailure::Mismatch))
+        );
+    }
+
     /// Each inverse, handed tapes its stage never produces, is a mismatch rather than a guess.
     #[test]
     fn tapes_a_stage_did_not_produce_are_a_mismatch() {
````
<!-- END task1.patch -->

- [ ] **Step 3: Format and lint**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo clippy -p redextape-core -p redextape-cli --all-targets -- -D warnings 2>&1 | grep -E "^(warning|error)"; echo "clippy done"
```

Expected: `fmt exit 0`, and `clippy done` with no `warning` or `error` line before it.

- [ ] **Step 4: Run the core unit tests and the whole CLI suite**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core -p redextape-cli -E 'test(/^tm::reduced_file::/) | package(redextape-cli)' 2>&1 | grep -E "FAIL|Summary"
```

Expected summary line: `Summary 182 tests run: 182 passed, 1251 skipped`

- [ ] **Step 5: Commit**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -q -F - <<'EOF'
Decide a headered run's value in one function the CLI reads through

run_caps gives the caps a headered file runs under: the step count a
reduced header records, or TM_DEFAULT_CAPS for a lowered one, with
TM_DEFAULT_CAPS' cells either way. value_of_run reads a finished run's
value under that header: a capped run first, then a reduced run that
halted outside an accept state, then decode_reduced, each failure a
RunFailure variant.

redextape run's run_artifact_text now calls the two and only words each
RunFailure for a terminal, so its messages and exit codes are unchanged
and every existing run.rs test and tests/cmd snapshot passes unedited.
The web app's TM buffers read a value through the same two functions.
EOF
git -C "$P" log --oneline -1 && git -C "$P" status --short
```

Expected: every hook the commit prints reads `Passed` or `Skipped`, then a line ending `Decide a headered run's value in one function the CLI reads through`, and no `git status` line.

- [ ] **Step 6: Sabotages**

Each row breaks one rule and records which tests go red. Run the whole block as one Bash tool call, with a timeout of 1800000 ms.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
block_of sab.py >| "$S/sab.py"
fast() { cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run --no-fail-fast -p redextape-core -p redextape-cli -E 'test(/^tm::reduced_file::/) | package(redextape-cli)' 2>&1 | grep -E "^\s+FAIL \[|Summary"; }
restore() { git -C "$P" checkout -- crates/ && git -C "$P" status --short -- crates/; }
R="$P/crates/redextape-core/src/tm/reduced_file.rs"

echo "T1-S1: the accept check is skipped"
python3 "$S/sab.py" "$R" '    if h.reduction.is_some() && m.states.get(state as usize).is_some_and(|s| !s.accept) {' '    if false && m.states.get(state as usize).is_some_and(|s| !s.accept) {' && fast; restore

echo "T1-S2: the accept check is applied to lowered runs too"
python3 "$S/sab.py" "$R" '    if h.reduction.is_some() && m.states.get(state as usize).is_some_and(|s| !s.accept) {' '    if m.states.get(state as usize).is_some_and(|s| !s.accept) {' && fast; restore

echo "T1-S3: a reduced header runs under the default caps"
python3 "$S/sab.py" "$R" '        Some(r) => Caps { steps: r.steps, cells: DEFAULT_CAPS.cells },' '        Some(_) => DEFAULT_CAPS,' && fast; restore

echo "T1-S4: a capped run is decoded anyway"
python3 "$S/sab.py" "$R" '    if status == Status::HitCap {' '    if false && status == Status::HitCap {' && fast; restore

echo "T1-S5: the tapes are decoded as lowered ones"
python3 "$S/sab.py" "$R" '    decode_reduced(tapes, h).map_err(RunFailure::Decode)' '    decode_tape_ty_reason(tapes, &h.result, &*h.encoding()).map_err(RunFailure::Decode)' && fast; restore

echo "T1-S6: a decode failure is reported as a capped run"
python3 "$S/sab.py" "$R" '    decode_reduced(tapes, h).map_err(RunFailure::Decode)' '    decode_reduced(tapes, h).map_err(|_| RunFailure::HitCap)' && fast; restore
```

Expected, row by row, each followed by the restore printing no `git status` line:

- **T1-S1** (the accept check is skipped):
  - red: `redextape-cli::bin/redextape run::tests::a_reduced_file_that_halts_outside_an_accept_state_is_the_files_fault`
  - red: `redextape-core tm::reduced_file::tests::a_reduced_run_that_stops_outside_an_accept_state_has_no_value`
  - `Summary 182 tests run: 180 passed, 2 failed, 1251 skipped`
- **T1-S2** (the accept check is applied to lowered runs too):
  - red: `redextape-core tm::reduced_file::tests::a_lowered_run_is_not_held_to_an_accept_state`
  - `Summary 182 tests run: 181 passed, 1 failed, 1251 skipped`
- **T1-S3** (a reduced header runs under the default caps):
  - red: `redextape-cli::bin/redextape run::tests::a_reduced_file_that_does_not_halt_within_its_own_steps_is_the_files_fault`
  - red: `redextape-core tm::reduced_file::tests::a_reduced_header_runs_under_its_own_step_count`
  - `Summary 182 tests run: 180 passed, 2 failed, 1251 skipped`
- **T1-S4** (a capped run is decoded anyway):
  - red: `redextape-cli::bin/redextape run::tests::a_reduced_file_that_does_not_halt_within_its_own_steps_is_the_files_fault`
  - red: `redextape-core tm::reduced_file::tests::a_capped_run_has_no_value_even_when_its_tapes_decode`
  - red: `redextape-cli::bin/redextape run::tests::a_capped_tm_artifact_is_the_programs_fault_not_a_decode_failure`
  - `Summary 182 tests run: 179 passed, 3 failed, 1251 skipped`
- **T1-S5** (the tapes are decoded as lowered ones):
  - red: `redextape-core tm::reduced_file::tests::a_finished_run_under_either_header_is_its_value`
  - red: `redextape-core tm::reduced_file::tests::tapes_the_header_does_not_describe_are_a_decode_failure`
  - red: `redextape-cli::roundtrip a_file_reduced_to_one_tape_runs_to_the_reference_answer`
  - `Summary 182 tests run: 179 passed, 3 failed, 1251 skipped`
- **T1-S6** (a decode failure is reported as a capped run):
  - red: `redextape-cli::bin/redextape run::tests::a_tm_artifact_with_a_lying_bool_header_is_the_files_fault`
  - red: `redextape-core tm::reduced_file::tests::tapes_the_header_does_not_describe_are_a_decode_failure`
  - red: `redextape-cli::bin/redextape run::tests::tapes_that_contradict_the_headers_own_result_type_are_the_files_fault`
  - `Summary 182 tests run: 179 passed, 3 failed, 1251 skipped`

**T1-S2 is caught only by core.** The CLI suite has no lowered file that halts outside an accept state, so it stays green; `a_lowered_run_is_not_held_to_an_accept_state` is the one guard.

---

### Task 2: `TmValueRun`, and a scratch's own tape names and reduction

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs` — `TmScratched`, `TmValueRun`, `ValueRun`, `ReductionStatus`, `TmScratchStatus::reduction`, `TmScratch::tape_names`; `build_tm_leg` and `tm_leg_at` take an `Rc<Machine>`; eleven tests
- Modify: `crates/redextape-wasm/src/lib.rs` — the `TmValueRun` class, `tmScratch`'s `value` field, `TmScratch.tapeNames`, and the re-exports
- Modify: `crates/redextape-wasm/tests/ts_bindings.rs` — `ReductionStatus` and `ValueRun` in `generated()`
- Modify: `web/tests/browser/tm-pane-editor.test.ts` — three `TmScratchStatus` literals gain `reduction: null`

**What changes.**
1. **`tm_scratch(src)` returns `TmScratched { diagnostics, scratch, value }`.** `value` is `Some(TmValueRun)` exactly when the text parsed and carries a header, sharing the scratch cursor's `Rc<Machine>`, so a machine is held once however many cursors walk it.
2. **`TmValueRun::run(budget)`** steps its own cursor up to `budget` steps and answers `ValueRun { run, steps, cap }`. **`TmValueRun::value()`** answers `Decoded::Unfinished` until the run ends, then `value_of_run` as a `Decoded`: a value through the capped printer; `HitCap` and `NotAccept` as a `Fault` naming the count or the state; `Mismatch` as `Undecodable`; `BudgetExhausted` as a `Fault` worded as the tool's limit.
3. **`TmScratch` gains no value method.** Decision 2 and both of its pins stand.
4. **`TmScratchStatus.reduction`** is a version 2 header's stage names and steps. **`TmScratch::tape_names()`** is `TAPE_NAMES`, or one `"{k} tapes, interleaved"` label under a single-tape stage.

**The web literals are in this commit, not Task 4's.** A commit touching only `crates/` skips the `web typecheck` hook, and the new field breaks three literals in `tm-pane-editor.test.ts`.

**Interfaces:**
- Consumes: Task 1's `run_caps`, `value_of_run`, `RunFailure`.
- Produces, in Rust (`redextape_wasm`): `TmScratched`, `TmValueRun` (`run(&mut self, u64) -> ValueRun`, `value(&self) -> Decoded`), `ValueRun { run: RunStatus, steps: u64, cap: u64 }`, `ReductionStatus { stages: Vec<String>, steps: u64 }`, `TmScratchStatus.reduction: Option<ReductionStatus>`, `TmScratch::tape_names(&self) -> Vec<String>`.
- Produces, in JavaScript: `tmScratch(src)` → `{ diagnostics, scratch: TmScratch | null, value: TmValueRun | null }`; `TmValueRun.run(budget: number) → ValueRun`; `TmValueRun.value() → Decoded`; `TmScratch.tapeNames() → string[]`. Generated `web/bindings/ValueRun.ts` and `web/bindings/ReductionStatus.ts`, with every count typed `number`.

- [ ] **Step 1: Confirm the starting commit and a clean tree**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD && git -C "$P" diff --cached --quiet && echo clean
```

Expected: a line ending `Decide a headered run's value in one function the CLI reads through`, then `clean`.

- [ ] **Step 2: Apply the patch**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
block_of task2.patch | git -C "$P" apply --index --check && block_of task2.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat | tail -1
```

Expected: `4 files changed, 385 insertions(+), 23 deletions(-)`
<!-- BEGIN task2.patch -->
````diff
diff --git a/crates/redextape-wasm/src/lib.rs b/crates/redextape-wasm/src/lib.rs
index 72b8768..e8c0fdd 100644
--- a/crates/redextape-wasm/src/lib.rs
+++ b/crates/redextape-wasm/src/lib.rs
@@ -27,7 +27,7 @@ mod session;
 /// canonical-line check. Under default features — which is every browser build — this line does not
 /// exist.
 #[cfg(feature = "ts")]
-pub use session::{Decoded, LambdaStatus, RunStatus, TmScratchStatus, TmStatus};
+pub use session::{Decoded, LambdaStatus, ReductionStatus, RunStatus, TmScratchStatus, TmStatus, ValueRun};
 
 use redextape_core::tm::EncodingKind;
 use serde::Serialize;
@@ -161,7 +161,38 @@ pub fn lambda_scratch_at(src: &str, step: u32, byte_budget: usize) -> Result<JsV
 #[wasm_bindgen]
 pub struct TmScratch(session::TmScratch);
 
-/// `tmScratch(src)` -> `{ diagnostics: Diagnostic[], scratch: TmScratch | null }`.
+/// The run that reads a headered TM scratch's value. See `session::TmValueRun` for why it is a handle of its
+/// own rather than a method on `TmScratch`.
+#[wasm_bindgen]
+pub struct TmValueRun(session::TmValueRun);
+
+#[wasm_bindgen]
+impl TmValueRun {
+    /// Advance up to `budget` steps. `u32` and widened, for the reason `Session::raiseLambdaCap` records.
+    ///
+    /// # Errors
+    ///
+    /// Returns `Err` only if `to_value` cannot marshal the `ValueRun`; not expected for this crate's own types.
+    #[wasm_bindgen]
+    pub fn run(&mut self, budget: u32) -> Result<JsValue, JsValue> {
+        to_value(&self.0.run(u64::from(budget)))
+    }
+
+    /// `Unfinished` until `run` reports an end.
+    ///
+    /// # Errors
+    ///
+    /// Returns `Err` only if `to_value` cannot marshal the `Decoded`; not expected for this crate's own types.
+    #[wasm_bindgen]
+    pub fn value(&self) -> Result<JsValue, JsValue> {
+        to_value(&self.0.value())
+    }
+}
+
+/// `tmScratch(src)` -> `{ diagnostics: Diagnostic[], scratch: TmScratch | null, value: TmValueRun | null }`.
+///
+/// **`value` IS NULL WHENEVER `scratch` IS, AND ALSO FOR A SCRATCH WHOSE TEXT HAS NO HEADER** — decision 2's
+/// absence at construction rather than a method that declines. See `session::TmValueRun`.
 ///
 /// Assembled by hand for the reason `compile` and `lambdaScratch` give: a handle and plain data cross
 /// two different ways.
@@ -187,6 +218,11 @@ pub fn tm_scratch(src: &str) -> Result<JsValue, JsValue> {
         None => JsValue::NULL,
     };
     js_sys::Reflect::set(&out, &JsValue::from_str("scratch"), &handle)?;
+    let value = match made.value {
+        Some(v) => JsValue::from(TmValueRun(v)),
+        None => JsValue::NULL,
+    };
+    js_sys::Reflect::set(&out, &JsValue::from_str("value"), &value)?;
     Ok(out.into())
 }
 
@@ -745,4 +781,15 @@ impl TmScratch {
     pub fn raise_tm_cap(&mut self, extra_steps: u32, extra_cells: u32) {
         self.0.raise_tm_cap(u64::from(extra_steps), u64::from(extra_cells));
     }
+
+    /// What to label each tape — per scratch, unlike the fixed `tapeNames()` export, because a reduced file's
+    /// single-tape stage changes what its one tape is.
+    ///
+    /// # Errors
+    ///
+    /// Returns `Err` only if `to_value` cannot marshal the names; not expected for this crate's own types.
+    #[wasm_bindgen(js_name = tapeNames)]
+    pub fn tape_names(&self) -> Result<JsValue, JsValue> {
+        to_value(&self.0.tape_names())
+    }
 }
diff --git a/crates/redextape-wasm/src/session.rs b/crates/redextape-wasm/src/session.rs
index 763fcff..cb69e79 100644
--- a/crates/redextape-wasm/src/session.rs
+++ b/crates/redextape-wasm/src/session.rs
@@ -409,7 +409,7 @@ pub struct Session {
 /// spell. Widening would put decision 6's invented width and invented tapes one accidental `None`
 /// away from a compiled program. The shared part is factored into `tm_leg_at` instead, which knows
 /// nothing about headers.
-fn build_tm_leg(header: &tm::TmHeader, machine: Machine, caps: tm::TmCaps) -> (TmProgram, TmCursor<Rc<Machine>>) {
+fn build_tm_leg(header: &tm::TmHeader, machine: Rc<Machine>, caps: tm::TmCaps) -> (TmProgram, TmCursor<Rc<Machine>>) {
     let init = header.init(machine.tapes);
     tm_leg_at(machine, header.width, &init, caps)
 }
@@ -419,20 +419,21 @@ fn build_tm_leg(header: &tm::TmHeader, machine: Machine, caps: tm::TmCaps) -> (T
 ///
 /// EXTRACTED SO THERE IS ONE PROJECTION SITE, not two. `build_tm_leg` (above) derives `width`/`init`
 /// from a `TmHeader`; `tm_scratch` derives them from a header or, absent one, from §3.4's defaults.
-/// Both then do the same three things, and the `Rc` sharing between the projection and the cursor is
-/// exactly the detail that would rot if it were written twice.
+/// Both then do the same two things, which would rot if they were written twice.
+///
+/// **THE CALLER MAKES THE `Rc`**, so that `tm_scratch` can hand the same machine to the `TmValueRun` beside
+/// this cursor rather than holding it twice.
 fn tm_leg_at(
-    machine: Machine,
+    machine: Rc<Machine>,
     width: usize,
     init: &[Vec<Symbol>],
     caps: tm::TmCaps,
 ) -> (TmProgram, TmCursor<Rc<Machine>>) {
-    let machine = Rc::new(machine);
     // `TmProgram` is projected ONCE, here, and cached — never per step. The `map` demo is 3,203 states
     // over 344,999 steps; re-projecting per `tmState` is the cost the `TmProgram`/`TmState` split
     // exists to avoid.
     let program = TmProgram::of(&machine, width);
-    let cursor = TmCursor::new(Rc::clone(&machine), init, caps);
+    let cursor = TmCursor::new(machine, init, caps);
     (program, cursor)
 }
 
@@ -603,11 +604,11 @@ impl Session {
                 // a run that spent its budget is resumable through `raise_tm_cap`, so flattening it
                 // into a decline would throw away a session the user can still drive.
                 TmRun::Ran { tapes } => {
-                    let (p, c) = build_tm_leg(&d.header, d.machine, caps);
+                    let (p, c) = build_tm_leg(&d.header, Rc::new(d.machine), caps);
                     Ok(((p, c, d.header), Some(tapes)))
                 }
                 TmRun::HitCap => {
-                    let (p, c) = build_tm_leg(&d.header, d.machine, caps);
+                    let (p, c) = build_tm_leg(&d.header, Rc::new(d.machine), caps);
                     Ok(((p, c, d.header), None))
                 }
             },
@@ -1154,7 +1155,7 @@ impl LambdaScratch {
 /// cost this file; this type is that lesson applied before the fact.
 ///
 /// The Rust side pins the field list by an exhaustive destructuring in this module's own tests
-/// (`let TmScratchStatus { available, reason, width, run, header } = sc.tm_status();`), so a sixth
+/// (`let TmScratchStatus { available, reason, width, run, header, reduction } = sc.tm_status();`), so a seventh
 /// field added here fails to compile there with `E0027` rather than merely going unrendered.
 ///
 /// **`width` AND `run` ARE NOT `Option`, WHICH IS THE SAME ARGUMENT IN THE OTHER DIRECTION.** They are
@@ -1188,6 +1189,19 @@ pub struct TmScratchStatus {
     /// field is the only thing that lets a renderer distinguish that from a file that asked for exactly
     /// those values.
     pub header: bool,
+    /// The stages a `version 2` header names and the step count it records, or `None` for a lowered or
+    /// headerless file. The pane says both, because a reduced file's tapes mean nothing read as lowered ones.
+    pub reduction: Option<ReductionStatus>,
+}
+
+/// A reduced file's stages, by `StageKind::name`, and the steps its header records.
+#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
+#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
+pub struct ReductionStatus {
+    pub stages: Vec<String>,
+    /// `number`, not `bigint`, for the reason `TmStatus::total_steps` records.
+    #[cfg_attr(feature = "ts", ts(type = "number"))]
+    pub steps: u64,
 }
 
 /// A Turing machine typed straight into a pane: the projected program, the cursor walking it, and the
@@ -1197,7 +1211,8 @@ pub struct TmScratchStatus {
 /// `self.kind`; decoding is type-directed and TM text carries a `result` type only inside a header,
 /// which may be absent, and there is no compile-time run to have recorded final tapes from. Decision
 /// 2: the method does not exist rather than existing and declining. `tests/browser.rs` pins that at
-/// compile time.
+/// compile time. A headered file's value is read instead by `TmValueRun`, which `tm_scratch` builds beside
+/// the scratch, and only for a file with a header.
 ///
 /// **NO `SourceMap`, WHICH IS WHY T1 HAPPENED.** `tm_state` is the method a TM pane renders from every
 /// frame, and it needed a map. `TmState::window` now takes `Option<&SourceMap>` and this passes `None`,
@@ -1231,7 +1246,7 @@ pub struct TmScratch {
 /// `TM_DEFAULT_CAPS`, THE SAME BUDGET `compile` USES. `compile_with_caps` hands `build_tm_leg` the caps
 /// the described run already spent, so its cursor and its reported outcome agree; a scratch has no
 /// described run to agree with, so it takes the product default the boundary exposes no way to change.
-pub fn tm_scratch(src: &str) -> Scratched<TmScratch> {
+pub fn tm_scratch(src: &str) -> TmScratched {
     tm_scratch_with_caps(src, tm::TM_DEFAULT_CAPS)
 }
 
@@ -1243,10 +1258,17 @@ pub fn tm_scratch(src: &str) -> Scratched<TmScratch> {
 /// only reachable by actually simulating five million steps. A test that cannot afford that is a test
 /// that never runs. With a budget of three the same states are reached in microseconds, by the same
 /// code, from the same text.
-fn tm_scratch_with_caps(src: &str, caps: tm::TmCaps) -> Scratched<TmScratch> {
+fn tm_scratch_with_caps(src: &str, caps: tm::TmCaps) -> TmScratched {
     let doc = tm::parse_tm_full(src);
     let header = doc.header;
-    let scratch = doc.machine.map(|m| {
+    let Some(m) = doc.machine else {
+        return TmScratched { diagnostics: doc.diagnostics, scratch: None, value: None };
+    };
+    let m = Rc::new(m);
+    // THE VALUE RUN SHARES THIS `Rc`, SO A MACHINE IS HELD ONCE HOWEVER MANY CURSORS WALK IT. A reduced file can
+    // run to a million rules, and cloning one for a second cursor would double the largest thing a scratch holds.
+    let value = header.clone().map(|h| TmValueRun::new(Rc::clone(&m), h));
+    let scratch = {
         let (program, cursor) = match &header {
             // The IDENTICAL function `compile` builds its leg with, not a copy of it — which is what
             // makes "a headered scratch matches the `Session` path" a property of one code path rather
@@ -1261,8 +1283,8 @@ fn tm_scratch_with_caps(src: &str, caps: tm::TmCaps) -> Scratched<TmScratch> {
             None => tm_leg_at(m, tm::MIN_FIELD_WIDTH, &[], caps),
         };
         TmScratch { program, cursor, header }
-    });
-    Scratched { diagnostics: doc.diagnostics, scratch }
+    };
+    TmScratched { diagnostics: doc.diagnostics, scratch: Some(scratch), value }
 }
 
 impl TmScratch {
@@ -1282,6 +1304,29 @@ impl TmScratch {
             width: self.program.width,
             run,
             header: self.header.is_some(),
+            reduction: self.header.as_ref().and_then(|h| h.reduction.as_ref()).map(|r| ReductionStatus {
+                stages: r.stages.iter().map(|s| s.kind().name().to_owned()).collect(),
+                steps: r.steps,
+            }),
+        }
+    }
+
+    /// What the pane labels each tape: the lowered bank names, or one label for the tape a single-tape stage
+    /// interleaved them onto.
+    ///
+    /// **ONLY THE SINGLE-TAPE STAGE CHANGES WHAT A TAPE IS.** The fold lays each tape out zig-zag and the
+    /// two-symbol stage spells each cell in bits, but tape `i` is still lowered tape `i` after either, so the bank
+    /// names stay true. A headerless file names no stages and keeps them too, as it always has.
+    pub fn tape_names(&self) -> Vec<String> {
+        let interleaved = self.header.as_ref().and_then(|h| h.reduction.as_ref()).and_then(|r| {
+            r.stages.iter().find_map(|s| match s {
+                tm::Stage::SingleTape { k } => Some(*k),
+                tm::Stage::Fold | tm::Stage::TwoSymbol { .. } => None,
+            })
+        });
+        match interleaved {
+            Some(k) => vec![format!("{k} tapes, interleaved")],
+            None => tm::TAPE_NAMES.iter().map(|&n| n.to_owned()).collect(),
         }
     }
 
@@ -1327,6 +1372,97 @@ impl TmScratch {
     }
 }
 
+/// `tm_scratch`'s answer: the diagnostics, the scratch, and the run that reads the scratch's value.
+///
+/// **NOT `Scratched<TmScratch>`, WHICH `lambda_scratch` SHARES.** A λ scratch has no value run to carry, so
+/// widening the shared type would put a field on it that is `None` by construction.
+pub struct TmScratched {
+    pub diagnostics: Vec<Diagnostic>,
+    pub scratch: Option<TmScratch>,
+    /// `Some` exactly when `scratch` is and the text carried a header. See `TmValueRun`.
+    pub value: Option<TmValueRun>,
+}
+
+/// How far a `TmValueRun` has got.
+#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
+#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
+pub struct ValueRun {
+    /// `Running` while `run` may advance it, `Ended` once it halted, `Capped` once it spent `cap`. Never
+    /// `DepthRefused`, which is λ's alone.
+    pub run: RunStatus,
+    /// `number`, not `bigint`, for the reason `TmStatus::total_steps` records.
+    #[cfg_attr(feature = "ts", ts(type = "number"))]
+    pub steps: u64,
+    /// The steps this run may take: the header's recorded count for a reduced file, `TM_DEFAULT_CAPS`' otherwise.
+    #[cfg_attr(feature = "ts", ts(type = "number"))]
+    pub cap: u64,
+}
+
+/// The run that reads a headered scratch's value: a second cursor over the scratch's machine, which renders no
+/// frame and which nothing but `run` advances.
+///
+/// **A TYPE OF ITS OWN, AND DECISION 2 IS WHY.** A method that needs a result type does not exist on a scratch
+/// rather than existing and declining, and a headerless file has no result type. So the value lives on a handle
+/// `tm_scratch` builds only for a file that has one, and `TmScratch` still has no `tm_value`.
+///
+/// **NO RAISE.** A reduced file's recorded step count is its contract, and `raise_tm_cap` belongs to the scratch,
+/// whose cursor this is not.
+pub struct TmValueRun {
+    cursor: TmCursor<Rc<Machine>>,
+    header: tm::TmHeader,
+}
+
+impl TmValueRun {
+    fn new(machine: Rc<Machine>, header: tm::TmHeader) -> TmValueRun {
+        let init = header.init(machine.tapes);
+        let cursor = TmCursor::new(machine, &init, tm::run_caps(&header));
+        TmValueRun { cursor, header }
+    }
+
+    /// Advance up to `budget` steps, then say where the run stands.
+    pub fn run(&mut self, budget: u64) -> ValueRun {
+        for _ in 0..budget {
+            if self.cursor.next().is_none() {
+                break;
+            }
+        }
+        let run = match self.cursor.status() {
+            None => RunStatus::Running,
+            Some(tm::TmStatus::Halted) => RunStatus::Ended,
+            Some(tm::TmStatus::HitCap) => RunStatus::Capped,
+        };
+        ValueRun { run, steps: self.cursor.steps_taken(), cap: tm::run_caps(&self.header).steps }
+    }
+
+    /// The value, once the run has finished: `value_of_run`'s answer, worded for a pane.
+    ///
+    /// **`DecodeFailure::BudgetExhausted` IS A `Fault`, NOT `Undecodable`,** because it is this tool's limit on a
+    /// file that may be perfectly good, the distinction `redextape run` draws with exit 2 against exit 1.
+    pub fn value(&self) -> Decoded {
+        let Some(status) = self.cursor.status() else { return Decoded::Unfinished };
+        let machine = self.cursor.machine();
+        match tm::value_of_run(machine, &self.header, self.cursor.tapes(), self.cursor.state(), status) {
+            Ok(v) => decoded_value(&v),
+            Err(tm::RunFailure::HitCap) => {
+                let cap = tm::run_caps(&self.header);
+                let message = match &self.header.reduction {
+                    Some(r) => format!("did not halt within the {} steps its header records", r.steps),
+                    None => format!("did not halt within {} steps or {} tape cells", cap.steps, cap.cells),
+                };
+                Decoded::Fault { message }
+            }
+            Err(tm::RunFailure::NotAccept(s)) => {
+                let name = machine.states.get(s as usize).map_or("?", |st| st.name.as_str());
+                Decoded::Fault { message: format!("halted in `{name}`, which is not an accept state") }
+            }
+            Err(tm::RunFailure::Decode(tm::DecodeFailure::Mismatch)) => Decoded::Undecodable,
+            Err(tm::RunFailure::Decode(tm::DecodeFailure::BudgetExhausted)) => Decoded::Fault {
+                message: "ran out of decode budget; the value may be fine, and this is the tool's limit".to_owned(),
+            },
+        }
+    }
+}
+
 #[cfg(test)]
 mod tests {
     use super::*;
@@ -2296,12 +2432,13 @@ state halt: accept
     #[test]
     fn the_tm_scratch_status_has_no_field_for_a_total_it_cannot_know() {
         let sc = tm_scratch(HEADERLESS_TM).scratch.expect("parses");
-        let TmScratchStatus { available, reason, width, run, header } = sc.tm_status();
+        let TmScratchStatus { available, reason, width, run, header, reduction } = sc.tm_status();
         assert!(available);
         assert!(reason.is_empty());
         assert_eq!(width, tm::MIN_FIELD_WIDTH);
         assert_eq!(run, RunStatus::Running);
         assert!(!header);
+        assert_eq!(reduction, None);
     }
 
     /// Text that does not parse to a machine is diagnostics and a `None` scratch — and a MISSING HEADER
@@ -2319,6 +2456,182 @@ state halt: accept
         assert!(garbage.scratch.is_none());
     }
 
+    // --- the value run ----------------------------------------------------------------------------
+
+    /// `src` lowered, run, reduced through `stages` and printed: the text `redextape emit --reduce` writes,
+    /// built here through the same core calls so no checked-in file can go stale under this test.
+    fn reduced_text(src: &str, stages: &[tm::StageKind]) -> String {
+        let (program, ds) = parser::parse(src);
+        assert!(ds.is_empty(), "{ds:?}");
+        let program = program.expect("the fixture parses");
+        let ty = typeck::result_type(&program).expect("the fixture types");
+        let kind = EncodingKind::Unary;
+        let enc = kind.at(tm::MIN_FIELD_WIDTH);
+        let (core, _map) = SourceMap::build_from_program(&program, &*enc);
+        let described =
+            tm::run_tm_described(&core, kind, ty, tm::TM_DEFAULT_CAPS).expect("the fixture lowers and runs");
+        let (machine, header) = tm::reduce(&described, stages).expect("the fixture reduces");
+        tm::print_tm_with(&machine, &header)
+    }
+
+    /// The steps a reduced text's header records.
+    fn recorded_steps(text: &str) -> u64 {
+        tm::parse_tm_full(text).header.and_then(|h| h.reduction).expect("a reduced text").steps
+    }
+
+    /// Run `value` out in one call and answer its end.
+    fn run_out(value: &mut TmValueRun) -> (ValueRun, Decoded) {
+        (value.run(u64::MAX), value.value())
+    }
+
+    /// `5 - 3` is 2 and not 0, so a decode that read the reduced tapes as lowered ones cannot pass by
+    /// coincidence — #95's first sabotage row stayed green on a program whose value was 0.
+    #[test]
+    fn every_stage_reads_the_programs_value() {
+        for stage in tm::StageKind::ALL {
+            let text = reduced_text("5 - 3", &[stage]);
+            let mut value = tm_scratch(&text).value.expect("a reduced file has a header");
+            let (end, got) = run_out(&mut value);
+            assert_eq!(end.run, RunStatus::Ended, "{stage:?}");
+            assert_eq!(end.steps, recorded_steps(&text), "{stage:?}: it ran exactly the steps its header records");
+            assert_eq!(got, Decoded::Value { text: "2".into() }, "{stage:?}");
+        }
+    }
+
+    /// Decision 2 at construction: no header, no result type, no value run — and still a scratch.
+    #[test]
+    fn a_headerless_file_builds_a_scratch_and_no_value_run() {
+        let made = tm_scratch(HEADERLESS_TM);
+        assert!(made.scratch.is_some());
+        assert!(made.value.is_none());
+    }
+
+    /// A lowered file's value run agrees with the value `Session` decodes from its compile-time run.
+    #[test]
+    fn a_lowered_files_value_run_agrees_with_the_session() {
+        let src = "let x = 40; x + 2";
+        let s = Session::compile(src, EncodingKind::Unary).session.expect("compiles");
+        let text = s.tm_text().expect("an available TM leg has text");
+        let mut value = tm_scratch(&text).value.expect("an emitted file has a header");
+        let (end, got) = run_out(&mut value);
+        assert_eq!(end.run, RunStatus::Ended);
+        assert_eq!(end.cap, tm::TM_DEFAULT_CAPS.steps, "a lowered file runs under the defaults");
+        assert_eq!(got, s.tm_value().expect("TM available"));
+        assert_eq!(got, Decoded::Value { text: "42".into() });
+    }
+
+    /// The recorded count is exact: at it the run accepts, and one fewer is the file's fault.
+    #[test]
+    fn a_reduced_run_is_held_to_exactly_its_recorded_steps() {
+        let text = reduced_text("5 - 3", &[tm::StageKind::Fold]);
+        let n = recorded_steps(&text);
+        let short = text.replace(&format!("steps {n}\n"), &format!("steps {}\n", n - 1));
+        assert_ne!(short, text, "the fixture must carry a `steps` line to shorten");
+
+        let (end, got) = run_out(&mut tm_scratch(&text).value.expect("header"));
+        assert_eq!((end.run, got), (RunStatus::Ended, Decoded::Value { text: "2".into() }));
+
+        let (end, got) = run_out(&mut tm_scratch(&short).value.expect("header"));
+        assert_eq!(end.run, RunStatus::Capped);
+        assert_eq!(end.cap, n - 1);
+        assert_eq!(
+            got,
+            Decoded::Fault { message: format!("did not halt within the {} steps its header records", n - 1) }
+        );
+    }
+
+    /// The same hand-written stuck machine `redextape run`'s own test refuses.
+    #[test]
+    fn a_reduced_run_that_stops_outside_an_accept_state_is_a_fault() {
+        let text = "tapes 1\nstart stuck\nversion 2\nencoding unary\nwidth 4\nslots 0\nresult Nat\n\
+                    reduced single-tape 5\nsteps 1\n\nstate stuck:\n";
+        let (_end, got) = run_out(&mut tm_scratch(text).value.expect("header"));
+        assert_eq!(got, Decoded::Fault { message: "halted in `stuck`, which is not an accept state".into() });
+    }
+
+    /// Tapes that do not hold the header's result type are `Undecodable`, the same answer `Session` gives.
+    #[test]
+    fn tapes_that_do_not_hold_the_result_type_are_undecodable() {
+        let text = reduced_text("5 - 3", &[tm::StageKind::Fold]).replace("result Nat\n", "result List<Nat>\n");
+        let (end, got) = run_out(&mut tm_scratch(&text).value.expect("header"));
+        assert_eq!(end.run, RunStatus::Ended);
+        assert_eq!(got, Decoded::Undecodable);
+    }
+
+    #[test]
+    fn a_value_run_is_unfinished_until_it_ends() {
+        let text = reduced_text("5 - 3", &[tm::StageKind::Fold]);
+        let mut value = tm_scratch(&text).value.expect("header");
+        assert_eq!(value.value(), Decoded::Unfinished);
+        assert_eq!(value.run(1).run, RunStatus::Running);
+        assert_eq!(value.value(), Decoded::Unfinished);
+    }
+
+    /// How the worker slices the run does not change where it ends or what it reads.
+    #[test]
+    fn the_value_run_answers_the_same_in_any_chunking() {
+        let text = reduced_text("5 - 3", &[tm::StageKind::SingleTape]);
+        let mut answers = Vec::new();
+        for budget in [1, 7, 1_000, u64::MAX] {
+            let mut value = tm_scratch(&text).value.expect("header");
+            let mut end = value.run(budget);
+            while end.run == RunStatus::Running {
+                end = value.run(budget);
+            }
+            answers.push((budget, end.steps, value.value()));
+        }
+        let want = (recorded_steps(&text), Decoded::Value { text: "2".into() });
+        for (budget, steps, got) in answers {
+            assert_eq!((steps, got), want.clone(), "in chunks of {budget}");
+        }
+    }
+
+    /// The value run is a second cursor: running it out moves nothing the pane is watching.
+    #[test]
+    fn running_the_value_run_out_leaves_the_scratch_at_step_zero() {
+        let text = reduced_text("5 - 3", &[tm::StageKind::Fold]);
+        let made = tm_scratch(&text);
+        let (sc, mut value) = (made.scratch.expect("parses"), made.value.expect("header"));
+        let before = sc.tm_state(3);
+        let (end, _) = run_out(&mut value);
+        assert_eq!(end.run, RunStatus::Ended);
+        assert_eq!(sc.tm_state(3), before);
+        assert_eq!(sc.tm_state(3).step, 0);
+    }
+
+    #[test]
+    fn a_reduced_scratch_reports_its_stages_and_recorded_steps() {
+        let stages = [tm::StageKind::Fold, tm::StageKind::TwoSymbol];
+        let text = reduced_text("5 - 3", &stages);
+        let sc = tm_scratch(&text).scratch.expect("parses");
+        assert_eq!(
+            sc.tm_status().reduction,
+            Some(ReductionStatus { stages: vec!["fold".into(), "two-symbol".into()], steps: recorded_steps(&text) })
+        );
+        let lowered =
+            Session::compile("5 - 3", EncodingKind::Unary).session.expect("compiles").tm_text().expect("text");
+        assert_eq!(tm_scratch(&lowered).scratch.expect("parses").tm_status().reduction, None);
+    }
+
+    /// Only a single-tape stage changes what a tape is; the bank names stay true through the fold and the bits.
+    #[test]
+    fn only_a_single_tape_stage_relabels_the_tapes() {
+        let banks: Vec<String> = tm::TAPE_NAMES.iter().map(|&n| n.to_owned()).collect();
+        let names =
+            |stages: &[tm::StageKind]| tm_scratch(&reduced_text("5 - 3", stages)).scratch.expect("parses").tape_names();
+        assert_eq!(names(&[tm::StageKind::Fold, tm::StageKind::TwoSymbol]), banks);
+        assert_eq!(names(&[tm::StageKind::SingleTape]), vec!["5 tapes, interleaved".to_owned()]);
+        assert_eq!(
+            names(&[tm::StageKind::Fold, tm::StageKind::SingleTape, tm::StageKind::TwoSymbol]),
+            vec!["5 tapes, interleaved".to_owned()]
+        );
+        assert_eq!(
+            tm_scratch(HEADERLESS_TM).scratch.expect("parses").tape_names(),
+            banks,
+            "a headerless file names no stages"
+        );
+    }
+
     /// `tapeSlice` speaks the same coordinates `tmState` reports, and names an absent tape rather than
     /// indexing out of bounds — the one error a scratch CAN produce, which is why it is the one method
     /// here that keeps a `Result`.
diff --git a/crates/redextape-wasm/tests/ts_bindings.rs b/crates/redextape-wasm/tests/ts_bindings.rs
index 246cbfa..52fe898 100644
--- a/crates/redextape-wasm/tests/ts_bindings.rs
+++ b/crates/redextape-wasm/tests/ts_bindings.rs
@@ -24,12 +24,12 @@ use std::path::Path;
 use redextape_test_support::ts_derive_scan::{
     assert_overrides_match_field_nullability, ts_deriving_type_names_in_crate, without_doc_comments,
 };
-use redextape_wasm::{Decoded, LambdaStatus, RunStatus, TmScratchStatus, TmStatus};
+use redextape_wasm::{Decoded, LambdaStatus, ReductionStatus, RunStatus, TmScratchStatus, TmStatus, ValueRun};
 use ts_rs::TS;
 
 /// Every type in this crate carrying `#[ts(export)]`, paired with the file it generates.
 ///
-/// **FIVE, AND `redextape-core`'s TWELVE ARE NOT AMONG THEM.** Each crate's gate covers its own
+/// **SEVEN, AND `redextape-core`'s TWELVE ARE NOT AMONG THEM.** Each crate's gate covers its own
 /// derive sites, because `ts_deriving_type_names_in_crate` scans one crate root and a type declared
 /// in the other one is invisible to it from here. That is the correct division: a core type added
 /// without an entry in core's `generated()` fails core's gate, not this one.
@@ -37,9 +37,11 @@ fn generated() -> Vec<(&'static str, String)> {
     vec![
         ("Decoded", Decoded::export_to_string().unwrap()),
         ("LambdaStatus", LambdaStatus::export_to_string().unwrap()),
+        ("ReductionStatus", ReductionStatus::export_to_string().unwrap()),
         ("RunStatus", RunStatus::export_to_string().unwrap()),
         ("TmScratchStatus", TmScratchStatus::export_to_string().unwrap()),
         ("TmStatus", TmStatus::export_to_string().unwrap()),
+        ("ValueRun", ValueRun::export_to_string().unwrap()),
     ]
 }
 
diff --git a/web/tests/browser/tm-pane-editor.test.ts b/web/tests/browser/tm-pane-editor.test.ts
index 49e54af..732a577 100644
--- a/web/tests/browser/tm-pane-editor.test.ts
+++ b/web/tests/browser/tm-pane-editor.test.ts
@@ -142,7 +142,7 @@ describe('the TM pane editor region', () => {
 
     // 1. Immediately after a headerless scratch's `tm-scratch-compiled` reply, before any frame exists —
     // `render(null, …)` is what a real page draws in this gap, and the sentence must survive it.
-    pane.setScratchStatus({ available: true, reason: '', width: 4, run: 'Running', header: false })
+    pane.setScratchStatus({ available: true, reason: '', width: 4, run: 'Running', header: false, reduction: null })
     pane.render(null, CONTROLS)
     expect(host.textContent).toMatch(/no header/i)
     expect(host.textContent).toMatch(/blank tapes/i)
@@ -157,14 +157,14 @@ describe('the TM pane editor region', () => {
     expect(host.textContent).toContain(`width ${PROGRAM.width}`)
 
     // 3. A later reply that fixes the header must clear the sentence, and the per-frame line survives.
-    pane.setScratchStatus({ available: true, reason: '', width: 64, run: 'Running', header: true })
+    pane.setScratchStatus({ available: true, reason: '', width: 64, run: 'Running', header: true, reduction: null })
     pane.render(FRAME, CONTROLS)
     expect(host.textContent).not.toMatch(/no header/i)
     expect(host.textContent).toContain(PROGRAM.states[0]?.name)
 
     // 4. A pane that gives its editor up must stop narrating a scratch it no longer shows — the same
     // fabricated-state defect `LambdaPane.setDetached`'s own doc records, pointed the other way.
-    pane.setScratchStatus({ available: true, reason: '', width: 4, run: 'Running', header: false })
+    pane.setScratchStatus({ available: true, reason: '', width: 4, run: 'Running', header: false, reduction: null })
     pane.setEditor(null)
     pane.render(FRAME, CONTROLS)
     expect(host.textContent).not.toMatch(/no header/i)
````
<!-- END task2.patch -->

- [ ] **Step 3: Format, lint, and typecheck the web tree against the new bindings**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo clippy -p redextape-wasm --all-targets --all-features -- -D warnings 2>&1 | grep -E "^(warning|error)"; echo "clippy done"
cd "$P/web" && CARGO_TARGET_DIR="$P/target" pnpm run typecheck 2>&1 | grep -E "error TS"; echo "typecheck done"
```

Expected: `fmt exit 0`; `clippy done` and `typecheck done`, each with no line before it.

- [ ] **Step 4: Run the wasm crate's native suite**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-wasm --all-features 2>&1 | grep -E "FAIL|Summary"
```

Expected summary line: `Summary 91 tests run: 91 passed, 0 skipped`

- [ ] **Step 5: Commit**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -q -F - <<'EOF'
A TM scratch builds a value run beside it, and names its tapes per file

tmScratch now answers { diagnostics, scratch, value }. value is a
TmValueRun, present exactly when the text parsed and carries a header:
a second cursor over the scratch's machine, sharing its Rc, at
run_caps. run(budget) advances it and reports a ValueRun; value()
answers Unfinished until it ends, then value_of_run's answer as a
Decoded. It has no raise, and TmScratch still has no tmValue, so
decision 2 and both of its pins in tests/browser.rs stand.

TmScratchStatus gains reduction, the stage names and recorded steps of
a version 2 header, and TmScratch gains tapeNames: the bank names, or
one "k tapes, interleaved" label under a single-tape stage. Three
TmScratchStatus literals in tm-pane-editor.test.ts gain reduction: null
in the same commit, which a crates-only commit's hooks would not check.
EOF
git -C "$P" log --oneline -1 && git -C "$P" status --short
```

Expected: every hook the commit prints reads `Passed` or `Skipped`, then a line ending `A TM scratch builds a value run beside it, and names its tapes per file`, and no `git status` line.

- [ ] **Step 6: Sabotages**

Rows T2-S1 to T2-S7 run the native suite. T2-S8 needs the wasm browser tier, whose compile is what fails. Run the whole block as one Bash tool call, with a timeout of 1800000 ms.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
block_of sab.py >| "$S/sab.py"
fast() { cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run --no-fail-fast -p redextape-wasm --all-features 2>&1 | grep -E "^\s+FAIL \[|Summary"; }
restore() { git -C "$P" checkout -- crates/ && git -C "$P" status --short -- crates/; }
W="$P/crates/redextape-wasm/src/session.rs"
L="$P/crates/redextape-wasm/src/lib.rs"

echo "T2-S1: the value run decodes the tapes as lowered ones"
python3 "$S/sab.py" "$W" '        match tm::value_of_run(machine, &self.header, self.cursor.tapes(), self.cursor.state(), status) {' '        let mut lowered = self.header.clone();
        lowered.reduction = None;
        match tm::value_of_run(machine, &lowered, self.cursor.tapes(), self.cursor.state(), status) {' && fast; restore

echo "T2-S2: a single-tape stage keeps the bank names"
python3 "$S/sab.py" "$W" '            Some(k) => vec![format!("{k} tapes, interleaved")],' '            Some(_) => tm::TAPE_NAMES.iter().map(|&n| n.to_owned()).collect(),' && fast; restore

echo "T2-S3: the value run is built under the default caps"
python3 "$S/sab.py" "$W" '        let cursor = TmCursor::new(machine, &init, tm::run_caps(&header));' '        let cursor = TmCursor::new(machine, &init, tm::TM_DEFAULT_CAPS);' && fast; restore

echo "T2-S4: an unfinished run is decoded as if it had halted"
python3 "$S/sab.py" "$W" '        let Some(status) = self.cursor.status() else { return Decoded::Unfinished };' '        let status = self.cursor.status().unwrap_or(tm::TmStatus::Halted);' && fast; restore

echo "T2-S5: ValueRun reports the default cap"
python3 "$S/sab.py" "$W" '        ValueRun { run, steps: self.cursor.steps_taken(), cap: tm::run_caps(&self.header).steps }' '        ValueRun { run, steps: self.cursor.steps_taken(), cap: tm::TM_DEFAULT_CAPS.steps }' && fast; restore

echo "T2-S6: a mismatch reads as unfinished"
python3 "$S/sab.py" "$W" '            Err(tm::RunFailure::Decode(tm::DecodeFailure::Mismatch)) => Decoded::Undecodable,' '            Err(tm::RunFailure::Decode(tm::DecodeFailure::Mismatch)) => Decoded::Unfinished,' && fast; restore

echo "T2-S7: the reduction status names no stages"
python3 "$S/sab.py" "$W" '                stages: r.stages.iter().map(|s| s.kind().name().to_owned()).collect(),' '                stages: vec![],' && fast; restore

echo "T2-S8: tmValue is added to TmScratch after all"
python3 "$S/sab.py" "$L" '    #[wasm_bindgen(js_name = tapeNames)]
    pub fn tape_names(&self) -> Result<JsValue, JsValue> {' '    #[wasm_bindgen(js_name = tmValue)]
    #[must_use]
    pub fn tm_value(&self) -> u32 {
        0
    }

    #[wasm_bindgen(js_name = tapeNames)]
    pub fn tape_names(&self) -> Result<JsValue, JsValue> {' && (cd "$P" && PATH="/usr/sbin:$PATH" TREE_SITTER=/home/davey/projects/redextape/.tools/tree-sitter CARGO_TARGET_DIR="$P/target" cap scripts/check-all.sh --browser-only 2>&1 | grep -E "^error(\[|:)|expected .Absent" | head -3); restore
```

Expected, row by row, each followed by the restore printing no `git status` line:

- **T2-S1** (the value run decodes the tapes as lowered ones):
  - red: `redextape-wasm session::tests::a_reduced_run_that_stops_outside_an_accept_state_is_a_fault`
  - red: `redextape-wasm session::tests::a_reduced_run_is_held_to_exactly_its_recorded_steps`
  - red: `redextape-wasm session::tests::every_stage_reads_the_programs_value`
  - red: `redextape-wasm session::tests::the_value_run_answers_the_same_in_any_chunking`
  - `Summary 91 tests run: 87 passed, 4 failed, 0 skipped`
- **T2-S2** (a single-tape stage keeps the bank names):
  - red: `redextape-wasm session::tests::only_a_single_tape_stage_relabels_the_tapes`
  - `Summary 91 tests run: 90 passed, 1 failed, 0 skipped`
- **T2-S3** (the value run is built under the default caps):
  - red: `redextape-wasm session::tests::a_reduced_run_is_held_to_exactly_its_recorded_steps`
  - `Summary 91 tests run: 90 passed, 1 failed, 0 skipped`
- **T2-S4** (an unfinished run is decoded as if it had halted):
  - red: `redextape-wasm session::tests::a_value_run_is_unfinished_until_it_ends`
  - `Summary 91 tests run: 90 passed, 1 failed, 0 skipped`
- **T2-S5** (ValueRun reports the default cap):
  - red: `redextape-wasm session::tests::a_reduced_run_is_held_to_exactly_its_recorded_steps`
  - `Summary 91 tests run: 90 passed, 1 failed, 0 skipped`
- **T2-S6** (a mismatch reads as unfinished):
  - red: `redextape-wasm session::tests::tapes_that_do_not_hold_the_result_type_are_undecodable`
  - `Summary 91 tests run: 90 passed, 1 failed, 0 skipped`
- **T2-S7** (the reduction status names no stages):
  - red: `redextape-wasm session::tests::a_reduced_scratch_reports_its_stages_and_recorded_steps`
  - `Summary 91 tests run: 90 passed, 1 failed, 0 skipped`
- **T2-S8** (tmValue is added to TmScratch after all):
  - `error[E0308]: mismatched types`
  - `|          ^^^^^^^^^^^^ expected `Absent`, found `u32``
  - `error: could not compile `redextape-wasm` (test "browser") due to 1 previous error`

**The spec's S8 is not expressible here.** "`TmValueRun` steps the scratch's own cursor" is not one edit when the value run owns its cursor by type; `running_the_value_run_out_leaves_the_scratch_at_step_zero` pins the property, and T2-S3 takes the spec row's place.

---

### Task 3: `MAX_SCRATCH_TM_BYTES`, refused before the parse

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs` — the constant with its measurements, the check at the top of `tm_scratch_with_caps`, `padded_to` and two tests; `only_a_single_tape_stage_relabels_the_tapes` moves its three-stage case to `fold, single-tape`, since `5 - 3` through all three stages is 11,571,215 bytes

**What changes.** Text longer than `MAX_SCRATCH_TM_BYTES` (6,100,000) gets one diagnostic, `this file is N bytes; a TM buffer builds files up to 6100000 bytes — \`redextape run\` has no such limit`, on a zero-width span at the origin, beside no scratch and no value run, and `parse_tm_full` never runs. *Figures, measured while planning* has the readings.

**Tests:** `a_file_at_the_ceiling_builds_and_one_byte_more_is_refused` pads a tiny headerless machine with a comment line to exactly the ceiling and one byte over; `an_oversized_file_is_refused_before_it_is_parsed` gives text that is both too long and not a machine, and must hear only about its size.

**Interfaces:**
- Produces: `pub const MAX_SCRATCH_TM_BYTES: usize = 6_100_000` in `redextape_wasm::session`.

- [ ] **Step 1: Confirm the starting commit and a clean tree**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD && git -C "$P" diff --cached --quiet && echo clean
```

Expected: a line ending `A TM scratch builds a value run beside it, and names its tapes per file`, then `clean`.

- [ ] **Step 2: Apply the patch**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
block_of task3.patch | git -C "$P" apply --index --check && block_of task3.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat | tail -1
```

Expected: `1 file changed, 69 insertions(+), 4 deletions(-)`
<!-- BEGIN task3.patch -->
````diff
diff --git a/crates/redextape-wasm/src/session.rs b/crates/redextape-wasm/src/session.rs
index cb69e79..8a59660 100644
--- a/crates/redextape-wasm/src/session.rs
+++ b/crates/redextape-wasm/src/session.rs
@@ -1250,6 +1250,25 @@ pub fn tm_scratch(src: &str) -> TmScratched {
     tm_scratch_with_caps(src, tm::TM_DEFAULT_CAPS)
 }
 
+/// The largest `.tm` text, in bytes, a TM scratch builds. Longer text is refused before it is parsed.
+///
+/// **MEASURED, NOT CHOSEN, AGAINST THE 250 MS AN INITIATED GESTURE MAY TAKE** — the budget `MAX_FORK_RULES` in
+/// `web/src/protocol.ts` was measured against. A TM buffer's build pays four costs before its first frame: the
+/// text's structured clone to the worker, this parse, the `tm_program` projection, and that projection's clone
+/// back. They were priced together, in a release build in Chrome, across reduced files from 28,140 to
+/// 37,923,527 bytes, the median of five runs for each file between 3.9 MB and 11 MB. The largest file under
+/// budget was 6,053,591 bytes at 209.7 ms, and the smallest over it 6,617,969 bytes at 251.2 ms. This is the
+/// first round hundred thousand at or above the first. One 4,341,300-byte file measured 12 ms apart on two
+/// runs, so the ceiling is a band, not a line.
+///
+/// **BYTES,** because bytes are the one size known before parsing, and the parse is one of the costs being bounded.
+/// They do not predict the cost alone: of two files near 6 MB, the one reduced through `fold, two-symbol` projects
+/// slower for its size than one reduced through `single-tape` as well.
+///
+/// **THE EDITOR IS NOT BOUNDED BY THIS.** The text is already in the pane's editor on the main thread before a
+/// build is posted, so a refusal here cannot spare that cost. Its mount measured 54.9 ms at 37,923,527 bytes.
+pub const MAX_SCRATCH_TM_BYTES: usize = 6_100_000;
+
 /// `tm_scratch` with the cursor's budget as a parameter rather than a constant.
 ///
 /// PRIVATE, AND EVERY PRODUCT CALLER TAKES THE DEFAULT — the boundary exposes no way to choose, exactly
@@ -1259,6 +1278,19 @@ pub fn tm_scratch(src: &str) -> TmScratched {
 /// that never runs. With a budget of three the same states are reached in microseconds, by the same
 /// code, from the same text.
 fn tm_scratch_with_caps(src: &str, caps: tm::TmCaps) -> TmScratched {
+    // BEFORE THE PARSE, BECAUSE THE PARSE IS ONE OF THE COSTS THE CEILING BOUNDS. A zero-width span at the origin,
+    // as `lambda_scratch_at`'s refusal uses: the diagnostic is about the whole file, not a place in it.
+    if src.len() > MAX_SCRATCH_TM_BYTES {
+        let message = format!(
+            "this file is {} bytes; a TM buffer builds files up to {MAX_SCRATCH_TM_BYTES} bytes — `redextape run` has no such limit",
+            src.len()
+        );
+        return TmScratched {
+            diagnostics: vec![Diagnostic::error(Span { start: 0, end: 0 }, message)],
+            scratch: None,
+            value: None,
+        };
+    }
     let doc = tm::parse_tm_full(src);
     let header = doc.header;
     let Some(m) = doc.machine else {
@@ -2456,6 +2488,42 @@ state halt: accept
         assert!(garbage.scratch.is_none());
     }
 
+    // --- the size ceiling -------------------------------------------------------------------------
+
+    /// `HEADERLESS_TM` padded with one comment line to exactly `bytes` bytes.
+    fn padded_to(bytes: usize) -> String {
+        let text = format!("{HEADERLESS_TM};{}\n", "x".repeat(bytes - HEADERLESS_TM.len() - 2));
+        assert_eq!(text.len(), bytes);
+        text
+    }
+
+    #[test]
+    fn a_file_at_the_ceiling_builds_and_one_byte_more_is_refused() {
+        let at = tm_scratch(&padded_to(MAX_SCRATCH_TM_BYTES));
+        assert!(at.diagnostics.is_empty(), "{:?}", at.diagnostics);
+        assert!(at.scratch.is_some());
+
+        let over = tm_scratch(&padded_to(MAX_SCRATCH_TM_BYTES + 1));
+        assert!(over.scratch.is_none() && over.value.is_none());
+        let messages: Vec<&str> = over.diagnostics.iter().map(|d| d.message.as_str()).collect();
+        assert_eq!(
+            messages,
+            vec![format!(
+                "this file is {} bytes; a TM buffer builds files up to {MAX_SCRATCH_TM_BYTES} bytes — `redextape run` has no such limit",
+                MAX_SCRATCH_TM_BYTES + 1
+            )]
+        );
+    }
+
+    /// Text that is both too long and not a machine hears only about its size: the parse never ran.
+    #[test]
+    fn an_oversized_file_is_refused_before_it_is_parsed() {
+        let text = format!("this is not a machine\n;{}\n", "x".repeat(MAX_SCRATCH_TM_BYTES));
+        let made = tm_scratch(&text);
+        assert_eq!(made.diagnostics.len(), 1, "{:?}", made.diagnostics);
+        assert!(made.diagnostics[0].message.starts_with("this file is "), "{:?}", made.diagnostics);
+    }
+
     // --- the value run ----------------------------------------------------------------------------
 
     /// `src` lowered, run, reduced through `stages` and printed: the text `redextape emit --reduce` writes,
@@ -2621,10 +2689,7 @@ state halt: accept
             |stages: &[tm::StageKind]| tm_scratch(&reduced_text("5 - 3", stages)).scratch.expect("parses").tape_names();
         assert_eq!(names(&[tm::StageKind::Fold, tm::StageKind::TwoSymbol]), banks);
         assert_eq!(names(&[tm::StageKind::SingleTape]), vec!["5 tapes, interleaved".to_owned()]);
-        assert_eq!(
-            names(&[tm::StageKind::Fold, tm::StageKind::SingleTape, tm::StageKind::TwoSymbol]),
-            vec!["5 tapes, interleaved".to_owned()]
-        );
+        assert_eq!(names(&[tm::StageKind::Fold, tm::StageKind::SingleTape]), vec!["5 tapes, interleaved".to_owned()]);
         assert_eq!(
             tm_scratch(HEADERLESS_TM).scratch.expect("parses").tape_names(),
             banks,
````
<!-- END task3.patch -->

- [ ] **Step 3: Format and lint**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo clippy -p redextape-wasm --all-targets --all-features -- -D warnings 2>&1 | grep -E "^(warning|error)"; echo "clippy done"
```

Expected: `fmt exit 0`, and `clippy done` with no line before it.

- [ ] **Step 4: Run the wasm crate's native suite**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-wasm --all-features 2>&1 | grep -E "FAIL|Summary"
```

Expected summary line: `Summary 93 tests run: 93 passed, 0 skipped`

- [ ] **Step 5: Commit**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -q -F - <<'EOF'
Refuse TM scratch text over 6,100,000 bytes before parsing it

MAX_SCRATCH_TM_BYTES bounds the four costs a TM buffer's build pays
before its first frame against the 250 ms MAX_FORK_RULES was measured
against. Priced in a release build in Chrome, the largest reduced file
under budget was 6,053,591 bytes at 209.7 ms and the smallest over it
6,617,969 bytes at 251.2 ms. Longer text gets one diagnostic naming its
size, and is never parsed.
EOF
git -C "$P" log --oneline -1 && git -C "$P" status --short
```

Expected: every hook the commit prints reads `Passed` or `Skipped`, then a line ending `Refuse TM scratch text over 6,100,000 bytes before parsing it`, and no `git status` line.

- [ ] **Step 6: Sabotages**

Run the whole block as one Bash tool call, with a timeout of 1200000 ms.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
block_of sab.py >| "$S/sab.py"
fast() { cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run --no-fail-fast -p redextape-wasm --all-features 2>&1 | grep -E "^\s+FAIL \[|Summary"; }
restore() { git -C "$P" checkout -- crates/ && git -C "$P" status --short -- crates/; }
W="$P/crates/redextape-wasm/src/session.rs"

echo "T3-S1: the size check runs after the parse"
python3 "$S/sab.py" "$W" '    if src.len() > MAX_SCRATCH_TM_BYTES {' '    let early = tm::parse_tm_full(src);
    if !early.diagnostics.is_empty() {
        return TmScratched { diagnostics: early.diagnostics, scratch: None, value: None };
    }
    if src.len() > MAX_SCRATCH_TM_BYTES {' && fast; restore

echo "T3-S2: a file of exactly the ceiling is refused"
python3 "$S/sab.py" "$W" '    if src.len() > MAX_SCRATCH_TM_BYTES {' '    if src.len() >= MAX_SCRATCH_TM_BYTES {' && fast; restore
```

Expected, row by row, each followed by the restore printing no `git status` line:

- **T3-S1** (the size check runs after the parse):
  - red: `redextape-wasm session::tests::an_oversized_file_is_refused_before_it_is_parsed`
  - `Summary 93 tests run: 92 passed, 1 failed, 0 skipped`
- **T3-S2** (a file of exactly the ceiling is refused):
  - red: `redextape-wasm session::tests::a_file_at_the_ceiling_builds_and_one_byte_more_is_refused`
  - `Summary 93 tests run: 92 passed, 1 failed, 0 skipped`

---

### Task 4: The value run reaches the main thread

**Files:**
- Modify: `web/src/protocol.ts` — `VALUE_CHUNK`, the `tm-value` reply, `tapeNames` on `tm-scratch-compiled`, and the `tm-scratch` request's doc
- Modify: `web/src/types.ts` — re-export `ReductionStatus` and `ValueRun`
- Modify: `web/src/session-worker.ts` — `TmValueRunHandle`, the `tm-scratch` arm of `Live`, `dropLive`, `onTmScratch`, `runValueLoop`, and two docs
- Modify: `web/src/sessions.ts` — `TmScratchReading` and `SessionEntry.tmScratch`
- Modify: `web/src/replies.ts` — the scratch arm's tape names and retention, the `tm-value` arm, the `worker-error` clear, and `onScratchReply`'s doc
- Modify: `web/src/main.ts`, `web/src/scratch.ts` — `tmScratch: null` on the two entries they build
- Modify: `web/tests/node/replies.test.ts` — three retention tests
- Modify: `web/tests/browser/binding-selector.test.ts`, `web/tests/browser/editor-custody.test.ts`, `web/tests/browser/scratch-fork.test.ts`, `web/tests/node/scratch.test.ts`, `web/tests/node/sessions.test.ts` — `tmScratch: null` on every `SessionEntry` literal

**What changes.**
1. **The worker** runs a headered buffer's `TmValueRun` out after the first recording, `VALUE_CHUNK` (500,000) steps at a time, posting `tm-value` after each chunk and yielding between. Each chunk opens with `recordTm`'s generation guard, reading `live` rather than a captured handle, so an edit supersedes the loop at its next chunk. `dropLive` frees the value run beside the scratch.
2. **`tm-scratch-compiled`** carries the scratch's own `tapeNames`, where the main thread used the fixed `tapeNames()` export.
3. **`replies.ts`** retains the scratch status on the buffer's entry with the reply that carried it, retains each `tm-value` reading beside it, forgets the reading on a new build, and clears both on a worker error. Pushing to panes is Task 5's.
4. **Three docs this falsifies are amended here:** `onScratchReply`'s arm count, the `tm-scratch` request's reason for carrying no `encoding`, and `onExtend`'s claim that frames are a scratch's whole answer.

**Tests:** `a TM buffer retains what its panes were last told`: the status and the reply's own tape names on the entry with no pane to tell, the latest value reading beside that status, and a new build forgetting it. The worker loop cannot be reached from node; Task 6's browser tests cover it.

**Interfaces:**
- Consumes: Task 2's `tmScratch` `value` field, `TmValueRun.run`/`value`, `TmScratch.tapeNames`, and the generated `ValueRun`, `ReductionStatus`.
- Produces:
  - `export const VALUE_CHUNK = 500_000` (`protocol.ts`)
  - `RunReply`: `{ kind: 'tm-scratch-compiled'; gen: number; tm: TmScratchStatus; tmProgram: TmProgram; tapeNames: string[] }` and `{ kind: 'tm-value'; gen: number; run: ValueRun; value: Decoded }`
  - `export type TmScratchReading = { readonly status: TmScratchStatus; readonly value: { readonly run: ValueRun; readonly value: Decoded } | null }` and `SessionEntry.tmScratch: TmScratchReading | null` (`sessions.ts`)

- [ ] **Step 1: Confirm the starting commit and a clean tree**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD && git -C "$P" diff --cached --quiet && echo clean
```

Expected: a line ending `Refuse TM scratch text over 6,100,000 bytes before parsing it`, then `clean`.

- [ ] **Step 2: Apply the patch**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
block_of task4.patch | git -C "$P" apply --index --check && block_of task4.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat | tail -1
```

Expected: `13 files changed, 229 insertions(+), 33 deletions(-)`
<!-- BEGIN task4.patch -->
````diff
diff --git a/web/src/main.ts b/web/src/main.ts
index afcab2f..825bac2 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -378,6 +378,7 @@ async function main(): Promise<EditorView> {
     // scratch types cannot send (§4.1), so the scratchpad's own entry states the same `null` and keeps
     // it. See `SessionEntry.tmProgram` for what reads this and when.
     tmProgram: null,
+    tmScratch: null,
   })
   /**
    * TRANSPORT, BEFORE EITHER PANE — its `events(...)` is what each pane is constructed with, so it has
diff --git a/web/src/protocol.ts b/web/src/protocol.ts
index f2ed55c..a76ce7b 100644
--- a/web/src/protocol.ts
+++ b/web/src/protocol.ts
@@ -9,6 +9,7 @@ import type {
   TmScratchStatus,
   TmState,
   TmStatus,
+  ValueRun,
 } from './types'
 
 /**
@@ -236,6 +237,15 @@ export const FRAME_OVERHEAD_BYTES = 64
 export const EXTEND_STEPS = 100_000
 export const EXTEND_CELLS = 100_000
 
+/**
+ * Steps a TM buffer's value run takes between yields, so an edit waits at most one chunk to supersede it.
+ *
+ * **MEASURED, NOT CHOSEN.** In a release build in Chrome the value run stepped 63.7 to 71.9 million steps a second
+ * across twelve reduced files whose recorded runs took 1,242,325 to 185,898,088 steps, and 500,000 steps took 7.7 ms
+ * at the median. One more doubling measured 15.3 ms, past the 10 ms the design allows a chunk.
+ */
+export const VALUE_CHUNK = 500_000
+
 export type Leg = 'lambda' | 'tm'
 
 /**
@@ -349,9 +359,11 @@ export type RunRequest =
    * machine, and the scratch starts from its header's initial configuration. A `step` here would be a
    * field with no reader on either side.
    *
-   * **NO `encoding`, FOR `lambda-scratch`'s OWN REASON.** An encoding says how a VALUE is decoded,
-   * decoding is type-directed, and a `TmScratch` has no `ty` — `tmValue`, `sourceSpan` and `linkIndex`
-   * are absent from the type rather than declining.
+   * **NO `encoding`, AND NOT FOR `lambda-scratch`'s REASON ANY MORE.** A headered TM buffer's value IS
+   * decoded, by the `TmValueRun` `tmScratch` builds beside the scratch, but under the encoding its own
+   * header names, so a request field would be a second answer to a question the text already settles.
+   * The scratch itself still has no `ty`: `tmValue`, `sourceSpan` and `linkIndex` are absent from it
+   * rather than declining.
    *
    * **THIS IS THE VARIANT `lambda-scratch`'s DOC NOW POINTS AT.** §4.1's `TmScratch` exists at the
    * boundary (plan T3, `tmScratch(src)` is exported and typed); this is the request that finally gives
@@ -435,7 +447,16 @@ export type RunReply =
    * the main thread has never seen it. Here the main thread SENT the text, so echoing it would return
    * up to `MAX_FORK_RULES` rules of string to the sender that already holds it.
    */
-  | { kind: 'tm-scratch-compiled'; gen: number; tm: TmScratchStatus; tmProgram: TmProgram }
+  | { kind: 'tm-scratch-compiled'; gen: number; tm: TmScratchStatus; tmProgram: TmProgram; tapeNames: string[] }
+  /**
+   * How far a TM buffer's value run has got, and its value once it has finished — posted after every chunk.
+   *
+   * **ONLY FOR A FILE WITH A HEADER.** `tmScratch` builds a value run for no other, because decoding needs the
+   * header's `result` type, and a buffer with no header never hears this reply.
+   *
+   * `value` IS `Unfinished` WHILE `run.run` IS `Running`, so a consumer can render either field alone.
+   */
+  | { kind: 'tm-value'; gen: number; run: ValueRun; value: Decoded }
   /**
    * A session exists. Sent BEFORE any recording, so the panes can mount and show their declines
    * while the legs are still being stepped.
diff --git a/web/src/replies.ts b/web/src/replies.ts
index 28e7d38..f387748 100644
--- a/web/src/replies.ts
+++ b/web/src/replies.ts
@@ -1,5 +1,4 @@
 import type { EditorView } from '@codemirror/view'
-import { tapeNames } from '../../pkg/redextape_wasm.js'
 import { showWorkerError } from './banner'
 import type { EditablePane } from './editor-custody'
 import { setDecline, setLink } from './highlight'
@@ -309,12 +308,12 @@ export function createReplies(deps: {
    * `view`, none of which a detached session has any claim on (§3.3: no `linkIndex`, no `sourceSpan`,
    * no `ty`).
    *
-   * SIX ARMS AND NO `default`, WHERE THIS DOC USED TO SAY FOUR — 5d-iv Task 9 is the task that closes
-   * the gap the paragraph below used to record as open. `session-worker.ts` answers a `lambda-scratch`
-   * request with exactly `scratch-compiled`, `lambda-frames`, `no-session` or `worker-error`, and a
-   * `tm-scratch` request with `tm-scratch-compiled`, `tm-frames`, `no-session` or `worker-error` — the
-   * same four-shape answer per leg (`onTmScratch`, `session-worker.ts`'s TM counterpart to
-   * `onLambdaScratch`), and `compiled`/`result` still need a `SourceMap`/`ty` no buffer has, on either
+   * SEVEN ARMS AND NO `default`. `session-worker.ts` answers a `lambda-scratch` request with exactly
+   * `scratch-compiled`, `lambda-frames`, `no-session` or `worker-error`, and a `tm-scratch` request with
+   * `tm-scratch-compiled`, `tm-frames`, `tm-value`, `no-session` or `worker-error` (`onTmScratch`,
+   * `session-worker.ts`'s TM counterpart to `onLambdaScratch`). `tm-value` is the TM leg's one extra
+   * shape: a headered TM buffer's value run reports through it, where a compiled session's value
+   * arrives in `result`. `compiled`/`result` still need a `SourceMap`/`ty` no buffer has, on either
    * leg. `no-session` and `worker-error` are genuinely shared, one arm apiece for both legs — a buffer's
    * failure to build or its worker's death read the same whichever leg minted it. `lambda-frames` and
    * `tm-frames` are not shareable in the same way (`hist.push` closes over a different `LegState`), so
@@ -425,12 +424,11 @@ export function createReplies(deps: {
         // which is false for a scratch that was never offered a fork control in the first place.
         // `setScratchStatus` rides the SAME pass as `then` (Minor fix, fix round on Task 9) rather than
         // a second loop over `panes.ofSession('tm', session)` below — `storeAndSetProgram`'s own doc
-        // has the argument. `tapeNames()` IS A FIXED, PROGRAM-INDEPENDENT WASM EXPORT, not a wire field
-        // this reply carries either (`protocol.ts`'s `tm-scratch-compiled` doc: "no text echo" is the
-        // general shape — nothing this reply's own build did not already need is repeated on it) —
-        // `session-worker.ts`'s `onRun` calls the identical export to answer the SAME question for the
-        // `compiled` reply, and it answers identically for every machine.
-        const compiled: TmCompiled = { program: reply.tmProgram, tapeNames: tapeNames() as string[], tmText: null }
+        // has the argument. `tapeNames` RIDES THIS REPLY, PER SCRATCH, where it used to be the fixed
+        // `tapeNames()` export `onRun` still posts: a reduced file's single-tape stage leaves one tape that
+        // the lowered bank names would mislabel, and only the scratch knows its own stage list.
+        const compiled: TmCompiled = { program: reply.tmProgram, tapeNames: reply.tapeNames, tmText: null }
+        sessions.entryOf(session).tmScratch = { status: reply.tm, value: null }
         storeAndSetProgram(session, compiled, (pane) => pane.setScratchStatus(reply.tm))
         // THE EDITOR IS SEEDED FROM THE BUFFER'S OWN TEXT OF RECORD, NOT FROM THIS REPLY — there is
         // none to seed from (`tm-scratch-compiled` carries no `text`, unlike `scratch-compiled`).
@@ -457,6 +455,15 @@ export function createReplies(deps: {
         draw()
         return
       }
+      case 'tm-value': {
+        // RETAINED ON THE ENTRY, AS `tm-scratch-compiled` RETAINS THE STATUS, for a TM pane created after this reply.
+        // A reading with no status before it cannot happen: the worker posts this only after `tm-scratch-compiled`
+        // for the same generation, and a stale generation never reaches this switch (`SessionClient`'s filter).
+        const entry = sessions.entryOf(session)
+        if (entry.tmScratch !== null)
+          entry.tmScratch = { ...entry.tmScratch, value: { run: reply.run, value: reply.value } }
+        return
+      }
       case 'lambda-frames': {
         // UNGUARDED FOR THE REASON THE `scratch-compiled` ARM ABOVE STATES: `legOf` throws for a session
         // the registry no longer holds, and a cooled buffer's worker cannot deliver a reply at all
@@ -581,6 +588,7 @@ export function createReplies(deps: {
         // for `onReply`'s reason — stale frames must not survive under a message saying it broke.
         results.dataset.state = 'idle'
         resetLegs(sessions.entryOf(session).legs, null, null, 'the scratchpad failed')
+        sessions.entryOf(session).tmScratch = null
         // `setEditor(null)` TOO — Important finding, whole-branch review before merge, second instance
         // of the same root as the binding-selector one `LambdaPane.setDetached`'s doc now covers. This
         // thread is dead and nothing here retires the scratchpad (only `ScratchBuffers.retire` does
diff --git a/web/src/scratch.ts b/web/src/scratch.ts
index 075b686..c73c2e7 100644
--- a/web/src/scratch.ts
+++ b/web/src/scratch.ts
@@ -846,6 +846,7 @@ export class ScratchBuffers {
       // the two legs today is that neither has one at the moment this entry is created, and for a λ
       // buffer that is permanent.
       tmProgram: null,
+      tmScratch: null,
     })
     state.warm = true
     // SUPERSEDE THEN POST, the pattern `compile.ts`'s `schedule` uses and for the same reason
diff --git a/web/src/session-worker.ts b/web/src/session-worker.ts
index 589a4e4..8b7c490 100644
--- a/web/src/session-worker.ts
+++ b/web/src/session-worker.ts
@@ -46,6 +46,7 @@ import {
   RECORD_CHUNK,
   TM_RADIUS,
   tmFrameBytes,
+  VALUE_CHUNK,
 } from './protocol'
 import type {
   Decoded,
@@ -58,6 +59,7 @@ import type {
   TmScratchStatus,
   TmState,
   TmStatus,
+  ValueRun,
 } from './types'
 
 /**
@@ -127,12 +129,24 @@ type LambdaScratchHandle = {
 type TmScratchHandle = {
   tmStatus(): TmScratchStatus
   tmProgram(): TmProgram
+  tapeNames(): string[]
   stepTm(): boolean
   tmState(radius: number): TmState
   raiseTmCap(extraSteps: number, extraCells: number): void
   free(): void
 }
 
+/**
+ * The wasm-bindgen `TmValueRun`, described structurally for the reason `Session` above is: the run that reads a
+ * headered TM buffer's value, beside the scratch rather than on it, for decision 2's reason (`session.rs`'s
+ * `TmValueRun` doc).
+ */
+type TmValueRunHandle = {
+  run(budget: number): ValueRun
+  value(): Decoded
+  free(): void
+}
+
 type CompileResult = { diagnostics: Diagnostic[]; session: Session | null }
 
 /**
@@ -153,7 +167,7 @@ type ForkedAtResult = { diagnostics: Diagnostic[]; scratch: LambdaScratchHandle
  * NO `text` FIELD, UNLIKE `ForkedAtResult`. `tmScratch` never echoes the source: the main thread SENT
  * `src` and already holds it — see `tm-scratch-compiled`'s doc in `protocol.ts`.
  */
-type TmScratchResult = { diagnostics: Diagnostic[]; scratch: TmScratchHandle | null }
+type TmScratchResult = { diagnostics: Diagnostic[]; scratch: TmScratchHandle | null; value: TmValueRunHandle | null }
 
 /**
  * Exactly what this worker uses of its global scope.
@@ -201,7 +215,7 @@ let latest = 0
 type Live =
   | { gen: number; kind: 'session'; session: Session }
   | { gen: number; kind: 'lambda-scratch'; session: LambdaScratchHandle }
-  | { gen: number; kind: 'tm-scratch'; session: TmScratchHandle }
+  | { gen: number; kind: 'tm-scratch'; session: TmScratchHandle; value: TmValueRunHandle | null }
 
 let live: Live | null = null
 
@@ -221,6 +235,9 @@ const allowance: Record<Leg, number> = { lambda: HISTORY_BYTES, tm: HISTORY_BYTE
  */
 const recording: Record<Leg, boolean> = { lambda: false, tm: false }
 
+/** One value run loop at a time, for `recording`'s reason: a second loop would step the same run twice. */
+let valueRunning = false
+
 function dropLive(): void {
   const held = live
   // NULLED BEFORE FREED, in that order. A suspended loop that wakes between the two must see `null`
@@ -248,6 +265,13 @@ function dropLive(): void {
   } catch {
     /* See the comment above: a session that cannot be freed is already unusable. */
   }
+  // THE VALUE RUN IS A SECOND HANDLE, FREED UNDER THE SAME RULE AND IN ITS OWN `try`, so a scratch that cannot be
+  // freed does not leak the run beside it.
+  try {
+    if (held?.kind === 'tm-scratch') held.value?.free()
+  } catch {
+    /* As above. */
+  }
 }
 
 /**
@@ -642,9 +666,11 @@ async function onLambdaScratch(req: Extract<RunRequest, { kind: 'lambda-scratch'
  * **THE SAME PROLOGUE AS `onRun`/`onLambdaScratch`, AND THAT IS THE INVARIANT RATHER THAN A COPY** —
  * see `onLambdaScratch`'s own doc for the argument; it applies here unchanged.
  *
- * NO `linkIndex`, NO `tapeNames`, NO `result` AFTER IT, for `onLambdaScratch`'s reasons: all three read
- * something a scratch type does not have. It DOES post a `tmProgram`, which is where the two differ —
- * a `TmScratch` has a machine and a `LambdaScratch` has none.
+ * NO `linkIndex` AND NO `result` AFTER IT, for `onLambdaScratch`'s reasons: both read something a scratch type
+ * does not have. It DOES post a `tmProgram`, which is where the two differ — a `TmScratch` has a machine and a
+ * `LambdaScratch` has none — and its own `tapeNames`, per scratch rather than the fixed export `onRun` posts,
+ * because a reduced file's single-tape stage changes what its one tape is. A file with a header then hears
+ * `tm-value` after every chunk of `runValueLoop`, in place of the `result` a compiled session gets.
  *
  * IT DOES NOT `await recordLambda`. A `TmScratch` has one leg; calling it to be told so at its own
  * `kind` guard would be a line asserting the absence rather than respecting it. IT DOES `await
@@ -675,7 +701,7 @@ async function onTmScratch(req: Extract<RunRequest, { kind: 'tm-scratch' }>): Pr
   recording.lambda = false
   recording.tm = false
 
-  const { diagnostics, scratch } = tmScratch(req.src) as TmScratchResult
+  const { diagnostics, scratch, value } = tmScratch(req.src) as TmScratchResult
   if (scratch === null) {
     ctx.postMessage({ kind: 'no-session', gen: req.gen, diagnostics })
     return
@@ -685,17 +711,45 @@ async function onTmScratch(req: Extract<RunRequest, { kind: 'tm-scratch' }>): Pr
   // reasoning `onRun` and `onLambdaScratch` give for the handle each discards on the same race.
   if (latest !== req.gen) {
     scratch.free()
+    value?.free()
     return
   }
-  live = { gen: req.gen, kind: 'tm-scratch', session: scratch }
+  live = { gen: req.gen, kind: 'tm-scratch', session: scratch, value }
 
   ctx.postMessage({
     kind: 'tm-scratch-compiled',
     gen: req.gen,
     tm: scratch.tmStatus(),
     tmProgram: scratch.tmProgram(),
+    tapeNames: scratch.tapeNames(),
   })
   await recordTm(req.gen, true)
+  await runValueLoop(req.gen)
+}
+
+/**
+ * Run a TM buffer's value run out in `VALUE_CHUNK` steps at a time, posting where it stands after each chunk.
+ *
+ * **AFTER THE FIRST RECORDING, NOT BESIDE IT.** Frames are what the pane draws first, and interleaving the two
+ * loops would slow both.
+ *
+ * **EVERY CHUNK STARTS WITH `recordTm`'s LOOP GUARD**, reading `live` rather than a captured handle, so an edit
+ * that replaced the scratch, or freed it, ends this loop at its next chunk rather than stepping a freed run.
+ */
+async function runValueLoop(gen: number): Promise<void> {
+  if (valueRunning) return
+  valueRunning = true
+  try {
+    for (;;) {
+      if (live?.gen !== gen || live.kind !== 'tm-scratch' || live.value === null) return
+      const run = live.value.run(VALUE_CHUNK)
+      ctx.postMessage({ kind: 'tm-value', gen, run, value: live.value.value() })
+      if (run.run !== 'Running') return
+      await yieldToEventLoop()
+    }
+  } finally {
+    valueRunning = false
+  }
 }
 
 async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<void> {
@@ -754,8 +808,9 @@ async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<v
   if (live?.gen !== req.gen) return
   // A SCRATCHPAD GETS NO `result`, AND THAT IS NOT AN OMISSION. `lambdaLeg` reads `lambdaValue` and
   // `tmLeg` reads `tmValue`; §3.3 puts both off the scratch types because decoding is type-directed
-  // and there is no `ty` to decode against. The frames this call just recorded, and their `RecordEnd`,
-  // are the whole answer — see `scratch-compiled`'s doc in `protocol.ts`.
+  // and a scratch has no `ty` to decode against. The frames this call just recorded, and their
+  // `RecordEnd`, are its whole answer; a headered TM buffer's value arrives separately, as the
+  // `tm-value` replies `runValueLoop` posts, which `[continue]` neither starts nor extends.
   if (live.kind !== 'session') return
   ctx.postMessage({ kind: 'result', gen: req.gen, lambda: lambdaLeg(live.session), tm: tmLeg(live.session) })
 }
diff --git a/web/src/sessions.ts b/web/src/sessions.ts
index de06ace..c6dfbaf 100644
--- a/web/src/sessions.ts
+++ b/web/src/sessions.ts
@@ -8,7 +8,16 @@ import type { History } from './history'
 import type { SplitChoices } from './pane-chrome'
 import type { Leg, RecordEnd } from './protocol'
 import type { SessionClient, SessionId } from './session-client'
-import type { LambdaState, LambdaStatus, TmProgram, TmState, TmStatus } from './types'
+import type {
+  Decoded,
+  LambdaState,
+  LambdaStatus,
+  TmProgram,
+  TmScratchStatus,
+  TmState,
+  TmStatus,
+  ValueRun,
+} from './types'
 
 /**
  * One leg's live state on this side of the boundary: its history, how recording ended, and what the
@@ -92,6 +101,15 @@ export type SessionLegs = { [L in Leg]?: LegState<LegFrame[L]> }
  */
 export type TmCompiled = { readonly program: TmProgram; readonly tapeNames: string[]; readonly tmText: string | null }
 
+/**
+ * What a TM buffer's panes were last told about the FILE rather than the machine: its status, and its value run's
+ * latest reading, or `null` before the first `tm-value` reply and for a file with no header.
+ */
+export type TmScratchReading = {
+  readonly status: TmScratchStatus
+  readonly value: { readonly run: ValueRun; readonly value: Decoded } | null
+}
+
 /**
  * One session: what it is called, whether it is inside the source correspondence, the legs it records
  * into, the machine its last compile produced, and the client that talks to its worker.
@@ -165,6 +183,11 @@ export type SessionEntry = {
    * pane is displaying.
    */
   tmProgram: TmCompiled | null
+  /**
+   * A TM buffer's status and value reading, retained for the reason `tmProgram` above is: a TM pane created after
+   * the reply that told the others is seeded from here. `null` for every session that is not a TM buffer.
+   */
+  tmScratch: TmScratchReading | null
 }
 
 /**
diff --git a/web/src/types.ts b/web/src/types.ts
index 12fb956..fa6c75e 100644
--- a/web/src/types.ts
+++ b/web/src/types.ts
@@ -35,6 +35,7 @@ export type { Diagnostic } from '../bindings/Diagnostic'
 export type { LambdaState } from '../bindings/LambdaState'
 export type { LambdaStatus } from '../bindings/LambdaStatus'
 export type { Move } from '../bindings/Move'
+export type { ReductionStatus } from '../bindings/ReductionStatus'
 export type { RuleView } from '../bindings/RuleView'
 export type { RunStatus } from '../bindings/RunStatus'
 export type { Severity } from '../bindings/Severity'
@@ -43,6 +44,7 @@ export type { TmProgram } from '../bindings/TmProgram'
 export type { TmScratchStatus } from '../bindings/TmScratchStatus'
 export type { TmState } from '../bindings/TmState'
 export type { TmStatus } from '../bindings/TmStatus'
+export type { ValueRun } from '../bindings/ValueRun'
 export type { Decoded, Owner, Span, TokenClass }
 
 /**
diff --git a/web/tests/browser/binding-selector.test.ts b/web/tests/browser/binding-selector.test.ts
index 06122c0..31c9a07 100644
--- a/web/tests/browser/binding-selector.test.ts
+++ b/web/tests/browser/binding-selector.test.ts
@@ -53,7 +53,7 @@ function lambdaSession(id: SessionId, label: string, text: string, detached: boo
   const hist = new History<LambdaState>(1_000_000)
   hist.push({ text, spans: [], cut: null, step: 0, redex_span: null, owner: 'None' }, 1)
   const leg: LegState<LambdaState> = { hist, status: { available: true, reason: '' }, done: null, timer: null }
-  return { id, label, detached, client: fakeClient(), legs: { lambda: leg }, tmProgram: null }
+  return { id, label, detached, client: fakeClient(), legs: { lambda: leg }, tmProgram: null, tmScratch: null }
 }
 
 /**
@@ -80,6 +80,7 @@ function bothLegs(id: SessionId, label: string, text: string): SessionEntry {
     // source session and its first `compiled` reply. The panes here are built directly rather than by
     // `pane-host.ts`, so nothing in this file reads it.
     tmProgram: null,
+    tmScratch: null,
   }
 }
 
diff --git a/web/tests/browser/editor-custody.test.ts b/web/tests/browser/editor-custody.test.ts
index a06131c..d402221 100644
--- a/web/tests/browser/editor-custody.test.ts
+++ b/web/tests/browser/editor-custody.test.ts
@@ -61,7 +61,15 @@ function lambdaSession(id: SessionId): SessionEntry {
     done: null,
     timer: null,
   }
-  return { id, label: id, detached: true, client: fakeClient(), legs: { lambda: leg }, tmProgram: null }
+  return {
+    id,
+    label: id,
+    detached: true,
+    client: fakeClient(),
+    legs: { lambda: leg },
+    tmProgram: null,
+    tmScratch: null,
+  }
 }
 
 let panes: PaneCollection
diff --git a/web/tests/browser/scratch-fork.test.ts b/web/tests/browser/scratch-fork.test.ts
index 1e87865..7578dc6 100644
--- a/web/tests/browser/scratch-fork.test.ts
+++ b/web/tests/browser/scratch-fork.test.ts
@@ -124,7 +124,7 @@ function sourceSession(pool: SessionPool, seen: RunReply[]): SessionEntry {
       for (const f of reply.frames) legs.tm.hist.push(f, tmFrameBytes(f))
     }
   })
-  return { id: SOURCE, label: 'source', detached: false, client, legs, tmProgram: null }
+  return { id: SOURCE, label: 'source', detached: false, client, legs, tmProgram: null, tmScratch: null }
 }
 
 describe('detach is a fork', () => {
diff --git a/web/tests/node/replies.test.ts b/web/tests/node/replies.test.ts
index 0f91e40..ac01122 100644
--- a/web/tests/node/replies.test.ts
+++ b/web/tests/node/replies.test.ts
@@ -10,7 +10,7 @@ import type { ClientPort, PoolPort, SessionId } from '../../src/session-client'
 import { SessionClient, SessionPool } from '../../src/session-client'
 import type { LegState, SessionEntry } from '../../src/sessions'
 import { PaneSlot, SessionRegistry } from '../../src/sessions'
-import type { Diagnostic, LambdaState, TmProgram, TmState } from '../../src/types'
+import type { Diagnostic, LambdaState, TmProgram, TmScratchStatus, TmState } from '../../src/types'
 
 /**
  * **WHAT A SESSION KEEPS FROM ITS OWN `compiled` REPLY** — the retention a TM pane created later is
@@ -80,6 +80,7 @@ function sourceEntry(): SessionEntry {
     client: fakeClient(),
     legs: { lambda: leg<LambdaState>(), tm: leg<TmState>() },
     tmProgram: null,
+    tmScratch: null,
   }
 }
 
@@ -481,3 +482,62 @@ describe('onScratchReply records a buffer’s text from its own scratch-compiled
     expect(persists()).toBe(0)
   })
 })
+
+describe('a TM buffer retains what its panes were last told', () => {
+  const STATUS: TmScratchStatus = {
+    available: true,
+    reason: '',
+    width: 8,
+    run: 'Running',
+    header: true,
+    reduction: { stages: ['single-tape'], steps: 241_666 },
+  }
+
+  const built = (tapeNames: string[]): RunReply => ({
+    kind: 'tm-scratch-compiled',
+    gen: 1,
+    tm: STATUS,
+    tmProgram: PROGRAM,
+    tapeNames,
+  })
+
+  /**
+   * THE NAMES COME FROM THE REPLY, NOT FROM THE FIXED EXPORT. A label no bank list contains is the only value that
+   * tells the two apart, since the fixed export answers the bank names for every machine.
+   */
+  it('holds the status and the tape names its own reply carried, with no pane to tell', () => {
+    const { buffers, reg, replies } = scratchDriver()
+    const id = buffers.forkBlank('tm')
+    replies.onScratchReply(id, built(['5 tapes, interleaved']))
+    expect(reg.entryOf(id).tmProgram?.tapeNames).toEqual(['5 tapes, interleaved'])
+    expect(reg.entryOf(id).tmScratch).toEqual({ status: STATUS, value: null })
+  })
+
+  it('holds the latest value reading beside that status', () => {
+    const { buffers, reg, replies } = scratchDriver()
+    const id = buffers.forkBlank('tm')
+    replies.onScratchReply(id, built(['REG']))
+    const running = { run: 'Running', steps: 500_000, cap: 241_666 } as const
+    replies.onScratchReply(id, { kind: 'tm-value', gen: 1, run: running, value: 'Unfinished' })
+    const ended = { run: 'Ended', steps: 241_666, cap: 241_666 } as const
+    replies.onScratchReply(id, { kind: 'tm-value', gen: 1, run: ended, value: { Value: { text: '2' } } })
+    expect(reg.entryOf(id).tmScratch).toEqual({
+      status: STATUS,
+      value: { run: ended, value: { Value: { text: '2' } } },
+    })
+  })
+
+  it('a new build forgets the previous value', () => {
+    const { buffers, reg, replies } = scratchDriver()
+    const id = buffers.forkBlank('tm')
+    replies.onScratchReply(id, built(['REG']))
+    replies.onScratchReply(id, {
+      kind: 'tm-value',
+      gen: 1,
+      run: { run: 'Ended', steps: 1, cap: 1 },
+      value: { Value: { text: '2' } },
+    })
+    replies.onScratchReply(id, built(['REG']))
+    expect(reg.entryOf(id).tmScratch?.value).toBeNull()
+  })
+})
diff --git a/web/tests/node/scratch.test.ts b/web/tests/node/scratch.test.ts
index f8ae06b..cf74521 100644
--- a/web/tests/node/scratch.test.ts
+++ b/web/tests/node/scratch.test.ts
@@ -149,7 +149,15 @@ function sourceEntry(text = 'from source'): SessionEntry {
   hist.push(lambdaFrame(text), 1)
   const lambda: LegState<LambdaState> = { hist, status: { available: true, reason: '' }, done: null, timer: null }
   // NO MACHINE — nothing here sends a `compiled` reply, which is the only thing that retains one.
-  return { id: SOURCE, label: 'source', detached: false, client: fakeClient(), legs: { lambda }, tmProgram: null }
+  return {
+    id: SOURCE,
+    label: 'source',
+    detached: false,
+    client: fakeClient(),
+    legs: { lambda },
+    tmProgram: null,
+    tmScratch: null,
+  }
 }
 
 describe('ScratchBuffers.fork', () => {
diff --git a/web/tests/node/sessions.test.ts b/web/tests/node/sessions.test.ts
index 15826cf..9152bcf 100644
--- a/web/tests/node/sessions.test.ts
+++ b/web/tests/node/sessions.test.ts
@@ -93,7 +93,15 @@ function entry(
   // NO MACHINE ON ANY OF THEM. `SessionEntry.tmProgram` is retained from a `compiled` reply, and this
   // file drives the binding model rather than the reply switch — `tests/node/replies.test.ts` is where
   // the retention itself is asserted.
-  return { id, label: opts.label ?? id, detached: opts.detached ?? false, client: fakeClient(), legs, tmProgram: null }
+  return {
+    id,
+    label: opts.label ?? id,
+    detached: opts.detached ?? false,
+    client: fakeClient(),
+    legs,
+    tmProgram: null,
+    tmScratch: null,
+  }
 }
 
 /** A `PaneView` that records every call instead of touching a DOM. */
````
<!-- END task4.patch -->

- [ ] **Step 3: Lint and typecheck**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P/web" && pnpm exec biome ci --error-on-warnings . 2>&1 | grep -E "Found .* (error|warning)"; echo "biome done"
cd "$P/web" && CARGO_TARGET_DIR="$P/target" pnpm run typecheck 2>&1 | grep -E "error TS"; echo "typecheck done"
```

Expected: `biome done` and `typecheck done`, each with no line before it.

- [ ] **Step 4: Run the node tests this task touches**

`pnpm exec vitest run` with positional paths is the form that scopes; `pnpm test:node -- <name>` runs every file.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P/web" && pnpm exec vitest run --project node tests/node/replies.test.ts tests/node/sessions.test.ts tests/node/scratch.test.ts tests/node/session-client.test.ts 2>&1 | grep -E "Test Files|Tests |FAIL"
```

Expected:

```text
Test Files  4 passed (4)
Tests  106 passed (106)
```

- [ ] **Step 5: Commit**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -q -F - <<'EOF'
Carry a TM buffer's value run to the main thread

After a TM buffer's first recording, the worker runs its TmValueRun out
in VALUE_CHUNK steps, 500,000, measured at 7.7 ms in a release build,
posting a tm-value reply after each chunk and yielding between them. An
edit supersedes the loop at its next chunk. tm-scratch-compiled carries
the scratch's own tapeNames, and dropLive frees the value run beside the
scratch.

replies.ts retains a TM buffer's status and latest value reading on its
SessionEntry, as tmScratch, so a pane created later can be seeded, and
forgets the reading on a new build or a worker error. Three docs this
makes false are amended here: onScratchReply's arm count, the tm-scratch
request's reason for carrying no encoding, and onExtend's claim that
frames are a scratch's whole answer.
EOF
git -C "$P" log --oneline -1 && git -C "$P" status --short
```

Expected: every hook the commit prints reads `Passed` or `Skipped`, then a line ending `Carry a TM buffer's value run to the main thread`, and no `git status` line.

- [ ] **Step 6: Sabotages**

Run the whole block as one Bash tool call, with a timeout of 600000 ms.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
block_of sab.py >| "$S/sab.py"
fast() { cd "$P/web" && pnpm exec vitest run --project node tests/node/replies.test.ts 2>&1 | grep -E "^\s+×|Tests "; }
restore() { git -C "$P" checkout -- web/ && git -C "$P" status --short -- web/; }
R="$P/web/src/replies.ts"

echo "T4-S1: the scratch arm labels tapes from the fixed list"
python3 "$S/sab.py" "$R" 'tapeNames: reply.tapeNames, tmText: null }' "tapeNames: ['REG', 'WORK', 'STACK', 'HEAP', 'BOX'], tmText: null }" && fast; restore

echo "T4-S2: a tm-value reading is not retained"
python3 "$S/sab.py" "$R" '        if (entry.tmScratch !== null)
          entry.tmScratch = { ...entry.tmScratch, value: { run: reply.run, value: reply.value } }' '        void entry' && fast; restore

echo "T4-S3: a new build keeps the previous reading"
python3 "$S/sab.py" "$R" '        sessions.entryOf(session).tmScratch = { status: reply.tm, value: null }' '        sessions.entryOf(session).tmScratch = { status: reply.tm, value: sessions.entryOf(session).tmScratch?.value ?? null }' && fast; restore
```

Expected, row by row, each followed by the restore printing no `git status` line:

- **T4-S1** (the scratch arm labels tapes from the fixed list):
  - red: `holds the status and the tape names its own reply carried, with no pane to tell`
  - `Tests 1 failed | 11 passed (12)`
- **T4-S2** (a tm-value reading is not retained):
  - red: `holds the latest value reading beside that status`
  - `Tests 1 failed | 11 passed (12)`
- **T4-S3** (a new build keeps the previous reading):
  - red: `a new build forgets the previous value`
  - `Tests 1 failed | 11 passed (12)`

---

### Task 5: The pane says a file is reduced and shows its value

**Files:**
- Modify: `web/src/results.ts` — `valueLine`
- Modify: `web/src/tm-pane.ts` — `#reading`, the `#value` line with `role="status"`, `setScratchValue`, `#drawValue`, the reduced half of `#drawStatus`, and the two editor-clear sites
- Modify: `web/src/replies.ts` — push each reading to the buffer's TM panes, and a null reading with each new status
- Modify: `web/src/pane-host.ts` — `tmScratchOf`, and seeding a new TM pane's status and reading
- Modify: `web/src/main.ts` — answer `tmScratchOf` from the entry
- Modify: `web/tests/node/results.test.ts` — `valueLine`'s cases
- Modify: `web/tests/browser/tm-pane-editor.test.ts` — the sentence, the value line and its role, and both going with the editor

**What changes.**
1. **The status line** adds `reduced: <stages> · <n> steps` for a `version 2` file, beside the per-frame half and the headerless sentence.
2. **The value line** is hidden until a reading arrives and whenever the pane has no scratch; while the run is going it reads `value: running · <steps> of <cap> steps`, and once it ends, `value: <text>` for a value or `decodedText`'s words for any other ending.
3. **A split pane is seeded** with the retained status and reading, where it used to get only the program; that also gives a split pane of a headerless buffer its headerless sentence.

**Interfaces:**
- Consumes: Task 4's `SessionEntry.tmScratch` and `tm-value` retention.
- Produces: `export function valueLine(reading: { run: ValueRun; value: Decoded } | null): string | null` (`results.ts`); `TmPane.setScratchValue(reading: { run: ValueRun; value: Decoded } | null): void`; `PaneHostDeps.tmScratchOf(session: SessionId): TmScratchReading | null`.

- [ ] **Step 1: Confirm the starting commit and a clean tree**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD && git -C "$P" diff --cached --quiet && echo clean
```

Expected: a line ending `Carry a TM buffer's value run to the main thread`, then `clean`.

- [ ] **Step 2: Apply the patch**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
block_of task5.patch | git -C "$P" apply --index --check && block_of task5.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat | tail -1
```

Expected: `7 files changed, 136 insertions(+), 6 deletions(-)`
<!-- BEGIN task5.patch -->
````diff
diff --git a/web/src/main.ts b/web/src/main.ts
index 825bac2..b13e4e6 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -697,6 +697,7 @@ async function main(): Promise<EditorView> {
     // need. `entryOf` throws for a session nothing registered, which is the policy `legOf` already sets
     // for the same class of wiring bug.
     tmProgramOf: (session: SessionId) => sessions.entryOf(session).tmProgram,
+    tmScratchOf: (session: SessionId) => sessions.entryOf(session).tmScratch,
     // THE SECOND SESSION QUESTION `pane-host.ts` ASKS, ANSWERED HERE FOR THE SAME REASON AS THE FIRST —
     // this file is where `ScratchBuffers` is, and that module takes a function from a `SessionId` to one
     // value rather than the class itself. `editorSeed` answers `null` for everything that is not a warm
diff --git a/web/src/pane-host.ts b/web/src/pane-host.ts
index a879916..7a14264 100644
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -16,7 +16,7 @@ import type { PaneChoice, PaneEvents } from './pane-chrome'
 import type { LeafId, PaneCollection, PaneKind } from './panes'
 import { type Leg, ruleCount } from './protocol'
 import type { SessionId } from './session-client'
-import { type Binding, PaneSlot, type TmCompiled } from './sessions'
+import { type Binding, PaneSlot, type TmCompiled, type TmScratchReading } from './sessions'
 import { TmPane } from './tm-pane'
 
 /**
@@ -162,6 +162,11 @@ export function createPaneHost(deps: {
    * something; the pane is built here, so the push belongs here too.
    */
   tmProgramOf(session: SessionId): TmCompiled | null
+  /**
+   * A TM buffer's retained status and value reading, or `null` for any other session — `tmProgramOf`'s twin, asked
+   * in the same creation pass for the same reason: the replies that carried both have already been and gone.
+   */
+  tmScratchOf(session: SessionId): TmScratchReading | null
   /**
    * The text and collapse flag a λ pane newly bound to `session` should mount its editor from, or
    * `null` when `session` is not a warm scratch buffer — `mountScratchEditor` below is the one caller.
@@ -196,6 +201,7 @@ export function createPaneHost(deps: {
     writeLayoutStorage,
     draw,
     tmProgramOf,
+    tmScratchOf,
     scratchSeedOf,
   } = deps
 
@@ -893,6 +899,11 @@ export function createPaneHost(deps: {
           pane.setProgram(compiled.program, compiled.tapeNames)
           pane.setForkAvailable(compiled.tmText, ruleCount(compiled.program))
         }
+        const reading = tmScratchOf(session)
+        if (reading !== null) {
+          pane.setScratchStatus(reading.status)
+          pane.setScratchValue(reading.value)
+        }
         panes.add({ id: l.id, kind: 'tm', slot, pane, host })
       }
     }
diff --git a/web/src/replies.ts b/web/src/replies.ts
index f387748..eba58b4 100644
--- a/web/src/replies.ts
+++ b/web/src/replies.ts
@@ -429,7 +429,10 @@ export function createReplies(deps: {
         // the lowered bank names would mislabel, and only the scratch knows its own stage list.
         const compiled: TmCompiled = { program: reply.tmProgram, tapeNames: reply.tapeNames, tmText: null }
         sessions.entryOf(session).tmScratch = { status: reply.tm, value: null }
-        storeAndSetProgram(session, compiled, (pane) => pane.setScratchStatus(reply.tm))
+        storeAndSetProgram(session, compiled, (pane) => {
+          pane.setScratchStatus(reply.tm)
+          pane.setScratchValue(null)
+        })
         // THE EDITOR IS SEEDED FROM THE BUFFER'S OWN TEXT OF RECORD, NOT FROM THIS REPLY — there is
         // none to seed from (`tm-scratch-compiled` carries no `text`, unlike `scratch-compiled`).
         // `ScratchBuffers.editorSeed`'s own doc names the gap this closes: "the λ half of the repair
@@ -462,6 +465,8 @@ export function createReplies(deps: {
         const entry = sessions.entryOf(session)
         if (entry.tmScratch !== null)
           entry.tmScratch = { ...entry.tmScratch, value: { run: reply.run, value: reply.value } }
+        for (const p of panes.ofSession('tm', session))
+          (p.pane as TmPane).setScratchValue(entry.tmScratch?.value ?? null)
         return
       }
       case 'lambda-frames': {
diff --git a/web/src/results.ts b/web/src/results.ts
index 72fa9cd..26c0db4 100644
--- a/web/src/results.ts
+++ b/web/src/results.ts
@@ -1,6 +1,6 @@
 import { n } from './format'
 import type { LambdaLeg, TmLeg } from './protocol'
-import type { Diagnostic, RunStatus } from './types'
+import type { Decoded, Diagnostic, RunStatus, ValueRun } from './types'
 import { decodedText } from './types'
 
 export type Row = { leg: string; label: string; value: string; note?: string }
@@ -98,3 +98,18 @@ export function noSessionRows(diagnostics: Diagnostic[]): Row[] {
   const errors = diagnostics.filter((d) => d.severity === 'Error').length
   return [{ leg: '', label: '', value: `not compiled — ${n(errors)} ${errors === 1 ? 'error' : 'errors'}` }]
 }
+
+/**
+ * The line a TM buffer's pane shows for its value run, or `null` for no line: a buffer with no header has no value
+ * run, and one that has not reported yet has nothing to say.
+ *
+ * **THE ENDED TEXT IS `decodedText`'s, THE FORMATTER `#results` USES,** so a value reads the same on both surfaces.
+ * Only a real value takes the `value: ` prefix; every other ending already says what it is.
+ */
+export function valueLine(reading: { run: ValueRun; value: Decoded } | null): string | null {
+  if (reading === null) return null
+  const { run, value } = reading
+  if (run.run === 'Running') return `value: running · ${n(run.steps)} of ${n(run.cap)} steps`
+  if (typeof value === 'object' && 'Value' in value) return `value: ${value.Value.text}`
+  return decodedText(value)
+}
diff --git a/web/src/tm-pane.ts b/web/src/tm-pane.ts
index 9837d62..7f15dd7 100644
--- a/web/src/tm-pane.ts
+++ b/web/src/tm-pane.ts
@@ -13,11 +13,12 @@ import {
   type SplitChoices,
 } from './pane-chrome'
 import type { Leg } from './protocol'
+import { valueLine } from './results'
 import { ScratchEditor } from './scratch-editor'
 import type { Binding, PaneOption } from './sessions'
 import { centredScrollTop, Follow, focusedRows, highlight, linkedRows, ROW_HEIGHT, StateIndex } from './state-table'
 import { tapeRows } from './tape'
-import type { TmProgram, TmScratchStatus, TmState } from './types'
+import type { Decoded, TmProgram, TmScratchStatus, TmState, ValueRun } from './types'
 import { visibleWindow } from './virtual-list'
 
 export { ROW_HEIGHT } from './state-table'
@@ -104,6 +105,19 @@ export class TmPane implements EditablePane {
    * sentence outliving the editor it describes.
    */
   #scratch: TmScratchStatus | null = null
+  /**
+   * The value run's latest reading, or `null` before its first report and for a file with no header.
+   *
+   * **SHOWN ONLY WHILE `#scratch` IS SET, AND NOT CLEARED BESIDE IT.** Every caller that sets a status sets a reading
+   * with it (`replies.ts`'s `tm-scratch-compiled` arm, `pane-host.ts`'s seeding), so a reading can never outlive the
+   * status it was reported under onto the screen; clearing it too would be a line no test could see.
+   */
+  #reading: { run: ValueRun; value: Decoded } | null = null
+  /**
+   * The value line. **`role="status"` FROM CONSTRUCTION**, because it updates while nobody is looking at it, which
+   * is the one kind of text the accessibility list's item 6 (`#link-status`) found announcing nothing.
+   */
+  #value: HTMLElement
 
   /**
    * The fork control, or `null` on a pane whose events carry no `detachMachine` handler — design
@@ -168,6 +182,10 @@ export class TmPane implements EditablePane {
     this.#select = paneSelect(title, on.rebind)
     this.#status = document.createElement('div')
     this.#status.className = 'tm-status'
+    this.#value = document.createElement('div')
+    this.#value.className = 'tm-value'
+    this.#value.setAttribute('role', 'status')
+    this.#value.hidden = true
     // THE HOST IS IN THE DOM FROM CONSTRUCTION AND CARRIES NO CLASS UNTIL AN EDITOR IS MOUNTED — same
     // rule as `LambdaPane`'s own `#editorHost`, and that field's doc carries the argument.
     this.#editorHost = document.createElement('div')
@@ -280,6 +298,7 @@ export class TmPane implements EditablePane {
     this.#body.append(
       this.#editorHost,
       this.#status,
+      this.#value,
       this.#tapes,
       this.#toggle,
       this.#reattach,
@@ -448,6 +467,7 @@ export class TmPane implements EditablePane {
       // this call and the next frame must not see a sentence about a machine this pane no longer shows.
       this.#scratch = null
       this.#drawStatus()
+      this.#drawValue()
       return
     }
     const onEdit = this.#onEdit
@@ -484,6 +504,7 @@ export class TmPane implements EditablePane {
     // must stop announcing that editor's scratch's header the instant it does.
     this.#scratch = null
     this.#drawStatus()
+    this.#drawValue()
     return editor
   }
 
@@ -546,6 +567,22 @@ export class TmPane implements EditablePane {
     this.#drawStatus()
   }
 
+  /**
+   * Show the value run's latest reading, or no line for `null` — `setScratchStatus`'s shape: store, then let the one
+   * writer of the line compose it.
+   */
+  setScratchValue(reading: { run: ValueRun; value: Decoded } | null): void {
+    this.#reading = reading
+    this.#drawValue()
+  }
+
+  /** The one writer of `#value`. No scratch, no line: an attached pane shows no value run. */
+  #drawValue(): void {
+    const line = this.#scratch === null ? null : valueLine(this.#reading)
+    this.#value.hidden = line === null
+    this.#value.textContent = line ?? ''
+  }
+
   /**
    * Record the machine a fork would carry and the count a refusal would name — `detachButton`'s rule,
    * as a data dependency rather than a convention — design §4.3. Stores the two facts and defers to
@@ -688,7 +725,9 @@ export class TmPane implements EditablePane {
         : `${program.states[frame.state]?.name ?? `state ${frame.state}`} · width ${n(program.width)}`
     const scratch = this.#scratch
     const headerless = scratch !== null && !scratch.header ? `no header — blank tapes at width ${n(scratch.width)}` : ''
-    this.#status.textContent = [perFrame, headerless].filter((s) => s !== '').join(' · ')
+    const reduction = scratch?.reduction ?? null
+    const reduced = reduction === null ? '' : `reduced: ${reduction.stages.join(', ')} · ${n(reduction.steps)} steps`
+    this.#status.textContent = [perFrame, headerless, reduced].filter((s) => s !== '').join(' · ')
   }
 
   /**
diff --git a/web/tests/browser/tm-pane-editor.test.ts b/web/tests/browser/tm-pane-editor.test.ts
index 732a577..c211269 100644
--- a/web/tests/browser/tm-pane-editor.test.ts
+++ b/web/tests/browser/tm-pane-editor.test.ts
@@ -170,6 +170,41 @@ describe('the TM pane editor region', () => {
     expect(host.textContent).not.toMatch(/no header/i)
   })
 
+  /**
+   * A reduced file's stages and recorded steps are said in the status line, and the value run's reading is a line of
+   * its own, announced as it changes. Both go with the editor, for `#scratch`'s reason.
+   */
+  it('says a reduced file is reduced, reads its value, and forgets both with the editor', () => {
+    const { pane, host } = mountPane()
+    pane.setEditor('tapes 1\n')
+    pane.setScratchStatus({
+      available: true,
+      reason: '',
+      width: 8,
+      run: 'Running',
+      header: true,
+      reduction: { stages: ['fold', 'single-tape'], steps: 910_258 },
+    })
+    pane.render(null, CONTROLS)
+    expect(host.querySelector('.tm-status')?.textContent).toContain('reduced: fold, single-tape · 910,258 steps')
+
+    const line = () => host.querySelector<HTMLElement>('.tm-value')
+    expect(line()?.getAttribute('role')).toBe('status')
+    expect(line()?.hidden).toBe(true)
+
+    pane.setScratchValue({ run: { run: 'Running', steps: 500_000, cap: 910_258 }, value: 'Unfinished' })
+    expect(line()?.hidden).toBe(false)
+    expect(line()?.textContent).toBe('value: running · 500,000 of 910,258 steps')
+
+    pane.setScratchValue({ run: { run: 'Ended', steps: 910_258, cap: 910_258 }, value: { Value: { text: '2' } } })
+    pane.render(FRAME, CONTROLS)
+    expect(line()?.textContent).toBe('value: 2')
+
+    pane.setEditor(null)
+    expect(line()?.hidden).toBe(true)
+    expect(host.querySelector('.tm-status')?.textContent).not.toContain('reduced')
+  })
+
   /**
    * `EditablePane`'s other three members, exercised the way `editor-custody.ts`'s `reconcileEditors`
    * actually calls them — `takeEditor` on the pane giving the editor up, `receiveEditor` on the pane
diff --git a/web/tests/node/results.test.ts b/web/tests/node/results.test.ts
index c9db6e7..5766d2b 100644
--- a/web/tests/node/results.test.ts
+++ b/web/tests/node/results.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from 'vitest'
 import type { LambdaLeg, TmLeg } from '../../src/protocol'
-import { noSessionRows, resultRows } from '../../src/results'
+import { noSessionRows, resultRows, valueLine } from '../../src/results'
 import type { Diagnostic, LambdaState } from '../../src/types'
 
 const okState: LambdaState = {
@@ -179,3 +179,27 @@ describe('noSessionRows', () => {
     expect(noSessionRows([err('a'), warn('b'), warn('c')])[0]?.value).toBe('not compiled — 1 error')
   })
 })
+
+describe('valueLine', () => {
+  const ended = { run: 'Ended', steps: 241_666, cap: 241_666 } as const
+
+  it('has no line before the first reading', () => {
+    expect(valueLine(null)).toBeNull()
+  })
+
+  it('counts a running run against its cap', () => {
+    expect(valueLine({ run: { run: 'Running', steps: 500_000, cap: 7_007_238 }, value: 'Unfinished' })).toBe(
+      'value: running · 500,000 of 7,007,238 steps',
+    )
+  })
+
+  it("prefixes a value, and says every other ending in `decodedText`'s words", () => {
+    expect(valueLine({ run: ended, value: { Value: { text: '[1, 2]' } } })).toBe('value: [1, 2]')
+    expect(valueLine({ run: ended, value: 'Undecodable' })).toBe('no encoding for this type')
+    expect(valueLine({ run: ended, value: 'TooLargeToPrint' })).toBe('value too large to print')
+    const fault = 'did not halt within the 507 steps its header records'
+    expect(valueLine({ run: { run: 'Capped', steps: 507, cap: 507 }, value: { Fault: { message: fault } } })).toBe(
+      `fault: ${fault}`,
+    )
+  })
+})
````
<!-- END task5.patch -->

- [ ] **Step 3: Lint and typecheck**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P/web" && pnpm exec biome ci --error-on-warnings . 2>&1 | grep -E "Found .* (error|warning)"; echo "biome done"
cd "$P/web" && CARGO_TARGET_DIR="$P/target" pnpm run typecheck 2>&1 | grep -E "error TS"; echo "typecheck done"
```

Expected: `biome done` and `typecheck done`, each with no line before it.

- [ ] **Step 4: Build the dev wasm package, then run the node and browser tests this task touches**

The browser tier imports `pkg/`, which is gitignored and must be built from this tree.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P/web" && CARGO_TARGET_DIR="$P/target" pnpm run build:wasm:dev 2>&1 | tail -1
cd "$P/web" && pnpm exec vitest run --project node tests/node/results.test.ts 2>&1 | grep -E "Tests |FAIL"
cd "$P/web" && PATH="/usr/sbin:$PATH" cap pnpm exec vitest run --project browser tests/browser/tm-pane-editor.test.ts 2>&1 | grep -E "Tests |FAIL"
```

Expected:

```text
[INFO]: 📦   Your wasm pkg is ready to publish at ../pkg.
Tests  22 passed (22)
Tests  11 passed (11)
```

- [ ] **Step 5: Commit**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -q -F - <<'EOF'
A TM pane says a file is reduced and shows its value

The status line adds "reduced: <stages> · <n> steps" for a version 2
file, and a value line under it, role="status", reads the value run:
running against its cap, then the value, or decodedText's words for
any other ending. results.ts's valueLine composes it. replies.ts pushes
each reading to the buffer's TM panes, and pane-host.ts seeds a TM pane
created later with the retained status and reading, which also gives a
split pane of a headerless buffer its headerless sentence.
EOF
git -C "$P" log --oneline -1 && git -C "$P" status --short
```

Expected: every hook the commit prints reads `Passed` or `Skipped`, then a line ending `A TM pane says a file is reduced and shows its value`, and no `git status` line.

- [ ] **Step 6: Sabotages**

Run the whole block as one Bash tool call, with a timeout of 1200000 ms.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
block_of sab.py >| "$S/sab.py"
pane() { cd "$P/web" && PATH="/usr/sbin:$PATH" cap pnpm exec vitest run --project browser tests/browser/tm-pane-editor.test.ts 2>&1 | grep -E "^\s+×|Tests "; }
node() { cd "$P/web" && pnpm exec vitest run --project node tests/node/results.test.ts 2>&1 | grep -E "^\s+×|Tests "; }
restore() { git -C "$P" checkout -- web/ && git -C "$P" status --short -- web/; }
T="$P/web/src/tm-pane.ts"
V="$P/web/src/results.ts"

echo "T5-S1: the value line has no role"
python3 "$S/sab.py" "$T" "    this.#value.setAttribute('role', 'status')
" '' && pane; restore

echo "T5-S2: the status line leaves out the reduction"
python3 "$S/sab.py" "$T" '[perFrame, headerless, reduced]' '[perFrame, headerless]' && pane; restore

echo "T5-S3: the value line shows on a pane with no scratch"
python3 "$S/sab.py" "$T" '    const line = this.#scratch === null ? null : valueLine(this.#reading)' '    const line = valueLine(this.#reading)' && pane; restore

echo "T5-S4: a running line leaves out its count"
python3 "$S/sab.py" "$V" '  if (run.run === '"'"'Running'"'"') return `value: running · ${n(run.steps)} of ${n(run.cap)} steps`' '  if (run.run === '"'"'Running'"'"') return `value: running`' && node; restore

echo "T5-S5: a value is shown without its prefix"
python3 "$S/sab.py" "$V" '  if (typeof value === '"'"'object'"'"' && '"'"'Value'"'"' in value) return `value: ${value.Value.text}`' '  if (typeof value === '"'"'object'"'"' && '"'"'Value'"'"' in value) return decodedText(value)' && node; restore
```

Expected, row by row, each followed by the restore printing no `git status` line:

- **T5-S1** (the value line has no role):
  - red: `says a reduced file is reduced, reads its value, and forgets both with the editor`
  - `Tests 1 failed | 10 passed (11)`
- **T5-S2** (the status line leaves out the reduction):
  - red: `says a reduced file is reduced, reads its value, and forgets both with the editor`
  - `Tests 1 failed | 10 passed (11)`
- **T5-S3** (the value line shows on a pane with no scratch):
  - red: `says a reduced file is reduced, reads its value, and forgets both with the editor`
  - `Tests 1 failed | 10 passed (11)`
- **T5-S4** (a running line leaves out its count):
  - red: `counts a running run against its cap`
  - `Tests 1 failed | 21 passed (22)`
- **T5-S5** (a value is shown without its prefix):
  - red: `` prefixes a value, and says every other ending in `decodedText`'s words ``
  - `Tests 1 failed | 21 passed (22)`

**T5-S1 to T5-S3 all redden one test,** `says a reduced file is reduced, reads its value, and forgets both with the editor`, each at the first assertion it breaks: the role, the sentence, and the hidden line after `setEditor(null)`.

**A pushed reading and a seeded one are not visible in this tier.** Task 6's browser tests hold both.

---

### Task 6: A reduced file through the real app

**Files:**
- Create: `crates/redextape-core/tests/fixtures/five_minus_three_single_tape.tm` — generated in Step 3, not in the patch
- Modify: `crates/redextape-core/tests/reduced_tm_file.rs` — `the_web_fixture_is_the_file_reduce_writes_today`
- Create: `web/tests/browser/tm-reduced-buffer.test.ts` — three end-to-end tests
- Modify: `crates/redextape-wasm/tests/browser.rs` — `a_headered_tm_scratch_carries_a_value_run_that_reports_in_numbers`
- Modify: `README.md` — the wasm browser test count, 26 to 27, which `scripts/check-doc-figures.sh` requires in the same commit

**What changes.** No production code. The fixture is `5 - 3` reduced to one tape: 103,028 bytes, 241,666 steps, value 2. Its value is not 0, so a decode that read the reduced tape as a lowered one cannot pass by coincidence.

**Tests:**
1. **Core:** the fixture must be byte for byte what `reduce` and `print_tm_with` write today.
2. **Web browser**, one buffer for the file:
   - pasting the fixture shows `reduced: single-tape · 241,666 steps`, the label `5 tapes, interleaved`, `value: 2`, and `role="status"`;
   - a TM pane split from it is seeded with the sentence and the value;
   - an edit supersedes a running value run. That test pastes a spinner recording 1,000,000,000 steps, waits for it to report, pastes one recording 999,999,999, waits for that count, then pastes the fixture back so nothing spins under later files. A second build shorter than one chunk would let a stale loop, which re-reads `live`, finish the new run itself and pass.
3. **Wasm browser:** `value` is `null` beside a headerless scratch, and a value run's counts, a reduction's steps and the scratch's tape names cross the wire as numbers and strings.

**Interfaces:** Consumes everything Tasks 1 to 5 produce.

- [ ] **Step 1: Confirm the starting commit and a clean tree**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD && git -C "$P" diff --cached --quiet && echo clean
```

Expected: a line ending `A TM pane says a file is reduced and shows its value`, then `clean`.

- [ ] **Step 2: Apply the patch**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
block_of task6.patch | git -C "$P" apply --index --check && block_of task6.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat | tail -1
```

Expected: `4 files changed, 167 insertions(+), 1 deletion(-)`
<!-- BEGIN task6.patch -->
````diff
diff --git a/README.md b/README.md
index 4d8171e..30a7557 100644
--- a/README.md
+++ b/README.md
@@ -271,7 +271,7 @@ figures above read 841/716/48 until 2026-08-24, having drifted by 315 tests and
 from the breakdown entirely. Recount rather than trust them.
 
 **Two tiers sit outside that count**, because neither runs under `cargo nextest`. The wasm boundary
-has **26** browser tests (`wasm-pack test --headless --chrome crates/redextape-wasm`), run by CI's
+has **27** browser tests (`wasm-pack test --headless --chrome crates/redextape-wasm`), run by CI's
 `rust-browser` job. `web/` has **246** of its own across two Vitest projects — 187 in Node for the
 pure modules, 59 in real Chromium for the worker and the app end to end — run by CI's `web` job
 under the coverage gate. Recount with `pnpm test`.
diff --git a/crates/redextape-core/tests/reduced_tm_file.rs b/crates/redextape-core/tests/reduced_tm_file.rs
index df95939..817adbb 100644
--- a/crates/redextape-core/tests/reduced_tm_file.rs
+++ b/crates/redextape-core/tests/reduced_tm_file.rs
@@ -52,6 +52,22 @@ fn round_trip(src: &str, stages: &[StageKind]) {
 /// reads 0 anyway, and `3 - 5` hid a header whose code had two of its symbols swapped.
 const FIVE_MINUS_THREE: &str = "5 - 3";
 
+/// The web app's browser tier pastes this file into a TM buffer, so it must be the file `reduce` writes today: a stale
+/// copy would pin the web app to a format nothing produces any more.
+#[test]
+fn the_web_fixture_is_the_file_reduce_writes_today() {
+    let (core, ty) = core_and_ty(FIVE_MINUS_THREE);
+    let d = run_tm_described(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS).unwrap();
+    let (m, h) = reduce(&d, &[SingleTape]).unwrap();
+    let written = print_tm_with(&m, &h);
+    // `assert!` rather than `assert_eq!`, for `round_trip`'s reason: a failure would print a hundred thousand bytes.
+    assert!(
+        include_str!("fixtures/five_minus_three_single_tape.tm") == written,
+        "regenerate it: `redextape emit five-minus-three.rxt --lang tm --reduce single-tape -o \
+         crates/redextape-core/tests/fixtures/five_minus_three_single_tape.tm`, from a file holding `5 - 3`"
+    );
+}
+
 #[test]
 fn the_fold_alone_decodes() {
     round_trip(FIVE_MINUS_THREE, &[Fold]);
diff --git a/crates/redextape-wasm/tests/browser.rs b/crates/redextape-wasm/tests/browser.rs
index 8adfa7d..981509f 100644
--- a/crates/redextape-wasm/tests/browser.rs
+++ b/crates/redextape-wasm/tests/browser.rs
@@ -1206,6 +1206,38 @@ fn a_headerless_tm_scratch_runs_and_says_its_configuration_was_invented() {
     }
 }
 
+/// A headered file's `tmScratch` answer carries a value run beside the scratch, and a headerless one carries `null`
+/// there: decision 2's absence at construction, which leaves `tmValue` off the scratch and pinned below. What only
+/// this tier can see is the wire: every count a value run and a reduced status report crosses as a JS number, and the
+/// scratch's own tape names cross per file.
+#[wasm_bindgen_test]
+fn a_headered_tm_scratch_carries_a_value_run_that_reports_in_numbers() {
+    let headerless =
+        redextape_wasm::tm_scratch("tapes 1\nstart s\n\nstate s: accept\n").expect("tmScratch must not throw");
+    assert!(!get(&headerless, "scratch").is_null());
+    assert!(get(&headerless, "value").is_null(), "no header, no result type, no value run");
+
+    let stuck = "tapes 1\nstart stuck\nversion 2\nencoding unary\nwidth 4\nslots 0\nresult Nat\nreduced single-tape 5\nsteps 1\n\nstate stuck:\n";
+    let out = redextape_wasm::tm_scratch(stuck).expect("tmScratch must not throw");
+    let (scratch, value) = (get(&out, "scratch"), get(&out, "value"));
+    assert!(!value.is_null(), "a headered file has a value run");
+
+    let run = call(&value, "run", &[JsValue::from_f64(1_000.0)]);
+    assert_eq!(get(&run, "run").as_string().as_deref(), Some("Ended"));
+    assert_eq!(num(&run, "steps"), 0.0);
+    assert_eq!(num(&run, "cap"), 1.0, "the header's recorded count, as a number");
+    let decoded = call(&value, "value", &[]);
+    let message = get(&get(&decoded, "Fault"), "message").as_string().expect("a fault message");
+    assert!(message.contains("`stuck`"), "{message}");
+
+    let reduction = get(&call(&scratch, "tmStatus", &[]), "reduction");
+    assert_eq!(num(&reduction, "steps"), 1.0);
+    let stages: Array = get(&reduction, "stages").unchecked_into();
+    assert_eq!(stages.get(0).as_string().as_deref(), Some("single-tape"));
+    let names: Array = call(&scratch, "tapeNames", &[]).unchecked_into();
+    assert_eq!(names.get(0).as_string().as_deref(), Some("5 tapes, interleaved"));
+}
+
 /// TM text that does not parse to a machine crosses as diagnostics beside a NULL handle, the same
 /// shape `lambdaScratch` uses. A missing header is deliberately NOT one of these cases.
 #[wasm_bindgen_test]
diff --git a/web/tests/browser/tm-reduced-buffer.test.ts b/web/tests/browser/tm-reduced-buffer.test.ts
new file mode 100644
index 0000000..de10579
--- /dev/null
+++ b/web/tests/browser/tm-reduced-buffer.test.ts
@@ -0,0 +1,118 @@
+import { EditorView } from '@codemirror/view'
+import { beforeAll, describe, expect, it } from 'vitest'
+import FIXTURE from '../../../crates/redextape-core/tests/fixtures/five_minus_three_single_tape.tm?raw'
+import { SHELL, until } from './harness'
+
+/**
+ * **A REDUCED `.tm` FILE IN A TM BUFFER, THROUGH THE REAL APP** — the worker's value run, the reply that carries it,
+ * the pane that shows it, and the seeding a split relies on, none of which a lower tier can reach together.
+ *
+ * **THE FIXTURE IS `5 - 3` REDUCED TO ONE TAPE**, checked in beside `crates/redextape-core/tests/reduced_tm_file.rs`,
+ * which fails if it is no longer the file `reduce` writes. Its value is 2, not 0, so a decode that read the reduced
+ * tape as a lowered one cannot pass by coincidence.
+ *
+ * ONE BUFFER FOR THE WHOLE FILE, minted once: every sibling browser file shares its page across tests, and buffers
+ * accumulate across them by design.
+ */
+
+/**
+ * A reduced file that never halts: one state that stays put forever, under a header recording `MAX_REDUCED_STEPS`,
+ * 1,000,000,000. **THE COUNT HAS TO BE THE CEILING.** A release build steps some 65 million a second, so a spinner
+ * recording 50,000,000 finished before the first poll could see it running; this one runs for about fifteen seconds
+ * in release and far longer in a dev build.
+ */
+const SPINNER =
+  'tapes 1\nstart go\nversion 2\nencoding unary\nwidth 4\nslots 0\nresult Nat\nreduced single-tape 5\n' +
+  'steps 1000000000\n\nstate go:\n  [*] -> write [*], move [S], goto go\n'
+
+const leaf = (id: string): HTMLElement => {
+  const el = document.querySelector<HTMLElement>(`[data-leaf="${id}"]`)
+  if (el === null) throw new Error(`no pane at [data-leaf="${id}"]`)
+  return el
+}
+const statusOf = (id: string) => leaf(id).querySelector('.tm-status')?.textContent ?? ''
+const valueLineOf = (id: string) => leaf(id).querySelector<HTMLElement>('.tm-value')
+
+/** Replace the TM pane's editor text, the way a paste does. */
+function paste(id: string, text: string): void {
+  const dom = leaf(id).querySelector<HTMLElement>('.cm-editor')
+  if (dom === null) throw new Error(`no editor mounted in [data-leaf="${id}"]`)
+  const editor = EditorView.findFromDOM(dom)
+  if (editor === null) throw new Error('the editor DOM has no view')
+  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } })
+}
+
+/** `pane-picker.test.ts`'s `pickSplit`, restated for the reason every browser file restates its helpers. */
+function pickSplit(id: string, control: string, item: string): void {
+  const button = document.querySelector<HTMLButtonElement>(`[data-leaf="${id}"] button[aria-label="${control}"]`)
+  if (button === null) throw new Error(`no "${control}" control on [data-leaf="${id}"]`)
+  button.click()
+  const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
+  const items = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
+  const chosen = items.find((b) => b.textContent === item)
+  if (chosen === undefined) throw new Error(`no "${item}" — offered: ${items.map((b) => b.textContent).join(' | ')}`)
+  chosen.click()
+}
+
+const tmLeaves = () =>
+  [...document.querySelectorAll<HTMLElement>('[data-kind="tm"]')].map((el) => el.dataset.leaf ?? '')
+
+beforeAll(async () => {
+  document.body.innerHTML = SHELL
+  const view: EditorView = await (await import('../../src/main')).ready
+  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
+  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
+
+  document.querySelector<HTMLButtonElement>('#buffers')?.click()
+  document.querySelector<HTMLButtonElement>('.buffer-list button.new-tm')?.click()
+  const select = leaf('tm-0').querySelector<HTMLSelectElement>('.pane-binding select')
+  await until(() => [...(select?.options ?? [])].some((o) => o.value === 'tm\x00scratch-1'), 'the buffer to be offered')
+  if (select === null) throw new Error('no binding selector on the TM pane')
+  select.value = 'tm\x00scratch-1'
+  select.dispatchEvent(new Event('change'))
+  await until(() => leaf('tm-0').querySelector('.cm-editor') !== null, 'the buffer editor to mount')
+})
+
+describe('a reduced file in a TM buffer', () => {
+  it('says it is reduced, labels its one tape, and reads its value', async () => {
+    paste('tm-0', FIXTURE)
+    await until(() => valueLineOf('tm-0')?.textContent === 'value: 2', 'the value run to read 2')
+    expect(statusOf('tm-0')).toContain('reduced: single-tape · 241,666 steps')
+    expect([...leaf('tm-0').querySelectorAll('.tape-label')].map((e) => e.textContent)).toEqual([
+      '5 tapes, interleaved',
+    ])
+    expect(valueLineOf('tm-0')?.getAttribute('role')).toBe('status')
+  })
+
+  it('seeds a TM pane split from it with the sentence and the value', async () => {
+    const before = tmLeaves()
+    pickSplit('tm-0', 'split left and right', 'TM · TM scratch 1 (same)')
+    await until(() => tmLeaves().length === before.length + 1, 'the split to add a TM pane')
+    const created = tmLeaves().find((id) => !before.includes(id))
+    if (created === undefined) throw new Error('the split added no TM pane')
+    expect(statusOf(created)).toContain('reduced: single-tape · 241,666 steps')
+    expect(valueLineOf(created)?.textContent).toBe('value: 2')
+  })
+
+  /**
+   * **THE SECOND BUILD IS ANOTHER LONG RUN, AND IT HAS TO BE.** A value run that ends within one `VALUE_CHUNK` lets a
+   * stale loop, which re-reads `live`, finish the new run itself and release the loop flag before the new build asks
+   * for it, so the right value arrives by accident. A second spinner outlasts the stale loop, and its own count is
+   * what only the new build's loop can report.
+   */
+  it('lets an edit supersede a value run that is still going', async () => {
+    paste('tm-0', SPINNER)
+    await until(
+      () => valueLineOf('tm-0')?.textContent?.endsWith('of 1,000,000,000 steps') ?? false,
+      'the first spinner to report',
+    )
+    paste('tm-0', SPINNER.replace('steps 1000000000', 'steps 999999999'))
+    await until(
+      () => valueLineOf('tm-0')?.textContent?.endsWith('of 999,999,999 steps') ?? false,
+      'the second spinner to report',
+    )
+    // AND BACK TO THE FIXTURE, so no value run is left spinning under the next file's tests.
+    paste('tm-0', FIXTURE)
+    await until(() => valueLineOf('tm-0')?.textContent === 'value: 2', 'the fixture to read 2 again')
+  })
+})
````
<!-- END task6.patch -->

- [ ] **Step 3: Generate the fixture and check it by hash**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
printf '5 - 3\n' >| "$S/five-minus-three.rxt"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo build --release -p redextape-cli 2>&1 | tail -1
"$P/target/release/redextape" emit "$S/five-minus-three.rxt" --lang tm --reduce single-tape -o "$P/crates/redextape-core/tests/fixtures/five_minus_three_single_tape.tm"
sha256sum "$P/crates/redextape-core/tests/fixtures/five_minus_three_single_tape.tm" | cut -d' ' -f1
git -C "$P" add crates/redextape-core/tests/fixtures/five_minus_three_single_tape.tm && git -C "$P" diff --cached --stat | tail -1
```

Expected: a `Finished` line, then `fab049e2637cb09a5eb26b779ff3662cc8d14bf7da135b07bebf99d188044d7a`, then `5 files changed, 2948 insertions(+), 1 deletion(-)`

- [ ] **Step 4: Lint, typecheck and the documented figures**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P/web" && pnpm exec biome ci --error-on-warnings . 2>&1 | grep -E "Found .* (error|warning)"; echo "biome done"
cd "$P/web" && CARGO_TARGET_DIR="$P/target" pnpm run typecheck 2>&1 | grep -E "error TS"; echo "typecheck done"
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && scripts/check-doc-figures.sh 2>&1 | tail -1
cd "$P/web" && pnpm exec vitest run --project node tests/node/browser-timeout-invariants.test.ts 2>&1 | grep -E "Tests "
```

Expected: `biome done`, `typecheck done`, `fmt exit 0`, then `check-doc-figures: 43 documented figures match the tree.` and `Tests  14 passed (14)`.

- [ ] **Step 5: Run the core fixture test, the web end-to-end tests, and the wasm browser tier**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core --test reduced_tm_file 2>&1 | grep -E "FAIL|Summary"
cd "$P/web" && CARGO_TARGET_DIR="$P/target" pnpm run build:wasm:dev 2>&1 | tail -1
cd "$P/web" && PATH="/usr/sbin:$PATH" cap pnpm exec vitest run --project browser tests/browser/tm-reduced-buffer.test.ts 2>&1 | grep -E "Tests |FAIL"
cd "$P" && PATH="/usr/sbin:$PATH" TREE_SITTER=/home/davey/projects/redextape/.tools/tree-sitter CARGO_TARGET_DIR="$P/target" cap scripts/check-all.sh --browser-only 2>&1 | grep -E "test result: ok\. [1-9]|FAILED|^error"
```

Expected:

```text
Summary 7 tests run: 7 passed, 3 skipped
[INFO]: 📦   Your wasm pkg is ready to publish at ../pkg.
Tests  3 passed (3)
test result: ok. 27 passed; 0 failed; 0 ignored; 0 filtered out
```

- [ ] **Step 6: Commit**

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -q -F - <<'EOF'
Hold a reduced file in a TM buffer to its value through the real app

five_minus_three_single_tape.tm is 5 - 3 reduced to one tape, and
reduced_tm_file.rs fails if it is no longer the file reduce writes.
tm-reduced-buffer.test.ts pastes it into a blank TM buffer and asserts
the reduced sentence, the interleaved label and value: 2; a split pane
seeded with both; and an edit that supersedes a running value run,
with a second spinner, since a run shorter than one chunk would pass a
stale loop. browser.rs asserts value is null beside a headerless
scratch, and that a value run's counts cross as numbers. README's wasm
browser test count moves from 26 to 27.
EOF
git -C "$P" log --oneline -1 && git -C "$P" status --short
```

Expected: every hook the commit prints reads `Passed` or `Skipped`, then a line ending `Hold a reduced file in a TM buffer to its value through the real app`, and no `git status` line.

- [ ] **Step 7: Sabotages**

Run the whole block as one Bash tool call, with a timeout of 1800000 ms.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
block_of sab.py >| "$S/sab.py"
e2e() { cd "$P/web" && PATH="/usr/sbin:$PATH" cap pnpm exec vitest run --project browser tests/browser/tm-reduced-buffer.test.ts 2>&1 | grep -E "^\s+×|Tests "; }
restore() { git -C "$P" checkout -- web/ crates/ && git -C "$P" status --short -- web/ crates/; }
K="$P/web/src/session-worker.ts"
R="$P/web/src/replies.ts"
H="$P/web/src/pane-host.ts"
F="$P/crates/redextape-core/tests/fixtures/five_minus_three_single_tape.tm"

echo "T6-S1: the value loop drops its generation check"
python3 "$S/sab.py" "$K" "      if (live?.gen !== gen || live.kind !== 'tm-scratch' || live.value === null) return" "      if (live === null || live.kind !== 'tm-scratch' || live.value === null) return" && e2e; restore

echo "T6-S2: the value loop never starts"
python3 "$S/sab.py" "$K" '  await runValueLoop(req.gen)
' '' && e2e; restore

echo "T6-S3: a reading is retained but never pushed to a pane"
python3 "$S/sab.py" "$R" "          (p.pane as TmPane).setScratchValue(entry.tmScratch?.value ?? null)" "          void p" && e2e; restore

echo "T6-S4: a new TM pane is not seeded with the reading"
python3 "$S/sab.py" "$H" '          pane.setScratchValue(reading.value)
' '' && e2e; restore

echo "T6-S5: the worker posts the fixed tape names"
python3 "$S/sab.py" "$K" '    tapeNames: scratch.tapeNames(),' "    tapeNames: ['REG', 'WORK', 'STACK', 'HEAP', 'BOX']," && e2e; restore

echo "T6-S6: the fixture goes stale by one byte"
printf '\n' >> "$F" && (cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run --no-fail-fast -p redextape-core --test reduced_tm_file 2>&1 | grep -E "^\s+FAIL \[|Summary"); restore
```

Expected, row by row, each followed by the restore printing no `git status` line:

- **T6-S1** (the value loop drops its generation check):
  - red: `lets an edit supersede a value run that is still going`
  - `Tests 1 failed | 2 passed (3)`
- **T6-S2** (the value loop never starts):
  - red: `says it is reduced, labels its one tape, and reads its value`
  - red: `seeds a TM pane split from it with the sentence and the value`
  - red: `lets an edit supersede a value run that is still going`
  - `Tests 3 failed (3)`
- **T6-S3** (a reading is retained but never pushed to a pane):
  - red: `says it is reduced, labels its one tape, and reads its value`
  - red: `lets an edit supersede a value run that is still going`
  - `Tests 2 failed | 1 passed (3)`
- **T6-S4** (a new TM pane is not seeded with the reading):
  - red: `seeds a TM pane split from it with the sentence and the value`
  - `Tests 1 failed | 2 passed (3)`
- **T6-S5** (the worker posts the fixed tape names):
  - red: `says it is reduced, labels its one tape, and reads its value`
  - `Tests 1 failed | 2 passed (3)`
- **T6-S6** (the fixture goes stale by one byte):
  - red: `redextape-core::reduced_tm_file the_web_fixture_is_the_file_reduce_writes_today`
  - `Summary 7 tests run: 6 passed, 1 failed, 3 skipped`

---

## After Task 6: the whole-branch gates

These are what CI runs. Each command writes its whole output to a log under `$S` and prints its own exit status, so a
failure cannot hide behind a pipe. **Run the first block with `run_in_background: true`:** `scripts/check-all.sh` takes
about fifteen minutes, past the Bash tool's ten-minute limit. Read its log when the notification arrives.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P" && PATH="/usr/sbin:$PATH" TREE_SITTER=/home/davey/projects/redextape/.tools/tree-sitter CARGO_TARGET_DIR="$P/target" cap scripts/check-all.sh >| "$S/check-all.log" 2>&1; echo "check-all exit $?"
grep -m1 -E "Summary \[" "$S/check-all.log"
grep -E "all configs" "$S/check-all.log"
```

Expected: `check-all exit 0`, then `Summary 1764 tests run: 1764 passed, 33 skipped` and `all configs green — base, LLVM and browser`

```bash
P=/home/davey/projects/redextape/.claude/worktrees/web-reduced-files
PLAN="$P/docs/superpowers/plans/2026-09-16-web-reduced-files.md"
S="$P/target/web-reduced-files-exec"
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
cd "$P/web" && CARGO_TARGET_DIR="$P/target" pnpm run build:wasm >| "$S/web-wasm.log" 2>&1; echo "build:wasm exit $?"
cd "$P/web" && pnpm exec biome ci --error-on-warnings . >| "$S/web-biome.log" 2>&1; echo "biome exit $?"
cd "$P/web" && CARGO_TARGET_DIR="$P/target" pnpm run typecheck >| "$S/web-typecheck.log" 2>&1; echo "typecheck exit $?"
cap16() { systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 -- "$@"; }
cd "$P/web" && PATH="/usr/sbin:$PATH" cap16 pnpm run test:coverage >| "$S/web-coverage.log" 2>&1; echo "test:coverage exit $?"
grep -E "Test Files|Tests |All files" "$S/web-coverage.log"
cd "$P/web" && pnpm run build:app >| "$S/web-app.log" 2>&1; echo "build:app exit $?"
```

Expected:

```text
build:wasm exit 0
biome exit 0
typecheck exit 0
test:coverage exit 0
Test Files  75 passed (75)
Tests  724 passed (724)
All files          |   96.06 |    90.95 |   98.87 |   98.28 |
build:app exit 0
```

**`test:coverage` runs under a 16 GiB scope, not `cap`'s 8 GiB.** Coverage runs the node and browser projects together, and
measured under a 16 GiB scope it peaked at 8.5 GiB. Under `cap` the kernel killed it twice, printed as
`test:coverage exit 143` with no summary line.

## Figures, measured while planning

Every figure below was taken on this machine while planning, at the commit named, with the command given.

**The value run's step rate, and `VALUE_CHUNK`.** A throwaway browser probe (never committed; its source is described
here rather than kept) loaded a release build (`pnpm run build:wasm`, at Task 2's scratch commit), built each reduced
file with `tmScratch`, and ran its `TmValueRun` out in 1,000,000-step chunks. Twelve files with a recorded run of at
least 1,000,000 steps and at most 5 MB of text ran at 63.7 to 71.9 million steps per second, starting at a load average
of 3.57. On `letx.single-tape.tm` (`let x = 40; x + 2` reduced through `single-tape`, 22,243,581 steps), fifteen chunks
of each size after one warm-up chunk measured:

| budget | median | max |
| --- | --- | --- |
| 100,000 | 1.5 ms | 1.6 ms |
| 250,000 | 3.9 ms | 3.9 ms |
| 500,000 | 7.7 ms | 7.8 ms |
| 1,000,000 | 15.3 ms | 15.5 ms |

**The size ceiling, and `MAX_SCRATCH_TM_BYTES`.** The same probe priced a TM buffer's build the way
`web/tests/browser/tm-fork-cost.test.ts` priced a fork: a `MessageChannel` round trip of the request, `tmScratch`, the
`tmProgram` projection with `tmStatus` and `tapeNames`, and a `MessageChannel` round trip of the reply. Files came from
`redextape emit <prog>.rxt --lang tm --reduce <stages>` over small programs and every stage list. A first pass
priced every file up to 40 MB with three runs each at or under 5 MB and one above it; a second pass priced every file between 3.9 MB and
11 MB with five runs each, starting at a load average of 2.75. The second pass's medians around the budget:

| bytes | rules | clone | parse | project | back | total | |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4,634,010 | 64,862 | 0.6 | 48.7 | 67.3 | 34.9 | 151.5 | under |
| 5,351,636 | 55,714 | 1.0 | 50.3 | 108.4 | 39.9 | 199.6 | under |
| 6,003,896 | 103,978 | 0.9 | 60.3 | 92.8 | 54.2 | 208.2 | under |
| 6,053,591 | 84,612 | 1.1 | 66.3 | 90.1 | 52.2 | 209.7 | under |
| 6,617,969 | 68,798 | 1.0 | 65.9 | 136.3 | 48.0 | 251.2 | over |
| 7,489,988 | 129,581 | 1.3 | 77.7 | 116.2 | 71.2 | 266.4 | over |
| 10,948,544 | 152,388 | 1.9 | 126.6 | 164.9 | 102.7 | 396.1 | over |

All times in ms. `MAX_SCRATCH_TM_BYTES` is 6,100,000, the first round hundred thousand at or above the largest file under
budget. The same 4,341,300-byte file measured 156.5 ms in the first pass and 144.6 ms in the second, so the ceiling is a
band about 12 ms wide, not a line. The editor's own mount, which the ceiling cannot bound, measured 54.9 ms at
37,923,527 bytes, the largest file priced.

**What a TM buffer shows when its text does not build.** A throwaway browser probe on `bbc35ba`'s code (dev build)
minted a blank TM buffer, bound the TM pane to it, and replaced its text three times. Every failure landed on
`#link-status` as `fork failed — <message>`, and the TM editor's gutter held no lint range:

| text | `#link-status` |
| --- | --- |
| a freshly minted blank buffer | `fork failed — missing \`tapes <n>\`` |
| a bad machine after a good build | `fork failed — unknown goto target \`nowhere\`` |
| a bad machine as the first text | `fork failed — unknown goto target \`nowhere\`` |

The same probe found a same-leg rebind leaves a TM pane drawing the machine of the session it left: bound to an empty
buffer, `tm-0` still showed the source program's δ rows.

## Decisions and spec corrections found while planning

The spec is as amended before any code. Where the built code departs from it:

1. **The size refusal's span is zero-width at the origin,** where the spec says it spans line 1. That is
   `lambda_scratch_at`'s precedent for a diagnostic about a whole input rather than a place in it.
2. **The ceiling's property test pads a tiny machine to exactly `MAX_SCRATCH_TM_BYTES` and one byte more,** where the
   spec asks for the largest passing corpus file and the smallest failing one. Those files are 6 MB reductions whose
   `reduce` would run in a debug build, and a boundary test pins the one thing a test can: that the constant is the
   ceiling. The corpus readings live in the constant's doc and above.
3. **`VALUE_CHUNK` is 500,000,** measured at 7.7 ms, where the spec says about 10 ms. The next measured size, 1,000,000,
   took 15.3 ms.
4. **The scratch STATUS is retained and seeded too, not only the value.** A split of a TM pane showing a reduced file
   must show the reduced sentence, which lives in the status; the status was never retained, so a split pane of a
   headerless buffer also never showed its headerless sentence. Retaining the status beside the value fixes both.
5. **`SessionEntry` gains `tmScratch`, rather than `TmCompiled` gaining fields.** `TmCompiled` names a compile; the
   value arrives chunks after the machine does.
6. **The value line's reading is not cleared beside `#scratch`.** Every caller that sets a status sets a reading with it,
   so a clear would be a line no test can see.
7. **The supersession test supersedes one spinner with another.** The fixture's run is shorter than one chunk, so a
   stale loop that re-reads `live` finishes the new run itself and the right value arrives by accident. Measured: with
   the fixture as the second build, T6-S1 stayed green; with a second spinner, it goes red. A first version of the
   test recorded 50,000,000 steps and passed on a dev build but timed out in CI's release build, where the spinner
   finished before the first poll; the spinners record 1,000,000,000 and 999,999,999 steps.
8. **Spec sabotage S8 is replaced.** "`TmValueRun` steps the scratch's own cursor" is not an edit this design can
   express: the value run owns its cursor by type. `running_the_value_run_out_leaves_the_scratch_at_step_zero` still
   pins the property; T2-S3 (the value run built under the default caps) takes S8's row.
9. **README's wasm browser test count moves from 26 to 27** in Task 6, which `scripts/check-doc-figures.sh` requires in
   the same commit.

## Findings

- **`cargo nextest run` stops at the first failure by default, which truncates a sabotage's red list.** A first round
  of this plan's sabotages listed two red tests where `--no-fail-fast` lists four. Every sabotage block here passes
  `--no-fail-fast`.
- **T1-S2 (the accept check applied to lowered runs) is caught only by core's
  `a_lowered_run_is_not_held_to_an_accept_state`.** The CLI and wasm suites stay green on it.
- **`Decoded::Fault` for `DecodeFailure::BudgetExhausted` has no test.** No fixture here reaches the decode budget, and
  the CLI's own mapping is pinned through `report_tm_decode`'s seam rather than a real decode for the same reason.
- **A crates-only commit skips the web typecheck.** Task 2's new `TmScratchStatus` field breaks three literals in
  `web/tests/browser/tm-pane-editor.test.ts`, which the hook does not see from a commit touching only `crates/`, so
  Task 2 fixes them in the same commit.
- **Past about 5 MB the `tmProgram` projection is the largest of the four build costs, and it does not track bytes
  alone.** The `fold, two-symbol` files project slowest for their size: 108.4 ms at 5,351,636 bytes and 55,714 rules,
  against 92.8 ms at 6,003,896 bytes and 103,978 rules. Bytes are the ceiling's unit because they are known before the
  parse, not because they predict the cost.
- **Every TM buffer build failure is worded "fork failed", and the TM gutter shows no diagnostic.** Older than this
  slice; filed, not fixed.
- **A same-leg rebind reseeds nothing on a TM pane.** Older than this slice; the value line inherits it.
- **CI's web coverage run does not fit the 8 GiB cap this repo's probes run under.** `pnpm run test:coverage` peaked at
  8.5 GiB under a 16 GiB scope, and was OOM-killed twice under 8 GiB, which a pipe into `grep` first hid as a gate
  that printed nothing. The whole-branch gate block gives that one command 16 GiB and prints every command's exit.

## Left for the controller

- The roadmap entry, after the whole-branch review.
- The throwaway worktrees `.claude/worktrees/web-reduced-files-scratch`, `web-reduced-files-scratch-2` and
  `web-reduced-files-replay`, and their branches of the same names, once the PR merges.
