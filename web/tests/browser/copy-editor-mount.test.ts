import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { BUFFERS_STORAGE_KEY, parseBuffers } from '../../src/buffers-store'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

/**
 * A TM or asm view showing a copy has the copy's editor, or a way to it: one editor per copy, in one view (spec
 * amendments 28 and 33). A view that comes to show a copy whose editor is mounted nowhere mounts one — by a pick from
 * another leg, a split, `+ view`, or the view that held it closing or leaving while another shows the copy — and a
 * view showing a copy whose editor another view holds offers *move the editor here*, which moves that editor.
 *
 * Every gesture is a real one: `userEvent` clicks on the title, the `⋯` menu, the `+ view` menu and `✕`.
 *
 * ONE MOUNT FOR THE FILE, for the reason every sibling gives: `main()` runs once per page. Each test makes the copies
 * it needs from the program, so none depends on what the one before it left beyond the default views.
 */

const SAMPLE = 'let x = 40; x + 2'

let view: EditorView

const host = (leaf: string) => document.querySelector<HTMLElement>(`.pane[data-leaf="${leaf}"]`) as HTMLElement
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const editorOf = (pane: HTMLElement): EditorView | null => {
  const el = pane.querySelector<HTMLElement>('.term-editor')
  return el === null ? null : EditorView.findFromDOM(el)
}
const titleOf = (pane: HTMLElement) => pane.querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
/** The binding a view shows, as its title records it — `bindingKey(leg, session)`; empty for the source view. */
const shows = (pane: HTMLElement) => pane.querySelector<HTMLButtonElement>('button.view-title')?.dataset.binding ?? ''
/** Every view on the page showing `key`. */
const viewsOf = (key: string) => [...document.querySelectorAll<HTMLElement>('.pane')].filter((p) => shows(p) === key)
/** A copy's text of record, as stored. */
const stored = (id: string): string | null =>
  parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))?.buffers.find((b) => b.id === id)?.text ?? null
const menuOf = (button: HTMLButtonElement): HTMLElement => {
  const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
  if (menu === null) throw new Error('the button controls no menu')
  return menu
}
const moreOf = (pane: HTMLElement) => pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
/** `pane`'s `⋯` item of class `cls`, whether or not the menu is open; `null` when the menu does not offer it. */
const menuItem = (pane: HTMLElement, cls: string) =>
  moreOf(pane) === null ? null : menuOf(moreOf(pane)).querySelector<HTMLButtonElement>(`button.${cls}`)

/** Open `pane`'s `⋯` menu with the pointer and pick `cls`'s item with it, as a user does. */
async function pick(pane: HTMLElement, cls: string): Promise<void> {
  await userEvent.click(moreOf(pane))
  await until(() => menuOf(moreOf(pane)).matches(':popover-open'), 'the view menu to open')
  const item = menuOf(moreOf(pane)).querySelector<HTMLButtonElement>(`button.${cls}`)
  if (item === null) throw new Error(`the menu offers no ${cls}`)
  await userEvent.click(item)
}

/** Choose `key` in `pane`'s title menu with the pointer, as a user does. */
async function choose(pane: HTMLElement, key: string): Promise<void> {
  await userEvent.click(titleOf(pane))
  await until(() => menuOf(titleOf(pane)).matches(':popover-open'), 'the title menu to open')
  const item = menuOf(titleOf(pane)).querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
  if (item === null) throw new Error(`the title menu offers no ${key}`)
  await userEvent.click(item)
  await until(() => shows(pane) === key, `the view to show ${key}`)
}

/** The view a gesture made — the `.pane` that was not on the page before it. */
async function made(before: Set<HTMLElement>): Promise<HTMLElement> {
  const fresh = () => [...document.querySelectorAll<HTMLElement>('.pane')].find((e) => !before.has(e))
  await until(() => fresh() !== undefined, 'the new view')
  return fresh() as HTMLElement
}

/** Split `pane` onto `key` through its `⋯` menu with the pointer, and return the view the split made. */
async function split(pane: HTMLElement, key: string): Promise<HTMLElement> {
  const before = new Set([...document.querySelectorAll<HTMLElement>('.pane')])
  await userEvent.click(moreOf(pane))
  await until(() => menuOf(moreOf(pane)).matches(':popover-open'), 'the view menu to open')
  await userEvent.click(menuOf(moreOf(pane)).querySelector('button.view-split[data-dir="row"]') as HTMLButtonElement)
  const pair = () => menuOf(moreOf(pane)).querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
  await until(() => pair() !== null, 'the split’s pairs')
  await userEvent.click(pair() as HTMLButtonElement)
  return made(before)
}

/** Add a view onto `key` through `+ view` with the pointer, and return it. */
async function addView(key: string): Promise<HTMLElement> {
  const before = new Set([...document.querySelectorAll<HTMLElement>('.pane')])
  await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
  const item = () => document.querySelector<HTMLButtonElement>(`#new-view-menu button[data-binding="${key}"]`)
  await until(() => item() !== null, 'the + view menu')
  await userEvent.click(item() as HTMLButtonElement)
  return made(before)
}

