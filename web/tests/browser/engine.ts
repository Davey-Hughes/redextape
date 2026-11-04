import type { TestContext } from 'vitest'
import { server, userEvent } from 'vitest/browser'
import { until } from './until'

/**
 * What a browser test knows of the engine it runs in. It imports nothing of `src`, because `collect.ts`, which must
 * compile no module of `src` before it has collected, imports it.
 */

declare module 'vitest/browser' {
  interface BrowserCommands {
    /** Playwright's `page.requestGC()`, a full collection, registered by the Firefox project alone. */
    requestGC: () => Promise<void>
  }
}

/** Whether this page runs in Chromium, the one engine with CDP, `gc` and `performance.memory`. */
export const CHROMIUM = server.browser === 'chromium'

/**
 * The first statement of a test that needs what only Chromium has. In Chromium it returns and the test runs; in any
 * other engine it skips the test, and the verbose reporter prints `reason` beside it. A skipped test's `beforeEach`
 * and `afterEach` still run, so a hook such a test relies on must work in every engine.
 */
export function chromiumOnly(ctx: TestContext, reason: string): void {
  ctx.skip(!CHROMIUM, reason)
}

let reported: Promise<number> | undefined

/**
 * The `pointerId` a real pointer move on this page carried, for a test's own synthetic pointer events. No fixed id
 * works in every engine: Chromium's `setPointerCapture` takes 1 on a page with no input, and Firefox's takes no
 * synthetic id until real mouse input has reached the tab, and then takes 0. Once a page, the first call hovers a
 * temporary element at two points, so that the second hover is a move wherever the mouse began.
 */
export function mousePointerId(): Promise<number> {
  reported ??= hoverForId()
  return reported
}

async function hoverForId(): Promise<number> {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;left:0;top:0;width:40px;height:40px;z-index:2147483647'
  document.body.append(el)
  const ids: number[] = []
  el.addEventListener('pointermove', (e) => {
    ids.push(e.pointerId)
  })
  try {
    // A FRESH `position` EACH TIME: `userEvent.hover` scales the one it is given in place.
    await userEvent.hover(el, { position: { x: 10, y: 10 } })
    await userEvent.hover(el, { position: { x: 30, y: 30 } })
    await until(() => ids.length > 0, `a pointer move on the page after two hovers, in ${server.browser}`)
    return ids.at(-1) as number
  } finally {
    el.remove()
  }
}
