import { beforeEach, describe, expect, it } from 'vitest'
import { History } from '../../src/history'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { ClientPort, SessionId } from '../../src/session-client'
import { SessionClient } from '../../src/session-client'
import type { LegState, SessionEntry } from '../../src/sessions'
import { PaneSlot, SessionRegistry } from '../../src/sessions'
import type { LambdaState } from '../../src/types'

/**
 * TWO PANES BOUND TO TWO DIFFERENT λ SESSIONS, RENDERING TWO DIFFERENT TERMS AT THE SAME TIME — plan
 * T7's test, in a real DOM against the real `LambdaPane`.
 *
 * WHY THIS IS NOT DRIVEN THROUGH `main()`, unlike most of this directory, and it is the same reason
 * `detached-badge.test.ts` gives one task earlier: the app cannot reach the state under test. `main.ts`
 * registers exactly one session, and nothing in this slice can add a second — a `LambdaScratch` session
 * needs a worker message `session-worker.ts` does not have (and this task may not touch that file), and
 * creating one by editing a source-derived λ view is design §4.3, which is T8. An app-level test would
 * have one λ session to bind two panes to, which is exactly the "single-session implementation" the
 * plan says anything weaker passes on.
 *
 * **T8 LANDED AND HALF OF THAT IS NOW HISTORY, WHICH IS WHY IT IS AMENDED RATHER THAN LEFT TO ROT.**
 * The app CAN add a second λ session now — `tests/browser/scratch-app.test.ts` drives the control that
 * does it. What has not changed is the sentence that matters here: this app has ONE λ pane, so two
 * panes side by side on two λ sessions is still not a state `main()` can reach, and the registry
 * below is still built by hand for exactly that reason.
 *
 * SO THE REGISTRY IS BUILT HERE AND THE PRODUCTION PATH IS SHARED RATHER THAN RE-IMPLEMENTED.
 * `main.ts`'s `draw()` is, for each pane, `slot.resolve(reg)` followed by `slot.render(reg, pane, leg)`
 * — the two calls `paint` below makes. Resolution, `controlState`, the selector's option list and the
 * `[detached]` badge all live inside `PaneSlot.render`, so nothing about what a binding MEANS is
 * restated in this file.
 *
 * `tests/node/sessions.test.ts` ASSERTS THE SAME CLAIM WITHOUT A DOM and is not redundant with this.
 * That tier drives recording fakes and says which binding resolved to which leg; this one says the
 * text a user would read is different in the two panes, and that the control which moves a binding is
 * on the page, is text, and works.
 */

const SOURCE: SessionId = 'source'
const SCRATCH: SessionId = 'lambda-scratch'

/** A `ClientPort` with no thread behind it — a `SessionEntry` needs a client and nothing here posts. */
function fakeClient(): SessionClient {
  const port: ClientPort = { postMessage: () => undefined, addEventListener: () => undefined }
  return new SessionClient(port, () => undefined)
}

/** A λ-only session whose single recorded frame prints `text`. The text is the discriminator. */
function lambdaSession(id: SessionId, label: string, text: string, detached: boolean): SessionEntry {
  const hist = new History<LambdaState>(1_000_000)
  hist.push({ text, spans: [], cut: null, step: 0, redex_span: null, owner: 'None' }, 1)
  const leg: LegState<LambdaState> = { hist, status: { available: true, reason: '' }, done: null, timer: null }
  return { id, label, detached, client: fakeClient(), legs: { lambda: leg } }
}

const host = () => {
  const el = document.createElement('section')
  el.className = 'pane'
  document.body.append(el)
  return el
}

/** What `main.ts`'s `draw()` does for one λ pane, and nothing else. */
const paint = (reg: SessionRegistry, slot: PaneSlot<'lambda'>, pane: LambdaPane) =>
  slot.render(reg, pane, slot.resolve(reg))

/** The term the pane is showing, read the way a user reads it. */
const term = (pane: HTMLElement) => pane.querySelector('pre.term')?.textContent ?? ''

