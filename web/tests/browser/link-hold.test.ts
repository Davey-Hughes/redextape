import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { RECORD_CHUNK } from '../../src/protocol'
import { SHELL, until } from './harness'

/**
 * A link's scroll hold through the whole app (Plan 7 part 5 spec, amendment 21), where `virtual-grid.test.ts` holds it
 * on a grid alone: a view shown after a link made in another opens on the pin and follows once the run moves, and so
 * does one that missed the compile before the link; a pin cleared from another view gives both grids back to
 * following; a click in the asm listing leaves the listing's own scroll alone; and a panel closed while a pin is made
 * or cleared shows that pin, or follows, when it reopens.
 *
 * **"IN VIEW" IS READ OFF THE BOX'S GEOMETRY, NOT OFF THE DOM.** A grid draws `OVERSCAN` rows past each edge of its
 * box, so a row can be in the DOM and off the screen; each check here asks whether the row's middle is inside the box.
 */

/**
 * `app.test.ts`'s `BIG`: its rule table is 25,852 rows and its listing 123, both far longer than a box shows. The pin
 * is `fold`'s `f(acc, head(xs))`, a call through a closure, which owns 664 of the machine's states and the instructions
 * pc73–pc77 — listing rows 87 to 91, far from pc0 at the top and from pc16, row 20, where one step from there lands.
 */
const BIG = `fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }
fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }
fn add(a, b) { a + b }
fn add1(x) { x + 1 }
fold([3, 1, 2].map(add1), 0, add)`
/** On the call's `(`, which no narrower child span covers, so it resolves to the call itself. */
const PIN = BIG.indexOf('f(acc, head(xs))') + 1
/** The newline that ends `map`'s line: no construct's span holds it, so a link there pins nothing. */
const NOWHERE = BIG.indexOf('\n')
/**
 * On `add`'s `+`: `a + b`, which owns the states at rule-table rows 144 to 146 and one instruction, at listing row 62 —
 * clear of the pin's blocks, of the top of either grid, and of where either run is when the cases below use it.
 */
const OTHER = BIG.indexOf('a + b') + 2

type Grid = 'tm-0' | 'asm-0'

let view: EditorView

const host = (leaf: string) => document.querySelector<HTMLElement>(`.pane[data-leaf="${leaf}"]`)
const box = (leaf: Grid) =>
  host(leaf)?.querySelector<HTMLElement>(leaf === 'tm-0' ? '.state-table' : '.asm-listing') ?? null
const LINKED: Record<Grid, string> = { 'tm-0': '.state-row.is-linked', 'asm-0': '.asm-row.is-linked' }
/** The row following keeps in view: the TM view's current state, the asm view's instruction about to run. */
const CURRENT: Record<Grid, string> = { 'tm-0': '.state-row.is-current', 'asm-0': '.asm-row.is-next' }
/** Whether `el`'s middle is inside `b`, the grid box that draws it. */
function within(b: HTMLElement, el: HTMLElement): boolean {
  const r = b.getBoundingClientRect()
  const e = el.getBoundingClientRect()
  const middle = (e.top + e.bottom) / 2
  return middle > r.top && middle < r.bottom
}
/** Whether a row matching `sel` has its middle inside `leaf`'s grid box. */
function inView(leaf: Grid, sel: string): boolean {
  const b = box(leaf)
  return b !== null && [...b.querySelectorAll<HTMLElement>(sel)].some((el) => within(b, el))
}
const reattach = (leaf: Grid) => host(leaf)?.querySelector<HTMLButtonElement>('.table-reattach') ?? null
/** The toggle of the panel each grid sits in: the TM view's rules, the asm view's listing. */
const toggle = (leaf: Grid) =>
  host(leaf)?.querySelector<HTMLButtonElement>(
    `[data-panel="${leaf === 'tm-0' ? 'rules' : 'listing'}"] .panel-toggle`,
  ) ?? null
