import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { formats, formatsOnALeave, recordFormats } from './format-on-leave-fixture'
import { armed, host, mounted, SHELL, stateIdle, until } from './harness'
import { viewKey } from './user-event-fixture'

/**
 * A VIEW KEY PRESSED FROM AN EDITOR DOES NOT FORMAT IT — the settings menu's *format on blur*, and the view layouts
 * spec §4.5 step 5: a switch takes the editor off the page and puts it back with the focus in it, and the `blur` that
 * sends the editor is not the user leaving it (`focusKept`'s doc in `main.ts`).
 *
 * **WHAT IS COUNTED IS THE REQUEST TO FORMAT, AND NOT ONLY THE TEXT.** A format is asked of the language server and
 * its edits arrive a turn later, so "the text is unchanged" is true for a moment after any blur. `Worker`'s own
 * `postMessage` is wrapped before the app mounts and each `textDocument/formatting` request is recorded, as the app
 * posts it, inside the `blur` handler: none posted by the time the key returns is none coming.
 *
 * **EACH CASE FIRST LEAVES THE EDITOR FOR REAL**, with a pointer press elsewhere, and asserts a request was posted and
 * the text formatted: the setting is on, the server answers, and the count reads what a blur does.
 */

recordFormats()

const UNFORMATTED = 'let   x   =   40;\nx   +   2'

let view: EditorView

/**
 * Put `messy` in `editor` with the focus in it and the caret at `caret`, press the view key that hides the asm view,
 * and hold that nothing asked for a format and the editor is as it was.
 */
async function keepsItsTextAcrossAKey(editor: EditorView, messy: string, caret: number): Promise<void> {
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: messy } })
  editor.focus()
  editor.dispatch({ selection: { anchor: caret } })
  await until(() => editor.hasFocus, 'the editor to take the focus')
  const before = formats.length
  await viewKey('2')
  expect(mounted(), 'precondition: the key hid the asm view').not.toContain('asm-0')
  expect(formats.length, 'the view key asked for a format of text the user had not left').toBe(before)
  expect(editor.state.doc.toString(), 'the view key changed the text').toBe(messy)
  expect(editor.hasFocus, 'the view key took the focus out of the editor').toBe(true)
  expect(editor.state.selection.main.head, 'the caret is not where it was').toBe(caret)
}

describe('a view key from an editor, with format on blur on', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(stateIdle, 'the first compile')
    // THE SETTING, TURNED ON AS A USER DOES: `settings`, then its checkbox.
    const settings = document.querySelector('#settings') as HTMLElement
    const box = document.querySelector('#format-on-blur') as HTMLInputElement
    expect(box.checked, 'precondition: the setting is off on a first visit').toBe(false)
    await userEvent.click(settings)
    await userEvent.click(box)
    expect(box.checked).toBe(true)
    ;(document.querySelector('#settings-menu') as HTMLElement).hidePopover()
  })

  afterEach(async () => {
    if (armed()) await userEvent.keyboard('{Escape}')
    for (const b of document.querySelectorAll<HTMLButtonElement>('#views-shown button[aria-pressed="false"]')) b.click()
  })

  it('leaves the source editor’s text as it was typed', async () => {
    const formatted = await formatsOnALeave(view, UNFORMATTED)
    expect(formatted).toContain('let x = 40;')
    await keepsItsTextAcrossAKey(view, UNFORMATTED, 7)
    // AND THE SETTING IS STILL IN FORCE ONCE THE SWITCH IS OVER: the next real leave formats.
    expect(await formatsOnALeave(view, UNFORMATTED)).toBe(formatted)
  })

  /**
   * **THE COMPILE THE CASE BEFORE STARTED IS WAITED FOR FIRST.** Its last leave formats the program, which compiles
   * again, and the page is laid out again when that lands: with the menu open, this menu's *edit a copy* moves 34 px up
   * a frame before the compile is idle. A press aimed before the move lands outside the menu, the browser shuts it, and
   * the case would wait out its cap for an item no longer on the page.
   */
  it('leaves a machine copy’s editor’s text as it was typed', async () => {
    await until(stateIdle, 'the compile the case before started')
    const more = host('tm-0')?.querySelector('button.view-more') as HTMLElement
    await userEvent.click(more)
    const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement
    await until(() => menu.matches(':popover-open'), 'the view’s menu')
    await userEvent.click(menu.querySelector('button.detach') as HTMLElement)
    await until(() => host('tm-0')?.querySelector('.cm-editor') != null, 'the copy’s editor')
    const copy = EditorView.findFromDOM(host('tm-0')?.querySelector('.cm-editor') as HTMLElement) as EditorView
    // THE COPY'S OWN TEXT WITH ITS FIRST SPACE MADE FOUR, which the formatter makes one again.
    const text = copy.state.doc.toString()
    const messy = text.replace(' ', '    ')
    expect(messy, 'precondition: the copy’s text has a space to widen').not.toBe(text)
    expect(await formatsOnALeave(copy, messy)).toBe(text)
    await keepsItsTextAcrossAKey(copy, messy, 5)
  })
})