const selector = (pane: HTMLElement) => pane.querySelector<HTMLSelectElement>('.pane-binding select')

/** `PaneEvents`'s six required members. `rebind` is the only one any test here fires. */
const events = (slot: PaneSlot<'lambda'>, after: () => void): PaneEvents => ({
  back: () => undefined,
  forward: () => undefined,
  play: () => undefined,
  restart: () => undefined,
  extend: () => undefined,
  rebind: (session: SessionId) => {
    slot.rebind(session)
    after()
  },
})

beforeEach(() => {
  document.body.replaceChildren()
})

describe('the binding selector', () => {
  /**
   * THE TEST PLAN T7 NAMES, WORD FOR WORD. Both panes are painted before either is asserted, and both
   * are asserted before anything is rebound — a "bind, read, rebind, read" sequence would pass on an
   * implementation with one live session and a mutable global, which is what "simultaneously" rules
   * out.
   *
   * THE TERMS DIFFER ON PURPOSE, the discriminator `pool-isolation.test.ts` uses for three sessions'
   * answers: two panes showing the same term would look identical whether or not the bindings were
   * honoured, so the assertion has to be on the value.
   */
  it('renders two different λ sessions side by side, at the same time', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'source', '(λx. x) 1', false))
    reg.add(lambdaSession(SCRATCH, 'λ scratchpad', '(λy. y y) 2', true))

    const leftHost = host()
    const rightHost = host()
    const left = new PaneSlot('lambda', SOURCE)
    const right = new PaneSlot('lambda', SCRATCH)
    const leftPane = new LambdaPane(
      leftHost,
      events(left, () => undefined),
    )
    const rightPane = new LambdaPane(
      rightHost,
      events(right, () => undefined),
    )

    paint(reg, left, leftPane)
    paint(reg, right, rightPane)

    expect(term(leftHost)).toBe('(λx. x) 1')
    expect(term(rightHost)).toBe('(λy. y y) 2')
    // Said as an inequality too: the mutation this task runs — resolving every binding to the source
    // session — leaves both panes reading `(λx. x) 1`, and this is the line that names that failure.
    expect(term(leftHost)).not.toBe(term(rightHost))
  })

  /**
   * §5's JOINT DETACHMENT CASE, WHICH THE DESIGN OWED TO "THE TASK THAT WIRES `main.ts`" — its words,
   * because it could not be written when the badge landed: "bind a pane to a scratch, see both,
   * rebind, see neither ... It needs a binding to flip, and per §3.2b none exists."
   *
   * BOTH HALVES, AND ONLY ONE PANE. The badge must be gone after the rebind, not merely present
   * before it; and the pane still bound to the source session must never have had one, which is
   * §4.3's ordinary state (one pane detaches, the other keeps running against source).
   */
  it('carries the [detached] badge on the pane bound to a scratch, and drops it on rebind', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'source', 'a', false))
    reg.add(lambdaSession(SCRATCH, 'λ scratchpad', 'b', true))

    const attachedHost = host()
    const detachedHost = host()
    const attached = new PaneSlot('lambda', SOURCE)
    const detached = new PaneSlot('lambda', SCRATCH)
    const attachedPane = new LambdaPane(
      attachedHost,
      events(attached, () => undefined),
    )
    const detachedPane = new LambdaPane(
      detachedHost,
      events(detached, () => undefined),
    )

    paint(reg, attached, attachedPane)
    paint(reg, detached, detachedPane)
    expect(detachedHost.querySelector('h2')?.textContent).toContain('[detached]')
    expect(attachedHost.querySelector('h2')?.textContent).not.toContain('detached')

    detached.rebind(SOURCE)
    paint(reg, detached, detachedPane)
    expect(detachedHost.querySelector('h2')?.textContent).toBe('lambda')
  })

  /**
   * THE CONTROL IS ABSENT WHILE IT COULD DO NOTHING, which is `pane-chrome.ts`'s stated idiom (added
   * and removed, never disabled) and §4.5's standard (a thing that provably cannot work should not be
   * presented as though it might). It is also today's app exactly: one session, so no selector.
   *
   * ASSERTED IN BOTH DIRECTIONS AND BACK. A control that appears and never leaves passes the middle
   * assertion; the third is what catches it, and it is reachable — §4.3's recompile-from-source
   * retires a scratch, which takes the λ options back down to one.
   */
  it('appears only once a second session offers this leg, and leaves again when one is retired', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'source', 'a', false))

    const el = host()
    const slot = new PaneSlot('lambda', SOURCE)
    const pane = new LambdaPane(
      el,
      events(slot, () => paint(reg, slot, pane)),
    )

    paint(reg, slot, pane)
    expect(selector(el)).toBeNull()

    reg.add(lambdaSession(SCRATCH, 'λ scratchpad', 'b', true))
    paint(reg, slot, pane)
    const select = selector(el)
    expect(select).not.toBeNull()
    // NAMED BY TEXT, NOT BY COLOUR OR POSITION. §6 forbids this slice adding a colour-carried state,
    // and the sessions are told apart by their labels — which is also what a screen reader gets. An
    // implementation that distinguished them any other way would leave these strings unset.
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual(['source', 'λ scratchpad'])
    expect(select?.value).toBe(SOURCE)
    // The `<select>` is inside a `<label>` carrying the caption, so the control is named without an
    // `aria-label` to keep in step — the same implicit-label idiom `index.html`'s encoding picker uses.
    expect(select?.closest('label')?.textContent).toContain('session')

    reg.remove(SCRATCH)
    paint(reg, slot, pane)
    expect(selector(el)).toBeNull()
  })

  /**
   * THE CONTROL ACTUALLY MOVES THE BINDING, driven through the DOM rather than by calling `rebind`.
   * Everything above this asserts what a binding does once it has moved; this is the one that says a
   * user can move it — and it is the path `main.ts` wires (`events(...).rebind` calls `slot.rebind`
   * then `draw()`), reproduced here by the `after` callback repainting.
   */
  it('rebinds the pane when a session is picked, and follows it back', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'source', 'from source', false))
    reg.add(lambdaSession(SCRATCH, 'λ scratchpad', 'from scratch', true))

    const el = host()
    const slot = new PaneSlot('lambda', SOURCE)
    const pane = new LambdaPane(
      el,
      events(slot, () => paint(reg, slot, pane)),
    )
    paint(reg, slot, pane)
    expect(term(el)).toBe('from source')

    const select = selector(el)
    if (select === null) throw new Error('two λ sessions should have produced a selector')
    select.value = SCRATCH
    select.dispatchEvent(new Event('change'))

    expect(slot.binding).toEqual({ session: SCRATCH, leg: 'lambda' })
    expect(term(el)).toBe('from scratch')
    expect(el.querySelector('h2')?.textContent).toContain('[detached]')
    expect(select.value).toBe(SCRATCH)

    select.value = SOURCE
    select.dispatchEvent(new Event('change'))
    expect(term(el)).toBe('from source')
    expect(el.querySelector('h2')?.textContent).toBe('lambda')
  })

  // The selector sits on the per-frame path (`draw()` repaints every pane on every recorded frame
  // during playback), so a repeat render must not rebuild the option nodes — rebuilding them would
  // also close the dropdown of a user in the middle of choosing. Asserted by identity, which is the
  // only thing that distinguishes "left alone" from "replaced with an equal one".
  it('does not rebuild its options when nothing changed', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'source', 'a', false))
    reg.add(lambdaSession(SCRATCH, 'λ scratchpad', 'b', true))

    const el = host()
    const slot = new PaneSlot('lambda', SOURCE)
    const pane = new LambdaPane(
      el,
      events(slot, () => undefined),
    )

    paint(reg, slot, pane)
    const first = selector(el)?.options[0]
    paint(reg, slot, pane)
    paint(reg, slot, pane)
    expect(selector(el)?.options.length).toBe(2)
    expect(selector(el)?.options[0]).toBe(first)
  })
})
