# Plan 5a-ii — the virtualized state table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the δ function as a scrollable table beside the tapes — every state, every rule, the current one highlighted and followed — for machines up to 127,881 rows.

**Architecture:** `TmState` gains the index of the rule about to fire, resolved in Rust by the crate's own δ-matcher. The web side keeps `tmProgram` as it arrives and builds a prefix-sum **index** over it rather than a flattened row array; `virtual-list.ts` turns a scroll offset into a row range, `state-table.ts` resolves that range against the index, and only the visible rows become DOM.

**Tech Stack:** Rust (`redextape-core`, `redextape-wasm`), TypeScript + plain DOM (no framework), Vitest (node + browser projects), Playwright-driven Chromium.

## Global Constraints

- **No placeholders, ever.** A `default:` arm or a stub that exists to be replaced later is a defect, not a step. If a commit cannot be green without a behaviour, implement the correct interim behaviour.
- **`--no-verify` is never used.** `pre-commit` runs `cargo fmt`, `cargo clippy -D warnings`, `biome ci` and `tsc --noEmit` on every commit. A commit split that cannot be green is infeasible and must be collapsed, and the collapse said out loud.
- **Every commit is green.** Both the tests it adds and every test already in the tree.
- **Rust must be clippy-clean in whatever commit contains it** — the constraint design §5 recorded for `tapeNames()`.
- **The red step for a type-only change is `pnpm run typecheck`, not `pnpm run test:browser`.** `import type` is erased by esbuild before vitest resolves the export, so a browser test passes against types that do not exist. This cost 5a-i's Task 2 a full round.
- **Shapes are measured, not designed.** Anything added to `web/src/types.ts` is pinned by a browser test reading a real value out of real wasm before anything consumes it.
- **`pkg/` is gitignored and not tracked.** Any task touching Rust must run `pnpm run build:wasm` from `web/` before the browser project will see the change.
- **Doc comments:** `///` in Rust, `/** */` in TypeScript.
- **Commit messages:** no attribution trailers.

---

## Pre-flight: one correction to the design, to be made rather than discovered

**Design §3.5 says `rule: Option<u32>`. Implement `Option<usize>` instead.**

The design reasoned from `TermNode`'s boundary note, where `u32` was chosen because wasm-bindgen maps `u64` to a JavaScript `bigint`. That reasoning does not reach this field: `TmState` already carries `heads: Vec<usize>` and `window_start: Vec<usize>`, the wasm target is `wasm32` where `usize` **is** 32 bits, and `web/tests/browser/shapes.test.ts:62` already asserts those cross as plain numbers. `usize` is therefore both proven safe here and consistent with the two fields beside it; `u32` would make `TmState` the one struct in the file using two widths for the same kind of index.

TypeScript side is `number | null` either way.

---

## File Structure

| file | status | responsibility |
| --- | --- | --- |
| `crates/redextape-core/src/viewmodel.rs` | modify | `TmState.rule`, resolved via `sim::rule_matches` |
| `crates/redextape-core/tests/viewmodel_contract.rs` | modify | the invariant tying `rule` to the simulator |
| `crates/redextape-wasm/tests/browser.rs` | modify | `rule` present and numeric across the boundary |
| `web/src/types.ts` | modify | `TmState.rule: number \| null` |
| `web/tests/browser/shapes.test.ts` | modify | pins that shape against real wasm |
| `web/src/virtual-list.ts` | **create** | scroll offset → row range. Pure logic, no DOM |
| `web/tests/node/virtual-list.test.ts` | **create** | its arithmetic, including both boundaries |
| `web/src/state-table.ts` | **create** | the prefix-sum index, row resolution, highlight, follow |
| `web/tests/node/state-table.test.ts` | **create** | index, resolution boundaries, highlight, follow |
| `web/src/tm-pane.ts` | modify | mounts the table, renders the visible rows, owns the toggle |
| `web/src/style.css` | modify | table layout and highlight |
| `web/tests/browser/app.test.ts` | modify | the browser tier |
| `docs/superpowers/specs/2026-08-08-plan5a-ii-state-table-design.md` | modify | outcomes recorded in place |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | modify | the roadmap entry |
| `README.md` | modify | the feature as shipped |

---

## Task 1: `TmState.rule` — the transition, resolved in Rust

**Files:**
- Modify: `crates/redextape-core/src/viewmodel.rs:116-127` (the struct), `:340-354` (`window`)
- Test: `crates/redextape-core/tests/viewmodel_contract.rs`

**Interfaces:**
- Consumes: `sim::rule_matches(&[Option<Symbol>], &[Tape]) -> bool` (`tm/sim.rs:179`), `TmCursor::tapes()`, `TmCursor::machine()` (`trace.rs:198,216`)
- Produces: `TmState.rule: Option<usize>` — the index into `states[state].rules` of the rule **about to fire**

- [ ] **Step 1: Write the failing test**

Append to `crates/redextape-core/tests/viewmodel_contract.rs`:

```rust
/// `TmState.rule` NAMES WHAT HAPPENS NEXT, and this ties it to the simulator rather than to a second
/// reading of the matcher. `window` is built AFTER a step, so its tapes and its `state` are post-step
/// and the rule it reports is the transition the following step will take.
///
/// Both directions are asserted, because only one of them is the interesting failure: `Some` must
/// predict the next state, and `None` must mean the machine is genuinely stuck. A field that answered
/// `None` everywhere would pass a one-directional test while silently disabling the whole feature.
#[test]
fn rule_names_the_transition_the_next_step_actually_takes() {
    let (machine, init) = tm_fixture("let x = 40; x + 2");
    let mut cursor = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());

    let mut checked = 0usize;
    loop {
        let before = TmState::window(&cursor, &empty_map(), 2);
        match before.rule {
            Some(idx) => {
                let state = &machine.states[before.state as usize];
                let expected = state.rules[idx].next;
                assert!(cursor.next().is_some(), "a rule matched but the cursor would not advance");
                let after = TmState::window(&cursor, &empty_map(), 2);
                assert_eq!(
                    after.state, expected,
                    "step {}: rule {idx} of `{}` says next = {expected}, machine went to {}",
                    before.step, state.name, after.state
                );
                checked += 1;
            }
            None => {
                assert!(cursor.next().is_none(), "no rule matched but the machine stepped anyway");
                break;
            }
        }
    }
    assert!(checked > 100, "fixture exercised only {checked} transitions; it must exercise the field");
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test -p redextape-core --test viewmodel_contract rule_names_the_transition`
Expected: FAIL — `no field 'rule' on type 'TmState'`.

- [ ] **Step 3: Add the field**

In `crates/redextape-core/src/viewmodel.rs`, add to `TmState` after `source_node`:

