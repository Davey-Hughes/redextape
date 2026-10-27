# IR views groundwork — design

The rework that has to land before the browser can show more stages of the compiler. The user's request
(2026-10-27): add views for Cranelift IR (CLIF), LLVM IR and machine code beside source, λ, asm and TM —
steppable where possible, linked to the other views, and forkable into editable copies — **without creating
a second path that does essentially the same work differently**. Rework of existing code is welcome; parallel
implementations are not.

This document covers only the groundwork. It ships no new view. Every workstream in it removes duplication
that exists today, or generalises something written for exactly four views, so that the five feature pieces
after it (§9) are mostly configuration.

Code facts in §2 were read at `dec47bb` (#151).

## §1 Intent, goals, anti-goals

**Why.** The asm view already is redextape's own IR (the TM backend's middle stage). The native backends
lower that same asm `Program` to CLIF and to LLVM IR, and the user wants to watch those stages run in the
browser. Investigating how to add them found that the obvious route — write a CLIF pane, a CLIF leg, a CLIF
runtime and an LLVM text writer beside what exists — would add third and fourth copies of logic that is
already written twice.

**Goals.**

- G1. One per-instruction lowering walk from asm `Program` to native code, shared by the Cranelift backend,
  the inkwell LLVM backend, and (later, §9) the browser's LLVM IR text writer.
- G2. CLIF generation that builds for `wasm32-unknown-unknown` through the same code the JIT and AOT use.
- G3. One heap implementation (cells, boxes, the heap cap, their faults) in `redextape-core`, used by the asm
  interpreter and by the native runtime.
- G4. The web app's leg machinery driven by per-leg tables, so adding a leg is entries, not switch arms.
- G5. Pane building blocks extracted from the asm and TM panes, so a new pane composes them.
- G6. Layout and header handle any number of view kinds.
- G7. A link can name one asm instruction (pc), not only a source construct.
- G8. Shared Rust wire types, a serialisable `Program`, and one lowering of Core to asm per compile.
- G9. Rust dependencies bumped as far as they can safely move; web (pnpm) dependencies too, as a separate
  step (§4.1a).

**Non-goals.** No new view, pane kind, leg, wasm module, grammar or page. No change to what any existing view
shows or how it behaves, except where §8 lists one.

**Anti-goals** — it fails even if it works if:

- The native compiler stops building its LLVM IR through LLVM. **`llvm.rs` keeps building the module with
  inkwell's builder; LLVM builds, verifies, prints, optimises and JITs it. Nothing in the compiler parses
  text we wrote.** Our own LLVM IR text writer (§9, piece 4) exists only for the browser explorer.
- Generated code changes. Every refactor of the native backends is a no-op on the generated CLIF and LLVM IR
  (§7.1).
- A hot path gets slower: the browser's asm stepping/recording, native runtime calls, or compile time
  (§7.2).
- A second representation of something appears: a second owner column beside a pc column, a second
  register-naming scheme, a second fault-message table, a second listing-row builder.

## §2 What exists

### §2.1 Native backends

- Features: `default = ["cranelift"]`, which pulls jit, module, frontend, codegen, object and native
  (`crates/redextape-native/Cargo.toml:8-9`); `llvm = ["dep:inkwell"]` (`:10`).
- Backend-neutral: `analysis.rs` (`Subroutine`, `for_each_operand`, `reachable_from`, `partition`),
  `shared.rs` (`MAX_REGISTERS`, `reg_over_cap`, `param_count`, `n_arg_vars`, `native_depth_cap`), and in
  `lib.rs` `OptLevel`, the `Codegen` enum and `run_native_with` (`:160-231`). There is no trait seam: the
  "`Codegen` seam" is the enum plus a `match`.
