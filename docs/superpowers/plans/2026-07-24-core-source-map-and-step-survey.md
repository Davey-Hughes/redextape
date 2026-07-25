# Core source map + TM step survey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Core→asm→TM source map and a survey that uses it to report where TM steps actually go, so the optimizer's Tier A pass set can be chosen on evidence rather than from the textbook list.

**Architecture:** Provenance is a *returned artifact*, never a struct field — each mapped function returns its map alongside its existing output, and the existing unmapped function is reimplemented over it, so there is exactly one implementation and the two cannot drift. `Program`/`Machine` equality, the TM text round-trip, and every current consumer are untouched. Attribution composes three maps (instruction→Core node, TM state→instruction, `defunc` synthetic-id set) against per-state step counts, and is proven correct by one exhaustiveness invariant plus a sabotage test.

**Tech Stack:** Rust (edition 2024), `redextape-core` only — no new dependencies, and the crate must stay WASM-clean (it currently has zero dependencies).

**Design spec:** `docs/superpowers/specs/2026-07-24-core-source-map-and-step-survey-design.md` (read for rationale).

## Global Constraints

- **No git attribution.** Never add `Co-Authored-By: Claude`, `Generated with Claude Code`, or any similar trailer to commit messages.
- **`redextape-core` stays WASM-clean and dependency-free.** It currently has zero dependencies (`cargo tree -p redextape-core` shows only itself) — add none.
- **Every mapped/unmapped pair has ONE implementation.** `lower_asm` = `lower_asm_mapped(..).map(|(p, _)| p)`, `defunc` = `defunc_mapped(..).map(|(c, _)| c)`, and likewise for the TM builder. A second parallel implementation is a plan violation, not a style preference.
- **No signature changes to existing public functions**, no field added to `Program` or `Machine`, and no change to the TM text format. `Program` and `Machine` both derive `PartialEq` and the TM text round-trip test asserts `parse_tm(print_tm(m)) == m`; a side-table field would break it.
- **This slice adds observation only.** No backend may compute a different result, and no Tier A optimization pass is written here.
- **Totality (cardinal rule).** Total on any input: the mapped lowering keeps `lower_asm`'s existing `MAX_LOWER_DEPTH` guard, `defunc_mapped` keeps `MAX_DEFUNC_DEPTH`, and the counting simulator keeps `Caps`. No `.unwrap()`/`.expect()`/panic on any library path; test and example code may panic deliberately.
- **`TM_DEFAULT_CAPS` is `Caps { steps: 5_000_000, cells: 5_000_000 }`** and TM arithmetic is unary — `sum(5)` alone costs ~178k steps. Every survey program and probe must run to completion inside those caps.
- **The existing suites are the regression evidence.** `cargo test --workspace` must stay green at every task, since it proves the rerouting changed no behavior.

---

## File Structure

- `crates/redextape-core/src/tm/lower_asm.rs` — **modify**: `Ctx` gains an origins side table; add `lower_asm_mapped`; `lower_asm` becomes a wrapper.
- `crates/redextape-core/src/tm/defunc.rs` — **modify**: preserve source ids where a correspondence exists; record minted ids; add `defunc_mapped`; `defunc` becomes a wrapper.
- `crates/redextape-core/src/tm/lower_tm.rs` — **modify**: add `lower_tm_mapped`; `lower_tm` becomes a wrapper.
- `crates/redextape-core/src/tm/sim.rs` — **modify**: add a per-state counting mode alongside the existing trace mode.
- `crates/redextape-core/src/tm/attribute.rs` — **create**: `StepBucket`, the composition of the three maps into a histogram, and the exhaustiveness invariant.
- `crates/redextape-core/src/tm.rs` — **modify**: declare and re-export the new module and functions.
- `crates/redextape-core/examples/step_survey.rs` — **create**: the corpus, the probes, and the report.

## Interfaces produced (referenced across tasks)

- `tm::lower_asm_mapped(&Core) -> Result<(Program, Vec<NodeId>), LowerError>` — `origins[i]` produced `code[i]`; `origins.len() == code.len()`.
- `tm::defunc_mapped(&Core) -> Result<(Core, BTreeSet<NodeId>), LowerError>` — the set is every id `defunc` minted.
- `tm::lower_tm_mapped(&Program, &dyn Encoding) -> (Machine, Vec<Option<usize>>)` — `state_origins[s]` is the `code` index that built state `s`, or `None` for machine scaffolding.
- `tm::sim::simulate_counts(&Machine, &[Vec<Symbol>], Caps) -> (Vec<u64>, Status)` — per-state step counts, indexed by state id, `len() == m.states.len()`.
- `tm::attribute::{StepBucket, Attribution, attribute_steps, attribute}` — `attribute(src) -> Result<Attribution, LowerError>` runs the whole pipeline; `attribute_steps(..)` composes pre-built maps so tests can substitute a perturbed one. See Task 5.

---

### Task 1: Instruction origins in `lower_asm`

**Files:**
- Modify: `crates/redextape-core/src/tm/lower_asm.rs`
- Modify: `crates/redextape-core/src/tm.rs` (re-export `lower_asm_mapped`)

