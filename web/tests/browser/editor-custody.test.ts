import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it } from 'vitest'
import { createEditorCustody } from '../../src/editor-custody'
import { History } from '../../src/history'
import { LambdaPane } from '../../src/lambda-pane'
import type { LeafId } from '../../src/panes'
import { PaneCollection } from '../../src/panes'
import { ScratchEditor } from '../../src/scratch-editor'
import type { ClientPort, SessionId } from '../../src/session-client'
import { SessionClient } from '../../src/session-client'
import type { LegState, SessionEntry } from '../../src/sessions'
import { PaneSlot, SessionRegistry } from '../../src/sessions'
import type { LambdaState } from '../../src/types'

/**
 * **`reconcileEditors`' THREE UNCOVERED ARMS, DRIVEN AGAINST THE REAL CUSTODY OBJECT — the debt 5d-ii-c
 * ran up in three tasks and this file is where it is paid.**
 *
 * **THE DEBT IS OLDER THAN THE SLICE THAT RECORDED IT.** Decision 2 deleted both of the app's implicit
 * retires, and `!sessions.has(session)` — the guard on two of the three arms below — has no producer but
 * a retire, so those arms went unreachable and were measured uncovered. That much was recorded in four
 * doc comments. What was NOT recorded is that `createEditorCustody` appeared nowhere in `tests/` at all:
 * the one test that looked like it drove this function was handing `createReplies` a STUBBED
 * `reconcileEditors` and counting the calls, so it measured a call site and never a destroy. **Restoring
 * reachability was therefore not enough** — `main.ts`'s header-list retire makes the branches reachable
 * again, and this file is what executes them.
 *
 * **DRIVEN DIRECTLY RATHER THAN THROUGH `main()`, AND THE THIRD ARM IS WHY.** The app's retire hands
 * `ScratchBuffers.retire` every slot on the page, so every pane bound to the buffer is rebound home
 * before the sweep runs — which means the app can reach the claim drop and the custody destroy, and
 * cannot reach the sweep's own `held.destroy()` at all: that one needs a λ pane still BOUND to a session
 * whose claim resolves to no home. `tests/browser/scratch-buffers.test.ts` drives the app's two through
 * the app, where they are a user's gesture; this file states all three as the module's own contract,
 * which is what they are — `editor-custody.ts` takes a `PaneCollection` and a `SessionRegistry` and
 * makes no assumption about who removed a session or why.
 *
 * **THE FIRST TWO TESTS DIFFER IN EXACTLY ONE FACT, DELIBERATELY.** Same panes, same claim, same editor;
 * the session is registered in one and removed in the other, which is the guard's own condition. That is
 * what makes each of them a statement about the guard rather than about the fixture.
 */

const S: SessionId = 'scratch-1'
const OTHER: SessionId = 'scratch-2'
/** A leaf with no pane in the collection — what a claim points at after the pane that made it closed. */
const GHOST: LeafId = 'pane-gone'

/** A `ClientPort` with no thread behind it — `binding-selector.test.ts`'s helper, and its reason. */
function fakeClient(): SessionClient {
  const port: ClientPort = { postMessage: () => undefined, addEventListener: () => undefined }
  return new SessionClient(port, () => undefined)
}

/**
 * A λ-only session. Custody reads nothing but `sessions.has`, so the legs are the minimum a
 * `SessionEntry` will typecheck with rather than a fixture anything here reads.
 */
function lambdaSession(id: SessionId): SessionEntry {
  const leg: LegState<LambdaState> = {
    hist: new History<LambdaState>(1_000_000),
    status: { available: false, reason: '' },
    done: null,
    timer: null,
  }
  return { id, label: id, detached: true, client: fakeClient(), legs: { lambda: leg }, tmProgram: null }
}

let panes: PaneCollection
let sessions: SessionRegistry
let custody: ReturnType<typeof createEditorCustody>
/**
 * A STAND-IN FOR `ScratchBuffers`' OWN `collapsed` FIELD, keyed the same way `ScratchBuffers.setCollapsed`
 * would write it — this file reconstructs custody's inputs rather than driving a real `ScratchBuffers`
 * (`lambdaSession`'s own doc states the idiom), and this is that reconstruction for the one field
 * `receiveEditor` now reads. Absent from a session entirely reads `false`, matching
 * `ScratchBuffers.collapsedOf`'s own default for an id it has never seen.
 */
