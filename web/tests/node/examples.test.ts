import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EXAMPLES, FIRST_LOAD } from '../../src/examples'
import { LEGS } from '../../src/legs'

/**
 * The examples' manifest (Plan 7 part 6a spec §8's node row): every file served and served whole, one entry per id,
 * the first-load example among them, and an outcome for every leg. What each example DOES is the browser tier's
 * `examples.test.ts`, which runs them.
 */

const DIR = fileURLToPath(new URL('../../src/examples/', import.meta.url))

describe('the examples manifest', () => {
  it('serves every file in src/examples, and nothing that is not one', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.rxt'))
      .map((f) => f.slice(0, -'.rxt'.length))
    expect(files.length).toBe(7)
    expect(EXAMPLES.map((e) => e.id).sort()).toEqual(files.sort())
  })

  it('serves each file as the file holds it', () => {
    for (const e of EXAMPLES) expect(e.text, e.id).toBe(readFileSync(`${DIR}${e.id}.rxt`, 'utf8'))
  })

  it('names each example once, by id and by title', () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length)
    expect(new Set(EXAMPLES.map((e) => e.title)).size).toBe(EXAMPLES.length)
  })

  it('opens a first visit on an entry of the menu: sum_to(5)', () => {
    expect(EXAMPLES).toContain(FIRST_LOAD)
    expect(FIRST_LOAD.id).toBe('sum-to')
  })

  it('declares how every leg of every example stops', () => {
    for (const e of EXAMPLES) {
      expect(Object.keys(e.outcomes).sort(), e.id).toEqual([...LEGS].sort())
      for (const leg of LEGS) expect(['ended', 'history-full', 'declined'], `${e.id} ${leg}`).toContain(e.outcomes[leg])
    }
  })

  it('describes each example in one line', () => {
    for (const e of EXAMPLES) {
      expect(e.title, e.id).not.toBe('')
      expect(e.description, e.id).not.toBe('')
      expect(e.description, e.id).not.toContain('\n')
    }
  })
})
