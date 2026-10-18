import { EXAMPLES, type Example } from '../../src/examples'

/**
 * The examples by id, for the files that test the examples menu. It is kept out of `harness.ts`, which every browser
 * file loads, because it imports `examples.ts` at run time.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names end in
 * `.test.ts`, and this one does not.
 */

/** The example whose id is `id`. */
export const example = (id: string): Example => EXAMPLES.find((e) => e.id === id) as Example
