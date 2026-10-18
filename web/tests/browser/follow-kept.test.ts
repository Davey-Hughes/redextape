import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { frames, host, pressTab, pressToggle, SHELL, stageTab, stateIdle, toggle, until } from './harness'
import { lambdaSettled } from './lambda-text'
import { userPickWorkspace } from './user-event-fixture'

/**
 * A BOX THAT FOLLOWS THE RUN IS STILL FOLLOWING IT WHEN ITS VIEW COMES BACK TO THE PAGE — the view layouts spec §5.2.
 *
 * The TM view's rule table and state diagram, the asm view's listing and the λ view's body each keep the run's place
 * in view until the user scrolls away, and offer a control to follow again once they have (`state-table.ts`'s
 * `Follow`). `pane-host.ts` puts each view's scroll positions back after a rebuild, and that write is reported as a
 * `scroll` a frame later: read as the user's, it stopped a box nobody had touched from following. Measured before
 * the write was announced (`state-table.ts`'s `restoreScroll`), at 1280 × 896 on the program below: all four boxes
 * came back from a toggle off and on, and from a Stage tab away and back, with their control offered. With no
 * restore at all, as before the view layouts, all four came back following.
 *
 * **EVERY BOX FOLLOWS A ROW PAST ITS FIRST**, which the first case asserts: a box at its start is given nothing back,
 * and following it proves nothing. The program's last step leaves every box at its start, so each leg is one step
 * short of it, and the λ view draws an outline, where its redex is deep in a numeral.
 *
 * **ONE PAGE, AND EVERY CASE IS PUT WHERE IT STARTS BEFORE IT RUNS** (`startOn`): all four views, in tiles, or as
 * the Stage's tabs for the cases about a tab. Each then has its boxes follow again (`follow`). So a case passes alone
 * and in any order, and one that fails leaves the next its start. The Stage's cases needed the case that enters the
 * Stage before them, and the toggles' cases could not run after it (2026-10-12).
 */

const PROGRAM = 'fn double(n) { n + n } fn id(n) { n } let x = 20; id(double(x)) + 2'

type Box = {
  readonly name: string
  readonly leaf: string
  readonly kind: string
  readonly box: string
  readonly again: string
}
const BOXES: readonly Box[] = [
  { name: 'the rule table', leaf: 'tm-0', kind: 'tm', box: '.state-table', again: '.table-reattach' },
  { name: 'the state diagram', leaf: 'tm-0', kind: 'tm', box: '.program-scroll', again: '.diagram-reattach' },
  { name: 'the asm listing', leaf: 'asm-0', kind: 'asm', box: '.asm-listing', again: '.table-reattach' },
  { name: 'the λ body', leaf: 'lambda-0', kind: 'lambda', box: '.term', again: '.term-reattach' },
]

const box = (b: Box): HTMLElement => host(b.leaf)?.querySelector(b.box) as HTMLElement
/** `b`'s control to follow again, which is offered exactly while the box does not follow. */
const again = (b: Box): HTMLElement => host(b.leaf)?.querySelector(b.again) as HTMLElement
const offered = (b: Box): boolean => !again(b).hidden
const control = (leaf: string, label: string): HTMLButtonElement | undefined =>
  [...(host(leaf)?.querySelectorAll<HTMLButtonElement>('.controls button') ?? [])].find((b) => b.textContent === label)
/**
 * Put the page where a case starts, whatever the one before left: every kind's toggle pressed, which shows the four
 * views in the arrangement the page opened on, and the workspace in tiles (`explorer`) or on the `stage`. An
 * arrangement and not a gesture under test, so `.click()`.
 */
const startOn = (preset: 'explorer' | 'stage'): void => {
  for (const kind of ['source', 'asm', 'lambda', 'tm'])
    if (toggle(kind).getAttribute('aria-pressed') !== 'true') toggle(kind).click()
  const staged = document.querySelector('#views [role="tab"]') !== null
  if (staged !== (preset === 'stage')) {
    const menu = document.querySelector<HTMLElement>('#workspace-menu')
    document.querySelector<HTMLElement>('#workspace')?.click()
    menu?.querySelector<HTMLElement>(`[data-preset="${preset}"]`)?.click()
    if (menu?.matches(':popover-open')) menu.hidePopover()
  }
  const sel = preset === 'stage' ? '#views [role="tab"]' : '#views [data-leaf]:not([role="tab"])'
  const found = [...document.querySelectorAll<HTMLElement>(sel)].map((el) => el.dataset.leaf).join(' ')
  if (found !== 'source lambda-0 asm-0 tm-0') throw new Error(`startOn(${preset}) left the page on ${found}`)
}
/**
 * Have each of `boxes` follow from here, whatever the case before left, and assert that it does: a case that fails
 * must not fail the next one's precondition and be read as failing that one's claim.
 */
