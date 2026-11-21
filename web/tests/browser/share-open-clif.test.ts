import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { fieldWidths } from '../../../pkg/redextape_wasm.js'
import { DEBOUNCE_MS } from '../../src/compile'
import { EXAMPLES } from '../../src/examples'
import { n } from '../../src/format'
import type { LayoutNode } from '../../src/layout'
import type { Listing } from '../../src/protocol'
import { decodeLink, encodeLink, type Positions, type SharePayload } from '../../src/share-link'
import { MAX_LINK_CONTINUES } from '../../src/share-positions'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { clifChunks, hearSessionWorkers, requestsOf } from './clif-fixture'
import {
  compile,
  host,
  noticeText,
  picker,
  SHELL,
  shareButton,
  shareLinkField,
  shareMenu,
  shareMenuOpen,
  stateIdle,
  stepTextOf,
  until,
} from './harness'

/**
 * **A SHARE LINK OR A STORED WORKSPACE SHOWING A CLIF VIEW OPENS IT AT ITS STEP AND LISTING** (CLIF view design §4
 * *Header*, §6 *The switch*): a link's CLIF position is a step of the run of the listing it names, so the link's first
 * run records that listing and the view lands on the step; a CLIF position and an rxm position past their legs' first
 * fills are continued until both land; the page's own link carries the CLIF view's step and listing; and a stored
 * workspace showing a CLIF view lists and records with no gesture. Heard between the page and its session worker.
 *
 * ONE MOUNT FOR THE LINKS, for the reason `app.test.ts` gives. The stored workspace is a second mount on the store the
 * first wrote, as `clif-switch.test.ts` reloads, and comes last: the first mount still hears `hashchange`.
 */

const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
/** `measure::CORPUS`'s `loop1000000`, which both the rxm and the CLIF leg record until their histories are full. */
const LOOP = 'let mut i = 0; let mut acc = 0; while i < 1000000 { acc = acc + i; i = i + 1; } acc'

/** The source beside an rxm view over a CLIF view. */
const TREE: LayoutNode = {
  kind: 'split',
  dir: 'row',
  sizes: [0.5, 0.5],
  children: [
    { kind: 'leaf', id: 'source', pane: 'source' },
    {
      kind: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [
        { kind: 'leaf', id: 'rxm-0', pane: 'rxm' },
        { kind: 'leaf', id: 'clif-0', pane: 'clif' },
      ],
    },
  ],
}

/** A link to `program` in `TREE`, with `positions`, run in `listing`. */
const linkTo = (program: string, positions: Positions, listing: Listing = 'as-built'): SharePayload => ({
  program,
  encoding: 'binary',
  workspace: serializeWorkspace({ ...defaultWorkspace('wide'), tree: TREE, focused: 'source' }),
  positions,
  ...(listing === 'optimised' ? { listing } : {}),
})

let ear: ReturnType<typeof hearSessionWorkers>
let view: EditorView

/**
 * Mount the app, its first compile settled. **A REMOUNT IS A FRESH `main` ON THE SAME STORE**: a query string gives a
 * new module instance, and `localStorage` is left as the first instance wrote it.
 */
let mounts = 0
async function mount(): Promise<EditorView> {
  const spec = mounts === 0 ? '../../src/main' : `../../src/main?remount=${mounts}`
  mounts += 1
  document.body.innerHTML = SHELL
  const ready: EditorView = await (await import(/* @vite-ignore */ spec)).ready
  await until(stateIdle, 'the first compile')
  return ready
}

/** Paste `link` into the open page, a `hashchange`, and wait until the open is said. */
async function open(link: SharePayload): Promise<void> {
  location.hash = await encodeLink(link)
  await until(() => location.hash === '' && noticeText() === 'opened a shared link', 'the open')
}

/**
 * Keep the compile's debounce from firing until the returned function is called, which fires what was kept and says
 * how many timers that was. **THE WINDOW IS HELD OPEN, NOT RACED**: a click's round trip can outlast `DEBOUNCE_MS` on a
 * machine short of CPU, and a choice made after the run was posted would pass whatever became of the link's step. A
 * timer is kept by its delay, all a timer says of itself, so any other of that delay set meanwhile waits with it, and
 * **A HOLD THAT KEPT NONE HELD NOTHING**: the caller asserts the count, since the case would otherwise race unseen.
 */
function holdDebounce(): () => number {
  const set = window.setTimeout
  const kept: (() => void)[] = []
  window.setTimeout = ((handler: () => void, ms?: number) => {
    if (ms !== DEBOUNCE_MS) return set(handler, ms)
    kept.push(handler)
    return 0
  }) as typeof window.setTimeout
  return () => {
    window.setTimeout = set
    for (const fire of kept) fire()
    return kept.length
  }
}

beforeAll(async () => {
  ear = hearSessionWorkers()
  await page.viewport(1280, 1600)
  const fragment = await encodeLink(linkTo(FACT, { clif: 95 }, 'optimised'))
  history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
  view = await mount()
}, 30_000)

afterAll(() => ear.restore())