const control = (leaf: string, label: string) =>
  [...(host(leaf)?.querySelectorAll<HTMLButtonElement>('.controls button') ?? [])].find((b) => b.textContent === label)
const stepOf = (leaf: string) => host(leaf)?.querySelector('.step')?.textContent ?? ''
const linkedSource = () => document.querySelector('.cm-editor .linked')?.textContent ?? null
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

/**
 * **THE SOURCE WORKER'S `compiled` REPLIES, AND ITS `tm-frames` REPLIES SINCE THE LAST, COUNTED**, by wrapping
 * `Worker`'s own `addEventListener` before the app mounts, as `share-positions.test.ts` and
 * `readout-history-held.test.ts` do. With the TM view off the page nothing on it shows the TM leg recording, and the
 * worker's replies are what still counts it; this file makes no copy, so every worker reply is the program's. A reply
 * is counted after the app's listener has taken it in.
 */
let compiles = 0
let tmReplies = 0
const listen = Worker.prototype.addEventListener
Worker.prototype.addEventListener = function (
  this: Worker,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  const counted =
    type === 'message' && typeof listener === 'function'
      ? (e: Event) => {
          listener.call(this, e)
          const kind = ((e as MessageEvent).data as { kind?: unknown } | undefined)?.kind
          if (kind === 'compiled') {
            compiles += 1
            tmReplies = 0
          } else if (kind === 'tm-frames') {
            tmReplies += 1
          }
        }
      : listener
  listen.call(this, type, counted, options)
}
afterAll(() => {
  Worker.prototype.addEventListener = listen
})

/**
 * How many `tm-frames` replies the worker posts for `BIG`: its TM leg records 78,459 frames before its history fills at
 * step 78,458, `RECORD_CHUNK` to a reply. 307.
 */
const BIG_TM_REPLIES = Math.ceil(78_459 / RECORD_CHUNK)

/**
 * **A RECOMPILE OF `BIG` WITH ITS TM VIEW OFF THE PAGE, IN THREE WAITS COUNTED ON THE WORKER'S REPLIES**: the TM leg
 * starting to record, its recording half way, then the run's end, as the mount's three on the TM step line. As one
 * wait this took 5,111 to 6,387 ms at `CPUQuota=25%` and 9,296 and 10,009 ms at 15 % (2026-10-05 and 06), against
 * `until`'s 10 s. `edit` is the dispatch. The compile is claimed at the dispatch and answers after a debounce, which
 * the first two assertions hold, and each count is taken only once this compile's own `compiled` has been heard, which
 * the third holds, so no wait can pass on the run before.
 */
async function recompilesOffPage(edit: () => void): Promise<void> {
  const before = compiles
  edit()
  expect(idle(), 'precondition: the compile is claimed').toBe(false)
  expect(compiles, 'precondition: the compile has not answered').toBe(before)
  const recording = (replies: number) => (compiles > before && tmReplies >= replies) || idle()
  await until(() => recording(1), 'the TM leg to start recording, by its worker’s replies')
  expect(compiles > before || idle(), 'precondition: the replies counted are this compile’s').toBe(true)
  await until(
    () => recording(BIG_TM_REPLIES / 2),
    'the TM leg to be half way to a full history, by its worker’s replies',
  )
  await until(idle, 'the compile to finish')
}
const tab = (leaf: string) => document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`)
const pick = (sel: string): void => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
  const m = document.querySelector<HTMLElement>('#workspace-menu')
  if (m?.matches(':popover-open')) m.hidePopover()
}

/** Link the source construct at `pos`, as `Mod-'` does. */
function linkAt(pos: number): void {
  view.dispatch({ selection: { anchor: pos } })
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: "'", ctrlKey: true, cancelable: true }))
}

/**
 * Let a draw's own scroll come back and redraw the box, or a second pass without one: the hold under test has to
 * survive that redraw, which comes a frame or more after the draw that wrote the scroll.
 */
