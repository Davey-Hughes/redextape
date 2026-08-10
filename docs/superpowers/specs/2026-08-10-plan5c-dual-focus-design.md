# Plan 5c — dual focus while running: what each model is working on, now

Status: design, 2026-08-10.
Roadmap: [`../plans/2026-07-19-redextape-roadmap.md`](../plans/2026-07-19-redextape-roadmap.md) § "Plan 5".
Predecessors: [`2026-08-07-plan5a-panes-and-history-design.md`](2026-08-07-plan5a-panes-and-history-design.md) (5a-i),
[`2026-08-08-plan5a-ii-state-table-design.md`](2026-08-08-plan5a-ii-state-table-design.md) (5a-ii),
[`2026-08-08-plan5b-click-linking-design.md`](2026-08-08-plan5b-click-linking-design.md) (5b).
Master design: [`2026-07-19-tm-lambda-visualizer-design.md`](2026-07-19-tm-lambda-visualizer-design.md) §6.2 part 2.

---

## 0. Why this slice, and why now

5a's decomposition put 5c behind a research blocker and said so in writing, to stop anyone scheduling it
by accident: *"5c needs a λ redex→source coordinate system that survives reduction, and none exists."*
That has been true through three slices. **It is still true, and this document is the design for
building one.**

**5c was resequenced ahead of 5d on 2026-08-10**, and the reason is worth stating because it reorders
the Plan. 5d was surveyed first — it is the last buildable Plan 5 work and the deferred accessibility
pass is gated on its controls settling. Designing it surfaced the better question. The app's three panes
are synchronized **structurally**, via `NodeId` through `SourceMap` (`core.rs:1`, `sourcemap.rs:1`),
which is what 5b's click-linking consumes. They are **not synchronized temporally at all**, and this was
verified rather than assumed:

- `main.ts:146` and `main.ts:152` build two independent `History` objects with two independent play
  heads.
- `events(leg, which)` (`main.ts:350`) gives every transport control — back, forward, play, restart —
  exactly one leg.
- There is no coupled step anywhere in the tree.

Nor could there be a shared head as currently built: `map_fold` is **555 β-steps against 266,863
δ-steps**, so "step 41" names two unrelated moments in the two models. A user watching the app run today
sees two clocks and no correspondence between them. The tagline is *"watch the Church–Turing thesis
happen"*, and the thing that makes it happen on screen is the missing half of §6.2.

## 1. Decisions taken

| # | decision | § |
| --- | --- | --- |
| 1 | Provenance is a **tag carried on `Node::App`**, propagated by every rebuild — not a path, not a side table, not `alloc_id` | §3.1, §3.3 |
| 2 | `Owner` has **three states, not two**: `Exact` / `Within` / `None` | §3.4 |
| 3 | The owner is captured **at the step** and carried in the event and the frame; it is never queried afterwards | §3.5 |
| 4 | The λ pane lights the redex by handing step-N's `Path` to `print_lambda_linked` as that step's own `want` | §4.2 |
| 5 | 5b's pin and 5c's running focus are **independent layers**, drawn differently | §4.3 |
| 6 | Both β-loops produce `owner`; `zipper_equivalence` is the gate that holds them equal | §3.6 |
| 7 | This is **§6.2 part 2 only**. No shared clock, no lockstep | §11 |

## 2. What was measured before this document was written

### 2.1 Reduction creates no node ex nihilo — the fact the whole design rests on

Every constructor call on the reduction path rebuilds a node corresponding to **exactly one** input
node. Ten sites, each read rather than inferred:

