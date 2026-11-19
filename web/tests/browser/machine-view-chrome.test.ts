import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RxmPane } from '../../src/rxm-pane'
import { TmPane } from '../../src/tm-pane'
import { ONE_RULE_PROGRAM, tmStateOf } from '../node/tm-machines'
import { controlState, inertEvents, newPaneHost } from './harness'

/**
 * What the TM view and the rxm view say and write through the chrome they share (`machine-view-chrome.ts`): the words
 * each gives *edit a copy*, and the per-frame setters that must write nothing when told what the view already shows.
 * PANES ARE CONSTRUCTED DIRECTLY: these are the views' own calls, and no route through `main()` hands a test the pane.
 */

const events = () => inertEvents({ detachProgram: vi.fn() })

/** The menu's *edit a copy*, which stays in the DOM while the menu is closed, and `null` while it does not apply. */
const editCopy = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button.detach')
const hintOf = (item: HTMLElement | null) => item?.querySelector('.view-menu-hint')?.textContent

describe('the chrome the machine views share', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('words edit a copy for what each view copies', () => {
    const tmHost = newPaneHost()
    new TmPane(tmHost, events()).setForkAvailable('tapes 1\n', 1, true)
    expect(hintOf(editCopy(tmHost))).toBe('the whole machine')

    const rxmHost = newPaneHost()
    new RxmPane(rxmHost, events()).setForkAvailable('result Nat\n\n    halt\n', 1)
    expect(hintOf(editCopy(rxmHost))).toBe('the whole program')
  })

  it('words the refusal of a function-valued program', () => {
    const host = newPaneHost()
    new TmPane(host, events()).setForkAvailable(null, 0, false)
    const item = editCopy(host)
    expect(item?.disabled).toBe(true)
    expect(hintOf(item)).toBe('a function-valued program has no TM file a copy can run')
  })

  it('writes nothing to the status line when told what it already shows', () => {
    const host = newPaneHost()
    const tm = new TmPane(host, events())
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

    tm.setDetached(false)
    tm.setDetached(false)
    expect(writes()).toBe(0)
    seen.disconnect()
  })
})
