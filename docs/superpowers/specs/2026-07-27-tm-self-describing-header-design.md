# A self-describing TM text form — optional header — Design Spec

> **Status:** IMPLEMENTED (2026-07-28). Plan:
> `docs/superpowers/plans/2026-07-27-tm-self-describing-header.md`. Designed 2026-07-27 and revised the
> same day against the merged binary branch (D5/D6 added; two claims corrected — see below).
> **One correction this spec's own Testing section earned during implementation:** six of the seven
> "the guard proves less than its name claims" findings the branch produced originated in the plan
> derived from this spec, not in the implementations. The roadmap entry tabulates them.
> **Depends on:** the binary `Encoding` slice (`docs/superpowers/specs/2026-07-26-tm-binary-encoding-design.md`)
> — **LANDED** (merged 2026-07-27). `Binary` is the header's reason to exist and its first real consumer.
> **Context:** The TM text form serializes a `Machine` — the transition function and start state — and
> nothing else. It does not record the initial tape contents, the field width, the encoding, or the
> result type. So a printed machine round-trips faithfully *as a machine* and still cannot be run or
> read back from the file alone. This spec makes the format self-describing, via an **optional** header.

## The problem, stated precisely

A Turing machine is a transition function plus an initial configuration. **The text form serializes only
the first half.**

`print_tm` emits two header directives, `tapes N` and `start NAME`, then the states and rules.
`init_reg`/`init_work` are produced by the `Encoding` at run time and never written down. The field
width lives in the `Encoding` instance, not the machine. The result type lives in the caller's
expectations — `decode_tape` takes a `&Value` purely for its *shape*, because a bare tape cannot
distinguish a `Nat` from a `Bool` from a list pointer.

The binary slice made this concrete rather than theoretical. `Binary`'s decode was **width-strict**:
`decode_nat` and `parse_heap_cells` required a field to close exactly at `width`, so a tape produced by
a machine fitted at 16 cells decoded to `None` under a 64-cell `Binary`, and nothing in the file said 16.

**Superseded, and the correction matters for this spec's scope.** That decode is now structural — both
encodings read one delimiter to the next — so the specific trap is gone and no caller has to be told the
width in order to decode. What that removes is a *motivating symptom*, not the goal below. A `.tm` file
still records no initial tapes, no slot count and no result type, so it still cannot be run by a foreign
simulator or have its answer interpreted from the file alone. The header must therefore justify itself on
those grounds; the width-mismatch anecdote is history, not a requirement.

One consequence for the header's `width` field: it is no longer needed to make *this* project's decode
work. It stays because it is part of the recipe that reproduces the literal initial tapes, and the test
asserting that recipe round-trips is what keeps the two halves of the header honest about each other.

## Goal

A `.tm` file that any reader can **run**, and that this project can **interpret**, with nothing but the
file.

Concretely, given only the text:

1. build the initial configuration and simulate — possible for **any** TM simulator, with no knowledge
   of this project's encodings;
2. decode the final tapes to a `Value` — possible for a reader that has the `Encoding` implementations,
   which the header *names* but cannot inline.

That asymmetry is inherent and worth stating plainly: running is universal, interpreting requires the
encoding's semantics. The header closes the gap it can close and names the gap it cannot.

## The optionality guarantee — the load-bearing requirement

**The header is optional. A machine with no header remains exactly as runnable as it is today.** Four
properties, each a test:

| | property | what it guarantees |
|---|---|---|
| 1 | `parse_tm(print_tm(m))` → `(Some(m), [])` | today's round-trip, untouched |
| 2 | `parse_tm_full(print_tm_with(m, h))` → `(Some(m), Some(h), [])` | the new round-trip |
| 3 | `parse_tm(print_tm_with(m, h))` → `(Some(m), [])` | a headered file still reads as a plain machine |
| 4 | `parse_tm_full(print_tm(m))` → `(Some(m), None, [])` | a header-less file yields **no header, not an error** |

The reason optionality is free: **a header adds no capability to the machine, it removes an input
requirement.** `simulate(&m, &init, caps)` needs the caller to supply `init`. Without a header that
stays true. With one, `init` can come from the file instead. Nothing about δ, the start state, or
execution changes.

## Non-goals

- **Any change to `Machine`.** The codebase states the rule twice, in `lower_tm.rs`: provenance is a
  *returned artifact*, never a struct field, because `Machine` derives `PartialEq` and the round-trip
  asserts `parse_tm(print_tm(m)) == m` — "which a side-table field would break for a reason unrelated
  to what the machine computes." The header obeys that rule.
