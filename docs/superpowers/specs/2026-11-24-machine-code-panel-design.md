# Machine code panel — design

2026-11-24. The third piece of the IR views groundwork's §9
(`docs/superpowers/specs/2026-10-27-ir-views-groundwork-design.md`), and the target picker the CLIF view's D2 deferred
to it (`docs/superpowers/specs/2026-11-18-clif-view-design.md`): the x86-64 or arm64 code Cranelift makes from the
program, as a panel inside the clif view, linked to the clif rows and the rxm instructions through Cranelift's source
locations. Written against `main` at `b627fe3`. §3's Q1 to Q4 were answered on 2026-11-24 with every pick, and Q5,
an AT&T and Intel toggle, was added the same day.

## §1 Intent, goals, anti-goals

**Why.** The clif view shows the IR the native backend builds and steps it. The last stage between that IR and what the
CPU runs, Cranelift's instruction selection, register allocation and emission, is not visible anywhere on the site. The
user wants it beside the IR it came from, so that a clif row, an rxm instruction or a source construct can be traced to
the instructions it became.

**Goals.**

- G1. A *machine code* panel in each clif view, showing the code Cranelift emits for every function of the program on
  one target at a time: x86-64 or arm64.
- G2. The panel follows the view's listing switch: *as built* shows the code at Cranelift's `opt_level = none` (what O0
  compiles), *optimised* the code at `speed` (what O1 to Oz compile). Both are the code the snapshot gate
  (`crates/redextape-native/snapshots/*.clif`) holds, byte for byte.
- G3. Each target is a download of its own, fetched on intent: when the pointer rests on that target's choice or the
  choice takes focus. Nothing of either is fetched by loading the page or by opening a clif view.
- G4. Links in both directions at the rxm pc: a machine instruction with a source location links its rxm instruction,
  as a clif row does; a pin elsewhere marks the machine instructions of the pcs it covers.
- G5. The panel marks the machine instructions of the clif run's current instruction, so a step shows where the run is
  in the machine code too.

**Non-goals.** Stepping or emulating machine code, and machine registers or memory. A third target, the host's own
target, or Apple's arm64 ABI. LLVM's machine code (it belongs with the LLVM IR view, §9 piece 4 of the groundwork).
Copies of the code (the app has none: §9's CLIF and LLVM copies were withdrawn with them, Q3 of
`docs/superpowers/specs/2026-11-23-remove-copies-design.md`). Editing or exporting the code.

**Anti-goals** — it fails even if it works if:

- Loading the page, opening a clif view, or stepping one fetches any machine code package; or resting on one target's
  choice fetches the other's.
- `pkg/` or `pkg-clif/` grows, or a `cranelift-*` ISA crate enters either.
- A second set of Cranelift flags appears: the panel's code differs in any byte from what the JIT's flags
  (`codegen::jit_flags`) make on the snapshot's targets.
- The JIT's, AOT's or LLVM's generated code, or any snapshot, changes.
- The clif view's recording, stepping, listing or links change for a view whose panel is closed, or the rxm, TM or λ
  views change at all.

## §2 What exists

