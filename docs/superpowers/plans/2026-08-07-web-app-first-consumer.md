# PR 3c — `web/`, the first real consumer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `web/` — one editable CodeMirror source pane, highlighted and linted from core, with the λ and TM results below as plain text — plus the npm→pnpm migration and the eighth wasm export it needs.

**Architecture:** Hybrid threading. `classifySource` and `analyze` are free functions and run synchronously on the main thread so highlighting lands in the same frame as the keystroke; the `Session` lives in a Web Worker so `compile()`'s uninterruptible call — which runs the whole TM leg — can never block input. Pure data-shaping modules (`spans.ts`, `diagnostics.ts`, `results.ts`, `session-client.ts`) import neither wasm nor CodeMirror's view layer and are tested in Node; the CodeMirror extensions, the worker, and the wiring are tested in real Chromium.

**Tech Stack:** Vite 8, TypeScript 7, CodeMirror 6 (decorations + lint, no Lezer grammar), Biome 2, Vitest 4 (two projects: node + Playwright/Chromium), pnpm 11, `wasm-pack --target web`.

**Design spec:** [`../specs/2026-08-07-web-app-first-consumer-design.md`](../specs/2026-08-07-web-app-first-consumer-design.md). Section references below (§0–§12) are to that document.

## Global Constraints

- **Rust line width is 120** (`rustfmt.toml`); the Biome config sets the same for TypeScript so the two halves of the repo read alike.
- **Pre-commit runs `cargo clippy --workspace --all-targets -- -D warnings` on any staged `*.rs`**, and `biome ci` + `pnpm run typecheck` on any staged `web/**`. Every commit in this plan must pass those hooks. **Never `--no-verify`.** If a commit split turns out to be infeasible under the hooks, collapse the commits and say so in the task report.
- **Node 26, pnpm pinned via `packageManager`.** Both images install pnpm explicitly at the pinned version rather than relying on corepack.
- **The wasm package is built to repo-root `pkg/`**, never `web/pkg/`. `.gitignore` already has `/pkg/`. The `Dockerfile` puts stage 1's output at `/app/pkg` beside `/app/web`, so the app's import specifier is `../pkg/redextape_wasm.js`.
- **`tsc --noEmit` requires `pkg/` to exist**, because that is where the generated `.d.ts` lives. Any environment that typechecks must build wasm first.
- **Every wire shape below is measured, not guessed** — `crates/redextape-wasm/tests/browser.rs` pins each one. Do not "improve" a type to look more idiomatic: `total_steps` really is snake_case, a unit enum variant really is a bare string, and a struct variant really is a one-key object.
- **Scope is §6.3 of the plan-4 design.** No λ pane, no TM tape view, no stepping controls, no caps affordance, no `lambdaAst` consumer. If a task seems to want one, it is out of scope — stop and report rather than adding it.

## Measured wire shapes

These are the types every task depends on. Sources: `crates/redextape-wasm/tests/browser.rs` (lines 112–190, 648–730), `session.rs`, `viewmodel.rs`, `analysis.rs`, `diagnostic.rs`, `core.rs`.

```
compile(src, encoding)  → { diagnostics: Diagnostic[], session: Session | null }
classifySource(src)     → [[{start,end}, TokenClass], ...]        // tuple = 2-element array
analyze(src)            → [{span:{start,end}, severity, message}, ...]
encodings()             → ["unary", "binary"]                      // Task 1 adds this

session.lambdaStatus()  → { available, reason, node: number|null, run: RunStatus|null }
session.lambdaState(n)  → { text, spans, truncated, step }
session.lambdaValue()   → Decoded
session.runLambda(n)    → RunStatus                                 // n is a plain JS number (u32)
session.tmStatus()      → { available, reason, width, run, total_steps }   // snake_case
session.tmValue()       → Decoded
session.sourceSpan(id)  → {start,end} | null

RunStatus  = "Running" | "Ended" | "Capped" | "DepthRefused"        // bare strings
Severity   = "Error" | "Warning"
Decoded    = "Unfinished" | "Undecodable"
           | { Value: { text: string } } | { Fault: { message: string } }
NodeId     = u32, so it crosses as a number, never a bigint
```

Canonical test program: **`let x = 40; x + 2`** — 7 β-steps to Church 42, 2,870 δ-steps on a 5-tape unary machine, both legs decode to `42`.

Canonical λ-refusing program: **`let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)`** — the λ backend declines a closure over a `let mut`; the TM backend handles it.

Canonical broken program: **`let x = ;`** — error-severity diagnostics, no session.

## File structure

```
crates/redextape-wasm/src/lib.rs        MODIFY  + encodings()
crates/redextape-wasm/tests/browser.rs  MODIFY  + one test

web/
├─ index.html               the shell: header bar, editor mount, results mount
├─ package.json             scripts + pinned deps + packageManager
├─ pnpm-lock.yaml           generated
├─ tsconfig.json
├─ biome.json
├─ vite.config.ts           fs.allow, worker format, two vitest projects
└─ src/
   ├─ types.ts              the measured wire shapes + TOKEN_CLASSES     (pure)
   ├─ protocol.ts           worker request/reply message types           (pure)
   ├─ spans.ts              Classified → {from,to,className}[]           (pure)
   ├─ diagnostics.ts        Diagnostic[] → {from,to,severity,message}[]  (pure)
   ├─ results.ts            statuses + values → labelled rows            (pure)
   ├─ session-client.ts     generation counter, stale-reply drop         (pure)
   ├─ theme.ts              the .tok-* class-name map, all 14 classes    (pure)
   ├─ style.css             design tokens, light + dark, .tok-* rules
   ├─ highlight.ts          CM6 StateField over spans.ts                 (browser)
   ├─ lint.ts               CM6 linter over diagnostics.ts               (browser)
   ├─ session-worker.ts     owns the Session; compile + chunked run      (browser)
   └─ main.ts               wiring: editor, debounce, render             (browser)
└─ tests/
   ├─ node/*.test.ts        the six pure modules
   └─ browser/*.test.ts     end to end in Chromium

Dockerfile              MODIFY  stage 2 → pnpm, and build:app not build
.forgejo/workflows/ci.yml MODIFY  web job → pnpm, wasm before typecheck, + chromium
.pre-commit-config.yaml MODIFY  web hooks → pnpm
README.md               MODIFY  the web section
docs/superpowers/plans/2026-07-19-redextape-roadmap.md  MODIFY  + a PR 3c entry
```

**One refinement of the spec's §2 listing, made deliberately.** §2 lists `highlight.ts` and `lint.ts` as the node-testable modules. Splitting each into a pure half (`spans.ts`, `diagnostics.ts`) and a CodeMirror half (`highlight.ts`, `lint.ts`) is strictly better for the same reason §2 gives: `@codemirror/view` is where `Decoration` lives, and a Node test that imports nothing from it cannot be broken by it. The testability boundary §2 draws is unchanged; this just puts the file boundary on the same line.

---

### Task 1: `encodings()` — the eighth wasm export

**Files:**
- Modify: `crates/redextape-wasm/src/lib.rs` (append after `analyze`, before the `to_value` helper)
- Test: `crates/redextape-wasm/tests/browser.rs`

**Interfaces:**
- Consumes: `EncodingKind::ALL` and `EncodingKind::name()` from `redextape_core::tm::header`, already in scope in `lib.rs`.
- Produces: `encodings(): string[]` on the JS boundary — Task 2's app imports it, Task 9's header bar renders it.

- [ ] **Step 1: Write the failing test**

Append to `crates/redextape-wasm/tests/browser.rs`:

```rust
/// The picker's list comes from the registry rather than from a hand-written TypeScript array.
///
/// TWO ASSERTIONS, NOT ONE: that the list is non-empty and names both shipped kinds, and that every
/// name it advertises is one `compile` actually accepts. The second is what makes this a check on the
/// `encoding_kinds!` registry rather than on a copy of it — a row added to the macro with a broken
/// `parse` arm would pass the first and fail the second.
#[wasm_bindgen_test]
fn encodings_lists_every_name_compile_accepts() {
    let names: Array = redextape_wasm::encodings().expect("marshals").unchecked_into();
    assert!(names.length() >= 2, "the registry ships at least unary and binary");

    let mut seen: Vec<String> = Vec::new();
    for i in 0..names.length() {
        let name = names.get(i).as_string().expect("each encoding name marshals as a string");
        assert!(
            redextape_wasm::compile("let x = 40; x + 2", &name).is_ok(),
            "`compile` rejected {name:?}, which `encodings()` advertises"
        );
        seen.push(name);
    }
    assert!(seen.iter().any(|n| n == "unary"), "got {seen:?}");
    assert!(seen.iter().any(|n| n == "binary"), "got {seen:?}");
}
```

- [ ] **Step 2: Run the browser suite to verify it fails**

Run:
```bash
wasm-pack test --headless --chrome crates/redextape-wasm
```
Expected: FAIL — `cannot find function 'encodings' in crate 'redextape_wasm'`.

If `wasm-pack` reports Chrome as unavailable, note that `google-chrome-stable` is present at both `/usr/bin` and `/usr/sbin` on this machine; chromedriver self-installs.

- [ ] **Step 3: Add the export**

In `crates/redextape-wasm/src/lib.rs`, directly after the `analyze` export:

```rust
/// `encodings()` -> every encoding name `compile` accepts, in `EncodingKind::ALL`'s declaration order.
///
/// EXPORTED RATHER THAN HARDCODED IN THE UI. A TypeScript array of names would be a second
/// authoritative registry, which is precisely what `encoding_kinds!` exists to prevent — and worse
/// than the Rust case it prevents, because not even the compiler is watching a list in another
/// language. Generated from the same rows as `ALL`, `name` and `parse`, so a third encoding reaches
/// the picker with no TypeScript edit.
#[wasm_bindgen]
pub fn encodings() -> Result<JsValue, JsValue> {
    to_value(&EncodingKind::ALL.iter().map(|k| k.name()).collect::<Vec<_>>())
}
```

- [ ] **Step 4: Run the browser suite to verify it passes**

Run:
```bash
wasm-pack test --headless --chrome crates/redextape-wasm
```
Expected: PASS, 11/11 (10 existing + 1 new).

- [ ] **Step 5: Run the full Rust gate**

