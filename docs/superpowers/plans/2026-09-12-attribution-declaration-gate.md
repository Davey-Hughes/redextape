# The attributions gate tells a declaration from a call — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `scripts/check-attributions.sh` stops asking whether a cited symbol is *present* in the named file's code and asks whether it is **declared** there; the 38 sites that rule flags are all fixed, so the gate lands green.

**Architecture:** One awk program gains a second output mode. `strip_code "$f" "$lang" decls` prints the names each stripped line *declares* instead of the blanked line, fused into the pass that already walks every character. `symbol_in_code` becomes `symbol_declared_in`, a membership test against a per-file declared-name set cached like `STRIP_CACHE`. The sweep behind it reshapes 27 citations to name their act, repoints 10 at the declaring file, and marks 1.

**Tech Stack:** bash 5, gawk, `git ls-files`. No new dependency. Spec: `docs/superpowers/specs/2026-09-11-attribution-declaration-gate-design.md`.

## Global Constraints

- **No AI/Claude attribution anywhere** — not in commit messages, code comments, doc files or the roadmap entry.
- **Never `--no-verify`.** The pre-commit hook runs `scripts/check-attributions.sh --self-test && scripts/check-attributions.sh` on **every** commit, `always_run: true`. Every commit in this plan must be green under whichever rule is live at that moment. This is what forces the task order.
- **`file:line` is banned in tracked source** by `scripts/check-citations.sh`; it is normal in `docs/`. Plan and roadmap prose may use it, code comments may not.
- **Rust wraps at 120** (`rustfmt.toml`, `max_width = 120`). TypeScript comment lines in this tree run to 135. Keep a reworded line inside its file's existing maximum; rewrap the paragraph only if it goes over.
- **gawk has no `\b`** — it is a backspace. Every word boundary is written `(^|[^A-Za-z0-9_])`, as the existing scan already does.
- **gawk cannot take a regex constant as a function parameter** — it yields a boolean. Every `sub()` in the new extractor is written out rather than factored into a helper.
- **Every figure in a comment or the roadmap entry names the command that produced it**, and is measured at the final code commit, not predicted.
- **Baseline at the branch point**, for every later figure to be measured against: `scripts/check-attributions.sh` reports **499 attribution sites, 5 excused by marker, 0 violations**, exit 0, in **2,738-2,751 ms** over three runs.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| 27 source files across `crates/`, `web/`, `grammars/` | citations reworded to name an act rather than claim a declaration | 1 |
| 10 source files across `crates/`, `web/`, `grammars/` | citations repointed at the declaring file; one marked | 2 |
| `scripts/check-attributions.sh` | the rule: `strip_code`'s `decls` mode, `symbol_declared_in`, the self-test | 3 |
| `scripts/check-attributions.sh` (header), `.forgejo/workflows/ci.yml`, `.pre-commit-config.yaml` | the prose and figures that go stale | 5 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | the entry | 6 |

---

### Task 1: Reword the 27 citations that name an act rather than a declaration

These sites are **correct today and correct after**. Each names a `match` arm, a call, an impl of a
foreign trait, a fixture, or a statement in a file's own header — and says so with a possessive that
claims something stronger. The transformation is mechanical: the filename leaves the possessive and
the act is named.

The gate is **green before and after this task** under the current rule, because removing the
possessive removes the attribution site outright. The site count drops by 27.

**Files:**
- Modify: `crates/redextape-cli/tests/config_cli.rs:276`
- Modify: `crates/redextape-cli/tests/form_agreement.rs:28`
- Modify: `crates/redextape-core/examples/list_reduction_probe.rs:284`
- Modify: `crates/redextape-core/src/lambda/decode.rs:25`
- Modify: `crates/redextape-core/src/lambda/lower.rs:27`
- Modify: `crates/redextape-core/src/lambda/syntax.rs:225,463,902`
- Modify: `crates/redextape-core/src/printer.rs:701,1177`
- Modify: `crates/redextape-core/src/tm/defunc.rs:69`
- Modify: `crates/redextape-core/tests/lambda_provenance.rs:185`
- Modify: `crates/redextape-core/tests/sourcemap_coverage.rs:571`
- Modify: `crates/redextape-core/tests/tm_binary_gadgets.rs:300`
- Modify: `crates/redextape-core/tests/zipper_equivalence.rs:111-112`
- Modify: `crates/redextape-native/examples/native_demo.rs:76`
- Modify: `crates/redextape-native/tests/native_oracle.rs:413`
- Modify: `crates/redextape-wasm/src/session.rs:266`
- Modify: `web/src/protocol.ts:55`
- Modify: `web/src/scratch.ts:118,609`
- Modify: `web/tests/browser/buffer-affordability.test.ts:189`
- Modify: `web/tests/browser/layout-app.test.ts:120`
- Modify: `web/tests/browser/pane-layout-controls.test.ts:202`
- Modify: `web/tests/browser/pool-isolation.test.ts:120`
- Modify: `web/tests/browser/running-focus.test.ts:47`
- Modify: `web/tests/node/lambda-window.test.ts:117`

**Interfaces:**
- Consumes: nothing.
- Produces: a tree in which 27 fewer lines match `ATTRIBUTION_RE`. Task 3 relies on this: with Tasks 1 and 2 done, the new rule reports 0 violations.

- [ ] **Step 1: Record the before-count, so the after-count means something**

```bash
scripts/check-attributions.sh | tail -1
```

Expected: `checked 499 attribution sites, 5 excused by marker, 0 violations`

- [ ] **Step 2: Apply the 27 rewordings**

Each row is an exact substring replacement. The old text occurs **once** in the named file — verify
that with `grep -c` before replacing if you want the safety. Do not reflow unless the resulting line
exceeds the file's existing maximum.

**The ten `match`-arm citations.** The variant is declared in `ast.rs` or `core.rs`; the arm is in the
cited file.

