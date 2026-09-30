import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { FIRST_LOAD } from '../../src/examples'
import { PROGRAM_STORAGE_KEY } from '../../src/program-store'
import { SHELL, until } from './harness'

/**
 * **A STORED PROGRAM THE APP REFUSES OPENS THE FIRST-LOAD EXAMPLE, AND SAYS NOTHING** — Plan 7 part 6a spec §4.3 and
 * §7: a refusal cannot be told from a first visit. The refusal here is the one only the browser can see, an encoding
 * `encodings()` does not list; `program-store.test.ts` holds every other. ONE MOUNT FOR THE FILE, for the reason every
 * sibling gives.
 */

localStorage.setItem(
  PROGRAM_STORAGE_KEY,
  JSON.stringify({ version: 1, text: 'let y = 5;\ny * 4\n', encoding: 'ternary' }),
)

const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

describe('a stored program under an encoding the build does not offer', () => {
  it('is set aside for sum_to(5) under unary, with nothing said', async () => {
    document.body.innerHTML = SHELL
    const view: EditorView = await (await import('../../src/main')).ready
    expect(view.state.doc.toString()).toBe(FIRST_LOAD.text)
    expect(document.querySelector<HTMLSelectElement>('#encoding')?.value).toBe('unary')
    await until(idle, 'the first compile')
    expect(document.querySelector<HTMLElement>('#notice')?.hidden).toBe(true)
  })
})
