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

/**
 * A panel that also keeps the room its rows have needed across the frames it shows, a `null` among them, until
 * `forget`: its view calls that for a new program or listing, and for nothing else (the squeezed values design). The
 * values keep it for their grid (`valuesRoom`), the heap for each line (`lineRoom`).
 */
export type RoomPanel<V> = MachinePanel<V> & { forget(): void }

/** One row of the values panel: an rxm register, or a CLIF value. */
export type ValueRow = {
  readonly name: string
  readonly text: string
  readonly changed: boolean
  readonly unwritten: boolean
  /** The rxm registers a CLIF value stands for, from its value labels; an rxm register's row has none. */
  readonly regs?: readonly string[]
  /** Whether the row holds the run's result, which the panel marks with its tint, its edge and the word. */
  readonly result: boolean
  /** What the row's marks mean, in words: its `aria-description`, so no mark is colour alone. */
  readonly says: readonly string[]
}

export type ValuesView = {
  readonly rows: readonly ValueRow[]
  readonly notes: readonly { readonly text: string; readonly legend: boolean }[]
}

/** The least width of a values row's name, in `ch`: `style.css`'s `.rxm-register dt`. */
export const NAME_CH = 4

/**
 * The room a values row needs to read whole, in `ch`: its name's column, the 1ch gap after it, and its word with the
 * registers a CLIF value stands for after it. **IT COUNTS `style.css`'s `.rxm-register` BOX, LESS ITS PADDING**, which
 * the track adds (`.rxm-register-list`), and every character as 1ch, which the monospace font makes true:
 * `tests/node/machine-room.test.ts` holds the name's width, the gap and the padding to the stylesheet, so a change to one
 * side that the other misses fails there rather than cutting a value the room says fits.
 */
export function rowRoom(r: ValueRow): number {
  const name = (r.unwritten ? 2 : 0) + r.name.length
  const regs = r.regs === undefined || r.regs.length === 0 ? 0 : 1 + r.regs.join(', ').length
  return Math.max(NAME_CH, name) + 1 + r.text.length + regs
}

/**
 * The room the values grid keeps for each of its tracks, in `ch`: the most any row has needed since the view last
 * forgot (the squeezed values design). **IT ONLY GROWS**, so a value that outgrows its track widens the tracks once, at
 * the step it first does, and nothing moves at a step back to a shorter value or at a rewind of the same run, which
 * draws an empty frame between the old recording and the new one's first. It counts the frames the view draws, so a
 * value at a step a jump or a fast play passed over widens the tracks at the step back that first draws it. The view
 * forgets it when it is told of a new program or a new listing, a run the room it kept says nothing about.
 *
 * **THE RESULT'S ROW IS LEFT OUT**: it spans every track and wraps (`style.css`'s `.is-result`), so it needs none.
 */
export function valuesRoom(): { take(view: ValuesView): number; forget(): void } {
  let most = 0
  return {
    take(view) {
      for (const r of view.rows) if (!r.result) most = Math.max(most, rowRoom(r))
      return most
    },
    forget() {
      most = 0
    },
  }
}

export type StackView = {
  readonly count: string
  readonly frames: readonly { readonly callee: string; readonly ret: string; readonly saved: string }[]
  readonly notes: readonly string[]
}

/** One line of the heap panel: a cell or a box, named by its `lead`. */
export type HeapLine = {
  readonly kind: 'line'
  readonly lead: string
  readonly body: string
  readonly refs: readonly string[]
  /** Whether the line is a cell of the run's result, which the panel lights with its tint and edge. */
  readonly result: boolean
}

export type HeapView = {
  readonly count: string
  readonly items: readonly (HeapLine | { readonly kind: 'note'; readonly text: string })[]
}

/** A heap line's text as the panel draws it: its lead, its body, and the registers that name it after `←`. */
export function lineText(l: HeapLine): string {
  return `${l.lead} ${l.body}${l.refs.length > 0 ? ` ← ${l.refs.join(', ')}` : ''}`
}

/**
 * The room each heap line keeps, by its lead: the longest text it has had since the view last forgot (the squeezed
 * values design). `take` answers that text where it is longer than the line's own, and `null` where it is not; the
 * panel lays it out hidden in the line's place, so a line that wrapped onto more lines at a step keeps them at the steps
 * after, where fewer registers name its cell. A cell's head and tail never change; what names it does, and a box's
 * content can. It counts the lines the view draws, as the values' room does. **IT ONLY GROWS**, and the view forgets it
 * with the values' room, at a new program or listing.
 */
export function lineRoom(): { take(l: HeapLine): string | null; forget(): void } {
  const longest = new Map<string, string>()
  return {
    take(l) {
      const now = lineText(l)
      const kept = longest.get(l.lead)
      if (kept !== undefined && kept.length > now.length) return kept
      longest.set(l.lead, now)
      return null
    },
    forget() {
      longest.clear()
    },
  }
}

