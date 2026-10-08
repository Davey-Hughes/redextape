import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it } from 'vitest'
import { History } from '../../src/history'

/**
 * A full collection, on demand: `--expose-gc` set at run time, and the `gc` it exposes read out of a new context, since
 * this one was made before the flag was.
 */
function collector(): () => void {
  setFlagsFromString('--expose-gc')
  return runInNewContext('gc') as () => void
}

/**
 * The `Array` methods that move or copy an array's elements, for `arrayWork`: `Symbol.iterator` is what a spread and a
 * `for…of` read an array through.
 */
const MOVERS: readonly PropertyKey[] = [
  'shift',
  'unshift',
  'splice',
  'slice',
  'copyWithin',
  'concat',
  'filter',
  'map',
  'flat',
  'toSpliced',
  'toSorted',
  'toReversed',
  'with',
  Symbol.iterator,
]

type Method = (...args: unknown[]) => unknown

/**
 * **THE WORK `run` DOES THROUGH THE ARRAY METHODS THAT MOVE OR COPY ELEMENTS, COUNTED IN ELEMENTS RATHER THAN TIMED**:
 * each of `MOVERS`, and `Array.from`, is wrapped while `run` runs, and every call is charged the whole length of the
 * array it reads, so `moved` is an upper bound on the elements those calls moved or copied and `longest` is the
 * longest array any of them met. A count holds on a runner of any speed, where a time would hold only on the machine it
 * was taken on.
 *
 * **ONLY WORK DONE THROUGH THESE METHODS IS COUNTED.** A copy written as a loop over the indices, or made by a method not
 * listed, is charged nothing.
 */
function arrayWork(run: () => void): { moved: number; longest: number } {
  const proto = Array.prototype as unknown as Record<PropertyKey, Method>
  const statics = Array as unknown as Record<'from', Method>
  const saved = new Map(MOVERS.map((key) => [key, proto[key] as Method] as const))
  const from = statics.from
  let moved = 0
  let longest = 0
  const charge = (length: number): void => {
    moved += length
    longest = Math.max(longest, length)
  }
  // `Map.prototype.forEach`, NOT `for (const [key, original] of saved)`: destructuring an entry reads it through the
  // array iterator, which is wrapped here too, so the restore would charge itself two elements an entry.
  saved.forEach((original, key) => {
    proto[key] = function (this: unknown[], ...args: unknown[]): unknown {
      charge(this.length)
      return original.apply(this, args)
    }
  })
  statics.from = function (this: unknown, ...args: unknown[]): unknown {
    charge((args[0] as { length?: number } | null | undefined)?.length ?? 0)
    return from.apply(this, args)
  }
  try {
    run()
  } finally {
    saved.forEach((original, key) => {
      proto[key] = original
    })
    statics.from = from
  }
  return { moved, longest }
}