const clif = () => host('clif-0') as HTMLElement
/** `pane`'s choice of `listing` on its bar. */
const choice = (pane: HTMLElement, listing: Listing) =>
  pane.querySelector<HTMLButtonElement>(`.view-actions [role="radiogroup"] button[data-value="${listing}"]`)
const checked = (pane: HTMLElement, listing: Listing) => choice(pane, listing)?.getAttribute('aria-checked')
/** The CLIF listing's row about to run, once it is drawn. */
const nextRow = () => clif().querySelector<HTMLElement>('.clif-row.is-next')
/** The newest step `leaf`'s step line names, its `of …`. */
const newestOf = (leaf: string) => Number(/ of ([\d,]+)/.exec(stepTextOf(leaf))?.[1]?.replaceAll(',', '') ?? Number.NaN)
/** Whether `leaf`'s step line shows `step`. */
const shows = (leaf: string, step: number) => stepTextOf(leaf).startsWith(`step ${n(step)} of `)
/** The `extend`s of `leg` posted since `mark`, an index into what was heard: a link's continues. */
const continues = (mark: number, leg: string) =>
  requestsOf(ear.heard.slice(mark), 'extend').filter((r) => r.leg === leg).length

/**
 * Each `extend` posted since `mark` while a continue of the link's run was still recording, from its `extend` to the
 * frames that say how it stopped, named with the leg recording then.
 */
function overlapping(mark: number): string[] {
  const heard = ear.heard.slice(mark)
  const gen = requestsOf(heard, 'run')[0]?.gen
  const found: string[] = []
  let recording: string | null = null
  for (const h of heard) {
    if ('request' in h && h.request.kind === 'extend' && h.request.gen === gen) {
      if (recording !== null) found.push(`${h.request.leg} while ${recording} records`)
      recording = h.request.leg
    } else if ('reply' in h && h.reply.kind === 'frames' && h.reply.gen === gen && h.reply.leg === recording) {
      if (h.reply.done !== null) recording = null
    }
  }
  return found
}