| File | Replace | With |
| --- | --- | --- |
| `examples/list_reduction_probe.rs` | ``as `desugar.rs`'s `Expr::List` arm does`` | ``as the `Expr::List` arm in `desugar.rs` does`` |
| `src/lambda/syntax.rs` (225) | ``exactly the shape `lower.rs`'s `Core::Apply` builds`` | ``exactly the shape the `Core::Apply` arm in `lower.rs` builds`` |
| `src/lambda/syntax.rs` (463) | ``that case. `lower.rs`'s `Core::Apply` builds`` | ``that case. The `Core::Apply` arm in `lower.rs` builds`` |
| `src/lambda/syntax.rs` (902) | ``the common one: `lower.rs`'s `Core::Apply` builds`` | ``the common one: the `Core::Apply` arm in `lower.rs` builds`` |
| `src/printer.rs` (701) | ``is not — `parser.rs`'s `If` arm always requires`` | ``is not — the `If` arm in `parser.rs` always requires`` |
| `src/printer.rs` (1177) | ``no such sugar (`parser.rs`'s `If` arm`` | ``no such sugar (the `If` arm in `parser.rs``` |
| `tests/lambda_provenance.rs` | ``own App. `lower.rs`'s `Let` arm`` | ``own App. The `Let` arm in `lower.rs``` |
| `tests/sourcemap_coverage.rs` | ``(see `desugar.rs`'s `Stmt::Assign`/`Stmt::While` arms of`` | ``(see, in `desugar.rs`, the `Stmt::Assign`/`Stmt::While` arms of`` |
| `tests/zipper_equivalence.rs` (111) | ``tagged by `lower.rs`'s `BinOp` and`` | ``tagged by the `BinOp` and`` |
| `tests/zipper_equivalence.rs` (112) | ``/// `If` arms — the two constructs`` | ``/// `If` arms in `lower.rs` — the two constructs`` |
| `web/tests/browser/running-focus.test.ts` | ``(`lower.rs`'s `Core::Assign` arm returns`` | ``(the `Core::Assign` arm in `lower.rs` returns`` |

`tests/zipper_equivalence.rs` is the one two-line edit: the citation straddles the wrap, and the
filename moves from line 111 to line 112 so it sits with the noun.

**The eleven call and expression citations.**

| File | Replace | With |
| --- | --- | --- |
| `tests/config_cli.rs` | ``replacing `emit.rs`'s `opts.field_width.unwrap_or(opts.defaults.field_width)` with`` | ``replacing the `opts.field_width.unwrap_or(opts.defaults.field_width)` in `emit.rs` with`` |
| `tests/form_agreement.rs` | ``` `run.rs`'s `form.is_artifact()` guard ``` | ``the `form.is_artifact()` guard in `run.rs``` |
| `tests/tm_binary_gadgets.rs` | ``matching `interp.rs`'s `saturating_sub`.`` | ``matching the `saturating_sub` in `interp.rs`.`` |
| `examples/native_demo.rs` | ``(`interp.rs`'s `saturating_add`/`_mul`)`` | ``(the `saturating_add`/`_mul` in `interp.rs`)`` |
| `tests/native_oracle.rs` | ``SATURATE (`tm/asm.rs`'s `saturating_add`/`saturating_mul`)`` | ``SATURATE (the `saturating_add`/`saturating_mul` in `tm/asm.rs`)`` |
| `web/src/protocol.ts` | ``` `main.ts`'s `sessions.add` call constructs ``` | ``The `sessions.add` call in `main.ts` constructs`` |
| `web/src/scratch.ts` (118) | ``(8,454,144 bytes, `main.ts`'s `init()`, invisible`` | ``(8,454,144 bytes, the `init()` call in `main.ts`, invisible`` |
| `web/src/scratch.ts` (609) | ``` `main.ts`'s `panes.all()` is what the real app passes ``` | ``the `panes.all()` call in `main.ts` is what the real app passes`` |
| `web/tests/browser/buffer-affordability.test.ts` | ``(`affordability-worker.ts`'s `catch`)`` | ``(the `catch` in `affordability-worker.ts`)`` |
| `web/tests/browser/layout-app.test.ts` | ``and `layout-view.ts`'s `root.replaceChildren()` detaches`` | ``and the `root.replaceChildren()` in `layout-view.ts` detaches`` |
| `web/tests/browser/pane-layout-controls.test.ts` | ``too (`main.ts`'s `sessions.add`), so`` | ``too (the `sessions.add` call in `main.ts`), so`` |

`examples/native_demo.rs:76` is inside a `println!` string literal — 108 chars now, 113 after, inside
the 120 limit, and rustfmt will not reflow a string literal either way.

**The three impl citations.** `core.rs:130` is `impl Drop for Core`, `value.rs:140` is
`impl Drop for Value`. `Drop` is std's, so no file in this tree declares it.

| File | Replace | With |
| --- | --- | --- |
| `src/lambda/decode.rs` | ``makes `value.rs`'s `Drop`, `PartialEq` and `Debug` all walk`` | ``makes the `Drop`, `PartialEq` and `Debug` impls in `value.rs` all walk`` |
| `src/lambda/lower.rs` | ``` `core.rs`'s `Drop` impl and `defunc`'s guard ``` | ``the `Drop` impl in `core.rs` and `defunc`'s guard`` |
| `src/tm/defunc.rs` | ``mirroring `core.rs`'s `Drop` impl and this module's own `max_id``` | ``mirroring the `Drop` impl in `core.rs` and this module's own `max_id``` |

**The two fixture citations and the one header citation.**

| File | Replace | With |
| --- | --- | --- |
| `crates/redextape-wasm/src/session.rs` | ``` `results.test.ts`'s `TmLeg` fixture in ``` | ``the `TmLeg` fixture in `results.test.ts`, under`` |
| `web/tests/node/lambda-window.test.ts` | ``see `highlight.test.ts`'s `linkMark` case`` | ``see the `linkMark` case in `highlight.test.ts``` |
| `web/tests/browser/pool-isolation.test.ts` | ``bare string members (`types.ts`'s `Decoded`), and`` | ``bare string members (`types.ts`'s header records this), and`` |

`pool-isolation.test.ts` is the one that keeps a possessive. That is deliberate and it is safe:
`ATTRIBUTION_RE` requires a **backticked** symbol after the possessive, and `header` is bare prose. The
fact the sentence cites — that `'Unfinished'` and `'Undecodable'` cross as bare strings — really is in
`types.ts`'s own header, which is why the citation is reworded rather than repointed.

- [ ] **Step 3: Confirm 27 sites disappeared and nothing broke**

```bash
scripts/check-attributions.sh | tail -1
```

Expected: `checked 472 attribution sites, 5 excused by marker, 0 violations`

If the count is not exactly 472, one replacement either missed or removed more than one site. Find it
with `git diff -U0 | grep -c "^-.*\`.*\`'s"`.

- [ ] **Step 4: Confirm the code still builds and formats**

```bash
cargo fmt --all --check && cargo clippy -p redextape-core -p redextape-cli -p redextape-native -p redextape-wasm --all-targets -- -D warnings
```

Expected: no output from `fmt`, clippy clean. These are comment-only edits, so a failure here means a
replacement landed inside code rather than a comment.

**"COMMENT-ONLY" CONTRADICTS THIS TASK'S OWN STEP 2, WHICH BLESSES AN EDIT INSIDE CODE.** 26 of the 27
land in comments; the 27th is in `examples/native_demo.rs`, inside a `println!` string literal, and
Step 2 says so in as many words — *"inside a `println!` string literal — 108 chars now, 113 after …
rustfmt will not reflow a string literal either way"*. So the diagnostic above is wrong for exactly one
file: a clippy or `fmt` failure there would be a real failure in code the task deliberately edited, not
evidence that a replacement strayed out of a comment. Read it as **26 comment-only edits plus one
string-literal edit in `native_demo.rs`**, and check that one against its own line budget rather than
against the comment-only rule. **A verification step that states a property of the edits contradicts
the step that lists them whenever the list has an exception, and the exception was written down first.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Reword the 27 citations that name an act rather than claim a declaration

Each of these names a match arm, a call, an impl of a foreign trait, a fixture,
or a statement in a file's own header. All 27 are correct today: the arm for
\`Expr::List\` really is in \`desugar.rs\` even though \`ast.rs\` declares the
variant, and \`interp.rs\` really does call \`saturating_sub\` even though std
declares it. What was wrong is the possessive, which claims the file declares
the symbol.

The filename leaves the possessive and the act is named. No claim changes, and
27 attribution sites stop existing: 499 to 472."
```

---

### Task 2: Repoint the 10 drifted citations and mark the 1 quotation

**Files:**
- Modify: `grammars/tree-sitter-redextape/grammar.js:153`
- Modify: `web/src/link.ts:3,195`
- Modify: `web/src/style.css:808`
- Modify: `web/tests/browser/lambda-pane-editor.test.ts:38`
- Modify: `web/src/scratch.ts:851`
- Modify: `web/src/session-client.ts:84`
- Modify: `web/tests/browser/scratch-fork.test.ts:347,369,418`
- Modify: `web/tests/browser/buffers-quota.test.ts:91`

**Interfaces:**
- Consumes: Task 1's tree.
- Produces: 472 sites still, all of which the new rule accepts. Task 3 depends on this.

- [ ] **Step 1: Apply the 10 repointings**

Every target below was located before this plan was written, resolves to **exactly one** tracked file
by basename, and **declares** the symbol under the Task 3 rule. Both facts were checked; neither is
assumed.

| File | Replace | With | Declared at |
| --- | --- | --- | --- |
| `grammars/tree-sitter-redextape/grammar.js` | ``` `parser.rs`'s `Expr::List` holds ``` | ``` `ast.rs`'s `Expr::List` holds ``` | `crates/redextape-core/src/ast.rs:89` |
| `web/src/link.ts` (3) | ``(see `types.ts`'s `Owner` doc for what`` | ``(see `reduce.rs`'s `Owner` doc for what`` | `crates/redextape-core/src/lambda/reduce.rs:213` |
| `web/src/link.ts` (195) | ``See `types.ts`'s `Owner` doc for why`` | ``See `reduce.rs`'s `Owner` doc for why`` | same |
| `web/src/style.css` | ``(`types.ts`'s `Owner` doc)`` | ``(`reduce.rs`'s `Owner` doc)`` | same |
| `web/tests/browser/lambda-pane-editor.test.ts` | ``` `types.ts`'s `LambdaState` is the real shape ``` | ``` `viewmodel.rs`'s `LambdaState` is the real shape ``` | `crates/redextape-core/src/viewmodel.rs:64` |
| `web/src/scratch.ts` | ``the pattern `main.ts`'s `schedule` uses`` | ``the pattern `compile.ts`'s `schedule` uses`` | `web/src/compile.ts:89` |
| `web/src/session-client.ts` | ``but `main.ts`'s `schedule``` | ``but `compile.ts`'s `schedule``` | same |
| `web/tests/browser/scratch-fork.test.ts` (347) | ``the exact method `main.ts`'s `onScratchReply` calls`` | ``the exact method `replies.ts`'s `onScratchReply` calls`` | `web/src/replies.ts:336` |
| `web/tests/browser/scratch-fork.test.ts` (369) | ``resolution `main.ts`'s `onScratchReply` performs`` | ``resolution `replies.ts`'s `onScratchReply` performs`` | same |
| `web/tests/browser/scratch-fork.test.ts` (418) | ``AS `main.ts`'s `onScratchReply` CALLS IT`` | ``AS `replies.ts`'s `onScratchReply` CALLS IT`` | same |

Three of these deserve a sentence each, because a repointing that leaves the prose false is worse
than the drift it replaces.

- **`types.ts` is a barrel.** Its own first line says *"a barrel now, not a file of declarations"* and
  its header says it *"declares none of them any more"*. It re-exports `Owner`, `LambdaState` and
  `Decoded` from a gitignored generated directory, so the doc those three citations want is on the Rust
  declaration. `reduce.rs:213`'s `pub enum Owner` carries a long doc and `Within(NodeId)` carries its
  own — *"this is the innermost enclosing construct that did"* — which is exactly what
  `link.ts:3` asks the reader for.
- **`main.ts` is the carved god-module.** It *imports* `init`, *wires* `replies.onScratchReply` at
  `main.ts:322`, and *calls* `compile.schedule`. Every symbol above moved out of it and the citations
  stayed behind. `session-client.ts:84` is the sharpest: it claims `schedule` *"calls `clearTimeout` on
  the previous timer"*, which is a statement about the body, and the body is in `compile.ts`.
- **`grammar.js:153` claims `Expr::List` "holds a flat `Vec<Expr>`".** That is a statement about the
  variant's shape, so it belongs to the declaration. `ast.rs:89` is `List { items: Vec<Expr>, span: Span }`
  — flat, as claimed. The sentence stays true at the new target.

- [ ] **Step 2: Mark the one quotation**

`web/tests/browser/buffers-quota.test.ts:91` quotes a wrong citation inside the prose recording its own
repair. Rewording it would delete the evidence. Append the marker to the end of the line, two spaces
before it, which is how the five existing markers are placed (`web/src/state-table.ts:25`,
`web/src/sessions.ts:89`, `web/src/panes.ts:35`,
`crates/redextape-core/examples/list_reduction_probe.rs:60`,
`crates/redextape-wasm/tests/browser.rs:175`):

```
   * `` `replies.ts`'s `LambdaPane.setEditor` `` — the one possessive in 57 conversions that named a  check-attributions: allow
```

`ALLOW_RE` is `check-attributions: allow[[:space:]]*$`, so the marker must be last on the line.

- [ ] **Step 3: Confirm the tree is still green under the old rule**

```bash
scripts/check-attributions.sh | tail -1
```

Expected: `checked 471 attribution sites, 6 excused by marker, 0 violations`

The site count drops by one and the marker count rises by one: a marked line is counted as excused
rather than checked.

- [ ] **Step 4: Confirm the web tier still typechecks and lints**

```bash
cd web && pnpm run typecheck && pnpm exec biome ci src tests && cd ..
```

Expected: both clean. These are comment-only edits; a failure means one landed in code.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Repoint the 10 drifted citations at the declaring file, and mark the one quotation

Ten citations named a file that does not declare the symbol. Three classes, one
cause each.

\`types.ts\` is a barrel and says so in its own first line — \"a barrel now, not
a file of declarations\" — so the \`Owner\`, \`LambdaState\` and \`Decoded\` docs
those four sites want are on the Rust declarations they are generated from.
\`main.ts\` is the carved god-module: it imports \`init\`, wires
\`replies.onScratchReply\`, and calls \`compile.schedule\`, and five citations
stayed behind when those moved. And \`grammar.js\` attributed a statement about
\`Expr::List\`'s shape to \`parser.rs\`, which matches on it; \`ast.rs\` declares
it as \`List { items: Vec<Expr>, span: Span }\`, flat as the sentence claims.

\`buffers-quota.test.ts:91\` gets the marker instead, taking the escape hatch from
5 to 6. It QUOTES a wrong citation inside the prose that records its repair, so
rewording it would delete the evidence."
```

---

### Task 3: Teach `strip_code` a declarations mode, and swap the predicate

This is the rule change. **It must land in one commit with its self-test**, because the pre-commit hook
runs `--self-test && scan` and the current self-test asserts `symbol_in_code core.rs 'Drop'` is true —
which the new rule correctly makes false.

**Files:**
- Modify: `scripts/check-attributions.sh` — `strip_code` (lines 97-148), `stripped_of` (214-219), `symbol_in_code` (221-240), `scan` (321), `self_test` (346-410)

**Interfaces:**
- Consumes: Tasks 1 and 2's tree — 471 sites, 6 markers, 0 violations under the old rule.
- Produces: `strip_code <file> <rust|ts> [code|decls]`, defaulting to `code`; `declarations_of <file>` filling `DECL_CACHE[<file>]`; `symbol_declared_in <file> <symbol>` returning 0 when declared. `stripped_of` and `STRIP_CACHE` stay, for the CSS/HTML fallback and for the stripper's own direct assertions.

- [ ] **Step 1: Write the failing self-test assertions first**

Add these to `self_test`, before touching `strip_code`. Five new fixtures and six `assert_declared`
checks, the last of which **replaces** the existing `Drop` check — so the self-test goes from **5
checks to 10**: four existing `assert_site` cases plus six `assert_declared`. Every fixture below was
run against the extractor and against the real stripper before this plan was written; the expected
verdicts are measured, not predicted.

**THAT LAST SENTENCE IS FALSE OF THE BARREL FIXTURE, AND THE FALSE SENTENCE IS WHAT LICENSED A LATER
FINDING RATHER THAN MERELY ACCOMPANYING IT.** `export type { Owner } from '…'` puts a `{` straight
after `type`, so **no declare rule in the extractor ever fires on that line** — the check passes
whether or not the two import bails it exists to guard are present, and deleting BOTH of them left the
self-test at `10 checks, 0 failures`. The fixture asserted nothing. Whatever was run against it
produced the right verdict for the wrong reason, which from outside is indistinguishable from the right
reason; what made that indistinguishability invisible was this sentence promising the measurement had
already happened, so the implementer had no reason to aim a sabotage at it. **"Measured, not predicted"
is a claim about the FIXTURE as much as about the code, and nothing but a sabotage aimed at the rule
the fixture names can tell a green check from a blind one.** The shipped fixture is
`export { type Owner } from '…'`, the inline-type-modifier form, which does reach the keyword rule.
The comment-stripping fixture had the same defect from the other side and was rebuilt for the same
reason. And the self-test shipped at **13** checks, not 10: three more were added after sabotages
showed existing checks could not fail.

```bash
  # A Rust file whose ONLY mention of the symbol is a call at statement position. This is the filed
  # archetype — `lower_tm.rs` calling `Encoding::push_frame`, which `encoding.rs` declares — and it is
  # the one assertion this gate was missing.
  printf 'pub fn lower() {\n    push_frame(1);\n}\n' >"$tmp/caller.rs"
  # A TypeScript barrel: it re-exports and declares nothing, which `types.ts` says of itself.
  printf "export type { Owner } from '../bindings/Owner'\nexport const unrelated = 1\n" >"$tmp/barrel.ts"
  # A `wasm_bindgen` js_name MINTS the JS name, so the Rust file IS where it is declared.
  printf '#[wasm_bindgen(js_name = linkIndex)]\npub fn link_index(&self) -> usize { 0 }\n' >"$tmp/bindgen.rs"
  # An object-literal method. 61 of the tree's sites rest on this rule alone and they are all real.
  printf 'export const make = () => ({\n  detach: (step: number) => {},\n})\n' >"$tmp/factory.ts"
  # A cited CSS file, for which there is no declaration extractor and the presence rule stands.
  printf '.linked {\n  color: red;\n}\n' >"$tmp/style.css"

  assert_declared() {
    local label="$1" file="$2" symbol="$3" expect="$4" got=0
    checks=$((checks + 1))
    if symbol_declared_in "$file" "$symbol"; then got=1; fi
    if ((got == expect)); then
      printf '  ok    %s\n' "$label"
    else
      printf '  FAIL  %s (declared=%d, expected %d)\n' "$label" "$got" "$expect" >&2
      failures=$((failures + 1))
    fi
  }

  assert_declared 'a call at statement position is NOT a declaration' "$tmp/caller.rs" 'push_frame' 0
  assert_declared 'a re-export is NOT a declaration' "$tmp/barrel.ts" 'Owner' 0
  assert_declared 'a wasm_bindgen js_name IS a declaration' "$tmp/bindgen.rs" 'linkIndex' 1
  assert_declared 'an object-literal method IS a declaration' "$tmp/factory.ts" 'detach' 1
  assert_declared 'a cited CSS file falls back to the presence rule' "$tmp/style.css" 'linked' 1
```

Replace the existing `Drop` block (the current last check, lines 399-406) with the re-targeted
lifetime probe. `Drop` can no longer serve: `core.rs` only *implements* it, so the new rule correctly
says it is not declared there, and the assertion would pass for the wrong reason.

```bash
  # Blind sub-case 2, re-targeted. `Drop` was the old probe and cannot be: a file that only IMPLEMENTS
  # a foreign trait does not declare it, so that assertion would now pass for the wrong reason. The
  # defect it guards is that a `'` read as a char-literal opener leaks the "string" state ACROSS the
  # line boundary — line 2 below carries THREE lifetimes, an odd count — and blanks the declaration on
  # the line after it. Measured: the real stripper keeps `after_the_lifetimes`, a naive one loses it.
  printf "pub struct Holder<'a> { pub inner: &'a str }\nimpl<'a> AsRef<str> for Holder<'a> { fn as_ref(&self) -> &'a str { self.inner } }\npub fn after_the_lifetimes() -> usize { 1 }\n" >"$tmp/core.rs"
  assert_declared 'a declaration after an odd run of Rust lifetimes survives stripping' \
    "$tmp/core.rs" 'after_the_lifetimes' 1
```

Also rename the four existing `assert_site` calls' predicate: inside `assert_site`, change
`symbol_in_code "$cand" "$symbol"` to `symbol_declared_in "$cand" "$symbol"`. The four existing
expectations are unchanged and all four still hold — `owner.ts`'s `export const forward` is a
declaration, `talker.ts`'s comment is not, the `sym()` form is still parsed, and `raw.rs`'s raw-string
`needle` is still not code.

- [ ] **Step 2: Run the self-test and watch it fail**

```bash
scripts/check-attributions.sh --self-test
```

Expected: FAIL, with `symbol_declared_in: command not found` on stderr and a non-zero failure count —
**not** a hard exit. A missing command inside an `if` condition does not trip `set -e`, so each check
records `got=0` and the script runs to its summary. The checks expecting `0` therefore pass for the
wrong reason and the ones expecting `1` fail; roughly five failures. That is the expected state, and it
is why Step 5 re-runs the whole self-test rather than only the new checks.

- [ ] **Step 3: Add the `decls` mode to `strip_code`**

Change the signature line and the per-line emit. `strip_code` gains a third positional argument,
defaulting to `code` so every existing call site keeps working.

Replace the `awk` invocation's first line:

```bash
  LC_ALL=C awk -v lang="$2" '
```

with:

```bash
  LC_ALL=C awk -v lang="$2" -v emit="${3:-code}" '
```

Replace the loop's terminator:

```awk
      print out
```

with:

```awk
      if (emit == "decls") declare_names(out); else print out
```

Then add the two functions, immediately after the existing `isq` function:

```awk
    function put(n) { if (n != "" && n ~ /^[A-Za-z_$]/) print n }
    # Every name LINE declares. LINE is already stripped, so a name found here is found in CODE.
    #
    # **gawk HAS NO `\b`** — it is a backspace — so every boundary is written out, the same reason the
    # scan below writes `(^|[^A-Za-z0-9_])`. And **gawk cannot take a regex CONSTANT as a function
    # parameter**: it yields a boolean, silently, with only a warning. So every `sub` here is written
    # out rather than factored into a helper, which a first draft did and which reported 155 of 499
    # sites declared instead of 460.
    function declare_names(line,    s, head, rest) {
      if (lang == "rust") {
        if (match(line, /(^|[^A-Za-z0-9_])fn[ \t]+[A-Za-z_][A-Za-z0-9_]*/)) {
          s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_]?fn[ \t]+/, "", s); put(s)
        }
        if (match(line, /(^|[^A-Za-z0-9_])(struct|enum|trait|union|type|const|static|mod)[ \t]+[A-Za-z_][A-Za-z0-9_]*/)) {
          s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_]?[a-z]+[ \t]+/, "", s); put(s)
        }
        if (match(line, /(^|[^A-Za-z0-9_])macro_rules![ \t]*[A-Za-z_][A-Za-z0-9_]*/)) {
          s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_]?macro_rules![ \t]*/, "", s); put(s)
        }
        if (match(line, /(^|[^A-Za-z0-9_])let[ \t]+(mut[ \t]+)?[A-Za-z_][A-Za-z0-9_]*/)) {
          s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_]?let[ \t]+(mut[ \t]+)?/, "", s); put(s)
        }
        # A `wasm_bindgen` js_name MINTS the JS name, so this file is where it is declared. Without
        # this rule `link.ts`, citing a camelCase name against a snake_case Rust method, is a false
        # positive rather than the correct citation it is.
        if (match(line, /js_name[ \t]*=[ \t]*[A-Za-z_][A-Za-z0-9_]*/)) {
          s = substr(line, RSTART, RLENGTH); sub(/^js_name[ \t]*=[ \t]*/, "", s); put(s)
        }
        # A struct field, or a named parameter on its own line.
        if (match(line, /^[ \t]*(pub([ \t]*\([^)]*\))?[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*:/)) {
          s = substr(line, RSTART, RLENGTH); sub(/[ \t]*:$/, "", s)
          sub(/^[ \t]*(pub([ \t]*\([^)]*\))?[ \t]+)?/, "", s); put(s)
        }
        # An enum variant at statement position. **UPPERCAMEL ONLY, AND THAT RESTRICTION IS WHAT LETS
        # THIS GATE TELL A DECLARATION FROM A CALL AT ALL**: a variant and a call sit in the same
        # position, and the filed archetype — `push_frame(x);` — is snake_case, as every Rust function
        # is by a convention clippy enforces.
        if (match(line, /^[ \t]*[A-Z][A-Za-z0-9_]*[ \t]*[({,=]/)) {
          s = substr(line, RSTART, RLENGTH); sub(/[ \t]*[({,=]$/, "", s); sub(/^[ \t]*/, "", s); put(s)
        }
        if (match(line, /^[ \t]*[A-Z][A-Za-z0-9_]*[ \t]*,?[ \t]*$/)) {
          s = line; gsub(/[ \t,]/, "", s); put(s)
        }
        return
      }
      # **AN IMPORT OR A RE-EXPORT DECLARES NOTHING, AND THIS IS WHAT CATCHES THE BARREL.** The header
      # above used to record the barrel as uncatchable; it is this rule that retired that sentence.
      if (line ~ /^[ \t]*import[ \t]/) return
      if (line ~ /^[ \t]*export[ \t]/ && line ~ /[ \t]from[ \t]/) return
      if (match(line, /(^|[^A-Za-z0-9_$])(function|class|interface|enum|namespace|type|const|let|var)[ \t]+\*?[ \t]*[A-Za-z_$][A-Za-z0-9_$]*/)) {
        s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_$]?[a-z]+[ \t]+\*?[ \t]*/, "", s); put(s)
      }
      if (match(line, /(^|[^A-Za-z0-9_$])(get|set)[ \t]+#?[A-Za-z_$][A-Za-z0-9_$]*/)) {
        s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_$]?(get|set)[ \t]+/, "", s)
        sub(/^#/, "", s); put(s)
      }
      # A method or constructor SIGNATURE, told from a CALL by what follows the parameter list: a body
      # `{`, a return type, or a line break. A call is followed by `;`, `,`, `)` or a member access,
      # and matches none of the three.
      if (match(line, /^[ \t]*((export|default|declare|abstract|async|static|readonly|public|private|protected|override)[ \t]+)*#?[A-Za-z_$][A-Za-z0-9_$]*[ \t]*(<[^<>]*>)?[ \t]*\(/)) {
        head = substr(line, RSTART, RLENGTH); rest = substr(line, RSTART + RLENGTH)
        if (rest ~ /^[ \t]*$/ || line ~ /\)[ \t]*(:[^;{]*)?[ \t]*\{[ \t]*$/ || line ~ /\)[ \t]*:[^{};]*;?[ \t]*$/) {
          sub(/[ \t]*(<[^<>]*>)?[ \t]*\($/, "", head); sub(/^[ \t]*/, "", head)
          while (match(head, /^(export|default|declare|abstract|async|static|readonly|public|private|protected|override)[ \t]+/)) {
            head = substr(head, RLENGTH + 1)
          }
          sub(/^#/, "", head); put(head)
        }
      }
      # A field, a property, or an interface or type member. **61 OF THE TREE'S SITES REST ON THIS RULE
      # ALONE**, and the audit of them is why it is here rather than dropped as loose: this codebase
      # declares methods as object-literal properties holding arrow functions, and shapes as interface
      # members. Dropping it would redden 61 correct citations.
      if (match(line, /^[ \t]*((export|declare|static|readonly|public|private|protected|override)[ \t]+)*#?[A-Za-z_$][A-Za-z0-9_$]*[ \t]*[?!]?[ \t]*[:=]/)) {
        s = substr(line, RSTART, RLENGTH); sub(/[ \t]*[?!]?[ \t]*[:=]$/, "", s); sub(/^[ \t]*/, "", s)
        while (match(s, /^(export|declare|static|readonly|public|private|protected|override)[ \t]+/)) {
          s = substr(s, RLENGTH + 1)
        }
        sub(/^#/, "", s); put(s)
      }
    }
```

Duplicates are deliberately left in. The consumer is a membership test, so a `sort -u` would buy
nothing and cost a fork per file.

- [ ] **Step 4: Add the cache and the predicate**

Insert after the existing `stripped_of`, keeping `stripped_of` and `STRIP_CACHE` for the CSS/HTML
fallback:

```bash
declare -A DECL_CACHE=()

# The names $1's CODE declares, newline-delimited, computed once per file. Same shape as
# `stripped_of` and for the same measured reason.
declarations_of() {
  local file="$1"
  if [[ -z ${DECL_CACHE[$file]+set} ]]; then
    DECL_CACHE[$file]="$(strip_code "$file" "$(lang_of "$file")" decls)"
  fi
}

# True when $2 (a symbol) is DECLARED in $1's code.
symbol_declared_in() {
  local file="$1" symbol="$2" bare
  bare="${symbol%\(\)}"
  bare="${bare##*[.:]}"
  bare="${bare#\#}"
  # A symbol that is not an identifier is not something this gate can resolve; pass it rather than
  # invent a verdict about it.
  if [[ -z $bare || ! $bare =~ ^[A-Za-z_] ]]; then
    return 0
  fi
  # CSS AND HTML HAVE NO DECLARATION EXTRACTOR, and fall back to the presence rule. `ATTRIBUTION_RE`
  # admits both extensions and NOTHING IN THE TREE CITES EITHER — of 499 sites at the branch point the
  # cited file was `.ts` 318 times, `.rs` 180 and `.js` once — so an extractor for them would ship
  # unexercised. The fallback is asserted in `--self-test` so it is a decision rather than an accident.
  case "$file" in
    *.css | *.html)
      stripped_of "$file"
      [[ ${STRIP_CACHE[$file]} =~ (^|[^A-Za-z0-9_])"$bare"([^A-Za-z0-9_]|$) ]]
      return
      ;;
  esac
  declarations_of "$file"
  # A glob rather than a regex, and a literal `$bare` because it is quoted: no fork, and no regex over
  # whole-file text. Strictly cheaper than the presence test this replaces.
  [[ $'\n'"${DECL_CACHE[$file]}"$'\n' == *$'\n'"$bare"$'\n'* ]]
}
```

Then delete `symbol_in_code` entirely and change its one call site in `scan` (line 321):

```bash
        if symbol_in_code "$candidate" "$symbol"; then hit=1; break; fi
```

becomes:

```bash
        if symbol_declared_in "$candidate" "$symbol"; then hit=1; break; fi
```

- [ ] **Step 5: Run the self-test and watch it pass**

```bash
scripts/check-attributions.sh --self-test
```

Expected: `10 checks, 0 failures`, exit 0 — the four existing `assert_site` cases plus six
`assert_declared` cases, the sixth being the re-targeted lifetime probe that replaces the old `Drop`
check.

- [ ] **Step 6: Run the scan and confirm it is green under the new rule**

```bash
scripts/check-attributions.sh | tail -1
```

Expected: `checked 471 attribution sites, 6 excused by marker, 0 violations`, exit 0.

If violations appear, each names a site Tasks 1 and 2 should have fixed. Do **not** add a marker to
silence one — re-read the sentence and fix it the way Task 1 or Task 2 would have.

- [ ] **Step 7: Confirm the gate did not get slower**

```bash
for i in 1 2 3 4 5; do
  s=$(date +%s%N); scripts/check-attributions.sh >/dev/null; e=$(date +%s%N)
  echo "$(( (e-s)/1000000 )) ms"
done
```

Expected: in the neighbourhood of the 2,738-2,751 ms baseline or below, because the membership glob
replaces a regex over whole-file text. **Record the five figures**; Task 5 writes them into the hook
comment and Task 6 into the roadmap. If the gate is materially slower, the extraction was not fused —
check that `declare_names` is called from inside the existing loop and that no `sort` was added.

**THE GATE WAS MATERIALLY SLOWER AND THAT DIAGNOSIS WAS THE WRONG ONE, SO THE ADVICE ABOVE WOULD HAVE
SENT WHOEVER FOLLOWED IT TO RE-CHECK SOMETHING ALREADY CORRECT.** `0d8eb06` landed the extraction
fused, inside the existing loop, with no `sort` added — exactly what the advice says to verify — and it
timed **3,867-3,968 ms** against **2,738-2,751 ms** at its parent, about **1,230 ms** over. The cause
is not fork count, it is **per-line compute**: the battery runs about nine regex matches on every
stripped line, including the **49.1%** of them (31,318 of 63,800 across the 108 files the gate
resolves) that strip to pure whitespace and can declare nothing. The fix is the blank-line guard
`if (line ~ /^[ \t]*$/) return` at the top of `declare_names`, which brings the same scan from
**4,099-4,118 ms** to its shipped range. **Read the corrected advice as: if the gate is materially
slower, the extraction probably IS fused and you are paying per line — look for work being done on
lines that cannot produce a name.** "Counting forks" was the right model for the resolver and the
wrong one for the extractor, which is why the design that costed only forks costed this at zero.

- [ ] **Step 8: Commit**

```bash
git add scripts/check-attributions.sh
git commit -m "The attributions gate demands a declaration, not a mention

\`strip_code\` gains a \`decls\` mode: the same awk program, the same character
walk, printing the names each stripped line DECLARES instead of the blanked line.
\`symbol_in_code\` becomes \`symbol_declared_in\`, a membership glob against a
per-file declared-name set cached the way the stripped text already was.

Fused rather than piped, and the cost is why. Measured by patching this script:
adding the extractor as a separate awk pass plus a \`sort -u\` per cited file took
the whole gate from 2,738-2,751 ms to 4,887-4,916 ms — very nearly double, for a
pass that re-reads text this one has already walked character by character.

Two rules carry the design. UpperCamel-only for Rust variants is what tells a
declaration from a call at all: a variant and a call sit in the same position, and
the filed archetype \`push_frame(x);\` is snake_case. And an import or
\`export … from\` line declaring nothing is what catches the barrel, which this
script's own header recorded as uncatchable.

The self-test gains the assertion the gate never had — a file that only CALLS a
symbol is not its owner — and the lifetime probe re-targets off \`Drop\`, which a
file that only implements it correctly no longer declares, so that check would
have passed for the wrong reason. 10 checks, 0 failures."
```

---

### Task 4: Measure the sabotage, and collect every figure the prose will quote

No production change. This task produces the numbers Tasks 5 and 6 are forbidden from guessing.

**Files:**
- Create: nothing tracked. Work in the session scratchpad.

**Interfaces:**
- Consumes: Task 3's script.
- Produces: figures for Task 5's comments and Task 6's roadmap entry.

- [ ] **Step 1: Sabotage the UpperCamel restriction and count what reddens**

This is the rule that distinguishes a declaration from a call, so removing the restriction should let
calls read as declarations. Change the variant rule's `[A-Z]` to `[A-Za-z_]` in both variant patterns,
run the self-test, record the failure count, then revert.

```bash
scripts/check-attributions.sh --self-test; echo "exit=$?"
```

Expected: at least the `a call at statement position is NOT a declaration` check reddens. **Record the
exact count in the session scratchpad** — Tasks 5 and 6 quote it and must not re-derive it. Revert with
`git checkout scripts/check-attributions.sh`.

- [ ] **Step 2: Sabotage the import/re-export skip and count what reddens**

Delete the two `return` lines that skip `import` and `export … from`. Run the self-test, record, revert.

Expected: at least `a re-export is NOT a declaration` reddens. **Record the exact count.**

- [ ] **Step 3: Sabotage the stripper's lifetime handling and count what reddens**

Replace the Rust `'` branch so every `'` opens a literal — the original defect. Run the self-test,
record, revert.

Expected: the lifetime probe reddens. **Record the exact count.**

- [ ] **Step 4: Record the sabotage result honestly, including any that reddens nothing**

A sabotage that reddens nothing is the finding, not a failure of the exercise — and it tests the
property it was **aimed at**, not the property a sentence about it claims. If one of the three reddens
zero checks, write that down as the result and name what would have caught it instead. Do not tune the
sabotage until it goes red.

- [ ] **Step 5: Collect the closing figures**

```bash
scripts/check-attributions.sh | tail -1
scripts/check-attributions.sh --self-test | tail -1
scripts/check-citations.sh | tail -1
scripts/check-doc-figures.sh | tail -1
```

Then the five-run timing from Task 3 Step 7, and the hook comparison in one minute, which is how the
existing hook comment requires it — *"THE COMPARISON FIGURES HERE ARE MEASURED IN THE SAME MINUTE, NOT
QUOTED"*:

```bash
for h in check-text-bytes check-citations check-doc-figures check-shared-docs check-attributions; do
  s=$(date +%s%N)
  scripts/$h.sh --self-test >/dev/null 2>&1; scripts/$h.sh >/dev/null 2>&1
  e=$(date +%s%N); echo "$h $(( (e-s)/1000000 )) ms"
done
```

- [ ] **Step 6: Confirm the whole suite is green before any prose is written**

```bash
scripts/check-all.sh
```

Expected: green. This is the last code-affecting checkpoint; Tasks 5 and 6 touch only prose.

---

### Task 5: Rewrite the header, the CI comment and the hook comment

Three places carry claims the rule change falsifies. A gate whose subject is a claim that stops
matching what it describes must not ship carrying one.

**Files:**
- Modify: `scripts/check-attributions.sh:1-53` (the header), and the blind-spot list
- Modify: `.forgejo/workflows/ci.yml:180-187`
- Modify: `.pre-commit-config.yaml:57-73`

**Interfaces:**
- Consumes: Task 4's figures.
- Produces: prose consistent with the shipped rule.

- [ ] **Step 1: Retire the three false sentences in the script header**

1. **The re-export gap is closed.** The header's last line currently says the gate *"cannot see a
   symbol reached through a re-export — a citation naming the barrel file rather than the defining one
   reads clean here, because the symbol genuinely appears in the barrel's code."* That is now false:
   import and `export … from` lines declare nothing. Replace it with what the new rule does, and say
   that four of the branch's ten repointings were exactly this case.

2. **The self-coverage claim is false and always was.** The header says *"This script is also scanned
   by its own scan, so an illustrative attribution in the header would fail the gate it documents."*
   It is not: `SOURCE_RE` is `\.(rs|ts|tsx|js|css|html)$` and this script is `.sh`. Verified by
   planting `` `lower_tm.rs`'s `push_frame` `` in the header and running the gate — 499 sites, 0
   violations, exit 0, unchanged. The claim was inherited from `check-citations.sh`, where it **is**
   true, because that script has no `SOURCE_RE` and scans all tracked text. State the correction and
   keep the no-possessive discipline in the examples as a deliberate choice rather than a forced one.

3. **The measured false-positive rate moves.** The header says the five markers are *"the measured
   false-positive rate of the strict rule: 5 in 490, ~1%"*. Re-state it for the shipped rule with
   Task 4's numbers, and say what the sixth marker is for.

4. **Line 2 still states the old rule.** The file's second line reads *"Cite the file the symbol is
   IN."* Task 3 reworded the failure output and the heredoc, but the one-line summary at the very top
   of the file was outside its scope and still describes presence rather than declaration. It is the
   first thing a reader sees.

- [ ] **Step 2: Add the new rule and its blind spots to the header**

The header's existing shape is a numbered blind-spot list plus a *"WHAT IT DELIBERATELY DOES NOT
CATCH"* section. Extend both rather than replacing them:

- **The finding that shaped the rule.** A declaration test flags 38 of 499 sites on a tree the presence
  rule passes at 0 violations, and **28 of the 38 are correct** — the possessive was being used for a
  `match` arm (10), a call or expression (11), an impl of a foreign trait (3), a fixture (2), a
  statement in a file's own header (1), and a quotation of a wrong citation (1). Only 10 were drift.
  The convention is now: **a possessive claims the declaration; every other act is named, not
  possessed.**
  **SUPERSEDED AFTER EXECUTION, AND THE SPLIT ABOVE IS WHAT THE HEADER SHOULD NOT SAY.** The real
  split is **27 correct, 11 not** — the call row is **10**, not 11. One of the eleven calls,
  `config_cli.rs`'s citation of an `opts.field_width.unwrap_or(...)` expression in `emit.rs`, names an
  expression that has never existed in any source file here; it is plan code quoted as shipped code.
  Task 1 reworded it, which deleted the attribution site and left the claim false. **This plan
  classified all 38 by what act each sentence NAMED, never by whether the named thing exists**, so
  this was the one error class the survey was structurally unable to see, and no care inside Task 1
  could have caught it either. Write the corrected split into the header.
- **The two discriminators that do not work**, because both are the obvious design. Symbol *shape*
  cannot split the acts — `pane-host.ts`'s `paneEvents.rebind` is declared in the cited file and
  `run.rs`'s `form.is_artifact()` is only called there, same shape. A following role noun gets roughly
  70%: it misses a citation carrying none, and it accepts `types.ts`'s `Owner` doc, which is drift.
- **A new blind spot:** a config-object key whose value is an imported symbol — `foo({ bar: thing })`
  — reads as a declaration of `bar`. The arrow-function form that 61 sites rest on is a real
  declaration, so the rule stays and this residual is recorded rather than argued away.
- **A second new blind spot:** the gate confirms a file declares a symbol and says nothing about
  *which* declaration. `update` is declared seven times in `pane-chrome.ts`.
- **Two line-based holes that a per-line extractor cannot close, both found by Task 3's review and
  both demonstrated live on tracked files.** A Rust `use` whose list wraps puts bare names on
  CONTINUATION lines, and an UpperCamel one is indistinguishable from an enum variant — so
  `crates/redextape-grammar-check/tests/asm.rs` reads as declaring `CORPUS`, which `src/asm.rs`
  declares. And a Rust struct LITERAL at statement position (`Program {`) is indistinguishable from a
  struct-variant declaration, so `crates/redextape-native/src/jit.rs` reads as declaring `Program`,
  which `ast.rs` declares. Both need brace or statement tracking across lines, which is a different
  mechanism than this extractor has. A third hole of the same family — a wrapped TypeScript CALL
  (`bufferList(`) read as a multi-line signature — WAS closed, by deleting that branch, at no cost to
  any passing site. A fourth stays open for the same line-based reason: a Rust **tuple-variant match
  arm** (`Some(x) => value,`) is indistinguishable from a tuple-variant declaration, so it emits
  `Some`. Only the `=`-versus-`=>` sub-case of that rule was closed.
- **Declaration forms the extractor misses**, each of which would redden a correct citation if the
  tree acquired one: a TypeScript signature whose return type contains braces
  (`snapshot(): { width: number } {`), an `export function` with a default parameter value, a
  destructured binding (`export const { compile, parse } = …`), a Rust enum whose variants share the
  enum's own line, and a Rust field behind an inline attribute. Measured at zero occurrences in the
  tree today.

- [ ] **Step 3: Fix the CI comment's enumeration**

`.forgejo/workflows/ci.yml:180-187` enumerates five self-test assertions and ends *"All five run
through the same `strip_code` and `symbol_in_code` the scan uses, so the self-test cannot drift into
agreeing with a broken scan."* Both halves are stale: `symbol_in_code` no longer exists, and there are
ten checks. Rewrite with the real count, the real function name, and the new central assertion — that
a file which only calls a symbol is not its owner.

- [ ] **Step 4: Fix the hook comment's figures**

`.pre-commit-config.yaml:57-73` says *"Scan alone is 2.60-2.65 s over five runs at the 485 sites in 290
tracked files"* and gives a five-hook comparison ending *"this hook 2,667 ms"*. Replace both with Task
4's measurements. Keep the comment's own standing rule — figures measured in the same minute, not
quoted.

- [ ] **Step 5: Confirm the prose edits broke nothing**

```bash
scripts/check-attributions.sh --self-test && scripts/check-attributions.sh | tail -1
```

Expected: `10 checks, 0 failures`, then `checked 471 attribution sites, 6 excused by marker, 0 violations`.

The header is prose, but it is prose inside the scanned-adjacent file — re-run rather than assume.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-attributions.sh .forgejo/workflows/ci.yml .pre-commit-config.yaml
git commit -m "Retire three false claims this gate's own prose was carrying

The re-export gap is CLOSED, and the header still said it was open — \"a citation
naming the barrel file rather than the defining one reads clean here\". Import and
\`export … from\` lines now declare nothing, and four of this branch's ten
repointings were exactly that case.

The self-coverage claim was false and always was. The header said \"This script is
also scanned by its own scan\". \`SOURCE_RE\` is \`\\.(rs|ts|tsx|js|css|html)\$\`
and this script is \`.sh\`. Verified by planting a wrong citation in the header and
running the gate: 499 sites, 0 violations, exit 0, unchanged. The sentence was
inherited from \`check-citations.sh\`, which has no \`SOURCE_RE\` and where it is
true. Seven attribution sites sit in tracked text this gate cannot read — none of
them drifted today, which is why the scope stays as it is and the gap is filed
rather than closed here.

The CI comment enumerated five self-test assertions and named \`symbol_in_code\`;
there are ten and it is \`symbol_declared_in\`. The hook comment's site count
and timings are re-measured in one minute, as that comment's own rule requires."
```

---

### Task 6: The roadmap entry

Substantive PRs need a roadmap entry **before** the PR opens.

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (append an entry)

**Interfaces:**
- Consumes: Tasks 4 and 5's figures.
- Produces: the entry the PR body is drawn from.

- [ ] **Step 1: Write the entry**

Follow the existing entries' shape: an all-caps headline naming the finding rather than the feature, a
dated parenthetical with the branch and commit range, bolded lead sentences, then a verification list
where every figure names its command.

The findings worth recording, in descending order of how much they transfer:

1. **The filed instance was 38 sites, and 27 of them were correct** — this plan said 28, and the
   correction is itself part of the finding; see the note in Task 5 Step 2. The follow-up was filed as
   a small slice on the strength of one example. The measurement inverted it: the rule change is small
   and the sweep is large, and most of what a declaration test flags is a tree using one syntax for
   five acts. **A gap filed from one instance has an unmeasured size, and the direction of the error
   is not predictable** — here the instance count was right and the *interpretation* was wrong.
2. **The two obvious discriminators were measured and both failed.** Shape cannot split the acts;
   a role noun gets ~70% and fails in *both* directions, accepting a drifted citation and rejecting a
   correct one. Recording a rejected design is worth as much as the accepted one.
3. **The gate would have flagged the prose documenting its own finding.** `buffers-quota.test.ts:91`
   quotes the wrong citation inside the record of its repair. That is what the sixth marker is for.
4. **The header claimed a self-coverage property it never had**, inherited verbatim from a sibling
   where it is true. Verified by planting a wrong citation and watching the gate pass. Seven
   attribution sites sit in tracked text the gate cannot read, **zero of them drifted**, which is why
   the scope did not widen.
5. **The spec's own cost figure was measured on the probe harness rather than the gate**, and
   overstated the stripping cost several-fold because the harness forks `bash` per file. Re-measured
   by patching the real script; the conclusion held and got stronger. The superseded figures were
   deleted rather than restated beside a correction.
6. **Two gawk facts that cost a draft each.** `\b` is a backspace, not a word boundary — the real
   script already avoided it and the first extractor did not, reporting 155 of 499 sites declared
   instead of 460. And gawk cannot take a regex constant as a function parameter: it yields a boolean
   with only a warning.

- [ ] **Step 2: Check every figure against its command**

Re-run each command quoted in the entry and compare. A figure that cannot be reproduced comes out.

- [ ] **Step 3: Anchor the git figures LAST**

Writing the entry is itself a commit, so any `rev-list --count` or `diff --shortstat` goes stale the
moment it is written. Put those in on the **final** commit, and prefer a property a reader can check
over a number that rots — `git diff --name-only <sha>..HEAD | grep -v '\.md$'` printing nothing.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "Roadmap: the gate now demands a declaration, and the filed one instance was 38 sites of which 28 were correct"
```

**THIS SUBJECT LINE SHIPPED AS WRITTEN AND THE FIGURE IN IT IS WRONG.** The commit exists with `28`;
the real split is **27 correct, 11 not**, for the reason Task 5 Step 2's note now records. The line is
left here unaltered because it is what this plan asked for and what the history contains, and a plan
edited to match a later correction stops being a record of either.

- [ ] **Step 5: Confirm the branch is green end to end**

```bash
scripts/check-all.sh
```

Expected: green, including the LLVM and wasm-browser suites.

---

## Verification

Every figure here is produced by the named command, measured at the branch's final code commit.

| Command | Expected |
| --- | --- |
| `scripts/check-attributions.sh` | `checked 471 attribution sites, 6 excused by marker, 0 violations`, exit 0 |
| `scripts/check-attributions.sh --self-test` | `10 checks, 0 failures`, exit 0 |
| the three sabotages of Task 4 | a recorded redden-count each, including any that reddens nothing |
| five-run gate timing | against the 2,738-2,751 ms baseline |
| `cargo fmt --all --check` | exit 0 |
| `cargo clippy --all-targets -- -D warnings` | clean |
| `cd web && pnpm run typecheck && pnpm exec biome ci src tests` | clean |
| `scripts/check-all.sh` | green |
| `git diff --name-only <branch-point>..HEAD \| grep -v '\.md$'` | `scripts/check-attributions.sh`, `.forgejo/workflows/ci.yml`, `.pre-commit-config.yaml`, and the **30** swept source files — the row read 37, and `git diff --name-only 4292e6e~1 e7da0a1 \| grep -vE '\.md$'` counts 30. The same 30 are still the whole non-`.md`, non-tooling set at the end of the branch: `git diff --name-only 55750f8..HEAD \| grep -vE '\.md$'` minus those three tooling paths is the identical list, so every later correction round landed inside files the sweep had already touched |

**The site-count arithmetic, so a mismatch is diagnosable rather than mysterious:** 499 at the branch
point, minus 27 rewordings that delete the site (Task 1) = 472, minus 1 that becomes a marker (Task 2)
= **471 checked and 6 excused**. The 10 repointings change which file a site names, not how many there
are.

**THE ARITHMETIC ABOVE GAINED TWO TERMS AFTER THIS PLAN WAS EXECUTED, AND THEY CANCEL, SO THE TOTAL IT
REACHES IS UNCHANGED AND READS AS THOUGH NOTHING MOVED.** A review found the qualified-versus-bare split
had been wired into the Rust `let` rule only; routing TypeScript `const`/`let`/`var` through the same
`local:` tag reddened one site, a citation of `.step` against `pane-chrome.ts` that had only ever passed
on a local `const step`, and rewording it deleted the site. Separately, `buffers-quota.test.ts` held a
correct citation of `reduce_step_go` against `reduce.rs` split across a comment line wrap, invisible to a
line-based gate; joining it added a site. So the full statement is **499 − 27 − 1 − 1 + 1 = 471**: minus
27 rewordings (Task 1), minus 1 marker (Task 2), minus 1 for the `.step` rewording, plus 1 for the
wrap-split citation joined. Measured by `scripts/check-attributions.sh | tail -1`, which reports
`checked 471 attribution sites, 6 excused by marker, 0 violations` with both changes in the tree. **A
count that returns to its old value after two opposite changes is indistinguishable, from the count
alone, from a count nobody touched** — which is the case against treating it as a check.
