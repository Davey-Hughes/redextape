import { BUFFERS_STORAGE_KEY, parseBuffers } from '../../src/buffers-store'

/**
 * A copy's text of record, the stored bindings and the stored buffers whole, read back from storage.
 * It is kept out of `harness.ts`, which every browser file loads, because it imports `buffers-store.ts` at run time.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names end in
 * `.test.ts`, and this one does not.
 */

/** A copy's text of record, as stored — what a reload, a resume and an undo rebuild it from. */
export const stored = (id: string): string | null =>
  parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))?.buffers.find((b) => b.id === id)?.text ?? null

/** The bindings the buffers storage holds, or `undefined` where it holds none that parse. */
export const storedBindings = () => parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))?.bindings

/** What the buffers storage holds, as `parseBuffers` reads it. */
export const storedBuffers = () => parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))
