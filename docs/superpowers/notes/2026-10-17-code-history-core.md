# Code history moved out of comments

Text moved verbatim out of code comments when they were trimmed to their why. Each entry names the file and the line of code the comment sat above.

## `crates/redextape-core/src/analysis.rs`, above `#[must_use]`

TAKES NO `Machine`, AND THAT IS THE WHOLE OF THE GUARANTEE. It once took one, purely to turn the
map's `StateId`s into the names the text uses; `SourceMap` now records that association itself, at
build time, against the very machine it was built from (`SourceMap::tm_owner`). There is therefore
no second object to pass and no wrong one to pass. The version that took both could not check they
described one lowering: a map built at one encoding, indexed through a machine lowered at another,
resolved each id to some other state's name and attributed the majority of state-naming spans to
the wrong construct — no error, no empty result, just a confidently wrong highlight.

## `crates/redextape-core/src/binder.rs`, above `#[test]`

Measured on 6e0ad6e: 19,999 statements is
99,996 tokens and 20,000 is 100,001, against a cap of 100,000.

## `crates/redextape-core/src/core.rs`, above `#[test]`

THE WRAP THIS CLOSES. `seeded(u32::MAX)` used to reach it in one call: `fresh()` returned
`u32::MAX` and left `next` at 0, so the NEXT id collided with the root of whatever tree was
being built — silently, in release, in the map the UI resolves clicks through.

## `crates/redextape-core/src/core.rs`, above `pub const MAX_NODE_ID: NodeId = 1_000_000_000;`

It is **12,500x** the largest `NodeId` measured from source: 80,000, at 80,002 tokens, from a
`1 + 1 + ...` chain.

## `crates/redextape-core/src/counter/accel.rs`, above `use crate::counter::nat::{Divisor, Nat};`

Measured on `sum(5)`'s stage 1 image while this was planned, it took the
run from 110.2 s, with a limb pass on every move, to 11.9 s (11.861 s at `74906c4`, load 27.8).

## `crates/redextape-core/src/counter/nat.rs`, above `/// An unbounded natural number: its 64-bit limbs, least significant first, with no zero l`

When every head
move divided a counter by the base with `num-bigint`, that division was 55% of the profile of
`let x = 40; x + 2`'s stage 1 run and `sum(5)` took 146.9 s

## `crates/redextape-core/src/desugar.rs`, above `let stmts: Vec<String> = (0..20_000).map(|i| format!("{i};")).collect();`

`lower_stmts` is iterative, so a statement count well above what the old per-statement
recursion could survive (empirically ~4800 on an 8 MiB debug main thread) must still
desugar cleanly into a deeply right-nested Seq chain with unique NodeIds.

## `crates/redextape-core/src/desugar.rs`, above `fn lower_fn_run_at(g: &mut NodeGen, run: &[Stmt], acc: Core, spans: &mut Vec<(NodeId, Span`

**This is a deliberate language change**: `let g = |x| x * 10; fn f(x){ g(x) } fn g(y){ y } f(3)` was 30
and is now 3.

**Also a deliberate language change**: `fn a … fn a …` in one run used to be legal with
the last definition winning.

## `crates/redextape-core/src/lambda/lower.rs`, above `#[test]`

**The program that killed the total-size design.** A 699-element list literal is ~497,691 logical
nodes with NO sharing, and it reduces cleanly (1,398 steps, 35 s). Its `max_shared` is exactly 0
— which is also why the shared-subterm guard was silent on it, and, read the other way, the first
hint that `max_shared` is blind to the cost of stepping a large unshared term.

## `crates/redextape-core/src/lambda/lower.rs`, above `/// A 699-element list literal is ~497,691 logical nodes with NO sharing, so its `max_shared` is exactly`

These two used to gate. `MAX_SHARED_LOGICAL_NODES` was falsified and removed (see the note above
`LowerError`), so they now assert what `max_shared_logical_size` reports rather than what `lower`
does with it. They stay because the numbers are worth pinning and cost nothing: both are the
extremes of the corpus profile the investigation ran, and either moving means the LOWERING
changed shape, which is a thing a later reader wants told.

## `crates/redextape-core/src/lambda/lower.rs`, above `#[derive(Clone, Debug, PartialEq, Eq)]`

A SECOND GUARD USED TO SIT HERE AND IT WAS REVERTED. `MAX_SHARED_LOGICAL_NODES` = 10,000 refused a
term whose largest SHARED subterm exceeded it (`1652e09`), on the theory that `subst` duplicates a
shared subterm once per occurrence of the substituted variable. **Measurement falsified it, and the
mechanism it named was not what `subst` does.** `subst`'s `Var` arm is `s.clone()` — an `Rc` bump, so
occurrences are free — while its `Abs` arm re-shifts the whole argument once per `Abs` node in the
body, unconditionally, before anything checks whether the variable occurs. A step costs
`|body| + Abs(body) × |arg|`, and NEITHER factor is a sharing property: `let xs = [0..500); let ys =
[0..500); head(xs) + head(ys)` is 4,821 bytes with no recursion, measures `max_shared` = **4** against
the bound of 10,000, and its FIRST β-step took 19.0 s. The guard was 2,500x off on a program anyone
could write by accident. The measurement stays (`term::max_shared_logical_size` is sound and the two
tests below pin it); the refusal does not.

**~~The hang is open.~~ CLOSED 2026-08-01, AND NOTHING WAS ADDED HERE.** The account above stops one
level short of the cause, and the missing level is why no guard was needed: it does not say why
`|arg|` was the LOGICAL size rather than the physical one. `term.rs`'s `shift` rebuilt every node it
visited — Θ(logical), and sharing-destroying, since `shift(App(c, c))` recursed twice. `lower_group`'s
per-member clone (below) only writes the promise; `shift` cashed it on every step. Both `shift` and
`subst` now return their argument's allocation when no free index is in range, and `reduce.rs`'s
`depth_exceeds` reads a stored `depth` instead of walking. That 19.0 s step is now under a
millisecond, and `lower` still refuses nothing on these grounds — **deliberately, and this is the
third design on this hazard not to land here.** The successor named below, a per-redex work budget in
`LambdaCursor::next`, was never built: not falsified, made unnecessary.

## `crates/redextape-core/src/lambda/lower.rs`, above `const MAX_LAMBDA_LOWER_DEPTH: u32 = 700;`

Measured on an explicit 8 MiB thread in a debug build, the UNGUARDED
lowering survived depth 1453 and overflowed by 1473 on its fattest reachable shape — a store-passing
region's statement spine; a plain list spine survived to ~1750 and a `fn` body to ~1900.

## `crates/redextape-core/src/lambda/reduce.rs`, above `#[must_use]`

recovering 99.0% of that ceiling

## `crates/redextape-core/src/lambda/reduce.rs`, above `pub(crate) fn depth_exceeds(t: &LambdaTerm, limit: u32) -> bool {`

**THIS USED TO BE A WALK, AND THAT WALK WAS 96% OF THE REDUCER'S TIME.** It pushed an explicit stack
and descended into both children of every `App` without asking whether they were one allocation, so
it visited each allocation once per EDGE reaching it — the LOGICAL expansion. That is the same bug
class as the `shift` fix one file over, and it survived it: with `shift` fixed, the nested-group
family's reduction still doubled per level, and sampling showed **187.6 s of level 11's 195.7 s was
this function**. Carrying `depth` on the handle took that level to 7.48 s and made the whole ramp
FLAT — 7.5–9.0 s at every level from 1 to 11, against a logical size growing 306 → 616,152.

**Memoizing the walk by allocation was measured and rejected.** It gives the same answer in
O(physical), but costs a `HashMap` per call, and at eleven levels that is a flat ~24 s of pure
allocation overhead across ~105,000 calls — a net LOSS at the small end (25.1 s against the walk's
11.6 s at level 7), which is where the ordinary corpus lives. A number the constructors already know
is free at both ends. `examples/shift_cost_probe.rs` has the table.

THE HISTORY THIS REPLACES, kept because the shape it warned about is real and someone will
reintroduce it. The walk's early exit bounded *depth*, not *work*: thirty nested `App(c, c)` levels
is 30 allocations and 2^30 logical nodes, and it returned `false` on all of them after walking every
one. That was called "merely unreached — nothing in the corpus builds one" until 2026-07-31, which
was true of the corpus and false as a guarantee: `lower_group` clones the whole group term once per
member and the factor nests, so `examples/blowup_probe.rs` reaches 1,644 allocations holding 616,152
logical nodes (375x) from **512 bytes**. Nothing in this file fired on it — the term's depth was 141
against `MAX_TERM_DEPTH` = 3,000 — and `MAX_REDUCTION_STEPS` was never consulted, because control did
not return from `reduce_step`. Every one of those numbers is still true of the term; none of them is
still true of the cost.

**THE HANG IS CLOSED, AND NOT BY A GUARD — BY FIXING `shift` (2026-08-01).** What no longer holds is
the conclusion this block used to end on.

~~"THE HANG IS OPEN. NOTHING REFUSES THESE SIZES."~~ — and before that,
~~"the sizes at which one step does not return are refused before reduction ever starts"~~. The
first was true when written; the second never was. Both are superseded: nothing refuses these sizes
now either, because **nothing needs to**. A single β-step returns.

