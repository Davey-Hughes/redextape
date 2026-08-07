import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { lintGutter } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import init, { analyze, classifySource, encodings } from '../../pkg/redextape_wasm.js'
import { declineMark, highlighting, setDecline, setSpans } from './highlight'
import { lintFromAnalyze } from './lint'
import type { RunReply } from './protocol'
import type { Row } from './results'
import { noSessionRows, resultRows } from './results'
import { SessionClient } from './session-client'
import type { Classified, Diagnostic } from './types'

const DEBOUNCE_MS = 300
const SAMPLE = 'let x = 40; x + 2'

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

async function main(): Promise<EditorView> {
  await init()

  const results = document.querySelector<HTMLElement>('#results')
  const editorHost = document.querySelector<HTMLElement>('#editor')
  const picker = document.querySelector<HTMLSelectElement>('#encoding')
  if (!results || !editorHost || !picker) throw new Error('the page is missing a mount point')

  // The list comes from the registry, not from a TypeScript array — see `encodings()`.
  for (const name of encodings() as string[]) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    picker.append(opt)
  }

  // Declared before the client so its callback can reach the editor; assigned once the view exists.
  let view: EditorView

  const worker = new Worker(new URL('./session-worker.ts', import.meta.url), { type: 'module' })
  const client = new SessionClient(worker, (reply: RunReply) => {
    results.dataset.state = 'idle'
    if (reply.kind === 'no-session') {
      renderRows(results, noSessionRows(reply.diagnostics))
      view.dispatch({ effects: setDecline.of(null) })
      return
    }
    renderRows(results, resultRows(reply.lambda, reply.tm))
    view.dispatch({ effects: setDecline.of(reply.lambda.declinedSpan) })
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (src: string) => {
    clearTimeout(timer)
    results.dataset.state = 'running'
    timer = setTimeout(() => client.request(src, picker.value), DEBOUNCE_MS)
  }

  // The picker is otherwise inert: `schedule` only reads `picker.value` when a keystroke's update
  // listener calls it, so choosing a different encoding would sit unused until the user typed again.
  // This listener is what makes selecting an option schedule a run — through the same debounce path.
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
  return view
}

/// The app starts on import — `index.html` loads this module and nothing else.
///
/// THE VIEW IS EXPORTED AS A PROMISE so the browser tests can drive the editor through CodeMirror's own
/// API rather than synthesizing key events into a contenteditable. Nothing in the product reads it.
export const ready = main()
