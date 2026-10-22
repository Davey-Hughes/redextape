import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { bindingKey } from '../../src/view-header'
import {
  clickLambda,
  focusProgram,
  forkButton,
  idle,
  lambdaHeading,
  lambdaStepText,
  lambdaTermText,
  lambdaTitle,
  linkStatus,
  resultsText,
  SHELL,
  settled,
  titleOf,
  until,
} from './harness'
import { lambdaSettled } from './lambda-text'

/**
 * **THE FORK, DRIVEN THROUGH THE APP** — 5d-i design §4.3's detach, from the control a user clicks to
 * the second session it registers and back.
 *
 * WHAT IT DOES NOT ASSERT, AND WHERE THAT LIVES INSTEAD. Neither `pool.size` nor a worker's liveness
 * is reachable from the DOM, so the terminate-on-retire claim is `tests/browser/scratch-fork.test.ts`'s.
 * What is only assertable here is the wiring: that a control exists, that clicking it moves this pane
 * onto a detached session seeded with the term it was showing, and how the pane comes home.
 *
 * Nothing but an explicit retire ends a buffer (5d-ii-c design §4.3's table), so STAGE 4 below asserts
 * the pane STAYS on its buffer across a recompile and STAGE 5 brings it home through the selector.
 * `tests/browser/scratch-buffers.test.ts` is where the lifetime rule itself is pinned.
 */

let view: EditorView

/**
 * The title menu's λ items, as `{ key, text }` — WHICH SESSIONS OFFER A λ LEG. Opens and closes
 * the menu to read it.
 *
 * FILTERED BY KEY, because the menu lists asm and TM pairs too, so a fork that added nothing would still look
 * right the moment one of the source session's other legs was counted. Reading the λ keys is what keeps the
 * assertion about λ.
 */
const lambdaItems = (): { key: string; text: string }[] => {
  const title = lambdaTitle()
  if (title === null) return []
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const items = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .map((b) => ({ key: b.dataset.binding ?? '', text: b.textContent ?? '' }))
    .filter((i) => i.key.startsWith('lambda:'))
  menu?.hidePopover()
  return items
}
const lambdaItemTexts = () => lambdaItems().map((i) => i.text)
/** Pick `key` (`bindingKey(leg, session)`) through the λ view's title menu, as a user does. */
function pickBinding(leaf: string, key: string): void {
  const title = titleOf(leaf)
  if (title === null) throw new Error(`no title-selector on [data-leaf="${leaf}"]`)
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const item = menu?.querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
  if (item == null) throw new Error(`[data-leaf="${leaf}"] offers no ${JSON.stringify(key)}`)
  item.click()
}

