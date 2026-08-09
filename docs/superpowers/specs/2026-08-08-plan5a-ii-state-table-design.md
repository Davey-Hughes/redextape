# Plan 5a-ii — the virtualized state table, and why the λ tree is not here

Predecessor: [`2026-08-07-plan5a-panes-and-history-design.md`](2026-08-07-plan5a-panes-and-history-design.md)
(§4.3, §4.5, §8, §11.5, §11.7, §12), landed as PR #17.

Plan 5a was split into two PRs, and 5a-ii was defined as **the λ structural tree and the virtualized
state table** — the two pieces §10 identified as independently droppable. One of them is now dropped,
by measurement rather than by argument, and this document is mostly about why.

---

## 1. What the measurement changed

§8's constants table has carried one unmeasured row since 5a-i:

| constant | value | basis |
| --- | --- | --- |
| `LAMBDA_TREE_NODES` | unmeasured | 5a-ii; `lambdaAst` was not exercised by this probe |

Section F of `crates/redextape-core/examples/frame_cost_probe.rs` now exercises it, under the same
`systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0` the rest of §8 was measured under.
**The λ structural tree is cut.** §11.7 pre-committed to this outcome — *"if collapsing is not enough,
the tree is a worse view than the text and 5a-ii should say so rather than ship it"* — and §2 below is
that saying-so.

**5a-ii is therefore `virtual-list.ts`, `state-table.ts`, and one field on `TmState`.**

---

## 2. `lambdaAst` — measured, and the feature does not survive it

### 2.1 The corpus could not falsify this, and the program written to attack it did so immediately

The probe's nine programs include three — `num200`, `list20`, `list60` — added in 5a-i specifically to
defeat a bound, on the roadmap's standing lesson that a representative corpus cannot break one. **They
attack the wrong bound here.** All three make a single *frame* large; a per-frame tree history is
bounded by frame size × **step count**, and every program in that corpus runs in the hundreds of
β-steps at most. Measured at `LAMBDA_TREE_NODES = 65_536`, all nine look affordable:

| program | steps | µs/step | refused | avg tree | whole history |
| --- | --- | --- | --- | --- | --- |
| `sample` | 7 | 1.68 | 0.0% | 1,277 B | 0.0 MB |
| `list2` | 4 | 1.06 | 0.0% | 437 B | 0.0 MB |
| `num200` | 7 | 3.98 | 0.0% | 5,724 B | 0.0 MB |
| `list20` | 40 | 7.20 | 0.0% | 9,295 B | 0.4 MB |
| `sum5` | 626 | 12.24 | 0.0% | 12,249 B | 7.7 MB |
| `list60` | 120 | 35.17 | 0.0% | 64,936 B | 7.8 MB |
| `map_fold` | 555 | 19.34 | 0.0% | 21,484 B | 11.9 MB |
| `countdown4` | 474 | 35.77 | 0.0% | 43,075 B | 20.4 MB |
| `while4` | 470 | 39.88 | 0.0% | 47,731 B | 22.4 MB |

Zero refusals everywhere, and the worst whole-history figure fits inside `HISTORY_BYTES`' 32 MB per
leg. On this evidence the feature ships.

`while40` — **the same program as `while4` with `n = 40` instead of `n = 4`** — was added because it
attacks the bound that actually exists. It is not adversarial and it is not exotic; it is a counting
loop:

```
let mut n = 40; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc
```

| `LAMBDA_TREE_NODES` | µs/step | refused | max nodes | avg tree | largest single tree | whole history |
| --- | --- | --- | --- | --- | --- | --- |
| 1,024 | 15.71 | **99.7%** | 936 | 12,084 B | 14,028 B | 0.8 MB |
| 8,192 | 102.18 | **93.4%** | 7,763 | 55,760 B | 123,174 B | **73.2 MB** |
| 65,536 | 731.65 | **84.0%** | 62,083 | 264,727 B | 1,044,937 B | **849.5 MB** |
| 524,288 | 4,941.62 | **70.8%** | 496,643 | 1,599,704 B | 8,833,580 B | **9,334.3 MB** |

Every row stopped at `STEP_LIMIT = 20_000`, so **the real run is longer than any figure above.**

### 2.2 Two independent failures, and the second is the one that kills it

