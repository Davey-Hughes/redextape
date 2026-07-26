# Mutually recursive functions

**Status:** design approved, ready for an implementation plan.
**Date:** 2026-07-25.
**Successor slice:** `defunc`'s both-called-and-value-used case
([spec](2026-07-25-defunc-both-called-and-value-used-design.md)), which becomes small once binding
groups are expressible.

## Why this slice exists

**Mutual recursion does not compile today.** `lower_function` binds a name *before its own body* so it
can self-recurse — singular. Given `letrec f = … in (letrec g = … in main)`, `f`'s body is lowered before
`g` is bound, so `f` calling `g` is unbound. This program fails:

```
fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } }
fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } }
is_even(10)
```

That is a real language gap, independent of anything else.

**How this slice was arrived at.** The step survey ranked closure devirtualization as the top Tier A
pass; scoping it exposed that `defunc` rejects functions both called by name and used as a value; and
implementing *that* turned out to require the emitter to express a `map ↔ $applyN` cycle — i.e. mutual
recursion. So the prerequisite is a language feature that stands on its own, and the `defunc` case falls
out of it afterwards.

## Non-goals

- **No change to single recursion.** `LetRec` stays exactly as it is, so a program containing no
  mutually recursive or forward-referencing `fn` lowers identically (§7).

  > **Corrected after the fact — two classes of program DO change, deliberately.** Duplicate `fn`
  > names within one adjacent run are now a **static error** (previously the last definition won),
  > and a `fn` now shadows an enclosing binding of the same name for the whole run rather than only
  > from its own definition onward. Both were forced: `desugar` reorders a run by dependency, and
  > under reordering the old last-wins resolution is not merely different but **type-unsound** (a
  > program that typechecks `Bool` and evaluates to `Nat`). See §2.

  > **Corrected after the fact — "every step-count golden unchanged" is NOT the check that proves
  > additivity.** It was measured not to be: emitting a singleton component as a one-member
  > `LetRecGroup` — the exact violation — leaves *every* step-count golden green, because three of
  > them contain no `fn` at all, the higher-order one is rebuilt as a `LetRec` by `defunc` anyway,
  > and `lower_function` is literally `lower_function_group(ctx, &[one])`, so a one-member group
  > emits byte-identical asm by construction. The guards that **do** bite are
  > `desugar::an_independent_fn_still_lowers_as_a_plain_letrec` (structural), the
  > `attribution_golden_add1_of_5` `Core::LetRec{..}` destructure, and Tasks 3/5's byte-identity
  > corpora over 157 and 11 programs. The goldens are a useful backstop, not the proof.
- **No mutual recursion across non-adjacent definitions** — see §2's bound.
- **No `defunc` BOTH support here.** That is the follow-up slice.
- **No optimizer pass.** This adds expressiveness, not speed.

---

## 1. Core gains a binding group, additively

```rust
/// Mutually recursive bindings: `letrec f1 = v1 and … and fn = vn in body`. Every value is a
/// `Lambda`, and every name is in scope in every value AND in the body. Only constructed for a
/// genuine group (n ≥ 2); a single recursive binding stays `LetRec`, so existing programs are
/// untouched.
LetRecGroup(NodeId, Vec<(String, Core)>, Box<Core>),
```

**Additive, not a replacement.** Replacing `LetRec` with a general group form would be more uniform but
would re-lower every existing program and invalidate the step-count goldens — a large, unnecessary blast
radius for a feature that only needs the n ≥ 2 case. Keeping both means a singleton group is never
constructed.

Because `Core` matches are exhaustive, **every site that matches on `Core` becomes a compile error until
updated.** That is the safety property here: the child-enumeration logic now lives in five places
(`core.rs::take_core_children`, `defunc.rs::push_children`, a `lower_asm.rs` test helper, and two sites in
`examples/step_survey.rs`), and none can be silently missed.

## 2. `desugar` forms groups from adjacent `fn` runs

`lower_stmts` folds statements right-to-left into nested `Let`/`LetRec`/`Seq`. The change: scan each
**maximal run of consecutive `Stmt::Fn`**, build the call graph among that run's names, compute strongly
connected components, and emit each SCC — size 1 as today's `LetRec`, size ≥ 2 as a `LetRecGroup`.

**The bound, stated deliberately:** mutually recursive functions separated by a non-`fn` statement stay
unsupported. Grouping them would require hoisting a definition across a `let` whose value it might
reference, changing evaluation order. Most languages scope mutual recursion to a contiguous block for the
same reason. This must be **tested and documented**, not left to be discovered.

## 3. Each backend, and what it costs

**Reference interpreter** (`interp.rs:127-136`) already pre-binds a placeholder `Rc<RefCell<Value>>` slot,
evaluates the value in the extended env, then patches the slot. The group case generalises it directly:
create *all* slots, build one env containing all names, evaluate each value in it, patch each slot.

