import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { defaultArrangement } from '../../src/layout'
import { LEGS } from '../../src/legs'
import {
  decodeLink,
  encodeLink,
  isLink,
  LINK_PREFIX,
  LINK_VERSION,
  MAX_LINK_BYTES,
  type OpenedLink,
  type Positions,
  type SharePayload,
} from '../../src/share-link'
import { defaultWorkspace, PRESETS, type Preset, parseWorkspace, SPEEDS, serializeWorkspace } from '../../src/workspace'
import { seededRandom } from './seeded-random'

/**
 * The share link's codec (Plan 7 part 6a spec §5.1, §5.3, §8's node row): what `encodeLink` writes `decodeLink` reads
 * back whole; every way a link can fail to be read, and every way it opens the program alone; and the frozen link from
 * the format's first version, which must go on opening. `CompressionStream` and `DecompressionStream` are node globals,
 * and node reads Chrome's links (spec §A.3).
 */

/** The encodings `main.ts` hands in, as `encodings()` lists them. */
const ENCODINGS = ['unary', 'binary']

/** The widths `main.ts` hands in, as `fieldWidths()` lists them. */
const WIDTHS = Array.from({ length: 64 }, (_, i) => i + 1)

const WORKSPACE = serializeWorkspace(defaultWorkspace('wide'))

/** A link carrying `text` as its payload's JSON, deflated by node's own encoder: any payload, valid or not. */
const linkOf = (text: string | Uint8Array): string =>
  `${LINK_PREFIX}${deflateRawSync(typeof text === 'string' ? Buffer.from(text) : text).toString('base64url')}`

