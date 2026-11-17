import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { PROGRAM_STORAGE_KEY, serializeProgram } from '../../src/program-store'
import { encodeLink, type SharePayload } from '../../src/share-link'
import { PRESETS, serializeWorkspace } from '../../src/workspace'
import {
  enterWidth,
  fourViewWorkspace,
  noticeText,
  SHELL,
  stateIdle,
  tmStatus,
  undoButton,
  until,
  widthShown,
} from './harness'

/**
 * **A LINK'S WIDTH IS ITS OWN, NEVER THE PAGE'S** (the TM width design, decision 22): a link with no width opens at
 * auto however the program it replaces was pinned, since its positions are steps of the auto run, and a link that opens
 * its program alone still opens it at the width it carries. Each case opens a link over a page pinned at another
 * width, where falling back to the page's width, the way a missing encoding falls back, shows as a different number:
 * every link here is read on the three paths in, start-up, a whole link pasted and a program-only link pasted.
 *
 * Storage holds a program pinned at 16 before the page mounts, as a previous page load would have stored it. Every
 * program is under `binary`, where auto fits `2 + 3` at 4 and `20 + 5` at 8, so a TM line at 16 or 32 is a pinned
 * width that leaked. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

const WORKSPACE = serializeWorkspace({ ...fourViewWorkspace(), switches: PRESETS.debugger })
/** A whole link with no width, opened at start-up over the stored program pinned at 16. */
const AT_START: SharePayload = { program: 'let x = 2; x + 3', encoding: 'binary', workspace: WORKSPACE, positions: {} }
/** A whole link with no width, pasted while the page is pinned at 16. */
const PASTED_AUTO: SharePayload = { ...AT_START, program: 'let y = 20; y + 5' }
/** A whole link whose undo a width chosen withdraws. */
const OFFERING: SharePayload = { ...AT_START, program: 'let z = 3; z + 4', width: 4 }
/** A link whose workspace `parseWorkspace` refuses, so its program opens alone, at the width it carries. */
const ALONE: SharePayload = { ...AT_START, program: 'let w = 6; w + 1', width: 16, workspace: '{}' }

/** The width the TM view's own line names: the program's, at whatever step it is on. */
const tmWidth = () => /· width (\d+)$/.exec(tmStatus())?.[1]
/** `link` pasted on the open page, heard as `hashchange`: `openLink`'s path in, not start-up's. */
async function paste(link: SharePayload): Promise<void> {
  location.hash = await encodeLink(link)
  await until(() => view.state.doc.toString() === link.program, 'the pasted link')
}

let view: EditorView

beforeAll(async () => {
  localStorage.setItem(
    PROGRAM_STORAGE_KEY,
    serializeProgram({ text: 'let x = 40; x + 2', encoding: 'binary', width: 16 }),
  )
  history.replaceState(null, '', `${location.pathname}${location.search}${await encodeLink(AT_START)}`)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => stateIdle() && tmWidth() !== undefined, 'the first compile')
})

describe('a link’s width is its own', () => {
  it('a link with no width, opened at start-up, opens at auto over a program stored pinned', () => {
    expect(view.state.doc.toString(), 'precondition: the link opened').toBe(AT_START.program)
    expect(widthShown()).toBe('auto')
    expect(tmWidth()).toBe('4')
  })

  it('a link with no width, pasted while the page is pinned, opens at auto', async () => {
    await enterWidth('16')
    await until(() => stateIdle() && tmWidth() === '16', 'the compile at 16')
    await paste(PASTED_AUTO)
    expect(widthShown()).toBe('auto')
    await until(() => stateIdle() && tmWidth() === '8', 'the link’s compile at auto')
  })

  /**
   * **A WIDTH CHOSEN WITHDRAWS A LINK'S UNDO**, as an encoding chosen does: the undo puts back the program as it ran
   * when the link opened, and the width chosen since changes that run. Read at the gesture, not after its compile, so
   * the notice's own timeout cannot clear it first.
   */
  it('a width chosen withdraws the undo of the link before it', async () => {
    await paste(OFFERING)
    expect(undoButton()?.textContent, 'precondition: the open offers its undo').toBe('undo')
    await enterWidth('32')
    expect(undoButton()).toBeNull()
    expect(noticeText()).toBe('')
    await until(() => stateIdle() && tmWidth() === '32', 'the compile at 32')
  })

  it('a link that opens its program alone opens it at the width it carries', async () => {
    expect(widthShown(), 'precondition: the page is pinned at another width').toBe('32')
    await paste(ALONE)
    expect(noticeText(), 'precondition: the program opened alone').toBe(
      "opened a shared link's program — its workspace and step positions were left out",
    )
    expect(widthShown()).toBe('16')
    await until(() => stateIdle() && tmWidth() === '16', 'the link’s compile at 16')
  })
})
