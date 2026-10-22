import { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { formats, formatsOnALeave, recordFormats } from './format-on-leave-fixture'
import { drawn, frames, host, SHELL, stateIdle, until } from './harness'

/**
 * A DIVIDER DRAGGED WHILE AN EDITOR HAS THE FOCUS DOES NOT FORMAT IT — the settings menu's *format on blur*, and
 * `pane-host.ts`'s `keepingFocus`: the drag's end takes the editor off the page and puts it back with the focus in
 * it, as a switch of views does, and the `blur` that sends the editor is not the user leaving it (`focusKept`'s
 * doc in `main.ts`). `view-keys-format-on-blur.test.ts` holds a switch to the same flag, and
 * `divider-drag-focus.test.ts` drags with the setting off.
 *
 * **WHAT IS COUNTED IS THE REQUEST TO FORMAT**, as `view-keys-format-on-blur.test.ts` counts it and for its reason:
 * the request is posted inside the `blur` handler and its edits arrive a turn later, so none posted by the time the
 * drag returns is none coming. **WHAT A FORMAT WOULD COST IS HELD BESIDE IT**: the text as it was typed, the caret
 * where the click put it, and a key typed next landing at the caret. The server answers with one edit over the whole
 * document, which takes a caret inside it to the start, so text that was already formatted loses its caret too.
 *
 * **EACH CASE FIRST LEAVES ITS EDITOR FOR REAL**, with a pointer press elsewhere, and asserts a request was posted and
 * the text formatted: the setting is on, the server answers, and the count reads what a blur does.
 *
 * **A COPY'S EDITOR IS HELD ON A MACHINE COPY ALONE.** Every copy's editor is handed the one answer to whether a blur
 * formats, whatever its leg (`transport.ts`'s `formatOnBlur`).
 */

recordFormats()

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.removeItem(LAYOUT_STORAGE_KEY)

/** Three lines, so a click on the second puts the caret inside the text. */
const UNFORMATTED = 'let   x   =   40;\nlet   y   =   2;\nx   +   y'

let view: EditorView

const divider = (): HTMLElement => document.querySelector<HTMLElement>('#views .layout-divider') as HTMLElement
const share = (): number => Number(divider().getAttribute('aria-valuenow'))

/** Press the divider between the two views with the pointer and let it go 80 px to its right. */
async function drag(): Promise<void> {
  const views = document.querySelector('#views') as HTMLElement
  const [at, area] = [divider().getBoundingClientRect(), views.getBoundingClientRect()]
  const before = share()
  await userEvent.dragAndDrop(divider(), views, {
    targetPosition: { x: at.left - area.left + 80, y: at.top - area.top + at.height / 2 },
  })
  expect(share(), 'precondition: the drag moved its divider').toBeGreaterThan(before)
}

/**
 * Put `messy` in `editor`, put the caret inside it with a click of the driver's on its second line, drag the divider,
 * and hold that nothing asked for a format, that the editor is as it was two frames on, and that a key typed next
 * lands at the caret.
 *
 * **EACH IS HELD WHETHER OR NOT THE ONE BEFORE IT WAS** (`expect.soft`), so a drag that formats is reported with what
 * the format did.
 */
async function staysAsTypedAcrossADrag(editor: EditorView, messy: string): Promise<void> {
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: messy } })
  // THE COMPILE THE TEXT STARTED, WHERE THE EDITOR IS THE PROGRAM'S: the page is laid out again when it lands
  // (`view-keys-format-on-blur.test.ts` has the measurement), and a press aimed before that can land elsewhere.
  await until(stateIdle, 'the compile the text started')
  await userEvent.click(editor.contentDOM.querySelectorAll('.cm-line')[1] as HTMLElement)
  const caret = editor.state.selection.main.head
  expect(editor.hasFocus, 'precondition: the click put the focus in the editor').toBe(true)
  expect(caret, 'precondition: the caret is past the start of the text').toBeGreaterThan(0)
  expect(caret, 'precondition: and short of its end').toBeLessThan(messy.length)
  const before = formats.length

  await drag()
  expect.soft(formats.length, 'the drag asked for a format of text the user had not left').toBe(before)
  await frames()
  expect.soft(editor.state.doc.toString(), 'the drag changed the text').toBe(messy)
  expect.soft(editor.state.selection.main.head, 'the caret is not where it was').toBe(caret)

  await userEvent.keyboard('Z')
  expect
    .soft(editor.state.doc.toString(), 'the key typed after the drag did not land at the caret')
    .toBe(`${messy.slice(0, caret)}Z${messy.slice(caret)}`)
}

beforeAll(async () => {
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
  expect(drawn(), 'precondition: a first load’s views, one divider beside both').toBe('row[50](source tm-0)')
  // THE SETTING, TURNED ON AS A USER DOES: `settings`, then its checkbox.
  const settings = document.querySelector('#settings') as HTMLElement
  const box = document.querySelector('#format-on-blur') as HTMLInputElement
  expect(box.checked, 'precondition: the setting is off on a first visit').toBe(false)
  await userEvent.click(settings)
  await userEvent.click(box)
  expect(box.checked).toBe(true)
  ;(document.querySelector('#settings-menu') as HTMLElement).hidePopover()
})

// EACH CASE STARTS FROM THE SOURCE EDITOR LEFT FOR REAL, AND WHAT THE LEAVE STARTED OVER: the format it asked for
// applied, and the compile the format started landed. The case before ends with the focus in an editor and a key
// typed, and a press on anything then is a leave whose format and compile land while the case is under way.
beforeEach(async () => {
  expect(await formatsOnALeave(view, UNFORMATTED)).toContain('let x = 40;')
  await until(stateIdle, 'the compile the format started')
})

describe('a divider dragged with the pointer from an editor, with format on blur on', () => {
  it('leaves the source editor’s text as it was typed, and its caret where it was', async () => {
    await staysAsTypedAcrossADrag(view, UNFORMATTED)
  })

  it('leaves a machine copy’s editor’s text as it was typed, and its caret where it was', async () => {
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
    await staysAsTypedAcrossADrag(copy, messy)
  })
})
