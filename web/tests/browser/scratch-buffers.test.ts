import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { bindingKey } from '../../src/view-header'
import {
  buffersControl,
  editorHost,
  focusProgram,
  idle,
  lambdaHeading,
  lambdaTermText,
  lambdaTitle,
  resultsText,
  SHELL,
  settled,
  titleOf,
  until,
} from './harness'
import { lambdaSettled } from './lambda-text'
import { typeIntoScratchEditor } from './scratch-editor-fixture'

/**
 * **WHAT ENDS A BUFFER, DRIVEN THROUGH THE APP** — 5d-ii-c design §4.3's table, its row *recompile from
 * source: ended it -> **survives***.
 *
 * **THE CLAIM THIS FILE EXISTS TO PIN IS A NEGATIVE ONE**, which is why it is asserted on the RENDERED
 * TERM rather than on how many λ sessions the registry holds. A buffer that survived the keystroke but
 * was silently re-seeded from the new source program would keep every count right — same session, same
 * item in the title menu, same pane binding — and would still have thrown the user's work away, which
 * is the only thing a scratch buffer is for. The term the user typed into the buffer's own editor is
 * the one surface that can tell those two apart, so that is what this test reads.
 *
 * **AND THE SECOND `describe` IS THE OTHER HALF OF THE SAME TABLE** — *closing its last pane: ended it
 * -> **survives, listed as `orphan`***, and *explicit retire: did not exist -> **ends it***. The two
 * tests are ordered: there is no orphan to reach until a buffer exists and no buffer until something
 * forks one.
 *
 * ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives: ES module imports are cached, so `main()`
 * runs once per page and Vitest gives each test FILE its own page.
 *
 * Section and decision citations here are the 5d-ii-c design's unless they name another.
 */

let view: EditorView

/** Every item `leaf`'s title menu offers, as `{ key, text }` — opens and closes the menu to read it. */
function offered(leaf: string): { key: string; text: string }[] {
  const title = titleOf(leaf)
  if (title === null) return []
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const items = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b) => ({
    key: b.dataset.binding ?? '',
    text: b.textContent ?? '',
  }))
  menu?.hidePopover()
  return items
}

/**
 * The λ item for the one scratch buffer the view's title menu offers — BY ELIMINATION, since the
 * source session is the only λ session whose id `main.ts` writes down.
 *
 * READ OUT OF THE DOM RATHER THAN WRITTEN DOWN, the idiom `scratch-rebind-editor.test.ts` and
 * `two-lambda-panes.test.ts` share: 5d-ii-c decision 1 mints `scratch-N` per fork and never reissues
 * a retired name, and `main()` runs once per test FILE, so the number a fork lands on is a function of
 * every fork before it. A hard-coded `scratch-1` passes until an unrelated test above it forks.
 *
 * IT THROWS UNLESS THERE IS EXACTLY ONE, because "the buffer" is not a thing the DOM can answer with
 * two of them live, and a helper that quietly took the first would make every assertion after it
 * describe whichever one happened to sort earliest.
 */
const bufferItem = (): { key: string; text: string } => {
  const buffers = offered('lambda-0').filter(
    (i) => i.key.startsWith('lambda:') && i.key !== bindingKey('lambda', 'source'),
  )
  const only = buffers[0]
  if (buffers.length !== 1 || only === undefined) {
    throw new Error(`expected exactly one scratch buffer in the λ group, found ${buffers.length}`)
  }
  return only
}

/**
 * WHETHER THE HEADER IS ACTUALLY OFFERING THE CONTROL — computed `display`, not the `hidden` IDL
 * property.
 *
 * `hidden` IS AN ATTRIBUTE WHOSE EFFECT IS A UA RULE (`[hidden] { display: none }`), AND A STYLESHEET
 * CAN BEAT IT, so the attribute does not say whether the control is on screen and the computed `display`
 * does. `tests/browser/setup.ts` loads the app's own `style.css` into the tester page, so this reads the
 * rules the app ships rather than UA defaults.
 */
