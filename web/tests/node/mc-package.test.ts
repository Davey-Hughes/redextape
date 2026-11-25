import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { compile, initSync as initPkg, type Session } from '../../../pkg/redextape_wasm.js'
import { ClifSession, initSync as initClif } from '../../../pkg-clif/redextape_clif_wasm.js'
import * as arm64 from '../../../pkg-mc-arm64/redextape_mc_wasm.js'
import * as x86 from '../../../pkg-mc-x86-64/redextape_mc_wasm.js'
import type { McListing } from '../../bindings/McListing'
import type { McRow } from '../../bindings/McRow'
import type { McTarget } from '../../bindings/McTarget'
import { EXAMPLES } from '../../src/examples'

/**
 * **`pkg-mc-x86-64/` AND `pkg-mc-arm64/` COMPILE WHAT `pkg/`'s `clifInput()` HANDS THEM TO THE SNAPSHOTS' BYTES, THROUGH THE REAL EXPORTS.**
 * `redextape-native`'s test holds the module-free compile to the snapshots natively; only here is it built for wasm32,
 * where cranelift-codegen has `host-arch` off and one backend on, so a difference only that build makes is caught.
 */

const ROOT = new URL('../../../', import.meta.url)
const read = (path: string): Buffer => readFileSync(fileURLToPath(new URL(path, ROOT)))
const FACT = read('web/src/examples/fact.rxt').toString('utf8')

/**
 * Each name is what its package's `target()` returns, which the first case asserts, and `satisfies McTarget` has
 * `tsc` hold the generated binding to it. vitest strips the types, so `pnpm run typecheck` is what fails when they
 * part.
 */
const PACKAGES = [
  { pkg: x86, name: 'x86-64' satisfies McTarget, triple: 'x86_64-unknown-linux-gnu' },
  { pkg: arm64, name: 'arm64' satisfies McTarget, triple: 'aarch64-unknown-linux-gnu' },
] as const
const LEVELS = [
  ['as-built', 'none'],
  ['optimised', 'speed'],
] as const

beforeAll(() => {
  initPkg({ module: read('pkg/redextape_wasm_bg.wasm') })
  initClif({ module: read('pkg-clif/redextape_clif_wasm_bg.wasm') })
  x86.initSync({ module: read('pkg-mc-x86-64/redextape_mc_wasm_bg.wasm') })
  arm64.initSync({ module: read('pkg-mc-arm64/redextape_mc_wasm_bg.wasm') })
})

function compiled(src: string): Session {
  const { session } = compile(src, 'unary') as { session: Session | null }
  if (session === null) throw new Error(`no session for ${src}`)
  return session
}

/** What `run` threw: the exports throw strings, not `Error`s. */
function thrown(run: () => unknown): unknown {
  try {
    run()
  } catch (e) {
    return e
  }
  throw new Error('nothing was thrown')
}

/** FNV-1a, 64 bits, as the snapshots hash each function's code. */
function fnv1a64(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n
  for (const b of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(b)) * 0x100000001b3n)
  return hash.toString(16).padStart(16, '0')
}

/** Each function's `;; function` line, from the bytes of its rows in order. */
function summary(listing: McListing): string[] {
  return listing.functions.map((f, k) => {
    const hex = listing.rows
      .filter((r) => r.kind === 'Inst' && r.function === k)
      .map((r) => r.bytes)
      .join('')
    const bytes = Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16))
    expect(bytes.length, f.name).toBe(f.size)
    return `;; function ${f.name}: ${f.size} bytes, fnv1a64 ${fnv1a64(bytes)}`
  })
}

/** The `;; function` lines of example `id`'s snapshot's machine code for `triple` at `level`. */
function snapshotted(id: string, triple: string, level: string): string[] {
  const snapshot = read(`crates/redextape-native/snapshots/example-${id}.clif`).toString('utf8')
  const header = `\n;; ==== ${triple} ${level}: machine code ====\n`
  const at = snapshot.indexOf(header)
  if (at < 0) throw new Error(`no section for ${id} ${triple} ${level}`)
  const rest = snapshot.slice(at + header.length)
  const end = rest.indexOf('\n;; ==== ')
  return (end < 0 ? rest : rest.slice(0, end)).split('\n').filter((line) => line.startsWith(';; function '))
}

describe.each(PACKAGES)('pkg-mc for $name', ({ pkg, name, triple }) => {
  it('names its target', () => {
    expect(pkg.target()).toBe(name)
  })

  it.each(EXAMPLES.flatMap(({ id, text }) => LEVELS.map(([listing, level]) => ({ id, text, listing, level }))))(
    "compiles example $id $listing to the snapshot's $level bytes",
    ({ id, text, listing, level }) => {
      const mc = pkg.machineCode(compiled(text).clifInput(), listing) as McListing
      expect(mc.target).toBe(name)
      expect(summary(mc)).toEqual(snapshotted(id, triple, level))
    },
  )

  it.each(LEVELS)('marks only pcs the clif listing %s carries', (listing) => {
    const input = compiled(FACT).clifInput()
    const clif = new ClifSession(input, listing).listing() as { rows: { pc: number | null }[] }
    const pcs = new Set(clif.rows.flatMap((r) => (r.pc === null ? [] : [r.pc])))
    const mc = pkg.machineCode(input, listing) as McListing
    const marked = mc.rows.flatMap((r) => (r.pc === null ? [] : [r.pc]))
    expect(marked.length, 'precondition: some rows carry a pc').toBeGreaterThan(0)
    for (const pc of marked) expect(pcs).toContain(pc)
  })

  it('names the recursive call by its subroutine', () => {
    const mc = pkg.machineCode(compiled(FACT).clifInput(), 'as-built') as McListing
    expect(mc.rows.map((r) => r.callee)).toContain('u0:12 fact.0')
  })

  it('refuses a listing it does not know by name', () => {
    const input = compiled(FACT).clifInput()
    expect(thrown(() => pkg.machineCode(input, 'sideways'))).toBe('unknown listing "sideways"')
  })

  it('refuses an input clifInput() did not write', () => {
    expect(thrown(() => pkg.machineCode({ program: null }, 'as-built'))).toMatch(/^machineCode: not a clifInput\(\): /)
  })
})

it('gives x86-64 rows both syntaxes and arm64 rows one', () => {
  const input = compiled(FACT).clifInput()
  const insts = (pkg: typeof x86): McRow[] =>
    (pkg.machineCode(input, 'as-built') as McListing).rows.filter((r) => r.kind === 'Inst')
  expect(insts(x86).every((r) => r.intel !== null)).toBe(true)
  expect(
    insts(x86).some((r) => r.intel !== r.text),
    'precondition: the syntaxes differ',
  ).toBe(true)
  expect(insts(arm64).every((r) => r.intel === null)).toBe(true)
})
