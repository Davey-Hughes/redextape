import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import init, { compile } from '../../../pkg/redextape_wasm.js'
import { EXAMPLE_ENCODING, EXAMPLES } from '../../src/examples'
import { LambdaPane } from '../../src/lambda-pane'
import { Tree } from '../../src/lambda-tree'
import {
  FRAME_BYTES,
  HISTORY_BYTES,
  LAMBDA_TREE_NODES,
  type LambdaTreeWire,
  lambdaFrameBytes,
} from '../../src/protocol'
import type { LambdaState } from '../../src/types'
import { lambdaFrame } from '../node/session-fixtures'
import { wireOf } from '../node/tree-fixture'
import { controlState, fixtureHost } from './harness'

/**
 * WHAT EXPAND ALL COSTS (the expand-all spec's cost check, which states the terms and the clocks). A PROBE, NOT A
 * GATE: `pnpm test:probe:lambda-expand-all`, excluded from the default run by `vite.config.ts`'s `PROBE_FILES`. The
 * figures go to the console; the assertions only say each term was found and drawn.
 */
type Session = {
  stepLambda(): boolean
  lambdaState(byteBudget: number): LambdaState
  lambdaStatus(): { available: boolean }
  lambdaTree(step: number, nodeBudget: number): LambdaTreeWire
  free(): void
}

const REPEATS = 7
const CONTROLS = controlState(false, '0')

function stats(xs: number[]): string {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number) => (s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0).toFixed(1)
  return `median=${at(0.5)}ms max=${at(1)}ms (n=${s.length})`
}

type Found = { step: number; nodes: number; steps: number; over: number; wire: LambdaTreeWire; before: LambdaTreeWire }

/**
 * The largest term in `src`'s recorded λ history that the view draws — one over `LAMBDA_TREE_NODES` is refused and
 * shown as text — with the wires for it and the step before, and the largest of any size as `over`.
 */
function largest(src: string): Found {
  const { session } = compile(src, EXAMPLE_ENCODING) as { session: Session | null }
  if (session === null || !session.lambdaStatus().available) throw new Error('no λ leg')
  let charged = 0
  let step = 0
  let best = { step: 0, nodes: 0 }
  let over = 0
  for (;;) {
    charged += lambdaFrameBytes(session.lambdaState(FRAME_BYTES))
    const nodes = session.lambdaTree(step, 0).refused ?? 0
    over = Math.max(over, nodes)
    if (nodes > best.nodes && nodes <= LAMBDA_TREE_NODES) best = { step, nodes }
    if (charged >= HISTORY_BYTES || !session.stepLambda()) break
    step += 1
  }
  const wire = session.lambdaTree(best.step, LAMBDA_TREE_NODES)
  const before = session.lambdaTree(Math.max(0, best.step - 1), LAMBDA_TREE_NODES)
  session.free()
  return { ...best, steps: step, over, wire, before }
}

/** A seeded term of exactly `target` nodes: abstractions and applications over a few names, never a chip's shape. */
function synthetic(target: number): string {
  let seed = 1
  const rand = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
    return seed / 2 ** 31
  }
  const vars = ['a', 'b', 'c', 'd']
  const gen = (n: number, scope: readonly string[]): string => {
    if (n <= 1) return scope[Math.floor(rand() * scope.length)] ?? 'z'
    if (n === 2 || rand() < 0.3) {
      const v = vars[scope.length % vars.length] as string
      return `(\\${v}. ${gen(n - 1, [...scope, v])})`
    }
    const l = 1 + Math.floor(rand() * (n - 2))
    return `(${gen(l, scope)} ${gen(n - 1 - l, scope)})`
  }
  return gen(target, ['z'])
}

/**
 * A wire built straight from arrays, for the two shapes whose depth would overflow `wireOf`'s recursive parse:
 * `f x … x`, a left spine of `n` arguments, and `a (a (… z))`, a right chain `n` deep. Every variable is free.
 */
function shaped(shape: 'spine' | 'chain', n: number, step: number): LambdaTreeWire {
  const count = 2 * n + 1
  const kind = new Uint8Array(count)
  const left = new Uint32Array(count)
  const right = new Uint32Array(count)
  const name = new Uint32Array(count)
  for (let k = 0; k < n; k += 1) {
    const at = shape === 'spine' ? k : 2 * k
    kind[at] = 2
    left[at] = shape === 'spine' ? k + 1 : at + 1
    right[at] = shape === 'spine' ? 2 * n - k : at + 2
  }
  if (shape === 'spine') for (let k = n + 1; k < count; k += 1) name[k] = 1
  else name[count - 1] = 1
  return {
    step,
    refused: null,
    kind,
    left,
    right,
    name,
    hint: name,
    link: new Uint32Array(count).fill(0xffff_ffff),
    names: shape === 'spine' ? ['f', 'x'] : ['a', 'z'],
    nextRedex: null,
    contractum: null,
  }
}

const host = (): HTMLElement => {
  const el = fixtureHost('lambda-expand-all-cost-fixture')
  el.style.width = '900px'
  return el
}

