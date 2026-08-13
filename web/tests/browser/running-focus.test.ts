import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'

// DUPLICATED FROM `app.test.ts` ON PURPOSE, exactly as `link-truncated.test.ts` duplicates it. See the
// `describe` below for why these cases are not `it`s in that file.
const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

/**
 * `let x = 40; x + 2` — the app's own sample, and the only corpus program whose entire `Owner`
 * sequence is short enough to assert step by step.
 *
 * MEASURED, NOT ASSUMED. Driving `trace::LambdaCursor` over this source and printing `last_owner()`
 * against `SourceMap::source_span` at every step (the same walk `owner_probe.rs` makes for M1/M2,
 * per-step rather than aggregated) gives exactly:
 *
 * ```text
 *   step 1   Exact    bytes  0..11   "let x = 40;"
 *   step 2   Within   bytes 12..17   "x + 2"
 *   step 3   Exact    bytes 12..17   "x + 2"
 *   steps 4..7        None
 * ```
 *
 * STEPS 2 AND 3 ARE WHY THIS FIXTURE AND NOT ANOTHER: two DIFFERENT claims about the SAME span, back
 * to back. A focus that merely remembered the last construct it saw, or that collapsed `Exact` and
 * `Within` into one signal, reproduces the span at both steps and is caught only by the class
 * changing under a constant `textContent`.
 *
 * Step 3 is also design §8.4's own case — "the step contracting the `BinOp`'s own `App` reports
 * `Exact` naming `x + 2`", the answer `viewmodel_contract.rs` pinned as never namable while
 * `node_to_lambda` was the mechanism — reached here through the real app rather than through the
 * cursor.
 */
const SAMPLE = 'let x = 40; x + 2'

/** Byte offset of the `+`, which is the only position inside `x + 2` that `innermost` resolves to the
 * `BinOp` itself: byte 12 lands on the `x` `Var` and byte 16 on the `2`, both narrower spans that win
 * `link.ts`'s smallest-containing-span rule. `app.test.ts` links at 12 deliberately, for the opposite
 * reason. */
const PLUS = SAMPLE.indexOf('+')