function settle(el: HTMLElement | null): Promise<void> {
  return new Promise<void>((r) => {
    el?.addEventListener('scroll', () => requestAnimationFrame(() => r()), { once: true })
    setTimeout(r, 1_000)
  })
}

/**
 * Split `leaf` into a second view of the same kind and session — "another view of this" in its `⋯` menu, the
 * gesture `layout-app.test.ts`'s `splitRow` names. Only runs in tiles: `draw.ts` refuses a split in Stage.
 */
function splitRow(leaf: string): void {
  const more = host(leaf)?.querySelector<HTMLButtonElement>('button.view-more')
  if (more === null || more === undefined) throw new Error(`no view menu on ${leaf}`)
  more.click()
  const menu = document.getElementById(more.getAttribute('aria-controls') ?? '')
  menu?.querySelector<HTMLButtonElement>('button.view-split[data-dir="row"]')?.click()
  menu?.querySelector<HTMLButtonElement>('.view-menu-pairs button[data-same]')?.click()
}

/** Every leaf on the page right now, by `data-leaf` — read before and after a split to find the one it added. */
const leafIds = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[data-leaf]')].flatMap((e) =>
    e.dataset.leaf === undefined ? [] : [e.dataset.leaf],
  )

/** The TM rule table inside an arbitrary leaf — `box`'s sibling for a leaf the `Grid` type does not name. */
const stateBox = (leaf: string) => host(leaf)?.querySelector<HTMLElement>('.state-table') ?? null

/**
 * Put both runs where one step moves the row each grid follows well away from the pin: the TM head one step back from
 * where recording left it, so `▶` walks the history rather than asking for more, and the asm run at its start.
 */
async function park(): Promise<void> {
  const tmStep = stepOf('tm-0')
  control('tm-0', '◀')?.click()
  await until(() => stepOf('tm-0') !== tmStep, 'the TM view to step back')
  control('asm-0', '↺')?.click()
  await until(() => stepOf('asm-0').startsWith('step 0 of'), 'the asm view to restart')
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: BIG } })
  await until(() => !idle(), 'the compile to start')
  // THREE WAITS FOR ONE RUN: THE TM LEG STARTING TO RECORD, ITS RECORDING HALF WAY, THEN THE RUN'S END. `BIG`'s TM leg
  // records last and fills its history at step 78,458, and as one wait this took 9,506 ms at `CPUQuota=25%`
  // (2026-10-05), against `until`'s 10 s; as two, the second took up to 6,590 ms. Its step line reads `…` from its
  // first frames until it stops, and counts them; a line waiting on a compile drops the `…` (`controls.ts`).
  expect(stepOf('tm-0'), 'precondition: no TM recording under way before the compile').not.toContain('…')
  await until(() => stepOf('tm-0').includes('…') || idle(), 'the TM leg to start recording')
  expect(stepOf('tm-0'), 'precondition: the TM line counts this compile’s run').not.toContain('— recompiling')
  await until(
    () => Number(/of ([\d,]+)/.exec(stepOf('tm-0'))?.[1]?.replaceAll(',', '') ?? 0) >= 39_000 || idle(),
    'the TM leg to be half way to a full history',
  )
  await until(idle, 'the compile to finish')
  await until(() => box('asm-0')?.getAttribute('aria-rowcount') === '123', 'the asm listing')
  await until(() => box('tm-0')?.getAttribute('aria-rowcount') === '25852', 'the rule table')
})

