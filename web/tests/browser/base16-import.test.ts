import { computeAccessibleName } from 'dom-accessibility-api'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { STORAGE_KEY } from '../../src/appearance'
import { readScheme } from '../../src/base16'
import { checkScheme } from '../../src/base16-check'
import { CUSTOM_PALETTE_KEY } from '../../src/custom-palette'
import { PALETTES } from '../../src/palettes'
import { PALETTE_CSS_KEY, PALETTE_KEY } from '../../src/skin'
import { currentLayout, DAY, EMBER, legacyLayout, NIGHT, STUCK } from '../node/base16-fixtures'
import { choosePalette, chooseStyle, reloaded, rgb, SHELL, until } from './harness'

/**
 * THE BASE16 IMPORT, THROUGH ITS DIALOG (Plan 7 part 6b spec §8): opened from the settings menu, a scheme pasted,
 * checked and applied — as it is and adjusted — or cancelled. The page is dark throughout, seeded before the mount,
 * so a dark scheme is the half on screen and a light one is not. ONE MOUNT FOR THE FILE, and the cases run in order:
 * each applies onto what the one before left.
 */

const dialog = () => document.querySelector<HTMLDialogElement>('dialog.base16-dialog') as HTMLDialogElement
const inDialog = <T extends HTMLElement>(selector: string): T => dialog().querySelector<T>(selector) as T
const text = () => inDialog<HTMLTextAreaElement>('textarea')
const applyButton = () => inDialog<HTMLButtonElement>('button.base16-apply')
const adjustedButton = () => inDialog<HTMLButtonElement>('button.base16-apply-adjusted')
const said = (selector: string) => [...dialog().querySelectorAll(selector)].map((el) => el.textContent)
const palette = () => document.querySelector<HTMLSelectElement>('#palette') as HTMLSelectElement
/** The dialog's own live region: what a screen reader hears of a check. */
const heard = () => dialog().querySelector('[role="status"]')?.textContent
const stored = () => localStorage.getItem(CUSTOM_PALETTE_KEY)
const body = () => getComputedStyle(document.body)

/**
 * Every sentence written to the app's live region, `#live`, from now until `stop`, each with whether a modal dialog
 * was open as it was written — which makes `#live`, outside it, inert, so a screen reader would not hear it.
 */
function listenToLive(): { readonly said: { readonly text: string; readonly underModal: boolean }[]; stop(): void } {
  const live = document.querySelector('#live') as HTMLElement
  const own = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent') as PropertyDescriptor
  const said: { text: string; underModal: boolean }[] = []
  Object.defineProperty(live, 'textContent', {
    configurable: true,
    get() {
      return own.get?.call(this)
    },
    set(text: string) {
      said.push({ text: text.trim(), underModal: document.querySelector('dialog:modal') !== null })
      own.set?.call(this, text)
    },
  })
  return { said, stop: () => Reflect.deleteProperty(live, 'textContent') }
}

/** Open the dialog from the settings menu, by real clicks, and paste `scheme` into it. */
async function openWith(scheme: string): Promise<void> {
  await userEvent.click(document.querySelector('#settings') as HTMLElement)
  await userEvent.click(document.querySelector('#import-base16') as HTMLElement)
  expect(dialog().open).toBe(true)
  await userEvent.fill(text(), scheme)
}

beforeAll(async () => {
  await page.viewport(1280, 800)
  localStorage.setItem(STORAGE_KEY, 'dark')
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
})

