import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { commands, page } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { type Heard, hearSessionWorkers, sleep } from './clif-fixture'
import { compile, host, SHELL, stateIdle, until } from './harness'
import { codeRows, MC_MATCH, mcFetched, mcRequests, sourceAndClif, twice } from './mc-fixture'

/**
 * A stored workspace whose clif view has its machine code panel open on *arm64* fetches arm64's package at start and
 * x86-64's not at all, and asks for the code once per compiled generation, never before that generation's `compiled`
 * (machine code panel design §6, *Loading* and *Building*): `mc-fetch.test.ts`'s doc has why this is a file alone.
 */

const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
/** `FACT` with one more addition: a program the page does not hold at start, so its compile is a new generation. */
const FACT_PLUS = `${FACT.trimEnd()} + 1\n`
/** Each long case's own bound, past every wait in it. */
const CASE_MS = 60_000

let ear: ReturnType<typeof hearSessionWorkers>
let view: EditorView

const clif = () => host('clif-0') as HTMLElement

beforeAll(async () => {
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    sourceAndClif({
      panels: { 'clif-0': { code: true } },
      clifDisplay: { 'clif-0': { layout: 'compact', target: 'arm64' } },
    }),
  )
  ear = hearSessionWorkers()
  await commands.watchRequests('start', MC_MATCH)
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
}, 30_000)

afterAll(() => ear.restore())

/**
 * Each `mc` asked for in `heard`, with the generation it asks of and whether that generation's `compiled` had come
 * before it.
 */
function asks(heard: readonly Heard[]): { gen: number; target: string; afterCompiled: boolean }[] {
  const compiled = new Set<number>()
  const found: { gen: number; target: string; afterCompiled: boolean }[] = []
  for (const h of heard) {
    if ('reply' in h && h.reply.kind === 'compiled') compiled.add(h.reply.gen)
    if ('request' in h && h.request.kind === 'mc')
      found.push({ gen: h.request.gen, target: h.request.target, afterCompiled: compiled.has(h.request.gen) })
  }
  return found
}

it(
  'fetches arm64’s package at start, and asks once per generation after its compile',
  async () => {
    await mcFetched('arm64')
    await until(() => codeRows(clif()).length > 0, 'the panel to show arm64’s rows')
    await sleep(400)
    const first = asks(ear.heard)
    // AFTER ITS COMPILE FIRST, then how many: an ask before the compile is asked again after it, and would be counted.
    expect(
      first.every((a) => a.target === 'arm64' && a.afterCompiled),
      'arm64’s, after its compile',
    ).toBe(true)
    expect(first.length, 'one ask for the first generation').toBe(1)

    await compile(view, FACT_PLUS)
    await until(() => asks(ear.heard).length > first.length, 'an ask for the new program')
    await until(() => codeRows(clif()).length > 0, 'the panel to show the new program’s rows')
    await sleep(400)
    const all = asks(ear.heard)
    const gens = all.map((a) => a.gen)
    expect(
      gens.filter((g, i) => gens.indexOf(g) !== i),
      'a generation asked twice',
    ).toEqual([])
    expect(
      all.every((a) => a.target === 'arm64' && a.afterCompiled),
      'every ask arm64’s, after its compile',
    ).toBe(true)
    const requests = await mcRequests()
    expect(requests['x86-64'], 'x86-64’s package').toEqual([])
    expect(twice(requests.arm64), 'a request made twice').toEqual([])
  },
  CASE_MS,
)
