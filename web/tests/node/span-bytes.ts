import type { Classified } from '../../src/types'
import { TOKEN_CLASSES } from '../../src/types'

/**
 * Classified spans as a λ frame carries them on the wire: three little-endian `u32`s a span, its start, its end and
 * its class's index in `TOKEN_CLASSES` (`viewmodel.rs`'s `span_words`). For tests that build a frame by hand; the app
 * only ever reads this shape, which the worker writes.
 *
 * **NOT IN `src/`, BECAUSE NOTHING THERE WRITES IT.** The Rust contract test holds what the worker writes, and
 * `spans.test.ts` holds what the page reads against bytes built here, so the two agree through the format rather than
 * through one shared function.
 */
export function spanBytes(spans: Classified): Uint8Array {
  const out = new Uint8Array(spans.length * 12)
  const view = new DataView(out.buffer)
  spans.forEach(([span, cls], i) => {
    view.setUint32(i * 12, span.start, true)
    view.setUint32(i * 12 + 4, span.end, true)
    view.setUint32(i * 12 + 8, TOKEN_CLASSES.indexOf(cls), true)
  })
  return out
}
