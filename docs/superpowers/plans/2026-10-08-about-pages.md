# About, help, licences and privacy pages — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four static pages beside the app — about, help, licences, privacy — reached from an `about ▾` header menu,
showing the deployed commit and a copyright year from the viewer's clock, with third-party licence notices generated
into a committed file that a new check holds to the lockfiles.

**Architecture:** Each page is an HTML entry Vite builds beside `index.html`; they share `style.css`, a small
`pages.css`, one footer filled by `src/pages.ts`, and the pre-paint script, which moves into `src/prepaint.ts` and is
inlined into every page's `<head>` by a Vite plugin. `src/build-info.ts` turns the `COMMIT_HASH` the Docker build
already receives into a build label and a mirror link. `web/scripts/licences.ts` writes
`web/src/third-party-licences.json` from the installed npm packages and `cargo metadata`; `scripts/check-licences.sh`
regenerates it and fails on any difference, in pre-commit and in CI's `web` job.

**Tech Stack:** Vite 8 (rolldown), TypeScript 7, Vitest 4 (node + Playwright Chromium projects), Biome 2, Node 26
(runs `scripts/licences.ts` directly), bash, `cargo metadata`.

**Spec:** `docs/superpowers/specs/2026-10-07-about-pages-design.md` (§ numbers below are its sections).

**Provenance:** a prototype (`about-pages-proto`, last `0461174`) was built first and passed the whole web suite
with the coverage floor (233 files, 2,286 tests, at `23dd643`), every hygiene scan, and a Docker image whose five
pages were fetched and whose about menu named its own commit. It was then replayed task by task onto
`about-pages-replay` (`ecc3c99`..`b3e25cd`, one commit per task, every commit through every hook), and the code
blocks below are those commits'. Each task's failing run, passing run and sabotages were run as written here on a
first replay whose code differs from this one only in three comment lines, corrected in `0461174`; the expected
outputs quoted are those runs'. The replay's last tree is the prototype's, byte for byte. All three branches are
local.

## Global Constraints

- Copyright holder `Davey Hughes`; first year `2026`; the line is `© 2026 Davey Hughes` in 2026 and
  `© 2026–YYYY Davey Hughes` after it, `YYYY` from the viewer's clock, never written into a file (§7).
- Source link: `https://github.com/Davey-Hughes/redextape`, at `/tree/<hash>` for a build with a commit and
  `/tree/main` without one (§2.4, §6).
- Pages live at `web/about.html`, `web/help.html`, `web/licences.html`, `web/privacy.html`; every link names the
  `.html` file; the about menu's links open with `target="_blank" rel="noopener"` (§4, §5).
- The licence notices file is generated — `cd web && node scripts/licences.ts` — and never edited by hand (§8.2).
- No colour literal outside `web/src/palettes.ts` (`scripts/check-colours.sh`); every colour in new CSS is a
  `var(--…)` token.
- No `file:line` in tracked source; a backticked symbol citation names the file that declares it
  (`scripts/check-attributions.sh`).
- Commits run every pre-commit hook; never `--no-verify`. Stage every file a commit needs (`pre-commit` refuses an
  unstaged `.pre-commit-config.yaml`).
- Web code style is Biome's: single quotes, no semicolons, 120 columns, `///`-free TypeScript (`/** */` doc comments).
- Restore a sabotage by copying the saved file back and `cmp`-ing it, never with `git checkout`, which would wipe a
  task's unstaged work.
- One browser test run at a time on this machine.

## How to run things

All test commands run from `web/`:

- Node project: `pnpm exec vitest run --project node <files>`
- Browser project: `pnpm exec vitest run --project browser <files>`
- Typecheck: `pnpm exec tsc --noEmit` (the hook runs `pnpm run typecheck`, which rebuilds the bindings first)
- Lint and format: `pnpm exec biome ci --error-on-warnings`; `pnpm exec biome check --write <paths>` applies fixes
- Build: `pnpm exec vite build`

A sabotage is: save a copy of the file, make the stated edit, run the stated tests, expect the stated case to fail,
copy the saved file back, `cmp` it against the copy.

**In a scratch worktree**, `pkg/` and `pkg-lsp/` must be real directories, not symlinks to another checkout's: Vite's
allow-list refuses a symlinked path, and every browser test that mounts the app then fails with
`TypeError: Failed to execute 'compile' on 'WebAssembly': HTTP status code is not ok`. Copy them. (A symlinked
`web/node_modules` is tolerated, but no web font loads through it.) `.gitignore`'s `pkg/` does not match a symlink,
so stage explicit paths, never `git add -A`.

## File map

| File | Task | Responsibility |
|---|---|---|
| `web/src/prepaint.ts` | 1 | the pre-paint script, its slot, and `inlinePrepaint` |
| `web/vite.config.ts` | 1, 2, 3 | the inlining plugin; the commit `define`; the five HTML inputs |
| `web/src/build-info.ts` | 2 | `MIRROR`, `buildOf`, `BUILD`, `copyright` |
| `web/about.html`, `help.html`, `licences.html`, `privacy.html` | 3, 4 | the pages |
| `web/src/pages.ts` | 3 | `initPage`: fills each page's footer |
| `web/src/pages.css` | 3 | the pages' prose, tables and licence boxes |
| `web/src/link-wiring.ts` | 3 | `LINK_KEY`, so the help test can name the source editor's link key |
| `web/scripts/licences.ts` | 4 | writes `web/src/third-party-licences.json` |
| `web/src/third-party-licences.json` | 4 | generated: redextape's licence and every shipped package's |
| `scripts/check-licences.sh` | 4 | regenerates and compares; `--self-test` |
| `web/src/licences-page.ts` | 4 | `renderLicences` |
| `web/index.html`, `web/tests/browser/harness.ts` | 1, 5 | the prepaint slot; the about menu (in both copies) |
| `web/src/app-header.ts` | 5 | `wireMenu` focuses a first link too |
| `web/src/style.css` | 5 | the about button and menu |
| `web/src/main.ts` | 3, 5 | `LINK_KEY`; the about menu's wiring |

---

### Task 1: One pre-paint script, inlined into every page by the build

The inline `<script>` in `web/index.html` moves into `web/src/prepaint.ts` as a string, and a Vite plugin puts it
back into each page's `<head>` where the page writes `<!-- prepaint -->` (§9). Behaviour is unchanged; what changes is
that Task 3's pages can carry the same script without a second copy.

**Files:**
- Create: `web/src/prepaint.ts`
- Modify: `web/index.html` (the inline script becomes the slot)
- Modify: `web/vite.config.ts` (import and plugin)
- Modify: `web/tsconfig.json` (`allowImportingTsExtensions`, so the config can import `./src/prepaint.ts` with its
  extension, which Vite's future native config loader requires)
- Modify: `web/tests/node/prepaint.test.ts`, `web/tests/browser/harness.ts` (read the script from the module)

**Interfaces:**
- Produces: `PREPAINT: string`, `PREPAINT_SLOT = '<!-- prepaint -->'`, `inlinePrepaint(html: string): string` in
  `web/src/prepaint.ts`. Task 3 adds pages carrying `PREPAINT_SLOT` and extends the test's `PAGES`.

- [ ] **Step 1: Point the tests at the module, and test the slot**

Modify `web/tests/node/prepaint.test.ts`:

```diff
diff --git a/web/tests/node/prepaint.test.ts b/web/tests/node/prepaint.test.ts
index 275e263..bd77c13 100644
--- a/web/tests/node/prepaint.test.ts
+++ b/web/tests/node/prepaint.test.ts
@@ -2,12 +2,15 @@ import { readFileSync } from 'node:fs'
 import { fileURLToPath } from 'node:url'
 import { describe, expect, it } from 'vitest'
 import { PALETTE_CSS_PATTERN, PALETTES, paletteDeclarations } from '../../src/palettes'
+import { inlinePrepaint, PREPAINT, PREPAINT_SLOT } from '../../src/prepaint'
 import { PALETTE_CSS_KEY, resolvePalette, STYLE_IDS, STYLE_KEY } from '../../src/skin'
 import { DAY, NEON, storedHalf } from './base16-fixtures'
 
-const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')
-// The one classic script in the page — the module script has a `type`.
-const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
+const script = PREPAINT
+const page = (name: string): string => readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8')
+
+/** The pages the build serves. */
+const PAGES = ['index.html']
 
 /**
  * Run the inline script against a fake `localStorage` and `<html>`, and return what it set.
@@ -96,6 +99,24 @@ describe('the pre-paint script', () => {
     }
   })
 
+  /**
+   * **EVERY PAGE PAINTS IN THE STORED THEME**, and from one copy of the script: each carries the slot once, in its
+   * `<head>`, and carries no inline script of its own that could be a second, drifting copy.
+   */
+  it.each(PAGES)('is inlined into %s, which carries the slot once in its head and no other classic script', (name) => {
+    const html = page(name)
+    const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? ''
+    expect(head.split(PREPAINT_SLOT).length - 1).toBe(1)
+    expect(html.split(PREPAINT_SLOT).length - 1).toBe(1)
+    expect(html).not.toMatch(/<script>/)
+    expect(inlinePrepaint(html)).toContain(`<script>${PREPAINT}</script>`)
+    expect(inlinePrepaint(html)).not.toContain(PREPAINT_SLOT)
+  })
+
+  it('leaves a page without the slot as it is', () => {
+    expect(inlinePrepaint('<head></head>')).toBe('<head></head>')
+  })
+
   // The script cannot import, so it carries its own copies. These hold each copy to its source.
   it('carries the keys, the style ids and the cache pattern that skin.ts and palettes.ts define', () => {
     expect(script).toContain(`'${STYLE_KEY}'`)
```

Modify `web/tests/browser/harness.ts`:

```diff
diff --git a/web/tests/browser/harness.ts b/web/tests/browser/harness.ts
index 3219b0d..7a6f396 100644
--- a/web/tests/browser/harness.ts
+++ b/web/tests/browser/harness.ts
@@ -1,4 +1,5 @@
 import html from '../../index.html?raw'
+import { PREPAINT } from '../../src/prepaint'
 
 /**
  * Shared browser-tier fixtures: the app shell every test file mounts into, and the poll helper every
@@ -227,8 +228,8 @@ export function tmWalk(pane: () => HTMLElement, arrived: RegExp, to: string, res
 export const intoCmpeq = (pane: () => HTMLElement): (() => Promise<void>)[] =>
   walkInParts(tmWalk(pane, /^cmp/, 'inside cmpeq', true), [578, 578])
 
-/** The one classic script in `index.html`: the pre-paint script, which draws a load's first frame from storage. */
-export const PREPAINT = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
+/** The pre-paint script every page's `<head>` carries, which draws a load's first frame from storage. */
+export { PREPAINT }
 
 /** `#rrggbb` as `getComputedStyle` writes a colour. */
 export const rgb = (hex: string): string =>
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run --project node tests/node/prepaint.test.ts tests/node/harness.test.ts`
Expected: both files fail to load — `Error: Cannot find module '../../src/prepaint' imported from …/web/tests/browser/harness.ts` and the same from `…/web/tests/node/prepaint.test.ts`; `Test Files  2 failed (2)`, `Tests  no tests`.

- [ ] **Step 3: Write the module, the slot, the plugin and the tsconfig flag**

Create `web/src/prepaint.ts`:

```ts
/**
 * THE PRE-PAINT SCRIPT — applies the stored appearance, style and palette BEFORE first paint, on every page the site
 * serves. `main.ts` does this too (`appearance.ts`'s `applyAppearance`, `skin.ts`'s `applySkin`), but a module script
 * always runs after the page has already painted once — waiting for it would show the wrong theme for one frame on
 * every load, then snap to the right one.
 *
 * **ONE COPY, INLINED BY THE BUILD.** Each page's `<head>` holds `PREPAINT_SLOT`, and a plugin in `vite.config.ts`
 * replaces it with this script inside a classic `<script>`, in the dev server and in the build alike. It cannot
 * be imported at run time, since importing a module would reintroduce exactly the delay it exists to avoid; so it
 * carries its own copies of the keys, the style ids and the cache pattern, and `prepaint.test.ts` holds each to
 * `skin.ts`/`palettes.ts`.
 *
 * `try/catch` because `localStorage` throws in some privacy modes, and a thrown error here must not block the rest of
 * the page from loading. The cached palette is applied only if every declaration in it sets a custom property to a
 * `light-dark(#hex, #hex)` pair (`palettes.ts`'s `PALETTE_CSS_PATTERN`), so nothing else in storage can reach the
 * `style` attribute.
 */
export const PREPAINT: string = `
try {
  var v = localStorage.getItem('redextape.appearance')
  if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v)
} catch {}
try {
  var s = localStorage.getItem('redextape.style')
  if (s === 'paper' || s === 'terminal' || s === 'instrument') document.documentElement.setAttribute('data-style', s)
  var c = localStorage.getItem('redextape.palette.css')
  if (c && /^(--[a-z0-9-]+: light-dark\\(#[0-9a-f]{6}, #[0-9a-f]{6}\\); ?)+$/.test(c)) document.documentElement.setAttribute('style', c)
} catch {}
`

/** What each page's `<head>` carries where the script goes. */
export const PREPAINT_SLOT = '<!-- prepaint -->'

/** `html` with its slot replaced by the script, or unchanged when it has no slot. */
export function inlinePrepaint(html: string): string {
  return html.replace(PREPAINT_SLOT, () => `<script>${PREPAINT}</script>`)
}
```

Modify `web/index.html`:

```diff
diff --git a/web/index.html b/web/index.html
index ee636ee..5ea879e 100644
--- a/web/index.html
+++ b/web/index.html
@@ -14,28 +14,7 @@
     <link rel="preload" as="font" type="font/woff2" crossorigin href="/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2" />
     <title>redextape</title>
     <link rel="stylesheet" href="/src/style.css" />
-    <script>
-      // Applies the stored appearance, style and palette BEFORE first paint. `main.ts` does this too
-      // (`appearance.ts`'s `applyAppearance`, `skin.ts`'s `applySkin`), but a module script always runs
-      // after the page has already painted once — waiting for it would show the wrong theme for one frame
-      // on every load, then snap to the right one. This inline copy is deliberately tiny and duplicated
-      // rather than imported, since importing a module here would reintroduce exactly the delay it exists
-      // to avoid; `prepaint.test.ts` holds its keys, style ids and pattern to `skin.ts`/`palettes.ts`.
-      // `try/catch` because `localStorage` throws in some privacy modes, and a thrown error here must not
-      // block the rest of the page from loading. The cached palette is applied only if every declaration
-      // in it sets a custom property to a `light-dark(#hex, #hex)` pair (`palettes.ts`'s
-      // `PALETTE_CSS_PATTERN`), so nothing else in storage can reach the `style` attribute.
-      try {
-        var v = localStorage.getItem('redextape.appearance')
-        if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v)
-      } catch {}
-      try {
-        var s = localStorage.getItem('redextape.style')
-        if (s === 'paper' || s === 'terminal' || s === 'instrument') document.documentElement.setAttribute('data-style', s)
-        var c = localStorage.getItem('redextape.palette.css')
-        if (c && /^(--[a-z0-9-]+: light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\); ?)+$/.test(c)) document.documentElement.setAttribute('style', c)
-      } catch {}
-    </script>
+    <!-- prepaint -->
   </head>
   <body>
     <header class="bar">