/** The JSON `fragment` carries, inflated: what `encodeLink` wrote before it compressed it. */
const inflatedOf = (fragment: string): Promise<string> =>
  new Response(
    new Blob([Buffer.from(fragment.slice(LINK_PREFIX.length), 'base64url')])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw')),
  ).text()

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
  /** What a program's text can hold that JSON or UTF-8 treats specially: quotes, escapes, λ, a surrogate pair, U+2028. */
  const PIECES = ['let x = 40;', '\n', '\t', '"', '\\', 'λx. x', '🦀', ' ', ' ', '{}', 'fn f(n) {', '}', '0']

  const generated = (seed: number): SharePayload => {
    const next = seededRandom(seed)
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T
    const program = Array.from({ length: Math.floor(next() * 400) }, () => pick(PIECES)).join('')
    const preset = pick(Object.keys(PRESETS) as Preset[])
    const workspace = serializeWorkspace({
      ...defaultWorkspace('wide'),
      switches: PRESETS[preset],
      speed: pick(SPEEDS),
    })
    const positions: { [L in (typeof LEGS)[number]]?: number } = {}
    for (const leg of LEGS) {
      if (next() < 0.5) continue
      positions[leg] = pick([0, 1, Math.floor(next() * 100_000), Number.MAX_SAFE_INTEGER])
    }
    const width = pick([null, 4, 13, 64])
    const listing = next() < 0.5 ? { listing: 'optimised' as const } : {}
    return { program, encoding: pick(ENCODINGS), width, ...listing, workspace, positions }
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('reads back whole what it wrote, generated from seed %i', async (seed) => {
    const payload = generated(seed)
    const fragment = await encodeLink(payload)
    expect(await decodeLink(fragment, ENCODINGS, WIDTHS)).toEqual({
      kind: 'whole',
      program: payload.program,
      encoding: payload.encoding,
      width: payload.width,
      listing: payload.listing ?? 'as-built',
      workspace: parseWorkspace(payload.workspace),
      positions: payload.positions,
    })
  })

  /** Whether a seed picks a width is the generator's business, so a pinned width and auto are each held here too. */
  it('reads back a pinned width, and auto', async () => {
    for (const width of [4, 64, null]) {
      const opened = await decodeLink(await encodeLink({ ...generated(1), width }), ENCODINGS, WIDTHS)
      expect(opened.kind === 'whole' && opened.width, String(width)).toBe(width)
    }
  })

  /** Over every seed, since one payload's deflated length needs no padding in two of three cases. */
  it('writes `#s=` and unpadded base64url, and nothing else', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const fragment = await encodeLink(generated(seed))
      expect(fragment, `seed ${seed}`).toMatch(/^#s=[A-Za-z0-9_-]+$/)
      expect(isLink(fragment)).toBe(true)
    }
  })

  it('writes version 1, the program, the encoding, a pinned width, the workspace and the positions', async () => {
    const payload = { ...generated(10), width: 13 }
    expect(JSON.parse(await inflatedOf(await encodeLink(payload)))).toEqual({ version: 1, ...payload })
  })

  /**
   * **AN AUTO LINK'S PAYLOAD HAS NO `width` KEY** (the TM width design, decision 14), so it is the version-1 payload
   * every build at this version reads alike, its keys in `encodeLink`'s order. A width left out is auto, as `null` is.
   * Pinned, the width sits beside the encoding.
   */
  it('writes auto with no width key, and a pinned width beside the encoding', async () => {
    const payload = { program: 'let x = 40; x + 2', encoding: 'binary', workspace: '{}', positions: { tm: 3 } }
    const auto = '{"version":1,"program":"let x = 40; x + 2","encoding":"binary","workspace":"{}","positions":{"tm":3}}'
    expect(await inflatedOf(await encodeLink({ ...payload, width: null }))).toBe(auto)
    expect(await inflatedOf(await encodeLink(payload))).toBe(auto)
    expect(await inflatedOf(await encodeLink({ ...payload, width: 4 }))).toBe(
      '{"version":1,"program":"let x = 40; x + 2","encoding":"binary","width":4,"workspace":"{}","positions":{"tm":3}}',
    )
  })

  /**
   * **A LINK AS BUILT HAS NO `listing` KEY**, as an auto link has no `width`, so it is the version-1 payload every
   * build at this version reads alike, and `LINK_VERSION` stays 1. Optimised sits after the width.
   */
  it('writes as built with no listing key, and optimised after the width', async () => {
    expect(LINK_VERSION).toBe(1)
    const payload = { program: 'let x = 40; x + 2', encoding: 'binary', workspace: '{}', positions: { clif: 3 } }
    expect(await inflatedOf(await encodeLink(payload))).toBe(
      '{"version":1,"program":"let x = 40; x + 2","encoding":"binary","workspace":"{}","positions":{"clif":3}}',
    )
    expect(await inflatedOf(await encodeLink({ ...payload, listing: 'optimised' }))).toBe(
      '{"version":1,"program":"let x = 40; x + 2","encoding":"binary","listing":"optimised","workspace":"{}",' +
        '"positions":{"clif":3}}',
    )
    expect(await inflatedOf(await encodeLink({ ...payload, width: 4, listing: 'optimised' }))).toBe(
      '{"version":1,"program":"let x = 40; x + 2","encoding":"binary","width":4,"listing":"optimised",' +
        '"workspace":"{}","positions":{"clif":3}}',
    )
  })
})

/**
 * **THE FROZEN LINK: THE FORMAT'S FIRST VERSION, WHICH MUST GO ON OPENING** (umbrella §8.4, Plan 7 part 6a spec §5.1).
 * **WHAT IS FROZEN IS THE FORMAT**: the payload's fields and their nesting in version 1, from `sum_to(5)` under
 * `binary`, the Debugger preset's workspace and a position on each leg. A view's name is a value in it, so the fixture
 * names the views as `KIND_ORDER` does: a link naming a view the page lacks opens the program alone. Node's raw
 * deflate wrote these bytes, not `encodeLink`, and the test pins the reading, never an encoder's bytes: node and Chrome
 * deflate one payload differently. Its workspace is `version: 2`, so it pins `parseWorkspace`'s reading of version 2
 * for good too: a later workspace version migrates version 2 rather than refusing it.
 */
