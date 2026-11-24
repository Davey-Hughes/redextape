import type { EditorView } from '@codemirror/view'
import { computeAccessibleName } from 'dom-accessibility-api'
import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { parseWorkspace } from '../../src/workspace'
import { mainLeafIds, SHELL, showFourViews, stateIdle, toggle, until } from './harness'

beforeAll(async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(stateIdle, 'the first compile')
})

describe('the app header', () => {
  it('names the workspace after its preset', () => {
    const button = document.querySelector<HTMLButtonElement>('#workspace') as HTMLButtonElement
    expect(button.textContent?.trim()).toBe('Explorer ▾')
    // THE POSITIVE HALF: the glyph is in the label and out of the name (spec §6). A bare `▾` reaching
    // the accessible name reads as "down-pointing triangle", which is what `examples ▾` avoids too.
    expect(computeAccessibleName(button)).toBe('Explorer')
  })

  it('resets the preset: the default views back, and says so', async () => {
    // THE PRECONDITION, SINCE THE DEFAULT IS A SUBSET OF WHAT IS HERE: more views than the default's two. A press
    // makes the tree the reset replaces, as a user's would: three of the four the setup stores, λ's hidden.
    toggle('lambda').click()
    await until(() => !mainLeafIds().includes('lambda-0'), 'the λ toggle to hide the λ view')
    expect(mainLeafIds().length).toBeGreaterThan(2)
    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
    await until(() => mainLeafIds().length === 2, 'the default views')
    expect(mainLeafIds()).toEqual(['source', 'tm-0'])
    expect(document.querySelector('#notice .notice-text')?.textContent).toBe(
      'Explorer reset — the default views are back',
    )
    // THE SWITCHES AND THE FOCUS ARE TWO-THIRDS OF WHAT THE HANDLER DOES, and the leaf order above
    // measures neither: the button's name is the preset its switches make, and the stored focus is what
    // the workspace normalises to when the tree is replaced. No case in this file moves a switch before
    // the reset, so the name passes whether or not the reset restores the switches.
    expect(document.querySelector('#workspace')?.textContent?.trim()).toBe('Explorer ▾')
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.focused).toBe('tm-0')
    // THE FOUR VIEWS THE CASES BELOW ARE WRITTEN AGAINST.
    await showFourViews()
    await until(() => mainLeafIds().length === 4, 'all four views')
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
   * **A CLOSED MENU IS NOT ON THE PAGE.** `[popover]:not(:popover-open) { display: none }` is a
   * user-agent rule, and ANY author `display` beats it whatever its specificity. `:popover-open` is false
   * for a closed menu that an author `display` paints anyway, so every test that asks whether a menu is
   * open agrees it is shut, and none of them asks what it PAINTS.
   *
   * **EVERY POPOVER.** A menu added later whose rule sets `display` is the same defect, and naming the
   * menus here is what would let it through. The sweep enumerates what the page actually holds and puts
   * that list in the failure message, so a run that finds nothing says so rather than passing.
   */
  it('keeps every closed popover off the page', () => {
    const all = [...document.querySelectorAll<HTMLElement>('[popover]')]
    const seen = all.map((p) => `#${p.id}.${p.className.replace(/ /g, '.')}`).join(', ')
    // A SWEEP OVER NOTHING IS NOT A PASS. The shell's header alone holds more than three popovers, and
    // each view adds its own; the assertion is only that the sweep found a page to sweep at all.
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
