import { beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createPanel, type Panel } from '../../src/panel'
import { PanelStack, type Shares, type StackRegion } from '../../src/panel-stack'
import { boundary, hearLoops, heightOf, region } from './harness'

/**
 * A PANEL THAT CHANGES REGION, A REGION'S LABEL THAT CHANGES, AND A STACK THAT SAYS WHEN IT HOLDS NO GESTURE:
 * `panel-stack.ts`'s `place`, `StackRegion.label` and `whenFree`, which the machine panels row design's §5.3,
 * §6.5 and §6.7 call for.
 *
 * Held on a stack built by hand, which no view does: `top`, one panel that is its own region; `row`, two panels side
 * by side, named for the panels it holds; and `own`, the one panel `m` in a region to itself. A case moves `m` into
 * the row as a machine view moves its heap: the element first, then `place`.
 */

/** The `flex` `style.css` gives an open region of a real view, set inline: this fixture's names have no rule there. */
const SHARED = 'var(--share, 1) 1 0'

/** A panel that fills its region's height, its body over a floor, so a boundary beside it has room to move. */
function panel(name: string): Panel {
  const body = document.createElement('div')
  body.style.cssText = 'flex: 1 1 0; min-height: 20px'
  const p = createPanel({ name, label: name, body })
  p.el.style.cssText = 'display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; margin: 0'
  return p
}

function mount(sizes: Shares = {}) {
  const host = document.createElement('div')
  host.style.cssText = 'display: flex; flex-direction: column; width: 600px; height: 600px'
  const [t, a, b, m] = ['top', 'a', 'b', 'm'].map(panel) as [Panel, Panel, Panel, Panel]
  t.el.style.flex = SHARED
  const row = document.createElement('div')
  row.style.cssText = `display: flex; flex: ${SHARED}`
  row.append(a.el, b.el)
  const own = document.createElement('div')
  own.style.cssText = `display: flex; flex: ${SHARED}`
  own.append(m.el)
  host.append(t.el, row, own)
  document.body.append(host)
  const inRow = (): Panel[] => [a, b, m].filter((p) => p.el.parentElement === row)
  const regions: StackRegion[] = [
    { name: 'top', label: 'top', el: t.el, share: 2, panels: [t], bodies: () => [t.body] },
    {
      name: 'row',
      label: () =>
        inRow()
          .map((p) => p.el.dataset.panel)
          .join(', '),
      el: row,
      share: 1,
      panels: [a, b],
      bodies: () => inRow().map((p) => p.body),
    },
    { name: 'own', label: 'own', el: own, share: 1, panels: [m], bodies: () => [m.body] },
  ]
  const stored = vi.fn<(s: Shares) => void>()
  const stack = new PanelStack(regions, sizes, stored)
  const move = (): void => {
    row.append(m.el)
    stack.place(m, 'row')
  }
  return { host, stack, stored, t, a, b, m, move }
}

/**
 * A STACK WITH A REGION THAT IS A PART OF ANOTHER, as a machine view's call stack is of its row in a narrow view:
 * `top`, one panel that is its own region; `whole`, the panel `a` in a region of its own; `part`, a part of
 * `whole`, the panel `b` in one; and `last`, the one panel `m`. `hide` moves `b` into `whole` and hides
 * `part`, as a machine view does where the call stack sits beside the first panel.
 */
function mountPart(sizes: Shares = {}) {
  const host = document.createElement('div')
  host.style.cssText = 'display: flex; flex-direction: column; width: 600px; height: 600px'
  const [t, a, b, m] = ['top', 'a', 'b', 'm'].map(panel) as [Panel, Panel, Panel, Panel]
  t.el.style.flex = SHARED
  m.el.style.flex = SHARED
  const holding = (p: Panel): HTMLElement => {
    const el = document.createElement('div')
    el.style.cssText = `display: flex; flex: ${SHARED}`
    el.append(p.el)
    return el
  }
  const [whole, part] = [holding(a), holding(b)]
  host.append(t.el, whole, part, m.el)
  document.body.append(host)
  const regions: StackRegion[] = [
    { name: 'top', label: 'top', el: t.el, share: 2, panels: [t], bodies: () => [t.body] },
    { name: 'whole', label: 'whole', el: whole, share: 1, panels: [a], bodies: () => [a.body] },
    { name: 'part', label: 'part', el: part, partOf: 'whole', share: 0.5, panels: [b], bodies: () => [b.body] },
    { name: 'last', label: 'last', el: m.el, share: 1, panels: [m], bodies: () => [m.body] },
  ]
  const stored = vi.fn<(s: Shares) => void>()
  const stack = new PanelStack(regions, sizes, stored)
  const hide = (): void => {
    whole.append(b.el)
    // HIDDEN BY THE BROWSER'S OWN `[hidden]` RULE, as a view's region is: the holder's inline display would outrank it.
    part.hidden = true
    part.style.removeProperty('display')
    stack.place(b, 'whole')
  }
  /** The height of the region `name`. */
  const h = (name: string): number => heightOf(region(host, name))
  /** The shares the stack stored last. */
  const last = (): Shares => stored.mock.lastCall?.[0] ?? {}
  return { host, stack, stored, a, b, hide, h, last }
}