describe('the frozen format of a version 1 link', () => {
  const FROZEN =
    '#s=tZLRTsIwFIZfpemVxGGKkURH9Mq3oMSU7oAN6-nSdkwke3dPO4igEeOFS7aefDv_378n3fMt-GAc8nJS8Ma7tVeWl3yFLLT2JborHLG9REZPDZHZNjKlNXtkYjbQ7tXUwJA9MXFsTM_QlL7XDGefHIkiG7PJgfXDQo0SqT5sOh1J5AUH1K4yuKZAS4PK74h1zm9CozQQ3MtjfMnL20Ly6AGoJL4xWFEleWhqEyWnn5XxmWhXtxYzCuYdAsG5uJkW9C6IaTpQ5SFZzi8bedf92aUGtcoic3B1rdeQSaMQzlhfXFLWyi4rNRbn2oGSdnGu_p_0_s1-DUDot-TxmyjanJgyU57ORP2aI5FJiNCE3LNUPou2BrqBRLp5ITMPqnJtzNRgaEBH51OMdHCAtO091Sun2wA_jK_OOybJiUMZfQt5aDRAtTt2RPt8Anq6lo0LJtJFDAQO3rycClGkgfDyjopI64MQou8_AA'

  it('opens whole, as the program, the encoding, the workspace and the positions it was written with', async () => {
    expect(await decodeLink(FROZEN, ENCODINGS, WIDTHS)).toEqual({
      kind: 'whole',
      program:
        'fn sum_to(n) {\n    let mut acc = 0;\n    while n > 0 {\n        acc = acc + n;\n        n = n - 1;\n    }\n    acc\n}\nsum_to(5)\n',
      encoding: 'binary',
      width: null,
      // WRITTEN BEFORE A LINK COULD CARRY A LISTING, SO IT CARRIES NONE, AND OPENS AS BUILT.
      listing: 'as-built',
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
                { kind: 'leaf', id: 'rxm-0', pane: 'rxm' },
                { kind: 'leaf', id: 'tm-0', pane: 'tm' },
              ],
            },
          ],
        },
        switches: { steps: 'bar', views: 'tiles', readout: 'inspector' },
        speed: 8,
        focused: 'lambda-0',
        panels: {},
        panelSizes: {},
        inspector: true,
        display: {},
        tmDisplay: {},
        // WRITTEN BEFORE A CLIF VIEW HAD A LAYOUT TO STORE, SO IT CARRIES NONE, AND READS AS NONE STORED.
        clifDisplay: {},
        // WRITTEN BEFORE THE VIEW LAYOUTS, SO IT CARRIES NONE, AND READS AS REMEMBERING NOTHING: its four views are
        // the arrangement on screen, as they were.
        arrangements: {},
      },
      positions: { lambda: 500, rxm: 40, tm: 9000 },
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
    expect(await decodeLink(fragment, ENCODINGS, WIDTHS)).toEqual({ kind: 'unreadable' })
  })

  it('refuses bytes that are not a deflate stream', async () => {
    const plain = Buffer.from(JSON.stringify({ version: 1, program: 'x' })).toString('base64url')
    expect(await decodeLink(`${LINK_PREFIX}${plain}`, ENCODINGS, WIDTHS)).toEqual({ kind: 'unreadable' })
  })

  it('refuses a stream cut short, and one with bytes after its end', async () => {
    const whole = deflateRawSync(Buffer.from(JSON.stringify({ version: 1, program: 'let x = 40; x + 2' })))
    const cut = `${LINK_PREFIX}${whole.subarray(0, whole.length - 4).toString('base64url')}`
    const trailing = `${LINK_PREFIX}${Buffer.concat([whole, Buffer.from([0, 1, 2])]).toString('base64url')}`
    expect(await decodeLink(cut, ENCODINGS, WIDTHS)).toEqual({ kind: 'unreadable' })
    expect(await decodeLink(trailing, ENCODINGS, WIDTHS)).toEqual({ kind: 'unreadable' })
  })

  /**
   * **NOT UTF-8 INSIDE A STRING THAT IS OTHERWISE A PROGRAM**, so what refuses it is the decoding and not the JSON: read
   * leniently, `0xff` would become U+FFFD and the program would open. A JSON array is refused by having no `program`.
   */
  it('refuses a payload that is not UTF-8, or not JSON, or JSON that is not an object', async () => {
    const bytes = new TextEncoder().encode('{"program":"let x = 40; x + 2"}')
    bytes[13] = 0xff
    expect(await decodeLink(linkOf(bytes), ENCODINGS, WIDTHS)).toEqual({ kind: 'unreadable' })
    for (const text of ['{"version": 1, "program"', 'null', '[]', '"let x = 1"', '42'])
      expect(await decodeLink(linkOf(text), ENCODINGS, WIDTHS), text).toEqual({ kind: 'unreadable' })
  })

  it('refuses a payload whose program is missing or not a string', async () => {
    for (const program of [undefined, 42, null, ['let x = 1']])
      expect(await decodeLink(payloadLink({ program }), ENCODINGS, WIDTHS), String(program)).toEqual({
        kind: 'unreadable',
      })
  })

  /**
   * **THE CAP IS THE ONE BOUND ON WHAT A LINK INFLATES TO** (`MAX_LINK_BYTES`' own doc): a payload of exactly the cap
   * is read, and one byte more is refused. Both are a program of `a`s, which deflate to a few kilobytes.
   */
  it('reads a payload of exactly MAX_LINK_BYTES, and refuses one a byte longer', async () => {
    const around = (bytes: number): string => {
      const shell = JSON.stringify({ program: '' })
      return linkOf(JSON.stringify({ program: 'a'.repeat(bytes - shell.length) }))
    }
    expect(await decodeLink(around(MAX_LINK_BYTES), ENCODINGS, WIDTHS)).toMatchObject({ kind: 'program' })
    expect(await decodeLink(around(MAX_LINK_BYTES + 1), ENCODINGS, WIDTHS)).toEqual({ kind: 'unreadable' })
  })
})

