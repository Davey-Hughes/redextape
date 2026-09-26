import { afterEach, describe, expect, it, vi } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import { wireOf } from '../node/tree-fixture'

/**
 * What a λ view says about the pinned construct — `LambdaPane.linkState`, the λ half of the link status
 * (spec §5.4). The pane is built directly, as `lambda-follow`'s are: nothing here needs `main()`.
 */
const host = (): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane lambda-link-state-fixture'
  el.style.width = '640px'
  document.body.append(el)
  return el
}

const events = (): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
})

afterEach(() => {
  for (const el of document.querySelectorAll('.lambda-link-state-fixture')) el.remove()
})

describe('a λ view’s link state', () => {
  /**
   * A STALE TREE IS ANOTHER STEP'S, so it cannot answer for this one. `none-here` reads "no node in the λ
   * term at this step", and a stale tree is shown only until this step's arrives: the moment `'waiting'`
   * names. The node 0 of `(\x. x) y` carries construct 7, and nothing carries 8.
   */
  it('answers from the tree for this step, and waits while it shows another step’s', () => {
    const pane = new LambdaPane(host(), events())
    const wire = wireOf('(\\x. x) y', { links: { 0: 7 } })

    pane.renderTree({ kind: 'tree', tree: wire }, 7)
    expect(pane.linkState()).toBe('shown')
    pane.renderTree({ kind: 'tree', tree: wire }, 8)
    expect(pane.linkState()).toBe('none-here')

    pane.renderTree({ kind: 'stale', tree: wire }, 8)
    expect(pane.linkState(), 'a stale tree answered for this step').toBe('waiting')
    pane.renderTree({ kind: 'stale', tree: wire }, 7)
    expect(pane.linkState(), 'a stale tree answered for this step').toBe('waiting')
  })
})
