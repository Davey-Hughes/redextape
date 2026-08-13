import { beforeEach, describe, expect, it } from 'vitest'
import type { BufferRow } from '../../src/buffer-list'
import { bufferList } from '../../src/buffer-list'
import type { SessionId } from '../../src/session-client'

/**
 * THE HEADER BUFFER LIST — the only surface that can reach a buffer no pane is showing.
 *
 * DRIVEN DIRECTLY RATHER THAN THROUGH A MOUNTED APP, the way `pane-layout-controls.test.ts` drives
 * `layoutControls`: every claim here is about the CONTROL — what a row reads, which row a click
 * retires, what the button announces, where the list lands — and none of them needs a session, a
 * worker or a layout tree to be true. What the app does with a retire is the registry's subject.
 *
 * `bufferList` TAKES A BUTTON RATHER THAN BUILDING ONE, so the fixture supplies the header and the
 * button in it; the list appends its own popover beside that button and nothing else is mounted.
 */

const noop = () => {}

let bar: HTMLElement
let button: HTMLButtonElement

beforeEach(() => {
  document.body.innerHTML = ''
  bar = document.createElement('header')
  document.body.append(bar)
  button = document.createElement('button')
  button.type = 'button'
  bar.append(button)
})

/**
 * THREE ROWS, AND THE MIDDLE ONE IS THE POINT. A one-row fixture is passed by a retire handler wired
 * to whichever row it captured first, so the discriminating test below aims at a row that is neither
 * the first nor the last. The third has no panes, which is the orphan case — the state that makes this
 * control exist at all, since no pane chrome can reach a buffer nothing is showing.
 *
 * **THE THREE TERMS DIFFER, AND THE THIRD IS `null`, WHICH IS THE OTHER AXIS THIS FIXTURE NOW CARRIES.**
 * `BufferRow.term` exists because eight rows on a real page read `scratch N — orphan` and nothing else;
 * a fixture whose rows all held the same term would reproduce exactly the defect the field was added to
 * fix while asserting that the field is rendered. The `null` row is a buffer whose fork has not answered
 * — the case the renderer must write a sentence for rather than leaving a blank line under a name.
 */
const THREE: readonly BufferRow[] = [
  { id: 'scratch-1', label: 'scratch 1', paneCount: 2, term: '\\x. x' },
  { id: 'scratch-2', label: 'scratch 2', paneCount: 1, term: '\\y. y y' },
  { id: 'scratch-3', label: 'scratch 3', paneCount: 0, term: null },
]

const menu = () => bar.querySelector<HTMLElement>('.buffer-list')

/** What each row READS, which is what §5 requires an assertion about a buffer to be made against. */
const rowText = () => [...bar.querySelectorAll<HTMLElement>('.buffer-row-name')].map((e) => e.textContent)

/** The second line of each row — the buffer's own term, or the sentence that stands in for one. */
const termText = () => [...bar.querySelectorAll<HTMLElement>('.buffer-row-term')].map((e) => e.textContent)

/**
 * A row's retire control, reached by the ACCESSIBLE NAME that names its buffer — not by index.
 * Position in the list is the fixture's own arrangement; the name is what a user aims at, and it is
 * the thing that has to differ per row for the control to be usable at all.
 */
const retire = (label: string) => bar.querySelector<HTMLButtonElement>(`button[aria-label="retire ${label}"]`)

