import { describe, expect, it, vi } from 'vitest'
import { textPanel } from '../../src/pane-chrome'

function toggleOf(el: HTMLElement): HTMLButtonElement {
  const t = el.querySelector<HTMLButtonElement>('.panel-toggle')
  if (t === null) throw new Error('the text panel has no disclosure button')
  return t
}

describe('textPanel', () => {
  it('is named "text" whichever view builds it', () => {
    const t = textPanel(document.createElement('div'), () => {})
    expect(t.el.dataset.panel).toBe('text')
    expect(toggleOf(t.el).textContent).toBe('text')
  })

  it('is shown only while an editor is available', () => {
    const t = textPanel(document.createElement('div'), () => {})
    expect(t.el.hidden).toBe(true)
    t.update(true)
    expect(t.el.hidden).toBe(false)
    t.update(false)
    expect(t.el.hidden).toBe(true)
  })

  it('reports the collapse it toggles to, and carries the state in aria-expanded', () => {
    const body = document.createElement('div')
    const onToggle = vi.fn()
    const t = textPanel(body, onToggle)
    t.update(true)
    const toggle = toggleOf(t.el)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    toggle.click()
    expect(onToggle).toHaveBeenLastCalledWith(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(body.hidden).toBe(true)
    toggle.click()
    expect(onToggle).toHaveBeenLastCalledWith(false)
    expect(body.hidden).toBe(false)
  })

  // The buffer's own record decides where a mount starts, and an unmount must not leave
  // that state behind for the next buffer to inherit — the defect `collapseButton` was once fixed for.
  it('starts where the buffer record says, and resets on unmount', () => {
    const body = document.createElement('div')
    const t = textPanel(body, () => {})
    t.update(true, true)
    expect(body.hidden).toBe(true)
    expect(toggleOf(t.el).getAttribute('aria-expanded')).toBe('false')
    t.update(false)
    // THE RESET ITSELF, BEFORE ANY REMOUNT. Asserting only after the remount below would pass even with
    // no reset at all: `update(true)`'s own `panel.setOpen(!initial)` would overwrite whatever `update(false)`
    // left behind regardless. This is what actually pins the reset `textPanel`'s own doc promises.
    expect(body.hidden).toBe(false)
    expect(toggleOf(t.el).getAttribute('aria-expanded')).toBe('true')
    t.update(true)
    expect(body.hidden).toBe(false)
    expect(toggleOf(t.el).getAttribute('aria-expanded')).toBe('true')
  })

  it('ignores a repeated update', () => {
    const body = document.createElement('div')
    const t = textPanel(body, () => {})
    t.update(true, true)
    t.update(true, false)
    expect(body.hidden).toBe(true)
  })

  // `onToggle` "FIRES FOR A GESTURE ONLY" (`panel.ts`'s `PanelOptions` doc, verbatim) —
  // `update` is the app SEEDING or resetting the control from a mount/unmount, never a user's click, so it
  // must never be mistaken for one.
  it('never calls onToggle from update, only from a click on the toggle', () => {
    const body = document.createElement('div')
    const onToggle = vi.fn()
    const t = textPanel(body, onToggle)
    t.update(true, true)
    t.update(false)
    t.update(true)
    expect(onToggle).not.toHaveBeenCalled()
  })
})
