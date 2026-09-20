import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, PRESETS, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A WORKSPACE THAT IS NOT EXPLORER'S, AT FIRST PAINT.**
 *
 * `main.ts` calls `applySwitches()` once after the first `applyLayout()`, and its comment says a restored
 * workspace "can carry any of the eight combinations". Nothing tested it: every other browser file seeds
 * through `defaultWorkspace()` or `PRESETS.explorer`, and `index.html` already ships `#step-bar` and
 * `#inspector` hidden with `#results` in the strip — so **deleting that call left the whole tier green**
 * while a user who left in Debugger came back to an Explorer-shaped page under a button reading
 * "Debugger". The header would have been the only thing that moved, because `paintWorkspaceButton` is
 * called separately.
 *
 * This file is the one that boots somewhere else.
 */

beforeAll(async () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace({ ...defaultWorkspace(), switches: PRESETS.debugger }))
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('a workspace stored in Debugger', () => {
  it('comes up in Debugger, not merely labelled Debugger', () => {
    expect(document.querySelector('#workspace')?.textContent?.trim()).toBe('Debugger ▾')
    // THE THREE SWITCHES, EACH READ WHERE IT ACTS — the button's name is the one thing that moves without
    // `applySwitches`, so asserting it alone is what let the gap survive.
    expect(document.querySelector<HTMLElement>('#step-bar')?.hidden, 'the step bar is down').toBe(false)
    expect(document.querySelector<HTMLElement>('#inspector')?.hidden, 'the inspector is down').toBe(false)
    expect(
      document.querySelector('#inspector')?.contains(document.querySelector('#results')),
      'the readout is still in the strip',
    ).toBe(true)
    expect(
      document.querySelector('[data-leaf="lambda-0"] .view-steps .controls'),
      'a view still draws its own step controls',
    ).toBeNull()
    // Debugger keeps the tiles, which is what separates it from Stage.
    expect(document.querySelectorAll('#views [role="tab"]').length, 'Debugger is drawing a stage').toBe(0)
  })
})