```rust
    /// The index into `states[state].rules` of the rule ABOUT TO FIRE, or `None` when nothing matches.
    ///
    /// IT NAMES WHAT HAPPENS NEXT, NOT WHAT PRODUCED THIS STATE. `window` is called after a step, so
    /// the tapes it reads and the `state` beside this field are both post-step; the first rule matching
    /// those tapes is what the FOLLOWING step will take. `None` — at an accept state, at `halt`, or at a
    /// genuinely stuck configuration — is a real answer about why a run stopped, not a missing one.
    ///
    /// RESOLVED BY `sim::rule_matches`, THE CRATE'S ONLY δ-MATCHER, rather than re-derived. A consumer
    /// could compute this from `window`, `heads` and `window_start`, which the frame already carries —
    /// and that consumer would be a second copy of first-match-wins-with-wildcards in a language whose
    /// compiler cannot see this one. `usize` rather than `u32` to match `heads` and `window_start`
    /// beside it; on wasm32 they are the same width and cross as plain numbers.
    pub rule: Option<usize>,
```

- [ ] **Step 4: Resolve it in `window`**

Replace the tail of `TmState::window` (`viewmodel.rs:350-353`) with:

```rust
        let state = c.state();
        // `get`, never `[]`: a `StateId` past the end must answer `None` rather than abort a renderer.
        let entry = c.machine().states.get(state as usize);
        let source_node = entry.and_then(|s| map.tm_owner(&s.name));
        let rule = entry.and_then(|s| s.rules.iter().position(|r| crate::tm::sim::rule_matches(&r.read, c.tapes())));
        TmState { state, step: c.steps_taken(), heads, window_start, window, source_node, rule }
```

`position` is first-match-wins, which is the simulator's rule (`sim.rs:1`, `tm/mod` doc: *"Deterministic (first matching rule…)"*).

- [ ] **Step 5: Run the test and the whole core suite**

Run: `cargo test -p redextape-core --test viewmodel_contract`
Expected: PASS, including the new test.

Run: `cargo test -p redextape-core`
Expected: PASS. `TmState` is constructed in `frame_cost_probe.rs` only via `TmState::window`, so no example needs an edit; if the compiler says otherwise, fix the construction site rather than adding `..Default::default()`.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/viewmodel.rs crates/redextape-core/tests/viewmodel_contract.rs
git commit -m "viewmodel: TmState names the rule about to fire, from the crate's own matcher"
```

---

## Task 2: pin `rule` at the boundary

**Files:**
- Modify: `crates/redextape-wasm/tests/browser.rs`, `web/src/types.ts:116-123`, `web/tests/browser/shapes.test.ts`

**Interfaces:**
- Consumes: Task 1's `TmState.rule: Option<usize>`
- Produces: `TmState.rule: number | null` in `web/src/types.ts`

- [ ] **Step 1: Rebuild wasm, or the browser project tests the old module**

```bash
cd web && pnpm run build:wasm
```

- [ ] **Step 2: Write the failing TypeScript pin**

In `web/tests/browser/shapes.test.ts`, inside the existing `tmProgram and tmState arrive in the shapes types.ts declares` test, after the `source_node` assertions (line 68):

```ts
    // `rule` INDEXES `states[state].rules`, and a bare `typeof === 'number'` would pass on an index
    // that points nowhere. Resolve it.
    expect('rule' in first).toBe(true)
    expect(first.rule === null || typeof first.rule === 'number').toBe(true)
    if (first.rule !== null) {
      const rules = program.states[first.state]?.rules ?? []
      expect(first.rule).toBeLessThan(rules.length)
      expect(rules[first.rule]).toBeDefined()
    }
```

And after the `second.step` assertion (line 72), the invariant, which is the one worth having in the browser as well as in Rust:

```ts
    // The same contract Task 1 pins in Rust, re-checked across the boundary: the rule named BEFORE a
    // step is the transition that step takes. A serializer that dropped or shifted the field would
    // satisfy every type check above and fail here.
    const beforeStep = session.tmState(40)
    if (beforeStep.rule !== null) {
      const expected = program.states[beforeStep.state]?.rules[beforeStep.rule]?.next
      session.stepTm()
      expect(session.tmState(40).state).toBe(expected)
    }
```

- [ ] **Step 3: Add the field to `types.ts`**

In `web/src/types.ts`, add to `TmState` after `source_node`:

```ts
  /**
   * The index into `tmProgram().states[state].rules` of the rule ABOUT TO FIRE, or `null` when nothing
   * matches — at an accept state, at `halt`, or at a stuck configuration.
   *
   * NAMES WHAT HAPPENS NEXT, NOT WHAT PRODUCED THIS FRAME. See `viewmodel.rs`'s field doc.
   */
  rule: number | null
```

- [ ] **Step 4: Run typecheck first — it is the red step for a type**

Run: `cd web && pnpm run typecheck`
Expected: PASS. (Before Step 3 it would have failed; `pnpm run test:browser` would not have, which is why this order is fixed.)

- [ ] **Step 5: Run the browser project**

Run: `cd web && pnpm run test:browser`
Expected: PASS, 33 → 33 tests (the assertions join an existing test rather than adding one).

- [ ] **Step 6: Mirror the pin in the Rust browser test**

In `crates/redextape-wasm/tests/browser.rs`, in the test that reads `tm_state` (around line 240), add:

```rust
    // `rule` crosses as a number or null, never as a bigint — the failure `TermNode`'s `u32` note was
    // guarding against, checked here rather than assumed because `usize` is what this field uses.
    let rule = get(&tm_state, "rule");
    assert!(rule.is_null() || rule.as_f64().is_some(), "rule must be a number or null, got {rule:?}");
```

- [ ] **Step 7: Run the wasm browser suite**

Run: `wasm-pack test --headless --chrome crates/redextape-wasm`
Expected: PASS, 13/13. Chrome lives in `/usr/sbin` and may be off `PATH`; chromedriver self-installs.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-wasm/tests/browser.rs web/src/types.ts web/tests/browser/shapes.test.ts
git commit -m "boundary: pin TmState.rule, and re-check its invariant across the wire"
```

---

## Task 3: `virtual-list.ts`

