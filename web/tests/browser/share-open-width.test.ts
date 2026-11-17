import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { fieldWidths } from '../../../pkg/redextape_wasm.js'
import { decodeLink, encodeLink, type SharePayload } from '../../src/share-link'
import { PRESETS, serializeWorkspace } from '../../src/workspace'
import {
  fourViewWorkspace,
  picker,
  SHELL,
  shareButton,
  shareLinkField,
  shareMenu,
  shareMenuOpen,
  stateIdle,
  tmStatus,
  undoButton,
  until,
  widthShown,
  workspaceNameText,
} from './harness'

/**
 * **A LINK CARRYING A WIDTH OPENS AT IT, AND THE LINK THE PAGE THEN SHARES CARRIES IT** (the TM width design,
 * decisions 6 and 16): a link's TM position is a step of one run, and the same program at another width is another
 * run. The page is `setup.ts`'s, `let x = 40; x + 2` under `unary` at auto, in Explorer. The link carries
 * `let y = 20; y + 5` under `binary` at width 4, with the Debugger preset's workspace: 25 outgrows a 4-cell field and
 * auto fits it at 8, so the TM's own line tells the link's width from auto. ONE MOUNT FOR THE FILE, for the reason
 * `app.test.ts` gives.
 */

const LINKED = 'let y = 20; y + 5'
const LINK: SharePayload = {
  program: LINKED,
  encoding: 'binary',
  width: 4,
  workspace: serializeWorkspace({ ...fourViewWorkspace(), switches: PRESETS.debugger }),
  positions: {},
}

/** The width the TM view's own line names: the program's, at whatever step it is on. */
const tmWidth = () => /· width (\d+)$/.exec(tmStatus())?.[1]

let view: EditorView

beforeAll(async () => {
  history.replaceState(null, '', `${location.pathname}${location.search}${await encodeLink(LINK)}`)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => stateIdle() && tmWidth() !== undefined, 'the first compile')
})

describe('a link carrying a width', () => {
  it('opens its program at that width, with its workspace', () => {
    expect(location.hash).toBe('')
    expect(view.state.doc.toString()).toBe(LINKED)
    expect(picker().value).toBe('binary')
    expect(workspaceNameText()).toBe('Debugger ▾')
    expect(widthShown()).toBe('4')
    expect(tmWidth()).toBe('4')
  })

  /** Read with the click a user makes on `share`, and decoded as a reader's page would decode it. */
  it('is shared on at that width', async () => {
    await userEvent.click(shareButton())
    expect(shareMenuOpen()).toBe(true)
    await until(() => shareLinkField().value !== '', 'the link')
    const value = shareLinkField().value
    const opened = await decodeLink(
      value.slice(value.indexOf('#')),
      [...picker().options].map((o) => o.value),
      fieldWidths() as number[],
    )
    shareMenu().hidePopover()
    expect(opened).toMatchObject({ kind: 'whole', program: LINKED, encoding: 'binary', width: 4 })
  })

  it('puts back the width it replaced, auto, on undo', async () => {
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
    expect(widthShown()).toBe('auto')
    await until(() => stateIdle() && tmWidth() !== '4', 'the program’s compile')
    // UNARY HOLDS A VALUE BELOW ITS WIDTH, so auto fits 42 at 64.
    expect(tmWidth()).toBe('64')
  })

  /** Pasted on the open page, heard as `hashchange`, the link takes the other path in: `openLink`, not start-up. */
  it('opens at its width when pasted on the open page', async () => {
    location.hash = await encodeLink({ ...LINK, width: 16 })
    await until(() => view.state.doc.toString() === LINKED, 'the pasted link')
    expect(widthShown()).toBe('16')
    await until(() => stateIdle() && tmWidth() === '16', 'the link’s compile')
  })
})
