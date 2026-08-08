/**
 * A count, comma-grouped for a human reader (`75025` -> `'75,025'`).
 *
 * ONE HOME, not three. `results.ts`, `tm-pane.ts` and `controls.ts` each defined this identically —
 * three copies of the same one-liner is still three places a locale choice can drift.
 */
export const n = (x: number): string => x.toLocaleString('en-US')
