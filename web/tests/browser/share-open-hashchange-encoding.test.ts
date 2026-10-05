import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { EXAMPLE_ENCODING } from '../../src/examples'
import { PROGRAM_STORAGE_KEY, parseProgram, serializeProgram } from '../../src/program-store'
import { decodeLink, encodeLink, type SharePayload } from '../../src/share-link'
import { defaultWorkspace, PRESETS, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A LINK PASTED INTO AN OPEN PAGE, WHOSE ENCODING THIS BUILD DOES NOT HAVE** — Plan 7 part 6a spec §5.3 and §5.5,
 * heard as `hashchange`. The link carries `ternary`, with a workspace and positions `decodeLink` takes, so the encoding
 * alone is why its program opens alone: under the encoding the page is on, the page's workspace kept, and the compile
 * that follows posts under the page's encoding. The notice names what was left out, its `undo` puts back the program
 * and the encoding, and the fragment is cleared. Later the picker is set to the other encoding and the link pasted
 * again, and then set back while storage refuses the program's write and a link pasted once more: each opens under the
 * encoding the picker holds. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 *
 * **EACH PASTE OF A `ternary` LINK FAILS A FALLBACK TO A DIFFERENT WRONG ENCODING**, since with two encodings the page's
 * encoding differs from one wrong value and equals the other. The first, onto the page as it started on `unary`, fails
 * the default (`EXAMPLE_ENCODING`). The second, once `binary` is chosen, fails the picker's first option, and fails the
 * program storage opened on (`storedProgram` in `main.ts`, which the start-up open falls back to), `unary` still. The
 * third, once `unary` is chosen again with the program's write refused, fails the default, and fails the last program
 * stored (`restorable`), `binary` still: `restorable` is written as each compile is posted, so while writes go through
 * it holds whatever the picker was last set to once that compile has been posted. Each such case asserts the value it
 * must differ from. `share-open-hashchange-encoding-binary.test.ts` is the same with the two encodings the other way
 * round. At start-up the encoding is storage's: `share-open-alone.test.ts` and `share-open-alone-binary.test.ts` hold
 * that.
 *
 * **ONE CASE PASTES A LINK WHOSE ENCODING THIS BUILD HAS**, `binary`, with a workspace it cannot read: its program opens
 * alone under its own encoding. It is the other half of `share-open-hashchange.test.ts`'s case, a `unary` link onto a
 * page on `binary`, which an open taking the picker's first option passes; this one fails that, and fails an open that
 * took the page's encoding in place of the link's. It is here and not in the other half because the other half's page
 * is on `binary`, the encoding this link carries.
 *
 * **THE `undo` OF A LINK WHOSE ENCODING THIS BUILD LACKS PUTS BACK AN ENCODING THE OPEN NEVER MOVED**, so an `undo` that
 * leaves the encoding where it is passes the third case, and fails the case of a link with its own encoding, whose
 * open moves the picker. An `undo` that puts back a wrong encoding of its own fails one file's third case: the default
 * fails this file's, and the picker's first option the other half's. A case that fails leaves the page elsewhere, so
 * the cases after it then fail their preconditions.
 *
 * **WHAT A COMPILE POSTS IS READ WHERE IT LEAVES, AT `Worker.prototype.postMessage`**, as `keystrokes-in-flight.test.ts`
 * reads it: the `run` request names the text and the encoding the worker compiles under, which is the property. The
 * picker is held too, but it is what the compile reads, not what it posted. The readout prints each leg's value
 * decoded, the same under either encoding, and tells the two apart only by the TM leg's transitions and tape width,
 * figures the compiler's output decides.
 *
 * **THE LINKS CARRY SHORT PROGRAMS, NOT EXAMPLES**, for the reason `share-open-hashchange.test.ts` gives.
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
  localStorage.setItem(PROGRAM_STORAGE_KEY, serializeProgram({ text: PAGE, encoding: 'unary' }))
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && readout() > 0, 'the first compile')
})

afterAll(() => {
  Worker.prototype.postMessage = post
})