Run:
```bash
scripts/check-all.sh --no-llvm
```
Expected: green. Clippy runs with `-D warnings`; `Vec<&'static str>` collected from an iterator of `&str` is idiomatic and should not trip a lint, but if it does, fix the lint rather than allowing it.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-wasm/src/lib.rs crates/redextape-wasm/tests/browser.rs
git commit -m "wasm: encodings(), so the picker cannot drift from the registry"
```

---

### Task 2: `web/` scaffold and the pnpm migration

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/biome.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.ts` (placeholder), `web/src/style.css` (placeholder)
- Modify: `Dockerfile` (stage 2), `.forgejo/workflows/ci.yml` (`web` job), `.pre-commit-config.yaml` (both web hooks)
- Generated: `web/pnpm-lock.yaml`

**Interfaces:**
- Produces: `pnpm run build:wasm`, `pnpm run build:app`, `pnpm run build`, `pnpm run typecheck`, `pnpm test`, `pnpm run dev`. Every later task's commands are these.

**Why this is one task and not three.** `web/` without the CI migration does not build in CI; the migration without `web/` changes nothing, because `detect` gates on `web/package.json`. A reviewer would accept or reject them together.

- [ ] **Step 1: The dependency versions — verified 2026-08-07, use these**

Re-checked against the registry on 2026-08-07. **One moved since the design's §6.1 table: `vite` 8.2.0 → 8.2.1.** Everything else in that table held. `playwright` and `@vitest/browser` had no figure in §6.1 because it predates the browser-tier decision; both are recorded here now.

| package | version |
| --- | --- |
| `vite` | **8.2.1** *(§6.1 said 8.2.0)* |
| `typescript` | 7.0.2 |
| `@biomejs/biome` | 2.5.7 |
| `vitest` | 4.1.10 |
| `@vitest/browser` | 4.1.10 *(pinned to `vitest`)* |
| `@vitest/browser-playwright` | 4.1.10 *(pinned to `vitest`)* |
| `playwright` | 1.62.1 |
| `@codemirror/state` | 6.7.1 |
| `@codemirror/view` | 6.43.8 |
| `@codemirror/commands` | 6.10.4 |
| `@codemirror/lint` | 6.9.7 |
| `@types/node` | 26.1.2 |
| pnpm | 11.20.0 |

Use these verbatim. If `pnpm install` reports any of them unresolvable, stop and report rather than floating the range.

- [ ] **Step 2: Write `web/package.json`**

```json
{
  "name": "redextape-web",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.20.0",
  "scripts": {
    "build:wasm": "wasm-pack build ../crates/redextape-wasm --release --target web --out-dir ../../pkg",
    "build:wasm:dev": "wasm-pack build ../crates/redextape-wasm --dev --target web --out-dir ../../pkg",
    "build:app": "vite build",
    "build": "pnpm run build:wasm && pnpm run build:app",
    "dev": "vite",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:node": "vitest run --project node",
    "test:browser": "vitest run --project browser"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.7",
    "@codemirror/commands": "6.10.4",
    "@codemirror/lint": "6.9.7",
    "@codemirror/search": "6.7.1",
    "@codemirror/state": "6.7.1",
    "@codemirror/view": "6.43.8",
    "@types/node": "26.1.2",
    "@vitest/browser": "4.1.10",
    "@vitest/browser-playwright": "4.1.10",
    "playwright": "1.62.1",
    "typescript": "7.0.2",
    "vite": "8.2.1",
    "vitest": "4.1.10"
  }
}
```

**`@codemirror/search` is dropped from §6.1's table.** Nothing in §6.3's scope uses it, and an installed-but-unimported dependency is precisely what pnpm's strict layout exists to make visible. Add it back in Plan 5 when a pane wants find-in-buffer.

**`build` and `build:app` are split on purpose.** The Dockerfile's stage 2 has no Rust toolchain — stage 1 builds the wasm and copies it to `/app/pkg` — so Docker runs `build:app`, while CI (which installs Rust and wasm-pack) runs `build`. The Dockerfile's current `npm run build` line therefore changes to `pnpm run build:app`, which is a deviation from the design's §6.4 sketch and is made here because that sketch would have Docker shelling out to a `wasm-pack` that is not in the image.

Adjust the version numbers to whatever Step 1 reported.

- [ ] **Step 3: Write `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["vite/client", "node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

- [ ] **Step 4: Write `web/biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.7/schema.json",
  "files": { "includes": ["src/**", "tests/**", "*.ts", "*.json"] },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120
  },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "asNeeded" } }
}
```

`lineWidth: 120` matches `rustfmt.toml`'s `max_width` so both halves of the repo wrap at the same column.

**`tsconfig`'s `lib` deliberately omits `WebWorker`.** Including it alongside `DOM` gives two conflicting declarations of `self` and `postMessage`, and `skipLibCheck` does not suppress a conflict between two libs. Task 9's worker declares the two members it actually uses instead, which is smaller and honest about the surface it depends on.

- [ ] **Step 5: Write `web/vite.config.ts`**

```ts
import { fileURLToPath } from 'node:url'
// `defineConfig` from `vitest/config`, NOT `vite` — Vitest's `declare module "vite"` augmentation
// that adds the `test` key is only visible to files that import it, so `vite`'s own `defineConfig`
// runs fine but fails `tsc --noEmit` with TS2769.
import { defineConfig } from 'vitest/config'
// Vitest 4 split the Playwright driver into its own package with a provider-factory API;
// `browser.provider` no longer accepts the bare string `'playwright'`.
import { playwright } from '@vitest/browser-playwright'

// `pkg/` is built to the REPO ROOT, one level above this Vite root, because the Dockerfile places
// stage 1's output at /app/pkg beside /app/web.
//
// ABSOLUTE, AND REPEATED ON THE BROWSER PROJECT. A relative `'..'` is not enough and its failure is
// remote from its cause: Vitest's browser mode stands up a nested Vite server and rebuilds
// `server.fs.allow` against THAT server's root, so a relative entry resolves somewhere else and the
// wasm fetch dies with "outside of Vite serving allow list" — while the identical config serves the
// same file correctly under a plain `vite dev`.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  server: { fs: { allow: [REPO_ROOT] } },
  worker: { format: 'es' },
  test: {
    // Root-only in Vitest 4 — `ProjectConfig` deliberately omits it. Remove once Task 10 is complete.
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/node/**/*.test.ts'],
        },
      },
      {
        server: { fs: { allow: [REPO_ROOT] } },
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
```

- [ ] **Step 6: Write `web/index.html` and a placeholder `web/src/main.ts`**

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>redextape</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <header class="bar">
      <span class="wordmark">redextape</span>
      <label class="encoding">
        encoding
        <select id="encoding"></select>
      </label>
    </header>
    <main>
      <section id="editor" class="pane"></section>
      <section id="results" class="pane results"></section>
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`web/src/main.ts` — a placeholder this task only needs in order to have something to bundle; Task 9 replaces it wholesale:

```ts
// Replaced in full by Task 9. Present so `vite build` has an entry point.
export {}
```

`web/src/style.css` is created in Task 4; for this task create it containing only `:root { color-scheme: light dark; }` so the `<link>` resolves and Biome has a non-empty rule to format.

- [ ] **Step 7: Let both projects pass with no test files**

**This task writes no tests, deliberately.** A scaffold has no behaviour to assert, and a placeholder test that asserts `1 + 1` would be a test that says nothing about the system — the thing this project's review rubric treats as a defect. Task 3 lands three real tests minutes later and is the actual proof that the runner works.

Add `passWithNoTests: true` to **both** project blocks in `vite.config.ts`, so `pnpm test` exits clean until Task 3:

```ts
{ test: { name: 'node', environment: 'node', include: ['tests/node/**/*.test.ts'], passWithNoTests: true } },
```

and the same key on the browser block. **Remove both once Task 10 is complete** — from then on, a project reporting no test files is a broken glob, not an empty tree, and should fail. Task 11 Step 3's final gate assumes they are gone.

- [ ] **Step 8: Install and build wasm once**

```bash
cd web && pnpm install
pnpm run build:wasm
```
Expected: `pkg/redextape_wasm.js`, `pkg/redextape_wasm.d.ts` and `pkg/redextape_wasm_bg.wasm` exist at the repo root. `pnpm install` writes `web/pnpm-lock.yaml`.

- [ ] **Step 9: Install the Chromium Playwright needs**

```bash
cd web && pnpm exec playwright install --with-deps chromium
```

- [ ] **Step 10: Verify the four commands**

```bash
cd web
pnpm exec biome ci --error-on-warnings src tests
pnpm run typecheck
pnpm test
pnpm run build
```
Expected: all four green; `pnpm run build` writes `web/dist/`.

- [ ] **Step 11: Migrate the `Dockerfile`**

Replace stage 2 of `Dockerfile` with:

```dockerfile
########################  2. Web bundle (Vite) → /app/web/dist  ################################
FROM node:26-slim AS web
WORKDIR /app/web
# pnpm pinned explicitly rather than via corepack, which is not bundled in every node image.
RUN npm install -g pnpm@11.20.0
# Manifest + lockfile first so this layer caches across source-only changes.
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
# The WASM package produced above, imported by the web app as `../pkg`.
COPY --from=wasm /app/pkg /app/pkg
ARG COMMIT_HASH
ENV COMMIT_HASH=$COMMIT_HASH
# `build:app`, not `build`: this stage has no Rust toolchain — stage 1 already produced /app/pkg.
RUN pnpm run build:app
```

Also delete the stale NOTE comment at the top of the file (lines 8–12), which says `crates/redextape-wasm` and `web/` do not yet exist. Replace it with a one-line statement that both now exist and CI builds this on every push to `main`.

- [ ] **Step 12: Migrate the `web` job in `.forgejo/workflows/ci.yml`**

Four changes, and one reordering that matters:

1. `npm ci` → `pnpm install --frozen-lockfile`, preceded by `npm install -g pnpm@11.20.0`.
2. The cache step's `path: ~/.npm` → the pnpm store, and `key: npm-${{ hashFiles('web/package-lock.json') }}` → `pnpm-${{ hashFiles('web/pnpm-lock.yaml') }}` with `restore-keys: pnpm-`.
3. `npx biome ci` → `pnpm exec biome ci`; `npm run X` → `pnpm run X`.
4. Add `pnpm exec playwright install --with-deps chromium` after the install step.

**The reordering: `pnpm run build:wasm` must run before `Typecheck`.** `tsc --noEmit` resolves `../pkg/redextape_wasm.js` against the generated `.d.ts`, which does not exist until wasm-pack has run. The job's current order typechecks first and would fail with `TS2307: Cannot find module`. New step order: install pnpm → install deps → `build:wasm` → playwright install → `biome ci` → `typecheck` → `test` → `build:app`.

Because `build:wasm` is now its own step, the final build step becomes `pnpm run build:app` and its comment ("invokes wasm-pack, then the bundler") moves to the `build:wasm` step.

- [ ] **Step 13: Migrate `.pre-commit-config.yaml`**

```yaml
      - id: biome-ci
        name: biome ci
        entry: bash -c 'cd web && pnpm exec biome ci --error-on-warnings src tests'
        language: system
        files: ^web/.*\.(js|ts|jsx|tsx|json|css)$
        pass_filenames: false
      - id: web-typecheck
        name: web typecheck
        entry: bash -c 'cd web && pnpm run typecheck'
        language: system
        files: ^web/.*\.(ts|tsx)$
        pass_filenames: false
```

Also update the header comment: the web hooks are no longer dormant, and `pnpm run typecheck` needs `pkg/` — so add a line saying a fresh clone runs `cd web && pnpm install && pnpm run build:wasm` once before committing TypeScript.

- [ ] **Step 14: Verify the hooks fire and pass**

```bash
pre-commit run --all-files
```
Expected: `cargo fmt`, `cargo clippy`, `biome ci`, `web typecheck` all pass. Web hooks now run for real rather than reporting Skipped.

- [ ] **Step 15: Commit**

```bash
git add web/ Dockerfile .forgejo/workflows/ci.yml .pre-commit-config.yaml
git commit -m "web: the pnpm scaffold, and the toolchain migration it arms"
```

---

### Task 3: `types.ts` and `protocol.ts` — the measured wire shapes

**Files:**
- Create: `web/src/types.ts`, `web/src/protocol.ts`
- Test: `web/tests/node/types.test.ts`

**Interfaces:**
- Produces: every type name used by Tasks 4–9. Exact names below.

- [ ] **Step 1: Write the failing test**

`web/tests/node/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decodedText, isValue } from '../../src/types'
import type { Decoded } from '../../src/types'

