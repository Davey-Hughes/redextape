/**
 * THE PLAYER — one `requestAnimationFrame` loop over every playing leg, at the workspace's one speed
 * (Plan 7 part 2 spec §8).
 *
 * **IT REPLACES A `setInterval` PER LEG, AND THE REASON IS THE SPEEDS, NOT TIDINESS.** `transport.ts`'s
 * interval stepped once every 120 ms, about 8 steps a second: `fact(3)`'s 18,574 transitions took about 39
 * minutes. An interval cannot step faster than the display paints anyway, so rates above 60/s take several
 * steps per frame and paint once — `advance` is that arithmetic, kept pure so a node test can hold it.
 *
 * **THE FLAG ON THE LEG IS THE TRUTH, AND THE PLAYER ONLY FOLLOWS IT.** `LegState.playing` is what the step
 * control reads to show `⏸`, and `sessions.ts`'s `resetLegs` clears it when a recompile replaces the
 * history. The player therefore checks the flag on every frame and lets go of a leg whose flag something
 * else cleared, rather than keeping a second copy of "is this playing" that could disagree.
 *
 * **SEMANTICS UNCHANGED:** play walks recorded frames, stops at the recorded frontier, and never asks the
 * worker for more — `▶` at the frontier and *continue* do that, so play cannot run away with a cap raise
 * nobody clicked.
 */

/**
 * The longest frame the player honours, in milliseconds. A tab in the background gets no frames, and the
 * first one back can report seconds of elapsed time; without a clamp, 5,000/s would jump thousands of steps
 * in one paint.
 */
export const MAX_FRAME_MS = 100

/**
 * How many steps one frame takes, and the fraction left over for the next.
 *
 * **THE FRACTION IS CARRIED, NOT DROPPED.** At 8/s a 60 Hz frame is worth 0.13 of a step; rounding each frame
 * would take none, ever.
 */
export function advance(carry: number, speed: number, elapsedMs: number): { steps: number; carry: number } {
  const total = carry + (speed * Math.min(elapsedMs, MAX_FRAME_MS)) / 1000
  const steps = Math.floor(total)
  return { steps, carry: total - steps }
}

/** What the player needs of a leg: its flag, and a history it can step forward. `LegState` is one. */
export type Playable = { playing: boolean; readonly hist: { forward(): boolean } }

export type Player = {
  /** Start `leg` playing, or stop it if it is playing — the play button's one gesture. */
  toggle(leg: Playable): void
}

/**
 * Build the player.
 *
 * `frame` IS INJECTABLE SO A NODE TEST CAN DRIVE THE CLOCK BY HAND; the app passes nothing and gets
 * `requestAnimationFrame`. `speed` IS A THUNK, read on every frame, so a speed change takes effect on the
 * next paint without the player being told.
 */
export function createPlayer(deps: {
  speed(): number
  draw(): void
  frame?: (cb: (now: number) => void) => void
}): Player {
  const frame = deps.frame ?? ((cb: (now: number) => void) => void requestAnimationFrame(cb))
  const carries = new Map<Playable, number>()
  let last: number | null = null
  let scheduled = false

  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    frame(tick)
  }

  function tick(now: number): void {
    scheduled = false
    const elapsed = last === null ? 0 : now - last
    last = now
    let changed = false
    for (const [leg, carry] of carries) {
      if (!leg.playing) {
        carries.delete(leg)
        continue
      }
      const { steps, carry: rest } = advance(carry, deps.speed(), elapsed)
      carries.set(leg, rest)
      for (let i = 0; i < steps; i++) {
        if (leg.hist.forward()) {
          changed = true
          continue
        }
        leg.playing = false
        carries.delete(leg)
        changed = true
        break
      }
    }
    if (changed) deps.draw()
    if (carries.size > 0) schedule()
    else last = null
  }

  return {
    toggle(leg: Playable): void {
      if (leg.playing) {
        leg.playing = false
        carries.delete(leg)
        return
      }
      leg.playing = true
      carries.set(leg, 0)
      schedule()
    },
  }
}
