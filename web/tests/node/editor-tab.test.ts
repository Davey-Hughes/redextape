import { getIndentUnit } from '@codemirror/language'
import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import type { EditorView, KeyBinding } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import {
  editorNote,
  editorTab,
  INDENT,
  indentAtCaret,
  macSwitchKey,
  switchKey,
  switchSentence,
  tabKeymap,
} from '../../src/editor-tab'

/**
 * The commands behind the source editor's Tab, Shift+Tab, Escape and Ctrl+M, run on an editor state with no DOM.
 * Which handler a key reaches, and where the focus goes, are the browser files' (`editor-tab.test.ts` there).
 */

const quiet = { say: () => {} }

/** A state with the source editor's Tab extension, its selection `ranges` (a number is a caret). */
const stateOf = (doc: string, ...ranges: (number | [number, number])[]): EditorState =>
  EditorState.create({
    doc,
    extensions: [editorTab({ ...quiet, mac: false }), EditorState.allowMultipleSelections.of(true)],
    selection: EditorSelection.create(
      ranges.map((r) => (typeof r === 'number' ? EditorSelection.cursor(r) : EditorSelection.range(r[0], r[1]))),
    ),
  })

/**
 * Just what the bindings read of a view: its state, `dispatch`, tab-focus mode, and vim's state where vim is on.
 * `vim` is `getCM`'s `cm.state.vim`; `undefined` is the default keymap.
 */
function fakeView(state: EditorState, vim?: { insertMode: boolean }) {
  const view = {
    state,
    focusModes: [] as (boolean | number | undefined)[],
    dispatch(tr: Transaction | TransactionSpec) {
      view.state = tr instanceof Transaction ? tr.state : view.state.update(tr).state
    },
    setTabFocusMode(to?: boolean | number) {
      view.focusModes.push(to)
    },
    cm: vim === undefined ? undefined : { state: { vim } },
  }
  return view
}

const binding = (bindings: KeyBinding[], key: string): KeyBinding => {
  const b = bindings.find((x) => x.key === key)
  if (b === undefined) throw new Error(`no binding for ${key}`)
  return b
}

const press = (b: KeyBinding, view: ReturnType<typeof fakeView>, shift = false): boolean => {
  const run = shift ? b.shift : b.run
  if (run === undefined) throw new Error(`${b.key} binds nothing${shift ? ' with Shift' : ''}`)
  return run(view as unknown as EditorView)
}

describe('Tab with no selection', () => {
  it.each([
    [0, 4],
    [3, 1],
    [4, 4],
    [5, 3],
    [7, 1],
  ])('at column %i adds spaces up to the next indent, %i of them', (at, added) => {
    const state = stateOf('let x = 40; x + 2', at)
    let next = state
    expect(indentAtCaret({ state, dispatch: (tr) => (next = tr.state) })).toBe(true)
    expect(next.doc.toString()).toBe(
      `${'let x = 40; x + 2'.slice(0, at)}${' '.repeat(added)}${'let x = 40; x + 2'.slice(at)}`,
    )
    expect(next.selection.main.head, 'the caret ends after the spaces').toBe(at + added)
  })

  it('counts a tab character before the caret as the state’s tab size', () => {
    const state = stateOf('\tx', 2)
    let next = state
    indentAtCaret({ state, dispatch: (tr) => (next = tr.state) })
    expect(state.tabSize, 'precondition: CodeMirror’s default tab size').toBe(4)
    expect(next.doc.toString(), 'column 5 goes to 8').toBe('\tx   ')
  })

  it('counts a second caret on a line after the spaces the first one added', () => {
    const state = stateOf('abcd', 2, 4)
    let next = state
    indentAtCaret({ state, dispatch: (tr) => (next = tr.state) })
    expect(next.doc.toString(), 'columns 2 and 6, each to the next stop').toBe('ab  cd  ')
    expect(next.selection.ranges.map((r) => r.head)).toEqual([4, 8])
  })

  it('adds each caret’s own spaces, on every line it is on', () => {
    const state = stateOf('ab\nabcde', 2, 8)
    let next = state
    indentAtCaret({ state, dispatch: (tr) => (next = tr.state) })
    expect(next.doc.toString()).toBe('ab  \nabcde   ')
    expect(next.selection.ranges.map((r) => r.head)).toEqual([4, 13])
  })
})

describe('Tab and Shift+Tab with a selection', () => {
  it('indents every line a selection touches by the formatter’s indent, keeping the selection on the same text', () => {
    const state = stateOf('let x = 40;\nx + 2', [2, 13])
    expect(getIndentUnit(state), 'the unit is the formatter’s').toBe(INDENT)
    const view = fakeView(state)
    expect(press(binding(tabKeymap(quiet), 'Tab'), view)).toBe(true)
    expect(view.state.doc.toString()).toBe('    let x = 40;\n    x + 2')
    const sel = view.state.selection.main
    expect(view.state.sliceDoc(sel.from, sel.to), 'the selection holds what it held').toBe('t x = 40;\n    x')
    expect(press(binding(tabKeymap(quiet), 'Tab'), view, true)).toBe(true)
    expect(view.state.doc.toString(), 'Shift+Tab takes it back off').toBe('let x = 40;\nx + 2')
  })

  it('takes one indent off the caret’s line with Shift+Tab, and no more than the line has', () => {
    const view = fakeView(stateOf('      x\n  y', 7))
    press(binding(tabKeymap(quiet), 'Tab'), view, true)
    expect(view.state.doc.toString()).toBe('  x\n  y')
    view.state = stateOf(view.state.doc.toString(), 7)
    press(binding(tabKeymap(quiet), 'Tab'), view, true)
    expect(view.state.doc.toString()).toBe('  x\ny')
  })
})

