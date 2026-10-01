import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { encodeLink, LINK_PREFIX } from '../../src/share-link'
import { defaultWorkspace, PRESETS, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **THE LATEST LINK WINS** — Plan 7 part 6a spec §5.3: a link whose read ends after a later link has opened is dropped
 * unsaid, whatever it holds. Nothing is replaced and nothing said, the later open's `undo` is still the one offered,
 * and the fragment is as the later open left it.
 *
 * **IN CHROME TWO READS NEVER OVERLAP**: a link's read does not yield to the event loop (spec §5.3's note has the
 * measurement), so it ends before a later `hashchange` can be dispatched. So the order is forced here by a stand-in put
 * in front of the first decompressor made, as
 * `share-link-inflate.test.ts` puts a counter in front of one: it holds link A's input until link B has opened, then
 * lets it through. **A FILE OF ITS OWN**, because `share-open-hashchange.test.ts`'s cases share one page and each
 * starts where the last left it, and these two links' order is the whole of what is held, so each case here starts on
 * the program the page opened on. ONE MOUNT FOR THE FILE, for the reason every sibling gives: ES module imports are
 * cached, so `main()` runs once per page, and Vitest gives each test file its own page.
 */

const SUM_TO = EXAMPLES.find((e) => e.id === 'sum-to')?.text ?? ''
const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
/** The program the page opens on (`setup.ts`), which neither link holds. */
const BEFORE = 'let x = 40; x + 2'
/** Link B, the later: `sum_to(5)` in the Debugger preset. */
const LINK_B = {
  program: SUM_TO,
  encoding: 'binary',
  workspace: serializeWorkspace({ ...defaultWorkspace(), switches: PRESETS.debugger }),
  positions: {},
}

const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const readout = () => [...document.querySelectorAll('#results .segment, #results .row')].length
const workspaceName = () => document.querySelector('#workspace')?.textContent

/** `#s=` and `text`, deflated: a link that inflates whole, to anything. */
async function linkOf(text: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  let binary = ''
  for (const byte of new Uint8Array(await new Response(stream).arrayBuffer())) binary += String.fromCharCode(byte)
  return `${LINK_PREFIX}${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`
}

/** Link A, the earlier, in each of the three ways a link opens (spec §5.3): never `sum_to(5)`, never Debugger. */
const KINDS = [
  [
    'whole',
    () =>
      encodeLink({
        program: FACT,
        encoding: 'binary',
        workspace: serializeWorkspace({ ...defaultWorkspace(), switches: PRESETS.stage }),
        positions: {},
      }),
  ],
  [
    'as its program alone',
    () => encodeLink({ program: FACT, encoding: 'binary', workspace: 'not a workspace', positions: {} }),
  ],
  ['as nothing, unreadable', () => linkOf('not a payload')],
] as const

const Real = globalThis.DecompressionStream

/**
 * Stand a gate in front of the next decompressor made, and only that one: its input waits until `release`, and
 * `ended` turns true once its output has all been read. Every later one is the real decompressor, untouched.
 */
function holdNextDecode(): { release: () => void; made: () => number; ended: () => boolean } {
  let release = (): void => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let made = 0
  let ended = false
  class Held {
    readonly readable: ReadableStream<Uint8Array<ArrayBuffer>>
    readonly writable: WritableStream<BufferSource>
    constructor(format: CompressionFormat) {
      const real = new Real(format)
      made += 1
      if (made > 1) {
        this.readable = real.readable
        this.writable = real.writable
        return
      }
      const gate = new TransformStream<BufferSource, BufferSource>({
        async transform(chunk, controller) {
          await released
          controller.enqueue(chunk)
        },
      })
      gate.readable.pipeTo(real.writable).catch(() => {})
      this.writable = gate.writable
      this.readable = real.readable.pipeThrough(
        new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
          flush() {
            ended = true
          },
        }),
      )
    }
  }
  globalThis.DecompressionStream = Held as unknown as typeof DecompressionStream
  return { release: () => release(), made: () => made, ended: () => ended }
}