describe('a link pasted into a page that started on unary, whose encoding this build does not have', () => {
  it('opens its program alone under the page’s encoding, compiles it under that, and clears the fragment', async () => {
    // WHAT THE PAGE'S ENCODING IS TOLD APART FROM: were `unary` the default encoding, this case would hold nothing.
    expect(EXAMPLE_ENCODING, 'precondition: unary is not the default encoding').not.toBe('unary')
    expect(picker().value, 'precondition: the page is on unary').toBe('unary')
    expect(workspaceName(), 'precondition: the page is in Explorer').toBe('Explorer ▾')
    expect(runs, 'precondition: the start-up compile is heard').toEqual([{ src: PAGE, encoding: 'unary' }])
    // THE ENCODING ALONE KEEPS IT FROM OPENING WHOLE: the same link under an encoding this build has opens whole.
    const known = [...picker().options].map((o) => o.value)
    const asKnown = await decodeLink(await encodeLink({ ...LINK, encoding: 'unary' }), known)
    expect(asKnown.kind, 'precondition: the link is whole but for its encoding').toBe('whole')
    const from = runs.length
    location.hash = await encodeLink(LINK)
    const posted = await postedSince(from, LINKED, 'the link’s compile')
    expect(view.state.doc.toString()).toBe(LINKED)
    // SOFT, SO AN ENCODING THAT IS NOT THE PAGE'S IS REPORTED IN EACH PLACE IT SHOWS, the picker and the post.
    expect.soft(picker().value).toBe('unary')
    expect.soft(posted).toEqual([{ src: LINKED, encoding: 'unary' }])
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
    expect.soft(picker().value).toBe('unary')
    expect(workspaceName()).toBe('Explorer ▾')
    expect(noticeText()).toBe('put back the program')
    expect(document.activeElement).toBe(view.contentDOM)
    expect(await postedSince(from, PAGE, 'the program’s compile')).toEqual([{ src: PAGE, encoding: 'unary' }])
  })

  /**
   * **A LINK WHOSE ENCODING THIS BUILD HAS, AND WHOSE WORKSPACE IT CANNOT READ, OPENS UNDER ITS OWN ENCODING**, `binary`
   * onto a page on `unary`, which the top of the file has why. Its `undo` moves the picker back, and leaves the page as
   * the cases below start from.
   */
  it('opens a link whose workspace cannot be read under its own encoding, and undo puts back the page’s', async () => {
    expect(picker().options[0]?.value, 'precondition: binary is not the picker’s first option').not.toBe('binary')
    expect(picker().value, 'precondition: the page is on unary').toBe('unary')
    expect(view.state.doc.toString(), 'precondition: the page is on its program').toBe(PAGE)
    let from = runs.length
    location.hash = await encodeLink({ ...LINK, program: OTHER, encoding: 'binary', workspace: 'not a workspace' })
    const posted = await postedSince(from, OTHER, 'the link’s compile')
    expect(view.state.doc.toString()).toBe(OTHER)
    // SOFT, FOR THE REASON THE FIRST CASE GIVES.
    expect.soft(picker().value).toBe('binary')
    expect.soft(posted).toEqual([{ src: OTHER, encoding: 'binary' }])
    expect(workspaceName()).toBe('Explorer ▾')
    expect(noticeText()).toBe("opened a shared link's program — its workspace and step positions were left out")
    from = runs.length
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe(PAGE)
    expect.soft(picker().value).toBe('unary')
    expect(noticeText()).toBe('put back the program')
    expect(await postedSince(from, PAGE, 'the program’s compile')).toEqual([{ src: PAGE, encoding: 'unary' }])
  })

  /**
   * **THE PAGE'S ENCODING IS THE PICKER'S, NOT THE ONE STORAGE OPENED ON.** `binary` is chosen in the picker, and its
   * compile waited for; storage opened on `unary`, which the start-up compile posted and an open falling back as the
   * start-up open does would take.
   */
  it('opens a later link under the encoding chosen since start-up, not the one storage opened on', async () => {
    expect(picker().options[0]?.value, 'precondition: binary is not the picker’s first option').not.toBe('binary')
    expect(runs[0]?.encoding, 'precondition: storage opened on another encoding than the one chosen').not.toBe('binary')
    expect(picker().value, 'precondition: the page is on unary').toBe('unary')
    expect(view.state.doc.toString(), 'precondition: the page is on its program').toBe(PAGE)
    let from = runs.length
    await userEvent.selectOptions(picker(), 'binary')
    expect(await postedSince(from, PAGE, 'the compile under binary')).toEqual([{ src: PAGE, encoding: 'binary' }])
    from = runs.length
    location.hash = await encodeLink(LINK)
    const posted = await postedSince(from, LINKED, 'the link’s compile')
    expect(view.state.doc.toString()).toBe(LINKED)
    // SOFT, FOR THE REASON THE FIRST CASE GIVES.
    expect.soft(picker().value).toBe('binary')
    expect.soft(posted).toEqual([{ src: LINKED, encoding: 'binary' }])
    expect(noticeText()).toBe(LEFT_OUT)
  })

  /**
   * **NOR THE LAST PROGRAM STORED**, which the case above left under `binary`. `unary` is chosen while storage refuses
   * the program's write, so the last program stored stays under `binary` while the picker holds `unary`. The refusal is
   * the storage shim's own `setItem`, which is what the app calls: `setup.ts` puts a plain object in `localStorage`'s
   * place, so a `Storage.prototype` patch would not reach it. Only the program's key is refused, and the shim's
   * `setItem` is put back before the case ends.
   */
  it('opens a link under the encoding chosen while the program’s write is refused, not the last one stored', async () => {
    expect(EXAMPLE_ENCODING, 'precondition: unary is not the default encoding').not.toBe('unary')
    expect(picker().value, 'precondition: the page is on binary').toBe('binary')
    expect(stored(), 'precondition: the last program stored is under binary').toEqual({
      text: LINKED,
      encoding: 'binary',
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
      await userEvent.selectOptions(picker(), 'unary')
      expect(await postedSince(from, LINKED, 'the compile under unary')).toEqual([{ src: LINKED, encoding: 'unary' }])
      expect(refused, 'precondition: the write of that compile is refused').toBe(1)
      expect(stored(), 'precondition: the last program stored is still under binary').toEqual({
        text: LINKED,
        encoding: 'binary',
      })
      from = runs.length
      location.hash = await encodeLink({ ...LINK, program: OTHER })
      const posted = await postedSince(from, OTHER, 'the link’s compile')
      expect(view.state.doc.toString()).toBe(OTHER)
      // SOFT, FOR THE REASON THE FIRST CASE GIVES.
      expect.soft(picker().value).toBe('unary')
      expect.soft(posted).toEqual([{ src: OTHER, encoding: 'unary' }])
      expect(noticeText()).toBe(LEFT_OUT)
    } finally {
      localStorage.setItem = setItem
    }
  })
})
