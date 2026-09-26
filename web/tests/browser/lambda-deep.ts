import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

/** The program's numeral — see `deepTermSteppedBack`'s doc for why it is this and not nearer the depth guard. */
const N = 2_000

/**
 * A LEGAL PROGRAM WHOSE NEXT REDEX IS ABOUT 2,000 APPLICATIONS DEEP, ONE STEP FROM ITS END. At `2000 + 0`'s
 * second-to-last step the automatic folds keep the whole path to the redex open, and its row is nested 2,002
 * levels down in either layout — well past the 1,199 the 600-element list's tripwire reads. The app must draw it
 * as a tree, with no fallback note and the redex's row on screen.
 *
 * **WHY 2,000, AND NOT NEARER THE REDUCER'S `MAX_TERM_DEPTH` (3,000): THE WORKER'S OWN V8 STACK GIVES OUT
 * FIRST.** This file compiled `2990 + 0` until the full suite failed with "redextape hit a problem and
 * recovered: Maximum call stack size exceeded", before the view drew anything, in 1 of 3 runs; alone it passed.
 * With the browser forced to optimised wasm (`--js-flags=--no-liftoff`) that failure comes every time, and
 * `N + 0` held at 2,520 and overflowed from 2,540 up, the same in two runs. 2,000 leaves about a fifth of that
 * depth spare. The margin itself is a product leftover, not this test's to fix.
 *
 * THE LAYOUTS' OWN RECURSION IS CHECKED ELSEWHERE. The code layout, when it recursed once per open level, threw
 * on ◀ at `2990 + 0` and wedged the view; the recursive outline held there in the app and threw at `2900 + 0`
 * only when called directly. Neither depth is safe to run in the app now, so `tests/node/lambda-layout.test.ts`'s
 * cases at 9,997 levels are the check on the recursion, for both layouts.
 *
 * ONE LAYOUT PER FILE, SO EACH RUNS ON A COLD PAGE — a fresh app, following, no fold touched.
 */
export function deepTermSteppedBack(layout: 'code' | 'outline'): void {
  let view: EditorView
  const term = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term')
  const stepText = () => document.querySelector('[data-leaf="lambda-0"] .step')?.textContent ?? ''
  const stepNumber = () => Number((stepText().match(/step ([\d,]+)/)?.[1] ?? '').replaceAll(',', ''))
  const back = () =>
    [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')]
      .find((b) => b.textContent === '◀')
      ?.click()
  /** The view has drawn the step its controls show: as that step's tree, or as its text with a note. */
  const drawn = () =>
    (term()?.dataset.stale === undefined && term()?.dataset.step === String(stepNumber())) ||
    term()?.querySelector('.term-note') !== null

  describe(`the λ view in the ${layout} layout, one step back from the end of ${N} + 0`, () => {
    beforeAll(async () => {
      document.body.innerHTML = SHELL
      view = await (await import('../../src/main')).ready
    })

    it('draws that step’s tree, with its next redex on screen', async () => {
      if (layout === 'outline') {
        document
          .querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .view-menu-choice[data-value="outline"]')
          ?.click()
      }
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: `${N} + 0` } })
      await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the compile')
      await until(() => /^step ([\d,]+) of \1$/.test(stepText()), 'the λ leg to record its last step and show it')
      await until(drawn, 'the last step drawn, as a tree or as text')
      const end = stepNumber()
      back()
      await until(() => stepNumber() === end - 1, 'the step before the end')
      // EITHER OUTCOME ENDS THE WAIT, so a view that fell back to text fails on its note rather than timing out.
      await until(drawn, 'the step drawn, as a tree or as text')
      expect(term()?.querySelector('.term-note')?.textContent ?? null, 'no fallback note').toBeNull()
      expect(term()?.dataset.layout).toBe(layout)
      expect(term()?.getAttribute('role')).toBe('tree')
      // THE FOLLOWED REDEX'S ROW IS DRAWN, NESTED UNDER EVERY APPLICATION ABOVE IT — the path is laid out open.
      const row = term()?.querySelector('.is-next-redex')?.closest('.term-line')
      expect(Number(row?.getAttribute('aria-level')), 'measured N + 2').toBeGreaterThan(N - 100)
    })
  })
}