- **The snapshot's machine code.** `codegen_snapshots.rs` compiles each corpus program through `define_all` over an
  `ObjectModule`, on `x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu` (`TARGETS`, `:100`), at `none`, `speed`
  and `speed_and_size`, with `codegen::jit_flags` (`use_colocated_libcalls = false`, `is_pic = false`, `opt_level`) and
  no host CPU features (`fixed_isa`, `:303`). Each function's section is a `;; function u0:N: <size> bytes, fnv1a64
  <hash>` line and Cranelift's vcode text (`ctx.set_disasm(true)`). In every file `speed_and_size` equals `speed`.
- **Cranelift's vcode text is not the code.** It is printed as each VCode instruction is emitted
  (`machinst/vcode.rs:839-866` in cranelift-codegen 0.137.2), so it carries no offsets and no source locations, keeps
  pseudo-instructions (`unwind …`, `load_ext_name`, `uninit`) and prints branches the `MachBuffer` later threads away
  (fact's `jmp label1` to `jmp label4` chain is four jumps in the text and none in the bytes). A line of it cannot be
  tied to a byte range, so it cannot be linked.
- **What the bytes carry.** `CompiledCode::buffer` gives the code bytes, `get_srclocs_sorted()` (`buffer.rs:1936`), the
  ranges of code each source location covers, relative to the function's base source location
  (`RelSourceLoc::expand`, `ir/sourceloc.rs:78`), and `relocs()` (`:1992`), each call's or address's target as a
  `u0:N` name. Every clif instruction carries its rxm pc as its source location; the prologue and the exit path carry
  none (clif view design §2).
- **A compile without a `Module`.** `build_clif(prog, config)` (`module_free.rs:72`) builds the functions `define_all`
  builds, numbered and imported as it numbers and imports them (`module_free_clif_equals_the_module_paths`), with value
  labels collected. `Context::compile(isa, ctrl)` compiles one with no `Module`. A probe on this branch's base
  (§8, *Probe*) compiled every corpus program's functions this way, on both snapshot targets at `none` and `speed`, with
  `jit_flags`' three settings and the ISA's own frontend config, and compared each function's size and hash with the
  snapshot's line: **all 652 functions equal**, value labels collected and all, with 6,480 source-location ranges
  among them. So a browser compile can be held to the snapshots byte for byte.
- **Packages.** `pkg-clif/` is 391 KB gzipped (CLIF view PR 1's roadmap entry); it holds the CLIF builder, the e-graph
  optimiser and the interpreter, and no ISA. The groundwork's spike compiled x86-64 and arm64 text in wasm; with both
  ISAs and the reader it was about 985 KB gzipped.
- **The clif view.** `ClifPane` (`web/src/clif-pane.ts`) stacks the listing region (two shares) over `MachineRow`'s
  values, call stack and heap through `PanelStack`; panels are stored per view under `LEG_PANELS.clif`
  (`panes.ts:47`), shares under `panelSizes`, display settings under `clifDisplay` (`workspace.ts:88-92`, `layout`
  only). The listing switch is a `radioGroup` on the view's bar (`clif-pane.ts:303`). The listing choice belongs to
  the program; changing it holds the view still until the new listing's frames come (CLIF view PR 2's roadmap entry).
- **Links.** `LINKED.clif` (`linked-legs.ts:91-111`): a clif row click links its pc with origin `clif`, and `rows(l,
  pin)` gives the pin's pc for an rxm or clif pin and the construct's instructions otherwise. A view marks every row
  whose pc is in that set.
- **Intent.** `watchIntent(el, fetch)` (`clif-intent.ts`) fetches after the pointer rests 150 ms or at once on focus.
  `clifLoader` (`clif-loader.ts`) shares a pending load and forgets a failed one.
- **The worker.** The session worker holds the session and, while a clif view is shown, one CLIF stepper built from the
  session's `clifInput()` (the rxm `Program`, its type and caps, serialised); it loads `pkg-clif/` by `import()`.

## §3 Decisions

Carried, not reopened: groundwork D3 (machine code is a panel inside the clif view, not a view kind of its own) and the
roadmap's note on piece 3 (the target picker lands here; each target is its own download, fetched when the pointer
rests on that target's choice or it takes focus).

Answered by the user (2026-11-24), every pick taken, and Q5 asked for:

- **Q1. Where the panel sits.** (a) **A region of its own under the listing, full width**, with its own boundary and
  stored share, as the heap's region is. (b) Beside the listing, the two side by side. (c) A fourth panel in the
  values, call stack and heap row. *Pick: (a).* The view is 506 to 634 px wide beside the source (machine panels row
  design §3), too narrow for two listings side by side, and sideways panel resizing was left out of the layouts; a
  line of machine code is as wide as a clif row, wider than the row's panels.
- **Q2. Where the target is picked.** (a) **On the panel's own header**, `x86-64 | arm64`, with the panel closed by
  default: a closed clif view shows one more header line, and opening it shows the chosen target, x86-64 at first.
  (b) On the view's bar, `off | x86-64 | arm64`, beside *as built | optimised*. (c) In the view's `⋯` menu. *Pick:
  (a).* The bar already holds the listing switch at 506 px; the menu hides the choice and its fetch on intent.
- **Q3. x86-64 syntax.** (a) **AT&T** (`movq %rdi, %r12`), as Cranelift prints its own code and the snapshots read.
  (b) Intel (`mov r12, rdi`). *Answer: (a)* as the default, so that the panel and the snapshot read alike. arm64 has
  one syntax.
- **Q5. Both x86-64 syntaxes** (the user's, 2026-11-24): a toggle `AT&T | Intel` on the panel's header beside the
  target picker, shown while x86-64 is chosen, AT&T by default, stored per view in `clifDisplay` as `syntax`. Each
  x86-64 row carries both texts, so the toggle fetches and rebuilds nothing.
- **Q4. Following the run.** (a) **The panel marks the current clif instruction's machine instructions and keeps them
  in view as the run steps**, as the listing follows its focus, with the same *follow current instruction* re-attach.
  (b) It marks only what a link marks. *Pick: (a).*

### §3.1 Approaches considered

| | Approach | Why not / why |
|---|---|---|
| 1 | Compile in the browser with the target's ISA, then disassemble the bytes, each instruction tied to its source location through the `MachBuffer`'s table | **Chosen**: the text is the bytes that run, every instruction has an offset, so links work, and the bytes are checked against the snapshots |
| 2 | Show Cranelift's vcode text, as the snapshots do | Rejected: no offsets or source locations, so no links (§2); it shows jumps the emitted code does not have |
| 3 | Ship each corpus program's machine code precomputed | Rejected: only the corpus, not the user's program |
| 4 | One package with both targets | Rejected: the roadmap decided one download per target |

## §4 What the user sees

```
clif  [as built | optimised]                            ⋯  ✕
 listing
 pc0       v4 = iconst.i64 100
