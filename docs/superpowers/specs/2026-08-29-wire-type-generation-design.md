# Wire-type generation — design

**Slice:** `wire-type-generation`. An extension-track item, not on the critical path to v1; the
remaining v1 work is Plan 5's accessibility pass, which this does not touch.

**One-line statement of what this is:** `web/src/types.ts` is a hand-written copy of seventeen Rust
types, kept in agreement with them by nobody; this makes Rust the single source and generates the
TypeScript from it with `ts-rs`, so the copy stops existing rather than starting to be watched.

**Why now.** Filed as open at the close of the sharing-aware-decode slice (2026-08-28), under "WHAT
STAYS OPEN" — *"`web/src/types.ts` learned the new variant; nothing gates that it will learn the next
one. The Rust `Decoded` enum and the TypeScript union are kept in agreement by hand."* That filing
understates the hazard in the way its own branch had just demonstrated: `Decoded::TooLargeToPrint` was
added on the Rust side first, and until the union learned about it, `decodedText` would have thrown a
`TypeError` rather than degraded — because `'Value' in d` raises on a string primitive. The playground
would have crashed on exactly the state the branch introduced.

**Scope boundary, decided before anything else:** no change to any wire shape, no change to any Rust
type's fields or variants, and no change to what any `#[wasm_bindgen]` export answers. The generated
TypeScript must be byte-equivalent in meaning to what `types.ts` says today, and where it is not, the
generator is wrong and gets an override — §6 lists all four.

---

## §1 The tree as it stands — verified 2026-08-29 at `b77fd04`

`web/src/types.ts` is 243 lines with 22 exports: 18 `export type`, one `export const`, three
`export function`. 133 of the 243 lines are comments.

All eighteen exported types have a named Rust counterpart. Seventeen of them can carry a derive —
twelve in `redextape-core`, five in `redextape-wasm` — and the eighteenth, `Classified`, cannot:

| crate | file | types |
|---|---|---|
| core | `span.rs` | `Span` |
| core | `analysis.rs` | `TokenClass`, `Classified` |
| core | `diagnostic.rs` | `Severity`, `Diagnostic` |
| core | `lambda/syntax.rs` | `Cut` |
| core | `lambda/reduce.rs` | `Owner` |
| core | `tm/machine.rs` | `Move` |
| core | `viewmodel.rs` | `LambdaState`, `RuleView`, `StateView`, `TmProgram`, `TmState` |
| wasm | `session.rs` | `RunStatus`, `Decoded`, `LambdaStatus`, `TmStatus`, `TmScratchStatus` |

`Classified` is `pub type Classified = Vec<(Span, TokenClass)>` (`crates/redextape-core/src/analysis.rs:88`)
— a type alias, so it has no derive site. It stays a one-line hand-written alias in the barrel, over
two generated types. Every count below that says "seventeen" excludes it.

### §1.1 CORRECTION (2026-08-29, found by Task 1's review) — the boundary has two classes and this section inventoried one

The table above is accurate about the types it lists and **wrong to imply it is the whole boundary.**
Task 1's review counted the `serde` derives in `redextape-core` and found fifteen, not the twelve
this section's first draft implied. Chasing the difference produced a distinction the design had not
drawn:

**Class A — mirrored by hand in `types.ts`.** The seventeen types above: eleven core types carrying a
serde derive, `Move`, and the five wasm types. These are what this slice generates, and everything
else in this document is about them.

**`Move` is in Class A and has no serde derive**, which is why this paragraph does not say "serialized
by serde" — an earlier draft did, and it was false for exactly one member. `Move` never crosses the
wire at all; `RuleView.moves` is `Vec<String>`, stringified by `viewmodel::move_text`. It gains a `TS`
derive solely as the override target for that field (§6).

**Class B — hand-assembled at the boundary.** `Session::link_index` builds its JS value directly with
`js_sys::Uint32Array` and `Reflect::set` — a columnar form whose TypeScript mirror is `LinkIndexWire`
in `web/src/link.ts`, with camelCase names and typed-array columns. **Serde never runs on it.**
`LinkIndex` carries a `Serialize` derive that the wire does not use. `compile`'s return value is
assembled the same way. **`ts-rs` cannot generate Class B**, because the shape is produced by
marshalling code rather than by a type — and generating from the Rust declaration would emit a
confidently wrong file describing snake_case fields and `Array<[Span, TokenClass]>` where the wire
carries `lambdaSpanStart: Uint32Array`.

