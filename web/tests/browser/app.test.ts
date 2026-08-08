import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { STORAGE_KEY } from '../../src/appearance'

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main>
    <section id="source" class="pane"><div id="editor"></div></section>
    <section id="lambda" class="pane"></section>
    <section id="tm" class="pane wide"></section>
    <section id="results" class="pane results wide"></section>
  </main>`

const LAMBDA_DECLINES = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'

let view: EditorView

async function until(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error('timed out waiting for the app')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const resultsText = () => document.querySelector('#results')?.textContent ?? ''

/** Replace the whole buffer, exactly as a user retyping it would. */
function retype(src: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
}

/**
 * `retype`, but waits for the run it triggers to finish before returning. `results.dataset.state`
 * flips to `'idle'` only from `onReply`'s `'no-session'` and `'result'` arms — both AFTER
 * `renderRows` has run — and `schedule` sets it to `'running'` synchronously inside the same
 * `dispatch` call this function makes, so there is no stale `'idle'` left over from a previous test
 * for this to resolve against by accident.
 */
async function settled(v: EditorView, src: string): Promise<void> {
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: src } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== '')
}

describe('the app, end to end', () => {
  // ONE MOUNT FOR THE FILE. ES module imports are cached, so `main()` runs once per page and Vitest
  // gives each test FILE its own page — mounting per test would silently reuse the first app.
  beforeAll(async () => {
    // Cleared before `main.ts` ever reads it, so the appearance toggle's tests below start from a
    // known `system` state regardless of what an earlier run in this browser context left behind.
    localStorage.removeItem(STORAGE_KEY)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  it('highlights keywords synchronously and reports both legs', async () => {
    retype('let x = 40; x + 2')

    // Highlighting does not wait for the worker — it is applied in the same dispatch as the document.
    expect(document.querySelector('.tok-keyword')?.textContent).toBe('let')

    await until(() => resultsText().includes('β-steps'))
    expect(resultsText()).toContain('7 β-steps')
    expect(resultsText()).toContain('2,870 δ-steps')
    expect(resultsText()).toContain('42')
  })

  // THE CRITICAL FINDING THIS TEST EXISTS TO CATCH: `LambdaState.spans` are BYTE offsets
  // (`print_lambda_capped`'s doc), and `λ` is 2 bytes but 1 UTF-16 code unit. Slicing `frame.text` by
  // byte offset instead of converting first renders this span as `"λf"` (the binder glyph plus its
  // name) rather than `"λ"` alone — nothing before this test asserted the CONTENTS of any token class
  // inside `#lambda`, so 114 tests and six eye checks all missed it.
  it('renders the λ pane’s first binder span as exactly "λ", not "λ" plus its name', async () => {
    await until(() => resultsText().includes('β-steps'))
    await until(() => document.querySelector('#lambda .tok-binder') !== null)
    const first = document.querySelector('#lambda .tok-binder')
    expect(first?.textContent).toBe('λ')
  })

  it('populates the encoding picker from the registry', () => {
    const names = [...document.querySelectorAll('#encoding option')].map((o) => o.textContent)
    expect(names).toContain('unary')
    expect(names).toContain('binary')
  })

  it('lints a broken program and says it did not compile', async () => {
    retype('let x = ;')
    await until(() => resultsText().includes('not compiled'))
    expect(resultsText()).toContain('not compiled')
    // `lintGutter` renders its marker asynchronously, after the lint source resolves. Verified against
    // the rendered DOM (not just read off `@codemirror/lint`'s source): `cm-lintRange` is the underline
    // mark in the document and `cm-lint-marker` is the gutter dot `lintGutter()` adds — both classes are
    // present in the installed 6.9.7 build.
    await until(() => document.querySelectorAll('.cm-lintRange, .cm-lint-marker').length > 0)
  })

  it('shows the λ refusal, marks where it happened, and still answers for TM', async () => {
    retype(LAMBDA_DECLINES)
    await until(() => resultsText().includes('declined'))
    // Measured, not guessed: this program's mutable capture is resolved as an unbound name during
    // lowering (`LowerError::Unsupported`), not as `LowerError::StatefulClosure` — so the reason reads
    // "the λ backend does not support unbound `n`" rather than anything naming "closure". See
    // `crates/redextape-wasm/src/session.rs`'s `lambda_status`.
    expect(resultsText()).toContain('unbound')
    // The TM leg still answers — a declined backend is not a failed compile.
    expect(resultsText()).toContain('δ-steps')
    // `sourceSpan(status.node)`, resolved in the worker and marked here.
    await until(() => document.querySelectorAll('.decline').length > 0)
  })

  it('clears the decline mark once a clean program compiles', async () => {
    // Order matters: the mark must first be shown for a declining program, then cleared by a
    // subsequent clean compile. A test that only checked the clear would pass against a mark that
    // was never set, and one that only checked the appearance would pass against a mark that never
    // clears — the worker sends `declinedSpan: null` for an available λ leg, but nothing here proved
    // `main.ts` ever dispatches it.
    retype(LAMBDA_DECLINES)
    await until(() => document.querySelectorAll('.decline').length > 0)

    // NOT A FULL `retype` HERE. `declineMark`'s own `update` maps the decoration through any change via
    // `deco.map(tr.changes)`, and CodeMirror drops a mark range outright once a change deletes its entire
    // span — synchronously, before the debounced worker round trip even starts. Retyping a wholly
    // different program would therefore make `.decline` disappear immediately regardless of whether
    // `main.ts` ever dispatches `setDecline.of(null)`, so the assertion below would pass even against a
    // stale mark that never clears. Instead, edit around the marked `n` (the `x + n` reference the decline
    // names): drop `mut ` from `let mut n` and drop the now-illegal `n = 10;` reassignment, which is what
    // actually makes the closure's capture of `n` unsupported — a closure never threads the enclosing
    // store, so a *mutable* binding it reads resolves to nothing (`assigns_captured`/`lower_region` in
    // `redextape-core`'s lambda lowering; reassigning `n` is not itself the cause). Both edits land before
    // the marked `n`, so the mark's own span is untouched and only shifts; it can only go away through the
    // real dispatch once the worker reports the λ leg available again.
    const src = view.state.doc.toString()
    const mut = 'mut '
    const reassign = 'n = 10; '
    const mutAt = src.indexOf(mut)
    const reassignAt = src.indexOf(reassign)
    expect(mutAt).toBeGreaterThan(-1)
    expect(reassignAt).toBeGreaterThan(mutAt)
    view.dispatch({
      changes: [
        { from: mutAt, to: mutAt + mut.length },
        { from: reassignAt, to: reassignAt + reassign.length },
      ],
    })
    // The mark clears on `compiled`, sent BEFORE recording — `protocol.ts`'s `RunReply` doc names
    // this ordering. The results text updates later, on `result`, once recording finishes — so the
    // mark clearing first is expected and the text assertion below must wait for its own signal
    // rather than piggyback on the mark's.
    await until(() => document.querySelectorAll('.decline').length === 0)
    await until(() => resultsText().includes('β-steps'))
    expect(resultsText()).not.toContain('declined')

    // Leave the buffer as the other tests found it, in case one is ever added after this.
    retype('let x = 40; x + 2')
    await until(() => resultsText().includes('β-steps'))
  })

  // IMPORTANT 2's proof: a `worker-error` must not kill the app. `main.ts` used to answer it with
  // `showBanner(root, ...)`, which is `root.replaceChildren(bannerEl)` — deleting the editor, both
  // panes, and `#results` in one call, after which nothing on the page could ever dispatch again.
  //
  // TRIGGERED VIA THE PICKER, the one reachable path to `compile()` throwing without a second bug to
  // manufacture: `EncodingKind::parse` (`lib.rs:36-38`) is the only thing in this path that throws, and
  // it throws for any name outside the registry. The picker itself only ever offers registered names —
  // this test appends one it does not, and selects it exactly the way a user's own click would, so the
  // `change` event `main.ts` listens for is the real one, not a synthesized substitute for it.
  it('recovers from a worker-error without killing the editor', async () => {
    await settled(view, 'let x = 40; x + 2')

    const picker = document.querySelector<HTMLSelectElement>('#encoding')
    expect(picker).not.toBeNull()
    if (!picker) return
    const bogus = document.createElement('option')
    bogus.value = 'not-a-real-encoding'
    bogus.textContent = 'not-a-real-encoding'
    picker.append(bogus)
    picker.value = 'not-a-real-encoding'
    picker.dispatchEvent(new Event('change'))

    await until(() => resultsText().includes('recovered'))
    // THE PAGE MUST STILL BE THE PAGE. A `showBanner(root, ...)` call here would have torn `#editor`
    // (and `#lambda`, `#tm`) out of `<main>` along with everything else.
    expect(document.querySelector('#editor .cm-content')).not.toBeNull()
    expect(document.querySelector('#lambda')).not.toBeNull()
    expect(document.querySelector('#tm')).not.toBeNull()

    // And the editor must still be LIVE, not merely present: typing after the crash must still reach
    // a compile. Restore a real encoding first — the picker itself is not what this branch is about.
    picker.value = 'unary'
    bogus.remove()
    retype('let x = 40; x + 2')
    await until(() => resultsText().includes('β-steps'))
    expect(resultsText()).toContain('7 β-steps')
  })

  // NESTED, NOT A SIBLING `describe` — same reason `stepping` below is nested: the outer `beforeAll`
  // mounted `main.ts` once for the file, and this test needs the REAL `#appearance` button that
  // produced, not a second one from a fresh mount.
  describe('appearance toggle', () => {
    it('cycles data-theme and the aria-label through system, light, dark and back, and persists the choice', () => {
      const button = document.querySelector<HTMLButtonElement>('#appearance')
      expect(button).not.toBeNull()
      if (!button) return

      // `beforeAll` cleared `localStorage`'s appearance key before importing `main.ts`, so the
      // button mounted reading `system` — no `data-theme` attribute, since `system` is its absence,
      // not the literal string `"system"`.
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
      expect(button.getAttribute('aria-label')).toBe('appearance: system')

      button.click()
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
      expect(button.getAttribute('aria-label')).toBe('appearance: light')
      expect(localStorage.getItem(STORAGE_KEY)).toBe('light')

      button.click()
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
      expect(button.getAttribute('aria-label')).toBe('appearance: dark')
      expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')

      // Back to system: the attribute is REMOVED, not set to `"system"` — the same fact
      // `appearance.test.ts`'s node test checks directly, exercised here through the real button.
      button.click()
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
      expect(button.getAttribute('aria-label')).toBe('appearance: system')
      expect(localStorage.getItem(STORAGE_KEY)).toBe('system')
    })
  })

  // NESTED, NOT A SIBLING `describe`. `beforeAll` above only runs for tests inside the describe it is
  // declared in — a sibling block would run with no shell mounted at all, and a second call to it
  // would blow away the DOM CodeMirror and the panes already mounted into. This block reuses the one
  // `view` the outer `beforeAll` produced rather than re-triggering any of that.
  describe('stepping', () => {
    const paneText = (id: string) => document.querySelector(`#${id} .term`)?.textContent ?? ''
    const stepText = (id: string) => document.querySelector(`#${id} .step`)?.textContent ?? ''
    /**
     * Pulls the current-step figure out of a `stepText` reading, e.g. `75,025` from `'step 75,025
     * of 129,300 — history is full'`. `NaN` if the text does not contain a step reading at all.
     */
    const stepNumber = (text: string): number => {
      const m = text.match(/step ([\d,]+) of/)
      return Number((m?.[1] ?? '').replaceAll(',', ''))
    }
    const click = (id: string, label: string) => {
      const b = [...document.querySelectorAll<HTMLButtonElement>(`#${id} .controls button`)].find(
        (x) => x.textContent === label,
      )
      b?.click()
      return b
    }

    it('steps the λ pane back and shows the same text it showed before', async () => {
      await settled(view, 'let x = 40; x + 2')
      // Recording finished, so the head sits on step 7.
      expect(stepText('lambda')).toContain('step 7')
      const atSeven = paneText('lambda')
      click('lambda', '◀')
      const atSix = paneText('lambda')
      expect(atSix).not.toBe(atSeven)
      click('lambda', '▶')
      expect(paneText('lambda')).toBe(atSeven)

      // A `forward()` that always jumped to the NEWEST recorded frame, instead of incrementing the
      // head, would pass every assertion above by coincidence — one step back and one step forward
      // both land back at the frontier either way. Going back three steps and walking forward one at
      // a time distinguishes them: a jump-to-newest `forward()` would reproduce `atSeven` on the very
      // first `▶` below instead of `atFive`, and the step readout would jump straight to 7 instead of
      // counting 5, 6, 7.
      click('lambda', '◀')
      const atSixAgain = paneText('lambda')
      click('lambda', '◀')
      const atFive = paneText('lambda')
      click('lambda', '◀')
      const atFour = paneText('lambda')
      expect(atFour).not.toBe(atFive)
      expect(stepText('lambda')).toContain('step 4')

      click('lambda', '▶')
      expect(paneText('lambda')).toBe(atFive)
      expect(stepText('lambda')).toContain('step 5')
      click('lambda', '▶')
      expect(paneText('lambda')).toBe(atSixAgain)
      expect(stepText('lambda')).toContain('step 6')
      click('lambda', '▶')
      expect(paneText('lambda')).toBe(atSeven)
      expect(stepText('lambda')).toContain('step 7')
    })

    it('shows five labelled tape rows with the head inside the window', async () => {
      await settled(view, 'let x = 40; x + 2')
      const labels = [...document.querySelectorAll('#tm .tape-label')].map((e) => e.textContent)
      expect(labels).toEqual(['REG', 'WORK', 'STACK', 'HEAP', 'BOX'])
      expect(document.querySelectorAll('#tm .cell.head').length).toBe(5)
    })

    it('clears both panes when the program stops compiling, and says so rather than reading blank', async () => {
      await settled(view, 'let x = 40; x + 2')
      expect(paneText('lambda')).not.toBe('')
      await settled(view, 'let x = ;')
      expect(paneText('lambda')).toBe('')
      expect(document.querySelectorAll('#tm .tape').length).toBe(0)
      // Design §6's error table: "panes read 'not compiled'". `main.ts`'s `resetLegs` used to leave
      // `reason: ''` here, so the control strip's step readout (`controls.ts`'s `controlState`, via
      // `pane-chrome.ts`'s `.step`) was blank too, not merely the term/tape area above it.
      expect(stepText('lambda')).toBe('not compiled')
      expect(stepText('tm')).toBe('not compiled')
    })

    // THE DEFECT CLASS THAT HID IN PR 3c, at the UI layer this time.
    it('leaves the TM pane steppable when the λ backend declines', async () => {
      await settled(view, LAMBDA_DECLINES)
      expect(stepText('lambda')).toContain('does not support')
      expect(document.querySelectorAll('#tm .tape').length).toBe(5)
      expect(click('tm', '◀')?.disabled).toBe(false)
    })

    it('leaves the λ pane steppable when the TM backend declines', async () => {
      await settled(view, 'let x = 200; x + 1')
      expect(document.querySelectorAll('#tm .tape').length).toBe(0)
      expect(paneText('lambda')).not.toBe('')
      expect(click('lambda', '◀')?.disabled).toBe(false)
    })

    // `raise_cap` refuses to clear `depth_capped`, so a continue button here would offer something
    // that provably cannot work. There must be no button, not a disabled one.
    it('offers no continue affordance once a run has ended', async () => {
      await settled(view, 'let x = 40; x + 2')
      const extend = document.querySelector<HTMLButtonElement>('#lambda .controls .extend')
      expect(extend?.hidden).toBe(true)
    })

    // THE CHEAP HALF OF THE PATH THREE DOC COMMENTS NAME AS MOST LIKELY TO BE GOTTEN WRONG
    // (`main.ts`'s `forward`, `controls.ts`'s `canRecordFurther`, `pane-chrome.ts`'s controlStrip) —
    // and nothing exercised it until now. `▶` at the frontier of an `'ended'` run must not ask the
    // worker for anything: the step readout must not move and the extend button must stay hidden.
    it('does nothing when ▶ is pressed at the frontier of a run that already ended', async () => {
      await settled(view, 'let x = 40; x + 2')
      const before = stepText('lambda')
      expect(before).toContain('step 7')
      const extend = document.querySelector<HTMLButtonElement>('#lambda .controls .extend')
      expect(extend?.hidden).toBe(true)
      click('lambda', '▶')
      // `client.extend` would post to the worker and come back asynchronously; give a stray call a
      // window to land before asserting nothing happened.
      await new Promise((r) => setTimeout(r, 200))
      expect(stepText('lambda')).toBe(before)
      expect(extend?.hidden).toBe(true)
    })

    // THE OTHER HALF, BY MEASUREMENT. `capped` needs the cursor's own cap (5,000,000 steps —
    // `redextape-core/src/tm/sim.rs`'s `DEFAULT_CAPS`) exhausted first, which is unaffordable in a
    // test. `budget` only needs `HISTORY_BYTES` (32 MiB) spent, which a worker-only probe measured
    // this fixture reaching at 75,025 TM frames (~129,300 δ-steps known total from `compile`, only
    // 58% of them recorded) in ~1.9s, with `[continue]` recording the remaining 54,276 frames to
    // `'ended'` in ~1.3s more — see `task-12-report.md`'s "Fix pass" section for the raw numbers.
    it('records further once the TM leg spends its history budget, and the step count advances', async () => {
      const src =
        'fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2, 4].map(add1)'
      await settled(view, src)
      await until(() => stepText('tm').includes('history is full'), 30_000)

      const stoppedStep = stepNumber(stepText('tm'))
      expect(stoppedStep).toBeGreaterThan(0)
      const extend = document.querySelector<HTMLButtonElement>('#tm .controls .extend')
      expect(extend?.hidden).toBe(false)
      expect(extend?.textContent).toBe('keep recording')

      // ▶ AND [continue] ARE THE SAME `extend` REQUEST WITH DIFFERENT LABELS (`controls.ts`'s
      // `canForward`, `main.ts`'s `forward`) — reaching `'budget'` a second time just to click the
      // other button would double an already-slow test for no more coverage, so this exercises ▶ here
      // instead of `[continue]`: it must be the live button the fix makes it, not the disabled one it
      // used to render at exactly this frontier.
      expect(click('tm', '▶')?.disabled).toBe(false)
      await until(() => stepNumber(stepText('tm')) > stoppedStep, 30_000)
      expect(stepNumber(stepText('tm'))).toBeGreaterThan(stoppedStep)
    }, 60_000)

    it('restart returns to step 0 and forward walks out again', async () => {
      await settled(view, 'let x = 40; x + 2')
      click('lambda', '↺')
      expect(stepText('lambda')).toContain('step 0')
      click('lambda', '▶')
      expect(stepText('lambda')).toContain('step 1')
    })
  })
})