**Files:**
- Create: `web/src/virtual-list.ts`, `web/tests/node/virtual-list.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `visibleWindow(rowCount, rowHeight, viewportHeight, scrollTop, overscan): VisibleWindow` where `VisibleWindow = { firstIndex: number; lastIndex: number; offsetY: number; totalHeight: number }`. **`lastIndex < firstIndex` means an empty range** — the empty list yields `{0, -1, 0, 0}`.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/node/virtual-list.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { visibleWindow } from '../../src/virtual-list'

// 20 rows of 24px in a 120px viewport: five rows fit exactly.
const w = (scrollTop: number, overscan = 0) => visibleWindow(20, 24, 120, scrollTop, overscan)

describe('visibleWindow', () => {
  it('starts at row 0 at the top, and reports the full scrollable height', () => {
    expect(w(0)).toEqual({ firstIndex: 0, lastIndex: 5, offsetY: 0, totalHeight: 480 })
  })

  it('advances one row per rowHeight of scroll, and offsetY tracks firstIndex', () => {
    expect(w(24)).toEqual({ firstIndex: 1, lastIndex: 6, offsetY: 24, totalHeight: 480 })
    expect(w(48)).toEqual({ firstIndex: 2, lastIndex: 7, offsetY: 48, totalHeight: 480 })
  })

  // A partial scroll must not skip the row it is halfway through.
  it('floors a partial scroll rather than rounding it', () => {
    expect(w(23).firstIndex).toBe(0)
    expect(w(25).firstIndex).toBe(1)
  })

  it('clamps lastIndex at the final row rather than running past the end', () => {
    const end = w(9_999)
    expect(end.lastIndex).toBe(19)
    expect(end.firstIndex).toBeLessThanOrEqual(19)
  })

  it('widens the range by overscan on both sides, clamped at both ends', () => {
    expect(w(0, 3).firstIndex).toBe(0)
    expect(w(240, 3)).toMatchObject({ firstIndex: 7, lastIndex: 19 })
  })

  // offsetY must be the top of firstIndex, INCLUDING the overscan rows — a translate computed from
  // the un-overscanned index shifts every row up by overscan * rowHeight.
  it('offsetY is the top of firstIndex after overscan is applied', () => {
    const o = w(240, 3)
    expect(o.offsetY).toBe(o.firstIndex * 24)
  })

  it('reports an empty range for an empty list rather than row 0', () => {
    expect(visibleWindow(0, 24, 120, 0, 0)).toEqual({ firstIndex: 0, lastIndex: -1, offsetY: 0, totalHeight: 0 })
  })

  it('reports exactly one row for a one-row list', () => {
    expect(visibleWindow(1, 24, 120, 0, 4)).toMatchObject({ firstIndex: 0, lastIndex: 0, totalHeight: 24 })
  })

  it('holds at 127,881 rows, which is list60 and the reason this file exists', () => {
    const big = visibleWindow(127_881, 24, 600, 1_000_000, 2)
    expect(big.totalHeight).toBe(3_069_144)
    expect(big.firstIndex).toBe(41_664)
    expect(big.lastIndex - big.firstIndex).toBeLessThan(40)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && pnpm run test:node -- virtual-list`
Expected: FAIL — cannot resolve `../../src/virtual-list`.

- [ ] **Step 3: Implement it**

Create `web/src/virtual-list.ts`:

```ts
/**
 * Fixed-row-height windowing: a scroll offset in, a row range out.
 *
 * NO LIBRARY AND NO DOM. Design §9 recorded that this ~40-line piece is the same work under any
 * framework, and keeping it as arithmetic is what lets it be tested without a browser — which matters
 * because it IS arithmetic under a shifting offset, the shape 5a-i's reviews found five surviving
 * mutants in.
 *
 * `list60` is 127,881 rows (design §3.1). Nothing here may be linear in `rowCount`.
 */
export type VisibleWindow = {
  firstIndex: number
  /** Inclusive. **`lastIndex < firstIndex` means the range is empty**, which is how an empty list reports. */
  lastIndex: number
  /** The pixel offset of `firstIndex`'s top edge — what the row container is translated by. */
  offsetY: number
  totalHeight: number
}

export function visibleWindow(
  rowCount: number,
  rowHeight: number,
  viewportHeight: number,
  scrollTop: number,
  overscan: number,
): VisibleWindow {
  if (rowCount <= 0) return { firstIndex: 0, lastIndex: -1, offsetY: 0, totalHeight: 0 }

  const totalHeight = rowCount * rowHeight
  // `+ 1` because a viewport that is an exact multiple of `rowHeight` still shows a sliver of the next
  // row the moment it is scrolled by one pixel.
  const spanned = Math.ceil(viewportHeight / rowHeight) + 1
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const last = Math.min(rowCount - 1, first + spanned + 2 * overscan - 1)
  return { firstIndex: first, lastIndex: last, offsetY: first * rowHeight, totalHeight }
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd web && pnpm run test:node -- virtual-list`
Expected: PASS, 9 tests.

- [ ] **Step 5: Kill two mutants before committing**

Apply each, confirm a test fails, revert, confirm green:

1. `Math.floor` → `Math.round` in `first`. Must fail `floors a partial scroll rather than rounding it`.
2. `offsetY: first * rowHeight` → `offsetY: Math.floor(scrollTop / rowHeight) * rowHeight`. Must fail `offsetY is the top of firstIndex after overscan is applied`.

If either mutant survives, the test is wrong and gets fixed before the implementation is trusted — 5a-i's Task 4 found a *reviewer's own* replacement test failing this check.

- [ ] **Step 6: Commit**

```bash
git add web/src/virtual-list.ts web/tests/node/virtual-list.test.ts
git commit -m "web: fixed-row windowing, as arithmetic with no DOM and no library"
```

---

## Task 4: `state-table.ts` — the index and its resolution

**Files:**
- Create: `web/src/state-table.ts`, `web/tests/node/state-table.test.ts`

**Interfaces:**
- Consumes: `TmProgram`, `TmState`, `Move` from `./types`
- Produces:
  - `type Row = { kind: 'state'; id: number; name: string; accept: boolean } | { kind: 'rule'; stateId: number; ruleIndex: number; read: (string | null)[]; write: (string | null)[]; moves: Move[]; next: number }`
  - `class StateIndex` with `rowCount: number`, `rowOfState(s: number): number`, `row(i: number): Row | null`
  - `highlight(index: StateIndex, frame: TmState | null): { stateRow: number; ruleRow: number } | null` — `ruleRow` is `-1` when `frame.rule` is null

- [ ] **Step 1: Write the failing tests**

