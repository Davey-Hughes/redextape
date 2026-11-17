/**
 * THE PROGRAM, KEPT ACROSS RELOADS — Plan 7 part 6a spec §4.3: the source editor's text, and the encoding and width it
 * compiles under, stored as the workspace and the copies are, under a key of their own.
 *
 * **VERSIONED AND VALIDATED AS THE OTHER STORES ARE, AND A REFUSAL IS SILENT.** `parseProgram` answers `null` for
 * anything it will not take, and `null` reads exactly as a first visit does: the app opens on the first-load example.
 * A stored program cannot be told from a hand-edited one or one a later version wrote, and a banner on every load
 * after a format change would be worse than what it reports — `buffers-store.ts`'s `parseBuffers` refuses on the same
 * terms.
 *
 * **THE ENCODINGS AND WIDTHS ARE PARAMETERS** rather than read from the wasm module, so this file and its node tests
 * need no wasm. `main.ts` hands in `encodings()` and `fieldWidths()`.
 */

import { listedWidth } from './field-width'

/** The `localStorage` key, namespaced for the reason `buffers-store.ts`'s `BUFFERS_STORAGE_KEY` gives. */
export const PROGRAM_STORAGE_KEY = 'redextape.program'

/**
 * Bumped when the stored shape changes. A mismatch falls back to the first-load example rather than migrating.
 *
 * **`width` NEEDS NO BUMP** (the TM width design, decision 14): it is written only when pinned, and a payload without
 * it means auto, so an auto program's payload has no `width` and every version-1 payload reads as the program it
 * stored. A bump would send every version-1 program back to the first-load example.
 */
export const PROGRAM_VERSION = 1

/** What survives a reload of the program: its text, the encoding it compiles under, and its width, `null` for auto. */
export type StoredProgram = { readonly text: string; readonly encoding: string; readonly width: number | null }

/** `program` as stored. A `width` left out is auto, as `null` is, and neither writes one. */
export function serializeProgram(
  program: Omit<StoredProgram, 'width'> & { readonly width?: number | null | undefined },
): string {
  const { text, encoding, width } = program
  return JSON.stringify({ version: PROGRAM_VERSION, text, encoding, ...(typeof width === 'number' ? { width } : {}) })
}

/**
 * The stored program, or `null` for a missing key, text that is not JSON, another version, a `text` that is not a
 * string, or an `encoding` that is not one of `encodings`.
 *
 * **A `width` THAT IS NOT ONE OF `widths` READS AS AUTO, AND REFUSES NOTHING** (decision 15): refusing the program
 * would lose its text over a field that only says how its TM runs.
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
  return { text: stored.text, encoding: stored.encoding, width: listedWidth(stored.width, widths) }
}
