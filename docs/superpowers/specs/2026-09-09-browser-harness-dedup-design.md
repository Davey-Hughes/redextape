# One `SHELL` and one `until` for the browser tier — design

**PR #84's filing, and only that.** The #84 entry closed with four things left for the reader; this
slice takes the last of them:

> The browser test tier duplicates its shell and helpers — 29 files declare a `SHELL`, 28 of them
> byte-identical, and `until` exists in six distinct bodies across 22 files — which is a tree-wide
> cleanup deliberately kept out of an accessibility fix.

Every figure below was measured at `7258986` with the command named beside it. **Two of the filing's
own numbers are corrected here**: `until` has **seven** distinct bodies across **23** files, not six
across 22. The filing counted only `async function until` declarations; `two-lambda-panes.test.ts`
spells it `const until = async (p: () => boolean, ms = 5000) =>` and was missed by that pattern. The
`SHELL` figure holds — 29 declarations, 28 byte-identical.

**And the filing understated the scope in a way that matters.** It named the duplicated declarations
only. Measuring for this design found **18 further `until` timeouts passed at individual call sites**
across 7 files, eleven of them values that can never fire (§2). Deduping the declarations alone would
have removed twelve dead numbers and left eleven, so those call sites are in scope here.

| what | where |
|---|---|
| The new shared module | `web/tests/browser/harness.ts` (new) |
| The 29 `SHELL` declarations | `web/tests/browser/*.test.ts` |
| The 23 `until` declarations, 200 call sites | `web/tests/browser/*.test.ts` |
| The two timeouts that actually fire | `web/vite.config.ts` (absence of `testTimeout` and `hookTimeout`) |
| The 18 call-site timeout overrides | `web/tests/browser/*.test.ts`, 7 files |
| The idiom being departed from | `tm-blank-buffer.test.ts`, `tm-buffer-restore.test.ts`, `tm-scratch-fork.test.ts` |

---

## §1 The duplication, measured

### `SHELL` — 29 declarations, one string

```
$ python3 - <<'PY'   # regex over tests/browser/*.ts for `const|let SHELL = ` … ``
distinct SHELL bodies: 2
--- 28 file(s) | raw len 521
--- 1 file(s)  | raw len 541   scratch-fork.test.ts
PY
```

The two bodies differ **only by indentation**: `scratch-fork.test.ts` declares its copy inside a
`describe` block, so every line carries two extra spaces (541 bytes against 521). Whitespace-normalised
the two are identical, so all 29 are one string, not 28 plus a variant.

### `until` — 23 declarations, 7 bodies, 200 call sites

| file | timeout | poll | takes `what` | call sites | vitest overrides in file |
|---|---:|---:|---|---:|---|
| `buffer-cool-warm` | `60_000` | 20 | yes | 8 | none |
| `buffer-restore` | `60_000` | 20 | yes | 7 | none |
| `scratch-app` | `60_000` | 20 | yes | 4 | none |
| `scratch-buffers` | `60_000` | 20 | yes | 6 | none |
| `scratch-cap` | `60_000` | 20 | yes | 2 | none |
| `scratch-edit` | `60_000` | 20 | yes | 8 | none |
| `scratch-rebind-editor` | `60_000` | 20 | yes | 6 | none |
| `tm-blank-buffer-cap` | `60_000` | 20 | yes | 1 | none |
| `tm-blank-buffer` | `60_000` | 20 | yes | 1 | none |
| `tm-buffer-restore` | `60_000` | 20 | yes | 4 | none |
| `tm-scratch-fork` | `60_000` | 20 | yes | 7 | none |
| `scratch-fork` | `60_000` | 10 | yes | 12 | `60_000` |
| `buffers-quota-empty` | `30_000` | 10 | yes | 1 | none |
| `app` | `30_000` | 50 | **no** | 30 | `60_000` |
| `extend-during-recompile` | `30_000` | 50 | **no** | 2 | `90_000` |
| `extend-focus-probe` | `30_000` | 50 | **no** | 4 | `90_000` |
| `link-truncated` | `30_000` | 50 | **no** | 3 | `30_000` |
| `running-focus` | `30_000` | 50 | **no** | 3 | `30_000` |
| `active-pane` | `3000` | 20 | yes | 5 | none |
| `buffers-quota` | `3000` | 10 | yes | 5 | none |
| `pane-kind-switch` | `3000` | 20 | yes | 15 | none |
| `pane-picker` | `3000` | 20 | yes | 16 | none |
| `two-lambda-panes` | `5000` | 50 | **no** | 50 | none |

