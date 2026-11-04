import type { ControlState } from './controls'
import { focusHolder, handOff } from './focus-handoff'
import { n } from './format'
import { icon } from './icons'
import type { PaneEvents } from './pane-chrome'
import { isSpeed, SPEEDS } from './workspace'

/**
 * THE STEP CONTROLS — Plan 7 part 2 spec §8: `↺ ◀ ▶ ⏭ ⏵ 8/s ▾ step 212 of 1,319 [continue]`. One component;
 * `controls.ts` decides what is live, and this draws it from that state and the focus alone.
 *
 * **EVERY BUTTON IS NAMED IN WORDS (umbrella §4 rule 1).** `↺ ◀ ▶` stay as text — Hack draws them, and a
 * glyph a user has seen on every transport is its own best label — with their tooltips as their accessible
 * names; a glyph left as its own name is read out by a screen reader as "black right-pointing triangle".
 * `⏭` is an icon, as `⏵` is: Hack lacks both (`icons.ts`).
 *
 * **`⏭` IS `↺`'S OTHER END.** A run opens on step 0 (`History`), so the newest recorded step is a click away
 * rather than a play through every step between.
 *
 * **PLAY SHOWS ITS STATE (rule 3).** While a leg plays, the button is `⏸` and named *pause*; a second click
 * pauses. A button that never changed would make playback look like nothing had happened.
 *
 * **ONE SPEED FOR THE WHOLE WORKSPACE**, shown here and set here, in steps a second. The select's options are
 * `workspace.ts`'s `SPEEDS`; `on.setSpeed` writes the workspace, and the next draw shows every step control
 * the new value.
 *
 * **THE CONTINUE BUTTON IS ADDED AND REMOVED, NEVER DISABLED**: a `depth-refused` leg has no honest
 * continue, and a greyed-out button still says the operation exists.
 */