const buffersDisplay = () => {
  const button = buffersControl()
  if (button === null) throw new Error('no #buffers control in the header')
  return getComputedStyle(button).display
}

/** What each row of the open list READS — §5's rule: assert on the buffer's own rendered text. */
const bufferRows = () => [...document.querySelectorAll<HTMLElement>('.buffer-row-name')].map((e) => e.textContent)

/** A row's retire control, reached by the accessible name that names ITS buffer rather than by index. */
const retireControl = (name: string) =>
  document.querySelector<HTMLButtonElement>(`.buffer-list button[aria-label="delete ${name}"]`)

/**
 * **NOTHING THIS FILE STORES REACHES A SIBLING.** The retire test below closes `lambda-0`, so the layout
 * tree it persists lacks one of `fourViews()`'s own leaves, and `redextape.buffers` survives a reload, so
 * a page that forks leaves a `main()` mounted after it RESTORING those buffers. Neither needs clearing
 * here: every browser test file gets its own in-memory `Storage`, installed in
 * `tests/browser/setup.ts` before this file's own module body runs, and that file's doc has why
 * clearing a shared key is not enough.
 */

describe('a scratch buffer across a recompile of the source', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(idle, 'the first compile')
  })

  /**
   * **DECISION 2, THE WHOLE OF IT: A SOURCE KEYSTROKE ENDS NOTHING.** Design §4.3 — a buffer is an
   * independent λ session the user edits, and the only thing that ends one is an explicit retire.
   *
   * ONE SEQUENCED `it`, the house rule `scratch-app.test.ts` states: the states are ordered (no buffer
   * to keep alive until one has been forked, nothing to type into until its editor exists) and
   * `beforeAll` mounts ONE app for the file, so separate `it`s would each depend on the previous having
   * run. Every stage asserts before it acts.
   */
  it('keeps the pane on its buffer, still showing the term typed into it, and keeps the editor mounted', async () => {
    // STAGE 0 — a settled source program, and the λ pane on it.
    await settled(view, 'let x = 40; x + 2')
    expect(lambdaHeading()).toBe('λ · program')

    // STAGE 1 — fork. The pane moves onto a minted buffer and an editor arrives over the wire.
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    expect(lambdaHeading()).toContain('copy · not linked')
    await until(() => editorHost() !== null, 'the editor to mount')
    await until(() => lambdaTermText() !== '', 'the buffer to produce its first frame')
    const buffer = bufferItem()
    const label = buffer.text
    expect(label).toMatch(/^λ · copy \d+$/)
    expect(lambdaTitle()?.dataset.binding).toBe(buffer.key)

    // STAGE 2 — TYPE A TERM NO SOURCE PROGRAM IN THIS TEST COULD PRODUCE. This is what makes the
    // assertion after the recompile mean "the buffer's own work is still there" rather than "a λ
    // session is still bound": `(λa. a a) (λb. b)` is the user's text, reduced on the buffer's own
    // thread, and it is neither the source's old program nor its new one.
    await lambdaSettled()
    const seeded = lambdaTermText()
    typeIntoScratchEditor('(λa. a a) (λb. b)', 'no buffer editor mounted under [data-leaf="lambda-0"]')
    await until(() => lambdaTermText() !== seeded, 'the edited buffer to recompile')
    await lambdaSettled()
    const edited = lambdaTermText()
    expect(edited).not.toBe('')
    expect(edited).toContain('λ')

    // STAGE 3 — THE RECOMPILE. A retire at the dispatch would be observable on the line after it: the
    // pane home on `source`, the `copy · not linked` status gone, the editor unmounted and the buffer's
    // item out of the λ group. All four are asserted NOT to happen, first synchronously and then again
    // once the source has actually finished compiling.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let z = 9; z * 3' } })

    expect(lambdaHeading()).toContain('copy · not linked')
    expect(lambdaTitle()?.dataset.binding).toBe(buffer.key)
    expect(editorHost()).not.toBeNull()

    // AND THE SOURCE REALLY DID RECOMPILE — 27, from a program the pane is not showing. Without this
    // the whole test would pass on a keystroke that never reached `schedule` at all.
    focusProgram()
    await until(() => idle() && resultsText().includes('27'), 'the source recompile')

    // THE ASSERTION. The pane is still on its buffer, the buffer is still in the λ group under the name
    // it was minted with, and the term is the one the user typed — not the source's new λ leg, and not
    // a re-seed of the buffer from it.
    expect(lambdaHeading()).toContain('copy · not linked')
    expect(bufferItem().text).toBe(label)
    expect(lambdaTitle()?.dataset.binding).toBe(buffer.key)
    expect(lambdaTitle()?.dataset.binding).not.toBe(bindingKey('lambda', 'source'))
    expect(lambdaTermText()).toBe(edited)
    // AND THE EDITOR IS STILL THERE TO GO ON TYPING IN: a retire would take it down with the session
    // (5d-iii design §4.3: "the text in the box is lost").
    expect(editorHost()).not.toBeNull()
  })
})