/**
 * A program most of whose β-steps report `Owner::None` — but, since region-path tagging landed, no
 * longer ALL of them. This fixture used to be fully untagged (`exact=0 within=0 none=5`, `lower.rs`
 * tagging `Apply`/`Let`/`LetRec`/`BinOp`/`If` and never `While`/`Assign`/`Seq`/the region `Let` arms);
 * that is the same reason `while4` used to report `None` on 432 of its 470 steps (task 8's M1). Region-
 * path tagging (2026-08-10) added five region tagging sites — both `Let` arms, `Seq`, the region `If`,
 * and `While`'s own root `App` — and this program's desugaring cannot avoid two of them: `let mut n = 1`
 * is a `Let{mutable: true}` node, and `desugar.rs`'s `Stmt::Assign` arm unconditionally wraps the
 * assignment in a `Core::Seq` (`desugar.rs:129-140`) — there is no statement position that skips it.
 * `Assign` itself is STILL never tagged (`lower.rs`'s `Core::Assign` arm returns the rebuilt store
 * untagged), but the `Seq` wrapping it is, and `desugar.rs:136,138` mints that `Seq`'s span from the
 * same `Stmt::Assign` span, so its tag reads on screen as if `n = 2;` itself were the named construct.
 *
 * MEASURED, NOT ASSUMED, THE SAME WAY AS `SAMPLE`: driving `trace::LambdaCursor` over this source
 * (`cargo run --example`-style, against a throwaway probe, cross-checked against the running app)
 * gives, node id and all:
 *
 * ```text
 *   step 1   None                        the region's own `(\store. …) initial_store` wrapper — scaffolding
 *                                         `lower_region` builds and deliberately never tags — contracting first
 *   step 2   Exact  id 5  "let mut n = 1;"   the `Let{mutable: true}` node's own App
 *   step 3   Exact  id 3  "n = 2;"           the `Seq` wrapping the assignment (desugar shares its span with
 *                                             the `Assign` statement it wraps — see above)
 *   step 4   None                        final-store projection machinery — no source construct owns it
 *   step 5   None                        same
 * ```
 *
 * A FULLY untagged program is no longer constructible from source syntax at all, not just unlucky for
 * this fixture. `x = e` parses only as `Stmt::Assign` (`parser.rs:97` special-cases `Ident '='` at
 * statement position; assignment is never a tail `Expr`), and every `Stmt::Assign`/`Stmt::While`/non-tail
 * `Stmt::Expr` desugars inside a `Core::Seq` (`desugar.rs:129-160`) — so there is no source route to a
 * bare, `Seq`-free `Assign` (only `lower.rs`'s own
 * `forget_discards_a_store_discarding_assigns_subtree_without_dangling_paths` test reaches that shape,
 * and only by constructing `Core` directly, bypassing the parser and desugarer). `owner_probe.rs`'s
 * nine-program corpus agrees at scale: the roadmap's "THE FULL NINE-PROGRAM TABLE AFTER" entry
 * (`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`) shows every one of the nine rows with
 * `Exact > 0` post-slice — even `while4` and `countdown4`, which used to sit almost entirely in `None`.
 *
 * SO THIS FIXTURE NOW CARRIES BOTH HALVES OF WHAT THIS FILE NEEDS, and neither the exact-value steps nor
 * the `None` steps below are decorative:
 *   - steps 2-3 pin the tagging this slice added, the same way `SAMPLE`'s steps pin the pre-existing
 *     sites, so a regression that stops `Let{mutable: true}`/`Seq` from tagging goes red here too, and
 *   - steps 1, 4 and 5 are what remain of the ORIGINAL property this test was written for: §5.1's "most
 *     β-steps have no source construct" must still show nothing and never throw on the way to deciding
 *     that, exactly where `while4` spends 92% of its own run.
 */
const SPARSELY_TAGGED = 'let mut n = 1; n = 2; n'

let view: EditorView
/** Uncaught errors and rejections seen since the page mounted — see the `SPARSELY_TAGGED` test's use of
 * it. */
const pageErrors: string[] = []

async function until(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error('timed out waiting for the app')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const resultsText = () => document.querySelector('#results')?.textContent ?? ''
const stepText = () => document.querySelector('[data-leaf="lambda-0"] .step')?.textContent ?? ''
/** The text of whichever source construct is currently pinned by a click — `app.test.ts`'s own helper. */
const linkedSource = () => document.querySelector('.cm-editor .linked')?.textContent ?? ''

/** Every element carrying a running-focus class, whichever claim it is. */
const focusEls = () => [
  ...document.querySelectorAll(
    '.cm-editor .is-focus-exact, .cm-editor .is-focus-within, .cm-editor .is-focus-coincident',
  ),
]
/** The focus as `"<claim>:<text>"`, or `''` when nothing is focused. One mark at a time, by construction:
 * `focusMark` returns a `Decoration.set` of exactly one range or `Decoration.none`. */
const focusReading = () => {
  const el = focusEls()[0]
  if (el === undefined) return ''
  const claim = el.className.replace('is-focus-', '')
  return `${claim}:${el.textContent ?? ''}`
}

const click = (label: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')].find(
    (x) => x.textContent === label,
  )
  b?.click()
  return b
}

/** `click`, but on the TM pane's own control strip — the δ leg has a play head of its own. */
const tmClick = (label: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="tm-0"] .controls button')].find(
    (x) => x.textContent === label,
  )
  b?.click()
  return b
}

