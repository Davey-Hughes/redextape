# One `SHELL` and one `until` for the browser tier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 29 duplicated `SHELL` declarations and 23 duplicated `until` declarations in `web/tests/browser/` with one shared module, remove all 18 call-site timeout overrides, and gate the class so a timeout that cannot fire is caught rather than accumulated.

**Architecture:** A new non-test module `web/tests/browser/harness.ts` exports `SHELL` (an inert template string) and `until` (a pure poll helper). Neither shares a page, which is why importing them does not violate the directory's standing idiom — see the design's §3. A node-tier test enforces the invariant the change establishes: no `until` call site under `tests/browser/` passes a numeric timeout, and the shared default stays below vitest's browser `testTimeout`.

**Tech Stack:** TypeScript, Vitest 4.1.10 (two projects: `node` and `browser`, the latter on Playwright/chromium), Biome, pnpm.

**Design doc:** `docs/superpowers/specs/2026-09-09-browser-harness-dedup-design.md`. Read §2 before touching a timeout and §3 before touching a doc comment.

## Global Constraints

- **Never `git commit --no-verify`.** Pre-commit runs `check-text-bytes`, `check-citations`, `check-doc-figures`, `check-shared-docs`, `biome ci`, `web typecheck` on every commit.
- **No `file:line` citations in tracked source.** `check-citations` rejects them. They are normal in `docs/`.
- **Doc comments are `/** */` in TypeScript.** `///` is Rust-only; a `///` in a `.ts` file is drift and `biome ci` will not catch it.
- **No AI or assistant attribution anywhere** — not in code comments, commit messages, or docs.
- **The two harness bounds, measured not looked up:** browser `testTimeout` is **15,000 ms**, browser `hookTimeout` is **30,000 ms** (node: 5,000 and 10,000). `web/vite.config.ts` sets neither.
- **The shared timeout default is `10_000` and no call site may pass one.** Five times the slowest wait measured anywhere in the tier, and below both bounds.
- **Never write a glob containing `*/` inside a `/** */` block comment** — it terminates the comment. Describe the pattern in words instead.
- **Every figure that reaches a doc names the command that produced it and is re-run at the head being pushed.**
- Run all `pnpm` commands from `web/`.

---

## File Structure

| file | responsibility |
|---|---|
| `web/tests/browser/harness.ts` | **NEW.** Exports `SHELL` and `until`. The only place either is defined. |
| `web/tests/node/harness.test.ts` | **NEW.** Unit tests for `until` — message, source quoting, poll behaviour, predicate-before-sleep. |
| `web/tests/node/browser-timeout-invariants.test.ts` | **NEW.** The gate: no numeric timeout argument at any `until` call site; shared default below 15,000. |
| `web/tests/browser/*.test.ts` (29 files) | Modified: local `SHELL`/`until` declarations deleted, import added, 18 call-site timeout arguments removed. |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | Modified: the branch's entry, written before the PR opens. |

**The 29 files split cleanly.** 23 declare both `SHELL` and `until`; 6 declare `SHELL` only (`buffer-restore-invalid`, `buffers-quota-restored`, `divider-drag`, `layout-app`, `layout-restore`, `pane-floor`); **none** declares `until` only. So the union is exactly 29 and Task 3's file list is Task 2's plus those six.

---

## Task 1: The shared harness module

**Files:**
- Create: `web/tests/browser/harness.ts`
- Test: `web/tests/node/harness.test.ts`

**Note on what is NOT tested here.** The shared default's *value* is not asserted in this file. An
earlier draft of this task carried a test named for it that passed an explicit 40 ms timeout and
asserted `elapsed < 15_000` — it exercised nothing about the default and could not fail. Task 5's gate
checks the declared default by reading `harness.ts`, which is the only place that check is real.

**Interfaces:**
- Consumes: nothing.
- Produces: `export const SHELL: string` and `export async function until(predicate: () => boolean, what?: string, timeoutMs?: number, pollMs?: number): Promise<void>`. Tasks 2 and 3 import these. Task 5's gate reads this file's text for the `timeoutMs` default.

- [ ] **Step 1: Write the failing test**

