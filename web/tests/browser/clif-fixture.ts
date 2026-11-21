import { commands } from 'vitest/browser'
import type { ClifHandle } from '../../src/clif-loader'
import type { FramesReply, RunReply, RunRequest } from '../../src/protocol'

/** What every request for `pkg-clif` asks for: its module and its wasm. */
export const CLIF_MATCH = 'redextape_clif_wasm'

/** What a stepper of `throwing`'s throws. */
export const THROWN = 'the stepper threw'

/**
 * A module to answer the request for `pkg-clif`'s with (`vite.config.ts`'s `stubRequest`): the package itself, loaded
 * under another URL, whose `ClifSession` is the real stepper until its `method` has answered `after` calls, and throws
 * `THROWN` from then on. **THE REAL STEPPER'S ANSWERS LEAD UP TO THE THROW**, since no program is known to make a
 * stepper throw. **EACH STEPPER COUNTS ITS OWN CALLS**, so one built for another listing or run starts again.
 */
export const throwing = (method: keyof ClifHandle, after: number): string => `
const real = await import(new URL('?real', import.meta.url).href)
export default real.default
export class ClifSession {
  constructor(input, listing) {
    const stepper = new real.ClifSession(input, listing)
    let left = ${after}
    return new Proxy(stepper, {
      get: (target, key) => (...args) => {
        if (key === '${method}' && left-- <= 0) throw new Error('${THROWN}')
        return target[key](...args)
      },
    })
  }
}
`

/** Resolves after `ms`. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * The `pkg-clif` requests the page reported since this file's watch started (`vite.config.ts`'s `watchRequests`). **THE
 * PAGE'S LIST**, which reports a dedicated worker's requests as the context's does.
 */
export async function clifRequests(): Promise<string[]> {
  const log = await commands.watchRequests('read', CLIF_MATCH)
  if (log === null) throw new Error('this file started no watch of the pkg-clif requests')
  return log.page
}

/**
 * `clifRequests` once it holds one, read every 50 ms, or a throw after 10 s, `until`'s bound, naming what never came.
 */
export async function clifFetched(): Promise<string[]> {
  const started = performance.now()
  for (;;) {
    const page = await clifRequests()
    if (page.length > 0) return page
    if (performance.now() - started > 10_000) throw new Error('timed out after 10000ms waiting for a pkg-clif request')
    await sleep(50)
  }
}

/** One message between the page and a session worker: a request the page posted, or a reply the worker sent. */
export type Heard = { readonly request: RunRequest } | { readonly reply: RunReply }

/**
 * Hear every session worker made from now on: each request posted to it and each reply it sends, in one list, in the
 * order they happened, and `restore` to put `Worker` back. **INSTALLED BEFORE `main()`**, which makes the program's
 * worker as it starts. A reply is heard before the page's own listener takes it, since this one is added first.
 */
