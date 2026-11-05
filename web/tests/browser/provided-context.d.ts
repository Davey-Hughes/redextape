import 'vitest'

/**
 * What `vite.config.ts`'s browser projects hand their tests through `provide`, typed for `inject`. A declaration file
 * rather than the test file that reads it, because Biome refuses an export from a test file.
 */
declare module 'vitest' {
  export interface ProvidedContext {
    /**
     * `tm-buffer-cost.test.ts`'s run stamp: `pnpm run test:probe:tm-buffer` sets it, and every other run leaves it
     * empty. That file's doc says why a probe run refuses a stamp that is not its own.
     */
    probeTmBufferRun: string
    /** `rxm-copy-cost.test.ts`'s and `rxm-copy-memory.test.ts`'s run stamp, set by `pnpm run test:probe:rxm-copy`. */
    probeRxmCopyRun: string
    /** Whether this run measures coverage, from `global-setup.ts`, for `collect.ts`. */
    coverageOn: boolean
    /** Whether this project refuses a pointer capture, for `firefox-input.ts`'s guard: true in `firefox` alone. */
    pointerCaptureRefused: boolean
  }
}
