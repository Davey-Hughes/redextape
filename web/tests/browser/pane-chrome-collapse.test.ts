import { describe, expect, it, vi } from 'vitest'
import { collapseButton } from '../../src/pane-chrome'

describe('collapseButton', () => {
  it('is added and removed, never disabled', () => {
    const host = document.createElement('div')
    const c = collapseButton(host, () => {})
    expect(host.querySelector('button')).toBeNull()
    c.update(true)
    expect(host.querySelector('button')).not.toBeNull()
    c.update(false)
    expect(host.querySelector('button')).toBeNull()
  })

  it('reports the state it is toggling TO, and relabels itself', () => {
    const host = document.createElement('div')
    const onToggle = vi.fn()
    const c = collapseButton(host, onToggle)
    c.update(true)
    const button = host.querySelector('button')
    if (button === null) throw new Error('the control was not added')
    const first = button.getAttribute('aria-label')
    button.click()
    expect(onToggle).toHaveBeenCalledWith(true)
    expect(button.getAttribute('aria-label')).not.toBe(first)
    button.click()
    expect(onToggle).toHaveBeenLastCalledWith(false)
  })
})
