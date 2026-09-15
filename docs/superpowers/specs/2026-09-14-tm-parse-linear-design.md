# `.tm` parsing in linear time — design

> **Roadmap:** not an existing roadmap item. Found on 2026-09-14 while measuring the cost of printing reduced
> machines for the reduced-machine `.tm` header (stage 3's *What this did not close*, second bullet). It lands
> before that header work, which edits the same two parser files.

## What this delivers

- **Duplicate state names are detected in linear time.** This covers `parse_tm_nav`, and so `parse_tm`,
  `parse_tm_full`, the language server's navigation index and every CLI path that reads a `.tm` file.
- **Duplicate `tape i` header lines are detected in linear time.**
- **Nothing observable changes.** Every diagnostic keeps its message, span and position in the diagnostic
  list; every navigation definition and every parse result stays the same.
- **A slow-tier ratio test goes red** if either scan comes back.

## What was measured

### The cause

`syntax.rs:546` is `if states.iter().any(|s| s.name == name)`. Every `state` line compares its name with every
earlier state's name, so the check costs time proportional to the square of the state count.

- **Profile.** `perf` on a mid-size parse put 87% of self time in libc's `memcmp`, under `Iterator::any` in
  `parse_tm_nav`, called from `parse_tm_full` and `parse_tm`.
- **It follows the state count.** Generated files with one rule per state:

  | states | 1k | 4k | 16k | 64k | 128k | 256k |
  | --- | --- | --- | --- | --- | --- | --- |
  | `parse_tm` | 1.06 ms | 9.58 ms | 125 ms | 3.76 s | 12.0 s | 83.8 s |

- **It does not follow the other variables.**
  - 16k states with 1 to 16 rules each parse in 122 to 182 ms.
  - 32k states over 2 to 512 symbols parse in 617 to 681 ms.
  - Names 256 bytes long that differ only at the end cost more than names that differ at the front. The extra
    cost quadruples each time the state count doubles, which is pairwise comparison of name bytes.
- **Every parse entry point pays it; the printers do not.**

  | entry point | 16k states | 32k | 64k |
  | --- | --- | --- | --- |
  | `parse_tm` | 140 ms | 716 ms | 3,742 ms |
  | `parse_tm_full` | 140 ms | 766 ms | 4,050 ms |
  | `parse_tm_nav` | 129 ms | 779 ms | 3,749 ms |
  | `print_tm` | 1.15 ms | 2.69 ms | 5.75 ms |

### What it costs on real files

Printed with `print_tm` and parsed back with `parse_tm`; every row round-tripped exactly:

| machine | rules | bytes | print | parse |
| --- | --- | --- | --- | --- |
| `3 - 5`, stages 1+2 | 21,621 | 1,515,415 | 3.17 ms | 187 ms |
| `cons(1, cons(2, nil))`, stages 1+2 | 60,422 | 4,308,512 | 8.36 ms | 1.31 s |
| `3 - 5`, all three stages | 160,994 | 11,568,836 | 78 ms | 10.88 s |
| `cons(1, cons(2, nil))`, all three stages | 1,002,222 | 73,632,864 | 781 ms | 1,233.57 s |

Today's largest shipped demo is `WORST_SHIPPED_DEMO` (`single_tape.rs:1144`), lowered with
`run_tm_described_at(.., EncodingKind::Binary, .., MAX_FIELD_WIDTH)`: 49,135 states, 11,526,427 bytes as
`print_tm_with` writes it. `parse_tm_full` takes **1.08 s** on it (fastest of 3), with no diagnostics.

### The sibling

`header.rs:419` guards `tape i` with `self.tapes.iter().any(|(j, _, _)| *j == i)`, the same shape. A real file
has at most one `tape` line per tape, so only a crafted file reaches the cost. Extra distinct `tape` lines in
the header of a one-state machine, `parse_tm_full`, fastest of 3:

| extra `tape` lines | 1k | 4k | 16k | 64k | 128k |
| --- | --- | --- | --- | --- | --- |
| parse | 0.26 ms | 3.43 ms | 50 ms | 826 ms | 3.52 s |

### Searched and excluded

The search covered `.iter().any(` and `.contains(&` in `tm/syntax.rs`, `tm/header.rs`, `tm/asm_syntax.rs`,
`lambda/syntax.rs`, `parser.rs`, `binder.rs` and `nav.rs`:

- **`Machine::validate`** already detects duplicate names with a `HashSet` (`machine.rs:87`).
- **`lambda/syntax.rs`'s `fresh`** (`:504-523`) is a printer helper that scans the names in scope at one
  binder. It grows with nesting depth, not with file size, and is a different shape.
- **Every other hit** is inside a test.

## What the tests pin today

- **`duplicate_state_name_is_an_error`** (`syntax.rs:942`): a message containing `duplicate`, and no machine.
- **`a_duplicate_state_line_records_both_definitions`** (`syntax.rs:1392`): both navigation definitions, at
  spans 25 and 44, and no machine.
- **`malformed_header_directives_are_spanned_diagnostics_never_panics`** (`syntax.rs:1117`, the row at
  `:1136`): for two `tape 0` lines, a message containing `duplicate`, no machine and no header, and every span
  within the file.

**Not pinned, for either duplicate check:** the exact message, the exact span, and the diagnostic's position
among the others.

The language-server tests that speak of a duplicate — `redextape-lsp`'s
`opening_a_file_publishes_its_diagnostics_at_the_right_span` (`lib.rs:765`) and `tests/protocol.rs:79` — pin
the duplicate `tapes` line error. That is a different check (`syntax.rs:459-469`), and this slice does not
touch it.

## Design

### 1. Pin the observable behaviour first

Before either scan changes, add tests in `syntax.rs` that assert the WHOLE diagnostic list — message, span
and order of every entry:

- **A duplicate state line that also carries an earlier error on the same line.** For example
  `state s: acceptx` repeated: ``expected `:` or `: accept` after the state name`` is pushed before the
  duplicate check, so the order of the two diagnostics is part of what is pinned. Include a later error so a
  shifted position is visible.
- **Two `tape 0` lines** in an otherwise valid header, plus one other header error.
- **The navigation definitions for the first case**, as `a_duplicate_state_line_records_both_definitions`
  does.

### 2. `parse_tm_nav`: a set of names seen

- A `HashSet` of state names seen replaces the scan at `syntax.rs:546`.
- A name enters the set where its `RawState` is pushed (`syntax.rs:556`), after the check — so the second
  line is the one that finds the name, as today.
- A duplicate line still pushes its diagnostic, its navigation definition and its `RawState`, in the same
  order as today.

### 3. `HeaderParts::directive`: a set of `tape` indices seen

- A `HashSet<usize>` of indices seen replaces the scan at `header.rs:419`.
- `tapes` keeps its order and contents, because `finish` and the range check read it.

### 4. The ratio test

- Lives in a new `crates/redextape-core/tests/tm_parse_scaling.rs`, `#[ignore]`, so
  `scripts/check-slow.sh` runs it with `cargo test --release --workspace -- --ignored`.
- Generates two families of files:
  - **State lines:** 16,000 and 64,000 states.
  - **`tape` lines:** 16,000 and 64,000 extra lines.
- Times `parse_tm_full` on each, keeping the fastest of 3.
- Asserts `large < 8 × small` for each family. Linear growth gives about 4×. Measured before the fix: 30×
  for states (125 ms → 3.76 s) and 16.5× for `tape` lines (50 ms → 826 ms).
- One test per family, so a sabotage of one scan reddens a test that measures that scan.

### Sabotages, run while planning on the finished code

| sabotage | expected red |
| --- | --- |
| restore `states.iter().any` in `parse_tm_nav` | the state-line ratio test |
| restore `self.tapes.iter().any` in `HeaderParts::directive` | the `tape`-line ratio test |
| insert a name into the set BEFORE the duplicate check | the pinned diagnostics of step 1, since every state line reports itself as a duplicate |
| skip the navigation definition on a duplicate line | `a_duplicate_state_line_records_both_definitions` |

If an expected red stays green, that is recorded as a finding.

### Figures for the roadmap entry

Re-run after the fix, with the same commands:
- the parse column of the real-files table
- the largest shipped demo's 1.08 s
- the `tape`-line table

## Not in scope

- the printers, which are already linear
- the language server's per-request scans
- `lambda/syntax.rs`'s `fresh`
- the reduced-machine `.tm` header
- any parse cost beyond these two scans

## Provenance

Every probe is untracked, in the scratch worktree `.claude/worktrees/agent-a389527aeb539cd2c`, run on
2026-09-14 at `78ebea6` under `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 --`, with
`cargo run --release --example <name> -p redextape-core`. Nothing in the tree re-derives these figures.

- **`reduced_text_size_probe`:** the real-files table.
- **`parse_cost_today_probe`:** the largest shipped demo and the `tape`-line table.
- **`parse_perf_states`, `parse_perf_rules`, `parse_perf_names2`, `parse_perf_symbols`, `parse_perf_entry`:**
  the cause, from a diagnosis agent's runs, including the `perf` profile. The line citations above were
  re-read directly; these ramp figures were not re-run.
