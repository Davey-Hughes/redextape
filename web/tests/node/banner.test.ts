import { describe, expect, it } from 'vitest'
import { bannerText, workerErrorText } from '../../src/banner'

describe('bannerText', () => {
  it('names the failure when there is a message to name', () => {
    expect(bannerText(new Error('failed to fetch'))).toContain('failed to fetch')
  })

  it('still says something for a thrown non-Error', () => {
    expect(bannerText('boom')).toContain('boom')
    expect(bannerText(null)).toContain('no detail available')
  })

  it('tells the reader what to do rather than only what broke', () => {
    // PR 3c shipped no failure surface at all, so the failure mode was a blank page and a console
    // message. A banner that only names the exception would be a smaller version of the same problem.
    expect(bannerText(new Error('x'))).toContain('pnpm run build:wasm')
  })
})

describe('workerErrorText', () => {
  it('names the failure when there is a message to name', () => {
    expect(workerErrorText(new Error('unknown encoding: nonsense'))).toContain('unknown encoding: nonsense')
  })

  it('still says something for a thrown non-Error', () => {
    expect(workerErrorText('boom')).toContain('boom')
    expect(workerErrorText(null)).toContain('no detail available')
  })

  // This is NOT `bannerText`'s message: the app already started, so telling the reader to rebuild the
  // wasm module would send them chasing a fix that cannot be the cause.
  it('does not tell the reader to rebuild the wasm module', () => {
    expect(workerErrorText(new Error('x'))).not.toContain('build:wasm')
  })

  it('says the app is still usable', () => {
    expect(workerErrorText(new Error('x'))).toContain('still live')
  })
})
