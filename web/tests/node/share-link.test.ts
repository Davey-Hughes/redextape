import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { LEGS } from '../../src/legs'
import {
  decodeLink,
  encodeLink,
  isLink,
  LINK_PREFIX,
  MAX_LINK_BYTES,
  type Positions,
  type SharePayload,
} from '../../src/share-link'
import { defaultWorkspace, PRESETS, type Preset, parseWorkspace, SPEEDS, serializeWorkspace } from '../../src/workspace'

/**
 * The share link's codec (Plan 7 part 6a spec §5.1, §5.3, §8's node row): what `encodeLink` writes `decodeLink` reads
 * back whole; every way a link can fail to be read, and every way it opens the program alone; and the frozen link from
 * the format's first version, which must go on opening. `CompressionStream` and `DecompressionStream` are node globals,
 * and node reads Chrome's links (spec §A.3).
 */

/** The encodings `main.ts` hands in, as `encodings()` lists them today. */
const ENCODINGS = ['unary', 'binary']

const WORKSPACE = serializeWorkspace(defaultWorkspace())

/** A link carrying `text` as its payload's JSON, deflated by node's own encoder: any payload, valid or not. */
const linkOf = (text: string | Uint8Array): string =>
  `${LINK_PREFIX}${deflateRawSync(typeof text === 'string' ? Buffer.from(text) : text).toString('base64url')}`

/** A link whose payload is a valid one with `fields` merged over it — the shape a hand-edit or a later version makes. */
const payloadLink = (fields: Record<string, unknown>): string =>
  linkOf(
    JSON.stringify({
      version: 1,
      program: 'let x = 40; x + 2',
      encoding: 'binary',
      workspace: WORKSPACE,
      positions: { lambda: 7 },
      ...fields,
    }),
  )

describe('encodeLink and decodeLink', () => {
  /** A seeded generator, so a failure names a payload that stays the same. */
  const random = (seed: number): (() => number) => {
    let s = seed
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648
      return s / 2147483648
    }
  }
  /** What a program's text can hold that JSON or UTF-8 treats specially: quotes, escapes, λ, a surrogate pair, U+2028. */
  const PIECES = ['let x = 40;', '\n', '\t', '"', '\\', 'λx. x', '🦀', ' ', ' ', '{}', 'fn f(n) {', '}', '0']

  const generated = (seed: number): SharePayload => {
    const next = random(seed)
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T
    const program = Array.from({ length: Math.floor(next() * 400) }, () => pick(PIECES)).join('')
    const preset = pick(Object.keys(PRESETS) as Preset[])
    const workspace = serializeWorkspace({ ...defaultWorkspace(), switches: PRESETS[preset], speed: pick(SPEEDS) })
    const positions: { [L in (typeof LEGS)[number]]?: number } = {}
    for (const leg of LEGS) {
      if (next() < 0.5) continue
      positions[leg] = pick([0, 1, Math.floor(next() * 100_000), Number.MAX_SAFE_INTEGER])
    }
    return { program, encoding: pick(ENCODINGS), workspace, positions }
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('reads back whole what it wrote, generated from seed %i', async (seed) => {
    const payload = generated(seed)
    const fragment = await encodeLink(payload)
    expect(await decodeLink(fragment, ENCODINGS)).toEqual({
      kind: 'whole',
      program: payload.program,
      encoding: payload.encoding,
      workspace: parseWorkspace(payload.workspace),
      positions: payload.positions,
    })
  })

  /** Over every seed, since one payload's deflated length needs no padding in two of three cases. */
  it('writes `#s=` and unpadded base64url, and nothing else', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const fragment = await encodeLink(generated(seed))
      expect(fragment, `seed ${seed}`).toMatch(/^#s=[A-Za-z0-9_-]+$/)
      expect(isLink(fragment)).toBe(true)
    }
  })

  it('writes version 1, the program, the encoding, the workspace string and the positions', async () => {
    const payload = generated(10)
    const fragment = await encodeLink(payload)
    const inflated = await new Response(
      new Blob([Buffer.from(fragment.slice(LINK_PREFIX.length), 'base64url')])
        .stream()
        .pipeThrough(new DecompressionStream('deflate-raw')),
    ).text()
    expect(JSON.parse(inflated)).toEqual({ version: 1, ...payload })
  })
})

