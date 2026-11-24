import { until } from './harness'

/**
 * Wait until the λ view in `leaf` draws the tree for the step its controls show — not the last step's
 * tree, which it keeps showing (marked stale) until this step's arrives, and not the flat frame it shows
 * before any tree has come back (Plan 7 part 4 spec §4.5). A test that reads the λ view right after
 * stepping reads a moment the view has not caught up with, one worker round trip long. `readout` is
 * where the step is shown — the view's own controls by default, the step bar's under a preset that
 * moves them there.
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
