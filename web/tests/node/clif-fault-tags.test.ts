import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { compile, initSync as initPkg, type Session } from '../../../pkg/redextape_wasm.js'
import { ClifSession, initSync as initClif } from '../../../pkg-clif/redextape_clif_wasm.js'
import { clifValues } from '../../src/clif-view'
import type { ClifListing, ClifState, ClifWindow } from '../../src/types'
import { FAULT_CASES, madeBy } from './clif-fault-fixture'

/**
 * A CLIF run that a fault stopped, through both builds' real exports and read as the values panel reads it. The runtime
 * has stopped when the caller's `cons` or box runs, so that call allocates nothing and its word is a plain 0, as every
 * read in the same state is. Each case's control, the same call with no fault before it, reads as the list or box it
 * makes on the row the fault case reads, which shows that row is the call's own. Both listings are read before one
 * assertion holds them, so a failure shows each.
 */

const ROOT = new URL('../../../', import.meta.url)
const read = (path: string): Buffer => readFileSync(fileURLToPath(new URL(path, ROOT)))
const WINDOW: ClifWindow = { values: 1000, frames: 8, cells: 16, boxes: 16, result: 0 }
const LISTINGS = ['as-built', 'optimised']

beforeAll(() => {
  initPkg({ module: read('pkg/redextape_wasm_bg.wasm') })
  initClif({ module: read('pkg-clif/redextape_clif_wasm_bg.wasm') })
})

function compiled(src: string): Session {
  const { session } = compile(src, 'unary') as { session: Session | null }
  if (session === null) throw new Error(`no session for ${src}`)
  return session
}

/** `src`'s CLIF run in `listing`, stepped to its end. */
function ended(src: string, listing: string): ClifSession {
  const clif = new ClifSession(compiled(src).clifInput(), listing)
  let steps = 0
  while (clif.step()) {
    steps += 1
    if (steps > 10_000) throw new Error(`${listing}: no end after ${steps} steps`)
  }
  return clif
}

describe('a CLIF run a fault stopped', () => {
  it.each(FAULT_CASES)('shows %s made after the fault as a plain 0, %s', (_, src, index) => {
    const shown = LISTINGS.map((listing) => {
      const clif = ended(src, listing)
      expect(Object.keys(clif.value() as object), `${listing}: the run's end`).toEqual(['Fault'])
      const state = clif.state(WINDOW) as ClifState
      expect([state.heap_len, state.box_len], `${listing}: nothing was allocated`).toEqual([0, 0])
      const made = `v${madeBy(clif.listing() as ClifListing, index)}`
      return [listing, clifValues(state, false).rows.find((r) => r.name === made)?.text]
    })
    expect(shown, "the value the call set, in each listing's values panel").toEqual([
      ['as-built', '0'],
      ['optimised', '0'],
    ])
  })
})

describe('the same call with no fault before it', () => {
  it.each(FAULT_CASES)(
    'shows %s as the list or box it made, on the row the fault case reads',
    (_, src, index, control, text) => {
      const shown = LISTINGS.map((listing) => {
        const clif = ended(control, listing)
        expect(Object.keys(clif.value() as object), `${listing}: the run's end`).toEqual(['Value'])
        const made = `v${madeBy(clif.listing() as ClifListing, index)}`
        const faultMade = `v${madeBy(ended(src, listing).listing() as ClifListing, index)}`
        expect(made, `${listing}: the row the fault case reads`).toBe(faultMade)
        return [listing, clifValues(clif.state(WINDOW) as ClifState, true).rows.find((r) => r.name === made)?.text]
      })
      expect(shown, "the value the call set, in each listing's values panel").toEqual([
        ['as-built', text],
        ['optimised', text],
      ])
    },
  )
})
