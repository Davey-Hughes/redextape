import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

/**
 * An asm copy, end to end through the app (Plan 7 part 5 spec §7): *edit a copy* in the asm view's `⋯` menu, the copy's
 * editor in the view, a rebuild from what is typed, the language server's marks and outline and format on it, and a
 * copy's rows linking nothing. Every gesture a user makes with the pointer is made with `userEvent`, which moves the
 * browser's pointer, rather than `.click()` — 4b's lesson: a synthetic click passed where a real one was lost. The one
 * exception is the split in the test of a view split from a copy, whose own comment says why it drives the menu with
 * `.click()`: what it tests is the view the split builds, not the menu.
 *
 * ONE MOUNT FOR THE FILE, for the reason every sibling gives: `main()` runs once per page.
 */

const SAMPLE = 'let x = 40; x + 2'
/** `SAMPLE`'s asm, as `Session.asmText` prints it: headed by its type, one instruction a line. */
const SAMPLE_ASM = 'result Nat\n\n    li\tr0, #40\n    mov\tr1, r0\n    li\tr2, #2\n    add\trr, r1, r2\n    halt\n'

let view: EditorView

const host = (leaf: string) => document.querySelector<HTMLElement>(`.pane[data-leaf="${leaf}"]`) as HTMLElement
const asm = () => host('asm-0')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const editorOf = (pane: HTMLElement): EditorView | null => {
  const el = pane.querySelector<HTMLElement>('.term-editor')
  return el === null ? null : EditorView.findFromDOM(el)
}
const editorText = () => editorOf(asm())?.state.doc.toString() ?? null
const type = (text: string) => {
  const v = editorOf(asm())
  if (v === null) throw new Error('no editor in the asm view')
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
}
const pcs = () => [...asm().querySelectorAll<HTMLElement>('.asm-row .asm-pc')].map((e) => e.textContent)
const value = () => asm().querySelector('.asm-value')?.textContent ?? ''
const notice = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const sourceLinked = () => document.querySelector('.cm-editor .linked')?.textContent ?? null
const menuOf = (pane: HTMLElement): HTMLElement => {
  const more = pane.querySelector<HTMLButtonElement>('button.view-more')
  const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
  if (more === null || menu === null) throw new Error('no view menu')
  return menu
}
const menuItem = (pane: HTMLElement, cls: string) => menuOf(pane).querySelector<HTMLButtonElement>(`button.${cls}`)

/** Open `pane`'s `⋯` menu with the pointer and pick `cls`'s item with it, as a user does. */
async function pick(pane: HTMLElement, cls: string): Promise<void> {
  await userEvent.click(pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement)
  await until(() => menuOf(pane).matches(':popover-open'), 'the view menu to open')
  const item = menuItem(pane, cls)
  if (item === null) throw new Error(`the menu offers no ${cls}`)
  await userEvent.click(item)
}

async function compile(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await compile(SAMPLE)
  await until(() => pcs().length === 5, 'the program’s listing')
})

