import { describe, expect, it } from 'vitest'
import { KIND_GLOSS, viewToggles } from '../../src/app-header'
import { SHELL, toggle } from './harness'

/**
 * WHAT THE LAST `views` TOGGLE PRESSED SAYS TO A READER WHO DOES NOT HOVER — `app-header.ts`'s `viewToggles` on
 * `index.html`'s markup (`SHELL`), with no app behind it: its `aria-description` is its whole tooltip, so the rxm
 * toggle's says what the view is as well as why a press does nothing.
 */
describe('the last views toggle pressed', () => {
  it('says its whole tooltip in its aria-description, with what the rxm view is', () => {
    document.body.innerHTML = SHELL
    const toggles = viewToggles(document.querySelector('#views-shown') as HTMLElement, () => undefined)
    toggles.sync(['rxm'], () => 1)
    const rxm = toggle('rxm')
    expect(rxm.getAttribute('aria-disabled'), 'precondition: the rxm toggle is the last one pressed').toBe('true')
    expect(rxm.title).toBe(`the rxm view is the only one shown — one view stays\n${KIND_GLOSS.rxm}`)
    expect(rxm.getAttribute('aria-description')).toBe(rxm.title)
  })
})
