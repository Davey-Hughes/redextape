import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import type { LayoutNode } from '../../src/layout'
import { encodeLink, type Positions } from '../../src/share-link'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { live, mounted, noticeText, SHELL, sourceBeside, stateIdle, stepTextOf, undoButton, until } from './harness'

/**
 * **A CLAMP IS SAID ONLY OF A LEG THE PAGE HAS A VIEW OF** — Plan 7 part 6a spec §5.4, on a page of the view layouts,
 * which need not show every leg. A link carries a step for each leg with frames, whichever views its page showed, and
 * a clamp's notice ends *showing step …*: said of a leg with no view, it named a step nothing on the page shows
 * (`main.ts`'s `positions` has what was measured). Each link is pasted into the open page, a `hashchange`, and carries
 * a light program under `unary`, whose run ends long before the link's steps, so every position clamps.
 *
 * **A CASE THAT EXPECTS NO WORD OF A CLAMP WAITS UNTIL THE CLAMP HAS HAPPENED.** The legs stop in the order λ, asm, TM
 * (`share-positions.ts`), so a later leg's notice says the earlier ones have stopped; and where no notice is due, the
 * link's run is over once the readout shows its value, which is why each link's program has another value than the
 * one before it.
 */

/** The program the page opens on, as `setup.ts` stores it, and its value. */
const OPENER = 'let x = 40; x + 2'
const OTHER = 'let y = 10; y + 5'

/** Whether the run of the program on the page is over with `value`: every leg has stopped by then. */
const runOver = (value: number): boolean =>
  stateIdle() && (document.querySelector('#results')?.textContent ?? '').includes(`λ ${value}`)

/** A link to `program` whose workspace shows `tree`, with `positions`. */
const link = (program: string, tree: LayoutNode, positions: Positions): Promise<string> =>
  encodeLink({
    program,
    encoding: 'unary',
    workspace: serializeWorkspace({ ...defaultWorkspace('wide'), tree, focused: 'source' }),
    positions,
  })

let view: EditorView

beforeAll(async () => {
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => runOver(42) && view.state.doc.toString() === OPENER, 'the first compile')
})

describe('a clamp of a leg no view shows', () => {
  it('says the TM leg’s clamp alone on a page of the source and TM views, in one leg’s words', async () => {
    location.hash = await link(OPENER, sourceBeside('tm-0', 'tm'), { lambda: 100, asm: 100, tm: 1_000_000 })
    // THE TM LEG STOPS LAST: its notice is on the line once the λ and asm legs have stopped, unsaid.
    await until(() => noticeText().includes('TM step'), 'the TM leg’s clamp')
    expect(mounted(), 'precondition: the page shows the source and TM views').toEqual(['source', 'tm-0'])
    const said = "the link's TM step 1,000,000 is past the end of this run — showing step 2,870"
    expect(noticeText()).toBe(said)
    expect(live()).toBe(said)
    expect(undoButton()?.textContent, 'the clamp’s notice lost the open’s undo').toBe('undo')
    expect(stepTextOf('tm-0'), 'the TM view is not on the step the notice names').toBe('step 2,870 of 2,870')
  })

  it('says nothing of clamps where no clamped leg has a view, and keeps the open’s notice and its undo', async () => {
    expect(runOver(15), 'precondition: the page is not on the link’s value already').toBe(false)
    location.hash = await link(OTHER, sourceBeside('tm-0', 'tm'), { lambda: 100, asm: 100 })
    await until(
      () => view.state.doc.toString() === OTHER && runOver(15),
      'the link’s run to be over, both legs stopped',
    )
    expect(mounted()).toEqual(['source', 'tm-0'])
    expect(noticeText(), 'a clamp was said of a leg no view shows').toBe('opened a shared link')
    expect(undoButton()?.textContent).toBe('undo')
  })

  /**
   * THE λ LEG STOPS FIRST AND HAS A VIEW; THE asm LEG STOPS AFTER IT AND HAS NONE. The live region is written once
   * for each thing said, so its writes are counted: the asm leg's clamp, said again with the λ leg's words, would be
   * a second one.
   */
  it('says the λ leg’s clamp once on a page of the source and λ views, and not again when the asm leg stops', async () => {
    const writes: string[] = []
    const region = document.querySelector('#live') as HTMLElement
    const watch = new MutationObserver(() => writes.push((region.textContent ?? '').trimEnd()))
    watch.observe(region, { childList: true, characterData: true, subtree: true })
    try {
      // ANOTHER PROGRAM THAN THE LINK'S, WHATEVER THE CASE BEFORE LEFT: typed where the page is not on it already,
      // as it is after the case above and is not where this one runs alone.
      if (view.state.doc.toString() !== OTHER)
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: OTHER } })
      await until(() => runOver(15), 'the other program’s run to be over')
      writes.length = 0
      expect(runOver(42), 'precondition: the page is not on the link’s value already').toBe(false)
      location.hash = await link(OPENER, sourceBeside('lambda-0', 'lambda'), { lambda: 100, asm: 100 })
      const said = "the link's λ step 100 is past the end of this run — showing step 7"
      await until(() => noticeText() === said, 'the λ leg’s clamp')
      await until(() => runOver(42), 'the link’s run to be over, the asm leg stopped')
      // A FRAME MORE, FOR THE OBSERVER: its records are delivered after the script that wrote them.
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      expect(mounted(), 'precondition: the page shows the source and λ views').toEqual(['source', 'lambda-0'])
      expect(noticeText()).toBe(said)
      expect(
        writes.filter((text) => text === said),
        'the λ leg’s clamp was said again',
      ).toHaveLength(1)
      expect(stepTextOf('lambda-0')).toBe('step 7 of 7')
    } finally {
      watch.disconnect()
    }
  })
})