**Class C — serialized, with no TypeScript consumer yet.** `TermTree` and `TermNode`, returned by
`lambda_ast` for the planned term-tree view. Generation will emit files nothing imports. That is
harmless and mildly useful; it is named here so their appearance in `bindings/` is not read as a bug.

**Class D — a derive that never crosses.** `Dir` carries a serde derive and reaches no wire: its only
use site, `LambdaState::redex`, is `serde(skip)`ped. It is named here because it is one of core's
fifteen derives and would otherwise be the unexplained difference in any later recount.

**The fifteen core serde derives, in full**, so the next reader recounts nothing:

| class | types | n |
|---|---|---|
| A — generated | `Cut`, `Diagnostic`, `LambdaState`, `Owner`, `RuleView`, `Severity`, `Span`, `StateView`, `TmProgram`, `TmState`, `TokenClass` | 11 |
| B — hand-assembled | `LinkIndex` | 1 |
| C — no TS consumer | `TermTree`, `TermNode` | 2 |
| D — skipped | `Dir` | 1 |

Class A's eleven plus `Move` are the twelve core types §1's table lists; with the five wasm types that
is the seventeen §4 gives a derive.

**What this changes:** nothing in §2 through §11, and nothing about PR 1. What it changes is the
claim this slice can make when it closes. Generation makes Class A undriftable. Class B stays
hand-written and unwatched, and §13 now says so rather than leaving a reader to infer that
`web/src/types.ts` was the whole surface.

**Two agreement mechanisms already exist, and both are narrower than they look.**
`TOKEN_CLASSES` (`types.ts:35`) is a const array with `TokenClass` derived from it, asserted at
startup against the `tokenClasses()` wasm export by `assertTokenClasses` (`types.ts:247`).

> **Both numbers were `25` and `237` until 2026-08-29, and this branch is what invalidated them.**
> Task 3 added a ten-line header to `web/src/types.ts`, so every line below it moved down ten; `237`
> now lands on a bare `*/`. `docs/` is exempt from `scripts/check-citations.sh`, deliberately — these
> citations are the reason the exemption exists — so nothing fired. **A citation a gate does not cover
> is one a human has to re-derive, and the commit that moves the lines is the one that has to do it.**
`encodings()` does the same for `EncodingKind`. Every other type on the list is unwatched.

~~**`assertTokenClasses` runs in nothing.** It is called from exactly one place, `web/src/main.ts`,
immediately after `init()`. The browser tests under `web/tests/browser/` build their own DOM shell and
import modules directly; none imports `main.ts`. So the one runtime agreement check in the tree fires
only when a human opens the app, and a drifted build passes `rust`, `web` and `rust-browser` green.~~
**FALSE, AND RETRACTED 2026-08-29 — it runs in 26 of 44 browser test files.** `web/src/main.ts` ends
in `export const ready = main()`, a module-scope call, and the browser tests await it through a
**dynamic** import: `await (await import('../../src/main')).ready`. The grep that produced the
retracted claim searched for `from '.*main'`, which **by construction cannot match a dynamic import** —
there is no `from` keyword in one. Absence of evidence recorded as evidence of absence, in the same
shape this project's citation gate already has on record for a `grep '^//!'` that could not match a
`///`.

**What settled it was a sabotage, not a better grep.** Setting a `TOKEN_CLASSES` entry to `'Drifted'`
reddens 26 of 44 browser test files. A claim about whether a guard fires is answerable by making it
fire, and this one was asserted from a search pattern instead for long enough to reach two documents
and a design decision.

**The compiler already covers the step after the one that is missing.** Measured directly, adding an
`'Aborted'` variant to the hand-written `Decoded` union without touching `decodedText`:

