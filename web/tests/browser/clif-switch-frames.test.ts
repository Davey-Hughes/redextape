import type { EditorView } from '@codemirror/view'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { n } from '../../src/format'
import type { LayoutNode } from '../../src/layout'
import type { Listing } from '../../src/protocol'
import { encodeLink, type Positions, type SharePayload } from '../../src/share-link'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { clifChunks, clifStopped, hearSessionWorkers, repliesOf, requestsOf } from './clif-fixture'
import {
  everyFrame,
  frames,
  host,
  noticeText,
  PREFIX,
  resultsText,
  SHELL,
  stateIdle,
  stepTextOf,
  until,
} from './harness'

/**
 * **A LISTING SWITCH CHANGES THE CLIF VIEW IN ONE FRAME** (CLIF view design §6, *The switch*): from the press until the
 * new listing's recording has stopped, every frame shows the listing the press left exactly as it was, or the new
 * listing at its step 0 as it settles, and never the first again once the second has appeared. Each frame is read as
 * the user reads it: which listing the rows are, the row at the top of the listing and where it stands, the scroll, the
 * row about to run, the panels, whether a notice shows, and where the view stands on the page.
 */

const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
/** `measure::CORPUS`'s `loop1000000`, whose CLIF leg records chunk after chunk until its history is full. */
const LOOP = 'let mut i = 0; let mut acc = 0; while i < 1000000 { acc = acc + i; i = i + 1; } acc'

let ear: ReturnType<typeof hearSessionWorkers>
let view: EditorView

beforeAll(async () => {
  ear = hearSessionWorkers()
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
  await program(FACT)
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a CLIF view')
  await until(() => requestsOf(ear.heard, 'clif').length > 0, 'the clif request the view posts')
  const shown = requestsOf(ear.heard, 'clif')[0]?.epoch ?? -1
  await until(() => clifStopped(ear.heard, shown), "the CLIF leg's first recording")
}, 30_000)

afterAll(() => ear.restore())
/** A case that fails while it keeps the worker's replies would leave the next one waiting on them. */
afterEach(() => ear.release())

const clif = () => host('clif-0') as HTMLElement
const choice = (listing: Listing) =>
  clif().querySelector<HTMLButtonElement>(`.view-actions [role="radiogroup"] button[data-value="${listing}"]`)

/** Put `text` in the editor and wait for its compile. */
async function program(text: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  await until(() => !stateIdle(), 'the compile to start')
  await until(stateIdle, 'the compile to finish')
}