describe('the base16 import dialog', () => {
  it('is on no surface while closed', () => {
    expect(dialog().open).toBe(false)
    expect(getComputedStyle(dialog()).display).toBe('none')
    expect(dialog().getBoundingClientRect().height).toBe(0)
  })

  it('opens from the settings menu by a real click, modal, named by its heading, with the text focused', async () => {
    await userEvent.click(document.querySelector('#settings') as HTMLElement)
    await userEvent.click(document.querySelector('#import-base16') as HTMLElement)
    expect(dialog().matches(':modal')).toBe(true)
    expect(document.querySelector('#settings-menu')?.matches(':popover-open')).toBe(false)
    expect(computeAccessibleName(dialog())).toBe('import a base16 scheme')
    expect(document.activeElement).toBe(text())
    expect(text().spellcheck).toBe(false)
  })

  it('offers neither apply before a check, and says why', () => {
    for (const b of [applyButton(), adjustedButton()]) {
      expect(b.disabled).toBe(true)
      expect(b.getAttribute('aria-description')).toBe('check the scheme first')
    }
    expect(inDialog('.base16-why').textContent).toBe('check the scheme first')
  })

  it('lists what it cannot read, by key, and offers nothing to apply', async () => {
    await userEvent.fill(text(), legacyLayout('Night', NIGHT).replace(/base0C:.*\n/, 'base0C: cyan\n'))
    await userEvent.click(inDialog('button.base16-check'))
    expect(said('.base16-errors li')).toEqual(['base0C is not a colour: "cyan"'])
    expect(applyButton().getAttribute('aria-description')).toBe('the scheme could not be read')
    expect(inDialog('.base16-why').textContent).toBe('the scheme could not be read')
    expect(heard()).toBe('base0C is not a colour: "cyan"')
  })

  /**
   * **THE CHECK IS SAID INSIDE THE DIALOG.** The app's one live region, `#live`, sits outside it, and a modal makes
   * everything outside it inert, so a screen reader hears nothing there while the dialog is open.
   */
  it('says the check in a live region of its own, inside the dialog, and says a second check again', async () => {
    const region = dialog().querySelector('[role="status"]') as HTMLElement
    expect(dialog().contains(region)).toBe(true)
    expect(document.querySelector('#live')?.textContent).not.toContain('cyan')
    const first = heard()
    await userEvent.click(inDialog('button.base16-check'))
    expect(heard()).not.toBe(first)
    expect(heard()?.trim()).toBe(first)
  })

  it('forgets a check when the text is edited', async () => {
    await userEvent.fill(text(), currentLayout('Night', NIGHT, 'dark'))
    await userEvent.click(inDialog('button.base16-check'))
    expect(applyButton().disabled).toBe(false)
    await userEvent.type(text(), ' ')
    expect(said('.base16-result p')).toEqual([])
    expect(applyButton().getAttribute('aria-description')).toBe('check the scheme first')
    await userEvent.keyboard('{Escape}')
    expect(heard()).toBe('')
  })

  // A SCHEME THAT FAILS, WHERE NO LIGHTNESS MOVES ANY COLOUR: `apply adjusted` would store the tokens `apply` stores,
  // marked adjusted, so it cannot act, and says why; `apply` still can.
  it('offers no apply adjusted for a failing scheme it would move no colour of, and says why', async () => {
    await openWith(legacyLayout('', STUCK))
    await userEvent.click(inDialog('button.base16-check'))
    expect(said('.base16-adjusts')).toEqual([
      'apply adjusted moves no colour’s lightness; binders stay too close to 8 other colours, where no lightness sets them apart',
    ])
    expect(applyButton().disabled).toBe(false)
    expect(adjustedButton().disabled).toBe(true)
    expect(adjustedButton().getAttribute('aria-description')).toBe('nothing to adjust — no lightness fixes what fails')
    expect(inDialog('.base16-why').textContent).toBe('nothing to adjust — no lightness fixes what fails')
    expect(inDialog<HTMLElement>('.base16-why').hidden).toBe(false)
    await userEvent.keyboard('{Escape}')
  })

  /**
   * **THE HALF NOT ON SCREEN, APPLIED, STILL CHOOSES `custom`** (the user's decision), and a half not imported is the
   * style's own (umbrella §7): a light import on a dark page switches the page from the palette chosen before, Paper
   * here, to the style's own dark palette. The line says so before `apply`.
   */
  it('says, before a half the page is not showing is applied, that the page will be in the style’s own palette', async () => {
    await choosePalette('paper')
    expect(body().backgroundColor).toBe(rgb(PALETTES.paper.dark.bg))
    await openWith(legacyLayout('Day', DAY))
    await userEvent.click(inDialog('button.base16-check'))
    expect(said('.base16-elsewhere')).toEqual([
      'fills the light palette; the page is dark now, so its palette is the style’s own until you import a dark scheme',
    ])
    await userEvent.click(applyButton())
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(palette().selectedOptions[0]?.textContent).toBe('custom — light: Day')
    expect(PALETTES.instrument.dark.bg).not.toBe(PALETTES.paper.dark.bg)
    expect(body().backgroundColor).toBe(rgb(PALETTES.instrument.dark.bg))
  })

  it('applies a passing scheme: the page is drawn in it, and the palette select names it', async () => {
    await openWith(currentLayout('Night', NIGHT, 'dark'))
    await userEvent.click(inDialog('button.base16-check'))
    expect(said('.base16-result p')).toEqual(['Night · dark, from the file: every contrast check passes'])
    expect(adjustedButton().getAttribute('aria-description')).toBe('nothing to adjust — every check passes')
    expect(dialog().querySelector('.panel')).toBeNull()
    await userEvent.click(applyButton())
    expect(dialog().open).toBe(false)
    expect(document.activeElement).toBe(document.querySelector('#settings'))
    expect(body().backgroundColor).toBe(rgb(NIGHT[0]))
    expect(palette().value).toBe('custom')
    expect(palette().selectedOptions[0]?.textContent).toBe('custom — light: Day · dark: Night')
    expect(JSON.parse(stored() ?? '{}').dark.adjusted).toBe(false)
  })

  it("shows a failing scheme's summary, and its failures grouped by scheme colour behind details", async () => {
    await openWith(legacyLayout('Ember', EMBER))
    await userEvent.click(inDialog('button.base16-check'))
    expect(said('.base16-result > p')).toEqual([
      'Ember · dark, detected: 17 of 35 contrast checks below WCAG AA, worst 3.31:1',
      'apply adjusted moves 4 colours’ lightness, and every check then passes',
    ])
    expect(heard()).toBe('Ember · dark, detected: 17 of 35 contrast checks below WCAG AA, worst 3.31:1')
    const toggle = inDialog<HTMLButtonElement>('.panel[data-panel="base16-details"] button.panel-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(inDialog('.base16-details-body').hidden).toBe(true)
    await userEvent.click(toggle)
    expect(inDialog('.base16-details-body').hidden).toBe(false)
    expect(said('.base16-failures li')).toHaveLength(8)
    expect(said('.base16-failures li')[0]).toBe(
      'base04 on base01: dim text, plain code and punctuation on panels and headers — 3.31:1, needs 4.5',
    )
    expect(said('.base16-changes li')).toHaveLength(4)
    // EACH CHANGE CARRIES A SWATCH OF EACH VALUE, DRAWN IN IT, and hidden from the name: the hex text says it.
    const swatches = [...dialog().querySelectorAll<HTMLElement>('.base16-changes li:first-child .base16-swatch')]
    expect(swatches.map((s) => getComputedStyle(s).backgroundColor)).toEqual([rgb(EMBER[4]), rgb('#958ca7')])
    expect(swatches.every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true)
    expect(swatches[0]?.getBoundingClientRect().width).toBeGreaterThan(0)
  })

  it('applies it adjusted: the text is drawn in the adjusted colour, and the select says so', async () => {
    const reading = readScheme(legacyLayout('Ember', EMBER))
    if (!reading.ok) throw new Error('the fixture does not read')
    const fg = checkScheme(reading.scheme).adjustment.tokens.fg
    expect(fg).not.toBe(EMBER[5])
    await userEvent.click(adjustedButton())
    expect(body().color).toBe(rgb(fg))
    expect(body().backgroundColor).toBe(rgb(EMBER[0]))
    expect(palette().selectedOptions[0]?.textContent).toBe('custom — light: Day · dark: Ember (adjusted)')
    expect(JSON.parse(stored() ?? '{}').dark.adjusted).toBe(true)
  })

  it('changes nothing on cancel or Esc, and gives the focus back to settings', async () => {
    const before = stored()
    await openWith(legacyLayout('Day', DAY))
    await userEvent.click(inDialog('button.base16-check'))
    await userEvent.click(inDialog('button.base16-cancel'))
    expect(dialog().open).toBe(false)
    expect(document.activeElement).toBe(document.querySelector('#settings'))
    await openWith(legacyLayout('Day', DAY))
    await userEvent.click(inDialog('button.base16-check'))
    await userEvent.keyboard('{Escape}')
    expect(dialog().open).toBe(false)
    expect(document.activeElement).toBe(document.querySelector('#settings'))
    expect(stored()).toBe(before)
    expect(body().backgroundColor).toBe(rgb(EMBER[0]))
  })

  /**
   * **THE CLOSE MOVES THE FOCUS, NOT THE PLATFORM.** Hiding a popover and closing a modal each hand the focus back to
   * whatever held it before they opened. A click focuses `#settings` in Chromium, so there that is `#settings`
   * anyway; in WebKit and Firefox on macOS a mouse click does not focus a button, and the menu opens with the focus
   * where it was — as it is opened here, from another control.
   */
  it('gives the focus to settings on close, even when the menu opened with the focus elsewhere', async () => {
    const settings = document.querySelector('#settings')
    const elsewhere = document.querySelector<HTMLElement>('#appearance') as HTMLElement
    elsewhere.focus()
    document.querySelector<HTMLElement>('#settings-menu')?.showPopover()
    await userEvent.click(document.querySelector('#import-base16') as HTMLElement)
    expect(dialog().open).toBe(true)
    await userEvent.click(inDialog('button.base16-cancel'))
    await until(() => document.activeElement === settings, `the focus on settings, not ${document.activeElement?.id}`)
  })

  it('says when it fills the half the page is not showing, and leaves the appearance as it is', async () => {
    await openWith(legacyLayout('Day', DAY))
    await userEvent.click(inDialog('button.base16-check'))
    expect(said('.base16-elsewhere')).toEqual([
      'fills the light palette; the page is dark now, so its palette is the dark import, Ember, until the appearance is light',
    ])
    await userEvent.click(applyButton())
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(body().backgroundColor).toBe(rgb(EMBER[0]))
    expect(palette().selectedOptions[0]?.textContent).toBe('custom — light: Day · dark: Ember (adjusted)')
  })

  /**
   * **THE STORE IS WRITTEN FIRST, AND THE CHOICE AND THE FIRST PAINT ONLY WHEN IT HELD** (spec §7.1): otherwise a
   * reload would draw its first frame in the import storage lost, and read `custom` over a built-in choice with an
   * older import behind it. Here the page is on Terminal when the write is refused.
   *
   * **SAID WHERE A SCREEN READER HEARS IT**: the dialog closes before the apply, so the notice reaches `#live` once the
   * modal no longer makes it inert, as a removal's does.
   */
  it('applies a palette storage refuses for this page load, says so, and saves neither the choice nor the first paint', async () => {
    await choosePalette('terminal')
    expect(body().backgroundColor).toBe(rgb(PALETTES.terminal.dark.bg))
    const before = stored()
    const cache = localStorage.getItem(PALETTE_CSS_KEY)
    const setItem = localStorage.setItem
    localStorage.setItem = (key: string, value: string) => {
      if (key === CUSTOM_PALETTE_KEY) throw new DOMException('full', 'QuotaExceededError')
      setItem.call(localStorage, key, value)
    }
    const live = listenToLive()
    try {
      await openWith(currentLayout('Night', NIGHT, 'dark'))
      await userEvent.click(inDialog('button.base16-check'))
      await userEvent.click(applyButton())
      const refused = 'the imported palette could not be saved; it applies until the page is reloaded'
      await until(() => document.querySelector('#notice .notice-text')?.textContent === refused, 'the notice')
      expect(document.querySelector('#live')?.textContent?.trim()).toBe(refused)
      expect(live.said).toEqual([{ text: refused, underModal: false }])
      expect(body().backgroundColor).toBe(rgb(NIGHT[0]))
      expect(stored()).toBe(before)
      expect(localStorage.getItem(PALETTE_KEY)).toBe('terminal')
      expect(localStorage.getItem(PALETTE_CSS_KEY)).toBe(cache)
      expect(reloaded()).toBe(rgb(PALETTES.terminal.dark.bg))
      // A LATER GESTURE REWRITES THE CACHE FROM WHAT STORAGE HOLDS, NOT FROM THIS LOAD'S MEMORY: after a style change the
      // page is still in the import storage lost, and a reload still starts in Terminal.
      await chooseStyle('paper')
      expect(body().backgroundColor).toBe(rgb(NIGHT[0]))
      expect(reloaded()).toBe(rgb(PALETTES.terminal.dark.bg))
    } finally {
      live.stop()
      localStorage.setItem = setItem
    }
  })
})
