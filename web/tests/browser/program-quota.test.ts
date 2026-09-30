import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from '../../src/buffers-store'
import { PROGRAM_STORAGE_KEY } from '../../src/program-store'
import { SHELL, until } from './harness'

/**
 * **A REFUSED PROGRAM WRITE IS REPORTED ONLY WHILE THE PROGRAM DIFFERS FROM WHAT A RELOAD WOULD RESTORE** — Plan 7 part
 * 6a spec §4.3 and row 17 as §4.3 refines it: the last program a write stored, or the one loaded while none has been.
 * A visitor on blocked storage who only looks at the first-load example is told nothing; one who edits it is told from
 * that edit's write on, on the notice line's resting state, which the copies' writer shares. A program edited away and
 * back is `program-quota-return.test.ts`'s.
 *
 * **THE REFUSAL IS ARMED AT MODULE SCOPE, BEFORE `main()` RUNS**, as `buffers-quota-empty.test.ts` arms its own, so
 * the start-up compile's write is the first one refused. The program `setup.ts` stores is removed, so the page opens
 * on the first-load example as a first visit does; and a copy is stored, bound to the λ view, so that a write of the
 * copies that goes through can be seen to leave the program's half of the line alone. ONE MOUNT FOR THE FILE, for the
 * reason every sibling gives.
 */

localStorage.removeItem(PROGRAM_STORAGE_KEY)
localStorage.setItem(
  BUFFERS_STORAGE_KEY,
  serializeBuffers({
    minted: 1,
    buffers: [{ id: 'scratch-1', label: 'copy 1', text: '(λx. x) (λy. y)', collapsed: false, leg: 'lambda' }],
    bindings: { 'lambda-0': 'scratch-1' },
  }),
)

/** Whether a write of the program throws, and how many have. */
let refuse = true
let refused = 0
const passthroughSetItem = localStorage.setItem.bind(localStorage)
localStorage.setItem = (key: string, value: string): void => {
  if (refuse && key === PROGRAM_STORAGE_KEY) {
    refused += 1
    throw new DOMException('quota', 'QuotaExceededError')
  }
  passthroughSetItem(key, value)
}

const PROGRAM_LINE = 'the program is not being saved — this browser’s storage for this site is full'
const notice = () => document.querySelector<HTMLElement>('#notice') as HTMLElement
const noticeText = () => notice().querySelector('.notice-text')?.textContent ?? ''
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const copyEditor = (): EditorView | null => {
  const el = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor')
  return el === null ? null : EditorView.findFromDOM(el)
}

/**
 * EVERY SENTENCE THE LIVE REGION CARRIES ABOUT STORAGE, IN ORDER, from the mount on — as `buffers-quota.test.ts`
 * records its own: a single read of `#live` holds only the latest sentence, which anything said after the one under
 * test would hide.
 */
const said: string[] = []
const saidAboutStorage = () => said.filter((t) => t.includes('not being saved'))

let view: EditorView

describe('a program write refused by storage', () => {
  it('says nothing while the page shows the program it loaded', async () => {
    document.body.innerHTML = SHELL
    const live = document.querySelector('#live') as HTMLElement
    new MutationObserver(() => said.push(live.textContent?.trim() ?? '')).observe(live, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    view = await (await import('../../src/main')).ready
    await until(() => idle() && copyEditor() !== null, 'the first compile and the copy')
    // THE WRITE UNDER TEST HAPPENED, AND WAS REFUSED: silence after no write would prove nothing.
    expect(refused).toBeGreaterThan(0)
    expect(notice().hidden).toBe(true)
    expect(saidAboutStorage()).toEqual([])
  })

  it('says the program is not being saved once an edit is refused', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 1;\nx + 1\n' } })
    await until(() => noticeText() === PROGRAM_LINE, 'the resting line')
    expect(notice().hidden).toBe(false)
    // SAID IN THE LIVE REGION, ONCE, AS WELL AS SHOWN.
    expect(saidAboutStorage()).toEqual([PROGRAM_LINE])
  })

  it('keeps saying so when a write of the copies goes through', async () => {
    const copy = copyEditor()
    if (copy === null) throw new Error('no copy editor')
    const edited = '(λz. z) (λy. y)'
    copy.dispatch({ changes: { from: 0, to: copy.state.doc.length, insert: edited } })
    await until(
      () => parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))?.buffers[0]?.text === edited,
      'the copy, stored',
    )
    expect(noticeText()).toBe(PROGRAM_LINE)
  })

  it('takes it back once a write of the program goes through', async () => {
    refuse = false
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 2;\nx + 1\n' } })
    await until(() => notice().hidden === true, 'the resting line to go')
    expect(noticeText()).toBe('')
  })
})
