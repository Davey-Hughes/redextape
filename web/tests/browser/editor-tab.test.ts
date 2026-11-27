import { Compartment, Prec, StateEffect } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { CodeMirror, getCM } from '@replit/codemirror-vim'
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api'
import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { editorNote, MAC, macKeys, switchKey, switchSentence } from '../../src/editor-tab'
import { formats, recordFormats } from './format-on-leave-fixture'
import { inNormalMode, isShown, SHELL, stateIdle, until } from './harness'

/**
 * **TAB INDENTS IN THE SOURCE EDITOR, AND THE KEYBOARD CAN STILL LEAVE IT** (`editor-tab.ts`), through the app: what
 * each key leaves in the document, and where the focus is after it. Keys arrive through `userEvent`, for the reason
 * `vim-keymap.test.ts` gives. Requests to format are counted, as `format-on-leave-fixture.ts` says, for the last two
 * cases.
 */

recordFormats()

const DOC = 'let x = 40; x + 2'
const TWO_LINES = 'let x = 40;\nx + 2'
const switchFor = (mac: boolean): string => (mac ? '{Shift>}{Alt>}m{/Alt}{/Shift}' : '{Control>}m{/Control}')
const SWITCH = switchFor(MAC)
const SHIFT_TAB = '{Shift>}{Tab}{/Shift}'

let view: EditorView

const live = () => document.querySelector('#live')?.textContent?.trim()
const hint = () => document.querySelector<HTMLElement>('.cm-tab-hint')
const text = () => view.state.doc.toString()
const selected = () => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)

/** Put `doc` in the editor with `from`..`to` selected, and hold that the editor has the focus. */
async function into(doc: string, from: number, to = from): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } })
  view.focus()
  view.dispatch({ selection: { anchor: from, head: to } })
  await until(() => view.hasFocus, 'the source editor to take the focus')
}

/** Whether the focus is on a control `way` of the editor's text, with the ring the keyboard's focus shows. */
const leftFor = (way: 'after' | 'before'): boolean => {
  const at = document.activeElement
  const side = way === 'after' ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING
  return at !== null && at !== document.body && (view.contentDOM.compareDocumentPosition(at) & side) !== 0
    ? at.matches(':focus-visible')
    : false
}

const setKeymap = (mode: 'default' | 'vim'): void => {
  const choice = document.querySelector<HTMLSelectElement>('#keymap') as HTMLSelectElement
  choice.value = mode
  choice.dispatchEvent(new Event('change'))
}

beforeAll(async () => {
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
})

describe('Tab in the source editor', () => {
  it('adds spaces at the caret up to the next indent, and keeps the focus', async () => {
    await into(DOC, 3)
    await userEvent.keyboard('{Tab}')
    expect(text()).toBe('let  x = 40; x + 2')
    expect(view.state.selection.main.head).toBe(4)
    expect(document.activeElement).toBe(view.contentDOM)
  })

  it('indents each selected line and keeps the selection, and Shift+Tab takes it back off', async () => {
    await into(TWO_LINES, 2, 13)
    await userEvent.keyboard('{Tab}')
    expect(text()).toBe('    let x = 40;\n    x + 2')
    expect(selected()).toBe('t x = 40;\n    x')
    await userEvent.keyboard(SHIFT_TAB)
    expect(text()).toBe(TWO_LINES)
    expect(document.activeElement).toBe(view.contentDOM)
  })

  it('takes one indent off the caret’s line with Shift+Tab', async () => {
    await into('      x', 7)
    await userEvent.keyboard(SHIFT_TAB)
    expect(text()).toBe('  x')
    expect(document.activeElement).toBe(view.contentDOM)
  })
})