const tmStepText = () => document.querySelector('[data-leaf="tm-0"] .step')?.textContent ?? ''
const linkStatusText = () => document.querySelector('#link-status')?.textContent ?? ''
/** The δ-table rows carrying the TM leg's running focus. `focusedRows` marks state HEADERS only. */
const tmFocusRows = () => [...document.querySelectorAll<HTMLElement>('[data-leaf="tm-0"] .state-row.is-focus')]
const tmFocusNames = () => tmFocusRows().map((e) => e.textContent ?? '')
/** The row the machine is standing on, which `#drawTable` also scrolls into view. */
const tmCurrentRow = () => document.querySelector<HTMLElement>('[data-leaf="tm-0"] .state-row.is-current')

/**
 * Link the source construct at `pos`, via the keyboard route `main.ts` binds to `Mod-'`. Same helper
 * and same reasoning as `app.test.ts`'s: the keyboard path resolves against the caret alone and needs
 * no `posAtCoords` layout to line up, and these fixtures are ASCII so a UTF-16 position and a byte
 * offset coincide.
 */
function linkAt(v: EditorView, pos: number): void {
  v.dispatch({ selection: { anchor: pos } })
  v.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: "'", ctrlKey: true, cancelable: true }))
}

/** Replace the whole buffer and wait for the run it triggers to finish. Same invariant as `app.test.ts`'s. */
async function settled(v: EditorView, src: string): Promise<void> {
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: src } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== '')
}

/** `settled`, then the play head parked at step 0 — where every test below starts walking from. */
async function settledAtZero(src: string): Promise<void> {
  await settled(view, src)
  click('↺')
  expect(stepText()).toContain('step 0')
}

