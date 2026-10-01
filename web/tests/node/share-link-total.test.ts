import { deflateRawSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { decodeLink, LINK_PREFIX } from '../../src/share-link'
import { defaultWorkspace, parseWorkspace, serializeWorkspace } from '../../src/workspace'

/**
 * **READING A LINK CANNOT THROW** (Plan 7 part 6a spec §5.3, amended 2026-10-01): a throw while its workspace is read
 * opens the program alone, and any other makes the link unreadable, so `main.ts` always clears the fragment and says
 * what became of it. The bound on a tree removed the throws a link was known to cause, so these cases make their own.
 *
 * **A FILE OF ITS OWN FOR THE MOCK**: `parseWorkspace` is replaced for every case in a file, here by one that does what
 * the real one does until a case says otherwise.
 */
vi.mock('../../src/workspace', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/workspace')>()
  return { ...real, parseWorkspace: vi.fn(real.parseWorkspace) }
})

const LINK = `${LINK_PREFIX}${deflateRawSync(
  Buffer.from(
    JSON.stringify({
      version: 1,
      program: 'let x = 40; x + 2',
      encoding: 'binary',
      workspace: serializeWorkspace(defaultWorkspace()),
      positions: {},
    }),
  ),
).toString('base64url')}`

describe('a link whose reading throws', () => {
  it('opens whole when nothing throws', async () => {
    expect(await decodeLink(LINK, ['unary', 'binary'])).toMatchObject({ kind: 'whole' })
  })

  it('opens the program alone when reading its workspace throws', async () => {
    vi.mocked(parseWorkspace).mockImplementationOnce(() => {
      throw new RangeError('Maximum call stack size exceeded')
    })
    expect(await decodeLink(LINK, ['unary', 'binary'])).toEqual({
      kind: 'program',
      program: 'let x = 40; x + 2',
      encoding: 'binary',
    })
    expect(vi.mocked(parseWorkspace).mock.results.at(-1)?.type).toBe('throw')
  })

  /** As one does in an engine whose decompressor has no `deflate-raw`. */
  it('is unreadable when the decompressor throws', async () => {
    const Real = globalThis.DecompressionStream
    globalThis.DecompressionStream = class {
      constructor() {
        throw new TypeError('Unsupported compression format')
      }
    } as unknown as typeof DecompressionStream
    try {
      expect(await decodeLink(LINK, ['unary', 'binary'])).toEqual({ kind: 'unreadable' })
    } finally {
      globalThis.DecompressionStream = Real
    }
  })
})