describe('the way out', () => {
  it('is Escape and then Tab, to the next control, with the text as it was', async () => {
    await into(DOC, 3)
    await userEvent.keyboard('{Escape}{Tab}')
    expect(leftFor('after'), 'the focus is not on the control after the editor').toBe(true)
    expect(text()).toBe(DOC)
  })

  it('is Escape and then Shift+Tab, to the control before', async () => {
    await into(DOC, 3)
    await userEvent.keyboard(`{Escape}${SHIFT_TAB}`)
    expect(leftFor('before'), 'the focus is not on the control before the editor').toBe(true)
    expect(text()).toBe(DOC)
  })

  it('takes one Escape over a selection, which it clears', async () => {
    await into(DOC, 0, 3)
    await userEvent.keyboard('{Escape}')
    expect(view.state.selection.main.empty, 'the selection is cleared').toBe(true)
    await userEvent.keyboard('{Tab}')
    expect(leftFor('after')).toBe(true)
    expect(text()).toBe(DOC)
  })

  it('closes at the next key that is not Tab, so a Tab after it indents', async () => {
    await into(DOC, 0)
    await userEvent.keyboard('{Escape}{ArrowRight}{Tab}')
    expect(text()).toBe('l   et x = 40; x + 2')
    expect(document.activeElement).toBe(view.contentDOM)
  })

  it('is Ctrl+M, said and shown, until Ctrl+M again', async () => {
    await into(DOC, 0)
    try {
      await userEvent.keyboard(SWITCH)
      expect(live()).toBe(switchSentence(true, MAC))
      expect(hint()?.textContent).toBe(editorNote(true, MAC))
      expect(computeAccessibleDescription(view.contentDOM)).toBe(editorNote(true, MAC))
      await userEvent.keyboard('{Tab}')
      expect(leftFor('after')).toBe(true)
      await userEvent.keyboard(SHIFT_TAB)
      expect(document.activeElement, 'Shift+Tab came back into the editor').toBe(view.contentDOM)
      await userEvent.keyboard('{Tab}')
      expect(leftFor('after'), 'a second Tab left without an Escape').toBe(true)
      await userEvent.keyboard(SHIFT_TAB)
      await userEvent.keyboard(SWITCH)
      expect(live()).toBe(switchSentence(false, MAC))
      await userEvent.keyboard('{Tab}')
      expect(text()).toBe(`    ${DOC}`)
      expect(document.activeElement).toBe(view.contentDOM)
      expect(computeAccessibleDescription(view.contentDOM)).toBe(editorNote(false, MAC))
    } finally {
      // THE MODE OFF FOR THE CASES AFTER THIS ONE, if a claim above failed while it was on.
      if (computeAccessibleDescription(view.contentDOM) === editorNote(true, MAC)) {
        view.focus()
        await userEvent.keyboard(SWITCH)
      }
    }
  })
})

describe('what the editor says of Tab', () => {
  it('names the editor and describes Tab and the way out', async () => {
    expect(computeAccessibleName(view.contentDOM)).toBe('source program editor')
    expect(computeAccessibleDescription(view.contentDOM)).toBe(editorNote(false, MAC))
  })

  it('shows it under the editor to a keyboard user who tabbed in, and not to a click', async () => {
    const wordmark = document.querySelector('.wordmark') as HTMLElement
    const leave = async () => {
      await userEvent.click(wordmark)
      // CodeMirror tells the editor it was left ten milliseconds after the blur.
      await until(() => hint() === null, 'the line to go when the editor is left')
    }
    await leave()
    await into(DOC, 0)
    expect(hint(), 'a focus not brought by Tab shows the line').toBeNull()
    await userEvent.keyboard('{Escape}{Tab}')
    await until(() => hint() === null && !view.hasFocus, 'the line to go when the editor is left')
    await userEvent.keyboard(SHIFT_TAB)
    await until(() => hint() !== null, 'the line under the editor')
    expect(hint()?.textContent).toBe(editorNote(false, MAC))
    expect(hint()?.getAttribute('aria-hidden'), 'the description already says it to a screen reader').toBe('true')
    await leave()
    await userEvent.click(view.contentDOM)
    expect(view.hasFocus).toBe(true)
    expect(hint(), 'a click in shows the line').toBeNull()
  })

  it('shows it under the editor after a Tab in from the control before it', async () => {
    await into(DOC, 0)
    await userEvent.keyboard(`{Escape}${SHIFT_TAB}`)
    expect(leftFor('before'), 'precondition: on the control before the editor').toBe(true)
    await until(() => hint() === null, 'the line to go when the editor is left')
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement, 'Tab brought the focus into the editor').toBe(view.contentDOM)
    await until(() => hint() !== null, 'the line under the editor')
    expect(isShown(hint() as HTMLElement), 'the line is drawn').toBe(true)
    expect(hint()?.textContent).toBe(editorNote(false, MAC))
    expect(text()).toBe(DOC)
  })
})

describe('Tab under vim', () => {
  it('moves the focus in normal and visual mode and indents in insert mode', async () => {
    setKeymap('vim')
    try {
      await into(DOC, 0)
      expect(inNormalMode(view), 'precondition: vim is in normal mode').toBe(true)
      expect(computeAccessibleDescription(view.contentDOM), 'the description under vim').toBe(
        editorNote(false, MAC, true),
      )
      await userEvent.keyboard('{Tab}')
      expect(leftFor('after'), 'Tab in normal mode').toBe(true)
      await into(DOC, 0)
      await userEvent.keyboard('i{Tab}')
      expect(text()).toBe(`    ${DOC}`)
      expect(document.activeElement, 'Tab in insert mode').toBe(view.contentDOM)
      await userEvent.keyboard('{Escape}{Tab}')
      expect(leftFor('after'), 'Escape and then Tab, from insert mode').toBe(true)
      await into(DOC, 0)
      await userEvent.keyboard('v{Tab}')
      expect(leftFor('after'), 'Tab in visual mode').toBe(true)
      expect(text()).toBe(DOC)
    } finally {
      setKeymap('default')
    }
    expect(computeAccessibleDescription(view.contentDOM), 'the description once vim is off').toBe(
      editorNote(false, MAC),
    )
  })
})

/** A Mac's keys in the editor, put in at the top precedence when a case asks for them, since the first value wins. */
const asMac = new Compartment()

/** Ctrl+M is not a Mac's key: CodeMirror binds it only off a Mac. */
const KEYS = [false, true].filter((mac) => mac || !MAC)