const follow = async (...boxes: Box[]): Promise<void> => {
  for (const b of boxes) if (offered(b)) again(b).click()
  await frames()
  for (const b of boxes) expect(offered(b), `precondition: ${b.name} is following`).toBe(false)
}
/** `[the step shown, the run's last]`, from a view's own step readout. */
const steps = (leaf: string): number[] =>
  [...(host(leaf)?.querySelector('.step')?.textContent ?? '').matchAll(/[\d,]+/g)].map((m) =>
    Number(m[0].replaceAll(',', '')),
  )

describe('a box that follows the run, across a rebuild of the layout', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    const view: EditorView = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: PROGRAM } })
    await until(stateIdle, 'the first compile')
    host('lambda-0')?.querySelector<HTMLButtonElement>('.view-menu-choice[data-value="outline"]')?.click()
    // ONE STEP SHORT OF THE LAST, on every leg: `⏭`, then `◀`.
    for (const leaf of ['tm-0', 'asm-0', 'lambda-0']) {
      host(leaf)?.querySelector<HTMLButtonElement>('.controls button.to-newest')?.click()
      await until(() => steps(leaf).length === 2 && steps(leaf)[0] === steps(leaf)[1], `${leaf} to reach its last step`)
      control(leaf, '◀')?.click()
      await until(() => steps(leaf)[0] === (steps(leaf)[1] as number) - 1, `${leaf} to step back`)
    }
    await lambdaSettled('lambda-0')
    await frames()
  })

  beforeEach(() => startOn('explorer'))

  /**
   * As the mount left them where this runs first or alone, since `follow` presses nothing for a box that follows
   * already; after another case, once each has been told to follow again.
   */
  it('has every box following a row past its first', async () => {
    await follow(...BOXES)
    for (const b of BOXES)
      expect(box(b).scrollTop, `${b.name} is at its start, and has nothing to be given back`).toBeGreaterThan(12)
  })

  it('is still following in a view that stays on the page while another view’s toggle is pressed', async () => {
    await follow(...BOXES)
    for (const press of ['off', 'on']) {
      await pressToggle('source')
      await frames()
      expect(
        BOXES.filter(offered).map((b) => b.name),
        `stopped following, source ${press}`,
      ).toEqual([])
      for (const b of BOXES) expect(box(b).scrollTop, `${b.name} is at its start, source ${press}`).toBeGreaterThan(12)
    }
  })

  it.for(BOXES)('is still following when its view’s toggle is pressed off and on: $name', async (b) => {
    await follow(b)
    const before = box(b).scrollTop
    expect(before, 'precondition: past its first row').toBeGreaterThan(12)
    await pressToggle(b.kind)
    expect(host(b.leaf), 'the view is still on the page').toBeNull()
    await frames()
    await pressToggle(b.kind)
    await frames()
    expect(offered(b), `${b.name} came back no longer following`).toBe(false)
    expect(box(b).scrollTop, `${b.name} came back somewhere else`).toBe(before)
  })

  /**
   * **A BOX WITH NO ROW TO CENTRE IS WRITTEN BY NOTHING BUT THE RESTORE.** On the run's last step the machine is in
   * `halt`, a runtime routine with no row of its own in the diagram, so the diagram stays where the step before left
   * it, still following. The draw after a rebuild writes nothing there and so announces nothing: the restore's own
   * write has to be announced where it is made.
   */
  describe('with no row to centre: the state diagram on the run’s last step', () => {
    const diagram = BOXES[1] as Box
    const current = (): Element | null | undefined => host('tm-0')?.querySelector('.program-row[aria-current="step"]')

    beforeAll(async () => {
      startOn('explorer')
      await follow(diagram)
      control('tm-0', '▶')?.click()
      await until(() => steps('tm-0')[0] === steps('tm-0')[1], 'the TM to reach its last step')
      await frames()
    })

    afterAll(async () => {
      startOn('explorer')
      control('tm-0', '◀')?.click()
      await until(() => steps('tm-0')[0] === (steps('tm-0')[1] as number) - 1, 'the TM to step back')
      await frames()
    })

    it('is still following when its view’s toggle is pressed off and on', async () => {
      await follow(diagram)
      expect(current(), 'precondition: the diagram has a row to centre').toBeNull()
      const before = box(diagram).scrollTop
      expect(before, 'precondition: past its first row').toBeGreaterThan(12)
      await pressToggle('tm')
      expect(host('tm-0'), 'the view is still on the page').toBeNull()
      await frames()
      await pressToggle('tm')
      await frames()
      expect(offered(diagram), 'the diagram came back no longer following').toBe(false)
      expect(box(diagram).scrollTop, 'the diagram came back somewhere else').toBe(before)
    })

    /**
     * **THE VIEW COMES BACK IN ANOTHER COMBINATION, TALLER, AND THE DIAGRAM CANNOT SCROLL AS FAR AS IT HAD.** The
     * browser clamps the restore's write, so its `scroll` reports a position the restore never asked for. Measured
     * before the restore read the position back: 480 px in a box of 120 came back as 432 in a box of 168, with
     * *follow current state* offered.
     */
    it('is still following when its view comes back taller and the restore is clamped', async () => {
      await follow(diagram)
      expect(current(), 'precondition: the diagram has a row to centre').toBeNull()
      const before = { top: box(diagram).scrollTop, height: box(diagram).clientHeight }
      await pressToggle('tm')
      expect(host('tm-0'), 'the view is still on the page').toBeNull()
      await pressToggle('lambda')
      await pressToggle('asm')
      await frames()
      await pressToggle('tm')
      await frames()
      const back = { top: box(diagram).scrollTop, height: box(diagram).clientHeight, offered: offered(diagram) }
      // THE FOUR VIEWS BACK BEFORE ANYTHING IS ASSERTED, so a failure here leaves the next case its page.
      await pressToggle('lambda')
      await pressToggle('asm')
      await frames()
      expect(back.height, 'precondition: the diagram came back taller').toBeGreaterThan(before.height)
      expect(before.top - back.top, 'precondition: the restore was clamped').toBeGreaterThan(12)
      expect(back.offered, 'the clamp was read as the user scrolling').toBe(false)
      expect(offered(diagram), 'the diagram stopped following on the way back to four views').toBe(false)
    })
  })

  /** The other half of what the restore owes: a box the user took control of is theirs when it comes back. */
  it('comes back where the user scrolled it to, still not following: the rule table', async () => {
    const table = BOXES[0] as Box
    await follow(table)
    expect(box(table).scrollTop, 'precondition: following somewhere other than 120').toBeGreaterThan(240)
    box(table).scrollTop = 120
    await until(() => offered(table), 'the user’s scroll to stop the table following')
    await pressToggle('tm')
    expect(host('tm-0'), 'the view is still on the page').toBeNull()
    await frames()
    await pressToggle('tm')
    await frames()
    expect(box(table).scrollTop, 'the table came back somewhere else').toBe(120)
    expect(offered(table), 'the table came back following').toBe(true)
  })

  /**
   * **THE λ BODY COMES INTO THE STAGE AT ANOTHER WIDTH, AND ITS TERM IS LAID OUT SHORTER THERE.** Its scroll is put
   * back first, and the paint that follows shrinks the term under it: the browser clamps the position onto the
   * redex's own, which the paint then has no reason to write. The body's paint records that clamp (`lambda-body.ts`).
   */
  it('is still following when the Stage is entered and its tab selected', async () => {
    await follow(...BOXES)
    await userPickWorkspace('[data-preset="stage"]')
    const lost: string[] = []
    for (const b of BOXES) {
      await pressTab(b.leaf)
      await frames()
      if (offered(b)) lost.push(b.name)
    }
    expect(lost, 'came into the Stage no longer following').toEqual([])
  })

  describe('on the Stage', () => {
    // AFTER THE HOOK ABOVE, which has put the four views back: the Stage, where a case before did not leave it.
    beforeEach(() => startOn('stage'))

    it.for(BOXES)('is still following when its Stage tab is left and selected again: $name', async (b) => {
      expect(stageTab(b.leaf), 'precondition: the Stage is drawn').not.toBeNull()
      await pressTab(b.leaf)
      await follow(b)
      const before = box(b).scrollTop
      expect(before, 'precondition: past its first row').toBeGreaterThan(12)
      await pressTab('source')
      expect(host(b.leaf), 'the view is still on the page').toBeNull()
      await frames()
      await pressTab(b.leaf)
      await frames()
      expect(offered(b), `${b.name} came back no longer following`).toBe(false)
      expect(box(b).scrollTop, `${b.name} came back somewhere else`).toBe(before)
    })
  })
})
