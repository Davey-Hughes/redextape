import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { FIRST_LOAD } from '../../src/examples'
import { PROGRAM_STORAGE_KEY, parseProgram, type StoredProgram } from '../../src/program-store'
import { noticeEl, noticeElText, picker, retype, SHELL, stateIdle, until } from './harness'
import { stored } from './share-open-hashchange-fixture'

/**
 * **A REFUSED PROGRAM WRITE IS REPORTED ONLY WHILE THE PAGE SHOWS A PROGRAM A RELOAD WOULD NOT RESTORE** — Plan 7 part
 * 6a spec §4.3 and row 17 as §4.3 refines it. Compared with what a reload restores — the last program stored, or the
 * one the page loaded if none has been — a program edited away and back again is not reported as unsaved, since a
 * reload gives back exactly what the page shows; one that still differs keeps being reported.
 *
 * **THE REFUSAL IS ARMED AT MODULE SCOPE, BEFORE `main()` RUNS**, as `program-quota.test.ts` arms its own, and only
 * for the program's key: the page opens on the first-load example with nothing stored, and every write of the program
 * is refused, and recorded, until a test lets one through. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

localStorage.removeItem(PROGRAM_STORAGE_KEY)

/** Whether a write of the program throws, and every program a write was refused for, in order. */
let refuse = true
const refused: StoredProgram[] = []
const passthroughSetItem = localStorage.setItem.bind(localStorage)
localStorage.setItem = (key: string, value: string): void => {
  if (refuse && key === PROGRAM_STORAGE_KEY) {
    const program = parseProgram(value, ['unary', 'binary'])
    if (program !== null) refused.push(program)
    throw new DOMException('quota', 'QuotaExceededError')
  }
  passthroughSetItem(key, value)
}

const PROGRAM_LINE = 'the program is not being saved — this browser’s storage for this site is full'
const A = FIRST_LOAD.text
const B = 'let x = 1;\nx + 1\n'
const C = 'let x = 3;\nx + 1\n'
const D = 'let x = 2;\nx + 1\n'
const lastRefused = (): StoredProgram | undefined => refused.at(-1)

let view: EditorView

/** Put `text` in the editor and wait for its write to be refused — a new refusal, not one recorded before it. */
async function typeRefused(text: string, what: string): Promise<void> {
  const seen = refused.length
  retype(view, text)
  await until(() => refused.length > seen && lastRefused()?.text === text, what)
}

describe('a program write refused by storage, with the program put back', () => {
  it('says nothing while the page shows the program it opened on', async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(() => stateIdle() && lastRefused()?.text === A, 'the first compile’s refused write')
    expect(noticeEl().hidden).toBe(true)
  })

  it('says so once the program differs from what a reload restores', async () => {
    retype(view, B)
    await until(() => noticeElText() === PROGRAM_LINE, 'the resting line')
  })

  it('keeps saying so while it still differs', async () => {
    await typeRefused(C, 'the next write, refused')
    expect(noticeElText()).toBe(PROGRAM_LINE)
  })

  it('takes it back once the page shows what a reload restores again', async () => {
    await typeRefused(A, 'the program put back, refused')
    expect(noticeEl().hidden).toBe(true)
    expect(noticeElText()).toBe('')
  })

  /** THE ENCODING IS HALF OF WHAT A RELOAD RESTORES, so a change of it alone is a change, and putting it back is too. */
  it('counts a change of encoding alone, and takes it back when the encoding is put back', async () => {
    // THE PAGE OPENED UNDER THE DEFAULT ENCODING, so `unary` is the change and `binary` puts it back.
    expect(picker().value, 'precondition: the page is on the encoding it opened under').toBe('binary')
    const seen = refused.length
    await userEvent.selectOptions(picker(), 'unary')
    await until(() => refused.length > seen && lastRefused()?.encoding === 'unary', 'the encoding, refused')
    expect(lastRefused()?.text).toBe(A)
    expect(noticeElText()).toBe(PROGRAM_LINE)
    const back = refused.length
    await userEvent.selectOptions(picker(), 'binary')
    await until(() => refused.length > back && lastRefused()?.encoding === 'binary', 'the encoding put back, refused')
    expect(noticeEl().hidden).toBe(true)
  })

  it('compares with the last program stored, once one has been', async () => {
    refuse = false
    retype(view, D)
    await until(() => stored()?.text === D, 'the program, stored')
    refuse = true
    // THE PROGRAM THE PAGE LOADED IS NOT WHAT A RELOAD RESTORES NOW, SO GOING BACK TO IT IS A CHANGE.
    await typeRefused(A, 'the loaded program, refused')
    expect(noticeElText()).toBe(PROGRAM_LINE)
    await typeRefused(D, 'the stored program, refused')
    expect(noticeEl().hidden).toBe(true)
  })
})
