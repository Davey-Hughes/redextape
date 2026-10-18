import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { STORAGE_KEY } from '../../src/appearance'
import { CUSTOM_PALETTE_KEY, type CustomHalf, serializeCustomPalette } from '../../src/custom-palette'
import { PALETTES } from '../../src/palettes'
import { PALETTE_CSS_KEY, PALETTE_KEY } from '../../src/skin'
import {
  adjustedHalf,
  currentLayout,
  DAY,
  EMBER,
  legacyLayout,
  NIGHT,
  storedHalf,
  storedPalette,
} from '../node/base16-fixtures'
import {
  base16Dialog,
  bodyBackground,
  choosePalette,
  chooseStyle,
  noticeText,
  paletteSelect,
  reloaded,
  rgb,
  SHELL,
  undoButton,
  until,
} from './harness'

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

const removeButtons = () => [...base16Dialog().querySelectorAll<HTMLButtonElement>('button.base16-remove')]
const options = () => [...paletteSelect().options].map((o) => o.textContent)

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
  expect(base16Dialog().open).toBe(true)
}

/** Import `scheme` through the dialog, applied as it is. */
async function importScheme(scheme: string): Promise<void> {
  await open()
  await userEvent.fill(base16Dialog().querySelector('textarea') as HTMLElement, scheme)
  await userEvent.click(base16Dialog().querySelector('button.base16-check') as HTMLElement)
  await userEvent.click(base16Dialog().querySelector('button.base16-apply') as HTMLElement)
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
    expect(base16Dialog().querySelector('.base16-now-line')?.textContent).toBe(
      'now: light — Day remove · dark — Ember, adjusted remove',
    )
    expect(removeButtons().map((b) => [b.textContent, b.getAttribute('aria-label'), b.title])).toEqual([
      ['remove', 'remove the light palette, Day', 'remove the light palette, Day'],
      ['remove', 'remove the dark palette, Ember', 'remove the dark palette, Ember'],
    ])
    expect(document.activeElement).toBe(base16Dialog().querySelector('textarea'))
  })

  it('lists the colours an adjusted half moved, read from what is stored, behind changes', async () => {
    const toggle = base16Dialog().querySelector<HTMLElement>(
      '.panel[data-panel="base16-now-changes"] button.panel-toggle',
    )
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(toggle as HTMLElement)
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect([...base16Dialog().querySelectorAll('.base16-now-changes li')].map((li) => li.textContent)).toEqual([
      'base04 #7e7590 → #958ca7, as dim text, plain code and punctuation',
      'base05 #8a829a → #a09ab0, as text and names',
      'base08 #c06070 → #e08090, as error text',
      'base0E #9070a0 → #a584b5, as accents and keywords',
    ])
    // THE HALF IS A LABEL AND TAKES THE STYLE'S CASE; THE SCHEME'S NAME IS DATA AND KEEPS ITS OWN. Instrument upper-cases
    // labels, so this is where a name would be changed, and `innerText` is what the page shows.
    expect(document.documentElement.getAttribute('data-style')).toBe('instrument')
    const label = base16Dialog().querySelector<HTMLElement>('.base16-now-changes .base16-changes-label') as HTMLElement
    expect(getComputedStyle(label).textTransform).toBe('uppercase')
    expect(getComputedStyle(label.querySelector('.base16-scheme-name') as HTMLElement).textTransform).toBe('none')
    expect(label.innerText).toBe('DARK — Ember')
    await userEvent.keyboard('{Escape}')
  })
})

