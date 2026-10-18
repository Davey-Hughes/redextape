import { beforeAll, describe, expect, it } from 'vitest'
import type { Workspace } from '../../src/workspace'
import { host, mountAt, mounted, storedLayout } from './harness'
import { clickToggle } from './user-event-fixture'

/**
 * WHAT THE WORKSPACE STORES FOR A VIEW IS KEPT THROUGH THE SWITCH THAT PARKS IT — the view layouts spec §5.1 and §5.2:
 * its panel state and its display, which a reload builds the view from when its arrangement is entered.
 *
 * Two lines hold this, and each could go with every other test passing (measured on `ee09243`, 2026-10-12, with the
 * whole node and browser suites):
 *
 * - `main.ts`'s `switchTo` tells `enterTree` that its write is a switch's. Without that the views a switch takes off
 *   the screen are treated as an edit's, closed, and their panel state and display are dropped.
 * - `main.ts`'s `normaliseWorkspace` keeps what is stored for every live view. Asked of the tree on screen alone, it
 *   drops a parked view's at the next write.
 *
 * Either way the page looks right until a reload, since the parked pane is kept and comes back as it left: so each
 * case reads storage while its view is off the screen. `parked-view-state-restore.test.ts` has the reload's half.
 *
 * The page starts on all four views (`setup.ts` stores that workspace for every file). The toggles are pressed with
 * `userEvent`; a panel's toggle and a display's choice are `.click()`, the second being an item of a menu the case
 * does not open.
 */

const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']

type Stored = Pick<Workspace, 'panels' | 'display' | 'tmDisplay'>
const rulesToggle = (): HTMLButtonElement | null =>
  host('tm-0')?.querySelector<HTMLButtonElement>('[data-panel="rules"] .panel-toggle') ?? null
const edges = (value: string): HTMLButtonElement | undefined =>
  [...(host('tm-0')?.querySelectorAll<HTMLButtonElement>('[data-panel="diagram"] .diagram-mode') ?? [])].find(
    (b) => b.dataset.value === value,
  )
const layoutChoice = (value: string): HTMLElement | null =>
  host('lambda-0')?.querySelector<HTMLElement>(`.view-menu-choice[data-value="${value}"]`) ?? null

beforeAll(() => mountAt(1280, 896))

// THE CASES RUN IN ORDER ON ONE PAGE, and each asserts the state it starts from.
describe('what the workspace stores for a view a switch takes off the screen', () => {
  it('keeps a TM view’s panel state and its display while the view is parked, and after it returns', async () => {
    expect(mounted(), 'precondition: all four views').toEqual(FOUR)
    rulesToggle()?.click()
    expect(rulesToggle()?.getAttribute('aria-expanded'), 'precondition: the rules panel shut').toBe('false')
    edges('chips')?.click()
    expect(edges('chips')?.getAttribute('aria-checked'), 'precondition: the diagram draws chips').toBe('true')
    const before = storedLayout<Stored>()
    expect(before.panels['tm-0'], 'precondition: the shut panel is stored').toEqual({ rules: false })
    expect(before.tmDisplay['tm-0'], 'precondition: the display is stored').toEqual({
      level: 'program',
      edges: 'chips',
    })

    await clickToggle('tm')
    expect(mounted(), 'precondition: the TM view is off the screen').toEqual(['source', 'lambda-0', 'asm-0'])
    expect
      .soft(storedLayout<Stored>().panels['tm-0'], 'the switch dropped the parked view’s panel state')
      .toEqual({ rules: false })
    expect
      .soft(storedLayout<Stored>().tmDisplay['tm-0'], 'the switch dropped the parked view’s display')
      .toEqual({ level: 'program', edges: 'chips' })

    await clickToggle('tm')
    expect(mounted()).toEqual(FOUR)
    expect(rulesToggle()?.getAttribute('aria-expanded'), 'the rules panel came back open').toBe('false')
    expect(edges('chips')?.getAttribute('aria-checked')).toBe('true')
    expect.soft(storedLayout<Stored>().panels['tm-0'], 'storage and the page disagree once the view is back').toEqual({
      rules: false,
    })
    expect.soft(storedLayout<Stored>().tmDisplay['tm-0']).toEqual({ level: 'program', edges: 'chips' })
  })

  it('keeps a λ view’s display while the view is parked', async () => {
    expect(mounted(), 'precondition: all four views').toEqual(FOUR)
    layoutChoice('outline')?.click()
    expect(layoutChoice('outline')?.getAttribute('aria-checked'), 'precondition: the term as an outline').toBe('true')
    const display = storedLayout<Stored>().display['lambda-0']
    expect(display?.layout, 'precondition: the display is stored').toBe('outline')

    await clickToggle('lambda')
    expect(mounted(), 'precondition: the λ view is off the screen').toEqual(['source', 'asm-0', 'tm-0'])
    expect(storedLayout<Stored>().display['lambda-0'], 'the switch dropped the parked view’s display').toEqual(display)

    await clickToggle('lambda')
    expect(mounted()).toEqual(FOUR)
    expect(layoutChoice('outline')?.getAttribute('aria-checked')).toBe('true')
    expect(storedLayout<Stored>().display['lambda-0']).toEqual(display)
  })
})
