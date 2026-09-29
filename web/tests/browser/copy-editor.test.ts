import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyEditor } from '../../src/copy-editor'
import type { PaneEvents } from '../../src/pane-chrome'
import type { CopyState } from '../../src/view-header'

/**
 * `CopyEditor`, the copy-editing part the TM and asm views share, built on its own for behaviours no view's test
 * reaches. Most of the copy control's three answers, the noun in its reason, the unmount on leaving a copy, the edits
 * following the view, and the outline are held by the views' own tests (`tm-pane-editor.test.ts`, `asm-pane.test.ts`,
 * `asm-copy.test.ts`, `tm-scratch-fork.test.ts`, `lsp-outline.test.ts` and their siblings).
 *
 * No view's test holds *format* withheld while there is no editor, only offered while there is one. And the app cannot
 * show a `takeEditor`'s unmount: a view that gives its editor up that way is reseeded or removed next (`pane-host.ts`'s
 * same-leg rebind arm and drop pass), which rewrites whatever the unmount cleared. So the part is asked directly.
 *
 * **NOR CAN THE APP SHOW A FUNCTION-VALUED PROGRAM WHOSE OWN TM MACHINE HAS ZERO δ RULES** — every one tried compiles
 * to a real, non-zero machine today (`session.rs`'s own sibling test), so the boundary `#refreshDetach` must still get
 * right (disabled with the function reason, not absent, regardless of `count`) is asked directly here too, through
 * `setForkAvailable` rather than a live compile.
 */
const events = (): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
  editSink: () => vi.fn(),
  collapse: vi.fn(),
})

/** A part in the page, with a menu that records what it was told and an unmount hook that counts. */
function build(): {
  copy: CopyEditor
  formattable: boolean[]
  claimable: boolean[]
  copyState: CopyState[]
  unmounts: () => number
} {
  const formattable: boolean[] = []
  const claimable: boolean[] = []
  const copyState: CopyState[] = []
  const onUnmount = vi.fn()
  const copy = new CopyEditor(events(), {
    menu: {
      setFormattable: (f) => formattable.push(f),
      setCopy: (s) => copyState.push(s),
      setClaim: (c) => claimable.push(c),
    },
    outlineOpen: false,
    noun: 'rules',
    onUnmount,
  })
  document.body.append(copy.textPanel, copy.outline)
  return { copy, formattable, claimable, copyState, unmounts: () => onUnmount.mock.calls.length }
}

describe('a copy editor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('offers format exactly while it holds an editor, from construction on', () => {
    const { copy, formattable } = build()
    expect(formattable.at(-1), 'no editor at construction').toBe(false)
    copy.setEditor('tapes 1\n')
    expect(formattable.at(-1), 'an editor mounted').toBe(true)
    const editor = copy.takeEditor()
    expect(formattable.at(-1), 'the editor taken').toBe(false)
    if (editor === null) throw new Error('takeEditor returned null for a part holding an editor')
    copy.receiveEditor(editor)
    expect(formattable.at(-1), 'an editor received').toBe(true)
    copy.setEditor(null)
    expect(formattable.at(-1), 'the editor unmounted').toBe(false)
  })

  /**
   * **A TAKE IS NOT AN UNMOUNT** — `CopyEditor.takeEditor`'s doc: a view giving its editor to another view of the copy
   * through *move the editor here* still shows the copy, and the TM view's unmount clears the copy's status.
   */
  it('calls onUnmount for every setEditor(null), and not for a take', () => {
    const { copy, unmounts } = build()
    copy.setEditor(null)
    expect(unmounts(), 'setEditor(null) with no editor').toBe(1)
    expect(copy.takeEditor()).toBeNull()
    expect(unmounts(), 'a take with nothing to take').toBe(1)
    copy.setEditor('tapes 1\n')
    const editor = copy.takeEditor()
    expect(editor).not.toBeNull()
    expect(unmounts(), 'a take that took one').toBe(1)
    editor?.destroy()
    copy.setEditor('tapes 1\n')
    copy.setEditor(null)
    expect(unmounts(), 'setEditor(null) with an editor').toBe(2)
  })

  /**
   * *Move the editor here* — `CopyEditor.#refreshClaim`: offered on a view showing a copy, holding no editor, while
   * another view holds one, and on no other, whatever route changed any of the three facts.
   */
  it('offers move the editor here exactly while it shows a copy, holds no editor, and another view holds one', () => {
    const { copy, claimable } = build()
    expect(claimable.at(-1), 'a view of the program, at construction').toBe(false)
    copy.setDetached(true)
    expect(claimable.at(-1), 'a view of a copy, with no editor here or elsewhere').toBe(false)
    copy.setEditorAvailable(true)
    expect(claimable.at(-1), 'a view of a copy, with the editor in another view').toBe(true)
    copy.setEditorAvailable(false)
    expect(claimable.at(-1), 'the other view’s editor gone').toBe(false)
    copy.setEditorAvailable(true)
    copy.setEditor('tapes 1\n')
    expect(claimable.at(-1), 'the editor mounted here').toBe(false)
    const editor = copy.takeEditor()
    expect(claimable.at(-1), 'the editor taken').toBe(true)
    if (editor === null) throw new Error('takeEditor returned null for a part holding an editor')
    copy.receiveEditor(editor)
    expect(claimable.at(-1), 'an editor received').toBe(false)
    copy.setDetached(false)
    expect(claimable.at(-1), 'a view moved to the program, its editor gone with it').toBe(false)
    copy.setDetached(true)
    expect(claimable.at(-1), 'back on a copy, with no editor').toBe(true)
  })

  /**
   * Plan 7 part 5c's final fix wave: `#refreshDetach`'s absence check used to be `forkText === null && count ===
   * 0` on its own, on the assumption a `null` text with a zero count could only be a declined leg. A
   * function-valued program's own TM machine can have as few δ rules as a declined leg has — zero — since
   * `count` is `ruleCount(program)` and nothing about a result type touches the machine's own size. This state
   * is built directly through `setForkAvailable` rather than through a live compile: `session.rs`'s own sibling
   * test measured every small function-valued program tried at 135 or 204 δ rules, never zero, but
   * `#refreshDetach` must not lean on that being permanent — `setForkAvailable`'s own contract allows this shape
   * regardless of what today's compiler happens to produce.
   */
  it('offers edit a copy disabled with the function reason for a zero-rule function-valued program, not absent', () => {
    const { copy, copyState } = build()
    copy.setForkAvailable(null, 0, false)
    expect(copyState.at(-1)).not.toBeNull()
    expect(copyState.at(-1)).toEqual({ reason: 'a function-valued program has no TM file a copy can run' })
  })

  /** The positive control for the test above: a declined leg — the one case `count === 0` still means absent. */
  it('offers no copy at all for a declined leg (null text, zero count, a decodable result)', () => {
    const { copy, copyState } = build()
    copy.setForkAvailable(null, 0, true)
    expect(copyState.at(-1)).toBeNull()
  })
})
