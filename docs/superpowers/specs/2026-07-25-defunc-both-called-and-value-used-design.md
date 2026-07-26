# `defunc`: functions both called by name and used as a value

**Status:** design approved, ready for an implementation plan.
**Date:** 2026-07-25.
**Predecessors:** [Core source map + TM step survey](2026-07-24-core-source-map-and-step-survey-design.md) (the instrument that makes the cost of this measurable), the closures/higher-order work that built `defunc`.

## Why this slice exists

`defunc` currently **rejects** any function that is both called by name and used as a value
(`defunc.rs:270-281`):

```rust
(true, true) => return Err(unsupported(f.body,
    format!("`{}` is both called by name and used as a value", f.name))),
```

The comment beside it says "BOTH is deferred to a later task." This is that task.

**The rejected class is much larger than it looks.** `analyze` (`defunc.rs:478-481`) marks *any* direct
`Apply` of a function name as `name_called`, with **no exclusion for a function calling itself**. So a
recursive function's own self-call sets `name_called`; if that same function is ever used as a value, it
is `(true, true)` and rejected. In practice that means **every recursive function used as a value** —
passing `map` or `fold` itself to another function, storing a recursive function in a list, building
combinators — which is most higher-order code worth writing.

**This is a feature, not an optimization.** It recovers no steps. What it fixes is an *oracle asymmetry*:
the reference interpreter and λ accept these programs today, while TM and native reject them with
`Unsupported`. Enabling BOTH moves a whole program class from "λ-only" into full
`reference == λ == TM == native` agreement.

### How this slice was chosen, and one correction worth recording

The step survey ranked closure devirtualization as the highest-value Tier A pass (27.5% of corpus steps).
While scoping it, an intended "cheap first case" — devirtualizing direct calls to a function that is also
value-used — turned out **not to exist**: those programs are the ones rejected here. The
`!is_local && is_value_fn` branch in `rewrite_apply` is unreachable, because any program reaching it was
refused earlier. So **100% of the surveyed dispatch cost is genuinely higher-order**, and what looked like
a cheap optimization is really this feature gap.

## Non-goals

- **No devirtualization of higher-order calls.** `map(xs, f)` where `f` is a parameter still dispatches.
  That is the separate, larger pass the survey actually points at.
- **No inlining, and no call-site specialization.**
- **No change to `analyze`'s treatment of self-calls.** Making a self-call not count as `name_called`
  would be a different (and less general) way to admit recursive value-used functions; it would still
  reject the genuinely-both case, so it is not a substitute.
- **No new backend behaviour** beyond accepting programs that were previously refused.

---

## 1. The transform

The partition arm changes, and nothing else about the partition does:

```rust
(true, true) => { kept.push(f); value_funcs.push(f); }
```

A BOTH function is therefore **both** a named subroutine (so by-name calls stay direct) **and** tagged with
a dispatcher arm (so value-uses work).

**By-name calls devirtualize for free**, because `rewrite_apply` already tests `is_static` before the
dispatch branch:

```rust
if !is_local && is_static { /* direct call */ }
if is_local || is_value_fn { /* dispatch */ }
```

Once a BOTH function is in `kept`, `is_static` is true and every by-name call — **including its own
recursive self-call** — takes the direct path. No change to `rewrite_apply` is required.

**Value-uses are unchanged**: `rewrite_value_name` still produces `cons(tag, env)`.

## 2. The dispatcher arm forwards rather than duplicating

The arm's body becomes a call to the kept function:

```
Apply(fresh, Var(fresh, "f"), [Var(fresh, "$a1"), …, Var(fresh, "$aN")])
```

with **no** param bindings (the dispatcher's `let p_i = $a_i` loop emits nothing when `ArmData.params` is
empty), so the forwarder is one call and nothing else.

**Why forwarding and not duplicating the body.** Duplication would avoid an extra frame on the dispatched
path, but it emits the body twice — and the copy would have to mint fresh node ids or violate the source
map's `no_output_node_id_is_duplicated` invariant, which then raises a genuine question about which bucket
the copy's steps belong to. Forwarding keeps one body, preserves node ids trivially, and is a few lines.

