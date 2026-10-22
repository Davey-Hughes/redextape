import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it } from 'vitest'
import { createEditorCustody } from '../../src/editor-custody'
import { History } from '../../src/history'
import { LambdaPane } from '../../src/lambda-pane'
import type { LeafId } from '../../src/panes'
import { PaneCollection } from '../../src/panes'
import type { ScratchEditorConfig } from '../../src/scratch-editor'
import { ScratchEditor } from '../../src/scratch-editor'
import type { SessionId } from '../../src/session-client'
import type { LegState, SessionEntry } from '../../src/sessions'
import { PaneSlot, SessionRegistry } from '../../src/sessions'
import type { LambdaState } from '../../src/types'
import { fakeClient } from '../node/session-fixtures'
import { typeIn } from './editor-view-fixture'

/**
 * **`reconcileEditors`' THREE ARMS, DRIVEN AGAINST THE REAL CUSTODY OBJECT.**
 *
 * **DRIVEN DIRECTLY RATHER THAN THROUGH `main()`, AND THE THIRD ARM IS WHY.** The app's retire hands
 * `ScratchBuffers.retire` every pane's slot, on the page or off it, so every pane bound to the buffer is
 * rebound home before the sweep runs — which means the app can reach the claim drop and the custody
 * destroy, and cannot reach the sweep's own `held.destroy()` at all: that one needs a λ pane still BOUND
 * to a session whose claim resolves to no home. `tests/browser/scratch-buffers.test.ts` drives the app's
 * two through the app, where they are a user's gesture, and does not assert the destroy (its closing note
 * says why); this file states all three as the module's own contract, which is what they are —
 * `editor-custody.ts` takes a `PaneCollection` and a `SessionRegistry` and makes no assumption about who
 * removed a session or why.
 *
 * **THE FIRST TWO TESTS DIFFER IN EXACTLY ONE FACT, DELIBERATELY.** Same panes, same claim, same editor;
 * the session is registered in one and removed in the other, which is the condition of
 * `!sessions.has(session)`, the guard on two of the three arms below. That is what makes each of them a
 * statement about the guard rather than about the fixture.
 */

const S: SessionId = 'scratch-1'
const OTHER: SessionId = 'scratch-2'
/** A leaf with no pane in the collection — what a claim points at after the pane that made it closed. */
const GHOST: LeafId = 'pane-gone'

/**
 * A λ-only session. Custody reads nothing but `sessions.has`, so the legs are the minimum a
 * `SessionEntry` will typecheck with rather than a fixture anything here reads.
 */
function lambdaSession(id: SessionId): SessionEntry {
  const leg: LegState<LambdaState> = {
    hist: new History<LambdaState>(1_000_000),
    status: { available: false, reason: '' },
    done: null,
    playing: false,
  }
  return {
    id,
    label: id,
    detached: true,
    client: fakeClient(),
    legs: { lambda: leg },
    tmProgram: null,
    tmScratch: null,
    asmProgram: null,
    asmScratch: null,
  }
}

let panes: PaneCollection
let sessions: SessionRegistry
let custody: ReturnType<typeof createEditorCustody>
/**
 * A STAND-IN FOR `ScratchBuffers`' OWN `collapsed` FIELD, keyed the same way `ScratchBuffers.setCollapsed`
 * would write it — custody takes `collapsedOf` as a plain function, not a `ScratchBuffers`, so this file
 * reconstructs that input rather than driving a real `ScratchBuffers`, and this is that reconstruction for
 * the one field `receiveEditor` reads. Absent from a session entirely reads `false`, matching
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
 * `LambdaPane` builds the "move the editor here" control only for a pane whose events carry that
 * handler, so every test that omits it gets a pane with no such button in its DOM at all — which is
 * what keeps them about custody. The one test below that reads the claim control off the page, 'withdraws
 * the control on a pane whose buffer has no editor, and offers it when one exists', passes one, because
 * the button is what it asserts on.
 */
