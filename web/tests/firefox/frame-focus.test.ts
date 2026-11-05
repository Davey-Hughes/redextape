import { afterEach, expect, it } from 'vitest'

/**
 * `firefox-input.ts`'s focus: the frame's at the file's start, and its frame-focus step. A `focus()` on an element of
 * the top document runs the top realm's `focus`, which the step does not wrap, and leaves this frame without the
 * focus, as the focus leaving it mid-file does.
 */

const top = window.top as Window
const made: Element[] = []

function button(name: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.id = name
  b.textContent = name
  document.body.append(b)
  made.push(b)
  return b
}

function focusTopDocument(): void {
  const away = top.document.createElement('button')
  top.document.body.append(away)
  made.push(away)
  away.focus()
  expect(document.hasFocus(), 'precondition: the frame lacks the focus once the top document holds it').toBe(false)
}

// THE TOP DOCUMENT OUTLIVES THIS FILE, and the tab's later files share it: what a case made goes with the case.
afterEach(() => {
  for (const el of made.splice(0)) el.remove()
})

// FIRST, BEFORE A CASE MOVES THE FOCUS: the two below hand it to the top document, and nothing this file runs before
// this case calls `focus()`, so the frame holds the focus here only if the setup file's `window.focus()` gave it.
it('starts with the frame holding the focus, which the setup file gives it', () => {
  expect(document.hasFocus(), 'the frame has the focus at the file’s start').toBe(true)
})

it('gives the frame the focus before a focus() the frame would ignore', () => {
  focusTopDocument()
  const b = button('first')
  b.focus()
  expect(document.activeElement, 'the button took the focus').toBe(b)
  expect(document.hasFocus(), 'the frame has the focus').toBe(true)
})

it('does so for a later focus() in a case, not only its first', () => {
  window.focus()
  button('first').focus()
  focusTopDocument()
  const b = button('second')
  b.focus()
  expect(document.activeElement, 'the later button took the focus').toBe(b)
  expect(document.hasFocus(), 'the frame has the focus').toBe(true)
})