describe('Decoded', () => {
  it('reads a struct variant as a one-key object', () => {
    const d: Decoded = { Value: { text: '42' } }
    expect(isValue(d)).toBe(true)
    expect(decodedText(d)).toBe('42')
  })

  it('reads a unit variant as a bare string', () => {
    expect(isValue('Unfinished')).toBe(false)
    expect(decodedText('Unfinished')).toBe('not finished')
    expect(decodedText('Undecodable')).toBe('no encoding for this type')
  })

  it('reads a fault as a tagged object carrying its message', () => {
    expect(decodedText({ Fault: { message: 'budget exhausted' } })).toBe('fault: budget exhausted')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm exec vitest run --project node tests/node/types.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/types"`.

- [ ] **Step 3: Write `web/src/types.ts`**

```ts
// The wasm boundary's wire shapes, as TypeScript.
//
// EVERY SHAPE HERE IS MEASURED, not designed: `crates/redextape-wasm/tests/browser.rs` reads each one
// out of a real browser and pins it. Two of them look wrong and are not. `total_steps` is snake_case
// because serde does not rename. A fieldless enum variant crosses as the bare variant NAME, and a
// struct variant as a one-key object — so `Decoded` is a union of two strings and two objects rather
// than a discriminated union with a `kind` field.

export type Span = { start: number; end: number }

/// Every `TokenClass` variant, in the Rust enum's declaration order.
///
/// THE ARRAY IS THE SOURCE AND THE UNION IS DERIVED FROM IT, not the other way round. Written as a
/// standalone union with a separate array beside it, the two drift the moment a variant is added — and
/// they drift into agreement with each other, which is worse than disagreeing. Deriving means a name
/// missing from this array cannot be used anywhere in the app, and the compiler says so.
///
/// It still cannot verify itself against the RUST enum; that copy is by hand and this file's header
/// says so. `encodings()` was exported precisely because that hand-copy was avoidable for encoding
/// names. It is not avoidable here without a second export, which §6.3's scope does not carry — so the
/// residual risk is a variant added to `analysis::TokenClass` and not mirrored here, which shows up as
/// an unstyled span rather than an error. Recorded in the design spec's §12.
export const TOKEN_CLASSES = [
  'Ident',
  'Nat',
  'Bool',
  'Keyword',
  'Operator',
  'Punct',
  'Comment',
  'Binder',
  'Mnemonic',
  'Register',
  'Label',
  'StateName',
  'TapeSymbol',
  'Move',
] as const

export type TokenClass = (typeof TOKEN_CLASSES)[number]

export type Classified = [Span, TokenClass][]

export type Severity = 'Error' | 'Warning'
export type Diagnostic = { span: Span; severity: Severity; message: string }

export type RunStatus = 'Running' | 'Ended' | 'Capped' | 'DepthRefused'

export type Decoded = 'Unfinished' | 'Undecodable' | { Value: { text: string } } | { Fault: { message: string } }

export type LambdaStatus = {
  available: boolean
  reason: string
  node: number | null
  run: RunStatus | null
}

export type TmStatus = {
  available: boolean
  reason: string
  width: number | null
  run: RunStatus | null
  total_steps: number | null
}

export type LambdaState = { text: string; spans: Classified; truncated: boolean; step: number }

export function isValue(d: Decoded): d is { Value: { text: string } } {
  return typeof d === 'object' && 'Value' in d
}

/// A decoded answer as one line of display text.
///
/// `Undecodable` AND `Fault` ARE ANSWERS, not empty states: a normal form the decoder has no encoding
/// for is a fact about this pair of program and backend, and showing a blank field would hide it.
export function decodedText(d: Decoded): string {
  if (d === 'Unfinished') return 'not finished'
  if (d === 'Undecodable') return 'no encoding for this type'
  if ('Value' in d) return d.Value.text
  return `fault: ${d.Fault.message}`
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && pnpm exec vitest run --project node tests/node/types.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write `web/src/protocol.ts`**

No test of its own — it is types plus one constant, and Task 5 tests the client that uses it.

```ts
import type { Diagnostic, Decoded, LambdaState, LambdaStatus, Span, TmStatus } from './types'

/// How many β-steps the worker takes between yields.
///
/// `session.rs`'s own doc picks this figure: 5,000,000 steps at 50,000 per chunk is ~100 crossings
/// instead of five million, and one macrotask per chunk is what lets a superseded run be abandoned.
export const CHUNK_STEPS = 50_000

/// The λ printer's byte budget. Truncation is shown, not hidden — see `results.ts`.
export const LAMBDA_BYTE_BUDGET = 65_536

export type RunRequest = { kind: 'run'; gen: number; src: string; encoding: string }

/// `declinedSpan` IS RESOLVED IN THE WORKER, not on the main thread, because `sourceSpan` is a
/// `Session` method and the handle never leaves that thread. `LambdaStatus.node` alone would be
/// useless to a renderer that cannot ask what source range it names.
export type LambdaLeg = {
  status: LambdaStatus
  state: LambdaState | null
  value: Decoded | null
  declinedSpan: Span | null
}
export type TmLeg = { status: TmStatus; value: Decoded | null }

export type RunReply =
  /// The program did not analyze, so there is no session at all.
  | { kind: 'no-session'; gen: number; diagnostics: Diagnostic[] }
  /// A session existed and both legs were interrogated.
  | { kind: 'result'; gen: number; lambda: LambdaLeg; tm: TmLeg }
```

- [ ] **Step 6: Verify the whole node project and typecheck**

```bash
cd web && pnpm run typecheck && pnpm run test:node
```
Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add web/src/types.ts web/src/protocol.ts web/tests/node/types.test.ts
git commit -m "web: the measured wire shapes, as TypeScript"
```

---

### Task 4: `theme.ts` and the design tokens

**Files:**
- Create: `web/src/theme.ts`
- Modify: `web/src/style.css` (created empty in Task 2)
- Test: `web/tests/node/theme.test.ts`

**Interfaces:**
- Consumes: `TokenClass` and `TOKEN_CLASSES` from `types.ts` — the array is declared there because the union is derived from it.
- Produces: `tokenClassName(c: TokenClass): string` → `tok-keyword`, `tok-tapesymbol`, etc. Task 5 (`spans.ts`) calls it.

- [ ] **Step 1: Write the failing test**

`web/tests/node/theme.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tokenClassName } from '../../src/theme'
import { TOKEN_CLASSES } from '../../src/types'

const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8')

describe('token classes', () => {
  // NOT `toHaveLength(14)`. A hardcoded count is a second registry: add a fifteenth variant to the
  // Rust enum and both the list and the count stay at 14, agreeing with each other and with nothing
  // real. The union is DERIVED from this array (see `types.ts`), so the compiler enforces that every
  // name the rest of the app can use appears here — which is the completeness a count only pretends to.
  it('is the source the TokenClass union is derived from', () => {
    expect(new Set(TOKEN_CLASSES).size).toBe(TOKEN_CLASSES.length)
    expect(TOKEN_CLASSES.length).toBeGreaterThan(0)
  })

  it('lower-cases the variant name', () => {
    expect(tokenClassName('Keyword')).toBe('tok-keyword')
    expect(tokenClassName('TapeSymbol')).toBe('tok-tapesymbol')
  })

  // A future λ pane will emit Binder and Comment. An unstyled span is invisible rather than loud, so
  // the absence of a rule is exactly the kind of gap that would ship unnoticed — assert it instead.
  it('defines a CSS rule for every class', () => {
    const missing = TOKEN_CLASSES.filter((c) => !css.includes(`.${tokenClassName(c)}`))
    expect(missing).toEqual([])
  })

  it('styles both colour schemes', () => {
    expect(css).toContain('prefers-color-scheme: dark')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm exec vitest run --project node tests/node/theme.test.ts`
Expected: FAIL — cannot resolve `../../src/theme`.

- [ ] **Step 3: Write `web/src/theme.ts`**

```ts
import type { TokenClass } from './types'

/// A `TokenClass` as its CSS class name.
///
/// EVERY VARIANT GETS A RULE, including the eight this slice's source pane cannot produce.
/// `classify_source` reaches only six — Ident, Nat, Bool, Keyword, Operator, Punct — and the rest
/// belong to the λ and asm/TM text forms that Plan 5 renders. They are styled anyway because an
/// unstyled span is invisible rather than loud, so a missing rule is a defect that ships quietly.
/// `theme.test.ts` asserts the stylesheet covers `TOKEN_CLASSES` in full.
export function tokenClassName(c: TokenClass): string {
  return `tok-${c.toLowerCase()}`
}
```

**`TOKEN_CLASSES` is NOT declared here — it lives in `types.ts` (Task 3)**, because the `TokenClass` union is derived from it. Import it from there.

- [ ] **Step 4: Write `web/src/style.css`**

Replace the placeholder with the token set. Six classes carry deliberate colour; the other eight inherit a neutral that is still distinguishable from body text.

```css
/* Design tokens. A foundation for Plan 5's panes, not a visual identity — §7 of the design spec. */
:root {
  /* The one line here that is not a token. It tells the browser to render UA-drawn widgets — the
     encoding `<select>` is the only one in this slice — in the scheme the page is actually using.
     Without it a dark page gets a light dropdown, because `prefers-color-scheme` below restyles our
     own elements and cannot reach inside a native control. */
  color-scheme: light dark;

  --font-ui: ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;

  --step-0: 0.9375rem;
  --step-1: 1.0625rem;
  --step-2: 1.375rem;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 1rem;
  --space-4: 1.5rem;
  --radius: 6px;

  --bg: #fbfbfa;
  --bg-raised: #ffffff;
  --fg: #1c1b1a;
  --fg-dim: #6b6864;
  --rule: #e2dfda;
  --accent: #9a3412;

  --tok-neutral: #6b6864;
  --tok-keyword: #9a3412;
  --tok-ident: #1c1b1a;
  --tok-nat: #1d4ed8;
  --tok-bool: #1d4ed8;
  --tok-operator: #7c2d92;
  --tok-punct: #8a8681;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #17161a;
    --bg-raised: #1e1d22;
    --fg: #eceaf0;
    --fg-dim: #9a9599;
    --rule: #322f38;
    --accent: #f0956a;

    --tok-neutral: #9a9599;
    --tok-keyword: #f0956a;
    --tok-ident: #eceaf0;
    --tok-nat: #86b6ff;
    --tok-bool: #86b6ff;
    --tok-operator: #d6a2f0;
    --tok-punct: #6f6a74;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: var(--step-0)/1.5 var(--font-ui);
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--rule);
}

.wordmark { font-size: var(--step-1); font-weight: 600; letter-spacing: -0.01em; }
.encoding { color: var(--fg-dim); display: flex; align-items: center; gap: var(--space-2); }

main { display: grid; grid-template-rows: 1fr auto; height: calc(100dvh - 3rem); }

.pane { overflow: auto; }
.results {
  border-top: 1px solid var(--rule);
  background: var(--bg-raised);
  padding: var(--space-3);
  font-family: var(--font-mono);
  min-height: 12rem;
}

.results[data-state="running"] { opacity: 0.55; }

.row { display: grid; grid-template-columns: 4rem 7rem 1fr; gap: var(--space-2); padding: var(--space-1) 0; }
.row .leg { color: var(--accent); font-weight: 600; }
.row .label { color: var(--fg-dim); }
.row .value { white-space: pre-wrap; word-break: break-word; }
.note { color: var(--fg-dim); font-style: italic; }

/* The source range a backend's refusal names — `sourceSpan(status.node)`, resolved in the worker. */
.decline { background: color-mix(in oklab, var(--accent) 18%, transparent); border-radius: 2px; }

/* Six reachable from `classify_source`. */
.tok-keyword { color: var(--tok-keyword); font-weight: 600; }
.tok-ident { color: var(--tok-ident); }
.tok-nat { color: var(--tok-nat); }
.tok-bool { color: var(--tok-bool); }
.tok-operator { color: var(--tok-operator); }
.tok-punct { color: var(--tok-punct); }

/* Eight the λ and asm/TM text forms produce. Styled now so Plan 5 does not ship invisible spans. */
.tok-comment,
.tok-binder,
.tok-mnemonic,
.tok-register,
.tok-label,
.tok-statename,
.tok-tapesymbol,
.tok-move {
  color: var(--tok-neutral);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && pnpm exec vitest run --project node tests/node/theme.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/theme.ts web/src/style.css web/tests/node/theme.test.ts
git commit -m "web: design tokens, and a rule for every token class"
```

---

### Task 5: `spans.ts` — the pure half of highlighting

**Files:**
- Create: `web/src/spans.ts`
- Test: `web/tests/node/spans.test.ts`

**Interfaces:**
- Consumes: `Classified` from `types.ts`, `tokenClassName` from `theme.ts`.
- Produces: `decorationRanges(spans: Classified, docLength: number): { from: number; to: number; className: string }[]` — Task 7's `highlight.ts` feeds these into a `RangeSetBuilder`.

**Why a pure module rather than building `Decoration`s here.** `Decoration` lives in `@codemirror/view`. Keeping the ordering and clamping rules — the part that can actually be wrong — in a module that imports nothing from CodeMirror means they are tested in Node in milliseconds.

- [ ] **Step 1: Write the failing test**

`web/tests/node/spans.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decorationRanges } from '../../src/spans'
import type { Classified } from '../../src/types'

const at = (start: number, end: number, cls: Classified[number][1]): Classified[number] => [{ start, end }, cls]

describe('decorationRanges', () => {
  it('maps each span to its token class name', () => {
    const spans: Classified = [at(0, 3, 'Keyword'), at(4, 5, 'Ident')]
    expect(decorationRanges(spans, 20)).toEqual([
      { from: 0, to: 3, className: 'tok-keyword' },
      { from: 4, to: 5, className: 'tok-ident' },
    ])
  })

  it('returns nothing for an empty document', () => {
    expect(decorationRanges([], 0)).toEqual([])
  })

  // A RangeSetBuilder throws on out-of-order adds, and the lexer's order is an assumption rather than
  // a guarantee this module can see. Sorting here is cheaper than a crash in a StateField.
  it('sorts by start position', () => {
    const spans: Classified = [at(4, 5, 'Ident'), at(0, 3, 'Keyword')]
    expect(decorationRanges(spans, 20).map((r) => r.from)).toEqual([0, 4])
  })

  it('drops empty spans', () => {
    expect(decorationRanges([at(2, 2, 'Punct')], 20)).toEqual([])
  })

  // The document the spans were computed from and the document CodeMirror currently holds can differ
  // by one keystroke. A stale span past the end is a crash, so it is clamped rather than trusted.
  it('drops spans that start past the end of the document', () => {
    expect(decorationRanges([at(30, 33, 'Keyword')], 20)).toEqual([])
  })

  it('clamps a span that overruns the end of the document', () => {
    expect(decorationRanges([at(18, 25, 'Ident')], 20)).toEqual([{ from: 18, to: 20, className: 'tok-ident' }])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm exec vitest run --project node tests/node/spans.test.ts`
Expected: FAIL — cannot resolve `../../src/spans`.

- [ ] **Step 3: Write `web/src/spans.ts`**

```ts
import { tokenClassName } from './theme'
import type { Classified } from './types'

export type DecorationRange = { from: number; to: number; className: string }

/// `classify_source`'s output as ordered, in-bounds decoration ranges.
///
/// TWO RULES THAT LOOK LIKE PARANOIA AND ARE NOT. `RangeSetBuilder` throws on an out-of-order add, and
/// the lexer's ordering is an assumption this module cannot verify — so it sorts. And the document the
/// spans were computed from can be one keystroke behind the document CodeMirror holds, so a span past
/// the end is dropped or clamped rather than trusted.
export function decorationRanges(spans: Classified, docLength: number): DecorationRange[] {
  const out: DecorationRange[] = []
  for (const [span, cls] of spans) {
    const from = span.start
    const to = Math.min(span.end, docLength)
    if (from >= to) continue
    out.push({ from, to, className: tokenClassName(cls) })
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to)
  return out
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && pnpm exec vitest run --project node tests/node/spans.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/spans.ts web/tests/node/spans.test.ts
git commit -m "web: spans to decoration ranges, sorted and clamped"
```

---

### Task 6: `diagnostics.ts` — the pure half of linting

**Files:**
- Create: `web/src/diagnostics.ts`
- Test: `web/tests/node/diagnostics.test.ts`

**Interfaces:**
- Consumes: `Diagnostic` from `types.ts`.
- Produces: `lintRanges(ds: Diagnostic[], docLength: number): { from: number; to: number; severity: 'error' | 'warning'; message: string }[]` — Task 7's `lint.ts` returns these straight to `@codemirror/lint`.

- [ ] **Step 1: Write the failing test**

`web/tests/node/diagnostics.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { lintRanges } from '../../src/diagnostics'
import type { Diagnostic } from '../../src/types'

const d = (start: number, end: number, severity: Diagnostic['severity'], message: string): Diagnostic => ({
  span: { start, end },
  severity,
  message,
})

describe('lintRanges', () => {
  it('lower-cases both severities into CodeMirror severities', () => {
    const got = lintRanges([d(0, 3, 'Error', 'boom'), d(4, 6, 'Warning', 'hmm')], 20)
    expect(got.map((r) => r.severity)).toEqual(['error', 'warning'])
  })

  it('carries the message and the span through', () => {
    expect(lintRanges([d(2, 5, 'Error', 'expected an expression')], 20)).toEqual([
      { from: 2, to: 5, severity: 'error', message: 'expected an expression' },
    ])
  })

  it('returns nothing for a clean program', () => {
    expect(lintRanges([], 20)).toEqual([])
  })

  // A zero-width span is where the parser noticed something missing, and it is the common case for
  // `let x = ;`. CodeMirror renders nothing for from === to, so it is widened by one to stay visible.
  it('widens a zero-width span so the marker is visible', () => {
    expect(lintRanges([d(8, 8, 'Error', 'expected an expression')], 20)).toEqual([
      { from: 8, to: 9, severity: 'error', message: 'expected an expression' },
    ])
  })

  it('clamps a widened span at the end of the document', () => {
    expect(lintRanges([d(20, 20, 'Error', 'unexpected end of input')], 20)).toEqual([
      { from: 19, to: 20, severity: 'error', message: 'unexpected end of input' },
    ])
  })

  it('drops a diagnostic on an empty document rather than inventing a range', () => {
    expect(lintRanges([d(0, 0, 'Error', 'empty')], 0)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm exec vitest run --project node tests/node/diagnostics.test.ts`
Expected: FAIL — cannot resolve `../../src/diagnostics`.

- [ ] **Step 3: Write `web/src/diagnostics.ts`**

```ts
import type { Diagnostic } from './types'

export type LintRange = { from: number; to: number; severity: 'error' | 'warning'; message: string }

/// Core's `Diagnostic` as `@codemirror/lint`'s shape: `Span` renamed and `Severity` lower-cased.
///
/// THE ZERO-WIDTH CASE IS THE COMMON ONE, not an edge. `let x = ;` reports at the point the parser
/// noticed something missing, and CodeMirror renders nothing at all for `from === to` — so the marker
/// would silently not appear on the single most likely broken program. Widened by one, backwards at
/// the end of the document, and dropped only when there is no document to widen into.
export function lintRanges(ds: Diagnostic[], docLength: number): LintRange[] {
  const out: LintRange[] = []
  for (const d of ds) {
    let from = d.span.start
    let to = Math.min(d.span.end, docLength)
    if (from >= to) {
      if (docLength === 0) continue
      from = Math.min(from, docLength - 1)
      to = from + 1
    }
    out.push({ from, to, severity: d.severity === 'Error' ? 'error' : 'warning', message: d.message })
  }
  return out
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && pnpm exec vitest run --project node tests/node/diagnostics.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/diagnostics.ts web/tests/node/diagnostics.test.ts
git commit -m "web: diagnostics to lint ranges, with the zero-width case handled"
```

---

### Task 7: `results.ts` — the readout, and the two wordings that matter

**Files:**
- Create: `web/src/results.ts`
- Test: `web/tests/node/results.test.ts`

**Interfaces:**
- Consumes: `LambdaLeg`, `TmLeg` from `protocol.ts`; `decodedText` from `types.ts`.
- Produces: `resultRows(lambda: LambdaLeg, tm: TmLeg): Row[]` where `Row = { leg: string; label: string; value: string; note?: string }`, and `noSessionRows(diagnostics: Diagnostic[]): Row[]` — it takes the array, not a count, because only error-severity diagnostics withhold a session and it filters on severity itself. Task 10 renders these.

**The two rules this task exists to get right** (§4 and §6 of the spec):

1. **`total_steps` is a length only when the machine reached a final configuration, and `run` does not say whether it did.** `run` is the *cursor's* status and this slice never steps the TM cursor, so it reads `"Running"` for a run `compile` already finished. The signal is `tmValue()`: `Unfinished` means no final configuration exists anywhere.
2. **The capped wording must not name which cap.** `TmCursor` caps on the step budget and on the live-cell budget, and `trace.rs` records that no test can tell them apart — so "the 2,870-step cap" would be a guess stated as a fact.

- [ ] **Step 1: Write the failing test**

`web/tests/node/results.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { noSessionRows, resultRows } from '../../src/results'
import type { LambdaLeg, TmLeg } from '../../src/protocol'
import type { Diagnostic } from '../../src/types'

const okState = { text: 'λf. λx. f (f x)', spans: [], truncated: false, step: 7 }

const lambdaOk: LambdaLeg = {
  status: { available: true, reason: '', node: null, run: 'Ended' },
  state: okState,
  value: { Value: { text: '42' } },
  declinedSpan: null,
}

const tmOk: TmLeg = {
  status: { available: true, reason: '', width: 8, run: 'Running', total_steps: 2870 },
  value: { Value: { text: '42' } },
}

const find = (rows: ReturnType<typeof resultRows>, leg: string, label: string) =>
  rows.find((r) => r.leg === leg && r.label === label)

describe('resultRows — the happy path', () => {
  const rows = resultRows(lambdaOk, tmOk)

  it('shows the λ normal form, step count and value', () => {
    expect(find(rows, 'λ', 'normal form')?.value).toBe('λf. λx. f (f x)')
    expect(find(rows, 'λ', 'steps')?.value).toBe('7 β-steps')
    expect(find(rows, 'λ', 'value')?.value).toBe('42')
  })

  it('shows the TM fitted width, step count and value', () => {
    expect(find(rows, 'TM', 'width')?.value).toBe('8 cells')
    expect(find(rows, 'TM', 'steps')?.value).toBe('2,870 δ-steps')
    expect(find(rows, 'TM', 'value')?.value).toBe('42')
  })
})

describe('resultRows — truncation', () => {
  it('shows the text AND says it was cut, rather than choosing one', () => {
    const rows = resultRows({ ...lambdaOk, state: { ...okState, truncated: true } }, tmOk)
    const row = find(rows, 'λ', 'normal form')
    expect(row?.value).toBe('λf. λx. f (f x)')
    expect(row?.note).toBe('… truncated at 64 KiB')
  })
})

describe('resultRows — total_steps is read against tmValue, not against run', () => {
  // The pair `browser.rs` pins: a finished run reports run: "Running" because the CURSOR has not moved.
  it('calls it a length when a final configuration exists', () => {
    expect(find(resultRows(lambdaOk, tmOk), 'TM', 'steps')?.value).toBe('2,870 δ-steps')
  })

  it('calls it a cap when tmValue is Unfinished, even though run is identical', () => {
    const capped: TmLeg = { status: { ...tmOk.status }, value: 'Unfinished' }
    expect(find(resultRows(lambdaOk, capped), 'TM', 'steps')?.value).toBe('stopped after 2,870 δ-steps at a cap')
  })

  it('does not name which cap it hit', () => {
    const capped: TmLeg = { status: { ...tmOk.status }, value: 'Unfinished' }
    expect(find(resultRows(lambdaOk, capped), 'TM', 'steps')?.value).not.toContain('step cap')
  })
})

describe('resultRows — refusals', () => {
  it('shows the λ reason instead of the leg when the backend declines', () => {
    const declined: LambdaLeg = {
      status: {
        available: false,
        reason: 'a closure assigns a variable captured from an outer scope',
        node: 12,
        run: null,
      },
      state: null,
      value: null,
      declinedSpan: { start: 44, end: 45 },
    }
    const rows = resultRows(declined, tmOk)
    expect(find(rows, 'λ', 'declined')?.value).toBe('a closure assigns a variable captured from an outer scope')
    expect(find(rows, 'λ', 'normal form')).toBeUndefined()
    // The TM leg still answers — a declined backend is not a failed compile.
    expect(find(rows, 'TM', 'value')?.value).toBe('42')
  })

  it('shows the TM reason and no width when that backend declines', () => {
    const declined: TmLeg = {
      status: {
        available: false,
        reason: 'the machine this program needs is too large to build',
        width: null,
        run: null,
        total_steps: null,
      },
      value: null,
    }
    const rows = resultRows(lambdaOk, declined)
    expect(find(rows, 'TM', 'declined')?.value).toBe('the machine this program needs is too large to build')
    expect(find(rows, 'TM', 'width')).toBeUndefined()
  })

  // Capped and DepthRefused are worded differently because raising the cap helps only one of them,
  // and this slice has no button to offer — so the words are the whole distinction.
  it('distinguishes a spent budget from a depth refusal', () => {
    const capped: LambdaLeg = { ...lambdaOk, status: { ...lambdaOk.status, run: 'Capped' }, value: 'Unfinished' }
    expect(find(resultRows(capped, tmOk), 'λ', 'run')?.value).toBe('spent its step budget')

    const deep: LambdaLeg = { ...lambdaOk, status: { ...lambdaOk.status, run: 'DepthRefused' }, value: 'Unfinished' }
    expect(find(resultRows(deep, tmOk), 'λ', 'run')?.value).toBe('the term is deeper than the reducer allows')
  })

  it('reports a fault as a fault rather than as an empty value', () => {
    const faulted: LambdaLeg = { ...lambdaOk, value: { Fault: { message: 'budget exhausted' } } }
    expect(find(resultRows(faulted, tmOk), 'λ', 'value')?.value).toBe('fault: budget exhausted')
  })

  it('reports an undecodable normal form as an answer', () => {
    const undec: LambdaLeg = { ...lambdaOk, value: 'Undecodable' }
    expect(find(resultRows(undec, tmOk), 'λ', 'value')?.value).toBe('no encoding for this type')
  })
})

describe('noSessionRows', () => {
  const err = (message: string): Diagnostic => ({ span: { start: 0, end: 1 }, severity: 'Error', message })
  const warn = (message: string): Diagnostic => ({ span: { start: 0, end: 1 }, severity: 'Warning', message })

  it('says the program did not compile and how many errors there were', () => {
    expect(noSessionRows([err('a'), err('b')])).toEqual([{ leg: '', label: '', value: 'not compiled — 2 errors' }])
  })

  it('does not pluralize a single error', () => {
    expect(noSessionRows([err('a')])[0]?.value).toBe('not compiled — 1 error')
  })

  // `analyze` returns warnings too, and only an ERROR withholds the session. Counting the whole array
  // would report a number the user cannot reconcile with the markers in the gutter.
  it('counts only error-severity diagnostics', () => {
    expect(noSessionRows([err('a'), warn('b'), warn('c')])[0]?.value).toBe('not compiled — 1 error')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm exec vitest run --project node tests/node/results.test.ts`
Expected: FAIL — cannot resolve `../../src/results`.

- [ ] **Step 3: Write `web/src/results.ts`**

```ts
import type { LambdaLeg, TmLeg } from './protocol'
import { decodedText } from './types'
import type { Diagnostic, RunStatus } from './types'

export type Row = { leg: string; label: string; value: string; note?: string }

const n = (x: number) => x.toLocaleString('en-US')

/// How a λ run's end reads. `Running` produces no row — the worker only replies once the run ended.
///
/// `Capped` AND `DepthRefused` ARE WORDED DIFFERENTLY ON PURPOSE. Raising the cap helps the first and
/// provably cannot help the second, and this slice ships no button — so the wording carries the whole
/// distinction that `RunStatus` was split to preserve.
function runNote(run: RunStatus | null): string | null {
  switch (run) {
    case 'Capped':
      return 'spent its step budget'
    case 'DepthRefused':
      return 'the term is deeper than the reducer allows'
    default:
      return null
  }
}

function lambdaRows(l: LambdaLeg): Row[] {
  if (!l.status.available) return [{ leg: 'λ', label: 'declined', value: l.status.reason }]

  const rows: Row[] = []
  if (l.state) {
    const row: Row = { leg: 'λ', label: 'normal form', value: l.state.text }
    // The text is SHOWN as well as marked. Unlike `lambdaAst`'s `None`, a truncated printed term is a
    // prefix of the real one rather than a lie about its shape, and the value is unaffected either way.
    if (l.state.truncated) row.note = '… truncated at 64 KiB'
    rows.push(row)
    rows.push({ leg: 'λ', label: 'steps', value: `${n(l.state.step)} β-steps` })
  }
  const note = runNote(l.status.run)
  if (note) rows.push({ leg: 'λ', label: 'run', value: note })
  if (l.value) rows.push({ leg: 'λ', label: 'value', value: decodedText(l.value) })
  return rows
}

function tmRows(t: TmLeg): Row[] {
  if (!t.status.available) return [{ leg: 'TM', label: 'declined', value: t.status.reason }]

  const rows: Row[] = []
  if (t.status.width !== null) rows.push({ leg: 'TM', label: 'width', value: `${n(t.status.width)} cells` })

  if (t.status.total_steps !== null) {
    // `total_steps` IS A LENGTH ONLY WHEN A FINAL CONFIGURATION EXISTS, AND `run` DOES NOT SAY WHETHER
    // ONE DOES — it reports where the CURSOR stands, and nothing here steps the cursor, so it reads
    // "Running" for a run `compile` already finished. `tmValue()` is the signal: `Unfinished` means no
    // halted run was recorded and the cursor has not halted either.
    //
    // AND THE CAPPED WORDING DOES NOT NAME THE CAP. `TmCursor` caps on the step budget and on the
    // live-cell budget; `trace.rs` records that no test can tell those two apart, and under the cell
    // cap this count lands well below the step budget. "The 2,870-step cap" would be a guess.
    const finished = t.value !== null && t.value !== 'Unfinished'
    rows.push({
      leg: 'TM',
      label: 'steps',
      value: finished
        ? `${n(t.status.total_steps)} δ-steps`
        : `stopped after ${n(t.status.total_steps)} δ-steps at a cap`,
    })
  }

  if (t.value) rows.push({ leg: 'TM', label: 'value', value: decodedText(t.value) })
  return rows
}

export function resultRows(lambda: LambdaLeg, tm: TmLeg): Row[] {
  return [...lambdaRows(lambda), ...tmRows(tm)]
}

/// ONLY ERROR-SEVERITY DIAGNOSTICS ARE COUNTED. `analyze` returns warnings too, and only an error
/// withholds the session — counting the whole array would report a number the user cannot reconcile
/// with the markers in the gutter.
export function noSessionRows(diagnostics: Diagnostic[]): Row[] {
  const errors = diagnostics.filter((d) => d.severity === 'Error').length
  return [{ leg: '', label: '', value: `not compiled — ${n(errors)} ${errors === 1 ? 'error' : 'errors'}` }]
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && pnpm exec vitest run --project node tests/node/results.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/results.ts web/tests/node/results.test.ts
git commit -m "web: the results readout, with total_steps read against tmValue"
```

---

### Task 8: `session-client.ts` — the generation counter

**Files:**
- Create: `web/src/session-client.ts`
- Test: `web/tests/node/session-client.test.ts`

**Interfaces:**
- Consumes: `RunRequest`, `RunReply` from `protocol.ts`.
- Produces: `class SessionClient { constructor(port: ClientPort, onReply: (r: RunReply) => void); request(src: string, encoding: string): void }` and `type ClientPort = { postMessage(m: RunRequest): void; addEventListener(t: 'message', h: (e: { data: RunReply }) => void): void }`. Task 10's `main.ts` constructs it over a real `Worker`.

**Why this is separable from `postMessage`.** The staleness rule is the only logic here, and a `Worker` is not needed to exercise it — a two-method object is. That is the whole reason the port is an interface rather than a `Worker`.

- [ ] **Step 1: Write the failing test**

`web/tests/node/session-client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { SessionClient } from '../../src/session-client'
import type { ClientPort } from '../../src/session-client'
import type { RunReply, RunRequest } from '../../src/protocol'

function fakePort() {
  const sent: RunRequest[] = []
  let handler: ((e: { data: RunReply }) => void) | null = null
  const port: ClientPort = {
    postMessage: (m) => sent.push(m),
    addEventListener: (_t, h) => {
      handler = h
    },
  }
  return { port, sent, deliver: (data: RunReply) => handler?.({ data }) }
}

const reply = (gen: number): RunReply => ({ kind: 'no-session', gen, diagnostics: [] })

describe('SessionClient', () => {
  it('stamps each request with a fresh generation', () => {
    const { port, sent } = fakePort()
    const c = new SessionClient(port, () => {})
    c.request('a', 'unary')
    c.request('b', 'unary')
    expect(sent.map((m) => m.gen)).toEqual([1, 2])
    expect(sent[1]).toEqual({ kind: 'run', gen: 2, src: 'b', encoding: 'unary' })
  })

  it('delivers a reply whose generation is current', () => {
    const { port, deliver } = fakePort()
    const onReply = vi.fn()
    const c = new SessionClient(port, onReply)
    c.request('a', 'unary')
    deliver(reply(1))
    expect(onReply).toHaveBeenCalledTimes(1)
  })

  it('drops a reply from a superseded generation', () => {
    const { port, deliver } = fakePort()
    const onReply = vi.fn()
    const c = new SessionClient(port, onReply)
    c.request('a', 'unary')
    c.request('b', 'unary')
    deliver(reply(1))
    expect(onReply).not.toHaveBeenCalled()
    deliver(reply(2))
    expect(onReply).toHaveBeenCalledTimes(1)
  })

  // The worker abandons superseded work at a chunk boundary; a reply already in flight when the next
  // request is posted slips past that check. This is the second guard, and it is why there are two.
  it('drops an out-of-order reply that arrives after a newer one', () => {
    const { port, deliver } = fakePort()
    const onReply = vi.fn()
    const c = new SessionClient(port, onReply)
    c.request('a', 'unary')
    c.request('b', 'unary')
    deliver(reply(2))
    deliver(reply(1))
    expect(onReply).toHaveBeenCalledTimes(1)
    expect(onReply.mock.calls[0]?.[0]).toEqual(reply(2))
  })

  it('ignores a reply that arrives before any request', () => {
    const { port, deliver } = fakePort()
    const onReply = vi.fn()
    new SessionClient(port, onReply)
    deliver(reply(0))
    expect(onReply).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm exec vitest run --project node tests/node/session-client.test.ts`
Expected: FAIL — cannot resolve `../../src/session-client`.

- [ ] **Step 3: Write `web/src/session-client.ts`**

```ts
import type { RunReply, RunRequest } from './protocol'

/// What the client needs from a `Worker`, and nothing more.
///
/// AN INTERFACE RATHER THAN `Worker` SO THE RULE BELOW IS TESTABLE. The staleness check is the only
/// logic in this file and it does not need a thread to exercise — it needs an object with two methods.
export type ClientPort = {
  postMessage(m: RunRequest): void
  addEventListener(type: 'message', handler: (e: { data: RunReply }) => void): void
}

export class SessionClient {
  #gen = 0
  #port: ClientPort

  constructor(port: ClientPort, onReply: (r: RunReply) => void) {
    this.#port = port
    port.addEventListener('message', (e) => {
      // THE SECOND OF TWO GUARDS AGAINST THE SAME HAZARD, and both are needed. The worker abandons
      // superseded work at a chunk boundary so it does not compute results nobody wants; this drops
      // a reply that was already in flight when the next request was posted, which the worker's own
      // check cannot see. Generation 0 is "no request yet" and matches nothing.
      if (this.#gen !== 0 && e.data.gen === this.#gen) onReply(e.data)
    })
  }

  request(src: string, encoding: string): void {
    this.#gen += 1
    this.#port.postMessage({ kind: 'run', gen: this.#gen, src, encoding })
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && pnpm exec vitest run --project node tests/node/session-client.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the whole node project**

Run: `cd web && pnpm run test:node && pnpm run typecheck`
Expected: green — 38 tests across six files (types 3, theme 4, spans 6, diagnostics 6, results 14, session-client 5).

- [ ] **Step 6: Commit**

```bash
git add web/src/session-client.ts web/tests/node/session-client.test.ts
git commit -m "web: the generation counter, and why there are two guards"
```

---

### Task 9: `session-worker.ts` — the Session, off the main thread

**Files:**
- Create: `web/src/session-worker.ts`
- Test: `web/tests/browser/worker.test.ts`

**Interfaces:**
- Consumes: `RunRequest`, `RunReply`, `CHUNK_STEPS`, `LAMBDA_BYTE_BUDGET` from `protocol.ts`; `init`, `compile` from `../../pkg/redextape_wasm.js`.
- Produces: a module worker that answers a `RunRequest` with a `RunReply`. Task 10 constructs it.

- [ ] **Step 1: Write the failing test**

`web/tests/browser/worker.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { RunReply, RunRequest } from '../../src/protocol'

function ask(req: RunRequest, timeoutMs = 30_000): Promise<RunReply> {
  const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
  return new Promise<RunReply>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('the worker did not reply in time'))
    }, timeoutMs)
    worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
      clearTimeout(timer)
      worker.terminate()
      resolve(e.data)
    })
    worker.postMessage(req)
  })
}