**Interfaces:**
- Produces: `lower_asm_mapped(&Core) -> Result<(Program, Vec<NodeId>), LowerError>`.
- Consumes: the existing `Ctx`, `lower_into`, `lower_asm` (`lower_asm.rs:119`).

**The hook already exists.** `lower_into` (`lower_asm.rs:127`) is the single recursive entry for lowering a `Core` node, and it already saves and restores `ctx.depth` around the recursive call. Add a `current: NodeId` field to `Ctx` and save/restore it the same way, so "the node currently being lowered" is always correct. `Ctx::emit` (`lower_asm.rs:63`) then records it.

- [ ] **Step 1: Write the failing test** in `lower_asm.rs`'s test module:

```rust
#[test]
fn every_instruction_has_an_origin_from_the_program_it_lowered() {
    let core = desugar(&parse("fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(3)").0.unwrap());
    let (prog, origins) = lower_asm_mapped(&core).expect("lowers");
    assert_eq!(origins.len(), prog.code.len(), "origins must be parallel to code");
    // Every origin must be a real node id in the program being lowered.
    let ids = all_node_ids(&core);
    for (i, id) in origins.iter().enumerate() {
        assert!(ids.contains(id), "instruction {i} ({:?}) has origin {id}, not a node in the Core", prog.code[i]);
    }
}

#[test]
fn arithmetic_attributes_to_its_own_binop_node() {
    // `2 * 3` lowers to two `Li`s and a `Bin`; the `Bin` must bill the BinOp node, not a literal.
    let core = desugar(&parse("2 * 3").0.unwrap());
    let (prog, origins) = lower_asm_mapped(&core).expect("lowers");
    let bin = prog.code.iter().position(|i| matches!(i, Instr::Bin(..))).expect("a Bin instruction");
    assert_eq!(origins[bin], core.id(), "the multiply must bill the BinOp node");
}
```

`all_node_ids(&Core) -> BTreeSet<NodeId>` does not exist — add it to the same test module as an iterative walk (do **not** recurse: `Core` spines reach tens of thousands of nodes deep, which is why `Core` has a hand-written iterative `Drop`):

```rust
fn all_node_ids(core: &Core) -> std::collections::BTreeSet<NodeId> {
    let mut out = std::collections::BTreeSet::new();
    let mut stack = vec![core];
    while let Some(n) = stack.pop() {
        out.insert(n.id());
        push_children(n, &mut stack);
    }
    out
}
```

`push_children<'a>(&'a Core, &mut Vec<&'a Core>)` must enumerate every child of every `Core` variant. Read the `Core` enum (`core.rs:22-58`) and the existing `take_core_children` in that file's `Drop` impl — it already enumerates every variant's children and is the authority on which they are. Mirror its match arms exactly so a new variant cannot be silently missed.

- [ ] **Step 2: Run the tests, expect failure.**

Run: `cargo test -p redextape-core --lib lower_asm::`
Expected: FAIL to compile — `lower_asm_mapped` does not exist.

- [ ] **Step 3: Add the side table to `Ctx`.**

In the `Ctx` struct (`lower_asm.rs:~40`) add two fields, and initialise them in `Ctx::new`:

```rust
    /// Parallel to `code`: `origins[i]` is the `Core` node whose lowering emitted `code[i]`.
    origins: Vec<NodeId>,
    /// The node currently being lowered. Instructions with no direct source analogue — jumps, frame
    /// setup, a function's prologue — bill their ENCLOSING construct, which is what a reader wants:
    /// the cost of an `if` should include the branch it required.
    current: NodeId,
```

`Ctx::new()` initialises `origins: Vec::new(), current: 0`. Change `emit`:

```rust
    fn emit(&mut self, i: Instr) {
        self.code.push(i);
        self.origins.push(self.current);
    }
```

**Every instruction must go through `emit`.** Grep for `code.push` and `self.code.push` in this file — if any site pushes directly, route it through `emit`, or the side table silently desynchronises from `code`. Report any such site you find.

- [ ] **Step 4: Set `current` in `lower_into`.**

`lower_into` (`lower_asm.rs:127`) already brackets its recursive call with `ctx.depth += 1` / `ctx.depth -= 1`. Add the same save/restore for `current`:

```rust
fn lower_into(ctx: &mut Ctx, core: &Core, dst: Reg) -> Result<(), LowerError> {
    ctx.depth += 1;
    if ctx.depth > MAX_LOWER_DEPTH {
        ctx.depth -= 1;
        return Err(LowerError::TooDeep { node: core.id() });
    }
    let saved = ctx.current;
    ctx.current = core.id();
    let r = lower_inner(ctx, core, dst);
    ctx.current = saved;
    ctx.depth -= 1;
    r
}
```

`lower_function` (`lower_asm.rs:~140`) emits instructions outside any `lower_into` call (the `Jmp`/label scaffolding). Those correctly bill whatever `current` holds — the enclosing construct that declared the function. Leave that behaviour; it is the intent of §2 of the spec.

