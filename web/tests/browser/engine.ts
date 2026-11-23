import type { TestContext } from 'vitest'
import { commands, server, userEvent } from 'vitest/browser'
import { until } from './until'

/**
 * What a browser test knows of the engine it runs in. It imports nothing of `src`, because `collect.ts`, which must
 * compile no module of `src` before it has collected, imports it.
 */

declare module 'vitest/browser' {
  interface BrowserCommands {
    /**
     * A real mouse move to a point of the page, with a press or a release of the left button there, of the system's
     * click count (1 by default): every project's.
     */
    mouse: (type: 'move' | 'down' | 'up', x: number, y: number, clickCount?: number) => Promise<void>
    /**
     * `'start'` logs, for this file, the URLs containing `match` of every request the page and its context report from
     * then on; `'read'` returns that log, `null` before a start: every project's.
     */
    watchRequests: (op: 'start' | 'read', match: string) => Promise<{ page: string[]; context: string[] } | null>
    /** Aborts the next `times` requests whose URL contains `match`, a worker's included: every project's. */
    failRequests: (match: string, times: number) => Promise<void>
    /**
     * Answers the next request whose URL contains `match` with `body`, as a script, or with `null` drops a stub no
     * request came for: every project's.
     */
    stubRequest: (match: string, body: string | null) => Promise<void>
    /** Holds the next request whose URL contains `match` until `releaseRequests`: every project's. */
    holdRequests: (match: string) => Promise<void>
    /** Lets this file's held request go, or stops waiting for one: every project's. */
    releaseRequests: () => Promise<void>
    /** Playwright's `page.requestGC()`, a full collection, registered by the Firefox projects alone. */
    requestGC: () => Promise<void>
    /** Registers this project's browser in the config's process; replies how many other projects have, and browsers. */
    registerBrowser: () => Promise<{ others: number; browsers: number }>
    /** A real press on `selector` with a decoy click during it in `browserOf`'s browser: `two-browsers.test.ts`. */
    decoyDuringCapture: (
      selector: string,
      browserOf: 'own' | 'rest',
    ) => Promise<{ decoyClicks: number; decoyAlone: number }>
    /** The capture project's span of a file, `'begin'` and `'end'`; replies with the files in flight. */
    captureFileSpan: (edge: 'begin' | 'end') => Promise<string[]>
  }
}

/** Whether this page runs in Chromium, the one engine with CDP, `gc` and `performance.memory`. */
export const CHROMIUM = server.browser === 'chromium'

/**
 * Collect garbage now: in Chromium `--js-flags=--expose-gc` in `vite.config.ts` puts `gc` on the global, and Firefox,
 * which has no such flag, takes Playwright's collection through the `requestGC` command its projects register.
 */
export async function collect(): Promise<void> {
  if (!CHROMIUM) {
    await commands.requestGC()
    return
  }
  const gc = (globalThis as { gc?: () => void }).gc
  if (typeof gc !== 'function') throw new Error('BLOCKED: globalThis.gc is unavailable')
  gc()
  gc()
}

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
