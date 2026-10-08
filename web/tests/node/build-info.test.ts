import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildOf, copyright, FIRST_YEAR, MIRROR } from '../../src/build-info'

const HASH = '8dc603d0a1b2c3d4e5f60718293a4b5c6d7e8f90'

describe('buildOf', () => {
  it('names a commit by its first seven characters and links the mirror at the whole hash', () => {
    expect(buildOf(HASH)).toEqual({ label: 'build 8dc603d', source: `${MIRROR}/tree/${HASH}` })
  })

  it('takes a short hash, and an upper-case or padded one, as the same commit', () => {
    expect(buildOf('8dc603d')).toEqual({ label: 'build 8dc603d', source: `${MIRROR}/tree/8dc603d` })
    expect(buildOf(` ${HASH.toUpperCase()}\n`)).toEqual(buildOf(HASH))
  })

  /**
   * `pnpm dev`, a local build and a `docker build` without the argument define it empty. **THE LAST THREE ROWS PIN THE
   * ANCHORS AND THE BOUND**, which alone keep a stray value out of the link: each holds a whole hash.
   */
  it.each([
    ['empty', ''],
    ['unset', undefined],
    ['too short', '8dc603'],
    ['not hex', 'main'],
    ['a URL', 'https://example.com/'],
    ['a hash with more after it', `${HASH}/x`],
    ['a hash with more before it', `x${HASH}`],
    ['41 digits', `${HASH}0`],
  ])('is a dev build linking main when the commit is %s', (_, commit) => {
    expect(buildOf(commit)).toEqual({ label: 'dev build', source: `${MIRROR}/tree/main` })
  })

  /**
   * **`BUILD` READS THE VARIABLE `vite.config.ts` DEFINES.** The environment is stubbed and the module imported afresh,
   * so a misspelt key, or a `BUILD` that ignores it, fails here whatever `COMMIT_HASH` the shell running the tests
   * holds. The config's half — the name it defines — only an image built with the argument can show.
   */
  describe('BUILD', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    it.each([
      ['a commit', HASH],
      ['none', ''],
    ])('is the build of the defined commit when it is %s', async (_, commit) => {
      vi.stubEnv('VITE_COMMIT_HASH', commit)
      vi.resetModules()
      const { BUILD } = await import('../../src/build-info')
      expect(BUILD).toEqual(buildOf(commit))
    })
  })
})

describe('copyright', () => {
  it('names the first year alone while it is still that year', () => {
    expect(copyright(new Date(FIRST_YEAR, 11, 31))).toBe('© 2026 Davey Hughes')
  })

  it('widens to a range from the first year once the clock is past it', () => {
    expect(copyright(new Date(2027, 0, 1))).toBe('© 2026–2027 Davey Hughes')
    expect(copyright(new Date(2031, 5, 15))).toBe('© 2026–2031 Davey Hughes')
  })

  /**
   * **THE VIEWER'S YEAR IS THEIR LOCAL ONE.** A date whose local and UTC years differ — as every clock's do for some
   * hours around New Year — reads the local year, independent of the zone the tests run in.
   */
  it("reads the viewer's local year, not the UTC one", () => {
    const newYear = { getFullYear: () => 2027, getUTCFullYear: () => 2026 } as unknown as Date
    expect(copyright(newYear)).toBe('© 2026–2027 Davey Hughes')
  })

  it('keeps the first year when the clock is behind it, rather than writing a range backwards', () => {
    expect(copyright(new Date(2025, 5, 15))).toBe('© 2026 Davey Hughes')
  })
})