/**
 * Rewrite every BINDER-INTRODUCED name to a canonical `v<depth>`, leaving every other identifier
 * exactly as printed, so two prints of ALPHA-EQUIVALENT terms compare equal regardless of which
 * concrete fresh names the printer chose for their binders.
 *
 * The scratch's step 0 is derived from an INDEPENDENT print-parse-replay-print pipeline
 * (5d-iii design §4.1: `index.lambdaText` at `LAMBDA_BYTE_BUDGET`, replayed to the step, re-printed —
 * see `transport.ts`'s `detach` handler) — a second, unrelated walk that is free to assign fresh
 * names in a different order. Measured directly: forking `let x = 40; x + 2` at step 2 produces the
 * SAME term with two binder names swapped end to end (`λx0. ... f0 (f0 (... x))) ... λx. f (f x)`
 * against `λx. ... f0 (f0 (... x0))) ... λx0. f (f x0)`) — alpha-equivalent, not byte-identical.
 * `lambda/syntax.rs`'s own round-trip property (`print_is_idempotent_prop`) only promises print ->
 * parse -> print is stable for ONE walk; it makes no claim across two independent ones, and this diff
 * is exactly that gap. Canonicalizing both sides is the textual stand-in for "same term up to
 * alpha-equivalence" a browser test can check without a normalizer of its own.
 *
 * Two rules, both held by construction rather than by a narrower regex, because renaming every
 * identifier by first-appearance order, free occurrences included, is not what alpha-equivalence means:
 *
 *   1. **Free variables are not renamed.** Renaming them would canonicalise `f (g x)` and `g (f x)` —
 *      two different terms — both to `v0 (v1 v2)`, and they would compare equal. This function renames
 *      ONLY a name at its binder (the identifier immediately after `λ`) and at USES that resolve to a
 *      binder currently in scope; a name with no enclosing binder is left exactly as printed, so two
 *      prints that are genuinely different keep looking different.
 *   2. **It is scope-aware.** The real printer's `fresh()` (`lambda/syntax.rs`) only avoids
 *      collisions with binders CURRENTLY IN SCOPE (`self.names`, pushed on entering an `Abs` and popped
 *      on leaving it), so it may — and does — reuse one concrete name across two INDEPENDENT,
 *      non-nested binders. First-appearance numbering hands out a new number to every binder
 *      regardless of nesting, so `(λx.x)(λx.x)` (one name reused) and `(λx.x)(λy.y)` (two names) would
 *      canonicalise to different strings despite being alpha-equivalent. This function numbers a
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
 *   - On a declaration, assign `v<stack.length>` (depth-based, per rule 2 above), push
 *     `{ name, canon, openDepth: depth }`, and emit the canonical name.
 *   - On any OTHER identifier, search the stack innermost-first (correct shadowing: `λx. λx. x` refers
 *     to the INNER `x`) and emit its canonical name if found, or the identifier UNCHANGED if not
 *     (rule 1 above — nothing in scope claims it, so it is left alone).
 *
 * **WHAT THIS DOES NOT HANDLE, SAID PLAINLY.** It trusts the input to be `print_lambda`'s own grammar —
 * adversarial text with, say, redundant parens around a bare variable would not necessarily scope the
 * way this function assumes. That is not the same claim as "every caller feeds it real printer output":
 * the `describe('alphaCanonical', …)` tests below feed hand-typed literals, not a `lambdaTermText()` read off the
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
  return printedTerm.replace(/λ|[a-zA-Z][a-zA-Z0-9]*|[().]/g, (tok) => {
    if (tok === 'λ') {
      declaring = true
      return tok
    }
    // THE `.` ENDS A BINDER LIST, NOT THE FIRST NAME AFTER `λ`: the λ view writes curried binders merged,
    // `λa b c.` (Plan 7 part 4 spec §5.1), and every name in that list is a declaration.
    if (tok === '.') {
      declaring = false
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
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(idle, 'the first compile')
  })

  /**
   * THE WHOLE CYCLE IN ONE `it`, WHICH IS A SEQUENCING DECISION RATHER THAN LAZINESS. The states are
   * ordered — there is no scratchpad until one has been forked, and no fork until the app has
   * compiled — and `beforeAll` mounts one app for the file, so splitting them into separate `it`s
   * would make each depend on the previous having run. Every stage below asserts before it acts.
   */
  it('forks the λ pane onto a buffer seeded with the term it was showing, keeps it across a recompile, and comes home through the selector', async () => {
    await settled(view, 'let x = 40; x + 2')

    // STAGE 1 — attached. The fork control is present because the pane is attached, whether or not the
    // frame is whole (`scratch-fork.test.ts`'s "forks a truncated frame" `describe` holds that).
    //
    // **THE SELECTOR IS ON SCREEN HERE**: it lists `(leg, session)` pairs, and the source session's own
    // legs cross its two-option threshold with nothing forked (`main.ts`'s note on registering the
    // source session). What this stage asserts of it is that only ONE session offers λ until a fork
    // happens, which is what the λ group's own contents say.
    expect(lambdaHeading()).toBe('λ · program')
    expect(lambdaItemTexts()).toEqual(['λ · program'])
    expect(forkButton()).not.toBeNull()

    // Two steps in, so the seed is a term the SOURCE SESSION IS NOT AT STEP 0 OF. The copy starts on the
    // term at the pane's step (5d-iii design §4.1), and a fork taken at step 0 would produce a scratchpad
    // indistinguishable from the source's own λ leg — the whole claim would render identically
    // either way.
    //
    // `↺` FIRST, so the walk starts at step 0 whatever an earlier gesture left the pane on. A run opens
    // there too (`History`). `restart` seeks to the oldest retained frame, which is step 0 exactly until
    // eviction has happened (`stepControls`' own note).
    clickLambda('↺')
    clickLambda('▶')
    clickLambda('▶')
    await lambdaSettled()
    const seed = lambdaTermText()
    expect(lambdaStepText()).toContain('step 2 of')
    expect(seed).not.toBe('')

    // STAGE 2 — the fork. Everything up to the first reply is synchronous, so this is asserted
    // without a wait: the pane is on the scratchpad, says so, and has a selector to come back with.
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()

    expect(lambdaHeading()).toContain('copy · not linked')
    // 5d-i design §4.5's OTHER SURFACE, and the pairing is the point: the badge is the glanceable one and
    // the status line is the authoritative narration. `link-wiring.ts`'s `detachedPanes` reads the same
    // `SessionEntry.detached` the badge does, so the two cannot disagree.
    expect(linkStatus()).toContain('λ view shows a copy')
    // The control is gone, because a pane already on the scratchpad has nothing to fork — and the
    // selector is the affordance for the same intent that still works: it is how a user comes back.
    // It has been on screen since STAGE 1; what the fork changed is the λ group's contents,
    // asserted below.
    expect(forkButton()).toBeNull()
    const title = lambdaTitle()
    if (title === null) throw new Error('the pane selector should be on screen from the first paint')
    // THE λ GROUP. The asm and TM groups follow it and hold the source session's asm and TM legs, which
    // this stage says nothing about; what the fork changed is the λ group, and naming the group is what
    // keeps this assertion about the fork.
    //
    // **THE SECOND ENTRY IS A MINTED NAME.** A fork mints the buffer AND its name together (5d-ii-c
    // decision 1, `ScratchBuffers.fork`), so the label is `λ · copy N` and N counts the forks this
    // page has performed. The shape is asserted rather than the number for the reason
    // `main()`-per-FILE makes unavoidable: N is a function of every earlier test's forks, so pinning
    // it would make this test fail for something another test did. The GROUP'S LENGTH is what
    // carries the claim — one fork, one new λ session, not two and not none.
    const buffer = lambdaItems()[1]
    expect(lambdaItemTexts()).toHaveLength(2)
    expect(lambdaItemTexts()[0]).toBe('λ · program')
    expect(lambdaItemTexts()[1]).toMatch(/^λ · copy \d+$/)
    // AND THE PANE IS ON IT — against the item the app itself built, not against a name this
    // file guessed. The second line is what stops that from being satisfied by the pane having stayed
    // where it was: `bindingKey('lambda', 'source')` is the one λ pair whose id this file can still
    // write down, and it is the value the selector held one line before the fork.
    expect(title.dataset.binding).toBe(buffer?.key)
    expect(title.dataset.binding).not.toBe(bindingKey('lambda', 'source'))
    // BEFORE ANY REPLY: the leg exists and has nothing in it yet, and the step readout says which of
    // those two it is. `controlState` renders `reason` while `!available`, which is what
    // `ScratchBuffers` seeds the leg's status with rather than leaving it `''`.
    expect(lambdaStepText()).toBe('building…')
    expect(lambdaTermText()).toBe('')

    // STAGE 3 — the scratchpad reduces, on its own thread, from the term the pane was showing.
    //
    // **FIVE STEPS, NOT SEVEN, AND THAT NUMBER IS THE FORK.** The source session's λ leg is seven
    // β-steps end to end; this scratchpad was seeded at its step 2, so it has exactly the remaining
    // five to do. A fork that quietly re-ran the whole program — or one that showed the source's own
    // leg under a new name — would read `of 7` here. `doneText` appends nothing for `'ended'` and the
    // trailing `…` is `controls.ts`'s "more can still be recorded", so waiting for its absence is
    // waiting for the reduction to finish rather than for a frame to exist.
    await until(
      () => lambdaStepText().startsWith('step') && !lambdaStepText().endsWith('…'),
      'the scratchpad to finish reducing',
    )
    // ON ITS STEP 0, where a run opens (`History`), with all five recorded.
    expect(lambdaStepText()).toBe('step 0 of 5')

    // And its step 0 is the (alpha-equivalent) term the pane was showing when the button was clicked
    // — not `seed` byte-for-byte, and that is 5d-iii design §4.1 rather than a slip: the scratch's
    // step 0 is RE-DERIVED, from the source's own step-0 print replayed forward, not read off the
    // frame `seed` came from — see `alphaCanonical`'s doc above for the diff this comparison would
    // otherwise trip on.
    clickLambda('↺')
    expect(lambdaStepText()).toBe('step 0 of 5')
    await lambdaSettled()
    // WHITESPACE SQUEEZED OUT: the copy's names can be longer (`x0` where the program printed `x`), so the
    // same term can break across lines where the program's did not, and a line break is not a space.
    expect(alphaCanonical(lambdaTermText()).replace(/\s/g, '')).toBe(alphaCanonical(seed).replace(/\s/g, ''))

    // STAGE 4 — A RECOMPILE FROM SOURCE LEAVES THE BUFFER ALONE (5d-ii-c design §4.3's table: "recompile
    // from source: ended it -> **survives**"), so a keystroke in the source editor is not an event in the
    // buffer's life at all. Three surfaces are read — the heading, the status line and the λ group —
    // plus the term, because a buffer that survived the keystroke and was silently re-seeded from the
    // new program would satisfy all three and still have thrown the user's work away.
    const bufferTerm = lambdaTermText()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 5' } })

    // SYNCHRONOUSLY, because that is when a retire on the keystroke would happen —
    // before the debounce is armed.
    expect(lambdaHeading()).toContain('copy · not linked')
    expect(linkStatus()).toContain('λ view shows a copy')
    expect(lambdaItemTexts()).toHaveLength(2)
    expect(title.dataset.binding).toBe(buffer?.key)

    focusProgram()
    await until(
      () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText().includes('45'),
      'the recompile',
    )
    // AND AFTER THE SOURCE HAS ACTUALLY RECOMPILED — 45, which is the new program's own answer, so the
    // keystroke reached `schedule` rather than doing nothing. The pane is still detached, still on the
    // same buffer, and still at the buffer's step 0: not the source's newly recorded leg, and not a
    // re-seed of the buffer from it.
    expect(lambdaHeading()).toContain('copy · not linked')
    expect(title.dataset.binding).toBe(buffer?.key)
    expect(lambdaStepText()).toBe('step 0 of 5')
    expect(lambdaTermText()).toBe(bufferTerm)
    // The fork control stays away for the reason it went away: this pane is still on a buffer.
    expect(forkButton()).toBeNull()

    // STAGE 5 — THE WAY HOME IS THE SELECTOR. `scratch-rebind-editor.test.ts` is where the editor's
    // half of this rebind is pinned.
    pickBinding('lambda-0', bindingKey('lambda', 'source'))

    expect(lambdaHeading()).toBe('λ · program')
    expect(linkStatus()).not.toContain('shows a copy')
    // The pane is showing the SOURCE session's newly recorded leg — on its step 0, with no trailing
    // `…`, which is a leg that ran to its end rather than the buffer's leftovers. The fork control is
    // back for the same reason it went away: this pane is attached again.
    expect(forkButton()).not.toBeNull()
    expect(lambdaStepText()).toMatch(/^step \d+ of \d+$/)
    expect(lambdaTermText()).not.toBe('')
    expect(lambdaTermText()).not.toBe(bufferTerm)
    // **AND THE BUFFER IS STILL THERE, WHICH IS THE HALF A REBIND IS NOT.** Coming home moves the pane;
    // it ends nothing, so the λ group still offers the buffer to go back to.
    expect(lambdaItemTexts()).toHaveLength(2)
    expect(lambdaItems()[1]?.key).toBe(buffer?.key)
  })
})

