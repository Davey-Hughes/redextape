import { describe, expect, inject, it } from 'vitest'
import type * as Wasm from '../../../pkg/redextape_wasm.js'
import { VALUE_CHUNK } from '../../src/protocol'
import { ScratchEditor } from '../../src/scratch-editor'
import type { Decoded, Diagnostic, TmProgram, TmScratchStatus, ValueRun } from '../../src/types'

/**
 * **THE TM-BUFFER-COST PROBE** — what a TM buffer pays to build a reduced `.tm` file, and how fast its value run
 * steps. The web reduced-files design, *For the plan to measure*, items 1 and 2.
 *
 * **A PROBE, NOT A TEST — IT PRINTS AND ASSERTS ALMOST NOTHING,** like `tm-fork-cost.test.ts`, whose shape it follows.
 * It exists to produce the readings `MAX_SCRATCH_TM_BYTES` (`crates/redextape-wasm/src/session.rs`) and `VALUE_CHUNK`
 * (`web/src/protocol.ts`) are set from, and both docs name the commit they were taken at. One command runs it:
 *
 *     cd web && pnpm run test:probe:tm-buffer
 *
 * That script picks a run stamp, `REDEXTAPE_PROBE_TM_BUFFER_RUN`, and then does four things in order:
 *
 *   1. `scripts/emit-probe-reduced-files.sh` builds the release CLI and writes every program in its list through every
 *      `--reduce` stage list into the repo's `target/probe-reduced-files/`, where `FILES` reads them, with the stamp
 *      beside them. That script's header says why they are generated and why the path is fixed.
 *   2. `wasm-pack` builds `redextape-wasm` in release with `probe-no-tm-scratch-ceiling` into
 *      `target/probe-tm-buffer-wasm/`, where `PROBE_WASM` reads it.
 *   3. It writes the stamp beside that build.
 *   4. It runs this file, with `--reporter=verbose` because the default reporter shows no `console.log` from a
 *      passing test.
 *
 * **A RUN REFUSES A CORPUS OR A BUILD IT DID NOT MAKE.** Both live under `target/` and outlast the run that made them,
 * so this file run any other way, as `REDEXTAPE_PROBE=1 vitest run` on its path, would price files and a build from
 * whatever tree last ran the script. `vite.config.ts`'s browser project provides the script's stamp, empty on every
 * other run, and the test stops `BLOCKED` before pricing anything unless both stamps on disk are that one.
 *
 * **THE PROBE'S OWN WASM BUILD, NOT `pkg/`, BECAUSE THE PRODUCT BUILD CANNOT PRICE THE SIDE OF THE CEILING THAT SETS
 * IT.** `tmScratch` refuses text over `MAX_SCRATCH_TM_BYTES` before parsing it, so the smallest file over the budget
 * would never be parsed. The feature switches that check off, and its doc in `crates/redextape-wasm/Cargo.toml` says
 * why it is a feature. The build goes to its own directory so a probe run never replaces the `pkg/` the app and every
 * other browser test load. Two consequences:
 *
 *   - **Loaded through `import.meta.glob`, typed from `pkg/`.** A static import of a directory only this script
 *     creates would fail `pnpm run typecheck` everywhere the probe has not run, CI included. A glob is resolved by
 *     Vite when the file is served, and the feature changes no export, so `pkg/`'s declarations describe the probe
 *     build too. Vite serves both directories because `vite.config.ts` allows the repo root.
 *   - **A file that does not build is `BLOCKED`, never a row.** The corpus holds files over the ceiling, so a run
 *     that loaded a build with the check on stops at the first of them rather than printing a table with a hole.
 *
 * **WHAT A ROW PRICES IS `MAX_FORK_RULES`' GESTURE WITH THE EMIT REPLACED BY THE RETURN TRIP** — the design's *The
 * ceiling* decision. Four costs, each the median of `REPS` passes over the same text:
 *
 *   1. `clone`, the request's structured clone to the worker (`{ kind: 'tm-scratch', gen, src }`), through a real
 *      `MessageChannel`;
 *   2. `parse`, `tmScratch(src)` itself;
 *   3. `project`, the `tmProgram()`, `tmStatus()` and `tapeNames()` calls `onTmScratch` makes to build its reply;
 *   4. `back`, that reply's structured clone.
 *
 * `total` is the four medians summed, and **`spread` is the least and greatest of the per-pass totals**, so a row says
 * how far one pass can land from its median. `mount` is the median of `REPS` mounts of a `ScratchEditor` holding the
 * text, each timed to two nested animation frames as `tm-fork-cost.test.ts` times one, and reported beside the total
 * rather than in it: the design leaves the editor's own cost out of the ceiling. **NOR DOES IT MEASURE THAT
 * COST:** it waits for animation frames, and `MAX_SCRATCH_TM_BYTES`' doc records it falling as the text grew.
 *
 * **`bytes` IS THE TEXT'S UTF-8 LENGTH,** the unit `MAX_SCRATCH_TM_BYTES` counts in, since `tm_scratch_with_caps` reads
 * `src.len()`. A string's `length` counts UTF-16 code units, which agree with it only on ASCII text.
 *
 * **A FULL COLLECTION BEFORE EVERY PASS**, through the `gc` the browser project exposes (`vite.config.ts`'s launch
 * flags), so a pass does not pay to collect the previous pass's program object.
 *
 * `BRACKET` names the largest file whose total is under `BUDGET_MS` and the smallest whose total is not: the ceiling
 * belongs between them. `RATE` runs every file whose header records 1,000,000 to 200,000,000 steps, and whose text is
 * at most 5,000,000 bytes, out in `VALUE_CHUNK` chunks, as `runValueLoop` does. `CHUNK` times fifteen single calls of
 * each of four budgets, after one warm-up call, on one long run, `letx.single-tape.tm`.
 *
 * **GATED ON `REDEXTAPE_PROBE` AS `tm-fork-cost.test.ts` IS,** by `vite.config.ts`'s `PROBE_FILES` rather than a check
 * in this file, for the reason that list's doc gives.
 */

