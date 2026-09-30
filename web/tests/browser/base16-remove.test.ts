import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { STORAGE_KEY } from '../../src/appearance'
import { CUSTOM_PALETTE_KEY, type CustomHalf, serializeCustomPalette } from '../../src/custom-palette'
import { PALETTES } from '../../src/palettes'
import { PALETTE_CSS_KEY, PALETTE_KEY } from '../../src/skin'
import { adjustedHalf, currentLayout, DAY, EMBER, legacyLayout, NIGHT, storedHalf } from '../node/base16-fixtures'
import { choosePalette, chooseStyle, reloaded, rgb, SHELL, until } from './harness'

/**
 * A STORED HALF, SHOWN AND REMOVED, WITH ITS UNDO (Plan 7 part 6b spec §8.2, §8.5). The page is dark and holds a
 * light half, `Day`, and an adjusted dark half, `Ember`, chosen as `custom` — what two imports leave, seeded before
 * the mount. ONE MOUNT FOR THE FILE, and the cases run in order, each on what the one before left.
 */

/**
 * `Ember` as `apply adjusted` stored it, but with its text, names and error text NOT what the adjustment gives now —
 * as a half stored before a change to the adjustment would be — so the `changes` panel can show them only by reading
 * the store.
 */
const EMBER_STORED: CustomHalf = (() => {
  const half = adjustedHalf('Ember', EMBER, 'dark')
  return { ...half, tokens: { ...half.tokens, fg: '#a09ab0', 'tok-ident': '#a09ab0', error: '#e08090' } }
})()

const SEEDED = serializeCustomPalette({ light: storedHalf('Day', DAY), dark: EMBER_STORED })

const dialog = () => document.querySelector<HTMLDialogElement>('dialog.base16-dialog') as HTMLDialogElement
const removeButtons = () => [...dialog().querySelectorAll<HTMLButtonElement>('button.base16-remove')]
const palette = () => document.querySelector<HTMLSelectElement>('#palette') as HTMLSelectElement
const options = () => [...palette().options].map((o) => o.textContent)
const notice = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const undo = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
const stored = () => localStorage.getItem(CUSTOM_PALETTE_KEY)
const bg = () => getComputedStyle(document.body).backgroundColor

/**
 * Storage refusing every write to the imported palette's key, as a full or locked store does, until the returned
 * function puts it back; `refused` counts each refusal by method, so a test can say which write it reached.
 */
function refuseCustomWrites(): { readonly refused: { setItem: number; removeItem: number }; restore(): void } {
  const refused = { setItem: 0, removeItem: 0 }
  const setItem = localStorage.setItem
  const removeItem = localStorage.removeItem
  localStorage.setItem = (key: string, value: string) => {
    if (key !== CUSTOM_PALETTE_KEY) return setItem.call(localStorage, key, value)
    refused.setItem++
    throw new DOMException('full', 'QuotaExceededError')
  }
  localStorage.removeItem = (key: string) => {
    if (key !== CUSTOM_PALETTE_KEY) return removeItem.call(localStorage, key)
    refused.removeItem++
    throw new DOMException('refused', 'SecurityError')
  }
  return {
    refused,
    restore() {
      localStorage.setItem = setItem
      localStorage.removeItem = removeItem
    },
  }
}

async function open(): Promise<void> {
  await userEvent.click(document.querySelector('#settings') as HTMLElement)
  await userEvent.click(document.querySelector('#import-base16') as HTMLElement)
  expect(dialog().open).toBe(true)
}

/** Import `scheme` through the dialog, applied as it is. */
async function importScheme(scheme: string): Promise<void> {
  await open()
  await userEvent.fill(dialog().querySelector('textarea') as HTMLElement, scheme)
  await userEvent.click(dialog().querySelector('button.base16-check') as HTMLElement)
  await userEvent.click(dialog().querySelector('button.base16-apply') as HTMLElement)
}

/** Open the dialog and click the remove named `name`. */
async function remove(name: string): Promise<void> {
  await open()
  const button = removeButtons().find((b) => b.getAttribute('aria-label') === name)
  if (button === undefined)
    throw new Error(
      `no ${name} among ${removeButtons()
        .map((b) => b.title)
        .join(', ')}`,
    )
  await userEvent.click(button)
}

beforeAll(async () => {
  localStorage.setItem(CUSTOM_PALETTE_KEY, SEEDED)
  localStorage.setItem(PALETTE_KEY, 'custom')
  localStorage.setItem(STORAGE_KEY, 'dark')
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
})

