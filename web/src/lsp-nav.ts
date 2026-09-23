import type { EditorState } from '@codemirror/state'
import { activateHover, type KeyBinding } from '@codemirror/view'
import type { LspClient } from './lsp-client'
import type { LspLocation, LspPosition, LspRange } from './lsp-protocol'
import { offsetOf } from './lsp-text'

/**
 * Go to definition, and cycle through references — Plan 7 part 3a.
 *
 * **EVERY TARGET IS IN THE DOCUMENT THAT WAS ASKED ABOUT, AND THAT IS THE SERVER'S SHAPE RATHER THAN
 * AN ASSUMPTION.** `Server::definition` builds its `Location` from `params.text_document.uri` and
 * `references` does the same; `NameIndex` is built per document and there is no workspace index. So a
 * jump lands in the editor it was made from, always.
 *
 * **AN EARLIER DRAFT ROUTED JUMPS BY URI THROUGH THE CLIENT, SO THAT A TARGET IN ANOTHER VIEW COULD
 * BE REVEALED THERE — AND THAT PATH WAS UNREACHABLE.** The umbrella's §5.4 says "including jumps
 * across views", which reads as a cross-document jump and is not one the server can produce. The
 * routing, and the notice for a target no view was showing, were a guard for a case that cannot
 * arise — the shape this repository has paid for before as timeout ceilings that could never fire.
 * If the server ever gains a workspace-wide index, this is the file that grows the routing back.
 */

/** What a navigation needs from the app: where the caret is, and how to say what happened. */
export type NavContext = {
  /** The document being navigated FROM. */
  readonly uri: string
  /**
   * The editor's state, not the editor.
   *
   * **NOTHING HERE DISPATCHES, WHICH IS WHY A STATE IS ENOUGH** — the caret and the document are
   * all these two functions read, and landing the jump is `client.reveal`'s job. Taking a view
   * would also make every rule in this file need a DOM to exercise; taking a state lets the node
   * tier drive all of them.
   */
  readonly state: EditorState
  readonly client: Pick<LspClient, 'definition' | 'references'>
  /** Put the caret on a range in THIS editor — the only place a target can be. */
  readonly reveal: (range: LspRange) => void
  /** `notice.ts`'s `notify` — the one surface for "that did not go anywhere". */
  readonly notify: (text: string) => void
}

/** The caret, as an LSP position. `line` is zero-based; `character` counts UTF-16 code units. */
export function caretOf(state: EditorState): LspPosition {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  return { line: line.number - 1, character: head - line.from }
}

/**
 * Jump to the definition of whatever the caret is on.
 *
 * **`null` DOES NOTHING VISIBLE, AND IS NOT REPORTED.** It is the ordinary answer for a caret on a
 * keyword, a bracket, or whitespace — which is most of any document. A notice for it would fire
 * constantly and teach the user to ignore the notice line.
 */
export async function goToDefinition(ctx: NavContext): Promise<void> {
  let target: LspLocation | null
  try {
    target = await ctx.client.definition(ctx.uri, caretOf(ctx.state))
  } catch {
    return // The client reports an unavailable server once, for the server rather than per gesture.
  }
  if (target === null) return
  ctx.reveal(target.range)
}

/**
 * Move to the next reference to whatever the caret is on, wrapping at the end.
 *
 * **CYCLING RATHER THAN A LIST, BECAUSE A LIST IS A SURFACE AND THIS PART BUILDS NONE.** The outline
 * is the one new panel part 3a adds; a references panel would be a second, and the umbrella does not
 * ask for one. Pressing again moves on, and the notice says which of how many — so the count is
 * available without a place to put it.
 *
 * **IT ASKS ABOUT THE NAME UNDER THE CARET, SO THE CARET HAS TO BE ON ONE.** Pressing this on a
 * keyword or on whitespace does nothing at all, because there is no name to have references to —
 * the same silence `goToDefinition` keeps, and for the same reason. Once the caret is on a name,
 * each press moves to the next occurrence of it and the caret stays on a name, so the cycle
 * sustains itself.
 *
 * **"NEXT" IS RESOLVED AGAINST THE CARET, NOT A REMEMBERED INDEX.** A stored cursor would go stale
 * the moment the user moved, typed, or navigated somewhere else, and would have to be invalidated by
 * every one of those. Reading the caret makes repeated presses walk the list with no state at all.
 */
export async function goToNextReference(ctx: NavContext): Promise<void> {
  let all: LspLocation[]
  try {
    all = await ctx.client.references(ctx.uri, caretOf(ctx.state))
  } catch {
    return
  }
  if (all.length === 0) return

  // Ordered by position so "next" means next in the file rather than next in the server's order.
  const here = ctx.state.selection.main.head
  const sorted = [...all].sort((a, b) => keyOf(a) - keyOf(b))

  // The first reference strictly after the caret, or the first of all when the caret is past the
  // last one — which is what makes repeated presses wrap rather than stop.
  const next = sorted.find((l) => offsetOf(ctx.state.doc, l.range.start) > here) ?? sorted[0] ?? null
  if (next === null) return

  ctx.reveal(next.range)
  ctx.notify(`reference ${sorted.indexOf(next) + 1} of ${sorted.length}`)
}