The diagnosis in the middle of that block was right and pointed one level too shallow. `subst`'s
`Var` arm is `s.clone()` (an `Rc` bump — occurrences are FREE) while its `Abs` arm re-shifted the
whole argument once per `Abs` node in the body, unconditionally: a step cost
**`|body| + Abs(body) × |arg|`**, at 23.1–23.6 ns/node-copy over a 1,255x range. What that account
left implicit is WHY `|arg|` was the logical number rather than the physical one. `shift` rebuilt
every node it visited, so it was Θ(logical) AND it destroyed sharing — `shift(App(c, c))` recursed
twice and produced two copies of `c`. `lower_group`'s duplication only writes the promise; `shift`
was what cashed it, on every step.

`term.rs` now carries a `maxfree` per handle (highest free index + 1; 0 means closed), maintained in
O(1) by the constructors, and both `shift` and `subst` return their argument's ALLOCATION when it
cannot be affected. The counterexample that killed the shared-subterm guard —
`let xs = [0..500); let ys = [0..500); head(xs) + head(ys)`, 4,821 bytes, `max_shared` = 4 — went
from **19.0 s in its first β-step to 0.002 s**. The 512-byte nested-group program that did not
finish one β-step in 13 minutes at 974 MB then ran 105,607 steps in 195.7 s under a 2 GiB cap.

**AND THEN THIS FUNCTION WAS 96% OF WHAT WAS LEFT** — see the top of this comment. With `depth`
stored too, that same program is **7.48 s**, the two-list counterexample is under a millisecond, and
the ramp is flat across all eleven levels. Instrument: `examples/shift_cost_probe.rs`.

**THE PER-REDEX WORK BUDGET WAS NOT BUILT, and this is the record of why it was not needed.** The
roadmap's next λ slice was `logical_abs_count(body) × logical_size(arg)` checked in
`LambdaCursor::next` before the step it prices. That design is sound and its reasoning survives —
it prices the measured cost model rather than a proxy, and it checks per step. It was overtaken:
the quantity it was going to bound is no longer large, because `|arg|` is no longer paid logically.
A guard sized against the pre-fix numbers would be calibrated against costs inflated up to ~9,500x
on these programs. If one is wanted later it must be re-measured from scratch.

**WHAT IS STILL OPEN, stated because "the hang is closed" will be read as covering more than it
does.** Divergence is untouched and was never this slice's to solve — the nested-group family has no
base case, so "terminates" above means it reaches a cap in bounded time, not that it computes an
answer. The cap it reaches is **this function's**, not the step cap: `MAX_TERM_DEPTH` fires at
105,607 steps against a `MAX_REDUCTION_STEPS` of 5,000,000, because the family grows deep as it
diverges. Both are reachable now only because control returns from each step, which is the whole
change.

**THE RAMP BEING FLAT IS A FACT ABOUT THIS FAMILY, NOT A COMPLEXITY CLAIM.** What the two fixes
removed is cost that scaled with the LOGICAL size while the physical size stayed small — which is
exactly what this family is built to exhibit. A program whose physical size genuinely grows still
pays for it, and `subst` still rebuilds the spine of whatever it descends into. ~~The older next
target — carrying `subst`'s per-binder re-shift down as one `shift(d, 0, ·)`, with an additivity
lemma already verified in the perf design — is untouched and still available.~~

**THE OLDER NEXT TARGET IS FALSIFIED TOO — 2026-08-02, by the same short-circuit that closed the
hang.** Priced against what `subst` NOW allocates it is not a win but a **0.99x loss** on this
family at every level, and 1.00x on both counterexamples. The quantity it deletes is 5,696
allocations across 105,607 β-steps — 0.05 per step, against a model that priced it at 44 copies of
the argument per step. It inverts because `subst` descends only through the binders ON THE PATH TO
AN OCCURRENCE, so binders-crossed is now smaller than occurrences and paying per occurrence costs
more than paying per binder. Instrument: `examples/shift_cost_probe.rs`'s census section, which
mirrors `subst` arm for arm rather than modelling it; full statement in the perf design's §10.

**What that leaves as the largest measured λ cost, neither of which any proposal so far addresses:**
the body spine `subst` rebuilds (60–90% of its allocations), and `beta`'s own opening
`shift(1, 0, arg)` — the only quantity on this family that still scales with it, 20,725 → 190,666
allocations across levels 1 to 11 while everything else is flat or falling.

## `crates/redextape-core/src/lambda/reduce.rs`, above `pub const MAX_TERM_DEPTH: u32 = 3_000;`

