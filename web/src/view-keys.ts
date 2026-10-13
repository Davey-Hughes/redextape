import { HEADER_ORDER, KIND_WORD } from './layout'
import type { PaneKind } from './panes'

/**
 * VIEW KEYS — the view layouts spec §7: a prefix chord, then one key, and the app's first keys that are not an
 * editor's or a focused control's.
 *
 * **ONE ACTION A PREFIX, AND THE REASON.** A mode that stayed armed would take the next `]` or `j` meant for the editor
 * under the focus, and under the vim keymap those are the keys a user presses next. So the key after the prefix acts
 * and the machine is idle again; a key it does not know ends the mode and is handled as if it had never been armed.
 *
 * **THE KEY AFTER THE PREFIX ACTS WHETHER OR NOT `Ctrl` IS STILL DOWN, AND NONE OF THEM IS A KEY THE BROWSER KEEPS
 * UNDER `Ctrl`** (the user's report, 2026-10-11). Holding the prefix's modifier through the second key is the natural
 * motion, and the cycle keys were `n` and `p`: `Ctrl+N` opened a new window, which no page can stop, and `Ctrl+P`
 * printed. They are `]` and `[` now.
 *
 * `step` is the machine and has no DOM in it. `wireViewKeys` is the one listener that feeds it.
 */

/** A key press as the machine reads it: `KeyboardEvent.key`, and which modifiers are down. */
export type KeyPress = {
  readonly key: string
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
}

/** What an armed key asks the app to do. */
export type ViewKeyAction =
  | { readonly kind: 'cycle'; readonly step: 1 | -1 }
  | { readonly kind: 'toggle'; readonly pane: PaneKind }

/** The prefix chord: `Ctrl` and `.` alone (spec §7.2). */
export const PREFIX: KeyPress = { key: '.', ctrl: true, alt: false, shift: false, meta: false }

/** How the prefix is written for a reader: in the hint, and in the help page's table. */
export const PREFIX_LABEL = 'Ctrl+.'

/**
 * The keys an armed machine answers, in the order the hint and the help page list them: the key, what it does, and
 * the words for it. `Escape` and the prefix pressed again leave and do nothing; they are `step`'s, not rows here.
 *
 * **THE TOGGLE KEYS ARE `HEADER_ORDER`'s POSITIONS**, `1` to `4`, so the keys and the header's buttons cannot be in
 * two orders.
 */
export const VIEW_KEYS: readonly { readonly key: string; readonly action: ViewKeyAction; readonly does: string }[] = [
  { key: ']', action: { kind: 'cycle', step: 1 }, does: 'the next layout' },
  { key: '[', action: { kind: 'cycle', step: -1 }, does: 'the previous layout' },
  ...HEADER_ORDER.map((pane, i) => ({
    key: String(i + 1),
    action: { kind: 'toggle', pane } as const,
    does: `show or hide ${KIND_WORD[pane]}`,
  })),
]

/**
 * What the hint lists while the mode is armed, in its order: every row of the table, and then the way out, which
 * is `step`'s and no row of the table.
 */
export const HINT_ROWS: readonly { readonly key: string; readonly does: string }[] = [
  ...VIEW_KEYS,
  { key: 'Esc', does: `or ${PREFIX_LABEL} leave` },
]

/**
 * The hint as one sentence, for the live region when the mode is armed: `view keys: ] the next layout, [ the previous
 * layout, …, Esc or Ctrl+. leave`.
 *
 * **IT SAYS WHAT THE HINT SHOWS, ROW FOR ROW.** The live region said `view keys` and no more, so a reader who does
 * not see the hint was told a mode had begun and not one key of it. Leaving the mode says nothing: what follows a
 * key is said by what the key did, and after `Escape` nothing happened.
 */
export const HINT_SENTENCE = `view keys: ${HINT_ROWS.map((row) => `${row.key} ${row.does}`).join(', ')}`

/**
 * The keys a modifier makes on its own; one pressed while the machine is armed is not the key it waits for.
 *
 * **THE LIST IS THE UI EVENTS KEY VALUES' OWN**: the twelve of its table of modifier keys and the two it calls
 * legacy, `Hyper` and `Super`. It was six of them, and a lock key ended the mode: measured (2026-10-12), `NumLock`
 * and `ScrollLock` pressed after the prefix each left it.
 */
const MODIFIERS: ReadonlySet<string> = new Set([
  'Alt',
  'AltGraph',
  'CapsLock',
  'Control',
  'Fn',
  'FnLock',
  'Hyper',
  'Meta',
  'NumLock',
  'ScrollLock',
  'Shift',
  'Super',
  'Symbol',
  'SymbolLock',
])