200 call sites; **92 of them pass no description** (`app` 30, `two-lambda-panes` 50,
`extend-focus-probe` 4, `link-truncated` 3, `running-focus` 3, `extend-during-recompile` 2), and 108
already do.

**These counts strip comments and string literals first, which an earlier draft of this table did not.**
Counting raw `until(` occurrences over-counted four files that mention a call in prose and under-counted
`two-lambda-panes`, whose declaration reads `const until = async (` and so contains no `until(` to
subtract. The two errors nearly cancelled: the 92 figure was right for the wrong reason, and the total
was 204.

**The seven bodies differ on axes that are not obviously deliberate**: timeout (`60_000`×12,
`30_000`×6, `3000`×4, `5000`×1), poll interval (20 ms×14, 50 ms×6, 10 ms×3), and message
(`` timed out waiting for ${what} ``×17, `'timed out waiting for the app'`×5, `'timed out'`×1).
Nothing in the tier asserts that `until` rejects: `grep -rn "rejects\|catch" tests/browser/*.ts | grep -i until`
prints nothing, so no test depends on a timeout firing.

---

## §2 The finding the duplication was hiding

`web/vite.config.ts` sets no `testTimeout` and no `hookTimeout` — `grep -n "testTimeout\|hookTimeout" vite.config.ts`
prints nothing. **What bounds a browser wait is therefore vitest's own defaults, and there are two of
them, per project. All four were measured, because the first round measured one and generalised it.**

```
$ pnpm exec vitest run --project node     # 8s test body   -> Error: Test timed out in 5000ms.
$ pnpm exec vitest run --project node     # 8s beforeAll   -> Error: Hook timed out in 10000ms.
$ pnpm exec vitest run --project browser  # 20s test body  -> Error: Test timed out in 15000ms.
$ pnpm exec vitest run --project browser  # 40s beforeAll  -> Error: Hook timed out in 30000ms.
```

**Browser mode triples both defaults.** A wait inside an `it` is bounded at **15,000 ms**; a wait
inside `beforeAll`/`beforeEach` is bounded at **30,000 ms**. Every probe file was deleted;
`git status --porcelain` reported 0 modified files afterwards.

This spec reached those numbers badly and the route is worth recording, because §5's gate is built to
prevent a repeat. The first probe ran against `--project node`, read 5,000, and that number was carried
into an argument about the browser tier — the right experiment pointed at the wrong project. It was
caught by a comment in `buffer-cool-warm.test.ts` asserting 15 s, which turned out to be right. The
correction then probed `testTimeout` on both projects, declared the instrument error fixed, and **did
not probe `hookTimeout` at all** — the same class of error, one paragraph below the sentence announcing
it was over. The four measurements above exist because the second failure is what forced enumerating
every reading the instrument produces rather than fixing the one that was noticed.

### What that means for the tree

**12 of the 23 files declare a file-level `until` ceiling that can never fire.** The eleven at `60_000`
with no override anywhere in the file, plus `buffers-quota-empty` at `30_000` whose single call site
sits inside an `it` and is therefore bounded at 15,000.

**Eleven of the twelve exceed both bounds; the twelfth needed the other argument.** `60_000` is above
30,000 as well as 15,000, so no hook rescues those eleven. `buffers-quota-empty`'s `30_000` does not
exceed the hook bound — it *ties* it, which is the relation the next paragraph names for three other
files — and it is dead because its one call site is in an `it`, not because of arithmetic.