afterEach(() => {
  for (const el of document.querySelectorAll('.lambda-expand-all-cost-fixture')) el.remove()
  vi.restoreAllMocks()
})

/**
 * Both clocks end in a forced layout, so the style and layout the change causes are inside them. `turn on` runs
 * from a capturing click listener to one after the item's own: the handler and the redraw, without `userEvent`'s
 * round trip. `step` is a `renderTree` from the step before, taken with the mode off too, the cost already paid.
 */
async function measure(name: string, before: LambdaTreeWire, wire: LambdaTreeWire): Promise<void> {
  const el = host()
  const pane = new LambdaPane(el, {
    back: vi.fn(),
    forward: vi.fn(),
    toNewest: vi.fn(),
    play: vi.fn(),
    restart: vi.fn(),
    extend: vi.fn(),
    speed: () => 8,
    setSpeed: vi.fn(),
    rebind: vi.fn(),
    display: vi.fn(),
  })
  pane.render(lambdaFrame('λx. x'), CONTROLS)
  const layout = () => void el.querySelector('.term')?.getBoundingClientRect()
  const spacer = () => el.querySelector('.term-spacer')?.getBoundingClientRect().height ?? 0
  // A NEW WIRE OBJECT EACH TIME, so the pane builds a new `Tree` and lays it out from nothing, as a step does.
  const step = (): number => {
    pane.renderTree({ kind: 'tree', tree: { ...before } })
    layout()
    const t0 = performance.now()
    pane.renderTree({ kind: 'tree', tree: { ...wire } })
    layout()
    return performance.now() - t0
  }
  const off: number[] = []
  for (let i = 0; i < REPEATS; i += 1) off.push(step())
  const offHeight = spacer()

  const expand = el.querySelector<HTMLButtonElement>('button.expand-all') as HTMLButtonElement
  await userEvent.click(el.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement)
  const click = async (): Promise<number> => {
    let t0 = 0
    let t1 = 0
    const start = () => {
      t0 = performance.now()
    }
    const end = () => {
      layout()
      t1 = performance.now()
    }
    document.addEventListener('click', start, { capture: true, once: true })
    document.addEventListener('click', end, { once: true })
    await userEvent.click(expand)
    return t1 - t0
  }
  const ons: number[] = []
  const offs: number[] = []
  for (let i = 0; i < REPEATS; i += 1) {
    // A NEW `Tree` BEFORE EACH TURN-ON, with no path cached: on the tree a sample before had turned it on, a
    // turn-on would reuse what that one built, and be quicker than a user's first turn-on on the step in view.
    pane.renderTree({ kind: 'tree', tree: { ...wire } })
    layout()
    ons.push(await click())
    expect(expand.getAttribute('aria-checked')).toBe('true')
    offs.push(await click())
  }
  expect(expand.getAttribute('aria-checked')).toBe('false')
  await userEvent.click(expand)
  expect(expand.getAttribute('aria-checked')).toBe('true')
  await userEvent.keyboard('{Escape}')
  const on: number[] = []
  for (let i = 0; i < REPEATS; i += 1) on.push(step())
  const onHeight = spacer()
  const tree = new Tree(wire)
  console.error(
    `lambda-expand-all-cost ${name}: ${tree.count} nodes; layout height ${offHeight}px off, ${onHeight}px on; ` +
      `turn on ${stats(ons)}; turn off ${stats(offs)}; step off ${stats(off)}; step on ${stats(on)}`,
  )
  expect(onHeight).toBeGreaterThanOrEqual(offHeight)
}

describe('the cost of expand all', () => {
  it('on the largest λ term an example records', async () => {
    await init()
    let top: (Found & { id: string }) | null = null
    for (const ex of EXAMPLES) {
      const t0 = performance.now()
      const found = largest(ex.text)
      console.error(
        `lambda-expand-all-cost scan ${ex.id}: ${found.steps} steps, largest drawn ${found.nodes} nodes at step ` +
          `${found.step}, largest of any size ${found.over} (${(performance.now() - t0).toFixed(0)}ms)`,
      )
      if (top === null || found.nodes > top.nodes) top = { ...found, id: ex.id }
    }
    expect(top).not.toBeNull()
    if (top === null) return
    await measure(`${top.id} step ${top.step}`, top.before, top.wire)
  }, 1_200_000)

  it('on synthetic terms of LAMBDA_TREE_NODES - 1 nodes: seeded, a spine and a chain', async () => {
    const src = synthetic(LAMBDA_TREE_NODES - 1)
    const wire = wireOf(src, { step: 2 })
    expect(new Tree(wire).count).toBe(LAMBDA_TREE_NODES - 1)
    await measure('synthetic seeded', wireOf(src, { step: 1 }), wire)
    const half = (LAMBDA_TREE_NODES - 2) / 2
    for (const shape of ['spine', 'chain'] as const) {
      expect(new Tree(shaped(shape, half, 2)).count).toBe(LAMBDA_TREE_NODES - 1)
      await measure(`synthetic ${shape}`, shaped(shape, half, 1), shaped(shape, half, 2))
    }
  }, 600_000)
})