```

Modify `web/vite.config.ts`:

```diff
diff --git a/web/vite.config.ts b/web/vite.config.ts
index 05a699f..8d57d56 100644
--- a/web/vite.config.ts
+++ b/web/vite.config.ts
@@ -13,6 +13,7 @@ import { playwright } from '@vitest/browser-playwright'
 // TS2769 because the `test` property is invisible to the checker. `vitest/config` re-exports the
 // same Vite `defineConfig` plus that import path.
 import { configDefaults, defineConfig } from 'vitest/config'
+import { inlinePrepaint } from './src/prepaint.ts'
 
 // `pkg/` is built to the REPO ROOT, one level above this Vite root, because the Dockerfile places
 // stage 1's output at /app/pkg beside /app/web. Vite's dev server refuses to serve outside its root
@@ -75,6 +76,7 @@ const PROBE_EXCLUDE = process.env.REDEXTAPE_PROBE === undefined ? PROBE_FILES :
 
 export default defineConfig({
   server: { fs: { allow: [REPO_ROOT] } },
+  plugins: [{ name: 'redextape-prepaint', transformIndexHtml: { order: 'pre', handler: inlinePrepaint } }],
   worker: { format: 'es' },
   // `assetsInlineLimit` — WITHOUT THIS, ONE OF FOUR GRAMMAR `.wasm` FILES INLINES AND THE OTHER
   // THREE DO NOT, FOR A REASON THAT HAS NOTHING TO DO WITH THE GRAMMARS THEMSELVES.
```

Modify `web/tsconfig.json`:

```diff
diff --git a/web/tsconfig.json b/web/tsconfig.json
index a022167..e174ffb 100644
--- a/web/tsconfig.json
+++ b/web/tsconfig.json
@@ -13,7 +13,8 @@
     "verbatimModuleSyntax": true,
     "isolatedModules": true,
     "skipLibCheck": true,
-    "noEmit": true
+    "noEmit": true,
+    "allowImportingTsExtensions": true
   },
   "include": ["src", "tests", "vite.config.ts"]
 }
```

- [ ] **Step 4: Run them and watch them pass; build and check the built page**

Run: `pnpm exec vitest run --project node tests/node/prepaint.test.ts tests/node/harness.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  23 passed (23)`.

Run: `pnpm exec vite build && grep -c "localStorage.getItem('redextape.appearance')" dist/index.html && grep -c '<!-- prepaint -->' dist/index.html`
Expected: `1` then `0` — the script inlined once, the slot gone.

- [ ] **Step 5: Sabotage**

1. In `web/src/prepaint.ts`, make `inlinePrepaint` return `html` unchanged. Expected: the
   `is inlined into index.html …` case fails.
2. In `web/index.html`, delete the `<!-- prepaint -->` line. Expected: the same case fails (the slot count is 0).

- [ ] **Step 6: Commit**

```bash
git add web/src/prepaint.ts web/index.html web/vite.config.ts web/tsconfig.json web/tests/node/prepaint.test.ts web/tests/browser/harness.ts
git commit -m "The pre-paint script is one module, inlined into a page's head by the build where the page asks for it"
```

---

### Task 2: The build, its source link and the copyright line

**Files:**
- Create: `web/src/build-info.ts`, `web/tests/node/build-info.test.ts`
- Modify: `web/vite.config.ts` (`define` the commit)

**Interfaces:**
- Produces, in `web/src/build-info.ts`: `MIRROR`; `type Build = { label: string; source: string }`;
  `buildOf(commit: string | undefined): Build`; `BUILD: Build`; `FIRST_YEAR = 2026`; `HOLDER = 'Davey Hughes'`;
  `copyright(now: Date): string`. Tasks 3 and 5 import `BUILD`, `buildOf` and `copyright`.

- [ ] **Step 1: Write the test**

Create `web/tests/node/build-info.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BUILD, buildOf, copyright, FIRST_YEAR, MIRROR } from '../../src/build-info'

const HASH = '8dc603d0a1b2c3d4e5f60718293a4b5c6d7e8f90'

describe('buildOf', () => {
  it('names a commit by its first seven characters and links the mirror at the whole hash', () => {
    expect(buildOf(HASH)).toEqual({ label: 'build 8dc603d', source: `${MIRROR}/tree/${HASH}` })
  })

  it('takes a short hash, and an upper-case or padded one, as the same commit', () => {
    expect(buildOf('8dc603d')).toEqual({ label: 'build 8dc603d', source: `${MIRROR}/tree/8dc603d` })
    expect(buildOf(` ${HASH.toUpperCase()}\n`)).toEqual(buildOf(HASH))
  })

  /** `pnpm dev`, a local build and a `docker build` without the argument define it empty; Vitest leaves it unset. */
  it.each([
    ['empty', ''],
    ['unset', undefined],
    ['too short', '8dc603'],
    ['not hex', 'main'],
    ['a URL', 'https://example.com/'],
  ])('is a dev build linking main when the commit is %s', (_, commit) => {
    expect(buildOf(commit)).toEqual({ label: 'dev build', source: `${MIRROR}/tree/main` })
  })

  it('is what Vitest sees for this build: no commit defined', () => {
    expect(BUILD).toEqual(buildOf(undefined))
  })
})

