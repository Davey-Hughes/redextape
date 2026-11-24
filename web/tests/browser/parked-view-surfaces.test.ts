import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import {
  barButton,
  barStep,
  barTitle,
  clickWorkspaceItem,
  host,
  linkAt,
  linkStatus,
  mounted,
  SHELL,
  stateIdle,
  stepBar,
  titleText,
  until,
} from './harness'
import { clickToggle } from './user-event-fixture'

/**
 * THE SURFACES THE VIEWS SHARE DO NOT READ A PARKED VIEW — the view layouts spec §5.3.
 *
 * A view a switch takes off the screen keeps its entry in the pane collection, so what keeps a view true still reaches
 * it: a reply about its session. Two surfaces describe the views to the user instead, and each reads the views of the
 * tree on screen alone: the step bar's target and the running focuses. A parked view has no tab and no place on the
 * page, so a surface that read one would drive or mark a view no one can see.
 *
 * Each case parks a view with its toggle and reads one of them, through its filter: `main.ts`'s `barTargetNow` for
 * the bar and `draw.ts`'s `watched` for the running focuses.
 *
 * **`watched` IS ASKED ONCE A LEG, AND EACH LEG HAS A CASE.** The λ leg's running focus is the mark in the source
 * editor. The TM leg's and the rxm leg's are marks in their own views, which are off the page with the view, so what
 * is read of them is the status line's sentence for a pin the run has reached: *the machine is here right now*, *the
 * rxm run is here right now*. With the λ leg's case alone, the other two legs could read the unfiltered set and every
 * file would pass.
 *
 * **THE CASES SHARE ONE PAGE, AND EACH PUTS IT BACK BEFORE IT STARTS** (`start`): Explorer and all four views, which
 * it then asserts, with the λ view on the program.
 *
 * **THE GESTURES UNDER TEST ARE `userEvent`'S**: the toggle, pressed as `view-toggles.test.ts` presses it, since a
 * synthetic click reaches a handler a real pointer cannot; and the bar's step button. What only sets a case up is
 * `.click()` and `.focus()`.
 */

const FOUR = ['source', 'lambda-0', 'rxm-0', 'tm-0']

let view: EditorView

const preset = (): string => document.querySelector('#workspace')?.textContent?.replace('▾', '').trim() ?? ''
/** A step control of the λ view's own, by its accessible name. */
const lambdaButton = (name: string): HTMLButtonElement =>
  host('lambda-0')?.querySelector<HTMLButtonElement>(`.controls button[aria-label="${name}"]`) as HTMLButtonElement
/** Put the keyboard focus in the λ view, on its title, which makes it the focused view. */
const focusLambda = (): void => host('lambda-0')?.querySelector<HTMLElement>('button.view-title')?.focus()
const lambdaStep = (): string => host('lambda-0')?.querySelector('.step')?.textContent ?? ''
/**
 * The source editor's running focus as `<claim>:<text>`, or `''` for none: the mark `highlight.ts`'s `focusMark`
 * paints, read as `running-focus.test.ts` reads it.
 */
const sourceFocus = (): string => {
  const mark = host('source')?.querySelector('.is-focus-exact, .is-focus-within, .is-focus-coincident')
  return mark == null ? '' : `${mark.className.replace('is-focus-', '')}:${mark.textContent ?? ''}`
}
/** A step control of `leaf`'s own, by the glyph it shows. */
const control = (leaf: string, glyph: string): HTMLButtonElement => {
  const b = [...(host(leaf)?.querySelectorAll<HTMLButtonElement>('.controls button') ?? [])].find(
    (x) => x.textContent === glyph,
  )
  if (b === undefined) throw new Error(`the ${leaf} view has no ${glyph} control`)
  return b
}
const stepOf = (leaf: string): string => host(leaf)?.querySelector('.step')?.textContent ?? ''

/**
 * Drop the pin a case made, as any edit of the program does, and wait out the compile the edit starts: the status
 * line is the pin's sentence until then, and the cases after read it whole.
 */
async function unpin(): Promise<void> {
  const text = view.state.doc.toString()
  view.dispatch({ changes: { from: 0, to: text.length, insert: text } })
  await until(() => !stateIdle(), 'the edit’s compile to start')
  await until(stateIdle, 'the program to compile again')
  expect(linkStatus(), 'the pin outlived the edit').toBe('')
}

/** Each case's start: Explorer and all four views, put back and then asserted, with the λ view on the program. */
function start(): void {
  if (preset() !== 'Explorer') clickWorkspaceItem('[data-preset="explorer"]')
  // EVERY TOGGLE BUT CLIF'S PRESSED, AND CLIF'S NOT, as `view-keys.test.ts`'s `start` has it.
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views-shown button'))
    if ((b.getAttribute('aria-pressed') === 'true') === (b.dataset.shows === 'clif')) b.click()
  expect(preset(), 'precondition: Explorer').toBe('Explorer')
  expect(mounted(), 'precondition: all four views').toEqual(FOUR)
  expect(titleText('lambda-0'), 'precondition: the λ view shows the program').toBe('λ · program')
}

