import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

/**
 * **THE FORK GESTURE FOR THE TM LEG, DRIVEN THROUGH THE APP — 5d-iv Task 9, the headline task.**
 * Everything from Task 3 through Task 8 built the machinery — the cap (`MAX_FORK_RULES`), the
 * `tm-scratch` request/reply pair, the buffer collection's second leg, the editor region on `TmPane` —
 * with no control anywhere that could reach any of it. This file is the wiring that finally lets a user
 * click something: `PaneEvents.detachMachine`, `TmPane.setForkAvailable`, `transport.ts`'s handler, and
 * `replies.ts`'s `tm-scratch-compiled` arm.
 *
 * **MODELLED ON `scratch-fork.test.ts`'s DOM `describe` AND `scratch-edit.test.ts`, NOT ON EITHER
 * FILE'S NODE-LEVEL `describe`s.** Those drive `ScratchBuffers` directly over a hand-built registry
 * specifically because the claims under test there — pool size, a terminated worker's thread staying
 * silent — are not reachable from the DOM. Nothing here makes either claim; `fork`'s pool/registry
 * mechanics are leg-agnostic (`scratch.ts`'s own doc: "`#spawn` reads `state.leg`... to pick both the
 * request kind it posts and the one leg record it builds") and are already proven once, for λ, at that
 * layer. What is new and IS a DOM fact is the control existing, offering the right disabled reason, and
 * an edit in the mounted editor reaching a running machine — so this file drives the real app, the same
 * `SHELL` `scratch-app.test.ts` and `scratch-edit.test.ts` use.
 *
 * **ONE MOUNT FOR THE FILE, FOR THOSE FILES' OWN REASON: ES module imports are cached, so `main()` runs
 * once per page and Vitest gives each test FILE its own page.** `mountApp` below only imports `../../src/main`
 * on its first call in this file; every later call reuses the already-mounted app and simply loads a new
 * program into it — the same "dispatch into the live editor" idiom `settled(src)` uses in those two
 * files, generalised into a small per-test entry point because this file's four tests are independent
 * claims (a control's presence, its disabled reason, the source surviving a fork, an edit reaching the
 * tapes) rather than stages of one sequence.
 *
 * **`mountApp` BRINGS THE TM PANE HOME BEFORE EVERY REUSE, WHICH IS WHAT KEEPS THE FIVE TESTS
 * INDEPENDENT DESPITE SHARING ONE PAGE.** The later tests fork the TM pane onto a scratch,
 * synchronously rebinding its slot; without bringing it home first, a later test's `button.detach` query
 * would find nothing (a scratch's own fork control is never offered — `TmPane.#refreshDetach` withdraws
 * it the instant this pane's own session is detached, driven every frame by `setDetached` regardless of
 * which session the pane is bound to, and `replies.ts`'s `tm-scratch-compiled` arm never calls
 * `setForkAvailable` at all, so nothing re-enables it either) and every assertion after it would fail for
 * a reason unrelated to what that test claims.
 */

/**
 * `map`/`fold` over three elements — `tests/browser/scratch-fork.test.ts`'s own `BIG`, duplicated
 * rather than imported (this file's own doc states the standing idiom), and needed here for the
 * identical reason that file states: its λ leg is a fast 555 β-steps but its TM leg is enormous
 * (design §3.1: 25,852 states, 266,863 δ-steps), and `session-worker.ts`'s `onRun` records λ to
 * completion before TM recording ever starts. So by the time this program's `compiled` reply lands —
 * enabling the fork control below — the source session is only just beginning several seconds of TM
 * recording, not finished with it. **`'leaves the source session running'`'s own doc has the argument
 * for why this file needs a slow-to-finish source at all**, where the other four tests are content
 * with the near-instant `'let x = 40; x + 2'`.
 */
const BIG = `fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }
fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }
fn add(a, b) { a + b }
fn add1(x) { x + 1 }
fold([3, 1, 2].map(add1), 0, add)`

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

