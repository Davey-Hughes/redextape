import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const leafIds = () => [...document.querySelectorAll<HTMLElement>('main [data-leaf]')].map((el) => el.dataset.leaf ?? '')

/** `view-menu`'s `splitVia`, restated for the reason every browser file restates its helpers. */
function splitVia(leaf: string, dir: 'row' | 'column', pick: string): void {
  const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
  more?.click()
  const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
  menu?.querySelector<HTMLButtonElement>(`button.view-split[data-dir="${dir}"]`)?.click()
  const selector = pick === 'same' ? 'button[data-same]' : `button[data-binding="${pick}"]`
  menu?.querySelector<HTMLButtonElement>(`.view-menu-pairs ${selector}`)?.click()
}

beforeAll(async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('layout notices', () => {
  it('says a view was added', async () => {
    splitVia('lambda-0', 'row', bindingKey('tm', 'source'))
    await until(() => leafIds().length === 4, 'the split')
    expect(noticeText()).toBe('view added — TM · program')
  })

  it('says a view now shows something else', async () => {
    const title = document.querySelector<HTMLButtonElement>('[data-leaf="pane-1"] button.view-title')
    title?.click()
    document
      .querySelector<HTMLButtonElement>(
        `#${title?.getAttribute('aria-controls')} button[data-binding="${bindingKey('lambda', 'source')}"]`,
      )
      ?.click()
    await until(
      () => document.querySelector('[data-leaf="pane-1"]')?.getAttribute('data-kind') === 'lambda',
      'the switch',
    )
    expect(noticeText()).toBe('view now shows λ · program')
  })

  it('says a view closed, and puts focus on the title of the view that grew', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="pane-1"] button.view-close')?.click()
    await until(() => leafIds().length === 3, 'the close')
    expect(noticeText()).toBe('view closed — λ · program')
    expect(document.activeElement?.matches('[data-leaf="lambda-0"] .view-title')).toBe(true)
  })
})