describe('an asm copy', () => {
  it('is made from the asm view’s menu, holds the whole program, and is what the view then shows', async () => {
    const item = menuItem(asm(), 'detach')
    expect(item?.disabled).toBe(false)
    expect(item?.querySelector('.view-menu-hint')?.textContent).toBe('the whole program')
    expect(asm().querySelector('.term-editor')).toBeNull()

    await pick(asm(), 'detach')

    await until(() => editorText() !== null, 'the copy’s editor to mount')
    expect(editorText()).toBe(SAMPLE_ASM)
    expect(notice()).toBe('asm copy 1 created — this view shows it')
    expect(asm().textContent).toMatch(/copy · not linked/)
    await until(() => value() === 'value: 42', 'the copy’s value')
    expect(pcs()).toEqual(['pc0', 'pc1', 'pc2', 'pc3', 'pc4'])
    // A COPY OFFERS NO COPY OF ITSELF, AND A VIEW WITH AN EDITOR OFFERS FORMAT.
    expect(menuItem(asm(), 'detach')).toBeNull()
    expect(menuItem(asm(), 'format-doc')?.hidden ?? true).toBe(false)
  })

  it('rebuilds from what is typed into it', async () => {
    type('result Nat\n\n    li\trr, #7\n    halt\n')
    await until(() => value() === 'value: 7', 'the rebuilt copy’s value')
    expect(pcs()).toEqual(['pc0', 'pc1'])
  })

  it('marks a label that names nothing where it is written, keeps its last run, and says nothing else', async () => {
    const before = notice()
    type('result Nat\n\n    jmp\tnowhere\n')
    await until(() => asm().querySelector('.cm-editor .cm-lintRange-error') !== null, 'the editor to mark the label')
    expect(asm().querySelector('.cm-editor .cm-lintRange-error')?.textContent).toBe('nowhere')
    expect(value()).toBe('value: 7')
    expect(pcs()).toEqual(['pc0', 'pc1'])
    expect(notice()).toBe(before)
  })

  it('lists its labels in its outline', async () => {
    type('result Nat\n\nstart:\n    li\trr, #1\n    halt\n')
    await until(() => value() === 'value: 1', 'the copy to build')
    const outline = asm().querySelector<HTMLElement>('.panel[data-panel="outline"]') as HTMLElement
    expect(outline.hidden).toBe(false)
    await userEvent.click(outline.querySelector<HTMLButtonElement>('.panel-toggle') as HTMLButtonElement)
    await until(() => (outline.querySelector('.outline')?.textContent ?? '').includes('start'), 'the outline')
  })

  it('answers a hover on a label, from the language server part 3 built', async () => {
    const v = editorOf(asm()) as EditorView
    const at = v.state.doc.toString().indexOf('start')
    expect(at).toBeGreaterThan(0)
    v.dispatch({ selection: { anchor: at } })
    v.focus()
    await until(() => v.hasFocus, 'the copy’s editor to take focus')
    // F2 ASKS AT THE CARET, AS `lsp-hover.test.ts` DOES; the first press can land before the server has the text, so
    // it is repeated until a tooltip opens.
    const answer = () => v.dom.querySelector('.cm-hover-answer')?.textContent ?? null
    for (let i = 0; i < 20 && answer() === null; i++) {
      await userEvent.keyboard('{F2}')
      await new Promise((r) => setTimeout(r, 300))
    }
    expect(answer()).toContain('label start')
    await userEvent.keyboard('{ArrowRight}')
    await until(() => answer() === null, 'the tooltip to close once the caret moves')
  })

  it('formats its text from the menu', async () => {
    type('result Nat\nli rr,#3\nhalt\n')
    await until(() => value() === 'value: 3', 'the copy to build')
    await pick(asm(), 'format-doc')
    await until(() => editorText() === 'result Nat\n\n    li\trr, #3\n    halt\n', 'the formatted text')
  })

  it('links nothing from a row', async () => {
    expect(sourceLinked()).toBeNull()
    await userEvent.click(asm().querySelector<HTMLElement>('.asm-row') as HTMLElement)
    expect(sourceLinked()).toBeNull()
    expect(asm().querySelector('.asm-row.is-linked')).toBeNull()
  })

  it('shows the program again, and offers a copy again, once the view is moved back to it', async () => {
    const title = asm().querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
    await userEvent.click(title)
    const menu = document.getElementById(title.getAttribute('aria-controls') ?? '') as HTMLElement
    await userEvent.click(
      menu.querySelector<HTMLButtonElement>(`button[data-binding="${bindingKey('asm', 'source')}"]`) as HTMLElement,
    )
    await until(() => pcs().length === 5, 'the program’s listing')
    expect(asm().querySelector('.term-editor')).toBeNull()
    expect(value()).toBe('')
    expect(menuItem(asm(), 'detach')?.disabled).toBe(false)
  })
})

