# `redextape run` and `redextape emit` — design

**Slice:** `cli-emit-and-run`. Plan 6's other half. The CLI has `fmt` and `lint`; this adds the two
subcommands that make it able to *execute* and to *produce artifacts*.

**One-line statement of what this is:** `run` executes a program or an artifact and prints its value;
`emit` compiles a program to one of the three backend text forms. Together they put the project's
oracle behind a shell prompt for the first time — **three of its four legs, not four.**
`redextape-native` is not a CLI dependency (§1.10), so the native backend stays out of reach from the
command line. This sentence said "four-way" until Task 6 measured it.

**Scope boundary, decided before anything else:** no new semantics. Every pipeline below is one the
tree already runs in tests or examples; this slice gives them a command-line surface, an exit-code
discipline, and diagnostics a human can act on. Nothing in `redextape-core` changes.

---

## §1 The tree as it stands — verified 2026-08-22 at `193225a`

Every claim below was run, not recalled.

1. **`format_value` exists and is total.** `value.rs` renders `Nat`/`Bool` plainly, `Unit` as `()`,
   lists as `[a, b, c]`, and `Closure`/`Builtin`/`Box` as the literal `<non-value>`. `run` output
   needs no new formatting.
2. **`core::run(src) -> Result<Value, RunError>` already exists**, and its own doc calls it *"the
   convenience entry point for the CLI and tests."* `RunError` is `Static(Vec<Diagnostic>)` — never
   ran — or `Runtime(RuntimeError)` — ran and faulted.
3. **`parse_asm` is still unclaimed.** `grep -rn 'fn parse_asm' crates/` is empty. The asm form
   prints and cannot be read back, exactly where Plan 3 left it. **"Four consecutive roadmap entries
   have said so" was wrong** — corrected 2026-08-22 by Task 6, which counted rather than recalled:
   `parse_asm` appears 14 times across the roadmap. The four-consecutive window closed when narrower
   entries skipped it, so the claim was true once and quietly stopped being true.
4. **Only ONE of the four examples the roadmap credits is a CLI prototype.** `tm_emit.rs` parses
   argv and already has `emit` and `run` subcommands. `tm_demo.rs`, `lambda_demo.rs` and
   `step_survey.rs` take no arguments at all — they are fixed demos, and two of them call
   `reduce_trace`. The roadmap's *"already do most of what emit/run subcommands need"* is true of
   `tm_emit` and overstated for the rest.
5. **Nothing in this project has ever written a λ file.** `rxlambda` appears in exactly three tracked
   files: a plan, the λ grammar's README, and its `tree-sitter.json`. No code, no test, no script.
   **PR 2 shipped an editor grammar for a file extension the project cannot produce**, and
   `emit --lang lambda` is its first producer.
6. **Both decoders are type-directed.** `decode_lambda_ty(nf, &Ty)` and
   `decode_tape_ty(&[Tape], &Ty, &dyn Encoding)` each take a type, which comes from
   `typeck::result_type(program) -> Result<Ty, Vec<Diagnostic>>`. Both refuse `Ty::Fun` and
   `Ty::Var` — the same restriction `HeaderParts::directive` (D5) already puts on a `.tm` header's
   `result`. This produces §6's asymmetry.
7. **The exit-code discipline is already set and documented** in `main.rs`: 0 success, 1 the check
   failed, 2 the work could not be done at all — which is also `clap`'s code for a bad argument list.
   Each command module returns an `Outcome` enum and `main` maps it; nothing else in `main` does work.
8. **The CLI's reuse surface exists.** `input.rs` gives `Input::from_arg`, `read`, `label` and
   `write_atomic` (with `-` meaning stdin/stdout); `report.rs` gives ariadne rendering and colour
   detection. Dependencies are `redextape-core`, `clap`, `ariadne`, `similar`; dev-dependencies
   `assert_cmd` and `trycmd`.
9. **The test pattern is established.** `tests/cmd/*.toml` — one per case, carrying `bin.name`,
   `args` and `fs.sandbox` — beside `.in`/`.out` sandbox directories and `.stdout`/`.stderr` goldens,
   driven by one `trycmd::TestCases` call in `tests/cli.rs`. Module-level unit tests call each
   command's `run` directly with a buffer.
10. **`redextape-native` is NOT a CLI dependency**, which is why §10 excludes a native backend rather
    than weighing it.

## §2 What ships

