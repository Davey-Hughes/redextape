import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { STORAGE_KEY } from '../../src/appearance'
import { PALETTES } from '../../src/palettes'
import { STYLE_KEY } from '../../src/skin'
import { currentLayout, NIGHT } from '../node/base16-fixtures'
import { PREPAINT, reloaded, rgb, SHELL } from './harness'

/**
 * **AN IMPORTED PALETTE IS THE NEXT LOAD'S FIRST FRAME** (Plan 7 part 6b spec §9), with the pre-paint script
 * unchanged: `apply` writes the resolved palette's declarations to the cache that script reads. Here the import is
 * made through the dialog, the palette `main.ts` wrote onto `<html>` is taken off, and the script itself — the
 * string every page inlines, `prepaint.ts`'s `PREPAINT` — is run in this page, as a load runs it before any module.
 */

beforeAll(async () => {
  localStorage.setItem(STORAGE_KEY, 'dark')
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await userEvent.click(document.querySelector('#settings') as HTMLElement)
  await userEvent.click(document.querySelector('#import-base16') as HTMLElement)
  const dialog = document.querySelector('dialog.base16-dialog') as HTMLDialogElement
  await userEvent.fill(dialog.querySelector('textarea') as HTMLElement, currentLayout('Night', NIGHT, 'dark'))
  await userEvent.click(dialog.querySelector('button.base16-check') as HTMLElement)
  await userEvent.click(dialog.querySelector('button.base16-apply') as HTMLElement)
})

describe('an imported palette, at first paint', () => {
  it('is drawn by the pre-paint script alone, from the cache the import wrote', () => {
    expect(getComputedStyle(document.body).backgroundColor).toBe(rgb(NIGHT[0]))
    // THE BEFORE STATE, SO THE SCRIPT IS WHAT PUTS IT BACK: with the inline palette gone, the page falls to
    // `style.css`'s fallback, Instrument.
    document.documentElement.removeAttribute('style')
    expect(getComputedStyle(document.body).backgroundColor).toBe(rgb(PALETTES.instrument.dark.bg))
    new Function(PREPAINT)()
    expect(getComputedStyle(document.body).backgroundColor).toBe(rgb(NIGHT[0]))
  })

  // THE HARNESS'S `reloaded`, WHICH THE IMPORT AND REMOVE FILES READ A RELOAD THROUGH: it runs the script with what
  // storage says — here another style and the light appearance — and gives the page back as this load drew it.
  it('is what the harness reads a reload through, which leaves the page as it found it', () => {
    const root = document.documentElement
    const before = ['style', 'data-style', 'data-theme'].map((name) => root.getAttribute(name))
    expect(before.slice(1)).toEqual(['instrument', 'dark'])
    localStorage.setItem(STYLE_KEY, 'paper')
    localStorage.setItem(STORAGE_KEY, 'light')
    try {
      expect(reloaded()).toBe(rgb(PALETTES.instrument.light.bg))
      expect(['style', 'data-style', 'data-theme'].map((name) => root.getAttribute(name))).toEqual(before)
      expect(getComputedStyle(document.body).backgroundColor).toBe(rgb(NIGHT[0]))
    } finally {
      localStorage.removeItem(STYLE_KEY)
      localStorage.setItem(STORAGE_KEY, 'dark')
    }
  })

  // A RELOAD STARTS FROM THE PAGE'S MARKUP, NOT FROM THIS LOAD'S `<html>`: with no appearance stored, the script sets
  // no `data-theme`, and the first frame follows the system's, light here, not the `dark` this load was drawn in.
  it('reads a reload from the markup’s own attributes, where storage sets none', () => {
    expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    localStorage.removeItem(STORAGE_KEY)
    try {
      expect(reloaded()).toBe(rgb(PALETTES.instrument.light.bg))
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    } finally {
      localStorage.setItem(STORAGE_KEY, 'dark')
    }
  })
})