describe('asm copies and the views that show them', () => {
  /** Pick `session`'s asm pair in `pane`'s title menu with the pointer. */
  async function show(pane: HTMLElement, session: string): Promise<void> {
    const title = pane.querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
    await userEvent.click(title)
    const menu = document.getElementById(title.getAttribute('aria-controls') ?? '') as HTMLElement
    await userEvent.click(
      menu.querySelector<HTMLButtonElement>(`button[data-binding="${bindingKey('asm', session)}"]`) as HTMLElement,
    )
  }

  it('moves its editor with the view from one copy to another', async () => {
    await pick(asm(), 'detach')
    await until(() => editorText() === SAMPLE_ASM, 'a second copy’s editor')
    await show(asm(), 'scratch-1')
    await until(() => editorText() === 'result Nat\n\n    li\trr, #3\n    halt\n', 'the first copy’s text')
    await until(() => value() === 'value: 3', 'the first copy’s value')
  })

  it('shows a view split from a copy its listing and its value, and leaves the editor where it was', async () => {
    // THE SPLIT THROUGH THE MENU'S OWN BUTTONS, AS `layout-app.test.ts`'s `splitVia` MAKES IT: what is under test is
    // the view the split builds, not the menu.
    const more = asm().querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
    more.click()
    const menu = menuOf(asm())
    menu.querySelector<HTMLButtonElement>('button.view-split[data-dir="row"]')?.click()
    menu.querySelector<HTMLButtonElement>('.view-menu-pairs button[data-same]')?.click()
    const other = () =>
      [...document.querySelectorAll<HTMLElement>('.pane[data-kind="asm"]')].find((e) => e.dataset.leaf !== 'asm-0')
    await until(() => other() !== undefined, 'the split view')
    const split = other() as HTMLElement
    await until(() => split.querySelector('.asm-value')?.textContent === 'value: 3', 'the split view’s value')
    expect(split.querySelectorAll('.asm-row .asm-pc').length).toBe(2)
    expect(split.querySelector('.term-editor')).toBeNull()
    expect(editorText()).not.toBeNull()
  })

  it('sends every view on a copy back to the program when the copy is paused', async () => {
    const button = document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement
    await userEvent.click(button)
    const pause = await (async () => {
      await until(() => document.querySelector('button[aria-label="pause asm copy 1"]') !== null, 'the copy’s row')
      return document.querySelector<HTMLButtonElement>('button[aria-label="pause asm copy 1"]') as HTMLButtonElement
    })()
    await userEvent.click(pause)
    const views = [...document.querySelectorAll<HTMLElement>('.pane[data-kind="asm"]')]
    expect(views.length).toBe(2)
    for (const v of views) {
      await until(() => v.querySelectorAll('.asm-row .asm-pc').length === 5, `${v.dataset.leaf} to show the program`)
      expect(v.querySelector('.asm-value')?.textContent).toBe('')
      expect(v.querySelector('.term-editor')).toBeNull()
    }
    if (button.getAttribute('aria-expanded') === 'true') await userEvent.click(button)
  })
})

