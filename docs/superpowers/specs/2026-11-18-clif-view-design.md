# CLIF view — design

2026-11-18. The first piece of the IR views groundwork's §9
(`docs/superpowers/specs/2026-10-27-ir-views-groundwork-design.md`): a steppable, linked, read-only view of the
Cranelift IR (CLIF) that redextape's native backend builds from the rxm program. Lane record:
`~/temp/redextape-clif-view-record/`.

## §1 Intent, goals, anti-goals

**Why.** The native backends lower the rxm `Program` to CLIF and to LLVM IR, and the user wants to watch those
stages run in the browser, beside the λ, TM and rxm views that already do. The groundwork (#141 to #188) made a fifth
view mostly table entries; this piece adds the first one.

**Goals.**

- G1. A fifth view kind, `clif`, that lists the CLIF of the current program and steps it one CLIF instruction at a
  time, with scrubbing back, ↺, extend and share links as the other views have them.
- G2. Two listings of the same program, switched on the view's bar: **as built** (the CLIF redextape's lowering
  writes, before any Cranelift pass) and **optimised** (Cranelift's `speed` mid-end, which every opt level from
  O1 to Oz compiles). As built is the default.
- G3. The site stays as small as it is: no CLIF bytes are fetched until the user shows intent to open the view, and
  the main wasm module does not grow.
