import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { compile, initSync, type Session } from '../../../pkg/redextape_wasm.js'
import type { LambdaStatus, RxmStatus } from '../../src/types'

/**
 * **A BIG LITERAL DECLINES THE λ LEG AND LEAVES THE MODULE WHOLE.** A Church numeral is as large as its value, and
 * wasm32's memory is bounded: running out of it aborts the whole module. Only the release `pkg/` shows this: a native
 * `cargo test` has the memory a wasm32 instance lacks. Every compile here shares ONE instance, as the session worker's
 * do, so a trap in an earlier one fails the ones after it.
 */

const pkg = (file: string) => readFileSync(fileURLToPath(new URL(`../../../pkg/${file}`, import.meta.url)))

beforeAll(() => {
  initSync({ module: pkg('redextape_wasm_bg.wasm') })
})

function compiled(src: string): Session {
  const { session } = compile(src, 'unary') as { session: Session | null }
  if (session === null) throw new Error(`no session for ${src}`)
  return session
}

/**
 * The three `saturation` programs of the native corpus, whose values are at or past 2^64, each beside the literal its λ
 * decline names.
 */
const SATURATION: [src: string, literal: string][] = [
  ['18446744073709551615 + 1', '18446744073709551615'],
  ['let n = 18446744073709551615; n + 1', '18446744073709551615'],
  ['4294967295 * 4294967295 * 4294967295', '4294967295'],
]

describe('a literal past the λ bound', () => {
  const past: [src: string, literal: string][] = [['33554431 + 1', '33554431'], ['2999', '2999'], ...SATURATION]
  for (const [src, literal] of past) {
    it(`declines the λ leg for ${src} and compiles the rxm leg`, () => {
      const session = compiled(`${src}\n`)
      const lambda = session.lambdaStatus() as LambdaStatus
      expect(lambda.available, 'the λ leg').toBe(false)
      expect(lambda.reason).toMatch(/^the λ backend does not support a literal above 2,998/)
      const span =
        lambda.node === null ? null : (session.sourceSpan(lambda.node) as { start: number; end: number } | null)
      expect(span === null ? null : src.slice(span.start, span.end), 'the decline names the literal').toBe(literal)
      expect((session.rxmStatus() as RxmStatus).available, 'the rxm leg').toBe(true)
      session.free()
    }, 60_000)
  }

  it('keeps the λ leg of a literal at the bound, and of an ordinary program after the declines', () => {
    const edge = compiled('2998\n')
    expect((edge.lambdaStatus() as LambdaStatus).available, 'the λ leg of 2998').toBe(true)
    edge.free()
    const session = compiled('let x = 40; x + 2\n')
    expect((session.lambdaStatus() as LambdaStatus).available, 'the λ leg').toBe(true)
    expect(session.runLambda(1_000_000), 'the λ run').toBe('Ended')
    session.free()
  })
})
