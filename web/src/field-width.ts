import { icon } from './icons'

/**
 * THE PROGRAM'S FIELD WIDTH: `null` for auto, where wasm fits the width itself, or a width every TM run of the program
 * is pinned to (the TM width design). **ONE FOR THE PROGRAM, AS THE ENCODING IS**: every TM view of the program shows
 * it in its header and sets it there, so a choice in one view is the value every other one shows.
 */
export type FieldWidth = {
  /** wasm's `fieldWidths()`, read once: the widths a run can be pinned to, narrowest first. */
  readonly widths: readonly number[]
  /** The program's width now: `null` for auto. */
  current(): number | null
  /** A choice made in a view's width box: `main.ts` records it and recompiles. */
  choose(width: number | null): void
}

/**
 * `v` as a width: a number `widths` lists, else `null`, auto. How a stored or linked width is read. **COMPARED WITH
 * `===`, NOT CONVERTED NOR RANGE-CHECKED**: the wasm export takes a `u32`, whose glue turns `16.7`, `2 ** 32 + 16` and
 * `"8"` into 16, 16 and 8 before Rust's own check runs, so only a width the list holds may reach it (the TM width
 * design, decision 15).
 */
export const listedWidth = (v: unknown, widths: readonly number[]): number | null => widths.find((w) => w === v) ?? null

/**
 * How long a step of the box's arrows or of ↑/↓ waits for the next one before it applies, so stepping 8 to 12 runs the
 * program once, at 12, rather than at 9, 10 and 11 on the way (the TM width design, decision 29).
 */
export const STEP_PAUSE_MS = 400

/** A number as the box takes one: digits, and a fraction if any, which no listed width has. */
const NUMBER = /^\d+(?:\.\d+)?$/

/**
 * A TM view's `width` box (the TM width design, decisions 29 to 33): empty for auto, or a width of `widths`. An entry
 * typed applies on Enter or when the focus leaves, a step of ↑/↓ or of the box's own arrows `STEP_PAUSE_MS` after the
 * last; not on each keystroke. Escape, or an entry that is not a listed width, puts it back. **THE STEPS GO THROUGH ONE
 * PLAIN ORDER, AUTO AND THEN `widths`**: ↑ from auto is the narrowest width whatever width auto fitted, ↓ from the
 * narrowest is auto, and ↓ at auto and ↑ at the widest stay. `sync`, which the view calls on every render, brings the
 * box to the program's width, **BUT NOT WHILE IT HOLDS AN ENTRY**, which a playing run's frames would wipe.
 * **A TEXT FIELD THAT IS A SPIN BUTTON, NOT A NUMBER INPUT** (decision 33): a number input's value is not the text it
 * shows, which an entry is judged on, and its browser's own steps leave the plain order.
 */
