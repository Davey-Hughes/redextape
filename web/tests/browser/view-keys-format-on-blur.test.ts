import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { host, SHELL, until } from './harness'

/**
 * A VIEW KEY PRESSED FROM AN EDITOR DOES NOT FORMAT IT — the settings menu's *format on blur*, and the view layouts
 * spec §4.5 step 5: a switch takes the editor off the page and puts it back with the focus in it, and the `blur`
 * that sends the editor is not the user leaving it (`main.ts`'s `focusKept` has what was measured).
 *
 * **WHAT IS COUNTED IS THE REQUEST TO FORMAT, AND NOT ONLY THE TEXT.** A format is asked of the language server and
 * its edits arrive a turn later, so "the text is unchanged" is true for a moment after any blur. `Worker`'s own
 * `postMessage` is wrapped before the app mounts and each `textDocument/formatting` request is recorded, as the app
 * posts it, inside the `blur` handler: none posted by the time the key returns is none coming.
 *
 * **EACH CASE FIRST LEAVES THE EDITOR FOR REAL**, with a pointer press elsewhere, and asserts a request was posted and
 * the text formatted: the setting is on, the server answers, and the count reads what a blur does.
 */

/**
 * The document of each format request posted to a worker, in order. The language server is sent each message as
 * `{ kind: 'msg', json }` (`lsp-protocol.ts`'s `LspRequestMessage`), the JSON-RPC message already a string.
 */
const formats: string[] = []
const post = Worker.prototype.postMessage
Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]): void {
  const sent = message as { kind?: unknown; json?: unknown } | null
  if (sent?.kind === 'msg' && typeof sent.json === 'string') {
    const rpc = JSON.parse(sent.json) as { method?: string; params?: { textDocument?: { uri?: string } } }
    if (rpc.method === 'textDocument/formatting') formats.push(rpc.params?.textDocument?.uri ?? '')
  }
  ;(post as (...args: unknown[]) => void).apply(this, [message, ...rest])
}

const PREFIX = '{Control>}.{/Control}'
const UNFORMATTED = 'let   x   =   40;\nx   +   2'

let view: EditorView

const armed = (): boolean => !(document.querySelector('#view-keys') as HTMLElement).hidden
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const idle = (): boolean => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

/** The prefix and then `key`, with the mode asserted armed between them. */
async function viewKey(key: string): Promise<void> {
  await userEvent.keyboard(PREFIX)
  expect(armed(), 'the prefix did not arm the mode').toBe(true)
  await userEvent.keyboard(key)
  expect(armed()).toBe(false)
}

/**
 * Put `messy` in `editor` with the focus in it, leave it with a pointer press on the wordmark, and hold that the
 * leave asked for a format and the text changed. Answers the text the server left.
 */
async function formatsOnALeave(editor: EditorView, messy: string): Promise<string> {
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: messy } })
  editor.focus()
  await until(() => editor.hasFocus, 'the editor to take the focus')
  const before = formats.length
  await userEvent.click(document.querySelector('.wordmark') as HTMLElement)
  expect(formats.length, 'precondition: a real leave asks for a format').toBe(before + 1)
  await until(() => editor.state.doc.toString() !== messy, 'the text to be formatted when the editor is left')
  return editor.state.doc.toString()
}

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
    await until(idle, 'the first compile')
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
   * again, and the page is laid out again when that lands: measured (2026-10-12), this menu's *edit a copy* moved 34
   * px up a frame before the compile was idle, with the menu open. A press aimed before the move lands outside the
   * menu, the browser shuts it, and the case waited out its cap for an item no longer on the page: once in two runs
   * of 25 files at `CPUQuota=25%`.
   */
  it('leaves a machine copy’s editor’s text as it was typed', async () => {
    await until(idle, 'the compile the case before started')
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