```
crates/redextape-cli/src/
  run.rs      # the `run` subcommand: source or artifact, three backends
  emit.rs     # the `emit` subcommand: three target forms
  cli.rs      # two new `Command` variants
  main.rs     # two new outcome->exit-code arms
```

Plus `tests/cmd/` cases, including the round-trip transcripts of §8.

**Two modules, not one**, because they answer different questions — `run` consumes and `emit`
produces — and because each is small enough to read whole. They share `input.rs` and `report.rs`
rather than each other.

## §3 `run` — one verb, two input kinds

**`run` dispatches on the file extension**, and the two arms are genuinely different pipelines:

| input | pipeline |
|---|---|
| `.rxt` | `analyze` → chosen backend → type-directed decode → `format_value` |
| `.tm` | `parse_tm_full` → `TmHeader::init` → `simulate` → `decode_tape_ty` |

**`--backend {reference,lambda,tm}`, default `reference`.** The default is the tree-walker, which is
what `core::run` already is. The other two lower and then decode:

- `lambda` — `lambda::lower` → `run_lambda(core, cap)` → `decode_lambda_ty`. `LambdaRun` is
  `Reduced` / `HitCap` / `LowerError`.
- `tm` — `lower_asm` → `run_tm_fitted` → `decode_tape_ty`. `TmRun` is `Ran` / `HitCap` / `Overflow` /
  `TooLarge` / `LowerError`, and all five need an exit-code arm (§5).

**Passing `--backend` with a `.tm` file is an error, not a silent ignore.** The artifact *is* a
Turing machine; there is nothing left to choose, and accepting the flag would imply otherwise.

**A `.tm` file is runnable because it is self-describing.** Its header carries encoding, width, slots
and the result type, which is exactly what `decode_tape_ty` needs. This is not incidental — it is the
property the self-describing-header slice was built for, and this is its first consumer outside an
example.

**`.rxlambda` is deliberately NOT a `run` input**, and the reason is the same property in the
negative: a λ term carries no result type, both decoders are type-directed, so a bare `.rxlambda`
cannot be decoded to a value at all. `emit --lang lambda` writes files for `parse_lambda` and the
tree-sitter grammar to consume, not for this command.

## §4 `emit` — three targets, two of which round-trip

**`emit <path> --lang {tm,lambda,asm}`**, `-o <file>`, **stdout by default** so it composes with a
pipe. `--encoding {unary,binary}` applies to `tm` and is an error elsewhere.

| target | pipeline | round-trips? |
|---|---|---|
| `tm` | `result_type` → `run_tm_described` → `print_tm_with` | yes — `parse_tm_full` |
| `lambda` | `lambda::lower` → `print_lambda` | yes — `parse_lambda` |
| `asm` | `lower_asm` → `print_asm` | **no** |

**`tm` goes through `run_tm_described` rather than `lower_tm`**, because that is what produces a
`TmHeader`, and a `.tm` file without one records δ and the start state but not the initial tapes —
`tm_emit.rs` already refuses to run such a file for that reason. The cost is that it simulates; §9
prices that.

**`--lang asm` produces a write-only artifact and says so in the file.** Emitted asm carries a
leading comment naming the gap:

```
; This file cannot be read back. `parse_asm` is unclaimed — nothing, including
; redextape itself, can parse the asm text form. Emitted for reading only.
```

**It is NOT an exception to the round-trip principle, and getting that right matters.** The
visualizer design's section 7 makes *"the source, lambda, and TM panes"* peer editable languages, each
needing a parser as well as a printer. **asm is not one of the three and never was** — so emitting it
breaks no stated rule. What it does is make visible a promise from somewhere else: the roadmap records
`parse_asm` as something *"Plan 3's key interfaces"* promised and that never landed, and four
consecutive entries since have repeated that it is unclaimed.

Emitting asm was chosen with that gap open. The reasoning is that four prose mentions have moved
nothing, and a user-facing artifact that admits it is more likely to force the issue than a fifth. The
header comment is the whole mitigation; §7 of this document records what it does not fix.

## §5 Exit codes — the program's fault versus the tool's

`main.rs` already sets 0/1/2 and describes 1 as *"the check failed"* and 2 as *"the work could not be
done at all"*. Applied here, that becomes one rule: **1 means the program is at fault; 2 means the
tool could not answer.**