Create `web/tests/node/harness.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SHELL, until } from '../browser/harness'

describe('SHELL', () => {
  it('carries the five elements the app mounts into', () => {
    for (const sel of ['#appearance', '#restore-layout', '#buffers', '#encoding', '#results']) {
      expect(SHELL).toContain(sel.slice(1))
    }
    expect(SHELL).toContain('<main></main>')
  })
})

describe('until', () => {
  it('evaluates the predicate before its first sleep', async () => {
    let polls = 0
    await until(() => {
      polls += 1
      return true
    })
    expect(polls).toBe(1)
  })

  it('polls until the predicate flips', async () => {
    let n = 0
    await until(() => ++n > 3, 'four evaluations', 1_000, 1)
    expect(n).toBe(4)
  })

  it('names the condition the call site described', async () => {
    await expect(until(() => false, 'the pane to mount', 30, 5)).rejects.toThrow(
      'timed out after 30ms waiting for the pane to mount',
    )
  })

  it('quotes the predicate source when the call site named nothing', async () => {
    await expect(until(() => 1 > 2, undefined, 30, 5)).rejects.toThrow(/waiting for `.*1 > 2.*`/)
  })

  it('truncates a predicate source too long to belong in a failure log', async () => {
    // A LONG LITERAL IN THE PREDICATE'S OWN BODY, not a long value it closes over.
    // `Function.prototype.toString()` returns source text, so `() => padding.length < 0` stays about
    // 25 characters however large `padding` is at runtime and never crosses MAX_SOURCE_CHARS.
    const predicate = () =>
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
        .length < 0
    await expect(until(predicate, undefined, 30, 5)).rejects.toThrow(/…`$/)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd web && pnpm exec vitest run --project node tests/node/harness.test.ts`
Expected: FAIL — `Failed to resolve import "../browser/harness"`. The module does not exist yet.

- [ ] **Step 3: Write the module**

Create `web/tests/browser/harness.ts`:

```ts
/**
 * Shared browser-tier fixtures: the app shell every test file mounts into, and the poll helper every
 * test file waits on. Both were duplicated — `SHELL` 29 times, `until` 23 times in 7 different bodies —
 * until this file replaced them.
 *
 * **WHY THIS DOES NOT BREAK THE DIRECTORY'S STANDING IDIOM.** Every sibling states that each browser
 * test file gets its own page, since `main()` runs once per module load and Vitest gives each test file
 * its own page, and concludes that duplicating a mount helper is right because "a shared mount would be
 * a shared page two files could not both own". That reasoning is about a MOUNT. `SHELL` is an inert
 * template string and `until` closes over nothing, so importing either into two files shares no page,
 * no state and no mount. `setup.ts` already demonstrates a shared non-test module being loaded once per
 * page without sharing anything across pages. `mountApp` deliberately stays per-file: four files declare
 * one, all four bodies differ, and each owns its own page.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names
 * end in `.test.ts`, and this one does not.
 */

/**
 * The app shell that `index.html` provides in production and Vitest's own tester HTML does not.
 *
 * Reset `document.body.innerHTML` to this before a mount so a new instance queries fresh elements
 * rather than ones an earlier instance's listeners are still attached to.
 */
export const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

/** Longest predicate source a failure message will quote before it starts eliding. */
const MAX_SOURCE_CHARS = 120

const sourceOf = (predicate: () => boolean): string => {
  const src = predicate.toString().replace(/\s+/g, ' ').trim()
  return `\`${src.length > MAX_SOURCE_CHARS ? `${src.slice(0, MAX_SOURCE_CHARS)}…` : src}\``
}

/**
 * Poll `predicate` until it holds, or throw naming what never happened.
 *
 * **THE PREDICATE IS EVALUATED BEFORE THE FIRST SLEEP**, so `until(() => true)` waits for nothing. Every
 * one of the seven bodies this replaced had that property and several call sites rely on it.
 *
 * **THE DEFAULT IS BOUNDED BELOW VITEST'S OWN, WHICH IS THE ENTIRE REASON IT IS ONE NUMBER.** Browser
 * mode raises `testTimeout` to 15,000 ms and `hookTimeout` to 30,000 — both measured against this
 * project's own config, which sets neither — so a wait bounded at or above the harness's own lets Vitest
 * kill the test first and report `Test timed out in 15000ms.` with no name for what never arrived. Twelve
 * files shipped a default above the bound and eleven call sites shipped `60_000`, none of which could
 * ever fire. 10,000 clears both bounds and is five times the slowest wait measured anywhere in this tier.
 *
 * **DO NOT PASS `timeoutMs` FROM A CALL SITE.** `tests/node/browser-timeout-invariants.test.ts` fails if
 * any call site under `tests/browser/` passes a numeric timeout. A wait that genuinely needs longer is a
 * reason to change this default and say why in the commit, not to add a number nothing re-checks.
 */
