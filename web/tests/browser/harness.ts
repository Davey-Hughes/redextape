import html from '../../index.html?raw'

/**
 * Shared browser-tier fixtures: the app shell every test file mounts into, and the poll helper every
 * test file waits on; and, for the tests of what a reload draws first, the page's own pre-paint script,
 * the palette picked from the settings menu, and a colour as `getComputedStyle` writes it. The shell and
 * the poll helper were duplicated — `SHELL` 29 times, `until` 23 times in 7 different bodies — the reload's
 * helpers twice, and `rgb` four times, until this file replaced them.
 *
 * **WHY THIS DOES NOT BREAK THE DIRECTORY'S STANDING IDIOM.** Files in this directory have long carried
 * a comment saying that each browser test file gets its own page — `main()` runs once per module load
 * and Vitest gives each test file its own page — and concluding from it that duplicating a mount
 * helper is right, because "a shared mount would be a shared page two files could not both own". The
 * premise is a fact about the test runner and it holds; the conclusion is about a MOUNT. `SHELL` is an
 * inert template string and `until` closes over nothing, so importing either into two files shares no
 * page, no state and no mount. `setup.ts` already demonstrates a shared non-test module being loaded
 * once per page without sharing anything across pages. `mountApp` deliberately stays per-file: four
 * files declare one, all four bodies differ, and each owns its own page.
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
  <header class="bar">
    <span class="wordmark">redextape</span>
    <button type="button" id="workspace" aria-haspopup="menu" aria-controls="workspace-menu" aria-expanded="false">Explorer <span aria-hidden="true">▾</span></button>
    <div id="workspace-menu" class="header-menu" popover>
      <button type="button" id="reset-preset">reset preset — restores the default views</button>
    </div>
    <button type="button" id="new-view" aria-haspopup="menu" aria-controls="new-view-menu" aria-expanded="false">+ view</button>
    <div id="new-view-menu" class="header-menu" popover></div>
    <button type="button" id="buffers">copies <span aria-hidden="true">▾</span></button>
    <button type="button" id="examples" aria-haspopup="menu" aria-controls="examples-menu" aria-expanded="false">examples <span aria-hidden="true">▾</span></button>
    <div id="examples-menu" class="header-menu" popover></div>
    <label class="encoding">
      encoding
      <select id="encoding"></select>
    </label>
    <span class="bar-spacer"></span>
    <button type="button" id="share" aria-controls="share-menu" aria-expanded="false">share</button>
    <div id="share-menu" class="header-menu share" popover></div>
    <button type="button" id="appearance"></button>
    <button type="button" id="settings" aria-haspopup="menu" aria-controls="settings-menu" aria-expanded="false">settings</button>
    <div id="settings-menu" class="header-menu settings" popover>
      <label class="skin">style <select id="style"></select></label>
      <label class="skin">palette <select id="palette"></select></label>
      <label class="skin">appearance <select id="appearance-choice"></select></label>
      <label class="skin">keymap <select id="keymap"></select></label>
        <label class="skin"><input type="checkbox" id="format-on-blur" /> format on blur</label>
        <button type="button" id="import-base16">import base16…</button>
    </div>
  </header>
  <div id="notice" class="notice" hidden></div>
  <div id="live" class="visually-hidden" role="status"></div>
  <main>
    <div id="views"></div>
    <aside id="inspector" class="inspector" hidden></aside>
  </main>
  <div id="step-bar" class="step-bar" hidden></div>
  <div id="editor"></div>
  <footer class="strip">
    <section id="results" class="results"></section>
    <div id="link-status" class="link-status"></div>
  </footer>`

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
 * ever fire. 10,000 clears both bounds. **That property is per WAIT, not per test.** Vitest's bound
 * covers a test as a whole, so one wait can reach this ceiling and still print its own name while two
 * in the same test cannot. This paragraph once added that no wait in this tier exceeded 2,000 ms. On
 * 2026-09-19 an unconstrained run of the whole tier, with every wait's time logged, put the slowest at
 * 2,227 ms: a spinner's first recording in `tm-reduced-buffer.test.ts`, whose supersession test waited
 * on three recordings in one body, and on the slower of the two CI runners Vitest's cap fired in that
 * test with no name, twice. That file now gives each such wait a hook or a body of its own.
 *
 * **DO NOT PASS `timeoutMs` FROM A CALL SITE.** `tests/node/browser-timeout-invariants.test.ts` fails if
 * any call site under `tests/browser/` passes a numeric timeout. A wait that genuinely needs longer is a
 * reason to change this default and say why in the commit, not to add a number nothing re-checks.
 *
 * **THE REAL CEILING IS `timeoutMs + pollMs`, NOT `timeoutMs` ALONE**, because the throw only fires once
 * a sleep returns and finds the predicate still false. At today's defaults that is 10,000 + 20 = 10,020
 * ms, comfortably under both vitest bounds — but the gate above reads only `timeoutMs`; nothing checks
 * `pollMs`. A future `pollMs` raised high enough reintroduces the exact defect this file exists to close,
 * with the gate reporting green throughout, because it was never asked about the parameter that moved.
 *
 * **`pollMs` EXISTS FOR THE NODE-TIER UNIT TESTS IN `tests/node/harness.test.ts`, AND MUST NOT BE PASSED
 * FROM THE BROWSER TIER.** Shortening the poll interval there is what lets a unit test built around a
 * fake predicate finish in milliseconds instead of waiting out a real one; no file under `tests/browser/`
 * has a reason to pass it. The gate's own boundary does not distinguish which parameter a call site's
 * argument lands in, so a browser call passing only `pollMs` numerically is still rejected — with a
 * message reading "passes a numeric timeout", which is true of the ceiling this file protects and not of
 * which of the two parameters actually carried the number.
 */
