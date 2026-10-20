# Code history moved out of comments

Text moved verbatim out of code comments when they were trimmed to their why. Each entry names the file and the line of code the comment sat above.

## `crates/redextape-core/tests/asm_oracle.rs`, above `std::thread::Builder::new()`

On 8 MiB the guard fires at depth 580 (yielding TooDeep) with ~2x margin below the measured ~1175-deep native crash point, while the

(A 512 KiB thread would hold only ~90 lower_into frames and so overflow before the guard fires; the constant must be dictated by the real production stack.)

## `crates/redextape-core/tests/asm_roundtrip.rs`, above `#[test]`

Measured, not guessed: an earlier draft of this test predicted 13 of 16, naming `Box`, `BoxGet` and `BoxSet` as the gap. Running it found 12 of 16 instead — `Tail` was also unreached, because `DEMOS` exercised `head(cons(7, nil))` but no demo called `tail(...)`. Adding `tail(cons(7, nil))` brought the measured count to 13 of 16, leaving `Box`, `BoxGet` and `BoxSet` as the remaining gap.

## `crates/redextape-core/tests/common/mod.rs`, above `let word_len = enc.heap_word_len();`

and is why this stayed one loop.

THAT ASYMMETRY IS THE POINT, and it used to be a recorded gap here. This rung checked no length at all, which was the whole property for unary but covered strictly less of binary's heap structure than binary admits. What compensated was `Binary::parse_heap_cells` being width-strict — and making it STRUCTURAL removed that compensation, so the check moved here in the same change.

## `crates/redextape-core/tests/common/mod.rs`, above `pub fn unsafe_rules(m: &Machine, tape: usize) -> Vec<String> {`

