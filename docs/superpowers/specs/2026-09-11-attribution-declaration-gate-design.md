# The attributions gate tells a declaration from a call — design

> **Roadmap:** the follow-up recorded at the close of the `alphabet-reduction` entry
> (`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`), under *"A GATE WHOSE ENTIRE PURPOSE IS
> CATCHING A CITATION THAT NAMES THE WRONG FILE WENT GREEN ON ONE."* That entry filed one instance —
> a correction round citing `lower_tm.rs` for `Encoding::push_frame`, which `encoding.rs` declares —
> and recorded the mechanism as *"it matches on textual presence in the named file's stripped code"*.

## What this delivers

`scripts/check-attributions.sh` stops asking whether a symbol is *present* in the cited file's code
and asks whether it is **declared** there. The sweep behind that change fixes every site the new rule
flags, so the gate lands green.

## The finding that shaped the design, and it inverts the obvious fix

**The obvious fix is wrong.** A definition-demanding rule flags **38 of 499** sites on a tree the
current gate passes at **0 violations** — and **27 of those 38 are correct citations**. (**This
section read 28 until a later review read the sentences rather than the verdicts**; the correction is
recorded under the table below, because which number is right matters less than why the first one was
wrong.) The repo's possessive does not mean *declares*. It means *this is the file to open for this*,
and it is used for at least five distinct acts:

| act | sites | example |
| --- | --- | --- |
| the `match` **arm** for a variant | 10 | `desugar.rs`'s `Expr::List` arm — the variant is declared at `ast.rs:89`, the arm really is in `desugar.rs` |
| a **call** or an expression | 10 | `interp.rs`'s `saturating_sub`; `run.rs`'s `form.is_artifact()` guard |
| an **impl** of a foreign trait | 3 | `core.rs`'s `Drop` impl — `core.rs:130` is `impl Drop for Core`; `Drop` is std's |
| a **fixture** or test case | 2 | `results.test.ts`'s `TmLeg` fixture |
| a statement in a file's **header** | 1 | `types.ts`'s `Decoded` — the bare-variant encoding fact is in that file's own header prose |

Those five account for 26. The twenty-seventh is a sixth act with one instance, held back to the
sweep below because what to do about it is a different decision: a citation that **quotes** a wrong
attribution inside the prose recording its repair.

**THE CALL ROW READ 11 AND THE TOTAL READ 28, AND THE ELEVENTH CALL WAS NEVER A CORRECT CITATION.**
`config_cli.rs` cited *"`emit.rs`'s `opts.field_width.unwrap_or(opts.defaults.field_width)`"* as the
expression a sabotage replaced. That expression has never been in `emit.rs` or in any other source
file here: `git log --all -S'field_width.unwrap_or'` puts it in two commits and in both it is a **plan
document**, never the source, and the commit that shipped the key shipped `Width::resolve` instead. So
it was plan code quoted as shipped code — **the one class of error this taxonomy could not see, because
every one of the 38 was classified by what act its sentence NAMED and not by whether the named thing
exists.** Rewording it to *"the `…` in `emit.rs`"* deleted the attribution site and left the claim
false. It is now rewritten against the shipped shape and re-measured.

So **11** of the 38 are not correct — 10 drift, and this one. The rule change is still the small half
of this slice and the sweep still the large half, which is the reverse of how it was filed; the
proportions move by one and the conclusion does not.

**Two discriminators were measured and rejected, and recording that is the point of this section.**
Symbol *shape* cannot split the acts: `pane-host.ts`'s `paneEvents.rebind` is declared in the cited
file and `run.rs`'s `form.is_artifact()` is only called there, and the two are the same shape. A
following **role noun** ("arm", "call", "doc") gets roughly 70%: it misses `interp.rs`'s
`saturating_sub`, which carries no noun, and it *accepts* `types.ts`'s `Owner` doc, which is drift —
`types.ts` documents no `Owner` at all and says so in its own first line, *"a barrel now, not a file
of declarations"*.

