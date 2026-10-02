import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { EXAMPLE_ENCODING } from '../../src/examples'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { PROGRAM_STORAGE_KEY, serializeProgram } from '../../src/program-store'
import { encodeLink } from '../../src/share-link'
import { defaultWorkspace, PRESETS, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A LINK OPENED AT START-UP, THE PROGRAM ALONE** — Plan 7 part 6a spec §5.3 and §7. The link's encoding is not one
 * this build has and its workspace is not one `parseWorkspace` takes, so its program opens alone, under the encoding
 * storage would have opened on, and the stored workspace stays. The notice names what was left out, and its `undo` puts
 * back the program alone. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 *
 * **STORAGE HOLDS `unary` HERE, WHICH IS NOT THE DEFAULT ENCODING, SO A START-UP THAT FELL BACK TO THE DEFAULT FAILS
 * THIS FILE.** It cannot fail a start-up that fell back to the picker's first option, which is `unary` too: with two
 * encodings, one stored value differs from one wrong fallback and equals the other. `share-open-alone-binary.test.ts`
 * is the other half, the same open with `binary` stored, which fails that one and cannot fail this one. It takes the
 * pair to hold the encoding as storage's.
 *
 * **THE LINK CARRIES A TWO-LINE PROGRAM, NOT AN EXAMPLE**: no case here is about a recording, and at a tenth of a core
 * an example's first compile outlasted the start-up notice, and the `undo` on it.
 */

const LINKED = 'let y = 10; y + 5'
const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const readout = () => [...document.querySelectorAll('#results .segment, #results .row')].length

let view: EditorView

beforeAll(async () => {
  localStorage.setItem(PROGRAM_STORAGE_KEY, serializeProgram({ text: 'let x = 40; x + 2', encoding: 'unary' }))
  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace({ ...defaultWorkspace(), switches: PRESETS.debugger }))
  const fragment = await encodeLink({ program: LINKED, encoding: 'ternary', workspace: '{}', positions: {} })
  history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && readout() > 0, 'the first compile')
})

describe('a link at start-up whose encoding and workspace cannot be taken', () => {
  it('opens its program alone, under the encoding storage opened on, and clears the fragment', () => {
    expect(view.state.doc.toString()).toBe(LINKED)
    // WHAT THE STORED VALUE IS TOLD APART FROM: were `unary` the default encoding, this file would hold nothing.
    expect(EXAMPLE_ENCODING, 'precondition: unary is not the default encoding').not.toBe('unary')
    expect(picker().value).toBe('unary')
    expect(location.hash).toBe('')
  })

  it('keeps the stored workspace', () => {
    expect(document.querySelector('#workspace')?.textContent).toBe('Debugger ▾')
  })

  it('names what was left out, with an undo', () => {
    expect(noticeText()).toBe(
      "opened a shared link's program — its encoding, workspace and step positions were left out",
    )
    expect(undoButton()?.textContent).toBe('undo')
  })

  it('puts back the program alone on undo', async () => {
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
    expect(picker().value).toBe('unary')
    expect(document.querySelector('#workspace')?.textContent).toBe('Debugger ▾')
    expect(noticeText()).toBe('put back the program')
    expect(document.activeElement).toBe(view.contentDOM)
  })
})
