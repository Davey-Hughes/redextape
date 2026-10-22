import type { EditorView } from '@codemirror/view'
import { afterAll, describe, expect, it } from 'vitest'
import { RECORD_CHUNK } from '../../src/protocol'
import { bindingKey } from '../../src/view-header'
import { editorViewOf } from './editor-view-fixture'
import { editedToHaltImmediately, idle, SHELL, startStateGoesToHalt, tmPaneHost, until } from './harness'

/**
 * **THE FORK GESTURE FOR THE TM LEG, DRIVEN THROUGH THE APP**: the control a user clicks to reach the
 * machinery — the cap (`MAX_FORK_RULES`), the `tm-scratch` request/reply pair, the buffer collection's second
 * leg, the editor region on `TmPane` — and its wiring: `PaneEvents.detachMachine`, `TmPane.setForkAvailable`,
 * `transport.ts`'s handler, and `replies.ts`'s `tm-scratch-compiled` arm.
 *
 * **MODELLED ON `scratch-fork.test.ts`'s DOM `describe` AND `scratch-edit.test.ts`, NOT ON
 * `scratch-fork.test.ts`'s OTHER `describe`s.** Those drive `ScratchBuffers` directly over a hand-built
 * registry specifically because the claims under test there — pool size, a terminated worker's thread staying
 * silent — are not reachable from the DOM. Nothing here makes either claim; `fork`'s pool/registry mechanics
 * are leg-agnostic (`scratch.ts`'s own doc: "`#spawn` below reads `state.leg`... to pick both the request kind
 * it posts... and the one leg record it builds") and are already proven once, for λ, at that layer. What is
 * new and IS a DOM fact is the control existing, offering the right disabled reason, and an edit in the
 * mounted editor reaching a running machine — so this file drives the real app, the same `SHELL`
 * `scratch-app.test.ts` and `scratch-edit.test.ts` use.
 *
 * **ONE MOUNT FOR THE FILE: ES module imports are cached, so `main()` runs once per page and Vitest gives each
 * test FILE its own page.** `mountApp` below only imports `../../src/main` on its first call in this file;
 * every later call reuses the already-mounted app and simply loads a new program into it — a small per-test
 * entry point, because this file's five tests are independent claims (a control's presence, its disabled
 * reason, the source surviving a fork, the control withdrawing from its own fork, an edit reaching the tapes)
 * rather than stages of one sequence.
 *
 * **`mountApp` BRINGS THE TM PANE HOME BEFORE EVERY REUSE, WHICH IS WHAT KEEPS THE FIVE TESTS
 * INDEPENDENT DESPITE SHARING ONE PAGE.** The later tests fork the TM pane onto a scratch,
 * synchronously rebinding its slot; without bringing it home first, a later test's `button.detach` query
 * would find nothing (a scratch's own fork control is never offered — `CopyEditor.#refreshDetach` withdraws
 * it the instant this pane's own session is detached, driven every frame by `setDetached` regardless of
 * which session the pane is bound to, and `replies.ts`'s `tm-scratch-compiled` arm never calls
 * `setForkAvailable` at all, so nothing re-enables it either) and every assertion after it would fail for
 * a reason unrelated to what that test claims.
 */

/**
 * `map`/`fold` over three elements — `tests/browser/scratch-fork.test.ts`'s own `BIG`, duplicated
 * rather than imported. `BIG` is a plain string, so no shared-page argument forbids importing it; it
 * stays duplicated only because `scratch-fork.test.ts` does not export it. Needed here because its λ
 * leg is a fast 555 β-steps but its TM leg is enormous, and `session-worker.ts`'s `onRun` records λ to
 * completion before TM recording ever starts. So by the time this program's `compiled` reply lands —
 * enabling the fork control below — the source session is only just beginning several seconds of TM
 * recording, not finished with it.
 * **`'leaves the source session running'`'s own doc has the argument for why this file needs a
 * slow-to-finish source at all**.
 */
const BIG = `fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }
fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }
fn add(a, b) { a + b }
fn add1(x) { x + 1 }
fold([3, 1, 2].map(add1), 0, add)`

/**
 * How many `tm-frames` replies the source worker posts for `BIG`: its TM leg records 78,459 frames before its history
 * fills at step 78,458, `RECORD_CHUNK` to a reply. 307.
 */
const BIG_TM_REPLIES = Math.ceil(78_459 / RECORD_CHUNK)

