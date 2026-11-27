import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import init, { compile as compileInPage } from '../../../pkg/redextape_wasm.js'
import { EXAMPLES } from '../../src/examples'
import { LinkIndex, type LinkIndexWire } from '../../src/link'
import type { Listing, RunReply } from '../../src/protocol'
import { compile, host, linkAt, linkStatus, PREFIX, SHELL, scrollHeldAt, sourceLinked, toggle, until } from './harness'

/**
 * Linking through the CLIF view (CLIF view design §4, *Links*): a CLIF row with a srcloc pins its rxm instruction,
 * which the rxm view marks alone and the source and TM views mark as its construct; an rxm instruction marks its own
 * CLIF rows and a source construct the rows of all its instructions; an rxm instruction can mark no optimised row, and
 * nothing says so; a row with no srcloc links nothing; and the CLIF run's own focus marks its rows and meets the pin.
 * Each count is `fact.rxt`'s or `first-order-02`'s, as the CLIF probe read them.
 */

const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
/** `first-order-02`: its rxm pc 6, `li rr, #20`, is lowered to rows 60 and 61 as built, and to no optimised row. */
const IF = 'if 2 > 1 { 10 } else { 20 }'
/** The rows of `fact.rxt`'s listing as built whose srcloc is 13, `call fact.0`. */
const PC13_BUILT = [161, 162, 165, 168, 169]
/** `fact.rxt`'s row with no srcloc, as built: `v1 = iconst.i64 0`. */
const NO_SRCLOC = 29
/** The pcs of the construct that owns pc 13, `fact(n - 1)`'s call: 12, 13 and 14. */
const CONSTRUCT_PCS = ['pc12', 'pc13', 'pc14']
/** `style.css`'s row height, which the listings' virtual grid lays its rows out by. */
const ROW = 24
/** Each long case's own bound, past every wait in it. */
const CASE_MS = 60_000

/**
 * A row of each program's listings whose text tells that listing from the other one and from the other program's.
 */
const MARKER: Record<string, Record<Listing, { readonly row: number; readonly text: string }>> = {
  [FACT]: { 'as-built': { row: 29, text: 'v1 = iconst.i64 0' }, optimised: { row: 29, text: 'jump block1' } },
  [IF]: { 'as-built': { row: 27, text: 'v1 = iconst.i64 0' }, optimised: { row: 27, text: 'jump block1' } },
}

let view: EditorView
/** The construct that owns pc 13 in `fact.rxt`: a position whose innermost construct it is, and its text. */
let construct: { readonly at: number; readonly text: string }
/** A construct of `fact.rxt` on one line that bills no rxm instruction, as `construct` is given. */
let bare: { readonly at: number; readonly text: string }

/** The page's `Worker`, which `holdListings` wraps and `afterAll` puts back. */
const PageWorker = globalThis.Worker
/** `clif-listing` replies held from the page, each with the worker that sent it. */
const held: { readonly worker: Worker; readonly data: RunReply }[] = []
let holding = false

/**
 * Hold each `clif-listing` reply a session worker sends while `holding` is set, and hand it to the page at `release`.
 * **INSTALLED BEFORE `main()`**, which makes the program's worker as it starts, so this listener is the worker's first
 * and stops a held reply before the page's own hears it, as `clif-fixture.ts`'s `hearSessionWorkers` hears first.
 */
function holdListings(): void {
  globalThis.Worker = new Proxy(PageWorker, {
    construct(target, args: ConstructorParameters<typeof Worker>, newTarget) {
      const worker: Worker = Reflect.construct(target, args, newTarget)
      if (String(args[0]).includes('session-worker')) {
        worker.addEventListener('message', (e) => {
          const data = (e as MessageEvent<RunReply>).data
          if (!holding || data.kind !== 'clif-listing') return
          e.stopImmediatePropagation()
          held.push({ worker, data })
        })
      }
      return worker
    },
  })
}

/** Stop holding, and give the page every reply held, in the order they came. */
function release(): void {
  holding = false
  for (const { worker, data } of held.splice(0)) worker.dispatchEvent(new MessageEvent('message', { data }))
}

/** Whether the CLIF view has drawn a listing of `rows` rows at step 0 of its run. */
const listed = (rows: number) =>
  listingOf(clif(), 'clif').getAttribute('aria-rowcount') === String(rows) && /^step 0 of \d/.test(stepOf(clif()))

type Kind = 'rxm' | 'clif'
/** A listing row as it was drawn: its pc column, its text and its marks. */
type Row = {
  readonly pc: string
  readonly text: string
  readonly linked: boolean
  readonly focus: boolean
  readonly next: boolean
}

