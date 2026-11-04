import { afterAll, expect, it } from 'vitest'
import { server } from 'vitest/browser'
import { chromiumOnly, mousePointerId } from './engine'

/**
 * `engine.ts`'s own checks. The gate's is read in `afterAll` against the engine's raw name, not against `CHROMIUM`,
 * so a gate that skipped in Chromium, or a `CHROMIUM` that read the wrong name, fails Chromium's run.
 */
let entered = false
let past = false

afterAll(() => {
  // A `-t` filter that leaves the gate's case out never enters it, and leaves nothing to check.
  if (!entered) return
  expect(past, `the gate let its test past in ${server.browser}`).toBe(server.browser === 'chromium')
})

it('runs a test behind the gate in Chromium alone', (ctx) => {
  entered = true
  chromiumOnly(ctx, 'the gate’s own case, which runs in Chromium alone')
  past = true
})

it('takes a synthetic press that carries the id a real move reported, and its capture does not throw', async () => {
  const id = await mousePointerId()
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;left:100px;top:100px;width:100px;height:100px'
  document.body.append(el)
  let thrown: unknown = null
  el.addEventListener('pointerdown', (e) => {
    try {
      el.setPointerCapture(e.pointerId)
    } catch (err) {
      thrown = err
    }
  })
  const at = { bubbles: true, pointerId: id, isPrimary: true, clientX: 150, clientY: 150 }
  el.dispatchEvent(new PointerEvent('pointerdown', at))
  el.dispatchEvent(new PointerEvent('pointerup', at))
  el.remove()
  // THE THROW IS WHAT SHOWS: `hasPointerCapture` reads false after a synthetic press in both engines, taken or not.
  expect(thrown).toBeNull()
})
