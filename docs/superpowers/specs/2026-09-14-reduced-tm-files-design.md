# Reduced `.tm` files — design

> **Roadmap:** closes stage 3's *What this did not close* bullet "A `.tm` header for folded machines stays
> open" (`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, the entry headed *STAGE 3 SHIPS AS A
> ZIG-ZAG FOLD*).
>
> **Builds on two branches that merged after this was written:**
> - `reduction-state-guard` (#92, `3fab0f1`), for `refusal()`
> - `tm-parse-linear` (#91, `f4cfa21`), for a `.tm` parser that is linear in state count
>
> **Two more merged beside them:** the universal machine (#93) and counter machines (#94). They change no file
> this design touches, except `tm.rs`'s module list, which gained `pub mod universal;`.
>
> This branch is rebased onto `main` at `11f7d66`, and its plan is written against that tree. Line numbers
> below were taken at `78ebea6` and may have moved; symbols are named so they can be found again.

## What this delivers

- **`redextape emit --lang tm --reduce <stages>`** writes a `.tm` file for a program's machine after any
  subset of the three reductions.
- **`redextape run <file>`** runs that file and prints the program's value, using nothing but the file.
- **Reduced files carry header `version 2`.** Lowered files are unchanged at `version 1`.

## Decisions, made 2026-09-14

| question | chosen | not chosen, and why |
| --- | --- | --- |
| What must a reduced file let a reader do? | Run it, and decode the result to a value, from the file alone. | **Run only:** a reduced file would no longer become a value on its own. **Run, decode and self-check:** the header would also have to carry the padding amounts and the pre-reduction initial tapes, for a redundancy check the lowered header keeps. |
| Where are reduced files written from? | A CLI flag, `emit --lang tm --reduce`. | **Example only:** no supported way to make one. **Core API only:** only test code could. |
| Which stage lists? | Any non-empty subset of `fold, single-tape, two-symbol`, in that order. | **Any order, repeats allowed:** 2 → 1, 1 → fold, 2 → fold and repeated stages have never been run by any test. **Full pipeline only:** every file would be the largest shape. |
| How does `run` get enough steps? | The header records the step count `emit` measured, up to a fixed ceiling. | **A `--max-steps` flag:** the file alone would not run. **Keep 5,000,000:** `3 - 5` through all three stages takes 7,088,578, so it would be refused. |
| How does a reduced file mark itself? | `version 2`, for reduced files only. | **Stay at version 1:** `width`, `slots` and `result` change meaning, which `HEADER_VERSION`'s doc says is what a version bump is for. **Version 2 for every file:** every fixture and grammar corpus would be regenerated for no change in meaning. |
| The step ceiling | 10^9 steps. | **10^10:** a single `run` or `emit` could take over a minute. **5×10^7:** refuses `sum(5)` even through stage 1 alone. |
| The web app | No web or wasm change; full support is its own slice later. | **Plain layout for reduced files:** a small wasm change, deferred with the rest of the web support. |

## What was checked before designing

### How `run` reads a `.tm` file today

`run.rs`'s `run_artifact_text`:
1. simulates `header.init(machine.tapes)` under `TM_DEFAULT_CAPS`, which is 5,000,000 steps and 5,000,000 cells;
2. rejects only `TmStatus::HitCap`;
3. decodes with `decode_tape_ty_reason(&tapes, &header.result, &*enc)`, reading the tapes as the lowered
   layout.

A reduced file therefore needs its own run and decode path; the existing one would misread its tapes.

### Step counts of reduced machines

Measured 2026-09-14 by a scratch probe, `--release`, under `EncodingKind::Unary`. Stage 1 alone, stages 1
then 2, and all three (fold, then stage 1, then stage 2), composed as the oracle tests compose them:

| program | stage 1 | stages 1+2 | all three |
| --- | --- | --- | --- |
| `3 - 5` | 257,216 | 2,158,491 | 7,088,578 |
| `cons(1, cons(2, nil))` | 397,970 | 3,347,605 | 15,249,613 |
| `if 2 > 1 { 10 } else { 20 }` | 1,499,580 | 12,509,349 | 43,262,547 |
| `1 + 2 * 3` | 1,606,768 | 13,494,013 | 45,412,211 |
| `fn sum(n) … sum(5)` | 303,610,850 | over 2×10^9 (capped) | over 2×10^9 (capped) |

The simulator ran at 126 million steps per second on the same machine, so the ceiling of 10^9 is about 8 s.

### Printed size and parse time

One parse each, as re-measured for `tm-parse-linear`'s roadmap entry:

| machine | rules | bytes | parse at `78ebea6` | parse at `136b29b`, `tm-parse-linear`'s last code commit |
| --- | --- | --- | --- | --- |
| `3 - 5`, all three | 160,994 | 11,568,836 | 10.64 s | 159.89 ms |
| `cons(1, cons(2, nil))`, all three | 1,002,222 | 73,632,864 | 1,230.07 s | 1.10 s |

### What decoding needs that the machine text does not carry

- **`deinterleave(tape, k)`** needs `k`, the tape count before stage 1.
- **`unbitify(tape, code)`** needs the `Code`, and `Code`'s only constructor is `Code::new(m, inits)`, which
  needs the machine before stage 2. What the decoder needs is the code's symbol order, which
  `Code::symbols()` returns.
- **`unzigzag(tape)`** needs nothing. It returns an `OriginSnapshot { cells, head, origin }`.
- **No test today chains the inverses back to a `Value`.** The composed oracle tests compare neighbouring
  stages only.

### What an old reader does with a version 2 file

`HeaderParts::directive`'s `version` arm accepts exactly `HEADER_VERSION`, which is 1. Anything else is
``unsupported header version `{v}` (this build reads version 1 only)``. An unknown directive line is
`unrecognized line`. So a build without this branch refuses a reduced file either way, and says why at the
`version` line.

### The web app

The TM scratch pane (`redextape-wasm`'s `tm_scratch`) hands a headered file to `build_tm_leg`, the same
function a compiled program's TM leg is built with, and never decodes a value. What a reduced header does to
that pane's view is left to the web slice; this branch changes no web or wasm code.

## Format

A reduced file, with illustrative values:

```text
tapes 1
start pre
version 2
encoding unary
width 8
slots 4
result Nat
reduced fold, single-tape 5, two-symbol _#1<>ABab|
steps 7088578
tape 0 …
state pre:
…
```

### Rules

- **`version 2` requires both `reduced` and `steps`.** Under `version 1`, either line is an error. Under
  `version 2`, a missing `reduced` or `steps` is an error.
- **`reduced` lists stages, comma-separated, in the order `fold`, `single-tape`, `two-symbol`, with no
  repeats.** Each stage carries the data its inverse needs:
  - `fold` — nothing
  - `single-tape <k>` — the tape count before stage 1, `1..=MAX_ENCODABLE_TAPES`
  - `two-symbol <symbols>` — the code's symbols in `Code::symbols()` order, written as one run, as `tape`
    cells are. `two-symbol` is always the last stage, so its run is everything after `two-symbol ` to the end
    of the line's content. A symbol can be `,`, but it can never be whitespace or `;`, so neither a comma
    nor a trailing comment makes that ambiguous.
- **`steps N`** is the step count `emit` measured, with `1 <= N <= 10^9`.
- **`tape` lines are the reduced machine's literal initial tapes**, so any simulator can run the file.
- **`encoding`, `width`, `slots` and `result` are the recipe for the tapes once the reductions are undone**,
  exactly as they are for a lowered file.

## Components

### 1. The header

- **`TmHeader`** gains `reduction: Option<Reduction>`:
  - `Reduction { stages: Vec<Stage>, steps: u64 }`
  - `enum Stage { Fold, SingleTape { k: usize }, TwoSymbol { symbols: Vec<Symbol> } }`
- **Writing.** `write_header` writes `version 2` exactly when `reduction` is `Some`, and writes `reduced` and
  `steps` after `result`.
- **Reading.** `HeaderParts::directive` accepts versions 1 and 2, and gains `reduced` and `steps` arms.
  `HeaderParts::finish` enforces the version rules above.
- **Registration points.** `TmDirective` gains two variants, and `syntax.rs`'s header-key filter and
  `directive_anchor` gain both keys.
- **A known trap.** Widening the key filter without a matching `directive` arm makes the parser skip the line
  with no diagnostic, so a test gives every new key a malformed value and asserts a diagnostic.

### 2. `Code::from_symbols`

`Code::from_symbols(symbols: &[Symbol]) -> Option<Code>` rebuilds a code from its symbol order. It returns
`None` unless `BLANK` comes first and no symbol repeats. A test asserts that it rebuilds exactly
`Code::new(m, inits)` for every machine the oracle corpus reduces.

### 3. The producer

It lives in a new core module `tm/reduced_file.rs`, whose name matches no tracked file, declared in `tm.rs`
between `pub mod one_way;` and `pub mod reduction;`. Its input is a
`DescribedRun` whose `run` is `Ran`; the producer refuses any other run outcome.

1. **Apply the stages in canonical order,** each with its initial-tape layout:
   - `fold`: `zigzag(inits, k)`.
   - `single-tape`: `interleave(inits, k, left, right)`. The pads come from a run of the machine stage 1
     receives that records each tape's lowest and highest head position: they are those extents beyond the
     initial contents, plus a margin the plan measures.
   - `two-symbol`: `Code::new(m, inits)`, then `bitify`.
2. **Refuse anything that cannot be built:**
   - `refusal()` on the result gives `ReduceError::Refused(name)`;
   - `layout_collision`, or a `None` from `zigzag` or `bitify`, is an error too.
3. **Verify before writing.**
   - Simulate the reduced machine under 10^9 steps.
   - Require a halt in an accept state; a halt in `overflow` or any other non-accept state fails.
   - Undo the stages, decode, and require the lowered run's value.
   - Anything else is `ReduceError::Unverified`, and no file is written.
4. **Build the header:** the lowered header's recipe, the reduced machine's literal initial tapes, and
   `Reduction { stages, steps }`.

### 4. The decoder

`decode_reduced(tapes: &[Tape], h: &TmHeader) -> Result<Value, DecodeFailure>`.

- **A version 1 header** decodes with `decode_tape_ty_reason`, exactly as today.
- **A version 2 header** undoes its stages in reverse:
  1. `two-symbol`: `unbitify` each tape with `Code::from_symbols`.
  2. `single-tape`: `deinterleave(tape, k)` into `k` tapes.
  3. `fold`: `unzigzag` each tape, then `Tape::new(&snapshot.cells)`.

  Then it calls `decode_tape_ty_reason`.
- **A structural `None` from any inverse** is `DecodeFailure::Mismatch`: the file's own tapes disagree with
  its own header.
- **An expectation the tests must confirm:** decoding a `Tape` rebuilt from `OriginSnapshot::cells` works,
  because decoding locates fields by their delimiters rather than by offset. The end-to-end tests below are
  what confirm it.

### 5. The CLI

- **`emit --reduce <list>`**
  - It is valid only with `--lang tm`, following the rule `--encoding` and `--field-width` state.
  - An empty, out-of-order or repeated list is an error naming the order `fold, single-tape, two-symbol`.
  - A `ReduceError` is an error, and no file is written.
  - The `emit --help` snapshot (`crates/redextape-cli/tests/cmd/emit_help.stdout`) changes.
- **`run` on a version 2 `.tm` file**
  - It simulates under the header's `steps`, with `TM_DEFAULT_CAPS`'s cell cap.
  - A halt anywhere but an accept state is an error.
  - It decodes with `decode_reduced`, reporting through `report_tm_decode` as a version 1 file does.
- **`run` on a version 1 file** is unchanged.

### 6. The tree-sitter grammar

- **The grammar.** `grammar.js`'s `_directive` gains `reduced` and `steps` nodes, and the highlight queries
  capture both.
- **Grammar-check's corpus** gains reduced files printed by the producer, `3 - 5` under several subsets. That
  puts them under the existing tests: `every_tm_query_pattern_fires_over_the_corpus`,
  `parse_tm_accepts_every_corpus_entry`, `the_tm_grammar_agrees_with_the_headered_printer` and
  `every_printed_token_is_captured`.

## Testing

### Fast tier

1. **Header round-trip.** For all 7 stage subsets on `3 - 5`, `parse_tm_full(print_tm_with(m, h))` returns
   `m` and `h`.
2. **End to end, the point of the branch.** For all 7 subsets on `3 - 5`: produce, print, parse the text back,
   simulate under the header's `steps`, `decode_reduced`, and require the reference interpreter's value. The
   largest of these is all three stages at 7,088,578 steps and 11.6 MB of text.
3. **CLI round trip.** `emit --reduce` then `run` on `3 - 5` for at least `single-tape` and all three stages,
   compared with `run --backend reference`.
4. **Errors, each asserting its message:**
   - `--reduce` with `--lang asm`
   - an empty, out-of-order or repeated list
   - `reduced` or `steps` under `version 1`
   - `version 2` without `reduced` or `steps`
   - `steps` above 10^9
   - a malformed value for each new key
5. **A refused reduction writes no file.** Checked in core through the guard's crate-private ceiling, since a
   real trip needs the largest shipped demo.
6. **`Code::from_symbols`:** rebuilds every corpus code, and refuses `BLANK` not first and a repeated symbol.

### Slow tier

End to end, as fast-tier test 2, for all three stages on `cons(1, cons(2, nil))`, `if 2 > 1 { 10 } else { 20 }`
and `1 + 2 * 3`, and for stage 1 on `sum(5)`. These are 15 to 304 million steps, and up to 73.6 MB of text.

### Sabotages, run while planning

| sabotage | expected red |
| --- | --- |
| reverse two symbols in the header's `two-symbol` run | end-to-end decode |
| write `k - 1` for `single-tape` | end-to-end decode |
| drop `fold` from `reduced` on an all-three file | end-to-end decode |
| write `steps` one lower than measured | `run` on that file, at the cap |
| produce with zero padding margin | `emit`'s verification, which then refuses |
| accept `reduced` under `version 1` | the version-rule test |

The last-but-one row shows `emit`'s verification is live. If an expected red stays green, it is recorded as a
finding.

## Not in scope

- web or wasm support, which is its own slice
- a recipe self-check for reduced files
- stage orders other than `fold, single-tape, two-symbol`
- showing reduction details in the language server
- a universal machine or a two-counter machine

## For the plan to measure

- **The padding margin:** whether one block suffices over the corpus, and what zero does.
- **Emitting large files:** peak memory and time for the 73.6 MB `cons(1, cons(2, nil))` all-three file.
- **The rebuilt tapes:** that `decode_tape_ty_reason` accepts a `Tape` rebuilt from `OriginSnapshot::cells`
  for every subset containing `fold`.