function addPane(
  leaf: LeafId,
  session: SessionId,
  showEditor?: () => void,
  edits?: (session: SessionId, src: string) => void,
  collapse?: (collapsed: boolean) => void,
): { pane: LambdaPane; slot: PaneSlot<'lambda'>; host: HTMLElement } {
  const host = document.createElement('div')
  document.body.append(host)
  const slot = new PaneSlot('lambda', session)
  const pane = new LambdaPane(host, {
    back: () => undefined,
    forward: () => undefined,
    toNewest: () => undefined,
    play: () => undefined,
    restart: () => undefined,
    extend: () => undefined,
    speed: () => 8,
    setSpeed: () => undefined,
    rebind: (binding) => slot.rebind(binding.session),
    detach: () => undefined,
    ...(showEditor === undefined ? {} : { showEditor }),
    // THE APP'S OWN SHAPE (`transport.ts`'s `editSink`): the slot's session is read when the pane builds an
    // editor, and every edit that editor sends names it — which is what the `receiveEditor` tests below are about.
    ...(edits === undefined
      ? {}
      : {
          editSink: () => {
            const session = slot.binding.session
            return (src: string) => edits(session, src)
          },
        }),
    ...(collapse === undefined ? {} : { collapse }),
  })
  panes.add({ id: leaf, kind: 'lambda', slot, pane, host })
  return { pane, slot, host }
}

/** *move the editor here* in `host`, by the class `view-header.ts`'s `viewMenu` gives it, or `null` when it is withdrawn. */
const claimControl = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button.claim-editor')

/**
 * A real `ScratchEditor`, mounted in a host of its own.
 *
 * A REAL ONE RATHER THAN A `{ destroy() {} }` STUB, WHICH IS THE POINT OF THE FILE. What the three arms
 * below are protecting is a live `EditorView` with a pending debounce over a worker that is gone, and a
 * stub with a spy on it would assert that a method was called rather than that the view came down.
 * `dom.isConnected` is CodeMirror's own answer to the second question.
 *
 * A REAL DEBOUNCE RATHER THAN A FAKED CLOCK: tests below leave an edit pending in it and assert what
 * sends it, and the one that waits a debounce out waits on the timer the app schedules.
 */
function makeEditor(initial: string, onEdit: (src: string) => void = () => undefined): ScratchEditor {
  const host = document.createElement('div')
  document.body.append(host)
  return new ScratchEditor({ host, initial, debounceMs: 20, onEdit })
}

