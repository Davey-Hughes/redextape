import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { BUFFERS_STORAGE_KEY, parseBuffers } from '../../src/buffers-store'
import { EDITOR_DEBOUNCE_MS } from '../../src/editor-debounce'
import type { Leg } from '../../src/protocol'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

/**
 * Typing a view has not yet sent when it leaves its copy goes to that copy, on every leg and by every route that
 * leaves one: a pick through the view's title, a change to another leg, and a delete undone.
 *
 * **THE WINDOW IS THE EDITOR'S DEBOUNCE** (`EDITOR_DEBOUNCE_MS`): a keystroke reaches its copy only when the debounce
 * fires, so a view that leaves its copy inside that window is leaving with typing no copy has seen. Each case that
 * leaves measures the gap from its last keystroke to the click that leaves, as the page saw both, and asserts it is
 * inside the window, since a click that landed after the debounce fired would pass whether or not anything is wrong.
 * The debounce starts at the keystroke and its timer cannot run inside the click's handler, so the two events' own
 * times are the whole of what decides the race — not how long the handler or the test's own round trips take.
 *
 * **THE WINDOW IS 3 S IN THIS FILE, WHERE THE APP SHIPS 300 MS.** `vi.mock` below replaces the one-constant module
 * `lambda-pane.ts` and `copy-editor.ts` take the debounce from, and this file's own import reads the replacement. The
 * gap is not a test's to bound: it holds the keyboard's reply and the whole of the click's round trip, the checks
 * Playwright makes before it presses among them, and a machine short of CPU stretches each. Measured 2026-10-02 under
 * `CPUQuota=25%`, 4 of 20 gaps were over 300 ms and the longest was 1,012 ms; the CI run that failed here measured
 * 309.8 ms. A press sent straight to the browser, with the pointer already on its target, still left 2 of 20 over, so
 * it is the window that is widened and not the gap that is narrowed. The asm and TM cases take no longer for it, their
 * typing being sent as the view leaves; the λ case's reaches its copy when the debounce fires, so that case and the
 * last one each wait the window out.
 *
 * **THE LAST CASE IS WHAT MAKES THAT WINDOW THE APP'S AND NOT ONLY THIS FILE'S.** Were the replacement to reach this
 * file's import and miss an editor's, every gap above would be held to 3 s while the debounce fired at 300 ms, and
 * pass. So it types into a λ copy and an asm copy, leaves neither, and holds each copy's text of record to changing no
 * sooner than the window after its key — a bound a slow machine can only help.
 *
 * Every gesture is a real one — `userEvent` keys into the editor, `userEvent` clicks on the title, the menus and the
 * notice — because the time between them is what the tests are about. **THE MENU THAT LEAVES IS OPENED BEFORE THE
 * TYPING**, so the one gesture after the last key is the click that leaves: opened after it, the round trips of the
 * click that opens it and the wait for it to open sat inside the window, and on a machine at a quarter of its speed
 * they alone outlasted it.
 *
 * ONE MOUNT FOR THE FILE, for the reason every sibling gives: `main()` runs once per page.
 */

vi.mock('../../src/editor-debounce', () => ({ EDITOR_DEBOUNCE_MS: 3000 }))

const SAMPLE = 'let x = 40; x + 2'

let view: EditorView

const host = (leaf: string) => document.querySelector<HTMLElement>(`.pane[data-leaf="${leaf}"]`) as HTMLElement
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const editorOf = (pane: HTMLElement): EditorView | null => {
  const el = pane.querySelector<HTMLElement>('.term-editor')
  return el === null ? null : EditorView.findFromDOM(el)
}
const titleOf = (pane: HTMLElement) => pane.querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
/** The binding a view shows, as its title records it — `bindingKey(leg, session)`. */
const shows = (pane: HTMLElement) => titleOf(pane).dataset.binding ?? ''
/** A copy's text of record, as stored — what a reload, a resume and an undo rebuild it from. */
const stored = (id: string): string | null =>
  parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))?.buffers.find((b) => b.id === id)?.text ?? null
const menuOf = (button: HTMLButtonElement): HTMLElement => {
  const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
  if (menu === null) throw new Error('the button controls no menu')
  return menu
}
const moreOf = (pane: HTMLElement) => pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement

