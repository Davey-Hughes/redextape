import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { type EscapeFocus, type EscapePress, escapeClears } from '../../src/link-clear'
import { createLinkWiring } from '../../src/link-wiring'
import type { PaneCollection } from '../../src/panes'
import type { SessionRegistry } from '../../src/sessions'

/**
 * Escape's rule and `LinkWiring.unpin` (`docs/superpowers/specs/2026-11-17-link-clear-design.md`); the clicks and the
 * real key presses are `tests/browser/link-clear.test.ts`'s.
 */

const ESCAPE: EscapePress = {
  key: 'Escape',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  prevented: false,
  composing: false,
  focus: 'view',
  popoverOpen: false,
}

describe('escapeClears', () => {
  it.each<[EscapeFocus, boolean]>([
    ['view', true],
    ['body', true],
    ['editor', false],
    ['other', false],
  ])('a bare Escape with the focus %s clears: %s', (focus, clears) => {
    expect(escapeClears({ ...ESCAPE, focus })).toBe(clears)
  })

  it.each<[string, Partial<EscapePress>]>([
    ['another key', { key: 'Enter' }],
    ['Ctrl', { ctrl: true }],
    ['Alt', { alt: true }],
    ['Shift', { shift: true }],
    ['Meta', { meta: true }],
    ['a press something before used', { prevented: true }],
    ['a press in a composition', { composing: true }],
    ['a menu open', { popoverOpen: true }],
  ])('a press with %s does not clear', (_, change) => {
    expect(escapeClears({ ...ESCAPE, ...change })).toBe(false)
  })
})

/** A link wiring over no views, which counts its draws and what it announces. */
function wiring() {
  const seen = { draws: 0, said: [] as string[], marks: 0 }
  const status = { textContent: '' } as HTMLElement
  const links = createLinkWiring({
    view: () =>
      ({
        dispatch: () => {
          seen.marks += 1
        },
      }) as unknown as EditorView,
    statusHost: status,
    sessions: {} as SessionRegistry,
    panes: { of: () => [] } as unknown as PaneCollection,
    draw: () => {
      seen.draws += 1
    },
    announce: (t) => seen.said.push(t),
    viewTitle: () => '',
    arranged: () => true,
  })
  links.setIndex({ linkFor: () => ({ source: null, states: [], instrs: [] }) } as never)
  return { links, seen }
}

describe('unpin', () => {
  it('does nothing with nothing pinned: no mark, no draw, nothing said', () => {
    const { links, seen } = wiring()
    links.unpin()
    expect(seen).toEqual({ draws: 0, said: [], marks: 0 })
  })

  it('clears a pin and draws it gone, and linking stays on', () => {
    const { links, seen } = wiring()
    links.setLinkTo(7, 'lambda')
    const after = { ...seen }
    links.unpin()
    expect(links.link).toBeNull()
    expect(links.linkable).toBe(true)
    expect(seen.marks - after.marks, 'the source mark taken off').toBe(1)
    expect(seen.draws - after.draws, 'one draw').toBe(1)
  })

  it('is no link gesture, and a link is one', () => {
    const { links } = wiring()
    const before = links.gestures
    links.setLinkTo(7, 'lambda')
    expect(links.gestures).toBe(before + 1)
    links.unpin()
    expect(links.gestures).toBe(before + 1)
  })

  it('does nothing while linking is off, after an edit', () => {
    const { links, seen } = wiring()
    links.setLinkTo(7, 'lambda')
    links.clearLink()
    const after = { ...seen, said: [...seen.said] }
    links.unpin()
    expect(seen).toEqual(after)
  })
})