**What remains is to make the prose say which act it performs.** The possessive claims the
declaration; every other act is named rather than possessed. That is the convention this gate then
enforces totally, and it is the repair the roadmap already endorsed once — rewriting `scratch.ts`'s
citation to *"nothing in `replies.ts` ever calls `setEditor`"*, which *"asserts what the sentence
needs and creates no attribution site at all"*.

## The rule

A possessive `` `file`'s `symbol` `` claims that **`file` declares `symbol`**. Nothing weaker
satisfies it.

## How the gate changes

Three edits to `scripts/check-attributions.sh`. **"NOTHING ELSE IN THE REPO'S TOOLING MOVES" STOOD
HERE AND WAS FALSE BEFORE THE FIRST TASK CLOSED — TWO MORE FILES MOVED AND ONE OF THEM PRINTS ON EVERY
COMMIT.** `.pre-commit-config.yaml` carries the hook's `name:` field, which read *"symbol citations
name the file the symbol is in"* — a one-line statement of the rule this slice replaces, displayed to
whoever commits — and is now *"symbol citations name the file that declares the symbol"*; its comment
block also carries the gate's cost figure and the comparison against its four siblings. And
`.forgejo/workflows/ci.yml` carries the enumeration of what the self-test covers, which this change
grows. **Neither is an incidental edit: each holds a SENTENCE about the rule, and a rule change that
leaves a sentence about itself standing is the exact defect this gate exists to catch.** The sentence
was written from a reading of the *script's* diff, which is the narrowest place to look for prose that
describes a script.

### 1. One awk program, two modes

`strip_code` gains `-v emit=decls`, under which it prints the names each line **declares** instead of
the blanked line. The stripping machinery is untouched and still reached through one entry point, so
the header's *"THE ONE STRIPPING IMPLEMENTATION — the scan and `--self-test` both reach it here"*
stays true of the new mode too.

**This is an architectural requirement, not a tidiness preference, and the figure is measured against
the real script rather than a harness.** The gate is **2,738-2,751 ms** — and that range carries two
qualifiers it must never be quoted without, because later rounds dropped both: it is **three runs** on
the **499-site branch-point tree** this spec was written against. A hook comment and a roadmap entry
each credited it to `e7da0a1` instead, a 471-site tree, and then built a *"the branch ends FASTER than
it started"* headline on the mismatch. The same gate with the extractor added as a *separate* awk pass
plus a `sort -u` per cited file is **4,887-4,916 ms** — **about 2,150 ms more, very nearly double** —
because the gate is fork-bound rather than compute-bound, the same finding its own header already
records about `grep` on the end of a pipe. Fused into the pass that already walks every character, the
extraction adds no fork at all.

**THAT LAST SENTENCE IS TRUE AND THE CONCLUSION DRAWN FROM IT WAS NOT, WHICH THE IMPLEMENTATION FOUND
AND THIS SECTION RECORDS RATHER THAN QUIETLY REPAIRS.** The fused design — no fork added, exactly as
designed — still came in at **3,867-3,968 ms**, about **1,230 ms** over its parent, because counting
FORKS cannot see per-line compute and the extractor runs about nine regex matches per line. What
closed the gap was a guard nothing in this section had costed: **31,318 of 63,800 lines** across the
**108** files the gate resolves, **49.1%**, strip to pure whitespace and can declare nothing, so the
battery never runs on them. Fusion was necessary and was not sufficient.

**WHAT SHIPPED, MEASURED INTERLEAVED AT THE FINAL CODE COMMIT** — 10 rounds, one sample of each tree
per round in rotating order, one untimed warm-up per tree, `bash scripts/check-attributions.sh` with
no `--self-test`, the two older trees in `git worktree` checkouts:

| tree | rule | sites | range | mean |
| --- | --- | ---: | --- | ---: |
| `55750f8` (branch point) | presence | 499 | 2,679-2,830 ms | 2,778 ms |
| `e7da0a1` (last presence-rule commit) | presence | 471 | 2,637-2,680 ms | 2,662 ms |
| HEAD | declaration | 471 | 2,679-2,796 ms | 2,765 ms |

**So the branch ends INDISTINGUISHABLE FROM THE BRANCH POINT and about 4% slower than the same
471-site tree under the old rule**, which is the only pair that isolates the extractor. Both halves
have a mechanism: the sweep deleted 28 sites and ~116 ms of mean with them, and the extractor put ~103
ms back. That is the honest result and it needs no inflating — a whole extractor for ~4%, invisible
against the tree the branch started from. The interleaving is not decoration: the spread within one
tree is ~150 ms and the difference between two trees is ~100 ms, so a before/after pair taken minutes
apart measures load rather than the change, which is exactly how the retired headline was produced.

### 2. `symbol_in_code` becomes `symbol_declared_in`

The predicate tests membership in a per-file declared-name set, cached exactly as `STRIP_CACHE` is
today, with a bash glob against a newline-delimited string — no fork, and no regex over whole-file
text. That is strictly cheaper than today's `[[ ${STRIP_CACHE[$file]} =~ … ]]`.

### 3. What counts as a declaration

Measured **as first written** to accept **460** of the **498** identifier-shaped sites and to reject
exactly the 38 that need fixing. The single non-identifier site passes untested, as it does today.

**Rust** — `fn`, `struct`, `enum`, `trait`, `union`, `type`, `const`, `static`, `mod` followed by the
name; `macro_rules!`; `let`; a struct field or a named parameter at line start (`name:`); an
UpperCamel enum variant at statement position; and `js_name = name`.

**THE RUST LIST ABOVE IS WHAT WAS DESIGNED AND IS WRONG IN BOTH DIRECTIONS ABOUT WHAT SHIPPED. BOTH
CORRECTIONS WERE FORCED BY MEASUREMENT, AND ONE OF THEM IS THE BRANCH'S CRITICAL FINDING.**

- **`let` is not in the list on the same footing as the rest, and treating it as though it were is how
  the filed archetype survived this whole slice.** A `let` BINDS a name; it does not declare a member
  of a type. As designed, `let overflow = b.overflow();` in `tm/lower_tm.rs` made that file declare
  `overflow`, so two citations of `` `lower_tm.rs`'s `Builder::overflow` `` — a method `tm/build.rs`
  declares and `lower_tm.rs` only calls — passed the new rule exactly as they had passed the old one.
  What shipped emits `let`-bound names behind a `local:` tag that a **path-qualified** citation cannot
  use and a **bare** one can. The split is not a compromise: a bare citation claims only that the file
  declares that name, and three live sites citing `examples/tm_demo.rs` for `first_order` and
  `higher_order` rest on bindings alone, so a rule that dropped `let` outright would redden three
  correct citations to close two wrong ones. Measured on an instrumented copy: 11 of 471 sites rest on
  `let` or the field rule with no other rule also emitting the name, and qualification splits them
  exactly 5/6. The struct-field rule deliberately does **not** take the tag — a field IS a member, and
  5 sites cite one by a qualified name.
- **WHAT SHIPPED FIRST TAGGED RUST BINDINGS ONLY, AND TYPESCRIPT IS THE TIER THAT HAD ACTUALLY
  DRIFTED.** `put_local` was called from exactly one rule, the Rust `let` rule. TypeScript `const`, `let`
  and `var` reached the keyword rule on plain `put`, so a qualified `Class.member` citation was still
  satisfied by a local binding in a `.ts` file that merely called the member — the identical defect in
  the other language. All 26 drifted citations the gate found when it was introduced were under
  `web/`, and so were 9 of the 10 this branch repointed — the tenth in `grammars/`. It
  was found by a review of the fix, not by the fix's own verification: of the 25 path-qualified sites
  in the tree, **12** passed identically when repointed at their own citing file. Routing the three
  binding keywords through `local:` — and leaving `function`, `class`, `interface`, `enum`,
  `namespace` and `type` on plain `put`, since each mints a name a qualified citation can claim a
  member of — reddened exactly one site: `.step` cited against `pane-chrome.ts`, a CSS class name that
  only ever passed on `const step = document.createElement('span')`. It was reworded, not repointed.
  **96** live sites now rest on the tag alone, 6 under `crates/` and 90 under `web/`, and 34 of those
  name a module-scope binding — 16 `export const`, 16 unexported `const`, 2 `let` — that the tag
  treats as a local; a qualified citation of one would be a false positive, and the tree holds none.