export async function until(
  predicate: () => boolean,
  what?: string,
  timeoutMs = 10_000,
  pollMs = 20,
): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what ?? sourceOf(predicate)}`)
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && pnpm exec vitest run --project node tests/node/harness.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Verify the SHELL is byte-identical to what it replaces**

This is the step that makes Task 3 a no-op semantically rather than a rewrite. Run from `web/`:

```bash
python3 - <<'PY'
import re, pathlib
h = re.search(r'(?s)^export const SHELL = `(.*?)`', pathlib.Path('tests/browser/harness.ts').read_text(), re.M).group(1)
a = re.search(r'(?s)^const SHELL = `(.*?)`', pathlib.Path('tests/browser/app.test.ts').read_text(), re.M).group(1)
print('identical:', h == a, '| harness bytes:', len(h), '| app.test.ts bytes:', len(a))
PY
```

Expected: `identical: True | harness bytes: 521 | app.test.ts bytes: 521`. If this prints `False`, fix `harness.ts` — do not proceed.

- [ ] **Step 6: Commit**

```bash
cd web && pnpm exec biome check --write tests/browser/harness.ts tests/node/harness.test.ts
cd /home/davey/projects/redextape
git add web/tests/browser/harness.ts web/tests/node/harness.test.ts
git commit -m "test(web): one SHELL and one until for the browser tier to share

Neither shares a page, which is why importing them does not break the
directory's idiom about duplicating a mount. The default timeout is 10,000 ms:
browser mode bounds a test at 15,000 and a hook at 30,000, so a larger value
cannot fire and reports \`Test timed out\` with no name for what never arrived.

Nothing imports this yet."
```

---

## Task 2: Migrate `until` in 23 files and remove all 18 call-site timeouts

**Files:**
- Modify (23): `active-pane`, `app`, `buffer-cool-warm`, `buffer-restore`, `buffers-quota-empty`, `buffers-quota`, `extend-during-recompile`, `extend-focus-probe`, `link-truncated`, `pane-kind-switch`, `pane-picker`, `running-focus`, `scratch-app`, `scratch-buffers`, `scratch-cap`, `scratch-edit`, `scratch-fork`, `scratch-rebind-editor`, `tm-blank-buffer-cap`, `tm-blank-buffer`, `tm-buffer-restore`, `tm-scratch-fork`, `two-lambda-panes` — all `.test.ts` under `web/tests/browser/`

**Interfaces:**
- Consumes: `until` from Task 1.
- Produces: a tier with zero local `until` declarations and zero numeric timeout arguments, which Task 5's gate asserts.

- [ ] **Step 1: Record the before-state so the after-state is checkable**

Run from `web/` and keep the output:

```bash
grep -c "" /dev/null; python3 - <<'PY'
import re, pathlib
D = pathlib.Path('tests/browser')
decls = sum(len(re.findall(r'(?m)^\s*(?:async function until\(|const until\s*=\s*async)', f.read_text()))
            for f in D.glob('*.test.ts'))
print('until declarations:', decls)
PY
```

Expected: `until declarations: 23`.

- [ ] **Step 2: Delete each local declaration and add the import**

In each of the 23 files: delete the whole `async function until(…) { … }` body (or, in `two-lambda-panes.test.ts`, the `const until = async (p: () => boolean, ms = 5000) => { … }`), and add `until` to an import from `'./harness'`.

`two-lambda-panes.test.ts` is the one whose parameter names differ (`p`, `ms`); its call sites pass only a predicate, so nothing at a call site changes.

- [ ] **Step 3: Remove all 18 numeric timeout arguments**

These are the exact sites. Fifteen pass the timeout in **third** position behind a `what`; two pass it in **second** position with no `what`.

| file | sites | value | position |
|---|---|---|---|
| `active-pane.test.ts` | 2 | `60_000` | third |
| `app.test.ts` | 2 | `30_000` | **second** |
| `buffer-cool-warm.test.ts` | 1 | `10_000` | third |
| `buffers-quota.test.ts` | 2 + 1 | `60_000`, `30_000` | third |
| `pane-kind-switch.test.ts` | 2 + 2 | `60_000`, `10_000` | third |
| `pane-picker.test.ts` | 5 | `60_000` | third |
| `tm-buffer-restore.test.ts` | 1 | `10_000` | third |

For the third-position ones, delete the argument and its comma. For `app.test.ts`'s two, the number is the second argument and must become a description:

```ts
// before
await until(() => stepText('tm').includes('history is full'), 30_000)
await until(() => stepNumber(stepText('tm')) > stoppedStep, 30_000)
// after
await until(() => stepText('tm').includes('history is full'), 'the TM history to fill')
await until(() => stepNumber(stepText('tm')) > stoppedStep, 'the frontier to advance past the stop')
```

Leaving those two numbers in place is a **compile error**, not a silent change — `what?: string` rejects a number — so `pnpm run typecheck` catches this step being skipped.

- [ ] **Step 4: Rewrite `buffer-cool-warm.test.ts`'s justifying comment**

That call site's comment explains why it bounded itself below the harness's own timeout. The reasoning is now what `harness.ts` does for the whole tier, so the comment points there instead of justifying a local number. Replace the paragraph beginning `// BOUNDED BELOW VITEST'S OWN 15s` with:

```ts
    // THE MOUNT IS SYNCHRONOUS WITH THE `change` EVENT, so anything past a frame or two is the absence
    // rather than a slow machine — which is why this wait is worth naming. The bound itself is
    // `harness.ts`'s single default, chosen for exactly the reason this comment used to give locally:
    // a wait bounded at or above Vitest's own lets Vitest kill the test first and print "Test timed
    // out" with no name for what never arrived. Measured: with `pane-host.ts`'s `mountScratchEditor`
    // reverted, this line is what fails.
```

- [ ] **Step 5: Verify the tier is unchanged and the declarations are gone**

Run from `web/`:

```bash
pnpm run typecheck && pnpm exec biome ci . && pnpm run test:browser
python3 - <<'PY'
import re, pathlib
D = pathlib.Path('tests/browser')
decls = sum(len(re.findall(r'(?m)^\s*(?:async function until\(|const until\s*=\s*async)', f.read_text()))
            for f in D.glob('*.test.ts'))
print('until declarations remaining:', decls)
PY
```

Expected: typecheck exit 0, biome exit 0, **273 passed / 46 files**, and `until declarations remaining: 0`.

- [ ] **Step 6: Commit**

```bash
cd /home/davey/projects/redextape
git add web/tests/browser
git commit -m "test(web): every browser test waits on the shared until

Twenty-three local declarations in seven distinct bodies go, and with them all
seventeen call-site timeout overrides. Eleven of those passed 60_000, which
could not fire under either browser bound; four passed 10_000, which the shared
default now is; app.test.ts's two passed the number positionally and would have
landed in \`what\`.

buffer-cool-warm.test.ts's comment justified its own bound below Vitest's. That
reasoning is now the shared default's, so the comment points there."
```

---

## Task 3: Migrate `SHELL` in 29 files

**Files:**
- Modify: Task 2's 23 files, plus `buffer-restore-invalid`, `buffers-quota-restored`, `divider-drag`, `layout-app`, `layout-restore`, `pane-floor` — all `.test.ts` under `web/tests/browser/`

**Interfaces:**
- Consumes: `SHELL` from Task 1.
- Produces: a tier with zero local `SHELL` declarations.

- [ ] **Step 1: Confirm all 29 are the same string before replacing any of them**

Run from `web/`:

```bash
python3 - <<'PY'
import re, pathlib, collections
bodies = collections.defaultdict(list)
for f in sorted(pathlib.Path('tests/browser').glob('*.test.ts')):
    for m in re.finditer(r'(?m)^\s*(?:const|let)\s+SHELL\s*=\s*`(.*?)`', f.read_text(), re.S):
        bodies[re.sub(r'\s+', ' ', m.group(1)).strip()].append(f.name)
print('declarations:', sum(len(v) for v in bodies.values()), '| distinct once whitespace-normalised:', len(bodies))
PY
```

Expected: `declarations: 29 | distinct once whitespace-normalised: 1`. If this reports more than 1, stop — a file has a shell that differs in substance and this task's premise is wrong for it.

- [ ] **Step 2: Delete each declaration and add the import**

In each of the 29 files delete the `const SHELL = \`…\`` declaration and import `SHELL` from `'./harness'`, merging with the `until` import Task 2 added where there is one:

```ts
import { SHELL, until } from './harness'
```

`scratch-fork.test.ts`'s declaration is nested inside a `describe` block rather than at top level; delete it there and put the import at the top of the file with the others.

- [ ] **Step 3: Verify**

Run from `web/`:

```bash
pnpm exec biome check --write tests/browser && pnpm run typecheck && pnpm exec biome ci . && pnpm run test:browser
grep -rn "SHELL = \`" tests/browser/*.test.ts | wc -l
```