/**
 * **THE SOURCE WORKER'S `tm-frames` REPLIES SINCE ITS LAST `compiled`, COUNTED**, by wrapping `Worker`'s own
 * `addEventListener` and `postMessage` before the app mounts, as `share-positions.test.ts` and
 * `readout-history-held.test.ts` do. Once the TM pane is forked away no view shows the source's TM leg, and its replies
 * are what still counts its recording. Only the source session's worker posts `compiled`, which is what names it here;
 * a reply is counted after the app's listener has taken it in.
 *
 * **`null` FROM A `run` POSTED UNTIL ITS `compiled` IS HEARD**, so in the flow of the one case that reads it, which
 * reads it after this compile's fork control has come available, a count that is not `null` is this compile's. **TWO
 * GAPS IT DOES NOT CLOSE**, neither reached by that case: between a dispatch and its `run`, which is posted after the
 * debounce, the count is still the compile before's; and a superseded run's `compiled`, heard after the newer `run`
 * was posted, would be counted as the newer's.
 */
let sourceWorker: Worker | null = null
let sourceTmReplies: number | null = null
const post = Worker.prototype.postMessage
Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]): void {
  if ((message as { kind?: unknown } | null)?.kind === 'run') sourceTmReplies = null
  ;(post as (...args: unknown[]) => void).apply(this, [message, ...rest])
}
const listen = Worker.prototype.addEventListener
Worker.prototype.addEventListener = function (
  this: Worker,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  const counted =
    type === 'message' && typeof listener === 'function'
      ? (e: Event) => {
          listener.call(this, e)
          const kind = ((e as MessageEvent).data as { kind?: unknown } | undefined)?.kind
          if (kind === 'compiled') {
            sourceWorker = this
            sourceTmReplies = 0
          } else if (kind === 'tm-frames' && this === sourceWorker && sourceTmReplies !== null) {
            sourceTmReplies += 1
          }
        }
      : listener
  listen.call(this, type, counted, options)
}
afterAll(() => {
  Worker.prototype.addEventListener = listen
  Worker.prototype.postMessage = post
})

/**
 * Whether the fork's own editor is mounted in `pane` — the fact the three fork gestures below wait on.
 *
 * **A QUIESCENCE POLL CANNOT SEE THIS ARRIVE, AND THAT IS NOT A TUNING PROBLEM.** The click's own handler
 * repaints the heading to `copy · not linked` SYNCHRONOUSLY (`tm-buffer-restore.test.ts`'s
 * `detachedWithNoEditorYet` doc), so that change is already in the DOM before a poll takes its first
 * sample — and from that sample until the `tm-scratch-compiled` reply mounts this editor, the text does
 * not change again AT ALL. A poll that declares the pane settled after a window of unchanged text then has
 * nothing to reset the window and races the round-trip directly: a slower or busier runner crosses the
 * window and the poll returns "settled" having observed nothing whatever, leaving the assertions to read a
 * DOM that has not been repainted.
 *
 * Polling for the fact is immune by construction, which is `startStateGoesToHalt`'s own argument applied
 * to the gesture that precedes the edit rather than to the edit itself: this can only become true once
 * the reply has actually landed and mounted the editor, so there is no window to expire and no interval
 * to tune.
 */
const forkEditorMounted = (pane: HTMLElement): boolean => pane.querySelector('.cm-editor') !== null

/**
 * Rebind the TM view back to the source session through its own title menu, if it is currently showing
 * anything else. A no-op when it already shows the program.
 */
const bringTmPaneHome = (): void => {
  const title = tmPaneHost().querySelector<HTMLButtonElement>('button.view-title')
  if (title === null || title.dataset.binding === bindingKey('tm', 'source')) return
  title.click()
  document
    .getElementById(title.getAttribute('aria-controls') ?? '')
    ?.querySelector<HTMLButtonElement>(`button[data-binding="${bindingKey('tm', 'source')}"]`)
    ?.click()
}

type App = {
  compiled(): Promise<void>
  tmPane(): HTMLElement
  editorText(pane: HTMLElement): string
  typeInto(pane: HTMLElement, text: string): void
}

let view: EditorView
let mounted = false
/** About half of the 60-element list's TM recording, which stops with its history full at step 107,166. */
const TM_HALF = 53_000

/**
 * Load `src` into the app's one source editor, mounting the app itself on the first call in this file
 * (`main()` runs once per page, per this file's own doc) and bringing the TM pane home on every later
 * one. Returns a handle over the parts of the running app this file's tests need — `compiled` waits for
 * THIS dispatch's own compile to finish (`schedule` flips `#results` off `'idle'` synchronously, at
 * dispatch, before the debounce — `compile.ts`'s own doc — so this cannot resolve against a stale idle
 * flag from a previous test).
 *
 * **`compiled` IS THREE WAITS: THE TM LEG STARTING TO RECORD, ITS RECORDING HALF WAY, THEN THE RUN'S END.** On the
 * 60-element list's machine, as one wait it took 9,211 ms of `until`'s 10 s at `CPUQuota=25%`. The TM leg records
 * last, after λ and asm, and its step line reads `…` from its first frames until it stops, and counts them: the
 * list's history fills at step 107,166, and `TM_HALF` is about half of that. For a run with fewer TM frames, each
 * wait ends at the result. The dispatch claims the compile and drops the line's `…` (`compile.ts`'s `schedule`,
 * `controls.ts`), which the assertions after it hold, and the assertion before the second wait holds that the line it
 * counts is this run's.
 */