```
$ pnpm exec tsc --noEmit --strict --ignoreConfig drift.ts
error TS2322: Type '"Aborted" | { Value: ... } | { Fault: ... }' is not assignable to type 'object'.
error TS2339: Property 'Fault' does not exist on type '"Aborted" | { Fault: ... }'.
```

So once the union knows a variant, `tsc --strict` forces every consumer to handle it, and
`web typecheck` is already both a pre-commit hook and a CI job. **The gap is exactly one step wide:
the union learning the name.** That is what makes generation sufficient rather than merely helpful —
it closes the only step the compiler cannot take itself.

---

## §2 What ships

1. A `ts` feature on `redextape-core` and `redextape-wasm`, default off, gating `ts-rs` derives on
   seventeen types (§4).
2. `web/bindings/`, generated and **gitignored**, standing to `web/src` exactly as `pkg/` does today
   (§4, §9).
3. `web/src/types.ts` reduced to a hand-written barrel: re-exports of the generated types, the
   `Classified` alias, and the four things that cannot be generated (§5).
4. Four fidelity overrides, and a test that fails when a fifth field of the same class appears (§6).
5. `TOKEN_CLASSES` pinned to the generated `TokenClass` union at compile time, in both directions
   (§5).
6. The wasm32 leg shown capable of failing with `ts` forced on, before it is relied on (§7).
7. Roughly 87 lines of prose relocated from `types.ts` into Rust doc comments across seven files
   (§8).

---

## §3 The probe — what was measured rather than assumed

A scratch crate with these exact shapes, `ts-rs` 10.1.0, generated and inspected. Five mechanics were
verified before this design was written, because each one would have changed it.

**1. Doc comments survive, including field-level ones.** Type-level Rust docs become JSDoc above the
type; field-level Rust docs become JSDoc inline before the field. Markdown, backticks, bold and
non-ASCII all pass through verbatim. The generated `Decoded.ts` carried its whole five-state argument.
This is the fact the design turns on: **the prose does not die, it relocates to Rust.**

**2. Externally tagged shapes match serde's, with no `serde-compat` feature enabled.** Generated
`Owner` came out `"None" | { "Exact": number } | { "Within": number }`, which is what the
hand-written line says today. Generated `Decoded` came out as two objects and three bare strings, in
declaration order — union member order differs from today's file and is semantically irrelevant in
TypeScript.

**3. Cross-crate references resolve.** A wasm-crate type holding a core-crate type generated
`import type { Diagnostic } from "./Diagnostic";`. Both crates' invocations emit **byte-identical**
files for shared types, verified by `diff`, so two invocations writing into one directory is safe
rather than a race.

**4. `TS_RS_EXPORT_DIR` is resolved per crate manifest, not per workspace.** A relative value scatters
output into `core/out/` and `wasm/out/` instead of one directory. **The build script must pass an
absolute path.** This is recorded because it fails silently — the tests pass, and the files are simply
somewhere else.

**5. No `index.ts` is generated.** The barrel is ours to write, which suits §5, where it also has to
carry the file header prose and the four hand-written exports.

**And a sixth, on the TypeScript side.** The compile-time pin proposed in §5 works and names the
missing member:

```
error TS2344: Type '"Binder"' does not satisfy the constraint 'never'
```

---

## §4 The generated surface

Seventeen types gain, under `#[cfg_attr(feature = "ts", ...)]`, a `TS` derive and `#[ts(export)]`.
`Move` is among them although it does not itself cross the wire; it exists as the override target for
`RuleView.moves` (§6).

Generation is two invocations, both with an **absolute** export directory:

```
TS_RS_EXPORT_DIR=<abs>/web/bindings cargo test -p redextape-core --features ts
TS_RS_EXPORT_DIR=<abs>/web/bindings cargo test -p redextape-wasm --features ts
```

Both are required rather than one. The downstream crate exports its dependency's types transitively,
but only those **reachable from a type it exports itself** — and several core types (`Cut`, `Owner`,
`TokenClass`, the viewmodel types) are reached from `#[wasm_bindgen]` method return positions rather
than from any wasm struct field, so transitive reachability cannot be relied on to cover them. Running
both is cheaper than proving which are covered, and §3's byte-identity result is what makes it safe.

