import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { KEYMAP_KEY } from '../../src/editor-prefs'
import { SHELL, until } from './harness'

/**
 * **THE KEYMAP SETTING, THROUGH THE APP** — Plan 7 part 3b task 6, design §9.
 *
 * Four claims, in the order the page can show them: the setting is read back from STORAGE at mount
 * rather than from the control; `Esc` belongs to vim and does not move the focus out of the editor;
 * an editor built while the setting is *vim* gets vim too, including a copy's; and the switch reaches
 * every editor already on screen without a reload, which is the whole reason there is a `Compartment`.
 *
 * **REAL TIMERS, DELIBERATELY.** The suite's widget-level template opens with `vi.useFakeTimers()`;
 * this file mounts `main()`, which awaits a wasm fetch, and a fake clock plus an awaited fetch
 * deadlocks — the fetch never settles because nothing advances the clock, and nothing advances the
 * clock because the test is awaiting the fetch.
 *
 * **KEYS ARRIVE THROUGH `userEvent`, NOT THROUGH A SYNTHETIC `KeyboardEvent`.** Half of what this file
 * asserts is that a key INSERTS a character, and a synthetic `keydown` never produces the
 * `beforeinput`/`input` pair a contenteditable actually types with — `panel.test.ts` records the same
 * finding for a button that a synthetic event never activates. So `j` under the default keymap would
 * insert nothing whatever the keymap said, and claim 4 would pass against an editor with no keymap
 * at all.
 */

/**
 * Two lines, because `j` is a claim about the CURSOR and a one-line document cannot carry it.
 *
 * `main.ts`'s own `SAMPLE` is `let x = 40; x + 2` on a single line: vim's `j` there moves nothing and
 * inserts nothing, so "the cursor moved rather than a `j` being typed" and "vim is not installed at
 * all" would look identical.
 */
const TWO_LINES = 'let x = 40;\nx + 2'

let view: EditorView

const resultsText = () => document.querySelector('#results')?.textContent ?? ''
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== ''
const keymapChoice = () => document.querySelector<HTMLSelectElement>('#keymap')
const editorHost = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor')

/**
 * Whether `v` is in vim's NORMAL mode, asked of the DOM rather than of the package.
 *
 * `@replit/codemirror-vim`'s plugin puts `cm-vimMode` on the scroller whenever vim is installed and
 * not in insert mode, and removes it in `destroy()` — so this one class answers "is vim here" and
 * "which mode is it in" together, and it answers them about the element the user is looking at.
 */
const inNormalMode = (v: EditorView): boolean => v.scrollDOM.classList.contains('cm-vimMode')

/** The copy's own CodeMirror view, once a fork has mounted one under the λ pane. */
function copyView(): EditorView {
  const host = editorHost()
  if (host === null) throw new Error('no copy editor mounted under [data-leaf="lambda-0"]')
  const found = EditorView.findFromDOM(host)
  if (found === null) throw new Error('no CodeMirror view mounted under the copy editor host')
  return found
}

/**
 * Put the caret at `pos` in the source editor and confirm the editor actually holds the focus.
 *
 * **THE CONFIRMATION IS THE PRECONDITION, NOT TIDINESS.** Every assertion below is about where a
 * keystroke went; a test that types into an unfocused page asserts nothing about the keymap, because
 * the key reaches neither vim nor CodeMirror.
 */
async function caretTo(pos: number): Promise<void> {
  view.focus()
  view.dispatch({ selection: { anchor: pos } })
  await until(() => view.hasFocus, 'the source editor to take focus')
}

const setKeymapControl = (mode: 'default' | 'vim'): void => {
  const choice = keymapChoice()
  if (choice === null) throw new Error('no keymap control in the settings menu')
  choice.value = mode
  choice.dispatchEvent(new Event('change'))
}

