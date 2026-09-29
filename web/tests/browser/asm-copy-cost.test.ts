import { describe, expect, inject, it } from 'vitest'
import type * as Wasm from '../../../pkg/redextape_wasm.js'
import { ScratchEditor } from '../../src/scratch-editor'
import type { AsmProgram, AsmStatus, Decoded, Diagnostic } from '../../src/types'
import { both, CASES, COPY_CAPS_HEAP } from './asm-copy-corpus'

/**
 * **A PROBE, NOT A GATE** (`vite.config.ts`'s `PROBE_FILES`): what an asm copy's build costs before its first frame,
 * by the size of its text, against the 250 ms an initiated gesture may take — `tm-buffer-cost.test.ts`'s pricing, for
 * `MAX_SCRATCH_ASM_BYTES` (Plan 7 part 5 spec, amendment 24, its figure amendment 45's). Run by `pnpm run
 * test:probe:asm-copy`, which builds the probe wasm with the ceiling off and stamps it; this refuses a build another
 * run stamped.
 *
 * FOUR COSTS PER BUILD, AS FOR A TM COPY: the text's structured clone to the worker; `asmScratch`, which parses it,
 * checks its labels, projects the listing and runs the program to its end; reading the reply's status, listing and
 * value off the handle; and the reply's clone back. The corpus programs halt on their first instruction, so the run
 * costs nothing here and the four costs are the text's.
 *
 * **EVERY RUN THE MEMORY PROBE KNOWS IS PRICED APART, AND THE HEAVIEST IS ADDED** (amendment 45) — a loop to the step
 * cap, `asm-copy-corpus.ts`'s `CASES` (a saved-locals bank, a filled heap, filled boxes, bare recursion) and its
 * `both`, at `COPY_CAPS`' heap cap, all imported from that file so the two probes never keep two copies of
 * the same program in step by hand — since none of these runs grows with the text they are added to: the ceiling is
 * the size whose build, with the heaviest of them added, stays under the budget. Amendment 36 priced only the loop;
 * amendment 45 found `both` heavier in every run measured and moved the rule to whichever run turns out heaviest,
 * rather than naming one in advance.
 *
 * THE CORPUS IS GENERATED, one block a label, of the shape a hand-written file has: a label, three instructions, and a
 * jump back to it, so the label check has a definition and a reference per block.
 */

type Copy = { asmStatus(): AsmStatus; asmProgram(): AsmProgram; asmValue(): Decoded; free(): void }
type Made = { diagnostics: Diagnostic[]; scratch: Copy | null }

const PROBE_WASM = import.meta.glob<typeof Wasm>('../../../target/probe-asm-copy-wasm/redextape_wasm.js')
const RUN = import.meta.glob<string>('../../../target/probe-asm-copy-wasm/run.txt', {
  query: '?raw',
  import: 'default',
})

const BUDGET_MS = 250
const REPS = 7
const SIZES = [
  250_000, 500_000, 1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000, 5_200_000, 5_300_000, 5_600_000, 5_800_000,
  6_000_000, 8_000_000, 12_000_000,
]

/** An asm file of at least `bytes` bytes that halts on its first instruction. */
function corpus(bytes: number): string {
  const parts = ['result Nat\n\n    halt\n']
  let size = parts[0]?.length ?? 0
  for (let i = 0; size < bytes; i++) {
    const block = `l${i}:\n    li\tr1, #${i}\n    add\tr2, r1, r1\n    jz\tr0, l${i}\n`
    parts.push(block)
    size += block.length
  }
  return parts.join('')
}

const cloneMs = (payload: unknown) =>
  new Promise<number>((resolve) => {
    const ch = new MessageChannel()
    const start = performance.now()
    ch.port2.onmessage = () => resolve(performance.now() - start)
    ch.port1.postMessage(payload)
  })
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN
const ms = (x: number) => x.toFixed(1).padStart(7)