- **Making the text form executable end-to-end by a foreign tool.** Interpreting a result requires the
  encoding's semantics, which a name cannot convey. Out of scope, and stated so nobody expects it.
- **A binary/compact container format.** The text form is line-oriented and human-readable; the header
  matches it.
- **Emitting a header by default.** `print_tm` keeps its exact current output.

## Decisions

**D1 — Both the literal tapes AND the recipe, with a consistency check.**

The header carries the initial tape contents *literally* (`tape 0 …`) so any simulator can run the
file, **and** the `encoding`/`width`/`slots` recipe needed to decode the result.

The two are redundant by construction: `Binary::at(16).init_reg(7)` reproduces the literal REG tape
exactly. That redundancy is turned into a **checked invariant** — a test asserts the recipe reproduces
the literal tapes for every machine the compiler emits. This is the move the project already makes
everywhere else: the oracle *is* redundancy, checked.

*Beat:* recipe only — compact and impossible to contradict, but a generic simulator could not run the
file at all, giving up most of what an interchange format is for. *Also beat:* literal tapes only —
runnable by anything, but the result is uninterpretable, which is the "runs but unreadable" outcome.

**D2 — One parser. `parse_tm` becomes a thin wrapper.**

`parse_tm_full` is the only parser; `parse_tm` calls it and drops the header. This is not an
aesthetic preference: `parse_tm` **must** be taught to skip header directives regardless, or it would
hit its unknown-line error path and reject any file carrying one. Given that it must change, having it
delegate rather than duplicate removes the failure mode where two parsers drift.

**D3 — Tapes are addressed by INDEX, with the name as a comment.**

`tape 0 #0000#  ; reg`. Tape *names* (REG/WORK/STACK/HEAP/BOX) are this compiler's convention, not a
property of a Turing machine; a generic simulator knows only indices. The trailing comment keeps the
file readable for humans, and comments are already dropped on parse and regenerated on print.

*Beat:* symbolic names only — more readable, but it would bake this compiler's tape layout into a
format that claims to be generic.

**D4 — Cells are written packed, not space-separated.**

`#0000000000000000#` rather than `# 0 0 0 …`. Rules use space-separated symbol lists because a rule's
entries may be the wildcard `*`; a tape has no wildcards, and `Symbol` is a `char` — the text form
already relies on this, since `parse_sym` takes a token's first character. Packed keeps a 120-cell bank
on one readable line.

**D5 — `result` admits only decodable types.**

`Nat | Bool | Unit | List<T>`. `Ty` also has `Fun` and `Var`, which are not first-class values on the
tape — `decode_word` returns `None` for them. Writing one is a **parse error**, not a silent `None`,
so an unreadable file is rejected where it is written rather than where it is read.

The printer for these four already exists: `typeck.rs`'s private `show(ty)` emits exactly this grammar,
character for character. Make it public and reuse it. Only the parser direction (`&str -> Ty`) is new,
and a second printer would be a second thing to keep in agreement for no gain.

**D6 — `decode_tape` and `decode_tape_ty` are SIBLINGS over a shared tape read, not one over the other.**

They read the same two tapes and then disagree on purpose. Share the reading; keep the decoding apart.

The two decoders are not interchangeable, and the difference is load-bearing:

| final tape | `decode_tape` (Value-directed) | `decode_tape_ty` (Ty-directed) |
|---|---|---|
| word `0`, witness `[1]` / `List<Nat>` | `None` | `Some(Nil)` |
| any word, `Value::Unit` / `Ty::Unit` | `None` | `Some(Unit)` |

The Value-directed strictness is what makes the oracle catch a machine that returned a *shorter list*
than the reference — `decode.rs`'s `decodes_nil_result` tests exactly that. And expressing it over the
Ty-directed decoder needs a `Value -> Ty` witness function that is **partial**: `Value::Nil` carries no
recoverable element type.

So: factor the tape-reading half — REG slot 0 to a word, HEAP to cons cells, both through `enc` — into
one shared helper, and put the two word-decoders on top of it. An **agreement test** pins them together
on the cases where both are defined, mirroring `asm.rs`'s `decode_asm_ty_matches_decode_asm`.

*This corrects an earlier draft of this spec*, which said `decode_tape` would be "expressed over"
`decode_tape_ty` and cited `asm.rs` as the precedent. `asm.rs` in fact kept `decode_asm` and
`decode_asm_ty` as siblings; the draft described the opposite of the file it cited.