describe('copyright', () => {
  it('names the first year alone while it is still that year', () => {
    expect(copyright(new Date(FIRST_YEAR, 11, 31))).toBe('© 2026 Davey Hughes')
  })

  it('widens to a range from the first year once the clock is past it', () => {
    expect(copyright(new Date(2027, 0, 1))).toBe('© 2026–2027 Davey Hughes')
    expect(copyright(new Date(2031, 5, 15))).toBe('© 2026–2031 Davey Hughes')
  })

  it('keeps the first year when the clock is behind it, rather than writing a range backwards', () => {
    expect(copyright(new Date(2025, 5, 15))).toBe('© 2026 Davey Hughes')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run --project node tests/node/build-info.test.ts`
Expected: `Error: Cannot find module '../../src/build-info' imported from …/web/tests/node/build-info.test.ts`; `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the module and define the commit**

Create `web/src/build-info.ts`:

```ts
/**
 * WHICH BUILD THIS IS, WHERE ITS SOURCE IS, AND WHOSE IT IS — the about menu's foot and every page's footer read
 * these (about pages design §5, §6, §7), so the two cannot name different commits or different years.
 *
 * `VITE_COMMIT_HASH` is defined by `vite.config.ts` from the `COMMIT_HASH` the Docker build receives (CI passes
 * `--build-arg COMMIT_HASH="$SHA"`). It is empty in `pnpm dev`, in a local `pnpm build` and in a `docker build`
 * without the argument, and `buildOf` reads empty and absent alike as a dev build.
 */

/** The public mirror the forge pushes to on every commit; the forge itself sends visitors to a login page. */
export const MIRROR = 'https://github.com/Davey-Hughes/redextape'

/** What the menu and the footers say about the build, and where its source link points. */
export type Build = { readonly label: string; readonly source: string }

/**
 * `commit` as a build: `build abc1234` and the mirror's tree at that commit, or `dev build` and the mirror's `main`
 * for anything that is not a 7-to-40-digit hex hash, so a stray value never reaches a link.
 */
export function buildOf(commit: string | undefined): Build {
  const hash = commit?.trim().toLowerCase() ?? ''
  if (!/^[0-9a-f]{7,40}$/.test(hash)) return { label: 'dev build', source: `${MIRROR}/tree/main` }
  return { label: `build ${hash.slice(0, 7)}`, source: `${MIRROR}/tree/${hash}` }
}

/** This build. */
export const BUILD: Build = buildOf(import.meta.env.VITE_COMMIT_HASH)

/** The year redextape was first published, which every copyright line keeps. */
export const FIRST_YEAR = 2026

export const HOLDER = 'Davey Hughes'

/**
 * The copyright line on `now`: `© 2026 Davey Hughes` in 2026 and `© 2026–YYYY Davey Hughes` after it (design §7).
 * The end of the range is the viewer's clock and is never written into a file.
 */
export function copyright(now: Date): string {
  const year = now.getFullYear()
  return year > FIRST_YEAR ? `© ${FIRST_YEAR}–${year} ${HOLDER}` : `© ${FIRST_YEAR} ${HOLDER}`
}
```

Modify `web/vite.config.ts`:

```diff
diff --git a/web/vite.config.ts b/web/vite.config.ts
index 8d57d56..1073a80 100644
--- a/web/vite.config.ts
+++ b/web/vite.config.ts
@@ -77,6 +77,7 @@ const PROBE_EXCLUDE = process.env.REDEXTAPE_PROBE === undefined ? PROBE_FILES :
 export default defineConfig({
   server: { fs: { allow: [REPO_ROOT] } },
   plugins: [{ name: 'redextape-prepaint', transformIndexHtml: { order: 'pre', handler: inlinePrepaint } }],
+  define: { 'import.meta.env.VITE_COMMIT_HASH': JSON.stringify(process.env.COMMIT_HASH ?? '') },
   worker: { format: 'es' },
   // `assetsInlineLimit` — WITHOUT THIS, ONE OF FOUR GRAMMAR `.wasm` FILES INLINES AND THE OTHER
   // THREE DO NOT, FOR A REASON THAT HAS NOTHING TO DO WITH THE GRAMMARS THEMSELVES.
```

- [ ] **Step 4: Run it and watch it pass**

Nothing imports `build-info.ts` until Task 3, so the build drops it for now; Task 6 checks the image carries the commit.

Run: `pnpm exec vitest run --project node tests/node/build-info.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  11 passed (11)`.

- [ ] **Step 5: Sabotage**

1. In `copyright`, write `year >= FIRST_YEAR`. Expected: `names the first year alone while it is still that year`
   fails.
2. In `buildOf`, drop `.toLowerCase()`. Expected: `takes a short hash, and an upper-case or padded one, as the same
   commit` fails.

- [ ] **Step 6: Commit**

```bash
git add web/src/build-info.ts web/tests/node/build-info.test.ts web/vite.config.ts
git commit -m "build-info.ts names the build from the COMMIT_HASH the image already receives, and the copyright year from the viewer's clock"
```

---

### Task 3: The four pages

`about.html`, `help.html`, `licences.html` and `privacy.html`, each with the shared nav and footer, built beside
`index.html`. `licences.html` carries redextape's own licence statement here; Task 4 adds the notices. The help
page's editor table is held to the keymaps, which needs the source editor's link key as a constant.

**Files:**
- Create: `web/about.html`, `web/help.html`, `web/licences.html`, `web/privacy.html`
- Create: `web/src/pages.ts`, `web/src/pages.css`
- Create: `web/tests/node/pages.test.ts`, `web/tests/browser/pages.test.ts`
- Modify: `web/vite.config.ts` (the five HTML inputs)
- Modify: `web/src/link-wiring.ts` (`LINK_KEY`), `web/src/main.ts` (bind `LINK_KEY`)
- Modify: `web/tests/node/prepaint.test.ts` (all five pages)

**Interfaces:**
- Consumes: `PREPAINT_SLOT` (Task 1); `BUILD`, `Build`, `buildOf`, `copyright` (Task 2); `navKeymap` in
  `web/src/lsp-nav.ts` (existing).
- Produces: `initPage(root?: ParentNode, now?: Date, build?: Build): void` in `web/src/pages.ts`;
  `LINK_KEY = "Mod-'"` in `web/src/link-wiring.ts`; `#notices` and `#own-licence` in `web/licences.html`, which
  Task 4 fills.

- [ ] **Step 1: Write the tests**

Create `web/tests/node/pages.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LINK_KEY } from '../../src/link-wiring'
import { navKeymap } from '../../src/lsp-nav'

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** The four pages beside the app (about pages design §4), each as the build reads it. */
const PAGES = ['about', 'help', 'licences', 'privacy'] as const
const html = (name: string): string => read(`../../${name}.html`)

/** The `data-key` of every row in `#id`'s table on `page`. */
function tableKeys(page: string, id: string): string[] {
  const table = new RegExp(`<table id="${id}">([\\s\\S]*?)</table>`).exec(html(page))?.[1]
  if (table === undefined) throw new Error(`${page}.html has no table #${id}`)
  return [...table.matchAll(/<tr data-key="([^"]+)">/g)].map((m) => m[1] ?? '')
}

describe('the pages beside the app', () => {
  /** Each page links the other three and itself, in one order, marking its own as the current page. */
  it.each(PAGES)('%s.html carries the shared nav, marking itself', (name) => {
    const nav = /<nav class="page-nav" aria-label="pages">([\s\S]*?)<\/nav>/.exec(html(name))?.[1] ?? ''
    expect([...nav.matchAll(/href="\/([a-z]+)\.html"/g)].map((m) => m[1])).toEqual([...PAGES])
    expect([...nav.matchAll(/href="\/([a-z]+)\.html" aria-current="page"/g)].map((m) => m[1])).toEqual([name])
  })

  /** What `pages.ts`'s `initPage` fills: the copyright line, the build and the source link. */
  it.each(PAGES)('%s.html has the shared footer, with the copyright year as the HTML writes it', (name) => {
    const foot = /<footer class="page-foot">([\s\S]*?)<\/footer>/.exec(html(name))?.[1] ?? ''
    expect(foot).toContain('<span data-copyright>© 2026 Davey Hughes</span>')
    expect(foot).toContain('<span data-build>dev build</span>')
    expect(foot).toContain('<a data-source href="https://github.com/Davey-Hughes/redextape">source</a>')
    expect(html(name)).toMatch(/import \{ initPage \} from '\/src\/pages\.ts'/)
  })
})

describe('the help page', () => {
  /**
   * **THE EDITOR TABLE IS THE EDITORS' OWN BINDINGS, NO MORE AND NO FEWER**: every key `navKeymap` binds in every
   * editor, and the source editor's `LINK_KEY`. A key added to either without a row, or a row left behind by a
   * removed key, fails here.
   */
  it("lists exactly the app's own editor keys", () => {
    const nav = navKeymap({ uri: () => undefined, client: () => undefined, reveal: () => {}, notify: () => {} })
    const bound = [...nav.map((b) => b.key ?? ''), LINK_KEY]
    expect(tableKeys('help', 'editor-keys').sort()).toEqual(bound.sort())
  })
})

describe('the privacy page', () => {
  /** Every `.ts` file under `src/`, read from disk so a file not yet added to git is read too. */
  const sources = (): string[] => {
    const src = fileURLToPath(new URL('../../src/', import.meta.url))
    return (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(join(src, f), 'utf8'))
  }

  /**
   * **EVERY KEY THE APP STORES, AND ONLY THOSE**: the `redextape.*` string literals in `src/`, so a key declared in a
   * new file is counted too. The page's claim that this is the whole list rests on it.
   */
  it('lists every redextape.* storage key the app declares', () => {
    const keys = [
      ...new Set(sources().flatMap((code) => [...code.matchAll(/'(redextape\.[a-zA-Z.]*)'/g)].map((m) => m[1] ?? ''))),
    ]
    expect(keys.length).toBeGreaterThan(0)
    expect(tableKeys('privacy', 'storage-keys').sort()).toEqual(keys.sort())
  })

  it('names no sessionStorage, IndexedDB or cookie, which the app does not use', () => {
    const all = sources().join('\n')
    expect(all).not.toContain('sessionStorage')
    expect(all).not.toContain('indexedDB')
    expect(all).not.toContain('document.cookie')
  })
})
```

Create `web/tests/browser/pages.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildOf } from '../../src/build-info'
import { initPage } from '../../src/pages'

/** Each page's footer, as `about.html` and its siblings write it before `initPage` runs. */
const FOOTER = `
  <footer class="page-foot">
    <span data-copyright>© 2026 Davey Hughes</span> · <span data-build>dev build</span> ·
    <a data-source href="https://github.com/Davey-Hughes/redextape">source</a>
  </footer>`

const fixture = (markup: string): HTMLElement => {
  const root = document.createElement('div')
  root.innerHTML = markup
  return root
}

describe('initPage', () => {
  it("writes the copyright year from the viewer's clock, and the build and its source link", () => {
    const root = fixture(FOOTER)
    initPage(root, new Date(2031, 5, 15), buildOf('8dc603d0'))
    expect(root.querySelector('[data-copyright]')?.textContent).toBe('© 2026–2031 Davey Hughes')
    expect(root.querySelector('[data-build]')?.textContent).toBe('build 8dc603d')
    expect(root.querySelector<HTMLAnchorElement>('a[data-source]')?.href).toBe(
      'https://github.com/Davey-Hughes/redextape/tree/8dc603d0',
    )
  })

  it('fills every marked element, not only the first', () => {
    const root = fixture(`${FOOTER}<p><span data-copyright></span><span data-build></span></p>`)
    initPage(root, new Date(2026, 0, 1), buildOf(undefined))
    expect([...root.querySelectorAll('[data-copyright]')].map((e) => e.textContent)).toEqual([
      '© 2026 Davey Hughes',
      '© 2026 Davey Hughes',
    ])
    expect([...root.querySelectorAll('[data-build]')].map((e) => e.textContent)).toEqual(['dev build', 'dev build'])
  })
})
```

Modify `web/tests/node/prepaint.test.ts`:

```diff
diff --git a/web/tests/node/prepaint.test.ts b/web/tests/node/prepaint.test.ts
index bd77c13..484ea7a 100644
--- a/web/tests/node/prepaint.test.ts
+++ b/web/tests/node/prepaint.test.ts
@@ -9,8 +9,8 @@ import { DAY, NEON, storedHalf } from './base16-fixtures'
 const script = PREPAINT
 const page = (name: string): string => readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8')
 
-/** The pages the build serves. */
-const PAGES = ['index.html']
+/** The pages the build serves: the app, and the four beside it (about pages design §4). */
+const PAGES = ['index.html', 'about.html', 'help.html', 'licences.html', 'privacy.html']
 
 /**
  * Run the inline script against a fake `localStorage` and `<html>`, and return what it set.
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run --project node tests/node/pages.test.ts tests/node/prepaint.test.ts`
Expected: `Test Files  2 failed (2)`, `Tests  14 failed | 11 passed (25)` — each page case fails with `ENOENT: no such file or directory, open '…/web/about.html'` (and its siblings), and the two key-list cases with them.

Run: `pnpm exec vitest run --project browser tests/browser/pages.test.ts`
Expected: `Error: Failed to import test file …/web/tests/browser/pages.test.ts` (no `src/pages.ts`); `Test Files  1 failed (1)`.

- [ ] **Step 3: Write `LINK_KEY` and bind it**

Modify `web/src/link-wiring.ts`:

```diff
diff --git a/web/src/link-wiring.ts b/web/src/link-wiring.ts
index 86451c0..17d1332 100644
--- a/web/src/link-wiring.ts
+++ b/web/src/link-wiring.ts
@@ -8,6 +8,13 @@ import type { LeafId, PaneCollection } from './panes'
 import type { SessionRegistry } from './sessions'
 import type { TmPane } from './tm-pane'
 
+/**
+ * The source editor's key for linking at the caret, the keyboard route to a click. `main.ts` binds it and the help
+ * page's key table names it; `help.test.ts` holds the two together. It is unbound in `defaultKeymap` and in
+ * `historyKeymap`; verify that before changing it.
+ */
+export const LINK_KEY = "Mod-'"
+
 /**
  * THE LINK STATE AND EVERYTHING THAT READS IT — the cluster `main.ts` held as four `let`s visible to a
  * thousand lines.
```

Modify `web/src/main.ts`:

```diff
diff --git a/web/src/main.ts b/web/src/main.ts
index 5f27c7c..3eb1b8e 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -50,7 +50,7 @@ import {
 } from './layout'
 import { retitleStage } from './layout-view'
 import { LEG_NAME, LEGS } from './legs'
-import { createLinkWiring, type LinkWiring } from './link-wiring'
+import { createLinkWiring, LINK_KEY, type LinkWiring } from './link-wiring'
 import { LspClient } from './lsp-client'
 import { lspHover } from './lsp-hover'
 import { navKeymap } from './lsp-nav'
@@ -2511,14 +2511,13 @@ async function main(): Promise<EditorView> {
             return false
           },
         }),
-        // The keyboard route to the same thing. `Mod-'` is unbound in `defaultKeymap` and in
-        // `historyKeymap`; verify that before changing it. Reachability without a mouse is the whole
+        // The keyboard route to the same thing, `LINK_KEY`. Reachability without a mouse is the whole
         // point — the roadmap defers the rest of accessibility to one pass at the end of Plan 5, but a
         // mouse-only primary interaction would have to be retrofitted by that pass rather than
         // adjusted.
         keymap.of([
           {
-            key: "Mod-'",
+            key: LINK_KEY,
             run: (v) => {
               const pos = v.state.selection.main.head
               linkWiring.linkAtSourceOffset(new TextEncoder().encode(v.state.doc.sliceString(0, pos)).length)
```

- [ ] **Step 4: Write the pages' script and style**

Create `web/src/pages.ts`:

```ts
import { BUILD, type Build, copyright } from './build-info'

/**
 * THE FOUR PAGES BESIDE THE APP — about, help, licences and privacy (about pages design §4). Each is static HTML that
 * reads the same with or without this script; the script only fills what the HTML cannot know: the build, its source
 * link and the copyright year, in the footer every page shares.
 *
 * Each page calls `initPage` from an inline module script, so no page has an entry file of its own.
 */
export function initPage(root: ParentNode = document, now: Date = new Date(), build: Build = BUILD): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-copyright]')) el.textContent = copyright(now)
  for (const el of root.querySelectorAll<HTMLElement>('[data-build]')) el.textContent = build.label
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[data-source]')) a.href = build.source
}
```

Create `web/src/pages.css`:

```css
/* THE FOUR PAGES BESIDE THE APP (about pages design §4): a document in the app's own palette and type, under
   `style.css`, which every page loads first so the tokens, the header's `.bar` and the focus ring are the app's.
   Everything here is scoped to `.page` or to an element only these pages have, so the app is untouched. */

/* `style.css` lays `main` out as the app's row of views; a page's `main` is a column of prose. */
.page main {
  display: block;
  flex: 1 0 auto;
  width: 100%;
  max-width: 44rem;
  margin: 0 auto;
  padding: var(--space-3);
}

/* Links in the page's own colour; the header's and the footer's below are the chrome's. */
.page a {
  color: var(--accent);
}
.page .bar a {
  color: inherit;
}
.page .bar .wordmark {
  text-decoration: none;
}
.page-nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
}
.page-nav a[aria-current="page"] {
  color: var(--accent);
  text-decoration: none;
  font-weight: 600;
}

.page h1 {
  font-size: var(--step-1);
  margin: var(--space-3) 0;
}
.page h2 {
  font-size: var(--step-0);
  margin: calc(2 * var(--space-3)) 0 var(--space-2);
}
.page p,
.page li {
  max-width: 40rem;
}
.page code,
.page kbd,
.page pre {
  font-family: var(--font-mono);
  font-size: var(--step--1);
}
.page kbd {
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  padding: 0 0.3em;
  background: var(--bg-raised);
  white-space: nowrap;
}
.page .tagline {
  color: var(--fg-dim);
}