/** Open `pane`'s `⋯` menu with the pointer and pick `cls`'s item with it, as a user does. */
async function pick(pane: HTMLElement, cls: string): Promise<void> {
  await userEvent.click(moreOf(pane))
  await until(() => menuOf(moreOf(pane)).matches(':popover-open'), 'the view menu to open')
  const item = menuOf(moreOf(pane)).querySelector<HTMLButtonElement>(`button.${cls}`)
  if (item === null) throw new Error(`the menu offers no ${cls}`)
  await userEvent.click(item)
}

/** Open `pane`'s title menu with the pointer and return its item for `key`, not yet clicked. */
async function titleItem(pane: HTMLElement, key: string): Promise<HTMLButtonElement> {
  await userEvent.click(titleOf(pane))
  await until(() => menuOf(titleOf(pane)).matches(':popover-open'), 'the title menu to open')
  const item = menuOf(titleOf(pane)).querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
  if (item === null) throw new Error(`the title menu offers no ${key}`)
  return item
}

/** Choose `key` in `pane`'s title menu with the pointer, as a user does. */
async function choose(pane: HTMLElement, key: string): Promise<void> {
  await userEvent.click(await titleItem(pane, key))
}

/** Open the copies menu with the pointer and return its item named `label`, not yet clicked. */
async function copiesItem(label: string): Promise<HTMLButtonElement> {
  await userEvent.click(document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement)
  const item = () => document.querySelector<HTMLButtonElement>(`.buffer-list button[aria-label="${label}"]`)
  await until(() => item() !== null, 'the copies menu')
  return item() as HTMLButtonElement
}

/** Split `pane` onto `leg`'s program through its menu with the pointer, and return the view the split made. */
async function splitToProgram(pane: HTMLElement, leg: Leg): Promise<HTMLElement> {
  const before = new Set([...document.querySelectorAll<HTMLElement>('.pane')])
  await userEvent.click(moreOf(pane))
  await until(() => menuOf(moreOf(pane)).matches(':popover-open'), 'the view menu to open')
  await userEvent.click(menuOf(moreOf(pane)).querySelector('button.view-split[data-dir="row"]') as HTMLButtonElement)
  const pair = () => menuOf(moreOf(pane)).querySelector<HTMLButtonElement>(`button[data-binding="${leg}:source"]`)
  await until(() => pair() !== null, 'the split’s pairs')
  await userEvent.click(pair() as HTMLButtonElement)
  const made = () => [...document.querySelectorAll<HTMLElement>('.pane')].find((e) => !before.has(e))
  await until(() => made() !== undefined, 'the split view')
  return made() as HTMLElement
}

/** Make a copy from `pane`'s program with *edit a copy*, and return its session once its editor has mounted. */
async function fork(pane: HTMLElement): Promise<string> {
  await pick(pane, 'detach')
  await until(() => editorOf(pane) !== null, 'the copy’s editor')
  const key = shows(pane)
  return key.slice(key.indexOf(':') + 1)
}

/** A view holding the editor of one of `leg`'s copies: one that already does, else `pane` after *edit a copy* there. */
async function editing(leg: Leg, pane: HTMLElement): Promise<HTMLElement> {
  const holder = [...document.querySelectorAll<HTMLElement>('.pane:has(button.view-title)')].find(
    (p) => shows(p).startsWith(`${leg}:`) && editorOf(p) !== null,
  )
  if (holder !== undefined) return holder
  await fork(pane)
  return pane
}

/** When the page last saw a key go down, and a click land — recorded in the capture phase, before any handler. */
let lastKey = 0
let lastClick = 0

/** Put the caret in `editor` — at the end, or over the whole text — and type `keys` there with the keyboard. */
async function typeInto(editor: EditorView, keys: string, over: 'end' | 'all'): Promise<void> {
  editor.dispatch({
    selection: over === 'end' ? { anchor: editor.state.doc.length } : { anchor: 0, head: editor.state.doc.length },
  })
  editor.focus()
  await until(() => editor.hasFocus, 'the copy’s editor to take the focus')
  await userEvent.keyboard(keys)
}

