# Nullability override gate — design

**Slice:** `nullability-override-gate`. A follow-on to the `wire-type-generation` slice, which closed
at PR #71 (`65e8fac`) with this gap named in its own WHAT STAYS OPEN list. Extension track, not on
the critical path to v1.

**One-line statement of what this is:** a `ts-rs` field override replaces the whole field type,
`Option` and all, so an override on an `Option<T>` field can silently drop the `| null` the wire
carries; no gate sees that today, and this adds the two checks that do — one at the derive site, one
against the shipped generated file.

**Why now.** The wire-type slice's closing entry filed it as the sharpest of six open items:

> **No gate covers an override that changes a field's NULLABILITY, and this is the class this PR
> opened rather than closed.** `no_generated_type_carries_bigint` sees only the `bigint` an
> unoverridden `u64` produces, and `the_gate_covers_every_exported_type` sees only which types derive
> `TS`; an override that swaps a correct `number | null` for `number` passes both. `tsc` refuses it
> only while `web/src/types.ts` imports the type from `../bindings/` **and** something assigns a
> literal `null` to the field — today that is three test fixtures and no production file, so the check
> disappears the day those fixtures change shape, with nothing firing to say so.

That is a defect the slice measured rather than reasoned about: the design prescribed the wrong
override twice, by the same mechanism, and both times the gates stayed green.

**Scope boundary, decided before anything else:** no wire shape changes, no field or variant changes,
no change to any override that ships today. `TmStatus.total_steps` keeps
`ts(type = "number | null")` — the correct form the slice arrived at by measurement. This slice adds
two checks and changes nothing they are checking.

---

## §1 The tree as it stands — verified 2026-09-03 at `13f9ad3`

**Four override attribute sites exist across both scanned crates.** Command:

```
$ grep -rnE '^[[:space:]]*#\[.*\bts\((type|as) = ' crates/redextape-core crates/redextape-wasm --include='*.rs'
crates/redextape-core/src/viewmodel.rs:68:    #[cfg_attr(feature = "ts", ts(type = "number"))]
crates/redextape-core/src/viewmodel.rs:160:    #[cfg_attr(feature = "ts", ts(as = "Vec<Move>"))]
crates/redextape-core/src/viewmodel.rs:207:    #[cfg_attr(feature = "ts", ts(type = "number"))]
crates/redextape-wasm/src/session.rs:272:    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
```

Three sit on bare fields (`LambdaState::step` and `TmState::step`, both `u64`; `RuleView::moves`,
`Vec<String>`). The fourth sits on an `Option<u64>` — `TmStatus::total_steps`,
`crates/redextape-wasm/src/session.rs:273` — which is what the new rule's `Option` arm approves at
this commit.

**The anchor narrows from 184 lines to those same 4, in four steps, and every step is load-bearing.**
Commands and counts, in order:

| what is counted | count | command |
|---|---|---|
| lines containing the bytes `ts(` | 184 | `grep -rhc 'ts(' crates/redextape-core crates/redextape-wasm --include='*.rs'` summed |
| …with a word boundary before `ts` | 41 | same with `-E '\bts\('` |
| …excluding comment lines | 27 | `\| grep -vE ':[[:space:]]*(///\|//!\|//\|\*)'` |
| …excluding the two gate files | 21 | `\| grep -v '/tests/ts_bindings.rs:'` |
| …excluding the canonical derive line | 4 | `\| grep -v 'derive(ts_rs::TS)'` |

**The first step is the largest and the least obvious.** 143 of the 184 carry no word boundary before
`ts` at all, because the bytes `ts(` are the tail of every identifier ending in `ts` followed by an
open paren — `sweep_targets(`, `list_of_nats(`, `simulate_counts(`,
`reduce_trace_shares_its_snapshots(` are four of them. A scan anchored on those bytes without a word
boundary is not merely noisy; it is unusable.

**The second step is why §4.4 exists.** Fourteen of the 41 are comment lines, four of them in
`crates/redextape-wasm/src/session.rs`'s own doc comment, which quotes `ts(type = "number")` — the
wrong form — directly above the `Option<u64>` field it warns about. A scan without the comment
exclusion fails on the documentation written to prevent this bug.

