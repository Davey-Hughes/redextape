import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { PROGRAM_STORAGE_KEY, serializeProgram } from '../../src/program-store'
import { encodeLink } from '../../src/share-link'
import { SHELL, until } from './harness'

/**
 * **A LINK OPENED AT START-UP, THE PROGRAM ALONE, WITH `binary` STORED** — Plan 7 part 6a spec §5.3: a link whose
 * encoding this build does not have opens its program under the encoding storage would have opened on. This is the
 * open `share-open-alone.test.ts` makes, with the other encoding stored, and only the encoding is held here: the
 * notice, the workspace and the `undo` are that file's.
 *
 * **STORAGE HOLDS `binary` HERE, WHICH IS NOT THE PICKER'S FIRST OPTION, SO A START-UP THAT FELL BACK TO THE PICKER'S
 * FIRST OPTION FAILS THIS FILE.** The first option is what the picker reads before the page's program has set it, and
 * what `encodings()` lists first. It cannot fail a start-up that fell back to the default encoding, which is `binary`
 * too: with two encodings, one stored value differs from one wrong fallback and equals the other.
 * `share-open-alone.test.ts` stores `unary`, which fails that one and cannot fail this one. It takes the pair to hold
 * the encoding as storage's. A SECOND FILE, BECAUSE A FILE MOUNTS ONCE, for the reason every sibling gives.
 */

const LINKED = 'let y = 10; y + 5'
const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const readout = () => [...document.querySelectorAll('#results .segment, #results .row')].length

let view: EditorView

beforeAll(async () => {
  localStorage.setItem(PROGRAM_STORAGE_KEY, serializeProgram({ text: 'let x = 40; x + 2', encoding: 'binary' }))
  const fragment = await encodeLink({ program: LINKED, encoding: 'ternary', workspace: '{}', positions: {} })
  history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && readout() > 0, 'the first compile')
})

describe('a link at start-up whose encoding cannot be taken, with binary stored', () => {
  it('opens its program alone, under the encoding storage opened on', () => {
    expect(view.state.doc.toString()).toBe(LINKED)
    // WHAT THE STORED VALUE IS TOLD APART FROM: were `binary` the picker's first option, this file would hold nothing.
    expect(picker().options[0]?.value, 'precondition: binary is not the picker’s first option').not.toBe('binary')
    expect(picker().value).toBe('binary')
  })
})
