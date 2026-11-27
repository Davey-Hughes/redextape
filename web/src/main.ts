import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { lintGutter, setDiagnostics as setCmDiagnostics } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import init, { captureClasses, encodings, fieldWidths, tokenClasses } from '../../pkg/redextape_wasm.js'
import {
  exampleItems,
  NARROW_WINDOW,
  presetName,
  shownSentence,
  toggleSentence,
  viewToggles,
  wireMenu,
  workspaceItems,
} from './app-header'
import {
  APPEARANCE_LABEL,
  type Appearance,
  applyAppearance,
  nextAppearance,
  readStored,
  STORAGE_KEY,
} from './appearance'
import {
  type Combination,
  combinationOf,
  cycleFrom,
  enter,
  keyOf,
  liveLeaves,
  reidentified,
  shapeOf,
  toggled,
} from './arrangements'
import { showBanner } from './banner'
import { schemeName } from './base16'
import { createBase16Dialog } from './base16-dialog'
import { BUILD } from './build-info'
import { watchIntent } from './clif-intent'
import type { ClifPane } from './clif-pane'
import { ClifSync } from './clif-sync'
import { type CaptureTable, classMapFrom, createGrammarRegistry, treeSitterColour } from './colour'
import { createCompile } from './compile'
import {
  CUSTOM_PALETTE_KEY,
  type CustomPalette,
  parseCustomPalette,
  serializeCustomPalette,
  withHalf,
  withoutHalf,
} from './custom-palette'
import { watchCutText } from './cut-text'
import { lspLintRanges } from './diagnostics'
import { createDraw } from './draw'
import { KeymapSetting, keymapSlot } from './editor-keymap'
import { KEYMAP_LABEL, KEYMAP_MODES, parseKeymapMode, readFormatOnBlur, writeFormatOnBlur } from './editor-prefs'
import { editorTab } from './editor-tab'
import { EXAMPLE_ENCODING, EXAMPLES, type Example, FIRST_LOAD } from './examples'
import { focusHolder, handOff } from './focus-handoff'
import { declineMark, focusMark, linkMark } from './highlight'
import { icon } from './icons'
import { LambdaTrees } from './lambda-trees'
import {
  closeLeaf,
  defaultArrangement,
  defaultLayout,
  LAYOUT_STORAGE_KEY,
  type LayoutNode,
  leafNumber,
  leaves,
  MAX_TREE_LEAVES,
  SOURCE_LEAF,
} from './layout'
import { LEGS } from './legs'
import { wireLinkClear } from './link-clear'
import { createLinkWiring, LINK_KEY, type LinkWiring } from './link-wiring'
import { LspClient } from './lsp-client'
import { lspHover } from './lsp-hover'
import { navKeymap } from './lsp-nav'
import type { LanguageId } from './lsp-protocol'
import { documentUri, LANGUAGE_IDS, LANGUAGE_LABEL } from './lsp-protocol'
import { applyEdits, revealRange } from './lsp-text'
import { MachineCode } from './machine-code'
import { createNotices, floatInRun, type Notice, type NoticeAction } from './notice'
import { createOutlinePanel } from './outline'
import { paletteDeclarations } from './palettes'
import type { PaneChoice } from './pane-chrome'
import { type AddRefused, createPaneHost, type LayoutEvent } from './pane-host'
import { createPanel } from './panel'
import { PanelStack, type Shares } from './panel-stack'
import { type LeafId, PaneCollection, type PaneKind } from './panes'
import { forgetCopies, PROGRAM_STORAGE_KEY, parseProgram, type StoredProgram, serializeProgram } from './program-store'
import type { ClifLoad, Leg, LegProgram, Listing, RunReply } from './protocol'
import { CLIF_ABSENT, HISTORY_BYTES } from './protocol'
import { createReadout, type ProgramResult } from './readout'
import { createReplies, type UnseenViews } from './replies'
import { type SessionId, SessionPool } from './session-client'
import { freshLeg, holdClifLeg, legControlState, rewindLeg, type SessionLegs, SessionRegistry } from './sessions'
import { decodeLink, isLink, type OpenedLink, type SharePayload } from './share-link'
import { createShare } from './share-popover'
import { LinkPositions, shortNotice } from './share-positions'
import {
  applySkin,
  customPaletteLabel,
  DEFAULT_PALETTE,
  PALETTE_CHOICE_LABELS,
  PALETTE_CHOICES,
  PALETTE_CSS_KEY,
  PALETTE_KEY,
  type PaletteChoice,
  readPaletteChoice,
  readStyle,
  resolvePalette,
  STYLE_IDS,
  STYLE_KEY,
  STYLE_LABELS,
} from './skin'
import { type BarTarget, barTarget, createStepBar } from './step-bar'
import { createTransport } from './transport'
import { assertTokenClasses } from './types'
import { createUnsaved, refusalOf } from './unsaved'
import { pairLabel, sourceViewHeader, viewMenu } from './view-header'
import { HINT_ROWS, HINT_SENTENCE, type ViewKeyAction, wireViewKeys } from './view-keys'
import {
  type DisplayLeg,
  defaultFocus,
  defaultWorkspace,
  type LegDisplay,
  legDisplayOf,
  PRESETS,
  parseSwitches,
  parseWorkspace,
  presetOf,
  type Speed,
  type Switches,
  serializeWorkspace,
  type Workspace,
  withLegDisplay,
  withLegDisplaysKept,
  withPanel,
  withPanelSizes,
} from './workspace'

/**
 * The counter behind every `LeafId` a split mints, shared across every leg — module-level rather than
 * per call to `main()`, though `main()` only ever runs once (`ready` below is computed on import).
 *
 * STARTS AT 1 ONLY FOR THE TREES A DEFAULT ARRANGEMENT BUILDS, whose leaves are `lambda-0`, `rxm-0` and `tm-0`.
 * **REASONING ONLY ABOUT THOSE COSTS THE FIRST SPLIT AFTER EVERY RELOAD**: `main()` restores a
 * tree from `localStorage` when there is one, that tree can already contain `pane-1` from a split in an
 * earlier page load, and `splitLeaf`'s collision guard then refuses the id `nextLeafId` mints — an uncaught
 * throw out of the click handler, no new pane, and nothing on screen to say why. `seedLeafCounter` below is
 * what makes the starting value a fact about the tree actually in hand rather than about the one a fresh page
 * would have had.
 */
let leafCounter = 1

/**
 * Advance `leafCounter` past every numeric suffix in `ids` — called on the views `main()` starts with, whether they
 * came from storage or from `defaultLayout()`, and on those of each workspace an opened link puts in force
 * (`showWorkspace`).
 *
 * **EVERY LIVE VIEW'S ID, NOT THE TREE ON SCREEN'S ALONE** (the view layouts spec §5.1): `arrangements.ts`'s
 * `liveLeaves`, so an id minted in one arrangement cannot be one a remembered arrangement holds for another view.
 *
 * FIX THE CALLER, NOT THE GUARD. `splitLeaf`'s refusal of an id already in the tree is deliberate and correct
 * (its own doc: a duplicate id would not error, it would silently make the second leaf unreachable).
 *
 * MAX-PLUS-ONE OVER ALL LEAVES, NOT PER LEG, because the counter is shared across legs. A leaf id with no number
 * (`'source'`, or a hand-edited `lambda-x`) contributes nothing: `layout.ts`'s `leafNumber` reads `null` for it, so
 * the counter is left where it was. THIS DOES NOT GUARANTEE FREEDOM FROM COLLISION FOR AN ARBITRARY STORED TREE —
 * `lambda-x` is not a number this can step past — but every id `nextLeafId` mints is `pane-${n}`, and `splitLeaf`'s
 * guard is still the backstop for the rest.
 *
 * **EVERY NUMBER IT READS IS ONE IT CAN STEP PAST**: `parseTree` refuses a tree holding a leaf number over a billion,
 * read through the same `leafNumber` (Plan 7 part 6a spec §5.3, amended 2026-10-01). From 2^53 on, `+ 1` no longer
 * moves the counter, so after a link carrying `pane-1e300` the second view added would mint a duplicate.
 */
function seedLeafCounter(ids: Iterable<LeafId>): void {
  for (const id of ids) {
    const n = leafNumber(id)
    if (n !== null && n >= leafCounter) leafCounter = n + 1
  }
}

/**
 * The id minted for a new leaf: by a split, and by a switch for a leaf it enters under a new id
 * (`arrangements.ts`'s `reidentified`).
 *
 * `pane-${n}`, NOT `${leg}-${n}`. A leaf minted as `lambda-3` that later rendered a δ-table would carry a name
 * describing something it is not — in the tree, in `localStorage`, and in `data-leaf`, which browser tests select
 * on. `panes.ts`'s `LeafId` already declares the id opaque ("a leaf's stable identity"), so a prefix would be a
 * convenience rather than a fact, and a pane that can change leg is what falsifies it.
 *
 * `layout.ts`'s `defaultArrangement`'s LITERAL `lambda-0` / `rxm-0` / `tm-0` ARE LEFT ALONE, for three reasons and
 * none of them is inertia: browser tests select on them, a default's re-minting of exactly those ids is what
 * `applyLayout`'s claim-dropping line reasons about, and `seedLeafCounter` reads the digits after the
 * last `-` and does not care which word precedes them. `dataset.kind` is the truthful statement of
 * what a leaf renders.
 */
function nextLeafId(): LeafId {
  return `pane-${leafCounter++}`
}