/** Sort key for a location: line first, then character. */
function keyOf(l: LspLocation): number {
  return l.range.start.line * 100_000 + l.range.start.character
}

/**
 * The three navigation keys, for an editor that has a document.
 *
 * **`F12` AND `Shift-F12`, AND THE CHOICE WAS CHECKED RATHER THAN ASSUMED.** They are what every
 * other editor binds these to, and a scan of `defaultKeymap` and `historyKeymap` — 74 bindings —
 * found no F-key among them, so neither shadows anything CodeMirror already does. They also take no
 * modifier that vim's normal mode uses, which is the constraint part 3b inherits.
 *
 * **`F2` IS THE THIRD, AND IT LIVES HERE RATHER THAN BESIDE THE POINTER TOOLTIP IN `lsp-hover.ts`
 * SO ONE EDIT REACHES BOTH EDITORS.** Both editor construction sites already call this function to
 * build their keymap, so a binding added here is the only kind of edit that reaches both without a
 * second one somewhere else. See the binding itself for why `F2` is the key chosen.
 */
export function navKeymap(deps: {
  readonly uri: () => string | undefined
  readonly client: () => NavContext['client'] | undefined
  readonly reveal: (range: LspRange) => void
  readonly notify: (text: string) => void
}): KeyBinding[] {
  const contextFor = (state: EditorState): NavContext | null => {
    const uri = deps.uri()
    const client = deps.client()
    return uri === undefined || client === undefined
      ? null
      : { uri, state, client, reveal: deps.reveal, notify: deps.notify }
  }
  return [
    {
      key: 'F12',
      run: (view) => {
        const ctx = contextFor(view.state)
        if (ctx === null) return false
        void goToDefinition(ctx)
        return true
      },
    },
    {
      key: 'Shift-F12',
      run: (view) => {
        const ctx = contextFor(view.state)
        if (ctx === null) return false
        void goToNextReference(ctx)
        return true
      },
    },
    {
      // F2, and the choice was measured on both halves it has. Nothing in the app, CodeMirror or
      // vim swallows it — a probe pressed F1/F2/F4/F8/F9 through `userEvent` and all five reached
      // the editor. The other half a probe CANNOT show: Playwright injects keys through CDP at the
      // renderer, so browser-chrome bindings never apply in a test. F2 is chosen because Chromium
      // binds nothing to it, unlike F1, F3, F5, F6, F7, F10, F11 and F12.
      //
      // **THE FOURTH ARGUMENT IS NOT OPTIONAL, EVEN THOUGH ITS TYPE SAYS IT IS.** Calling
      // `activateHover` with none — as an earlier version of this binding did — does not mean "no
      // lock": CodeMirror's exported `activateHover` defaults a missing `until` to `() => false`,
      // and `() => false` is still a function, so `HoverPlugin.activateHover`'s `done()` locks the
      // tooltip unconditionally (it only skips the lock when `until` itself is falsy). A locked
      // tooltip is invisible to `mousemove`'s and `mouseleave`'s own auto-close, which both check
      // `!this.locked.has(active)` before doing anything, and `checkHover` refuses to run at all
      // while `this.active.length` is nonzero — so the omission does not just leave the F2 tooltip
      // open, it also stops the pointer tooltip from ever opening again in this editor. Measured by
      // pressing F2 once and then hovering: neither closes, for the rest of the page's life.
      //
      // **THE POLARITY BELOW WAS READ OFF THE VENDORED SOURCE, NOT GUESSED.** The state field
      // `hoverTooltip` builds reads `lock = locked.get(value)` and, whenever it has an active
      // tooltip, does `else if (lock && lock(tr)) value = []` — so `until` returning `true` is what
      // EMPTIES the field, i.e. `true` means "done, close it" and `false` means "still needed".
      // Reading it backwards closes the tooltip on the next transaction, which looks fixed in a
      // screenshot and fails the same way a moment later.
      //
      // The dismissing condition is any caret move or edit: `tr.selection !== undefined` covers a
      // click elsewhere or an arrow key, `tr.docChanged` covers typing. Emptying the field this way
      // is also what hands the pointer path (`lsp-hover.ts`'s `lspHover`) its ordinary hover loop
      // back — `tests/browser/lsp-hover.test.ts` proves the half reading the source cannot: that
      // pointer hover still runs after the dismissal.
      key: 'F2',
      run: (view) => {
        const head = view.state.selection.main.head
        activateHover(view, head, 1, { until: (tr) => tr.docChanged || tr.selection !== undefined })
        return true
      },
    },
  ]
}