const run = (src: string, gen = 1, encoding = 'unary'): RunRequest => ({ kind: 'run', gen, src, encoding })

describe('session-worker', () => {
  it('drives the λ leg to a normal form and decodes both legs', async () => {
    const reply = await ask(run('let x = 40; x + 2'))
    expect(reply.kind).toBe('result')
    if (reply.kind !== 'result') return

    expect(reply.gen).toBe(1)
    expect(reply.lambda.status.run).toBe('Ended')
    expect(reply.lambda.state?.step).toBe(7)
    expect(reply.lambda.value).toEqual({ Value: { text: '42' } })
    expect(reply.tm.status.total_steps).toBe(2870)
    expect(reply.tm.value).toEqual({ Value: { text: '42' } })
  })

  it('answers no-session with diagnostics for a program that does not analyze', async () => {
    const reply = await ask(run('let x = ;'))
    expect(reply.kind).toBe('no-session')
    if (reply.kind !== 'no-session') return
    expect(reply.diagnostics.length).toBeGreaterThan(0)
    expect(reply.diagnostics[0]?.severity).toBe('Error')
  })

  it('still answers for the TM leg when the λ backend declines', async () => {
    const src = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'
    const reply = await ask(run(src))
    expect(reply.kind).toBe('result')
    if (reply.kind !== 'result') return
    expect(reply.lambda.status.available).toBe(false)
    expect(reply.lambda.status.reason).not.toBe('')
    expect(reply.tm.status.available).toBe(true)
    expect(reply.tm.value).toEqual({ Value: { text: '0' } })
  })

  // `sourceSpan` is a Session method, so only the worker can turn `status.node` into a range. Without
  // this the refusal names a node the main thread has no way to look up.
  it('resolves the refused node to a source span', async () => {
    const src = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'
    const reply = await ask(run(src))
    expect(reply.kind).toBe('result')
    if (reply.kind !== 'result') return
    expect(reply.lambda.status.node).not.toBeNull()
    expect(reply.lambda.declinedSpan).not.toBeNull()
    const span = reply.lambda.declinedSpan
    if (!span) return
    expect(span.end).toBeGreaterThan(span.start)
    expect(span.end).toBeLessThanOrEqual(src.length)
  })

  it('carries the generation back unchanged', async () => {
    const reply = await ask(run('let x = 40; x + 2', 7))
    expect(reply.gen).toBe(7)
  })
})
```

The third test's expected TM value is the answer `apply0(f)` produces. **Run it and read the actual value before asserting it** — if it differs, correct the expectation rather than the program, and note the real value in the task report.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/worker.test.ts`
Expected: FAIL — cannot resolve `../../src/session-worker.ts`.

