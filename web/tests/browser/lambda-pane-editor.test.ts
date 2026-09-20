import { describe, expect, it, vi } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { LambdaState } from '../../src/types'

/**
 * Design §4.2's split body: the editor mounted (or not) above the existing frame renderer, and §4.1's
 * new refusal — a pane showing a link window must not offer a fork, now that `detach` carries a step
 * rather than the pane's own body text (`lambda-pane.ts`'s `#refreshDetach` doc).
 *
 * PANES ARE CONSTRUCTED DIRECTLY, matching `view-status.test.ts`'s idiom: this is chrome and body
 * wiring built in the constructor and moved by `setEditor`/`render`/`renderLink` directly, with
 * nothing on the path to it that needs `main()`.
 */
const host = (): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane'
  document.body.append(el)
  return el
}

/** `PaneEvents`'s members, all inert — no test here clicks a control. */
const events = (): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
  detach: vi.fn(),
  editScratch: vi.fn(),
})

/**
 * A `LambdaState` fixture built through a helper typed as `LambdaState`, not an inline object literal
 * — so a field `2026-08-11-plan5d-iii-editable-lambda.md`'s sketch omitted (`owner`, missing from its
 * literal entirely) or mistyped (`spans` as `[]` inferred rather than `Classified`) is a compiler error
 * here instead of a silently wrong fixture. `viewmodel.rs`'s `LambdaState` is the real shape this is built
 * from.
 */
const lambdaState = (over: Partial<LambdaState> = {}): LambdaState => ({
  text: '\\x. x',
  spans: [],
  cut: null,
  step: 0,
  redex_span: null,
  owner: 'None',
  ...over,
})

const CONTROLS = {
  canRestart: true,
  canBack: false,
  canForward: true,
  canPlay: true,
  playing: false,
  stepText: '0',
  continueLabel: null,
}

describe('LambdaPane editor region', () => {
  it('has no editor region until one is set', () => {
    const el = host()
    new LambdaPane(el, events())
    expect(el.querySelector('.term-editor')).toBeNull()
  })

  it('mounts the editor when set and REMOVES it when cleared, never hides it', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.setEditor('\\x. x')
    expect(el.querySelector('.term-editor')).not.toBeNull()
    pane.setEditor(null)
    // Removed, not hidden — the same standard `view-header.ts`'s `setDetached` holds for the
    // `copy · not linked` status, and what makes "the editor is gone" have one answer.
    expect(el.querySelector('.term-editor')).toBeNull()
  })

  it('reopens the text panel on remount, not just on the next click', () => {
    // The reviewer's repro for the stale-state defect, carried over from the collapse button this panel
    // replaced: mount, collapse, unmount, remount. A remounted editor starts where its buffer's record
    // says (open, here), so the control that names its state has to say so too.
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.setEditor('\\x. x')

    const toggle = el.querySelector<HTMLButtonElement>('[data-panel="text"] .panel-toggle')
    if (toggle === null) throw new Error('the text panel was not added')
    toggle.click()
    expect(el.querySelector<HTMLElement>('.term-editor')?.hidden).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    pane.setEditor(null)
    pane.setEditor('\\y. y')

    const editorHost = el.querySelector<HTMLElement>('.term-editor')
    expect(editorHost).not.toBeNull()
    expect(editorHost?.hidden).toBe(false)
    expect(el.querySelector('[data-panel="text"] .panel-toggle')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('offers no fork while a link window is showing', () => {
    // The guard that used to hold for free, before `detach` carried a step (T5).
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.render(lambdaState(), CONTROLS)
    expect(el.querySelector('button.detach')).not.toBeNull()
    pane.renderLink({
      text: '\\x. x',
      spans: [],
      target: { start: 0, end: 1 },
      origin: 0,
      clippedHead: false,
      clippedTail: false,
    })
    expect(el.querySelector('button.detach')).toBeNull()
  })
})