- **A bare UpperCamel name alone on a line was added to the Rust list and then deleted**, and the
  reason is worth more than the rule was. It fires on **302** stripped lines across the tracked `.rs`
  files, and the only name it contributed that no other rule in the same file already emitted is
  `None`, in **24** files — so its entire measured effect was to make 24 files declare a name they only
  use. No site's verdict moved without it. **A rule whose only contribution is a false positive is not
  a conservative rule**, which is the same argument that removed the Rust `use` bail tried for symmetry
  with the TypeScript one.

**TypeScript and JavaScript** — `function`, `class`, `interface`, `enum`, `namespace`, `type`,
`const`, `let`, `var` followed by the name; `get`/`set`; a method or constructor signature; a field,
property or interface member (`name:`). **An `import` line, or an `export … from` line, declares
nothing.**

**CSS and HTML** — no extractor. A cited `.css` or `.html` file falls back to the presence rule, and
a self-test pins that fallback so it is a decision rather than an accident. `ATTRIBUTION_RE` admits
both extensions and no site in the tree cites either: of 499 sites the cited file is `.ts` **318**
times, `.rs` **180** and `.js` once.

**Four of those rules carry the whole design and each is there for a measured reason.**

- **UpperCamel, for the Rust variant rule.** A variant is matched at statement position, which is
  also where a call sits. Restricting the rule to UpperCamel is what keeps `push_frame(x);` from
  reading as a declaration — and `Encoding::push_frame` in `lower_tm.rs` is the filed archetype, so
  this rule is the one that closes the recorded instance.
- **Import and re-export lines declare nothing.** This is what catches the barrel. `types.ts` is
  157 lines and re-exports sixteen generated types; under the presence rule every citation naming it
  reads clean, which the existing header records as a known gap — *"a citation naming the barrel file
  rather than the defining one reads clean here, because the symbol genuinely appears in the barrel's
  code"*. That sentence becomes false with this change and is rewritten.
- **`js_name = name` declares the JS name.** `lib.rs:549` is
  `#[wasm_bindgen(js_name = linkIndex)]`, and that attribute is where the name `linkIndex` is minted.
  Without this rule `link.ts:20`'s citation is a false positive; with it, the citation is correct as
  written and needs no edit.
- **A method signature is distinguished from a call by what follows the parameter list** — a body
  `{` or a return type. **A LINE BREAK WAS THE THIRD BRANCH HERE AND IS DELETED.** It read a line
  ending in a bare `(` as a wrapped signature, which is also what a CALL whose argument list wrapped
  looks like. Measured over the stripped code of the 123 tracked `.ts`/`.tsx`/`.js` files under `web/`:
  **39 lines** match the signature-head regex with nothing but the `(` left on the line, **193** end in
  an open paren at all — and all 39 are calls or control-flow keywords (`expect(` 17 times,
  `parseLayout(` 8, `bufferList(` 4, plus `if (`, `while (`, `return (`), **10 distinct names, not one
  genuine wrapped signature among them.** So the branch deleted a branch whose entire measured output
  was false declarations, at no cost to any passing site. **61 sites** rest on the bare `name:` rule
  alone, the largest
  single-rule dependency in the set, and the audit of them is why it is in the list rather than
  excluded as loose: they are object-literal methods and interface members in this codebase's factory
  style — `transport.ts:261` is `detach: (step: number) => {`, `link-status.ts:210` is
  `forkFailed?: string`. Both are genuine declarations. Dropping the rule would redden 61 correct
  citations.