The remaining two steps are exclusions the existing scanner already performs, reused rather than
reinvented: `scanner_path` for each caller's gate file, whose assertion strings quote both forms, and
equality with `CANONICAL_TS_DERIVE`, which carries `ts(export)`.

**Eleven nullable field sites exist across five generated types.** Command, JSDoc stripped so prose
about `| null` is not counted as a declaration:

```
$ grep -hv '^ \*' web/bindings/*.ts | grep -o '| null' | wc -l
11
```

| generated type | sites | Rust |
|---|---|---|
| `LambdaStatus` | `node`, `run` | `Option<NodeId>`, `Option<RunStatus>` |
| `LambdaState` | `cut`, `redex_span` | `Option<Cut>`, `Option<Span>` |
| `TmState` | `source_node`, `rule` | `Option<NodeId>`, `Option<usize>` |
| `TmStatus` | `width`, `run`, `total_steps` | `Option<usize>`, `Option<RunStatus>`, `Option<u64>` |
| `RuleView` | `read`, `write` | `Vec<Option<Symbol>>` — nullable **inside** the generic |

Ten of the eleven come from an `Option` that `ts-rs` mapped on its own, with no override involved.

**Four files assign a literal `null` to `total_steps`.** Command:

```
$ grep -rn 'total_steps: null' web/tests web/src
web/tests/node/replies.test.ts:99
web/tests/node/sessions.test.ts:662
web/tests/node/session-client.test.ts:152
web/tests/node/results.test.ts:111
```

The roadmap records **three** `TS2322` errors under the sabotage at `2df9a58`, not four. The figures
are not in conflict and neither is stale: `sessions.test.ts:662` builds an `as const` object literal
that may never be checked against `TmStatus`, so a grep for the assignment and a count of the errors
the sabotage produces are different quantities. **This slice does not reconcile them by reasoning.**
Sabotage 5 in §6 re-runs the sabotage and records what `tsc` actually reports. All four sites are in
`web/tests/`; none is in `web/src/`.

---

## §2 The defect class

`#[ts(type = "X")]` substitutes the **whole** field type, not the part of it that is wrong:

```rust
#[cfg_attr(feature = "ts", ts(type = "number"))]
pub total_steps: Option<u64>,          // generates `total_steps: number`
```

`None` crosses the wire as `null` — measured against a real browser by
`all_three_legs_agree_across_the_boundary` in `crates/redextape-wasm/tests/browser.rs` — so the
generated type is wrong, and wrong in the direction that removes a null check rather than adding one.

**The trap is that the same override is correct on a bare field.** `LambdaState::step` and
`TmState::step` are `u64` and take `ts(type = "number")` correctly, because `ts-rs` maps `u64` to
`bigint` and the wire carries a JS number. Nothing about the attribute distinguishes the two cases,
and both prescriptions in the original design were written as though the attribute edits the integer
inside the type rather than replacing the type.

The reverse direction is the same class: an override claiming `| null` on a field that is not
`Option` asserts a wire value that cannot occur, and produces null checks in the web code that can
never fire.

---

## §3 Why nothing sees it today

- `no_generated_type_carries_bigint` greps the generated text for `bigint`. There is no `bigint` in
  `number` to find, so it passes on the defect.
- `the_gate_covers_every_exported_type` compares which **types** carry the derive against a
  hand-maintained list. It never reads a field.
- `tsc` does refuse it, but only while two conditions both hold: `web/src/types.ts` imports the type
  from `../bindings/` (`tsconfig.json`'s `include` is `["src", "tests", "vite.config.ts"]`, which
  reaches the generated directory by no other route), **and** something assigns a literal `null` to
  the field. Condition two is satisfied by test fixtures only — `resultRows` in `web/src/results.ts`
  reads `total_steps` and narrows on `!== null`, and that narrowing compiles clean against `number`.

So the whole check is an accident of how some tests happen to build their fixtures. A refactor that
stopped constructing a `TmStatus` with a literal `null` would remove it, with nothing firing to say
so.

---

## §4 Piece 1 — the derive-site gate

### §4.1 Where it lives