**What it costs, stated precisely so it is not misread as a regression.** No existing program gets slower:
programs in this class are *rejected* today, so there is no "before" to regress from, and programs already
accepted are untouched (their partition arm is unchanged). The cost is relative to the **duplicating
alternative** — a BOTH function invoked through the dispatcher pays one extra call frame that a duplicated
body would not. Frames are the survey's largest bucket (`MachineScaffold`, 24.8%, measured quadratic in the
Loc bank), so that matters for heavy higher-order use — and it is **measurable** rather than hypothetical:
the survey reports `ClosureScaffold` and `MachineScaffold` separately, so a follow-up can quantify it and
revisit duplication with a number behind it.

**Where its cost lands:** the forwarder is synthesized, so it takes fresh ids from `SynthGen` and its steps
bucket as `ClosureScaffold`. That is correct under the rule the survey established — *bucket by what a
pass could do about it* — since devirtualization is exactly what would remove this frame.

## 3. The capture question — verify, do not assume

A top-level `fn` **can** capture: `let n = 5; fn f(x){ x + n } map(xs, f)` closes over `n`, and mutable
captures are boxed to `$boxh{k}`.

A forwarding arm calls `f` and lets `f` resolve its captures **lexically**, ignoring the closure's env.
That is correct **only if** the dispatcher is emitted in a scope where those bindings are visible.

**The implementation must verify that**, not assume it. If the dispatcher is not in scope of the prelude
bindings, the arm must bind the captures from the closure env before forwarding, exactly as a
non-forwarding arm does today. Either outcome is acceptable; silently relying on an unverified scoping
property is not.

## 4. What must be proven

Ordered by how badly a miss would hurt:

1. **Argument order.** A forwarder emitting `f($a2, $a1)` is a silent miscompile that computes plausible
   answers. A fixture using `add` would never catch it — so the test **must** use a non-commutative
   function (`fn sub(a,b){a-b}`) at arity ≥ 2, asserted through `tests/three_way_oracle.rs`.
2. **The by-name call stays direct.** If a refactor routes it through dispatch, every result is still
   correct and only slower — invisible without an assertion that pins it.
3. **Recursive + value-used works** — the case the restriction actually blocked, and the reason the class
   is large.
4. **Oracle agreement extends.** Programs previously refused now agree `reference == λ == TM` (and
   `== native`). This is the slice's actual payoff and must be asserted, not assumed.
5. **Attribution.** The forwarder's steps land in `ClosureScaffold`; the function's own body still bills to
   the user's construct.
6. **Each of the above verified by sabotage** — apply the mutant, confirm the test fails, revert. This
   codebase has repeatedly shipped guards that passed while the thing they named was broken; a test added
   here that cannot fail is worse than no test.

## 5. Risks

| Risk | Mitigation |
|---|---|
| A downstream assumption that a tagged function was *dissolved* (its `LetRec` gone) is now reachable | Audit `peel`, the arm builder, and everything iterating `kept`/`value_funcs`; a BOTH function must be emitted exactly once as a `LetRec` |
| Forwarder gets argument order wrong | Non-commutative fixture at arity ≥ 2, sabotage-verified |
| Captures not visible at the dispatcher's scope | §3 — verify explicitly; bind from env if not |
| Extra frame regresses heavy higher-order use | Measured, not argued: re-run the survey; duplication remains available as a follow-up with a number behind it |
| Existing tests assert the `Unsupported` | Expected — those assertions must be replaced by the new agreement tests, and the change is spec-visible |

## Interfaces produced

No public signature changes. `defunc`/`defunc_mapped` keep their shapes; the difference is that inputs
which previously returned `Err(LowerError::Unsupported { .. })` now return `Ok`.

## What this slice decides

Whether the higher-order devirtualization pass — the survey's actual top recommendation — is worth
building next, informed by what the forwarding frame measurably costs once real programs can use it.
