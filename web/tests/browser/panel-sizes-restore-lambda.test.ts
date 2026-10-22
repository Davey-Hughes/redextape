import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defaultArrangement, LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { frames, heightOf, host, lambdaHost, SHELL, stateIdle, until } from './harness'

/**
 * **A λ VIEW IS BUILT WITH THE SHARES ITS LEAF HOLDS** — the view layouts spec §11.4, `pane-host.ts`'s λ arm.
 * `panel-sizes-restore.test.ts` has the TM view and the source view; a λ view takes its shares through its options
 * and not as an argument of its own. Seeded before `main.ts` is imported: the source beside a λ view, its map open,
 * and the map given a share even with the term's where it is built 120 px tall.
 *
 * **THE VIEW'S OWN HEIGHT SETTLES AS THE PAGE'S FONTS ARRIVE**, the term and the map's panel moving together at
 * each change. The map is drawn again at each change, by a resize observer, which the browser delivers at its next
 * frame, so a reading taken between a change and that frame can find the canvas at one height holding a drawing of
 * another. So the case waits two frames before it reads the two.
 */

beforeAll(async () => {
  await page.viewport(1280, 896)
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({
      ...defaultWorkspace('wide'),
      tree: defaultArrangement(['source', 'lambda'], 'wide'),
      focused: 'lambda-0',
      panels: { 'lambda-0': { map: true } },
      panelSizes: { 'lambda-0': { term: 1, map: 1 } },
    }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
  await until(() => host('lambda-0')?.querySelector('.term-rows > *') != null, 'the λ view to draw')
})

describe('a workspace stored with a λ view’s shares', () => {
  it('opens the view with its map as tall as its term, as stored, and the map drawn at that height', async () => {
    await document.fonts.ready
    await frames()
    const term = lambdaHost().querySelector('[data-region="term"]') as HTMLElement
    const map = lambdaHost().querySelector('[data-region="map"]') as HTMLElement
    const canvas = lambdaHost().querySelector('.term-map') as HTMLCanvasElement
    expect(map.dataset.sized, 'the map has its own height, as one nobody dragged').toBe('true')
    expect(heightOf(map)).toBeCloseTo(heightOf(term), 0)
    expect(
      canvas.clientHeight,
      'precondition: an even share is far more than the 120 px a map is built at',
    ).toBeGreaterThan(250)
    expect(canvas.height, 'the map was not drawn at the height it has').toBe(
      Math.round(canvas.clientHeight * devicePixelRatio),
    )
  })

  it('keeps them through the writes the load itself makes', () => {
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null').panelSizes).toEqual({
      'lambda-0': { term: 1, map: 1 },
    })
  })
})