One new function in `redextape-test-support::ts_derive_scan`, beside
`ts_deriving_type_names_in_crate`, with the same signature shape and the same
"the panics are the product" contract stated in that module's header:

```rust
pub fn assert_overrides_match_field_nullability(crate_root: &Path, scanner_path: &Path)
```

**The rule lives in the shared crate, not in the two gate files.** Both crates'
`tests/ts_bindings.rs` gain a third `#[test]` that calls it and nothing else. That is the same
decision the scanner move made in PR #71 and for the same stated reason: two copies of a rule drift
the moment one is widened and the other is not, which is the class of defect the gate exists to
catch. Each crate's gate binary goes from 2 tests to 3.

It walks separately from `ts_deriving_type_names_in_crate` rather than growing that function a second
responsibility. Reading each source file twice inside a test binary is not a cost worth conflating
two contracts to avoid.

### §4.1a CORRECTION (2026-09-03, third whole-branch review) — §4.2 and §4.4 describe a mechanism that no longer exists

**The rule parses Rust with `syn`. It does not scan text, and §4.2's anchor and §4.4's exclusions are
kept below as the record of a design that was defeated four times rather than as a description of the
code.** Everything they say about what the anchor matched, what the comment exclusion covered and how
a field was resolved forward is now historical.

**What defeated it, in order, each one a silent pass found by a review that ran code rather than read
it:** a qualified `std::option::Option<u64>` reading as not-an-`Option`; two `ts(...)` groups on one
line, of which only the first was parsed; an anchor sitting inside an attribute opened on an earlier
line, which split a `serde(... = "crate::de::opt")` continuation on its `::` into a fabricated field
name and type; and a comment lexer that took the `'"'` char literal — live in `redextape-core`'s
tests — for an open string, blanking or failing on lines around it.

**The decision this mirrors is already recorded in this module.**
`ts_deriving_type_names_in_crate`'s doc describes four widenings of a different text scan and the
decision not to attempt a fifth, inverting to a whitelist instead. The same judgement applies here and
reaches a different answer, because the questions differ: that scan asks whether a line **is one exact
string**, which has no grammar in it; this rule asks **what type a field has and which attributes sit
on it**, which only a parser can answer. Two mechanisms in one module, each matched to its question —
and `syn` is the crate `ts-rs` itself uses to read these same attributes.

**What the parser costs and what it does not — per crate, because the first version of this
paragraph said "every consumer" and was false.** `syn` joins `redextape-test-support`'s
`[dependencies]`. **`redextape-wasm`**, the crate that builds to wasm, declares that crate under
`[target.'cfg(not(target_arch = "wasm32"))'.dev-dependencies]`, so nothing reaches its wasm graph:
`cargo tree -i redextape-test-support --target wasm32-unknown-unknown -p redextape-wasm --edges normal,build,dev`
prints `nothing to print` and `cargo check --target wasm32-unknown-unknown -p redextape-wasm --all-targets`
exits 0. **`redextape-core`, `redextape-native` and `redextape-grammar-check` declare it under a plain
`[dev-dependencies]`**, so `syn` and `quote` ARE in their wasm32 dev graphs — graphs that were already
unbuildable for wasm32 before this slice, as `redextape-core`'s own manifest records above its
`proptest` entry, and `cargo check --target wasm32-unknown-unknown -p redextape-core --all-targets`
fails on `wait-timeout` at this head exactly as it did before. What ships is unaffected either way:
`wasm-pack build` compiles no dev-dependencies. Panic messages name the file, the owning type and the
field rather than a line number, which is what this repository's citation gate prefers anyway.

**Two boundaries were found while correcting a fixture and are named rather than closed.** An override
written on an enum VARIANT is a real ts-rs override — `VariantAttr` carries `type` and `as` — and this
rule reads field attributes only; what a variant-level override does to its payload's nullability has
not been measured here. And a `type` alias for an `Option` still reads as not-an-`Option`, because
`syn` parses one file and resolves no names. Both are pinned by tests that assert the hole exists.

### §4.2 What it anchors on

Every line in the crate's `.rs` files carrying the bytes `ts(` **with a word boundary before the
`t`** — no ASCII letter, digit or underscore immediately preceding it — that is not a comment line
and is not `CANONICAL_TS_DERIVE` itself (which carries `ts(export)`). §1's table measures each step
of that narrowing on the tree at this commit; it ends at exactly the four override sites.