let collapsedFlags: Map<SessionId, boolean>

/**
 * A FRESH COLLECTION, REGISTRY AND CUSTODY PER TEST, and a body cleared with them. `createEditorCustody`
 * closes over two `Map`s that never leave the module, so a shared instance would carry one test's claims
 * into the next — which is the one thing a file about stale entries must not do by accident.
 */
beforeEach(() => {
  document.body.replaceChildren()
  panes = new PaneCollection()
  sessions = new SessionRegistry()
  collapsedFlags = new Map()
  custody = createEditorCustody({ panes, sessions, collapsedOf: (id) => collapsedFlags.get(id) ?? false })
})

/**
 * A real `LambdaPane` on a real host, registered in the collection under `leaf` and bound to `session`.
 *
 * `showEditor` IS OPTIONAL AND ITS ABSENCE IS LOAD-BEARING, not a default filled in for convenience:
 * `LambdaPane` builds the "bring the term editor to this pane" control only for a pane whose events
 * carry that handler (`#claim`'s own doc), so every test above this line gets a pane with no such button
 * in its DOM at all — which is what keeps them about custody. The item-11 tests below pass one, because
 * the button is the thing they are about.
 */
function addPane(
  leaf: LeafId,
  session: SessionId,
  showEditor?: () => void,
  editScratch?: (src: string) => void,
  collapse?: (collapsed: boolean) => void,
): { pane: LambdaPane; slot: PaneSlot<'lambda'>; host: HTMLElement } {
  const host = document.createElement('div')
  document.body.append(host)
  const slot = new PaneSlot('lambda', session)
  const pane = new LambdaPane(host, {
    back: () => undefined,
    forward: () => undefined,
    play: () => undefined,
    restart: () => undefined,
    extend: () => undefined,
    rebind: (binding) => slot.rebind(binding.session),
    detach: () => undefined,
    ...(showEditor === undefined ? {} : { showEditor }),
    // CAPTURED AT CONSTRUCTION, WHICH IS THE WHOLE POINT FOR THE `receiveEditor` TESTS BELOW.
    // `LambdaPane` reads `on.editScratch` once into `#onEdit` and every editor it MOUNTS closes over
    // that — so a handler set any later way would not reproduce the field the moved-editor defect is
    // about.
    ...(editScratch === undefined ? {} : { editScratch }),
    ...(collapse === undefined ? {} : { collapse }),
  })
  panes.add({ id: leaf, kind: 'lambda', slot, pane, host })
  return { pane, slot, host }
}

/** The claim control in `host`, by the label `claimEditorButton` gives it, or `null` when it is withdrawn. */
const claimControl = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('button[aria-label="bring the term editor to this pane"]')

/**
 * A real `ScratchEditor`, mounted in a host of its own.
 *
 * A REAL ONE RATHER THAN A `{ destroy() {} }` STUB, WHICH IS THE POINT OF THE FILE. What the three arms
 * below are protecting is a live `EditorView` with a pending debounce over a worker that is gone, and a
 * stub with a spy on it would assert that a method was called rather than that the view came down.
 * `dom.isConnected` is CodeMirror's own answer to the second question.
 *
 * `debounceMs` IS SHORT ON PURPOSE — one test waits out a real debounce rather than faking a clock, so
 * that "the pending recompile cannot fire" is asserted against the timer the app actually schedules.
 */
function makeEditor(initial: string, onEdit: (src: string) => void = () => undefined): ScratchEditor {
  const host = document.createElement('div')
  document.body.append(host)
  return new ScratchEditor({ host, initial, debounceMs: 20, onEdit })
}

/** A real keystroke — `scratch-editor.test.ts`'s `retype`, and its reason: `setText` is the seed path. */
function retype(editor: ScratchEditor, text: string): void {
  const view = EditorView.findFromDOM(editor.dom)
  if (view === null) throw new Error('no CodeMirror view under the editor dom')
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
}

