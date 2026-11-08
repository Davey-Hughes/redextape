import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **THE WORDS THE PAGE SHOWS COME FROM THE BUILT WASM, AND NOTHING ELSE CHECKS THEM** — Plan 7 part 2
 * spec §12.
 *
 * Among the app's user-visible sentences that are Rust are the λ refusal for a term too large to copy and
 * the TM and rxm copies' size ceilings. `redextape-wasm`'s own tests hold the source strings, and no web
 * test reads them — reaching the first through the browser needs a term past the byte budget, and each
 * ceiling a file of megabytes. So the gap is not the rename, it is the ARTEFACT: `pkg/` is gitignored and
 * rebuilt by hand, and a checkout whose `pkg/` predates the rename runs the whole browser tier against the
 * old words with every gate green.
 *
 * This reads the built module rather than the crate, so it fails when the build is stale, which the Rust
 * tests cannot say.
 */

const WASM = fileURLToPath(new URL('../../../pkg/redextape_wasm_bg.wasm', import.meta.url))

describe('the built wasm', () => {
  it('says copy, not fork, in the sentences a user reads', () => {
    const bytes = readFileSync(WASM).toString('latin1')
    expect(bytes, 'pkg/ is stale — run `pnpm run build:wasm:dev` from web/').toContain('too large to copy')
    // ONE CEILING SENTENCE FOR BOTH COPIES, whose copy name is an argument: the module holds each name and the
    // sentence's shared piece apart, so each is read on its own. The absence checks fail a module that holds an old
    // wording, whether it stores that sentence whole or in pieces: `a TM buffer` is in both forms.
    expect(bytes).toContain('a TM copy')
    expect(bytes).toContain('an rxm copy')
    expect(bytes).toContain(' builds files up to ')
    expect(bytes).not.toContain('too large to fork')
    expect(bytes).not.toContain('a TM buffer')
  })
})
