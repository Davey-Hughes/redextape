import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LambdaEditor } from '../../src/lambda-editor'

/**
 * **A MISMATCH FOUND AGAINST THE BRIEF, AND HOW THIS FILE RESOLVES IT.**
 *
 * The brief's Step 1 sketch simulated "a burst of keystrokes" by calling `LambdaEditor#setText`
 * three times. Run as written, that test fails: `setText` sets `#seeding` for the duration of its
 * dispatch (see `lambda-editor.ts`'s own doc on that field — "the fork's seed, and nothing else"),
 * so the update listener never schedules a recompile and `onEdit` is called zero times, not one.
 * Step 5's own prediction agrees with this reading — "coalesces a burst... expects one fire, which
 * THE MUTATION still satisfies" only makes sense if the guard-removed mutant is what makes that test
 * pass, meaning the guard-intact reference implementation does not. Confirmed empirically: run
 * verbatim against the Step 3 implementation, `coalesces a burst of keystrokes` fails 0-vs-1.
 *
 * `setText` cannot be the right way to simulate a keystroke — the whole point of `#seeding` is that
 * a seed and a keystroke must be told apart, and `setText` is named and documented as the seed side
 * of that split. This file simulates a real edit instead, via `EditorView.findFromDOM(host)` —
 * CodeMirror's own public API for recovering the view instance mounted under a DOM node — and
 * dispatches a change transaction directly to it, exactly as `tests/browser/app.test.ts`'s `retype`
 * treats a direct `view.dispatch` of a buffer replacement as standing in for a user retyping the
 * whole document. No private field of `LambdaEditor` is touched.
 */
describe('LambdaEditor', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  const make = (onEdit = vi.fn()) => {
    const host = document.createElement('div')
    document.body.append(host)
    return { host, onEdit, ed: new LambdaEditor({ host, initial: '\\x. x', debounceMs: 300, onEdit }) }
  }

  /** A real keystroke — as against `setText`'s seed, see the file doc above. */
  const retype = (host: HTMLElement, text: string): void => {
    const view = EditorView.findFromDOM(host)
    if (view === null) throw new Error('no CodeMirror view mounted under host')
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  }

  it('seeds the buffer with the term it was given', () => {
    const { host } = make()
    expect(host.textContent).toContain('\\x. x')
  })

  it('coalesces a burst of keystrokes into ONE recompile', () => {
    const { host, onEdit } = make()
    retype(host, '\\a. a')
    retype(host, '\\ab. ab')
    retype(host, '\\abc. abc')
    vi.advanceTimersByTime(300)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith('\\abc. abc')
  })

  it('does not fire before the debounce elapses', () => {
    const { host, onEdit } = make()
    retype(host, '\\a. a')
    vi.advanceTimersByTime(299)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('cancels a pending recompile on destroy, so a retired scratch gets no message', () => {
    const { host, onEdit, ed } = make()
    retype(host, '\\a. a')
    ed.destroy()
    vi.advanceTimersByTime(1000)
    expect(onEdit).not.toHaveBeenCalled()
    expect(host.childElementCount).toBe(0)
  })

  // Step 5's mutation (deleting the `#seeding` guard) predicted zero failures among the tests above,
  // on the grounds that none of them seeds a fresh editor and then checks for an absent recompile.
  // That prediction held here too, which per the brief's own instruction means the mutation exposed a
  // missing test rather than a harmless one. This is that test.
  it('does not treat a seed as an edit', () => {
    const { ed, onEdit } = make()
    ed.setText('\\y. y')
    vi.advanceTimersByTime(1000)
    expect(onEdit).not.toHaveBeenCalled()
  })
})
