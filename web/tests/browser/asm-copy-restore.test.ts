import { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { BUFFERS_STORAGE_KEY, BUFFERS_VERSION, parseBuffers, serializeBuffers } from '../../src/buffers-store'
import { answered, answerTo, recordBuildReplies, replyTo, typeAnswered } from './build-reply-fixture'
import {
  asmPane,
  asmValue,
  hear,
  paneStepText,
  SHELL,
  segments,
  shownNoticeText,
  stateIdle,
  storeFourViews,
  until,
} from './harness'

/**
 * An asm copy survives a reload (Plan 7 part 5 spec §7, amendment 23): stored at `BUFFERS_VERSION` 2 with its leg,
 * and brought back on its own leg, in the view that showed it, with the text last typed into it.
 *
 * A RELOAD IS A FRESH `main` ON THE SAME STORE — `tm-buffer-restore.test.ts`'s mechanism: a cache-busting query
 * string gives a genuinely new module instance, and `localStorage` is left as the first instance wrote it.
 */

let remountSeq = 0
async function mount(): Promise<EditorView> {
  const spec = remountSeq === 0 ? '../../src/main' : `../../src/main?remount=${remountSeq}`
  remountSeq += 1
  document.body.innerHTML = SHELL
  return (await import(/* @vite-ignore */ spec)).ready
}

/** The notices and sentences among `heard` that say a copy did not build. */
const failures = (heard: readonly string[]) => heard.filter((t) => t.startsWith('the copy did not build — '))

const editorText = () => {
  const el = asmPane().querySelector<HTMLElement>('.term-editor')
  return el === null ? null : (EditorView.findFromDOM(el)?.state.doc.toString() ?? null)
}

/** Puts `Worker`'s own `postMessage` back once this file is done: `recordBuildReplies` wraps it for the whole file. */
let unrecord = (): void => undefined
beforeAll(() => {
  unrecord = recordBuildReplies()
})
afterAll(() => unrecord())

describe('restoring an asm copy', () => {
  it('stores it on its leg at version 2, and brings it back in its view with its text', async () => {
    localStorage.clear()
    // ALL FOUR VIEWS: an empty store opens on the source and TM.
    storeFourViews()
    const view = await mount()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(() => !stateIdle(), 'the compile to start')
    await until(stateIdle, 'the compile to finish')
    await until(() => asmPane().querySelector('.asm-row') !== null, 'the program’s listing')
    asmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => editorText() !== null, 'the copy’s editor')
    const typed = 'result Nat\n\n    li\trr, #9\n    halt\n'
    const v = EditorView.findFromDOM(asmPane().querySelector<HTMLElement>('.term-editor') as HTMLElement) as EditorView
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: typed } })
    await until(() => asmValue() === 'value: 9', 'the edit to build')

    const raw = localStorage.getItem(BUFFERS_STORAGE_KEY)
    expect(JSON.parse(raw ?? '{}').version).toBe(BUFFERS_VERSION)
    expect(BUFFERS_VERSION).toBe(2)
    expect(parseBuffers(raw)?.buffers.map((b) => [b.leg, b.text])).toEqual([['asm', typed]])

    await mount()
    await until(() => editorText() === typed, 'the restored copy’s editor')
    await until(() => asmValue() === 'value: 9', 'the restored copy’s value')
    expect(asmPane().textContent).toMatch(/copy · not linked/)
  })

  /**
   * **A STORED COPY THAT DOES NOT BUILD COMES BACK IN ITS EDITOR, MARKED WHERE IT IS WRONG** (spec §8: "Diagnostics in
   * its editor"). A jump to a label that names nothing refuses the whole copy, so its build answers no session, and an
   * editor that came only from a build that landed would leave the view with no editor and no way to get one. The copy
   * is stored by hand, as a page that last saw it would have stored it.
   */
  it('brings back a copy that does not build in its editor, with the label that names nothing marked', async () => {
    localStorage.clear()
    // ALL FOUR VIEWS: an empty store opens on the source and TM.
    storeFourViews()
    const text = 'result Nat\n\n    jmp\tnowhere\n'
    localStorage.setItem(
      BUFFERS_STORAGE_KEY,
      serializeBuffers({
        minted: 1,
        buffers: [{ id: 'scratch-1', label: 'copy 1', text, collapsed: false, leg: 'asm' }],
        bindings: { 'asm-0': 'scratch-1' },
      }),
    )
    await mount()
    await until(() => asmPane().textContent?.includes('copy · not linked') === true, 'the view to show the stored copy')
    await until(() => editorText() === text, 'the stored copy’s editor')
    const mark = () => asmPane().querySelector('.cm-editor .cm-lintRange-error')?.textContent ?? null
    await until(() => mark() === 'nowhere', 'the editor to mark the label that names nothing')
  })

  /**
   * **TEXT TYPED INTO A COPY THAT DOES NOT BUILD IS STORED AS IT IS TYPED.** Its build answers `no-session`, which
   * carries no text and stores nothing (`replies.ts`'s `no-session` arm), so the edit sink stores the edit itself as
   * the build is posted (`transport.ts`'s `editSink`); without that write a reload would bring back the text from
   * before the edit. The wait is on the build's answer, the one fact a failed build leaves
   * (`build-reply-fixture.ts`'s own doc), and that it is `no-session` is this case's precondition.
   */
  it('keeps the text typed into a copy that does not build after a reload', async () => {
    localStorage.clear()
    // ALL FOUR VIEWS: an empty store opens on the source and TM.
    storeFourViews()
    const view = await mount()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(() => !stateIdle(), 'the compile to start')
    await until(stateIdle, 'the compile to finish')
    await until(() => asmPane().querySelector('.asm-row') !== null, 'the program’s listing')
    asmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => editorText() !== null, 'the copy’s editor')
    // NOT THE CASE ABOVE'S TEXT, whose restore was answered `no-session` already: `replyTo` reads the first answer.
    const typed = 'result Nat\n\n    jmp\telsewhere\n'
    const v = EditorView.findFromDOM(asmPane().querySelector<HTMLElement>('.term-editor') as HTMLElement) as EditorView
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: typed } })
    await until(() => replyTo(typed) !== undefined, 'the typed text’s build to be answered')
    expect(replyTo(typed), 'precondition: the typed text does not build').toBe('no-session')

    await mount()
    await until(() => editorText() !== null, 'the restored copy’s editor')
    expect(editorText()).toBe(typed)
  })

  /**
   * **A STORED COPY THAT HAS NEVER BUILT SAYS SO, ON ITS VIEW'S STEP LINE AND ITS READOUT, AND IN ONE NOTICE,
   * UNTIL IT BUILDS.** Its build answers `no-session`, so no frame of it lands, and its leg carries the reason
   * `replies.ts`'s `no-session` arm gives it, `did not build`, where `building…` would say a build is still coming
   * after it has been answered. The page's first build of it is answered with a notice (spec amendment 40); an edit
   * after that shows its diagnostics in the editor alone (amendment 27), counted as `tm-buffer-restore.test.ts`'s
   * never-built cases count it; and the notice ends when a build of the copy lands. The readout reads the focused
   * view's session (Plan 7 part 2 spec §9), so a click in the copy's editor, real input, puts its line there.
   */
  it('reads `did not build` for a stored copy that has never built, says so in one notice, and ends it when it builds', async () => {
    localStorage.clear()
    // ALL FOUR VIEWS: an empty store opens on the source and TM.
    storeFourViews()
    // NOT THE CASES ABOVE'S TEXTS: the build waited for is the first answer to this text after the mount.
    const text = 'result Nat\n\n    jmp\tnowhere_yet\n'
    localStorage.setItem(
      BUFFERS_STORAGE_KEY,
      serializeBuffers({
        minted: 1,
        buffers: [{ id: 'scratch-1', label: 'copy 1', text, collapsed: false, leg: 'asm' }],
        bindings: { 'asm-0': 'scratch-1' },
      }),
    )
    const ears = hear()
    let from = answered.length
    await mount()
    expect(await answerTo(text, from, 'the stored copy’s build'), 'precondition: it does not build').toBe('no-session')
    await until(() => editorText() === text, 'the stored copy’s editor')
    expect(paneStepText(asmPane())).toBe('did not build')

    // NEAR THE EDITOR'S TOP LEFT, as `tm-buffer-restore.test.ts`'s never-built cases click: the centre of an editor's
    // content can lie outside its view.
    const content = asmPane().querySelector('.cm-content') as HTMLElement
    await userEvent.click(content, { position: { x: 4, y: 4 } })
    await until(() => segments().some((s) => s.startsWith('asm copy 1')), 'the readout to read the copy')
    expect(segments()).toEqual(['asm copy 1 · did not build'])
    // THE POINTER LEAVES THE EDITOR, for the reason `tm-buffer-restore.test.ts`'s never-built cases give.
    await userEvent.unhover(content)
    expect(failures(ears.notices), 'the reload’s notice').toHaveLength(1)
    expect(failures(ears.said), 'the reload’s notice, said').toHaveLength(1)

    const view = EditorView.findFromDOM(content) as EditorView
    for (const key of ['y', 'z', 'w']) {
      expect(await typeAnswered(view, key), 'precondition: the edit does not build').toBe('no-session')
    }
    expect(failures(ears.notices), 'no notice for an edit').toHaveLength(1)
    expect(failures(ears.said), 'nothing said for an edit').toHaveLength(1)
    expect(paneStepText(asmPane())).toBe('did not build')

    // A SECOND RELOAD, A FRESH PAGE AND SO A FRESH NOTICE, so that the edit that makes the copy build comes well inside
    // the notice's eight seconds (`tm-buffer-restore.test.ts`'s never-built cases give why). An empty program parses
    // (spec §7's blank copy), so deleting the whole text is an edit that builds.
    from = answered.length
    await mount()
    expect(await answerTo(`${text}yzw`, from, 'the restored copy’s build'), 'precondition: it does not build').toBe(
      'no-session',
    )
    expect(failures(ears.notices), 'one notice from each page').toHaveLength(2)
    await until(() => editorText() === `${text}yzw`, 'the restored copy’s editor')
    const fixed = EditorView.findFromDOM(asmPane().querySelector('.cm-content') as HTMLElement) as EditorView
    fixed.dispatch({ selection: { anchor: 0, head: fixed.state.doc.length } })
    fixed.focus()
    await until(() => fixed.hasFocus, 'the copy’s editor to take the focus')
    expect(shownNoticeText(), 'precondition: the reload’s notice is up').toMatch(/^the copy did not build — /)
    from = answered.length
    await userEvent.keyboard('{Backspace}')
    expect(await answerTo('', from, 'the build of the edit that empties it'), 'precondition: it builds').toBe(
      'asm-scratch-compiled',
    )
    expect(shownNoticeText(), 'the notice ends when the copy builds').toBe('')
    await until(() => paneStepText(asmPane()).startsWith('step 0 of '), 'the step line to read the copy’s run')
    ears.stop()
  })
})
