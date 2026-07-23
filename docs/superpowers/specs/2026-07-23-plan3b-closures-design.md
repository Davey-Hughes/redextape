# Plan 3b — Closures / Higher-Order on the TM (Defunctionalization) — Design Spec

> **Status:** approved design (2026-07-23), pending the implementation plan(s).
> **Context:** Plan 3 (the TM backend) is complete — `Core → register-asm → multi-tape TM → simulate → decode`, with the three-way oracle `reference == λ == TM`. The one gap: the TM is **first-order**. `map`/`fold` receiving a function argument run on the reference and the λ backend but not the TM, so they live in the `assert_lambda_only` (λ-only) bucket. Plan 3b closes that gap.

## Goal

Make the TM run **first-class functions** — lambdas/named functions used as *values* (passed as arguments, applied dynamically), with real **environment capture** — so the higher-order demos become genuinely three-way. Approach: **defunctionalization as a Core→Core pass**, reusing the (untouched, for the three-way part) TM backend and the existing oracle.

## Non-goals (deferred)

- **A native machine-level jump table** (asm `Apply`/`Switch` instructions + a bespoke dispatch δ-gadget). We deliberately chose the Core→Core route instead — the dispatch still runs on the TM, via the existing `eq`/`jz` gadgets.
- **Currying / partial application.** Multi-arg lambdas are applied at their exact arity; a partial application is `Unsupported`.
- **Builtins as values.** `cons`/`head`/`tail`/`is_empty` are always applied directly (as they are in every demo); a builtin used as a bare value is `Unsupported`.
- **Self-capturing anonymous recursive closures.** Top-level recursive functions (`fn`) recursing by name stay named subroutines and compose fine even when *also* passed as values; a truly self-referential *anonymous* recursive closure may be `Unsupported` (flagged, never miscompiled). The demos don't need it.

## Architecture

### The defunc pass (`crates/redextape-core/src/tm/defunc.rs`)

A **semantics-preserving Core→Core transform** run as the first step of the TM path only:

```
run_tm:  Core --[defunc]--> first-order Core --> lower_asm --> lower_tm --> simulate --> decode
```

The reference and λ backends still consume the **original** Core. So the oracle validates `reference(P) == λ(P) == TM(defunc(P))` — `defunc` must preserve meaning (`P` and `defunc(P)` compute the same value), which the oracle checks for free, plus a direct `reference(P) == reference(defunc(P))` unit check.

The transform:

1. **Escape/free-variable analysis.** Walk the Core; identify each `Lambda` (or named `fn`) that is *used as a value* (occurs anywhere other than as the immediate callee of an `Apply`). For each such lambda, compute its **captured free variables** — names referenced in the body that are neither its params nor globals. Directly-applied functions (the callee of an `Apply`, resolving to a static name) are **left untouched** — they lower as named subroutines exactly as today.

2. **Tag assignment.** Each lambda-used-as-a-value gets a distinct **tag** (a small `Nat`, `0..k`). Tags are grouped by **arity** (the dispatcher is per-arity).

3. **Closure construction.** A lambda-value `|p1..pN| body` capturing `[c1..cm]` becomes a closure value `cons(tag, env)` where `env = [c1, …, cm]` (a HEAP list of the captured values, evaluated at the closure-creation site). A top-level closed function → `cons(tag, nil)` (empty env).

4. **Apply rewriting.** `Apply(callee, [a1..aN])` where `callee` is a *value* (a variable/expression holding a closure, not a static name) becomes `applyN(callee, a1, …, aN)`.

5. **Generated dispatchers.** One `applyN` per arity `N` present:
   ```
   fn applyN(clos, a1, …, aN) {
       let tag = head(clos);
       let env = tail(clos);
       if tag == 0 { <lambda₀ body: unpack env into c1..cm via head/tail(env); run body with p_i = a_i> }
       else if tag == 1 { … }
       else { … }               // well-typed programs never reach the default
   }
   ```
   The dispatchers are **mutually recursive** with the lambda bodies (a body may itself `applyN`), which the existing `letrec` + `Call`/`Ret` + STACK-frame machinery already handles (recursion works — `sum(5)`).

The output is **first-order Core** (functions are only ever *called by name*; closures are ordinary HEAP list data), so `lower_asm`/`lower_tm`/`decode` handle it **unchanged**.

### Two sub-plans

**Plan 3b-1 — immutable-capture closures (THREE-WAY, pure Core→Core, TM δ-layer untouched).**
- Closures capture **immutable** free variables **by value** (a snapshot in the env list). For an immutable variable this is *exactly* the reference's behavior (an immutable never changes, so by-value ≡ by-reference).
- Delivers: `[3,1,2].map(add1)`, `fold(…, add)`, `let n=5; [1,2,3].map(|x| x+n)`, nested/immutable-capturing closures — all **three-way** (`reference == λ == TM`). They move from `assert_lambda_only` into `assert_three_way`.
- Capturing a **mutable** variable → `LowerError::Unsupported` (matching the λ backend, which already rejects mut-in-closure). No boxing yet.
- **No TM δ-layer changes** — only the new `defunc` pass + wiring it into `run_tm`/`lower_asm`'s reject-removal + oracle updates.

