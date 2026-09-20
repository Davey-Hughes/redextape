import type { EditorView } from '@codemirror/view'
import { computeAccessibleName } from 'dom-accessibility-api'
import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { parseWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

const leafIds = () => [...document.querySelectorAll<HTMLElement>('main [data-leaf]')].map((el) => el.dataset.leaf ?? '')

beforeAll(async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('the app header', () => {
  it('names the workspace after its preset', () => {
    const button = document.querySelector<HTMLButtonElement>('#workspace') as HTMLButtonElement
    expect(button.textContent?.trim()).toBe('Explorer ▾')
    // THE POSITIVE HALF: the glyph is in the label and out of the name (spec §6). A bare `▾` reaching
    // the accessible name reads as "down-pointing triangle", which is what `copies ▾` already avoids.
    expect(computeAccessibleName(button)).toBe('Explorer')
  })

  it('adds a view beside the focused one, focuses it, and says so', async () => {
    document.querySelector<HTMLElement>('[data-leaf="lambda-0"] button.view-title')?.focus()
    document.querySelector<HTMLButtonElement>('#new-view')?.click()
    const items = [...document.querySelectorAll<HTMLButtonElement>('#new-view-menu button')]
    expect(items.map((b) => b.textContent)).toEqual(['λ · program', 'TM · program'])
    items[1]?.click()
    await until(() => leafIds().length === 4, 'a fourth view')
    expect(leafIds()).toEqual(['source', 'lambda-0', 'pane-1', 'tm-0'])
    expect(document.querySelector('[data-leaf="pane-1"]')?.contains(document.activeElement)).toBe(true)
    expect(document.querySelector('#notice .notice-text')?.textContent).toBe('view added — TM · program')
    // **BESIDE MEANS TO ITS RIGHT** (spec §5). `leaves()` walks a row split and a column split in the
    // same order, so the leaf order above cannot tell them apart; the split's own direction can.
    expect(document.querySelector('[data-leaf="pane-1"]')?.closest('.layout-split')?.getAttribute('data-dir')).toBe(
      'row',
    )
  })

  it('resets the preset: the default views back, and says so', async () => {
    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
    await until(() => leafIds().length === 3, 'the default views')
    expect(leafIds()).toEqual(['source', 'lambda-0', 'tm-0'])
    expect(document.querySelector('#notice .notice-text')?.textContent).toBe(
      'Explorer reset — the default views are back',
    )
    // THE SWITCHES AND THE FOCUS ARE TWO-THIRDS OF WHAT THE HANDLER DOES, and the leaf order above
    // measures neither: the button's name is the preset its switches make, and the stored focus is what
    // the workspace normalises to when the tree is replaced.
    //
    // **THE SWITCH HALF DISCRIMINATES NOW.** 2a held the switches at Explorer's values and shipped no
    // control that moved them, so `switches: PRESETS[preset]` restored what they already were; 2b's
    // workspace menu moves them, `workspace-switches.test.ts` drives that, and a *reset preset* that
    // dropped the assignment would leave this button reading whatever the last pick made it.
    expect(document.querySelector('#workspace')?.textContent?.trim()).toBe('Explorer ▾')
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.focused).toBe('lambda-0')
  })

  it('offers source to + view only while no view shows it', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="source"] button.view-close')?.click()
    await until(() => !leafIds().includes('source'), 'the source view to close')
    document.querySelector<HTMLButtonElement>('#new-view')?.click()
    expect([...document.querySelectorAll('#new-view-menu button')].map((b) => b.textContent)).toContain('source')
    // **AND IT BRINGS IT BACK** — the only route to a closed source view besides *reset preset*, and the
    // one `addView` path that reuses a literal leaf id rather than minting one, so the editor returns to
    // the host `main.ts` seeded rather than to an empty section.
    const source = [...document.querySelectorAll<HTMLButtonElement>('#new-view-menu button')].find(
      (b) => b.textContent === 'source',
    )
    source?.click()
    await until(() => document.querySelector('[data-leaf="source"] .cm-content') !== null, 'the source view')
    expect(document.querySelector('[data-leaf="source"] .cm-content')?.textContent).toContain('let x = 40')
    expect(document.querySelector('#notice .notice-text')?.textContent).toBe('view added — source')
  })

  /**
   * **THE GLYPH IS NOT PART OF THE NAME, AND THE CONTROLS GATE CANNOT SEE THAT ON ITS OWN**: it compares
   * the computed name with the button's own text, and a `◐` sitting in a text node beside the word is in
   * both. `main.ts`'s `glyphFor` hides it; this is what holds it hidden, in all three states.
   */
  it('is named by its state alone, in every state', () => {
    const b = document.querySelector<HTMLButtonElement>('#appearance')
    if (b === null) throw new Error('no appearance toggle')
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      seen.push(computeAccessibleName(b))
      b.click()
    }
    expect(seen.sort()).toEqual(['dark', 'light', 'system'])
  })

  it('labels the appearance toggle with its state, in words, and cycles it', () => {
    const b = document.querySelector<HTMLButtonElement>('#appearance')
    const before = b?.textContent
    b?.click()
    expect(b?.textContent).not.toBe(before)
    expect(['system', 'light', 'dark']).toContain(b?.textContent)
    expect(b?.getAttribute('aria-label')).toBeNull()
    // AGAINST THE NAME, NOT THE TEXT: in the system state the button reads `◐system` and is named
    // `system`, so comparing the select's value with `textContent` holds only while the test never lands
    // on system.
    expect(document.querySelector<HTMLSelectElement>('#appearance-choice')?.value).toBe(
      b === null ? '' : computeAccessibleName(b),
    )
  })

  /**
   * **A CLOSED MENU IS NOT ON THE PAGE, AND ONE OF THEM WAS** — found by looking at the running app.
   * `[popover]:not(:popover-open) { display: none }` is a user-agent rule, and ANY author `display` beats
   * it whatever its specificity: written `.header-menu.settings { display: grid }`, the settings menu
   * painted over the header and the source view from first load, open or shut. Nothing else caught it —
   * `:popover-open` is false for a menu in that state, so every test that asks whether a menu is open
   * agreed it was shut, and none of them asks what it PAINTS.
   *
   * **EVERY POPOVER, NOT THE THREE THAT WERE ON THE PAGE WHEN THIS WAS WRITTEN.** One menu was broken
   * because one rule set `display`; a menu added later with the same rule is the same defect, and naming
   * the menus here is what would let it through. The sweep enumerates what the page actually holds and
   * puts that list in the failure message, so a run that finds nothing says so rather than passing.
   */
  it('keeps every closed popover off the page', () => {
    const all = [...document.querySelectorAll<HTMLElement>('[popover]')]
    const seen = all.map((p) => `#${p.id}.${p.className.replace(/ /g, '.')}`).join(', ')
    // A SWEEP OVER NOTHING IS NOT A PASS. The shell builds the header's menus and each view's two, so
    // the floor is the four a one-view-per-leg Explorer has; the assertion is that the sweep found a
    // page to sweep at all.
    expect(all.length, `popovers found: ${seen}`).toBeGreaterThan(3)
    for (const menu of all) {
      if (menu.matches(':popover-open')) continue
      const id = `#${menu.id} (class ${JSON.stringify(menu.className)})`
      expect(getComputedStyle(menu).display, `${id} paints while closed — of ${seen}`).toBe('none')
      expect(menu.getBoundingClientRect().height, `${id} takes space while closed`).toBe(0)
    }
  })

  it('keeps style and palette in the settings menu', () => {
    const menu = document.querySelector('#settings-menu')
    expect(menu?.querySelector('#style')).not.toBeNull()
    expect(menu?.querySelector('#palette')).not.toBeNull()
  })
})