▶pc2       v8, v9 = umul_overflow.i64 v4, v5
 machine code · x86-64 · as built  [x86-64 | arm64]      ▾
       u0:12 fact  192 bytes
 0000             pushq %rbp
 0004             movq %rsp, %rbp
 001a  pc2      ▶ imulq %rsi, %rbx
 0021  pc2        jo 0x0094
 0027  pc3        call u0:0 rt_cons
 values             call stack      heap
```

- **The panel.** A region under the listing, named `code`, closed by default, titled *machine code*, with the target
  and the listing it shows in the words of the view's own choice: *x86-64 · as built*, *x86-64 · optimised*. Its
  header holds the target picker. Open, it
  takes two shares, as the listing does, beside the row's one, with a boundary above and below and its rows scrolled
  in its own box; closed, it is its header alone, under the listing's boundary, and says nothing. Open, closed,
  maximised and its share are stored per view as the other panels' are; stored workspaces and share links without it
  read as closed. The header also holds the syntax choice (Q5), shown while x86-64 is chosen; on arm64 it keeps its
  room unseen, so the target choice does not move. The header is one line wherever its controls fit: the title and
  then the name give way first; the re-attach and the maximise take a second line where the re-attach does not fit
  beside the rest whole, as the listing's header wraps its own; and no width down to the narrowest view draws past it.
- **The picker.** `x86-64 | arm64` on the panel's header, each choice with a hint naming the ABI shown (Linux's System
  V; Apple's arm64 differs in a few calls). The choice is the view's, stored in `clifDisplay` beside `layout`, x86-64
  when none is stored. It does not touch the recording.
- **Rows.** Every function in `build_clif`'s order. A function's header row names it as the call stack does (`u0:12
  fact`) and gives its size. Each instruction row: its offset in the function (hex, four digits), the rxm pc of its
  source location in the clif view's pc column form (blank for none), and the instruction. A call's or an address's
  target is named from the relocation after the instruction (`call 0x0  ; u0:0 rt_cons`), and a call through a
  register from the load that filled it, the instruction's own text left as the disassembler prints the bytes. A
  branch's target reads as an offset in the same function. Data the code
  carries reads as data: x86-64's constants after the code as `.quad`, alignment as `.zero N`, and arm64's far-call
  addresses as `.8byte`. The bytes themselves show in a column of their own, as wide as the shown listing's widest
  bytes, while *machine code bytes*, a checkbox in the view's `⋯` menu, is checked; it is not by default.
- **Links.** A row with a pc links that rxm instruction with origin `clif`, exactly as a clif row with that pc does: the
  rxm view marks it, the source and TM views mark its construct, the clif listing marks its rows, and the panel marks
  every machine instruction of that pc. A pin from anywhere marks the panel's rows whose pc it covers, by the same rule
  as the listing's. Rows with no pc link nothing.
- **Following (Q4).** The machine instructions whose pc is the clif run's current instruction's are marked as the
  current ones, on their rows, and kept in view while following as one block: from the first to the last centred in
  the panel's box, or the first at its top when they are more than it shows. A scroll the user makes in the panel
  stops following until *follow current instruction*, as in the listing. A clif instruction with no source location
  marks nothing.
- **Loading and failure.** Opening the panel or choosing a target not yet loaded fetches it; the panel says it is
  loading, then that the code is being built, and on failure says so with Retry, as the listing does. A package that
  traps on a program says the code could not be built because the package stopped with an error, with no Retry and
  not in a decline's words, which would blame the program. The other panels and views are unaffected.
- **When there is none.** Where the clif view has no listing the panel says what the listing says: a declined program
  in the decline's words (*No machine code for this program:* and the listing's reason), and nothing for a program
  that does not compile, whose reason the step bar gives; while the listing is still to come, its own loading or
  building. A keystroke leaves the old code beside the old listing until the new program's compile, where the
  listing goes too. A listing switched is held, as the listing is, until the new code is built, and the panel then
  changes in the same frame as the listing.
- **Help.** The clif line of `KIND_GLOSS` and help.html's clif paragraph gain one sentence each on the panel and the
  picker.

## §5 Rust

### §5.1 The compile

`redextape-native` gains, under `clif`, `machine_code(prog, listing, target)`, the target a triple: `build_clif` with
the ISA's frontend config, then `Context::compile` per function at `none` for *as built* and `speed` for *optimised*,
the ISA built from `codegen::jit_flags` (compiled under `clif`, still `pub(crate)`) so the flags have one definition.
For each function it returns the code bytes, the source-location ranges expanded to rxm pcs, and the relocations with
their targets. No disassembly here, so the native crate's tests can hold the bytes to the snapshots without a
disassembler.

### §5.2 Text

A new crate (§9) turns one function's bytes into rows: offset, length, the pc of the range it falls in, and its text.
The disassembler is a pure Rust crate that builds for `wasm32-unknown-unknown`, one per target, behind that target's
feature: `iced-x86` for x86-64, which prints both AT&T and Intel (Q5), and `yaxpeax-arm` for arm64. A relocation in an
instruction names its target on the row: a subroutine's `u0:N` and the label the call stack gives it, or a runtime
import's `rt_*` name. The data the code carries is found, not guessed: x86-64's constant pool starts at the first
rip-relative target past the code, and arm64's far-call addresses are its `Abs8` relocations. Data found no such way is
not read as code or as data: each reader refuses its function's code at the first instruction that shows such data (on
x86-64 an indirect jump, a branch into the constants or a rip-relative read back into the code; on arm64 an indirect
jump, an `adr` no relocation fills in, or a literal load from anything but a far call's address), and the whole listing
declines, the functions before that one included, as `LowerError::Unsupported` with the reason `u0:N's <target> code
holds data the listing cannot place: at byte 0x<offset>, <the kind of instruction>`, where the target is `x86-64` or
`arm64` and the offset is in the function's code. The panel shows it as it shows any declined program (§4), through the
decline path the listing already had, so no binding, worker or panel code knows of it. Bytes the disassembler cannot
decode show as `.byte` rows, except a whole arm64 word, which is one `.inst` row; §8 holds that the corpus has none.

### §5.3 Packages

`redextape-mc` holds §5.2 and `redextape-mc-wasm` the exports: one cdylib crate, built twice by wasm-pack into
`pkg-mc-x86-64/` (its default feature, `x86`) and `pkg-mc-arm64/` (`--no-default-features --features arm64`), one per
target, with cranelift-codegen's `x86` or `arm64` feature and that target's disassembler. Given the same `clifInput()`
value the clif package takes and a listing, it returns the whole listing at once: no session, no state, nothing to drop.
It holds no interpreter. Each package's gzipped size is measured and reported; if either passes 1 MB gzipped, the build
stops and comes back to the user before the view is built.

## §6 Web

- **Loading.** The session worker imports a target's package with `import()` on that target's intent (§4's picker: a
  pointer that moved onto the choice resting there 150 ms, a press, or focus on it, through `watchIntent`; the
  panel's open toggle counts as intent for the target it would show), on opening the panel, or at start when a stored
  workspace or share link has an open panel. A view drawn under a pointer that has not moved is no intent. One loader
  per target, as `clifLoader` is. The one-occupant rule (`claim.ts`) is unchanged: it counts the wasm handles
  alive on the worker, and a machine code package leaves none, since `machineCode` returns plain data.
- **Building.** A machine code request carries the target and the listing, and the page makes it only once that
  target's package is in, so the worker answers every request of a live generation. The worker answers from the
  session's `clifInput()` after the run's `result`, as a clif pass is built, so it never runs before the compile's
  result; while it builds (milliseconds on the corpus) the worker does nothing else, so an `extend` or a clif chunk
  that comes then waits for it. A clif request taken after it waits for it only if its package was in when it was
  taken, so a listing never waits on a download. On a listing switch the page asks for the new listing's code first,
  on each target an open panel shows and no other, so it lands before the new listing, which the hold keeps back until
  its frames come. One answer per
  generation, listing and target is kept on the page, for the last compiled generation, and shared by every clif view
  that shows that target.
- **The pane.** The panel is a `ListingPanel` (no second listing-row builder) in a new `PanelStack` region between the
  listing and the row; the region and the panel are `code` and `LEG_PANELS.clif` gains `code`; `ClifDisplay` gains
  `target`, `syntax` and `bytes`.
- **Links.** `LINKED.clif`'s `rows` already gives the pcs to mark; the pane marks the panel's rows with them too. A
  panel row click goes through the same `linkInstr(pc, 'clif')` as a listing row.
- **Build wiring**, at each place `pkg-clif` has one (CLIF view PR 1's list): workspace members, `web/package.json`'s
  build scripts and `build` chain, `.gitignore`, the Dockerfile's wasm stage and copy, CI's `web` job,
  `scripts/check-all.sh`'s wasm32 rows, the comment budget, `.pre-commit-config.yaml`, `docs/development.md`,
  `docs/architecture.md`, and the licences: both packages join `WASM_CRATES` and `licences-scan.test.ts`'s builds, and
  `third-party-licences.json` is regenerated.

## §7 Order

Two PRs, each with its own roadmap entry:

1. **The packages, no UI.** §5 and the build, CI and licence wiring, with §8's Rust and node checks; the entry records
   both packages' gzipped sizes and the compile time of the corpus's largest program in wasm.
2. **The panel.** §6, the browser tests and a Firefox run.

## §8 Verification

- **Probe** (before this design, on `b627fe3`, rustc 1.100.0): 652 of 652 functions equal the snapshots (§2); its test
  file is kept beside this design's record, not committed.
- **Bytes.** For every program of the snapshot corpus, both targets, both listings, each function's size and fnv1a64
  hash from `machine_code` equal the snapshot's `none` or `speed` machine code line. Native, and in node through each
  real wasm32 package for the web examples.
- **Coverage.** Each function's rows cover its bytes exactly, end to end, with no `.byte` or `.inst` row in the corpus.
- **Syntaxes.** Every x86-64 row carries both texts; no arm64 row carries an Intel one.
- **Source locations.** Every pc a machine row carries is the pc of some clif row in the same listing; every row inside
  a source-location range carries that range's pc; prologue rows carry none.
- **Relocations.** Every relocation is named on the row it falls in, and every call row of the corpus names its target.
- **No fetch without intent.** Browser tests, one file per case that fetches (`mc-fetch*.test.ts`): the default
  workspace, then a clif view opened and stepped, a stored clif view whose panel is closed, a pointer passing over a
  choice and a clif view drawn under a pointer that has not moved make no request for either package; resting on
  *arm64* fetches arm64's alone; a press of *x86-64* fetches x86-64's; focusing *x86-64* fetches x86-64's alone; a rest
  on the closed panel's toggle fetches the target it would show; a stored workspace with the panel open fetches its
  target at start and asks once per compiled generation, after its compile; nothing is requested twice.
- **Unchanged.** `pkg/` byte-identical; `pkg-clif/`'s behaviour unchanged, not its bytes, since `redextape-native` and
  `redextape-clif`, which it links, change; no snapshot changes; `cargo tree` for both shows no ISA.
- **Links and following** (`mc-link.test.ts`, `mc-panel-layout.test.ts`). Each direction of §4's links, in both
  listings and on both targets, and the current marks across steps, ↺, a listing switch, a target switch and a
  keystroke's recompile; a current row that is linked keeps the link's edge; the current block kept in the panel's box,
  a wheel detaching it and the re-attach bringing it back, neither scrolling the page.
- **What the panel draws** (`mc-pane.test.ts`, `mc-app-failed.test.ts`, `mc-frames.test.ts`). Each notice of §4 in its
  words, seen in the open panel and absent from a closed one; Retry in the app; AT&T and Intel rows; the bytes column;
  no syntax choice on arm64; the old code through a keystroke and the switch in the listing's frame.
- **Stored** (`mc-layout-stored.test.ts`). A workspace without the panel's fields reads with the defaults; the target,
  syntax, bytes, open panel and share come back through the view taken off the screen and back, a reload and a share
  link.
- Each behaviour above was seen to fail its test under a sabotage of the code that holds it, and the files run in
  Firefox as in Chromium.

## §9 Left to the builder

- The crate's and packages' names, and the disassemblers, within §5.2's constraints.
- The row format's details: offset width, whether a function's header shows its hash, how a long instruction is cut.
- The machine code frame's shape across the worker boundary, and whether the worker keeps an answer.
- The intent delay for the panel's open toggle, if it differs from the choice's.
- Loading and failure wording.

## §10 Designer's calls

Settled by the designer, not the user; open to the user's correction:

- Disassembly of the emitted bytes, not Cranelift's vcode text (§3.1).
- The snapshot's targets, Linux on both, and `jit_flags` with no host CPU features, so the panel equals the snapshots.
- *as built* shows `none`, *optimised* shows `speed`; `speed_and_size` is not offered, being the same code.
- Links at the rxm pc, the only key the code carries, so a machine instruction marks every clif row of its pc.
- The target and *bytes* are the view's, like *compact*; the listing stays the program's.
- Branch targets as offsets, not invented labels.
- A size stop at 1 MB gzipped per package.

## §11 Changed in review

The draft's calls above are as the draft made them, except these, changed in review (the panel fix, tasks A and B):

- **The name `code`, not `machine`.** `machine` is already the values, call stack and heap row's region, whose share a
  workspace stores under that name, so the row's boundaries, maximise and stored share resolved to the panel.
  `PanelStack` now refuses two regions or two panels of one name.
- **A share and a scroll of its own.** The draft's panel grew to its content and pushed the row out of the view; it now
  takes two shares, the listing's, and scrolls its rows in its box.
- **A closed panel says nothing.** Its notice drew in its hidden body, one more status in the view's DOM beside the
  listing's; the notice and Retry also have classes of their own. Closed, its header still sits under the listing's
  boundary, as every closed panel's does since the panels row (#192), so the regions below begin 41 px lower than
  without the panel and a maximised region is 41 px shorter; nothing else in the view moves.
- **The current marks on the row**, where the next, link and focus marks are, so each still shows on a current row.
- **Following keeps the block in view**, not its first row alone (§4, *Following*): a clif instruction's machine
  instructions are one function's, and centring one row lost the block's end out of a box just tall enough for it.
- **The bytes column as wide as the widest bytes shown**, not a fixed 33ch: x86-64's fifteen would push the text out
  of a narrow view, and arm64's rows have at most eight.
- **The syntax choice keeps its room on arm64**, and the header's rule (§4, *The panel*): the draft's header wrapped
  and moved the target choice under the pointer as the syntax choice came and went. Where the re-attach does not fit
  beside the rest, the controller chose a second line (option a) over cutting the name and title for it, which moved
  the target choice, or a shorter re-attach.
- **The old code stays through a keystroke** (§4, *When there is none*). The draft keyed an answer on the generation a
  keystroke claims at once, so the panel dropped its rows for "Building machine code…" while the listing still showed
  the old program, then went blank with no words. An answer is now the last compiled generation's.
- **A declined program says why, a trap says it is one.** The draft's open panel was blank on a program the lowering
  declines; it now says so in the decline's words. A wasm trap read "No machine code for this program: unreachable",
  a decline the program did not earn; the worker now tells a trap (an `Error`) from a decline (a string), and the
  panel says the package stopped, with no Retry.
- **The title in the view's words**: *x86-64 · as built*, not *x86-64 · O0*, beside a choice that says *as built*.
- **Built before the listing it is switched with** (§6, *Building*). The draft's worker answered after the run's
  `result`, not after the clif leg's first result as §6 said, and the page asked for a switched listing's code only
  once that listing had landed, so the panel said it was building after the listing had changed. The run's `result`
  is the right point: the build never runs before the compile's result, though while it builds (milliseconds on the
  corpus) the worker does nothing else. The page now asks for the new listing's code
  before its clif request, and the worker builds it before that request's listing, which §4's hold allows ("held
  until the new code is built").
- **Asked only once the package is in.** The draft asked with the load still under way and said `loading` on its own
  guess: an ask the worker would not answer (a superseded run's) left the load `loading` for good, and Retry forgot
  asks the worker would still answer and asked again. Now a want posts the load from idle, the ask waits for `ready`,
  and every ask of a live generation is answered once.
- **Intent is a move, a press or a focus.** The draft's rest began at `pointerenter`, which a browser sends when a view
  is drawn under a pointer that has not moved, so a clif view opened under a still pointer fetched the target under
  it, against G3. The rest now begins at the first `pointermove`; a press fetches at once.
- **The callee after `; `**, as §4's sketch reads, not after an arrow.
- **Marks: rows with no pc stay unmarked.** Inside a current block some rows carry no pc, so the block reads as two.
  Across the web examples, both listings and both targets, 141 rows with no pc sit between two rows of one pc: 139
  are register moves regalloc puts at a block's top, where Cranelift's emit has no source range open, and 2 are the
  code of a clif instruction that itself has no pc (the optimised `iconst.i64 0` in map-fold, whose clif row is
  unmarked too). A row says neither which it is, so the panel marks neither; telling them apart needs the Rust side.

Changed by the whole-branch review's fix pass:

- **A view's code is the listing it was built from.** The panel read which listing it showed from the switch, which
  during a switch's hold already names the new listing while the view still shows the old one, so a clif view opened
  or rebuilt in that window put the new listing's code and title beside the old listing. The worker's listing reply
  now says which listing it is, and the view keeps that with the rows.
- **A listing never waits on a download.** The worker held a clif request behind every machine code request taken
  before it, its package load included; it now holds it only behind those whose package was in.
- **A switch builds only what an open panel shows**, not every target asked for this generation: the listing waits for
  each build.
- **Current rows carry the current-row bar**, as the state table's current row does, so the block is marked by a shape
  and not by colour alone.
- **A pin made before the panel's rows come is scrolled to when they come**, as the listing's rows are when they come
  after a pin made in another view.
- **The target type is the bindings' `McTarget`**, and every list of targets and every per-target table is checked
  against it, so a target added on the Rust side is a type error on the page until the panel can show it.