Clause (b) was originally `matches!(rule.read[tape], Some(MARK) | Some(BLANK))`, hardcoding the UNARY alphabet: under `Binary` a digit-write rule that reads `Some(ZERO)` failed that clause and was reported as unsafe, a FALSE POSITIVE on correct code (`write_literal`/`copy_field` enumerate both `ZERO` and `MARK` explicitly — see `binary.rs`). The obvious repair — restrict clause (b) to `enc.field_symbols()` instead of a hardcoded pair — turns out to be ANOTHER hardcoded alphabet one level up, and it is caught by the very first binary machine run through it: `box_append_field_bin` legitimately reads `Some(BLANK)` when appending a fresh BOX field onto virgin tape (a BOX field's WIDTH is declared field content, but the growing TOP beyond the last field is not — `BLANK` is deliberately excluded from `Binary::field_symbols()` because a binary field is never blank-padded). Restricting to `field_symbols()` would reject that real, correct rule.

## `crates/redextape-core/tests/common/mod.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

these were originally duplicated across `tm_bank_invariant.rs`, `tm_exhaustive_bank_safety.rs` and `tm_static_delimiter_safety.rs`, with a test pinning the copies identical.

`one_way_oracle.rs` defined both; they moved here when `universal_oracle.rs` needed them too, so neither leg keeps a copy.

## `crates/redextape-core/tests/counter_oracle.rs`, above `#[test]`

**THIS RAN SLOWER THAN PLANNED.** A whole-branch review's probe of the same check ran in about 1.78 s wall in a debug build; this one ran

## `crates/redextape-core/tests/format_properties.rs`, above `#[test]`

**THIS REPLACES A SABOTAGE CHECK THAT COULD NOT SABOTAGE ANYTHING.** Its predecessor, `the_budget_holds_at_widths_other_than_the_default`, checked `"fn wide(a) { a } wide([1, 2, 3])"` at widths `[40, 60, 80, 200]` — small enough that it never overflowed at any of them, so `fill_rows` was never entered and neither `bracketed` check was ever pushed past its boundary. Reverting all THREE sites to `MAX_WIDTH` at once still passed it. The fix was not a wider net of widths; it was fixtures sized against the specific comparison each one exercises, confirmed by actually reverting each site in turn (task report, "Fix round 1" — the sabotage matrix) rather than by inspection.

## `crates/redextape-core/tests/format_properties.rs`, above `"let a = 1;\nlet xs = [{ // c\nlet b = 2; b }, 2];\nxs",`

`Expr::Block`'s span used to start at the first token INSIDE the braces, so the comment read as preceding the whole block and escaped it.

## `crates/redextape-core/tests/format_properties.rs`, above `"let a = 1;\nlet xs = [\n    1, // first\n    2,\n];\n0",`

`vertical_rows` hardcoded `first = false`, so a list broken for a comment measured its blank-line gap from the previous STATEMENT's end, across its own `[`.

which is the only reason this suite was green: every bracket-comment entry here used to open its file.

## `crates/redextape-core/tests/guard_counterexamples.rs`, above `#[test]`

used to always report a refusal (if any) on its FIRST attempt. `MAX_MACHINE_STATES` broke that:

## `crates/redextape-core/tests/guard_counterexamples.rs`, above `#[test]`

, which is why `code.len()` LOOKED bounded at 3,472 and why this went unnoticed

— the shape that made this a live defect rather than a latent one

## `crates/redextape-core/tests/guard_counterexamples.rs`, above `#[test]`

**A prior version of this test used a different, smaller member of that array (38,070 states) under the mistaken belief that it was the largest.** It was not:

## `crates/redextape-core/tests/guard_counterexamples.rs`, above `#[test]`

: `term.rs`'s `shift` was Θ(logical) and sharing-destroying, and fixing it removed the cost this guard was supposed to refuse.

**That account was one level too shallow, and the missing level is what closed the hang.** It does not say why `|arg|` was the LOGICAL size rather than the physical one. `shift` rebuilt every node it visited — Θ(logical), and sharing-destroying, since `shift(App(c, c))` recursed twice. Both `shift` and `subst` now return their argument's allocation when no free index is in range, so the `Abs` arm no longer builds that copy and the whole cost model collapses on these programs. This program lowers to `(\xs. (\ys. BODY) YS) XS`, whose leftmost-outermost redex is the root, so the first step re-shifts the whole of `XS` once per `Abs` in `(\ys. BODY) YS` — and `YS` supplies ~6 of those per element.

## `crates/redextape-core/tests/guard_counterexamples.rs`, above `// Test target: `clippy.toml`'s `allow-*-in-tests` keys do not reach free helpers in a `te`

Until this file existed those programs lived only in `examples/` probes and in the design records' prose, so the next person to propose a bound on **total size** or on **sharing** would have found out in review, if at all. Now the evidence runs in CI.

**Runtime, measured rather than hoped for: ~1.97 s for the file** in the unoptimized profile the gate uses (the two tests run in parallel under `cargo nextest`, ~1.94 s each), **~0.21 s optimized.** Building and lowering the programs is not what costs — that is ~0.1 ms and ~20 ms respectively for either one. The rest is three O(physical) folds over ~500,000 `Rc` allocations, hash-dominated and ~11x slower without optimization. That cost is itself part of the record: the shared-subterm design's §9 measures `max_shared_logical_size` at 92.6 ms optimized on exactly the first program below, against a `lower()` of 9.7 ms — so the folds asserted here ARE the ~90 ms that section is about, paid in a debug build.

## `crates/redextape-core/tests/lambda_foreign_reader.rs`, above `("let mut x = 1; x = x + 10; x = x * 2; x", FTy::Nat),`

their printed form was unparseable before this branch's first commit. They are the regression link to it.

## `crates/redextape-core/tests/lambda_foreign_reader.rs`, above `fn term_depth(t: &FTerm) -> u32 {`

(previously attributed to "a slightly different origin" for lack of a better explanation)

## `crates/redextape-core/tests/lambda_foreign_reader.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

since 2026-08-03 (β-fusion — see its doc block's note that this was three walks until that date).

**CORRECTED — the original version of this finding was wrong; see the note below.**

THE CORRECTION: an earlier version of this finding claimed `MAX_PARSE_DEPTH` had "no doc comment at all". That was false — the doc quoted above exists and directly answers the question this finding poses. A review caught it. Cause: this file's doc-only extraction from `syntax.rs` used `grep '^//!'` (module-doc lines only), which by construction cannot match a `///` item doc comment, so `MAX_PARSE_DEPTH`'s doc was never seen — and its absence from the extraction was then written up as the constant having no doc at all. Recorded here rather than silently dropped, because a findings list that quietly loses a false entry teaches the next reader nothing.

## `crates/redextape-core/tests/lambda_provenance.rs`, above `#[test]`

THE FIVE POINTERS ABOVE WERE LINE NUMBERS UNTIL THIS COMMIT, AND ALL FIVE HAD DRIFTED — under one lint-only PR (`clippy::pedantic`, #31) that DID open this file: its whole edit here was the crate-level `allow` attribute at the top, and it re-resolved none of the eleven citations it was sitting in. Being in the file was not enough — which is the argument for a gate, rather than for a convention asking authors to re-check what they pass. `desugar.rs` lines 141-153 were the whole `Stmt::While` arm down to the `Core::Seq` it builds, and this conversion found them opening on the `Stmt::Assign` arm's closing brace and stopping one line short of that `Core::Seq`. Its lines 93-99 were `acc`'s initializer through the `Core::Unit` branch — which #31 also rewrote from a `match` into an `if let` — and were found starting in the comment above it and ending before the `Core::Unit`. `lower.rs` line 566 was `lower_region`'s own `lower_region_body(.., Pos::Value, ..)` call, which #31 moved 35 lines down, leaving 566 a blank line above `cur_store`, a different function. `lower.rs` line 1204 was that test's `fn` line — `forget_discards_a_store_discarding_assigns_subtree_without_dangling_paths`, moved 44 lines — and 1204 was found inside the unrelated `nat_nodes` helper. `lower.rs` lines 1193-1198 were the section banner and the opening of its doc, moved the same 44 lines, and 1193-1198 was found holding `nat_nodes`'s doc — which also argues about deep spines and stack overflow, so it reads like the right block to anyone who checks it quickly.

## `crates/redextape-core/tests/lambda_provenance.rs`, above `fn find_id(core: &redextape_core::core::Core, pred: &impl Fn(&redextape_core::core::Core) `

THAT POINTER READ `core.rs` lines 85-89 UNTIL THIS COMMIT, AND IT HAD DRIFTED. It ran from the doc's second line to `for_each_child`'s own signature when region-path tagging (#28) wrote it; `clippy::pedantic` (#31) moved the item down two lines, so this conversion found the range opening on the blank line above the doc and stopping a line short of its end. Both quoted sentences were still inside it, so nothing about it looked wrong.

## `crates/redextape-core/tests/lambda_provenance.rs`, above `#[test]`

BOTH POINTERS ABOVE READ `lower.rs` line 637 UNTIL THIS COMMIT, AND IT HAD DRIFTED ONTO THE OPPOSITE ARM. It was that `Core::Let { mutable: false }` arm's own `Ok(app_owned(..))` when region-path tagging (#28) wrote it; `clippy::pedantic` (#31) then pushed `lower_region_body`'s arms down 44 lines, carrying the `app_owned(..)` it named down with the rest of its arm. This conversion found 637 holding the `origins.at_root(*id)` of the `Core::Let { mutable: true }` arm — the arm this Finding exists to tell this one apart from. It still landed on a `Let` arm of the right function, which is what made it read as confirmation.

## `crates/redextape-core/tests/lambda_provenance.rs`, above `#[test]`

— measured: 115 `Exact`, 522 `Within`, 228 `None` across the six curated programs

## `crates/redextape-core/tests/lambda_provenance.rs`, above `assert_eq!(resolve(let_id), "let x = 40;", "the Let's tag must resolve to the let binding'`

THAT POINTER READ `desugar.rs` lines 119-123 UNTIL THIS COMMIT, AND IT HAD DRIFTED. It was the whole `Stmt::Let` arm — its pattern down to the `Core::Let` the arm builds — when 5c wrote it; `clippy::pedantic` (#31) pushed the arm down a line, so this conversion found the range opening on the enclosing `acc = match stmt` and stopping at the `spans.push`. The push it names was still inside it, which is exactly why the range read as confirmation.

## `crates/redextape-core/tests/lambda_provenance.rs`, above `let t = app_owned(abs("f", app_owned(var(0), var(0), 3)), abs("y", app_owned(var(0), var(0`

THE JUSTIFICATION THIS COMMENT USED TO GIVE IS DEAD, AND IT IS NOT WHY THE FIXTURE STAYS THIS SHAPE. It read that `reduce_step`'s non-root path rebuilds spine `App`s through plain `app(..)`, so a redex below the root would emit unrelated `None`s. Task 4 changed exactly that: the descent now rebuilds through `app_tagged_for_rebuild` (called at `reduce.rs`'s `reduce_step_go`, once on the function side and once on the argument side of its `Node::App` arm), preserving each spine node's own owner, so a deeper fixture would no longer manufacture spurious `None`s. What survives is the narrower point above — root-only keeps the descent out of the picture, so a failure here can only be `beta_go`'s.

THAT POINTER READ `reduce.rs` lines 268 and 271 UNTIL THIS COMMIT, AND BOTH HAD DRIFTED. They were exactly the two `app_tagged_for_rebuild` calls when 5c wrote them; `clippy::pedantic` (#31) moved each call down two lines, into the pair the paragraph above names — the function side and the argument side of `reduce_step_go`'s `Node::App` arm. This conversion found the old pair landing on the two `reduce_step_go` recursion branches two lines above each call — close enough to read as confirmation.

## `crates/redextape-core/tests/lambda_sharing.rs`, above `assert_eq!(nodes, 1_379_187, "total nodes across the trace");`

**THE NODE TOTAL IS UNCHANGED AND THE ALLOCATION COUNT FELL AGAIN** — the same representation-not-semantics evidence as the `sum(5)` gate above, on the same two dates:

```text
  185,459 (2026-07-31) -> 4,364 (2026-08-01), a 42.5x fall: the `maxfree` short-circuit. This is
                          the row where the reducer was destroying the most sharing.
  4,364   (2026-08-01) -> 4,305 (2026-08-03), a further 1.4% fall: β-fusion, by the DAG-flattening
                          mechanism set out at length in the `sum(5)` block above.
```

320.37x is now within striking distance of the probe's 371.7x hash-consing figure for this row, where before the short-circuit it was 7.44x against that same 371.7x.

Fusion moves this row LESS than `sum(5)` (1.4% against 5.4%), which is consistent with the mechanism rather than incidental to it — but **the reason is the depth-0 case, not the same-depth multi-occurrence case**, and an earlier draft of this sentence had it the other way round. The four-mode switch reported in the `sum(5)` block splits this row 56 / 3: 95% of the fall is β-steps whose result inherits the CALLER's own open `arg` allocation, which needs only a single occurrence, and 3 allocations are multi-occurrence sharing at depth >= 1. So what a loop-desugared program makes fewer of, relative to a recursive one, is **β-steps on an open argument at all** — not steps with repeated occurrences of one. A change that moved the two rows in proportion would have been a different mechanism from the one diagnosed.

THE HYPOTHESIS THIS COMMENT USED TO CARRY IS NOW SUPPORTED, having been recorded as a guess. It read: "the loop body may be physically shared step to step just as the recursive spine is, but being a bigger term, more of it would survive untouched per step." That is what a 42.5x drop against `sum(5)`'s 7.42x says — the bigger term had more to preserve, and preserving it is exactly what the short-circuit added. Still not PROVEN by this test, which counts allocations rather than attributing them; it is a guess the numbers now favour instead of one they were silent on.

## `crates/redextape-core/tests/lambda_sharing.rs`, above `assert_eq!(nodes, 502_146, "total nodes across the trace");`

```text
  140,529 (2026-07-31)  -> 18,939 (2026-08-01), a 7.42x fall: the `maxfree` short-circuit.
                           `shift` and `subst` began returning their argument's allocation when
                           no free index is in range, instead of rebuilding a structurally
                           identical copy, so a β-step preserves sharing rather than
                           materialising the logical expansion.
  18,939  (2026-08-01)  -> 17,920 (2026-08-03), a further 5.4% fall: β-FUSION.
```

The 7.42x figure is left attributed to the change that produced it rather than restated against the new total, because nothing re-derived it — same discipline as the "NOT RE-DERIVED" note below.

**WHY FUSION MOVED THIS NUMBER AT ALL, which was not predicted and is worth stating precisely.** `beta` was `shift(-1, 0, subst(0, shift(1, 0, arg), body))`, and that closing `shift(-1, 0, ·)` walked `subst`'s RESULT AS A TREE. `shift` does not memoise, so where `subst` had inserted ONE shared allocation of the argument at N occurrences — its hit arm is `s.clone()`, a refcount bump — the closing shift descended into each occurrence separately and rebuilt N independent copies. It was flattening the DAG `subst` had just built. The fused walk never makes that pass: it inserts the argument by handle and never revisits it, so the N occurrences stay one allocation, and at depth 0 the result inherits the CALLER's own `arg` rather than a copy of a copy.

The effect is bounded, which is why this is 5.4% and not a collapse. It is nil for a closed argument (`shift(1, 0, arg)` is a refcount bump and the closing shift's own prune returns the handle — and 88.4% of corpus β-steps have one), and nil for occurrences at DIFFERENT depths (each depth needs its own lift either way).

**WHICH OF THE TWO SUB-MECHANISMS DOMINATES WAS MEASURED, AND IT IS NOT THE OBVIOUS ONE.** An earlier draft of this block said the effect "is confined to multiple occurrences at the SAME depth". That is the smaller half by an order of magnitude. Switching `beta` between four modes and re-running this gate isolates them:

```text
  three-pass                                          18,939   (4,364 on the loop gate)
  fused spine, three-pass argument at occurrence sites 18,939   (4,364)  <- spine contributes 0
  + share ONE FRESH copy across depth-0 occurrences    18,939   (4,364)  <- sharing alone: 0
  + inherit the caller's `arg` at depth 0 instead      18,104   (4,308)
  shipped fused                                        17,920   (4,305)
```

So **835 of the 1,019 (82%) — and 56 of the 59 (95%) on the loop gate — is the depth-0 case, where the result inherits the CALLER's own `arg` allocation. That needs only a SINGLE occurrence.** Multi-occurrence sharing at the same depth is worth 184 here and 3 there, all of it at depth >= 1. The spine contributes nothing: a fused walk that differs from three-pass only at occurrence sites reproduces both pre-fusion pins exactly, which is also what says there is no unexplained residue in this drop.

**THE THIRD ROW IS THE ONE THAT ISOLATES THE CLAIM, AND AN EARLIER DRAFT OF THIS TABLE OMITTED IT.** Without it the 835 is splittable between inheriting and depth-0 multi-occurrence sharing, and the sentence above would be asserted rather than shown. Sharing N occurrences onto one FRESH copy — the obvious reading of "fusion shares more" — is worth exactly nothing on both gates. What pays is not making the copy at all.

that test carries a depth >= 1 fixture precisely because a depth-0-only test passes while the depth >= 1 half regresses, which is how this attribution came to be checked at all.

Every oracle in this tree passed unedited across both changes.

The gap is now 28.02x against 36.9x rather than 3.57x against 36.9x, which says most of what hash-consing was finding was sharing the reducer had destroyed rather than sharing `Rc` cannot express. Fusion closed a further slice of that same gap, and for the same reason.

NOT RE-DERIVED: the old arithmetic cross-check (this gate's ratio x the probe's within-term 10.37x ≈ the probe's across-trace figure) was calibrated on the pre-fix numbers, and the within-term ratio moved too. It is dropped rather than restated with new numbers, because nothing here re-measured it. Run the probe if you want it back.

## `crates/redextape-core/tests/lambda_sharing.rs`, above `const SUBJECT_LOOP: &str = "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n`

**THE CONCLUSION THIS PARAGRAPH USED TO DRAW IS NOW FALSE, and the reversal is the point.** It read ~~"on that axis the two programs are `sum(5)`'s 3.57x against this program's 7.44x — about a 2x spread, not the probe's ~10x"~~, and treated that gap as the gate correcting an inflated figure.

What changed is not the measurement but the reducer: `shift` used to rebuild every node it visited, so a β-step's output aliased nothing and most of what `Rc` COULD have shared was destroyed before this gate ever counted it. The hash-consing figure was the better estimate of the available sharing all along; the allocation count was low because the reducer was throwing sharing away, not because `Rc` cannot express it.

## `crates/redextape-core/tests/no_weak_handles.rs`, above `#[test]`

, because that exact alias route once walked past every other needle and defeated an earlier version of this gate, so pinning it here exercises the `downgrade` needle from this tree rather than only from a report.

`downgrade` shipped for one commit with no probe that could fail for it alone, and every needle added since

## `crates/redextape-core/tests/no_weak_handles.rs`, above `const NEEDLES: [&str; 5] = ["Rc::downgrade", "Weak<", "rc::Weak", "downgrade", "new_cyclic`

Adding `downgrade` cost nothing when it was added: `grep -rn 'Weak\|downgrade' crates/*/src/` matched no line workspace-wide.

It too cost nothing when it was added: `grep -rn 'new_cyclic' crates/` matched no line outside this file's own doc.

, and that exact alias construction is what defeated this gate once already

, and conflating the two is what let the aliased call above pass this gate

## `crates/redextape-core/tests/sharing_aware_decode.rs`, above `#[test]`

— which is narrower than this test was once named to suggest, when it claimed the cycle ran INTO the memoized pointer and raced the memo-hit check against the step bound

## `crates/redextape-core/tests/sharing_aware_decode.rs`, above `#[test]`

— measured at `m + 2` for m = 10, 100, 1,000, 5,000 and 20,000

do not — confirmed by running this test directly (bypassing `#[ignore]`) under `cargo test` (no `--release`), which aborts with "thread ... has overflowed its stack" at the default 32 MiB, and passes once `RUST_MIN_STACK` is raised to 64 MiB.

— the `2m` framing this comment used to carry contradicted that constraint

## `crates/redextape-core/tests/single_tape_oracle.rs`, above `#[test]`

(the corpus used to be `"1 + 2"` and `"[1, 2]"`, neither a member)

## `crates/redextape-core/tests/sourcemap_coverage.rs`, above `#[test]`

The OLD behaviour attributed every cell to the whole literal, so a three-element list produced three IDENTICAL spans — and every test committed at the time passed, because none of them checked for distinctness, only for "in bounds" (`every_core_node_resolves_to_an_in_bounds_source_span`) or for a single hand-picked cell (`synthesized_leaves_inherit_the_span_of_what_caused_them`, before this commit).

## `crates/redextape-core/tests/sourcemap_coverage.rs`, above `fn classify(core: &Core) -> (Vec<NodeId>, Vec<NodeId>) {`

(This is the invariant `tm_half` used to lean on for its fallback — true here, and false on the defunc path, where the root of the tree that gets lowered is `defunc`'s, not this one.)

THE `lower_asm.rs` POINTER IN THE `Var` BULLET READ line 321 UNTIL THIS COMMIT, AND IT WAS ALREADY WRONG THE DAY IT LANDED. `if src != dst` was exactly line 321 at the parent of `9fbd911` — but `9fbd911`, the commit that added this file, also replaced the `unwrap`s in `Ctx::bind` and `Ctx::bind_fn` with `if let` for the no-panic rule, adding seven lines above the guard. The citation shipped seven lines short of the thing it named, inside the commit that wrote it. `clippy::pedantic` (#31) then moved it 35 further, so the guard now sits where the `Var` bullet above names it, in `lower_inner`'s `Core::Var` arm; this conversion found 321 holding a `"$box"` arm of `lower_builtin_apply`, a different function. A coordinate can be stale before it is even pushed; a symbol cannot.

## `crates/redextape-core/tests/span_wellformed.rs`, above `#[test]`

Nothing checked the two came from the same lowering, so a renderer offering an encoding switch — build the map once, re-lower the machine — silently attributed most state-naming spans to the wrong Core node.

## `crates/redextape-core/tests/span_wellformed.rs`, above `let mut cursor = 0usize;`

— which is exactly what λ (56 bytes) and asm (16) did, while the TM printer covered its own

## `crates/redextape-core/tests/span_wellformed.rs`, above `const CORPUS: &[&str] = &[`

COMMENTS ARE IN THE CORPUS AS OF THE TRIVIA SLICE, AND THAT IS THE POINT. `lexer.rs` used to discard `//` comments, so `classify_source` emitted nothing over their bytes — a real, non-whitespace hole in the coverage assertion in `check`, which this corpus avoided on purpose and `source_with_a_comment_is_the_one_gap_this_corpus_avoids` stated outright. `lex` now returns them and `classify_source` classifies them, so the last entry below exercises the property that was previously excluded from it.

which is how it was measured.

## `crates/redextape-core/tests/subst_differential.rs`, above `#[test]`

, and it was written after a review pointed out that the strongest evidence for the fusion existed only as a throwaway experiment. The predecessor slice on this branch shipped a headline quantity — `climbs` — with no test behind it at all, and its own final review is what found that out

## `crates/redextape-core/tests/subst_differential.rs`, above `#[test]`

**THE GATE FOR β-FUSION, AND IT LANDED BEFORE THE OPTIMIZATION DID.** Today it compares the shipped `beta` against a spelled-out copy of itself and passes trivially. That is deliberate: a test written after the change is a test written to the change, and the zipper slice's equivalence gate landed one task early for the same reason.

## `crates/redextape-core/tests/subst_differential.rs`, above `#[test]`

AND NOTE WHAT THIS SHARING USED TO NOT REACH, until β-fusion (2026-08-03): a trace snapshot. `beta` used to close the hole with a separate `shift(-1, 0, ·)` pass over the term `subst` had just built. That pass walked `subst`'s result as a TREE — `shift` does not memoise — so it revisited every occurrence of a shared argument separately and rebuilt each one as its own allocation, discarding exactly what `subst`'s `s.clone()` above had just shared. `beta_go` now performs the substitution and the decrement in ONE walk and never makes that second pass, so what this test pins now survives

## `crates/redextape-core/tests/subst_differential.rs`, above `// Test target: `clippy.toml`'s `allow-*-in-tests` keys reach a `#[test]` function's own b`

**THE SUBJECT OF THIS FILE INVERTED ON 2026-08-02, AND THAT IS THE POINT OF THE REWRITE.** It used to validate a PROPOSED rewrite — carrying `subst`'s per-binder re-shift down as one `shift(d, 0, ·)` — against the shipped function, on the way to shipping it. The rewrite was falsified on cost (see below), so the proposal is gone and the code that expressed it is kept and **re-pointed**: the two implementations here are now REFERENCES, and the shipped `subst` is the thing under test.

That is not a salvage. It is what the file should always have been.

**WHY THE REWRITE IS DEAD, in the two numbers that killed it.** It was sized against `Σ abs×arg` = 70,542,349 corpus-wide, a STATIC model (`count_abs(body) × size_of(arg)`) written against a `subst` whose `Abs` arm copied unconditionally. Measured against what `subst` now allocates, the same re-shift is **44,539** — a **1,584x** over-count — and `subst` in total costs 68,188. That is partly because **88.4% of β-steps have a closed argument** and `shift(1, 0, arg)` is a refcount bump for those. On the nested-group family the rewrite measures **0.99x: a regression**, because `subst` descends only through the binders on the path to an occurrence, so binders-crossed is smaller than occurrences and paying per occurrence costs more than paying per binder. Instrument: `examples/shift_cost_probe.rs`'s census section; full statement in the perf design's §10.

, ADDED BY THE 2026-08-02 DESIGN (this paragraph landed 2026-08-03)

~~A tense that holds whichever side of that change this file is read from.~~ **Corrected 2026-08-03:** it did not hold — the change landed, so the present tense became a false statement about shipped code, in the one paragraph of this file claiming to be immune to exactly that.

## `crates/redextape-core/tests/three_way_oracle.rs`, above `fn tm_val_with(src: &str, enc: &dyn Encoding) -> Option<Value> {`

once required, because `Binary`'s decode was width-strict and a tape fitted at 16 cells decoded to `None` under `Binary::default()` (see this file's module doc). Both decoders are structural now, so this is no longer load-bearing — but both

## `crates/redextape-core/tests/three_way_oracle.rs`, above `#[test]`

within this very branch, in `step_survey.rs` again after the FIRST fix),

COPIES WERE ADDED TO THIS TEST AFTER THE FACT, TWICE, AND THE SECOND TIME PROVES THE FIRST FIX'S OWN COUNT WRONG. `list_reduction_probe.rs` was committed with a copy and a comment claiming this test kept it in sync; it did not, because the test covered three, so the test went to four. It should have gone to five: `examples/lambda_sharing_probe.rs` carried a copy too, with its own module doc citing the same drift history, and nothing read it. **The fix's own count of the damage was short** — which is the roadmap's standing lesson about this class stated by a fresh instance of it, and the reason this doc names the enumeration method rather than the number: the check is `grep -rn FIRST_ORDER_DEMOS` over the whole tree, not a list anyone maintains by memory. All five were byte-identical when the fifth was added, so this closed an uncovered copy rather than live drift; that is the window this test exists to shut, and it stayed open through one deliberate attempt to shut it.

**THE SIXTH (2026-08-01, `examples/concurrency_probe.rs`) IS THE FIRST ADDED *WITH* ITS COPY RATHER THAN AFTER IT**, which is what the paragraph above asks for and had not yet been tested. Two things changed to make that the cheap path rather than the diligent one. The per-copy `read_to_string` + `extract_str_array` + `assert_eq!` triple became one row in a `copies` table, so adding a copy is a one-line edit instead of a three-place one — the shape that made the fifth easy to miss. And the count is now asserted (`copies.len() + 1 == 6`), because a table makes a *deletion* silent in a way three hand-written asserts did not: dropping a row would leave this test green while that file drifted. The assert is deliberately a literal, so bumping it is a conscious act that re-runs the `grep`.

**THE SEVENTH (`examples/state_cost_probe.rs`, this same branch) REVERTED TO *AFTER THE FACT* —** the pattern the sixth entry above was supposed to have broken. Its copy shipped as a `part_g` local binding named `demos`, not `FIRST_ORDER_DEMOS`, so even the `grep -rn FIRST_ORDER_DEMOS` audit this doc names would not have found it, and nothing added a row here either. Renamed to the module-level `const FIRST_ORDER_DEMOS: &[&str]` every other copy uses, and added to `copies` — closing the same window a third time, inside the branch that is supposed to be fixing this class of defect, not adding to it.

## `crates/redextape-core/tests/three_way_oracle.rs`, above `"fn nil(x) { x + 5 } fn ap(g, x) { g(x) } ap(nil, 0)",`

check used to short-circuit BEFORE its `tags` check — so a user `fn nil`, itself USED AS A VALUE, compiled to the empty list instead of `cons(tag, $nil)`, and the dispatcher's `$head($clos)` tag test then faulted on it.

## `crates/redextape-core/tests/three_way_oracle.rs`, above `"let n = 7; fn tail(x) { x + 1 } fn ap(g, y) { g(y) } tail(3) + ap(tail, 2) + ap(|y| y + n`

(found when this class was surveyed for Task 2)

## `crates/redextape-core/tests/three_way_oracle.rs`, above `"fn head(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } head(1) + ap(add1, 2)",`

(measured at 3246742: reference 5, λ 5, TM 3)

## `crates/redextape-core/tests/three_way_oracle.rs`, above `"fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \`

λ 411 steps, TM 145,819.

## `crates/redextape-core/tests/three_way_oracle.rs`, above `"fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)",`

λ 25 steps, TM 16,143.

## `crates/redextape-core/tests/three_way_oracle.rs`, above `"fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \`

measured, not assumed;

λ 502 steps, TM 120,899.

## `crates/redextape-core/tests/three_way_oracle.rs`, above `"fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \`

a program class that previously reached NO backend — `typeck` rejected the forward reference, and `lower_asm` bound a name only before its own body.

Measured cost (well inside both caps): λ 367 of 5,000,000 steps, TM 99,699 of 5,000,000.

## `crates/redextape-core/tests/three_way_oracle.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

(Historical, stated in the past tense deliberately. Decode WAS once width-strict: `Binary::decode_nat` and `parse_heap_cells` required a field to close exactly `self.width` cells later, where `Unary`'s content-driven decode scanned to the next `#` and so worked at any width; a fitted-at-16 binary tape read with a 64-wide `Binary` returned `None` for every demo, measured directly rather than assumed. That stopped being true when both decoders became structural. This note is subordinate to the statement above, and phrased so it cannot be quoted as current fact, BECAUSE IT REPEATEDLY WAS: the obsolete half of the older wording — which led with "that was once REQUIRED" and put the retraction in a separate paragraph — was copied into other files as a live correctness constraint seven times across two branches before anyone checked it against `binary.rs`. Any sentence anywhere in this tree claiming that binary decode needs the fitted width describes a version of this code that no longer exists.)

## `crates/redextape-core/tests/tm_bank_invariant.rs`, above `#[test]`

, extracted unchanged from the single test this file used to have

## `crates/redextape-core/tests/tm_bank_invariant.rs`, above `fn check_reg_bank_unit(src: &str, width: usize, name: &str, enc: &dyn Encoding) {`

Extracted verbatim from the single test this file used to have, so the split

## `crates/redextape-core/tests/tm_binary_gadgets.rs`, above `#[test]`

, and saying otherwise would be the same overclaim this suite has now found twelve times

## `crates/redextape-core/tests/tm_binary_gadgets.rs`, above `#[test]`

This test originally used 6 and 9, on the stated grounds that 6 was non-palindromic. It is not — both were palindromes, so the test named for the pop's correctness PASSED under a real reversal sabotage, which only `dispatch_tag_routes_on_the_tag_value` caught, incidentally. Measured, not argued: the sabotage was applied and this test stayed green.

## `crates/redextape-core/tests/tm_binary_gadgets.rs`, above `fn run_gadget(`

— it no longer reads as success

## `crates/redextape-core/tests/tm_comments.rs`, above `#[test]`

The shape parsed with ZERO diagnostics before this fix.

## `crates/redextape-core/tests/tm_encoding.rs`, above `assert_eq!(`

: checked by making the mock report bounded, which fires THIS assertion with 5 calls (widths 4, 8, 16, 32, 64) rather than the width one

## `crates/redextape-core/tests/tm_exhaustive_bank_safety.rs`, above `#[test]`

The figure here previously read "roughly two minutes" and called itself "measured, not estimated". Half of that was true. The 892-pair length-1 sweep at 0.46s release (~0.52 ms/pair) was measured; ~200k pairs at that rate EXTRAPOLATES to ~104s. The extrapolation assumed per-pair cost is flat across program lengths, and it is not — a length-2 program executes more TM steps than a length-1 one — so the real sweep is ~2.9x the projection. A rate measured at one length is not a measurement of another, and labelling the product "measured" hid that it was a derivation.

The number was wrong; the conclusion was not. Both are recorded because whoever revisits this trade needs the real cost, not the one that made it look cheap.

## `crates/redextape-core/tests/tm_exhaustive_bank_safety.rs`, above `fn widths_for(kind: EncodingKind) -> &'static [usize] {`

That manual step used to be enforced by a runtime test (`every_encoding_has_a_sweep_target`, since deleted — see this test file's history) that could only ever fail *after*

## `crates/redextape-core/tests/tm_foreign_reader.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

WHAT THE SPEC DID NOT COVER WHEN THIS WAS WRITTEN — the primary deliverable of this file. **All three were closed by commit 51ab55a, immediately after; they are kept here because the record of what a documentation test FOUND is the reason to keep running one.**

1. `unary.rs`'s module doc documented ONLY the scalar register-field encoding. It said nothing about how a compound value (this fixture's result is `List<Nat>`) is represented once it no longer fits one field — no heap tape, no cons-cell tag, no pointer convention. *Closed:* `unary.rs`'s module doc now covers the compound case (HEAP by index, 1-based pointers, `nil = 0`, `@ <head> # <tail>`, and that head/tail words are variable-length mark runs rather than fixed-width fields).

2. Neither `unary.rs` nor `machine.rs` named the literal character for `MARK`, though `machine.rs` pins `BLANK` as `'_'`. *Closed:* `build.rs`'s symbol doc now names `MARK` as `1`, beside `BLANK` and `SEP`.

3. `TmHeader::result`'s doc said "The type the final tape decodes to" — wrong for this very fixture, where `tapes 5` makes tape 4 the final one and the simulator below shows it never leaves its single blank cell. The result is REG (tape 0) field 0 read as a pointer, chased through tape 3. *Closed:* that doc now says so explicitly and no longer says "final tape".

## `crates/redextape-core/tests/tm_header.rs`, above `#[test]`

`tm_emit emit '50 + 50'` did exactly that: wrote a file, exit 0, no diagnostic, which `tm_emit run` then read back as **64**.

## `crates/redextape-core/tests/tm_header.rs`, above `assert_eq!(doc.machine.as_ref(), Some(&d.machine), "{src} under {kind:?}: machine must rou`

a review read this comment as describing `sum(5)` (which is `result Nat`) and reported it as a false claim. The claim was true of a different corpus entry; an unnamed "combination" invites exactly that misreading.

## `crates/redextape-core/tests/tm_heap_stack_shape.rs`, above `#[test]`

Length used to be checked twice over — the parser required each word to close exactly at `width`, and the four-way oracle ran every corpus heap through the parser. Making the parser STRUCTURAL deleted that check, so a binary

## `crates/redextape-core/tests/tm_heap_stack_shape.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

Both properties were sabotage-verified, and the heap one earned its keep in the process. Making `cons` write a MARK where the head/tail `#` belongs turned the corpus test red on a WRONG VALUE — which the existing oracle would also have caught — but turned the generated-program property red on

## `crates/redextape-core/tests/tm_oracle.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

That was once REQUIRED: `Binary`'s decode used to be width-strict, and decoding a fitted-at-16 tape with a 64-cell `Binary` returned `None` for every demo here, not just the headline `100 * 100` case. Both decoders are structural now

## `crates/redextape-core/tests/tm_static_delimiter_safety.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

, because the earlier framing of this rung was wrong twice and the corrections belong next to the claim:

three rules that used to write with a WILDCARD read (`on(REG, None, Some(MARK), R)`) now read explicitly. That change is step-for-step identical — same rule fires on the same configuration — which is why every step-count golden is unchanged.

## `crates/redextape-core/tests/tm_width_equivalence.rs`, above `#[test]`

NOTE: this file used to define its OWN private `box_tape_is_well_formed(cells, width)` here, hardcoding `MARK`/`BLANK` — a second copy of `tests/common/mod.rs::box_tape_is_well_formed`, which takes `enc: &dyn Encoding` and was already generalized for `Binary`. Two copies of the same skeleton check is exactly the situation `common/mod.rs` exists to avoid (see its own module doc), so this file now imports the shared one (`use common::box_tape_is_well_formed;`, above) instead of reimplementing it a second time under `Binary`'s alphabet.

## `crates/redextape-core/tests/tm_width_equivalence.rs`, above `#[test]`

Found by the proptest above rather than anticipated, and worth

## `crates/redextape-core/tests/tm_width_equivalence.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

, each of which was previously either argued or covered only by a handful of hand-picked programs:

`box_overwrite_field` was restructured from content-driven to a counted chain in this slice, so it is the gadget with the most recent structural change and the least coverage.

## `crates/redextape-core/tests/ts_bindings.rs`, above `#[test]`

NOR IS TEXT-MATCHING ONE SPELLING OF THE ATTRIBUTE ENOUGH — FOUR REVIEW ROUNDS EACH COMPILED A COUNTEREXAMPLE PAST THE PREVIOUS WORDING, EACH TIME BY FINDING ONE MORE SPELLING A BLACKLIST HAD NOT NAMED YET.

aliased crate name — the fourth round, found by the whole-branch review with `web/bindings/Rule.ts` really written while both tests here stayed green. A fifth round found the scan itself scoped to `src/` only, missing a derive routed through a file elsewhere in the crate — see

## `crates/redextape-core/tests/two_symbol_oracle.rs`, above `const CORPUS: &[&str] = &[`

**IT WAS ADDED FOR A REASON THAT TURNED OUT TO BE FALSE**: that it would leave the STACK tape non-blank. `return` pops the frame before the machine halts, so that tape ends blank here exactly as it does in the other three, and the per-tape measurement below is what falsified it.

## `crates/redextape-core/tests/universal_oracle.rs`, above `#![proptest_config(ProptestConfig { max_shrink_time: 10_000, ..ProptestConfig::default() }`

proptest's own bound is 1,024 runs, four times the 256 cases.

## `crates/redextape-core/tests/universal_oracle.rs`, above `const UTM_CAPS: Caps = Caps { steps: 10_000_000_000, cells: DEFAULT_CAPS.cells };`

the cells cap stays the default's, far above the 204,401 cells the largest row uses. The fast tier keeps `DEFAULT_CAPS`, whose 5,000,000 steps are twice the 2,432,575 its largest compiled row takes

## `crates/redextape-core/tests/viewmodel_contract.rs`, above `#[test]`

Measured via the same scratch-probe
discipline as the test above, over TWO real β-steps of this exact fixture, before being hard-coded.

## `crates/redextape-core/tests/viewmodel_contract.rs`, above `#[test]`

the exact regression
`viewmodel.rs`'s former `NO redex FIELD, DELIBERATELY` header warns against reintroducing one field
over

measured via a scratch probe against this exact fixture (`?3`, span `0..2`) before
being hard-coded here, rather than assumed.

## `crates/redextape-core/tests/viewmodel_contract.rs`, above `#[test]`

A prior version of this test asserted only span containment (ids ignored) and
still passed against that fixture with a wrong-but-real hardcoded `Owner::Within` (verified by
injecting `Owner::Within(4)` in place of the computed id in `reduce_step_go` and rerunning: still
green), because id 4 was independently a valid `Exact` answer elsewhere in the same trace.

Proven below, not just argued by
fixture selection: rebuilding the same hardcoded-`Within` regression against THIS fixture makes the
strengthened assertion below fail (the id-blind one above it still passes, by the same self-match
loophole).

## `crates/redextape-core/tests/viewmodel_contract.rs`, above `#[test]`

Before this, the only public accessor was `Tape::snapshot`, whose O(tape) clone is exactly what
`TmState::window` was changed to stop paying

## `crates/redextape-core/tests/viewmodel_contract.rs`, above `assert!(`

the pre-fix `snapshot`-based path allocated ~800,000 bytes here (200,000 cells * 4,
since `Symbol = char`) against the fix's ~12 -- with roughly 66,000x of margin to spare.

## `crates/redextape-core/tests/viewmodel_contract.rs`, above `#[test]`

`LambdaState` no longer has a `source_node` field, so this is not a test of that field — it is a
test of the underlying fact that made it unshippable:

`owning_node` (deleted) never surfaced this because it compared `redex`
against recorded paths as plain `Vec<Dir>` prefixes, never checking whether `redex` was walkable in
any real term at all — so this test checks that directly instead, against the initial term itself.

Checked by instrumenting a scratch build of this cursor against this exact fixture:

## `crates/redextape-core/tests/zipper_equivalence.rs`, above `#[test]`

Measured in release: `0u64..8` runs this
proptest in 0.22 s; `0u64..64` takes >110 s; `0u64..1000` takes >5 min.

THE `three_way_oracle.rs` POINTER READ line 535 UNTIL THIS COMMIT, AND IT HAD DRIFTED. It was
`arb_tm_safe_expr`'s own `arb_expr_over((0u64..8)..)` — the bound this range is said to mirror —
when the zipper slice (#5) wrote it; the node-count bound (#32) moved that function down eight
lines, so that bound was then `arb_tm_safe_expr`'s own one-line body, and this conversion found
535 holding a line of that function's DOC, about the operators the generator omits. Still inside
the same item, which is why it read as confirmation. The `llvm_oracle.rs` pointer beside it had
NOT drifted: line 153 still held `arb_first_order_expr`'s `(0u64..1000)`, unmoved since #5 wrote
the two pointers together.

## `crates/redextape-core/tests/zipper_equivalence.rs`, above `let while_ids = ids_where(&loop_core, &|c: &Core| matches!(c, Core::While(..)));`

measured at HEAD, `within_ids` is exactly `{while_id}` plus the fixture's three `BinOp` ids;
`Let { mutable: true }`'s and `Seq`'s own ids never appear there AT ALL, at HEAD or under any of
the three reverts below

(checked
directly) `within_ids` stays exactly `{while_id, ...the three BinOp ids}` under the other two
reverts (`Seq`, `Let { mutable: true }`), so `While`'s `Within` presence is not an artifact of
whichever revert happened to be active when it was measured.

THAT POINTER READ `lower.rs` line 766 UNTIL THIS COMMIT, AND IT HAD DRIFTED — the same 44 lines,
under the same commit, as the pair in `OwnerCensus`'s doc, and resolved here separately because
this sentence makes a different claim about the same tag. It was `build_while`'s own
`Ok(app_owned(app(fix(), g), s_init, id))` when region-path tagging (#28) wrote it; after
`clippy::pedantic` (#31) that call is the last line of `build_while`, and this conversion found
766 holding the closing brace of `in_position`'s `match`, five lines above `fn build_while`.

## `crates/redextape-core/tests/zipper_equivalence.rs`, above `for (what, pred) in [`

**WHAT THIS FIXTURE ACTUALLY CONTAINS, AND WHERE ITS SURVIVING `Exact` EVENTS ACTUALLY COME
FROM.** An earlier version of this assertion was `exact > 30`, justified by a comment claiming
`let mut`, `while`'s own root `App` (`build_while`) "and region `if` each tag independently of
`Seq`". Both halves of that claim were wrong. There is no `Core::If` anywhere in this fixture —
it has no `if` at all, only `Let { mutable: true }` (twice), the `Seq` joining the loop to its
continuation, and the `While` itself. And measured directly: reverting only `Seq`'s own tag
(`lower.rs`'s `lower_region_body`, in its `Core::Seq` arm) drops `exact` from 51 to 22 — but 19
of those 22 SURVIVING `Exact` events come from `lower_expr`'s `BinOp` arm (the functional path
this fixture's `acc + 1`, `n - 1` and `n > 0` also go through), not from any region construct at
all; only 3 of 22 are region-path `Exact` events. A floor between 22 and 51 mostly measures
whether `BinOp` is still tagged, which no revert here ever touches — and reverting
`Let { mutable: true }` or `build_while`'s own root tag individually left `exact` at 49 and 50,
both comfortably clear of a floor that also has to sit below 51.

THE `Seq` POINTER READ `lower.rs` line 652 UNTIL THIS COMMIT, AND IT HAD DRIFTED. It was that
`Core::Seq` arm's own `Ok(app_owned(abs(STORE, cont), first_store, *id))` when region-path
tagging (#28) took this measurement; `clippy::pedantic` (#31) pushed it down 44 lines, so that
call is now the last line of `lower_region_body`'s `Core::Seq` arm. This conversion found 652
landing on the `let cont = cont?;` of the `Core::Let { mutable: true }` arm — the same function,
three lines above THAT arm's tag, which is one of the two neighbouring reverts this very
paragraph contrasts the `Seq` one against.

## `crates/redextape-core/tests/zipper_equivalence.rs`, above `#[derive(Default, Debug)]`

When
`StepEvent::Beta` gained `owner`, this file's comparison started covering it without a line of new
test code

Measured 2026-08-10: the six curated programs emit 115 `Exact`, 522 `Within` and 228 `None`, and the
smallest program the generator can produce that steps at all — `(0 + 0)` — emits 1, 1 and 4. So the
gate does see the field; these assertions are what will say so if lowering ever stops tagging.

Measured 2026-08-10: reverting `Let { mutable: true }`'s own
tag (`lower.rs`'s `lower_region_body`, in its `Core::Let { mutable: true }` arm) or `build_while`'s
root tag (`lower.rs`) individually still left `exact` at 49 and 50 respectively, both comfortably
above such a floor.

BOTH POINTERS ABOVE WERE LINE NUMBERS UNTIL THIS COMMIT, AND BOTH HAD DRIFTED 44 LINES UNDER ONE
COMMIT. `lower.rs` line 611 was that arm's own `Ok(app_owned(abs(STORE, cont), new_store, *id))`,
and line 766 was `build_while`'s own `Ok(app_owned(app(fix(), g), s_init, id))`, when region-path
tagging (#28) took the measurement; `clippy::pedantic` (#31) pushed both down 44 lines, so the two
calls are now exactly where the parentheticals above name them — inside `lower_region_body`'s
`Core::Let { mutable: true }` arm, and at the end of `build_while`. This conversion found 611
holding the blank line above `lower_region_body`'s doc, and 766 the closing brace of `in_position`'s
`match`, five lines above `fn build_while`. THE MEASUREMENT ITSELF STANDS — it is a
dated observation about a real run, and only the two coordinates were ever wrong.

## `crates/redextape-core/tests/zipper_equivalence.rs`, above `const EQUIV_CAP: u64 = 10_000;`

Verified directly: raising this cap to 5,000,000 still
runs the proptest below in 0.22 s with 0 of 262 generated programs capping.

THE `three_way_oracle.rs` POINTER READ line 529 UNTIL THIS COMMIT, AND IT HAD DRIFTED. Line 529 was
the literal line carrying "every generated program terminates to a value" when the zipper slice (#5)
wrote it; the node-count bound (#32) moved `arb_tm_safe_expr` down eight lines, taking the quoted
sentence with it, and this conversion found 529 holding a DIFFERENT line of the same doc — the one
naming `redextape-test-support`'s `arb_expr_over` as where the safety lever lives. Recorded ACCURATE
at first, because the citing text says "529's doc" and that doc does still carry the quote; STALE is
the right verdict, because what 529 holds is something adjacent and plausible, which is the failure
mode this slice exists to catch rather than an exception to it.

## `crates/redextape-core/tests/zipper_equivalence.rs`, above `// Test target: `clippy.toml`'s `allow-*-in-tests` keys do not reach free helpers in a `te`

**SINCE `StepEvent::Beta` GAINED `owner`, THAT IS PART OF WHAT IS COMPARED

Proptest rather than the 46-program corpus, deliberately. `FIRST_ORDER_DEMOS` lives in a test
target and has been hand-copied five times with a sync test holding the copies together; a sixth
copy is the drift this tree has fought twice.

## `crates/redextape-core/tests/tm_comments.rs`, above `#[test]`

none of that was true of any test before this one: `printing_a_document_emits_every_comment` uses the header-less `ANNOTATED`, so `write_header` never ran under an emission assertion, and the only directive ever exercised anywhere was `Tape`'s trailing/displacement path in `an_authored_comment_takes_the_tape_line_over_the_generated_name`.

## `crates/redextape-core/tests/guard_counterexamples.rs`, above `#[test]`

verified by hand, not left as an unasserted claim.

## `crates/redextape-core/tests/asm_roundtrip.rs`, above `#[test]`

measured rather than assumed under this test's original name in `2026-08-24-asm-reader.md` (`a_label_name_with_a_space_does_not_survive_the_trip`).

a third outcome, neither of the two this test was drafted to distinguish (a parse error, or a different name coming back).

## `crates/redextape-core/tests/format_properties.rs`, above `#[test]`

which is exactly the gap the final review found — every defect it reported was an interior comment in a multi-statement file, outside both of the old generator's two comment positions.

## `crates/redextape-core/tests/format_properties.rs`, above `let close_bracket_boundary = format!("[{}, {}]", "a".repeat(58), "b".repeat(58));`

— confirmed by mutation for all four in the task report, "Fix round 2." No width between 1 and 119 was found to escape it; 119 is caught along with the rest, so there is no known drift this fixture misses short of 120 itself.

## `crates/redextape-core/tests/sharing_aware_decode.rs`, above `#[test]`

THE TEST THAT COULD NOT PASS BEFORE THIS BRANCH.

## `crates/redextape-core/tests/span_wellformed.rs`, above `let mut stale: BTreeMap<&str, NodeId> = BTreeMap::new();`

The old composition, written out as the bug it was:

## `crates/redextape-core/tests/three_way_oracle.rs`, above `"fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \`

was asserted only by unit tests stopping at the reference and `run_asm`, never through λ, the TM, or native.

## `crates/redextape-core/tests/tm_bank_invariant.rs`, above `#[test]`

— the one clause Task 2 rewrote.

## `crates/redextape-core/tests/tm_bank_invariant.rs`, above `/// Pins the CONTENT clause of `reg_bank_is_well_formed`. Plants `AT``

Review finding: the sabotage that shipped with Task 2 (deleting an overflow guard) exercised the LENGTH clause of `reg_bank_is_well_formed`, an unchanged clause. Task 2 rewrote only the CONTENT clause (`!content.contains(c)`) to consult `Encoding::field_symbols()`. Nothing in the suite planted an illegal symbol strictly INSIDE a field's interior, so nothing proved that clause actually rejects anything. The three tests below close that gap directly.

## `crates/redextape-core/tests/tm_encoding.rs`, above `static AT_WIDTH_CALLS: AtomicUsize = AtomicUsize::new(0);`

— the distinction this branch has had to make fourteen times.

## `crates/redextape-core/tests/tm_exhaustive_bank_safety.rs`, above `/// Prints the real cost of the sweep and the alphabet's real size, which is what the exha`

Task 1: measure, so the bounds in the spec are derived from data rather than from my estimate.

## `crates/redextape-core/tests/tm_header.rs`, above `#[test]`

This arm had no coverage until a whole-branch review named it.

## `crates/redextape-core/tests/tm_width_equivalence.rs`, above `#[test]`

, generalized from this file's own former private copy

## `crates/redextape-core/tests/two_symbol_oracle.rs`, above `assert!(`

which is the gap stage 1's Task 6 review found by sabotaging `entry_name` and watching its strongest leg stay green.

## `crates/redextape-core/tests/two_symbol_oracle.rs`, above `fn assert_two_symbol_agrees(label: &str, m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -`

so Task 7 can point it at a single-tape image without a second copy of the assertions.

## `crates/redextape-core/tests/viewmodel_contract.rs`, above `let genuine_cross_containment = within.iter().any(|(w_id, w)| {`

THE PROPERTY THE OLD FIXTURE COULD NOT EXERCISE:

## `crates/redextape-core/tests/format_properties.rs`, above `fn arb_list_with_bracket_trivia(element: impl Strategy<Value = String>) -> impl Strategy<V`

**EVERY DEFECT THE FINAL REVIEW FOUND LIVED IN ONE OF THESE POSITIONS**, and none of them was reachable from `arb_program_with_trivia` alone, which placed comments only own-line before a `let` and trailing after its `;`. The suite that found §15's `else if` within 89 cases could not have found any of them however long it ran. The empty-list arm is here for the same reason: a comment whose entire construct is `[ ]` skipped the forced break altogether.

## `crates/redextape-core/tests/format_properties.rs`, above `"fn classify(n) { if n == 0 { 0 } else {\n    // nested branch\n    if n > 0 { 1 } else { `

Before this task's fix, the printer collapsed this into `else if`, which this grammar's parser cannot read back — guarded only by an opaque `.proptest-regressions` seed until now.

## `crates/redextape-core/tests/sourcemap_coverage.rs`, above `#[test]`

see the commit that added this test for the reorder-and-observe-a-failure demonstration.

## `crates/redextape-core/tests/format_properties.rs`, above `#[test]`

binary-searching the threshold, it only starts failing once the hard-coded width drops to 14 or below — 60, 100, and 110 all slip through.

## `crates/redextape-core/tests/guard_counterexamples.rs`, above `#[test]`

Since 2026-08-01 that step is **under a millisecond** and the whole program normalises in well under one

## `crates/redextape-core/tests/guard_counterexamples.rs`, above `#[test]`

and at 16,382 tokens the same shape was killed by `SIGKILL` under an 8 GB budget.

## `crates/redextape-core/tests/subst_differential.rs`, above `assert_eq!(pairs, 88_960, "the (body, arg) enumeration drifted from its expected exact cou`

so a bound was never as tight as it could be. It was also weaker than it looked: every one-parameter shrink of this generator lands well below 80,000 regardless (`VARS` 4→3: 25,056 pairs; `T_NODES` 6→5: 24,640), so `> 80_000` only ever caught catastrophic collapse, never drift.

## `crates/redextape-core/tests/tm_parse_scaling.rs`, above `// Test target: a generated file that does not parse as generated is the failure these tes`

Against the parser at `78ebea6`, which still compared each line with every earlier line of its kind, the same files measured 23.08x for `state` lines and 17.17x for `tape` lines in a `--release` build.

## `crates/redextape-core/tests/tm_bank_invariant.rs`, above `macro_rules! reg_bank_tests {`

(width 64 alone was 73% of the original 131s single test)

## `crates/redextape-core/tests/counter_oracle.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

`3 - 5`'s stands for about 10^380 literal steps.

## `crates/redextape-core/tests/counter_oracle.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

every slow-tier test ran in under 60 s in the release build `scripts/check-slow.sh` runs.

## `crates/redextape-core/tests/counter_oracle.rs`, above `#[test]`

in about 5.2 s in this workspace's unoptimized dev profile (`cargo nextest`, timed on its own), over this file's 1 s bound, so it is in the slow tier. The two largest images dominate — `if`'s at 1.5M moves up to 2855 bits and `1 + 2 * 3`'s at 1.6M moves up to 1956 bits — because unbuffered `Nat` arithmetic is O(moves · bits), which buffering exists to avoid.

## `crates/redextape-core/tests/lambda_foreign_reader.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

This is the gap that mattered most. `term.rs` documents `shift(d, cutoff, t)` ("shift the free variables ... by `d`"), `subst(j, s, t)` ("substitute `s` for the variable with index `j`") and `beta` ("substitute `arg` for index 0 in `abs_body` and close the hole") — but does not spell out the index arithmetic itself, so a reader has to derive it from the rule the printed text form implies: closing a hole after substituting needs the substituted argument shifted up before it goes in and the reduct shifted down afterward, and crossing a binder during substitution renumbers both sides. "Substitution is pure index arithmetic (no fresh names, no capture)" tells you it IS index arithmetic, not WHICH.

## `crates/redextape-core/tests/lambda_foreign_reader.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

and nothing in the docs warns it.

## `crates/redextape-core/tests/lambda_foreign_reader.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

No READER-FACING permitted doc says this anywhere — not `syntax.rs`, not `encode.rs`. It IS recorded, in `lambda/decode.rs`'s module doc, the file the out-of-band task instructions correctly banned this reader from consulting (that file describes the very decoding strategy a foreign reader has to rederive independently). So the fact is not undocumented project-wide; the gap is narrower and more actionable than that: no file a foreign reader is permitted to consult carries it, so it has to be rediscovered rather than looked up.

## `crates/redextape-core/tests/lambda_provenance.rs`, above `#[test]`

reverting the `app_owned(..)` returned by `lower.rs`'s `lower_region_body` in its `Core::Let { mutable: false }` arm back to plain `app(..)` left the whole file green.

## `crates/redextape-core/tests/lambda_provenance.rs`, above `#[test]`

confirmed BEFORE THIS TEST EXISTED: mutating `build_while` to tag `(fix g)` instead of its own return left every test binary in the crate green. The test below is what closes that gap — at HEAD, the same mutation now fails it

## `crates/redextape-core/tests/lambda_sharing.rs`, above `const SUBJECT_LOOP: &str = "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n`

Since the `maxfree` short-circuit in `term.rs` (`shift` and `subst` return their argument's allocation when no free index is in range) and β-fusion after it, the gate measures **28.02x against 320.37x — a 11.43x spread, against the probe's 10.07x**. The two axes now agree closely.

## `crates/redextape-core/tests/reduced_tm_file.rs`, above `const FIVE_MINUS_THREE: &str = "5 - 3";`

and `3 - 5` hid a header whose code had two of its symbols swapped.

## `crates/redextape-core/tests/sharing_aware_decode.rs`, above `#[test]`

This one had no budget to exceed, so before the memo it did not refuse — it allocated: at m = 4,000 the un-memoized walk built 16,012,001 nodes and about 1 GiB.

## `crates/redextape-core/tests/three_way_oracle.rs`, above `"let n = 7; fn tail(x) { x + 1 } fn ap(g, y) { g(y) } tail(3) + ap(tail, 2) + ap(|y| y + n`

Confirmed non-vacuous by sabotage (reverting `tail1`'s emitted name to the bare `"tail"`): the TM diverges (`HitCap`) while reference and λ still agree.

## `crates/redextape-core/tests/tm_width_equivalence.rs`, above `let w = width.expect("a bounded encoding always reports a width");`

Once required — `Binary`'s decode was width-strict, so a tape fitted narrower than 64 decoded to `None` under a 64-cell `Binary` — and now redundant, both decoders being structural.

## `crates/redextape-core/tests/tm_width_equivalence.rs`, above `#[test]`

measured, not assumed. Under `Binary` this generator (leaves 0..70, depth 3, size 8) never produces a value needing more than an 8-cell field: a fixed 300-sample probe gave `ran=300 overflows=0 widths_seen={4, 8}`, for every seed tried. That is not under-sampling — it is structural.

## `crates/redextape-core/tests/universal_oracle.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

**TIERS FOLLOW THE DEV PROFILE**, which runs the UTM over 20 times slower than a release build.

## `crates/redextape-core/tests/single_tape_oracle.rs`, above `#[test]`

Task 6's review measured `1 + 2` at 795,199 single-tape steps at `PAD = 64` against 88,339 at `PAD = 1`, a ~9x spread produced entirely by a constant nobody meant to be measuring.

## `crates/redextape-core/tests/tm_exhaustive_bank_safety.rs`, above `#[test]`

which is exactly what the full length-2 sweep found (`Box(Rr, Rr); Box(Rr, Rr)` at width 2, where the second pointer is 2 and does not fit).

## `crates/redextape-core/tests/tm_header.rs`, above `let mut bad_init = h.init(m.tapes);`

what was actually checked, as corroboration rather than proof, is narrower -- for the 4 programs in `CORPUS`, under both encodings, flipping any single DATA cell decodes identically to the untouched run.

## `crates/redextape-core/tests/viewmodel_contract.rs`, above `#[cfg(feature = "serde")]`

As `[{start, end}, "Class"]` tuples, about 300 a frame, they were most of what a λ frame cost to build in the worker and to copy across to the page.

## `crates/redextape-core/tests/viewmodel_contract.rs`, above `#[cfg(feature = "serde")]`

and `window` as an array of one-character strings a tape was most of what a frame cost to build in the worker and to copy across to the page.

## `crates/redextape-core/tests/tm_oracle.rs`, above `const CALL_DEMOS: &[&str] = &[`

even the heaviest, `sum(5)`, halts in ~178k steps (~3.6% of the cap, no `HitCap`)

## `crates/redextape-core/tests/lambda_foreign_reader.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

`d` is an `i64` and nothing says.

## `crates/redextape-core/tests/viewmodel_contract.rs`, above `let src = "let x = 40; x + 2";`

At width 4 this sample resolved 77 of its 110 billed states under binary