/** A real keystroke — `editor-view-fixture.ts`'s `typeIn`, and its reason: `setText` is the seed path. */
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
   * homeless claim: the second pane's editor is untouched. Without that predicate this loop would ask
   * EVERY λ pane for its editor and hand whatever came back to one session's home.
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
   * **THE PENDING EDIT IS ASSERTED, NOT ONLY THE UNMOUNT, AND IT IS SENT AT THE RECONCILE.** A debounce is
   * scheduled and the retire is reconciled inside its window. `ScratchEditor.destroy` sends a pending edit
   * rather than dropping it, so the edit is heard the moment the editor comes down — before any timer could
   * fire it, which is what separates a destroy from a `destroy()` removed from this branch (the edit would then
   * arrive a debounce later, from an editor still alive). What the app does with an edit for a deleted copy is
   * `ScratchBuffers.recompile`'s answer: nothing.
   */
  it('destroys the held editor, sending the edit it had pending as it comes down', () => {
    sessions.add(lambdaSession(S))
    const fired: string[] = []
    const editor = makeEditor('\\x. x', (src) => fired.push(src))
    custody.hold(S, editor)
    retype(editor, '\\a. a')

    sessions.remove(S)
    custody.reconcile()

    expect(editor.dom.isConnected).toBe(false)
    expect(fired).toEqual(['\\a. a'])
  })

  /**
   * **AND THE ENTRY IS DROPPED, WHICH IS THE OTHER HALF OF THE BRANCH AND HAS ITS OWN FAILURE.** The
   * session id is re-registered here and given a pane and a claim, so a custody entry that survived its
   * session's death would be mounted onto a live pane by the very next reconcile, and `receiveEditor`
   * would be handed a view over a terminated worker, or throw on top of a live one.
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
 * **"move the editor here" IS NOT OFFERED WHERE IT PROVABLY CANNOT WORK** (deferred-a11y item 11).
 *
 * `LambdaPane`'s `#detached && #editor === null` alone does not mean "this session has an editor, mounted
 * elsewhere": nothing ends a buffer implicitly, so a detached pane whose session has NO editor anywhere — a
 * fork whose build failed — stays stranded, both conjuncts stay true forever, and a click would record a
 * claim `reconcileEditors` can find no editor for.
 *
 * **THE GATE TAKES A THIRD INPUT, AND THE TESTS HERE ARE SPLIT ALONG THE SEAM IT CROSSES.** `hasEditor` is
 * the fact (this file's subject: the two custody maps); `setEditorAvailable` is the gate (`lambda-pane.ts`'s).
 * The last test drives both together in the shape the defect actually has, because each half is
 * defensible on its own and the defect is in the JOIN between them.
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
   * as `homeFor(session) !== undefined` returns `true` and offers the control anyway. The only thing
   * missing is the editor, and `holdsEditor` is the only thing that reports it without taking the editor.
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
   * is the per-frame line, written out here against the phantom-fork fixture.
   *
   * **THE SECOND PANE IS HERE TO MAKE THE POSITIVE ASSERTION MEAN SOMETHING, NOT BECAUSE THE DEFECT
   * NEEDS ONE.** For the filed defect — a phantom fork — the affected pane is the FORKING pane itself, on
   * a page with no split at all: the build never reached `scratch-compiled`, so `#editor` is `null` on it
   * and `#detached` is `true`, which is roadmap item 11's own wording ("permanently true on a
   * phantom-forked or worker-errored pane"). What `second` buys is that the control is asserted PRESENT
   * before it is asserted absent, over a pane that is not the one holding the view.
   *
   * Then the buffer is stranded — `takeEditor` off the holder, nothing handed to custody — and the
   * control must go. **`takeEditor` IS A STAND-IN FOR THE FAILED BUILD AND A FAITHFUL ONE**, because the
   * state it produces is the state `hasEditor` reads: a claim, a live pane, a matching binding, and no
   * view. This file reconstructs custody's inputs rather than driving a worker, since custody reads
   * nothing of the registry but `sessions.has` (`lambdaSession`'s doc). The real thing is driven in
   * `tests/browser/scratch-fork.test.ts`, over a real thread whose build really fails, and that test
   * asserts `hasEditor` directly.
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
 * **AN EDITOR THAT MOVES MUST TAKE ITS EDIT HANDLER WITH IT.**
 *
 * A `ScratchEditor` is constructed by the pane that FORKS (`LambdaPane.setEditor`'s mount branch), and
 * `receiveEditor` relocates only `editor.dom`. An editor's edits are bound to its copy when it is built
 * (`transport.ts`'s `editSink`), and the test below holds that: a handler that resolved
 * `slot.binding.session` at EDIT time would send keystrokes in the moved editor to whatever that pane was
 * showing by then.
 *
 * DRIVEN HERE AT THE PANE PAIR RATHER THAN THROUGH `main()`, because the seam the edit handler crosses is
 * `LambdaPane` -> `ScratchEditor`. Through `main()`, this state needs two real worker forks; this file
 * constructs it in four lines, and `two-lambda-panes.test.ts` already drives the claim gesture end to end.
 */
