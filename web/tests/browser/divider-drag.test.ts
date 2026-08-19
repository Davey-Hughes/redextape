import type { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LAYOUT_STORAGE_KEY, parseLayout } from '../../src/layout'
import { KEY_STEP } from '../../src/layout-view'

/**
 * A DIVIDER DRAG, THROUGH `main()` — the test 5d-ii-a said did not exist, and the reason a broken drag
 * survived every slice since.
 *
 * That entry filed the gap in as many words: "no test drags a divider on a tree `main()` mounted and
 * then reads back what was stored." `layout-view.test.ts` drags one, but against an inert
 * `ResizeHandlers` stub whose `resize` and `commit` are both no-ops — so the divider it grabs stays
 * alive for the whole test, which is precisely the condition the real app does not provide.
 *
 * THE DEFECT THIS FILE PINS. `pointermove` reached `applyLayout` -> `renderLayout` ->
 * `replaceChildren()`, destroying the divider holding the drag on its own first frame. A drag moved one
 * frame's worth and then stopped dead. Test 1 below is the direct guard: the grabbed node is still in
 * the document after every move.
 */

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

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
  const tree = parseLayout(raw)
  if (tree === null || tree.kind !== 'split') throw new Error('stored tree is not a split')
  const inner = tree.children[0]
  if (inner === undefined || inner.kind !== 'split') throw new Error('stored inner node is not a split')
  return inner.sizes
}

const pointer = (type: string, x: number): PointerEvent =>
  new PointerEvent(type, { bubbles: true, clientX: x, clientY: 300, pointerId: 1 })

describe('dragging a divider on a mounted app', () => {
  beforeEach(async () => {
    await mountApp()
  })

  // UNCONDITIONAL, NOT A TRAILING `mockRestore()` AFTER THE ASSERTIONS. A `mockRestore()` placed after
  // an assertion never runs when that assertion throws, and `tests/browser/setup.ts`'s plain-object
  // `Storage` shim has `setItem` as an own property — so a leaked spy stays installed for the rest of
  // this file, and the next `vi.spyOn` in a later test returns that same spy with its accumulated call
  // history rather than a fresh one. This bit once: a failed assertion here leaked a spy that made an
  // unrelated later test report writes that never happened.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not destroy the divider being dragged', () => {
    const divider = verticalDivider()
    divider.dispatchEvent(pointer('pointerdown', 400))

    for (const x of [420, 440, 460]) {
      divider.dispatchEvent(pointer('pointermove', x))
      // The whole defect, in one assertion. Before the fix this is `false` after the FIRST move.
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

    // 60px of travel against the measured split extent. Before the fix only the first 20px landed.
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
  // the first gesture grabbed. This is the shape closest to the original defect (a drag dying on its own
  // first frame) that no other test in the default suite exercises: everything above drags exactly once.
  // Only `pane-floor.test.ts` drags twice, and it is a `PROBE_FILES` member excluded from CI.
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

  it('ignores an unrelated keyup mid-hold, so a still-held arrow key commits exactly once — Important finding, review of this task', () => {
    // `commitKeys` used to check only a boolean `keyMoved`, so ANY keyup on the focused divider consumed
    // the arming — a modifier pressed and released while the arrow key was still down (a Shift chord, a
    // stray keystroke) fired the commit early. Auto-repeat then re-armed the gesture for the still-held
    // arrow key, and the arrow's OWN eventual keyup committed a second time: two writes for one
    // continuous gesture, against the one-write-per-gesture invariant this path exists to establish.
    // `armedKey` fixes it by tracking WHICH key armed the gesture, so the unrelated key's keyup finds no
    // match and commits nothing. The assertion right after the `Shift` keyup is the one that actually
    // states that: zero writes so far, before the arrow key is ever released. The `keydown('ArrowRight')`
    // that follows stands in for auto-repeat, which keeps re-arming the gesture with the arrow key while
    // it stays held — without it, the bug this test is named for writes twice, not once, and the final
    // count alone can't tell the two apart from the fixed behaviour (both land on 1).
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
      // Before this slice each keydown rebuilt the tree and `renderLayout`'s rescue re-focused a NEW
      // node. Now the node itself survives, which is a stronger statement than "something has focus".
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
