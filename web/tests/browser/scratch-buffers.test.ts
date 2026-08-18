import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * **WHAT ENDS A BUFFER, DRIVEN THROUGH THE APP** — design §4.3's table, and the row this task changes:
 * *recompile from source: ended it -> **survives***.
 *
 * **THE CLAIM THIS FILE EXISTS TO PIN IS A NEGATIVE ONE**, which is why it is asserted on the RENDERED
 * TERM rather than on how many λ sessions the registry holds. A buffer that survived the keystroke but
 * was silently re-seeded from the new source program would keep every count right — same session, same
 * option in the selector, same pane binding — and would still have thrown the user's work away, which
 * is the only thing a scratch buffer is for. The term the user typed into the buffer's own editor is
 * the one surface that can tell those two apart, so that is what this test reads.
 *
 * **IT IS THE OTHER SIDE OF TWO TESTS THAT ASSERTED THE OPPOSITE**, and both are re-pointed rather than
 * deleted: `scratch-app.test.ts`'s end-to-end fork test (its STAGE 4 read "recompile from source retires
 * it") and `scratch-edit.test.ts` (its STAGE 4 read "recompiling from source retires the scratchpad and
 * takes the editor with it"). Their own docs now name what they used to claim.
 *
 * **AND THE SECOND `describe` IS THE OTHER HALF OF THE SAME TABLE** — *closing its last pane: ended it
 * -> **survives, listed as `orphan`***, and *explicit retire: did not exist -> **ends it***. This file's
 * doc used to say "THE APP HAS NO WAY BACK FROM A WEDGED BUFFER WHILE THIS FILE HOLDS ONLY THIS TEST",
 * because 5d-i made a recompile the poison-recovery path (design §3.4) and nothing inherited that role
 * until the header list was wired (§4.4). It is wired, this file grew the orphan-and-retire test that
 * closes it, and the two tests are ordered: there is no orphan to reach until a buffer exists and no
 * buffer until something forks one.
 *
 * ONE MOUNT FOR THE FILE, the reason every sibling gives: ES module imports are cached, so `main()`
 * runs once per page and Vitest gives each test FILE its own page.
 */

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

let view: EditorView