/** Assert that the last click landed after the last keystroke and inside the debounce that keystroke opened. */
function insideTheDebounce(): void {
  expect(lastClick, 'the click that leaves comes after the typing').toBeGreaterThan(lastKey)
  expect(lastClick - lastKey, 'the view must leave before the debounce fires, or nothing is tested').toBeLessThan(
    EDITOR_DEBOUNCE_MS,
  )
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  document.addEventListener('keydown', () => (lastKey = performance.now()), true)
  document.addEventListener('click', () => (lastClick = performance.now()), true)
  view = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SAMPLE } })
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
  await until(() => host('asm-0').querySelectorAll('.asm-row').length === 5, 'the program’s listing')
  await until(() => host('tm-0').querySelectorAll('.state-row').length > 3, 'the program’s rules')
})

describe('typing not yet sent when a view leaves its copy', () => {
  it('on λ, goes to the copy it was typed into, not to the copy the view moves to', async () => {
    const a = await fork(host('lambda-0'))
    const second = await splitToProgram(host('lambda-0'), 'lambda')
    const b = await fork(second)
    await until(() => stored(a) !== null && stored(b) !== null, 'both copies to be stored')
    const aBefore = stored(a)
    const bBefore = stored(b)
    const bEditor = (editorOf(second) as EditorView).state.doc.toString()
    expect(bBefore, 'the two copies must differ for a misroute to show').not.toBe('λp. p p')

    const pickB = await titleItem(host('lambda-0'), bindingKey('lambda', b))
    await typeInto(editorOf(host('lambda-0')) as EditorView, '\\p. p p', 'all')
    await userEvent.click(pickB)
    insideTheDebounce()
    expect(shows(host('lambda-0'))).toBe(bindingKey('lambda', b))

    await until(() => stored(a) !== aBefore || stored(b) !== bBefore, 'the typing to reach a copy')
    expect(stored(b), 'the copy the view moved to').toBe(bBefore)
    expect(editorOf(second)?.state.doc.toString(), 'the editor of the copy the view moved to').toBe(bEditor)
    await until(() => stored(a) === 'λp. p p', 'the typing to reach the copy it was typed into')
  })

  it('on asm, reaches the copy when the view moves to the program through its title', async () => {
    const asm = host('asm-0')
    const copy = await fork(asm)
    await until(() => stored(copy) !== null, 'the copy to be stored')
    const text = 'result Nat\nli rr, #5\nhalt\n'
    expect(stored(copy)).not.toBe(text)

    const toProgram = await titleItem(asm, bindingKey('asm', 'source'))
    await typeInto(editorOf(asm) as EditorView, 'result Nat{Enter}li rr, #5{Enter}halt{Enter}', 'all')
    expect(editorOf(asm)?.state.doc.toString()).toBe(text)
    await userEvent.click(toProgram)
    insideTheDebounce()
    expect(shows(asm)).toBe(bindingKey('asm', 'source'))

    await until(() => stored(copy) === text, 'the typing to reach the copy’s text of record')
    await choose(asm, bindingKey('asm', copy))
    await until(() => editorOf(asm)?.state.doc.toString() === text, 'the copy’s editor, holding what was typed')
  })

  it('on asm, comes back through undo when the copy is deleted before it was sent', async () => {
    const asm = host('asm-0')
    // A COPY OF ITS OWN, from the program — so this test starts where it says whatever the one above left.
    if (shows(asm) !== bindingKey('asm', 'source')) await choose(asm, bindingKey('asm', 'source'))
    const copy = await fork(asm)
    const text = 'result Nat\nli rr, #6\nhalt\n'

    // A COPY IS NAMED BY THE COUNTER ITS ID CARRIES: `scratch-3` is `copy 3`.
    const del = await copiesItem(`delete asm copy ${copy.slice('scratch-'.length)}`)
    await typeInto(editorOf(asm) as EditorView, 'result Nat{Enter}li rr, #6{Enter}halt{Enter}', 'all')
    await userEvent.click(del)
    insideTheDebounce()
    await until(() => shows(asm) === bindingKey('asm', 'source'), 'the view to move to the program')

    await userEvent.click(
      document.querySelector<HTMLButtonElement>('#notice button.notice-action') as HTMLButtonElement,
    )
    await until(() => shows(asm) === bindingKey('asm', copy), 'the view to show the copy again')
    await until(
      () => editorOf(asm)?.state.doc.toString() === text,
      'the restored copy’s editor, holding what was typed',
    )
    expect(stored(copy)).toBe(text)
  })

  it('on asm, is stored with the copy when it is paused before it was sent', async () => {
    const asm = host('asm-0')
    if (shows(asm) !== bindingKey('asm', 'source')) await choose(asm, bindingKey('asm', 'source'))
    const copy = await fork(asm)
    const text = 'result Nat\nli rr, #7\nhalt\n'

    const pause = await copiesItem(`pause asm copy ${copy.slice('scratch-'.length)}`)
    await typeInto(editorOf(asm) as EditorView, 'result Nat{Enter}li rr, #7{Enter}halt{Enter}', 'all')
    await userEvent.click(pause)
    insideTheDebounce()
    await until(() => shows(asm) === bindingKey('asm', 'source'), 'the view to move to the program')
    // STORED BY THE PAUSE ITSELF: a paused copy has no worker, so no build will land to store it later.
    expect(stored(copy)).toBe(text)
    document.querySelector<HTMLElement>('.buffer-list')?.hidePopover()
  })

  it('on TM, reaches the copy when the view changes to another leg', async () => {
    const tm = host('tm-0')
    const copy = await fork(tm)
    await until(() => stored(copy) !== null, 'the copy to be stored')
    // THE COPY'S VALUE RUN FINISHED FIRST, so no reading lands on the page between the keystroke and the click.
    await until(() => (tm.querySelector('.tm-value')?.textContent ?? '').startsWith('value:'), 'the copy’s value')
    const before = stored(copy)

    const toLambda = await titleItem(tm, bindingKey('lambda', 'source'))
    // ONE KEY, A COMMENT ON THE LAST LINE: the machine's text is long, and each key is a reparse on the page.
    await typeInto(editorOf(tm) as EditorView, ';', 'end')
    const text = (editorOf(tm) as EditorView).state.doc.toString()
    expect(text).not.toBe(before)
    await userEvent.click(toLambda)
    insideTheDebounce()
    expect(tm.dataset.kind).toBe('lambda')

    await until(() => stored(copy) === text, 'the typing to reach the copy’s text of record')
  })

  it('is sent no sooner than this file’s window after its key, in a λ copy’s editor and an asm copy’s', async () => {
    // THE MOCK'S OWN NUMBER, so a file that lost its `vi.mock` fails here rather than passing at 300 ms again.
    expect(EDITOR_DEBOUNCE_MS, 'the window `vi.mock` sets for this file').toBe(3000)
    // WHICHEVER VIEWS HOLD AN EDITOR ALREADY, so this case asks nothing of the ones above and runs alone as well.
    const lam = await editing('lambda', host('lambda-0'))
    const asm = await editing('asm', host('asm-0'))
    const lamCopy = shows(lam).slice('lambda:'.length)
    const asmCopy = shows(asm).slice('asm:'.length)
    await until(() => stored(lamCopy) !== null && stored(asmCopy) !== null, 'both copies to be stored')
    const lamBefore = stored(lamCopy)
    const asmBefore = stored(asmCopy)

    const started = performance.now()
    await typeInto(editorOf(lam) as EditorView, '\\q. q', 'all')
    const lamKey = lastKey
    await typeInto(editorOf(asm) as EditorView, '{Enter}', 'end')
    const asmKey = lastKey
    expect(lamKey, 'the page saw the λ copy’s key').toBeGreaterThan(started)
    expect(asmKey, 'the page saw the asm copy’s key').toBeGreaterThan(lamKey)

    // NEITHER VIEW LEAVES, so the debounce alone sends each copy its typing, and a copy's text of record changes after.
    let lamSeen = 0
    let asmSeen = 0
    await until(() => {
      if (lamSeen === 0 && stored(lamCopy) !== lamBefore) lamSeen = performance.now()
      if (asmSeen === 0 && stored(asmCopy) !== asmBefore) asmSeen = performance.now()
      return lamSeen !== 0 && asmSeen !== 0
    }, 'both copies to be sent their typing')
    expect(lamSeen - lamKey, 'a λ copy’s editor waits the window this file sets').toBeGreaterThanOrEqual(
      EDITOR_DEBOUNCE_MS,
    )
    expect(asmSeen - asmKey, 'an asm copy’s editor waits the window this file sets').toBeGreaterThanOrEqual(
      EDITOR_DEBOUNCE_MS,
    )
  })
})