/* THE KEY TABLES (help) AND THE STORAGE TABLE (privacy): one rule under each row. A cell wraps; a key does not
   (`kbd` above), so a phone's narrow column breaks between keys and never inside one. A storage key is one unbroken
   word, so it may break anywhere rather than widen the page. */
.page table {
  border-collapse: collapse;
  width: 100%;
}
.page th,
.page td {
  text-align: left;
  vertical-align: top;
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--rule);
}
.page th {
  color: var(--fg-dim);
  font-weight: 600;
}
.page td code {
  overflow-wrap: anywhere;
}

/* THE LICENCE TEXTS: each in a `<details>`, whose text keeps its own line breaks and scrolls inside itself rather
   than widening the page at a phone's width. */
.page details {
  border-bottom: 1px solid var(--rule);
  padding: var(--space-1) 0;
}
.page summary {
  cursor: pointer;
}
.page details pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 24rem;
  overflow: auto;
  padding: var(--space-2);
  background: var(--bg-raised);
  border: 1px solid var(--rule);
}
.page .meta {
  color: var(--fg-dim);
}

.page-foot {
  border-top: 1px solid var(--rule);
  background: var(--bg-chrome);
  color: var(--fg-dim);
  padding: var(--space-2) var(--space-3);
  font-size: var(--step--1);
}
.page .page-foot a {
  color: inherit;
}
```

- [ ] **Step 5: Write the four pages**

Every page's prose was checked against the code it describes: the help page's keys against each `keydown` handler
(`lambda-body.ts`, `virtual-grid.ts` and its three users, `state-diagram.ts`, `layout-view.ts`, `view-header.ts`) and
the step controls' labels (`step-controls.ts`, `controls.ts`); the privacy page against spec §2.5 and §2.6. Change
none of it without re-reading the code it names.

Create `web/about.html`:

```html
<!doctype html>
<html lang="en" data-style="instrument">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>about — redextape</title>
    <link rel="stylesheet" href="/src/style.css" />
    <link rel="stylesheet" href="/src/pages.css" />
    <!-- prepaint -->
  </head>
  <body class="page">
    <header class="bar">
      <a class="wordmark" href="/">redextape</a>
      <nav class="page-nav" aria-label="pages">
        <a href="/about.html" aria-current="page">about</a>
        <a href="/help.html">help</a>
        <a href="/licences.html">licences</a>
        <a href="/privacy.html">privacy</a>
      </nav>
    </header>
    <main>
      <h1>About redextape</h1>
      <p class="tagline">Watch the Church–Turing thesis happen.</p>
      <p>
        redextape compiles one small program, written in a little imperative and functional language, into
        <strong>both</strong> a lambda-calculus term and a Turing machine, and runs the two side by side. The λ pane
        reduces the term one redex at a time; the Turing-machine pane steps the machine across its tapes; an assembly
        pane shows the register-assembly program the machine is lowered from. Every leg steps forwards and backwards,
        and a position in one can be linked to the same point of the program in the others.
      </p>
      <p>
        Nothing is simulated for show. The reducer and the machine are real, and each answer is decoded from the
        model's own final state — so what you watch is the computation itself, not a native run with an animation laid
        over it. The test suite holds every backend to the others on every commit.
      </p>
      <h2>The name</h2>
      <p>
        <em>redex</em> — a reducible expression, the atom of lambda-calculus reduction — plus <em>tape</em>, the
        Turing machine's. Read aloud it is “red tape”.
      </p>
      <h2>This build</h2>
      <p>
        <span data-build>dev build</span>, from the source at
        <a data-source href="https://github.com/Davey-Hughes/redextape">github.com/Davey-Hughes/redextape</a>.
      </p>
      <h2>Licence</h2>
      <p>
        redextape is free software under the
        <a href="/licences.html#redextape">GNU General Public License, version 3 only</a>. The libraries and fonts it
        ships keep their own licences, listed on the <a href="/licences.html">licences</a> page.
      </p>
    </main>
    <footer class="page-foot">
      <span data-copyright>© 2026 Davey Hughes</span> · <span data-build>dev build</span> ·
      <a data-source href="https://github.com/Davey-Hughes/redextape">source</a>
    </footer>
    <script type="module">
      import { initPage } from '/src/pages.ts'
      initPage()
    </script>
  </body>
</html>
```

Create `web/help.html`:

```html
<!doctype html>
<html lang="en" data-style="instrument">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>help — redextape</title>
    <link rel="stylesheet" href="/src/style.css" />
    <link rel="stylesheet" href="/src/pages.css" />
    <!-- prepaint -->
  </head>
  <body class="page">
    <header class="bar">
      <a class="wordmark" href="/">redextape</a>
      <nav class="page-nav" aria-label="pages">
        <a href="/about.html">about</a>
        <a href="/help.html" aria-current="page">help</a>
        <a href="/licences.html">licences</a>
        <a href="/privacy.html">privacy</a>
      </nav>
    </header>
    <main>
      <h1>Help</h1>
      <h2>Getting around</h2>
      <ol>
        <li>
          Type a program in the source view, or open one from <strong>examples ▾</strong>. It compiles as you type,
          and an error is marked where it is.
        </li>
        <li>
          Step it with the step controls: <strong>▶</strong> one step forward, <strong>◀</strong> one step back,
          <strong>↺</strong> back to the oldest kept step, play and pause at the chosen speed. A long run records as
          much as its budget allows and offers <strong>continue</strong> to go further.
        </li>
        <li>
          Click a token in the source, a λ token, an assembly instruction or a machine rule, and the other views show
          the same point of the program.
        </li>
        <li>
          A view's <strong>⋯</strong> menu has <strong>edit a copy</strong>: the term, the machine or the assembly as
          text you can change and run on its own. <strong>copies ▾</strong> lists them.
        </li>
        <li>
          <strong>share</strong> makes a link to the program, the views and where each one stands;
          <strong>Explorer ▾</strong> switches between the Explorer, Debugger and Stage layouts; and
          <strong>settings</strong> holds the style, palette, appearance, keymap and format-on-blur choices.
        </li>
      </ol>

      <h2>Keys in the editors</h2>
      <table id="editor-keys">
        <thead>
          <tr><th scope="col">Key</th><th scope="col">Does</th><th scope="col">Where</th></tr>
        </thead>
        <tbody>
          <tr data-key="F12"><td><kbd>F12</kbd></td><td>go to the definition of the name at the caret</td><td>every editor</td></tr>
          <tr data-key="Shift-F12"><td><kbd>Shift</kbd>+<kbd>F12</kbd></td><td>go to the next reference to it</td><td>every editor</td></tr>
          <tr data-key="F2"><td><kbd>F2</kbd></td><td>show what the editor knows about the name at the caret</td><td>every editor</td></tr>
          <tr data-key="Mod-'"><td><kbd>Ctrl</kbd>+<kbd>'</kbd> (<kbd>⌘</kbd>+<kbd>'</kbd> on a Mac)</td><td>link the caret's position to the other views</td><td>the source editor</td></tr>
        </tbody>
      </table>
      <p>
        Everything else is the editor's standard keymap, or vim's when <strong>settings</strong> sets the keymap to
        vim.
      </p>

      <h2>Keys in the views</h2>
      <table>
        <thead>
          <tr><th scope="col">Where</th><th scope="col">Keys</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>the λ term</td>
            <td>
              <kbd>↑</kbd> <kbd>↓</kbd> <kbd>PgUp</kbd> <kbd>PgDn</kbd> <kbd>Home</kbd> <kbd>End</kbd> move between rows;
              <kbd>→</kbd> opens what is folded on the row and <kbd>←</kbd> folds it again; <kbd>Enter</kbd> opens a
              fold, or links the row when nothing on it is folded
            </td>
          </tr>
          <tr>
            <td>the machine's rules, the assembly listing, the program diagram</td>
            <td>
              <kbd>↑</kbd> <kbd>↓</kbd> <kbd>PgUp</kbd> <kbd>PgDn</kbd> <kbd>Home</kbd> <kbd>End</kbd> move between rows;
              <kbd>Enter</kbd> links the row
            </td>
          </tr>
          <tr>
            <td>the state diagram's boxes and nodes</td>
            <td><kbd>↑</kbd> <kbd>↓</kbd> between boxes; <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> between nodes</td>
          </tr>
          <tr>
            <td>the divider between two views</td>
            <td><kbd>←</kbd> <kbd>→</kbd>, or <kbd>↑</kbd> <kbd>↓</kbd> when the views are stacked, resize them</td>
          </tr>
          <tr>
            <td>the Stage layout's tabs</td>
            <td>
              <kbd>←</kbd> <kbd>→</kbd> <kbd>Home</kbd> <kbd>End</kbd> move between tabs; <kbd>Enter</kbd> or
              <kbd>Space</kbd> shows the view
            </td>
          </tr>
          <tr>
            <td>a choice in a view's ⋯ menu</td>
            <td>arrow keys move the choice</td>
          </tr>
        </tbody>
      </table>
    </main>
    <footer class="page-foot">
      <span data-copyright>© 2026 Davey Hughes</span> · <span data-build>dev build</span> ·
      <a data-source href="https://github.com/Davey-Hughes/redextape">source</a>
    </footer>
    <script type="module">
      import { initPage } from '/src/pages.ts'
      initPage()
    </script>
  </body>
</html>
```

Create `web/licences.html`:

```html
<!doctype html>
<html lang="en" data-style="instrument">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>licences — redextape</title>
    <link rel="stylesheet" href="/src/style.css" />
    <link rel="stylesheet" href="/src/pages.css" />
    <!-- prepaint -->
  </head>
  <body class="page">
    <header class="bar">
      <a class="wordmark" href="/">redextape</a>
      <nav class="page-nav" aria-label="pages">
        <a href="/about.html">about</a>
        <a href="/help.html">help</a>
        <a href="/licences.html" aria-current="page">licences</a>
        <a href="/privacy.html">privacy</a>
      </nav>
    </header>
    <main>
      <h1>Licences</h1>
      <section id="redextape">
        <h2>redextape</h2>
        <p>
          <span data-copyright>© 2026 Davey Hughes</span>. redextape is free software: you can redistribute it and/or
          modify it under the terms of the GNU General Public License as published by the Free Software Foundation,
          version 3 only. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even
          the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the licence below for more
          details.
        </p>
        <p>
          The source of this build is at
          <a data-source href="https://github.com/Davey-Hughes/redextape">github.com/Davey-Hughes/redextape</a>.
        </p>
        <div id="own-licence">
          <p>
            The licence text is the <a href="https://www.gnu.org/licenses/gpl-3.0.html">GNU General Public License,
            version 3</a>.
          </p>
        </div>
      </section>
      <section>
        <h2>What it ships from others</h2>
        <p>
          The page's code, its WebAssembly and its fonts include the work of others, each under its own licence. Every
          one is listed here with the licence texts its package carries.
        </p>
        <div id="notices">
          <p>This list needs JavaScript to draw.</p>
        </div>
      </section>
    </main>
    <footer class="page-foot">
      <span data-copyright>© 2026 Davey Hughes</span> · <span data-build>dev build</span> ·
      <a data-source href="https://github.com/Davey-Hughes/redextape">source</a>
    </footer>
    <script type="module">
      import { initPage } from '/src/pages.ts'
      initPage()
    </script>
  </body>
