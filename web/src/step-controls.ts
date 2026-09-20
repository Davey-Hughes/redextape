import type { ControlState } from './controls'
import { n } from './format'
import { icon } from './icons'
import type { PaneEvents } from './pane-chrome'
import { isSpeed, SPEEDS } from './workspace'

/**
 * THE STEP CONTROLS — Plan 7 part 2 spec §8: `↺ ◀ ▶ ⏵ 8/s ▾ step 212 of 1,319 [continue]`. One component;
 * `controls.ts` decides what is live and this only reflects it, as `controlStrip` did.
 *
 * **EVERY BUTTON IS NAMED IN WORDS (umbrella §4 rule 1).** `↺ ◀ ▶` stay as text — Hack draws them, and a
 * glyph a user has seen on every transport is its own best label — with their tooltips as their accessible
 * names; `controlStrip` left the glyph as the name, so a screen reader said "black right-pointing
 * triangle".
 *
 * **PLAY SHOWS ITS STATE (rule 3).** While a leg plays, the button is `⏸` and named *pause*; a second click
 * pauses. The old button never changed, and playback looked like nothing had happened.
 *
 * **ONE SPEED FOR THE WHOLE WORKSPACE**, shown here and set here, in steps a second. The select's options are
 * `workspace.ts`'s `SPEEDS`; `on.setSpeed` writes the workspace, and the next draw shows every step control
 * the new value.
 *
 * **THE CONTINUE BUTTON IS ADDED AND REMOVED, NEVER DISABLED** — `controlStrip`'s rule, kept: a
 * `depth-refused` leg has no honest continue, and a greyed-out button still says the operation exists.
 */
export function stepControls(
  on: Pick<PaneEvents, 'back' | 'forward' | 'play' | 'restart' | 'extend' | 'speed' | 'setSpeed'>,
): { readonly el: HTMLElement; update(c: ControlState): void } {
  const el = document.createElement('div')
  el.className = 'controls'

  const named = (text: string, name: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    b.title = name
    b.setAttribute('aria-label', name)
    b.addEventListener('click', run)
    return b
  }
  // `restart` IS `hist.seek(0)`, WHICH CLAMPS TO THE OLDEST RETAINED FRAME — the name says what it does
  // rather than promising a step 0 an evicted history no longer holds (`controlStrip`'s own comment).
  const restart = named('↺', 'back to the oldest kept step', on.restart)
  const back = named('◀', 'one step back', on.back)
  const forward = named('▶', 'one step forward', on.forward)

  const play = document.createElement('button')
  play.type = 'button'
  play.className = 'play'
  play.addEventListener('click', on.play)
  let shownPlaying: boolean | null = null
  const paintPlay = (playing: boolean): void => {
    if (playing === shownPlaying) return
    shownPlaying = playing
    const name = playing ? 'pause' : 'play'
    play.replaceChildren(icon(playing ? 'pause' : 'play'))
    play.title = name
    play.setAttribute('aria-label', name)
  }

  const speed = document.createElement('select')
  speed.className = 'speed'
  speed.title = 'playback speed'
  speed.setAttribute('aria-label', 'playback speed')
  for (const s of SPEEDS) speed.append(new Option(`${n(s)}/s`, String(s)))
  // `change`, NOT `input` — the binding selector's old reason: a keyboard user arrowing the list would
  // otherwise set every speed they pass on the way.
  speed.addEventListener('change', () => {
    const v = Number(speed.value)
    if (isSpeed(v)) on.setSpeed(v)
  })

  const step = document.createElement('span')
  step.className = 'step'
  // THE CONTINUE BUTTON'S LABEL IS ITS OWN TEXT, WHICH `controls.ts` CHOOSES PER STOP REASON — `continue
  // — raise the step cap` or `keep recording`. It carries no `aria-label` so the two cannot disagree, and
  // no `title` either: a tooltip reading `record further` beside a label reading something else is two
  // names for one control, which a screen reader announces one after the other.
  const extend = named('', '', on.extend)
  extend.className = 'extend'
  extend.removeAttribute('aria-label')
  extend.removeAttribute('title')

  el.append(restart, back, forward, play, speed, step, extend)

  return {
    el,
    update(c: ControlState): void {
      restart.disabled = !c.canRestart
      back.disabled = !c.canBack
      forward.disabled = !c.canForward
      play.disabled = !c.canPlay
      paintPlay(c.playing)
      const want = String(on.speed())
      if (speed.value !== want) speed.value = want
      step.textContent = c.stepText
      if (c.continueLabel === null) {
        // A CONTROL THAT GOES AWAY UNDER THE KEYBOARD MUST NOT TAKE THE FOCUS WITH IT (umbrella rule 5,
        // spec §11). The nearest control that still works takes it: forward, then play, back, restart.
        //
        // **AND WHEN NONE OF THEM IS LIVE, THE SPEED SELECT IS** — a leg that is not available disables
        // all four at once (`controls.ts`'s unavailable branch returns every `can*` false AND no
        // continue label), which is exactly the state a copy's worker throwing produces while the user
        // is on that view's continue button. The select is never disabled: the workspace's speed is a
        // setting, not a property of this leg.
        if (document.activeElement === extend) {
          const next = [forward, play, back, restart].find((b) => !b.disabled)
          ;(next ?? speed).focus()
        }
        extend.hidden = true
      } else {
        extend.hidden = false
        extend.textContent = c.continueLabel
      }
    },
  }
}