describe('receiveEditor: where a moved editor sends its edits', () => {
  /**
   * EACH EDIT IS RECORDED WITH THE SESSION ITS SINK NAMES, so the assertion reads "the copy the editor was built
   * for heard the keystroke" rather than "something fired".
   *
   * **THE VIEW HOLDING THE EDITOR MOVES ON BEFORE THE DEBOUNCE FIRES**, which is the case an editor re-pointed at
   * the view holding it, reading that view's binding when an edit fired, would get wrong: the keystroke would go to
   * whatever that view showed by then. A REAL DEBOUNCE, WAITED OUT, for the reason `makeEditor` states.
   */
  it('sends a moved editor’s pending keystroke to its own copy after the view holding it moves on', async () => {
    sessions.add(lambdaSession(S))
    const heard: string[] = []
    const record = (session: SessionId, src: string) => heard.push(`${session}:${src}`)
    const builder = addPane('pane-1', S, () => undefined, record)
    const claimer = addPane('pane-2', S, () => undefined, record)

    // THE BUILD, THEN THE MOVE — `setEditor` mounts a view built for `S`, `takeEditor` hands it over,
    // `receiveEditor` mounts it on `claimer`. Exactly `reconcileEditors`' own two calls.
    builder.pane.setEditor('\\x. x')
    const moved = builder.pane.takeEditor()
    if (moved === null) throw new Error('the builder pane mounted no editor')
    claimer.pane.receiveEditor(moved)

    retype(moved, '\\y. y')
    // BOTH VIEWS MOVE ON INSIDE THE DEBOUNCE — the one holding the editor and the one that built it.
    claimer.slot.rebind(OTHER)
    builder.slot.rebind(OTHER)
    // PAST `EDITOR_DEBOUNCE_MS` (300), NOT PAST `makeEditor`'s 20: the editor is the one `LambdaPane.setEditor`
    // builds, which uses the app's own constant.
    await new Promise((r) => setTimeout(r, 600))

    expect(heard).toEqual([`${S}:\\y. y`])
  })
})

/**
 * **`flush` SENDS A COPY'S PENDING EDIT WHEREVER ITS EDITOR IS** — held here, or mounted on a view of the copy — and
 * touches no other copy's. `main.ts`'s delete and pause handlers call it before reading or storing the copy, so typing
 * in the editor's debounce is in what they read. Asserted synchronously after the call: a flush that missed an
 * editor would leave its edit to a timer this test never waits for.
 */
describe('flush: a copy’s pending edit, sent wherever its editor is', () => {
  it('sends the pending edit of an editor waiting in custody', () => {
    sessions.add(lambdaSession(S))
    const heard: string[] = []
    const editor = makeEditor('\\x. x', (src) => heard.push(src))
    custody.hold(S, editor)
    retype(editor, '\\a. a')

    custody.flush(S)

    expect(heard).toEqual(['\\a. a'])
  })

  it('sends the pending edit of the editor on a view of the copy, and leaves another copy’s alone', () => {
    sessions.add(lambdaSession(S))
    sessions.add(lambdaSession(OTHER))
    const heard: string[] = []
    const record = (session: SessionId, src: string) => heard.push(`${session}:${src}`)
    const mine = addPane('pane-1', S, undefined, record)
    const theirs = addPane('pane-2', OTHER, undefined, record)
    mine.pane.setEditor('\\x. x')
    theirs.pane.setEditor('\\y. y')
    typeIn(mine.host, '\\a. a', 'no CodeMirror view in the pane')
    typeIn(theirs.host, '\\b. b', 'no CodeMirror view in the pane')

    custody.flush(S)

    expect(heard).toEqual([`${S}:\\a. a`])
  })

  /**
   * A `ScratchEditor` whose document's `format()` stays open until the returned `answer` is called — this
   * describe block's own version of `scratch-editor.test.ts`'s `makeFormattable`, kept local since no other test
   * here needs a document at all.
   */
  function makeFormattableEditor(onEdit: (src: string) => void): { ed: ScratchEditor; answer: (edits: []) => void } {
    let resolve: (edits: []) => void = () => undefined
    const client = {
      openDocument: () => undefined,
      changeDocument: () => undefined,
      closeDocument: () => undefined,
      format: () =>
        new Promise<[]>((r) => {
          resolve = r
        }),
      documentSymbols: () => undefined,
      definition: () => undefined,
      references: () => undefined,
      hover: () => undefined,
    } as unknown as NonNullable<ScratchEditorConfig['document']>['client']
    const host = document.createElement('div')
    document.body.append(host)
    const ed = new ScratchEditor({
      host,
      initial: '\\x. x',
      debounceMs: 20,
      onEdit,
      document: {
        uri: 'redextape://copy/test',
        languageId: 'redextape_lambda',
        client,
        formatOnBlur: () => false,
        notify: () => undefined,
        label: 'λ · copy 1',
      },
    })
    return { ed, answer: (edits: []) => resolve(edits) }
  }

  /**
   * **THE EXACT CALL A DELETE MAKES, RACING AN IN-FLIGHT FORMAT.** `main.ts`'s delete handler calls
   * `custody.flush(id)` before it reads the copy's record for undo, with no `destroy()` in between — the pause
   * handler calls it the same way before storing the copy. A flush that missed the edit a format in flight is
   * carrying would leave the record this call is meant to update stale, and undo would restore text missing the
   * keystrokes typed before *format*, silently.
   */
  it('sends the pre-format text a format in flight is carrying, before the format answers', async () => {
    sessions.add(lambdaSession(S))
    const heard: string[] = []
    const { ed, answer } = makeFormattableEditor((src) => heard.push(src))
    custody.hold(S, ed)
    retype(ed, '\\a. a')
    const formatting = ed.format()

    custody.flush(S)

    expect(heard).toEqual(['\\a. a'])
    answer([])
    await formatting
    expect(heard, 'format’s own continuation must not resend what flush already sent').toEqual(['\\a. a'])
  })
})

