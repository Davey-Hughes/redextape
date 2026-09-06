# `redextape fmt` for the `.tm` and `.asm` text forms — design

**The follow-on both merged LSP entries named.** PR A (#77) made formatting the TM and asm text forms
lossless by teaching their parsers to keep comments; PR B (#78) proved the printers work through a
second consumer. `redextape fmt` still handles `.rxt` alone, so the guarantee PR A landed is not yet
reachable from the command line. This slice makes it reachable.

**Scope is two forms, not four.** `.rxlambda` is deliberately excluded — see §7.

---

## §1 What is missing, verified against the tree at `7b4a1ff`

**`redextape fmt` decides the language in exactly one place, and that place hardcodes `.rxt`.**
`crates/redextape-cli/src/fmt.rs`'s `one` reads the input, calls `redextape_core::format_with_width`,
and everything after that — `--check`, the unified diff, the atomic write, the `Outcome` — is already
language-agnostic. So the change is one dispatch plus the tests that hold it, not a rework of `fmt`.

**The CLI already dispatches on extension, and it does it in `run`.**
`crates/redextape-cli/src/run.rs` lowercases the path's extension and matches `"tm"` and `"asm"` onto
a private `Artifact` enum, then refuses `--backend` for either with a per-variant noun. Its own
comment records why the match is ASCII-case-insensitive: `M.TM` is as much an artifact as `m.tm`, and
a byte-for-byte comparison sent an uppercase file down the `.rxt` path where the lexer produced a
cascade of errors blaming a valid file on the program.

**So a second extension table is the hazard this slice must not create.** `run` has one; `fmt` needs
the same knowledge. Two copies of "which extension means what" is the drift this repository treats as
a defect, and PR B added `scripts/check-lua.sh`'s `FILETYPES`-to-`languageId` check for exactly that
class one PR ago.

**`Artifact` and the form are not the same question, which is why this slice adds a type rather than
reusing that one.** `Artifact` is `Option`al and has two variants: it answers *"is this already
compiled output, so `--backend` is meaningless?"*. Formatting needs a total three-way answer —
`.rxt`, `.tm`, `.asm` — because all three format. The two are isomorphic (`None` ↔ `Rxt`) and they
are not interchangeable.

---

## §2 The `Form` type, and where it lives

A new `crates/redextape-cli/src/form.rs`:

```rust
pub enum Form { Rxt, Tm, Asm }

impl Form {
    pub fn from_extension(path: &Path) -> Option<Form>;   // ASCII-case-insensitive
    pub fn is_artifact(self) -> bool;                     // Tm | Asm
    pub fn sniff(src: &str) -> Option<Form>;              // §4
    pub fn resolve(input: &Input, explicit: Option<Form>, src: &str) -> Form;  // §3; `src` is §4
}
```

**`form.rs` answers only "which form is this", never "what do you do with one".** The formatting
dispatch stays in `fmt.rs`. That boundary is what lets `run` depend on this module without pulling
three printers into a command that does not print.

**`run` adopts `from_extension` and `is_artifact`, and nothing else.** Its five `Artifact` uses become
`Form` uses inside the one function that holds them, so the extension table exists once and "is this
compiled output" is answered once. **`run`'s resolution path is deliberately untouched**: it keeps
treating stdin as `.rxt` and it gains neither `--form` nor sniffing. Those are `fmt`'s policy, and
moving them into `run` would change the behaviour of a shipped command as a side effect of a
formatting change — see §8.

---

## §3 Resolution precedence

1. **`--form rxt|tm|asm` if given.** Wins over everything, including a contradicting extension. A
   mismatch is *not* an error: overriding what the filename says is the whole reason the flag exists.
2. **Otherwise the path's extension**, ASCII-case-insensitively, for the reason `run.rs` records.
3. **Otherwise, for stdin only, sniff the content** (§4).
4. **Otherwise `.rxt`.**

**Sniffing is stdin-only, and that is a safety property rather than a simplification.** A path with an
extension has already answered the question. A `.rxt` file whose text happens to satisfy another
front end must never be silently reformatted as a machine, and restricting the sniffer to the one
input that carries no extension is what makes that impossible rather than unlikely.

---

## §4 The sniffer is the parsers, not a pattern

**There are no patterns.** `Form::sniff` runs the real front ends and asks which one accepts:

1. Content with no non-whitespace character → `None` (the caller falls back to `.rxt`). This guard
   exists solely to remove the one ambiguity §4.1 measured, and for no other reason.
2. `parse_tm_full(src)` yields a machine → `Tm`.
3. `parse_asm_full(src)` yields a program → `Asm`.
4. Otherwise `None`.

**Steps 2 and 3 test `machine.is_some()` / `program.is_some()`, NOT `diagnostics.is_empty()`, and the
difference is latent rather than visible.** Both document types document that the payload is `None`
*exactly when* an error-severity diagnostic was reported, so the two predicates agree on every input
today — `git grep -n "Severity::Warning\|::warning(" crates/redextape-core/src/tm/` matches nothing,
because every diagnostic those two parsers emit is an error. **They stop agreeing the moment anyone
adds a warning.** A sniffer keyed to emptiness would then start refusing a machine that parsed
perfectly and merely warned, fall through to `.rxt`, and report lexer noise about a valid file — the
exact failure `run.rs`'s case-insensitivity comment already records once. Keying to the payload is
immune to that, costs nothing, and is the predicate the document types actually define.

**Why not patterns.** `plugin/redextape.lua` already sniffs `.tm` and `.asm` buffers by content, and a
second pattern set in Rust would be one rule in two languages — with no gate able to hold them in
step, because the two have genuinely different inputs (sixty buffer lines against whole stdin) and
different fallbacks (a path test against none). Trial parsing has no rule to duplicate: the parser
*is* the definition of the language, so the CLI and the plugin cannot disagree about what a `.tm`
file is, because only one of them holds an opinion.

**And a pattern rule could not have been written correctly anyway.** The obvious asm signal — the
`result <Type>` line — is optional. A checked-in fixture that `run_asm` exercises is two indented
mnemonics with no header, no `result` and no label, and a header-based sniffer would miss it.

### §4.1 The acceptance matrix, measured rather than assumed

Run against the real front ends before this design was written, by a throwaway example deleted after
use. **The probe used the stricter predicate — a payload AND an empty diagnostics list — which on
today's tree is the same test as §4's `is_some()`**, for the reason §4 gives: neither parser emits a
warning, so a payload and an empty list coincide on every input. The matrix would therefore be
identical under either predicate today, and the one §4 specifies is the one that survives a warning
being added. `rxt` means `redextape_core::format` returned `Ok`.

| input | tm | asm | rxt |
|---|---|---|---|
| empty | | ✓ | ✓ |
| whitespace only | | ✓ | ✓ |
| comment only (`; …`) | | ✓ | |
| minimal asm — no header, no `result`, no label | | ✓ | |
| asm with `result` | | ✓ | |
| minimal tm | ✓ | | |
| tm with comments | ✓ | | |
| `let   x=1;\nx+1` | | | ✓ |
| `[1, 2, 3]` | | | ✓ |
| `42` | | | ✓ |
| `x` | | | ✓ |
| `let f = \x. x; f 1` | | | |

**Ten of twelve are unambiguous. Both ambiguous rows are the degenerate file** — empty and
whitespace-only, each accepted by asm and by `.rxt` — which is why step 1 above is a guard on
emptiness and not a general tie-break. Inventing a precedence rule for a case that only arises when
there is nothing to format would be a mechanism with no work to do.

**The row accepted by nothing is the one that shows the fallback is right.** `let f = \x. x; f 1`
satisfies no front end, falls to `.rxt` by step 4, and the user gets a real `.rxt` parse error rather
than a shrug about an unrecognised file.

### §4.2 What makes a wrong guess safe

**A wrong sniff fails loudly and writes nothing.** If the sniffer returned `Tm` for content that is
not a machine, `parse_tm_full` reports diagnostics, `fmt` renders them and returns `Failed` with exit
2 — the same path a genuinely broken file already takes. The worst case is a refused format, never a
mangled file. That is what makes trial parsing acceptable where a heuristic would not be: the sniffer
and the formatter consult the same authority, so the sniffer cannot approve something the formatter
then mishandles.

**Sniffing costs up to two extra parses, and the format parses again.** On the size of input that
arrives through a pipe this is not worth optimising, and threading a parsed document out of
resolution would couple identity to parsing for no real gain. It is recorded here so that a later
reader knows the cost was chosen rather than overlooked.

---

## §5 `--width` does not apply to the two artifact forms

`--width` is a line budget for `.rxt`'s pretty-printer. The TM and asm printers take no width — they
lay out from their own content.

**So an explicit `--width` on a `.tm` or `.asm` input is an error, in `run`'s voice.** `run` already
refuses `--backend` on those forms rather than ignoring it, and silently accepting a flag that does
nothing is worse in a formatter, where the user is asking for a specific shape and will believe they
got it.

**The flag must be distinguished from the config default, and today it is not.** `main.rs` collapses
the two with `width.unwrap_or(cfg.fmt.width)`, so by the time `fmt::run` sees a width it cannot tell
a user's `--width 60` from `redextape.toml`'s value. Erroring on the collapsed value would refuse
every `.tm` format on a machine with a config file. `main.rs` therefore keeps the `Option` and passes
it through, and the error fires only on `Some`.

Exit code 2, via the existing `Outcome::Failed`.

---

## §6 Formatting, per form

One dispatch replaces the single `format_with_width` call in `fmt.rs`'s `one`:

| form | call | failure |
|---|---|---|
| `Rxt` | `redextape_core::format_with_width(src, width)` | `Err(diagnostics)` → render, `Failed` |
| `Tm` | `print_tm_doc(&parse_tm_full(src))` | `None` → render the document's diagnostics, `Failed` |
| `Asm` | `print_asm_doc(&parse_asm_full(src))` | `None` → same |

`print_tm_doc` and `print_asm_doc` return `None` exactly when the document carries an error, so the
`None` arm and the diagnostics arm are the same case reached two ways, not two cases.

**Nothing downstream changes.** `--check`, `diff`, the atomic write, the stdin filter behaviour and
the `Outcome` ordering are all already language-agnostic and are not touched.

---

## §7 What this slice does not do

- **`.rxlambda` is not formatted, and that is a scope decision rather than an oversight.** The CLI has
  no λ surface at all: `run` knows only `tm` and `asm`, and `crates/redextape-cli/src/emit.rs` records
  that a `.rxlambda` file "stays read-only from the command line". Teaching `fmt` alone would create a
  new asymmetry — formatted by `fmt`, untouchable by `run` — rather than closing the existing one.
  **A follow-on slice should give the CLI a λ surface properly**, across the subcommands that should
  have one, instead of bolting it onto whichever command is being edited.
- **`run` gains no `--form` and no sniffing.** §2 and §8.
- **`--form` does not accept a fourth value**, because there is no fourth form the CLI serves.
- **No new configuration key.** `--form` is per-invocation by nature; a `redextape.toml` default for
  "what language is my stdin" would be a setting whose right value changes per pipe.

---

## §8 Rejected approaches

**Sharing the whole resolution policy between `run` and `fmt` (a single `resolve` both call).** It
would change `run`'s behaviour as a side effect: `cat p.tm | redextape run -` would begin sniffing
stdin, where today it is unconditionally `.rxt`. That is a semantic change to a shipped command,
arriving inside a formatting change, justified by nothing in this design and covered by none of its
tests — and `run` executing a program has consequences `fmt` does not. `--form` would also have to
either grow onto `run` or become a parameter one caller always passes `None` to, which is a shared
function with a per-caller shape. **Sharing the extension table and `is_artifact` gets the real
benefit; sharing the policy buys a behaviour change.**

**A private form enum inside `fmt.rs`.** The smallest diff, and it ships a second copy of the
extension table knowingly.

**Pattern-based sniffing mirroring the plugin's.** §4 — no correct header-based asm rule exists, and a
mnemonic list would be one rule in two languages with no gate able to hold it.

**Content sniffing for paths as well as stdin.** §3 — a path already answered the question, and the
upside (formatting a machine named `p.txt`) does not pay for the downside (a `.rxt` file reformatted
as something else).

**A `--lang` alias for `--form`.** One name.

---

## §9 Tests

**Anti-divergence, which is the property this slice most needs to keep.**

- **Exhaustive `match` on `Form` in both `run` and `fmt`, with no `_` arm.** A fourth form breaks both
  call sites at compile time. This is structural and outranks any test: the two commands cannot drift
  on which forms exist, because neither compiles until both are updated.
- **One shared `(filename, expected Form)` table**, read by both commands' tests, so a disagreement
  about what `M.TM` is reddens.
- **A per-`Form` × per-command table asserting each cell has a specified outcome.** Deliberately not
  asserting the outcomes *match*: `run` refuses `--backend` on an artifact while `fmt` formats it, and
  a sameness assertion would either fail at once or be weakened until it asserted nothing.

**The sniffer.**

- **`tm_and_asm_never_both_accept`** — over the §4.1 corpus, no input is accepted by both front ends.
  They look disjoint, because a TM's `tapes <n>` is an unknown mnemonic to the asm parser; "look
  disjoint" is a claim and this pins it.
- One case per §4.1 row, including both ambiguous rows resolving to `.rxt` and the orphan row falling
  through to a real `.rxt` diagnostic.
- **A wrong sniff writes nothing** — the §4.2 property, asserted rather than reasoned about.

**The formatting itself.**

- **`comments_survive_fmt`** for both forms — the user-visible payoff of PR A, asserted from the
  command line rather than from the library. Must carry an assertion the input cannot satisfy on its
  own, so it cannot pass against a formatter that returned the buffer unchanged.
- **`formatting_an_already_formatted_file_is_clean`** for both forms. This is what stops
  `fmt --check` flapping in CI, and it is the property a formatter is for.
- `M.TM` formats as a machine.
- An unparseable `.tm` and `.asm` each render diagnostics, write nothing, and exit 2.

**The flags.**

- `--width` on a `.tm` errors **only when explicitly passed**; the config default formats silently.
- `--form tm` on a file named `.rxt` formats it as a machine, with no mismatch error.
- `--form` overrides sniffing on stdin.