describe('the running focus', () => {
  // ITS OWN FILE, NOT CASES IN `app.test.ts`, AND THE ISOLATION IS THE POINT. Vitest gives each test
  // FILE its own page and worker; `app.test.ts` runs ~40 tests against one long-lived pair, and two
  // previous slices (5b, and the print-depth cap) each found that a program needing many steps
  // degrades badly there against a fresh page — a worker's print stack ceiling settles lower after its
  // first deep print, so which program settles depends on run order within the worker. See
  // `link-truncated.test.ts`'s own file comment for the full account. These tests walk two programs to
  // their frontier and back, several times each.
  beforeAll(async () => {
    window.addEventListener('error', (e) => pageErrors.push(`error: ${e.message}`))
    window.addEventListener('unhandledrejection', (e) => pageErrors.push(`rejection: ${String(e.reason)}`))
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  // THE PRIMARY CLAIM, WALKED FORWARD. Step 0's frame carries `Owner::None` by construction
  // (`LambdaCursor::new` initialises `last_owner` to it and no step has run), so the focus starts dark
  // — and that is asserted, not skipped, because "no focus was ever painted at all" would otherwise
  // satisfy every later assertion's absence half.
  it('moves from construct to construct as the play head walks the run', async () => {
    await settledAtZero(SAMPLE)
    expect(focusReading(), 'step 0 has taken no step, so it owns nothing').toBe('')

    click('▶')
    expect(stepText()).toContain('step 1')
    expect(focusReading()).toBe('exact:let x = 40;')

    // THE SPAN DOES NOT CHANGE HERE AND THE CLAIM DOES. See `SAMPLE`'s doc: step 2 contracts inside
    // the `BinOp` without contracting the `BinOp`'s own `App`, step 3 contracts the `App` itself.
    click('▶')
    expect(stepText()).toContain('step 2')
    expect(focusReading()).toBe('within:x + 2')

    click('▶')
    expect(stepText()).toContain('step 3')
    expect(focusReading()).toBe('exact:x + 2')

    // AND IT GOES DARK AGAIN RATHER THAN STICKING. Steps 4-7 are inside `plus` and inside two Church
    // numerals — design §5.1's "most β-steps have no source construct" — and `None` must CLEAR the
    // previous step's mark, not leave it standing.
    click('▶')
    expect(stepText()).toContain('step 4')
    expect(focusReading(), 'a None step must clear the previous step’s mark').toBe('')
  }, 30_000)

  // THE SAME SEQUENCE, THROUGH `⏵` RATHER THAN `▶`. A different code path: `main.ts`'s `play()` is a
  // `setInterval` over recorded frames, and every other test in this file drives `draw()` from a
  // synchronous button handler instead. Nothing anywhere else in the suite exercises `⏵` at all.
  //
  // OBSERVED, NOT SAMPLED, AND THAT IS THE WHOLE DESIGN OF THIS TEST. A polling version of it — 5 ms
  // ticks against `PLAY_MS`'s 120 ms, which in practice sees every frame several times over — was
  // written first and SURVIVED EVERY MUTATION tried against this file, including collapsing `Within`
  // into `Exact` and never clearing the mark, because a set-membership assertion tolerant enough to
  // never flake is also tolerant enough to accept a wrong sequence. A `MutationObserver` on the
  // editor's content is exact instead: every `draw()` writes the decoration synchronously inside its
  // own interval tick, so each frame gets its own microtask checkpoint and its own callback.
  //
  // DEDUPED ON CONSECUTIVE EQUALITY, AND BLANKS ARE FILTERED OUT OF THE ORDERED ASSERTION. CodeMirror
  // may touch the content DOM more than once per frame (its own measure pass), and a redraw that
  // removes the old mark before adding the new one would show a momentary blank between two real
  // readings. The blanks that MATTER are the first and the last — before any step has run, and after
  // the run has walked into its `None` tail — and those are asserted directly.
  it('walks the whole owner sequence, in order, during one ⏵ playback', async () => {
    await settledAtZero(SAMPLE)

    const seen: string[] = []
    const record = () => {
      const r = focusReading()
      if (seen[seen.length - 1] !== r) seen.push(r)
    }
    const observer = new MutationObserver(record)
    observer.observe(view.contentDOM, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
    record()

    click('⏵')
    await until(() => stepText().includes('step 7'))
    observer.disconnect()
    record()

    const named = seen.filter((s) => s !== '').filter((s, i, a) => s !== a[i - 1])
    expect(named, 'every construct the run named, in the order it named them').toEqual([
      'exact:let x = 40;',
      'within:x + 2',
      'exact:x + 2',
    ])
    expect(seen[0], 'nothing is focused before the first step runs').toBe('')
    expect(seen[seen.length - 1], 'the None tail leaves nothing focused').toBe('')
  }, 30_000)

  // `owner` IS PER-FRAME, WHICH IS WHAT MAKES SCRUBBING FREE (design §4.3). The test that a single
  // remembered "current owner" would fail: `settled` leaves the head at step 7, whose owner is `None`,
  // so an implementation reading anything other than the frame under the head answers "nothing
  // focused" at every position below — including steps 1-3, where the run demonstrably named a
  // construct on the way past.
  it('shows the answer that was true at the scrubbed-to step, not the one at the frontier', async () => {
    await settled(view, SAMPLE)
    expect(stepText()).toContain('step 7')
    expect(focusReading(), 'the frontier’s own step owns nothing').toBe('')

    click('◀')
    click('◀')
    click('◀')
    click('◀')
    expect(stepText()).toContain('step 3')
    expect(focusReading()).toBe('exact:x + 2')

    // ONE STEP FURTHER BACK, SAME TEXT, DIFFERENT CLAIM — the assertion a "remember the last non-None
    // owner" implementation cannot pass, since it would still be holding step 3's `Exact` here.
    click('◀')
    expect(stepText()).toContain('step 2')
    expect(focusReading()).toBe('within:x + 2')

    click('◀')
    expect(stepText()).toContain('step 1')
    expect(focusReading()).toBe('exact:let x = 40;')

    click('◀')
    expect(stepText()).toContain('step 0')
    expect(focusReading()).toBe('')
  }, 30_000)

  // TWO LAYERS, BOTH ON SCREEN (design §4.3). The pin is a click the user made; the focus moves every
  // β-step. Neither may suppress the other — suppressing the focus while a pin is set turns the
  // highlight off at exactly the moment it is most wanted, and a focus that cleared the pin would undo
  // the gesture 5b exists for.
  it('paints the pin and the focus at once, on different constructs, with neither clearing the other', async () => {
    await settledAtZero(SAMPLE)

    linkAt(view, PLUS)
    expect(linkedSource(), 'the `+` resolves to the BinOp, not to `x` or `2`').toBe('x + 2')

    // STEP 1, NOT 2 OR 3: those are the steps whose owner IS the pinned node, which is coincidence and
    // gets its own class (the test below). Step 1 is the only step of this program where the pin and
    // the focus name genuinely different constructs.
    click('▶')
    expect(stepText()).toContain('step 1')
    expect(linkedSource(), 'a β-step must not clear a pin').toBe('x + 2')
    expect(focusReading(), 'a pin must not suppress the focus').toBe('exact:let x = 40;')
    // Two marks, two spans — not one span that happens to satisfy both queries.
    expect(document.querySelector('.cm-editor .linked')).not.toBe(focusEls()[0])
  }, 30_000)

  // COINCIDENCE — "the moment the app exists to show" (design §4.3), and the one state that is neither
  // claim: `main.ts`'s `draw()` substitutes `'coincident'` for `focus.claim` when `isCoincident` holds,
  // so `.is-focus-exact` and `.is-focus-within` must BOTH be absent here rather than one of them
  // sitting under the pin.
  //
  // TRUE FOR A `Within` FOCUS TOO, AND THAT IS ASSERTED: step 2 pins `x + 2` and the step is `Within`
  // that same node, which `isCoincident` deliberately treats as coincident (see its doc — "a weaker
  // claim is still a true one about the pinned construct").
  it('gives the pin and the focus one combined mark when they name the same construct', async () => {
    await settledAtZero(SAMPLE)
    linkAt(view, PLUS)
    expect(linkedSource()).toBe('x + 2')

    click('▶')
    click('▶')
    expect(stepText()).toContain('step 2')
    expect(focusReading(), 'a Within focus on the pinned node is still coincidence').toBe('coincident:x + 2')

    click('▶')
    expect(stepText()).toContain('step 3')
    expect(focusReading()).toBe('coincident:x + 2')
    expect(document.querySelector('.cm-editor .is-focus-exact'), 'coincidence replaces the claim class').toBeNull()
    expect(document.querySelector('.cm-editor .is-focus-within')).toBeNull()

    // THE PIN IS STILL THERE, AND THE TWO MARKS NEST RATHER THAN MERGE. A rendering-engine fact that
    // no stylesheet diff and no `getComputedStyle` call can establish: task 9's review could not settle
    // from the diff whether CodeMirror gives two same-range mark decorations from two independent
    // `StateField`s ONE element carrying both classes or TWO nested elements, and the visual outcome
    // differs. One element means the cascade picks a single winner per property; two nested elements
    // mean the inner background composites over the outer's, and the inner `box-shadow: inset 0 -2px 0`
    // paints over the outer's in the same 2 px band.
    //
    // MEASURED IN REAL CHROMIUM by dumping the rendered line: it is TWO NESTED ELEMENTS, and the
    // running focus is the OUTER one —
    //
    //   <span class="is-focus-coincident"><span class="linked">
    //     <span class="tok-ident">x</span> <span class="tok-operator">+</span> <span class="tok-nat">2</span>
    //   </span></span>
    //
    // `linkMark` is declared BEFORE `focusMark` in `main.ts`'s extension list and lands INSIDE, so the
    // pin's own opaque `--link-edge` underline is the one that survives on top. What that looks like on
    // screen is recorded in the roadmap's `PLAN 5c CLOSES` entry, which is where the eyeball gate's
    // verdict lives — this assertion pins only the structure it depends on.
    const pin = document.querySelector('.cm-editor .linked')
    expect(pin?.textContent).toBe('x + 2')
    expect(pin?.classList.contains('is-focus-coincident'), 'nested, not merged into one element').toBe(false)
    expect(focusEls()[0]?.contains(pin ?? null), 'the pin sits inside the running focus’s element').toBe(true)
  }, 30_000)

  // THE TM LEG'S OWN RUNNING FOCUS, THROUGH THE RUNNING APP — the one of the three panes whose wiring
  // nothing observed. `focusedRows`, `sourceNodeOwner`, `isCoincident` and `linkStatus({focus: true})`
  // are each unit-tested in `tests/node/`, but until this case existed `main.ts`'s
  // `tmFocus`/`tmFocusLink` block could be replaced wholesale by `tmPane.setFocus([])` and the entire
  // suite still passed — no assertion anywhere reached `[data-leaf="tm-0"] .state-row.is-focus` at all. Verified by
  // making exactly that mutation while writing this: every assertion below the frontier fails under it,
  // and nothing else in the suite moves.
  //
  // MEASURED AGAINST THE RUNNING APP, NOT ASSUMED, the same way `SAMPLE`'s own owner sequence above
  // was. `let x = 40; x + 2` is 2,870 δ-steps, and its tail reads:
  //
  // ```text
  //   step 2,870   halt (accept)   no focus — `halt` is scaffolding, owned by no construct
  //   step 2,869   pc4             focus = {pc4}, the machine's own row and nothing else
  //   step 2,868   add5.d.w.wkh    focus = the `add5.d.*` block's headers, six of them in the window
  // ```
  //
  // WALKED BACKWARD FROM THE FRONTIER, for the reason `app.test.ts`'s δ-table tests give: `settled`
  // leaves the head at the frontier, where `▶` is a no-op, so `◀` is the only direction that moves. It
  // also puts the ABSENCE first — an accept state no construct owns — so "nothing is ever painted"
  // cannot satisfy what follows.
  it('lights the δ-table block the machine is running inside, and nothing when it is inside none', async () => {
    await settled(view, SAMPLE)
    expect(tmStepText()).toContain('step 2,870 of 2,870')
    expect(tmCurrentRow()?.textContent).toBe('halt')
    expect(tmFocusNames(), '`halt` belongs to no source construct, so nothing may be focused').toEqual([])

    // ONE ROW, AND IT IS THE MACHINE'S OWN. The narrowest true answer this leg can give, and the one a
    // "nearest enclosing linkable node" fallback could not produce — the shape 5b refused (`types.ts`'s
    // `Owner` doc). Asserted as element IDENTITY, not two matching queries: `.is-current` and
    // `.is-focus` must be the same row, which is a fact about the wiring rather than about the table.
    tmClick('◀')
    expect(tmStepText()).toContain('step 2,869')
    expect(tmFocusNames()).toEqual(['pc4'])
    expect(tmFocusRows()[0], 'the focused row is the row the machine is standing on').toBe(tmCurrentRow())

    // ONE MORE BACK AND THE FOCUS IS A BLOCK, NOT A ROW. `main.ts` resolves `source_node` to a node id
    // and then asks the index for EVERY state that node emitted, so a construct's whole δ block lights
    // at once — which is why this asserts a count above one rather than an exact set: the table is
    // virtualized, so only the block's states inside the rendered window can be in the DOM at all.
    tmClick('◀')
    expect(tmStepText()).toContain('step 2,868')
    const block = tmFocusRows()
    expect(block.length, 'a construct owns several states and all of them light').toBeGreaterThan(1)
    expect(tmFocusNames()).toContain(tmCurrentRow()?.textContent)
    // HEADERS ONLY — `focusedRows`'s own contract, and the one visible difference from `.is-linked`,
    // which marks a block's rule rows too (see the pin below).
    for (const row of block) {
      expect(row.classList.contains('is-state'), `${row.textContent} is a state header`).toBe(true)
      expect(row.classList.contains('is-rule')).toBe(false)
    }

    // AND THE BLOCK IS A REAL CONSTRUCT'S, NAMED BY THE SOURCE PANE. Clicking a focused header pins
    // whatever node it belongs to; the echo is `x + 2`, which identifies the focus by SOURCE TEXT
    // rather than by a state-naming convention this test would otherwise be asserting.
    block[0]?.click()
    await until(() => linkedSource() !== '')
    expect(linkedSource(), 'the focused block is `x + 2`’s own').toBe('x + 2')

    // THE COINCIDENCE, AND WHY THE STATUS LINE CARRIES IT ALONE ON THIS LEG. The pinned rows now carry
    // BOTH classes on one element — `.state-row.is-linked` and `.state-row.is-focus` set `background`
    // at equal specificity with `.is-focus` declared second and `.is-linked` setting nothing else, so
    // the focus wash simply replaces the pin's and a pinned-and-focused row is pixel-identical to a
    // focused-only one (`link-status.ts`'s `focus` doc). Nothing in the δ table says "the run reached
    // what you pinned"; `#link-status` is the whole signal, so it is asserted here.
    expect(tmFocusRows()[0]?.classList.contains('is-linked'), 'one row, both classes').toBe(true)
    expect(linkStatusText()).toContain('the machine is here right now')
  }, 30_000)

  // §5.1 THROUGH THE APP: `None` is common and correct, and a program that never leaves it must show
  // nothing rather than showing something wrong or falling over. `runningFocus` returns `null` for
  // `'None'` before it ever touches the index, so the failure this guards against is not a bad span —
  // it is a `draw()` that throws on the way to deciding there is nothing to draw, which would take the
  // pane with it on every one of the 432 `None` steps `while4` reports.
  //
  // NO LONGER "EVERY STEP", SINCE REGION-PATH TAGGING — see `SPARSELY_TAGGED`'s own doc for the full
  // account, and for why a fixture with a genuinely untagged EVERY step is no longer constructible from
  // this language's source syntax at all. Steps 1, 4 and 5 are still `None` and still carry the original
  // guarantee; steps 2 and 3 are asserted to their exact measured values rather than skipped, so a
  // regression in the tagging this slice added — silently reverting to `None`, or naming the wrong
  // construct — goes red here too, in the same fixture, rather than needing a second one.
  it('clears the focus on this program’s untagged steps, and never errors on the tagged ones either', async () => {
    await settledAtZero(SPARSELY_TAGGED)
    const before = pageErrors.length
    expect(resultsText(), 'the program still runs to an answer').toContain('β-steps')

    // MEASURED, NOT ASSUMED — see `SPARSELY_TAGGED`'s doc for how, and for the mechanism behind each
    // entry. A test tolerant enough to accept blanks at every step (the property this test used to
    // assert) would no longer notice `draw()` throwing on a TAGGED step, since two of these five no
    // longer are one; pinning all five keeps that mutation caught rather than only the `None` half.
    const expected = ['', 'exact:let mut n = 1;', 'exact:n = 2;', '', '']
    for (let i = 1; i <= 5; i += 1) {
      click('▶')
      expect(stepText()).toContain(`step ${i}`)
      expect(focusReading(), `step ${i} of ${JSON.stringify(SPARSELY_TAGGED)}`).toBe(expected[i - 1])
    }
    // Walked to the end, not stopped short of it: 5 β-steps is this program's whole run.
    expect(stepText()).toContain('step 5 of 5')
    expect(pageErrors.slice(before), 'no uncaught error or rejection while walking it').toEqual([])

    // The λ pane is still rendering frames throughout, on both the tagged and the untagged steps, so
    // neither "no focus" nor "a focus" is a dead pane.
    expect(document.querySelector('[data-leaf="lambda-0"] .term')?.textContent).not.toBe('')
  }, 30_000)
})
