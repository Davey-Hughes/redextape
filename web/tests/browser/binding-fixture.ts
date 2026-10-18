import type { Leg } from '../../src/protocol'
import type { SessionId } from '../../src/session-client'
import { bindingKey } from '../../src/view-header'

/**
 * A view's binding, picked through its title menu, for the files that rebind a view to a session. It is kept out of
 * `harness.ts`, which every browser file loads, because it needs `src/view-header` at run time.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names end in
 * `.test.ts`, and this one does not.
 */

/** Rebind `pane` to `(leg, session)` through its title menu — the gesture a user makes through the
 * control, not a direct write to whatever `main.ts` holds underneath it. */
export const pickSessionBinding = (pane: HTMLElement, target: { leg: Leg; session: SessionId }): void => {
  const title = pane.querySelector<HTMLButtonElement>('button.view-title')
  if (title === null) throw new Error('no title-selector on this view')
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const item = menu?.querySelector<HTMLButtonElement>(
    `button[data-binding="${bindingKey(target.leg, target.session)}"]`,
  )
  if (item == null) throw new Error(`this view offers no ${bindingKey(target.leg, target.session)}`)
  item.click()
}
