import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY } from '../../src/buffers-store'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

/**
 * **DELETE AND UNDO, THROUGH THE REAL APP** — Plan 7 part 2 spec §10. One copy, deleted from the copies menu
 * while a view shows it; the notice's undo brings it back under its name, at step 0, on the view it left.
 */

const leaf = (id: string) => document.querySelector<HTMLElement>(`[data-leaf="${id}"]`)
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const titleText = (id: string) => leaf(id)?.querySelector('.view-title')?.textContent ?? ''
const stepText = () => leaf('lambda-0')?.querySelector('.step')?.textContent ?? ''

beforeAll(async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  leaf('lambda-0')?.querySelector<HTMLButtonElement>('button.detach')?.click()
  await until(() => titleText('lambda-0') === 'λ · copy 1', 'the λ view to show its copy')
})

describe('pausing a copy', () => {
  it('moves its view to the program and says how many', async () => {
    document.querySelector<HTMLButtonElement>('#buffers')?.click()
    document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label="pause λ copy 1"]')?.click()
    await until(() => titleText('lambda-0') === 'λ · program', 'the view to move to the program')
    expect(noticeText()).toBe('λ copy 1 paused · 1 view now shows the program')

    document
      .querySelector<HTMLButtonElement>('.buffer-list button[aria-label="resume λ copy 1 — restarts at step 0"]')
      ?.click()
    expect(noticeText()).toBe('λ copy 1 resumed at step 0')
    document.querySelector<HTMLElement>('.buffer-list')?.hidePopover()

    // BACK ON THE COPY THROUGH THE TITLE MENU, which the delete test below starts from.
    const title = leaf('lambda-0')?.querySelector<HTMLButtonElement>('button.view-title')
    title?.click()
    document
      .getElementById(title?.getAttribute('aria-controls') ?? '')
      ?.querySelector<HTMLButtonElement>(`button[data-binding="${bindingKey('lambda', 'scratch-1')}"]`)
      ?.click()
    expect(titleText('lambda-0')).toBe('λ · copy 1')
  })
})

describe('deleting a copy', () => {
  it('moves its view to the program and offers undo', async () => {
    document.querySelector<HTMLButtonElement>('#buffers')?.click()
    document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label="delete λ copy 1"]')?.click()
    await until(() => titleText('lambda-0') === 'λ · program', 'the view to move to the program')
    expect(noticeText()).toBe('λ copy 1 deleted')
    expect(document.querySelector('#notice button.notice-action')?.textContent).toBe('undo')
    expect(document.querySelector('#buffers')?.textContent).toBe('copies ▾')
  })

  it('comes back through undo, under its name, on the view it left, and says so', async () => {
    document.querySelector<HTMLButtonElement>('#notice button.notice-action')?.click()
    await until(() => titleText('lambda-0') === 'λ · copy 1', 'the view to show the copy again')
    expect(noticeText()).toBe('λ copy 1 restored at step 0')
    expect(document.querySelector('#buffers')?.textContent).toBe('copies 1 ▾')
    // **THE CONTROL THAT WAS ACTIVATED IS GONE, SO THE FOCUS IS SOMEWHERE A USER CAN CARRY ON FROM** —
    // spec §11, and the accessibility list's item 1 in this gesture's own control.
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(document.querySelector('[data-leaf="lambda-0"] .view-title'))
    // **AND THE COPY IS EDITABLE AGAIN.** `undo` claims the leaf before the build's reply lands; without
    // the claim the reply mounts nothing, the frames come back and the text can never be edited — the
    // state `mountScratchEditor`'s own doc prices, reached here by a different road.
    await until(() => document.querySelector('[data-leaf="lambda-0"] .term-editor') !== null, "the copy's editor")
    // "AT STEP 0" IS WHERE THE RUN RESTARTS, NOT WHERE THE READOUT ENDS: recording pushes the play head
    // to the frontier, so the view settles on `step 7 of 7`. What proves a fresh run is that its oldest
    // kept step is 0 — `↺` goes back to the oldest kept step.
    await until(() => /^step [\d,]+ of [\d,]+$/.test(stepText()), 'the copy to run again')
    leaf('lambda-0')?.querySelector<HTMLButtonElement>('[aria-label="back to the oldest kept step"]')?.click()
    expect(stepText()).toMatch(/^step 0 of /)
  })
})

/**
 * **THE FLOW THE SPEC NAMES, WITH THE EDIT IN IT — whole-branch review, I5.** Spec §14's end-to-end list
 * has "make a copy, edit it, delete it, undo"; the tests above cover every step of that but the EDIT, so
 * "undo restores what I had typed" was a claim about a real window that nothing exercised.
 *
 * **THE WINDOW IS REAL BECAUSE THE TEXT IS NOT RECORDED ON EVERY KEYSTROKE.** `ScratchBuffers`'s `text`
 * advances on `ScratchEditor`'s 300 ms debounce and on the `scratch-compiled` reply, so a delete between
 * the keystroke and the record takes the typing with it. Waiting for the PERSISTED text rather than for
 * a timer is what makes this test wait for the thing it is about.
 */
describe('a copy that was edited', () => {
  const storedText = (): string | null => {
    const raw = localStorage.getItem(BUFFERS_STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as { buffers?: { text?: string }[] }
    return parsed.buffers?.[0]?.text ?? null
  }
  const copyEditor = (): EditorView | null => {
    const host = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor .cm-content')
    return host === null ? null : EditorView.findFromDOM(host)
  }

  it('comes back through undo holding the text that was typed into it, not the text it was forked with', async () => {
    const editor = copyEditor()
    if (editor === null) throw new Error('the restored copy has no editor to type into')
    const forked = editor.state.doc.toString()
    const typed = '\u03bbx. x'
    expect(typed, 'the edit has to change something').not.toBe(forked)
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: typed } })
    // THE RECORD, NOT THE EDITOR: the editor holds the text the instant it is dispatched, and what undo
    // restores from is the recorded copy.
    await until(() => storedText() === typed, 'the typed text to reach the record')

    document.querySelector<HTMLButtonElement>('#buffers')?.click()
    document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label="delete \u03bb copy 1"]')?.click()
    await until(() => titleText('lambda-0') === '\u03bb \u00b7 program', 'the view to move to the program')

    document.querySelector<HTMLButtonElement>('#notice button.notice-action')?.click()
    await until(() => titleText('lambda-0') === '\u03bb \u00b7 copy 1', 'the view to show the copy again')
    await until(() => copyEditor() !== null, "the restored copy's editor")
    expect(copyEditor()?.state.doc.toString(), 'undo restored the forked text, not the typed text').toBe(typed)
  })
})
