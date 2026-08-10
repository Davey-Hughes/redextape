import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { STORAGE_KEY } from '../../src/appearance'
import { OVERSCAN, ROW_HEIGHT } from '../../src/tm-pane'

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main>
    <section id="source" class="pane"><div id="editor"></div><div id="link-status" class="link-status"></div></section>
    <section id="lambda" class="pane"></section>
    <section id="tm" class="pane wide"></section>
    <section id="results" class="pane results wide"></section>
  </main>`

const LAMBDA_DECLINES = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'

// NOT `[1, 2]`. Its 455 rows would render acceptably unvirtualized, so it cannot demonstrate the one
// property this table exists for. `map_fold` is 25,852 rows (design §3.1). Module-scoped, not local to
// `stepping`, because `main.ts`'s `fn` definitions are also this file's example of a source construct
// that owns no machine states at all — `fn map(...)`'s own span never gets an instruction; only the
// defunctionalized call sites downstream of it do.
const BIG = `fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }
fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }
fn add(a, b) { a + b }
fn add1(x) { x + 1 }
fold([3, 1, 2].map(add1), 0, add)`

let view: EditorView

async function until(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error('timed out waiting for the app')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const resultsText = () => document.querySelector('#results')?.textContent ?? ''
const linkStatusText = () => document.querySelector('#link-status')?.textContent ?? ''
/** The text of whichever source construct is currently marked `.linked`, or `''` if none is. */
const linkedSource = () => document.querySelector('.cm-editor .linked')?.textContent ?? ''
/** How many δ-table rows are currently painted `.is-linked`. Zero is a real answer, not an absence. */
const linkedRowCount = () => document.querySelectorAll('#tm .state-row.is-linked').length

/**
 * Yield to the event loop once.
 *
 * NOT `until(() => true)`, WHICH WAITS FOR NOTHING. `until` evaluates its predicate before its first
 * sleep, so a predicate that is already true returns synchronously — an `await` on it is a no-op that
 * reads like a wait. Places below that need the DOM to settle after a synchronous click use this;
 * places that need a specific condition use `until` with that condition instead.
 */
const tick = () => new Promise((r) => setTimeout(r, 0))

/**
 * Link the source construct at `pos` (a UTF-16 doc position), via the keyboard route `main.ts` binds
 * to `Mod-'` rather than synthesizing a `mouseup` at a computed pixel — real Chromium under Playwright
 * would make that work too, but the keyboard path resolves against the caret alone and needs no
 * `posAtCoords` layout to line up. `Mod` is `Ctrl` on this platform (`@codemirror/view`'s
 * `normalizeKeyName`: `mac ? meta : ctrl`), and the sample fixtures are ASCII, so a UTF-16 position and
 * a byte offset coincide here — the conversion `main.ts` itself does is not what this test is for.
 */
function linkAt(v: EditorView, pos: number): void {
  v.dispatch({ selection: { anchor: pos } })
  v.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: "'", ctrlKey: true, cancelable: true }))
}

/** Replace the whole buffer, exactly as a user retyping it would. */
function retype(src: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
}

