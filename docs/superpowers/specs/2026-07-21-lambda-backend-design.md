# Lambda Backend — Design (Plan 2)

> **Companion to** the system design spec
> [`2026-07-19-tm-lambda-visualizer-design.md`](2026-07-19-tm-lambda-visualizer-design.md) (§5.1, §7.2,
> §9.2, §10.1) and the roadmap
> [`../plans/2026-07-19-redextape-roadmap.md`](../plans/2026-07-19-redextape-roadmap.md) (Plan 2). This
> resolves the λ-backend design decisions the roadmap left open, so the implementation plan can be
> written against concrete interfaces. It builds only on Plan 1's `redextape_core::core::{Core,
> BinOp, NodeId}` and `redextape_core::value::Value` (merged; `main` at foundation).

## 1. Goal & scope

Compile the Core AST **directly** to a λ-calculus term, reduce it with a normal-order reducer that
tracks the redex at each step, and decode the normal form back to a `Value` — giving the **first
oracle**: `reference tree-walker result == decoded λ normal form`. Ship a human-readable, runnable λ
text form with a round-tripping parser/printer.

**Full backend in one plan** (owner decision): the functional path **and** store-passing for
`let mut`/`while`, so `count_down` and the entire spec demo suite pass the two-way oracle. The
functional path is validated first (it needs no store), then store-passing is layered on.

Everything lives in `redextape-core` (no new crate). No UI, no view models, no source maps — those
are Plan 4. Plan 2 provides the substrate.

## 2. Decisions locked

Spec-pinned (§5.1): Church `Nat`; Scott `Bool`/`List`; closures → native λ-abstractions;
recursion → `fix`/Y; `let mut`+`while` → store-passing; **normal-order** (leftmost-outermost)
reduction; **explicit de Bruijn binders from day 1** (§9.2 — the "do it now or regret it" item).

Owner decisions this session:

1. **Full backend in one plan** — functional path + store-passing; two-way oracle on the full demo
   suite (incl. `count_down`).
2. **Minimal pure λ text form** — `var / \x. e / application / parens` only. No numeric/bool/list
   literal sugar and no named-definition sugar; readability sugar is layered on later in the UI plan
   with no change to the term representation.
3. **Local store-passing + documented limit** — support function-local mutation (`let mut`/`while`/
   assignment within a body, no capture-mutation). A closure that assigns a variable captured from an
   outer scope is rejected with a `LowerError::StatefulClosure` diagnostic; the proptest generator and
   the oracle exclude that pattern. Functional terms stay store-free and elegant.

## 3. Term representation (`lambda/term.rs`)

```rust
pub enum LambdaTerm {
    Var(u32),                        // de Bruijn index; 0 = innermost binder
    Abs(String, Box<LambdaTerm>),    // name hint (printing only) + body
    App(Box<LambdaTerm>, Box<LambdaTerm>),
}
```

- **α-equivalence is de Bruijn structural.** The `Abs` name hint is cosmetic (used only when
  printing); two terms are equal iff their `Var`/`App`/`Abs`-body structure matches, ignoring hints.
  Provide this via a manual `PartialEq` (or an `alpha_eq` method) that skips the hint. Round-trip and
  oracle equality are on this α-structural equality.
- Substitution is pure **index shifting** — no fresh-name generation, no capture. `term.rs` (or
  `reduce.rs`) provides `shift(d, cutoff, t)` and `subst(j, s, t)`.
- **Redex path:** `pub enum Dir { AppL, AppR, AbsBody }` and `pub type Path = Vec<Dir>` locate a
  subterm (the reduced redex) for the trace. Deep `LambdaTerm` trees are reachable, so — mirroring
  Plan 1 — `LambdaTerm` gets a **hand-written iterative `Drop`** (unlink the `Box` spine into a
  worklist) to bound teardown depth. Reduction can also grow terms, so the same recursion-safety
  discipline as Plan 1 applies (see §9 below).

## 4. Encodings (`lambda/encode.rs`)

Pure `LambdaTerm` builders (closed terms), no runtime state:

- **Church `Nat`:** `n` ⇒ `λf.λx. fⁿ x`. Combinators: `succ`, `plus`, `mult`, `pred`, `is_zero`,
  and **`monus` = iterated `pred`** (`λm.λn. n pred m`) for truncated subtraction.
- **Scott `Bool`:** `true = λt.λf. t`, `false = λt.λf. f`. `if c t e` lowers to `c t e` — under
  normal order only the selected branch is reduced, matching the reference `if`.
- **Comparisons** (`== != < <= > >=`) on Church numerals, yielding a Scott bool, built from
  `is_zero`/`monus` (e.g. `le m n = is_zero (monus m n)`; `lt = le (succ m) n`; `eq = and (le m n)
  (le n m)`; `ne = not (eq …)`; `ge`/`gt` symmetric).
- **Scott `List`:** `nil = λn.λc. n`, `cons = λh.λt.λn.λc. c h t`. Eliminators `head`, `tail`,
  `is_empty` via Scott elimination (`is_empty xs = xs true (λh.λt. false)`, etc.).

Every builder is unit-tested by reducing an application (e.g. `plus 2 3` normalizes to Church `5`;
`is_empty nil` to `true`).

## 5. Lowering (`lambda/lower.rs`)

`lower(core: &Core) -> Result<LambdaTerm, LowerError>`. A compile-time environment maps in-scope
names to de Bruijn indices (a scope stack pushed/popped as binders are entered).

### 5.1 Functional path (produces store-free terms)

| Core | λ-term |
|------|--------|
| `Nat(_, n)` | Church numeral `n` |
| `Bool(_, b)` | Scott `true`/`false` |
| `Var(_, name)` | de Bruijn index for `name` (prelude names `nil/cons/head/tail/is_empty` resolve to their encoders) |
| `BinOp(_, op, a, b)` | `op-combinator (lower a) (lower b)` |
| `If(_, c, t, e)` | `(lower c) (lower t) (lower e)` |
| `Lambda(_, params, body)` | curried `λp0.λp1. … lower(body)` |
| `Apply(_, f, args)` | left-nested `((lower f) (lower a0)) (lower a1) …` |
| `Let{name, mutable:false, value, body}` | `(λname. lower(body)) (lower value)` |
| `LetRec{name, value, body}` | `(λname. lower(body)) (fix (λname. lower(value)))` |

`fix` is the **call-by-name Y** combinator `λf.(λx. f (x x)) (λx. f (x x))`. Under normal order,
`fix g → g (fix g)`, and since Core recursion is always `if`-guarded (from the source language), the
unfolding terminates on terminating inputs. (The Turing combinator Θ is an equivalent alternative;
Y is chosen for legibility.)

### 5.2 Store-passing for local mutation

Triggered when a body contains `Let{mutable:true}`, `Assign`, or `While`. Let `M = [m0, …, mₖ]` be
the mutable variables live in that body, in a fixed order.

- **Store** = a Scott k-tuple: `store = λk. k v0 … vₖ`. Read `mᵢ` = `store (λv0…vₖ. vᵢ)`; update `mᵢ`
  to `w` = `λk. k v0 … w … vₖ` (other slots re-projected from the old store).
- **`Assign(mᵢ, e)`** ⇒ a new store with slot `i` replaced by `lower(e)` (e evaluated against the
  current store's projections).
- **`While(cond, body)`** ⇒ `fix (λloop. λs. (cond-on s) (loop (body-on s)) s) store` — the Scott
  bool `cond-on s` selects `loop (body-on s)` when true and `s` (the final store) when false.
  `body-on s` threads assignments to produce the next store.
- **`Seq(first, then)`** in a store-passing body threads the store from `first` into `then`.
- The store never escapes the body: after the statements, the body's result expression is evaluated
  against the final store's projections, collapsing the store away. Functional code outside such a
  body is unaffected.

### 5.3 Stateful-closure rejection

While lowering a `Lambda`, if its body contains an `Assign` to a name **not** bound within that
lambda (i.e. a captured outer variable), return `Err(LowerError::StatefulClosure { node: NodeId })`.
This is the documented v1 limitation; it is surfaced as a spanned diagnostic through the public API
(§10 below). The demo suite and the (Plan 3-shared) proptest generator never produce this pattern.

`LowerError` also covers any genuinely-unsupported construct, keeping `lower` total (never panics).

## 6. Reducer (`lambda/reduce.rs`)

- **Normal-order, leftmost-outermost.** Find the leftmost-outermost redex `App(Abs, arg)`, β-reduce
  via de Bruijn `subst`, record the `Path` to that redex.
- `reduce_trace(term: &LambdaTerm, step_cap: u64) -> Trace` where
  `Trace { steps: Vec<Step>, normal_form: LambdaTerm, status: Status }`,
  `Step { term: LambdaTerm, redex: Path }` (term-before-this-step + the redex reduced), and
  `Status { Normalized, HitCap }`. The step-by-step term snapshots are what Plan 4's `LambdaState`
  view model / scrubbable trace consume; Plan 2 only produces them.
- **Step cap** mirrors the interpreter's budget: non-terminating reduction returns a partial trace +
  `HitCap` rather than looping. The oracle treats "reference hit its cap" ≡ "λ hit cap" as the same
  outcome (Plan 1 cross-plan note).
- A cheaper `reduce_to_normal_form(term, cap) -> (LambdaTerm, Status)` (no trace retained) backs the
  oracle and decode where the intermediate steps are not needed.

## 7. Decode (`lambda/decode.rs`)

`decode(nf: &LambdaTerm, expected: &Value) -> Option<Value>` — **type-directed** decode of a
**normal-form** term. The encodings *overlap* (`church(0) = λf.λx. x` is the identical de Bruijn term
as Scott `false = λt.λf. f`; `nil` equals `true`; `[0]` equals `[false]`), so a type-agnostic
`decode(nf)` is impossible. `expected` — the reference interpreter's result — supplies the type
witness; `decode` reads `nf` according to `expected`'s shape and returns the **actual** decoded value:

- `expected` is `Nat` → decode a **Church numeral** `λf.λx. f (f … x)` → `Value::Nat(count)`.
- `expected` is `Bool` → decode a **Scott bool** `λt.λf. t`/`λt.λf. f`.
- `expected` is `Nil` → check `nf` is `λn.λc. n`.
- `expected` is `Cons(h, t)` → check `nf` is `λn.λc. c H T`, recurse `decode(H, h)`/`decode(T, t)`.
- Anything not matching the expected shape → `None`.

`decode` uses `expected` **only for its type/shape** (which decoder + element types), not its numeric
contents, so it still catches a lambda that computed the wrong value — that decodes to a *different*
`Value` (or `None`), which the oracle compares against `expected`. Structural pattern-matching on de
Bruijn shapes; list elements are closed sub-terms. `run_lambda` therefore returns the reduced normal
form (`LambdaRun`), and the caller decodes with an expected value.

## 8. λ text form (`lambda/syntax.rs`)

- **Grammar:** `term := app`; `app := atom+` (application, left-associative); `atom := ident |
  ('\' | 'λ') ident '.' term | '(' term ')'`. Accept both `\` and `λ` for abstraction; print `\`
  (ASCII, CLI/web-friendly).
- `parse_lambda(&str) -> (Option<LambdaTerm>, Vec<Diagnostic>)` — resolves names to de Bruijn indices
  via a scope stack; an unbound (free) variable is a spanned error (lowered terms are closed). Never
  panics on malformed input (Plan 1 diagnostic discipline).
- `print_lambda(&LambdaTerm) -> String` — regenerates readable names from binder hints (freshening on
  shadow collision), minimal parenthesization (application left-assoc; abstraction body extends as
  far right as possible).
- **Round-trip (§7.2):** `parse(print(t))` α-equals `t`; `print(parse(s))` is idempotent. The
  formatter surface (Plan 6) is exactly `print ∘ parse`.

## 9. Recursion safety

The λ pipeline adds new deep-recursion axes (large lowered terms, deep reduction, term teardown),
so it inherits Plan 1's discipline: bounded de Bruijn `LambdaTerm` depth where guards are warranted,
a **step cap** on reduction, an **iterative `Drop`** for `LambdaTerm`, and a parser depth guard in
`syntax.rs` mirroring the source parser. Constants are tuned empirically as in Plan 1. (WASM
shadow-stack sizing for these remains the Plan 4 follow-up.)

## 10. Module layout & public API

```
crates/redextape-core/src/
  lambda.rs            # `pub mod lambda;` submodule root: re-exports + LowerError
  lambda/
    term.rs            # LambdaTerm, Dir/Path, alpha_eq, shift/subst, iterative Drop
    encode.rs          # Church/Scott builders + arithmetic/comparison/list combinators
    lower.rs           # lower(&Core) -> Result<LambdaTerm, LowerError>
    reduce.rs          # reduce_trace, reduce_to_normal_form, Trace/Step/Status
    decode.rs          # decode(&LambdaTerm) -> Option<Value>
    syntax.rs          # parse_lambda / print_lambda
```

**Exposed downstream** (roadmap Plan 2 interfaces): `LambdaTerm`, `Dir`/`Path`, `Trace`/`Step`/
`Status`, `LowerError`, `lower`, `reduce_trace`, `reduce_to_normal_form`, `decode`, `parse_lambda`,
`print_lambda`. A convenience `run_lambda(&Core, cap) -> Result<Value, ...>` (lower → reduce →
decode) backs the oracle.

## 11. Testing (spec §10)

1. **Two-way oracle (headline):** for the full demo suite (arithmetic, `sum`, `map`/`fold`,
   `count_down`), `reference::run(src) == decode(reduce(lower(desugar(parse(src)))))`. Both sides
   agree, including cap-hit outcomes.
2. **proptest:** `Nat/Bool/List` ↔ encode ↔ decode round-trips; `parse ∘ print` idempotence and
   `parse(print(t))` α-equality on generated terms; (optionally) random functional programs through
   the two-way oracle (imperative/stateful-closure programs excluded per §5.3).
3. **Per-module unit tests:** each encoding combinator reduces correctly; representative `lower`
   outputs; β-step and redex-path correctness; decode recognizers; parse/print pairs.
4. **Step-cap consistency:** a non-terminating program hits the cap on both the reference and λ
   sides.

## 12. Out of scope / follow-ups

- **Readability sugar** (named definitions, numeric/bool/list literals in the λ text form) — layered
  on in the UI plan with no change to `LambdaTerm`.
- **Stateful closures** (closure captures-and-mutates outer state) — rejected with a diagnostic in
  v1 (§5.3); would need general heap-passing.
- **View models, source maps, scrubbable trace, WASM** — Plan 4. Plan 2's `Trace` is the substrate.
- **TM backend + three-way oracle** — Plan 3.
