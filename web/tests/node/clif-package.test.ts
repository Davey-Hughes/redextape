import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { compile, initSync as initPkg, type Session } from '../../../pkg/redextape_wasm.js'
import { ClifSession, initSync as initClif } from '../../../pkg-clif/redextape_clif_wasm.js'

/**
 * **`pkg-clif/` RUNS WHAT `pkg/`'s `clifInput()` HANDS IT, THROUGH THE REAL EXPORTS OF BOTH BUILDS.** The Rust tests
 * build a leg from a `Program` in memory; only here does the input cross the boundary twice, out of one module and into
 * the other, which is where a word of 2^53 or more, or a field renamed on one side, breaks the contract.
 *
 * The listings are held to the snapshots too: the optimiser is checked against them natively, where cranelift-codegen
 * builds with its default features and its x86 and arm64 backends, and the wasm32 build has `host-arch`, `timing` and
 * both backends off, so a difference only wasm32 makes is caught here.
 */

const ROOT = new URL('../../../', import.meta.url)
const read = (path: string): Buffer => readFileSync(fileURLToPath(new URL(path, ROOT)))
const FACT = read('web/src/examples/fact.rxt').toString('utf8')

beforeAll(() => {
  initPkg({ module: read('pkg/redextape_wasm_bg.wasm') })
  initClif({ module: read('pkg-clif/redextape_clif_wasm_bg.wasm') })
})

function compiled(src: string): Session {
  const { session } = compile(src, 'unary') as { session: Session | null }
  if (session === null) throw new Error(`no session for ${src}`)
  return session
}

/** `session`'s CLIF leg as `listing`, its end found. */
function ended(session: Session, listing: string): ClifSession {
  const clif = new ClifSession(session.clifInput(), listing)
  for (let chunk = 0; !clif.findEnd(1_000_000); chunk += 1) {
    if (chunk === 100) throw new Error(`no end after ${chunk} chunks`)
  }
  return clif
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

type Row = { indent: number; pc: number | null; text: string }
type Listing = { functions: { first_row: number }[]; rows: Row[] }

/** `listing` as Cranelift prints it, each pc back in its `@xxxx` column, the functions apart by an empty line. */
function printed(listing: Listing): string {
  const starts = new Set(listing.functions.map((f) => f.first_row).filter((row) => row > 0))
  const line = (row: Row): string =>
    row.pc === null
      ? ' '.repeat(row.indent) + row.text
      : `@${row.pc.toString(16).padStart(4, '0')} ${' '.repeat(Math.max(row.indent - 6, 0))}${row.text}`
  return listing.rows.map((row, i) => `${starts.has(i) ? '\n' : ''}${line(row)}\n`).join('')
}

/** The text of the snapshot's section `title`, after its header up to the next header. */
function section(file: string, title: string): string {
  const header = `\n;; ==== ${title} ====\n`
  const at = file.indexOf(header)
  if (at < 0) throw new Error(`no section ${title}`)
  const rest = file.slice(at + header.length)
  const end = rest.indexOf('\n;; ==== ')
  return end < 0 ? rest : rest.slice(0, end + 1)
}

describe('a CLIF session built from clifInput()', () => {
  it.each([
    ['as-built', 189],
    ['optimised', 131],
  ])("runs fact.rxt %s in %i steps to the rxm leg's value", (listing, steps) => {
    const session = compiled(FACT)
    const clif = ended(session, listing)
    expect(clif.status().total_steps).toBe(steps)
    expect(clif.value()).toEqual(session.rxmValue())
    expect(clif.value()).toEqual({ Value: { text: '24' } })
  })

  it.each([
    ['as-built', 'built'],
    ['optimised', 'x86_64-unknown-linux-gnu speed: optimised'],
  ])("lists fact.rxt %s as the native snapshot's %s section", (listing, title) => {
    const snapshot = read('crates/redextape-native/snapshots/example-fact.clif').toString('utf8')
    expect(printed(ended(compiled(FACT), listing).listing())).toBe(section(snapshot, title))
  })

  it.each(['as-built', 'optimised'])('names the call that faulted, as the rxm leg does, %s', (listing) => {
    const session = compiled('head(nil)')
    expect(ended(session, listing).value()).toEqual(session.rxmValue())
    expect(session.rxmValue()).toEqual({ Fault: { message: 'head of empty list at pc1' } })
  })

  /** Not `18446744073709551615 + 1` alone: pkg/'s compile aborts the module on it. */
  it.each(['as-built', 'optimised'])('carries a word past 2^53 across both builds, %s', (listing) => {
    const session = compiled('{ let mut x = 1; let x = 18446744073709551615; x + 1 }')
    expect(session.clifInput().program.code, 'precondition: an li of the word').toContainEqual({
      Li: [{ Loc: 1 }, 18446744073709551615n],
    })
    expect(ended(session, listing).value()).toEqual(session.rxmValue())
    expect(session.rxmValue()).toEqual({ Value: { text: '18446744073709551615' } })
  })

  /** The window crosses in through `state()`'s deserializer and the word comes back out as a string. */
  it('shows a word past 2^53 in the state', () => {
    const big = '{ let mut x = 1; let x = 18446744073709551615; x + 1 }'
    const clif = new ClifSession(compiled(big).clifInput(), 'as-built')
    const window = { values: 1000, frames: 0, cells: 0, boxes: 0 }
    const words = (): string[] =>
      (clif.state(window) as { values: { word: { word: string } }[] }).values.map((v) => v.word.word)
    let held = words()
    while (!held.includes('18446744073709551615') && clif.step()) held = words()
    expect(held).toContain('18446744073709551615')
  })

  it('refuses a listing it does not know by name', () => {
    const input = compiled(FACT).clifInput()
    expect(thrown(() => new ClifSession(input, 'sideways'))).toBe('unknown listing "sideways"')
  })

  it('refuses an input clifInput() did not write', () => {
    expect(thrown(() => new ClifSession({ program: null }, 'as-built'))).toMatch(/^ClifSession: not a clifInput\(\): /)
  })

  /** The sentence alone, since the page shows it after words of its own. */
  it('says why a program has no CLIF', () => {
    const input = {
      program: { code: [{ Call: 'missing' }, 'Halt'], labels: [] },
      ty: 'Nat',
      caps: { steps: 5_000_000, stack: 100_000, heap: 5_000_000, mem: 64_000_000 },
    }
    expect(thrown(() => new ClifSession(input, 'as-built'))).toBe('call to undefined label `missing`')
  })

  it('has no input to give for a program the rxm leg declines', () => {
    const list = `[${Array.from({ length: 2048 }, (_, i) => i).join(', ')}]`
    expect(compiled(list).clifInput()).toBeNull()
  })
})