| site | file:line | corresponds to |
| --- | --- | --- |
| `shift`'s `Var` arm → `var(shifted)` | `term.rs:306-314` | the input `Var` |
| `shift`'s `Abs`/`App` arms | `term.rs:315-316` | the input `Abs`/`App` |
| `subst`'s `Abs`/`App` arms | `term.rs:349-350` | the input `Abs`/`App` |
| `subst`'s hit arm → `s.clone()` | `term.rs:339-341` | a node of the **argument** |
| `beta_go`'s `Var` arm → `var(*k - 1)` | `term.rs:424-425` | the input `Var` |
| `beta_go`'s `Abs`/`App` arms | `term.rs:428-429` | the input `Abs`/`App` |
| `reduce_step`'s spine rebuild | `reduce.rs:195,198,204` | the input `App`/`Abs` on the path |
| `ZipperCursor::advance`'s climb | `zipper.rs:236,240` | the popped frame's `App`/`Abs` |
| `ZipperCursor::term`'s fold | `zipper.rs:111-115` | each frame's `App`/`Abs` |

The only nodes that *vanish* are the redex's own `App` and its `Abs`: `beta(body, arg)` consumes both
and returns the contractum (`term.rs:381-384`), and the zipper never builds the `App` at all
(`zipper.rs:333-347`).

**So β destroys *positional* identity — paths — and not *derivational* identity.** There is a total
function from every node of the term at step N to a node of the term at step 0, computed by inheritance
at those ten sites. A tag is well-defined under reduction *by construction*, which is precisely what a
path is not.

**`alloc_id` cannot be the carrier**, and `term.rs:68-80` already says why in its own doc: allocation
identity is meaningful only while both terms are alive, and a freed address may be re-issued to an
unrelated allocation. `Drop` (`term.rs:487-528`) frees aggressively, so a side table keyed on it would
match by coincidence rather than by fact.

### 2.2 The tag is free, and the placement everything else in the file suggests is the expensive one

