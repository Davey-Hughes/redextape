import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { box, queryEl, SHELL, splitRow } from './harness'

/**
 * THE TREE, DRIVEN THROUGH THE APP.
 *
 * Vitest's browser mode serves its own tester HTML, not this project's `index.html`
 * (`tests/browser/setup.ts`'s own doc), so `main()`'s mount-point check has nothing to find unless
 * something builds the page first. This file builds it with a SHELL string and a dynamic `import()`
 * inside `beforeAll`; a bare top-level `import { ready } from '../../src/main'` cannot: ES module imports
 * are linked and evaluated before ANY of a file's own top-level code runs, so there is no point in this
 * file's source order where a `document.body.innerHTML` write could land before `main()`'s first
 * `document.querySelector` call.
 */

const panes = () => [...document.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf)
/**
 * The ids of every λ pane — by `data-kind`, NOT by an `id` prefix. `nextLeafId` mints `pane-${n}`
 * regardless of which leg the split came from (`main.ts`'s own doc on `nextLeafId`: a pane can change
 * which leg it renders, so an id like `lambda-3` would describe something the pane is not), so
 * `dataset.kind` is the truthful statement of what a leaf renders.
 */
const lambdaPanes = () => [...document.querySelectorAll<HTMLElement>('[data-kind="lambda"]')].map((e) => e.dataset.leaf)
const splitRowOn = (leaf: string) =>
  document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] .view-menu button.view-split[data-dir="row"]`)

// ONE MOUNT FOR THE FILE: ES module imports are cached, so `main()` runs once per page and Vitest gives
// each test FILE its own page. Storage needs no clearing before the mount: each browser test file gets its
// own in-memory `Storage`, installed in `tests/browser/setup.ts` before this file's own module body runs;
// see that file's doc for why.
beforeAll(async () => {
  // WIDE ENOUGH FOR ITS ADDS: at the runner's default 414 px a view is 201 px wide, and the app refuses a split or a
  // `+ view` that leaves a view under `MIN_VIEW_PX` (`layout.ts`). The default's 896 px height is kept.
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
})

beforeEach(() => {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
})

describe('the layout tree in the app', () => {
  // (source | λ) above (asm | TM): `harness.ts`'s `fourViews()`, the workspace `setup.ts` stores for every file. What
  // a page with nothing stored opens on is `first-load-views.test.ts`'s.
  it('starts on the four views the stored workspace holds', () => {
    expect(panes()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
    expect(queryEl('#results')).not.toBeNull()
  })

  it('keeps the results pane outside the tree', () => {
    expect(queryEl('#results')?.closest('[data-leaf]')).toBeNull()
  })

  it('splitting a λ pane produces a second λ pane', () => {
    splitRow('lambda-0')
    expect(lambdaPanes().length).toBe(2)
  })

  /**
   * **THE ABSENCE IS REAL, BUT THIS TEST DOES NOT SAY WHICH FACT PRODUCES IT.** `viewMenu` withholds the
   * split controls for either of two independent reasons: `canSplit: false` (`setLayout`'s doc), or a
   * caller that leaves out `split` or `choices` (it builds the split items only when given both).
   * `view-menu.test.ts` pins the `canSplit` half at the control's tier. `main.ts` builds the source pane's
   * strip with no `choices`, so this assertion would hold even if the `canSplit` half were wired the other
   * way, and nothing in this file pins the flag.
   *
   * WHAT KEEPS IT TRUE IS A LITERAL RATHER THAN A TEST: `pane-host.ts`'s `applyLayout` calls
   * `sourceLayout.update(live.size > 1, false)`, with `false` written out and documented as unchangeable
   * (source can never split — `splitLeaf` refuses it). A regression would have to edit that literal,
   * which is a deliberate act, not a drift.
   */
  it('offers no split control on the source pane', () => {
    expect(splitRowOn('source')).toBeNull()
  })

  /**
   * **IT NAMES THE PANE THAT TOOK THE CLOSED ONE'S SPACE, NOT MERELY "SOMEWHERE IN THE TREE".** A close focuses
   * `main.ts`'s `neighbourOf`, the view before the closed one in the tree's order, and `closeLeaf` gives the space to
   * what is left of the closed leaf's own split. For a pane a split created, both are the pane it was split from
   * while nothing has been split or added inside that split since: `splitLeaf` puts the two in a split of their own,
   * the created one second. Focus landing in any other pane would satisfy "somewhere in the tree" while moving the
   * user away from the view they were working in.
   *
   * IT CLOSES THE λ PANE 'splitting a λ pane produces a second λ pane' CREATED, AND SPLITS NONE OF ITS OWN. The
   * tests share one mount, and at this viewport a second split of `lambda-0` would leave a view under `MIN_VIEW_PX`,
   * so `pane-host.ts`'s `admit` refuses it. The split test below needs `lambda-0` whole again, which this close
   * gives it.
   *
   * IT MEASURES WHICH PANE GREW, so the pane the focus is held to is the one the user sees take the space.
   *
   * IT PARKS FOCUS ON THE `✕` FIRST: a focus that had never left `lambda-0` would pass against a close that
   * moved nothing.
   */
  it('closing the pane a split created moves focus into the pane it was split from, which takes its space', () => {
    const created = lambdaPanes()[1]
    if (created === undefined) throw new Error('no second λ pane to close')
    const close = document.querySelector<HTMLButtonElement>(
      `[data-leaf="${created}"] button[aria-label="close this view"]`,
    )
    if (close === null) throw new Error(`[data-leaf="${created}"] has no close control`)
    close.focus()
    expect(document.activeElement).toBe(close)

    const area = (leaf: string | undefined): number => {
      const b = box(leaf ?? '')
      return b.width * b.height
    }
    const sizes = new Map(panes().map((id) => [id, area(id)]))
    close.click()

    const grew = panes().filter((id) => area(id) > (sizes.get(id) ?? Number.POSITIVE_INFINITY) + 1)
    expect(grew).toEqual(['lambda-0'])
    expect(document.activeElement).not.toBe(document.body)
    const landed = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-leaf]')
    expect(landed?.dataset.leaf).toBe('lambda-0')
  })

  /**
   * **THE OTHER GESTURE THAT ENDS SOMEWHERE.** `close` (above) and `rebind`'s cross-leg arm
   * (`pane-kind-switch.test.ts`) both end in `focusPane`, and so must a split: the `root.replaceChildren()`
   * in `layout-view.ts` detaches the subtree the clicked control is in, so the browser blurs it, and a split
   * that ended nowhere would leave the user on `<body>` — one Tab from the top of the document, having just
   * asked for a pane.
   *
   * IT PARKS FOCUS ON THE CONTROL FIRST, WHICH IS THE HALF THAT MAKES THIS A TEST RATHER THAN A GESTURE —
   * `pane-kind-switch.test.ts` records the same reason. `document.activeElement` is `<body>` on a page
   * nobody has clicked, so "focus is inside a pane afterwards" would pass against a no-op if focus had
   * never been anywhere else.
   *
   * IT NAMES THE CREATED LEAF, NOT MERELY "SOMEWHERE IN THE TREE", as the close test above names the pane
   * that took the closed one's space: focus landing in any OTHER pane would satisfy the weaker assertion
   * while moving the user somewhere they did not ask to be.
   */
  it('splitting a pane moves focus into the pane it created, rather than to the body', () => {
    // THE `⋯` IT IS CHOSEN FROM, NOT THE ITEM: the item sits in a closed popover, where `.focus()` is a
    // silent no-op and the park this test depends on would never happen.
    const control = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-more')
    if (control === null) throw new Error('the λ view has no ⋯ menu')
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
    // The stored value describes what is on screen — that `serializeWorkspace`'s output parses back is
    // `tests/node/workspace.test.ts`'s 'round-trips version 2'; here the claim is that the write happened
    // and matches.
    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}')
    // THE VERSION 2 WORKSPACE (Plan 7 part 2 spec §3): the tree under `tree`, beside the switches,
    // the speed, the focus and the panels.
    expect(stored.version).toBe(2)
    for (const field of ['switches', 'speed', 'focused', 'panels']) expect(stored).toHaveProperty(field)
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
  // `parseWorkspace` directly — restating its unit cases (`tests/node/workspace.test.ts`) in a file that
  // cannot reach the wiring it claims to cover. A test that re-asserts another tier's unit is a test that
  // passes for a reason unrelated to its name. The fallback expression itself
  // (`parseWorkspace(...) ?? defaultWorkspace(viewsShape())`) has files of its own, since this file mounts
  // once: `first-load-views.test.ts` with nothing stored, and `workspace-bound.test.ts` with a workspace the
  // loader refuses.

  // THE PANE AREA HAS A REAL HEIGHT. The layout tree's flex machinery (every host and split box is
  // `flex: <n> 1 0` with `min-height: 0`) needs a BOUNDED ancestor to grow into, which `style.css`'s
  // full-height-shell rules (`body`'s `min-height: 100vh`, `main`'s `flex: 1 1 auto`) supply. Neither
  // `layout-view.test.ts` nor `app.test.ts` would notice those rules gone: the first gives its OWN
  // synthetic container an explicit `600px` before rendering into it, a size the real page never gets,
  // and the second's `< window.innerHeight` geometry checks hold vacuously true against a collapsed
  // ancestor (0 is less than any positive number). See `style.css`'s own doc on `body` for the
  // rules this test defends.
  it('gives the pane area a real height on the real page, not just in a test-provided container', () => {
    const main = document.querySelector('main')
    const height = main?.getBoundingClientRect().height ?? 0
    expect(height).toBeGreaterThan(0)
    // A sanity floor, not a bare `> 0`: the header and `#results` are small relative to the viewport, so
    // the tree between them should claim most of it. `height: 0px` fails this by a mile; a merely-short
    // `<main>` would fail it too, which a bare `> 0` could never catch.
    expect(height).toBeGreaterThan(window.innerHeight * 0.5)
  })
})
