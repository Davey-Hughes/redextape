import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'

/**
 * THE TREE, DRIVEN THROUGH THE APP — the state `main()` could not reach before this slice.
 *
 * `sessions.ts`'s `SessionRegistry` doc recorded the gap in as many words: "the app has ONE λ pane, so
 * two panes on two λ sessions is still unperformable through it", which is why
 * `binding-selector.test.ts` builds its panes by hand. This file is what closes that, and the
 * two-terms assertion below is the reason the slice is sequenced first.
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
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)
const panes = () => [...document.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf)
/**
 * The ids of every λ pane — by `data-kind`, NOT by an `id` prefix. `nextLeafId` now mints `pane-${n}`
 * regardless of which leg the split came from (`main.ts`'s own doc on `nextLeafId`: a pane can change
 * which leg it renders, so an id like `lambda-3` would describe something the pane is not), so
 * `dataset.kind` is the only truthful statement of what a leaf renders left to select on.
 */
const lambdaPanes = () => [...document.querySelectorAll<HTMLElement>('[data-kind="lambda"]')].map((e) => e.dataset.leaf)
const splitRowOn = (leaf: string) =>
  document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button[aria-label="split left and right"]`)

/**
 * Split `leaf` into a second pane of the same kind on the same session — the gesture every test here
 * used to reach with one click on the control `splitRowOn` finds.
 *
 * **A SPLIT IS TWO CLICKS NOW, AND THE FIRST ENTRY IS WHY IT IS STILL ONE GESTURE.** The control opens a
 * picker (`pane-chrome.ts`'s `splitControl`), whose first item is the pane's own `(leg, session)` pair
 * labelled `(same)` — put there precisely so the case that WAS the whole gesture stays one click away.
 * The label is checked rather than assumed: `find(...)?.click()` on a missing entry is a silent no-op,
 * and taking the first item of a menu that had reordered would quietly make every test below a test of a
 * different split. `pane-picker.test.ts` is where the other entries are exercised.
 */
const splitRow = (leaf: string): void => {
  const button = splitRowOn(leaf)
  if (button === null) throw new Error(`no split control on [data-leaf="${leaf}"]`)
  button.click()
  const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
  const first = menu?.querySelector<HTMLButtonElement>('button') ?? null
  if (first === null || !(first.textContent ?? '').endsWith('(same)')) {
    throw new Error(`${leaf}'s split menu does not start with the duplicate case: ${first?.textContent}`)
  }
  first.click()
}

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
    splitRow('lambda-0')
    expect(lambdaPanes().length).toBe(2)
  })

  /**
   * **THE ABSENCE IS REAL, BUT THIS TEST NO LONGER SAYS WHICH FACT PRODUCES IT — MINOR FINDING, AND
   * NOTED HERE RATHER THAN RESTRUCTURED AWAY.** `layoutControls` withholds the split controls for either
   * of two independent reasons: `canSplit: false`, or a caller that supplies no `choices` at all (that
   * function's own doc, and `pane-layout-controls.test.ts` pins both at the control's tier). `main.ts`
   * builds the source pane's strip with no `choices`, so this assertion would hold even if the
   * `canSplit` half were wired the other way, and nothing in this file pins the flag.
   *
   * WHAT KEEPS IT TRUE IS A LITERAL RATHER THAN A TEST: `pane-host.ts`'s `applyLayout` calls
   * `sourceLayout.update(live.size > 1, false)`, with `false` written out and documented as unchangeable
   * (source can never split — `splitLeaf` refuses it). A regression would have to edit that literal,
   * which is a deliberate act in a line whose comment says why it cannot move, not a drift.
   */
  it('offers no split control on the source pane', () => {
    expect(splitRowOn('source')).toBeNull()
  })

  it('closing a pane moves focus to the pane that grew, rather than to the body', () => {
    splitRow('lambda-0')
    const second = lambdaPanes()[1]
    const close = document.querySelector<HTMLButtonElement>(
      `[data-leaf="${second}"] button[aria-label="close this pane"]`,
    )
    close?.click()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.closest('[data-leaf]')).not.toBeNull()
  })

  /**
   * **THE OTHER GESTURE THAT ENDS SOMEWHERE — IMPORTANT FINDING, REVIEW OF THE PICKER COMMIT.** `close`
   * (above) and `rebind`'s cross-leg arm (`pane-kind-switch.test.ts`) both end in `focusPane`; the split
   * handler did not, and `layout-view.ts`'s `root.replaceChildren()` detaches the subtree the clicked
   * control is in, so the browser blurred it and the user was left on `<body>` — one Tab from the top of
   * the document, having just asked for a pane. Not a regression (the pre-picker split behaved the same),
   * but `splitControl`'s own doc argues that for a CREATION control with no other route to it "building
   * the keyboard path is the fix, not deferring it", and a handler that completes the gesture by
   * discarding focus abandons that argument one call later.
   *
   * IT PARKS FOCUS ON THE CONTROL FIRST, WHICH IS THE HALF THAT MAKES THIS A TEST RATHER THAN A GESTURE —
   * `pane-kind-switch.test.ts` records the same reason. `document.activeElement` is `<body>` on a page
   * nobody has clicked, so "focus is inside a pane afterwards" would pass against a no-op if focus had
   * never been anywhere else.
   *
   * IT NAMES THE CREATED LEAF, NOT MERELY "SOMEWHERE IN THE TREE". The close test above takes the weaker
   * form because a close has no pane of its own to return to; a split does — the leaf it just minted —
   * and focus landing in any OTHER pane would satisfy the weaker assertion while moving the user
   * somewhere they did not ask to be.
   */
  it('splitting a pane moves focus into the pane it created, rather than to the body', () => {
    const control = splitRowOn('lambda-0')
    if (control === null) throw new Error('the λ pane has no split control')
    control.focus()
    expect(document.activeElement).toBe(control)

    const before = panes()
    splitRow('lambda-0')
    const created = panes().find((id) => !before.includes(id))
    expect(created).not.toBeUndefined()

    expect(document.activeElement).not.toBe(document.body)
    const landed = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-leaf]')
    expect(landed?.dataset.leaf).toBe(created)
  })

  it('persists the tree and restores it', () => {
    splitRow('lambda-0')
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