const NAMES = ['top', 'row', 'own'] as const
/** The share written to each region, as its text. */
const shares = (host: HTMLElement): Record<string, string> =>
  Object.fromEntries(NAMES.map((n) => [n, region(host, n).style.getPropertyValue('--share')]))
/** The boundaries drawn, each as the two regions it parts, down the view. */
const boundaries = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLElement>('.panel-boundary')].map((b) => `${b.dataset.above}|${b.dataset.below}`)
/** Whether `p`'s header is marked a handle for the boundary above its region. */
const handles = (p: Panel): boolean =>
  (p.el.querySelector(':scope > .panel-header') as HTMLElement).dataset.resizes === 'true'

/** A stack holding a gesture: `top|row` focused and an arrow key down on it, not yet released. */
async function held() {
  const mounted = mount()
  const top = region(mounted.host, 'top')
  const before = heightOf(top)
  const between = boundary(mounted.host, 'top', 'row')
  between.focus()
  await userEvent.keyboard('{ArrowDown>}')
  expect(heightOf(top), 'precondition: the held key began no gesture').toBeGreaterThan(before + 1)
  return { ...mounted, top, before, between, spy: vi.fn<() => void>() }
}

beforeAll(async () => {
  await page.viewport(1280, 1000)
})

hearLoops(async () => {
  // A CASE THAT FAILS UNDER A HELD KEY LEAVES IT DOWN, and the next case's first press would be its repeat.
  await userEvent.keyboard('{/ArrowDown}')
  document.body.innerHTML = ''
})

describe('a panel placed in another region', () => {
  it('grows the region a placed panel is in now under its maximise', async () => {
    const { host, m, move } = mount({ row: 0.4 })
    move()
    await userEvent.click(m.actions.querySelector('.panel-maximise') as HTMLElement)
    expect(m.actions.querySelector('.panel-maximise')?.getAttribute('aria-pressed')).toBe('true')
    expect(shares(host), 'the region the panel has left grew, and the row kept its stored share').toEqual({
      top: '2',
      row: '1',
      own: '1',
    })
  })

  it('reads a region none of whose panels is left as closed', () => {
    const { host, move } = mount()
    expect(boundaries(host), 'precondition: three open regions').toEqual(['top|row', 'row|own'])
    move()
    expect(region(host, 'own').hidden, 'precondition: the emptied region is not hidden').toBe(false)
    expect(boundaries(host)).toEqual(['top|row'])
  })

  it('makes a placed panel’s header a handle for the boundary above its new region', async () => {
    const { host, t, a, b, m, move } = mount()
    move()
    expect([a, b, m].map(handles), 'a header along the row’s top edge is no handle').toEqual([true, true, true])
    await userEvent.click(t.toggle)
    expect(boundaries(host), 'precondition: no boundary above the row').toEqual([])
    expect([a, b, m].map(handles), 'a header is a handle with no boundary above it').toEqual([false, false, false])
  })

  it('names a boundary by its regions’ labels, a function’s asked again at each sync', () => {
    const { host, move } = mount()
    expect(boundary(host, 'top', 'row').getAttribute('aria-label')).toBe('resize top and a, b')
    move()
    expect(boundary(host, 'top', 'row').getAttribute('aria-label')).toBe('resize top and a, b, m')
  })

  it('throws for a region the stack does not hold', () => {
    const { stack, m } = mount()
    expect(() => stack.place(m, 'nowhere')).toThrow(/no region nowhere/)
  })
})

