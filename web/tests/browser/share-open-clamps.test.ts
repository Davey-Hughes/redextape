import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { cdp, page } from 'vitest/browser'
import { encodeLink, type Positions } from '../../src/share-link'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **AN OPEN'S CLAMPS, AND A REAL PRESS ON ITS `undo` ACROSS ONE** — Plan 7 part 6a spec §5.5, and §5.4's note of
 * 2026-10-01: a clamp redraws the open's notice with the open's `undo`, and the open's clamps share that one notice,
 * which names every leg stopped short so far; and an edit withdraws the `undo` the clamp's notice carries, as it does
 * the open's. Each link is pasted into the open page, a `hashchange`, and carries a light program, `let y = 10; y + 5`
 * or `let x = 40; x + 2`, whose run ends long before the link's steps, so each position clamps at once. ONE MOUNT FOR
 * THE FILE, for the reason every sibling gives.
 *
 * **THE PRESS IS REAL INPUT, THROUGH CDP**: Chrome dispatches `click` only where the press and the release land on the
 * same element, so a synthetic `.click()`, which has no press, cannot fail the way a user's click did. **AND THE LINK'S
 * COMPILE IS HELD UNTIL THE PRESS IS DOWN**, by wrapping `Worker`'s own `postMessage` before the app mounts, so the
 * clamp cannot redraw the notice before the press on a runner of any speed.
 */

/** Whether a `run` posted to a session worker is held back, and the posts held. */
let holding = false
const held: (() => void)[] = []
const post = Worker.prototype.postMessage
Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]): void {
  const send = () => (post as (...args: unknown[]) => void).apply(this, [message, ...rest])
  if (holding && (message as { kind?: unknown } | null)?.kind === 'run') held.push(send)
  else send()
}
/** Send each held post on, and hold no more. */
const letGo = (): void => {
  holding = false
  for (const send of held.splice(0)) send()
}

/** The program the page opens on, as `setup.ts` stores it. */
const OPENER = 'let x = 40; x + 2'
const LINKED = 'let y = 10; y + 5'

const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
const live = () => document.querySelector('#live')?.textContent ?? ''
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

/** A link to `program` under `unary`, in the default workspace, with `positions`. */
const link = (positions: Positions, program = LINKED): Promise<string> =>
  encodeLink({ program, encoding: 'unary', workspace: serializeWorkspace(defaultWorkspace()), positions })

/** The centre of `el` in the top-level page's CSS pixels, where CDP's input lands: the tests run in a scaled frame. */
function centre(el: HTMLElement): { x: number; y: number } {
  const frame = (window.frameElement as HTMLElement).getBoundingClientRect()
  const scale = frame.width / innerWidth
  const r = el.getBoundingClientRect()
  return { x: frame.left + (r.left + r.width / 2) * scale, y: frame.top + (r.top + r.height / 2) * scale }
}
const mouse = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', at: { x: number; y: number }) =>
  cdp().send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 })
const box = (el: HTMLElement | null) => {
  const r = el?.getBoundingClientRect()
  return [r?.left, r?.top, r?.width, r?.height]
}

let view: EditorView

beforeAll(async () => {
  // A PHONE'S WIDTH, WHERE A CLAMP'S WORDS TAKE MORE LINES THAN THE OPEN'S.
  await page.viewport(390, 844)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && view.state.doc.toString() === OPENER, 'the first compile')
})

describe("an open's clamps", () => {
  it("takes a press on undo, held while a clamp redraws the open's notice, as a click, and undoes the open", async () => {
    holding = true
    location.hash = await link({ lambda: 100 })
    await until(() => noticeText() === 'opened a shared link' && held.length === 1, 'the open, its compile held')
    const button = undoButton() as HTMLButtonElement
    const at = centre(button)
    const before = box(button)
    const words = (document.querySelector('#notice .notice-text') as HTMLElement).getBoundingClientRect().height
    await mouse('mouseMoved', at)
    await mouse('mousePressed', at)
    // THE PRESS IS DOWN ON THE OPEN'S OWN NOTICE: nothing can have redrawn it, with the compile not yet posted.
    expect(noticeText()).toBe('opened a shared link')
    letGo()
    await until(() => noticeText().startsWith("the link's λ step 100 "), "the clamp's notice")
    // THE CLAMP'S WORDS TAKE MORE LINES, AND THE BUTTON HAS NOT MOVED.
    expect(
      (document.querySelector('#notice .notice-text') as HTMLElement).getBoundingClientRect().height,
    ).toBeGreaterThan(words)
    expect(box(undoButton())).toEqual(before)
    await mouse('mouseReleased', at)
    await until(() => noticeText() === 'put back the program and the workspace', 'the undo')
    expect(view.state.doc.toString()).toBe(OPENER)
  })

  it('names every leg the run ended short of in one notice, with the open’s undo, and says it', async () => {
    location.hash = await link({ lambda: 100, asm: 100 })
    await until(() => noticeText().includes('asm step 100'), 'the second clamp')
    const said = "the link's λ step 100 and asm step 100 are past the end of this run — showing λ step 7 and asm step 5"
    expect(noticeText()).toBe(said)
    expect(live().trimEnd()).toBe(said)
    expect(undoButton()?.textContent).toBe('undo')
  })

  /**
   * **THE `undo` GOES WITH THE NOTICE CARRYING IT NOW, NOT THE OPEN'S** (spec §5.5): the clamp's notice replaced the
   * open's, so withdrawing the offer from the open's notice alone would leave a live `undo` on the line, and using it
   * would put back the whole document over the edit. A link to the page's first program, so this open changes the
   * program the case above left.
   */
  it("withdraws the clamp's undo at the next edit that changes the program", async () => {
    expect(view.state.doc.toString()).toBe(LINKED)
    location.hash = await link({ lambda: 100 }, OPENER)
    const said = "the link's λ step 100 is past the end of this run — showing step 7"
    await until(() => noticeText() === said, "the clamp's notice")
    expect(view.state.doc.toString()).toBe(OPENER)
    expect(undoButton()?.textContent).toBe('undo')
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n' } })
    expect(undoButton()).toBeNull()
  })
})
