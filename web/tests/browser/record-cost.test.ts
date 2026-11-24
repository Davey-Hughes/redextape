import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { EXAMPLE_ENCODING, EXAMPLES } from '../../src/examples'
import { LambdaTrees } from '../../src/lambda-trees'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { COPY_LEGS, LEGS } from '../../src/legs'
import type { LinkWiring } from '../../src/link-wiring'
import { PaneCollection } from '../../src/panes'
import {
  type CopyLeg,
  HISTORY_BYTES,
  type Leg,
  type RecordEnd,
  type RunReply,
  type RunRequest,
} from '../../src/protocol'
import type { ProgramResult } from '../../src/readout'
import { createReplies } from '../../src/replies'
import type { SessionId } from '../../src/session-client'
import { type SessionEntry, type SessionLegs, SessionRegistry } from '../../src/sessions'
import type { ClifState, LambdaState, RxmState, TmState } from '../../src/types'
import { legState } from '../node/leg-fixture'
import { fakeClient } from '../node/session-fixtures'
import {
  chooseOption,
  clickWorkspaceItem,
  compile,
  controlIn,
  countOf,
  median,
  mountAt,
  ms,
  paneOrThrow,
  recorded,
  recordingOver,
  results,
  showWideDefault,
  stepLineOf,
  until,
} from './harness'

/**
 * **A PROBE, NOT A GATE** (`vite.config.ts`'s `PROBE_FILES`): what recording through the real `session-worker.ts`
 * costs, what the app's reply handling costs, and what a step costs in the mounted app, so that a change to the record
 * loops, the replies or the per-step draw is timed against its base. Run by `pnpm run test:probe:record`.
 *
 * **EACH LINE'S TAG IS ITS CLASS**: a timing prints as `RUN`, the median and spread of `RUNS` samples; a value that
 * must not vary prints as `FIXED`, pinned here and asserted equal to its pin in every sample, so that a broken or
 * drifted run fails rather than prints. A `RUN` under 100 ms at the median is followed by a `SHORT` line.
 */

const RUNS = 5
/** Bounded so that a run that never ends is named here rather than by vitest's timeout. */
const RUN_MS = 120_000
const CASE_MS = 1_800_000

const textOf = (id: string): string => {
  const text = EXAMPLES.find((x) => x.id === id)?.text
  if (text === undefined) throw new Error(`no example ${id}`)
  return text
}
const FACT_12 = textOf('fact-12')

/**
 * **`sum_to(2750)`: THE RXM LEG'S HISTORY FILLS BEFORE ITS LOOP ENDS**, so (b) times a whole rxm recording where
 * (a)'s rxm leg ends after a few frames. A bound much lower lets the rxm leg end; one much higher makes the λ leg
 * refuse on depth, so it records one frame rather than its budget. Its outcomes below fail if either moves past it.
 */
const SUM_TO_N = 2750
const SUM_TO = textOf('sum-to').replace('sum_to(5)', `sum_to(${SUM_TO_N})`)
if (!SUM_TO.endsWith(`sum_to(${SUM_TO_N})\n`)) throw new Error('sum-to.rxt no longer ends on sum_to(5)')

type Compiled = Extract<RunReply, { kind: 'compiled' }>
type LegHeard = { ms: number; frames: number; replies: number; done: RecordEnd | null }
type Heard = {
  readonly compiledMs: number
  readonly compiled: Compiled
  readonly legs: Partial<Record<Leg, LegHeard>>
  readonly resultMs: number | null
}

/** What one leg of a case sends and how it stops, pinned, so that a drift on either side of a comparison fails there. */
type LegPin = { readonly frames: number; readonly replies: number; readonly done: RecordEnd }
/**
 * fact-12's three legs, as (a) records them and as (h) replays them: the legs a compile records at once, since CLIF
 * records only while a CLIF view is shown.
 */
const FACT_12_LEGS: Readonly<Record<CopyLeg, LegPin>> = {
  lambda: { frames: 1_407, replies: 6, done: 'budget' },
  rxm: { frames: 182, replies: 1, done: 'ended' },
  tm: { frames: 75_851, replies: 297, done: 'budget' },
}

