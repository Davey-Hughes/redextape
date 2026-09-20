import type { ControlState } from './controls'
import type { PaneEvents } from './pane-chrome'
import type { LeafId } from './panes'
import { stepControls } from './step-controls'
import type { Speed } from './workspace'

/**
 * THE ONE STEP BAR — Plan 7 part 2 spec §8, the `steps` switch at `bar`: one set of step controls along the
 * bottom of the workspace, prefixed with the title of the view it drives.
 *
 * **IT IS `step-controls.ts` AGAIN, NOT A SECOND TRANSPORT.** Everything about what is live, what the play
 * button shows and what the readout says is `controls.ts`'s `ControlState`, reached here through
 * `sessions.ts`'s `legControlState` exactly as a view's own controls reach it through `PaneSlot.render`.
 * What this module adds is which leg, and the words saying so.
 *
 * **THE TITLE IS NOT DECORATION.** One bar driving one of several views is ambiguous the moment there are
 * two; `λ · program` in front of it is what makes every button's meaning unambiguous, and it is the same
 * spelling the view's own title-selector uses (`view-header.ts`'s `pairLabel`), so the two name the same
 * view the same way.
 */

/** What the bar is pointed at right now: the view, its title, and its leg's controls. */
export type BarTarget = {
  readonly id: LeafId
  readonly title: string
  readonly controls: ControlState
}

/** The subset of a view's handlers the bar drives. It picks no pair and closes no view. */
export type BarEvents = Pick<PaneEvents, 'back' | 'forward' | 'play' | 'restart' | 'extend'>

/**
 * The state the bar shows when no view on the page can step (spec §8).
 *
 * **DISABLED WITH ITS REASON, NOT REMOVED** (umbrella §4 rule 4): a bar that vanished when the last λ view
 * closed would leave a user who chose "one bar" with no step controls and nothing saying why. It could
 * apply — opening a view is all it takes — so it says so where the step count goes.
 */
export const NO_TARGET: ControlState = {
  canBack: false,
  canForward: false,
  canPlay: false,
  canRestart: false,
  playing: false,
  continueLabel: null,
  stepText: 'no view can step',
}

/**
 * Which view the bar drives: the focused one when it can step, otherwise the last one that could, otherwise
 * the first that can (spec §8).
 *
 * **PURE, AND SEPARATE FROM THE COMPONENT, BECAUSE THE RULE IS THE PART WORTH PINNING.** "Closing the target
 * retargets" and "a focused source view does not blank the bar" are two sentences about this function and
 * nothing else; a browser test would reach them through a layout gesture and report a DOM state when the
 * question is arithmetic over three ids.
 *
 * `last` IS THE CALLER'S MEMORY, NOT THIS FUNCTION'S. A module-level `let` here would be one memory shared
 * by every caller, which is the shape that makes a second workspace on one page impossible to test.
 */
export function barTarget(focused: LeafId, steppable: readonly LeafId[], last: LeafId | null): LeafId | null {
  if (steppable.includes(focused)) return focused
  if (last !== null && steppable.includes(last)) return last
  return steppable[0] ?? null
}

/**
 * Build the bar.
 *
 * `target` AND `events` ARE BOTH THUNKS, AND BOTH ARE READ AT THE CLICK. `stepControls` wires its listeners
 * once, at construction, so a handler closed over a target would drive whichever view was focused when the
 * page loaded, for the rest of the session.
 */
export function createStepBar(deps: {
  target(): BarTarget | null
  events(id: LeafId): BarEvents | null
  speed(): Speed
  setSpeed(s: Speed): void
}): { readonly el: HTMLElement; update(): void } {
  const el = document.createElement('div')
  el.className = 'step-bar-inner'

  const title = document.createElement('span')
  title.className = 'step-bar-title'

  const run = (what: (e: BarEvents) => void): void => {
    const t = deps.target()
    if (t === null) return
    const e = deps.events(t.id)
    if (e !== null) what(e)
  }

  const controls = stepControls({
    speed: deps.speed,
    setSpeed: deps.setSpeed,
    back: () => run((e) => e.back()),
    forward: () => run((e) => e.forward()),
    play: () => run((e) => e.play()),
    restart: () => run((e) => e.restart()),
    extend: () => run((e) => e.extend()),
  })

  el.append(title, controls.el)

  let rendered: string | null = null
  return {
    el,
    update(): void {
      const t = deps.target()
      const text = t === null ? '' : t.title
      // COMPARED BEFORE IT IS WRITTEN, for `createReadout`'s reason: this runs on every recorded frame
      // during playback and the title changes only when the focus moves.
      if (rendered !== text) {
        rendered = text
        title.textContent = text
        title.hidden = text === ''
      }
      controls.update(t === null ? NO_TARGET : t.controls)
    },
  }
}
