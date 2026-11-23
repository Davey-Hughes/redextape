import { createPanel, type Panel } from './panel'

/**
 * The machine's values, call stack and heap as panels of a view. Each draws finished rows and reads no machine word, so
 * what a row says is decided where a node test can read it: `rxm-view.ts`'s builders.
 */

/** What every panel here is built from: `createPanel`'s options, less the body the panel makes for itself. */
export type MachinePanelOptions = {
  readonly name: string
  readonly label: string
  readonly open: boolean
  onToggle(open: boolean): void
}

/** A panel and how to draw into it; `null` empties it. */
export type MachinePanel<V> = { readonly panel: Panel; show(view: V | null): void }

export type ValuesView = {
  readonly rows: readonly {
    readonly name: string
    readonly text: string
    readonly changed: boolean
    readonly unwritten: boolean
    /** The rxm registers a CLIF value stands for, from its value labels; an rxm register's row has none. */
    readonly regs?: readonly string[]
    /** What the row's marks mean, in words: its `aria-description`, so no mark is colour alone. */
    readonly says: readonly string[]
  }[]
  readonly notes: readonly { readonly text: string; readonly legend: boolean }[]
}

export type StackView = {
  readonly count: string
  readonly frames: readonly { readonly callee: string; readonly ret: string; readonly saved: string }[]
  readonly notes: readonly string[]
}

export type HeapView = {
  readonly count: string
  readonly items: readonly (
    | { readonly kind: 'line'; readonly lead: string; readonly body: string; readonly refs: readonly string[] }
    | { readonly kind: 'note'; readonly text: string }
  )[]
}

/**
 * The registers (spec §6.3): each name and word, the register the last step wrote marked *changed*, and each local
 * the current call has not written dimmed and marked `·`, with a legend saying what that means. Every mark also says
 * itself in an `aria-description`, so none is colour alone. A CLIF value's row names the rxm registers it stands for
 * after its word, in a `span.value-regs`.
 */
export function valuesPanel(o: MachinePanelOptions): MachinePanel<ValuesView> {
  const body = document.createElement('div')
  body.className = 'rxm-registers'
  const panel = machinePanel(o, body)
  return {
    panel,
    show(view) {
      if (view === null) {
        body.replaceChildren()
        return
      }
      const list = document.createElement('dl')
      list.className = 'rxm-register-list'
      for (const r of view.rows) {
        const item = document.createElement('div')
        item.className = 'rxm-register'
        const name = document.createElement('dt')
        name.textContent = r.unwritten ? `· ${r.name}` : r.name
        const value = document.createElement('dd')
        value.textContent = r.text
        if (r.regs !== undefined && r.regs.length > 0) {
          const regs = document.createElement('span')
          regs.className = 'value-regs'
          regs.textContent = r.regs.join(', ')
          value.append(' ', regs)
        }
        if (r.changed) item.classList.add('is-changed')
        if (r.unwritten) item.classList.add('is-unwritten')
        if (r.says.length > 0) value.setAttribute('aria-description', r.says.join('; '))
        item.append(name, value)
        list.append(item)
      }
      const notes = view.notes.map((n) => {
        const p = document.createElement('p')
        p.className = n.legend ? 'rxm-note rxm-legend' : 'rxm-note'
        p.textContent = n.text
        return p
      })
      body.replaceChildren(list, ...notes)
    },
  }
}

/**
 * The call stack (spec §6.4), top first: each frame the function it called, `→ pc14` where `ret` resumes, and the
 * caller's locals as they were at the call. Past the window, `+N more`.
 */
export function callStackPanel(o: MachinePanelOptions): MachinePanel<StackView> {
  const body = document.createElement('ol')
  body.className = 'rxm-stack'
  const count = countNote()
  const panel = machinePanel(o, body)
  panel.actions.append(count.el)
  return {
    panel,
    show(view) {
      count.show(view?.count ?? '')
      if (view === null) {
        body.replaceChildren()
        return
      }
      const items = view.frames.map((f) => {
        const li = document.createElement('li')
        li.className = 'rxm-frame'
        const callee = document.createElement('b')
        callee.className = 'rxm-callee'
        callee.textContent = f.callee
        const ret = document.createElement('span')
        ret.className = 'rxm-ret'
        ret.textContent = f.ret
        const saved = document.createElement('span')
        saved.className = 'rxm-saved'
        saved.textContent = f.saved
        li.append(callee, ' ', ret, ' ', saved)
        return li
      })
      body.replaceChildren(...items, ...view.notes.map(note))
    },
  }
}

/**
 * The heap (spec §6.5), newest first: `#57  57 → #56  ← r5` — the cell, its head and tail, and the *list* registers
 * that name it — then the boxes. Past the window, `+N older`.
 */
export function heapPanel(o: MachinePanelOptions): MachinePanel<HeapView> {
  const body = document.createElement('ul')
  body.className = 'rxm-heap'
  const count = countNote()
  const panel = machinePanel(o, body)
  panel.actions.append(count.el)
  return {
    panel,
    show(view) {
      count.show(view?.count ?? '')
      if (view === null) {
        body.replaceChildren()
        return
      }
      const items = view.items.map((item) => {
        if (item.kind === 'note') return note(item.text)
        const li = document.createElement('li')
        li.className = 'rxm-cell-line'
        const at = document.createElement('b')
        at.textContent = item.lead
        li.append(at, ` ${item.body}`)
        if (item.refs.length > 0) {
          const r = document.createElement('span')
          r.className = 'rxm-refs'
          r.textContent = `← ${item.refs.join(', ')}`
          li.append(' ', r)
        }
        return li
      })
      body.replaceChildren(...items)
    },
  }
}

/**
 * One of the three panels: `createPanel`'s, marked `machine-panel`, the class the stylesheet keeps their headers one
 * line by. The class is the panel's and not its container's, so a header reads the same wherever its panel is put.
 */
function machinePanel(o: MachinePanelOptions, body: HTMLElement): Panel {
  const panel = createPanel({
    name: o.name,
    label: o.label,
    body,
    open: o.open,
    onToggle: (open) => o.onToggle(open),
  })
  panel.el.classList.add('machine-panel')
  return panel
}

/**
 * A header's count. `el` is the room the header gives it, and the text is in a box of its own inside, which the
 * stylesheet cuts short or hides by that room (`style.css`'s `.machine-panel .panel-note`). `show` gives the same
 * words as the tooltip, which is how a cut count is read: set cut or not, so that no step has to measure the header.
 */
function countNote(): { readonly el: HTMLElement; show(text: string): void } {
  const el = document.createElement('span')
  el.className = 'panel-note'
  const shown = document.createElement('span')
  el.append(shown)
  return {
    el,
    show(text) {
      shown.textContent = text
      if (text === '') el.removeAttribute('title')
      else el.title = text
    },
  }
}

function note(text: string): HTMLElement {
  const li = document.createElement('li')
  li.className = 'rxm-note'
  li.textContent = text
  return li
}
