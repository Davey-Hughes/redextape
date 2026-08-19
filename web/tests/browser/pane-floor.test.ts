import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { MIN_PANE_FRACTION } from '../../src/layout'

/**
 * WHAT A PANE LOOKS LIKE AT THE FLOOR — the measurement `MIN_PANE_FRACTION`'s own doc asks for and no
 * slice could take, because taking it requires a divider drag that survives past its first frame.
 *
 * A PROBE, NOT A TEST: it asserts almost nothing and prints numbers. `vite.config.ts` excludes it from
 * the default browser run for the reason every probe here is excluded — it is a measurement whose
 * output is a reading, and a reading that fails a suite is a reading nobody will take twice.
 *
 * THE WIDTHS AND HEIGHTS ARE BOTH IMPOSED, AND THAT IS THE POINT RATHER THAN THE FLAW. 5d-ii-a's
 * headline finding was that a test container given a size the real page never gets is measuring a
 * fiction — true of a test asserting behaviour, and inapplicable here, where window size is the
 * INDEPENDENT VARIABLE. A fraction floor yields a different pixel floor at every size; that
 * relationship is what is being measured, on both axes.
 *
 * TWO DIVIDERS, BECAUSE THE DEFAULT TREE HAS TWO KINDS OF SQUEEZE. `defaultLayout()` nests a `row`
 * split (source | λ, a WIDTH constraint) inside a `column` split (that row above the `tm` leaf, a
 * HEIGHT constraint). Each divider is dragged hard past the floor in its own axis — `clientX` for the
 * vertical (row) divider, `clientY` for the horizontal (column) one — so every pane kind's OWN floor
 * gets measured rather than TM's height being inferred from source's width by analogy.
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

let remountSeq = 0
async function freshMain(): Promise<{ ready: Promise<EditorView> }> {
  const spec = remountSeq === 0 ? '../../src/main' : `../../src/main?remount=${remountSeq}`
  remountSeq += 1
  return import(/* @vite-ignore */ spec)
}

/**
 * Dispatch `src` and wait for the compile it triggers to land — `app.test.ts`'s own `settled` helper,
 * same invariant and same reasoning (not re-derived here): `compile.schedule`'s debounce means TM's
 * `.cells`/tapes and λ's rendered term do not exist the instant `dispatch` returns, only once
 * `#results` reports `idle` with real text. Without this wait, TM and λ are caught mid-debounce with
 * nothing painted, and this probe's own `overflowRatio` would read `n/a` for a reason that has nothing
 * to do with the floor.
 */
async function settled(v: EditorView, src: string): Promise<void> {
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: src } })
  const deadline = performance.now() + 30_000
  while (
    document.querySelector<HTMLElement>('#results')?.dataset.state !== 'idle' ||
    (document.querySelector('#results')?.textContent ?? '') === ''
  ) {
    if (performance.now() > deadline) throw new Error('timed out waiting for the compile to settle')
    await new Promise((r) => setTimeout(r, 50))
  }
}

/**
 * Window size, imposed on `main` directly rather than left to the real tester viewport.
 *
 * PAIRED WITH A REALISTIC HEIGHT, NOT JUST A WIDTH. A pixel width means nothing without a pixel
 * height beside it once the floor being measured is a height floor — an unconstrained container
 * height would just borrow whatever the tester's actual browser window happens to be, which is
 * exactly the "fiction" the module doc above warns against, applied to the axis this probe used to
 * leave alone.
 */
const SIZES: { width: number; height: number }[] = [
  { width: 900, height: 600 },
  { width: 1200, height: 800 },
  { width: 1920, height: 1080 },
]

/**
 * `selector`'s worth of content against `el`'s box, as a RATIO rather than a boolean.
 *
 * NEITHER `source`/`lambda` NOR `tm` EVER OVERFLOW AT THE ELEMENT `[data-leaf]` NAMES — CodeMirror's
 * `.cm-scroller` and TM's `.cells` both carry their own `overflow-x: auto` one level in, so all the
 * real overflow lands there and the outer `.pane` element's own `scrollWidth`/`clientWidth` agree no
 * matter how hard the pane is squeezed. A boolean read from the outer element (`clipped`, this
 * probe's first cut) is therefore not discriminating: it reads `false` whether the pane is roomy or
 * scrolling nine characters at a time, which is worse than not measuring at all — a future reader
 * would take it as reassurance it never earned. Measuring the INNER scroller and reporting the RATIO
 * fixes both problems at once: it inspects the element that genuinely overflows, and a number says
 * how bad the squeeze is instead of only that a boundary was crossed.
 */
function overflowRatio(el: HTMLElement | null, selector: string): string {
  if (el === null) return 'n/a'
  const scrollers = [...el.querySelectorAll<HTMLElement>(selector)]
  if (scrollers.length === 0) return 'n/a'
  const ratio = Math.max(...scrollers.map((s) => (s.clientWidth > 0 ? s.scrollWidth / s.clientWidth : 0)))
  return `${ratio.toFixed(2)}x`
}

