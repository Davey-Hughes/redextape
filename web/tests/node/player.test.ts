import { describe, expect, it } from 'vitest'
import { advance, createPlayer, MAX_FRAME_MS, type Playable } from '../../src/player'
import { SPEEDS } from '../../src/workspace'

/** A leg whose history has `frames` steps left to take. */
const leg = (frames: number): Playable & { taken: number } => {
  const l = {
    playing: false,
    taken: 0,
    hist: {
      forward: (): boolean => {
        if (l.taken >= frames) return false
        l.taken += 1
        return true
      },
    },
  }
  return l
}

/** A frame scheduler the test drives by hand: `run(t)` fires every queued callback at time `t`. */
const clock = () => {
  let queued: ((now: number) => void)[] = []
  return {
    frame: (cb: (now: number) => void) => {
      queued.push(cb)
    },
    run(t: number) {
      const now = queued
      queued = []
      for (const cb of now) cb(t)
    },
    get pending() {
      return queued.length
    },
  }
}

describe('advance', () => {
  it('takes at most one step per 60 Hz frame at 60/s and below', () => {
    for (const speed of SPEEDS.filter((s) => s <= 60)) {
      let carry = 0
      for (let i = 0; i < 600; i++) {
        const r = advance(carry, speed, 1000 / 60)
        expect(r.steps).toBeLessThanOrEqual(1)
        carry = r.carry
      }
    }
  })

  it('totals floor(speed × elapsed) over unclamped frames at every ladder value', () => {
    for (const speed of SPEEDS) {
      let carry = 0
      let total = 0
      const frames = [16, 17, 16, 33, 8, 50, 16, 17]
      for (const ms of frames) {
        const r = advance(carry, speed, ms)
        total += r.steps
        carry = r.carry
      }
      const elapsed = frames.reduce((a, b) => a + b, 0)
      // A floating-point carry may land one step short of the exact floor, never over it.
      expect(total).toBeLessThanOrEqual(Math.floor((speed * elapsed) / 1000))
      expect(total).toBeGreaterThanOrEqual(Math.floor((speed * elapsed) / 1000) - 1)
    }
  })

  it('clamps a long frame, so a tab back from the background does not jump', () => {
    expect(advance(0, 5000, 10_000).steps).toBe((5000 * MAX_FRAME_MS) / 1000)
  })
})

describe('createPlayer', () => {
  it('toggles a leg on and off, and draws while it moves', () => {
    const c = clock()
    let draws = 0
    const p = createPlayer({ speed: () => 60, draw: () => draws++, frame: c.frame })
    const l = leg(100)
    p.toggle(l)
    expect(l.playing).toBe(true)
    c.run(0)
    c.run(1000 / 60)
    c.run(2000 / 60)
    expect(l.taken).toBeGreaterThanOrEqual(1)
    expect(draws).toBeGreaterThanOrEqual(1)
    p.toggle(l)
    expect(l.playing).toBe(false)

    // **A LEG STARTED AGAIN BEGINS FROM A FRESH CLOCK, NOT A STALE ONE.** `tick` clears `last` when it
    // runs out of legs, so the first frame after an idle spell is worth no elapsed time at all. Without
    // it that frame is worth the whole pause — bounded by the 100 ms clamp, which is a bound and not an
    // answer: at 5,000/s it is still 500 steps for a pause the user spent reading.
    //
    // THE PENDING FRAME IS DRAINED FIRST: the run above left one queued, and it is the one that finds
    // `carries` empty and clears `last`.
    c.run(100)
    expect(c.pending).toBe(0)
    const taken = l.taken
    p.toggle(l)
    c.run(10_000)
    expect(l.taken).toBe(taken)
  })

  /**
   * **ONE DRAW PER FRAME, AND NONE WHEN NOTHING MOVED** — the whole point of the rewrite. A `setInterval`
   * could not step faster than the display paints; this loop takes as many steps as the speed asks for
   * and repaints once. Asserted as an exact count, because `toBeGreaterThanOrEqual(1)` is satisfied by a
   * draw per STEP (500 repaints in one frame at 5,000/s) and by a draw on a frame where nothing happened.
   */
  it('stops a leg at its recorded frontier, drawing once for the frame and not again', () => {
    const c = clock()
    let draws = 0
    const p = createPlayer({ speed: () => 5000, draw: () => draws++, frame: c.frame })
    const l = leg(3)
    p.toggle(l)
    c.run(0)
    c.run(100)
    expect(l.taken).toBe(3)
    expect(l.playing).toBe(false)
    expect(draws).toBe(1)
    expect(c.pending).toBe(0)
  })

  it('does not draw a frame in which no leg moved', () => {
    const c = clock()
    let draws = 0
    const p = createPlayer({ speed: () => 1, draw: () => draws++, frame: c.frame })
    const l = leg(100)
    p.toggle(l)
    c.run(0)
    // AT 1/s A 16 ms FRAME IS WORTH 0.016 OF A STEP: nothing moves, so nothing is repainted.
    c.run(16)
    expect(l.taken).toBe(0)
    expect(draws).toBe(0)
  })

  /**
   * **ONE LOOP OVER EVERY PLAYING LEG, WHICH IS THE MODULE'S HEADLINE SENTENCE AND WAS UNMEASURED.**
   * `schedule`'s `scheduled` guard is what makes it one: without it, two legs started in the same frame
   * queue two callbacks, each advances both legs, and each draws.
   */
  it('runs one loop for two playing legs, and draws once for both', () => {
    const c = clock()
    let draws = 0
    const p = createPlayer({ speed: () => 60, draw: () => draws++, frame: c.frame })
    const a = leg(100)
    const b = leg(100)
    p.toggle(a)
    p.toggle(b)
    expect(c.pending).toBe(1)
    c.run(0)
    c.run(1000 / 60)
    expect(a.taken).toBe(1)
    expect(b.taken).toBe(1)
    expect(draws).toBe(1)
  })

  it('lets go of a leg whose flag something else cleared', () => {
    const c = clock()
    const p = createPlayer({ speed: () => 60, draw: () => undefined, frame: c.frame })
    const l = leg(100)
    p.toggle(l)
    c.run(0)
    l.playing = false
    c.run(100)
    expect(l.taken).toBe(0)
    expect(c.pending).toBe(0)
  })

  it('reads the speed on every frame', () => {
    const c = clock()
    let speed = 1
    const p = createPlayer({ speed: () => speed, draw: () => undefined, frame: c.frame })
    const l = leg(10_000)
    p.toggle(l)
    c.run(0)
    c.run(100)
    const slow = l.taken
    speed = 5000
    c.run(200)
    expect(l.taken - slow).toBe(500)
  })
})
