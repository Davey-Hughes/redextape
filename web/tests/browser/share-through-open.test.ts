import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { decodeLink, encodeLink, type Positions } from '../../src/share-link'
import { serializeWorkspace } from '../../src/workspace'
import {
  fourViewWorkspace,
  noticeText,
  SHELL,
  shareButton,
  shareLinkField,
  shareMenu,
  shareMenuOpen,
  stateIdle,
  stepTextOf,
  undoButton,
  until,
} from './harness'

/**
 * **`share` THROUGH AN OPEN** — Plan 7 part 6a spec §5.1's note of 2026-10-01, §5.2 and §5.3. `share`'s popover closes
 * when an open applies and when the open's `undo` is used, so `copy link` cannot copy the program either replaced. A
 * link shared while a leg is still going to its link's step carries that step, not the step the leg shows, and one
 * shared after an edit carries no step pending for the program the edit replaced. Each link is pasted into the open
 * page, a `hashchange`. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 *
 * **A CASE HOLDS BACK THE REQUESTS IT NEEDS UNANSWERED**, by wrapping `Worker`'s own `postMessage` before the app mounts:
 * a `run`, so a compile has not answered when the link is shared, or an `extend`, so a leg stays short of its link's
 * step, on a runner of any speed.
 */

/** The kinds of request held back from the session workers, and the posts held. */
let holding: ReadonlySet<string> = new Set()
const held: { readonly kind: unknown; readonly send: () => void }[] = []
const post = Worker.prototype.postMessage
Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]): void {
  const send = () => (post as (...args: unknown[]) => void).apply(this, [message, ...rest])
  const kind = (message as { kind?: unknown } | null)?.kind
  if (typeof kind === 'string' && holding.has(kind)) held.push({ kind, send })
  else send()
}
/** Send each held post on, and hold no more. */
const letGo = (): void => {
  holding = new Set()
  for (const { send } of held.splice(0)) send()
}
const heldOf = (kind: string) => held.filter((h) => h.kind === kind).length

const ENCODINGS = ['unary', 'binary']
const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''

/** A link to `program` under `encoding`, in the four-view workspace, with `positions`. */
const link = (program: string, positions: Positions, encoding = 'unary'): Promise<string> =>
  encodeLink({ program, encoding, workspace: serializeWorkspace(fourViewWorkspace()), positions })

/** Open `share` with a click, and answer once its link is made. */
async function openShare(): Promise<void> {
  if (shareMenuOpen()) shareMenu().hidePopover()
  await userEvent.click(shareButton())
  expect(shareMenuOpen()).toBe(true)
  await until(() => (shareLinkField()?.value ?? '') !== '', 'the link')
}

/**
 * Share, and answer the positions the link carries. **SYNCHRONOUSLY, SO THE POPOVER TAKES ITS PAYLOAD AT THE MOMENT THE
 * CASE HAS JUST CHECKED**: a click that awaits the browser waits behind the frames the page is taking in. What the link
 * carries is the property, not the gesture that asks for it.
 */
async function sharedPositions(): Promise<Positions | null> {
  if (shareMenuOpen()) shareMenu().hidePopover()
  shareButton().click()
  expect(shareMenuOpen()).toBe(true)
  await until(() => (shareLinkField()?.value ?? '') !== '', 'the link')
  const value = shareLinkField()?.value ?? ''
  const opened = await decodeLink(value.slice(value.indexOf('#')), ENCODINGS)
  shareMenu().hidePopover()
  return opened.kind === 'whole' ? opened.positions : null
}

let view: EditorView

beforeAll(async () => {
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => stateIdle() && view.state.doc.toString() === 'let x = 40; x + 2', 'the first compile')
})

describe("share's popover through an open", () => {
  it('closes when a pasted link opens', async () => {
    await openShare()
    location.hash = await link('let y = 10; y + 5', {})
    await until(() => noticeText() === 'opened a shared link', 'the open')
    expect(shareMenuOpen()).toBe(false)
  })

  it("closes when a pasted link's program alone opens", async () => {
    await openShare()
    location.hash = await encodeLink({
      program: 'let z = 3; z + 4',
      encoding: 'unary',
      workspace: 'not a workspace',
      positions: {},
    })
    await until(() => view.state.doc.toString() === 'let z = 3; z + 4', 'the open')
    expect(noticeText()).toBe("opened a shared link's program — its workspace and step positions were left out")
    expect(shareMenuOpen()).toBe(false)
  })

  /**
   * **FROM THE KEYBOARD, BECAUSE A POINTER CANNOT TELL**: a press outside the popover closes it as a light dismiss,
   * before the click it begins reaches `undo`. The focus moving out of it does not close it.
   */
  it("closes when the open's undo is used", async () => {
    location.hash = await link('let y = 10; y + 5', {})
    await until(() => noticeText() === 'opened a shared link', 'the open')
    await openShare()
    undoButton()?.focus()
    expect(document.activeElement).toBe(undoButton())
    expect(shareMenuOpen()).toBe(true)
    await userEvent.keyboard('{Enter}')
    await until(() => noticeText() === 'put back the program and the workspace', 'the undo')
    expect(view.state.doc.toString()).toBe('let z = 3; z + 4')
    expect(shareMenuOpen()).toBe(false)
  })
})

describe("a link shared while its link's positions are being reached", () => {
  it("carries the link's positions while its compile is held, though no leg has its frames", async () => {
    holding = new Set(['run'])
    location.hash = await link('let y = 10; y + 5', { lambda: 5, asm: 3, tm: 100 })
    await until(() => noticeText() === 'opened a shared link' && heldOf('run') === 1, 'the open, its compile held')
    // `toEqual` ON THE POSITIONS THEMSELVES: `toMatchObject` would take `{}` as a subset every positions object has.
    expect(await sharedPositions()).toEqual({ lambda: 5, asm: 3, tm: 100 })
    letGo()
    await until(() => stateIdle(), "the link's compile")
  })

  /**
   * **`fact(4)`'s λ AT 3,000 NEEDS TWO CONTINUES, AND ITS FIRST IS HELD**, so the leg stays short of its step for as
   * long as the case needs, its head below 3,000. Under `binary`, whose TM records fewer steps than `unary`'s.
   */
  it("carries a leg's pending step, not the step it shows", async () => {
    holding = new Set(['extend'])
    location.hash = await link(FACT, { lambda: 3000 }, 'binary')
    await until(() => stepTextOf('lambda-0').includes(' — going to step 3,000 from the link'), 'the pending position')
    const head = Number(/^step ([\d,]+) of/.exec(stepTextOf('lambda-0'))?.[1]?.replaceAll(',', ''))
    expect(head).toBeLessThan(3000)
    expect((await sharedPositions())?.lambda).toBe(3000)
  })

  it('carries no step pending for the program an edit replaced, before its compile answers', async () => {
    holding = new Set(['extend', 'run'])
    expect(stepTextOf('lambda-0')).toContain(' — going to step 3,000 from the link')
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n' } })
    expect(await sharedPositions()).toEqual({})
  })
})
