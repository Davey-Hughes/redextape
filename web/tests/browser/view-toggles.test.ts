import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { focusInPage, host, live, notice, SHELL, until } from './harness'

/**
 * THE HEADER'S `views` TOGGLES — the view layouts spec §4 to §6: a press shows another combination of views, each
 * combination remembers its own arrangement, and a view off the page is kept alive.
 *
 * The page starts on all four views (`setup.ts` stores that workspace for every file), so every toggle starts
 * pressed. **THE CASES ARE A SEQUENCE ON ONE PAGE**, each from the state the one before left. The start is a stored
 * workspace, four views in two rows with nothing remembered, and no gesture puts a page back on it: *reset preset*
 * leaves two views, and `harness.ts`'s four-view fixtures leave two arrangements remembered, which the cases here
 * read. So no hook restores it between cases.
 *
 * **FIVE CASES PASS ALONE AND SEVEN DO NOT**, as a run of each alone found (`-t`, 2026-10-12). Alone: the start, a
 * kind hidden on a press, a view kept alive off the page, a scroll kept, and the pair's first visit. The seven start
 * from what the case before left, and **EACH BEGINS BY ASSERTING IT**, so run alone it fails on its precondition and
 * not on a wrong page: the default on a first visit and the second press, from the asm view hidden; the last toggle
 * disabled, the tree before a `✕` and *reset preset*, from the source beside the TM view; the link, from something
 * remembered; and the Stage's tabs, from source, λ and TM. Three of the seven asserted nothing first, and failed
 * alone on a view's height, on the views their own press left, and on the Stage's tabs.
 *
 * **PRESSES ARE `userEvent.click`, NOT `.click()`**: a synthetic click reaches a handler a real pointer cannot, and
 * what these cases assert includes where the focus is after a real press.
 */

const toggle = (kind: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`) as HTMLButtonElement
const pressed = (): string[] =>
  [...document.querySelectorAll<HTMLButtonElement>('#views-shown button[aria-pressed="true"]')].map(
    (b) => b.dataset.shows as string,
  )
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const tabs = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [role="tab"]')].map((t) => t.dataset.leaf as string)
type Stored = { tree: unknown; focused: string; arrangements?: Record<string, unknown> }
const stored = (): Stored => JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null')
const press = (kind: string): Promise<void> => userEvent.click(toggle(kind))
const pick = async (sel: string): Promise<void> => {
  await userEvent.click(document.querySelector('#workspace') as HTMLElement)
  await userEvent.click(document.querySelector(`#workspace-menu ${sel}`) as HTMLElement)
  const menu = document.querySelector<HTMLElement>('#workspace-menu')
  if (menu?.matches(':popover-open')) menu.hidePopover()
}
const ALL = 'source+lambda+asm+tm'