describe('removing a half', () => {
  it('deletes it and keeps the other: the choice stays custom, and the page falls back where it was', async () => {
    expect(bodyBackground()).toBe(rgb(EMBER[0]))
    await remove('remove the dark palette, Ember')
    expect(base16Dialog().open).toBe(false)
    expect(document.activeElement).toBe(document.querySelector('#settings'))
    expect(JSON.parse(storedPalette() ?? '{}')).toEqual({ version: 1, light: storedHalf('Day', DAY) })
    expect(paletteSelect().value).toBe('custom')
    expect(paletteSelect().selectedOptions[0]?.textContent).toBe('custom — light: Day')
    expect(bodyBackground()).toBe(rgb(PALETTES.instrument.dark.bg))
    expect(noticeText()).toBe('dark palette Ember removed')
  })

  // BY THE KEYBOARD, FROM WHERE THE REMOVAL LEFT THE FOCUS: the line's undo is the next stop after `settings`, and the
  // focus goes back there when it is used, not to the copies button the line falls back to for a copy's undo.
  it('is undone exactly: the half as it was stored, adjusted included, and the focus is back on settings', async () => {
    const settings = document.querySelector('#settings')
    expect(document.activeElement).toBe(settings)
    await userEvent.tab()
    expect(document.activeElement).toBe(undoButton())
    await userEvent.keyboard('{Enter}')
    expect(storedPalette()).toBe(SEEDED)
    expect(paletteSelect().selectedOptions[0]?.textContent).toBe('custom — light: Day · dark: Ember (adjusted)')
    expect(bodyBackground()).toBe(rgb(EMBER[0]))
    expect(document.activeElement).toBe(settings)
  })

  // THE UNDO PUTS BACK WHAT THE REMOVAL CHANGED, AND ONLY THAT: a palette chosen while it was on offer is the user's.
  it('leaves a choice made after the removal as it is, on undo', async () => {
    await remove('remove the dark palette, Ember')
    expect(paletteSelect().value).toBe('custom')
    await choosePalette('paper')
    await userEvent.click(undoButton() as HTMLElement)
    expect(storedPalette()).toBe(SEEDED)
    expect(paletteSelect().value).toBe('paper')
    expect(localStorage.getItem(PALETTE_KEY)).toBe('paper')
    expect(bodyBackground()).toBe(rgb(PALETTES.paper.dark.bg))
    expect(options().at(-1)).toBe('custom — light: Day · dark: Ember (adjusted)')
    await choosePalette('custom')
    expect(bodyBackground()).toBe(rgb(EMBER[0]))
  })

  it('removes the key with the last half, and a custom choice becomes match', async () => {
    await remove('remove the light palette, Day')
    await remove('remove the dark palette, Ember')
    expect(storedPalette()).toBeNull()
    expect(options()).toEqual(['match style', 'Paper', 'Terminal', 'Instrument'])
    expect(paletteSelect().value).toBe('match')
    expect(localStorage.getItem(PALETTE_KEY)).toBe('match')
    expect(bodyBackground()).toBe(rgb(PALETTES.instrument.dark.bg))
    await open()
    expect(base16Dialog().querySelector<HTMLElement>('.base16-now')?.hidden).toBe(true)
    await userEvent.keyboard('{Escape}')
  })

  it('puts back a custom choice the last half’s removal made match, on undo', async () => {
    await userEvent.click(undoButton() as HTMLElement)
    expect(paletteSelect().value).toBe('custom')
    expect(paletteSelect().selectedOptions[0]?.textContent).toBe('custom — dark: Ember (adjusted)')
    expect(bodyBackground()).toBe(rgb(EMBER[0]))
  })

  it('leaves a choice made after the last half’s removal made it match, on undo', async () => {
    await remove('remove the dark palette, Ember')
    expect(paletteSelect().value).toBe('match')
    await choosePalette('terminal')
    await userEvent.click(undoButton() as HTMLElement)
    expect(paletteSelect().value).toBe('terminal')
    expect(options().at(-1)).toBe('custom — dark: Ember (adjusted)')
    expect(bodyBackground()).toBe(rgb(PALETTES.terminal.dark.bg))
    await choosePalette('custom')
    expect(bodyBackground()).toBe(rgb(EMBER[0]))
  })

  // BY THE GESTURE, NOT BY THE VALUE: a user who picks another palette and then the one the removal left has chosen it.
  it('keeps the choice the removal left when the user picked it back, on undo', async () => {
    await remove('remove the dark palette, Ember')
    expect(paletteSelect().value).toBe('match')
    await choosePalette('terminal')
    await choosePalette('match')
    await userEvent.click(undoButton() as HTMLElement)
    expect(paletteSelect().value).toBe('match')
    expect(localStorage.getItem(PALETTE_KEY)).toBe('match')
    expect(options().at(-1)).toBe('custom — dark: Ember (adjusted)')
    expect(bodyBackground()).toBe(rgb(PALETTES.instrument.dark.bg))
    await choosePalette('custom')
    expect(bodyBackground()).toBe(rgb(EMBER[0]))
  })

  it('ends its undo at the next import', async () => {
    await remove('remove the dark palette, Ember')
    expect(undoButton()).not.toBeNull()
    await open()
    await userEvent.fill(base16Dialog().querySelector('textarea') as HTMLElement, currentLayout('Night', NIGHT, 'dark'))
    await userEvent.click(base16Dialog().querySelector('button.base16-check') as HTMLElement)
    await userEvent.click(base16Dialog().querySelector('button.base16-apply') as HTMLElement)
    expect(undoButton()).toBeNull()
    expect(paletteSelect().selectedOptions[0]?.textContent).toBe('custom — dark: Night')
  })

  // ONCE ANOTHER GESTURE HAS SPOKEN OVER THE UNDO, THE LINE IS THAT GESTURE'S: an import ends its own removal's offer,
  // not whatever the line says now.
  it('leaves another gesture’s notice on the line at the next import', async () => {
    await importScheme(legacyLayout('Day', DAY))
    await remove('remove the light palette, Day')
    expect(undoButton()).not.toBeNull()
    await userEvent.click(document.querySelector('#workspace') as HTMLElement)
    await userEvent.click(document.querySelector('#reset-preset') as HTMLElement)
    const reset = 'Explorer reset — the default views are back'
    await until(() => noticeText() === reset, 'the reset notice')
    await importScheme(legacyLayout('Day', DAY))
    expect(paletteSelect().selectedOptions[0]?.textContent).toBe('custom — light: Day · dark: Night')
    expect(noticeText()).toBe(reset)
    await remove('remove the light palette, Day')
    expect(paletteSelect().selectedOptions[0]?.textContent).toBe('custom — dark: Night')
  })

  it('leaves a choice that was not custom as it was, when the last half goes', async () => {
    await choosePalette('terminal')
    await remove('remove the dark palette, Night')
    expect(storedPalette()).toBeNull()
    expect(paletteSelect().value).toBe('terminal')
    expect(bodyBackground()).toBe(rgb(PALETTES.terminal.dark.bg))
  })

  it('says so when storage refuses an undo, which then lasts this load: the store stays as the removal left it', async () => {
    const cache = localStorage.getItem(PALETTE_CSS_KEY)
    const storage = refuseCustomWrites()
    try {
      await userEvent.click(undoButton() as HTMLElement)
      await until(
        () => noticeText() === 'the undo could not be saved; the palette goes again when the page is reloaded',
        'the notice',
      )
      expect(storage.refused).toEqual({ setItem: 1, removeItem: 0 })
      expect(options()).toHaveLength(5)
      expect(storedPalette()).toBeNull()
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
    expect(paletteSelect().selectedOptions[0]?.textContent).toBe('custom — light: Day · dark: Night')
    const before = storedPalette()
    const cache = localStorage.getItem(PALETTE_CSS_KEY)
    const storage = refuseCustomWrites()
    try {
      await remove('remove the dark palette, Night')
      await until(
        () => noticeText() === 'the removal could not be saved; the palette comes back when the page is reloaded',
        'the notice',
      )
      expect(storage.refused).toEqual({ setItem: 1, removeItem: 0 })
      expect(undoButton()).not.toBeNull()
      expect(bodyBackground()).toBe(rgb(PALETTES.instrument.dark.bg))
      expect(storedPalette()).toBe(before)
      expect(localStorage.getItem(PALETTE_KEY)).toBe('custom')
      expect(localStorage.getItem(PALETTE_CSS_KEY)).toBe(cache)
      expect(reloaded()).toBe(rgb(NIGHT[0]))
      // A LATER GESTURE REWRITES THE CACHE FROM WHAT STORAGE HOLDS, NOT FROM THIS LOAD'S MEMORY: after a style change the
      // page's dark half is the new style's own, and a reload still starts in the half storage kept.
      await chooseStyle('paper')
      expect(bodyBackground()).toBe(rgb(PALETTES.paper.dark.bg))
      expect(reloaded()).toBe(rgb(NIGHT[0]))
    } finally {
      storage.restore()
      // THE STYLE GOES BACK EVEN WHEN A CHECK ABOVE FAILED, so the cases after this one meet the page they expect.
      await chooseStyle('instrument')
    }
    await userEvent.click(undoButton() as HTMLElement)
    expect(JSON.parse(storedPalette() ?? '{}')).toEqual(JSON.parse(before ?? ''))
  })

  it('takes effect for this load when storage refuses it — the last half, chosen as custom, the key removed', async () => {
    await remove('remove the light palette, Day')
    expect(paletteSelect().value).toBe('custom')
    const before = storedPalette()
    const cache = localStorage.getItem(PALETTE_CSS_KEY)
    const storage = refuseCustomWrites()
    try {
      await remove('remove the dark palette, Night')
      await until(
        () => noticeText() === 'the removal could not be saved; the palette comes back when the page is reloaded',
        'the notice',
      )
      expect(storage.refused).toEqual({ setItem: 0, removeItem: 1 })
      expect(undoButton()).not.toBeNull()
      expect(options()).toHaveLength(4)
      expect(paletteSelect().value).toBe('match')
      expect(storedPalette()).toBe(before)
      expect(localStorage.getItem(PALETTE_KEY)).toBe('custom')
      expect(localStorage.getItem(PALETTE_CSS_KEY)).toBe(cache)
      expect(reloaded()).toBe(rgb(NIGHT[0]))
      // AN UNDO STORAGE REFUSES TOO LOSES NOTHING, AND SAYS NOTHING: the store never lost the half it puts back.
      await userEvent.click(undoButton() as HTMLElement)
      expect(storage.refused).toEqual({ setItem: 1, removeItem: 1 })
      expect(noticeText()).toBe('')
      expect(paletteSelect().value).toBe('custom')
      expect(bodyBackground()).toBe(rgb(NIGHT[0]))
      expect(storedPalette()).toBe(before)
    } finally {
      storage.restore()
    }
  })
})