**The anchor is the byte pattern, not the `#[` prefix, and that difference is a hole rather than a
preference.** A `#[`-prefix anchor is defeated by an attribute split across lines:

```rust
#[cfg_attr(feature = "ts",
    ts(type = "number"))]
```

That compiles, the first line carries no `ts(` at all, and the second line does not begin with `#[` —
so a prefix anchor skips the site silently, which is the one outcome this gate cannot afford. The
word-boundary anchor reads the continuation line like any other. `\b` is not available without a
regex dependency this crate does not have and does not want; it is a two-line check on the preceding
byte.

From each anchored line the
scan resolves **forward** — past further attribute lines and doc-comment lines, the walk
`resolve_item_name` already performs for items — to the field it decorates, and reads the declared
Rust type from `pub NAME: TYPE,`.

**Forward, and the tree has an adjacency that punishes getting that wrong.**
`crates/redextape-core/src/viewmodel.rs` reads `pub cut: Option<Cut>,` at line 67, the override at
line 68, and `pub step: u64,` at line 69. A scan that resolved backward, or that took the nearest
field line in either direction, would read `Option<Cut>` for an override belonging to a bare `u64`
and demand a `| null` that must not be there — so it would fail on the **unmodified** tree, before
any sabotage runs. That is a real arrangement at this commit, not a hypothetical, and it means the
clean-tree green run is itself the check that the direction is right; §6's sabotages are measured
only after it.

### §4.3 The rule, in both directions

| field is an `Option` | `ts(type = "X")` | `ts(as = "Y")` | `ts(optional)` |
|---|---|---|---|
| yes | X must have a top-level `null` union member | Y must itself be an `Option` | only the `= nullable` form |
| no | X must not | Y must not | must not appear |

"Is an `Option`" is one predicate applied to both the field's Rust type and to Y: the last segment of
the path, so `Option<T>`, `std::option::Option<T>` and `::core::option::Option<T>` all answer yes.
`ts(as = ...)` routes through another Rust type's own `TS` impl, so an `Option` there preserves
optionality by construction; both forms were measured producing `number | null` during PR #71, and
`ts(type = "number | null")` is what ships.

#### CORRECTION (2026-09-03, both whole-branch reviews) — this section shipped wrong three times, in three different ways

**This section originally said `ts(type = "X")` must end with the exact suffix ` | null`**, and argued
for it as a whitelist in the shape of `CANONICAL_TS_DERIVE`. That argument does not transfer. The
canonical derive line is a string *this repository writes*, so demanding one spelling of it costs
nothing; a TypeScript type is a string *TypeScript defines*, and `null | number` and `number|null`
are as correct as `number | null`. Both were measured being rejected on correct source, and unlike
the `ts(type="number")` whitespace case — which `cargo fmt` normalises, and which the rule therefore
judges rather than refuses — `rustfmt` never reaches inside a string literal, so neither spelling
would ever be normalised away. The check is a top-level union member: still not a search for the
bytes `null`, since a string-literal type spelled `'null'` is a member whose value is the string.

**It said `ts(as = "Y")` must start with `Option<`**, which is the same prefix-versus-spelling defect
the first review had already found on the field side — and it survived that round *because the fix
was applied to the field side alone*, one line above. `ts(as = "std::option::Option<u32>")` on a bare
`u64` passed the finished gate. One predicate now serves both.

**And it named two keys where ts-rs has three.** `#[ts(optional)]` turns `t: Option<T>` into `t?: T`,
dropping the null exactly as `ts(type = "number")` does — only `#[ts(optional = nullable)]` keeps it
— and this section neither checked it nor listed it as uncovered. It was found by reading
`ts-rs-macros` 10.1.0's own `FieldAttr`, not by reasoning about the attribute surface. `skip` and
`flatten` are now named too, as a *different* defect rather than as safe: `skip` removes a field the
wire still sends.

### §4.4 Panics, and the one exclusion