### 4. The self-test

The central new assertion is the one the gate has never had: **a file that only calls a symbol is not
its owner.** Added cases —

1. a Rust file whose only mention of `push_frame` is a call at statement position is **not** ownership
2. a TypeScript barrel whose only mention of a type is `export { T } from …` is **not** ownership
3. `#[wasm_bindgen(js_name = …)]` **is** ownership
4. an object-literal method `detach: (x) => {}` **is** ownership
5. a cited `.css` file falls back to presence

The existing lifetime-stripping probe must move. It currently asserts `symbol_in_code core.rs 'Drop'`
is true, and under the new rule `Drop` is correctly *not* declared by a file that only implements it —
so that assertion would now pass for the wrong reason. It re-targets onto a symbol **declared after a
lifetime annotation on its own line**, which is what the original defect actually destroyed.

The sabotage obligation is unchanged in kind: breaking the declaration extractor must redden a
counted number of checks, and that number is measured on the implementation rather than predicted
here.

**THE FIVE ABOVE TOOK THE SELF-TEST FROM 5 CHECKS TO 10 AND IT SHIPPED AT 13, AND EVERY CHECK PAST THE
TENTH WAS ADDED BECAUSE A SABOTAGE SHOWED AN EXISTING ONE COULD NOT FAIL.** What the three extra ones
cover, and what forced each:

- **Two of the five above were covering nothing, and a green self-test said otherwise.** The barrel
  fixture was written `export type { Owner } from '…'`, which puts a `{` straight after `type`, so no
  declare rule ever fired on it: deleting BOTH import bails the check exists to guard left the
  self-test at `10 checks, 0 failures`. It passed because nothing fired, not because a bail stopped
  something. The fixture is now `export { type Owner } from '…'`, the inline-type-modifier form, which
  does reach the keyword rule. The comment-stripping fixture had the same defect from the other side —
  its comment was PROSE mentioning `forward`, on which no declare rule fires whether or not the comment
  is stripped — and now carries a real declaration inside both a `//` and a `/* */` comment, because
  the two halves of the stripper can be lost separately.
- **The qualified-versus-local split is asserted in BOTH directions, in three checks.** A citation of
  `` `binder.rs`'s `Builder::overflow` `` against a file whose only mention is
  `let overflow = b.overflow();` is rejected — asserted directly against `symbol_declared_in` and again
  end-to-end through a written-out citation, which is also the only check proving `ATTRIBUTION_RE`
  admits a `::` — and a BARE `overflow` against that same file is still accepted. **The pair is what
  makes either meaningful**: a rule that rejected both would be green on the qualified half and red on
  three live sites.
- **Each direction was sabotaged separately, because one sabotage cannot show a split can fail both
  ways.** Dropping the `local:` tag: `13 checks, 2 failures`, the two qualified checks. Deleting the
  `let` rule outright: `13 checks, 1 failures`, the bare check. Letting a qualified citation accept a
  tagged name: `13 checks, 2 failures`.

**THIRTEEN CHECKS COVERED 6 OF THE 13 DECLARE RULES, AND IT SHIPPED AT 22 ONCE THAT WAS MEASURED.**
Deleting each rule in `declare_names` in turn — seven Rust, six TypeScript counting the two early
bails — left `--self-test` at `13 checks, 0 failures` for seven of them. Four of the seven carry live
citations, and the tree scan went red when each was deleted: the Rust type-keyword rule at 30
violations, the TypeScript signature rule at 24, the Rust field rule at 5, the Rust UpperCamel variant
rule at 1 — 60 live citations whose only guard was the tree they happened to be in. The other three,
`macro_rules!`, the TypeScript `import` bail and `get`/`set`, carry none, so nothing at all would have
noticed them go. Deleting the `()` strip in `symbol_declared_in` was the same shape, green and 22
violations: the `sym()` check expects 0, which a stripper that has lost the strip still returns. A
figure of "8 of 13" circulated for this gap before anyone ran it. Nine checks close it — one per rule,
the `()` strip's positive direction, and the braced-return widening below — each built so exactly ONE
rule emits the asserted name, and each sabotaged: every one reddens its own name, at `22 checks, 1
failures` apart from deleting the signature rule, which reddens both signature checks.