/** Close `pane` with its `✕`. */
async function close(pane: HTMLElement): Promise<void> {
  await userEvent.click(pane.querySelector<HTMLButtonElement>('button.view-close') as HTMLButtonElement)
  await until(() => !pane.isConnected, 'the view to close')
}

/**
 * Make a copy on `leg` from `leaf`'s program and take `leaf` back to the program, so the copy is warm with its editor
 * mounted nowhere — asserted, since that is the state every test below starts from. Returns the copy's key.
 */
async function orphanCopy(leaf: string, leg: 'asm' | 'tm'): Promise<string> {
  const pane = host(leaf)
  if (shows(pane) !== bindingKey(leg, 'source')) await choose(pane, bindingKey(leg, 'source'))
  await pick(pane, 'detach')
  await until(() => editorOf(pane) !== null, 'the copy’s editor')
  const key = shows(pane)
  await choose(pane, bindingKey(leg, 'source'))
  expect(editorOf(pane), 'the view left its copy and its editor').toBeNull()
  expect(viewsOf(key), 'no view shows the copy').toEqual([])
  return key
}
const sessionOf = (key: string) => key.slice(key.indexOf(':') + 1)

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SAMPLE } })
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
  await until(() => host('asm-0').querySelectorAll('.asm-row').length === 5, 'the program’s listing')
  await until(() => host('tm-0').querySelectorAll('.state-row').length > 3, 'the program’s rules')
})

describe('a TM or asm view that comes to show a copy whose editor is mounted nowhere', () => {
  it('mounts one when a view on another leg is picked onto an asm copy', async () => {
    const key = await orphanCopy('asm-0', 'asm')
    const tm = host('tm-0')
    await choose(tm, key)
    expect(tm.dataset.kind).toBe('asm')
    await until(() => editorOf(tm) !== null, 'the copy’s editor in the view that changed leg')
    expect(editorOf(tm)?.state.doc.toString()).toBe(stored(sessionOf(key)))
    await choose(tm, bindingKey('tm', 'source'))
  })

  it('mounts one when a view on another leg is picked onto a TM copy', async () => {
    const key = await orphanCopy('tm-0', 'tm')
    const asm = host('asm-0')
    await choose(asm, key)
    expect(asm.dataset.kind).toBe('tm')
    await until(() => editorOf(asm) !== null, 'the copy’s editor in the view that changed leg')
    expect(editorOf(asm)?.state.doc.toString()).toBe(stored(sessionOf(key)))
    await choose(asm, bindingKey('asm', 'source'))
  })

  it('mounts one in a view split onto the copy', async () => {
    const key = await orphanCopy('asm-0', 'asm')
    const other = await split(host('asm-0'), key)
    await until(() => editorOf(other) !== null, 'the copy’s editor in the split')
    expect(editorOf(other)?.state.doc.toString()).toBe(stored(sessionOf(key)))
    await close(other)
  })

  it('mounts one in a view added onto the copy with + view', async () => {
    const key = await orphanCopy('tm-0', 'tm')
    const added = await addView(key)
    await until(() => editorOf(added) !== null, 'the copy’s editor in the added view')
    expect(editorOf(added)?.state.doc.toString()).toBe(stored(sessionOf(key)))
    await close(added)
  })

  it('mounts one in the view still showing the copy when the one holding it closes', async () => {
    const asm = host('asm-0')
    if (shows(asm) !== bindingKey('asm', 'source')) await choose(asm, bindingKey('asm', 'source'))
    // THE HOLDER IS A VIEW OF ITS OWN, so closing it leaves the default views as they were.
    const holder = await split(asm, bindingKey('asm', 'source'))
    await pick(holder, 'detach')
    await until(() => editorOf(holder) !== null, 'the copy’s editor')
    const key = shows(holder)
    const survivor = await split(holder, key)
    expect(editorOf(survivor), 'the split finds the editor held by the view it split from').toBeNull()

    await close(holder)
    await until(() => editorOf(survivor) !== null, 'the copy’s editor in the view still showing it')
    expect(editorOf(survivor)?.state.doc.toString()).toBe(stored(sessionOf(key)))
    await close(survivor)
  })

  it('mounts one in the view still showing the copy when the one holding it moves to the program', async () => {
    const key = await orphanCopy('tm-0', 'tm')
    const tm = host('tm-0')
    await choose(tm, key)
    await until(() => editorOf(tm) !== null, 'the copy’s editor')
    const survivor = await split(tm, key)
    expect(editorOf(survivor), 'the split finds the editor held by the view it split from').toBeNull()

    await choose(tm, bindingKey('tm', 'source'))
    await until(() => editorOf(survivor) !== null, 'the copy’s editor in the view still showing it')
    expect(editorOf(survivor)?.state.doc.toString()).toBe(stored(sessionOf(key)))
    await close(survivor)
  })
})

