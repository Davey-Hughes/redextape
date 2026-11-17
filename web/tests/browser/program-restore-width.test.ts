import { describe, expect, it } from 'vitest'
import { PROGRAM_STORAGE_KEY, serializeProgram } from '../../src/program-store'
import { enterWidth, SHELL, segments, stateIdle, until, widthShown } from './harness'

/**
 * **A STORED WIDTH COMES BACK WITH ITS PROGRAM, AND AUTO IS STORED WITH NO `width` KEY** (the TM width design,
 * decisions 6 and 14). The program is stored at module scope, before `main()` runs, as a previous page load
 * would have stored it, over the one `setup.ts` stores for every file. `2 + 3` under binary fits a 4-cell field, so
 * auto runs it at 4, and only the stored width puts it at 8. ONE MOUNT FOR THE FILE, for the reason `app.test.ts`
 * gives.
 */

const STORED = { text: 'let x = 2; x + 3', encoding: 'binary', width: 8 }
localStorage.setItem(PROGRAM_STORAGE_KEY, serializeProgram(STORED))

/** The TM leg's segment of the results strip. */
const tmSegment = () => segments()[2] ?? ''
/** What storage holds for the program, as its JSON: the payload itself, not `parseProgram`'s reading of it. */
const storedPayload = (): Record<string, unknown> => JSON.parse(localStorage.getItem(PROGRAM_STORAGE_KEY) ?? 'null')

describe('a program stored at a width', () => {
  it('opens at that width: the select shows it, and the TM runs at it', async () => {
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(() => stateIdle() && segments().length > 0, 'the first compile')
    expect(widthShown()).toBe('8')
    expect(tmSegment()).toMatch(/^TM 5 · [\d,]+ transitions · width 8 \(pinned\)$/)
  })

  it('is stored with no width once auto is chosen, and runs at the width auto fits', async () => {
    expect(storedPayload(), 'precondition: the start-up compile stored the width').toEqual({ version: 1, ...STORED })
    await enterWidth('auto')
    await until(() => stateIdle() && !('width' in storedPayload()), 'auto, stored')
    expect(Object.keys(storedPayload())).toEqual(['version', 'text', 'encoding'])
    expect(tmSegment()).toMatch(/^TM 5 · [\d,]+ transitions · width 4$/)
  })
})
