import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **THE `compile` EXPORT STAYS SMALL, BECAUSE V8 TIERS A HOT FUNCTION UP WHOLE.** Each function from `defunc_mapped` up
 * to the export has one caller, and `wasm-opt -O` inlines such a function whatever its size, so without the
 * `--no-inline=` entry in the wasm crate's wasm-pack release profile the defunctionalizer lands inside the export, and
 * the first compile in a fresh worker shares its CPU with a background TurboFan job over all of it. A pattern that
 * matches nothing is no error to `wasm-opt`, so a rename or a move of the function, or a `wasm-opt` that ignores the
 * pass, would undo it with every build green. The release module keeps no `name` section to find the function by, so
 * this reads body sizes.
 */

const WASM = fileURLToPath(new URL('../../../pkg/redextape_wasm_bg.wasm', import.meta.url))

/** Past the `compile` export's own code and short of the defunctionalizer's, so it tells the two layouts apart. */
const BOUND = 36_000

/**
 * Each function body's size in bytes by function index, each function export's index by name, and whether the module
 * has a `name` section.
 */
function layout(bytes: Buffer<ArrayBuffer>): {
  bodies: Map<number, number>
  exports: Map<string, number>
  named: boolean
} {
  const imported = WebAssembly.Module.imports(new WebAssembly.Module(bytes)).filter((i) => i.kind === 'function')
  let at = 8
  const next = (): number => {
    const byte = bytes[at]
    if (byte === undefined) throw new Error(`pkg/'s module ends inside a section, at byte ${at}`)
    at += 1
    return byte
  }
  const u32 = (): number => {
    let value = 0
    for (let shift = 0; ; shift += 7) {
      const byte = next()
      value += (byte & 0x7f) * 2 ** shift
      if (byte < 0x80) return value
    }
  }
  const name = (): string => {
    const length = u32()
    at += length
    return bytes.toString('utf8', at - length, at)
  }
  const bodies = new Map<number, number>()
  const exports = new Map<string, number>()
  let named = false
  while (at < bytes.length) {
    const id = next()
    const size = u32()
    const end = at + size
    if (id === 0 && name() === 'name') named = true
    if (id === 7) {
      for (let n = u32(); n > 0; n -= 1) {
        const key = name()
        const kind = next()
        const index = u32()
        if (kind === 0) exports.set(key, index)
      }
    }
    if (id === 10) {
      const count = u32()
      for (let k = 0; k < count; k += 1) {
        const body = u32()
        bodies.set(imported.length + k, body)
        at += body
      }
    }
    at = end
  }
  return { bodies, exports, named }
}

describe('the built wasm', () => {
  const { bodies, exports, named } = layout(readFileSync(WASM))

  it('keeps the defunctionalizer out of the `compile` export', () => {
    const compile = bodies.get(exports.get('compile') ?? -1)
    expect(compile, 'pkg/ has no `compile` export').toBeDefined()
    expect(
      compile,
      "is `defunc_mapped` inside `compile`? Does crates/redextape-wasm/Cargo.toml's `--no-inline=` name its path?",
    ).toBeLessThan(BOUND)
  })

  // The bound is about `wasm-opt`'s layout. A dev build runs no `wasm-opt`, which is why it keeps its `name` section.
  it.skipIf(named)('has a function past the bound, so the bound still tells the two layouts apart', () => {
    expect(Math.max(...bodies.values()), 'the defunctionalizer is under the bound: lower it').toBeGreaterThanOrEqual(
      BOUND,
    )
  })
})
