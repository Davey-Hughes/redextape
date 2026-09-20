import { beforeAll, describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY } from '../../src/buffers-store'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

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

/** The notice line's text — where the storage report rests since Plan 7 part 2 (spec §11). */
const noticeText = (): string => document.querySelector('#notice .notice-text')?.textContent ?? ''
const resultsText = (): string => document.querySelector('#results')?.textContent ?? ''
const forkButton = () => document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .detach')

/** The title-selector of `leaf`'s view — the pair in force is its `data-binding`. */
const titleOf = (leaf: string) => document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-title`)

/** Pick `key` (`bindingKey(leg, session)`) through `leaf`'s title menu, as a user does. */
function pickBinding(leaf: string, key: string): void {
  const title = titleOf(leaf)
  if (title === null) throw new Error(`no title-selector on [data-leaf="${leaf}"]`)
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const item = menu?.querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
  if (item == null) {
    const offered = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b) => b.dataset.binding)
    throw new Error(`[data-leaf="${leaf}"] offers no ${JSON.stringify(key)} — offered: ${JSON.stringify(offered)}`)
  }
  item.click()
}

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
  // THE LONGEST SINGLE WAIT IN THE BROWSER TIER, AND IT DELIBERATELY HAS NO OVERRIDE. This `beforeAll`
  // is the one in the suite that pays for `main()`'s own wasm `init()` with no sibling in the file
  // having amortised it already, so expect it to be the slowest first compile anywhere in the tier. It
  // used to carry a local `30_000` for that reason; `harness.ts`'s shared default covers it, and that
  // was measured rather than assumed — the whole tier passes with that default lowered to 2,000 ms,
  // this wait included.
  await until(
    () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== '',
    'the first compile',
  )
})

describe('a full store', () => {
  /**
   * **THE SECOND FAILING WRITE IS THE FORK'S OWN `scratch-compiled` REPLY, NOT A SECOND CLICK — A
   * DEVIATION FROM THE SKETCH IN `2026-08-16-plan5d-ii-d-persisted-buffers.md`, AND THE REASON IS
   * WORTH RECORDING.** That plan's illustration clicks the fork control twice in a row. That does not
   * reach a second write at all: the first fork detaches the view, and a view showing a copy offers no
   * *edit a copy* (`LambdaPane`'s `#refreshDetach`: `!this.#detached`), so a literal second click finds
   * nothing and is a silent no-op — the assertions after it would hold vacuously.
   *
   * **THE FORK'S OWN REPLY IS A SECOND WRITE FOR FREE.** `replies.ts`'s `onScratchReply` calls
   * `onBuffersPersist()` on the `scratch-compiled` reply the copy's worker sends back (`main.ts`'s own
   * doc on `refreshBuffers`: "a recorded term" is one of the three moments that reach `persistBuffers`
   * directly) — after the SAME gesture, on the SAME view. Waiting for it is the same signal
   * `scratch-fork.test.ts`'s truncated-frame test uses: `.term-editor` mounts in the SAME handler,
   * synchronously before `onBuffersPersist()` runs — the `scratch-compiled` arm's own `setEditor` call,
   * reached through `editorHome` — so its arrival is proof the second persist has already been
   * attempted. **`setEditor` IS `lambda-pane.ts`'s `LambdaPane` METHOD, NOT ANYTHING `replies.ts`
   * DEFINES, and this sentence said otherwise until the whole-branch review.** It read
   * `` `replies.ts`'s `LambdaPane.setEditor` ``, which sends a reader grepping `replies.ts` for a  check-attributions: allow
   * definition that has never been there.
   *
   * **WHAT THE OLD VERSION OF THIS TEST PROVED, AND WHY IT NO LONGER CAN.** The report used to be a
   * once-per-page-load flag written onto `#link-status`, so the question was whether a second failing
   * write RESTATED it, and the discriminating stage was a second fork whose success cleared the field
   * first. Plan 7 part 2 made the report the notice line's RESTING STATE (`notice.ts`'s `Notices.rest`,
   * `main.ts`'s `reportStorageFailure`): setting it twice with the same words is a no-op by
   * construction, so "reported twice" is not a state this app can reach, and the flag is gone. What is
   * worth holding now is what the resting state promises — said once when the condition begins, and on
   * the line whenever nothing else is being said.
   */
  it('says the condition once, however many writes fail, and lets the gesture speak', async () => {
    refuseWrites = true
    // EVERY SENTENCE THE LIVE REGION SAYS, IN ORDER — a single read of `#live` holds only the latest, and
    // what this test is about is how many times one sentence is said. `notice.ts`'s `say` rewrites the
    // element's text for every notice, so each write is one record.
    const said: string[] = []
    const live = document.querySelector('#live')
    if (live === null) throw new Error('no live region')
    const observer = new MutationObserver(() => said.push(live.textContent?.trim() ?? ''))
    observer.observe(live, { childList: true, characterData: true, subtree: true })

    const fork = forkButton()
    if (fork === null) throw new Error('no edit-a-copy control on the λ view')
    fork.click()
    // The copy's own reply is the second failing write — see this block's doc.
    await until(() => document.querySelector('[data-leaf="lambda-0"] .term-editor') !== null, "the copy's own reply")
    observer.disconnect()

    const storage = said.filter((t) => t.includes('not being saved'))
    expect(storage, `said: ${JSON.stringify(said)}`).toHaveLength(1)
    expect(storage[0]).toBe('copies are not being saved — this browser’s storage for this site is full')
    // THE GESTURE STILL SPEAKS FOR ITSELF: a condition that lasts does not take the line from the notice
    // the user's own click produced.
    expect(noticeText()).toBe('λ copy 1 created — this view shows it')
  })

  /**
   * **THE ONE LONG WAIT IN THIS FILE, AND IT IS A CLOCK RATHER THAN A COMPUTATION.** The line returns to
   * the resting state when the notice over it ends, which is `NOTICE_MS` — eight seconds — after that
   * notice was made. Nothing in the app shortens it and fake timers cannot reach a timeout the app
   * created before they were installed, so this test waits it out, alone in its own body: that is the
   * rule #99 established after a body carrying three long waits timed out on the slower CI runner.
   */
  it('returns to the storage warning when the notice over it ends', async () => {
    await until(
      () => noticeText() === 'copies are not being saved — this browser’s storage for this site is full',
      'the notice line to fall back to the storage warning',
    )
    expect(document.querySelector<HTMLElement>('#notice')?.hidden).toBe(false)
  })

  /**
   * **AND IT GOES WHEN THE CONDITION DOES.** `writeBuffersStorage` clears the resting state on a write
   * that succeeds, because a warning that outlives its condition teaches a reader to ignore the line.
   */
  /**
   * **A CONDITION THAT COMES BACK IS NOT NEWS TWICE.** A write refused by size succeeds and fails by
   * turns, so this cycle is ordinary; the line follows the condition, the live region says it once.
   */
  it('shows the warning again without saying it again', async () => {
    const live = document.querySelector('#live')
    if (live === null) throw new Error('no live region')
    refuseWrites = false
    pickBinding('lambda-0', bindingKey('lambda', 'source'))
    await until(() => document.querySelector<HTMLElement>('#notice')?.hidden === true, 'the warning to clear')

    const said: string[] = []
    const observer = new MutationObserver(() => said.push(live.textContent?.trim() ?? ''))
    observer.observe(live, { childList: true, characterData: true, subtree: true })
    refuseWrites = true
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    // THE GESTURE'S OWN NOTICE, NOT THE RESTING STATE: the line comes back to the warning when this
    // notice ends, eight seconds later, and a body that waits that out beside another wait is the shape
    // #99 took out of this tier. What this test is about is the live region, which is immediate.
    await until(() => noticeText().endsWith('created — this view shows it'), "the copy's own notice")
    observer.disconnect()
    expect(
      said.filter((t) => t.includes('not being saved')),
      `said: ${JSON.stringify(said)}`,
    ).toHaveLength(0)
  })

  it('clears the warning once a write succeeds', async () => {
    refuseWrites = false
    pickBinding('lambda-0', bindingKey('lambda', 'source'))
    await until(() => document.querySelector<HTMLElement>('#notice')?.hidden === true, 'the warning to clear')
    expect(noticeText()).toBe('')
  })
})