---

## §5 What stays hand-written

Four things, in `web/src/types.ts`, which becomes a barrel.

**`TOKEN_CLASSES`.** It is a runtime array, read at `web/src/link.ts:116` to turn a `Uint8Array`
discriminant into a class name. A generated *type* cannot supply an array, so the array stays. It gets
pinned to the generated union at compile time, in both directions:

```ts
type Missing = Exclude<TokenClass, (typeof TOKEN_CLASSES)[number]>
type Extra   = Exclude<(typeof TOKEN_CLASSES)[number], TokenClass>
type Assert<T extends never> = T
type _NoneMissing = Assert<Missing>
type _NoneExtra   = Assert<Extra>
```

It fires at `pnpm typecheck`, which is a pre-commit hook and a CI job. **It is EARLIER than
`assertTokenClasses`, not stronger** — an earlier draft called it "strictly stronger" on the strength
of the retracted §1 claim that the runtime assert ran in nothing. It does run: 26 of 44 browser test
files redden when the array is sabotaged. The two catch different things, which is §5's whole reason
for keeping both, and neither dominates the other.

**`assertTokenClasses` is kept anyway, and the reason is not redundancy.** The compile-time pin
compares the array against the *generated file*. A generated file that is stale — a tree where
`build:bindings` has not run since a Rust edit — satisfies the pin and is still wrong. The runtime
assert compares the array against the *loaded wasm module*, which is the only check that can see that
class of staleness. The two answer different questions and the file will say so.

**`decodedText` and `ownerNode`.** Consumers, not shapes.

**The file header.** Seven lines describing how the boundary encodes things — *"a fieldless enum
variant crosses as the bare variant NAME, and a struct variant as a one-key object"*. It is about the
TypeScript file rather than about any one type, so it has no Rust home and belongs on the barrel.

**`Classified`** stays as the one-line structural alias §1 describes.

**The 44 import sites do not move.** Every file that imports `./types` today keeps doing so; the
barrel re-exports. This is what keeps the slice from touching 44 files for no behavioural reason.

---

## §6 Fidelity overrides — the generator's defaults are wrong in four places

| field | ts-rs default | what the wire carries | evidence |
|---|---|---|---|
| `TmStatus.total_steps` | `bigint \| null` | `number \| null` | `crates/redextape-wasm/tests/browser.rs:884` asserts `2870.0`, read out of a real browser |
| `LambdaState.step` | `bigint` | `number` | same class — `crates/redextape-core/src/viewmodel.rs:69` |
| `TmState.step` | `bigint` | `number` | same class — `crates/redextape-core/src/viewmodel.rs:178` |
| `RuleView.moves` | `Array<string>` | `Array<Move>` | today's hand-written file is more precise than the generator |

The three `u64` fields get `#[ts(type = "number")]`. `serde_wasm_bindgen` serializes `u64` as a JS
number by default, which `browser.rs`'s assertion measures directly; `ts-rs` maps `u64` to `bigint`
unconditionally. Nothing reconciles the two but this override.

**This is the design's main hazard and it gets a gate rather than a note.** The default is wrong,
silently, in a file nobody reads, and only the browser tier can catch it. So a Rust-side test asserts
that no generated file contains the token `bigint`. A fifth field of this class then fails at the
commit that adds it, rather than in Chrome. The test is written to be non-vacuous the way this
repository requires: it must be shown to fail with an override removed, not merely observed passing.

**`RuleView.moves` takes the override rather than a Rust change.** `moves` is `Vec<String>`, stringified
by `viewmodel::move_text`, whose own comment (`crates/redextape-core/src/viewmodel.rs:409`) records the
decoupling deliberately: *"kept as an explicit match rather than `Move`'s `Debug` output so the two
cannot drift independently even though today they happen to agree."* Changing the field to `Vec<Move>`
would be wire-identical — `Move`'s variants are literally `L`, `R`, `S` — and would collapse exactly
that decoupling. So the Rust is left alone, `Move` gains a `TS` derive, and the field gets
`#[ts(type = "Array<Move>")]`. The claim that override makes is already pinned by
`move_text_matches_the_text_forms_own_vocabulary` (`crates/redextape-core/src/viewmodel.rs:683`), which
asserts the three strings by name.

