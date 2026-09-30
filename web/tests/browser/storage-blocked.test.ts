import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * **THE APP WHERE THIS SITE'S DATA IS BLOCKED** — Chrome with site data blocked, and the privacy modes that
 * refuse storage the same way.
 *
 * **THERE, READING `window.localStorage` ITSELF THROWS**, before any `getItem` or `setItem` is reached. A
 * store whose METHODS throw is the case the app's guards were written against, and a `try` around
 * `store.getItem(...)` covers it. It does not cover the getter unless the getter is read inside the same
 * `try`: `editor-prefs.ts` took its store as a default parameter, `store: Storage = localStorage`, and a
 * default parameter is evaluated at the call, before the function body and its `try` begin. So `main()`
 * rejected at its first preference read and the page never started.
 *
 * **THE GETTERS ARE REPLACED AT MODULE SCOPE, BEFORE THE ONE MOUNT.** `setup.ts` installs this file's own
 * `Storage` as a plain value with `configurable: true`, which is what lets a getter take its place here.
 * `sessionStorage` throws too, as it does in the browser this imitates: nothing in the app reads it today,
 * and one that did would meet the same refusal.
 *
 * **EVERY SETTING BELOW CHECKS THAT ITS CHOICE REACHED THE GETTER.** A control that stopped writing its
 * choice at all would pass "nothing threw" without ever meeting the refusal, so each of those cases asserts
 * that `reached` grew. The copy's case needs no count: the report it waits for is the refusal, said.
 */
let reached = 0
const refuse = (): never => {
  reached += 1
  throw new DOMException('Access is denied for this document.', 'SecurityError')
}
Object.defineProperty(window, 'localStorage', { get: refuse, configurable: true })
Object.defineProperty(window, 'sessionStorage', { get: refuse, configurable: true })

/**
 * Every exception the page reported, from before the mount on. A throw inside an event listener does not
 * reach the code that dispatched the event; it reaches the window's `error` event, and only there can a
 * test see it. Emptied after each case, so a case fails for its own gesture and not for an earlier one's.
 */
const errors: string[] = []
window.addEventListener('error', (e) => errors.push(String(e.message)))
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)))
afterEach(() => {
  errors.length = 0
})

/** The formatter rewrites this, which is how a blur that formatted can be told from one that did not. */
const UNFORMATTED = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(3)\n'

let view: EditorView

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`no #${id} in the page`)
  return el as T
}
const resultsText = (): string => document.querySelector('#results')?.textContent ?? ''
const idle = (): boolean => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const text = (): string => view.state.doc.toString()
/** `@replit/codemirror-vim` marks the scroller while vim is installed and in normal mode. */
const inNormalMode = (v: EditorView): boolean => v.scrollDOM.classList.contains('cm-vimMode')

/** Open the settings menu with the pointer, if it is not open already. */
async function openSettings(): Promise<void> {
  if (byId('settings-menu').matches(':popover-open')) return
  await userEvent.click(byId('settings'))
  await until(() => byId('settings-menu').matches(':popover-open'), 'the settings menu to open')
}

/** Close the settings menu with `Esc`, as a user would before reaching past it. */
async function closeSettings(): Promise<void> {
  if (!byId('settings-menu').matches(':popover-open')) return
  await userEvent.keyboard('{Escape}')
  await until(() => !byId('settings-menu').matches(':popover-open'), 'the settings menu to close')
}

beforeAll(async () => {
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && resultsText() !== '', 'the first compile')
})

