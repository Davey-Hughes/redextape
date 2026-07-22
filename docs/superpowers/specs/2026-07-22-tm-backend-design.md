# TM Backend — Design (Plan 3)

> **Companion to** the system design spec
> [`2026-07-19-tm-lambda-visualizer-design.md`](2026-07-19-tm-lambda-visualizer-design.md) (§5.2, §5.3,
> §5.4, §10) and the roadmap
> [`../plans/2026-07-19-redextape-roadmap.md`](../plans/2026-07-19-redextape-roadmap.md) (Plan 3). It
> resolves the TM-backend design decisions the roadmap left open, so the implementation plan can be
> written against concrete interfaces. It builds only on Plan 1's `redextape_core::core::{Core, BinOp,
> NodeId}` and `redextape_core::value::Value`, and reuses the two-way oracle harness from Plan 2
> ([`2026-07-21-lambda-backend-design.md`](2026-07-21-lambda-backend-design.md)).

## 1. Goal & scope

Compile the Core AST to a **register-assembly** IR, lower that to a **genuine finite-state multi-tape
Turing machine** (a real δ transition table), simulate it, and decode the final tapes back to a
`Value` — delivering the **three-way oracle**: `reference tree-walker == decoded λ normal form ==
decoded TM final tape` (§10.1). Ship a human-readable, runnable **TM text form** with a round-tripping
parser/printer.

The TM is the destination artifact and the simulator runs the *real* machine — execution happens in a
genuine multi-tape TM, not a native run with a decorative overlay (system spec §1, §4.1). This is the
"watch the Church–Turing thesis happen" north star.

Everything lives in `redextape-core` (no new crate). No UI, no view models, no source maps — those are
Plan 4. Plan 3 provides the substrate (the `sim` step trace and the legible, provenance-carrying state
graph are what Plan 4 consumes).

### 1.1 Scope decisions locked (owner-confirmed this session)

1. **Genuine finite-state multi-tape TM** with a real δ transition table, reached via a register-
   assembly IR (system spec §4.1/§5.2). Not relitigated — this is the project's north star.
2. **Unary `Nat` tape encoding in v1** — chosen over the system spec's stated binary default. Rationale
   (priorities, system spec §2): legibility is #1 (add = append a run of marks; monus = erase in
   lockstep; compare = zig-zag match — a few δ-states each, versus binary ripple-carry/borrow
   subroutines of 10–20+ states with heavy head shuttling); demo values are tiny (≤ ~15); simpler
   δ-tables make the three-way oracle more trustworthy; and it shrinks the largest plan. Unary's one
   weakness — the tape grows with `n` — is designed out by the small language + monus (system spec
   §13.2). `mul` is the one genuinely involved op in *either* encoding (a repeated-add loop in unary).
3. **Encoding is a swappable seam.** The register-assembly is numeric-representation-agnostic; the
   encoding is a gadget library consumed *only* at asm→TM lowering. Everything else is encoding-blind.
   Toggling the encoding = recompile the program to a different machine.
4. **First-order only in Plan 3.** Defunctionalization (closures → tag + env, `apply` → jump table) and
   the higher-order demos (`map`/`fold` receiving a function argument) are deferred to **Plan 3b**. The
   system spec pre-authorizes this phasing (§13.3). The asm therefore needs no `apply` instruction yet.
5. **asm text form = printer only** (`print_asm`) in Plan 3; the asm *parser* + round-trip is deferred
   to the v2 visible-assembly pane (system spec §11). The **TM text form gets the full parser +
   printer + round-trip** — the TM is a v1 editable pane (system spec §11) and "TM text round-trips" is
   the roadmap's named testable outcome, mirroring how Plan 2 shipped the λ text form.

## 2. Pipeline & the divergence principle

All of Plan 3 lives *below* the Core sync anchor (system spec §4.1) — target-specific lowering:

```
Core ─► register-assembly ─► multi-tape TM ─► simulate ─► type-directed decode ─► Value
        (lower_asm)          (lower_tm)         (sim)        (decode)
                                                                 ▲
                                     TM text form ──────────────┘   (parse_tm / print_tm, round-trips)
