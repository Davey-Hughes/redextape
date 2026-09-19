import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createPanel } from '../../src/panel'
import { until } from './harness'

/** `--focus-ring` resolved to a colour, the way the browser resolves it for an outline. */
function focusRingColour(): string {
  const probe = document.createElement('span')
  probe.style.color = 'var(--focus-ring)'
  document.body.append(probe)
  const c = getComputedStyle(probe).color
  probe.remove()
  return c
}

describe('the focus ring', () => {
  it("is drawn on a control reached by keyboard, in the palette's focus colour", async () => {
    const before = document.createElement('input')
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'x'
    document.body.append(before, button)
    before.focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(button)
    const s = getComputedStyle(button)
    expect(s.outlineStyle).toBe('solid')
    expect(s.outlineWidth).toBe('2px')
    expect(s.outlineColor).toBe(focusRingColour())
    before.remove()
    button.remove()
  })

  // A borderless control is the case a missing ring hides completely.
  it("is drawn on a panel's borderless disclosure button", async () => {
    const before = document.createElement('input')
    const p = createPanel({ name: 'x', label: 'x', body: document.createElement('div') })
    document.body.append(before, p.el)
    before.focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(p.toggle)
    expect(getComputedStyle(p.toggle).outlineStyle).toBe('solid')
    before.remove()
    p.el.remove()
  })

  // CodeMirror draws its own 1px dotted near-black outline on a focused editor's frame — invisible on a
  // dark palette. That one goes; the app's ring stays on the editable content, drawn inset so the
  // scroller around it cannot clip it. CodeMirror adds `cm-focused` from its own focus handling, so the
  // test waits for the class rather than assuming it is synchronous.
  it("rings a focused editor's content in the palette's focus colour, and drops CodeMirror's own outline", async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({ parent: host, doc: 'let x = 1' })
    view.focus()
    await until(() => view.dom.classList.contains('cm-focused'), 'the editor to report focus')
    const content = getComputedStyle(view.contentDOM)
    expect(content.outlineStyle).toBe('solid')
    expect(content.outlineColor).toBe(focusRingColour())
    expect(content.outlineOffset).toBe('-2px')
    expect(getComputedStyle(view.dom).outlineStyle).toBe('none')
    view.destroy()
    host.remove()
  })
})
