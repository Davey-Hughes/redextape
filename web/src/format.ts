/**
 * A count, comma-grouped for a human reader (`75025` -> `'75,025'`).
 *
 * ONE HOME, not three. `results.ts`, `tm-pane.ts` and `controls.ts` each defined this identically —
 * three copies of the same one-liner is still three places a locale choice can drift.
 */
export const n = (x: number): string => x.toLocaleString('en-US')

/**
 * A count and its noun, singular for one — `1 instruction`, `55 instructions` — grouped as `n` groups it (Plan 7 part 5
 * spec, amendment 29). Every leg wrote its step count as `${n} <plural>`, so one step read "1 reductions", "1
 * transitions" or "1 instructions"; the nouns here are the three legs' words for a step, whose plurals all add `s`.
 */
export const counted = (x: number, noun: 'reduction' | 'transition' | 'instruction'): string =>
  `${n(x)} ${noun}${x === 1 ? '' : 's'}`