describe('a view the stage shows after a link made in another', () => {
  /**
   * EVERY LINK IN THE STAGE REACHES A VIEW OFF THE PAGE: the one linked from is the one shown. The view's grid is told
   * the link with its box unrendered, and the run is at rest, so the frame it shows when it comes back is the one it
   * showed when it left. It opens on the pin, still following, and one step brings following back.
   */
  it('opens the TM view on the pin, following, and follows the machine once it moves', async () => {
    await park()
    pick('[data-switch="views"][data-value="stage"]')
    tab('source')?.click()
    await until(() => host('tm-0') === null && host('asm-0') === null, 'the TM and asm views to leave the page')
    linkAt(PIN)
    await until(() => linkedSource() === 'f(acc, head(xs))', 'the source to show the pin')

    // THE ECHO IS LISTENED FOR RIGHT AFTER THE CLICK, which shows the view and draws it in one synchronous turn: the
    // box is off the page until then, and the draw's scroll event comes at the next rendering update.
    tab('tm-0')?.click()
    await settle(box('tm-0'))
    expect(inView('tm-0', LINKED['tm-0']), "the pin's states are on screen").toBe(true)
    expect(reattach('tm-0')?.hidden, 'following is still on').toBe(true)
    expect(inView('tm-0', CURRENT['tm-0']), 'the precondition: the current state is off screen').toBe(false)

    const at = stepOf('tm-0')
    control('tm-0', '▶')?.click()
    await until(() => stepOf('tm-0') !== at, 'one step')
    expect(inView('tm-0', CURRENT['tm-0']), 'the table follows the machine again').toBe(true)
  })

  it('opens the asm view on the pin, following, and follows the run once it moves', async () => {
    tab('asm-0')?.click()
    await settle(box('asm-0'))
    expect(inView('asm-0', LINKED['asm-0']), "the pin's instructions are on screen").toBe(true)
    expect(reattach('asm-0')?.hidden, 'following is still on').toBe(true)
    expect(inView('asm-0', CURRENT['asm-0']), 'the precondition: the instruction about to run is off screen').toBe(
      false,
    )

    control('asm-0', '▶')?.click()
    await until(() => stepOf('asm-0').startsWith('step 1 of'), 'one step')
    expect(inView('asm-0', CURRENT['asm-0']), 'the listing follows the run again').toBe(true)
    pick('[data-switch="views"][data-value="tiles"]')
  })
})

describe('a pin cleared from another view', () => {
  /**
   * A LINK'S HOLD ENDS WHEN THE PIN DOES. A click where no construct is leaves no block to show, and a grid still held
   * on the old block — no longer marked, following on, no re-attach offered — would stay there until the run moved,
   * or for good once it had ended.
   */
  it('gives the rule table and the listing back to following', async () => {
    await until(() => host('tm-0') !== null && host('asm-0') !== null, 'the tiles to show every view')
    await park()
    linkAt(NOWHERE)
    await until(() => linkedSource() === null, 'the pin the stage cases made to clear')
    await until(() => inView('tm-0', CURRENT['tm-0']) && inView('asm-0', CURRENT['asm-0']), 'both grids to follow')

    const tmEcho = settle(box('tm-0'))
    const asmEcho = settle(box('asm-0'))
    linkAt(PIN)
    await until(() => linkedSource() === 'f(acc, head(xs))', 'the source to show the pin')
    await tmEcho
    await asmEcho
    for (const leaf of ['tm-0', 'asm-0'] as const) {
      expect(inView(leaf, LINKED[leaf]), `${leaf}: the link scrolled to its rows`).toBe(true)
      expect(inView(leaf, CURRENT[leaf]), `${leaf}: the precondition: the row it follows is off screen`).toBe(false)
    }

    linkAt(NOWHERE)
    await until(() => linkedSource() === null, 'the pin to clear')
    await until(() => inView('tm-0', CURRENT['tm-0']), 'the rule table to follow the machine again')
    await until(() => inView('asm-0', CURRENT['asm-0']), 'the listing to follow the run again')
    expect(reattach('tm-0')?.hidden).toBe(true)
    expect(reattach('asm-0')?.hidden).toBe(true)
  })
})

