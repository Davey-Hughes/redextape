import 'vitest'

/**
 * What `vite.config.ts`'s browser project hands its tests through `provide`, typed for `inject`. A declaration file
 * rather than the test file that reads it, because Biome refuses an export from a test file.
 */
declare module 'vitest' {
  export interface ProvidedContext {
    /**
     * `tm-buffer-cost.test.ts`'s run stamp: `pnpm run test:probe:tm-buffer` sets it, and every other run leaves it
     * empty. That file's doc says why a probe run refuses a stamp that is not its own.
     */
    probeTmBufferRun: string
  }
}
