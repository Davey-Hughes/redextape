import { indentLess, indentMore, simplifySelection, temporarilySetTabFocusMode } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import {
  countColumn,
  EditorSelection,
  type EditorState,
  type Extension,
  Facet,
  Prec,
  type StateCommand,
  StateEffect,
  StateField,
} from '@codemirror/state'
import { type Command, EditorView, type KeyBinding, keymap, type Panel, showPanel, ViewPlugin } from '@codemirror/view'
import { vimIn, vimOutsideInsert } from './editor-keymap'

/**
 * **TAB INDENTS IN THE SOURCE EDITOR, AND THE KEYBOARD CAN STILL LEAVE IT** (WCAG 2.1.2). CodeMirror's tab-focus mode
 * is the way out: while it is on, the editor hands Tab and Shift+Tab to the browser before any handler, vim's
 * included. Escape turns it on until the next key, and Ctrl+M until Ctrl+M again. The editor's description says both
 * to a screen reader on entry, a line under the editor shows them to a sighted keyboard user who tabbed in, and each
 * Ctrl+M is announced and stays shown until it is pressed again.
 */

/** Columns per indent: the formatter's (`printer.rs`'s `INDENT`), so Tab and a format agree. */
export const INDENT = 4

/**
 * Whether `navigator.platform` names a Mac, an iPhone, an iPod or an iPad. The sentences and the switch key both
 * follow it, so the key a sentence names is the key that works.
 */
export const MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|od|ad)/.test(navigator.platform)

/** The key that switches Tab between indenting and moving the focus, as a reader types it: Option is a Mac's Alt. */
export const switchKey = (mac: boolean): string => (mac ? 'Shift+Option+M' : 'Ctrl+M')

/**
 * Whether `event` is a Mac's Shift+Option+M, by the key's place and not its character. CodeMirror's keymap cannot
 * match it: there Option types a character, `Â` on a US layout, and CodeMirror does not fall back to the key code for
 * an Option combination, so its own Mac binding for this key never fires.
 */
const macSwitch = (event: KeyboardEvent): boolean =>
  event.code === 'KeyM' && event.shiftKey && event.altKey && !event.ctrlKey && !event.metaKey

/**
 * Spaces from each caret to its next indent stop; with any range selected, every touched line one indent deeper.
 *
 * A STOP, NOT A FIXED WIDTH, so text after the caret lines up the way it would in the formatter's columns. Columns
 * count a tab character as the state's `tabSize`, as CodeMirror's own indent commands do.
 */
