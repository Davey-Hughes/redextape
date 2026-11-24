import 'vitest'

/**
 * What `vite.config.ts`'s browser projects hand their tests through `provide`, typed for `inject`. A declaration file
 * rather than the test file that reads it, because Biome refuses an export from a test file.
 */
declare module 'vitest' {
  export interface ProvidedContext {
    /** Whether this run measures coverage, from `global-setup.ts`, for `collect.ts`. */
    coverageOn: boolean
    /** Whether this project refuses a pointer capture, for `firefox-input.ts`'s guard: true in `firefox` alone. */
    pointerCaptureRefused: boolean
  }
}
