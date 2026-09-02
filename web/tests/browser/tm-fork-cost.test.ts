import { describe, expect, it } from 'vitest'
import init, { compile, tmScratch } from '../../../pkg/redextape_wasm.js'
import { ScratchEditor } from '../../src/scratch-editor'
import type { TmProgram, TmStatus } from '../../src/types'

/**
 * 5d-iv T2 — THE TM-FORK-COST PROBE. Design §3.1, §4.2.
 *
 * **A PROBE, NOT A TEST — IT PRINTS AND ASSERTS ALMOST NOTHING.** Like `buffer-affordability.test.ts`
 * it exists to produce the number `MAX_FORK_RULES` is set from, not to defend one that already exists.
 * Run it with `pnpm test:probe:tm`.
 *
 * **FOUR COSTS ARE MEASURED SEPARATELY BECAUSE THEY HAVE DIFFERENT REMEDIES.** A slow `postMessage`
 * argues for a smaller cap; a slow CodeMirror mount argues for a smaller cap; a slow `tmScratch` parse
 * argues for nothing this slice can change, and if it dominates then the cap is being set by a cost the
 * user pays once and the other three should decide it.
 *
 * **THE SIZE WALL, PRE-MEASURED (design §3.1): `list20` is 16,250 lines and must clear whatever cap
 * this probe sets; `list60` is 127,890 lines — a factor of ~7.9 more — and must not.** The
 * pre-registered candidate WAS 20,000 rules — REJECTED, high by a factor of 2.5 (roadmap: "PLAN
 * 5d-iv CLOSES", Question 1). `MAX_FORK_RULES` shipped at 50,000; the FIX ROUND below is what measured
 * the candidate, found the rejection, and is what this file now defends rather than merely proposes.
 *
 * **FIX ROUND — TWO GAPS THE FIRST CUT LEFT OPEN, BOTH CLOSED HERE:**
 *
 * 1. **THE FIRST CUT'S CAP WAS AN INTERPOLATION ACROSS AN 82,380-RULE GAP, NOT A MEASUREMENT.** Only
 *    `list20` (11,802 rules) and `list60` (94,182 rules) were ever run; the cap was chosen by fitting a
 *    curve through those two distant points and reading off where it crosses 250 ms, with nothing
 *    measured inside the gap between them. A two-point fit has zero residual by construction and proves
 *    nothing about the shape of the curve between its endpoints — this project's own rule is that a cost
 *    claim is not established until a program chosen to break it has actually been run, and 5d-ii-d's
 *    affordability probe was rejected once already for this exact shape of error. `list35`, `list43`,
 *    `list47` and `list50` below exist to put real readings inside that gap, close to where the
 *    two-point fit predicted the crossing, so the final cap comes from programs that were actually run
 *    rather than a shape merely assumed between two distant brackets.
 *
 * 2. **CODEMIRROR'S MOUNT WAS UNMEASURED, AND IT IS PART OF THE GESTURE THE 250 MS BUDGET COVERS.** The
 *    budget is for the whole thing the user waits on when they click fork — emit, clone, parse, AND the
 *    editor appearing with the forked text in it — not just the three wasm-side legs. This file now
 *    mounts a real `ScratchEditor` (`web/src/scratch-editor.ts`'s own class — `LambdaEditor` before T7
 *    renamed it and reused it for the TM leg, design decision 5) with each program's emitted `.tm` text
 *    as its document, into a host element attached to `document.body` so it actually lays out and
 *    paints, and times to two nested `requestAnimationFrame` callbacks — the standard proxy for "this
 *    frame has painted," since a single `requestAnimationFrame` callback runs BEFORE the browser paints,
 *    not after. The view is destroyed and its host removed before the next program mounts, so no
 *    program's reading is inflated by a previous program's leftover DOM.
 *
 * **GATED ON `REDEXTAPE_PROBE` EXACTLY THE WAY `buffer-affordability.test.ts` IS — file-level exclusion
 * in `vite.config.ts`, not a check inside this file.** `2026-08-17-plan5d-iv-editable-tm.md`'s own
 * sketch reads `process.env.REDEXTAPE_PROBE` at module scope and gates with `describe.runIf`; that
 * idiom does not survive contact with the browser project — `process` is a Node global, and the browser page this
 * file runs on does not have one (`ReferenceError: process is not defined`, thrown importing this file
 * the moment that line exists). `buffer-affordability.test.ts` carries no `PROBE` constant and no
 * `runIf` anywhere in it for the same reason: the check has to happen on the Node side, before the file
 * is ever fetched into the browser at all, which is what `vite.config.ts`'s `PROBE_EXCLUDE` does. This
 * file's `describe` below is therefore unconditional, same as that file's, and `pnpm test:probe:tm` is
 * the only thing that ever lets Vitest see it.
 */