async function until(predicate: () => boolean, what: string, timeoutMs = 60_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const resultsText = () => document.querySelector('#results')?.textContent ?? ''
const term = () => document.querySelector('[data-leaf="lambda-0"] .term')?.textContent ?? ''
const heading = () => document.querySelector('[data-leaf="lambda-0"] h2')?.textContent ?? ''
const editorHost = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor')
const selector = () => document.querySelector<HTMLSelectElement>('[data-leaf="lambda-0"] .pane-binding select')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== ''

/**
 * The `<option>` value the pane selector encodes a `(leg, session)` pair as — spelled out here rather
 * than imported from `pane-chrome.ts`, so this pins the DOM contract instead of agreeing with whatever
 * the control currently does. `\x00` as an escape is `scripts/check-text-bytes.sh`'s rule.
 */
const optionValue = (leg: string, id: string) => `${leg}\x00${id}`

/**
 * The λ `<option>` for the one scratch buffer the pane's selector offers — BY ELIMINATION, since the
 * source session is the only λ session whose id `main.ts` writes down.
 *
 * READ OUT OF THE DOM RATHER THAN WRITTEN DOWN, the idiom `scratch-rebind-editor.test.ts` and
 * `two-lambda-panes.test.ts` both settled on: 5d-ii-c decision 1 mints `scratch-N` per fork and never
 * reissues a retired name, and `main()` runs once per test FILE, so the number a fork lands on is a
 * function of every fork before it. A hard-coded `scratch-1` passes until an unrelated test above it
 * forks.
 *
 * IT THROWS UNLESS THERE IS EXACTLY ONE, because "the buffer" is not a thing the DOM can answer with
 * two of them live, and a helper that quietly took the first would make every assertion after it
 * describe whichever one happened to sort earliest.
 */
const bufferOption = (): HTMLOptionElement => {
  const buffers = [
    ...document.querySelectorAll<HTMLOptionElement>('[data-leaf="lambda-0"] .pane-binding optgroup[label="λ"] option'),
  ].filter((o) => o.textContent !== 'source')
  const only = buffers[0]
  if (buffers.length !== 1 || only === undefined) {
    throw new Error(`expected exactly one scratch buffer in the λ group, found ${buffers.length}`)
  }
  return only
}

const buffersButton = () => document.querySelector<HTMLButtonElement>('#buffers')

/**
 * WHETHER THE HEADER IS ACTUALLY OFFERING THE CONTROL — computed `display`, not the `hidden` IDL
 * property.
 *
 * `hidden` IS AN ATTRIBUTE WHOSE EFFECT IS A UA RULE (`[hidden] { display: none }`), AND A STYLESHEET
 * CAN BEAT IT. `expect(button.hidden).toBe(true)` passes on a page where `.bar button { display: flex }`
 * puts the control back on screen — which is the whole of what "withheld at zero buffers" claims, defeated
 * with the assertion still green. `tests/browser/setup.ts` loads the app's own `style.css` into the
 * tester page, so this reads the rules the app ships rather than UA defaults.
 */
const buffersDisplay = () => {
  const button = buffersButton()
  if (button === null) throw new Error('no #buffers control in the header')
  return getComputedStyle(button).display
}

/** What each row of the open list READS — §5's rule: assert on the buffer's own rendered text. */
const bufferRows = () => [...document.querySelectorAll<HTMLElement>('.buffer-row-name')].map((e) => e.textContent)

/** A row's retire control, reached by the accessible name that names ITS buffer rather than by index. */
const retireControl = (label: string) =>
  document.querySelector<HTMLButtonElement>(`.buffer-list button[aria-label="retire ${label}"]`)

const clickLambda = (label: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')].find(
    (x) => x.textContent === label,
  )
  if (b === undefined) throw new Error(`no \`${label}\` button in the λ pane`)
  b.click()
}

/** `scratch-app.test.ts`'s own `settled`, and the same invariant argument applies — see its doc there. */
async function settled(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(idle, `the app to settle on \`${src}\``)
}

/**
 * A real keystroke into the buffer's own editor — `scratch-edit.test.ts`'s helper, and its reason:
 * `ScratchEditor#setText` sets a `#seeding` flag for the duration of its dispatch so a fork's seed is
 * never mistaken for a keystroke, so calling it here would fire no recompile at all.
 */
function typeIntoBufferEditor(text: string): void {
  const host = editorHost()
  if (host === null) throw new Error('no buffer editor mounted under [data-leaf="lambda-0"]')
  const cmView = EditorView.findFromDOM(host)
  if (cmView === null) throw new Error('no CodeMirror view mounted under the editor host')
  cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: text } })
}

