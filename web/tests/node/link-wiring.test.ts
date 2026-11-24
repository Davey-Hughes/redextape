import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import type { InstrLeg } from '../../src/link'
import { createLinkWiring, type LinkWiring } from '../../src/link-wiring'
import type { PaneCollection } from '../../src/panes'

/** What a click on an rxm instruction or a TM state pins, and what the status line then says. */

const NODE = 7
const OWNED_PC = 3
const MINTED_PC = 1
const OWNERLESS = 'this instruction has no source construct'
const STATES = [10, 11]
const INSTRS = [20, 21]

/**
 * A link wiring over the views given, none by default, whose index owns one instruction. `steps`, when given, collects
 * a paint's steps in order, and `draw` then writes the status line, so that the paint has a sentence to announce.
 */
function wiring(views: Record<string, unknown[]> = {}, steps?: string[]) {
  const status = { textContent: '' } as HTMLElement
  const links = createLinkWiring({
    view: () => ({ dispatch: () => steps?.push('source mark') }) as unknown as EditorView,
    statusHost: status,
    panes: { of: (leg: string) => views[leg] ?? [] } as unknown as PaneCollection,
    draw: () => {
      steps?.push('draw')
      if (steps !== undefined) status.textContent = 'a new sentence'
    },
    announce: () => steps?.push('announcement'),
  })
  links.setIndex({
    nodeForInstr: (pc: number) => (pc === OWNED_PC ? NODE : null),
    linkFor: () => ({ source: null, states: STATES, instrs: INSTRS }),
  } as never)
  /**
   * The status line as `draw()` would leave it with nothing resolved; the fake `draw` does not write it unless `steps`
   * is given.
   */
  const line = () => {
    links.drawLink(null, { rxm: false, tm: false, clif: false }, 'absent')
    return status.textContent
  }
  return { links, line }
}

describe('linkInstr', () => {
  it.each<InstrLeg>(['rxm', 'clif'])(
    'linkInstr pins the node, the pc and its origin, %s, and counts one gesture',
    (origin) => {
      const { links } = wiring()
      const before = links.gestures
      links.linkInstr(OWNED_PC, origin)
      expect(links.link).toStrictEqual({ node: NODE, origin, pc: OWNED_PC })
      expect(links.gestures).toBe(before + 1)
    },
  )

  it('a minted pc pins nothing, counts one gesture and says so until unpin', () => {
    const { links, line } = wiring()
    const before = links.gestures
    links.linkInstr(MINTED_PC, 'rxm')
    expect(links.link).toBeNull()
    expect(links.gestures).toBe(before + 1)
    expect(line()).toBe(OWNERLESS)
    links.unpin()
    expect(line()).toBe('')
  })

  it('a row lowered from no instruction clears the pin, says nothing and counts one gesture', () => {
    const { links, line } = wiring()
    links.linkInstr(OWNED_PC, 'rxm')
    expect(links.link).toStrictEqual({ node: NODE, origin: 'rxm', pc: OWNED_PC })
    const before = links.gestures
    links.linkInstr(null, 'rxm')
    expect(links.link).toBeNull()
    expect(line()).toBe('')
    expect(links.gestures).toBe(before + 1)
  })

  it('does nothing while linking is off, after an edit', () => {
    const { links } = wiring()
    links.clearLink()
    const before = links.gestures
    links.linkInstr(OWNED_PC, 'rxm')
    expect(links.link).toBeNull()
    expect(links.gestures).toBe(before)
  })
})

describe('setLinkTo', () => {
  it('setLinkTo writes no pc', () => {
    const { links } = wiring()
    links.setLinkTo(NODE, 'lambda')
    expect(links.link).toStrictEqual({ node: NODE, origin: 'lambda' })
  })

  it('a TM state with no owner says nothing', () => {
    const { links, line } = wiring()
    links.setLinkTo(null, 'tm')
    expect(links.link).toBeNull()
    expect(line()).toBe('')
  })
})

/** A wiring over two views on each linked leg, a split; `taken` empties what each view's `setLink` got. */
function wiringOverViews(steps?: string[]) {
  const calls: Record<string, [rows: readonly number[], scrollTo: boolean][]> = {}
  const view = (name: string) => {
    const own: [readonly number[], boolean][] = []
    calls[name] = own
    return {
      pane: {
        setLink: (rows: readonly number[], scrollTo: boolean) => {
          steps?.push('view')
          own.push([rows, scrollTo])
        },
      },
    }
  }
  const views = {
    rxm: [view('rxm'), view('rxm split')],
    tm: [view('tm'), view('tm split')],
  }
  const { links } = wiring(views, steps)
  const taken = () => Object.fromEntries(Object.entries(calls).map(([name, got]) => [name, got.splice(0)]))
  return { links, taken }
}

const CLEARED = { rxm: [[[], false]], 'rxm split': [[[], false]], tm: [[[], false]], 'tm split': [[[], false]] }

describe('the fan-out', () => {
  it.each<{ origin: string; click: (links: LinkWiring) => void; rxm: boolean; tm: boolean }>([
    { origin: 'source', click: (links) => links.setLinkTo(NODE, 'source'), rxm: true, tm: true },
    { origin: 'lambda', click: (links) => links.setLinkTo(NODE, 'lambda'), rxm: true, tm: true },
    { origin: 'tm', click: (links) => links.setLinkTo(NODE, 'tm'), rxm: true, tm: false },
    { origin: 'rxm', click: (links) => links.linkInstr(OWNED_PC, 'rxm'), rxm: false, tm: true },
  ])('gives each view its leg’s rows and scrolls it unless the click came from its leg: $origin', (c) => {
    const { links, taken } = wiringOverViews()
    c.click(links)
    expect(taken()).toStrictEqual({
      rxm: [[INSTRS, c.rxm]],
      'rxm split': [[INSTRS, c.rxm]],
      tm: [[STATES, c.tm]],
      'tm split': [[STATES, c.tm]],
    })
  })

  it('gives the rxm views a CLIF row’s pc alone and the TM views its construct’s states, scrolling both', () => {
    const { links, taken } = wiringOverViews()
    links.linkInstr(OWNED_PC, 'clif')
    expect(taken()).toStrictEqual({
      rxm: [[[OWNED_PC], true]],
      'rxm split': [[[OWNED_PC], true]],
      tm: [[STATES, true]],
      'tm split': [[STATES, true]],
    })
  })

  it('reaches the views last, after the source mark, the draw and the announcement', () => {
    const steps: string[] = []
    const { links } = wiringOverViews(steps)
    links.setLinkTo(NODE, 'source')
    expect(steps).toStrictEqual(['source mark', 'draw', 'announcement', 'view', 'view', 'view', 'view'])
  })

  it('clears every view without scrolling on an edit', () => {
    const { links, taken } = wiringOverViews()
    links.setLinkTo(NODE, 'source')
    taken()
    links.clearLink()
    expect(taken()).toStrictEqual(CLEARED)
  })

  it('scrolls nothing when a pin is cleared', () => {
    const { links, taken } = wiringOverViews()
    links.setLinkTo(NODE, 'source')
    taken()
    links.unpin()
    expect(taken()).toStrictEqual(CLEARED)
  })
})
