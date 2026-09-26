import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import { LambdaTrees } from '../../src/lambda-trees'
import type { LambdaTreeWire } from '../../src/protocol'
import { SessionClient } from '../../src/session-client'
import { SHELL, until } from './harness'
import { lambdaSettled } from './lambda-text'

/**
 * WHAT A TREE FOR THE DISPLAYED STEP COSTS, END TO END (Plan 7 part 4a, spec §11 item 5). A PROBE, NOT A
 * GATE: `pnpm test:probe:lambda-tree`, excluded from the default run by `vite.config.ts`'s `PROBE_FILES`.
 *
 * TWO CLOCKS, BOTH INSIDE THE APP, because the obvious one lies: timing a `◀` click to `lambdaSettled()`
 * measured the harness's 20 ms poll — every program came out at 21.6 to 22.1 ms median in the first draft of
 * this file. So: `round trip` is a `SessionClient.tree` request to the `LambdaTrees.store` of its answer (the
 * worker's replay from its nearest checkpoint, the arena, the transfer), and `draw` is the first
 * `LambdaPane.renderTree` call to receive each tree (the layout and the paint; later frames reuse the
 * layout). The numbers go to the console for the roadmap entry; the only assertion is that every step was
 * answered at all.
 *
 * **THE LISTS ARE HERE FOR THE ARENA'S NAMING.** `listN` is a literal of `N` zeros. The arena names every
 * binder against the names in scope (spec §4.3's `fresh()` rule), and it was on these programs' terms that
 * the naming's cost showed.
 */
const list = (n: number): string => `[${Array(n).fill('0').join(', ')}]`
const PROGRAMS: readonly (readonly [string, string])[] = [
  ['fact3', 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(3)'],
  ['fact4', 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(4)'],
  ['while4', 'let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc'],
  ['list200', list(200)],
  ['list400', list(400)],
  ['list699', list(699)],
]
/** Steps back from the frontier per program — enough to cross a checkpoint boundary at least once. */
const SAMPLES = 300

let view: EditorView

const stepText = () => document.querySelector('[data-leaf="lambda-0"] .step')?.textContent ?? ''
const back = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')]
    .find((b) => b.textContent === '◀')
    ?.click()

function stats(xs: number[]): string {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number) => (s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0).toFixed(2)
  return `n=${s.length} median=${at(0.5)}ms p90=${at(0.9)}ms max=${at(1)}ms`
}

describe('the cost of the λ tree', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  it('times the round trip from a step to its drawn tree', async () => {
    for (const [name, src] of PROGRAMS) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
      await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', `${name} to compile`)
      await until(() => /ended|history is full/.test(stepText()) || !stepText().endsWith('…'), `${name} to record`)
      await lambdaSettled()
      const asked = new Map<number, number>()
      const trips: number[] = []
      const draws: number[] = []
      const tree = SessionClient.prototype.tree
      const store = LambdaTrees.prototype.store
      const render = LambdaPane.prototype.renderTree
      vi.spyOn(SessionClient.prototype, 'tree').mockImplementation(function (this: SessionClient, step, budget) {
        asked.set(step, performance.now())
        tree.call(this, step, budget)
      })
      vi.spyOn(LambdaTrees.prototype, 'store').mockImplementation(function (
        this: LambdaTrees,
        session,
        gen,
        wire: LambdaTreeWire,
      ) {
        const t0 = asked.get(wire.step)
        if (t0 !== undefined) trips.push(performance.now() - t0)
        store.call(this, session, gen, wire)
      })
      const drawn = new WeakSet<LambdaTreeWire>()
      vi.spyOn(LambdaPane.prototype, 'renderTree').mockImplementation(function (this: LambdaPane, treeFor, pin) {
        const t0 = performance.now()
        render.call(this, treeFor, pin)
        // THE FIRST DRAW OF EACH TREE ONLY: later frames of the same step reuse its layout, and counting them
        // would report the cache.
        if (treeFor.kind === 'tree' && !drawn.has(treeFor.tree)) {
          drawn.add(treeFor.tree)
          draws.push(performance.now() - t0)
        }
      })
      for (let i = 0; i < SAMPLES; i += 1) {
        back()
        await lambdaSettled()
      }
      vi.restoreAllMocks()
      console.log(`lambda-tree-cost ${name}: round trip ${stats(trips)}; draw ${stats(draws)}`)
      expect(trips.length).toBeGreaterThanOrEqual(SAMPLES)
    }
  }, 1_200_000)
})
