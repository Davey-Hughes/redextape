import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * THE SURFACES THE VIEWS SHARE DO NOT READ A PARKED VIEW — the view layouts spec §5.3.
 *
 * A view a switch takes off the screen keeps its entry in the pane collection, so what keeps a view true still reaches
 * it: a reply about its session, a copy deleted under it. Four surfaces describe the views to the user instead, and
 * each reads the views of the tree on screen alone: the step bar's target, the running focuses, the link status line,
 * and the share popover's line about copies. A parked view has no tab and no place on the page, so a surface that
 * read one would drive, mark or count a view no one can see.
 *
 * Each case parks a view with its toggle and reads one of them. Three filters hold the four: `main.ts`'s
 * `barTargetNow` for the bar; `draw.ts`'s `watched` for the running focuses; and `link-wiring.ts`'s `detachedPanes`
 * for the status line and the popover, which both read it. With its own filter taken out a case fails, and the other
 * two pass (run 2026-10-12).
 *
 * **`watched` IS ASKED ONCE A LEG, AND EACH LEG HAS A CASE.** The λ leg's running focus is the mark in the source
 * editor. The TM leg's and the asm leg's are marks in their own views, which are off the page with the view, so what
 * is read of them is the status line's sentence for a pin the run has reached: *the machine is here right now*, *the
 * asm run is here right now*. With the λ leg's case alone, the other two legs read the unfiltered set and every file
 * passed.
 *
 * **THE CASES SHARE ONE PAGE, AND EACH PUTS IT BACK BEFORE IT STARTS** (`start`): Explorer and all four views, which
 * it then asserts, with the λ view on the program. The last case leaves the λ view on a copy, which is why it is last.
 *
 * **THE GESTURES UNDER TEST ARE `userEvent`'S**: the toggle, pressed as `view-toggles.test.ts` presses it, since a
 * synthetic click reaches a handler a real pointer cannot; the bar's step button; and `share`. What only sets a case
 * up is `.click()` and `.focus()`.
 */

const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']
/** `link-status.ts`'s `detachedText` for the one λ view on a copy, verbatim. */
const SHOWS_A_COPY = 'λ view shows a copy — not linked to the program'
/** `share-popover.ts`'s `copiesLine` for that view, verbatim. */
const NOT_INCLUDED = 'copies are not included — the λ · copy 1 view will open on the program'

let view: EditorView

const toggle = (kind: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`) as HTMLButtonElement
const press = (kind: string): Promise<void> => userEvent.click(toggle(kind))
const host = (leaf: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${leaf}"]:not([role="tab"])`)
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const titleText = (leaf: string): string => host(leaf)?.querySelector('.view-title')?.textContent ?? ''
const preset = (): string => document.querySelector('#workspace')?.textContent?.replace('▾', '').trim() ?? ''
const pick = (sel: string): void => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
  const menu = document.querySelector<HTMLElement>('#workspace-menu')
  if (menu?.matches(':popover-open')) menu.hidePopover()
}
const bar = (): HTMLElement => document.querySelector<HTMLElement>('#step-bar') as HTMLElement
/** The title of the view the bar drives, which `step-bar.ts` writes in front of its controls; `''` for none. */
const barTitle = (): string => bar().querySelector('.step-bar-title')?.textContent?.trim() ?? ''
const barStep = (): string => bar().querySelector('.step-bar-inner .step')?.textContent?.trim() ?? ''
const barButton = (name: string): HTMLButtonElement =>
  bar().querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) as HTMLButtonElement
/** A step control of the λ view's own, by its accessible name. */
const lambdaButton = (name: string): HTMLButtonElement =>
  host('lambda-0')?.querySelector<HTMLButtonElement>(`.controls button[aria-label="${name}"]`) as HTMLButtonElement
