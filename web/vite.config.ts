import { fileURLToPath } from 'node:url'
// Vitest 4 split the Playwright driver out of `@vitest/browser` into its own package with a
// provider-factory API; `browser.provider` no longer accepts the bare string `'playwright'` that
// earlier Vitest majors did (`tsc --noEmit` rejects it: TS2769, `string` is not a
// `BrowserProviderOption`). `playwright()` is the documented replacement — see the JSDoc on
// `BrowserConfigOptions.provider` in `@vitest/browser`'s own shipped types.
import { playwright } from '@vitest/browser-playwright'
// `defineConfig` comes from `vitest/config`, not `vite`, even though this file is also the Vite
// config. Vitest augments Vite's `UserConfig` type with the `test` field via a `declare module
// "vite"` block in its own type-only entry point — TypeScript only applies that augmentation to
// files that pull it into the compilation. Importing `defineConfig` from `vite` compiles and runs
// fine (Vite ignores the extra `test` key at runtime either way) but fails `tsc --noEmit` with
// TS2769 because the `test` property is invisible to the checker. `vitest/config` re-exports the
// same Vite `defineConfig` plus that import path.
import { defineConfig } from 'vitest/config'

// `pkg/` is built to the REPO ROOT, one level above this Vite root, because the Dockerfile places
// stage 1's output at /app/pkg beside /app/web. Vite's dev server refuses to serve outside its root
// unless that path is allow-listed.
//
// ABSOLUTE, AND REPEATED ON THE BROWSER PROJECT — a relative `'..'` here is not enough, and the
// failure it produces is remote from its cause. Vitest's browser mode stands up its own nested Vite
// server and rebuilds `server.fs.allow` against THAT server's root, so a relative entry resolves
// somewhere else and the wasm fetch dies with "outside of Vite serving allow list" — while the same
// config serves the same file correctly under a plain `vite dev`.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  server: { fs: { allow: [REPO_ROOT] } },
  worker: { format: 'es' },
  test: {
    // No `passWithNoTests`. It was set while the scaffold had no tests yet; now that both projects
    // have them, a project reporting no test files means a broken `include` glob, and that should
    // fail rather than pass quietly.
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/node/**/*.test.ts'],
        },
      },
      {
        server: { fs: { allow: [REPO_ROOT] } },
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          browser: {
            enabled: true,
            provider: playwright({
              // `frame-cost.test.ts` reads `performance.memory.usedJSHeapSize` to measure `SPAN_BYTES`
              // for real. WITHOUT THIS FLAG the value is frozen at a stale sample for tens of seconds
              // regardless of allocation — verified by allocating and dropping a 5M-element array under
              // 45s of wall-clock with no change in the reading. WITH IT, the same experiment tracks
              // allocation and collection within one read. Chromium-only and harmless to every other
              // browser test, which don't touch `performance.memory`.
              launchOptions: { args: ['--enable-precise-memory-info'] },
            }),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