describe('a view an undone delete moves back onto its copy', () => {
  /**
   * **UNDO MOVES THE VIEWS BACK BEFORE THE COPY BUILDS, AND A COPY WHOSE TEXT DOES NOT BUILD NEVER DOES** — so an
   * editor that waited for the build never came. A jump to a label that names nothing is refused whole (spec
   * amendment 22), and the copy keeps its last run while its text of record is what was typed.
   */
  it('mounts the copy’s editor there, whether or not the copy builds', async () => {
    const asm = host('asm-0')
    if (shows(asm) !== bindingKey('asm', 'source')) await choose(asm, bindingKey('asm', 'source'))
    await pick(asm, 'detach')
    await until(() => editorOf(asm) !== null, 'the copy’s editor')
    const key = shows(asm)
    const broken = 'result Nat\n\n    jmp\tnowhere\n'
    const editor = editorOf(asm) as EditorView
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: broken } })
    const mark = () => asm.querySelector('.cm-editor .cm-lintRange-error')?.textContent ?? null
    await until(() => mark() === 'nowhere', 'the editor to mark the label that names nothing')

    await userEvent.click(document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement)
    const label = `delete asm copy ${sessionOf(key).slice('scratch-'.length)}`
    const del = () => document.querySelector<HTMLButtonElement>(`.buffer-list button[aria-label="${label}"]`)
    await until(() => del() !== null, 'the copies menu')
    await userEvent.click(del() as HTMLButtonElement)
    await until(() => shows(asm) === bindingKey('asm', 'source'), 'the view to move to the program')
    expect(editorOf(asm)).toBeNull()

    await userEvent.click(
      document.querySelector<HTMLButtonElement>('#notice button.notice-action') as HTMLButtonElement,
    )
    await until(() => shows(asm) === key, 'the view to show the copy again')
    await until(() => editorOf(asm)?.state.doc.toString() === broken, 'the restored copy’s editor')
    await until(() => mark() === 'nowhere', 'the restored editor to mark the label that names nothing')
  })
})

describe('a TM or asm view showing a copy whose editor another view holds', () => {
  it('offers move the editor here, which moves that editor, on asm', async () => {
    const asm = host('asm-0')
    if (shows(asm) !== bindingKey('asm', 'source')) await choose(asm, bindingKey('asm', 'source'))
    await pick(asm, 'detach')
    await until(() => editorOf(asm) !== null, 'the copy’s editor')
    const key = shows(asm)
    const editor = editorOf(asm)
    const other = await split(asm, key)
    expect(editorOf(other)).toBeNull()
    expect(menuItem(asm, 'claim-editor'), 'the view holding the editor offers no move').toBeNull()
    expect(menuItem(other, 'claim-editor'), 'the view without it offers the move').not.toBeNull()

    await pick(other, 'claim-editor')
    await until(() => editorOf(other) !== null, 'the editor in the view that asked for it')
    expect(editorOf(other), 'the same editor, moved').toBe(editor)
    expect(editorOf(asm)).toBeNull()
    expect(menuItem(asm, 'claim-editor'), 'the view that gave it up offers the move back').not.toBeNull()

    // IT STILL EDITS ITS COPY FROM THERE, the view showing the copy's value says what it built, and the outline beside
    // the editor lists what the server now says — opened first, so only the server's update can bring the label in.
    const outline = other.querySelector<HTMLElement>('.panel[data-panel="outline"]') as HTMLElement
    await userEvent.click(outline.querySelector<HTMLButtonElement>('.panel-toggle') as HTMLButtonElement)
    const listed = () => outline.querySelector('.outline')?.textContent ?? ''
    await until(() => listed() !== '', 'the outline to answer')
    expect(listed()).not.toContain('start')
    const moved = editorOf(other) as EditorView
    const text = 'result Nat\nstart:\nli rr, #3\nhalt\n'
    moved.dispatch({ changes: { from: 0, to: moved.state.doc.length, insert: text } })
    await until(() => other.querySelector('.asm-value')?.textContent === 'value: 3', 'the copy to rebuild')
    await until(() => listed().includes('start'), 'the outline of the view holding the editor to list the label')
    await close(other)
  })

  it('offers move the editor here on TM, and the view that gives it up keeps its copy’s value', async () => {
    const key = await orphanCopy('tm-0', 'tm')
    const tm = host('tm-0')
    await choose(tm, key)
    await until(() => editorOf(tm) !== null, 'the copy’s editor')
    const valueLine = (pane: HTMLElement) => pane.querySelector('.tm-value')?.textContent ?? ''
    await until(() => valueLine(tm).startsWith('value:'), 'the copy’s value')
    const value = valueLine(tm)
    const editor = editorOf(tm)
    const other = await split(tm, key)
    expect(menuItem(other, 'claim-editor')).not.toBeNull()

    await pick(other, 'claim-editor')
    await until(() => editorOf(other) !== null, 'the editor in the view that asked for it')
    expect(editorOf(other)).toBe(editor)
    expect(editorOf(tm)).toBeNull()
    expect(valueLine(tm), 'the view that gave the editor up still shows its copy’s value').toBe(value)
    expect(valueLine(other)).toBe(value)
    await close(other)
    await choose(tm, bindingKey('tm', 'source'))
  })
})