/** A leg as heard, in `LegPin`'s shape, so that it compares with its pin whole. */
const heardOf = (h: Heard, leg: Leg) => {
  const l = h.legs[leg]
  return l === undefined ? undefined : { frames: l.frames, replies: l.replies, done: l.done }
}

/**
 * One run of `request` in a fresh worker, timed from its posting to `last`: the `result`, or that leg's frames reply
 * with a `done`. **A SMALL RUN GOES FIRST, UNTIMED**, so that the worker's load of the wasm is not in any figure.
 * `kept`, where given, takes every reply to `request`, in the order it came.
 */
function record(name: string, request: RunRequest, last: Leg | 'result', kept?: RunReply[]): Promise<Heard> {
  const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
  const legs: Partial<Record<Leg, LegHeard>> = {}
  let [t0, compiledMs, warming] = [0, Number.NaN, true]
  let compiled: Compiled | null = null
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error(`${name}: no end after ${RUN_MS} ms`))
    }, RUN_MS)
    const end = (settle: () => void): void => {
      clearTimeout(timer)
      worker.terminate()
      settle()
    }
    const heard = (resultMs: number | null): void => {
      const c = compiled
      end(() =>
        c === null
          ? reject(new Error(`${name}: an end with no compiled`))
          : resolve({ compiledMs, compiled: c, legs, resultMs }),
      )
    }
    worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
      const now = performance.now()
      const r = e.data
      if (!warming) kept?.push(r)
      if (r.kind === 'no-session' || r.kind === 'worker-error') {
        end(() => reject(new Error(`${name}: ${r.kind}: ${JSON.stringify(r).slice(0, 400)}`)))
      } else if (warming) {
        if (r.kind !== 'result') return
        warming = false
        t0 = performance.now()
        worker.postMessage(request)
      } else if (r.kind === 'compiled') {
        compiledMs = now - t0
        compiled = r
        // COUNTED WITH THE LEG'S CHUNKS, which record on from step 1, so that a leg's frames are its whole recording,
        // which is what (h)'s rings hold.
        for (const leg of LEGS.filter((l) => r.first[l] !== null)) {
          const l = legs[leg] ?? { ms: Number.NaN, frames: 0, replies: 0, done: null }
          legs[leg] = l
          l.frames += 1
        }
      } else if (r.kind === 'frames') {
        const leg = r.leg
        const l = legs[leg] ?? { ms: Number.NaN, frames: 0, replies: 0, done: null }
        legs[leg] = l
        l.frames += r.frames.length
        l.replies += 1
        if (r.done === null) return
        l.done = r.done
        l.ms = now - t0
        if (last === leg) heard(null)
      } else if (r.kind === 'result' && last === 'result') heard(now - t0)
    })
    worker.addEventListener('error', (e) => {
      e.preventDefault()
      const what = e instanceof ErrorEvent && e.message !== '' ? e.message : 'the worker did not load'
      end(() => reject(new Error(`${name}: ${what}`)))
    })
    worker.postMessage({ kind: 'run', gen: 1, src: '40 + 2', encoding: EXAMPLE_ENCODING, clif: null })
  })
}

/** A timing's line: its median and spread over the samples, tagged `RUN`. */
function figure(name: string, format: (x: number) => string, xs: number[]): string {
  const [mid, lo, hi] = [median(xs), Math.min(...xs), Math.max(...xs)]
  return `RUN  ${name}: median=${format(mid)} spread=${format(lo)}-${format(hi).trim()}`
}
/** A timing in ms, which says so where its median is too short to compare. */
const timed = (name: string, xs: number[]): string =>
  figure(name, ms, xs) + (median(xs) < 100 ? `\nSHORT ${name}: median under 100 ms` : '')
/** A value that must not vary, printed once: its callers assert it equal to its pin in every sample first. */
const fixed = (name: string, value: number | string): string => `FIXED ${name}: ${value}`
/** A leg's pinned counts and stop, as `fixed` lines. */
const fixedLeg = (name: string, pin: LegPin): string[] => [
  fixed(`${name} frames`, pin.frames),
  fixed(`${name} replies`, pin.replies),
  fixed(`${name} done`, pin.done),
]

