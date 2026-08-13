import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'

/**
 * **THE FORK, DRIVEN THROUGH THE APP** — design §4.3's detach, plan T8, from the control a user
 * clicks to the second session it registers and back.
 *
 * THIS IS THE TIER THAT WAS MISSING ONE TASK AGO, AND SAYING SO IS THE POINT. T7's own doc records
 * why every test it shipped built its registry by hand: "nothing in this slice can put a second
 * session in `main()`'s registry — a `LambdaScratch` needs a worker message `session-worker.ts` does
 * not have, and creating one on edit is §4.3, which is T8." This file is the app doing it.
 *
 * WHAT IT DOES NOT ASSERT, AND WHERE THAT LIVES INSTEAD. Neither `pool.size` nor a worker's liveness
 * is reachable from the DOM, and this app has ONE λ pane, so the singleton (which the plan required
 * be asserted on pool size, "not on rendering") and the terminate-on-retire claim are
 * `tests/node/scratch.test.ts` and `tests/browser/scratch-fork.test.ts` respectively. What is only
 * assertable here is the wiring: that a control exists, that clicking it moves this pane onto a
 * detached session seeded with the term it was showing, and how the pane comes home.
 *
 * **"AND THAT RECOMPILING BRINGS IT HOME" IS WHAT THAT SENTENCE USED TO END WITH, AND IT IS THE ONE
 * CLAIM IN THIS FILE 5d-ii-c DECISION 2 REVERSED.** A recompile from source used to retire the buffer
 * synchronously on the keystroke; nothing but an explicit retire ends a buffer now (design §4.3's
 * table), so STAGE 4 below asserts the pane STAYS on its buffer and STAGE 5 brings it home through the
 * selector — the affordance the retire used to pre-empt. `tests/browser/scratch-buffers.test.ts` is
 * where the lifetime rule itself is pinned.
 */

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

let view: EditorView

async function until(predicate: () => boolean, what: string, timeoutMs = 60_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const resultsText = () => document.querySelector('#results')?.textContent ?? ''
const term = () => document.querySelector('[data-leaf="lambda-0"] .term')?.textContent ?? ''
const step = () => document.querySelector('[data-leaf="lambda-0"] .step')?.textContent ?? ''
const heading = () => document.querySelector('[data-leaf="lambda-0"] h2')?.textContent ?? ''
const forkButton = () => document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')
const selector = () => document.querySelector<HTMLSelectElement>('[data-leaf="lambda-0"] .pane-binding select')
/**
 * The λ `<optgroup>`'s own options — WHICH SESSIONS OFFER A λ LEG, which is the question every
 * assertion in this file was really asking of the selector before it listed both legs.
 *
 * `select.options` FLATTENS THE GROUPS AWAY and would now answer with the TM group's entries mixed in,
 * so a fork that added nothing would still look right the moment the source session's TM leg was
 * counted. Reading the group by its own label is what keeps the assertion about λ.
 */
const lambdaOptionElements = () => [
  ...document.querySelectorAll<HTMLOptionElement>('[data-leaf="lambda-0"] .pane-binding optgroup[label="λ"] option'),
]
const lambdaOptions = () => lambdaOptionElements().map((o) => o.textContent)
/**
 * The `<option>` value the pane selector encodes a `(leg, session)` pair as — spelled out here rather
 * than imported from `pane-chrome.ts`, so this pins the DOM contract instead of agreeing with whatever
 * the control currently does. `\x00` as an escape is `scripts/check-text-bytes.sh`'s rule.
 */
const optionValue = (leg: string, id: string) => `${leg}\x00${id}`
const statusLine = () => document.querySelector('#link-status')?.textContent ?? ''

/** `app.test.ts`'s `settled`, and the same invariant argument applies — see its doc there. */
async function settled(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(
    () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== '',
    `the app to settle on \`${src}\``,
  )
}

const clickLambda = (label: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')].find(
    (x) => x.textContent === label,
  )
  if (b === undefined) throw new Error(`no \`${label}\` button in the λ pane`)
  b.click()
}