**Recording a tree per frame costs 850 MB against a 32 MB ring**, at 731.65 µs/step against the text
frame's 5.77 µs at `FRAME_BYTES = 512` — 127× the per-step cost of the thing already being recorded.
That alone rules out per-frame trees.

**The second failure removes the fallback.** A frontier-only tree — build the tree for the newest step
only, never record one — costs nothing and needs no protocol change, and it *still* does not work:
**at every budget, most steps have no tree at all.** 84.0% refused at 65,536; even at 524,288 nodes,
70.8% of steps have nothing to draw. And the escape is closed at both ends, because the two levers move
against each other: raising the budget to cut refusals raises per-step cost superlinearly (15.71 →
102.18 → 731.65 → 4,941.62 µs) while the trees that *do* build reach 496,643 nodes, which is not a
thing a person reads. **There is no budget at which the tree is both usually-available and
affordable.**

### 2.3 Why `FRAME_BYTES`' trick does not transfer, which is the transferable lesson

5a-i's largest win was finding that history frames want a much smaller budget than the readout does —
`FRAME_BYTES = 512` against `LAMBDA_BYTE_BUDGET`'s 65,536, 10-31× faster and ~22× smaller (§3.2). The
obvious move here is the same one: a small `LAMBDA_TREE_NODES` for frames, a large one for the term in
front of you.

It does not transfer, and the reason is a deliberate design decision one layer down. **Text truncates;
trees refuse.** `print_lambda_capped` short-circuits and returns a visibly-truncated string, so a
smaller budget buys speed and memory together. `LambdaState::ast` returns `None` rather than a partial
tree, on the stated grounds that *"a truncated AST is a lie about the term's shape, and a partial arena
would be the same lie with an index on it"* (`viewmodel.rs:203`). That decision is correct and is not
being questioned — but it means the small-budget lever produces *absence* rather than *abbreviation*,
which the refusal column shows directly: at 1,024 nodes `while40`'s history is a tidy 0.8 MB because
99.7% of its frames are empty.

### 2.4 What this settles for the arena, which is what PR #15 asked for

§12 committed to a verdict: *"Settled: whether an arena is the shape a renderer wants (§4.3), by
building the renderer rather than by reasoning about it. If the answer is no, the arena design's §9.3
deletion question **reopens** rather than staying settled by this slice's silence."*

The verdict is not about the arena. `TermTree` is a fine shape — flat, index-addressed, non-recursive
on every derived path, which is exactly what it was built for, and section F drove it hard enough to
find no fault of that kind. **What fails is `lambdaAst` as a per-frame or per-step export**, and it
fails on cost and availability, neither of which an arena-vs-boxed-tree choice would change; a
`Box`-based tree at 496,643 nodes would be worse on both, plus the trap the arena exists to avoid.

So: **the arena's §9.3 deletion question reopens, because it has no consumer, not because its shape was
wrong.** That distinction should be carried into whatever decides it, and this document is where it is
recorded rather than left to be re-derived.

### 2.5 What would make a λ tree buildable, recorded so it is not re-derived

Not in this slice, and not costed here. **The producer would have to collapse, not the renderer.** §4.3
assumed a full tree crossing the boundary and collapsing in `tree.ts`; the measurement says the tree
cannot cross the boundary at all. An `ast` that elides subtrees below a depth — returning the top *k*
levels with markers for what was cut — is cheap by construction, always available, and is what a reader
wants anyway. It needs a `viewmodel.rs` change, a wasm export, a boundary shape test, and an
expand-a-subtree path that re-asks the live cursor. That is its own slice, and it is only worth taking
if someone wants the view.

---

## 3. The state table

### 3.1 Scale — and the fixture that everyone has been quoting is not representative

§4.5 sized this feature from one number: `crates/redextape-core/tests/fixtures/list_1_2.tm`, the
two-element list literal `[1, 2]`, at **146 states and 309 rules.** That is the smallest program in the
corpus but one. Measured across all ten (`frame_cost_probe` section A, columns added for this design):

| program | states | rules | rows | vs. the fixture |
| --- | --- | --- | --- | --- |
| `sample` | 123 | 215 | 338 | 0.7× |
| `list2` | 146 | 309 | **455** | 1× |
| `while4` | 542 | 1,362 | 1,904 | 4× |
| `while40` | 578 | 1,398 | 1,976 | 4× |
| `sum5` | 1,182 | 2,782 | 3,964 | 9× |
| `countdown4` | 1,365 | 3,354 | 4,719 | 10× |
| `list20` | 4,439 | 11,802 | 16,241 | 36× |
| `map_fold` | 7,353 | 18,499 | 25,852 | 57× |
| `list60` | 33,699 | 94,182 | **127,881** | **281×** |