async function mountApp(src: string): Promise<App> {
  if (!mounted) {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    mounted = true
  } else {
    bringTmPaneHome()
  }
  const tmStep = () => tmPaneHost().querySelector('.step')?.textContent ?? ''
  const tmRecorded = () => Number(/of ([\d,]+)/.exec(tmStep())?.[1]?.replaceAll(',', '') ?? 0)
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  expect(document.querySelector<HTMLElement>('#results')?.dataset.state, 'precondition: the compile is claimed').toBe(
    'running',
  )
  expect(tmStep(), 'precondition: no TM recording under way before the compile').not.toContain('…')

  return {
    compiled: async () => {
      await until(() => tmStep().includes('…') || idle(), `the TM leg of \`${src}\` to start recording`)
      expect(tmStep(), 'precondition: the TM leg is past the recompile').not.toContain('— recompiling')
      await until(() => tmRecorded() >= TM_HALF || idle(), `the TM leg of \`${src}\` to be half way to a full history`)
      await until(idle, `the app to settle on \`${src}\``)
    },
    tmPane: tmPaneHost,
    editorText: (pane) => editorViewOf(pane).state.doc.toString(),
    typeInto: (pane, text) => {
      const v = editorViewOf(pane)
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
    },
  }
}

describe('forking a TM pane', () => {
  it('offers the fork control on a machine under the cap', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    expect(app.tmPane().querySelector<HTMLButtonElement>('button.detach')?.disabled).toBe(false)
  })

  /**
   * **THE REFUSAL NAMES THE COUNT, BECAUSE A CONTROL THAT DOES NOTHING FOR AN INVISIBLE REASON IS WORSE
   * THAN NO CONTROL.** `list60` is 94,182 rules against a cap of `MAX_FORK_RULES` (50,000) —
   * `protocol.ts`'s own doc has the corpus measurement this figure comes from, and keeps 94,182 (a RULE
   * count) apart from 127,881 (the δ-table's ROW count: states plus rules).
   */
  it('disables it with a count on a machine over the cap', { timeout: 120_000 }, async () => {
    const app = await mountApp(`[${Array.from({ length: 60 }, (_, i) => i + 1).join(', ')}]`)
    await app.compiled()
    const button = app.tmPane().querySelector<HTMLButtonElement>('button.detach')
    expect(button?.disabled).toBe(true)
    // THE REASON IS THE ITEM'S DESCRIPTION AND ITS SECOND LINE — `viewMenu` writes a `CopyState`'s reason to both.
    expect(button?.getAttribute('aria-description')).toMatch(/94,?182/)
    expect(button?.querySelector('.view-menu-hint')?.textContent).toMatch(/94,?182/)
  })

  /**
   * **THE SOURCE SESSION KEEPS RUNNING ACROSS A FORK**, which is the entire reason more than one
   * session exists.
   *
   * **IT FORKS WHILE THE SOURCE IS GENUINELY MID-RUN.** `app.compiled()` waits for `#results` to reach
   * `idle`, which it reaches only once the WHOLE run has finished, so a fork after it on
   * `'let x = 40; x + 2'` lands on a session with nowhere left to go. `BIG` (this file's own copy of
   * `scratch-fork.test.ts`'s fixture) is what makes the claim discriminating: its λ leg finishes in
   * 555 steps before TM recording even starts (`onRun` awaits `recordLambda`, `recordAsm` and
   * `recordTm` in turn, not interleaved), so by the time this pane's fork control is enabled the
   * source is only just beginning several seconds of TM recording — `#results` reads `'running'`,
   * checked directly below rather than assumed from the timing comment alone. The claim is the second
   * of the two `scratch-fork.test.ts`'s λ version makes: the source "RUNS TO ITS OWN ANSWER, not
   * merely one more frame."
   *
   * **THE STEP-COUNT AXIS ITSELF IS NOT REACHABLE FROM THIS FILE.** The λ leg is already done by the
   * time TM recording (the leg this gesture forks FROM) begins, so watching `lambda-0`'s own step
   * readout proves nothing once `BIG` is the source. The TM leg IS still running, but `tm-0` — the one
   * pane that shows it — is the pane this test forks away, and nothing else on this page displays the
   * source's TM leg. What SURVIVES the fork and is still checkable is whether the source reaches its
   * own answer at all: a regression that made `detachMachine` mutate or steal the source's own worker
   * instead of minting a second one would leave `#results` stuck on `'running'` forever, which this
   * fails on by timeout rather than by a value that already happened to be final.
   */
  it('leaves the source session running', { timeout: 120_000 }, async () => {
    const app = await mountApp(BIG)
    const detach = () => app.tmPane().querySelector<HTMLButtonElement>('button.detach')
    await until(() => detach()?.disabled === false, 'the fork control to become available')
    // STILL MID-RUN, NOT MERELY ASSUMED FROM `BIG`'S OWN TIMING COMMENT.
    expect(document.querySelector<HTMLElement>('#results')?.dataset.state).toBe('running')

    detach()?.click()
    // NO `expect(...querySelector('.cm-editor')).not.toBeNull()` AFTER THIS LINE: the wait guarantees
    // exactly what that assertion would check, so it could not fail. The wait carries the claim
    // instead, and names it in its own timeout message.
    await until(() => forkEditorMounted(app.tmPane()), "the fork's own editor to mount")
    expect(app.tmPane().textContent).toMatch(/copy · not linked/)

    // THE ASSERTION: the source's own run finishes despite the fork, rather than stalling forever —
    // see this test's own doc for why this axis and not a step comparison.
    //
    // **TWO WAITS, SPLIT ON THE SOURCE WORKER'S REPLIES.** No view shows the source's TM leg after the fork, so the
    // page has no state between the fork and the result; the worker's `tm-frames` replies still count its recording,
    // 307 for `BIG`. Split so that no one wait holds the whole recording. The first wait ends half way from the count
    // at the fork to the last reply, or at the result.
    const atFork = sourceTmReplies
    expect(atFork, 'precondition: the replies counted are this compile’s').not.toBeNull()
    const halfWay = Math.ceil(((atFork ?? 0) + BIG_TM_REPLIES) / 2)
    await until(
      () => (sourceTmReplies ?? 0) >= halfWay || idle(),
      "the source session's TM recording to be half way from the fork to its end",
    )
    await until(idle, "the source session's own run to finish despite the fork")
  })

  /**
   * **THE CONTROL MUST NOT SURVIVE ITS OWN FORK.** Were `button.detach` to stay present AND enabled on
   * the pane that just rebound onto its own new scratch, a second click would reach `transport.ts`'s
   * `detachMachine` with no machine text (a TM scratch's own `tmProgram.tmText` is always `null` —
   * `replies.ts`'s `tm-scratch-compiled` arm constructs it that way on purpose) and throw
   * `detachMachine reached with no machine text` rather than do nothing. A view already showing a copy
   * has nothing left to copy — `CopyEditor.#refreshDetach` states that rule and enforces it — so the
   * control must withdraw the instant this pane's OWN session becomes the scratch it just made — not only
   * when some later reply happens to tell it to.
   */
  it('withdraws its own fork control once it is showing the fork, so a second click cannot reach it', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    const detach = () => app.tmPane().querySelector<HTMLButtonElement>('button.detach')
    detach()?.click()
    // **ASSERTED BEFORE ANY WAIT, BECAUSE "THE INSTANT" IS THIS TEST'S WHOLE CLAIM.** This doc's own
    // sentence above — the control must withdraw when this pane's session becomes the scratch, "not
    // only when some later reply happens to tell it to" — is only tested if the assertion runs before
    // the reply can land. Waiting first and asserting after would pass just as happily on a regression
    // that withdrew the control on the reply, which is the defect the test exists to catch.
    expect(detach()).toBeNull()
    await until(() => forkEditorMounted(app.tmPane()), "the fork's own editor to mount")
    expect(app.tmPane().textContent).toMatch(/copy · not linked/)
  })

  /**
   * **THE HEADLINE CAPABILITY: EDIT A RULE, WATCH THE TAPES TAKE IT.** Everything above this test
   * is plumbing.
   */
  it('runs the edited machine', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    app.tmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => forkEditorMounted(app.tmPane()), "the fork's own editor to mount")

    const original = app.editorText(app.tmPane())
    expect(original).toContain('state ')
    // Change the machine so it halts immediately: replace the start state's whole rule list with a
    // single unconditional jump to `halt`.
    const { text: edited, start } = editedToHaltImmediately(original)
    app.typeInto(app.tmPane(), edited)

    // WAIT ON THE FACT ITSELF, NOT ON QUIESCENCE. See `startStateGoesToHalt`'s own doc for why a
    // content-quiescence poll can resolve before the debounced recompile ever reaches the worker, and
    // why polling for this fact instead is immune to that race.
    await until(() => startStateGoesToHalt(app.tmPane(), start), `the δ-table to show \`${start}\` going to halt`)
    expect(startStateGoesToHalt(app.tmPane(), start)).toBe(true)
  })
})
