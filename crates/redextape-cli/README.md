# `redextape` — the command line front end

    redextape fmt foo.rxt            rewrite in place
    redextape fmt --check src/*.rxt  diff what would change; rewrite nothing
    redextape fmt -                  stdin to stdout
    redextape lint foo.rxt           parse, type and lint diagnostics
    redextape run foo.rxt            evaluate the program, print the value
    redextape run foo.tm             simulate the machine, decode its tapes
    redextape run foo.asm            execute the listing, decode its result
    redextape emit foo.rxt --lang tm compile to a backend text form
    redextape.toml                   repo-level defaults for four settings (see below)

Exit codes: `0` success, `1` the check failed (`fmt --check` found a file it would rewrite, or `lint`
found an error-severity diagnostic), `2` the work could not be done (an unreadable or missing file,
bad arguments). `fmt` also exits `2` on a file it cannot parse — a formatter that cannot parse its
input has not done its job — where `lint` reports that same parse failure as a diagnostic and exits
`1`. Diagnostics go to stderr, so `redextape fmt - > out.rxt` and `redextape lint f.rxt | …` both stay
clean.

`run` and `emit` use those same two codes under one rule: **`1` means the program is at fault, `2`
means this tool could not answer.** A parse error, a type error, `head(nil)`, and a computation that
runs past its step budget are all `1` — the input is what went wrong. A backend that cannot lower the
program, a lowering that exceeds `MAX_MACHINE_STATES`, a result type with no encoding, a value that
does not fit the widest tape field its encoding has, and an unreadable file are all `2`: the program
may be perfectly good and the tool still has nothing to say about it. Collapsing the two would tell a
script the program failed when it did not. The `2`s a user is most likely to meet on a program that is
fine are written out at the end of this file, because each reads as a bug in the flag until you know
the rule.

`fmt` is exactly `print ∘ parse` — `redextape_core::format_with_width`, which is `format` with the
line budget passed in rather than read off `printer::MAX_WIDTH`, so the one flag and the one config
key both land in the same place. A file that does not parse is reported and left untouched. Every other file named on the same command line is still processed, and the worst
outcome across them is what sets the exit code.

`lint` reports errors and two warnings: a `let mut` that is never assigned, and a binding that is never
read. Name a binding `_x` to say you meant it. A warning does not fail the run by default — `lint`
exits `0` and prints it — but `--deny-warnings` (or `lint.deny-warnings = true` in `redextape.toml`)
makes it exit `1` instead, with the warning still on stderr either way. `--no-deny-warnings` overrides
a config `true` back off for one invocation.

## `redextape.toml`

`redextape` reads at most one config file per invocation, and every key it can set has a matching
flag, so precedence is the same everywhere: **flag > config file > built-in default.**

    [lint]
    deny-warnings = false     # default

    [fmt]
    width = 120               # default; the value printer::MAX_WIDTH still holds

    [emit]
    encoding = "unary"        # unary | binary; applies to --lang tm only
    field-width = 0           # 0 = auto-fit (the default); otherwise 4..=64

`--deny-warnings` / `--no-deny-warnings` on `lint`, `--width` on `fmt`, `--field-width` on `emit`
(`--encoding` already existed) each override the matching key for one invocation. `emit`'s two keys
apply only to `--lang tm`; a config file setting them does not make `--encoding`'s or
`--field-width`'s existing rule — an error, not a silent no-op, on any other target — start firing on
a command line that used to work, because the guard tests whether the *flag* was typed, not what
value is in effect. A config file must never be able to trip *that guard* on an invocation that used
to work. It is not an absolute about config files as a whole: `field-width` pins a width, and a pinned
width can refuse a program auto-fitting accepts, so `field-width = 4` really can turn a working
`emit --lang tm` into an exit `2` — the refusal names the key, so the cause is visible.

**Discovery walks up from the current directory, checking for the file before checking for `.git` in
each directory, and stops at the first `.git` it crosses.** A repository root normally holds both, so
checking `.git` first would stop one directory short of the file the walk exists to find. `.git` is
tested with `exists()`, not `is_dir()`, because a worktree or a submodule writes it as a *file* — this
repository uses worktrees, so the wrong predicate would fail exactly where it is most likely to be
exercised. Finding no file during discovery is the normal case and is silent. `--config PATH` names a
file explicitly instead of searching, and *that* file being missing is an error, exit `2` — naming a
file that is not there is a mistake, where finding none during discovery is not. `--no-config` skips
discovery and uses built-in defaults. Both flags are global and so appear under every subcommand's
`--help`.

**A config file that cannot be understood stops the run before any work, exit `2`, naming the file and
the key** — deliberately strict rather than forward-compatible, because the config's most important
key is a CI gate and a typo that silently disarms one is worse than no config file at all:

    $ redextape lint a.rxt
    error: /repo/redextape.toml: unknown field `deny_warnings`, expected `deny-warnings`
    # exit 2

    $ redextape fmt a.rxt
    error: /repo/redextape.toml: `fmt.width` must be in 20..=1000, got 4
    # exit 2

**`fmt.width` is a budget, not a bound, whether it comes from the flag or the file.** Three constructs
already exceed it, and `redextape-core`'s own property tests assert that they do: a binary chain never
breaks across lines; a parameter list is printed with `join(", ")` and has no width handling at all;
and indentation costs 4 columns per nesting level with no fill rule, so a program nested ten levels
deep can overrun on whitespace alone with nothing else on the line. A narrower width makes all three
bite more often — setting `width = 40` and then seeing a 60-column line is meeting a documented
property, not hitting a bug.

**`--width` is the one flag whose value is not range-checked, and that is deliberate.** `fmt.width`
outside `20..=1000` in `redextape.toml` is refused at exit `2`; the identical value passed as
`--width` is accepted and used exactly as given. Who is affected is the reason: a config value
silently governs every future invocation for everyone who inherits the file, so a bad one is caught
once, strictly, before it can do that, where a `--width` someone types misfires once, visibly, for
the person who typed it, and refusing it would protect nobody who was not already looking at the
mistake. `--width 0`, `--width 1` and `--width 18446744073709551615` all exit `0` and print
degenerate but valid output — every construct over budget, or none of them.

**`--field-width` is range-checked, at the same `0` or `4..=64` its config key uses and the same exit
`2`, and the difference is what a bad value leaves behind.** A bad `--width` prints ugly output once
and the invocation is over. A bad `--field-width` writes a *file*: `--field-width 65` emitted a `.tm`
whose header says `width 65`, at exit `0`, which this tool's own reader then refuses — the mistake
outlives the command as an artifact on disk that nothing downstream can open. A width past what the
encodings can allocate a tape bank for was worse still: it aborted the process from inside a library
path that is not allowed to panic. Neither is a mistake the person who typed it is still looking at.

## `run` — one verb, three input kinds

`run` dispatches on the file extension, and the arms are different pipelines:

    redextape run p.rxt                    a program: parse, typecheck, evaluate, print
    redextape run p.rxt --backend lambda   the same program through the λ-calculus lowering
    redextape run p.rxt --backend tm       …and through the Turing machine
    redextape run p.tm                     a machine: parse, simulate, decode the tapes
    redextape run p.asm                    a register-machine listing: parse, validate, require a header, execute, decode
    redextape run -                        stdin, always read as a program

`--backend {reference,lambda,tm}` chooses the evaluator for a `.rxt` program and defaults to
`reference`, the tree-walker that `redextape_core::run` already is. The other two lower first —
`lambda` through `lower` and `run_lambda`, `tm` through `lower_asm` and `run_tm_fitted` — and then
decode the result back to a value. On a program all three can answer for, all three print the same
line, and that agreement is the property the whole project is built on.

**`--backend` on a `.tm` or `.asm` file is an error, not a silent ignore.** The artifact already *is* a
Turing machine or a register-machine program, so there is nothing left to choose, and accepting the
flag would imply otherwise.

**A `.tm` file is runnable because it is self-describing.** Its header carries the encoding, the field
width, the slot count and the result type — exactly what `TmHeader::init` needs to build the initial
tapes and what `decode_tape_ty` needs to read the final ones. A header-less `.tm` still parses, and
`run` still refuses it, with a message saying to re-emit through `redextape emit --lang tm`, which
always writes a header. A machine that does not halt inside `TM_DEFAULT_CAPS` exits `1` and prints
nothing: a partial tape that happens to decode is not an answer. A file whose final tapes fail to
decode as the `result` its own header declares is not one failure but two, with opposite fault
attributions (`DecodeFailure::Mismatch` and `DecodeFailure::BudgetExhausted`). Tapes that contradict
the header's own declared type — a `Bool` slot holding neither `0` nor `1`, a heap pointer out of
range — are a `Mismatch`: a header is a promise about the tapes, and a file that breaks its own promise
is the file's fault, exit `1`. A cyclic heap is caught the same way, but only against its OWN cost: a
cycle reached before the decode's shared budget is exhausted by anything else is a `Mismatch`, exit
`1`, same as above — but a cycle sitting behind an expensive sibling elsewhere in the type is never
even reached once that sibling alone exhausts the budget, and the failure reported is
`BudgetExhausted` like any other, exit `2`. Two files carrying the identical cyclic heap can exit
differently depending only on where in the type the cyclic element sits relative to an expensive one.
Tapes that are consistent with the header but too large to finish decoding within `MAX_DECODE_NODES`
are `BudgetExhausted`: the header may be entirely truthful, and it is this tool's limit that stops the
decode, exit `2`. The same decode refusal under `--backend tm` is always a `2`, for an unrelated
reason: there the type comes from the program's own static inference rather than a file's `result`
header, so there is nothing the file could have lied about.

**A `.asm` file needs its header for the opposite reason a `.tm` file does.** A `.tm` header carries
the *initial* tapes, so a header-less machine has nothing to run at all. A register-machine listing
runs perfectly well with no header — it is a complete program — the header only names the type its
result register should decode as. So a header-less `.asm` file parses, validates and would execute
fine; `run` refuses it anyway, before running it, because it would otherwise spend up to
`DEFAULT_CAPS.steps` (five million) reaching an answer it then has no declared type to print. The
refusal points at `redextape emit --lang asm`, which writes a `result` header whenever the program's
result type can be expressed. A run that hits the step, stack or heap cap, or that faults, is the
program's fault (`1`). A run that finishes decodes its result against the header's declared type, and
that decode has the same `DecodeFailure::Mismatch` / `DecodeFailure::BudgetExhausted` split `.tm` has,
above: a result that contradicts the header's declared type is a `Mismatch` — the header lied about
what the program computes — the program's fault (`1`), the same attribution `.tm` gives a lying
header. A result that is consistent with the header but whose decode exhausts `MAX_DECODE_NODES`
before finishing is `BudgetExhausted` — the header may be entirely truthful — this tool's limit (`2`).

**`.rxlambda` is deliberately not a `run` input.** A bare λ term carries no result type, and both
non-reference decoders are type-directed, so there would be nothing to decode against. `emit --lang
lambda` writes those files for `parse_lambda` and for an editor's grammar to read, not for this
command.

## `emit` — three targets, and every one reads back

    redextape emit p.rxt --lang tm                    the machine, to stdout
    redextape emit p.rxt --lang tm -o p.tm            …to a file
    redextape emit p.rxt --lang tm --encoding binary  packed tapes instead of unary
    redextape emit p.rxt --lang lambda -o p.rxlambda
    redextape emit p.rxt --lang asm

Output goes to stdout unless `-o` names a file, so `emit` composes with a pipe. `--encoding
{unary,binary}` selects the tape encoding and applies to `--lang tm` only; passing it anywhere else
exits `2` rather than being a silent no-op. `--field-width CELLS` pins the TM tape field width instead
of auto-fitting; it is `--lang tm`-only under the same rule, for the same reason — a config file or a
flag must not be able to change what a non-`tm` invocation does. Omitting it auto-fits, which is
today's behaviour and starts narrow and widens on overflow; a pinned width skips that search entirely
and can therefore refuse a program auto-fitting would have accepted, at the same exit `2` the encoding
section below shows — but with a *different message*, because on a pinned run `MAX_FIELD_WIDTH` was
never attempted and `--encoding binary` is not the remedy. The pinned refusal names the width it
actually tried and the setting that chose it; the two are written out at the end of this file.

| target | what it writes | can `redextape` read it back? |
|---|---|---|
| `tm` | a complete self-describing machine, header included | yes — `parse_tm_full`, and `redextape run` |
| `lambda` | the λ-calculus lowering of the program | yes — `parse_lambda` |
| `asm` | the register-machine lowering, headered when the result type can be expressed | yes — `parse_asm`, and `redextape run` |

**All three emitted forms read back, and two of the three are also runnable from the command line.**
`parse_asm` is the newest of the three readers, landing alongside `Program::validate` and two
round-trip properties, so nothing `emit` writes is write-only anymore — every emitted file opens by
naming the parser that reads it back. `run` dispatches on extension among a `.tm` machine, a `.asm`
listing, and `.rxt` (or stdin) source, so

    $ redextape emit p.rxt --lang asm -o p.asm && redextape run p.asm

is the second of the two artifact forms `run` executes — `.tm`'s pair, below, is the first: compiled
to the register machine, written to disk, read back by a parser that shares no code with the
compiler, executed, and decoded — the same value the tree-walker gives. `.rxlambda` remains the one
form `run` does not take; see above.

`--lang tm` goes through `run_tm_described` — or through `run_tm_described_at` when a width is pinned,
which is the same single attempt with the search skipped — rather than a bare lowering, because those
are what produce a `TmHeader`. It costs a bounded simulation, and it is what makes the emitted file
runnable:

    $ redextape emit p.rxt --lang tm -o p.tm && redextape run p.tm

**A machine is written only when the fitting run's values fit.** If they do not, `emit` refuses and
writes no file (see below). If the fitting run instead hits `TM_DEFAULT_CAPS`, the file IS written and
`emit` exits `0` with a note on stderr: a header records the initial tapes and the decoding recipe,
never the answer, so the file describes exactly the machine that was built — it will simply meet the
same cap when `run` simulates it.

Those two commands are the project's oracle written out in a shell. The program is compiled all the
way down to a Turing machine, written to disk, read back by a parser that shares no code with the
compiler, simulated, and decoded — and the value that comes out is the one the tree-walker gives.

## The `2`s that are not bugs

**`--backend lambda` and `--backend tm` cannot decode a function-typed result.** Both decoders are
type-directed, and both refuse `Ty::Fun` and `Ty::Var`; the encodings cover `Nat`, `Bool`, `Unit` and
`List<T>` and nothing else. `--backend reference` has no such limit, because it never leaves the
interpreter. It is reachable from a three-token program:

    $ redextape run g.rxt                    # g.rxt is `let g = |x| x; g`
    <non-value>

    $ redextape run g.rxt --backend lambda
    error: `--backend lambda` cannot decode a result of type `(t2) -> t2`
      the encodings cover Nat, Bool, Unit and List<T>; this type has none
      `--backend reference` will evaluate it
    # exit 2

A polymorphic identity types as `(t2) -> t2`, which carries both refused shapes at once. The program
is fine — it parses, it typechecks, and the reference backend evaluates it — so this is exit `2` and
not exit `1`. The `<non-value>` on the reference line is a result, not a failure: the mini-language
can produce a closure, and no text form encodes one.

**`--lang tm` refuses a program whose values do not fit the tape**, and refusing is the whole point:

    $ redextape emit p.rxt --lang tm -o p.tm    # p.rxt counts to 300
    error: no machine was written: a value does not fit this encoding's widest tape field (64 cells, `MAX_FIELD_WIDTH`)
      the program is fine — but the machine would HALT on truncated fields, and `redextape run` would decode them and print a wrong answer at exit 0
      `--encoding binary` holds a far larger value in the same field and may succeed where unary did not
    # exit 2

    $ redextape emit p.rxt --lang tm --encoding binary -o p.tm && redextape run p.tm
    300

Auto-fitting widens the field and retries; `MAX_FIELD_WIDTH` is where it stops, and unary at that
width holds values up to 63. A machine emitted past that point still HALTS — on truncated fields — so
nothing downstream notices: `run`'s cap guard never fires and the decode succeeds on corrupt tapes.
That is why this is a refusal rather than a warning, and the binary line above is the proof it is the
encoding rather than the program that could not express the answer.

**A PINNED width refuses with a different message, because a different thing went wrong.** Above, the
search really did reach 64 cells and the encoding is what ran out. Pinned, 64 was never tried at all —
so the message names the width that *was*, and the setting that chose it:

    $ redextape --no-config emit q.rxt --lang tm --field-width 4    # q.rxt is `40 + 2`
    error: no machine was written: a value does not fit a 4-cell tape field, which is where `--field-width 4` pinned it
      the program is fine — but the machine would HALT on truncated fields, and `redextape run` would decode them and print a wrong answer at exit 0
      raise `--field-width`, or drop it and let the search fit one: auto-fit starts at 4 cells and doubles to at most 64 (`MAX_FIELD_WIDTH`)
    # exit 2

With `field-width = 4` in `redextape.toml` and no flag typed, the same program hits the same wall — and
the remedy is in a file the user may not have written, so the message says which key:

    $ redextape emit q.rxt --lang tm
    error: no machine was written: a value does not fit a 4-cell tape field, which is where the config file's `emit.field-width = 4` pinned it
      …
      raise `emit.field-width`, set it to 0 to auto-fit, or override it for this run with `--field-width`: auto-fit starts at 4 cells and doubles to at most 64 (`MAX_FIELD_WIDTH`)
    # exit 2

`--encoding binary` is deliberately *not* offered on either: it does not lift a pin. Measured on this
same program, `--encoding binary --field-width 4` refuses exactly as unary does, and
`--encoding binary --field-width 8` emits — the width is what had to move.