- [ ] **Step 3: Write `web/src/session-worker.ts`**

```ts
/// The worker that owns the `Session`.
///
/// THE HANDLE CANNOT LEAVE THIS THREAD. `Session` is an opaque wasm-bindgen object with no serialized
/// form, so the worker owns it and answers questions about it rather than handing it over. That is
/// also why `classifySource` and `analyze` are NOT here: they are free functions, they are what the
/// editor calls on every keystroke, and a round trip per keystroke is exactly the lag this split
/// exists to avoid.
import init, { compile } from '../../pkg/redextape_wasm.js'
import { CHUNK_STEPS, LAMBDA_BYTE_BUDGET } from './protocol'
import type { LambdaLeg, RunReply, RunRequest, TmLeg } from './protocol'
import type { Decoded, Diagnostic, LambdaState, LambdaStatus, RunStatus, Span, TmStatus } from './types'

/// The wasm-bindgen `Session`, described structurally — `pkg`'s generated declarations type every
/// method's return as `any`, so the shapes have to be asserted somewhere, and once is here.
type Session = {
  lambdaStatus(): LambdaStatus
  lambdaState(byteBudget: number): LambdaState
  lambdaValue(): Decoded
  runLambda(budget: number): RunStatus
  tmStatus(): TmStatus
  tmValue(): Decoded
  sourceSpan(node: number): Span | null
  free(): void
}

type CompileResult = { diagnostics: Diagnostic[]; session: Session | null }

/// Exactly what this worker uses of its global scope.
///
/// DECLARED RATHER THAN PULLED FROM THE `WebWorker` LIB, because that lib and `DOM` declare `self` and
/// `postMessage` incompatibly and `skipLibCheck` does not reconcile two libs.
type WorkerScope = {
  addEventListener(type: 'message', handler: (e: MessageEvent<RunRequest>) => void): void
  postMessage(message: RunReply): void
}
const ctx = self as unknown as WorkerScope

const ready = init()

/// The newest generation this worker has been asked for. A run whose generation is no longer this one
/// is abandoned at the next chunk boundary — see `drive`.
let latest = 0

/// One macrotask. `queueMicrotask` would NOT do: a microtask runs before the message queue is drained,
/// so a newer request would never be seen and the abandon check could not fire.
const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0))

/// Advance the λ leg in chunks, abandoning if a newer request has landed.
///
/// Returns `null` when abandoned. `false` from a status check is not enough to decide anything here —
/// the loop watches for `Running`, which is the only status that means "there is more to do".
async function drive(session: Session, gen: number): Promise<RunStatus | null> {
  for (;;) {
    const status = session.runLambda(CHUNK_STEPS)
    if (status !== 'Running') return status
    await yieldToEventLoop()
    if (latest !== gen) return null
  }
}

function lambdaLeg(session: Session): LambdaLeg {
  const status = session.lambdaStatus()
  if (!status.available) {
    // `sourceSpan` IS RESOLVED HERE because the handle cannot leave this thread. A refusal that names
    // a node the main thread cannot look up would highlight nothing.
    const declinedSpan = status.node === null ? null : session.sourceSpan(status.node)
    return { status, state: null, value: null, declinedSpan }
  }
  return {
    status,
    state: session.lambdaState(LAMBDA_BYTE_BUDGET),
    value: session.lambdaValue(),
    declinedSpan: null,
  }
}

function tmLeg(session: Session): TmLeg {
  const status = session.tmStatus()
  if (!status.available) return { status, value: null }
  return { status, value: session.tmValue() }
}

ctx.addEventListener('message', async (e: MessageEvent<RunRequest>) => {
  const req = e.data
  if (req.kind !== 'run') return
  latest = req.gen
  await ready

  // `compile` RUNS THE WHOLE TM LEG and is one uninterruptible call. Off the main thread that can only
  // delay the next result — it can never block input, highlighting or linting, which is the entire
  // reason the Session lives here.
  const { diagnostics, session } = compile(req.src, req.encoding) as CompileResult

  if (session === null) {
    ctx.postMessage({ kind: 'no-session', gen: req.gen, diagnostics })
    return
  }

  // GUARDED, BECAUSE `runLambda` THROWS RATHER THAN REPORTING WHEN THE LEG IS ABSENT. A program the λ
  // backend declines still has a TM leg worth reporting, but `run_lambda` answers
  // `Err(SessionError::LambdaAbsent)` and the wasm binding raises that as a JS exception — which
  // rejects this handler, so no reply is ever posted and the caller waits forever. Do not remove this
  // as redundant with `lambdaLeg`'s own `available` check; they guard different calls.
  if (session.lambdaStatus().available) {
    const outcome = await drive(session, req.gen)
    if (outcome === null) {
      // Superseded. Free the handle and say nothing — a newer request is already in flight, and the
      // client would drop this reply anyway.
      session.free()
      return
    }
  }

  ctx.postMessage({ kind: 'result', gen: req.gen, lambda: lambdaLeg(session), tm: tmLeg(session) })
  session.free()
})
```