describe('the views toggles', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  })

  it('starts with all four views on the page and all four toggles pressed', () => {
    expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
    expect(pressed()).toEqual(['source', 'asm', 'lambda', 'tm'])
    expect(stored().arrangements, 'the stored workspace already remembers an arrangement').toBeUndefined()
  })

  it('hides a kind on a press: the view leaves the page, the toggle says so, and the focus stays on it', async () => {
    const four = stored().tree
    await press('asm')
    expect(mounted()).toEqual(['source', 'lambda-0', 'tm-0'])
    expect(host('asm-0'), 'the asm view is still on the page').toBeNull()
    expect(pressed()).toEqual(['source', 'lambda', 'tm'])
    expect(toggle('asm').title).toBe('show the asm view')
    expect(live()).toBe('showing source, λ and TM')
    expect(document.activeElement, 'the press cost the toggle its focus').toBe(toggle('asm'))
    // THE ARRANGEMENT LEFT IS REMEMBERED UNDER ITS OWN KEY, AND THE ONE ON SCREEN UNDER NONE.
    expect(stored().arrangements).toEqual({ [ALL]: four })
  })

  /**
   * THE USER'S RULE FOR A WIDE WINDOW (2026-10-11): columns side by side, each with its own stack, so no view and no
   * divider runs the whole width. Three views are the first beside a column of the other two.
   */
  it('shows a combination’s default on its first visit: source beside a column of λ over TM', () => {
    expect(mounted(), 'precondition: the case before hid the asm view').toEqual(['source', 'lambda-0', 'tm-0'])
    expect(Object.keys(stored().arrangements ?? {}), 'precondition: and it is these three’s first visit').toEqual([ALL])
    const area = (document.querySelector('#views') as HTMLElement).getBoundingClientRect()
    const source = (host('source') as HTMLElement).getBoundingClientRect()
    const lambda = (host('lambda-0') as HTMLElement).getBoundingClientRect()
    const tm = (host('tm-0') as HTMLElement).getBoundingClientRect()
    expect(Math.abs(source.height - area.height), 'the source view is not the full height').toBeLessThan(1)
    expect(source.right).toBeLessThanOrEqual(lambda.left)
    expect(Math.abs(source.top - lambda.top)).toBeLessThan(1)
    expect(tm.top, 'the TM view is not under the λ view').toBeGreaterThanOrEqual(lambda.bottom)
    expect(Math.abs(tm.left - lambda.left), 'the TM view is not in the λ view’s column').toBeLessThan(1)
    for (const view of [source, lambda, tm])
      expect(view.width, 'a view runs the whole width').toBeLessThan(area.width * 0.6)
  })

  it('shows it again on a second press, in the arrangement that was left', async () => {
    expect(mounted(), 'precondition: the asm view is off the page').toEqual(['source', 'lambda-0', 'tm-0'])
    const three = stored().tree
    const four = stored().arrangements?.[ALL]
    expect(four, 'precondition: the four views are remembered as they were left').toBeDefined()
    await press('asm')
    await focusInPage('a press on the asm toggle, which shows its view')
    expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
    expect(stored().tree, 'the four views did not come back as they were left').toEqual(four)
    expect(stored().arrangements).toEqual({ 'source+lambda+tm': three })
    expect(live()).toBe('showing source, asm, λ and TM')
    expect(toggle('asm').title).toBe('hide the asm view')
  })

  /**
   * THE VIEW IS KEPT ALIVE, NOT BUILT AGAIN (spec §5.2): its pane is the one that left. The TM view's host and the
   * first element in it are kept by the case and asked for again: a pane built again from the workspace empties its
   * host and fills it with other elements.
   */
  it('keeps a view alive off the page: the element that comes back is the one that left', async () => {
    const before = host('tm-0')
    const inner = before?.firstElementChild
    expect(inner, 'the TM view has nothing in it to recognise').not.toBeNull()
    await press('tm')
    expect(host('tm-0')).toBeNull()
    expect(before?.isConnected).toBe(false)
    await press('tm')
    await focusInPage('a press on the TM toggle, which shows its view')
    expect(host('tm-0'), 'another host came back').toBe(before)
    expect(host('tm-0')?.firstElementChild, 'the view was built again while it was off the page').toBe(inner)
  })

  /**
   * A REBUILD DETACHES EVERY HOST, AND A DETACHED ELEMENT COMES BACK SCROLLED TO ITS START (spec §5.2). Measured
   * before `pane-host.ts` held the positions: this table, at 120 px, was at 0 after the ASM toggle was pressed. So the
   * first half of this case is about a view that never leaves the page, and fails without the hold as the second does.
   */
  it('keeps where a view was scrolled to, through another view’s toggle and through its own', async () => {
    const table = (): HTMLElement => host('tm-0')?.querySelector('.state-table') as HTMLElement
    expect(table().scrollHeight - table().clientHeight, 'precondition: the rule table scrolls').toBeGreaterThan(200)
    table().scrollTop = 120
    table().dispatchEvent(new Event('scroll'))
    await until(() => table().scrollTop === 120, 'the table to hold its scroll')
    await press('asm')
    expect(table().scrollTop, 'another view’s toggle reset the table').toBe(120)
    await press('asm')
    expect(table().scrollTop, 'another view’s toggle reset the table on the way back').toBe(120)
    await press('tm')
    expect(host('tm-0')).toBeNull()
    await press('tm')
    expect(table().scrollTop, 'the table came back at its start').toBe(120)
    table().scrollTop = 0
    table().dispatchEvent(new Event('scroll'))
  })

  it('shows a pair side by side the first time it is visited', async () => {
    await press('lambda')
    await press('asm')
    expect(mounted()).toEqual(['source', 'tm-0'])
    const source = (host('source') as HTMLElement).getBoundingClientRect()
    const tm = (host('tm-0') as HTMLElement).getBoundingClientRect()
    expect(Math.abs(source.top - tm.top)).toBeLessThan(1)
    expect(source.right).toBeLessThanOrEqual(tm.left)
    expect(Math.abs(source.width - tm.width)).toBeLessThan(1)
    expect(live()).toBe('showing source and TM')
  })

  it('disables the last toggle pressed, with its reason, and enables it when another view is shown', async () => {
    expect(pressed(), 'precondition: the source and TM views').toEqual(['source', 'tm'])
    await press('source')
    expect(pressed()).toEqual(['tm'])
    expect(mounted()).toEqual(['tm-0'])
    const last = toggle('tm')
    // BY `aria-disabled`, SO THAT IT CAN HOLD THE FOCUS (`app-header.ts`'s `viewToggles`): the attribute would drop it.
    expect(last.getAttribute('aria-disabled')).toBe('true')
    expect(last.disabled).toBe(false)
    expect(last.getAttribute('aria-pressed'), 'the one view shown reads as not shown').toBe('true')
    expect(last.title).toBe('the TM view is the only one shown — one view stays')
    expect(last.getAttribute('aria-description')).toBe(last.title)
    expect([toggle('source'), toggle('lambda'), toggle('asm')].every((b) => !b.hasAttribute('aria-disabled'))).toBe(
      true,
    )
    await press('source')
    expect(toggle('tm').hasAttribute('aria-disabled')).toBe(false)
    expect(toggle('tm').title).toBe('hide the TM view')
    expect(toggle('tm').hasAttribute('aria-description')).toBe(false)
  })

  /** Spec §4.3's second property, through the page: the tree before a `✕` is what the closed kind's toggle shows. */
  it('shows the tree before a ✕ when the closed kind’s toggle is pressed', async () => {
    await press('lambda')
    expect(mounted(), 'precondition: source, λ and TM').toEqual(['source', 'lambda-0', 'tm-0'])
    const three = stored().tree
    const pairBefore = stored().arrangements?.['source+tm']
    expect(pairBefore, 'precondition: the pair is remembered').toBeDefined()
    await userEvent.click(document.querySelector('[data-leaf="lambda-0"] button.view-close') as HTMLElement)
    expect(mounted()).toEqual(['source', 'tm-0'])
    expect(pressed(), 'a ✕ on a kind’s last view did not unpress its toggle').toEqual(['source', 'tm'])
    expect(stored().arrangements?.['source+lambda+tm']).toEqual(three)
    expect(stored().arrangements?.['source+tm'], 'the pair on screen is still remembered beside itself').toBeUndefined()
    expect(document.activeElement, 'the ✕ stranded the focus').not.toBe(document.body)
    await press('lambda')
    expect(stored().tree).toEqual(three)
  })

  /**
   * Spec §4.7: a link carries the arrangement on screen and no other. **THE PAYLOAD IS READ RAW**, not through
   * `decodeLink`, which drops a link's arrangements as it reads it and so answers `arrangements: {}` for a link that
   * carried some as for one that carried none.
   */
  it('makes a link that carries the arrangement on screen and none of the ones it remembers', async () => {
    expect(Object.keys(stored().arrangements ?? {}).length, 'precondition: something is remembered').toBeGreaterThan(0)
    await userEvent.click(document.querySelector('#share') as HTMLElement)
    const field = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('#share-menu #share-link')
    await until(() => (field()?.value ?? '') !== '', 'the link')
    const fragment = (field()?.value ?? '').split('#s=')[1] ?? ''
    const bytes = Uint8Array.from(atob(fragment.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))
    const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const payload = JSON.parse(await new Response(inflated).text()) as { workspace: string }
    const carried = JSON.parse(payload.workspace) as Stored
    expect(carried.tree).toEqual(stored().tree)
    expect('arrangements' in carried, 'the link carries remembered arrangements').toBe(false)
    await userEvent.keyboard('{Escape}')
    const menu = document.querySelector<HTMLElement>('#share-menu')
    if (menu?.matches(':popover-open')) menu.hidePopover()
  })

  it('chooses the tabs in Stage, and keeps the choice when tiles come back', async () => {
    expect(mounted(), 'precondition: source, λ and TM').toEqual(['source', 'lambda-0', 'tm-0'])
    await pick('[data-preset="stage"]')
    expect(tabs()).toEqual(['source', 'lambda-0', 'tm-0'])
    await press('lambda')
    expect(tabs()).toEqual(['source', 'tm-0'])
    expect(mounted().length, 'the stage mounts more than one view').toBe(1)
    expect(document.activeElement).toBe(toggle('lambda'))
    await pick('[data-preset="explorer"]')
    expect(mounted()).toEqual(['source', 'tm-0'])
  })

  it('forgets every arrangement on reset preset, and is back on the source beside the TM view', async () => {
    // FROM THREE VIEWS, SO THE TWO ARE THE RESET'S: the case above left the page on the source beside the TM view, and
    // from there this passed with a reset that left the tree alone.
    await press('lambda')
    expect(mounted(), 'precondition: more views than the reset leaves').toEqual(['source', 'lambda-0', 'tm-0'])
    expect(Object.keys(stored().arrangements ?? {}).length, 'precondition: something is remembered').toBeGreaterThan(0)
    await pick('#reset-preset')
    expect(mounted()).toEqual(['source', 'tm-0'])
    expect(pressed()).toEqual(['source', 'tm'])
    expect(stored().arrangements).toBeUndefined()
    expect(notice()).toContain('the default views are back')
    // AND A TOGGLE PRESSED NEXT SHOWS THAT COMBINATION'S DEFAULT: the four views in two columns of two.
    await press('lambda')
    await press('asm')
    const area = (document.querySelector('#views') as HTMLElement).getBoundingClientRect()
    const sourceBox = (host('source') as HTMLElement).getBoundingClientRect()
    const asm = (host('asm-0') as HTMLElement).getBoundingClientRect()
    const lambda = (host('lambda-0') as HTMLElement).getBoundingClientRect()
    const tm = (host('tm-0') as HTMLElement).getBoundingClientRect()
    // TWO COLUMNS OF TWO: source over asm, beside λ over TM, so the document has them a column at a time.
    expect(mounted()).toEqual(['source', 'asm-0', 'lambda-0', 'tm-0'])
    expect(asm.top, 'the asm view is not under the source view').toBeGreaterThanOrEqual(sourceBox.bottom)
    expect(Math.abs(asm.left - sourceBox.left)).toBeLessThan(1)
    expect(tm.top, 'the TM view is not under the λ view').toBeGreaterThanOrEqual(lambda.bottom)
    expect(Math.abs(tm.left - lambda.left)).toBeLessThan(1)
    expect(sourceBox.right).toBeLessThanOrEqual(lambda.left)
    for (const view of [sourceBox, asm, lambda, tm])
      expect(view.width, 'a view runs the whole width').toBeLessThan(area.width * 0.6)
  })
})
