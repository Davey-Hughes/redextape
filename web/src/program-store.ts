/**
 * THE PROGRAM, KEPT ACROSS RELOADS — Plan 7 part 6a spec §4.3: the source editor's text and the encoding it compiles
 * under, stored as the workspace and the copies are, under a key of their own.
 *
 * **VERSIONED AND VALIDATED AS THE OTHER STORES ARE, AND A REFUSAL IS SILENT.** `parseProgram` answers `null` for
 * anything it will not take, and `null` reads exactly as a first visit does: the app opens on the first-load example.
 * A stored program cannot be told from a hand-edited one or one a later version wrote, and a banner on every load
 * after a format change would be worse than what it reports — `buffers-store.ts`'s `parseBuffers` refuses on the same
 * terms.
 *
 * **THE ENCODINGS ARE A PARAMETER** rather than read from the wasm module, so this file needs no wasm and its node
 * tests none either. `main.ts` hands in `encodings()`.
 */

/** The `localStorage` key, namespaced for the reason `buffers-store.ts`'s `BUFFERS_STORAGE_KEY` gives. */
export const PROGRAM_STORAGE_KEY = 'redextape.program'

/** Bumped when the stored shape changes. A mismatch falls back to the first-load example rather than migrating. */
export const PROGRAM_VERSION = 1

/** What survives a reload of the program: its text, and the encoding it compiles under. */
export type StoredProgram = { readonly text: string; readonly encoding: string }

export function serializeProgram(program: StoredProgram): string {
  return JSON.stringify({ version: PROGRAM_VERSION, text: program.text, encoding: program.encoding })
}

/**
 * The stored program, or `null` for a missing key, text that is not JSON, another version, a `text` that is not a
 * string, or an `encoding` that is not one of `encodings`.
 */
export function parseProgram(raw: string | null, encodings: readonly string[]): StoredProgram | null {
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
  return { text: stored.text, encoding: stored.encoding }
}