**Check `pkg/redextape_wasm.d.ts` before writing the `CompileResult` assertion.** If wasm-pack's generated declaration already gives `compile` a usable return type, use it and delete the local type. If it returns `any` — which is what the current export signature produces — the assertion above is the honest way to state the shape once.

- [ ] **Step 4: Run the browser test to verify it passes**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/worker.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/session-worker.ts web/tests/browser/worker.test.ts
git commit -m "web: the Session in a worker, chunked and abandonable"
```

---

### Task 10: `main.ts`, the CodeMirror extensions, and the end-to-end smoke

**Files:**
- Create: `web/src/highlight.ts`, `web/src/lint.ts`, `web/src/main.ts` (replacing the Task 2 placeholder)
- Test: `web/tests/browser/app.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–9.
- Produces: the running app.

- [ ] **Step 1: Write `web/src/highlight.ts`**

```ts
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { decorationRanges } from './spans'
import type { Classified, Span } from './types'

/// Carries a fresh classification into the editor's state.
export const setSpans = StateEffect.define<Classified>()

function build(spans: Classified, docLength: number): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  for (const { from, to, className } of decorationRanges(spans, docLength)) {
    b.add(from, to, Decoration.mark({ class: className }))
  }
  return b.finish()
}

/// Highlighting via DECORATIONS, not a Lezer grammar.
///
/// A grammar would be a second authoritative grammar for this language, which the roadmap forbids
/// outright — and it would be redundant, because `classify_source` already ships and already returns
/// the spans. What a grammar would additionally buy (incremental re-parse, bracket matching,
/// structural folding) is not in v1 scope.
export const highlighting = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setSpans)) return build(e.value, tr.state.doc.length)
    }
    // No fresh classification this transaction: move what we have so it stays attached to its text.
    return tr.docChanged ? deco.map(tr.changes) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

/// The source range a backend's refusal names, or `null` to clear it.
export const setDecline = StateEffect.define<Span | null>()

/// A backend's refusal, marked where it happened.
///
/// A SEPARATE FIELD FROM `highlighting` because it changes on a different clock — highlighting on every
/// keystroke, this only when a compile comes back. Folding them together would mean recomputing one
/// whenever the other moved.
export const declineMark = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setDecline)) continue
      const span = e.value
      if (!span) return Decoration.none
      const from = Math.min(span.start, tr.state.doc.length)
      const to = Math.min(span.end, tr.state.doc.length)
      if (from >= to) return Decoration.none
      return Decoration.set([Decoration.mark({ class: 'decline' }).range(from, to)])
    }
    return tr.docChanged ? deco.map(tr.changes) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
```