describe('what waits for the stack to hold no gesture', () => {
  it('runs at once where none is held', () => {
    const { stack } = mount()
    const spy = vi.fn<() => void>()
    stack.whenFree(spy)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('runs once, after a held gesture ends', async () => {
    const { stack, spy } = await held()
    stack.whenFree(spy)
    expect(spy, 'run under a gesture still held').not.toHaveBeenCalled()
    await userEvent.keyboard('{/ArrowDown}')
    expect(spy).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{ArrowDown}')
    expect(spy, 'run again by a later gesture').toHaveBeenCalledTimes(1)
  })

  it('runs when the held gesture is dropped by a reset', async () => {
    const { stack, spy, top, before } = await held()
    stack.whenFree(spy)
    await userEvent.keyboard('{Enter}')
    expect(heightOf(top), 'precondition: Enter reset the boundary').toBeCloseTo(before, 0)
    expect(spy).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{/ArrowDown}')
    expect(spy, 'run again by the key’s release').toHaveBeenCalledTimes(1)
  })

  it('runs when the held gesture is dropped by new sizes', async () => {
    const { stack, spy } = await held()
    stack.whenFree(spy)
    expect(spy, 'run under a gesture still held').not.toHaveBeenCalled()
    stack.setSizes({})
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('counts a gesture whose handle has left the page as over, and runs at once', async () => {
    const { host, stack, stored, spy, between } = await held()
    // THE HANDLE GOES WITH NO COMMIT, as in a browser that sends a removed element no `blur`. Chromium sends one
    // first, `separator.ts` commits at it, and the stack would hold no gesture by the time it is asked.
    host.addEventListener('blur', (e) => e.stopPropagation(), true)
    between.remove()
    expect(stored, 'precondition: the removal itself ended the gesture').not.toHaveBeenCalled()
    stack.whenFree(spy)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(stored, 'the gesture was not committed first').toHaveBeenCalledTimes(1)
  })
})

describe('a region that is a part of another', () => {
  it('divides the share of the region it is a part of by the part it is built with, and by a stored part', () => {
    const built = mountPart()
    expect(built.h('whole'), 'built').toBeCloseTo(built.h('part'), 0)
    expect((built.h('whole') + built.h('part')) / built.h('top'), 'built').toBeCloseTo(0.5, 2)
    const { h } = mountPart({ whole: 2, part: 0.25 })
    expect(h('whole') / h('part'), 'stored').toBeCloseTo(3)
    expect((h('whole') + h('part')) / h('top'), 'stored').toBeCloseTo(1)
  })

  it('leaves the whole share to the region it is a part of while it is hidden', () => {
    const { host, h, hide } = mountPart({ whole: 1, part: 0.25 })
    hide()
    expect(h('part'), 'the part hidden').toBe(0)
    expect(h('whole') / h('top')).toBeCloseTo(0.5)
    expect(boundaries(host)).toEqual(['top|whole', 'whole|last'])
  })

  it('gives the whole share to either of the two open alone', async () => {
    const { h, a, b } = mountPart()
    await userEvent.click(b.toggle)
    expect(h('whole') / h('top'), 'the part closed').toBeCloseTo(0.5)
    await userEvent.click(b.toggle)
    await userEvent.click(a.toggle)
    expect(h('part') / h('top'), 'the whole closed').toBeCloseTo(0.5)
  })

  it('stores the sum and the part at a key on the boundary between the two', async () => {
    const { host, h, last } = mountPart()
    boundary(host, 'whole', 'part').focus()
    await userEvent.keyboard('{ArrowDown}')
    const stored = last()
    expect(Object.keys(stored).sort()).toEqual(['part', 'whole'])
    expect(stored.whole, 'the sum').toBeCloseTo(1, 2)
    expect(stored.part).toBeGreaterThan(0)
    expect(stored.part).toBeLessThan(0.5)
    expect(stored.part, 'the part as drawn').toBeCloseTo(h('part') / (h('whole') + h('part')), 2)
  })

  it('puts the split back as built at Enter on that boundary, keeping the whole’s share', async () => {
    const { host, h, last } = mountPart({ whole: 2 })
    boundary(host, 'whole', 'part').focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(last(), 'precondition: the key stored a part').toHaveProperty('part')
    await userEvent.keyboard('{Enter}')
    const stored = last()
    expect(stored.whole).toBeCloseTo(2, 2)
    expect(stored).not.toHaveProperty('part')
    expect(h('whole')).toBeCloseTo(h('part'), 0)
    expect((h('whole') + h('part')) / h('top')).toBeCloseTo(1, 2)
  })

  it('keeps the part’s height at a key on a boundary beside one of the two, storing their sum and part', async () => {
    const { host, h, last } = mountPart()
    const before = { part: h('part'), last: h('last') }
    boundary(host, 'top', 'whole').focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(h('part'), 'the part').toBeCloseTo(before.part, 0)
    expect(h('last'), 'the region on the far side of the part').toBeCloseTo(before.last, 0)
    const stored = last()
    expect(Object.keys(stored).sort()).toEqual(['part', 'top', 'whole'])
    expect((stored.whole as number) * (stored.part as number), 'the part’s share as it was').toBeCloseTo(0.5, 2)
  })

  it('reads a stored part that is not between 0 and 1 as the part it is built with', () => {
    for (const part of [1.5, 1]) {
      const { h } = mountPart({ part })
      expect(h('whole'), `a stored part of ${part}`).toBeCloseTo(h('part'), 0)
    }
  })

  it('throws for a part of a region the stack does not hold', () => {
    const p = panel('p')
    const regions: StackRegion[] = [
      { name: 'p', label: 'p', el: p.el, partOf: 'nowhere', share: 0.5, panels: [p], bodies: () => [p.body] },
    ]
    expect(() => new PanelStack(regions, {}, () => {})).toThrow(/nowhere/)
  })

  /** Regions `whole`, `part` and `other`, a panel each, `part` a half of `whole`, each changed by `over`. */
  const built = (over: { readonly [name: string]: Partial<StackRegion> }): StackRegion[] =>
    ['whole', 'part', 'other'].map((name) => {
      const p = panel(name)
      const part = name === 'part' ? { partOf: 'whole', share: 0.5 } : { share: 1 }
      return { name, label: name, el: p.el, ...part, panels: [p], bodies: () => [p.body], ...over[name] }
    })

  it.each([
    ['a part of itself', { part: { partOf: 'part' } }, /part cannot be a part of itself/],
    ['a part of a part', { whole: { partOf: 'other', share: 0.5 } }, /part cannot be a part of whole, a part itself/],
    ['a second part of one region', { other: { partOf: 'whole', share: 0.5 } }, /whole has two parts/],
    ['a part built with no share', { part: { share: null } }, /part's share .* not null/],
    ['a part built as the whole', { part: { share: 1 } }, /part's share .* not 1/],
    ['a part built as nothing', { part: { share: 0 } }, /part's share .* not 0/],
    ['a whole built with no share', { whole: { share: null } }, /whole has a part/],
  ])('throws for %s', (_, over, message) => {
    expect(() => new PanelStack(built(over), {}, () => {})).toThrow(message)
  })

  it('puts back the region beside the part and the whole’s share at Enter where the part is open alone, keeping the stored part', async () => {
    const { host, h, a, last } = mountPart({ part: 0.25 })
    await userEvent.click(a.toggle)
    boundary(host, 'top', 'part').focus()
    await userEvent.keyboard('{ArrowDown}')
    const moved = last()
    expect(Object.keys(moved).sort(), 'precondition: what the key stored').toEqual(['part', 'top', 'whole'])
    expect(moved.part, 'precondition: the key kept the stored part').toBe(0.25)
    await userEvent.keyboard('{Enter}')
    expect(last()).toEqual({ part: 0.25 })
    expect(h('part') / h('top')).toBeCloseTo(0.5, 2)
  })

  it('puts back the region beside the part and the whole’s share at Enter on a boundary beside the part, keeping the split', async () => {
    const { host, h, last } = mountPart()
    boundary(host, 'part', 'last').focus()
    await userEvent.keyboard('{ArrowDown}')
    const moved = last().part as number
    expect(moved, 'precondition: the key stored a part over the one built').toBeGreaterThan(0.5)
    await userEvent.keyboard('{Enter}')
    const stored = last()
    expect(Object.keys(stored)).toEqual(['part'])
    expect(stored.part).toBe(moved)
    expect(h('part') / (h('whole') + h('part')), 'the split').toBeCloseTo(moved, 2)
    expect((h('whole') + h('part')) / h('top'), 'the whole').toBeCloseTo(0.5, 2)
    expect(h('last') / h('top'), 'the region beside the part').toBeCloseTo(0.5, 2)
  })
})