/**
 * `pkg`'s generated declarations type every method's return as `any` — same reason `shapes.test.ts`
 * and `frame-cost.test.ts` declare a structural `Session` locally rather than trusting the import.
 * `tmText(): string | null` is Task 1's contract (`session.rs`'s own doc on the method): `null` is not
 * fallible, it is the fact of a declined TM leg, so this file checks `tmStatus().available` first —
 * `session-worker.ts`'s own guard on the identical hazard (`tmProgram` throws for a declined leg,
 * and an uncaught throw here would abort the whole probe rather than reporting one row as declined).
 */
type Session = {
  tmStatus(): TmStatus
  tmProgram(): TmProgram
  tmText(): string | null
  free(): void
}

type TmScratchHandle = {
  free(): void
}

const PROGRAMS: readonly { name: string; src: string }[] = [
  { name: 'sample', src: 'let x = 40; x + 2' },
  { name: 'list2', src: '[1, 2]' },
  { name: 'while4', src: 'let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc' },
  { name: 'sum5', src: 'fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)' },
  { name: 'list20', src: `[${Array.from({ length: 20 }, (_, i) => i + 1).join(', ')}]` },
  // The confirming points — see the FIX ROUND doc above. Same [1, …, n] list-literal shape as list20
  // and list60, chosen to land inside the gap between them, close to where the first cut's two-point
  // fit predicted the 250 ms crossing.
  { name: 'list35', src: `[${Array.from({ length: 35 }, (_, i) => i + 1).join(', ')}]` },
  { name: 'list43', src: `[${Array.from({ length: 43 }, (_, i) => i + 1).join(', ')}]` },
  { name: 'list47', src: `[${Array.from({ length: 47 }, (_, i) => i + 1).join(', ')}]` },
  { name: 'list50', src: `[${Array.from({ length: 50 }, (_, i) => i + 1).join(', ')}]` },
  { name: 'list60', src: `[${Array.from({ length: 60 }, (_, i) => i + 1).join(', ')}]` },
]

describe('TM fork cost', () => {
  it('prices emit, postMessage clone, tmScratch parse and CodeMirror mount across the size-wall corpus', async () => {
    await init()

    const rows: string[] = []
    for (const { name, src } of PROGRAMS) {
      const { session } = compile(src, 'unary') as { session: Session | null }
      if (session === null) {
        rows.push(`${name.padEnd(8)} no session`)
        continue
      }

      const status = session.tmStatus()
      if (!status.available) {
        rows.push(`${name.padEnd(8)} TM leg declined: ${status.reason}`)
        session.free()
        continue
      }
      const program = session.tmProgram()
      const rules = program.states.reduce((n, s) => n + s.rules.length, 0)

      const t0 = performance.now()
      const text = session.tmText()
      const emitMs = performance.now() - t0
      if (text === null) {
        throw new Error(`BLOCKED: ${name}'s TM leg reported available but tmText() returned null`)
      }

      // postMessage cost, measured as a real structured clone through a MessageChannel rather than
      // as a string length: the clone is what the app actually pays, once in each direction.
      const clone = await new Promise<number>((resolve) => {
        const ch = new MessageChannel()
        const start = performance.now()
        ch.port2.onmessage = () => resolve(performance.now() - start)
        ch.port1.postMessage({ kind: 'tm-scratch', gen: 1, src: text })
      })

      const t1 = performance.now()
      const { scratch } = tmScratch(text) as { scratch: TmScratchHandle | null }
      const parseMs = performance.now() - t1
      if (scratch === null) {
        throw new Error(`BLOCKED: ${name}'s emitted .tm text failed to round-trip through tmScratch`)
      }
      scratch.free()

      // CodeMirror mount cost — see the FIX ROUND doc above. A real `ScratchEditor`, the same class the
      // TM leg's editor is now (T7's rename), mounted with this program's emitted text as its
      // document into a host attached to `document.body` so it actually lays out and paints. Timed to
      // two nested `requestAnimationFrame` callbacks: the first callback runs before the browser has
      // painted the frame it was scheduled in, so a second, nested callback is needed to land after
      // that paint has happened. Destroyed and removed before the next program mounts so no reading is
      // inflated by a previous program's leftover DOM.
      const host = document.createElement('div')
      document.body.append(host)
      const t2 = performance.now()
      const editor = new ScratchEditor({ host, initial: text, debounceMs: 300, onEdit: () => {} })
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
      const mountMs = performance.now() - t2
      editor.destroy()
      host.remove()

      rows.push(
        `${name.padEnd(8)} rules=${String(rules).padStart(7)} bytes=${String(text.length).padStart(8)} ` +
          `emit=${emitMs.toFixed(1)}ms clone=${clone.toFixed(1)}ms parse=${parseMs.toFixed(1)}ms ` +
          `mount=${mountMs.toFixed(1)}ms total=${(emitMs + clone + parseMs + mountMs).toFixed(1)}ms`,
      )
      session.free()
    }
    console.log(`\n${rows.join('\n')}\n`)
    // STRUCTURAL ONLY — this is not an assertion about a timing number. The corpus has ten entries and
    // every branch above either pushes a row or throws BLOCKED, so a short `rows` means a program was
    // silently swallowed somewhere above rather than counted or reported as declined.
    expect(rows.length).toBe(PROGRAMS.length)
  }, 600_000)
})