describe('reconcileEditors: a claim whose session has been retired', () => {
  /**
   * **THE CLAIM IS DROPPED AND THE SWEEP SKIPS THE SESSION, WHICH IS WHAT KEEPS A RETIRE FROM
   * DESTROYING AN EDITOR IT DOES NOT OWN.** Without the guard, a claim naming a session the registry no
   * longer holds resolves to NO home, and the loop below it then takes the editor off every λ pane bound
   * to that session and destroys it.
   *
   * THE OBSERVABLE HALF IS THE SKIP, AND THE `delete` BESIDE IT IS NOT OBSERVABLE AT ALL — stated rather
   * than asserted around. A session id is minted once and never reissued (`ScratchBuffers`' `#minted`
   * only counts up), so nothing can ever ask about the dropped key again; what the deletion buys is that
   * the claim map does not grow one entry per retire for the life of the page.
   */
  it('leaves an editor mounted on a pane still bound to the retired session', () => {
    sessions.add(lambdaSession(S))
    const { pane } = addPane('pane-1', S)
    const editor = makeEditor('\\x. x')
    pane.receiveEditor(editor)
    // THE CLAIM NAMES A LEAF WITH NO PANE, which is what a close leaves behind and what makes
    // `editorHomeFor` answer `undefined` — the state the destroy below would otherwise fire in.
    custody.claim(S, GHOST)

    sessions.remove(S)
    custody.reconcile()

    expect(editor.dom.isConnected).toBe(true)
    expect(pane.takeEditor()).toBe(editor)
  })
})

describe('reconcileEditors: a claim with no home while its session lives', () => {
  /**
   * **THE SWEEP'S OWN DESTROY — the same fixture as the test above with ONE fact changed, and the fact
   * is the guard's condition.** The session is still registered here, so the claim is not dropped: the
   * loop reaches a pane bound to S, takes the editor it is holding, finds no home to hand it to, and
   * destroys it. That is the case `editor-custody.ts` describes as "a pane that IS on the session while
   * the session holds no home for it, which is what a claim pointing at a closed leaf leaves behind".
   *
   * `dom.isConnected` IS THE DISCRIMINATOR, NOT `takeEditor() === null`. `takeEditor` runs on both sides
   * of the branch — it is how the sweep gets the editor in the first place — so a `destroy()` deleted
   * from the `else` would leave this pane empty and the view still mounted in the DOM with nothing able
   * to reach it, which is precisely the orphan the line exists to prevent.
   */
  it('destroys the editor it takes off a pane when the session has nowhere to put it', () => {
    sessions.add(lambdaSession(S))
    const { pane } = addPane('pane-1', S)
    const editor = makeEditor('\\x. x')
    pane.receiveEditor(editor)
    custody.claim(S, GHOST)

    custody.reconcile()

    expect(editor.dom.isConnected).toBe(false)
    expect(pane.takeEditor()).toBeNull()
  })

  /**
   * AND IT DOES NOT REACH A PANE BOUND TO A DIFFERENT BUFFER, which is the binding predicate on the same
   * loop and the reason the destroy above is narrow rather than a sweep. Two panes, two buffers, one
   * homeless claim: the second pane's editor is untouched. Without that predicate this loop asked EVERY
   * λ pane for its editor and handed whatever came back to one session's home — a live defect the day
   * buffers went plural.
   */
  it('leaves another buffer’s editor alone while destroying the homeless one', () => {
    sessions.add(lambdaSession(S))
    sessions.add(lambdaSession(OTHER))
    const mine = addPane('pane-1', S)
    const theirs = addPane('pane-2', OTHER)
    const doomed = makeEditor('\\x. x')
    const spared = makeEditor('\\y. y')
    mine.pane.receiveEditor(doomed)
    theirs.pane.receiveEditor(spared)
    custody.claim(S, GHOST)

    custody.reconcile()

    expect(doomed.dom.isConnected).toBe(false)
    expect(spared.dom.isConnected).toBe(true)
    expect(theirs.pane.takeEditor()).toBe(spared)
  })
})