describe('a link that opens the program alone', () => {
  const alone = (encoding: string | null) => ({
    kind: 'program',
    program: 'let x = 40; x + 2',
    encoding,
    width: null,
    listing: 'as-built',
  })

  it('opens the program alone, under its encoding, for a version other than 1', async () => {
    for (const version of [2, '1', undefined])
      expect(await decodeLink(payloadLink({ version }), ENCODINGS, WIDTHS), String(version)).toEqual(alone('binary'))
  })

  it('opens the program alone, with no encoding, for an encoding this build does not have', async () => {
    for (const encoding of ['ternary', 3, undefined])
      expect(await decodeLink(payloadLink({ encoding }), ENCODINGS, WIDTHS), String(encoding)).toEqual(alone(null))
  })

  it("opens the program alone for a workspace that is not `serializeWorkspace`'s string, or that it refuses", async () => {
    for (const workspace of [JSON.parse(WORKSPACE), undefined, '{}', 'not json'])
      expect(await decodeLink(payloadLink({ workspace }), ENCODINGS, WIDTHS), String(workspace)).toEqual(
        alone('binary'),
      )
  })

  it.each([
    ['missing', undefined],
    ['an array, even an empty one', []],
    ['a key that is not a leg', { lamda: 7 }],
    ['a negative step', { lambda: -1 }],
    ['a step that is not an integer', { rxm: 1.5 }],
    ['a step past the safe integers', { tm: 2 ** 53 }],
    ['a step written as a string', { lambda: '7' }],
    ['an object whose only key is `__proto__`', JSON.parse('{"__proto__":1}')],
    ['an object whose only key is `constructor`', { constructor: 1 }],
  ])('opens the program alone for positions that are %s', async (_, positions) => {
    expect(await decodeLink(payloadLink({ positions }), ENCODINGS, WIDTHS)).toEqual(alone('binary'))
  })

  it('opens the program alone at its width, where it carries one this build lists', async () => {
    const alone8 = { ...alone('binary'), width: 8 }
    expect(await decodeLink(payloadLink({ version: 2, width: 8 }), ENCODINGS, WIDTHS)).toEqual(alone8)
    expect(await decodeLink(payloadLink({ positions: [], width: 8 }), ENCODINGS, WIDTHS)).toEqual(alone8)
  })

  it('opens whole with no positions at all, and with a step of 0', async () => {
    for (const positions of [{}, { tm: 0 }] as Positions[])
      expect(await decodeLink(payloadLink({ positions }), ENCODINGS, WIDTHS)).toMatchObject({
        kind: 'whole',
        positions,
      })
  })
})

