import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * **HOVER, THROUGH THE APP** — Plan 7 part 3c, design §8.6 and §11.2.
 *
 * Four cases, each through the real app rather than a unit around `Language::hover`: pointer hover
 * over a `.rxt` `Nat` literal, pointer hover over a TM rule naming its goto target, `F2` at the caret
 * opening the same tooltip a pointer would, and — this file's centrepiece — a λ copy answering
 * NOTHING, from either input, with that silence shown able to fail rather than merely asserted. The
 * λ case's sabotage lives in the roadmap entry for the task that added it, not in this file: it
 * changes `Language::Lambda`'s arm in `crates/redextape-lsp/src/language.rs` to fall through to
 * `redextape_core::hover::rxt`, rebuilds the wasm, and reruns this file to watch the λ case below
 * fail before reverting.
 *
 * **KEYS ARRIVE THROUGH `userEvent`, NOT A SYNTHETIC `KeyboardEvent`.** `lsp-navigation.test.ts`
 * dispatches its own `KeyboardEvent` and this file deliberately does not copy it: a synthetic event
 * proves the keymap routes a key it was handed, not that the browser delivers one.
 *
 * **WHAT THE F2 CASE CANNOT SHOW.** Playwright injects keys through CDP at the renderer, so
 * browser-chrome bindings never apply here. This asserts nothing in the app stack swallows F2; that
 * Chromium itself binds nothing to it is why F2 was chosen and is not what this test checks.
 *
 * **THE F2-OPENED HOVER TOOLTIP DISMISSES ITSELF, AND POINTER HOVER SURVIVES IT** — the fix for a
 * CRITICAL defect the F2 case below exists to prove closed. The `F2` binding in `lsp-nav.ts` used to
 * call `activateHover` with no fourth argument, which CodeMirror's own vendored source locks forever:
 * `checkHover` in `@codemirror/view` refuses to run again while ANY tooltip on that editor — locked
 * or not — is still active, so one F2 press killed pointer hover on that editor for the rest of the
 * page's life. Reading the fix cannot prove it: a wrong `until` polarity closes the tooltip on the
 * very next transaction, which looks identical to the right fix in a screenshot and only differs in
 * how it behaves — which is what the assertions below are for, not what a diff review can be.
 *
 * **AFTER ANY F2 PRESS, DISMISS BEFORE REUSING THAT EDITOR.** The F2 tooltip is held open until a
 * caret move or an edit — never a timer — so a later assertion on the same editor would otherwise see
 * a tooltip it did not open itself.
 */

let view: EditorView

const idle = () =>
  document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
  (document.querySelector('#results')?.textContent ?? '') !== ''

/**
 * The exact fixture and offset `redextape-lsp`'s own
 * `hover_over_the_three_text_forms_that_dispatch_answers_each_documents_own_content` test uses for
 * `.rxt`, so both F2 and a pointer hover here answer something containing `Nat` for a reason already
 * proven server-side rather than guessed at from this file.
 */
const PROGRAM = 'let x = 1;\nx'
const NAT_OFFSET = 8

/**
 * The same `.rxt` Nat-literal fixture as `PROGRAM` above, one digit wider: `42` is TWO characters,
 * where `PROGRAM`'s `1` is one. Finding 1's own regression needs a token the pointer can move WITHIN
 * without leaving it, which a one-character literal cannot offer.
 */
const RANGE_PROGRAM = 'let x = 42;\nx'
/** Where the `4` of `42` sits in `RANGE_PROGRAM` — `NAT_OFFSET` above, one character wider. */
const RANGE_NAT_START = 8

/** `redextape-core`'s own `a_rule_hovers_with_what_it_does_in_words` fixture — MACHINE's first rule
 * reads `a`, writes `b`, moves right and goes to `q1`, and its second rule is every one of those
 * reversed, which is what proves a rule's own facts vary with the rule under the cursor rather than
 * being hardcoded from whichever rule an implementation happened to read first. */
