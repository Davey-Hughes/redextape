import type { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { KEY_STEP } from '../../src/layout-view'
import { parseWorkspace } from '../../src/workspace'
import { SHELL, storeFourViews } from './harness'

/**
 * A DIVIDER DRAG, THROUGH `main()`.
 *
 * `layout-view.test.ts` drags one, but against a `ResizeHandlers` stub whose `resize` only records the call
 * and whose `commit` does nothing — neither rebuilds the tree, so the divider it grabs stays alive for the
 * whole test, which is precisely the condition the real app does not provide.
 *
 * THE DEFECT THIS FILE PINS. A `pointermove` that reached `applyLayout` -> `renderLayout` ->
 * `replaceChildren()` would destroy the divider holding the drag on its own first frame, so a drag would
 * move one frame's worth and then stop dead. `does not destroy the divider being dragged` below is the
 * direct guard: the grabbed node is still in the document after every move.
 */

/**
 * A genuinely fresh module instance of `main.ts` per mount, by cache-busting query string.
 *
 * `main.ts` computes `ready` once at import evaluation and does not export `main`, so a second bare
 * import returns the same cached module and mounts nothing. Vite's dev server keys its module graph on
 * the full specifier including the query, so `?remount=N` is a distinct module realm. This is
 * `tm-buffer-restore.test.ts`'s mechanism verbatim; that file's own doc carries the long form.
 */
let remountSeq = 0
async function freshMain(): Promise<{ ready: Promise<EditorView> }> {
  const spec = remountSeq === 0 ? '../../src/main' : `../../src/main?remount=${remountSeq}`
  remountSeq += 1
  return import(/* @vite-ignore */ spec)
}

async function mountApp(): Promise<void> {
  localStorage.clear()
  // ALL FOUR VIEWS: an empty store opens on the source and TM.
  storeFourViews()
  document.body.innerHTML = SHELL
  await (await freshMain()).ready
}

/** Simulate a reload: the same `localStorage`, a fresh page and a fresh module realm. */
async function remountApp(): Promise<void> {
  document.body.innerHTML = SHELL
  await (await freshMain()).ready
}

const rootEl = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('main')
  if (el === null) throw new Error('no main element')
  return el
}

/** The vertical divider — the one inside the source|λ row split, addressed as path [0] index 0. */
const verticalDivider = (): HTMLElement => {
  const el = rootEl().querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]')
  if (el === null) throw new Error('no vertical divider')
  return el
}

/** The stored inner-row sizes — what a drag on the vertical divider moves. */
const storedRowSizes = (): number[] => {
  const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
  if (raw === null) throw new Error('nothing stored')
  const tree = parseWorkspace(raw)?.tree ?? null
  if (tree === null || tree.kind !== 'split') throw new Error('stored tree is not a split')
  const inner = tree.children[0]
  if (inner === undefined || inner.kind !== 'split') throw new Error('stored inner node is not a split')
  return inner.sizes
}

const pointer = (type: string, x: number): PointerEvent =>
  new PointerEvent(type, { bubbles: true, clientX: x, clientY: 300, pointerId: 1 })