/**
 * **THE HEADER LIST, DRIVEN THROUGH THE APP — 5d-ii-c design §4.2's surface and §4.3's first two rows.**
 * Closing a buffer's last pane leaves it running with no view showing it; this list names it as *not
 * shown*, and deleting it from the list ends it.
 *
 * **IT RUNS AFTER THE TEST ABOVE AND DEPENDS ON IT** (`beforeAll` mounts ONE app for the file): there is
 * no orphan to reach until a buffer exists, and no buffer until something forks one. What it inherits is
 * exactly one buffer, one λ pane bound to it, and that buffer's editor mounted in the pane.
 *
 * **THE EDITOR'S DESTROY IS NOT ASSERTED HERE**: nothing in the DOM tells a destroyed editor from a held
 * one, and the note at the end of this test says where the destroy is covered instead.
 *
 * **AND IT PINS WHERE FOCUS LANDS**, which is not in its name because it is the same gesture rather than
 * a second one. The menu offers *new TM copy* and is therefore never empty, so `#buffers` is not hidden
 * at zero. Deleting the LAST row closes the list: `buffer-list.ts`'s `handleDelete` finds no row to move
 * focus to, calls `menu.hidePopover()` and focuses the invoker itself, an invoker that is never taken out
 * of the tab order. So the button holds focus and stays reachable through the delete — the accessibility
 * list's item 1.
 */
