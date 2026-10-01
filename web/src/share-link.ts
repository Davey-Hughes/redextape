import { LEGS } from './legs'
import type { Leg } from './protocol'
import { parseWorkspace, type Workspace } from './workspace'

/**
 * SHARE LINKS — Plan 7 part 6a spec §5.1 and §5.3: the program, its encoding, the workspace and where each leg stands,
 * carried in the page's fragment, so a link is never sent to a server.
 *
 *     #s= base64url, unpadded ( deflate-raw ( UTF-8 ( JSON { version: 1, program, encoding, workspace, positions } ) ) )
 *
 * **`workspace` IS `serializeWorkspace`'s STRING, NOT ITS OBJECT**, so a link's workspace reaches `parseWorkspace`
 * exactly as a stored one does, and is held to the same checks. The object would save 26 to 30 characters a link and
 * give the reader a second path (spec §5.1).
 *
 * **NO TEST MAY PIN AN ENCODER'S BYTES.** `CompressionStream` takes no level, and node's encoders and Chrome's write
 * different bytes for one payload, so what is pinned is the decoding of a link Chrome wrote (spec §5.1, §8).
 */

/** What a link's fragment starts with; the payload's base64url follows it. */
export const LINK_PREFIX = '#s='

/** The payload's version. A link of any other opens the program alone (spec §5.3). */
export const LINK_VERSION = 1

/**
 * The most bytes a link's payload may inflate to; a link that inflates past it cannot be read (spec §5.3, §7).
 *
 * **THE PAGE PUTS NO BOUND ON A FRAGMENT, SO THIS IS THE ONE.** Chrome keeps a very long fragment set by
 * `history.replaceState` and by assigning `location.hash`, and `hashchange` reports it whole; and deflate inflates
 * zeros a thousandfold or more, so a link far shorter than its payload can inflate past any size.
 *
 * **8 MiB, WHICH IS CHEAP TO READ AND TO REFUSE, AND FAR PAST ANY PROGRAM.** `share-link.test.ts` holds the boundary
 * itself (a payload of exactly the cap is read, one byte over is refused) and `share-link-inflate.test.ts` holds that
 * a link inflating far past it is refused having read little of its input.
 */
export const MAX_LINK_BYTES = 8 * 1024 * 1024

/**
 * **THE INPUT GOES TO THE INFLATE A KILOBYTE AT A TIME**, and only as its output is read, so a link that inflates far
 * past `MAX_LINK_BYTES` is refused having handed the decompressor a few kilobytes of itself and not the whole, which
 * handing it as one blob stream would. `share-link-inflate.test.ts` counts what it is handed.
 */
const INFLATE_PIECE = 1024

/** A leg's step, per leg, as a link carries it: only the legs that had frames (spec §5.1). */
export type Positions = { readonly [L in Leg]?: number }

/** What `encodeLink` writes: the program, its encoding, the workspace as `serializeWorkspace` wrote it, and positions. */
export type SharePayload = {
  readonly program: string
  readonly encoding: string
  readonly workspace: string
  readonly positions: Positions
}

/**
 * What a link opens (spec §5.3): the whole of it; the program alone, under its encoding where that is one of this
 * build's (`null` where it is not); or nothing, where no program can be read from it.
 */
export type OpenedLink =
  | {
      readonly kind: 'whole'
      readonly program: string
      readonly encoding: string
      readonly workspace: Workspace
      readonly positions: Positions
    }
  | { readonly kind: 'program'; readonly program: string; readonly encoding: string | null }
  | { readonly kind: 'unreadable' }

/** Whether `fragment` — `location.hash` — is a share link rather than any other fragment. */
export const isLink = (fragment: string): boolean => fragment.startsWith(LINK_PREFIX)

function toBase64url(bytes: Uint8Array): string {
  let binary = ''
  // IN PIECES, since a spread of a large array exceeds the engine's argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** The bytes of unpadded base64url `text`, or `null` for anything else. */
function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  let binary: string
  try {
    binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
  } catch {
    return null
  }
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** `bytes` inflated, or `null` where they are not a whole deflate-raw stream or inflate past `MAX_LINK_BYTES`. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  let at = 0
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>(
    {
      pull(controller) {
        if (at >= bytes.length) {
          controller.close()
          return
        }
        controller.enqueue(bytes.slice(at, at + INFLATE_PIECE))
        at += INFLATE_PIECE
      },
    },
    { highWaterMark: 0 },
  )
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const pieces: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_LINK_BYTES) {
        reader.cancel().catch(() => {})
        return null
      }
      pieces.push(value)
    }
  } catch {
    // A STREAM THAT IS NOT DEFLATE, OR IS CUT SHORT, OR HAS BYTES AFTER ITS END: the decompressor errors on each.
    return null
  }
  const out = new Uint8Array(total)
  let into = 0
  for (const piece of pieces) {
    out.set(piece, into)
    into += piece.byteLength
  }
  return out
}

