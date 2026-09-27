import type { EditorView } from '@codemirror/view'
import { expect, it } from 'vitest'
import { SHELL, until } from './harness'

/**
 * **`hidden` HIDES.** The browser's own `[hidden] { display: none }` loses to any author rule that sets `display`,
 * so an element a view hides can stay on screen with nothing but a probe to notice. One did: every outline's list,
 * since `.outline` is a flex column — the source view's from the first draw, before anyone opened it. A TM view's
 * outline panel, laid out as a flex column while hidden, was a second. So this looks for the whole class, not the
 * two instances: every `[hidden]` element on the page, across every panel opened and closed and every view forked
 * to a copy.
 */

const shownWhileHidden = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[hidden]')]
    .filter((e) => getComputedStyle(e).display !== 'none')
    .map((e) => `${e.tagName.toLowerCase()}.${e.className}`)

const toggles = () => [...document.querySelectorAll<HTMLButtonElement>('.panel-toggle')]

it('leaves nothing on screen that is hidden, through every panel and a copy of each view', async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'fn f(x) { x + 1 }\nf(2)\n' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the app to settle')
  const seen = new Set(shownWhileHidden())
  // Each panel opened and closed, before and after both views fork a copy — a copy is what shows a TM view's
  // outline, and what gives the λ view an editor.
  for (const round of ['as compiled', 'with copies']) {
    for (const toggle of toggles()) {
      toggle.click()
      for (const e of shownWhileHidden()) seen.add(`${e}, ${round}, one toggle on`)
      toggle.click()
      for (const e of shownWhileHidden()) seen.add(`${e}, ${round}, toggled back`)
    }
    if (round === 'as compiled') {
      for (const fork of document.querySelectorAll<HTMLButtonElement>('button.detach')) fork.click()
      await until(() => document.querySelectorAll('.term-editor').length >= 2, 'both copies to mount an editor')
    }
  }
  expect([...seen]).toEqual([])
})
