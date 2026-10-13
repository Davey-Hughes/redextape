/**
 * THE GESTURE OF A `role="separator"` THAT IS DRAGGED OR MOVED BY ARROW KEYS — the layout's dividers
 * (`layout-view.ts`) and the boundaries between a view's panels (`panel-stack.ts`) are both this, in one
 * implementation (the view layouts spec §11.2).
 *
 * IT REPORTS PIXELS AND STEPS, NEVER A FRACTION OR A SHARE. What a pixel is worth is the caller's to say: a layout
 * divider divides by its split's extent, and a panel boundary moves two heights by it.
 *
 * IT IS A GESTURE WITH FRAMES AND ONE END. `drag` and `step` are called at pointer rate and at a held key's repeat
 * rate, and must be cheap; `commit` runs once, where the caller reconciles and stores.
 */
export interface SeparatorHandlers {
  /**
   * Whether a pointer frame can move anything at all. Asked BEFORE the gesture is armed, so a frame that cannot move
   * (a split box with no extent) arms no commit.
   */
  ready?(): boolean
  /** One pointer frame: the pointer moved `px` along the axis since the last frame, never 0. */
  drag(px: number): void
  /** One arrow press, or one repeat of a held one: a step back (`-1`) or forward (`1`). */
  step(sign: -1 | 1): void
  /** The gesture is over, and it moved. */
  commit(): void
  /** A double click, or `Enter` on the focused separator. A separator that takes no reset passes none. */
  reset?(): void
}

/** `'x'` for a separator that parts things left and right, `'y'` for one that parts them up and down. */
export type SeparatorAxis = 'x' | 'y'

/**
 * The pointer's half of the gesture, on any element: a press, frames under capture, and one commit if it moved.
 *
 * `accept` IS ASKED AT THE PRESS, and a press it refuses starts nothing and is left to whatever else hears it: a
 * panel's header is a handle for the boundary above it (`panel-stack.ts`), and a press on one of the header's own
 * buttons is the button's.
 */
export function pointerDrag(
  el: HTMLElement,
  axis: SeparatorAxis,
  handlers: Pick<SeparatorHandlers, 'ready' | 'drag' | 'commit' | 'reset'>,
  accept: (e: MouseEvent) => boolean = () => true,
): void {
  let dragging = false
  let moved = false
  let last = 0
  /** The pointer the press was made with: another pointer's release, heard on the document, is not this one's. */
  let pointer = -1

  el.addEventListener('pointerdown', (e) => {
    if (!accept(e)) return
    dragging = true
    pointer = e.pointerId
    // HELD, FOR THE STYLESHEET: a handle that draws a hand draws it closed from the press to the release.
    el.dataset.dragging = 'true'
    // THE RELEASE IS HEARD ON THE DOCUMENT TOO. A handle taken off the page under a press loses the pointer's
    // capture, put back or not, and the release then goes to whatever is under the pointer: the handle heard none,
    // stayed held, and its caller's gesture never ended. With the capture in place the handle hears the release
    // first and `stop` takes these two off again.
    el.ownerDocument.addEventListener('pointerup', stop, true)
    el.ownerDocument.addEventListener('pointercancel', stop, true)
    moved = false
    last = axis === 'x' ? e.clientX : e.clientY
    // BEFORE `setPointerCapture`, NOT AFTER. Capture throws `NotFoundError` for a synthetic
    // `PointerEvent` whose `pointerId` is anything other than `1` — measured directly (ids `0` and `2`
    // both throw, `1` never does) — because `1` is the reserved mouse-pointer id and is always active,
    // even on a page's very first `pointerdown`. Every synthetic pointer event this suite dispatches
    // uses `pointerId: 1` for exactly that reason, so nothing here throws today — but if a future test
    // ever used a different id, `preventDefault` is what stops a drag from selecting text across the
    // panes, so it must not be the thing a throw skips.
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
  })

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const now = axis === 'x' ? e.clientX : e.clientY
    // `now !== last` — A ZERO-DISPLACEMENT MOVE DOES NOT ARM THE COMMIT. Browsers do emit `pointermove`
    // at an unchanged coordinate, and without this guard such an event would call `handlers.drag` with
    // 0, set `moved`, and make `pointerup` run a full reconcile-and-write for a gesture that
    // changed nothing — exactly the no-op `stop` below says it avoids.
    if (now !== last && (handlers.ready?.() ?? true)) {
      // `moved` IS SET BEFORE `handlers.drag` RUNS, NOT AFTER. The frame handler advances a model before it
      // writes the DOM, which has throw paths of its own — so if it throws, setting `moved` only after return
      // would leave the model advanced but the gesture uncommittable, and `pointerup` would commit nothing.
      // Arming first keeps this gesture committable even when the frame handler throws.
      moved = true
      handlers.drag(now - last)
    }
    last = now
  })

  // THE END OF THE GESTURE IS WHERE IT IS COMMITTED — see `SeparatorHandlers`. A press and
  // release that never moved commits nothing rather than firing a full reconcile-and-write for a no-op.
  const stop = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointer) return
    dragging = false
    delete el.dataset.dragging
    el.ownerDocument.removeEventListener('pointerup', stop, true)
    el.ownerDocument.removeEventListener('pointercancel', stop, true)
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (moved) handlers.commit()
    moved = false
  }
  el.addEventListener('pointerup', stop)
  el.addEventListener('pointercancel', stop)

  if (handlers.reset !== undefined) {
    const reset = handlers.reset
    el.addEventListener('dblclick', (e) => {
      if (accept(e)) reset()
    })
  }
}

