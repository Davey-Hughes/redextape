import type { RuleView, StateView, TmProgram } from '../../src/types'

/** Machines for the state diagram's pure modules: `state-groups.test.ts`, `program-level.test.ts`, `local-level.test.ts`. */

/** A rule that touches no tape and goes to state `next`. */
export const go = (next: number): RuleView => ({ read: [null], write: [null], moves: ['S'], next })

/** A state with one such rule per target, built for instruction `instr`. `halt` accepts; nothing else does. */
export const state = (name: string, instr: number | null, ...next: number[]): StateView => ({
  name,
  accept: name === 'halt',
  rules: next.map(go),
  instr,
})

/**
 * A program of four instructions — `pc0 mov`, `pc1 call f`, `pc2 halt`, and `f: pc3 ret` — **IN THE ORDER THE
 * LOWERING ALLOCATES STATES**: every instruction's entry state first, then the shared return handler and `halt`,
 * then the gadgets, each built for the instruction whose entry falls into it.
 *
 *  0 halt                                          runtime
 *  1 overflow                                      the guard: no rule, not accepting — a badge, not a row
 *  2 pc0          -> mv0s1.c                       mov's entry
 *  3 pc1          -> pf2.tag                       call's entry
 *  4 pc2          -> halt                          into a runtime routine
 *  5 pc3          -> ret                           f's `ret`, into the runtime handler
 *  6 ret          -> rf9.p1                        runtime: to the next runtime row, which is NOT a fall-through
 *  7 rf9.p1       -> pc2                           the return lands after the call
 *  8 mv0s1.c      -> mv0s1.d, overflow
 *  9 mv0s1.d      -> pc1                           a fall-through: 0 -> 1
 * 10 pf2.tag      -> pc3                           the call: an arc from 1 to 3
 * 11 mv0s1.c.back -> mv0s1.d                       a second state in sub-step `c`, which the sub-steps list once
 */
const NAMES = [
  'halt',
  'overflow',
  'pc0',
  'pc1',
  'pc2',
  'pc3',
  'ret',
  'rf9.p1',
  'mv0s1.c',
  'mv0s1.d',
  'pf2.tag',
  'mv0s1.c.back',
]
const at = (name: string) => NAMES.indexOf(name)
const built = (name: string, instr: number | null, ...next: string[]) => state(name, instr, ...next.map(at))

export const COMPILED: TmProgram = {
  states: [
    built('halt', null),
    built('overflow', null),
    built('pc0', 0, 'mv0s1.c'),
    built('pc1', 1, 'pf2.tag'),
    built('pc2', 2, 'halt'),
    built('pc3', 3, 'ret'),
    built('ret', null, 'rf9.p1'),
    built('rf9.p1', null, 'pc2'),
    built('mv0s1.c', 0, 'mv0s1.d', 'overflow'),
    built('mv0s1.d', 0, 'pc1'),
    built('pf2.tag', 1, 'pc3'),
    built('mv0s1.c.back', 0, 'mv0s1.d'),
  ],
  alphabet: [],
  tapes: 1,
  width: 4,
  start: at('pc0'),
  listing: ['mov\tr0, a0', 'call\tf', 'halt', 'ret'],
  labels: [['f', 3]],
}

/** The same machine as a copy would hold it: no map, so no `instr`, no listing. */
export const COPY: TmProgram = {
  ...COMPILED,
  states: COMPILED.states.map((s) => ({ ...s, instr: null })),
  listing: [],
  labels: [],
}
