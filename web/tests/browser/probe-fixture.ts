/**
 * Heap and cost readings for the probe files. It imports nothing and is kept out of `harness.ts`, so that the probes,
 * which do not import `harness.ts`, take none of its load-time imports into a heap measurement.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names end in
 * `.test.ts`, and this one does not.
 */

/** See `frame-cost.test.ts`'s type of the same name for why `performance.memory` needs a cast. */
type MemoryPerformance = Performance & { memory?: { usedJSHeapSize: number } }

/** See `frame-cost.test.ts`'s type of the same name. Put here by `--js-flags=--expose-gc`. */
type GlobalWithGc = typeof globalThis & { gc?: () => void }

/** The bytes of JS heap in use now, or 0 where `performance.memory` is missing. */
export const heapNow = (): number => (performance as MemoryPerformance).memory?.usedJSHeapSize ?? 0

/**
 * Assert the two non-standard globals exist, and return the collector.
 *
 * IT THROWS `BLOCKED:` RATHER THAN SKIPPING, exactly as `frame-cost.test.ts` does. Without
 * `--enable-precise-memory-info` every heap delta in that file came back as exactly 0, so a probe
 * that tolerated a missing flag would report a ratio of 0/0 or 1.0 and call the threshold met. A
 * probe that silently reads zeros is worse than no probe.
 */
export function requireHeapHarness(): () => void {
  if (!(performance as MemoryPerformance).memory) {
    throw new Error('BLOCKED: performance.memory is unavailable in this browser — cannot measure heap size')
  }
  if (heapNow() === 0) {
    throw new Error('BLOCKED: performance.memory.usedJSHeapSize reads 0 — cannot measure heap size')
  }
  const collect = (globalThis as GlobalWithGc).gc
  if (typeof collect !== 'function') {
    throw new Error('BLOCKED: globalThis.gc is unavailable — launch Chromium with --js-flags=--expose-gc')
  }
  return collect
}

/** The mean of `xs`. */
export const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