```

The register-assembly is the legible middle rung (the textbook path to a TM); the TM faithfully
simulates it. A nice consistency with the λ backend falls out: **decode is type-directed** — the
oracle's reference `Value` supplies the type witness for reading the final tape.

## 3. The register-assembly IR (`tm/asm.rs`)

A register machine whose control flow becomes the TM's state graph and whose data lives on tapes.

### 3.1 Value model on the machine

Registers hold unary **words**. Because Core is *typed*, the compiled code statically knows what each
register means — there are **no runtime type tags**:

- `Nat` → a unary count.
- `Bool` → `0` or `1` (so `jz` tests `if`/`while` conditions directly).
- `List` → a **pointer**: a unary address into a **heap tape** of cons cells `(head-word,
  tail-pointer)`. `nil` = the null pointer. Nested lists work uniformly (a head-word can itself be a
  pointer).

### 3.2 Instruction set (first-order)

```
li   rd, #n        mov rd, rs                       ; load immediate, copy
add  rd, ra, rb    sub rd, ra, rb    mul rd, ra, rb ; arithmetic (sub = monus)
cmpeq/cmpne/cmplt/cmple/cmpgt/cmpge  rd, ra, rb     ; comparisons → rd ∈ {0,1}
jz   r, L          jmp L                            ; control flow (L = static label)
push r             pop rd                           ; stack-tape frame management
call L             ret               halt           ; calls / recursion / stop
nil  rd            cons rd, rh, rt                   ; heap/list ops
head rd, rl        tail rd, rl       isempty rd, rl
```

No `apply` — that is the deferred closure/jump-table work (Plan 3b).

`Program` is a flat `Vec<Instr>` with labels; the register count `K` is chosen per program by a simple
allocate-and-reuse scheme (no graph-coloring allocator — YAGNI at this scale).

### 3.3 Core → asm (`tm/lower_asm.rs`), syntax-directed

| Core | asm |
|------|-----|
| `Nat n` / `Bool b` | `li rd, #n` / `li rd, #0`\|`#1` |
| `BinOp` arith / compare | `add`\|`sub`\|`mul` / `cmp<op>` |
| `If(c, t, e)` | eval `c` → `jz` to else-label; `jmp` past the then-arm |
| `While(c, b)` | loop label; eval `c` → `jz` exit; body; `jmp` loop |
| `Let`/`Let mut` / `Assign` | bind / assign a register slot |
| `Var` | read its register |
| `Seq(a, b)` | emit `a` (discard), then `b` |
| `Apply(named-fn, args)` | args → registers, `call fn`, result in `rr` |
| `LetRec` (`fn`) | a labeled subroutine + `call`/`ret` |
| `Lambda`, bound and only ever *applied* | a labeled subroutine, like `LetRec` (e.g. `let add1 = \|x\| x+1; add1(41)`) |
| `nil` / `cons` / `head` / `tail` / `is_empty` | the heap ops |
| `Unit` (tail-less block result) | no result word — see the note below |

**Calling convention.** Arguments are passed in registers `r0..`, the result is returned in `rr`, and
the caller saves any live registers it still needs after a `call` via `push`/`pop` (the callee may
clobber the rest). `call` also pushes the return-tag (§3.4).

**The precise first-order boundary.** A `let`/`letrec`-bound function (`fn` or a `Lambda`) that is only
ever *applied* — never referenced as a bare value — lowers to a named subroutine. Any
**function-as-a-value** use (passed as an argument, stored, or returned — e.g. `map(add1)`) is
higher-order and returns `LowerError::Unsupported { node: NodeId }`, deferred to Plan 3b — exactly as
the λ backend rejects stateful closures and the oracle/proptest exclude that pattern. A program whose
overall result is `Unit` has no comparable encoded value (like the λ decoder, `decode_tape` returns
`None` for `Unit`), so such programs sit outside the three-way *value* comparison.
`lower_asm(core: &Core) -> Result<Program, LowerError>` is **total** and panic-free; `LowerError` also
covers any genuinely unsupported construct.

### 3.4 Two properties that keep it a *genuine finite-state* TM

- **Control flow becomes the TM's state graph.** `jmp`/`jz`/labels are static edges between
  state-blocks; the "program counter" *is* the finite control, not a tape.
- **`ret` stays finite-state via a return-tag.** `call L` pushes a small tag identifying the call site;
  `ret` pops it and the finite control does a fixed dispatch back to the right continuation. Call sites
  are a finite compile-time set, so this is a fixed gadget — no computed jumps.