**λ** (`lambda/lower.rs:158-166`) currently emits `(\name. body) (fix (\name. value))` with the
call-by-name Y at `:23`. Mutual recursion needs **no new combinator** — take one fixpoint over an n-tuple
and project:

```
G = fix (\g. TUPLE(v1', …, vn'))        -- each vi' has every fj rewritten to (proj_j g)
    (\f1 … fn. body) (proj_1 G) … (proj_n G)
```

The tuple reuses the existing `encode::cons`/`head`/`tail`/`nil`, so an n-tuple is a cons-list and
`proj_j` is a `tail`-chain then `head`. No new primitives.

**The one real λ risk:** call-by-name Y means each projection re-expands the tuple rather than sharing it,
so this costs λ **steps** — and the λ leg is step-capped. A mutually recursive program can plausibly
`HitCap` where an equivalent single-recursive one would not. Test programs must be sized against the cap,
and if a natural example cannot fit, that is a finding to report rather than a reason to raise the cap
silently.

**`typeck`** must bind every name in the group to a fresh type variable *before* checking any body,
mirroring how a recursive group is typed generally.

**`lower_asm`** must register **every** `(label, arity)` in the group before lowering **any** body — the
n-ary generalisation of what `lower_function` already does for one name. This is the change that makes
the whole feature possible.

**`defunc`** must handle groups in `peel` and re-emit them; it does not yet *produce* them.

## 4. Totality

Each backend gains a new recursive arm, so each inherits its existing depth guard rather than deriving a
new one — `MAX_EVAL_DEPTH`, `MAX_TYPE_DEPTH`, `MAX_LOWER_DEPTH`, `MAX_DEFUNC_DEPTH`. `Core` spines reach
tens of thousands of nodes deep (the reason `Core` has a hand-written iterative `Drop`), so any new walk
must be iterative, and `take_core_children` must enumerate a group's children or teardown will recurse.

## 5. Attribution

A group is one `Core` node with one `NodeId`, so steps attributed to it bill the group rather than an
individual member. That is a coarsening worth stating in the survey's output if groups ever appear in the
corpus; it is acceptable because the alternative — per-member ids — would require the emitter to track
which member a given instruction came from, which is out of scope here.

## 6. Where the payoff lands

**The oracle.** `is_even`/`is_odd` currently cannot reach any backend; after this it must satisfy
`reference == λ == TM == native`. That is a genuine extension of the agreement claim to a program class
that previously had no representation at all.

## 7. What must be proven

1. **Mutual recursion computes the right answer on every leg** — the four-way oracle on `is_even`/`is_odd`,
   not merely "it compiles."
2. **Every existing step-count golden is unchanged.** This is the check that singleton recursion was
   genuinely untouched; if a golden moves, `LetRec`'s path was disturbed and the additive claim is false.
3. **Ordering actually matters and is pinned.** A group whose bodies are lowered before all names are
   bound must fail loudly. Sabotage: bind only the first name before lowering bodies, confirm a test fails.
4. **The non-adjacent bound behaves as documented** — mutually recursive `fn`s separated by a `let` are
   rejected, with a test asserting it rather than leaving it implicit.
5. **A three-member group works**, not only a pair — an n-ary bug that happens to work at n = 2 is exactly
   the shape of defect this codebase keeps finding.
6. **Argument/name order is not silently permuted.** Use members that are *not* interchangeable
   (`is_even`/`is_odd` differ observably), so a projection that returns the wrong member fails rather than
   computing a plausible answer.
7. **Each of the above verified by sabotage** — apply the mutant, confirm the test fails, revert. A guard
   added here that cannot fail is worse than none; this branch's predecessors shipped seven such guards.

## Risks

| Risk | Mitigation |
|---|---|
| λ tupling costs steps; a mutually recursive program hits the λ step cap | Size test programs against the cap; report rather than silently raising it |
| A `Core` match site is missed | Impossible silently — exhaustive matches make each a compile error |
| Existing programs re-lower and goldens move | `LetRec` untouched; singleton groups never constructed. **The check is `an_independent_fn_still_lowers_as_a_plain_letrec` + `attribution_golden_add1_of_5` + the byte-identity corpora — not the step-count goldens, which were measured to stay green under the exact violation** (see Non-goals) |
| `desugar`'s SCC grouping changes evaluation order | Groups formed only from *adjacent* `fn` runs; non-adjacent stays unsupported and tested |
| New recursion overflows the stack on a deep spine | Existing depth guards inherited, not re-derived; new walks iterative |

## Interfaces produced

- `Core::LetRecGroup(NodeId, Vec<(String, Core)>, Box<Core>)`
- No public function signature changes. `run`, `run_lambda`, `run_tm`, `lower_asm`, `defunc` keep their
  shapes; inputs that previously failed now succeed.
