import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **THE WORDS THE PAGE SHOWS COME FROM THE BUILT WASM, AND NOTHING ELSE CHECKS THEM** — Plan 7 part 2
 * spec §12.
 *
 * Two of the app's user-visible sentences are Rust: the λ refusal for a term too large to copy, and the
 * TM buffer's size ceiling. `redextape-wasm`'s own tests hold the source strings, and no web test reads
 * either — reaching the first through the browser needs a term past the byte budget. So the gap is not
 * the rename, it is the ARTEFACT: `pkg/` is gitignored and rebuilt by hand, and a checkout whose `pkg/`
 * predates the rename runs the whole browser tier against the old words with every gate green. That is
 * exactly what this branch found in its own working tree.
 *
 * This reads the built module rather than the crate, so it fails when the build is stale — which is the
 * one thing the Rust tests cannot say.
 */

const WASM = fileURLToPath(new URL('../../../pkg/redextape_wasm_bg.wasm', import.meta.url))

describe('the built wasm', () => {
  it('says copy, not fork, in the sentences a user reads', () => {
    const bytes = readFileSync(WASM).toString('latin1')
    expect(bytes, 'pkg/ is stale — run `pnpm run build:wasm:dev` from web/').toContain('too large to copy')
    expect(bytes).toContain('a TM copy builds files up to')
    expect(bytes).not.toContain('too large to fork')
    expect(bytes).not.toContain('a TM buffer builds files up to')
  })
})