Expected: typecheck exit 0, biome exit 0, **273 passed / 46 files**, and the grep counts `0`.

- [ ] **Step 4: Commit**

```bash
cd /home/davey/projects/redextape
git add web/tests/browser
git commit -m "test(web): every browser test mounts the shared SHELL

Twenty-nine declarations of one string, twenty-eight of them byte-identical and
the twenty-ninth differing only by the two spaces of being nested in a describe."
```

---

## Task 4: Correct the prose the change contradicts

**Files:**
- Modify: `web/tests/browser/tm-blank-buffer.test.ts`, `web/tests/browser/tm-buffer-restore.test.ts`, `web/tests/browser/tm-scratch-fork.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Prose only.

- [ ] **Step 1: Find every comment that states the idiom**

Run from `web/`:

```bash
grep -rniE "standing idiom|duplicating the shell|rather than importing|nothing to import" tests/browser/*.ts
```

Expected: 4 hits across the 3 files above. If the count differs, correct what you find rather than the four this plan expects, and say so.

- [ ] **Step 2: Narrow the rule to the mount, and retire the false quantifier**

Two things change in each hit. The rule becomes about `mountApp` specifically, and the phrase "the standing idiom **every sibling in this directory** states" goes — 3 of 29 files state it, so "every sibling" was already false before this change. Model the replacement on `tm-blank-buffer.test.ts`:

```ts
 * **`mountApp` IS THIS FILE'S OWN, NOT `tm-scratch-fork.test.ts`'S, EVEN THOUGH THE IDLE POLL IS
 * IDENTICAL.** That file's helper has no route to the buffers button, the popover, a row count or the
 * binding selector — nothing here needed them before this task existed to test. Duplicating the MOUNT
 * rather than importing it is deliberate: each browser test file gets its own page (`main()` runs once
 * per module load), so a shared mount would be a shared page two files could not both own. That
 * argument reaches the mount and stops there — `SHELL` and `until` are an inert string and a pure poll
 * helper, share no page, and now live in `tests/browser/harness.ts`.
```

- [ ] **Step 3: Verify**

Run from `web/`:

```bash
grep -rn "every sibling in this directory" tests/browser/*.ts | wc -l
pnpm exec biome ci . && pnpm run test:browser
```

Expected: the grep counts `0`; biome exit 0; **273 passed / 46 files**.

- [ ] **Step 4: Commit**

```bash
cd /home/davey/projects/redextape
git add web/tests/browser
git commit -m "docs(web): the duplication idiom is about the mount, not the fixtures

Three files stated the rule and one called it what every sibling states. Three
of twenty-nine state it, and the reason it gives — a shared mount would be a
shared page two files could not both own — reaches mountApp and not an inert
string or a pure poll helper."
```

---

## Task 5: The gate

**Files:**
- Create: `web/tests/node/browser-timeout-invariants.test.ts`

**Interfaces:**
- Consumes: reads `tests/browser/harness.ts` and `tests/browser/*.test.ts` as text.
- Produces: nothing importable.

**This repo sets `noUncheckedIndexedAccess: true`.** The code below indexes into a string and into a
regex match, so both need the `as string` idiom already used elsewhere under `web/tests/` or
`pnpm run typecheck` fails. That is a compile-time annotation only — it must not change what the
scanner does.

- [ ] **Step 1: Write the test**

Create `web/tests/node/browser-timeout-invariants.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

/**
 * **VITEST'S BROWSER-MODE `testTimeout`, MEASURED RATHER THAN LOOKED UP, AND NOT THE ONE THIS TEST
 * RUNS UNDER.** A test body in the browser project is bounded at 15,000 ms and a hook at 30,000; in the
 * node project — where this file executes — they are 5,000 and 10,000. This constant describes the
 * files being read, not the process reading them. Asking the ambient environment instead would read
 * 5,000 and flag call sites that are fine, which is exactly the wrong-instrument error this gate exists
 * downstream of.
 */
const BROWSER_TEST_TIMEOUT_MS = 15_000

/**
 * The directory scanned. `REDEXTAPE_SCAN_DIR` points it at a checkout of an older tree so the gate's
 * red half can be demonstrated without a worktree or a second `pnpm install` — see this branch's plan,
 * Task 5 Step 6. Unset in every normal run.
 */
const DIR = process.env.REDEXTAPE_SCAN_DIR
  ? `${process.env.REDEXTAPE_SCAN_DIR.replace(/\/?$/, '/')}`
  : fileURLToPath(new URL('../browser/', import.meta.url))

