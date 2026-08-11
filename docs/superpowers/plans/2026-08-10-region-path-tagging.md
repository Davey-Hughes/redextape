# Region-Path Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag the five App-rooted constructs in `lower.rs`'s store-passing path so loop programs stop reporting `Owner::None` for ~92% of their β-steps.

**Architecture:** Five `app` → `app_owned` substitutions in `lower_region_body` and `build_while`, using the `NodeId` each arm already binds. Nothing in `Owner`, `reduce_step_go`, `ZipperCursor`, `LambdaState` or the wire changes — `app_owned` is the constructor the five functional sites already use and the tag-survives-β machinery is construct-agnostic. A measurement task then gates an optional rendering task.

**Tech Stack:** Rust (`redextape-core`), TypeScript (`web/`), `owner_probe` as the measurement instrument, `cargo test` / `vitest` / `wasm-pack test` as the gates.

**Spec:** `docs/superpowers/specs/2026-08-10-region-path-tagging-design.md`

## Global Constraints

- **Pre-commit gate runs `cargo clippy -D warnings` on every commit.** Never `--no-verify`. If a task's commit split turns out infeasible, collapse it and say so.
- **No attribution in commit messages.** No `Co-Authored-By`, no `Generated with`.
- **`owner_probe` runs under a hard cgroup cap**, always: `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- cargo run --release -q -p redextape-core --example owner_probe`. An earlier measurement over a comparable family took 60 GiB and wedged the machine. An OOM-kill is a result to report, not something to work around by raising the cap.
- **M1's success threshold is pre-registered and not renegotiated:** the tagged (`Exact`+`Within`) rate must reach **≥16.2% on `while4`** and **≥18.2% on `countdown4`**.
- **M2's gate is unchanged in form:** if **two or more** of the nine corpus programs report a median `Within` span over 60% of program length, Task 6 runs before merge. If one or zero, Task 6 does not run.
- **`Assign` is never tagged.** Its root is an `Abs`. This is a decision, not an omission — see spec §1.
- **The region entry (`lower_region`'s returned `App`) is never tagged.** It would duplicate the region root's id onto a second `App`.
- Branch: `region-path-tagging`, already open as draft PR #28.

---

### Task 1: Put a loop program under the two-β-loop equivalence gate

`zipper_equivalence.rs` holds `LambdaCursor` and `ZipperCursor` equal on whole `StepEvent`s including `owner`. All six of its curated cases are purely functional and `arb_expr_over` emits no loops, so it has never executed a `while`, a `let mut` or an assignment. Close that before the tagging lands, so the gate is already watching when it does.

This task passes immediately — it is coverage, not behaviour. It is separate because a reviewer could take it on its own merits.

**Files:**
- Modify: `crates/redextape-core/tests/zipper_equivalence.rs` (the `cases` array in `curated_shapes_agree_step_for_step`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a curated case labelled `"mutation and a loop"` that Task 4 attaches a census assertion to.

- [ ] **Step 1: Add the loop case to the curated array**

In `curated_shapes_agree_step_for_step`, add the loop program **as its own binding after the `cases`
loop** — not as a seventh entry in `cases`. Task 4 needs this shape's census on its own, and putting
it in `cases` now only to move it out later would be add-then-remove churn in one plan.

The function currently reads:

```rust
    let mut census = OwnerCensus::default();
    for (label, src) in cases {
        let t = term_of(src).unwrap_or_else(|| panic!("{label} must lower"));
        census.merge(assert_cursors_agree(&t, label));
    }
```

Add directly beneath it:

```rust
    // THE REGION PATH, WHICH NOTHING IN THIS FILE REACHED BEFORE. The six shapes above are all
    // functional, and `arb_expr_over` emits only `+`, monus `-`, `>`, `==` and `if` over integer
    // leaves — so `while`, `let mut` and assignment were never executed by the strongest gate in the
    // crate. That matters beyond coverage arithmetic: `ZipperCursor` derives `Owner` from a reverse
    // scan of its context stack where `reduce_step_go` carries it down a descent, and `build_while`'s
    // `fix`-based spine is deeper and differently shaped than anything the six above produce. Two
    // routes to one answer diverge, if they diverge at all, exactly there.
    //
    // BOUND SEPARATELY RATHER THAN ADDED TO `cases` because Task 4 asserts this shape's own census:
    // merged into the total, a region path reporting `None` for every step would hide behind the
    // hundreds of `Exact`/`Within` the functional shapes already supply.
    let loop_src = "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc";
    let loop_t = term_of(loop_src).expect("the loop shape must lower");
    census.merge(assert_cursors_agree(&loop_t, "mutation and a loop"));
```

- [ ] **Step 2: Run the gate and confirm it passes**

```bash
cargo test -p redextape-core --test zipper_equivalence curated_shapes_agree_step_for_step -- --nocapture
```

Expected: PASS. The two cursors already agree on this program; every step reports `Owner::None` today, which is why Task 4 exists.

- [ ] **Step 3: Commit**

```bash
git add crates/redextape-core/tests/zipper_equivalence.rs
git commit -m "test: put a loop program under the two-beta-loop equivalence gate

All six curated shapes were functional and arb_expr_over emits no loops, so the
gate that holds LambdaCursor and ZipperCursor equal on whole StepEvents had
never executed a while, a let mut or an assignment. The zipper derives Owner
from a reverse frame scan where the reducer carries it down a descent, and
build_while's fix-based spine is where those two routes would diverge."
```

---

### Task 2: Tag the four `app(abs(..), ..)`-shaped region arms

Both region `Let` arms, `Seq`, and region `If`. Each already binds the `NodeId` it needs.

**Files:**
- Modify: `crates/redextape-core/src/lambda/lower.rs` (`lower_region_body`: the `Let { mutable: true }`, `Let { mutable: false }`, `Seq` and `If` arms)
- Modify: `crates/redextape-core/tests/lambda_provenance.rs` (new test)

**Interfaces:**
- Consumes: `app_owned(f: LambdaTerm, a: LambdaTerm, owner: NodeId) -> LambdaTerm` from `crate::lambda::term`, already imported by `lower.rs`.
- Produces: region constructs carrying tags, which Task 3's fixture and Task 4's census assertion both rely on. Also two test helpers Task 3 reuses: `find_id(core: &Core, pred: &impl Fn(&Core) -> bool) -> Option<u32>` and `app_tagged_with(t: &LambdaTerm, id: u32) -> Option<LambdaTerm>`.

- [ ] **Step 1: Write the failing test**

Append to `crates/redextape-core/tests/lambda_provenance.rs`:

```rust
/// **THE DUPLICATION GUARD, AND THE REASON THE REGION ENTRY IS NOT A TAGGING SITE.**
/// `lower_region(node)` and `lower_region_body(node)` are called with the SAME node, so tagging both
/// would put one `NodeId` on two distinct `App`s. Design §1 rejects that; this is what notices if it
/// comes back.
///
/// **AND PER-CONSTRUCT PRESENCE THROUGH THE RESOLVED SOURCE TEXT, NOT A COUNT.** A `unique.len() >= 3`
/// floor would assert that *some* three tags exist, which stays green if one arm is wired up and
/// another is not. Resolving each tag to its own source text names which arms actually fired.
#[test]
fn region_constructs_tag_their_own_roots_without_duplicating() {
    let src = "let mut n = 2; while n > 0 { n = n - 1; } n";
    let (program, diags) = redextape_core::parser::parse(src);
    assert!(diags.is_empty(), "the fixture must parse cleanly: {diags:?}");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("the fixture lowers");

    let tags: Vec<u32> = owners(&term).into_iter().flatten().collect();
    let unique: std::collections::BTreeSet<u32> = tags.iter().copied().collect();
    assert_eq!(
        tags.len(),
        unique.len(),
        "a construct tagged more than one App — the region entry duplication design §1 rejects: {tags:?}"
    );

    let texts: Vec<&str> = unique
        .iter()
        .map(|id| {
            let span = map.source_span(*id).unwrap_or_else(|| panic!("tag {id} resolves to no source span"));
            &src[span.start..span.end]
        })
        .collect();
    assert!(
        texts.iter().any(|t| t.starts_with("let mut")),
        "the region's `let mut` must carry a tag of its own, got {texts:?}"
    );
    assert!(
        texts.iter().any(|t| t.starts_with("while")),
        "the `while` must carry a tag of its own, got {texts:?}"
    );
}

/// **WHICH `App` THE TAG LANDS ON, WHICH FLATTENING A TERM INTO A TAG SET CANNOT SEE.** A region `If`
/// builds `app(app(lc, lt), le)` and only the OUTER application is the construct's own root; tagging
/// the inner one leaves the tag set identical, resolves through the source map identically, and is
/// exactly the wrong-node defect this project has now hit in several disguises.
///
/// The discriminator is the condition's own shape. `true` lowers to a Scott boolean — an `Abs` — so
/// on the outer application the function side is an `App`, and on the inner one it would be that
/// `Abs`. A fixture with an application-shaped condition could not tell the two apart.
#[test]
fn a_region_ifs_tag_sits_on_its_outer_application() {
    let src = "let mut n = 0; if true { n = 1; } else { n = 2; }; n";
    let (program, diags) = redextape_core::parser::parse(src);
    assert!(diags.is_empty(), "the fixture must parse cleanly: {diags:?}");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, _map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("the fixture lowers");

    let if_id = find_id(&core, &|c| matches!(c, redextape_core::core::Core::If(..)))
        .expect("the fixture contains an if");
    let tagged = app_tagged_with(&term, if_id).expect("the region If's own root App must be tagged");
    let Node::App(f, _, _) = tagged.node() else { unreachable!("app_tagged_with returns an App") };
    assert!(
        matches!(f.node(), Node::App(..)),
        "the tag sits on the INNER application — `app(app(lc, lt), le)`'s outer node is the If's own \
         root, and `true` lowers to an Abs so the inner one's function side is not an App"
    );
}

/// The `App` carrying `id`, if exactly one does. Returns `None` when no node carries it; panics when
/// two do, which the duplication guard above already forbids and this would otherwise hide.
fn app_tagged_with(t: &LambdaTerm, id: u32) -> Option<LambdaTerm> {
    let mut found: Vec<LambdaTerm> = Vec::new();
    let mut stack = vec![t.clone()];
    while let Some(cur) = stack.pop() {
        match cur.node() {
            Node::App(f, a, owner) => {
                if *owner == Some(id) {
                    found.push(cur.clone());
                }
                stack.push(f.clone());
                stack.push(a.clone());
            }
            Node::Abs(_, b) => stack.push(b.clone()),
            Node::Var(_) => {}
        }
    }
    assert!(found.len() <= 1, "tag {id} sits on {} Apps; it must sit on exactly its own root", found.len());
    found.pop()
}

/// The `NodeId` of the first `Core` node in a pre-order walk satisfying `pred`. Read off the parsed
/// tree rather than hardcoded, so these tests track whatever ids the parser assigns instead of a
/// number that could drift. `Core::for_each_child` (`core.rs:89`) is the existing walker; no new
/// method on `Core` is needed.
// DEFECT 2 — do not copy; see "Plan defects found during execution"
fn find_id(core: &redextape_core::core::Core, pred: &impl Fn(&redextape_core::core::Core) -> bool) -> Option<u32> {
    if pred(core) {
        return Some(core.id());
    }
    let mut found = None;
    core.for_each_child(&mut |c| {
        if found.is_none() {
            found = find_id(c, pred);
        }
    });
    found
}
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cargo test -p redextape-core --test lambda_provenance region_constructs_tag_their_own_roots_without_duplicating
```

Expected: FAIL. `region_constructs_tag_their_own_roots_without_duplicating` fails on the `starts_with("let mut")` assertion — the region path mints no tags, so only `lower_expr`'s `BinOp` tags are present. `a_region_ifs_tag_sits_on_its_outer_application` fails on `app_tagged_with` returning `None`.

- [ ] **Step 3: Tag `Let { mutable: true }`**

In `lower_region_body`, that arm currently ends:

```rust
            Ok(app(abs(STORE, cont), new_store))
```

Replace with:

```rust
            Ok(app_owned(abs(STORE, cont), new_store, *id))
```

- [ ] **Step 4: Tag `Let { mutable: false }`**

That arm currently ends:

```rust
            Ok(app(abs(name.clone(), lb), lv))
```

Replace with:

```rust
            Ok(app_owned(abs(name.clone(), lb), lv, *id))
```

- [ ] **Step 5: Tag `Seq`**

That arm currently ends:

```rust
            Ok(app(abs(STORE, cont), first_store))
```

Replace with:

```rust
            Ok(app_owned(abs(STORE, cont), first_store, *id))
```

- [ ] **Step 6: Tag the region `If`**

That arm currently ends:

```rust
            Ok(app(app(lc, lt), le))
```

Replace with — note the tag goes on the OUTER application, the node's own root, exactly as `lower_expr`'s `If` arm does:

```rust
            Ok(app_owned(app(lc, lt), le, *id))
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
cargo test -p redextape-core --test lambda_provenance region_constructs_tag_their_own_roots_without_duplicating
```

Expected: PASS.

- [ ] **Step 8: Run the full crate to confirm nothing else moved**

```bash
cargo test -p redextape-core
```

Expected: PASS throughout. `lowering_tags_each_core_construct_at_its_own_root` uses `let x = 40; x + 2`, which has no region, so its exact-set assertion is unaffected.

- [ ] **Step 9: Commit**

```bash
git add crates/redextape-core/src/lambda/lower.rs crates/redextape-core/tests/lambda_provenance.rs
git commit -m "feat(lower): tag the four app-rooted region arms

Both region Let arms, Seq and the region If each return an App at the root and
each already binds the NodeId it needs. lower_expr tags Let and If; the region
path did not, which is the same construct answering differently depending on
whether it sits inside a store-passing region.

The region entry stays untagged: lower_region and lower_region_body see the
same node, so tagging both would put one NodeId on two Apps. The new test is
the guard for that, asserting no tag repeats rather than pinning an exact set
the region desugaring's shape would make brittle."
```

---

### Task 3: Tag `While`, threading its `NodeId` into `build_while`

`build_while` builds the loop's own root `App` and does not currently take an id. This is the only signature change in the slice.

**Files:**
- Modify: `crates/redextape-core/src/lambda/lower.rs` (`build_while` signature and return; the `Core::While` arm's call)
- Modify: `crates/redextape-core/tests/lambda_provenance.rs` (two new tests)

**Interfaces:**
- Consumes: `app_owned` as in Task 2; `Core::While(id, cond, body)` binds `id`.
- Produces: `build_while(id: NodeId, cond: &Core, body: &Core, scope: &mut Vec<String>, ctx: &StoreCtx, origins: &mut Origins) -> Result<LambdaTerm, LowerError>` — `id` first, matching how `lower_group` already leads with its `NodeId`.

- [ ] **Step 1: Write the failing tests**

Append to `crates/redextape-core/tests/lambda_provenance.rs`:

```rust
/// **THE FACT THE WHOLE `Within` ARGUMENT RESTS ON, FOR THE LOOP.** A `While`'s tag encloses its
/// entire body, so if it resolved to the whole program instead of the loop's own text, every
/// `Within` step inside a loop would name the program — the degenerate nearest-enclosing-node
/// answer 5b refused on the TM leg. This is the same assertion 5c added for `Let`'s span, for the
/// same reason. Asserted as a prefix and a strict-substring bound rather than an exact literal: the
/// property is "the loop, not the program", not a particular slice of the fixture.
#[test]
fn a_whiles_tag_names_the_loop_and_not_the_whole_program() {
    let src = "let mut n = 2; while n > 0 { n = n - 1; } n";
    let (program, diags) = redextape_core::parser::parse(src);
    assert!(diags.is_empty(), "the fixture must parse cleanly: {diags:?}");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("the fixture lowers");

    let while_id = find_while_id(&core).expect("the fixture contains a while");
    let tags: std::collections::BTreeSet<u32> = owners(&term).into_iter().flatten().collect();
    assert!(tags.contains(&while_id), "the While's own root App must be tagged, got {tags:?}");

    let span = map.source_span(while_id).expect("the While's tag resolves to a source span");
    let text = &src[span.start..span.end];
    assert!(text.starts_with("while"), "the While's tag must name the loop, got {text:?}");
    assert!(
        span.end - span.start < src.len(),
        "the While's tag must not span the whole program, got {text:?} of {} bytes",
        src.len()
    );
}

/// `in_position` DISCARDS the loop in value position (`encode::church(0)`), so there is no node to
/// tag and nothing runs. A later "fix" that stopped discarding it would silently start tagging a
/// term the reducer never reaches; this fails if that happens.
#[test]
fn a_while_in_value_position_carries_no_tag() {
    // DEFECT 4 — do not copy; see "Plan defects found during execution"
    // The region's tail IS the loop, so it lowers in `Pos::Value` and is discarded.
    let src = "let mut n = 2; while n > 0 { n = n - 1; }";
    let (program, diags) = redextape_core::parser::parse(src);
    assert!(diags.is_empty(), "the fixture must parse cleanly: {diags:?}");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, _map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("the fixture lowers");

    let while_id = find_while_id(&core).expect("the fixture contains a while");
    let tags: std::collections::BTreeSet<u32> = owners(&term).into_iter().flatten().collect();
    assert!(
        !tags.contains(&while_id),
        "a value-position While is discarded by `in_position`; tagging it names a term that never runs"
    );
}

/// The first `Core::While` in a pre-order walk. Read off the parsed tree rather than hardcoded, so
/// these tests track whatever ids the parser assigns instead of a number that could drift.
/// `Core::for_each_child` (`core.rs:89`) is the existing walker; no new method on `Core` is needed.
// DEFECT 3 — do not copy; see "Plan defects found during execution"
fn find_while_id(core: &redextape_core::core::Core) -> Option<u32> {
    use redextape_core::core::Core;
    if let Core::While(id, ..) = core {
        return Some(*id);
    }
    let mut found = None;
    core.for_each_child(&mut |c| {
        if found.is_none() {
            found = find_while_id(c);
        }
    });
    found
}
```

- [ ] **Step 2: Run the tests to make sure they fail**

```bash
cargo test -p redextape-core --test lambda_provenance a_whiles_tag_names_the_loop
cargo test -p redextape-core --test lambda_provenance a_while_in_value_position
```

Expected: the first FAILS on `tags.contains(&while_id)` — `While` is untagged. The second PASSES already (nothing is tagged), and is a regression guard rather than a driver.

- [ ] **Step 3: Add the `NodeId` parameter to `build_while`**

Change the signature from:

```rust
fn build_while(
    cond: &Core,
    body: &Core,
    scope: &mut Vec<String>,
    ctx: &StoreCtx,
    origins: &mut Origins,
) -> Result<LambdaTerm, LowerError> {
```

to:

```rust
fn build_while(
    id: NodeId,
    cond: &Core,
    body: &Core,
    scope: &mut Vec<String>,
    ctx: &StoreCtx,
    origins: &mut Origins,
) -> Result<LambdaTerm, LowerError> {
```

- [ ] **Step 4: Tag the loop's own root App**

`build_while` currently ends:

```rust
    let g = abs(LOOP, abs(STORE, iter));
    Ok(app(app(fix(), g), s_init))
```

Replace with — the tag goes on the OUTER application, which is the loop's own root:

```rust
    let g = abs(LOOP, abs(STORE, iter));
    // THE LOOP'S OWN ROOT. `(fix g)` is the inner application and belongs to no source construct;
    // applying it to the initial store is the node the `while` IS. Tagged here rather than at the
    // `Core::While` arm because the arm never sees this App — `in_position` either passes it through
    // or discards it wholesale.
    Ok(app_owned(app(fix(), g), s_init, id))
```

- [ ] **Step 5: Pass the id at the call site**

In `lower_region_body`'s `Core::While` arm, change:

```rust
            let loop_term = build_while(cond, body, scope, ctx, origins)?;
```

to:

```rust
            let loop_term = build_while(*id, cond, body, scope, ctx, origins)?;
```

- [ ] **Step 6: Run both tests to verify they pass**

```bash
cargo test -p redextape-core --test lambda_provenance a_whiles_tag_names_the_loop
cargo test -p redextape-core --test lambda_provenance a_while_in_value_position
```

Expected: both PASS. The value-position test still passes because `in_position` discards `loop_term` there, so the tagged App never reaches the returned term.

- [ ] **Step 7: Run the full crate**

```bash
cargo test -p redextape-core && cargo clippy --workspace --all-targets --all-features
```

Expected: PASS, no warnings.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/src/lambda/lower.rs crates/redextape-core/tests/lambda_provenance.rs
git commit -m "feat(lower): tag the while loop's own root App

build_while builds `(fix g) s_init` — the node the while IS — and did not take
an id, so it gains one. Tagged there rather than at the Core::While arm because
the arm never sees that App: in_position either passes the loop through or
discards it wholesale.

Two tests. The first pins that the While's tag resolves to the loop's own
source text and not the whole program, which is the fact the entire Within
non-degeneracy argument rests on for loops — the same assertion 5c added for
Let's span. The second pins that a value-position While stays untagged, since
in_position discards it and tagging a term the reducer never reaches would name
work that does not happen."
```

---

### Task 4: Make the equivalence gate's owner comparison non-vacuous on the region path

Task 1's loop case compares `owner` for free, but would pass just as happily if both cursors reported `None` forever. This asserts the region tags are actually observed — and that the two β-loops agree on them.

**Files:**
- Modify: `crates/redextape-core/tests/zipper_equivalence.rs`

**Interfaces:**
- Consumes: `assert_cursors_agree(t: &LambdaTerm, label: &str) -> OwnerCensus`, and `OwnerCensus`'s `exact` / `within` / `none` fields and `tagged()` method, all already present.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Capture the loop case's own census separately**

Task 1 left the loop shape merged straight into the total. Bind its census so it can be asserted
alone — replace that task's final line:

```rust
    census.merge(assert_cursors_agree(&loop_t, "mutation and a loop"));
```

with:

```rust
    let loop_census = assert_cursors_agree(&loop_t, "mutation and a loop");
    // THE REGION PATH'S OWN CENSUS, ASSERTED ALONE. Merged into the total it would be invisible: the
    // six functional shapes already supply hundreds of `Exact` and `Within`, so a region path that
    // reported `None` for every step would leave `census.exact > 0` and `census.within > 0` green.
    // This is the assertion that fails if the tags stop reaching the store-passing spine.
    assert!(
        loop_census.tagged() > 0,
        "the loop shape stepped {} times without a single tagged owner — the region path is untagged \
         and this gate's owner comparison is vacuous on it: {loop_census:?}",
        loop_census.total()
    );
    census.merge(loop_census);
```

- [ ] **Step 2: Run the gate**

```bash
cargo test -p redextape-core --test zipper_equivalence curated_shapes_agree_step_for_step
```

Expected: PASS — Tasks 2 and 3 have landed, so the loop shape now reports tagged owners.

- [ ] **Step 3: Verify the assertion actually bites**

This is a regression guard added after the behaviour it guards, so it passes on arrival and must be shown to fail under the mutation it exists to catch. Temporarily revert one tag — in `lower.rs`'s `Seq` arm, change `app_owned(abs(STORE, cont), first_store, *id)` back to `app(abs(STORE, cont), first_store)` — then:

```bash
cargo test -p redextape-core --test zipper_equivalence curated_shapes_agree_step_for_step
```

Record whether it FAILS. If it still passes, the loop fixture's tags are coming entirely from other arms and the assertion is weaker than intended — tighten it to require `loop_census.within > 0` specifically, or pick a fixture whose tags depend on `Seq`. Then restore the `app_owned` call and re-run to confirm PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/tests/zipper_equivalence.rs
git commit -m "test: hold the loop shape's owner census on its own, not merged

Merged into the total it proved nothing: the five functional shapes already
supply hundreds of Exact and Within, so a region path reporting None for every
step would leave the existing census assertions green. Asserted alone, it fails
the moment the tags stop reaching the store-passing spine.

Verified to bite by reverting Seq's app_owned and rerunning."
```

---

### Task 5: Measure — M1 against the pre-registered threshold, M2 against the gate

No code. This is the measurement the slice is judged on, and it decides whether Task 6 runs.

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (record both tables)

**Interfaces:**
- Consumes: the tagging from Tasks 2 and 3.
- Produces: the M2 verdict that gates Task 6.

- [ ] **Step 1: Run the probe under the cap**

```bash
systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
  cargo run --release -q -p redextape-core --example owner_probe
```

Expected: nine `[M1]` rows and nine `[M2]` rows, then a verdict line. An OOM-kill or timeout is a result to report, not a reason to raise the cap.

- [ ] **Step 2: Check M1 against the pre-registered threshold**

Compute `(Exact + Within) / steps` for `while4` and `countdown4`. Baseline was 8.1% and 9.1%.

- **≥16.2% and ≥18.2%** → the threshold is met, continue.
- **Below either** → the tagging did not reach the steps that matter. **Do not adjust the threshold.** Stop, record the numbers in the roadmap with the shortfall stated plainly, and report back rather than proceeding to Task 6.

- [ ] **Step 3: Check M2 and record the verdict**

Count the programs whose `[M2]` row reads `degenerate` (median `Within` span > 60%). Baseline was exactly one (`sum5`, 65.0%).

- **Two or more** → Task 6 runs before merge.
- **One or zero** → Task 6 does not run. Skip to Task 7.

- [ ] **Step 4: Record both tables in the roadmap**

Add before/after M1 and M2 tables to the roadmap's closing entry for this slice, so the next slice inherits numbers rather than an impression. State the M2 verdict and whether Task 6 ran.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "roadmap: M1 and M2 re-measured after region-path tagging"
```

---

### Task 6: Width-aware rendering — CONDITIONAL on Task 5 Step 3

**Run this task only if two or more programs reported `degenerate`.** If Task 5 recorded one or zero, skip to Task 7.

A `Within` whose source span exceeds 60% of program length renders as an edge rule instead of a wash. `Exact` and `coincident` are untouched.

**Files:**
- Modify: `web/src/link.ts` (the predicate)
- Modify: `web/src/highlight.ts` (`setFocus`'s claim union, `FOCUS_CLASS`)
- Modify: `web/src/main.ts` (`programBytes`, and the claim choice in `draw()`)
- Modify: `web/src/style.css` (one rule)
- Modify: `web/tests/node/link.test.ts` (predicate unit tests)
- Modify: `web/tests/browser/running-focus.test.ts` (one browser case)

**Interfaces:**
- Consumes: `Focus = { node: number; claim: 'exact' | 'within' }` and `isCoincident(pin, focus)` from `link.ts`; `Span = { start: number; end: number }` from `types.ts`.
- Produces: `WIDE_WITHIN_FRACTION: number` and `isWideSpan(span: Span, programBytes: number): boolean` from `link.ts`; the claim union in `highlight.ts` widens to `'exact' | 'within' | 'within-wide' | 'coincident'`.

- [ ] **Step 1: Write the failing predicate tests**

Append to `web/tests/node/link.test.ts`:

```ts
describe('isWideSpan', () => {
  it('is false at exactly the threshold, true just above it', () => {
    // 60 of 100 bytes is exactly 60% — not "exceeds", so not wide.
    expect(isWideSpan({ start: 0, end: 60 }, 100)).toBe(false)
    expect(isWideSpan({ start: 0, end: 61 }, 100)).toBe(true)
  })

  it('is false well below the threshold', () => {
    expect(isWideSpan({ start: 10, end: 30 }, 100)).toBe(false)
  })

  // A zero-length program cannot be divided into. Guarding here rather than at the call site keeps
  // the rule in one place, and `false` is the safe answer: it renders as today rather than demoting.
  it('is false for a zero-length program rather than dividing by zero', () => {
    expect(isWideSpan({ start: 0, end: 0 }, 0)).toBe(false)
  })
})
```

Add `isWideSpan` to that file's import from `../../src/link`.

- [ ] **Step 2: Run to verify it fails**

```bash
cd web && pnpm exec vitest run --project node tests/node/link.test.ts
```

Expected: FAIL — `isWideSpan` is not exported.

- [ ] **Step 3: Implement the predicate**

Append to `web/src/link.ts`:

```ts
/**
 * M2's own threshold, REUSED RATHER THAN REINVENTED. `owner_probe`'s gate calls a program degenerate
 * when its median `Within` span exceeds 60% of program length; this is the same 60%, applied per
 * frame instead of per corpus. Two numbers would need two justifications and could drift apart.
 */
export const WIDE_WITHIN_FRACTION = 0.6

/**
 * Whether a source span covers enough of the program that `Within` stops being informative.
 *
 * BYTES ON BOTH SIDES. `span` is a byte span like every other span on the wire, so `programBytes`
 * must be the source's BYTE length — `doc.length` is UTF-16 and would understate any program with a
 * multi-byte character in it, making a wide span read as narrow.
 *
 * STRICTLY GREATER, matching `owner_probe`'s `m > 60.0`. A span at exactly the threshold is not wide.
 */
export function isWideSpan(span: Span, programBytes: number): boolean {
  if (programBytes <= 0) return false
  return (span.end - span.start) / programBytes > WIDE_WITHIN_FRACTION
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd web && pnpm exec vitest run --project node tests/node/link.test.ts
```

Expected: PASS.

- [ ] **Step 5: Widen the claim union in `highlight.ts`**

Change `setFocus`'s definition and `FOCUS_CLASS`:

```ts
export const setFocus = StateEffect.define<{
  span: Span
  claim: 'exact' | 'within' | 'within-wide' | 'coincident'
} | null>()

const FOCUS_CLASS: Record<'exact' | 'within' | 'within-wide' | 'coincident', string> = {
  exact: 'is-focus-exact',
  within: 'is-focus-within',
  'within-wide': 'is-focus-within-wide',
  coincident: 'is-focus-coincident',
}
```

- [ ] **Step 6: Record the program's byte length once per compile**

In `main.ts`, beside `let index: LinkIndex | null = null`:

```ts
  /**
   * The compiled program's BYTE length, for `isWideSpan`. Recorded per compile rather than per frame:
   * spans are bytes and `doc.length` is UTF-16, so this needs a real encode, which the record loop
   * must not pay once per rendered frame.
   */
  let programBytes = 0
```

In `schedule(src)`, capture the source being compiled — add above `const gen = client.supersede()`:

```ts
    pendingSrc = src
```

and declare `let pendingSrc = ''` beside `let timer`. Then in `onReply`'s `case 'compiled':`, alongside `linkable = index !== null`:

```ts
        programBytes = new TextEncoder().encode(pendingSrc).length
```

- [ ] **Step 7: Choose the claim in `draw()`**

In `draw()`, replace:

```ts
      const claim = isCoincident(link, focus) ? 'coincident' : focus.claim
```

with:

```ts
      // WIDTH MODULATES `within` ONLY. `Exact` says this step IS this construct — a strong, true
      // claim whatever the construct's size, and M2 was never about it. `coincident` is the rarer
      // and more informative signal and keeps winning outright. See `isWideSpan`.
      const claim = isCoincident(link, focus)
        ? 'coincident'
        : focus.claim === 'within' && isWideSpan(focusLink.source, programBytes)
          ? 'within-wide'
          : focus.claim
```

Add `isWideSpan` to `main.ts`'s import from `./link`.

- [ ] **Step 8: Add the style rule**

Append to `web/src/style.css`, after the `.is-focus-within` rule:

```css
/* A `Within` whose span covers more than `WIDE_WITHIN_FRACTION` of the program (`link.ts`). AN EDGE
   INSTEAD OF A WASH, NOT A FAINTER WASH — at this width a tinted block is most of the pane and reads
   as noise, where a rule under the range reads as an extent. Note this REPLACES rather than subtracts:
   `.is-focus-within` above is background-only and has no edge of its own, so the rule below is
   borrowed from `.is-focus-exact`'s treatment at reduced weight, never matching its 2px solid. */
.cm-editor .is-focus-within-wide {
  box-shadow: inset 0 -1px 0 color-mix(in oklab, var(--tok-operator) 55%, transparent);
}
```

- [ ] **Step 9: Add the browser case**

Append to `web/tests/browser/running-focus.test.ts`, inside the `describe('the running focus', …)` block — modelled on the existing focus cases in that file, using whichever helper they use to read focus elements:

```ts
  // A LOOP-WIDE `Within` MUST NOT PAINT THE SAME AS A NARROW ONE. `while4`'s loop is roughly half its
  // program text, which is what `isWideSpan` exists to notice; the sample program's own `Within`
  // answers are far narrower and must keep the ordinary treatment.
  it('renders a loop-wide Within weakly and a narrow one normally', async () => {
    await settled(view, 'let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc')
    // Step until some frame reports a wide Within, then assert the class it took.
    // Walk backward from the frontier, as the other cases in this file do.
    expect(document.querySelectorAll('.cm-editor .is-focus-within-wide').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.cm-editor .is-focus-within-wide')[0]?.className).not.toContain(
      'is-focus-exact',
    )
  }, 30_000)
```

Adapt the stepping to match the surrounding cases rather than inventing a new idiom; if no frame in that program produces a wide `Within`, that is a finding — record it and reconsider whether Task 6 was warranted.

- [ ] **Step 10: Run the web suites**

```bash
cd web && pnpm run typecheck && pnpm exec biome check src tests && pnpm run test
```

Expected: PASS throughout.

- [ ] **Step 11: Eyeball gate**

Load the app, run `while4` and `countdown4` under `⏵` in **both** themes. Confirm:

1. The loop-wide `Within` reads as an extent, not as noise.
2. It reads **weaker** than `.is-focus-exact`, not louder. A 1px rule across half the program can still dominate — if it does, reduce the weight further or fall back to the status line and pay the a11y cost, as the spec's §3 allows.
3. A narrow `Within` elsewhere still reads as an ordinary highlight.

Record the verdict in the roadmap entry. **This gate can reject the treatment** — it is not a formality.

- [ ] **Step 12: Commit**

```bash
git add web/src web/tests
git commit -m "feat(web): a loop-wide Within renders as an extent, not a wash

M2 put two or more corpus programs over 60% once the region path carried tags,
so Within's usefulness now degrades with width. The threshold is M2's own 60%,
applied per frame rather than per corpus, so there is one number in the system.

Width modulates within only. Exact says this step IS this construct, true
whatever its size; coincident is rarer and more informative and keeps winning.

An edge instead of a wash rather than a fainter wash: at this width a tinted
block is most of the pane. Program byte length is recorded per compile, never
per frame — spans are bytes and doc.length is UTF-16, so it needs a real encode."
```

---

### Task 7: Roadmap closing entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Write the closing entry**

Following the shape of the `PLAN 5c CLOSES` entry, record:

- What shipped: five tagging sites, and that `Assign` and the region entry are deliberate exclusions with their reasons.
- The before/after M1 and M2 tables (already added in Task 5) and whether the pre-registered threshold was met.
- Whether Task 6 ran, and the eyeball gate's verdict if it did.
- **What this slice could not establish**, honestly: whether `Assign`'s untaggability costs anything observable; whether playback legibility improved or merely changed; that non-Chromium engines were not looked at.
- The `zipper_equivalence` coverage gap this slice found and closed, so the next reader knows the gate now reaches the region path.

- [ ] **Step 2: Run the full gate before marking the PR ready**

```bash
cargo test --workspace && cargo clippy --workspace --all-targets --all-features
cd web && pnpm run typecheck && pnpm exec biome check src tests && pnpm run test
cd .. && ./scripts/check-all.sh --browser-only
```

Expected: PASS throughout, clippy silent.

- [ ] **Step 3: Commit and mark PR #28 ready**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "roadmap: region-path tagging closes"
git push
```

Then mark PR #28 ready for review (it is currently a draft).

---

## Self-Review

**Spec coverage.** §0's gap → Tasks 2, 3. §1's five sites → Task 2 (four) and Task 3 (`While`). §1's region-entry exclusion → Task 2's duplication test. §1's `Assign` exclusion → Global Constraints, and Task 7 records what it could not establish. §2's M1 threshold and M2 gate → Task 5. §3's conditional rendering → Task 6, gated on Task 5 Step 3. §4's five test requirements → Task 1 (curated loop case), Task 4 (anti-vacuity), Task 2 (own-roots), Task 3 (`While` span, value position); §4's "propagation needs nothing new" is why no task adds `shift`/`subst`/`beta_go` tests. §5's exclusions → Global Constraints and Task 7.

**Placeholder scan.** One step defers to the implementer rather than guessing: Task 6 Step 9 matches the surrounding browser-test stepping idiom rather than inventing one, and states what to do if no frame in that program produces a wide `Within` (record it as a finding and reconsider whether Task 6 was warranted). `Core::for_each_child` was verified to exist at `core.rs:89` with the signature Task 3's helper assumes, so that deferral was removed rather than documented.

**Type consistency.** `app_owned(f, a, owner: NodeId)` is used identically in Tasks 2 and 3. `build_while`'s new signature in Task 3 Step 4 matches its call in Step 6. `isWideSpan(span: Span, programBytes: number): boolean` is defined in Task 6 Step 3 and used in Steps 1 and 7 with the same argument order. The claim union widens to the same four members in `highlight.ts` (Step 5), `FOCUS_CLASS` (Step 5), and `draw()` (Step 7), and `'within-wide'` maps to `is-focus-within-wide` in both the record and the CSS rule (Step 8).


---

## Plan defects found during execution

Kept rather than silently corrected: the record that the plan was wrong is worth more than a plan
that reads as though it never was. Five sketches or claims failed contact with the real code — the
previous slice recorded two of five, so the rate did not improve.

1. **T2's region-`If` fixture did not parse.** `if` is not a special-cased statement in this grammar
   the way `while` is, so the block's tail consumed it and `n` dangled. One semicolon fixed it; the
   literal above is now corrected in place because a reader copying it would otherwise get a parse
   error rather than the predicted failure.
2. **T2's `find_id` was prescribed RECURSIVE, through a walker documented as "must never call
   itself."** `Core::for_each_child` (`core.rs:84-89`) states a long statement spine is tens of
   thousands of nodes deep and that recursive traversal "aborts the process with an uncatchable stack
   overflow". An iterative equivalent already existed at `sourcemap_coverage.rs:73`. The plan invented
   a recursive duplicate of a correct helper and cited that walker's own doc as licence for it.
   **The code block in Task 2 still shows the recursive form; do not copy it — write the worklist.**
3. **T3's `find_while_id` duplicated the above**, and would have reintroduced the same violation one
   task after it was removed.
4. **T3's value-position `while` fixture was unreachable.** `while` desugars unconditionally under a
   `Seq` whose `first` is always `Pos::Store`, so no parsed program can place `Core::While` at
   `Pos::Value`. The branch is reachable only through hand-built `Core` — which the repo already
   documents for the sibling `Assign` branch at `lower.rs:1193-1198`, with a hand-built test beside
   it. The plan should have found that precedent instead of inventing a source-level fixture.
5. **T4's assertion could not catch T4's own prescribed mutation — the worst of the five.** The plan
   specified `assert!(loop_census.tagged() > 0)` AND named reverting `Seq`'s tag as the proof it
   bites. It does not: four other arms still tag, so `tagged()` stays 38 even with all five region
   sites reverted. The suggested fallback (`within > 0`) is worse — `within` does not move at all
   under that mutation. **The plan prescribed both an assertion and its acceptance test and never
   checked that the one detects the other.** The shipped form anchors on `NodeId` identity instead;
   counting was never the right instrument, because 19 of the 22 surviving `Exact` events come from
   the functional `BinOp` tag rather than the region path.

**The transferable rule**, consistent with the previous slice's record: *an assertion prescribed by a
plan is not evidence that the assertion works.* Every acceptance step in a future plan should name a
mutation AND state the expected failure, so that writing one forces checking the other.