type Case = {
  readonly id: string
  readonly request: () => Promise<RunRequest>
  readonly last: Leg | 'result'
  /** What each leg the case records sends and how it stops; a leg not named here must record nothing. */
  readonly legs: Partial<Record<Leg, LegPin>>
}

async function measure(c: Case): Promise<void> {
  const runs: Heard[] = []
  for (let r = 0; r < RUNS; r++) runs.push(await record(c.id, await c.request(), c.last))
  const legs = Object.keys(c.legs) as Leg[]
  for (const h of runs) {
    expect(Object.keys(h.legs).sort(), `${c.id}: the legs that recorded`).toEqual([...legs].sort())
    for (const leg of legs) expect(heardOf(h, leg), `${c.id}: ${leg}`).toEqual(c.legs[leg])
  }
  const rows = [
    timed(
      `${c.id} compiled ms`,
      runs.map((h) => h.compiledMs),
    ),
  ]
  for (const leg of legs)
    rows.push(
      timed(
        `${c.id} ${leg} done ms`,
        runs.map((h) => h.legs[leg]?.ms ?? Number.NaN),
      ),
      ...fixedLeg(`${c.id} ${leg}`, c.legs[leg] as LegPin),
    )
  if (c.last === 'result')
    rows.push(
      timed(
        `${c.id} result ms`,
        runs.map((h) => h.resultMs ?? Number.NaN),
      ),
    )
  console.error(`\n${rows.join('\n')}\n`)
}

const run = (src: string) => async (): Promise<RunRequest> => ({
  kind: 'run',
  gen: 2,
  src,
  encoding: EXAMPLE_ENCODING,
  clif: null,
})

const WORKER_CASES: readonly Case[] = [
  { id: '(a) fact-12', request: run(FACT_12), last: 'result', legs: FACT_12_LEGS },
  {
    id: `(b) sum_to(${SUM_TO_N})`,
    request: run(SUM_TO),
    last: 'result',
    legs: {
      lambda: { frames: 1_265, replies: 5, done: 'budget' },
      rxm: { frames: 36_922, replies: 145, done: 'budget' },
      tm: { frames: 74_803, replies: 293, done: 'budget' },
    },
  },
]

describe('recording through the session worker', () => {
  for (const c of WORKER_CASES) it(c.id, () => measure(c), CASE_MS)
})

const SOURCE: SessionId = 'source'
/** How many replays of the capture make one (h) sample: enough that each sample is a timed loop of at least 100 ms. */
const REPLAYS = 200

/**
 * One replay of `capture` through a fresh `onReply`, timed, then checked: each leg's ring holds the frames the capture
 * carried, and the `compiled` and `result` arms ran. A source session with a ring per leg and no view on the page;
 * the stand-ins are `replies.test.ts`' driver's, so `draw` does nothing and a frame runs at once.
 */
function replay(capture: readonly RunReply[]): number {
  const entry: SessionEntry = {
    id: SOURCE,
    label: 'program',
    client: fakeClient(),
    legs: {
      lambda: legState<LambdaState>(false, HISTORY_BYTES),
      rxm: legState<RxmState>(false, HISTORY_BYTES),
      tm: legState<TmState>(false, HISTORY_BYTES),
      clif: legState<ClifState>(false, HISTORY_BYTES),
    } satisfies Required<SessionLegs>,
    programs: { rxm: null, tm: null, clif: null },
  }
  const sessions = new SessionRegistry()
  sessions.add(entry)
  const said: { program: ProgramResult | null; dispatched: number } = { program: null, dispatched: 0 }
  const view = {
    dispatch: () => {
      said.dispatched += 1
    },
  } as unknown as EditorView
  const shown = document.createElement('section')
  const { onReply } = createReplies({
    sessions,
    results: shown,
    view: () => view,
    panes: new PaneCollection(),
    links: { setIndex: () => undefined } as unknown as LinkWiring,
    trees: new LambdaTrees(() => ({ gen: 0, awaitingRun: false, tree: () => undefined })),
    draw: () => undefined,
    frame: (cb) => cb(),
    setProgram: (r) => {
      said.program = r
    },
  })
  const t0 = performance.now()
  for (const r of capture) onReply(SOURCE, r)
  const t = performance.now() - t0
  for (const leg of COPY_LEGS) {
    const l = entry.legs[leg]
    expect({ frames: l?.hist.length, done: l?.done }, `(h): ${leg}'s ring`).toEqual({
      frames: FACT_12_LEGS[leg].frames,
      done: FACT_12_LEGS[leg].done,
    })
  }
  expect(said.dispatched, "(h): the compiled arm's dispatch").toBe(1)
  expect([entry.programs.tm === null, entry.programs.rxm === null], '(h): the machines kept').toEqual([false, false])
  expect([said.program?.kind, shown.dataset.state], '(h): the result arm').toEqual(['result', 'idle'])
  return t
}