## The sweep — 38 sites

**27 reworded to name the act**, of which **26 carried a claim that survived the rewording** — the
27th is the `config_cli.rs` sentence above, whose claim was false about `emit.rs` independently of the
possessive, and which a later commit rewrote against the shipped code rather than merely re-punctuated.
The transformation is mechanical — the filename leaves the possessive and the act is named:

```
BEFORE  built from the right exactly as `desugar.rs`'s `Expr::List` arm does.
AFTER   built from the right exactly as the `Expr::List` arm in `desugar.rs` does.

BEFORE  truncated at zero, matching `interp.rs`'s `saturating_sub`.
AFTER   truncated at zero, matching the `saturating_sub` in `interp.rs`.
```

Two of the three `Drop` sentences already say "impl", so for those only the possessive moves.

**10 re-resolved to the declaring file.** Every target below was located before this spec was
written, because a spec that names the wrong file is this branch's own error class:

| sites | citation | declared at |
| --- | --- | --- |
| `scratch-fork.test.ts:347,369,418` | `main.ts`'s `onScratchReply` | `web/src/replies.ts:336` — `main.ts:322` only wires `replies.onScratchReply` |
| `scratch.ts:851`, `session-client.ts:84` | `main.ts`'s `schedule` | `web/src/compile.ts:89` |
| `link.ts:3,195`, `style.css:808` | `types.ts`'s `Owner` | `crates/redextape-core/src/lambda/reduce.rs:213` |
| `lambda-pane-editor.test.ts:38` | `types.ts`'s `LambdaState` | `crates/redextape-core/src/viewmodel.rs:64` |
| `grammar.js:153` | `parser.rs`'s `Expr::List` | `crates/redextape-core/src/ast.rs:89` — the sentence claims the variant's *shape* |

**1 marker, taking the escape hatch from 5 to 6.** `buffers-quota.test.ts:91` **quotes** a wrong
citation inside the prose that documents its own repair — *"the one possessive in 57 conversions that
named a symbol its file does not own"*. Rewording it would delete the evidence. A gate flagging the
record of its own finding is what the marker is for, and the existing header counts the hatch out
loud for exactly this reason.

## Commit split

The pre-commit hook runs this gate on every commit, so every commit must be green under whichever
rule is live at that moment. That ordering is forced, not chosen:

1. **The sweep.** Green under the **old** rule: a rewording deletes the attribution site outright, and
   a re-resolution points at a file that does contain the symbol textually.
2. **The gate and its self-test.** Green under the **new** rule, because commit 1 cleared the tree.
3. **The roadmap entry**, before the PR opens.

## What this deliberately does not fix

- **A config-object key whose value is an imported symbol** — `foo({ bar: importedThing })` — reads as
  a declaration of `bar`. The arrow-function form that makes up the 61 measured object-literal sites
  is a real declaration, so the rule stays; this residual is narrower than the rule is useful and goes
  in the header's blind-spot list rather than being argued away.