---

## §7 Feature gating and the wasm32 gate

`ts = ["dep:ts-rs", "serde"]` on both crates, default off, mirroring the existing optional `serde`
arrangement. Verified in the probe: under default features `cargo tree --edges normal` still lists
only the crate itself, so the one-line proof the core manifest keeps as a bonus stays true.

The browser build never enables `ts`, so `ts-rs` never enters the wasm32 dependency graph. **That is
gated, not asserted.** `crates/redextape-core/Cargo.toml`'s own comment records why: the previous
invariant survived only because nothing checked it, and `scripts/check-all.sh`'s wasm leg exists
because "dependencies are admissible; the gate decides". The mimalloc precedent from that same entry
sets the bar — a gate that would pass anything is worse than no gate — so this slice must demonstrate
the wasm leg failing with `ts` forced on before relying on it passing with `ts` off. If `ts-rs`'s
runtime turns out to be wasm32-clean, the demonstration still stands as the record that the leg was
exercised.

---

## §8 Where the prose goes

The 133 comment lines split four ways:

| | lines | fate |
|---|---|---|
| File header | 7 | To the barrel |
| Immediately preceding an `export type` | 55 | Relocate into Rust type docs |
| Inside type bodies, documenting fields | 32 | Relocate into Rust field docs — §3 verified these survive |
| On `TOKEN_CLASSES`, `assertTokenClasses`, `decodedText`, `ownerNode` | 39 | Stay in TypeScript |

So about 87 lines move into Rust, across seven files, twelve of the seventeen types being in
`redextape-core`.

**It is a merge, not a copy.** Several of these types already document the same facts in Rust terms,
and at least one already defers: `TmScratchStatus`'s TypeScript doc ends *"See that Rust struct for the
argument in full."* Relocating means reconciling two accounts of the same decision into one, not
pasting the TypeScript one above the Rust one.

**The consequence, accepted knowingly:** `redextape-core`'s Rust documentation will carry
TypeScript-audience prose — *"convert through `spans.ts`'s `byteToIndex`"*, *"`lambda-pane.ts`'s frame
view is the one place this crosses into a DOM range"*. That is the cost of one source of truth, and it
is smaller than two accounts that can disagree. The repository already points across languages in both
directions.

---

## §9 Build wiring and CI

`web/bindings/` is gitignored and generated, standing to `web/src` exactly as `pkg/` does. The
precedent is not analogous, it is the same relationship: the `web` job already carries the step
*"Build the WASM package (its `.d.ts` is what typecheck resolves `../pkg` against)"*, and already
installs Rust, the wasm32 target and wasm-pack.

- `package.json` gains `build:bindings`. `typecheck` and `test` depend on it, and so does `build`,
  beside the `build:wasm` it already chains. **`build:app` does NOT, and must not.**

  **THIS BULLET USED TO READ *"`typecheck`, `test` and `build:app` depend on it as they already depend
  on `build:wasm`"*, AND BOTH HALVES WERE FALSE.** Nothing depended on `build:wasm` except `build`;
  `build:app` deliberately did not, and that split is load-bearing rather than incidental. The
  `Dockerfile`'s stage 2 is `FROM node:26-slim`, copies only `web/` and the `/app/pkg` stage 1
  produced, and runs exactly `pnpm run build:app` under a comment stating the invariant: *"`build:app`,
  not `build`: this stage has no Rust toolchain — stage 1 already produced /app/pkg."* Chaining
  generation into `build:app` broke the image build outright — `sh: 1: cargo: not found`, exit 1 — and
  installing Rust would not have fixed it, because that stage has no `Cargo.toml`, no `Cargo.lock` and
  no `crates/` either.

  **THE FALSE PREMISE IS WHAT HID IT, AND THAT IS THE TRANSFERABLE PART.** This section enumerated the
  consumers of the changed scripts — the CI `web` job, the pre-commit hook, `setup-dev.sh` — and
  omitted the `Dockerfile`. Not by oversight in the list: **a consumer is only worth enumerating if
  something changed for it, and the sentence had already argued nothing had.** "As they already depend
  on `build:wasm`" made the edit a no-op by construction, so the search for who else calls `build:app`
  never happened. A premise that says a change is not a change deletes the audit that would have found
  the change.

  **AND NO CI JOB WOULD HAVE SAID SO.** The `docker` job is `if: github.event_name != 'pull_request'`
  and is not in `gate`'s `needs`, so the pull request goes green, the post-merge push to `main` fails,
  and the image tag `docker-compose.yml` deploys from stops being published. `docker build .` run to
  completion by hand is the only check that covers this, which is the same standing conclusion the
  `HEALTHCHECK` comment in that file already reached by a different route.