/**
 * **THIS FILE USED TO GUARD THE SHARED-ORIGIN RACE ITSELF, WITH A `beforeAll` CLEAR ON ENTRY AND AN
 * `afterAll` CLEAR ON EXIT — BOTH ARE GONE NOW.** Every browser test file gets its own in-memory
 * `Storage`, installed in `tests/browser/setup.ts` before this file's own module body runs; that file's
 * doc carries the argument in full, including why a clear-on-mount mitigation could not close the race by
 * itself.
 *
 * TWO MEASURED INCIDENTS ARE WORTH KEEPING ON RECORD, BOTH FOUND THROUGH THIS FILE. First: the retire
 * test below closes `lambda-0`, so this was the first file in the tier to persist a layout tree with one
 * of `defaultLayout()`'s own leaves MISSING — it left `link-truncated.test.ts`'s `↺` lookup answering
 * `undefined` (a silent no-op `?.click()`), which then waited out its whole timeout for a step readout
 * nothing was ever going to change. Second: `redextape.buffers` survives a reload, so a page that forks —
 * this file does — leaves the next file's `main()` RESTORING those buffers; it broke
 * `scratch-cap.test.ts`'s stage-0 assertion (`expected 'buffers 1 ▾' to be 'buffers 0 ▾'`) and, on a
 * different interleaving, `link-truncated.test.ts` instead. Neither incident needed a hand-edited
 * fixture — both came from this file's own ordinary use of the app.
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
    await settled('let x = 40; x + 2')
    expect(heading()).toBe('lambda')

    // STAGE 1 — fork. The pane moves onto a minted buffer and an editor arrives over the wire.
    clickLambda('✎ fork')
    expect(heading()).toContain('[detached]')
    await until(() => editorHost() !== null, 'the editor to mount')
    await until(() => term() !== '', 'the buffer to produce its first frame')
    const buffer = bufferOption()
    const label = buffer.textContent ?? ''
    expect(label).toMatch(/^λ scratch \d+$/)
    expect(selector()?.value).toBe(buffer.value)

    // STAGE 2 — TYPE A TERM NO SOURCE PROGRAM IN THIS TEST COULD PRODUCE. This is what makes the
    // assertion after the recompile mean "the buffer's own work is still there" rather than "a λ
    // session is still bound": `(λa. a a) (λb. b)` is the user's text, reduced on the buffer's own
    // thread, and it is neither the source's old program nor its new one.
    const seeded = term()
    typeIntoBufferEditor('(λa. a a) (λb. b)')
    await until(() => term() !== seeded, 'the edited buffer to recompile')
    const edited = term()
    expect(edited).not.toBe('')
    expect(edited).toContain('λ')

    // STAGE 3 — THE RECOMPILE. This is the keystroke that used to retire the buffer synchronously,
    // before the debounce (`compile.ts` called `retire` at dispatch), so the state it used to produce
    // was observable on the line after the dispatch: the pane home on `source`, the badge gone, the
    // editor unmounted and the buffer's option out of the λ group. All four are asserted NOT to happen,
    // first synchronously and then again once the source has actually finished compiling.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let z = 9; z * 3' } })

    expect(heading()).toContain('[detached]')
    expect(selector()?.value).toBe(buffer.value)
    expect(editorHost()).not.toBeNull()

    // AND THE SOURCE REALLY DID RECOMPILE — 27, from a program the pane is not showing. Without this
    // the whole test would pass on a keystroke that never reached `schedule` at all.
    await until(() => idle() && resultsText().includes('27'), 'the source recompile')

    // THE ASSERTION. The pane is still on its buffer, the buffer is still in the λ group under the name
    // it was minted with, and the term is the one the user typed — not the source's new λ leg, and not
    // a re-seed of the buffer from it.
    expect(heading()).toContain('[detached]')
    expect(bufferOption().textContent).toBe(label)
    expect(selector()?.value).toBe(buffer.value)
    expect(selector()?.value).not.toBe(optionValue('lambda', 'source'))
    expect(term()).toBe(edited)
    // AND THE EDITOR IS STILL THERE TO GO ON TYPING IN — the retire took it down with the session
    // (`§4.3`: "the text in the box is lost"), and nothing takes it down now.
    expect(editorHost()).not.toBeNull()
  })
})

/**
 * **THE HEADER LIST, DRIVEN THROUGH THE APP — design §4.2's surface and §4.3's last two rows.** Closing
 * a buffer's last pane leaves it running with no pane chrome anywhere able to name it, so this list is
 * the only route to it; retiring from that list is the only thing in the app that ends a buffer.
 *
 * **IT RUNS AFTER THE TEST ABOVE AND DEPENDS ON IT, WHICH IS THIS FILE'S STATED HOUSE RULE** (`beforeAll`
 * mounts ONE app for the file): there is no orphan to reach until a buffer exists, and no buffer until
 * something forks one. What it inherits is exactly one buffer, one λ pane bound to it, and that buffer's
 * editor mounted in the pane.
 *
 * **THE HELD EDITOR IS THE ASSERTION THAT COSTS THE MOST AND IS WORTH THE MOST.** A retire is the one
 * event in the app that makes `editor-custody.ts`'s `!sessions.has(session)` true, and the retire
 * handler is the only thing that calls `custody.reconcile()` on that path — `applyLayout` is the sweep's
 * other caller and no layout gesture happens here. Delete that one line from `main.ts` and the app
 * leaks a live `EditorView`, with its own pending debounce, over a terminated worker: nothing on screen
 * changes, no count is wrong, and every other assertion below still passes. The editor's own DOM node is
 * what tells the two apart — `EditorView.destroy` removes it from its parent, and a node taken off a
 * pane by `takeEditor` keeps one.
 *
 * **AND IT PINS WHERE FOCUS LANDS**, which is not in its name because it is the same gesture rather than
 * a second one. **THIS USED TO PIN THAT RETIRING THE LAST BUFFER WITHDRAWS THE HEADER CONTROL FOCUS HAD
 * JUST LANDED ON, AND SENDS FOCUS TO `#restore-layout` INSTEAD — 5d-iv T10 RETIRED THAT.** The menu now
 * offers "new TM buffer" and is therefore never empty, so `main.ts`'s `refreshBuffers` no longer hides
 * `#buffers` at zero and has nothing left to strand the keyboard over: the popover's own hide algorithm
 * already hands focus back to the invoker (`buffer-list.ts`'s `bufferRow` calls `menu.hidePopover()`
 * before `onRetire`), and an invoker that is never taken out of the tab order keeps it. What this test
 * still pins is that the button holds focus and stays reachable through the very retire that used to
 * evict it — the accessibility list's item 1, one instance retired.
 */