/** A press an armed machine may answer: no `Alt` and no `Meta`. `Ctrl`, the prefix's own modifier, may still be down. */
const bare = (p: KeyPress): boolean => !p.alt && !p.meta
const isPrefix = (p: KeyPress): boolean =>
  p.key === PREFIX.key &&
  p.ctrl === PREFIX.ctrl &&
  p.alt === PREFIX.alt &&
  p.shift === PREFIX.shift &&
  p.meta === PREFIX.meta

/** What a key press does to the machine: whether it is armed after, whether the press is the machine's, and the action. */
export type Step = { readonly armed: boolean; readonly consume: boolean; readonly action: ViewKeyAction | null }

/**
 * Feed one key press to the machine.
 *
 * | state | press | after | consumed | action |
 * | --- | --- | --- | --- | --- |
 * | idle | the prefix | armed | yes | none |
 * | idle | anything else | idle | no | none |
 * | armed | a modifier alone | armed | no | none |
 * | armed | a key of `VIEW_KEYS`, no `Alt` or `Meta` down, `Ctrl` held or not | idle | yes | its action |
 * | armed | `Escape` with no `Alt` or `Meta` down, or the prefix again | idle | yes | none |
 * | armed | anything else, `Escape` with `Alt` or `Meta` down included | idle | no | none |
 *
 * **A PRESS THAT IS NOT CONSUMED IS NOT TOUCHED**: the listener lets it go on to the editor or control under the
 * focus, so a key the machine does not know types what it always typed.
 */
export function step(armed: boolean, press: KeyPress): Step {
  if (!armed) return { armed: isPrefix(press), consume: isPrefix(press), action: null }
  if (MODIFIERS.has(press.key)) return { armed: true, consume: false, action: null }
  if (isPrefix(press) || (press.key === 'Escape' && bare(press))) return { armed: false, consume: true, action: null }
  const row = bare(press) ? VIEW_KEYS.find((r) => r.key === press.key) : undefined
  if (row === undefined) return { armed: false, consume: false, action: null }
  return { armed: false, consume: true, action: row.action }
}

/**
 * Listen for view keys on `target`, in the capture phase: before an editor's keymap, and before the vim extension's
 * own `keydown` handler, which `editor-keymap.ts` records as running ahead of every keymap.
 *
 * - `act` is handed each action; `armed` is told each time the mode is entered or left, for the hint and the live
 *   region.
 * - `blocked` is asked of a press that would arm the mode, and of every press while it is armed: while it answers
 *   true (a modal dialog is open) an idle machine stays idle, an armed one is left, and the press is not touched. It
 *   is not asked of any other press, which is every key typed while the mode is idle; it was asked of each of them.
 * - A press that is part of a composition is not a key press to the machine.
 * - A pointer press, or the window losing the focus, ends an armed mode. Nothing ends it on a timer.
 *
 * **A KEY HELD DOWN IS ONE PRESS, AND ITS REPEATS GO THE WAY ITS PRESS WENT.** A held key sends a `keydown` for the
 * press and one more for each repeat, marked `repeat`. The machine is fed the press alone. A repeat of a press this
 * listener consumed is consumed too and does nothing; a repeat of a press it let through is let through. Measured
 * while every `keydown` was fed to the machine (2026-10-12): the prefix held for one repeat armed the mode and left
 * it again; `2` held after the prefix hid the asm view and typed `22` into the source editor, and under the vim keymap
 * left `22` as a count, so the next `x` deleted the line; and `Ctrl` held with `]` held went to the next layout and
 * indented the source line at each repeat.
 *
 * **A REPEAT IS TOLD BY ITS `code`, THE KEY ON THE KEYBOARD, WHATEVER WAS PRESSED OR RELEASED SINCE ITS PRESS.** The
 * prefix held while `Ctrl` is let go repeats as `.` alone, and those repeats are still the prefix's: consumed, and no
 * `.` typed. A key the editor was given, still held while the prefix is pressed, repeats into the editor and does not
 * end the mode. `taken` holds the `code` of each key whose last press was consumed: a repeat follows a press of its
 * own key, so what it finds there is what became of that press.
 */
export function wireViewKeys(
  target: Window,
  on: { act(action: ViewKeyAction): void; armed(now: boolean): void; blocked(): boolean },
): void {
  let armed = false
  const taken = new Set<string>()
  const set = (next: boolean): void => {
    if (next === armed) return
    armed = next
    on.armed(armed)
  }
  const take = (e: KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
  }
  target.addEventListener(
    'keydown',
    (e) => {
      if (e.repeat) {
        if (taken.has(e.code)) take(e)
        return
      }
      taken.delete(e.code)
      if (e.isComposing) return
      const next = step(armed, { key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey })
      if (!armed && !next.armed) return
      if (on.blocked()) {
        set(false)
        return
      }
      if (next.consume) {
        taken.add(e.code)
        take(e)
      }
      set(next.armed)
      if (next.action !== null) on.act(next.action)
    },
    { capture: true },
  )
  target.addEventListener('pointerdown', () => set(false), { capture: true })
  target.addEventListener('blur', () => set(false))
}