- `codegen.rs` builds CLIF: `declare_rt` (`:154-178`), `declare_subroutines` (`:185-198`), `read_reg`/
  `write_reg` (`:203-233`), `emit_cmp`, `emit_bin`, `emit_guard`, `translate_subroutine` (`:290-499`). All
  take `&mut dyn cranelift_module::Module`, but use only `declare_func_in_func`, `make_signature`,
  `declare_function` and `target_config()`. `Module` requires `isa()`, which a wasm32 build has no host ISA
  for — that, not the IR building, is what keeps CLIF generation off wasm32.
- `llvm.rs` copies `codegen.rs` arm for arm (its own doc, `:5`, `:628-640`) with separately written code:
  the same decisions (tick when `target <= idx`; `rt_enter` before a call and `rt_leave` after;
  `rt_faulted` after every op that can fault or allocate; `Halt`/`Ret` return `rr`; register bank sizing),
  different spellings (Cranelift `Jz` is `brif(cond, next, target)`, LLVM is `icmp eq 0` + `br`; saturating
  add/sub are `uadd_overflow`/`select` and `umin`/`isub` vs `llvm.uadd.sat`/`llvm.usub.sat`).
- The runtime symbol list is written four times: `codegen.rs:165-177`, `jit.rs:83-93`, `llvm.rs:296-308`,
  `llvm.rs:316-328`.
- Registers: Cranelift declares `Variable`s Arg, then Loc, then Rr (`codegen.rs:321-337`); LLVM allocas
  are named `a{i}`, `l{i}`, `rr` (`llvm.rs:594`, `:608`, `:612`) while the asm printer names locals `r{n}`
  (`tm/asm.rs:157-163`, `reg_str`, `pub(crate)`).
- Neither backend sets `set_srcloc` or `set_val_label`.

### §2.2 Two heaps

- `redextape-native-rt`'s `Runtime` (`lib.rs:33-49`): `heap: Vec<(u64,u64)>`, `boxes: Vec<u64>`, `steps`,
  `depth`, `caps`, `depth_cap`, `fault: Option<String>`, `hit_cap`. The `rt_*` functions are `unsafe extern
  "C"` over `*mut Runtime` (`rt_cons` `:100-111`, `rt_head`/`rt_tail` `:120-165`, `rt_is_empty`
  `:174-176`, `rt_box` `:185-196`, `rt_box_get`/`rt_box_set` `:210-254`, `rt_tick` `:263-279`,
  `rt_enter`/`rt_leave` `:295-321`, `rt_faulted` `:332-335`, `rt_run` `:467-504`).
- The asm interpreter's private `Vm` (`trace/asm_cursor.rs:101-127`) keeps its own `heap`, `heap_tags`,
  `boxes`, `box_tags`; `cell` (`:173-182`) and `box_slot` (`:187-195`) look up with the same fault strings,
  formatted separately; the heap cap check is at `:282` and `:308`.
- They agree only end to end: `jit.rs` `agree_caps_at`, `llvm.rs` `agree_caps`, `tests/native_oracle.rs`,
  and native-rt's own fault-string unit tests.
- **Differences that are not heap and stay** (§4.3): the asm interpreter counts every instruction as a step,
  native ticks only backward edges and calls (`codegen.rs:26-34`); only asm has the mem cap; the stack cap
  is `stack.len() >= caps.stack` in asm and `depth > min(caps.stack, safe_depth)` natively; a callee
  inherits the caller's locals in asm (`asm_cursor.rs:259-261`) and starts them at zero natively
  (`codegen.rs:328-334`, `llvm.rs:606-611`); malformed programs fault at run time in asm and are refused as
  `LowerError` natively; after a faulted callee returns, native runs on to its next guard.

### §2.3 The wasm session (Rust)

- No leg trait. λ has `LambdaLeg` (`session.rs:620-664`); TM is a tuple on `Session.tm` (`:381`) and loose
  fields on `TmScratch` (`:1754-1761`), and its cursor-to-`RunStatus` match is written three times
  (`:1008-1012`, `:1871-1875`, `:2004-2008`); asm has `AsmLeg` (`:475-584`), shared by `Session` and
  `AsmScratch`.
