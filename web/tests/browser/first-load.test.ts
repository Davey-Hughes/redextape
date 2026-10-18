import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { FIRST_LOAD } from '../../src/examples'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { PROGRAM_STORAGE_KEY, parseProgram } from '../../src/program-store'
import { SHELL, segments, stateIdle, until } from './harness'

/**
 * **A FIRST VISIT OPENS ON `sum_to(5)`, UNDER THE DEFAULT ENCODING, IN EXPLORER** — Plan 7 part 6a spec §4.4 and
 * row 3, where every load before opened on `let x = 40; x + 2`. `setup.ts` stores that program for every file, so this
 * one removes it at module scope, before `main()` runs: nothing stored is what a first visit has. ONE MOUNT FOR THE
 * FILE, for the reason every sibling gives.
 *
 * **AND ON THE SOURCE AND THE TM VIEW** (the view layouts spec §8). `setup.ts` stores a four-view workspace for every
 * file too, so that goes with the program; `first-load-views.test.ts` has what the two views look like.
 */

localStorage.removeItem(PROGRAM_STORAGE_KEY)
localStorage.removeItem(LAYOUT_STORAGE_KEY)

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
      'tm-0',
    ])
  })

  it('compiles it, and every leg ends at 15', async () => {
    await until(() => stateIdle() && segments().length > 0, 'the first compile')
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
