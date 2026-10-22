/**
 * The failure surface for "the app did not start" — and ONLY that. Two cases qualify: `init()`
 * throwing (the wasm module never loaded) and the worker's own `error` event (its module never
 * loaded). Both mean the app cannot run anything, so replacing every view — `main.ts` passes `#views`,
 * the layout's root, as `host` — is the only honest answer.
 *
 * A THIRD CASE MUST NOT LAND HERE: `worker-error`, a `Session` call that threw AFTER the app
 * started. That one is answered with `showWorkerError` below instead — the editor and every view
 * are alive and working at that point, and `host.replaceChildren` below would tear them out to
 * report a problem that is already over, leaving the user unable to type again until a reload. See
 * `showWorkerError`'s doc for the rest of that split.
 *
 * Without this banner, if the worker or the wasm module fails to load, the page is blank and the
 * only evidence is a console message the user will not open.
 *
 * IT NAMES THE FIX, NOT ONLY THE FAULT. By far the most likely cause on a fresh clone is that
 * `pkg/` has never been built, and a message that says only "failed to fetch" sends the reader to
 * the network tab instead of to the one command that fixes it.
 */
export function bannerText(e: unknown): string {
  const detail = e instanceof Error ? e.message : typeof e === 'string' ? e : 'no detail available'
  return `redextape did not start: ${detail}. If this is a fresh clone, run \`cd web && pnpm run build:wasm\` once — the app loads \`pkg/\` from the repo root and it is not checked in.`
}

/**
 * Replace the page with the banner. Separate from `bannerText` so the wording is node-testable and
 * the DOM write is not.
 */
export function showBanner(host: HTMLElement, e: unknown): void {
  const el = document.createElement('div')
  el.className = 'banner'
  el.setAttribute('role', 'alert')
  el.textContent = bannerText(e)
  host.replaceChildren(el)
}

/**
 * The wording for a `worker-error` — the app started fine; one request to it threw. Unlike
 * `bannerText`, there is no "run this command" fix to name: the remedy is already underway (the
 * caller resets every leg's history and clears the decline mark before this ever renders), so this
 * says that plainly instead of pointing at a rebuild that would not help.
 */
export function workerErrorText(e: unknown): string {
  const detail = e instanceof Error ? e.message : typeof e === 'string' ? e : 'no detail available'
  return `redextape hit a problem and recovered: ${detail}. The editor is still live — keep typing, or edit the program, to try again.`
}

/**
 * Report a `worker-error` INTO `#results`, not over the page. `showBanner`'s `replaceChildren` is
 * right for "the app did not start" because no view can run anything yet; it is wrong here because
 * every view still can. `replies.ts`'s `worker-error` arm records the failure with `setProgram`
 * instead of calling `showBanner`, after resetting every leg and clearing the decline mark, and
 * `readout.ts`'s `createReadout` is what calls this — so this only has to render the message, not
 * decide the rest of the response.
 */
export function showWorkerError(results: HTMLElement, e: unknown): void {
  const el = document.createElement('div')
  el.className = 'banner'
  el.setAttribute('role', 'alert')
  el.textContent = workerErrorText(e)
  results.replaceChildren(el)
}
