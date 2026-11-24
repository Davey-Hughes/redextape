/**
 * THE PROGRAM, KEPT ACROSS RELOADS — Plan 7 part 6a spec §4.3: the source editor's text, the encoding and width it
 * compiles under, and the listing its CLIF views show, stored as the workspace is, under a key of its own.
 *
 * **VERSIONED AND VALIDATED AS THE OTHER STORES ARE, AND A REFUSAL IS SILENT.** `parseProgram` answers `null` for
 * anything it will not take, and `null` reads exactly as a first visit does: the app opens on the first-load example.
 * A stored program cannot be told from a hand-edited one or one a later version wrote, and a banner on every load
 * after a format change would be worse than what it reports.
 *
 * **THE ENCODINGS AND WIDTHS ARE PARAMETERS** rather than read from the wasm module, so this file and its node tests
 * need no wasm. `main.ts` hands in `encodings()` and `fieldWidths()`.
 */

import { listedWidth } from './field-width'
import { knownListing, type Listing } from './protocol'

/** The `localStorage` key, namespaced for the reason `appearance.ts`'s `STORAGE_KEY` gives. */
export const PROGRAM_STORAGE_KEY = 'redextape.program'

/**
 * Bumped when the stored shape changes. A mismatch falls back to the first-load example rather than migrating.
 *
 * **`width` NEEDS NO BUMP** (the TM width design, decision 14): it is written only when pinned, and a payload without
 * it means auto, so an auto program's payload has no `width` and every version-1 payload reads as the program it
 * stored. A bump would send every version-1 program back to the first-load example. **NOR DOES `listing`**, for the
 * same reason: it is written only when optimised, and a payload without it is as built.
 */
export const PROGRAM_VERSION = 1

/**
 * What survives a reload of the program: its text, the encoding it compiles under, its width, `null` for auto, and
 * the listing its CLIF views show.
 */
export type StoredProgram = {
  readonly text: string
  readonly encoding: string
  readonly width: number | null
  readonly listing: Listing
}

/**
 * `program` as stored. A `width` left out is auto, as `null` is, and neither writes one; a `listing` left out is
 * as built, and as built writes none.
 */
export function serializeProgram(
  program: Omit<StoredProgram, 'width' | 'listing'> & {
    readonly width?: number | null | undefined
    readonly listing?: Listing | undefined
  },
): string {
  const { text, encoding, width, listing } = program
  return JSON.stringify({
    version: PROGRAM_VERSION,
    text,
    encoding,
    ...(typeof width === 'number' ? { width } : {}),
    ...(listing === 'optimised' ? { listing } : {}),
  })
}

/**
 * The stored program, or `null` for a missing key, text that is not JSON, another version, a `text` that is not a
 * string, or an `encoding` that is not one of `encodings`.
 *
 * **A `width` THAT IS NOT ONE OF `widths` READS AS AUTO, AND REFUSES NOTHING** (decision 15): refusing the program
 * would lose its text over a field that only says how its TM runs. **A `listing` IT DOES NOT KNOW READS AS BUILT**, for
 * the same reason: it only says which listing the program's CLIF views show.
 */
export function parseProgram(
  raw: string | null,
  encodings: readonly string[],
  widths: readonly number[],
): StoredProgram | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const stored = parsed as Record<string, unknown>
  if (stored.version !== PROGRAM_VERSION) return null
  if (typeof stored.text !== 'string') return null
  if (typeof stored.encoding !== 'string' || !encodings.includes(stored.encoding)) return null
  return {
    text: stored.text,
    encoding: stored.encoding,
    width: listedWidth(stored.width, widths),
    listing: knownListing(stored.listing) ?? 'as-built',
  }
}

/**
 * **THE KEY NO PART OF THE APP READS, REMOVED AT EVERY START-UP.** A tab still running an older build can write it
 * again, so a removal made once behind a flag would leave it. Silent when the storage refuses, as a failed read of the
 * program is: a key left behind costs its bytes and nothing else.
 *
 * **IT READS `localStorage` INSIDE ITS `try`**, for the reason `editor-prefs.ts`'s `readFormatOnBlur` gives: where site
 * data is blocked the getter itself throws, and a default parameter would read it before the `try` begins.
 */
export function forgetCopies(store?: Storage): void {
  try {
    ;(store ?? localStorage).removeItem('redextape.buffers')
  } catch {
    // Nothing reads the key, so a storage that refuses leaves nothing to put right.
  }
}