**Three file-level ceilings are ties rather than bounds**: `link-truncated` and `running-focus` declare
`30_000` in files whose raised ceiling is also `30_000`, and `scratch-fork` declares `60_000` against a
`beforeAll(…, 60_000)`.

**And 18 call sites pass a numeric timeout of their own, in 7 files** — a figure that took three
scanners to get right (§4):

| value | sites | files |
|---|---:|---|
| `60_000` | 11 | `active-pane` ×2, `buffers-quota` ×2, `pane-kind-switch` ×2, `pane-picker` ×5 |
| `10_000` | 4 | `buffer-cool-warm`, `pane-kind-switch` ×2, `tm-buffer-restore` |
| `30_000` | 3 | `app` ×2 as **positional second arguments**, `buffers-quota` ×1 in third position |

**The eleven `60_000` call sites are dead at either bound**, and they are not what §1's table measures —
that table records each file's declaration default. Deduping the 23 declarations therefore removes
twelve dead values and would leave eleven behind, which is why the scope of this change includes them
(§4).

**A `beforeAll` timeout bounds the hook, not the tests in its block.** `scratch-fork`'s single
`beforeAll(…, 60_000)` sits inside the third and last of its `describe` blocks and covers 2 of that
file's 12 `until` call sites; the other 10 are in `it`s with no override, bounded at 15,000. So even the
file counted as a "tie" is dead at most of its sites.

An earlier draft said "fourth `describe`", taken from that file's own comment above the hook — *"The
three `describe` blocks above never import `../../src/main`"* — which is itself wrong: there are three
`describe` blocks in the file and the hook is inside the third, so two are above it. That comment is
left alone here and filed as a leftover; it is pre-existing and has nothing to do with timeouts.

**One comment in the tier already had this right, and it is the reason the error above was caught.**
`buffer-cool-warm.test.ts` passes an explicit `10_000` and explains why:

> BOUNDED BELOW VITEST'S OWN 15s `testTimeout` RATHER THAN AT THIS FILE'S 60s DEFAULT, and the number
> is chosen so that THIS wait's message is the one a regression prints. … a bound at or above the
> harness's own would let Vitest kill the test first, producing "Test timed out" with no name for what
> never arrived.

It is one of four sub-15,000 call sites in the tier, and the only one that says why. Meanwhile the same
file's own `until` default sits at `60_000`, twice the hook bound and four times the test bound, and is
one of the twelve dead values. **The author reasoned it out at the call site and the file-level default
was never revisited** — which is the whole argument for one shared default in one place.

**This is why the cleanup is worth doing rather than tidy.** Seven copies of a helper and seventeen
scattered overrides is how a value that cannot fire survives in twelve files at once: nothing reads
them together, so nothing notices they disagree with the config.

---

## §3 The shared module

New file `web/tests/browser/harness.ts`. It is **not** collected as a test — the browser project's
`include` is `tests/browser/**/*.test.ts` (`vite.config.ts`), and this file does not match.

It is **not** folded into `tests/browser/setup.ts`. That file is a `setupFiles` entry: it runs for its
side effects (importing `style.css`, installing the per-page `localStorage` shim) and exports nothing.
Making it also an import target would conflate "runs before every file" with "imported by some files",
and the two have different lifetimes.

### Why the standing idiom does not bind

`tm-blank-buffer.test.ts` states the rule the directory duplicates under:

> Duplicating the shell rather than importing it is the standing idiom every sibling in this directory
> states: each browser test file gets its own page (`main()` runs once per module load), so there is
> nothing to import FROM — a shared mount would be a shared page two files could not both own.

The reason is sound and it is about a **mount**. `SHELL` is an inert template string; `until` is a pure
polling function closing over nothing. Neither touches a page, so neither can be shared *between* pages
by being imported into both — and `setup.ts` already demonstrates a shared non-test module being loaded
once per page without sharing anything across pages.

**`mountApp` stays per-file.** That is the case the idiom genuinely covers: 4 files declare one, all 4
bodies differ, and each owns its file's page.