describe('dragging a divider on a mounted app', () => {
  /**
   * **THE DIVIDER SAYS WHAT IT RESIZES, IN THE WORD THE APP USES** — Plan 7 part 2 spec §12: a pane is a
   * view. Nothing else in the tier reads this name, so without this assertion it could change and every
   * test would stay green.
   */
  it('names what it resizes', () => {
    expect(verticalDivider().getAttribute('aria-label')).toBe('resize views left and right')
    const horizontal = document.querySelector<HTMLElement>('[role="separator"][aria-orientation="horizontal"]')
    expect(horizontal?.getAttribute('aria-label')).toBe('resize views up and down')
  })

  beforeEach(async () => {
    await mountApp()
  })

  // UNCONDITIONAL, NOT A TRAILING `mockRestore()` AFTER THE ASSERTIONS. A `mockRestore()` placed after
  // an assertion never runs when that assertion throws, and `tests/browser/setup.ts`'s plain-object
  // `Storage` shim has `setItem` as an own property — so a leaked spy stays installed for the rest of
  // this file, and the next `vi.spyOn` in a later test returns that same spy with its accumulated call
  // history rather than a fresh one.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not destroy the divider being dragged', () => {
    const divider = verticalDivider()
    divider.dispatchEvent(pointer('pointerdown', 400))

    for (const x of [420, 440, 460]) {
      divider.dispatchEvent(pointer('pointermove', x))
      // The defect the file doc names, in one assertion: with it, this is `false` after the FIRST move.
      expect(rootEl().contains(divider)).toBe(true)
    }

    divider.dispatchEvent(pointer('pointerup', 460))
  })

  it('tracks the pointer for the whole drag, not one frame of it', () => {
    const divider = verticalDivider()
    const span = divider.parentElement?.getBoundingClientRect().width ?? 0
    expect(span).toBeGreaterThan(0)

    divider.dispatchEvent(pointer('pointerdown', 400))
    for (const x of [420, 440, 460]) divider.dispatchEvent(pointer('pointermove', x))
    divider.dispatchEvent(pointer('pointerup', 460))

    // 60px of travel against the measured split extent. A drag that died on its first frame would land
    // only the first 20px.
    const [first] = storedRowSizes()
    expect(first).toBeCloseTo(0.5 + 60 / span, 3)
  })

  it('writes storage once for the gesture, not once per frame', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const divider = verticalDivider()

    divider.dispatchEvent(pointer('pointerdown', 400))
    for (const x of [420, 440, 460]) divider.dispatchEvent(pointer('pointermove', x))
    const midDrag = setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length
    divider.dispatchEvent(pointer('pointerup', 460))
    const total = setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length

    expect(midDrag).toBe(0)
    expect(total).toBe(1)
  })

  it('keeps aria-valuenow truthful during the drag, not only after it', () => {
    const divider = verticalDivider()
    expect(divider.getAttribute('aria-valuenow')).toBe('50')

    divider.dispatchEvent(pointer('pointerdown', 400))
    divider.dispatchEvent(pointer('pointermove', 480))

    // Mid-gesture, before any commit. `syncSizes` is the only thing that could have written this.
    expect(Number(divider.getAttribute('aria-valuenow'))).toBeGreaterThan(50)
    divider.dispatchEvent(pointer('pointerup', 480))
  })

  it('writes nothing for a press and release that never moved', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const divider = verticalDivider()

    divider.dispatchEvent(pointer('pointerdown', 400))
    divider.dispatchEvent(pointer('pointerup', 400))

    expect(setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length).toBe(0)
  })

  it('writes nothing for a pointermove that never changes coordinate', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const divider = verticalDivider()

    divider.dispatchEvent(pointer('pointerdown', 400))
    // Browsers do emit `pointermove` at an unchanged coordinate. None of these carry any displacement,
    // so none should arm the commit — unlike the "never moved" test above, this gesture DOES see
    // `pointermove` events, just none that go anywhere.
    divider.dispatchEvent(pointer('pointermove', 400))
    divider.dispatchEvent(pointer('pointermove', 400))
    divider.dispatchEvent(pointer('pointerup', 400))

    expect(setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length).toBe(0)
  })
})

