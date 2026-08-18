import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaneEvents } from '../../src/pane-chrome'
import { TmPane } from '../../src/tm-pane'
import type { TmProgram, TmState } from '../../src/types'

/**
 * Design §4.2/§4.1's split body, ported to the TM leg (5d-iv, Task 8): the editor mounted (or not)
 * above the tape rows and δ-table, which stay on the unchanged code path — see `TmPane`'s own doc on
 * `#body` for why the collapse is a class on THAT wrapper rather than on `#editorHost` the way
 * `LambdaPane`'s is.
 *
 * PANES ARE CONSTRUCTED DIRECTLY, matching `lambda-pane-editor.test.ts`'s own idiom: this is chrome and
 * body wiring built in the constructor and moved by `setEditor` directly, with nothing on the path to
 * it that needs `main()`.
 */
const host = (): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane'
  document.body.append(el)
  return el
}

/** `PaneEvents`'s members this pane's constructor reads, all inert — no test here clicks a transport
 * control. */
const events = (): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  rebind: vi.fn(),
  editScratch: vi.fn(),
  collapse: vi.fn(),
})

const mountPane = (): { pane: TmPane; host: HTMLElement } => {
  const el = host()
  const pane = new TmPane(el, events())
  return { pane, host: el }
}

/**
 * A machine small enough to compare by identity, modelled on `tests/node/replies.test.ts`'s own
 * `PROGRAM` fixture — one state, one rule, one tape.
 */
const PROGRAM: TmProgram = {
  states: [{ name: 'pc0', accept: false, rules: [{ read: ['a'], write: ['b'], moves: ['R'], next: 0 }] }],
  alphabet: ['a', 'b'],
  tapes: 1,
  width: 8,
  start: 0,
}

/** One configuration over `PROGRAM`'s single tape, modelled on `tests/node/tape.test.ts`'s `state` helper. */
const FRAME: TmState = {
  state: 0,
  step: 0,
  heads: [0],
  window_start: [0],
  window: [['a']],
  source_node: null,
  rule: 0,
}

const CONTROLS = {
  canRestart: true,
  canBack: false,
  canForward: true,
  canPlay: true,
  stepText: '0',
  continueLabel: null,
}

