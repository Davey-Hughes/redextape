import { expect, it } from 'vitest'
import { hearLoops } from './harness'

/**
 * `harness.ts`'s `hearLoops`, HELD BY CASES THAT MUST FAIL. An `it.fails` case passes only where the listener's hook
 * failed it, and a plain case only where the hook found nothing against it: the error, the loop and the teardown of
 * the case before are each that case's own.
 */

let observer: ResizeObserver | null = null
let looped: HTMLElement | null = null

hearLoops(() => {
  observer?.disconnect()
  observer = null
  document.body.replaceChildren()
})

/** Put an element on the page whose observer resizes it once, which the browser reports as a loop at its next frame. */
function loop(): void {
  const el = document.createElement('div')
  el.style.cssText = 'width: 100px; height: 100px'
  document.body.append(el)
  let seen = 0
  observer = new ResizeObserver(() => {
    if (seen++ === 0) el.style.height = '150px'
  })
  observer.observe(el)
  looped = el
}

it.fails('fails a case in which a timer throws, which Vitest itself no longer does', async () => {
  setTimeout(() => {
    throw new Error('thrown in a timer, for hearLoops to hear')
  }, 0)
  await new Promise((r) => setTimeout(r, 20))
})

it('counts an error against the case it came in, and not the next', () => {})

it.fails('fails a case whose last write causes a loop, though the case waits for no frame', () => {
  loop()
})

it('has run the file’s teardown by the next case, which the loop is not counted against', () => {
  expect(looped?.isConnected, 'the element of the case before is still on the page').toBe(false)
})
