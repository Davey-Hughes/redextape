# Native Backend Phase 3 — AOT (a real runnable binary) — Design Spec

> **Status:** approved design (2026-07-23), pending the implementation plan.
> **Context:** Native v1 (Cranelift JIT) is complete — `Core → asm → Cranelift JIT → machine code`,
> a validated 4th oracle leg (`reference == λ == TM == native`, plus `native == asm-interp`). This
> spec adds **Phase 3: ahead-of-time compilation** — emit a real object file and link it into a
> standalone executable you can run outside the oracle. It is *additive*: the JIT path is untouched.
> Phase 2 (LLVM) is deliberately deferred (see the roadmap); Phase 3 does not depend on it.

## Goal

Turn the native backend's in-memory, run-and-discard JIT into a path that emits a **real linkable
`.o` object file** and (best-effort) links it into a **standalone native executable** — a binary on
disk that runs the program and prints its result, with no oracle, no interpreter, and no Rust host
process driving it. This completes the "interpret / reduce / simulate / **compile to a real
artifact**" story and directly answers "does the native code output anywhere, or is it ephemeral?"

## The core reuse insight

The v1 JIT already builds every function through the **`cranelift_module::Module` trait**
(`declare_function` / `define_function` / `declare_func_in_func` / `target_config`). `ObjectModule`
(from `cranelift-object`) implements that **same trait**. So the entire asm→CLIF codegen walk is
reused *verbatim*; the only refactor is making the function-builder **generic over `M: Module`**
instead of hardcoding `JITModule`. JIT and AOT then differ only in which module they instantiate and
what they do with it at the end (`get_finalized_function` + call, vs. `finish()` + emit bytes).

**JIT and AOT coexist** — this is not a replacement. `run_native` keeps its JIT path (what the
differential oracle needs: compile-and-run in-process); AOT *adds* an object-emit path alongside it.

## Non-goals (deferred)

- **Optimized code.** AOT emits the *same* Cranelift-quality code as the JIT, just persisted. Deep
  optimization is Phase 2 (LLVM). Phase 3 is a *packaging/milestone* win, not a *speed* win.
- **A hermetic, toolchain-free executable.** Producing an executable inherently needs a system
  linker. The `.o` **emission** is self-contained (pure Cranelift, no external toolchain); the
  **link-to-executable** step is best-effort and requires `cc` on `PATH`.
- **Distribution/cross-compilation.** v1-AOT targets the host triple only. The linked executable and
  the runtime staticlib are built for and run on the host.
- **Anything the asm doesn't already express.** AOT compiles exactly the first-order `Program` that
  `lower_asm` + `defunc` produce — same supported set as the JIT and the TM.
- **Source-level / variable debug info.** Phase 3 emits *named symbols* (Tier 0 — see
  **Debuggability**) so disassembly and backtraces are readable, but source-line and variable debug
  info (DWARF on ELF/Mach-O, CodeView/PDB on Windows) is deferred to an optional follow-on.

## Architecture

### Crate layout — a runtime that can be linked standalone

The v1 runtime (`redextape-native/src/runtime.rs`: `Runtime` + the `rt_*` host functions) currently
lives inside `redextape-native`, which depends on Cranelift. For AOT the runtime must be linkable
into a standalone binary **without** dragging in Cranelift. So the runtime moves to a new, minimal
crate:

```
crates/
  redextape-native-rt/          # NEW — the linkable runtime. NO cranelift dependency.
    Cargo.toml                  # crate-type = ["rlib", "staticlib"]; depends only on redextape-core
    src/lib.rs                  # Runtime + rt_* (moved from redextape-native) + rt_run + rt_print_result
  redextape-native/             # existing — the codegen. Depends on redextape-native-rt (rlib) + cranelift(+object)
    src/
      lib.rs                    # run_native (JIT, unchanged) + emit_object + link_executable (NEW)
      analysis.rs               # partition — unchanged
      codegen.rs                # the Module-GENERIC function builder (refactored from cranelift_backend.rs)
      jit.rs                    # JIT driver: build JITModule, finalize, run (the v1 tail)
      aot.rs                    # NEW — emit ObjectModule, the `main` entry + CONFIG blob, link
    examples/
      native_demo.rs            # existing — JIT demo (unchanged)
      aot_demo.rs               # NEW — emit .o, link, run, show the binary's stdout
    tests/
      native_oracle.rs          # existing four-way JIT oracle (unchanged)
      aot_oracle.rs             # NEW — the bounded end-to-end AOT leg (B1)
```