async function until(predicate: () => boolean, what: string, timeoutMs = 60_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const resultsText = () => document.querySelector('#results')?.textContent ?? ''
/** `scratch-app.test.ts`'s own `idle` — the source compile's own "finished" flag. */
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== ''

const tmPaneHost = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-leaf="tm-0"]')
  if (el === null) throw new Error('no TM pane mounted at [data-leaf="tm-0"]')
  return el
}

const editorHostOf = (pane: HTMLElement): HTMLElement => {
  const host = pane.querySelector<HTMLElement>('.term-editor')
  if (host === null) throw new Error('no editor mounted in this pane')
  return host
}

const editorViewOf = (pane: HTMLElement): EditorView => {
  const view = EditorView.findFromDOM(editorHostOf(pane))
  if (view === null) throw new Error('no CodeMirror view mounted under the editor host')
  return view
}

/**
 * Whether the fork's own editor is mounted in `pane` — the fact the three fork gestures below wait on,
 * in place of the content quiescence they used to wait on.
 *
 * **A QUIESCENCE POLL CANNOT SEE THIS ARRIVE, AND THAT IS NOT A TUNING PROBLEM.** `settleOn` (deleted
 * with this comment's arrival) declared the pane settled after 500 ms of unchanged text. The click's
 * own handler repaints the heading to `[detached]` SYNCHRONOUSLY (`tm-buffer-restore.test.ts`'s
 * `detachedWithNoEditorYet` doc measured that), so that change is already in the DOM before the poll
 * takes its first sample — and from that sample until the `tm-scratch-compiled` reply mounts this
 * editor, the text then does not change again AT ALL. Measured, not assumed: over five runs the first
 * post-click change and the editor's own mount were the same event, at 169/199/211/217/243 ms. So the
 * window had nothing left to reset it and was racing the round-trip directly, at a margin of about 2x
 * on this machine. A slower or busier runner crosses 500 ms and the poll returns "settled" having observed
 * nothing whatever, leaving the assertions to read a DOM that has not been repainted.
 *
 * That is not hypothetical: it is what reddened CI run 229, as `expected null not to be null` on the
 * `.cm-editor` query in `'leaves the source session running'`. Shrinking ONLY the window from 500 ms
 * to 100 ms reproduces that exact failure locally and deterministically.
 *
 * A DOCUMENT-WIDE quiescence check was never the escape either, and the reason is worth keeping from
 * the comment deleted alongside `settleOn`: the source session keeps recording its own λ leg
 * throughout this file's tests (design §4.3's entire point), repainting the λ pane continuously, so a
 * page-wide check could be starved of ever settling at all. Scoping it to this pane is what made it
 * terminate — and is also what left it with nothing to watch.
 *
 * Polling for the fact is immune by construction, which is `startStateGoesToHalt`'s own argument
 * (Important 4) applied to the gesture that precedes the edit rather than to the edit itself: this can
 * only become true once the reply has actually landed and mounted the editor, so there is no window to
 * expire and no interval to tune.
 */
const forkEditorMounted = (pane: HTMLElement): boolean => pane.querySelector('.cm-editor') !== null

/**
 * The `<option>` value `paneSelect` encodes a `(leg, session)` pair as — `scratch-app.test.ts`'s own
 * `optionValue`, spelled out here for the same reason that file's doc gives: this pins the DOM contract
 * rather than agreeing with whatever the control currently does.
 */
const optionValue = (leg: string, id: string) => `${leg}\x00${id}`

/**
 * Rebind the TM pane back to the source session through its own selector, if it is currently showing
 * anything else. A no-op the first time this file mounts (nothing has forked yet, so the selector is
 * not even on screen below two options — `paneSelect`'s own idiom).
 */
const bringTmPaneHome = (): void => {
  const select = tmPaneHost().querySelector<HTMLSelectElement>('.pane-binding select')
  if (select === null) return
  select.value = optionValue('tm', 'source')
  select.dispatchEvent(new Event('change'))
}

