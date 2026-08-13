import { beforeAll, describe, expect, it } from 'vitest'
import { defaultLayout, LAYOUT_STORAGE_KEY, serializeLayout, splitLeaf } from '../../src/layout'

/**
 * THE RESTORE-FROM-STORAGE PATH, THROUGH `main()` — the branch's only exercise of it.
 *
 * `main()` resolves its tree with `parseLayout(readLayoutStorage()) ?? defaultLayout()`, and until this
 * file that expression had only ever taken the fallback: `layout-app.test.ts` and
 * `two-lambda-panes.test.ts` both clear `localStorage` before mounting, by design, so every browser
 * test in the suite booted from `defaultLayout()`. Everything a restored tree can carry that a default
 * one cannot was therefore untested wiring.
 *
 * **CRITICAL FINDING, WHOLE-BRANCH REVIEW BEFORE MERGE: THE FIRST SPLIT AFTER A RELOAD SILENTLY DID
 * NOTHING.** `main.ts`'s `leafCounter` started at 1 and its comment reasoned only about
 * `defaultLayout()`'s ids (`lambda-0`, `tm-0`) — but a RESTORED tree can already hold `lambda-1` from a
 * split in an earlier page load, and `splitLeaf`'s collision guard then refused the id `nextLeafId`
 * minted. The click threw out of its own handler, no pane appeared, and nothing on screen said why. A
 * SECOND click worked, because the refused attempt had still incremented the counter — which is what
 * made it look intermittent rather than systematic.
 *
 * IT SUBSTITUTES ITS OWN `Storage` RATHER THAN WRITING THE SHARED ONE, AND THAT IS FORCED RATHER THAN
 * FASTIDIOUS. `localStorage` is scoped to an ORIGIN, not to a test file, and Vitest runs browser files
 * concurrently in one origin (the suite's wall-clock duration is less than half the sum of its per-file
 * test time). Writing a split tree into the real store would be visible to every sibling that mounts
 * `main()` without clearing the key first — `app.test.ts`, `running-focus.test.ts`, `scratch-fork.test.ts`
 * and the rest all assume the shipped three-pane arrangement — and the reverse race is just as real:
 * those two files clear this key from their own `beforeEach`, at points spread across the whole run, so
 * a value seeded here could be deleted between this file's write and `main()`'s read. Replacing
 * `window.localStorage` for THIS IFRAME ONLY (each browser test file gets its own window; the backing
 * store is what they share) makes what `main()` reads at mount a fact this file owns. The shim is a
 * complete in-memory `Storage`, so `appearance.ts`'s own reads and writes work normally through it.
 */

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

const cell = new Map<string, string>()
const shim: Storage = {
  get length() {
    return cell.size
  },
  clear: () => cell.clear(),
  getItem: (k: string) => cell.get(k) ?? null,
  key: (i: number) => [...cell.keys()][i] ?? null,
  removeItem: (k: string) => {
    cell.delete(k)
  },
  setItem: (k: string, v: string) => {
    cell.set(k, v)
  },
}
Object.defineProperty(window, 'localStorage', { value: shim, configurable: true })

/**
 * A once-split tree, built with the app's OWN `splitLeaf` and `serializeLayout` rather than a
 * hand-written literal.
 *
 * That keeps the fixture honest in one direction — the stored string is exactly what `serializeLayout`
 * produces for a real split tree, so `parseLayout` accepting it proves something about the app rather
 * than about this file's arithmetic on `sizes` — and `lambda-1` IS PASSED IN EXPLICITLY, NOT MINTED,
 * on purpose, in the other: `nextLeafId` no longer mints ids shaped like this at all. It minted
 * `${leg}-${n}` (so `lambda-1`, first split) until `main.ts`'s rename to `pane-${n}` (that same file's
 * own doc on `nextLeafId` has the reason: a pane can change which leg it renders, so a name like
 * `lambda-3` can end up describing something the pane is not). This literal is what a REAL
 * `localStorage` entry from a build before that rename would still contain — the fixture stands in for
 * that entry, and `lambda-1` has to be spelled the old way for it to. The split test below relies on
 * exactly this: it restores a tree carrying the OLD spelling and then mints the NEW one, which is why
 * it is the one place in this file that exercises `seedLeafCounter` against both at once — see its own
 * doc.
 */
const STORED = serializeLayout(splitLeaf(defaultLayout(), 'lambda-0', 'row', 'lambda-1', 'lambda'))

const leafIds = () => [...document.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf ?? '')
/**
 * The ids of every λ pane — by `data-kind`, NOT by an `id` prefix. `nextLeafId` now mints `pane-${n}`
 * regardless of which leg the split came from (`main.ts`'s own doc on `nextLeafId`: a pane can change
 * which leg it renders, so an id like `lambda-3` would describe something the pane is not), so
 * `dataset.kind` is the only truthful statement of what a leaf renders left to select on. This matters
 * MORE in this file than in its siblings: `STORED` below deliberately seeds a leaf spelled the OLD way
 * (`lambda-1`), so an id-prefix filter would still find it by luck while silently missing a freshly
 * split leaf spelled the new way (`pane-N`) — the exact mismatch this file exists to restore correctly.
 */