describe('bufferList', () => {
  it('lists each buffer with its pane count, and marks an orphan', () => {
    bufferList(button, () => THREE, noop)
    button.click()
    expect(rowText()).toEqual(['scratch 1 — 2 panes', 'scratch 2 — 1 pane', 'scratch 3 — orphan'])
  })

  /**
   * **THE ROWS ARE TOLD APART BY THEIR TERMS, WHICH IS THE ONLY THING ABOUT THEM THAT CAN DIFFER.**
   * A `label` is `scratch N` from a counter and a `paneCount` is the same on every row at the cap — so
   * before `BufferRow.term` the list rendered eight identical rows under a refusal instructing the user
   * to choose one of them. Found by opening the list on a real page; this is that page's assertion.
   *
   * ASSERTED AS DISTINCT STRINGS RATHER THAN AGAINST A LITERAL LIST, because what the field buys is
   * DIFFERENCE. A test reading `toEqual([...])` passes just as well on a renderer that prints the same
   * term three times, which is the state being fixed.
   */
  it('shows each buffer’s own term, so two rows can be told apart', () => {
    bufferList(button, () => THREE, noop)
    button.click()
    expect(termText()).toEqual(['\\x. x', '\\y. y y', 'no term yet'])
    expect(new Set(termText()).size).toBe(THREE.length)
  })

  /**
   * **A BUFFER WITH NO TERM SAYS SO, RATHER THAN LEAVING A BLANK LINE UNDER ITS NAME.** That is a fork
   * the worker has not answered yet, or one whose build failed, and this row cannot tell those apart —
   * so the sentence claims neither. The class is what carries it to the stylesheet: this file chooses no
   * colour, and `.is-absent` is what makes prose look like prose beside a column of terms.
   *
   * THE `title` IS ASSERTED ON BOTH SIDES. A row whose term is truncated by CSS leaves a pointer user
   * with no way to read the rest, which the tooltip answers; a row with no term must NOT carry one, or
   * hovering it would produce an empty tooltip — a control reporting something it does not have.
   */
  it('marks a buffer with no term, and carries the full term as a title only when there is one', () => {
    bufferList(button, () => THREE, noop)
    button.click()
    const terms = [...bar.querySelectorAll<HTMLElement>('.buffer-row-term')]
    expect(terms.map((e) => e.classList.contains('is-absent'))).toEqual([false, false, true])
    expect(terms.map((e) => e.title)).toEqual(['\\x. x', '\\y. y y', ''])
  })

  /**
   * THE DISCRIMINATOR. A handler closed over the first row it built passes every one-row fixture, so
   * the click lands on the MIDDLE row and the assertion names its id.
   *
   * IT THEN RE-OPENS, which is the second half of the claim and the one that pins the list being built
   * on `beforetoggle`: the fixture's handler removes the retired buffer from the list it hands back, so
   * a list built once at construction would show the retired row again — a phantom the user cannot get
   * rid of, on the one surface that exists to get rid of things. The dismissal in between is asserted
   * rather than assumed, since it is what makes the second `click` an OPEN rather than a close.
   */
  it('retires the row that was clicked, not the first', () => {
    let live: readonly BufferRow[] = THREE
    const fired: SessionId[] = []
    bufferList(
      button,
      () => live,
      (id) => {
        fired.push(id)
        live = live.filter((r) => r.id !== id)
      },
    )

    button.click()
    retire('scratch 2')?.click()
    expect(fired).toEqual(['scratch-2'])
    expect(menu()?.matches(':popover-open')).toBe(false)

    button.click()
    expect(rowText()).toEqual(['scratch 1 — 2 panes', 'scratch 3 — orphan'])
  })

  /**
   * `aria-expanded` ON BOTH EDGES, AND STATED BEFORE THE FIRST ONE. A disclosure that only acquires the
   * attribute once it has been used announces itself as a plain button to the reader who most needs to
   * know it opens something; one that never clears it announces an open list over a closed one forever.
   * `hidePopover` is the edge light dismiss and Escape take — the same `beforetoggle` the browser fires
   * for them — which is why there is no separate test for those two paths.
   */
  it('opens on the button and keeps aria-expanded true while open', () => {
    bufferList(button, () => THREE, noop)
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')

    button.click()
    expect(menu()?.matches(':popover-open')).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('true')

    menu()?.hidePopover()
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  /**
   * THE KEYBOARD PATH. This is a RECLAMATION control with no other route to it — a buffer with no pane
   * has no chrome anywhere else — so a list a keyboard user could open but not step into would be an
   * inoperable escape rather than an awkward one.
   *
   * IT NAMES THE ROW FOCUS LANDED ON, not merely that focus is inside the list: `autofocus` on the
   * wrong row still puts focus in the menu, and a list that opens with the last row focused is a
   * different control from the one this describes.
   */
  it('moves focus into the list on open', () => {
    bufferList(button, () => THREE, noop)
    button.click()
    const active = document.activeElement
    expect(menu()?.contains(active)).toBe(true)
    expect(active?.getAttribute('aria-label')).toBe('retire scratch 1')
  })

  /**
   * **`aria-controls` NAMES THIS LIST AND NOT SOME OTHER ONE — the `listSeq` counter's whole stated
   * justification, which had a paragraph and no assertion.** Deleting the counter AND the attribute
   * failed nothing, so both were argued for and neither was pinned.
   *
   * TWO CALLS IN ONE DOCUMENT, which is exactly the state the counter exists for and the one this
   * function's signature does not rule out however singular the header bar is. A duplicated id fails
   * SILENTLY — `getElementById` answers whichever element the document holds first — so the claim is
   * written as "each button's `aria-controls` resolves to the popover beside THAT button", which is
   * false of the second list the moment the id is a constant.
   */
  it('gives each list its own id and points its own button at it', () => {
    const second = document.createElement('button')
    second.type = 'button'
    bar.append(second)
    bufferList(button, () => THREE, noop)
    bufferList(second, () => [], noop)

    const mine = button.getAttribute('aria-controls') ?? ''
    const theirs = second.getAttribute('aria-controls') ?? ''
    expect(mine).not.toBe('')
    expect(theirs).not.toBe(mine)
    expect(document.getElementById(mine)).toBe(button.nextElementSibling)
    expect(document.getElementById(theirs)).toBe(second.nextElementSibling)

    // AND AN EMPTY LIST OPENS RATHER THAN THROWING, which is a real state of this FUNCTION even though
    // `main.ts` withholds the button entirely at zero buffers: the `autofocus` line has no first row to
    // aim at, and a list that raised there would take its caller's gesture with it.
    second.click()
    expect(document.getElementById(theirs)?.querySelectorAll('.buffer-row').length).toBe(0)
  })

  /**
   * THE BUTTON'S OWN READOUT — design §4.2's `[buffers 3 ▾]`. Asserted across TWO calls with different
   * values, so a readout written once at construction and never refreshed cannot pass: a buffer count
   * that stops tracking is worse than none, since the header would go on advertising work that has
   * been retired.
   */
  it('names how many buffers there are on its own button', () => {
    const list = bufferList(button, () => THREE, noop)
    list.update(3)
    expect(button.textContent).toBe('buffers 3 ▾')
    list.update(1)
    expect(button.textContent).toBe('buffers 1 ▾')
  })
})

/**
 * WHERE THE LIST LANDS — geometry, because the split picker got exactly this wrong one slice ago in a
 * way no behavioural test could see, and this control is built on the same two CSS declarations.
 *
 * A `popover` IS `position: fixed; inset: 0` IN THE UA STYLESHEET. The `margin: 0` that stops it being
 * centred in the window also leaves `left: 0`/`right: 0` over-constrained against a definite width, so
 * a menu that says nothing about its own placement pins to the TOP-LEFT CORNER OF THE VIEWPORT rather
 * than appearing under the control that opened it. Every test above passes against that, because every
 * one of them asks what the list CONTAINS.
 *
 * THE FIXTURE MOVES THE HEADER AWAY FROM THE ORIGIN, which is the whole reason this test is not
 * vacuous: the header bar is at the top-left of the real page, and there a correctly-anchored list and
 * a corner-pinned one sit close enough that a "not at the origin" assertion passes for the wrong
 * reason. `tests/browser/setup.ts` loads `style.css` into the tester page, so these are the rules the
 * app ships rather than UA defaults.
 */
describe('bufferList: where the list opens', () => {
  it('opens against its own button rather than at the viewport origin', () => {
    bar.style.position = 'absolute'
    // **`left` WAS `100px` AND HAD TO COME IN, WHICH IS A FACT ABOUT THE LIST'S WIDTH RATHER THAN ABOUT
    // THIS TEST.** The rows carry the buffer's term now (`BufferRow.term`), so `.buffer-list` is
    // `min(26rem, 90vw)` instead of `14rem` — about 373px in this tier's 414px-wide tester page. At
    // `left: 100px` there is no inline placement that both fits on screen and shares an edge with the
    // invoker: 314px remain to the right of it and 116px to the left, so every `position-try-fallback`
    // overflows and the browser clamps to the viewport instead. That is the fallbacks working — the list
    // stays reachable — but it makes the edge-sharing claim below unsatisfiable rather than false.
    //
    // THE BLOCK AXIS IS WHAT THIS TEST DISCRIMINATES ON AND IT IS UNTOUCHED: `top: 150px` is what a
    // corner-pinned list cannot match, and the two assertions that exclude it are both about `top`.
    // `20px` is still off the inline origin by ten times the 2px tolerance below, so a list at `left: 0`
    // still fails `sharesEdge`.
    bar.style.left = '20px'
    bar.style.top = '150px'
    bufferList(button, () => THREE, noop)
    button.click()

    const list = menu()?.getBoundingClientRect() ?? new DOMRect()
    const invoker = button.getBoundingClientRect()

    // Below its own button, which the corner-pinned version cannot be: the button is 150px down.
    //
    // **BLOCK-AXIS STRICTNESS IS WHAT EXCLUDES CORNER-PINNING — DO NOT RELAX IT TO MATCH THE INLINE
    // PAIR BELOW.** These two lines cannot tolerate `flip-block` firing, which makes them dependent on
    // the tester viewport being tall enough that it does not; the inline pair below is deliberately
    // written to survive `flip-inline` for the opposite reason. That asymmetry is the discrimination:
    // a list pinned to the viewport's top-left corner sits ABOVE this button, and an assertion loose
    // enough to allow "above OR below" would pass for it. If a future viewport makes `flip-block` fire,
    // the fix is a taller fixture, not a weaker claim.
    expect(list.top).toBeGreaterThanOrEqual(invoker.bottom - 1)
    expect(list.top).toBeGreaterThan(100)
    // And aligned to one of its edges. WHICH edge is not asserted, because the tester viewport is
    // narrow enough that `flip-inline` legitimately fires for a list this wide and aligns the trailing
    // pair instead — the claim that holds under both tactics is the one the requirement makes.
    const sharesEdge = Math.abs(list.left - invoker.left) < 2 || Math.abs(list.right - invoker.right) < 2
    expect(sharesEdge).toBe(true)
    // On screen, which is what the fallbacks are for.
    expect(list.left).toBeGreaterThanOrEqual(0)
    expect(list.right).toBeLessThanOrEqual(window.innerWidth)
  })
})
