import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main><section id="editor" class="pane"></section><section id="results" class="pane results"></section></main>`

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

/// Replace the whole buffer, exactly as a user retyping it would.
function retype(src: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
}

describe('the app, end to end', () => {
  // ONE MOUNT FOR THE FILE. ES module imports are cached, so `main()` runs once per page and Vitest
  // gives each test FILE its own page — mounting per test would silently reuse the first app.
  beforeAll(async () => {
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
    await until(() => document.querySelectorAll('.decline').length === 0)
    expect(resultsText()).not.toContain('declined')

    // Leave the buffer as the other tests found it, in case one is ever added after this.
    retype('let x = 40; x + 2')
    await until(() => resultsText().includes('β-steps'))
  })
})