describe('a pane at the floor', () => {
  it('reports what each pane kind shows when driven to MIN_PANE_FRACTION', async () => {
    const rows: string[] = []

    for (const { width, height } of SIZES) {
      localStorage.clear()
      document.body.innerHTML = SHELL
      document.body.style.width = `${width}px`
      // `body`'s own rule sets `min-height: 100vh`. Left alone, that floor — not the height imposed
      // below — would decide how tall `main` (a lone `flex: 1 1 auto` child) grows to fill, borrowing
      // the real tester viewport exactly the way an unset width would borrow the real tester width.
      // `body` carries no analogous `min-width`, which is why the width imposition two lines up never
      // needed this.
      document.body.style.minHeight = '0'
      const root = document.querySelector<HTMLElement>('main')
      if (root === null) throw new Error('no main')
      root.style.width = `${width}px`
      root.style.height = `${height}px`
      const view = await (await freshMain()).ready
      await settled(view, 'let x = 40; x + 2')

      // --- WIDTH: drag the row split's divider (source | λ) hard left, past the floor ---
      const vDivider = root.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]')
      if (vDivider === null) throw new Error('no vertical divider')
      const rowSpan = vDivider.parentElement?.getBoundingClientRect().width ?? 0

      // `resize` clamps, so this lands the source pane exactly on the floor.
      vDivider.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 400, clientY: 300, pointerId: 1 }),
      )
      vDivider.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: -2000, clientY: 300, pointerId: 1 }),
      )
      vDivider.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, clientX: -2000, clientY: 300, pointerId: 1 }),
      )

      const source = root.querySelector<HTMLElement>('[data-leaf="source"]')
      const lambda = root.querySelector<HTMLElement>('[data-leaf="lambda-0"]')
      const tmAtWidthFloor = root.querySelector<HTMLElement>('[data-leaf="tm-0"]')
      const px = (el: HTMLElement | null) => Math.round(el?.getBoundingClientRect().width ?? 0)

      const sourceWidth = px(source)
      const sourceOverflow = overflowRatio(source, '.cm-scroller')
      const lambdaWidth = px(lambda)
      const lambdaOverflow = overflowRatio(lambda, '.cm-scroller')
      // `tm` sits in the outer COLUMN split, untouched by the row divider above — this is its ordinary
      // full width at this window size, not a floor reading. The height drag below is what measures
      // TM's own floor.
      const tmWidth = px(tmAtWidthFloor)
      const tmWidthOverflow = overflowRatio(tmAtWidthFloor, '.cells')

      // --- HEIGHT: drag the column split's divider (row | tm) hard down, past the floor ---
      // The commit above (`pointerup`) rebuilt the tree (`renderLayout` replaces every divider on
      // every commit — see `layout-view.ts`), so the horizontal divider is queried fresh rather than
      // reused from before the width drag.
      const hDivider = root.querySelector<HTMLElement>('[role="separator"][aria-orientation="horizontal"]')
      if (hDivider === null) throw new Error('no horizontal divider')
      const colSpan = hDivider.parentElement?.getBoundingClientRect().height ?? 0

      // Dragging DOWN (increasing `clientY`) grows the split's FIRST child (the source/λ row) and
      // shrinks its SECOND (`tm`) — the mirror image of "drag hard left" above, which shrinks the row
      // split's FIRST child (`source`). `tm` is the row|tm split's second neighbour, so the sign that
      // drives it to the floor flips accordingly.
      //
      // `pointerId: 1` AGAIN, NOT A FRESH ID — matching `divider-drag.test.ts`'s own convention.
      // Measured directly: `1` is the reserved mouse-pointer id and is always active, so
      // `setPointerCapture` accepts it unconditionally, including on a page's very first `pointerdown` —
      // it is not about having been "seen" by the vertical divider's own pointerdown above. Any OTHER id
      // (`0`, `2`, measured both) makes Chromium's `setPointerCapture` throw `NotFoundError` ("no active
      // pointer with the given id"), surfacing as an unhandled error at the end of the run even though
      // the gesture itself still completes.
      hDivider.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 400, pointerId: 1 }),
      )
      hDivider.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 300, clientY: 5000, pointerId: 1 }),
      )
      hDivider.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, clientX: 300, clientY: 5000, pointerId: 1 }),
      )

      const tmAtHeightFloor = root.querySelector<HTMLElement>('[data-leaf="tm-0"]')
      const tmHeight = Math.round(tmAtHeightFloor?.getBoundingClientRect().height ?? 0)
      // UNLIKE THE WIDTH CASE, THE OUTER `.pane`'S OWN OVERFLOW IS A GENUINE SIGNAL HERE. TM's
      // `.state-table` caps itself at `max-height: 40vh` — the real tester VIEWPORT, not this squeezed
      // pane — so at a small enough height floor the table (open by default: `TmPane`'s `#open` starts
      // `true`) can legitimately exceed the pane's own `clientHeight` and push the outer `.pane`
      // (`overflow: auto` in its own right) into scrolling, which is exactly what `.cm-scroller`/`.cells`
      // never let the outer element do on the width axis.
      const tmVerticalOverflow =
        tmAtHeightFloor === null || tmAtHeightFloor.clientHeight === 0
          ? 'n/a'
          : `${(tmAtHeightFloor.scrollHeight / tmAtHeightFloor.clientHeight).toFixed(2)}x`

      rows.push(
        [
          `window ${width}x${height}px`,
          `row split extent ${Math.round(rowSpan)}px`,
          `width floor ${MIN_PANE_FRACTION} = ${Math.round(rowSpan * MIN_PANE_FRACTION)}px`,
          `source ${sourceWidth}px overflow=${sourceOverflow}`,
          `lambda ${lambdaWidth}px overflow=${lambdaOverflow}`,
          `tm-width ${tmWidth}px overflow=${tmWidthOverflow}`,
          `column split extent ${Math.round(colSpan)}px`,
          `height floor ${MIN_PANE_FRACTION} = ${Math.round(colSpan * MIN_PANE_FRACTION)}px`,
          `tm-height ${tmHeight}px overflow=${tmVerticalOverflow}`,
        ].join(' | '),
      )
    }

    // The probe's only assertion: it ran at every size. The reading is the deliverable, and it is
    // recorded in `MIN_PANE_FRACTION`'s own doc rather than here — see `layout.ts`.
    expect(rows.length).toBe(SIZES.length)
  })
})
