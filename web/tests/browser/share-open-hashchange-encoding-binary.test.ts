import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { EXAMPLE_ENCODING } from '../../src/examples'
import { PROGRAM_STORAGE_KEY, parseProgram, serializeProgram } from '../../src/program-store'
import { decodeLink, encodeLink, type SharePayload } from '../../src/share-link'
import { defaultWorkspace, PRESETS, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A LINK PASTED INTO AN OPEN PAGE, WHOSE ENCODING THIS BUILD DOES NOT HAVE, WITH THE PAGE STARTED ON `binary`** —
 * Plan 7 part 6a spec §5.3 and §5.5: its program opens alone under the encoding the page is on. These are the pastes
 * of `ternary` links `share-open-hashchange-encoding.test.ts` makes, with the two encodings the other way round, and
 * this file holds the same of them: the program, the encoding and the compile that follows, the notice and its `undo`,
 * the fragment cleared, a later paste once the picker is set to `unary`, and one more once it is set back to `binary`
 * while storage refuses the program's write.
 *
 * **EACH PASTE OF A `ternary` LINK FAILS A FALLBACK TO A DIFFERENT WRONG ENCODING.** The first, onto the page as it
 * started on `binary`, fails the picker's first option, which is what `encodings()` lists first. The second, once
 * `unary` is chosen, fails the default (`EXAMPLE_ENCODING`), and fails the program storage opened on, `binary` still.
 * The third, once `binary` is chosen again with the program's write refused, fails the picker's first option, and
 * fails the last program stored, `unary` still. Each such case asserts the value it must differ from. The other half
 * says what the two values storage holds are, and why the write is refused. A SECOND FILE, BECAUSE A FILE MOUNTS ONCE,
 * for the reason every sibling gives.
 *
 * **THE OTHER HALF ALSO PASTES A LINK WHOSE ENCODING THIS BUILD HAS**, `binary`, onto its page on `unary`. A page on
 * `binary` cannot hold that one, and `share-open-hashchange.test.ts` holds the `unary` link on a page on `binary`.
 *
 * **THE `undo` OF A LINK WHOSE ENCODING THIS BUILD LACKS PUTS BACK AN ENCODING THE OPEN NEVER MOVED**, and no open in
 * this file moves it, so an `undo` that leaves the encoding where it is passes this file; the other half's link with
 * its own encoding fails it. An `undo` that puts back the picker's first option fails this file's third case, and one
 * that puts back the default fails the other half's.
 *
 * **WHAT A COMPILE POSTS IS READ WHERE IT LEAVES, AT `Worker.prototype.postMessage`**, and the links carry short
 * programs, each for the reason the other half gives.
 */

/** The program the page is on before the first paste. */
const PAGE = 'let x = 40; x + 2'
const LINKED = 'let y = 10; y + 5'
/** A program no paste before the one carrying it put in the editor. */
const OTHER = 'let z = 3; z + 4'
/** The link: `ternary`, which this build lacks, and the Debugger preset's workspace, which the page is not in. */
const LINK: SharePayload = {
  program: LINKED,
  encoding: 'ternary',
  workspace: serializeWorkspace({ ...defaultWorkspace(), switches: PRESETS.debugger }),
  positions: {},
}
const LEFT_OUT = "opened a shared link's program — its encoding, workspace and step positions were left out"

const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const readout = () => [...document.querySelectorAll('#results .segment, #results .row')].length
const workspaceName = () => document.querySelector('#workspace')?.textContent
/** The program storage holds: the last write that went through. */
const stored = () => parseProgram(localStorage.getItem(PROGRAM_STORAGE_KEY), ['unary', 'binary'])

/** Every compile the page has posted, in order: the text and the encoding of each `run` request. */
const runs: { src: string; encoding: string }[] = []
const post = Worker.prototype.postMessage
/** The compiles posted since `from` was `runs.length`, once one carrying `src` is among them. */
async function postedSince(from: number, src: string, what: string): Promise<{ src: string; encoding: string }[]> {
  await until(() => runs.slice(from).some((r) => r.src === src), what)
  return runs.slice(from)
}

let view: EditorView

beforeAll(async () => {
  Worker.prototype.postMessage = function (this: Worker, message: unknown, options?: unknown) {
    const m = message as { kind?: string; src?: string; encoding?: string } | null
    if (m?.kind === 'run') runs.push({ src: m.src ?? '', encoding: m.encoding ?? '' })
    ;(post as (this: Worker, m: unknown, o?: unknown) => void).call(this, message, options)
  }
  localStorage.setItem(PROGRAM_STORAGE_KEY, serializeProgram({ text: PAGE, encoding: 'binary' }))
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && readout() > 0, 'the first compile')
})

afterAll(() => {
  Worker.prototype.postMessage = post
})

