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
 * That is what keeps the fixture honest in both directions: the stored string is exactly what the app
 * writes after one split (so `parseLayout` accepting it proves something about the app rather than
 * about this file's arithmetic on `sizes`), and the id it carries — `lambda-1` — is exactly the id
 * `nextLeafId` mints first, which is the collision under test rather than a chosen one.
 */
const STORED = serializeLayout(splitLeaf(defaultLayout(), 'lambda-0', 'row', 'lambda-1'))

const leafIds = () => [...document.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf ?? '')
const lambdaLeaves = () => leafIds().filter((id) => id.startsWith('lambda'))
const splitRowOn = (leaf: string) =>
  document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button[aria-label="split left and right"]`)

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

  it('splits into a fresh id rather than colliding with one the stored tree already carries', () => {
    // ONE CLICK, AND ONLY ONE. The second click always worked even before the fix, so a test that
    // retried would pass against the bug it exists to catch.
    splitRowOn('lambda-0')?.click()

    const lambdas = lambdaLeaves()
    expect(lambdas.length).toBe(3)
    // IDS ARE ASSERTED UNIQUE, not merely counted. `splitLeaf`'s guard is what stops a duplicate id
    // reaching the tree; if a later change removed the guard instead of fixing the caller, the count
    // above would pass and the second `lambda-1` would be silently unreachable — the exact failure
    // that guard's own doc says it exists to prevent.
    expect(new Set(lambdas).size).toBe(lambdas.length)
    expect(lambdas).toContain('lambda-2')
  })
})
