import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { encodeLink } from '../../src/share-link'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A LINK WITH POSITIONS, OPENED AT START-UP** — Plan 7 part 6a spec §5.3, §5.4 and §5.5, through `main()`'s own path,
 * the one every link clicked from outside the page takes. The link's positions are held for the start-up compile,
 * which `main()` scheduled before the open was said, and not the open; the leg stops short; and the clamp's notice
 * carries the open's `undo`, which puts back what storage would have opened on. The link carries a light program,
 * `let y = 10; y + 5`, whose λ run ends at step 7, long before the link's 100; the stored one is `let x = 40; x + 2`
 * (`setup.ts`). ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

const STORED = 'let x = 40; x + 2'
const LINKED = 'let y = 10; y + 5'

const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
const stepOf = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .step`)?.textContent ?? ''

let view: EditorView

beforeAll(async () => {
  const fragment = await encodeLink({
    program: LINKED,
    encoding: 'unary',
    workspace: serializeWorkspace(defaultWorkspace()),
    positions: { lambda: 100 },
  })
  history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
})

describe('a link with positions at start-up', () => {
  it("clamps the link's λ step to the run's last, and says so with the open's undo", async () => {
    expect(view.state.doc.toString()).toBe(LINKED)
    expect(location.hash).toBe('')
    const said = "the link's λ step 100 is past the end of this run — showing step 7"
    await until(() => noticeText() === said, "the clamp's notice")
    expect(undoButton()?.textContent).toBe('undo')
    expect(stepOf('lambda-0')).toBe('step 7 of 7')
  })

  it('puts back the stored program on that undo', async () => {
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe(STORED)
    expect(noticeText()).toBe('put back the program and the workspace')
  })
})