/**
 * The registers (spec §6.3): each name and word, the register the last step wrote marked *changed*, and each local
 * the current call has not written dimmed and marked `·`, with a legend saying what that means. Every mark also says
 * itself in an `aria-description`, so none is colour alone. A CLIF value's row names the rxm registers it stands for
 * after its word, in a `span.value-regs`. The run's result is marked `is-result`, and the word `result` at the end of
 * its `dd`, in a `span.result-word`, says so; the registers and the word go in one `span.result-tail`. Each track of
 * the grid is at least as wide as the widest row has needed (`valuesRoom`), as `--values-room` on the body.
 */
export function valuesPanel(o: MachinePanelOptions): RoomPanel<ValuesView> {
  const body = document.createElement('div')
  body.className = 'rxm-registers'
  const panel = machinePanel(o, body)
  const room = valuesRoom()
  let kept = 0
  /** The grid's room, `style.css`'s `--values-room`, written only when it grows, so a step that keeps it writes none. */
  const keep = (to: number) => {
    if (to === kept) return
    kept = to
    if (to === 0) body.style.removeProperty('--values-room')
    else body.style.setProperty('--values-room', `${to}ch`)
  }
  return {
    panel,
    show(view) {
      if (view === null) {
        body.replaceChildren()
        return
      }
      keep(room.take(view))
      const list = document.createElement('dl')
      list.className = 'rxm-register-list'
      for (const r of view.rows) {
        const item = document.createElement('div')
        item.className = 'rxm-register'
        const name = document.createElement('dt')
        name.textContent = r.unwritten ? `· ${r.name}` : r.name
        const value = document.createElement('dd')
        value.textContent = r.text
        let regs: HTMLElement | null = null
        if (r.regs !== undefined && r.regs.length > 0) {
          regs = document.createElement('span')
          regs.className = 'value-regs'
          regs.textContent = r.regs.join(', ')
        }
        if (r.result) {
          const word = document.createElement('span')
          word.className = 'result-word'
          word.textContent = 'result'
          // THE REGISTERS AND THE WORD AS ONE BOX, `style.css`'s `.result-tail`: the row breaks before it as a whole.
          const tail = document.createElement('span')
          tail.className = 'result-tail'
          if (regs !== null) tail.append(regs, ' ')
          tail.append(word)
          value.append(' ', tail)
          item.classList.add('is-result')
        } else if (regs !== null) value.append(' ', regs)
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
    forget() {
      room.forget()
      keep(0)
    },
  }
}

/**
 * The call stack (spec §6.4), top first: each frame the function it called, `→ pc14` where `ret` resumes, and the
 * caller's locals as they were at the call. Past the window, `+N more`. A frame too long for the panel goes on below,
 * indented. Unlike a heap line it keeps no room: a frame's text is fixed while it is on the stack, but for a clif
 * frame's pc, which the stylesheet keeps as wide as the listing's widest, so the stack's lines move only at a call or a
 * return.
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
 * that name it — then the boxes. Past the window, `+N older`. A cell of the run's result is `is-result`, said in its
 * `aria-description`, and a run of them one box: `is-result-first` and `is-result-last` mark where it starts and ends.
 * A line too long for the panel goes on below, indented; its text is in a `span.rxm-line`, and the longest it has had
 * (`lineRoom`), where that is longer, is `--line-room` on it, which the stylesheet lays out hidden in the same place.
 */
export function heapPanel(o: MachinePanelOptions): RoomPanel<HeapView> {
  const body = document.createElement('ul')
  body.className = 'rxm-heap'
  const count = countNote()
  const panel = machinePanel(o, body)
  panel.actions.append(count.el)
  const room = lineRoom()
  return {
    panel,
    forget() {
      room.forget()
    },
    show(view) {
      count.show(view?.count ?? '')
      if (view === null) {
        body.replaceChildren()
        return
      }
      const lit = (i: number) => {
        const item = view.items[i]
        return item?.kind === 'line' && item.result
      }
      const items = view.items.map((item, i) => {
        if (item.kind === 'note') return note(item.text)
        const li = document.createElement('li')
        li.className = 'rxm-cell-line'
        if (item.result) {
          li.classList.add('is-result')
          li.classList.toggle('is-result-first', !lit(i - 1))
          li.classList.toggle('is-result-last', !lit(i + 1))
          li.setAttribute('aria-description', 'part of the result')
        }
        const text = document.createElement('span')
        text.className = 'rxm-line'
        const at = document.createElement('b')
        at.textContent = item.lead
        text.append(at, ` ${item.body}`)
        if (item.refs.length > 0) {
          const r = document.createElement('span')
          r.className = 'rxm-refs'
          r.textContent = `← ${item.refs.join(', ')}`
          text.append(' ', r)
        }
        li.append(text)
        const kept = room.take(item)
        if (kept !== null) li.style.setProperty('--line-room', JSON.stringify(kept))
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