**Every `#[`-line containing `ts(` that the scan cannot parse into a key and a quoted value is a
panic naming the file and the line.** Never a skip. Same for a forward scan that reaches a shape it
does not recognize, or runs off the end of the file. `ts(type="number")` without spaces is not a pass
and is not silently handled — it is an unrecognized spelling, and the scan says so. This is
`resolve_item_name`'s existing discipline applied one layer over, and it is the property that makes a
whitelist honest rather than merely strict.

**Comment lines are not anchors** — a line whose trimmed form starts with `///`, `//!`, `//` or `*`.
§1's table measures why: fourteen of the 41 word-boundary matches are comments, four of them in the
doc comment sitting directly above the one `Option` field that carries an override, quoting the wrong
form in order to explain why it is wrong. Without this exclusion the gate fails on the prose written
to prevent this bug. A comment line cannot carry an attribute, so the exclusion hides no derive site;
it is a different kind of rule from the `#[`-prefix anchor it replaces, which excluded comments only
as a side effect of a test that also excluded continuation lines.

**`scanner_path` still excludes each caller's gate file**, exactly as the existing walk does — those
files quote both override forms inside assertion message strings. Note that neither
`redextape-test-support`'s own source nor this new function's assertion messages are ever scanned:
the walk starts at the crate root it is passed, and `redextape-test-support` is not one of them.

**Write `ts-rs` hyphenated in any prose this slice adds to a scanned crate.** The existing whitelist
refuses any line in `redextape-core` or `redextape-wasm` mentioning the bytes `ts_rs` other than the
canonical derive line, doc comments included. PR #71 had a plan-dictated doc comment refused by that
gate on landing.

### §4.5 What this gate does not cover, named rather than denied

- **An `Option` field with no override at all.** `ts-rs` generates `| null` for those on its own and
  this gate never looks at them; ten of the eleven sites in §1 are in that class. Nothing here would
  notice a `ts-rs` upgrade that changed how `Option` maps. §5 is what covers that link, for the
  fields it names.
- **Nullability inside a generic.** `RuleView.read` is `Vec<Option<Symbol>>` → `Array<string | null>`.
  An override rewriting the element type would drop that inner `| null`, and a rule that reads only
  the outermost `Option<` cannot see it. Closing it means parsing the Rust type rather than matching
  its prefix, which is a different mechanism, not a wider prefix.
- **Everything the existing scan already names as outside itself**: a `Cargo.toml` rename of the
  `ts-rs` dependency, a macro expanding to the marker only at its call site, and a `#[path]`
  resolving outside the crate root. This gate walks the same files by the same rule and inherits the
  same three, neither closing nor re-denying them.

---

## §5 Piece 2 — the shipped-output pin

`web/tests/node/bindings-contract.test.ts`: one test, eleven typed constants, one per site in §1's
table.

```ts
const _node: LambdaStatus['node'] = null
const _read: RuleView['read'][number] = null
const _totalSteps: TmStatus['total_steps'] = null
// … eight more
```

**The type annotation is the check.** `tsc` reads `tests/` already, and `pnpm run typecheck` runs
`build:bindings` before `tsc --noEmit`, so this checks the generated file as shipped rather than the
Rust source — the link §4 cannot see. An `expect(...).toBeNull()` per constant keeps it a real vitest
test rather than a file of unused bindings that reads as deletable. `web/` has no eslint and
`tsconfig.json` does not set `noUnusedLocals`, so the constants need no suppression.

Imports come from `web/src/types.ts`, the barrel, not from `../../bindings/` directly — the barrel is
the import the §3 condition is about, and a test that bypassed it would be checking a different
statement than the one that matters.

**The file's header states its own boundary:** a nullable field added to a generated type later is
not in this list and nothing will say so. That is a real limit of a hand-enumerated pin and it gets
written down rather than left for a later reader to discover.

---

## §6 Sabotages this slice must run

Each is applied, measured, and reverted. A gate is not accepted on the strength of its diff.

1. `ts(type = "number")` on `TmStatus::total_steps` — the defect PR #71 measured. §4 panics, naming
   the file, the line, the field, and both accepted forms.