/**
 * Rewrite every BINDER-INTRODUCED name to a canonical `v<depth>`, leaving every other identifier
 * exactly as printed, so two prints of ALPHA-EQUIVALENT terms compare equal regardless of which
 * concrete fresh names the printer chose for their binders.
 *
 * **ADDED BY T8, AND THE FINDING IT RECORDS IS WORTH KEEPING.** This test used to compare `term()`
 * against `seed` with plain string equality — correct while the seed WAS the pane's own frame text
 * reparsed at `step: 0` (5d-i's stopgap), because that path never gave the printer's name generator a
 * reason to walk differently. Design §4.1 replaced that seed: the scratch's step 0 is now derived from
 * an INDEPENDENT print-parse-replay-print pipeline (`index.lambdaText` at `LAMBDA_BYTE_BUDGET`, replayed
 * to the step, re-printed — see `main.ts`'s `detach` handler) — a second, unrelated walk that is free to
 * assign fresh names in a different order. Measured directly: forking `let x = 40; x + 2` at step 2
 * produces the SAME term with two binder names swapped end to end (`λx0. ... f0 (f0 (... x))) ... λx. f
 * (f x)` against `λx. ... f0 (f0 (... x0))) ... λx0. f (f x0)`) — alpha-equivalent, not byte-identical.
 * `lambda/syntax.rs`'s own round-trip property (`parse_print_round_trips`) only promises print -> parse
 * -> print is stable for ONE walk; it makes no claim across two independent ones, and this diff is
 * exactly that gap. Canonicalizing both sides is the textual stand-in for "same term up to
 * alpha-equivalence" a browser test can check without a normalizer of its own.
 *
 * **REWRITTEN — code review found the first version over-normalised.** It matched every identifier
 * globally (`[a-zA-Z]` then any run of `[a-zA-Z0-9]`) and renamed EVERY one by first-appearance order,
 * free occurrences included, which is not what alpha-equivalence means and is not what the measured
 * divergence above needs. Two problems, both now fixed by construction rather than by a narrower regex:
 *
 *   1. **Free variables were renamed too**, so `f (g x)` and `g (f x)` — two different terms — both
 *      canonicalised to `v0 (v1 v2)` and compared equal. This function now renames ONLY a name at its
 *      binder (the identifier immediately after `λ`) and at USES that resolve to a binder currently in
 *      scope; a name with no enclosing binder is left exactly as printed, so two prints that are
 *      genuinely different keep looking different.
 *   2. **It was not scope-aware.** The real printer's `fresh()` (`lambda/syntax.rs`) only avoids
 *      collisions with binders CURRENTLY IN SCOPE (`self.names`, pushed on entering an `Abs` and popped
 *      on leaving it), so it may — and does — reuse one concrete name across two INDEPENDENT,
 *      non-nested binders. First-appearance numbering does not: it hands out a new number to every
 *      binder regardless of nesting, so `(λx.x)(λx.x)` (one name reused) and `(λx.x)(λy.y)` (two names)
 *      canonicalised to different strings despite being alpha-equivalent. This function numbers a
 *      binder by its NESTING DEPTH at the point it is introduced (how many binders already enclose it),
 *      not by how many DISTINCT names have been seen — so two independent top-level binders both become
 *      `v0`, matching how alpha-equivalence is normally decided (de Bruijn levels) rather than how the
 *      printer happens to have spelled either one.
 *
 * **A SINGLE LEFT-TO-RIGHT SCAN OVER THE PRINTER'S OWN GRAMMAR, NOT A FULL PARSE INTO AN AST.**
 * `print_lambda`'s output has exactly four kinds of token that matter here — `λ`, `.`, `(`, `)`, and
 * identifiers — and exactly one scoping rule: an `Abs`'s body (`Node::Abs` in `syntax.rs`) is
 * `Role::Term`, so it is never itself wrapped in parens and extends until the paren depth returns to
 * what it was when its `λ` was seen (or to the end of the string, for a binder at depth 0). That is
 * enough to track scope with a paren-depth counter and a stack, without building a tree:
 *
 *   - On `(` / `)`, adjust depth; on `)`, pop any binder frame opened at a depth this `)` just left.
 *   - On `λ`, remember that the NEXT identifier is a declaration.
 *   - On a declaration, assign `v<stack.length>` (depth-based, per problem 2 above), push
 *     `{ name, canon, openDepth: depth }`, and emit the canonical name.
 *   - On any OTHER identifier, search the stack innermost-first (correct shadowing: `λx. λx. x` refers
 *     to the INNER `x`) and emit its canonical name if found, or the identifier UNCHANGED if not
 *     (problem 1 above — nothing in scope claims it, so it is left alone).
 *
 * **WHAT THIS DOES NOT HANDLE, SAID PLAINLY.** It trusts the input to be `print_lambda`'s own grammar —
 * adversarial text with, say, redundant parens around a bare variable would not necessarily scope the
 * way this function assumes. That is not the same claim as "every caller feeds it real printer output":
 * the `describe('alphaCanonical', …)` tests below feed hand-typed literals, not a `term()` read off the
 * DOM — but every one of them is still valid instances of that grammar (properly paired parens, no
 * padding around a bare variable), so the assumption holds for them regardless of where the string came
 * from. `?<N>`-spelled genuinely free de Bruijn references (`syntax.rs`'s `write`,
 * the `Node::Var` arm's `unwrap_or_else`) do not match the identifier regex at all and are therefore
 * already left alone, which is the same answer scope-awareness gives everything else free — this
 * function never needs to special-case them.
 */