/** Blank out comments and string/template literals so a number inside either is never read as code. */
const stripped = (s: string): string => {
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      out.push(' ')
      i += 1
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\') {
          out.push(' ')
          i += 1
        }
        out.push(s[i] === '\n' ? '\n' : ' ')
        i += 1
      }
      out.push(' ')
      i += 1
    } else if (s.startsWith('//', i)) {
      while (i < s.length && s[i] !== '\n') {
        out.push(' ')
        i += 1
      }
    } else if (s.startsWith('/*', i)) {
      while (i < s.length && !s.startsWith('*/', i)) {
        out.push(s[i] === '\n' ? '\n' : ' ')
        i += 1
      }
      out.push('  ')
      i += 2
    } else {
      out.push(c)
      i += 1
    }
  }
  return out.join('')
}

/** Split the argument list starting just past `until(`, tracking nesting. Returns trimmed arguments. */
const argsOf = (s: string, from: number): string[] => {
  const args: string[] = []
  let cur = ''
  let depth = 1
  for (let i = from; i < s.length; i += 1) {
    const c = s[i]
    if (c === '(' || c === '[' || c === '{') depth += 1
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1
      if (depth === 0) break
    }
    if (c === ',' && depth === 1) {
      args.push(cur)
      cur = ''
    } else cur += c
  }
  args.push(cur)
  return args.map((a) => a.trim()).filter((a) => a !== '')
}