/**
 * **(h) THE APP'S REPLY HANDLING, OVER THE REPLIES OF ONE REAL RUN**: fact-12's, as (a) records it, captured once in an
 * untimed run and handed to `onReply` in the order they came. It times what the page does with each reply, the frames
 * pushed and charged and the `compiled` and `result` arms, apart from the worker that sends them, which (a) times.
 */
describe("the app's reply handling", () => {
  it(
    "(h) replays fact-12's replies through onReply",
    async () => {
      const id = "(h) fact-12's replies"
      const capture: RunReply[] = []
      const heard = await record(`${id}: the capture`, await run(FACT_12)(), 'result', capture)
      for (const leg of COPY_LEGS) expect(heardOf(heard, leg), `${id}: ${leg}`).toEqual(FACT_12_LEGS[leg])
      const kinds: Record<string, number> = {}
      for (const r of capture) {
        const kind = r.kind === 'frames' ? `${r.leg} frames` : r.kind
        kinds[kind] = (kinds[kind] ?? 0) + 1
      }
      expect(kinds, `${id}: the capture`).toEqual({
        compiled: 1,
        'lambda frames': FACT_12_LEGS.lambda.replies,
        'rxm frames': FACT_12_LEGS.rxm.replies,
        'tm frames': FACT_12_LEGS.tm.replies,
        result: 1,
      })
      const samples: number[] = []
      for (let r = 0; r < RUNS; r++) {
        let t = 0
        for (let i = 0; i < REPLAYS; i++) t += replay(capture)
        samples.push(t)
      }
      const rows = [
        timed(`${id} replay ms`, samples),
        fixed(`${id} replays a sample`, REPLAYS),
        fixed(`${id} replies`, capture.length),
        ...COPY_LEGS.map((leg) => fixed(`${id} ${leg} frames`, FACT_12_LEGS[leg].frames)),
      ]
      console.error(`\n${rows.join('\n')}\n`)
    },
    CASE_MS,
  )
})

/** A walk's cap on its steps, and the readouts it walks by. */
const K_CAP = 300
const MODES = ['strip', 'inspector'] as const
type Mode = (typeof MODES)[number]
/** Per step to a microsecond, where `ms` would round a step's cost to a tenth of a millisecond. */
const perStep = (x: number): string => x.toFixed(3).padStart(7)
const stepOf = (line: string): number => countOf(/^step ([\d,]+) of /.exec(line)?.[1] ?? 'NaN')

/** A view's newest step and its walk's K, pinned: K is the newest step, at most `K_CAP`. */
type WalkPin = { readonly newest: number; readonly k: number }
/** Each view's walk over fact-12. */
const WALKS: Readonly<Record<CopyLeg, WalkPin>> = {
  lambda: { newest: 1_406, k: 300 },
  tm: { newest: 75_850, k: 300 },
  rxm: { newest: 181, k: 181 },
}

/**
 * **THE READOUT IS THE ONE THE WALK NAMES, CHECKED BEFORE IT IS TIMED**: `clickWorkspaceItem` does nothing where its
 * switch is missing, and a walk over the wrong readout would time it without a sign.
 */
function expectReadout(leaf: string, mode: Mode): void {
  const [want, other] = mode === 'inspector' ? ['row', 'segment'] : ['segment', 'row']
  const shown = results()
  expect(shown.querySelectorAll(`:scope > .${want}`).length, `${leaf}: the ${mode}'s lines`).toBeGreaterThan(0)
  expect(shown.querySelectorAll(`:scope > .${other}`).length, `${leaf}: lines not the ${mode}'s`).toBe(0)
  expect(shown.dataset.describes, `${leaf}: what the readout describes`).toBe('program')
}

