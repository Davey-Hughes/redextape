/**
 * The failure surface for "the app did not start" — and ONLY that. Two cases qualify: `init()`
 * throwing (the wasm module never loaded) and the worker's own `error` event (its module never
 * loaded). Both mean nothing under `<main>` — not the editor, not either pane — was ever wired up, so
 * replacing all of it is the only honest answer.
 *
 * A THIRD CASE THAT USED TO LAND HERE AND MUST NOT: `worker-error`, a `Session` call that threw
 * AFTER the app started. `main.ts` answers that one with `showWorkerError` below instead — the editor
 * and both panes are alive and working at that point, and `root.replaceChildren` below would have
 * torn them out to report a problem that was already over, leaving the user unable to type again
 * until a reload. See `showWorkerError`'s doc for the rest of that split.
 *
 * PR 3c HAD NONE, and named the gap: if the worker or the wasm module fails to load, the page is
 * blank and the only evidence is a console message the user will not open. The design carries this
 * as a §6 row rather than a follow-up ticket because it is three lines and the alternative is a
 * blank page.
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
 * caller resets both legs' history and clears the decline mark before this ever renders), so this
 * says that plainly instead of pointing at a rebuild that would not help.
 */
export function workerErrorText(e: unknown): string {
  const detail = e instanceof Error ? e.message : typeof e === 'string' ? e : 'no detail available'
  return `redextape hit a problem and recovered: ${detail}. The editor is still live — keep typing, or edit the program, to try again.`
}

/**
 * Report a `worker-error` INTO `#results`, not over the page. `showBanner`'s `replaceChildren` is
 * right for "the app did not start" because nothing under `<main>` works yet; it is wrong here
 * because everything under `<main>` still does. `main.ts`'s `worker-error` arm calls this instead of
 * `showBanner`, after resetting both legs and clearing the decline mark — this only has to render the
 * message, not decide the rest of the response.
 */
export function showWorkerError(results: HTMLElement, e: unknown): void {
  const el = document.createElement('div')
  el.className = 'banner'
  el.setAttribute('role', 'alert')
  el.textContent = workerErrorText(e)
  results.replaceChildren(el)
}