### 3.5 The asm interpreter (internal testing oracle)

`tm/asm.rs` also carries a small **register-machine interpreter** (executes the instruction set
directly, no tapes). It is an internal test/debug tool, not a shipped API: it gives two intermediate
oracles — `reference == asm-interp` (localizes Core→asm bugs) and `asm-interp == TM-sim` (localizes
asm→TM / gadget bugs) — making the δ-table work debuggable rather than a black box.

### 3.6 `print_asm`

Emits the labeled, readable form above (state labels like `sum`, `sum.rec`, `L3`) for golden tests and
legibility. No parser in Plan 3 (§1.1 decision 5). Example — `fn sum(n){ if n==0 {0} else { n +
sum(n-1) } } sum(5)`:

```
        li    r0, #5
        call  sum          ; rr = sum(5)
        halt               ; result 15 in rr
sum:                       ; n = r0
        cmpeq r1, r0, #0
        jz    r1, rec      ; n != 0 → recurse
        li    rr, #0       ; base case
        ret
rec:    push  r0           ; save n across the call
        sub   r0, r0, #1
        call  sum          ; rr = sum(n-1)
        pop   r2           ; r2 = saved n
        add   rr, r2, rr   ; n + sum(n-1)
        ret
```

## 4. The multi-tape TM (`tm/machine.rs`)

```rust
pub struct Machine {
    pub states: Vec<State>,   // finite control; states carry legible names + provenance
    pub start: StateId,
    pub tapes: usize,
    pub alphabet: Vec<Symbol>,
    pub delta: TransitionTable, // (state, symbols-under-heads) -> (next, writes, head-moves)
}
```

Transitions are **deterministic and total**, halting in a designated state (the system spec §8 linter
flags nondeterministic / non-total transitions as *errors*, so what Plan 3 emits is always
deterministic and total). `Machine`, `Program`, and the tapes are flat `Vec`s — **not** deep trees — so,
unlike `Core`/`Value`/`LambdaTerm`, none needs a hand-written iterative `Drop`. One fewer safety axis
than the λ backend.

### 4.1 Tape layout — four tapes

| Tape | Holds | Used by |
|------|-------|---------|
| **Registers** | the current activation's register bank `r0..rK` (unary fields, `#`-separated) | every gadget |
| **Work** | scratch: copy operands, build results, zig-zag matching | arithmetic / compare gadgets |
| **Stack** | call frames (`return-tag` + saved registers); also `push`/`pop` | `call` / `ret` |
| **Heap** | cons cells `(head-word, tail-pointer)` at unary addresses | `cons` / `head` / `tail` |

## 5. The `Encoding` seam (`tm/encoding.rs`) — the only encoding-specific module

```rust
pub trait Encoding {
    fn name(&self) -> &str;                                   // "unary"
    fn symbols(&self) -> Vec<Symbol>;                         // alphabet contribution
    fn write_literal(&self, n: u64, rd: Reg) -> StateBlock;   // put a Nat literal in a register
    fn gadget(&self, op: ArithOp, ra: Reg, rb: Reg, rd: Reg) -> StateBlock; // add/sub/mul/cmp δ-states
    fn decode_nat(&self, field: &[Symbol]) -> Option<u64>;    // read a register's Nat back
}
```

The **unary** implementation is the v1 gadget library:

- **add** → copy `ra`'s marks to `rd` (via work tape), append `rb`'s marks.
- **sub / monus** → copy `ra` to `rd`; erase one mark per `rb` mark; stop at 0 (truncated).
- **cmp** → zig-zag match `ra` vs `rb`; whichever exhausts first decides `<`/`=`/`>`; write `0`/`1`.
- **mul** → the one loop gadget: `rd = 0`; add `ra` to `rd` `rb` times.

Crucially, **only user `Nat`/`Bool` values flow through the encoding.** Internal addresses, return-tags,
and stack bookkeeping stay unary *always* — so a later binary encoding touches only these gadgets +
`decode_nat`, never the heap/stack machinery. That is what makes the seam cheap.

## 6. asm → TM (`tm/lower_tm.rs`, generic over `Encoding`)

```rust
pub fn lower_tm(prog: &Program, enc: &dyn Encoding) -> Machine
```