describe('reconcileEditors: an editor in custody whose session has been retired', () => {
  /**
   * **THE LEAK THE CUSTODY PASS EXISTS TO CLOSE.** An editor waiting in custody is held by nothing else
   * in the app — the pane that had it is gone, and `replies.ts`'s `editorHome(session)?.setEditor(null)`
   * resolves to `undefined` for a session with no pane, so it is a no-op. Without this branch a retire
   * during custody leaves one live `EditorView`, with its own pending debounce, over a terminated worker.
   *
   * **THE PENDING RECOMPILE IS ASSERTED, NOT ONLY THE UNMOUNT.** A debounce is scheduled and then the
   * retire is reconciled inside its window; the test then waits out a real multiple of that window. A
   * `destroy()` removed from this branch fires `onEdit` for a session the pool has already unbound —
   * which is exactly what `ScratchEditor.destroy`'s own doc says the cancel is for, asserted here against
   * the timer the app schedules rather than a faked clock.
   */
  it('destroys the held editor and cancels the recompile it had pending', async () => {
    sessions.add(lambdaSession(S))
    const fired: string[] = []
    const editor = makeEditor('\\x. x', (src) => fired.push(src))
    custody.hold(S, editor)
    retype(editor, '\\a. a')

    sessions.remove(S)
    custody.reconcile()

    expect(editor.dom.isConnected).toBe(false)
    await new Promise((r) => setTimeout(r, 100))
    expect(fired).toEqual([])
  })

  /**
   * **AND THE ENTRY IS DROPPED, WHICH IS THE OTHER HALF OF THE BRANCH AND HAS ITS OWN FAILURE.** The
   * session id is re-registered here and given a pane and a claim — the singleton's exact shape, where
   * `lambda-scratch` was a constant the next fork re-registered — so a custody entry that survived its
   * session's death would be mounted onto a live pane by the very next reconcile. That is the state
   * `two-lambda-panes.test.ts` reached in six clicks: `receiveEditor` handed a view over a terminated
   * worker, or threw on top of a live one.
   *
   * A DESTROYED EDITOR ARRIVING IS ASSERTED AS "THE PANE HOLDS NOTHING", because a mount would be
   * visible either way — `receiveEditor` sets the pane's `#editor` whether the view behind it is alive
   * or not, so "no editor here" is the only reading that separates the two.
   */
  it('forgets the entry, so a session registered again later inherits nothing', () => {
    sessions.add(lambdaSession(S))
    const editor = makeEditor('\\x. x')
    custody.hold(S, editor)

    sessions.remove(S)
    custody.reconcile()
    expect(editor.dom.isConnected).toBe(false)

    sessions.add(lambdaSession(S))
    const { pane } = addPane('pane-1', S)
    custody.claim(S, 'pane-1')
    custody.reconcile()

    expect(custody.homeFor(S)).toBe(pane)
    expect(pane.takeEditor()).toBeNull()
  })
})

/**
 * **DEFERRED-A11Y ITEM 11: "bring the term editor to this pane" OFFERED WHERE IT PROVABLY CANNOT WORK.**
 *
 * `LambdaPane.#refreshClaim` gated the control on `#detached && #editor === null` and read that pair as
 * "this session has an editor, mounted elsewhere". It was only ever an approximation, and it held
 * because the one way to reach a detached pane whose session had NO editor anywhere — a fork whose build
 * failed — used to end the buffer inside the same reply, putting `#detached` back to `false`. 5d-ii-c
 * decision 2 deleted that retire: nothing ends a buffer implicitly, so the pane stays stranded, both
 * conjuncts stay true forever, and the click records a claim `reconcileEditors` can find no editor for.
 *
 * **THE FIX IS A THIRD INPUT, AND THE TESTS HERE ARE SPLIT ALONG THE SEAM IT CROSSES.** `hasEditor` is
 * the fact (this file's subject: the two custody maps); `setEditorAvailable` is the gate (`lambda-pane.ts`'s).
 * The last test drives both together in the shape the defect actually has, because each half is
 * defensible on its own and it was the JOIN between them that was missing.
 *
 * **THE PHANTOM FORK IS RECONSTRUCTED FROM ITS PARTS RATHER THAN DRIVEN THROUGH A WORKER**, which is
 * this file's existing idiom (`lambdaSession`'s doc: custody reads nothing but `sessions.has`). What
 * makes that faithful rather than convenient is the CLAIM: `pane-host.ts`'s wrapped `detach` records one
 * the instant the binding moves, which is before the worker has answered and therefore also on the fork
 * that never builds. Leaving it out would delete the whole difficulty — `homeFor` would answer
 * `undefined` and any implementation would pass. `tests/browser/scratch-fork.test.ts` drives the real
 * failed build over a real thread and pins what it leaves behind; this pins what the CHROME does about it.
 */
