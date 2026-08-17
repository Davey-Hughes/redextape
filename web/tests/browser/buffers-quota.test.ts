import { beforeAll, describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY } from '../../src/buffers-store'

/**
 * **THE QUOTA REPORT — design §4.8, the one place this slice breaks symmetry with the layout writer.**
 * `main.ts`'s `writeLayoutStorage` swallows a failed write on the stated argument that a layout is a
 * preference and the page still works for the rest of the load. `writeBuffersStorage` does not: a buffer
 * is a user's work, and a user told nothing finds out at the next reload, by absence. This file is the
 * one exercise of the report that surface produces.
 *
 * **ITS OWN FILE, FOR THE ONE-MOUNT-PER-FILE REASON EVERY SIBLING GIVES.** It needs `localStorage.setItem`
 * to throw for the buffers key from partway through the app's own lifetime, which is a different store
 * than any sibling file wants — `layout-restore.test.ts` and `scratch-cap.test.ts` both need every write
 * to succeed.
 *
 * **THE SHIM IS INSTALLED BY `tests/browser/setup.ts` NOW, NOT BY THIS FILE.** Every browser test file
 * gets its own in-memory `Storage` automatically, before this file's own module body runs (that file's
 * own doc has the argument). What this file adds on top, at module scope so it is in place before
 * `main()` ever calls `localStorage.setItem`, is a wrapper around the INSTALLED shim's `setItem` that
 * refuses one key on command — `Object.defineProperty`'s `configurable: true` on `window.localStorage`
 * is what makes replacing a single method on it possible without touching `setup.ts`.
 *
 * **ONLY THE BUFFERS KEY REFUSES.** A wrapper that threw for every key would take `writeAppearanceStorage`
 * and `writeLayoutStorage` down with it too — both guard their own `localStorage` calls and both would
 * swallow silently, so the failure would not be visible as a *test* failure, only as a fact about the
 * page nobody asserted — and the claim under test is about one writer's policy on a browser that still
 * has storage for everything else, not about a browser with none at all.
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

async function until(predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

const linkStatus = (): string => document.querySelector('#link-status')?.textContent ?? ''
const resultsText = (): string => document.querySelector('#results')?.textContent ?? ''
const forkButton = () => document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .detach')

/**
 * Whether the next `localStorage.setItem` for `BUFFERS_STORAGE_KEY` throws — `false` until a test turns
 * it on, so the app's own start-up writes (the two unconditional persists in `main()`, both empty on a
 * page with no restored buffers) go through untouched.
 */