**Plan 3b-2 — mutable-capture via boxing (TWO-WAY).**
- The reference captures **by reference**: a `Frame`'s slot is `Rc<RefCell<Value>>`, and a closure shares it, so `let mut n=0; let f=|x| x+n; n=5; f(1)` returns **6** — the closure sees the later mutation.
- To match this, a captured **mutable** variable is **boxed**: it lives in a **mutable heap cell** that both the outer `n = 5` and the closure read/write through. The current HEAP is append-only, so 3b-2 adds a **fixed-width mutable box primitive** to the TM: `box(v)` (allocate a `FIELD_WIDTH`-wide cell, no shifting), `box_get(b)`, `box_set(b, v)` (overwrite in place) — a small new asm op set + one δ-gadget (the in-place overwrite mirrors REG's fixed-width `write_literal`).
- The defunc pass boxes captured mutables: `let mut n` under capture → `let n_box = box(0)`; reads of `n` → `box_get(n_box)`; `n = v` → `box_set(n_box, v)`; the closure captures `n_box` (the pointer).
- These programs are `reference == TM` **two-way** — the λ backend rejects mut-in-closure (`LowerError`), so they land in the `assert_tm_only` bucket (like the Plan-2 latent traps). This is the honest cost: the boxing work buys two-way-only programs.

## Data flow & representation

- **Closure value:** a HEAP pointer to `cons(tag, env)` where `env` is a HEAP list of captured values. Reuses the existing cons/head/tail machinery entirely (no new list representation). A closure is never a *final* decoded result (the reference `Value::Closure` has no structural equality and is never the answer of a demo), so `decode` needs no closure case — closures live only as intermediates.
- **Tag:** a small `Nat` (`< FIELD_WIDTH`; a program has few lambdas), stored as the closure cell's head.
- **Env:** captured values as a cons list; unpacked in the dispatcher via `head`/`tail`. Env values may themselves be closure pointers (nested closures) or list pointers.
- **Box (3b-2 only):** a `FIELD_WIDTH`-wide mutable heap cell holding one value; the box pointer is what gets captured/shared.

## Error handling (`LowerError::Unsupported`, never a wrong answer)

The defunc pass (or the reduced `lower_asm` rejection) yields `Unsupported` — excluded from the oracle, exactly like the existing first-order boundary — for:
- A mutable-variable capture (3b-1 only; supported in 3b-2).
- Partial application / arity mismatch on a closure call.
- A builtin used as a bare value.
- A self-referential anonymous recursive closure that can't be expressed (if it arises).

Everything the transform *does* accept must be **semantically exact** (validated by `reference(P) == reference(defunc(P))` and the oracle), or `Unsupported` — never a silent miscompile. This mirrors Plan 3's discipline (the capturing-lambda rejection that prevented a silent wrong answer in Part 1).

## Bounds & caps

- Values, tags, list lengths, and env sizes stay `< FIELD_WIDTH` (64) — the TM's representability bound. Higher-order over a list (`map`/`fold`) is step-heavy (each element = an `applyN` dispatch + a frame), so the demo lists stay short (≤ ~3) and the oracle caps are the existing `TM_DEFAULT_CAPS` (5M steps); a demo that needs more first confirms via `asm-interp == TM` that it's a genuine cap, then raises with a comment — never a weakened assertion.
- The reference/λ/TM recursion depth guards (`MAX_EVAL_DEPTH`, `MAX_LOWER_DEPTH`, `MAX_SLOTS`/`MAX_FRAME_LOC`) stay intact; defunc'd programs are deeper (dispatcher + body frames) but bounded.

## Testing strategy

- **Defunc unit tests:** `reference(P) == reference(defunc(P))` on the higher-order demos (the transform preserves meaning), plus structural checks that `defunc` produces first-order Core (no `Lambda` survives as a value; every `Apply` callee is a static name).
- **Three-way oracle:** the higher-order demos move from `assert_lambda_only` to `assert_three_way` (3b-1). New capturing-closure demos (`let n=5; [1,2,3].map(|x| x+n)`) added.
- **Two-way (3b-2):** mutable-capturing programs added to the `assert_tm_only` bucket (`reference == TM`; λ `LowerError`).
- **Proptest:** optionally extend the generator with a small higher-order shape (a lambda passed to a `map`-like builtin) bounded `< FIELD_WIDTH` — deferred if it proves fiddly; the curated demos are the primary guard.
- **Goldens:** a `print_asm` / step-count golden on a defunc'd `map(add1)` demo (the step cost of a higher-order call is a nice artifact).

## Key interfaces (produced)

- `redextape_core::tm::defunc::defunc(&Core) -> Result<Core, LowerError>` — the transform (or folded into `lower_asm`'s entry; the pass is the cleaner boundary).
- `run_tm` gains the `defunc` pre-step; `lower_asm`'s `ensure_first_order`/capturing-lambda rejection is *narrowed* to only what defunc leaves (or removed, since defunc'd Core is first-order).
- (3b-2) asm `Instr::Box`/`BoxGet`/`BoxSet`; `Encoding` gains a mutable-box δ-gadget; `decode` unchanged (boxes aren't results).

## Open implementation questions (for the plan, not the design)

- Whether `defunc` runs on `Core` before `lower_asm`, or `lower_asm` calls it internally — the plan picks the cleaner seam (leaning: a standalone `Core → Core` pass in `tm/defunc.rs`, so it's independently testable and `run_tm`/`asm_oracle` both route through it).
- Exact env-unpack codegen (a chain of `head`/`tail`, or a small helper).
- Whether directly-applied *lambdas* (not just named fns) are still inlined, or also routed through a tag (the plan keeps the current inlining for directly-applied lambdas — only value-uses are defunc'd).
