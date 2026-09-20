import type { EditorView } from '@codemirror/view'
import { computeAccessibleName } from 'dom-accessibility-api'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

const open = (): HTMLElement => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  return document.querySelector<HTMLElement>('#workspace-menu') as HTMLElement
}
const shut = (): void => {
  const menu = document.querySelector<HTMLElement>('#workspace-menu')
  if (menu?.matches(':popover-open')) menu.hidePopover()
}
const item = (menu: HTMLElement, sel: string): HTMLButtonElement =>
  menu.querySelector<HTMLButtonElement>(sel) as HTMLButtonElement
const name = (): string => document.querySelector<HTMLElement>('#workspace')?.textContent?.trim() ?? ''
const live = (): string => document.querySelector<HTMLElement>('#live')?.textContent?.trim() ?? ''
const stored = (): { switches?: unknown; version?: unknown } =>
  JSON.parse(localStorage.getItem('redextape.layout') ?? '{}')

describe('the workspace menu', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    const view: EditorView = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  })

  // **THE GLYPH IS NOT IN THE NAME.** `copies 2 ▾` already does this; the workspace button did not, and
  // §6 records that as an inconsistency rather than a decision. A bare `▾` in the accessible name reads
  // as "down-pointing triangle".
  it('carries a ▾ that the accessible name does not', () => {
    const button = document.querySelector<HTMLButtonElement>('#workspace') as HTMLButtonElement
    expect(button.textContent).toContain('▾')
    expect(computeAccessibleName(button)).toBe('Explorer')
  })

  it('offers the three presets and the three switches, with the values in force marked', () => {
    const menu = open()
    expect([...menu.querySelectorAll('[data-preset]')].map((b) => b.textContent)).toEqual([
      'Explorer',
      'Debugger',
      'Stage',
    ])
    expect(item(menu, '[data-preset="explorer"]').getAttribute('aria-current')).toBe('true')
    expect(item(menu, '[data-switch="steps"][data-value="view"]').getAttribute('aria-current')).toBe('true')
    expect(item(menu, '[data-switch="views"][data-value="tiles"]').getAttribute('aria-current')).toBe('true')
    expect(item(menu, '[data-switch="readout"][data-value="strip"]').getAttribute('aria-current')).toBe('true')
    // A switch's name says which switch it is, so "one bar" is not a button named "one bar".
    expect(computeAccessibleName(item(menu, '[data-switch="steps"][data-value="bar"]'))).toBe('step controls — one bar')
    shut()
  })

  it('names itself after the preset a pick makes, persists it, and says so', () => {
    const menu = open()
    item(menu, '[data-preset="debugger"]').click()
    expect(name()).toBe('Debugger ▾')
    expect(stored().switches).toEqual({ steps: 'bar', views: 'tiles', readout: 'inspector' })
    expect(live()).toContain('Debugger')
    shut()
  })

  // §4: any combination matching no row is *custom*, it persists as it is, and the menu names it.
  it('is custom when the switches match no preset, and offers no reset while it is', () => {
    const menu = open()
    item(menu, '[data-preset="explorer"]').click()
    item(menu, '[data-switch="views"][data-value="stage"]').click()
    expect(name()).toBe('custom ▾')
    expect(stored().switches).toEqual({ steps: 'view', views: 'stage', readout: 'strip' })
    expect(menu.querySelector('#reset-preset')).toBeNull()
    // Choosing a preset is the way back, and the item returns with it.
    item(menu, '[data-preset="explorer"]').click()
    expect(menu.querySelector('#reset-preset')).not.toBeNull()
    shut()
  })

  // Spec §11's fourth rule, third instance: the menu rebuilds under the button that was just clicked.
  it('keeps the focus on the switch that was picked, and hands it off when reset preset goes', () => {
    const menu = open()
    item(menu, '[data-preset="explorer"]').click()
    const stage = item(menu, '[data-switch="views"][data-value="stage"]')
    stage.focus()
    stage.click()
    expect(document.activeElement).toBe(item(menu, '[data-switch="views"][data-value="stage"]'))
    // Now stand on reset preset and make the workspace custom from another switch.
    item(menu, '[data-preset="explorer"]').click()
    const reset = item(menu, '#reset-preset')
    reset.focus()
    item(menu, '[data-switch="readout"][data-value="inspector"]').click()
    expect(menu.querySelector('#reset-preset')).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(menu.contains(document.activeElement)).toBe(true)
    item(menu, '[data-preset="explorer"]').click()
    shut()
  })

  // **NAMED FOR WHAT IT MEASURES.** It used to be called "survives a reload" and performed none — it
  // reads `localStorage` in the same page. The restore direction is `workspace-boot.test.ts`, which seeds
  // a Debugger envelope before `main` is imported and asserts the page comes up in it.
  it('writes the whole switch triple to storage, under version 2', () => {
    const menu = open()
    item(menu, '[data-preset="stage"]').click()
    shut()
    expect(stored().switches).toEqual({ steps: 'bar', views: 'stage', readout: 'inspector' })
    expect(stored().version).toBe(2)
    // Back to Explorer so the shared page is where the other cases expect it.
    const again = open()
    item(again, '[data-preset="explorer"]').click()
    shut()
  })
})