const MACHINE =
  'tapes 1\nstart q0\n\nstate q0:\n  [a] -> write [b], move [R], goto q1\n  [b] -> write [a], move [L], goto q0\nstate q1: accept\n'

/**
 * A λ document `redextape_core::hover::rxt` WOULD answer for, and the real `Language::Lambda.hover`
 * never does — the fixture the sabotage in Task 9/10's roadmap entry runs this same file against.
 *
 * **`λx. 42` — THE OBVIOUS FIXTURE — DOES NOT WORK, AND THAT WAS MEASURED, NOT ASSUMED.** Fed to
 * `redextape_core::hover::rxt`, `parse_for_nav` cannot lex the leading `λ` at all and answers `None`
 * at every offset — the Nat literal after it is never reached. A Nat literal `rxt`'s error recovery
 * CAN reach needs to lead a statement, which is what `let x = 42;` gives it: `hover::rxt` answers
 * `Some` on offsets 8 and 9 (the `4` and the `2`), verified with a throwaway probe test before this
 * fixture was chosen. Because everything before the digits is ASCII, offset 8 means the same thing in
 * a Rust byte offset and a CodeMirror/JS UTF-16 offset — no conversion for this file to get wrong.
 *
 * **THE DIAGNOSTIC RANGE MUST NOT OVERLAP THE LITERAL'S OWN RANGE, AND THAT TOO WAS MEASURED RATHER
 * THAN ASSUMED.** A first draft used `42\nλx. x`, whose `parse_lambda` error sits at `0..0` — the
 * SAME character the literal starts on once digits are widened out from a zero-width diagnostic. The
 * caret there sits inside `@codemirror/lint`'s own diagnostic-hover range, and lint's tooltip and ours
 * are both hosted through the same `hoverPlugin` machinery: a view update from lint's tooltip
 * rendering is indistinguishable, to `HoverPlugin.update`, from the CodeMirror race
 * `retryUntilTooltipOpens` already routes around, and it raced this file's LSP tooltip out on every
 * attempt rather than occasionally — confirmed with a second throwaway probe that logged
 * `.cm-tooltip`'s own HTML and found the lint diagnostic there instead of `.cm-hover-answer`, every
 * time. `let x = 42;` parses "let" as an unbound λ VARIABLE (juxtaposition makes `let x` a valid
 * application), so `parse_lambda`'s "unbound variable `let`" diagnostic lands on `0..3` — nowhere
 * near the literal at `8..10` — while the fallback still answers for the literal exactly as before.
 * This is this file's settle signal for "the copy's edit reached the server": diagnostics arrive on
 * the same round trip hover would.
 *
 * **THE BINDER `y` DOES NOT DISCRIMINATE UNDER THE SABOTAGE, AND THAT TOO WAS MEASURED, NOT
 * INFERRED.** `λ` is two UTF-8 bytes, so the binder sits at byte offset 14 — inside `offset 10..18 ->
 * None`, the range `hover::rxt`'s fallback answers `None` at whether or not the sabotage is active.
 * A pointer hover there passes either way, which is why it is kept below only as a SMOKE CHECK — it
 * still catches an accidental hover leak elsewhere in the copy — and is documented as one rather than
 * left to read as the assertion that proves the gap. The assertion that does is a pointer hover on
 * the Nat literal itself, at `LAMBDA_NAT_OFFSET`: the one position measured to answer `Some` under
 * the fallback, and the same position the keyboard half already used.
 *
 * **THAT POINTER HOVER CANNOT TARGET A `.tok-nat` SPAN, BECAUSE THERE IS NO SUCH SPAN — measured, not
 * assumed.** Unlike `.rxt` and `.tm`, the λ tree-sitter grammar
 * (`grammars/tree-sitter-redextape-lambda/grammar.js`) has exactly one leaf rule, `identifier`
 * (letters, `_` and `$` to start, alphanumerics after) — no digit may START a token, and the grammar
 * has no number rule at all, so `42` parses as bare, uncaptured text sitting between two `identifier`
 * tokens; its own `highlights.scm` has no capture that could paint a digit run either way. A throwaway browser probe
 * logging every `[class*="tok-"]` element over this exact fixture confirmed it: six spans (`let`,
 * `x`, `λ`, `y`, `.`, `y`), none of them covering `42` — the DOM there is plain, unwrapped text. So
 * the pointer half of this case cannot `querySelector` its way to the discriminating position the way
 * every other pointer hover in this file does; it hovers PIXEL COORDINATES instead, computed from
 * `EditorView.coordsAtPos` through `contentCoordsAt` above — the same mechanism a real pointer uses,
 * landing where no span exists to hand it a target.
 */