/** `check` at every sample for `ms`: SUSTAINED, so an open landing late over the page is seen. */
async function holds(check: () => void, ms = 300): Promise<void> {
  const started = performance.now()
  while (performance.now() - started < ms) {
    check()
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** What an open changes: the program and its encoding, the notice and the action it offers, the workspace. */
const page = () => ({
  program: view.state.doc.toString(),
  encoding: picker().value,
  notice: noticeText(),
  action: undoButton()?.textContent ?? null,
  workspace: workspaceName(),
})
/** The page as link B's open leaves it, its notice offering B's `undo`. */
const ON_B = {
  program: SUM_TO,
  encoding: 'binary',
  notice: 'opened a shared link',
  action: 'undo',
  workspace: 'Debugger ▾',
}
const onB = (): boolean => Object.entries(page()).every(([k, v]) => ON_B[k as keyof typeof ON_B] === v)

let view: EditorView

beforeAll(async () => {
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && readout() === 3, 'the first compile')
})

/**
 * EACH CASE STARTS ON `BEFORE`, UNDER `unary`, IN EXPLORER, whatever the case before it left — B's open, or link A's
 * where a case fails — so each fails for its own reason.
 */
beforeEach(async () => {
  if (view.state.doc.toString() !== BEFORE)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: BEFORE } })
  if (picker().value !== 'unary') await userEvent.selectOptions(picker(), 'unary')
  if (workspaceName() !== 'Explorer ▾') {
    document.querySelector<HTMLButtonElement>('#workspace')?.click()
    document.querySelector<HTMLButtonElement>('#workspace-menu [data-preset="explorer"]')?.click()
    document.querySelector<HTMLElement>('#workspace-menu')?.hidePopover()
  }
  await until(() => idle() && readout() === 3, 'the compile of the program the case starts on')
})

/**
 * THE REAL DECOMPRESSOR, AND NO FRAGMENT, AFTER EVERY CASE, whatever became of it. **HERE AND NOT IN THE CASE'S OWN
 * `finally`**: a case abandoned at the test timeout runs its `finally` whenever its wait ends, which can be in the
 * middle of the next case, putting the real decompressor back under that case's stand-in.
 */
afterEach(() => {
  globalThis.DecompressionStream = Real
  history.replaceState(null, '', `${location.pathname}${location.search}`)
})

describe('a link whose read ends after a later link has opened', () => {
  it.each(KINDS)('is dropped unsaid, where it would open %s', async (_, linkA) => {
    const [a, b] = [await linkA(), await encodeLink(LINK_B)]
    expect(view.state.doc.toString()).toBe(BEFORE)
    expect(workspaceName()).toBe('Explorer ▾')
    // THE REAL DECOMPRESSOR TOO, which the `afterEach` put back after the case before.
    expect(globalThis.DecompressionStream).toBe(Real)
    const hold = holdNextDecode()
    const dispatched = new Promise<void>((resolve) => addEventListener('hashchange', () => resolve(), { once: true }))
    location.hash = a
    await dispatched
    // A IS BEING READ, AND HELD THERE: its decompressor is the stand-in's first, and nothing has opened.
    expect(hold.made()).toBe(1)
    expect(view.state.doc.toString()).toBe(BEFORE)
    location.hash = b
    await until(onB, "B's open")
    // B OPENED WHILE A WAS STILL BEING READ: the two reads overlap, and only A's is left.
    expect(hold.made()).toBe(2)
    expect(hold.ended()).toBe(false)
    // A FRAGMENT B'S OPEN DID NOT LEAVE, so one cleared by A's would show. `replaceState` fires no `hashchange`.
    history.replaceState(null, '', `${location.pathname}${location.search}#kept`)
    hold.release()
    await until(hold.ended, "A's read to end")
    // READ SOON AFTER B'S OPEN, AND NEVER WAITING ON `NOTICE_MS`, at which B's notice and its `undo` go: a click on
    // that `undo` after the compile raced that clock on a slow runner, and the next case's start puts the page back.
    await holds(() => expect({ ...page(), fragment: location.hash }).toEqual({ ...ON_B, fragment: '#kept' }))
  })
})
