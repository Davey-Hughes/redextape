import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { lintGutter } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import init, { analyze, classifySource, encodings } from '../../pkg/redextape_wasm.js'
import { showBanner, showWorkerError } from './banner'
import { canRecordFurther, controlState } from './controls'
import { declineMark, highlighting, setDecline, setSpans } from './highlight'
import { History } from './history'
import { LambdaPane } from './lambda-pane'
import { lintFromAnalyze } from './lint'
import type { Leg, RecordEnd, RunReply } from './protocol'
import { HISTORY_BYTES, lambdaFrameBytes, tmFrameBytes } from './protocol'
import type { Row } from './results'
import { noSessionRows, resultRows } from './results'
import { SessionClient } from './session-client'
import { TmPane } from './tm-pane'
import type { Classified, Diagnostic, LambdaState, LambdaStatus, TmState, TmStatus } from './types'

const DEBOUNCE_MS = 300
const SAMPLE = 'let x = 40; x + 2'
/**
 * Milliseconds between frames during playback (120 ms ≈ 8 fps). A main-thread `setInterval` walk over
 * recorded frames — it never touches wasm, which is the whole reason the history lives on this side.
 */
const PLAY_MS = 120

function renderRows(host: HTMLElement, rows: Row[]): void {
  host.replaceChildren(
    ...rows.map((r) => {
      const el = document.createElement('div')
      el.className = 'row'
      const leg = document.createElement('span')
      leg.className = 'leg'
      leg.textContent = r.leg
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = r.label
      const value = document.createElement('span')
      value.className = 'value'
      value.textContent = r.value
      if (r.note) {
        const note = document.createElement('div')
        note.className = 'note'
        note.textContent = r.note
        value.append(note)
      }
      el.append(leg, label, value)
      return el
    }),
  )
}

/**
 * One leg's live state on this side of the boundary: its history, how recording ended, and what the
 * worker said about it at compile time.
 */
type LegState<T> = {
  hist: History<T>
  status: { available: boolean; reason: string }
  done: RecordEnd | null
  timer: ReturnType<typeof setInterval> | null
}