let refuseWrites = false
const passthroughSetItem = localStorage.setItem.bind(localStorage)
localStorage.setItem = (key: string, value: string): void => {
  if (refuseWrites && key === BUFFERS_STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError')
  passthroughSetItem(key, value)
}

beforeAll(async () => {
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(
    () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== '',
    'the first compile',
    // A wider budget than this file's own default: this is the one test in the suite that pays for
    // `main()`'s own wasm `init()` without a sibling in the file having paid it already.
    30_000,
  )
})

describe('a full store', () => {
  /**
   * **THE SECOND FAILING WRITE IS THE FORK'S OWN `scratch-compiled` REPLY, NOT A SECOND CLICK — A
   * DEVIATION FROM THE BRIEF'S OWN SNIPPET, AND THE REASON IS WORTH RECORDING.** The brief's illustration
   * clicks `[data-leaf="lambda-0"] .detach` twice in a row. That does not reach a second write at all:
   * the first fork detaches the pane, and a detached pane offers no fork (`LambdaPane`'s
   * `#refreshDetach`: `!this.#detached`), so a literal second click on the same selector finds nothing
   * and is a silent no-op — the assertions after it would hold vacuously, proving only that nothing
   * happened twice.
   *
   * A second click that WAS wired to something real would prove the wrong thing anyway. Both other
   * candidates change `#link-status` for an unrelated reason and would make the comparison fail for a
   * reason that has nothing to do with `storageFailureReported`: a second fork clears `forkFailed` on
   * its own success before it persists (`transport.ts`'s `detach`: "a fresh attempt retires yesterday's
   * news"), and the binding selector's rebind back to `source` un-detaches this pane, which drops the
   * `· λ pane detached — not linked to source` clause `link-status.ts` composes independently of
   * `forkFailed` (found by writing exactly that version of this test and watching it fail on the
   * detachment clause, not on the storage one).
   *
   * **THE FORK'S OWN REPLY IS A SECOND WRITE FOR FREE, AND IT DISTURBS NEITHER.** `replies.ts`'s
   * `onScratchReply` calls `onBuffersPersist()` on the `scratch-compiled` reply the forked worker sends
   * back (`main.ts`'s own doc on `refreshBuffers`: "a recorded term" is one of the three moments that
   * reach `persistBuffers` directly) — after the SAME fork, on the SAME still-detached pane, touching
   * neither `forkFailed` nor `detached`. Waiting for it is the same signal
   * `scratch-fork.test.ts`'s truncated-frame test uses: `.term-editor` mounts in the SAME handler,
   * synchronously before `onBuffersPersist()` runs (`replies.ts` lines 325-341), so its arrival is proof
   * the second persist has already been attempted.
   */
  it('reports once, and the report survives further writes', async () => {
    refuseWrites = true

    // Fork, which persists (`onBuffersChanged` -> `refreshBuffers` -> `persistBuffers`) and therefore
    // fails.
    const fork = forkButton()
    if (fork === null) throw new Error('no fork control on the λ pane')
    fork.click()
    await until(() => linkStatus().includes('not being saved'), 'the storage report')

    const first = linkStatus()
    expect(first.match(/not being saved/g)).toHaveLength(1)

    // The fork's own worker answers with the term it derived, which persists a second time — see the
    // doc above for why this is the write under test rather than a second click.
    await until(
      () => document.querySelector('[data-leaf="lambda-0"] .term-editor') !== null,
      "the scratch's own reply, and its persist",
      60_000,
    )

    // Unchanged, not appended to.
    expect(linkStatus()).toBe(first)
    expect(linkStatus().match(/not being saved/g)).toHaveLength(1)

    /**
     * **THE DISCRIMINATING STAGE — 5d-ii-d review round 2, Finding 2.** Both assertions above pass
     * whether or not `storageFailureReported` actually guards the second write: `linkStatus`
     * (`link-status.ts`) recomposes the WHOLE line from the one `forkFailed` field it is handed, so a
     * report delivered a second time writes the IDENTICAL string as a report delivered once, and
     * `toBe(first)` / `toHaveLength(1)` cannot tell "guarded" from "coincidentally the same" apart. A
     * SECOND, GENUINELY NEW FORK can: `transport.ts`'s `detach` handler clears `forkFailed` on its own
     * SUCCESS path, before its own `persistBuffers()` call — so if the guard is doing its job, that
     * write's failure has nothing left to restate and the clear stands; if the guard is missing,
     * `reportStorageFailure()` fires again and overwrites the clear with the storage phrase, on a page
     * that just forked successfully.
     *
     * BACK TO SOURCE FIRST — a detached pane offers no fork control at all (`LambdaPane`'s
     * `#refreshDetach`: `!this.#detached`), so a second fork needs the same rebind
     * `scratch-cap.test.ts`'s `backToSource` performs before one is reachable. `\x00` as an escape
     * rather than the byte, that file's own rule (`scripts/check-text-bytes.sh`).
     */
    const select = document.querySelector<HTMLSelectElement>('[data-leaf="lambda-0"] .pane-binding select')
    if (select === null) throw new Error('no binding selector on the λ pane')
    select.value = 'lambda\x00source'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await until(() => forkButton() !== null, 'the fork control to come back with the source binding')

    // THE SECOND FORK. Its own `scratch-compiled` reply persists a second time, exactly as the first
    // fork's did above — `.term-editor` mounting again (torn down by the rebind above, per
    // `pane-host.ts`'s `rebind`) is proof that write was attempted, guard or no guard.
    const secondFork = forkButton()
    if (secondFork === null) throw new Error('no fork control after the rebind to source')
    secondFork.click()
    await until(
      () => document.querySelector('[data-leaf="lambda-0"] .term-editor') !== null,
      "the second fork's own reply, and its persist",
      60_000,
    )

    // **WITH THE GUARD: THE REPORT DOES NOT RESTATE, AND THE LINE READS EXACTLY WHAT A SECOND,
    // SUCCESSFUL FORK LEAVES BEHIND.** The pane this fork just rebound is, by construction, detached —
    // `ScratchBuffers`'s own doc: every scratch session is `detached: true` and nothing can set it
    // otherwise — so `λ pane detached — not linked to source` is the honest, positive answer for this
    // exact moment, not a bare absence of the storage phrase. WITHOUT the guard, `persistBuffers`'s
    // second failure calls `reportStorageFailure()` again, which overwrites the `null` the fork's own
    // success path just wrote, and the storage phrase comes back ahead of the detachment clause.
    expect(linkStatus()).toBe('λ pane detached — not linked to source')
  })
})
