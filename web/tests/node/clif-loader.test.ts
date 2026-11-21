import { describe, expect, it } from 'vitest'
import { type ClifModule, clifLoader } from '../../src/clif-loader'

/** A module that is nothing but itself: the loader hands back what `load` resolved, and these cases ask which one. */
const fakeModule = (): ClifModule => ({
  ClifSession: class {
    constructor() {
      throw new Error('no case builds a stepper')
    }
  } as unknown as ClifModule['ClifSession'],
})

describe('clifLoader', () => {
  it('loads once for two calls', async () => {
    const module = fakeModule()
    let loads = 0
    const get = clifLoader(async () => {
      loads += 1
      return module
    })
    expect(await get()).toBe(module)
    expect(await get()).toBe(module)
    expect(loads).toBe(1)
  })

  it('shares one load between calls made while it is pending', async () => {
    const module = fakeModule()
    let loads = 0
    let finish: (m: ClifModule) => void = () => {}
    const get = clifLoader(() => {
      loads += 1
      return new Promise<ClifModule>((resolve) => {
        finish = resolve
      })
    })
    const first = get()
    const second = get()
    expect(loads).toBe(1)
    finish(module)
    expect(await first).toBe(module)
    expect(await second).toBe(module)
    expect(loads).toBe(1)
  })

  it('forgets a failure, so the next call loads again', async () => {
    const module = fakeModule()
    let loads = 0
    const get = clifLoader(async () => {
      loads += 1
      if (loads === 1) throw new Error('the fetch failed')
      return module
    })
    await expect(get()).rejects.toThrow('the fetch failed')
    expect(await get()).toBe(module)
    expect(loads).toBe(2)
  })
})
