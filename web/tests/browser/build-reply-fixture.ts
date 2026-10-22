import type { EditorView } from '@codemirror/view'
import { userEvent } from 'vitest/browser'
import { until } from './harness'

/**
 * Each build a copy's worker is sent, with the reply that worker answered it with, for the files that wait on a
 * copy's build being answered. **A FAILED BUILD ON A COPY THAT HAS BUILT BEFORE CHANGES NOTHING ON THE PAGE** —
 * `replies.ts`'s `no-session` arm leaves the last good frames where they are — so the reply itself is the one fact a
 * test can wait on to know the debounce fired and the worker answered. And a build that lands is the moment a test
 * of what it changes must wait for: the listener here is added after the app's own, attached when the app built the
 * worker, so the app has handled a reply by the time it is listed.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names end in
 * `.test.ts`, and this one does not.
 */

/** A build request a copy's worker was sent (`protocol.ts`'s `RunRequest`), and the kind of reply it drew. */
export type Answered = { readonly src: string; readonly reply: string }

/** The builds answered since `recordBuildReplies` wrapped `postMessage`, in the order their replies arrived. */
export const answered: Answered[] = []

/** The three requests that build a copy, one per leg (`ScratchBuffers.recompile`'s switch on the leg). */
const BUILDS = new Set(['lambda-scratch', 'tm-scratch', 'asm-scratch'])

/** The replies that answer one of those builds: its leg's success, or the failure every leg shares. */
const REPLIES = new Set(['scratch-compiled', 'tm-scratch-compiled', 'asm-scratch-compiled', 'no-session'])

/**
 * Wrap `Worker`'s own `postMessage` so that each copy build is added to `answered` when its worker answers it, matched
 * by the request's generation; answers the function that puts `postMessage` back.
 */
export function recordBuildReplies(): () => void {
  const post = Worker.prototype.postMessage
  Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]): void {
    ;(post as (...args: unknown[]) => void).apply(this, [message, ...rest])
    const sent = message as { kind?: string; gen?: number; src?: string } | null
    if (sent?.kind === undefined || !BUILDS.has(sent.kind)) return
    const heard = (e: MessageEvent): void => {
      if (e.data?.gen !== sent.gen || !REPLIES.has(e.data?.kind)) return
      this.removeEventListener('message', heard)
      answered.push({ src: sent.src ?? '', reply: e.data.kind })
    }
    this.addEventListener('message', heard)
  }
  return () => {
    Worker.prototype.postMessage = post
  }
}

/**
 * The reply the first build of `src` drew, or `undefined` while none has — matched by the text alone, so a case waits
 * on a text no earlier build in its file was sent.
 */
export const replyTo = (src: string): string | undefined => answered.find((a) => a.src === src)?.reply

/**
 * The reply to the next build of `src`, waited for: the first answer to it listed at or after `from`, an index into
 * `answered` taken before that build was asked for. `replyTo` reads the first answer in the file, which a text an
 * earlier case typed too already has, so it would answer before this build was sent.
 */
export async function answerTo(src: string, from: number, what: string): Promise<string | undefined> {
  const reply = () => answered.slice(from).find((a) => a.src === src)?.reply
  await until(() => reply() !== undefined, what)
  return reply()
}

/**
 * Type `key` at the end of `view` with a real key press, and answer the reply its build drew, once it has. The debounce
 * posts one build per pause, so each call waits for its own before the next key.
 */
export async function typeAnswered(view: EditorView, key: string): Promise<string | undefined> {
  const before = view.state.doc.toString()
  view.dispatch({ selection: { anchor: before.length } })
  view.focus()
  await until(() => view.hasFocus, 'the copy’s editor to take the focus')
  const from = answered.length
  await userEvent.keyboard(key)
  await until(() => view.state.doc.toString() === before + key, `the editor to take \`${key}\``)
  return answerTo(before + key, from, `the build of the edit \`${key}\``)
}