(`num200` declines the TM leg with `Overflow` — §11.9's known one-leg program — so it has no table.)

**Virtualization is not a nice-to-have at 127,881 rows, and §5.2's risk closes before the plan is
written.** It also kills the obvious row model.

### 3.2 The row model — an index, not an array

A state and a rule are both *rows*, because fixed row height is what makes `virtual-list.ts` possible —
it is offset arithmetic, `firstIndex = floor(scrollTop / rowHeight)` and the rest follows, and a state
block whose height varies with its rule count defeats every line of it.

**But the flattened array is not materialized.** 127,881 row objects for `list60` is 12-25 MB of
main-thread memory to hold a list of which ~40 are on screen, and it is pure duplication: every field
is already in `tmProgram`, which the main thread is holding anyway.

Instead, one **prefix-sum index** — `rowStart[s]` is the first row of state *s*, which is
`s + Σ rules[0..s]` — in a single `Int32Array`. `list60`'s index is 33,699 entries, **135 KB rather
than 127,881 objects.** Resolving row *i* is a binary search for the state owning it: `i ===
rowStart[s]` is that state's header row, anything else is rule `i - rowStart[s] - 1`. Only the visible
window is ever turned into the shape a renderer reads:

```ts
type Row =
  | { kind: 'state'; id: number; name: string; accept: boolean }
  | { kind: 'rule'; stateId: number; ruleIndex: number; read: (string | null)[];
      write: (string | null)[]; moves: Move[]; next: number }
```

The index is **built once per compile, never per step** — the same property `tmProgram` already has and
for the same reason, recorded at `protocol.ts:142-144`: it is ~123 states for `let x = 40; x + 2` and
putting it on a frame would send it 2,870 times. Only the highlight moves per step.

**A cost this makes visible without adding it:** `tmProgram` for `list60` is 94,182 rules crossing the
boundary in one structured clone. 5a-i already pays that on every compile — the table is what makes it
worth naming, not what causes it — and nothing here changes it.

### 3.3 `virtual-list.ts` — pure logic, no DOM

In: `rowHeight`, `viewportHeight`, `scrollTop`, `rowCount`, `overscan`. Out: `firstIndex`, `lastIndex`,
`offsetY`, `totalHeight`. Nothing else, and no library — §9's no-framework decision named this ~40-line
piece as the one genuinely hard thing, and it is the same work under any framework.

The DOM half is the standard shape: a spacer sized `totalHeight`, and a container translated by
`offsetY` holding only the rows in `[firstIndex, lastIndex]`.

It is node-tested with no browser, alongside `history.ts`, `controls.ts` and `tape.ts` — §2's file table
already lists it in that group.

### 3.4 `state-table.ts` — pure logic

Owns the index of §3.2 and the resolution across it. In: `tmProgram`, the frame's `state` and `rule`,
the follow flag, and the visible range `virtual-list.ts` computed. Out: that range resolved to `Row`s,
and which of them are highlighted. Also node-tested, also no DOM.

### 3.5 `TmState.rule` — the transition, resolved in Rust

**Pre-flight correction, recorded here so the next reader does not re-derive it:** every `Option<u32>`
below shipped as **`Option<usize>`**. `heads: Vec<usize>` and `window_start: Vec<usize>` already sit
beside `rule` on `TmState`, and Task 2 proved a `usize` field of this kind crosses the wasm32 boundary
as a plain JS number — the same evidence this section's own §3.6 leans on for `rule` itself. The type
below is left as originally drafted, struck rather than silently rewritten, so the correction is visible.

`TmState` gains `rule: ~~Option<u32>~~ Option<usize>`: the index into `states[state].rules` of the rule **about to fire**,
resolved by `sim::rule_matches` — first match wins, `None` in a `read` slot is a wildcard
(`sim.rs:179`). `TmCursor` already exposes both halves this needs, `tapes()` and `machine()`, and
`tm::sim` is `pub mod` within the crate, so `viewmodel.rs` calls the crate's real δ-matcher rather than
a second one.

**IT NAMES WHAT HAPPENS NEXT, NOT WHAT PRODUCED THIS ROW**, and that is worth stating because it is
exactly the off-by-one a review would otherwise find. `TmState::window` is built *after* the step, so
its tapes and its `state` are post-step; the first rule matching those tapes is the transition the
machine will take on the following step. `None` — at `halt`, at `accept`, or at a genuinely stuck
configuration — is a real signal about why the run stopped, not a missing value.

**Why in Rust rather than in TypeScript.** The alternative is cheap: the frame already carries `window`,
`heads` and `window_start`, so first-match-wins with wildcards is a dozen lines on the client. It is
also a second copy of the crate's only δ-matcher, in a language whose compiler cannot see the original —
the same class §5 refused when it exported `tapeNames()` rather than hand-copying five strings into
`types.ts`, and the same class 5a-i's Task 12 caught when `main.ts` re-derived, invertedly, what
`controls.ts` already owned. **A duplicated derivation is worse than a duplicated constant, because
nothing about it is obviously data.**

Cost: `Option<u32>` (shipped: `Option<usize>`) on a frame measured at ~300-800 bytes, against
`HISTORY_BYTES`' 32 MB per leg. Negligible, and stated rather than assumed.

This puts 5a-ii under the pre-commit clippy `-D warnings` gate, so the Rust half must be complete and
clean in whatever commit contains it — the constraint §5 recorded for `tapeNames()` and PR 3c's §11
before it.

### 3.6 The boundary

`types.ts` gains `rule: number | null` on `TmState`, and **a browser test pins it against real wasm
before anything consumes it.** §2's rule is that every shape is measured against
`crates/redextape-wasm/tests/browser.rs` rather than designed, and 5a-i's Task 2 is why it is worth
repeating: that task's own example test declared four shapes and asserted none of them, and a fifth
checked key presence rather than value type. `import type` is erased by esbuild before vitest resolves
the export, so **the red step for a type-only change is `pnpm run typecheck`, not `pnpm run
test:browser`** — a finding from the same task, carried here because this slice adds a type.

### 3.7 Follow

The current state changes every step, including every 120 ms under `PLAY_MS` playback, and `goto` lands
anywhere in up to 127,881 rows. So the table follows the machine by default, a manual scroll detaches it, and a
control reattaches — **the model `history.ts` already uses for the play head**, rather than a second
idiom for the same idea.

The two defects 5a-i's reviews found in `history.ts`'s version are the known traps, and both apply
here: a *clamped* movement that leaves the flag set, so the next frame silently yanks the view; and an
unguarded clear that detaches against an empty pane — before the first frame lands, or right after a
source edit clears the table.

**Built 2026-08-08, but only after the whole-branch review found it missing.** The reattach control this
section mandates was carried into none of the implementation plan's eight tasks, while the plan's
self-review claimed it had been — so what shipped through Task 8 detached permanently on a single
scroll. It is now a `.table-reattach` button following `pane-chrome.ts`'s **added and removed, never
disabled** idiom: present only while detached, and clicking it redraws synchronously rather than waiting
for the next step.

**And two traps this section did not anticipate, both found after the tasks were complete.** A control
with no test is how the requirement went missing in the first place — a node test for `attach()` passed
throughout, against an API path no UI reached — so the browser tier now covers the control itself.
And **a scroll event arriving while the table is hidden is not user intent**: `#drawTable` writes
`scrollTop`, the browser delivers that write's event at the next rendering update, and hiding the table
in between lands the echo on a `display: none` box reading back 0, which detaches with no gesture from
anyone. The handler ignores scroll events while closed.

### 3.8 The toggle, and what its two honest outcomes are

The table is toggleable, and §4.5 is unchanged on what the toggle is for: it is *"both the feature and
the fallback"*, and if the table proves cluttered or slow the honest outcomes are **default-closed** or
**cut to 5f** — never a row cap, which is *"a visible lie about the machine."*

It ships **default-open**, and the browser tier decides. If it flips, this document records which and
why rather than the change landing silently.

**Decided 2026-08-08: it did not flip.** Task 6's five eye checks against real Chromium and Task 7's
browser tier — run against `map_fold`, 25,852 rows, not `[1, 2]`'s 455 — found the table legible,
correctly highlighted, following, and detaching, with no clutter or slowness at that scale (§5, item 1,
has the measurement). Default-open ships as drafted. A silent flip was the one outcome this section
ruled out; recording that nothing flipped is the same discipline applied to the other branch.

---

## 4. Testing

**Node.** `virtual-list.ts`: offset arithmetic at both boundaries, overscan, empty list, single row,
`scrollTop` past the end. `state-table.ts`: **the index — `rowStart` against a hand-computed prefix
sum, row→(state, rule) resolution at every boundary (a state's header row, its first rule, its last
rule, the next state's header), a zero-rule state such as `halt` or `overflow`, the first and last rows
of the whole table** — then highlight resolution and the follow state machine.

The resolution boundaries are where an off-by-one lives, and §3.2's `i === rowStart[s]` header test is
one comparison away from silently rendering rule 0 as a header for every state in the machine.

**Browser.** Only visible rows are in the DOM — asserted as a node count far below the row total, which
is the one property virtualization exists for and the one a passing render does not demonstrate. Worth
doing on a program whose table is large: `[1, 2]` at 455 rows would render acceptably unvirtualized, so
it cannot show that virtualization works. Current row highlighted and scrolled into view; the rule row
highlighted; follow detaching on a manual scroll and reattaching on the control.

**Rust — the invariant that makes `rule` self-checking.** For every step of a run: if `rule` is `Some`
at step *N*, then `states[state].rules[rule].next` equals `state` at step *N+1*. This ties the field to
the simulator's actual behaviour rather than to a re-reading of the matcher, and it fails loudly if the
post-step/pre-step confusion in §3.4 is ever introduced.

**Mutation testing, on the arithmetic.** 5a-i's reviews found five tests that let a real mutant live,
three of them inherited verbatim from the plan's own briefs, and every one was over index arithmetic of
exactly this kind. `virtual-list.ts` is index arithmetic under a shifting scroll offset; its tests get
the same treatment.

---

## 5. Open risks

1. ~~**The table may still be cluttered or slow.**~~ — **measured 2026-08-08.** §4.5's
   evaluate-and-maybe-cut item, closed by the browser tier rather than by argument: Task 7's tests ran
   against `map_fold` (25,852 rows, not `[1, 2]`'s 455 — §3.1's lesson applied to this measurement too)
   and found the DOM held far fewer rows than the machine (bounded against
   `Math.ceil(clientHeight / ROW_HEIGHT) + 1 + 2 * OVERSCAN`, well under 200), the spacer carried the
   honest scrollable height, and Task 6's five eye checks in real Chromium found the table legible,
   correctly highlighted, following, and detaching at that scale. Neither of §3.7's two honest outcomes
   fired — see §3.8's own resolution.
2. ~~**The top-end state count is unmeasured.**~~ — **measured 2026-08-08** (§3.1), and it was worth
   measuring: the fixture everyone was quoting is 0.4% of the corpus's largest table. `list60` is
   **127,881 rows**, 281× `[1, 2]`. §2.1's lesson landed a second time in the same day, on a different
   quantity. What replaces it: **the flattened `Row[]` is now an index rather than an array** (§3.2),
   because 127,881 row objects is 12-25 MB of duplication for a list of which ~40 are visible.
3. **`TokenClass`'s hand-copy drift survives another slice.** §11.6, unchanged. `tokenClasses()` is
   still deferred, and `TmState.rule` closes a *different* instance of the same class rather than the
   class itself.
4. **The λ pane has no structural view, and now has no plan for one.** §2.5 records what would be
   needed; nothing schedules it.

---

## 6. What this slice settles, and what it hands on

**Settled.** `LAMBDA_TREE_NODES` — not as a value but as a question, answered *no budget works*, with
the numbers in §2.1. §8's last unmeasured row closes. §11.7 resolves as the cut it anticipated. The
arena's §9.3 deletion question reopens, on §2.4's narrow grounds. And the table's scale, which §4.5 had
from a single unrepresentative fixture (§3.1).

**Handed on.** 5b gets the state table its click-linking was always going to land a highlight on — §4.5
says the table's *"second consumer arrives in 5b"* — and now also gets `TmState.rule`, so the highlight
5b lands can name a transition rather than only a state. 5c is unaffected: it still needs a λ
redex→source coordinate system that survives reduction, and cutting the tree neither builds one nor
makes one harder.
