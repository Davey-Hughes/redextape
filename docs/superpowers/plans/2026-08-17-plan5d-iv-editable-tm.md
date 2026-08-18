# 5d-iv — The Editable TM Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the TM pane an editable `.tm` source region, forked from the machine it is showing or opened blank, so a user can change a δ rule and watch the tapes take the new transition.

**Architecture:** A TM pane grows 5d-iii's split body — a `ScratchEditor` above, today's tape rows and δ-table below, one collapse control. The seed rides the `compiled` reply as `tmText`, gated by `MAX_FORK_RULES` so an over-cap machine never crosses the wire. `TmScratch` already exists at the wasm boundary with every method a renderer needs; this plan builds its first caller.

**Tech Stack:** Rust (`redextape-core`, `redextape-wasm`, `wasm-bindgen`), TypeScript + Vite + CodeMirror 6, Vitest (node and browser projects), `cargo nextest`, Biome.

**Design:** [`../specs/2026-08-17-plan5d-iv-editable-tm-design.md`](../specs/2026-08-17-plan5d-iv-editable-tm-design.md). Every `§` reference below points there.

## Global Constraints

- **`pre-commit` runs on every commit and is never skipped.** Six hooks: `check-text-bytes`, `check-citations`, `cargo fmt`, `cargo clippy --workspace --all-targets -- -D warnings`, `biome ci`, `tsc --noEmit`. **Never pass `--no-verify`.** If a task's commit split leaves clippy warnings at an intermediate commit, collapse the split and say so in the task report.
- **No `file:line` citations in tracked source.** `scripts/check-citations.sh` rejects them and the hook runs on every commit. Name the symbol and the file: `` `LambdaPane.setEditor` in `web/src/lambda-pane.ts` ``, never `lambda-pane.ts:274`. `docs/` is out of scope, but this plan follows the rule anyway.
- **No lint allowed globally.** `clippy::pedantic` is on with no crate-level `allow`. Any `allow` must be at the narrowest possible site with a comment giving the reason.
- **Doc-comment convention:** `///` in Rust, `/** */` in TypeScript. `///` is inert in TypeScript.
- **`redextape-core` keeps its dependency gate.** Nothing in this plan adds a dependency to any crate.
- **Web test scoping:** vitest's `-- <name>` filter does not scope *files*. Always name the file path: `pnpm exec vitest run --project node tests/node/scratch.test.ts`.
- **Probes get a hard memory cap.** Any measurement task runs its probe under `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0`. `/tmp` is a 30 GB RAM tmpfs on this machine — write probe output to the scratchpad, not to `/tmp`.
- **Baseline to compare against:** `cargo nextest run --workspace` → **900 passed, 8 skipped** at `a31f282`. `pnpm test` → **606 passed in 63 files**.
- **TWO DIFFERENT COVERAGE NUMBERS, AND CONFLATING THEM COST TASK 5 THREE TESTS IT DID NOT NEED.** The
  **enforced gate** is `vite.config.ts`'s `thresholds`: `{ lines: 97, functions: 97, branches: 89,
  statements: 95 }` — a run below any of these FAILS. The **convention** is that a slice should not close
  below the previous slice's figures, which for 5d-ii-d were 95.57 / 89.88 / 98.51 / 98.08. Task 5's brief
  quoted the convention as though it were the gate; the implementer read pre-margin figures of
  95.52 / 89.85 / 98.53 / 98.09 as a gate failure — **they clear all four thresholds comfortably** — and
  added three tests for unrelated pre-existing code to buy margin back. **A test that exists to move a
  number rather than to defend a behaviour makes the gate report health it has not measured.** Report both
  figures, say which is which, and never add a test to raise a percentage.
- **`web/tests/browser` needs Chrome**, which is off-PATH in `/usr/sbin`. It is a skippable tier: **no assertion that only the browser tier can make may be the sole proof of a claim this plan calls load-bearing.**

---

### Task 1: `Session` retains its `TmHeader`, and `tmText` reads it

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs` — the `tm` field on `Session`, its eight destructuring sites, the two `compile` arms, and a new `tm_text` method
- Modify: `crates/redextape-wasm/src/lib.rs` — a `tmText` method on the exported `Session`
- Test: `crates/redextape-wasm/src/session.rs` (inline `mod tests`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Session::tm_text(&self) -> Option<String>` (Rust), exported as `session.tmText(): string | null` at the wasm boundary. `Session.tm` becomes `Result<(TmProgram, TmCursor<Rc<Machine>>, tm::TmHeader), TmDecline>`.

**Why the header and not `print_tm`:** §3.5. `print_tm(machine)` reparses to a machine that runs *from blank tapes at `MIN_FIELD_WIDTH`*, not from the program's real input. That is decision 6's state — correct for a hand-written file, wrong for a fork.

**Why inside the `Ok` tuple:** the field's own doc argues it. *"THE PAIRING IS WHAT MAKES A CURSOR WITHOUT ITS PROGRAM UNREPRESENTABLE"* — the looser shape it replaced forced a fabricated, permanently uncovered user-facing status. The header exists exactly when that `Result` is `Ok`, so it belongs in the tuple, not in a fourth `Option` field beside it.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-wasm/src/session.rs`'s inline `mod tests`:

```rust
/// **`tm_text` MUST PRODUCE TEXT THAT REBUILDS THE SAME MACHINE, NOT MERELY TEXT THAT PARSES.**
/// `a_headered_scratch_matches_the_session_path_except_for_the_source_node` already proves that
/// property for text produced by a hand-assembled `print_tm_with` call. This proves it for the
/// SHIPPED path — the method the app will actually call — which is the one that can regress.
///
/// **THE WIDTH ASSERTION IS WHAT CATCHES A DROPPED HEADER.** Without one, `tm_scratch` falls back
/// to `MIN_FIELD_WIDTH` (4) and blank tapes; this fixture's auto-fit chooses 64, so a header lost
/// anywhere between `compile` and `print_tm_with` fails here rather than showing up as a machine
/// that quietly computes nothing.
#[test]
fn tm_text_round_trips_through_tm_scratch_to_the_same_machine() {
    let src = "let x = 40; x + 2";
    let mut s = Session::compile(src, EncodingKind::Unary).session.expect("compiles");

    let text = s.tm_text().expect("an available TM leg has text");
    let made = tm_scratch(&text);
    assert!(made.diagnostics.is_empty(), "a printed machine must reparse: {:?}", made.diagnostics);
    let mut sc = made.scratch.expect("a printed machine must reparse");

    let st = sc.tm_status();
    assert!(st.header, "the header survived `compile` and reached the printer");
    assert_eq!(st.width, 64, "the auto-fit width, not `MIN_FIELD_WIDTH`");
    assert_eq!(sc.tm_program(), s.tm_program().expect("TM available"), "same machine, same projection");

    // Lockstep rather than a step-0 comparison: a wrong `init` can agree on an empty tape at step 0
    // and diverge the moment the machine reads one.
    let mut owned = 0usize;
    for step in 0..50u32 {
        let mapped = s.tm_state(3).expect("TM available");
        owned += usize::from(mapped.source_node.is_some());
        assert_eq!(
            sc.tm_state(3),
            TmState { source_node: None, ..mapped.clone() },
            "step {step}: the scratch loses `source_node` and must lose nothing else"
        );
        assert_eq!(sc.step_tm(), s.step_tm().expect("TM available"), "step {step}: the two must stop together");
    }
    assert!(owned > 0, "the mapped side resolved no owner in 50 steps, so the comparison proves nothing");
}

/// **A DECLINED TM LEG HAS NO TEXT, AND `None` IS THE ONLY HONEST ANSWER.** There is no machine to
/// print. This is the same condition `tm_program` answers `SessionError::TmAbsent` on, read off the
/// same `Result`, so the two cannot disagree about whether a leg exists.
#[test]
fn a_declined_tm_leg_has_no_text() {
    let s = Session::compile(OVERFLOWING_PROGRAM, EncodingKind::Unary).session.expect("compiles");
    assert!(s.tm_program().is_err(), "this fixture's TM leg must decline for the test to mean anything");
    assert_eq!(s.tm_text(), None);
}
```

Reuse whatever constant the existing `a_declined_tm_leg_reports_no_total_steps` test uses for a declining program; if it inlines its source string, inline the same string here rather than introducing `OVERFLOWING_PROGRAM`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cargo nextest run -p redextape-wasm tm_text
```

Expected: FAIL to compile — `no method named 'tm_text' found for struct 'Session'`.

- [ ] **Step 3: Widen the tuple**

In `crates/redextape-wasm/src/session.rs`, change the field:

```rust
    pub(crate) tm: Result<(TmProgram, TmCursor<Rc<Machine>>, tm::TmHeader), TmDecline>,
```

Extend that field's existing doc with a paragraph — do not replace what is there:

```rust
    /// **THE HEADER JOINS THE PAIR RATHER THAN SITTING BESIDE IT AS A FOURTH `Option` FIELD, FOR THE
    /// REASON THE PARAGRAPHS ABOVE GIVE FOR THE PAIR ITSELF.** A header exists exactly when this
    /// `Result` is `Ok` — `compile` reads it off `run_tm_described`, which always produces one on a
    /// non-declining arm — so an `Option<TmHeader>` next to this field could spell "an available leg
    /// with no header", a state no program can reach and every reader would have to handle. It is
    /// retained because `tm_text` needs it: `print_tm` without a header reparses to a machine running
    /// from blank tapes at `MIN_FIELD_WIDTH` instead of from this program's input. Cost is
    /// O(tapes x width), not O(states).
```

Fix the two `compile` arms. Destructure before building so the borrow ends before the move:

```rust
                TmRun::Ran { tapes } => {
                    let (p, c) = build_tm_leg(&d.header, d.machine, caps);
                    Ok(((p, c, d.header), Some(tapes)))
                }
                TmRun::HitCap => {
                    let (p, c) = build_tm_leg(&d.header, d.machine, caps);
                    Ok(((p, c, d.header), None))
                }
```

**`build_tm_leg` is NOT changed.** Its doc says *"`header` BY REFERENCE: both uses (`init`, `.width`) only ever read it, and both call sites still own their `TmHeader` afterward — there is nothing here for taking it by value to buy."* That sentence stays true, which is why the destructuring happens at the call site.

Then widen the seven remaining destructuring sites in the same file — `match &self.tm { Ok((p, c)) => …` becomes `Ok((p, c, _)) =>`, `let (p, _) = …` becomes `let (p, _, _) = …`, and so on. `cargo clippy -D warnings` finds every one.

- [ ] **Step 4: Add `tm_text`**

Place it immediately after `tm_program` in the same `impl Session`:

```rust
    /// This session's machine as `.tm` text, or `None` for a declined leg.
    ///
    /// **UNCONDITIONAL ON SIZE.** Asked, it prints, however many rules the machine has — `list60` is
    /// 94,182 of them and about 7.8 MB of text. The size decision belongs to the caller and lives in
    /// `protocol.ts`'s `forkable`, for the reason that module's own constant records: the app needs the
    /// rule count to WORD its refusal as well as to make it, so a threshold here would be a second home
    /// for one number.
    ///
    /// `print_tm_with` AND NOT `print_tm`: without the header the text reparses to a machine running
    /// from blank tapes at `MIN_FIELD_WIDTH`, which is decision 6's state and is not this machine.
    pub fn tm_text(&self) -> Option<String> {
        let (_, cursor, header) = self.tm.as_ref().ok()?;
        Some(tm::print_tm_with(cursor.machine(), header))
    }
```

`TmCursor::machine() -> &Machine` already exists in `redextape-core`'s `trace` module.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cargo nextest run -p redextape-wasm tm_text
cargo nextest run --workspace
```

Expected: the two new tests PASS; the workspace reports **902 passed, 8 skipped** (900 + 2).

- [ ] **Step 6: Export it at the boundary**

In `crates/redextape-wasm/src/lib.rs`, inside the exported `impl Session`, beside `tmProgram`:

```rust
    /// `tmText()` -> `string | null`. The machine as `.tm` text, for a fork to seed a `TmScratch` from.
    ///
    /// **NOT FALLIBLE AND SO NOT `Result`.** Unlike its neighbours it marshals a plain `String`, which
    /// `JsValue::from` cannot fail on; a declined leg is `null`, which is a fact rather than an error.
    #[wasm_bindgen(js_name = tmText)]
    pub fn tm_text(&self) -> Option<String> {
        self.0.tm_text()
    }
```

Check the surrounding methods for how they reach the inner session (`self.0` versus a named field) and match it.

- [ ] **Step 7: Prove it at the boundary**

In `crates/redextape-wasm/tests/browser.rs`, beside the existing `tmScratch` boundary tests:

```rust
/// **THE WIRE CARRIES A STRING OR A NULL, AND THE NATIVE TIER CANNOT SEE WHICH.** `Option<String>`
/// marshals as `string | undefined` by default and this crate's serializer is configured for `null`;
/// which one arrives is a property of the boundary and is asserted here because `protocol.ts` types
/// the field `string | null`.
#[wasm_bindgen_test]
fn tm_text_crosses_as_a_string() {
    let s = compile("let x = 40; x + 2", "unary").expect("compiles");
    let session = Reflect::get(&s, &JsValue::from_str("session")).expect("has a session");
    let text = Reflect::get(&session, &JsValue::from_str("tmText")).expect("has tmText");
    assert!(text.is_string() || text.is_null(), "tmText must cross as a string or null, got {text:?}");
}
```

Adapt the handle-reaching lines to whatever idiom the neighbouring tests in that file already use — they are the authority on how a `Session` handle is obtained there.

- [ ] **Step 8: Commit**

```bash
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-wasm/src/session.rs crates/redextape-wasm/src/lib.rs crates/redextape-wasm/tests/browser.rs
git commit -m "5d-iv T1: Session keeps its TmHeader, and tmText reads it"
```

---

### Task 2: Fix `MAX_FORK_RULES` by measurement

**Files:**
- Create: `web/tests/browser/tm-fork-cost.test.ts` (probe, gated on `REDEXTAPE_PROBE=1`)
- Modify: `web/package.json` — a `test:probe:tm` script

**Interfaces:**
- Consumes: Task 1's `session.tmText()`.
- Produces: a measured integer that Task 3 writes into `protocol.ts` as `MAX_FORK_RULES`.

**What is being measured, and why a guess will not do:** §3.1 establishes the corpus and the wall — `list20` at 16,250 lines must clear the cap and `list60` at 127,890 must not. Where between them the line falls is what this probe decides, from three costs the design names: CodeMirror's mount and first paint at N rules, the `postMessage` of the emitted string, and `tmScratch(src)`'s parse time.

**Pre-registered candidate: 20,000 rules.** It clears `list20`'s rule count with headroom and refuses `list60`'s. **Measure the RULE counts rather than assuming the line counts stand in for them** — `Σ states[i].rules.length` is the gated quantity and runs about 26% below the δ-table's row count, which is states and rules together. **Record the readings whether or not they move it**, and if they do move it, ship the measured figure and say what the candidate missed. A pre-registered threshold that is missed and shipped anyway is this project's own recorded failure mode — see the roadmap's region-path-tagging entry — so a miss must be stated, not smoothed.

- [ ] **Step 1: Write the probe**

Create `web/tests/browser/tm-fork-cost.test.ts`. Model its shape on `web/tests/browser/buffer-affordability.test.ts` — that file is the house pattern for a probe that is a test file but is not part of the suite, including how it reads `REDEXTAPE_PROBE` and how it reports.

```ts
import { describe, expect, it } from 'vitest'

/**
 * **A PROBE, NOT A TEST — IT PRINTS AND ASSERTS ALMOST NOTHING.** It runs only under
 * `REDEXTAPE_PROBE=1`, like `buffer-affordability.test.ts`, because it exists to produce the number
 * `MAX_FORK_RULES` is set from rather than to defend one.
 *
 * **THE THREE COSTS ARE MEASURED SEPARATELY BECAUSE THEY HAVE DIFFERENT REMEDIES.** A slow
 * `postMessage` argues for a smaller cap; a slow CodeMirror mount argues for a smaller cap; a slow
 * `tmScratch` parse argues for nothing this slice can change, and if it dominates then the cap is
 * being set by a cost the user pays once and the other two should decide it.
 */
const PROBE = process.env.REDEXTAPE_PROBE === '1'

const PROGRAMS: readonly { name: string; src: string }[] = [
  { name: 'sample', src: 'let x = 40; x + 2' },
  { name: 'list2', src: '[1, 2]' },
  { name: 'while4', src: 'let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc' },
  { name: 'sum5', src: 'fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)' },
  { name: 'list20', src: `[${Array.from({ length: 20 }, (_, i) => i + 1).join(', ')}]` },
  { name: 'list60', src: `[${Array.from({ length: 60 }, (_, i) => i + 1).join(', ')}]` },
]

describe.runIf(PROBE)('TM fork cost', () => {
  it('prices emit, postMessage, parse and editor mount across the corpus', async () => {
    const init = await import('../../../pkg/redextape_wasm.js')
    await init.default()

    const rows: string[] = []
    for (const { name, src } of PROGRAMS) {
      const compiled = init.compile(src, 'unary')
      const session = compiled.session
      if (session === null || session === undefined) {
        rows.push(`${name.padEnd(8)} no session`)
        continue
      }
      const program = session.tmProgram()
      if (program === null || program === undefined) {
        rows.push(`${name.padEnd(8)} TM leg declined`)
        continue
      }
      const rules = program.states.reduce((n: number, s: { rules: unknown[] }) => n + s.rules.length, 0)

      const t0 = performance.now()
      const text = session.tmText() as string
      const emitMs = performance.now() - t0

      // postMessage cost, measured as a real structured clone through a MessageChannel rather than
      // as a string length: the clone is what the app actually pays, once in each direction.
      const clone = await new Promise<number>((resolve) => {
        const ch = new MessageChannel()
        const start = performance.now()
        ch.port2.onmessage = () => resolve(performance.now() - start)
        ch.port1.postMessage({ kind: 'tm-scratch', gen: 1, src: text })
      })

      const t1 = performance.now()
      const made = init.tmScratch(text)
      const parseMs = performance.now() - t1
      made.scratch?.free?.()

      rows.push(
        `${name.padEnd(8)} rules=${String(rules).padStart(7)} bytes=${String(text.length).padStart(8)} ` +
          `emit=${emitMs.toFixed(1)}ms clone=${clone.toFixed(1)}ms parse=${parseMs.toFixed(1)}ms`
      )
      session.free?.()
    }
    console.log(`\n${rows.join('\n')}\n`)
    expect(rows.length).toBe(PROGRAMS.length)
  }, 600_000)
})
```

Adjust the wasm import path and the `init`/`free` idiom to match `buffer-affordability.test.ts` exactly — that file is the authority on how `pkg/` is loaded in this tier.

- [ ] **Step 2: Add the script**

In `web/package.json`:

```json
    "test:probe:tm": "REDEXTAPE_PROBE=1 vitest run --project browser tests/browser/tm-fork-cost.test.ts",
```

- [ ] **Step 3: Build the wasm package and run the probe**

```bash
cd web && pnpm run build:wasm && cd ..
export PATH="/usr/sbin:$PATH"    # Chrome is off-PATH on this machine
cd web && pnpm run test:probe:tm 2>&1 | tee /tmp/claude-1000/-home-davey-projects-redextape/*/scratchpad/tm-fork-cost.txt
```

Expected: a six-row table. **Run it three times** and record all three, because runner variance on this machine is large enough that a single reading measures cache state.

If `wasm-pack` fails with a `404` and a `SIGKILL`, that is the known chromedriver-version mismatch, not an OOM — it fetches the latest chromedriver rather than a matching one.

- [ ] **Step 4: Choose the figure and write it down**

Pick the largest round rule count whose emit + clone + parse total stays under **250 ms** — the interaction budget for a gesture the user initiated and is waiting on — and whose CodeMirror mount in Task 8 will be checked against the same bar.

Record in the task report: the three runs, the chosen figure, and **whether it matches the pre-registered 20,000**. If it does not, say by how much and which of the three costs moved it.

- [ ] **Step 5: Commit**

```bash
git add web/tests/browser/tm-fork-cost.test.ts web/package.json
git commit -m "5d-iv T2: the probe that prices a TM fork, and the figure it sets MAX_FORK_RULES to"
```

---

### Task 3: `MAX_FORK_RULES`, `ruleCount`, `forkable`, and `tmText` on `compiled`

**Files:**
- Modify: `web/src/types.ts` — add `TmScratchStatus`
- Modify: `web/src/protocol.ts` — add the constant, the two functions, and the `compiled` field
- Modify: `web/src/session-worker.ts` — attach `tmText` to the `compiled` reply
- Test: `web/tests/node/protocol.test.ts`

**Interfaces:**
- Consumes: Task 1's `session.tmText()`; Task 2's measured figure.
- Produces:
  - `export const MAX_FORK_RULES: number` (`web/src/protocol.ts`)
  - `export function ruleCount(p: TmProgram): number`
  - `export function forkable(p: TmProgram | null): p is TmProgram`
  - `export type TmScratchStatus = { available: boolean; reason: string; width: number | null; run: RunStatus | null; header: boolean }` (`web/src/types.ts`)
  - `compiled` reply gains `tmText: string | null`

**Why the predicate is here and not in the worker:** §4.2. `vite.config.ts` excludes `session-worker.ts` from the coverage include set, so *"logic placed there moves none of the four numbers"*. The worker holds the wasm call and the branch; the arithmetic lives where a test can drive it without a thread. It is also the function the main thread calls to word the refusal, so the decision and the message cannot disagree about the count.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/node/protocol.test.ts`:

```ts
import { forkable, MAX_FORK_RULES, ruleCount } from '../../src/protocol'
import type { TmProgram } from '../../src/types'

/** A program with exactly `n` rules, spread over ten states so the reduce has something to reduce. */
function programOf(n: number): TmProgram {
  const states = Array.from({ length: 10 }, (_, i) => ({
    name: `q${i}`,
    accept: false,
    rules: [] as TmProgram['states'][number]['rules'],
  }))
  for (let i = 0; i < n; i++) {
    states[i % 10].rules.push({ read: [null], write: [null], moves: ['S'], next: 0 })
  }
  return { states, alphabet: ['_'], tapes: 1, width: 4, start: 0 }
}

describe('the fork cap', () => {
  it('counts every rule across every state, not the states', () => {
    expect(ruleCount(programOf(0))).toBe(0)
    expect(ruleCount(programOf(1))).toBe(1)
    expect(ruleCount(programOf(37))).toBe(37)
  })

  it('admits a program at the cap and refuses one rule past it', () => {
    expect(forkable(programOf(MAX_FORK_RULES - 1))).toBe(true)
    expect(forkable(programOf(MAX_FORK_RULES))).toBe(true)
    expect(forkable(programOf(MAX_FORK_RULES + 1))).toBe(false)
  })

  /**
   * A DECLINED LEG IS NOT FORKABLE, AND THE `null` ARM IS WHY THE PREDICATE TAKES A NULLABLE.
   * `compiled` carries `tmProgram: TmProgram | null`, so every caller would otherwise write the same
   * null check beside every call — which is the second place for it to be wrong.
   */
  it('refuses a null program without the caller checking', () => {
    expect(forkable(null)).toBe(false)
  })

  /**
   * THE CAP MUST SIT BETWEEN THE TWO CORPUS PROGRAMS THE DESIGN NAMES (§3.1), AND THIS ASSERTS THE
   * PROPERTY RATHER THAN THE NUMBER. A future re-measurement may move `MAX_FORK_RULES`; moving it
   * outside this interval would silently change which demo programs can be forked at all, which is
   * the fact the figure exists to control.
   */
  it('sits between list20 and list60', () => {
    // **THESE BOUNDS WERE IN THE WRONG UNIT UNTIL TASK 2 MEASURED THEM.** They read 16,250 and 127,881 —
    // list20's LINE count and list60's δ-table ROW count. A row is a state OR a rule (list60 is 33,699
    // states + 94,182 rules = 127,881 exactly), and this constant gates on rules alone.
    expect(MAX_FORK_RULES).toBeGreaterThan(11_802) // list20's rules — must be forkable
    expect(MAX_FORK_RULES).toBeLessThan(94_182) // list60's rules — must be refused
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm exec vitest run --project node tests/node/protocol.test.ts
```

Expected: FAIL — `No "forkable" export is defined on the module`.

- [ ] **Step 3: Add `TmScratchStatus` to `types.ts`**

Beside the existing `TmStatus`:

```ts
/**
 * A `TmScratch`'s status — **five fields, and the missing one is the point**.
 *
 * NO `total_steps`. `Session.tmStatus` reports one from the run `compile` performed; a scratch is
 * stepped rather than described-run, so any value here would be invented. The Rust side pins this by
 * an exhaustive destructuring, so a sixth field fails to compile there with `E0027` — this type is the
 * wire's copy of that shape and must be edited in step with it.
 *
 * `header` IS THE FIELD `TmStatus` HAS NO COUNTERPART FOR. `false` means the text carried no header,
 * so the machine runs from blank tapes at `MIN_FIELD_WIDTH` — explicitly not an error, and a fact the
 * pane must surface rather than let the user assume they are watching the machine they pasted.
 */
export type TmScratchStatus = {
  available: boolean
  reason: string
  width: number | null
  run: RunStatus | null
  header: boolean
}
```

- [ ] **Step 4: Add the constant and the two functions to `protocol.ts`**

```ts
/**
 * The largest machine, in δ rules, that may be opened in an editor.
 *
 * **MEASURED (5d-iv T2), NOT CHOSEN.** Emit, structured clone and `tmScratch` parse were priced across
 * the corpus; this is the largest round count whose three costs total under the 250 ms an initiated
 * gesture may take. `list20` is **11,802 rules** and clears it; `list60` is **94,182** and does not.
 * **Those are RULE counts. An earlier draft quoted 16,250 and 127,881 — list20's LINES and list60's
 * δ-table ROWS. A row is a state or a rule: 33,699 states + 94,182 rules is where 127,881 comes from.**
 *
 * **RULES RATHER THAN BYTES, BECAUSE THE COUNT IS ANSWERABLE BEFORE ANYTHING IS EMITTED.** `TmProgram`
 * is projected once per compile and both threads hold it, so the refusal costs a reduce rather than a
 * 7.8 MB allocation that is then discarded. Bytes per rule is stable at 55-61 across a 280x range, so
 * a rule bound is a byte bound within about ten percent.
 *
 * **AND IT IS A REFUSAL, NEVER A TRUNCATION, WHICH IS WHERE THIS DIVERGES FROM `LAMBDA_BYTE_BUDGET`.**
 * A truncated term is still a readable term and that budget trims and shows it. A truncated `.tm` file
 * is not a machine: it either fails to parse or parses into a different one, missing its tail states.
 */
export const MAX_FORK_RULES = 20_000 // ← replace with Task 2's measured figure

/** How many δ rules a projected machine has, summed across its states. */
export function ruleCount(p: TmProgram): number {
  return p.states.reduce((n, s) => n + s.rules.length, 0)
}

/**
 * Whether this machine may be forked into an editable buffer.
 *
 * A TYPE PREDICATE, so a caller that passes the check has a non-null `TmProgram` without a second
 * check. `compiled` carries `tmProgram: TmProgram | null` and every consumer would otherwise repeat
 * the null test beside this one.
 */
export function forkable(p: TmProgram | null): p is TmProgram {
  return p !== null && ruleCount(p) <= MAX_FORK_RULES
}
```

- [ ] **Step 5: Add the field to the `compiled` reply**

In the `RunReply` union's `compiled` arm, beside `tmProgram`:

```ts
      /**
       * This session's machine as `.tm` text, or `null` when there is no TM leg or the machine is over
       * `MAX_FORK_RULES`.
       *
       * **IT RIDES THIS REPLY FOR `linkIndex`'s REASON, AND THE CAP IS WHAT MAKES THAT AFFORDABLE.**
       * A lazy fetch on first click costs a round trip into a worker measured starved for 4,679 ms
       * during recording, which is exactly when a user reaches for a fork. Eager and unbounded would
       * post 7.8 MB on every `list60` compile whether or not anyone ever forks; eager and capped costs
       * at most `MAX_FORK_RULES` rules of text.
       *
       * **`null` IS THE ONLY FACT BEHIND THE REFUSAL.** There is no `canFork` boolean beside it: a
       * second encoding of one fact is how a control comes to be offered for a fork that cannot happen.
       * The pane words its refusal from `ruleCount(tmProgram)`, so the decision and the message read
       * the same object.
       */
      tmText: string | null
```

- [ ] **Step 6: Attach it in the worker**

In `web/src/session-worker.ts`'s `onRun`, where the `compiled` reply is assembled, add the gate immediately after the program is obtained:

```ts
  // THE GATE, AND THE ONLY LOGIC IN THIS FILE THAT IS NOT A WASM CALL — `forkable` is imported from
  // `protocol.ts` precisely so it is not written here, where the coverage gate cannot see it.
  const tmText = forkable(tmProgram) ? (session.tmText() as string | null) : null
```

**THIS LINE WAS WRONG WHEN THIS PLAN WAS WRITTEN AND TASK 1's REVIEW CAUGHT IT.** `as string | null` is a
TypeScript type ASSERTION: it changes what the compiler believes and converts nothing at run time. Task 1
originally exported `tm_text` as a bare `Option<String>`, and `#[wasm_bindgen]`'s native ABI marshals `None`
as **`undefined`**, not `null` — the crate's `serialize_missing_as_null(true)` is configured only on the
`to_value` helper, which that method never called. The generated `.d.ts` said `tmText(): string | undefined`
directly beneath a doc comment claiming `string | null`.

**Task 1's fix round makes the boundary deliver `null`**, by returning `JsValue` and matching
`None => JsValue::NULL` — this file's own established idiom. So by the time you read this the assertion is
true, and it stays an assertion rather than a conversion **on purpose**: if the boundary ever regresses, a
`?? null` here would silently paper over it, where the assertion leaves `protocol.ts`'s `string | null` as a
claim the wasm side must keep. Do not add a `??`.

```ts
  // (the line above, in context)
```

and put `tmText` on the posted object. Import `forkable` from `./protocol` alongside the constants that file already imports from there.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd web && pnpm exec vitest run --project node tests/node/protocol.test.ts && pnpm run typecheck
```

Expected: the four new tests PASS; `tsc --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/types.ts web/src/protocol.ts web/src/session-worker.ts web/tests/node/protocol.test.ts
git commit -m "5d-iv T3: the fork cap, its predicate, and tmText on the compiled reply"
```

---

### Task 4: The `tm-scratch` request, the `tm-scratch-compiled` reply, and the worker arm

**Files:**
- Modify: `web/src/protocol.ts` — the request variant and the reply variant
- Modify: `web/src/session-client.ts` — a `tmScratch` method
- Modify: `web/src/session-worker.ts` — `onTmScratch` and its dispatch branch
- Test: `web/tests/node/session-client.test.ts`

**Interfaces:**
- Consumes: Task 3's `TmScratchStatus`.
- Produces:
  - request `{ kind: 'tm-scratch'; gen: number; src: string }`
  - reply `{ kind: 'tm-scratch-compiled'; gen: number; tm: TmScratchStatus; tmProgram: TmProgram }`
  - `SessionClient.tmScratch(gen: number, src: string): void`

**Why the request has neither `step` nor `encoding`:** §4.4. A machine has no step-*k* term to replay to — its `.tm` text *is* the machine. And an encoding says how a value is decoded, decoding is type-directed, and a `TmScratch` has no `ty`; `tmValue`, `sourceSpan` and `linkIndex` are absent from the type, proved by method resolution in `crates/redextape-wasm/tests/browser.rs`.

**Why the reply is a new arm rather than `scratch-compiled` widened:** `TmScratchStatus` is a different type from `LambdaStatus`, so reuse would mean a union inside the arm and a switch in every consumer to open it. And `tmProgram` is **not nullable here** — `session.rs` records that *"there is no absent-leg case: a `TmScratch` exists only for text that parsed to a machine"* — where on `compiled` it is. Text that did not parse takes `no-session`, exactly as it does for λ.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/node/session-client.test.ts`, following that file's existing fake-port idiom:

```ts
describe('tmScratch', () => {
  it('posts a tm-scratch request carrying only the text', () => {
    const { client, posted } = makeClient() // whatever this file's existing helper is called
    const gen = client.supersede()
    client.tmScratch(gen, 'tapes 1\nstart q0\nstate q0:\n')
    expect(posted).toEqual([{ kind: 'tm-scratch', gen, src: 'tapes 1\nstart q0\nstate q0:\n' }])
  })

  /**
   * SAME STALE-GENERATION GUARD AS `scratch`, ASSERTED RATHER THAN ASSUMED. A request posted under a
   * superseded generation is a message the worker will answer into a pane that has moved on — the
   * shape `supersede` exists to prevent, and a new method that forgot the guard would reopen it.
   */
  it('drops a request whose generation has been superseded', () => {
    const { client, posted } = makeClient()
    const stale = client.supersede()
    client.supersede()
    posted.length = 0
    client.tmScratch(stale, 'tapes 1\n')
    expect(posted).toEqual([])
  })
})
```

Read the top of `web/tests/node/session-client.test.ts` and reuse its actual helper name and shape rather than introducing `makeClient` if it is called something else.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm exec vitest run --project node tests/node/session-client.test.ts
```

Expected: FAIL — `client.tmScratch is not a function`.

- [ ] **Step 3: Add the request variant**

In `protocol.ts`'s `RunRequest` union, after `lambda-scratch`:

```ts
  /**
   * Build a TM scratchpad from `.tm` TEXT and open a cursor on it — 5d-iv design §4.4.
   *
   * **NO `step`, UNLIKE `lambda-scratch`.** That request carries one because a λ fork replays the
   * source term to the frame the pane was showing. A machine has no step-k term: its text IS the
   * machine, and the scratch starts from its header's initial configuration. A `step` here would be a
   * field with no reader on either side.
   *
   * **NO `encoding`, FOR `lambda-scratch`'s OWN REASON.** An encoding says how a VALUE is decoded,
   * decoding is type-directed, and a `TmScratch` has no `ty` — `tmValue`, `sourceSpan` and `linkIndex`
   * are absent from the type rather than declining.
   *
   * **THIS IS THE VARIANT THE COMMENT ON `lambda-scratch` PROMISED.** That doc said a `tm-scratch`
   * variant was absent "because nothing could send it" and would land "with the surface that can send
   * it". That surface is 5d-iv's TM pane, and this is that landing.
   */
  | { kind: 'tm-scratch'; gen: number; src: string }
```

**Edit `lambda-scratch`'s doc in the same commit** to remove the paragraph promising this variant's absence — it is a claim about the present and it stops being true here. Replace it with one sentence pointing at the new variant.

- [ ] **Step 4: Add the reply variant**

In `RunReply`, after `scratch-compiled`:

```ts
  /**
   * A TM scratch was built — 5d-iv design §4.4, and `scratch-compiled`'s counterpart rather than a
   * widening of it.
   *
   * **A SEPARATE ARM BECAUSE THE PAYLOADS SHARE NO FIELD.** `scratch-compiled` carries a
   * `LambdaStatus` and the text the fork was built from; this carries a `TmScratchStatus` — five
   * fields, no `total_steps` — and a machine. Folding them would put a union inside the arm and a
   * switch in every consumer to open it.
   *
   * **`tmProgram` IS NOT NULLABLE HERE, WHERE IT IS ON `compiled`.** A `TmScratch` exists only for text
   * that parsed to a machine, so the δ-table always has a program to render; text that did not parse
   * takes `no-session`, carrying the diagnostics, exactly as it does for λ.
   *
   * **AND THERE IS NO `text` ECHO.** λ needs one because the worker computes the term at step k and
   * the main thread has never seen it. Here the main thread SENT the text, so echoing it would return
   * up to `MAX_FORK_RULES` rules of string to the sender that already holds it.
   */
  | { kind: 'tm-scratch-compiled'; gen: number; tm: TmScratchStatus; tmProgram: TmProgram }
```

- [ ] **Step 5: Add the client method**

In `web/src/session-client.ts`, beside `scratch`:

```ts
  /** Build a TM scratchpad from `.tm` text. No step: a machine's text IS the machine (§4.4). */
  tmScratch(gen: number, src: string): void {
    if (gen !== this.#gen) return
    this.#port.postMessage({ kind: 'tm-scratch', gen, src })
  }
```

- [ ] **Step 6: Add the worker arm**

In `web/src/session-worker.ts`, add to the `live` union `| { gen: number; kind: 'tm-scratch'; session: TmScratchHandle }`, then:

```ts
/**
 * Build a `TmScratch` from `.tm` text and record its run — `onLambdaScratch`'s counterpart.
 *
 * NO `linkIndex`, NO `tapeNames`, NO `result` AFTER IT, for `onLambdaScratch`'s reasons: all three read
 * something a scratch type does not have. It DOES post a `tmProgram`, which is where the two differ —
 * a `TmScratch` has a machine and a `LambdaScratch` has none.
 *
 * IT DOES NOT `await recordLambda`. A `TmScratch` has one leg; calling it to be told so at its own
 * `kind` guard would be a line asserting the absence rather than respecting it.
 */
async function onTmScratch(req: Extract<RunRequest, { kind: 'tm-scratch' }>): Promise<void> {
  await ready
  dropLive()
  recorded.lambda = 0
  recorded.tm = 0
  allowance.lambda = HISTORY_BYTES
  allowance.tm = HISTORY_BYTES
  recording.lambda = false
  recording.tm = false

  const { diagnostics, scratch } = tmScratch(req.src) as TmScratchResult
  if (scratch === null) {
    ctx.postMessage({ kind: 'no-session', gen: req.gen, diagnostics })
    return
  }
  // Deliberate silence on the same race `onLambdaScratch` and `onRun` both name: a newer request
  // landed while the uninterruptible parse was in flight. This scratch was never posted anywhere, so
  // freeing it and returning is the whole cleanup.
  if (latest !== req.gen) {
    scratch.free()
    return
  }
  live = { gen: req.gen, kind: 'tm-scratch', session: scratch }

  // DIAGNOSTICS ARE NOT DROPPED HERE, UNLIKE `onLambdaScratch`, AND THE DIFFERENCE IS REAL. That
  // function's `diagnostics` on a non-null scratch come from reparsing its own printed output, so they
  // are always empty. These come from parsing text a USER typed, and `parse_tm_full` can return a
  // machine alongside warnings — a headerless file is the ordinary case. They ride the `diagnostics`
  // reply the editor already consumes.
  if (diagnostics.length > 0) ctx.postMessage({ kind: 'diagnostics', gen: req.gen, diagnostics })
  ctx.postMessage({
    kind: 'tm-scratch-compiled',
    gen: req.gen,
    tm: scratch.tmStatus(),
    tmProgram: scratch.tmProgram(),
  })
  await recordTm(req.gen, true)
}
```

Then add the dispatch branch beside the existing three:

```ts
    } else if (req.kind === 'tm-scratch') {
      await onTmScratch(req)
```

Check `recordTm`'s actual signature and the `diagnostics` reply's actual shape before writing these two lines — match what `onRun` already does rather than the sketch above.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd web && pnpm exec vitest run --project node tests/node/session-client.test.ts && pnpm run typecheck
```

Expected: both new tests PASS; `tsc --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/protocol.ts web/src/session-client.ts web/src/session-worker.ts web/tests/node/session-client.test.ts
git commit -m "5d-iv T4: the tm-scratch request, its reply, and the worker arm that answers it"
```

---

### Task 5: `ScratchBuffers` learns the leg

**Files:**
- Modify: `web/src/scratch.ts` — `BufferState`, `fork`, `#spawn`, `snapshot`, `restore`, `BufferInfo`
- Test: `web/tests/node/scratch.test.ts`

**Interfaces:**
- Consumes: Task 4's `SessionClient.tmScratch`.
- Produces:
  - `BufferState` and `BufferInfo` gain `readonly leg: Leg`
  - `ScratchBuffers.fork(slot, src, step, leg)` — **`leg` is the new fourth parameter**
  - `ScratchBuffers.forkBlank(leg: Leg): SessionId` — mints a warm buffer with empty text and binds no pane

**Why one class and one cap:** §3.3. `MAX_WARM_BUFFERS` counts threads, each paying the 8,454,144-byte wasm module baseline; 5d-i measured a `TmScratch`'s marginal linear memory at **0** against a `LambdaScratch`'s 65,536, and `HISTORY_BYTES` is already per leg. Two caps of 11 would double the bound 5d-ii-d's probe exists to establish, silently, by adding a leg.

**Why one id space:** §4.5. `buffers-store.ts`'s `mintedIndex` parses `/^scratch-(\d+)$/`, and one counter is what extends *"a retired buffer's name is not reissued"* — and its cross-reload widening — to both legs for free. **The leg shows in the label, not the id.**

- [ ] **Step 1: Write the failing test**

Add to `web/tests/node/scratch.test.ts`, using that file's existing real-registry-real-pool-fake-port harness:

```ts
describe('two legs, one collection', () => {
  /**
   * **POOL SIZE IS THE AXIS, NOT RENDERING** — 5d-i's rule, restated for the leg. A test driven
   * through the DOM cannot see how many threads exist, and "one cap across both legs" is a claim about
   * threads.
   */
  it('spends one shared seat per warm buffer whichever leg it is', () => {
    const { buffers, slotOf } = harness()
    for (let i = 0; i < MAX_WARM_BUFFERS; i++) {
      buffers.fork(slotOf(), 'text', 0, i % 2 === 0 ? 'lambda' : 'tm')
    }
    expect(buffers.warmCount()).toBe(MAX_WARM_BUFFERS)
    expect(() => buffers.fork(slotOf(), 'text', 0, 'tm')).toThrow(BufferCapReached)
    expect(() => buffers.fork(slotOf(), 'text', 0, 'lambda')).toThrow(BufferCapReached)
  })

  it('sends lambda-scratch for a lambda buffer and tm-scratch for a tm one', () => {
    const { buffers, slotOf, postedTo } = harness()
    const l = buffers.fork(slotOf(), 'lambda text', 3, 'lambda')
    const t = buffers.fork(slotOf(), 'tm text', 0, 'tm')
    expect(postedTo(l)).toEqual([{ kind: 'lambda-scratch', gen: 1, src: 'lambda text', step: 3 }])
    expect(postedTo(t)).toEqual([{ kind: 'tm-scratch', gen: 1, src: 'tm text' }])
  })

  /**
   * ONE COUNTER ACROSS BOTH LEGS, WHICH IS WHAT KEEPS `mintedIndex`'s `scratch-N` FORM AND THE
   * NEVER-REISSUED GUARANTEE. Two counters would mint `scratch-1` twice.
   */
  it('mints from one id space and puts the leg in the label', () => {
    const { buffers, slotOf } = harness()
    expect(buffers.fork(slotOf(), 'a', 0, 'lambda')).toBe('scratch-1')
    expect(buffers.fork(slotOf(), 'b', 0, 'tm')).toBe('scratch-2')
    const rows = buffers.list()
    expect(rows.map((r) => r.leg)).toEqual(['lambda', 'tm'])
    expect(rows[0].label).toContain('1')
    expect(rows[1].label).toContain('2')
    expect(rows[0].label).not.toBe(rows[1].label)
  })

  it('mints a blank tm buffer with no pane bound to it', () => {
    const { buffers, postedTo } = harness()
    const id = buffers.forkBlank('tm')
    expect(buffers.warmCount()).toBe(1)
    expect(postedTo(id)).toEqual([{ kind: 'tm-scratch', gen: 1, src: '' }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm exec vitest run --project node tests/node/scratch.test.ts
```

Expected: FAIL — `Expected 3 arguments, but got 4` from `tsc`, or a runtime failure on `buffers.forkBlank`.

- [ ] **Step 3: Add `leg` to the state and the row**

```ts
type BufferState = {
  readonly id: SessionId
  readonly label: string
  /**
   * Which leg this buffer's session has — 5d-iv design §4.5.
   *
   * **THE FACT THIS COLLECTION HAD NO WAY TO RECORD.** `#buffers`' own doc states the gap it fills:
   * "`detached` is a property of a session and cannot distinguish a λ buffer from a future
   * `TmScratch`; nothing else in an entry records provenance."
   *
   * IT SELECTS THE REQUEST KIND IN `#spawn` AND THE LEG RECORD BESIDE IT, and it is what a pane's
   * binding must agree with — `SessionRegistry.legOf` throws on a binding naming a leg its session
   * lacks, and this is the field that decides which leg the session was built with.
   */
  readonly leg: Leg
  text: string
  collapsed: boolean
  warm: boolean
}

export type BufferInfo = { readonly id: SessionId; readonly label: string; readonly warm: boolean; readonly leg: Leg }
```

Add `leg: b.leg` to whatever builds `BufferInfo` inside `list()`.

- [ ] **Step 4: Branch `#spawn`**

Replace the `legs` record and the trailing post:

```ts
  #spawn(state: BufferState, src: string, step: number): void {
    const client = this.#pool.bind(state.id, (reply) => this.#onReply(state.id, reply))
    // NOT AVAILABLE YET, WITH A REASON A PANE CAN READ — unchanged in intent from the λ-only version;
    // what changed is WHICH leg gets it. A session holds at most one leg per `Leg`, and this is where
    // that is decided for a buffer.
    const pending = { available: false, reason: 'building…' }
    const legs =
      state.leg === 'lambda'
        ? { lambda: { hist: new History<LambdaState>(this.#bytes), status: pending, done: null, timer: null } }
        : { tm: { hist: new History<TmState>(this.#bytes), status: pending, done: null, timer: null } }
    this.#reg.add({
      id: state.id,
      label: state.label,
      detached: true,
      client,
      legs,
      // **`null` AT CONSTRUCTION FOR BOTH LEGS, AND THE REASON IS NOT THE SAME FOR BOTH.** A λ buffer
      // never gets a machine at all. A TM buffer gets one from its `tm-scratch-compiled` reply, which
      // `replies.ts` writes here — the same route `compiled` takes for the source session. What is
      // shared is only that neither has one YET.
      tmProgram: null,
    })
    state.warm = true
    // SUPERSEDE THEN POST, unchanged: a fresh client is at generation 0, which matches nothing, so the
    // claim has to happen before the post or the request would drop its own message.
    const gen = client.supersede()
    if (state.leg === 'lambda') client.scratch(gen, src, step)
    else client.tmScratch(gen, src)
  }
```

The `tmProgram: null` comment above **replaces** the existing "NO MACHINE, EVER" paragraph, which is true of a λ buffer and false of a TM one.

- [ ] **Step 5: Thread `leg` through `fork` and add `forkBlank`**

```ts
  fork(slot: Detachable, src: string, step: number, leg: Leg): SessionId {
    if (this.warmCount() >= MAX_WARM_BUFFERS) this.#refuseAtCap('fork failed — ')
    return this.#mint(src, step, leg, slot)
  }

  /**
   * Mint a warm, EMPTY buffer on `leg` and bind no pane to it — 5d-iv design §4.7's second gesture.
   *
   * **A SECOND METHOD RATHER THAN A NULLABLE `slot` ON `fork`, BECAUSE THEY ARE TWO INTENTIONS.** A
   * fork detaches a pane onto a copy of what it was showing; this makes somewhere to paste a `.tm`
   * file into. Folding them would give `fork` a parameter whose null case means something the name
   * does not say.
   *
   * NO PREFIX ON THE REFUSAL — this is not a fork, so `#refuseAtCap`'s call-site prefix argument puts
   * it in the same class as `warm`.
   */
  forkBlank(leg: Leg): SessionId {
    if (this.warmCount() >= MAX_WARM_BUFFERS) this.#refuseAtCap('')
    return this.#mint('', 0, leg, null)
  }

  /** What `fork` and `forkBlank` share: mint the name, spawn the thread, record it, bind if asked. */
  #mint(src: string, step: number, leg: Leg, slot: Detachable | null): SessionId {
    this.#minted += 1
    const id: SessionId = `scratch-${this.#minted}`
    const label = leg === 'lambda' ? `λ scratch ${this.#minted}` : `TM scratch ${this.#minted}`
    const state: BufferState = { id, label, leg, text: src, collapsed: false, warm: false }
    this.#spawn(state, src, step)
    this.#buffers.set(id, state)
    slot?.rebind(id)
    return id
  }
```

- [ ] **Step 6: Carry `leg` through `snapshot` and `restore`**

Add `leg: b.leg` to `snapshot`'s mapped object, and `leg: b.leg` to the `BufferState` `restore` reconstructs.

- [ ] **Step 7: Fix the call sites**

`transport.ts`'s detach handler calls `scratchpad.fork(slot, wiring.index.lambdaText, step)`. Add `'lambda'` as the fourth argument. `tsc --noEmit` finds every other one.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd web && pnpm exec vitest run --project node tests/node/scratch.test.ts && pnpm run typecheck
```

Expected: the four new tests PASS, every pre-existing test in that file still passes, `tsc` clean.

- [ ] **Step 9: Commit**

```bash
git add web/src/scratch.ts web/src/transport.ts web/tests/node/scratch.test.ts
git commit -m "5d-iv T5: one buffer collection, two legs, one shared cap"
```

---

### Task 6: `leg` survives a reload

**Files:**
- Modify: `web/src/buffers-store.ts` — `PersistedBuffer`, `validBuffer`, `BUFFERS_VERSION`
- Test: `web/tests/node/buffers-store.test.ts`

**Interfaces:**
- Consumes: Task 5's `BufferState.leg`.
- Produces: `PersistedBuffer` gains `leg: Leg`; `BUFFERS_VERSION` becomes `2`.

**Why a version bump and no migration:** a mismatch already returns `null` and the caller already knows what "no buffers" looks like. `parseBuffers`' own doc: a failed read *"is indistinguishable from a first visit, and a banner on every load after a schema bump is worse than what it reports."* A v1 payload has no `leg` on any buffer, and inventing `'lambda'` for it would restore a TM buffer as a λ one on the next page — a wrong state, which is exactly what `validBuffer` rejects rather than repairs.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/node/buffers-store.test.ts`:

```ts
describe('the leg survives a reload', () => {
  it('round-trips a leg per buffer', () => {
    const value: PersistedBuffers = {
      minted: 2,
      buffers: [
        { id: 'scratch-1', label: 'λ scratch 1', leg: 'lambda', text: '\\x. x', collapsed: false },
        { id: 'scratch-2', label: 'TM scratch 2', leg: 'tm', text: 'tapes 1\n', collapsed: true },
      ],
      bindings: {},
    }
    expect(parseBuffers(serializeBuffers(value))).toEqual(value)
  })

  /**
   * **A v1 PAYLOAD IS DROPPED RATHER THAN DEFAULTED, AND THAT IS THE DECISION.** Every v1 buffer was a
   * λ buffer in fact, so `leg: 'lambda'` would be a correct guess today — and a migration that guesses
   * is a migration the next schema change has to keep guessing through. `parseBuffers` already treats
   * a version mismatch as a first visit, silently, which is a state the app handles exactly.
   */
  it('drops a v1 payload', () => {
    const v1 = JSON.stringify({
      version: 1,
      minted: 1,
      buffers: [{ id: 'scratch-1', label: 'scratch 1', text: 'x', collapsed: false }],
      bindings: {},
    })
    expect(parseBuffers(v1)).toBeNull()
  })

  it('rejects a v2 buffer whose leg is not a leg', () => {
    const bad = JSON.stringify({
      version: 2,
      minted: 1,
      buffers: [{ id: 'scratch-1', label: 'x', leg: 'asm', text: 'x', collapsed: false }],
      bindings: {},
    })
    expect(parseBuffers(bad)).toBeNull()
  })

  it('rejects a v2 buffer with no leg at all', () => {
    const bad = JSON.stringify({
      version: 2,
      minted: 1,
      buffers: [{ id: 'scratch-1', label: 'x', text: 'x', collapsed: false }],
      bindings: {},
    })
    expect(parseBuffers(bad)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm exec vitest run --project node tests/node/buffers-store.test.ts
```

Expected: FAIL — the round-trip test fails because `leg` is stripped, and the v1 test fails because version 1 is still current.

- [ ] **Step 3: Bump the version and widen the type**

```ts
/**
 * **2 SINCE 5d-iv: `PersistedBuffer` GAINED `leg`.** A v1 payload has no leg on any buffer and is
 * dropped rather than defaulted — every v1 buffer really was a λ buffer, so `'lambda'` would be a
 * correct guess today and a guess the next schema change would have to keep making.
 */
export const BUFFERS_VERSION = 2

export type PersistedBuffer = {
  id: SessionId
  label: string
  /** Which leg this buffer's session is rebuilt on. Without it a restored TM buffer comes back as λ. */
  leg: Leg
  text: string
  collapsed: boolean
}
```

- [ ] **Step 4: Validate it**

In `validBuffer`, beside the existing checks:

```ts
  // AN EXPLICIT MEMBERSHIP TEST AND NOT `typeof n.leg === 'string'`. The hazard this function exists
  // for is a hand-edited `localStorage` entry, and `leg: "asm"` is something a person could plausibly
  // type; it would reach `SessionRegistry.legOf`, which throws.
  if (n.leg !== 'lambda' && n.leg !== 'tm') return false
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd web && pnpm exec vitest run --project node tests/node/buffers-store.test.ts && pnpm run typecheck
```

Expected: the four new tests PASS; every pre-existing test in that file still passes.

- [ ] **Step 6: Commit**

```bash
git add web/src/buffers-store.ts web/tests/node/buffers-store.test.ts
git commit -m "5d-iv T6: a buffer's leg survives a reload, and v1 payloads are dropped"
```

---

### Task 7: `LambdaEditor` becomes `ScratchEditor`, and custody widens

**Files:**
- Rename: `web/src/lambda-editor.ts` → `web/src/scratch-editor.ts`
- Modify: `web/src/editor-custody.ts` — the two concrete types become two structural ones
- Modify: `web/src/lambda-pane.ts`, `web/src/main.ts`, `web/src/replies.ts`, `web/src/transport.ts` — imports and type names
- Modify: `web/tests/browser/lambda-editor.test.ts`, `web/tests/browser/editor-custody.test.ts` — imports
- Test: existing suites; no new behaviour

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class ScratchEditor` with `ScratchEditorConfig` (was `LambdaEditor` / `LambdaEditorConfig`) — **no member changes**
  - `type EditablePane = { setEditor(text: string | null, collapsed?: boolean): void; takeEditor(): ScratchEditor | null; receiveEditor(editor: ScratchEditor): void }`
  - `EditorCustody.homeFor(session): EditablePane | undefined`

**Why no `TmEditor`:** §3.4. The class holds a CodeMirror view, a debounce timer and a `#seeding` flag; its config is `{host, initial, debounceMs, onEdit}`. Its own doc already argued its way out of the only λ-specific candidate: *"NO SYNTAX HIGHLIGHTING, AND THAT IS NOT AN OVERSIGHT… a stale colouring on a buffer being typed into is worse than none."* That argument transfers to `.tm` text unchanged, so the class transfers unchanged.

**Why one custody instance:** §4.6. It is keyed by session and a session has exactly one leg, so one pair of maps covers both without ambiguity. Two instances would put one fact in two containers — the exact split the module's own doc says it was extracted to end.

**This task adds no behaviour.** Every existing test must pass unedited apart from its imports. If a test needs a logic change, stop and report it: that means the rename changed something.

- [ ] **Step 1: Rename the module**

```bash
git mv web/src/lambda-editor.ts web/src/scratch-editor.ts
git mv web/tests/browser/lambda-editor.test.ts web/tests/browser/scratch-editor.test.ts
```

Inside `web/src/scratch-editor.ts`, rename `LambdaEditor` → `ScratchEditor` and `LambdaEditorConfig` → `ScratchEditorConfig`. Update the class doc's opening line from *"THE λ TERM EDITOR"* to name both legs, and **keep the no-highlighting paragraph**, extending it with one sentence: that the same argument is why `.tm` text is uncoloured, and that `print_tm_mapped` exists in `redextape-core` but is not exported, because a colouring computed from a printed machine is stale the instant the user types.

- [ ] **Step 2: Widen custody**

At the top of `web/src/editor-custody.ts`, replace the two concrete imports with:

```ts
import type { ScratchEditor } from './scratch-editor'

/**
 * What custody needs a pane to be able to do — **a shape rather than a class, so both panes satisfy it
 * without either importing the other.**
 *
 * `LambdaPane` and `TmPane` both implement these three; nothing else here depends on which one arrived.
 * A union of the two classes would make this module import both, and a change to either's constructor
 * would reach a file that only ever calls three methods.
 */
export type EditablePane = {
  setEditor(text: string | null, collapsed?: boolean): void
  takeEditor(): ScratchEditor | null
  receiveEditor(editor: ScratchEditor): void
}
```

Then change `hold(session, editor: LambdaEditor)` → `ScratchEditor`, and `homeFor(session): LambdaPane | undefined` → `EditablePane | undefined`, in both the exported type and the factory. **Extend the module doc** with a paragraph recording that it now covers both legs and why one instance is right — the keyed-by-session argument above.

- [ ] **Step 3: Update every importer**

```bash
cd web && pnpm exec tsc --noEmit
```

Fix each error by import path and type name only. Expect `lambda-pane.ts`, `main.ts`, `replies.ts`, `transport.ts` and the two test files.

- [ ] **Step 4: Run the full web suite**

```bash
export PATH="/usr/sbin:$PATH"
cd web && pnpm run build:wasm && pnpm test
```

Expected: **606 passed in 63 files** — the pre-existing figure, unchanged. A different number means this rename changed behaviour; stop and report it.

- [ ] **Step 5: Prove the rename moved no byte of logic**

```bash
git diff --cached -M --stat
```

Expected: `web/src/lambda-editor.ts => web/src/scratch-editor.ts` shown as a rename with a small similarity delta. **Then diff the two comment-stripped bodies through process substitution** — never a `>` redirect, per the `noclobber` hazard the roadmap records, where a gate diffed two stale snapshots and printed `NO CODE CHANGED` for a tree it had not read:

```bash
diff <(git show HEAD:web/src/lambda-editor.ts | sed 's|//.*||' | grep -v '^\s*\*' | grep -v '^\s*/\*' | grep -v '^\s*$') \
     <(sed 's|//.*||' web/src/scratch-editor.ts | grep -v '^\s*\*' | grep -v '^\s*/\*' | grep -v '^\s*$')
```

Expected: only the two identifier renames. Record the full diff in the task report.

- [ ] **Step 6: Commit**

```bash
git add -A web/src web/tests
git commit -m "5d-iv T7: LambdaEditor becomes ScratchEditor, and custody covers both legs"
```

---

### Task 8: The TM pane's split body

**Files:**
- Modify: `web/src/tm-pane.ts` — the editor region, the collapse control, `setEditor`/`takeEditor`/`receiveEditor`, the `header` line
- Modify: `web/src/style.css` — the editor region, reusing the λ pane's rules
- Test: `web/tests/browser/tm-pane-editor.test.ts` (new)

**Interfaces:**
- Consumes: Task 7's `ScratchEditor` and `EditablePane`; Task 3's `TmScratchStatus`.
- Produces: `TmPane` satisfies `EditablePane`; `TmPane.setScratchStatus(s: TmScratchStatus): void`.

**The shape (§4.1):** editor region above, today's tape rows and δ-table below, one collapse control. An attached TM pane is unchanged.

**Two rules carried from 5d-iii, both with recorded reasons.** The collapse is **a class on the pane, not a second rendering mode** — the table renderer below is untouched and never learns it has more room, so there is no second body state for the redraw path to disagree about. And the editor region is **mounted and unmounted, not hidden** — `hidden` leaves a live CodeMirror in the DOM, and a test below asserts that reattaching *removes* it.

- [ ] **Step 1: Write the failing test**

Create `web/tests/browser/tm-pane-editor.test.ts`, modelled on `web/tests/browser/lambda-pane-editor.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { TmPane } from '../../src/tm-pane'

describe('the TM pane editor region', () => {
  it('has no editor until one is set', () => {
    const { pane, host } = mountPane()
    expect(host.querySelector('.cm-editor')).toBeNull()
    pane.setEditor('tapes 1\nstart q0\n')
    expect(host.querySelector('.cm-editor')).not.toBeNull()
  })

  /**
   * REMOVED, NOT HIDDEN — the property `detachedBadge` states and this pane must share. `hidden` would
   * leave a live CodeMirror instance in the DOM holding a document and an update listener, and
   * "reattaching removes the editor" would have no single answer.
   */
  it('removes the editor when the pane reattaches', () => {
    const { pane, host } = mountPane()
    pane.setEditor('tapes 1\n')
    pane.setEditor(null)
    expect(host.querySelector('.cm-editor')).toBeNull()
  })

  it('collapses by class and leaves the table renderer alone', () => {
    const { pane, host } = mountPane()
    pane.setEditor('tapes 1\n')
    const rowsBefore = host.querySelectorAll('.tm-row').length
    host.querySelector<HTMLButtonElement>('button.collapse')?.click()
    expect(host.querySelector('.tm-pane')?.classList.contains('collapsed')).toBe(true)
    expect(host.querySelectorAll('.tm-row').length).toBe(rowsBefore)
  })

  /**
   * **`header: false` IS SAID IN WORDS, NOT IN A COLOUR.** The accessibility list's item 7 forbids
   * colour carrying state, and this is a fact nothing else in the app can tell the user: a headerless
   * machine runs from blank tapes at `MIN_FIELD_WIDTH` rather than from the input they think they
   * pasted.
   */
  it('says so when the machine has no header', () => {
    const { pane, host } = mountPane()
    pane.setScratchStatus({ available: true, reason: '', width: 4, run: 'Running', header: false })
    expect(host.textContent).toMatch(/no header/i)
    expect(host.textContent).toMatch(/blank tapes/i)
  })

  it('says nothing about the header when there is one', () => {
    const { pane, host } = mountPane()
    pane.setScratchStatus({ available: true, reason: '', width: 64, run: 'Running', header: true })
    expect(host.textContent).not.toMatch(/no header/i)
  })
})
```

Write `mountPane()` following `lambda-pane-editor.test.ts`'s own mount helper — that file is the authority on how a pane is constructed in this tier, including what `PaneEvents` stub it passes. Confirm the real class names on the tape rows before asserting `.tm-row`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="/usr/sbin:$PATH"
cd web && pnpm exec vitest run --project browser tests/browser/tm-pane-editor.test.ts
```

Expected: FAIL — `pane.setEditor is not a function`.

- [ ] **Step 3: Add the editor region**

In `TmPane`'s constructor, add a stable parent above the tapes element, exactly as `LambdaPane` does — a stable parent is what lets `setEditor` mount and unmount without touching the pane's own child order:

```ts
    this.#editorHost = document.createElement('div')
    this.#editorHost.className = ''  // no class until setEditor gives it one, per LambdaPane's rule
```

and include it first in the element list the pane assembles.

- [ ] **Step 4: Implement the three `EditablePane` members**

Port `LambdaPane`'s `setEditor`, `takeEditor` and `receiveEditor` bodies. They are leg-agnostic — they mount a `ScratchEditor`, seed it, and hand it to or take it from custody. **Read `LambdaPane`'s versions and mirror them including their guards**, in particular:
- `setEditor(null)` destroys the editor and retires nothing.
- `receiveEditor` refuses a second editor rather than absorbing the mistake — it throws, and `applyLayout`'s `try`/`finally` is what keeps the tree, the DOM and `localStorage` from disagreeing when it does.
- Both mount sites seed the collapse state.

The `onEdit` callback is the pane's `PaneEvents.editScratch`, captured at construction and read per mount.

- [ ] **Step 5: Add the collapse control and `setScratchStatus`**

```ts
    this.#collapse = collapseButton(titleElement, (collapsed) => on.collapse?.(collapsed))
```

and:

```ts
  /**
   * Render a scratch's status — the fields `TmStatus` has no counterpart for.
   *
   * **`header: false` GETS A SENTENCE, NOT A COLOUR** (accessibility list item 7). `parse_tm_full`
   * explicitly does not treat a missing header as an error, so nothing upstream will say this; the
   * machine runs from blank tapes at `MIN_FIELD_WIDTH` and the user needs to know they are not
   * watching the machine they pasted.
   *
   * **THERE IS NO STEP TOTAL TO RENDER AND NONE IS INVENTED.** `TmScratchStatus` has no `total_steps`
   * because a scratch is stepped rather than described-run. The transport's step readout comes from
   * `History` and is unaffected; the results readout does not exist for a scratch at all.
   */
  setScratchStatus(s: TmScratchStatus): void {
    const width = s.width === null ? '' : ` · width ${n(s.width)}`
    this.#status.textContent = s.header
      ? `scratch${width}`
      : `scratch${width} · no header — blank tapes at width ${n(s.width ?? 4)}`
  }
```

Check `collapseButton`'s existing labels — they read *"show/hide the term editor"*, which is λ wording. Either generalise them in `pane-chrome.ts` or pass a label through; do not leave a TM pane's control saying "term".

- [ ] **Step 6: Move `EDITOR_DEBOUNCE_MS` rather than writing 300 a third time**

`lambda-pane.ts` holds `const EDITOR_DEBOUNCE_MS = 300`, already duplicated from `compile.ts`'s `DEBOUNCE_MS` with a stated argument for the duplication — that importing from `main.ts` would make the module that mounts the app a dependency of one of its widgets. **A third copy is where that argument stops paying.** Create `web/src/editor-timing.ts`:

```ts
/**
 * How long a scratch editor waits after a keystroke before recompiling.
 *
 * **300, WHICH IS THE SOURCE PANE'S `DEBOUNCE_MS`, BECAUSE IT IS THE SAME GESTURE AT THE SAME SPEED.**
 * It lived in `lambda-pane.ts` as a deliberate duplicate of `main.ts`'s constant, on the argument that
 * importing from the module that mounts the app would make it a dependency of one of its widgets. That
 * argument justified two copies and not three: 5d-iv's TM pane needs the same number, so it moves here
 * — a module with no dependencies of its own, which both panes and any test may import.
 */
export const EDITOR_DEBOUNCE_MS = 300
```

Delete the `const` from `lambda-pane.ts` and import it there; import it in `tm-pane.ts`. Leave `main.ts`'s own `DEBOUNCE_MS` alone — it is the source editor's, not a scratch editor's, and collapsing the two would be a change this slice has no evidence for.

- [ ] **Step 7: Style it**

In `web/src/style.css`, reuse the λ pane's editor-region and `.collapsed` rules rather than duplicating them — lift the shared declarations to a class both panes carry if they are currently selector-bound to the λ pane.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
export PATH="/usr/sbin:$PATH"
cd web && pnpm exec vitest run --project browser tests/browser/tm-pane-editor.test.ts && pnpm run typecheck
```

Expected: the five new tests PASS.

- [ ] **Step 9: Check the pane's size**

```bash
wc -c web/src/tm-pane.ts
```

It was ~23 KB. If it is now past `lambda-pane.ts`'s 46 KB, **report it** — the design names the tape-row and table rendering as the half to lift out, not the editor. Do not do the split in this task.

- [ ] **Step 10: Commit**

```bash
git add web/src/tm-pane.ts web/src/editor-timing.ts web/src/lambda-pane.ts web/src/pane-chrome.ts web/src/style.css web/tests/browser/tm-pane-editor.test.ts
git commit -m "5d-iv T8: the TM pane grows an editor region, a collapse, and a header line"
```

---

### Task 9: The fork gesture, wired end to end

**Files:**
- Modify: `web/src/pane-chrome.ts` — `PaneEvents.detachMachine`, and the fork control on a TM pane
- Modify: `web/src/tm-pane.ts` — offer the control, and refuse with a count
- Modify: `web/src/transport.ts` — the `detachMachine` handler
- Modify: `web/src/replies.ts` — the `tm-scratch-compiled` arm
- Modify: `web/src/main.ts` — retain `tmText` from the `compiled` reply
- Test: `web/tests/browser/tm-scratch-fork.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 3–8.
- Produces:
  - `PaneEvents.detachMachine?(): void`
  - `TmPane.setForkAvailable(text: string | null, rules: number): void`

**Why a second event member rather than reusing `detach(step)`:** `PaneEvents.detach` carries a step because a λ fork replays the source term to the frame the pane was showing. A TM fork has no step — the seed is the whole machine, and it lives in `main.ts` from the `compiled` reply, not in the pane. Passing a step the handler ignores would be a parameter with no reader, which this file refuses elsewhere by name. `PaneEvents`' own rule decides it: *"a pane has this handler when it has the affordance the handler reports"*, and these are two affordances with two payloads.

**The refusal (§4.3):** the control is offered exactly when `tmText !== null`. Above the cap it is present and disabled and it names the count. There is no `canFork` boolean.

- [ ] **Step 1: Write the failing test**

Create `web/tests/browser/tm-scratch-fork.test.ts`, modelled on `web/tests/browser/scratch-fork.test.ts`:

```ts
describe('forking a TM pane', () => {
  it('offers the fork control on a machine under the cap', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    expect(app.tmPane().querySelector<HTMLButtonElement>('button.detach')?.disabled).toBe(false)
  })

  /**
   * **THE REFUSAL NAMES THE COUNT, BECAUSE A CONTROL THAT DOES NOTHING FOR AN INVISIBLE REASON IS
   * WORSE THAN NO CONTROL.** `list60` is 94,182 rules against a cap of `MAX_FORK_RULES`.
   */
  it('disables it with a count on a machine over the cap', async () => {
    const app = await mountApp(`[${Array.from({ length: 60 }, (_, i) => i + 1).join(', ')}]`)
    await app.compiled()
    const button = app.tmPane().querySelector<HTMLButtonElement>('button.detach')
    expect(button?.disabled).toBe(true)
    expect(button?.title).toMatch(/94,?182/)
  })

  /**
   * **THE SOURCE SESSION KEEPS RUNNING ACROSS A FORK**, which is the entire reason more than one
   * session exists. Asserted by watching the source's step count advance, the same axis
   * `scratch-fork.test.ts` uses for λ.
   */
  it('leaves the source session running', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    const before = app.sourceStep()
    app.tmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await app.settled()
    expect(app.sourceStep()).toBeGreaterThanOrEqual(before)
    expect(app.tmPane().querySelector('.cm-editor')).not.toBeNull()
    expect(app.tmPane().textContent).toMatch(/detached/i)
  })

  /**
   * **THE HEADLINE CAPABILITY: EDIT A RULE, WATCH THE TAPES TAKE IT.** Everything above this test is
   * plumbing; this is the thing the slice exists to make possible.
   */
  it('runs the edited machine', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    app.tmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await app.settled()

    const original = app.editorText(app.tmPane())
    expect(original).toContain('state ')
    // Change the machine so it halts immediately: replace the start state's whole rule list with a
    // single unconditional jump to `halt`.
    app.typeInto(app.tmPane(), editedToHaltImmediately(original))
    await app.settled()

    expect(app.tmPane().textContent).toMatch(/halt/i)
  })
})
```

Write `mountApp`, `settled`, `editorText`, `typeInto` and `sourceStep` by reusing `scratch-fork.test.ts`'s and `scratch-edit.test.ts`'s existing helpers — do not write new ones.

`editedToHaltImmediately` is local to this file. **It is derived from the emitted text at run time rather than hard-coded**, because a hard-coded machine would stop testing the fork the moment the lowering changed a state name — and it would pass just as green while testing nothing:

```ts
/**
 * Rewrite the start state's rule list to a single unconditional jump to `halt`.
 *
 * **DERIVED FROM THE REAL TEXT, NOT HARD-CODED.** The state names are the lowering's (`pc0`,
 * `wl1s2.s.sk0`, …) and it is free to change them; a machine typed into this file would keep passing
 * after such a change while no longer being the machine the pane forked. This reads the `start`
 * directive out of the emitted header and edits the state it names.
 */
function editedToHaltImmediately(text: string): string {
  const start = /^start (\S+)$/m.exec(text)?.[1]
  if (start === undefined) throw new Error('emitted text has no `start` directive')
  const tapes = Number(/^tapes (\d+)$/m.exec(text)?.[1])
  if (!Number.isInteger(tapes)) throw new Error('emitted text has no `tapes` directive')
  const wild = Array.from({ length: tapes }, () => '*').join(' ')
  const stay = Array.from({ length: tapes }, () => 'S').join(' ')
  const rule = `  [${wild}] -> write [${wild}], move [${stay}], goto halt`

  // Replace every rule line under `state <start>:` with the one above. A state block runs from its
  // header to the next line that is not indented.
  const lines = text.split('\n')
  const at = lines.findIndex((l) => l === `state ${start}:`)
  if (at < 0) throw new Error(`no block for the start state \`${start}\``)
  let end = at + 1
  while (end < lines.length && lines[end].startsWith('  ')) end++
  return [...lines.slice(0, at + 1), rule, ...lines.slice(end)].join('\n')
}
```

Check the emitted grammar against a real file before relying on it — `crates/redextape-core/tests/fixtures/list_1_2.tm` is a committed example of exactly this format, and its `start pc0` / `state pc0:` / two-space-indented rule lines are what the regexes above are written against.

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="/usr/sbin:$PATH"
cd web && pnpm run build:wasm && pnpm exec vitest run --project browser tests/browser/tm-scratch-fork.test.ts
```

Expected: FAIL — no `button.detach` in the TM pane.

- [ ] **Step 3: Add the event member**

In `pane-chrome.ts`'s `PaneEvents`:

```ts
  /**
   * Fork this pane's MACHINE into a TM scratch buffer — 5d-iv design §4.3.
   *
   * **NO STEP, WHERE `detach` CARRIES ONE, AND THAT IS WHY IT IS A SECOND MEMBER RATHER THAN A REUSE.**
   * A λ fork replays the source term to the frame the pane was showing, so the pane reports the one
   * fact it owns. A machine has no step-k text: the seed is the whole `.tm` file, which lives in
   * `main.ts` from the `compiled` reply. This handler needs nothing from the pane, and a `step`
   * parameter its handler ignored would be a parameter with no reader.
   *
   * OPTIONAL, like `detach`, and by the same test: a pane has this handler when it has the affordance.
   */
  detachMachine?(): void
```

- [ ] **Step 4: Offer the control in the TM pane**

Add a `detachButton` to `TmPane`, wired to `on.detachMachine`, plus:

```ts
  /**
   * Offer the fork control exactly when a fork would work — `detachButton`'s rule, as a data
   * dependency rather than a convention.
   *
   * **`text === null` IS THE WHOLE CONDITION.** There is no second flag: the worker already decided,
   * with `forkable`, and sending a boolean beside the text would be a second encoding of one fact that
   * only the producer keeps in step. `rules` is for the WORDING and never for the decision.
   */
  setForkAvailable(text: string | null, rules: number): void {
    this.#tmText = text
    this.#detach.update(text !== null)
    if (text === null && rules > 0) {
      this.#detach.setReason(`${n(rules)} rules — too large to open in an editor`)
    }
  }
```

`detachButton` currently exposes only `update(available)`. Add a `setReason(msg: string)` that writes `title` and `aria-description`, and keep its existing behaviour untouched for the λ pane, which does not call it.

- [ ] **Step 5: Retain `tmText` and push it**

In `main.ts`'s `compiled` arm (or `replies.ts`, wherever `tmProgram` is stored on the entry today — follow it), retain `tmText` beside it and call `setForkAvailable(tmText, ruleCount(tmProgram))` on every TM pane, through the same fan-out that already calls `setProgram`. A pane created later must get it too, which is what the retention is for — the same argument `SessionEntry.tmProgram`'s doc makes for itself.

- [ ] **Step 6: Handle the gesture**

In `transport.ts`, beside the `detach` handler:

```ts
    ...(slot.binding.leg === 'tm'
      ? {
          detachMachine: () => {
            const text = tmTextOf(slot.binding.session)
            // The control is disabled when this is null, so reaching here with one is a wiring bug
            // rather than a user action — loud, not swallowed.
            if (text === null) throw new Error('detachMachine reached with no machine text')
            try {
              scratchpad.fork(slot, text, 0, 'tm')
            } catch (e) {
              // `BufferCapReached` AND NOT A BARE `catch`, for the reason the λ handler beside this one
              // gives in full: the other throws reachable from `fork` are wiring bugs, and rendering one
              // as a status line would swallow it.
              if (e instanceof BufferCapReached) linkWiring().setForkFailed(e.message)
              else throw e
            }
          },
        }
      : {}),
```

- [ ] **Step 7: Handle the reply**

In `replies.ts`, add the arm:

```ts
      case 'tm-scratch-compiled':
        // ONE STATUS, AND THE `null` IS NOT A FABRICATION — `resetLegs` drops a status for a leg the
        // session does not have rather than writing one so the record is square. This is the mirror of
        // the `scratch-compiled` arm above: there the λ status is real and TM is null.
        resetLegs(sessions.entryOf(session).legs, null, reply.tm)
        // THE MACHINE IS STORED AND FANNED OUT IN ONE CALL, exactly as `compiled` does, so a pane
        // created after this reply is seeded from the entry rather than left blank.
        storeAndPushProgram(session, reply.tmProgram)
        for (const p of panes.ofSession('tm', session)) p.pane.setScratchStatus(reply.tm)
        break
```

Match `resetLegs`' real signature and `storeAndPushProgram`'s real name — read the `compiled` arm and mirror it.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
export PATH="/usr/sbin:$PATH"
cd web && pnpm exec vitest run --project browser tests/browser/tm-scratch-fork.test.ts && pnpm run typecheck
```

Expected: the four new tests PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src web/tests/browser/tm-scratch-fork.test.ts
git commit -m "5d-iv T9: the TM fork gesture, from the control to the running edited machine"
```

---

### Task 10: The blank buffer, and the button that stopped hiding

**Files:**
- Modify: `web/src/buffer-list.ts` — the "new TM buffer" item
- Modify: `web/src/main.ts` — `refreshBuffers` loses the hide rule and the focus branch; the handler calls `forkBlank`
- Test: `web/tests/browser/tm-blank-buffer.test.ts` (new)

**Interfaces:**
- Consumes: Task 5's `ScratchBuffers.forkBlank`.
- Produces: `bufferList(button, rows, onRetire, onTemperature, onNewTm)` — a fifth parameter.

**Why a second gesture (§4.7):** *fork* means "detach this pane onto its own copy of the machine it is showing", and above the cap that is not available. *New TM buffer* means "give me somewhere to paste a `.tm` file", and it is available always. A fork that silently yielded an empty buffer above the cap would be a failure dressed as a success.

**And why the button stops hiding:** `refreshBuffers` sets `buffersButton.hidden = live === 0`, so the menu holding this control is unreachable on a page with no buffers — **which is exactly the state a user is in when they want somewhere to paste**. The focus-restoration line beside it exists solely because retiring the last buffer hides the control the click landed on; that is **item 1 of the standing accessibility list**, and deleting the hide rule retires this instance of it.

- [ ] **Step 1: Write the failing test**

Create `web/tests/browser/tm-blank-buffer.test.ts`:

```ts
describe('the blank TM buffer', () => {
  /**
   * **THE HOLE THIS TASK EXISTS TO CLOSE.** Every other buffer test forks first, so none of them can
   * see that the menu is unreachable at zero — which is precisely when a user wants this control.
   */
  it('opens the buffers menu with no buffers at all', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    const button = app.buffersButton()
    expect(button.hidden).toBe(false)
    button.click()
    expect(app.buffersMenu().querySelector('button.new-tm')).not.toBeNull()
  })

  it('mints a warm TM buffer and binds no pane to it', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    const boundBefore = app.paneBindings()
    app.buffersButton().click()
    app.buffersMenu().querySelector<HTMLButtonElement>('button.new-tm')?.click()
    await app.settled()
    expect(app.bufferRows()).toHaveLength(1)
    expect(app.paneBindings()).toEqual(boundBefore)
  })

  it('binds a TM pane to it through the binding selector', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    app.buffersButton().click()
    app.buffersMenu().querySelector<HTMLButtonElement>('button.new-tm')?.click()
    await app.settled()
    app.pickBinding(app.tmPane(), { leg: 'tm', session: 'scratch-1' })
    await app.settled()
    expect(app.tmPane().querySelector('.cm-editor')).not.toBeNull()
  })

  /**
   * **RETIRING THE LAST BUFFER NO LONGER STRANDS FOCUS**, because the button no longer disappears —
   * accessibility list item 1, one instance retired. Pinned so a future re-hide is caught.
   */
  it('keeps focus on the buffers button when the last buffer is retired', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    app.buffersButton().click()
    app.buffersMenu().querySelector<HTMLButtonElement>('button.new-tm')?.click()
    await app.settled()
    app.buffersButton().click()
    app.buffersMenu().querySelector<HTMLButtonElement>('button.retire')?.click()
    await app.settled()
    expect(app.buffersButton().hidden).toBe(false)
    expect(document.activeElement).toBe(app.buffersButton())
  })
})
```

Reuse `buffer-list.test.ts`'s existing helpers for reaching the button, the menu and the rows; confirm the real class names on the retire control before asserting `button.retire`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="/usr/sbin:$PATH"
cd web && pnpm exec vitest run --project browser tests/browser/tm-blank-buffer.test.ts
```

Expected: FAIL — `button.hidden` is `true` with no buffers.

- [ ] **Step 3: Add the control**

In `buffer-list.ts`, take a fifth parameter `onNewTm: () => void` and build a header item above the rows inside `rebuildRows`:

```ts
  /**
   * **"GIVE ME SOMEWHERE TO PASTE A `.tm` FILE" — a different intention from a fork, which detaches a
   * pane onto a copy of what it was showing** (5d-iv design §4.7). It is here rather than in the app
   * header because this menu is where buffers are managed; it is what makes the menu non-empty at
   * zero, which is why the invoking button no longer hides itself.
   *
   * IT IS BUILT INSIDE `rebuildRows` so it survives a temperature click's rebuild, and FIRST so a
   * keyboard user reaches it before a list that may be long.
   */
  const newTm = document.createElement('button')
  newTm.type = 'button'
  newTm.className = 'new-tm'
  newTm.textContent = 'new TM buffer'
  newTm.addEventListener('click', () => {
    menu.hidePopover()
    onNewTm()
  })
```

and prepend it in the `menu.replaceChildren(...)` call. `update(count)` sets `button.textContent = count === 0 ? 'buffers ▾' : \`buffers ${count} ▾\``.

- [ ] **Step 4: Delete the hide rule and the focus branch**

In `main.ts`'s `refreshBuffers`:

```ts
  const refreshBuffers = (): void => {
    const live = scratchpad.list().length
    // **NO HIDE-AT-ZERO, AND NO FOCUS RESTORATION BESIDE IT — 5d-iv design §4.7.** This function used
    // to read `buffersButton.hidden = live === 0`, plus a line moving focus to the reset-layout button
    // when retiring the last buffer hid the control the click had landed on. That is item 1 of the
    // standing accessibility list, "a control that hides itself on click strands the keyboard"; the
    // menu now offers "new TM buffer" and so is never empty, which removes the reason for the hide and
    // therefore the workaround. One instance retired, not the pass discharged.
    buffers.update(live)
```

and pass the new handler where `bufferList` is constructed:

```ts
    () => {
      try {
        scratchpad.forkBlank('tm')
      } catch (e) {
        if (e instanceof BufferCapReached) linkWiring.setForkFailed(e.message)
        else throw e
      }
      refreshBuffers()
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
export PATH="/usr/sbin:$PATH"
cd web && pnpm exec vitest run --project browser tests/browser/tm-blank-buffer.test.ts tests/browser/buffer-list.test.ts && pnpm run typecheck
```

Expected: the four new tests PASS and `buffer-list.test.ts` still passes. **If any pre-existing test asserted `hidden === true` at zero, it is now wrong and must be updated with a comment pointing at this task** — do not delete it.

- [ ] **Step 6: Commit**

```bash
git add web/src/buffer-list.ts web/src/main.ts web/tests/browser
git commit -m "5d-iv T10: a blank TM buffer, and the menu that is reachable when you need it"
```

---

### Task 11: Both legs survive a reload, end to end

**Files:**
- Modify: `web/src/main.ts` — the restore loop, if it assumes λ
- Test: `web/tests/browser/tm-buffer-restore.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 5, 6, 9, 10.
- Produces: nothing new. This task proves the composition.

**What it proves:** Task 6 pinned the format and Task 5 pinned the collection, each in the node tier with fake ports. Neither can see that `main.ts`'s restore loop warms a TM buffer onto a `tm-scratch` request and a λ buffer onto a `lambda-scratch` one, or that a restored TM buffer's pane comes back showing its machine. That is a real thread and a real `pkg/`, so it is a browser-tier test — and it is a **composition** check rather than the sole proof of anything, which is why the tier's skippability is acceptable here.

- [ ] **Step 1: Write the failing test**

Create `web/tests/browser/tm-buffer-restore.test.ts`, modelled on `web/tests/browser/buffer-restore.test.ts`:

```ts
describe('restoring buffers on both legs', () => {
  it('brings a warm TM buffer back showing its machine', async () => {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()
    first.tmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await first.settled()
    const text = first.editorText(first.tmPane())
    expect(text).toContain('state ')

    const second = await remountApp() // same localStorage, fresh page
    await second.settled()
    expect(second.editorText(second.tmPane())).toBe(text)
    expect(second.tmPane().textContent).toMatch(/detached/i)
  })

  it('brings a λ buffer and a TM buffer back on their own legs', async () => {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()
    first.lambdaPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await first.settled()
    first.tmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await first.settled()

    const second = await remountApp()
    await second.settled()
    const rows = second.bufferRows()
    expect(rows).toHaveLength(2)
    expect(second.lambdaPane().querySelector('.cm-editor')).not.toBeNull()
    expect(second.tmPane().querySelector('.cm-editor')).not.toBeNull()
  })

  /**
   * **A COLD BUFFER COMES BACK COLD AND ON THE RIGHT LEG.** `restore` inserts every buffer cold and
   * `main.ts` warms the ones its restored bindings name; a leg lost in that path would warm a TM
   * buffer onto a `lambda-scratch` request, which produces a session whose `legOf` throws the moment
   * a pane is pointed at it.
   */
  it('warms a restored cold TM buffer onto the tm leg', async () => {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()
    first.buffersButton().click()
    first.buffersMenu().querySelector<HTMLButtonElement>('button.new-tm')?.click()
    await first.settled()

    const second = await remountApp()
    await second.settled()
    second.buffersButton().click()
    second.buffersMenu().querySelector<HTMLButtonElement>('button.temperature')?.click()
    await second.settled()
    expect(second.bufferRows()[0].textContent).not.toMatch(/asleep/i)
  })
})
```

Reuse `buffer-restore.test.ts`'s own remount helper rather than writing `remountApp`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="/usr/sbin:$PATH"
cd web && pnpm exec vitest run --project browser tests/browser/tm-buffer-restore.test.ts
```

Expected: FAIL — the restore loop warms on the wrong leg, or the restored pane shows no editor.

- [ ] **Step 3: Fix the restore loop**

In `main.ts`, wherever restore warms a buffer, the leg now comes from the buffer record rather than being assumed. `ScratchBuffers.warm` already reads `state.leg` after Task 5, so this is likely already correct — **if it is, make no change and say so in the task report.** A task whose implementation step is empty because an earlier task covered it is a fact worth recording, not a step to invent work for.

- [ ] **Step 4: Run the whole suite**

```bash
export PATH="/usr/sbin:$PATH"
cd web && pnpm run build:wasm && pnpm test && pnpm run typecheck
cargo nextest run --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: web suite green with the new tests added to 606; workspace **902 passed, 8 skipped**; clippy clean.

- [ ] **Step 5: Check coverage**

```bash
cd web && pnpm run test:coverage
```

Expected: all four figures at or above **95.57 / 89.88 / 98.51 / 98.08**. **Report all four**, and if any fell, report by how much and which file drove it before proposing a fix.

- [ ] **Step 6: Commit**

```bash
git add web/src/main.ts web/tests/browser/tm-buffer-restore.test.ts
git commit -m "5d-iv T11: both legs survive a reload, proved through a real thread"
```

---

## Final verification

Run before opening the PR, and record every figure rather than the verdict:

```bash
export PATH="/usr/sbin:$PATH"
cargo nextest run --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd web && pnpm run build:wasm && pnpm test && pnpm run typecheck && pnpm run test:coverage
cd .. && pre-commit run --all-files
scripts/check-citations.sh --self-test && scripts/check-citations.sh
```

**Then answer, in the roadmap entry, the two questions this plan pre-registered:**

1. **Did `MAX_FORK_RULES` land on the pre-registered 20,000?** If not, by how much, and which of the three measured costs moved it. A missed pre-registration that ships anyway must be stated, not smoothed.
2. **Did `tm-pane.ts` stay under `lambda-pane.ts`'s size?** If not, name the half to lift out and file it.

**And record what this slice did NOT close:** the per-frame layout write on `pointermove`, still open and still belonging to whoever next touches that path; `parse_asm`, still unclaimed; the accessibility pass, now unblocked — 5d-iv is the last slice it was gated behind.
