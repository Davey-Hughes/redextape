import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { type Plugin, resolveConfig } from 'vite'
import { describe, expect, it } from 'vitest'
import { APPLE_GROUND, appleTouchIcon, faviconIco, favicons } from '../../favicons'
import config, { PAGES } from '../../vite.config'
import { readRelative } from './read-fixture'

const SVG = readRelative('../../public/favicon.svg')

/** A colour of the art, read from the SVG so that the test follows the drawing. */
function artColour(attribute: 'fill' | 'stroke'): string {
  const found = new RegExp(`${attribute}="(#[0-9A-Fa-f]{6})"`).exec(SVG)?.[1]
  if (found === undefined) throw new Error(`favicon.svg has no ${attribute} colour`)
  return found
}

/** The ribbon's red, and the red of the shadow where one leg passes under the other. */
const [RIBBON, SHADOW] = [artColour('fill'), artColour('stroke')]
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Each entry of an ICO's directory, as its 16 bytes state it. */
function entries(
  ico: Buffer,
): { width: number; height: number; planes: number; bits: number; bytes: number; at: number }[] {
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const e = ico.subarray(6 + 16 * i, 22 + 16 * i)
    return {
      width: e.readUInt8(0),
      height: e.readUInt8(1),
      planes: e.readUInt16LE(4),
      bits: e.readUInt16LE(6),
      bytes: e.readUInt32LE(8),
      at: e.readUInt32LE(12),
    }
  })
}

/** A PNG's chunks, by type in file order. */
function chunks(png: Buffer): { type: string; data: Buffer }[] {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE), 'the PNG signature').toBe(true)
  const found = []
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at)
    found.push({ type: png.toString('latin1', at + 4, at + 8), data: png.subarray(at + 8, at + 8 + length) })
    at += 12 + length
  }
  return found
}

/** A PNG's size from its header. */
function size(png: Buffer): [number, number] {
  const head = chunks(png)[0]
  expect(head?.type).toBe('IHDR')
  return [head?.data.readUInt32BE(0) ?? 0, head?.data.readUInt32BE(4) ?? 0]
}

type Rgba = [number, number, number, number]

/** Every pixel of an 8-bit RGBA PNG, row by row, each scan line's filter undone. */
function pixels(png: Buffer): Rgba[] {
  const all = chunks(png)
  const head = all[0]?.data ?? Buffer.alloc(13)
  expect([head.readUInt8(8), head.readUInt8(9), head.readUInt8(12)], 'bit depth, colour type, interlace').toEqual([
    8, 6, 0,
  ])
  const [width, height] = size(png)
  const raw = inflateSync(Buffer.concat(all.filter((c) => c.type === 'IDAT').map((c) => c.data)))
  const stride = width * 4
  const rows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    const filter = raw.readUInt8(y * (stride + 1))
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    const up = rows[y - 1] ?? Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x < 4 ? 0 : (row[x - 4] ?? 0)
      const b = up[x] ?? 0
      const c = x < 4 ? 0 : (up[x - 4] ?? 0)
      const p = a + b - c
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c
      const predict = [0, a, b, (a + b) >> 1, paeth][filter]
      if (predict === undefined) throw new Error(`row ${y} has filter ${filter}`)
      row[x] = ((row[x] ?? 0) + predict) & 0xff
    }
    rows.push(row)
  }
  return rows.flatMap((row) =>
    Array.from(
      { length: width },
      (_, x): Rgba => [row[x * 4] ?? 0, row[x * 4 + 1] ?? 0, row[x * 4 + 2] ?? 0, row[x * 4 + 3] ?? 0],
    ),
  )
}

/** Every alpha of an 8-bit RGBA PNG. */
const alphas = (png: Buffer): number[] => pixels(png).map((p) => p[3])

/**
 * How far each channel may stray from a colour and still be that colour. resvg draws the art's flat fills exactly, and
 * this leaves room for a renderer that rounds its blending differently.
 */
const CHANNEL_SLACK = 8

/** Whether `p` is opaque and `hex` to within `CHANNEL_SLACK` in each channel. */
function is(p: Rgba, hex: string): boolean {
  const want = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  return p[3] === 255 && want.every((v, i) => Math.abs(v - (p[i] ?? 0)) <= CHANNEL_SLACK)
}

/**
 * The least share of an icon's pixels that is the ribbon's red, and the shadow's. The art leaves about a sixth to a
 * quarter of each icon red and over a hundredth shadow, the 16 px frame the least of both; a frame drawn blank, or
 * without the leg's shadow, has none.
 */
const LEAST_SHARE = { ribbon: 1 / 8, shadow: 1 / 128 } as const

/** Assert that `png` shows the art: enough of its pixels in the ribbon's red, and enough in the shadow's. */
function expectArt(png: Buffer): void {
  const all = pixels(png)
  expect(all.filter((p) => is(p, RIBBON)).length, `pixels of the ribbon's ${RIBBON}`).toBeGreaterThanOrEqual(
    all.length * LEAST_SHARE.ribbon,
  )
  expect(all.filter((p) => is(p, SHADOW)).length, `pixels of the shadow's ${SHADOW}`).toBeGreaterThanOrEqual(
    all.length * LEAST_SHARE.shadow,
  )
}