## Architecture

### 1. Grammar

Header directives are optional, order-independent, and must precede the first `state`:

```
tapes 5                          ; existing, required
start entry                      ; existing, required
encoding binary                  ; new — unary | binary
width 16                         ; new — field width in CELLS
slots 7                          ; new — REG bank field count
result List<Nat>                 ; new — Nat | Bool | Unit | List<T>
tape 0 #0000000000000000#…       ; new — literal initial contents  ; reg
tape 1 #0000000000000000#        ; new                             ; work

state entry:
  …
```

An omitted `tape` line means that tape starts empty, which is how HEAP, STACK and BOX always start.

**Partial headers are a parse error, not a partial success.** `encoding` without `width` cannot
construct an `Encoding`; `result` without `encoding` cannot decode. This avoids a half-populated
`TmHeader` whose consumers must each decide what to do about the missing half.

Precisely, since "partial" needs a definition:

- The **header set** is `encoding`, `width`, `slots`, `result`. `tapes` and `start` are pre-existing
  and required with or without a header; they are not part of it.
- **Zero of the four present** → the file has no header. `parse_tm_full` returns `None` for it, with
  no diagnostic. This is property 4, and it is what every file written before this slice looks like.
- **All four present** → a header, parsed and validated.
- **One to three present** → a diagnostic naming the missing directives. Not a `None`, because
  silently discarding a half-written header would turn a typo into "this file has no header".
- **`tape` lines are individually optional** and are not part of the header set: an omitted tape
  starts empty, which is how HEAP, STACK and BOX always start. A header with no `tape` lines at all
  is legal and describes a machine whose every tape starts empty.

### 2. API — additive; `Machine` untouched

```rust
/// What a `.tm` file records ABOUT its machine, as opposed to the machine itself. Returned alongside
/// a `Machine` rather than stored on it — see `lower_tm.rs`'s rule about `PartialEq` and the
/// round-trip. `None` means the file carried no header, which is not an error.
pub struct TmHeader {
    pub encoding: EncodingKind,        // Unary | Binary
    pub width: usize,                  // field width in CELLS
    pub slots: u32,                    // REG bank field count
    pub result: Ty,                    // Nat | Bool | Unit | List<T>
    pub tapes: Vec<(usize, Vec<Symbol>)>,  // literal initial contents, by tape index
}

impl TmHeader {
    /// The `Encoding` instance this header names, at its width.
    pub fn encoding(&self) -> Box<dyn Encoding>;
    /// The initial tape vector to hand `simulate`, from the literal `tape` lines.
    pub fn init(&self, n_tapes: usize) -> Vec<Vec<Symbol>>;
}

pub fn print_tm_with(m: &Machine, h: &TmHeader) -> String;
pub fn parse_tm_full(src: &str) -> (Option<Machine>, Option<TmHeader>, Vec<Diagnostic>);

pub fn print_tm(m: &Machine) -> String;                            // UNCHANGED — emits no header
pub fn parse_tm(src: &str) -> (Option<Machine>, Vec<Diagnostic>);  // wrapper over parse_tm_full
```

One addition in `tm/decode.rs`, mirroring the existing `decode_asm_ty` — a **sibling** of `decode_tape`,
not a replacement for it (D6):

```rust
/// Decode a final tape set against a TYPE rather than a `Value` shape witness — what a reader with
/// only the file has. `decode_tape` stays as it is; the two share only the tape READ.
pub fn decode_tape_ty(tapes: &[Tape], ty: &Ty, enc: &dyn Encoding) -> Option<Value>;
```

The AOT work already hit this wall and solved it the same way: a standalone binary has no reference
run, so it decodes against a serialized type. `decode_asm_ty` is the precedent to follow — including
the part where it sits *beside* `decode_asm` rather than absorbing it.

**The one new coupling, stated rather than discovered later:** `parse_tm_full` must know the set of
encoding names, so adding a third encoding means touching the parser. That is inherent to any format
that names its variants, and it is a small, obvious edit — but it is a new place a new encoding must
be registered, and the plan should say so where a future implementer will read it.

### 3. The consistency check

For every machine the compiler emits, at every fitted width:

```
h.encoding().init_reg(h.slots) == h.tapes[REG]
h.encoding().init_work()       == h.tapes[WORK]
```

If the recipe and the literal tapes ever disagree, one of them is lying about how the machine starts.
The check is what makes D1's redundancy safe rather than a second source of truth.

## What this disturbs

