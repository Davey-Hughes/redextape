import type { TestProject } from 'vitest/node'

/**
 * The browser project's global setup: tell its pages whether this run measures coverage.
 *
 * `collect.ts` stops and starts V8's precise coverage around each file's collection when it is on, and must not start
 * it when it is off, which would hold every page a tab runs. A page cannot read the run's settings (`process` does not
 * exist there, as `vite.config.ts` says of the probes' flag), and `--coverage` is not the only way to turn coverage on,
 * so the answer is the resolved config's, read here in Node and handed over by `inject`.
 */
export default function setup(project: TestProject): void {
  project.provide('coverageOn', project.vitest.config.coverage.enabled)
}