- G4. The run follows the native rules (native-rt's `Runtime`), not the rxm interpreter's, so the view shows what
  the compiled program does.
- G5. Links in both directions: a CLIF row links to its rxm instruction and source construct; a source construct or
  rxm instruction marks its CLIF rows.

**Non-goals.** CLIF copies (§9 piece 2). Machine code and the target picker (§9 piece 3, see D2). A CLIF grammar:
listing rows are coloured by CSS classes, as rxm's are (`rxm-pane.ts:224-235`); the grammar moves to piece 2, whose
copy editor is its first user. Two listings shown side by side (§10).

**Anti-goals** — it fails even if it works if:

- Loading the page, with the default workspace, fetches any CLIF file, or the main module (`pkg/`) gains any
  Cranelift code or grows by more than the `Program` export of §5.6.
- A second definition of what CLIF does appears (our own CLIF interpreter), or a second copy of the runtime's rules
  (ticks, depth, heap, caps, fault texts).
- The JIT's, AOT's or LLVM's generated code changes, other than what the 0.137.2 bump itself changes (§5.1).
- An existing view's behaviour changes, beyond the header gaining a fifth toggle and the help page naming five views.
- A compile waits on the CLIF leg, or rxm/TM/λ recording slows.

## §2 What exists

From two surveys of `8140a69` (the record's `survey-*.output`):

- **CLIF in wasm.** `module_free::build_clif(prog, TargetFrontendConfig) -> Result<Vec<Function>, LowerError>`
  (`crates/redextape-native/src/module_free.rs:62`) builds one `Function` per subroutine, named `u0:11+k`; the 11
  runtime imports are `u0:0` to `u0:10`. Every instruction carries its rxm pc as its srcloc; the prologue and exit
  carry none (`codegen.rs:16-17`, `:318-321`). The `clif` feature builds for wasm32 with no ISA, and the egraph
  optimiser and its ISLE rules are compiled in regardless of ISA. No value labels are set anywhere.
- **Optimising without an ISA.** `Context::optimize` takes `&dyn TargetIsa` (cranelift-codegen 0.137.1
  `context.rs:160`), but each step it runs is public and takes plain `Flags`: `eliminate_unreachable_code`,
  `remove_constant_phis`, `dfg.resolve_all_aliases`, `egraph_pass` (`:181-196`, `:282`, `:328`, `:361`). Only
  `canonicalize_nans`, off for us, needs an ISA. In all 72 programs of the snapshot gate
  (`crates/redextape-native/snapshots/*.clif`) the optimised CLIF is byte-identical for x86-64 and aarch64, at
  `none` and at `speed`, and `speed_and_size` equals `speed`.
- **The interpreter.** cranelift-interpreter's `Interpreter::call` runs to the end and recurses on the native stack.
  Its free `step::step(&mut dyn State, inst_context) -> ControlFlow` steps one instruction and hands calls and
  returns back to the caller; `Frame::get` panics on a value not yet set. The groundwork's spike (`~/temp/clif-spike`,
  0.134) stepped with it, catching runtime calls before `step`. crates.io has cranelift-codegen, -frontend,
  -interpreter and -reader at 0.137.2 (2026-11-16); main is on 0.137.1, and the interpreter must match codegen's
  version because it steps codegen's `Function` type.
- **The runtime.** native-rt's `Runtime` (`crates/redextape-native-rt/src/lib.rs:34-50`) holds a private
  `Heap<NoTags>`. `rt_tick` counts backward jumps only (`lower.rs:162-175`); `rt_enter`/`rt_leave` count depth
  against `depth_cap`; once stopped, every call is a no-op. `depth_cap` below `caps.stack`
  (`with_depth_cap`, `shared::native_depth_cap`) exists for the host stack only; `Runtime::new(caps)` sets
  `depth_cap = caps.stack`. `caps.mem` has no native equivalent.
- **Value labels.** `FunctionBuilder::set_val_label(val, ValueLabel)` works only after
  `func.dfg.collect_debug_info()`; `ValueLabel` is a bare u32. The CLIF printer never prints labels. The egraph
  keeps a label only on a value the optimised function still uses unchanged (aliases are resolved away, rewrites
  make new values).
- **The rxm leg.** `RxmLeg` (`crates/redextape-wasm/src/session.rs:303-405`) runs a throwaway cursor to the end at
  compile, then serves `status`, `rewind`, `step`, `state`, `value` from a fresh one. A frame is an `RxmState`
  windowed by `RXM_WINDOW` (`web/src/protocol.ts:59`). The worker records every frame of every leg up front, on
  every compile, whether or not the leg's view is shown (`record-loop.ts:181-190`), in chunks of 256 with a yield
  between, to `HISTORY_BYTES` (32 MiB) per leg; ▶ at the end or `[continue]` extends by `EXTEND_STEPS`. A
  per-leg re-record from step 0 exists as `rewind` (`protocol.ts:492`, `record-loop.ts:232`).
- **Adding a leg.** `tsc` flags each table a new `Leg` must fill (about 25: `protocol.ts`, `legs.ts`,
  `layout.ts`, `app-header.ts`, `linked-legs.ts`, `panes.ts`, `pane-host.ts`, `session-worker.ts`,
  `readout.ts`, `results.ts`, `transport.ts`, `buffer-list.ts`, `examples.ts`, `lsp-protocol.ts`). Hand-written
  per-leg code remains at 4 switches (`panes.ts:25`, `pane-host.ts:170`, `transport.ts:236`, `main.ts:2311`), 5
  `slot.binding.leg ===` spreads (`transport.ts:403/526/536/548`, `pane-host.ts:876`) and 3 copy checks in the
  worker (`session-worker.ts:364/731/779`).
- **Pane parts.** `MachineViewChrome` (header, step strip, ⋯ menu; *edit a copy* is omitted when
  `on.detachProgram` is absent), `ListingPanel` (rows by instruction index, `fillInstr(pc)`, `activate(pc)`,
  `setLink`, `setFocus`), `followedGridPanel`, `valuesPanel`, `callStackPanel`, `heapPanel` and `placeLabels`
  are reusable as they stand.
- **Links.** `Pin = {node, origin, pc?}` (`link.ts:186`). Two gaps from #187's roadmap entry are confirmed: M1, a
  new leg's row click is wired by hand (`transport.ts:526`) and `linkInstr` always records origin `'rxm'`
  (`link-wiring.ts:308`); M2, `rows(l: Link)` (`linked-legs.ts:31`) never sees `Pin.pc`, so a view cannot mark the
  one instruction clicked.
- **Loading.** The session worker imports `pkg/` statically (`session-worker.ts:31`). It holds one wasm occupant at
  a time, the session or one copy (`session-worker.ts:13-20`, `copy-build.ts:21-38`). No `import()` exists in
  `web/src`. `pkg-lsp/`, the language server's own module, is the precedent for a second package's build wiring.

## §3 Decisions

Taken with the user on 2026-11-18:

- D1. **Both listings, with a switch on the view's bar**, as built by default (option C of three).
- D2. **No target ISA in this piece.** The optimised CLIF is the same for every target (§2), so it is produced
  without one. The target picker, each target a download of its own fetched on intent, comes with machine code
  (§9 piece 3).
- D3. **Fetch on intent.** The CLIF package downloads when a pointer that moved onto the CLIF header toggle rests
  there, a press goes down on it, or the toggle takes keyboard focus, so it is usually ready by the click; opening the
  view any other way fetches it then. A toggle drawn under a pointer that has not moved is no intent.
- D4. **Approach 1** (§3.1).

Carried from the groundwork: D4 there (the `Program` crosses to the optional module by serde), D5 (the new view runs
in the session worker, its module loaded by `import()`; the one-occupant rule is generalised in this piece), D7
(values show the rxm register they belong to, in the rxm printer's names).

### §3.1 Approaches considered

| | Approach | Why not / why |
|---|---|---|
| 1 | Cranelift's interpreter stepping one instruction at a time, runtime calls into native-rt's `Runtime`, every frame recorded up front like the other legs | **Chosen**: one meaning of CLIF (Cranelift's), one runtime, and the history, extend, rewind and share-link machinery apply unchanged |
| 2 | Our own small CLIF stepper for the instructions our lowering and the optimiser emit | Rejected: a second definition of CLIF that can drift from Cranelift's; the download saving is small since codegen is still needed to build and optimise |
| 3 | Step on demand, the worker keeping a live stepper and checkpoints for going back | Rejected: none of the existing leg machinery applies, and the CLIF view becomes a special case again |

## §4 What the user sees

```
CLIF  [as built | optimised]                     ⋯  ✕
 step 412 / 3,180                      ⏮  ◀  ▶  ⏭
       u0:11
 pc0       v4 = iconst.i64 100
 pc1       v5 = iconst.i64 100
▶pc2       v8, v9 = umul_overflow.i64 v4, v5
 values             call stack      heap
 v4 = 100   a0      u0:11 main      …
 v5 = 100   r1
```

- **Header.** A fifth toggle, CLIF, after rxm; the view key 5. Off in the default workspace; stored workspaces and
  default arrangements are unchanged. A stored workspace or share link that shows a CLIF view fetches the package at
  page start.
- **Listing.** Every function of the program, in `build_clif`'s order, each line as Cranelift prints it in
  `func.display()`, except that the srcloc Cranelift prints as `@001a` (hex) moves to the row's pc column in the rxm
  view's decimal form, so a CLIF row and its rxm instruction show the same number. Function headers and block headers
  are label rows. By default each function is laid out as Cranelift prints a function with no source locations (its
  header, block headers and brace in one column, the rest four to the right), right of a gutter that holds the pc
  column, while *compact*, a checkbox in the view's `⋯` menu, is checked, as it is by default; unchecking it shows
  Cranelift's own columns instead. The choice is each view's, stored with the workspace as a λ view's display settings
  are; it moves a row's text and never changes it.
- **The switch.** *as built* and *optimised* on each CLIF view's bar. Its labelling says that optimised is Cranelift's
  actual output for O1 and up, the same for every target, and that as built is redextape's lowering before
  Cranelift's passes. Changing it re-records the CLIF leg alone from step 0.
- **Steps.** One step is one CLIF instruction, a runtime call (`call fn3(...)`) included; its effect shows in the
  heap panel. The step bar counts CLIF steps, so its count is not rxm's.
- **Values panel.** The current frame's values that have been set, each with its number, its tag, and, where a
  value label survives, its rxm register (`a0`, `r1`, `rr`). Unlabelled values show bare. Tags come from the runtime
  calls (§5.4), so a word no runtime call produced is a number: `nil` reads `0`, as it is in the compiled code.
- **Call stack panel.** Newest first; each frame names its function and the rxm subroutine's label (`u0:12 fact`),
  and the row it resumes at.
- **Heap panel.** Cells and boxes reachable from the shown values, with tags, as the rxm view's heap panel shows them.
- **End.** The run ends where the native program ends: its value, a fault's text, or the cap that stopped it,
  read the way the other views read theirs. At a cap the run stops at the runtime call that tripped it (it does not
  show the native exit path that follows), and `[continue]` works as the rxm view's does for the same cap (§5.4).
  The stepper's own frame memory is bounded by `caps.mem` (§5.5). Because it follows the native rules, it can differ from the rxm run
  where the groundwork's §2.2 lists the backends' differences (no memory cap; a callee's locals start at zero; after
  a faulted callee returns, the run goes on to its next guard).
- **Links.** Clicking a CLIF row with a srcloc pins its rxm instruction (origin `clif`, with that pc): the rxm view
  marks that one instruction, the source and TM views mark its construct, and the CLIF view marks every row with that
  srcloc. A source construct or rxm instruction pinned elsewhere marks the CLIF rows whose srcloc it covers. Rows with
  no srcloc link to nothing. In the optimised listing, merged instructions keep one srcloc, so some rxm instructions
  mark no CLIF row; that is expected and needs no message.
- **Loading and failure.** While the package downloads, the listing area says it is loading. If the download fails,
  it says so with a retry button; the other views are unaffected.
- **Menu.** No *edit a copy* (copies are piece 2).
- **Help.** `KIND_GLOSS` gains a CLIF line; the help page names five views, keys 1 to 5, and the switch.

## §5 Rust

### §5.1 Cranelift 0.137.2

All `cranelift-*` requirements move to 0.137.2, the version the interpreter is published at. The snapshot gate
(`codegen_snapshots.rs`) shows any change in generated code; any diff is explained in the PR's roadmap entry or the
bump stops. The x86-64 size baseline is rewritten only if sizes move. The interpreter's single-step API is confirmed
at 0.137.2 before anything is built on it.

### §5.2 Value labels

`build_clif` alone calls `collect_debug_info`, and the sink sets a label where it defines or reads a register
variable (`codegen.rs` `write_reg`, `read_reg`, the prologue's register setup). The label is the register's index
in one encoding beside `tm::reg_str`, decoded back to the rxm printer's name; no second naming scheme. The JIT, AOT
and snapshot paths do not collect, so their CLIF and code are unchanged; `module_free_clif_equals_the_module_paths`
keeps passing because the printer ignores labels.

### §5.3 Optimising without an ISA

A function in `redextape-native` under `clif` runs `Context::optimize`'s steps with plain `Flags` at `opt_level =
speed` (`optimize` skips the egraph at `none`). A native test holds its output, for every program in the snapshot
corpus, equal to that program's `speed: optimised` section. If they cannot be made equal, the work stops and comes
back to the user: D1's optimised listing was agreed on the condition that it needs no ISA.

### §5.4 One runtime, tags for the heap panel

`Runtime` becomes generic over core's heap `Tags` (`Heap<T>`, default `NoTags`), with an accessor for the heap. The
`extern "C"` `rt_*` functions, the JIT and LLVM stay on `Runtime<NoTags>`. The stepper uses `Runtime::new(caps)`
(no host-stack `depth_cap`) with `VecTags<WordTag>` and calls the same methods the `rt_*` wrappers call. Tags
flow from the runtime calls (a cons cell's words take its arguments' tags; `rt_head`, `rt_tail` and `rt_box_get`
return the stored tag; constants and arithmetic make plain numbers, as every runtime call does once a fault or a cap
has stopped the run); the rule is written once, beside the stepper's value tracking. A cap stop pauses at the call
that tripped it; `Runtime` gains the one method that undoes that call's own effect (a tick's or an enter's count)
and clears the stop once the cap is raised, so `Stepper::raise_caps` repeats the call under the raised cap and the
rule stays in `Runtime`. The view's `[continue]` raises the steps cap alone, so it resumes a steps pause and no
other, as the rxm view's does. Which cap tripped is read from which call tripped it. The compiled bodies of the
`rt_*` symbols in native-rt's staticlib are compared before and after and must be identical.

### §5.5 The package

A new crate (name left to the builder, §8), a `cdylib` built by wasm-pack into its own directory as
`redextape-lsp-wasm` is into `pkg-lsp/`. It depends on `redextape-native` with `--no-default-features --features
clif`, core and cranelift-interpreter. Given the serialised `Program` and the session's caps and a listing choice,
it builds the CLIF (optimising for *optimised*), prints the listing rows, and serves a leg with `RxmLeg`'s shape:
learn the end, `status`, `rewind`, `step`, `state` (a windowed frame), `value`.

The stepper keeps its own pc stack over `step`, does `Interpreter::block`'s bookkeeping (results, block params,
frame push and pop), tracks which values are set (`Frame::get` panics otherwise), and answers calls to `u0:0` to
`u0:10` through `Runtime`'s methods before `step` sees them. A Cranelift trap ends the run with the trap's name.

**Frame memory.** The interpreter allocates a slot for every value of a function on every call, so deep recursion
can use far more memory than native code would. As the JIT lowers its depth cap for the host stack, the stepper
stops a call that would take its frames past `caps.mem`, and the run ends as the rxm view's does at the memory cap.
The outcome check of §8 lists the corpus programs that end this way and holds that list fixed.

Listing rows come from Cranelift's own writer: a `FuncWriter` that delegates to `PlainWriter` per instruction, so
the rows joined equal `func.display()` for both listings.

**Speed.** The rxm leg runs to the end before its first frame is served. Before choosing, the builder measures the
stepper's steps per second, natively and in wasm, on the corpus's longest-running programs. If running ahead to the
end costs more than the rxm leg's run-ahead for the same program by a margin the measurement makes plain, the CLIF
leg reports its end when the recording reaches it instead. Either way the CLIF leg records after the other legs.

### §5.6 Crossing the `Program`

The session exports the compiled `Program` serialised (core's `serde` feature, groundwork D4), with the program's
type, which needs a `serde` derive of its own, since the end value is decoded by type. The worker passes both to the
CLIF package on each compile while a CLIF view is shown. The CLIF leg decodes its end value with the decoder the rxm
leg uses, moved where both packages can call it if it is not already. This export is the only growth of `pkg/`;
its size is measured and reported.

## §6 Web

- **The leg.** `'clif'` joins `Leg` and every table `tsc` names (§2). Each of the 12 hand-written sites gains its
  arm or is made table-driven where that is no harder.
- **Loading.** The session worker imports the package with `import()` the first time the page asks: on D3's intent
  (a pointer that moved onto the toggle resting there 150 ms, a press, or focus on it, through `watchIntent`), on
  showing a CLIF view, or at start when the workspace or share link shows one. The import is idempotent; nothing
  records on a prefetch. **THE REST STARTS AT THE FIRST `pointermove` ON THE TOGGLE, NOT AT `pointerenter`**: a
  browser sends `pointerenter` to a toggle drawn under a pointer that has not moved, as a page that opens or a header
  rebuilt under it is, and that is no intent.
- **One occupant.** The rule becomes: one session or one copy, plus, for a session, at most one CLIF stepper built
  from that session's `Program` and dropped with it. Copy workers never load the package.
- **Recording while shown.** Unlike the other legs, the CLIF leg records only while a CLIF view is on the page. The
  `run` request says whether one is; a CLIF view appearing later asks for a per-leg record from step 0, as `rewind`
  does. A hidden CLIF view keeps no history.
- **The switch.** The listing choice belongs to the program, as the TM width does: every CLIF view of a buffer shows
  the same listing. It is persisted as the TM width is, and a share link that carries a CLIF position carries it.
  Changing it re-records the CLIF leg from step 0 without recompiling.
- **The pane.** Built from `MachineViewChrome` (no copy editor mounted), `ListingPanel`, `valuesPanel`,
  `callStackPanel` and `heapPanel`, with its own row and frame builders on `placeLabels` (no second listing-row
  builder).
- **Links.** M1: the row click for any linked leg is wired from the leg tables, and the click records its own origin.
  M2: `rows` receives the `Pin` (or its pc), so the rxm view marks one instruction for a CLIF click and the CLIF view
  marks the rows of one srcloc. M3 (`draw.ts` asking `isLinkedLeg` three times) is left alone unless the pane's
  drawing makes it a real cost.
- **Header and help.** The toggle, key 5, `KIND_GLOSS`, help.html's view list, keys table and "all five";
  `pages.test.ts`'s `countWord` gains five.
- **Build wiring**, at each place `pkg-lsp` has one: workspace members (`Cargo.toml`), `web/package.json`'s build
  script and `build` chain, `.gitignore`, the `Dockerfile`'s wasm stage and copy, the `web` job in
  `.forgejo/workflows/ci.yml`, a `base|wasm` leg in `scripts/check-all.sh`, `scripts/comment-budget.json`,
  `.pre-commit-config.yaml` and `docs/development.md`. Licences: the crate joins `WASM_CRATES`
  (`web/scripts/licences.ts:44`), `web/src/third-party-licences.json` is regenerated, and the new `.wasm` joins
  `licences-scan.test.ts`'s `builds`.

## §7 Order

Two PRs, each with its own plan and roadmap entry:

1. **The package, no UI.** §5 in full and the build, CI and licence wiring; tests in Rust (native and wasm32). Its
   roadmap entry records the stepper's speed and the package's gzipped size.
2. **The view.** §6, the browser tests, and a Firefox run.

## §8 Verification

- **Generated code.** The snapshot gate after §5.1 (diffs explained) and unchanged after §5.2 and §5.4.
- **Optimised listing.** §5.3's equality over the whole snapshot corpus.
- **Native rules.** For every program of the native oracle corpus and the snapshot corpus, both listings, the
  stepper's outcome (value, fault text, or which cap) equals the JIT's at the same caps with `Runtime::new(caps)`,
  except the programs §5.5's frame-memory list names. `Stepper::raise_caps` after each cap's pause resumes to the
  outcome a fresh run under the raised caps reaches; the view's `[continue]` does so at a steps pause alone (§5.4).
- **Listing text.** The rows joined, with each pc column put back in Cranelift's `@xxxx` form, equal
  `func.display()`, both listings, every corpus program.
- **Runtime.** `rt_*` bodies identical (§5.4); native-rt's fault-text tests unchanged.
- **Size.** `cargo tree` for the main package shows no `cranelift-*` crate; `pkg/`'s gzipped growth is reported and
  is the §5.6 export alone; the new package's gzipped size is reported.
- **No fetch without intent.** A browser test loads the page with the default workspace, waits for the first compile
  to settle, and sees no request for the CLIF package; resting the pointer on the toggle, or focusing it, makes one;
  a workspace showing a CLIF view makes one at start. `watchIntent`'s own test holds that an element drawn under a
  still pointer fetches nothing, a pass fetches nothing, and a rest, a press and a focus each fetch, as does a rest on
  an element moved from under a resting pointer, which the browser sends no `pointerleave`. Each assertion is checked
  to fail when the behaviour is sabotaged.
- **Recording.** No CLIF frames are recorded while no CLIF view is shown; the other legs' frames are unchanged.
- **Links.** Each direction of §4's links, in both listings, including an rxm instruction that marks no optimised row.
- **Hot paths.** rxm recording and compile time measured with the groundwork's §7.2 harness
  (`~/temp/redextape-ab-harness/`) on a quiet machine, as before.

## §9 Left to the builder

- The crate's and package directory's names, and the `clif` view's toggle word.
- The serialiser for the `Program` crossing.
- The CLIF frame's fields beyond §4's panels, its window sizes and its byte charge for the history budget.
- The `ValueLabel` encoding, and where exactly labels are set, provided §5.2's paths are unchanged.
- How function and block headers enter `ListingPanel` as label rows.
- The intent delay, if any, before a resting pointer counts.
- Loading and failure wording.
- Run-ahead or report-the-end-when-reached, after §5.5's measurement.

## §10 Designer's calls

Settled by the designer, not the user; open to the user's correction:

- The listing choice belongs to the program, not to each view, following the TM width; two CLIF views cannot show
  the two listings side by side.
- The CLIF leg records only while a CLIF view is shown, so a closed CLIF view costs nothing per compile.
- CLIF is off in the default workspace and comes after rxm in the header, key 5.
- One step is one CLIF instruction, a runtime call included.
- The run uses `Runtime::new(caps)`: the session's stack cap without the host-stack lowering.
- The CLIF grammar moves to piece 2.
- `pkg/` may grow by the `Program` and type export (§5.6), measured, rather than the CLIF package compiling from
  source or re-parsing rxm text.
- Frame memory is bounded by `caps.mem`, ending as the rxm view does at that cap (§5.5).
- At a cap the run pauses at the tripping call and `[continue]` behaves as in the rxm view, instead of showing the
  native exit path with no way on (§5.4).
- Tags come only from runtime calls, so `nil` reads `0` (§4).
- The srcloc shows as a decimal pc column matching the rxm view, not Cranelift's hex `@001a` (§4).
