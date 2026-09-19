# Plan 7, part 1 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every colour in the web app come from a palette stored as data, add three styles (Instrument the default, with self-hosted Inter and Hack), a colour gate, a panel primitive and icon registry, one focus ring, and a non-colour shape for every marked state.

**Architecture:** Palettes are typed data in `web/src/palettes.ts`, written onto `<html>` as `light-dark()` custom properties by `web/src/skin.ts`; the appearance toggle keeps flipping `color-scheme` exactly as today. Styles are `[data-style]` CSS blocks carrying only non-colour tokens. `web/src/panel.ts` is the one disclosure mechanism; the TM rule table and the two editor collapses move onto it.

**Tech Stack:** TypeScript 7 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vite 8, Vitest 4 (node and browser projects, Playwright Chromium), Biome 2, bash + perl for the gate, CodeMirror 6.

**Spec:** `docs/superpowers/specs/2026-09-17-plan7-part1-foundations-design.md`. Umbrella: `docs/superpowers/specs/2026-09-17-frontend-overhaul-design.md`.

## Global Constraints

- Branch `plan7-part1-foundations`, stacked on `frontend-overhaul-design` (PR #97). Never `--no-verify`; the pre-commit hook runs Biome, `web typecheck` (which runs `cargo` through `build:bindings`) and the hygiene gates on every commit.
- The wasm package must exist at the repo root's `pkg/` before any browser test or `build:app` runs: `pnpm run build:wasm:dev` from `web/` if it is missing or older than the last change under `crates/redextape-wasm` or `crates/redextape-core`.
- A comment that cites `` `file.ts`'s `symbol` `` must not land in a commit before the commit that creates that symbol — `scripts/check-attributions.sh` fails on a citation to a file or symbol that does not exist yet.
- Run web commands from `web/`. **Scope a test run by passing the path positionally:** `pnpm exec vitest run --project node tests/node/x.test.ts` or `pnpm exec vitest run --project browser tests/browser/x.test.ts`. `pnpm test:node -- x` does NOT scope — it runs every file.
- Never run two browser-project runs at once; the browser tier binds a port.
- TypeScript doc comments are `/** */`; `///` in a `.ts` file is drift.
- No `file:line` citations anywhere in tracked source (`scripts/check-citations.sh`). A symbol citation written `` `file.ts`'s `symbol` `` must name the file that declares the symbol (`scripts/check-attributions.sh`).
- After Task 3, a colour literal may appear only in `web/src/palettes.ts` and between `/* palette:fallback:begin */` and `/* palette:fallback:end */` in `web/src/style.css`.
- Every palette value is a lowercase `#rrggbb`.
- Contrast floors (spec §12): `--fg`, `--fg-dim` and every `--tok-*` against `--bg` and `--bg-raised` at 4.5:1; `--fg` and `--fg-dim` against `--bg-chrome` at 4.5:1; `--focus-ring`, `--accent`, `--error`, `--warn` against `--bg`, `--bg-raised`, `--bg-chrome` at 3:1; `--on-accent` against `--accent` at 4.5:1.
- Web coverage thresholds (`vite.config.ts`): lines 97, functions 97, branches 89, statements 95. New modules need tests that keep these.
- Tests that pin a replaced control change in the same commit as the control, to the new control — never loosened, never skipped.
- Dependency versions: check `pnpm view <pkg> version` when installing and take the newest release. On 2026-09-17 they were `hack-font` 3.3.0 and `@fontsource/inter` 5.3.0.
- `SHELL` in `web/tests/browser/harness.ts` must stay identical in content to `web/index.html`'s `<header>`…`<section id="results">` markup.
- **Before every commit, run `pnpm exec biome ci --error-on-warnings <every file the task changed>` from `web/`.** The pre-commit hook passes `--error-on-warnings`, so plain `biome ci` passes warnings the hook rejects (a pre-flight build of this plan hit exactly that, on a CSS rule order). A formatting-only failure is fixed with `pnpm exec biome format --write <files>`; an import-order one with `pnpm exec biome check --write <files>`.
- This plan's code was built once in a throwaway worktree before execution, and the defects that build found are corrected in the text below. Where a step says "(pre-flight)", the text records what the first draft got wrong.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `web/src/contrast.ts` (new) | WCAG relative luminance and contrast ratio for `#rrggbb` | 1 |
| `web/src/palettes.ts` (new) | the colour-token list, the three palettes, their declaration text | 1 |
| `web/tests/node/contrast.test.ts` (new) | contrast maths | 1 |
| `web/tests/node/palettes.test.ts` (new) | value format, contrast floors, declaration format; later the style-sheet drift checks | 1, 2 |
| `web/src/style.css` | fallback palette block, style blocks, chrome, panel, focus, marks | 2, 5, 6, 7, 8, 9, 10 |
| `scripts/check-colours.sh` (new) | the colour gate | 3 |
| `.pre-commit-config.yaml`, `.forgejo/workflows/ci.yml` | wire the gate | 3 |
| `web/src/skin.ts` (new) | style and palette choice: reading, resolving, applying | 4 |
| `web/index.html` | `data-style`, the two selects, the pre-paint script, font preloads | 4, 5 |
| `web/src/main.ts` | wire the two selects | 4 |
| `web/tests/browser/harness.ts` | `SHELL` gains the two selects | 4 |
| `web/tests/node/skin.test.ts`, `web/tests/node/prepaint.test.ts` (new) | skin logic; the inline script | 4 |
| `web/tests/browser/skin-switcher.test.ts`, `web/tests/browser/skin-restore.test.ts` (new) | switching and restoring through the real header | 4 |
| `web/src/fonts.css` (new) | Inter and Hack faces | 5 |
| `web/public/licenses/` (new) | the two fonts' licence texts, copied into the site | 5 |
| `web/tests/node/licenses.test.ts`, `web/tests/browser/fonts.test.ts` (new) | licence drift; faces load | 5 |
| `web/src/icons.ts` (new) | inline SVG icons keyed by meaning | 6 |
| `web/src/panel.ts` (new) | the collapsible region | 6 |
| `web/tests/browser/panel.test.ts` (new) | icons and panel | 6 |
| `web/src/tm-pane.ts` | rule table becomes the **rules** panel; later the **text** panel | 7, 8 |
| `web/src/pane-chrome.ts` | `collapseButton` becomes `textPanel`; the claim button gets an icon | 8 |
| `web/src/lambda-pane.ts` | the **text** panel | 8 |
| `web/tests/browser/pane-chrome-text-panel.test.ts` (renamed from `pane-chrome-collapse.test.ts`) | `textPanel` | 8 |
| `web/tests/browser/focus.test.ts`, `web/tests/browser/marks.test.ts` (new) | focus ring; mark shapes | 9, 10 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | the entry | 11 |

---

### Task 1: Palettes as data, and the contrast maths that holds them to account

**Files:**
- Create: `web/src/contrast.ts`, `web/src/palettes.ts`
- Test: `web/tests/node/contrast.test.ts`, `web/tests/node/palettes.test.ts`

**Interfaces:**
- Produces:
  - `relativeLuminance(hex: string): number` and `contrastRatio(a: string, b: string): number` from `contrast.ts`; both throw on anything but `#rrggbb`.
  - From `palettes.ts`: `COLOUR_TOKENS` (readonly tuple), `type ColourToken`, `type Variant = Readonly<Record<ColourToken, string>>`, `PALETTE_IDS` (`['paper', 'terminal', 'instrument']`), `type PaletteId`, `type Palette = { readonly id: PaletteId; readonly name: string; readonly light: Variant; readonly dark: Variant }`, `PALETTES: Readonly<Record<PaletteId, Palette>>`, `paletteDeclarations(p: Palette): string`, `PALETTE_CSS_PATTERN: RegExp`.

- [ ] **Step 1: Write the failing contrast test**

`web/tests/node/contrast.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { contrastRatio, relativeLuminance } from '../../src/contrast'

describe('contrast', () => {
  it('gives the WCAG endpoints', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBe(1)
    expect(contrastRatio('#000000', '#ffffff')).toBe(21)
    expect(contrastRatio('#777777', '#777777')).toBe(1)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#1d4ed8', '#fbfbfa')).toBe(contrastRatio('#fbfbfa', '#1d4ed8'))
  })

  // A value computed independently (the WCAG formula by hand in Python) rather than by this module,
  // so a formula error cannot agree with itself.
  it('matches an independently computed ratio', () => {
    expect(contrastRatio('#645d54', '#f7f4ef')).toBeCloseTo(5.92, 2)
  })

  it('refuses anything but #rrggbb', () => {
    for (const bad of ['#fff', 'fff', '#ffffffff', '#GGGGGG', 'red', '']) {
      expect(() => relativeLuminance(bad)).toThrow(/#rrggbb/)
    }
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project node tests/node/contrast.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/contrast"`.

- [ ] **Step 3: Check the independent figure before trusting it**

Run:

```bash
python3 - <<'EOF'
def l(h):
    c = [int(h[i:i+2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
a, b = sorted((l('#645d54'), l('#f7f4ef')), reverse=True)
print(round((a + 0.05) / (b + 0.05), 4))
EOF
```

Expected: `5.9159`. If it is not, fix the test's figure to what Python prints — the test must hold an independently computed value. (This plan's first draft pinned 6.13 from memory; running this is what caught it.)

- [ ] **Step 4: Write `contrast.ts`**

