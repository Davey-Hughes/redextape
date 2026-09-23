import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { lintGutter, setDiagnostics as setCmDiagnostics } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import init, { captureClasses, encodings, tokenClasses } from '../../pkg/redextape_wasm.js'
import { addViewItems, presetName, wireMenu, workspaceItems } from './app-header'
import {
  APPEARANCE_LABEL,
  type Appearance,
  applyAppearance,
  nextAppearance,
  readStored,
  STORAGE_KEY,
} from './appearance'
import { showBanner } from './banner'
import { bufferList } from './buffer-list'
import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from './buffers-store'
import { type CaptureTable, classMapFrom, createGrammarRegistry, treeSitterColour } from './colour'
import { createCompile } from './compile'
import { lspLintRanges } from './diagnostics'
import { createDraw } from './draw'
import { createEditorCustody } from './editor-custody'
import { KeymapSetting, keymapSlot } from './editor-keymap'
import { KEYMAP_LABEL, KEYMAP_MODES, parseKeymapMode, readFormatOnBlur, writeFormatOnBlur } from './editor-prefs'
import { declineMark, focusMark, linkMark } from './highlight'
import { History } from './history'
import { icon } from './icons'
import type { LambdaPane } from './lambda-pane'
import { closeLeaf, defaultLayout, LAYOUT_STORAGE_KEY, type LayoutNode, leaves, SOURCE_LEAF } from './layout'
import { createLinkWiring, type LinkWiring } from './link-wiring'
import { LspClient } from './lsp-client'
import { lspHover } from './lsp-hover'
import { navKeymap } from './lsp-nav'
import type { LanguageId } from './lsp-protocol'
import { documentUri, LANGUAGE_LABEL } from './lsp-protocol'
import { applyEdits, revealRange } from './lsp-text'
import { createNotices } from './notice'
import { createOutlinePanel } from './outline'
import type { PaneChoice } from './pane-chrome'
import { createPaneHost, type LayoutEvent } from './pane-host'
import { createPanel } from './panel'
import { type LeafId, PaneCollection } from './panes'
import type { RunReply } from './protocol'
import { HISTORY_BYTES } from './protocol'
import { createReadout, type ProgramResult } from './readout'
import { createReplies } from './replies'
import { BufferCapReached, type BufferRecord, MAX_WARM_BUFFERS, ScratchBuffers } from './scratch'
import { type SessionId, SessionPool } from './session-client'
import { legControlState, SessionRegistry } from './sessions'
import {
  applySkin,
  PALETTE_CHOICE_LABELS,
  PALETTE_CHOICES,
  PALETTE_CSS_KEY,
  PALETTE_KEY,
  readPaletteChoice,
  readStyle,
  STYLE_IDS,
  STYLE_KEY,
  STYLE_LABELS,
} from './skin'
import { type BarTarget, barTarget, createStepBar } from './step-bar'
import type { TmPane } from './tm-pane'
import { createTransport } from './transport'
import type { LambdaState, TmState } from './types'
import { assertTokenClasses } from './types'
import { pairLabel, sourceViewHeader, viewMenu } from './view-header'
import {
  defaultFocus,
  defaultWorkspace,
  PRESETS,
  parseSwitches,
  parseWorkspace,
  presetOf,
  type Speed,
  type Switches,
  serializeWorkspace,
  type Workspace,
  withPanel,
} from './workspace'

const SAMPLE = 'let x = 40; x + 2'

/**
 * The counter behind every `LeafId` a split mints, shared across both legs — module-level rather than
 * per call to `main()`, though `main()` only ever runs once (`ready` below is computed on import).
 *
 * STARTS AT 1 ONLY FOR THE TREE A FRESH PAGE SHIPS, whose leaves are already `lambda-0` and `tm-0`.
 * **REASONING ONLY ABOUT `defaultLayout()` COSTS THE FIRST SPLIT AFTER EVERY RELOAD**: `main()` restores a
 * tree from `localStorage` when there is one, that tree can already contain `pane-1` from a split in an
 * earlier page load, and `splitLeaf`'s collision guard then refuses the id `nextLeafId` mints — an uncaught
 * throw out of the click handler, no new pane, and nothing on screen to say why. `seedLeafCounter` below is
 * what makes the starting value a fact about the tree actually in hand rather than about the one a fresh page
 * would have had.
 *
 * For what this doc used to claim and why it changed, see the history note under `leafCounter`.
 */
let leafCounter = 1

/**
 * Advance `leafCounter` past every numeric suffix in `tree` — called once, on the tree `main()` starts
 * with, whether that came from storage or from `defaultLayout()`.
 *
 * FIX THE CALLER, NOT THE GUARD. `splitLeaf`'s refusal of an id already in the tree is deliberate and
 * correct (its own doc: a duplicate id would not error, it would silently make the second leaf
 * unreachable) — the bug was minting a colliding id, not detecting one.
 *
 * MAX-PLUS-ONE OVER ALL LEAVES, NOT PER LEG, because the counter is shared across legs: a tree holding
 * `lambda-3` makes `tm-3` unmintable too, since the next `tm` split would take suffix 3 only if the
 * counter were still below it. A leaf id with no numeric suffix (`'source'`, or anything a hand-edited
 * `localStorage` entry carries — `parseLayout` accepts any non-empty string as an id) contributes
 * nothing rather than `NaN`: `Number('source')` is `NaN`, and `Number.isInteger` rejects it, so the
 * counter is left where it was. THIS DOES NOT GUARANTEE FREEDOM FROM COLLISION FOR AN ARBITRARY STORED
 * TREE — a hand-written id of `lambda-x` is not a suffix this can step past — but every id this app
 * itself mints is `${leg}-${n}`, and `splitLeaf`'s guard is still the backstop for the rest.
 */
function seedLeafCounter(tree: LayoutNode): void {
  for (const leaf of leaves(tree)) {
    const suffix = Number(leaf.id.slice(leaf.id.lastIndexOf('-') + 1))
    if (Number.isInteger(suffix) && suffix >= leafCounter) leafCounter = suffix + 1
  }
}

/**
 * The id a split mints for the new leaf it creates.
 *
 * `pane-${n}`, NOT `${leg}-${n}`, AND THE OLD SPELLING WAS A LIE THIS SLICE MADE VISIBLE. A leaf
 * minted as `lambda-3` that later renders a δ-table carries a name describing something it is not —
 * in the tree, in `localStorage`, and in `data-leaf`, which browser tests select on. `panes.ts`'s
 * `LeafId` already declares the id opaque ("a leaf's stable identity"), so the prefix was a convenience rather
 * than a fact, and a pane that can change leg is what falsifies it.
 *
 * `defaultLayout()`'s LITERAL `lambda-0` / `tm-0` ARE LEFT ALONE, for three reasons and none of them
 * is inertia: browser tests select on them, `reset preset`'s re-minting of exactly those ids is what
 * `applyLayout`'s claim-dropping line reasons about, and `seedLeafCounter` reads the digits after the
 * last `-` and does not care which word precedes them. `dataset.kind` is the truthful statement of
 * what a leaf renders.
 */
function nextLeafId(): LeafId {
  return `pane-${leafCounter++}`
}

/**
 * The `LeafId` of the sibling that absorbs a closed leaf's space.
 *
 * THE PREVIOUS LEAF IN `leaves(tree)` ORDER, OR THE NEXT IF THE CLOSED ONE WAS FIRST — the same
 * left-to-right, depth-first order `leaves` itself promises (and tab order follows), so this is "the
 * pane now sitting where the closed one used to be" rather than an arbitrary sibling.
 */
function neighbourOf(tree: LayoutNode, id: LeafId): LeafId | null {
  const ids = leaves(tree).map((l) => l.id)
  const i = ids.indexOf(id)
  if (i === -1) return null
  return ids[i - 1] ?? ids[i + 1] ?? null
}