describe('the header buffer list', () => {
  it('lists a copy no view is showing as not shown, and deleting it ends the copy', async () => {
    // STAGE 0 — what the test above left, asserted rather than assumed. The button reads ONE buffer,
    // which is `transport.ts`'s fork telling the header its count changed; a readout wired only to the
    // retire would still read the zero-buffer label here.
    // THE MENU SAYS `λ · copy 1`; THE COPIES MENU SAYS `λ copy 1` — the same name, spelled for each.
    const buffer = bufferItem()
    const label = buffer.text.replace(/^λ · /, 'λ ')
    expect(label).toMatch(/^λ copy \d+$/)
    const button = buffersControl()
    expect(buffersDisplay()).not.toBe('none')
    expect(button?.textContent).toBe('copies 1 ▾')

    // THE EDITOR'S OWN NODE, TAKEN WHILE IT IS STILL MOUNTED — `.cm-editor` IS the `EditorView`'s `dom`.
    // It is read here for the mounted assertion below and for nothing else; the note at the end of this
    // test has why no DOM check brackets the close.
    const editorNode = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor .cm-editor')
    if (editorNode === null) throw new Error('no editor mounted on the λ pane')
    expect(EditorView.findFromDOM(editorNode)).not.toBeNull()

    // STAGE 1 — close the only pane showing the buffer. Design §4.3: the buffer SURVIVES, and its editor
    // goes into custody rather than being destroyed (5d-ii-a design §4.3), so the pane that asks for it
    // next gets that view back with its text and undo intact.
    const close = document.querySelector<HTMLButtonElement>(
      '[data-leaf="lambda-0"] button[aria-label="close this view"]',
    )
    if (close === null) throw new Error('no close control on the λ pane')
    close.click()
    expect(document.querySelector('[data-leaf="lambda-0"]')).toBeNull()
    expect(buffersDisplay()).not.toBe('none')
    expect(button?.textContent).toBe('copies 1 ▾')

    // STAGE 2 — THE *not shown* ROW, which is the whole reason this control exists: no view shows this
    // copy, and the row is asserted on its own rendered text (§5) rather than on a control existing.
    //
    // **`focus()` BEFORE `click()`, AND IT IS THE PRECONDITION FOR STAGE 3'S FOCUS ASSERTION RATHER THAN
    // A FLOURISH.** A bare `element.click()` dispatches the event without focusing anything, which no
    // real activation does — a pointer press focuses the button and so does Enter on a tabbed-to one. It
    // matters because the popover records its previously-focused element at show time and hands focus
    // back to it on hide: with the invoker unfocused, `hidePopover` returns focus to whatever held it
    // (in this file, the source editor), and a keyboard stranded by the delete would not show.
    button?.focus()
    button?.click()
    expect(bufferRows()).toEqual([`${label} · not shown`])

    // STAGE 3 — delete it. The list is rebuilt around the delete (`buffer-list.ts`'s `handleDelete`), so a
    // row naming a copy that has gone is never left on screen; this was the LAST row, so the rebuild
    // leaves nothing and the list closes.
    retireControl(label)?.click()
    expect(document.querySelector('.buffer-list')?.matches(':popover-open')).toBe(false)

    // **THE BUFFER IS GONE FROM THE HEADER, AND THE BUTTON STAYS.** The menu is never empty (it offers
    // *new TM copy*), so the readout is the zero-buffer label, not an empty count, and the control stays
    // reachable exactly when a user with nothing to reclaim wants somewhere to paste a `.tm` file.
    expect(button?.textContent).toBe('copies ▾')
    expect(buffersDisplay()).not.toBe('none')

    // **AND THE KEYBOARD IS ON THE BUTTON ITSELF.** `#buffers` is never withdrawn, so `handleDelete`'s own
    // `button.focus()` on the empty list is the whole of what places focus, with nothing after it to undo —
    // the accessibility list's item 1, "a control that hides itself on click strands the keyboard".
    expect(document.activeElement).toBe(button)

    // AND FROM EVERY PANE'S SELECTOR, which is the registry side of the same fact — design §5's
    // "retiring an orphan from the list removes it from every pane's selector", read off the TM pane
    // because the λ pane that was showing the buffer is the one this test closed.
    // BY KEY, NOT BY TEXT: an item reads `λ · copy 1`, so a text search for a bare label would pass
    // whether or not the buffer was still offered.
    const keys = offered('tm-0').map((i) => i.key)
    expect(keys).toContain(bindingKey('tm', 'source'))
    expect(keys).not.toContain(buffer.key)

    // **THE DESTROY IS NOT ASSERTED AT THIS TIER: NOTHING IN THE DOM TELLS IT FROM A HOLD.** `destroy()`
    // removes the editor's node from its parent, and so does `takeEditor`, which hands a node to custody,
    // so a held editor and a destroyed one are both parentless. In Chromium, across mounted / detached /
    // destroyed, all three states of a real `ScratchEditor`: `parentElement`, `isConnected`,
    // `EditorView.findFromDOM`, the presence of `.cm-content`, its `contenteditable`, `childElementCount`
    // and `cmView` on the node are IDENTICAL for detached and destroyed. `EditorView.destroy()` tears down
    // the view without clearing anything a query can reach, so a DOM proxy for the destroy would pass
    // whether or not it ran.
    //
    // WHERE IT IS COVERED INSTEAD: `tests/browser/editor-custody.test.ts`'s 'destroys the held editor,
    // sending the edit it had pending as it comes down', over the real `createEditorCustody`, on a signal
    // that does separate them — the editor's PENDING EDIT. That test retires a session with a keystroke in
    // flight and asserts the edit is sent at the reconcile, before any timer could fire it: it observes
    // what the destroy does rather than a side effect of where a node sat.
  })
})