Add `Span` to the `types` import at the top of the file.

- [ ] **Step 2: Write `web/src/lint.ts`**

```ts
import { linter } from '@codemirror/lint'
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import { lintRanges } from './diagnostics'
import type { Diagnostic } from './types'

/// `analyze()` as a CodeMirror lint source.
///
/// SYNCHRONOUS AND ON THE MAIN THREAD, for the same reason as highlighting: markers must appear while
/// the program is mid-edit and unparseable, which is exactly when a compile has nothing to say.
export function lintFromAnalyze(analyze: (src: string) => Diagnostic[]): Extension {
  return linter((view) => {
    const doc = view.state.doc.toString()
    return lintRanges(analyze(doc), doc.length).map(
      (r): CmDiagnostic => ({ from: r.from, to: r.to, severity: r.severity, message: r.message }),
    )
  })
}
```

- [ ] **Step 3: Write `web/src/main.ts`**

```ts
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { lintGutter } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import init, { analyze, classifySource, encodings } from '../../pkg/redextape_wasm.js'
import { declineMark, highlighting, setDecline, setSpans } from './highlight'
import { lintFromAnalyze } from './lint'
import { noSessionRows, resultRows } from './results'
import type { Row } from './results'
import { SessionClient } from './session-client'
import type { RunReply } from './protocol'
import type { Classified, Diagnostic } from './types'

const DEBOUNCE_MS = 300
const SAMPLE = 'let x = 40; x + 2'

function renderRows(host: HTMLElement, rows: Row[]): void {
  host.replaceChildren(
    ...rows.map((r) => {
      const el = document.createElement('div')
      el.className = 'row'
      const leg = document.createElement('span')
      leg.className = 'leg'
      leg.textContent = r.leg
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = r.label
      const value = document.createElement('span')
      value.className = 'value'
      value.textContent = r.value
      if (r.note) {
        const note = document.createElement('div')
        note.className = 'note'
        note.textContent = r.note
        value.append(note)
      }
      el.append(leg, label, value)
      return el
    }),
  )
}

async function main(): Promise<EditorView> {
  await init()

  const results = document.querySelector<HTMLElement>('#results')
  const editorHost = document.querySelector<HTMLElement>('#editor')
  const picker = document.querySelector<HTMLSelectElement>('#encoding')
  if (!results || !editorHost || !picker) throw new Error('the page is missing a mount point')

  // The list comes from the registry, not from a TypeScript array — see `encodings()`.
  for (const name of encodings() as string[]) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    picker.append(opt)
  }

  // Declared before the client so its callback can reach the editor; assigned once the view exists.
  let view: EditorView

  const worker = new Worker(new URL('./session-worker.ts', import.meta.url), { type: 'module' })
  const client = new SessionClient(worker, (reply: RunReply) => {
    results.dataset.state = 'idle'
    if (reply.kind === 'no-session') {
      renderRows(results, noSessionRows(reply.diagnostics))
      view.dispatch({ effects: setDecline.of(null) })
      return
    }
    renderRows(results, resultRows(reply.lambda, reply.tm))
    view.dispatch({ effects: setDecline.of(reply.lambda.declinedSpan) })
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (src: string) => {
    clearTimeout(timer)
    results.dataset.state = 'running'
    timer = setTimeout(() => client.request(src, picker.value), DEBOUNCE_MS)
  }

  view = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: SAMPLE,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        highlighting,
        declineMark,
        lintGutter(),
        lintFromAnalyze((src) => analyze(src) as Diagnostic[]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          const src = u.state.doc.toString()
          // Synchronous, in the same frame as the keystroke. This is the whole reason `classifySource`
          // is not behind the worker.
          u.view.dispatch({ effects: setSpans.of(classifySource(src) as Classified) })
          schedule(src)
        }),
      ],
    }),
  })

  view.dispatch({ effects: setSpans.of(classifySource(SAMPLE) as Classified) })
  schedule(SAMPLE)
  return view
}

/// The app starts on import — `index.html` loads this module and nothing else.
///
/// THE VIEW IS EXPORTED AS A PROMISE so the browser tests can drive the editor through CodeMirror's own
/// API rather than synthesizing key events into a contenteditable. Nothing in the product reads it.
export const ready = main()
```