async function main(): Promise<EditorView> {
  const results = document.querySelector<HTMLElement>('#results')
  const editorHost = document.querySelector<HTMLElement>('#editor')
  const stepBarHost = document.querySelector<HTMLElement>('#step-bar')
  const linkStatusHost = document.querySelector<HTMLElement>('#link-status')
  const picker = document.querySelector<HTMLSelectElement>('#encoding')
  const appearanceButton = document.querySelector<HTMLButtonElement>('#appearance')
  const workspaceButton = document.querySelector<HTMLButtonElement>('#workspace')
  const workspaceMenu = document.querySelector<HTMLElement>('#workspace-menu')
  const resetPresetButton = document.querySelector<HTMLButtonElement>('#reset-preset')
  const addViewButton = document.querySelector<HTMLButtonElement>('#new-view')
  const addViewMenu = document.querySelector<HTMLElement>('#new-view-menu')
  const settingsButton = document.querySelector<HTMLButtonElement>('#settings')
  const settingsMenu = document.querySelector<HTMLElement>('#settings-menu')
  const appearanceChoice = document.querySelector<HTMLSelectElement>('#appearance-choice')
  const formatOnBlurBox = document.querySelector<HTMLInputElement>('#format-on-blur')
  const keymapChoice = document.querySelector<HTMLSelectElement>('#keymap')
  const styleSelect = document.querySelector<HTMLSelectElement>('#style')
  const paletteSelect = document.querySelector<HTMLSelectElement>('#palette')
  /**
   * THE COPIES MENU'S BUTTON — spec §6's `copies N ▾`, queried here exactly as `#appearance` and
   * `#reset-preset` are, because `bufferList` takes a button rather than building one (its own doc).
   * The id stays `#buffers`: `buffer` is an internal name and spec §12 keeps those.
   *
   * **NO `aria-label`, WHERE `2026-08-13-plan5d-ii-c-scratch-buffers.md`'s MARKUP CARRIED
   * `aria-label="scratch buffers"`.** An `aria-label` REPLACES an element's contents as its accessible
   * name, and the contents here are the readout: `bufferList.update` writes `copies 3 ▾` into them
   * at every moment the count changes,
   * precisely so the header states how many copies exist while the menu is closed. A label naming the
   * control and not the count would make that readout inaudible to the one reader who cannot see it —
   * the opposite of what an icon-only button's label does (`view-header.ts`'s `⋯` and `✕`; umbrella §4
   * rule 1), which SUPPLIES a name to a glyph that has none rather than hiding one the control is
   * already stating. `aria-haspopup`/`aria-expanded` (both `bufferList`'s) are what announce that it
   * opens something.
   */
  const buffersButton = document.querySelector<HTMLButtonElement>('#buffers')
  const noticeHost = document.querySelector<HTMLElement>('#notice')
  const liveHost = document.querySelector<HTMLElement>('#live')
  // **`#views`, NOT `<main>` — spec §9.** `renderLayout` opens with `root.replaceChildren()`, so the
  // layout tree needed a root of its own the moment the inspector column came to live in `<main>` beside
  // it: an inspector directly under `<main>` would be destroyed on the first layout commit.
  const root = document.querySelector<HTMLElement>('#views')
  const inspectorHost = document.querySelector<HTMLElement>('#inspector')
  const strip = document.querySelector<HTMLElement>('footer.strip')
  if (
    !results ||
    !editorHost ||
    !linkStatusHost ||
    !picker ||
    !appearanceButton ||
    !workspaceButton ||
    !workspaceMenu ||
    !resetPresetButton ||
    !addViewButton ||
    !addViewMenu ||
    !settingsButton ||
    !settingsMenu ||
    !appearanceChoice ||
    !formatOnBlurBox ||
    !keymapChoice ||
    !styleSelect ||
    !paletteSelect ||
    !buffersButton ||
    !noticeHost ||
    !stepBarHost ||
    !inspectorHost ||
    !strip ||
    !liveHost ||
    !root
  ) {
    throw new Error('the page is missing a mount point')
  }

  // THE NOTICE LINE AND THE LIVE REGION (Plan 7 part 2 spec §11) — built before `init()`, because it
  // touches nothing but the DOM, so every refusal from here on has somewhere to go.
  // THE FALLBACK IS THE COPIES BUTTON: the line's one action is *undo*, and a user whose undo went away
  // — expired, or replaced by another gesture's notice — is looking at the copies it was about.
  const notices = createNotices(noticeHost, liveHost, () => buffersButton)

  // Wired BEFORE `init()`, unlike everything below it. The toggle has nothing to do with wasm — it
  // reads and writes `localStorage` and flips an attribute on `<html>` — so it stays live even on the
  // one failure path (`showBanner` below) that replaces `<main>` and leaves the header bar standing.
  //
  // `localStorage` ACCESS IS GUARDED, same as `index.html`'s inline script and for the same reason:
  // it throws in some privacy modes. Unguarded here it would be worse than in that script, not the
  // same — this runs before the `init()` try/catch below, so an uncaught throw would reject `ready`
  // itself and blank the page before any banner could report why.
  const readAppearanceStorage = (): string | null => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  }
  const writeAppearanceStorage = (a: string): void => {
    try {
      localStorage.setItem(STORAGE_KEY, a)
    } catch {
      // Nothing to do — the toggle still works for the rest of this page load, it just will not
      // survive a reload. The same tradeoff the inline script in `index.html` makes.
    }
  }

  let appearance = readStored(readAppearanceStorage())
  /** The language server. Assigned below, before any pane can resolve `lspDocument`. */
  let lspClient: LspClient
  /** The settings menu's `format on blur`, read at every blur. */
  let formatOnBlur = readFormatOnBlur()
  // THE TOGGLE SHOWS ITS STATE IN A WORD, BESIDE THE GLYPH (Plan 7 part 2 spec §6) — the word is its
  // accessible name, and `aria-label` is removed so the two cannot disagree. `☀`/`☾` are drawn (Hack lacks
  // them); `◐` stays text.
  const glyphFor = (a: Appearance): Node => {
    if (a === 'light') return icon('sun')
    if (a === 'dark') return icon('moon')
    // **`◐` IS TEXT, SO IT HAS TO BE HIDDEN FROM THE NAME EXPLICITLY.** The two drawn glyphs are `icons.ts`
    // SVGs, which carry `aria-hidden` of their own; a bare text node would join the word and make the
    // button's accessible name `◐system`, which is the word plus a character no reader can say. The
    // controls gate reads the name with `dom-accessibility-api`, which honours this.
    const el = document.createElement('span')
    el.setAttribute('aria-hidden', 'true')
    el.textContent = APPEARANCE_LABEL[a].glyph
    return el
  }
  const relabelAppearance = () => {
    const { word, label } = APPEARANCE_LABEL[appearance]
    appearanceButton.replaceChildren(glyphFor(appearance), document.createTextNode(word))
    appearanceButton.title = label
    appearanceButton.removeAttribute('aria-label')
    appearanceChoice.value = appearance
  }
  for (const a of ['system', 'light', 'dark'] as const) appearanceChoice.append(new Option(APPEARANCE_LABEL[a].word, a))
  const setAppearance = (next: Appearance): void => {
    appearance = next
    applyAppearance(document.documentElement, appearance)
    writeAppearanceStorage(appearance)
    relabelAppearance()
  }
  applyAppearance(document.documentElement, appearance)
  relabelAppearance()
  appearanceButton.addEventListener('click', () => setAppearance(nextAppearance(appearance)))

  formatOnBlurBox.checked = formatOnBlur
  formatOnBlurBox.addEventListener('change', () => {
    formatOnBlur = formatOnBlurBox.checked
    writeFormatOnBlur(formatOnBlur)
  })

  /**
   * **THE KEYMAP SETTING — Plan 7 part 3b, design §9.** Built here, beside the settings that already
   * live in this menu, and before `createTransport` below, because every editor the transport builds
   * joins it at construction.
   *
   * **THE OPTIONS ARE WRITTEN IN JavaScript, LIKE `appearanceChoice`'s AND THE TWO SKIN SELECTS',
   * RATHER THAN IN `index.html`.** The words a control offers and the values it stores are the same
   * fact; writing them twice is how the two drift, and `KEYMAP_LABEL` is the one place either can be
   * changed. `<select>` also takes its accessible name from the `<label>` wrapping it in the markup,
   * which is what the controls gate checks it against.
   */
  const keymapSetting = new KeymapSetting()
  for (const m of KEYMAP_MODES) keymapChoice.append(new Option(KEYMAP_LABEL[m], m))
  keymapChoice.value = keymapSetting.mode
  keymapChoice.addEventListener('change', () => {
    keymapSetting.set(parseKeymapMode(keymapChoice.value))
  })

  /**
   * **BUILT HERE, BEFORE ANY PANE EXISTS, AND THE POSITION IS LOAD-BEARING.** `transport.ts`'s
   * `lspDocument` thunk reads this to hand every copy's editor its client, and a pane can resolve
   * that thunk while it is still being CONSTRUCTED: `TmPane` syncs the controls that need an editor,
   * which refreshes its outline, which asks for symbols. With a restored workspace whose outline
   * panel was left open, that happens on the first frame of the page.
   *
   * Built after the editor instead — which is where this sat, because the source document's
   * diagnostics sink needs `view` — it was still `undefined` at that moment, and the page threw
   * `Cannot read properties of undefined (reading 'documentSymbols')` before it finished loading. No
   * test saw it: every one of them starts with empty storage, so no panel is ever restored open.
   * Found by reloading the built app after clicking around in it.
   *
   * Only `openDocument` needs `view`, and it stays below where `view` exists.
   */
  lspClient = new LspClient(
    () => new Worker(new URL('./lsp-worker.ts', import.meta.url), { type: 'module' }),
    (text) => notices.notify(text),
  )
  lspClient.start()
  appearanceChoice.addEventListener('change', () => setAppearance(readStored(appearanceChoice.value)))
  // THE SETTINGS MENU, wired before `init()` with the toggle, for the toggle's own reason.
  wireMenu(settingsButton, settingsMenu)
  settingsButton.replaceChildren(icon('settings'), document.createTextNode('settings'))

  // THE STYLE AND PALETTE (Plan 7 part 1, spec §6), wired before `init()` for the appearance toggle's
  // reason: they touch nothing but storage and `<html>`, so they stay live on the startup-failure path.
  // Storage is guarded for the same reason too.
  const readSkinStorage = (key: string): string | null => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  const writeSkinStorage = (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // The choice still holds for this page load; it just will not survive a reload.
    }
  }
  for (const id of STYLE_IDS) styleSelect.append(new Option(STYLE_LABELS[id], id))
  for (const id of PALETTE_CHOICES) paletteSelect.append(new Option(PALETTE_CHOICE_LABELS[id], id))
  let style = readStyle(readSkinStorage(STYLE_KEY))
  let paletteChoice = readPaletteChoice(readSkinStorage(PALETTE_KEY))
  styleSelect.value = style
  paletteSelect.value = paletteChoice
  // Every apply refreshes the pre-paint cache, so the next load's first frame is this one.
  const applyChosenSkin = (): void => {
    writeSkinStorage(PALETTE_CSS_KEY, applySkin(document.documentElement, style, paletteChoice))
  }
  applyChosenSkin()
  styleSelect.addEventListener('change', () => {
    style = readStyle(styleSelect.value)
    writeSkinStorage(STYLE_KEY, style)
    applyChosenSkin()
  })
  paletteSelect.addEventListener('change', () => {
    paletteChoice = readPaletteChoice(paletteSelect.value)
    writeSkinStorage(PALETTE_KEY, paletteChoice)
    applyChosenSkin()
  })

  // THE ONE PLACE THE APP CAN FAIL TO START. `init()` fetches the wasm; a worker constructed against
  // a missing module fails the same way. PR 3c had no surface for either and the failure was a blank
  // page.
  try {
    await init()
  } catch (e) {
    showBanner(root, e)
    throw e
  }

  // Checked once, here, immediately after the module is live. See `assertTokenClasses`.
  assertTokenClasses(tokenClasses() as string[])

  /**
   * **THE COLOURER'S TWO APP-WIDE VALUES, BUILT BEFORE ANYTHING THAT CONSTRUCTS AN EDITOR, AND THE
   * POSITION IS LOAD-BEARING FOR THE REASON `lspClient` ABOVE RECORDS.** Every editor on the page takes
   * a colourer resolved through `transport.ts`'s `events`, and a pane can resolve that while it is
   * still being CONSTRUCTED — with a restored workspace whose outline panel was left open, on the first
   * frame of the page. `lspClient` shipped exactly that defect one task ago: it was a `let` assigned
   * after the editor was built, and a restored panel reached the thunk before the value existed, so the
   * page threw before it finished loading and no test saw it (every test starts with empty storage).
   * These are `const`s above every construction site instead, which is the same fix stated as an
   * ordering rather than as a repair.
   *
   * **AFTER `await init()`, WHICH IS WHY THIS IS NOT BESIDE `lspClient` ITSELF.** `captureClasses()` is
   * a wasm export; called before the module is live it throws. `init()` is the line above the token
   * check, and everything that builds an editor is below this one, so this is the whole of the window
   * both constraints leave.
   *
   * ONE REGISTRY FOR THE PAGE, so a grammar is fetched once rather than once per view — and a FAILED
   * fetch is remembered as a failure, which is what keeps one broken `.wasm` from producing a notice per
   * editor (`createGrammarRegistry`'s own doc, design §10).
   */
  const captureTables = classMapFrom(captureClasses() as CaptureTable[])
  const grammars = createGrammarRegistry({
    onFailure: (id, reason) => notices.notify(`${LANGUAGE_LABEL[id]} is showing uncoloured: ${reason}`),
    // THE SHARED RUNTIME, SO THE SENTENCE IS NOT A LANGUAGE'S — `createGrammarRegistry`'s own doc has
    // the mechanism. One `web-tree-sitter.wasm` that will not fetch leaves every editor uncoloured, and
    // saying that once is both what design §10 asks for and what is true; three per-language notices
    // for one cause were neither.
    onRuntimeFailure: (reason) => notices.notify(`every editor is showing uncoloured: ${reason}`),
  })
  /**
   * One colourer per editor, over the one registry and the one class map.
   *
   * **THE CEILING NOTICE IS WIRED HERE AND THIS IS THE ONLY PLACE THAT BUILDS A COLOURER.** Design §10
   * gives a document over `COLOUR_CEILING_UNITS` one notice saying which editor is uncoloured — the row
   * promised "no colour and no diagnostics" until the diagnostics path was measured at 135.2 ms in a
   * worker at that size, a lag rather than a freeze, so only the colour half exists and the notice below
   * says only that. `ColourOptions.onCeiling` was the hook for it — declared, invoked, and passed by
   * neither of the two `treeSitterColour` calls this file used to make, so the notice existed in the
   * design and nowhere else. The source editor's call site now goes through this function rather than
   * spelling the same fields out, which is what keeps "both call sites" from being a thing that can
   * drift again; `onCeiling` is required on the type, so a third one cannot be built without it.
   *
   * THE WORDS ARE `onFailure`'s ABOVE, one clause changed. Both sentences say the same thing about the
   * same editor and differ only in why, which is the umbrella's rule that every user-visible word is
   * already the app's.
   */
  const colourFor = (languageId: LanguageId) =>
    treeSitterColour({
      languageId,
      registry: grammars,
      classes: () => captureTables,
      onCeiling: (id) =>
        notices.notify(`${LANGUAGE_LABEL[id]} is showing uncoloured: this document is too large to colour`),
    })

  for (const name of encodings() as string[]) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    picker.append(opt)
  }

  let view: EditorView
  /** The source editor's document. Per view, never fetched, never parsed — see `documentUri`. */
  const SOURCE_URI = documentUri(SOURCE_LEAF, 'redextape')

  /**
   * THE SESSION REGISTRY — the container design §3.2b says decision 1 presupposes.
   *
   * IT IS A `SessionRegistry` FROM `sessions.ts`, NOT A `Map` DECLARED HERE, AND THE REASON THE REGISTRY IS A
   * MODULE IS A TEST: HOW MANY SESSIONS A FORK PRODUCES is asserted on pool size, which no DOM query reaches
   * regardless of how many panes exist to watch it. A registry that is a module is a registry a test can put
   * two sessions in. `SessionRegistry`'s own doc carries the argument in full. 5d-ii-c decision 1 changed the
   * number that assertion expects — a fork mints a buffer per call rather than reusing one — and left the
   * axis exactly where 5d-i put it.
   *
   * For what this doc used to claim and why it changed, see the history note under `sessions`.
   */
  const sessions = new SessionRegistry()

  /**
   * The session compiled from the editor's text — the only one that exists today, and the only one
   * that will ever have a `SourceMap` behind it (§3.3: `linkIndex` and `sourceSpan` exist on neither
   * scratch type).
   */
  const SOURCE_SESSION: SessionId = 'source'

  // **THE λ SCRATCH ID AND LABEL USED TO BE DECLARED HERE, AND THEY ARE NOT ANY MORE.**
  // 5d-ii-c decision 1 makes a fork mint a buffer per call, so there is no fixed name for this
  // file to write down before the session exists — `ScratchBuffers.fork` mints id and label together,
  // and `SessionEntry.label`'s doc draws the line where it was always really drawn: a session is
  // named where it is CREATED, never in the registry that holds it.
  //
  // THE LABEL IS STILL WHAT THE TITLE-SELECTOR PUTS IN FRONT OF A USER, which is why a buffer's is
  // words (`λ · copy 2`) rather than its id — `tests/browser/view-title.test.ts` asserts the
  // pairs are told apart by their labels and not by colour or position. The program session's label is
  // `program` (Plan 7 part 2 spec §12); its id stays `source`.
  //
  // A `//` BLOCK RATHER THAN `/** */`: it documents a declaration that is GONE, and a doc comment with
  // nothing under it is read as documenting whatever comes next — here `let draw`, which it says nothing
  // about.
  //
  // For what this doc used to claim and why it changed, see the history note under `LAMBDA_SCRATCH`.

  /**
   * BOTH `let`, NOT `const` — DECLARED HERE SO `transport` BELOW CAN CLOSE OVER THEM THROUGH THUNKS
   * BEFORE EITHER IS ASSIGNED. `transport.events(...)` builds the click handlers the panes are
   * CONSTRUCTED with, so `transport` has to exist before either pane does — but `linkWiring`
   * (`link-wiring.ts`) takes both panes as values, and `draw` (`draw.ts`) takes `linkWiring` as one, so
   * neither can be built until after the panes are. `createTransport` therefore sees only thunks for
   * both (`transport.ts`'s own doc has the reason `linkWiring` needs one at all, not only `draw`).
   * Assigned once each, in that order, right after the panes are built, below.
   */
  let draw: () => void
  let linkWiring: LinkWiring

  /**
   * THE PROGRAM'S LAST RESULT (Plan 7 part 2 spec §9) — stored by `replies.ts`'s `setProgram`, rendered by
   * `draw()` into the strip's readout while the focused view shows the program.
   */
  let program: ProgramResult | null = null
  const readout = createReadout(results)

  /**
   * ONE WORKER PER SESSION (design §4.2), AND THE ONLY THING HERE THAT MAY SPAWN OR TERMINATE ONE.
   *
   * A SESSION'S THREAD IS CREATED WHERE ITS CLIENT IS AND DIES WHERE ITS CLIENT DOES.
   *
   * WHY IT IS WORTH A CLASS AT ALL, since there is still exactly one session: the pool's reason is
   * damage containment, not tidiness. A wasm call that aborts leaves a wasm-bindgen borrow taken and
   * poisons the module permanently, and a worker's print-stack ceiling drops after its first deep
   * print and stays down — both are properties of the THREAD, so one worker holding three sessions
   * shares both. `SessionPool`'s own doc carries the measurements; this call site is just where the
   * policy lands.
   *
   * THE FACTORY IS THIS FILE'S HALF OF THE SPLIT, and it is exactly the two decisions the pool must
   * not make: which module a session's worker runs — `session-worker.ts`, resolved against
   * `import.meta.url` so the bundler rewrites the URL — and what a load failure looks like, which
   * needs `root`. §4.2 puts the pool in `session-client.ts`, and a module with no DOM cannot own the
   * second of those.
   *
   * For what this doc used to claim and why it changed, see the history note under `pool`.
   */
  const pool = new SessionPool(
    () => {
      const worker = new Worker(new URL('./session-worker.ts', import.meta.url), { type: 'module' })
      // THE SECOND HALF OF §6's LOAD-FAILURE ROW, and it is not the same failure as `init()`'s. A worker
      // whose module fails to load does not throw from the constructor — it fires `error` on the handle,
      // asynchronously, and nothing else in this file would ever hear it. Without this the pane sits on
      // "running…" forever, which is the same blank-page problem one layer in.
      worker.addEventListener('error', (e) => showBanner(root, e instanceof ErrorEvent ? (e.error ?? e.message) : e))
      return worker
    },
    () => draw(),
  )

  /**
   * THE λ SCRATCH BUFFERS — design §4.3's fork, and the thing that makes a second session reachable.
   *
   * ONE OBJECT RATHER THAN A `fork`/`retire` PAIR OF CLOSURES HERE, and the reason is the test the
   * plan names: how many sessions a fork produces has to be asserted on POOL SIZE, which is not
   * reachable from the DOM. Before T12 this app had ONE λ pane, so "two source-derived λ panes edited
   * in turn" could not be performed through it at all; a layout split now puts a second one on screen,
   * and the argument for one object survives unchanged — the pool-size assertion still needs
   * `tests/node`, whatever the DOM can now show. `scratch.ts` is a module a test can drive with two
   * slots and fake ports; this line is the app taking the same object.
   *
   * THE REPLY HANDLER IS THE BUFFERS' OWN, NOT `onReply`. A buffer has one leg, no results pane, no
   * link index and no `tmProgram`, so every branch of `onReply` (`replies.ts`) except `lambda-frames`
   * is about state it does not have — routing it there would mean five `if (session === …)` guards
   * inside a function whose whole point (see its doc) is that a reply belongs to the session whose
   * worker sent it. Two handlers, one per session kind, is the same split §3.2 draws at the port.
   *
   * IT NAMES THE BUFFER THE REPLY CAME FROM, WHICH IS WHAT THIS LINE USED TO HARD-CODE.
   * `ScratchBuffers` curries each buffer's own id in at `pool.bind`, so the name arrives
   * with the reply and this file no longer has one to supply.
   *
   * For what this doc used to claim and why it changed, see the history note under `scratchpad`.
   */
  const scratchpad = new ScratchBuffers({
    registry: sessions,
    pool,
    historyBytes: HISTORY_BYTES,
    onReply: (session: SessionId, reply: RunReply) => replies.onScratchReply(session, reply),
  })

  // THE SOURCE SESSION, AND NO LONGER THE ONLY ENTRY THE APP EVER HOLDS. **IT USED TO BE THE ONLY ONE
  // CREATED AT START-UP, AND 5d-ii-d's RESTORE TOOK THAT SENTENCE.** A restored page warms the buffers
  // its restored bindings name, below, so a session the user forked on a previous page load can be in
  // the registry before the first `applyLayout()` — created by a reload rather than by a click. What
  // did not change is what ENDS one: a §4.3 buffer ends only where
  // `ScratchBuffers.retire` is called — **which is the header list's retire handler below, and nothing
  // else in `src/`**. That is 5d-ii-c decision 2 complete: one ending, explicit, on a control the user
  // aims at.
  //
  // **THE SELECTOR IS ON SCREEN FROM THE FIRST PAINT, AND THAT REVERSES WHAT THIS COMMENT USED TO SAY.**
  // The title-selector lists `(leg, session)` PAIRS, and this one entry has BOTH legs, so it contributes two pairs
  // on its own and the control's "not shown below two options" threshold is crossed with nothing forked. Its
  // stated idiom is unchanged; what changed is what it counts — pairs now, where a control counting SESSIONS
  // had exactly one to offer until someone forked. See its doc.
  //
  // ASSEMBLED HERE RATHER THAN WHERE `lam`/`tm` USED TO BE DECLARED, because an entry owns its client
  // and the client cannot exist before its worker does. The legs are initialised inline for the same
  // reason the entry exists at all: a session's legs and its client are one thing now, and splitting
  // them across two hundred lines is what let them drift apart into unrelated locals in the first
  // place. Registered before either pane is constructed — `transport.events(...)` below resolves through the
  // registry, and although every handler it builds runs later, `entryOf` would throw if one somehow
  // fired first.
  //
  // `detached: false`, AND IT IS THE ONLY ENTRY THAT MAY SAY SO. This is the session with a
  // `SourceMap` behind it; §3.3 puts `linkIndex` and `sourceSpan` on neither scratch type, so every
  // buffer's entry is `detached: true` by construction — `ScratchBuffers.fork` writes the
  // literal and nothing derives it, for the reason `SessionEntry.detached`'s own doc gives.
  //
  // THE REPLY HANDLER NAMES ITS SESSION. Nothing on the wire does (§3.2 — the port is the id), so the
  // binding between a client and the legs its frames land in is made here, at the one place that
  // knows both. `pool.bind` is what pairs that handler with a thread; this file never sees the port.
  //
  // For what this doc used to claim and why it changed, see the history note under `sessions.add`.
  sessions.add({
    id: SOURCE_SESSION,
    label: 'program',
    detached: false,
    client: pool.bind(SOURCE_SESSION, (reply: RunReply) => replies.onReply(SOURCE_SESSION, reply)),
    legs: {
      lambda: {
        hist: new History<LambdaState>(HISTORY_BYTES),
        status: { available: false, reason: '' },
        done: null,
        playing: false,
      },
      tm: {
        hist: new History<TmState>(HISTORY_BYTES),
        status: { available: false, reason: '' },
        done: null,
        playing: false,
      },
    },
    // NOTHING COMPILED YET, AND THIS SESSION IS THE ONE THAT EVER WILL — `compiled` is the reply the
    // scratch types cannot send (§4.1), so the scratchpad's own entry states the same `null` and keeps
    // it. See `SessionEntry.tmProgram` for what reads this and when.
    tmProgram: null,
    tmScratch: null,
  })
  /**
   * TRANSPORT, BEFORE EITHER PANE — its `events(...)` is what each pane is constructed with, so it has
   * to exist first. `scratchpad` is a real value (constructed above, and nothing later reassigns it);
   * `draw` and `linkWiring` are thunks, for the reason the `let`s above give.
   */
  const transport = createTransport({
    // A THUNK: `lspClient` is not assigned until after the editor is built, far below this call.
    lspClient: () => lspClient,
    // READ AT BLUR, not captured, so toggling the setting takes effect without remounting an editor.
    formatOnBlur: () => formatOnBlur,
    // A VALUE, NOT A THUNK — an editor JOINS the setting rather than reading it. Its own doc says why.
    keymap: keymapSetting,
    // A VALUE, NOT A THUNK — built above `transport` for the ordering reason its own doc gives.
    colour: colourFor,
    sessions,
    scratchpad,
    draw: () => draw(),
    // A THUNK OVER `ws`, WHICH `main()` DECLARES FURTHER DOWN, and safe for the reason `onBuffersChanged`
    // below is: the player reads it only during playback, long after `main()` has run.
    speed: () => ws.speed,
    setSpeed: (s: Speed) => {
      ws = { ...ws, speed: s }
      persistWorkspace()
      draw()
    },
    linkWiring: () => linkWiring,
    // A THUNK FOR THE SAME REASON `draw` IS ONE, one step further down the file: `refreshBuffers` is
    // declared below, after the header list it refreshes, which is itself declared after `paneHost`.
    // The body is not evaluated until a fork actually happens.
    onBuffersChanged: () => refreshBuffers(),
    // A THUNK FOR THE SAME REASON AS THE LINE ABOVE, ONE STEP FURTHER: `persistBuffers` is declared
    // beside `writeBuffersStorage`, below this call, because it reads `panes` and `scratchpad`.
    onBuffersPersist: () => persistBuffers(),
    notify: (text: string) => notices.notify(text),
  })

  /**
   * THE PANE COLLECTION — built empty, before any pane exists, and handed to every later factory as a
   * reference rather than a value (T7's own shape, one step earlier now). `pane-host.ts`'s `applyLayout` is the
   * only thing that ever calls `.add`/`.remove` on it; `linkWiring`/`draw`/`compile`/`replies` just
   * hold onto the same object and read it live, which is what makes them tolerant of it being empty
   * at construction time.
   */
  const panes = new PaneCollection()

  /**
   * WHERE EACH SCRATCH EDITOR IS AND WHERE IT BELONGS — `editor-custody.ts`'s own doc has the argument
   * for why the two maps behind this (`editorOwner`, the claims; `heldEditors`, the editors in custody)
   * and the two functions that read them live there now instead of as four names in this scope, and its
   * doc comments are the record of the three review rounds that shaped them.
   *
   * `panes` IS HANDED OVER EMPTY, exactly as `linkWiring` below takes it: `applyLayout` is the only
   * thing that ever populates the collection, and nothing in that module reads it before `applyLayout`'s
   * first call has run. `applyLayout` (now `pane-host.ts`'s), and it is still the only caller that knows a layout
   * tree exists — custody is told what happened (`hold`, `claim`, `dropClaimsOn`) and asked to settle
   * (`reconcile`), never handed the tree.
   *
   * `collapsedOf` READS `scratchpad`, THE ONE FIELD `reconcileEditors` NEEDS FROM IT — 5d-ii-d T9 fix
   * round 1. `scratchpad` is constructed above and never reassigned, so a plain closure over it is a
   * value in the same sense `panes` and `sessions` are; `editor-custody.ts`'s own doc has the argument
   * for why this is a function and not the whole `ScratchBuffers` object.
   */
  const custody = createEditorCustody({ panes, sessions, collapsedOf: (session) => scratchpad.collapsedOf(session) })

  /**
   * THE SOURCE PANE'S HOST, PRE-SEEDED RATHER THAN LEFT TO `hostFor`'s GENERIC BRANCH. `#editor` is the
   * element `view` is constructed against below — `index.html` ships it as a bare top-level node rather
   * than nested under a `#source` section, because that section no longer exists in the markup at all
   * (the tree builds it). Moving it here, once, before `applyLayout` ever runs, is what lets
   * `hostFor('source', 'source')` find this entry already in `hosts` and return it rather than building
   * an empty section with nothing inside it — the source leaf is chrome around an editor `main.ts`
   * already owns, not a `PaneView` `applyLayout` constructs.
   *
   * **`#link-status` USED TO MOVE IN HERE BESIDE IT, AND THAT WAS DEFERRED-A11Y ITEM 12 — fixed by
   * deleting it from the `append` below rather than by anything more elaborate.** This host ships a
   * close control, and `hostFor`'s detach-not-destroy rule takes the whole subtree out of the document
   * when the source leaf closes; `createLinkWiring` captures the status element once at construction, so
   * every write after that close landed in a node that had left the page. `edit a copy` stays offered on the
   * λ pane throughout — closing the source PANE ends no session — so a refusal past the buffer cap
   * reported to nobody, which is the Critical this branch already fixed arriving again by a narrower
   * road. The line's own contract is what settles where it belongs: `link-status.ts` said of its old fork-failure field
   * that this is *"the surface that exists whether or not a pane can show anything"*, and a surface
   * inside a closeable pane cannot keep that promise. Refusals have since left the line entirely — they
   * are notices (`notice.ts`, spec §11) — but the argument survives them: of the two jobs it keeps, the
   * views-show-copies sentence is app-wide, and what is pinned is about a construct lit in three views
   * rather than about this one. So it stays where `index.html` declares it — inside `footer.strip`,
   * after `#results` (spec §9), outside every host `hostFor` can detach.
   */
  const sourceHost = document.createElement('section')
  sourceHost.className = 'pane'
  sourceHost.dataset.leaf = SOURCE_LEAF
  sourceHost.dataset.kind = 'source'
  const sourceHeader = sourceViewHeader()
  /**
   * THE SOURCE VIEW'S OWN `✕` — `splitLeaf`'s doc records why source is refused a SPLIT
   * and not a close: there is one editor, so there is nothing to duplicate into, but closing the source
   * pane is exactly `hostFor`'s detach-not-destroy rule doing its job — the editor and its text wait in
   * `hosts` and come back intact the moment the leaf does. Two gestures bring it back now, and the
   * second is the one this control was always waiting for: `reset preset`
   * (`tests/browser/two-lambda-panes.test.ts`'s "keeps the program" test), which costs every other pane
   * on the page, and any other pane's split picker (`tests/browser/pane-picker.test.ts`), which costs
   * nothing.
   *
   * A SEPARATE `viewMenu` INSTANCE, NOT ROUTED THROUGH `paneEvents`, BECAUSE THE SOURCE PANE HAS
   * NO `PaneSlot`. `paneEvents` is built for a `(LeafId, PaneSlot<K>)` pair — `applyLayout`'s own `if
   * (l.pane === 'source') continue` is exactly the statement that no such pair exists for this leaf —
   * so the closure here re-states `close`'s two lines directly against `SOURCE_LEAF` rather than
   * manufacturing a slot that would have nothing to resolve. (That constant is `layout.ts`'s now, and
   * its own doc has the reason: `pane-host.ts`'s picker can CREATE a source leaf, so the id this handler
   * closes over and the id that split mints have to be the same id in a way two literals cannot promise.)
   *
   * `{ close: ... }` ALONE, NOT SPLIT — a `viewMenu` builds only the items it is given handlers for, so
   * the source view's `⋯` never appears. `update`'s SECOND ARGUMENT IS A LITERAL `false`, ALWAYS: source
   * can never split (`splitLeaf`'s own refusal), so there is no boolean this view's chrome could ever
   * compute for `canSplit` that isn't already known at every call site.
   */
  /**
   * A LAYOUT CHANGE, SAID AS A NOTICE (Plan 7 part 2 spec §11) — `pane-host.ts` reports a split, a close, a
   * switch and `+ view`; the source view's own close, below, reports through this too.
   */
  const layoutChanged = (e: LayoutEvent): void => {
    const say = (c: PaneChoice): string =>
      c.kind === 'source'
        ? 'source'
        : pairLabel({ leg: c.kind, label: sessions.has(c.session) ? sessions.entryOf(c.session).label : 'a copy' })
    if (e.kind === 'added') notices.notify(`view added — ${say(e.shows)}`)
    else if (e.kind === 'closed') notices.notify(`view closed — ${say(e.showed)}`)
    else notices.notify(`view now shows ${say(e.shows)}`)
  }
  const sourceMenu = viewMenu(sourceHeader.actions, {
    // The source view always has its editor, so unlike a copy's this never comes and goes —
    // `setFormattable(true)` is set once below rather than tracked.
    format: () => {
      lspClient
        .format(SOURCE_URI)
        .then((edits) => applyEdits(view, edits))
        .catch(() => {
          // The client has already said the server is gone; this is one gesture, not a second report.
        })
    },
    close: () => {
      const grew = neighbourOf(tree, SOURCE_LEAF)
      tree = closeLeaf(tree, SOURCE_LEAF)
      // `focusView`, NOT `applyLayout` THEN `focusPane` — its own doc has why the order matters on the
      // stage. Safe here by arithmetic too (`source` is always `leaves()[0]`, so the neighbour that grows
      // and the view that becomes focused are the same leaf), and that is exactly the kind of accident
      // the other three sites were relying on when one of them broke.
      paneHost.focusView(grew)
      layoutChanged({ kind: 'closed', leaf: SOURCE_LEAF, showed: { kind: 'source' } })
    },
  })
  const sourceLayout = { update: (canClose: boolean, canSplit: boolean) => sourceMenu.setLayout(canClose, canSplit) }
  sourceHost.append(sourceHeader.el, editorHost)
  // THE SOURCE VIEW CAN HOLD THE FOCUS TOO (spec §3: `focused` is any leaf) — it drives the readout from
  // Task 9 on. Not `markActive`: that one is per leg, and the source view is on neither (`hostFor`'s own
  // comment in `pane-host.ts` has the argument).
  sourceHost.addEventListener('focusin', () => {
    if (ws.focused === SOURCE_LEAF) return
    ws = { ...ws, focused: SOURCE_LEAF }
    persistWorkspace()
    draw()
  })

  // `localStorage` ACCESS IS GUARDED, same reason and same shape as `readAppearanceStorage`/
  // `writeAppearanceStorage` above: it throws in some privacy modes, and a layout is a preference —
  // design §4.4 says a failure to persist or restore one must stay silent to the user, not blank the
  // page or block the app from starting.
  const readLayoutStorage = (): string | null => {
    try {
      return localStorage.getItem(LAYOUT_STORAGE_KEY)
    } catch {
      return null
    }
  }
  const writeLayoutStorage = (raw: string): void => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, raw)
    } catch {
      // Nothing to do — the layout still works for the rest of this page load, it just will not
      // survive a reload. The same tradeoff `writeAppearanceStorage` makes.
    }
  }

  // A FAILED READ IS SILENT, for `parseBuffers`'s own stated reason: it is indistinguishable from a
  // first visit, and a banner on every load after a schema bump is worse than what it reports.
  const readBuffersStorage = (): string | null => {
    try {
      return localStorage.getItem(BUFFERS_STORAGE_KEY)
    } catch {
      return null
    }
  }
  /**
   * Whether the quota failure has already been reported on this page load.
   *
   * **ONCE PER PAGE LOAD, NOT ONCE PER WRITE** (design §4.8). The buffers write sits behind the
   * editor's 300 ms debounce, so a user typing into a full store would otherwise get the same line
   * rewritten every 300 ms — which reads as a fault in the app rather than a fact about the browser,
   * and which would keep replacing every other notice. Once is enough: the condition does not un-happen within a page load, and the user's
   * remedy (clear storage, retire buffers) is outside the app.
   *
   * **AND "ONCE" IS AN UPPER BOUND, NOT A GUARANTEE THAT THE NOTICE IS EVER READ.** The report is a
   * persistent notice (`notice.ts`), so a keystroke no longer clears it — but any later notice replaces
   * it, as a new notice replaces every old one (spec §11), and this flag keeps it from coming back. On
   * a RESTORED page the warming loop at the end of `main()` can refuse a warm at the cap after this
   * report was made by `refreshBuffers()`'s start-up write, and that refusal's notice replaces this one.
   * What is fixed is the pretence: this flag means "reported at most once", never "shown for as long as
   * it matters".
   */
  /**
   * Say that copies are no longer being saved.
   *
   * **THE NOTICE LINE'S RESTING STATE RATHER THAN A BANNER OR A NOTICE**, because the notice line is the
   * surface that already carries the other things this app has to tell a user about a gesture that did
   * not produce a visible change — a refused copy, a refused resume — and `banner.ts` is the wasm-load
   * and worker-spawn failure surface, which this is not. **A NOTICE WOULD NOT LAST, WHICH IS WHY THIS IS
   * `rest` AND NOT `notify`** (`notice.ts`'s `Notices.rest`): every notice is replaced by the next one,
   * and nearly every gesture makes one — a copy created, a view closed — so the one condition here that
   * genuinely lasts would have been on screen for about one gesture. As a resting state it is what the
   * line says whenever nothing else is being said, for as long as the condition holds, and it is said in
   * the live region the moment it begins.
   *
   * **AND IT IS TAKEN BACK WHEN A WRITE SUCCEEDS**, which is what `writeBuffersStorage` does below: the
   * user may have cleared storage or deleted copies since, and a warning that outlives its condition
   * teaches a reader to ignore the line. Setting it twice with the same words is a no-op, so the
   * once-per-page-load flag this used to keep is gone — "reported twice" is not a state this can reach.
   * The wording says the CONSEQUENCE and not the cause: `QuotaExceededError` is true and useless, and
   * what the user needs to know is that closing the tab now loses work.
   *
   * **IT NEEDS ONLY `notices`, WHICH EXISTS BEFORE `init()`.** It used to write through `linkWiring` and
   * `draw()`, both `let`s that stay `undefined` until further down this function, so its callers had to
   * be ordered after both — an ordering that cost three attempts and two `TypeError`s, and that nothing
   * here depends on any more. `refreshBuffers`'s own start-up call, near the end of `main()`, carries
   * what is left of that argument.
   */
  const reportStorageFailure = (): void => {
    notices.rest('copies are not being saved — this browser’s storage for this site is full')
  }

  /**
   * **THIS WRITER REPORTS WHERE THE LAYOUT'S WRITER SWALLOWS, AND THE ASYMMETRY IS DESIGN §4.8.** That
   * one's comment reads "the layout still works for the rest of this page load, it just will not survive
   * a reload" — a fair trade for a preference. A buffer is WORK, and a user told nothing finds out at
   * the next reload, by absence.
   *
   * **`hasBuffers` IS THE PAYLOAD'S OWN ANSWER TO "IS THERE ANYTHING TO LOSE", HANDED IN RATHER THAN
   * RE-DERIVED FROM `raw`.** `persistBuffers` already has `PersistedBuffers` in hand before it stringifies
   * it; parsing `raw` back here to ask the same question would be a second, slower way to say what the
   * caller already knows. **THE GUARD EXISTS BECAUSE `refreshBuffers()`'s FIRST CALL, AT THE END OF
   * `main()`'s START-UP, WRITES AN EMPTY PAYLOAD FOR EVERY USER, INCLUDING ONE WHO HAS NEVER FORKED** —
   * see that call site's own doc. Design §4.8's argument for reporting at all is "a lost buffer is
   * work"; read the other way, no buffers means no work, and a user with nothing to lose must not be
   * told their (nonexistent) buffers are not being saved. `reportStorageFailure`'s own once-per-load
   * guard cannot substitute for this: it would still fire ONCE, on that very first empty write, for
   * every visitor — the false report would just never repeat rather than never happening.
   */
  const writeBuffersStorage = (raw: string, hasBuffers: boolean): void => {
    try {
      localStorage.setItem(BUFFERS_STORAGE_KEY, raw)
      // THE CONDITION ENDED, SO THE WARNING DOES — `reportStorageFailure`'s own doc has the argument.
      // `rest(null)` on a line that is not resting on anything costs a comparison.
      notices.rest(null)
    } catch {
      if (hasBuffers) reportStorageFailure()
    }
  }

  /**
   * Write the buffers to storage — called at every moment the payload would say something different,
   * and at no others: a fork, a retire, a recorded term, a rebind, and the first `applyLayout()` that
   * turns restored bindings into real panes.
   *
   * A WARM AND A COOL REACH IT TOO AND CHANGE NOTHING IT WRITES, which is a fact about the FORMAT
   * rather than a redundant call: `snapshot` does not carry `warm`, because a buffer's temperature on
   * the next page load is decided by which panes come back (`ScratchBuffers.snapshot`'s own doc). They
   * arrive here through `refreshBuffers`, which the temperature handler shares with the retire handler
   * line for line — see that function for why the uniformity is worth one write that says the same
   * thing twice.
   *
   * THE BINDINGS ARE READ OFF THE PANES AT WRITE TIME rather than tracked separately, because
   * `PaneCollection` already holds them and a second copy is a second thing to be wrong — the same
   * argument `panes.ts` makes for reading bindings through the slot instead of indexing by session.
   *
   * **`SOURCE_SESSION` IS OMITTED RATHER THAN STORED, WHICH IS WHAT MAKES THE ABSENT-KEY CASE THE
   * DEFAULT CASE.** A pane on the source session is what every leaf gets from `applyLayout`'s
   * `?? SOURCE_SESSION` when nothing names it, so writing those entries down would be persisting the
   * fallback — and `parseBuffers` would then have to reject them, since it refuses a binding naming a
   * session no restored buffer holds.
   *
   * **NOT CALLED FROM `draw()`.** It runs per frame during playback, and `JSON.stringify` over every
   * buffer's text sixty times a second is precisely the cost `buffers-store.ts`'s two-key split exists
   * to avoid, reintroduced on a different path.
   */
  const persistBuffers = (): void => {
    const bindings: Record<LeafId, SessionId> = {}
    for (const p of panes.all()) {
      if (p.slot.binding.session !== SOURCE_SESSION) bindings[p.id] = p.slot.binding.session
    }
    // `payload` IS BUILT ONCE AND READ TWICE — for the bytes `writeBuffersStorage` writes and for
    // whether it has anything in it worth a report on the way out. `writeBuffersStorage`'s own doc has
    // the argument for why that second question travels as a boolean rather than being re-asked of
    // `raw` inside the catch.
    const payload = scratchpad.snapshot(bindings)
    writeBuffersStorage(serializeBuffers(payload), payload.buffers.length > 0)
  }

  /**
   * THE WORKSPACE — restored from `localStorage` if there is a usable value there (a version 1 layout is
   * migrated: `workspace.ts`'s `parseWorkspace`), the default otherwise.
   *
   * **`tree` STAYS ITS OWN `let`, AND `ws` HOLDS THE REST.** `pane-host.ts` reads and writes the tree through
   * `getTree`/`setTree` on every gesture, and its doc argues why the tree has one owner; folding it into `ws`
   * would move that owner without changing anything a reader could see. `persistWorkspace` joins the two at
   * the one moment they are written.
   */
  const restored = parseWorkspace(readLayoutStorage()) ?? defaultWorkspace()
  let tree: LayoutNode = restored.tree
  let ws: Omit<Workspace, 'tree'> = {
    switches: restored.switches,
    speed: restored.speed,
    focused: restored.focused,
    panels: restored.panels,
    inspector: restored.inspector,
  }
  /**
   * The focused view, repaired against the tree it names a leaf of.
   *
   * **A CLOSE OR A RESET LEAVES `ws.focused` NAMING A LEAF THAT IS GONE**, and until this existed only
   * the WRITE repaired it (`serializeWorkspace` falls back to `defaultFocus`) — so memory and storage
   * disagreed, and the readout, which resolves `focused` through `panes.get`, quietly fell back to the
   * program while some other view had the focus. Two call sites hand-repaired it and a third did not;
   * this is the one answer all three ask.
   */
  const focusedLeaf = (): LeafId => (leaves(tree).some((l) => l.id === ws.focused) ? ws.focused : defaultFocus(tree))

  /**
   * Drop what the tree no longer holds — the panel state of a closed view, and a focus on one.
   *
   * **`defaultLayout()` RE-MINTS `source`, `lambda-0` AND `tm-0` AS LITERALS**, so a leaf id genuinely
   * comes back: close the TM view with its rules panel shut, then *reset preset*, and the new `tm-0`
   * would inherit the closed view's panel state — from memory, since the write had already dropped it.
   * The same clicks then behaved differently depending on whether the page had been reloaded in
   * between. `editor-custody.ts`'s `editorOwner` records the identical hazard for claims and answers it
   * the same way, in `applyLayout`'s creation pass.
   */
  const normaliseWorkspace = (): void => {
    const live = new Set(leaves(tree).map((l) => l.id))
    const panels = Object.fromEntries(Object.entries(ws.panels).filter(([leaf]) => live.has(leaf)))
    ws = { ...ws, focused: focusedLeaf(), panels }
  }

  const persistWorkspace = (): void => {
    normaliseWorkspace()
    writeLayoutStorage(serializeWorkspace({ tree, ...ws }))
  }
  // IMMEDIATELY, AND ON THE RESTORED TREE RATHER THAN ONLY THE DEFAULT ONE — see `seedLeafCounter`'s
  // own doc. ONCE, HERE, NOT ON EVERY `applyLayout`: the counter only ever needs to learn about ids it
  // did not mint itself, and this is the one moment such an id can enter the tree. (Re-seeding later
  // would be harmless — the function only ever advances — but it would also be a second place to read
  // as though the invariant needed maintaining.)
  seedLeafCounter(tree)

  /**
   * THE PANE LIFECYCLE — `pane-host.ts`'s own doc has the argument for why `hosts` and `pendingBinding`,
   * and the four closures over them (`hostFor`, `paneEvents`, `focusPane`, `applyLayout`), live there now
   * instead of as six names in this scope, and its doc comments are the record of the review rounds that
   * shaped them.
   *
   * CONSTRUCTED AFTER `tree`, `sourceLayout` AND `persistWorkspace`, AND BEFORE ANY PANE EXISTS, because
   * those three are its irreducible ties back to this file: the tree it reads and rewrites, the source
   * pane's close control it drives at every structural change, and the writer that persists the
   * workspace. `panes` IS HANDED OVER EMPTY — `applyLayout` is still the only thing that ever populates it —
   * and `draw` is a thunk for the same reason `linkWiring`/`compile` below take one: the `let` it names is
   * not assigned until `createDraw` runs.
   *
   * `tree` STAYS A `let` IN THIS SCOPE AND CROSSES AS A GETTER/SETTER PAIR, not as a field over there and
   * not as a mutable export. Two of its writers stay here — the restore just above and the `reset preset`
   * item below — so a copy in that module would be a second place the current tree lives, and this
   * file would be holding the stale one.
   *
   * `nextLeafId` AND `neighbourOf` CROSS AS FUNCTIONS RATHER THAN MOVING WITH THEIR CALLERS. `leafCounter`
   * is deliberately per-module rather than per-`main()` call (see its own doc), and `seedLeafCounter` above
   * is the other reader of it; `neighbourOf`'s other caller is `sourceLayout`'s close handler above, which
   * has no `PaneSlot` and therefore no `paneEvents` to go through.
   */
  const paneHost = createPaneHost({
    root,
    panes,
    custody,
    transport,
    sourceSession: SOURCE_SESSION,
    sourceLayout,
    nextLeafId,
    neighbourOf,
    getTree: () => tree,
    setTree: (next) => {
      tree = next
    },
    stage: () => ws.switches.views === 'stage',
    focusedLeaf,
    // A THUNK WRAPPER, NOT THE REFERENCE — `viewTitle` is declared below this call (it needs the pane
    // collection and the registry that the bar's target also reads), and this is the same late-binding
    // `draw: () => draw()` above already takes for the same reason.
    viewTitle: (id) => viewTitle(id),
    persist: persistWorkspace,
    setFocused: (id: LeafId) => {
      if (ws.focused === id) return
      ws = { ...ws, focused: id }
      persistWorkspace()
    },
    panelOpen: (leaf: LeafId, name: string) => ws.panels[leaf]?.[name],
    setPanel: (leaf: LeafId, name: string, open: boolean) => {
      ws = { ...ws, panels: withPanel(ws.panels, leaf, name, open) }
    },
    layoutChanged,
    draw: () => draw(),
    // THE ONE SESSION QUESTION `pane-host.ts` ASKS, ANSWERED HERE BECAUSE THIS FILE IS WHERE THE REGISTRY
    // IS — that module's own doc argues why it takes this rather than the registry it would otherwise
    // need. `entryOf` throws for a session nothing registered, which is the policy `legOf` already sets
    // for the same class of wiring bug.
    tmProgramOf: (session: SessionId) => sessions.entryOf(session).tmProgram,
    tmScratchOf: (session: SessionId) => sessions.entryOf(session).tmScratch,
    // THE SECOND SESSION QUESTION `pane-host.ts` ASKS, ANSWERED HERE FOR THE SAME REASON AS THE FIRST —
    // this file is where `ScratchBuffers` is, and that module takes a function from a `SessionId` to one
    // value rather than the class itself. `editorSeed` answers `null` for everything that is not a warm
    // buffer, which is every session that reaches it on the source leg.
    scratchSeedOf: (session: SessionId) => scratchpad.editorSeed(session),
  })

  /**
   * **RESTORE ORDER — design §4.9, and the order is load-bearing.** Buffers first so that every id a
   * binding could name exists; bindings second, into `pendingBinding`, which the first `applyLayout()`
   * below reads; warming third and last, because it needs `linkWiring` to report a refusal and that is
   * not assigned until much further down this function — see the warming loop's own comment, at the
   * end of `main()`.
   *
   * HERE, BESIDE `seedLeafCounter`, FOR ITS REASON: this is the one moment ids the app did not mint
   * itself can enter, and both restores are exactly that. It sits BELOW `createPaneHost` rather than
   * beside `seedLeafCounter` only because `seedBinding` is that object's method.
   *
   * **A NULL HERE IS EVERY FAILURE AT ONCE, AND THAT IS THE POINT** (`buffers-store.ts`'s
   * `parseBuffers`): nothing stored, a version bump, unparseable JSON, a duplicate id, a stale counter,
   * a binding naming a buffer that is not in the payload. All of them land on "no buffers and no
   * bindings", which is a fresh page — today's behaviour exactly, reached without a line of
   * reconciliation.
   *
   * **ONE FAILURE IS NOT AMONG THEM AND IS REFUSED HERE INSTEAD: A BINDING THAT NAMES A LEAF WHOSE
   * PANE KIND DISAGREES WITH THE BUFFER'S OWN LEG.** `parseBuffers` cannot catch it — the payload is a
   * `Record<LeafId, SessionId>` and carries no leg, deliberately (design §4.1), so validating it would
   * need the layout tree, which that module is free of on purpose. `SessionRegistry.legOf` throws for a
   * leg a session lacks — so a binding that reached a `tm` leaf naming a λ-only buffer (or a `lambda`
   * leaf naming a TM-only one) would build a `PaneSlot` requesting a leg that buffer's session does not
   * have, and `draw.ts`'s per-pane loop has no `try`/`catch`: the first frame throws and takes every
   * subsequent one with it. **Measured, not reasoned** — `tests/browser/buffer-restore.test.ts` seeds
   * exactly that binding and the whole page died at `main()` (`session scratch-1 has no tm leg`), which
   * is the same Critical `transport.ts`'s `rebind` records from the other direction.
   *
   * **AND IT IS REACHABLE WITHOUT A HAND-EDITED KEY.** A λ pane bound to a buffer, then switched to TM
   * through the pane picker, changes the leaf's KIND through `pane-host.ts`'s `applyLayout` — which
   * persists the tree and does not persist the buffers. Nothing writes the buffers key again until the
   * next fork, retire, rebind or scratch build, so a reload in that window restores a binding the tree
   * disagrees with. This guard is what makes that window harmless rather than fatal; the write-back at
   * the end of `main()` then drops the binding from storage, because the pane it named is on the source
   * session.
   *
   * **THE LEAF AND THE NAMED BUFFER MUST AGREE ON A LEG, WHICH IS THE INVARIANT AND NOT `l.pane ===
   * 'lambda'` — 5d-iv T11.** `ScratchBuffers` mints a `tm` buffer now (`fork`/`forkBlank`, given `'tm'`),
   * so "a buffer is λ-only" stopped being a fact this guard could lean on the moment `PersistedBuffer`
   * gained `leg` (T6). Checking only the LEAF's pane kind, with no look at the NAMED BUFFER's own `leg`,
   * both under- and over-refuses: it drops every legitimate `tm`-leaf binding on a `tm` leaf (there is no
   * arm that ever admits one), and it still ADMITS a hand-edited payload pairing a `tm`-leg buffer's id
   * with a `lambda` leaf's binding — the leaf IS a λ pane, so the old `lambdaLeaves.has(leaf)` check
   * passed it — which reaches `pane-host.ts`'s `applyLayout`, builds `PaneSlot('lambda', session)` for a
   * session whose only leg is `tm`, and throws out of `SessionRegistry.legOf` in the first `draw()` — the
   * same crash class `buffer-restore.test.ts`'s own `SEEDED` fixture already pins from the mirrored
   * direction (a `lambda`-leg buffer bound to a `tm` leaf). `legOfLeaf`/`legOfBuffer` below replace the
   * leaf-only check with the actual invariant: the binding survives only when both legs agree.
   */
  const restoredBuffers = parseBuffers(readBuffersStorage())
  /**
   * The restored bindings the tree can actually take — what the warming loop below warms, and what the
   * claiming loop below `applyLayout()` gives an editor home (see that loop's own comment for why it is
   * not here beside `seedBinding`, though both read this same list).
   */
  const restoredBindings: [LeafId, SessionId][] = []
  if (restoredBuffers !== null) {
    scratchpad.restore(restoredBuffers)
    const legOfLeaf = new Map(
      leaves(tree).flatMap((l) => (l.pane === 'lambda' || l.pane === 'tm' ? [[l.id, l.pane] as const] : [])),
    )
    const legOfBuffer = new Map(restoredBuffers.buffers.map((b) => [b.id, b.leg] as const))
    for (const [leaf, session] of Object.entries(restoredBuffers.bindings)) {
      if (legOfLeaf.get(leaf) !== legOfBuffer.get(session)) continue
      restoredBindings.push([leaf, session])
      paneHost.seedBinding(leaf, session)
    }
  }

  // THE `hosts.set('source', sourceHost)` THIS USED TO BE, now that the map is `pane-host.ts`'s.
  // `sourceHost`'s own doc above has the argument for why this file builds that host rather than leaving
  // it to `hostFor`'s generic branch, and for why the seeding has to happen before `applyLayout` first
  // runs — still true here, with the whole tail of `main()` between this line and that call.
  paneHost.seedHost(SOURCE_LEAF, sourceHost)

  // THE WORKSPACE MENU — the presets, the switches, and `reset preset` (spec §4, §6).

  /**
   * THE WORKSPACE BUTTON'S NAME, AND ITS `▾`.
   *
   * **THE GLYPH IS WRITTEN HERE AS WELL AS IN `index.html`**, because this replaces the button's whole
   * content on every preset change — a span placed only in the markup would survive exactly until the
   * first one. `aria-hidden`, so the accessible name is the preset's name alone: a bare `▾` in a spoken
   * sentence reads as "down-pointing triangle" (spec §12), and `copies ▾` already does it this way.
   */
  const paintWorkspaceButton = (): void => {
    const caret = document.createElement('span')
    caret.setAttribute('aria-hidden', 'true')
    caret.textContent = '▾'
    workspaceButton.replaceChildren(`${presetName(presetOf(ws.switches))} `, caret)
  }
  paintWorkspaceButton()

  /**
   * Fill the workspace menu from the switches in force.
   *
   * **A `const` ARROW AND NOT A HOISTED `function`, AND THAT IS A TYPE FACT RATHER THAN A STYLE ONE.**
   * `workspaceMenu` is a `querySelector` result narrowed to non-null by the shell guard near the top of
   * `main()`; TypeScript keeps that narrowing inside a closure CREATED after the guard, and drops it inside
   * a function DECLARATION, which is hoisted above it — `error TS2345: Argument of type 'HTMLElement |
   * null'`. It is declared before its two callers for the same reason.
   */
  const fillWorkspaceMenu = (): void => {
    workspaceItems(
      workspaceMenu,
      { switches: ws.switches, reset: resetPresetButton },
      {
        preset: (p) => setSwitches(PRESETS[p]),
        // THE ONE NARROWING. `SwitchRow.value` is `string` (its own doc); this is where a menu value
        // becomes a `Switches` one, and an unknown one is dropped rather than stored — `parseWorkspace`
        // would refuse the whole envelope on the next load.
        flip: (key, value) => {
          const parsed = parseSwitches({ ...ws.switches, [key]: value })
          if (parsed !== null) setSwitches(parsed)
        },
      },
    )
  }

  /** Put the page in step with the switches. Each of part 2b's three consumers adds one line here. */
  const applySwitches = (): void => {
    paintWorkspaceButton()
    // THE MENU REPAINTS UNDER THE USER'S HAND, because a pick changes which value is marked and may take
    // `reset preset` away — `workspaceItems` is what puts the focus back across that rebuild.
    if (workspaceMenu.matches(':popover-open')) fillWorkspaceMenu()
    // THE BAR IS ON THE PAGE ONLY WHILE IT IS THE STEP CONTROL (spec §8). `hidden` rather than removed
    // because the element is `index.html`'s and the bar it holds is built once; `controls-gate.test.ts`
    // skips anything under a `[hidden]` ancestor, so nothing walks it while it is down.
    stepBarHost.hidden = ws.switches.steps !== 'bar'
    // **THE READOUT'S HOSTS MOVE; THEIR IDS DO NOT** (spec §9). One element renders the rows in both
    // modes, so `#results[data-state]` never stops being written and no test that waits on it can be
    // looking at the wrong copy.
    const intoInspector = ws.switches.readout === 'inspector'
    inspectorHost.hidden = !intoInspector
    strip.hidden = intoInspector
    const home = intoInspector ? inspectorBody : strip
    if (results.parentElement !== home) home.append(results, linkStatusHost)
    readout.setMode(ws.switches.readout)
    // **A FULL LAYOUT PASS, NOT A BARE `draw()` — spec §5.** The `views` switch decides which renderer
    // `applyLayout` calls, so nothing on screen changes without it; and it ends in `persist()` and
    // `draw()` of its own, which is what repaints the readout after the mode change above. The `steps`
    // and `readout` switches do not need the pane reconciliation it also performs, and paying for it on
    // all three is cheaper than a second path that has to stay in step with this one.
    paneHost.applyLayout()
  }

  /**
   * THE ONE WRITER OF THE SWITCHES (spec §4): persist, rename, repaint, and say what changed.
   *
   * A NO-OP PICK IS NOT A CHANGE. Choosing the value already in force is a gesture that changes nothing,
   * and a notice for it would push a real one off the line for eight seconds.
   */
  const setSwitches = (next: Switches): void => {
    if (next.steps === ws.switches.steps && next.views === ws.switches.views && next.readout === ws.switches.readout)
      return
    ws = { ...ws, switches: next }
    persistWorkspace()
    applySwitches()
    notices.notify(
      `${presetName(presetOf(next))} — step controls ${next.steps === 'bar' ? 'in one bar' : 'in each view'}, ${next.views}, ${next.readout}`,
    )
  }

  wireMenu(workspaceButton, workspaceMenu, fillWorkspaceMenu)

  /**
   * A view's title, in the title-selector's own spelling — the bar's prefix (spec §8) and, from part 2b's
   * Stage task, a tab's label (§5).
   *
   * **ONE FUNCTION, BECAUSE A VIEW HAS ONE NAME.** The header, the bar and the tab strip all say what a
   * view shows, and three spellings of `λ · program` would be three places for the vocabulary sweep to
   * have missed one.
   */
  const viewTitle = (id: LeafId): string => {
    const entry = panes.get(id)
    // THE SOURCE VIEW HAS NO PANE ENTRY AND ITS TITLE IS NOT A PAIR (spec §7): it is `source`, always.
    if (entry === undefined) return 'source'
    const b = entry.slot.binding
    const option = sessions.pairs().find((o) => o.leg === b.leg && o.id === b.session)
    return option === undefined ? '' : pairLabel(option)
  }

  /**
   * WHICH VIEW THE BAR DRIVES, AND THE MEMORY BEHIND "the last view that could step" (spec §8).
   *
   * **THE MEMORY IS WRITTEN ONLY WHEN A TARGET RESOLVES**, so a focused source view keeps the bar pointed
   * at the view it was driving rather than blanking it — which is the whole of §8's second sentence.
   */
  let lastSteppable: LeafId | null = null
  const barTargetNow = (): BarTarget | null => {
    // EVERY PANE IS STEPPABLE: the source LEAF has no `PaneEntry` at all (`draw.ts`'s readout block says
    // so from the other side), so this list is already "every λ or TM view on the page".
    const id = barTarget(
      focusedLeaf(),
      panes.all().map((p) => p.id),
      lastSteppable,
    )
    if (id === null) return null
    const entry = panes.get(id)
    if (entry === undefined) return null
    lastSteppable = id
    const b = entry.slot.binding
    return { id, title: viewTitle(id), controls: legControlState(sessions, b, entry.slot.resolve(sessions)) }
  }

  const stepBar = createStepBar({
    target: barTargetNow,
    events: (id) => {
      const entry = panes.get(id)
      return entry === undefined ? null : transport.events(entry.slot)
    },
    // THE SAME PAIR `createTransport` WAS BUILT WITH, not a second reader of `ws.speed`: one global speed
    // (spec §8), so every step control on the page reflects a change at once.
    speed: () => ws.speed,
    setSpeed: (s: Speed) => {
      ws = { ...ws, speed: s }
      persistWorkspace()
      draw()
    },
  })
  stepBarHost.append(stepBar.el)

  /**
   * THE INSPECTOR (spec §9): the readout as a right-hand column, one fact per line.
   *
   * **ITS BODY HOLDS `#results` AND `#link-status` THEMSELVES**, moved out of the strip rather than
   * copied. `#results[data-state]` is the program's compile state and 24 browser test files wait on it;
   * two elements would be two places for that attribute to be written, and the second one is where it
   * would be forgotten.
   *
   * **ITS OPEN STATE IS THE WORKSPACE's, NOT A VIEW's** (`Workspace.inspector`): there is one inspector,
   * and keying it on the focused view would collapse and re-open it as the focus moved.
   */
  const inspectorBody = document.createElement('div')
  inspectorBody.className = 'inspector-body'
  const inspectorPanel = createPanel({
    name: 'inspector',
    label: 'inspector',
    body: inspectorBody,
    open: ws.inspector,
    onToggle: (open) => {
      ws = { ...ws, inspector: open }
      persistWorkspace()
    },
  })
  inspectorHost.append(inspectorPanel.el)
  resetPresetButton.addEventListener('click', () => {
    workspaceMenu.hidePopover()
    // `presetOf(…) ?? 'explorer'` IS UNREACHABLE NOW AND STAYS AS THE BACKSTOP IT ALWAYS WAS.
    // `workspaceItems` does not put this item in the menu while the workspace is custom (spec §4), so the
    // only preset that can reach this line is a real one — the `??` is what holds if a caller ever gets
    // here another way, which is the same standing `layout.ts`'s refusals take against their own UI.
    const preset = presetOf(ws.switches) ?? 'explorer'
    tree = defaultLayout()
    ws = { ...ws, switches: PRESETS[preset] }
    // **THE FOCUS GOES INTO THE NEW ARRANGEMENT — whole-branch review follow-up, the sibling search
    // C1's fix asked for.** `hidePopover()` above hands focus back to whatever held it before the menu
    // opened, which for a user reaching this item is a control inside one of the views. Rebuilding the
    // tree from `defaultLayout()` detaches that host — `renderLayout`'s `root.replaceChildren()` — and
    // focus falls to `<body>`, measured in Chrome a frame later, which is why a synchronous read at the
    // end of this handler still shows a live element and the gesture looks safe until it is watched
    // across a frame.
    //
    // **IT DEPENDS ON WHERE THE FOCUS WAS, AND THAT IS NOT A REASON TO SKIP IT.** Reached from a header
    // control the gesture is harmless, because the header is outside `<main>` and no rebuild touches it.
    // Reached from inside a view — the ordinary case, since that is where a user works — it strands the
    // focus every time. `tests/browser/menu-focus.test.ts` drives it from inside a view for exactly that
    // reason, and removing this line fails that one case and no other.
    //
    // **`focusView`, NOT `applyLayout` THEN `focusPane` — part 2b's whole-branch review.** On the stage
    // the leaf this names may not be the one mounted, and `focusPane` on a detached host does nothing;
    // `focusView` records the focus BEFORE the rebuild so the stage mounts the view this line means.
    // `defaultFocus` rather than `focusedLeaf()` because the leaf the user was in may not exist in
    // `defaultLayout()`'s tree at all.
    paneHost.focusView(defaultFocus(tree))
    notices.notify(`${presetName(preset)} reset — the default views are back`)
  })

  // `+ view` — spec §5, §6: beside the focused view, which may be the source view.
  wireMenu(addViewButton, addViewMenu, () =>
    addViewItems(
      addViewMenu,
      { options: sessions.pairs(), sourceAvailable: !leaves(tree).some((l) => l.pane === 'source'), current: null },
      (choice) => {
        const beside = focusedLeaf()
        // SAID BY `layoutChanged`'s `added` event, which `addView` reports.
        paneHost.addView(choice, beside)
      },
    ),
  )

  /**
   * Undo a delete — spec §10. The copy comes back under its own id and name, COLD, and is warmed; a
   * refusal at the cap leaves it paused, which is still a copy restored. The views the delete moved to
   * the program move back if they still exist and still show the program.
   *
   * **THE CLAIM BEFORE THE BUILD LANDS** is what lets `replies.ts`'s `scratch-compiled` arm mount the
   * editor on that view — `editorHome` resolves through the claim, as a fork's does.
   */
  const undo = (record: BufferRecord, shown: readonly LeafId[]): void => {
    scratchpad.reinstate(record)
    const name = scratchpad.nameOf(record.id) ?? `${record.leg === 'lambda' ? 'λ' : 'TM'} ${record.label}`
    try {
      scratchpad.warm(record.id)
    } catch (e) {
      if (!(e instanceof BufferCapReached)) throw e
      notices.notify(`${name} restored, paused — ${MAX_WARM_BUFFERS} copies are running`)
      refreshBuffers()
      draw()
      // THE SAME DEBT AS THE SUCCESS PATH BELOW, AND THIS ARM OWES IT TOO: the undo button is gone
      // either way, and a refusal is exactly when a user needs to see where they are. No view came
      // back, so the copies button is the whole of the answer.
      buffersButton.focus()
      return
    }
    const moved = paneHost.moveBack(shown, SOURCE_SESSION, record.id)
    const home = moved[0]
    if (home !== undefined) custody.claim(record.id, home)
    notices.notify(`${name} restored at step 0`)
    refreshBuffers()
    draw()
    // **UNDO REMOVES THE CONTROL IT WAS ACTIVATED FROM, SO IT OWES THE FOCUS SOMEWHERE — spec §11, and
    // the accessibility list's item 1 in the control this whole gesture exists for.** `notice.ts` tears
    // the action button down before running this (it must: a second undo would throw), and a module that
    // knows nothing about views cannot say where focus should land. The view the copy came back to is
    // where the user's attention is; with no view to come back to, the control that lists the copies is.
    // AFTER `draw()`, because the view's title is rebuilt from the new binding by the frame above.
    const back = home === undefined ? null : document.querySelector<HTMLElement>(`[data-leaf="${home}"] .view-title`)
    if (back !== null) back.focus()
    else buffersButton.focus()
  }

  /**
   * **THE HEADER'S BUFFER LIST — design §4.2's surface, and §4.4's poison recovery arriving with it.**
   * This is the call that closes the window decision 2 opened: until it existed the app could create
   * buffers and end none, so a wedged worker could not be reclaimed, a failed fork left its pane reading
   * `building…` forever, and `buffer-list.ts` was a tested module nothing imported.
   *
   * **`paneCount` IS COMPUTED HERE AND LIVES ON NO OTHER TYPE, WHICH IS WHY `BufferInfo` AND
   * `BufferRow` ARE TWO TYPES.** `ScratchBuffers` answers what buffers exist; `PaneCollection` answers
   * which panes are bound to one. Putting the count on `BufferInfo` would give `scratch.ts` a
   * `PaneCollection` dependency for a number only the header renders — and this file already holds both
   * objects, so the join costs one `map` at the one place that is not a second reader of either.
   *
   * A THUNK BUILT PER OPEN, NOT A VALUE: `bufferList` calls this on `beforetoggle` (its own doc), so
   * the `ofSession` scan runs once per gesture rather than on every frame that repaints the header.
   *
   * `paneHost.reseedingSlots()` HANDS OVER EVERY SLOT ON THE PAGE, NOT THE λ ONES, and each one tells its TM pane what
   * the session it moves onto holds (that member's doc has the finding). `retire` rebinds only the
   * slots whose binding names the buffer it is ending (`scratch.ts`'s own rule, and
   * `tests/node/scratch.test.ts` pins it against a TM slot that must not be dragged home), so filtering
   * here would be this file restating a rule the callee enforces — and getting it wrong would be
   * invisible, since the buffer would end either way.
   *
   * **THE `custody.reconcile()` IS THIS HANDLER'S OWN OBLIGATION AND NOTHING ELSE WILL DISCHARGE IT.**
   * A retire was the one event that made `!sessions.has(session)` true — until 5d-ii-d gave `cool` a
   * second door. `retire` is `cool` followed by forgetting the `#buffers` record, so a cool through the
   * temperature handler below drops a session from the registry exactly as a retire does, and needs the
   * identical sweep. `editor-custody.ts`'s `reconcileEditors` is what then drops the claim and destroys
   * an editor waiting in custody for it — the last reference to a live `EditorView`, with its own
   * pending debounce, over a terminated worker. Both retire sites used to call it; 5d-ii-c decision 2
   * deleted both, and `createReplies` shed the dependency on the stated reasoning that the header list's
   * retire would live in the list's own handler, "so that is where the sweep obligation belongs". This
   * is that handler — the temperature handler carries the identical obligation independently, since a
   * warm never needs it and a cool always does.
   *
   * `try`/`finally` FOR `applyLayout`'s REASON, IN ONE SENTENCE: `reconcile` throws deliberately
   * (`LambdaPane.receiveEditor` refuses a second editor), and a throw escaping here would leave the
   * header advertising a buffer that has gone and the rebound panes unpainted — a disagreement worse
   * than the one being reported. The exception still leaves this handler.
   */
  const buffers = bufferList(
    buffersButton,
    () =>
      scratchpad.list().map((b) => ({
        id: b.id,
        label: b.label,
        // `b.leg`, NOT THE LITERAL `'lambda'` — 5d-iv T5 REVIEW FIX. `BufferInfo` gained `leg` in this
        // task precisely so this join could read a TM buffer's own leg instead of assuming every buffer
        // is a λ one; hard-coding `'lambda'` here made a TM buffer's row read 0 panes always, so a row
        // could say "orphan" while a TM pane was bound to it — `panes.ofSession`'s own generic
        // parameter is what a caller narrows to answer either leg's question.
        paneCount: panes.ofSession(b.leg, b.id).length,
        /**
         * **THE ROW'S ONE DISTINGUISHING FACT, JOINED HERE FOR `paneCount`'s REASON** — see
         * `BufferRow.term` for why a row without it is a counter's output and a pane count, with every
         * pane count alike at the cap, under a refusal telling the user to pick one. `ScratchBuffers`
         * answers what buffers exist and the registry answers what each one currently holds; this file
         * is the one place that holds both, so the join costs one property on a thunk that already runs
         * once per open.
         *
         * `hist.current`, WHICH IS THE FRAME A PANE BOUND TO THIS BUFFER WOULD BE SHOWING — the head of
         * the ring, not step 0 — so a row and a pane never disagree about the same buffer, and scrubbing
         * a buffer's history changes what its row says next time the list opens.
         *
         * **`legOf` IS ASKED ONLY FOR A WARM BUFFER, AND THIS BRANCH IS WHY THE PARAGRAPH THAT USED TO BE
         * HERE IS GONE.** A cold buffer is in `#buffers` and in neither container (5d-ii-d design §4.2), and
         * `SessionRegistry.entryOf` throws for an id it does not hold (`sessions.ts`'s `entryOf`,
         * deliberately: a binding naming a session the registry does not hold "is a wiring bug, not a state
         * the UI has an honest rendering for"). Unbranched, the first open of this list on a page that
         * restored an orphan threw out of a `beforetoggle` handler, which is a click.
         *
         * **THE BRANCH IS ON `warm` AND NOT ON A `try`.** A cold buffer is a state this app produces
         * on purpose, so asking and catching would be treating a designed state as an exception — and
         * it would also swallow the genuine wiring bug the throw exists to report.
         *
         * **A SECOND BRANCH, ON `b.leg`, IS WHAT KEEPS THIS FROM THROWING FOR A WARM TM BUFFER TOO —
         * 5d-iv T5 REVIEW FIX.** `legOf({ session: b.id, leg: 'lambda' })` unconditionally is a throw for
         * any warm buffer whose entry has no `lambda` leg at all — every TM buffer, by `#spawn`'s own
         * construction (`scratch.ts`'s own doc) — which escaped the `beforetoggle` handler exactly the
         * way the cold case above used to. `TmState` (`types.ts`) carries no printable `text` field the
         * way `LambdaState` does — a configuration is tape windows and a state index, not a term to
         * print — so there is no equivalent string to join for a TM row today; it reads `null` (`no term
         * yet` in the row) rather than inventing one.
         *
         * For what this doc used to claim and why it changed, see the history note under `buffers` —
         * the row builder's `term`.
         */
        term: b.warm
          ? b.leg === 'lambda'
            ? (sessions.legOf({ session: b.id, leg: 'lambda' }).hist.current?.text ?? null)
            : null
          : null,
        warm: b.warm,
        leg: b.leg,
      })),
    (id) => {
      // WHAT UNDO NEEDS, READ BEFORE THE DELETE ENDS IT: the record, the name, and the views showing it.
      const record = scratchpad.recordOf(id)
      const name = scratchpad.nameOf(id) ?? 'a copy'
      const shown = record === null ? [] : panes.ofSession(record.leg, id).map((p) => p.id)
      scratchpad.retire(id, SOURCE_SESSION, paneHost.reseedingSlots())
      try {
        custody.reconcile()
      } finally {
        refreshBuffers()
        draw()
      }
      // THE DELETE NOTICE ANSWERS THE CAP REFUSAL: it replaces any refusal on screen.
      if (record !== null)
        notices.notify(`${name} deleted`, { action: { label: 'undo', run: () => undo(record, shown) } })
    },
    (id, warm) => {
      /**
       * **WARMING CAN BE REFUSED AND COOLING CANNOT**, so only one arm has a catch. `ScratchBuffers.warm`
       * raises `BufferCapReached` at the cap for the same reason `fork` does, and it reports through the
       * same surface — a notice (`notice.ts`).
       * A bare `catch` would swallow `SessionRegistry.add`'s and `SessionPool.bind`'s guards, which are
       * wiring bugs; `instanceof` is what keeps a refusal a refusal.
       */
      const info = scratchpad.list().find((b) => b.id === id)
      const name = scratchpad.nameOf(id) ?? 'a copy'
      const shown = info === undefined ? 0 : panes.ofSession(info.leg, id).length
      try {
        if (warm) {
          scratchpad.warm(id)
        } else {
          // **THE SLOTS ARGUMENT IS WHAT MAKES THE INVARIANT TRUE, AND THIS IS ITS ONLY REAL CALL
          // SITE.** `cool` rebinds every pane on the buffer it sleeps, so "a cold buffer has no panes
          // bound to it" is a property of what this line passes, not of `ScratchBuffers`. Hand it the
          // same set the retire handler above hands `retire` — every slot on the page —
          // because a partial set strands exactly the panes it omits: `entryOf` throws for a session the
          // registry no longer holds, and `draw()` resolves through it on the next frame.
          scratchpad.cool(id, SOURCE_SESSION, paneHost.reseedingSlots())
        }
      } catch (e) {
        if (!(e instanceof BufferCapReached)) throw e
        notices.notify(e.message)
        draw()
        return
      }
      try {
        custody.reconcile()
      } finally {
        refreshBuffers()
        draw()
      }
      if (warm) notices.notify(`${name} resumed at step 0`)
      else
        notices.notify(
          `${name} paused${shown === 0 ? '' : ` · ${shown === 1 ? '1 view now shows' : `${shown} views now show`} the program`}`,
        )
    },
    () => {
      /**
       * **THE SECOND GESTURE — 5d-iv design §4.7.** `ScratchBuffers.fork` detaches a pane onto a copy of
       * what it was showing, and is unavailable above the fork cap; `forkBlank` mints a warm, empty
       * buffer on `leg` with no view to seed from and binds no pane, and is always available — "give me
       * somewhere to paste a `.tm` file" is a different intention from a fork, not the same door
       * narrowed. `'tm'` IS THE ONLY LEG THIS BUTTON EVER MINTS: the menu's own control is `buffer-list.
       * ts`'s *new TM copy*, built for the TM pane specifically because a λ buffer already has a seed
       * — the source's own step-0 term, through `fork` — and a TM buffer does not (`ScratchBuffers.
       * forkBlank`'s own doc: the TM pane renders a δ-table projected from a compiled program, never the
       * machine source that produced one).
       *
       * `BufferCapReached`, NOT A BARE `catch` — the same standard the retire and temperature handlers
       * above hold themselves to. The other throws `forkBlank` can reach are `SessionRegistry.add`'s and
       * `SessionPool.bind`'s guards over their own invariants; showing one of those as a notice
       * would swallow a wiring bug rather than report a refusal.
       */
      let id: SessionId
      try {
        id = scratchpad.forkBlank('tm')
      } catch (e) {
        if (!(e instanceof BufferCapReached)) throw e
        notices.notify(e.message)
        // NO `refreshBuffers()` ON THIS ARM — the header's count did not move, because that is the
        // whole content of the refusal (`transport.ts`'s `detach` handler states the identical rule for
        // `fork`'s own refusal).
        return
      }
      // THE HEADER GAINED A BUFFER, AND `draw()` DOES NOT REACH ITS READOUT — the same split `fork`'s
      // own success path draws (`transport.ts`): `refreshBuffers()` repaints the buffer-list button and
      // persists the collection, `draw()` repaints every pane's own chrome, most importantly the
      // binding selector that gains this buffer as a new option the instant it exists.
      refreshBuffers()
      draw()
      notices.notify(`${scratchpad.nameOf(id) ?? 'a copy'} created`)
    },
  )

  /**
   * Put the header's readout back in step with how many buffers there are — called at the two moments
   * that number can change, a fork and a retire, and now a third that cannot.
   *
   * **THE TEMPERATURE HANDLER CALLS THIS TOO, AND A WARM OR A COOL CANNOT MOVE THE COUNT THIS PARAGRAPH
   * USED TO CLAIM WAS EXHAUSTIVE.** This function reads `scratchpad.list().length` — every record this
   * app holds, warm or cold — and `warm`/`cool` only flip a record's own `warm` flag; neither one adds a
   * record nor removes one, so the number below is already correct before this call runs. It is called
   * anyway, for uniformity with the retire path immediately above in this file: the temperature handler
   * mirrors that handler's `custody.reconcile()` / `finally` / `refreshBuffers()` / `draw()` shape line
   * for line (its own comment states why the `custody.reconcile()` obligation is independent), and a
   * guard here that skipped this one call for `cool` while keeping it for `retire` would be two
   * near-identical handlers doing their shared cleanup differently over a distinction — whether the
   * count moved — that this function's OTHER job does not care about: the readout below and the
   * persisted payload it triggers are exactly as correct to recompute on a cool as on a retire, since
   * both examine the count rather than assume it changed.
   *
   * For what this doc used to claim and why it changed, see the history note under `refreshBuffers` —
   * the hide-at-zero rule and the focus-restoration branch.
   */
  const refreshBuffers = (): void => {
    const live = scratchpad.list().length
    // **NO HIDE-AT-ZERO, AND NO FOCUS RESTORATION BESIDE IT — 5d-iv design §4.7.** This function used
    // to read `buffersButton.hidden = live === 0`, plus a line moving focus to the reset-preset button
    // when retiring the last buffer hid the control the click had landed on. That is item 1 of the
    // standing accessibility list, "a control that hides itself on click strands the keyboard"; the
    // menu now offers *new TM copy* and so is never empty, which removes the reason for the hide and
    // therefore the workaround. One instance retired, not the pass discharged.
    buffers.update(live)
    /**
     * **THE PERSIST RIDES ON THIS FUNCTION BECAUSE ITS CALLERS ARE ALREADY THE RIGHT SET.** The doc
     * above spends four paragraphs establishing exactly when this runs — a fork, a retire, and a
     * warm/cool that cannot move the count but is called anyway for uniformity — and the first two of
     * those are two of the five moments the stored payload would say something different (the other
     * three reach `persistBuffers` directly: a recorded term, a rebind, and the write-back at the end of
     * `main()`). A `persistBuffers()` in the fork and retire handlers instead would be two copies of a
     * rule this function already states once, and a third in the temperature handler that writes the
     * same bytes back.
     *
     * **AND IT IS WHY THE INITIAL CALL BELOW IS NOT THE LAST WRITE OF A PAGE LOAD.** This runs once
     * during start-up, before `applyLayout()` has built a single pane, so the `bindings` it writes are
     * empty by construction — correct for a fresh page and WRONG for a restored one, which would then
     * persist a payload naming buffers but no panes and lose every binding at the next reload. The
     * write after the first `applyLayout()` at the end of `main()` is what corrects it, and nothing can
     * observe the intermediate: there is no `await` between here and there.
     *
     * **THIS CALL IS UNCONDITIONAL — EVERY PAGE LOAD, EVERY USER, INCLUDING ONE WHO HAS NEVER FORKED —
     * AND THE WRITE STILL IS.** `refreshBuffers()`'s own call below runs once at start-up with no guard
     * on `live`, so on a page with no buffers this still writes `{minted:0,buffers:[],bindings:{}}` — an
     * empty payload, carrying nothing worth saving. Harmless: **THE REPORT `writeBuffersStorage` NOW
     * MAKES ON A FAILED WRITE IS WHAT GOT GUARDED, NOT THE WRITE ITSELF.** `persistBuffers` hands that
     * writer whether the payload it just built has any buffers in it, and the writer's catch checks that
     * before it reports — design §4.8's "a lost buffer is work" read the other way: no buffers, no work,
     * no report. A user sitting at storage quota who has never forked still pays for this call (a write
     * that goes nowhere, silently, exactly as before) but not for a report that would be false in the
     * only sense they would care about — they have no work here to lose.
     */
    persistBuffers()
  }
  // **NOT CALLED HERE ANY MORE, AND THAT WAS A CRITICAL.** This used to be the very next line, and
  // `linkWiring`/`draw`/`view` are all still `undefined` at this point in `main()` — a restored page's
  // first buffers write, refused, threw a bare `TypeError` out of `main()` and killed the page. The
  // call is still made, unconditionally, on every page load; it has just moved past all three
  // assignments and past the app's own initial `compile.schedule(SAMPLE)`. That call site, near the end
  // of `main()`, carries the argument — including which of those constraints Plan 7 part 2 spent.

  /**
   * THE LINK STATE — `link-wiring.ts`'s own doc has the argument for why `index`/`linkable`/`link`
   * live there now instead of as `let`s in this scope. `panes` IS HANDED OVER EMPTY,
   * NOT "AFTER BOTH PANES EXIST" AS THIS USED TO READ — `PaneCollection` is built above and
   * `applyLayout` (`pane-host.ts`) is the only thing that ever populates it, so every reader here
   * resolves it live rather than at construction time.
   *
   * **THIS PARAGRAPH USED TO GO ON TO CLAIM "NOTHING IN THIS MODULE READS `panes` BEFORE
   * `applyLayout`'s FIRST CALL HAS RUN", AND THE `reportStorageFailure` MOVE MADE THAT FALSE — 5d-ii-d
   * review round 2, Finding 1.** `refreshBuffers()`'s start-up call (this function's own doc has the
   * full argument for where it sits) can now reach `reportStorageFailure()` reaches `draw()` reaches
   * `linkWiring.drawLink(...)` reaches `detachedPanes()` here — `theLambdaSlot()`/`theTmSlot()` read
   * `panes.active(...)` — all before `paneHost.applyLayout()` has ever run once.
   *
   * **TWO MORE CALLS REACH `draw()` BEFORE `applyLayout()` DOES, NEITHER THROUGH
   * `reportStorageFailure()`.** `compile.schedule(SAMPLE)` — this file's own start-up compile — is now
   * the first `draw()` of the app's life, ahead of the one inside `paneHost.applyLayout()` itself,
   * reached through `client.supersede()`'s `onSupersede` callback. The restore's warming loop reaches
   * it the same way, once per warmed session: `scratchpad.warm(session)` spawns a worker, and the spawn
   * calls `client.supersede()` too. `draw()`'s own body (`draw.ts`) reads `panes` three more times
   * before it gets that far, regardless of which of the three paths reached it: `panes.active('lambda')`/
   * `panes.active('tm')`, `panes.all()` and `panes.of('lambda')`.
   *
   * **STILL SAFE, AND FOR A REASON THAT HAS NOTHING TO DO WITH ORDERING.** `applyLayout` remains the
   * only thing that ever populates `panes`, so every one of those reads runs against a collection that
   * is genuinely, honestly EMPTY at this point — not stale, not partially built. `panes.active(...)` is
   * optional-chained everywhere it is called, `panes.all()`/`panes.of('lambda')` iterate zero entries,
   * and `detachedPanes()` answers `{lambda: false, tm: false}` (`DetachedPanes`'s own doc: a leg with no
   * pane reads `false`, the honest answer rather than a lucky one). The true invariant this paragraph
   * can still state is narrower than the one it used to: nothing in this module MISBEHAVES for reading
   * `panes` before `applyLayout`'s first call — every reader here resolves it live and every reader
   * tolerates empty, which is what makes reading it early safe rather than merely unobserved.
   *
   * `view` and `draw` are passed as thunks rather than the values themselves: `view`
   * is not assigned until the `EditorView` construction below, and `draw` (assigned via `createDraw`
   * just below) calls `linkWiring.drawLink` at its own end while `linkWiring.setLinkTo` calls `draw`, so
   * one of the two directions has to be late-bound either way.
   */
  linkWiring = createLinkWiring({
    view: () => view,
    statusHost: linkStatusHost,
    sessions,
    panes,
    draw: () => draw(),
    announce: (t: string) => notices.announce(t),
  })

  // ASSIGNED HERE, NOT DECLARED HERE — see the `let draw` comment above for why the split is forced
  // rather than stylistic. `panes` and `linkWiring` both exist as real values by this point (`panes` is
  // still empty until `applyLayout` first runs, near the end of this function — see `linkWiring`'s own
  // comment just above), which is what `createDraw` wants; `view` is still a thunk, for the same reason
  // `linkWiring` above takes it as one.
  //
  // `leaves` IS A NEW DEP (T12) — `leaves: () => leaves(tree).length`, resolved live against the tree
  // rather than a number captured once, because a split or a close changes it and `draw()` runs on
  // every recorded frame during playback. `draw.ts` itself never imports `layout.ts`: `setLayoutControls`
  // needs a leaf count, not a tree, and handing it a thunk over a raw number is what keeps `draw.ts`
  // from holding a second, possibly-stale opinion about the shape `main.ts` already tracks.
  //
  // `sourceAvailable` IS THE SAME ARRANGEMENT FOR THE SPLIT PICKER'S THIRD INPUT — whether a split may
  // be offered the SOURCE pane, which is true exactly while the tree holds no source leaf. It is the
  // same predicate `splitLeaf` refuses on (`kind === 'source' && hasSource(root)`), asked here so the
  // menu never offers what that call would throw on; `layout.ts` keeps its own copy private because a
  // tree operation must enforce its invariant whatever the UI believes.
  draw = createDraw({
    view: () => view,
    sessions,
    panes,
    links: linkWiring,
    leaves: () => leaves(tree).length,
    sourceAvailable: () => !leaves(tree).some((l) => l.pane === 'source'),
    // WRAPPED RATHER THAN PASSED AS `custody.hasEditor`, the same shape `editorHome` below uses for
    // `custody.homeFor`: the methods read `panes`, `sessions` and the two custody maps through the
    // closure `createEditorCustody` returns, and handing the reference over bare would work today only
    // because that object is not built with `this` in mind. This is the one call site that decides
    // whether "move the editor here" appears at all — deferred-a11y item 11.
    hasEditor: (session) => custody.hasEditor(session),
    // THE READOUT'S INPUTS (spec §9) — which view is focused, and the program's stored result.
    focused: focusedLeaf,
    sourceSession: SOURCE_SESSION,
    readout,
    program: () => program,
    nameOf: (s) => scratchpad.nameOf(s),
    stepsInView: () => ws.switches.steps === 'view',
    stage: () => ws.switches.views === 'stage',
    stepBar,
  })

  // NOT the refreshBuffers() start-up call's home either, though linkWiring/draw are real by here:
  // `view` still is not. The call site near the end of `main()` carries the argument.

  /**
   * THE DEBOUNCE PIPELINE — `compile.ts`'s own doc has the case for `schedule`'s dependencies and for
   * the `supersede()`-before-`setTimeout` ordering that must not move; this is only the construction
   * site. A PLAIN `const`, SAME REASON `replies` BELOW IS ONE: `linkWiring` is a real value by this
   * line, so this needs none of the `let` + thunk indirection `draw`/`linkWiring` themselves used two
   * blocks up. `view` is still passed as a thunk — the picker's `change` listener `compile.ts` wires at
   * construction reads it, and `main.ts` does not assign `view` until the `EditorView` construction
   * below.
   *
   * **IT PASSED `scratchpad`, `panes`, `draw` AND `reconcileEditors` UNTIL 5d-ii-c DECISION 2, and all
   * four served the retire a source keystroke used to perform.** A recompile ends no buffer now
   * (`compile.ts`'s `schedule` records what the deletion cost and what replaced it), and a compile needs
   * nothing but the source session's own client — so this call site shrank with the signature rather
   * than going on handing over dependencies nothing reads. **THE CUSTODY ARGUMENT FOR `reconcileEditors`
   * WAS SAID TO LIVE AT `createReplies`'s CALL BELOW, "WHICH STILL SWEEPS AT THE APP'S REMAINING RETIRE
   * SITE"** — that site is gone too, so the argument lives at `editor-custody.ts`'s `reconcileEditors`
   * and at its callers: `applyLayout`, and the buffer list's retire handler above in this file.
   *
   * For what this doc used to claim and why it changed, see the history note under `compile`.
   */
  const compile = createCompile({
    sessions,
    results,
    picker,
    view: () => view,
    sourceSession: SOURCE_SESSION,
  })

  /**
   * THE TWO REPLY SWITCHES — `replies.ts`'s own doc has the case for why they are one module and what
   * each depends on; this is only the construction site. LAST OF THE FIVE FACTORIES (`transport`,
   * `linkWiring`, `draw`, `compile`, `replies`), AND A PLAIN `const` RATHER THAN A `let` + THUNK LIKE
   * `draw`/`linkWiring` ABOVE — nothing calls `createReplies` before everything it needs already
   * exists: `linkWiring` and `draw` are both real values by this line, and both are passed bare below
   * for exactly that reason — same as `compile` just above does for the same two. `view` is still
   * passed as a thunk for the same reason `linkWiring`/`draw` themselves take it as one two blocks up.
   *
   * `scratchpad` AND `sessions.add(...)` ABOVE ALREADY BUILT THEIR REPLY CALLBACKS AGAINST A NAME —
   * `replies` — THAT DID NOT EXIST YET AT THAT POINT IN THE FILE, and that is the same forward
   * reference this file already relies on for `draw`/`linkWiring` themselves: `(session, reply) =>
   * replies.onScratchReply(session, reply)` and `(reply) => replies.onReply(SOURCE_SESSION,
   * reply)` are arrow function BODIES, not evaluated until a reply actually arrives, by which time this
   * assignment has long since run.
   */
  const replies = createReplies({
    sessions,
    scratchpad,
    results,
    view: () => view,
    panes,
    links: linkWiring,
    draw,
    notify: (text: string) => notices.notify(text),
    setProgram: (r: ProgramResult) => {
      program = r
    },
    // **IT TAKES THE REPLY'S OWN SESSION, WHERE IT USED TO BE BOUND TO ONE.** Both call sites in `replies.ts`
    // already hold the session the reply named, so the parameter costs nothing. THIS FILE KEEPS IT WHERE
    // `compile.ts` TAKES NOTHING OF THE KIND, because `replies.ts` has two uses that are not retires:
    // `scratch-compiled` MOUNTS text onto the home pane, and `worker-error` unmounts from a pane whose
    // session is still live and still bound.
    //
    // **`sourceSession` AND `reconcileEditors` WERE PASSED HERE UNTIL DECISION 2's SECOND DELETION**,
    // and both served the retire inside `noSessionReply`'s phantom-fork path — a home for its panes to
    // be sent back to, and a sweep so no `ScratchEditor` outlived the session it killed. That path ends
    // no buffer now (`replies.ts`'s own arm records what the user loses with it), so both arguments
    // followed the same four `compile.ts` shed one task earlier. `custody.reconcile` is unchanged and
    // still reached on every layout gesture through `applyLayout`.
    //
    // For what this doc used to claim and why it changed, see the history note under `replies`.
    editorHome: (session: SessionId) => custody.homeFor(session),
    // BARE, NOT A THUNK, for the reason the doc above gives for `links` and `draw`: `persistBuffers` is
    // a real value hundreds of lines before this call.
    onBuffersPersist: persistBuffers,
  })

  view = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: SAMPLE,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        // ABOVE BOTH KEYMAPS BELOW, NOT BETWEEN THEM — `editor-keymap.ts`'s `keymapSlot` has the
        // mechanism, and it is about DOM event handlers rather than about key bindings.
        keymapSlot(keymapSetting.mode),
        keymap.of(
          navKeymap({
            uri: () => SOURCE_URI,
            client: () => lspClient,
            reveal: (range) => revealRange(view, range),
            notify: (text) => notices.notify(text),
          }),
        ),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // `colourFor`, NOT A SECOND `treeSitterColour` CALL SPELLING THE SAME FIELDS OUT. The two used
        // to be written separately and the ceiling notice reached neither; see `colourFor`'s doc.
        colourFor('redextape'),
        lspHover({ uri: () => SOURCE_URI, client: () => lspClient }),
        declineMark,
        linkMark,
        focusMark,
        // AN EXPLICIT CLICK, NOT A CARET MOVE. Clicking an editor already means "place the caret", and
        // linking on every arrow key would fire constantly while navigating — and, worse, would have
        // to be airtight about the stale-index rule on every keystroke rather than only on clicks.
        // `mouseup` rather than `mousedown`, so a drag that selects text does not also link.
        EditorView.domEventHandlers({
          // NO FLUSH HERE, UNLIKE A COPY'S. This editor posts `changeDocument` on every keystroke
          // rather than on a debounce, so the server's copy is never behind what is on screen.
          blur: () => {
            if (!formatOnBlur) return false
            lspClient
              .format(SOURCE_URI)
              .then((edits) => applyEdits(view, edits))
              .catch(() => {
                // The client reports the server; a blur is not the place to repeat it.
              })
            return false
          },
          mouseup: (event, v) => {
            const pos = v.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos === null) return false
            // CodeMirror positions are UTF-16 indices; the index speaks bytes. `Buffer` is not
            // available in a browser, so the conversion goes through the same `TextEncoder` the
            // byte/UTF-16 split already forces everywhere else in this app.
            linkWiring.linkAtSourceOffset(new TextEncoder().encode(v.state.doc.sliceString(0, pos)).length)
            return false
          },
        }),
        // The keyboard route to the same thing. `Mod-'` is unbound in `defaultKeymap` and in
        // `historyKeymap`; verify that before changing it. Reachability without a mouse is the whole
        // point — the roadmap defers the rest of accessibility to one pass at the end of Plan 5, but a
        // mouse-only primary interaction would have to be retrofitted by that pass rather than
        // adjusted.
        keymap.of([
          {
            key: "Mod-'",
            run: (v) => {
              const pos = v.state.selection.main.head
              linkWiring.linkAtSourceOffset(new TextEncoder().encode(v.state.doc.sliceString(0, pos)).length)
              return true
            },
          },
        ]),
        // `lintGutter()` STAYS AND `lintFromAnalyze` GOES. Diagnostics are PUSHED now, from the
        // LSP worker through `setDiagnostics` below, so there is nothing for a `linter` source to
        // pull. The gutter is the surface either way.
        lintGutter(),
        // DEFERRED-ACCESSIBILITY ITEM 16. CodeMirror gives its content a `textbox` role and no
        // name; on a workspace showing three editors at once they all announced the same way.
        EditorView.contentAttributes.of({ 'aria-label': 'source program editor' }),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          const src = u.state.doc.toString()
          // NO HIGHLIGHTING DISPATCH HERE ANY MORE. `classifySource` used to be called synchronously on
          // this line, in the same frame as the keystroke; the colourer above is a `ViewPlugin` that
          // reparses from this same update without being told, so there is nothing for this listener to
          // push. See `colour.ts`'s two-clocks paragraph.
          //
          // NOT DEBOUNCED, unlike `compile.schedule` below. `@codemirror/lint`'s 100 ms delay was
          // a PULL-side debounce and there is no pull any more; the server costs 0.15 ms on a
          // source document of this size, measured, and it is on another thread.
          lspClient.changeDocument(SOURCE_URI, src)
          // STALE FROM THIS KEYSTROKE UNTIL THE NEXT COMPILE. `linkMark` clears its own decoration on
          // `docChanged`; this clears the state behind it, the status line, AND THE OTHER TWO PANES —
          // design §6 case 4 requires all three cleared, not only the source echo. Before this, the λ
          // window and the δ-table's `.is-linked` rows stayed painted from the PREVIOUS index until the
          // next `compiled` reply landed — up to `DEBOUNCE_MS` plus a compile, seconds on a larger
          // program — while the status line already said "linking resumes when this compiles".
          //
          // A SECOND `drawLink()`/`renderLink()`/`setLink()` CALL SITE, DELIBERATELY — none of this is
          // redundant with `draw()`'s. Nothing here calls `draw()`: `lam.hist`/`tm.hist` have not
          // changed, so repainting both panes on every keystroke would be pure waste. But all three
          // panes still have to go stale THIS keystroke, not 300 ms from now when `compile.schedule`'s
          // debounce finally lands a `compiled`/`no-session` reply — so each gets its own direct, targeted call
          // rather than waiting for `draw()` to earn one. Passed `null`/`[]`/`false` rather than
          // resolving anything: `linkable` is already false on the line above, and every one of these
          // reads that (`drawLink` directly; `renderLink`/`setLink`/`setFocus` take the already-cleared
          // view) before it would ever look at what is linked or focused.
          //
          // `setFocus([])` TOO, NOT ONLY `setLink` — the running focus is the δ-table's own second
          // highlight layer (`TmPane`'s own doc) and goes stale on this same keystroke, for the same
          // reason `.is-linked` does: `tm.hist` is untouched by a keystroke, so without this call the
          // previous program's focused rows would stay painted until the next `compiled` reply.
          // `focusMark` (the CodeMirror decoration) needs no matching call — it clears itself on
          // `docChanged`, same as `linkMark`.
          //
          // AND IT RUNS BEFORE `setLink`, WHICH IS THE ONE THAT DRAWS. `setFocus` is a pure setter (its
          // own doc says why); `setLink` is what calls `#drawTable`, so it has to be the LAST of the two
          // or the cleared focus would not reach the DOM until some later draw. Same rule `draw()`
          // follows by putting its own `setFocus` ahead of `tmPane.render`.
          //
          // PER-LEG, FANNED OUT THROUGH `panes` (T7) — every pane on a leg follows the same app-wide
          // link state, matching `draw.ts`'s and `link-wiring.ts`'s identical loops. THERE ARE NO
          // `lambdaPane`/`tmPane` LOCALS TO CALL STRAIGHT THROUGH ANY MORE (T12): `applyLayout` builds
          // every pane from the tree's leaves, so a leg can now hold more than one, and the collection
          // is the one route every consumer of this rule shares.
          linkWiring.clearLink()
          linkWiring.drawLink(null, false)
          for (const p of panes.of('lambda')) (p.pane as LambdaPane).renderLink(null)
          for (const p of panes.of('tm')) {
            const pane = p.pane as TmPane
            pane.setFocus([])
            pane.setLink([], false)
          }
          compile.schedule(src)
        }),
      ],
    }),
  })

  // JOINED AFTER CONSTRUCTION, because `follow` takes the view the assignment above was still
  // building. The slot above already holds this mode; joining is what carries a LATER change into it.
  keymapSetting.follow(view)

  /**
   * The source view's outline — the panel primitive's newest consumer.
   *
   * **CLOSED UNLESS THE WORKSPACE SAYS OTHERWISE**, unlike the TM rules panel which defaults open.
   * A rules table is what a TM view is for; an outline is a way of navigating a file, and a list
   * of every `fn` taking room above the editor on a first visit is a cost paid by everyone for
   * something few will have asked for yet.
   */
  const sourceOutline = createOutlinePanel({
    open: ws.panels[SOURCE_LEAF]?.outline ?? false,
    onToggle: (open) => {
      ws = { ...ws, panels: withPanel(ws.panels, SOURCE_LEAF, 'outline', open) }
      persistWorkspace()
    },
    symbols: () => lspClient.documentSymbols(SOURCE_URI),
    reveal: (range) => revealRange(view, range),
  })
  // INSERTED RATHER THAN APPENDED: the panel sits between the view's header and its editor, and
  // it is built here — after `ws`, `persistWorkspace` and `view` all exist — rather than where
  // the rest of the source view is assembled.
  sourceHost.insertBefore(sourceOutline.panel.el, editorHost)

  // **BUILT AFTER `view`, AND THE FACTORY IS WHERE THE FAILURE POLICY LIVES** — the reason
  // `SessionPool` takes one too: a notice needs the app's DOM, and this module is the one that
  // has it.
  // **THE SINK IS PART OF OPENING THE DOCUMENT**, so there is no router to keep in step and no way
  // for this editor to receive another document's diagnostics. Every copy's editor opens its own the
  // same way, from inside `ScratchEditor`.
  lspClient.openDocument(SOURCE_URI, 'redextape', SAMPLE, {
    diagnostics: (ds) => {
      view.dispatch(setCmDiagnostics(view.state, lspLintRanges(ds, view.state.doc)))
      // ONE SETTLED EDIT, ONE PUBLISH — so this is the cheapest signal that the server has caught
      // up with the document, and the outline asks only while it is open.
      sourceOutline.refresh()
    },
  })
  sourceMenu.setFormattable(true)

  compile.schedule(SAMPLE)

  // **THE START-UP CALL, AFTER `compile.schedule(SAMPLE)`, AND THE ORDERING THAT FORCED IT IS SPENT.**
  // This call sat right after `refreshBuffers`'s own definition until 5d-ii-d, and moved three times:
  // `reportStorageFailure` wrote through `linkWiring` and `draw()`, both `let`s that stay `undefined`
  // until far below that definition, so an early call threw a `TypeError` and killed the page; and a
  // call placed after `view = new EditorView(...)` was wiped by `compile.schedule(SAMPLE)`'s own
  // unconditional clear of the fork-failure line before anyone could read it.
  //
  // **NEITHER CONSTRAINT SURVIVES PLAN 7 PART 2.** The report is the notice line's resting state
  // (`notice.ts`'s `Notices.rest`), set through `notices`, which is built before `init()` and needs
  // neither `linkWiring`, `draw` nor `view`; and nothing clears the notice line on a keystroke. What
  // still holds is the thing this position was always really about: `persistBuffers` reads its bindings
  // off `panes`, which `applyLayout()` — at the end of `main()` — is the only thing that fills, so the
  // payload written here is provisional, and the write-back after that call is what corrects it. See
  // `refreshBuffers`'s own doc.
  refreshBuffers()

  /**
   * **WARM BOUND, COLD ORPHANS — design §4.2's restore policy, and the cap is what makes it a `try`.**
   * A cap that dropped between releases can leave a restored page naming more warm buffers than it may
   * now hold. Refusing is the honest answer (nothing is evicted); the buffer stays cold and stays
   * listed, which is exactly the state the header list exists to make reachable.
   *
   * **THE THIRD STEP OF THE RESTORE, AND IT IS DOWN HERE RATHER THAN BESIDE THE OTHER TWO FOR A
   * REASON THAT HAS GONE.** The refusal has to reach a surface, and it used to be `link-wiring.ts`'s
   * `linkWiring`, not assigned until two hundred lines below the restore block; it is a notice now
   * (`notice.ts`), the surface the fork path and the header list's warm control both report through. Everything this loop does is still
   * before the first `applyLayout()` just below, which is the only ordering the restore actually
   * requires: `pendingBinding` is read there, not here.
   *
   * **NOT `cannot make a copy — …`, AND THAT IS A DECISION RECORDED HERE — 5d-ii-d review round 2, Finding
   * 3.** `scratchpad.warm(session)` is what this loop calls, never `fork`, and `#link-status` used to
   * say "fork failed" about it anyway only because `link-status.ts` prefixed every fork-failure value
   * the same way regardless of writer. A restore is not a fork: nothing here was clicked, nothing here
   * even runs in response to a gesture this page load has seen yet — it is `main()`'s own start-up code
   * discovering that a cap lowered since a previous page's write left more warm buffers named than the
   * current build allows. `ScratchBuffers.warm`'s `BufferCapReached` (`scratch.ts`'s `#refuseAtCap`)
   * therefore carries no prefix at all now, here or from the header list's own warm control below —
   * `e.message` is the bare cap sentence, "all N copies are running; pause or delete one from the
   * copies menu to make room", true and complete without naming a gesture that did not happen.
   *
   * **IT WALKS `restoredBindings` AND NOT `restoredBuffers.bindings`, WHICH IS THE POLICY AND NOT A
   * TIDY-UP.** §4.2's rule is that a buffer a restored PANE names gets a worker; a binding the restore
   * block above declined to seed — one naming a leaf that is not a λ pane — has no pane and gets none,
   * so the load cost stays exactly the workers the layout needs. A binding naming a leaf the tree does
   * not hold at all is declined by the same line and for the same reason.
   *
   * `new Set(...)` BECAUSE TWO PANES MAY NAME ONE BUFFER. `warm` is idempotent for a buffer that is
   * already warm, so the set is not what makes this correct — it is what stops a page with two panes on
   * one buffer from spending a cap slot's worth of work per pane. Every value is a real buffer:
   * `parseBuffers` refuses a payload whose bindings name a session no restored buffer holds.
   *
   * **THE RE-SEED IN THE CATCH IS WHAT KEEPS THE COLD-BUFFER INVARIANT TRUE ACROSS A REFUSAL.** A cold
   * buffer must have no pane bound to it (`ScratchBuffers.cool`'s own doc) — `entryOf` throws for a
   * session the registry does not hold, and `draw()` resolves through it on the next frame — but the
   * binding for this buffer was seeded into `pendingBinding` two hundred lines up, so
   * `applyLayout`'s `?? SOURCE_SESSION` would not fire for it: the entry EXISTS, it just names a session
   * that now does not. Overwriting the seed with `SOURCE_SESSION` produces exactly what that `??` would
   * have, which is why `seedBinding` needed no deleting sibling.
   */
  for (const session of new Set(restoredBindings.map(([, s]) => s))) {
    try {
      scratchpad.warm(session)
    } catch (e) {
      if (!(e instanceof BufferCapReached)) throw e
      notices.notify(e.message)
      for (const [leaf, s] of restoredBindings) {
        if (s === session) paneHost.seedBinding(leaf, SOURCE_SESSION)
      }
    }
  }

  // THE FIRST RECONCILE, REPLACING THE BARE `draw()` THIS USED TO BE. `applyLayout()` builds the
  // lambda-0/tm-0 panes the default tree names, attaches every host (including `sourceHost`, built
  // above) into `<main>`, persists the tree, and calls `draw()` itself at its own end — so this is
  // still "one call, at the very end of `main()`, after everything else is wired" (`view` included:
  // `linkWiring`/`draw`/`compile`/`replies` all close over it as a thunk; `draw()`'s own body reads
  // `view()` directly, and has already done so above this line — once from
  // `compile.schedule(SAMPLE)`, and once per warmed session from the restore loop — both through
  // `client.supersede()`). **THE RESTORE'S WARMING LOOP NOW SITS ABOVE IT, AND WHAT SURVIVES IS
  // NARROWER THAN "READS NO PANE"**: each spawn's `client.supersede()` reaches `draw()` the same way
  // `compile.schedule(SAMPLE)` does, so the loop reads `panes` now too. `applyLayout` remains the only
  // thing that ever populates `panes` (`THE LINK STATE` comment above), so those reads run against a
  // collection that is genuinely empty, and it remains true that nothing before this line has BUILT
  // one.
  paneHost.applyLayout()
  // **THE SWITCHES ARE APPLIED AFTER THE FIRST LAYOUT, NOT BEFORE IT** (spec §4). A restored workspace can
  // carry any of the eight combinations, and each of part 2b's three consumers reads the tree or the panes
  // that `applyLayout()` above is what creates — so this is the earliest moment the page can be put in the
  // state the user left it in.
  applySwitches()

  /**
   * **GIVE EACH RESTORED BINDING'S SESSION AN EDITOR HOME, NOW THAT ITS PANE EXISTS — 5d-ii-d T9.**
   * Design §4.7 states the warm/mount pairing outright: "a cold buffer carries the flag unused; it
   * takes effect when the buffer WARMS AND MOUNTS AN EDITOR." Warming already happens (the loop above
   * `applyLayout()`); the mount does not, without this — `editor-custody.ts`'s `editorHomeFor` resolves
   * a session to a pane through `editorOwner`, and until this loop `editorOwner` had exactly two
   * writers, both gesture-driven (`pane-host.ts`'s wrapped `detach`, the moment a fork succeeds, and its
   * `showEditor`, every later move). Neither fires for a binding that arrives already on the page from
   * storage, so `replies.ts`'s `scratch-compiled` arm — the one place a mount happens — reached
   * `editorHome(session)` and got `undefined` for every restored session: `setText` and the persist
   * beside it ran, because those are unconditional on the reply, but `setEditor` never did. **Found by
   * writing the test this task asks for**, the first assertion anywhere that looks at `.term-editor`
   * rather than at `.term` for a restored buffer.
   *
   * **NOT BESIDE `seedBinding`, ABOVE `applyLayout()` — TRIED FIRST, AND WRONG.** `applyLayout`'s
   * pane-creation pass calls `custody.dropClaimsOn(l.id)` for every leaf THAT HAS NO PANE YET, on the
   * premise stated in that call's own comment: "a pane built here is by definition not the pane that
   * claimed anything... an id reaching this loop can only be INHERITING a claim, never restating one."
   * That premise held while every writer of `editorOwner` recorded a pane that already existed; claiming
   * before this line breaks it — on a fresh page load EVERY leaf has no pane yet, so a claim made before
   * `applyLayout()` runs is a claim this exact loop's own first `applyLayout()` call deletes as "stale"
   * before the pane it names is ever built. Below the call, the pane exists and this loop is claiming
   * the ordinary way: naming a pane already in `panes`.
   *
   * **A STALE CLAIM ON A CAP REFUSAL COSTS NOTHING, BY THE SAME RULE `editorHomeFor` ALREADY STATES.**
   * The warming loop above can refuse a session's `warm` and reseed its leaf onto `SOURCE_SESSION`
   * before this line runs, so the pane `applyLayout()` just built for that leaf is on `SOURCE_SESSION`,
   * not the scratch. `editorHomeFor` checks the pane's OWN binding against the session it is asked
   * about (`entry.slot.binding.session !== session`), so claiming that session for that leaf anyway
   * resolves to no home forever — the same "stale owner resolves to no home" rule every other caller of
   * `claim` already relies on, applied here rather than filtered out first.
   *
   * **IT IS NO LONGER THE ONLY THING MAKING A RESTORED BUFFER'S EDITOR MOUNT, AND IT IS KEPT ANYWAY —
   * whole-branch review before merge.** `pane-host.ts`'s creation pass now calls `mountScratchEditor`
   * for every λ pane it builds, which on this page load claims and mounts each restored binding's leaf
   * from the buffer's own text before this line runs — the fix for a DIFFERENT defect (a cooled buffer
   * warmed and re-bound could never be edited again), which happens to cover this one too because the
   * warming loop above `applyLayout()` has already made these buffers warm. This loop is therefore
   * belt-and-braces on the happy path and load-bearing on exactly one other: a binding whose `warm` the
   * cap REFUSED, where the pane was put back on `SOURCE_SESSION` and `editorSeed` answers `null` for a
   * cold buffer, so nothing mounted and nothing claimed. It stays because it is the statement of the
   * restore's OWN obligation — that a binding read out of storage names an editor home — where the line
   * above is about panes arriving.
   *
   * **THE `hasEditor` GUARD IS WHAT KEEPS THE TWO FROM DISAGREEING, AND WITHOUT IT TWO PANES ON ONE
   * BUFFER MADE THE EDITOR JUMP.** `claim` is last-write-wins, and `restoredBindings` can name one
   * session twice — `parseBuffers` accepts a `bindings` map with two leaves pointing at one buffer
   * deliberately (`tests/node/buffers-store.test.ts` pins it), and it is what a user who split a pane onto
   * a buffer and reloaded actually stores. Unguarded, this loop would then overwrite the creation pass's
   * claim with whichever leaf `Object.entries` yields LAST, while the editor stayed mounted on the pane
   * the creation pass gave it — leaving a stale claim that the next `applyLayout()`'s sweep acts on by
   * relocating a live editor the user did not move. That is the silent relocation `editor-custody.ts`'s
   * `editorOwner` doc refuses in as many words. With the guard, the rule is one sentence and it holds
   * from the first frame: **the editor mounts on the first λ pane in TREE order bound to that buffer, and
   * nothing moves it but a click.**
   *
   * **WHICH IS ALSO THE ANSWER TO A STATE THAT WAS PREVIOUSLY SILENT** (whole-branch review, finding 10a).
   * The old behaviour put the editor on whichever leaf `Object.entries` yielded last — an order that comes
   * from the JSON key order in `localStorage` and has nothing to do with where the editor was before the
   * reload, so a two-pane page could come back with its editor on the other pane for no reason a user
   * could see. Tree order is not "where it was" either — nothing persists which pane held the editor, and
   * design §4.7 puts the collapse flag on the BUFFER for the same reason — but it is stable across
   * reloads, visible on screen, and it does not move afterwards. Restoring the pane an editor was on is a
   * fourth field in `redextape.buffers` and is not added here.
   */
  for (const [leaf, session] of restoredBindings) if (!custody.hasEditor(session)) custody.claim(session, leaf)

  /**
   * **THE RESTORE'S OWN WRITE-BACK, AND THE ONE PERSIST SITE THAT IS NOT A USER GESTURE.** Every other
   * one runs because something changed; this one runs because the panes only just came into existence.
   * `persistBuffers` reads `bindings` off `panes.all()`, and until the line above there were no panes —
   * so the `refreshBuffers()` earlier in this function wrote a payload with an EMPTY `bindings` map. On
   * a fresh page that is correct and this call rewrites the same bytes; on a restored page it would
   * silently lose every binding at the next reload, which is the feature failing on its second use.
   *
   * **IT IS ALSO WHAT MAKES STORAGE SELF-CORRECTING, WHICH IS WORTH MORE THAN THE FIX.** A binding
   * naming a leaf the restored tree no longer holds is never consumed, and a buffer the cap refused to
   * warm had its pane put back on the source session above — in both cases the pane that exists now
   * disagrees with what was stored, and this write settles it in favour of the panes. Design §4.1's
   * "no repair pass" holds because the repair is one ordinary write of the ordinary payload.
   */
  persistBuffers()
  return view
}

/**
 * The app starts on import — `index.html` loads this module and nothing else.
 *
 * THE VIEW IS EXPORTED AS A PROMISE so the browser tests can drive the editor through CodeMirror's own
 * API rather than synthesizing key events into a contenteditable. Nothing in the product reads it.
 */
export const ready = main()
