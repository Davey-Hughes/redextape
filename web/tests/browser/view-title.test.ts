import { beforeEach, describe, expect, it } from 'vitest'
import { History } from '../../src/history'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { Leg } from '../../src/protocol'
import type { ClientPort, SessionId } from '../../src/session-client'
import { SessionClient } from '../../src/session-client'
import type { Binding, LegState, SessionEntry } from '../../src/sessions'
import { PaneSlot, SessionRegistry } from '../../src/sessions'
import type { LambdaState, TmState } from '../../src/types'
import { bindingKey } from '../../src/view-header'

/**
 * TWO PANES BOUND TO TWO DIFFERENT λ SESSIONS, RENDERING TWO DIFFERENT TERMS AT THE SAME TIME — plan
 * T7's test, in a real DOM against the real `LambdaPane`.
 *
 * WHY THIS IS NOT DRIVEN THROUGH `main()`, unlike most of this directory, and it is the same reason
 * `view-status.test.ts` gives one task earlier: the app cannot reach the state under test. `main.ts`
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
 * `copy · not linked` status all live inside `PaneSlot.render`, so nothing about what a binding MEANS is
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
  const leg: LegState<LambdaState> = { hist, status: { available: true, reason: '' }, done: null, playing: false }
  return { id, label, detached, client: fakeClient(), legs: { lambda: leg }, tmProgram: null, tmScratch: null }
}

/**
 * A session with BOTH legs — the source session's shape, and the one the λ-only helper above cannot
 * make. It exists for the grouped-pairs test alone: a registry in which every session is λ-only can
 * never produce a TM `<optgroup>`, so the omission it asserts would hold vacuously.
 */
