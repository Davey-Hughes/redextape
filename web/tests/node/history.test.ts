import { beforeEach, describe, expect, it } from 'vitest'
import { History } from '../../src/history'

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

  it('follows the frontier as frames arrive', () => {
    h.push('a', 10)
    h.push('b', 10)
    expect(h.current).toBe('b')
    expect(h.head).toBe(h.length - 1) // at the frontier — the newest frame is the current one
    expect(h.currentStep).toBe(1) // firstStep 0, head 1 — no eviction yet
  })

  it('does not move the head off a scrubbed-back position when new frames arrive', () => {
    h.push('a', 10)
    h.push('b', 10)
    h.back()
    expect(h.current).toBe('a')
    h.push('c', 10)
    expect(h.current).toBe('a')
    expect(h.head).toBe(0) // NOT the frontier (length is now 3) — the push must not have yanked it
  })

  it('clamps back at the oldest and forward at the frontier', () => {
    h.push('a', 10)
    expect(h.back()).toBe(false)
    expect(h.forward()).toBe(false)
    h.push('b', 10)
    expect(h.forward()).toBe(true)
    expect(h.forward()).toBe(false)
  })

  // The ring caps BYTES, not frames. `frame_cost_probe` measured λ frames ranging from 5 KB to
  // 781 KB depending only on the program, so a frame count is a memory policy spanning three orders
  // of magnitude.
  it('evicts oldest-first when the byte budget is exceeded', () => {
    for (let i = 0; i < 5; i++) h.push(`f${i}`, 300)
    // Budget is 1,000; each frame costs 300, so the ring holds 3 (900 bytes) before a 4th push would
    // exceed it — evict down to where the newest fits, oldest-first.
    expect(h.length).toBe(3)
    expect(h.evicted).toBe(true)
    expect(h.oldestStep).toBe(2)
    expect(h.newestStep).toBe(4)
    expect(h.current).toBe('f4')
  })

  it('keeps at least one frame however large it is', () => {
    h.push('huge', 10_000)
    expect(h.length).toBe(1)
    expect(h.current).toBe('huge')
  })

  it('clamps the head to the new oldest when the frame it was on is evicted', () => {
    for (let i = 0; i < 3; i++) h.push(`f${i}`, 300)
    h.seek(0)
    const oldest = h.current
    h.push('f3', 300)
    // f0 is gone; the head cannot still point at it, so it clamps to the new oldest and SAYS so.
    expect(h.current).not.toBe(oldest)
    expect(h.head).toBe(0)
    expect(h.oldestStep).toBeGreaterThan(0)
  })

  it('keeps the head on the same frame when an older one is evicted', () => {
    // Head parked at 2 (not the frontier, and not 1) so a single eviction's correct decrement — to
    // 1 — is distinguishable from a mutant that merely zeroes the head or leaves it untouched.
    for (let i = 0; i < 4; i++) h.push(`f${i}`, 200)
    h.seek(2)
    const kept = h.current
    h.push('f4', 300) // evicts only f0; every surviving index drops by exactly one
    expect(h.current).toBe(kept)
    expect(h.head).toBe(1)
    expect(h.currentStep).toBe(2) // firstStep 1, head 1 — the frame kept its own step number
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
})