2. `ts(type = "number | null")` on `TmState::step`, a bare `u64`. §4 panics — the reverse direction.
3. `ts(as = "u32")` on `TmStatus::total_steps`. §4 panics — the `as` arm of the `Option` row.
4. `ts(type="number")`, no spaces, on `TmStatus::total_steps`. §4 panics as a **rule violation**: the
   parse tolerates whitespace around `=`, because `cargo fmt` normalises it and a gate that treated
   formatting as an unrecognized spelling would be noise. Not a pass is the property being tested.
5. **The same wrong override, split across two lines**, which compiles:
   `#[cfg_attr(feature = "ts",` / `    ts(type = "number"))]`. §4 panics. This is the case a
   `#[`-prefix anchor passes silently, and it is why §4.2 anchors on the byte pattern instead.
6. `ts(type = r#"number"#)` on `TmStatus::total_steps`. Either the crate fails to compile — in which
   case the gate never runs and that is the recorded outcome — or §4 panics naming the line as
   unparseable. **A silent pass is the only result that fails this sabotage**, and which of the two
   occurs gets written down rather than predicted here.
7. `#[cfg_attr(feature = "ts", ts(rename = "Renamed"))]` added on a bare field. Both gates stay
   green: a recognized key that is not `type` or `as` carries no nullability claim, and treating it
   as one would be a false positive rather than a caught defect.
8. Sabotage 1 again, followed by `pnpm run build:bindings`: `web/tests/node/bindings-contract.test.ts`
   reddens, and `tsc`'s output names that file. This is also where §1's three-versus-four question is
   settled — whatever `tsc` reports here is recorded as the count, with the command beside it.
9. Delete one constant from `bindings-contract.test.ts` and re-run sabotage 8: `tsc` still reddens on
   the remaining ten, confirming the pin is not load-bearing on any single line.

Both Rust gates' existing two tests must still report passing under sabotages 1–6 — the point of this
slice is that they cannot see any of it, and a run that showed one of them reddening would mean the
sabotage was not the one described.

**The clean tree is itself a sabotage result here, per §4.2**: a scan resolving in the wrong direction
fails before any of the above is applied, so the green run on the unmodified tree is recorded first
and the rest are measured after it.

---

## §7 What stays open after this

- **An `Option` field with no override is watched only by §5's eleven named constants**, not by a
  rule. A twelfth nullable field enters the boundary unwatched.
- **Nullability inside a generic** (§4.5) — `RuleView.read`/`write` are the live instance.
- **Nothing compares the generated types against the measured wire.** Unchanged from the wire-type
  slice: `crates/redextape-wasm/tests/browser.rs` measures shapes out of a real browser and the
  generator asserts them, and no test compares the two. §5 pins one property of the generated output
  by hand; it is not that comparison.
- **`LinkIndexWire`, `TermTree`/`TermNode`, the coverage scan's three named routes, and a stale
  `web/bindings/` that still typechecks** — all unchanged by this slice, all still on the wire-type
  slice's list.

---

## §8 Alternatives considered and rejected

**Check the generated output against source `Option`-ness instead** — for every `Option<...>` field,
overridden or not, assert the generated TypeScript for that field admits `| null`. Strictly more
coverage: it reaches all eleven sites automatically and would catch a `ts-rs` behaviour change.
Rejected because it needs depth-aware parsing of generated text — commas live inside
`Array<[Span, TokenClass]>`, so a field's rendered type cannot be split off at the next comma — and a
new text heuristic over generated output is the kind of thing this module's own history says gets
defeated within minutes. §5 covers the same link for named fields at a fraction of the risk. If the
eleven-constant list becomes a maintenance problem, this is the mechanism to reach for, and closing
it properly means parsing rather than matching.

**Forbid `ts(type = ...)` on `Option` fields entirely, requiring `ts(as = "Option<...>")`** — the
`as` form cannot lie about optionality by construction. Rejected because PR #71 chose the literal
form deliberately and recorded why: `ts(type = "number | null")` states what the wire carries without
asserting a Rust type the field does not have. A gate that forces a rewrite of the one correct
override in the tree is arguing with a decision already made and documented.

**Do nothing.** It is a named, dated gap with a correct override in place. Rejected because the
condition holding it up is that some tests happen to build fixtures a particular way, which is not a
property anything enforces.
