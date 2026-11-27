import type { EditorState, Extension } from '@codemirror/state'
import { Compartment } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { getCM, vim } from '@replit/codemirror-vim'
import { type KeymapMode, readKeymap, writeKeymap } from './editor-prefs'

/**
 * **WHAT A `Compartment` IS FOR** — Plan 7 part 3b task 6, Plan 7 part 3 spec §9.
 *
 * A CodeMirror state's extension set is fixed when the state is created. A `Compartment` is the one
 * exception: it reserves a slot in that set whose contents a later transaction can replace, so an
 * editor already on screen — with its document, its history, its selection and its focus — can change
 * which extensions it is running without being torn down and rebuilt. That is exactly what a keymap
 * SETTING needs: the user picks *vim* in the menu and the editor they are looking at answers to vim
 * from the next keystroke, keeping everything they have typed.
 *
 * **THE COLOURER IS NOT IN ONE, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT.** `colour.ts`'s
 * `treeSitterColour` also changes what it does after the editor is built — it paints nothing until its
 * grammar `.wasm` has loaded, then repaints everything. But it changes its OWN state, from inside a
 * `ViewPlugin` that is installed once and never replaced; nothing outside the editor ever needs to
 * swap it for a different extension. A compartment there would add a reconfiguration path with no
 * reconfigurer, and would invite a later reader to conclude that "loads asynchronously" is what
 * compartments are for. It is not: "is replaced from outside" is.
 *
 * **ONE `Compartment` INSTANCE FOR THE MODULE, WHICH IS SAFE AND IS NOT A SHARED
 * SETTING.** A `Compartment` is an identity token, not a container: each `EditorState` keeps its own
 * contents under it, and `reconfigure` is an effect dispatched into ONE view. What the shared token
 * buys is that any view built through `keymapSlot` can be reconfigured by `setKeymap` without the
 * caller having to have kept hold of the compartment that built it. The one rule it imposes is
 * CodeMirror's own — a single state may not mention the same compartment twice — and the source
 * editor has one keymap slot.
 */
const keymapCompartment = new Compartment()

/**
 * The extension `mode` installs: vim, or nothing at all.
 *
 * **THE EMPTY ARRAY IS THE POINT OF THE DEFAULT ARM.** `default` is not a second keymap this app
 * supplies; it is CodeMirror's own bindings, which the source editor already lists (`defaultKeymap`,
 * `historyKeymap` and its own). So the default keymap is what is left when vim contributes
 * nothing, and `[]` is a valid `Extension` that contributes exactly that.
 */
export const keymapExtension = (mode: KeymapMode): Extension => (mode === 'vim' ? vim() : [])

/**
 * The slot an editor being built puts in its extension list.
 *
 * **IT MUST COME BEFORE EVERY `keymap.of(...)` IN THAT LIST, NOT MERELY BEFORE THE DEFAULT ONE, AND
 * THE MECHANISM IS NOT THE ONE A KEYMAP'S PRECEDENCE RULES WOULD SUGGEST.** `@replit/codemirror-vim`
 * contributes no `keymap` at all: `vim()` is a `ViewPlugin` with a `keydown` handler (plus two themes
 * and a panel slot), so it competes with the keymap facet at the level of DOM event handlers rather
 * than of key bindings. CodeMirror runs those handlers in extension order and stops at the first that
 * returns true — and the facet's handler is a single shared `ViewPlugin` that `@codemirror/state`
 * places where the FIRST `keymap.of(...)` in the list appears, at default precedence, no matter how
 * many more follow it. The source editor opens its keymap with `navKeymap`, so a slot
 * placed just above `keymap.of([...defaultKeymap, ...historyKeymap])` would sit BELOW the handler that
 * runs the whole facet.
 *
 * **WHAT THAT COSTS.** `Escape`, which `defaultKeymap` binds to `simplifySelection`, cannot show the
 * difference either way: with an empty selection that command declines and passes the key on, and with
 * a selection it collapses it, which vim's own `update` hook reads as a selection change and leaves
 * visual mode for. The keys that DO show it are the ones `defaultKeymap` binds to an EDIT: with the slot
 * below the first `keymap.of(...)`, `Enter` and `Backspace` in normal mode type into the document where,
 * with the slot above, they leave it unchanged and move the cursor.
 *
 * Above all of them, vim gets first refusal on every key and passes on the ones it does not map: its
 * handler returns false for an unhandled key, so `F12`, `Shift-F12` and `Mod-'` still reach
 * `lsp-nav.ts` and the link binding. That is §9's rule — inside a focused editor in vim mode, vim
 * takes `Esc` and every normal-mode key, and the app's own shortcuts are the ones that carry a
 * modifier.
 *
 * **THAT RULE IS TRUE OF THE BINDINGS THAT EXIST TODAY, AND IS NOT A GENERAL GUARANTEE.** The slot sits
 * above every `keymap.of(...)`, so vim wins ANY key it maps for itself — including a modifier
 * combination, if vim binds one — not only the unmodified normal-mode keys this file's other examples
 * use. `F12` and `Shift-F12` in `lsp-nav.ts`'s `navKeymap`, and `Mod-'` in `main.ts`'s link binding,
 * happen not to collide because vim's normal mode does not bind them. A future `Mod-<letter>` binding is
 * not protected by the same reasoning: vim binds several `Ctrl`-prefixed keys in normal mode (`<C-c>`,
 * `<C-r>`, `<C-o>`, among others), and one of those chosen for a new app shortcut would lose to vim the
 * same way an unmodified key would. Anyone adding a binding should check it against vim's own bindings,
 * not assume "it has a modifier" is enough.
 */