- The `web` CI job gains one step beside the existing wasm build. No new toolchain, no new job, no
  `gate` edit — `gate` already requires `web`.
- `scripts/setup-dev.sh` gains the generation step, so a fresh clone typechecks.
- The `web typecheck` pre-commit hook already runs `pnpm run typecheck`, so it picks up generation
  through that script rather than needing its own entry. `cargo` is already required by that very hook,
  so this adds a build, not a new class of cost.

  **THE REASON GIVEN HERE USED TO BE THE CLIPPY HOOK, AND THAT MECHANISM IS FALSE.**
  `.pre-commit-config.yaml` scopes `cargo-clippy` and `cargo-fmt` with `files: \.rs$`, so on a
  `web/`-only commit — which is precisely the commit class this change affects — neither hook fires.
  The conclusion survives by a different route: `web typecheck` runs `tsc --noEmit`, which resolves
  `../pkg/redextape_wasm.js` against the `.d.ts` only `pnpm run build:wasm` produces, and that needs
  `wasm-pack` and therefore `cargo`. **Anyone whose `web typecheck` hook can pass at all already has a
  Rust toolchain**, so the added cost is one more feature configuration in an incremental build. The
  original wording was checkable in one line and was not checked.

**No `check-wire-*.sh` script is added, and that is the point of choosing generation.** There is no
committed copy whose freshness needs proving, so there is nothing for a gate of that shape to check.

---

## §10 Testing

1. **The no-`bigint` test** (§6), shown failing with an override removed.
2. **The compile-time `TOKEN_CLASSES` pin** (§5), shown failing with a name removed from the array —
   §3 records the exact error it produces.
3. **The wasm32 leg with `ts` forced on** (§7), shown failing or shown clean, either way recorded.
4. **`browser.rs` is unchanged and stays.** It pins runtime shapes measured out of a real browser;
   the generator asserts static types. They are complementary, and §6's first row is the case where
   the browser test is the only thing that could have caught the generator being wrong.
5. **`web/tests/browser/` is unchanged.** The barrel keeps every import path, so no test moves.

---

## §11 The three PRs

**PR 1 — plumbing, proved on one type.** The `ts` feature on both crates, `build:bindings`, the
gitignore entry, the barrel, the CI step, `setup-dev.sh`, and the wasm32 gate shown failing. `Span`
alone is generated. Lands green, reversible, and proves the pipeline end to end before any prose moves.

**WHAT REMAINS IS STATED AS A PROPERTY, NOT A COUNT, BECAUSE THE TWO COUNTS THIS SECTION AND THE
ROADMAP CARRIED DESCRIBED OVERLAPPING SETS AND NEITHER DEFINED ITS SET AT THE POINT OF USE.** After PR
1, `grep -c '^export type [A-Za-z]' web/src/types.ts` reads 17. **All but one of those are derivable:**
sixteen name a Rust `struct` or `enum` that can carry a `TS` derive — eleven in `redextape-core`, five
in `redextape-wasm`. The exception is `Classified`, which is `pub type Classified = Vec<(Span,
TokenClass)>`, **a type alias with no derive site**; it stays hand-written over two generated types
permanently, and it is why "PR 2 — the twelve core types" below moves eleven declarations out of
twelve. This section previously said "the other sixteen types stay hand-written", counting `Span` into
a total of seventeen; the roadmap said seventeen remain, counting `Span` out. Both were arithmetic
about different sets, and the sentence that reconciles them is the one above.