/**
 * **A WIDTH THE BUILD DOES NOT LIST READS AS AUTO, AND THE LINK STAYS WHOLE, LESS ITS TM POSITION** (the TM width
 * design, decision 15): demoting it to the program alone would drop its workspace for a field a hand-edit or another
 * build wrote, but its TM position is a step of the run at the width it names, and auto is another run. Only an
 * integer `widths` lists is a width: wasm-bindgen's `u32` glue would turn `16.7`, `2 ** 32 + 16` and `"8"` into widths
 * before Rust's own check could refuse them. `toEqual` on the positions, since `toMatchObject` passes extra keys.
 */
describe('a link carrying a width', () => {
  const whole = { kind: 'whole', program: 'let x = 40; x + 2', encoding: 'binary' }
  const positions = { lambda: 7, rxm: 3, tm: 12 }
  const opened = (fields: Record<string, unknown>, widths = WIDTHS) =>
    decodeLink(payloadLink({ positions, ...fields }), ENCODINGS, widths)
  const positionsOf = (link: OpenedLink) => (link.kind === 'whole' ? link.positions : null)

  it('opens whole at a width this build lists, and at auto with none, with every position', async () => {
    const pinned = await opened({ width: 4 })
    expect(pinned).toMatchObject({ ...whole, width: 4 })
    expect(positionsOf(pinned)).toEqual(positions)
    const auto = await opened({})
    expect(auto).toMatchObject({ ...whole, width: null })
    expect(positionsOf(auto)).toEqual(positions)
  })

  it.each([65, 0, -8, 16.7, 2 ** 32 + 16, '8', null, true, [8], { width: 8 }])(
    'opens whole at auto for a width of %j, with its workspace and every position but the TM’s',
    async (width) => {
      const link = await opened({ width })
      expect(link).toMatchObject({ ...whole, width: null })
      expect(link.kind === 'whole' && link.workspace).toEqual(parseWorkspace(WORKSPACE))
      expect(positionsOf(link)).toEqual({ lambda: 7, rxm: 3 })
    },
  )

  it('opens whole at auto, less its TM position, for a width the list handed in does not hold', async () => {
    const link = await opened({ width: 8 }, [4, 16])
    expect(link).toMatchObject({ ...whole, width: null })
    expect(positionsOf(link)).toEqual({ lambda: 7, rxm: 3 })
  })

  it('opens the program alone at auto for a width it does not list', async () => {
    expect(await decodeLink(payloadLink({ version: 2, width: '8' }), ENCODINGS, WIDTHS)).toEqual({
      kind: 'program',
      program: 'let x = 40; x + 2',
      encoding: 'binary',
      width: null,
      listing: 'as-built',
    })
  })
})