| outcome | code |
|---|---|
| ran, produced a value | 0 |
| `RunError::Static` — parse or type error | 1 |
| `RunError::Runtime` — `head(nil)`, the step budget | 1 |
| `LambdaRun::HitCap`, `TmRun::HitCap` | 1 |
| `TmRun::Overflow` after fitting | 1 |
| `TmRun::TooLarge` — the lowering ceiling (§9) | 2 |
| `LambdaRun::LowerError`, `TmRun::LowerError` | 2 |
| decode refused — a function-typed result under `lambda`/`tm` (§6) | 2 |
| unreadable input, unwritable `-o`, bad flag combination | 2 |

**The last three rows are why the rule is worth stating.** In each, the program is fine and the tool
cannot answer *that question about it* — a stateful closure has no λ lowering, a function-typed result
has no tape encoding, and neither is a defect in the source. Reporting those as 1 would tell a script
the program failed when it did not.

**A cap is the program's fault and a ceiling is the tool's.** `HitCap` means the program ran and did
not finish inside a budget chosen to fail fast; `TooLarge` means the tool declined to build the thing
at all. The two feel similar and land on different sides.

## §6 The type-directed decode asymmetry, stated

`--backend reference` can print a result for any program that evaluates. The other two cannot,
because their decoders are type-directed and refuse `Ty::Fun` and `Ty::Var`.

**This is reachable from a one-line program, measured 2026-08-22 rather than supposed:**

```
|x| x + 1              ty = (Nat) -> Nat    reference -> <non-value>
fn f(x) { x + 1 } f    ty = (Nat) -> Nat    reference -> <non-value>
let g = |x| x; g       ty = (t2) -> t2      reference -> <non-value>
1 + 2                  ty = Nat             reference -> 3
```

All four parse and typecheck with zero diagnostics. **The third is the one worth noticing:** a
polymorphic identity types as `(t2) -> t2`, so it carries a `Ty::Var` as well as a `Ty::Fun` — both of
the two shapes the decoders refuse, in a program three tokens long. This is not an exotic corner.

```
$ redextape run returns_a_function.rxt
<non-value>

$ redextape run returns_a_function.rxt --backend tm
error: `tm` cannot decode a result of type `(Nat) -> Nat`
  a tape encodes Nat, Bool, Unit and List<T>; a function has no encoding
  `--backend reference` will evaluate it (and print `<non-value>`)
exit 2
```

**This is the same restriction `.tm` headers already enforce** — `HeaderParts::directive` rejects a
`result` that is not a value type (D5) — arriving in a second place. It belongs in `--help`, because
a user who meets it by accident will read it as a bug in the flag.

**`format_value`'s `<non-value>` is not a failure**, and the reference row above is not an error: the
program evaluated to a closure, which is a legitimate result the mini-language can produce and no
text form can encode.

## §7 What this does not close

- **`parse_asm` is still unclaimed.** `--lang asm` emits into that gap rather than filling it. The
  header comment tells a reader; it does not give the file a parser, and **no round-trip test can be
  written for that target** (§8 records the absence deliberately).
- **No `--backend native`.** `redextape-native` is not a CLI dependency (§1.10), so the fourth oracle
  leg stays out of reach from the command line.
- **`run` does not report steps, traces or timings.** Values only. The trace machinery exists and has
  consumers; a `--trace` flag is a separate design with its own output-format questions.
- **`emit` has no `--width`.** `run_tm_described` fits the field width per program; overriding it is
  the config-file question the roadmap already tracks separately.

## §8 Testing

Three layers, matching what the CLI already does.

1. **Module unit tests** calling `run(&inputs, .., &mut out, &mut err, color)` with a buffer — the
   established pattern, and the only place that exercises the code without a process.
2. **`trycmd` transcripts** in `tests/cmd/`, one `.toml` per case, which are the only place `main`'s
   exit-code mapping and `clap`'s own errors run. At minimum: each backend's success line, each exit
   code in §5's table, `--backend` rejected on a `.tm` input, `--encoding` rejected off `tm`.
3. **Round-trip transcripts, which are the point.**

```
$ redextape emit prog.rxt -o p.tm && redextape run p.tm
42
```

**That is an oracle assertion expressed as a shell transcript**, and nothing in the project currently
states that agreement anywhere a user can see (three legs of it — see the one-line statement above). The `--backend` equivalent is one program,
three invocations, one expected line of stdout — a golden that fails if any backend disagrees with
any other.

**One absence is deliberate and must be visible.** `--lang asm` gets no round-trip case, because none
can be written. The test directory will carry a gap shaped exactly like `parse_asm`, which is better
than the same gap living only in prose.

## §9 Risks

