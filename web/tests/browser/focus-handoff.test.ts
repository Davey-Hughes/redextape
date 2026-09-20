import { beforeEach, describe, expect, it } from 'vitest'
import { handOff, nearest } from '../../src/focus-handoff'

/**
 * A bar of five buttons, `c` disabled, plus one inside a `[hidden]` box — the shapes `handOff` has to
 * skip. No app mount: this module knows nothing about the app.
 */
function bar(): { box: HTMLElement; get: (name: string) => HTMLButtonElement } {
  document.body.innerHTML = `
    <div id="bar">
      <button id="a">a</button>
      <button id="b">b</button>
      <button id="c" disabled>c</button>
      <button id="d">d</button>
      <div hidden><button id="e">e</button></div>
      <button id="f">f</button>
    </div>
    <button id="outside">outside</button>`
  const box = document.querySelector<HTMLElement>('#bar') as HTMLElement
  return { box, get: (name) => document.querySelector<HTMLButtonElement>(`#${name}`) as HTMLButtonElement }
}

describe('nearest', () => {
  it('reads forward from the departing control, then backward, skipping what cannot take focus', () => {
    const { box, get } = bar()
    expect(nearest(box, get('b')).map((el) => el.id)).toEqual(['d', 'f', 'a'])
  })

  it('reads backward alone when the departing control is last', () => {
    const { box, get } = bar()
    expect(nearest(box, get('f')).map((el) => el.id)).toEqual(['d', 'b', 'a'])
  })

  it('excludes the departing control’s own descendants', () => {
    const { box } = bar()
    const group = document.createElement('div')
    group.innerHTML = '<button id="g">g</button>'
    box.append(group)
    expect(nearest(box, group).map((el) => el.id)).not.toContain('g')
  })
})

describe('handOff', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('moves the focus off a departing control to the first usable candidate', () => {
    const { box, get } = bar()
    get('b').focus()
    expect(handOff(get('b'), nearest(box, get('b')))).toBe(true)
    expect(document.activeElement).toBe(get('d'))
  })

  it('leaves the focus alone when it was not on the departing control', () => {
    const { box, get } = bar()
    get('outside').focus()
    expect(handOff(get('b'), nearest(box, get('b')))).toBe(false)
    expect(document.activeElement).toBe(get('outside'))
  })

  it('counts a focus INSIDE the departing control as being on it', () => {
    const { get } = bar()
    const group = document.createElement('div')
    const inner = document.createElement('button')
    inner.id = 'inner'
    group.append(inner)
    document.body.append(group)
    inner.focus()
    expect(handOff(group, [get('a')])).toBe(true)
    expect(document.activeElement).toBe(get('a'))
  })

  it('takes several departing controls at once', () => {
    const { box, get } = bar()
    get('d').focus()
    expect(handOff([get('b'), get('d')], nearest(box, get('d')))).toBe(true)
    expect(document.activeElement).toBe(get('f'))
  })

  // **THE LAST RESORT IS THAT THE FOCUS DOES NOT MOVE, NOT THAT IT FALLS TO `<body>`.** A caller with
  // nothing to hand to has a state worth reporting; silently blurring would make it indistinguishable
  // from a successful hand-off at every call site.
  it('returns false and changes nothing when no candidate can take the focus', () => {
    const { get } = bar()
    get('b').focus()
    expect(handOff(get('b'), [get('c'), null, undefined])).toBe(false)
    expect(document.activeElement).toBe(get('b'))
  })
})