describe('a link pasted into a page that started on binary, whose encoding this build does not have', () => {
  it('opens its program alone under the page’s encoding, compiles it under that, and clears the fragment', async () => {
    // WHAT THE PAGE'S ENCODING IS TOLD APART FROM: were `binary` the picker's first option, this case would hold nothing.
    expect(picker().options[0]?.value, 'precondition: binary is not the picker’s first option').not.toBe('binary')
    expect(picker().value, 'precondition: the page is on binary').toBe('binary')
    expect(workspaceName(), 'precondition: the page is in Explorer').toBe('Explorer ▾')
    expect(runs, 'precondition: the start-up compile is heard').toEqual([{ src: PAGE, encoding: 'binary' }])
    // THE ENCODING ALONE KEEPS IT FROM OPENING WHOLE: the same link under an encoding this build has opens whole.
    const known = [...picker().options].map((o) => o.value)
    const asKnown = await decodeLink(await encodeLink({ ...LINK, encoding: 'binary' }), known)
    expect(asKnown.kind, 'precondition: the link is whole but for its encoding').toBe('whole')
    const from = runs.length
    location.hash = await encodeLink(LINK)
    const posted = await postedSince(from, LINKED, 'the link’s compile')
    expect(view.state.doc.toString()).toBe(LINKED)
    // SOFT, SO AN ENCODING THAT IS NOT THE PAGE'S IS REPORTED IN EACH PLACE IT SHOWS, the picker and the post.
    expect.soft(picker().value).toBe('binary')
    expect.soft(posted).toEqual([{ src: LINKED, encoding: 'binary' }])
    expect(workspaceName()).toBe('Explorer ▾')
    expect(location.hash).toBe('')
  })

  it('names what was left out, with an undo', () => {
    expect(noticeText()).toBe(LEFT_OUT)
    expect(undoButton()?.textContent).toBe('undo')
  })

  it('puts back the program and its encoding on undo, and compiles them', async () => {
    const from = runs.length
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe(PAGE)
    // SOFT, SO AN UNDO THAT LEFT ANOTHER ENCODING IS REPORTED IN THE PICKER AND IN THE POST BELOW.
    expect.soft(picker().value).toBe('binary')
    expect(workspaceName()).toBe('Explorer ▾')
    expect(noticeText()).toBe('put back the program')
    expect(document.activeElement).toBe(view.contentDOM)
    expect(await postedSince(from, PAGE, 'the program’s compile')).toEqual([{ src: PAGE, encoding: 'binary' }])
  })

  /**
   * **THE PAGE'S ENCODING IS THE PICKER'S, NOT THE ONE STORAGE OPENED ON.** `unary` is chosen in the picker, and its
   * compile waited for; storage opened on `binary`, which the start-up compile posted and an open falling back as the
   * start-up open does would take.
   */
  it('opens a later link under the encoding chosen since start-up, not the one storage opened on', async () => {
    expect(EXAMPLE_ENCODING, 'precondition: unary is not the default encoding').not.toBe('unary')
    expect(runs[0]?.encoding, 'precondition: storage opened on another encoding than the one chosen').not.toBe('unary')
    expect(picker().value, 'precondition: the page is on binary').toBe('binary')
    expect(view.state.doc.toString(), 'precondition: the page is on its program').toBe(PAGE)
    let from = runs.length
    await userEvent.selectOptions(picker(), 'unary')
    expect(await postedSince(from, PAGE, 'the compile under unary')).toEqual([{ src: PAGE, encoding: 'unary' }])
    from = runs.length
    location.hash = await encodeLink(LINK)
    const posted = await postedSince(from, LINKED, 'the link’s compile')
    expect(view.state.doc.toString()).toBe(LINKED)
    // SOFT, FOR THE REASON THE FIRST CASE GIVES.
    expect.soft(picker().value).toBe('unary')
    expect.soft(posted).toEqual([{ src: LINKED, encoding: 'unary' }])
    expect(noticeText()).toBe(LEFT_OUT)
  })

  /**
   * **NOR THE LAST PROGRAM STORED**, which the case above left under `unary`. `binary` is chosen while storage refuses
   * the program's write, through the storage shim's own `setItem` as the other half does it, so the last program stored
   * stays under `unary` while the picker holds `binary`.
   */
  it('opens a link under the encoding chosen while the program’s write is refused, not the last one stored', async () => {
    expect(picker().options[0]?.value, 'precondition: binary is not the picker’s first option').not.toBe('binary')
    expect(picker().value, 'precondition: the page is on unary').toBe('unary')
    expect(stored(), 'precondition: the last program stored is under unary').toEqual({
      text: LINKED,
      encoding: 'unary',
    })
    let refused = 0
    const setItem = localStorage.setItem
    localStorage.setItem = (key: string, value: string) => {
      if (key !== PROGRAM_STORAGE_KEY) return setItem.call(localStorage, key, value)
      refused += 1
      throw new DOMException('full', 'QuotaExceededError')
    }
    try {
      let from = runs.length
      await userEvent.selectOptions(picker(), 'binary')
      expect(await postedSince(from, LINKED, 'the compile under binary')).toEqual([{ src: LINKED, encoding: 'binary' }])
      expect(refused, 'precondition: the write of that compile is refused').toBe(1)
      expect(stored(), 'precondition: the last program stored is still under unary').toEqual({
        text: LINKED,
        encoding: 'unary',
      })
      from = runs.length
      location.hash = await encodeLink({ ...LINK, program: OTHER })
      const posted = await postedSince(from, OTHER, 'the link’s compile')
      expect(view.state.doc.toString()).toBe(OTHER)
      // SOFT, FOR THE REASON THE FIRST CASE GIVES.
      expect.soft(picker().value).toBe('binary')
      expect.soft(posted).toEqual([{ src: OTHER, encoding: 'binary' }])
      expect(noticeText()).toBe(LEFT_OUT)
    } finally {
      localStorage.setItem = setItem
    }
  })
})
