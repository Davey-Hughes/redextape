/**
 * How long the pointer rests on the CLIF toggle before `pkg-clif` is fetched: long enough that a pointer passing over
 * the header on its way elsewhere fetches nothing, short enough that the load starts before the press.
 */
export const INTENT_MS = 150

/**
 * `fetch` once a pointer that moved onto `el` has stayed on it for `INTENT_MS`, or at once when `el` is pressed or
 * takes focus. **A POINTER THAT LEAVES FIRST FETCHES NOTHING**. A press fetches at once because the click that shows
 * the view comes only at its release, and not every browser focuses a pressed button; a focus, because a keyboard
 * user's next key may be the press. **THE REST STARTS AT A MOVE, NOT AT `pointerenter`**: a browser sends
 * `pointerenter` when a layout puts `el` under a pointer that has not moved, as a view drawn under it does, and no one
 * meant that. **EACH ENTRY STARTS CLEAN**: an element moved from under a resting pointer is sent no `pointerleave`, and
 * a rest it kept would stop its next rest asking, which a failed load needs to retry. `fetch` is called on every such
 * intent, so the caller decides whether one is still needed.
 */
export function watchIntent(el: HTMLElement, fetch: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let resting = false
  const stop = (): void => {
    clearTimeout(timer)
    resting = false
  }
  el.addEventListener('pointermove', () => {
    if (resting) return
    resting = true
    timer = setTimeout(fetch, INTENT_MS)
  })
  el.addEventListener('pointerenter', stop)
  el.addEventListener('pointerleave', stop)
  el.addEventListener('pointerdown', fetch)
  el.addEventListener('focus', fetch)
}