const LAMBDA_WOULD_ANSWER_UNDER_THE_FALLBACK = 'let x = 42;\nλy. y\n'
/** Where the `4` of `42` sits in `LAMBDA_WOULD_ANSWER_UNDER_THE_FALLBACK` — see its own doc. */
const LAMBDA_NAT_OFFSET = 8

const tooltipTextOf = (v: EditorView): string | null => v.dom.querySelector('.cm-hover-answer')?.textContent ?? null

/**
 * Put the caret at `pos` on `v` and confirm it actually holds the focus — the precondition
 * `vim-keymap.test.ts`'s own `caretTo` states: every assertion below is about where a gesture landed,
 * and a key sent to an unfocused page reaches neither CodeMirror nor its hover binding.
 */
async function caretTo(v: EditorView, pos: number): Promise<void> {
  v.dispatch({ selection: { anchor: pos } })
  v.focus()
  await until(() => v.hasFocus, 'the editor to take focus')
}

/**
 * The pixel position of the character at `pos` in `v`, relative to `.cm-content` — what
 * `userEvent.hover`'s `position` option needs to land a POINTER gesture on an offset that owns no
 * `.tok-*` span of its own, the way `LAMBDA_NAT_OFFSET` in the λ copy does not (see that constant's
 * own doc). Every OTHER pointer hover in this file targets a real span element instead; this is the
 * one position with nothing to `querySelector` for.
 */
function contentCoordsAt(v: EditorView, pos: number): { x: number; y: number } {
  const content = v.dom.querySelector<HTMLElement>('.cm-content')
  if (content === null) throw new Error('no .cm-content to hover over')
  const rect = content.getBoundingClientRect()
  const left = v.coordsAtPos(pos)
  const right = v.coordsAtPos(pos + 1)
  if (left === null || right === null) throw new Error(`coordsAtPos(${pos}) answered null — is it off-screen?`)
  return { x: (left.left + right.left) / 2 - rect.left, y: (left.top + left.bottom) / 2 - rect.top }
}

/**
 * Move the pointer onto the character at `pos` in `v`, through `.cm-content` and `contentCoordsAt`.
 *
 * **IT TARGETS `.cm-content`, NOT A TOKEN'S OWN SPAN.** `userEvent.hover`'s `position` is relative to the
 * target element's own bounding box, and `contentCoordsAt` measures from `.cm-content`; paired with a
 * small `.tok-*` span instead, it lands the pointer somewhere else on the page entirely.
 *
 * **A NEW `position` FOR EVERY GESTURE, BECAUSE `userEvent.hover` SCALES THE ONE IT IS GIVEN IN PLACE.**
 * `@vitest/browser-playwright`'s `processPlaywrightPosition` multiplies the caller's own object by the
 * tester iframe's scale before handing it to Playwright — 0.80 in this suite's runs, measured by logging
 * the object after each call. A position kept and passed again lands at 0.80 of its offset from
 * `.cm-content`'s corner, then 0.64, and so on: the move case below used to keep one for its retries, so
 * once its first attempt missed, every retry aimed further from the `4` and the case could only time out.
 * Every pointer gesture at an offset in this file goes through here, so none can keep one.
 */
