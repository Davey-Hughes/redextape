import { describe, expect, it } from 'vitest'
import { type Appearance, applyAppearance, nextAppearance, readStored } from '../../src/appearance'

describe('nextAppearance', () => {
  it('cycles system -> light -> dark -> system', () => {
    expect(nextAppearance('system')).toBe('light')
    expect(nextAppearance('light')).toBe('dark')
    expect(nextAppearance('dark')).toBe('system')
  })

  it('the full cycle returns to where it started', () => {
    const start: Appearance = 'system'
    let cur: Appearance = start
    for (let i = 0; i < 3; i++) cur = nextAppearance(cur)
    expect(cur).toBe(start)
  })
})

describe('readStored', () => {
  it('falls back to system for null — nothing stored yet', () => {
    expect(readStored(null)).toBe('system')
  })

  it('falls back to system for the empty string — a cleared value', () => {
    expect(readStored('')).toBe('system')
  })

  it('reads back each valid value unchanged', () => {
    expect(readStored('light')).toBe('light')
    expect(readStored('dark')).toBe('dark')
    expect(readStored('system')).toBe('system')
  })

  // Anything unrecognised must fail open to `system`, including a value this build does not know —
  // what a stale write from a future version would look like.
  it('falls back to system for garbage, including an unrecognised future value', () => {
    expect(readStored('purple')).toBe('system')
    expect(readStored('LIGHT')).toBe('system')
    expect(readStored('auto')).toBe('system')
  })
})

describe('applyAppearance', () => {
  // A plain object, not jsdom — the node project has no DOM. `setAttribute`/`removeAttribute` are
  // all `applyAppearance` needs, so a minimal stub exercises the real branching without pulling in a
  // DOM implementation this project's node tests otherwise never depend on.
  function stubRoot(): { calls: string[]; el: Pick<HTMLElement, 'setAttribute' | 'removeAttribute'> } {
    const calls: string[] = []
    const el: Pick<HTMLElement, 'setAttribute' | 'removeAttribute'> = {
      setAttribute(name: string, value: string) {
        calls.push(`set ${name}=${value}`)
      },
      removeAttribute(name: string) {
        calls.push(`remove ${name}`)
      },
    }
    return { calls, el }
  }

  it('sets data-theme="light" for light', () => {
    const { calls, el } = stubRoot()
    applyAppearance(el as HTMLElement, 'light')
    expect(calls).toEqual(['set data-theme=light'])
  })

  it('sets data-theme="dark" for dark', () => {
    const { calls, el } = stubRoot()
    applyAppearance(el as HTMLElement, 'dark')
    expect(calls).toEqual(['set data-theme=dark'])
  })

  // THE CASE THE WHOLE DESIGN HINGES ON. `system` must REMOVE the attribute, not set it to the
  // literal string `"system"` — the CSS has no rule to match that value, so setting it would pin the
  // page to whatever `:root`'s own cascade resolves to at that moment instead of tracking
  // `prefers-color-scheme` as the OS changes.
  it('removes data-theme for system, rather than setting it to the string "system"', () => {
    const { calls, el } = stubRoot()
    applyAppearance(el as HTMLElement, 'system')
    expect(calls).toEqual(['remove data-theme'])
  })
})