const numericTimeoutSites = (): string[] => {
  const hits: string[] = []
  for (const name of readdirSync(DIR).filter((n) => n.endsWith('.test.ts')).sort()) {
    const raw = readFileSync(DIR + name, 'utf8')
    const code = stripped(raw)
    const re = /(?<![\w.])until\(/g
    let m: RegExpExecArray | null = re.exec(code)
    while (m !== null) {
      const nums = argsOf(code, m.index + m[0].length).filter((a) => /^[\d_]+$/.test(a))
      if (nums.length > 0) {
        hits.push(`${name}:${code.slice(0, m.index).split('\n').length} passes ${nums.join(', ')}`)
      }
      m = re.exec(code)
    }
  }
  return hits
}

/**
 * **THE SCANNER'S OWN TEST, AND IT IS NOT CEREMONY.** An earlier scan of this tier reported "these two
 * call sites and no others" and had found 2 of 18, because it anchored on the end of the argument list
 * and every multi-line call ends with a trailing comma before its closing paren. A count is a claim
 * about the instrument as much as about the tree, so the instrument is fed a known positive of each
 * shape before any count from it is believed. This follows the repository's own convention rather than
 * inventing one: `check-doc-figures` and `check-text-bytes` both run `--self-test` before their scan,
 * for the reason the pre-commit config states — a gate that only ever runs against a passing tree
 * cannot tell you it still works.
 */
it('the scanner finds a numeric timeout in every shape a call site can take', () => {
  const cases = [
    ['multi-line with a trailing comma', 'await until(\n  () => x,\n  \'what\',\n  60_000,\n)\n'],
    ['single line, second position', "await until(() => x, 30_000)\n"],
    ['single line, third position', "await until(() => x, 'what', 10_000)\n"],
  ] as const
  for (const [shape, src] of cases) {
    const nums = argsOf(stripped(src), src.indexOf('until(') + 'until('.length).filter((a) =>
      /^[\d_]+$/.test(a),
    )
    expect(nums.length, shape).toBeGreaterThan(0)
  }
})

it('the scanner does not read a number inside a comment or a string as an argument', () => {
  for (const src of ["// await until(() => x, 60_000)\n", "const s = 'until(() => x, 60_000)'\n"]) {
    expect(stripped(src).includes('until(')).toBe(false)
  }
})

/**
 * **THE SHAPE A SELF-TESTED SCANNER STILL MISSED.** A previous scan of this tier tracked string
 * literals but not comments, and reported 17 of the 18 call sites. The one it missed has a comment
 * inside its argument list, and that comment contains an apostrophe — the words "this file's own
 * default" — so the apostrophe opened a string that swallowed the separator before the number. The
 * self-test above proved three shapes of CALL; the missing case was a shape of COMMENT.
 */
it('reads a numeric argument that follows a comment containing an apostrophe', () => {
  const src = [
    'await until(',
    '  () => x,',
    "  'the first compile',",
    "  // A wider budget than this file's own default: this test pays for wasm init.",
    '  30_000,',
    ')',
    '',
  ].join('\n')
  const code = stripped(src)
  const nums = argsOf(code, code.indexOf('until(') + 'until('.length).filter((a) => /^[\d_]+$/.test(a))
  expect(nums).toEqual(['30_000'])
})

it('no until call site under tests/browser passes a numeric timeout', () => {
  expect(numericTimeoutSites()).toEqual([])
})

it('the shared until default is below vitest browser testTimeout', () => {
  const src = readFileSync(fileURLToPath(new URL('../browser/harness.ts', import.meta.url)), 'utf8')
  const m = src.match(/timeoutMs = ([\d_]+)/)
  expect(m, 'harness.ts declares a timeoutMs default').not.toBeNull()
  const declared = Number((m as RegExpMatchArray)[1].replace(/_/g, ''))
  expect(declared).toBeLessThan(BROWSER_TEST_TIMEOUT_MS)
})
```

- [ ] **Step 2: Run it — it must pass, because Tasks 2 and 3 removed what it forbids**

Run: `cd web && pnpm exec vitest run --project node tests/node/browser-timeout-invariants.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 3: Sabotage 1 — the gate must go red on a reintroduced override**

By hand, add a numeric third argument to any one `until` call in `tests/browser/app.test.ts`, then run:

Run: `cd web && pnpm exec vitest run --project node tests/node/browser-timeout-invariants.test.ts`
Expected: **FAIL** on `no until call site under tests/browser passes a numeric timeout`, naming `app.test.ts` and the value. Record the exact message. Then `git checkout -- tests/browser/app.test.ts` and re-run to confirm PASS.

**If this stays green, that is the finding — stop and report it.** A gate that cannot go red is worth nothing, and this tier has already produced one scan that could not.

- [ ] **Step 4: Sabotage 2 — the gate must go red on a default at or above the bound**

By hand, change `harness.ts`'s `timeoutMs = 10_000` to `timeoutMs = 15_000`, then run:

Run: `cd web && pnpm exec vitest run --project node tests/node/browser-timeout-invariants.test.ts`
Expected: **FAIL** on `the shared until default is below vitest browser testTimeout`. Then `git checkout -- tests/browser/harness.ts` and re-run to confirm PASS.

- [ ] **Step 5: Sabotage 3 — a failure message must name the condition even with no description**

By hand, in a file whose call sites pass no `what` (`two-lambda-panes.test.ts`), make one predicate permanently false, then run:

Run: `cd web && pnpm exec vitest run --project browser tests/browser/two-lambda-panes.test.ts`
Expected: **FAIL** with `timed out after 10000ms waiting for \`() => …\`` quoting the predicate's own source — not the bare `timed out` that file used to print. Record the message. Then `git checkout -- tests/browser/two-lambda-panes.test.ts`.

- [ ] **Step 6: Confirm the gate would have caught the original defect**

The gate's value is that it is red on the tree this branch started from. Extract that tree's browser
files and point the scanner at them — **no worktree and no second `pnpm install`**. `/tmp` here is a
30 GB RAM-backed tmpfs, so a checkout plus a `node_modules` in it is memory pressure rather than disk
use; the archive below is about a megabyte of text and costs nothing.

```bash
cd /home/davey/projects/redextape
SCRATCH="$(mktemp -d)"
git archive 7258986 web/tests/browser | tar -x -C "${SCRATCH:?}"
cd web && REDEXTAPE_SCAN_DIR="${SCRATCH:?}/web/tests/browser" \
  pnpm exec vitest run --project node tests/node/browser-timeout-invariants.test.ts 2>&1 | tail -30
rm -rf "${SCRATCH:?}"
```

Expected: **FAIL** on `no until call site under tests/browser passes a numeric timeout`, listing **18
sites across 7 files**. The other three assertions still pass, since they read `harness.ts` from the
real tree. Record the count — this is the figure the roadmap entry cites, so if it comes back different
the entry cites what you measured, not what this plan predicted.

- [ ] **Step 7: Commit**

```bash
cd web && pnpm exec biome check --write tests/node/browser-timeout-invariants.test.ts
cd /home/davey/projects/redextape
git add web/tests/node/browser-timeout-invariants.test.ts
git commit -m "test(web): gate the timeout that cannot fire

Browser mode bounds a test at 15,000 ms and a hook at 30,000, and vite.config.ts
sets neither. Twelve files and eleven call sites shipped ceilings above both, so
their failures printed \"Test timed out\" with no name for what never arrived and
nothing could say so.

The gate is the invariant this branch establishes: no numeric timeout argument at
any until call site, one default below 15,000. Run against 7258986 it flags 18
sites in 7 files. Its scanner carries its own test, because the scan that first
counted those sites reported two of them."
```

---

## Task 6: The roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Re-derive every figure at the head you are about to push**

Do not copy a number from this plan or from the design. Run each command and use its output:

```bash
cd /home/davey/projects/redextape/web
pnpm run test:browser   # test count and file count
pnpm run test:node      # test count and file count
pnpm run typecheck; echo "typecheck exit $?"
pnpm exec biome ci .;   echo "biome exit $?"
cd /home/davey/projects/redextape
git rev-list --count main..HEAD
git diff --shortstat main..HEAD
```

- [ ] **Step 2: Write the entry**

Follow the file's established shape: an all-caps heading naming the sharpest result, the branch and commit range, then the argument, then a figures table where **every row names the command that produced it**.

The entry must record, because these are the branch's actual results rather than its diff:

1. **The defect was found with the wrong instrument twice.** The first probe measured `--project node` and its 5,000 was carried into an argument about the browser tier; the correction then measured `testTimeout` on both projects and never measured `hookTimeout`, one paragraph below the sentence announcing the instrument error was over. Browser mode triples both: 15,000 and 30,000.
2. **A scan reported "these two call sites and no others" and had found 2 of 18**, because it anchored on the end of the argument list and every multi-line call ends with a trailing comma. A second, self-tested scanner then found 17 of 18: it tracked strings but not comments, and the site it missed has a comment containing an apostrophe. The self-test proved three shapes of CALL and the missing case was a shape of COMMENT, so the gate's test now carries negative cases too.
3. **The filing understated its own scope.** #84 named the duplicated declarations; 18 further timeouts were passed at individual call sites, eleven of them values that could never fire. Deduping the declarations alone would have removed twelve dead numbers and left eleven.
4. **The first gate design was implemented and rejected on its own output** — comparing each timeout against its enclosing test's needs to know which of two bounds applies, which is a parse and not a regex, and it was wrong in both directions with either bound hard-coded.
5. **Two review rounds found 11 errors that re-reading found 4 of.** Round one of the correction introduced 7; round two introduced 4, one of them created by the fix for round one's missing `hookTimeout` — an "all twelve exceed 30,000" that is false for the twelfth, which ties the bound rather than exceeding it.
6. **Left for the reader:** `scratch-fork.test.ts`'s comment says "The three `describe` blocks above" when its hook sits inside the third of three, so two are above it — pre-existing, untouched here. And the gate is a rule rather than a validator: it forbids a long wait instead of checking one, so a test that genuinely needs more than 10,000 ms in a single wait has to change the default and say why.

- [ ] **Step 3: Verify the entry's own figures**

Run from the repo root:

```bash
scripts/check-doc-figures.sh --self-test && scripts/check-doc-figures.sh
```

Both must exit 0 — this is exactly what the `check-doc-figures` pre-commit hook runs, so a failure here
blocks the commit anyway.

- [ ] **Step 4: Commit**

```bash
cd /home/davey/projects/redextape
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "docs(roadmap): the browser harness dedup, and two wrong instruments"
```

---

## Self-Review notes

**Spec coverage.** §1 → Tasks 2 and 3 (the declarations) plus Task 5 Step 6 (the call sites). §2 → Task 1's doc comment and Task 5's constant. §3 → Task 1's module doc and Task 4. §4 → Task 1 (the contract), Task 2 (the call sites). §5 → Task 5. §6 → nothing, deliberately: it is the boundary, and Task 4's commit message states it. §7 → Tasks 2, 3, 5's sabotages and Task 6's re-derivation.

**Type consistency.** `until(predicate, what?, timeoutMs?, pollMs?)` is spelled the same in Task 1's module, Task 1's tests, Task 2's `app.test.ts` rewrite, and Task 5's scanner. `SHELL` is a `string` everywhere. Task 5 reads `timeoutMs = ([\d_]+)` from `harness.ts`, which matches the parameter name Task 1 declares — renaming that parameter breaks the gate, which is why Task 5 asserts the match is non-null rather than trusting it.

**One ordering constraint.** Task 5 must come after Tasks 2 and 3, or its central assertion is red. That is why the gate is not written first despite being the TDD-shaped step: the invariant it states does not hold until the migration is done, and a branch should not carry a knowingly-red test between commits.
