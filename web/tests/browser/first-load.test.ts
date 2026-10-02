import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { FIRST_LOAD } from '../../src/examples'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { PROGRAM_STORAGE_KEY, parseProgram } from '../../src/program-store'
import { SHELL, until } from './harness'

/**
 * **A FIRST VISIT OPENS ON `sum_to(5)`, UNDER THE DEFAULT ENCODING, IN EXPLORER** — Plan 7 part 6a spec §4.4 and
 * row 3, where every load before opened on `let x = 40; x + 2`. `setup.ts` stores that program for every file, so this
 * one removes it at module scope, before `main()` runs: nothing stored is what a first visit has. ONE MOUNT FOR THE
 * FILE, for the reason every sibling gives.
 */

localStorage.removeItem(PROGRAM_STORAGE_KEY)

const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

let view: EditorView

describe('a first visit', () => {
  it('has no program and no workspace stored', () => {
    expect(localStorage.getItem(PROGRAM_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull()
  })

  it('opens on sum_to(5) under binary, in Explorer', async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    expect(view.state.doc.toString()).toBe(FIRST_LOAD.text)
    expect(document.querySelector<HTMLSelectElement>('#encoding')?.value).toBe('binary')
    expect(document.querySelector('#workspace')?.textContent?.trim()).toBe('Explorer ▾')
    expect([...document.querySelectorAll<HTMLElement>('main [data-leaf]')].map((el) => el.dataset.leaf)).toEqual([
      'source',
      'lambda-0',
      'asm-0',
      'tm-0',
    ])
  })

  it('compiles it, and every leg ends at 15', async () => {
    await until(() => idle() && segments().length > 0, 'the first compile')
    const [lambda, asm, tm] = segments()
    expect(lambda).toMatch(/^λ 15 · /)
    expect(asm).toMatch(/^asm 15 · /)
    expect(tm).toMatch(/^TM 15 · /)
  })

  it('stores it as its compile posts it', () => {
    expect(parseProgram(localStorage.getItem(PROGRAM_STORAGE_KEY), ['binary'])).toEqual({
      text: FIRST_LOAD.text,
      encoding: 'binary',
    })
  })
})