/** The fragment carrying `payload`: `#s=` and the payload, deflated and in base64url. */
export async function encodeLink(payload: SharePayload): Promise<string> {
  const json = JSON.stringify({
    version: LINK_VERSION,
    program: payload.program,
    encoding: payload.encoding,
    workspace: payload.workspace,
    positions: payload.positions,
  })
  return `${LINK_PREFIX}${toBase64url(await deflate(json))}`
}

/** `v` as positions: an object whose keys are legs and whose values are safe integers of 0 or more, or `null`. */
function parsePositions(v: unknown): Positions | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const out: { [L in Leg]?: number } = {}
  for (const [key, step] of Object.entries(v)) {
    const leg = LEGS.find((l) => l === key)
    if (leg === undefined || !Number.isSafeInteger(step) || (step as number) < 0) return null
    out[leg] = step as number
  }
  return out
}

/**
 * What the link `fragment` opens, given this build's `encodings` (spec §5.3).
 *
 * **WHOLE ONLY WHEN EVERY FIELD HOLDS**: version 1, a string program, an encoding this build has, a workspace
 * `parseWorkspace` takes, and positions whose keys are legs and whose values are safe integers of 0 or more. With
 * anything else and a string program, the program opens alone, under its encoding if this build has it. Without a
 * string program — base64url that is not, a stream that does not inflate or inflates past `MAX_LINK_BYTES`, bytes that
 * are not UTF-8 JSON, JSON that is not an object — nothing opens.
 *
 * **IT CANNOT THROW, AND WHAT IT RETURNS CANNOT REJECT** (spec §5.3, amended 2026-10-01): a throw while the workspace is
 * read refuses the workspace, so the program opens alone, and any other throw makes the link unreadable. So `main.ts`
 * always clears the fragment and says what became of the link, and its two calls carry no `.catch`, which nothing
 * could reach. Before, a tree 6,000 splits deep threw out of `parseWorkspace` here, and at start-up `main()` rejected
 * with the fragment still on the page. The bound on a tree in `layout.ts`'s `parseTree` stopped the throw that was
 * measured; the two `try`s hold for any other, such as a decompressor without `deflate-raw`.
 */
export async function decodeLink(fragment: string, encodings: readonly string[]): Promise<OpenedLink> {
  try {
    return await readLink(fragment, encodings)
  } catch {
    return { kind: 'unreadable' }
  }
}

/** `raw` as `parseWorkspace` reads it, with a throw read as a refusal: `decodeLink`'s doc has why. */
function readWorkspace(raw: string): Workspace | null {
  try {
    return parseWorkspace(raw)
  } catch {
    return null
  }
}

/** What `decodeLink` returns, where nothing throws. */
async function readLink(fragment: string, encodings: readonly string[]): Promise<OpenedLink> {
  const unreadable: OpenedLink = { kind: 'unreadable' }
  if (!isLink(fragment)) return unreadable
  const bytes = fromBase64url(fragment.slice(LINK_PREFIX.length))
  if (bytes === null) return unreadable
  const inflated = await inflate(bytes)
  if (inflated === null) return unreadable
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflated))
  } catch {
    return unreadable
  }
  if (typeof parsed !== 'object' || parsed === null) return unreadable
  const e = parsed as Record<string, unknown>
  if (typeof e.program !== 'string') return unreadable
  const encoding = typeof e.encoding === 'string' && encodings.includes(e.encoding) ? e.encoding : null
  const workspace = typeof e.workspace === 'string' ? readWorkspace(e.workspace) : null
  const positions = parsePositions(e.positions)
  if (e.version !== LINK_VERSION || encoding === null || workspace === null || positions === null) {
    return { kind: 'program', program: e.program, encoding }
  }
  return { kind: 'whole', program: e.program, encoding, workspace, positions }
}