- `RunStatus`, `Decoded`, the per-leg status structs, `decoded_value`/`decoded_or_undecodable`/`asm_fault`/
  `grouped`, and `to_value` with `serialize_missing_as_null` (`lib.rs:385-388`) are private to `redextape-wasm`
  (re-exported only under `ts`, `lib.rs:31-32`).
- `Program`, `Instr`, `Reg`, `Caps` derive no serde (`tm/asm.rs:19`, `:27`, `:65`, `:444`).
- Each compile lowers Core to asm three times: for the `SourceMap` (`:826`), in `run_tm_described`, and in
  `build_asm_leg` (`:508-513`, which calls itself "a third lowering"); a test holds them equal
  (`sourcemap.rs:337`).
- The size-ceiling-then-parse prologue of a scratch build is written twice (`:1477-1484`, `:1825-1836`).

### §2.4 The web leg machinery

Generic already: `Leg`/`LEGS`/`perLeg`/`unhandled` (`legs.ts`), `RecordLeg`/`recordLeg` (`record-loop.ts`),
`History`/`LegState`, `PaneSlot`/`PaneCollection`, `resetLegs`, `controlState`, `stepControls`, the step
bar, `extend(leg)`, share-link `Positions`, link-status's `DetachedPanes`.

Written once per leg — about 60 sites in about 20 files. The heaviest:

- `protocol.ts`: per-leg scratch requests, `*-scratch-compiled`, `tm-value`/`asm-value`, per-leg fields on
  `compiled` (`:601-672`), three `*-frames` variants (`:673-675`), per-leg frame-bytes functions.
- `session-worker.ts`: three `*_RECORDING` objects (`:363`, `:394`, `:431`) each switching over every
  `live.kind`; `onRun`'s per-leg fields and record calls (`:537-606`); three `on*Scratch` handlers
  (`:635`, `:700`, `:771`) with the reset prologue copied four times; `onExtend`'s per-leg arms
  (`:818-866`).
- `replies.ts`: the `*-frames` arms copied six times (`:339-362`, `:623-653`); per-leg scratch arms.
- `pane-host.ts`: six switches over kind (`:160-180`, `:927-940`, `:1423-1460`, `:1539-1665`,
  `:1805-1818`, `:1853-1866`) plus per-leg spreads.
- `draw.ts` (~8 per-leg blocks), `transport.ts` (`NO_TEXT` and four spreads), `scratch.ts` (three
  switches), `pane-chrome.ts` (per-leg optional handlers), `link-wiring.ts`, `link-status.ts`,
  `readout.ts`, `results.ts`, `SessionEntry`'s `tmProgram`/`tmScratch`/`asmProgram`/`asmScratch`.

