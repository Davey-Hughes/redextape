import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The text of the file at `rel`, a path relative to this module. `new URL(rel, import.meta.url)` resolves against the
 * module that defines it, so this one stays in `tests/node/` beside the files that call it.
 */
export const readRelative = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
