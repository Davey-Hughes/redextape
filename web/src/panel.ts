import { icon } from './icons'

/**
 * A named, collapsible region of a view (Plan 7 part 1, spec §8).
 *
 * THE STATE IS `aria-expanded`, NOT THE LABEL. A control that relabels itself announces nothing — accessibility
 * item 2. A disclosure button keeps one name and carries its state as an attribute a screen reader reads.
 *
 * THE BODY IS THE CALLER'S OWN ELEMENT, wrapped rather than copied, so the view keeps its references,
 * its listeners and its class-based rules, and the panel only decides whether the body is `hidden`.
 *
 * `onToggle` FIRES FOR A GESTURE ONLY. `setOpen` is how a view restores or resets a panel, and a view
 * must not hear its own write back as a user's choice.
 *
 * WHAT IS DRAWN IS NOT ALWAYS WHAT IS STORED (the view layouts spec §11.3). A maximised panel's stack draws every
 * other panel closed and leaves what each one stores alone: `drawOver` says what to draw, `isOpen` answers what is
 * drawn, since every reader of it is deciding whether to draw into the body, and `onDrawn` tells the view its body
 * was shown or hidden with no gesture on its own disclosure. A press on the disclosure flips what is DRAWN, and
 * stores that: a panel drawn closed under a maximise opens, whatever it stored.
 */
export type PanelOptions = {
  /** Stable, for style rules and tests: `data-panel` on the panel. */
  readonly name: string
  /** What the disclosure button says. */
  readonly label: string
  readonly body: HTMLElement
  readonly open?: boolean
  readonly onToggle?: (open: boolean) => void
  /** The body was shown or hidden by `drawOver`, not by a gesture: draw into it, or stop. */
  readonly onDrawn?: () => void
}

export type Panel = {
  readonly el: HTMLElement
  readonly toggle: HTMLButtonElement
  /** Header actions sit here, after the disclosure — `follow current rule` on the rules panel. */
  readonly actions: HTMLElement
  readonly body: HTMLElement
  /** Whether the body is drawn: what the panel stores, or what `drawOver` draws over it. */
  isOpen(): boolean
  setOpen(open: boolean): void
  /** Draw the panel open or closed whatever it stores, or, with `null`, as it stores. */
  drawOver(over: boolean | null): void
  /** Hear every gesture on the disclosure, after the view's own `onToggle` has: what the panel now stores. */
  onGesture(heard: (open: boolean) => void): void
}

let minted = 0

export function createPanel(opts: PanelOptions): Panel {
  const n = minted++
  const el = document.createElement('section')
  el.className = 'panel'
  el.dataset.panel = opts.name

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'panel-toggle'
  toggle.id = `panel-toggle-${n}`
  const label = document.createElement('span')
  label.className = 'panel-name'
  label.textContent = opts.label
  toggle.append(icon('disclose'), label)

  const actions = document.createElement('span')
  actions.className = 'panel-actions'

  const header = document.createElement('div')
  header.className = 'panel-header'
  header.append(toggle, actions)

  const body = opts.body
  if (body.id === '') body.id = `panel-body-${n}`
  // A BODY THAT ALREADY SAYS WHAT IT IS KEEPS ITS ROLE: `virtual-grid.ts`'s box is a `grid`, and stays one inside its
  // panel, labelled by the toggle all the same. Every other body is a plain container, and a region is what the
  // toggle discloses.
  if (!body.hasAttribute('role')) body.setAttribute('role', 'region')
  body.setAttribute('aria-labelledby', toggle.id)
  toggle.setAttribute('aria-controls', body.id)
  el.append(header, body)

  let open = opts.open ?? true
  let over: boolean | null = null
  const drawn = (): boolean => over ?? open
  const apply = (): void => {
    toggle.setAttribute('aria-expanded', String(drawn()))
    el.dataset.open = String(drawn())
    body.hidden = !drawn()
  }
  apply()
  const hearers: ((open: boolean) => void)[] = []
  toggle.addEventListener('click', () => {
    open = !drawn()
    over = null
    apply()
    opts.onToggle?.(open)
    for (const heard of hearers) heard(open)
  })

  return {
    el,
    toggle,
    actions,
    body,
    isOpen: drawn,
    setOpen(next: boolean) {
      if (next === open) return
      open = next
      apply()
    },
    drawOver(next: boolean | null) {
      const was = drawn()
      over = next
      if (drawn() === was) return
      apply()
      opts.onDrawn?.()
    },
    onGesture(heard: (open: boolean) => void) {
      hearers.push(heard)
    },
  }
}