function bothLegs(id: SessionId, label: string, text: string): SessionEntry {
  const lambdaHist = new History<LambdaState>(1_000_000)
  lambdaHist.push({ text, spans: [], cut: null, step: 0, redex_span: null, owner: 'None' }, 1)
  const tmHist = new History<TmState>(1_000_000)
  tmHist.push({ state: 0, step: 0, heads: [0], window_start: [0], window: [['_']], source_node: null, rule: null }, 1)
  const ok = { available: true, reason: '' }
  return {
    id,
    label,
    detached: false,
    client: fakeClient(),
    legs: {
      lambda: { hist: lambdaHist, status: ok, done: null, playing: false },
      tm: { hist: tmHist, status: ok, done: null, playing: false },
    },
    // A TM LEG WITH NO MACHINE BEHIND IT, WHICH IS A STATE THE APP HAS TOO — between registering the
    // source session and its first `compiled` reply. The panes here are built directly rather than by
    // `pane-host.ts`, so nothing in this file reads it.
    tmProgram: null,
    tmScratch: null,
  }
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

/** The title-selector of the view in `pane` — the pair in force is its `data-binding`. */
const titleOf = (pane: HTMLElement) => pane.querySelector<HTMLButtonElement>('button.view-title')

/** The title's menu. */
const menuOf = (pane: HTMLElement) => document.getElementById(titleOf(pane)?.getAttribute('aria-controls') ?? '')

/** Pick `key` (`bindingKey(leg, session)`) through the view's title menu, as a user does. */
function pickBinding(pane: HTMLElement, key: string): void {
  const title = titleOf(pane)
  if (title === null) throw new Error('no title-selector on this view')
  title.click()
  const item = menuOf(pane)?.querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
  if (item == null) {
    const offered = [...(menuOf(pane)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map(
      (b) => b.dataset.binding,
    )
    throw new Error(`the view offers no ${JSON.stringify(key)} — offered: ${JSON.stringify(offered)}`)
  }
  item.click()
}

/** Every pair the view's title menu offers, as `[key, text]` — opens and closes the menu to read it. */
function offered(pane: HTMLElement): [string, string][] {
  const title = titleOf(pane)
  if (title === null) return []
  title.click()
  const items = [...(menuOf(pane)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b): [string, string] => [
    b.dataset.binding ?? '',
    b.textContent ?? '',
  ])
  menuOf(pane)?.hidePopover()
  return items
}

/** `PaneEvents`'s six required members. `rebind` is the only one any test here fires. */
const events = (slot: PaneSlot<'lambda'>, after: () => void): PaneEvents => ({
  back: () => undefined,
  forward: () => undefined,
  play: () => undefined,
  restart: () => undefined,
  extend: () => undefined,
  speed: () => 8,
  setSpeed: () => undefined,
  // THE SESSION ONLY, THOUGH THE PICK NOW CARRIES A LEG — `PaneSlot<K>`'s leg is fixed at
  // construction and has no writer, so this is the whole of what a same-leg pick can do. It is also
  // exactly what `transport.ts`'s production handler does. **THE PANE MULTIPLEXER THAT ACTS ON A
  // DIFFERENT LEG EXISTS NOW, AND THIS COMMENT USED TO CALL IT "a later slice"** — it lives in
  // `pane-host.ts`, which answers a cross-leg pick by changing the LEAF's kind and rebuilding the
  // entry. That needs a layout tree and these hand-built panes have none, which is why this harness
  // still answers only the axis it can reach; `tests/browser/pane-kind-switch.test.ts` drives the
  // other one through the mounted app.
  rebind: (binding: Binding<Leg>) => {
    slot.rebind(binding.session)
    after()
  },
})

beforeEach(() => {
  document.body.replaceChildren()
})

describe('the title-selector', () => {
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
    reg.add(lambdaSession(SOURCE, 'program', '(λx. x) 1', false))
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
  it('says copy · not linked on the view bound to a scratch, and drops it on rebind', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'program', 'a', false))
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
    expect(detachedHost.querySelector('h2')?.textContent).toContain('copy · not linked')
    expect(attachedHost.querySelector('h2')?.textContent).toBe('λ · program')
    expect(attachedHost.querySelector('h2')?.textContent).not.toContain('not linked')

    detached.rebind(SOURCE)
    paint(reg, detached, detachedPane)
    expect(detachedHost.querySelector('h2')?.textContent).toBe('λ · program')
  })

  /**
   * THE CONTROL IS ABSENT WHILE IT COULD DO NOTHING, which is `pane-chrome.ts`'s stated idiom (added
   * and removed, never disabled) and §4.5's standard (a thing that provably cannot work should not be
   * presented as though it might).
   *
   * **IT IS NOT TODAY'S APP, AND THIS PARAGRAPH SAID IT WAS — whole-branch review, M1.** It read "It is
   * also today's app exactly: one session, so no selector". The selector lists `(leg, session)` PAIRS,
   * and `main.ts` registers the program session with BOTH legs, so `pairs()` contributes two on its own
   * and the plain-text branch is unreachable in the running app (`main.ts`'s own comment on the
   * registration says so). What reaches it here is this file's λ-ONLY source session, a shape the app
   * never builds — the same kind of fixture the file's header comment already flags for the two-pane
   * case. The branch is still worth holding, because `viewHeader` offers it and a later leg arrangement
   * could reach it; what is not worth claiming is that a user can get there today.
   *
   * ASSERTED IN BOTH DIRECTIONS AND BACK. A control that appears and never leaves passes the middle
   * assertion; the third is what catches it, and it is reachable IN THIS FIXTURE — retiring a buffer
   * takes this λ-only registry's options back down to one. (That named `§4.3's recompile-from-source` as the gesture that does it,
   * which 5d-ii-c decision 2 removed; what makes the third direction reachable is the retire itself,
   * whichever surface triggers one.)
   */
  it('is a menu only once a second session offers this leg, and plain text again when one is retired', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'program', 'a', false))

    const el = host()
    const slot = new PaneSlot('lambda', SOURCE)
    const pane = new LambdaPane(
      el,
      events(slot, () => paint(reg, slot, pane)),
    )

    paint(reg, slot, pane)
    expect(titleOf(el)).toBeNull()
    expect(el.querySelector('h2 span.view-title')?.textContent).toBe('λ · program')

    reg.add(lambdaSession(SCRATCH, 'λ scratchpad', 'b', true))
    paint(reg, slot, pane)
    expect(titleOf(el)).not.toBeNull()
    // NAMED BY TEXT, NOT BY COLOUR OR POSITION. §6 forbids this slice adding a colour-carried state,
    // and the sessions are told apart by their labels — which is also what a screen reader gets. An
    // implementation that distinguished them any other way would leave these strings unset.
    expect(offered(el).map(([, text]) => text)).toEqual(['λ · program', 'λ · λ scratchpad'])
    expect(titleOf(el)?.dataset.binding).toBe(bindingKey('lambda', SOURCE))
    // THE TITLE SAYS IT OPENS A MENU — the `shows` caption it replaced was a `<label>` naming a
    // `<select>`; a button that opens something states it with `aria-haspopup`.
    expect(titleOf(el)?.getAttribute('aria-haspopup')).toBe('menu')

    reg.remove(SCRATCH)
    paint(reg, slot, pane)
    expect(titleOf(el)).toBeNull()
  })

  /**
   * THE CONTROL ACTUALLY MOVES THE BINDING, driven through the DOM rather than by calling `rebind`.
   * Everything above this asserts what a binding does once it has moved; this is the one that says a
   * user can move it — and it is the path `main.ts` wires (`events(...).rebind` calls `slot.rebind`
   * then `draw()`), reproduced here by the `after` callback repainting.
   */
  it('rebinds the pane when a session is picked, and follows it back', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'program', 'from source', false))
    reg.add(lambdaSession(SCRATCH, 'λ scratchpad', 'from scratch', true))

    const el = host()
    const slot = new PaneSlot('lambda', SOURCE)
    const pane = new LambdaPane(
      el,
      events(slot, () => paint(reg, slot, pane)),
    )
    paint(reg, slot, pane)
    expect(term(el)).toBe('from source')

    pickBinding(el, bindingKey('lambda', SCRATCH))

    expect(slot.binding).toEqual({ session: SCRATCH, leg: 'lambda' })
    expect(term(el)).toBe('from scratch')
    expect(el.querySelector('h2')?.textContent).toContain('copy · not linked')
    expect(titleOf(el)?.dataset.binding).toBe(bindingKey('lambda', SCRATCH))

    pickBinding(el, bindingKey('lambda', SOURCE))
    expect(term(el)).toBe('from source')
    expect(el.querySelector('h2')?.textContent).toBe('λ · program')
  })

  /**
   * **THE TITLE KEEPS THE FOCUS ACROSS THE PICK IT PERFORMED** — spec §11, "focus never falls to
   * `<body>`", and umbrella §4 rule 5.
   *
   * **THIS IS THE ONE GESTURE WITH NO `focusPane` BEHIND IT**, deliberately: `pane-host.ts`'s same-leg
   * `rebind` arm leaves focus alone because the view is still there and only its contents changed. That
   * makes the header's own repaint the whole of the guarantee — and a repaint that takes the title out of
   * the document and puts it back does not keep it, however identical the element is afterwards. So this
   * asserts the FOCUS, not the identity: the element is the same either way.
   */
  it('keeps the focus on the title it was picked from', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'program', 'from source', false))
    reg.add(lambdaSession(SCRATCH, 'copy 1', 'from scratch', true))

    const el = host()
    const slot = new PaneSlot('lambda', SOURCE)
    const pane = new LambdaPane(
      el,
      events(slot, () => paint(reg, slot, pane)),
    )
    paint(reg, slot, pane)

    const title = el.querySelector<HTMLButtonElement>('button.view-title')
    title?.focus()
    expect(document.activeElement).toBe(title)

    pickBinding(el, bindingKey('lambda', SCRATCH))

    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(el.querySelector('button.view-title'))
  })

  // The title sits on the per-frame path (`draw()` repaints every view on every recorded frame
  // during playback), so a repeat render must not rebuild the heading — rebuilding it takes the menu
  // out of the DOM, which closes it under a user in the middle of choosing. Asserted on the open menu
  // and by identity, which is the only thing that distinguishes "left alone" from "replaced with an
  // equal one".
  it('does not rebuild when nothing changed, so an open menu survives a frame', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'program', 'a', false))
    reg.add(lambdaSession(SCRATCH, 'λ scratchpad', 'b', true))

    const el = host()
    const slot = new PaneSlot('lambda', SOURCE)
    const pane = new LambdaPane(
      el,
      events(slot, () => undefined),
    )

    paint(reg, slot, pane)
    titleOf(el)?.click()
    const first = menuOf(el)?.querySelector('button')
    paint(reg, slot, pane)
    paint(reg, slot, pane)
    expect(menuOf(el)?.matches(':popover-open')).toBe(true)
    expect(menuOf(el)?.querySelectorAll('button').length).toBe(2)
    expect(menuOf(el)?.querySelector('button')).toBe(first)
    menuOf(el)?.hidePopover()
  })

  /**
   * THE CONTROL OFFERS `(leg, session)` PAIRS, NOT SESSIONS — the widening this task is, asserted on
   * the two things that distinguish a pair list from a session list: the legs are GROUPED, and a pair
   * naming a leg its session does not have is ABSENT rather than present-and-broken.
   *
   * THE SCRATCH IS λ-ONLY AND THE SOURCE HAS BOTH, which is why the omission is observable at all.
   * `SessionRegistry.legOf` THROWS on a binding naming a leg the session lacks, so an option for
   * `(tm, λ scratchpad)` would be an option that crashes the next render — the reason design §3.2's
   * axes are not independent and the reason this is one control rather than two.
   *
   * READ AS THE MENU'S ITEMS IN ORDER — the grouping is the order now, the `<optgroup>`s having gone with
   * the `<select>`. The λ pairs come first because `SessionRegistry.pairs()` walks `LEGS` in that order,
   * which is a value rather than a key walk for exactly this reason.
   */
  it('lists both legs, grouped, and omits a pair the session has no leg for', () => {
    const reg = new SessionRegistry()
    reg.add(bothLegs(SOURCE, 'program', 'a'))
    reg.add(lambdaSession(SCRATCH, 'λ scratchpad', 'b', true))

    const el = host()
    const slot = new PaneSlot('lambda', SOURCE)
    const pane = new LambdaPane(
      el,
      events(slot, () => undefined),
    )
    paint(reg, slot, pane)

    const keys = offered(el).map(([key]) => key)
    expect(keys).toEqual([bindingKey('lambda', SOURCE), bindingKey('lambda', SCRATCH), bindingKey('tm', SOURCE)])
    // The scratch has no TM leg, so the pair is not in the list at all.
    expect(keys.filter((k) => k.startsWith('tm:'))).toEqual([bindingKey('tm', SOURCE)])
  })
})
