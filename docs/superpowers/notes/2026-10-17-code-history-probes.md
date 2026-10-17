# Code history moved out of comments

Text moved verbatim out of code comments when they were trimmed to their why. Each entry names the file and the line of code the comment sat above.

## `crates/redextape-core/examples/concurrency_probe.rs`, above `const FIRST_ORDER_DEMOS: &[&str] = &[`

That test was extended from five to six when this file landed (and from six to seven for
`examples/state_cost_probe.rs`'s copy, added later), which is the protocol its own doc comment
specifies: the enumeration method is `grep -rn FIRST_ORDER_DEMOS` over the whole tree, and the count
has been wrong more than once by being maintained from memory instead.

## `crates/redextape-core/examples/guard_hole_probe.rs`, above `fn nested_groups_src(m: u32) -> String {`

`m+1` nested groups of two mutually recursive functions — the family whose `max_shared` sets the
reverted guard's bound (9,453 at 6 groups; `lower` admits every level again). COPIED from
`list_reduction_probe.rs`, which copied it from `blowup_probe.rs` (not `pub` in either).

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `const FIRST_ORDER_DEMOS: &[&str] = &[`

Verbatim copy of `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS` (comments stripped).

THIS COPY IS COVERED, and was not until the whole-branch review found it. `three_way_oracle.rs`'s
`first_order_demos_stay_synced_across_all_seven_copies` reads this file as text and asserts its
literals are byte-for-byte equal to the canonical array's. It was the FIFTH copy and the last one
found: that test had just been extended from three to four, by a fix that enumerated the damage and
missed this file. Nothing here needs a by-hand diff before it is trusted.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `fn physical(t: &LambdaTerm) -> usize {`

Distinct `Rc` allocations reachable from `t`. Copied from `blowup_probe.rs::physical` (not `pub`
there, so not importable) — the standard O(one-visit-per-allocation) walk over the DAG.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `fn depth(t: &LambdaTerm) -> u32 {`

Maximum nesting depth, memoized over the DAG — copied from `blowup_probe.rs::depth` (not `pub`
there either). This is the quantity `MAX_TERM_DEPTH` (reduce.rs, 3,000) bounds; added after Q2's
ramp showed `HitCap` appear at n=800 with fewer steps than a full normalization needs, which is
`LambdaCursor`'s depth guard firing mid-run, not the step cap.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `const FIRST_ORDER_DEMOS: &[&str] = &[`

Verbatim copy of `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS`, itself copied into
`examples/step_survey.rs` and `redextape-native/tests/native_oracle.rs` — copied from
`step_survey.rs`'s verified-synced copy rather than retyped from the canonical file, so this is a
copy of a copy known equal to the canonical, not a fresh transcription.

THIS COPY IS COVERED, and was not when it was committed. `three_way_oracle.rs`'s
`first_order_demos_stay_synced_across_all_seven_copies` reads this file as text and asserts its
literals are byte-for-byte equal to the canonical array's; the test previously covered three copies
and this comment claimed it covered this one. The claim was made true rather than softened — the
check is textual and path-based, so a probe that CI never runs is as checkable as a test target.
Nothing here needs a by-hand diff before it is trusted.

FIVE, NOT FOUR: extending that test to cover this file left `examples/lambda_sharing_probe.rs`'s
copy still uncovered, found by the whole-branch review. See the test's own doc for the count.

## `crates/redextape-core/examples/state_cost_probe.rs`, above `const FIRST_ORDER_DEMOS: &[&str] = &[`

Verbatim copy of `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS` — THAT array is the canonical one
this copy is checked against, not `crates/redextape-native/tests/native_oracle.rs`, which carries
the same array but is just another row in `three_way_oracle.rs`'s own `copies` table (true of this
file's copy only by transitivity, through the shared canonical). `redextape-core` cannot depend on
`redextape-native` — the dependency runs the other way — so this is a copy, not an import.

THIS COPY IS COVERED. `three_way_oracle.rs`'s `first_order_demos_stay_synced_across_all_seven_copies`
reads this file as text and asserts this array's literals are byte-for-byte equal to the canonical
one's — the same protocol every other copy uses (see that test's own doc for why a `read_to_string`
check needs no import). THIS WAS NOT ALWAYS TRUE: this array shipped in this same branch as a
`part_g` local named `demos`, which neither the sync test nor a `grep -rn FIRST_ORDER_DEMOS` audit
could find — see that test's doc for the fix. Nothing here needs a by-hand diff before it is
trusted; if `FIRST_ORDER_DEMOS` gains an entry, re-copy it here and re-run this probe, and the sync
test's own count (`copies.len() + 1`) is what catches a copy dropped instead of updated.

