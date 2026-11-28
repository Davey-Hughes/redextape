import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, expect, it } from 'vitest'
import { compile, initSync as initPkg, type Session } from '../../../pkg/redextape_wasm.js'
import { initSync as initLlvm, llvmIr } from '../../../pkg-llvm/redextape_llvm_wasm.js'
import type { LlvmListing } from '../../bindings/LlvmListing'
import { EXAMPLES } from '../../src/examples'

/**
 * **`pkg-llvm/` WRITES WHAT `pkg/`'s `clifInput()` HANDS IT AS THE SNAPSHOTS' BUILT MODULE, EACH LINE WITH ITS PC, THROUGH THE REAL EXPORTS.**
 * `redextape-native`'s test holds the writer to the snapshots natively; only here is it built for wasm32 and fed across
 * the boundary, where a word of 2^53 or more crosses as a `BigInt`.
 */

const ROOT = new URL('../../../', import.meta.url)
const read = (path: string): Buffer => readFileSync(fileURLToPath(new URL(path, ROOT)))

beforeAll(() => {
  initPkg({ module: read('pkg/redextape_wasm_bg.wasm') })
  initLlvm({ module: read('pkg-llvm/redextape_llvm_wasm_bg.wasm') })
})

function compiled(src: string): Session {
  const { session } = compile(src, 'unary') as { session: Session | null }
  if (session === null) throw new Error(`no session for ${src}`)
  return session
}

/** What `run` threw: the export throws strings, not `Error`s. */
function thrown(run: () => unknown): unknown {
  try {
    run()
  } catch (e) {
    return e
  }
  throw new Error('nothing was thrown')
}

/** Example `id`'s snapshot's module as built, each line ended by a newline. */
function snapshotted(id: string): string {
  const snapshot = read(`crates/redextape-native/snapshots/example-${id}.ll`).toString('utf8')
  const header = '\n;; ==== built: O0 O1 O2 O3 ====\n'
  const at = snapshot.indexOf(header)
  if (at < 0) throw new Error(`no built section for ${id}`)
  const rest = snapshot.slice(at + header.length)
  const end = rest.indexOf('\n;; ==== ')
  return end < 0 ? rest : rest.slice(0, end + 1)
}

const text = (listing: LlvmListing): string => listing.lines.map((line) => `${line.text}\n`).join('')

/**
 * The pc each line should carry, read off the text alone: `N` in an `i<N>:` block, and in a `cont` block the pc of
 * the block whose guard branches to it, since the walk appends every `cont` after `exit`, away from its instruction;
 * `null` everywhere else. A pane follows a run by these, so a wrong one, or an `undefined` where the type says
 * `number | null`, is a wrong row lit.
 */
function expectedPcs(listing: LlvmListing): (number | null)[] {
  const contPc = new Map<string, number>()
  const labelPc = (label: string): number | null => {
    const instruction = /^i(\d+)$/.exec(label)
    if (instruction) return Number(instruction[1])
    if (!/^cont\d*$/.test(label)) return null
    const pc = contPc.get(label)
    if (pc === undefined) throw new Error(`no instruction's block branches to ${label} before it`)
    return pc
  }
  let inFunction = false
  let block: number | null = null
  return listing.lines.map(({ text: line }) => {
    if (line.startsWith('define ')) inFunction = true
    else if (line === '}') inFunction = false
    else if (inFunction && line !== '') {
      if (!line.startsWith(' ')) {
        block = labelPc(line.slice(0, line.indexOf(':')))
      } else if (block !== null) {
        for (const [cont] of line.matchAll(/(?<=label %)cont\d*\b/g)) contPc.set(cont, block)
      }
      return block
    }
    block = null
    return null
  })
}

it.each(EXAMPLES)("writes example $id as the snapshot's built module", ({ id, text: src }) => {
  const listing = llvmIr(compiled(src).clifInput()) as LlvmListing
  expect(text(listing)).toBe(snapshotted(id))
  for (const f of listing.functions) expect(listing.lines[f.first_line]?.text).toMatch(/^define /)
  const want = expectedPcs(listing)
  expect(
    want.some((pc) => pc !== null),
    'precondition: the text has instruction blocks',
  ).toBe(true)
  expect(listing.lines[0]?.pc, "the `; ModuleID` line's pc").toBeNull()
  expect(listing.lines.map((line) => line.pc)).toStrictEqual(want)
})

/** The program `clif-package.test.ts` carries its word in: `pkg/`'s compile aborts the module on a bare literal that size. */
it('writes a word of 2^53 or more whole', () => {
  const input = compiled('{ let mut x = 1; let x = 18446744073709551615; x + 1 }').clifInput()
  expect(input.program.code, 'precondition: an li of the word').toContainEqual({
    Li: [{ Loc: 1 }, 18446744073709551615n],
  })
  expect(text(llvmIr(input) as LlvmListing)).toMatch(/^ {2}store i64 -1, ptr %/m)
})

it('gives the reason for a program the LLVM backend refuses', () => {
  const input = compiled('fn llvm(n) { n + 1 }\nllvm(41)\n').clifInput()
  expect(thrown(() => llvmIr(input))).toMatch(/intrinsic prefix `llvm\.`/)
})

it('refuses an input clifInput() did not write', () => {
  expect(thrown(() => llvmIr({ program: null }))).toMatch(/^llvmIr: not a clifInput\(\): /)
})
