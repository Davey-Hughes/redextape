import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FORMAT_ON_BLUR,
  DEFAULT_KEYMAP,
  FORMAT_ON_BLUR_KEY,
  KEYMAP_KEY,
  readFormatOnBlur,
  readKeymap,
  writeFormatOnBlur,
  writeKeymap,
} from '../../src/editor-prefs'

/** A `Storage` with nothing behind it but a map. */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => map.set(k, v),
  } as Storage
}

/** A `Storage` that throws on every access, as a private window or blocked site data does. */
const hostileStorage = (): Storage =>
  ({
    get length(): number {
      throw new Error('denied')
    },
    clear: () => {
      throw new Error('denied')
    },
    getItem: () => {
      throw new Error('denied')
    },
    key: () => {
      throw new Error('denied')
    },
    removeItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    },
  }) as Storage

/**
 * **THIS FILE EXISTS BECAUSE A SABOTAGE DID NOT FIRE.** The browser test for *format on blur* sets
 * the checkbox and dispatches `change`, which writes the preference and updates the live flag — so
 * making `readFormatOnBlur` return `false` unconditionally left every one of those tests green. The
 * read path is what carries the setting across a page load, and nothing reached it.
 */
describe('format on blur, stored', () => {
  it('is off when nothing has been stored', () => {
    expect(readFormatOnBlur(memoryStorage())).toBe(DEFAULT_FORMAT_ON_BLUR)
    expect(DEFAULT_FORMAT_ON_BLUR).toBe(false)
  })

  it('round-trips on, which is what carries the setting across a page load', () => {
    const store = memoryStorage()
    writeFormatOnBlur(true, store)
    expect(store.getItem(FORMAT_ON_BLUR_KEY)).toBe('true')
    expect(readFormatOnBlur(store)).toBe(true)
  })

  it('round-trips off again', () => {
    const store = memoryStorage({ [FORMAT_ON_BLUR_KEY]: 'true' })
    expect(readFormatOnBlur(store)).toBe(true)
    writeFormatOnBlur(false, store)
    expect(readFormatOnBlur(store)).toBe(false)
  })

  it('reads anything that is not exactly `true` as off', () => {
    // A value from a future version, or one a user typed into devtools, must not read as on.
    for (const v of ['1', 'yes', 'TRUE', '', 'false']) {
      expect(readFormatOnBlur(memoryStorage({ [FORMAT_ON_BLUR_KEY]: v })), v).toBe(false)
    }
  })

  /**
   * `localStorage` throws on access in a private window and under blocked site data. A preference
   * read must never be what stops the app starting.
   */
  it('survives a storage that throws, in both directions', () => {
    expect(() => readFormatOnBlur(hostileStorage())).not.toThrow()
    expect(readFormatOnBlur(hostileStorage())).toBe(DEFAULT_FORMAT_ON_BLUR)
    expect(() => writeFormatOnBlur(true, hostileStorage())).not.toThrow()
  })
})

/**
 * **THE SAME SABOTAGE, AIMED AT THE SAME PLACE ONE SETTING LATER.** `vim-keymap.test.ts` drives the
 * keymap through the app and seeds storage before its one mount, so it does read this path back — but
 * it reads it once, through a whole page. These are the cases that page cannot reach: a value stored
 * by some other version of this app, and a storage that refuses.
 */
describe('the keymap, stored', () => {
  it("is CodeMirror's own bindings when nothing has been stored", () => {
    expect(readKeymap(memoryStorage())).toBe(DEFAULT_KEYMAP)
    expect(DEFAULT_KEYMAP).toBe('default')
  })

  it('round-trips vim, which is what carries the setting across a page load', () => {
    const store = memoryStorage()
    writeKeymap('vim', store)
    expect(store.getItem(KEYMAP_KEY)).toBe('vim')
    expect(readKeymap(store)).toBe('vim')
  })

  it('round-trips back to the default', () => {
    const store = memoryStorage({ [KEYMAP_KEY]: 'vim' })
    expect(readKeymap(store)).toBe('vim')
    writeKeymap('default', store)
    expect(readKeymap(store)).toBe('default')
  })

  it('reads anything that is not exactly `vim` as the default', () => {
    // A mode a later version added, or a word a user typed into devtools, must not install a keymap
    // this version has no extension for — `readKeymap`'s own doc has the argument against a cast.
    for (const v of ['VIM', 'Vim', 'emacs', '', 'vi']) {
      expect(readKeymap(memoryStorage({ [KEYMAP_KEY]: v })), v).toBe(DEFAULT_KEYMAP)
    }
  })

  it('survives a storage that throws, in both directions', () => {
    expect(() => readKeymap(hostileStorage())).not.toThrow()
    expect(readKeymap(hostileStorage())).toBe(DEFAULT_KEYMAP)
    expect(() => writeKeymap('vim', hostileStorage())).not.toThrow()
  })
})
