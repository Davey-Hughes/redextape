import type { Leg } from './protocol'

/**
 * THE LEG VOCABULARY — each leg's name as a user reads it, the order the app lists legs in, a table with an
 * entry per leg, and the end of a `switch` over one.
 *
 * **IT EXISTS FOR ONE CLASS OF BUG: A BRANCH THAT READS "NOT λ" AS "TM".** Through Plan 7 part 5a the app had
 * two legs, and most of the sites that had to tell them apart asked one question — `leg === 'lambda' ? … : …`
 * — and put TM in the else. That is correct for exactly as long as there are two legs, and no site written
 * that way can say so: the day a third leg arrives, each one hands it TM's name, TM's request or TM's pane
 * class, with `tsc` green. Part 5's spec §2.3 found these branches by reading and its amendment 8 found more
 * by searching, and it says of both counts that an inventory is not a gate.
 *
 * **SO THE COMPILER IS THE GATE, AND THIS MODULE IS WHAT IT READS.** A branch on the leg is a `switch` with
 * one arm per leg. One that returns a value is exhaustive already, since a missing arm is TS2366 under
 * `strict`; one that only acts, or that may answer `undefined`, ends in `default: unhandled(leg)`. A per-leg
 * table is a `Record<Leg, …>`, or is built by `perLeg` when every leg's entry follows one rule, and a list of
 * the legs is `LEGS`. Adding a member to `Leg` then makes `tsc` name every site that has not decided what the
 * new leg does, which is the inventory derived rather than trusted.
 */

/**
 * Each leg's name as a user reads it: a view's title (`λ · program`), a copy's name (`TM copy 2`), the copies
 * menu, and the link status line's detachment clause.
 *
 * **READ HERE BY EVERY SITE THAT HOLDS A `Leg` AND SAYS IT**, where each used to spell `leg === 'lambda' ?
 * 'λ' : 'TM'` for itself — which named a third leg `TM` at every one of them.
 *
 * **AN ANNOTATION, NOT `as const satisfies`**, the form `editor-prefs.ts`'s `KEYMAP_LABEL` takes. Either makes
 * a leg with no name a type error here; `satisfies` would also make it one at every lookup by a `Leg`, since
 * the literal type it keeps has no key for the new leg, so one missing entry would be reported once per site
 * that only reads it.
 */
export const LEG_NAME: Readonly<Record<Leg, string>> = { lambda: 'λ', asm: 'asm', tm: 'TM' }

/**
 * A leg a copy can be made on: λ and TM. **ASM IS LEFT OUT UNTIL PART 5c**, which adds asm copies and widens this
 * (Plan 7 part 5 spec §7). Every place a copy's leg is held — a copy's record, the copies menu, the store — takes
 * this rather than `Leg`, so the switches over a copy's leg have no asm arm to write, and 5c's widening makes `tsc`
 * name each one it has to fill.
 */
export type CopyLeg = Exclude<Leg, 'asm'>

/**
 * Every leg, in the order the app lists them — the title-selector's groups (`SessionRegistry.pairs`) and the
 * detachment clause's names (`link-status.ts`'s `detachedText`).
 *
 * **READ OFF `LEG_NAME`'s KEYS RATHER THAN WRITTEN OUT**, the idiom `editor-prefs.ts`'s `KEYMAP_MODES` already
 * takes. A written list only says that each entry is a leg — `['lambda'] satisfies readonly Leg[]` typechecks —
 * so a leg left out of it would be offered by no selector and named by no clause, silently. `LEG_NAME`'s type
 * makes a missing key an error and its literal's excess-property check refuses an extra one, so its keys are
 * exactly `Leg`, which is what the cast restates: `Object.keys` answers `string[]` for every object, because a
 * value may carry keys its type does not name, and this one is a literal that cannot. The order is
 * `LEG_NAME`'s, since an object's string keys enumerate in insertion order.
 *
 * A VALUE RATHER THAN A KEY WALK OVER SOME ENTRY'S `legs`, because the order must not depend on which legs the
 * first session in the registry happens to have — the reason this list gave when it lived in `sessions.ts`.
 */
export const LEGS: readonly Leg[] = Object.keys(LEG_NAME) as Leg[]

/**
 * A table with one entry per leg, each entry `value(leg)`.
 *
 * **FOR A TABLE WHOSE ENTRIES FOLLOW ONE RULE**, such as a flag every leg starts without: there a new leg has
 * nothing to decide, so a literal that made `tsc` ask anyway would be noise in exactly the list this module
 * exists to keep meaningful. A table whose entries differ by leg is a `Record<Leg, …>` literal instead, where
 * a missing leg is a type error at the table.
 */
export function perLeg<T>(value: (leg: Leg) => T): Record<Leg, T> {
  return Object.fromEntries(LEGS.map((leg) => [leg, value(leg)])) as Record<Leg, T>
}

/**
 * The end of a statement `switch` over a union: `default: unhandled(value)`.
 *
 * **ITS WHOLE JOB IS DONE BY `tsc`.** Once every member has an arm, the value that reaches `default` has type
 * `never`, which is the only type this accepts; a member with no arm reaches it with its own type, and the call
 * is a type error at the `switch` that forgot it. A `switch` that returns a value needs none of this — unless
 * `undefined` is one of the values, since TS2366 polices only a function whose return type excludes it, and a
 * missing arm would then answer `undefined` with `tsc` green (`link-wiring.ts`'s `theSlot` is that case).
 *
 * **IT DOES NOTHING WHEN CALLED, AND IT DOES NOT THROW.** The types say no value gets here. If one did — a
 * reply from a worker the page did not expect — the `switch` it ends did nothing for that value before this
 * existed, and several of them sit in handlers where a throw would abandon the rest of the reply.
 */
export function unhandled(_value: never): void {}