describe('hasEditor: the third input to the claim control', () => {
  /**
   * **THE DEFECT ITSELF, AT THE LAYER THAT ANSWERS IT.** Every condition `editorHomeFor` checks is
   * satisfied here — a claim, a pane under that leaf, a matching binding — so an implementation written
   * as `homeFor(session) !== undefined` returns `true` and leaves item 11 exactly where it was. The only
   * thing missing is the editor, and `holdsEditor` is the only thing that reports it.
   */
  it('is false for a buffer that has a claim and a pane but never built an editor', () => {
    sessions.add(lambdaSession(S))
    const { pane } = addPane('pane-1', S)
    custody.claim(S, 'pane-1')

    expect(custody.homeFor(S)).toBe(pane)
    expect(custody.hasEditor(S)).toBe(false)
  })

  /** The ordinary case, so the test above is a discriminator rather than a function that returns false. */
  it('is true once that buffer builds and its editor is mounted', () => {
    sessions.add(lambdaSession(S))
    const { pane } = addPane('pane-1', S)
    custody.claim(S, 'pane-1')
    pane.receiveEditor(makeEditor('\\x. x'))

    expect(custody.hasEditor(S)).toBe(true)
  })

  /**
   * **AND IT STAYS TRUE WITH NO PANE HOLDING IT, WHICH IS THE CASE THE CONTROL EXISTS FOR.** An editor
   * whose holder closed waits in custody under a claim naming a leaf `panes` no longer has, so `homeFor`
   * answers `undefined` — and a `hasEditor` that consulted only the home would withdraw the control in
   * precisely the state where clicking it is how the user gets the editor back. That state is
   * `heldEditors`' own reason for existing.
   */
  it('is true for an editor waiting in custody with no pane to resolve', () => {
    sessions.add(lambdaSession(S))
    custody.hold(S, makeEditor('\\x. x'))
    custody.claim(S, GHOST)

    expect(custody.homeFor(S)).toBeUndefined()
    expect(custody.hasEditor(S)).toBe(true)
  })

  /**
   * **THE TWO HALVES JOINED, IN THE SHAPE `draw()` JOINS THEM** — `pane.setEditorAvailable(custody.hasEditor(…))`
   * is the whole of the per-frame line this fix adds, written out here against the phantom-fork fixture.
   *
   * **THE SECOND PANE IS HERE TO MAKE THE POSITIVE ASSERTION MEAN SOMETHING, NOT BECAUSE THE DEFECT
   * NEEDED ONE — this paragraph claimed the opposite and was wrong (Minor finding, review of this
   * fix).** It said "the defect was always visible from a pane that was NOT the holder, which is one
   * split away". For the filed defect — a phantom fork — the affected pane is the FORKING pane itself,
   * on a page with no split at all: the build never reached `scratch-compiled`, so `#editor` is `null`
   * on it and `#detached` is `true`, which is roadmap item 11's own wording ("permanently true on a
   * phantom-forked or worker-errored pane"). What `second` buys is that the control is asserted PRESENT
   * before it is asserted absent, over a pane that is not the one holding the view.
   *
   * Then the buffer is stranded — `takeEditor` off the holder, nothing handed to custody — and the
   * control must go. **`takeEditor` IS A STAND-IN FOR THE FAILED BUILD AND A FAITHFUL ONE**, because the
   * state it produces is the state `hasEditor` reads: a claim, a live pane, a matching binding, and no
   * view. It is this file's stated idiom (`lambdaSession`'s doc) to reconstruct rather than drive a
   * worker. The real thing is driven in `tests/browser/scratch-fork.test.ts`, over a real thread whose
   * build really fails, and that test now asserts `hasEditor` directly.
   *
   * ASSERTED ON THE BUTTON IN THE DOM, not on `hasEditor`'s return: the return is already covered three
   * tests up, and what item 11 is a defect ABOUT is a control the user can see and click.
   */
  it('withdraws the control on a pane whose buffer has no editor, and offers it when one exists', () => {
    sessions.add(lambdaSession(S))
    const { pane: first } = addPane('pane-1', S, () => undefined)
    const { pane: second, host: secondHost } = addPane('pane-2', S, () => undefined)
    custody.claim(S, 'pane-1')
    first.receiveEditor(makeEditor('\\x. x'))
    // BOTH PANES ARE ON THE BUFFER AND DETACHED, which is what two λ panes split onto one scratch are.
    // `PaneSlot.render` drives this per frame in the app; here it is the one fact of its own the pane
    // needs before the gate can be about the third input.
    for (const p of [first, second]) p.setDetached(true)

    second.setEditorAvailable(custody.hasEditor(S))
    expect(claimControl(secondHost)).not.toBeNull()

    // THE STRANDING. `takeEditor` unmounts without destroying and hands the view to this test rather than
    // to custody, which is the state a session is in when no editor for it exists anywhere: the same
    // place a failed build leaves one, reached without a worker.
    const orphan = first.takeEditor()
    expect(orphan).not.toBeNull()
    expect(custody.hasEditor(S)).toBe(false)

    second.setEditorAvailable(custody.hasEditor(S))
    expect(claimControl(secondHost)).toBeNull()

    orphan?.destroy()
  })
})