describe('with site data blocked', () => {
  it('starts, reads storage on the way, and compiles its program', () => {
    expect(reached, 'precondition: start-up never touched storage, so it never met the refusal').toBeGreaterThan(0)
    expect(resultsText()).toContain('reductions')
    expect(resultsText()).toContain('42')
    const strip = byId('results').getBoundingClientRect()
    expect(strip.width, 'the result strip is not on screen').toBeGreaterThan(0)
    expect(strip.height, 'the result strip is not on screen').toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  it('accepts an edit typed with real keys, and compiles it', async () => {
    view.focus()
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    await until(() => view.hasFocus, 'the source editor to take focus')
    await userEvent.keyboard(' + 1')
    expect(text()).toBe('let x = 40; x + 2 + 1')
    await until(() => idle() && resultsText().includes('43'), 'the edited program to compile')
    expect(errors).toEqual([])
  })

  it('lets the keymap be changed, and every editor follows it', async () => {
    await openSettings()
    const keymap = byId<HTMLSelectElement>('keymap')
    expect(keymap.value, 'precondition: a first visit starts on the default keymap').toBe('default')
    const before = reached
    await userEvent.selectOptions(keymap, 'vim')
    expect(reached, 'the choice never tried to reach storage').toBeGreaterThan(before)
    expect(inNormalMode(view), 'the source editor did not take vim').toBe(true)
    await userEvent.selectOptions(keymap, 'default')
    expect(inNormalMode(view), 'the source editor kept vim').toBe(false)
    expect(errors).toEqual([])
  })

  /**
   * **THE SETTINGS `main.ts` STORES ITSELF**, rather than through `editor-prefs.ts`. Their writers were
   * already guarded; this holds them to it, since a gesture is as much the app as its start-up is.
   */
  it('lets the style and the appearance be changed, and the page wears them', async () => {
    await openSettings()
    const root = document.documentElement
    const background = () => getComputedStyle(document.body).backgroundColor
    const before = reached
    await userEvent.selectOptions(byId<HTMLSelectElement>('style'), 'paper')
    await userEvent.selectOptions(byId<HTMLSelectElement>('appearance-choice'), 'light')
    await until(() => root.dataset.style === 'paper' && root.dataset.theme === 'light', 'paper, light')
    const light = background()
    await userEvent.selectOptions(byId<HTMLSelectElement>('appearance-choice'), 'dark')
    await until(() => root.dataset.theme === 'dark', 'dark')
    expect(background(), 'the page did not change colour').not.toBe(light)
    expect(reached, 'the choices never tried to reach storage').toBeGreaterThan(before)
    expect(errors).toEqual([])
  })

  it('lets format on blur be turned on, and formats when the focus leaves', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: UNFORMATTED } })
    await openSettings()
    const box = byId<HTMLInputElement>('format-on-blur')
    expect(box.checked, 'precondition: a first visit starts with format on blur off').toBe(false)
    const before = reached
    await userEvent.click(box)
    expect(box.checked).toBe(true)
    expect(reached, 'the choice never tried to reach storage').toBeGreaterThan(before)
    view.focus()
    await until(() => view.hasFocus, 'the source editor to take focus')
    view.contentDOM.blur()
    await until(() => text() !== UNFORMATTED, 'the program to format when the focus left')
    expect(text()).toContain('fn fact(n) {\n')
    expect(errors).toEqual([])
  })

  /**
   * **THE REFUSAL IS STILL REPORTED WHERE IT ALWAYS WAS.** A copy is work, and `main.ts`'s buffers writer
   * says so when its write fails; a getter that throws is a write that fails. The sentence is matched by
   * its start and not by the cause it ends on, because that cause is not what this file is about.
   */
  it('still says that copies are not being saved', async () => {
    const said: string[] = []
    const live = byId('live')
    const observer = new MutationObserver(() => said.push(live.textContent?.trim() ?? ''))
    observer.observe(live, { childList: true, characterData: true, subtree: true })
    await closeSettings()
    const more = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-more')
    const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
    if (more === null || menu === null) throw new Error('no view menu on the λ view')
    await userEvent.click(more)
    await until(() => menu.matches(':popover-open'), 'the λ view’s menu to open')
    const fork = menu.querySelector<HTMLButtonElement>('button.detach')
    if (fork === null) throw new Error('no edit-a-copy control in the λ view’s menu')
    await userEvent.click(fork)
    await until(() => document.querySelector('[data-leaf="lambda-0"] .term-editor') !== null, 'the copy to open')
    await until(() => said.some((t) => t.startsWith('copies are not being saved')), 'the copies report')
    observer.disconnect()
    expect(errors).toEqual([])
  })
})
