import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **`pkg-clif/` EXPORTS NONE OF THE NATIVE RUNTIME'S `rt_*` FUNCTIONS.** The clif stepper calls the runtime from Rust,
 * but a `#[unsafe(no_mangle)]` function is exported from every `cdylib` its crate is linked into, so the runtime's
 * `link-names` feature, which only the AOT staticlib needs, must stay off in this build. It is on by default, and
 * `redextape-clif` turns it off. Any new path from this build to the runtime with its default features, such as
 * `redextape-native`'s JIT features, would turn it back on with every Rust build green.
 */

const WASM = fileURLToPath(new URL('../../../pkg-clif/redextape_clif_wasm_bg.wasm', import.meta.url))

describe("pkg-clif's exports", () => {
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(readFileSync(WASM))).map((e) => e.name)

  it('name no rt_ function', () => {
    expect(exports, 'precondition: the module exports its memory').toContain('memory')
    expect(exports.filter((name) => name.startsWith('rt_'))).toEqual([])
  })
})