/**
 * **A LISTING THE BUILD DOES NOT KNOW READS AS BUILT, AND THE LINK STAYS WHOLE, LESS ITS CLIF POSITION**, as an
 * unlisted width keeps the link less its TM position: the CLIF position is a step of the run of the listing the link
 * names, and the listing as built is another run. A link with no listing is as built, and keeps it.
 */
describe('a link carrying a listing', () => {
  const whole = { kind: 'whole', program: 'let x = 40; x + 2', encoding: 'binary', width: null }
  const positions = { clif: 9, rxm: 4 }
  const opened = (fields: Record<string, unknown>) =>
    decodeLink(payloadLink({ positions, ...fields }), ENCODINGS, WIDTHS)
  const positionsOf = (link: OpenedLink) => (link.kind === 'whole' ? link.positions : null)

  it('opens whole, optimised, with every position', async () => {
    const link = await opened({ listing: 'optimised' })
    expect(link).toMatchObject({ ...whole, listing: 'optimised' })
    expect(positionsOf(link)).toEqual(positions)
  })

  it('opens whole as built, with every position, for no listing and for as built', async () => {
    for (const fields of [{}, { listing: 'as-built' }]) {
      const link = await opened(fields)
      expect(link, JSON.stringify(fields)).toMatchObject({ ...whole, listing: 'as-built' })
      expect(positionsOf(link), JSON.stringify(fields)).toEqual(positions)
    }
  })

  it.each(['sideways', 'as built', 'Optimised', null, true, 1, ['optimised'], { listing: 'optimised' }])(
    'opens whole as built for a listing of %j, with its workspace and every position but the CLIF’s',
    async (listing) => {
      const link = await opened({ listing })
      expect(link).toMatchObject({ ...whole, listing: 'as-built' })
      expect(link.kind === 'whole' && link.workspace).toEqual(parseWorkspace(WORKSPACE))
      expect(positionsOf(link)).toEqual({ rxm: 4 })
    },
  )

  it('drops the TM and CLIF positions both, for a width it does not list and a listing it does not know', async () => {
    const link = await opened({ width: 65, listing: 'sideways', positions: { clif: 9, rxm: 4, tm: 12 } })
    expect(link).toMatchObject({ ...whole, listing: 'as-built' })
    expect(positionsOf(link)).toEqual({ rxm: 4 })
  })

  it('opens the program alone in its listing, or as built for one it does not know', async () => {
    const alone = { kind: 'program', program: 'let x = 40; x + 2', encoding: 'binary', width: null }
    expect(await opened({ version: 2, listing: 'optimised' })).toEqual({ ...alone, listing: 'optimised' })
    expect(await opened({ version: 2, listing: 'sideways' })).toEqual({ ...alone, listing: 'as-built' })
  })
})

/**
 * **A LINK CARRIES THE ARRANGEMENT ON SCREEN AND NO OTHER** (the view layouts spec §4.7). `main.ts` writes one from a
 * workspace it has emptied of them, and `decodeLink` drops them from one that carries them all the same: a link
 * written by hand, or by a build that sent them. Were they not dropped, such a link opened in the page would put its
 * arrangements into force and into the reader's storage.
 */
