import { afterAll, afterEach, aroundAll, beforeEach, expect, inject } from 'vitest'
import { commands } from 'vitest/browser'
import { CHROMIUM } from './engine'

/**
 * Browser-tier setup, the SECOND of its three files, for Firefox's input; in Chromium it installs no wrapper, hook or
 * command call. Second, and importing nothing of `src`, so that what it wraps is wrapped before any module of `src` is
 * evaluated: `setup.ts` imports `src`, and an import here would be evaluated before this module's body. In Firefox it
 * gives the frame the focus at the file's start and before a `focus()` the frame would ignore, fails a pointer capture
 * outside the capture project and registers this project's browser, and in `firefox-capture` fails a file that begins
 * while another is in flight (`vite.config.ts`'s `CAPTURE_FILES` and commands).
 */

/**
 * A pointer capture that held, taken in this page: whether the event in dispatch at the call was real input,
 * `undefined` when none was, and the element's tag and class.
 */
interface CaptureRecord {
  trusted: boolean | undefined
  element: string
}

/** What led to a capture, in the guard's words. */
function input({ trusted }: CaptureRecord): string {
  if (trusted === undefined) return 'no event at the call'
  return trusted ? 'real input' : 'a synthetic event'
}

/**
 * The guard's records, ON THE WINDOW, NOT IN THIS MODULE: a test file that imports this module gets an instance of its
 * own beside the one Vitest loaded as a setup file, and its exports must read what that one recorded. Only the first
 * instance in a page installs anything, so each page's prototypes are wrapped once.
 */
interface Records {
  ofCase: CaptureRecord[]
  ofHooks: CaptureRecord[]
  inCase: boolean
}
const page = window as Window & { __redextapeFirefoxInput?: Records }
const first = page.__redextapeFirefoxInput === undefined
page.__redextapeFirefoxInput ??= { ofCase: [], ofHooks: [], inCase: false }
const records = page.__redextapeFirefoxInput

/** The captures that held in the case that is running, for `two-browsers.test.ts`'s check of the guard. */
export function capturesOfThisCase(): readonly CaptureRecord[] {
  return records.ofCase
}

/** The guard's failure: `file` took the captures `records` outside the capture project. */
export function captureFailure(records: readonly CaptureRecord[], file: string): string {
  const where = records.map((r) => `${r.element} (${input(r)})`).join(', ')
  return (
    `${file} took a pointer capture that held, on ${where}, in the \`firefox\` project. In one Firefox every page's ` +
    'mouse is one pointer, so a capture takes the clicks of every other tab: add the file to `CAPTURE_FILES` in ' +
    'vite.config.ts, whose project runs one file at a time in a Firefox of its own.'
  )
}

/** A test file's path from `web/`, as `CAPTURE_FILES` names it. */
const fromWeb = (path: string): string => `tests/${path.split('/tests/').pop()}`
const file = fromWeb(expect.getState().testPath ?? '(unknown)')

if (!CHROMIUM && first) {
  // THE CONDITION IS A CAPTURE THAT HOLDS, NOT ONE MADE BY REAL INPUT: a capture that holds is what takes the other
  // tabs' clicks, and reading it after the call needs no `window.event`.
  const setPointerCapture = Element.prototype.setPointerCapture
  Element.prototype.setPointerCapture = function (this: Element, pointerId: number): void {
    setPointerCapture.call(this, pointerId)
    if (!this.hasPointerCapture(pointerId)) return
    const cls = this.classList[0]
    ;(records.inCase ? records.ofCase : records.ofHooks).push({
      trusted: window.event?.isTrusted,
      element: cls === undefined ? this.localName : `${this.localName}.${cls}`,
    })
  }

  // A FRAME WITHOUT THE FOCUS IGNORES `focus()`, and every file's frame starts so, with the focus in the top document.
  // So the frame takes it here, at the file's start, and not only at a `focus()` (below): after a file whose frame
  // ended focused, the first focus a real click or a popover's `autofocus` moves into the next frame goes to its
  // window and to no element, neither the click's target nor the one marked `autofocus`.
  window.focus()

  // THE FOCUS CAN LEAVE THE FRAME MID-FILE, for the top document, and a `focus()` is then ignored again. Vitest's
  // `keyboard` gives the frame the focus before it types if the frame's `activeElement` is its body; this does so
  // before every `focus()` that would otherwise be ignored, the app's own included, which no harness call precedes.
  for (const proto of [HTMLElement.prototype, SVGElement.prototype]) {
    const focus = proto.focus
    proto.focus = function (this: HTMLElement | SVGElement, options?: FocusOptions): void {
      if (!document.hasFocus()) window.focus()
      focus.call(this, options)
    }
  }

  await commands.registerBrowser()

  // THE GUARD RELIES ON THREE OF VITEST'S DEFAULTS. `sequence.hooks: 'stack'` runs these `after*` hooks after the
  // file's own, so a capture in its own `afterAll` is seen, where under `'list'` it would pass. Only a page's first
  // instance of this module installs them, so each file is guarded only while each file has a page of its own, as the
  // default `isolate` gives it. And a page keeps one case's records, so its cases must run one at a time, as they do
  // unless `concurrent` is set: two at once would clear or take each other's.
  const refused = inject('pointerCaptureRefused')
  beforeEach(() => {
    records.ofCase = []
    records.inCase = true
  })
  afterEach(() => {
    records.inCase = false
    if (refused && records.ofCase.length > 0) throw new Error(captureFailure(records.ofCase, file))
  })
  afterAll(() => {
    if (refused && records.ofHooks.length > 0) throw new Error(captureFailure(records.ofHooks, file))
  })

  if (!refused) {
    // THE LATER OF TWO OVERLAPPING FILES FAILS HERE: it begins while the earlier is still in the set. AN `aroundAll`,
    // NOT AN `afterAll`: a file's own `afterAll` runs before this module's, and one that throws ends the hook list,
    // so an `afterAll` here would leave the file in the set and fail every later one.
    const own = expect.getState().testPath
    aroundAll(async (runSuite) => {
      const inFlight = await commands.captureFileSpan('begin')
      try {
        if (own === undefined || !inFlight.includes(own)) {
          throw new Error(`the one-at-a-time check did not hear ${file} begin: it replied ${JSON.stringify(inFlight)}`)
        }
        const others = inFlight.filter((f) => f !== own).map(fromWeb)
        if (others.length > 0) {
          throw new Error(
            `${file} began while ${others.join(', ')} had not ended: \`firefox-capture\` runs its files one at a time ` +
              '(`browser.fileParallelism: false` in vite.config.ts), since a capture in one takes the clicks of another.',
          )
        }
        await runSuite()
      } finally {
        await commands.captureFileSpan('end')
      }
    })
  }
}