describe('a pin made while the panel is closed', () => {
  /**
   * A CLOSED PANEL'S GRID IS TOLD THE PIN AS A VIEW OFF THE PAGE IS, and shows it when the panel reopens. Refusing the
   * pin there left the previous link's hold in place, and with the run at rest the reopened grid stayed on that
   * link's block: neither the new pin nor the run, following on, nothing offered to re-attach.
   */
  it('shows the new pin when the rules and listing panels reopen', async () => {
    await until(() => host('tm-0') !== null && host('asm-0') !== null, 'the tiles to show every view')
    const tmEcho = settle(box('tm-0'))
    const asmEcho = settle(box('asm-0'))
    linkAt(PIN)
    await until(() => linkedSource() === 'f(acc, head(xs))', 'the source to show the pin')
    await tmEcho
    await asmEcho
    for (const leaf of ['tm-0', 'asm-0'] as const) {
      expect(inView(leaf, LINKED[leaf]), `${leaf}: the first link holds the box on its rows`).toBe(true)
      toggle(leaf)?.click()
      expect(box(leaf)?.hidden, `${leaf}: the precondition: the panel is closed`).toBe(true)
    }

    linkAt(OTHER)
    await until(() => linkedSource() === 'a + b', 'the source to show the new pin')
    const tmShown = settle(box('tm-0'))
    const asmShown = settle(box('asm-0'))
    toggle('tm-0')?.click()
    toggle('asm-0')?.click()
    await tmShown
    await asmShown
    for (const leaf of ['tm-0', 'asm-0'] as const) {
      expect(inView(leaf, LINKED[leaf]), `${leaf}: the new pin's rows are on screen`).toBe(true)
      expect(reattach(leaf)?.hidden, `${leaf}: following is still on`).toBe(true)
      expect(inView(leaf, CURRENT[leaf]), `${leaf}: the precondition: the row it follows is off screen`).toBe(false)
    }
  })

  /** A pin cleared while the panel is closed releases the hold as it does on screen, and the reopened grid follows. */
  it('follows again when the panels reopen after the pin was cleared behind them', async () => {
    const tmEcho = settle(box('tm-0'))
    const asmEcho = settle(box('asm-0'))
    linkAt(PIN)
    await until(() => linkedSource() === 'f(acc, head(xs))', 'the source to show the pin')
    await tmEcho
    await asmEcho
    for (const leaf of ['tm-0', 'asm-0'] as const) {
      expect(inView(leaf, CURRENT[leaf]), `${leaf}: the precondition: the link holds the box off the run`).toBe(false)
      toggle(leaf)?.click()
      expect(box(leaf)?.hidden, `${leaf}: the precondition: the panel is closed`).toBe(true)
    }

    linkAt(NOWHERE)
    await until(() => linkedSource() === null, 'the pin to clear')
    toggle('tm-0')?.click()
    toggle('asm-0')?.click()
    await until(() => inView('tm-0', CURRENT['tm-0']), 'the rule table to follow the machine again')
    await until(() => inView('asm-0', CURRENT['asm-0']), 'the listing to follow the run again')
    expect(reattach('tm-0')?.hidden).toBe(true)
    expect(reattach('asm-0')?.hidden).toBe(true)
  })
})

describe('a click in the asm listing', () => {
  /**
   * THE LISTING CLICKED IN DOES NOT SCROLL (spec §6.6): the construct it pins can own instructions far from the one
   * under the pointer, and scrolling to them would move that row out from under it. `fn map`'s `ret`, pc39 at row 46,
   * belongs to the definition, which owns pc16 at row 20 too.
   */
  it('marks the construct without moving the listing it was made in', async () => {
    const listing = box('asm-0') as HTMLElement
    // THE USER'S SCROLL, WITH ITS EVENT DISPATCHED AT ONCE rather than at the next rendering update, as `app.test.ts`'s
    // scroll cases do: a draw landing in between — a λ tree coming back — would follow the run straight back to pc0.
    listing.scrollTop = 40 * 24
    listing.dispatchEvent(new Event('scroll'))
    const ret = () =>
      [...listing.querySelectorAll<HTMLElement>('.asm-row')].find(
        (r) => r.querySelector('.asm-pc')?.textContent === 'pc39',
      )
    await until(() => ret() !== undefined && within(listing, ret() as HTMLElement), 'pc39 to be on screen')
    const before = listing.scrollTop
    const echo = settle(listing)
    await userEvent.click(ret() as HTMLElement)
    await until(() => linkedSource() !== null, 'the click to pin the definition')
    await echo
    expect(listing.scrollTop, 'the listing stays where it was clicked').toBe(before)

    // THE PRECONDITION, READ AFTER: the construct owns an instruction a scroll to its first would have gone to.
    listing.scrollTop = 0
    listing.dispatchEvent(new Event('scroll'))
    const jmp = () =>
      [...listing.querySelectorAll<HTMLElement>('.asm-row.is-linked')].find(
        (r) => r.querySelector('.asm-pc')?.textContent === 'pc16',
      )
    await until(() => jmp() !== undefined, 'pc16, row 20, to be marked as the same construct')
  })
})

