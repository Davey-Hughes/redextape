import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY, BUFFERS_VERSION, parseBuffers, serializeBuffers } from '../../src/buffers-store'
import { SHELL, until } from './harness'

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

const asm = () => document.querySelector<HTMLElement>('.pane[data-leaf="asm-0"]') as HTMLElement
const editorText = () => {
  const el = asm().querySelector<HTMLElement>('.term-editor')
  return el === null ? null : (EditorView.findFromDOM(el)?.state.doc.toString() ?? null)
}
const value = () => asm().querySelector('.asm-value')?.textContent ?? ''
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

describe('restoring an asm copy', () => {
  it('stores it on its leg at version 2, and brings it back in its view with its text', async () => {
    localStorage.clear()
    const view = await mount()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(() => !idle(), 'the compile to start')
    await until(idle, 'the compile to finish')
    await until(() => asm().querySelector('.asm-row') !== null, 'the program’s listing')
    asm().querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => editorText() !== null, 'the copy’s editor')
    const typed = 'result Nat\n\n    li\trr, #9\n    halt\n'
    const v = EditorView.findFromDOM(asm().querySelector<HTMLElement>('.term-editor') as HTMLElement) as EditorView
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: typed } })
    await until(() => value() === 'value: 9', 'the edit to build')

    const raw = localStorage.getItem(BUFFERS_STORAGE_KEY)
    expect(JSON.parse(raw ?? '{}').version).toBe(BUFFERS_VERSION)
    expect(BUFFERS_VERSION).toBe(2)
    expect(parseBuffers(raw)?.buffers.map((b) => [b.leg, b.text])).toEqual([['asm', typed]])

    await mount()
    await until(() => editorText() === typed, 'the restored copy’s editor')
    await until(() => value() === 'value: 9', 'the restored copy’s value')
    expect(asm().textContent).toMatch(/copy · not linked/)
  })

  /**
   * **A STORED COPY THAT DOES NOT BUILD COMES BACK IN ITS EDITOR, MARKED WHERE IT IS WRONG** (spec §8: "Diagnostics in
   * its editor"). A jump to a label that names nothing refuses the whole copy, so its build answers no session, and
   * the editor used to come only from a build that landed — the view read `building…` with no editor and no way to
   * get one. The copy is stored by hand, as a page that last saw it would have stored it.
   */
  it('brings back a copy that does not build in its editor, with the label that names nothing marked', async () => {
    localStorage.clear()
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
    await until(() => asm().textContent?.includes('copy · not linked') === true, 'the view to show the stored copy')
    await until(() => editorText() === text, 'the stored copy’s editor')
    const mark = () => asm().querySelector('.cm-editor .cm-lintRange-error')?.textContent ?? null
    await until(() => mark() === 'nowhere', 'the editor to mark the label that names nothing')
  })
})