describe('the TM pane editor region', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('has no editor until one is set', () => {
    const { pane, host } = mountPane()
    expect(host.querySelector('.cm-editor')).toBeNull()
    pane.setEditor('tapes 1\nstart q0\n')
    expect(host.querySelector('.cm-editor')).not.toBeNull()
  })

  /**
   * REMOVED, NOT HIDDEN — the property `detachedBadge` states and this pane must share. `hidden` would
   * leave a live CodeMirror instance in the DOM holding a document and an update listener, and
   * "reattaching removes the editor" would have no single answer.
   */
  it('removes the editor when the pane reattaches', () => {
    const { pane, host } = mountPane()
    pane.setEditor('tapes 1\n')
    pane.setEditor(null)
    expect(host.querySelector('.cm-editor')).toBeNull()
  })

  /**
   * `.tm-row` DOES NOT EXIST — the brief's own sketch guessed at a class name. The δ-table's rows carry
   * `.state-row` (`TmPane`'s `#drawTable`), which is what "the table renderer below" names in design
   * §4.1's split-body note; `.tape` is the separate five-tape-row block above it.
   *
   * **`setProgram`/`render` RUN BEFORE THE CLICK, AND THAT IS THE FIX FOR A DEAD ASSERTION — Important
   * finding, review of Task 8.** The committed version never called either, so `#index` stayed `null`,
   * `#drawTable` returned early, and `rowsBefore` was 0 — `expect(0).toBe(0)` cannot fail for the reason
   * this test exists, and a renderer that wiped the whole table on collapse would still report 0. Priced
   * as its own class of defect one commit before this branch started (`dead-assertions`, #42). Seeding a
   * real program first is what makes `rowsBefore > 0`, so the equality afterwards is actually pinning
   * "collapsing does not disturb the table renderer's own path."
   */
  it('collapses by class and leaves the table renderer alone', () => {
    const { pane, host } = mountPane()
    pane.setEditor('tapes 1\n')
    pane.setProgram(PROGRAM, ['TAPE'])
    pane.render(FRAME, CONTROLS)
    const rowsBefore = host.querySelectorAll('.state-row').length
    expect(rowsBefore).toBeGreaterThan(0)
    host.querySelector<HTMLButtonElement>('button.collapse')?.click()
    expect(host.querySelector('.tm-pane')?.classList.contains('collapsed')).toBe(true)
    expect(host.querySelectorAll('.state-row').length).toBe(rowsBefore)
  })

  /**
   * **`header: false` IS SAID IN WORDS, NOT IN A COLOUR, AND `render` MUST NOT ERASE IT ON THE VERY NEXT
   * FRAME — Critical finding, review of Task 8.** The accessibility list's item 7 forbids colour carrying
   * state, and this is a fact nothing else in the app can tell the user: a headerless machine runs from
   * blank tapes at `MIN_FIELD_WIDTH` rather than from the input the user thinks they pasted.
   *
   * **THIS DRIVES THE REAL SEQUENCE, NOT A PREFIX OF IT.** The pre-fix version of this test called only
   * `setScratchStatus` and read `host.textContent` straight back — a call `render` never got a chance to
   * interfere with, since `render` is what a real page calls on every subsequent frame (`draw()` ->
   * `PaneSlot.render`). `resetLegs` clears history at compile time, so the very first render after a
   * `tm-scratch-compiled` reply is `render(null, …)` — the frame-null branch — which used to write `''`
   * unconditionally and erase the sentence before a single tape row was drawn. This test walks that exact
   * sequence: a reply, the frame-null render right after it, a first real frame, a later reply that fixes
   * the header, and a pane giving its editor up.
   */
  it('survives render across a reply, a first frame, a header fix, and an editor teardown', () => {
    const { pane, host } = mountPane()

    // 1. Immediately after a headerless scratch's `tm-scratch-compiled` reply, before any frame exists —
    // `render(null, …)` is what a real page draws in this gap, and the sentence must survive it.
    pane.setScratchStatus({ available: true, reason: '', width: 4, run: 'Running', header: false })
    pane.render(null, CONTROLS)
    expect(host.textContent).toMatch(/no header/i)
    expect(host.textContent).toMatch(/blank tapes/i)

    // 2. THE ASSERTION THAT FAILS ON THE COMMITTED CODE. Once a program and a frame exist, `render`'s
    // OTHER branch used to overwrite `#status` with only the per-frame line, dropping the sentence the
    // instant a tape moved. Both facts must be on screen together.
    pane.setProgram(PROGRAM, ['TAPE'])
    pane.render(FRAME, CONTROLS)
    expect(host.textContent).toMatch(/no header/i)
    expect(host.textContent).toContain(PROGRAM.states[0]?.name)
    expect(host.textContent).toContain(`width ${PROGRAM.width}`)

    // 3. A later reply that fixes the header must clear the sentence, and the per-frame line survives.
    pane.setScratchStatus({ available: true, reason: '', width: 64, run: 'Running', header: true })
    pane.render(FRAME, CONTROLS)
    expect(host.textContent).not.toMatch(/no header/i)
    expect(host.textContent).toContain(PROGRAM.states[0]?.name)

    // 4. A pane that gives its editor up must stop narrating a scratch it no longer shows — the same
    // fabricated-state defect `LambdaPane.setDetached`'s own doc records, pointed the other way.
    pane.setScratchStatus({ available: true, reason: '', width: 4, run: 'Running', header: false })
    pane.setEditor(null)
    pane.render(FRAME, CONTROLS)
    expect(host.textContent).not.toMatch(/no header/i)
  })

  /**
   * `EditablePane`'s other three members, exercised the way `editor-custody.ts`'s `reconcileEditors`
   * actually calls them — `takeEditor` on the pane giving the editor up, `receiveEditor` on the pane
   * gaining it, and `holdsEditor` answering the question `takeEditor` would otherwise have to answer
   * destructively. `LambdaPane`'s own `receiveEditor` doc has the argument for the throw below.
   */
  describe('moving the editor between panes', () => {
    it('holds nothing, and takes nothing, before an editor is set', () => {
      const { pane, host } = mountPane()
      expect(pane.holdsEditor()).toBe(false)
      expect(pane.takeEditor()).toBeNull()
      expect(host.querySelector('.cm-editor')).toBeNull()
    })

    it('takeEditor moves the live view to receiveEditor without duplicating it', () => {
      const a = mountPane()
      const b = mountPane()
      a.pane.setEditor('tapes 1\n')
      expect(a.pane.holdsEditor()).toBe(true)

      const editor = a.pane.takeEditor()
      if (editor === null) throw new Error('takeEditor returned null for a pane holding an editor')
      expect(a.pane.holdsEditor()).toBe(false)
      expect(a.host.querySelector('.cm-editor')).toBeNull()

      b.pane.receiveEditor(editor)
      expect(b.pane.holdsEditor()).toBe(true)
      expect(b.host.querySelectorAll('.cm-editor').length).toBe(1)
      // THE SAME VIEW MOVED, IT WAS NOT REBUILT — the whole point of the handover.
      expect(b.host.querySelector('.cm-content')?.textContent).toContain('tapes 1')
    })

    it('receiveEditor throws rather than absorbing a second editor', () => {
      const a = mountPane()
      const b = mountPane()
      a.pane.setEditor('tapes 1\n')
      b.pane.setEditor('tapes 2\n')
      const editor = a.pane.takeEditor()
      if (editor === null) throw new Error('takeEditor returned null for a pane holding an editor')
      expect(() => b.pane.receiveEditor(editor)).toThrow()
    })

    /**
     * **THE EDITS FOLLOW THE VIEW — `LambdaPane.receiveEditor`'s own fix, ported.** A `ScratchEditor` is
     * built closing over the pane that FORKED it; without re-pointing `editor.onEdit`, a keystroke typed
     * into the MOVED editor would still report through pane A's handler rather than pane B's.
     */
    /**
     * `try`/`finally` AROUND THE FAKE-TIMER PAIR — Minor finding, review of Task 8. The sibling
     * `describe` below installs and tears down fake timers through `beforeEach`/`afterEach`, which runs
     * `vi.useRealTimers()` even when an assertion in between throws; this test called both directly with
     * no such guarantee, so a failing assertion here would leak fake timers into every test that runs
     * after it in this file.
     */
    it('re-points a moved editor onto the receiving pane, not the one that built it', () => {
      vi.useFakeTimers()
      try {
        const onEditA = vi.fn()
        const onEditB = vi.fn()
        const hostB = host()
        const a = new TmPane(host(), { ...events(), editScratch: onEditA })
        const b = new TmPane(hostB, { ...events(), editScratch: onEditB })
        a.setEditor('tapes 1\n')
        const editor = a.takeEditor()
        if (editor === null) throw new Error('takeEditor returned null for a pane holding an editor')
        b.receiveEditor(editor)

        const editorHost = hostB.querySelector<HTMLElement>('.term-editor')
        if (editorHost === null) throw new Error('the moved editor was not mounted on the receiving pane')
        const view = EditorView.findFromDOM(editorHost)
        if (view === null) throw new Error('no CodeMirror view mounted on the moved editor')
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'tapes 2\n' } })
        vi.advanceTimersByTime(300)

        expect(onEditB).toHaveBeenCalledWith('tapes 2\n')
        expect(onEditA).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  /**
   * The re-seed branch (`setEditor` called again while an editor is already mounted) and the debounced
   * `editScratch` callback — both unreachable from the tests above, and both real behaviour rather than
   * padding: `ScratchBuffers.recompile` reseeds a live editor on every warm/cool cycle, and a keystroke
   * is the whole reason this pane offers an editor at all.
   *
   * `EditorView.findFromDOM` PLUS A REAL CHANGE TRANSACTION, NOT `setEditor` A SECOND TIME —
   * `scratch-editor.test.ts`'s own file doc has the argument: `setText` sets a `#seeding` flag for the
   * duration of its dispatch specifically so a re-seed is never mistaken for a keystroke, so simulating
   * a keystroke with it would report zero recompiles instead of one.
   */
  describe('editing and re-seeding a mounted editor', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('re-seeds the same editor rather than mounting a second one', () => {
      const { pane, host } = mountPane()
      pane.setEditor('tapes 1\n')
      pane.setEditor('tapes 2\n')
      expect(host.querySelectorAll('.cm-editor').length).toBe(1)
      expect(host.querySelector('.cm-content')?.textContent).toContain('tapes 2')
    })

    it('reports a debounced keystroke through PaneEvents.editScratch', () => {
      const onEdit = vi.fn()
      const el = host()
      const pane = new TmPane(el, { ...events(), editScratch: onEdit })
      pane.setEditor('tapes 1\n')
      const editorHost = el.querySelector<HTMLElement>('.term-editor')
      if (editorHost === null) throw new Error('the editor region was not mounted')
      const view = EditorView.findFromDOM(editorHost)
      if (view === null) throw new Error('no CodeMirror view mounted under the editor region')
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'tapes 2\n' } })
      vi.advanceTimersByTime(300)
      expect(onEdit).toHaveBeenCalledWith('tapes 2\n')
    })
  })
})
