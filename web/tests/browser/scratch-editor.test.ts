import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScratchEditorConfig } from '../../src/scratch-editor'
import { ScratchEditor } from '../../src/scratch-editor'

/**
 * **A MISMATCH FOUND AGAINST `2026-08-11-plan5d-iii-editable-lambda.md`, AND HOW THIS FILE RESOLVES
 * IT.**
 *
 * That plan's Step 1 sketch simulated "a burst of keystrokes" by calling `ScratchEditor#setText`
 * three times. Run as written, that test fails: `setText` sets `#seeding` for the duration of its
 * dispatch (see `scratch-editor.ts`'s own doc on that field — "the fork's seed, and nothing else"),
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
 * whole document. No private field of `ScratchEditor` is touched.
 */
describe('ScratchEditor', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  const make = (onEdit = vi.fn()) => {
    const host = document.createElement('div')
    document.body.append(host)
    return { host, onEdit, ed: new ScratchEditor({ host, initial: '\\x. x', debounceMs: 300, onEdit }) }
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

  /**
   * **A DESTROY SENDS WHAT WAS TYPED, WHERE IT USED TO CANCEL IT** — `ScratchEditor.destroy`'s doc: a view that leaves
   * its copy destroys the editor, and the cancel dropped the last debounce's typing. Sent at the destroy and not
   * again when the timer would have fired, so a copy is not rebuilt twice for one edit.
   */
  it('sends a pending edit when it is destroyed, once, and nothing after', () => {
    const { host, onEdit, ed } = make()
    retype(host, '\\a. a')
    ed.destroy()
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith('\\a. a')
    vi.advanceTimersByTime(1000)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(host.childElementCount).toBe(0)
  })

  it('sends nothing when it is destroyed with no edit pending', () => {
    const { host, onEdit, ed } = make()
    retype(host, '\\a. a')
    vi.advanceTimersByTime(300)
    ed.destroy()
    vi.advanceTimersByTime(1000)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  /** `flush` — what `EditorCustody.flush` asks of an editor before a delete reads its copy's record. */
  it('flushes a pending edit at once, and then has nothing left for the timer', () => {
    const { host, onEdit, ed } = make()
    retype(host, '\\a. a')
    ed.flush()
    expect(onEdit).toHaveBeenCalledWith('\\a. a')
    ed.flush()
    vi.advanceTimersByTime(1000)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  /**
   * A `ScratchEditor` whose document's `format()` stays open until the returned `answer` is called — the race both
   * tests below need: a language server slower than the gesture that follows *format*.
   */
  const makeFormattable = (
    onEdit = vi.fn(),
  ): { host: HTMLElement; onEdit: ReturnType<typeof vi.fn>; ed: ScratchEditor; answer: (edits: []) => void } => {
    let resolve: (edits: []) => void = () => undefined
    const client = {
      openDocument: vi.fn(),
      changeDocument: vi.fn(),
      closeDocument: vi.fn(),
      format: () =>
        new Promise<[]>((r) => {
          resolve = r
        }),
      documentSymbols: vi.fn(),
      definition: vi.fn(),
      references: vi.fn(),
      hover: vi.fn(),
    } as unknown as NonNullable<ScratchEditorConfig['document']>['client']
    const host = document.createElement('div')
    document.body.append(host)
    const ed = new ScratchEditor({
      host,
      initial: '\\x. x',
      debounceMs: 300,
      onEdit,
      document: {
        uri: 'redextape://copy/test',
        languageId: 'redextape_lambda',
        client,
        formatOnBlur: () => false,
        notify: vi.fn(),
        label: 'λ · copy 1',
      },
    })
    return { host, onEdit, ed, answer: (edits: []) => resolve(edits) }
  }

  /**
   * **A FORMAT TAKES THE PENDING EDIT OFF THE TIMER, AND `flush()` IS WHAT REACHES IT WHILE THE FORMAT WAITS** — and
   * *format on blur* starts one on the very click that leaves the copy, a click on the view's title, whose pick
   * destroys a TM or asm view's editor. `destroy()` calls `flush()` first (its own doc), and `flush()` now sends a
   * format's own pending text the moment it is asked (F1's fix) rather than waiting on the server — so the edit
   * format owed is sent AT ONCE, not deferred. The server's answer is held back here until after the destroy, which
   * is the order the race takes when the server is slower than the pick; format's own continuation, finding nothing
   * left in `#formatPending`, sends nothing a second time.
   */
  it('sends the edit a format owed at once when the editor comes down before the format is answered', async () => {
    const { host, onEdit, ed, answer } = makeFormattable()
    retype(host, '\\a. a')
    const formatting = ed.format()
    ed.destroy()
    expect(onEdit, 'destroy flushes, and flush now reaches a format’s own pending text').toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith('\\a. a')
    answer([])
    await formatting
    expect(onEdit, "format's own continuation must not send it a second time").toHaveBeenCalledTimes(1)
  })

  /**
   * **F1 — A DELETE (OR A PAUSE) RACING AN IN-FLIGHT FORMAT MUST NOT LOSE THE EDIT TYPED BEFORE IT.**
   * `EditorCustody.flush` (`main.ts`'s delete and pause handlers) calls `ScratchEditor.flush` BEFORE the copy's
   * record is read for undo — or stored for the pause — and before any `destroy()` runs. At `bec75f0` this was a
   * no-op while a format was in flight: `format()` had already cleared `#timer`, and the pending edit lived only
   * inside its own async closure until the server answered, so the record was read stale and undo restored text
   * missing the keystrokes typed before *format*, silently. `flush()` alone — with no destroy anywhere in this test
   * — is what must reach it now.
   */
  it('sends the edit a format owed when flush is called, before the format is answered', async () => {
    const { host, onEdit, ed, answer } = makeFormattable()
    retype(host, '\\a. a')
    const formatting = ed.format()
    ed.flush()
    expect(onEdit, 'a delete reads the record right after this, with no destroy in between').toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith('\\a. a')
    answer([])
    await formatting
    expect(onEdit, 'format’s own continuation must not resend what flush already sent').toHaveBeenCalledTimes(1)
  })

  // Step 5's mutation (deleting the `#seeding` guard) predicted zero failures among the tests above,
  // on the grounds that none of them seeds a fresh editor and then checks for an absent recompile.
  // That prediction held here too, which per that same plan's own instruction means the mutation
  // exposed a missing test rather than a harmless one. This is that test.
  it('does not treat a seed as an edit', () => {
    const { ed, onEdit } = make()
    ed.setText('\\y. y')
    vi.advanceTimersByTime(1000)
    expect(onEdit).not.toHaveBeenCalled()
  })
})