```ts
/**
 * WCAG 2 relative luminance and contrast ratio, for holding palettes to their contrast floors — the
 * built-ins in `palettes.test.ts` now, and an imported base16 palette before it is applied in Plan 7
 * part 6.
 *
 * ONLY `#rrggbb`, deliberately. Every palette value is written that way (`palettes.test.ts` asserts it),
 * and a parser that also took shorthand, alpha or names would be code whose only callers are tests.
 */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex)
  if (m === null) throw new Error(`not a #rrggbb colour: ${JSON.stringify(hex)}`)
  const channel = (pair: string | undefined): number => {
    const c = Number.parseInt(pair ?? '00', 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(m[1]) + 0.7152 * channel(m[2]) + 0.0722 * channel(m[3])
}

/** The contrast ratio between two colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
```

- [ ] **Step 5: Run the contrast test to see it pass**

Run: `pnpm exec vitest run --project node tests/node/contrast.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the failing palette test**

`web/tests/node/palettes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../src/contrast'
import {
  COLOUR_TOKENS,
  type ColourToken,
  PALETTE_CSS_PATTERN,
  PALETTE_IDS,
  PALETTES,
  paletteDeclarations,
  type Variant,
} from '../../src/palettes'

const VARIANTS: [string, Variant][] = PALETTE_IDS.flatMap((id): [string, Variant][] => [
  [`${id} light`, PALETTES[id].light],
  [`${id} dark`, PALETTES[id].dark],
])

/** Every pair a floor applies to, as `[foreground, background, floor]` — spec §12, test 1. */
const FLOORS: [ColourToken, ColourToken, number][] = [
  ...(['fg', 'fg-dim', ...COLOUR_TOKENS.filter((t) => t.startsWith('tok-'))] as ColourToken[]).flatMap(
    (t): [ColourToken, ColourToken, number][] => [
      [t, 'bg', 4.5],
      [t, 'bg-raised', 4.5],
    ],
  ),
  ['fg', 'bg-chrome', 4.5],
  ['fg-dim', 'bg-chrome', 4.5],
  ...(['focus-ring', 'accent', 'error', 'warn'] as ColourToken[]).flatMap((t): [ColourToken, ColourToken, number][] => [
    [t, 'bg', 3],
    [t, 'bg-raised', 3],
    [t, 'bg-chrome', 3],
  ]),
  ['on-accent', 'accent', 4.5],
]

describe('palettes', () => {
  it('has one palette per id, each carrying its own id', () => {
    for (const id of PALETTE_IDS) expect(PALETTES[id].id).toBe(id)
  })

  it('writes every value as lowercase #rrggbb', () => {
    for (const [name, v] of VARIANTS) {
      for (const t of COLOUR_TOKENS) expect(v[t], `${name} ${t}`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('meets every contrast floor in every variant', () => {
    const failures: string[] = []
    for (const [name, v] of VARIANTS) {
      for (const [fg, bg, floor] of FLOORS) {
        const r = contrastRatio(v[fg], v[bg])
        if (r < floor) failures.push(`${name}: ${fg} on ${bg} is ${r.toFixed(2)}, floor ${floor}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('declares every token once, as a light-dark pair', () => {
    const css = paletteDeclarations(PALETTES.paper)
    for (const t of COLOUR_TOKENS) {
      expect(css).toContain(`--${t}: light-dark(${PALETTES.paper.light[t]}, ${PALETTES.paper.dark[t]});`)
      expect(css.split(`--${t}:`).length - 1, t).toBe(1)
    }
  })

  // The pre-paint script in `index.html` applies a cached declaration string only if it matches this
  // pattern (Task 4); every string `paletteDeclarations` produces must therefore pass it.
  it('produces text the pre-paint script accepts', () => {
    for (const id of PALETTE_IDS) expect(PALETTE_CSS_PATTERN.test(paletteDeclarations(PALETTES[id]))).toBe(true)
  })

  it('rejects text that is not palette declarations', () => {
    for (const bad of ['', 'color: red;', '--bg: url(x);', '--bg: light-dark(#fff, #000);', '--bg: light-dark(#ffffff, #000000); x']) {
      expect(PALETTE_CSS_PATTERN.test(bad), bad).toBe(false)
    }
  })
})
```

- [ ] **Step 7: Run it to see it fail**

Run: `pnpm exec vitest run --project node tests/node/palettes.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/palettes"`.

- [ ] **Step 8: Write `palettes.ts`**

The values below were chosen against the floors before this plan was written; the lowest text ratio among them is 5.22 (Instrument light, `tok-punct` on `bg`).

```ts
/**
 * Every colour the app draws with, as data (Plan 7 part 1, spec §3–§4).
 *
 * THE TOKEN LIST IS THE CONTRACT. `style.css` reads colours only through these names — directly or
 * through `color-mix()` of them — and `scripts/check-colours.sh` fails on a colour literal anywhere else
 * in the web sources, so a palette that sets every token here recolours everything. The `Variant` type
 * makes a palette missing a token a compile error rather than a blank colour.
 *
 * `style.css` keeps one copy of Instrument's values as the first-paint fallback, between its
 * `palette:fallback` markers; `palettes.test.ts` holds that copy equal to this one.
 *
 * Not every token has a consumer yet: `on-accent` and `warn` are defined now so their contrast is held
 * from the start, and parts 2 and 3 of Plan 7 use them.
 */
export const COLOUR_TOKENS = [
  'bg',
  'bg-raised',
  'bg-chrome',
  'rule',
  'fg',
  'fg-dim',
  'accent',
  'on-accent',
  'focus-ring',
  'error',
  'warn',
  'tok-neutral',
  'tok-keyword',
  'tok-ident',
  'tok-nat',
  'tok-bool',
  'tok-operator',
  'tok-punct',
] as const

export type ColourToken = (typeof COLOUR_TOKENS)[number]

export type Variant = Readonly<Record<ColourToken, string>>

export const PALETTE_IDS = ['paper', 'terminal', 'instrument'] as const

export type PaletteId = (typeof PALETTE_IDS)[number]

export type Palette = {
  readonly id: PaletteId
  readonly name: string
  readonly light: Variant
  readonly dark: Variant
}

export const PALETTES: Readonly<Record<PaletteId, Palette>> = {
  paper: {
    id: 'paper',
    name: 'Paper',
    light: {
      bg: '#f7f4ef',
      'bg-raised': '#fffdf9',
      'bg-chrome': '#efeae1',
      rule: '#ddd5c8',
      fg: '#221f1b',
      'fg-dim': '#645d54',
      accent: '#9a3412',
      'on-accent': '#ffffff',
      'focus-ring': '#221f1b',
      error: '#b91c1c',
      warn: '#92400e',
      'tok-neutral': '#645d54',
      'tok-keyword': '#9a3412',
      'tok-ident': '#221f1b',
      'tok-nat': '#1d4ed8',
      'tok-bool': '#1d4ed8',
      'tok-operator': '#7c2d92',
      'tok-punct': '#665f56',
    },
    dark: {
      bg: '#191714',
      'bg-raised': '#211e1a',
      'bg-chrome': '#24211c',
      rule: '#3a352d',
      fg: '#ece7de',
      'fg-dim': '#a89f94',
      accent: '#f0956a',
      'on-accent': '#1a1613',
      'focus-ring': '#ece7de',
      error: '#f87171',
      warn: '#fbbf24',
      'tok-neutral': '#a89f94',
      'tok-keyword': '#f0956a',
      'tok-ident': '#ece7de',
      'tok-nat': '#86b6ff',
      'tok-bool': '#86b6ff',
      'tok-operator': '#d6a2f0',
      'tok-punct': '#a39a8f',
    },
  },
  terminal: {
    id: 'terminal',
    name: 'Terminal',
    light: {
      bg: '#f4f6f2',
      'bg-raised': '#fbfdf9',
      'bg-chrome': '#e8ece4',
      rule: '#cfd8ca',
      fg: '#14251a',
      'fg-dim': '#4b5e51',
      accent: '#136c2e',
      'on-accent': '#fbfdf9',
      'focus-ring': '#14251a',
      error: '#b42318',
      warn: '#8a5a00',
      'tok-neutral': '#4b5e51',
      'tok-keyword': '#b1331f',
      'tok-ident': '#14251a',
      'tok-nat': '#12548f',
      'tok-bool': '#12548f',
      'tok-operator': '#6b2fa0',
      'tok-punct': '#526457',
    },
    dark: {
      bg: '#0b0e14',
      'bg-raised': '#0f131b',
      'bg-chrome': '#141a24',
      rule: '#222b38',
      fg: '#d3dae6',
      'fg-dim': '#8b97aa',
      accent: '#39d353',
      'on-accent': '#06110a',
      'focus-ring': '#d3dae6',
      error: '#ff7b72',
      warn: '#e3b341',
      'tok-neutral': '#8b97aa',
      'tok-keyword': '#ff7b72',
      'tok-ident': '#d3dae6',
      'tok-nat': '#79c0ff',
      'tok-bool': '#79c0ff',
      'tok-operator': '#d2a8ff',
      'tok-punct': '#8b97aa',
    },
  },
  instrument: {
    id: 'instrument',
    name: 'Instrument',
    light: {
      bg: '#e9edf2',
      'bg-raised': '#ffffff',
      'bg-chrome': '#f4f7fa',
      rule: '#c8d3de',
      fg: '#152430',
      'fg-dim': '#4a5f72',
      accent: '#0f766e',
      'on-accent': '#ffffff',
      'focus-ring': '#152430',
      error: '#b42318',
      warn: '#8a5a00',
      'tok-neutral': '#4a5f72',
      'tok-keyword': '#0b5fb3',
      'tok-ident': '#152430',
      'tok-nat': '#9a3412',
      'tok-bool': '#9a3412',
      'tok-operator': '#6d28d9',
      'tok-punct': '#4f6477',
    },
    dark: {
      bg: '#101820',
      'bg-raised': '#16202a',
      'bg-chrome': '#122029',
      rule: '#273947',
      fg: '#dbe6ef',
      'fg-dim': '#8ea3b5',
      accent: '#2dd4bf',
      'on-accent': '#06201d',
      'focus-ring': '#dbe6ef',
      error: '#f97066',
      warn: '#fdb022',
      'tok-neutral': '#8ea3b5',
      'tok-keyword': '#5fa8f5',
      'tok-ident': '#dbe6ef',
      'tok-nat': '#f0956a',
      'tok-bool': '#f0956a',
      'tok-operator': '#c4a8f5',
      'tok-punct': '#8ea3b5',
    },
  },
}

/**
 * A palette as CSS declarations — `--bg: light-dark(#…, #…); …`, one per token, in token order.
 *
 * This is the text the app caches after applying a palette, and the text the pre-paint script in
 * `index.html` writes onto `<html>` as the `style` attribute before first paint.
 */
export function paletteDeclarations(p: Palette): string {
  return COLOUR_TOKENS.map((t) => `--${t}: light-dark(${p.light[t]}, ${p.dark[t]});`).join(' ')
}

/**
 * Exactly the text `paletteDeclarations` can produce, and nothing else.
 *
 * `index.html`'s pre-paint script carries this pattern as a literal — it runs before any module, so it
 * cannot import it — and applies a cached string to `<html>`'s `style` attribute only if the string
 * matches. `prepaint.test.ts` holds the literal equal to this `source`. A cache that is corrupt, stale in
 * format, or written by anything else is therefore ignored rather than injected.
 */
export const PALETTE_CSS_PATTERN = /^(--[a-z0-9-]+: light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\); ?)+$/
```

- [ ] **Step 9: Run both node tests to see them pass**

Run: `pnpm exec vitest run --project node tests/node/contrast.test.ts tests/node/palettes.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 10: Lint and typecheck**

Run: `pnpm exec biome ci --error-on-warnings src/contrast.ts src/palettes.ts tests/node/contrast.test.ts tests/node/palettes.test.ts && pnpm exec tsc --noEmit`
Expected: no errors. Biome reformats the `FLOORS` literal in `palettes.test.ts` (it is past the line width); run `pnpm exec biome format --write <files>` and re-run.

- [ ] **Step 11: Commit**

```bash
git add web/src/contrast.ts web/src/palettes.ts web/tests/node/contrast.test.ts web/tests/node/palettes.test.ts
git commit -m "Palettes as data: three palettes, six variants, held to WCAG contrast floors"
```

---

### Task 2: The style sheet reads the palette, holds Instrument as its fallback, and gains the three styles

**Files:**
- Modify: `web/src/style.css` (the `:root` block, `.bar`, `.pane h2`, `.detached-badge`'s comment, `.banner`, CodeMirror chrome), `web/index.html` (the `<html>` element)
- Test: `web/tests/node/palettes.test.ts` (two more tests)

**Interfaces:**
- Consumes: `COLOUR_TOKENS`, `PALETTES` from Task 1.
- Produces: the marker comments `/* palette:fallback:begin */` and `/* palette:fallback:end */` in `style.css` (Task 3's gate reads them); the style tokens `--label-transform` and `--label-tracking`; the `[data-style="paper"]` and `[data-style="terminal"]` blocks; `data-style="instrument"` on `<html>`.

- [ ] **Step 1: Write the failing drift tests**

Append to `web/tests/node/palettes.test.ts` (add `import { readFileSync } from 'node:fs'` and `import { fileURLToPath } from 'node:url'` to the imports):

```ts
const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8')

describe('style.css against the palettes', () => {
  // The fallback is what a page shows before `main.ts` applies a palette, and on the startup-failure path
  // where it never does. It is Instrument, the first-visit default — and a second copy, so this holds
  // the two equal.
  it('holds Instrument as its fallback, token for token', () => {
    const block = /\/\* palette:fallback:begin \*\/([\s\S]*?)\/\* palette:fallback:end \*\//.exec(css)?.[1]
    expect(block, 'the fallback markers').toBeDefined()
    const found = new Map<string, string>()
    for (const m of (block ?? '').matchAll(/--([a-z0-9-]+): light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\);/g)) {
      found.set(m[1] ?? '', `${m[2]} ${m[3]}`)
    }
    const want = new Map(
      COLOUR_TOKENS.map((t) => [t, `${PALETTES.instrument.light[t]} ${PALETTES.instrument.dark[t]}`] as const),
    )
    expect(found).toEqual(want)
  })

  // One direction only, deliberately: a palette may define a token no rule reads yet (`on-accent`), but a
  // rule may not read a token nothing defines — that renders as the property's initial value, silently.
  // A `var()` with a fallback (`var(--divider-size, 4px)`) is excluded because it defines its own answer.
  it('reads no custom property that nothing defines', () => {
    const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
    for (const t of COLOUR_TOKENS) declared.add(`--${t}`)
    const read = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1])
    expect(read.filter((name) => !declared.has(name))).toEqual([])
  })
})
```

- [ ] **Step 2: Run them to see the first fail**

Run: `pnpm exec vitest run --project node tests/node/palettes.test.ts`
Expected: FAIL on `holds Instrument as its fallback` (no markers yet). The second test may already pass; that is fine — it is a guard for the edits below.

- [ ] **Step 3: Replace the `:root` block**

In `web/src/style.css`, replace everything from the first line (`/* Design tokens. A foundation for Plan 5's panes, not a visual identity — §7 of the design spec. */`) through the `:root` block's closing `}` (the line after `--tok-punct: light-dark(#8a8681, #6f6a74);`) with:

```css
/* Design tokens (Plan 7 part 1).

   THE PALETTE IS DATA. `palettes.ts` holds every colour; the app writes the chosen palette onto
   `<html>` as inline custom properties, which win over this block. What this block keeps is
   the FALLBACK — Instrument's palette, the first-visit default — so a page that has not run `main.ts`
   yet, or never will (the startup-failure banner), still has every token. `palettes.test.ts` holds this
   copy equal to `palettes.ts`, and `scripts/check-colours.sh` allows colour literals between the two
   markers below and nowhere else in the web sources.

   THE STYLE IS THIS FILE. The non-colour tokens here are Instrument's; the `[data-style]` blocks below
   override them for Paper and Terminal. A style never sets a colour and a palette never sets a font. */
:root {
  /* Not just a UA-drawn-widget hint anymore — the encoding `<select>` and each pane's binding
     selector (`.pane-binding` below) are the widgets `prefers-color-scheme` cannot reach inside, and
     this is still what keeps a dark page from getting a light dropdown, but every token below now
     resolves AGAINST this property via
     `light-dark()`. It is the one switch: `system` (this default, tracking the OS), an explicit
     `:root[data-theme="light"]`, or `:root[data-theme="dark"]` below all just set `color-scheme`
     and every `light-dark()` value follows without a second copy of the palette. */
  color-scheme: light dark;

  --font-ui: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Hack", ui-monospace, "Cascadia Code", "Source Code Pro", monospace;
  --radius: 2px;
  --label-transform: uppercase;
  --label-tracking: 0.04em;

  --step--2: 0.75rem;
  --step--1: 0.8125rem;
  --step-0: 0.9375rem;
  --step-1: 1.0625rem;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 1rem;

  /* palette:fallback:begin */
  --bg: light-dark(#e9edf2, #101820);
  --bg-raised: light-dark(#ffffff, #16202a);
  --bg-chrome: light-dark(#f4f7fa, #122029);
  --rule: light-dark(#c8d3de, #273947);
  --fg: light-dark(#152430, #dbe6ef);
  --fg-dim: light-dark(#4a5f72, #8ea3b5);
  --accent: light-dark(#0f766e, #2dd4bf);
  --on-accent: light-dark(#ffffff, #06201d);
  --focus-ring: light-dark(#152430, #dbe6ef);
  --error: light-dark(#b42318, #f97066);
  --warn: light-dark(#8a5a00, #fdb022);
  --tok-neutral: light-dark(#4a5f72, #8ea3b5);
  --tok-keyword: light-dark(#0b5fb3, #5fa8f5);
  --tok-ident: light-dark(#152430, #dbe6ef);
  --tok-nat: light-dark(#9a3412, #f0956a);
  --tok-bool: light-dark(#9a3412, #f0956a);
  --tok-operator: light-dark(#6d28d9, #c4a8f5);
  --tok-punct: light-dark(#4f6477, #8ea3b5);
  /* palette:fallback:end */

  /* The construct a click linked (`.linked` below). A SEPARATE HUE FROM `--accent`, not a tint of it —
     `.decline` already washes a span in `--accent` for a backend refusal, and `.cm-activeLine` washes
     the current line in it too, so a link in the same hue would read as one of those instead of a
     third, distinct kind of mark. Derived from `--tok-nat` rather than a palette entry of its own, so a
     palette author sets hues and the marks built from them follow. */
  --link-bg: color-mix(in oklab, var(--tok-nat) 20%, transparent);
  --link-edge: var(--tok-nat);
}

/* Paper and Terminal, as overrides of the Instrument shape above. The app sets `data-style` on
   `<html>`; `index.html` ships `data-style="instrument"` so the default is explicit. */
:root[data-style="paper"] {
  --font-ui: ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;
  --radius: 5px;
  --label-transform: none;
  --label-tracking: 0.08em;
}
:root[data-style="terminal"] {
  --font-ui: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;
  --font-mono: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;
  --radius: 3px;
  --label-transform: none;
  --label-tracking: 0.02em;
}
```

- [ ] **Step 4: Give the header its chrome surface**

In the `.bar` rule, add `background: var(--bg-chrome);` after `border-bottom: 1px solid var(--rule);`.

- [ ] **Step 5: Labels take their case and tracking from the style**

In the `.pane h2` rule, replace

```css
  text-transform: lowercase;
  letter-spacing: 0.08em;
```

with

```css
  text-transform: var(--label-transform);
  letter-spacing: var(--label-tracking);
```

In the `.detached-badge` comment, replace the paragraph beginning `` `letter-spacing: normal` UNDOES `.pane h2`'s 0.08em`` with:

```css
   `letter-spacing: normal` UNDOES `.pane h2`'s `--label-tracking`, which is tracking for a label and
   pushes the closing bracket a visible gap away from the word inside it. */
```

(keep the rule body unchanged; only that closing comment paragraph changes).

- [ ] **Step 6: The startup banner is an error and says so in colour as well as words**

In the `.banner` rule, add `color: var(--error);` after `border-radius: var(--radius);`. The border is `currentColor`, so it follows.

- [ ] **Step 7: The editors draw code in the style's code face**

After the `.cm-editor .cm-content { caret-color: var(--fg); }` rule, add:

```css
/* CodeMirror sets `monospace` on its scroller in its own base theme, so without this the editors ignore
   the style's code face — Hack under Instrument — while every other piece of code on the page uses it. */
.cm-editor .cm-scroller {
  font-family: var(--font-mono);
}
```

- [ ] **Step 8: Make the default style explicit on the page**

In `web/index.html`, change `<html lang="en">` to `<html lang="en" data-style="instrument">`.

- [ ] **Step 9: Run the node tests**

Run: `pnpm exec vitest run --project node tests/node/palettes.test.ts tests/node/theme.test.ts`
Expected: PASS. `theme.test.ts`'s `styles both colour schemes` still finds `light-dark(`.

- [ ] **Step 10: Run the whole web suite**

Run: `pnpm test`
Expected: PASS. This task changes default colours and the label case, and no existing test asserts either (checked while planning: no test reads a computed colour, `text-transform`, `box-shadow` or `text-decoration`). A failure here means a test reads something this plan did not find — read it before changing anything.

- [ ] **Step 11: Look at it**

Run: `pnpm exec vite --port 5199 --strictPort` (background), open `http://localhost:5199/` and toggle `◐` through light and dark. The page is Instrument's palette with uppercase pane labels. Fonts are still system faces — Task 5 adds Inter and Hack. Stop the server.

- [ ] **Step 12: Commit**

```bash
git add web/src/style.css web/index.html web/tests/node/palettes.test.ts
git commit -m "The style sheet reads the palette: Instrument as the fallback, Paper and Terminal as style overrides"
```

---

### Task 3: The colour gate

**Files:**
- Create: `scripts/check-colours.sh` (executable)
- Modify: `.pre-commit-config.yaml` (after the `check-shared-docs` hook), `.forgejo/workflows/ci.yml` (after the step `Reject shared doc regions that no longer match their source`)

**Interfaces:**
- Consumes: the fallback markers from Task 2.
- Produces: `scripts/check-colours.sh [--self-test]`; exit 0 clean, 1 on a literal, 2 on a bad argument.

- [ ] **Step 1: Write the script**

`scripts/check-colours.sh`:

```bash
#!/usr/bin/env bash
# Reject colour literals outside the palette.
#
# CI invokes this same script (.forgejo/workflows/ci.yml) and so does the pre-commit hook
# (.pre-commit-config.yaml), so the local and CI gates cannot drift — the convention
# `scripts/check-all.sh` already states.
#
#   scripts/check-colours.sh              # scan the tracked web sources
#   scripts/check-colours.sh --self-test  # prove the detector still detects
#
# WHY THIS GATE EXISTS. Plan 7 part 1 made the palette data: `web/src/palettes.ts` holds every colour the
# app draws with, and `web/src/style.css` keeps one copy of the default palette, between two marker
# comments, as the first-paint fallback. A colour written anywhere else is one no palette can change and
# no contrast test checks — a skin that half-applies. The tree had none when this gate landed, so it
# enforces an invariant that already held rather than one that had to be reached.
#
# WHAT COUNTS. A hex colour (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) or a CSS colour function (`rgb`,
# `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklab`, `oklch`, `color`), in any tracked `.css` or `.ts`
# file under `web/src/` except `palettes.ts`, after comments are stripped. `transparent`, `currentColor`
# and `inherit` are keywords, not literals.
#
# WHAT IT DOES NOT SEE, AS A DECISION: CSS named colours (`red`, `white`, …). Telling `white` the colour
# from `white-space` the property needs a value-position parser, and there were none in the tree. The
# self-test asserts the blind spot, so it stays visible rather than accidental.
#
# WHAT IT SEES THAT IT SHOULD NOT, ALSO AS A DECISION: a TypeScript private member named only in hex
# letters (`#add`, `#feed`, `#decade`) reads as a hex colour. There were none in the tree; rename one
# rather than weaken the pattern. The self-test asserts this too.

set -euo pipefail

readonly COLOUR_RE='#[0-9A-Fa-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\('

# The text of $1 with everything the gate must not read replaced by blank lines: a style sheet's marked
# fallback block, then every comment. Newlines are kept, so the line numbers `hits_in` reports are the
# file's own. **THE ONE STRIPPING IMPLEMENTATION** — the scan and `--self-test` both reach files through
# `hits_in`, which calls this, so the self-test exercises the real thing.
stripped() {
  case "$1" in
    *.css)
      perl -0777 -pe 's{/\* palette:fallback:begin \*/.*?/\* palette:fallback:end \*/}{"\n" x (() = $& =~ /\n/g)}gse; s{/\*.*?\*/}{"\n" x (() = $& =~ /\n/g)}gse' -- "$1"
      ;;
    *.ts)
      perl -0777 -pe 's{/\*.*?\*/}{"\n" x (() = $& =~ /\n/g)}gse; s{//[^\n]*}{}g' -- "$1"
      ;;
  esac
}

# Every colour literal left in $1, as `line:text`. Empty when there are none.
hits_in() {
  stripped "$1" | grep -nE "$COLOUR_RE" || true
}

expect_hits() {
  local n
  n=$(hits_in "$1" | grep -c '' || true)
  if [ "$n" -ne "$2" ]; then
    printf 'self-test FAILED: %s: expected %s hit(s), got %s\n' "$3" "$2" "$n" >&2
    exit 1
  fi
}

# Prove the detector still detects. A gate that only ever runs against a passing tree cannot tell you it
# still works. `dir` is global and the trap single-quoted with `${dir:?}`, for the reasons
# `scripts/check-text-bytes.sh` gives at the same spot.
self_test() {
  dir=$(mktemp -d)
  trap 'rm -rf "${dir:?}"' EXIT

  cat >"$dir/dirty.css" <<'CSS'
a { color: #abc; }
a { color: #abcd; }
a { color: #aabbcc; }
a { color: #aabbccdd; }
a { color: rgb(0 0 0); }
a { color: rgba(0, 0, 0, 0.5); }
a { color: hsl(0 0% 0%); }
a { color: hsla(0, 0%, 0%, 1); }
a { color: hwb(0 0% 0%); }
a { color: lab(0% 0 0); }
a { color: lch(0% 0 0); }
a { color: oklab(0 0 0); }
a { color: oklch(0 0 0); }
a { color: color(srgb 0 0 0); }
CSS
  expect_hits "$dir/dirty.css" 14 'every literal form in a style sheet'

  cat >"$dir/clean.css" <<'CSS'
:root {
  /* palette:fallback:begin */
  --bg: light-dark(#ffffff, #000000);
  /* palette:fallback:end */
}
/* a comment may say #aabbcc
   or rgb( across lines */
a { color: transparent; border-color: currentColor; background: inherit; }
a { color: red; }
CSS
  expect_hits "$dir/clean.css" 0 'the fallback block, comments, keywords, and a named colour (the stated blind spot)'

  printf "const c = '#aabbcc'\n" >"$dir/dirty.ts"
  expect_hits "$dir/dirty.ts" 1 'a hex string in TypeScript'

  printf "// '#aabbcc'\n/* rgb(\n */\nconst id = '#editor'\n" >"$dir/clean.ts"
  expect_hits "$dir/clean.ts" 0 'comments and an id selector in TypeScript'

  printf 'class A { #add() {} }\n' >"$dir/hexname.ts"
  expect_hits "$dir/hexname.ts" 1 'a private member named only in hex letters (the stated false positive)'

  printf '/* one\ntwo */\na { color: #abc; }\n' >"$dir/lines.css"
  if [ "$(hits_in "$dir/lines.css" | cut -d: -f1)" != 3 ]; then
    echo 'self-test FAILED: stripping a comment moved the reported line number' >&2
    exit 1
  fi

  echo "self-test passed: every literal form is caught; the fallback block, comments, keywords and named colours are not; a hex-lettered private name is flagged; line numbers survive"
}

case "$#:${1-}" in
  0:) ;;
  1:--self-test) self_test; exit 0 ;;
  *)
    printf 'error: unrecognised argument: %s\n' "$*" >&2
    cat >&2 <<'MSG'
usage: scripts/check-colours.sh [--self-test]

  (no argument)   scan tracked web sources for colour literals outside the palette
  --self-test     prove the detector still detects
MSG
    exit 2
    ;;
esac

cd "$(git rev-parse --show-toplevel)"

bad=0
while IFS= read -r -d '' f; do
  [ "$f" = web/src/palettes.ts ] && continue
  [ -f "$f" ] || continue
  out=$(hits_in "$f")
  if [ -n "$out" ]; then
    printf '%s\n' "$out" | sed "s|^|error: $f:|" >&2
    bad=1
  fi
done < <(git ls-files -z -- 'web/src/*.css' 'web/src/*.ts')

if [ "$bad" -ne 0 ]; then
  cat >&2 <<'MSG'

A colour written outside the palette is one no palette can change and no contrast test checks. Add a
token to `COLOUR_TOKENS` in web/src/palettes.ts, give it a value in every palette, and read it with
`var(--token)` — or mix existing tokens with `color-mix()`.
MSG
  exit 1
fi

echo "no colour literals outside the palette"
```

Then: `chmod +x scripts/check-colours.sh`

- [ ] **Step 2: Run it both ways**

Run: `scripts/check-colours.sh --self-test && scripts/check-colours.sh`
Expected: `self-test passed: …` then `no colour literals outside the palette`.

- [ ] **Step 3: Prove the scan fires on the real tree**

Run: `sed -i 's|  /\* palette:fallback:begin \*/|  --probe: #abcdef;\n&|' web/src/style.css && scripts/check-colours.sh; echo "exit=$?"; git checkout web/src/style.css`
Expected: `error: web/src/style.css:<n>:  --probe: #abcdef;`, the help text, `exit=1`; then the file is restored.

- [ ] **Step 4: Prove the argument check**

Run: `scripts/check-colours.sh --slf-test; echo "exit=$?"`
Expected: `error: unrecognised argument: --slf-test`, the usage text, `exit=2`.

- [ ] **Step 5: Wire the pre-commit hook**

In `.pre-commit-config.yaml`, directly after the `check-shared-docs` hook's `pass_filenames: false` line, add:

```yaml
      # UNSCOPED FOR THE SIBLINGS' REASON: a colour literal can arrive in any web source, and the file that
      # carries it is not necessarily one this commit names. Self-test first, then the scan.
      - id: check-colours
        name: no colour literals outside the palette
        entry: bash -c 'scripts/check-colours.sh --self-test && scripts/check-colours.sh'
        language: system
        always_run: true
        pass_filenames: false
```

- [ ] **Step 6: Wire CI**

In `.forgejo/workflows/ci.yml`, directly after

```yaml
      - name: Reject shared doc regions that no longer match their source
        run: scripts/check-shared-docs.sh
```

add

```yaml
      # THE COLOUR GATE RIDES IN THIS JOB FOR THE REASONS ABOVE: repo hygiene needing a checkout and
      # nothing else, already required, and no change to `gate`'s `needs:` list. Same script as the
      # pre-commit hook. Self-test first, because a scan of a clean tree proves nothing on its own.
      - name: Prove the colour detector still detects
        run: scripts/check-colours.sh --self-test
      - name: Reject colour literals outside the palette
        run: scripts/check-colours.sh
```

- [ ] **Step 7: Run every hook**

Run: `pre-commit run --all-files`
Expected: every hook `Passed` or `Skipped`, including `no colour literals outside the palette`.

- [ ] **Step 8: Commit**

```bash
git add scripts/check-colours.sh .pre-commit-config.yaml .forgejo/workflows/ci.yml
git commit -m "A gate for colour literals outside the palette, with a self-test that states its blind spot"
```

---

### Task 4: Choosing a style and a palette

**Files:**
- Create: `web/src/skin.ts`, `web/tests/node/skin.test.ts`, `web/tests/node/prepaint.test.ts`, `web/tests/browser/skin-switcher.test.ts`, `web/tests/browser/skin-restore.test.ts`
- Modify: `web/index.html` (header, inline script), `web/tests/browser/harness.ts` (`SHELL`), `web/src/main.ts` (lookups and wiring), `web/src/style.css` (`.encoding`)

**Interfaces:**
- Consumes: `PALETTES`, `PALETTE_IDS`, `COLOUR_TOKENS`, `paletteDeclarations`, `PALETTE_CSS_PATTERN`, `type Palette`, `type PaletteId` from Task 1.
- Produces, from `skin.ts`: `STYLE_IDS`, `type StyleId`, `type PaletteChoice = 'match' | PaletteId`, `PALETTE_CHOICES`, `DEFAULT_STYLE`, `STYLE_KEY` (`'redextape.style'`), `PALETTE_KEY` (`'redextape.palette'`), `PALETTE_CSS_KEY` (`'redextape.palette.css'`), `STYLE_LABELS`, `PALETTE_CHOICE_LABELS`, `readStyle(raw: string | null): StyleId`, `readPaletteChoice(raw: string | null): PaletteChoice`, `resolvePalette(style: StyleId, choice: PaletteChoice): Palette`, `type SkinRoot`, `applySkin(root: SkinRoot, style: StyleId, choice: PaletteChoice): string`. The header's `#style` and `#palette` selects.

- [ ] **Step 1: Write the failing skin test**

`web/tests/node/skin.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { COLOUR_TOKENS, PALETTES, paletteDeclarations } from '../../src/palettes'
import {
  applySkin,
  DEFAULT_STYLE,
  PALETTE_CHOICE_LABELS,
  PALETTE_CHOICES,
  readPaletteChoice,
  readStyle,
  resolvePalette,
  type SkinRoot,
  STYLE_IDS,
  STYLE_LABELS,
} from '../../src/skin'

function fakeRoot(): SkinRoot & { attrs: Map<string, string>; props: Map<string, string> } {
  const attrs = new Map<string, string>()
  const props = new Map<string, string>()
  return {
    attrs,
    props,
    setAttribute: (k, v) => {
      attrs.set(k, v)
    },
    style: {
      setProperty: (k, v) => {
        props.set(k, v)
      },
    },
  }
}

describe('skin', () => {
  it('defaults to Instrument', () => {
    expect(DEFAULT_STYLE).toBe('instrument')
    expect(readStyle(null)).toBe('instrument')
  })

  it('reads a stored style, and anything else as the default', () => {
    for (const s of STYLE_IDS) expect(readStyle(s)).toBe(s)
    for (const bad of ['', 'Paper', 'match', 'dark', 'instrument ']) expect(readStyle(bad)).toBe('instrument')
  })

  it('reads a stored palette choice, and anything else as match', () => {
    for (const c of PALETTE_CHOICES) expect(readPaletteChoice(c)).toBe(c)
    for (const bad of [null, '', 'Paper', 'system']) expect(readPaletteChoice(bad)).toBe('match')
  })

  it('resolves match to the style’s own palette, and a named palette to itself', () => {
    expect(resolvePalette('paper', 'match')).toBe(PALETTES.paper)
    expect(resolvePalette('paper', 'terminal')).toBe(PALETTES.terminal)
  })

  it('labels every style and every choice', () => {
    for (const s of STYLE_IDS) expect(STYLE_LABELS[s]).not.toBe('')
    for (const c of PALETTE_CHOICES) expect(PALETTE_CHOICE_LABELS[c]).not.toBe('')
  })

  it('writes the style attribute and every token, and returns the declarations to cache', () => {
    const root = fakeRoot()
    const cached = applySkin(root, 'paper', 'terminal')
    expect(root.attrs.get('data-style')).toBe('paper')
    for (const t of COLOUR_TOKENS) {
      expect(root.props.get(`--${t}`)).toBe(`light-dark(${PALETTES.terminal.light[t]}, ${PALETTES.terminal.dark[t]})`)
    }
    expect(cached).toBe(paletteDeclarations(PALETTES.terminal))
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project node tests/node/skin.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/skin"`.

- [ ] **Step 3: Write `skin.ts`**

```ts
import { COLOUR_TOKENS, PALETTE_IDS, PALETTES, type Palette, type PaletteId, paletteDeclarations } from './palettes'

/**
 * The style and palette a page is drawn in (Plan 7 part 1, spec §4 and §6).
 *
 * TWO CHOICES, NOT ONE. A style is shape — fonts, radius, label case — and lives in `style.css`'s
 * `[data-style]` blocks; a palette is colour and lives in `palettes.ts`. `match` means "the style's own
 * palette", which is what a visitor who never touches the palette control gets. The appearance toggle
 * (`appearance.ts`) is a third, independent choice and is untouched: every token is a `light-dark()` pair,
 * so light and dark follow `color-scheme` whichever palette is applied.
 */
export const STYLE_IDS = ['paper', 'terminal', 'instrument'] as const

export type StyleId = (typeof STYLE_IDS)[number]

export type PaletteChoice = 'match' | PaletteId

export const PALETTE_CHOICES: readonly PaletteChoice[] = ['match', ...PALETTE_IDS]

/** The first-visit style — the umbrella design's first-load decision. */
export const DEFAULT_STYLE: StyleId = 'instrument'

export const STYLE_KEY = 'redextape.style'
export const PALETTE_KEY = 'redextape.palette'

/**
 * The resolved declarations of the palette last applied, for `index.html`'s pre-paint script — which runs
 * before any module and so cannot resolve a choice itself. Written by `main.ts` whenever a palette is
 * applied.
 */
export const PALETTE_CSS_KEY = 'redextape.palette.css'

export const STYLE_LABELS: Readonly<Record<StyleId, string>> = {
  paper: 'Paper',
  terminal: 'Terminal',
  instrument: 'Instrument',
}

export const PALETTE_CHOICE_LABELS: Readonly<Record<PaletteChoice, string>> = {
  match: 'match style',
  paper: 'Paper',
  terminal: 'Terminal',
  instrument: 'Instrument',
}

function isStyle(raw: string | null): raw is StyleId {
  return raw !== null && (STYLE_IDS as readonly string[]).includes(raw)
}

function isPaletteChoice(raw: string | null): raw is PaletteChoice {
  return raw === 'match' || (raw !== null && (PALETTE_IDS as readonly string[]).includes(raw))
}

/** A stored style, or the default for anything that is not one — including a value from a later version. */
export function readStyle(raw: string | null): StyleId {
  return isStyle(raw) ? raw : DEFAULT_STYLE
}

/** A stored palette choice, or `match` for anything that is not one. */
export function readPaletteChoice(raw: string | null): PaletteChoice {
  return isPaletteChoice(raw) ? raw : 'match'
}

export function resolvePalette(style: StyleId, choice: PaletteChoice): Palette {
  return PALETTES[choice === 'match' ? style : choice]
}

/** The slice of `<html>` that `applySkin` writes to, so node tests can hand it a fake. */
export type SkinRoot = {
  setAttribute(name: string, value: string): void
  readonly style: { setProperty(name: string, value: string): void }
}

/**
 * Draw the page in `style` with the palette `choice` resolves to: `data-style` on `root`, and every
 * colour token as an inline `light-dark()` custom property, which wins over `style.css`'s fallback.
 *
 * Returns the palette's declarations, for the caller to cache under `PALETTE_CSS_KEY`.
 */
export function applySkin(root: SkinRoot, style: StyleId, choice: PaletteChoice): string {
  const palette = resolvePalette(style, choice)
  root.setAttribute('data-style', style)
  for (const t of COLOUR_TOKENS) {
    root.style.setProperty(`--${t}`, `light-dark(${palette.light[t]}, ${palette.dark[t]})`)
  }
  return paletteDeclarations(palette)
}
```

- [ ] **Step 4: Run the skin test to see it pass**

Run: `pnpm exec vitest run --project node tests/node/skin.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing pre-paint test**

`web/tests/node/prepaint.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PALETTE_CSS_PATTERN, PALETTES, paletteDeclarations } from '../../src/palettes'
import { PALETTE_CSS_KEY, STYLE_IDS, STYLE_KEY } from '../../src/skin'

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')
// The one classic script in the page — the module script has a `type`.
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''

/**
 * Run the inline script against a fake `localStorage` and `<html>`, and return what it set.
 *
 * The script is a classic script in `<head>`, so the HTML standard runs it before the page's module
 * script and before first paint; what this test checks is what it DOES when it runs.
 */
function run(store: Record<string, string>, throws = false): Map<string, string> {
  const attrs = new Map<string, string>()
  const documentElement = {
    setAttribute: (k: string, v: string) => {
      attrs.set(k, v)
    },
  }
  const localStorage = {
    getItem: (k: string) => {
      if (throws) throw new Error('storage is disabled')
      return store[k] ?? null
    },
  }
  new Function('localStorage', 'document', script)(localStorage, { documentElement })
  return attrs
}

describe('the pre-paint script', () => {
  it('exists', () => {
    expect(script).not.toBe('')
  })

  it('applies a stored style and a cached palette before first paint', () => {
    const css = paletteDeclarations(PALETTES.paper)
    const attrs = run({ [STYLE_KEY]: 'paper', [PALETTE_CSS_KEY]: css })
    expect(attrs.get('data-style')).toBe('paper')
    expect(attrs.get('style')).toBe(css)
  })

  it('still applies a stored appearance', () => {
    expect(run({ 'redextape.appearance': 'dark' }).get('data-theme')).toBe('dark')
  })

  it('ignores an unknown style and a cache that is not palette declarations', () => {
    const attrs = run({ [STYLE_KEY]: 'neon', [PALETTE_CSS_KEY]: 'color: red; background: url(x)' })
    expect(attrs.has('data-style')).toBe(false)
    expect(attrs.has('style')).toBe(false)
  })

  it('does not throw when storage does', () => {
    expect(() => run({}, true)).not.toThrow()
  })

  // The script cannot import, so it carries its own copies. These hold each copy to its source.
  it('carries the keys, the style ids and the cache pattern that skin.ts and palettes.ts define', () => {
    expect(script).toContain(`'${STYLE_KEY}'`)
    expect(script).toContain(`'${PALETTE_CSS_KEY}'`)
    for (const s of STYLE_IDS) expect(script).toContain(`'${s}'`)
    expect(script).toContain(`/${PALETTE_CSS_PATTERN.source}/`)
  })
})
```

- [ ] **Step 6: Run it to see it fail**

Run: `pnpm exec vitest run --project node tests/node/prepaint.test.ts`
Expected: FAIL on `applies a stored style…` and `carries the keys…`.

- [ ] **Step 7: Extend the pre-paint script and add the selects**

In `web/index.html`, replace the inline `<script>` block with:

```html
    <script>
      // Applies the stored appearance, style and palette BEFORE first paint. `main.ts` does this too
      // (`appearance.ts`'s `applyAppearance`, `skin.ts`'s `applySkin`), but a module script always runs
      // after the page has already painted once — waiting for it would show the wrong theme for one frame
      // on every load, then snap to the right one. This inline copy is deliberately tiny and duplicated
      // rather than imported, since importing a module here would reintroduce exactly the delay it exists
      // to avoid; `prepaint.test.ts` holds its keys, style ids and pattern to `skin.ts`/`palettes.ts`.
      // `try/catch` because `localStorage` throws in some privacy modes, and a thrown error here must not
      // block the rest of the page from loading. The cached palette is applied only if it is exactly
      // palette declarations (`palettes.ts`'s `PALETTE_CSS_PATTERN`), so nothing else in storage can
      // reach the `style` attribute.
      try {
        var v = localStorage.getItem('redextape.appearance')
        if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v)
      } catch {}
      try {
        var s = localStorage.getItem('redextape.style')
        if (s === 'paper' || s === 'terminal' || s === 'instrument') document.documentElement.setAttribute('data-style', s)
        var c = localStorage.getItem('redextape.palette.css')
        if (c && /^(--[a-z0-9-]+: light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\); ?)+$/.test(c)) document.documentElement.setAttribute('style', c)
      } catch {}
    </script>
```

In the `<header class="bar">`, directly after `<button type="button" id="appearance"></button>`, add:

```html
      <label class="skin">
        style
        <select id="style"></select>
      </label>
      <label class="skin">
        palette
        <select id="palette"></select>
      </label>
```

- [ ] **Step 8: Run the pre-paint test to see it pass**

Run: `pnpm exec vitest run --project node tests/node/prepaint.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Keep the test shell identical to the page**

In `web/tests/browser/harness.ts`, change `SHELL`'s header so it reads:

```ts
export const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <label class="skin">style <select id="style"></select></label>
    <label class="skin">palette <select id="palette"></select></label>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`
```

- [ ] **Step 10: Write the failing switcher tests**

`web/tests/browser/skin-switcher.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { PALETTES } from '../../src/palettes'
import { PALETTE_CSS_KEY, PALETTE_KEY, STYLE_KEY } from '../../src/skin'
import { SHELL } from './harness'

const root = document.documentElement
const token = (name: string): string => getComputedStyle(root).getPropertyValue(`--${name}`).trim()
const pair = (id: keyof typeof PALETTES, t: 'bg' | 'accent'): string =>
  `light-dark(${PALETTES[id].light[t]}, ${PALETTES[id].dark[t]})`

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value
  select.dispatchEvent(new Event('change'))
}

describe('the style and palette controls', () => {
  let style: HTMLSelectElement
  let palette: HTMLSelectElement

  // One mount for the file, as every app test does: `main()` runs once per page.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    const s = document.querySelector<HTMLSelectElement>('#style')
    const p = document.querySelector<HTMLSelectElement>('#palette')
    if (s === null || p === null) throw new Error('the header has no style or palette control')
    style = s
    palette = p
  })

  it('mounts as Instrument, matching, with nothing stored', () => {
    expect(root.getAttribute('data-style')).toBe('instrument')
    expect(style.value).toBe('instrument')
    expect(palette.value).toBe('match')
    expect(token('bg')).toBe(pair('instrument', 'bg'))
  })

  it('offers every style and every palette by name', () => {
    expect([...style.options].map((o) => o.textContent)).toEqual(['Paper', 'Terminal', 'Instrument'])
    expect([...palette.options].map((o) => o.textContent)).toEqual(['match style', 'Paper', 'Terminal', 'Instrument'])
  })

  it('switches the style, and a matching palette follows it', () => {
    choose(style, 'paper')
    expect(root.getAttribute('data-style')).toBe('paper')
    expect(token('bg')).toBe(pair('paper', 'bg'))
    expect(localStorage.getItem(STYLE_KEY)).toBe('paper')
  })

  it('switches the palette without changing the style', () => {
    choose(palette, 'terminal')
    expect(root.getAttribute('data-style')).toBe('paper')
    expect(token('accent')).toBe(pair('terminal', 'accent'))
    expect(localStorage.getItem(PALETTE_KEY)).toBe('terminal')
  })

  it('caches what it applied, for the next load’s first paint', () => {
    expect(localStorage.getItem(PALETTE_CSS_KEY)).toContain(`--bg: ${pair('terminal', 'bg')};`)
  })
})
```

`web/tests/browser/skin-restore.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { PALETTES } from '../../src/palettes'
import { PALETTE_KEY, STYLE_KEY } from '../../src/skin'
import { SHELL } from './harness'

describe('a stored style and palette', () => {
  // Stored BEFORE the one mount this file makes — the state a returning visitor's page starts in.
  beforeAll(async () => {
    localStorage.setItem(STYLE_KEY, 'terminal')
    localStorage.setItem(PALETTE_KEY, 'paper')
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
  })

  it('is what the page mounts in, and what the controls say', () => {
    const root = document.documentElement
    expect(root.getAttribute('data-style')).toBe('terminal')
    expect(getComputedStyle(root).getPropertyValue('--bg').trim()).toBe(
      `light-dark(${PALETTES.paper.light.bg}, ${PALETTES.paper.dark.bg})`,
    )
    expect(document.querySelector<HTMLSelectElement>('#style')?.value).toBe('terminal')
    expect(document.querySelector<HTMLSelectElement>('#palette')?.value).toBe('paper')
  })
})
```

- [ ] **Step 11: Run them to see them fail**

Run: `pnpm exec vitest run --project browser tests/browser/skin-switcher.test.ts tests/browser/skin-restore.test.ts`
Expected: FAIL — the selects are empty and nothing sets `data-style` from storage.

- [ ] **Step 12: Wire the selects in `main.ts`**

Add to the imports:

```ts
import {
  applySkin,
  PALETTE_CHOICE_LABELS,
  PALETTE_CHOICES,
  PALETTE_CSS_KEY,
  PALETTE_KEY,
  readPaletteChoice,
  readStyle,
  STYLE_IDS,
  STYLE_KEY,
  STYLE_LABELS,
} from './skin'
```

After `const restoreLayoutButton = document.querySelector<HTMLButtonElement>('#restore-layout')`, add:

```ts
  const styleSelect = document.querySelector<HTMLSelectElement>('#style')
  const paletteSelect = document.querySelector<HTMLSelectElement>('#palette')
```

and add `!styleSelect ||` and `!paletteSelect ||` to the mount-point check beside `!appearanceButton ||`.

Directly after the appearance wiring (the `appearanceButton.addEventListener('click', …)` block), add:

```ts
  // THE STYLE AND PALETTE (Plan 7 part 1, spec §6), wired before `init()` for the appearance toggle's
  // reason: they touch nothing but storage and `<html>`, so they stay live on the startup-failure path.
  // Storage is guarded for the same reason too.
  const readSkinStorage = (key: string): string | null => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  const writeSkinStorage = (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // The choice still holds for this page load; it just will not survive a reload.
    }
  }
  for (const id of STYLE_IDS) styleSelect.append(new Option(STYLE_LABELS[id], id))
  for (const id of PALETTE_CHOICES) paletteSelect.append(new Option(PALETTE_CHOICE_LABELS[id], id))
  let style = readStyle(readSkinStorage(STYLE_KEY))
  let paletteChoice = readPaletteChoice(readSkinStorage(PALETTE_KEY))
  styleSelect.value = style
  paletteSelect.value = paletteChoice
  // Every apply refreshes the pre-paint cache, so the next load's first frame is this one.
  const applyChosenSkin = (): void => {
    writeSkinStorage(PALETTE_CSS_KEY, applySkin(document.documentElement, style, paletteChoice))
  }
  applyChosenSkin()
  styleSelect.addEventListener('change', () => {
    style = readStyle(styleSelect.value)
    writeSkinStorage(STYLE_KEY, style)
    applyChosenSkin()
  })
  paletteSelect.addEventListener('change', () => {
    paletteChoice = readPaletteChoice(paletteSelect.value)
    writeSkinStorage(PALETTE_KEY, paletteChoice)
    applyChosenSkin()
  })
```

- [ ] **Step 13: Style the two labels like the encoding picker**

In `web/src/style.css`, change the `.encoding {` selector line to `.encoding,\n.skin {` so both share the rule.

- [ ] **Step 14: Run the new browser tests to see them pass**

Run: `pnpm exec vitest run --project browser tests/browser/skin-switcher.test.ts tests/browser/skin-restore.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 15: Run the whole web suite, and Biome**

Run: `pnpm test && pnpm exec biome ci --error-on-warnings src/skin.ts src/main.ts src/style.css tests/node/skin.test.ts tests/node/prepaint.test.ts tests/browser/skin-switcher.test.ts tests/browser/skin-restore.test.ts tests/browser/harness.ts`
Expected: PASS and no Biome errors. Every app test mounts through `SHELL`, which now carries the selects `main.ts` requires. (Pre-flight: the first draft's `skin.test.ts` import list failed Biome's import ordering; it is corrected above.)

- [ ] **Step 16: Commit**

```bash
git add web/src/skin.ts web/src/main.ts web/src/style.css web/index.html web/tests/browser/harness.ts web/tests/node/skin.test.ts web/tests/node/prepaint.test.ts web/tests/browser/skin-switcher.test.ts web/tests/browser/skin-restore.test.ts
git commit -m "Style and palette controls, applied before first paint from a validated cache"
```

---

### Task 5: Inter and Hack, self-hosted

**Files:**
- Create: `web/src/fonts.css`, `web/public/licenses/hack-LICENSE.md`, `web/public/licenses/inter-LICENSE.txt`, `web/tests/node/licenses.test.ts`, `web/tests/browser/fonts.test.ts`
- Modify: `web/package.json` and `web/pnpm-lock.yaml` (through `pnpm add`), `web/src/style.css` (first line), `web/index.html` (two preload links)

**Interfaces:**
- Consumes: `--font-ui` and `--font-mono` naming `"Inter"` and `"Hack"` (Task 2).
- Produces: the `Inter` (400, 600) and `Hack` (400, 700) faces.

- [ ] **Step 1: Check the newest versions and install**

Run: `pnpm view hack-font version && pnpm view @fontsource/inter version`
Then: `pnpm add -D hack-font@<the first> @fontsource/inter@<the second>` (3.3.0 and 5.3.0 on 2026-09-17).

- [ ] **Step 2: Write the failing browser test**

`web/tests/browser/fonts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

const family = (f: FontFace): string => f.family.replaceAll('"', '')

// `tests/browser/setup.ts` loads `style.css` into every page, and with no `data-style` the page is
// Instrument — the fallback style — so these are the faces a first visit gets.
describe('the Instrument faces', () => {
  it('loads Hack for code, and it covers λ', async () => {
    const faces = await document.fonts.load('16px "Hack"', 'λx. x')
    expect(faces.map(family)).toContain('Hack')
  })

  it('loads Inter for labels, including its Greek subset', async () => {
    const faces = await document.fonts.load('16px "Inter"', 'λ')
    expect(faces.map(family)).toContain('Inter')
  })

  it('draws a term in Hack', () => {
    const term = document.createElement('pre')
    term.className = 'term'
    term.textContent = 'λx. x'
    document.body.append(term)
    expect(getComputedStyle(term).fontFamily.replaceAll('"', '')).toMatch(/^Hack,/)
    term.remove()
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm exec vitest run --project browser tests/browser/fonts.test.ts`
Expected: FAIL on the two `load` tests — no `@font-face` for either family, so `load` resolves to an empty list. `draws a term in Hack` already passes (the family name is in `--font-mono` since Task 2); it is there so a later edit to `--font-mono` fails it.

- [ ] **Step 4: Write `fonts.css`**

```css
/* The two faces Instrument draws with, self-hosted (Plan 7 part 1, spec §5). Both are declared always;
   a browser fetches a face only when something renders in it, so Paper and Terminal fetch nothing.

   INTER comes as fontsource's per-subset sheets: Latin, Latin-ext and Greek (λ δ β appear in labels), at
   the two weights the style sheet uses. HACK comes from its own package, regular and bold only — the
   `-subset` files it also ships are Latin-only and would drop λ. Hack has no 600; a `font-weight: 600`
   rule resolves to its 700, which is the browser's nearest-weight rule, not an accident.

   Bare package paths are resolved and bundled by Vite into `/assets/` with hashed names, which
   `deploy/nginx.conf` already serves as immutable. The two preload links in `index.html` name the same
   files, and Vite rewrites them to the same hashes. */
@import "@fontsource/inter/latin-400.css";
@import "@fontsource/inter/latin-ext-400.css";
@import "@fontsource/inter/greek-400.css";
@import "@fontsource/inter/latin-600.css";
@import "@fontsource/inter/latin-ext-600.css";
@import "@fontsource/inter/greek-600.css";

@font-face {
  font-family: "Hack";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("hack-font/build/web/fonts/hack-regular.woff2") format("woff2");
}

@font-face {
  font-family: "Hack";
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("hack-font/build/web/fonts/hack-bold.woff2") format("woff2");
}
```

At the very top of `web/src/style.css` (before the first comment), add:

```css
@import "./fonts.css";

```

- [ ] **Step 5: Run the font test to see it pass**

Run: `pnpm exec vitest run --project browser tests/browser/fonts.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Preload the first paint's two files**

In `web/index.html`, directly after `<meta name="viewport" …>`, add:

```html
    <!-- The two files a first Instrument paint needs (`fonts.css`). `/node_modules/…` is the form Vite
         rewrites to the hashed asset — a bare package path is left as written and 404s — and it resolves
         to the same hash `fonts.css` produces, so nothing is fetched twice. -->
    <link rel="preload" as="font" type="font/woff2" crossorigin href="/node_modules/hack-font/build/web/fonts/hack-regular.woff2" />
    <link rel="preload" as="font" type="font/woff2" crossorigin href="/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2" />
```

- [ ] **Step 7: Prove the preloads and the style sheet name the same built files**

Run: `pnpm run build:app && grep -oE 'href="/assets/[^"]+\.woff2"' dist/index.html && grep -oE 'url\(/assets/(hack-regular|inter-latin-400-normal)[^)]+\.woff2\)' dist/assets/*.css`
Expected: two `href="/assets/…woff2"` lines, and the same two file names inside `url(…)` in the built CSS. If an `href` still reads `/node_modules/…`, the rewrite did not happen — stop and check the path.

- [ ] **Step 8: Ship the licences**

```bash
mkdir -p public/licenses
cp node_modules/hack-font/LICENSE.md public/licenses/hack-LICENSE.md
cp node_modules/@fontsource/inter/LICENSE public/licenses/inter-LICENSE.txt
```

`web/tests/node/licenses.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// Vite copies `public/` into the site as-is, so these are the licence texts a visitor can reach at
// `/licenses/…`. They are committed copies; this holds each to the installed package's own, so a version
// bump that changes a licence fails here instead of shipping the old text.
describe('the font licences the site ships', () => {
  it('match the installed Hack package', () => {
    expect(read('../../public/licenses/hack-LICENSE.md')).toBe(read('../../node_modules/hack-font/LICENSE.md'))
  })

  it('match the installed Inter package', () => {
    expect(read('../../public/licenses/inter-LICENSE.txt')).toBe(read('../../node_modules/@fontsource/inter/LICENSE'))
  })
})
```

Run: `pnpm exec vitest run --project node tests/node/licenses.test.ts`
Expected: PASS, 2 tests.

Run: `pnpm run build:app && ls dist/licenses`
Expected: `hack-LICENSE.md  inter-LICENSE.txt`.

- [ ] **Step 9: Run the whole web suite**

Run: `pnpm test`
Expected: PASS. **This is the step most likely to turn something red that nothing in this plan names:** every browser test now renders in Inter and Hack instead of system faces, which changes text metrics. A test that measures a text-sized box (placement tests with a pixel tolerance, the TM value-line gap) may move. If one fails, measure what moved and why before touching the test; do not widen a tolerance to make it pass.

- [ ] **Step 10: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/src/fonts.css web/src/style.css web/index.html web/public/licenses web/tests/node/licenses.test.ts web/tests/browser/fonts.test.ts
git commit -m "Inter and Hack, self-hosted and preloaded, with their licences in the site"
```

---

### Task 6: Icons and the panel primitive

**Files:**
- Create: `web/src/icons.ts`, `web/src/panel.ts`, `web/tests/browser/panel.test.ts`
- Modify: `web/src/style.css` (panel and icon rules; the shared control-chrome selector)

**Interfaces:**
- Produces:
  - From `icons.ts`: `type IconName = 'disclose' | 'move-editor-here'`, `icon(name: IconName): SVGSVGElement`.
  - From `panel.ts`: `type PanelOptions = { readonly name: string; readonly label: string; readonly body: HTMLElement; readonly open?: boolean; readonly onToggle?: (open: boolean) => void }`, `type Panel = { readonly el: HTMLElement; readonly toggle: HTMLButtonElement; readonly actions: HTMLElement; readonly body: HTMLElement; isOpen(): boolean; setOpen(open: boolean): void }`, `createPanel(opts: PanelOptions): Panel`.

- [ ] **Step 1: Write the failing tests**

`web/tests/browser/panel.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { icon } from '../../src/icons'
import { createPanel } from '../../src/panel'

function body(): HTMLElement {
  const el = document.createElement('div')
  el.textContent = 'contents'
  return el
}

describe('icon', () => {
  it('is decorative, sized to the text, and drawn in the text colour', () => {
    const svg = icon('disclose')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
    expect(svg.classList.contains('icon')).toBe(true)
    expect(svg.querySelector('path')?.getAttribute('stroke')).toBe('currentColor')
  })

  it('draws a different shape for each meaning', () => {
    const d = (n: 'disclose' | 'move-editor-here') => icon(n).querySelector('path')?.getAttribute('d')
    expect(d('disclose')).not.toBe(d('move-editor-here'))
  })
})

describe('createPanel', () => {
  it('names itself, wraps the body, and starts open', () => {
    const b = body()
    const p = createPanel({ name: 'rules', label: 'rules', body: b })
    expect(p.el.dataset.panel).toBe('rules')
    expect(p.el.contains(b)).toBe(true)
    expect(p.toggle.textContent).toBe('rules')
    expect(p.toggle.getAttribute('aria-expanded')).toBe('true')
    expect(b.hidden).toBe(false)
    expect(p.isOpen()).toBe(true)
  })

  it('points its button at its body, and names the body by its button', () => {
    const b = body()
    const p = createPanel({ name: 'rules', label: 'rules', body: b })
    expect(b.id).not.toBe('')
    expect(p.toggle.getAttribute('aria-controls')).toBe(b.id)
    expect(b.getAttribute('role')).toBe('region')
    expect(b.getAttribute('aria-labelledby')).toBe(p.toggle.id)
  })

  it('gives two panels different ids', () => {
    const a = createPanel({ name: 'a', label: 'a', body: body() })
    const b = createPanel({ name: 'b', label: 'b', body: body() })
    expect(a.body.id).not.toBe(b.body.id)
    expect(a.toggle.id).not.toBe(b.toggle.id)
  })

  it('keeps an id the body already has', () => {
    const b = body()
    b.id = 'mine'
    createPanel({ name: 'x', label: 'x', body: b })
    expect(b.id).toBe('mine')
  })

  it('can start closed', () => {
    const b = body()
    const p = createPanel({ name: 'x', label: 'x', body: b, open: false })
    expect(b.hidden).toBe(true)
    expect(p.toggle.getAttribute('aria-expanded')).toBe('false')
    expect(p.el.dataset.open).toBe('false')
  })

  it('toggles on a click and reports the state it toggled to', () => {
    const b = body()
    const onToggle = vi.fn()
    const p = createPanel({ name: 'x', label: 'x', body: b, onToggle })
    p.toggle.click()
    expect(onToggle).toHaveBeenLastCalledWith(false)
    expect(b.hidden).toBe(true)
    expect(p.toggle.getAttribute('aria-expanded')).toBe('false')
    p.toggle.click()
    expect(onToggle).toHaveBeenLastCalledWith(true)
    expect(b.hidden).toBe(false)
  })

  // `setOpen` is how a view restores or resets a panel; a view must not hear its own write back as a
  // gesture, or a restore would be recorded as a user's choice.
  it('does not report a programmatic change', () => {
    const onToggle = vi.fn()
    const p = createPanel({ name: 'x', label: 'x', body: body(), onToggle })
    p.setOpen(false)
    p.setOpen(true)
    expect(onToggle).not.toHaveBeenCalled()
    expect(p.isOpen()).toBe(true)
  })

  // A REAL KEYBOARD, through Playwright — a synthetic `KeyboardEvent` never activates a button, so it
  // could not show this.
  it('is reached with Tab and toggled with Enter and Space', async () => {
    const before = document.createElement('input')
    const b = body()
    const p = createPanel({ name: 'x', label: 'x', body: b })
    document.body.append(before, p.el)
    before.focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(p.toggle)
    await userEvent.keyboard('{Enter}')
    expect(b.hidden).toBe(true)
    await userEvent.keyboard(' ')
    expect(b.hidden).toBe(false)
    before.remove()
    p.el.remove()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project browser tests/browser/panel.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/icons"`.

- [ ] **Step 3: Write `icons.ts`**

```ts
/**
 * Inline SVG icons, keyed by MEANING, not by shape (Plan 7 part 1, spec §9).
 *
 * WHY NOT CHARACTERS. No font the app ships covers the control glyphs (▸ ◀ ✕ ⌄ …) — measured on the font
 * files while planning part 1 — so each one fell back to whatever symbol face the OS had and looked
 * different on every machine. And one glyph did two jobs: `⌄` was both "show the editor" and "bring the
 * editor here". A name per meaning is what makes the umbrella design's rule 2 (one glyph, one meaning)
 * something the code enforces: two meanings are two names.
 *
 * Each icon is decorative — `aria-hidden`, not focusable — and drawn in `currentColor`, so it follows
 * the palette and the text beside it. The control it sits in carries the accessible name.
 */
export type IconName = 'disclose' | 'move-editor-here'

/** Stroke paths on a 16×16 grid. Drawn for this app; no icon set is vendored. */
const PATHS: Readonly<Record<IconName, string>> = {
  // A chevron pointing right; a panel's style sheet rotates it down when the panel is open.
  disclose: 'M6 3.5 L10.5 8 L6 12.5',
  // An arrow landing on a line: "put it here".
  'move-editor-here': 'M8 2.5 V10 M4.5 6.5 L8 10 L11.5 6.5 M3 13.5 H13',
}

const SVG = 'http://www.w3.org/2000/svg'

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'icon')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', PATHS[name])
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.5')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.append(path)
  return svg
}
```

- [ ] **Step 4: Write `panel.ts`**

```ts
import { icon } from './icons'

/**
 * A named, collapsible region of a view (Plan 7 part 1, spec §8) — the one disclosure mechanism, where
 * there used to be a one-off toggle per view.
 *
 * THE STATE IS `aria-expanded`, NOT THE LABEL. The controls this replaces relabelled themselves (`hide δ`
 * / `show δ`, `⌃` / `⌄`) and announced nothing — accessibility item 2. A disclosure button keeps one
 * name and carries its state as an attribute a screen reader reads.
 *
 * THE BODY IS THE CALLER'S OWN ELEMENT, wrapped rather than copied, so the view keeps its references,
 * its listeners and its class-based rules, and the panel only decides whether the body is `hidden`.
 *
 * `onToggle` FIRES FOR A GESTURE ONLY. `setOpen` is how a view restores or resets a panel, and a view
 * must not hear its own write back as a user's choice.
 */
export type PanelOptions = {
  /** Stable, for style rules and tests: `data-panel` on the panel. */
  readonly name: string
  /** What the disclosure button says. */
  readonly label: string
  readonly body: HTMLElement
  readonly open?: boolean
  readonly onToggle?: (open: boolean) => void
}

export type Panel = {
  readonly el: HTMLElement
  readonly toggle: HTMLButtonElement
  /** Header actions sit here, after the disclosure — `follow current rule` on the rules panel. */
  readonly actions: HTMLElement
  readonly body: HTMLElement
  isOpen(): boolean
  setOpen(open: boolean): void
}

let minted = 0

export function createPanel(opts: PanelOptions): Panel {
  const n = minted++
  const el = document.createElement('section')
  el.className = 'panel'
  el.dataset.panel = opts.name

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'panel-toggle'
  toggle.id = `panel-toggle-${n}`
  const label = document.createElement('span')
  label.className = 'panel-name'
  label.textContent = opts.label
  toggle.append(icon('disclose'), label)

  const actions = document.createElement('span')
  actions.className = 'panel-actions'

  const header = document.createElement('div')
  header.className = 'panel-header'
  header.append(toggle, actions)

  const body = opts.body
  if (body.id === '') body.id = `panel-body-${n}`
  body.setAttribute('role', 'region')
  body.setAttribute('aria-labelledby', toggle.id)
  toggle.setAttribute('aria-controls', body.id)
  el.append(header, body)

  let open = opts.open ?? true
  const apply = (): void => {
    toggle.setAttribute('aria-expanded', String(open))
    el.dataset.open = String(open)
    body.hidden = !open
  }
  apply()
  toggle.addEventListener('click', () => {
    open = !open
    apply()
    opts.onToggle?.(open)
  })

  return {
    el,
    toggle,
    actions,
    body,
    isOpen: () => open,
    setOpen(next: boolean) {
      if (next === open) return
      open = next
      apply()
    },
  }
}
```

- [ ] **Step 5: Style panels and icons**

In `web/src/style.css`, add after the `.banner` rule:

```css
/* A named, collapsible region (`panel.ts`). The header is chrome, on the chrome surface; the body is
   whatever the view put in it. */
.panel {
  margin-block-start: var(--space-2);
}
.panel-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-2);
  background: var(--bg-chrome);
  border-block: 1px solid var(--rule);
}
.panel-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) 0;
  border: 0;
  background: transparent;
  color: var(--fg-dim);
  font: inherit;
  font-size: var(--step--2);
  text-transform: var(--label-transform);
  letter-spacing: var(--label-tracking);
  cursor: pointer;
}
/* Every icon is text-sized and sits on the text's baseline (`icons.ts`). BEFORE the more specific
   `.panel-toggle .icon` rules below, because Biome's `noDescendingSpecificity` rejects a less specific
   selector that follows a more specific one (pre-flight: the first draft had this rule last). */
.icon {
  flex: none;
  width: 1em;
  height: 1em;
  vertical-align: -0.125em;
}
.panel-toggle .icon {
  transition: transform 120ms ease-out;
}
.panel[data-open="true"] > .panel-header .panel-toggle .icon {
  transform: rotate(90deg);
}
@media (prefers-reduced-motion: reduce) {
  .panel-toggle .icon {
    transition: none;
  }
}
.panel-actions {
  display: flex;
  gap: var(--space-2);
  margin-inline-start: auto;
}
```

In the shared control-chrome rule, change its selector from

```css
.layout-control,
.buffer-retire,
.buffer-temperature {
```

to

```css
.layout-control,
.buffer-retire,
.buffer-temperature,
.panel-actions button {
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm exec vitest run --project browser tests/browser/panel.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/icons.ts web/src/panel.ts web/src/style.css web/tests/browser/panel.test.ts
git commit -m "An icon registry keyed by meaning, and a panel whose state is aria-expanded"
```

---

### Task 7: The TM rule table becomes the rules panel

**Files:**
- Modify: `web/src/tm-pane.ts`, `web/src/style.css` (`.table-toggle`, `.table-reattach`, `.state-table`), `web/tests/browser/app.test.ts` (six `.table-toggle` lookups)

**Interfaces:**
- Consumes: `createPanel`, `type Panel` (Task 6).
- Produces: a `section.panel[data-panel="rules"]` in every TM view, whose body is the existing `.state-table` element and whose actions hold the existing `.table-reattach` button, relabelled `follow current rule`.

- [ ] **Step 1: Point the app tests at the new control**

In `web/tests/browser/app.test.ts`, replace each of the six occurrences of

```ts
document.querySelector('[data-leaf="tm-0"] .table-toggle') as HTMLButtonElement
```

with

```ts
document.querySelector('[data-leaf="tm-0"] [data-panel="rules"] .panel-toggle') as HTMLButtonElement
```

Then, in the test `hides and shows the table without losing the play head`, after `toggle.click()` and its `expect(table().hidden).toBe(true)`, add:

```ts
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
```

- [ ] **Step 2: Run the TM block to see it fail**

Run: `pnpm exec vitest run --project browser tests/browser/app.test.ts`
Expected: FAIL — `toggle` is `null` (`Cannot read properties of null (reading 'click')`) in the six table tests.

- [ ] **Step 3: Move the table onto a panel in `tm-pane.ts`**

Add to the imports: `import { createPanel, type Panel } from './panel'`.

Replace the field declaration `#toggle: HTMLButtonElement` with the declaration below. **The name is `#rulesPanel`, not `#rules`:** `TmPane` already has `#rules = 0`, the machine's rule count, which the fork control reads (pre-flight: the first draft collided with it and failed `tsc` six times).

```ts
  /**
   * The rule table as a panel (Plan 7 part 1, spec §8): the body is `#tableHost`, the header action is
   * `#reattach`. The panel hides and shows `#tableHost`; its `onToggle` keeps `#open` and redraws. Not
   * `#rules`, which is the machine's rule count.
   */
  #rulesPanel: Panel
```

In the constructor, delete the whole block that builds `this.#toggle` (from `this.#toggle = document.createElement('button')` through the end of its `addEventListener` callback, including the `REDRAW IN BOTH DIRECTIONS` comment inside it).

Change `this.#reattach.textContent = 'follow'` to `this.#reattach.textContent = 'follow current rule'`.

Directly after the `this.#rows.addEventListener('click', …)` block (the one commented `CLICK A ROW, LIGHT ITS SOURCE`), add:

```ts
    // THE RULE TABLE IS A PANEL. `panel.ts` hides `#tableHost` itself and carries the state in
    // `aria-expanded` rather than relabelling — accessibility item 2. `follow current rule` rides in the
    // panel's header, beside the thing it acts on.
    //
    // REDRAW IN BOTH DIRECTIONS, and the closing one is not symmetry for its own sake. `#drawTable` is
    // where `#reattach.hidden` is maintained, so skipping it on the way down left a live "follow" button
    // over a table that is not on screen — the idiom's own rule broken, and the `|| !this.#open` term
    // written for it could never fire because the only place that reads it did not run. Reopening matters
    // for a different reason: a hidden box has `clientHeight` 0, so any step taken while the table was
    // closed computed its scroll target against a zero-height viewport and left the head parked off
    // centre until some later step happened to recentre it.
    this.#rulesPanel = createPanel({
      name: 'rules',
      label: 'rules',
      body: this.#tableHost,
      onToggle: (open) => {
        this.#open = open
        this.#drawTable()
      },
    })
    this.#rulesPanel.actions.append(this.#reattach)
```

In the `this.#body.append(…)` call, replace the three entries `this.#toggle,`, `this.#reattach,` and `this.#tableHost,` with the single entry `this.#rulesPanel.el,`.

In the `#tableHost` scroll listener's comment, replace

```ts
      // Chromium: step, hide δ, show δ, and the table is detached with the current row gone from the
      // DOM. A hidden box cannot be scrolled by a person, so there is nothing here to honour.
```

with

```ts
      // Chromium: step, close the rules panel, reopen it, and the table is detached with the current row
      // gone from the DOM. A hidden box cannot be scrolled by a person, so there is nothing here to honour.
```

In `web/tests/browser/app.test.ts`, in the comment above `keeps the scroll range honest across a compile with the table hidden`, replace `plain user sequence: hide δ, edit the program, show δ.` with `plain user sequence: close the rules panel, edit the program, reopen it.` (pre-flight: Step 7's search found both).

- [ ] **Step 4: Update the style sheet**

Delete the `.table-toggle { … }` rule. Replace the `.table-reattach` comment and rule with:

```css
/* ADDED AND REMOVED, NEVER DISABLED (`pane-chrome.ts`'s comment for the continue button) — present only
   while `Follow` is detached, via `hidden` rather than `disabled`. It sits in the rules panel's header
   (`.panel-actions`), which gives it the shared control chrome. */
.table-reattach {
  font-size: var(--step--2);
}
```

In the `.state-table` rule, delete `margin-block-start: var(--space-2);` and `border-top: 1px solid var(--rule);` — the panel header now supplies both the gap and the rule.

- [ ] **Step 5: Run the app tests to see them pass**

Run: `pnpm exec vitest run --project browser tests/browser/app.test.ts`
Expected: PASS, including all six table tests.

- [ ] **Step 6: Run the TM view's own tests**

Run: `pnpm exec vitest run --project browser tests/browser/tm-pane-editor.test.ts tests/browser/tm-pane-follows-session.test.ts tests/browser/tm-scratch-fork.test.ts`
Expected: PASS.

- [ ] **Step 7: Check nothing still names the removed control**

Run: `git grep -n -E "table-toggle|hide δ|show δ" -- web/src web/tests`
Expected: one hit only — `panel.ts`'s own doc, which names `hide δ` / `show δ` as the controls the panel REPLACED (history, and correct). Any other hit describes the removed control as current: reword it to describe the rules panel, then re-run.

- [ ] **Step 8: Commit**

```bash
git add web/src/tm-pane.ts web/src/style.css web/tests/browser/app.test.ts
git commit -m "The TM rule table is a panel: aria-expanded instead of a label that rewrites itself"
```

---

### Task 8: The two editor collapses become one text panel; the claim button gets its own icon

**Files:**
- Modify: `web/src/pane-chrome.ts` (`collapseButton` → `textPanel`; `claimEditorButton`'s glyph; doc comments), `web/src/lambda-pane.ts`, `web/src/tm-pane.ts`, `web/src/style.css` (delete the two collapse rules), comments in `web/src/editor-custody.ts`, `web/src/scratch.ts`, `web/src/transport.ts`
- Rename: `web/tests/browser/pane-chrome-collapse.test.ts` → `web/tests/browser/pane-chrome-text-panel.test.ts`
- Modify tests: `web/tests/browser/lambda-pane-editor.test.ts`, `web/tests/browser/editor-custody.test.ts`, `web/tests/browser/buffer-restore.test.ts`, `web/tests/browser/tm-pane-editor.test.ts`

**Interfaces:**
- Consumes: `createPanel` (Task 6), `icon` (Task 6).
- Produces: `textPanel(body: HTMLElement, onToggle: (collapsed: boolean) => void): { readonly el: HTMLElement; update(available: boolean, initial?: boolean): void }` in `pane-chrome.ts`, with exactly `collapseButton`'s `update` contract: `initial` is read only on the unavailable → available transition, and becoming unavailable resets to open. A `section.panel[data-panel="text"]` wraps each view's editor host.

**What changes and what does not.** The persisted per-buffer collapse (`scratch.ts`'s `setCollapsed` / `collapsedOf`, `transport.ts`'s `collapse` handler, the custody seed) is untouched: `on.collapse(collapsed)` still reports every gesture with the same boolean. What changes is the control and the mechanism that hides the editor: the panel sets `hidden` on the editor host, so the `.is-collapsed` class (λ) and the `.collapsed` class on `.tm-pane` (TM), and their two CSS rules, go.

- [ ] **Step 1: Rewrite the unit test for the new control**

Run: `git mv web/tests/browser/pane-chrome-collapse.test.ts web/tests/browser/pane-chrome-text-panel.test.ts`

Replace its contents with:

```ts
import { describe, expect, it, vi } from 'vitest'
import { textPanel } from '../../src/pane-chrome'

function toggleOf(el: HTMLElement): HTMLButtonElement {
  const t = el.querySelector<HTMLButtonElement>('.panel-toggle')
  if (t === null) throw new Error('the text panel has no disclosure button')
  return t
}

describe('textPanel', () => {
  it('is named "text" whichever view builds it', () => {
    const t = textPanel(document.createElement('div'), () => {})
    expect(t.el.dataset.panel).toBe('text')
    expect(toggleOf(t.el).textContent).toBe('text')
  })

  it('is shown only while an editor is available', () => {
    const t = textPanel(document.createElement('div'), () => {})
    expect(t.el.hidden).toBe(true)
    t.update(true)
    expect(t.el.hidden).toBe(false)
    t.update(false)
    expect(t.el.hidden).toBe(true)
  })

  it('reports the collapse it toggles to, and carries the state in aria-expanded', () => {
    const body = document.createElement('div')
    const onToggle = vi.fn()
    const t = textPanel(body, onToggle)
    t.update(true)
    const toggle = toggleOf(t.el)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    toggle.click()
    expect(onToggle).toHaveBeenLastCalledWith(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(body.hidden).toBe(true)
    toggle.click()
    expect(onToggle).toHaveBeenLastCalledWith(false)
    expect(body.hidden).toBe(false)
  })

  // The buffer's own record decides where a mount starts (`collapsedOf`), and an unmount must not leave
  // that state behind for the next buffer to inherit — the defect `collapseButton` was once fixed for.
  it('starts where the buffer record says, and resets on unmount', () => {
    const body = document.createElement('div')
    const t = textPanel(body, () => {})
    t.update(true, true)
    expect(body.hidden).toBe(true)
    expect(toggleOf(t.el).getAttribute('aria-expanded')).toBe('false')
    t.update(false)
    t.update(true)
    expect(body.hidden).toBe(false)
    expect(toggleOf(t.el).getAttribute('aria-expanded')).toBe('true')
  })

  it('ignores a repeated update, as every per-frame control here must', () => {
    const body = document.createElement('div')
    const t = textPanel(body, () => {})
    t.update(true, true)
    t.update(true, false)
    expect(body.hidden).toBe(true)
  })
})
```

- [ ] **Step 2: Update the four view-level tests**

`web/tests/browser/lambda-pane-editor.test.ts` — replace the test `relabels the collapse control on remount, not just on the next click` (its leading comment and body) with:

```ts
  it('reopens the text panel on remount, not just on the next click', () => {
    // The reviewer's repro for the stale-state defect, carried over from the collapse button this panel
    // replaced: mount, collapse, unmount, remount. A remounted editor starts where its buffer's record
    // says (open, here), so the control that names its state has to say so too.
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.setEditor('\\x. x')

    const toggle = el.querySelector<HTMLButtonElement>('[data-panel="text"] .panel-toggle')
    if (toggle === null) throw new Error('the text panel was not added')
    toggle.click()
    expect(el.querySelector<HTMLElement>('.term-editor')?.hidden).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    pane.setEditor(null)
    pane.setEditor('\\y. y')

    const editorHost = el.querySelector<HTMLElement>('.term-editor')
    expect(editorHost).not.toBeNull()
    expect(editorHost?.hidden).toBe(false)
    expect(el.querySelector('[data-panel="text"] .panel-toggle')?.getAttribute('aria-expanded')).toBe('true')
  })
```

`web/tests/browser/editor-custody.test.ts` — in `a pane claiming another pane’s collapsed editor receives it collapsed`:
- replace `holder.host.querySelector<HTMLButtonElement>('button.collapse')` with `holder.host.querySelector<HTMLButtonElement>('[data-panel="text"] .panel-toggle')`;
- replace `expect(holder.host.querySelector('.term-editor')?.classList.contains('is-collapsed')).toBe(true)` with `expect(holder.host.querySelector<HTMLElement>('.term-editor')?.hidden).toBe(true)`;
- replace `expect(mounted?.classList.contains('is-collapsed')).toBe(true)` with `expect((mounted as HTMLElement | null)?.hidden).toBe(true)`;
- replace the two lines that find `claimerCollapse` and assert its `aria-label` with:

```ts
    const claimerToggle = claimer.host.querySelector<HTMLButtonElement>('[data-panel="text"] .panel-toggle')
    expect(claimerToggle?.getAttribute('aria-expanded')).toBe('false')
```

- in the three comments in that block that name `collapseButton`, `.collapse` or `.is-collapsed`, say `textPanel`, the text panel's toggle, and the host's `hidden` instead.

`web/tests/browser/buffer-restore.test.ts`:
- replace both `.classList.contains('is-collapsed')` assertions on `'[data-leaf="lambda-0"] .term-editor'` with `document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor')?.hidden` compared to the same boolean;
- replace `document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .collapse')?.click()` with `document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] [data-panel="text"] .panel-toggle')?.click()`;
- in the doc comments above those two tests, replace "reading `.is-collapsed`" with "hidden", and "`collapseButton`'s own label reads \"show the term editor\"" with "the text panel's toggle reads `aria-expanded=\"false\"`".

`web/tests/browser/tm-pane-editor.test.ts` — in `collapses by class and leaves the table renderer alone`: rename the test to `collapses the text panel and leaves the table renderer alone`; replace `host.querySelector<HTMLButtonElement>('button.collapse')?.click()` with `host.querySelector<HTMLButtonElement>('[data-panel="text"] .panel-toggle')?.click()`; replace `expect(host.querySelector('.tm-pane')?.classList.contains('collapsed')).toBe(true)` with `expect(host.querySelector<HTMLElement>('.term-editor')?.hidden).toBe(true)`.

- [ ] **Step 3: Run the five files to see them fail**

Run: `pnpm exec vitest run --project browser tests/browser/pane-chrome-text-panel.test.ts tests/browser/lambda-pane-editor.test.ts tests/browser/editor-custody.test.ts tests/browser/buffer-restore.test.ts tests/browser/tm-pane-editor.test.ts`
Expected: FAIL — `textPanel` is not exported, and the views have no `[data-panel="text"]`.

- [ ] **Step 4: Replace `collapseButton` with `textPanel` in `pane-chrome.ts`**

Add to the imports: `import { icon } from './icons'` and `import { createPanel } from './panel'`.

Replace the whole `collapseButton` doc comment and function with:

```ts
/**
 * The **text** panel: a copy's editable text — a λ term or a machine — as a collapsible region (Plan 7
 * part 1, spec §8). It replaces the `⌃/⌄` collapse button both views put in their control strips, and
 * gives what was one control with two nouns ("term editor", "machine source") one name.
 *
 * THE STATE IS `aria-expanded`, NOT A RELABEL — accessibility items 2 and 15 — and hiding is the panel
 * setting `hidden` on the body, which is the view's own editor host. The views keep no collapse class.
 *
 * SHOWN ONLY WHILE AN EDITOR IS MOUNTED, the "a control that provably cannot work should not be offered"
 * standard `detachButton` and `paneSelect` apply: `update(false)` hides the whole panel.
 *
 * **THE STATE IS PERSISTED PER BUFFER, NOT PER PANE**, because the editor MOVES: a collapse remembered
 * against a pane would describe whichever buffer landed there next. `scratch.ts`'s `setCollapsed` records
 * the gesture `onToggle` reports, and `update`'s `initial` is how the record reaches this closure: it is
 * read only on the unavailable → available transition, from the same `collapsedOf` read that seeds the
 * mount, so the control and the editor cannot arrive disagreeing.
 *
 * **AN UNMOUNT RESETS TO OPEN.** A reviewer once caught the predecessor coming back from an unmount and
 * remount still reading the PREVIOUS buffer's state over an editor that was showing; a hidden control
 * has no state left to survive with, so the next mount starts from its own record. The reset lives in
 * `update` behind the same no-op guard every control in this file has, because this runs on every
 * recorded frame during playback. Two callers hide it for the same unmount fact: a view's `setEditor(null)`
 * and its `takeEditor`, the custody half of the editor-moves rule.
 */
export function textPanel(
  body: HTMLElement,
  onToggle: (collapsed: boolean) => void,
): { readonly el: HTMLElement; update(available: boolean, initial?: boolean): void } {
  const panel = createPanel({ name: 'text', label: 'text', body, onToggle: (open) => onToggle(!open) })
  panel.el.hidden = true
  let on = false
  return {
    el: panel.el,
    update(available: boolean, initial = false) {
      if (available === on) return
      on = available
      if (available) {
        panel.setOpen(!initial)
        panel.el.hidden = false
        return
      }
      panel.el.hidden = true
      panel.setOpen(true)
    },
  }
}
```

In `claimEditorButton`, replace `el.textContent = '⌄'` with `el.append(icon('move-editor-here'))`.

In `claimEditorButton`'s doc comment, replace the paragraph beginning `A SEPARATE BUTTON FROM `collapseButton`` with:

```ts
 * A SEPARATE CONTROL FROM `textPanel`, WITH ITS OWN ICON. The two used to share the `⌄` glyph — the
 * inventory that opened Plan 7 found them told apart only by tooltip — and now `icons.ts` names each
 * meaning separately. They are also mutually exclusive by construction: the text panel is shown only
 * while THIS pane holds the mounted editor, and this button is offered only while the pane's session is
 * detached, this pane does NOT hold the editor, AND an editor for that session exists somewhere
 * (`LambdaPane`'s `#refreshClaim`, all three).
```

and replace the paragraph beginning `` `aria-label` DELIBERATELY DOES NOT REUSE `collapseButton`'s`` with:

```ts
 * THE `aria-label` NAMES THE ACTION — bring the editor here — which is a different action on a different
 * pane from the text panel's disclosure, and a screen-reader user must hear two names for the two.
```

and in the paragraph `ADDED AND REMOVED, NEVER DISABLED…`, replace `unlike \`collapseButton\`` with `unlike \`textPanel\``.

- [ ] **Step 5: Use it in `lambda-pane.ts`**

- In the import from `./pane-chrome`, replace `collapseButton,` with `textPanel,`.
- Replace `#collapse: ReturnType<typeof collapseButton>` with `#collapse: ReturnType<typeof textPanel>`.
- In the constructor, replace the `this.#collapse = collapseButton(this.#strip.el, (collapsed) => { … })` block with:

```ts
    // THE TEXT PANEL WRAPS THE EDITOR HOST and hides it itself; this callback only REPORTS the gesture —
    // see `PaneEvents.collapse`'s own doc for why the app needs telling (the state is recorded against
    // the buffer, not the pane).
    this.#collapse = textPanel(this.#editorHost, (collapsed) => on.collapse?.(collapsed))
```

- In `host.replaceChildren(title, this.#editorHost, this.#text, this.#strip.el)`, replace `this.#editorHost` with `this.#collapse.el`.
- In `setEditor`'s mount branch, replace `this.#editorHost.className = collapsed ? 'term-editor is-collapsed' : 'term-editor'` with `this.#editorHost.className = 'term-editor'`.
- In `receiveEditor`, make the same replacement.
- In the doc comment that says `` `collapseButton`'s callback (constructor, below) toggles `.is-collapsed` on`` (on `#editorHost` or near it), reword the sentence to say the text panel (`textPanel`, constructor below) hides the host with `hidden`.

- [ ] **Step 6: Use it in `tm-pane.ts`**

- In the import from `./pane-chrome`, replace `collapseButton,` with `textPanel,`.
- Replace `#collapse: ReturnType<typeof collapseButton>` with `#collapse: ReturnType<typeof textPanel>`.
- In the constructor, replace the comment and call that build `this.#collapse = collapseButton(this.#strip.el, (collapsed) => { this.#body.classList.toggle('collapsed', collapsed); on.collapse?.(collapsed) }, 'machine source')` with:

```ts
    // THE TEXT PANEL — the same control `LambdaPane` builds, with the same name ("text") where the two
    // used to say "term editor" and "machine source". It wraps `#editorHost` and hides it itself; this
    // callback only reports the gesture, for the buffer's record.
    this.#collapse = textPanel(this.#editorHost, (collapsed) => on.collapse?.(collapsed))
```

- In the `this.#body.append(…)` call, replace `this.#editorHost,` with `this.#collapse.el,`.
- In `setEditor`, delete `this.#body.classList.remove('collapsed')` (unmount branch) and `this.#body.classList.toggle('collapsed', collapsed)` (mount branch).
- In `takeEditor`, delete `this.#body.classList.remove('collapsed')`.
- In `receiveEditor`, delete `this.#body.classList.toggle('collapsed', collapsed)`.
- If `#body`'s own doc comment describes toggling `.collapsed` on it, reword that sentence to say the text panel hides `#editorHost`.

- [ ] **Step 7: Delete the two collapse rules**

In `web/src/style.css`, delete the `.term-editor.is-collapsed { display: none; }` rule with its comment (`Collapsed is ABSENT, not faded…`), and the `.tm-pane.collapsed .term-editor { display: none; }` rule with its comment (`5d-iv Task 8: the TM pane's collapse is a class on .tm-pane itself…`). The panel's `hidden` does both jobs.

- [ ] **Step 8: Fix every comment that still describes the old control**

Run: `git grep -n -E "collapseButton|is-collapsed|\.collapsed\b|'collapsed'|show the term editor|hide the term editor|machine source|button\.collapse" -- web/src web/tests`

For each hit: a code reference is a defect — fix it. A comment is now false if it describes the `⌃/⌄` glyph, the "show/hide the …" label, or a `.is-collapsed` / `.collapsed` class as current; reword it to describe `textPanel`, the panel's `aria-expanded`, or the host's `hidden`. The sites found while planning are `editor-custody.ts` (three), `scratch.ts` (two), `transport.ts` (three) and `pane-chrome.ts`'s `PaneEvents.collapse` and `detachButton` docs; the pre-flight build found three more — `tm-pane.ts`'s `#editor` field doc (it says collapsing toggles `.collapsed` on `#body`), `tm-pane.ts`'s `setEditor` doc paragraph **WHAT DIFFERS FROM LambdaPane IS WHERE THE COLLAPSE FLAG LANDS, NOT WHETHER IT DOES** (now false: both views hide the host the same way, so the paragraph should say that), and `detachButton`'s doc, which cites `collapseButton`'s `noun` parameter as a precedent (`textPanel` has no `noun`; state the current fact instead of the analogy). The search is the authority, not this list. Re-run until the only hits are in sentences that describe the old control **as history** (for example "the collapse button this panel replaced").

- [ ] **Step 9: Run the attribution and citation gates**

Run: `scripts/check-attributions.sh && scripts/check-citations.sh`
Expected: both pass. The attribution gate fails on any `` `pane-chrome.ts`'s `collapseButton` `` left behind, because nothing declares it now; each report names the file and line to fix.

- [ ] **Step 10: Run the five files to see them pass**

Run: `pnpm exec vitest run --project browser tests/browser/pane-chrome-text-panel.test.ts tests/browser/lambda-pane-editor.test.ts tests/browser/editor-custody.test.ts tests/browser/buffer-restore.test.ts tests/browser/tm-pane-editor.test.ts`
Expected: PASS.

- [ ] **Step 11: Run the whole web suite**

Run: `pnpm test`
Expected: PASS. The claim button's tests select it by its unchanged accessible name, so they are untouched.

- [ ] **Step 12: Commit**

```bash
git add -A web/src web/tests
git commit -m "One text panel for both views' editors, and the claim button stops sharing a glyph with it"
```

---

### Task 9: One focus ring

**Files:**
- Modify: `web/src/style.css` (a global rule, the divider rule, the editor frame)
- Test: `web/tests/browser/focus.test.ts`

**Interfaces:**
- Consumes: `--focus-ring` (Task 1–2), `createPanel` (Task 6).

- [ ] **Step 1: Write the failing test**

`web/tests/browser/focus.test.ts`:

```ts
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createPanel } from '../../src/panel'
import { until } from './harness'

/** `--focus-ring` resolved to a colour, the way the browser resolves it for an outline. */
function focusRingColour(): string {
  const probe = document.createElement('span')
  probe.style.color = 'var(--focus-ring)'
  document.body.append(probe)
  const c = getComputedStyle(probe).color
  probe.remove()
  return c
}

describe('the focus ring', () => {
  it('is drawn on a control reached by keyboard, in the palette’s focus colour', async () => {
    const before = document.createElement('input')
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'x'
    document.body.append(before, button)
    before.focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(button)
    const s = getComputedStyle(button)
    expect(s.outlineStyle).toBe('solid')
    expect(s.outlineWidth).toBe('2px')
    expect(s.outlineColor).toBe(focusRingColour())
    before.remove()
    button.remove()
  })

  // A borderless control is the case a missing ring hides completely.
  it('is drawn on a panel’s borderless disclosure button', async () => {
    const before = document.createElement('input')
    const p = createPanel({ name: 'x', label: 'x', body: document.createElement('div') })
    document.body.append(before, p.el)
    before.focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(p.toggle)
    expect(getComputedStyle(p.toggle).outlineStyle).toBe('solid')
    before.remove()
    p.el.remove()
  })

  // CodeMirror draws its own 1px dotted near-black outline on a focused editor's frame — invisible on a
  // dark palette. That one goes; the app's ring stays on the editable content, drawn inset so the
  // scroller around it cannot clip it. CodeMirror adds `cm-focused` from its own focus handling, so the
  // test waits for the class rather than assuming it is synchronous.
  it('rings a focused editor’s content in the palette’s focus colour, and drops CodeMirror’s own outline', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({ parent: host, doc: 'let x = 1' })
    view.focus()
    await until(() => view.dom.classList.contains('cm-focused'), 'the editor to report focus')
    const content = getComputedStyle(view.contentDOM)
    expect(content.outlineStyle).toBe('solid')
    expect(content.outlineColor).toBe(focusRingColour())
    expect(content.outlineOffset).toBe('-2px')
    expect(getComputedStyle(view.dom).outlineStyle).toBe('none')
    view.destroy()
    host.remove()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project browser tests/browser/focus.test.ts`
Expected: FAIL — the button's outline is the UA default (not `2px` in `--focus-ring`), and the editor's frame carries CodeMirror's dotted one.

- [ ] **Step 3: Add the ring**

In `web/src/style.css`, directly after the `* { box-sizing: border-box; }` rule, add:

```css
/* ONE FOCUS RING FOR THE WHOLE APP (Plan 7 part 1, spec §10; accessibility item 5). Every palette gives
   `--focus-ring` 3:1 against every surface (`palettes.test.ts`), and nothing here or elsewhere suppresses
   it. It is a neutral near-text colour in every palette, so it is never mistaken for a state mark. */
:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
```

Replace the `.layout-divider:focus-visible` comment and rule with:

```css
/* The divider keeps its ring INSIDE its own box: it is a 4px line between two panes, and a ring drawn
   outside it would sit on top of both. The colour and width are the global rule's. */
.layout-divider:focus-visible {
  outline-offset: -2px;
}
```

After the `.cm-editor .cm-scroller` rule (Task 2), add:

```css
/* A FOCUSED EDITOR SHOWS THE APP'S RING, NOT CODEMIRROR'S. CodeMirror's base theme draws a 1px dotted
   near-black outline on the focused frame, which disappears on a dark palette and doubles the ring on a
   light one; that outline is removed here — the class is doubled to outrank the base theme's two-class
   selector wherever its sheet lands in the cascade.

   THE APP'S RING GOES ON THE EDITABLE `.cm-content`, AND IT HAS TO BE RESTATED HERE, NOT INHERITED FROM
   THE GLOBAL RULE: the same base theme sets `outline: none` on `.cm-content` unconditionally, at two
   classes' specificity, which beats the one-class global `:focus-visible` rule whatever the cascade order
   (pre-flight: the first draft set only the offset here and drew no ring at all). The ring is pulled
   INSIDE the content's box, because `.cm-scroller` clips anything drawn outside it. */
.cm-editor.cm-editor.cm-focused {
  outline: none;
}
.cm-editor .cm-content:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm exec vitest run --project browser tests/browser/focus.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the whole web suite**

Run: `pnpm test`
Expected: PASS. `divider-drag.test.ts` and `pane-layout-controls.test.ts` exercise the divider's keyboard path; neither reads its outline.

- [ ] **Step 6: Commit**

```bash
git add web/src/style.css web/tests/browser/focus.test.ts
git commit -m "One focus ring in the palette's colour, on every control and every editor's frame"
```

---

### Task 10: Every marked state gets a shape

**Files:**
- Modify: `web/src/style.css` (the δ-table row rules; `.cm-editor .linked`; the three running-focus rules; `.term .is-linked`)
- Test: `web/tests/browser/marks.test.ts`

**Interfaces:**
- Consumes: the existing class names `state-row`, `is-current`, `is-firing`, `is-linked`, `is-focus`, `linked`, `is-focus-exact`, `is-focus-within`, `is-focus-coincident`, `is-redex`, `term`, `cm-editor`.

- [ ] **Step 1: Write the failing test**

`web/tests/browser/marks.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'

/** Build `html` inside a fresh container and return the element matching `selector`. */
function mount(html: string, selector: string): HTMLElement {
  const box = document.createElement('div')
  box.className = 'marks-fixture'
  box.innerHTML = html
  document.body.append(box)
  const el = box.querySelector<HTMLElement>(selector)
  if (el === null) throw new Error(`no ${selector}`)
  return el
}

afterEach(() => {
  for (const el of document.querySelectorAll('.marks-fixture')) el.remove()
})

describe('rows mark position with the left edge and the outline', () => {
  it('draws a solid left bar on the current row', () => {
    const row = mount('<div class="state-row is-current">q0</div>', '.state-row')
    expect(getComputedStyle(row).boxShadow).toContain('3px 0px 0px 0px inset')
  })

  it('keeps both cues on a row that is current AND in the running focus', () => {
    const s = getComputedStyle(mount('<div class="state-row is-current is-focus">q0</div>', '.state-row')).boxShadow
    expect(s).toContain('3px 0px 0px 0px inset')
    expect(s).toContain('0px -2px 0px 0px inset')
  })

  it('draws a dashed left edge on a linked row', () => {
    const row = mount('<div class="state-row is-linked">q0</div>', '.state-row')
    expect(getComputedStyle(row).borderLeftStyle).toBe('dashed')
  })

  it('keeps the outline on the firing row', () => {
    const row = mount('<div class="state-row is-firing">q0</div>', '.state-row')
    expect(getComputedStyle(row).outlineStyle).toBe('solid')
  })
})

describe('spans mark what you pinned with a box and where the machine is with an underline', () => {
  it('boxes a linked source span, without an underline', () => {
    const s = getComputedStyle(mount('<div class="cm-editor"><span class="linked">x</span></div>', '.linked'))
    expect(s.boxShadow).toContain('0px 0px 0px 1px inset')
    expect(s.textDecorationLine).toBe('none')
  })

  it('boxes a linked λ span the same way', () => {
    const s = getComputedStyle(mount('<pre class="term"><span class="is-linked">x</span></pre>', '.is-linked'))
    expect(s.boxShadow).toContain('0px 0px 0px 1px inset')
  })

  it('underlines the exact running focus solid, the within one dotted, and a coincidence double', () => {
    const style = (cls: string): string =>
      getComputedStyle(mount(`<div class="cm-editor"><span class="${cls}">x</span></div>`, `.${cls}`))
        .textDecorationStyle
    expect(style('is-focus-exact')).toBe('solid')
    expect(style('is-focus-within')).toBe('dotted')
    expect(style('is-focus-coincident')).toBe('double')
  })

  it('leaves the λ contractum as the one underlined mark in the λ view', () => {
    const s = getComputedStyle(mount('<pre class="term"><span class="is-redex">x</span></pre>', '.is-redex'))
    expect(s.boxShadow).toContain('0px -2px 0px 0px inset')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project browser tests/browser/marks.test.ts`
Expected: FAIL on the current row, the combined row, the linked row, both linked spans, and the running-focus underlines; the firing row and the contractum already pass.

- [ ] **Step 3: Give rows a left edge and composable bars**

In `web/src/style.css`, in the `.state-row { height: 24px; … }` rule, add after `padding-inline: 0.5rem;`:

```css
  /* THE ROW MARKS SHARE ONE `box-shadow`, composed from a variable per state, so a row that is both the
     current state and in the running focus shows both cues rather than whichever rule came last (Plan 7
     part 1, spec §11). The transparent left border is the linked row's channel, reserved on every row so
     marking one does not shift its text. */
  --row-bar: 0 0 transparent;
  --row-edge: 0 0 transparent;
  box-shadow: inset var(--row-bar), inset var(--row-edge);
  border-inline-start: 3px solid transparent;
```

Replace the `.state-row.is-linked` rule's body with:

```css
  background: var(--link-bg);
  border-inline-start-style: dashed;
  border-inline-start-color: var(--link-edge);
```

In `.state-row.is-focus`, replace `box-shadow: inset 0 -2px 0 var(--tok-operator);` with `--row-edge: 0 -2px 0 var(--tok-operator);`, and in its comment replace the paragraph beginning `COLOUR-ONLY, same wash-and-edge shape` with:

```css
   ITS CUE IS THE BOTTOM EDGE, composed through `--row-edge` so it survives beside the current row's bar. */
```

In `.state-row.is-current`, add `--row-bar: 3px 0 0 var(--accent);` after its `background` line.

- [ ] **Step 4: Box the linked spans**

Replace the body of `.cm-editor .linked` with:

```css
  background: var(--link-bg);
  box-shadow: inset 0 0 0 1px var(--link-edge);
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
```

and add to its comment: `A BOX, NOT AN UNDERLINE (Plan 7 part 1, spec §11): the underline now means only "where the machine is", so "what you pinned" takes a different shape rather than a different hue. \`clone\` gives each line of a wrapped span its own full box.`

Replace the body of `.term .is-linked` with the same four declarations.

- [ ] **Step 5: Underline the running focus by style**

Replace the body of `.cm-editor .is-focus-exact` with:

```css
  background: color-mix(in oklab, var(--tok-operator) 22%, transparent);
  text-decoration: underline solid var(--tok-operator) 2px;
  text-underline-offset: 0.2em;
```

Replace the body of `.cm-editor .is-focus-within` with:

```css
  background: color-mix(in oklab, var(--tok-operator) 10%, transparent);
  text-decoration: underline dotted var(--tok-operator) 2px;
  text-underline-offset: 0.2em;
```

Replace the body of `.cm-editor .is-focus-coincident` with:

```css
  --focus-coincident-hue: color-mix(in oklab, var(--tok-operator) 55%, var(--tok-nat) 45%);
  background: color-mix(in oklab, var(--focus-coincident-hue) 34%, transparent);
  text-decoration: underline double var(--focus-coincident-hue);
  text-decoration-thickness: 2px;
  text-underline-offset: 0.2em;
```

- [ ] **Step 6: Make the two comments above those rules true again**

In the comment above `.cm-editor .is-focus-exact`, replace the paragraph beginning `` `Exact` and `Within` are different claims`` up to (not including) the sentence beginning `Task 8's M2 measured` with:

```css
   `Exact` and `Within` are different claims (`reduce.rs`'s `Owner` doc) and must read that way, by SHAPE
   as well as strength (Plan 7 part 1, spec §11): `Exact` is a solid underline, `Within` a dotted one and a
   fainter wash.
```

In the comment above `.cm-editor .is-focus-coincident`, replace the whole `CORRECTED 2026-08-10, PR 5c's eyeball gate` paragraph with:

```css
   TWO NESTED ELEMENTS, TWO CUES — pinned by `running-focus.test.ts`: CodeMirror renders the two same-range
   marks as `<span class="is-focus-coincident"><span class="linked">…</span></span>`. Since Plan 7 part 1
   the inner `.linked` draws a BOX and the outer draws a DOUBLE underline, which `text-decoration`
   propagates to the text inside, so a reader sees both — "you pinned this" and "the machine is here" —
   neither of them only a colour. The blended hue still reaches the background, under `.linked`'s wash.
```

- [ ] **Step 7: Run it to see it pass**

Run: `pnpm exec vitest run --project browser tests/browser/marks.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 8: Run the whole web suite, and look**

Run: `pnpm test`
Expected: PASS. `running-focus.test.ts` pins the nesting, which this task does not change.

Then run the dev server, type `fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }` and `fact(3)` into the source, click a construct, and step the λ view: the pinned construct is boxed; the running focus is underlined; the current rule row has a left bar. Check it in light and dark.

- [ ] **Step 9: Commit**

```bash
git add web/src/style.css web/tests/browser/marks.test.ts
git commit -m "Every marked state has a shape: bars and edges on rows, boxes for pins, underline styles for the running focus"
```

---

### Task 11: Verify the whole branch, and write the roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (append the entry)

- [ ] **Step 1: Every web gate CI runs**

Run from `web/`:
- `pnpm exec biome ci .` — expected: no errors.
- `pnpm run typecheck` — expected: no errors.
- `pnpm test` — expected: PASS; note the file and test counts it prints.
- `pnpm run test:coverage` — expected: thresholds met; note the four percentages.

- [ ] **Step 2: Every hygiene gate**

Run from the repo root: `pre-commit run --all-files`
Expected: every hook `Passed` or `Skipped`.

- [ ] **Step 3: No Rust changed**

Run: `git diff --stat frontend-overhaul-design...HEAD -- crates Cargo.toml Cargo.lock`
Expected: no output. The Rust tiers are then unaffected by this branch and CI runs them anyway; record that in the entry rather than re-running them locally.

- [ ] **Step 4: The image serves the fonts and the licences**

CI's `docker` job never runs on a pull request, so this is the only check before merge. From the repo root:

```bash
docker build -t redextape-part1 .
docker run --rm -d -p 18080:80 --name redextape-part1 redextape-part1
curl -s http://localhost:18080/ | grep -oE 'href="/assets/[^"]+\.woff2"'
curl -sI "http://localhost:18080$(curl -s http://localhost:18080/ | grep -oE '/assets/hack-regular[^"]+\.woff2' | head -1)" | grep -iE '^(HTTP|content-type|cache-control)'
curl -sI http://localhost:18080/licenses/hack-LICENSE.txt | grep -iE '^(HTTP|content-type)'
curl -sI http://localhost:18080/licenses/inter-LICENSE.txt | grep -iE '^(HTTP|content-type)'
docker stop redextape-part1
```

Expected: two preload hrefs under `/assets/`; `HTTP/1.1 200`, `Content-Type: font/woff2`, a `Cache-Control` containing `immutable`; and for each licence `HTTP/1.1 200` with `Content-Type: text/plain` — a `200` alone would also be returned for a file served as `application/octet-stream`, which a browser downloads instead of showing (the reason the Hack licence ships as `.txt`).

- [ ] **Step 5: Look at all six variants**

Run the dev server. For each style (Paper, Terminal, Instrument) with its matching palette, in light and in dark (the `◐` toggle), load `fact(3)`, step both views, open and close the rules and text panels, and Tab through the header. Note anything that reads wrong — a colour, a clipped label, a missing ring — and fix it before the entry, with a commit per fix.

- [ ] **Step 6: Write the entry**

Append to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` an entry in the shape the file's recent entries use:

- Heading: `#### <WHAT THIS DID, IN THE ENTRY'S OWN VOICE> (<date>, branch \`plan7-part1-foundations\`, \`<first>..<last>\`, <N> commits, plus this entry)` — the range is `git log --oneline frontend-overhaul-design..HEAD` before the entry's own commit; its first and last SHAs and its count.
- `##### ` sections: what part 1 built; what the plan got wrong and what execution found (from the review records); how it relates to the accessibility list — items 2, 5 and 15 closed, the visual half of 4 and 7, the rest where the umbrella's §9 puts them.
- `##### WHAT THIS DID NOT CLOSE`: part 2's workspace state (panel state is not persisted per view yet); announcements (the non-visual half of items 4 and 7); `on-accent` and `warn` defined but not yet used; any finding from Step 5 left open.
- `##### VERIFICATION`, ending with a block **"Every count this entry quotes, with what produces it"** — one row per figure (test counts, coverage percentages, commit count, the palettes' lowest contrast ratio from `palettes.test.ts`), each with its command. **Run every command in that block before committing the entry.**

- [ ] **Step 7: Commit the entry**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "Roadmap: Plan 7 part 1, the foundations"
```