describe('a stored half, in the import dialog', () => {
  it('is named in the now line, with a remove beside it naming its half, and the text still takes the focus', async () => {
    await open()
    expect(dialog().querySelector('.base16-now-line')?.textContent).toBe(
      'now: light — Day remove · dark — Ember, adjusted remove',
    )
    expect(removeButtons().map((b) => [b.textContent, b.getAttribute('aria-label'), b.title])).toEqual([
      ['remove', 'remove the light palette, Day', 'remove the light palette, Day'],
      ['remove', 'remove the dark palette, Ember', 'remove the dark palette, Ember'],
    ])
    expect(document.activeElement).toBe(dialog().querySelector('textarea'))
  })

  it('lists the colours an adjusted half moved, read from what is stored, behind changes', async () => {
    const toggle = dialog().querySelector<HTMLElement>('.panel[data-panel="base16-now-changes"] button.panel-toggle')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(toggle as HTMLElement)
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect([...dialog().querySelectorAll('.base16-now-changes li')].map((li) => li.textContent)).toEqual([
      'base04 #7e7590 → #958ca7, as dim text, plain code and punctuation',
      'base05 #8a829a → #a09ab0, as text and names',
      'base08 #c06070 → #e08090, as error text',
      'base0E #9070a0 → #a584b5, as accents and keywords',
    ])
    // THE HALF IS A LABEL AND TAKES THE STYLE'S CASE; THE SCHEME'S NAME IS DATA AND KEEPS ITS OWN. Instrument upper-cases
    // labels, so this is where a name would be changed, and `innerText` is what the page shows.
    expect(document.documentElement.getAttribute('data-style')).toBe('instrument')
    const label = dialog().querySelector<HTMLElement>('.base16-now-changes .base16-changes-label') as HTMLElement
    expect(getComputedStyle(label).textTransform).toBe('uppercase')
    expect(getComputedStyle(label.querySelector('.base16-scheme-name') as HTMLElement).textTransform).toBe('none')
    expect(label.innerText).toBe('DARK — Ember')
    await userEvent.keyboard('{Escape}')
  })
})