/** Put the keyboard focus in the λ view, on its title, which makes it the focused view. */
const focusLambda = (): void => host('lambda-0')?.querySelector<HTMLElement>('button.view-title')?.focus()
const lambdaStep = (): string => host('lambda-0')?.querySelector('.step')?.textContent ?? ''
/**
 * The source editor's running focus as `<claim>:<text>`, or `''` for none: the mark `highlight.ts`'s `focusMark`
 * paints, read as `running-focus.test.ts` reads it. Asked of the source view alone, since a copy's editor is a
 * `.cm-editor` too.
 */
const sourceFocus = (): string => {
  const mark = host('source')?.querySelector('.is-focus-exact, .is-focus-within, .is-focus-coincident')
  return mark == null ? '' : `${mark.className.replace('is-focus-', '')}:${mark.textContent ?? ''}`
}
const status = (): string => document.querySelector('#link-status')?.textContent ?? ''
/** A step control of `leaf`'s own, by the glyph it shows. */
const control = (leaf: string, glyph: string): HTMLButtonElement => {
  const b = [...(host(leaf)?.querySelectorAll<HTMLButtonElement>('.controls button') ?? [])].find(
    (x) => x.textContent === glyph,
  )
  if (b === undefined) throw new Error(`the ${leaf} view has no ${glyph} control`)
  return b
}
const stepOf = (leaf: string): string => host(leaf)?.querySelector('.step')?.textContent ?? ''
/** Pin the source construct at `pos`, by the key `main.ts` binds to it: the caret alone decides which. */
const pinAt = (pos: number): void => {
  view.dispatch({ selection: { anchor: pos } })
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: "'", ctrlKey: true, cancelable: true }))
}
const editors = (leaf: string): number => host(leaf)?.querySelectorAll('.term-editor .cm-editor').length ?? 0

const idle = (): boolean => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
/**
 * Drop the pin a case made, as any edit of the program does, and wait out the compile the edit starts: the status
 * line is the pin's sentence until then, and the cases after read it whole.
 */
async function unpin(): Promise<void> {
  const text = view.state.doc.toString()
  view.dispatch({ changes: { from: 0, to: text.length, insert: text } })
  await until(() => !idle(), 'the edit’s compile to start')
  await until(idle, 'the program to compile again')
  expect(status(), 'the pin outlived the edit').toBe('')
}

/** Open the share popover with the pointer, read its line about copies, `null` where it has none, and shut it. */
async function sharedCopies(): Promise<string | null> {
  const menu = document.querySelector<HTMLElement>('#share-menu') as HTMLElement
  await userEvent.click(document.querySelector<HTMLButtonElement>('#share') as HTMLButtonElement)
  expect(menu.matches(':popover-open'), 'the share popover did not open').toBe(true)
  const line = menu.querySelector('#share-copies')?.textContent ?? null
  menu.hidePopover()
  return line
}

/** Each case's start: Explorer and all four views, put back and then asserted, with the λ view on the program. */
function start(): void {
  if (preset() !== 'Explorer') pick('[data-preset="explorer"]')
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views-shown button[aria-pressed="false"]')) b.click()
  expect(preset(), 'precondition: Explorer').toBe('Explorer')
  expect(mounted(), 'precondition: all four views').toEqual(FOUR)
  expect(titleText('lambda-0'), 'precondition: the λ view shows the program').toBe('λ · program')
}