describe('the surfaces the views share, with a view parked', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(stateIdle, 'the first compile')
  })

  /**
   * **THE BAR KEEPS "THE LAST VIEW THAT COULD STEP" WHILE THE FOCUSED VIEW CANNOT** (Plan 7 part 2 spec §8), and the
   * source view cannot. So with the caret in the source editor the bar still drives the λ view, and parking the λ view
   * then is the case where the bar's memory names a view that has left the screen.
   *
   * **WHAT THE BAR NAMES AND WHAT ITS BUTTON MOVES ARE EACH ASSERTED SOFT**, so a bar still pointed at the parked view
   * is reported in both: by its title, and by the λ leg's step, read off the bar once the view is back and focused.
   */
  it('points the step bar at a view on the page, and steps that one, once the λ view it drove is parked', async () => {
    start()
    clickWorkspaceItem('[data-preset="debugger"]')
    expect(preset(), 'precondition: Debugger').toBe('Debugger')
    expect(stepBar().hidden, 'precondition: the step controls are the one bar').toBe(false)
    focusLambda()
    expect(barTitle(), 'precondition: the bar drives the focused λ view').toBe('λ · program')
    barButton('back to step 0').click()
    barButton('one step forward').click()
    const left = barStep()
    expect(left, 'precondition: the λ leg is at step 1').toMatch(/^step 1 of /)
    view.focus()
    await until(() => view.hasFocus, 'the source editor to take the focus')
    expect(barTitle(), 'precondition: with the caret in the source editor the bar keeps the λ view').toBe('λ · program')

    await clickToggle('lambda')
    expect(host('lambda-0'), 'precondition: the λ view is parked').toBeNull()
    const onPage = mounted().map(titleText)
    expect.soft(onPage, 'the bar names a view that is not on the page').toContain(barTitle())

    const named = barStep()
    await userEvent.click(barButton('one step forward'))
    expect(barStep(), 'precondition: the press stepped the view the bar names').not.toBe(named)
    await clickToggle('lambda')
    focusLambda()
    expect(barTitle(), 'precondition: the bar reads the λ view again').toBe('λ · program')
    expect.soft(barStep(), 'the bar’s step button moved the λ leg while its view was parked').toBe(left)
  })

  /**
   * The mark is the λ leg's: `let x = 40; x + 2` at step 1 contracts the `let`, which `running-focus.test.ts` measured
   * and holds. The leg does not move while its view is parked, so the mark that comes back with the view is the one
   * that left.
   */
  it('takes the λ leg’s running focus off the source editor while the λ view is parked', async () => {
    start()
    lambdaButton('back to step 0').click()
    lambdaButton('one step forward').click()
    expect(lambdaStep(), 'precondition: the λ leg is at step 1').toContain('step 1 of ')
    expect(sourceFocus(), 'precondition: the source editor marks the construct the λ leg is at').toBe(
      'exact:let x = 40;',
    )

    await clickToggle('lambda')
    expect(host('lambda-0'), 'precondition: the λ view is parked').toBeNull()
    expect(sourceFocus(), 'the source editor carries the running focus of a term no view shows').toBe('')

    await clickToggle('lambda')
    expect(lambdaStep(), 'the λ leg moved while its view was parked').toContain('step 1 of ')
    expect(sourceFocus(), 'the mark did not come back with the view').toBe('exact:let x = 40;')
  })

  /**
   * THE TM LEG'S RUNNING FOCUS. `let x = 40; x + 2` is 2,870 steps of the machine, and at step 2,868 it is inside the
   * block `x + 2` was lowered to (`running-focus.test.ts` measured both). With `x + 2` pinned, the status line says
   * the machine is there, and it says so of a machine some view shows.
   */
  it('stops saying the machine is at the pin while the TM view is parked', async () => {
    start()
    host('tm-0')?.querySelector<HTMLButtonElement>('.controls button.to-newest')?.click()
    control('tm-0', '◀').click()
    control('tm-0', '◀').click()
    expect(stepOf('tm-0'), 'precondition: the TM leg is two steps from its end').toContain('step 2,868 of 2,870')
    linkAt(view, view.state.doc.toString().indexOf('+'))
    await until(
      () => linkStatus().includes('the machine is here right now'),
      'the status line to say the machine is here',
    )

    await clickToggle('tm')
    expect(host('tm-0'), 'precondition: the TM view is parked').toBeNull()
    expect(linkStatus(), 'the status line says where a machine no view shows is').not.toContain('the machine is here')

    await clickToggle('tm')
    expect(stepOf('tm-0'), 'the TM leg moved while its view was parked').toContain('step 2,868 of 2,870')
    expect(linkStatus(), 'the sentence did not come back with the view').toContain('the machine is here right now')
    await unpin()
  })

  /** THE RXM LEG'S. At step 0 the instruction about to run is `li r0, #40`, the literal `40` (`rxm-link.test.ts`). */
  it('stops saying the rxm run is at the pin while the rxm view is parked', async () => {
    start()
    control('rxm-0', '↺').click()
    expect(stepOf('rxm-0'), 'precondition: the rxm leg is at step 0').toContain('step 0 of ')
    linkAt(view, view.state.doc.toString().indexOf('40'))
    await until(
      () => linkStatus().includes('the rxm run is here right now'),
      'the status line to say the rxm run is here',
    )

    await clickToggle('rxm')
    expect(host('rxm-0'), 'precondition: the rxm view is parked').toBeNull()
    expect(linkStatus(), 'the status line says where an rxm run no view shows is').not.toContain('the rxm run is here')

    await clickToggle('rxm')
    expect(stepOf('rxm-0'), 'the rxm leg moved while its view was parked').toContain('step 0 of ')
    expect(linkStatus(), 'the sentence did not come back with the view').toContain('the rxm run is here right now')
    await unpin()
  })
})
