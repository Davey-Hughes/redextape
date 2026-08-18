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
  { id: 'scratch-1', label: 'scratch 1', paneCount: 2, term: '\\x. x', warm: true },
  { id: 'scratch-2', label: 'scratch 2', paneCount: 1, term: '\\y. y y', warm: true },
  { id: 'scratch-3', label: 'scratch 3', paneCount: 0, term: null, warm: true },
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
    bufferList(button, () => THREE, noop, noop, noop)
    button.click()
    expect(rowText()).toEqual(['scratch 1 — 2 panes', 'scratch 2 — 1 pane', 'scratch 3 — orphan'])
  })

  /**
   * **THE ROWS ARE TOLD APART BY THEIR TERMS, WHICH IS THE ONLY THING ABOUT THEM THAT CAN DIFFER.**
   * A `label` is `scratch N` from a counter and a `paneCount` is the same on every row at the cap — so
   * before `BufferRow.term` the list rendered eight identical rows under a refusal instructing the user
   * to choose one of them. Found by opening the list on a real page; this is that page's assertion.
   *
   * **THE `toEqual` BELOW IS WHAT ASSERTS THE DIFFERENCE, AND A SECOND LINE THAT COUNTED IT SEPARATELY
   * COULD NOT FAIL — whole-branch review before merge, finding 3c.** This paragraph read "ASSERTED AS
   * DISTINCT STRINGS RATHER THAN AGAINST A LITERAL LIST, because what the field buys is DIFFERENCE. A
   * test reading `toEqual([...])` passes just as well on a renderer that prints the same term three
   * times" — and the line it was written above was a `toEqual([...])`, of three literals that are
   * pairwise distinct. So the claim was false of the very assertion it sat on, and the
   * `expect(new Set(termText()).size).toBe(THREE.length)` it justified was dead: a renderer printing one
   * term three times fails the `toEqual` first, and nothing that passes the `toEqual` can fail the count.
   * The list literal is kept and the count is dropped, because the literal says everything the count did
   * and also says WHICH term belongs to which row — which is the fact `paneCount` and `label` cannot
   * supply and this field exists for.
   */
  it('shows each buffer’s own term, so two rows can be told apart', () => {
    bufferList(button, () => THREE, noop, noop, noop)
    button.click()
    expect(termText()).toEqual(['\\x. x', '\\y. y y', 'no term yet'])
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
    bufferList(button, () => THREE, noop, noop, noop)
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
      noop,
      noop,
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
    bufferList(button, () => THREE, noop, noop, noop)
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
    bufferList(button, () => THREE, noop, noop, noop)
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
    bufferList(button, () => THREE, noop, noop, noop)
    bufferList(second, () => [], noop, noop, noop)

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
    const list = bufferList(button, () => THREE, noop, noop, noop)
    list.update(3)
    expect(button.textContent).toBe('buffers 3 ▾')
    list.update(1)
    expect(button.textContent).toBe('buffers 1 ▾')
  })
})

/**
 * TEMPERATURE — design §4.2, and the reason this file's crash-site history matters here: `main.ts`'s
 * row builder used to call `legOf` unconditionally, an id `SessionRegistry.entryOf` throws for once a
 * buffer is cold. This is the control that MAKES a cold buffer reachable from the list at all, so it is
 * tested for the same two facts every other row fact gets — what it reads, and what a click reports —
 * plus the one fact unique to it: a cold row must read as ASLEEP rather than as a row with nothing to
 * show, which is a different claim from `BufferRow.term`'s "no term yet".
 *
 * A ROW OFFERS EXACTLY ONE OF `warm`/`cool`, NEVER BOTH AND NEVER NEITHER — `bufferRow`'s own comment
 * has the argument (`pane-chrome.ts`'s "added and removed, never disabled" idiom): there is no `cool`
 * for a buffer already cold and no `warm` for one already running, so offering the wrong one would be a
 * control a click could not honour.
 */