describe('a CLIF view in a link or a stored workspace', () => {
  it('opens a link on a CLIF view at its step and listing', async () => {
    expect(view.state.doc.toString(), "precondition: the link's program").toBe(FACT)
    expect(requestsOf(ear.heard, 'run')[0]?.clif, 'the listing the first run carries').toBe('optimised')
    await until(() => shows('clif-0', 95), 'the CLIF view to land on step 95')
    expect(checked(clif(), 'optimised')).toBe('true')
    expect(checked(clif(), 'as-built')).toBe('false')
  })

  /**
   * **A LISTING CHOSEN BEFORE THE LINK'S RUN IS POSTED IS THE ONE THAT RUN RECORDS**, and the link's CLIF step is a
   * step of the run of the listing the link names, so it goes with the choice: the view opens on step 0, where a
   * choice of a listing opens it, and the rxm view still takes its step. The rxm step is read off the run the case
   * before left, and the as-built run's length off this case's own. **THE DEBOUNCE IS HELD UNTIL THE LISTING IS
   * CHOSEN** (`holdDebounce`).
   */
  it("a listing chosen before a link's run is posted drops the link's CLIF step and no other", async () => {
    const rxmStep = Math.floor(newestOf('rxm-0') / 2)
    expect(rxmStep, 'precondition: an rxm step past 0').toBeGreaterThan(0)
    const mark = ear.heard.length
    const fire = holdDebounce()
    let held = 0
    try {
      await open(linkTo(FACT, { rxm: rxmStep, clif: 95 }, 'optimised'))
      await userEvent.click(choice(clif(), 'as-built') as HTMLButtonElement)
      expect(requestsOf(ear.heard.slice(mark), 'run'), 'precondition: no run is posted before the choice').toEqual([])
    } finally {
      held = fire()
    }
    expect(held, 'precondition: the debounce was held').toBeGreaterThan(0)
    await until(() => requestsOf(ear.heard.slice(mark), 'run').length > 0, "the link's run")
    const run = requestsOf(ear.heard.slice(mark), 'run')[0]
    expect(run?.clif, 'precondition: the listing was chosen before the run was posted').toBe('as-built')
    const chunks = () => clifChunks(ear.heard.slice(mark), 0).filter((c) => c.gen === run?.gen)
    await until(() => chunks().some((c) => c.done !== null), "the CLIF leg's recording to stop")
    const last =
      chunks()
        .flatMap((c) => c.frames)
        .at(-1)?.step ?? Number.NaN
    expect(last, "precondition: the as-built run goes past the link's step").toBeGreaterThan(95)
    await until(() => shows('rxm-0', rxmStep), 'the rxm view to land on its step')
    await until(() => newestOf('clif-0') === last, 'the CLIF view to draw its whole run')
    expect(stepTextOf('clif-0')).toMatch(/^step 0 of /)
    expect(stepTextOf('clif-0')).not.toContain('from the link')
    expect(checked(clif(), 'as-built')).toBe('true')
  }, 30_000)

  /**
   * **ONE CONTINUE AT A TIME**: none is posted while another records, from its `extend` to the frames that say how it
   * stopped. The CLIF pass is the run's own recording, which starts at the run's `result`, so the rxm continue that
   * `result` asks for records beside it. The fills are read off a first open of the same link, with no positions.
   */
  it('a CLIF position and an rxm position past their first fills both land', async () => {
    await open(linkTo(LOOP, {}))
    await until(() => /history is full/.test(stepTextOf('rxm-0')), "the rxm leg's first fill")
    await until(() => /history is full/.test(stepTextOf('clif-0')), "the CLIF leg's first fill")
    const fill = { rxm: newestOf('rxm-0'), clif: newestOf('clif-0') }
    const mark = ear.heard.length
    await open(linkTo(LOOP, { rxm: fill.rxm + 1000, clif: fill.clif + 1000 }))
    await until(() => shows('rxm-0', fill.rxm + 1000), 'the rxm view to land')
    await until(() => shows('clif-0', fill.clif + 1000), 'the CLIF view to land')
    for (const leg of ['rxm', 'clif']) {
      expect(continues(mark, leg), `precondition: ${leg} was continued`).toBeGreaterThan(0)
      expect(continues(mark, leg), `${leg}'s continues`).toBeLessThanOrEqual(MAX_LINK_CONTINUES)
    }
    expect(overlapping(mark), 'the continues posted while another recorded').toEqual([])
  }, 60_000)

  /**
   * **WITH NO OTHER LEG CONTINUED, NO `result` BUT THE CLIF PASS'S FOLLOWS THE CLIF LEG'S FRAMES**, so this position
   * lands only if that `result` continues it: beside an rxm position, the rxm continue's `result` can continue it
   * instead. The fill is the last step of the stopping chunk of the first open's own run, since the step line still
   * holds the case before's filled history until that run's frames come.
   */
  it("a CLIF position past its first fill lands at the CLIF pass's result", async () => {
    const before = ear.heard.length
    await open(linkTo(LOOP, {}))
    await until(() => requestsOf(ear.heard.slice(before), 'run').length > 0, "the first open's run")
    const gen = requestsOf(ear.heard.slice(before), 'run')[0]?.gen
    const stopped = () => clifChunks(ear.heard.slice(before), 0).find((c) => c.gen === gen && c.done !== null)
    await until(() => stopped() !== undefined, "the CLIF leg's first fill")
    expect(stopped()?.done, 'precondition: the CLIF history filled').toBe('budget')
    const fill = stopped()?.frames.at(-1)?.step ?? Number.NaN
    const mark = ear.heard.length
    await open(linkTo(LOOP, { clif: fill + 1000 }))
    await until(() => shows('clif-0', fill + 1000), 'the CLIF view to land')
    expect(continues(mark, 'rxm'), 'precondition: no other leg continued').toBe(0)
    expect(continues(mark, 'clif'), 'precondition: clif was continued').toBeGreaterThan(0)
    expect(continues(mark, 'clif'), "clif's continues").toBeLessThanOrEqual(MAX_LINK_CONTINUES)
  }, 60_000)

  it('a link made with a CLIF view open carries its step and listing', async () => {
    expect(checked(clif(), 'as-built'), "precondition: the link's listing").toBe('true')
    await userEvent.click(choice(clif(), 'optimised') as HTMLButtonElement)
    await until(() => checked(clif(), 'optimised') === 'true' && newestOf('clif-0') >= 40, 'the optimised listing')
    const forward = clif().querySelector<HTMLButtonElement>('.controls button[aria-label="one step forward"]')
    for (let step = 0; step < 40; step++) await userEvent.click(forward as HTMLButtonElement)
    expect(stepTextOf('clif-0')).toMatch(/^step 40 of /)
    await userEvent.click(shareButton())
    expect(shareMenuOpen()).toBe(true)
    await until(() => shareLinkField().value !== '', 'the link')
    const value = shareLinkField().value
    const opened = await decodeLink(
      value.slice(value.indexOf('#')),
      [...picker().options].map((o) => o.value),
      fieldWidths() as number[],
    )
    shareMenu().hidePopover()
    expect(opened.kind === 'whole' && opened.positions.clif).toBe(40)
    expect(opened.kind === 'whole' && opened.listing).toBe('optimised')
  }, 30_000)

  /**
   * **`fact.rxt` STORED**, which records in a moment, so the CLIF pass that follows the run's `result` is soon reached.
   */
  it('a stored workspace with a CLIF view lists and records at start', async () => {
    await compile(view, FACT)
    const mark = ear.heard.length
    view = await mount()
    expect(requestsOf(ear.heard.slice(mark), 'run')[0]?.clif, 'precondition: the stored listing').toBe('optimised')
    await until(() => nextRow() !== null, 'the CLIF listing to draw the row about to run')
    const row = (nextRow() as HTMLElement).getBoundingClientRect()
    const box = clif().getBoundingClientRect()
    expect(row.height).toBeGreaterThan(0)
    expect(row.top >= box.top && row.bottom <= box.bottom, 'the row about to run inside the view').toBe(true)
    await until(() => /^step 0 of [1-9]/.test(stepTextOf('clif-0')), 'the CLIF view to record')
  }, 30_000)
})