describe('dragging a divider a second time, after the first drag commits and rebuilds it', () => {
  beforeEach(async () => {
    await mountApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // EVERY GESTURE COMMIT REACHES `applyLayout()` -> `renderLayout()` -> `replaceChildren()`, which
  // rebuilds every divider — so the divider a SECOND gesture grabs is a different element from the one
  // the first gesture grabbed. This is the shape closest to the defect the file doc names (a drag dying
  // on its own first frame), and no test above drags twice.
  it('moves the layout by both drags in full, off a freshly re-queried divider', () => {
    const first = verticalDivider()
    const span = first.parentElement?.getBoundingClientRect().width ?? 0
    expect(span).toBeGreaterThan(0)

    first.dispatchEvent(pointer('pointerdown', 400))
    for (const x of [420, 440, 460]) first.dispatchEvent(pointer('pointermove', x))
    first.dispatchEvent(pointer('pointerup', 460))

    const afterFirst = storedRowSizes()[0]
    if (afterFirst === undefined) throw new Error('no size after first drag')
    expect(afterFirst).toBeCloseTo(0.5 + 60 / span, 3)

    // The commit above rebuilt the tree, so `first` is no longer in the document — grabbing it again
    // would test nothing, since a stale reference is not what a real second gesture starts from. THE
    // RE-QUERY IS THE POINT: it is what makes this test exercise the rebuilt element rather than the one
    // the first drag happened to grab.
    expect(rootEl().contains(first)).toBe(false)
    const second = verticalDivider()
    expect(second).not.toBe(first)

    second.dispatchEvent(pointer('pointerdown', 500))
    for (const x of [520, 540, 560]) second.dispatchEvent(pointer('pointermove', x))
    second.dispatchEvent(pointer('pointerup', 560))

    const afterSecond = storedRowSizes()[0]
    if (afterSecond === undefined) throw new Error('no size after second drag')
    // The second drag's own 60px of travel, ADDED ON TOP OF the first — not measured against the
    // original 0.5 baseline. A drag that silently died on its own first frame (this file's namesake
    // defect, reproduced on a fresh element rather than the original one) or a `last` that failed to
    // reset across the rebuild would both under-report this delta instead of compounding it.
    expect(afterSecond).toBeCloseTo(afterFirst + 60 / span, 3)
  })
})

describe('resizing a divider from the keyboard', () => {
  beforeEach(async () => {
    await mountApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const key = (type: string, k: string): KeyboardEvent => new KeyboardEvent(type, { key: k, bubbles: true })

  it('moves once per keydown and writes once per keyup, not once per keydown', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const divider = verticalDivider()
    divider.focus()

    // Auto-repeat: a held arrow key sends many keydowns and exactly one keyup.
    for (let i = 0; i < 3; i += 1) divider.dispatchEvent(key('keydown', 'ArrowRight'))
    const held = setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length
    divider.dispatchEvent(key('keyup', 'ArrowRight'))
    const released = setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length

    expect(held).toBe(0)
    expect(released).toBe(1)
    expect(storedRowSizes()[0]).toBeCloseTo(0.5 + 3 * KEY_STEP, 5)
    setItem.mockRestore()
  })

  it('ignores an unrelated keyup mid-hold, so a still-held arrow key commits exactly once', () => {
    // `armedKey` TRACKS WHICH KEY ARMED THE GESTURE, so a modifier pressed and released while the arrow
    // key is still down (a Shift chord, a stray keystroke) finds no match and commits nothing. A bare
    // boolean consumed by ANY keyup would fire the commit early; auto-repeat would then re-arm the gesture
    // for the still-held arrow key, and the arrow's OWN eventual keyup would commit a second time: two
    // writes for one continuous gesture, against the one-write-per-gesture invariant this path exists to
    // establish. The assertion right after the `Shift` keyup is the one that states it: zero writes so
    // far, before the arrow key is ever released. The `keydown('ArrowRight')` that follows stands in for
    // auto-repeat, which keeps re-arming the gesture with the arrow key while it stays held — without it,
    // the boolean would write once, not twice, and the final count alone could not tell it apart from
    // `armedKey` (both land on 1).
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const divider = verticalDivider()
    divider.focus()
    const writes = (): number => setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length

    divider.dispatchEvent(key('keydown', 'ArrowRight'))
    divider.dispatchEvent(key('keydown', 'Shift'))
    divider.dispatchEvent(key('keyup', 'Shift'))
    expect(writes()).toBe(0)
    divider.dispatchEvent(key('keydown', 'ArrowRight'))
    divider.dispatchEvent(key('keyup', 'ArrowRight'))

    expect(writes()).toBe(1)
  })

  it('commits on blur, so a layout is not lost when focus leaves mid-hold', () => {
    const divider = verticalDivider()
    divider.focus()
    divider.dispatchEvent(key('keydown', 'ArrowRight'))
    divider.dispatchEvent(new FocusEvent('blur', { bubbles: false }))

    expect(storedRowSizes()[0]).toBeCloseTo(0.5 + KEY_STEP, 5)
  })

  it('writes nothing when a key that is not an arrow is pressed and released', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const divider = verticalDivider()
    divider.focus()

    divider.dispatchEvent(key('keydown', 'Enter'))
    divider.dispatchEvent(key('keyup', 'Enter'))

    expect(setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length).toBe(0)
    setItem.mockRestore()
  })

  it('keeps the focused divider focusable across a whole held press', () => {
    const divider = verticalDivider()
    divider.focus()
    for (let i = 0; i < 3; i += 1) {
      divider.dispatchEvent(key('keydown', 'ArrowRight'))
      // The node itself survives each keydown, which is a stronger statement than "something has focus":
      // a keydown that rebuilt the tree would leave `renderLayout`'s rescue to focus a NEW node.
      expect(document.activeElement).toBe(divider)
    }
    divider.dispatchEvent(key('keyup', 'ArrowRight'))
  })
})

describe('a dragged layout across a reload', () => {
  it('comes back where it was dragged to', async () => {
    await mountApp()
    const divider = verticalDivider()
    const span = divider.parentElement?.getBoundingClientRect().width ?? 0
    expect(span).toBeGreaterThan(0)

    divider.dispatchEvent(pointer('pointerdown', 400))
    for (const x of [420, 440, 460]) divider.dispatchEvent(pointer('pointermove', x))
    divider.dispatchEvent(pointer('pointerup', 460))

    const dragged = storedRowSizes()[0]
    if (dragged === undefined) throw new Error('no dragged size')
    expect(dragged).toBeCloseTo(0.5 + 60 / span, 3)

    await remountApp()

    // The claim is about the PAGE, not about storage: storage was already asserted above. What this
    // adds is that the restored tree puts the fraction back on screen.
    expect(storedRowSizes()[0]).toBeCloseTo(dragged, 5)
    expect(verticalDivider().getAttribute('aria-valuenow')).toBe(String(Math.round(dragged * 100)))
  })
})
