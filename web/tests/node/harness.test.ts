import { describe, expect, it } from 'vitest'
import { SHELL, until } from '../browser/harness'

describe('SHELL', () => {
  it('carries the elements the app mounts into', () => {
    for (const sel of [
      '#appearance',
      '#workspace',
      '#reset-preset',
      '#new-view',
      '#buffers',
      '#encoding',
      '#settings',
      '#style',
      '#palette',
      '#notice',
      '#live',
      '#results',
      '#link-status',
      '#appearance-choice',
      '#workspace-menu',
      '#new-view-menu',
      '#settings-menu',
    ]) {
      // `id="…"`, NOT THE BARE WORD: a substring test is satisfied by a NEIGHBOUR's id — `#new-view` by
      // `id="new-view-menu"`, `#settings` by `id="settings-menu"`, `#appearance` by the settings label's
      // own text — so deleting the element this list is about would leave it green.
      expect(SHELL).toContain(`id="${sel.slice(1)}"`)
    }
    expect(SHELL).toContain('<main></main>')
  })
})

describe('until', () => {
  it('evaluates the predicate before its first sleep', async () => {
    let polls = 0
    await until(() => {
      polls += 1
      return true
    })
    expect(polls).toBe(1)
  })

  it('polls until the predicate flips', async () => {
    let n = 0
    await until(() => ++n > 3, 'four evaluations', 1_000, 1)
    expect(n).toBe(4)
  })

  it('names the condition the call site described', async () => {
    await expect(until(() => false, 'the pane to mount', 30, 5)).rejects.toThrow(
      'timed out after 30ms waiting for the pane to mount',
    )
  })

  it('quotes the predicate source when the call site named nothing', async () => {
    await expect(until(() => 1 > 2, undefined, 30, 5)).rejects.toThrow(/waiting for `.*1 > 2.*`/)
  })

  it('truncates a predicate source too long to belong in a failure log', async () => {
    // Use a long inline string so toString() exceeds MAX_SOURCE_CHARS (120)
    const predicate = () =>
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
        .length < 0
    await expect(until(predicate, undefined, 30, 5)).rejects.toThrow(/…`$/)
  })
})
