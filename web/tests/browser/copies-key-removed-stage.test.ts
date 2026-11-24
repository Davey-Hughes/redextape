import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { PRESETS, serializeWorkspace } from '../../src/workspace'
import { COPIES_KEY, STORED_COPIES } from './copies-key-removed-fixture'
import { fourViewWorkspace, SHELL, stageTab, stateIdle, tabLeaves, until } from './harness'

/**
 * **A STAGE WORKSPACE WHOSE TABS A STORED COPY WAS BOUND TO OPENS EVERY TAB ON THE PROGRAM** — the design's G3, on the
 * Stage, where a tab names what its view shows (`stage-tab-titles.test.ts`). The Stage preset's workspace and the
 * copies' value are stored before `main()` reads storage once; its own file for that reason.
 */

localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace({ ...fourViewWorkspace(), switches: PRESETS.stage }))
localStorage.setItem(COPIES_KEY, STORED_COPIES)

beforeAll(async () => {
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
  await until(() => tabLeaves().length === 4, 'the stage’s tabs')
})

describe('a Stage workspace that finds redextape.buffers', () => {
  it('opens every Stage tab on the program', () => {
    const views = tabLeaves().filter((leaf) => leaf !== 'source')
    expect(views).toEqual(expect.arrayContaining(['lambda-0', 'tm-0']))
    for (const leaf of views) {
      expect(stageTab(leaf).textContent, `${leaf}'s tab`).toMatch(/ · program$/)
      const box = stageTab(leaf).getBoundingClientRect()
      expect(box.width * box.height, `${leaf}'s tab, drawn`).toBeGreaterThan(0)
    }
  })

  it('removes redextape.buffers at start-up', () => {
    expect(localStorage.getItem(COPIES_KEY)).toBeNull()
  })
})