export const keymapSlot = (mode: KeymapMode): Extension => keymapCompartment.of(keymapExtension(mode))

/** Whether `state`'s keymap slot holds vim: what the source editor says of Tab depends on it (`editor-tab.ts`). */
export const vimIn = (state: EditorState): boolean => {
  const slot = keymapCompartment.get(state)
  return slot !== undefined && !(Array.isArray(slot) && slot.length === 0)
}

/** Whether `view` answers to vim and is in its normal or visual mode, where Tab leaves the editor (`editor-tab.ts`). */
export const vimOutsideInsert = (view: EditorView): boolean => {
  const state = getCM(view)?.state.vim
  return state != null && !state.insertMode
}

/** Swap `view`'s keymap for `mode`'s, in place, keeping the document, history, selection and focus. */
export const setKeymap = (view: EditorView, mode: KeymapMode): void => {
  view.dispatch({ effects: keymapCompartment.reconfigure(keymapExtension(mode)) })
}

/**
 * The page's chosen keymap, and the editor that follows it.
 *
 * **THE SETTING REACHES INTO THE EDITOR RATHER THAN WAITING TO BE READ.** A compartment cannot be read lazily: the
 * new extension only takes effect when a transaction carrying `reconfigure` is dispatched INTO the view, so a change
 * of keymap has to be pushed to the editor. Hence `follow`, which the source editor joins once and never leaves, since
 * it lives as long as the page.
 */
export class KeymapSetting {
  #mode: KeymapMode
  #followers = new Set<EditorView>()

  /** Defaults to what storage says, which is what every caller but a test wants. */
  constructor(mode: KeymapMode = readKeymap()) {
    this.#mode = mode
  }

  /** The keymap in force — what an editor being built now should start in. */
  get mode(): KeymapMode {
    return this.#mode
  }

  /**
   * Take `view` under this setting: put it in the mode in force now, and keep it in step from here on.
   *
   * **IT RECONFIGURES ON JOINING RATHER THAN TRUSTING THE CALLER.** An editor's slot is filled from `this.mode`
   * when it is built, so the dispatch is usually a no-op; but a mode chosen between the build and the join would
   * otherwise leave the editor in the old one until the next time the user touched the control.
   */
  follow(view: EditorView): void {
    this.#followers.add(view)
    setKeymap(view, this.#mode)
  }

  /**
   * Choose `mode`: remember it, and switch the editor now on screen.
   *
   * A no-op when nothing changes, so re-selecting the current entry does not dispatch a transaction
   * into the editor.
   */
  set(mode: KeymapMode): void {
    if (mode === this.#mode) return
    this.#mode = mode
    writeKeymap(mode)
    for (const view of this.#followers) setKeymap(view, mode)
  }
}
