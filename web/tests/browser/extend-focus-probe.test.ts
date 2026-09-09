import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'

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

/** The fixture that reaches a `budget` stop on the TM leg — see Task 3's file for the measurement. */
const BUDGET_SRC =
  'fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2, 4].map(add1)'

let view: EditorView

async function until(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error('timed out waiting for the app')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const stepText = () => document.querySelector('[data-leaf="tm-0"] .step')?.textContent ?? ''

/** The `▶` specifically. The strip's first button is `↺`, so a positional lookup would name the wrong one. */
const forwardButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="tm-0"] .controls button')].find(
    (b) => b.textContent === '▶',
  )

const mustFind = <T extends Element>(selector: string): T => {
  const el = document.querySelector<T>(selector)
  if (el === null) throw new Error(`no element for ${selector}`)
  return el
}

describe('focus when a frontier control is withdrawn', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  // HALF ONE — IS THE MECHANISM REAL? Accessibility item 1 recorded that a control which hides itself
  // strands focus on `<body>`. This asserts that against the button this slice withdraws, so half two
  // below is a statement about reachability rather than about whether the hazard exists at all.
  it('hiding or disabling the focused frontier control strands focus on body', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: BUDGET_SRC } })
    await until(() => stepText().includes('history is full'))

    const extend = mustFind<HTMLButtonElement>('[data-leaf="tm-0"] .controls .extend')
    extend.focus()
    expect(document.activeElement).toBe(extend)
    extend.hidden = true
    expect(document.activeElement).toBe(document.body)
    extend.hidden = false

    // `forwardButton()`, NOT THE STRIP'S FIRST BUTTON, which is `↺`. Disabling any focused button
    // strands focus, so a positional lookup would pass while naming the wrong control.
    const forward = forwardButton()
    expect(forward).toBeDefined()
    forward?.focus()
    expect(document.activeElement).toBe(forward)
    if (forward !== undefined) forward.disabled = true
    expect(document.activeElement).toBe(document.body)
    if (forward !== undefined) forward.disabled = false
  }, 90_000)

  // HALF TWO — CAN A USER GESTURE REACH IT? Every gesture that opens the window is itself a
  // focus-bearing interaction somewhere else, so at the instant the controls are withdrawn, focus is
  // on the thing the user was touching and not on what was withdrawn.
  it('leaves focus on the gesture that opened the window, not on a withdrawn control', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: BUDGET_SRC } })
    await until(() => stepText().includes('history is full'))

    view.contentDOM.focus()
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } })
    expect(stepText()).toContain('— recompiling')
    expect(document.activeElement).toBe(view.contentDOM)
    await until(() => stepText().includes('history is full'))

    const picker = mustFind<HTMLSelectElement>('#encoding')
    picker.focus()
    // `#encoding` lists two options (`unary`, `binary`), so a different one is always available —
    // select it before dispatching, so the gesture below is a user actually picking a different
    // encoding rather than a bare event standing in for one.
    const originalEncoding = picker.value
    const other = mustFind<HTMLOptionElement>(`#encoding option:not([value="${picker.value}"])`)
    picker.value = other.value
    picker.dispatchEvent(new Event('change'))
    // Defends the focus assertion below: it is only evidence about the hazard if this gesture
    // genuinely opened the withdrawal window, same as the typing sub-case's check above.
    expect(stepText()).toContain('— recompiling')
    expect(document.activeElement).toBe(picker)
    // `compile.ts`'s `schedule` reads `picker.value` only when its debounce timer fires, well after
    // this synchronous block, so restoring here — before the next test runs — keeps the encoding
    // switch a genuine gesture for this sub-case without leaking a different encoding into the test
    // that runs after it.
    picker.value = originalEncoding
  }, 90_000)

  // THE ONE ROUTE THAT DOES STRAND FOCUS, NAMED SO THE FINDING IS FALSIFIABLE RATHER THAN AN ABSENCE.
  // A document change dispatched while focus sits on `[continue]` reaches the hazard — and no user
  // gesture performs one: typing needs focus in the editor, and the picker needs focus on the picker.
  it('is reachable only by a programmatic dispatch, which no user gesture performs', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: BUDGET_SRC } })
    await until(() => stepText().includes('history is full'))

    const extend = mustFind<HTMLButtonElement>('[data-leaf="tm-0"] .controls .extend')
    extend.focus()
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } })
    expect(document.activeElement).toBe(document.body)
  }, 90_000)
})