describe('a link whose workspace carries remembered arrangements', () => {
  const FOUR = defaultArrangement(['source', 'lambda', 'rxm', 'tm'], 'wide')
  const carried = {
    ...defaultWorkspace('wide'),
    arrangements: { 'source+lambda+rxm+tm': FOUR },
    // A VIEW ON SCREEN AND A VIEW ONLY THE REMEMBERED ARRANGEMENT HOLDS, each with something stored for it.
    panels: { 'tm-0': { rules: false }, 'lambda-0': { map: true } },
    display: { 'lambda-0': { layout: 'outline', vars: 'names', map: 'icicle' } },
    tmDisplay: { 'tm-0': { level: 'local', edges: 'chips' } },
  } as const

  it('opens whole, with none of them and nothing stored for the views only they held', async () => {
    const workspace = serializeWorkspace(carried)
    expect(parseWorkspace(workspace)?.arrangements, 'precondition: the workspace parses, and carries one').toEqual(
      carried.arrangements,
    )
    expect(parseWorkspace(workspace)?.panels, 'precondition: and the panel state of a view only it holds').toEqual(
      carried.panels,
    )
    const opened = await decodeLink(payloadLink({ workspace }), ENCODINGS, WIDTHS)
    if (opened.kind !== 'whole') throw new Error(`the link opened as ${opened.kind}`)
    expect(opened.workspace.arrangements, 'the link’s arrangements were read').toEqual({})
    expect(opened.workspace.panels, 'the state of a view only they held was read').toEqual({ 'tm-0': { rules: false } })
    expect(opened.workspace.display).toEqual({})
    expect(opened.workspace.tmDisplay, 'the state of a view on screen was dropped').toEqual(carried.tmDisplay)
    expect(opened.workspace).toEqual({
      ...carried,
      arrangements: {},
      panels: { 'tm-0': { rules: false } },
      display: {},
    })
  })
})

/**
 * **A LINK'S TREE IS HELD TO THE BOUND A STORED ONE IS** (spec §5.3, amended 2026-10-01): at most 64 splits deep and 64
 * leaves, and leaf ids whose numbers the leaf counter can step past. A workspace past it opens the program alone.
 */
describe("a link whose workspace's tree is past the bound", () => {
  const alone = { kind: 'program', program: 'let x = 40; x + 2', encoding: 'binary', width: null, listing: 'as-built' }
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
      await expect(decodeLink(payloadLink({ workspace: holding(deep(10_000)) }), ENCODINGS, WIDTHS)).resolves.toEqual(
        alone,
      )
    },
  )

  it('opens whole with 64 leaves, and the program alone with 65', async () => {
    expect(await decodeLink(payloadLink({ workspace: holding(flat(64)) }), ENCODINGS, WIDTHS)).toMatchObject({
      kind: 'whole',
      workspace: { tree: flat(64) },
    })
    expect(await decodeLink(payloadLink({ workspace: holding(flat(65)) }), ENCODINGS, WIDTHS)).toEqual(alone)
  })

  /** A tree 64 splits deep has at least 65 leaves, so 63 is the deepest that opens whole. */
  it('opens whole 63 splits deep, and the program alone 64 and 65 deep', async () => {
    expect(await decodeLink(payloadLink({ workspace: holding(spine(63)) }), ENCODINGS, WIDTHS)).toMatchObject({
      kind: 'whole',
      workspace: { tree: spine(63) },
    })
    for (const depth of [64, 65])
      expect(
        await decodeLink(payloadLink({ workspace: holding(spine(depth)) }), ENCODINGS, WIDTHS),
        `${depth}`,
      ).toEqual(alone)
  })

  it('opens the program alone for a leaf id whose number the leaf counter cannot step past', async () => {
    const tree = {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [lambda(1), { ...lambda(2), id: 'pane-1e300' }],
    }
    expect(await decodeLink(payloadLink({ workspace: holding(tree) }), ENCODINGS, WIDTHS)).toEqual(alone)
    tree.children[1] = lambda(2)
    expect(await decodeLink(payloadLink({ workspace: holding(tree) }), ENCODINGS, WIDTHS)).toMatchObject({
      kind: 'whole',
    })
  })
})

describe('isLink', () => {
  it('is a fragment starting `#s=`, and no other', () => {
    expect(isLink('#s=abc')).toBe(true)
    for (const fragment of ['', '#', '#s', '#S=abc', '#section', 's=abc'])
      expect(isLink(fragment), fragment).toBe(false)
  })

  it('reads a fragment that is not a link as nothing to open', async () => {
    expect(await decodeLink('#section', ENCODINGS, WIDTHS)).toEqual({ kind: 'unreadable' })
  })
})
