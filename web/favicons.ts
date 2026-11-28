import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import type { Plugin } from 'vite'

/** The ICO's frame sizes, in px, each drawn from the SVG at that size so no frame is a resample of another. */
const ICO_SIZES = [16, 32, 48] as const

/** The Apple icon's side, in px. */
const APPLE_SIZE = 180

/** The share of the Apple icon's width the art takes, centred. */
const APPLE_ART = 0.78

/** iOS fills a transparent pixel with black, so the Apple icon is drawn on a ground of its own. */
export const APPLE_GROUND = '#FAFAFA'

/** `svg` drawn `width` px wide, as a PNG. */
const png = (svg: string, width: number): Buffer =>
  Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng())

/** An ICO of `svg`: a 6-byte header, a 16-byte entry per frame, then each frame's PNG in entry order. */
export function faviconIco(svg: string): Buffer {
  const frames = ICO_SIZES.map((size) => ({ size, data: png(svg, size) }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  let offset = header.length + 16 * frames.length
  const entries = frames.map(({ size, data }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size, 0)
    entry.writeUInt8(size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.data)])
}

/**
 * The Apple touch icon of `svg`: square and opaque, since iOS rounds the corners itself. The art goes in as an
 * `<image>` so it is drawn from the vector at its own size, on whole pixels.
 */
export function appleTouchIcon(svg: string): Buffer {
  const art = Math.round(APPLE_SIZE * APPLE_ART)
  const at = (APPLE_SIZE - art) / 2
  const href = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  return png(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${APPLE_SIZE}" height="${APPLE_SIZE}">` +
      `<rect width="${APPLE_SIZE}" height="${APPLE_SIZE}" fill="${APPLE_GROUND}"/>` +
      `<image x="${at}" y="${at}" width="${art}" height="${art}" href="${href}"/></svg>`,
    APPLE_SIZE,
  )
}

/** What each icon is served as at the site's root, and how it is made from the SVG. */
const ICONS: readonly { file: string; type: string; make: (svg: string) => Buffer }[] = [
  { file: 'favicon.ico', type: 'image/x-icon', make: faviconIco },
  { file: 'apple-touch-icon.png', type: 'image/png', make: appleTouchIcon },
]

/**
 * The icons made from `public/favicon.svg`, so only the SVG is committed: emitted at the build's root, and served
 * from the SVG on disk in dev, where an edit to it shows on the next load.
 */
export function favicons(): Plugin {
  let source = ''
  const svg = (): string => readFileSync(source, 'utf8')
  return {
    name: 'redextape-favicons',
    configResolved(config) {
      source = join(config.publicDir, 'favicon.svg')
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const icon = ICONS.find((i) => req.url?.split('?')[0] === `/${i.file}`)
        if (icon === undefined) return next()
        res.setHeader('Content-Type', icon.type)
        res.end(icon.make(svg()))
      })
    },
    generateBundle() {
      for (const { file, make } of ICONS) this.emitFile({ type: 'asset', fileName: file, source: make(svg()) })
    },
  }
}
