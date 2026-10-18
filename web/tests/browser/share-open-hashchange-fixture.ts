import type { EditorView } from '@codemirror/view'
import { PROGRAM_STORAGE_KEY, parseProgram, serializeProgram } from '../../src/program-store'
import type { SharePayload } from '../../src/share-link'
import { defaultWorkspace, PRESETS, serializeWorkspace } from '../../src/workspace'
import { readout, SHELL, stateIdle, until } from './harness'

/**
 * The setup `share-open-hashchange-encoding.test.ts` and `share-open-hashchange-encoding-binary.test.ts` share: the
 * programs and the `ternary` link they paste, the page's controls they read, every `run` the page posts, and the mount
 * onto a stored program, which differs between the two only in the encoding it is stored under.
 * `program-quota-return.test.ts` and `program-restore.test.ts` take its `stored`, and `share-open-hashchange.test.ts`
 * and `share-open-latest.test.ts` its `workspaceName`.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names end in
 * `.test.ts`, and this one does not.
 */

/** The program the page is on before the first paste. */
export const PAGE = 'let x = 40; x + 2'
export const LINKED = 'let y = 10; y + 5'
/** A program no paste before the one carrying it put in the editor. */
export const OTHER = 'let z = 3; z + 4'
/** The link: `ternary`, which this build lacks, and the Debugger preset's workspace, which the page is not in. */
export const LINK: SharePayload = {
  program: LINKED,
  encoding: 'ternary',
  workspace: serializeWorkspace({ ...defaultWorkspace('wide'), switches: PRESETS.debugger }),
  positions: {},
}
export const LEFT_OUT = "opened a shared link's program — its encoding, workspace and step positions were left out"

export const workspaceName = () => document.querySelector('#workspace')?.textContent
/** The program storage holds: the last write that went through. */
export const stored = () => parseProgram(localStorage.getItem(PROGRAM_STORAGE_KEY), ['unary', 'binary'])

/** Every compile the page has posted, in order: the text and the encoding of each `run` request. */
export const runs: { src: string; encoding: string }[] = []
const post = Worker.prototype.postMessage
/** The compiles posted since `from` was `runs.length`, once one carrying `src` is among them. */
export async function postedSince(
  from: number,
  src: string,
  what: string,
): Promise<{ src: string; encoding: string }[]> {
  await until(() => runs.slice(from).some((r) => r.src === src), what)
  return runs.slice(from)
}

/**
 * Hear each `run` the page posts into `runs`, store `PAGE` under `encoding`, mount the app, and wait for the first
 * compile's readout. Returns the source editor.
 */
export async function mountOn(encoding: string): Promise<EditorView> {
  Worker.prototype.postMessage = function (this: Worker, message: unknown, options?: unknown) {
    const m = message as { kind?: string; src?: string; encoding?: string } | null
    if (m?.kind === 'run') runs.push({ src: m.src ?? '', encoding: m.encoding ?? '' })
    ;(post as (this: Worker, m: unknown, o?: unknown) => void).call(this, message, options)
  }
  localStorage.setItem(PROGRAM_STORAGE_KEY, serializeProgram({ text: PAGE, encoding }))
  document.body.innerHTML = SHELL
  const view = await (await import('../../src/main')).ready
  await until(() => stateIdle() && readout() > 0, 'the first compile')
  return view
}

/** Put back the `postMessage` that `mountOn` wrapped. */
export const unwrapPost = (): void => {
  Worker.prototype.postMessage = post
}