/**
 * **AN EDITOR THAT MOVES MUST TAKE ITS EDIT HANDLER WITH IT — Important finding, found by driving the
 * app in a browser after the suite was green, and the second defect that walkthrough turned up.**
 *
 * A `ScratchEditor` is constructed by the pane that FORKS (`LambdaPane.setEditor`'s mount branch),
 * closing over THAT pane's `editScratch`. `receiveEditor` relocates `editor.dom` — which is all the
 * editor-moves rule ever moved — and left the callback pointing at the pane that built it. That is
 * invisible while both panes are on the same buffer, which is the only state the suite ever reached,
 * and becomes a corruption the moment the ORIGINATING pane is rebound: `transport.ts`'s `editScratch`
 * resolves `slot.binding.session` at EDIT time, so keystrokes in the moved editor recompile whatever
 * the first pane is showing now.
 *
 * **MEASURED IN CHROMIUM BEFORE THE FIX, five gestures from a fresh page:** fork on `lambda-0` (which
 * builds `scratch 1`'s editor), split, claim the editor onto the new pane, rebind `lambda-0` to source
 * and fork again (`scratch 2`). Typing `ZZZ` into the pane showing `scratch 1` put the parse error on
 * `lambda-0`'s editor, over `scratch 2` — the user typed in one pane and the error appeared in another.
 *
 * DRIVEN HERE AT THE PANE PAIR RATHER THAN THROUGH `main()`, because what is under test is one
 * assignment in `receiveEditor` and the seam it crosses is `LambdaPane` -> `ScratchEditor`. The app-level
 * sequence above needs two real worker forks to reach a state this file constructs in four lines, and
 * `two-lambda-panes.test.ts` already drives the claim gesture end to end.
 */
describe('receiveEditor: where a moved editor sends its edits', () => {
  /**
   * THE HANDLERS ARE DISTINGUISHED BY WHICH PANE THEY BELONG TO, not by a spy on one of them: each pane
   * is built with an `editScratch` that records its own name, so the assertion reads "the pane holding
   * the editor is the one that heard the keystroke" rather than "something fired".
   *
   * A REAL DEBOUNCE, WAITED OUT, for the reason `makeEditor` states — `#schedule` reads `#onEdit` when
   * the TIMER expires, not when the keystroke lands, so a test that faked the clock would not exercise
   * the field this fix reassigns.
   */
  it('routes a claimed editor’s keystrokes to the pane holding it, not to the pane that built it', async () => {
    sessions.add(lambdaSession(S))
    const heard: string[] = []
    // EACH PANE'S HANDLER RECORDS ITS OWN NAME, so the assertion reads "the pane holding the editor is
    // the one that heard the keystroke" rather than "something fired".
    const builder = addPane(
      'pane-1',
      S,
      () => undefined,
      (src) => heard.push(`builder:${src}`),
    )
    const claimer = addPane(
      'pane-2',
      S,
      () => undefined,
      (src) => heard.push(`claimer:${src}`),
    )

    // THE BUILD, THEN THE MOVE — `setEditor` mounts a view carrying `builder`'s handler, `takeEditor`
    // hands it over, `receiveEditor` mounts it on `claimer`. Exactly `reconcileEditors`' own two calls.
    builder.pane.setEditor('\\x. x')
    const moved = builder.pane.takeEditor()
    if (moved === null) throw new Error('the builder pane mounted no editor')
    claimer.pane.receiveEditor(moved)

    retype(moved, '\\y. y')
    // PAST `EDITOR_DEBOUNCE_MS` (300), NOT PAST `makeEditor`'s 20. The editor under test is the one
    // `LambdaPane.setEditor` builds, which uses the app's own constant — this wait was 120 ms first and
    // the test failed with `[]` on both sides of the fix, which is a test that measures its own timer
    // rather than the code.
    await new Promise((r) => setTimeout(r, 600))

    // WITHOUT THE REASSIGNMENT THIS READS `['builder:\\y. y']` — the pane that no longer shows the
    // editor, and in the app the pane whose binding has since moved somewhere else entirely.
    expect(heard).toEqual(['claimer:\\y. y'])
  })
})