- [ ] **Step 4: Write the end-to-end browser test**

`web/tests/browser/app.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main><section id="editor" class="pane"></section><section id="results" class="pane results"></section></main>`

const LAMBDA_DECLINES = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'

let view: EditorView

async function until(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error('timed out waiting for the app')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const resultsText = () => document.querySelector('#results')?.textContent ?? ''

/// Replace the whole buffer, exactly as a user retyping it would.
function retype(src: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
}

describe('the app, end to end', () => {
  // ONE MOUNT FOR THE FILE. ES module imports are cached, so `main()` runs once per page and Vitest
  // gives each test FILE its own page — mounting per test would silently reuse the first app.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  it('highlights keywords synchronously and reports both legs', async () => {
    retype('let x = 40; x + 2')

    // Highlighting does not wait for the worker — it is applied in the same dispatch as the document.
    expect(document.querySelector('.tok-keyword')?.textContent).toBe('let')

    await until(() => resultsText().includes('β-steps'))
    expect(resultsText()).toContain('7 β-steps')
    expect(resultsText()).toContain('2,870 δ-steps')
    expect(resultsText()).toContain('42')
  })

  it('populates the encoding picker from the registry', () => {
    const names = [...document.querySelectorAll('#encoding option')].map((o) => o.textContent)
    expect(names).toContain('unary')
    expect(names).toContain('binary')
  })

  it('lints a broken program and says it did not compile', async () => {
    retype('let x = ;')
    await until(() => resultsText().includes('not compiled'))
    expect(resultsText()).toContain('not compiled')
    // `lintGutter` renders its marker asynchronously, after the lint source resolves.
    await until(() => document.querySelectorAll('.cm-lintRange, .cm-lint-marker').length > 0)
  })

  it('shows the λ refusal, marks where it happened, and still answers for TM', async () => {
    retype(LAMBDA_DECLINES)
    await until(() => resultsText().includes('declined'))
    expect(resultsText()).toContain('closure')
    // The TM leg still answers — a declined backend is not a failed compile.
    expect(resultsText()).toContain('δ-steps')
    // `sourceSpan(status.node)`, resolved in the worker and marked here.
    await until(() => document.querySelectorAll('.decline').length > 0)
  })
})
```

**The lint-marker selector is a guess and must be checked.** `@codemirror/lint` renders underlines and gutter markers under class names that have changed across 6.x releases. Before asserting, open the app, break the program, and read the actual class off the rendered element in devtools — then use that. Do not weaken the assertion to "something rendered"; the point of this test is that the marker appears.

- [ ] **Step 5: Run the browser project**

Run: `cd web && pnpm run test:browser`
Expected: PASS — 5 worker tests + 4 app tests.

- [ ] **Step 6: Run everything**

```bash
cd web
pnpm exec biome ci --error-on-warnings src tests
pnpm run typecheck
pnpm test
pnpm run build
```
Expected: all green.

- [ ] **Step 7: Look at it**

```bash
cd web && pnpm run dev
```
Open the printed URL. Confirm by eye: `let` is coloured, the results pane shows both legs, editing to `let x = ;` produces a lint underline and "not compiled", and typing quickly does not stutter.

- [ ] **Step 8: Commit**

```bash
git add web/src/highlight.ts web/src/lint.ts web/src/main.ts web/tests/browser/app.test.ts
git commit -m "web: the editor, the debounce, and the end-to-end smoke"
```

---

### Task 11: The record — README and the roadmap entry

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Update `README.md`**

Read the existing web/build sections first and update them in place. Three things must become true rather than aspirational: `web/` exists, the package manager is pnpm, and a fresh clone needs `cd web && pnpm install && pnpm run build:wasm` once before `pnpm run dev` or `pnpm run typecheck` will work. Also state that pushing to `main` now builds and pushes the image.

- [ ] **Step 2: Add the roadmap entry**

Append a PR 3c entry in the same voice as the PR 3a and 3b entries above it (`grep -n "PR 3b of the five-PR landing order" docs/superpowers/plans/2026-07-19-redextape-roadmap.md` to find the model). It must record, at minimum:

- **The five-PR landing order is complete.** This was the last.
- **The eighth export.** The slice shipped `encodings()`, one more than a web-only PR implied, and why.
- **Two ambiguities in §6.3, resolved rather than interpreted silently.** The TM leg has no text normal form, so it reports width, δ-steps and value; and `total_steps` is read against `tmValue()` rather than against `run`, because `run` tracks the cursor and nothing in this slice steps the TM cursor. Cite the `browser.rs` pair (`total_steps == 2870` with `run == "Running"`) as the evidence.
- **The `lambdaAst` verdict is deferred, not answered**, and travels to Plan 5 along with the deletion question the arena design's §9.3 came close to taking.
- **The gate:** `scripts/check-all.sh --no-llvm` green, browser suite 11/11, `pnpm test` counts for both vitest projects, `pnpm run build` succeeding, and the wasm bundle size against PR #15's 605,193 bytes.
- **`compile()`'s wall-clock is still unmeasured** (open risk 1), now measurable for the first time.

- [ ] **Step 3: Verify the whole gate one last time**

```bash
scripts/check-all.sh --no-llvm
wasm-pack test --headless --chrome crates/redextape-wasm
cd web && pnpm exec biome ci --error-on-warnings src tests && pnpm run typecheck && pnpm test && pnpm run build
pre-commit run --all-files
```
Expected: every command green. Record the actual numbers — test counts and the `pkg/redextape_wasm_bg.wasm` byte size — for the roadmap entry and the PR body.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "docs: the PR 3c record, and the README a fresh clone needs"
```

---

## Verification

Before opening the PR, all of these must be true and observed rather than assumed:

- [ ] `scripts/check-all.sh --no-llvm` green
- [ ] `wasm-pack test --headless --chrome crates/redextape-wasm` — 11/11
- [ ] `cd web && pnpm test` — both projects green: 38 node, 9 browser
- [ ] `passWithNoTests` removed from both project blocks in `vite.config.ts` (Task 2 Step 7)
- [ ] `cd web && pnpm run typecheck` green
- [ ] `cd web && pnpm exec biome ci --error-on-warnings src tests` green
- [ ] `cd web && pnpm run build` writes `web/dist/`
- [ ] `pre-commit run --all-files` green, with the web hooks running rather than skipping
- [ ] The app looked at by eye in `pnpm run dev` (Task 10 Step 7)
- [ ] The wasm bundle size recorded against PR #15's 605,193 bytes

**Do not merge without confirming the `docker` consequence with the owner.** Landing `web/package.json` arms the `docker` job on every push to `main`, which builds and pushes an image to `forge.daveynet.xyz`. §6.5 of the plan-4 design records this as intended and confirmed, but it is the one irreversible effect of the merge and is worth naming in the PR body.
