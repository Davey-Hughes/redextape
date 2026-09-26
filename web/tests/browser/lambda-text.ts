import { codeLines, lineText } from '../../src/lambda-layout'
import { Tree } from '../../src/lambda-tree'
import { wireOf } from '../node/tree-fixture'
import { until } from './harness'

/**
 * Wait until the λ view in `leaf` draws the tree for the step its controls show — not the last step's
 * tree, which it keeps showing (marked stale) until this step's arrives, and not the flat frame it shows
 * before any tree has come back (Plan 7 part 4a). A test that reads the λ view right after stepping reads
 * a moment the view has not caught up with, one worker round trip long. `readout` is where the step is
 * shown — the view's own controls by default, the step bar's under a preset that moves them there.
 */
export async function lambdaSettled(
  leaf = 'lambda-0',
  readout = (): string => document.querySelector(`[data-leaf="${leaf}"] .step`)?.textContent ?? '',
): Promise<void> {
  await until(() => {
    const term = document.querySelector<HTMLElement>(`[data-leaf="${leaf}"] .term`)
    const step = readout()
      .match(/step ([\d,]+)/)?.[1]
      ?.replaceAll(',', '')
    return term?.dataset.stale === undefined && step !== undefined && term?.dataset.step === step
  }, `the λ view in ${leaf} to draw its own step's tree`)
}

/**
 * How the λ view writes `printed` — the printer's text for a term — on one line: binders merged, numerals
 * and booleans as chips. A test that compares the view with printed text (an editor's text of record, a
 * copy's seed) compares it with this.
 */
export function asShown(printed: string): string {
  const t = new Tree(wireOf(printed))
  return codeLines(t, { width: 100_000, vars: 'names', open: (i) => t.chip(i) === null })
    .map(lineText)
    .join('')
}