`redextape-native-rt` is used **two ways from one source**: as an **rlib** it provides the `rt_*`
symbols the JIT registers in-process (v1 behavior, just a different crate path); as a **staticlib**
(`libredextape_native_rt.a`) it is the object the AOT executable links against. `redextape-core`
stays WASM-clean; `redextape-native-rt` carries no Cranelift dependency.

> **Refactor note (JIT stays green):** splitting the runtime out and extracting the Module-generic
> codegen are internal refactors. The v1 JIT behavior, `run_native`'s signature, and the existing
> `native_oracle.rs` results are unchanged — each refactor task keeps the full existing suite green.

### The shared, backend-agnostic core additions (in `redextape-core`, WASM-clean, unit-testable)

Three small additions, none of which touch Cranelift:

- **`result_type(program: &ast::Program) -> Result<Ty, Vec<Diagnostic>>`.** The typechecker already
  *infers* the top-level type (`infer_block` returns `Ty`) but the public `typecheck` discards it,
  returning only diagnostics. This exposes the resolved top-level `Ty` (fully `resolve`d over the
  substitution), so a standalone binary knows what to print **without running the reference**. Errors
  (ill-typed program) return the diagnostics.
- **`decode_asm_ty(outcome: &AsmOutcome, ty: &Ty) -> Option<Value>`.** A **type-directed** sibling of
  the existing value-directed `decode_asm`. `decode_asm` is guided by a reference `Value`'s full
  structure (which AOT does not have); `decode_asm_ty` decodes purely from the `Ty` + the heap:
  `Nat` → the raw word; `Bool` → `word == 1`; `List(t)` → follow the heap pointer chain (`0` = nil,
  else cell `p-1`) decoding each head against `t` until the chain hits `0` — the heap self-describes
  the length, so no reference structure is needed; `Unit` → `Value::Unit`; `Fun`/`Var` → `None` (not
  a printable top-level result). Unit-tested against `decode_asm` for agreement on concrete values.
- **`format_value(v: &Value) -> String`.** A single **canonical** textual form (`5050`, `true`,
  `[1, 2, 3]`, `[]`), shared by *both* sides so the oracle comparison is exact and string-based: the
  AOT runtime prints `format_value(decoded)`; the oracle computes the expected string as
  `format_value(&reference_value)` and compares it to the binary's stdout.

### The AOT emission path (`aot.rs`)

`emit_object(prog: &Program, caps: Caps) -> Result<Vec<u8>, AotError>`:

1. Build an `ObjectModule` for the host target (`cranelift_object::ObjectBuilder` with the native
   ISA + a module name), using `cranelift_native::builder()` for the host ISA flags.
2. Declare + define every `Subroutine` using the **shared, Module-generic codegen** (identical to the
   JIT). `$main` becomes an ordinary internal function `(*: i64) -> i64` = `extern "C"
   fn(*mut Runtime) -> u64`.
3. Emit a **C `main` entry** — a Cranelift function named `main` with signature `(i32, i64) -> i32`
   (argc/argv ignored) that:
   - takes the address of the compiled `$main` (`func_addr` on `declare_func_in_func`),
   - takes the address of the **CONFIG** data object (`global_value` on a declared+defined data),
   - calls the runtime driver `rt_run(main_fn_ptr, config_ptr, config_len) -> i32` (declared
     `Import`),
   - returns its `i32` result as the process exit code.
4. Emit the **CONFIG** data object: a compact serialization of `caps` (steps/heap/stack as `u64`),
   the frame-size-aware `depth_cap` (reusing the v1 `native_depth_cap(prog, subs, caps)` computation
   — the totality bound transfers unchanged), and the **serialized `Ty`** (a tiny tag encoding:
   `Nat`/`Bool`/`Unit`/`List(elem)`; `Fun`/`Var` rejected at emit time as non-printable).
