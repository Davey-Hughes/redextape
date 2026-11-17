import { describe, expect, it } from 'vitest'
import { PROGRAM_STORAGE_KEY } from '../../src/program-store'
import { enterWidth, noticeEl, noticeElText, SHELL, stateIdle, until } from './harness'

/**
 * **A WIDTH IS PART OF WHAT A RELOAD WOULD RESTORE**, so a refused write is reported once the width alone differs from
 * the stored one, and taken back once it is the stored one again (Plan 7 part 6a spec §4.3's rule, which
 * `program-quota.test.ts` holds for an edit; the TM width design, decision 6). The refusal is armed at module scope,
 * before `main()` runs, so every write of the program is refused. The page opens on the program `setup.ts` stores,
 * at auto. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

let refused = 0
const passthroughSetItem = localStorage.setItem.bind(localStorage)
localStorage.setItem = (key: string, value: string): void => {
  if (key === PROGRAM_STORAGE_KEY) {
    refused += 1
    throw new DOMException('quota', 'QuotaExceededError')
  }
  passthroughSetItem(key, value)
}

const PROGRAM_LINE = 'the program is not being saved — this browser’s storage for this site is full'

describe('a program write refused by storage, with only the width changed', () => {
  it('says nothing while the page shows the program it loaded', async () => {
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(() => stateIdle() && refused > 0, 'the first compile’s refused write')
    expect(noticeEl().hidden).toBe(true)
  })

  it('says the program is not being saved once a width is chosen', async () => {
    const before = refused
    await enterWidth('16')
    await until(() => refused > before, 'the write at width 16')
    expect(noticeElText()).toBe(PROGRAM_LINE)
  })

  it('takes it back once auto, the stored width, is chosen again', async () => {
    const before = refused
    await enterWidth('auto')
    await until(() => refused > before, 'the write at auto')
    expect(noticeEl().hidden).toBe(true)
  })
})