Each asm instruction compiles to a **block of states** (a gadget). Straight-line instructions chain by
falling through; `jmp`/`jz` become edges to label-entry states; `call`/`ret`/`push`/`pop` are stack-tape
gadgets. State names carry provenance (`sum.rec`, `L3`, instruction index) — this *is* the raw material
for Plan 4's source maps, and the state graph mirrors the asm control-flow one-to-one (legible as a flow
diagram later, system spec §9). The arithmetic/comparison gadgets come from `enc`.

## 7. Simulator (`tm/sim.rs`)

```rust
pub fn simulate_trace(m: &Machine, caps: Caps) -> Trace;      // Step { state, heads, tape snapshots }
pub fn simulate(m: &Machine, caps: Caps) -> (Tapes, Status);  // no-trace, backs the oracle
pub enum Status { Halted, HitCap }
```

An **iterative** loop (no native recursion → no stack overflow): read the symbol under each head, apply
δ, write/move, advance the state; repeat until halt or a cap. **Two caps** — a step cap *and* a
tape-size cap (total cells) — either trips `HitCap`. The `Trace`/`Step`/`Status` shape mirrors the λ
reducer's substrate; Plan 4's `TmState` view model / scrubbable trace consume these steps. A cheaper
no-trace `simulate` backs the oracle where intermediate steps are not needed.

## 8. Decode (`tm/decode.rs`) — type-directed, like λ

```rust
pub fn decode_tape(tapes: &Tapes, expected: &Value, enc: &dyn Encoding) -> Option<Value>
```

Guided by the *type/shape* of `expected` (the reference result):

- `Nat` → `enc.decode_nat(rr)`.
- `Bool` → read `rr ∈ {0, 1}`.
- `Nil` → the result pointer `rr` is null.
- `Cons(h, t)` → follow the heap tape from `rr`: read the cell, decode its head-word guided by `h`, and
  recurse on the tail-pointer guided by `t`.
- Anything not matching the expected shape → `None`.

`decode_tape` uses `expected` **only for its type/shape**, not its contents, so it still catches a
machine that computed the wrong value (it decodes to a *different* `Value`, or `None`). Same discipline
as the λ decoder — necessary because a bare tape is as ambiguous as a bare normal form.

## 9. TM text form (`tm/syntax.rs`) — full round-trip

The TM is one of the three v1 editable panes (system spec §7), so it must be authorable *and* runnable
(parse → simulate on the same `sim`). A legible transition-rule syntax; named states + comments carry
the readability:

```
; tapes: reg, work, stack, heap        (_ = blank, * = don't-care, moves L/R/S)
tapes 4
start main

state sum.entry:            ; n in r0
  [1 * * *] -> write [1 * * *], move [S S S S], goto sum.rec
  [_ * * *] -> write [_ * * *], move [S S S S], goto sum.base
...
state halt: accept
```

- `parse_tm(&str) -> (Option<Machine>, Vec<Diagnostic>)` — never panics; spanned diagnostics; a
  depth/size guard mirroring the source and λ parsers.
- `print_tm(&Machine) -> String` — stable/idempotent.
- **Round-trip (system spec §7.2):** `parse(print(m)) == m` structurally; `print(parse(s))` idempotent.
  The formatter surface (Plan 6) is exactly `print ∘ parse`.

## 10. Recursion safety (inherits the Plan 1/2 discipline)

The TM pipeline adds new axes, all guarded:

- **`sim` is iterative** (no native recursion) — deep TM runs cannot overflow the native stack; they
  hit a cap instead.
- **Two caps** on `sim` (step + tape-size); machine recursion (the stack tape) and list growth (the
  heap tape) are both bounded → `HitCap`, never a hang.
- **`Machine` / `Program` / tapes are flat `Vec`s** — no deep-tree teardown, so no iterative `Drop` is
  required (a genuine simplification versus `Core`/`Value`/`LambdaTerm`).
- **`lower_asm` handles deep Core** (a big list literal desugars to a deep `cons`-`Apply` spine)
  without native stack overflow — iterative lowering or a depth guard returning `LowerError`, tuned
  empirically as in Plan 1.
- **`parse_tm` carries a depth/size guard** mirroring the source parser.
- **Cap-equivalence:** the oracle treats "reference hit its depth/step cap" ≡ "λ hit its step cap" ≡
  "TM hit its step/tape cap" as the **same outcome** (the Plan 1 cross-plan note, now three-way).