1. **`parse_tm` gains a delegation layer.** Its signature and behaviour are unchanged; every existing
   call site is untouched. The round-trip test is the check.
2. **`print_tm`'s output is unchanged.** A machine printed without a header is byte-identical to today.
   If it is not, the split is wrong.
3. **`tm_machine.rs`'s round-trip tests** gain the two new properties (3 and 4) alongside the existing
   one.
4. **Nothing in `lower_tm`, `sim`, or any `Encoding` changes.** This is a serialization slice.

## Testing

1. **The four optionality properties**, one test each. Property 4 (a header-less file yields `None`,
   not a diagnostic) is the one most likely to regress silently, because a parser taught to recognize
   directives is a parser that can start requiring them.
2. **Round-trip over compiled machines**, both encodings, at their fitted widths — the existing
   `compiled_machines_round_trip_through_the_text_form` extended to `print_tm_with`/`parse_tm_full`.
3. **The recipe/literal consistency check** (Architecture §3) over the demo corpus.
4. **A file → value end-to-end test**: parse a `.tm` file, build `init` from the header, `simulate`,
   `decode_tape_ty` against the header's `result`, and assert the value — with no `Core`, no
   `lower_tm`, and no reference run in the test. That is the whole point of the slice, and it is the
   test that fails if any piece of the header is insufficient.
5. **Malformed-header cases**: partial header, unknown encoding name, `result Fun<…>`, a `tape` line
   with an out-of-range index, a `width` that disagrees with the literal tapes. Each a diagnostic, none
   a panic.
6. **The two decoders agree where both are defined** (D6) — Nat, Bool, and a non-empty `List<T>` decode
   identically through `decode_tape` and `decode_tape_ty`. The test must also pin the two cases where
   they deliberately *disagree* (nil under a `Cons` witness; `Unit`), or it would silently pass if one
   decoder were re-expressed over the other later.
7. **Sabotage**, with each sabotage aimed at the check that can actually see it:

   | sabotage | must go red |
   |---|---|
   | `init_reg` lays out one field too many | consistency check |
   | the header's `width` off by one | consistency check |
   | the header's `encoding` swapped unary↔binary | end-to-end |
   | the header's `result` `List<Nat>` → `Nat` | end-to-end |
   | one cell of a literal `tape` line flipped | end-to-end |

   **An earlier draft assigned the `width` sabotage to the end-to-end test. That is false, and the
   reason is worth keeping.** Structural decode made both encodings width-independent — `Binary`'s
   `decode_nat` and `parse_heap_cells` each say in as many words that "`self.width` is never
   consulted." Width reaches the end-to-end path only through `h.encoding()`, which feeds only those
   two, so a width off by one is *invisible* there. It is visible to the consistency check, because
   `init_reg` writes `width` cells per field. This is the same lesson the branch has now recorded
   several times: a check is only as good as the direction and dimension it is aimed at.

## Deliverables

1. `TmHeader`, `EncodingKind`, and the grammar.
2. `print_tm_with` / `parse_tm_full`; `parse_tm` re-expressed as a wrapper.
3. `decode_tape_ty` in `tm/decode.rs`, beside `decode_tape` over a shared tape read (D6); `typeck.rs`'s
   `show` made public and reused as the `result` printer (D5).
4. The four optionality properties, the consistency check, the decoder-agreement test, and the
   end-to-end file → value test.
5. A short section in the roadmap recording what the format now guarantees, and the one thing it
   cannot: a foreign tool can run a `.tm` file but cannot interpret its result without the encoding.

## What stays open

1. ~~**The `run_tm` + `decode_tape(&Binary::default())` trap.**~~ **CLOSED before this slice started, and
   not by it.** An earlier draft listed this as something the header only half-fixed: `run_tm` discards
   the fitted width, so a caller decoding with a default-width `Binary` got a silent `None`. The
   structural-decode commit removed the premise — both encodings now read one delimiter to the next, so
   the reader's width no longer has to match the writer's. `tm.rs`'s `run_tm` doc records this directly:
   discarding the width "is fine for decoding … since both encodings decode structurally." Kept here,
   struck rather than deleted, so a reader of the old draft learns it was retired rather than dropped.
2. **No versioning.** The header has no format-version directive. Adding one costs nothing now and
   would cost a migration later, but it is speculative until a second version exists — recorded as a
   deliberate omission rather than an oversight.
3. **Nothing writes `.tm` files to disk today.** This slice makes the format self-describing; it does
   not add a CLI or a file-emitting entry point. Whether one is wanted is a separate question.