**PR 2 — the twelve core types.** Derives, their prose relocated, the four fidelity overrides and the
no-`bigint` test.

**PR 3 — the five wasm types.** Derives, prose relocated, the `TOKEN_CLASSES` compile-time pin, the
`assertTokenClasses` retention note, the header prose to the barrel, and `types.ts` reduced to the
barrel it becomes.

Each PR needs a roadmap entry before it opens.

---

## §12 Risks

1. **The generator is confidently wrong.** §6 is four instances found by inspecting one probe's output
   against one browser test. There may be a fifth class this design has not looked for — `usize`
   mapping, `Option` versus `undefined`, tuple representation. **PR 1's job is partly to look**: the
   generated `Span` is compared against the hand-written one before anything else lands.
2. **The prose relocation is where a slice like this stops landing.** 87 lines across seven files,
   merged rather than pasted, is the largest single piece of work here and none of it is mechanical.
   It is confined to PRs 2 and 3 so PR 1 cannot be blocked by it.
3. **`ts-rs` is a new dependency on `redextape-core`.** Admissible under the rule the wasm gate
   replaced the old one with, but it is the crate's second dependency ever and the first that is not
   `serde`. §7 is the whole mitigation.
4. **A stale `bindings/` typechecks.** The compile-time pin and the generated types are both derived
   from files on disk, so a tree where generation has not run since a Rust edit is internally
   consistent and wrong. `assertTokenClasses` is retained precisely because it is the only check that
   compares against the loaded module (§5), and the build wiring makes staleness hard rather than
   impossible.

---

## §13 What this does not close

- **The λ decoder is still unmeasured.** Named in the same "WHAT STAYS OPEN" list as the item this
  slice closes; unrelated to it, and not touched here.
- **`Value`'s `PartialEq` and `Debug` still walk the logical size.** Same list, same non-relationship.
- **Plan 5's accessibility pass.** Fourteen standing items, trigger checkable since 2026-08-18. This
  slice touches `web/src` and adds no control, so it does not add to that list.
- **`LinkIndexWire` stays hand-written and unwatched, and it is the largest single wire type there
  is.** Twelve fields in `web/src/link.ts`, mirroring nothing that serde produces — `Session::link_index`
  assembles the columnar form by hand (§1.1, Class B). Generation cannot reach it, so the drift this
  slice closes for seventeen types stays open for this one. Closing it needs a different mechanism
  than a derive: either the marshalling moves behind a serde-serializable type, or the columnar shape
  gets a gate of its own. **Neither is attempted here**, and naming it is the point — this design's
  first draft implied `web/src/types.ts` was the whole boundary, and it is not.
- **Struct field *types* are now generated, but nothing checks the generated types against the
  measured wire.** `browser.rs` measures shapes and the generator asserts them, and no test compares
  the two. That is the same division of labour the current tree has, made no worse; a future slice
  could close it by generating fixtures from the measured shapes.

---

## §14 Open questions

1. **Does `ts-rs` 10.1.0's runtime build for wasm32?** **ANSWERED 2026-08-29 (PR 1): yes.**
   `cargo check --target wasm32-unknown-unknown -p redextape-core --lib --features ts` is clean, and
   `scripts/check-all.sh` now carries that row permanently, together with the matching row for
   `redextape-wasm`. **The row was shown able to fail before it was relied on**, which is this
   repository's standing bar: `mimalloc` was forced into the `ts` feature and the leg failed on
   `libmimalloc-sys v0.1.49` — C compiled under `--target=wasm32-unknown-unknown` that cannot find
   `wchar.h`, exit 101 — and the edit was reverted. The demonstration is what makes the green row
   evidence, and it stands whichever way the answer had gone.
2. **Is there a fifth fidelity class?** §12 item 1. PR 1 answers it for `Span`; PR 2 answers it for
   the rest.
3. **Does the barrel need `export type` or `export`?** `isolatedModules` and `verbatimModuleSyntax`
   settings in `web/tsconfig.json` decide this, and it is a one-line answer found at implementation
   time rather than a design question.
