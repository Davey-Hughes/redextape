import arithmetic from './examples/arithmetic.rxt?raw'
import closure from './examples/closure.rxt?raw'
import fact from './examples/fact.rxt?raw'
import fact12 from './examples/fact-12.rxt?raw'
import isEven from './examples/is-even.rxt?raw'
import mapFold from './examples/map-fold.rxt?raw'
import sumTo from './examples/sum-to.rxt?raw'
import type { Leg } from './protocol'

/**
 * THE EXAMPLES — Plan 7 part 6a spec §4.1: the programs `examples ▾` offers, in its order, and what each one's legs
 * do when it is picked.
 *
 * **EACH TEXT IS A FILE, IMPORTED WITH `?raw` AS `colour.ts` IMPORTS ITS QUERIES**, so a missing file fails the build
 * rather than the menu. Each is written as `redextape fmt` leaves it.
 *
 * **THE OUTCOMES ARE THE DEFAULT ENCODING'S, `binary`, AND A PICK SETS IT** (spec §4.5, row 12). A description says
 * where a leg stops early, because that is what the user sees on picking it — and under `unary` two of them would say
 * something else: `fact(12)`'s TM leg is declined under `unary`, which cannot fit its value, and the closure's TM leg
 * fills its history there before it halts. `examples.test.ts` in the browser tier runs each example through the real
 * session worker and holds every outcome and value declared here.
 */

/**
 * How a leg's first recording stops under `EXAMPLE_ENCODING`: at the end of the run, with its history full
 * (`budget`, which the readout calls *history full*), or before it starts, because the leg declined the program.
 */
export type Outcome = 'ended' | 'history-full' | 'declined'

export type Example = {
  /** The file's name without `.rxt`, and the menu item's `data-example`. */
  readonly id: string
  readonly title: string
  /** One line, under the title: what the example shows, and where a leg stops early. */
  readonly description: string
  readonly text: string
  /** The value every leg that ends agrees on, as the readout prints it. */
  readonly value: string
  readonly outcomes: Readonly<Record<Leg, Outcome>>
}

/**
 * The default encoding: the one the outcomes are declared under, and the one a pick, a first visit and a refused stored
 * program set. **NOT THE PICKER'S FIRST**: the picker lists what `encodings()` returns, in the order Rust declares the
 * encodings, and that is `unary` first. Only the selection defaults to this one.
 */
export const EXAMPLE_ENCODING = 'binary'

const SUM_TO: Example = {
  id: 'sum-to',
  title: 'sum_to(5)',
  description: 'a while loop adding 5 down to 1; every leg ends at 15',
  text: sumTo,
  value: '15',
  outcomes: { lambda: 'ended', asm: 'ended', tm: 'ended' },
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'arithmetic',
    title: 'let x = 40; x + 2',
    description: 'a binding and a sum; every leg ends at 42',
    text: arithmetic,
    value: '42',
    outcomes: { lambda: 'ended', asm: 'ended', tm: 'ended' },
  },
  {
    id: 'closure',
    title: 'a closure',
    description: 'a function that captures n; every leg ends at 42',
    text: closure,
    value: '42',
    outcomes: { lambda: 'ended', asm: 'ended', tm: 'ended' },
  },
  {
    id: 'is-even',
    title: 'is_even(6)',
    description: 'two functions calling each other; every leg ends at true',
    text: isEven,
    value: 'true',
    outcomes: { lambda: 'ended', asm: 'ended', tm: 'ended' },
  },
  {
    id: 'fact',
    title: 'fact(4)',
    description: 'recursion, where λ fills its history before its value',
    text: fact,
    value: '24',
    outcomes: { lambda: 'history-full', asm: 'ended', tm: 'ended' },
  },
  {
    id: 'map-fold',
    title: 'map and fold',
    description: 'functions passed as values over a list; the TM’s history fills before it halts',
    text: mapFold,
    value: '9',
    outcomes: { lambda: 'ended', asm: 'ended', tm: 'history-full' },
  },
  SUM_TO,
  {
    id: 'fact-12',
    title: 'fact(12)',
    description: 'a value too wide for unary: λ and the TM fill their histories, asm ends',
    text: fact12,
    value: '479001600',
    outcomes: { lambda: 'history-full', asm: 'ended', tm: 'history-full' },
  },
]

/** The example a first visit opens on (spec row 3): every one of its legs ends under the default encoding. */
export const FIRST_LOAD: Example = SUM_TO