Create `web/tests/node/state-table.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { highlight, StateIndex } from '../../src/state-table'
import type { RuleView, StateView, TmProgram, TmState } from '../../src/types'

const rule = (next: number): RuleView => ({
  read: [null, 'a', null, null, null],
  write: ['b', null, null, null, null],
  moves: ['R', 'S', 'S', 'S', 'L'],
  next,
})

const st = (name: string, rules: number, accept = false): StateView => ({
  name,
  accept,
  rules: Array.from({ length: rules }, (_, i) => rule(i)),
})

// 3 rules, then 0 (a `halt`-shaped state), then 2, then 1 => rows 0..9
//   0 s0        4 s1(halt)   5 s2        8 s3
//   1 s0.r0                  6 s2.r0     9 s3.r0
//   2 s0.r1                  7 s2.r1
//   3 s0.r2
const program = (): TmProgram => ({
  states: [st('s0', 3), st('s1', 0, true), st('s2', 2), st('s3', 1)],
  alphabet: ['a', 'b'],
  tapes: 5,
  width: 64,
  start: 0,
})

const frame = (over: Partial<TmState> = {}): TmState => ({
  state: 0,
  step: 0,
  heads: [0],
  window_start: [0],
  window: [['a']],
  source_node: null,
  rule: null,
  ...over,
})

describe('StateIndex', () => {
  it('counts one row per state plus one per rule', () => {
    expect(new StateIndex(program()).rowCount).toBe(10)
  })

  it('places each state header at its prefix sum', () => {
    const i = new StateIndex(program())
    expect([0, 1, 2, 3].map((s) => i.rowOfState(s))).toEqual([0, 4, 5, 8])
  })

  // EVERY BOUNDARY, because `i === rowStart[s]` is one comparison away from rendering every state's
  // rule 0 as a header, and a spot check in the middle of a block would not see it.
  it('resolves a header row, its first rule, and its last rule', () => {
    const i = new StateIndex(program())
    expect(i.row(0)).toMatchObject({ kind: 'state', id: 0, name: 's0', accept: false })
    expect(i.row(1)).toMatchObject({ kind: 'rule', stateId: 0, ruleIndex: 0 })
    expect(i.row(3)).toMatchObject({ kind: 'rule', stateId: 0, ruleIndex: 2 })
  })

  it('resolves the row after a state block as the NEXT state header, not a fourth rule', () => {
    expect(new StateIndex(program()).row(4)).toMatchObject({ kind: 'state', id: 1, name: 's1', accept: true })
  })

  it('gives a zero-rule state exactly one row, and the next state starts immediately after', () => {
    const i = new StateIndex(program())
    expect(i.row(4)).toMatchObject({ kind: 'state', id: 1 })
    expect(i.row(5)).toMatchObject({ kind: 'state', id: 2 })
  })

  it('resolves the first and last rows of the whole table', () => {
    const i = new StateIndex(program())
    expect(i.row(0)).toMatchObject({ kind: 'state', id: 0 })
    expect(i.row(9)).toMatchObject({ kind: 'rule', stateId: 3, ruleIndex: 0 })
  })

  it('answers null outside the table rather than throwing or clamping', () => {
    const i = new StateIndex(program())
    expect(i.row(-1)).toBeNull()
    expect(i.row(10)).toBeNull()
  })

  it('carries a rule\'s fields through unchanged, wildcards included', () => {
    const r = new StateIndex(program()).row(1)
    expect(r).toMatchObject({
      kind: 'rule',
      read: [null, 'a', null, null, null],
      write: ['b', null, null, null, null],
      moves: ['R', 'S', 'S', 'S', 'L'],
      next: 0,
    })
  })

  it('reports an empty table for a program with no states', () => {
    const i = new StateIndex({ ...program(), states: [] })
    expect(i.rowCount).toBe(0)
    expect(i.row(0)).toBeNull()
  })

  // The binary search must be O(log n), and correct at scale is the half a test can check.
  it('resolves correctly at 33,699 states, which is list60', () => {
    const states = Array.from({ length: 33_699 }, (_, s) => st(`s${s}`, 2))
    const i = new StateIndex({ ...program(), states })
    expect(i.rowCount).toBe(33_699 * 3)
    expect(i.rowOfState(33_698)).toBe(33_698 * 3)
    expect(i.row(33_698 * 3)).toMatchObject({ kind: 'state', id: 33_698 })
    expect(i.row(33_698 * 3 + 2)).toMatchObject({ kind: 'rule', stateId: 33_698, ruleIndex: 1 })
  })
})

describe('highlight', () => {
  it('names the state header row and the rule row beneath it', () => {
    const i = new StateIndex(program())
    expect(highlight(i, frame({ state: 2, rule: 1 }))).toEqual({ stateRow: 5, ruleRow: 7 })
  })

  it('names the header alone when no rule matches', () => {
    const i = new StateIndex(program())
    expect(highlight(i, frame({ state: 1, rule: null }))).toEqual({ stateRow: 4, ruleRow: -1 })
  })

  it('highlights nothing without a frame', () => {
    expect(highlight(new StateIndex(program()), null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && pnpm run test:node -- state-table`
Expected: FAIL — cannot resolve `../../src/state-table`.

- [ ] **Step 3: Implement it**

Create `web/src/state-table.ts`:

```ts
import type { Move, TmProgram, TmState } from './types'

/** One table row. A state and a rule are both rows because `virtual-list.ts` needs a fixed row height. */
export type Row =
  | { kind: 'state'; id: number; name: string; accept: boolean }
  | {
      kind: 'rule'
      stateId: number
      ruleIndex: number
      read: (string | null)[]
      write: (string | null)[]
      moves: Move[]
      next: number
    }

/**
 * A prefix-sum index over `TmProgram`, and the resolution of a row number across it.
 *
 * NOT A FLATTENED ARRAY, AND THE MEASUREMENT IS WHY. `list60` is 33,699 states and 94,182 rules —
 * 127,881 rows (design §3.1) — so materializing one object per row is 12-25 MB to hold a list of which
 * ~40 are on screen, duplicating fields `tmProgram` is already holding. `rowStart` is one `Int32Array`
 * of 33,699 entries instead: 135 KB, and a row resolves by binary search.
 *
 * BUILT ONCE PER COMPILE, never per step, which is the property `tmProgram` already has and for the
 * same reason (`protocol.ts:142-144`). Only the highlight moves.
 */
export class StateIndex {
  #program: TmProgram
  /** `#rowStart[s]` is the row index of state `s`'s HEADER row. Its rules follow it. */
  #rowStart: Int32Array
  #rowCount: number

  constructor(program: TmProgram) {
    this.#program = program
    this.#rowStart = new Int32Array(program.states.length)
    let acc = 0
    for (let s = 0; s < program.states.length; s += 1) {
      this.#rowStart[s] = acc
      acc += 1 + (program.states[s]?.rules.length ?? 0)
    }
    this.#rowCount = acc
  }

  get rowCount(): number {
    return this.#rowCount
  }

  rowOfState(s: number): number {
    return this.#rowStart[s] ?? 0
  }

  /** The row at `i`, or `null` when `i` is outside the table. Never clamps — a clamp would draw a real row for a bad index. */
  row(i: number): Row | null {
    if (i < 0 || i >= this.#rowCount) return null
    const s = this.#stateAt(i)
    const start = this.#rowStart[s] ?? 0
    const state = this.#program.states[s]
    if (state === undefined) return null
    if (i === start) return { kind: 'state', id: s, name: state.name, accept: state.accept }
    const ruleIndex = i - start - 1
    const r = state.rules[ruleIndex]
    if (r === undefined) return null
    return { kind: 'rule', stateId: s, ruleIndex, read: r.read, write: r.write, moves: r.moves, next: r.next }
  }

  /** The largest `s` with `rowStart[s] <= i`. `rowStart` is non-decreasing by construction, so this is a binary search. */
  #stateAt(i: number): number {
    let lo = 0
    let hi = this.#rowStart.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((this.#rowStart[mid] ?? 0) <= i) lo = mid
      else hi = mid - 1
    }
    return lo
  }
}