describe('a view that missed the last compile', () => {
  /**
   * IN THE STAGE AN EDIT COMPILES WITH EVERY OTHER VIEW OFF THE PAGE, and a view that missed a compile is given the
   * program when it is next shown, which drops the pin and any link row it held. It opens on the pin made since, as a
   * view that saw the compile does, and one step brings following back. The edit is a newline at the end: the same
   * program, compiled again.
   */
  it('opens the TM view on a pin made after the compile it missed, and follows once the machine moves', async () => {
    pick('[data-switch="views"][data-value="stage"]')
    tab('source')?.click()
    await until(() => host('tm-0') === null && host('asm-0') === null, 'the TM and asm views to leave the page')
    await recompilesOffPage(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '\n' } }))
    expect(host('tm-0') ?? host('asm-0'), 'the precondition: the compile landed with both views off the page').toBe(
      null,
    )
    linkAt(PIN)
    await until(() => linkedSource() === 'f(acc, head(xs))', 'the source to show the pin')

    tab('tm-0')?.click()
    await settle(box('tm-0'))
    expect(inView('tm-0', LINKED['tm-0']), "the pin's states are on screen").toBe(true)
    expect(reattach('tm-0')?.hidden, 'following is still on').toBe(true)
    expect(inView('tm-0', CURRENT['tm-0']), 'the precondition: the current state is off screen').toBe(false)

    // A STEP BACK: recording left the machine at its newest step, where `▶` asks for more history.
    const at = stepOf('tm-0')
    control('tm-0', '◀')?.click()
    await until(() => stepOf('tm-0') !== at, 'one step')
    expect(inView('tm-0', CURRENT['tm-0']), 'the table follows the machine again').toBe(true)
  })

  it('opens the asm view on the pin too, and follows once the run moves', async () => {
    tab('asm-0')?.click()
    await settle(box('asm-0'))
    expect(inView('asm-0', LINKED['asm-0']), "the pin's instructions are on screen").toBe(true)
    expect(reattach('asm-0')?.hidden, 'following is still on').toBe(true)
    expect(inView('asm-0', CURRENT['asm-0']), 'the precondition: the instruction about to run is off screen').toBe(
      false,
    )

    // A STEP BACK: the run ended where recording left it, and `▶` has nothing further to run.
    const at = stepOf('asm-0')
    control('asm-0', '◀')?.click()
    await until(() => stepOf('asm-0') !== at, 'one step')
    expect(inView('asm-0', CURRENT['asm-0']), 'the listing follows the run again').toBe(true)
    pick('[data-switch="views"][data-value="tiles"]')
  })
})