</html>
```

Create `web/privacy.html`:

```html
<!doctype html>
<html lang="en" data-style="instrument">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>privacy — redextape</title>
    <link rel="stylesheet" href="/src/style.css" />
    <link rel="stylesheet" href="/src/pages.css" />
    <!-- prepaint -->
  </head>
  <body class="page">
    <header class="bar">
      <a class="wordmark" href="/">redextape</a>
      <nav class="page-nav" aria-label="pages">
        <a href="/about.html">about</a>
        <a href="/help.html">help</a>
        <a href="/licences.html">licences</a>
        <a href="/privacy.html" aria-current="page">privacy</a>
      </nav>
    </header>
    <main>
      <h1>Privacy</h1>
      <p>
        redextape runs in your browser. The compiler, the λ reducer, the Turing machine and the editors' language
        server all run on this page, so nothing you type is sent anywhere.
      </p>
      <ul>
        <li>The site sets no cookies and runs no analytics.</li>
        <li>Everything it loads — the code, the WebAssembly and the fonts — comes from this site; nothing comes from another host.</li>
        <li>
          A share link carries the program in the part of the address after <code>#</code>, which a browser never
          sends to a server. Whoever you give the link to can read the program in it.
        </li>
        <li>
          Like any website, the server and Cloudflare, which sits in front of it, receive each request: your IP
          address, the page asked for and your browser's user agent.
        </li>
      </ul>

      <h2>What the app keeps in your browser</h2>
      <p>
        So that a reload finds things as you left them, the app keeps these in your browser's local storage, on this
        device only. Clearing the site's data removes them.
      </p>
      <table id="storage-keys">
        <thead>
          <tr><th scope="col">Key</th><th scope="col">Holds</th></tr>
        </thead>
        <tbody>
          <tr data-key="redextape.program"><td><code>redextape.program</code></td><td>the program's text and the encoding it compiles under</td></tr>
          <tr data-key="redextape.buffers"><td><code>redextape.buffers</code></td><td>your copies' text</td></tr>
          <tr data-key="redextape.layout"><td><code>redextape.layout</code></td><td>the views, how they are arranged, and the layout's choices</td></tr>
          <tr data-key="redextape.appearance"><td><code>redextape.appearance</code></td><td>light, dark, or following the system</td></tr>
          <tr data-key="redextape.style"><td><code>redextape.style</code></td><td>the style: Paper, Terminal or Instrument</td></tr>
          <tr data-key="redextape.palette"><td><code>redextape.palette</code></td><td>which palette is chosen</td></tr>
          <tr data-key="redextape.palette.css"><td><code>redextape.palette.css</code></td><td>that palette's colours, so the next load draws in them from its first frame</td></tr>
          <tr data-key="redextape.palette.custom"><td><code>redextape.palette.custom</code></td><td>a palette imported from a base16 scheme</td></tr>
          <tr data-key="redextape.keymap"><td><code>redextape.keymap</code></td><td>the editors' keymap: standard or vim</td></tr>
          <tr data-key="redextape.formatOnBlur"><td><code>redextape.formatOnBlur</code></td><td>whether the source is formatted when its editor loses focus</td></tr>
        </tbody>
      </table>
    </main>
    <footer class="page-foot">
      <span data-copyright>© 2026 Davey Hughes</span> · <span data-build>dev build</span> ·
      <a data-source href="https://github.com/Davey-Hughes/redextape">source</a>
    </footer>
    <script type="module">
      import { initPage } from '/src/pages.ts'
      initPage()
    </script>
  </body>
</html>
```

- [ ] **Step 6: Build them**

Modify `web/vite.config.ts`:

```diff
diff --git a/web/vite.config.ts b/web/vite.config.ts
index 1073a80..77dd638 100644
--- a/web/vite.config.ts
+++ b/web/vite.config.ts
@@ -26,6 +26,9 @@ import { inlinePrepaint } from './src/prepaint.ts'
 // config serves the same file correctly under a plain `vite dev`.
 const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
 
+/** The site's pages: the app, and the four beside it (about pages design §4). */
+const PAGES = ['index', 'about', 'help', 'licences', 'privacy']
+
 /**
  * The probes' own files, excluded from the browser project's default set unless `REDEXTAPE_PROBE` is
  * set — the `pnpm test:probe*` scripts are what set it.
@@ -114,6 +117,9 @@ export default defineConfig({
   // `.wasm`.
   build: {
     assetsInlineLimit: (filePath) => (filePath.endsWith('.wasm') ? false : undefined),
+    rolldownOptions: {
+      input: Object.fromEntries(PAGES.map((p) => [p, fileURLToPath(new URL(`${p}.html`, import.meta.url))])),
+    },
   },
   test: {
     // No `passWithNoTests`. It was set while the scaffold had no tests yet; now that both projects
```

- [ ] **Step 7: Run the tests and watch them pass; build**

Run: `pnpm exec vitest run --project node tests/node/pages.test.ts tests/node/prepaint.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  25 passed (25)`.

Run: `pnpm exec vitest run --project browser tests/browser/pages.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  2 passed (2)`.

Run: `pnpm exec vite build && ls dist/*.html && grep -c "localStorage.getItem('redextape.appearance')" dist/*.html`
Expected: five pages, each with a count of `1`.

- [ ] **Step 8: Look at them**

Run `pnpm exec vite --port 5199`, open each page at 1280 px and at 390 px, and check: the footer reads
`© 2026 Davey Hughes · dev build · source`; the current page is marked in the nav; at 390 px
`document.documentElement.scrollWidth` equals `clientWidth` on every page (the tables wrap — a `nowrap` on the key
column made `help.html` 554 px wide at 390 px in the prototype).

- [ ] **Step 9: Sabotage**

1. In `help.html`, change `data-key="F2"` to `data-key="F3"`. Expected: `lists exactly the app's own editor keys`
   fails.
2. In `web/src/editor-prefs.ts`, change `KEYMAP_KEY` to `'redextape.keymap2'`. Expected: `lists every
   redextape.* storage key the app declares` fails.
3. In `about.html`, delete `<!-- prepaint -->`. Expected: `is inlined into about.html …` fails.
4. In `pages.ts`, fill only the first `[data-copyright]` (`querySelector`). Expected: `fills every marked element,
   not only the first` fails.

- [ ] **Step 10: Commit**

```bash
git add web/about.html web/help.html web/licences.html web/privacy.html web/src/pages.ts web/src/pages.css web/vite.config.ts web/src/link-wiring.ts web/src/main.ts web/tests/node/pages.test.ts web/tests/browser/pages.test.ts web/tests/node/prepaint.test.ts
git commit -m "About, help, licences and privacy pages beside the app, each in the stored theme from its first frame"
```

---

### Task 4: The third-party notices, and the check that keeps them true

**Files:**
- Create: `web/scripts/licences.ts`, `web/src/third-party-licences.json` (generated), `scripts/check-licences.sh`,
  `web/src/licences-page.ts`
- Modify: `web/licences.html` (render the notices), `web/tsconfig.json` and `web/biome.json` (include `scripts/`;
  Biome skips the generated JSON)
- Modify: `.pre-commit-config.yaml`, `.forgejo/workflows/ci.yml` (run the check)
- Modify: `README.md`, `scripts/check-all.sh` (the hook count goes from twelve to thirteen; `check-doc-figures.sh`
  fails the README until it says so)
- Modify: `web/tests/browser/pages.test.ts` (`renderLicences`)

**Interfaces:**
- Consumes: `#own-licence` and `#notices` in `web/licences.html` (Task 3).
- Produces: `type Licences`, `type Group`, `GROUPS`, `renderLicences(root?: ParentNode, licences?: Licences): void`
  in `web/src/licences-page.ts`.

- [ ] **Step 1: Write the renderer's tests**

Modify `web/tests/browser/pages.test.ts`:

```diff
diff --git a/web/tests/browser/pages.test.ts b/web/tests/browser/pages.test.ts
index 19b75a6..8b23608 100644
--- a/web/tests/browser/pages.test.ts
+++ b/web/tests/browser/pages.test.ts
@@ -1,6 +1,8 @@
 import { describe, expect, it } from 'vitest'
 import { buildOf } from '../../src/build-info'
+import { GROUPS, type Licences, renderLicences } from '../../src/licences-page'
 import { initPage } from '../../src/pages'
+import data from '../../src/third-party-licences.json'
 
 /** Each page's footer, as `about.html` and its siblings write it before `initPage` runs. */
 const FOOTER = `
@@ -36,3 +38,68 @@ describe('initPage', () => {
     expect([...root.querySelectorAll('[data-build]')].map((e) => e.textContent)).toEqual(['dev build', 'dev build'])
   })
 })
+
+describe('renderLicences', () => {
+  const licences = data as Licences
+  const page = (): HTMLElement => {
+    const root = fixture('<div id="own-licence"><p>no script</p></div><div id="notices"><p>no script</p></div>')
+    renderLicences(root, licences)
+    return root
+  }
+
+  it("draws redextape's own licence text in place of the no-script note", () => {
+    const own = page().querySelector('#own-licence') as HTMLElement
+    expect(own.textContent).not.toContain('no script')
+    expect(own.querySelector('pre')?.textContent).toBe(licences.texts[licences.redextape.text])
+    expect(own.querySelector('pre')?.textContent).toContain('GNU GENERAL PUBLIC LICENSE')
+  })
+
+  it('draws a section per group, in order, each holding every package of that group', () => {
+    const sections = [...page().querySelectorAll<HTMLElement>('#notices > section')]
+    expect(sections.map((s) => s.dataset.group)).toEqual(GROUPS.map(([g]) => g))
+    for (const s of sections) {
+      const expected = licences.packages.filter((p) => p.group === s.dataset.group).map((p) => p.name)
+      expect(expected.length).toBeGreaterThan(0)
+      expect([...s.querySelectorAll<HTMLElement>('details')].map((d) => d.dataset.package)).toEqual(expected)
+      expect(s.querySelector('h3')?.textContent).toMatch(new RegExp(`\\(${expected.length}\\)$`))
+    }
+  })
+
+  it('draws each package with its version, licence, link and every licence text it carries', () => {
+    const root = page()
+    for (const p of licences.packages) {
+      const d = root.querySelector<HTMLElement>(`details[data-package="${p.name}"]`) as HTMLElement
+      expect(d.querySelector('summary')?.textContent).toBe(`${p.name} ${p.version} — ${p.spdx}`)
+      expect(d.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe(p.url)
+      expect([...d.querySelectorAll('pre')].map((pre) => pre.textContent)).toEqual(
+        p.files.map((f) => licences.texts[f.text]),
+      )
+    }
+  })
+
+  it('puts a licence text in as text, never as markup', () => {
+    const hostile: Licences = {
+      redextape: { spdx: 'GPL-3.0-only', text: 'a' },
+      packages: [
+        {
+          name: 'x',
+          version: '1',
+          spdx: 'MIT',
+          group: 'code',
+          url: 'https://x',
+          files: [{ file: 'LICENSE', text: 'b' }],
+        },
+      ],
+      texts: { a: 'own', b: '<img src=x onerror="throw 1"><b>bold</b>' },
+    }
+    const root = fixture('<div id="own-licence"></div><div id="notices"></div>')
+    renderLicences(root, hostile)
+    expect(root.querySelector('img')).toBeNull()
+    expect(root.querySelector('#notices pre')?.textContent).toBe('<img src=x onerror="throw 1"><b>bold</b>')
+  })
+
+  it('refuses a file naming a text it does not hold', () => {
+    const broken: Licences = { ...licences, texts: {} }
+    expect(() => renderLicences(fixture('<div id="own-licence"></div>'), broken)).toThrow(/does not hold/)
+  })
+})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run --project browser tests/browser/pages.test.ts`
Expected: `Error: Failed to import test file …/web/tests/browser/pages.test.ts` (no `src/licences-page.ts`, no JSON); `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the generator, and run it**

Create `web/scripts/licences.ts`:

```ts
/**
 * THE LICENCES THE SITE SHIPS — about pages design §8. Writes `src/third-party-licences.json`, which the licences page
 * renders: redextape's own licence, then every npm package whose code or font reaches the browser and every crate
 * compiled into the two `.wasm` builds, each with the licence texts its own package carries.
 *
 *     node scripts/licences.ts            # write src/third-party-licences.json
 *     node scripts/licences.ts --stdout   # print it instead (`scripts/check-licences.sh` diffs this)
 *
 * **OVER-INCLUDING IS HARMLESS AND UNDER-INCLUDING IS THE DEFECT**, so each side takes a closure rather than asking a
 * bundler what survived tree-shaking:
 *
 * - npm: every bare specifier `src/` imports, and every package `src/fonts.css` loads, walked along `dependencies` and
 *   `peerDependencies`. The specifiers are read from the sources, not listed here, so a new import cannot be missed.
 *   `vite` and `rolldown` are added by name: Vite's preload helper and rolldown's module helpers are in the built
 *   chunk though nothing imports them; their own dependencies are their Node build's and are not walked.
 * - Rust: `cargo metadata`'s graph for `wasm32-unknown-unknown` from the two wasm crates, along normal edges, never
 *   entering a proc-macro crate, which runs in the compiler and leaves nothing in the `.wasm`.
 *
 * Every package must carry at least one `LICENSE*`, `LICENCE*`, `COPYING*` or `NOTICE*` file, or this throws.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const REPO = join(WEB, '..')
const OUT = join(WEB, 'src', 'third-party-licences.json')

/** The crates whose `.wasm` the site serves. */
const WASM_CRATES = ['redextape-wasm', 'redextape-lsp-wasm']

/** Where each shipped package sits on the licences page. */
type Group = 'code' | 'wasm' | 'font'

type Package = {
  readonly name: string
  readonly version: string
  readonly spdx: string
  readonly group: Group
  readonly url: string
  /** Each licence file the package carries: its name, and the id of its text in `texts`. */
  readonly files: readonly { readonly file: string; readonly text: string }[]
}

const LICENCE_FILE = /^(licen[cs]e|copying|notice)/i

/**
 * What of a licence file is reproduced. Vite's `LICENSE.md` goes on to carry the licences of what Vite bundles into
 * its own Node build, none of which reaches a browser; only its first section is Vite's.
 */
