import { beforeEach, describe, expect, it } from 'vitest'
import { TmPane } from '../../src/tm-pane'
import { ONE_RULE_PROGRAM, tmStateOf } from '../node/tm-machines'
import { controlState, inertEvents, newPaneHost } from './harness'

/**
 * What the TM view writes through the chrome the machine views share (`machine-view-chrome.ts`): the per-frame setters
 * that must write nothing when told what the view already shows. PANES ARE CONSTRUCTED DIRECTLY: these are the views'
 * own calls, and no route through `main()` hands a test the pane.
 */

describe('the chrome the machine views share', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('writes nothing to the status line when told what it already shows', () => {
    const host = newPaneHost()
    const tm = new TmPane(host, inertEvents())
    tm.setProgram(ONE_RULE_PROGRAM, ['t'])
    tm.render(tmStateOf(0, 0, 'a'), controlState(false, 'step 0'))
    const seen = new MutationObserver(() => {})
    seen.observe(host.querySelector('.tm-status') as HTMLElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    })
    const writes = () => seen.takeRecords().length

    // A REAL FLIP MUST SHOW UP, or the zeros below would say nothing about the guards.
    tm.setStepsShown(false)
    expect(writes()).toBeGreaterThan(0)

    tm.setStepsShown(false)
    expect(writes()).toBe(0)
    seen.disconnect()
  })
})