describe('a TM copy', () => {
  it('has its editor again in a view moved off it and back', async () => {
    const tm = host('tm-0')
    await until(() => tm.querySelectorAll('.state-row').length > 3, 'the program’s rules')
    await pick(tm, 'detach')
    await until(() => tm.querySelector('.cm-editor') !== null, 'the TM copy’s editor')
    const pickPair = async (key: string) => {
      const title = tm.querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
      await userEvent.click(title)
      const menu = document.getElementById(title.getAttribute('aria-controls') ?? '') as HTMLElement
      await userEvent.click(menu.querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`) as HTMLElement)
    }
    const copyKey = tm.querySelector<HTMLButtonElement>('button.view-title')?.dataset.binding ?? ''
    // THE VIEW'S TITLE NAMES THE COPY: the TM leg, and a session that is not the program's.
    expect(copyKey.startsWith(bindingKey('tm', ''))).toBe(true)
    expect(copyKey).not.toBe(bindingKey('tm', 'source'))
    await pickPair(bindingKey('tm', 'source'))
    await until(() => tm.querySelector('.cm-editor') === null, 'the program, with no editor')
    await pickPair(copyKey)
    await until(() => tm.querySelector('.cm-editor') !== null, 'the copy’s editor, again')
  })

  it('links nothing from a state row either', async () => {
    const tm = host('tm-0')
    await until(() => /copy · not linked/.test(tm.textContent ?? ''), 'the TM view to show the copy')
    await until(() => tm.querySelectorAll('.state-row').length > 3, 'the copy’s rules')
    // THE ROW `let x = 40`'s CONSTRUCT OWNS IN THE PROGRAM — measured on `main`, where a click on it in the copy pinned
    // `40` in the source through the program's index.
    await userEvent.click(tm.querySelectorAll<HTMLElement>('.state-row')[3] as HTMLElement)
    expect(sourceLinked()).toBeNull()
    expect(tm.querySelector('.state-row.is-linked')).toBeNull()
  })
})

describe('where the asm leg declines', () => {
  it('offers no copy', async () => {
    await compile('fn inc(x) { x + 1 } fn t(g) { g(3) } fn ap(h, y) { h(y) } t(inc) + ap(t, inc)')
    await until(() => pcs().length === 0, 'the listing to clear')
    expect(menuItem(asm(), 'detach')).toBeNull()
  })
})

/**
 * Plan 7 part 5c's final fix wave: `|x| x + 1` types as `(Nat) -> Nat`, and a `.tm` header naming that in
 * its `result` line is one `run` refuses to read (`ty::is_decodable`, `redextape-core`). The TM leg still
 * builds — `state-row`s below prove it — so *edit a copy* is offered, disabled with the reason, rather than
 * withdrawn (the umbrella's §4 rule); a non-function program is the positive control.
 */
describe('a function-valued program’s TM view', () => {
  it('disables edit a copy with the reason, and a non-function program leaves it enabled', async () => {
    const tm = host('tm-0')

    // BRING THE TM PANE HOME FIRST: `describe('a TM copy', ...)` above leaves it bound to the copy it
    // forked and never rebinds it back, and a view on a copy offers no copy of its own at all
    // (`CopyEditor.#refreshDetach`'s first check) — a stale binding here would find no control rather
    // than the one this test means to inspect.
    const title = tm.querySelector<HTMLButtonElement>('button.view-title')
    if (title !== null && title.dataset.binding !== bindingKey('tm', 'source')) {
      await userEvent.click(title)
      const titleMenu = document.getElementById(title.getAttribute('aria-controls') ?? '')
      await userEvent.click(
        titleMenu?.querySelector<HTMLButtonElement>(
          `button[data-binding="${bindingKey('tm', 'source')}"]`,
        ) as HTMLButtonElement,
      )
    }
    // PRECONDITION, ASSERTED RATHER THAN ASSUMED: the rest of this test means nothing on a view still
    // showing a copy.
    await until(
      () => tm.querySelector<HTMLButtonElement>('button.view-title')?.dataset.binding === bindingKey('tm', 'source'),
      'the TM view to return to the program',
    )

    // THE POSITIVE CONTROL, FIRST: a program whose value is not a function offers the control, enabled.
    await compile('let x = 40; x + 2')
    await until(() => tm.querySelectorAll('.state-row').length > 0, 'the program’s rules')
    await userEvent.click(tm.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement)
    await until(() => menuOf(tm).matches(':popover-open'), 'the view menu to open')
    expect(menuItem(tm, 'detach')?.disabled).toBe(false)
    await userEvent.keyboard('{Escape}')
    await until(() => !menuOf(tm).matches(':popover-open'), 'the view menu to close')

    await compile('|x| x + 1')
    await until(() => tm.querySelectorAll('.state-row').length > 0, 'the function-valued program’s rules')
    await userEvent.click(tm.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement)
    await until(() => menuOf(tm).matches(':popover-open'), 'the view menu to open')
    const item = menuItem(tm, 'detach')
    expect(item?.disabled).toBe(true)
    expect(item?.getAttribute('aria-description')).toBe('a function-valued program has no TM file a copy can run')
    expect(item?.querySelector('.view-menu-hint')?.textContent).toBe(
      'a function-valued program has no TM file a copy can run',
    )
  })
})