const lambdaLeaves = () =>
  [...document.querySelectorAll<HTMLElement>('[data-kind="lambda"]')].map((e) => e.dataset.leaf ?? '')
const splitRowOn = (leaf: string) =>
  document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button[aria-label="split left and right"]`)

/**
 * Split `leaf` into a second pane of the same kind on the same session — `layout-app.test.ts`'s
 * `splitRow`, verbatim, and its doc carries the argument: the control opens a picker now, whose first
 * entry is the pane's own pair labelled `(same)`, so the gesture that used to be one click is two and
 * still means what it meant. The label is checked rather than assumed, because a silent no-op here would
 * leave the test below asserting a split that never happened.
 */
const splitRow = (leaf: string): void => {
  const button = splitRowOn(leaf)
  if (button === null) throw new Error(`no split control on [data-leaf="${leaf}"]`)
  button.click()
  const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
  const first = menu?.querySelector<HTMLButtonElement>('button') ?? null
  if (first === null || !(first.textContent ?? '').endsWith('(same)')) {
    throw new Error(`${leaf}'s split menu does not start with the duplicate case: ${first?.textContent}`)
  }
  first.click()
}

// SEEDED BEFORE THE MOUNT, not in a `beforeEach` — `main()` reads the key exactly once, synchronously,
// while resolving `let tree`, so anything written after that read is never seen. Same reason every
// sibling file gives for clearing it here rather than there.
beforeAll(async () => {
  cell.set(LAYOUT_STORAGE_KEY, STORED)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
})

describe('a layout restored from storage', () => {
  it('mounts the stored arrangement rather than falling back to the default', () => {
    expect(leafIds()).toEqual(['source', 'lambda-0', 'lambda-1', 'tm-0'])
  })

  /**
   * THE MIXED-SPELLING CASE — `seedLeafCounter` MUST ADVANCE PAST BOTH ID SPELLINGS, NOT JUST ONE, AND
   * THIS IS THE ONE TEST IN THE FILE THAT PUTS BOTH IN PLAY AT ONCE.
   *
   * `STORED` restores a tree carrying the OLD spelling (`lambda-1`, from before `main.ts`'s rename of
   * `nextLeafId`); the click below mints under the NEW one (`pane-${n}`). Because the two spellings are
   * disjoint namespaces, an under-seeded counter could never produce a `splitLeaf` collision BY NAME
   * here — `pane-1` and `lambda-1` are different strings even if the counter never saw the stored leaf
   * at all. What an under-seed produces instead is a WRONG NUMBER: `seedLeafCounter` reads the digits
   * after a leaf id's last `-` regardless of which word precedes them (`main.ts`'s own doc on
   * `nextLeafId`), specifically so a restored `lambda-1` still advances the counter the way a `pane-1`
   * would. `defaultLayout()`'s own `lambda-0`/`tm-0` contribute suffix `0` and would leave the counter
   * at 1 by themselves; only seeing `lambda-1`'s `1` pushes it to 2. So `pane-2` is the one id that
   * proves the stored leaf's suffix was actually seen — `pane-1` would mean it was not, and would still
   * pass a uniqueness check today only because nothing else in this small tree happens to want `pane-1`
   * yet.
   *
   * THE FILE'S OWN CRITICAL FINDING (above) IS THE SAME MECHANISM UNDER A DIFFERENT SPELLING. It was
   * found against `${leg}-${n}` ids, before `nextLeafId` was renamed to mint `pane-${n}`; the rename did
   * not change what `seedLeafCounter` has to do — see every leaf actually in the tree — only which
   * strings the tree can contain. A restored tree spelled the old way is exactly the drift that
   * requirement has to survive without a change to `main.ts`, and this test is what still asserts it.
   */
  it('splits into a fresh id rather than colliding with one the stored tree already carries', () => {
    // ONE SPLIT, AND ONLY ONE — the two clicks inside `splitRow` are one gesture (open the picker, take
    // the `(same)` entry), not two attempts. That distinction is the point: a SECOND split always worked
    // even before the fix, because the refused attempt had still incremented the counter, so a test that
    // retried would pass against the bug it exists to catch.
    splitRow('lambda-0')

    const lambdas = lambdaLeaves()
    expect(lambdas.length).toBe(3)
    // IDS ARE ASSERTED UNIQUE, not merely counted. `splitLeaf`'s guard is what stops a duplicate id
    // reaching the tree; if a later change removed the guard instead of fixing the caller, the count
    // above would pass and the second `lambda-1` would be silently unreachable — the exact failure
    // that guard's own doc says it exists to prevent.
    expect(new Set(lambdas).size).toBe(lambdas.length)
    // THE STORED LEAF IS STILL THERE, spelled the old way — this split adds a pane, it does not rename
    // one — and the NEW pane is spelled `pane-2`, not `pane-1` and not `lambda-2`: `pane-1` would mean
    // `seedLeafCounter` never saw `lambda-1`'s suffix, and `lambda-2` is not a spelling `nextLeafId`
    // mints anymore.
    expect(lambdas).toContain('lambda-1')
    expect(lambdas).toContain('pane-2')
  })
})
