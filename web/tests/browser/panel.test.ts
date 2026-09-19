import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { icon } from '../../src/icons'
import { createPanel } from '../../src/panel'

function body(): HTMLElement {
  const el = document.createElement('div')
  el.textContent = 'contents'
  return el
}

describe('icon', () => {
  it('is decorative, sized to the text, and drawn in the text colour', () => {
    const svg = icon('disclose')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
    expect(svg.classList.contains('icon')).toBe(true)
    expect(svg.querySelector('path')?.getAttribute('stroke')).toBe('currentColor')
  })

  it('draws a different shape for each meaning', () => {
    const d = (n: 'disclose' | 'move-editor-here') => icon(n).querySelector('path')?.getAttribute('d')
    expect(d('disclose')).not.toBe(d('move-editor-here'))
  })
})

describe('createPanel', () => {
  it('names itself, wraps the body, and starts open', () => {
    const b = body()
    const p = createPanel({ name: 'rules', label: 'rules', body: b })
    expect(p.el.dataset.panel).toBe('rules')
    expect(p.el.contains(b)).toBe(true)
    expect(p.toggle.textContent).toBe('rules')
    expect(p.toggle.getAttribute('aria-expanded')).toBe('true')
    expect(b.hidden).toBe(false)
    expect(p.isOpen()).toBe(true)
  })

  it('points its button at its body, and names the body by its button', () => {
    const b = body()
    const p = createPanel({ name: 'rules', label: 'rules', body: b })
    expect(b.id).not.toBe('')
    expect(p.toggle.getAttribute('aria-controls')).toBe(b.id)
    expect(b.getAttribute('role')).toBe('region')
    expect(b.getAttribute('aria-labelledby')).toBe(p.toggle.id)
  })

  it('gives two panels different ids', () => {
    const a = createPanel({ name: 'a', label: 'a', body: body() })
    const b = createPanel({ name: 'b', label: 'b', body: body() })
    expect(a.body.id).not.toBe(b.body.id)
    expect(a.toggle.id).not.toBe(b.toggle.id)
  })

  it('keeps an id the body already has', () => {
    const b = body()
    b.id = 'mine'
    createPanel({ name: 'x', label: 'x', body: b })
    expect(b.id).toBe('mine')
  })

  it('can start closed', () => {
    const b = body()
    const p = createPanel({ name: 'x', label: 'x', body: b, open: false })
    expect(b.hidden).toBe(true)
    expect(p.toggle.getAttribute('aria-expanded')).toBe('false')
    expect(p.el.dataset.open).toBe('false')
  })

  it('toggles on a click and reports the state it toggled to', () => {
    const b = body()
    const onToggle = vi.fn()
    const p = createPanel({ name: 'x', label: 'x', body: b, onToggle })
    p.toggle.click()
    expect(onToggle).toHaveBeenLastCalledWith(false)
    expect(b.hidden).toBe(true)
    expect(p.toggle.getAttribute('aria-expanded')).toBe('false')
    p.toggle.click()
    expect(onToggle).toHaveBeenLastCalledWith(true)
    expect(b.hidden).toBe(false)
  })

  // `setOpen` is how a view restores or resets a panel; a view must not hear its own write back as a
  // gesture, or a restore would be recorded as a user's choice.
  it('does not report a programmatic change', () => {
    const onToggle = vi.fn()
    const p = createPanel({ name: 'x', label: 'x', body: body(), onToggle })
    p.setOpen(false)
    p.setOpen(true)
    expect(onToggle).not.toHaveBeenCalled()
    expect(p.isOpen()).toBe(true)
  })

  // A REAL KEYBOARD, through Playwright — a synthetic `KeyboardEvent` never activates a button, so it
  // could not show this.
  it('is reached with Tab and toggled with Enter and Space', async () => {
    const before = document.createElement('input')
    const b = body()
    const p = createPanel({ name: 'x', label: 'x', body: b })
    document.body.append(before, p.el)
    before.focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(p.toggle)
    await userEvent.keyboard('{Enter}')
    expect(b.hidden).toBe(true)
    await userEvent.keyboard(' ')
    expect(b.hidden).toBe(false)
    before.remove()
    p.el.remove()
  })

  it('puts header actions after the toggle in the header, and closing the panel does not hide them', () => {
    const b = body()
    const p = createPanel({ name: 'x', label: 'x', body: b })
    const header = p.el.querySelector('.panel-header')
    expect(header?.contains(p.actions)).toBe(true)
    expect(p.actions.previousElementSibling).toBe(p.toggle)
    expect(p.body.contains(p.actions)).toBe(false)
    const actionButton = document.createElement('button')
    actionButton.textContent = 'action'
    p.actions.append(actionButton)
    p.setOpen(false)
    expect(actionButton.hidden).toBe(false)
    expect(p.body.hidden).toBe(true)
  })

  it('setOpen with the current state does not change aria-expanded, body.hidden, or isOpen', () => {
    const b = body()
    const p = createPanel({ name: 'x', label: 'x', body: b })
    const initialExpanded = p.toggle.getAttribute('aria-expanded')
    const initialHidden = p.body.hidden
    const initialOpen = p.isOpen()
    p.setOpen(true)
    expect(p.toggle.getAttribute('aria-expanded')).toBe(initialExpanded)
    expect(p.body.hidden).toBe(initialHidden)
    expect(p.isOpen()).toBe(initialOpen)
    p.toggle.click()
    expect(p.isOpen()).toBe(false)
    p.setOpen(false)
    expect(p.isOpen()).toBe(false)
    p.toggle.click()
    expect(p.isOpen()).toBe(true)
  })
})
