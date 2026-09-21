import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

let view: EditorView

const idle = () =>
  document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
  (document.querySelector('#results')?.textContent ?? '') !== ''

const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''

/** The word the caret is sitting on, which is what a jump is asserted against. */
const selected = () => {
  const s = view.state.selection.main
  return view.state.doc.sliceString(s.from, s.to)
}

const caretLine = () => view.state.doc.lineAt(view.state.selection.main.head).number

function press(key: string, shift = false): void {
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: shift, cancelable: true, bubbles: true }))
}

/** `fact` is declared on line 1, called recursively on line 1, and called again on line 2. */
const PROGRAM = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(3)\n'

describe('navigation', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: PROGRAM } })
    await until(idle, 'the app to settle')
  })

  it('jumps from a call to its definition with F12', async () => {
    // Line 2, on `fact(3)`'s name.
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 1 } })
    press('F12')

    await until(() => caretLine() === 1, 'the caret to reach the declaration')
    expect(selected()).toBe('fact')
  })

  /**
   * **`null` IS THE ORDINARY ANSWER FOR MOST OF ANY DOCUMENT** — a caret on a keyword, a bracket or
   * whitespace. It must do nothing visible and say nothing, or the notice line fires constantly and
   * the reader learns to ignore it.
   */
  it('does nothing and says nothing on a keyword', async () => {
    view.dispatch({ selection: { anchor: 0 } }) // on `fn`
    const before = view.state.selection.main.head
    press('F12')

    await new Promise((r) => setTimeout(r, 60))
    expect(view.state.selection.main.head).toBe(before)
    expect(noticeText()).not.toContain('definition')
  })

  /**
   * **THE CARET HAS TO BE ON A NAME**, because the question is "references to what". Starting at
   * offset 0 — on `fn` — this does nothing, which is how this test first failed: the server
   * correctly answered no references for a keyword, and the test blamed the keybinding.
   */
  it('does nothing when the caret is not on a name', async () => {
    view.dispatch({ selection: { anchor: 0 } })
    press('F12', true)
    await new Promise((r) => setTimeout(r, 60))
    expect(noticeText()).not.toContain('reference')
  })

  it('walks the references with Shift-F12 and says which of how many', async () => {
    // On `fact` in the declaration — reference 1 of 3, so the next press goes to 2.
    view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 3 } })

    press('F12', true)
    await until(() => noticeText() === 'reference 2 of 3', 'the recursive call')
    expect(selected()).toBe('fact')
    expect(caretLine()).toBe(1)

    press('F12', true)
    await until(() => noticeText() === 'reference 3 of 3', 'the call on line 2')
    expect(selected()).toBe('fact')
    expect(caretLine()).toBe(2)
  })

  /**
   * Wrapping is what makes repeated presses a cycle rather than a dead end, and the last reference
   * is exactly where a reader walking the list arrives.
   */
  it('wraps from the last reference back to the first', async () => {
    // On the LAST occurrence — `fact` in `fact(3)` on line 2, which is where a reader walking the
    // list arrives. There is nothing after it, so the next press must come back to the top.
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 1 } })
    press('F12', true)
    await until(() => noticeText() === 'reference 1 of 3', 'the cycle to wrap')
    expect(caretLine()).toBe(1)
    expect(selected()).toBe('fact')
  })
})