/**
 * The view a `✕` on the leaf `id` gives the focus to: the leaf before `id` in `leaves(tree)` order, or the one after
 * it where `id` is the first. `null` where the tree does not hold `id`, or holds no other leaf.
 *
 * `leaves` goes left to right and depth first, the order the views are in the document and so the order `Tab` goes
 * through them: the answer is the view before the closed one there.
 *
 * **IT IS NOT ALWAYS THE VIEW THAT TAKES THE CLOSED ONE'S SPACE.** `layout.ts`'s `closeLeaf` gives the space to what
 * is left of the closed leaf's own split, and the leaf before it in the tree's order is in that split only where the
 * closed leaf is not the split's first. On all four views as a wide window's default arranges them,
 * `row(column(source rxm-0) column(lambda-0 tm-0))`, the leaves are `source`, `rxm-0`, `lambda-0`, `tm-0`: closing the
 * λ view, the first of the second column, names `rxm-0`, the last of the first column and diagonally across from it,
 * while the TM view under the closed one takes the column (`tests/browser/default-views-gestures.test.ts` holds
 * each view's).
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
  const settingsButton = document.querySelector<HTMLButtonElement>('#settings')
  const settingsMenu = document.querySelector<HTMLElement>('#settings-menu')
  const appearanceChoice = document.querySelector<HTMLSelectElement>('#appearance-choice')
  const formatOnBlurBox = document.querySelector<HTMLInputElement>('#format-on-blur')
  const keymapChoice = document.querySelector<HTMLSelectElement>('#keymap')
  const styleSelect = document.querySelector<HTMLSelectElement>('#style')
  const paletteSelect = document.querySelector<HTMLSelectElement>('#palette')
  const examplesButton = document.querySelector<HTMLButtonElement>('#examples')
  const examplesMenu = document.querySelector<HTMLElement>('#examples-menu')
  const shareButton = document.querySelector<HTMLButtonElement>('#share')
  const shareMenu = document.querySelector<HTMLElement>('#share-menu')
  const aboutButton = document.querySelector<HTMLButtonElement>('#about')
  const aboutMenu = document.querySelector<HTMLElement>('#about-menu')
  const aboutSource = document.querySelector<HTMLAnchorElement>('#about-source')
  const aboutBuild = document.querySelector<HTMLElement>('#about-build')
  const noticeHost = document.querySelector<HTMLElement>('#notice')
  const headerRun = document.querySelector<HTMLElement>('header.bar .bar-spacer')
  const liveHost = document.querySelector<HTMLElement>('#live')
  const viewsShown = document.querySelector<HTMLElement>('#views-shown')
  const viewKeysHint = document.querySelector<HTMLElement>('#view-keys')
  // **`#views`, NOT `<main>` — spec §9.** `renderLayout` opens with `root.replaceChildren()`, and the inspector
  // column lives in `<main>` beside the layout tree: an inspector directly under the layout's root would be
  // destroyed on the first layout commit.
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
    !settingsButton ||
    !settingsMenu ||
    !appearanceChoice ||
    !formatOnBlurBox ||
    !keymapChoice ||
    !styleSelect ||
    !paletteSelect ||
    !examplesButton ||
    !examplesMenu ||
    !shareButton ||
    !shareMenu ||
    !aboutButton ||
    !aboutMenu ||
    !aboutSource ||
    !aboutBuild ||
    !noticeHost ||
    !headerRun ||
    !stepBarHost ||
    !inspectorHost ||
    !strip ||
    !liveHost ||
    !viewsShown ||
    !viewKeysHint ||
    !root
  ) {
    throw new Error('the page is missing a mount point')
  }

  // THE NOTICE LINE AND THE LIVE REGION (Plan 7 part 2 spec §11) — built before `init()`, because it
  // touches nothing but the DOM, so every refusal from here on has somewhere to go.
  // THE FALLBACK IS THE SETTINGS BUTTON, A HEADER CONTROL DRAWN AT EVERY WIDTH: the resting sentence's `hide` names
  // no control of its own, and hidden, the line holds nothing to keep the focus on. An action that does name one keeps
  // it: a palette removal's *undo* the settings button, a picked example's `examples ▾`, an opened link's `share`
  // (`NoticeAction`'s `fallback`).
  const notices = createNotices(noticeHost, liveHost, () => settingsButton)
  floatInRun(noticeHost, headerRun)

  // Wired BEFORE `init()`. The toggle has nothing to do with wasm — it reads and writes `localStorage`
  // and flips an attribute on `<html>` — so it stays live even on the failure paths (`showBanner`
  // below) that replace the views and leave the header bar standing.
  //
  // `localStorage` ACCESS IS GUARDED, same as `prepaint.ts`'s `PREPAINT` and for the same reason:
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
      // survive a reload. The same tradeoff the pre-paint script (`prepaint.ts`) makes.
    }
  }

  let appearance = readStored(readAppearanceStorage())
  /** The settings menu's *format when leaving the editor*, read at every blur. */
  let formatOnBlur = readFormatOnBlur()
  /**
   * Whether a rebuild that gives the keyboard focus back is under way now, which is when a blur is not the user's:
   * `pane-host.ts`'s `keepingFocus` runs each one through `rebuilding`, below, which sets this for its length.
   *
   * **SUCH A REBUILD TAKES EVERY VIEW OFF THE PAGE AND PUTS BACK THE ONES ITS TREE NAMES, AND AN EDITOR THAT HAD THE
   * FOCUS IS SENT A `blur` ON THE WAY OUT**, though the focus is back in it when the rebuild returns. A switch of views
   * is one (`pane-host.ts`'s `switchViews`). With *format on blur* on, a view key pressed from an editor would format
   * text the user had not left, so an editor asked whether to format at a blur is told no while this is set. The
   * editor is still in the document when that `blur` arrives, so it cannot tell the rebuild's from a user's by asking
   * that, as `layout-view.ts`'s divider does. **A VIEW KEY THAT HIDES THE EDITOR'S OWN VIEW FORMATS NOTHING EITHER**:
   * its text is as it was typed until the editor is next left.
   *
   * **A DIVIDER'S DRAG IS THE OTHER** (`pane-host.ts`'s `resized`): letting it go would format the text, and an editor
   * would lose the caret even with text the formatter leaves as it is, since its answer replaces the whole document.
   * So it is set where the focus is kept, for every rebuild that keeps it, and no gesture sets it for itself.
   */
  let focusKept = false
  // THE TOGGLE SHOWS ITS STATE IN A WORD, BESIDE THE GLYPH (Plan 7 part 2 spec §6) — the word is its
  // accessible name, and `aria-label` is removed so the two cannot disagree. `☀`/`☾` are drawn (Hack lacks
  // them); `◐` stays text, which Inter lacks and `fonts.css`'s STIX Two Math draws.
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
   * **THE KEYMAP SETTING — Plan 7 part 3 spec §9.** Built here, beside the settings that already
   * live in this menu, and before the source editor below, which joins it at construction.
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
   * **BUILT HERE, BEFORE ANY VIEW.** The source view's own `symbols` closure reads it, and called before this line had
   * run it would throw out of `main()` before the page finished loading.
   *
   * Only `openDocument` needs `view`, and it stays below where `view` exists.
   */
  const lspClient = new LspClient(
    () => new Worker(new URL('./lsp-worker.ts', import.meta.url), { type: 'module' }),
    (text) => notices.notify(text),
  )
  lspClient.start()
  appearanceChoice.addEventListener('change', () => setAppearance(readStored(appearanceChoice.value)))
  // THE SETTINGS MENU, wired before `init()` with the toggle, for the toggle's own reason.
  wireMenu(settingsButton, settingsMenu)
  settingsButton.replaceChildren(icon('settings'), document.createTextNode('settings'))
  // THE ABOUT MENU (about pages design §5), wired before `init()`: its links need no wasm, so a page whose startup
  // failed still reaches the help, the licences and the source. The build line and the source link are this build's
  // (`build-info.ts`), as on every page's footer.
  wireMenu(aboutButton, aboutMenu)
  // PICKING ONE CLOSES THE MENU, as every header menu's item does (`app-header.ts`'s `exampleItems`): the page opens
  // in a new tab, and the app is left as it was, the menu shut and the focus back on its button.
  aboutMenu.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('a[href]') !== null) aboutMenu.hidePopover()
  })
  aboutSource.href = BUILD.source
  aboutBuild.textContent = BUILD.label

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
  let style = readStyle(readSkinStorage(STYLE_KEY))
  /** The imported palette (Plan 7 part 6b spec §7), or `null` when nothing is imported. */
  let custom = parseCustomPalette(readSkinStorage(CUSTOM_PALETTE_KEY))
  let paletteChoice = readPaletteChoice(readSkinStorage(PALETTE_KEY), custom)
  // `custom` IS LISTED WHILE THE STORE HOLDS A HALF, after the built-in choices, under its halves' names (spec §7.2).
  const listPalettes = (): void => {
    paletteSelect.replaceChildren(
      ...PALETTE_CHOICES.map((id) => new Option(PALETTE_CHOICE_LABELS[id], id)),
      ...(custom === null ? [] : [new Option(customPaletteLabel(custom), 'custom')]),
    )
    paletteSelect.value = paletteChoice
  }
  styleSelect.value = style
  listPalettes()
  // EVERY APPLY REFRESHES THE PRE-PAINT CACHE — FROM WHAT A RELOAD READS, NOT FROM WHAT THIS LOAD DRAWS. The page is
  // drawn from memory; the cache is the palette storage's choice and imported palette resolve to, read as start-up
  // reads them above, so the next load's first frame is the one it goes on to draw. The two differ where storage
  // refused a write: to the imported palette, which says so and lasts this load (spec §7.1), or, silently, to the
  // palette choice (§2.3).
  const applyChosenSkin = (): void => {
    applySkin(document.documentElement, style, paletteChoice, custom)
    const stored = parseCustomPalette(readSkinStorage(CUSTOM_PALETTE_KEY))
    const reload = resolvePalette(readPaletteChoice(readSkinStorage(PALETTE_KEY), stored), stored)
    writeSkinStorage(PALETTE_CSS_KEY, paletteDeclarations(reload))
  }
  applyChosenSkin()
  styleSelect.addEventListener('change', () => {
    style = readStyle(styleSelect.value)
    writeSkinStorage(STYLE_KEY, style)
    applyChosenSkin()
  })
  /** How many palettes the user has picked from the select: a removal's *undo* leaves a choice picked since alone. */
  let palettePicks = 0
  paletteSelect.addEventListener('change', () => {
    palettePicks++
    paletteChoice = readPaletteChoice(paletteSelect.value, custom)
    writeSkinStorage(PALETTE_KEY, paletteChoice)
    applyChosenSkin()
  })
  /**
   * The imported palette's write, which says whether it held — and `null`, the last half removed, removes the key, so
   * an empty store and no store are one state. **NOT SILENT, UNLIKE THE CHOICES'** (spec §7.1): a failed write here
   * loses a scheme the user pasted in, or brings back one the user deleted, so the caller says so.
   */
  const writeCustom = (next: CustomPalette | null): boolean => {
    try {
      if (next === null) localStorage.removeItem(CUSTOM_PALETTE_KEY)
      else localStorage.setItem(CUSTOM_PALETTE_KEY, serializeCustomPalette(next))
      return true
    } catch {
      return false
    }
  }
  /**
   * Put `next` in force as the imported palette, with `choice` as the palette choice — **THE STORE FIRST, AND THE CHOICE
   * ONLY WHEN IT HELD** (spec §7.1). A reload reads both, so a choice saved over a write that failed would read what
   * the store lost: `custom` over a built-in choice with an older import behind it, or the default palette over a half
   * still stored. The page is drawn from memory either way, and the pre-paint cache, as every apply writes it, from what
   * storage holds — so a refused write lasts this load and the reload finds everything as it was; the caller says so.
   */
  const commitCustom = (next: CustomPalette | null, choice: PaletteChoice): boolean => {
    custom = next
    paletteChoice = choice
    const saved = writeCustom(next)
    if (saved) writeSkinStorage(PALETTE_KEY, paletteChoice)
    applyChosenSkin()
    listPalettes()
    return saved
  }
  /** The notice a palette removal drew, offering its *undo*; an apply ends it while it is still up (spec §8.5). */
  let removal: Notice | null = null

  // THE BASE16 IMPORT (Plan 7 part 6b spec §8): the settings menu's last item opens a modal dialog, appended to
  // `<body>` here, closed. Queried here rather than with the mount points above, which the header's own buttons share.
  const importButton = document.querySelector<HTMLButtonElement>('#import-base16')
  if (importButton === null) throw new Error('the page is missing a mount point')
  const base16 = createBase16Dialog({
    settings: settingsButton,
    stored: () => custom,
    shown: () =>
      appearance === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : appearance,
    apply: (variant, half) => {
      removal?.dismiss()
      if (!commitCustom(withHalf(custom, variant, half), 'custom')) {
        notices.notify('the imported palette could not be saved; it applies until the page is reloaded')
      }
    },
    /**
     * A REMOVE (spec §8.5): the half goes, and the choice with it only when it was `custom` and no half is left;
     * the page and the pre-paint cache follow at once. The notice's *undo* puts the half back exactly as it was
     * stored, and the choice as it was unless the user has picked a palette since, until the next change to the
     * store ends the offer. A write storage refuses, the removal's or the undo's, lasts this load and says so (spec
     * §7.1).
     */
    remove: (variant) => {
      const half = custom?.[variant]
      if (custom === null || half === undefined) return
      const before = paletteChoice
      const next = withoutHalf(custom, variant)
      const saved = commitCustom(next, next === null && paletteChoice === 'custom' ? DEFAULT_PALETTE : paletteChoice)
      const picks = palettePicks
      removal = notices.notify(
        saved
          ? `${variant} palette ${schemeName(half.name)} removed`
          : 'the removal could not be saved; the palette comes back when the page is reloaded',
        {
          action: {
            label: 'undo',
            // THE REMOVAL WAS MADE FROM THE SETTINGS, SO THE FOCUS GOES BACK THERE, named here rather than left to the
            // line's own fallback, which answers for no gesture.
            fallback: () => settingsButton,
            run: () => {
              // THE CHOICE COMES BACK ONLY IF NO PALETTE WAS PICKED SINCE, BY THE GESTURE AND NOT BY THE VALUE: one the
              // removal did not change needs nothing, and one the user picked while the offer stood is theirs — the
              // removal's own result, picked back, included.
              const choice = palettePicks === picks ? before : paletteChoice
              // A REFUSED UNDO IS SAID AS A REFUSED IMPORT IS, BUT ONLY OVER A REMOVAL THAT WAS SAVED: over one that
              // was not, the store never lost the half, and a reload already brings back what the undo put back.
              if (!commitCustom(withHalf(custom, variant, half), choice) && saved) {
                notices.notify('the undo could not be saved; the palette goes again when the page is reloaded')
              }
            },
          },
        },
      )
    },
  })
  document.body.append(base16.el)
  importButton.addEventListener('click', () => {
    settingsMenu.hidePopover()
    base16.open()
  })

  // WHERE THE APP FAILS TO START WHEN THE WASM WILL NOT LOAD. `init()` fetches the wasm. A session worker
  // whose module will not load fails too, but not here: its constructor does not throw, and `pool`'s
  // factory below hears its `error`. With no surface for either, the failure would be a blank page.
  try {
    await init()
  } catch (e) {
    showBanner(root, e)
    throw e
  }

  // Checked once, here, immediately after the module is live. See `assertTokenClasses`.
  assertTokenClasses(tokenClasses() as string[])

  /**
   * **THE COLOURER'S TWO APP-WIDE VALUES, BUILT BEFORE THE EDITOR THAT TAKES A COLOURER.** These are `const`s
   * above its construction.
   *
   * **AFTER `await init()`, WHICH IS WHY THIS IS NOT BESIDE `lspClient` ITSELF.** `captureClasses()` is
   * a wasm export; called before the module is live it throws. `init()` is the line above the token
   * check, and everything that builds an editor is below this one, so this is the whole of the window
   * both constraints leave.
   *
   * ONE REGISTRY FOR THE PAGE, so a grammar is fetched once and a FAILED fetch is remembered as a failure, which is
   * what keeps one broken `.wasm` to one notice (`createGrammarRegistry`'s own doc, design §10).
   */
  // THE APP'S LANGUAGES' TABLES ALONE: the export holds one for every grammar, and the page colours only these.
  const captureTables = classMapFrom(
    (captureClasses() as CaptureTable[]).filter(([id]) => LANGUAGE_IDS.some((language) => language === id)),
  )
  const grammars = createGrammarRegistry({
    onFailure: (id, reason) => notices.notify(`${LANGUAGE_LABEL[id]} is showing uncoloured: ${reason}`),
    // THE SHARED RUNTIME, SO THE SENTENCE IS NOT A LANGUAGE'S — `createGrammarRegistry`'s own doc has
    // the mechanism. One `web-tree-sitter.wasm` that will not fetch leaves the source view uncoloured, and
    // saying that, in `onFailure`'s words, is what design §10 asks for and what is true; a sentence naming a
    // grammar would blame one that did not fail.
    onRuntimeFailure: (reason) => notices.notify(`source is showing uncoloured: ${reason}`),
  })
  /**
   * The source editor's colourer, over the one registry and the one class map.
   *
   * **THE CEILING NOTICE IS WIRED HERE AND THIS IS THE ONLY PLACE THAT BUILDS A COLOURER.** Plan 7 part 3
   * spec §10 gives a document over `COLOUR_CEILING_UNITS` one notice saying it is uncoloured,
   * and keeps its diagnostics running, since in a worker they lag rather than freeze the page; the notice
   * below says only that. The source editor's call site goes through this function rather than spelling
   * the same fields out, and `onCeiling` is required on the type, so a colourer cannot be built without
   * it.
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
  /** The widths a run can be pinned to, read once: what the width boxes take, and what a stored or linked width may be. */
  const widths = fieldWidths() as number[]

  /** The stored program's raw text, or `null` where storage refuses the read, which reads as a first visit. */
  const readProgramStorage = (): string | null => {
    try {
      return localStorage.getItem(PROGRAM_STORAGE_KEY)
    } catch {
      return null
    }
  }
  forgetCopies()
  /**
   * THE PROGRAM STORAGE OPENS ON — Plan 7 part 6a spec §4.4: the stored one if `parseProgram` takes it, otherwise the
   * first-load example under the default encoding. A refusal is silent, since it cannot be told from a first visit
   * (`program-store.ts`'s own doc).
   */
  const storedProgram: StoredProgram = parseProgram(readProgramStorage(), encodings() as string[], widths) ?? {
    text: FIRST_LOAD.text,
    encoding: EXAMPLE_ENCODING,
    width: null,
    listing: 'as-built',
  }
  /**
   * A LINK IN THE PAGE'S FRAGMENT — Plan 7 part 6a spec §5.3, read before either store is taken from, since a link
   * takes precedence over both: what it opens, or `null` on a page with no link.
   */
  const startLink = isLink(location.hash) ? await decodeLink(location.hash, encodings() as string[], widths) : null
  /**
   * THE PROGRAM THE PAGE OPENS ON: a link's, whole or alone, under its own encoding or, where the link's is not one this
   * build has, the one storage opens on (spec §5.3); otherwise `storedProgram`. **A LINK'S WIDTH IS ALWAYS ITS OWN**,
   * never storage's: a link without one is an auto run, whose positions are that run's steps (the TM width design,
   * decision 16). **AND SO IS ITS LISTING**: a link without one is as built, and its CLIF position a step of that run.
   *
   * **CHOSEN HERE, AFTER `init()`, BECAUSE AN ENCODING IS VALID ONLY IF `encodings()` LISTS IT**, and before anything
   * reads it: the editor's document, the language server's first text and the start-up compile are its three uses.
   * The picker is set from it, since a compile reads `picker.value` when it posts, and the encoding is kept
   * across reloads.
   */
  const loaded: StoredProgram =
    startLink === null || startLink.kind === 'unreadable'
      ? storedProgram
      : {
          text: startLink.program,
          encoding: startLink.encoding ?? storedProgram.encoding,
          width: startLink.width,
          listing: startLink.listing,
        }
  picker.value = loaded.encoding
  /**
   * THE PROGRAM'S FIELD WIDTH (`field-width.ts`): `null` for auto. A TM view's width box sets it, a pick, a link or
   * an undo replaces it with the program they put in, and a compile reads it when it posts, as it reads the picker.
   */
  let fieldWidth: number | null = loaded.width
  /**
   * The listing every CLIF view shows: the program's, as its field width is. A CLIF view's switch sets it, and a pick,
   * a link or an undo replaces it with the program they put in.
   */
  let clifListing: Listing = loaded.listing
  /**
   * The listing the session worker records the CLIF leg for: `clifListing` while the tree in force shows a CLIF view,
   * `null` while it shows none. **THE TREE IN FORCE**, so a CLIF view on a Stage tab not selected counts and one parked
   * by another arrangement does not: the leg records only for a view the page holds.
   */
  const clifWanted = (): Listing | null => (combinationOf(tree).includes('clif') ? clifListing : null)
  /** Where the `pkg-clif` load stands, which a CLIF view says while it has no listing. */
  let clifLoadState: ClifLoad = 'idle'
  /**
   * The program's machine code, which every CLIF view's machine code panel shows: asked of the program's session, whose
   * generation its answers are kept for. **THUNKS OVER `sessions`**, which is declared below and read only once a view
   * draws.
   */
  const machineCode = new MachineCode({
    gen: () => sessions.entryOf(SOURCE_SESSION).client.gen,
    load: (target) => sessions.entryOf(SOURCE_SESSION).client.mcLoad(target),
    ask: (target, listing) => sessions.entryOf(SOURCE_SESSION).client.machineCode(target, listing),
  })
  /**
   * **THE ONE PLACE THE PAGE SAYS `loading` ITSELF**, and it asks the worker for the load as it does, which the worker
   * always answers with a `clif-load`; the worker says when any other load starts. Only from `idle` or `failed`, since
   * a load asked for or in needs no other.
   *
   * **FROM `failed` IT ASKS WHAT RETRY ASKS TOO**: the pass that failed built no stepper, and a load alone builds none,
   * so a CLIF view shown would say it loads after the load was in, with no Retry left to ask for its listing. **THE
   * LOAD IS POSTED FIRST**, so the request's own load shares it or follows it, and the last `clif-load` heard is the
   * request's: a load that answered `ready` after the request's had failed would leave the view on loading as well.
   */
  const askClifLoad = (): void => {
    if (clifLoadState !== 'idle' && clifLoadState !== 'failed') return
    const failed = clifLoadState === 'failed'
    clifLoadState = 'loading'
    sessions.entryOf(SOURCE_SESSION).client.clifLoad()
    if (failed) clifSync.retry()
    draw()
  }

  let view: EditorView
  /** The source editor's document. Per view, never fetched, never parsed — see `documentUri`. */
  const SOURCE_URI = documentUri(SOURCE_LEAF, 'redextape')

  /**
   * THE SESSION REGISTRY — the container 5d-i decision 1 presupposes (5d-i design §3.2b).
   *
   * IT IS A `SessionRegistry` FROM `sessions.ts`, NOT A `Map` DECLARED HERE, AND THE REASON THE REGISTRY IS A
   * MODULE IS A TEST: a registry that is a module is a registry a test can put two sessions in. `SessionRegistry`'s own
   * doc carries the argument in full.
   */
  const sessions = new SessionRegistry()

  /**
   * The session compiled from the editor's text, the one session the registry holds.
   */
  const SOURCE_SESSION: SessionId = 'source'

  // THE LABEL IS WHAT THE TITLE-SELECTOR PUTS IN FRONT OF A USER, after the leg's name, which is why it is a word
  // rather than the session's id: the program session's label is `program` (`λ · program`, Plan 7 part 2 spec §12);
  // its id stays `source`. `SessionEntry.label`'s doc draws the line: a session is named where it is CREATED, never in
  // the registry that holds it.
  //
  // A `//` BLOCK RATHER THAN `/** */`: it documents no declaration, and a doc comment is read as
  // documenting whatever comes next — here `let draw`, which it says nothing about.

  /**
   * BOTH `let`, NOT `const` — DECLARED HERE SO `transport` BELOW CAN CLOSE OVER THEM THROUGH THUNKS BEFORE EITHER IS
   * ASSIGNED. `transport.events(...)` builds the click handlers the panes are CONSTRUCTED with, so `transport` has to
   * exist before any pane does — but `linkWiring` (`link-wiring.ts`) takes `panes` as a value, built below
   * `createTransport`, and `draw` (`draw.ts`) takes `linkWiring` as one, so neither can be built until after those are.
   * `createTransport` therefore sees only thunks for both (`transport.ts`'s own doc has the reason `linkWiring` needs
   * one at all, not only `draw`). Assigned once each, in that order, below.
   */
  let draw: () => void
  let linkWiring: LinkWiring

  /**
   * THE PROGRAM'S LAST RESULT (Plan 7 part 2 spec §9) — stored by `replies.ts`'s `setProgram`, rendered by
   * `draw()` into the strip's readout.
   */
  let program: ProgramResult | null = null
  const readout = createReadout(results)

  /**
   * ONE WORKER PER SESSION (5d-i design §4.2), SPAWNED ON A SESSION'S FIRST BIND AND NEVER ENDED.
   *
   * A SESSION'S THREAD IS CREATED WHERE ITS CLIENT IS.
   *
   * WHY IT IS WORTH A CLASS AT ALL: the pool's reason is damage containment, not tidiness. A wasm call
   * that aborts leaves a wasm-bindgen borrow taken and poisons the module permanently, and a worker's
   * print-stack ceiling drops after its first deep print and stays down — both are properties of the
   * THREAD, so one worker holding several sessions shares both. `SessionPool`'s own doc carries the
   * measurements; this call site is just where the policy lands.
   *
   * THE FACTORY IS THIS FILE'S HALF OF THE SPLIT, and it is exactly the two decisions the pool must
   * not make: which module a session's worker runs — `session-worker.ts`, resolved against
   * `import.meta.url` so the bundler rewrites the URL — and what a load failure looks like, which
   * needs `root`. 5d-i §4.2 puts the pool in `session-client.ts`, and a module with no DOM cannot own
   * the second of those.
   */
  const pool = new SessionPool(
    () => {
      const worker = new Worker(new URL('./session-worker.ts', import.meta.url), { type: 'module' })
      // THE WORKER HALF OF 5a design §6's LOAD-FAILURE ROW, and it is not the same failure as
      // `init()`'s. A worker whose module fails to load does not throw from the constructor — it fires
      // `error` on the handle, asynchronously, and nothing else in this file would ever hear it. Without
      // this the pane sits on "running…" forever, which is the same blank-page problem one layer in.
      worker.addEventListener('error', (e) => showBanner(root, e instanceof ErrorEvent ? (e.error ?? e.message) : e))
      return worker
    },
    () => draw(),
  )

  // THE SOURCE SESSION, THE ONE ENTRY THE APP HOLDS.
  //
  // **THE SELECTOR IS ON SCREEN FROM THE FIRST PAINT.** The title-selector lists `(leg, session)` PAIRS,
  // and this one entry has all three legs, so it contributes three pairs on its own, and `viewHeader`'s
  // `paint` makes a title a selector rather than plain text from two pairs up.
  //
  // ASSEMBLED HERE, BELOW `pool`, because an entry owns its client and the client cannot exist before its
  // worker does. The legs are initialised inline because a session's legs and its client are one thing,
  // and splitting them across two hundred lines would let them drift apart into unrelated locals. Registered
  // before any pane is constructed — `transport.events(...)` below resolves through the registry, and
  // although every handler it builds runs later, `entryOf` would throw if one somehow fired first.
  //
  // THE REPLY HANDLER NAMES ITS SESSION. Nothing on the wire does (5d-i §3.2 — the port is the id), so the
  // binding between a client and the legs its frames land in is made here, at the one place that
  // knows both. `pool.bind` is what pairs that handler with a thread; this file never sees the port.
  sessions.add({
    id: SOURCE_SESSION,
    label: 'program',
    // A LINK'S POSITIONS HEAR EACH REPLY AFTER THE APP HAS TAKEN IT IN, so a frames reply's frames are in their ring.
    client: pool.bind(SOURCE_SESSION, (reply: RunReply) => {
      replies.onReply(SOURCE_SESSION, reply)
      positions.onReply(reply)
    }),
    // EVERY LEG, AND THE `satisfies` IS WHAT SAYS SO. `SessionLegs` makes each leg optional (its own doc), so a leg
    // left out of this literal would still typecheck, and the program would have no such leg to record, to bind a view
    // to, or to offer in a selector. `Required` makes a leg with no entry here a type error instead (`legs.ts` has the
    // class of bug).
    legs: {
      lambda: freshLeg('lambda', HISTORY_BYTES, { available: false, reason: '' }),
      rxm: freshLeg('rxm', HISTORY_BYTES, { available: false, reason: '' }),
      tm: freshLeg('tm', HISTORY_BYTES, { available: false, reason: '' }),
      clif: freshLeg('clif', HISTORY_BYTES, { available: false, reason: '' }),
    } satisfies Required<SessionLegs>,
    // NOTHING COMPILED YET: `compiled` fills each leg's program. See `SessionEntry.programs` for what reads this and
    // when.
    programs: { rxm: null, tm: null, clif: null },
  })
  /** The λ trees the views draw (spec §4) — one cache, asked through each session's own client. */
  const trees = new LambdaTrees((id) => sessions.entryOf(id).client)
  /** `replies.ts`'s `UnseenViews`: views it adds, and `draw()` seeds from their session and removes. */
  const unseen: UnseenViews = new WeakSet()
  /**
   * Take the CLIF leg's part out of the stored result: the stepper it was read off is gone, and the readout gives the
   * leg rows only while one is built (`results.ts`'s `clifResultRows`).
   */
  const forgetClifPart = (): void => {
    if (program?.kind === 'result') program = { ...program, legs: { ...program.legs, clif: CLIF_ABSENT } }
  }
  /**
   * What the session worker has been told about the CLIF leg (`clif-sync.ts`). **EACH POST RAISES THE LEG'S EPOCH**,
   * the one a rewind raises, so rewinds and requests count in one sequence, as the worker counts them, and frames of
   * the recording a request replaces are dropped by their epoch. **A POST THAT DROPS THE LISTING EMPTIES THE LEG**, its
   * listing and the stored result's CLIF part, as the worker's own `posted` does: a hidden CLIF view keeps no history.
   */
  const clifSync = new ClifSync((listing) => {
    const entry = sessions.entryOf(SOURCE_SESSION)
    const leg = sessions.legOf({ session: SOURCE_SESSION, leg: 'clif' })
    if (listing === null) {
      rewindLeg(leg)
      entry.programs.clif = null
      forgetClifPart()
    } else {
      // **ONE THAT ASKS FOR A LISTING KEEPS ALL THREE ON THE PAGE**: the leg and its listing until the new listing's
      // first frames replace them in one draw (`ClifHold`), the CLIF part until the new stepper's `result` or a
      // reason (`absent`), and through the hold against a result of another request (`ClifHold.part`). Emptied at
      // the press, a CLIF view would draw the old rows bare, then the new rows before their step 0, and the readout
      // would lose its CLIF rows and get them back, moving the views.
      holdClifLeg(leg, program?.kind === 'result' ? { gen: program.gen, clif: program.legs.clif } : undefined)
    }
    entry.client.clif(listing, leg.epoch)
    draw()
  })

  /**
   * TRANSPORT, BEFORE ANY PANE — its `events(...)` is what each pane is constructed with, so it has
   * to exist first. `draw` and `linkWiring` are thunks, for the reason the `let`s above give.
   */
  const transport = createTransport({
    sessions,
    draw: () => draw(),
    // A THUNK OVER `ws`, WHICH `main()` DECLARES FURTHER DOWN, and safe because the player reads it only during
    // playback, long after `main()` has run.
    speed: () => ws.speed,
    setSpeed: (s: Speed) => {
      ws = { ...ws, speed: s }
      persistWorkspace()
      draw()
    },
    // `choose` IS A THUNK over `chooseFieldWidth`, declared below with the notices it ends, and called only at a
    // gesture, long after `main()` has run.
    fieldWidth: {
      widths,
      current: () => fieldWidth,
      choose: (width) => chooseFieldWidth(width),
    },
    clifLoad: {
      state: () => clifLoadState,
      retry: () => clifSync.retry(),
    },
    machineCode,
    // `choose` IS A THUNK over `chooseClifListing`, for `fieldWidth`'s reason.
    clifListing: {
      current: () => clifListing,
      choose: (listing) => chooseClifListing(listing),
    },
    linkWiring: () => linkWiring,
  })

  /**
   * THE PANE COLLECTION — built empty, before any pane exists, and handed to every later factory as a
   * reference rather than a value. `pane-host.ts`'s `applyLayout` is the only thing that ever calls
   * `.add`/`.remove` on it; `linkWiring`/`draw`/`compile`/`replies` just hold onto the same object and
   * read it live, which is what makes them tolerant of it being empty at construction time.
   */
  const panes = new PaneCollection()

  /**
   * THE SOURCE PANE'S HOST, PRE-SEEDED RATHER THAN LEFT TO `hostFor`'s GENERIC BRANCH. `#editor` is the
   * element `view` is constructed against below — `index.html` ships it as a bare top-level node rather
   * than nested under a `#source` section, because that section is not in the markup at all (the tree
   * builds it). Moving it here, once, before `applyLayout` ever runs, is what lets
   * `hostFor('source', 'source')` find this entry already in `hosts` and return it rather than building
   * an empty section with nothing inside it — the source leaf is chrome around an editor `main.ts`
   * already owns, not a `PaneView` `applyLayout` constructs.
   *
   * **`#link-status` DOES NOT MOVE IN HERE BESIDE IT.** This host ships a close control, and `hostFor`'s
   * detach-not-destroy rule takes the whole subtree out of the document when the source leaf closes;
   * `createLinkWiring` captures the status element once at construction, so every write after that close
   * would land in a node that had left the page. What is pinned is about a construct lit in every view rather than
   * about this one, so the line stays where `index.html` declares it — inside `footer.strip`, after `#results`
   * (spec §9), outside every host `hostFor` can detach.
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
   * `hosts` and come back intact the moment the leaf does. `reset preset` brings it back at the cost of
   * every other pane on the page; a split from any other view's menu (`tests/browser/pane-picker.test.ts`)
   * brings it back at no cost, and the header's `source` toggle brings it back too.
   *
   * A SEPARATE `viewMenu` INSTANCE, NOT ROUTED THROUGH `paneEvents`, BECAUSE THE SOURCE PANE HAS
   * NO `PaneSlot`. `paneEvents` is built for a `(LeafId, PaneSlot<K>)` pair — `applyLayout`'s own `if
   * (l.pane === 'source') continue` is exactly the statement that no such pair exists for this leaf —
   * so the closure here re-states `close`'s two lines directly against `SOURCE_LEAF` rather than
   * manufacturing a slot that would have nothing to resolve. (That constant is `layout.ts`'s, and
   * its own doc has the reason: `pane-host.ts`'s `split` can CREATE a source leaf, so the id this handler
   * closes over and the id that split mints have to be the same id in a way two literals cannot promise.)
   *
   * `format` AND `close`, NOT SPLIT — a `viewMenu` builds only the items it is given handlers for, so the
   * source view's `⋯` never offers a split. `update`'s SECOND ARGUMENT IS A LITERAL `false`, ALWAYS: source
   * can never split (`splitLeaf`'s own refusal), so there is no boolean this view's chrome could ever
   * compute for `canSplit` that isn't already known at every call site.
   */
  /**
   * A LAYOUT CHANGE, SAID AS A NOTICE (Plan 7 part 2 spec §11) — `pane-host.ts` reports a split, a close and a
   * switch; the source view's own close, below, reports through this too.
   */
  const layoutChanged = (e: LayoutEvent): void => {
    const say = (c: PaneChoice): string =>
      c.kind === 'source' ? 'source' : pairLabel({ leg: c.kind, label: sessions.entryOf(c.session).label })
    if (e.kind === 'added') notices.notify(`view added — ${say(e.shows)}`)
    else if (e.kind === 'closed') notices.notify(`view closed — ${say(e.showed)}`)
    else notices.notify(`view now shows ${say(e.shows)}`)
  }
  /**
   * Whether the workspace is *custom*: its switches match no preset. **ITS MENU HAS NO *RESET PRESET* THEN**
   * (`app-header.ts`'s `workspaceItems` leaves the item out until a preset is chosen), so a notice that names the
   * reset as the way to make room names that step first, where it would have sent a reader to an item that is not
   * there.
   */
  const customWorkspace = (): boolean => presetOf(ws.switches) === null
  /**
   * AN ADD REFUSED, SAID AS A NOTICE AND NOTHING ELSE (the user's decision, 2026-10-04): what stopped it and what would
   * let it through, naming the view by its title as its selector spells it (`viewTitle`, declared below and read only
   * at a click). The controls stay enabled — a window widened or a view closed is the next try's room.
   *
   * **A FULL WORKSPACE'S NOTICE DOES NOT PROMISE THAT A CLOSE MAKES ROOM.** The bound is on every live view (the view
   * layouts spec §5.6), and a `✕` does not always take one away: on a kind's last view it leaves the tree before it
   * remembered, with the closed view's leaf in it, and a view another arrangement holds stays live too. Told only to
   * "close one to add another", a user whose close made no room would be refused the next add in the same words. So
   * the notice counts the views that are not on screen, and names *reset preset* for a close that makes no room: it
   * forgets every arrangement, and so always makes some.
   *
   * **A CUSTOM WORKSPACE IS TOLD TO CHOOSE A PRESET FIRST**: its menu has no *reset preset* (`customWorkspace`'s
   * doc).
   */
  const refused = (r: AddRefused): void => {
    if (r.why === 'full') {
      const live = liveLeaves(tree, ws.arrangements).size
      const off = live - leaves(tree).length
      const holds = off === 0 ? `${live} views` : `${live} views, ${off} of them not on screen`
      const reset = customWorkspace() ? 'choose a preset and reset preset' : 'reset preset'
      const remedy = `close one to add another, or ${reset} if that makes no room`
      notices.notify(`the workspace holds ${holds}, the most it can keep — ${remedy}`)
      return
    }
    const title = viewTitle(r.leaf)
    // THE REMEDY NAMES THE AXIS THAT RAN OUT, NOT THE ONE THE ADD DIVIDES: a split down of a view under 160 px wide is
    // refused as narrow, and only a wider window lets it through.
    const remedy = r.why === 'short' ? 'make the window taller' : 'widen the window'
    notices.notify(`no room to split ${title} — close a view or ${remedy}`)
  }
  const sourceMenu = viewMenu(sourceHeader.actions, {
    format: () => {
      const asked = view.state.doc
      lspClient
        .format(SOURCE_URI)
        .then((edits) => applyEdits(view, edits, asked))
        .catch(() => {
          // The client has already said the server is gone; this is one gesture, not a second report.
        })
    },
    close: () => {
      const neighbour = neighbourOf(tree, SOURCE_LEAF)
      enterTree(closeLeaf(tree, SOURCE_LEAF))
      // `focusView`, NOT `applyLayout` THEN `focusPane` — its own doc has why the order matters on the
      // stage. The other order is safe only while the leaf `neighbourOf` names and the view that becomes
      // focused are the same leaf.
      paneHost.focusView(neighbour)
      layoutChanged({ kind: 'closed', leaf: SOURCE_LEAF, showed: { kind: 'source' } })
    },
  })
  const sourceLayout = { update: (canClose: boolean, canSplit: boolean) => sourceMenu.setLayout(canClose, canSplit) }
  sourceHost.append(sourceHeader.el, editorHost)
  // THE SOURCE VIEW CAN HOLD THE FOCUS TOO (spec §3: `focused` is any leaf): the Stage shows the focused view, and
  // a rebuild that takes the focus off the page gives it back there. Not `markActive`: that one is per leg, and the
  // source view is on neither (`hostFor`'s own comment in `pane-host.ts` has the argument).
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

  /**
   * The notice line's resting sentence about storage, the program's (`unsaved.ts`). **A RESTING STATE, NOT A NOTICE**:
   * every notice is replaced by the next gesture's, and a refused write lasts as long as the storage's condition does.
   */
  const unsaved = createUnsaved((line) => notices.rest(line))

  /**
   * What a reload would open on: the last program a write stored, or the one storage opened on while none has been —
   * the stored one, or the first-load example where nothing was stored or `parseProgram` refused what was. A link's
   * program is not it until a write stores it: its fragment is cleared once it opens (spec §5.3).
   */
  let restorable: StoredProgram = storedProgram

  /**
   * Store the program — as each compile posts, with what it posted and the listing in force, and at each listing chosen
   * (Plan 7 part 6a spec §4.3).
   *
   * **A REFUSED WRITE IS REPORTED ONLY WHILE THE PROGRAM DIFFERS FROM WHAT A RELOAD WOULD RESTORE** (spec row 17). A
   * program a reload would not give back is work not yet saved; the first-load example, or a stored program only looked
   * at, is not — so a visitor on blocked storage who only looks at the example sees no resting line, and one who edits
   * it is told from their first edit's write on. **COMPARED AT EVERY WRITE RATHER THAN LATCHED**, so an edit undone
   * before its write never counts, and a program edited away and back is taken back off the line: a reload would
   * restore exactly what the page shows. That refines row 17's "changed from what was loaded", under which a change
   * once made was reported for the rest of the page load.
   */
  const writeProgramStorage = (program: StoredProgram): void => {
    try {
      localStorage.setItem(PROGRAM_STORAGE_KEY, serializeProgram(program))
      restorable = program
      unsaved.saved()
    } catch (thrown) {
      const differs =
        program.text !== restorable.text ||
        program.encoding !== restorable.encoding ||
        program.width !== restorable.width ||
        program.listing !== restorable.listing
      if (differs) unsaved.refused(refusalOf(thrown))
      else unsaved.saved()
    }
  }

  /**
   * The views area's shape, which decides how a combination's first two views sit (`layout.ts`'s `defaultArrangement`):
   * measured each time a default is built and never stored, since the tree it gave is.
   */
  const viewsShape = () => shapeOf(root.getBoundingClientRect())
  /** The workspace storage opens on: the stored one if there is a usable value there, the default otherwise. */
  const storedWorkspace = parseWorkspace(readLayoutStorage()) ?? defaultWorkspace(viewsShape())
  /**
   * THE WORKSPACE — a link's where one opens whole (Plan 7 part 6a spec §5.3), otherwise restored from `localStorage`
   * if there is a usable value there (a version 1 layout is migrated: `workspace.ts`'s `parseWorkspace`), the default
   * otherwise.
   *
   * **`tree` STAYS ITS OWN `let`, AND `ws` HOLDS THE REST.** `pane-host.ts` reads and writes the tree through
   * `getTree`/`setTree` on every gesture, and its doc argues why the tree has one owner; folding it into `ws`
   * would move that owner without changing anything a reader could see. `persistWorkspace` joins the two at
   * the one moment they are written.
   */
  const restored = startLink?.kind === 'whole' ? startLink.workspace : storedWorkspace
  let tree: LayoutNode = restored.tree
  let ws: Omit<Workspace, 'tree'> = {
    switches: restored.switches,
    speed: restored.speed,
    focused: restored.focused,
    panels: restored.panels,
    panelSizes: restored.panelSizes,
    inspector: restored.inspector,
    display: restored.display,
    tmDisplay: restored.tmDisplay,
    clifDisplay: restored.clifDisplay,
    arrangements: restored.arrangements,
  }
  /**
   * Whether the tree on screen holds the view `id` — false for a view kept alive in an arrangement the workspace
   * remembers. The surfaces the views share ask it: the step bar, the link status line and the running focuses each
   * describe what is arranged on screen, in tiles or as Stage's tabs, and never a view no one can reach.
   * `pane-host.ts`'s `laidOut` asks it of the tree `applyLayout` last drew.
   */
  const arranged = (id: LeafId): boolean => leaves(tree).some((l) => l.id === id)
  /**
   * PUT `next` ON SCREEN — the one place a gesture writes the tree (the view layouts spec §4.3): `arrangements.ts`'s
   * `enter`, which remembers the tree left under its own combination where `next` shows another. A divider, a
   * split, a title pick and `✕` reach it through `pane-host.ts`'s `setTree`; the source view's own `✕` and
   * a switch call it here.
   *
   * **NOT *RESET PRESET* AND NOT AN OPENED LINK**: each replaces the workspace whole, what it remembers included, and
   * writes `tree` and `ws` together.
   *
   * **A VIEW AN EDIT TAKES OUT OF THE TREE IS CLOSED, AND ITS PANEL STATE AND DISPLAY GO WITH IT** — unless the write
   * is a switch's (`parks`), whose views are only off the screen. The tree a `✕` left is remembered, so the
   * closed view's id is still a live one by `liveLeaves`' test and `normaliseWorkspace` would keep its state for the
   * view built there next; `tests/browser/workspace-restore.test.ts`'s "does not give a re-minted view the panel
   * state of the one that closed" is that case.
   */
  /**
   * Put the source view's own elements back as they are built: its outline closed, its regions at the heights they
   * start with, no panel maximised. Set once those exist, further down.
   *
   * **THE SOURCE VIEW IS THE ONE VIEW THE PAGE KEEPS.** A `✕` drops what the workspace stores for a view, and any
   * other view is built again for the leaf its toggle shows next. The source view's elements are the page's for its
   * life, so without this they would keep the outline open and the boundary where it was dragged for a workspace that
   * stored neither, and the next drag would write the dropped shares back.
   */
  let sourceClosed: () => void = () => {}
  const enterTree = (next: LayoutNode, parks = false): void => {
    const entered = enter({ tree, arrangements: ws.arrangements }, next)
    if (!parks) {
      const kept = new Set(leaves(next).map((l) => l.id))
      const closed = new Set(
        leaves(tree)
          .map((l) => l.id)
          .filter((id) => !kept.has(id)),
      )
      if (closed.size > 0) {
        const without = <T>(by: Readonly<Record<LeafId, T>>): Record<LeafId, T> =>
          Object.fromEntries(Object.entries(by).filter(([leaf]) => !closed.has(leaf)))
        ws = withLegDisplaysKept(
          { ...ws, panels: without(ws.panels), panelSizes: without(ws.panelSizes) },
          (leaf) => !closed.has(leaf),
        )
        if (closed.has(SOURCE_LEAF)) sourceClosed()
      }
    }
    tree = entered.tree
    if (entered.arrangements !== ws.arrangements) ws = { ...ws, arrangements: entered.arrangements }
  }
  /**
   * The focused view, repaired against the tree it names a leaf of.
   *
   * **A CLOSE OR A RESET LEAVES `ws.focused` NAMING A LEAF THAT IS GONE.** The WRITE repairs it too
   * (`serializeWorkspace` falls back to `defaultFocus`), but a repair at the write alone would leave memory
   * and storage disagreeing.
   */
  const focusedLeaf = (): LeafId => (leaves(tree).some((l) => l.id === ws.focused) ? ws.focused : defaultFocus(tree))

  /**
   * Drop what no arrangement holds any longer — the panel state and the display of a closed view — and a focus on a
   * view that is not on screen. A view a remembered arrangement holds is live and keeps both (the view layouts spec
   * §5.1).
   *
   * **A DEFAULT ARRANGEMENT RE-MINTS `source`, `lambda-0`, `rxm-0` AND `tm-0` AS LITERALS**, so a leaf id genuinely
   * comes back: close the TM view with its rules panel shut, then *reset preset*, and the new `tm-0`
   * would inherit the closed view's panel state — from memory, since the write had already dropped it.
   * The same clicks would then behave differently depending on whether the page had been reloaded in
   * between. A λ or TM view's display is kept per leaf beside its panels and is dropped here for the same
   * reason.
   */
  const normaliseWorkspace = (): void => {
    const live = liveLeaves(tree, ws.arrangements)
    const panels = Object.fromEntries(Object.entries(ws.panels).filter(([leaf]) => live.has(leaf)))
    const panelSizes = Object.fromEntries(Object.entries(ws.panelSizes).filter(([leaf]) => live.has(leaf)))
    ws = withLegDisplaysKept({ ...ws, focused: focusedLeaf(), panels, panelSizes }, (leaf) => live.has(leaf))
  }

  const persistWorkspace = (): void => {
    normaliseWorkspace()
    writeLayoutStorage(serializeWorkspace({ tree, ...ws }))
  }
  // IMMEDIATELY, AND ON THE RESTORED TREE RATHER THAN ONLY THE DEFAULT ONE — see `seedLeafCounter`'s
  // own doc. HERE AND IN `showWorkspace`, NOT ON EVERY `applyLayout`: the counter only ever needs to learn about ids
  // it did not mint itself, and the two moments such an id can enter the tree are this restore and an opened link's
  // workspace, which seeds the counter as it writes the tree. (Re-seeding on every layout would be harmless — the
  // function only ever advances — but it would also be a third place to read as though the invariant needed
  // maintaining.)
  seedLeafCounter(liveLeaves(tree, ws.arrangements).keys())

  /**
   * THE PANE LIFECYCLE — `pane-host.ts`'s own doc has the argument for why `hosts` and `pendingBinding`,
   * and the four closures over them (`hostFor`, `paneEvents`, `focusPane`, `applyLayout`), live there
   * rather than as six names in this scope.
   *
   * CONSTRUCTED AFTER `tree`, `sourceLayout` AND `persistWorkspace`, AND BEFORE ANY PANE EXISTS, because
   * those three are its irreducible ties back to this file: the tree it reads and rewrites, the source
   * pane's close control it drives at every structural change, and the writer that persists the
   * workspace. `panes` IS HANDED OVER EMPTY — `applyLayout` is the only thing that ever populates it —
   * and `draw` is a thunk for the same reason `linkWiring`/`compile` below take one: the `let` it names is
   * not assigned until `createDraw` runs.
   *
   * `tree` STAYS A `let` IN THIS SCOPE AND CROSSES AS A GETTER/SETTER PAIR, not as a field over there and
   * not as a mutable export. Three of its writers stay here — the restore just above, the `reset preset`
   * item below and `showWorkspace`, which an opened link's workspace goes through — so a copy in that module would
   * be a second place the current tree lives, and this file would be holding the stale one.
   *
   * `nextLeafId` AND `neighbourOf` CROSS AS FUNCTIONS RATHER THAN MOVING WITH THEIR CALLERS. `leafCounter`
   * is module-level rather than per-`main()` call, and `seedLeafCounter` above is the other reader of it;
   * `neighbourOf`'s other caller is the source view's own close handler above, which has no `PaneSlot` and
   * therefore no `paneEvents` to go through.
   */
  const paneHost = createPaneHost({
    root,
    panes,
    transport,
    sourceSession: SOURCE_SESSION,
    sourceLayout,
    nextLeafId,
    neighbourOf,
    getTree: () => tree,
    setTree: enterTree,
    liveLeaves: () => liveLeaves(tree, ws.arrangements),
    applied: () => {
      viewsToggles.sync(combinationOf(tree), viewsOfKind)
      // **THE CLIF LEG FOLLOWS THE TREE**, so a CLIF view shown or hidden by any road, a toggle, a key, a `✕`, a
      // workspace or a link, is told to the session worker here.
      clifSync.want(clifWanted())
    },
    // NO EDITOR FORMATS AT THE BLUR THIS REBUILD SENDS IT (`focusKept`'s doc).
    rebuilding: (rebuild) => {
      focusKept = true
      try {
        rebuild()
      } finally {
        focusKept = false
      }
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
    panelSizesOf: (leaf: LeafId) => ws.panelSizes[leaf],
    setPanelSizes: (leaf: LeafId, sizes: Shares) => {
      ws = { ...ws, panelSizes: withPanelSizes(ws.panelSizes, leaf, sizes) }
    },
    displayOf: <K extends DisplayLeg>(leg: K, leaf: LeafId) => legDisplayOf(ws, leg, leaf),
    setLegDisplay: <K extends DisplayLeg>(leg: K, leaf: LeafId, d: LegDisplay[K]) => {
      ws = withLegDisplay(ws, leg, leaf, d)
    },
    layoutChanged,
    refused,
    draw: () => draw(),
    // THE SESSION QUESTIONS `pane-host.ts` ASKS OF THE REGISTRY, ANSWERED HERE BECAUSE THIS FILE IS WHERE
    // THE REGISTRY IS — that module's own doc argues why it takes these rather than the registry it would
    // otherwise need. `entryOf` throws for a session nothing registered, which is the policy `legOf`
    // already sets for the same class of wiring bug.
    programOf: <K extends keyof LegProgram>(session: SessionId, leg: K) => sessions.entryOf(session).programs[leg],
  })

  // `sourceHost`'s own doc above has the argument for why this file builds that host rather than leaving
  // it to `hostFor`'s generic branch, and for why the seeding has to happen before `applyLayout` first
  // runs, with the whole tail of `main()` between this line and that call.
  paneHost.seedHost(SOURCE_LEAF, sourceHost)

  // THE WORKSPACE MENU — the presets, the switches, and `reset preset` (spec §4, §6).

  /**
   * THE WORKSPACE BUTTON'S NAME, AND ITS `▾`.
   *
   * **THE GLYPH IS WRITTEN HERE AS WELL AS IN `index.html`**, because this replaces the button's whole
   * content on every preset change — a span placed only in the markup would survive exactly until the
   * first one. `aria-hidden`, so the accessible name is the preset's name alone: a bare `▾` in a spoken
   * sentence reads as "down-pointing triangle" (spec §12), and `examples ▾` does it the same way.
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
      { switches: ws.switches, reset: resetPresetButton, views: viewsShown },
      {
        preset: (p) => setSwitches(PRESETS[p]),
        // THE ONE NARROWING. A `SwitchRow` option's `value` is `string` (`SWITCH_ROWS`' doc); this is where
        // a menu value becomes a `Switches` one, and an unknown one is dropped rather than stored —
        // `parseWorkspace` would refuse the whole envelope on the next load.
        flip: (key, value) => {
          const parsed = parseSwitches({ ...ws.switches, [key]: value })
          if (parsed !== null) setSwitches(parsed)
        },
      },
    )
  }

  /** Put the page in step with the switches. */
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
   * THE SWITCHES' WRITER FOR A PICK (spec §4): persist, rename, repaint, and say what changed.
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
   * A SWITCH TO ANOTHER COMBINATION OF VIEWS — the view layouts spec §4.5. A `views` toggle and a view key both end
   * here: the combination's remembered arrangement, or its default the first time it is visited.
   *
   * **A LEAF WHOSE ID IS LIVE AS A VIEW OF ANOTHER KIND IS ENTERED UNDER A NEW ID** (§5.4; `arrangements.ts`'s
   * `reidentified` has why): the view that holds the id stays parked, and the switch builds a new view beside it.
   * So the focused view is the one that was focused only where the tree entered still holds its id, and whatever the
   * workspace stores under an id stays with the view that holds it.
   *
   * **REFUSED WHERE ITS VIEWS WOULD TAKE THE LIVE ONES PAST THE BOUND** (§5.6): a default arrangement's views are new
   * ones where the workspace has closed its own, and so is each leaf entered under a new id. **THE BOUND IS ASKED OF
   * THE TREE AS IT WOULD BE ENTERED, WITH IDS THAT ARE NOT MINTED**, so a refused switch leaves the leaf counter where
   * it was, as a refused add does.
   *
   * **ITS NOTICE SAYS THE THREE NUMBERS, AND IS NOT AN ADD'S.** A switch can be refused short of the bound: with 63
   * live views, a default that needs two new ones. So it says how many the workspace holds, how many the switch would
   * take it to and how many it can keep, and names *reset preset*, which always makes room, after the preset a custom
   * workspace has to choose to be offered it (`customWorkspace`'s doc).
   *
   * **NOT HELD TO THE 160 PX FLOOR**: it shows a remembered tree, and a stored tree is not held to it either.
   *
   * **`switchViews`, NOT `focusView`**: the keyboard focus stays on the toggle that was pressed, or in the editor a
   * view key was pressed from, unless its view left the page (`pane-host.ts` has the argument).
   */
  const switchTo = (target: Combination): void => {
    const key = keyOf(target)
    if (target.length === 0 || key === keyOf(combinationOf(tree))) return
    const now = { tree, arrangements: ws.arrangements }
    const held = ws.arrangements[key] ?? defaultArrangement(target, viewsShape())
    const live = liveLeaves(tree, ws.arrangements)
    // IDS NO TREE HOLDS, FOR THE COUNT ALONE: `reidentified` asks for one a leaf it gives a new id.
    let unminted = 0
    const trial = (): LeafId => {
      let id = `unminted-${unminted++}`
      while (live.has(id)) id = `unminted-${unminted++}`
      return id
    }
    const entered = enter(now, reidentified(held, live, trial))
    const after = liveLeaves(entered.tree, entered.arrangements).size
    if (after > MAX_TREE_LEAVES) {
      const counts = `from ${live.size} views to ${after}, and it can keep ${MAX_TREE_LEAVES}`
      const reset = customWorkspace() ? 'choose a preset, then reset preset makes room' : 'reset preset makes room'
      notices.notify(`${shownSentence(target)} would take the workspace ${counts} — ${reset}`)
      return
    }
    enterTree(reidentified(held, live, nextLeafId), true)
    paneHost.switchViews(focusedLeaf())
    notices.announce(shownSentence(combinationOf(tree)))
  }

  /**
   * How many views of `kind` its toggle stands for: the ones on screen where the kind is shown, and the ones a press
   * would show where it is not. A press shows the arrangement its combination remembers, which holds as many views
   * of the kind as it was left with, or the combination's default, which holds one of each (`layout.ts`'s
   * `defaultArrangement`).
   */
  const viewsOfKind = (kind: PaneKind): number => {
    const of = (t: LayoutNode): number => leaves(t).filter((l) => l.pane === kind).length
    const shown = combinationOf(tree)
    if (shown.includes(kind)) return of(tree)
    const held = ws.arrangements[keyOf(toggled(shown, kind))]
    return held === undefined ? 1 : of(held)
  }

  /**
   * Show `kind`'s views or hide them: what a `views` toggle's press and a toggle key both ask.
   *
   * **THE ONLY KIND SHOWN STAYS, AND THE NOTICE LINE SAYS WHY**, in the words of its toggle's tooltip
   * (`app-header.ts`'s `toggleSentence`). The toggle is disabled then and still takes a press (`viewToggles`), so the
   * press is answered as the key is.
   */
  const toggleView = (kind: PaneKind): void => {
    const next = toggled(combinationOf(tree), kind)
    if (next.length === 0) notices.notify(toggleSentence(kind, viewsOfKind(kind), 'only'))
    else switchTo(next)
  }

  // THE `views` TOGGLES — spec §6. `pane-host.ts`'s `applied` brings them up to the tree each time one is rendered,
  // so a `✕` and an opened link move them as a press does.
  const viewsToggles = viewToggles(viewsShown, toggleView)
  // **`pkg-clif` IS FETCHED ON INTENT** (CLIF view design §6, *Loading*): a pointer that moved onto the CLIF toggle
  // resting there, a press going down on it, or the focus reaching it, starts the load before the view is shown, and
  // nothing else does until a CLIF view is shown; a toggle drawn under a pointer that has not moved is no intent. Only
  // from `idle` or `failed`, since a load asked for or in needs no other. `viewToggles` has thrown already where the
  // page has no CLIF toggle.
  watchIntent(viewsShown.querySelector('button.view-toggle[data-shows="clif"]') as HTMLElement, askClifLoad)
  // **IN A WINDOW 40rem WIDE OR NARROWER THE TOGGLES ARE FIRST IN THE WORKSPACE MENU**, by `app-header.ts`'s
  // `NARROW_WINDOW` (`style.css` has what they would cost the header there). Moved, not hidden, so that a pointer on a
  // phone keeps them, and the same buttons, so that a press, the pressed state and the CLIF intent listener go too.
  //
  // **A TOGGLE WITH THE FOCUS HANDS IT TO THE WORKSPACE MENU'S BUTTON AS THE WINDOW NARROWS**, since the menu it moves
  // into is shut and that button opens it (`focus-handoff.ts`). **ONE WITH THE FOCUS IN THE MENU IS GIVEN IT BACK IN
  // THE HEADER AS THE WINDOW WIDENS**: moving an element takes the focus off it, in Chromium and Firefox both.
  const narrowWindow = matchMedia(NARROW_WINDOW)
  const placeToggles = (): void => {
    if (narrowWindow.matches) {
      handOff(viewsShown, [workspaceButton])
      workspaceMenu.prepend(viewsShown)
    } else {
      const held = focusHolder()
      workspaceMenu.after(viewsShown)
      if (held instanceof HTMLElement && viewsShown.contains(held)) held.focus()
    }
  }
  narrowWindow.addEventListener('change', placeToggles)
  // **A FOCUS THE STYLESHEET TAKES FIRST GOES TO THE SAME BUTTON.** `style.css` keeps a group still in the header off
  // the page in a narrow window, and Firefox applies that rule to a new width, hiding and blurring a toggle, before the
  // width-change event reaches `placeToggles`, which then finds no focus to hand on. A focus lost to nothing in a
  // narrow window while the group is still in the header was lost that way.
  viewsShown.addEventListener('focusout', (e) => {
    if (e.relatedTarget === null && narrowWindow.matches && viewsShown.parentElement !== workspaceMenu)
      workspaceButton.focus()
  })
  placeToggles()

  /**
   * VIEW KEYS — spec §7: the prefix, then one key. The hint is built once from `view-keys.ts`'s own table, so what it
   * lists is what the machine answers, and the live region is told the same rows as one sentence when the mode is
   * armed (`HINT_SENTENCE`). Nothing is said when it is left.
   *
   * **A TOGGLE KEY FOR THE ONLY VIEW SHOWN SAYS WHY NOTHING HAPPENED**, on the notice line, where the header's button
   * for it is disabled with the same words in its tooltip (`toggleView`).
   *
   * **A VIEW KEY CLOSES EVERY OPEN POPOVER BEFORE IT ACTS**, as a pointer press on the page behind one does: the key
   * acts on that page, and a menu left open over it describes the page as it was. `hidePopover` closes each with its
   * events, so its button's `aria-expanded` follows, and hands the focus back to that button where the focus was
   * inside. The other choice was to leave the mode unarmed while a popover is open, as it is under a modal dialog; the
   * keys would then do nothing from inside a menu, with nothing to say so.
   */
  const hintTitle = document.createElement('span')
  hintTitle.className = 'view-keys-title'
  hintTitle.textContent = 'view keys'
  const hintRow = (key: string, does: string): HTMLElement => {
    const row = document.createElement('span')
    const kbd = document.createElement('kbd')
    kbd.textContent = key
    row.append(kbd, ` ${does}`)
    return row
  }
  viewKeysHint.replaceChildren(hintTitle, ...HINT_ROWS.map((row) => hintRow(row.key, row.does)))
  const actOnViewKey = (action: ViewKeyAction): void => {
    for (const open of document.querySelectorAll<HTMLElement>(':popover-open')) open.hidePopover()
    if (action.kind === 'cycle') switchTo(cycleFrom(combinationOf(tree), action.step))
    else toggleView(action.pane)
  }
  wireViewKeys(window, {
    act: actOnViewKey,
    armed: (now) => {
      viewKeysHint.hidden = !now
      if (now) notices.announce(HINT_SENTENCE)
    },
    blocked: () => document.querySelector('dialog:modal') !== null,
  })
  // THUNKS: `linkWiring` is assigned further down this function.
  wireLinkClear(root, { unpin: () => linkWiring.unpin(), gestures: () => linkWiring.gestures })
  watchCutText(document)

  /**
   * A view's title, in the title-selector's own spelling — the bar's prefix (spec §8) and a Stage tab's label (§5).
   *
   * **ONE FUNCTION, BECAUSE A VIEW HAS ONE NAME.** The header, the bar and the tab strip all say what a
   * view shows, and three spellings of `λ · program` would be three places for a change of vocabulary to
   * miss one.
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
    // so from the other side), so this list is already "every λ, rxm or TM view in the layout" — in Stage,
    // views off the page too. That is Plan 7 part 2 spec §8's rule, not an oversight: with the focused view
    // unable to step, the bar keeps "the last view that could", and in Stage the source tab is that case.
    //
    // **OF THE TREE ON SCREEN** (the view layouts spec §5): a view kept alive in a remembered arrangement has no tab
    // and no place on the page, so the bar never drives one. A Stage tab off the page is in the tree, and still can.
    const id = barTarget(
      focusedLeaf(),
      panes
        .all()
        .filter((p) => arranged(p.id))
        .map((p) => p.id),
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
   * copied. `#results[data-state]` is the program's compile state and browser tests wait on it; two
   * elements would be two places for that attribute to be written, and the second one is where it
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
    // `presetOf(…) ?? 'explorer'` IS UNREACHABLE AND STAYS AS A BACKSTOP.
    // `workspaceItems` does not put this item in the menu while the workspace is custom (spec §4), so the
    // only preset that can reach this line is a real one — the `??` is what holds if a caller ever gets
    // here another way, which is the same standing `layout.ts`'s refusals take against their own UI.
    const preset = presetOf(ws.switches) ?? 'explorer'
    // **EVERY REMEMBERED ARRANGEMENT GOES WITH IT** (the view layouts spec §4.6): the default views are back, and a
    // toggle pressed next shows that combination's default, not what it was left as.
    tree = defaultLayout(viewsShape())
    ws = { ...ws, switches: PRESETS[preset], arrangements: {} }
    // **THE FOCUS GOES INTO THE NEW ARRANGEMENT.** `hidePopover()` above hands focus back to whatever held it
    // before the menu opened, which for a user reaching this item is a control inside one of the views.
    // Rebuilding the tree from `defaultLayout()` detaches that host — `renderLayout`'s `root.replaceChildren()` —
    // and focus falls to `<body>` a frame later, which is why a synchronous read at the end of this handler
    // still shows a live element and the gesture looks safe until it is watched across a frame.
    //
    // **IT DEPENDS ON WHERE THE FOCUS WAS, AND THAT IS NOT A REASON TO SKIP IT.** Reached from a header
    // control the gesture is harmless, because the header is outside `<main>` and no rebuild touches it.
    // Reached from inside a view — the ordinary case, since that is where a user works — it would strand
    // the focus every time. `tests/browser/menu-focus.test.ts` drives it from inside a view for exactly
    // that reason.
    //
    // **`focusView`, NOT `applyLayout` THEN `focusPane`.** On the stage the leaf this names may not be the
    // one mounted, and `focusPane` on a detached host does nothing; `focusView` records the focus BEFORE the
    // rebuild so the stage mounts the view this line means. `defaultFocus` rather than `focusedLeaf()`
    // because the leaf the user was in may not exist in `defaultLayout()`'s tree at all.
    paneHost.focusView(defaultFocus(tree))
    notices.notify(`${presetName(preset)} reset — the default views are back`)
  })

  /**
   * Put `program` in the source editor: its encoding into the picker, its width into `fieldWidth`, its listing into
   * `clifListing`, and its text in one dispatch, whose update listener clears the link state and schedules the compile
   * as it does for any edit. The compile reads the picker, the width and the listing when it posts, `DEBOUNCE_MS`
   * later, so it posts them together, and the `supersede` that schedule claims draws every view, which brings each
   * width box and each listing switch to the program's.
   */
  const replaceProgram = (program: StoredProgram): void => {
    picker.value = program.encoding
    fieldWidth = program.width
    clifListing = program.listing
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: program.text } })
  }

  /**
   * The last pick's notice, offering its `undo`. The source editor's update listener ends it at every edit that changes
   * the program, and the picker at every encoding chosen in it, which does nothing once it is off the line.
   */
  let pick: Notice | null = null

  /**
   * THE LAST LINK'S OPEN, WHILE ITS `undo` IS OFFERED — Plan 7 part 6a spec §5.5: the action, and the notice carrying it
   * now. **HELD APART FROM THE NOTICE, WHICH GOES IN `NOTICE_MS`**, because a later notice about the same open — a
   * clamp, the tenth continue — offers the same `undo` again, however long after the open it comes. It is withdrawn as
   * a pick's is, at the next edit that changes the program and at the next encoding chosen, since it puts back the
   * whole document; and it ends when it is used, or when another link opens.
   */
  let offer: { readonly undo: NoticeAction; notice: Notice } | null = null
  const withdrawOffer = (): void => {
    offer?.notice.dismiss()
    offer = null
  }
  /** Say `text` about the last open, with its `undo` while that is offered, however long after the open (spec §5.5). */
  const sayAboutOpen = (text: string): void => {
    const notice = notices.notify(text, offer === null ? {} : { action: offer.undo })
    if (offer !== null) offer.notice = notice
  }

  /**
   * A LINK'S POSITIONS — `share-positions.ts`'s `LinkPositions`, held from a whole open until the frames reach them
   * (spec §5.4). **A LEG THAT STOPS SHORT IS SAID ABOUT THE OPEN**, carrying its `undo`: the run ended before the step,
   * or `MAX_LINK_CONTINUES` continues did not reach it, and the step shown is the leg's last. Each one redraws the one
   * notice, naming every leg stopped short so far (spec §5.4's note of 2026-10-01).
   *
   * **ONLY OF A LEG THE TREE HAS A VIEW OF.** A link carries a step for every leg with frames, whichever views its page
   * showed, and the notice ends *showing step …*. The leg still goes to its last step, and its view shows that step if
   * a toggle brings it back. **AND A LEG NO VIEW SHOWS DRAWS NOTHING OVER THE LINE**: said again for it, the notice
   * would repeat the legs already named.
   */
  const positions = new LinkPositions({
    legOf: (leg) => sessions.legOf({ session: SOURCE_SESSION, leg }),
    extend: (leg) =>
      sessions.entryOf(SOURCE_SESSION).client.extend(leg, sessions.legOf({ session: SOURCE_SESSION, leg }).epoch),
    awaitingRun: () => sessions.entryOf(SOURCE_SESSION).client.awaitingRun,
    short: (shorts) => {
      const viewed = shorts.filter((short) => combinationOf(tree).includes(short.leg))
      // THE LEG THAT STOPPED NOW IS THE LAST OF `shorts`: where no view shows it, there is nothing new to say.
      if (viewed.at(-1) === shorts.at(-1)) sayAboutOpen(shortNotice(viewed))
    },
    draw: () => draw(),
  })

  // A CHOICE OF ENCODING IS HALF OF WHAT THE UNDO PUTS BACK, so it goes at one too — a pick's and a link's. A pick, a
  // link and their undos set the picker by assignment, which fires no `change`, so none ends its own notice.
  picker.addEventListener('change', () => {
    pick?.dismiss()
    withdrawOffer()
  })
  /**
   * A WIDTH CHOSEN IN A TM VIEW IS THE PROGRAM'S, so it recompiles the program, once, and the `supersede` that compile
   * claims draws every view, which brings each view's width box to it. It ends a pick's and a link's notice as an
   * encoding chosen does: their undo restores the program as it ran when they were offered, and a width chosen since
   * changes that run.
   */
  const chooseFieldWidth = (width: number | null): void => {
    fieldWidth = width
    pick?.dismiss()
    withdrawOffer()
    compile.schedule(view.state.doc.toString())
  }

  /**
   * A LISTING CHOSEN IN A CLIF VIEW IS THE PROGRAM'S, as a width is, so it is stored with the program, and the draw
   * shows it in every CLIF view. **IT RECOMPILES NOTHING**: no other leg's run depends on it, so `clifSync` asks the
   * session worker for the CLIF leg alone, recorded again from step 0 under a new epoch (CLIF view design §6, *The
   * switch*). It ends a pick's and a link's notice as a width chosen does: their undo puts back the listing they
   * replaced.
   */
  const chooseClifListing = (listing: Listing): void => {
    if (listing === clifListing) return
    clifListing = listing
    pick?.dismiss()
    withdrawOffer()
    writeProgramStorage({ text: view.state.doc.toString(), encoding: picker.value, width: fieldWidth, listing })
    // **A LINK'S CLIF POSITION GOES**, held for the link's compile or pending on the leg: it is a step of the run of
    // the listing it was made in, and the share link's reader drops one whose listing it cannot run for the same
    // reason. **AFTER THE REQUEST, WHICH DRAWS**: the leg still has the position in that draw and the hold says it from
    // the next, so no draw writes the step line without it. One that did would re-wrap the line and write the
    // listing's scroll for a box the next draw takes back, and a scroll written away and back does not return to the
    // same fraction of a pixel in every browser.
    const leg = sessions.legOf({ session: SOURCE_SESSION, leg: 'clif' })
    const going = leg.pending
    // **THE NEW LISTING'S MACHINE CODE IS ASKED FOR FIRST**, so the worker builds it before the listing, which the hold
    // keeps back until its frames come: the panel then changes in the listing's frame.
    machineCode.switching(
      listing,
      panes.of('clif').flatMap((e) => (e.pane as ClifPane).machineShown() ?? []),
    )
    clifSync.want(clifWanted())
    positions.forget('clif')
    // **THE STEP LINE GOES ON SAYING WHERE THE LINK WAS TAKING THE LEG WHILE THE CHOICE HOLDS IT**
    // (`ClifHold.linkStep`), until the new listing's frames replace the line: said no longer at the press, the line
    // would change, and could re-wrap and move the rows, a frame or more before the view does.
    if (going !== undefined && leg.clifHold !== undefined) leg.clifHold.linkStep = going
    draw()
  }

  /**
   * PICK AN EXAMPLE — Plan 7 part 6a spec §4.5. It replaces the program at once, under the default encoding at auto,
   * since the manifest's outcomes and descriptions are theirs (the TM width design, decision 7); the workspace is
   * untouched. The notice's `undo` puts back the text, encoding, width and listing it replaced, and so recompiles.
   *
   * **THE UNDO IS WITHDRAWN AT THE NEXT EDIT THAT CHANGES THE PROGRAM**, typed or otherwise, and by the next pick,
   * whose own replacement is such an edit. It puts back the whole document the pick replaced, so offered past an edit
   * it would throw that edit away with the example. An edit that leaves the document as it was — a format pass on text
   * already formatted — has nothing to lose, and leaves the undo where it is. **AND AT THE NEXT ENCODING CHOSEN IN THE
   * PICKER**, which the undo would take back with the encoding the pick replaced.
   *
   * **THE EDITOR'S OWN UNDO STEPS BACK THROUGH A PICK TOO, AND PUTS BACK THE TEXT ALONE**, leaving the encoding at
   * `EXAMPLE_ENCODING` and the width at auto, as the pick set them. That is left as it is: the editor's history holds
   * the text, and no encoding or width chosen by hand has ever been in it — undoing in the editor after choosing
   * another encoding by hand does not put the earlier one back either — so a pick's encoding and width are the
   * notice's `undo` to put back, and otherwise the picker's and the width boxes' to change.
   *
   * **UNDO REMOVES THE CONTROL IT WAS ACTIVATED FROM, SO IT OWES THE FOCUS SOMEWHERE**, as an open's undo does: the
   * source editor, where the program came back — or, where no view shows the source and the editor is off the page,
   * `examples ▾`, where the pick was made. An editor off the page takes no focus, and `examples ▾` takes it then
   * whether or not the focus was on the undo. **AN UNDO THAT GOES UNUSED GIVES THE FOCUS THERE TOO**: one the focus is
   * on when it runs out, or is drawn over by a notice with no action of its own, names `examples ▾` as its `fallback`,
   * and not the line's own, `settings`, which has nothing to do with the program.
   *
   * **AND IT SAYS SO, ONCE THE FOCUS HAS MOVED**, on the notice line and in the live region, as an open's undo says
   * `put back the program`: umbrella §4's rule that a gesture's result is said in the one live region. Said after the
   * focus lands, so the sentence is not spoken over by the editor or the button taking it.
   */
  const openExample = (example: Example): void => {
    const before: StoredProgram = {
      text: view.state.doc.toString(),
      encoding: picker.value,
      width: fieldWidth,
      listing: clifListing,
    }
    replaceProgram({ text: example.text, encoding: EXAMPLE_ENCODING, width: null, listing: 'as-built' })
    pick = notices.notify(`opened the example ${example.title}`, {
      action: {
        label: 'undo',
        fallback: () => examplesButton,
        run: () => {
          replaceProgram(before)
          view.focus()
          if (!view.hasFocus) examplesButton.focus()
          notices.notify('put back the program')
        },
      },
    })
  }

  // `examples ▾` — spec §4.2: built on each open, from the manifest.
  wireMenu(examplesButton, examplesMenu, () => exampleItems(examplesMenu, EXAMPLES, openExample))

  /**
   * WHAT A LINK CARRIES — Plan 7 part 6a spec §5.1: the source editor's text, the encoding in the picker, the
   * program's width and listing, the workspace as `serializeWorkspace` writes it, and each program leg's step.
   *
   * **A POSITION IS TAKEN ONLY WHILE THE PROGRAM SESSION IS NOT AWAITING A RUN** (`SessionClient.awaitingRun`).
   * Positions describe the frames on screen, and while the editor's text is compiling those are the last program's, so
   * a link made then carries none.
   *
   * **BUT A LEG STILL GOING TO ITS LINK'S STEP PASSES THAT STEP ON** — spec §5.1's note of 2026-10-01: in place of the
   * step it shows, whether or not it has frames yet, and while the link's own compile runs, so a link shared while it
   * is being reached is passed on unchanged. Only for the compile the session's generation names now: an edit claims
   * the next generation at once, and a step pending then is the earlier program's (`LinkPositions.pendingFor`).
   */
  const sharePayload = (): SharePayload => {
    const { client } = sessions.entryOf(SOURCE_SESSION)
    const steps: { [L in Leg]?: number } = { ...positions.pendingFor(client.gen) }
    if (!client.awaitingRun) {
      for (const leg of LEGS) {
        // NOT A HELD RING'S (`ClifHold`): its frames are of the listing the program has just left.
        const { hist, clifHold } = sessions.legOf({ session: SOURCE_SESSION, leg })
        if (steps[leg] === undefined && hist.length > 0 && clifHold === undefined) steps[leg] = hist.currentStep
      }
    }
    return {
      program: view.state.doc.toString(),
      encoding: picker.value,
      width: fieldWidth,
      ...(clifListing === 'optimised' ? { listing: clifListing } : {}),
      // **THE ARRANGEMENT ON SCREEN AND NO OTHER** (the view layouts spec §4.7): a reader needs what the sender saw, and
      // a link has a size to keep down. Emptied here, `serializeWorkspace` writes no `arrangements` and no state of a
      // view only a remembered arrangement held.
      workspace: serializeWorkspace({ tree, ...ws, arrangements: {} }),
      positions: steps,
    }
  }

  // `share` — spec §5.2: a popover built again on each open, so nothing keeps a link current (row 8).
  wireMenu(
    shareButton,
    shareMenu,
    createShare({
      menu: shareMenu,
      payload: sharePayload,
      base: () => `${location.origin}${location.pathname}`,
      // `undefined` OUTSIDE A SECURE CONTEXT, though the DOM's types say otherwise: the clipboard is exposed only there.
      clipboard: () => navigator.clipboard as Clipboard | undefined,
      notify: (text) => notices.notify(text),
      announce: (text) => notices.announce(text),
    }),
  )

  /**
   * What an open replaced, for its *undo* to put back (spec §5.5): the program; and where the link opened whole, the
   * workspace.
   */
  type Replaced = {
    readonly program: StoredProgram
    readonly workspace: Workspace | null
  }

  /**
   * Put `next` in force as the workspace: the tree and the rest of it, its switches applied, the inspector and the
   * source outline open or shut as it says, and every view built again from it on the program
   * (`PaneHost.rebuildViews`).
   */
  const showWorkspace = (next: Workspace): void => {
    const { tree: nextTree, ...rest } = next
    tree = nextTree
    ws = rest
    seedLeafCounter(liveLeaves(tree, ws.arrangements).keys())
    applySwitches()
    inspectorPanel.setOpen(ws.inspector)
    sourceOutline.panel.setOpen(ws.panels[SOURCE_LEAF]?.outline ?? false)
    sourceRegions.unmaximise()
    sourceRegions.setSizes(ws.panelSizes[SOURCE_LEAF] ?? {})
    paneHost.rebuildViews(focusedLeaf())
  }

  /**
   * Undo an open — spec §5.5: the program as it ran, and where it opened whole the tree and the workspace.
   *
   * **USED, IT IS WITHDRAWN BY THE EDIT IT MAKES**, as any edit that changes the program withdraws it; one that changes
   * nothing leaves nothing a later notice could offer it again for.
   *
   * **UNDO REMOVES THE CONTROL IT WAS ACTIVATED FROM, SO IT OWES THE FOCUS SOMEWHERE**, as a pick's does: the source
   * editor, where the program came back, or `share` where no view shows the source. And it says so, once the focus
   * has moved.
   *
   * **IT CLOSES `share`'S POPOVER**, as an open does (`openLink`): the link in it is to the program the undo replaces.
   * Used from the keyboard, the popover can still be open; a press outside it would have closed it.
   */
  const undoOpen = (before: Replaced): void => {
    shareMenu.hidePopover()
    replaceProgram(before.program)
    if (before.workspace !== null) showWorkspace(before.workspace)
    view.focus()
    if (!view.hasFocus) shareButton.focus()
    notices.notify(before.workspace === null ? 'put back the program' : 'put back the program and the workspace')
  }

  /**
   * Say what an open did, and clear the fragment — spec §5.3, §7. **THE FRAGMENT IS CLEARED WHATEVER THE LINK HELD**
   * (row 5), with `history.replaceState`, which fires no `hashchange`: a reload then keeps the edits made since rather
   * than opening the link again, and a link that could not be read is not read again. A link that opened offers its
   * `undo` in place of any earlier open's.
   */
  const announceOpen = (opened: OpenedLink, before: Replaced): void => {
    // `window.history`, SINCE `history` HERE IS CODEMIRROR'S: the editor's undo history, imported above.
    window.history.replaceState(window.history.state, '', `${location.pathname}${location.search}`)
    if (opened.kind === 'unreadable') {
      notices.notify('this link could not be read — nothing was changed')
      return
    }
    // A WHOLE LINK'S POSITIONS ARE HELD FOR THE COMPILE OF ITS PROGRAM, THE GENERATION CLAIMED NOW: a pasted link's
    // `replaceProgram` claimed it, and at start-up `main()`'s own `compile.schedule(loaded.text)` did. **NOTHING MAY BE
    // AWAITED BETWEEN THAT CLAIM AND THIS HOLD**: that compile's `compiled` reply gives each leg its position, and one
    // heard first would leave them held for a reply already gone. An earlier link's go here (`hold`), and these go at
    // any recompile's first reply (`LinkPositions.onReply`).
    if (opened.kind === 'whole') positions.hold(sessions.entryOf(SOURCE_SESSION).client.gen, opened.positions)
    // ANY EARLIER OPEN'S OFFER GOES WITH IT: this notice replaces its notice, and this offer takes its place.
    const undo: NoticeAction = { label: 'undo', fallback: () => shareButton, run: () => undoOpen(before) }
    const text =
      opened.kind === 'whole'
        ? 'opened a shared link'
        : `opened a shared link's program — its ${opened.encoding === null ? 'encoding, ' : ''}workspace and step positions were left out`
    offer = { undo, notice: notices.notify(text, { action: undo }) }
  }

  /**
   * OPEN A LINK ON AN OPEN PAGE — spec §5.3: one pasted into the address bar, heard as `hashchange`. Whole, it replaces
   * the program and the workspace and builds every view again on the program; alone, the program, under the link's
   * encoding where this build has it and the picker's otherwise; unreadable, nothing.
   *
   * **THE LATEST LINK WINS.** A call whose read ends after a later call has begun does nothing at all, whatever its
   * link held: it replaces nothing, says nothing, leaves the offer to the open that won and the fragment as that open
   * left it. Otherwise a long link pasted before a short one would be read last and open over it, and the `undo` on
   * the page would put back the short link's program. **IN CHROME THAT CANNOT HAPPEN**: a link's read never spans a
   * task, so it ends in the microtask checkpoint after the `hashchange` listener that began it, before a later
   * `hashchange` can be dispatched (spec §5.3's note has the measurement). The ticket holds the order wherever an engine
   * schedules the stream's work as tasks. **IT ORDERS CALLS, SO IT CANNOT SEE A LINK WHOSE `hashchange` IS STILL
   * QUEUED** when an earlier read ends: that open clears the fragment, and the queued `hashchange` then reads none.
   *
   * **AN OPEN THAT APPLIES CLOSES `share`'S POPOVER**, as its `undo` does: the link in it is to the program the open
   * replaces, and `copy link` would copy that. Pasting into the address bar does not close it, as a click on the page
   * would.
   */
  let linkTicket = 0
  const openLink = async (fragment: string): Promise<void> => {
    const ticket = ++linkTicket
    const opened = await decodeLink(fragment, encodings() as string[], widths)
    // COMPARED AFTER THE READ, NOT BEFORE IT: before it, every call's ticket is the latest.
    if (ticket !== linkTicket) return
    if (opened.kind !== 'unreadable') shareMenu.hidePopover()
    const program: StoredProgram = {
      text: view.state.doc.toString(),
      encoding: picker.value,
      width: fieldWidth,
      listing: clifListing,
    }
    if (opened.kind === 'whole') {
      const before: Replaced = { program, workspace: { tree, ...ws } }
      replaceProgram({ text: opened.program, encoding: opened.encoding, width: opened.width, listing: opened.listing })
      showWorkspace(opened.workspace)
      announceOpen(opened, before)
    } else {
      if (opened.kind === 'program')
        replaceProgram({
          text: opened.program,
          encoding: opened.encoding ?? picker.value,
          width: opened.width,
          listing: opened.listing,
        })
      announceOpen(opened, { program, workspace: null })
    }
  }

  /**
   * THE LINK STATE — `link-wiring.ts`'s own doc has the argument for why `index`/`linkable`/`link`
   * live there rather than as `let`s in this scope. `panes` IS HANDED OVER EMPTY — `PaneCollection` is
   * built above and `applyLayout` (`pane-host.ts`) is the only thing that ever populates it, so every
   * reader here resolves it live rather than at construction time.
   *
   * **A CALL REACHES `draw()` BEFORE `applyLayout()` DOES.** `compile.schedule(loaded.text)` — this
   * file's own start-up compile — is the first `draw()` of the app's life, ahead of the one inside
   * `paneHost.applyLayout()` itself, reached through `client.supersede()`'s `onSupersede` callback.
   * `draw()`'s body (`draw.ts`) reads `panes`, whichever path reached it: `panes.active(…)` for
   * each leg, `panes.all()`, `panes.of('lambda')` and `panes.shown('lambda', …)`.
   *
   * **SAFE, AND FOR A REASON THAT HAS NOTHING TO DO WITH ORDERING.** `applyLayout` is the only thing that ever
   * populates `panes`, so every one of those reads runs against a collection that is genuinely, honestly EMPTY at this
   * point — not stale, not partially built. `panes.active(...)` is optional-chained everywhere it is called, and
   * `panes.all()`/`panes.of('lambda')` iterate zero entries. The invariant is that nothing in this module MISBEHAVES
   * for reading `panes` before `applyLayout`'s first call — every reader here resolves it live and every reader
   * tolerates empty, which is what makes reading it early safe rather than merely unobserved.
   *
   * `view` and `draw` are passed as thunks rather than the values themselves: `view` is not assigned until
   * the `EditorView` construction below, and `draw` (assigned via `createDraw` just below) calls
   * `linkWiring.drawLink` while `linkWiring.setLinkTo` calls `draw`, so one of the two directions has to be
   * late-bound either way.
   */
  linkWiring = createLinkWiring({
    view: () => view,
    statusHost: linkStatusHost,
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
  // `leaves` IS A THUNK — `leaves: () => leaves(tree).length`, resolved live against the tree
  // rather than a number captured once, because a split or a close changes it and `draw()` runs on
  // every recorded frame during playback. `draw.ts` itself never imports `layout.ts`: `setLayoutControls`
  // needs a leaf count, not a tree, and handing it a thunk over a raw number is what keeps `draw.ts`
  // from holding a second, possibly-stale opinion about the shape `main.ts` already tracks.
  //
  // `sourceAvailable` IS THE SAME ARRANGEMENT — whether a split may be offered the SOURCE pane, which is
  // true exactly while the tree holds no source leaf. It is the same predicate `splitLeaf` refuses on
  // (`kind === 'source' && hasSource(root)`), asked here so the split menu never offers what that call
  // would throw on; `layout.ts` keeps its own copy private because a tree operation must enforce its
  // invariant whatever the UI believes.
  draw = createDraw({
    view: () => view,
    sessions,
    panes,
    links: linkWiring,
    trees,
    unseen,
    seedPane: (entry, session) => paneHost.seedPane(entry, session),
    leaves: () => leaves(tree).length,
    sourceAvailable: () => !leaves(tree).some((l) => l.pane === 'source'),
    arranged,
    // THE READOUT'S INPUTS (spec §9) — the program's stored result.
    sourceSession: SOURCE_SESSION,
    readout,
    program: () => program,
    stepsInView: () => ws.switches.steps === 'view',
    stage: () => ws.switches.views === 'stage',
    stepBar,
  })

  /**
   * THE DEBOUNCE PIPELINE — `compile.ts`'s own doc has the case for `schedule`'s dependencies and for
   * the `supersede()`-before-`setTimeout` ordering that must not move; this is only the construction
   * site. A PLAIN `const`, SAME REASON `replies` BELOW IS ONE: `linkWiring` is a real value by this
   * line, so this needs none of the `let` + thunk indirection `draw`/`linkWiring` themselves used two
   * blocks up. `view` is passed as a thunk — the picker's `change` listener `compile.ts` wires at
   * construction reads it, and `main.ts` does not assign `view` until the `EditorView` construction
   * below.
   *
   * Of the registry a compile reads only the source session's own client.
   */
  const compile = createCompile({
    sessions,
    results,
    picker,
    width: () => fieldWidth,
    clif: clifWanted,
    clifSync,
    view: () => view,
    sourceSession: SOURCE_SESSION,
    persist: (text, encoding, width) => writeProgramStorage({ text, encoding, width, listing: clifListing }),
  })

  /**
   * THE REPLY SWITCH — `replies.ts`'s own doc has the case for its dependencies; this is only the
   * construction site. A PLAIN `const` RATHER THAN A `let` + THUNK LIKE `draw`/`linkWiring` ABOVE —
   * nothing calls `createReplies` before everything it needs already exists: `linkWiring` and `draw` are
   * both real values by this line, and both are passed bare below for exactly that reason. `view` is
   * passed as a thunk for the same reason `linkWiring`/`draw` themselves take it as one two blocks up.
   *
   * `sessions.add(...)` ABOVE ALREADY BUILT ITS REPLY CALLBACK AGAINST A NAME — `replies` — THAT DID NOT EXIST YET
   * AT THAT POINT IN THE FILE, and that is the same forward reference this file already relies on for
   * `draw`/`linkWiring` themselves: the source session's handler, which calls `replies.onReply(SOURCE_SESSION,
   * reply)`, is an arrow function whose BODY is not evaluated until a reply actually arrives, by which time this
   * assignment has long since run.
   */
  const replies = createReplies({
    sessions,
    results,
    view: () => view,
    panes,
    links: linkWiring,
    trees,
    unseen,
    draw,
    setProgram: (r: ProgramResult) => {
      program = r
    },
    clif: {
      loaded: (state) => {
        clifLoadState = state
      },
      settled: () => clifSync.settled(),
      absent: forgetClifPart,
    },
    mc: machineCode,
  })

  view = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: loaded.text,
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
        // ANNOUNCED, NOT A NOTICE: a notice would end the one up now, and a pick's undo, which a keyboard user may be
        // leaving the editor to reach, goes with it.
        editorTab({ say: (text) => notices.announce(text) }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // `colourFor`, NOT A SECOND `treeSitterColour` CALL SPELLING THE SAME FIELDS OUT: see `colourFor`'s doc.
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
          // NO FLUSH HERE. This editor posts `changeDocument` on every keystroke rather than on a debounce, so the
          // server's copy is never behind what is on screen.
          blur: () => {
            if (!formatOnBlur || focusKept) return false
            const asked = view.state.doc
            lspClient
              .format(SOURCE_URI)
              .then((edits) => applyEdits(view, edits, asked))
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
        // The keyboard route to the same thing, `LINK_KEY`. Reachability without a mouse is the whole
        // point: a mouse-only primary interaction would have to be retrofitted rather than adjusted.
        keymap.of([
          {
            key: LINK_KEY,
            run: (v) => {
              const pos = v.state.selection.main.head
              linkWiring.linkAtSourceOffset(new TextEncoder().encode(v.state.doc.sliceString(0, pos)).length)
              return true
            },
          },
        ]),
        // `lintGutter()` AND NO `linter` SOURCE. Diagnostics are PUSHED, from the LSP worker through
        // `setCmDiagnostics` below, so there is nothing for a `linter` source to pull. The gutter is
        // the surface.
        lintGutter(),
        // DEFERRED-ACCESSIBILITY ITEM 16. CodeMirror gives its content a `textbox` role and no
        // name, so without this it would be announced as a text box with nothing said of what it holds.
        EditorView.contentAttributes.of({ 'aria-label': 'source program editor' }),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          // A PICK'S UNDO WOULD THROW THIS EDIT AWAY, so it goes now — `openExample`'s own doc, and `offer`'s. **UNLESS THE EDIT LEFT
          // THE DOCUMENT AS IT WAS**: the language server answers a format of text already formatted with one edit
          // replacing the whole document by the same text, so with *format on blur* on, leaving the editor for the
          // undo would otherwise end it on the way there, and nothing that edit did could be lost.
          if (!u.startState.doc.eq(u.state.doc)) {
            pick?.dismiss()
            // A LINK'S UNDO PUTS BACK THE WHOLE DOCUMENT TOO (spec §5.5), so it goes on the same terms.
            withdrawOffer()
          }
          const src = u.state.doc.toString()
          // NO HIGHLIGHTING DISPATCH HERE. The colourer above is a `ViewPlugin` that reparses from this
          // same update without being told, so there is nothing for this listener to push. See
          // `colour.ts`'s two-clocks paragraph.
          //
          // NOT DEBOUNCED, unlike `compile.schedule` below: the server costs 0.15 ms on a source document
          // of this size, and it is on another thread.
          lspClient.changeDocument(SOURCE_URI, src)
          // STALE FROM THIS KEYSTROKE UNTIL THE NEXT COMPILE. `linkMark` clears its own decoration on
          // `docChanged`; this clears the state behind it and, with the `draw()` it causes, the status line
          // AND EVERY VIEW'S PIN — design §6 case 4 requires every pane cleared, not only the source
          // echo. Without it, the λ window and the δ-table's `.is-linked` rows would stay painted from the
          // PREVIOUS index until the next `compiled` reply landed — up to `DEBOUNCE_MS` plus a compile,
          // seconds on a larger program — while the status line already said "linking resumes when this
          // compiles".
          //
          // **`draw()` RUNS ON THIS KEYSTROKE, AND IT CLEARS MOST OF IT.** `compile.schedule` below claims its
          // generation synchronously, and the pool's `onSupersede` repaints through `draw()` before
          // `schedule` returns — not 300 ms from now, when its debounce lands a `compiled`/`no-session`
          // reply. `clearLink` has made `linkable` false by then, so that `draw()` writes "linking resumes
          // when this compiles" to the status line, hands each λ view no pin, and gives each TM view on the
          // page an empty running focus before it renders it; a TM view off the page gets its focus from the
          // `draw()` that shows it. `focusMark` (the CodeMirror decoration) clears itself on `docChanged`,
          // as `linkMark` does.
          linkWiring.clearLink()
          compile.schedule(src)
        }),
      ],
    }),
  })

  // JOINED AFTER CONSTRUCTION, because `follow` takes the view the assignment above was still
  // building. The slot above already holds this mode; joining is what carries a LATER change into it.
  keymapSetting.follow(view)

  /**
   * The source view's outline, a consumer of the panel primitive.
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
  // THE SOURCE VIEW'S TWO REGIONS (the view layouts spec §11.1): the outline over the editor. The editor takes what
  // the view has spare and scrolls inside it; the outline keeps its own height, what it lists up to a cap, until the
  // boundary between the two is dragged. The editor has no header, so a maximised outline leaves it its floor.
  const sourceRegions = new PanelStack(
    [
      {
        name: 'outline',
        label: 'outline',
        el: sourceOutline.panel.el,
        share: null,
        panels: [sourceOutline.panel],
        bodies: () => [sourceOutline.panel.body],
      },
      { name: 'editor', label: 'editor', el: editorHost, share: 1, panels: [], bodies: () => [editorHost] },
    ],
    ws.panelSizes[SOURCE_LEAF] ?? {},
    (sizes) => {
      ws = { ...ws, panelSizes: withPanelSizes(ws.panelSizes, SOURCE_LEAF, sizes) }
      persistWorkspace()
    },
  )
  sourceClosed = () => {
    sourceRegions.unmaximise()
    sourceOutline.panel.setOpen(false)
    sourceRegions.setSizes({})
  }

  // **OPENED AFTER `view`**, which the diagnostics sink below dispatches to.
  // **THE SINK IS PART OF OPENING THE DOCUMENT**, so there is no router to keep in step and no way
  // for this editor to receive another document's diagnostics.
  lspClient.openDocument(SOURCE_URI, 'redextape', loaded.text, {
    diagnostics: (ds) => {
      view.dispatch(setCmDiagnostics(view.state, lspLintRanges(ds, view.state.doc)))
      // ONE SETTLED EDIT, ONE PUBLISH — so this is the cheapest signal that the server has caught
      // up with the document, and the outline asks only while it is open.
      sourceOutline.refresh()
    },
  })

  compile.schedule(loaded.text)

  // THE FIRST RECONCILE. `applyLayout()` builds the panes the tree in force names, attaches every host
  // (including `sourceHost`, built above) into `#views`, persists the tree, and calls `draw()` itself at
  // its own end — near the end of `main()` (`applySwitches()` below runs a second), after everything
  // else is wired (`view` included: `linkWiring`/`draw`/`compile`/`replies` all close over it as a
  // thunk; `draw()`'s own body reads `view()` directly, and has already done so above this line, from
  // `compile.schedule(loaded.text)` through `client.supersede()`). That call reads `panes` too, and
  // `applyLayout` is the only thing that ever populates `panes` (`THE LINK STATE` comment above), so it runs
  // against a collection that is genuinely empty: nothing before this line has BUILT a pane.
  paneHost.applyLayout()
  // **THE SWITCHES ARE APPLIED AFTER THE FIRST LAYOUT, NOT BEFORE IT** (spec §4). A restored workspace can
  // carry any of the eight combinations, and each of the three switches' consumers reads the tree or the
  // panes that `applyLayout()` above is what creates — so this is the earliest moment the page can be put
  // in the state the user left it in.
  applySwitches()

  // THE START-UP LINK'S NOTICE, NOW THAT EVERYTHING IT CAN UNDO EXISTS (spec §5.3): what it replaced is what storage
  // would have opened on — the program, and where it opened whole the workspace.
  if (startLink !== null) {
    announceOpen(startLink, {
      program: storedProgram,
      workspace: startLink.kind === 'whole' ? storedWorkspace : null,
    })
  }
  // A LINK PASTED INTO AN OPEN PAGE (spec §5.3). Any other fragment is left alone.
  addEventListener('hashchange', () => {
    if (isLink(location.hash)) void openLink(location.hash)
  })
  return view
}

/**
 * The app starts on import — `index.html` loads this module and nothing else.
 *
 * THE VIEW IS EXPORTED AS A PROMISE so the browser tests can drive the editor through CodeMirror's own
 * API rather than synthesizing key events into a contenteditable. Nothing in the product reads it.
 */
export const ready = main()