/**
 * **THE COLLAPSE FLAG MUST FOLLOW THE EDITOR ACROSS A CUSTODY MOVE — Important finding, review of
 * 5d-ii-d T9.** `pane-chrome.ts`'s `collapseButton` doc states the design outright: the flag "rides with
 * the buffer and follows it as custody moves the editor between panes". Only `LambdaPane.setEditor`'s
 * mount was ever seeded with it (`replies.ts`'s `scratch-compiled` arm passes `scratchpad.collapsedOf(session)`);
 * the custody-move path — `receiveEditor`, called from `reconcileEditors`' own sweep — mounted expanded
 * unconditionally.
 *
 * **THE REACHABLE SEQUENCE, DRIVEN AT THE SEAM `reconcileEditors` OWNS RATHER THAN THROUGH `main()`:**
 * collapse the editor on one pane (the user's own click on `.collapse`, which is what
 * `transport.ts`'s `collapse` handler reports to `ScratchBuffers.setCollapsed` in the app — `collapsedFlags`
 * stands in for that record, per its own doc above), then claim it onto a second pane bound to the same
 * buffer (`custody.claim` + `custody.reconcile()`, exactly `pane-host.ts`'s `showEditor` wrapper followed
 * by its own `applyLayout`'s `custody.reconcile()`). Closing the holding pane and re-claiming out of
 * `heldEditors` is the other route through the same missing seed; both call sites take the same
 * `collapsedOf` reader (`createEditorCustody`'s deps), so one test on the sweep path stands for both.
 */
describe('reconcileEditors: the collapse flag follows a custody move', () => {
  it('a pane claiming another pane’s collapsed editor receives it collapsed', () => {
    sessions.add(lambdaSession(S))
    const holder = addPane('pane-1', S, undefined, undefined, (c) => collapsedFlags.set(S, c))
    const claimer = addPane('pane-2', S, () => undefined)

    holder.pane.setEditor('\\x. x')
    // THE USER'S OWN GESTURE — clicking `.collapse` on the holder toggles the host's class locally AND
    // reports the buffer-level flag through `on.collapse`, exactly as `LambdaPane`'s constructor wires it
    // (`collapseButton`'s callback in `lambda-pane.ts`).
    const holderCollapse = holder.host.querySelector<HTMLButtonElement>('button.collapse')
    holderCollapse?.click()
    expect(collapsedFlags.get(S)).toBe(true)
    expect(holder.host.querySelector('.term-editor')?.classList.contains('is-collapsed')).toBe(true)

    // THE CLAIM — `pane-host.ts`'s `showEditor` wrapper records the claim; `applyLayout`'s own
    // `custody.reconcile()` is what actually performs the move via the sweep in `reconcileEditors`.
    custody.claim(S, 'pane-2')
    custody.reconcile()

    const mounted = claimer.host.querySelector('.term-editor')
    expect(mounted).not.toBeNull()
    // THE FIX: without it, this reads `false` — the class `receiveEditor` used to write unconditionally.
    expect(mounted?.classList.contains('is-collapsed')).toBe(true)
    // CHECK BOTH DIRECTIONS — `collapseButton`'s own doc names the exact fault a mismatch here would be:
    // the label naming a state the host contradicts. `update`'s `initial` argument is what keeps the
    // button's closure flag and the host's class agreeing.
    const claimerCollapse = claimer.host.querySelector<HTMLButtonElement>('button.collapse')
    expect(claimerCollapse?.getAttribute('aria-label')).toBe('show the term editor')
  })
})
