import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

const menu = (): HTMLElement => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  return document.querySelector<HTMLElement>('#workspace-menu') as HTMLElement
}
const pick = (sel: string): void => {
  menu().querySelector<HTMLButtonElement>(sel)?.click()
  const m = document.querySelector<HTMLElement>('#workspace-menu')
  if (m?.matches(':popover-open')) m.hidePopover()
}
const bar = (): HTMLElement => document.querySelector<HTMLElement>('#step-bar') as HTMLElement
const barTitle = (): string => bar().querySelector('.step-bar-title')?.textContent?.trim() ?? ''
const barStep = (): string => bar().querySelector('.step-bar-inner .step')?.textContent?.trim() ?? ''
const viewControls = (leaf: string): Element | null =>
  document.querySelector(`[data-leaf="${leaf}"] .view-steps .controls`)
const focusView = (leaf: string): void => {
  document
    .querySelector<HTMLElement>(`[data-leaf="${leaf}"]`)
    ?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
}

describe('the step bar', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    const view: EditorView = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  })

  it('is not on the page while the step controls are in each view', () => {
    expect(bar().hidden).toBe(true)
    expect(viewControls('lambda-0')).not.toBeNull()
  })

  it('takes the controls out of every view when the switch moves to one bar, and names what it drives', () => {
    pick('[data-switch="steps"][data-value="bar"]')
    expect(bar().hidden).toBe(false)
    expect(viewControls('lambda-0')).toBeNull()
    expect(viewControls('tm-0')).toBeNull()
    expect(barTitle()).toBe('λ · program')
  })

  it('follows the focused view', () => {
    focusView('tm-0')
    expect(barTitle()).toBe('TM · program')
  })

  // §8: the focused view is the SOURCE view, which cannot step — the bar keeps the last one that could.
  it('keeps the last view that could step when the source view takes the focus', () => {
    focusView('source')
    expect(barTitle()).toBe('TM · program')
    expect(barStep()).not.toBe('no view can step')
  })

  // `one step back`, NOT `one step forward`: a compiled `let x = 40; x + 2` sits AT its recorded
  // frontier, where `▶` means "record one more" and the readout does not move. Stepping back from the
  // frontier is the unambiguous gesture, and it is still evidence the bar drives the view it names —
  // the readout it moves is the one the title belongs to.
  it('steps the view it names', () => {
    focusView('lambda-0')
    const before = barStep()
    expect(before).toContain('step ')
    const termBefore = document.querySelector('[data-leaf="lambda-0"] .term')?.textContent ?? ''
    expect(termBefore, 'the λ view renders no term, so a change in it would prove nothing').not.toBe('')
    bar().querySelector<HTMLButtonElement>('button[aria-label="one step back"]')?.click()
    expect(barStep()).not.toBe(before)
    // **THE VIEW ITSELF MOVED, WHICH IS THE HALF THE BAR'S OWN READOUT CANNOT SHOW.** This line used to
    // assert the λ leaf merely exists, which every other case already relies on — it said nothing about
    // the bar driving the view its title names.
    expect(document.querySelector('[data-leaf="lambda-0"] .term')?.textContent ?? '').not.toBe(termBefore)
  })

  /**
   * **EVERY BUTTON ON THE BAR, NOT ONLY ONE.** The case above proves the bar drives the view it names by
   * stepping back once; coverage then showed `step-bar.ts` at 42.85% of its functions, because each of
   * the five handlers is a separate closure and four of them had never been clicked. A bar whose `↺` or
   * `⏵` went to the wrong view — or nowhere — would have shipped.
   *
   * `[continue]` IS THE ONE THAT IS NOT HERE: it exists only on a recording that stopped with more to
   * record, which needs a fixture that spends a step budget. `extend-focus-probe.test.ts` carries that
   * fixture and the cost of building it; the bar's own `extend` handler is the same one-line delegation
   * as the other four.
   */
  it('drives the target with every one of its buttons', async () => {
    const barButton = (name: string): HTMLButtonElement =>
      bar().querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) as HTMLButtonElement
    // THE BAR'S OWN READOUT, NOT THE VIEW'S — with the `steps` switch at `bar` the view has no step
    // slot at all, so a read of `[data-leaf=...] .step` comes back empty and every assertion below
    // would be comparing against nothing.
    const step = barStep

    barButton('back to the oldest kept step').click()
    expect(step()).toContain('step 0 ')
    barButton('one step forward').click()
    expect(step()).toContain('step 1 ')
    barButton('one step back').click()
    expect(step()).toContain('step 0 ')

    barButton('play').click()
    // THE BUTTON SHOWS ITS STATE (umbrella §4 rule 3), and the bar's copy is the same component.
    expect(barButton('pause'), 'the bar’s play button did not become pause').not.toBeNull()
    await until(() => !step().includes('step 0 '), 'the bar to step the view it names')
    barButton('pause').click()
    expect(barButton('play'), 'the bar’s pause button did not become play again').not.toBeNull()
  })

  // **SPEC §11's FOURTH RULE AT THIS CALL SITE, IN THE TWO HALVES `extend-focus-probe.test.ts`
  // ESTABLISHED FOR THE CONTINUE BUTTON** — and the answer comes out the same way, which is the finding
  // rather than a disappointment.
  //
  // HALF ONE — IS THE MECHANISM REAL? Removing a slot the focus is inside strands it on `<body>`, which
  // is the hazard `ViewHeader.setStepsShown`'s `handOff` exists to prevent.
  it('removing a view’s step slot under the focus would strand it on body', () => {
    pick('[data-switch="steps"][data-value="view"]')
    const forward = document.querySelector<HTMLButtonElement>(
      '[data-leaf="lambda-0"] .view-steps button[aria-label="one step forward"]',
    )
    expect(forward, 'the view has no step controls to stand on').not.toBeNull()
    forward?.focus()
    expect(document.activeElement).toBe(forward)
    const slot = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .view-steps') as HTMLElement
    const parent = slot.parentElement as HTMLElement
    const next = slot.nextElementSibling
    slot.remove()
    expect(document.activeElement).toBe(document.body)
    parent.insertBefore(slot, next)
  })

  // HALF TWO — CAN THE SWITCH GESTURE REACH IT? **No**, and for the reason that file already records
  // about the continue button: the only way to move the `steps` switch is through the workspace menu,
  // and opening a menu is itself a focus-bearing interaction somewhere else. At the instant the slot is
  // removed, the focus is on the menu item the user just clicked — never on the control being withdrawn.
  //
  // The `handOff` in `setStepsShown` therefore stays as defence against a future caller that moves the
  // switch without a menu (a share link, a keyboard shortcut), and its sabotage does NOT fire. That is
  // recorded as the finding it is, not adjusted until something goes red.
  it('leaves the focus on the gesture that flipped the switch, not in the view it emptied', () => {
    const forward = document.querySelector<HTMLButtonElement>(
      '[data-leaf="lambda-0"] .view-steps button[aria-label="one step forward"]',
    )
    expect(forward).not.toBeNull()
    forward?.focus()
    expect(document.activeElement).toBe(forward)
    pick('[data-switch="steps"][data-value="bar"]')
    expect(viewControls('lambda-0'), 'the slot was not removed, so this proves nothing').toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.querySelector('[data-leaf="lambda-0"]')?.contains(document.activeElement)).toBe(false)
    pick('[data-preset="explorer"]')
  })
})
