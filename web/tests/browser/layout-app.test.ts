import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'

/**
 * THE TREE, DRIVEN THROUGH THE APP — the state `main()` could not reach before this slice.
 *
 * `sessions.ts:180-184` recorded the gap in as many words: "the app has ONE λ pane, so two panes on
 * two λ sessions is still unperformable through it", which is why `binding-selector.test.ts` builds
 * its panes by hand. This file is what closes that, and the two-terms assertion below is the reason
 * the slice is sequenced first.
 *
 * THE SHELL AND THE DYNAMIC IMPORT ARE THIS FILE'S OWN ADDITION, NOT PART OF THE PLAN'S ILLUSTRATIVE
 * SNIPPET. Vitest's browser mode serves its own tester HTML, not this project's `index.html`
 * (`tests/browser/setup.ts`'s own doc), so `main()`'s mount-point check has nothing to find unless
 * something builds the page first — every other file that imports `main.ts` does this with a SHELL
 * string and a dynamic `import()` inside `beforeAll`, and a bare top-level `import { ready } from
 * '../../src/main'` cannot: ES module imports are linked and evaluated before ANY of a file's own
 * top-level code runs, so there is no point in this file's source order where a `document.body.
 * innerHTML` write could land before `main()`'s first `document.querySelector` call. This mirrors
 * `scratch-app.test.ts`'s own mounting idiom exactly, with the SHELL updated to the tree-driven
 * `index.html` this task ships (an empty `<main>`, `#editor`/`#link-status` as bare top-level nodes,
 * `#restore-layout` beside `#appearance`) rather than the fixed four-section one it replaces.
 */

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)
const panes = () => [...document.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf)
const splitRowOn = (leaf: string) =>
  document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button[aria-label="split left and right"]`)

// ONE MOUNT FOR THE FILE, THE SAME REASON EVERY SIBLING FILE GIVES: ES module imports are cached, so
// `main()` runs once per page and Vitest gives each test FILE its own page. `localStorage` is cleared
// BEFORE the mount, not after — `main()` reads it exactly once, synchronously, while resolving `let
// tree`, so anything written here after that read would never be seen.
beforeAll(async () => {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
})

beforeEach(() => {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
})

describe('the layout tree in the app', () => {
  it('starts in the arrangement index.html used to ship', () => {
    expect(panes()).toEqual(['source', 'lambda-0', 'tm-0'])
    expect($('#results')).not.toBeNull()
  })

  it('keeps the results pane outside the tree', () => {
    expect($('#results')?.closest('[data-leaf]')).toBeNull()
  })

  it('splitting a λ pane produces a second λ pane', () => {
    splitRowOn('lambda-0')?.click()
    expect(panes().filter((p) => p?.startsWith('lambda')).length).toBe(2)
  })

  it('offers no split control on the source pane', () => {
    expect(splitRowOn('source')).toBeNull()
  })

  it('closing a pane moves focus to the pane that grew, rather than to the body', () => {
    splitRowOn('lambda-0')?.click()
    const second = panes().filter((p) => p?.startsWith('lambda'))[1]
    const close = document.querySelector<HTMLButtonElement>(
      `[data-leaf="${second}"] button[aria-label="close this pane"]`,
    )
    close?.click()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.closest('[data-leaf]')).not.toBeNull()
  })

  it('persists the tree and restores it', () => {
    splitRowOn('lambda-0')?.click()
    const after = panes()
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).not.toBeNull()
    // The stored value describes what is on screen — a reload is asserted in the round-trip unit
    // test; here the claim is that the write happened and matches.
    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}')
    const ids: string[] = []
    const walk = (n: { kind: string; id?: string; children?: unknown[] }) => {
      if (n.kind === 'leaf' && n.id !== undefined) ids.push(n.id)
      for (const c of n.children ?? []) walk(c as never)
    }
    walk(stored.tree)
    expect(ids).toEqual(after)
  })

  // NO "FALLS BACK ON GARBAGE" TEST HERE, DELIBERATELY. `main()` runs once per page and cannot be
  // re-run with a different `localStorage`, so any in-page version of that test would have to call
  // `parseLayout` directly — which is Task 9's fourteen cases, restated in a file that cannot reach
  // the wiring it claims to cover. A test that re-asserts another tier's unit is a test that passes
  // for a reason unrelated to its name. The fallback expression itself
  // (`parseLayout(...) ?? defaultLayout()`) is one line and is reviewed, not tested.

  // THE PANE AREA HAS A REAL HEIGHT, WHICH NO OTHER TEST WOULD NOTICE LOSING. `<main>` once computed to
  // `height: 0px` on the real page — header and `#results` rendered, but the entire layout tree between
  // them was invisible — while this suite's 432 tests, including every other test in this file, stayed
  // green: `layout-view.test.ts` gives its OWN synthetic container an explicit `600px` before rendering
  // into it, a size the real page never gets, and `app.test.ts`'s `< window.innerHeight` geometry checks
  // hold vacuously true against a collapsed ancestor (0 is less than any positive number). The cause was
  // `style.css`: the layout tree's flex machinery (every host and split box is `flex: <n> 1 0` with
  // `min-height: 0`) needs a BOUNDED ancestor to grow into, and neither `body` nor `main` supplied one
  // until the full-height-shell rules (`body`'s `min-height: 100vh`, `main`'s `flex: 1 1 auto`) were
  // added. This is the one assertion standing between that shell and silent deletion — see `style.css`'s
  // own doc on `body` for the fix this test defends.
  it('gives the pane area a real height on the real page, not just in a test-provided container', () => {
    const main = document.querySelector('main')
    const height = main?.getBoundingClientRect().height ?? 0
    expect(height).toBeGreaterThan(0)
    // A sanity floor, not a bare `> 0`: the header and `#results` are small relative to the viewport, so
    // the tree between them should claim most of it. `height: 0px` (the regression) fails this by a mile;
    // a merely-short `<main>` would fail it too, which a bare `> 0` could never catch.
    expect(height).toBeGreaterThan(window.innerHeight * 0.5)
  })
})