Per-leg *encodings* are deliberate and stay: λ frames cross as one byte string (#137); frame byte counts
differ per leg.

`session-worker.ts` is excluded from coverage (`vite.config.ts:161`), and the codebase keeps logic out of it
(`record-loop.ts:5-9`). It documents a "one occupant" invariant for wasm handles (`:14-21`, `:245-248`).

### §2.5 Panes

`AsmPane` holds a listing `VirtualGrid` (labels, pc, mnemonic, runs-next marker, linked/focus marks,
follow/re-attach), a registers panel, a call-stack panel, a heap panel, a `CopyEditor`, `PanelStack`
regions, header/menu/steps and `EditablePane` delegates. `TmPane` repeats the header/steps/menu
construction (asm `:116-137` vs tm `:175-204`), the `EditablePane` delegates (`:342-375` vs `:547-596`) and
the bindings/layout/steps setters. Two label-placement row builders exist: `listingRows`
(`asm-view.ts:20`) and `programRows` (`program-level.ts:35`).

### §2.6 Layout

`defaultArrangement` destructures four kinds (`layout.ts:139-150`) and silently drops a fifth. The header
toggles are hand-written in `index.html:27-30`; `viewToggles` throws when a kind has no button
(`app-header.ts:297-298`). Tests pin four: `harness.test.ts:85`, `arrangements.test.ts` (15 combinations),
`view-keys.test.ts:43`, `pages.test.ts:130`, `examples.test.ts:38-42`, `replies.test.ts:755`. Persistence
validates kinds against `KIND_ORDER`, so new kinds need no version bump.

### §2.7 Linking

`SourceMap` (`sourcemap.rs:45-74`) → `LinkIndex` (`viewmodel.rs:873-923`) with owner columns `tm_owner`
(by state) and `asm_owner` (by pc). `Pin = {node, origin}` (`link.ts:184`): every link is pinned by Core
node. The TM leg already knows each state's pc (`tm_name_to_instr`, `StateView.instr`) but uses it only for
display. `link-wiring.ts` `setLinkTo` (`:189-261`) and `draw.ts` (`:182-198`, `:247-279`) fan out by hand per
leg; `link-status.ts` has one clause per leg. Copies are unlinked by design.

## §3 Decisions

Taken with the user on 2026-10-27:

- D1. **One lowering walk, many sinks.** The per-instruction decisions live once; Cranelift and inkwell
  each spell them. The compiler keeps inkwell (anti-goal 1). The browser's LLVM text writer is a later sink
  checked in CI against inkwell's module.
- D2. **One heap core in `redextape-core`**, limited to the heap, generic over a tag recorder that compiles
  away for native code.
- D3. Machine code (piece 3) is a panel inside the CLIF view, not its own kind — so the groundwork needs no
  non-leg pane kind.
- D4. The compiled `Program` crosses to an optional module by serde (option 2), not as asm text to re-parse.
- D5. New views run inside the existing session worker, their wasm module loaded by `import()` on first use
  (approach A). The worker's one-occupant invariant is generalised in piece 1, not here.
- D6. Bump dependency versions as far as they safely move.
- D7. Values in CLIF/LLVM views show the asm register they belong to where known, using the asm printer's
  register names.

### §3.1 Approaches considered

| | Approach | Why not / why |
|---|---|---|
| A1 | Write CLIF/LLVM views beside existing code; a view-only LLVM writer kept honest by a CI test | Rejected: third independent lowering, a third heap, ~60 more per-leg sites |
| A2 | Make our LLVM text writer the compiler's source and parse it in `llvm.rs` | Rejected by the user: the compiler must build its IR through LLVM |
| A3 | Shared lowering walk with backend sinks; shared heap core; table-driven legs | **Chosen** |

Heap alternatives (D2): (a) steppers reuse native-rt and asm keeps its `Vm` — rejected, it keeps two heaps
and the CLIF/LLVM heap panels would lack tags unless a third path tracked them. (b) one heap core — chosen.

## §4 Rust workstreams

### §4.1 Dependency bumps (G9)

In this order, each its own commit with the full checks green:

0. *(Designer's call, §11.)* `tests/size_baseline.rs` has only `baselines/aarch64-apple-darwin.txt` and
   skips on any other triple, so on Linux (CI and the development machine) it checks nothing. First add an
   `x86_64-unknown-linux-gnu` baseline taken on the current versions, so step 2's deltas are measured. The
   macOS baseline is refreshed only if a Mac run is available, and its absence is recorded.
1. `cargo update` within existing requirements (cranelift 0.134.2 → 0.134.4, wasm-bindgen 0.2.126 → 0.2.129,
   and the rest of the dry run). Raise the `wasm-bindgen = "0.2.126"` floors in `redextape-wasm` and
   `redextape-lsp-wasm` to what the lock holds. wasm-pack fetches the CLI matching the lock; confirm the
   Dockerfile and CI install paths still agree.
2. Cranelift 0.134 → the newest release (0.137 at writing). API changes are expected (the spike hit
   `FunctionBuilder::finalize` taking a `TargetFrontendConfig` and `icmp_imm`/`iadd_imm` deprecations).
   The generated-code snapshots of §7.1 will move, because Cranelift's own output changes between
   releases: take the snapshots *after* this bump, and require the oracle tests and the size baseline
   (`tests/size_baseline.rs`) to pass, recording size deltas in the roadmap entry.
3. inkwell 0.9 → the newest release (0.11 at writing), **only if** it supports LLVM 22.1 (the CI's pinned
   LLVM); otherwise stay and record why.
4. tree-sitter crate 0.26 → 0.27, only if the grammars' pinned 0.25.10 CLI output still loads and every
   grammar check passes; otherwise stay and record why.

A major bump that fails its checks is left out and recorded, not forced.

### §4.1a Web dependency bumps (G9)

A separate step from §4.1, decided by the user on 2026-10-27: bump `web/`'s pnpm dependencies as far as they
safely move, by the same rule — within existing ranges first, then each major upgrade on its own with the
full checks green (unit, browser tier, coverage floors, `check-licences.sh` with `third-party-licences.json`
regenerated by `web/scripts/licences.ts`, never by hand), and a major bump that fails is left out and
recorded. Includes `web-tree-sitter` only if the grammar wasm built by the pinned 0.25.10 CLI still loads.
It touches no Rust and no behaviour, so it may land before or after any other PR.

### §4.2 One lowering walk (G1, G2, D1)

**Shape.** A backend-neutral walk over one `Subroutine` that drives a sink trait. The walk owns every
decision §2.1 lists as duplicated: block-per-pc layout, when to tick, `rt_enter`/`rt_leave` placement, which
ops are followed by a fault check, how `Halt`/`Ret` return `rr`, register bank sizing and zeroing, argument
passing. The sink owns spelling: how a saturating add, an unsigned compare, a conditional branch or a
runtime call is expressed in its IR. A sink method is at the level of "saturating add of two words", not of
IR instructions, so Cranelift and inkwell keep their current spellings.

- The walk is generic over the sink (`fn lower_subroutine<S: LowerSink>(…)`), monomorphised — no list of
  steps is materialised, so compile time does not move (§7.2).
- The runtime import table (names, arities, return kinds) is defined once and used by both backends,
  `jit.rs`'s symbol registration and `llvm.rs`'s `rt_symbols`/`map_rt_symbols`.
- Register naming comes from one place: export the asm printer's `reg_str` (or its equivalent) from
  `redextape-core`; LLVM allocas take the asm names (`r{n}`, `a{n}`, `rr`) instead of `l{i}`. This changes
  LLVM value names only — the snapshot gate (§7.1) treats this one rename as the expected diff, made in its
  own commit.
- The walk calls `set_srcloc(pc)`-equivalent on the sink before each instruction; the Cranelift sink sets
  `FunctionBuilder::set_srcloc(SourceLoc::new(pc))`. This is invisible to the native run and is what pieces
  1 and 3 link by. Whether it changes the emitted machine code at all is checked by the snapshot gate; if it
  does, record it.

**Cranelift off `dyn Module`.** Replace the `&mut dyn Module` parameter with a small seam that supplies a
`TargetFrontendConfig` and turns an entry index or runtime name into a `FuncRef` (what
`Module::declare_func_in_func` does: `import_signature`, `declare_imported_user_function`,
`import_function`). `jit.rs` and `aot.rs` implement it over their `Module`. **This groundwork also ships the
implementation that needs no `Module`** *(designer's call, §11)*: it numbers functions exactly as the
`Module` path does (runtime imports first, then subroutines, in declaration order) and takes its
`TargetFrontendConfig` and calling convention from its caller. A native test builds every corpus program both
ways for the same fixed target and requires byte-identical CLIF, so piece 1 inherits a proven "this is the
compiler's CLIF" rather than building it. Which target and calling convention the browser shows is piece 1's
decision. Split the features so `clif` = `cranelift-codegen` (default features off) +
`cranelift-frontend`, and `cranelift` = `clif` + jit, module, object, native. `analysis`, `shared` and the
walk build under `clif` alone.

**Checks.** `scripts/check-all.sh` and CI gain a wasm32 check of `redextape-native` with
`--no-default-features --features clif` and of `redextape-native-rt` (§4.3).

### §4.3 One heap core (G3, D2)

**Scope.** In `redextape-core`: cons cells and boxes, the heap cap (cells and boxes share it, as today), and
the faults — `head`/`tail` of empty list / of invalid list pointer, `box_get`/`box_set` of null handle /
of invalid handle — as one fault type whose `Display` is the message, defined once. The 32-bit-safe index
conversion (`usize::try_from(p - 1)`) moves with it.

**Tags.** Generic over a recorder: the asm interpreter's recorder keeps `heap_tags` and `box_tags` exactly as
`Vm` does now; native-rt's is a zero-sized no-op. Tags are read after the heap decides, as today ("a missing
tag changes what the view shows and never what the program does", `asm_cursor.rs:170-172`).

**native-rt.** `Runtime` holds the heap core. Each `rt_*` body becomes a safe `impl Runtime` method;
the `extern "C"` functions become thin wrappers. `stopped()`, ticks, depth and `rt_faulted` stay
native-rt's — they are native semantics, not heap. `rt_run` (spawns a thread) is `cfg`'d out of wasm32
builds. Add a wasm32 check of `redextape-native-rt`.

**asm interpreter.** `Vm` holds the heap core with the tagging recorder; `Instr::Cons`/`Head`/`Tail`/
`IsEmpty`/`Box`/`BoxGet`/`BoxSet` go through it. Register tags, `written`, frames and the mem cap stay in
`Vm`.

**Not unified, and recorded instead** (§2.2's list): step counting, the stack-depth rule, callee locals,
malformed-program handling, behaviour after a fault. A short section in the native crate's doc (and later the
technical page, piece 4) states each and why.

### §4.4 Shared wire types and the session (G8)

- Move `RunStatus`, `Decoded`, the status structs' shared shape, the `decoded_*`/`grouped` helpers and
  `to_value` out of `redextape-wasm` into a place a second wasm crate can depend on: `redextape-core` behind
  its `serde` feature, or a small new crate (builder's call, §10). ts-rs bindings keep coming from one place.
- `Program`, `Instr`, `Reg`, `BinOp`, `Caps` derive `Serialize`/`Deserialize` behind core's `serde` feature.
- One TM cursor → `RunStatus` mapping, replacing the three.
- One scratch-build prologue (size ceiling, parse, diagnostics), replacing the two.
- **One lowering per compile.** Lower Core to asm once in `compile_with_caps`; the `SourceMap`, the TM run
  and the asm leg all take that `Program`. The equality test (`sourcemap.rs:337`) becomes unnecessary for
  the session path; keep it if other callers still lower separately.
- A Rust leg trait is **not** required by this design; extract one only if it removes the duplication above
  more simply than functions do (builder's call).

## §5 Web workstreams

### §5.1 Table-driven legs (G4)

Pure refactor; behaviour unchanged. Targets, from §2.4:

- One `{kind: 'frames', leg, …}` reply, with a `FRAME_BYTES`/encoding table keyed by `Leg`, used by the
  worker and `replies.ts`. Each leg keeps its own encoding and transfer list.
- A `RECORDINGS: {[L in Leg]: …}` table; `RecordLeg` gains the raise-cap rule so `onExtend` is one lookup and
  `onRun` loops over legs. The per-leg logic lives outside `session-worker.ts` (coverage).
- One scratch request carrying `leg`, one reset helper; the four copies of the reset prologue go.
- `compiled`/`result`/`SessionEntry` carry per-leg programs and statuses keyed by `Leg`
  (`programs: {[L in Leg]?: …}`), with a `Record<Leg, seed>` for pane seeding.
- `pane-host.ts`, `draw.ts`, `transport.ts`, `scratch.ts`, `pane-chrome.ts`, `readout.ts`, `results.ts`:
  per-leg switches become table lookups where the arms differ only by leg. Switches whose arms genuinely
  differ stay, still ending in `unhandled`, so `tsc` keeps naming every site a new leg must decide.

**Done when** the number of places a new leg must touch is counted and recorded in the roadmap entry, against
§2.4's ~60.

### §5.2 Pane building blocks (G5)

Extract from `AsmPane` and `TmPane`, then have both use the extractions:

- `MachineViewChrome` (working name): header, steps, menu, `CopyEditor`, `EditablePane` delegates,
  bindings/layout/steps setters — the code §2.5 lists as repeated.
- `ListingPanel`: the `VirtualGrid` listing with labels, pc, runs-next, linked/focus marks and re-attach,
  generic over `{listing, labels}` plus a per-row fill. One label-placement row builder: `listingRows` and
  `programRows` become one.
- Values, call-stack and heap panels as components taking row data, with the asm-specific pieces
  (`registerRows`, `calleeOf`, `wordText`) passed in. The heap panel reads the heap core's tagged view (§4.3).

No visual change; the browser tier's existing pane tests are the check, plus a walkthrough (§7.3).

### §5.3 Layout for N kinds (G6)

- `defaultArrangement` takes any number of kinds with a general rule that reproduces today's arrangements
  for every combination of the current four exactly.
- The header toggles are generated from `HEADER_ORDER`; `index.html` keeps a container only.
- Tests that pin four are rewritten to derive from the tables, with unit tests of `defaultArrangement` over
  synthetic kind lists of 5–7.
- View keys stay `1`…`N` (works to 9).

### §5.4 Links by instruction (G7)

- `Pin` can name an asm pc as well as a node. A pc pin resolves to its node through `asmOwner` in one place
  (`link.ts`), never through a second column.
- `link-wiring.ts`, `draw.ts` and `link-status.ts` fan out over a table of linked legs, not one block per
  leg.
- **Existing behaviour is kept**: clicking an asm instruction still pins its node and highlights every asm
  instruction of that node, as now. The pc is carried so later views can mark exactly their instruction; using
  it to narrow the asm or TM highlight is a separate decision, not taken here.

## §6 Order

Four pull requests, each with its own plan and roadmap entry:

1. **§4.1 bumps** — first, so every later snapshot and benchmark is taken on the final versions.
2. **§4.2 lowering walk + §4.3 heap core** — native and core; gated by §7.1 and §7.2.
3. **§4.4 + §5.1** — wire types, serde, one lowering per compile, table-driven legs.
4. **§5.2 + §5.3 + §5.4** — panes, layout, links.

3 and 4 may swap; 2 does not depend on 3 or 4. The web dependency bumps (§4.1a) are their own pull request,
independent of all four; if they land before PR 3 or 4, those PRs' browser measurements are taken after
them.

## §7 Verification

### §7.1 Generated code does not change

Before PR 2, after PR 1's bumps, add a snapshot test over every program in the native oracle corpus and the
`FIRST_ORDER_DEMOS`/examples set. *(Designer's call, §11.)* So that one set of snapshots holds on every
host, the snapshots use **fixed targets, never the host**: Cranelift ISAs looked up by name
(`x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu`, fixed flags, so the test enables
cranelift-codegen's `x86` and `arm64` features); LLVM with the triple and datalayout fixed to
`x86_64-unknown-linux-gnu`. Captured, per program:

- the CLIF of every function as built (`Function::display`), once — it does not depend on `OptLevel`;
- the CLIF after Cranelift's optimiser and the machine code (`CompiledCode` disassembly, `set_disasm(true)`),
  per target and per Cranelift opt level;
- the LLVM module as built (`print_to_string`, before the passes), once, and after the passes per
  `OptLevel`.

Every PR 2 commit keeps every snapshot byte-identical except two commits, each alone and each with exactly
the diff named: the LLVM alloca rename (§4.2), whose diff is value names only; and the `set_srcloc` commit,
whose diff is the `@xxxx` source-location annotations in CLIF and nothing in machine code or LLVM. The
snapshot test stays in the suite (the LLVM half in the `rust-llvm` job).

Plus the existing oracles unchanged: `native_oracle.rs`, `llvm_oracle.rs`, `aot_oracle.rs`, `jit.rs`/
`llvm.rs` unit tests at all six levels, native-rt's fault-string tests.

### §7.2 No hot path slows

Measured before and after on the same machine — the x86-64 Linux development machine unless the user says
otherwise — recorded in the roadmap entry with the machine and the command:

- browser asm stepping and recording (the existing probes that measure asm rings, e.g. the warm-buffer and
  share-positions probes);
- native runtime-call-heavy programs (list and box builders) under JIT at O0 and O3, both backends;
- native compile time over the corpus.

A slowdown beyond run-to-run noise blocks the PR until explained or removed. The heap core's no-op recorder
must compile to the same per-call work native-rt does today.

### §7.3 The app behaves the same

Full `scripts/check-all.sh`, the browser tier, coverage floors unchanged or raised, and a walkthrough of the
app in a browser after PRs 3 and 4 (this codebase has repeatedly found defects that a green suite missed —
roadmap, 5d-ii-a and 5d-ii-c entries).

## §8 Behaviour changes

Only these, each deliberate:

- LLVM allocas named after asm registers (`r{n}`, `a{n}`, `rr`) — visible only in LLVM IR.
- Cranelift source locations per instruction — no runtime effect.
- Whatever the Cranelift/inkwell bumps change in generated code — recorded, oracle-checked.

## §9 What follows (not in this design)

Each gets its own brainstorm, design and plan, in this order:

1. **CLIF view** — steppable, linked, read-only: the optional wasm module and lazy load (D5), the worker's
   second occupant, a resumable driver over `cranelift_interpreter::step` intercepting runtime calls into
   native-rt's `Runtime`, a CLIF grammar, values annotated with asm registers via `set_val_label` side
   tables (D7), "Cranelift's actual output" labelling, the optimised CLIF.
2. **CLIF copies** — `cranelift-reader` parse in the optional module (spike: builds and steps in wasm).
3. **Machine code** — x86-64 / ARM64 text panel in the CLIF view (D3), its own optional download (~800 KB
   gzipped in the spike), linked through Cranelift srclocs.
4. **LLVM IR view** — our text writer as a sink of §4.2's walk, our stepper, the CI check that LLVM parses our
   text into the module inkwell builds (before target setup), the technical page and/or source link.
5. **LLVM copies** — a parser for the subset.

Separately: the roadmap entry "Say what 'asm' is, in the UI" (2026-10-27).

The spike behind these is `~/temp/clif-spike` on the development machine, not committed (and
`~/temp/clif-spike-noisa`, the same with no ISA, for the ~150 KB figure): CLIF built with `cranelift-frontend`,
stepped one instruction at a time in wasm with a runtime import intercepted, parsed back with
`cranelift-reader`, and compiled to x86-64 and aarch64 text in wasm. Sizes gzipped: ~150 KB for CLIF and the
stepper, ~985 KB with both ISAs and the reader; the app's current module is ~316 KB.

## §10 Left to the builder

- Where the shared wire types live: core's `serde` feature or a new small crate.
- The exact `LowerSink` method set, provided §4.2's split of decision vs spelling holds.
- Whether a Rust leg trait helps.
- Names: `MachineViewChrome`, `ListingPanel`, `LowerSink`, the feature `clif`.
- How `defaultArrangement`'s general rule is expressed, provided it reproduces the four-kind arrangements.
- Which existing probes serve §7.2, provided each hot path is covered.

## §11 Designer's calls

Settled by the designer after a builder's review, not by the user; open to the user's correction:

- §7.1: snapshots on fixed targets (x86-64 and aarch64 Linux for Cranelift, x86-64 Linux for LLVM) so they
  are host-independent; the snapshot covers machine code too; the `set_srcloc` commit is a second allowed
  diff, limited to CLIF annotations.
- §4.2: the `Module`-free Cranelift path ships in this groundwork, proven byte-identical to the `Module`
  path by a native test.
- §4.1 step 0 and §7.2: an x86-64 Linux size baseline is added before any bump; measurements are taken on the
  x86-64 Linux development machine.