export function separatorGesture(el: HTMLElement, axis: SeparatorAxis, handlers: SeparatorHandlers): void {
  pointerDrag(el, axis, handlers)

  // THE KEYBOARD PATH. `Home`/`End` are deliberately absent: they would mean "collapse this to its floor",
  // which a close control already says better and unambiguously.
  //
  // IT IS A GESTURE, EXACTLY LIKE A DRAG. Auto-repeat sends many `keydown`s and one `keyup`, so a held
  // arrow key is N cheap frames and one storage write rather than N full rebuilds — the same shape the
  // pointer path takes above, for the same reason.
  let armedKey: string | null = null

  el.addEventListener('keydown', (e) => {
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    let sign: -1 | 1
    if (e.key === forward) sign = 1
    else if (e.key === back) sign = -1
    else {
      if (e.key === 'Enter' && handlers.reset !== undefined) {
        handlers.reset()
        e.preventDefault()
      }
      return
    }
    // `armedKey` IS SET BEFORE `handlers.step` RUNS, NOT AFTER — the same ordering `pointermove`
    // uses above and for the same reason: if the frame handler throws, `keyup`/`blur` must still find
    // the gesture committable rather than silently discarding a model that already advanced.
    armedKey = e.key
    handlers.step(sign)
    e.preventDefault()
  })

  // `blur` COMMITS TOO, AND IT IS NOT BELT-AND-BRACES. `keyup` never arrives if focus leaves while the
  // key is down — a click into a pane, a `Tab` chord, the window losing focus — and the frames already
  // moved the model, so without this what is on screen and what is stored disagree until the next
  // unrelated write happens to reconcile them.
  //
  // `keyup` COMMITS ONLY WHEN THE RELEASED KEY IS THE ONE THAT ARMED THE GESTURE. A held arrow key's own
  // `keyup` is not the only `keyup` a separator can see while it holds focus: the user can press and release
  // an UNRELATED key — a modifier, a stray keystroke — without ever releasing the arrow. `armedKey` records
  // WHICH key armed the current gesture rather than merely THAT some key did, so an unrelated key's `keyup`
  // finds no match, calls nothing, and leaves the gesture armed; auto-repeat then keeps re-arming it with the
  // arrow key itself, and the arrow's own eventual `keyup` is what actually commits. Without this the unrelated
  // `keyup` mid-hold consumed the arming and wrote to storage early, and the arrow's later `keyup` — re-armed by
  // auto-repeat in between — committed a SECOND time: two writes for one continuous gesture, against the
  // one-write-per-gesture invariant this path exists to establish. `blur` has no released key to compare
  // against — focus can leave from a click or a `Tab` with no `keyup` involved at all — so it stays
  // unconditional on anything but arming: any armed gesture commits when focus goes.
  const commitKeys = (): void => {
    // A `blur` FIRED BY A REBUILD THAT TOOK THE SEPARATOR OFF THE PAGE MUST NOT COMMIT. `renderLayout`'s
    // `root.replaceChildren()` removes a focused divider mid-rebuild, and Chromium fires `blur` on an
    // element the instant it is removed while focused — so this handler can be reached from INSIDE
    // `applyLayout`'s own `renderLayout` call, not only from a user releasing focus. Letting that
    // `blur` reach `handlers.commit()` would re-enter `applyLayout` from inside its own `renderLayout`:
    // the outer call would go on to append a second tree box, and `syncSizes`'s anchor
    // (`root.firstElementChild`) would then point at a stale one. `el.isConnected` is what tells the
    // two cases apart — false exactly when this separator has already been detached by the rebuild we are
    // inside — so bailing here makes the ordering safe by design rather than merely by the
    // set-before-call ordering that happens to prevent re-entrancy today.
    if (!el.isConnected) {
      armedKey = null
      return
    }
    if (armedKey === null) return
    armedKey = null
    handlers.commit()
  }
  el.addEventListener('keyup', (e) => {
    if (e.key === armedKey) commitKeys()
  })
  el.addEventListener('blur', commitKeys)
}