async function main(): Promise<EditorView> {
  const results = document.querySelector<HTMLElement>('#results')
  const editorHost = document.querySelector<HTMLElement>('#editor')
  const lambdaHost = document.querySelector<HTMLElement>('#lambda')
  const tmHost = document.querySelector<HTMLElement>('#tm')
  const picker = document.querySelector<HTMLSelectElement>('#encoding')
  const root = document.querySelector<HTMLElement>('main')
  if (!results || !editorHost || !lambdaHost || !tmHost || !picker || !root) {
    throw new Error('the page is missing a mount point')
  }

  // THE ONE PLACE THE APP CAN FAIL TO START. `init()` fetches the wasm; a worker constructed against
  // a missing module fails the same way. PR 3c had no surface for either and the failure was a blank
  // page.
  try {
    await init()
  } catch (e) {
    showBanner(root, e)
    throw e
  }

  for (const name of encodings() as string[]) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    picker.append(opt)
  }

  let view: EditorView

  const lam: LegState<LambdaState> = {
    hist: new History<LambdaState>(HISTORY_BYTES),
    status: { available: false, reason: '' },
    done: null,
    timer: null,
  }
  const tm: LegState<TmState> = {
    hist: new History<TmState>(HISTORY_BYTES),
    status: { available: false, reason: '' },
    done: null,
    timer: null,
  }

  const draw = () => {
    lambdaPane.render(
      lam.hist.current ?? null,
      controlState({
        available: lam.status.available,
        reason: lam.status.reason,
        head: lam.hist.head,
        length: lam.hist.length,
        oldestStep: lam.hist.oldestStep,
        currentStep: lam.hist.currentStep,
        newestStep: lam.hist.newestStep,
        evicted: lam.hist.evicted,
        done: lam.done,
      }),
    )
    tmPane.render(
      tm.hist.current ?? null,
      controlState({
        available: tm.status.available,
        reason: tm.status.reason,
        head: tm.hist.head,
        length: tm.hist.length,
        oldestStep: tm.hist.oldestStep,
        currentStep: tm.hist.currentStep,
        newestStep: tm.hist.newestStep,
        evicted: tm.hist.evicted,
        done: tm.done,
      }),
    )
  }

  /**
   * Playback is an interval over recorded frames and stops at the frontier. It never asks the worker
   * for more — `▶` at the frontier does that, deliberately, so play cannot run away with a cap raise
   * nobody clicked.
   */
  const play = <T>(leg: LegState<T>) => {
    if (leg.timer !== null) {
      clearInterval(leg.timer)
      leg.timer = null
      return
    }
    leg.timer = setInterval(() => {
      if (!leg.hist.forward()) {
        if (leg.timer !== null) clearInterval(leg.timer)
        leg.timer = null
      }
      draw()
    }, PLAY_MS)
  }

  const events = <T>(leg: LegState<T>, which: Leg) => ({
    back: () => {
      leg.hist.back()
      draw()
    },
    forward: () => {
      // At the frontier `▶` means "record one more", which is the same operation as `[continue]`.
      // `canRecordFurther` is `controls.ts`'s call, not re-derived here — see its doc comment.
      if (!leg.hist.forward() && canRecordFurther(leg.done)) {
        client.extend(which)
      }
      draw()
    },
    play: () => play(leg),
    restart: () => {
      leg.hist.seek(0)
      draw()
    },
    extend: () => client.extend(which),
  })

  const worker = new Worker(new URL('./session-worker.ts', import.meta.url), { type: 'module' })
  // THE SECOND HALF OF §6's LOAD-FAILURE ROW, and it is not the same failure as `init()`'s. A worker
  // whose module fails to load does not throw from the constructor — it fires `error` on the handle,
  // asynchronously, and nothing else in this file would ever hear it. Without this the pane sits on
  // "running…" forever, which is the same blank-page problem one layer in.
  worker.addEventListener('error', (e) => showBanner(root, e instanceof ErrorEvent ? (e.error ?? e.message) : e))
  const client = new SessionClient(worker, (reply: RunReply) => onReply(reply))
  const lambdaPane = new LambdaPane(lambdaHost, events(lam, 'lambda'))
  const tmPane = new TmPane(tmHost, events(tm, 'tm'))

  // `reason` is what a leg's control strip reads (`controls.ts`'s `controlState` returns it straight
  // as `stepText` while `!available`) when there is no per-leg `LambdaStatus`/`TmStatus` to read one
  // from — i.e. when neither leg compiled at all. Design §6's error table says the panes "read 'not
  // compiled'" for that case; leaving it as `''` left them reading nothing.
  const resetLegs = (lambda: LambdaStatus | null, tmStatus: TmStatus | null, reason = '') => {
    for (const leg of [lam, tm]) {
      leg.hist.clear()
      leg.done = null
      if (leg.timer !== null) clearInterval(leg.timer)
      leg.timer = null
    }
    lam.status = { available: lambda?.available ?? false, reason: lambda?.reason ?? reason }
    tm.status = { available: tmStatus?.available ?? false, reason: tmStatus?.reason ?? reason }
  }

  const onReply = (reply: RunReply): void => {
    switch (reply.kind) {
      case 'no-session':
        results.dataset.state = 'idle'
        renderRows(results, noSessionRows(reply.diagnostics))
        // STALE FRAMES MUST NOT SURVIVE A BROKEN PROGRAM. A pane still showing the last good run
        // under source that does not compile is the worst of both answers.
        resetLegs(null, null, 'not compiled')
        tmPane.setProgram(null, [])
        view.dispatch({ effects: setDecline.of(null) })
        draw()
        return
      case 'compiled':
        resetLegs(reply.lambda, reply.tm)
        tmPane.setProgram(reply.tmProgram, reply.tapeNames)
        view.dispatch({ effects: setDecline.of(reply.declinedSpan) })
        draw()
        return
      case 'lambda-frames':
        for (const f of reply.frames) lam.hist.push(f, lambdaFrameBytes(f))
        lam.done = reply.done
        draw()
        return
      case 'tm-frames':
        for (const f of reply.frames) tm.hist.push(f, tmFrameBytes(f))
        tm.done = reply.done
        draw()
        return
      case 'result':
        results.dataset.state = 'idle'
        renderRows(results, resultRows(reply.lambda, reply.tm))
        return
      case 'worker-error':
        // See the constructor-time `worker.addEventListener('error', ...)` above for the sibling
        // failure this answers: that one is a module that never loaded, this one is a session call
        // that threw after it did. Both would otherwise leave a pane on "running…" forever — but
        // unlike that one, the app itself is still alive here, so the response renders INTO `#results`
        // (`showWorkerError`) rather than replacing `<main>` (`showBanner`'s job is the other case; see
        // `banner.ts`'s doc for the split). `resetLegs`/`setProgram`/`setDecline`/`draw` below all run
        // against the SAME live nodes they always did — nothing here was ever the problem.
        results.dataset.state = 'idle'
        // STALE FRAMES MUST NOT SURVIVE A BROKEN PROGRAM, same as `no-session` above. `compile()`
        // throws by design for an unknown encoding (`lib.rs:36-38`) from inside `onRun`, before any
        // session exists — so a `worker-error` from a fresh `client.request()` is not only a call that
        // threw mid-record on top of a live session; it can also mean there was never a new session at
        // all, and the panes are still showing the PREVIOUS program's frames under a message saying the
        // app broke. Either way there is no session, which is what "not compiled" means — the same
        // reason `no-session` above passes, since a `compile()` that threw never produced one.
        resetLegs(null, null, 'not compiled')
        tmPane.setProgram(null, [])
        view.dispatch({ effects: setDecline.of(null) })
        showWorkerError(results, new Error(reply.message))
        draw()
        return
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (src: string) => {
    clearTimeout(timer)
    results.dataset.state = 'running'
    timer = setTimeout(() => client.request(src, picker.value), DEBOUNCE_MS)
  }

  // The picker is otherwise inert: `schedule` only reads `picker.value` when a keystroke's update
  // listener calls it, so choosing a different encoding would sit unused until the user typed again.
  picker.addEventListener('change', () => schedule(view.state.doc.toString()))

  view = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: SAMPLE,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        highlighting,
        declineMark,
        lintGutter(),
        lintFromAnalyze((src) => analyze(src) as Diagnostic[]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          const src = u.state.doc.toString()
          // Synchronous, in the same frame as the keystroke. This is the whole reason `classifySource`
          // is not behind the worker.
          u.view.dispatch({ effects: setSpans.of(classifySource(src) as Classified) })
          schedule(src)
        }),
      ],
    }),
  })

  view.dispatch({ effects: setSpans.of(classifySource(SAMPLE) as Classified) })
  schedule(SAMPLE)
  draw()
  return view
}

/**
 * The app starts on import — `index.html` loads this module and nothing else.
 *
 * THE VIEW IS EXPORTED AS A PROMISE so the browser tests can drive the editor through CodeMirror's own
 * API rather than synthesizing key events into a contenteditable. Nothing in the product reads it.
 */
export const ready = main()