/**
 * **`alphaCanonical` ON ITS OWN, pinned directly rather than only through the end-to-end fork test,
 * which does not exercise free variables.** The cases below are the positive case the helper exists
 * for, the two rules its doc comment names, and a shadowed name.
 */
describe('alphaCanonical', () => {
  it('canonicalises the measured λx0./λx. divergence: two independent prints of one alpha-equivalent term', () => {
    // The shape of the divergence `alphaCanonical`'s doc measured (`f (f x)` under two different
    // fresh-name choices for the SAME structure), reduced to a size this test can write by hand rather
    // than reproducing the exact 40+2 fixture's full text.
    const a = 'λx0. λf0. f0 (f0 x0)'
    const b = 'λx. λf. f (f x)'
    expect(alphaCanonical(a)).toBe(alphaCanonical(b))
    expect(alphaCanonical(a)).toBe('λv0. λv1. v1 (v1 v0)')
  })

  it('does NOT conflate structurally different terms that share no binders: free names stay as printed', () => {
    // Rule 1: renaming every identifier by first-appearance order, whether or not a binder ever
    // introduced it, would canonicalise these two — genuinely different terms, an application chain
    // read one way and the other — both to `v0 (v1 v2)`.
    const left = alphaCanonical('f (g x)')
    const right = alphaCanonical('g (f x)')
    expect(left).not.toBe(right)
    // And free names are not renamed at all: nothing here is bound by any `λ`.
    expect(left).toBe('f (g x)')
    expect(right).toBe('g (f x)')
  })

  it('reuses a canonical name across two INDEPENDENT, non-nested binders: binders are numbered by depth', () => {
    // Rule 2: `fresh()` (`lambda/syntax.rs`) only avoids collisions with binders CURRENTLY IN
    // SCOPE, so it is free to print the SAME name for two binders that never enclose one another. A
    // first-appearance counter does not know that and hands out a new number to each; a depth-based
    // one — this function — assigns both `v0`, since neither is nested inside the other.
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