describe('bufferList: temperature', () => {
  const COLD: readonly BufferRow[] = [{ id: 'scratch-1', label: 'scratch 1', paneCount: 0, term: null, warm: false }]
  const WARM: readonly BufferRow[] = [{ id: 'scratch-1', label: 'scratch 1', paneCount: 1, term: '\\x. x', warm: true }]

  /**
   * A row's temperature control, reached by the ACCESSIBLE NAME that names its buffer and the action it
   * offers — mirroring `retire`'s own helper above and for the same reason, now that the control carries
   * one (5d-ii-d review, Finding 3: it shipped with none, so a screen-reader user at eight buffers heard
   * an indistinguishable column of `warm`/`cool` buttons). Found by text-and-position is exactly what
   * that gap made invisible — this file's own convention is the name, not the position.
   */
  const temperature = (action: 'warm' | 'cool', label: string): HTMLButtonElement | null =>
    bar.querySelector<HTMLButtonElement>(`button[aria-label="${action} ${label}"]`)

  const row = () => bar.querySelector<HTMLElement>('.buffer-row')

  it('a cold row offers warm and not cool', () => {
    bufferList(button, () => COLD, noop, noop, noop)
    button.click()
    expect(row()?.textContent).toContain('asleep')
    expect(temperature('warm', 'scratch 1')).not.toBeNull()
    expect(temperature('cool', 'scratch 1')).toBeNull()
  })

  it('a warm row offers cool and not warm', () => {
    bufferList(button, () => WARM, noop, noop, noop)
    button.click()
    expect(temperature('cool', 'scratch 1')).not.toBeNull()
    expect(temperature('warm', 'scratch 1')).toBeNull()
  })

  it('clicking warm reports the id and the temperature asked for', () => {
    const seen: [SessionId, boolean][] = []
    bufferList(
      button,
      () => COLD,
      noop,
      (id, warm) => seen.push([id, warm]),
      noop,
    )
    button.click()
    temperature('warm', 'scratch 1')?.click()
    expect(seen).toEqual([['scratch-1', true]])
  })

  /**
   * THE OTHER DIRECTION (5d-ii-d review, Finding 5). Only `warm → true` was asserted above, which an
   * implementation that hardcoded `onTemperature(row.id, true)` would also pass — every row in that test
   * is cold, so the callback's second argument was never exercised against a fixture where the correct
   * answer is `false`. This pins `!row.warm` rather than a constant, against a WARM fixture.
   */
  it('clicking cool reports the id and false', () => {
    const seen: [SessionId, boolean][] = []
    bufferList(
      button,
      () => WARM,
      noop,
      (id, warm) => seen.push([id, warm]),
      noop,
    )
    button.click()
    temperature('cool', 'scratch 1')?.click()
    expect(seen).toEqual([['scratch-1', false]])
  })

  // A COLD BUFFER HAS NO SESSION, so a row must not claim it holds a term it cannot read.
  it('a cold row says it is asleep rather than showing no term', () => {
    bufferList(button, () => COLD, noop, noop, noop)
    button.click()
    expect(row()?.textContent).not.toContain('no term')
  })

  /**
   * **THE STRANDED-FOCUS REGRESSION (5d-ii-d review round 2, Finding 1).** `rebuildRows`'s
   * `replaceChildren` throws away the very button the click landed on, and unlike `retire` — which
   * calls `hidePopover()` first and gets focus handed back to the invoker by the popover's own hide
   * algorithm — a temperature click never closes the popover, so nothing puts focus anywhere in its
   * place. Left unfixed, `document.activeElement` here is `<body>`, still inside a popover that is
   * still open: the deferred-accessibility list's item 1, "a control that hides itself on click strands
   * the keyboard," reached by a rebuild instead of a hide.
   *
   * **THE FIXTURE REORDERS ON EVERY CLICK, WHICH IS WHAT MAKES THIS A MATCH-BY-`id` TEST AND NOT A
   * MATCH-BY-POSITION ONE.** `scratch 2` is clicked while it sits second; the handler below then
   * reverses the list, so the rebuilt row for `scratch 2` lands FIRST. An implementation that re-focused
   * "whatever is now at the clicked index" would land on `scratch 1`'s control instead — this is the
   * case that catches it.
   *
   * ASSERTED BY ACCESSIBLE NAME, so the same assertion also pins that the label flipped: cooling
   * `scratch 2` turns its control from `cool scratch 2` into `warm scratch 2`, and the control focus
   * lands on has to be the one now reading that flipped state, not a stale one still reading `cool`.
   */
  it('keeps focus on the same buffer’s temperature control after the rebuild, not <body>', () => {
    const rows: readonly BufferRow[] = [
      { id: 'scratch-1', label: 'scratch 1', paneCount: 1, term: '\\x. x', warm: true },
      { id: 'scratch-2', label: 'scratch 2', paneCount: 1, term: '\\y. y', warm: true },
    ]
    let live = rows
    bufferList(
      button,
      () => live,
      noop,
      (id, warm) => {
        const updated = live.map((r) => (r.id === id ? { ...r, warm } : r))
        live = [...updated].reverse()
      },
      noop,
    )

    button.click()
    temperature('cool', 'scratch 2')?.click()

    const active = document.activeElement
    expect(active).not.toBe(document.body)
    expect(menu()?.contains(active)).toBe(true)
    expect(active?.getAttribute('aria-label')).toBe('warm scratch 2')
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
    bufferList(button, () => THREE, noop, noop, noop)
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
