import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

const pick = (sel: string): void => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
  const m = document.querySelector<HTMLElement>('#workspace-menu')
  if (m?.matches(':popover-open')) m.hidePopover()
}
const results = (): HTMLElement => document.querySelector<HTMLElement>('#results') as HTMLElement
const inspector = (): HTMLElement => document.querySelector<HTMLElement>('#inspector') as HTMLElement
const strip = (): HTMLElement => document.querySelector<HTMLElement>('footer.strip') as HTMLElement
const stored = (): { inspector?: unknown } => JSON.parse(localStorage.getItem('redextape.layout') ?? '{}')

describe('the inspector', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    const view: EditorView = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(() => results().dataset.state === 'idle', 'the first compile')
  })

  it('is not on the page while the readout is the strip', () => {
    expect(inspector().hidden).toBe(true)
    expect(strip().contains(results())).toBe(true)
    expect(results().querySelectorAll('.segment').length).toBeGreaterThan(0)
  })

  // §9, and the constraint behind it: 24 browser test files wait on `#results[data-state]`, so the
  // readout's hosts MOVE rather than being duplicated — one element writes that attribute, in both modes.
  it('takes #results and #link-status with it, ids and compile state intact', () => {
    pick('[data-switch="readout"][data-value="inspector"]')
    expect(inspector().hidden).toBe(false)
    expect(inspector().contains(results())).toBe(true)
    expect(inspector().contains(document.querySelector('#link-status'))).toBe(true)
    expect(results().dataset.state).toBe('idle')
    expect(results().dataset.describes).toBe('program')
    expect(strip().hidden).toBe(true)
  })

  /**
   * **GEOMETRY, NOT A COUNT.** `#results` carries `class="results"` wherever the switch moves it, and
   * `.results` is a wrapping flex row — so the inspector's rows packed side by side while a count of
   * `.row` elements stayed happily above one. Spec §9 is "Every row on its own line", which is a claim
   * about where they are.
   */
  it('puts every row on its own line', () => {
    const rows = [...results().querySelectorAll<HTMLElement>('.row')]
    expect(rows.length, 'fewer than two rows, so stacking proves nothing').toBeGreaterThan(1)
    const tops = rows.map((r) => Math.round(r.getBoundingClientRect().top))
    expect(new Set(tops).size, `rows share a line: ${tops.join(',')}`).toBe(rows.length)
  })

  /**
   * **`Λ` IS NOT `λ`.** `--label-transform` is `uppercase` in the Instrument style, and these labels carry
   * the leg glyph — so the DOM read `λ normal form` while the screen read `Λ NORMAL FORM`, in the one
   * vocabulary the umbrella's §4 table fixes. Every test reads `textContent`, which was correct
   * throughout; only a screenshot showed it. `.view-title` sets `text-transform: none` for this reason.
   */
  it('does not uppercase a label that carries λ', () => {
    const label = results().querySelector<HTMLElement>('.row-label')
    expect(label, 'no label to check').not.toBeNull()
    expect(label?.textContent).toContain('λ')
    expect(getComputedStyle(label as HTMLElement).textTransform).not.toBe('uppercase')
  })

  it('shows the normal form the strip leaves out, one fact per line', () => {
    const rows = [...results().querySelectorAll('.row')]
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.map((r) => r.querySelector('.row-label')?.textContent).join(' ')).toContain('normal form')
    // THE CONTRAST, ASSERTED: the strip's own rendering is segments, and it has no normal form in it.
    expect(results().querySelectorAll('.segment').length).toBe(0)
  })

  it('collapses to its header, and the state survives into storage', () => {
    const toggle = document.querySelector<HTMLButtonElement>('#inspector .panel-toggle') as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    toggle.click()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(stored().inspector).toBe(false)
    toggle.click()
    expect(stored().inspector).toBe(true)
  })

  it('gives #results back to the strip when the switch goes back', () => {
    pick('[data-preset="explorer"]')
    expect(strip().contains(results())).toBe(true)
    expect(inspector().hidden).toBe(true)
    expect(strip().hidden).toBe(false)
    expect(results().dataset.state).toBe('idle')
    expect(results().querySelectorAll('.segment').length).toBeGreaterThan(0)
  })
})