describe('the header buffer list', () => {
  it('lists a buffer no pane is showing as an orphan, and retiring it ends the buffer and its editor', async () => {
    // STAGE 0 — what the test above left, asserted rather than assumed. The button reads ONE buffer,
    // which is `transport.ts`'s fork telling the header its count changed; a readout wired only to the
    // retire would still read the zero-buffer label here.
    const label = bufferOption().textContent ?? ''
    expect(label).toMatch(/^λ scratch \d+$/)
    const button = buffersButton()
    expect(buffersDisplay()).not.toBe('none')
    expect(button?.textContent).toBe('buffers 1 ▾')

    // THE EDITOR'S OWN NODE, TAKEN WHILE IT IS STILL MOUNTED — `.cm-editor` IS the `EditorView`'s `dom`.
    // It is read here for the mounted assertion below and for nothing else; see STAGE 3's own note for
    // why the two lines that used to bracket the close are gone.
    const editorNode = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor .cm-editor')
    if (editorNode === null) throw new Error('no editor mounted on the λ pane')
    expect(EditorView.findFromDOM(editorNode)).not.toBeNull()

    // STAGE 1 — close the only pane showing the buffer. Design §4.3: the buffer SURVIVES, and its editor
    // goes into custody rather than being destroyed, so the pane that asks for it next gets that view
    // back with its text and undo intact.
    const close = document.querySelector<HTMLButtonElement>(
      '[data-leaf="lambda-0"] button[aria-label="close this pane"]',
    )
    if (close === null) throw new Error('no close control on the λ pane')
    close.click()
    expect(document.querySelector('[data-leaf="lambda-0"]')).toBeNull()
    expect(buffersDisplay()).not.toBe('none')
    expect(button?.textContent).toBe('buffers 1 ▾')

    // STAGE 2 — THE ORPHAN ROW, which is the whole reason this control exists: no pane names this buffer
    // any more, and the row is asserted on its own rendered text (§5) rather than on a control existing.
    //
    // **`focus()` BEFORE `click()`, AND IT IS THE PRECONDITION FOR STAGE 3'S LAST ASSERTION RATHER THAN
    // A FLOURISH.** A bare `element.click()` dispatches the event without focusing anything, which no
    // real activation does — a pointer press focuses the button and so does Enter on a tabbed-to one. It
    // matters because the popover records its previously-focused element at show time and hands focus
    // back to it on hide: with the invoker unfocused, `hidePopover` returns focus to whatever held it
    // (in this file, the source editor) and the defect below is invisible. Measured both ways before the
    // fix — unfocused invoker left `.cm-scroller`, focused invoker left `<body>`.
    button?.focus()
    button?.click()
    expect(bufferRows()).toEqual([`${label} — orphan`])

    // STAGE 3 — retire it. The list dismisses first (`buffer-list.ts`'s order), so a row naming a buffer
    // that has gone is never left on screen.
    retireControl(label)?.click()
    expect(document.querySelector('.buffer-list')?.matches(':popover-open')).toBe(false)

    // **THE BUFFER IS GONE FROM THE HEADER — AND THE BUTTON NO LONGER WITHDRAWS, WHICH IS A REVERSAL —
    // 5d-iv T10.** This used to assert the button withdrew entirely rather than offering an empty list,
    // which was `main.ts`'s decision at the time and the same standard pane chrome applies elsewhere.
    // The menu is no longer ever empty (it offers "new TM buffer"), which removed the premise for that
    // decision along with the decision itself: the readout is the zero-buffer label, not an empty count,
    // and the control stays reachable exactly when a user with nothing to reclaim wants somewhere to
    // paste a `.tm` file.
    expect(button?.textContent).toBe('buffers ▾')
    expect(buffersDisplay()).not.toBe('none')

    // **AND THE KEYBOARD IS STILL SOMEWHERE — ON THE BUTTON ITSELF, WHICH IS ALSO A REVERSAL.** This
    // used to assert `#restore-layout`, because `#buffers` withdrew the instant the retire that had just
    // focused it: `hidePopover` gave focus back to the invoker, and the very next line then took that
    // invoker out of the tab order, so `main.ts` moved focus to `#restore-layout` deliberately rather
    // than strand it on `<body>`. `#buffers` is never withdrawn now, so `hidePopover`'s hand-back is the
    // whole of what places focus, with nothing after it to undo — the accessibility list's item 1, "a
    // control that hides itself on click strands the keyboard," retired by removing the hide rather than
    // by relocating the catch.
    expect(document.activeElement).toBe(button)

    // AND FROM EVERY PANE'S SELECTOR, which is the registry side of the same fact — design §5's
    // "retiring an orphan from the list removes it from every pane's selector", read off the TM pane
    // because the λ pane that was showing the buffer is the one this test closed.
    const options = [...document.querySelectorAll<HTMLOptionElement>('[data-leaf="tm-0"] .pane-binding option')]
    expect(options.length).toBeGreaterThan(0)
    expect(options.map((o) => o.textContent)).not.toContain(label)

    // **THE TWO LINES THAT BRACKETED THE CLOSE AND THE RETIRE ARE GONE, AND THE REASON IS A
    // MEASUREMENT.** They read `expect(editorNode.parentElement).not.toBeNull()` after STAGE 1 (held in
    // custody, not destroyed) and `.toBeNull()` here (the sweep destroyed it). That pair discriminated
    // only by accident: `destroy()` removes the node, and `takeEditor` used to LEAVE it parented in the
    // host it came from. `takeEditor` removes it now — it gained a caller whose pane survives the
    // handover (`pane-host.ts`'s rebind), where a node left behind stayed visible and editable over the
    // wrong buffer — so both states are parentless and the proxy stopped discriminating.
    //
    // **NOTHING IN THE DOM REPLACES IT.** Measured in Chromium across mounted / detached / destroyed,
    // all three states of a real `ScratchEditor`: `parentElement`, `isConnected`, `EditorView.findFromDOM`,
    // the presence of `.cm-content`, its `contenteditable`, `childElementCount` and `cmView` on the node
    // are IDENTICAL for detached and destroyed. `EditorView.destroy()` tears down the view without
    // clearing anything a query can reach. A replacement proxy would be the same mistake in a newer
    // spelling, so this tier stops claiming the destroy.
    //
    // WHERE IT IS COVERED INSTEAD: `tests/browser/editor-custody.test.ts`, over the real
    // `createEditorCustody`, on the one signal that does separate them — a destroyed editor's PENDING
    // DEBOUNCE never fires. That test retires a session with a keystroke in flight and waits out a real
    // multiple of the debounce window. It is a better assertion than this one ever was: it observes the
    // thing the destroy exists to prevent rather than a side effect of where a node sat.
  })
})