/** The page's CLIF view, or `null` while it has none. */
const clifView = () => document.querySelector<HTMLElement>('#views [data-kind="clif"]')
const clif = () => clifView() as HTMLElement
const rxm = () => host('rxm-0') as HTMLElement
const listingOf = (pane: HTMLElement, kind: Kind) => pane.querySelector<HTMLElement>(`.${kind}-listing`) as HTMLElement
/** `pane`'s drawn listing row `row`, by its 0-based index in the listing. */
const rowAt = (pane: HTMLElement, kind: Kind, row: number) =>
  pane.querySelector<HTMLElement>(`.${kind}-row[aria-rowindex="${row + 1}"]`)
const stepOf = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''
const control = (pane: HTMLElement, label: string) =>
  [...pane.querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
/** The pc column of the CLIF row about to run, which is the row of the frame's instruction. */
const nextPc = () => clif().querySelector('.clif-row.is-next .rxm-pc')?.textContent ?? null

/**
 * Every row of `pane`'s listing, by its index: read by scrolling the listing through from its top a box at a time,
 * since it draws only the rows in view.
 */
async function scan(pane: HTMLElement, kind: Kind): Promise<Map<number, Row>> {
  const box = listingOf(pane, kind)
  const count = Number(box.getAttribute('aria-rowcount'))
  const step = Math.max(1, Math.floor(box.clientHeight / ROW) - 1)
  const rows = new Map<number, Row>()
  for (let top = 0; top < count; top += step) {
    const last = Math.min(top + step - 1, count - 1)
    await until(
      () => scrollHeldAt(box, top * ROW) && rowAt(pane, kind, top) !== null && rowAt(pane, kind, last) !== null,
      `the ${kind} listing to draw rows ${top} to ${last}`,
    )
    for (const el of pane.querySelectorAll<HTMLElement>(`.${kind}-row`)) {
      rows.set(Number(el.getAttribute('aria-rowindex')) - 1, {
        pc: el.querySelector('.rxm-pc')?.textContent ?? '',
        text: el.querySelector(`.${kind}-cell`)?.textContent ?? '',
        linked: el.classList.contains('is-linked'),
        focus: el.classList.contains('is-focus'),
        next: el.classList.contains('is-next'),
      })
    }
  }
  expect(rows.size, `every row of the ${kind} listing read`).toBe(count)
  return rows
}

/** The indices of `rows` that `keep` keeps, in listing order. */
const where = (rows: ReadonlyMap<number, Row>, keep: (r: Row) => boolean): number[] =>
  [...rows]
    .filter(([, r]) => keep(r))
    .map(([i]) => i)
    .sort((a, b) => a - b)

/** Scroll `pane`'s listing to `row`, two rows below its top, and return the row once it is drawn. */
async function scrollTo(pane: HTMLElement, kind: Kind, row: number): Promise<HTMLElement> {
  const box = listingOf(pane, kind)
  await until(
    () => scrollHeldAt(box, Math.max(0, (row - 2) * ROW)) && rowAt(pane, kind, row) !== null,
    `the ${kind} listing to draw row ${row}`,
  )
  return rowAt(pane, kind, row) as HTMLElement
}

/** Press `pane`'s listing row `row` as a user does. */
async function press(pane: HTMLElement, kind: Kind, row: number): Promise<void> {
  await userEvent.click(await scrollTo(pane, kind, row))
}

/** The rxm listing's row of instruction `pc`. */
async function rxmRow(pc: number): Promise<number> {
  const [row] = where(await scan(rxm(), 'rxm'), (r) => r.pc === `pc${pc}`)
  if (row === undefined) throw new Error(`no rxm row reads pc${pc}`)
  return row
}

/** Put the CLIF listing back on the instruction about to run, where a case before scrolled it away. */
async function follow(): Promise<void> {
  const reattach = clif().querySelector<HTMLButtonElement>('.panel[data-panel="listing"] .table-reattach')
  if (reattach !== null && !reattach.hidden) await userEvent.click(reattach)
}

/** Show a CLIF view of `program` listed as `listing`, its run at step 0 and its listing drawn. */
async function setUp(program: string, listing: Listing): Promise<void> {
  if (clifView() === null) {
    await userEvent.click(toggle('clif'))
    await until(() => clifView() !== null, 'a CLIF view')
  }
  if (view.state.doc.toString() !== program) await compile(view, program)
  const choice = clif().querySelector<HTMLButtonElement>(
    `.view-actions [role="radiogroup"] button[data-value="${listing}"]`,
  ) as HTMLButtonElement
  if (choice.getAttribute('aria-checked') !== 'true') await userEvent.click(choice)
  const marker = MARKER[program]?.[listing]
  if (marker === undefined) throw new Error('no marker for this program')
  await until(
    () => /^step 0 of \d/.test(stepOf(clif())) && listingOf(clif(), 'clif').getAttribute('aria-rowcount') !== null,
    'the CLIF view to record its run',
  )
  await scrollTo(clif(), 'clif', marker.row)
  await until(
    () => rowAt(clif(), 'clif', marker.row)?.querySelector('.clif-cell')?.textContent?.endsWith(marker.text) === true,
    `the CLIF view to list the program ${listing}`,
  )
}

beforeAll(async () => {
  holdListings()
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await compile(view, FACT)
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => clifView() !== null, 'the view keys and 5 to show a CLIF view')

  // WHICH CONSTRUCT OWNS PC 13, AND WHERE A CARET LINKS IT, ARE READ OFF THE SAME LOWERING THE APP RAN, in the page, as
  // `rxm-link.test.ts` reads its minted instruction: the innermost construct at its span's start may be a smaller one.
  await init()
  const { session } = compileInPage(FACT, 'unary') as {
    session: { linkIndex(budget: number): LinkIndexWire; free(): void } | null
  }
  const wire = session?.linkIndex(65_536)
  session?.free()
  if (wire === undefined) throw new Error('fact.rxt has no link index')
  const index = new LinkIndex(wire)
  const node = index.nodeForInstr(13)
  if (node === null) throw new Error('pc 13 has no owner')
  const l = index.linkFor(node)
  expect(l.instrs, 'precondition: the construct that owns pc 13 owns 12, 13 and 14').toEqual([12, 13, 14])
  construct = linkable(index, node) ?? { at: -1, text: '' }
  expect(construct.at, 'precondition: a position whose innermost construct owns pc 13').toBeGreaterThanOrEqual(0)
  const without = [...new Set(wire.sourceNodeId)]
    .filter((n) => index.linkFor(n).instrs.length === 0)
    .map((n) => linkable(index, n))
    .find((c): c is NonNullable<typeof c> => c !== null && !c.text.includes('\n'))
  if (without === undefined) throw new Error('fact.rxt has no construct on one line with no instruction')
  bare = without
}, 30_000)