/**
 * **THE COLLAPSE FLAG MUST FOLLOW THE EDITOR ACROSS A CUSTODY MOVE.** The custody-move path —
 * `receiveEditor`, called from `reconcileEditors`' own sweep — mounts expanded unless it is handed the
 * buffer's flag.
 *
 * **THE REACHABLE SEQUENCE, DRIVEN AT THE SEAM `reconcileEditors` OWNS RATHER THAN THROUGH `main()`:**
 * collapse the editor on one pane (the user's own click on the text panel's toggle, which is what
 * `transport.ts`'s `collapse` handler reports to `ScratchBuffers.setCollapsed` in the app — `collapsedFlags`
 * stands in for that record, per its own doc above), then claim it onto a second pane bound to the same
 * buffer (`custody.claim` + `custody.reconcile()`, exactly `pane-host.ts`'s `showEditor` wrapper followed
 * by its own `applyLayout`'s `custody.reconcile()`). Closing the holding pane and re-claiming out of
 * `heldEditors` is the other route that takes the same seed; both call sites take the same
 * `collapsedOf` reader (`createEditorCustody`'s deps), so one test on the sweep path stands for both.
 */
describe('reconcileEditors: the collapse flag follows a custody move', () => {
  it('a pane claiming another pane’s collapsed editor receives it collapsed', () => {
    sessions.add(lambdaSession(S))
    const holder = addPane('pane-1', S, undefined, undefined, (c) => collapsedFlags.set(S, c))
    const claimer = addPane('pane-2', S, () => undefined)

    holder.pane.setEditor('\\x. x')
    // THE USER'S OWN GESTURE — clicking the text panel's toggle on the holder hides the host locally AND
    // reports the buffer-level flag through `on.collapse`, exactly as `LambdaPane`'s constructor wires it
    // (`textPanel`'s callback in `lambda-pane.ts`).
    const holderToggle = holder.host.querySelector<HTMLButtonElement>('[data-panel="text"] .panel-toggle')
    holderToggle?.click()
    expect(collapsedFlags.get(S)).toBe(true)
    expect(holder.host.querySelector<HTMLElement>('.term-editor')?.hidden).toBe(true)

    // THE CLAIM — `pane-host.ts`'s `showEditor` wrapper records the claim; `applyLayout`'s own
    // `custody.reconcile()` is what actually performs the move via the sweep in `reconcileEditors`.
    custody.claim(S, 'pane-2')
    custody.reconcile()

    const mounted = claimer.host.querySelector('.term-editor')
    expect(mounted).not.toBeNull()
    // THE SEED: without it, this reads `false` — a `receiveEditor` that called `#collapse.update(true)` with
    // no seed would mount a claimed editor expanded regardless of the buffer's own record.
    expect((mounted as HTMLElement | null)?.hidden).toBe(true)
    // CHECK BOTH DIRECTIONS — the toggle's `aria-expanded` as well as the host's `hidden`. `panel.ts`'s
    // `apply()` writes both from the same `open` flag, and `update`'s `initial` argument is what starts
    // that flag at the buffer's own recorded state.
    const claimerToggle = claimer.host.querySelector<HTMLButtonElement>('[data-panel="text"] .panel-toggle')
    expect(claimerToggle?.getAttribute('aria-expanded')).toBe('false')
  })
})