describe('asm copy cost', () => {
  it('prices a build by the size of its text, and every run the memory probe knows', async () => {
    const run = inject('probeAsmCopyRun')
    const built = await Object.values(RUN)[0]?.()
    if (run === '' || built !== run) {
      throw new Error(
        `BLOCKED: this run's stamp is "${run}" and the build's "${built ?? 'absent'}"; run \`pnpm run test:probe:asm-copy\``,
      )
    }
    const load = Object.values(PROBE_WASM)[0]
    if (load === undefined) throw new Error('BLOCKED: no probe wasm build; run `pnpm run test:probe:asm-copy`')
    const { default: init, asmScratch } = await load()
    await init()
    const build = (text: string): Copy => {
      const made = asmScratch(text) as Made
      if (made.scratch === null)
        throw new Error(`BLOCKED: did not build: ${made.diagnostics.map((d) => d.message).join(' · ')}`)
      return made.scratch
    }

    // EVERY RUN THE MEMORY PROBE KNOWS, PRICED APART, PLUS THE LOOP: none of these grows with the text they are
    // added to, so each is priced once here and the heaviest is added to every size's total below (amendment 45).
    const rows: string[] = []
    const runsByName = [{ name: 'loop to the step cap', src: 'loop:\n    jmp\tloop\n' }, ...CASES, both(COPY_CAPS_HEAP)]
    let worstRun = 0
    for (const { name, src } of runsByName) {
      const runs: number[] = []
      for (let r = 0; r < REPS; r++) {
        const t0 = performance.now()
        build(src).free()
        runs.push(performance.now() - t0)
      }
      const priced = median(runs)
      rows.push(`RUN  ${name}: median=${ms(priced)} spread=${ms(Math.min(...runs))}-${ms(Math.max(...runs)).trim()}`)
      worstRun = Math.max(worstRun, priced)
    }

    for (let i = 0; i < 3; i++) build(corpus(10_000)).free()
    const totals: { bytes: number; total: number }[] = []
    for (const target of SIZES) {
      const text = corpus(target)
      const bytes = new TextEncoder().encode(text).length
      const clone: number[] = []
      const parse: number[] = []
      const project: number[] = []
      const back: number[] = []
      let instructions = 0
      for (let r = 0; r < REPS; r++) {
        clone.push(await cloneMs({ kind: 'asm-scratch', gen: 1, src: text }))
        const t1 = performance.now()
        const copy = build(text)
        parse.push(performance.now() - t1)
        const t2 = performance.now()
        const reply = {
          kind: 'asm-scratch-compiled',
          gen: 1,
          asm: copy.asmStatus(),
          asmProgram: copy.asmProgram(),
          value: copy.asmValue(),
        }
        project.push(performance.now() - t2)
        instructions = reply.asmProgram.listing.length
        back.push(await cloneMs(reply))
        copy.free()
      }
      const mounts: number[] = []
      for (let r = 0; r < 3; r++) {
        const host = document.createElement('div')
        document.body.append(host)
        const t3 = performance.now()
        const editor = new ScratchEditor({ host, initial: text, debounceMs: 300, onEdit: () => {} })
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        mounts.push(performance.now() - t3)
        editor.destroy()
        host.remove()
      }
      const total = median(clone) + median(parse) + median(project) + median(back)
      totals.push({ bytes, total })
      rows.push(
        `SIZE bytes=${String(bytes).padStart(9)} instructions=${String(instructions).padStart(7)} clone=${ms(median(clone))} ` +
          `build=${ms(median(parse))} project=${ms(median(project))} back=${ms(median(back))} total=${ms(total)} ` +
          `with_worst_run=${ms(total + worstRun)} mount=${ms(median(mounts))}`,
      )
    }
    const under = totals.filter((t) => t.total + worstRun < BUDGET_MS).sort((a, b) => b.bytes - a.bytes)[0]
    const over = totals.filter((t) => t.total + worstRun >= BUDGET_MS).sort((a, b) => a.bytes - b.bytes)[0]
    const said = (t: (typeof totals)[number] | undefined) =>
      t === undefined ? 'none' : `${t.bytes} bytes, ${(t.total + worstRun).toFixed(1)} ms with the worst run`
    rows.push(`BRACKET largest under ${BUDGET_MS} ms: ${said(under)}; smallest at or over: ${said(over)}`)
    console.log(`\n${rows.join('\n')}\n`)
    expect(totals.length).toBe(SIZES.length)
  }, 1_800_000)
})