- **WASM shadow-stack** sizing for these limits remains a Plan 4 follow-up.

## 11. Module layout & public API

```
crates/redextape-core/src/
  tm.rs              # submodule root: re-exports, TmRun, run_tm, LowerError
  tm/
    asm.rs           # register-assembly IR (Instr, Program) + print_asm + asm interpreter (testing)
    lower_asm.rs     # Core -> asm (first-order); LowerError for higher-order (deferred to 3b)
    encoding.rs      # the Encoding seam: trait + the unary gadget library
    machine.rs       # multi-tape TM model: states, δ transition table, alphabet, tapes
    lower_tm.rs      # asm -> Machine (control-flow -> states; data -> tapes), generic over Encoding
    sim.rs           # simulator: run δ over tapes; Trace/Step/Status; step + tape-size caps
    decode.rs        # final tapes -> Value, type-directed (guided by the expected shape)
    syntax.rs        # parse_tm / print_tm (+ depth guard) — full round-trip
```

**Exposed downstream** (roadmap Plan 3 interfaces): `Machine`, `lower_asm`, `lower_tm`,
`simulate_trace` / `simulate`, `decode_tape`, `parse_tm` / `print_tm`, `print_asm`, `Encoding` +
`Unary`, `LowerError`, `Trace` / `Step` / `Status`. A convenience `run_tm(&Core, caps) -> TmRun` (lower
→ lower → simulate) backs the oracle; `TmRun` mirrors `LambdaRun` (`Ran { tapes }` / `HitCap` /
`LowerError`), and the caller decodes with an expected value.

## 12. Testing (system spec §10 — correctness is priority #2, the backbone)

1. **Three-way oracle (headline):** for the first-order demo suite, `reference::run(src) ==
   decode(λ) == decode_tape(TM)`. All three agree, including cap-hit outcomes. `map`/`fold` (higher-
   order) are excluded and revisited in Plan 3b, exactly as the two-way oracle excludes stateful
   closures.
2. **Intermediate oracles (the asm interpreter, §3.5):** `reference == asm-interp` and
   `asm-interp == TM-sim`, localizing any disagreement to Core→asm or asm→TM.
3. **Property-based (proptest):** a shared generator emits random **first-order** typed programs
   (excludes higher-order + stateful closures), with **`Nat` magnitudes and list lengths bounded <
   ~1500** so the λ backend can represent them (the Plan 2 cross-plan note). Run all three; assert
   agreement; treat every cap as the same outcome.
4. **Latent-trap oracle programs** (the Plan 2 follow-up): an immutable `let` shadowing a mutable
   variable, and a `fn` defined inside a mutation region.
5. **Golden tests:** sample program → expected `print_asm` and expected TM step count (system spec
   §10.5), mirroring the λ goldens.
6. **TM text round-trip (§7.2):** `parse_tm(print_tm(m)) == m` and `print_tm(parse_tm(s))` idempotent,
   over compiled demo machines and generated machines.
7. **Per-module unit tests:** each unary gadget (add/sub/mul/cmp) computes correctly; representative
   `lower_asm` outputs; `lower_tm` state-graph shape; decode recognizers; sim cap behavior.

## 13. Out of scope / follow-ups

- **Binary encoding (committed follow-on).** After unary ships the green three-way oracle end-to-end,
  add a binary storage/execution `impl Encoding` (second gadget library + goldens, flip it on) — reusing
  the entire harness — delivering the unary↔binary storage/execution **toggle** (toggling = recompile to
  a different machine). Plus a near-free **display toggle** (render stored unary as binary — pure
  presentation, no TM change) regardless. This is an explicit intended deliverable, not a maybe.
- **Defunctionalization + closures + higher-order** (`map`/`fold` receiving a function argument, closures
  as values) — **Plan 3b**: closure → tag + captured env on a tape, `apply` → jump table (system spec
  §5.3). The single biggest cost on the TM side; pre-authorized for phasing (system spec §13.3).
- **asm parser + asm text round-trip** — with the v2 visible-assembly pane (system spec §11).
- **View models, source maps, scrubbable trace, WASM** — Plan 4. The `sim` `Trace` and the
  provenance-carrying state names are the substrate Plan 4 builds on.
- **Binary/multi-tape simulation to single-tape, signed integers, graphical renderers** — v2 (system
  spec §11).