export function stepControls(
  on: Pick<PaneEvents, 'back' | 'forward' | 'toNewest' | 'play' | 'restart' | 'extend' | 'speed' | 'setSpeed'>,
): { readonly el: HTMLElement; update(c: ControlState): void } {
  const el = document.createElement('div')
  el.className = 'controls'

  const named = (text: string, name: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    b.title = name
    b.setAttribute('aria-label', name)
    // A BUTTON WAITING ON A RECORDING (`update`) IS OFF AND STILL TAKES A PRESS, which must do nothing, as on a
    // disabled one: `transport.ts` answers a press that moves nothing by still taking the leg from a link's position.
    b.addEventListener('click', () => {
      if (b.ariaDisabled !== 'true') run()
    })
    return b
  }
  // `restart` IS `hist.seek(0)`, WHICH CLAMPS TO THE OLDEST RETAINED FRAME — the name says what it does
  // rather than promising a step 0 an evicted history no longer holds.
  const restart = named('↺', 'back to the oldest kept step', on.restart)
  const back = named('◀', 'one step back', on.back)
  const forward = named('▶', 'one step forward', on.forward)
  const toNewest = named('', 'to the newest recorded step', on.toNewest)
  toNewest.className = 'to-newest'
  toNewest.append(icon('to-newest'))

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
  // `change`, NOT `input`: a keyboard user arrowing the list would otherwise set every speed they pass
  // on the way.
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

  el.append(restart, back, forward, toNewest, play, speed, step, extend)

  // EACH STEP BUTTON, WHAT KEEPS IT LIVE, AND WHERE ITS FOCUS GOES WHEN IT IS DISABLED UNDER IT, which would drop the
  // focus to `<body>` (`extend-focus-probe.test.ts`). `◀`, `▶` and `⏭` go off under their own press at the end they
  // move towards, and all five under a state change: playback reaching the end, a recording moving the head, a new run,
  // an unavailable leg. `◀` and `▶` hand to the button that steps the other way, then on along the strip that way, then
  // the rest; `⏭` to `▶`, live where the run can record further, so that the next Enter does, and else as `▶`'s does;
  // `⏵` to the strip leftwards, nearest first; every list ends on the speed select, which is never disabled. `↺` goes
  // off only with the history empty or the leg unavailable, when the other four are off too, so it reaches the speed
  // select; its list runs from `▶` as `◀`'s does in case `controls.ts` turns it off alone.
  const buttons: readonly {
    readonly button: HTMLButtonElement
    readonly can: Extract<keyof ControlState, `can${string}`>
    readonly handTo: readonly HTMLElement[]
    /** Whether a recording carrying the head can turn it off, so that it waits for the recording (`update`). */
    readonly waits: boolean
  }[] = [
    { button: restart, can: 'canRestart', handTo: [forward, toNewest, play, back, speed], waits: false },
    { button: back, can: 'canBack', handTo: [forward, toNewest, play, restart, speed], waits: false },
    { button: forward, can: 'canForward', handTo: [back, restart, toNewest, play, speed], waits: true },
    { button: toNewest, can: 'canToNewest', handTo: [forward, back, restart, play, speed], waits: true },
    { button: play, can: 'canPlay', handTo: [toNewest, forward, back, restart, speed], waits: false },
  ]
  const waitable = buttons.filter((x) => x.waits).map((x) => x.button)
  const stop = (b: HTMLButtonElement): void => {
    if (b.ariaDisabled !== 'true' || focusHolder() === b) return
    b.ariaDisabled = null
    b.disabled = true
  }
  // A WAITING BUTTON THE FOCUS LEAVES IS DISABLED AT ONCE, so that it leaves the Tab order now rather than at the
  // recording's next update, which a strip off the page is not sent. It still holds the focus where the window loses
  // it, which leaves `activeElement` on the button, and through a rebuild that gives the focus back (`focusHolder`).
  for (const b of waitable) b.addEventListener('blur', () => stop(b))
  // **A WAITING BUTTON TAKEN OFF THE PAGE STOPS WAITING AT THE NEXT MICROTASK CHECKPOINT**, whether or not a `blur`
  // said so: Firefox sends a focused button taken off the page none, and `stop` passes over the one a rebuild that
  // gives the focus back sends. Read then, so that a rebuild that puts the button back and gives it the focus in the
  // same synchronous call (`focus-handoff.ts`'s `keepFocusOn`) leaves it waiting, and one that puts its view away does
  // not. Disabled, it is no Tab stop; the speed select, never disabled, still is.
  let watching = false
  const offPage = new MutationObserver(() => {
    for (const b of waitable) stop(b)
    watch(waitable.some((b) => b.ariaDisabled === 'true'))
  })
  const watch = (on: boolean): void => {
    if (on === watching) return
    watching = on
    if (on) offPage.observe(document, { childList: true, subtree: true })
    else offPage.disconnect()
  }

  return {
    el,
    update(c: ControlState): void {
      // **`[continue]` GOING AWAY UNDER THE FOCUS AS ITS RECORDING STARTS HANDS IT TO `▶` FIRST**, live as `[continue]`
      // was, the two being one operation (`controls.ts`'s `canRecordFurther`): `▶` then takes its state as the button
      // holding the focus, and waits, so that the Enter after the next stop records further rather than playing on `⏵`.
      // The holder is read after this hand-off, so a button the focus did not reach never waits.
      if (c.continueLabel === null && c.recording) handOff(extend, [forward])
      // **THE BUTTON HOLDING THE FOCUS TAKES ITS STATE LAST**, so its hand-off reads the strip as this update leaves it
      // (`◀` at a two-step run's step 1 turns `▶` on), and **ITS HAND-OFF COMES BEFORE ITS DISABLE**, so the focus is
      // never left on a disabled control for the browser to blur, whenever it does. Read by `focusHolder`, so that a
      // rebuild that gives the focus back draws the button it took it from as holding it.
      const focused = focusHolder()
      let held: (typeof buttons)[number] | undefined
      for (const b of buttons) {
        if (b.button === focused) held = b
        else {
          if (b.waits) b.button.ariaDisabled = null
          b.button.disabled = !c[b.can]
        }
      }
      if (held !== undefined) {
        const live = c[held.can]
        // **A `▶` OR `⏭` A RECORDING CARRYING THE HEAD TURNS OFF UNDER THE FOCUS WAITS FOR IT, FOCUSED**, off by
        // `aria-disabled`, while it records: a hand-off then would pass `▶`, off while it records, and leave the Enter
        // after a `capped` or `budget` stop on `◀`, stepping back. At such a stop `▶` is live again and `⏭` hands to it,
        // as at a run already stopped there, so that Enter records further. Only the focused button waits: elsewhere it
        // is a dead Tab stop.
        const waits = !live && held.waits && c.recording
        held.button.ariaDisabled = waits ? 'true' : null
        if (!live && !waits) handOff(held.button, held.handTo)
        held.button.disabled = !live && !waits
      }
      watch(held?.button.ariaDisabled === 'true')
      paintPlay(c.playing)
      const want = String(on.speed())
      if (speed.value !== want) speed.value = want
      step.textContent = c.stepText
      if (c.continueLabel === null) {
        // A CONTROL THAT GOES AWAY UNDER THE KEYBOARD MUST NOT TAKE THE FOCUS WITH IT (umbrella rule 5,
        // Plan 7 part 2 spec §11). `focus-handoff.ts` is that rule; the CANDIDATE ORDER stays this
        // control's own, which is why it is spelled out here rather than computed. The nearest control
        // that still works takes it: forward, then ⏭, play, back, restart.
        //
        // **AND WHEN NONE OF THEM IS LIVE, THE SPEED SELECT IS** — a leg that is not available disables
        // all five at once (`controls.ts`'s unavailable branch returns every `can*` false AND no
        // continue label), which is exactly the state a copy's worker throwing produces while the user
        // is on that view's continue button. The select is never disabled: the workspace's speed is a
        // setting, not a property of this leg. **OF THE SIX, THE SELECT IS THE NEAREST BEFORE THE CONTINUE
        // BUTTON**, so `focus-handoff.ts`'s own `nearest` would hand it the focus in every case — which is
        // the whole reason this list is written down instead.
        handOff(extend, [forward, toNewest, play, back, restart, speed])
        extend.hidden = true
      } else {
        extend.hidden = false
        extend.textContent = c.continueLabel
      }
    },
  }
}
