import { beforeAll, describe } from 'vitest'
import { page } from 'vitest/browser'
import { encodeLink } from '../../src/share-link'
import { serializeWorkspace } from '../../src/workspace'
import { SHELL, stateIdle, until } from './harness'
import { holdsOldPanels, oldPanels } from './stored-old-panels-fixture'

/**
 * **A SHARE LINK THAT HOLDS STATE FOR THE TEXT AND OUTLINE PANELS OPENS** — the design's *Checks*, its G3. The link is
 * in the address before `main.ts` is imported, as `share-open-deep.test.ts` puts its own, so the page starts on it;
 * its workspace and what each view must come back with are `stored-old-panels-fixture.ts`'s, which
 * `stored-old-panels.test.ts` stores.
 */

const { workspace, own } = oldPanels()

beforeAll(async () => {
  // TALL ENOUGH FOR EACH VIEW'S PAIR TO TAKE ITS SHARES OVER ITS FLOORS: in a TM view the tapes keep their own height
  // above the rules and the state diagram, and the rules a floor of their own, so a shorter view holds the rules on it.
  await page.viewport(1280, 1600)
  const fragment = await encodeLink({
    program: 'let y = 1; y + 2',
    encoding: 'unary',
    workspace: serializeWorkspace(workspace),
    positions: {},
  })
  history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
  // THE OPEN CLEARS THE FRAGMENT WHATEVER THE LINK HELD: a link whose workspace was refused opens the program alone,
  // the page keeps the workspace it had, and the cases below fail on it.
  await until(() => location.hash === '', 'the link to be read')
  await document.fonts.ready
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
})

describe('a share link holding state for the text and outline panels', () => {
  holdsOldPanels(own)
})