1. **The TM lowering ceiling reaches the command line.** `--backend tm` and `--lang tm` both lower
   before doing anything else. `MAX_MACHINE_STATES` caps that at **1,000,000 states — roughly 700 MB**
   at the 700–725 bytes per state `examples/state_cost_probe.rs` measures — and refuses past it. A
   balanced expression tree reaches it from about 6 KB of source. **The mitigation is a legible
   refusal, not a new limit:** the guard is already tested, and re-implementing a lower ceiling in the
   CLI would add surface that can only refuse earlier. `TooLarge` must arrive as a diagnostic naming
   the ceiling and suggesting `--backend reference`.
   *(The pre-guard 8.6M-state / 6.0 GB figure that once justified this constant is no longer
   reachable — see the roadmap's note that the evidence for a guard stops being reproducible once the
   guard is enforced.)*
2. **`emit --lang tm` simulates — and CANNOT fail because of it. Corrected 2026-08-22, during Task
   3's review; this item first said "a program that caps during `emit` has not failed to compile —
   the header cannot be completed, which is a different message and a different exit code."** That
   describes a failure mode that does not exist. `run_tm_described`'s `Err` side carries only
   `TooLarge` and `LowerError`; `HitCap`, and `Overflow` at the maximum width, fall through to its
   catch-all arm, which **builds the header and returns `Ok`**. It can do that because a header
   records the INITIAL tapes and the decoding recipe, never the answer — so it is complete and valid
   however the fitting run ended.

   **AND THE CORRECTION ABOVE THEN OVER-GENERALIZED, WHICH THE WHOLE-BRANCH REVIEW CAUGHT AS A
   CRITICAL.** It went on to say that a program whose fitting run caps "emits successfully, exit 0,
   with nothing on stderr", that "the file is faithful", and that whether to mention it was "an open
   question, not a defect". That is true of `HitCap` and **false of `Overflow`**, and `Ok` covers
   both.

   `run_tm_described` answers `Ok(DescribedRun { run: TmRun::Overflow, .. })` once fitting reaches
   `MAX_FIELD_WIDTH` and the value still does not fit. The width in that header is one at which
   fitting **failed**, so the machine is not faithful — it halts, on corrupt tapes, which means
   `run`'s cap guard never fires and the decode succeeds. Reproduced on the default encoding:

   ```
   let mut i = 0; let mut n = 0; while i < 300 { n = n + 1; i = i + 1; } n

   run p.rxt                     -> 300     exit 0
   run p.rxt --backend tm        -> exit 1  "a value exceeded the widest tape field"
   emit p.rxt --lang tm -o p.tm  -> exit 0  (silent)
   run p.tm                      -> 0       exit 0     <-- a wrong answer, reported as the answer
   emit --encoding binary; run   -> 300     exit 0
   ```

   The binary line is what proves corruption rather than semantics. The in-process backend refuses
   this program and the emitted file answers it wrongly, on the pipeline §8 calls the oracle.

   **So the rule is per-variant, not per-`Ok`:** `Overflow` REFUSES (exit 2, nothing written, and the
   message says `--encoding binary` may succeed where unary did not); `HitCap` emits and exits 0 with
   a note on stderr, because there the width WAS fitted and the file genuinely is faithful; `Ran`
   emits silently. `emit` must match on `DescribedRun.run` rather than discard it.

   **The lesson is about the correction, not the code.** The first version of this item asserted a
   failure mode that could not happen. The second checked `HitCap`, found the file faithful there, and
   generalized to every `Ok` — including the one variant where it is not. A correction is not
   self-verifying, and the case you checked is not the case you skipped.
3. **Three backends means three cap constants a user can meet.** `interp`'s step budget,
   `MAX_REDUCTION_STEPS`, and `TM_DEFAULT_CAPS` are unrelated numbers with unrelated meanings. Each
   `HitCap` diagnostic must name *which* budget and which backend, or the flag makes the tool harder
   to reason about rather than easier.
4. **`.tm` collides with TeXmacs**, already noted in the grammar README. It affects editors, not this
   CLI, which dispatches on the extension it is given.

## §10 Explicitly out of scope

- **`--backend native`** — not a dependency; see §1.10.
- **`--deny-warnings`**, a config file, and further lint rules — each tracked separately by the
  roadmap and none blocked by this slice.
- **`parse_asm`** — priced by Plan 3 and unclaimed since; this slice emits into the gap and does not
  fill it.
- **`--trace` / step reporting** — §7.
- **Running `.rxlambda`** — §3, and the reason is structural rather than an omission.
