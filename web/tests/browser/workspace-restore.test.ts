import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, PRESETS, parseWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A STORED VERSION 2 WORKSPACE, THROUGH THE REAL APP** — Plan 7 part 2 spec §3. Seeded before `main.ts`
 * is imported, because `main()` runs once per page and reads storage once. The version 1 path is
 * `layout-restore.test.ts`'s, which seeds a version 1 layout and checks it comes back as version 2.
 */

beforeAll(async () => {
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({ ...defaultWorkspace(), speed: 250, focused: 'tm-0', panels: { 'tm-0': { rules: false } } }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

const rulesToggle = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>('[data-leaf="tm-0"] [data-panel="rules"] .panel-toggle')

describe('a restored workspace', () => {
  it('opens the TM view with its rules panel closed, as stored', () => {
    expect(rulesToggle()?.getAttribute('aria-expanded')).toBe('false')
  })

  /**
   * **ONE SPEED, IN EVERY VIEW THAT STEPS** — spec §8. The stored 250/s has to reach both views' selects,
   * which is the restore and the fan-out in one assertion: `main.ts`'s `setSpeed` draws so every step
   * control repaints, and `step-controls.ts` reads the workspace's speed on every update.
   */
  // **SCOPED TO `.view-steps`, WHERE IT USED TO SWEEP THE PAGE.** Part 2b's step bar is a second
  // `stepControls` instance (`step-bar.ts`), so a page-wide `.controls select.speed` now finds three —
  // and this case's own name says "every view that steps", which is the two. The bar's copy is asserted
  // on its own line below rather than dropped: one global speed means the bar shows it too (spec §8).
  it('shows the restored speed in every view that steps', () => {
    expect(
      [...document.querySelectorAll<HTMLSelectElement>('.view-steps .controls select.speed')].map((el) => el.value),
    ).toEqual(['250', '250'])
    expect(document.querySelector<HTMLSelectElement>('#step-bar select.speed')?.value).toBe('250')
  })

  it('changes the speed in every view at once', () => {
    const first = document.querySelector<HTMLSelectElement>('[data-leaf="lambda-0"] select.speed')
    if (first === null) throw new Error('no speed control on the λ view')
    first.value = '1000'
    first.dispatchEvent(new Event('change'))
    expect(document.querySelector<HTMLSelectElement>('[data-leaf="tm-0"] select.speed')?.value).toBe('1000')
    // THE BAR IS A STEP CONTROL ON THE PAGE TOO, so "every step control reflects a change at once"
    // (spec §8) includes it — even while the `steps` switch has it hidden.
    expect(document.querySelector<HTMLSelectElement>('#step-bar select.speed')?.value).toBe('1000')
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.speed).toBe(1000)
    // BACK TO WHAT WAS RESTORED — every test in this file reads one page, and the next one asserts the
    // stored speed is still the seeded 250.
    first.value = '250'
    first.dispatchEvent(new Event('change'))
  })

  it('keeps what it restored when it writes back', () => {
    const ws = parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))
    expect(ws?.speed).toBe(250)
    expect(ws?.switches).toEqual(PRESETS.explorer)
  })

  it('records a panel toggle against the view it happened in', () => {
    rulesToggle()?.click()
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.panels['tm-0']).toEqual({ rules: true })
  })

  /**
   * **A LEAF ID COMES BACK, AND ITS OLD PANEL STATE MUST NOT COME WITH IT.** `defaultLayout()` re-mints
   * `source`, `lambda-0` and `tm-0` as literals, so *reset preset* after closing the TM view hands the
   * id to a new view. Until `main.ts` normalised the workspace against the live tree, the write dropped
   * the closed view's panel state and MEMORY kept it — so this same sequence opened the rules panel
   * closed, and opened it open after a reload, from the same clicks.
   */
  /**
   * **THE PANEL IS CLOSED FIRST, SO THAT `true` AFTERWARDS MEANS SOMETHING — whole-branch review, M8.**
   * This used to assert `true`, close the view, reset, and assert `true` again. `TmPane`'s default is
   * `panels.rules ?? true`, so both readings are `true` whether the re-minted view inherited the closed
   * one's state or fell back to the default: the DOM half could not fail and only the `panels` line was
   * doing any work. Toggling rules SHUT before the close makes the stored state `false` and the default
   * `true`, so the assertion after the reset now distinguishes the two.
   */
  it('does not give a re-minted view the panel state of the one that closed', async () => {
    expect(rulesToggle()?.getAttribute('aria-expanded')).toBe('true')
    rulesToggle()?.click()
    expect(rulesToggle()?.getAttribute('aria-expanded'), 'the rules panel did not shut').toBe('false')
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.panels).toEqual({ 'tm-0': { rules: false } })
    document.querySelector<HTMLButtonElement>('[data-leaf="tm-0"] button.view-close')?.click()
    await until(() => document.querySelector('[data-leaf="tm-0"]') === null, 'the TM view to close')
    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
    await until(() => document.querySelector('[data-leaf="tm-0"]') !== null, 'the TM view to come back')
    expect(rulesToggle()?.getAttribute('aria-expanded'), 'the re-minted view inherited a closed panel').toBe('true')
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.panels).toEqual({})
  })

  it('records which view has focus', () => {
    document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .controls button:not([disabled])')?.focus()
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.focused).toBe('lambda-0')
    document.querySelector<HTMLElement>('[data-leaf="source"] .cm-content')?.focus()
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.focused).toBe('source')
  })
})