/**
 * `retype`, but waits for the run it triggers to finish before returning.
 *
 * THE INVARIANT IS NOW TRUE, AND IT WAS NOT BEFORE. `results.dataset.state` flips to `'idle'` only
 * from `onReply`'s `'no-session'` and `'result'` arms, and `onReply` only runs for the CURRENT
 * generation. `schedule` claims that generation synchronously inside the same `dispatch` this
 * function makes (`SessionClient.supersede`), so every reply belonging to a previous program is
 * already filtered by the time this starts polling. Until PR 5b the bump happened 300 ms later,
 * inside `request`, and a stale `result` landing in the gap resolved this against the OLD program —
 * two flakes on 5a-ii traced to exactly that.
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

  // TASK 9's PROOF. `onReply`'s `compiled` arm now dispatches `setLink.of(null)` alongside
  // `setDecline.of(...)` — without it, a link painted before a recompile survives one that comes with
  // NO document edit, which is exactly what the `#encoding` picker's `change` listener causes: it
  // calls `schedule` directly against the unchanged buffer, so `docChanged` never fires and `linkMark`
  // never gets its own chance to clear the mark. The stale `.linked` would then be naming a construct
  // resolved against the PREVIOUS compile's index, against a pane pair now showing a different one.
  it('clears the link mark when the encoding picker recompiles with no document change', async () => {
    await settled(view, 'let x = 40; x + 2')

    linkAt(view, 'let x = 40; x + 2'.indexOf('x + 2'))
    const linked = document.querySelector('.cm-editor .linked')
    expect(linked).not.toBeNull()
    expect(linked?.textContent).not.toBe('')

    const picker = document.querySelector<HTMLSelectElement>('#encoding')
    expect(picker).not.toBeNull()
    if (!picker) return
    // Read off the picker rather than hardcoding a name — `encodings()` is what actually populates it.
    const other = [...picker.options].map((o) => o.value).find((v) => v !== picker.value)
    expect(other).toBeDefined()
    if (!other) return
    picker.value = other
    picker.dispatchEvent(new Event('change'))

    // The recompile itself, NOT a document edit — `settled` dispatches a change to the buffer, which
    // would trigger the very `docChanged` clear this test exists to bypass and prove nothing. Wait on
    // the same idle signal `settled` uses instead.
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle')

    expect(document.querySelector('.cm-editor .linked')).toBeNull()

    // Leave the picker and buffer as the other tests found them.
    picker.value = 'unary'
    await settled(view, 'let x = 40; x + 2')
  })

  // THE COMMON PATH, NOT AN EDGE CASE. Measured across the corpus, 18-50% of clickable constructs emit
  // no machine states at all (`link-status.ts`'s module doc) — the transparent `let`/`seq` binders, the
  // `Lambda`s, and statically-resolved callee `Var`s. `let x = 40; x + 2` does not exercise this: every
  // one of ITS constructs turns out to own at least one state (checked directly against the running
  // app, not assumed). `BIG`'s `fn map(xs, f) { ... }` at offset 0 does — a function definition's own
  // span never gets an instruction, only the defunctionalized call sites downstream of it do.
  it('reports the absence when a construct emits no machine states', async () => {
    await settled(view, BIG)
    linkAt(view, 0)
    await until(() => linkStatusText() !== '')
    expect(linkStatusText()).toContain('no machine states')
    // No block can light for a construct that owns none.
    expect(linkedRowCount()).toBe(0)

    await settled(view, 'let x = 40; x + 2')
  })

  it('clicking a state row lights the source construct that produced it', async () => {
    await settled(view, 'let x = 40; x + 2')
    const table = document.querySelector<HTMLElement>('#tm .state-table')
    expect(table).not.toBeNull()
    if (!table) return

    // FIND A ROW WHOSE STATE HAS AN OWNER, because most do not — measured, a large majority of TM
    // states are scaffolding with no source owner at all (`sourcemap.rs`'s module doc). The table is
    // virtualized, so the UNSCROLLED first page alone is not enough here — checked directly against
    // this fixture, its first ~24 rendered rows resolve to nothing. This walks the table in slices,
    // clicking every row rendered at each, until one resolves.
    let lit = ''
    let clicked = 0
    const SLICES = 12
    for (let s = 0; lit === '' && s <= SLICES; s += 1) {
      table.scrollTop = (table.scrollHeight * s) / SLICES
      table.dispatchEvent(new Event('scroll'))
      const rows = [...document.querySelectorAll<HTMLElement>('#tm .state-row')]
      for (const row of rows) {
        row.click()
        await tick()
        clicked += 1
        lit = linkedSource()
        if (lit !== '') break
      }
    }
    expect(lit, `no state row among ${clicked} resolved to a source construct`).not.toBe('')
    // The echo must be real source text, not a stale mark left over from an earlier link in this file.
    expect(view.state.doc.toString()).toContain(lit)
    // And an actual block lit — not merely that some earlier click in the loop left one behind, which
    // the assertion above would not distinguish from this one.
    expect(linkedRowCount()).toBeGreaterThan(0)
  })

  // THE MOST IMPORTANT TEST IN THIS FILE. `TmPane`'s δ table renders only the rows in view and offsets
  // them with `translateY` (`tm-pane.ts`'s `#drawTable`), so a clicked row's DOM index is
  // `firstDrawn + i`, not the row number `i` alone. Getting that wrong does not crash — it silently
  // resolves a click against a DIFFERENT, plausible-looking block, and only once the table has been
  // scrolled away from its first page. A click against an UNscrolled table passes whether or not the
  // offset is right, which would make such a test worse than no test at all — so this scrolls the table
  // well past its first page before clicking, and proves IDENTITY: the row that lights must be the one
  // whose name was clicked, not merely that some row lit.
  it('a linked row is the row it claims to be, through the virtualized offset', async () => {
    await settled(view, 'let x = 40; x + 2')
    const table = document.querySelector<HTMLElement>('#tm .state-table')
    expect(table).not.toBeNull()
    if (!table) return

    // Dispatched directly rather than assigned-and-awaited, the same idiom the scroll/follow tests
    // above use: a real user scroll delivers its `scroll` event asynchronously, at the next rendering
    // update, and this test needs the redraw to have happened before it reads the DOM below.
    table.scrollTop = table.scrollHeight / 2
    table.dispatchEvent(new Event('scroll'))

    const rows = [...document.querySelectorAll<HTMLElement>('#tm .state-row.is-state')]
    expect(rows.length, 'the scrolled window must contain at least one state header row').toBeGreaterThan(0)
    const target = rows[Math.floor(rows.length / 2)]
    expect(target).toBeDefined()
    if (!target) return
    // State names are unique (`StateIndex` numbers each state once), so finding the row by NAME after
    // the click identifies the same logical row even though the click's own redraw discarded and
    // recreated every DOM node in `#rows` — `target` itself is stale the instant that redraw runs, and
    // a source construct can legitimately own SEVERAL states at once (`linkedRows` marks all of them),
    // so the first `.is-linked` header in DOM order need not be the one that was clicked at all.
    const name = target.textContent ?? ''
    target.click()
    await until(() => linkedRowCount() > 0)

    // The row that lit must be the one clicked, BY NAME — not merely that some row, anywhere in the
    // table, gained `is-linked`. `firstDrawn + i` read as plain `i` would resolve this click against a
    // row near the TOP of the whole table instead, which (still scrolled to the middle) would not even
    // be in the rendered window — so a wrong offset fails this either on the name mismatch below or on
    // the `until` above timing out, never by accident matching.
    const relit = [...document.querySelectorAll<HTMLElement>('#tm .state-row.is-state')].find(
      (r) => r.textContent === name,
    )
    expect(relit, `the clicked row (${JSON.stringify(name)}) is no longer rendered after the click`).toBeDefined()
    expect(relit?.classList.contains('is-linked')).toBe(true)
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
    // Hoisted above the tests that use `BIG` for scroll assertions (Fix 4's regression guard, below),
    // not only the ones further down this file that originally declared them.
    const table = () => document.querySelector('#tm .state-table') as HTMLElement
    const spacer = () => document.querySelector('#tm .state-spacer') as HTMLElement
    /** `BIG`'s whole table, and the readiness signal for it: unique to this program among the fixtures. */
    const BIG_SPACER = `${25_852 * ROW_HEIGHT}px`

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

    // THE LAYER 5b's WORST BUG LIVED IN, ON THE ONE FEATURE THAT HAD NO TEST HERE. `lambda-pane.ts`'s
    // `#redraw` converts `frame.redex_span` — BYTE offsets, like every span crossing the wasm boundary
    // — through `byteToIndex`/`byteIndexAt` before deciding which tokens get `is-redex`. Nothing
    // exercised that conversion: the node tier cannot (it has no DOM), the Rust tier stops at the
    // span's value, and the sibling `is-linked` path is the only one this file was checking.
    //
    // THE FIXTURE IS CHOSEN SO THE TWO READINGS DISAGREE, which most would not. At step 6 of this
    // program the frame text is `λf. λx. f (f ( … ((λx0. f (f x0)) x)) … )` and the redex span is bytes
    // [130, 146]. Two `λ` (in `λf.` and `λx.`) precede byte 130 and a third precedes byte 146, and `λ`
    // is 2 bytes but 1 UTF-16 code unit — so the correct UTF-16 range is [128, 143] and the span sits
    // AFTER binders rather than at the root, which is what makes the displacement possible at all.
    // Converted, the lit text is `(λx0. f (f x0))` — the subterm standing at the redex's path in THIS
    // frame's term, parens included. That is an `Abs`, so it is plainly not the redex itself: the path
    // named a redex `App` in the PRE-step term and β replaced it with this, its CONTRACTUM. See
    // `types.ts`'s `redex_span` doc; the conversion under test is the same either way.
    // Sliced as UTF-16 without converting, [130, 146] reads `x0. f (f x0)) x)` — a window shifted off
    // the front of the subterm and past its end, lighting a different token set entirely. A root-path
    // span (`[]`, byte 0) or an ASCII-only fixture would score both readings identical and prove
    // nothing; this one cannot.
    it('paints its own redex by converting the byte span, not by slicing it as UTF-16', async () => {
      await settled(view, 'let x = 40; x + 2')
      // `settled` resolves on the RESULTS pane, which is not the same event as the λ pane holding
      // frames — the same race the restart test above documents.
      await until(() => !stepText('lambda').includes('not run'))
      expect(stepText('lambda')).toContain('step 7')

      // Step 6, one back from the frontier. Synchronous, like the stepping test above: `#redraw` runs
      // in the click handler, so an `await` here would be waiting for nothing.
      click('lambda', '◀')
      expect(stepText('lambda')).toContain('step 6')

      const lit = [...document.querySelectorAll('#lambda .term .is-redex')]
      // Non-empty first, and separately: a `join('')` over an empty list is `''`, which would compare
      // equal to nothing useful and hide a feature that paints no token at all.
      expect(lit.length).toBeGreaterThan(0)
      // Whitespace between tokens is a text node rather than part of any token's span, so the joined
      // token text is the subterm with its spaces squeezed out.
      expect(lit.map((e) => e.textContent).join('')).toBe('(λx0.f(fx0))')
      // The redex starts at its own opening paren and the binder is inside it — the two facts a
      // displaced window loses first.
      expect(lit[0]?.textContent).toBe('(')
      expect(lit.some((e) => e.classList.contains('tok-binder'))).toBe(true)

      // Step 0 has no redex at all (`LambdaState.redex_span` is `null` there), so nothing may be lit.
      // Without this the assertions above would also pass against a pane that painted `is-redex` on
      // every token of every frame.
      click('lambda', '↺')
      expect(stepText('lambda')).toContain('step 0')
      expect(document.querySelector('#lambda .term .is-redex')).toBeNull()
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

    // `lambdaLinkState`'S `'declined'` BRANCH, NEVER EXERCISED END TO END BEFORE THIS.
    // `link-status.test.ts` drives `linkStatus` directly with an ALREADY-DECIDED state, and every other
    // link test in this file clicks a construct under a program whose λ leg is available — so the
    // "ORDERED MOST-GLOBAL FIRST" branch order `main.ts`'s `lambdaLinkState` doc claims (`declined`
    // checked before the play head, before the span, before truncation) was verified only by
    // inspection. `LAMBDA_DECLINES` is this file's own λ-declining fixture, reused rather than invented
    // — its λ backend refuses the whole PROGRAM, so whatever source construct is clicked must report
    // `'declined'`, not merely "no link" or one of the narrower absences.
    it('reports the declined state when linking a construct under a λ-declining program', async () => {
      await settled(view, LAMBDA_DECLINES)
      linkAt(view, 0)
      await until(() => linkStatusText() !== '')
      expect(linkStatusText()).toContain('this program has no λ lowering, so no construct has a λ link')

      await settled(view, 'let x = 40; x + 2')
    })

    // `lambdaLinkState`'S `'truncated'` BRANCH IS NOT COVERED END TO END HERE — TRIED, AND SKIPPED.
    // `let x = 20000; x + 1` was the candidate (this language lowers naturals to unary Church numerals,
    // so one literal is O(n) bytes of printed λ text): verified directly against `LinkIndex::build`
    // (`redextape-core`) and against `redextape-wasm`'s own `Session`, natively, that this exact program
    // compiles, prints (truncated at 12,064 of 65,536 bytes), takes its one depth-refused "step", and
    // link-resolves the cut "20000" literal — all in low single-digit milliseconds, with the TM leg
    // overflowing just as fast. NATIVELY THIS IS CHEAP. Under the real wasm32 build in a real browser it
    // is not merely slow: dispatching this program crashes the worker's session — `Error: attempted to
    // take ownership of Rust value while it was borrowed`, thrown from `Session.free()`/`dropLive()` in
    // `session-worker.ts` — and the app never recovers (`#results` stays on the previous program's stale
    // text). Reproduced with a fresh mount, and again after letting the prior compile settle fully
    // first, so it is not the ordinary supersession race `dropLive`'s own doc already accounts for.
    //
    // MOST LIKELY CAUSE, not chased further because fixing it is out of scope for a doc/test Minor:
    // `lambda/reduce.rs`'s `depth_exceeds` doc says the guard is "effective only when the running
    // thread's stack is large enough (WASM shadow-stack sizing is a Plan 4 follow-up)" — an already-
    // named, still-open gap. The recursive printer (`lambda/syntax.rs`'s `write_term`) walks to the same
    // `MAX_TERM_DEPTH` (3,000) bound to build this term's `lambdaText`, calibrated with ~2x margin
    // against an 8 MiB NATIVE stack; wasm32's default stack is far smaller, so the identical walk that
    // takes 2ms natively plausibly overflows it, and a Rust panic under wasm is a module-poisoning abort
    // (`redextape-wasm/src/lib.rs`'s own doc) with no unwinding to report it — leaving a later, unrelated
    // `.free()` call to surface this borrow error instead of the real one.
    //
    // WHAT IT WOULD TAKE: measure the wasm32 stack's actual safe recursion depth for this printer the
    // way `lambda/lower.rs`'s doc measured the native one, then either lower `MAX_TERM_DEPTH` to a bound
    // safe on both targets, give wasm builds a larger shadow stack, or make the printer's walk iterative
    // (as `depth_exceeds` itself already was made, 2026-08-01). None of that belongs in a Minors pass —
    // a browser test that crashes the module is worse than the coverage gap it would close.

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
      // `settled` resolves on the RESULTS pane going idle, which is not the same event as the λ pane
      // holding frames — so this read `'not run'` and failed roughly one run in six, from before this
      // slice. Same root cause as the state-table test below, found while chasing that one.
      await until(() => !stepText('lambda').includes('not run'))
      click('lambda', '↺')
      expect(stepText('lambda')).toContain('step 0')
      click('lambda', '▶')
      expect(stepText('lambda')).toContain('step 1')
    })

    // `drawLink()` USED TO RUN ONLY FROM `setLinkTo` AND FROM `onReply`'S ARMS, NEVER FROM `draw()` —
    // so a link made at step 0 kept reporting step 0 forever, through every `back`/`forward`/`play`/
    // `restart` click, because none of those call `drawLink()` on their own. `link-status.ts`'s
    // `not-step-0` message exists specifically to say "you moved off step 0"; wired that way, it could
    // never fire from stepping alone.
    it('reports the step-0 restriction once the play head leaves it, not only at link time', async () => {
      await settled(view, 'let x = 40; x + 2')
      // Recording follows to the frontier (step 7 — see the first test in this block); the λ link is
      // only ever defined at step 0, so land there before linking anything.
      click('lambda', '↺')
      expect(stepText('lambda')).toContain('step 0')

      // The second `x` in `x + 2`, a `Var` reference — any construct works here, since `lambdaLinkState`
      // checks the play head BEFORE it ever asks whether this particular node has a λ span (`main.ts`'s
      // ordering comment: "ORDERED MOST-GLOBAL FIRST").
      linkAt(view, 'let x = 40; x + 2'.indexOf('x + 2'))
      // Resolved to a real node, not a click that landed on nothing — the concrete, pane-independent
      // signal `linkMark` leaves in the source.
      expect(document.querySelector('.cm-editor .linked')).not.toBeNull()
      expect(linkStatusText()).not.toContain('only defined at step 0')

      click('lambda', '▶')
      expect(stepText('lambda')).toContain('step 1')
      expect(linkStatusText()).toContain('the λ link is only defined at step 0')
    })

    // FIX 2's PRIMARY-DIRECTION PROOF: design decision 3's "source -> both", the primary direction of
    // the whole feature. Two tests were believed to cover it and both only ever checked
    // `.cm-editor .linked` and the status text; the one place `is-linked` appears elsewhere in this
    // file (`reports the absence when a construct emits no machine states`, above) FILTERS those tokens
    // OUT without ever asserting any exist — its own `tokens.length > 0` would pass even if `.is-linked`
    // were never applied to anything. Nothing anywhere asserted that a SOURCE-originated link actually
    // paints the λ window and the δ table, not only the source echo.
    it('a source-originated link lights both the λ window and the δ table', async () => {
      await settled(view, 'let x = 40; x + 2')
      // The λ window only ever renders at step 0 (`lambdaLinkWindow`'s gate) — `settled` leaves the
      // head at the frontier (step 7), so restart before linking anything.
      click('lambda', '↺')
      expect(stepText('lambda')).toContain('step 0')

      // The second `x` in `x + 2`, a `Var` reference that reads the let-bound value — verified directly
      // against the running app to own both a λ span and at least one machine state.
      linkAt(view, 'let x = 40; x + 2'.indexOf('x + 2'))
      await until(() => document.querySelector('.term .is-linked') !== null)

      const litToken = document.querySelector('.term .is-linked')
      expect(litToken?.textContent).not.toBe('')
      expect(linkedRowCount()).toBeGreaterThan(0)
    })

    // FIX 3's REGRESSION GUARD: `linkMark` clears its own decoration on `docChanged`, and `main.ts`'s
    // update listener sets `linkable = false` / `link = null` in the SAME synchronous dispatch, well
    // before any debounced worker round trip could confirm the edit even compiles — so the source echo
    // went stale correctly. But the listener never told the OTHER two panes: the λ window and the
    // δ-table's `.is-linked` rows stayed painted from the PREVIOUS index until the next `compiled`
    // reply landed, up to `DEBOUNCE_MS` plus a compile — seconds on a larger program — all while the
    // status line already said "linking resumes when this compiles". All the assertions below are
    // checked with no `await` after the edit, for the same reason the original version of this test
    // did: a version that needed one would be proving the wrong thing.
    it('clears all three panes on an edit, not only the source echo, and says linking will resume', async () => {
      await settled(view, 'let x = 40; x + 2')
      // The λ window only ever renders at step 0 — restart so this test can prove the λ pane was
      // actually painted before the edit, not merely that it stayed absent the whole time.
      click('lambda', '↺')
      linkAt(view, 'let x = 40; x + 2'.indexOf('x + 2'))
      await until(() => linkedSource() !== '')
      await until(() => document.querySelector('.term .is-linked') !== null)
      expect(linkedRowCount()).toBeGreaterThan(0)

      view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } })
      expect(linkedSource()).toBe('')
      expect(linkStatusText()).toContain('resumes')
      // THE FIX: before it, both of these still held their PREVIOUS values here.
      expect(document.querySelector('.term .is-linked')).toBeNull()
      expect(linkedRowCount()).toBe(0)

      // Leave the buffer settled, in case a test added after this one assumes it is.
      await settled(view, 'let x = 40; x + 2')
    })

    // TASK 11's PROOF: the third link direction, λ token -> source. The λ window only ever renders at
    // step 0 (`lambdaLinkWindow`'s gate, same as the test above), so the head is parked there first.
    it('clicking a token in the lambda window lights the specific source construct it names', async () => {
      await settled(view, 'let x = 40; x + 2')
      click('lambda', '↺')
      expect(stepText('lambda')).toContain('step 0')

      linkAt(view, 12)
      await until(() => document.querySelector('.term [data-at]') !== null)

      // Pick a token that is NOT the current target, so the assertion is that the click moved the link
      // rather than that it left it alone.
      const tokens = [...document.querySelectorAll<HTMLElement>('.term [data-at]')].filter(
        (el) => !el.classList.contains('is-linked'),
      )
      expect(tokens.length, 'the window must show more than the target alone').toBeGreaterThan(0)
      tokens[0]?.click()
      await until(() => linkedSource() !== '')

      // THE SPECIFIC CONSTRUCT, NOT MERELY "IT CHANGED". The previous version of this test only checked
      // `linkedSource() !== first` (the target's own source, `"x"`) — satisfied by ANY resolution that
      // differs from the original target, including a wrong one. `tokens[0]` is the window's very first
      // token, `(` at byte offset 0 of `lambdaText`; resolving it against `main.ts`'s
      // `let x = 40; x + 2` names the enclosing `let` binding — verified directly against the running
      // app. A regression in `nodeAtLambda`/`data-at` resolution now has to reproduce this exact string
      // to keep passing, not merely produce something other than `"x"`.
      expect(linkedSource()).toBe('let x = 40;')
      expect(view.state.doc.toString()).toContain(linkedSource())
    })

    // FIX 4's REGRESSION GUARD: `TmPane.setLink` wrote `scrollTop` and then called `#drawTable`, which
    // — while `#follow.following` (the default state on every fresh compile; see `setProgram`'s
    // `#follow.attach()`) — computed its OWN target from the machine's CURRENT frame and overwrote the
    // link's write in the same synchronous turn, so a source-originated link scroll never moved the
    // table at all while following. NEITHER SCROLL TEST ABOVE EXERCISES THIS: `follows the machine into
    // view with no user scroll at all` only proves the table lands somewhere non-zero on its own, and
    // `stops following once the user scrolls` scrolls the table MANUALLY first, which detaches `Follow`
    // before any link is ever in play. This is the one that links from source while following is still
    // on, which is the default a user hits on every fresh compile.
    it('a source-originated link scrolls the table into view even while it is still following the machine', async () => {
      await settled(view, BIG)
      const followedTop = table().scrollTop
      // Sanity: following put the table somewhere real — if this were 0, the assertion below could not
      // tell "the link moved it" from "nothing here ever moves".
      expect(followedTop).toBeGreaterThan(0)
      const reattach = document.querySelector('#tm .table-reattach') as HTMLButtonElement
      // Nothing has scrolled manually yet, so `Follow` is still attached.
      expect(reattach.hidden).toBe(true)

      // `f(head(xs))` — `map`'s higher-order `f` parameter, called through a closure rather than a
      // statically-resolved callee — is the one construct in `BIG` that owns machine states at all;
      // verified directly against the running app by scanning every source offset. Position `+1` lands
      // on `(`, a byte no narrower child span (`f` alone, or `head(xs)`) covers, so it resolves to the
      // call expression itself rather than the bare callee `Var`.
      linkAt(view, BIG.indexOf('f(head(xs))') + 1)
      await until(() => linkedRowCount() > 0)

      // THE BUG, DIRECTLY: a linked block must actually be ON SCREEN, which virtualization only renders
      // once the table has actually scrolled there. Under the reverted-scroll bug `scrollTop` never
      // leaves `followedTop` and this stays null.
      expect(document.querySelector('#tm .state-row.is-linked')).not.toBeNull()
      expect(table().scrollTop).not.toBe(followedTop)

      // FOLLOWING ITSELF WAS NOT DISTURBED — the other half of design §5.1 and `setLink`'s own doc: a
      // link is a one-shot scroll, not a reattach/detach decision, so `Follow`'s own flag must read
      // exactly as it did before the link ran.
      expect(reattach.hidden).toBe(true)

      // Leave the buffer settled, in case a test added after this one assumes it is.
      await settled(view, 'let x = 40; x + 2')
    })

    it('renders only the visible rows, not the whole machine', async () => {
      await settled(view, BIG)
      // `settled` resolves on the RESULTS pane going idle, which is not the same event as THIS
      // program's table being on screen. Observed flaking 2 runs in 10, and fast — under 210 ms
      // against a normal ~1 s — the signature of asserting before the table is ready.
      //
      // WAITING FOR `.state-row` TO BE NON-EMPTY DOES NOT FIX IT, and that was the first attempt: the
      // previous test leaves its own rows in the DOM, so the wait is satisfied instantly by a stale
      // table and the geometry below is read against the wrong program. The readiness signal has to
      // be specific to `BIG` — its spacer is exactly 25,852 rows x ROW_HEIGHT.
      await until(() => spacer().style.height === BIG_SPACER)
      const rows = document.querySelectorAll('#tm .state-row')
      // THE SCROLL CONTAINER MUST ACTUALLY BE BOUNDED, and this asserts it rather than assuming it.
      // `.state-table`'s `max-height: 40vh` is what bounds it, and Vitest serves its own tester HTML —
      // `tests/browser/setup.ts` is what gets `style.css` onto that page. If that setup ever breaks, the
      // box lays out at its full content height (measured: 271,968px for 11,332 rows), nothing bounds
      // `#drawTable`'s window computation, and every draw during recording renders every row. THERE IS
      // NO CLAMP IN `TmPane` TO FALL BACK ON — it was deleted a commit before this comment was first
      // written, on the grounds that untested defence encoding a CSS rule in TypeScript is worse than
      // the gap it papers over. So the failure is not an assertion below reading the wrong number: it is
      // `await settled(view, BIG)` above never resolving, because recording 25,852 rows' worth of frames
      // through a renderer that redraws all of them every step does not finish inside `until`'s 30s
      // budget, and the whole test times out before reaching the expectations that follow.
      // THIS is the bounded-container assertion. Two others used to sit here and both were drained by
      // the `until` above: once the spacer is pinned to `BIG_SPACER`, asserting it exceeds 100,000 is a
      // tautology, and `clientHeight * 10 < spacer` only restates `clientHeight < 62,044`, which this
      // line already beats by a wide margin.
      expect(table().clientHeight).toBeLessThan(window.innerHeight)
      const bound = Math.ceil(table().clientHeight / ROW_HEIGHT) + 1 + 2 * OVERSCAN
      expect(rows.length).toBeLessThanOrEqual(bound)
      // The property, stated as the thing it is: far fewer rows than the machine has. `map_fold` is
      // 25,852, so a renderer that drew them all would fail this by two orders of magnitude.
      expect(rows.length).toBeLessThan(200)
      // `ROW_HEIGHT` and `.state-row`'s CSS `height` are two numbers with nothing tying them together —
      // `bound` above is computed from the same constant this asserts, so a mismatch between the two
      // would self-cancel there. Measure a real row instead of trusting the constant.
      const first = rows[0]
      expect(first).toBeDefined()
      expect(first?.getBoundingClientRect().height).toBe(ROW_HEIGHT)
    })

    it('highlights the current state and outlines the rule about to fire', async () => {
      await settled(view, 'let x = 40; x + 2')
      // By the time `settled` resolves, the TM leg is fully recorded and its head sits at the
      // frontier, which is `halt` — `frame.rule` is `null` there (`types.ts`'s doc: "at an accept
      // state, at `halt`, or at a stuck configuration"), so `is-firing` would be empty at this exact
      // frame. `◀` once steps back to the frame whose rule fires INTO halt, which is where a rule is
      // actually about to fire.
      click('tm', '◀')
      expect(document.querySelectorAll('#tm .state-row.is-current').length).toBe(1)
      expect(document.querySelectorAll('#tm .state-row.is-firing').length).toBe(1)
    })

    it('moves the highlight as the machine steps', async () => {
      await settled(view, 'let x = 40; x + 2')
      // Same frontier fact as above: `▶` is a no-op here (`main.ts`'s `forward`, mirroring the λ
      // leg's already-tested "does nothing at the frontier of a run that already ended"), so stepping
      // must go backward to move at all.
      const before = document.querySelector('#tm .state-row.is-current')?.textContent
      // Several steps, not one: a machine can re-enter the same state, so a single ◀ proves nothing.
      for (let i = 0; i < 8; i += 1) click('tm', '◀')
      expect(document.querySelector('#tm .state-row.is-current')?.textContent).not.toBe(before)
    })

    // NOTHING ELSE IN THIS SUITE EXERCISES THE POSITIVE CASE. `stops following once the user scrolls`
    // below only proves `scrollTop` stays put after a detach — a table that never follows at all would
    // satisfy it just as well. `BIG` is the fixture that can show the difference: `setProgram` parks
    // `scrollTop` at 0, and by the time recording settles the frontier's row is far enough down
    // `map_fold`'s 25,852 rows that only an actual write moves it, and only an actual write keeps
    // `.is-current` inside the rendered window at all.
    it('follows the machine into view with no user scroll at all', async () => {
      await settled(view, BIG)
      expect(table().scrollTop).toBeGreaterThan(0)
      expect(document.querySelector('#tm .state-row.is-current')).not.toBeNull()
    })

    it('stops following once the user scrolls', async () => {
      await settled(view, BIG)
      // `▶` at this frontier would be `client.extend()` — an async worker round trip — and asserting
      // right after the click loop with no `await` would pass whether or not detach worked, since no
      // redraw happens before the assertion runs. `◀` moves the head and redraws synchronously
      // (`main.ts`'s `back` calls `leg.hist.back()` then `draw()` with no worker involved), so it is
      // the one that actually exercises whether a detached table still gets re-centred.
      table().scrollTop = 0
      table().dispatchEvent(new Event('scroll'))
      for (let i = 0; i < 5; i += 1) click('tm', '◀')
      // Literal 0, NOT a `parked` variable read after the dispatch: the scroll handler re-centres
      // synchronously inside that same dispatch when detach fails, so a value captured post-dispatch
      // would already reflect the bug and make this comparison pass vacuously either way.
      expect(table().scrollTop).toBe(0)
    })

    // THE REATTACH CONTROL ITSELF. Design §3.7/§4 mandated it and nothing built it into the plan's
    // tasks; `follow` above proves detach happens but never proves there is any way back short of a
    // recompile. ADDED AND REMOVED, NEVER DISABLED (`pane-chrome.ts`'s idiom for the continue button):
    // present only while detached, and clicking it must redraw immediately rather than wait for a step.
    it('reattaches through its own control, which exists only while detached', async () => {
      await settled(view, BIG)
      const reattach = document.querySelector('#tm .table-reattach') as HTMLButtonElement
      expect(reattach).not.toBeNull()
      expect(reattach.hidden).toBe(true)
      const followedTop = table().scrollTop

      table().scrollTop = 0
      table().dispatchEvent(new Event('scroll'))
      expect(reattach.hidden).toBe(false)

      reattach.click()
      // No step happened, so a working reattach recomputes the same target it had before detaching —
      // this asserts the redraw is synchronous with the click, not merely that following resumed.
      expect(table().scrollTop).toBe(followedTop)
      expect(reattach.hidden).toBe(true)
    })

    // A SCROLL EVENT ARRIVING WHILE THE TABLE IS HIDDEN MUST NOT DETACH IT.
    //
    // `#drawTable` writes `scrollTop`, and the browser delivers that write's `scroll` event at the next
    // rendering update rather than synchronously. Hiding the table in between lands the echo on a
    // `display: none` box, where `scrollTop` reads back 0 — further from the expected position than any
    // tolerance — so the table detached with no user gesture at all and the highlighted row left the
    // DOM. Reproduced 5/5 in Chromium by stepping, hiding, then showing.
    //
    // THE EVENT IS DISPATCHED RATHER THAN AWAITED, deliberately. A version of this test that stepped
    // and hid and waited two animation frames passed against the bug — whether a real echo is in flight
    // at the moment of the hide depends on whether that step moved the follow target at all, which
    // depends on the program. Dispatching puts the event where the mechanism needs it, so the test
    // fails whenever the guard is removed instead of whenever the timing happens to line up.
    it('ignores a scroll that arrives while the table is hidden', async () => {
      await settled(view, BIG)
      const toggle = document.querySelector('#tm .table-toggle') as HTMLButtonElement
      const reattach = document.querySelector('#tm .table-reattach') as HTMLButtonElement
      expect(reattach.hidden).toBe(true)

      toggle.click()
      table().dispatchEvent(new Event('scroll'))
      toggle.click()

      expect(reattach.hidden).toBe(true)
      expect(document.querySelector('#tm .state-row.is-current')).not.toBeNull()
    })

    // THE CONTROL GOES AWAY WITH THE THING IT CONTROLS. `#reattach.hidden` is maintained inside
    // `#drawTable`, which the toggle calls only when REOPENING — so hiding a detached table left a
    // live "follow" button with nothing under it, offering to reposition something not on screen.
    // That is the idiom's own rule broken (`pane-chrome.ts`: a control is present only when it does
    // something), and the `|| !this.#open` term added for it could never fire, because the one place
    // that reads it does not run on the way down.
    it('takes the reattach control away with the table it belongs to', async () => {
      await settled(view, BIG)
      const toggle = document.querySelector('#tm .table-toggle') as HTMLButtonElement
      const reattach = document.querySelector('#tm .table-reattach') as HTMLButtonElement

      table().scrollTop = 0
      table().dispatchEvent(new Event('scroll'))
      expect(reattach.hidden).toBe(false)

      toggle.click()
      expect(reattach.hidden).toBe(true)
      toggle.click()
      // Reopening restores it, because hiding the table is not a decision to start following again.
      expect(reattach.hidden).toBe(false)
    })

    // A HIDE MUST NOT POISON THE ECHO EXPECTATION. Drawing while hidden reads `clientHeight` 0, so
    // `targetScrollTop` returns the UNCENTRED position — exactly `floor(viewportHeight / 2)` below the
    // real one — and records it as the scroll `Follow` should expect. The write itself is a no-op on a
    // non-rendered box, but `#expected` sticks; and on reopen the correct target equals the restored
    // `scrollTop`, so the write is skipped and `#expected` is never corrected. A real user scroll
    // landing within the tolerance of that stale value is then absorbed as an echo, the table does not
    // detach, and the next frame yanks the view back — the trap design §3.7 already names, reached by a
    // zero-viewport movement rather than a clamped one.
    it('still detaches on a user scroll after the table has been hidden and shown', async () => {
      await settled(view, BIG)
      const toggle = document.querySelector('#tm .table-toggle') as HTMLButtonElement
      const reattach = document.querySelector('#tm .table-reattach') as HTMLButtonElement
      expect(reattach.hidden).toBe(true)

      // The poisoned value, computed the way the bug computes it rather than hardcoded.
      const poisoned = table().scrollTop + Math.floor(table().clientHeight / 2)
      toggle.click()
      toggle.click()

      table().scrollTop = poisoned
      table().dispatchEvent(new Event('scroll'))
      expect(reattach.hidden).toBe(false)
    })

    // THE SCROLL RANGE MUST SURVIVE A COMPILE THAT HAPPENS WHILE THE TABLE IS CLOSED, and this is a
    // plain user sequence: hide δ, edit the program, show δ.
    //
    // `#drawTable` writes `scrollTop` BEFORE it writes the spacer height, and a `scrollTop` write
    // CLAMPS to the current scroll height. So a spacer left at the previous program's size silently
    // truncates the reopen write: coming from `let x = 40; x + 2` (8,112px) into `map_fold`
    // (620,448px), a request for 161,786 was clamped to 7,755 — the current row not on screen, and
    // then the echo arriving against an unclamped expectation detached the table with no user gesture
    // at all. From a program that declined the TM leg the spacer is 0px, the write clamps to 0, and no
    // scroll event fires at all: parked at row 0, still nominally following, no reattach offered.
    it('keeps the scroll range honest across a compile with the table hidden', async () => {
      await settled(view, 'let x = 40; x + 2')
      const toggle = document.querySelector('#tm .table-toggle') as HTMLButtonElement
      const reattach = document.querySelector('#tm .table-reattach') as HTMLButtonElement

      toggle.click()
      await settled(view, BIG)
      toggle.click()
      await until(() => spacer().style.height === BIG_SPACER)

      // The echo lands a frame or two after the reopen write, so give it time to do its damage.
      await new Promise((r) => setTimeout(r, 150))
      expect(document.querySelector('#tm .state-row.is-current')).not.toBeNull()
      expect(reattach.hidden).toBe(true)
    })

    it('hides and shows the table without losing the play head', async () => {
      await settled(view, 'let x = 40; x + 2')
      for (let i = 0; i < 4; i += 1) click('tm', '◀')
      const step = stepText('tm')
      const toggle = document.querySelector('#tm .table-toggle') as HTMLButtonElement
      toggle.click()
      expect(table().hidden).toBe(true)
      toggle.click()
      expect(stepText('tm')).toBe(step)
    })

    it('shows no table for a program that declines the TM leg', async () => {
      // §11.9's known one-leg program: `200` under unary overflows the TM leg and leaves λ steppable.
      await settled(view, 'let x = 200; x + 1')
      expect(document.querySelectorAll('#tm .state-row').length).toBe(0)
      // A row count of zero alone would also be satisfied by the app failing to render at all, or by
      // `#tm` not existing. Pin that the page IS alive and the OTHER leg did compile, so this test
      // fails for a missing table rather than for a missing app.
      expect(document.querySelector('#tm .state-table')).not.toBeNull()
      expect(paneText('lambda')).not.toBe('')
    })

    // The toggle must not disturb the table's own state either — a reopen that lost the highlight
    // would leave the play head intact and still be wrong, which `stepText` alone cannot see.
    it('keeps the highlight across a hide and show', async () => {
      await settled(view, 'let x = 40; x + 2')
      click('tm', '◀')
      const current = document.querySelector('#tm .state-row.is-current')?.textContent
      expect(current).toBeDefined()
      const toggle = document.querySelector('#tm .table-toggle') as HTMLButtonElement
      toggle.click()
      toggle.click()
      expect(document.querySelector('#tm .state-row.is-current')?.textContent).toBe(current)
      expect(document.querySelectorAll('#tm .state-row.is-firing').length).toBe(1)
    })
  })
})
