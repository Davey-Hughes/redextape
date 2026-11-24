import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { PROGRAM_STORAGE_KEY, serializeProgram } from '../../src/program-store'
import { serializeWorkspace } from '../../src/workspace'
import { COPIES_KEY, STORED_COPIES } from './copies-key-removed-fixture'
import { fourViewWorkspace, SHELL, segments, stateIdle, titleOf, until } from './harness'

/**
 * **A RELOAD WITH `redextape.buffers` PRESENT OPENS ON THE PROGRAM, AND THE KEY IS GONE** — the design's G2 and G3.
 * The four views, a program and the copies' value are stored at module scope, before `main()` reads storage once, as
 * a page load that met them would find them. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

const PROGRAM = serializeProgram({ text: 'let x = 40; x + 2', encoding: 'unary' })
localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace(fourViewWorkspace()))
localStorage.setItem(PROGRAM_STORAGE_KEY, PROGRAM)
localStorage.setItem(COPIES_KEY, STORED_COPIES)

beforeAll(async () => {
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => stateIdle() && segments().length > 0, 'the first compile')
})

describe('a page load that finds redextape.buffers', () => {
  it('removes redextape.buffers at start-up and leaves the program’s key', () => {
    expect(localStorage.getItem(COPIES_KEY)).toBeNull()
    expect(localStorage.getItem(PROGRAM_STORAGE_KEY)).toBe(PROGRAM)
  })

  it('opens the views a stored copy was bound to on the program', () => {
    for (const [leaf, binding, name] of [
      ['lambda-0', 'lambda:source', 'λ · program'],
      ['tm-0', 'tm:source', 'TM · program'],
    ] as const) {
      const title = titleOf(leaf)
      expect(title, `${leaf}'s title`).not.toBeNull()
      expect(title?.dataset.binding, `${leaf}'s pair`).toBe(binding)
      expect(title?.textContent?.trim(), `${leaf}'s title`).toBe(name)
      const box = (title as HTMLElement).getBoundingClientRect()
      expect(box.width * box.height, `${leaf}'s title, drawn`).toBeGreaterThan(0)
    }
  })
})