function excerpt(name: string, text: string): string {
  if (name !== 'vite') return text
  const end = text.indexOf('\n# Licenses of bundled dependencies')
  if (end < 0) throw new Error("vite's LICENSE.md no longer has its bundled-dependencies heading; re-read it")
  return `${text.slice(0, end).trimEnd()}\n`
}

const texts = new Map<string, string>()

/** `text`'s id, storing it once whichever package carries it. */
function store(text: string): string {
  const id = createHash('sha256').update(text).digest('hex').slice(0, 16)
  texts.set(id, text)
  return id
}

function licenceFiles(name: string, dir: string): Package['files'] {
  const files = readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f))
    .sort()
  if (files.length === 0) throw new Error(`${name} (${dir}) carries no licence file`)
  return files.map((file) => ({ file, text: store(excerpt(name, readFileSync(join(dir, file), 'utf8'))) }))
}

/** A repository URL as a browser can open it. */
function webUrl(url: string | undefined): string {
  return (url ?? '')
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
}

// --- npm ---------------------------------------------------------------------------------------------------------

/** A specifier's package: `@scope/name` or `name`, without any path or query after it. */
const packageOf = (spec: string): string =>
  spec
    .split('/')
    .slice(0, spec.startsWith('@') ? 2 : 1)
    .join('/')

/** Every bare specifier `src/` imports or loads, comments stripped first so prose is not read as an import. */
function importedPackages(): string[] {
  const found = new Set<string>()
  for (const file of readdirSync(join(WEB, 'src'), { recursive: true }) as string[]) {
    const path = join(WEB, 'src', file)
    if (file.endsWith('.ts')) {
      const code = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      for (const m of code.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)'([^'./][^']*)'/g)) found.add(packageOf(m[1] ?? ''))
    } else if (file.endsWith('.css')) {
      const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      for (const m of css.matchAll(/(?:@import\s+|url\(\s*)"([^"./][^"]*)"/g)) found.add(packageOf(m[1] ?? ''))
    }
  }
  return [...found].sort()
}

type Manifest = {
  name: string
  version: string
  license?: string
  homepage?: string
  repository?: string | { url?: string }
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/** The directory of `name` as `fromDir` resolves it — through `exports` when it lists `package.json`, else on disk. */
function packageDir(name: string, fromDir: string): string {
  try {
    return dirname(realpathSync(createRequire(join(fromDir, 'noop.js')).resolve(`${name}/package.json`)))
  } catch {
    for (let d = fromDir; ; d = dirname(d)) {
      try {
        return dirname(realpathSync(join(d, 'node_modules', name, 'package.json')))
      } catch {
        if (dirname(d) === d) throw new Error(`${name} does not resolve from ${fromDir}`)
      }
    }
  }
}

function npmPackages(): Package[] {
  const fonts = new Set(['@fontsource/inter', 'hack-font'])
  const seen = new Map<string, Package>()
  const visit = (name: string, fromDir: string, walk: boolean): string => {
    const dir = packageDir(name, fromDir)
    const m = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest
    const key = `${m.name}@${m.version}`
    if (!seen.has(key)) {
      const repo = typeof m.repository === 'string' ? m.repository : m.repository?.url
      seen.set(key, {
        name: m.name,
        version: m.version,
        spdx: m.license ?? 'SEE LICENSE',
        group: fonts.has(m.name) ? 'font' : 'code',
        url: webUrl(m.homepage ?? repo),
        files: licenceFiles(m.name, dir),
      })
      if (walk) for (const dep of Object.keys({ ...m.dependencies, ...m.peerDependencies })) visit(dep, dir, true)
    }
    return dir
  }
  for (const name of importedPackages()) visit(name, WEB, true)
  const vite = visit('vite', WEB, false)
  visit('rolldown', vite, false)
  return [...seen.values()]
}

// --- Rust --------------------------------------------------------------------------------------------------------

type Metadata = {
  packages: {
    id: string
    name: string
    version: string
    license: string | null
    repository: string | null
    homepage: string | null
    source: string | null
    manifest_path: string
    targets: { kind: string[] }[]
  }[]
  resolve: { nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[] }
}

function wasmCrates(): Package[] {
  const raw = execFileSync(
    'cargo',
    ['metadata', '--format-version', '1', '--filter-platform', 'wasm32-unknown-unknown', '--locked'],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const meta = JSON.parse(raw) as Metadata
  const byId = new Map(meta.packages.map((p) => [p.id, p]))
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
  const procMacro = (id: string): boolean => byId.get(id)?.targets.some((t) => t.kind.includes('proc-macro')) ?? false
  const stack = meta.packages.filter((p) => WASM_CRATES.includes(p.name)).map((p) => p.id)
  if (stack.length !== WASM_CRATES.length) throw new Error(`cargo metadata lacks one of ${WASM_CRATES.join(', ')}`)
  const reached = new Set<string>()
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (reached.has(id)) continue
    reached.add(id)
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind === null) && !procMacro(dep.pkg)) stack.push(dep.pkg)
    }
  }
  return [...reached].flatMap((id) => {
    const p = byId.get(id)
    // `source` is null for a path dependency: this workspace's own crates, which are redextape's licence.
    if (p === undefined || p.source === null) return []
    return [
      {
        name: p.name,
        version: p.version,
        spdx: p.license ?? 'SEE LICENSE',
        group: 'wasm' as const,
        url: webUrl(p.repository ?? p.homepage ?? `https://crates.io/crates/${p.name}`),
        files: licenceFiles(p.name, dirname(p.manifest_path)),
      },
    ]
  })
}

// --- output ------------------------------------------------------------------------------------------------------

const ORDER: Record<Group, number> = { code: 0, wasm: 1, font: 2 }

const packages = [...npmPackages(), ...wasmCrates()].sort(
  (a, b) => ORDER[a.group] - ORDER[b.group] || a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
)
const own = { spdx: 'GPL-3.0-only', text: store(readFileSync(join(REPO, 'LICENSE.md'), 'utf8')) }
const sortedTexts = Object.fromEntries([...texts].sort(([a], [b]) => a.localeCompare(b)))
const json = `${JSON.stringify({ redextape: own, packages, texts: sortedTexts }, null, 2)}\n`

if (process.argv.includes('--stdout')) process.stdout.write(json)
else writeFileSync(OUT, json)
```

Modify `web/tsconfig.json`:

```diff
diff --git a/web/tsconfig.json b/web/tsconfig.json
index e174ffb..09a76b5 100644
--- a/web/tsconfig.json
+++ b/web/tsconfig.json
@@ -16,5 +16,5 @@
     "noEmit": true,
     "allowImportingTsExtensions": true
   },
-  "include": ["src", "tests", "vite.config.ts"]
+  "include": ["src", "tests", "scripts", "vite.config.ts"]
 }
