import { describe, expect, it, vi } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { LambdaState } from '../../src/types'
import { controlState, newPaneHost } from './harness'

/**
 * 5d-iii design §4.2's split body: the editor mounted (or not) above the existing frame renderer, and when
 * the fork control is offered (`lambda-pane.ts`'s `#refreshDetach` doc).
 *
 * PANES ARE CONSTRUCTED DIRECTLY, matching `view-status.test.ts`'s idiom: this is chrome and body
 * wiring built in the constructor and moved by `setEditor`/`render` directly, with
 * nothing on the path to it that needs `main()`.
 */

/**
 * `PaneEvents`'s members, all inert: the one control a test here clicks is the text panel's toggle, which
 * reports through `collapse`, and this leaves `collapse` out.
 */
const events = (): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  toNewest: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
  detach: vi.fn(),
  editSink: () => vi.fn(),
})

/**
 * A `LambdaState` fixture built through a helper typed as `LambdaState`, not an inline object literal
 * — so a field left out (`owner`) or mistyped (`spans` as `[]` inferred rather than the field's own type)
 * is a compiler error here instead of a silently wrong fixture. `viewmodel.rs`'s `LambdaState` is the real
 * shape this is built from.
 */
const lambdaState = (over: Partial<LambdaState> = {}): LambdaState => ({
  text: '\\x. x',
  spans: new Uint8Array(),
  cut: null,
  step: 0,
  redex_span: null,
  owner: 'None',
  ...over,
})

const CONTROLS = controlState(false, '0')

describe('LambdaPane editor region', () => {
  it('has no editor region until one is set', () => {
    const el = newPaneHost()
    new LambdaPane(el, events())
    expect(el.querySelector('.term-editor')).toBeNull()
  })

  it('mounts the editor when set and REMOVES it when cleared, never hides it', () => {
    const el = newPaneHost()
    const pane = new LambdaPane(el, events())
    pane.setEditor('\\x. x')
    expect(el.querySelector('.term-editor')).not.toBeNull()
    pane.setEditor(null)
    // Removed, not hidden — the same standard `view-header.ts`'s `setDetached` holds for the
    // `copy · not linked` status, and what makes "the editor is gone" have one answer.
    expect(el.querySelector('.term-editor')).toBeNull()
  })

  it('reopens the text panel on remount, not just on the next click', () => {
    // Mount, collapse, unmount, remount: a remounted editor starts where its buffer's record says (open,
    // here), so the control that names its state has to say so too.
    const el = newPaneHost()
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

  // A FORK IS TAKEN FROM THE FRAME'S OWN STEP, which the view shows as a tree or as text, so none is offered
  // before a frame is on screen.
  it('offers a fork once a frame is on screen, and not before', () => {
    const el = newPaneHost()
    const pane = new LambdaPane(el, events())
    expect(el.querySelector('button.detach')).toBeNull()
    pane.render(lambdaState(), CONTROLS)
    expect(el.querySelector('button.detach')).not.toBeNull()
  })
})