type Walk = { readonly newest: number; readonly k: number; readonly ms: number }

/**
 * **K SYNCHRONOUS `.click()`S ON THE VIEW'S ▶, FROM STEP 0**, each a `forward` and a `draw()`, timed together. A
 * synthetic click is right here: it times the handler and the draw, and no gesture is under test. The readout must
 * name step K after. **↺ GOES BEFORE THE FOCUS**: at the newest step of a recording that ended, ▶ is off, and a button
 * that is off takes no focus.
 */
function walk(leaf: string, mode: Mode, pin: WalkPin): Walk {
  const pane = paneOrThrow(leaf)
  const [forward, restart] = [controlIn(pane, '▶'), controlIn(pane, '↺')]
  if (forward === undefined || restart === undefined) throw new Error(`${leaf} has no ▶ or ↺`)
  const newest = recorded(stepLineOf(leaf))
  const k = Math.min(newest, K_CAP)
  expect({ newest, k }, `${leaf}: its newest step and K`).toEqual(pin)
  restart.click()
  expect(stepOf(stepLineOf(leaf)), `${leaf}: the walk's start`).toBe(0)
  forward.focus()
  expect(document.activeElement === forward, `${leaf}: the focus on its ▶`).toBe(true)
  expectReadout(leaf, mode)
  const t0 = performance.now()
  for (let i = 0; i < k; i++) forward.click()
  const t = performance.now() - t0
  expect(stepOf(stepLineOf(leaf)), `${leaf}: the step after ${k} presses of ▶`).toBe(k)
  return { newest, k, ms: t }
}

/**
 * **ONE MOUNT FOR THE FILE, AND EACH RUN ON A FRESH COMPILE**: `main()` runs once, at its module's import, so the
 * app cannot be mounted again on this page. Each run compiles another program and then fact-12, so that every leg
 * records from nothing again.
 */
describe('stepping in the mounted app', () => {
  let view: EditorView
  const views = { lambda: 'lambda-0', tm: 'tm-0', rxm: 'rxm-0' } as const

  beforeAll(async () => {
    localStorage.removeItem(LAYOUT_STORAGE_KEY)
    await mountAt(1280, 896)
    view = await (await import('../../src/main')).ready
    await showWideDefault()
    chooseOption('#encoding', EXAMPLE_ENCODING)
  }, CASE_MS)

  const fresh = async (): Promise<void> => {
    await compile(view, '40 + 2')
    await compile(view, FACT_12)
    for (const leaf of Object.values(views))
      await until(() => recordingOver(stepLineOf(leaf)), `${leaf} to record: ${stepLineOf(leaf)}`, RUN_MS)
  }

  /** `RUNS` runs of `body`, each giving a walk per name, printed as figures. */
  const steps = async (id: string, body: () => Promise<Record<string, Walk>>): Promise<void> => {
    const walks: Record<string, Walk>[] = []
    for (let r = 0; r < RUNS; r++) walks.push(await body())
    const rows: string[] = []
    for (const name of Object.keys(walks[0] ?? {})) {
      const of = walks.map((w) => w[name] as Walk)
      rows.push(
        figure(
          `${id} ${name} ms per step`,
          perStep,
          of.map((w) => w.ms / w.k),
        ),
        timed(
          `${id} ${name} walk ms`,
          of.map((w) => w.ms),
        ),
        fixed(`${id} ${name} newest step`, of[0]?.newest ?? Number.NaN),
        fixed(`${id} ${name} steps`, of[0]?.k ?? Number.NaN),
      )
    }
    console.error(`\n${rows.join('\n')}\n`)
  }

  it(
    '(e) steps the program, in each view and each readout',
    async () => {
      await steps('(e) program', async () => {
        await fresh()
        const out: Record<string, Walk> = {}
        for (const mode of MODES) {
          clickWorkspaceItem(`[data-switch="readout"][data-value="${mode}"]`)
          for (const leg of ['lambda', 'tm', 'rxm'] as const) out[`${leg} ${mode}`] = walk(views[leg], mode, WALKS[leg])
        }
        clickWorkspaceItem('[data-switch="readout"][data-value="strip"]')
        return out
      })
    },
    CASE_MS,
  )
})