```

Modify `web/biome.json`:

```diff
diff --git a/web/biome.json b/web/biome.json
index cb98dc0..8808b4c 100644
--- a/web/biome.json
+++ b/web/biome.json
@@ -1,6 +1,6 @@
 {
   "$schema": "https://biomejs.dev/schemas/2.5.7/schema.json",
-  "files": { "includes": ["src/**", "tests/**", "*.ts", "*.json"] },
+  "files": { "includes": ["src/**", "tests/**", "scripts/**", "*.ts", "*.json", "!src/third-party-licences.json"] },
   "formatter": {
     "enabled": true,
     "indentStyle": "space",
```

Run: `node scripts/licences.ts && node scripts/licences.ts --stdout | cmp - src/third-party-licences.json && echo identical`
Expected: `identical` (the generator is deterministic). The file holds 18 `code`, 28 `wasm` and 2 `font` packages:
`node -e "const d=require('./src/third-party-licences.json'); const c={}; for (const p of d.packages) c[p.group]=(c[p.group]??0)+1; console.log(c)"`
prints `{ code: 18, wasm: 28, font: 2 }` at this lockfile.

- [ ] **Step 4: Write the renderer and draw it on the page**

Create `web/src/licences-page.ts`:

```ts
import data from './third-party-licences.json'

/**
 * THE LICENCES PAGE'S LIST — about pages design §4 and §8. `third-party-licences.json` is written by
 * `scripts/licences.ts` and held to the lockfiles by `scripts/check-licences.sh`; this draws it: redextape's own
 * licence text, then every shipped package, grouped by where it ships, each a `<details>` holding its licence texts.
 *
 * Every text goes in through `textContent`, never as markup: a licence file is the package's own and is not this
 * site's to trust.
 */

/** Where a package ships, as `scripts/licences.ts` records it. */
export type Group = 'code' | 'wasm' | 'font'

/** The shape `scripts/licences.ts` writes. A text is stored once and named by its id wherever it is carried. */
export type Licences = {
  readonly redextape: { readonly spdx: string; readonly text: string }
  readonly packages: readonly {
    readonly name: string
    readonly version: string
    readonly spdx: string
    readonly group: Group
    readonly url: string
    readonly files: readonly { readonly file: string; readonly text: string }[]
  }[]
  readonly texts: Readonly<Record<string, string>>
}

/** The page's sections, in its order. */
export const GROUPS: readonly (readonly [Group, string])[] = [
  ['code', "In the page's code"],
  ['wasm', 'In the WebAssembly'],
  ['font', 'Fonts'],
]

function textOf(licences: Licences, id: string): string {
  const text = licences.texts[id]
  if (text === undefined) throw new Error(`third-party-licences.json names a text it does not hold: ${id}`)
  return text
}

function pre(text: string): HTMLPreElement {
  const el = document.createElement('pre')
  el.textContent = text
  return el
}

/**
 * Fill `#own-licence` with redextape's licence text and `#notices` with a section per group, replacing what the
 * static page holds there for a reader without JavaScript.
 */
export function renderLicences(root: ParentNode = document, licences: Licences = data as Licences): void {
  const own = root.querySelector('#own-licence')
  if (own !== null) {
    const d = document.createElement('details')
    const s = document.createElement('summary')
    s.textContent = `The licence text (${licences.redextape.spdx})`
    d.append(s, pre(textOf(licences, licences.redextape.text)))
    own.replaceChildren(d)
  }
  const notices = root.querySelector('#notices')
  if (notices === null) return
  notices.replaceChildren(
    ...GROUPS.map(([group, heading]) => {
      const section = document.createElement('section')
      section.dataset.group = group
      const h = document.createElement('h3')
      const members = licences.packages.filter((p) => p.group === group)
      h.textContent = `${heading} (${members.length})`
      section.append(
        h,
        ...members.map((p) => {
          const d = document.createElement('details')
          d.dataset.package = p.name
          const s = document.createElement('summary')
          s.textContent = `${p.name} ${p.version} — ${p.spdx}`
          const meta = document.createElement('p')
          meta.className = 'meta'
          const a = document.createElement('a')
          a.href = p.url
          a.textContent = p.url
          meta.append(a)
          d.append(s, meta)
          for (const f of p.files) {
            const name = document.createElement('p')
            name.className = 'meta'
            name.textContent = f.file
            d.append(name, pre(textOf(licences, f.text)))
          }
          return d
        }),
      )
      return section
    }),
  )
}
```

Modify `web/licences.html`:

```diff
diff --git a/web/licences.html b/web/licences.html
index a4fddec..2b8befb 100644
--- a/web/licences.html
+++ b/web/licences.html
@@ -56,7 +56,9 @@
       <a data-source href="https://github.com/Davey-Hughes/redextape">source</a>
     </footer>
     <script type="module">
+      import { renderLicences } from '/src/licences-page.ts'
       import { initPage } from '/src/pages.ts'
+      renderLicences()
       initPage()
     </script>
   </body>
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm exec vitest run --project browser tests/browser/pages.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  7 passed (7)`.

- [ ] **Step 6: Write the check and wire it in**

Create `scripts/check-licences.sh`:

```bash
#!/usr/bin/env bash
# Reject a third-party licence file that no longer matches what the site ships.
#
# CI invokes this same script (.forgejo/workflows/ci.yml) and so does the pre-commit hook
# (.pre-commit-config.yaml), so the local and CI gates cannot drift — the convention
# `scripts/check-all.sh` already states.
#
#   scripts/check-licences.sh              # regenerate into a temporary file and compare
#   scripts/check-licences.sh --self-test  # prove the comparison still fires
#
# WHY THIS GATE EXISTS. The licences page (`web/licences.html`) renders `web/src/third-party-licences.json`,
# which `web/scripts/licences.ts` writes from the installed npm packages and `cargo metadata` — every package
# whose code or font reaches the browser, with the licence texts it carries (about pages design §8). The file
# is committed so a dependency bump shows up as a reviewable diff and the Docker build needs no cargo; the
# price is that it can go stale, and a stale one names licences the site no longer ships, or misses one it
# does. This regenerates it and fails on any difference.
#
# IT NEEDS WHAT THE GENERATOR NEEDS: `web/node_modules` installed and `cargo` able to read the lockfile.
# `cargo metadata --locked` downloads nothing that `Cargo.lock` does not already name.
#
# THE FIX IS ALWAYS TO REGENERATE, NEVER TO EDIT THE JSON: `cd web && node scripts/licences.ts`.

set -euo pipefail
cd "$(dirname "$0")/.."

readonly COMMITTED=web/src/third-party-licences.json

fail() {
  echo "check-licences: $*" >&2
  exit 1
}

# Succeed when $1 and $2 are byte-identical; otherwise print what differs and fail. Drives the real check AND
# the self-test, so the self-test cannot drift into agreeing with a broken check.
compare() {
  local committed="$1" generated="$2"
  [ -f "$committed" ] || {
    echo "$committed: does not exist" >&2
    return 1
  }
  cmp -s "$committed" "$generated" && return 0
  diff -u "$committed" "$generated" | head -40 >&2 || true
  return 1
}

generate() {
  (cd web && node scripts/licences.ts --stdout) >"$1" || fail "web/scripts/licences.ts failed"
}

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp:?}"' EXIT

# ---------------------------------------------------------------------------- self-test
if [ "${1:-}" = "--self-test" ]; then
  good="$tmp/good.json"
  generate "$good"
  compare "$good" "$good" 2>/dev/null || fail "self-test: a file was reported as differing from itself"

  # A package the site stopped shipping, still listed: the first package's whole entry gone from the copy.
  python3 -I - "$good" "$tmp/dropped.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["packages"], "no packages to drop"
d["packages"] = d["packages"][1:]
open(sys.argv[2], "w").write(json.dumps(d, indent=2) + "\n")
PY
  if compare "$tmp/dropped.json" "$good" 2>/dev/null; then
    fail "self-test: a committed file missing a package was accepted"
  fi

  # A licence text changed upstream, one character of it.
  sed '0,/Permission is hereby granted/s//Permission is hereby GRANTED/' "$good" >"$tmp/edited.json"
  cmp -s "$tmp/edited.json" "$good" && fail "self-test: the edit did not change the copy, so it proves nothing"
  if compare "$tmp/edited.json" "$good" 2>/dev/null; then
    fail "self-test: a committed file with a changed licence text was accepted"
  fi

  if compare "$tmp/absent.json" "$good" 2>/dev/null; then
    fail "self-test: a missing committed file was accepted"
  fi
  echo "check-licences: self-test passed"
  exit 0
fi

# ---------------------------------------------------------------------------- check
generate "$tmp/generated.json"
compare "$COMMITTED" "$tmp/generated.json" ||
  fail "$COMMITTED is stale; regenerate it with \`cd web && node scripts/licences.ts\` and commit the result"
echo "check-licences: $COMMITTED matches what the site ships"
```

Run (from the repository root): `chmod +x scripts/check-licences.sh && scripts/check-licences.sh --self-test && scripts/check-licences.sh`
Expected: `check-licences: self-test passed` then `check-licences: web/src/third-party-licences.json matches what the site ships`.

Modify `.pre-commit-config.yaml`:

```diff
diff --git a/.pre-commit-config.yaml b/.pre-commit-config.yaml
index f887364..fa9d17a 100644
--- a/.pre-commit-config.yaml
+++ b/.pre-commit-config.yaml
@@ -179,6 +179,15 @@ repos:
         language: system
         always_run: true
         pass_filenames: false
+      # UNSCOPED FOR THE SIBLINGS' REASON: what makes `web/src/third-party-licences.json` stale is a lockfile, an
+      # import or a dependency's own licence file, not the file being committed. It needs `web/node_modules` and
+      # `cargo`, as the generator does. Self-test first, then the check.
+      - id: check-licences
+        name: third-party licences match what the site ships
+        entry: bash -c 'scripts/check-licences.sh --self-test && scripts/check-licences.sh'
+        language: system
+        always_run: true
+        pass_filenames: false
       - id: check-lua
         name: lua parses and parser names agree
         entry: bash -c 'scripts/check-lua.sh --self-test && scripts/check-lua.sh'
```

Modify `.forgejo/workflows/ci.yml`:

```diff
diff --git a/.forgejo/workflows/ci.yml b/.forgejo/workflows/ci.yml
index b9c77ce..22b76ef 100644
--- a/.forgejo/workflows/ci.yml
+++ b/.forgejo/workflows/ci.yml
@@ -910,6 +910,12 @@ jobs:
         run: pnpm run build:lsp-wasm
       - name: Generate the wire-type bindings (web/bindings is gitignored; typecheck resolves against it)
         run: pnpm run build:bindings
+      # THE LICENCES PAGE'S LIST, REGENERATED AND COMPARED. In this job and not with the hygiene scans in
+      # `linear-history`, because this is the job with both `node_modules` and cargo, which the generator reads.
+      - name: Third-party licences match what the site ships (self-test)
+        run: ../scripts/check-licences.sh --self-test
+      - name: Third-party licences match what the site ships
+        run: ../scripts/check-licences.sh
       - name: Install the Chromium Playwright needs
         run: pnpm exec playwright install --with-deps chromium
       - name: Lint + format check
```

Modify `README.md`:

```diff
diff --git a/README.md b/README.md
index 3722653..25c817d 100644
--- a/README.md
+++ b/README.md
@@ -303,25 +303,30 @@ nextest is missing rather than falling back, so the gate behaves the same everyw
 `scripts/setup-dev.sh` installs it. Because nextest does not run doctests, the script pairs every
 config with an explicit `cargo test --doc` at the same feature flags.
 
-There are **twelve** pre-commit hooks. A Rust change runs `cargo fmt` and `cargo clippy` and nothing
+There are **thirteen** pre-commit hooks. A Rust change runs `cargo fmt` and `cargo clippy` and nothing
 heavier; a `web/` change runs `biome ci` and `tsc --noEmit`; a Lua or `parser.c` change runs
 `check-lua`, which parses the tracked Lua and asserts `plugin/redextape.lua`'s parser names still
 equal the `tree_sitter_*` symbols the committed parsers export — a mismatch there loads the wrong
 language in an editor rather than failing, so nothing else in this tree could see it. The other
-seven — `check-text-bytes`, `check-citations`, `check-attributions`, `check-doc-figures`,
-`check-shared-docs`, `check-colours` and `check-grammar-wasm` — are unscoped and run on every commit
-whatever is staged, because all seven catch things that arrive in a path nobody thought to list; the
+eight — `check-text-bytes`, `check-citations`, `check-attributions`, `check-doc-figures`,
+`check-shared-docs`, `check-colours`, `check-grammar-wasm` and `check-licences` — are unscoped and run
+on every commit whatever is staged, because all eight catch things that arrive in a path nobody thought
+to list; the
 first three walk `git ls-files`, the fourth reads four READMEs, the fifth holds every marked region
 in a document to the single copy under `grammars/shared/`, the sixth scans tracked `.css` and `.ts`
 files under `web/src/` for colour literals outside the palette, skipping `palettes.ts` itself and the
 marked fallback block in `style.css`, and the seventh hashes each grammar's `src/parser.c` and its
 `.wasm` against `grammars/wasm-manifest.json` — unscoped because the file that goes stale is the
 `.wasm`, and the file being committed is `grammar.js` or `src/parser.c`, on the other side of the
-same input set `check-lua`'s own scoping already names. `check-grammar-wasm` is the newest of the
-seven and `check-attributions` the slowest, at ~3.2 s against the next slowest's ~1.25 s (each
+same input set `check-lua`'s own scoping already names. The eighth regenerates
+`web/src/third-party-licences.json`, the list the site's licences page draws, from the installed npm
+packages and `cargo metadata`, and compares it with the committed copy — unscoped because what makes it
+stale is a lockfile, an import or a dependency's own licence file, not the file being committed; it
+needs `web/node_modules` and `cargo`, and took 0.48-0.72 s with its self-test over five runs
+(2026-10-08). `check-licences` is the newest of the eight and `check-attributions` the slowest, at ~3.2 s against the next slowest's ~1.25 s (each
 hook's `--self-test` and scan, measured 2026-09-18), because it strips comments and string literals
 out of every cited file rather than matching patterns line by line — the price of being able to tell
-a file that OWNS a symbol from one that merely talks about it. All **twelve** are fast enough for
+a file that OWNS a symbol from one that merely talks about it. All **thirteen** are fast enough for
 every commit: measured interleaved in one session (2026-09-21, five rounds, alternating which set
 went first, after one untimed warm-up of each), the unscoped six ran 5.867-5.955 s and the same six
 plus `check-grammar-wasm` ran 6.042-6.084 s — the ranges do not overlap, so the ~0.09-0.22 s gap is
```

Modify `scripts/check-all.sh`:

```diff
diff --git a/scripts/check-all.sh b/scripts/check-all.sh
index 8d5c8ec..bf87c75 100755
--- a/scripts/check-all.sh
+++ b/scripts/check-all.sh
@@ -3,12 +3,12 @@
 #
 # CI invokes this same script (.forgejo/workflows/ci.yml), so the local and CI gates cannot drift.
 # The pre-commit hooks deliberately do NOT run it — they stay fast: fmt and clippy on a Rust change,
-# biome and tsc on a web/ one, the Lua/parser check on a grammar one, plus seven `always_run` tree-wide
+# biome and tsc on a web/ one, the Lua/parser check on a grammar one, plus eight `always_run` tree-wide
 # gates (control bytes, `file:line` citations, symbol-citation attributions, documented figures, shared
-# doc regions, colour literals, grammar `.wasm`) on every commit. **This comment read "four" and named
+# doc regions, colour literals, grammar `.wasm`, third-party licences) on every commit. **This comment read "four" and named
 # only the first four** — check-colours and check-grammar-wasm were added later and never counted here;
 # recount is `.pre-commit-config.yaml`'s `always_run: true` entries, not this comment.
-# Twelve hooks; this is the before-a-merge check.
+# Thirteen hooks; this is the before-a-merge check.
 #
 #   scripts/check-all.sh                  # everything: base, LLVM and browser configs
 #   scripts/check-all.sh --no-llvm        # skip LLVM (no toolchain installed)
```

Run: `scripts/check-doc-figures.sh`
Expected: `check-doc-figures: 46 documented figures match the tree.`

- [ ] **Step 7: Sabotage**

1. In `web/src/third-party-licences.json`, change `@codemirror/view`'s `"version"`. Expected:
   `scripts/check-licences.sh` fails with a diff naming it and the regenerate command.
2. In `web/src/licences-page.ts`, write `el.innerHTML = text` in `pre`. Expected: `puts a licence text in as text,
   never as markup` fails (and two more cases that compare texts).

- [ ] **Step 8: Commit**

```bash
git add web/scripts/licences.ts web/src/third-party-licences.json scripts/check-licences.sh web/src/licences-page.ts web/licences.html web/tsconfig.json web/biome.json .pre-commit-config.yaml .forgejo/workflows/ci.yml README.md scripts/check-all.sh web/tests/browser/pages.test.ts
git commit -m "The licences page lists every package the site ships with its own licence texts, generated and held to the lockfiles by check-licences.sh"
```

---

### Task 5: The about menu

`about ▾`, just before `settings` — which stays the header's last control, so a Tab from it still reaches the notice
line's *undo* (`base16-remove.test.ts` holds that) — a popover of links to the four pages and the source, each in a
new tab, with the build beneath.

**Files:**
- Modify: `web/index.html`, `web/tests/browser/harness.ts` (the menu, in both copies — `harness.test.ts` holds them
  equal)
- Modify: `web/src/app-header.ts` (`wireMenu` focuses a first link)
- Modify: `web/src/style.css` (the button and the menu)
- Modify: `web/src/main.ts` (wire it before `init()`, fill the build and the source link)
- Create: `web/tests/browser/about-menu.test.ts`

**Interfaces:**
- Consumes: `BUILD` (Task 2); `wireMenu` in `web/src/app-header.ts` (existing).

- [ ] **Step 1: Write the test, and the menu into the test shell**

Create `web/tests/browser/about-menu.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { BUILD } from '../../src/build-info'
import { SHELL, until } from './harness'

/**
 * **THE ABOUT MENU** — about pages design §5: just before settings, a popover of links to the four pages and the
 * source, each opening in a new tab so the app keeps its stepping position, and the build beneath them. ONE MOUNT
 * FOR THE FILE, for the reason every sibling gives.
 */

const button = () => document.querySelector<HTMLButtonElement>('#about') as HTMLButtonElement
const menu = () => document.querySelector<HTMLElement>('#about-menu') as HTMLElement
const links = () => [...menu().querySelectorAll<HTMLAnchorElement>('a')]

beforeAll(async () => {
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('the about menu', () => {
  it('opens on a click, says so, and focuses its first link', async () => {
    expect(button().getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(button())
    expect(menu().matches(':popover-open')).toBe(true)
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(links()[0])
    await userEvent.keyboard('{Escape}')
    expect(menu().matches(':popover-open')).toBe(false)
    expect(button().getAttribute('aria-expanded')).toBe('false')
  })

  it('links the four pages and the source, each in a new tab with no opener', () => {
    expect(links().map((a) => a.textContent?.trim())).toEqual(['about', 'help', 'licences', 'privacy', 'source ↗'])
    expect(
      links()
        .map((a) => new URL(a.href).pathname)
        .slice(0, 4),
    ).toEqual(['/about.html', '/help.html', '/licences.html', '/privacy.html'])
    for (const a of links()) {
      expect(a.target, a.textContent ?? '').toBe('_blank')
      expect(a.rel, a.textContent ?? '').toBe('noopener')
    }
  })

  /** Vitest defines no commit, so this build is a dev build and its source is the mirror's `main`. */
  it("names this build and links this build's source", () => {
    expect(document.querySelector('#about-build')?.textContent).toBe(BUILD.label)
    expect(document.querySelector<HTMLAnchorElement>('#about-source')?.href).toBe(BUILD.source)
    expect(BUILD.label).toBe('dev build')
  })

  it('draws its links as the other menus draw their items, without underlines', async () => {
    await userEvent.click(button())
    try {
      const first = getComputedStyle(links()[0] as HTMLAnchorElement)
      expect(first.display).toBe('block')
      expect(first.textDecorationLine).toBe('none')
    } finally {
      menu().hidePopover()
    }
  })
})
```

Modify `web/tests/browser/harness.ts`:

```diff
diff --git a/web/tests/browser/harness.ts b/web/tests/browser/harness.ts
index 7a6f396..8a0a291 100644
--- a/web/tests/browser/harness.ts
+++ b/web/tests/browser/harness.ts
@@ -48,6 +48,15 @@ export const SHELL = `
     <button type="button" id="share" aria-controls="share-menu" aria-expanded="false">share</button>
     <div id="share-menu" class="header-menu share" popover></div>
     <button type="button" id="appearance"></button>
+    <button type="button" id="about" aria-controls="about-menu" aria-expanded="false">about <span aria-hidden="true">▾</span></button>
+    <div id="about-menu" class="header-menu about" popover>
+      <a href="/about.html" target="_blank" rel="noopener">about</a>
+      <a href="/help.html" target="_blank" rel="noopener">help</a>
+      <a href="/licences.html" target="_blank" rel="noopener">licences</a>
+      <a href="/privacy.html" target="_blank" rel="noopener">privacy</a>
+      <a id="about-source" href="https://github.com/Davey-Hughes/redextape" target="_blank" rel="noopener">source <span aria-hidden="true">↗</span></a>
+      <p id="about-build" class="about-build"></p>
+    </div>
     <button type="button" id="settings" aria-haspopup="menu" aria-controls="settings-menu" aria-expanded="false">settings</button>
     <div id="settings-menu" class="header-menu settings" popover>
       <label class="skin">style <select id="style"></select></label>
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run --project node tests/node/harness.test.ts`
Expected: `Tests  1 failed | 12 passed (13)` — `is the same markup the real page ships, from <header> to the end of the strip`: the test shell has the menu and `index.html` does not yet.

Run: `pnpm exec vitest run --project browser tests/browser/about-menu.test.ts`
Expected: `Tests  3 failed | 1 passed (4)` — `opens on a click …`, `names this build …` and `draws its links …` fail; the links case passes, since the shell itself carries the links.

- [ ] **Step 3: Write the menu, its style, its focus and its wiring**

Modify `web/index.html`:

```diff
diff --git a/web/index.html b/web/index.html
index 5ea879e..661ae55 100644
--- a/web/index.html
+++ b/web/index.html
@@ -36,6 +36,15 @@
       <button type="button" id="share" aria-controls="share-menu" aria-expanded="false">share</button>
       <div id="share-menu" class="header-menu share" popover></div>
       <button type="button" id="appearance"></button>
+      <button type="button" id="about" aria-controls="about-menu" aria-expanded="false">about <span aria-hidden="true">▾</span></button>
+      <div id="about-menu" class="header-menu about" popover>
+        <a href="/about.html" target="_blank" rel="noopener">about</a>
+        <a href="/help.html" target="_blank" rel="noopener">help</a>
+        <a href="/licences.html" target="_blank" rel="noopener">licences</a>
+        <a href="/privacy.html" target="_blank" rel="noopener">privacy</a>
+        <a id="about-source" href="https://github.com/Davey-Hughes/redextape" target="_blank" rel="noopener">source <span aria-hidden="true">↗</span></a>
+        <p id="about-build" class="about-build"></p>
+      </div>
       <button type="button" id="settings" aria-haspopup="menu" aria-controls="settings-menu" aria-expanded="false">settings</button>
       <div id="settings-menu" class="header-menu settings" popover>
         <label class="skin">style <select id="style"></select></label>
```

Modify `web/src/app-header.ts`:

```diff
diff --git a/web/src/app-header.ts b/web/src/app-header.ts
index 284b954..053e52e 100644
--- a/web/src/app-header.ts
+++ b/web/src/app-header.ts
@@ -22,7 +22,7 @@ export function wireMenu(button: HTMLButtonElement, menu: HTMLElement, onOpen?:
     button.setAttribute('aria-expanded', String(open))
     if (!open) return
     onOpen?.()
-    const first = menu.querySelector<HTMLElement>('button:not([disabled]), select')
+    const first = menu.querySelector<HTMLElement>('a[href], button:not([disabled]), select')
     if (first !== null) first.autofocus = true
   })
 }
```

Modify `web/src/style.css`:

```diff
diff --git a/web/src/style.css b/web/src/style.css
index 3de4022..b0ad9c5 100644
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -233,7 +233,8 @@ select option {
 #examples,
 #share,
 #appearance,
-#settings {
+#settings,
+#about {
   display: inline-flex;
   align-items: center;
   gap: 0.35em;
@@ -265,7 +266,8 @@ select option {
     margin: auto;
   }
 }
-.header-menu > button {
+.header-menu > button,
+.header-menu > a {
   display: block;
   width: 100%;
   text-align: left;
@@ -277,6 +279,22 @@ select option {
   color: inherit;
   cursor: pointer;
 }
+/* THE ABOUT MENU (about pages design §5): links, drawn as the other menus' items, and the build beneath a rule. It
+   sits just before settings, which stays the header's last control so a Tab from it still reaches the notice line's
+   action, and opens leftward as settings does. */
+.header-menu > a {
+  text-decoration: none;
+}
+.header-menu.about {
+  position-area: block-end span-inline-start;
+}
+.about-build {
+  margin: var(--space-1) 0 0;
+  padding: var(--space-1) 0.6em 0;
+  border-top: 1px solid var(--rule);
+  color: var(--fg-dim);
+  font-size: var(--step--1);
+}
 /* **`:popover-open`, NOT THE BARE CLASS — A CLOSED POPOVER IS HIDDEN BY A UA RULE AN AUTHOR RULE BEATS.**
    `[popover]:not(:popover-open) { display: none }` comes from the user-agent stylesheet, and any author
    `display` wins over it whatever its specificity. Written as `.header-menu.settings { display: grid }`,
```

Modify `web/src/main.ts`:

```diff
diff --git a/web/src/main.ts b/web/src/main.ts
index 3eb1b8e..e67fba9 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -18,6 +18,7 @@ import { schemeName } from './base16'
 import { createBase16Dialog } from './base16-dialog'
 import { bufferList } from './buffer-list'
 import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from './buffers-store'
+import { BUILD } from './build-info'
 import { type CaptureTable, classMapFrom, createGrammarRegistry, treeSitterColour } from './colour'
 import { createCompile } from './compile'
 import {
@@ -231,6 +232,10 @@ async function main(): Promise<EditorView> {
   const examplesMenu = document.querySelector<HTMLElement>('#examples-menu')
   const shareButton = document.querySelector<HTMLButtonElement>('#share')
   const shareMenu = document.querySelector<HTMLElement>('#share-menu')
+  const aboutButton = document.querySelector<HTMLButtonElement>('#about')
+  const aboutMenu = document.querySelector<HTMLElement>('#about-menu')
+  const aboutSource = document.querySelector<HTMLAnchorElement>('#about-source')
+  const aboutBuild = document.querySelector<HTMLElement>('#about-build')
   const noticeHost = document.querySelector<HTMLElement>('#notice')
   const liveHost = document.querySelector<HTMLElement>('#live')
   // **`#views`, NOT `<main>` — spec §9.** `renderLayout` opens with `root.replaceChildren()`, so the
@@ -262,6 +267,10 @@ async function main(): Promise<EditorView> {
     !examplesMenu ||
     !shareButton ||
     !shareMenu ||
+    !aboutButton ||
+    !aboutMenu ||
+    !aboutSource ||
+    !aboutBuild ||
     !noticeHost ||
     !stepBarHost ||
     !inspectorHost ||
@@ -390,6 +399,12 @@ async function main(): Promise<EditorView> {
   // THE SETTINGS MENU, wired before `init()` with the toggle, for the toggle's own reason.
   wireMenu(settingsButton, settingsMenu)
   settingsButton.replaceChildren(icon('settings'), document.createTextNode('settings'))
+  // THE ABOUT MENU (about pages design §5), wired here for the settings menu's reason: its links need no wasm, so a
+  // page whose startup failed still reaches the help, the licences and the source. The build line and the source link
+  // are this build's (`build-info.ts`), as on every page's footer.
+  wireMenu(aboutButton, aboutMenu)
+  aboutSource.href = BUILD.source
+  aboutBuild.textContent = BUILD.label
 
   // THE STYLE AND PALETTE (Plan 7 part 1, spec §6), wired before `init()` for the appearance toggle's
   // reason: they touch nothing but storage and `<html>`, so they stay live on the startup-failure path.
```

- [ ] **Step 4: Run them and the header's neighbours, and watch them pass**

Run: `pnpm exec vitest run --project node tests/node/harness.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  13 passed (13)`.

Run: `pnpm exec vitest run --project browser tests/browser/about-menu.test.ts tests/browser/base16-remove.test.ts tests/browser/header-menus-narrow.test.ts`
Expected: `Test Files  3 passed (3)`, `Tests  48 passed (48)`.

- [ ] **Step 5: Sabotage**

1. In `wireMenu`, drop `a[href], ` from the first-focus query. Expected: `opens on a click, says so, and focuses its
   first link` fails.
2. In `main.ts`, delete `aboutBuild.textContent = BUILD.label`. Expected: `names this build and links this build's
   source` fails (the HTML holds the build line empty, so only `main.ts` can fill it).
3. Move the about button and menu after `settings`'s popover in both copies. Expected: 12 of
   `base16-remove.test.ts`'s 15 cases fail, the first `is undone exactly …` — the tab order this task keeps.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/tests/browser/harness.ts web/src/app-header.ts web/src/style.css web/src/main.ts web/tests/browser/about-menu.test.ts
git commit -m "An about menu before settings reaches the four pages and the source in a new tab, and names the build"
```

---

### Task 6: Verify the branch, build the image, write the roadmap entry

- [ ] **Step 1: Every gate CI runs for these paths**

From `web/`: `pnpm exec biome ci --error-on-warnings`, `pnpm run typecheck`, `pnpm run test:coverage` (both projects
and the coverage floor), `pnpm run build:app`. From the root: each of `scripts/check-text-bytes.sh`,
`check-citations.sh`, `check-attributions.sh`, `check-doc-figures.sh`, `check-shared-docs.sh`, `check-colours.sh`,
`check-grammar-wasm.sh`, `check-lua.sh` and `check-licences.sh`, with `--self-test` and then alone. Every one passes.
A failure in a file this branch did not touch is checked against `main` before it is called a flake.

- [ ] **Step 2: Build and run the image, and fetch every page from it**

```bash
docker build --build-arg COMMIT_HASH="$(git rev-parse HEAD)" -t redextape-about-pages .
docker run -d --rm --name redextape-about-pages -p 55099:80 redextape-about-pages
for p in / /about.html /help.html /licences.html /privacy.html /licenses/inter-LICENSE.txt; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:55099$p")" "$p"
done
curl -s http://127.0.0.1:55099/about.html | grep -c "localStorage.getItem('redextape.appearance')"
docker stop redextape-about-pages
```

Expected: `200` for all six; `1`. Then open `http://127.0.0.1:55099/` before stopping it and check that the about
menu reads `build <first seven of HEAD>` and its `source ↗` opens `…/tree/<HEAD>`.

- [ ] **Step 3: The roadmap entry**

Add an entry to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` in the existing shape — heading with date,
branch and commit range, its sections, `WHAT THIS DID NOT CLOSE` (a favicon, which the site still 404s; the header's
`aria-haspopup` question, unchanged), and a VERIFICATION block whose every figure names the command that produced it.
Anchor it last, after the final code commit.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "Roadmap: the about, help, licences and privacy pages"
```