describe('the surfaces the views share, with a view parked', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
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
    pick('[data-preset="debugger"]')
    expect(preset(), 'precondition: Debugger').toBe('Debugger')
    expect(bar().hidden, 'precondition: the step controls are the one bar').toBe(false)
    focusLambda()
    expect(barTitle(), 'precondition: the bar drives the focused λ view').toBe('λ · program')
    barButton('back to the oldest kept step').click()
    barButton('one step forward').click()
    const left = barStep()
    expect(left, 'precondition: the λ leg is at step 1').toMatch(/^step 1 of /)
    view.focus()
    await until(() => view.hasFocus, 'the source editor to take the focus')
    expect(barTitle(), 'precondition: with the caret in the source editor the bar keeps the λ view').toBe('λ · program')

    await press('lambda')
    expect(host('lambda-0'), 'precondition: the λ view is parked').toBeNull()
    const onPage = mounted().map(titleText)
    expect.soft(onPage, 'the bar names a view that is not on the page').toContain(barTitle())

    const named = barStep()
    await userEvent.click(barButton('one step forward'))
    expect(barStep(), 'precondition: the press stepped the view the bar names').not.toBe(named)
    await press('lambda')
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
    lambdaButton('back to the oldest kept step').click()
    lambdaButton('one step forward').click()
    expect(lambdaStep(), 'precondition: the λ leg is at step 1').toContain('step 1 of ')
    expect(sourceFocus(), 'precondition: the source editor marks the construct the λ leg is at').toBe(
      'exact:let x = 40;',
    )

    await press('lambda')
    expect(host('lambda-0'), 'precondition: the λ view is parked').toBeNull()
    expect(sourceFocus(), 'the source editor carries the running focus of a term no view shows').toBe('')

    await press('lambda')
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
    pinAt(view.state.doc.toString().indexOf('+'))
    await until(() => status().includes('the machine is here right now'), 'the status line to say the machine is here')

    await press('tm')
    expect(host('tm-0'), 'precondition: the TM view is parked').toBeNull()
    expect(status(), 'the status line says where a machine no view shows is').not.toContain('the machine is here')

    await press('tm')
    expect(stepOf('tm-0'), 'the TM leg moved while its view was parked').toContain('step 2,868 of 2,870')
    expect(status(), 'the sentence did not come back with the view').toContain('the machine is here right now')
    await unpin()
  })

  /** THE ASM LEG'S. At step 0 the instruction about to run is `li r0, #40`, the literal `40` (`asm-link.test.ts`). */
  it('stops saying the asm run is at the pin while the asm view is parked', async () => {
    start()
    control('asm-0', '↺').click()
    expect(stepOf('asm-0'), 'precondition: the asm leg is at step 0').toContain('step 0 of ')
    pinAt(view.state.doc.toString().indexOf('40'))
    await until(() => status().includes('the asm run is here right now'), 'the status line to say the asm run is here')

    await press('asm')
    expect(host('asm-0'), 'precondition: the asm view is parked').toBeNull()
    expect(status(), 'the status line says where an asm run no view shows is').not.toContain('the asm run is here')

    await press('asm')
    expect(stepOf('asm-0'), 'the asm leg moved while its view was parked').toContain('step 0 of ')
    expect(status(), 'the sentence did not come back with the view').toContain('the asm run is here right now')
    await unpin()
  })

  /**
   * **BOTH SURFACES READ ONE COUNT**, `link-wiring.ts`'s `detachedPanes`: the status line names each view showing a
   * copy, and the share popover names the views a link will open on the program instead. A link carries the tree on
   * screen alone (spec §4.7), so a parked view is not one of them.
   *
   * **SOFT WHERE THE VIEW IS PARKED**, so a parked view that is counted is reported in each place it shows.
   */
  it('leaves a parked view of a copy out of the link status line and the share popover', async () => {
    start()
    host('lambda-0')?.querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => titleText('lambda-0') === 'λ · copy 1' && editors('lambda-0') === 1, 'the copy and its editor')
    expect(status(), 'precondition: the status line names the view showing a copy').toBe(SHOWS_A_COPY)
    expect(await sharedCopies(), 'precondition: the share popover names the view showing a copy').toBe(NOT_INCLUDED)

    await press('lambda')
    expect(host('lambda-0'), 'precondition: the λ view is parked').toBeNull()
    expect.soft(status(), 'the status line counts a parked view of a copy').toBe('')
    expect.soft(await sharedCopies(), 'the share popover lists a parked view of a copy').toBeNull()

    await press('lambda')
    expect(titleText('lambda-0'), 'the view did not come back showing its copy').toBe('λ · copy 1')
    expect(status()).toBe(SHOWS_A_COPY)
    expect(await sharedCopies()).toBe(NOT_INCLUDED)
  })
})