**THE WASM SHADOW STACK IS NOT
THE RELEVANT STACK, and `-zstack-size` cannot help** — on that target the printer exhausted V8's
own engine call stack, which no module can size, at term depth 1,930 in a Web Worker on its FIRST
deep print (measured 2026-08-09; a worker's ceiling drops after that print — see
`redextape_wasm::session::MAX_PRINT_DEPTH`'s doc for the steady-state figure). This constant no
longer bounds the printer for that reason; see `redextape_wasm::session::MAX_PRINT_DEPTH`.

## `crates/redextape-core/src/lambda/syntax.rs`, above `let (short, _, truncated) = print_lambda_capped(&t, 8, MAX_TERM_DEPTH);`

Before the fix, each frame pushed its separator unconditionally: one extra
byte PER ARGUMENT (8 extra bytes, double the budget).

## `crates/redextape-core/src/lambda/syntax.rs`, above `#[must_use]`

which
the demo corpus measures at 5-403 entries.

## `crates/redextape-core/src/lambda/term.rs`, above `#[test]`

`beta` was `shift(-1, 0, subst(0, shift(1, 0, arg), body))`, when the hang was diagnosed, and all
three of those rebuilt every node they visited — so handing it a closed argument of 19 allocations
denoting 262,144 nodes
materialised all 262,144. That is the mechanism behind the open hang: `lower_group` writes a
term whose logical size runs 375x ahead of its physical size, and the reducer cashes the promise
on the first step that touches it. `examples/blowup_probe.rs` recorded the symptom — "a β-step's
output aliases nothing, and the within-term ratio is exactly 1.00x after ≥6 steps" — without
naming this as the cause.

## `crates/redextape-core/src/lambda/term.rs`, above `#[test]`

~~Fusion does not weaken that guarantee; it makes it structural.~~ **Corrected 2026-08-03:** the
first version of this arm used a `debug_assert!` and that sentence was written for it, which made
the guarantee weaker in release than the `shift` call it replaced rather than stronger.

~~What this test contributes is that it is the only case in the suite that reaches `k = j + 1`.~~
**Corrected again, same day, and the second correction was checked rather than reasoned:**
making the decrement arm panic on `k == j + 1` fails **15 tests across 7 targets** — the lib
target's `lower::arithmetic_matches_the_reference`, `lower::recursion_via_fix`,
`reduce::church_arithmetic_normalizes`,
`trace::lambda_cursor_emits_the_same_redex_paths_as_reduce_trace` and this one; both β tests in
`tests/subst_differential.rs`; every oracle (`three_way_oracle`'s three,
`lambda_oracle`'s two, the two `four_way_oracle` rows); `zipper_equivalence`'s two; and
`lambda_sharing`'s `reduce_trace_shares_its_snapshots`. **The count was wrong twice before
this** — "five in the lib target" was measured with `cargo test`'s default fail-fast, which
stops at the first failing target, so it was a floor reported as a total. Run it with
`--no-fail-fast` or do not quote a number. What is true is narrower: **this is the only test that
reaches the case deliberately and in isolation.** The corpus tests reach it incidentally, so a
break in the decrement arm fails them for reasons that take a trace to localise, where this one
names the case in its title. That is the whole of its value, and it is worth having.

## `crates/redextape-core/src/lambda/term.rs`, above `#[allow(clippy::many_single_char_names)]`

88.4% of corpus steps whose argument is closed either way.

## `crates/redextape-core/src/lambda/term.rs`, above `#[must_use]`

**This was three walks until 2026-08-03** — `shift(-1, 0, subst(0, shift(1, 0, arg), body))`, the
textbook de Bruijn formulation — and `Σ opening + Σ closing` was 18.0% of every allocation the
reducer made.

measures **1.5x worse on the nested-group family**
(`Σ reshift` 5,921 against `Σ per_occ` 8,881) and **5.6x BETTER on the 46-program corpus**
(`Σ reshift` 44,539 against `Σ per_occ` 7,944).

## `crates/redextape-core/src/lambda/term.rs`, above `#[must_use]`

The survey found no caller, in `src/`, `tests/*.rs` or `examples/*.rs`, that comes
anywhere near this boundary: every real `d` is in `{-1, 0, 1, 2, 3}` and every real `k` comes from a
lowered or hand-built term far below `u32::MAX`.

**The lockstep argument the lower bound used to rest on is now internal to `beta_go`, not to this
function's relationship with `subst`.** Before fusion, `subst`'s `j + 1` and this function's
`cutoff + 1` stepped together under `Abs`, so the index `subst` replaced was exactly the one `beta`'s
closing call would decrement — two functions agreeing by construction, which a refactor could break
silently. `beta_go` now carries that same pairing (its own `j + 1` against `shift(1, 0, s)`) inside
one function, guarded by its own unconditional `assert!(*k > j, …)`. What keeps THIS function's
negative-index panic unreachable from compiled output is simpler and no longer a two-function
argument: nothing in `src/` calls `shift` with a negative `d` at all. Both checks stay unconditional
rather than `debug_assert!`, because `shift` is `pub` and a refactor can reintroduce a caller
silently. Measured cost in release of the lower-bound check alone: none — five runs put the guarded
version's range around the unguarded one (0.2078–0.2191s vs 0.2123–0.2151s for 2,000 shifts over a
400-deep term), i.e. below run-to-run noise; the upper-bound check is the same shape of comparison
and is not expected to differ.

## `crates/redextape-core/src/lambda/term.rs`, above `#[must_use]`

a 699-element list literal is ~497,691 logical nodes, reduces cleanly in 1,398 steps, and scores
0 here. That property is why a guard on *sharing* was written to replace a guard on *total size* —
and then why it failed, since a term can be huge, unshared, and still cost 19 s in one β-step.

**A MEASUREMENT, NOT A GUARD, AND IT HAS NO IN-LIBRARY CALLER.** The guard that read it
(`MAX_SHARED_LOGICAL_NODES`, `LowerError::TooShared`) was reverted; nothing in `src/` calls this
today. It is kept `pub` deliberately, as the measurement surface the `examples/` probes and any
future guard need — an `examples/` target cannot reach a private item, and the investigation that
falsified the guard ran entirely through this function.

**Cost is stated in PHYSICAL size on purpose:** 92.6 ms optimized
on that 497,691-allocation list, against a `lower()` of 9.7 ms.

## `crates/redextape-core/src/nav.rs`, above `pub fn dangling_like(&self, i: usize) -> impl Iterator<Item = &Occurrence> {`

and the alternative that shipped first was `null`, which tells someone
hunting every jump still to fix that the name under their cursor is not a name.

## `crates/redextape-core/src/parser.rs`, above `fn parse_expr_recovering(&mut self) -> Expr {`

claiming its full span here is what let `"let x =\nlet y =
1;\ny"` give `Let(x)` the span `0..11` ("let x =\nlet"), overlapping the following `Let(y)`.

## `crates/redextape-core/src/parser.rs`, above `fn expect_or_record(&mut self, kind: TokenKind, what: &str) -> Span {`

Answering its full span used to make
the construct claim source that a following sibling also claims: `"let x = 1 let y = 2; y"`
gave `Let(x)` the span `0..13` ("let x = 1 let", swallowing the next statement's `let`) and
`Let(y)` `10..20`, overlapping it.

## `crates/redextape-core/src/printer.rs`, above `assert_formats_and_reparses(`

Before the fix this reproduced byte-for-byte as:
`"fn e(x) {\n    x\n}\n[\n    {\n        e(\n            {\n            }, // c\n        )\n    },\n    [\n        1,\n    ],\n]\n"`
— `// c` landing inside `e`'s empty-block argument, four levels away from the list it was
written against, and `[1]` breaking vertically for a comment it no longer held.

## `crates/redextape-core/src/printer.rs`, above `let chain = |depth: usize| {`

a 713-byte chain nested 22 deep took 1.82 seconds before this fix.

## `crates/redextape-core/src/printer.rs`, above `let (d4, d6, d8) = (print_work(&nested_lists(4)), print_work(&nested_lists(6)), print_work`

`nested_lists(16)` — 202 bytes of input — took 11.5 SECONDS, and depth 20 did not finish.

A regression has to FAIL this test, not hang the run: at depth 16 the exponential version takes minutes

## `crates/redextape-core/src/printer.rs`, above `speculating: usize,`

`[[[…]]]` nested 16 deep, 202 bytes of input, took 11.5 SECONDS, and 20 deep did not finish. With this counter each doomed attempt stops at the first newline its own depth produces, and the same input formats in microseconds.

## `crates/redextape-core/src/tm/asm.rs`, above `#[test]`

Confirmed directly: a probe read of `bytes_used` at HEAD prints `0`, on
every one of `cargo test --release`, its debug build, `--include-ignored`, and `cargo nextest`.

## `crates/redextape-core/src/tm/asm.rs`, above `struct CountingAlloc;`

THAT divergence is what made an earlier version of this counter wrong: it was one process-wide
`AtomicUsize`, exact under cargo-nextest (one OS process per test) but not under plain `cargo
test`, which runs every non-`#[ignore]`d lib test — all 682 of them — against the SAME counter.
`scripts/check-slow.sh --all` drives exactly that shared-process path and failed this test
deterministically (300KB-600KB of concurrent tests' allocations landing inside the before/after
window, against a 4,096-byte bound), even though every CI job would have stayed green: the
`rust-slow` job filters this test out via `--ignored`, and every other Rust job uses nextest.

## `crates/redextape-core/src/tm/asm.rs`, above `#[test]`

this test used to pin
exactly that, asserting `None` at n = 6000 (`6000^2 + 6000 + 1` = 36,006,001 nodes, ~1.8x
`MAX_DECODE_NODES`).

The heap and the answer are unchanged; only the work to
reach it dropped from ~36,006,001 nodes to a few thousand.

## `crates/redextape-core/src/tm/asm.rs`, above `assert!(memo.len() <= spent, "memo {} entries against {spent} units spent", memo.len());`

(A second assertion here used to claim linear-vs-quadratic too, `spent < 10 * (2 * m)`, but it never bit: decoding each of this fixture's `m` inner lists
with NO memo at all — 3 * (m - j + 1) + 1 summed over j, plus the outer spine's 2m + 1 — spends
exactly 82 against that 120 threshold at `m = 6`, since `m` is too small for the O(m^2) a
no-memo run would actually cost to cross it.

## `crates/redextape-core/src/tm/asm.rs`, above `pub(crate) fn decode_word_ty(`

**That claim used to be qualified, and the qualification was false.** It read: the VALUE-directed sibling `decode_word` IS
duplicated, "but safely, since both recurse structurally on a finite reference `Value` already in
memory and need no budget at all".

## `crates/redextape-core/src/tm/asm.rs`, above `#[allow(clippy::cast_possible_truncation)]`

It used to carry a documented residual gap:
`Instr::Tail` is a pointer read rather than an allocation, so an ordinary `tails`-style function
returns a `List<List<Nat>>` whose inner lists share the outer spine — `~2m` heap cells but
`m^2 + m + 1` decode nodes, because the decoder re-walked each shared sub-list once per pointer
into it. Breakeven was `m ~ 4_471`, three orders of magnitude below `DEFAULT_CAPS.heap`, so a
correct, fast, cap-respecting program could be refused. Memoization closes it: the same fixture at
`m = 64_000` decodes in about 192,000 nodes.

## `crates/redextape-core/src/tm/asm.rs`, above `let mut seen: HashSet<&str> = HashSet::new();`

`.contains` on a `Vec` is O(n) inside a loop over `self.labels`, making the whole pass O(n²) — measured on the release
binary at 20,000/40,000/80,000 labels, about 5x per doubling, while the parser that builds
`self.labels` stays linear.

## `crates/redextape-core/src/tm/attribute.rs`, above `#[test]`

WHY THIS ASSERTS BY IDENTITY, not by summing each kind of bucket: the summed form (`closure =
sum of every ClosureScaffold bucket`, `user = sum of every Node bucket`, each asserted `> 0`)
was measured UNABLE TO FAIL under the exact mutation this test exists to catch — making 5c's
forwarding arm reuse the source function's own `lambda_id` instead of minting fresh ids from
`SynthGen`. Under that mutation the forwarding call's 13,082 steps relocate WHOLESALE from
`ClosureScaffold(25)` to `Node(16)` — the wrong-bucket bug this whole file exists to catch —
yet `closure` (24,052) and `user` (81,733) both stay positive, so both `assert!(... > 0)`s keep
passing. The mutant was caught only incidentally, by `defunc::no_output_node_id_is_duplicated`
in a different file, and for a different symptom (a duplicate output id, not a relocated cost).

## `crates/redextape-core/src/tm/attribute.rs`, above `#[test]`

where 3,472 was the largest measured across three such generators

and it lowers to 4,096 instructions, already past that 3,472 figure

## `crates/redextape-core/src/tm/attribute.rs`, above `#[test]`

Corpus-wide that silently relabels 49,630 steps — 1.5% of the survey — from

The WRITE bucket and the total were re-blessed (+106 steps, 4,954 -> 5,060) when
`box_overwrite_field` became a COUNTED `width`-long chain instead of a content-driven loop. That
is a deliberate algorithmic change, not a guard: a box write now always traverses the full
window, so at the pinned width 64 these numbers grew.

## `crates/redextape-core/src/tm/attribute.rs`, above `#[test]`

corpus-wide it moved
`LetRec` from 128,040 steps to 16.

## `crates/redextape-core/src/tm/attribute.rs`, above `#[test]`

`sum(5)` attributed to 329 steps against a real 223,886.

## `crates/redextape-core/src/tm/attribute.rs`, above `MachineScaffold,`

(measured: all three call-free cases
in this module's tests), and it is the largest single bucket in a recursive one — ~25% of
`sum(3)`, about 7.2k steps per return.

## `crates/redextape-core/src/tm/build.rs`, above `#[allow(clippy::cast_possible_truncation)]`

**THIS REPLACES A PROSE ARGUMENT THAT WAS WRONG.** The previous doc reasoned that
`prog.code.len()` was bounded by ~172 GB of resident memory and so the cast was unreachable.
Measurement found a 6 KB balanced expression building an 8.6M-state, 6.0 GB machine and a
24 KB one getting killed by `SIGKILL` under an 8 GB budget — both reachable from the editor through
`run_tm_described`. The cast was never the defect; the unbounded product was, and the process
died at ~0.2% of the way to `StateId::MAX`.

## `crates/redextape-core/src/tm/build.rs`, above `pub const MAX_MACHINE_STATES: usize = 1_000_000;`

727 was the larger of two measured rows: 725 at 1,022 tokens (575,861 states) and 727 at
4,094 tokens (8,595,317 states), the pair that established "stable across a 15x size range."
**That pairing can no longer be re-verified**: `MAX_MACHINE_STATES` now refuses the 4,094-token row
outright (see the "NOT ALL OF THEM" note below), so a fresh run of the probe re-derives only the
surviving row — 700-725 B/state depending on machine and allocator, not a pinned 727. Three facts
fix the ceiling at 727 MB regardless, none of which needs the retired row:

  * The worst program this project SHIPS (the `map` + `ap2` demo in `native_oracle.rs`'s
    `FIRST_ORDER_DEMOS`) builds **49,135** states, 35.7 MB, from 97 tokens — roughly 500 states
    per token. The ceiling is 20x that in states, but the front door a user actually types against
    is `MAX_TOKENS` (100,000), not a state count. At ~500 states/token (order-of-magnitude only —
    it varies with program shape) the ceiling is reached around 2,000 tokens of demo-style code, a
    few hundred lines: **a ~50x gap between what the parser accepts and what this backend can lay
    out**. That gap, not the 20x in states, is what a reader needs to judge "never rejects a
    legitimate program" against `MAX_TOKENS`'s own limit.
  * A balanced arithmetic tree of 1,022 tokens builds 575,861 states (398 MB) and works today;
    one of 4,094 tokens builds 8,595,317 (6.0 GB) and does not — that is fatal in wasm32, and at
    16,382 tokens the same shape was killed by `SIGKILL` under an 8 GB budget. The ceiling admits the largest size
    measured to work and refuses the first size measured not to.

**NOT ALL OF THEM, AND THE REASON IS THIS CONSTANT.** Two ROWS that justify the ceiling most
directly — the 8,595,317-state machine (4,094 tokens) and the run killed by `SIGKILL` (16,382
tokens) — were measured BEFORE the ceiling existed. It is enforced in `state`/`accept` below, the
choke point `lower_tm`, `lower_tm_guarded` and `lower_tm_mapped` all share, so no lowering
reachable from the probe can exceed it any more: those rows now report a refusal instead of a size.
A third casualty follows from the first: the "727 bytes per state, stable across a 15x range" claim
above needed BOTH the 1,022-token and the now-refused 4,094-token row, so a fresh run can re-derive
the surviving row's figure (700-725 B/state) but not 727, nor the stability claim across the pair.
**The evidence for a guard stops being reproducible once the guard is enforced**, which is worth
stating rather than leaving a reader to discover that the probe disagrees with this comment.

## `crates/redextape-core/src/tm/comments.rs`, above `#[must_use]`

**THIS REPLACED SIX HAND-ROLLED COPIES, AND THE HAZARD WAS THE DUPLICATION AND NOT ANY DISAGREEMENT.**
`parse_rule_line`, three branches of `parse_tm_full`, `HeaderParts::directive` and `parse_cells`
each spelled `line.split(';').next().unwrap_or("").trim()` for themselves while the comment half
of the very same line was derived through `split_trailing`. The two spellings agree — `split`
always yields at least one item, so the `unwrap_or` arm is unreachable and both answer with the
prefix before the first `;`, or the whole string when there is none — and nothing made them agree.
One change to what starts a comment — an escape rule, say — would have had to land in seven
places, and the `.tm` comment fixtures would have caught an ordinary boundary change at three of
them; what they could not have caught is a change invisible to those fixtures landing in six.

**`parse_asm_full` CARRIED THE SEVENTH COPY, AND THIS BRANCH ALREADY FOLDED IT ONCE.** Before
this branch it spelled the same thing character-for-character, and the comment-retention task
replaced it with a single `split_trailing` call feeding both halves — because that parser needed
the comment half for the first time, and taking it from a second, independent split would have
been the duplication this function exists to remove. So the fold performed here is the one
already performed there, on the same argument, one task earlier.

## `crates/redextape-core/src/tm/defunc.rs`, above `#[test]`

Before the
`$`-alias fix this MISCOMPILED SILENTLY: `lower_asm` resolves a bound function before the
builtin table, so the dispatcher's synthesized `head($clos)` tag test resolved to the user's
`head`. Measured at 3246742: reference 5, λ 5, TM 3.

## `crates/redextape-core/src/tm/encoding/binary.rs`, above `let l = format!("bmul{entry}");`

CORRECTION: an earlier version of this comment claimed O(width) states and "several
hundred" at width 64. Both the exponent and the magnitude were wrong. Counting every
`b.state()` call across `zero_field`/`shift_left_acc`/`bit_is_one`/`ripple_add`/
`copy_field`, for this test harness's `ra=0, rb=1, rd=2` slot layout, gives the
measured closed form `1.5*w^2 + 26.5*w + 13` (a fit for this specific three-slot
shape, not a universal constant): 143 states at width 4, 821 at width 16, and 7,853
at width 64 for a single `Mul` instruction — thousands, not "several hundred". A
known trade regardless.

## `crates/redextape-core/src/tm/lower_asm.rs`, above `const MAX_LOWER_DEPTH: u32 = 580;`

Empirically, an unguarded `lower_into` overflows the 8 MiB stack at a recursion depth of ~1175 (measured in both debug and coverage-instrumented builds by lowering list literals of increasing length until the native stack aborts; a `lower_into`/`lower_inner` frame is fatter than an `eval` frame, so this crashes shallower than `interp::MAX_EVAL_DEPTH`'s reference point).

## `crates/redextape-core/src/tm/lower_tm.rs`, above `pub(crate) const MAX_MUL_INSTRS: u32 = 32;`

— measured `1.5*width^2 + 26.5*width + 13` states for the gadget alone: 143 states at width 4, 7,853 at the 64-cell ceiling (`MAX_FIELD_WIDTH`)

: measured at width 64, a chain of 32 `Mul`s costs 616,999 states / ~421 MB under `Binary` and only 12,411 states / ~10 MB under `Unary`; 128 `Mul`s cost 6,842,311 states / ~4.6 GB under `Binary` and 178,635 states / ~129 MB under `Unary`

## `crates/redextape-core/src/tm/one_way.rs`, above `const STATE_CEILING: f64 = 40.0;`

, and folded to 7,363,253 states against `MAX_MACHINE_STATES` of 1,000,000 when measured on 2026-09-13, before the reductions had a state ceiling.

## `crates/redextape-core/src/tm/reduction.rs`, above `#[test]`

Peak RSS of this test alone, as the release test binary's `ru_maxrss`: 722,860 KB, in 2.4 s.

## `crates/redextape-core/src/tm/reduction.rs`, above `#[test]`

Peak RSS of this test alone, as the release test binary's `ru_maxrss`: 675,104 KB, in 2.0 s.

## `crates/redextape-core/src/tm/reduction.rs`, above `#[test]`

Unguarded, [`worst_shipped_demo`] builds 1,811,054 states through stage 1, 2,601,972 through stage 2
applied to the lowered machine, and 7,363,253 through the fold
(`docs/superpowers/specs/2026-09-14-reduction-state-guard-design.md`), so each stage fills its table
to the ceiling before it refuses.

Peak RSS of this test alone, as the release test binary's `ru_maxrss`: 746,100 KB, in 2.3 s.

## `crates/redextape-core/src/tm/reduction.rs`, above `#[cfg(test)]`

confirmed by getting the identical 49,135 states back, where

and only 12,295 states for this same program

(single-tape ratios measured 28.29 at the auto-fitted width against 39.51 at `MAX_FIELD_WIDTH`, before the no-write split in `single_tape.rs`'s `emit_one_tape_pass`)

## `crates/redextape-core/src/tm/single_tape.rs`, above `#[test]`

MEASURED (inverting this test's assertion once, via `cargo nextest run -p redextape-core
the_worst_shipped_demo_measured_directly -- --nocapture`), `Binary` at `MAX_FIELD_WIDTH`:
49,135 original states throughout (Step 1 changes only how the single-tape image is built, not
the multi-tape machine being reduced), BEFORE Step 1's split **39.51** states per original state
(1,941,089 single-tape states, 1.94x the 20.35 budget), AFTER **36.86** (1,811,054 single-tape
states, 1.81x the budget) — worse than `sum(5)`'s 21.20 either way, and over budget both before
and after. Step 1's saving is real (130,035 fewer states, 6.7%) but nowhere near enough on its
own to close a 1.8x gap; closing it needs shrinking the construction further, raising
`MAX_MACHINE_STATES`, or lowering the worst-shipped-demo floor, none of which this task does —
see this test's own non-assertion below for why that is recorded rather than forced green.

That `cargo nextest run` command no longer selects this test, which is now ignored; re-running it
needs `--run-ignored only`.

Peak RSS of this test alone, as the test binary's `ru_maxrss`: 1,264,160 KB in 4.3 s in the binary
`cargo test -p redextape-core --lib --no-run` builds, and 1,262,508 KB in 3.2 s in the one
`cargo test --release -p redextape-core --lib --no-run` builds, each run with this test's name and `--exact`.

## `crates/redextape-core/src/tm/single_tape.rs`, above `#[test]`

MEASURED (inverting this test's assertion once, via `cargo nextest run -p redextape-core
real_lowered_machines_cost_far_more_than_the_toy_fixtures`), under `EncodingKind::Unary`, BEFORE
and AFTER Task 5b's no-write split in `emit_one_tape_pass`:

| source | original states | rules | rules/state | ratio BEFORE | ratio AFTER |
| --- | --- | --- | --- | --- | --- |
| `1 + 2 * 3` | 143 | 315 | 2.20 | 19.22 | 17.51 |
| `cons(1, cons(2, nil))` | 146 | 309 | 2.12 | 18.75 | 17.09 |
| `fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)` | 1182 | 2782 | 2.35 | 21.20 | **19.20** |

**THE LAST ROW IS THE DESIGN DOC'S OWN `sum(5)` FIXTURE** (1,182 states, 2.35 rules/state,
0.94 reads/rule — identical to its table). Before Task 5b it measured 21.20, over the 20.35
budget; AFTER Task 5b's split it measures 19.20 — UNDER budget on its own. That doc's formula
estimated this same machine at 7.75 states per original state and called the margin "roughly
2.5x inside" the budget; even the improved construction (this module) measures 19.20 for it,
2.5x higher than the estimate, for the same reason as before: the formula counted the check and
apply states and not the scan, rewind, fail and seek states this module also emits.

**ALL THREE `SOURCES` ROWS GET A REAL CEILING ASSERTION BELOW, THREE WITNESSES RATHER THAN ONE**
— an earlier version of this doc gated `sum(5)` alone and said no sabotage measurement showed
the other two rows were sensitive enough; that was never re-checked, and it is false. The
toy-fixture gate above (`the_construction_stays_inside_the_state_budget`) is too small to catch
a regression in the wildcard skip `emit_candidate` documents as "the whole reason this
construction fits". A sabotage that deletes that skip — emitting a `chk` state for every read
position instead of only `Some(_)` reads — moves the three toy fixtures from 3.00/3.67/7.50 to
4.00/4.67/8.00: all three stay far under the 20.3521 ceiling, so that gate DOES NOT REDDEN. The
SAME sabotage, measured directly rather than assumed, moves EVERY `SOURCES` row across the
ceiling: `1 + 2 * 3` from 17.51 to **26.49**, `cons(1, cons(2, nil))` from 17.09 to **25.77**,
`sum(5)` from 19.20 to **28.76** — and the worst shipped demo from 36.86 to 46.43 (already over
budget before the sabotage, so not a NEW crossing). All three `SOURCES` rows are sensitive to
this regression, so all three carry the assertion, not `sum(5)` alone.

**THE MARGIN AGAINST THE CEILING IS TIGHTER THAN THIS DOC USED TO SAY, AND `sum(5)` IS NOT THE
TIGHTEST CASE ON RECORD.** `sum(5)`'s margin is 5.65% (19.2014 against 20.3521 — the same figure
this doc used to round to "~5.6%" against a rounded 19.20). Two related first-order fixtures,
measured the same way, sit far closer to the edge — MEASURED (via a temporary block added to
this test's `SOURCES` loop, run with `cargo nextest run -p redextape-core
real_lowered_machines_cost_far_more_than_the_toy_fixtures --nocapture`, then removed), under
`EncodingKind::Unary`:

- `let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc` — 542 original
  states, ratio **20.3395**, margin +0.062% against 20.3521
- `fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)`
  — 1,365 original states, ratio **20.1480**, margin +1.003% against 20.3521
- `fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)` — 1,182 original states, ratio
  19.2014, margin +5.654% against 20.3521

## `crates/redextape-core/src/tm/single_tape.rs`, above `#[test]`

MEASURED (inverting this assertion once, via `cargo nextest run -p redextape-core the_construction_stays_inside_the_state_budget`): `wildcard_only` 3.00, `two_candidates` 3.67, `rewrite_ones` 7.50 — all comfortably inside the 20.35 budget, UNCHANGED by Task 5b's no-write split in `emit_one_tape_pass` (`rewrite_ones` has a concrete write on its only acting tape; the other two have no acting tape at all — none of these three fixtures ever exercises the no-write arm).

## `crates/redextape-core/src/tm/single_tape.rs`, above `fn emit_one_tape_pass(&mut self, sid: StateId, c: usize, i: usize, rule: &Rule, after: Sta`

Measured on `real_lowered_machines_cost_far_more_than_the_toy_fixtures`'s three `SOURCES`, `rule.write.get(i)` is `None` for 87-91% of acting-tape passes there:

the worst shipped demo (`the_worst_shipped_demo_measured_directly` below) measures only 53% no-write against 1.71 acting tapes per rule — nearly double the acting-tape rate and roughly half the no-write share of the three `SOURCES` machines, which is why this split's saving on that machine (6.7%, see that test's doc) falls well short of what the `SOURCES` figure alone would suggest.

Either way, the old unconditional shape emitted `wr{i}` and stepped right onto the content cell and back left onto the marker even when `write` was `None` — a whole state and two steps spent producing no effect.

## `crates/redextape-core/src/tm/single_tape.rs`, above `let after_fail = if c + 1 < n_rules {`

Corrects a prior claim of mine that such states "do not touch the state budget": measured by BFS reachability over the built `Machine` (following every rule's `next` from `start`), unreachable states are **1.25%-2.65%** of every real first-order lowered image measured (`1 + 2 * 3`, `cons(1, cons(2, nil))`, `sum(5)`, `count_down(4)`, the `while`-loop program in `real_lowered_machines_cost_far_more_than_the_toy_fixtures`'s doc) — exactly one `fail` plus one `stuck` per state whose last rule is an all-wildcard catch-all — and a smaller **0.46%** of the worst shipped (higher-order) demo. Pruning them would take `sum(5)` from 19.2014 to **18.8866** states per original state, and the worst shipped demo from 36.8587 to **36.6878** — real, but nowhere near enough alone to close either gap against `CEILING`. NOT IMPLEMENTED: recorded here, not acted on, so a future roadmap entry can cite the measurement without re-deriving it.

## `crates/redextape-core/src/tm/syntax.rs`, above `const NAV_TM: &str = "tapes 1\nstart scan\nstate scan:\n  [1] -> write [*], move [R], goto`

Probed at `64c1164`: parses clean, and `scan` appears at 14, 25 and 66 while `halt` appears at 106 and 117.

## `crates/redextape-core/src/tm/syntax.rs`, above `#[test]`

The parser used to accept them anywhere, so this file parsed clean.

— which is exactly why enforcing was cheap NOW and would not have been later: every file written against the looser parser is one a stricter parser breaks

## `crates/redextape-core/src/tm/two_symbol.rs`, above `fn emit_apply(&mut self, m: &Machine, code: &Code, sid: StateId, c: usize, rule: &Rule) ->`

Stage 1 had to split its no-write path out as an optimisation worth ~9% of its state count; here it falls out of the layout.

## `crates/redextape-core/src/trace.rs`, above `pub struct LambdaCheckpoints {`

(a whole-term print of every `fact(4)` step is 99 MB)

## `crates/redextape-core/src/trace.rs`, above `use crate::lambda::reduce::{MAX_TERM_DEPTH, Owner, depth_exceeds, reduce_step};`

, measured at 3,488 bytes/step and 592.9 MB for `sum(5)` — row 7 of the demo suite

, measured maximum length 30

## `crates/redextape-core/src/trace/zipper.rs`, above `use std::rc::Rc;`

: 29.2% of every allocation the reducer makes and 36.2% of fitted time,

## `crates/redextape-core/src/typeck.rs`, above `fn infer_fn_run(&mut self, env: &mut TyEnv, fns: &[Stmt]) {`

This is a DELIBERATE LANGUAGE CHANGE: before mutual recursion, `fn a … fn a …` was legal and the last definition simply won, because each `fn` was bound in turn.

## `crates/redextape-core/src/value.rs`, above `pub const MAX_PRINT_NODES: usize = 20_000_000;`

Until the decoder memoized, the decode budget refused such a value before the printer could see it; it no longer does, and this is the replacement for the half of that guard that was lost.

## `crates/redextape-core/src/viewmodel.rs`, above `pub tm_owner: Vec<i32>,`

the difference between 143 KB and 26,484 objects for `list60`

## `crates/redextape-core/src/viewmodel.rs`, above `#[derive(Clone, Debug, PartialEq, Eq, Default)]`

a per-step tree cost 850 MB against a 32 MB ring, and this costs

## `crates/redextape-core/src/viewmodel.rs`, above `#[must_use]`

(`FRAME_BYTES`, measured at 555 steps on `map_fold`)

Measured with `frame_cost_probe` before and after, same machine, section D (`FRAME_BYTES = 512`): render cost rose **+20% to +75%** per step — `map_fold` 3.92 → 5.74 µs, `while4` 4.41 → 5.46, `sample` 3.31 → 5.81 — while the β-step itself was unchanged (`while4` 0.46 → 0.46).

## `crates/redextape-core/src/viewmodel.rs`, above `#[cfg_attr(feature = "serde", serde(with = "tape_windows"))]`

For `map`/`fold` over three elements, 78,459 frames of 85 cells, measured in node on the release wasm: building them took 501 to 519 ms, and the structured clone that carries them from the worker to the page 227 to 235 ms to write and 199 to 208 ms to read, 44.1 MB in all (2026-10-06). As a string a tape, from a throwaway build that wrote the same shape and from this one: building 185 to 203 ms in five runs, writing 49 to 55 ms and reading 58 to 59 ms in three, 20.7 MB (2026-10-06 and 07). A full TM history in Chromium retained 68,637,886.67 bytes of heap, and retains 29,342,720.67 (`HISTORY_BYTES`'s doc).

## `crates/redextape-core/src/viewmodel.rs`, above `#[cfg_attr(feature = "serde", serde(skip))]`

a ~9.3-element array of

## `crates/redextape-core/src/viewmodel.rs`, above `#[derive(Clone, Debug, PartialEq, Eq)]`

NO `redex` FIELD, DELIBERATELY. §4.2 lists one, and nothing in this PR can fill it: a redex is a
`Path` INTO THE TERM, while highlighting it in `text` needs a byte SPAN, and correlating the two
means the printer recording where a given path lands as it walks — real work in
`print_lambda_capped`, touching every recursive arm of `write_term`, and not part of this task.

Shipping the field as a structural `None` would be the exact defect `node_to_source` was built to
remove: a consumer could not distinguish "no redex here" from "not implemented". The field is
omitted until something can populate it, which is the same call already made for
`TmState.source_node` below. Adding it later is not a breaking change, because nothing consumes
these types yet.

NO `source_node` FIELD EITHER, ANYMORE — REMOVED, NOT LEFT `None`, FOR THE SAME REASON ABOVE ONE
LAYER WORSE. This field shipped briefly, resolved by `owning_node` from a caller-supplied redex
`Path`. It was right for exactly the first β-event and confidently wrong for every one after:
`SourceMap::node_to_lambda` records paths root-relative into the INITIAL lowered term, while
normal-order reduction contracts root redexes, so a `Beta` event's redex path at step N > 1 indexes
a structurally different tree — the coordinate system `node_to_lambda` speaks in has stopped
existing. `owning_node` could not detect this: the root is recorded at the empty path, the empty
path is a prefix of every path, so it always found a match. Measured on `let x = 40; x + 2`, all
seven steps reported the same node, "let x = 40;"; `x + 2` was never named.

`render` no longer takes `map` or `redex`; they existed only to compute this field.

## `crates/redextape-core/src/printer.rs`, above `assert_formats_and_reparses(`

The misattribution appears at `9005c44`, the nested-break rule: until that landed, `bracketed`
accepted the half-broken hybrid, these lists never broke vertically, and the flush path
below was unreachable.

## `crates/redextape-core/src/tm/syntax.rs`, above `#[test]`

Every file written before this slice looks like this one.

## `crates/redextape-core/Cargo.toml`, above `serde = { version = "1", features = ["derive"], optional = true }`

THE CRATE'S FIRST DEPENDENCY, AND IT IS OPTIONAL ON PURPOSE.

so it is admissible under the rule that gate replaced ("dependencies are admissible; the gate decides", PR #10).

which is no longer the guarantee but costs nothing to keep true.

there is a second consumer coming: Plan 6's CLI wants them and cannot depend on a cdylib.

## `crates/redextape-core/src/analysis.rs`, above `let malformed = classify_source("let x = @@@;");`

This second half was held ONLY by the wasm crate's `the_free_exports_need_no_session` browser test, and went with it when Plan 7 part 3b deleted the `classifySource` export. This test did not hold it: it discarded its own result (`let _ = classify_source(...)`), which asserts no-panic and nothing about the tokens surviving. Restored here, which is where the property belongs.

## `crates/redextape-core/src/desugar.rs`, above `assert_eq!(`

The one intended, observable behaviour change of this pass.

these three all yielded 30 before and yield 3 now.

This is desugar catching up to `typeck::infer_fn_run` (Task 1), which already binds the whole run before checking any body

Not observable at Task 2 — the grouping in this file is what makes it visible.

## `crates/redextape-core/src/hover.rs`, above `let g_line = LABELED.lines().position(|l| l == "g:").expect("fixture holds it") + 1;`

THE OLD TEST PROVED NOTHING ABOUT THE LOCATION. It hovered a DEFINITION (`PROGRAM`'s `f:`), whose title is `label f` — `text(&a).contains('f')` passed off that title alone, with `lines` never read, so an answer of `lines: vec![]` for `Role::Definition` would have satisfied it exactly as well as `"Defined here."` does.

## `crates/redextape-core/src/lambda/lower.rs`, above `Ok((term, origins.pairs))`

A SHARING GUARD USED TO RUN HERE, at the end, as the deliberate mirror of `too_deep_node` at the start. It was reverted — see the note above `LowerError` —

## `crates/redextape-core/src/lambda/syntax.rs`, above `assert_eq!(`

Task 6 found the weaker style vacuous:

## `crates/redextape-core/src/printer.rs`, above `let wide = "a".repeat(130);`

same shape as the reviewer's reproduction with the comment removed

## `crates/redextape-core/src/printer.rs`, above `assert_formats_and_reparses("xs.a(1) // note\n.b(2)", "xs\n    .a(1) // note\n    .b(2)\n"`

The reviewer's other half of the finding: the CURRENT bug forces a two-link chain that would otherwise fit on one line into the full vertical form even when the only thing that actually needs a break is the comment's own end-of-line.

## `crates/redextape-core/src/tm/asm.rs`, above `unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, new_size: usize) -> *mu`

That default was live here for every one of this binary's 685 tests, not just this one — every in-place `Vec`/`String` growth anywhere in `redextape-core`'s lib tests was silently paying for a fresh allocation and a copy it would not have paid running under `System` alone, which is also most of why the noise floor a shared-process counter saw ran to hundreds of KB.

## `crates/redextape-core/src/tm/asm.rs`, above `#[test]`

including a chain long enough that the old recursive shape was the only thing under test.

## `crates/redextape-core/src/tm/asm.rs`, above `let named: Vec<(&str, TokenClass)> = spans.iter().map(|(s, c)| (&text[s.start..s.end], *c)`

ASSERT THE WHOLE ORDERED SEQUENCE. Every weaker form has now failed on this branch.

which is how the `Nat` arm went untested: mutating `Operand::Imm => Nat` to `Register` was caught by no test in the suite.

## `crates/redextape-core/src/tm/defunc.rs`, above `#[test]`

FIX 2 (Task 7 review):

## `crates/redextape-core/src/tm/defunc.rs`, above `#[test]`

FIX C1 (Task 7 whole-branch review — the SAME contract hole as the param case, one rung up):

so the original guard let this through; the fix unions `func_names` into the clash set.

## `crates/redextape-core/src/tm/defunc.rs`, above `#[test]`

FIX 1 (Task 7 review — the contract hole):

## `crates/redextape-core/src/tm/defunc.rs`, above `fn param_names(core: &Core) -> BTreeSet<String> {`

Plan 3b-2 (Task 7 fix):

## `crates/redextape-core/src/tm/lower_tm.rs`, above `#[test]`

sits at ~79% and

(it would only dip to ~77%)

## `crates/redextape-core/src/tm/syntax.rs`, above `let want_crlf = ["abc", "abc", "abc", "abc", "abc", "def", "def", "def", "def", "def", "de`

exactly the holes Finding 1 reports, where the old guard compared against the trimmed span's end and returned `None` outright instead of resolving to the line the terminator belongs to.

## `crates/redextape-core/src/tm/syntax.rs`, above `let src = "tapes 1\nstart a\nstart b\nstate a: accept\nstate b: accept\n";`

took opposite decisions until this was fixed: `state` recorded both, `start` recorded neither, because its `nav.push_reference` sat inside the `else` of the duplicate check.

## `crates/redextape-core/src/trace/zipper.rs`, above `#[test]`

**`term()`'s fold direction, which Task 1's test structurally could not reach** — it only ever had an empty stack, so a reversed fold would have passed it. Now that `descend_to_redex` can build a non-trivial stack, use it:

## `crates/redextape-core/src/trace/zipper.rs`, above `self.focus = self.term();`

and Task 5 is what stops calling it every step.

getting it backwards here was the Critical finding this file's history remembers.

## `crates/redextape-core/src/printer.rs`, above `assert_formats_and_reparses("\n\n// only", "// only\n");`

Before the fix this reproduced byte-for-byte as `"\n\n// only\n"`,

## `crates/redextape-core/src/printer.rs`, above `assert_formats_and_reparses(`

Before the fix this reproduced byte-for-byte as `"let xs = [1, 2]; // trailing\n\nlet y = 3;\ny\n"`.

## `crates/redextape-core/src/trace/zipper.rs`, above `Frame::AppL { arg, owner, .. } => {`

an earlier draft used
`std::mem::replace` here and then read `self.focus` inside the `push` call, which
both double-moved and failed to borrow-check.

## `crates/redextape-core/src/tm/defunc.rs`, above `if let Some(&tag) = self.tags.get(name) {`

the bug this reorder closes (measured: TM `HitCap`
where reference and λ both agree on a value).

## `crates/redextape-core/src/lambda/term.rs`, above `s.clone()`

That single line is a large share of the win.

## `crates/redextape-core/src/lambda/lower.rs`, above `#[derive(Clone, Debug, PartialEq, Eq)]`

the
falsifications in `docs/superpowers/specs/2026-07-31-lambda-shared-subterm-guard-design.md` §10
(whose quantities stand and whose timings do not)

## `crates/redextape-core/src/lambda/lower.rs`, above `#[test]`

A 699-element list literal is ~497,691 logical nodes

## `crates/redextape-core/src/lambda/reduce.rs`, above `#[must_use]`

on a path measured at mean 9.3 and max 30.

## `crates/redextape-core/src/lambda/reduce.rs`, above `#[must_use]`

for a 1.41–1.43x (glibc) win

## `crates/redextape-core/src/lambda/reduce.rs`, above `#[must_use]`

the spine rebuild `reduce_step` pays per step — **1.41–1.43x (glibc) on the corpus,

## `crates/redextape-core/src/lambda/syntax.rs`, above `#[test]`

It could not:
`lower.rs` binds store-passing state under `$store`, and the lexer below accepted only `_` and
ASCII alphanumerics, so `parse_lambda` rejected `print_lambda`'s output — with `expected a
parameter name` — for every program with mutable state. `parse_print_round_trips` missed it
because its generator only ever emitted the hints `v` and `x`.

## `crates/redextape-core/src/lambda/term.rs`, above `App(LambdaTerm, LambdaTerm, Option<NodeId>),`

Putting the
tag on the `LambdaTerm` handle instead, which the two existing `u32`s suggest by analogy, costs
16 bytes per node and 8 per handle on a 64-bit host — worse on every target measured so far.

## `crates/redextape-core/src/lambda/term.rs`, above `#[must_use]`

a 699-element list literal is ~497,691 logical nodes

## `crates/redextape-core/src/lambda/term.rs`, above `let deep = app(abs("x", abs("y", app(var(1), var(1)))), arg.clone());`

while moving
`tests/lambda_sharing.rs`'s gates by 184 and 3 allocations. That variant was built and run;

## `crates/redextape-core/src/lib.rs`, above `#[test]`

Verified by sabotage, not reasoned about: deleting
the bindings drain from `take_core_children`'s `LetRecGroup` arm aborts THIS test alone with
a stack overflow while the twin still passes, and deleting the `body` unlink instead aborts
the TWIN alone while this one still passes.

## `crates/redextape-core/src/binder.rs`, above `#[test]`

Every fixture in this module was run through `parse_recovering` before being written down.
Three earlier candidates did not hold the property their test asserted — see the design's
§9.

## `crates/redextape-core/src/counter/accel.rs`, above `use crate::counter::nat::{Divisor, Nat};`

a stage 1 image of `3 - 5` reports about 10^380 literal steps.

## `crates/redextape-core/src/counter/godel.rs`, above `use crate::counter::program::{Instr, MAX_LITERAL_INSTRS};`

A stage 1 image of `3 - 5` has a counter of 1,253 bits, whose `A` would need about 10^377 bits to
store; a unary incrementer on four marks takes 2,974,863 two-counter steps.

## `crates/redextape-core/src/printer.rs`, above `if flushed {`

`must_break` asks whether a comment starts inside `region`; by the time this runs the cursor may have
already passed it (flushed from an enclosing sibling's overrun — see `vertical_rows`'s `close` clamp).
Indenting unconditionally then pushed four columns of whitespace between `open` and `close` with nothing
between them to justify it.

## `crates/redextape-core/src/printer.rs`, above `fn vertical_rows(&mut self, items: &[Expr], trailing_comma: bool, close: usize) {`

`contains_comment` is position-based, so the construct the comment actually belonged to still sees it in
its own span and forces a break for a comment `flush_before` has already emitted elsewhere — a break with
nothing left to flush, present on pass 1 and gone on pass 2 once the comment has moved.

## `crates/redextape-core/src/printer.rs`, above `fn contains_comment(&self, span: Span) -> bool {`

§17: this is what let `vertical_rows`'s stale-boundary bug (see its `close` parameter) turn into a spurious
break instead of a silent one — the two only agree once both ask where the CURSOR is.

## `crates/redextape-core/src/printer.rs`, above `let src = "[1, 2, 3].map(aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd, eeeeeeeeee, ffffffffff, \`

Reproduction for the `line_start`/`out` desync: `postfix_chain` saves `mark` before the
base, prints the base plus every link inline, and truncates back to `mark` if that overran
— but only `bracketed`'s two post-truncate paths call `newline()` before anything reads
`col()`. `postfix_chain` calls `expr_prec` on the base FIRST, with no intervening
`newline()`, so if that base is itself bracketed (a list here), `bracketed` computes
`self.col()` unconditionally before deciding whether IT needs to break, using whatever
`line_start` the truncated-away text left behind.

`.map(...)`'s own argument list is wide enough to overflow on its own (a) — `args` breaks
internally and calls `newline()`, advancing `line_start` past `mark`. That makes the whole
chain's inline attempt contain a newline, so `postfix_chain` truncates back to `mark`
without restoring `line_start`, then reprints the base — a list literal (b) — whose
`bracketed` call reads `col()` before any `newline()` of its own. `line_start` (left
pointing partway through the now-truncated argument list) exceeds `out.len()` (rewound to
`mark`), so `out.len() - line_start` underflows.

## `crates/redextape-core/src/printer.rs`, above `assert_formats_and_reparses(`

`contains_comment` then still found the comment sitting inside the tail list's own span
(position-based against the source, not cursor-based against what has actually been
emitted), so it forced a break for a comment that had already been printed somewhere else —
present on pass 1, gone on pass 2 once the comment had genuinely moved.

## `crates/redextape-core/src/printer.rs`, above `assert_formats_and_reparses(`

`must_break` still fired (the same position-based `contains_comment`, oblivious to the comment having
been flushed already), and the empty-bracket branch called `indent()` unconditionally inside
`if must_break`, ignoring the `bool` `flush_before` returns for exactly this case — so with nothing left to
flush, `indent` ran straight after the open bracket with no newline before it.

## `crates/redextape-core/src/tm.rs`, above `#[allow(clippy::needless_pass_by_value)]`

Narrowing this parameter to `&Ty` does NOT silence the lint — it spreads it. `describe_at` would
then take `&Ty` and clone internally, which leaves this function still flagged AND flags
`run_tm_described_at` too: two errors where there was one. It would also churn four owning call
sites outside this function — `emit_tm` in the CLI, `compile` in the WASM session,
`printed_machine_with_header` in the grammar-check crate, and this crate's own tests and
examples — for a lint's sake alone.

Probing for the width with a bare `attempt` and building the `DescribedRun` once afterwards DOES
compile clean with no allow. It pays for that by running `attempt` — the real TM simulation —
TWICE at the winning width, where this shape runs it once per width plus a `Ty::clone`. Doubling
simulation cost on the common no-retry path is not a free win in a crate whose own probes record
an 8.6-million-state machine costing 6.0 GB. The clone is the cheaper of the two.

So the allow is a deliberate trade, not an unexamined one. Anyone reopening it should re-measure
rather than re-argue: the reason it stands is a cost, and costs move.

## `crates/redextape-core/src/tm.rs`, above `#[test]`

and it is sabotage-verified: adding a ONE-SIDED
width dependence to `Binary::decode_nat` (`if n > self.width { return None }`) is accepted by
the default reader (64) AND by the fitted reader (8), and is caught ONLY by `read at 4`.

## `crates/redextape-core/src/tm.rs`, above `#[test]`

a million-plus asm instructions from real source
would need only a ~2-3 MB file (`code.len()` is a lower bound on the state count, and
`state_cost_probe.rs`'s generators run ~2-3 source bytes per instruction) — but
`parser::MAX_TOKENS` (100,000) caps `code.len()` at ~50,000 instructions, even for the
depth-unbounded balanced-tree shape that spends its whole token budget on instructions, a
~950,000-instruction gap below `MAX_MACHINE_STATES`

`MAX_MACHINE_STATES` instructions of source would
be a ~2-3 MB file that the front door refuses to parse anyway (see above)

## `crates/redextape-core/src/tm.rs`, above `#[test]`

`usize::MAX` reached
`Unary::init_reg` and aborted the process on a `capacity overflow` — the workspace manifest's
"no library path may panic" rule, broken by an entry point that took the width from a caller
and never bounded it.

because that is the value that actually panicked.

## `crates/redextape-core/src/tm/attribute.rs`, above `if let Some(reg) = init.get_mut(REG) {`

so attribution reported `sum(5)` under `Binary` as a
COMPLETE 329-step execution when the real run is three orders of magnitude longer.

## `crates/redextape-core/src/tm/attribute.rs`, above `pub fn attribute_at(src: &str, enc: &dyn Encoding) -> Result<Attribution, LowerError> {`

with the `b·W` term at 91–97% of the total at width 64.

## `crates/redextape-core/src/tm/attribute.rs`, above `const CASES: [&str; 5] = [`

`sum(5)` alone costs
~178k steps of a 5,000,000 cap

## `crates/redextape-core/src/tm/attribute.rs`, above `#[test]`

Both mutants were applied and both
left all the other tests green; this assertion is what fails.

## `crates/redextape-core/src/tm/attribute.rs`, above `#[test]`

Two mutants motivate it, both of which left the ENTIRE rest of the suite green and both of
which move the survey's headline pass ranking:

## `crates/redextape-core/src/tm/attribute.rs`, above `#[test]`

Before `lower_mapped` deferred to `lower_tm_mapped`'s own `Option`,
mirroring only the `MAX_SLOTS` one made this program — which really does exceed `MAX_FRAME_LOC`,
3,315 states of which 0 were mapped — attribute as `{ histogram: {}, total: 0, capped: false }`:
a program that never ran, reported as one that ran and cost nothing.

## `crates/redextape-core/src/tm/attribute.rs`, above `#[test]`

three of these four cases halt in ZERO
steps

## `crates/redextape-core/src/tm/attribute.rs`, above `#[test]`

relocate WHOLESALE from `ClosureScaffold(25)` to
`Node(16)`

## `crates/redextape-core/src/tm/build.rs`, above `pub const MAX_MACHINE_STATES: usize = 1_000_000;`

`cargo run --release --example state_cost_probe -p redextape-core` re-derives most of them.

To re-derive them, raise this constant temporarily (one line) and re-run the probe under a memory
cap — the second row needs more than 8 GB, and being killed IS the measurement.

## `crates/redextape-core/src/tm/build.rs`, above `#[test]`

It allocates the full ceiling in rule-less
states with a 1-char name — a `Vec<State>` of 1,000,000 entries at `size_of::<State>()` = 56
bytes is 56 MB, plus 1,000,000 one-byte heap `String`s at glibc's 32-byte minimum chunk (~32
MB), so ~90 MB and a second or two — still far cheaper than the ~727 bytes a real state (name
plus `Vec<Rule>`, as `lower_tm` produces) costs — see `MAX_MACHINE_STATES`. This runs in the
DEFAULT (fast) tier, in parallel under `cargo nextest`, alongside
`overflow_does_not_cache_a_refused_allocation` below (another ~90 MB) and two
`vec![Instr::Halt; MAX_MACHINE_STATES + 1]` allocations elsewhere in the same tier (`tm.rs`,
`tests/guard_counterexamples.rs`, ~40 MB each) — it is the fast tier's COMBINED peak that
matters for a memory budget, not any one of these tests' number alone.

## `crates/redextape-core/src/tm/build.rs`, above `#[test]`

~90 MB (56 MB `Vec<State>` + ~32 MB of
one-byte heap `String`s at glibc's 32-byte minimum chunk) and a second or two

## `crates/redextape-core/src/tm/defunc.rs`, above `#[test]`

Measured over all six pairings:

| pairing | `p(4, id)` | `p(5, id)` |
|---|---:|---:|
| correct | **20** | **32** |
| rotate | 24 | **32** ← invisible |
| rotate the other way | 51 | 62 |
| swap first two | 32 | 44 |
| swap last two | 27 | 35 |
| swap outer two | 51 | 62 |

At `p(5, id)` one of the two rotations returns **exactly the correct answer**, so this test
stayed green under the n-ary-only mispairing it exists to catch — only the rotation that
degenerates into a self-loop showed, which is the one Task 6 happened to try. At `p(4, id)`
every non-identity pairing differs.

## `crates/redextape-core/src/tm/encoding/unary.rs`, above `fn assert_guards_are_first(body: impl FnOnce(&mut Builder, StateId, StateId)) {`

MEASURED, because the spec claimed more for this layer than it delivers: moving
`append_work_to_field`'s guard to the end of its state turns this test red, but it turns the
BEHAVIOURAL test (`a_computed_value_that_does_not_fit_is_reported`) red too, because the loop
rule that then shadows it matches on the very inputs the behavioural test uses. So this layer is
NOT catching a silent disable that behaviour would miss, at least for the guards as currently
written.

## `crates/redextape-core/src/tm/lower_asm.rs`, above `const MAX_LOWER_DEPTH: u32 = 580;`

so an artificially tiny 512 KiB thread would overflow at depth ~90 — long before the guard
fires.

## `crates/redextape-core/src/tm/lower_tm.rs`, above `if b.overflowed() {`

2,000
`Box` instructions are ~1.1M states from a 2,001-instruction program

## `crates/redextape-core/src/tm/single_tape.rs`, above `fn emit_candidate(&mut self, m: &Machine, sid: StateId, c: usize, n_rules: usize, rule: &Rule) {`

(81% of read positions are wildcards on the design
spec's real lowered machines). **THAT SHARE IS NOT UNIVERSAL, THOUGH** (same caveat as
`emit_apply`'s tapes-per-rule figure, for the same reason — a different triple of machines):
the worst shipped demo (`the_worst_shipped_demo_measured_directly` below) measures only **66.0%**
wildcard read positions.

## `crates/redextape-core/src/tm/single_tape.rs`, above `fn emit_apply(&mut self, m: &Machine, sid: StateId, c: usize, rule: &Rule) -> StateId {`

Measured
on the design spec's three real lowered machines (`sum(5)`, `count_down(4)`, `[1, 2, 3]`), that
is 0.91-0.94 tapes per rule — essentially one — which is why a pass per acting tape costs what a
single pass would. **NOT the same triple this file's own tests measure**:
`real_lowered_machines_cost_far_more_than_the_toy_fixtures`'s three `SOURCES` (`1 + 2 * 3`,
`cons(1, cons(2, nil))`, `sum(5)`) measure 0.87, 0.90 and 0.93 tapes per rule respectively — a
nearby but different range, since it is a different triple of machines.

## `crates/redextape-core/src/tm/single_tape.rs`, above `#[test]`

Under the same wildcard-skip sabotage, `single_tape_oracle.rs`'s
`the_single_tape_leg_agrees_on_small_programs` still PASSES — verified directly, not assumed

`sum(5)`'s 5.654% (and the other two `SOURCES` rows' 13.96% and 16.03%) is thin but wide enough
that the one change that already moved this construction the other way (Task 5b's no-write
split, 21.20 -> 19.20) did not cross it.

## `crates/redextape-core/src/tm/syntax.rs`, above `fn header_position(key: &str, states: &[RawState]) -> Result<(), String> {`

The grammar has always said directives "must precede the first `state`", and the parser has always
accepted them anywhere — a divergence that only gets more expensive with age, because every file
written in the meantime that violates the stated grammar is one a later, stricter parser breaks.
The printer emits them in position unconditionally, so no file this project produces is affected;
enforcing now costs nothing and closes the gap while that is still true.

## `crates/redextape-core/src/tm/two_symbol.rs`, above `const STATE_CEILING: f64 = 30.0;`

which stage 1 learned
by putting a program with a 0.062% margin inside its gated set — a PERCENT margin, which does
not say how many states that was.

## `crates/redextape-core/src/trace/zipper.rs`, above `use std::rc::Rc;`

the largest single allocating traversal in the corpus.

## `crates/redextape-core/src/viewmodel.rs`, above `use std::borrow::Borrow;`

the `map` demo is 3,203
states and 344,999 steps, so that would re-send 3,203 states 344,999 times.

## `crates/redextape-core/src/viewmodel.rs`, above `#[cfg_attr(feature = "serde", serde(with = "span_words"))]`

As
`[{start, end}, "Class"]` tuples, about 300 a frame, they were most of what a λ frame cost to build and to copy.

## `crates/redextape-core/src/viewmodel.rs`, above `#[cfg_attr(feature = "serde", serde(with = "tape_windows"))]`

and as an array of one-character strings a tape this field was most of what a frame cost.

## `crates/redextape-core/src/viewmodel.rs`, above `#[must_use]`

Microseconds in absolute
terms

## `crates/redextape-core/src/tm/attribute.rs`, above `#[test]`

and leaves every other test green

## `crates/redextape-core/src/trace/zipper.rs`, above `#[test]`

Deleting `climbs += 1` from both arms in `advance` passes every other test in this tree