- **ONE LINE-BASED HOLE STOOD HERE AND THE SHIPPED HEADER NAMES EIGHT MEMBERS OF THE FAMILY**, which
  is the largest single gap between this spec and what landed. The header is the live list and is not
  duplicated here; its standing is: **six open, one closed, one narrowed.** Open — a wrapped Rust
  `use`, whose imported names sit on continuation lines a per-line extractor cannot reach; a Rust
  struct LITERAL at statement position; a Rust struct literal's FIELD lines, the Rust twin of the
  config-object key above; a Rust tuple-variant match arm (`Ok(subs) => subs,`), of which only the bare
  `Other => {}` shape was closed; the config-object key itself; and a TypeScript plain re-assignment,
  which the property rule cannot tell from a key in an object literal. Closed, at no cost to any
  passing site — a wrapped TypeScript CALL read as a multi-line signature, measured above. Narrowed
  rather than open — `if let Some(v)` and `if let Ok(w)`, which DO make a file emit `Some` or `Ok`, but
  emit them behind the `local:` tag, so a qualified `Option::Some` citation cannot rest on one and only
  a bare `Some` can. Verified by running `declare_names` over
  `if let Some(v) = x { let _ = v; }`, which yields `local:Some`, and then `symbol_declared_in` on that
  file: `Option::Some` NOT DECLARED, bare `Some` DECLARED. **The narrowing is a side effect of the
  qualified-versus-local split and was not designed for**, which is the only reason it is recorded here
  rather than only in the header.
- **DECLARATION FORMS THE EXTRACTOR MISSES, a class this section did not have at all.** They are the
  safe direction — each would redden a CORRECT citation rather than pass a wrong one — but they are not
  free, because a cited declaration the extractor misses IS a violation and the tree cannot carry one
  while the scan reports 0. The header enumerates them and records that the heading over them once
  claimed all were at zero occurrences and was wrong twice.
- **"THE SAFE DIRECTION" IS FALSE WHENEVER ANOTHER FILE EMITS THE SAME NAME, AND THE ONE MISSED FORM THAT
  SHOWED IT IS CLOSED.** A TypeScript signature whose return type is an object type was missed in
  **two** places, not the one the header named: `scratch.ts` for `editorSeed` and `pane-host.ts` for
  `scratchSeedOf`, both returning `{ text: string; collapsed: boolean } | null`. For `editorSeed` the
  miss was the safe direction, since no file in `web/` emits that name. For `scratchSeedOf` it was
  not: `main.ts` supplies the member as an object-literal property,
  `scratchSeedOf: (session) => scratchpad.editorSeed(session)`, which the property rule reads as a
  declaration. So a citation naming `main.ts` — the carved god-module this whole gate exists because
  of — PASSED, while a citation naming the file that declares the member FAILED. A missed declaration
  reddens a correct citation only when nothing else in the tree emits the name; when a delegating call
  site does, it passes a wrong one. The signature rule's return-type alternative forbade `{`, `}` and
  `;` after `):`, and an object type carries all three; forbidding only `;` closes neither miss.
  Accepting the whole tail after `):` closes both, and diffing the full declaration sets over the 127
  tracked `.ts`/`.tsx`/`.js` files shows it adds exactly those two names and removes none.
- **A cited `.css` or `.html` file**, which falls back to presence. Nothing in the tree exercises it.
- **The two shapes the existing header already excludes** — a doc quoted verbatim under the wrong
  filename, and an attribution split across a line wrap. Neither is touched by this change and both
  keep their current reasons.
- **Whether a declaration is the one the sentence meant.** `update` is declared seven times in
  `pane-chrome.ts`; the gate confirms the file declares it and says nothing about which.

## Verification

Every figure below is produced by a named command and measured at the branch's final code commit, not
at the point this spec was written.

- `scripts/check-attributions.sh` — site count, markers, **0 violations**, exit 0
- `scripts/check-attributions.sh --self-test` — checks and failures, exit 0; and the failure count
  under a sabotaged extractor, which is the assertion that the self-test covers the scan
- the gate's wall-clock, measured INTERLEAVED against the older trees rather than quoted against the
  **2,738-2,751 ms** recorded here, which is three runs on a 499-site tree and not comparable to a
  471-site one taken minutes later under different load
- `scripts/check-all.sh` whole, on the last code commit