/** The text of `pane`'s `selector`, its white space collapsed. */
const textIn = (pane: HTMLElement, selector: string) =>
  (pane.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim()

/**
 * What `pane` shows, as one string per fact. **THE STEP LINE GIVES ITS STEP ALONE**: its count grows as frames come,
 * which is the run going on, not the view changing. `placed` adds where the view stands on the page, and `line` the
 * whole step line.
 */
function seen(pane: HTMLElement, placed: boolean, line = false): Record<string, string> {
  const box = pane.querySelector<HTMLElement>('.clif-listing')
  const top = box?.getBoundingClientRect().top ?? 0
  const rows = [...pane.querySelectorAll<HTMLElement>('.clif-row')]
  const first = rows
    .filter((r) => r.getBoundingClientRect().bottom > top + 1)
    .sort((a, b) => Number(a.getAttribute('aria-rowindex')) - Number(b.getAttribute('aria-rowindex')))[0]
  const firstAt = first === undefined ? 0 : Math.round(first.getBoundingClientRect().top - top)
  const next = pane.querySelector<HTMLElement>('.clif-row.is-next')
  const notice = pane.querySelector<HTMLElement>('.clif-notice')
  const shown = notice !== null && getComputedStyle(notice).display !== 'none' && notice.getClientRects().length > 0
  const at = pane.getBoundingClientRect()
  return {
    rows: box?.getAttribute('aria-rowcount') ?? 'none',
    first:
      first === undefined
        ? 'none'
        : `${first.getAttribute('aria-rowindex')} at ${firstAt}: ${textIn(first, '.clif-cell')}`,
    scroll: String(box?.scrollTop ?? 'none'),
    next: next === null ? 'none' : `${next.getAttribute('aria-rowindex')}: ${textIn(next, '.clif-cell')}`,
    notice: shown ? (notice?.textContent ?? '') : 'none',
    step: /^step [\d,]+/.exec(textIn(pane, '.step'))?.[0] ?? textIn(pane, '.step'),
    panels: ['values', 'stack', 'heap'].map((p) => textIn(pane, `[data-panel="${p}"]`)).join(' | '),
    ...(placed
      ? { placed: `${Math.round(at.top)} ${Math.round(at.height)} ${Math.round(box?.clientHeight ?? 0)}` }
      : {}),
    ...(line ? { line: textIn(pane, '.step') } : {}),
  }
}

/**
 * What each frame of `seen` showed, in order, a run of the same once: `the listing left` for a frame exactly as
 * `before`, `the listing chosen` for one as `after`, else the frame itself. **WITH THE WHOLE STEP LINE READ, A FRAME
 * IS THE LISTING CHOSEN FROM ITS ROWS, ITS NEXT ROW, ITS PANELS AND NO NOTICE**: the line's count grows as the new
 * listing records, and in a narrow view its wrap changes with it and moves the rows within the box, as in every
 * recording; the frames before the swap are held to every fact.
 */
function runsOf(
  seen: readonly Record<string, string>[],
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  const chosen = (s: Record<string, string>) =>
    'line' in after
      ? s.rows === after.rows && s.next === after.next && s.panels === after.panels && s.notice === 'none'
      : JSON.stringify(s) === JSON.stringify(after)
  const label = (s: Record<string, string>) =>
    JSON.stringify(s) === JSON.stringify(before)
      ? 'the listing left'
      : chosen(s)
        ? 'the listing chosen'
        : JSON.stringify(s)
  return seen.map(label).filter((s, i, all) => s !== all[i - 1])
}

/**
 * Press `to` and read the CLIF view in every frame until the new listing's recording has stopped, then assert that the
 * frames run from what it showed at the press to what it shows at the end, with nothing between. `placed` says
 * whether where the view stands on the page is read too, and `line` whether the whole step line is. **`hold` KEEPS
 * THE WORKER'S REPLIES FROM THE PAGE FROM BEFORE THE PRESS** (`hearSessionWorkers`' `hold`) for a few frames after the
 * request it posts, so the press lands in a state a reply would otherwise end, and the frames it draws are read.
 */
async function switchTo(
  to: Listing,
  placed: boolean,
  opts: { readonly line?: boolean; readonly hold?: boolean } = {},
): Promise<{ readonly epoch: number; readonly pressed: number; readonly before: Record<string, string> }> {
  const pane = clif()
  const line = opts.line === true
  if (opts.hold === true) ear.hold()
  const watch = everyFrame(() => (host('clif-0') === pane ? seen(pane, placed, line) : { remounted: 'the CLIF view' }))
  await frames()
  const before = seen(pane, placed, line)
  const pressed = ear.heard.length
  await userEvent.click(choice(to) as HTMLButtonElement)
  await until(() => requestsOf(ear.heard.slice(pressed), 'clif').length > 0, 'the clif request the press posts')
  const asked = requestsOf(ear.heard.slice(pressed), 'clif')[0]
  expect(asked?.listing, 'precondition: the press asked for the other listing').toBe(to)
  const epoch = asked?.epoch ?? -1
  if (opts.hold === true) {
    for (let i = 0; i < 3; i++) await frames()
    await ear.release()
  }
  await until(() => clifStopped(ear.heard.slice(pressed), epoch), "the new listing's recording")
  await frames()
  await frames()
  watch.stop()
  const after = seen(pane, placed, line)
  expect(after.rows, 'precondition: the switch changed the listing').not.toBe(before.rows)
  expect(after.next, "precondition: the new listing's step 0 is drawn").not.toBe('none')
  expect(watch.seen.length, 'precondition: a frame was read for every frame drawn').toBeGreaterThanOrEqual(
    watch.ticks() - 1,
  )
  expect(watch.seen.length, 'precondition: frames were read through the switch').toBeGreaterThan(4)
  expect(runsOf(watch.seen, before, after), 'what each frame showed, in order, a run of the same once').toEqual([
    'the listing left',
    'the listing chosen',
  ])
  return { epoch, pressed, before }
}

/** The source beside an rxm view over a CLIF view, narrow enough that a long step line wraps. */
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

/** Paste `link` into the open page, a `hashchange`, and wait until the open is said. */
async function open(link: SharePayload): Promise<void> {
  location.hash = await encodeLink(link)
  await until(() => location.hash === '' && noticeText() === 'opened a shared link', 'the open')
}

/** What a CLIF view shows from a compile's reply until its CLIF listing comes, as every compile draws it. */
const COMPILE_FRAME = "the compile's frame"
const compileFrame = (s: Record<string, string>) =>
  s.rows === 'none' && s.notice === 'Loading CLIF…' && s.line === 'not run' ? COMPILE_FRAME : JSON.stringify(s)

/**
 * Open `link` with the worker's replies kept from the page, choose `to` while its run is `in flight` (no reply yet)
 * or `after compiled` (its `compiled` handed on, nothing after it), hand the rest on, and read the CLIF view in
 * every frame from just before the press until the chosen listing's recording has stopped. Gives what each frame
 * showed, in order, a run of the same once, the compile's frame named as such. **WHERE THE VIEW STANDS IS NOT READ**:
 * the run's result adds the readout's rows for the link's program, as after any compile.
 */
async function chooseInCompile(to: Listing, link: SharePayload, press: 'in flight' | 'after compiled') {
  const pane = clif()
  const mark = ear.heard.length
  ear.hold()
  await open(link)
  await until(() => requestsOf(ear.heard.slice(mark), 'run').length > 0, "the link's run")
  const run = requestsOf(ear.heard.slice(mark), 'run')[0]
  expect(run?.clif, "precondition: the link's run carries the other listing").not.toBe(to)
  if (press === 'after compiled') {
    await until(() => ear.kept().some((r) => r.kind === 'compiled'), "the link's compiled, kept")
    await ear.release((r) => r.kind === 'compiled')
  }
  const watch = everyFrame(() => (host('clif-0') === pane ? seen(pane, false, true) : { remounted: 'the CLIF view' }))
  await frames()
  const before = seen(pane, false, true)
  if (press === 'after compiled') {
    expect(compileFrame(before), "precondition: the press is made on the compile's frame").toBe(COMPILE_FRAME)
  }
  const pressed = ear.heard.length
  await userEvent.click(choice(to) as HTMLButtonElement)
  for (let i = 0; i < 3; i++) await frames()
  const heard = ear.heard.slice(mark)
  if (press === 'in flight') expect(repliesOf(heard, 'compiled'), 'precondition: the run is in flight').toEqual([])
  else {
    expect(repliesOf(heard, 'compiled').length, "precondition: the run's compiled came").toBe(1)
    expect(repliesOf(heard, 'clif-listing'), 'precondition: its CLIF listing has not').toEqual([])
  }
  await ear.release()
  await until(() => requestsOf(ear.heard.slice(pressed), 'clif').length > 0, 'the clif request the choice posts')
  const asked = requestsOf(ear.heard.slice(pressed), 'clif')[0]
  expect(asked?.listing, 'precondition: the choice asked for the listing chosen').toBe(to)
  await until(() => clifStopped(ear.heard.slice(pressed), asked?.epoch ?? -1), "the chosen listing's recording")
  await frames()
  await frames()
  watch.stop()
  const after = seen(pane, false, true)
  expect(after.next, "precondition: the chosen listing's step 0 is drawn").not.toBe('none')
  expect(watch.seen.length, 'precondition: frames were read through the switch').toBeGreaterThan(4)
  return runsOf(watch.seen, before, after).map((s) => (s.startsWith('{') ? compileFrame(JSON.parse(s)) : s))
}

describe('a listing switch', () => {
  it('goes from as built to optimised in one frame', async () => {
    expect(choice('as-built')?.getAttribute('aria-checked'), 'precondition: the view shows as built').toBe('true')
    await switchTo('optimised', true)
  })

  it('goes from optimised to as built in one frame', async () => {
    await switchTo('as-built', true)
  })

  /**
   * **A SWITCH WHILE THE LEG RECORDS**: the loop's CLIF leg records for a while, so the press comes while a recording
   * of the listing it leaves is in flight. Where the view stands is not read: the run's first CLIF result comes with
   * the new recording's end and adds the readout's CLIF rows, which moves every view, as after any compile.
   */
  it('goes from a listing still recording to the other in one frame', async () => {
    const typed = ear.heard.length
    await program(LOOP)
    await until(() => clifChunks(ear.heard.slice(typed), 0).length > 0, "the first CLIF chunk of the loop's run")
    const { pressed } = await switchTo('optimised', false)
    expect(
      clifChunks(ear.heard.slice(pressed), 0).length,
      'precondition: a chunk of the listing as built came after the press',
    ).toBeGreaterThan(0)
  }, 30_000)

  /**
   * **WHERE THE VIEW STANDS HOLDS TOO** while the readout waits for the new run's result: the loop's CLIF rows say how
   * its recording stopped, and taken away at the press they would shorten the readout and move every view until the
   * result put them back.
   */
  it('keeps the view where it stands while the readout waits for the new run', async () => {
    await until(() => resultsText().includes('CLIF'), "the readout's CLIF rows")
    expect(resultsText(), 'precondition: the readout has CLIF rows at the press').toContain('CLIF')
    await switchTo('as-built', true)
  })
})

describe('a listing switch from a link', () => {
  /**
   * **THE STEP LINE GOES ON SAYING WHERE THE LINK WAS TAKING THE CLIF VIEW UNTIL THE SWAP** (`ClifHold.linkStep`): the
   * choice drops the link's CLIF position, so it never lands on the other listing's run, but the line it is in stays as
   * it was, so in a narrow view it re-wraps and moves nothing before the view changes. The position is past the loop's
   * first fill, so the link continues the leg, and the press is made with the worker's replies kept, while it is still
   * pending.
   */
  it("keeps the line saying the link's CLIF step, and the rows where they stand, until the swap", async () => {
    const fill =
      repliesOf(ear.heard, 'frames')
        .filter((c) => c.leg === 'clif' && c.done !== null)
        .at(-1)
        ?.frames.at(-1)?.step ?? Number.NaN
    expect(fill, "precondition: the loop's CLIF fill").toBeGreaterThan(0)
    const step = fill + 30_000
    await open(linkTo(LOOP, { clif: step }))
    await until(() => stepTextOf('clif-0').includes('from the link'), 'the step line saying where the link goes')
    const { before } = await switchTo('optimised', true, { line: true, hold: true })
    expect(before.line, 'precondition: the line said the link step at the press').toContain(
      `going to step ${n(step)} from the link`,
    )
  }, 60_000)

  /**
   * **A LISTING CHOSEN WHILE A LINK'S RUN IS IN FLIGHT** is asked for once the run's `compiled` comes, since the run
   * carried the other listing (`ClifSync.settled`), and is held over the ring the compile emptied: the view goes from
   * the rows it showed, through the frame every compile draws until its CLIF listing comes, to the chosen listing at
   * its step 0, with no frame of its own between.
   */
  it("goes through the compile's own frame alone for a choice made while a link's run is in flight", async () => {
    const runs = await chooseInCompile('optimised', linkTo(FACT, { clif: 95 }), 'in flight')
    expect(runs, 'what each frame showed, in order, a run of the same once').toEqual([
      'the listing left',
      COMPILE_FRAME,
      'the listing chosen',
    ])
  }, 60_000)

  /**
   * **A LISTING CHOSEN AFTER THE LINK'S `compiled` AND BEFORE ITS CLIF LISTING** is asked for at once, over the ring
   * the compile emptied: the view goes from the compile's frame to the chosen listing at its step 0 in one change, its
   * step line saying what it said until then.
   */
  it("goes from the compile's frame to the listing chosen in one frame after the link's compiled", async () => {
    const runs = await chooseInCompile('as-built', linkTo(LOOP, {}, 'optimised'), 'after compiled')
    expect(runs, 'what each frame showed, in order, a run of the same once').toEqual([
      'the listing left',
      'the listing chosen',
    ])
  }, 60_000)
})

describe('a listing switch after ↺', () => {
  const button = (name: string) =>
    clif().querySelector<HTMLButtonElement>(`.controls button[aria-label="${name}"]`) as HTMLButtonElement
  const keepRecording = () => clif().querySelector<HTMLButtonElement>('.controls button.extend') as HTMLButtonElement

  /**
   * **A LISTING CHOSEN BEFORE A REWIND'S FIRST FRAMES IS HELD OVER THE RING ↺ EMPTIED**, and the step line goes on
   * saying the leg records from step 0 until the swap. The loop's history is first kept recording until it drops its
   * start, so ↺ rewinds; the worker's replies are kept from the page from just before ↺, so the press lands before
   * the rewind's first frames however long it takes.
   */
  it('keeps the line saying the leg records from step 0 until the swap', async () => {
    expect(keepRecording()?.textContent, 'precondition: the history is full, and can be recorded on').toBe(
      'keep recording',
    )
    const mark = ear.heard.length
    await userEvent.click(keepRecording(), { force: true })
    await until(() => requestsOf(ear.heard.slice(mark), 'extend').length > 0, 'the extend keep recording posts')
    const kept = requestsOf(ear.heard.slice(mark), 'extend')[0]?.epoch ?? -1
    await until(
      () => clifChunks(ear.heard.slice(mark), kept).some((c) => c.done !== null),
      'the recording kept on to stop',
    )
    await until(() => stepTextOf('clif-0').includes('oldest kept'), 'the step line saying the start was dropped')
    ear.hold()
    const rewound = ear.heard.length
    await userEvent.click(button('back to step 0'), { force: true })
    await until(() => requestsOf(ear.heard.slice(rewound), 'rewind').length > 0, 'the rewind ↺ posts')
    const { before } = await switchTo('optimised', true, { line: true, hold: true })
    expect(before.line, 'precondition: at the press the line said the leg records from step 0').toBe('step 0 of 0…')
  }, 60_000)
})