export const indentAtCaret: StateCommand = ({ state, dispatch }) => {
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore({ state, dispatch })
  // The line's text up to the last caret, with the spaces already added there, so a second caret on the line counts
  // its column after them. CodeMirror hands each caret over in order, in the document as it was.
  let line = -1
  let before = ''
  let at = 0
  const tr = state.changeByRange((r) => {
    const here = state.doc.lineAt(r.head)
    if (here.number !== line) [line, before, at] = [here.number, '', 0]
    before += here.text.slice(at, r.head - here.from)
    at = r.head - here.from
    const spaces = ' '.repeat(INDENT - (countColumn(before, state.tabSize) % INDENT))
    before += spaces
    return { changes: { from: r.head, insert: spaces }, range: EditorSelection.cursor(r.head + spaces.length) }
  })
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

/**
 * Escape with a selection clears it and opens the way out too. CodeMirror opens it only for an Escape no handler
 * took, and its own `simplifySelection` takes the first Escape over a selection, which would make the way out
 * take two.
 */
const escapeOut: Command = (view) => simplifySelection(view) && temporarilySetTabFocusMode(view)

/**
 * Whether a Mac's keys are the ones to name and take. `editorTab` sets it and the first value wins, so a test can ask
 * for either.
 */
export const macKeys = Facet.define<boolean, boolean>({ combine: (values) => values[0] ?? MAC })

/** Whether Ctrl+M has set Tab to move the focus, and whether a Tab or Shift+Tab brought the focus in. */
interface TabMode {
  readonly moving: boolean
  readonly entered: boolean
}

const setMoving = StateEffect.define<boolean>()
const setEntered = StateEffect.define<boolean>()

/**
 * The sentence Ctrl+M says, for the mode it has just switched to. Said rather than only shown, because a screen
 * reader would otherwise hear nothing of the change; it names the way back.
 */
export const switchSentence = (moves: boolean, mac: boolean): string =>
  moves
    ? `Tab now moves the focus out of the editor; ${switchKey(mac)} makes it indent again`
    : `Tab indents in the editor again; ${switchKey(mac)} makes it move the focus`

/** What Tab does and how to leave the editor, under the keymap in force: the description, and the line under it. */
export const editorNote = (moving: boolean, mac: boolean, vim = false): string =>
  moving
    ? `Tab and Shift+Tab move the focus and do not indent; ${switchKey(mac)} makes them indent again.`
    : vim
      ? `With vim, Tab indents in insert mode and moves the focus in normal and visual mode, so Escape and then Tab leaves the editor from any mode. ${switchKey(mac)} makes Tab move the focus in insert mode too, until you press it again.`
      : `Tab indents and Shift+Tab takes an indent off. To leave the editor, press Escape and then Tab, or ${switchKey(mac)} to make Tab move the focus until you press it again.`

/** `editorNote` for `state`. */
const noteFor = (state: EditorState): string =>
  editorNote(state.field(tabMode).moving, state.facet(macKeys), vimIn(state))

/**
 * The line under the editor, for a sighted keyboard user: shown while Ctrl+M's mode is on, so Tab that no longer
 * indents is never a surprise, and while a Tab or Shift+Tab brought the focus in. A click in brings none, so a
 * pointer user's editor keeps its height. HIDDEN FROM A SCREEN READER, which has the same words as the description.
 */
const hintPanel = (view: EditorView): Panel => {
  const dom = document.createElement('div')
  dom.className = 'cm-tab-hint'
  dom.setAttribute('aria-hidden', 'true')
  const show = (state: EditorState) => {
    const text = noteFor(state)
    if (dom.textContent !== text) dom.textContent = text
  }
  show(view.state)
  return { dom, update: (u) => show(u.state) }
}

const tabMode = StateField.define<TabMode>({
  create: () => ({ moving: false, entered: false }),
  update: (mode, tr) => {
    let { moving, entered } = mode
    for (const e of tr.effects) {
      if (e.is(setMoving)) moving = e.value
      else if (e.is(setEntered)) entered = e.value
    }
    return moving === mode.moving && entered === mode.entered ? mode : { moving, entered }
  },
  provide: (field) => [
    showPanel.from(field, (m) => (m.moving || m.entered ? hintPanel : null)),
    EditorView.focusChangeEffect.of((_, focusing) => (focusing ? null : setEntered.of(false))),
  ],
})

/** What the editor needs from the page: a way to say a sentence to a screen reader. */
interface Say {
  readonly say: (text: string) => void
}

/**
 * Switches Tab between indenting and moving the focus, and says which. It SETS THE MODE OUTRIGHT, from the app's own
 * record, rather than toggling CodeMirror's, which a view does not let the app read: the sentence must say what the
 * mode now is.
 */
const switchMode =
  (deps: Say): Command =>
  (view) => {
    const moves = !view.state.field(tabMode).moving
    view.dispatch({ effects: setMoving.of(moves) })
    view.setTabFocusMode(moves)
    deps.say(switchSentence(moves, view.state.facet(macKeys)))
    return true
  }

/**
 * The source editor's Tab, Shift+Tab, Escape and Ctrl+M. ABOVE THE DEFAULT KEYMAP, whose Escape and Ctrl+M these
 * replace. In vim's normal and visual modes Tab and Shift+Tab decline, so the browser moves the focus: vim indents
 * with `>>` and `<<` there. CTRL+M IS NOT BOUND ON A MAC: CodeMirror binds a binding's `mac` key there in place of
 * its `key`, and the `mac` key named here never fires (`macSwitch` says why), so `macSwitchKey` takes a Mac's switch
 * key.
 */
export function tabKeymap(deps: Say): KeyBinding[] {
  return [
    {
      key: 'Tab',
      run: (view) => !vimOutsideInsert(view) && indentAtCaret(view),
      shift: (view) => !vimOutsideInsert(view) && indentLess(view),
    },
    { key: 'Escape', run: escapeOut },
    { key: 'Ctrl-m', mac: 'Shift-Alt-m', run: switchMode(deps) },
  ]
}

/**
 * A Mac's Shift+Option+M, for a keydown handler ABOVE VIM'S. Vim sits above every keymap (`editor-keymap.ts`'s
 * `keymapSlot` says why), and on a Mac it takes an Option key it does not map in normal and visual mode, so a keymap
 * binding would never see this key there. Ctrl+M stays in the keymap, as vim maps no `<C-m>`.
 */
export const macSwitchKey =
  (deps: Say) =>
  (event: KeyboardEvent, view: EditorView): boolean =>
    view.state.facet(macKeys) && macSwitch(event) && switchMode(deps)(view)

/** The editor's description element: one per view, so its id is the view's. */
const notes = new WeakMap<EditorView, HTMLElement>()
let made = 0

const noteOf = (view: EditorView): HTMLElement => {
  let note = notes.get(view)
  if (note === undefined) {
    note = document.createElement('p')
    made += 1
    note.id = `editor-tab-note-${made}`
    // HIDDEN, NOT VISUALLY HIDDEN: `aria-describedby` reads a hidden element all the same, and a screen reader browsing
    // the page would otherwise meet the paragraph again after the editor.
    note.hidden = true
    note.textContent = noteFor(view.state)
    notes.set(view, note)
  }
  return note
}

/** Whether a modifier other than Shift is down: Ctrl+Tab, the browser's own, brings the focus back from another tab. */
const held = (event: KeyboardEvent): boolean => event.ctrlKey || event.metaKey || event.altKey

/**
 * Keeps the description true to the mode and the keymap, and notices a Tab that brought the focus in: its keyup lands
 * here with no keydown here before it. A Tab the editor indented with was seen going down; one that left went up
 * elsewhere. OBSERVERS, NOT HANDLERS, so they see a Tab whichever binding takes it.
 */
const tabWatch = ViewPlugin.define(
  (view) => {
    view.dom.append(noteOf(view))
    return {
      tabDown: false,
      update(u) {
        const text = noteFor(u.state)
        if (noteOf(u.view).textContent !== text) noteOf(u.view).textContent = text
      },
      destroy: () => noteOf(view).remove(),
    }
  },
  {
    eventObservers: {
      focus() {
        this.tabDown = false
      },
      keydown(event) {
        if (event.key === 'Tab' && !held(event)) this.tabDown = true
      },
      keyup(event, view) {
        if (event.key !== 'Tab' || held(event)) return
        if (!this.tabDown && !view.state.field(tabMode).entered) view.dispatch({ effects: setEntered.of(true) })
        this.tabDown = false
      },
    },
  },
)

/**
 * The source editor's Tab: its keys, the indent unit, the mode, the description `aria-describedby` names and the line
 * under the editor. Placed where its keymap goes, ABOVE THE DEFAULT KEYMAP; a Mac's switch key goes above vim's
 * handler wherever this is placed. A DESCRIPTION, NOT A WORD IN THE LABEL, so a screen reader says it after the
 * editor's name and a user can turn descriptions off.
 */
export function editorTab(deps: Say & { readonly mac?: boolean }): Extension {
  return [
    keymap.of(tabKeymap(deps)),
    Prec.highest(EditorView.domEventHandlers({ keydown: macSwitchKey(deps) })),
    macKeys.of(deps.mac ?? MAC),
    indentUnit.of(' '.repeat(INDENT)),
    tabMode,
    EditorView.contentAttributes.of((view) => ({ 'aria-describedby': noteOf(view).id })),
    tabWatch,
  ]
}