/**
 * Runs `body` under vim with `mac`'s switch key, then puts the page back: vim off, the mode off, the platform as it
 * was. VIM READS THE PLATFORM TOO, from `CodeMirror.isMac` at each key, and on a Mac it takes an Option key in normal
 * mode, so a case that names a Mac's key has to tell vim it is on one.
 */
async function underVim(mac: boolean, body: () => Promise<void>): Promise<void> {
  const wasMac = CodeMirror.isMac
  view.dispatch({ effects: asMac.reconfigure(Prec.highest(macKeys.of(mac))) })
  CodeMirror.isMac = mac
  setKeymap('vim')
  try {
    await body()
  } finally {
    setKeymap('default')
    if (computeAccessibleDescription(view.contentDOM) === editorNote(true, mac)) {
      view.focus()
      await userEvent.keyboard(switchFor(mac))
    }
    view.dispatch({ effects: asMac.reconfigure([]) })
    CodeMirror.isMac = wasMac
  }
}

/**
 * The switch key and then `i`, holding that vim is in insert mode after them. THE ESCAPE BETWEEN THEM GUARDS A
 * REGRESSION in which vim sees the switch key: told it is on a Mac and handed the `m` a browser here reports, vim
 * reads it as `m`, which waits for a mark's name and would take the `i`. The Escape cancels that, so the regression
 * fails the case at its checks of Tab, not at this helper's check of insert mode.
 */
async function switchThenInsert(mac: boolean): Promise<void> {
  await userEvent.keyboard(`${switchFor(mac)}{Escape}i`)
  expect(getCM(view)?.state.vim?.insertMode, 'precondition: vim is in insert mode').toBe(true)
}

describe('the switch key under vim', () => {
  beforeAll(() => {
    view.dispatch({ effects: StateEffect.appendConfig.of(asMac.of([])) })
  })

  it.each(KEYS)('pressed in normal mode makes Tab move the focus in insert mode too, on a Mac: %s', async (mac) => {
    await underVim(mac, async () => {
      await into(DOC, 0)
      expect(inNormalMode(view), 'precondition: vim is in normal mode').toBe(true)
      await switchThenInsert(mac)
      await userEvent.keyboard('{Tab}')
      expect(leftFor('after'), `Tab in insert mode, after ${switchKey(mac)} in normal mode`).toBe(true)
      expect(text()).toBe(DOC)
      expect(computeAccessibleDescription(view.contentDOM)).toBe(editorNote(true, mac))
    })
  })

  it.each(KEYS)('pressed again in normal mode makes Tab indent in insert mode, on a Mac: %s', async (mac) => {
    await underVim(mac, async () => {
      await into(DOC, 0)
      await userEvent.keyboard('i')
      await userEvent.keyboard(switchFor(mac))
      expect(computeAccessibleDescription(view.contentDOM), 'precondition: the key switched in insert mode').toBe(
        editorNote(true, mac),
      )
      await userEvent.keyboard('{Escape}')
      expect(inNormalMode(view), 'precondition: back in normal mode').toBe(true)
      await switchThenInsert(mac)
      await userEvent.keyboard('{Tab}')
      expect(text(), `Tab in insert mode, after ${switchKey(mac)} again in normal mode`).toBe(`    ${DOC}`)
      expect(document.activeElement).toBe(view.contentDOM)
      expect(computeAccessibleDescription(view.contentDOM)).toBe(editorNote(false, mac, true))
    })
  })
})

/** Turns *format on blur* on through the settings menu, as a user does, unless it is on already. */
async function formatOnBlur(): Promise<void> {
  const box = document.querySelector('#format-on-blur') as HTMLInputElement
  if (box.checked) return
  await userEvent.click(document.querySelector('#settings') as HTMLElement)
  await userEvent.click(box)
  expect(box.checked).toBe(true)
  ;(document.querySelector('#settings-menu') as HTMLElement).hidePopover()
}

describe('the way out, with format on blur', () => {
  const messy = 'let   x   =   40;\nx   +   2'

  it('formats the text it leaves', async () => {
    await formatOnBlur()
    await into(messy, 0)
    const before = formats.length
    await userEvent.keyboard('{Escape}{Tab}')
    expect(leftFor('after')).toBe(true)
    expect(formats.length, 'leaving by the way out asked for no format').toBe(before + 1)
    await until(() => text() !== messy, 'the text to be formatted when the editor is left')
  })

  it('formats the text it leaves by Ctrl+M and then Tab', async () => {
    await formatOnBlur()
    await into(messy, 0)
    const before = formats.length
    try {
      await userEvent.keyboard(`${SWITCH}{Tab}`)
      expect(leftFor('after')).toBe(true)
      expect(formats.length, 'leaving by Ctrl+M and then Tab asked for no format').toBe(before + 1)
      await until(() => text() !== messy, 'the text to be formatted when the editor is left')
    } finally {
      if (computeAccessibleDescription(view.contentDOM) === editorNote(true, MAC)) {
        view.focus()
        await userEvent.keyboard(SWITCH)
      }
    }
  })
})