async function hoverOver(v: EditorView, pos: number): Promise<void> {
  const content = v.dom.querySelector<HTMLElement>('.cm-content')
  if (content === null) throw new Error('no .cm-content to hover over')
  await userEvent.hover(content, { position: contentCoordsAt(v, pos) })
}

/**
 * Repeat `gesture` on `v` until `tooltipTextOf(v)` is non-null, or give up after roughly nine seconds
 * and let `until`'s own message describe the final attempt.
 *
 * **THIS RETRIES A REAL, PRE-EXISTING CODEMIRROR RACE — FOUND WHILE WRITING THIS FILE'S FIRST CASE —
 * UNRELATED TO THE F2 LOCK FIX.** `HoverPlugin.update`, in vendored `@codemirror/view`, clears its
 * own in-flight `activateHover` promise on ANY view update, including a geometry-only one with zero
 * transactions: instrumenting the vendored source (temporarily, not part of this change) showed the
 * cancelling update reporting `geometryChanged: true, transactions: 0` — this page's own reflow,
 * landing inside the LSP round trip. That race is identical for the pointer path and for the F2 path,
 * exists whichever way `until` reads, and is not this task's finding to fix. Retrying is what a
 * person hitting the same gap would also do, and does not touch what this test asserts about what
 * happens once a tooltip is actually open.
 */
async function retryUntilTooltipOpens(v: EditorView, gesture: () => Promise<void>): Promise<void> {
  const giveUpAt = performance.now() + 9000
  while (performance.now() < giveUpAt) {
    await gesture()
    const attemptEndsAt = performance.now() + 600
    while (performance.now() < attemptEndsAt) {
      if (tooltipTextOf(v) !== null) return
      await new Promise((r) => setTimeout(r, 25))
    }
  }
  await gesture()
  await until(() => tooltipTextOf(v) !== null, 'a tooltip to open')
}

/**
 * Repeat `gesture` on `v` several times, asserting AFTER EVERY ONE that no tooltip has opened.
 *
 * **THIS RETRIES THE GESTURE, NEVER THE ASSERTION — the opposite loop from `retryUntilTooltipOpens`
 * above.** That helper loops UNTIL an assertion holds; looping the same way here would let a tooltip
 * that opens on attempt 3 of 5 be silently retried away by attempt 4's empty result. Every iteration's
 * `expect` runs on its own and can fail the test outright — the repetition exists only to rule out
 * "this one attempt happened not to land," the same CodeMirror race `retryUntilTooltipOpens` names,
 * pointed the other way: that race can as easily eat a REAL open as a wanted one, so a single attempt
 * finding nothing is weaker evidence than several agreeing.
 */
async function assertNeverOpens(v: EditorView, gesture: () => Promise<void>, attempts = 5): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    await gesture()
    await new Promise((r) => setTimeout(r, 400))
    expect(tooltipTextOf(v), `attempt ${i + 1} of ${attempts}: a tooltip opened where λ must answer nothing`).toBeNull()
  }
}