/**
 * Which rows the current frame highlights.
 *
 * `ruleRow` is `-1` when `frame.rule` is null — at an accept state, at `halt`, or stuck. That is a real
 * answer about the run rather than a missing one, so it is a distinguishable value rather than an
 * absent field.
 */
export function highlight(index: StateIndex, frame: TmState | null): { stateRow: number; ruleRow: number } | null {
  if (frame === null) return null
  const stateRow = index.rowOfState(frame.state)
  return { stateRow, ruleRow: frame.rule === null ? -1 : stateRow + 1 + frame.rule }
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd web && pnpm run test:node -- state-table`
Expected: PASS, 13 tests.

- [ ] **Step 5: Kill two mutants**

1. `if (i === start)` → `if (i <= start + 1)`. Must fail a resolution test.

   **Not `i <= start`, which is an EQUIVALENT mutant and cannot be killed.** `#stateAt` returns the
   largest `s` with `rowStart[s] <= i`, so `start <= i` holds by construction at that comparison and
   `i <= start` is provably identical to `i === start`. `start + 1` is the real defect, and it is the
   one the test's own comment describes: every state's rule 0 rendered as a header.
2. `ruleIndex = i - start - 1` → `i - start`. Must fail `resolves a header row, its first rule, and its last rule`.

Apply, confirm failure, revert, confirm green.

- [ ] **Step 6: Commit**

```bash
git add web/src/state-table.ts web/tests/node/state-table.test.ts
git commit -m "web: the state table as an index, not 127,881 row objects"
```

---

## Task 5: follow

**Files:**
- Modify: `web/src/state-table.ts`, `web/tests/node/state-table.test.ts`

**Interfaces:**
- Produces: `class Follow` with `following: boolean`, `attach()`, `onProgrammaticScroll(top: number)`, `onScroll(top: number): void`, `targetScrollTop(stateRow, rowHeight, viewportHeight, totalHeight): number | null`

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/node/state-table.test.ts`:

```ts
describe('Follow', () => {
  it('follows by default and centres the current row', () => {
    const f = new Follow()
    expect(f.following).toBe(true)
    // row 100 of 24px, 240px viewport: centre puts its top at 2400 - 120 + 12 = 2292.
    expect(f.targetScrollTop(100, 24, 240, 10_000)).toBe(2292)
  })

  it('clamps the target at both ends rather than scrolling out of the document', () => {
    const f = new Follow()
    expect(f.targetScrollTop(0, 24, 240, 10_000)).toBe(0)
    expect(f.targetScrollTop(416, 24, 240, 10_000)).toBe(10_000 - 240)
  })

  it('proposes nothing once detached', () => {
    const f = new Follow()
    f.onScroll(500)
    expect(f.following).toBe(false)
    expect(f.targetScrollTop(100, 24, 240, 10_000)).toBeNull()
  })

  // THE TRAP IN THIS FILE. Following SETS scrollTop, the browser fires `scroll` for it, and a naive
  // handler reads its own write as the user taking control — so following detaches on the first frame
  // and never works again. Nothing about it looks broken; the table simply stops following.
  it('does not detach on the scroll event its own write caused', () => {
    const f = new Follow()
    const top = f.targetScrollTop(100, 24, 240, 10_000)
    expect(top).not.toBeNull()
    if (top === null) return
    f.onProgrammaticScroll(top)
    f.onScroll(top)
    expect(f.following).toBe(true)
  })

  it('still detaches on a real scroll that follows a programmatic one', () => {
    const f = new Follow()
    f.onProgrammaticScroll(2292)
    f.onScroll(2292)
    f.onScroll(40)
    expect(f.following).toBe(false)
  })

  it('reattaches on demand', () => {
    const f = new Follow()
    f.onScroll(500)
    f.attach()
    expect(f.following).toBe(true)
    expect(f.targetScrollTop(100, 24, 240, 10_000)).toBe(2292)
  })
})
```

Add `Follow` to the import at the top of the file.

- [ ] **Step 2: Run and watch it fail**

Run: `cd web && pnpm run test:node -- state-table`
Expected: FAIL — `Follow` is not exported.

- [ ] **Step 3: Implement it**

Append to `web/src/state-table.ts`:

```ts
/**
 * Whether the table tracks the machine, and where it should scroll to when it does.
 *
 * THE MODEL IS `history.ts`'s `#following`, deliberately — the table and the play head are the same
 * idea about the same run, and a second idiom for it would be a second set of bugs. 5a-i's reviews
 * found both of that field's: a clamped movement that left the flag set, and an unguarded clear that
 * detached against an empty pane.
 *
 * THE TRAP HERE IS DIFFERENT AND IS THIS FILE'S OWN. Following writes `scrollTop`, the browser fires a
 * `scroll` event for that write, and a handler that treats every event as user intent detaches on the
 * first frame it ever follows. `#expected` is what distinguishes the echo of our own write from a
 * user's scroll; the tolerance is half a row because a browser may land a fractional pixel off.
 */
export class Follow {
  #following = true
  #expected: number | null = null

  get following(): boolean {
    return this.#following
  }

  attach(): void {
    this.#following = true
  }

  /** Record a scrollTop this code is about to write, so its echo is not read as user intent. */
  onProgrammaticScroll(top: number): void {
    this.#expected = top
  }

  onScroll(top: number): void {
    if (this.#expected !== null && Math.abs(top - this.#expected) <= 12) {
      this.#expected = null
      return
    }
    this.#expected = null
    this.#following = false
  }

  /** Where to scroll so `stateRow` is centred, or `null` when not following. Clamped into the document. */
  targetScrollTop(stateRow: number, rowHeight: number, viewportHeight: number, totalHeight: number): number | null {
    if (!this.#following) return null
    const centred = stateRow * rowHeight - Math.floor(viewportHeight / 2) + Math.floor(rowHeight / 2)
    return Math.max(0, Math.min(centred, Math.max(0, totalHeight - viewportHeight)))
  }
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd web && pnpm run test:node -- state-table`
Expected: PASS, 19 tests.

- [ ] **Step 5: Kill the mutant that matters**

Delete the `#expected` check in `onScroll` (make every event detach). Must fail `does not detach on the scroll event its own write caused`. Revert, confirm green.

- [ ] **Step 6: Commit**

```bash
git add web/src/state-table.ts web/tests/node/state-table.test.ts
git commit -m "web: the table follows the machine, and does not read its own scroll as a user's"
```

---

## Task 6: the pane — DOM, toggle, CSS

**Files:**
- Modify: `web/src/tm-pane.ts`, `web/src/style.css`

**Interfaces:**
- Consumes: `visibleWindow`, `StateIndex`, `highlight`, `Follow`, `TmState.rule`
- Produces: a `TmPane` that renders the table; `ROW_HEIGHT = 24` and `OVERSCAN = 4` exported from `tm-pane.ts` so the browser tier can compute expected node counts rather than hardcode them

- [ ] **Step 1: Replace `tm-pane.ts`'s module doc and add the table**

Change the module doc's third paragraph (`tm-pane.ts:13-15`) from the 5a-ii deferral to what shipped:

```ts
/**
 * The TM pane: five tape rows, a status line, and the δ function as a virtualized table.
 *
 * FIVE ROWS, NOT ONE. §6.1's mockup shows a single tape; the lowering emits `TAPES = 5` and showing
 * them together is the point — you cannot watch STACK move while REG is read otherwise.
 *
 * THE TABLE IS VIRTUALIZED BECAUSE `list60` IS 127,881 ROWS (design §3.1). The `[1, 2]` fixture's 455
 * rows, which sized this feature until it was measured, is 0.4% of that.
 */
```

- [ ] **Step 2: Add the fields, the DOM, and the constants**

Add above the class:

```ts
/** Rows rendered beyond the viewport on each side, so a fast scroll does not show blank space. */
export const OVERSCAN = 4
```

**`ROW_HEIGHT` is NOT defined here — import it from `./state-table`.** It moved there when Task 5's
review found `Follow`'s echo tolerance was a bare `12` with nothing tying it to the row height it
claims to be half of. The table's row geometry belongs to the table module; `virtual-list.ts` stays
generic and takes `rowHeight` as a parameter. Add it to the existing import:

```ts
import { Follow, highlight, ROW_HEIGHT, StateIndex } from './state-table'
```

and re-export it so Task 7 has one place to import both constants from:

```ts
export { ROW_HEIGHT } from './state-table'
```

Add to the class fields:

```ts
  #tableHost: HTMLElement
  #spacer: HTMLElement
  #rows: HTMLElement
  #toggle: HTMLButtonElement
  #index: StateIndex | null = null
  #follow = new Follow()
  #open = true
```

In the constructor, after `this.#strip = controlStrip(on)`:

```ts
    this.#toggle = document.createElement('button')
    this.#toggle.type = 'button'
    this.#toggle.className = 'table-toggle'
    this.#toggle.textContent = 'hide δ'
    this.#toggle.addEventListener('click', () => {
      this.#open = !this.#open
      this.#toggle.textContent = this.#open ? 'hide δ' : 'show δ'
      this.#tableHost.hidden = !this.#open
    })

    this.#rows = document.createElement('div')
    this.#rows.className = 'state-rows'
    this.#spacer = document.createElement('div')
    this.#spacer.className = 'state-spacer'
    this.#spacer.append(this.#rows)
    this.#tableHost = document.createElement('div')
    this.#tableHost.className = 'state-table'
    this.#tableHost.append(this.#spacer)
    this.#tableHost.addEventListener('scroll', () => {
      this.#follow.onScroll(this.#tableHost.scrollTop)
      this.#drawTable()
    })

    host.replaceChildren(title, this.#status, this.#tapes, this.#toggle, this.#tableHost, this.#strip.el)
```

Note the order: `#tableHost` must exist before the constructor's `replaceChildren`, and the `scroll`
listener must be attached before any frame arrives.

- [ ] **Step 3: Build the index in `setProgram`, and keep the last frame**

```ts
  setProgram(p: TmProgram | null, names: string[]): void {
    this.#program = p
    this.#names = names
    this.#index = p === null ? null : new StateIndex(p)
    this.#follow.attach()
    // `onProgrammaticScroll` BEFORE the write, not after, and not omitted. Setting `scrollTop` fires a
    // `scroll` event; without a pending expectation `Follow` reads it as the user taking control and
    // detaches on the spot — so the table would never follow after a compile. Intermittent, too: no
    // event fires when `scrollTop` was already 0, so it would work on the first program and fail on
    // every one after a scroll. Found by Task 5's re-review before this code was written.
    this.#follow.onProgrammaticScroll(0)
    this.#tableHost.scrollTop = 0
    this.#frame = null
    this.#drawTable()
  }
```

Add `#frame: TmState | null = null` to the fields — the scroll handler redraws without a new frame, so
the pane has to remember the one it is drawing.

- [ ] **Step 4: Render the table each frame**

In `render`, set `this.#frame = frame` at the top (before the null return), and call
`this.#drawTable()` at the end of both branches. Then add:

```ts
  /**
   * Draw only the rows in view. Called on every frame AND on every scroll, so it must stay O(visible)
   * rather than O(rowCount) — 127,881 rows is the number that decides it.
   */
  #drawTable(): void {
    if (this.#index === null) {
      this.#rows.replaceChildren()
      this.#spacer.style.height = '0px'
      return
    }

    const marks = highlight(this.#index, this.#frame)
    if (marks !== null) {
      const top = this.#follow.targetScrollTop(
        marks.stateRow,
        ROW_HEIGHT,
        this.#tableHost.clientHeight,
        this.#index.rowCount * ROW_HEIGHT,
      )
      if (top !== null && top !== this.#tableHost.scrollTop) {
        this.#follow.onProgrammaticScroll(top)
        this.#tableHost.scrollTop = top
      }
    }

    const w = visibleWindow(
      this.#index.rowCount,
      ROW_HEIGHT,
      this.#tableHost.clientHeight,
      this.#tableHost.scrollTop,
      OVERSCAN,
    )
    this.#spacer.style.height = `${w.totalHeight}px`
    this.#rows.style.transform = `translateY(${w.offsetY}px)`

    const els: HTMLElement[] = []
    for (let i = w.firstIndex; i <= w.lastIndex; i += 1) {
      const row = this.#index.row(i)
      if (row === null) continue
      const el = document.createElement('div')
      el.className = 'state-row'
      if (row.kind === 'state') {
        el.classList.add('is-state')
        if (row.accept) el.classList.add('is-accept')
        el.textContent = row.name
      } else {
        el.classList.add('is-rule')
        const cell = (v: string | null) => v ?? '*'
        el.textContent = `[${row.read.map(cell).join(' ')}] → [${row.write.map(cell).join(' ')}] ${row.moves.join(' ')} → ${
          this.#program?.states[row.next]?.name ?? row.next
        }`
      }
      if (marks !== null && i === marks.stateRow) el.classList.add('is-current')
      if (marks !== null && i === marks.ruleRow) el.classList.add('is-firing')
      els.push(el)
    }
    this.#rows.replaceChildren(...els)
  }
```

Add the imports at the top of the file:

```ts
import { Follow, highlight, StateIndex } from './state-table'
import { visibleWindow } from './virtual-list'
```

- [ ] **Step 5: Add the CSS**

Append to `web/src/style.css`:

```css
/* `--accent-soft` DOES NOT EXIST in the palette PR #20 landed — the variables are `--bg`,
   `--bg-raised`, `--fg`, `--fg-dim`, `--rule`, `--accent`, and the `--tok-*` set. Mixed from `--accent`
   rather than added to the palette: this is one feature's highlight, and PR #20's whole point was a
   palette that does not say everything twice. Both operands are `light-dark()`, so the mix is
   theme-aware without a second declaration. */
.table-toggle {
  font-size: var(--step--1);
  margin-block-start: var(--space-2);
}

/* `.pane` is `overflow: auto` and NOT a flex column (style.css:96-98), so the table cannot size itself
   with `flex: 1 1 auto` — it needs an explicit bound or it grows to its full 3,069,144px. */
.state-table {
  overflow-y: auto;
  max-height: 40vh;
  margin-block-start: var(--space-2);
  border-top: 1px solid var(--rule);
  font-family: var(--font-mono);
  font-size: var(--step--2);
}

.state-spacer {
  position: relative;
}

.state-rows {
  position: absolute;
  inset-inline: 0;
  top: 0;
  will-change: transform;
}

/* MUST equal ROW_HEIGHT in tm-pane.ts. virtual-list.ts's offset arithmetic assumes it exactly, and a
   mismatch drifts the rows out from under the scrollbar without any test noticing. */
.state-row {
  height: 24px;
  line-height: 24px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-inline: 0.5rem;
}

.state-row.is-state {
  font-weight: 600;
}

.state-row.is-accept::after {
  content: ' · accept';
  opacity: 0.6;
  font-weight: 400;
}

.state-row.is-rule {
  padding-inline-start: 1.5rem;
  opacity: 0.85;
}

.state-row.is-current {
  background: color-mix(in oklab, var(--accent) 14%, var(--bg));
}

.state-row.is-firing {
  background: color-mix(in oklab, var(--accent) 24%, var(--bg));
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
```

- [ ] **Step 6: Typecheck, lint, and run everything**

Run: `cd web && pnpm run typecheck && pnpm exec biome ci . && pnpm test`
Expected: all pass, **node 137, browser 36, total 173**. (Baseline before this plan was node 109,
browser 36. Task 3 added 9, Task 4 added 13, Task 5 added 6 — all node. This task adds none.)

- [ ] **Step 7: Look at it in a real browser**

Run: `cd web && pnpm run dev`, then drive Chromium via Playwright (there is no interactive display on
this host — 5a-i's Tasks 10/11 did the same). Confirm by eye, and record the result in the report:

1. The table renders beside the tapes and scrolls.
2. The current state row is highlighted, and the firing rule row beneath it is outlined.
3. Stepping moves the highlight, and the table follows.
4. Scrolling away stops the following; the toggle hides and shows the table.
5. A program that declines the TM leg (`let x = 200; x + 1` under unary — design §11.9) shows no table
   and does not throw.

- [ ] **Step 8: Commit**

```bash
git add web/src/tm-pane.ts web/src/style.css
git commit -m "web: the δ function, drawn — virtualized rows, the firing rule outlined"
```

---

## Task 7: the browser tier

**Files:**
- Modify: `web/tests/browser/app.test.ts`

**Interfaces:**
- Consumes: `ROW_HEIGHT`, `OVERSCAN` from `../../src/tm-pane`

- [ ] **Step 1: Write the tests**

Add these cases **inside `app.test.ts`'s existing `describe('stepping', …)` block** (`app.test.ts:237`).
Not at module scope and not as a sibling describe: a static `import { ready }` runs `main()` at
module-eval time, before `beforeAll` mounts the DOM shell, and the outer `beforeAll` only runs for
tests inside the describe it is declared in. 5a-i's Task 12 verified that the un-nested form fails all
its cases. Nesting inside `stepping` also gives you its four helpers, which are the ones to use —
**`runSource`, `tmForward` and `tmStepText` do not exist**:

| use | not |
| --- | --- |
| `await settled(view, SRC)` | `runSource(SRC)` |
| `click('tm', '▶')` | `tmForward()` |
| `stepText('tm')` | `tmStepText()` |

Scope every selector to `#tm`, as the existing tape tests do (`#tm .tape-label`).

```ts
    // NOT `[1, 2]`. Its 455 rows would render acceptably unvirtualized, so it cannot demonstrate the
    // one property this table exists for. `map_fold` is 25,852 rows (design §3.1).
    const BIG = `fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }
fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }
fn add(a, b) { a + b }
fn add1(x) { x + 1 }
fold([3, 1, 2].map(add1), 0, add)`

    const table = () => document.querySelector('#tm .state-table') as HTMLElement
    const spacer = () => document.querySelector('#tm .state-spacer') as HTMLElement

    it('renders only the visible rows, not the whole machine', async () => {
      await settled(view, BIG)
      const rows = document.querySelectorAll('#tm .state-row')
      // THE SCROLL CONTAINER MUST ACTUALLY BE BOUNDED, and this asserts it rather than assuming it.
      // `.state-table`'s `max-height: 40vh` is what bounds it, and Vitest serves its own tester HTML —
      // `tests/browser/setup.ts` is what gets `style.css` onto that page. If that setup ever breaks,
      // the box lays out at its full content height (measured: 271,968px for 11,332 rows), `TmPane`'s
      // clamp takes over, and every assertion below would be checking the fallback rather than the
      // geometry the app ships. This is the line that fails first when that happens.
      expect(table().clientHeight).toBeLessThan(window.innerHeight)
      expect(table().clientHeight * 10).toBeLessThan(Number.parseInt(spacer().style.height, 10))
      const bound = Math.ceil(table().clientHeight / ROW_HEIGHT) + 1 + 2 * OVERSCAN
      expect(rows.length).toBeLessThanOrEqual(bound)
      // The property, stated as the thing it is: far fewer rows than the machine has. `map_fold` is
      // 25,852, so a renderer that drew them all would fail this by two orders of magnitude.
      expect(rows.length).toBeLessThan(200)
      // The spacer carries the full scrollable height, which is what makes the scrollbar honest about
      // a machine only ~40 of whose rows exist in the DOM.
      expect(Number.parseInt(spacer().style.height, 10)).toBeGreaterThan(100_000)
    })

    it('highlights the current state and outlines the rule about to fire', async () => {
      await settled(view, 'let x = 40; x + 2')
      expect(document.querySelectorAll('#tm .state-row.is-current').length).toBe(1)
      expect(document.querySelectorAll('#tm .state-row.is-firing').length).toBe(1)
    })

    it('moves the highlight as the machine steps', async () => {
      await settled(view, 'let x = 40; x + 2')
      const before = document.querySelector('#tm .state-row.is-current')?.textContent
      // Several steps, not one: a machine can re-enter the same state, so a single ▶ proves nothing.
      for (let i = 0; i < 8; i += 1) click('tm', '▶')
      expect(document.querySelector('#tm .state-row.is-current')?.textContent).not.toBe(before)
    })

    it('stops following once the user scrolls', async () => {
      await settled(view, BIG)
      table().scrollTop = 0
      table().dispatchEvent(new Event('scroll'))
      const parked = table().scrollTop
      for (let i = 0; i < 5; i += 1) click('tm', '▶')
      expect(table().scrollTop).toBe(parked)
    })

    it('hides and shows the table without losing the play head', async () => {
      await settled(view, 'let x = 40; x + 2')
      for (let i = 0; i < 4; i += 1) click('tm', '◀')
      const step = stepText('tm')
      const toggle = document.querySelector('#tm .table-toggle') as HTMLButtonElement
      toggle.click()
      expect(table().hidden).toBe(true)
      toggle.click()
      expect(stepText('tm')).toBe(step)
    })

    it('shows no table for a program that declines the TM leg', async () => {
      // §11.9's known one-leg program: `200` under unary overflows the TM leg and leaves λ steppable.
      await settled(view, 'let x = 200; x + 1')
      expect(document.querySelectorAll('#tm .state-row').length).toBe(0)
    })
```

Import `ROW_HEIGHT` and `OVERSCAN` from `../../src/tm-pane` at the top of the file.

**`◀` rather than `▶` in the toggle test, deliberately.** By the time `settled` resolves, recording has
finished and the head sits at the frontier where `▶` extends rather than steps (5a-i's Task 12 finding).
`◀` moves the head without touching the worker, which is what this test needs.

- [ ] **Step 2: Run the browser project**

Run: `cd web && pnpm run test:browser`
Expected: PASS, **36 → 42**.

- [ ] **Step 3: Run the whole gate**

```bash
cd web && pnpm test && pnpm run typecheck && pnpm exec biome ci .
wasm-pack test --headless --chrome crates/redextape-wasm
./scripts/check-all.sh --no-llvm
pre-commit run --all-files
```

Expected: **web 179 (node 137, browser 42)**, wasm 13/13, `check-all.sh` green and reporting PARTIAL by
design, pre-commit green.

- [ ] **Step 4: Commit**

```bash
git add web/tests/browser/app.test.ts
git commit -m "web: the browser tier for the state table, on a program large enough to need it"
```

---

## Task 8: the record

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-plan5a-ii-state-table-design.md`, `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, `README.md`

- [ ] **Step 1: Close the design's open items in place**

In the design: strike §5.1 with the browser tier's verdict on clutter and speed, and say whether §3.8's
default-open survived. If it flipped to default-closed, say so and why — a silent flip is the one
outcome §3.8 rules out. Record the pre-flight correction (`Option<usize>`, not `Option<u32>`) against
§3.5 so the next reader does not re-derive it.

- [ ] **Step 2: Write the roadmap entry**

Append a `#### PLAN 5a-ii CLOSES` section under Plan 5, in the voice of the 5a-i entry
(`roadmap:3397-3507`). It must carry, because these are the slice's transferable results and nothing
else records them:

- **The λ tree is cut, with §2's numbers.** 850 MB against a 32 MB ring; 84% of steps refusing at
  65,536 nodes and still 71% at 524,288; and the sentence worth carrying — **text truncates, trees
  refuse**, so `FRAME_BYTES`' lever does not exist for a node budget.
- **The arena's §9.3 deletion question reopens** on §2.4's narrow grounds: `TermTree` is a fine shape
  with no consumer, not a wrong one.
- **The `[1, 2]` fixture was 0.4% of the real scale.** 455 rows against `list60`'s 127,881, and the row
  array became a row index because of it.
- **§2.1's lesson landed twice in one day on two different quantities**: a corpus chosen to be
  representative could not falsify either bound, and both fell to the first program written to attack
  the bound that actually existed.
- The gate numbers from Task 7 Step 3.

- [ ] **Step 3: Update the README**

Describe the table as shipped, beside the existing tape-pane description. Say the tree is not built and
point at the design section that says why, rather than leaving its absence to be read as an oversight.

- [ ] **Step 4: Verify the docs against the tree**

Run: `pre-commit run --all-files`
Expected: green. Then re-read each figure quoted in the roadmap entry against the design and the
probe's own output — 5a-i's final review found a report miscounting its own fix total, and quoted
numbers drift the same way.

- [ ] **Step 5: Commit**

```bash
git add docs/ README.md
git commit -m "docs: 5a-ii's record — the table as shipped, and the two bounds a corpus could not falsify"
```

---

## Self-Review

**Spec coverage.** §2 (the cut) → Tasks 1-8 do not build a tree, and Task 8 Step 2 records why. §3.1
(scale) → Task 4's 33,699-state test and Task 7's `map_fold` fixture. §3.2 (index) → Task 4. §3.3
(`virtual-list.ts`) → Task 3. §3.4 (`state-table.ts`) → Tasks 4, 5. §3.5 (`TmState.rule`) → Task 1,
with the `usize` correction stated in Pre-flight. §3.6 (boundary) → Task 2. §3.7 (follow) → Task 5,
with the programmatic-scroll trap the design did not name. §3.8 (toggle) → Task 6 Step 2, Task 7. §4
(testing) → the test steps of Tasks 1, 3, 4, 5, 7, including the mutation steps §4 calls for. §5.1
(clutter risk) → Task 8 Step 1. §6 (hand-off) → Task 8 Step 2.

**Placeholder scan.** No TBD, no "add error handling", no "similar to Task N". Every code step carries
its code. Task 6 Step 5's CSS-variable fallback names a concrete action and a concrete disclosure
rather than deferring a decision.

**Type consistency.** `TmState.rule` is `Option<usize>` in Rust and `number | null` in TypeScript,
consistently in Tasks 1, 2, 4, 5. `StateIndex` exposes `rowCount`, `rowOfState`, `row` in Tasks 4, 5,
6 with the same names. `visibleWindow`'s five parameters are in the same order at every call site.
`Follow`'s four methods match between Tasks 5 and 6. `ROW_HEIGHT`/`OVERSCAN` are defined in Task 6 and
imported in Task 7. `highlight` returns `{ stateRow, ruleRow }` in Tasks 4, 6.

**One gap found and closed:** Task 6 Step 3 needed a `#frame` field the design never mentions, because
the scroll handler redraws without a new frame arriving. Added to the step rather than left to the
implementer to discover mid-task.