type ValueRunHandle = { run(budget: number): ValueRun; value(): Decoded; free(): void }
type TmScratchHandle = { tmProgram(): TmProgram; tmStatus(): TmScratchStatus; tapeNames(): string[]; free(): void }
type Made = { diagnostics: Diagnostic[]; scratch: TmScratchHandle | null; value: ValueRunHandle | null }

const FILES = import.meta.glob<string>('../../../target/probe-reduced-files/*.tm', {
  query: '?raw',
  import: 'default',
})

/** The probe's wasm build, with the size check off. See the file doc for why it is not a static import of `pkg/`. */
const PROBE_WASM = import.meta.glob<typeof Wasm>('../../../target/probe-tm-buffer-wasm/redextape_wasm.js')

/** The stamps the script writes beside the corpus and beside the build. */
const CORPUS_RUN = import.meta.glob<string>('../../../target/probe-reduced-files/run.txt', {
  query: '?raw',
  import: 'default',
})
const BUILD_RUN = import.meta.glob<string>('../../../target/probe-tm-buffer-wasm/run.txt', {
  query: '?raw',
  import: 'default',
})

/** The budget `MAX_FORK_RULES` was measured against, which the design gives the ceiling too. */
const BUDGET_MS = 250
const REPS = 7

const cloneMs = (payload: unknown) =>
  new Promise<number>((resolve) => {
    const ch = new MessageChannel()
    const start = performance.now()
    ch.port2.onmessage = () => resolve(performance.now() - start)
    ch.port1.postMessage(payload)
  })

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN
const ms = (x: number) => x.toFixed(1).padStart(7)
const collect = () => (globalThis as { gc?: () => void }).gc?.()

