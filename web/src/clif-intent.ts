/**
 * How long the pointer rests on the CLIF toggle before `pkg-clif` is fetched: long enough that a pointer passing over
 * the header on its way elsewhere fetches nothing, short enough that the load starts before the press.
 */
export const INTENT_MS = 150

/**
 * `fetch` once the pointer has rested on `el` for `INTENT_MS`, or at once when `el` takes focus. **A POINTER THAT
 * LEAVES FIRST FETCHES NOTHING**, and a focus fetches at once because a keyboard user's next key may be the press.
 * `fetch` is called on every such intent, so the caller decides whether one is still needed.
 */
export function watchIntent(el: HTMLElement, fetch: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  el.addEventListener('pointerenter', () => {
    clearTimeout(timer)
    timer = setTimeout(fetch, INTENT_MS)
  })
  el.addEventListener('pointerleave', () => clearTimeout(timer))
  el.addEventListener('focus', fetch)
}