`size_of::<Node>()` is **40 B**; one `Rc` allocation is 40+16 = **56 B**
(`blowup_probe -- none`, run 2026-08-10 under the tree's cgroup convention). Measured on a faithful
mirror of the real types — `LambdaTerm(Rc<Node>, u32, u32)`, `Node{Var(u32), Abs(Rc<str>, T), App(T,T)}`
— compiled at `-O`:

| scheme | `Node` | handle | `Rc` alloc |
| --- | --- | --- | --- |
| baseline | 40 B | 16 B | 56 B |
| `u32` inline on `App` | **40 B** | 16 B | **56 B** |
| `Option<NodeId>` inline on `App` | **40 B** | 16 B | **56 B** |
| tag on the handle | 56 B | 24 B | 72 B |

~~**The tag is free inline on `App`, in both forms**~~ — **CORRECTED 2026-08-10, during execution, and
this correction is the third instance of an error class this roadmap has now paid for three times.**
The table above is a **64-bit host** measurement, and the app does not run on a 64-bit host. Measured on
`wasm32-unknown-unknown`, with the same mirror types:

| target | tagged `Node` | untagged `Node` | tag costs |
| --- | --- | --- | --- |
| 64-bit host | 40 B | 40 B | **0 B — free** |
| **wasm32** | **32 B** | **28 B** | **4 B/node, +14%** |

On wasm32 a pointer is 4 bytes, so the discriminant word has no spare padding to absorb the tag and it
costs a real word. **The placement decision survives this correction; the "free" claim does not.** Inline
on `App` is still the cheapest of the three options — the handle placement is worse on wasm32 too, since
it grows every `LambdaTerm` rather than only every `App` — so §3.1 stands. What changes is that this
slice spends ~14% per `Node` allocation on the target that matters, and that cost must be stated rather
than denied.

**The error class, named so the fourth instance is caught earlier.** `MAX_TERM_DEPTH = 3,000` was
calibrated on a native 8 MiB stack while the app runs in wasm. The print cap's 1,930 was measured on a
page thread while the app prints on a worker thread. This figure was measured on a 64-bit host while the
app runs on wasm32. **Each time: one measurement, taken wherever was convenient, generalized without
checking which target the app actually executes on.**

**And it broke the build, not just the doc.** The `const _` assertion §8.1 mandates was written as
`size_of::<Node>() == 40`, which fails `cargo build --target wasm32-unknown-unknown` with `E0080`. It
survived five tasks because every local gate — pre-commit `clippy --all-targets`, `cargo test` — runs on
the host; only `scripts/check-all.sh`'s wasm leg and CI compile wasm32. The assertion is now gated on
`#[cfg(target_pointer_width = "64")]` with its host-specificity documented. **A `const _` on a layout
figure is a claim about a TARGET, not about a type.**

**And the handle placement costs 16 B per node plus 8 B per handle** on the host, which
matters because the handle is where the existing two `u32`s live (`term.rs:37`) and is therefore where
an implementer reasoning by analogy would put it. `term.rs:30-35` argues the handle placement on
*different* grounds — it keeps `Drop`, `PartialEq` and every walker untouched — and those grounds do not
transfer, because a provenance tag must be inherited by rebuilds rather than recomputed from the node.

**This is a mirror, not the real type, and Rust guarantees no enum layout.** §6 therefore requires
`const _: () = assert!(size_of::<Node>() == 40)` in the real crate, which converts this table into a
gate that fails at compile time if the assumption ever stops holding.

### 2.3 Why "validate the walk" does not repair `node_to_lambda`, which is the proposal that will recur

`node_to_lambda` recorded paths root-relative into the *initial* lowered term and was removed
(`viewmodel.rs:36-55`). The obvious cheap repair is to keep it and discard any path that fails to walk
into the current term. **It does not work, and the reason is already pinned by a test.**
`viewmodel_contract.rs:81-108` measures `let x = 40; x + 2`: step 4's redex path is the first that
provably fails to walk — and **steps 2 and 3 walk successfully and mean nothing**, because, in that
file's own words, *"a short path is a valid walk into almost any term with that much App/Abs structure
near its root, regardless of whether it means anything"* (`viewmodel_contract.rs:74-80`).

Guarding on walkability therefore converts *always silently wrong* into *sometimes silently wrong*,
which by this project's standard is worse: a value that is sometimes wrong tells a consumer nothing is
wrong at all. **Refused in writing here so it is refused once.**

## 3. The Rust half

### 3.1 The tag

`Node::App` gains an `Option<NodeId>`. Nothing else changes shape: `Var` and `Abs` are untouched, the
handle is untouched, `Drop` is untouched.

### 3.2 Tagging sites in `lower.rs`

`lower_expr` already calls `origins.at_root(core.id())` on entry (`lower.rs:283`), so the id is in hand
at the constructor. A second constructor `app_owned(f, a, id)` is used at the `app(...)` sites that
correspond to a Core node's own root:

| Core node | site |
| --- | --- |
| `Core::Apply` | `lower.rs:325-337` |
| `Core::Let` | `lower.rs:339-350` |
| `Core::LetRec` | `lower.rs:351-364` |
| `Core::BinOp` | `lower.rs:299-306` |
| `Core::If` | `lower.rs:312-319` |

Every other `app(...)` in `lower.rs` and **every** `app(...)` in `encode.rs` stays untagged. That is not
an omission — see §5.1.

**Cost per compile: zero** beyond what lowering already does.

### 3.3 Propagation

The ten sites of §2.1 inherit the tag from the node they rebuild. **Cost per β-step: zero traversal.**
The tag rides rebuilds that already happen.

### 3.4 Harvest — `Owner`, from the descent `reduce_step` already makes

```rust
pub enum Owner {
    /// The contracted `App` carried this construct's own tag.
    Exact(NodeId),
    /// It did not; this is the innermost enclosing construct that did.
    Within(NodeId),
    /// Neither. Correct, and common — see §5.1.
    None,
}
```

`reduce_step` (`reduce.rs:181-209`) already descends root→redex. Thread "the deepest tagged node passed
so far" down that recursion. **Cost: one `Option<NodeId>` copy per level of a walk that already runs** —
measured mean path length 9.3, max 30. No new traversal, no allocation.

**Three states rather than two is the load-bearing decision of this slice.** `Exact` and `Within` are
different claims: one says *this step is that construct*, the other says *this step is somewhere inside
it*. 5b's design refused the containment shape outright on the TM leg
(`2026-08-08-plan5b-click-linking-design.md` §2.2: *"'nearest enclosing linkable node' frequently means
highlight the entire program, which is worse than reporting nothing"*), and it was right to for a
**single-signal** consumer. Distinguishing them on the wire is the same move the print-depth-cap slice
made when it replaced `truncated: bool` with `cut: Option<Cut>`, on the stated grounds that a byte cut
and a depth cut are not the same kind of object and collapsing them tells a consumer nothing. A
renderer that can tell `Exact` from `Within` can draw the weaker claim more weakly; a renderer given one
flag cannot.

### 3.5 `StepEvent` and `LambdaState`

```rust
// trace.rs:30 — was `Beta { redex: Path }`
Beta { redex: Path, owner: Owner },
```

```rust
// viewmodel.rs:58
pub struct LambdaState {
    pub text: String,
    pub spans: Vec<(Span, TokenClass)>,
    pub cut: Option<Cut>,
    pub step: u64,
    pub redex: Option<Path>,   // new
    pub owner: Owner,          // new
}
```

**Both are captured at the step, and this is a hard constraint rather than a preference.** `beta`
consumes the redex `App` and its `Abs` (`term.rs:381-384`) and the zipper never constructs the `App`
(`zipper.rs:333-347`), so the node being worked on is *gone* by the time a consumer could ask about it.
Any design in which the UI asks a question of `lambdaState()` after the fact is ruled out by this, not
merely made slower. `viewmodel.rs:25-34` records the missing `redex` field; this is what it was waiting
for.

`redex` is `Option<Path>` because the frame at step 0 precedes any contraction.

`Owner` carries the same `#[cfg_attr(feature = "serde", derive(...))]` as every other viewmodel type, or
`LambdaState` stops serializing and the wasm boundary breaks at compile time rather than subtly.

### 3.6 Both β-loops, held equal

`reduce_step` and `ZipperCursor::reduce_here` must both produce `owner`. `tests/zipper_equivalence.rs`
already asserts identical `StepEvent` sequences over 256 generated programs plus ten curated shapes
(`reduce.rs:224-228`), so extending `StepEvent` extends that gate for free. **This roughly doubles the
implementation of §3.4** and is the largest single cost in the slice. It is also the only mechanism that
keeps the two loops from drifting, which is why it is not negotiated away.

## 4. The JS half

### 4.1 Frame sizing

`lambdaFrameBytes` (`protocol.ts:104-105`) gains a term for the new fields, or the 32 MB ring silently
under-reports and evicts later than it believes. The addition is ~4–8 bytes against a measured
**10,123 bytes/frame** (`while4`) and **11,464** (`list60`) — ≲0.08%, and the requirement is
correctness of the sizer rather than the magnitude.

### 4.2 Three panes

| pane | how the focus lands | new work |
| --- | --- | --- |
| source | `NodeId` → `Span` via `LinkIndex.source_nodes` (`viewmodel.rs:416-417`) | none; the map exists |
| λ | hand step-N's `redex` `Path` to `print_lambda_linked` as that step's own `want` | one new call |
| TM | `TmState.source_node`, resolved through `SourceMap::tm_owner` | none; shipped 2026-07-30 |

**The λ pane's route is the printer's actual contract, not a workaround.**
`print_lambda_linked(t, byte_budget, depth_cap, want)` is `Path → Span` **against whatever term it is
handed** (`syntax.rs:286-291`); it holds no step-0 assumption of its own. The step-0 restriction lives in
`LinkIndex` (`viewmodel.rs:392-396`, `session.rs:730-732`), which is a different object. Handing it the
current step's redex path for the current step's own print is exactly what it was built to do — this is
what the roadmap meant by *"given a coordinate system, turning it into a highlight is solved"*.

**And it costs no extra walk per frame, which is the thing to check before believing it.** The record
loop already calls `lambdaState(FRAME_BYTES)` every step (`session-worker.ts:207,227`), and
`print_lambda_capped` is already `print_lambda_linked` with an empty `want` (`syntax.rs:241-249`) —
recording happens at one site, `Printer::node` (`syntax.rs:391-419`). Supplying a non-empty `want` uses
the walk that was happening anyway rather than adding one.

**NO EXTRA WALK IS NOT THE SAME AS FREE, AND THE DIFFERENCE IS MEASURABLE — added 2026-08-10, after
implementation, before merge.** The sentence above is true and will be read as "costs nothing". It does
not. `frame_cost_probe` run on the same machine at `2b8900f` and at this branch's head, section D
(`FRAME_BYTES = 512`, the budget the record loop actually uses):

| program | render µs/step, before → after | Δ | frame bytes Δ |
| --- | --- | --- | --- |
| `sample` | 3.31 → 5.81 | **+75%** | +3.1% |
| `map_fold` | 3.92 → 5.74 | **+46%** | +1.2% |
| `countdown4` | 4.36 → 5.96 | **+37%** | +1.0% |
| `sum5` | 6.05 → 7.57 | +25% | +1.9% |
| `while4` | 4.41 → 5.46 | +24% | +1.0% |
| `list60` | 7.90 → 9.51 | +20% | +7.4% |

**The β-step itself is unchanged** — `while4` 0.46 → 0.46 µs/step, `map_fold` 0.60 → 0.65 — so §3.4's
harvest genuinely is free, exactly as designed. **The render is what got more expensive**, by the two
things this section's own argument does not mention: the `want` `BTreeMap` allocated and dropped per
call, and a `BTreeMap::get(&self.path)` per printed node where the empty-`want` path was a null check.
That `get` compares a `Vec<Dir>`, so it scales with path length rather than being O(1).

**It is not a blocker and it is not hidden.** 555 steps of `map_fold` is ~3.2 ms against ~2.2 ms; the
record loop yields every 256 steps and the budget is bytes, not time. But this project has been burned
three times by a statement that was true and read as more than it said — `MAX_TERM_DEPTH` on a native
stack, the print cap on a page thread, `SPAN_BYTES` against a GC schedule — and "no extra walk"
belongs in that family unless the constant factor is written down beside it.

### 4.3 Two layers: the pin and the running focus

5b's clicked link is a **pin** the user set. 5c's focus is a **marker that moves every step**. They are
different objects and stay visually distinct — the pin keeps 5b's existing treatment, the running focus
gets its own, and both may be on screen at once.

This follows 5b's own precedent that a direct gesture does not stop the run (§5.1 there: *"a link scroll
is a direct gesture and wins for exactly one draw; following is not disturbed, because the user asked to
see a construct once, not to stop watching the run"*). Suppressing the running focus while a pin is set
would turn off the highlight at exactly the moment it is most wanted — when the user has pinned a
construct and is waiting for the run to reach it.

**Coincidence is a state worth drawing.** When the pin and the focus name the same `NodeId`, that is the
moment the app exists to show. It gets its own treatment rather than being two overlapping highlights.

Rendering by `Owner`: `Exact` solid, `Within` visibly weaker, `None` nothing at all. The palette must
keep pin, `Exact` and `Within` apart **in both light and dark**, which PR #20's toggle makes a real
constraint rather than a formality.

**Scrubbing is free and correct.** `owner` is per-frame, so walking the history backwards shows the
answer that was true at that step rather than the current one.

## 5. Four things it cannot say, documented rather than patched

Each must appear in whatever ships, or 5c reintroduces the defect that removed `node_to_lambda`'s
consumer.

**5.1 Most β-steps have no source construct, because most of the term is not source.** `encode.rs` mints
Church/Scott encodings and every combinator with bare `abs`/`app`/`var` and no `Origins` involvement
(`encode.rs:28-35`). `lower.rs` tags the *root* of a `Core::Nat`'s numeral (`lower.rs:285`) and nothing
inside it. Reducing `40 + 2` is overwhelmingly work inside `plus` and inside two Church numerals — code
with no source construct at all. **`None` is the correct answer for those steps and there is no repair.**

**5.2 Substitution copies, so "where in the source is this node" is not injective.** `term.rs:339-341`
and `:403-404` return `s.clone()` per occurrence, and `term.rs:686-739` proves N occurrences share one
allocation. A highlight can honestly say *"the construct being worked on is X"*; it cannot say *"and X
is here"*, because X is now everywhere the substitution put it.

**5.3 Recursion is indistinguishable from itself.** `Core::LetRec` lowers to
`app(abs(name, body), app(fix(), abs(name, value)))` (`lower.rs:351-364`) and each unrolling copies the
tagged body, so every iteration of a 40-iteration loop reports the same `NodeId`. That is *correct* and
it is *not what someone watching a loop wants*. An iteration counter is a different feature and is not
in this slice.

**5.4 `Within` is a claim about the reduct's structure, not the lowering's.** After N substitutions the
innermost tagged `App` enclosing the redex is a node of the *reduct*. That is a true statement and a
**different relation** from the one `node_to_lambda` expressed. The doc comment on `Owner::Within` must
say which question it answers.

## 6. The measurements, with thresholds fixed before the numbers

All λ-driving probes follow the convention the tree already states
(`frame_cost_probe.rs:5-8`, `link_index_probe.rs:6-8`): `systemd-run --user --scope -q -p MemoryMax=2G
-p MemorySwapMax=0`, driving `LambdaCursor` and **never `reduce_trace`**, which materialises every
step's term by contract and is how the 60 GiB run happened.

**The corpus is `frame_cost_probe.rs:107-133`'s**, named rather than left to the implementer's choice:
`sample`, `list2`, `while4`, `sum5`, `countdown4`, `map_fold`, `num200`, `list20`, `list60`. Reusing it
means M1 and M2 are comparable against every figure this Plan has already recorded, and it is a corpus
chosen to be representative with two entries (`num200`, `list60`) deliberately picked to defeat bounds.

| id | question | threshold, fixed now |
| --- | --- | --- |
| M1 | over the corpus, what fraction of β-steps contract an `App` carrying its own tag? | reported, not gating — `Exact`/`Within`/`None` is designed to survive any value |
| M2 | how wide is `Within`'s span, as a fraction of program length? | if the median `Within` span exceeds **60%** of the program on more than one corpus program, `Within` renders as a status line only and not as a highlight |
| M3 | is the tag free in the real `Node`? | **answered 2026-08-10** — `const _` assertion in §8 pins it |

**M1 is deliberately not a gate**, and that is a consequence of decision 2. Under a single-signal design
a low tagged rate would be fatal; under three states it is information the renderer already handles.
This is the payoff for refusing to collapse the two claims, and it is why the threshold table has one
gate rather than three.

**The eyeball gate is not a measurement and is not optional.** Build it behind the existing three-pane
app and *look at it* on `while4` and `map_fold` before any doc-comment claims it works. Legibility —
whether `Within`'s answer is *meaningful* rather than merely *present* — is only decidable by watching
the running app, which is this slice's own deliverable. M2 measures span width, a proxy for
degeneration and not for legibility. **No doc-comment may claim legibility on M1/M2 numbers alone.**

## 7. Rejected, in writing

| candidate | why refused |
| --- | --- |
| Path-rewriting map per step | three independent fatalities; and the quantity it maintains is destroyed by the substitution it must survive |
| Re-index per step | nothing to recompute *from*, plus the `lambdaAst` precedent — **850 MB against a 32 MB ring**, 731.65 µs/step against the text frame's 5.77, and **84% of steps refuse to build a tree at all** at 65,536 nodes |
| Revive `node_to_lambda`, guarded by walkability | §2.3 — converts always-wrong into sometimes-wrong |
| Zipper context-spine fold | **deferred, not refused.** Its O(1) fold is the prettier mechanism and inherits `depth_add`'s proven shape (`zipper.rs:152-163`), but `LambdaCursor` has no context stack at all (`trace.rs:37-45`), and the cursor swap has a measured negative verdict (`reduce.rs:252-259`) for exactly this caller: the record loop calls `lambdaState(FRAME_BYTES)` every step (`session-worker.ts:207,227`). Revisit only if that trade is re-measured *at* `FRAME_BYTES`, which did not exist when it was measured |

## 8. Testing

1. **`const _: () = assert!(size_of::<Node>() == 40)`** — turns §2.2's mirror into a compile-time gate.
2. **Propagation is total.** A test that reduces a tagged program and asserts every node of the reduct
   traces to a node of step 0. This is §2.1 as an executable claim rather than a read one.
3. **`zipper_equivalence` extended** — both β-loops produce identical `owner` sequences over the existing
   256 generated programs and ten curated shapes.
4. **`Exact` is exact.** On `let x = 40; x + 2`, the step contracting the `BinOp`'s own `App` reports
   `Exact` naming `x + 2` — the case `viewmodel_contract.rs` currently pins as *never named*.
5. **`None` is reachable and common.** A test that a Church-numeral-internal step reports `None`, so
   §5.1 is pinned rather than asserted.
6. **`Within` is reachable and names an enclosing node**, with its span asserted to be a strict superset
   of an `Exact` answer's.
7. **Frame sizing** — `lambdaFrameBytes` accounts for the new fields; a ring test that would fail if it
   did not.
8. **Browser tier:** the running focus moves during a run, survives a scrub backwards showing the
   historical answer, and coexists with a pin without either disappearing.

**5a-i, 5a-ii and 5b each recorded that nearly every Important review finding was a defect in the
*plan*, not the implementation** — tests that proved nothing, mutants that lived. That prediction has
held three times and applies here; mutation testing is expected on §8.2 and §8.3 in particular, where a
test that asserts "some node traced" rather than "every node traced" would pass against a broken
propagation.

## 9. Delivery shape

`redextape-core` first (tag, propagation, harvest, `StepEvent`), then `redextape-wasm` (`LambdaState`
fields), then `web/` (sizer, three panes, two layers). The core half is a different compile unit from
the web half, which 5b's process finding says is one of the only genuinely safe parallel pairings — but
§3.6's two-loop work and §3.4's harvest are the same compile unit as each other and serialise.

## 10. Open risks

1. **Legibility of `Within`.** Unmeasurable before the thing exists; §6's eyeball gate is the mitigation
   and M2 is the proxy. If it degenerates, the fallback is `Within` as a status line rather than a
   highlight, which §6 fixes as a threshold now rather than deciding after seeing the number.
2. **Palette contention.** Pin, `Exact`, `Within` and coincidence is four states across three panes in
   two themes. PR #20's toggle makes this a real constraint. If four states cannot be kept apart
   legibly, coincidence is what merges into `Exact`, not `Within` into `Exact`.
3. **Enum layout is not guaranteed.** §8.1 converts the risk into a build failure rather than a silent
   regression.

## 11. Scope boundary — this is §6.2 part 2, not §6.3

After this slice each pane reports **what it is working on now**, independently, and the panes agree
when they happen to agree. They do **not** march in lockstep.

§6.3's reference-clock synchronized stepping — one logical step = one source construct, both views
fast-forwarding to the point that completes it — stays deferred to **v1.5** on its own recorded
obstruction: *"normal-order lambda reduction can visit constructs in a different order than strict
evaluation, so 'fast-forward lambda to construct X' is not always well-defined."* Nothing in this design
brings that closer, and nothing in it should be read as claiming to.

**Stating this before the slice ships rather than after** is the point of this section. "Synchronized"
is the word a reader will reach for on seeing 5c work, and it is the word §6.3 owns.

## 12. What this settles, and what it hands on

**Settles:** the coordinate system 5a's decomposition named as research and three slices declined to
build. `viewmodel.rs`'s missing `redex` field gets its value. `node_to_lambda`'s removal stops being a
gap and becomes a decision with a successor.

**Hands on:** 5d inherits panes whose highlight semantics are settled, which is what its own detachment
work has to stay honest against — a detached session has no `SourceMap`, so it can carry no `Owner` at
all, and 5d-i's requirement that detachment be *loud* is exactly this design's standard applied one
slice later. The accessibility pass inherits a fourth and fifth colour-carried state (§4.3), which
belongs on that list the moment this lands.
