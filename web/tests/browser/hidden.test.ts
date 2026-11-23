import type { EditorView } from '@codemirror/view'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { boundary, clickWorkspaceItem, frame, frames, lambdaHost, SHELL, stateIdle, until } from './harness'

/**
 * **`hidden` HIDES.** The browser's own `[hidden] { display: none }` loses to any author rule that sets `display`,
 * so an element a view hides can stay on screen with nothing but a probe to notice: an outline's list would, since
 * `.outline` is a flex column. So this looks for the whole class, not an instance: every `[hidden]` element on the
 * page, across every panel opened and closed and every view forked to a copy.
 */

const shownWhileHidden = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[hidden]')]
    .filter((e) => getComputedStyle(e).display !== 'none')
    .map((e) => `${e.tagName.toLowerCase()}.${e.className}`)

const toggles = () => [...document.querySelectorAll<HTMLButtonElement>('.panel-toggle')]

/** Each panel opened and closed and put back, adding to `seen` every `[hidden]` element shown on the way. */
const walk = (seen: Set<string>, round: string): void => {
  for (const toggle of toggles()) {
    toggle.click()
    for (const e of shownWhileHidden()) seen.add(`${e}, ${round}, one toggle on`)
    toggle.click()
    for (const e of shownWhileHidden()) seen.add(`${e}, ${round}, toggled back`)
  }
}

it('leaves nothing on screen that is hidden, through every panel and a copy of each view', async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'fn f(x) { x + 1 }\nf(2)\n' } })
  await until(stateIdle, 'the app to settle')
  const seen = new Set(shownWhileHidden())
  // Each panel opened and closed, before and after both views fork a copy — a copy is what shows a TM view's
  // outline, and what gives the λ view an editor.
  walk(seen, 'as compiled')
  for (const fork of document.querySelectorAll<HTMLButtonElement>('button.detach')) fork.click()
  await until(() => document.querySelectorAll('.term-editor').length >= 2, 'both copies to mount an editor')
  walk(seen, 'with copies')
  expect([...seen]).toEqual([])
})

/**
 * A REGION WITH A SHARE DRAWS ITS BODY BY RULES OF ITS OWN, which the walk above never reaches: nothing there drags a
 * boundary. So the λ view's map is given a share by a key on its boundary, which takes no pointer capture as a drag
 * would, and every panel is walked again.
 */
it('leaves nothing on screen that is hidden once the λ view’s map has a share, through every panel', async () => {
  await page.viewport(1280, 1000)
  await frames()
  const map = lambdaHost().querySelector('[data-region="map"]') as HTMLElement
  const t = map.querySelector('.panel-toggle') as HTMLElement
  expect(t.getAttribute('aria-expanded'), 'precondition: the map starts closed').toBe('false')
  await userEvent.click(t)
  await frame()
  expect(
    (map.querySelector('.panel-header') as HTMLElement).dataset.resizes,
    'precondition: the map’s header is a handle',
  ).toBe('true')
  const b = boundary(lambdaHost(), 'term', 'map')
  expect(b, 'precondition: a boundary lies above the map').not.toBeNull()
  b.focus()
  await userEvent.keyboard('{ArrowUp}')
  await frame()
  expect(map.dataset.sized, 'precondition: the key gave the map a share').toBe('true')
  const seen = new Set(shownWhileHidden())
  walk(seen, 'the map with a share')
  expect([...seen]).toEqual([])
})

/**
 * THE READOUT'S TWO HOSTS HIDE BY TURNS, and the walks above see it only in the strip. So the readout is moved to the
 * inspector, and every panel is walked again.
 */
it('leaves nothing on screen that is hidden with the readout in the inspector, through every panel', async () => {
  clickWorkspaceItem('[data-switch="readout"][data-value="inspector"]')
  await frame()
  expect(document.querySelector<HTMLElement>('footer.strip')?.hidden, 'precondition: the strip is hidden').toBe(true)
  const seen = new Set(shownWhileHidden())
  walk(seen, 'the readout in the inspector')
  expect([...seen]).toEqual([])
})
