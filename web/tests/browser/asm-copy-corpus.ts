/**
 * The asm programs an asm copy's two cost probes both price: `asm-copy-memory.test.ts`'s worst cases, and `both`, the
 * two together, at the heap cap `session.rs`'s `COPY_CAPS` sets (Plan 7 part 5 spec, amendment 45). Shared so the rule
 * amendment 45 states — the cost probe (`asm-copy-cost.test.ts`) prices every run the memory probe knows, and adds
 * the heaviest to every size's total — has one program list behind both probes, not two kept in step by hand.
 *
 * **NOT `*.test.ts`, ON PURPOSE**: `vite.config.ts`'s browser project collects tests by that suffix (`include:
 * ['tests/browser/**\/*.test.ts']`), so this file is never picked up as a test of its own, the way
 * `asm-copy-memory-worker.ts` already is not — and `PROBE_FILES` there names only the two `.test.ts` files, so a
 * helper of theirs joining neither test run nor the default suite needs no entry of its own.
 */

/** The heap cap `session.rs`'s `COPY_CAPS` sets, kept in step by hand, as a probe's inputs are. */
export const COPY_CAPS_HEAP = 2_000_000

/** The runs `asm-copy-memory.test.ts` prices alone: a saved-locals bank, a filled heap, filled boxes, bare recursion. */
export const CASES: readonly { name: string; src: string }[] = [
  { name: 'saved locals', src: 'f:\n    li\tr999999, #1\n    call\tf\n' },
  { name: 'heap cells', src: `    nil\tr0\nloop:\n${'    cons\tr0, r1, r0\n'.repeat(100)}    jmp\tloop\n` },
  { name: 'boxes', src: `loop:\n${'    box\tr0, r1\n'.repeat(100)}    jmp\tloop\n` },
  { name: 'call frames', src: 'f:\n    call\tf\n' },
]

/**
 * THE TWO TOGETHER: a heap filled to `cells`, a hundred cells a turn, and then the saved-locals recursion — the worst
 * a copy can do, since the caps are separate and a run stops at the first one it meets.
 */
export const both = (cells: number) => ({
  name: 'both',
  src:
    `    nil\tr0\n    li\tr2, #${Math.floor(cells / 100) - 1}\n    li\tr3, #1\nfill:\n${'    cons\tr0, r1, r0\n'.repeat(100)}` +
    '    sub\tr2, r2, r3\n    jz\tr2, deep\n    jmp\tfill\ndeep:\n    li\tr999999, #1\n    call\tdeep\n',
})
