import { beforeAll, describe } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { serializeWorkspace } from '../../src/workspace'
import { SHELL, stateIdle, until } from './harness'
import { holdsOldPanels, oldPanels } from './stored-old-panels-fixture'

/**
 * **A STORED WORKSPACE THAT HOLDS STATE FOR THE TEXT AND OUTLINE PANELS LOADS** — the design's *Checks*, its G3. The
 * workspace is stored before `main.ts` is imported, as `stored-panels-restore.test.ts` stores its own, because
 * `main()` reads storage once; what it holds and what each view must come back with are
 * `stored-old-panels-fixture.ts`'s, which `stored-old-panels-link.test.ts` opens as a share link.
 */

const { workspace, own } = oldPanels()

beforeAll(async () => {
  // TALL ENOUGH FOR EACH VIEW'S PAIR TO TAKE ITS SHARES OVER ITS FLOORS: in a TM view the tapes keep their own height
  // above the rules and the state diagram, and the rules a floor of their own, so a shorter view holds the rules on it.
  await page.viewport(1280, 1600)
  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace(workspace))
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
  // THE PAGE'S FONTS FIRST: a region's floor is lines of text, which settle as the fonts arrive.
  await document.fonts.ready
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
})

describe('a stored workspace holding state for the text and outline panels', () => {
  holdsOldPanels(own)
})