type App = {
  compiled(): Promise<void>
  tmPane(): HTMLElement
  editorText(pane: HTMLElement): string
  typeInto(pane: HTMLElement, text: string): void
}

let view: EditorView
let mounted = false

/**
 * Load `src` into the app's one source editor, mounting the app itself on the first call in this file
 * (`main()` runs once per page, per this file's own doc) and bringing the TM pane home on every later
 * one. Returns a handle over the parts of the running app this file's tests need — `compiled` waits for
 * THIS dispatch's own compile to finish (`schedule` flips `#results` off `'idle'` synchronously, at
 * dispatch, before the debounce — `compile.ts`'s own doc — so this cannot resolve against a stale idle
 * flag from a previous test).
 */
async function mountApp(src: string): Promise<App> {
  if (!mounted) {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    mounted = true
  } else {
    bringTmPaneHome()
  }
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })

  return {
    compiled: () => until(idle, `the app to settle on \`${src}\``),
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
   * **THE REFUSAL NAMES THE COUNT, BECAUSE A CONTROL THAT DOES NOTHING FOR AN INVISIBLE REASON IS
   * WORSE THAN NO CONTROL.** `list60` is 94,182 rules against a cap of `MAX_FORK_RULES` (50,000) —
   * `protocol.ts`'s own doc has the corpus measurement this figure comes from, and the note this task
   * started with is what keeps 94,182 (a RULE count) from being confused with 127,881 (the δ-table's ROW
   * count: states plus rules).
   */
  it('disables it with a count on a machine over the cap', { timeout: 120_000 }, async () => {
    const app = await mountApp(`[${Array.from({ length: 60 }, (_, i) => i + 1).join(', ')}]`)
    await app.compiled()
    const button = app.tmPane().querySelector<HTMLButtonElement>('button.detach')
    expect(button?.disabled).toBe(true)
    expect(button?.title).toMatch(/94,?182/)
  })

  /**
   * **THE SOURCE SESSION KEEPS RUNNING ACROSS A FORK**, which is the entire reason more than one
   * session exists.
   *
   * **THE DOC USED TO CLAIM THIS WAS "ASSERTED BY WATCHING THE SOURCE'S STEP COUNT ADVANCE, THE SAME
   * AXIS `scratch-fork.test.ts` USES FOR λ" — MEASURED FALSE, Important 5, whole-branch review before
   * merge.** `app.compiled()` waits for `#results` to reach `idle`, which `session-worker.ts` only
   * sets once the WHOLE run (both legs, decoded) has finished — so on `'let x = 40; x + 2'` the fork
   * always landed on a session with nowhere left to go. Mutation-proven: narrowing
   * `toBeGreaterThanOrEqual` to `toBe` still passed 5/5, printing `before=7 after=7`.
   *
   * **FIXED BY FORKING WHILE THE SOURCE IS GENUINELY MID-RUN, THE WAY THE λ ANALOGUE ACTUALLY DOES —
   * not by comparing step counts, but by the analogue's OTHER assertion.**
   * `scratch-fork.test.ts`'s own version makes two claims: the frontier advances DURING the build (not
   * reachable here — see below), and the source "RUNS TO ITS OWN ANSWER, not merely one more frame."
   * `BIG` (this file's own copy of that file's fixture) is what makes the second claim discriminating
   * here too: its λ leg finishes in 555 steps before TM recording even starts (`onRun`'s `await
   * recordLambda(...); await recordTm(...)` is sequential, not interleaved), so by the time this
   * pane's fork control is enabled the source is only just beginning several seconds of TM recording —
   * `#results` reads `'running'`, checked directly below rather than assumed from the timing
   * comment alone.
   *
   * **THE STEP-COUNT AXIS ITSELF IS NOT REACHABLE FROM THIS FILE, WHICH IS WHY THE ASSERTION CHANGED
   * SHAPE RATHER THAN JUST ITS FIXTURE.** The λ leg is already done by the time TM recording (the leg
   * this gesture forks FROM) begins, so watching `lambda-0`'s own step readout proves nothing once
   * `BIG` is the source. The TM leg IS still running, but `tm-0` — the one pane that shows it — is the
   * pane this test forks away, and nothing else on this page displays the source's TM leg. What
   * SURVIVES the fork and is still checkable is whether the source reaches its own answer at all: a
   * regression that made `detachMachine` mutate or steal the source's own worker instead of minting a
   * second one would leave `#results` stuck on `'running'` forever, which this fails on by timeout
   * rather than by a value that already happened to be final.
   */
  it('leaves the source session running', { timeout: 120_000 }, async () => {
    const app = await mountApp(BIG)
    const detach = () => app.tmPane().querySelector<HTMLButtonElement>('button.detach')
    await until(() => detach()?.disabled === false, 'the fork control to become available')
    // STILL MID-RUN, NOT MERELY ASSUMED FROM `BIG`'S OWN TIMING COMMENT.
    expect(document.querySelector<HTMLElement>('#results')?.dataset.state).toBe('running')

    detach()?.click()
    // NO `expect(...querySelector('.cm-editor')).not.toBeNull()` AFTER THIS LINE, THOUGH ONE STOOD
    // HERE UNTIL THE WAIT CHANGED SHAPE. The wait now guarantees exactly what that assertion checked,
    // so it could no longer fail — and a check that cannot fail is the `/halt/i` defect this file
    // already caught once (Important 3), wearing different clothes. The wait carries the claim
    // instead, and names it in its own timeout message.
    await until(() => forkEditorMounted(app.tmPane()), "the fork's own editor to mount")
    expect(app.tmPane().textContent).toMatch(/detached/i)

    // THE ASSERTION: the source's own run finishes despite the fork, rather than stalling forever —
    // see this test's own doc for why this axis and not a step comparison.
    await until(idle, "the source session's own run to finish despite the fork")
  })

  /**
   * **THE CONTROL MUST NOT SURVIVE ITS OWN FORK — Critical 1, fix round.** Measured in a real
   * browser on the unfixed source: `button.detach` stays present AND enabled on the pane that just
   * rebound onto its own new scratch, and a second click reaches `transport.ts`'s `detachMachine`
   * with no machine text (a TM scratch's own `tmProgram.tmText` is always `null` —
   * `replies.ts`'s `tm-scratch-compiled` arm constructs it that way on purpose) and throws
   * `detachMachine reached with no machine text` rather than doing nothing. A detached pane has
   * nothing left to fork (`pane-chrome.ts`'s `detachButton` doc: "A DETACHED PANE HAS NOTHING TO
   * FORK"), so the control must withdraw the instant this pane's OWN session becomes the scratch it
   * just made — not only when some later reply happens to tell it to.
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
    expect(app.tmPane().textContent).toMatch(/detached/i)
  })

  /**
   * **THE HEADLINE CAPABILITY: EDIT A RULE, WATCH THE TAPES TAKE IT.** Everything above this test is
   * plumbing; this is the thing the slice exists to make possible.
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

    // WAIT ON THE FACT ITSELF, NOT ON QUIESCENCE — Important 4. See `startStateGoesToHalt`'s own doc
    // for why a content-quiescence poll can resolve before the debounced recompile ever reaches the
    // worker, and why polling for this fact instead is immune to that race. The quiescence helper that
    // reasoning was written against is gone entirely now: `forkEditorMounted`'s doc has the measurement
    // that retired it from the three fork gestures above, which were its last callers.
    await until(() => startStateGoesToHalt(app.tmPane(), start), `the δ-table to show \`${start}\` going to halt`)
    expect(startStateGoesToHalt(app.tmPane(), start)).toBe(true)
  })
})

/**
 * Rewrite the start state's rule list to a single unconditional jump to `halt`, and hand back the
 * name that state was edited under — `runs the edited machine`'s own assertion reads it back rather
 * than hard-coding it a second time (Important 3, fix round: the assertion has to name the SAME state
 * this function edited, derived from the SAME text, or a future change to the lowering's naming could
 * silently desynchronize the two).
 *
 * **DERIVED FROM THE REAL TEXT, NOT HARD-CODED.** The state names are the lowering's (`pc0`,
 * `wl1s2.s.sk0`, …) and it is free to change them; a machine typed into this file would keep passing
 * after such a change while no longer being the machine the pane forked. This reads the `start`
 * directive out of the emitted header and edits the state it names.
 *
 * **`halt` ITSELF IS NOT DERIVED, AND THAT IS SAFE RATHER THAN A SECOND HARD-CODE — `redextape-core`'s
 * `tm/lower_tm.rs`, `tm/build.rs`, `tm/encoding/unary.rs` ALL BUILD THE ACCEPT STATE WITH THE LITERAL
 * `"halt"`.** It is the lowering's own fixed name for the machine's one accept state, not a fact this
 * function reads off the source program the way `start`'s target is — every encoding path in
 * `redextape-core` calls `b.accept("halt")`, and `crates/redextape-core/tests/fixtures/list_1_2.tm`
 * (`state halt: accept`) is a committed instance of exactly that convention.
 */
function editedToHaltImmediately(text: string): { text: string; start: string } {
  const start = /^start (\S+)$/m.exec(text)?.[1]
  if (start === undefined) throw new Error('emitted text has no `start` directive')
  const tapes = Number(/^tapes (\d+)$/m.exec(text)?.[1])
  if (!Number.isInteger(tapes)) throw new Error('emitted text has no `tapes` directive')
  const wild = Array.from({ length: tapes }, () => '*').join(' ')
  const stay = Array.from({ length: tapes }, () => 'S').join(' ')
  const rule = `  [${wild}] -> write [${wild}], move [${stay}], goto halt`

  // Replace every rule line under `state <start>:` with the one above. A state block runs from its
  // header to the next line that is not indented.
  const lines = text.split('\n')
  const at = lines.indexOf(`state ${start}:`)
  if (at < 0) throw new Error(`no block for the start state \`${start}\``)
  let end = at + 1
  while ((lines[end] ?? '').startsWith('  ')) end++
  return { text: [...lines.slice(0, at + 1), rule, ...lines.slice(end)].join('\n'), start }
}

/**
 * Whether the δ-table's rendered rows show `state`'s own header immediately followed by exactly the
 * one rule `editedToHaltImmediately` wrote — the fact worth waiting for and asserting, in place of
 * both the vacuous `/halt/i` this replaces (Important 3: `state halt: accept` is always somewhere in
 * the δ-table, forked or not, edited or not — the reviewer measured this true before the fork and
 * before the edit alike) and plain content quiescence (Important 4: `typeInto` changes the editor's
 * own text synchronously, well before the 300 ms debounce ever posts a recompile, so a quiescence
 * poll can settle in the gap before the worker answers at all — polling for this fact instead is
 * immune to that race by construction, since it can only become true once the reply that recompiled
 * the edited text has actually landed and repainted).
 *
 * READS THE RENDERED TABLE, NOT THE EDITOR'S OWN TEXT. The editor shows whatever was typed the
 * instant `typeInto` runs, which proves a keystroke reached the document and nothing about whether
 * the worker ever recompiled it — `TmPane.setProgram` is the one thing that can move what this reads,
 * and it runs only from a `tm-scratch-compiled` reply.
 */
function startStateGoesToHalt(pane: HTMLElement, start: string): boolean {
  const rows = [...pane.querySelectorAll<HTMLElement>('.state-row')]
  const at = rows.findIndex((el) => el.classList.contains('is-state') && el.textContent === start)
  const rule = at < 0 ? undefined : rows[at + 1]
  if (rule === undefined || !rule.classList.contains('is-rule')) return false
  return /→ halt$/.test(rule.textContent ?? '')
}
