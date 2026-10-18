import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, type LayoutNode, serializeLayout, splitLeaf } from '../../src/layout'
import { parseWorkspace } from '../../src/workspace'
import { lambdaLeaves, leafIds, SHELL, splitRow } from './harness'

/**
 * THE RESTORE-FROM-STORAGE PATH, THROUGH `main()` — the branch's only exercise of it.
 *
 * `main()` resolves its tree with `parseWorkspace(readLayoutStorage()) ?? defaultWorkspace(viewsShape())` (a
 * version 1 layout is migrated), and until this
 * file that expression had only ever taken the fallback: `layout-app.test.ts` and
 * `two-lambda-panes.test.ts` both mounted onto an empty `Storage` then, by design, so every browser test in the
 * suite booted from `defaultLayout()`. Everything a restored tree can carry that a default one cannot was
 * therefore untested wiring.
 *
 * **CRITICAL FINDING, WHOLE-BRANCH REVIEW BEFORE MERGE: THE FIRST SPLIT AFTER A RELOAD SILENTLY DID
 * NOTHING.** `main.ts`'s `leafCounter` started at 1 and its comment reasoned only about
 * `defaultLayout()`'s ids (`lambda-0`, `tm-0`) — but a RESTORED tree can already hold `lambda-1` from a
 * split in an earlier page load, and `splitLeaf`'s collision guard then refused the id `nextLeafId`
 * minted. The click threw out of its own handler, no pane appeared, and nothing on screen said why. A
 * SECOND click worked, because the refused attempt had still incremented the counter — which is what
 * made it look intermittent rather than systematic.
 *
 * IT NO LONGER SUBSTITUTES ITS OWN `Storage` — every browser test file gets one automatically now,
 * installed in `tests/browser/setup.ts` before this file's own module body runs. That file's doc carries
 * the argument this paragraph used to make in full: why a private `Storage` is forced rather than
 * fastidious, and why clearing the shared key was not enough. What is left here is just the seeding,
 * straight through `localStorage`, which is that per-file shim by the time this line runs.
 */

/**
 * The tree `defaultLayout()` returned before the asm view joined it (Plan 7 part 5 spec §3, row 4): source and
 * λ side by side above TM.
 *
 * **SPELLED OUT RATHER THAN TAKEN FROM A DEFAULT, BECAUSE THE ENTRY IT STANDS IN FOR IS OLDER THAN THE
 * ASM VIEW.** `STORED` below is a version 1 layout, which only a build from before the version 2 workspace could
 * have written, and no such build had an asm leaf to write. Built from today's default, the fixture would be a
 * stored tree no real page ever held. Spelled this way it also carries the spec's own claim about stored
 * layouts — still valid, arrangement kept, not migrated to the new default — which the first case below reads
 * off the page.
 */
const PRE_ASM_DEFAULT: LayoutNode = {
  kind: 'split',
  dir: 'column',
  sizes: [0.5, 0.5],
  children: [
    {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [
        { kind: 'leaf', id: 'source', pane: 'source' },
        { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
      ],
    },
    { kind: 'leaf', id: 'tm-0', pane: 'tm' },
  ],
}

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
const STORED = serializeLayout(splitLeaf(PRE_ASM_DEFAULT, 'lambda-0', 'row', 'lambda-1', 'lambda'))

// SEEDED BEFORE THE MOUNT, not in a `beforeEach` — `main()` reads the key exactly once, synchronously,
// while resolving `let tree`, so anything written after that read is never seen. Same reason every
// sibling file gives for clearing it here rather than there.
beforeAll(async () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, STORED)
  // WIDE ENOUGH TO SPLIT A VIEW THAT IS ITSELF HALF OF A SPLIT: the app refuses a split that leaves a view under
  // `MIN_VIEW_PX` (`layout.ts`), and the stored tree's `lambda-0`, half of a split with `lambda-1`, split again makes
  // two of 149.5 px at 1280 and 189.5 at 1600.
  // The runner's default 896 px height is kept.
  await page.viewport(1600, 896)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
})

describe('a layout restored from storage', () => {
  it('mounts the stored arrangement rather than falling back to the default', () => {
    // NOT THE DEFAULT'S TWO: a fallback would show the source and `tm-0` alone.
    expect(leafIds()).toEqual(['source', 'lambda-0', 'lambda-1', 'tm-0'])
  })

  // BEFORE THE SPLIT BELOW, WHICH REWRITES THE STORED TREE: this reads what the migration wrote, and
  // after that test the stored tree also holds `pane-2`.
  it('rewrites the migrated layout as version 2, the tree intact', () => {
    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}')
    expect(stored.version).toBe(2)
    expect(stored.switches).toEqual({ steps: 'view', views: 'tiles', readout: 'strip' })
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.tree).toEqual(JSON.parse(STORED).tree)
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
   * would. `PRE_ASM_DEFAULT`'s own `lambda-0`/`tm-0` contribute suffix `0` and would leave the counter
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
    // the "another view of this" entry), not two attempts. That distinction is the point: a SECOND split always worked
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