export async function until(predicate: () => boolean, what?: string, timeoutMs = 10_000, pollMs = 20): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what ?? sourceOf(predicate)}`)
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

/** The one classic script in `index.html`: the pre-paint script, which draws a load's first frame from storage. */
export const PREPAINT = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''

/** `#rrggbb` as `getComputedStyle` writes a colour. */
export const rgb = (hex: string): string =>
  `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

/** The attributes of `<html>` the pre-paint script sets from storage: the palette, the style and the appearance. */
const PREPAINTED = ['style', 'data-style', 'data-theme'] as const

/**
 * `<body>`'s background on a reload's first frame: `PREPAINT` run alone, on `<html>` as `index.html`'s markup has it
 * — no inline palette, the markup's `data-style`, no `data-theme` — so what the script finds in storage is all that
 * differs, as on a load. **THE PAGE IS PUT BACK AS IT WAS AFTER**, those attributes included, so the file's next case
 * meets the page this load drew, not the one a reload would.
 */
export function reloaded(): string {
  if (PREPAINT === '') throw new Error('index.html has no pre-paint script')
  const root = document.documentElement
  const markup = new DOMParser().parseFromString(html, 'text/html').documentElement
  const kept = PREPAINTED.map((name) => [name, root.getAttribute(name)] as const)
  for (const name of PREPAINTED) {
    const value = markup.getAttribute(name)
    if (value === null) root.removeAttribute(name)
    else root.setAttribute(name, value)
  }
  new Function(PREPAINT)()
  const first = getComputedStyle(document.body).backgroundColor
  for (const [name, value] of kept) {
    if (value === null) root.removeAttribute(name)
    else root.setAttribute(name, value)
  }
  return first
}

/**
 * Pick `value` from the settings menu's select `id`, as a user does — the menu opened, the option chosen, the menu
 * closed — so the select's own `change` is what reaches `main.ts`.
 *
 * **`vitest/browser` IS IMPORTED HERE, WHEN IT IS CALLED, NOT AT THE TOP OF THE FILE.** The node tier's
 * `harness.test.ts` imports this file for `SHELL` and `until`, and `vitest/browser` refuses to load outside the
 * browser tier, which a top-level import would make it do.
 */
async function chooseSetting(id: string, value: string): Promise<void> {
  const { userEvent } = await import('vitest/browser')
  const settings = document.querySelector<HTMLElement>('#settings') as HTMLElement
  await userEvent.click(settings)
  await userEvent.selectOptions(document.querySelector(id) as HTMLSelectElement, value)
  await userEvent.click(settings)
  if (document.querySelector('#settings-menu')?.matches(':popover-open'))
    throw new Error('the settings menu stayed open')
}

/** Pick a palette from the settings menu, as `chooseSetting` does. */
export const choosePalette = (value: string): Promise<void> => chooseSetting('#palette', value)

/** Pick a style from the settings menu, as `chooseSetting` does. */
export const chooseStyle = (value: string): Promise<void> => chooseSetting('#style', value)