- [ ] **Step 5: Add the mapped entry point and reroute the existing one.**

```rust
/// Lower `core` to register-asm, returning the program AND its source map: `origins[i]` is the
/// `Core` node whose lowering emitted `code[i]`.
///
/// The map is returned rather than stored on `Program` deliberately. `Program` derives `PartialEq`
/// and is compared in the asm goldens; a side-table field would change equality and break them for a
/// reason that has nothing to do with what the program computes.
pub fn lower_asm_mapped(core: &Core) -> Result<(Program, Vec<NodeId>), LowerError> {
    let mut ctx = Ctx::new();
    lower_into(&mut ctx, core, Reg::Rr)?;
    ctx.current = core.id();
    ctx.emit(Instr::Halt);
    Ok((Program { code: ctx.code, labels: ctx.labels }, ctx.origins))
}

/// Lower `core` to register-asm. Exactly `lower_asm_mapped` with the source map discarded — there is
/// ONE lowering implementation, so the mapped and unmapped paths cannot drift.
pub fn lower_asm(core: &Core) -> Result<Program, LowerError> {
    lower_asm_mapped(core).map(|(p, _)| p)
}
```

Note the explicit `ctx.current = core.id()` before the final `Halt`: it is emitted after `lower_into` has restored `current`, so without it the `Halt` would bill whatever was left over.

Re-export from `crates/redextape-core/src/tm.rs` beside the existing `lower_asm` export.

- [ ] **Step 6: Run the tests, expect pass.**

```bash
cargo test -p redextape-core --lib lower_asm::
cargo test --workspace
```
Expected: the two new tests pass, and the whole workspace stays green — which is the evidence that rerouting `lower_asm` changed no behaviour.

- [ ] **Step 7: Commit.**

```bash
git add crates/redextape-core/src/tm/lower_asm.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): source map from Core nodes to asm instructions (lower_asm_mapped)"
```

---

### Task 2: `defunc` preserves source ids and declares what it synthesized

**Files:**
- Modify: `crates/redextape-core/src/tm/defunc.rs`
- Modify: `crates/redextape-core/src/tm.rs` (re-export `defunc_mapped`)

**Interfaces:**
- Produces: `defunc_mapped(&Core) -> Result<(Core, BTreeSet<NodeId>), LowerError>`.
- Consumes: the existing `defunc` (`defunc.rs:102`) and its `NodeGen::seeded(max_id(core) + 1)`.

**Why this matters:** without it, every higher-order program attributes its cost to synthesized nodes — and higher-order programs are where TM costs are largest. The expected finding is that `map`/`fold` bill a large share to closure dispatch scaffolding rather than to the arithmetic the user wrote; that is real information, but only if the two are told apart.

- [ ] **Step 1: Write the failing test** in `defunc.rs`'s test module:

```rust
#[test]
fn defunc_reports_exactly_the_ids_it_minted() {
    let core = desugar(&parse(
        "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} map([1,2],add1)"
    ).0.unwrap());
    let before = all_node_ids(&core);
    let (out, synthetic) = defunc_mapped(&core).expect("defuncs");
    let after = all_node_ids(&out);

    // Every id in the output is either one that existed before, or one declared synthetic.
    for id in &after {
        assert!(before.contains(id) || synthetic.contains(id), "id {id} is neither original nor declared synthetic");
    }
    // The declared set must not claim ids that were already there.
    for id in &synthetic {
        assert!(!before.contains(id), "id {id} declared synthetic but existed in the input");
    }
    // A higher-order program genuinely needs scaffolding, so the set must be non-empty — otherwise
    // this test would pass vacuously against a `defunc` that minted nothing.
    assert!(!synthetic.is_empty(), "defunc of a higher-order program minted no ids");
}

#[test]
fn defunc_preserves_the_id_of_a_body_it_carried_through() {
    // `add1`'s `x + 1` survives defunctionalization as the dispatcher's callee body. Its BinOp node
    // must keep its original id, or the survey would bill user arithmetic to scaffolding.
    let core = desugar(&parse(
        "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} map([1,2],add1)"
    ).0.unwrap());
    let add_id = find_add_binop_id(&core).expect("the source has an Add BinOp");
    let (out, _) = defunc_mapped(&core).expect("defuncs");
    assert!(all_node_ids(&out).contains(&add_id), "the user's `x + 1` lost its identity through defunc");
}
```

Add `all_node_ids` to this test module too (same iterative walk as Task 1 — copy it; the two test modules are in different files and a shared test helper is not worth a new module here). `find_add_binop_id(&Core) -> Option<NodeId>` is an iterative walk returning the id of the first `Core::BinOp(_, BinOp::Add, ..)` found.

- [ ] **Step 2: Run the tests, expect failure.**

Run: `cargo test -p redextape-core --lib defunc::`
Expected: FAIL to compile — `defunc_mapped` does not exist.

- [ ] **Step 3: Make `NodeGen` record what it mints.**

Find `NodeGen` in `defunc.rs` and have it accumulate every id it hands out:

```rust
    /// Every id this generator minted — i.e. every node in the output with no source analogue.
    /// Returned by `defunc_mapped` so the survey can bucket closure scaffolding separately from
    /// the constructs the user actually wrote.
    minted: BTreeSet<NodeId>,
```

Record into it in whatever method hands out a fresh id, and expose it (a `fn minted(self) -> BTreeSet<NodeId>` or a public field — match the file's existing style).

- [ ] **Step 4: Audit the rewrite sites for id preservation.**

This is the substantive part of the task and cannot be done mechanically. Read every place `defunc` constructs an output `Core` node and decide, per site:

- Does this node **correspond to** an input node (it *is* that construct, rewritten)? Then it must carry the input node's id.
- Is it genuine scaffolding with no source analogue (`$applyN` dispatchers, tag comparisons, the `cons(tag, env)` closure representation)? Then it takes a fresh id from `NodeGen`.

The second test in Step 1 pins the case that matters most — a lambda body carried through must keep its identity. **Report in your task report a per-site list: which sites you found, and which way you classified each.** A site classified wrongly does not fail the build; it silently misattributes cost, which is exactly the defect class this project keeps finding.

- [ ] **Step 5: Add the mapped entry point and reroute the existing one.**

```rust
/// Defunctionalize `core`, returning the rewritten tree AND the set of ids that have no source
/// analogue (closure-dispatch scaffolding). Nodes carried through from the input keep their ids, so
/// the step survey can distinguish what the user wrote from what defunctionalization added.
pub fn defunc_mapped(core: &Core) -> Result<(Core, BTreeSet<NodeId>), LowerError> { /* existing body, returning (out, g.minted) */ }

/// Defunctionalize `core`. Exactly `defunc_mapped` with the synthetic-id set discarded — ONE
/// implementation, so the two cannot drift.
pub fn defunc(core: &Core) -> Result<Core, LowerError> {
    defunc_mapped(core).map(|(c, _)| c)
}
```

Move the existing `defunc` body into `defunc_mapped` verbatim, changing only the return. Its `too_deep_node` pre-check and `MAX_DEFUNC_DEPTH` guard move with it — totality is preserved by relocation, not re-derivation.

Re-export from `tm.rs` beside the existing `defunc` export.

- [ ] **Step 6: Run the tests, expect pass.**

```bash
cargo test -p redextape-core --lib defunc::
cargo test --workspace
```
Expected: new tests pass; the workspace stays green (`defunc` has callers in `run_tm`, native's `lower_program`, and several test modules — none should need changing, which is the point of the wrapper).

- [ ] **Step 7: Commit.**

```bash
git add crates/redextape-core/src/tm/defunc.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): defunc preserves source node ids and reports its synthesized ones"
```

---

### Task 3: TM state origins

**Files:**
- Modify: `crates/redextape-core/src/tm/lower_tm.rs`
- Modify: `crates/redextape-core/src/tm.rs` (re-export `lower_tm_mapped`)

**Interfaces:**
- Produces: `lower_tm_mapped(&Program, &dyn Encoding) -> (Machine, Vec<Option<usize>>)`.
- Consumes: `lower_tm` (`lower_tm.rs:95`) and its per-instruction loop (`lower_tm.rs:164`).

**Why `Option` here, unlike Task 1:** an instruction always has an enclosing `Core` node, but a TM state genuinely need not belong to any instruction — `lower_tm` builds call-site dispatch scaffolding outside the per-instruction loop (`lower_tm.rs:119-123`). Those states get `None` and are reported as machine scaffolding, a bucket of its own.

- [ ] **Step 1: Write the failing test** in `lower_tm.rs`'s test module:

```rust
#[test]
fn every_state_maps_to_the_instruction_that_built_it_or_to_scaffolding() {
    let core = desugar(&parse("fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(3)").0.unwrap());
    let prog = lower_asm(&core).expect("lowers");
    let (m, state_origins) = lower_tm_mapped(&prog, &Unary);
    assert_eq!(state_origins.len(), m.states.len(), "state origins must be parallel to states");
    for (s, origin) in state_origins.iter().enumerate() {
        if let Some(idx) = origin {
            assert!(*idx < prog.code.len(), "state {s} maps to instruction {idx}, out of range");
        }
    }
    // Non-vacuity: a real program must attribute the bulk of its states to instructions, not to
    // scaffolding. Without this the test would pass against an all-`None` map.
    let attributed = state_origins.iter().filter(|o| o.is_some()).count();
    assert!(attributed * 2 > m.states.len(), "most states should belong to an instruction, got {attributed}/{}", m.states.len());
}
```

Use whatever encoding the file's existing tests use in place of `Unary` (read them — the `Encoding` trait has a concrete impl the tests already construct).

- [ ] **Step 2: Run it, expect failure.**

Run: `cargo test -p redextape-core --lib lower_tm::`
Expected: FAIL to compile — `lower_tm_mapped` does not exist.

- [ ] **Step 3: Record the state range per instruction.**

`lower_tm` builds states through a builder (`build.rs`, finished by `finish(start) -> Machine`). Around the per-instruction loop at `lower_tm.rs:164`, capture how many states exist before and after each instruction's gadgets are emitted, and fill the range:

```rust
    // States are appended as gadgets are emitted, so the states created while lowering instruction
    // `i` are exactly those appended during that iteration.
    let before = b.state_count();
    // ... existing per-instruction gadget emission ...
    let after = b.state_count();
    for _ in before..after {
        state_origins.push(Some(i));
    }
```

`state_count()` may not exist on the builder — add it (`self.states.len()`) if not, matching the builder's existing style. **Verify the append-only assumption**: if any code path inserts or reorders states rather than appending, this range logic is wrong and the parallel-length assertion in Step 1 will catch a size mismatch but not a misattribution. Read `build.rs` and confirm states are only ever pushed, and say so in your report.

States created before the loop, after it, or by the call-site scaffolding get `None`. The final vector must be indexed by state id, so build it in state order — if the builder can create states out of order, collect a `Vec<Option<usize>>` sized to the final state count instead and assign by index.

- [ ] **Step 4: Add the mapped entry point and reroute the existing one.**

```rust
/// Lower `prog` to a Turing machine, returning the machine AND its state map: `state_origins[s]` is
/// the `prog.code` index whose gadgets built state `s`, or `None` for machine scaffolding that
/// belongs to no single instruction (call-site dispatch, prologue).
///
/// Returned rather than stored on `Machine` deliberately: `Machine` derives `PartialEq` and the TM
/// text round-trip test asserts `parse_tm(print_tm(m)) == m`, which a side-table field would break.
// Body = the CURRENT `lower_tm` body plus Step 3's state-range recording, returning both.
pub fn lower_tm_mapped(prog: &Program, enc: &dyn Encoding) -> (Machine, Vec<Option<usize>>) { .. }

/// Lower `prog` to a Turing machine. Exactly `lower_tm_mapped` with the state map discarded — ONE
/// implementation, so the two cannot drift.
pub fn lower_tm(prog: &Program, enc: &dyn Encoding) -> Machine {
    lower_tm_mapped(prog, enc).0
}
```

- [ ] **Step 5: Run the tests, expect pass.**

```bash
cargo test -p redextape-core --lib lower_tm::
cargo test --workspace
```
Expected: new test passes; workspace green, including the TM text round-trip test (unchanged, because `Machine` is unchanged).

- [ ] **Step 6: Commit.**

```bash
git add crates/redextape-core/src/tm/lower_tm.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): map TM states back to the asm instructions that built them"
```

---

### Task 4: A counting mode on the simulator

**Files:**
- Modify: `crates/redextape-core/src/tm/sim.rs`

**Interfaces:**
- Produces: `simulate_counts(&Machine, &[Vec<Symbol>], Caps) -> (Vec<u64>, Status)` — per-state step counts indexed by state id, `len() == m.states.len()`.
- Consumes: the private `run` (`sim.rs:~126`), which already threads an optional trace sink and maintains a `steps` counter.

**Why not reuse `simulate_trace`:** it records per-step state, tapes, and head position. A 178k-step `sum(5)` trace holding tapes per step is far too heavy merely to count. The counting mode allocates per *state*, not per *step*.

- [ ] **Step 1: Write the failing test** in `sim.rs`'s test module:

```rust
#[test]
fn per_state_counts_sum_to_the_total_step_count() {
    // Cross-check counting against tracing on the SAME machine: the trace's step list is the
    // independent ground truth for how many steps ran, and where.
    //
    // `sim.rs`'s existing test module already builds a small machine for its trace test (the one
    // asserting "3 rightward moves over the marks + 1 write = 4 steps", `sim.rs:~238`). Use that
    // same constructor here — do NOT invent a second fixture, or the two tests could drift and this
    // cross-check would stop comparing like with like.
    let m = /* the machine that test constructs, via the same helper or inline builder */;
    let trace = simulate_trace(&m, &[], DEFAULT_CAPS);
    let (counts, status) = simulate_counts(&m, &[], DEFAULT_CAPS);
    assert_eq!(counts.len(), m.states.len(), "counts must be indexed by state id");
    assert_eq!(counts.iter().sum::<u64>(), trace.steps.len() as u64, "counts must account for every step");
    assert_eq!(status, trace.status, "counting must not change the outcome");
    // Per-state agreement, not just the total: a counter that dumped every step into one bucket
    // would pass a sum-only check.
    for (state, &n) in counts.iter().enumerate() {
        let from_trace = trace.steps.iter().filter(|s| s.state == state as StateId).count() as u64;
        assert_eq!(n, from_trace, "state {state}: counted {n}, trace shows {from_trace}");
    }
}

#[test]
fn counting_a_capped_run_still_accounts_for_every_step_taken() {
    let m = spin();
    let caps = Caps { steps: 1000, ..DEFAULT_CAPS };
    let (counts, status) = simulate_counts(&m, &[], caps);
    assert_eq!(status, Status::HitCap);
    assert_eq!(counts.iter().sum::<u64>(), 1000, "a capped run must still count exactly the steps it took");
}
```

`spin()` already exists in this test module (used by the existing cap tests). For the first test, reuse the machine the existing `simulate_trace` test constructs — read that test and use the same builder, rather than inventing a second fixture.

- [ ] **Step 2: Run the tests, expect failure.**

Run: `cargo test -p redextape-core --lib sim::`
Expected: FAIL to compile — `simulate_counts` does not exist.

- [ ] **Step 3: Thread a counting sink through `run`.**

`run` currently takes `Option<&mut Vec<Step>>` for tracing. Add a second optional sink for counts, and increment it at the same place the `steps` counter is incremented (`sim.rs:~152`), using the state the machine is *leaving*:

```rust
fn run(
    m: &Machine,
    init: &[Vec<Symbol>],
    caps: Caps,
    trace: Option<&mut Vec<Step>>,
    counts: Option<&mut Vec<u64>>,
) -> (Vec<Tape>, StateId, Status) {
    // Body UNCHANGED except for one addition: where `steps += 1` already happens (`sim.rs:~152`),
    // also do `if let Some(c) = counts.as_deref_mut() { c[state_being_left] += 1; }`.
}
```

Update the two existing callers (`simulate`, `simulate_trace`) to pass `None`. Then:

```rust
/// Simulate `m`, accumulating how many steps were taken *in* each state, indexed by state id.
///
/// The counting analogue of `simulate_trace`, and the reason it exists: a trace records tapes per
/// step, so counting a 178k-step program through it would allocate 178k tape snapshots. This
/// allocates one `u64` per state, once.
pub fn simulate_counts(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<u64>, Status) {
    let mut counts = vec![0u64; m.states.len()];
    let (_tapes, _final, status) = run(m, init, caps, None, Some(&mut counts));
    (counts, status)
}
```

Charging the state being *left* (not entered) is what makes the counts sum to the step total: a run of N steps performs N transitions, each leaving exactly one state.

- [ ] **Step 4: Run the tests, expect pass.**

```bash
cargo test -p redextape-core --lib sim::
cargo test --workspace
```

- [ ] **Step 5: Commit.**

```bash
git add crates/redextape-core/src/tm/sim.rs
git commit -m "feat(tm): per-state step counting mode on the simulator"
```

---

### Task 5: Attribution, and the invariant that proves it

**Files:**
- Create: `crates/redextape-core/src/tm/attribute.rs`
- Modify: `crates/redextape-core/src/tm.rs` (declare + re-export)

**Interfaces:**
- Consumes: `lower_asm_mapped`, `defunc_mapped`, `lower_tm_mapped`, `simulate_counts`.
- Produces: `StepBucket`, `attribute_steps`, `total_steps`.

**This task is the one that makes the map trustworthy.** Everything before it is plumbing; this is where a wrong wire becomes visible.

- [ ] **Step 1: Write the failing tests** in `attribute.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Programs small enough to simulate on the TM. TM arithmetic is UNARY — `sum(5)` alone costs
    /// ~178k steps of a 5,000,000 cap — so nothing here may grow much.
    const CASES: [&str; 4] = [
        "2 * 3",
        "1 + 2 * 3",
        "if 2 > 1 { 10 } else { 20 }",
        "fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(3)",
    ];

    #[test]
    fn attribution_accounts_for_every_step() {
        for src in CASES {
            let a = attribute(src).expect("attributes");
            let attributed: u64 = a.histogram.values().sum();
            assert_eq!(attributed, a.total, "{src}: attributed {attributed} of {} steps", a.total);
            assert!(a.total > 0, "{src}: ran zero steps — the case proves nothing");
        }
    }

    #[test]
    fn a_multiply_bills_its_own_binop_node() {
        let a = attribute("2 * 3").expect("attributes");
        let core = desugar(&parse("2 * 3").0.unwrap());
        let steps = a.histogram.get(&StepBucket::Node(core.id())).copied().unwrap_or(0);
        assert!(steps > 0, "the top-level multiply was billed no steps at all");
    }

    #[test]
    fn perturbing_the_map_breaks_the_invariant() {
        // The sabotage test: a guard that cannot fail is not a guard. Shifting the instruction
        // origins by one must make attribution stop accounting for every step, or the invariant is
        // decorative. (A rotation keeps the LENGTH right, so this tests the mapping, not the shape.)
        let a = attribute_with_shifted_origins("fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(3)")
            .expect("attributes");
        let attributed: u64 = a.histogram.values().sum();
        assert_eq!(attributed, a.total, "shifting origins must not lose steps (buckets change, total does not)");
        assert_ne!(
            a.histogram, attribute("fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(3)").unwrap().histogram,
            "shifting the origin map produced an identical histogram — attribution is ignoring the map"
        );
    }
}
```

Note what the sabotage test asserts and why: shifting origins preserves the *total* (every step still lands somewhere) but must change the *histogram*. If it does not, attribution is not actually consulting the map — the failure mode a total-only check would miss.

`attribute_with_shifted_origins` is a test-only helper that runs the same pipeline but rotates the `origins` vector by one before composing.

- [ ] **Step 2: Run the tests, expect failure.**

Run: `cargo test -p redextape-core --lib attribute::`
Expected: FAIL to compile — the module does not exist.

- [ ] **Step 3: Implement the module.**

```rust
//! Attribute TM steps back to the Core constructs that caused them.
//!
//! Composition: per-state step counts (`sim::simulate_counts`) → the asm instruction that built each
//! state (`lower_tm_mapped`) → the `Core` node whose lowering emitted that instruction
//! (`lower_asm_mapped`) → and, for higher-order programs, whether that node is something the user
//! wrote or scaffolding `defunc` synthesized (`defunc_mapped`).
//!
//! The correctness property is exhaustiveness: every step lands in exactly one bucket, so the
//! histogram's values sum to the simulator's total. That single invariant catches dropped
//! instructions, double-counted states, and off-by-one index errors.

use std::collections::{BTreeMap, BTreeSet};

use crate::core::{Core, NodeId};

/// Where a TM step's cost is charged.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum StepBucket {
    /// A `Core` construct the user wrote.
    Node(NodeId),
    /// A node `defunc` synthesized — closure dispatch (`$applyN`), tag comparison, closure
    /// construction. Real cost, but not attributable to anything in the source.
    ClosureScaffold,
    /// A TM state belonging to no single instruction — call-site dispatch, prologue.
    MachineScaffold,
}

/// A program's step attribution.
pub struct Attribution {
    pub histogram: BTreeMap<StepBucket, u64>,
    /// Total steps the simulator reported. `histogram.values().sum() == total` always.
    pub total: u64,
    /// True if the run hit a cap, so the histogram describes a partial execution.
    pub capped: bool,
}
```

`attribute_steps` takes the pieces (so tests can substitute a perturbed map) and composes them:

```rust
/// Compose the maps into a histogram. `origins` is parallel to the program's code; `state_origins`
/// is parallel to the machine's states; `synthetic` is `defunc`'s minted-id set.
pub fn attribute_steps(
    counts: &[u64],
    state_origins: &[Option<usize>],
    origins: &[NodeId],
    synthetic: &BTreeSet<NodeId>,
) -> BTreeMap<StepBucket, u64> {
    let mut hist: BTreeMap<StepBucket, u64> = BTreeMap::new();
    for (state, &n) in counts.iter().enumerate() {
        if n == 0 {
            continue;
        }
        let bucket = match state_origins.get(state).copied().flatten() {
            None => StepBucket::MachineScaffold,
            Some(idx) => match origins.get(idx) {
                None => StepBucket::MachineScaffold,
                Some(id) if synthetic.contains(id) => StepBucket::ClosureScaffold,
                Some(id) => StepBucket::Node(*id),
            },
        };
        *hist.entry(bucket).or_insert(0) += n;
    }
    hist
}
```

And the pipeline convenience the tests and the survey both call:

```rust
/// Attribute a source program's TM steps to the Core constructs that caused them.
///
/// Mirrors `run_tm`'s lowering sequence exactly — including its `defunc` retry — so the attribution
/// describes the same machine `run_tm` would actually run, not a differently-lowered one.
pub fn attribute(src: &str) -> Result<Attribution, LowerError> {
    let core = crate::desugar::desugar(&crate::parser::parse(src).0.expect("parses"));
    // Lower directly; retry through `defunc` only on `Unsupported`, exactly as `run_tm` does.
    // Read `tm.rs:82` and mirror its discrimination — a looser `or_else` would swallow `TooDeep`.
    let (prog, origins, synthetic) = match lower_asm_mapped(&core) {
        Ok((p, o)) => (p, o, BTreeSet::new()),
        Err(LowerError::Unsupported { .. }) => {
            let (d, synthetic) = defunc_mapped(&core)?;
            let (p, o) = lower_asm_mapped(&d)?;
            (p, o, synthetic)
        }
        Err(e) => return Err(e),
    };
    let enc = /* the same Encoding `run_tm` uses — read tm.rs:82 */;
    let (machine, state_origins) = lower_tm_mapped(&prog, enc);
    let (counts, status) = crate::tm::sim::simulate_counts(&machine, &[], crate::tm::sim::DEFAULT_CAPS);
    let histogram = attribute_steps(&counts, &state_origins, &origins, &synthetic);
    let total = counts.iter().sum();
    Ok(Attribution { histogram, total, capped: matches!(status, crate::tm::sim::Status::HitCap) })
}
```

Two details that are load-bearing: `total` comes from the **same `counts` vector** the histogram was built from (deriving it separately would make the invariant compare two independent measurements and mask a composition bug), and the `defunc` retry must match `run_tm`'s error discrimination rather than a looser `or_else` that would also swallow `TooDeep`.

Add the `pub mod attribute;` declaration and re-exports in `tm.rs`.

- [ ] **Step 4: Run the tests, expect pass.**

```bash
cargo test -p redextape-core --lib attribute::
cargo test --workspace
```
Expected: all four tests pass. **If the exhaustiveness invariant fails on any case, STOP and report it** — it means one of Tasks 1–4 wired something wrong, and the number will tell you which (a shortfall means states or instructions with no origin; an excess means double counting).

- [ ] **Step 5: Commit.**

```bash
git add crates/redextape-core/src/tm/attribute.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): attribute TM steps to Core constructs, with an exhaustiveness invariant"
```

---

### Task 6: The survey — corpus, probes, and report

**Files:**
- Create: `crates/redextape-core/examples/step_survey.rs`

**Interfaces:**
- Consumes: `tm::attribute::{StepBucket, Attribution}` and the pipeline convenience from Task 5.

**The deliverable is evidence, not code.** The report's readers are choosing the Tier A pass set; the output must let them see where cost goes and what each candidate pass would recover.

- [ ] **Step 1: Write the example.**

Two corpora, answering two different questions.

**Part A — where cost actually goes.** Reuse the programs already exercised by `crates/redextape-core/tests/three_way_oracle.rs` and `tests/tm_oracle.rs`. **Read those files and take their cases** rather than inventing new ones: they are known TM-feasible, already agree across every backend, and some have committed step-count goldens. Print, per program: total steps, whether it capped, and the buckets sorted by descending steps, each as kind + id + share of total.

Identify a `Node(id)` bucket by looking the id up in the program's `Core` and printing its construct kind (e.g. `BinOp(Mul) #42 — 61%`). Note the honest limit in the report's own output: `Core` carries a `NodeId` but **no source span**, so a construct is identified by kind and id, not line and column.

**Part B — what each pass could recover.** Six probes, each isolating one candidate pass. For each, print the steps for the program as written versus a hand-optimized form, and the difference:

```rust
/// (label, as-written, hand-optimized) — the hand-optimized form is what the named pass WOULD
/// produce, written out by hand. The delta is that pass's ceiling on this shape.
/// Every program here must complete under DEFAULT_CAPS: TM arithmetic is unary, so keep them small.
const PROBES: [(&str, &str, &str); 6] = [
    ("constant folding",      "2 * 3 + 4 * 5",                         "26"),
    ("algebraic identities",  "let x = 7; x * 1 + x * 0 + (x + 0)",    "let x = 7; x + x"),
    ("dead-code elimination", "let a = 3; let b = 4; a",               "let a = 3; a"),
    ("const propagation",     "let x = 6; x * x",                      "36"),
    ("common subexpressions", "let n = 4; (n + n) + (n + n)",          "let n = 4; let t = n + n; t + t"),
    ("inlining",              "fn id(x){ x } id(5) + id(6)",           "5 + 6"),
];
```

Print a closing note that a probe's delta is a **ceiling** on that pass — it is what the pass recovers on a shape built to suit it, not what it would recover on real programs. Part A is what says whether that shape occurs.

- [ ] **Step 2: Run it.**

```bash
cargo run --release --example step_survey -p redextape-core
```
Expected: every corpus program and probe completes without hitting a cap; each program's buckets sum to its total. Paste the **complete verbatim output** into your task report — that output is the deliverable this whole slice exists to produce.

- [ ] **Step 3: Verify the probes are honest.**

For each probe, confirm the as-written and hand-optimized forms **compute the same value** (run both through `run` and compare) — a probe whose "optimized" form computes something different measures nothing. Add that as an assertion in the example so it cannot rot:

```rust
    assert_eq!(run(written).unwrap(), run(optimized).unwrap(), "probe {label}: the two forms disagree");
```

- [ ] **Step 4: Run the full suite.**

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
```

- [ ] **Step 5: Commit.**

```bash
git add crates/redextape-core/examples/step_survey.rs
git commit -m "feat(tm): step survey — where TM steps go, and what each candidate pass could recover"
```

---

## Notes for the executor

- **The whole point of the artifact-not-field design is zero blast radius.** If you find yourself changing `Program`, `Machine`, or an existing public signature, stop — that is the design being violated, not an implementation detail.
- **Each mapped/unmapped pair must have ONE implementation.** `lower_asm`, `defunc`, and `lower_tm` are all reimplemented as thin wrappers. A second parallel implementation would silently drift and defeat the design.
- **`cargo test --workspace` staying green is the evidence** that rerouting changed nothing. Run it at every task, not just at the end.
- **Totality is inherited, not re-derived:** the depth guards (`MAX_LOWER_DEPTH`, `MAX_DEFUNC_DEPTH`) and `Caps` move with the code they guard. Do not add new recursion without a guard — `Core` spines reach tens of thousands of nodes deep, which is why `Core` has a hand-written iterative `Drop`.
- **TM steps are unary and explode:** `sum(5)` is ~178k steps against a 5,000,000 cap. Every program you add to the survey or probes must be sized against that, and the report must label any capped run as partial rather than presenting truncated counts as complete.
- **Task 2's audit is judgement work**, not mechanical. A rewrite site classified wrongly does not fail the build; it silently misattributes cost. List your classifications in the report so a reviewer can check them.
- Task ordering is a dependency chain: 1 → 2 → 3 → 4 → 5 → 6. Task 5 consumes all four maps; Task 6 consumes Task 5.
