import { expect, it } from 'vitest'
import { decodeLink, LINK_PREFIX } from '../../src/share-link'

/**
 * **THE INFLATE IS HANDED ITS INPUT A KILOBYTE AT A TIME, AS ITS OUTPUT IS READ** — `share-link.ts`'s
 * `MAX_LINK_BYTES` and the piece size under it (Plan 7 part 6a spec §5.3). A link that inflates far past the cap is
 * refused having handed Chrome's decompressor a few kilobytes of itself, not the whole. A browser test, because it is
 * Chrome's decompressor this holds: node's takes all of its input at once whatever it is handed.
 *
 * Counted by standing a counter in front of the decompressor, which passes on what it is given as the decompressor
 * asks for it. 64 MiB of zeros deflate to some 64 KiB.
 */

async function deflated(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

it('refuses a link inflating to 64 MiB having handed the inflate under 16 KiB of it', async () => {
  const bomb = await deflated(new Uint8Array(64 * 1024 * 1024))
  expect(bomb.length).toBeGreaterThan(60_000)
  const Real = globalThis.DecompressionStream
  let fed = 0
  class Counted {
    readonly readable: ReadableStream<Uint8Array<ArrayBuffer>>
    readonly writable: WritableStream<BufferSource>
    constructor(format: CompressionFormat) {
      const real = new Real(format)
      const counter = new TransformStream<BufferSource, BufferSource>({
        transform(chunk, controller) {
          fed += chunk.byteLength
          controller.enqueue(chunk)
        },
      })
      counter.readable.pipeTo(real.writable).catch(() => {})
      this.writable = counter.writable
      this.readable = real.readable
    }
  }
  globalThis.DecompressionStream = Counted as unknown as typeof DecompressionStream
  try {
    expect(await decodeLink(`${LINK_PREFIX}${base64url(bomb)}`, ['unary'])).toEqual({ kind: 'unreadable' })
  } finally {
    globalThis.DecompressionStream = Real
  }
  expect(fed).toBeGreaterThan(0)
  expect(fed).toBeLessThan(16 * 1024)
})
