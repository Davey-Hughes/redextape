import type { ControlState } from './controls'

export type PaneEvents = {
  back(): void
  forward(): void
  play(): void
  restart(): void
  extend(): void
  /** A state row was clicked. Absent on panes that have no table. */
  linkState?: (stateId: number) => void
  /** A token in the λ link window was clicked, at this byte offset into the full `lambdaText`. */
  linkLambda?: (byteOffset: number) => void
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.title = title
  b.addEventListener('click', onClick)
  return b
}

/**
 * The ◀ ▶ ⏵ ↺ strip and its step readout, shared by both panes.
 *
 * ONE IMPLEMENTATION, because the two panes' controls are the same controls. `controls.ts` already
 * computed which are live; this file only reflects that, so there is nothing here to get wrong twice.
 *
 * THE CONTINUE BUTTON IS ADDED AND REMOVED, NEVER DISABLED. A `depth-refused` leg has no honest
 * continue — `raise_cap` refuses to clear `depth_capped` — and a greyed-out button still tells the
 * user the operation exists.
 */
export function controlStrip(on: PaneEvents): { el: HTMLElement; update(c: ControlState): void } {
  const el = document.createElement('div')
  el.className = 'controls'
  // `restart` IS `hist.seek(0)`, which clamps to the OLDEST RETAINED frame — step 0 exactly until
  // eviction has happened, `oldestStep` after. "back to step 0" would be wrong the moment history has
  // ever been trimmed, so the title names what the button actually does rather than a step number it
  // cannot promise.
  const restart = button('↺', 'back to the oldest kept step', on.restart)
  const back = button('◀', 'one step back', on.back)
  const forward = button('▶', 'one step forward', on.forward)
  const play = button('⏵', 'play', on.play)
  const step = document.createElement('span')
  step.className = 'step'
  const extend = button('', 'record further', on.extend)
  extend.className = 'extend'
  el.append(restart, back, forward, play, step, extend)

  return {
    el,
    update(c: ControlState) {
      restart.disabled = !c.canRestart
      back.disabled = !c.canBack
      forward.disabled = !c.canForward
      play.disabled = !c.canPlay
      step.textContent = c.stepText
      if (c.continueLabel === null) {
        extend.hidden = true
      } else {
        extend.hidden = false
        extend.textContent = c.continueLabel
      }
    },
  }
}