describe('a pin made in a second view of the same leg', () => {
  /**
   * THE SEED'S SAME-LEG BRANCH (`draw.ts`'s `linkWiring.link.origin !== 'tm'`): a view that missed the compile is
   * painted on reveal, but not scrolled, when the pin that reached it while it was away named ITS OWN leg — as a
   * pin made in a view that saw the compile only paints (`link-wiring.ts`'s fan-out). Reaching a `'tm'`-origin pin
   * needs a TM click, and the only way to click one while `tm-0` is off the page is a second TM view: Stage never
   * offers a split (`draw.ts`'s own refusal), so it is made first, in tiles.
   */
  it('paints the pin on reveal but leaves the view following, when a second TM view made it', async () => {
    await until(() => host('tm-0') !== null && host('asm-0') !== null, 'the tiles to show every view')
    linkAt(NOWHERE)
    await until(() => linkedSource() === null, 'the previous pin to clear')

    const before = leafIds()
    splitRow('tm-0')
    const added = leafIds().find((id) => !before.includes(id))
    if (added === undefined) throw new Error('the split did not add a leaf')

    pick('[data-switch="views"][data-value="stage"]')
    tab('source')?.click()
    await until(() => host('tm-0') === null && host(added) === null, 'both TM views to leave the page')

    // THE EDIT LANDS WITH BOTH TM VIEWS OFF THE PAGE, as the missed-compile cases above.
    await recompilesOffPage(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '\n' } }))
    expect(host('tm-0') ?? host(added), 'the precondition: the compile landed with both TM views off the page').toBe(
      null,
    )

    // LINKED WHILE THE SOURCE IS STILL THE PAGE'S ONE VIEW — `linkedSource()` reads the editor's own DOM, which
    // Stage detaches along with everything else once another tab is shown. This pin's origin is `'source'`, not
    // `'tm'` yet; it only gets `added` (still off the page, seeded below) onto the right rows to click.
    linkAt(PIN)
    await until(() => linkedSource() === 'f(acc, head(xs))', 'the source to show the pin')

    // `added` IS SHOWN NEXT, SEEDED BY THE SAME PATH THE MISSED-COMPILE CASES ABOVE EXERCISE: its seed re-applies
    // this `'source'`-origin pin WITH the scroll, so it opens already centred on the pin's rows. `tm-0` stays off
    // the page throughout.
    const addedEcho = settle(stateBox(added))
    tab(added)?.click()
    await addedEcho
    const linkedRow = () => stateBox(added)?.querySelector<HTMLElement>('.state-row.is-linked') ?? null
    await until(() => linkedRow() !== null, "the pin's rows to render in the second TM view")

    // THE CLICK, ON A ROW THE SOURCE'S OWN PIN JUST MARKED: its origin is `'tm'`, not `'source'`, so neither the
    // fan-out nor `tm-0`'s reveal seed below may scroll a view of the same leg to it. `linkedSource()` cannot
    // confirm it here — the source editor's own DOM is off the page along with `tm-0` while `added` is shown —
    // so the click is read off `added`'s own grid: the row it landed on redraws `is-active` once the click's
    // synchronous `draw()` runs.
    const clickEcho = settle(stateBox(added))
    await userEvent.click(linkedRow() as HTMLElement)
    const activeRow = () => stateBox(added)?.querySelector<HTMLElement>('.state-row.is-active') ?? null
    await until(() => activeRow() !== null && linkedRow() !== null, 'the click to land and keep the construct pinned')
    await clickEcho

    tab('tm-0')?.click()
    await settle(box('tm-0'))
    expect(
      inView('tm-0', CURRENT['tm-0']),
      'a same-leg pin does not scroll the reveal: the table still follows the machine',
    ).toBe(true)

    // THE PIN IS STILL PAINTED, READ BY NAVIGATING TO ITS KNOWN ROWS RATHER THAN BY ASSUMING THEY ARE ON SCREEN —
    // the same construct's rule-table rows, 198-208 (see "a pin made while the panel is closed" above).
    const tmBox = box('tm-0') as HTMLElement
    tmBox.scrollTop = 190 * 24
    tmBox.dispatchEvent(new Event('scroll'))
    await until(() => inView('tm-0', LINKED['tm-0']), "the pin's rows to be marked, once scrolled to")

    pick('[data-switch="views"][data-value="tiles"]')
  })
})
