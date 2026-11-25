/**
 * How long the pointer rests on the CLIF toggle before `pkg-clif` is fetched: long enough that a pointer passing over
 * the header on its way elsewhere fetches nothing, short enough that the load starts before the press.
 */
export const INTENT_MS = 150

/**
 * `fetch` once a pointer that moved onto `el` has stayed on it for `INTENT_MS`, or at once when `el` is pressed or
 * takes focus. **A POINTER THAT LEAVES FIRST FETCHES NOTHING**, and a press or a focus fetches at once because a
 * keyboard user's next key may be the press. **THE REST STARTS AT A MOVE, NOT AT `pointerenter`**: a browser sends
 * `pointerenter` when a layout puts `el` under a pointer that has not moved, as a view drawn under it does, and no one
 * meant that. `fetch` is called on every such intent, so the caller decides whether one is still needed.
 */
export function watchIntent(el: HTMLElement, fetch: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let resting = false
  el.addEventListener('pointermove', () => {
    if (resting) return
    resting = true
    timer = setTimeout(fetch, INTENT_MS)
  })
  el.addEventListener('pointerleave', () => {
    clearTimeout(timer)
    resting = false
  })
  el.addEventListener('pointerdown', fetch)
  el.addEventListener('focus', fetch)
}