describe('Tab under vim', () => {
  it.each([
    ['normal or visual', false, false],
    ['insert', true, true],
  ])('in %s mode', (_mode, insertMode, takes) => {
    const view = fakeView(stateOf('x', 0), { insertMode })
    const tab = binding(tabKeymap(quiet), 'Tab')
    expect(press(tab, view), 'Tab').toBe(takes)
    expect(view.state.doc.toString(), 'what Tab left').toBe(takes ? '    x' : 'x')
    expect(press(tab, view, true), 'Shift+Tab').toBe(takes)
    expect(view.state.doc.toString(), 'what is left after Tab and Shift+Tab').toBe('x')
  })
})

describe('the way out', () => {
  it('Escape over a selection clears it and opens the way out; over a caret it leaves both to CodeMirror', () => {
    const esc = binding(tabKeymap(quiet), 'Escape')
    const selected = fakeView(stateOf('let x', [0, 3]))
    expect(press(esc, selected)).toBe(true)
    expect(selected.state.selection.main.empty, 'the selection is cleared').toBe(true)
    expect(selected.focusModes, 'the way out opens for two seconds').toEqual([2000])
    const caret = fakeView(stateOf('let x', 2))
    expect(press(esc, caret), 'CodeMirror opens the way out for an Escape no handler takes').toBe(false)
    expect(caret.focusModes).toEqual([])
  })

  it.each([false, true])('Ctrl+M sets the mode outright and says which, on a Mac %s', (mac) => {
    const said: string[] = []
    const view = fakeView(EditorState.create({ doc: 'x', extensions: editorTab({ ...quiet, mac }) }))
    const ctrlM = binding(tabKeymap({ say: (t) => said.push(t) }), 'Ctrl-m')
    expect(ctrlM.mac, 'CodeMirror binds this on a Mac in place of Ctrl-m, so Ctrl+M does not switch there').toBe(
      'Shift-Alt-m',
    )
    expect(press(ctrlM, view)).toBe(true)
    expect(press(ctrlM, view)).toBe(true)
    expect(view.focusModes).toEqual([true, false])
    expect(said).toEqual([switchSentence(true, mac), switchSentence(false, mac)])
    expect(said[0]).toContain(switchKey(mac))
  })

  it.each([false, true])('takes a Mac’s Shift+Option+M by its key, whatever it types, and only on a Mac: %s', (mac) => {
    const said: string[] = []
    const view = fakeView(EditorState.create({ doc: 'x', extensions: editorTab({ ...quiet, mac }) }))
    const take = macSwitchKey({ say: (t) => said.push(t) })
    const key = (init: KeyboardEventInit) =>
      ({
        code: 'KeyM',
        key: 'Â',
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        ...init,
      }) as KeyboardEvent
    const at = view as unknown as EditorView
    expect(take(key({ shiftKey: true, altKey: true, ctrlKey: true }), at), 'with Ctrl as well').toBe(false)
    expect(take(key({ shiftKey: true }), at), 'without Option').toBe(false)
    expect(take(key({ shiftKey: true, altKey: true }), at)).toBe(mac)
    expect(view.focusModes).toEqual(mac ? [true] : [])
    expect(said).toEqual(mac ? [switchSentence(true, true)] : [])
  })

  it('names the key each platform answers to, in the sentences and the description', () => {
    expect([switchKey(false), switchKey(true)]).toEqual(['Ctrl+M', 'Shift+Option+M'])
    expect(switchSentence(true, false)).toBe('Tab now moves the focus out of the editor; Ctrl+M makes it indent again')
    expect(switchSentence(false, true)).toBe('Tab indents in the editor again; Shift+Option+M makes it move the focus')
    expect(editorNote(false, false)).toBe(
      'Tab indents and Shift+Tab takes an indent off. To leave the editor, press Escape and then Tab, or Ctrl+M to make Tab move the focus until you press it again.',
    )
    expect(editorNote(false, true)).toContain('or Shift+Option+M to make Tab')
    expect(editorNote(false, false, true)).toBe(
      'With vim, Tab indents in insert mode and moves the focus in normal and visual mode, so Escape and then Tab leaves the editor from any mode. Ctrl+M makes Tab move the focus in insert mode too, until you press it again.',
    )
    expect(editorNote(true, false, true), 'the mode is the same under vim').toBe(editorNote(true, false))
    expect(editorNote(true, false)).toBe(
      'Tab and Shift+Tab move the focus and do not indent; Ctrl+M makes them indent again.',
    )
  })
})