5. `module.finish()` → `ObjectProduct` → `.emit()` → the `.o` bytes.

The emitted `main` is ~3 IR operations; **all** run logic lives in the reused runtime driver.

### The standalone driver (`rt_run` / `rt_print_result`, in `redextape-native-rt`)

`rt_run(main_fn: extern "C" fn(*mut Runtime) -> u64, config_ptr: *const u8, config_len: u64) -> i32`
is the AOT entry point the emitted `main` calls. It **repackages the v1 JIT driver tail** (which
already does spawn-big-stack-thread → `Runtime::with_depth_cap` → call `$main` → classify
Ran/Fault/HitCap), adding decode + print + exit code:

1. Deserialize CONFIG → `Caps`, `depth_cap`, `Ty`.
2. Spawn the big-stack thread (`JIT_STACK_SIZE`, so the frame-size-aware `depth_cap` guarantees
   `HitCap` before a native stack overflow — the same totality invariant as v1), build the
   `Runtime`, and call `main_fn(&mut rt)`.
3. Classify the outcome, mirroring `NativeRun` at the **process boundary**:
   - **Ran** → `decode_asm_ty(&outcome, &ty)`; print `format_value(v)` to stdout; exit `0`.
   - **Fault(msg)** → print `fault: <msg>` to stderr; exit `2`.
   - **HitCap** → print `hit cap` to stderr; exit `3`.
   - internal/decode failure → stderr; exit `4`.

The exit-code taxonomy `{0 value, 2 fault, 3 cap}` lets the oracle classify the run without parsing
prose. Totality is preserved end to end: no adversarial input crashes the binary; recursion trips
`HitCap`, faults print and exit, all reusing the v1 discipline.

### Linking (`link_executable`, best-effort)

`link_executable(obj_bytes: &[u8], out_path: &Path, opts: &LinkOptions) -> Result<(), AotError>`:

1. Write `obj_bytes` to a temp `.o`.
2. Locate the runtime staticlib `libredextape_native_rt.a`. In the workspace/oracle context it is a
   normal build artifact; the helper ensures it exists (build `redextape-native-rt` as a staticlib if
   needed) and finds it under `target/<profile>/`. If it cannot be located, return an error (the `.o`
   itself is still valid and was returned by `emit_object`).
3. Invoke the system **driver** `cc` (overridable via `CC`): `cc <obj> <rt.a> <selected-linker-flag>
   -lpthread -ldl -lm -o <out>` (platform-appropriate; macOS omits `-ldl` and needs no extra libs
   beyond the default). `cc` is the driver so libc/crt/loader resolution is correct per platform.
4. **Linker selection (platform-aware detect-and-prefer).** Choose the linker via
   `LinkOptions.linker`:
   - `Auto` (default) is **platform-aware**:
     - **macOS:** use the system default `ld` — do *not* probe or override. Apple's default linker
       was rewritten (`ld-prime`, the default since Xcode 15 / Sept 2023) and is the fastest
       realistic option on macOS: the open-source fast linkers don't target it (mold's macOS port
       `sold` went commercial-only in Dec 2022; wild is Linux/ELF-only), and lld "is no longer
       necessarily the fastest" against `ld-prime`. So overriding would only risk slowdowns/breakage
       for no gain.
     - **Linux/ELF:** probe `PATH` for a preferred fast linker in priority order `[mold, wild, lld]`;
       use the first that both exists *and* the driver accepts (verified by a probe link); otherwise
       the platform default.
   - Overridable on *any* platform by env `REDEXTAPE_LINKER=mold|wild|lld|default|<abs-path>` (and by
     `LinkOptions` — e.g. to force `lld` on macOS if a user insists).
   - The mechanism is a driver flag: `-fuse-ld=<name>` (or clang `--ld-path=<abs>`), **not**
     replacing `cc`. On any link failure with a selected linker, **fall back** to the next preference
     and finally to the default — the whole step is best-effort, so try-then-fall-back is safe.
   - **Why platform-aware, not a flat preference list:** the "mold/lld beats Apple's linker"
     benchmarks predate `ld-prime` (they measured the old `ld64`). Post-2023 the default `ld` is
     fastest on macOS, so the fast-linker preference is a **Linux-only** win; forcing it on macOS is
     counterproductive.
