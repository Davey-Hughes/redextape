import { expect, it } from 'vitest'
import { StateDiagram } from '../../src/state-diagram'
import { collect } from './engine'

/**
 * The state diagram's font and style listeners (`measureOnFontChange`): one of each for the page, however many
 * diagrams come and go. Every diagram is held weakly, so once all of them are collected and a style change has found
 * them gone, the page has no diagram left; the next one must not add a second pair, which would measure every
 * diagram again once more on each font load and style change, a pair more for each such round.
 */

/** A macrotask: a `WeakRef` keeps its target alive to the end of the task that made or read it. */
const task = () => new Promise((resolve) => setTimeout(resolve, 0))

it('adds its font and style listeners once, after every diagram is gone and a new one comes', async () => {
  const added: string[] = []
  const add = document.fonts.addEventListener.bind(document.fonts)
  document.fonts.addEventListener = ((type: string, ...rest: [EventListener]) => {
    added.push(type)
    add(type, ...rest)
  }) as typeof document.fonts.addEventListener
  let observed = 0
  const observe = MutationObserver.prototype.observe
  MutationObserver.prototype.observe = function (this: MutationObserver, ...args) {
    observed += 1
    observe.apply(this, args)
  }
  try {
    const first = new WeakRef(new StateDiagram({ link: () => {} }))
    await task()
    await collect()
    await task()
    expect(first.deref(), 'the first diagram to be collected').toBeUndefined()
    // A STYLE CHANGE, WHICH FINDS THE FIRST DIAGRAM GONE: the listeners then serve no diagram.
    document.documentElement.setAttribute('data-style', 'terminal')
    await task()
    document.documentElement.removeAttribute('data-style')
    await task()
    const second = new StateDiagram({ link: () => {} })
    expect(second.el).toBeInstanceOf(HTMLElement)
    expect(added.filter((type) => type === 'loadingdone')).toEqual(['loadingdone'])
    expect(observed).toBe(1)
  } finally {
    MutationObserver.prototype.observe = observe
    document.fonts.addEventListener = add
  }
})
