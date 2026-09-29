import { describe, expect, inject, it } from 'vitest'
import { both, CASES, COPY_CAPS_HEAP } from './asm-copy-corpus'
import type { MemoryReply, MemoryRequest } from './asm-copy-memory-worker'

/**
 * **A PROBE, NOT A GATE** (`vite.config.ts`'s `PROBE_FILES`): what an asm copy's worst cases cost its worker's memory,
 * under `DEFAULT_CAPS` and under `COPY_CAPS` (Plan 7 part 5 spec, amendment 25). Run by `pnpm run test:probe:asm-copy`,
 * which builds the probe wasm with `probe-asm-copy` and stamps it; this refuses a build another run stamped.
 *
 * EACH CASE IN A WORKER OF ITS OWN, since a wasm memory only grows: the figure is the memory after the build and the
 * recording, which is the worker's peak. The worst cases are the two caps whose words a hand-written copy can fill:
 *
 * - **saved locals**: `r999999` grows the locals bank to a million words, and every `call` saves the bank, so the memory
 *   cap's words are reached in `mem / 1,000,000` calls;
 * - **the heap**: a `cons` a step, until the heap cap's cells are allocated.
 *
 * The caps are `[steps, stack, heap, mem]`, `DEFAULT_CAPS`' and the candidate `COPY_CAPS`' — kept in step with
 * `session.rs` by hand, as a probe's inputs are, and printed so a run says what it measured. `CASES` and `both` live in
 * `asm-copy-corpus.ts`, shared with `asm-copy-cost.test.ts`, which prices every run this probe knows against the 250 ms
 * budget (amendment 45).
 */

const DEFAULT_CAPS: MemoryRequest['caps'] = [5_000_000, 100_000, 5_000_000, 64_000_000]
const COPY_CAPS: MemoryRequest['caps'] = [5_000_000, 100_000, COPY_CAPS_HEAP, 12_000_000]

const RUN = import.meta.glob<string>('../../../target/probe-asm-copy-wasm/run.txt', {
  query: '?raw',
  import: 'default',
})

function measure(req: MemoryRequest): Promise<MemoryReply> {
  const worker = new Worker(new URL('./asm-copy-memory-worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve) => {
    worker.addEventListener('message', (e: MessageEvent<MemoryReply>) => {
      worker.terminate()
      resolve(e.data)
    })
    worker.postMessage(req)
  })
}

describe('asm copy memory', () => {
  it('prices each worst case under DEFAULT_CAPS and under COPY_CAPS', async () => {
    const run = inject('probeAsmCopyRun')
    const built = await Object.values(RUN)[0]?.()
    if (run === '' || built !== run) {
      throw new Error(
        `BLOCKED: this run's stamp is "${run}" and the build's "${built ?? 'absent'}"; run \`pnpm run test:probe:asm-copy\``,
      )
    }
    const rows: string[] = []
    for (const [label, caps] of [
      ['DEFAULT_CAPS', DEFAULT_CAPS],
      ['COPY_CAPS', COPY_CAPS],
    ] as const) {
      for (const c of [...CASES, both(caps[2])]) {
        const r = await measure({ src: c.src, caps })
        if (!r.ok) throw new Error(`${c.name}: ${r.message}`)
        rows.push(
          `MEM ${label.padEnd(12)} ${c.name.padEnd(12)} caps=${caps.join('/')} MiB=${r.mib.toFixed(1).padStart(7)} ` +
            `build_ms=${r.buildMs.toFixed(1).padStart(7)} steps=${r.status.total_steps} cap=${r.status.cap} frames=${r.frames}`,
        )
      }
    }
    console.log(`\n${rows.join('\n')}\n`)
    expect(rows.length).toBe(2 * (CASES.length + 1))
  }, 1_800_000)
})
