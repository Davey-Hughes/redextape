import { beforeEach, describe, expect, it } from 'vitest'
import { bannerText, showBanner } from '../../src/banner'

/**
 * **THE SURFACE NOBODY HAS EVER SEEN RENDER.**
 *
 * `showBanner` is the app's answer to *"redextape did not start"* — the wasm module never loaded, or the
 * worker's module never did. `main.ts` calls it in exactly one place, inside the `try` around `init()`,
 * and then re-throws. Everything under `<main>` is gone at that point: no editor, no panes, no results.
 * The banner is the whole of what the user gets.
 *
 * **AND IT HAD NO TEST AT ALL, WHICH THE COVERAGE REPORT SAID AND THE FILE LIST DISGUISED.**
 * `tests/node/banner.test.ts` covers `bannerText` — the WORDING — and `banner.ts` splits the two
 * precisely so the wording is node-testable. That left the DOM write uncovered. `app.test.ts` mentions
 * `showBanner` twice and both times to assert it did NOT fire (a `worker-error` must not tear the page
 * down), so a `grep` for the name finds two files and neither executes it. Six statements and one
 * function, on the path where a failure means the user is looking at a page with nothing on it.
 *
 * **THE POINT OF TESTING IT IN A BROWSER IS THAT IT IS VISIBLE**, which is the one claim a node tier
 * cannot make and the one the blank-page failure is about. `tests/browser/setup.ts` loads the app's own
 * `style.css` into the tester page, so `.banner`'s real rule is in force here — a class that resolved to
 * `display: none`, or an element appended somewhere with no box, would satisfy every structural
 * assertion below and still leave the user with the blank page this function exists to replace.
 */

let host: HTMLElement

beforeEach(() => {
  document.body.replaceChildren()
  host = document.createElement('main')
  document.body.append(host)
})

describe('showBanner', () => {
  /**
   * THE REPLACEMENT IS THE BEHAVIOUR, not the appending. `banner.ts`'s own doc: "nothing under `<main>`
   * — not the editor, not either pane — was ever wired up, so replacing all of it is the only honest
   * answer". A version that appended would leave the half-built page underneath the explanation, which
   * is the state `showWorkerError` exists to keep this one away from.
   */
  it('replaces everything under the host with one banner', () => {
    host.append(document.createElement('section'), document.createElement('div'))
    expect(host.children).toHaveLength(2)

    showBanner(host, new Error('failed to fetch'))

    expect(host.children).toHaveLength(1)
    expect(host.querySelector('section')).toBeNull()
    expect(host.firstElementChild?.className).toBe('banner')
  })

  /**
   * **IT ANNOUNCES ITSELF, WHICH ON THIS PATH IS THE ONLY THING THAT CAN.** Every other surface in this
   * app is deferred to the accessibility pass on the argument that a user can see the page change. Here
   * there is no page: the DOM went from an app to one `<div>` in a single call, with no focus move and
   * no other signal. `role="alert"` is what makes that reach a screen reader, and it is the reason this
   * assertion is not a restatement of the class check above.
   */
  it('carries role="alert", because on this path nothing else reports', () => {
    showBanner(host, new Error('failed to fetch'))
    expect(host.firstElementChild?.getAttribute('role')).toBe('alert')
  })

  /**
   * THE WORDING IS `bannerText`'s AND IS ASSERTED AS SUCH RATHER THAN RE-SPELLED. The node tier pins
   * what that function says; what this tier adds is that the string reaches the element — a `textContent`
   * assignment dropped or pointed at the wrong node fails here and nowhere else.
   *
   * THE INSTRUCTION IS CHECKED SEPARATELY because it is the half that makes the banner worth rendering:
   * `banner.ts` records that the most likely cause on a fresh clone is an unbuilt `pkg/`, and a message
   * naming only the exception "sends the reader to the network tab instead of to the one command that
   * fixes it".
   */
  it('renders the text bannerText composes, including the way out', () => {
    const e = new Error('failed to fetch')
    showBanner(host, e)
    expect(host.textContent).toBe(bannerText(e))
    expect(host.textContent).toContain('pnpm run build:wasm')
  })

  /**
   * A THROWN NON-`Error`, which is not a hypothetical here: `init()` rejects with whatever the wasm
   * glue threw, and `main.ts`'s worker `error` listener hands over an `ErrorEvent`. `bannerText` already
   * answers both; this asserts the DOM write does not depend on the shape either.
   */
  it('renders for a thrown non-Error too', () => {
    showBanner(host, 'boom')
    expect(host.textContent).toContain('boom')
    expect(host.children).toHaveLength(1)
  })

  /**
   * **AND IT IS ON SCREEN.** The failure this whole function exists to prevent is a blank page, so the
   * assertion that separates "rendered" from "did the right thing" is a box with a size. Under the app's
   * own stylesheet: `.banner` sets padding, a border and a monospace font, so a real one cannot measure
   * zero — and a rule that hid it, or an element left unparented, would pass every other test in this
   * file.
   */
  it('is actually visible under the app’s own stylesheet', () => {
    showBanner(host, new Error('failed to fetch'))
    const el = host.firstElementChild as HTMLElement
    const box = el.getBoundingClientRect()

    expect(box.width).toBeGreaterThan(0)
    expect(box.height).toBeGreaterThan(0)
    expect(getComputedStyle(el).display).not.toBe('none')
    expect(getComputedStyle(el).visibility).toBe('visible')
  })
})