export function hearSessionWorkers(): {
  readonly heard: Heard[]
  restore(): void
  caughtUp(): Promise<void>
  hold(): void
  kept(): readonly RunReply[]
  release(through?: (reply: RunReply) => boolean): Promise<void>
  inject(reply: RunReply): void
} {
  const PageWorker = globalThis.Worker
  const heard: Heard[] = []
  /** The program worker's replies kept from the page since `hold`, oldest first, until `release` hands them on. */
  const kept: RunReply[] = []
  let holding = false
  /** Set while `release` hands a kept reply on, which the ear hears then and lets through. */
  let passing = false
  let program: { readonly worker: Worker; readonly post: (request: RunRequest) => void } | null = null
  // The newest request's, as `protocol.ts` asks of a `clif-load`.
  let gen = 0
  let answered: (() => void) | null = null
  globalThis.Worker = new Proxy(PageWorker, {
    construct(target, args: ConstructorParameters<typeof Worker>, newTarget) {
      const worker: Worker = Reflect.construct(target, args, newTarget)
      if (String(args[0]).includes('session-worker')) {
        const post = worker.postMessage.bind(worker)
        program ??= { worker, post }
        worker.postMessage = (request: RunRequest) => {
          heard.push({ request })
          gen = request.gen
          post(request)
        }
        worker.addEventListener('message', (e) => {
          const reply = (e as MessageEvent<RunReply>).data
          if (answered !== null && worker === program?.worker && reply.kind === 'clif-load') {
            e.stopImmediatePropagation()
            answered()
            answered = null
            return
          }
          // **ONCE ONE IS KEPT, EVERY LATER ONE IS**, until `release` has handed them all on: the page gets them in the
          // order the worker sent them.
          if (!passing && worker === program?.worker && (holding || kept.length > 0)) {
            e.stopImmediatePropagation()
            kept.push(reply)
            return
          }
          heard.push({ reply })
        })
      }
      return worker
    },
  })
  return {
    heard,
    restore: () => {
      globalThis.Worker = PageWorker
    },
    /**
     * Post a `clif-load` to the program's worker, the first one made, and resolve once the worker answers it. **EVERY
     * REPLY POSTED IN THE TASK THAT POSTED ONE ALREADY HEARD IS IN `heard` BY THEN**: the worker takes the request
     * only once that task has ended, and the page gets its replies in the order they were posted. **THE ANSWER IS THE
     * EAR'S**, kept out of `heard` and from the page's listener, so the page sees no load it did not ask for. **ONLY
     * ONCE `pkg-clif` IS IN, AND WHILE THE PAGE ASKS FOR NO LOAD OF ITS OWN**: the first `clif-load` is the answer.
     */
    caughtUp: () =>
      new Promise((resolve, reject) => {
        if (program === null) throw new Error('no session worker was made after hearSessionWorkers')
        const bound = setTimeout(
          () => reject(new Error('timed out after 10000ms waiting for the session worker to answer a clif-load')),
          10_000,
        )
        answered = () => {
          clearTimeout(bound)
          resolve()
        }
        program.post({ kind: 'clif-load', gen })
      }),
    /**
     * Keep every reply of the program's worker from the page from now on, until `release`. **WHAT THE PAGE SHOWS
     * STANDS STILL**: no frame, listing or result reaches it, so a press can be made inside a window a reply would
     * otherwise close, however long the press takes. Requests still go, and are heard as they are posted.
     */
    hold: () => {
      holding = true
    },
    /** The replies `hold` has kept so far, oldest first. */
    kept: () => kept,
    /**
     * Hand every kept reply on to the page, oldest first, **EACH IN A TASK OF ITS OWN**, as the worker's own replies
     * come, so a draw a reply schedules for its frame is not folded into the next reply's; those that come meanwhile
     * are kept behind them. Each is heard as it is handed on. **WITH `through`, ONLY AS FAR AS THE FIRST REPLY IT
     * MATCHES**, and the rest stay kept, with every later one, until the next release.
     */
    release: async (through?: (reply: RunReply) => boolean) => {
      if (through === undefined) holding = false
      while (kept.length > 0) {
        const data = kept.shift() as RunReply
        passing = true
        try {
          program?.worker.dispatchEvent(new MessageEvent('message', { data }))
        } finally {
          passing = false
        }
        await sleep(0)
        if (through?.(data) === true) return
      }
    },
    /**
     * Hand `reply` to the page as a reply of the program's worker, heard as one: **A REPLY THE WORKER SENDS IN A WINDOW
     * NO GESTURE CAN TIME**, made from one it sent.
     */
    inject: (reply: RunReply) => {
      passing = true
      try {
        program?.worker.dispatchEvent(new MessageEvent('message', { data: reply }))
      } finally {
        passing = false
      }
    },
  }
}

/** The requests of `kind` in `heard`, in order. */
export const requestsOf = <K extends RunRequest['kind']>(
  heard: readonly Heard[],
  kind: K,
): Extract<RunRequest, { kind: K }>[] =>
  heard.flatMap((h) =>
    'request' in h && h.request.kind === kind ? [h.request as Extract<RunRequest, { kind: K }>] : [],
  )

/** The replies of `kind` in `heard`, in order. */
export const repliesOf = <K extends RunReply['kind']>(
  heard: readonly Heard[],
  kind: K,
): Extract<RunReply, { kind: K }>[] =>
  heard.flatMap((h) => ('reply' in h && h.reply.kind === kind ? [h.reply as Extract<RunReply, { kind: K }>] : []))

/** The CLIF leg's chunks in `heard` recorded under `epoch`, in order. */
export const clifChunks = (heard: readonly Heard[], epoch: number): FramesReply<'clif'>[] =>
  repliesOf(heard, 'frames').filter((c): c is FramesReply<'clif'> => c.leg === 'clif' && c.epoch === epoch)

/** The steps of the CLIF frames in `heard` recorded under `epoch`, in the order they came. */
export const clifSteps = (heard: readonly Heard[], epoch: number): number[] =>
  clifChunks(heard, epoch).flatMap((c) => c.frames.map((f) => f.step))

/** Whether the CLIF leg's recording under `epoch` has said how it stopped. */
export const clifStopped = (heard: readonly Heard[], epoch: number): boolean =>
  clifChunks(heard, epoch).some((c) => c.done !== null)

/**
 * Where the text of the CLIF listing's row `row` starts, in columns right of `pc`, the pc column's right edge, a column
 * being `ch` wide. **READ WITH A `Range` OVER ITS FIRST CHARACTER**, past the spaces before it, which are one text node
 * with it.
 */
export function textColumn(row: HTMLElement, pc: number, ch: number): number {
  const cell = row.querySelector('.clif-cell') as HTMLElement
  const text = [...cell.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).at(-1) as Text
  const at = (text.data.match(/^ */)?.[0] ?? '').length
  const range = document.createRange()
  range.setStart(text, at)
  range.setEnd(text, at + 1)
  return Math.round((range.getBoundingClientRect().left - pc) / ch)
}
