import { afterEach, describe, expect, it } from 'vitest'
import type { Leg } from '../../src/protocol'
import type { Binding, PaneOption } from '../../src/sessions'
import { bindingKey, pairLabel, sourceViewHeader, viewHeader } from '../../src/view-header'

const PROGRAM_λ: PaneOption = { leg: 'lambda', id: 'source', label: 'program' }
const PROGRAM_RXM: PaneOption = { leg: 'rxm', id: 'source', label: 'program' }
const PROGRAM_TM: PaneOption = { leg: 'tm', id: 'source', label: 'program' }

afterEach(() => {
  document.body.replaceChildren()
})

const mount = (onPick: (b: Binding<Leg>) => void = () => undefined) => {
  const h = viewHeader(onPick)
  document.body.append(h.el)
  return h
}

describe('the title-selector', () => {
  it('reads the pair in force, in the header heading, and is a button while there is a choice', () => {
    const h = mount()
    h.setBindings([PROGRAM_λ, PROGRAM_TM], { leg: 'lambda', session: 'source' })
    const title = h.el.querySelector<HTMLButtonElement>('h2 > button.view-title')
    expect(title?.textContent).toBe('λ · program')
    expect(title?.dataset.binding).toBe(bindingKey('lambda', 'source'))
    expect(title?.getAttribute('aria-haspopup')).toBe('menu')
    expect(title?.getAttribute('aria-expanded')).toBe('false')
  })

  it('is plain text, never removed, when there is one pair', () => {
    const h = mount()
    h.setBindings([PROGRAM_λ], { leg: 'lambda', session: 'source' })
    expect(h.el.querySelector('button.view-title')).toBeNull()
    expect(h.el.querySelector('span.view-title')?.textContent).toBe('λ · program')
  })

  it('opens a menu of every pair, the one in force marked, and reports a pick', () => {
    const picks: Binding<Leg>[] = []
    const h = mount((b) => picks.push(b))
    // In `pairs()` order, which groups by leg (`SessionRegistry.pairs`), as the app always passes it.
    h.setBindings([PROGRAM_λ, PROGRAM_RXM, PROGRAM_TM], { leg: 'lambda', session: 'source' })
    h.el.querySelector<HTMLButtonElement>('button.view-title')?.click()
    const items = [...document.querySelectorAll<HTMLButtonElement>('.view-title-menu button')]
    expect(items.map((b) => b.textContent)).toEqual(['λ · program', 'rxm · program', 'TM · program'])
    expect(items.map((b) => b.dataset.binding)).toEqual([
      bindingKey('lambda', 'source'),
      bindingKey('rxm', 'source'),
      bindingKey('tm', 'source'),
    ])
    expect(items[0]?.getAttribute('aria-current')).toBe('true')
    expect(document.activeElement).toBe(items[0])
    items[2]?.click()
    expect(picks).toEqual([{ leg: 'tm', session: 'source' }])
  })

  it('does not rebuild on a repeat update, so an open menu survives a frame', () => {
    const h = mount()
    h.setBindings([PROGRAM_λ, PROGRAM_TM], { leg: 'lambda', session: 'source' })
    const before = h.el.querySelector('button.view-title')
    // OPEN, BECAUSE THE BUTTON'S IDENTITY ALONE CANNOT FAIL: `paint` keeps the same element. What a
    // rebuild would cost is the menu: a popover taken out of the DOM is closed.
    before?.dispatchEvent(new MouseEvent('click'))
    const menu = document.querySelector('.view-title-menu')
    expect(menu?.matches(':popover-open')).toBe(true)
    h.setBindings([PROGRAM_λ, PROGRAM_TM], { leg: 'lambda', session: 'source' })
    expect(h.el.querySelector('button.view-title')).toBe(before)
    expect(menu?.matches(':popover-open')).toBe(true)
  })
})

describe('the source view header', () => {
  it('is titled "source", as plain text', () => {
    const s = sourceViewHeader()
    expect(s.el.querySelector('h2 span.view-title')?.textContent).toBe('source')
    expect(s.el.querySelector('button.view-title')).toBeNull()
  })
})

describe('pairLabel', () => {
  it('spells the leg the way the menus do', () => {
    expect(pairLabel(PROGRAM_TM)).toBe('TM · program')
    expect(pairLabel(PROGRAM_RXM)).toBe('rxm · program')
  })
})
