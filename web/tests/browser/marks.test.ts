import { afterEach, describe, expect, it } from 'vitest'

/** Build `html` inside a fresh container and return the element matching `selector`. */
function mount(html: string, selector: string): HTMLElement {
  const box = document.createElement('div')
  box.className = 'marks-fixture'
  box.innerHTML = html
  document.body.append(box)
  const el = box.querySelector<HTMLElement>(selector)
  if (el === null) throw new Error(`no ${selector}`)
  return el
}

/**
 * Whether a computed `box-shadow` list holds an inset shadow along the bottom edge (no horizontal offset,
 * a negative vertical one) — the shape an underline mark draws with a shadow.
 */
function hasBottomEdge(boxShadow: string): boolean {
  return boxShadow.split(/,(?![^(]*\))/).some((entry) => {
    const [x, y] = [...entry.replace(/[a-z-]+\([^)]*\)/g, '').matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]))
    return entry.includes('inset') && x === 0 && y !== undefined && y < 0
  })
}

afterEach(() => {
  for (const el of document.querySelectorAll('.marks-fixture')) el.remove()
})

describe('rows mark position with the left edge and the outline', () => {
  it('draws a solid left bar on the current row', () => {
    const row = mount('<div class="state-row is-current">q0</div>', '.state-row')
    expect(getComputedStyle(row).boxShadow).toContain('3px 0px 0px 0px inset')
  })

  it('keeps both cues on a row that is current AND in the running focus', () => {
    const s = getComputedStyle(mount('<div class="state-row is-current is-focus">q0</div>', '.state-row')).boxShadow
    expect(s).toContain('3px 0px 0px 0px inset')
    expect(s).toContain('0px -2px 0px 0px inset')
  })

  it('draws a dashed left edge on a linked row', () => {
    const row = mount('<div class="state-row is-linked">q0</div>', '.state-row')
    expect(getComputedStyle(row).borderLeftStyle).toBe('dashed')
  })

  it('keeps the outline on the firing row', () => {
    const row = mount('<div class="state-row is-firing">q0</div>', '.state-row')
    expect(getComputedStyle(row).outlineStyle).toBe('solid')
  })
})

describe('spans mark what you pinned with a box and where the machine is with an underline', () => {
  it('boxes a linked source span, without an underline', () => {
    const s = getComputedStyle(mount('<div class="cm-editor"><span class="linked">x</span></div>', '.linked'))
    expect(s.boxShadow).toContain('0px 0px 0px 1px inset')
    expect(s.textDecorationLine).toBe('none')
    expect(hasBottomEdge(s.boxShadow), s.boxShadow).toBe(false)
  })

  it('outlines the next λ redex dashed, a shape neither the contractum nor a link uses', () => {
    const next = getComputedStyle(
      mount('<div class="term"><span class="is-next-redex">x</span></div>', '.is-next-redex'),
    )
    expect(next.outlineStyle).toBe('dashed')
    expect(hasBottomEdge(next.boxShadow), next.boxShadow).toBe(false)
  })

  it('boxes a linked λ span the same way', () => {
    const s = getComputedStyle(mount('<div class="term"><span class="is-linked">x</span></div>', '.is-linked'))
    expect(s.boxShadow).toContain('0px 0px 0px 1px inset')
  })

  it('underlines the exact running focus solid, the within one dotted, and a coincidence double', () => {
    const style = (cls: string): string =>
      getComputedStyle(mount(`<div class="cm-editor"><span class="${cls}">x</span></div>`, `.${cls}`))
        .textDecorationStyle
    expect(style('is-focus-exact')).toBe('solid')
    expect(style('is-focus-within')).toBe('dotted')
    expect(style('is-focus-coincident')).toBe('double')
  })

  it('leaves the λ contractum as the one underlined mark in the λ view', () => {
    const redex = getComputedStyle(
      mount('<div class="term"><span class="is-contractum">x</span></div>', '.is-contractum'),
    )
    expect(redex.boxShadow).toContain('0px -2px 0px 0px inset')
    expect(hasBottomEdge(redex.boxShadow), redex.boxShadow).toBe(true)
    const linked = getComputedStyle(mount('<div class="term"><span class="is-linked">x</span></div>', '.is-linked'))
    expect(linked.textDecorationLine).not.toContain('underline')
    expect(hasBottomEdge(linked.boxShadow), linked.boxShadow).toBe(false)
  })
})