function alphaCanonical(printedTerm: string): string {
  type Frame = { name: string; canon: string; openDepth: number }
  const scope: Frame[] = []
  let depth = 0
  let declaring = false
  return printedTerm.replace(/λ|[a-zA-Z][a-zA-Z0-9]*|[()]/g, (tok) => {
    if (tok === 'λ') {
      declaring = true
      return tok
    }
    if (tok === '(') {
      depth += 1
      return tok
    }
    if (tok === ')') {
      depth -= 1
      for (let top = scope.at(-1); top !== undefined && top.openDepth > depth; top = scope.at(-1)) {
        scope.pop()
      }
      return tok
    }
    // An identifier: a fresh declaration right after `λ`, or a use to resolve against the scope stack.
    if (declaring) {
      declaring = false
      const canon = `v${scope.length}`
      scope.push({ name: tok, canon, openDepth: depth })
      return canon
    }
    for (let i = scope.length - 1; i >= 0; i -= 1) {
      const frame = scope[i]
      if (frame !== undefined && frame.name === tok) return frame.canon
    }
    return tok
  })
}

describe('the fork control, end to end', () => {
  // ONE MOUNT FOR THE FILE, for `app.test.ts`'s reason: ES module imports are cached, so `main()` runs
  // once per page and Vitest gives each test FILE its own page.
  beforeAll(async () => {
    // THE LAYOUT KEY IS SHARED ACROSS THE WHOLE BROWSER TIER — every test file gets its own page but
    // the same origin, so a file that persists a tree leaves it for whichever file mounts next.
    // `main()` reads this key ONCE, while resolving `let tree`, so it has to be cleared before the
    // import below and not in a `beforeEach`. `scratch-buffers.test.ts` is where the argument lives:
    // it is the file that first stored a tree with one of `defaultLayout()`'s own leaves missing, and
    // this file's `[data-leaf="lambda-0"]` lookups all answered `null` under it.
    localStorage.removeItem(LAYOUT_STORAGE_KEY)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(
      () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== '',
      'the first compile',
    )
  })

  /**
   * THE WHOLE CYCLE IN ONE `it`, WHICH IS A SEQUENCING DECISION RATHER THAN LAZINESS. The states are
   * ordered — there is no scratchpad to retire until one has been forked, and no fork until the app
   * has compiled — and `beforeAll` mounts one app for the file, so splitting them into four `it`s
   * would make each depend on the previous having run, which is the shared-mutable-fixture failure
   * `app.test.ts` documents in its own nested-`describe` note. Every stage below asserts before it
   * acts.
   */
  it('forks the λ pane onto a buffer seeded with the term it was showing, keeps it across a recompile, and comes home through the selector', async () => {
    await settled('let x = 40; x + 2')

    // STAGE 1 — attached, and the app looks exactly as T7 left it, modulo one gate T8 removed and one
    // control T7's own successor widened. The fork control is present because the pane is attached —
    // it no longer also requires the frame to be whole (`LambdaPane.#refreshDetach`'s `frame.cut`
    // check came out in T8; `scratch-fork.test.ts`'s "forks a truncated frame" `describe` is the test
    // that would catch its return).
    //
    // **THE SELECTOR IS ON SCREEN HERE, AND THIS ASSERTION USED TO SAY IT WAS ABSENT** — "the selector
    // is absent because one session offers λ (`bindingSelect`'s 'not shown at all below two
    // options')". The threshold counts `(leg, session)` PAIRS now, and the source session has both
    // legs, so it clears two on its own. The claim that sentence was really making — that only ONE
    // session offers λ until a fork happens — is what the λ group's own contents say, and that is what
    // is asserted instead. `main.ts`'s note on registering the source session carries the same
    // correction.
    expect(heading()).toBe('lambda')
    expect(lambdaOptions()).toEqual(['source'])
    expect(forkButton()).not.toBeNull()

    // Two steps in, so the seed is a term the SOURCE SESSION IS NOT AT STEP 0 OF. §4.3 seeds with
    // "that pane's current text", and a fork taken at step 0 would produce a scratchpad
    // indistinguishable from the source's own λ leg — the whole claim would render identically either
    // way, which is the trap the plan names for the singleton test and it applies here too.
    //
    // `↺` FIRST, BECAUSE A SETTLED PANE IS AT THE FRONTIER AND NOT AT THE START. Recording pushes the
    // play head along with it, so `let x = 40; x + 2` finishes at `step 7 of 7` and `▶` there means
    // "record one more" — which for an `ended` leg is nothing at all. `restart` seeks to the oldest
    // retained frame, which is step 0 exactly until eviction has happened (`controlStrip`'s own note).
    clickLambda('↺')
    clickLambda('▶')
    clickLambda('▶')
    const seed = term()
    expect(step()).toContain('step 2 of')
    expect(seed).not.toBe('')

    // STAGE 2 — the fork. Everything up to the first reply is synchronous, so this is asserted
    // without a wait: the pane is on the scratchpad, says so, and has a selector to come back with.
    clickLambda('✎ fork')

    expect(heading()).toContain('[detached]')
    // §4.5's OTHER SURFACE, and the pairing is the point: the badge is the glanceable one and the
    // status line is the authoritative narration. `main.ts`'s `detachedPanes` reads the same
    // `SessionEntry.detached` the badge does, so the two cannot disagree.
    expect(statusLine()).toContain('λ pane detached')
    // The control is gone, because a pane already on the scratchpad has nothing to fork — and the
    // selector is the affordance for the same intent that still works: it is how a user comes back.
    // It did not ARRIVE here, which this comment used to say. Since the control started listing
    // `(leg, session)` pairs it has been on screen since STAGE 1; what the fork changed is the λ
    // group's contents, asserted two lines below.
    expect(forkButton()).toBeNull()
    const select = selector()
    if (select === null) throw new Error('the pane selector should be on screen from the first paint')
    // THE λ GROUP, NOT `select.options`, WHICH FLATTENS THE GROUPS AWAY. The TM group is beside it and
    // holds the source session's TM leg, which this stage says nothing about; what the fork changed is
    // the λ group, and naming the group is what keeps this assertion about the fork.
    //
    // **THE SECOND ENTRY IS A MINTED NAME, WHERE THIS LINE USED TO READ `'λ scratchpad'`.** That was
    // the label `main.ts` gave its one fixed scratch session, written down before the session existed;
    // 5d-ii-c decision 1 makes a fork mint the buffer AND its name together (`ScratchBuffers.fork`), so
    // the label is `scratch N` and N counts the forks this page has performed. The shape is asserted
    // rather than the number for the reason `main()`-per-FILE makes unavoidable: N is a function of
    // every earlier test's forks, so pinning it would make this test fail for something another test
    // did. The GROUP'S LENGTH is what carries the claim the old line carried — one fork, one new λ
    // session, not two and not none.
    const buffer = lambdaOptionElements()[1]
    expect(lambdaOptions()).toHaveLength(2)
    expect(lambdaOptions()[0]).toBe('source')
    expect(lambdaOptions()[1]).toMatch(/^scratch \d+$/)
    // AND THE PANE IS ON IT — against the option element the app itself built, not against a name this
    // file guessed. The second line is what stops that from being satisfied by the pane having stayed
    // where it was: `optionValue('lambda', 'source')` is the one λ pair whose id this file can still
    // write down, and it is the value the selector held one line before the fork.
    expect(select.value).toBe(buffer?.value)
    expect(select.value).not.toBe(optionValue('lambda', 'source'))
    // BEFORE ANY REPLY: the leg exists and has nothing in it yet, and the step readout says which of
    // those two it is. `controlState` renders `reason` while `!available`, which is what
    // `ScratchBuffers` seeds the leg's status with rather than leaving it `''`.
    expect(step()).toBe('building…')
    expect(term()).toBe('')

    // STAGE 3 — the scratchpad reduces, on its own thread, from the term the pane was showing.
    //
    // **FIVE STEPS, NOT SEVEN, AND THAT NUMBER IS THE FORK.** The source session's λ leg is seven
    // β-steps end to end; this scratchpad was seeded at its step 2, so it has exactly the remaining
    // five to do. A fork that quietly re-ran the whole program — or one that showed the source's own
    // leg under a new name — would read `of 7` here. `doneText` appends nothing for `'ended'` and the
    // trailing `…` is `controls.ts`'s "more can still be recorded", so waiting for its absence is
    // waiting for the reduction to finish rather than for a frame to exist.
    await until(() => step().startsWith('step') && !step().endsWith('…'), 'the scratchpad to finish reducing')
    expect(step()).toBe('step 5 of 5')

    // And its step 0 is the (alpha-equivalent) term the pane was showing when the button was clicked
    // — not `seed` byte-for-byte, and that is §4.1 rather than a slip: the scratch's step 0 is
    // RE-DERIVED, from the source's own step-0 print replayed forward, not read off the frame `seed`
    // came from — see `alphaCanonical`'s doc above for the diff this comparison would otherwise trip
    // on.
    clickLambda('↺')
    expect(step()).toBe('step 0 of 5')
    expect(alphaCanonical(term())).toBe(alphaCanonical(seed))

    // STAGE 4 — A RECOMPILE FROM SOURCE LEAVES THE BUFFER ALONE, AND THIS STAGE USED TO ASSERT THE
    // EXACT OPPOSITE. It read "recompile from source retires it. Synchronous on the keystroke", and
    // checked `heading()` back to `lambda`, the status line without `detached`, and `lambdaOptions()`
    // down to `['source']` — the registry having genuinely lost a session. 5d-ii-c decision 2 (design
    // §4.3's table: "recompile from source: ended it -> **survives**") deletes that retire, so a
    // keystroke in the source editor is no longer an event in the buffer's life at all. The same three
    // surfaces are read here, inverted, plus the term — because a buffer that survived the keystroke
    // and was silently re-seeded from the new program would satisfy all three and still have thrown
    // the user's work away.
    const bufferTerm = term()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 5' } })

    // SYNCHRONOUSLY, because that is when the retire used to happen — before the debounce was armed.
    expect(heading()).toContain('[detached]')
    expect(statusLine()).toContain('λ pane detached')
    expect(lambdaOptions()).toHaveLength(2)
    expect(select.value).toBe(buffer?.value)

    await until(
      () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText().includes('45'),
      'the recompile',
    )
    // AND AFTER THE SOURCE HAS ACTUALLY RECOMPILED — 45, which is the new program's own answer, so the
    // keystroke reached `schedule` rather than doing nothing. The pane is still detached, still on the
    // same buffer, and still at the buffer's step 0: not the source's newly recorded leg, and not a
    // re-seed of the buffer from it.
    expect(heading()).toContain('[detached]')
    expect(select.value).toBe(buffer?.value)
    expect(step()).toBe('step 0 of 5')
    expect(term()).toBe(bufferTerm)
    // The fork control stays away for the reason it went away: this pane is still on a buffer.
    expect(forkButton()).toBeNull()

    // STAGE 5 — THE WAY HOME IS THE SELECTOR, which is the affordance STAGE 4's retire used to
    // pre-empt, and the assertions below are the ones that stage used to make about the source leg.
    // `scratch-rebind-editor.test.ts` is where the editor's half of this rebind is pinned.
    select.value = optionValue('lambda', 'source')
    select.dispatchEvent(new Event('change'))

    expect(heading()).toBe('lambda')
    expect(statusLine()).not.toContain('detached')
    // The pane is showing the SOURCE session's newly recorded leg — at its frontier, with no trailing
    // `…`, which is a leg that ran to its end rather than the buffer's leftovers. The fork control is
    // back for the same reason it went away: this pane is attached again.
    expect(forkButton()).not.toBeNull()
    expect(step()).toMatch(/^step \d+ of \d+$/)
    expect(term()).not.toBe('')
    expect(term()).not.toBe(bufferTerm)
    // **AND THE BUFFER IS STILL THERE, WHICH IS THE HALF A REBIND IS NOT.** Coming home moves the pane;
    // it ends nothing, so the λ group still offers the buffer to go back to. Under the old behaviour
    // this list was `['source']` by now and there was nothing to go back to.
    expect(lambdaOptions()).toHaveLength(2)
    expect(lambdaOptionElements()[1]?.value).toBe(buffer?.value)
  })
})

