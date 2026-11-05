import { statSync } from 'node:fs'
import { expect, it } from 'vitest'
import { CAPTURE_FILES } from '../../vite.config'

/**
 * A path on `CAPTURE_FILES` that names no file would leave its file, renamed, in `firefox`, where a capture of its
 * takes the clicks of every other tab: this names the stale entry instead.
 */
it('every path on the capture list is a file', () => {
  const missing = CAPTURE_FILES.filter(
    (f) => statSync(new URL(`../../${f}`, import.meta.url), { throwIfNoEntry: false })?.isFile() !== true,
  )
  expect(missing, 'paths on vite.config.ts’s CAPTURE_FILES that are not files').toEqual([])
})
