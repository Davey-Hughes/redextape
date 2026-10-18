import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { extendButton, forwardButton, historyFills, SHELL, tmStepText } from './harness'

/**
 * The fixture that reaches a `budget` stop on the TM leg, from `app.test.ts`'s own measurement:
 * ~75,025 frames in ~1.9 s. `capped` would need the cursor's 5,000,000-step cap, which is
 * unaffordable in a test, so `budget` is the only route to a live `[continue]`.
 */
const BUDGET_SRC =
  'fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2, 4].map(add1)'

let view: EditorView

/** `⏭`: the head to the frontier, where `▶` asks for more. A run opens on step 0 (`History`), where `▶` steps. */
const toNewest = () =>
  document.querySelector<HTMLButtonElement>('[data-leaf="tm-0"] .controls button.to-newest')?.click()

describe('the frontier controls during a recompile', () => {
  // ONE MOUNT FOR THE FILE, as every browser test file does: ES module imports are cached, so
  // `main()` runs once per page and Vitest gives each test file its own page.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  it('withdraws [continue] and a frontier ▶ for the whole window, and restores them after', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: BUDGET_SRC } })
    await historyFills()
    toNewest()
    expect(tmStepText(), 'precondition: the head at the frontier').toMatch(/^step ([\d,]+) of \1 /)
    expect(extendButton()?.hidden).toBe(false)
    expect(extendButton()?.textContent).toBe('keep recording')
    expect(forwardButton()?.disabled).toBe(false)

    // ONE CHARACTER, AND THE WITHDRAWAL IS SYNCHRONOUS. CodeMirror runs its update listeners inside
    // `dispatch`, that listener calls `schedule`, and `schedule` calls `supersede()` — which sets the
    // flag and fires the repaint before this line returns. No `until` here: a wait would hide the
    // fact that there is nothing to wait for.
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } })
    expect.soft(extendButton()?.hidden).toBe(true)
    expect.soft(tmStepText()).toContain('— recompiling')
    expect.soft(tmStepText()).not.toContain('history is full')
    expect.soft(forwardButton()?.disabled).toBe(true)

    // A trailing space changes nothing the machine does, so the new run reaches the same stop and the
    // control comes back — which is what makes the withdrawal a window rather than a one-way door.
    await historyFills()
    toNewest()
    expect(tmStepText(), 'precondition: the head at the frontier').toMatch(/^step ([\d,]+) of \1 /)
    expect(extendButton()?.hidden).toBe(false)
    expect(forwardButton()?.disabled).toBe(false)
  }, 90_000)
})