describe('TM buffer cost', () => {
  it('prices a build of every reduced file, and the value run’s step rate', async () => {
    const run = inject('probeTmBufferRun')
    const corpusRun = await Object.values(CORPUS_RUN)[0]?.()
    const buildRun = await Object.values(BUILD_RUN)[0]?.()
    if (run === '' || corpusRun !== run || buildRun !== run) {
      throw new Error(
        `BLOCKED: this run's stamp is "${run}", the corpus's "${corpusRun ?? 'absent'}" and the build's ` +
          `"${buildRun ?? 'absent'}"; run \`pnpm run test:probe:tm-buffer\`, which makes both and stamps them`,
      )
    }

    const loadWasm = Object.values(PROBE_WASM)[0]
    if (loadWasm === undefined) {
      throw new Error('BLOCKED: no probe wasm build; run `pnpm run test:probe:tm-buffer`, which builds it first')
    }
    const { default: init, tmScratch } = await loadWasm()
    await init()

    const build = (name: string, text: string): { scratch: TmScratchHandle; value: ValueRunHandle | null } => {
      const made = tmScratch(text) as Made
      if (made.scratch === null) {
        made.value?.free()
        const said = made.diagnostics.map((d) => d.message).join(' · ')
        throw new Error(`BLOCKED: ${name} did not build, so this is not the probe's wasm build: ${said}`)
      }
      return { scratch: made.scratch, value: made.value }
    }

    const utf8 = new TextEncoder()
    const loaded: { name: string; text: string; bytes: number }[] = []
    for (const [path, load] of Object.entries(FILES)) {
      const text = await load()
      loaded.push({ name: path.split('/').pop() ?? path, text, bytes: utf8.encode(text).length })
    }
    if (loaded.length === 0) {
      throw new Error('BLOCKED: no reduced files; run `pnpm run test:probe:tm-buffer`, which emits them first')
    }
    loaded.sort((a, b) => a.bytes - b.bytes)

    // Warm the parse and the clone path on the smallest file, so the first row is not a JIT reading.
    const smallest = loaded[0]
    if (smallest !== undefined) {
      for (let i = 0; i < 3; i++) {
        const { scratch, value } = build(smallest.name, smallest.text)
        await cloneMs({ kind: 'tm-scratch-compiled', gen: 1, tm: scratch.tmStatus(), tmProgram: scratch.tmProgram() })
        scratch.free()
        value?.free()
      }
    }

    const rows: string[] = []
    const totals: { name: string; bytes: number; total: number }[] = []
    for (const { name, text, bytes } of loaded) {
      const clone: number[] = []
      const parse: number[] = []
      const project: number[] = []
      const back: number[] = []
      const passes: number[] = []
      let rules = 0
      for (let r = 0; r < REPS; r++) {
        collect()
        const c = await cloneMs({ kind: 'tm-scratch', gen: 1, src: text })
        const t1 = performance.now()
        const { scratch, value } = build(name, text)
        const p = performance.now() - t1
        const t2 = performance.now()
        const tmProgram = scratch.tmProgram()
        const tm = scratch.tmStatus()
        const tapeNames = scratch.tapeNames()
        const j = performance.now() - t2
        rules = tmProgram.states.reduce((n, s) => n + s.rules.length, 0)
        const b = await cloneMs({ kind: 'tm-scratch-compiled', gen: 1, tm, tmProgram, tapeNames })
        scratch.free()
        value?.free()
        clone.push(c)
        parse.push(p)
        project.push(j)
        back.push(b)
        passes.push(c + p + j + b)
      }

      const mounts: number[] = []
      for (let r = 0; r < REPS; r++) {
        collect()
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
      totals.push({ name, bytes, total })
      rows.push(
        `SIZE ${name.padEnd(40)} bytes=${String(bytes).padStart(9)} rules=${String(rules).padStart(7)} ` +
          `clone=${ms(median(clone))} parse=${ms(median(parse))} project=${ms(median(project))} ` +
          `back=${ms(median(back))} total=${ms(total)} spread=${ms(Math.min(...passes))}-${ms(Math.max(...passes)).trim()} ` +
          `mount=${ms(median(mounts))}`,
      )
    }

    const under = totals.filter((t) => t.total < BUDGET_MS).sort((a, b) => b.bytes - a.bytes)[0]
    const over = totals.filter((t) => t.total >= BUDGET_MS).sort((a, b) => a.bytes - b.bytes)[0]
    const described = (t: (typeof totals)[number] | undefined) =>
      t === undefined ? 'none' : `${t.name} at ${t.bytes} bytes, ${t.total.toFixed(1)} ms`
    rows.push(`BRACKET largest under ${BUDGET_MS} ms: ${described(under)}; smallest at or over: ${described(over)}`)

    for (const { name, text, bytes } of loaded) {
      const steps = Number(/^steps (\d+)$/m.exec(text)?.[1] ?? 0)
      if (steps < 1_000_000 || steps > 200_000_000 || bytes > 5_000_000) continue
      const { scratch, value } = build(name, text)
      if (value === null) throw new Error(`BLOCKED: ${name} has a header and built no value run`)
      let end: ValueRun = { run: 'Running', steps: 0, cap: 0 }
      const t0 = performance.now()
      while (end.run === 'Running') end = value.run(VALUE_CHUNK)
      const elapsed = performance.now() - t0
      rows.push(
        `RATE ${name.padEnd(40)} steps=${String(end.steps).padStart(10)} ms=${ms(elapsed)} ` +
          `Msteps/s=${(end.steps / elapsed / 1000).toFixed(1)} end=${end.run} value=${JSON.stringify(value.value())}`,
      )
      value.free()
      scratch.free()
    }

    const long = loaded.find((l) => l.name === 'letx.single-tape.tm')
    if (long === undefined) throw new Error('BLOCKED: letx.single-tape.tm was not emitted')
    for (const budget of [100_000, 250_000, 500_000, 1_000_000]) {
      const { scratch, value } = build(long.name, long.text)
      if (value === null) throw new Error(`BLOCKED: ${long.name} built no value run`)
      value.run(budget)
      const times: number[] = []
      for (let i = 0; i < 15; i++) {
        const c0 = performance.now()
        const r = value.run(budget)
        times.push(performance.now() - c0)
        if (r.run !== 'Running') throw new Error(`BLOCKED: ${long.name} ended inside the chunk timings`)
      }
      rows.push(
        `CHUNK budget=${String(budget).padStart(9)} median_ms=${ms(median(times))} max_ms=${ms(Math.max(...times))}`,
      )
      value.free()
      scratch.free()
    }

    console.log(`\n${rows.join('\n')}\n`)
    // STRUCTURAL ONLY, as `tm-fork-cost.test.ts`'s is: every emitted file priced, none swallowed.
    expect(totals.length).toBe(loaded.length)
  }, 1_800_000)
})