5. **Stripping (opt-in, off by default).** `LinkOptions.strip` controls whether the *linked
   executable* keeps its symbol table. Default `false` — symbols kept, so the Tier 0 readable/
   backtraceable binary is what you get out of the box. When `true`, strip at link time (`cc -Wl,-s`,
   or a post-link `strip <out>` where the driver flag isn't honored) for a smaller/release binary.
   Independent of `emit_object`: the emitted `.o` always retains its symbols; `strip` only affects the
   final executable.

`emit_object` never needs `cc`; only `link_executable` does. A missing/failing linker degrades to
"here is a valid `.o`," never a panic.

### Debuggability

"Debug symbols" is three tiers of sharply different cost/value for a mini-language whose real
observability story is the trace visualizers (the planned TUI) + the "show the native code"
(IR/disassembly) follow-on. **Phase 3 does Tier 0; the deeper tiers are optional follow-ons.**

- **Tier 0 — named function symbols (IN SCOPE, ~free).** Keep the names already assigned in
  `declare_function` (`main`, `$main`, `$sum`, the `$applyN` dispatchers, and the linked `rt_*`) in
  the emitted object's symbol table. Result: `nm`, `objdump -d`/`otool -tV`, and crash backtraces
  show meaningful names instead of `sub_1234` — a readable, backtraceable binary at no extra codegen
  cost. Composes with the IR/disassembly-dump follow-on. **Symbols are kept by default; stripping is
  an opt-in `LinkOptions.strip` toggle** (see Linking) for a smaller/release binary — off by default
  so the useful case is the default. Stripping is a *link-time* choice on the executable; the emitted
  `.o` always retains its symbols, so the always-on smoke test (assert the object's symbol table
  contains `main` + the subroutine names) is independent of `strip`.

- **Tier 1 — source-level debug info, in each platform's NATIVE format (OPTIONAL FOLLOW-ON).** Map
  native PC → mini-language source line so `lldb`/`gdb`/`addr2line` and native debuggers correlate to
  `program.rt:3`. **Not DWARF-only — emit the host platform's native debug format:**
  - **ELF (Linux) & Mach-O (macOS): DWARF** (`.debug_line`/`.debug_info`), built with `gimli::write`;
    macOS additionally has the `dsymutil` → `.dSYM` bundling step (lldb can also read DWARF in the
    `.o`s via the linker's debug map).
  - **PE-COFF (Windows): CodeView / PDB** — the native format MSVC debuggers (WinDbg / Visual Studio)
    expect. **Honest caveat:** substantially harder than DWARF — there is no mature Rust PDB writer
    (LLVM rolls its own), so Windows-native debug info is its own sub-project, not a flag flip.
  - **Shared prerequisite (all formats):** the register-asm IR carries **no source spans** today, so
    this first requires threading source spans `desugar → Core → lower_asm → codegen` and setting
    Cranelift `set_srcloc` — a real refactor. Deferred because the payoff is marginal against the
    visualizer track for a mini-language.

- **Tier 2 — full variable/type debug info (NOT PLANNED).** Mapping `Loc(i)`/`Arg(i)` → named locals
  + types + frame base. Lowest value (post-lowering registers aren't user-meaningful names) for the
  highest per-format effort. Skip.

## Oracle integration (B1 — a bounded end-to-end AOT leg)

Native's shared codegen is already covered by the full JIT oracle (`native_oracle.rs`); the *new*
surface AOT introduces is **object emission + linking + the standalone driver's decode/print**. The
AOT tests target exactly that, without the cost/flakiness of running a compiled binary per proptest
case:

- **Always-on smoke test:** `emit_object` produces bytes that parse as a valid object file for the
  host (via the `object` crate) with a `main` symbol and the expected `rt_*` undefined imports. No
  `cc` needed — runs everywhere.
- **End-to-end leg (gated on `cc` availability):** for a **handful of representative programs** — a
  `Nat`, a `Bool`, a list, recursion (`sum`), a defunc'd higher-order (`map`), a fault (`head(nil)`),
  and a cap (a spin) — compile → link → **run the binary** → compare: `stdout ==
  format_value(reference)` and `exit_code` matches the outcome class (`0`/`2`/`3`). Skipped with a
  logged notice when no linker is available (never a silent pass). Deliberately a curated set, not a
  proptest — the JIT leg carries the exhaustive codegen validation.

## Demo

`cargo run --example aot_demo -p redextape-native`: emit a program's `.o`, link it to
`target/aot_demo_out`, run that binary in a subprocess, and show its stdout (e.g. `sum(100)` →
`5050`) — proving a real, standalone, on-disk native binary. Falls back to "emitted `.o` (N bytes);
no linker found to produce an executable" when `cc` is absent.

## Bounds, caps & totality

- **Caps** (`steps`/`heap`/`stack`) are serialized into CONFIG and enforced by the same `rt_*`
  host functions in the linked runtime — identical semantics to the JIT.
- **Recursion** uses the same **frame-size-aware `depth_cap`** (computed at emit time via the v1
  `native_depth_cap`) plus the big-stack thread inside `rt_run`, so the standalone binary is **total**
  — deep recursion → `HitCap` exit, never a process abort.
- **Faults** (nil/dangling access, etc.) latch and surface as a `fault:` message + exit `2`.

## Phased scope within Phase 3 (task decomposition seed)

1. **Core additions** — `result_type`, `decode_asm_ty`, `format_value` (pure, unit-tested).
2. **Runtime crate split** — new `redextape-native-rt` (rlib + staticlib); move `Runtime`/`rt_*`;
   JIT re-imports them; full existing suite stays green.
3. **Module-generic codegen** — extract the function builder over `M: Module`; JIT unchanged.
4. **`emit_object`** — ObjectModule + `main` entry + CONFIG blob; always-on valid-object smoke test.
5. **Standalone driver** — `rt_run` + `rt_print_result` in the rt crate (decode via `decode_asm_ty`,
   print via `format_value`, exit-code taxonomy).
6. **`link_executable`** — staticlib location + `cc` invocation + detect-and-prefer linker selection
   + graceful fallback.
7. **AOT oracle leg + `aot_demo`** — the bounded end-to-end leg (B1) and the demo.

## Key interfaces (produced)

- `redextape_core::typeck::result_type(&ast::Program) -> Result<Ty, Vec<Diagnostic>>`
- `redextape_core::tm::decode_asm_ty(&AsmOutcome, &Ty) -> Option<Value>`
- `redextape_core::value::format_value(&Value) -> String`
- `redextape_native_rt::{Runtime, rt_*}` (moved) + `rt_run(main_fn, config_ptr, config_len) -> i32`
- `redextape_native::emit_object(&Program, Caps) -> Result<Vec<u8>, AotError>`
- `redextape_native::link_executable(&[u8], &Path, &LinkOptions) -> Result<(), AotError>`
- `redextape_native::LinkOptions { linker: LinkerChoice, strip: bool }` (`strip` defaults `false` —
  keep symbols), `LinkerChoice = Auto | Default | Named(String)`

## Open implementation questions (for the plan)

- **CONFIG serialization format:** a hand-rolled little-endian byte layout (caps + depth_cap + a
  tag-encoded `Ty`) vs. a tiny dependency. Lean: hand-rolled — the schema is ~5 fields and stays
  private to `emit_object` ↔ `rt_run`.
- **Staticlib discovery:** locate the prebuilt `.a` under `target/<profile>/` vs. shell out to
  `cargo build -p redextape-native-rt`. Lean: check `target/` first (via `CARGO_TARGET_DIR`/profile),
  build on miss; the plan picks the exact probe.
- **`main` signature portability:** `(i32, i64) -> i32` (argc/argv ignored) vs. `() -> i32`. Lean:
  the former — crt0 passes argc/argv on all host targets and ignored params are harmless.
- **Linker-acceptance probe:** how to verify `-fuse-ld=<name>` works before committing (a tiny probe
  link vs. parsing `cc` version). Lean: a one-object probe link, cached per process.
