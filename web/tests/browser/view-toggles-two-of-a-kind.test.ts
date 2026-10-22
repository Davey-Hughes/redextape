import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { drawn, focusInPage, live, mountAt, notice, sourcePane, toggle } from './harness'

/**
 * WHAT A `views` TOGGLE SAYS WHERE THE PAGE SHOWS TWO VIEWS OF ITS KIND — the view layouts spec §6. A toggle shows or
 * hides every view of its kind, so its tooltip, and the sentence that says why the last one stays, count them:
 * *hide the 2 TM views*, *the 2 TM views are the only ones shown — one kind of view stays*.
 *
 * **A FIRST LOAD AND `+ view` ARE ALL IT TAKES**: the source beside the TM view, then a second TM view. Were each
 * sentence written for one view, the TM toggle would say *hide the TM view* and hide both, and with the source view
 * closed it would say *the TM view is the only one shown* of two.
 *
 * The cases run in order, each from the page the one before left.
 */

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.removeItem(LAYOUT_STORAGE_KEY)

const ONLY_TWO = 'the 2 TM views are the only ones shown — one kind of view stays'

const kinds = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.kind as string)

describe('the views toggles, with two views of one kind on screen', () => {
  beforeAll(async () => {
    await mountAt(1280, 896)
    expect(drawn(), 'precondition: the page opened on the first load’s views').toBe('row[50](source tm-0)')
  })

  it('says hide the 2 TM views once + view has added a second, and says the source view as it did', async () => {
    expect(toggle('tm').title, 'precondition: one TM view is said as one').toBe('hide the TM view')
    await userEvent.click(document.querySelector('#new-view') as HTMLElement)
    const item = [...document.querySelectorAll<HTMLButtonElement>('#new-view-menu button')].find(
      (b) => b.textContent === 'TM · program',
    )
    if (item === undefined) throw new Error('+ view offers no TM · program')
    await userEvent.click(item)
    expect(kinds()).toEqual(['source', 'tm', 'tm'])
    expect(toggle('tm').title).toBe('hide the 2 TM views')
    expect(toggle('source').title).toBe('hide the source view')
  })

  it('says the 2 TM views are the only ones shown once the source view is closed, in the tooltip and on a press', async () => {
    await userEvent.click(sourcePane().querySelector('button.view-close') as HTMLElement)
    expect(kinds()).toEqual(['tm', 'tm'])
    const tm = toggle('tm')
    expect(tm.getAttribute('aria-disabled'), 'the toggle of the only kind shown is not disabled').toBe('true')
    expect(tm.title).toBe(ONLY_TWO)
    expect(tm.getAttribute('aria-description')).toBe(ONLY_TWO)
    // `force`: the driver waits for a control to be enabled and reads `aria-disabled` as not enabled.
    await userEvent.click(tm, { force: true })
    await focusInPage('a pointer press on the toggle of the only kind shown, which is refused')
    expect(kinds(), 'the press hid the last views').toEqual(['tm', 'tm'])
    expect(notice()).toBe(ONLY_TWO)
    expect(toggle('source').title).toBe('show the source view')
  })

  it('says show the 2 TM views of a toggle whose press brings two back', async () => {
    await userEvent.click(toggle('source'))
    expect(kinds(), 'precondition: the source toggle brought back the arrangement the ✕ left').toEqual([
      'source',
      'tm',
      'tm',
    ])
    await userEvent.click(toggle('tm'))
    expect(kinds()).toEqual(['source'])
    // ONE KIND IS SAID ALONE, with no `and`: the live region's sentence for a switch that leaves one.
    expect(live()).toBe('showing source')
    expect(toggle('tm').title).toBe('show the 2 TM views')
    expect(toggle('source').title).toBe('the source view is the only one shown — one view stays')
    await userEvent.click(toggle('tm'))
    expect(kinds()).toEqual(['source', 'tm', 'tm'])
    expect(toggle('tm').title).toBe('hide the 2 TM views')
  })
})