/**
 * **THE FROZEN LINK: THE FORMAT'S FIRST VERSION, AS CHROME WROTE IT, WHICH MUST GO ON OPENING** (umbrella §8.4, spec
 * §5.1). Written once by `encodeLink` in Chrome, from `sum_to(5)` under `binary`, the Debugger preset's workspace and a
 * position on each leg. It pins the reading, never an encoder's bytes: node and Chrome deflate one payload differently.
 * Its workspace is `version: 2`, so it pins `parseWorkspace`'s reading of version 2 for good too: a later workspace
 * version migrates version 2 rather than refusing it.
 */
describe('the frozen link from version 1', () => {
  const FROZEN =
    '#s=tZDRahsxEEV_ZZinhipBKTW0CulT_yJjiqwdxyLSaJG0Memy_16ktWnc0pQ-VA8SHO69czUzPnMuPgmaW4VjTo_ZRjS4FyhT_FbTO7mCmQQAIHCFOFWwzsE96LuVHg8-MAh8AX0WtrOK2v0e5O4nF7gHgWu4PbFlfaxzJAvJaejmigQVsrg0eHlEgzsvNr-gwmPKT2W0jtHgTOf6hOaDIqyZmdDMhE9eBkJDWMbgK6EiHHzuxKUwRemo-O9cCM2DvtkofbPZKkJ38GHI3CIf3g7K6fjPKYHtvpv8KTVN2XEnoxW-YIt6yxls3A32Wl96V0q4bC_d_6e9LfHXArbEvzWvv5lq7I23S-tz9NUdeqWZsFQeS9fsbO6mZ8_HlVQfmkwRZrZDmmqnXsrIrqbcarSPM7exnxThPrmp8B_WF_rEZnmVYGqeuC-tjMG-nBU1fn0FFlQ4puKrT1LQzKdsNButVVsImo9aYY1oPmutl-UH'

  it('opens whole, as the program, the encoding, the workspace and the positions it was written with', async () => {
    expect(await decodeLink(FROZEN, ENCODINGS)).toEqual({
      kind: 'whole',
      program:
        'fn sum_to(n) {\n    let mut acc = 0;\n    while n > 0 {\n        acc = acc + n;\n        n = n - 1;\n    }\n    acc\n}\nsum_to(5)\n',
      encoding: 'binary',
      workspace: {
        tree: {
          kind: 'split',
          dir: 'column',
          sizes: [0.5, 0.5],
          children: [
            {
              kind: 'split',
              dir: 'row',
              sizes: [0.5, 0.5],
              children: [
                { kind: 'leaf', id: 'source', pane: 'source' },
                { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
              ],
            },
            {
              kind: 'split',
              dir: 'row',
              sizes: [0.5, 0.5],
              children: [
                { kind: 'leaf', id: 'asm-0', pane: 'asm' },
                { kind: 'leaf', id: 'tm-0', pane: 'tm' },
              ],
            },
          ],
        },
        switches: { steps: 'bar', views: 'tiles', readout: 'inspector' },
        speed: 8,
        focused: 'lambda-0',
        panels: {},
        inspector: true,
        display: {},
        tmDisplay: {},
      },
      positions: { lambda: 500, asm: 40, tm: 9000 },
    })
  })
})

describe('a link nothing can be read from', () => {
  it.each([
    ['a character base64url does not have', '#s=ab*d'],
    ['padding', '#s=YWJj='],
    ['a length base64 cannot end on', '#s=YWJjZ'],
    ['nothing after the prefix, as a paste cut short leaves it', '#s='],
  ])('refuses %s', async (_, fragment) => {
    expect(await decodeLink(fragment, ENCODINGS)).toEqual({ kind: 'unreadable' })
  })

  it('refuses bytes that are not a deflate stream', async () => {
    const plain = Buffer.from(JSON.stringify({ version: 1, program: 'x' })).toString('base64url')
    expect(await decodeLink(`${LINK_PREFIX}${plain}`, ENCODINGS)).toEqual({ kind: 'unreadable' })
  })

  it('refuses a stream cut short, and one with bytes after its end', async () => {
    const whole = deflateRawSync(Buffer.from(JSON.stringify({ version: 1, program: 'let x = 40; x + 2' })))
    const cut = `${LINK_PREFIX}${whole.subarray(0, whole.length - 4).toString('base64url')}`
    const trailing = `${LINK_PREFIX}${Buffer.concat([whole, Buffer.from([0, 1, 2])]).toString('base64url')}`
    expect(await decodeLink(cut, ENCODINGS)).toEqual({ kind: 'unreadable' })
    expect(await decodeLink(trailing, ENCODINGS)).toEqual({ kind: 'unreadable' })
  })

  /**
   * **NOT UTF-8 INSIDE A STRING THAT IS OTHERWISE A PROGRAM**, so what refuses it is the decoding and not the JSON: read
   * leniently, `0xff` would become U+FFFD and the program would open. A JSON array is refused by having no `program`.
   */
  it('refuses a payload that is not UTF-8, or not JSON, or JSON that is not an object', async () => {
    const bytes = new TextEncoder().encode('{"program":"let x = 40; x + 2"}')
    bytes[13] = 0xff
    expect(await decodeLink(linkOf(bytes), ENCODINGS)).toEqual({ kind: 'unreadable' })
    for (const text of ['{"version": 1, "program"', 'null', '[]', '"let x = 1"', '42'])
      expect(await decodeLink(linkOf(text), ENCODINGS), text).toEqual({ kind: 'unreadable' })
  })

  it('refuses a payload whose program is missing or not a string', async () => {
    for (const program of [undefined, 42, null, ['let x = 1']])
      expect(await decodeLink(payloadLink({ program }), ENCODINGS), String(program)).toEqual({ kind: 'unreadable' })
  })

  /**
   * **THE CAP IS THE ONE BOUND A LINK HAS** (`MAX_LINK_BYTES`' own doc): a payload of exactly the cap is read, and one
   * byte more is refused. Both are a program of `a`s, which deflate to a few kilobytes.
   */
  it('reads a payload of exactly MAX_LINK_BYTES, and refuses one a byte longer', async () => {
    const around = (bytes: number): string => {
      const shell = JSON.stringify({ program: '' })
      return linkOf(JSON.stringify({ program: 'a'.repeat(bytes - shell.length) }))
    }
    expect(await decodeLink(around(MAX_LINK_BYTES), ENCODINGS)).toMatchObject({ kind: 'program' })
    expect(await decodeLink(around(MAX_LINK_BYTES + 1), ENCODINGS)).toEqual({ kind: 'unreadable' })
  })
})

describe('a link that opens the program alone', () => {
  const alone = (encoding: string | null) => ({ kind: 'program', program: 'let x = 40; x + 2', encoding })

  it('opens the program alone, under its encoding, for a version other than 1', async () => {
    for (const version of [2, '1', undefined])
      expect(await decodeLink(payloadLink({ version }), ENCODINGS), String(version)).toEqual(alone('binary'))
  })

  it('opens the program alone, with no encoding, for an encoding this build does not have', async () => {
    for (const encoding of ['ternary', 3, undefined])
      expect(await decodeLink(payloadLink({ encoding }), ENCODINGS), String(encoding)).toEqual(alone(null))
  })

  it("opens the program alone for a workspace that is not `serializeWorkspace`'s string, or that it refuses", async () => {
    for (const workspace of [JSON.parse(WORKSPACE), undefined, '{}', 'not json'])
      expect(await decodeLink(payloadLink({ workspace }), ENCODINGS), String(workspace)).toEqual(alone('binary'))
  })

  it.each([
    ['missing', undefined],
    ['an array, even an empty one', []],
    ['a key that is not a leg', { lamda: 7 }],
    ['a negative step', { lambda: -1 }],
    ['a step that is not an integer', { asm: 1.5 }],
    ['a step past the safe integers', { tm: 2 ** 53 }],
    ['a step written as a string', { lambda: '7' }],
    ['an object whose only key is `__proto__`', JSON.parse('{"__proto__":1}')],
    ['an object whose only key is `constructor`', { constructor: 1 }],
  ])('opens the program alone for positions that are %s', async (_, positions) => {
    expect(await decodeLink(payloadLink({ positions }), ENCODINGS)).toEqual(alone('binary'))
  })

  it('opens whole with no positions at all, and with a step of 0', async () => {
    for (const positions of [{}, { tm: 0 }] as Positions[])
      expect(await decodeLink(payloadLink({ positions }), ENCODINGS)).toMatchObject({ kind: 'whole', positions })
  })
})

/**
 * **A LINK'S TREE IS HELD TO THE BOUND A STORED ONE IS** (spec §5.3, amended 2026-10-01): at most 64 splits deep and 64
 * leaves, and leaf ids whose numbers the leaf counter can step past. A workspace past it opens the program alone.
 */
describe("a link whose workspace's tree is past the bound", () => {
  const alone = { kind: 'program', program: 'let x = 40; x + 2', encoding: 'binary' }
  /** The default workspace's string with `tree` in place of its tree, and `pane-1` focused. */
  const holding = (tree: unknown): string => JSON.stringify({ ...JSON.parse(WORKSPACE), tree, focused: 'pane-1' })
  const lambda = (n: number) => ({ kind: 'leaf', id: `pane-${n}`, pane: 'lambda' })
  /** One split of `n` λ leaves. */
  const flat = (n: number): unknown => ({
    kind: 'split',
    dir: 'row',
    sizes: Array.from({ length: n }, () => 1 / n),
    children: Array.from({ length: n }, (_, i) => lambda(i + 1)),
  })
  /** `depth` splits deep down each split's first child, whose second child is a leaf. */
  const spine = (depth: number): unknown => {
    let node: unknown = lambda(0)
    for (let i = 1; i <= depth; i++)
      node = { kind: 'split', dir: 'row', sizes: [0.5, 0.5], children: [node, lambda(i)] }
    return node
  }
  /**
   * `depth` splits deep down each split's second child, whose first child is a leaf, as `+ view` nested views until
   * 2026-10-04.
   */
  const trailing = (depth: number): unknown => {
    let node: unknown = lambda(depth)
    for (let i = depth - 1; i >= 0; i--)
      node = { kind: 'split', dir: 'row', sizes: [0.5, 0.5], children: [lambda(i), node] }
    return node
  }

  it.each([
    ['first', spine],
    ['second', trailing],
  ])(
    'opens the program alone, and does not throw, for a tree 10,000 splits deep down its %s children',
    async (_, deep) => {
      await expect(decodeLink(payloadLink({ workspace: holding(deep(10_000)) }), ENCODINGS)).resolves.toEqual(alone)
    },
  )

  it('opens whole with 64 leaves, and the program alone with 65', async () => {
    expect(await decodeLink(payloadLink({ workspace: holding(flat(64)) }), ENCODINGS)).toMatchObject({
      kind: 'whole',
      workspace: { tree: flat(64) },
    })
    expect(await decodeLink(payloadLink({ workspace: holding(flat(65)) }), ENCODINGS)).toEqual(alone)
  })

  /** A tree 64 splits deep has at least 65 leaves, so 63 is the deepest that opens whole. */
  it('opens whole 63 splits deep, and the program alone 64 and 65 deep', async () => {
    expect(await decodeLink(payloadLink({ workspace: holding(spine(63)) }), ENCODINGS)).toMatchObject({
      kind: 'whole',
      workspace: { tree: spine(63) },
    })
    for (const depth of [64, 65])
      expect(await decodeLink(payloadLink({ workspace: holding(spine(depth)) }), ENCODINGS), `${depth}`).toEqual(alone)
  })

  it('opens the program alone for a leaf id whose number the leaf counter cannot step past', async () => {
    const tree = {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [lambda(1), { ...lambda(2), id: 'pane-1e300' }],
    }
    expect(await decodeLink(payloadLink({ workspace: holding(tree) }), ENCODINGS)).toEqual(alone)
    tree.children[1] = lambda(2)
    expect(await decodeLink(payloadLink({ workspace: holding(tree) }), ENCODINGS)).toMatchObject({ kind: 'whole' })
  })
})

describe('isLink', () => {
  it('is a fragment starting `#s=`, and no other', () => {
    expect(isLink('#s=abc')).toBe(true)
    for (const fragment of ['', '#', '#s', '#S=abc', '#section', 's=abc'])
      expect(isLink(fragment), fragment).toBe(false)
  })

  it('reads a fragment that is not a link as nothing to open', async () => {
    expect(await decodeLink('#section', ENCODINGS)).toEqual({ kind: 'unreadable' })
  })
})