const paneHost = (leaf: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-leaf="${leaf}"]`)
  if (el === null) throw new Error(`no pane mounted at [data-leaf="${leaf}"]`)
  return el
}

const editorViewOf = (pane: HTMLElement): EditorView => {
  const host = pane.querySelector<HTMLElement>('.term-editor')
  if (host === null) throw new Error('this pane has no mounted editor')
  const v = EditorView.findFromDOM(host)
  if (v === null) throw new Error('no CodeMirror view under the editor host')
  return v
}

/** Make a copy of what this pane shows, through the control a user has — `lsp-copy-diagnostics.test.ts`'s idiom. */
async function makeCopy(pane: HTMLElement): Promise<EditorView> {
  const button = pane.querySelector<HTMLButtonElement>('button.detach')
  if (button === null) throw new Error('this view offers no `edit a copy` control')
  expect(button.disabled, 'the fork control should be available on this machine').toBe(false)
  button.click()
  await until(() => pane.querySelector('.term-editor') !== null, 'the copy to mount its editor')
  return editorViewOf(pane)
}

/** Replace a copy's text and wait past the edit debounce, which is what posts `didChange`. */
function retype(v: EditorView, text: string): void {
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
}

/** Error markers inside ONE pane's editor — the settle signal for "this pane's edit reached the server". */
const markersIn = (pane: HTMLElement) => pane.querySelectorAll('.cm-editor .cm-lintRange-error').length

describe('hover, through the app', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: PROGRAM } })
    await until(idle, 'the program to compile')
  })

  it('pointer hover over a Nat literal answers with the other-bases row', async () => {
    const natSpan = view.dom.querySelector<HTMLElement>('.tok-nat')
    if (natSpan === null) throw new Error('no .tok-nat span to hover over — the program did not highlight')

    await retryUntilTooltipOpens(view, () => userEvent.hover(natSpan))
    expect(tooltipTextOf(view)).toContain('0x')

    // Dismiss before the next case reuses this same editor.
    await userEvent.unhover(natSpan)
    await until(() => tooltipTextOf(view) === null, 'the pointer tooltip to close')
  })

  it('opens on F2, closes on the next caret move, and leaves pointer hover working', async () => {
    await caretTo(view, NAT_OFFSET)

    await retryUntilTooltipOpens(view, () => userEvent.keyboard('{F2}'))
    expect(tooltipTextOf(view)).toContain('Nat')
    // Same content a pointer hover over the same literal answers with, not merely the same title.
    expect(tooltipTextOf(view)).toContain('0x')

    // Finding 3, proven rather than read back from the stylesheet: CodeMirror's base theme sets
    // `.cm-tooltip`'s border to its hardcoded light-mode `#bbb` (`rgb(187, 187, 187)`) through a
    // selector `style.css`'s fix has to outrank on specificity, not merely follow in source order.
    // If the override is losing that fight, this is still the CM6 default.
    const wrapper = view.dom.querySelector<HTMLElement>('.cm-tooltip')
    const borderColor = wrapper === null ? null : getComputedStyle(wrapper).borderTopColor
    expect(borderColor, "the tooltip wrapper still carries CodeMirror's hardcoded light border").not.toBe(
      'rgb(187, 187, 187)',
    )

    // THE DISMISSING GESTURE. The `until` callback the `F2` binding in `lsp-nav.ts` passes to
    // `activateHover` closes the tooltip on a caret move or an edit; an arrow key is both an ordinary
    // user gesture and unambiguous evidence, unlike `Escape`, whose default CodeMirror binding
    // declines to dispatch anything when there is no selection to simplify — `vim-keymap.test.ts`
    // records that same declining behaviour.
    await userEvent.keyboard('{ArrowRight}')
    await until(() => tooltipTextOf(view) === null, 'the tooltip to close once the caret moves')

    // **THE ASSERTION THAT WOULD HAVE CAUGHT THE DEFECT.** Before the fix, `checkHover` bails out
    // permanently the moment this editor's hover state field is ever non-empty, because nothing ever
    // emptied it again — so a pointer hover issued AFTER an F2 press is exactly the case that used to
    // never run, on an editor that otherwise looks and behaves normally.
    const natSpan = view.dom.querySelector<HTMLElement>('.tok-nat')
    if (natSpan === null) throw new Error('no .tok-nat span to hover over — the program did not highlight')
    await retryUntilTooltipOpens(view, async () => {
      await userEvent.unhover(natSpan)
      await userEvent.hover(natSpan)
    })
    expect(tooltipTextOf(view)).toContain('Nat')

    // Dismiss before the next case reuses this same editor — matching case 1's own pattern, above.
    await userEvent.unhover(natSpan)
    await until(() => tooltipTextOf(view) === null, 'the pointer tooltip to close')
  })

  it('pointer hover over a TM rule names the goto target', async () => {
    const pane = paneHost('tm-0')
    const editor = await makeCopy(pane)
    retype(editor, MACHINE)

    // Wait for tree-sitter to colour the goto target specifically — `q1` names it unambiguously,
    // where `.tok-statename` also matches `start q0`'s target and the second rule's `goto q0`, either
    // of which would hover as a bare state reference (`hover::tm`'s SECOND branch only answers a
    // state's DEFINITION) and answer nothing at all, breaking this case for a reason that has nothing
    // to do with what it claims to test.
    const gotoTarget = (): HTMLElement | undefined =>
      [...editor.dom.querySelectorAll<HTMLElement>('.tok-statename')].find((el) => el.textContent === 'q1')
    await until(() => gotoTarget() !== undefined, "the rule's goto target to be coloured")
    const span = gotoTarget()
    if (span === undefined) throw new Error('no .tok-statename span reading q1')

    await retryUntilTooltipOpens(editor, () => userEvent.hover(span))
    expect(tooltipTextOf(editor)).toContain('q1')

    await userEvent.unhover(span)
  })

  /**
   * **THE CENTREPIECE.** `Language::hover`'s own doc says `.rxlambda` answers `None` because
   * `LambdaTerm` carries no span on any variant — a designed gap, not an oversight — and this is what
   * proves the assertions below can actually fail rather than passing against any implementation that
   * happens to answer nothing. The failure is produced by temporarily changing `Language::Lambda`'s
   * arm in `crates/redextape-lsp/src/language.rs` to `redextape_core::hover::rxt(src, offset)`,
   * rebuilding the wasm, and rerunning this file — recorded in the roadmap entry for the task that
   * added this file, not asserted here, because a permanent test cannot carry a temporary edit.
   *
   * **TWO POINTER SUB-CASES, AND ONLY ONE OF THEM DISCRIMINATES.** The Nat literal at
   * `LAMBDA_NAT_OFFSET` is where `hover::rxt`'s fallback answers `Some` — a pointer hover there fails
   * under the sabotage and only under the sabotage, same as the `F2` sub-case below. The binder `y` is
   * a SMOKE CHECK, not a discriminating assertion: it hovers a real span for good measure, but sits at
   * a byte offset the fallback answers `None` at regardless, so it cannot itself catch the sabotage —
   * see `LAMBDA_WOULD_ANSWER_UNDER_THE_FALLBACK`'s own doc for the measurement.
   */
  it('shows no tooltip anywhere in a λ copy, by pointer or by F2', async () => {
    const pane = paneHost('lambda-0')
    const editor = await makeCopy(pane)
    retype(editor, LAMBDA_WOULD_ANSWER_UNDER_THE_FALLBACK)
    await until(() => markersIn(pane) > 0, "the λ copy's edit to reach the server")

    // POINTER, over the Nat literal itself — LAMBDA_NAT_OFFSET, the exact position `hover::rxt`'s
    // fallback answers `Some` at. THIS IS THE HALF THAT DISCRIMINATES: it fails under the sabotage,
    // proven below. No `.tok-nat` span exists to hover here (see the fixture's own doc), so this
    // targets pixel coordinates, relative to `.cm-content`, through `contentCoordsAt` rather than
    // `querySelector`.
    const content = editor.dom.querySelector<HTMLElement>('.cm-content')
    if (content === null) throw new Error('no .cm-content to hover over')
    await assertNeverOpens(editor, async () => {
      await userEvent.unhover(content)
      await hoverOver(editor, LAMBDA_NAT_OFFSET)
    })

    // POINTER, over an ordinary token elsewhere in the document — a SMOKE CHECK, not a discriminating
    // one (see this case's own doc above): it cannot fail under this sabotage, but still catches an
    // accidental hover leak anywhere else in the copy.
    const binderSpan = editor.dom.querySelector<HTMLElement>('.tok-binder')
    if (binderSpan === null) throw new Error('no .tok-binder span to hover over — the term did not highlight')
    await assertNeverOpens(editor, async () => {
      await userEvent.unhover(binderSpan)
      await userEvent.hover(binderSpan)
    })

    // KEYBOARD, with the caret on the Nat literal — `LAMBDA_NAT_OFFSET`, the same position the first
    // pointer sub-case above targets, and the position this case exists to guard.
    await caretTo(editor, LAMBDA_NAT_OFFSET)
    await assertNeverOpens(editor, () => userEvent.keyboard('{F2}'))
  })

  /**
   * Finding 1 of the whole-branch review: `lspHover`'s tooltip carried no `end`, so vendored
   * `HoverPlugin.mousemove` defaulted it to `pos` and took its `pos == end` branch — closing the
   * tooltip the instant `posAtCoords` read anything but the exact offset it opened at, including a
   * pointer move that stays on the very token the tooltip is about.
   */
  it('pointer hover survives a move that stays within the same token', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: RANGE_PROGRAM } })
    await until(idle, 'the program to compile')

    const natSpan = view.dom.querySelector<HTMLElement>('.tok-nat')
    if (natSpan === null) throw new Error('no .tok-nat span to hover over — the program did not highlight')

    const content = view.dom.querySelector<HTMLElement>('.cm-content')
    if (content === null) throw new Error('no .cm-content to hover over')

    // `42` is two characters. Landing on the `4` (`RANGE_NAT_START`) and then the `2` moves the pointer
    // without ever leaving the literal — the case a one-character token (`PROGRAM`'s `1`, above) cannot
    // pose. Both go through `hoverOver`, which builds each gesture's position afresh.
    //
    // **THE WHOLE OPEN-AND-MOVE GESTURE IS RETRIED, AND THE CLAIM IS THAT ONE ATTEMPT SURVIVES IT —
    // NOT THAT EVERY ATTEMPT DOES.** An earlier draft opened once, moved once and read once, and
    // flaked at roughly one run in four: 6 passes and 2 failures over 8 runs of this file, always on
    // this case, always `expected null not to be null`. The cause is the pre-existing CodeMirror race
    // `retryUntilTooltipOpens` documents — `HoverPlugin.update` clearing a tooltip on a geometry-only
    // update — landing just after the move, which has nothing to do with what this case asserts.
    //
    // **RETRYING DOES NOT BLUNT THE DISCRIMINATION HERE, BECAUSE THE TWO CAUSES DIFFER IN KIND RATHER
    // THAN IN DEGREE.** Without `end` mapped from the server's `Hover.range`, `HoverPlugin.mousemove`
    // takes its `pos == end` branch and the move closes the tooltip on EVERY attempt — no number of
    // retries ever finds a survivor, so this still fails. The race closes it on SOME attempts. A
    // single survivor is therefore only reachable when the range is actually being honoured, which is
    // the property this case exists to hold.
    //
    // **THE FIRST ATTEMPT CAN ALSO MISS BECAUSE THE EDITOR MOVED**, when the notice the λ copy case put
    // up expires during it — the next case has the measurement and makes that miss happen on purpose.
    await retryUntilTooltipOpens(view, async () => {
      await userEvent.unhover(content)
      await hoverOver(view, RANGE_NAT_START)
    })
    expect(tooltipTextOf(view)).toContain('0x')

    // **THE MOVE WAITS FOR THE REQUEST BEHIND THE TOOLTIP TO SETTLE, AND THAT IS NOT BELT AND BRACES
    // — IT IS THE DIFFERENCE BETWEEN THIS CASE AND A COIN FLIP.** Vendored `HoverPlugin.mousemove`
    // guards with `(… && …) || this.pending`, so a move lands in the cancelling branch whenever a
    // hover request is still in flight; and the `end` it reads there is `active[0]?.end ?? pos`, which
    // falls back to `pos` while `active` is still empty. A move racing a pending request therefore
    // takes the `pos == end` branch and cancels it NO MATTER WHAT RANGE the server sent — the very
    // thing this case exists to test, decided by timing rather than by the fix.
    //
    // An earlier draft moved as soon as the tooltip appeared and flaked at 6 passes to 2 failures over
    // 8 runs; a draft that retried the whole gesture six times instead blew the 15 s test timeout,
    // because each attempt can spend `retryUntilTooltipOpens`'s full budget. Waiting for SUSTAINED
    // stability — the same text twice, across more than the 300 ms `hoverTime` that would start
    // another request — is what makes the move a test of the range rather than of the clock.
    const settled = tooltipTextOf(view)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(tooltipTextOf(view), 'the tooltip must still be open and unchanged before the move').toBe(settled)

    // Read once, never polled: polling would let a tooltip that closed and reopened on a later frame
    // pass as one that never closed, which is exactly the defect being ruled out.
    await hoverOver(view, RANGE_NAT_START + 1)
    const afterTheMove = tooltipTextOf(view)
    expect(afterTheMove, 'a move that stayed within the same token should not have closed the tooltip').not.toBeNull()
    expect(afterTheMove).toContain('0x')

    await userEvent.unhover(content)
    await until(() => tooltipTextOf(view) === null, 'the pointer tooltip to close')
  })

  /**
   * **A RETRIED HOVER AIMS WHERE THE FIRST ATTEMPT AIMED, AFTER THE EDITOR HAS MOVED UNDER THE POINTER.**
   * The move case above used to time out at 15 s under full-suite load. The notice the λ copy case puts
   * up lasts `NOTICE_MS`, eight seconds, and in runs of this file alone it expired only 7-43 ms after the
   * move case's tooltip opened, so a little load moved the expiry into that case's first attempt. The
   * notice line collapsing lifted the editor 28.5 px under a pointer that had not moved, so
   * `HoverPlugin.startHover` found no character under `lastMove` when its 300 ms `hoverTime` ran out, and
   * asked nothing. That miss is what `retryUntilTooltipOpens` is for, but every retry missed as well, for
   * the reason in `hoverOver`'s doc.
   *
   * Here a line above the editor collapses 100 ms after the first attempt's pointer arrives, ahead of the
   * 300 ms timer that attempt waits on, so the first attempt misses every time. The tooltip must still
   * open on the `42` on a later attempt. `attempts > 1` is the check that the collapse did its job, since
   * a pass on the first attempt would have tested nothing.
   */
  it('a retried pointer hover lands on the character it aimed at after the editor moves under it', async () => {
    const content = view.dom.querySelector<HTMLElement>('.cm-content')
    if (content === null) throw new Error('no .cm-content to hover over')
    const main = document.querySelector('main')
    if (main === null) throw new Error('no <main> to put a line above')
    const line = document.createElement('div')
    line.style.height = '30px'
    main.before(line)
    const collapseSoon = () => setTimeout(() => line.remove(), 100)

    let attempts = 0
    try {
      await retryUntilTooltipOpens(view, async () => {
        attempts++
        await userEvent.unhover(content)
        if (attempts === 1) view.dom.addEventListener('mousemove', collapseSoon, { once: true })
        await hoverOver(view, RANGE_NAT_START)
      })
    } finally {
      line.remove()
    }
    expect(attempts, 'the collapsing line should have made the first attempt miss').toBeGreaterThan(1)
    expect(tooltipTextOf(view)).toContain('0x')

    await userEvent.unhover(content)
    await until(() => tooltipTextOf(view) === null, 'the pointer tooltip to close')
  })
})