describe('the keymap setting', () => {
  // Written BEFORE the one mount this file makes — the state a returning visitor's page starts in,
  // which is the only way to tell a value read back from storage from a value a control was clicked
  // into. `skin-restore.test.ts` seeds its style and palette the same way.
  beforeAll(async () => {
    localStorage.setItem(KEYMAP_KEY, 'vim')
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: TWO_LINES } })
    await until(idle, 'the two-line program to compile')
  })

  it('mounts in vim because storage said so, not because the control was touched', async () => {
    expect(keymapChoice()?.value).toBe('vim')
    expect(inNormalMode(view), 'the source editor is not in vim normal mode').toBe(true)
    await caretTo(0)
    const before = view.state.doc.toString()
    await userEvent.keyboard('j')
    expect(view.state.doc.toString(), '`j` was typed into the document instead of moving the cursor').toBe(before)
    expect(view.state.selection.main.head, '`j` did not move the cursor to the second line').toBe(
      view.state.doc.line(2).from,
    )
  })

  it('gives Esc to vim and leaves the focus inside the editor', async () => {
    await caretTo(0)
    expect(view.hasFocus, 'precondition: the editor holds the focus before Esc').toBe(true)
    await userEvent.keyboard('i')
    await until(() => !inNormalMode(view), 'vim to enter insert mode on `i`')
    await userEvent.keyboard('{Escape}')
    await until(() => inNormalMode(view), 'Esc to return vim to normal mode')
    // §9's REJECTED ALTERNATIVE, pinned as a property rather than left as prose: one `Esc` with two
    // meanings, told apart only by a mode the user may not be tracking, is what this must never be.
    expect(document.activeElement, 'Esc moved the focus out of the editor').toBe(view.contentDOM)
    expect(view.state.doc.toString(), 'the round trip through insert mode changed the document').toBe(TWO_LINES)
  })

  /**
   * **THE ONE TEST THAT CAN TELL A CORRECTLY PLACED COMPARTMENT FROM A SLIGHTLY MISPLACED ONE**, and
   * the reason it presses `Enter` rather than something more obviously vim-ish.
   *
   * `editor-keymap.ts`'s `keymapSlot` has to sit above EVERY `keymap.of(...)` in an editor's list, not
   * merely above the default one — and most keys cannot show the difference. `j`, `i` and `Esc` all
   * behave identically under both placements: `defaultKeymap` binds none of the first two, and its
   * `Escape` runs `simplifySelection`, which declines an empty selection. `Enter` is bound, to
   * `insertNewlineAndIndent`, and vim's normal-mode `Enter` is a MOTION — so the two placements differ
   * by whether a keystroke edits the document. Measured in Chromium, slot below the first
   * `keymap.of(...)`, caret at offset 1 of `abc\ndef`: `Enter` produced `a\nbc\ndef` and `Backspace`
   * produced `bc\ndef`, against an unchanged document and a moved cursor with the slot above.
   */
  it('lets vim have the keys the default keymap also binds', async () => {
    await caretTo(0)
    const before = view.state.doc.toString()
    await userEvent.keyboard('{Enter}')
    expect(view.state.doc.toString(), 'Enter inserted a newline — the default keymap took the key first').toBe(before)
    expect(view.state.selection.main.head, 'Enter did not move the cursor to the next line').toBe(
      view.state.doc.line(2).from,
    )
    await userEvent.keyboard('{Backspace}')
    expect(view.state.doc.toString(), 'Backspace deleted a character — the default keymap took the key first').toBe(
      before,
    )
  })

  it('gives a copy editor built under the setting the same keymap', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    await until(() => editorHost() !== null, 'the copy editor to mount')
    expect(inNormalMode(copyView()), 'the copy editor is not in vim normal mode').toBe(true)
  })

  it('switches every editor on screen to the default keymap, live, and remembers it', async () => {
    setKeymapControl('default')
    expect(localStorage.getItem(KEYMAP_KEY), 'the choice was not written to storage').toBe('default')
    expect(inNormalMode(view), 'the source editor kept vim after the setting changed').toBe(false)
    expect(inNormalMode(copyView()), 'the copy editor kept vim after the setting changed').toBe(false)
    await caretTo(0)
    await userEvent.keyboard('j')
    expect(view.state.doc.line(1).text, '`j` did not reach the document under the default keymap').toBe(
      `j${TWO_LINES.split('\n')[0]}`,
    )
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: TWO_LINES } })
  })

  it('switches back to vim without a reload', async () => {
    // **THE PRECONDITION IS WHAT MAKES THIS TEST ABLE TO FAIL ON ITS OWN.** It runs after the one
    // above, on the same page, and "took vim back" is satisfied by an editor that never left it — so
    // without these two lines a defect that stops the setting reaching any editor at all passes here
    // while failing only its predecessor.
    expect(inNormalMode(view), 'precondition: the source editor should be off vim by now').toBe(false)
    expect(inNormalMode(copyView()), 'precondition: the copy editor should be off vim by now').toBe(false)
    setKeymapControl('vim')
    expect(localStorage.getItem(KEYMAP_KEY)).toBe('vim')
    expect(inNormalMode(view), 'the source editor did not take vim back').toBe(true)
    expect(inNormalMode(copyView()), 'the copy editor did not take vim back').toBe(true)
    await caretTo(0)
    const before = view.state.doc.toString()
    await userEvent.keyboard('j')
    expect(view.state.doc.toString(), '`j` was typed rather than moving the cursor').toBe(before)

    // AND RE-SELECTING THE MODE ALREADY IN FORCE COSTS NOTHING — asserted against the STATE OBJECT,
    // because a `reconfigure` that changes nothing still produces a new `EditorState` and still runs
    // every editor's configuration resolution. Read back-to-back with no await between them, so
    // nothing else on the page can have dispatched in the gap.
    const stateBefore = view.state
    setKeymapControl('vim')
    expect(view.state, 'reselecting the mode already in force dispatched a transaction anyway').toBe(stateBefore)
  })
})
