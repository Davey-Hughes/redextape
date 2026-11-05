import { expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { captureFailure, capturesOfThisCase } from '../browser/firefox-input'
import { until } from '../browser/until'

/**
 * The premise of the split into two Firefox projects, which Vitest does not document: each project gets a browser of
 * its own, so a capture held in `firefox-capture` takes no click from a page of `firefox`. On the capture list, since
 * it takes a real capture itself. It needs a file of `firefox` running beside it, as a full `pnpm test:firefox` has.
 */

let registered: { others: number; browsers: number } | undefined
let asking = false

/** Asks the config's process which projects have registered, one request at a time, for a synchronous `until`. */
function rest(): boolean {
  if (!asking) {
    asking = true
    void commands.registerBrowser().then((r) => {
      registered = r
      asking = false
    })
  }
  return (registered?.others ?? 0) > 0
}

it('takes no click from the other project while a real press holds a capture', async () => {
  await until(rest, 'the `firefox` project to register its browser: name a file of it beside this one')
  expect(registered?.browsers, 'the two projects registered two browsers').toBe(2)

  const handle = document.createElement('div')
  handle.className = 'handle'
  handle.style.cssText = 'position:fixed;left:40px;top:40px;width:200px;height:12px;touch-action:none'
  document.body.append(handle)
  let moves = 0
  let ups = 0
  handle.addEventListener('pointerdown', (e) => handle.setPointerCapture(e.pointerId))
  handle.addEventListener('pointermove', () => moves++)
  handle.addEventListener('pointerup', () => ups++)
  try {
    const own = await commands.decoyDuringCapture('.handle', 'own')
    expect(own, 'precondition: a decoy in this project’s browser loses its click to the capture').toEqual({
      decoyClicks: 0,
      decoyAlone: 1,
    })

    moves = 0
    const upsBefore = ups
    const other = await commands.decoyDuringCapture('.handle', 'rest')
    await until(() => ups > upsBefore, 'the release of the press with the decoy in the other browser')
    expect(other, 'a decoy in the other project’s browser keeps its click').toEqual({ decoyClicks: 1, decoyAlone: 1 })
    expect(moves, 'the handle heard every move of the press').toBe(6)

    const records = capturesOfThisCase()
    expect(records, 'the guard recorded the real presses’ captures').toContainEqual({
      trusted: true,
      element: 'div.handle',
    })
    expect(captureFailure(records, 'tests/firefox/two-browsers.test.ts')).toContain(
      'tests/firefox/two-browsers.test.ts took a pointer capture that held, on div.handle (real input)',
    )
  } finally {
    handle.remove()
  }
})