describe('History', () => {
  let h: History<string>
  beforeEach(() => {
    h = new History<string>(1_000)
  })

  it('starts empty with no current frame', () => {
    expect(h.length).toBe(0)
    expect(h.current).toBeUndefined()
  })

  it('numbers the first frame step 0 — the state before any step', () => {
    h.push('a', 10)
    expect(h.oldestStep).toBe(0)
    expect(h.newestStep).toBe(0)
    h.push('b', 10)
    expect(h.newestStep).toBe(1)
  })

  it('opens on step 0 however many frames arrive', () => {
    h.push('a', 10)
    h.push('b', 10)
    h.push('c', 10)
    expect(h.current).toBe('a')
    expect(h.head).toBe(0)
    expect(h.currentStep).toBe(0)
  })

  it('follows the frontier once stepped to it', () => {
    h.push('a', 10)
    h.push('b', 10)
    expect(h.forward()).toBe(true)
    h.push('c', 10)
    expect(h.current).toBe('c')
    expect(h.head).toBe(h.length - 1) // at the frontier — the newest frame is the current one
    expect(h.currentStep).toBe(2) // firstStep 0, head 2 — no eviction yet
  })

  it('follows the frontier once sought to it', () => {
    h.push('a', 10)
    h.push('b', 10)
    h.seek(1)
    h.push('c', 10)
    expect(h.current).toBe('c')
  })

  it('does not move the head off a scrubbed-back position when new frames arrive', () => {
    h.push('a', 10)
    h.push('b', 10)
    h.seek(1)
    h.back()
    expect(h.current).toBe('a')
    h.push('c', 10)
    expect(h.current).toBe('a')
    expect(h.head).toBe(0) // NOT the frontier (length is now 3) — the push must not have yanked it
  })

  it('clamps back at the oldest and forward at the frontier', () => {
    h.push('a', 10)
    h.push('b', 10)
    expect(h.back()).toBe(false)
    expect(h.forward()).toBe(true)
    expect(h.forward()).toBe(false)
  })

  /**
   * **`▶` AT THE FRONTIER ASKS FOR MORE, AND WHAT ARRIVES CARRIES THE HEAD** (`transport.ts`'s `forward`). A run that
   * opened on its only frame has a head at the frontier that never stepped there.
   */
  it('carries the head into the frames a forward at the frontier asked for', () => {
    h.push('a', 10)
    expect(h.forward()).toBe(false)
    h.push('b', 10)
    expect(h.current).toBe('b')
  })

  it('does not follow from a forward with no frames to stand on', () => {
    expect(h.forward()).toBe(false)
    h.push('a', 10)
    h.push('b', 10)
    expect(h.current).toBe('a')
  })

  // The ring caps BYTES, not frames. `frame_cost_probe` measured λ frames ranging from 5 KB to
  // 781 KB depending only on the program, so a frame count is a memory policy spanning three orders
  // of magnitude.
  it('evicts oldest-first when the frames before the newest pass the byte budget', () => {
    for (let i = 0; i < 5; i++) h.push(`f${i}`, 300)
    // Budget is 1,000; each frame costs 300, so the frames before the newest fit three to a ring (900 bytes), and a
    // 5th push puts four (1,200) before it — evict down to where they fit, oldest-first.
    expect(h.length).toBe(4)
    expect(h.evicted).toBe(true)
    expect(h.oldestStep).toBe(1)
    expect(h.newestStep).toBe(4)
    expect(h.current).toBe('f1')
  })

  /**
   * **A RECORDING THAT SPENDS ITS ALLOWANCE PASSES IT BY UP TO ONE FRAME** (`record-loop.ts` checks before each step),
   * and the allowance is the ring's budget, so the ring keeps that whole recording and the run still opens on step 0.
   */
  it('keeps a recording that passes its budget by its newest frame whole', () => {
    for (let i = 0; i < 4; i++) h.push(`f${i}`, 300)
    expect(h.length).toBe(4)
    expect(h.evicted).toBe(false)
    expect(h.current).toBe('f0')
  })

  it('keeps at least one frame however large it is', () => {
    h.push('huge', 10_000)
    expect(h.length).toBe(1)
    expect(h.current).toBe('huge')
    h.push('next', 10)
    expect(h.length).toBe(1)
    expect(h.current).toBe('next')
  })

  it('clamps the head to the new oldest when the frame it was on is evicted', () => {
    for (let i = 0; i < 4; i++) h.push(`f${i}`, 300)
    h.seek(0)
    const oldest = h.current
    h.push('f4', 300)
    // f0 is gone; the head cannot still point at it, so it clamps to the new oldest and SAYS so.
    expect(h.current).not.toBe(oldest)
    expect(h.head).toBe(0)
    expect(h.oldestStep).toBeGreaterThan(0)
  })

  it('keeps the head on the same frame when an older one is evicted', () => {
    // Head parked at 2 (not the frontier, and not 1) so a single eviction's correct decrement — to
    // 1 — is distinguishable from a mutant that merely zeroes the head or leaves it untouched.
    for (let i = 0; i < 5; i++) h.push(`f${i}`, 210)
    h.seek(2)
    const kept = h.current
    h.push('f5', 210) // evicts only f0; every surviving index drops by exactly one
    expect(h.oldestStep).toBe(1)
    expect(h.current).toBe(kept)
    expect(h.head).toBe(1)
    expect(h.currentStep).toBe(2) // firstStep 1, head 1 — the frame kept its own step number
  })

  it('keeps a parked head on its frame when one push evicts most of the ring', () => {
    // A HUNDRED FRAMES OF 10 FILL THE 1,000, ONE OF 900 PASSES IT AS THE NEWEST, AND ONE MORE OF 10 THEN EVICTS STEPS 0
    // TO 89 IN ONE PUSH: ninety evicted places against twelve frames kept, so the ring cuts its evicted places off
    // inside this one push, with the head parked on step 95 across the cut.
    for (let step = 0; step < 100; step++) h.push(`f${step}`, 10)
    h.push('f100', 900)
    expect(h.oldestStep, 'precondition: nothing evicted before the last push').toBe(0)
    h.seek(95)
    h.push('f101', 10)
    expect(h.oldestStep).toBe(90)
    expect(h.length).toBe(12)
    expect(h.current).toBe('f95')
    expect(h.currentStep).toBe(95)
    expect(h.head).toBe(5)
    h.seek(0)
    expect(h.current).toBe('f90')
    h.seek(99)
    expect(h.current).toBe('f101')
  })

  it('keeps exactly the newest frames that fit, each at its own step, push after push', () => {
    // SIZES THAT EVICT NO FRAME, ONE OR MANY IN A PUSH, AND ONE FRAME OVER THE WHOLE BUDGET, after a run of small frames
    // that fills the ring with hundreds: the ring cuts its evicted places off at many different lengths. Each frame is
    // its own step number, so every frame kept says where it is. THE HEAD IS LEFT WHERE IT OPENED, so it is always on
    // the oldest frame kept.
    const ring = new History<number>(1_000)
    const sizes = [...Array.from({ length: 600 }, () => 1), 7, 300, 2, 50, 999, 3, 1_200, 40, 5]
    const size = (step: number) => sizes[step % sizes.length] ?? 0
    for (let step = 0; step < 5_000; step++) {
      ring.push(step, size(step))
      // THE OLDEST KEPT, WORKED OUT FROM THE SIZES ALONE: the furthest back the frames before the newest still fit the
      // budget, and the newest itself whatever it costs.
      let oldest = step
      let bytes = 0
      while (oldest > 0 && bytes + size(oldest - 1) <= 1_000) {
        oldest -= 1
        bytes += size(oldest)
      }
      expect(ring.oldestStep).toBe(oldest)
      expect(ring.newestStep).toBe(step)
      expect(ring.current).toBe(oldest)
    }
    for (let i = 0; i < ring.length; i++) {
      ring.seek(i)
      expect(ring.current).toBe(ring.currentStep)
    }
  })

  /**
   * **NO EVICTION MOVES OR COPIES THE FRAMES THE RING KEEPS THROUGH AN `Array` METHOD, HOWEVER MANY IT KEEPS**, but the
   * one cut that follows each run of as many evictions as frames kept. `History` used to `shift` both arrays at every
   * eviction, and on a ring as large as a full TM history that moved every frame kept and was most of the page's main
   * thread during *keep recording* (`History`'s doc). TWO RINGS: 1,000 frames, and 69,008, about that TM ring (`map
   * and fold`'s TM history fills at step 69,008). What `arrayWork` charges is what goes through its methods, and only
   * that (its doc).
   *
   * **FOUR ELEMENTS PER EVICTION, AND THE BOUND HAS NO SLACK**: each cut slices the frames and their sizes out of arrays
   * holding as many evicted places again as frames kept, so it is charged four times the frames kept, once per that
   * many evictions: 8,000 for 2,000 evictions at 1,000 kept. Shifting is charged twice the frames kept per eviction.
   */
  it('evicts without moving the frames it keeps, however many it keeps', () => {
    for (const kept of [1_000, 69_008]) {
      // ONE BYTE A FRAME, AND THE FRAMES BEFORE THE NEWEST FIT THE BUDGET, so a budget of `kept - 1` keeps `kept`.
      const ring = new History<number>(kept - 1)
      for (let step = 0; step < kept; step++) ring.push(step, 1)
      const evicting = 2 * kept
      const { moved, longest } = arrayWork(() => {
        for (let step = kept; step < kept + evicting; step++) ring.push(step, 1)
      })
      expect(ring.oldestStep, 'precondition: every push evicted one frame').toBe(evicting)
      expect(ring.length, 'precondition: the ring kept its size').toBe(kept)
      expect(moved, `elements moved evicting ${evicting} frames from ${kept} kept`).toBeLessThanOrEqual(4 * evicting)
      expect(moved, 'the evicted places are cut off').toBeGreaterThan(0)
      expect(longest, 'the arrays never hold more than twice the frames kept').toBeLessThanOrEqual(2 * kept)
    }
  })

  /**
   * **AN EVICTED FRAME IS LET GO AT ONCE, NOT AT THE CUT.** The ring cuts its evicted places off only once they number
   * the frames it keeps, so a place that still held its frame until then would keep up to one ring's worth of evicted
   * frames alive beside the ring: on a TM leg, as many frames again as its history holds. Two frames are evicted here,
   * against ten kept, so no cut has run when the heap is collected.
   *
   * **A `WeakRef` IS HELD ALIVE UNTIL THE TASK THAT MADE IT ENDS**, so the collection waits a task first. The frame still
   * kept is the case's own control: a collection that saw it go would mean the ring kept nothing at all.
   */
  it('lets go of each frame it evicts at once, before cutting its place off', async () => {
    const gc = collector()
    // A HUNDRED BYTES A FRAME, AND THE NINE BEFORE THE NEWEST FIT THE 900, so the ring keeps ten.
    const ring = new History<object>(900)
    const refs: WeakRef<object>[] = []
    for (let step = 0; step < 10; step++) {
      const frame = { step }
      refs.push(new WeakRef(frame))
      ring.push(frame, 100)
    }
    ring.push({ step: 10 }, 100)
    ring.push({ step: 11 }, 100)
    expect(ring.oldestStep, 'precondition: two frames evicted').toBe(2)
    expect(ring.length, 'precondition: ten kept').toBe(10)
    await new Promise((resolve) => setTimeout(resolve, 0))
    gc()
    expect(
      refs.map((r) => r.deref() !== undefined),
      'the evicted frames are collected and the kept ones are not',
    ).toEqual([false, false, true, true, true, true, true, true, true, true])
    // THE RING IS READ AFTER THE COLLECTION, so it is alive through it by this case's own code and not by whatever the
    // engine happens to keep of a local nothing reads again.
    expect(ring.current).toEqual({ step: 2 })
    expect(ring.length).toBe(10)
  })

  it('seek clamps rather than throwing', () => {
    h.push('a', 10)
    h.push('b', 10)
    h.seek(-5)
    expect(h.current).toBe('a')
    expect(h.currentStep).toBe(0)
    h.seek(99)
    expect(h.current).toBe('b')
    expect(h.currentStep).toBe(1)
  })

  it('clear resets everything including the step numbering', () => {
    h.push('a', 10)
    h.push('b', 900)
    h.clear()
    expect(h.length).toBe(0)
    expect(h.evicted).toBe(false)
    expect(h.head).toBe(0)
    // Prove #bytes actually reset to 0, not just #frames/#sizes: if the earlier 900-byte frame's
    // cost lingered, these two 200-byte pushes would together exceed the 1,000 budget and evict the
    // first of them, dropping length to 1 with oldestStep 1 instead of length 2 / oldestStep 0.
    h.push('x', 200)
    h.push('y', 200)
    expect(h.length).toBe(2)
    expect(h.oldestStep).toBe(0)
  })

  it('clear forgets an eviction the ring has not yet cut off', () => {
    // FOUR FRAMES OF 400 IN 1,000 EVICT THE FIRST, and one evicted place against three kept is no cut, so the evicted
    // place is still in the arrays when `clear` runs.
    h.push('a', 400)
    h.push('b', 400)
    h.push('c', 400)
    h.push('d', 400)
    expect(h.oldestStep, 'precondition: one frame evicted').toBe(1)
    expect(h.length, 'precondition: three kept').toBe(3)
    h.clear()
    expect(h.length).toBe(0)
    expect(h.oldestStep).toBe(0)
    expect(h.current).toBeUndefined()
    h.push('x', 200)
    h.push('y', 200)
    expect(h.length).toBe(2)
    expect(h.newestStep).toBe(1)
    expect(h.current).toBe('x')
    h.seek(1)
    expect(h.current).toBe('y')
  })

  it('clear forgets that the head was following', () => {
    h.push('a', 10)
    h.push('b', 10)
    h.seek(1)
    h.clear()
    h.push('x', 10)
    h.push('y', 10)
    expect(h.current).toBe('x')
  })
})