## `crates/redextape-core/examples/frame_cost_probe.rs`, above `const WEB_BYTE_BUDGET: usize = 65_536;`

`link_index_probe.rs`
cites the SAME constant one line the other way, for the mirror-image reason — see its
`WEB_BYTE_BUDGET`.

## `crates/redextape-core/examples/inherit_probe.rs`, above `fn programs() -> Vec<(&'static str, &'static str)> {`

The four programs, **copied VERBATIM from `none_probe.rs`'s `programs()`** so the source strings
cannot drift between the two probes and every row here is comparable to a row already recorded.
`none_probe` copied them from `owner_probe` for the same reason. Examples are separate crates and
cannot share a helper; verbatim duplication with this note is the convention in this tree.

## `crates/redextape-core/examples/inherit_probe.rs`, above `fn count_tagged_apps(t: &LambdaTerm) -> u64 {`

Number of DISTINCT allocations reachable from `t` that are a tagged `App`. **Copied verbatim from
`none_probe.rs`** — see `programs()` for why duplication rather than sharing.

**Physical, not logical** — deduped by `alloc_id` over an explicit worklist, the same convention
`term.rs`'s `max_shared_logical_size` uses: under structural sharing a term can denote an
astronomical logical tree from a small number of allocations, so a walk that revisits shared
subterms would be a hang, not a measurement. Iterative over an explicit stack, never recursive.

## `crates/redextape-core/examples/inherit_probe.rs`, above `fn percentile(xs: &[f64], q: f64) -> Option<f64> {`

Same
convention as `owner_probe.rs`'s pair of the same name, so the two probes' medians mean the same
thing and are comparable.

## `crates/redextape-core/examples/link_index_probe.rs`, above `const WEB_BYTE_BUDGET: usize = 65_536;`

`protocol.ts`'s `LAMBDA_BYTE_BUDGET` — the budget the app passes `linkIndex`.

THAT POINTER READ `protocol.ts` line 9 UNTIL THIS COMMIT, AND IT WAS NEVER RIGHT — invalidated by
its own commit, which is the mechanism this slice exists to retire caught in the act. Line 9 held
that constant in the PARENT of the commit that wrote this doc, static click-linking (#23); that
same commit added a `LinkIndexWire` import at the top of `protocol.ts` and pushed the constant one
line down, so what landed was a pointer at the ` */` closing the constant's own doc block. It has
not moved since, so the pointer has been one line short for its whole life. `frame_cost_probe.rs`
cites the SAME constant one line the other way, for the mirror-image reason — its `#17` commit
lifted the constant while this one lowered it, and each probe recorded the position its own commit
had just destroyed. See that file's `WEB_BYTE_BUDGET`.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `fn lower_src(src: &str) -> Option<LambdaTerm> {`

`None` when `lower` REFUSES the program, printing the error rather than aborting the process — the
same shape as `blowup_probe.rs::lower_src`, and for the same reason. While `1652e09`'s shared-subterm
guard was in the tree this file's own nesting family was refused from seven groups on, and a `panic!`
here made the documented no-argument invocation die at `q3` before `corpus` or `family` ever ran.
That guard has been reverted and nothing refuses these programs today, but the shape stays: a ramp
that reports a refusal still reports every level below it, and a ramp that panics reports nothing
after it.

## `crates/redextape-core/examples/step_survey.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

It said "four" until the whole-branch review found the fifth;
