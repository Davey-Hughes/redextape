import { icon } from './icons'

/**
 * A named, collapsible region of a view (Plan 7 part 1, spec §8) — the one disclosure mechanism, where
 * there used to be a one-off toggle per view.
 *
 * THE STATE IS `aria-expanded`, NOT THE LABEL. The controls this replaces relabelled themselves (`hide δ`
 * / `show δ`, `⌃` / `⌄`) and announced nothing — accessibility item 2. A disclosure button keeps one
 * name and carries its state as an attribute a screen reader reads.
 *
 * THE BODY IS THE CALLER'S OWN ELEMENT, wrapped rather than copied, so the view keeps its references,
 * its listeners and its class-based rules, and the panel only decides whether the body is `hidden`.
 *
 * `onToggle` FIRES FOR A GESTURE ONLY. `setOpen` is how a view restores or resets a panel, and a view
 * must not hear its own write back as a user's choice.
 */
export type PanelOptions = {
  /** Stable, for style rules and tests: `data-panel` on the panel. */
  readonly name: string
  /** What the disclosure button says. */
  readonly label: string
  readonly body: HTMLElement
  readonly open?: boolean
  readonly onToggle?: (open: boolean) => void
}

export type Panel = {
  readonly el: HTMLElement
  readonly toggle: HTMLButtonElement
  /** Header actions sit here, after the disclosure — `follow current rule` on the rules panel. */
  readonly actions: HTMLElement
  readonly body: HTMLElement
  isOpen(): boolean
  setOpen(open: boolean): void
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
  body.setAttribute('role', 'region')
  body.setAttribute('aria-labelledby', toggle.id)
  toggle.setAttribute('aria-controls', body.id)
  el.append(header, body)

  let open = opts.open ?? true
  const apply = (): void => {
    toggle.setAttribute('aria-expanded', String(open))
    el.dataset.open = String(open)
    body.hidden = !open
  }
  apply()
  toggle.addEventListener('click', () => {
    open = !open
    apply()
    opts.onToggle?.(open)
  })

  return {
    el,
    toggle,
    actions,
    body,
    isOpen: () => open,
    setOpen(next: boolean) {
      if (next === open) return
      open = next
      apply()
    },
  }
}