**The prose is corrected, not contradicted.** `grep -rniE "standing idiom|duplicating the shell|rather than importing|nothing to import" tests/browser/*.ts`
returns 4 hits across 3 files (`tm-blank-buffer`, `tm-buffer-restore`, `tm-scratch-fork`). Two things
about them change: the rule is narrowed to the mount, and the phrase *"the standing idiom every sibling
in this directory states"* is retired — 3 of 29 files state it, so "every sibling" was already false
when written.

---

## §4 The `until` contract

```ts
export async function until(
  predicate: () => boolean,
  what?: string,
  timeoutMs = 10_000,
  pollMs = 20,
): Promise<void>
```

**The predicate is evaluated before the first sleep.** `app.test.ts` states this invariant in prose
("NOT `until(() => true)`, WHICH WAITS FOR NOTHING. `until` evaluates its predicate before its first
…"), all seven existing bodies have it, and the shared one keeps it. It is `while (!predicate())`, not
do-while.

**The message names the condition even when the call site did not.** When `what` is omitted the message
quotes the predicate's own source:

```
timed out after 10000ms waiting for `() => lambdaLeaves().length === 2`
```

That this works was measured, not assumed — and the measurement was sabotage-checked, because a probe
that cannot go red proves nothing:

```
$ pnpm exec vitest run --project browser  # assertion inverted on purpose
AssertionError: expected '() => document.querySelector("#result…' to contain '#not-in-the-source'
Received: "() => document.querySelector(\"#results\") !== null"
```

Vite serves the browser tier unminified, so `Function.prototype.toString` returns real source. It
returns the **esbuild-transformed** source, not the file's bytes — note the normalised double quotes —
so the message quotes what ran, which is the more useful of the two. Source is truncated to 120
characters so a multi-line predicate cannot flood a failure log.

### One number, and where it comes from

**`10_000` sits under the smaller of the two harness bounds** (§2: 15,000 in an `it`, 30,000 in a
hook), so the named condition wins the race everywhere, including the twelve files where nothing does
today. And the slowest real wait was bracketed by lowering ceilings and running the full tier:

| ceiling | files lowered | result | command |
|---|---|---|---|
| `4_000` | the 13 whose ceiling this experiment moved — the 12 dead defaults plus `two-lambda-panes` | 273/273, 46 files | `pnpm run test:browser` |
| `2_000` | the same 13 | 273/273, 46 files | `pnpm run test:browser` |
| `1_000` | the same 13 | **272/273, 1 failed** — `timed out waiting for the app to settle on ` + a 60-element list | `pnpm run test:browser` |
| `4_000` | the 6 files carrying a vitest override | 273/273, 46 files | `pnpm run test:browser` |
| **`2_000`** | **all 23 at once** | **273/273, 46 files** | `pnpm run test:browser` |

The last row is the one that matters and it was the last one run: rows 1–4 each covered a subset — 13
and 6 do not even partition the 23, since the four files already at `3000` were never touched — and a
bracket measured on part of a tier says nothing about the rest. **No wait anywhere in the 23 files
exceeds 2,000 ms**, so `10_000` is five times the slowest observed wait. The margin is deliberately
wider than the local measurement needs, because this tier also runs in CI on a machine whose timing
this measurement says nothing about. The shipped value is not itself a row and does not need to be: a
ceiling that passes at `2_000` passes at every larger value, since raising it only admits waits that
already completed sooner. Every run was made on a scratch edit that was reverted; `git status
--porcelain` reported 0 modified files afterwards.

### Every call-site override goes

**All 18 numeric timeout arguments are removed** (§2's table): the eleven `60_000`s that are dead at
either bound, the four `10_000`s that now equal the shared default, `app.test.ts`'s two positional
`30_000`s, and `buffers-quota.test.ts`'s third-position `30_000`. After this the tier contains one timeout, declared once, which is what makes §5's gate
exactly checkable rather than approximately.

`buffer-cool-warm.test.ts`'s comment is rewritten, not deleted. Its reasoning — bound below the
harness's own so this wait's message is the one a regression prints — is now what `harness.ts` does for
the whole tier, so the comment points there instead of justifying a local number.

**IT TOOK THREE SCANNERS, AND EACH FAILURE WAS A DIFFERENT BLIND SPOT IN THE INSTRUMENT.** The count
of these call sites is the most-revised figure in this document, and none of the revisions came from
reading the tree differently — they came from the scanner being wrong in a new way each time.

1. The first anchored on `,\s*[\d_]+\s*$`, the end of the argument list. Every multi-line call ends
   `60_000,` then a newline and `)`, so it found **2 of 18** and reported "these two and no others".
2. The second did a balanced-paren split that tracked string literals, and was self-tested against
   three known positives before its count was believed. It found **17 of 18**. What it missed is
   `buffers-quota.test.ts`'s first-compile wait, whose argument list contains a comment — and that
   comment contains an apostrophe, in the words *this file's own default*. With no comment handling,
   the apostrophe opened a string that swallowed the separator before the number.
3. The third strips comments and string literals before splitting anything, which is the algorithm
   §5's gate ships. It finds **18**.

**The self-test did not catch the second failure, and that is the point of it worth understanding.** It
proved the scanner handled three shapes of *call*; the case it missed was a shape of *comment*. A
known-positive suite bounds the instrument's error only over the cases it contains, so the gate's own
test now carries a negative case too — a number inside a comment, and a number inside a string, neither
of which may be read as an argument.

**The site the second scanner missed was the one with a reason.** Its `30_000` was deliberate, and its
comment says why: *"A wider budget than this file's own default: this is the one test in the suite that
pays for `main()`'s own wasm `init()` without a sibling in the file having paid it already."* That also
means the ceiling bracket in the table above never covered it — those runs lowered declaration
defaults, and this wait kept its explicit `30_000` throughout. It was measured afterwards, once no
call-site override remained to shadow it: the whole tier at a `2_000` default is **273/273 across 46
files**, wasm init included.

**An exhaustiveness claim is a claim about the instrument, not the tree.** The same scanner is what
§5's gate runs, and sabotage 3 in §7 is its regression test.

### The two positional sites are a type error, which is what makes the migration safe

`app.test.ts` passes its timeout in second position:

```ts
await until(() => stepText('tm').includes('history is full'), 30_000)
await until(() => stepNumber(stepText('tm')) > stoppedStep, 30_000)
```

Under the new signature `30_000` would land in `what?: string`. **That is a compile error, not a silent
reinterpretation**, verified by constructing the exact signature and both call sites rather than by
reasoning about it:

```
error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.  (×2, one per site)
```

`tsconfig.json` includes `tests`, so `pnpm run typecheck` covers it. Every call site that passes a
second argument is therefore safe by construction: either it is a string and stays correct, or it is a
number and the typechecker stops it. The 15 third-position numbers are not caught this way — they stay
type-correct and merely become redundant — which is precisely the hole §5's gate exists to close.

**The 108 call sites that already pass a `what` keep it verbatim. Of the 92 that do not, 90 are edited
nowhere** — they gain the source-quoting message for free. **The remaining two are the positional sites
above**, and those are not left alone: moving `30_000` out of second position leaves nothing there
unless something is written, so each becomes a hand-written description (`'the TM history to fill'`,
`'the frontier to advance past the stop'`) — the type error is what forces the edit, not a choice made
freely. Hand-writing all 92 was rejected as the largest error surface available in this change: nothing
gates a string that describes the wrong condition, and a wrong one is a *silently* misleading failure
message. Two hand-written strings, forced by the compiler, is a review-sized surface; ninety written by
choice is not.

---

## §5 A gate for the class, not the instance

The defect in §2 is not that twenty-three numbers are wrong. It is that **nothing in the repository can
notice an `until` ceiling that its enclosing test or hook will never let fire.** Deduping the helper
removes today's copies and does nothing about the next one.

The obvious gate — compare each timeout against the largest vitest timeout in its file — was designed,
implemented against the tree, and **rejected on its own output**. It needs to know which of the two
bounds applies, which means knowing whether each call site sits in an `it` or a hook, which is a parse
rather than a regex. Run with a single hard-coded bound it is wrong in both directions: at 15,000 it
misjudges the six flagged sites that live in hooks, and its per-file approximation passes a file with
one `it(…, 90_000)` and thirty tests without one.

**The gate that ships is the invariant the change actually establishes**, which needs neither bound:

> No `until` call site under `tests/browser/` passes a numeric timeout argument, and `harness.ts`'s
> default is below vitest's browser `testTimeout` of 15,000.

Every wait in the tier is then bounded by one number, declared in one place, provably under the
smaller of the two harness bounds — so the named condition wins the race in an `it` and in a hook.

**It is red on today's tree — checked — and predicted green after the change.** Run against
`7258986` it flags all 18 call sites in 7 files, which is verified: that is the tree as it stands. The
green half is a prediction, not a measurement, because no post-change tree exists yet; it follows from
the change removing all 23 declarations and all 18 arguments and leaving one `10_000` default, and §7
lists it as a gate to run rather than a fact already established. A gate that could not go red before
the fix would be proving nothing, and that half is the half that has been shown.

**What it gives up, stated rather than discovered later.** It forbids a legitimate long wait instead of
validating one. If a future test genuinely needs more than 10,000 ms in a single wait, the gate fails
and the author has to change the gate — deliberately, in a commit that says why — rather than adding a
number no one will re-check. That is the trade: a rule that is exactly checkable, against one that
would be approximately checkable and was wrong twice while being written.

---

## §6 The boundary — what is deliberately left duplicated

Measured so the stopping point is a decision rather than an oversight, and measured under a rule that
distinguishes a duplicated helper from a local variable that happens to share its name: **a declaration
counts only if its initialiser is a function**, at any nesting depth.

That rule is not pedantry — it moved a row. Six files declare something called `editorHost`, but three
of them bind an element (`const editorHost = el.querySelector('.term-editor')`) and three bind a lookup
function. Only the latter three are duplication.

| helper | files declaring it |
|---|---:|
| `resultsText` | 14 |
| `idle` | 7 |
| `buffersButton`, `heading`, `term` | 6 each |
| `stepText` | 5 |
| `forkButton`, `mountApp`, `selector` | 4 each |
| `editorHost`, `linkStatus`, `linkStatusText`, `linkAt`, `tmPaneHost`, `bufferRows` | 3 each |
| `settleOn` | 2 |

22 files declare at least one of them.

**None of these are hoisted.** Each is a one-line DOM selector, so the trade is a one-line local for a
one-line import — no bytes saved — against coupling 22 files to a shared selector vocabulary that
several of them vary on purpose. `mountApp` is excluded on the idiom's own terms (§3): 4 files, 4
distinct bodies, each owning its file's page.

The boundary is: **shared iff it is inert or pure, and identical everywhere it appears.** `SHELL` and
`until` are the only two declarations in the tier that meet it.

---

## §7 Verification

Every figure re-run at the head being pushed, not at the head it was written against.

| gate | expected | command |
|---|---|---|
| browser tier | 273 passed, 46 files | `pnpm run test:browser` |
| node tier | 421 passed, 26 files (verified at `7258986`) | `pnpm run test:node` |
| types | exit 0 | `pnpm run typecheck` |
| lint/format | exit 0 | `pnpm exec biome ci .` |
| the new gate | passes on the branch, and flags 18 sites when run against `7258986` | `pnpm run test:node` |

**Three sabotages, all run and all recorded even if one does not fire:**

1. Reintroduce one numeric timeout argument at an `until` call site — §5's gate must go red. A gate
   that stays green here is the finding, not a formality.
2. Make a predicate never true in a file that passes no `what` — the failure must name the predicate's
   source, not `timed out`.
3. Point the gate's scanner at a call site written multi-line with a trailing comma — it must still
   find it, and a number inside a comment containing an apostrophe, which is the shape that made a
   self-tested scan report 17 of 18. Both are shapes that have already fooled an instrument here,
   so it is a regression test for the instrument, not for the tier.

The roadmap entry is written before the PR opens.
