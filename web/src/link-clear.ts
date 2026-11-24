import { DRAG_THRESHOLD } from './separator'

/**
 * CLEARING THE LINK BY CLICKING EMPTY SPACE IN A VIEW, OR BY ESCAPE IN ONE
 * (`docs/superpowers/specs/2026-11-17-link-clear-design.md`).
 *
 * A click clears unless it linked, landed on a control or a view's chrome, or ended a drag. Whether a click linked is
 * the view's own handler's answer, read off `LinkWiring.gestures` around it, because only the view knows which of its
 * rows link. The source view is left out: a click there links or clears by the editor's own rule.
 */

/** Where the focus is, as Escape's rule reads it. */
export type EscapeFocus = 'view' | 'body' | 'editor' | 'other'

/** An Escape-candidate key press, and the page around it, as `escapeClears` reads it. */
export type EscapePress = {
  readonly key: string
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
  /** Something before this listener used the press. */
  readonly prevented: boolean
  readonly composing: boolean
  readonly focus: EscapeFocus
  /** A popover, a menu, is open: the browser closes it on this Escape, after the press is dispatched. */
  readonly popoverOpen: boolean
}

/**
 * Whether a key press clears the link.
 *
 * | press | focus | popover open | clears |
 * | --- | --- | --- | --- |
 * | `Escape`, no modifier, not used, not composing | in a view, or on the body | no | yes |
 * | the same | in an editor | any | no: the editor's Escape (completion, search, vim) stays its own |
 * | the same | anywhere else (the header, a dialog) | any | no |
 * | the same | any | yes | no: the Escape closes the menu |
 * | anything else | any | any | no |
 */
export function escapeClears(p: EscapePress): boolean {
  if (p.key !== 'Escape' || p.ctrl || p.alt || p.shift || p.meta || p.prevented || p.composing) return false
  return (p.focus === 'view' || p.focus === 'body') && !p.popoverOpen
}

/**
 * What a click on which keeps the link: a control, a view's or panel's header, an editor, the λ term map (a click
 * there navigates), and the λ view's fold and open toggles. NOT A DIAGRAM NODE OR A RUNTIME BOX, buttons that link
 * or not as a row does, so the gesture count decides for them as it does for rows.
 */
const KEEPS = [
  'button:not(.local-node, .program-box)',
  'a[href]',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[contenteditable]',
  '[role=button]',
  '[role=checkbox]',
  '[role=radio]',
  '[role=switch]',
  '[role=tab]',
  '[role=menuitem]',
  '[role=option]',
  '[role=slider]',
  '[role=separator]',
  '[popover]',
  '.cm-editor',
  '.view-header',
  '.panel-header',
  '.term-map',
  '.term-gutter[data-node]',
  '.term-chip',
  '.term-fold',
].join(', ')

/**
 * Whether a click whose event path is `path` is on empty space in a view: inside a view other than the source, and on
 * nothing `KEEPS` names.
 *
 * **THE PATH, NOT THE TARGET'S ANCESTORS NOW**: a grid's click focuses the grid, and a focus with no press in progress
 * draws at once, so by the time the click reaches `#views` its target may have been replaced and left the page. The
 * path is fixed when the event is dispatched.
 */
export function onEmptySpace(path: readonly EventTarget[]): boolean {
  for (const t of path) {
    if (!(t instanceof Element)) continue
    if (t.matches('section.pane')) return (t as HTMLElement).dataset.kind !== 'source'
    if (t.matches(KEEPS)) return false
  }
  return false
}

/**
 * Clear the link on a click on empty space in a view under `root` (`#views`), and on Escape by `escapeClears`.
 * `unpin` is `LinkWiring.unpin` and `gestures` its count; both are thunks, the wiring being built after this.
 *
 * **AT ONCE, A DOUBLE-CLICK'S FIRST CLICK TOO** (the design doc's section (5) has the user's ruling): the second
 * click finds nothing pinned and lands on the view as redrawn, so a word it selects stays selected.
 */
export function wireLinkClear(root: HTMLElement, on: { unpin(): void; gestures(): number }): void {
  const doc = root.ownerDocument
  /** The press the next click would end: where it was pressed, and the furthest the pointer has been from there. */
  let press: { id: number; x: number; y: number; far: number } | null = null
  let before = 0
  // THE FURTHEST, NOT WHERE IT ENDED: a drag out and back ends where it began, and it was still a drag. Heard on the
  // document, in the capture phase, so a move off the views or one a handler stops still counts.
  const move = (e: PointerEvent) => {
    if (press === null || e.pointerId !== press.id) return
    press.far = Math.max(press.far, Math.hypot(e.clientX - press.x, e.clientY - press.y))
  }
  const release = () => doc.removeEventListener('pointermove', move, true)
  root.addEventListener(
    'pointerdown',
    (e) => {
      release()
      // A PRESS WITH A MENU OPEN IS THE MENU'S: the browser closes the menu on it, and the click it ends does only
      // that, as Escape there does. Read here, before the menu's light dismiss, which follows the press.
      const mine = e.isPrimary && e.button === 0 && doc.querySelector(':popover-open') === null
      press = mine ? { id: e.pointerId, x: e.clientX, y: e.clientY, far: 0 } : null
      if (press !== null) doc.addEventListener('pointermove', move, true)
    },
    { capture: true },
  )
  // READ BEFORE EVERY HANDLER IN A VIEW, in the capture phase, and compared after them all, in the bubble phase.
  root.addEventListener(
    'click',
    () => {
      before = on.gestures()
    },
    { capture: true },
  )
  root.addEventListener('click', (e) => {
    const p = press
    press = null
    release()
    // A CLICK WITH NO PRESS OF ITS OWN IS THE KEYBOARD'S (`detail` 0), Enter or Space on a control. ONE WITH SHIFT
    // EXTENDS A SELECTION, which the clear's redraw would take away with the nodes it is in.
    if (p === null || e.detail === 0 || e.shiftKey) return
    if (p.far > DRAG_THRESHOLD || on.gestures() !== before || !onEmptySpace(e.composedPath())) return
    on.unpin()
  })
  // ON THE DOCUMENT, IN THE BUBBLE PHASE: an armed view key stops its Escape in the capture phase on the window, and an
  // editor's command or a TM view's width box that used the key prevents it, so this acts on none of them.
  doc.addEventListener('keydown', (e) => {
    // EVERY KEY PRESS IN THE EDITOR COMES THIS WAY: the work below is for Escape alone.
    if (e.key !== 'Escape') return
    const a = doc.activeElement
    const focus: EscapeFocus =
      a === null || a === doc.body
        ? 'body'
        : a.closest('.cm-editor') !== null
          ? 'editor'
          : root.contains(a) && a.closest('section.pane') !== null
            ? 'view'
            : 'other'
    const clears = escapeClears({
      key: e.key,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
      prevented: e.defaultPrevented,
      composing: e.isComposing,
      focus,
      popoverOpen: doc.querySelector(':popover-open') !== null,
    })
    if (clears) on.unpin()
  })
}