/**
 * **`alphaCanonical` ON ITS OWN — code review's finding that the helper above over-normalised, pinned
 * directly rather than only through the end-to-end fork test that happens not to exercise free
 * variables.** The two cases below are exactly the two problems that doc comment names, plus the
 * positive case the helper exists for in the first place.
 */
describe('alphaCanonical', () => {
  it('canonicalises the measured λx0./λx. divergence: two independent prints of one alpha-equivalent term', () => {
    // The shape T8 actually measured (`f (f x)` under two different fresh-name choices for the SAME
    // structure), reduced to a size this test can write by hand rather than reproducing the exact
    // 40+2 fixture's full text.
    const a = 'λx0. λf0. f0 (f0 x0)'
    const b = 'λx. λf. f (f x)'
    expect(alphaCanonical(a)).toBe(alphaCanonical(b))
    expect(alphaCanonical(a)).toBe('λv0. λv1. v1 (v1 v0)')
  })

  it('does NOT conflate structurally different terms that share no binders — the free-variable finding', () => {
    // Problem 1: the old regex renamed every identifier by first-appearance order regardless of
    // whether a binder ever introduced it, so these two — genuinely different terms, an application
    // chain read one way and the other — both canonicalised to `v0 (v1 v2)`.
    const left = alphaCanonical('f (g x)')
    const right = alphaCanonical('g (f x)')
    expect(left).not.toBe(right)
    // And free names are not renamed at all: nothing here is bound by any `λ`.
    expect(left).toBe('f (g x)')
    expect(right).toBe('g (f x)')
  })

  it('reuses a canonical name across two INDEPENDENT, non-nested binders — the scope-awareness finding', () => {
    // Problem 2: `fresh()` (`lambda/syntax.rs`) only avoids collisions with binders CURRENTLY IN
    // SCOPE, so it is free to print the SAME name for two binders that never enclose one another. A
    // first-appearance counter does not know that and hands out a new number to each; a depth-based
    // one — what this function does now — assigns both `v0`, since neither is nested inside the other.
    expect(alphaCanonical('(λx. x) (λx. x)')).toBe(alphaCanonical('(λx. x) (λy. y)'))
    expect(alphaCanonical('(λx. x) (λy. y)')).toBe('(λv0. v0) (λv0. v0)')
  })

  it('resolves a shadowed name to its INNERMOST enclosing binder, not an outer one of the same spelling', () => {
    // `λx. (λx. x) x`: the inner `x` (inside the nested abstraction) refers to the inner binder; the
    // trailing `x` (the argument, back in the outer binder's body) refers to the outer one. Innermost-
    // first resolution is what a real interpreter does for shadowing, and it is what tells the two
    // apart here even though both are spelled identically in the source text.
    expect(alphaCanonical('λx. (λx. x) x')).toBe('λv0. (λv1. v1) v0')
  })
})