describe('favicon.ico', () => {
  const ico = faviconIco(SVG)

  it('is an icon file of three frames, 16, 32 and 48 px square, each 32-bit', () => {
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], 'reserved, type, count').toEqual([0, 1, 3])
    expect(entries(ico).map(({ width, height, planes, bits }) => [width, height, planes, bits])).toEqual([
      [16, 16, 1, 32],
      [32, 32, 1, 32],
      [48, 48, 1, 32],
    ])
  })

  it('stores each frame as a PNG of the size its entry states, the frames filling the file after the directory', () => {
    let next = 6 + 16 * entries(ico).length
    for (const { width, height, bytes, at } of entries(ico)) {
      expect(at, 'each frame starts where the one before it ends').toBe(next)
      expect(size(ico.subarray(at, at + bytes))).toEqual([width, height])
      next = at + bytes
    }
    expect(next).toBe(ico.length)
  })

  it.each(entries(ico).map((e) => [e.width, e]))('draws the art in its %i px frame', (_, { at, bytes }) => {
    expectArt(ico.subarray(at, at + bytes))
  })
})

describe('apple-touch-icon.png', () => {
  const png = appleTouchIcon(SVG)

  it('is 180 px square', () => {
    expect(size(png)).toEqual([180, 180])
  })

  it('is opaque in every pixel, since iOS would fill a transparent one with black', () => {
    const seen = alphas(png)
    expect(seen.length).toBe(180 * 180)
    expect(seen.filter((a) => a !== 255).length, 'pixels not fully opaque').toBe(0)
  })

  it('draws the art, red at its centre, on the ground that fills its corners', () => {
    expectArt(png)
    const all = pixels(png)
    const at = (x: number, y: number): Rgba => all[y * 180 + x] ?? [0, 0, 0, 0]
    expect(is(at(90, 90), RIBBON), `the centre, ${at(90, 90)}, is ${RIBBON}`).toBe(true)
    for (const [x, y] of [
      [0, 0],
      [179, 0],
      [0, 179],
      [179, 179],
    ] as const)
      expect(is(at(x, y), APPLE_GROUND), `the corner ${x}, ${y}, ${at(x, y)}, is ${APPLE_GROUND}`).toBe(true)
  })
})

/** The favicon plugin as `vite.config.ts` registers it, in the config Vite resolves from it for a build. */
async function registered(): Promise<Plugin> {
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const resolved = await resolveConfig({ ...config, configFile: false, root }, 'build')
  const found = resolved.plugins.filter((p) => p.name === favicons().name)
  expect(found.length, `plugins named ${favicons().name} in the resolved config`).toBe(1)
  return found[0] as Plugin
}

/** `plugin`'s hook `name`, called on `self` with `args`. */
function call(plugin: Plugin, name: 'configureServer' | 'generateBundle', self: unknown, ...args: unknown[]): unknown {
  const hook = plugin[name]
  const fn = typeof hook === 'function' ? hook : hook?.handler
  if (fn === undefined) throw new Error(`${plugin.name} has no ${name} hook`)
  return (fn as (...a: unknown[]) => unknown).apply(self, args)
}

/** A dev middleware's three arguments. */
type Middleware = (req: { url: string }, res: unknown, next: () => void) => void

/** What `plugin`'s dev middleware does with a request for `url`: the content type and body it sends, or a pass. */
function serve(plugin: Plugin, url: string): { type?: unknown; body?: unknown; passed: boolean } {
  let middleware: Middleware | undefined
  call(plugin, 'configureServer', undefined, {
    middlewares: { use: (fn: Middleware) => (middleware = fn) },
  })
  if (middleware === undefined) throw new Error(`${plugin.name} adds no middleware`)
  const sent: { type?: unknown; body?: unknown; passed: boolean } = { passed: false }
  const res = {
    setHeader: (key: string, value: unknown) => {
      if (key.toLowerCase() === 'content-type') sent.type = value
    },
    end: (body: unknown) => (sent.body = body),
  }
  middleware({ url }, res, () => (sent.passed = true))
  return sent
}

/**
 * THE PLUGIN AS THE CONFIG REGISTERS IT, NOT THE FUNCTIONS IT CALLS: with `favicons()` left out of `plugins`, the
 * build would ship no icon and nginx would answer `/favicon.ico` with `index.html`.
 */
describe('the plugin vite.config.ts registers', () => {
  const ICONS = [
    ['favicon.ico', 'image/x-icon', faviconIco(SVG)],
    ['apple-touch-icon.png', 'image/png', appleTouchIcon(SVG)],
  ] as const

  it("emits both icons at the build's root, drawn from public/favicon.svg", async () => {
    const emitted: { type: string; fileName?: string; source?: unknown }[] = []
    const context = { emitFile: (asset: (typeof emitted)[number]) => emitted.push(asset) }
    call(await registered(), 'generateBundle', context, {}, {}, true)
    expect(emitted.map(({ type, fileName }) => [type, fileName])).toEqual(ICONS.map(([file]) => ['asset', file]))
    for (const [i, [file, , bytes]] of ICONS.entries())
      expect(Buffer.from(emitted[i]?.source as Uint8Array).equals(bytes), `${file}'s bytes`).toBe(true)
  })

  it.each(ICONS)('serves /%s in dev as %s, drawn from public/favicon.svg', async (file, type, bytes) => {
    const sent = serve(await registered(), `/${file}`)
    expect([sent.passed, sent.type], 'passed on, and the content type').toEqual([false, type])
    expect(Buffer.from(sent.body as Uint8Array).equals(bytes), 'the bytes').toBe(true)
  })

  it("passes /favicon.svg on to Vite's public files", async () => {
    expect(serve(await registered(), '/favicon.svg')).toEqual({ passed: true })
  })
})

describe('the icon links', () => {
  const TAGS = [
    '<link rel="icon" href="/favicon.ico" sizes="32x32" />',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
  ]

  it.each(PAGES)('%s.html carries all three in its head', (name) => {
    const head = readRelative(`../../${name}.html`).split('</head>')[0] ?? ''
    for (const tag of TAGS) expect(head, tag).toContain(tag)
  })
})