export function fieldWidthControl(on: FieldWidth): { readonly el: HTMLLabelElement; sync(): void } {
  const [min, max] = [on.widths[0] ?? 0, on.widths.at(-1) ?? 0]
  const box = document.createElement('input')
  box.type = 'text'
  box.inputMode = 'numeric'
  box.autocomplete = 'off'
  box.spellcheck = false
  box.placeholder = 'auto'
  box.setAttribute('role', 'spinbutton')
  box.setAttribute('aria-valuemin', String(min))
  box.setAttribute('aria-valuemax', String(max))
  // `auto` IS IN THE DESCRIPTION AS WELL AS IN THE VALUE TEXT: Chromium hands on no native input's `aria-valuetext`, so
  // there a screen reader would hear the empty box as blank (decision 33).
  box.setAttribute(
    'aria-description',
    'tape field width in cells for the program’s TM, shared by every TM view; empty for auto',
  )
  /** The box holds an entry not yet applied, typed or stepped. */
  let entered = false
  let pause: ReturnType<typeof setTimeout> | undefined
  /** The box's text as a number, `null` when it is empty, `NaN` when it is no number. */
  const read = (): number | null => {
    const text = box.value.trim()
    return text === '' ? null : NUMBER.test(text) ? Number(text) : Number.NaN
  }

  /** What a screen reader hears: `auto` for the empty box, else its text, and its value when that is a width. */
  const mark = (): void => {
    const n = read()
    box.setAttribute('aria-valuetext', n === null ? 'auto' : box.value)
    if (n !== null && listedWidth(n, on.widths) !== null) box.setAttribute('aria-valuenow', String(n))
    else box.removeAttribute('aria-valuenow')
  }
  /** Put the program's width in the box. */
  const show = (): void => {
    clearTimeout(pause)
    entered = false
    const want = String(on.current() ?? '')
    if (box.value !== want) box.value = want
    mark()
  }
  const apply = (): void => {
    if (!entered) return
    const n = read()
    const width = n === null ? null : listedWidth(n, on.widths)
    const listed = n === null || width !== null
    // `show` FIRST, so the render `choose` starts finds no entry and brings every box, this one too, to the choice.
    show()
    if (listed && width !== on.current()) on.choose(width)
  }
  const clamp = (w: number): number => Math.min(max, Math.max(min, w))
  /** A step of ↑/↓ or of an arrow, which applies `STEP_PAUSE_MS` after the last. */
  const step = (by: 1 | -1): void => {
    // AUTO, AND TEXT THAT IS NO NUMBER, ARE THE RUNG BELOW THE NARROWEST WIDTH (decision 32).
    const n = read()
    const from = n === null || Number.isNaN(n) ? min - 1 : n
    const to = by > 0 ? Math.floor(from) + 1 : Math.ceil(from) - 1
    // ↓ PAST THE NARROWEST WIDTH IS AUTO (decision 31), so a step down from a demo's width leaves the pin. ↑ from
    // below it, a typed 0, is the narrowest.
    const next = by < 0 && to < min ? '' : String(clamp(to))
    if (box.value === next) return
    box.value = next
    entered = true
    mark()
    clearTimeout(pause)
    pause = setTimeout(apply, STEP_PAUSE_MS)
  }
  /** TYPED: it waits for Enter or for the focus to leave, and a step's pause still running is dropped. */
  const typed = (): void => {
    clearTimeout(pause)
    entered = true
    mark()
  }

  box.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'Enter') apply()
    else if (e.key === 'Escape' && entered) {
      // ONE ESCAPE DOES ONE THING, THE INNERMOST FIRST: prevented, so a listener further out, the link's clear, leaves
      // it. With nothing to put back it is not the box's, and goes on to them.
      e.preventDefault()
      show()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      step(e.key === 'ArrowUp' ? 1 : -1)
    }
  })
  box.addEventListener('input', typed)
  box.addEventListener('focusout', apply)

  // THE BOX'S OWN ARROWS (decision 30), a text field having none: shapes, not glyphs, which faces draw differently.
  // Out of the Tab order and of what a screen reader reads, since the box is the spin button and ↑/↓ step it.
  const arrows = document.createElement('span')
  arrows.className = 'field-width-arrows'
  arrows.setAttribute('aria-hidden', 'true')
  for (const [half, by] of [
    ['up', 1],
    ['down', -1],
  ] as const) {
    const el = document.createElement('span')
    el.className = half
    el.append(icon(half === 'up' ? 'step-up' : 'step-down'))
    // THE PRESS'S DEFAULT IS PREVENTED SO THE FOCUS STAYS IN THE BOX: leaving it would apply the entry at once.
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      box.focus({ preventScroll: true })
      step(by)
    })
    arrows.append(el)
  }
  const frame = document.createElement('span')
  frame.className = 'field-width-box'
  frame.append(box, arrows)

  const el = document.createElement('label')
  el.className = 'field-width'
  el.append('width', frame)
  show()
  return {
    el,
    sync() {
      if (!entered) show()
    },
  }
}
