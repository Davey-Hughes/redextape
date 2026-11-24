import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { PROGRAM_STORAGE_KEY } from '../../src/program-store'
import { noticeEl, noticeElText, rect, SHELL, stateIdle, until } from './harness'

/**
 * **A REFUSED PROGRAM WRITE IS REPORTED ONLY WHILE THE PROGRAM DIFFERS FROM WHAT A RELOAD WOULD RESTORE** — Plan 7 part
 * 6a spec §4.3 and row 17 as §4.3 refines it: the last program a write stored, or the one loaded while none has been.
 * A visitor on blocked storage who only looks at the first-load example is told nothing; one who edits it is told from
 * that edit's write on, on the notice line's resting state. A program edited away and back is
 * `program-quota-return.test.ts`'s.
 *
 * **THE REFUSAL IS ARMED AT MODULE SCOPE, BEFORE `main()` RUNS**, so the start-up compile's write is the first one
 * refused. The program `setup.ts` stores is removed, so the page opens on the first-load example as a first visit
 * does. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

localStorage.removeItem(PROGRAM_STORAGE_KEY)

/** Whether a write of the program throws, what it throws, and how many have. */
let refuse = true
let thrown = 'QuotaExceededError'
let refused = 0
const passthroughSetItem = localStorage.setItem.bind(localStorage)
localStorage.setItem = (key: string, value: string): void => {
  if (refuse && key === PROGRAM_STORAGE_KEY) {
    refused += 1
    throw new DOMException('refused', thrown)
  }
  passthroughSetItem(key, value)
}

const PROGRAM_LINE = 'the program is not being saved — this browser’s storage for this site is full'

/**
 * EVERY SENTENCE THE LIVE REGION CARRIES ABOUT STORAGE, IN ORDER, from the mount on: a single read of `#live` holds
 * only the latest sentence, which anything said after the one under test would hide.
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
    await until(stateIdle, 'the first compile')
    // THE WRITE UNDER TEST HAPPENED, AND WAS REFUSED: silence after no write would prove nothing.
    expect(refused).toBeGreaterThan(0)
    expect(noticeEl().hidden).toBe(true)
    expect(saidAboutStorage()).toEqual([])
  })

  it('says the program is not being saved once an edit is refused', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 1;\nx + 1\n' } })
    await until(() => noticeElText() === PROGRAM_LINE, 'the resting line')
    expect(noticeEl().hidden).toBe(false)
    // SAID IN THE LIVE REGION, ONCE, AS WELL AS SHOWN.
    expect(saidAboutStorage()).toEqual([PROGRAM_LINE])
  })

  it('takes it back once a write of the program goes through', async () => {
    refuse = false
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 2;\nx + 1\n' } })
    await until(() => noticeEl().hidden === true, 'the resting line to go')
    expect(noticeElText()).toBe('')
  })
})

/**
 * **HIDDEN FROM THE KEYBOARD, THE SENTENCE HANDS THE FOCUS TO `settings`**: `hide` names no control of its own, so the
 * focus goes where the notice line sends it, a header control drawn at every width. A sentence once hidden stays off
 * the line, so the narrow window is given the other refusal's sentence to hide.
 */
describe('a resting storage sentence hidden from the keyboard', () => {
  it.each([
    { width: 1280, height: 800, error: 'QuotaExceededError', why: 'full', program: 'let x = 3;\nx + 1\n' },
    { width: 390, height: 844, error: 'SecurityError', why: 'blocked', program: 'let x = 4;\nx + 1\n' },
  ])(
    'puts the focus on settings when the storage sentence is hidden from the keyboard, at $width px',
    async ({ width, height, error, why, program }) => {
      await page.viewport(width, height)
      refuse = true
      thrown = error
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: program } })
      const line = `the program is not being saved — this browser’s storage for this site is ${why}`
      await until(() => noticeElText() === line, 'the resting line')
      const hide = noticeEl().querySelector<HTMLElement>('button.notice-action') as HTMLElement
      expect(hide?.textContent, 'precondition: the resting line offers hide').toBe('hide')
      document.querySelector<HTMLElement>('#workspace')?.focus()
      for (let i = 0; i < 40 && document.activeElement !== hide; i++) await userEvent.tab()
      expect(document.activeElement, 'precondition: Tab reaches hide').toBe(hide)
      await userEvent.keyboard('{Enter}')
      expect(noticeEl().hidden, 'the line is put away').toBe(true)
      const settings = document.querySelector('#settings') as HTMLElement
      expect(document.activeElement).toBe(settings)
      expect(rect(settings).width, 'settings is drawn').toBeGreaterThan(0)
      expect(rect(settings).height, 'settings is drawn').toBeGreaterThan(0)
    },
  )
})