describe('removing a half', () => {
  it('deletes it and keeps the other: the choice stays custom, and the page falls back where it was', async () => {
    expect(bg()).toBe(rgb(EMBER[0]))
    await remove('remove the dark palette, Ember')
    expect(dialog().open).toBe(false)
    expect(document.activeElement).toBe(document.querySelector('#settings'))
    expect(JSON.parse(stored() ?? '{}')).toEqual({ version: 1, light: storedHalf('Day', DAY) })
    expect(palette().value).toBe('custom')
    expect(palette().selectedOptions[0]?.textContent).toBe('custom — light: Day')
    expect(bg()).toBe(rgb(PALETTES.instrument.dark.bg))
    expect(notice()).toBe('dark palette Ember removed')
  })

  // BY THE KEYBOARD, FROM WHERE THE REMOVAL LEFT THE FOCUS: the line's undo is the next stop after `settings`, and the
  // focus goes back there when it is used, not to the copies button the line falls back to for a copy's undo.
  it('is undone exactly: the half as it was stored, adjusted included, and the focus is back on settings', async () => {
    const settings = document.querySelector('#settings')
    expect(document.activeElement).toBe(settings)
    await userEvent.tab()
    expect(document.activeElement).toBe(undo())
    await userEvent.keyboard('{Enter}')
    expect(stored()).toBe(SEEDED)
    expect(palette().selectedOptions[0]?.textContent).toBe('custom — light: Day · dark: Ember (adjusted)')
    expect(bg()).toBe(rgb(EMBER[0]))
    expect(document.activeElement).toBe(settings)
  })

  // THE UNDO PUTS BACK WHAT THE REMOVAL CHANGED, AND ONLY THAT: a palette chosen while it was on offer is the user's.
  it('leaves a choice made after the removal as it is, on undo', async () => {
    await remove('remove the dark palette, Ember')
    expect(palette().value).toBe('custom')
    await choosePalette('paper')
    await userEvent.click(undo() as HTMLElement)
    expect(stored()).toBe(SEEDED)
    expect(palette().value).toBe('paper')
    expect(localStorage.getItem(PALETTE_KEY)).toBe('paper')
    expect(bg()).toBe(rgb(PALETTES.paper.dark.bg))
    expect(options().at(-1)).toBe('custom — light: Day · dark: Ember (adjusted)')
    await choosePalette('custom')
    expect(bg()).toBe(rgb(EMBER[0]))
  })

  it('removes the key with the last half, and a custom choice becomes match', async () => {
    await remove('remove the light palette, Day')
    await remove('remove the dark palette, Ember')
    expect(stored()).toBeNull()
    expect(options()).toEqual(['match style', 'Paper', 'Terminal', 'Instrument'])
    expect(palette().value).toBe('match')
    expect(localStorage.getItem(PALETTE_KEY)).toBe('match')
    expect(bg()).toBe(rgb(PALETTES.instrument.dark.bg))
    await open()
    expect(dialog().querySelector<HTMLElement>('.base16-now')?.hidden).toBe(true)
    await userEvent.keyboard('{Escape}')
  })

  it('puts back a custom choice the last half’s removal made match, on undo', async () => {
    await userEvent.click(undo() as HTMLElement)
    expect(palette().value).toBe('custom')
    expect(palette().selectedOptions[0]?.textContent).toBe('custom — dark: Ember (adjusted)')
    expect(bg()).toBe(rgb(EMBER[0]))
  })

  it('leaves a choice made after the last half’s removal made it match, on undo', async () => {
    await remove('remove the dark palette, Ember')
    expect(palette().value).toBe('match')
    await choosePalette('terminal')
    await userEvent.click(undo() as HTMLElement)
    expect(palette().value).toBe('terminal')
    expect(options().at(-1)).toBe('custom — dark: Ember (adjusted)')
    expect(bg()).toBe(rgb(PALETTES.terminal.dark.bg))
    await choosePalette('custom')
    expect(bg()).toBe(rgb(EMBER[0]))
  })

  // BY THE GESTURE, NOT BY THE VALUE: a user who picks another palette and then the one the removal left has chosen it.
  it('keeps the choice the removal left when the user picked it back, on undo', async () => {
    await remove('remove the dark palette, Ember')
    expect(palette().value).toBe('match')
    await choosePalette('terminal')
    await choosePalette('match')
    await userEvent.click(undo() as HTMLElement)
    expect(palette().value).toBe('match')
    expect(localStorage.getItem(PALETTE_KEY)).toBe('match')
    expect(options().at(-1)).toBe('custom — dark: Ember (adjusted)')
    expect(bg()).toBe(rgb(PALETTES.instrument.dark.bg))
    await choosePalette('custom')
    expect(bg()).toBe(rgb(EMBER[0]))
  })

  it('ends its undo at the next import', async () => {
    await remove('remove the dark palette, Ember')
    expect(undo()).not.toBeNull()
    await open()
    await userEvent.fill(dialog().querySelector('textarea') as HTMLElement, currentLayout('Night', NIGHT, 'dark'))
    await userEvent.click(dialog().querySelector('button.base16-check') as HTMLElement)
    await userEvent.click(dialog().querySelector('button.base16-apply') as HTMLElement)
    expect(undo()).toBeNull()
    expect(palette().selectedOptions[0]?.textContent).toBe('custom — dark: Night')
  })

  // ONCE ANOTHER GESTURE HAS SPOKEN OVER THE UNDO, THE LINE IS THAT GESTURE'S: an import ends its own removal's offer,
  // not whatever the line says now.
  it('leaves another gesture’s notice on the line at the next import', async () => {
    await importScheme(legacyLayout('Day', DAY))
    await remove('remove the light palette, Day')
    expect(undo()).not.toBeNull()
    await userEvent.click(document.querySelector('#workspace') as HTMLElement)
    await userEvent.click(document.querySelector('#reset-preset') as HTMLElement)
    const reset = 'Explorer reset — the default views are back'
    await until(() => notice() === reset, 'the reset notice')
    await importScheme(legacyLayout('Day', DAY))
    expect(palette().selectedOptions[0]?.textContent).toBe('custom — light: Day · dark: Night')
    expect(notice()).toBe(reset)
    await remove('remove the light palette, Day')
    expect(palette().selectedOptions[0]?.textContent).toBe('custom — dark: Night')
  })

  it('leaves a choice that was not custom as it was, when the last half goes', async () => {
    await choosePalette('terminal')
    await remove('remove the dark palette, Night')
    expect(stored()).toBeNull()
    expect(palette().value).toBe('terminal')
    expect(bg()).toBe(rgb(PALETTES.terminal.dark.bg))
  })

  it('says so when storage refuses an undo, which then lasts this load: the store stays as the removal left it', async () => {
    const cache = localStorage.getItem(PALETTE_CSS_KEY)
    const storage = refuseCustomWrites()
    try {
      await userEvent.click(undo() as HTMLElement)
      await until(
        () => notice() === 'the undo could not be saved; the palette goes again when the page is reloaded',
        'the notice',
      )
      expect(storage.refused).toEqual({ setItem: 1, removeItem: 0 })
      expect(options()).toHaveLength(5)
      expect(stored()).toBeNull()
      expect(localStorage.getItem(PALETTE_KEY)).toBe('terminal')
      expect(localStorage.getItem(PALETTE_CSS_KEY)).toBe(cache)
    } finally {
      storage.restore()
    }
  })

  /**
   * **A REFUSED REMOVAL LASTS THIS LOAD AND NO LONGER** (spec §7.1): the store is written first, and the choice and the
   * first paint only when it held, so a reload draws the palette the notice says comes back — from its first frame.
   * With a half left, the store would be rewritten (`setItem`); with none, its key removed (`removeItem`).
   */
  it('takes effect for this load when storage refuses it, and still offers undo — a half left, the store rewritten', async () => {
    await choosePalette('custom')
    await importScheme(legacyLayout('Day', DAY))
    expect(palette().selectedOptions[0]?.textContent).toBe('custom — light: Day · dark: Night')
    const before = stored()
    const cache = localStorage.getItem(PALETTE_CSS_KEY)
    const storage = refuseCustomWrites()
    try {
      await remove('remove the dark palette, Night')
      await until(
        () => notice() === 'the removal could not be saved; the palette comes back when the page is reloaded',
        'the notice',
      )
      expect(storage.refused).toEqual({ setItem: 1, removeItem: 0 })
      expect(undo()).not.toBeNull()
      expect(bg()).toBe(rgb(PALETTES.instrument.dark.bg))
      expect(stored()).toBe(before)
      expect(localStorage.getItem(PALETTE_KEY)).toBe('custom')
      expect(localStorage.getItem(PALETTE_CSS_KEY)).toBe(cache)
      expect(reloaded()).toBe(rgb(NIGHT[0]))
      // A LATER GESTURE REWRITES THE CACHE FROM WHAT STORAGE HOLDS, NOT FROM THIS LOAD'S MEMORY: after a style change the
      // page's dark half is the new style's own, and a reload still starts in the half storage kept.
      await chooseStyle('paper')
      expect(bg()).toBe(rgb(PALETTES.paper.dark.bg))
      expect(reloaded()).toBe(rgb(NIGHT[0]))
    } finally {
      storage.restore()
      // THE STYLE GOES BACK EVEN WHEN A CHECK ABOVE FAILED, so the cases after this one meet the page they expect.
      await chooseStyle('instrument')
    }
    await userEvent.click(undo() as HTMLElement)
    expect(JSON.parse(stored() ?? '{}')).toEqual(JSON.parse(before ?? ''))
  })

  it('takes effect for this load when storage refuses it — the last half, chosen as custom, the key removed', async () => {
    await remove('remove the light palette, Day')
    expect(palette().value).toBe('custom')
    const before = stored()
    const cache = localStorage.getItem(PALETTE_CSS_KEY)
    const storage = refuseCustomWrites()
    try {
      await remove('remove the dark palette, Night')
      await until(
        () => notice() === 'the removal could not be saved; the palette comes back when the page is reloaded',
        'the notice',
      )
      expect(storage.refused).toEqual({ setItem: 0, removeItem: 1 })
      expect(undo()).not.toBeNull()
      expect(options()).toHaveLength(4)
      expect(palette().value).toBe('match')
      expect(stored()).toBe(before)
      expect(localStorage.getItem(PALETTE_KEY)).toBe('custom')
      expect(localStorage.getItem(PALETTE_CSS_KEY)).toBe(cache)
      expect(reloaded()).toBe(rgb(NIGHT[0]))
      // AN UNDO STORAGE REFUSES TOO LOSES NOTHING, AND SAYS NOTHING: the store never lost the half it puts back.
      await userEvent.click(undo() as HTMLElement)
      expect(storage.refused).toEqual({ setItem: 1, removeItem: 1 })
      expect(notice()).toBe('')
      expect(palette().value).toBe('custom')
      expect(bg()).toBe(rgb(NIGHT[0]))
      expect(stored()).toBe(before)
    } finally {
      storage.restore()
    }
  })
})