afterAll(() => {
  globalThis.Worker = PageWorker
})

/** A position whose innermost construct is `node`, and the construct's text; `null` for none. */
function linkable(index: LinkIndex, node: number): { readonly at: number; readonly text: string } | null {
  const span = index.linkFor(node).source
  if (span === null) return null
  for (let at = span.start; at < span.end; at += 1) {
    if (index.nodeAtSource(at) === node) return { at, text: FACT.slice(span.start, span.end) }
  }
  return null
}

describe('linking through the CLIF view', () => {
  it.each<Listing>(['as-built', 'optimised'])(
    'a CLIF row links its rxm instruction alone: %s',
    async (listing) => {
      await setUp(FACT, listing)
      const pc13 = where(await scan(clif(), 'clif'), (r) => r.pc === 'pc13')
      expect(pc13, 'precondition: five rows whose srcloc is 13').toHaveLength(5)
      if (listing === 'as-built') expect(pc13).toEqual(PC13_BUILT)
      await press(clif(), 'clif', pc13[0] as number)
      await until(() => sourceLinked() !== null, 'the source to be linked')
      expect(sourceLinked()).toBe(construct.text)
      const rxmRows = await scan(rxm(), 'rxm')
      expect(where(rxmRows, (r) => r.linked).map((i) => rxmRows.get(i)?.pc)).toEqual(['pc13'])
      const clifRows = await scan(clif(), 'clif')
      expect(where(clifRows, (r) => r.linked)).toEqual(pc13)
      // WHAT THE USER SEES OF THE MARK: the linked row's dashed left edge, where every other row's is solid.
      expect(getComputedStyle(await scrollTo(clif(), 'clif', pc13[0] as number)).borderLeftStyle).toBe('dashed')
      expect(getComputedStyle(await scrollTo(clif(), 'clif', NO_SRCLOC)).borderLeftStyle).toBe('solid')
    },
    CASE_MS,
  )

  // EACH PIN STANDS ACROSS THE SWITCH, as a user's does: the optimised listing marks the pin made as built.
  it(
    'an rxm instruction marks its own CLIF rows',
    async () => {
      await setUp(FACT, 'as-built')
      await press(rxm(), 'rxm', await rxmRow(13))
      await until(() => sourceLinked() === construct.text, 'the source to be linked')
      let rows = await scan(clif(), 'clif')
      expect(
        where(rows, (r) => r.linked),
        'the rows of pc 13, not of its construct',
      ).toEqual(where(rows, (r) => r.pc === 'pc13'))
      expect(where(rows, (r) => r.linked)).toHaveLength(5)

      await press(rxm(), 'rxm', await rxmRow(4))
      await until(() => sourceLinked() !== construct.text, 'the source to link pc 4’s construct')
      rows = await scan(clif(), 'clif')
      expect(where(rows, (r) => r.linked)).toEqual(where(rows, (r) => r.pc === 'pc4'))
      expect(where(rows, (r) => r.linked)).toHaveLength(3)

      await setUp(FACT, 'optimised')
      rows = await scan(clif(), 'clif')
      expect(
        where(rows, (r) => r.linked),
        'pc 4 optimised',
      ).toEqual(where(rows, (r) => r.pc === 'pc4'))
      expect(where(rows, (r) => r.linked)).toHaveLength(2)

      await press(rxm(), 'rxm', await rxmRow(13))
      await until(() => sourceLinked() === construct.text, 'the source to link pc 13’s construct')
      rows = await scan(clif(), 'clif')
      expect(
        where(rows, (r) => r.linked),
        'pc 13 optimised',
      ).toEqual(where(rows, (r) => r.pc === 'pc13'))
      expect(where(rows, (r) => r.linked)).toHaveLength(5)
    },
    CASE_MS,
  )

  it(
    'a source construct marks the CLIF rows of its instructions',
    async () => {
      await setUp(FACT, 'as-built')
      linkAt(view, construct.at)
      await until(() => sourceLinked() === construct.text, 'the source to be linked')
      for (const listing of ['as-built', 'optimised'] as const) {
        await setUp(FACT, listing)
        const rows = await scan(clif(), 'clif')
        expect(
          where(rows, (r) => r.linked),
          listing,
        ).toEqual(where(rows, (r) => CONSTRUCT_PCS.includes(r.pc)))
        expect(where(rows, (r) => r.linked)).toHaveLength(7)
      }
    },
    CASE_MS,
  )

  it(
    'a standing pin is marked after the listing switch',
    async () => {
      await setUp(FACT, 'as-built')
      await press(rxm(), 'rxm', await rxmRow(13))
      await until(() => sourceLinked() === construct.text, 'the source to be linked')
      await userEvent.click(
        clif().querySelector<HTMLButtonElement>(
          '.view-actions [role="radiogroup"] button[data-value="optimised"]',
        ) as HTMLButtonElement,
      )
      await until(() => listed(155), 'the CLIF view to list the program optimised')
      const rows = await scan(clif(), 'clif')
      expect(where(rows, (r) => r.linked)).toEqual(where(rows, (r) => r.pc === 'pc13'))
      expect(where(rows, (r) => r.linked)).toHaveLength(5)
    },
    CASE_MS,
  )

  it(
    'a CLIF view shown after a pin marks it',
    async () => {
      await setUp(FACT, 'as-built')
      await userEvent.click(toggle('clif'))
      await until(() => clifView() === null, 'the CLIF view to close')
      linkAt(view, construct.at)
      await until(() => sourceLinked() === construct.text, 'the source to be linked')
      await userEvent.click(toggle('clif'))
      await until(() => clifView() !== null && listed(187), 'a CLIF view to list the program as built')
      const rows = await scan(clif(), 'clif')
      expect(where(rows, (r) => r.linked)).toEqual(where(rows, (r) => CONSTRUCT_PCS.includes(r.pc)))
      expect(where(rows, (r) => r.linked)).toHaveLength(7)
    },
    CASE_MS,
  )

  it(
    'a pin made while the CLIF listing is built is marked when it lands',
    async () => {
      await setUp(IF, 'as-built')
      holding = true
      await compile(view, FACT)
      await until(() => held.length > 0, 'the CLIF listing of fact.rxt, held')
      expect(listingOf(clif(), 'clif').getAttribute('aria-rowcount'), 'precondition: no listing drawn').toBeNull()
      linkAt(view, construct.at)
      await until(() => sourceLinked() === construct.text, 'the source to be linked')
      release()
      await until(() => listed(187), 'the CLIF view to list the program as built')
      const rows = await scan(clif(), 'clif')
      expect(where(rows, (r) => r.linked)).toEqual(where(rows, (r) => CONSTRUCT_PCS.includes(r.pc)))
      expect(where(rows, (r) => r.linked)).toHaveLength(7)
    },
    CASE_MS,
  )

  it(
    'an rxm instruction can mark no optimised row, and nothing says so',
    async () => {
      await setUp(IF, 'as-built')
      const pc6 = await rxmRow(6)
      await press(rxm(), 'rxm', pc6)
      expect(where(await scan(clif(), 'clif'), (r) => r.linked)).toEqual([60, 61])
      const built = linkStatus()

      await setUp(IF, 'optimised')
      expect(where(await scan(clif(), 'clif'), (r) => r.linked)).toEqual([])
      const optimised = linkStatus()

      await userEvent.click(toggle('clif'))
      await until(() => clifView() === null, 'the CLIF view to close')
      await press(rxm(), 'rxm', pc6)
      expect(optimised, 'the line with no optimised row marked').toBe(linkStatus())
      expect(built, 'the line with two rows marked as built').toBe(linkStatus())
    },
    CASE_MS,
  )

  // THE ABSENCE CLAUSE NAMES NO CLIF ROWS FOR ANY CONSTRUCT: an rxm pin always names its own instruction, so only a
  // construct with none could leave the CLIF leg nothing to mark, and the rxm leg's clause already says so.
  it(
    'a construct with no instruction says so, and names no CLIF rows',
    async () => {
      await setUp(FACT, 'as-built')
      linkAt(view, bare.at)
      await until(() => sourceLinked() === bare.text, 'the source to be linked')
      expect(linkStatus()).toContain('this construct emits no instructions')
      expect(linkStatus()).not.toContain('clif')
      expect(where(await scan(clif(), 'clif'), (r) => r.linked)).toEqual([])
    },
    CASE_MS,
  )

  it(
    'a CLIF row with no srcloc clears the pin and says nothing',
    async () => {
      await setUp(FACT, 'as-built')
      await press(clif(), 'clif', PC13_BUILT[0] as number)
      await until(() => sourceLinked() !== null, 'precondition: pc 13 pinned')
      const row = await scrollTo(clif(), 'clif', NO_SRCLOC)
      expect(row.querySelector('.rxm-pc')?.textContent, 'precondition: a row with no srcloc').toBe('')
      expect(row.querySelector('.clif-cell')?.textContent?.endsWith('v1 = iconst.i64 0')).toBe(true)
      await userEvent.click(row)
      expect(sourceLinked()).toBeNull()
      expect(where(await scan(rxm(), 'rxm'), (r) => r.linked)).toEqual([])
      expect(where(await scan(clif(), 'clif'), (r) => r.linked)).toEqual([])
      expect(document.querySelectorAll('.state-row.is-linked')).toHaveLength(0)
      expect(linkStatus()).toBe('')
    },
    CASE_MS,
  )

  it(
    'the CLIF run’s focus marks its rows and meets the pin',
    async () => {
      await setUp(FACT, 'as-built')
      await follow()
      linkAt(view, construct.at)
      await until(() => sourceLinked() === construct.text, 'the source to be linked')
      expect(linkStatus(), 'precondition: the CLIF run is elsewhere').not.toContain('the clif run is here right now')
      for (let step = 1; nextPc() !== 'pc13'; step += 1) {
        if (step > 189) throw new Error('the CLIF run never reached pc 13')
        await userEvent.click(control(clif(), '▶') as HTMLButtonElement)
        await until(() => stepOf(clif()).startsWith(`step ${step} of`), `the CLIF view to reach step ${step}`)
      }
      expect(linkStatus()).toContain('the clif run is here right now')
      const rows = await scan(clif(), 'clif')
      const focused = where(rows, (r) => r.focus)
      expect(focused).toEqual(where(rows, (r) => CONSTRUCT_PCS.includes(r.pc)))
      expect(focused).toHaveLength(7)
      // WHAT THE USER SEES OF THE FOCUS: its bottom edge, composed into the row's `box-shadow`, which a row out of the
      // focus does not have. Not its wash: every focused row here is linked too, and the link has a background of its
      // own.
      const edge = ' 0px -2px 0px'
      const onFocus = where(rows, (r) => r.focus && !r.next)[0] as number
      const plain = where(rows, (r) => !r.focus && !r.next)[0] as number
      expect(getComputedStyle(await scrollTo(clif(), 'clif', onFocus)).boxShadow).toContain(edge)
      expect(getComputedStyle(await scrollTo(clif(), 'clif', plain)).boxShadow).not.toContain(edge)
    },
    CASE_MS,
  )
})
