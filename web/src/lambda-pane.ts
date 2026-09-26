import type { ControlState } from './controls'
import type { EditablePane } from './editor-custody'
import { EDITOR_DEBOUNCE_MS } from './editor-debounce'
import { LambdaBody } from './lambda-body'
import { Folds } from './lambda-folds'
import { codeLines, type Line, lineOf, outlineLines } from './lambda-layout'
import { Tree } from './lambda-tree'
import type { TreeFor } from './lambda-trees'
import type { Dir } from './layout'
import type { LambdaLinkState } from './link-status'
import { type PaneChoice, type PaneEvents, type SplitChoices, textPanel } from './pane-chrome'
import { createPanel, type Panel } from './panel'
import type { LambdaTreeWire, Leg } from './protocol'
import type { ScratchEditorConfig } from './scratch-editor'
import { ScratchEditor } from './scratch-editor'
import type { Binding, PaneOption } from './sessions'
import { stepControls } from './step-controls'
import { type MapPick, TermMap } from './term-map'
import type { LambdaState } from './types'
import { radioGroup, type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
import { DEFAULT_DISPLAY, type LambdaDisplay } from './workspace'

export type { PaneEvents }

/**
 * The λ pane: the displayed step's term, laid out from the tree the worker serves for it (Plan 7 part 4a)
 * — or, before that tree arrives and when it is refused, the frame's own text, syntax-coloured by the
 * same token classes the source pane uses.
 *
 * TRUNCATION IS SHOWN, NOT HIDDEN, in that flat text. `frame_cost_probe` measured a history frame's
 * budget at 512 bytes, two orders below the readout's, so most non-trivial frames WILL truncate. A BYTE
 * cut's text is a prefix of the real term; a DEPTH cut's is not — see `results.ts`'s note on `Cut` for
 * why — but showing either beats hiding it, which is why both are marked the same way (`… truncated` /
 * `… too deep`, `lambda-body.ts`'s `flatText`) rather than one being suppressed. The tree is the whole
 * term, and `results.ts` still prints the full normal form at 64 KiB.
 */
export class LambdaPane implements EditablePane {
  /** The body — a laid-out tree, or a frame's flat text (`lambda-body.ts`). */
  #body: LambdaBody
  /** The `follow redex` header action (spec §5.3), present only while the body shows a tree it is not following. */
  #reattach: HTMLButtonElement
  /** What `draw()` last said about the tree for the displayed step. */
  #treeFor: TreeFor = { kind: 'none' }
  /** One `Tree` per wire, so a redraw of the same step derives nothing twice. */
  #trees = new WeakMap<LambdaTreeWire, Tree>()
  #folds = new Folds()
  #map: TermMap
  #mapPanel: Panel
  /** The icicle/minimap switch in the map panel's header — a radio group synced to `#display.map`. */
  #mapMode: ReturnType<typeof radioGroup>
  /** The lines the view last drew, for the map to draw beside them. */
  #shownLines: readonly Line[] = []
  /** How this view draws its term: its layout, its variables, and its term map's mode (spec §5.1). */
  #display: LambdaDisplay
  /** `PaneEvents.display`: record a changed display for this view, so a reload keeps it. */
  #onDisplay: ((d: LambdaDisplay) => void) | undefined
  /** The session this view last drew — see `setBindings`. */
  #bound: string | null = null
  /** The build this view's trees last came from — see `setBuild`. */
  #build: number | null = null
  /** The last layout and what produced it — a redraw with the same inputs reuses the lines. */
  #laidOut: { key: string; tree: Tree; lines: Line[] } | null = null
  /**
   * The tree whose drawing last threw, or `null`. The view shows its step as the frame's text with one note
   * instead (spec §10), and does not try that tree again until the display or the folds change.
   *
   * **THE TREE IS STORED BEFORE IT IS DRAWN, SO A DRAW THAT THROWS MUST NOT LEAVE IT TO THROW AGAIN.** A layout
   * that overflowed on a deep term left it in `#treeFor`; `render` redraws before `renderTree` can replace it,
   * so every later frame threw inside `draw()` and the view never drew another tree, even after a recompile.
   */
  #unlaid: Tree | null = null
  #steps: ReturnType<typeof stepControls>
  /**
   * The view's header (`view-header.ts`'s `viewHeader`): the title that is the selector, the
   * `copy · not linked` status, and the slot the transport strip mounts in.
   */
  #header: ViewHeader
  /**
   * The view's `⋯` menu and `✕` (`view-header.ts`'s `viewMenu`): split right, split down, edit a copy,
   * move the editor here.
   *
   * AN ITEM IS BUILT ONLY WHEN ITS HANDLER EXISTS, rather than built always and calling `on.detach?.()`.
   * That is the same standard §4.5 states and the `linkLambda` handler below does NOT need: a click that
   * goes nowhere is invisible, but a control that cannot work is on screen. A caller with no `detach` — a
   * test fixture, or any future pane that renders λ frames it does not own — gets a view with no copy
   * offered rather than one that offers a copy and swallows it.
   */
  #menu: ViewMenu
  #frame: LambdaState | null = null
  /**
   * The upper half of design §4.2's split body — a stable parent that outlives any editor mounted or
   * unmounted inside it, so `setEditor` can do both without touching the pane's own child order.
   *
   * CARRIES NO CLASS UNTIL `setEditor` GIVES IT ONE. An empty class means `.term-editor` selects
   * nothing on a pane that has never had an editor, which is what `lambda-pane-editor.test.ts`'s
   * "no editor region until one is set" pins — the class, not the element's mere presence, is what
   * "is there an editor" answers.
   */
  #editorHost: HTMLElement
  /**
   * The mounted `ScratchEditor`, or `null` on an attached pane. NEVER `null` merely because the editor
   * is collapsed away — the text panel (`textPanel`, constructor below) hides `#editorHost` itself with
   * `hidden`; this field is untouched, so a collapsed editor is a live CodeMirror instance sitting
   * behind a hidden parent, with its debounce still running exactly as it was before the click.
   * `setDetached` is what makes "attached" and "`#editor === null`" the same fact — see its own doc for
   * the review finding that made that true rather than merely intended.
   */
  #editor: ScratchEditor | null = null
  #collapse: ReturnType<typeof textPanel>
  /**
   * What this pane's split menus offer, last pushed by `setLayoutControls` — see `SplitChoices` for why
   * the starting value is "nothing on offer, and no pair in force" rather than an invented binding, and
   * `PaneView.setLayoutControls` for why the whole list arrives on the call that mounts the control.
   *
   * A FIELD READ THROUGH A THUNK RATHER THAN A LIST HANDED TO `viewMenu` ONCE. The split's pairs are built
   * when a split is chosen (`viewMenu`'s doc), so what it needs is the CURRENT value at that moment; a list
   * passed at construction would be the one thing a build-on-open cannot fix.
   */
  #choices: SplitChoices = { options: [], sourceAvailable: false, current: null }
  /**
   * `on.editScratch`, captured once at construction — `setEditor` reads it per mount rather than
   * closing over `on` directly, so a pane built with no handler mounts an editor that simply drops
   * its edits, the same "control that cannot work is still absent, an edit that goes nowhere is
   * invisible" split `PaneEvents.detach`'s doc draws for the fork button.
   */
  #onEdit: ((src: string) => void) | undefined
  /** `PaneEvents.linkLambda`: link from a construct's id. Absent, a click on the term links nothing. */
  #onLinkNode: ((node: number) => void) | undefined
  /** The construct `draw()` says is pinned, or `null` — this view marks every node that carries it. */
  #pin: number | null = null
  /** The pin the view last scrolled to, so a new pin scrolls once and a held one does not keep scrolling. */
  #revealed: number | null = null
  /**
   * The pin a click or Enter in this view is making, while `draw()` hands it back — `null` otherwise.
   *
   * **A PIN MADE IN THIS VIEW DOES NOT SCROLL IT.** The user is pointing at the construct already, and a
   * scroll to its first node would move the term out from under the pointer and detach follow redex.
   * Another λ view showing the construct still brings it into view.
   *
   * NOT `#revealed` SET EARLY: `draw()` renders each view before it hands it the pin, and that redraw, with
   * the old pin, would put `#revealed` back.
   */
  #pinnedHere: number | null = null
  /** Resolves this pane's current binding to an LSP document — see `PaneEvents.lspDocument`. */
  #lspDocument: (() => ScratchEditorConfig['document']) | undefined
  /** Resolves this pane's language to its colourer — see `PaneEvents.colour`. */
  #colour: (() => ScratchEditorConfig['colour']) | undefined
  /** The page's keymap setting, which this pane's editor joins — see `PaneEvents.keymap`. */
  #keymap: ScratchEditorConfig['keymap']
  /**
   * Whether the session this pane is bound to is outside the source correspondence — §4.5's fact,
   * kept because the fork control needs it and `setDetached` is not the only thing that moves it.
   *
   * A FIELD RATHER THAN A READ OF THE BADGE'S OWN STATE. The fork control's availability is a
   * function of TWO inputs that arrive through two different calls — the binding (`setDetached`) and
   * the frame (`render`) — so whichever arrives second has to see the first. The view header holds an
   * equivalent boolean privately for its own no-op guard; asking it would make one widget's internal
   * state another's input.
   */
  #detached = false
  /**
   * Whether this pane's session has an editor to bring here at all — `#refreshClaim`'s THIRD input, and
   * the one whose absence made "move the editor here" a control that provably could not
   * work (deferred-a11y item 11, fixed here).
   *
   * **THE TWO INPUTS IT JOINS ONLY APPROXIMATED THIS, AND 5d-ii-c's DECISION 2 IS WHAT SEPARATED THEM.**
   * `#detached && #editor === null` was read as "this session has an editor, mounted elsewhere" — true
   * while a detached pane with no editor anywhere was a state the app cleaned up rather than one it
   * left. A fork whose build failed used to END the buffer, putting `#detached` back to `false` within
   * the same reply. Nothing ends a buffer implicitly now, so a pane stranded on a phantom fork sits with
   * both conjuncts permanently true and no editor in existence: the control was offered forever and the
   * click recorded a claim `reconcileEditors` could find nothing for.
   *
   * **TWO ROUTES REACH THAT STATE, NOT ONE — this paragraph said "the one path" and the paragraph's own
   * last sentence contradicted it (Minor finding, review of this fix).** `replies.ts`'s `worker-error`
   * arm calls `editorHome(session)?.setEditor(null)`, which DESTROYS the editor and retires nothing, so
   * a pane whose worker died is left in exactly the same shape as one whose fork never built. That route
   * has existed since 5d-ii-a and was never covered by the retire the sentence above rests on, so the
   * approximation was already imperfect before decision 2 widened the gap.
   *
   * PUSHED PER FRAME BY `draw()`, NOT ASKED FOR ON THE FOUR TRANSITIONS `#refreshClaim` ALREADY RUNS ON.
   * The other two inputs are facts about THIS pane and change only when this pane is called; this one is
   * a fact about a session that other panes and the reply switch move — `scratch-compiled` on a buffer
   * that finally built mounts an editor through `editorHome`, and a close hands one to custody — so a
   * value read at those four moments would be stale in exactly the cases the field exists for.
   * `setDetached` is driven the same way and for the same reason (`PaneSlot.render`).
   *
   * FALSE UNTIL TOLD OTHERWISE, which is what makes a pane built outside `main.ts` — every direct-layer
   * test in `tests/browser/` — withhold the control rather than offer one nothing behind it can answer.
   */
  #editorAvailable = false

  constructor(
    host: HTMLElement,
    on: PaneEvents,
    opts: { readonly display?: LambdaDisplay; readonly map?: boolean } = {},
  ) {
    this.#display = opts.display ?? DEFAULT_DISPLAY
    this.#onDisplay = on.display
    // THE HEADER CARRIES THE TITLE-SELECTOR AND THE STATUS — `view-header.ts`'s own doc has why the title
    // is the selector and why the status sits inside the heading.
    this.#header = viewHeader(on.rebind)
    this.#body = new LambdaBody({
      toggle: (node) => this.#toggle(node),
      link: (node) => this.#linkFrom(node),
      scrolled: () => this.#drawMap(),
    })
    // THE TERM MAP (spec §6): a panel, closed until opened, its mode a radio group in its header.
    this.#map = new TermMap((pick) => this.#pick(pick))
    const mapHost = document.createElement('div')
    mapHost.className = 'term-map-host'
    mapHost.append(this.#map.el)
    this.#mapPanel = createPanel({
      name: 'map',
      label: 'term map',
      body: mapHost,
      open: opts.map ?? false,
      onToggle: (open) => {
        on.panel?.('map', open)
        this.#drawMap()
      },
    })
    this.#mapMode = radioGroup(
      {
        label: 'map mode',
        choices: [
          { value: 'icicle', label: 'icicle' },
          { value: 'minimap', label: 'minimap' },
        ],
        current: () => this.#display.map,
        pick: (v) => this.#setDisplay({ ...this.#display, map: v === 'minimap' ? 'minimap' : 'icicle' }),
      },
      'map-mode',
    )
    this.#mapPanel.actions.append(this.#mapMode.el)
    this.#steps = stepControls(on)
    // THE FRAME'S STEP for `edit a copy`. The run closure supplies the step of the frame this leg is
    // actually at, which is what design §4.1's replay reduces to. `#refreshDetach` does NOT check the
    // frame's cut: §4.1a moved that refusal to the worker, which answers a diagnostic while this control
    // stays offered.
    const detach = on.detach
    this.#menu = viewMenu(this.#header.actions, {
      // REMOVED WHERE THERE IS NO EDITOR, not disabled: a view showing a running leg has no
      // document to format, which is the umbrella's rule for a control that cannot apply.
      format: () => void this.#editor?.format(),
      ...(on.splitRow !== undefined && on.splitColumn !== undefined
        ? { split: (dir: Dir, c: PaneChoice) => (dir === 'row' ? on.splitRow?.(c) : on.splitColumn?.(c)) }
        : {}),
      ...(on.close !== undefined ? { close: on.close } : {}),
      ...(detach !== undefined
        ? { editCopy: { run: () => detach(this.#frame?.step ?? 0), what: 'the term at this step' } }
        : {}),
      ...(on.showEditor !== undefined ? { claim: on.showEditor } : {}),
      display: {
        groups: [
          {
            label: 'layout',
            choices: [
              { value: 'code', label: 'code' },
              { value: 'outline', label: 'outline' },
            ],
            current: () => this.#display.layout,
            pick: (v) => this.#setDisplay({ ...this.#display, layout: v === 'outline' ? 'outline' : 'code' }),
          },
          {
            label: 'variables',
            choices: [
              { value: 'names', label: 'names' },
              { value: 'debruijn', label: 'de Bruijn' },
            ],
            current: () => this.#display.vars,
            pick: (v) => this.#setDisplay({ ...this.#display, vars: v === 'debruijn' ? 'debruijn' : 'names' }),
          },
        ],
        reset: () => {
          this.#folds.reset()
          this.#unlaid = null
          this.#redraw()
        },
      },
      choices: () => this.#choices,
    })
    // THE HOST IS IN THE DOM FROM CONSTRUCTION AND CARRIES NO CLASS UNTIL AN EDITOR IS MOUNTED.
    // A stable parent is what lets `setEditor` mount and unmount without touching the pane's child
    // order; the class is what `.term-editor` selects, so an empty host matches nothing and "is there
    // an editor" has one answer in the DOM as well as in the field.
    this.#editorHost = document.createElement('div')
    this.#onEdit = on.editScratch
    this.#lspDocument = on.lspDocument
    this.#colour = on.colour
    this.#keymap = on.keymap
    // FOLLOW REDEX (spec §5.3), ADDED AND REMOVED, NEVER DISABLED — the TM view's `follow current rule`, and
    // the umbrella's rule for a control that cannot apply: a re-attach does something only while the body
    // shows a tree it is not following, so the action exists only then, and the body says when that changes.
    // A HEADER ACTION: the body sits under the view's header as the TM table sits under its panel's, where
    // that view's action rides.
    this.#reattach = document.createElement('button')
    this.#reattach.type = 'button'
    this.#reattach.className = 'term-reattach'
    this.#reattach.textContent = 'follow redex'
    this.#reattach.hidden = true
    this.#reattach.addEventListener('click', () => {
      const had = document.activeElement === this.#reattach
      // Follows again and repaints now, on the redex, rather than at the next step.
      this.#body.attach()
      // THE BUTTON HIDES ITSELF — the paint above tells `onDetached` — AND MUST NOT TAKE THE FOCUS WITH IT
      // (`focus-handoff.ts`'s rule): the term it acts on takes it, one tab stop with its own keys.
      if (had && this.#reattach.hidden) this.#body.el.focus()
    })
    // PREPENDED, BECAUSE `⋯` IS ALREADY THERE: the menu's display settings mount it at construction, and the
    // umbrella's header order puts a view's own actions before `⋯`.
    this.#header.actions.prepend(this.#reattach)
    this.#body.onDetached = (detached) => {
      this.#reattach.hidden = !detached
    }
    // THE TEXT PANEL WRAPS THE EDITOR HOST and hides it itself; this callback only REPORTS the gesture —
    // see `PaneEvents.collapse`'s own doc for why the app needs telling (the state is recorded against
    // the buffer, not the pane).
    this.#collapse = textPanel(this.#editorHost, (collapsed) => on.collapse?.(collapsed))
    this.#header.steps.append(this.#steps.el)
    host.replaceChildren(this.#header.el, this.#collapse.el, this.#body.el, this.#mapPanel.el)

    // λ -> SOURCE, the third direction: a click on any token links from the construct its node belongs to
    // (`LambdaBody`'s `link` event, `#linkFrom`), at whatever step is on screen (Plan 7 part 4a).
    this.#onLinkNode = on.linkLambda
  }

  /**
   * What `draw()` knows about the tree for the displayed step (spec §4). Called every frame, after `render`;
   * the layout is reused while its inputs are unchanged.
   */
  renderTree(treeFor: TreeFor, pin: number | null = null): void {
    this.#treeFor = treeFor
    this.#pin = pin
    this.#redraw()
  }

  /**
   * What the λ half of the link status says about the pinned construct (spec §5.4): shown when a node
   * at this step carries it, `none-here` when none does, and why there is no tree when there is none.
   * A stale tree is another step's, shown until this step's arrives, so it answers nothing: `'waiting'`.
   */
  linkState(): LambdaLinkState {
    const t = this.#treeFor
    if (t.kind === 'refused') return 'too-large'
    if (t.kind === 'none' || t.kind === 'stale') return 'waiting'
    const tree = this.#treeOf(t.tree)
    // A TREE THE VIEW COULD NOT LAY OUT is shown as text, as a refused one is, and marks nothing.
    if (tree === this.#unlaid) return 'too-large'
    if (this.#pin === null) return 'shown'
    return tree.nodesLinkedTo(this.#pin).length > 0 ? 'shown' : 'none-here'
  }

  #treeOf(wire: LambdaTreeWire): Tree {
    let tree = this.#trees.get(wire)
    if (tree === undefined) {
      tree = new Tree(wire)
      this.#trees.set(wire, tree)
    }
    return tree
  }

  #setDisplay(d: LambdaDisplay): void {
    this.#display = d
    this.#unlaid = null
    this.#mapMode.sync()
    this.#redraw()
    this.#onDisplay?.(d)
  }

  /**
   * Draw the term map over what the body shows — only while its panel is open. With no tree, the map is
   * emptied and says why, rather than go on showing the last tree it drew.
   */
  #drawMap(): void {
    if (!this.#mapPanel.isOpen()) return
    const tree = this.#shownTree()
    if (tree === null) {
      const t = this.#treeFor
      this.#map.clear(
        t.kind === 'refused'
          ? `this step’s term has ${t.nodes.toLocaleString()} nodes, too many to map`
          : t.kind === 'none'
            ? 'no tree for this step yet'
            : 'this step’s term could not be laid out',
      )
      return
    }
    const { first, last } = this.#body.visible
    const linked = this.#pin === null ? [] : tree.nodesLinkedTo(this.#pin)
    this.#map.draw({ tree, lines: this.#shownLines, mode: this.#display.map, first, last, linked })
  }

  /** A click on the map: open whatever hides the node it names, then scroll the body to it. */
  #pick(pick: MapPick): void {
    const tree = this.#shownTree()
    if (tree === null) return
    if ('line' in pick) {
      this.#body.reveal(pick.line)
      return
    }
    this.#folds.reveal(tree, pick.node)
    this.#redraw()
    const at = lineOf(tree, this.#shownLines, pick.node)
    if (at >= 0) this.#body.reveal(at)
  }

  #lines(tree: Tree): Line[] {
    const width = this.#body.columns()
    const { layout, vars } = this.#display
    const key = `${width}:${this.#folds.version}:${layout}:${vars}`
    if (this.#laidOut !== null && this.#laidOut.tree === tree && this.#laidOut.key === key) return this.#laidOut.lines
    const lay = layout === 'outline' ? outlineLines : codeLines
    const lines = lay(tree, { width, vars, open: (i) => this.#folds.isOpen(tree, i) })
    this.#laidOut = { key, tree, lines }
    return lines
  }

  /** The tree the body is drawing, or `null` — none held, a refused step, or one it could not lay out. */
  #shownTree(): Tree | null {
    const t = this.#treeFor
    const tree = t.kind === 'tree' || t.kind === 'stale' ? this.#treeOf(t.tree) : null
    return tree === this.#unlaid ? null : tree
  }

  #toggle(node: number): void {
    const tree = this.#shownTree()
    if (tree === null) return
    this.#folds.toggle(tree, node)
    this.#redraw()
  }

  #linkFrom(node: number): void {
    const tree = this.#shownTree()
    const id = tree?.linkedAncestor(node) ?? null
    if (id === null) return
    // `setLinkTo` draws before it returns, so the pin comes back to `#redraw` inside this call.
    this.#pinnedHere = id
    this.#onLinkNode?.(id)
    this.#pinnedHere = null
  }

  render(frame: LambdaState | null, controls: ControlState): void {
    this.#steps.update(controls)
    this.#frame = frame
    this.#redraw()
    // THE FRAME IS HALF OF WHETHER A FORK IS POSSIBLE — see `#refreshDetach`. Driven from here and
    // from `setDetached`, which are the two calls that move either half, rather than from a third
    // setter the slot would have to remember to call.
    this.#refreshDetach()
  }

  /**
   * Mount an editor over this pane's term seeded with `text`, or unmount it with `null` — design
   * §4.2's upper region.
   *
   * MOUNTED AND UNMOUNTED, NEVER HIDDEN, for the view status's reason taken one step further: a hidden
   * CodeMirror instance is a live instance with a live debounce, and §5 asks for a test that
   * reattaching a pane REMOVES the editor. Removal is what makes that question have one answer.
   *
   * A RE-SEED WITH THE SAME TEXT IS A NO-OP INSIDE `ScratchEditor.setText`, so this is safe on the
   * per-frame path — which, since the whole-branch review before merge, it genuinely sits on:
   * `setDetached` below now calls `setEditor(null)` itself whenever the pane it reports for stops
   * being detached, and `setDetached` is driven every frame by `PaneSlot.render`. `replies.ts` still
   * calls this method directly for the two things only a caller outside this class can know — the
   * text a freshly-built scratch replied with (`scratch-compiled`) and a scratch whose worker just
   * died with nothing left to recompile against (`worker-error`). **IT ALSO SAID "and still explicitly
   * at retire, ahead of the draw", AND THAT CALL SITE IS GONE**: it was `compile.ts`'s
   * `editorHome()?.setEditor(null)`, already a no-op on every path that reached it (a retire rebinds
   * its panes first, so nothing resolves), and 5d-ii-c decision 2 deleted the branch around it. A
   * retire's editors come down through the sweep instead (`editor-custody.ts`'s `reconcileEditors`).
   * What no caller has to remember is every OTHER way a pane can stop being detached: that used to
   * require a matching `setEditor(null)` at each one, and was found missing at a third exit with no click
   * handler of its own to add one to (the binding selector) and briefly at a fourth that has one but
   * had not called it (`worker-error`, fixed alongside this) — see `setDetached`'s own doc.
   *
   * **`collapsed` SEEDS THE MOUNT, AND ONLY THE MOUNT — 5d-ii-d T9, design §4.7.** Every mount the app
   * makes passes the buffer's own recorded flag, which is `false` for a fresh fork (nobody has collapsed
   * a buffer that has never had an editor). The RE-SEED branch below (`this.#editor.setText(text)`)
   * ignores it, because a live editor's collapse state is the user's own click, not something a later
   * reply gets to overwrite.
   *
   * **`#editorHost.className` HAS FOUR WRITERS IN THIS FILE, NOT ONE — a claim this paragraph used to
   * make and which was false the day it was written (Important finding, 5d-ii-d T9 fix round 1).** It
   * read "the class assignment stays in ONE place — this is the only line that ever writes
   * `#editorHost.className`". Two of the four CLEAR it (this method's own `text === null` branch, and
   * `takeEditor`), because an unmounted host carries no class at all. The other two are MOUNT sites, and
   * both write the unconditional `'term-editor'` now — this line, and `receiveEditor`'s.
   *
   * **THE SEED NO LONGER LIVES IN THE CLASS, WHICH REVERSES WHAT THIS PARAGRAPH USED TO SAY — Plan 7
   * part 1 Task 8.** It read `collapsed ? 'term-editor is-collapsed' : 'term-editor'` here and in
   * `receiveEditor`; the text panel replaced that with `hidden`, so `collapsed` reaches only
   * `this.#collapse.update(true, collapsed)`, in this method and in `receiveEditor` — see that method's
   * own doc for the finding that once left ITS seed out.
   */
  setEditor(text: string | null, collapsed = false): void {
    if (text === null) {
      this.#editor?.destroy()
      this.#editor = null
      this.#syncEditorControls()
      this.#editorHost.className = ''
      this.#collapse.update(false)
      this.#refreshClaim()
      return
    }
    const onEdit = this.#onEdit
    if (this.#editor === null) {
      this.#editorHost.className = 'term-editor'
      this.#editor = new ScratchEditor({
        host: this.#editorHost,
        initial: text,
        debounceMs: EDITOR_DEBOUNCE_MS,
        onEdit: (src) => onEdit?.(src),
        // RESOLVED HERE, NOT AT CONSTRUCTION — the binding this pane shows now is the buffer
        // the editor being built belongs to.
        document: this.#lspDocument?.(),
        colour: this.#colour?.(),
        keymap: this.#keymap,
      })
      this.#collapse.update(true, collapsed)
      this.#refreshClaim()
      this.#syncEditorControls()
      return
    }
    this.#editor.setText(text)
  }

  /**
   * Keep the controls that need an editor in step with whether this view has one.
   *
   * **CALLED FROM EVERY SITE THAT ASSIGNS `#editor`, WHICH IS WHY IT IS A METHOD AND NOT A BOOLEAN
   * PASSED AROUND.** There are four: the mount, the unmount, `takeEditor` and `receiveEditor`. A
   * control offered on a view with no editor would do nothing when clicked.
   */
  #syncEditorControls(): void {
    this.#menu.setFormattable(this.#editor !== null)
  }

  /**
   * Detach this pane's mounted editor WITHOUT DESTROYING IT, for a caller about to remount it on a
   * different pane — the editor-moves rule's other half of `receiveEditor`, and together the two are
   * what `editor-custody.ts`'s `reconcileEditors` uses to answer the "move the editor here" control. `null` if
   * this pane holds none, so a caller can call this on every lambda pane and only act on the one that
   * says yes.
   *
   * LEAVES `#detached` UNTOUCHED. This pane may still be bound to the scratch session that just lost
   * its editor — the binding did not change, only which pane renders the editor for it — so the fork
   * control's own refusal (`#refreshDetach`'s `!this.#detached`) must not flip, and `#refreshClaim`
   * below is what re-offers "move the editor here" here the instant this method makes `#editor === null`
   * true while `#detached` is still true.
   */
  takeEditor(): ScratchEditor | null {
    const editor = this.#editor
    if (editor === null) return null
    this.#editor = null
    this.#syncEditorControls()
    // **THE NODE LEAVES TOO, AND FOR TWO CALLERS IT NEVER USED TO HAVE TO — found by driving the app in
    // a browser, which is the only thing that could have found it.** This method dropped the reference
    // and stripped the host's class and left `editor.dom` parented where it was, because both original
    // callers made that invisible: `applyLayout`'s drop loop takes the whole host out of the document
    // with the pane, and `reconcileEditors`' sweep hands the view straight to `receiveEditor`, whose
    // `append` RELOCATES the node. The `rebind` handover in `pane-host.ts` is the first caller where the
    // pane SURVIVES and nothing re-parents — and without this line the view stayed mounted, visible and
    // `contenteditable`, in a pane now bound to a different buffer, with only the `.term-editor` class
    // gone. Measured in Chromium: 458x44 px, showing the OLD buffer's term, accepting keystrokes.
    //
    // WORSE THAN COSMETIC, WHICH IS WHY IT IS A `remove()` AND NOT A `display: none`. The view keeps the
    // `onEdit` it was constructed with, so a keystroke in that stray editor still reached
    // `ScratchBuffers.recompile` — the parse error from a half-edited term was painted as a diagnostic
    // on a DIFFERENT pane's editor, one buffer over. That is the same class of defect the handover
    // exists to prevent, reintroduced by the handover itself.
    //
    // SAFE FOR THE OTHER TWO CALLERS AND FOR CODEMIRROR. Removing a node then appending it elsewhere is
    // what `receiveEditor` already does in one step (its doc: "appending an already-mounted node
    // relocates it"), and a view whose `dom` is out of the document is the state custody already puts
    // every closed pane's editor in. `destroy()` is the only thing that ends a view, and this is not it.
    editor.dom.remove()
    this.#editorHost.className = ''
    this.#collapse.update(false)
    this.#refreshClaim()
    return editor
  }

  /**
   * Mount an editor this pane did not build — `takeEditor`'s other half, and what makes "the editor
   * moves" true rather than "a new one seeded with the same text appears here". `editor.dom` is
   * CodeMirror's own node (`ScratchEditor.dom`'s doc); appending an already-mounted node relocates it
   * rather than duplicating it, so the SAME `EditorView` — cursor, selection and undo history included —
   * is what ends up inside this pane's host.
   *
   * **IT THROWS ON A PANE THAT ALREADY HOLDS ONE, AND THE UNCONDITIONAL OVERWRITE IT REPLACES IS HALF
   * OF AN IMPORTANT FINDING (re-review of the whole-branch review's own custody fix).** Assigning
   * `#editor` over a live value dropped the only reference to the previous view WITHOUT removing its
   * node: the pane went on rendering two `.cm-editor`s stacked in one host, `#editor` named whichever
   * arrived last, and the other was unreachable for `setEditor`, `takeEditor` and `destroy` alike —
   * design §4.3's "two uncoordinated CodeMirror instances over one buffer", reached by the very
   * mechanism §4.3 introduces to make it impossible. `editor-custody.ts`'s `reconcileEditors` is what must never
   * ask for that; this is the check that the invariant is a fact rather than an argument.
   *
   * **AND IT ASKED FOR IT AGAIN, ONE ROUND LATER — WHICH IS WHY THIS PARAGRAPH NO LONGER CLAIMS IT
   * "CANNOT".** That sentence read "and it no longer can (see its doc for the root fix)". A third review
   * round then reached this throw in six clicks (*edit a copy*, `close`, *reset preset*, type in the
   * source, *edit a copy* again, split), because the root fix's sweep ran over the CLAIM map while the entry that
   * outlived its session sat in the CUSTODY map with no claim naming it — see `reconcileEditors`' own
   * doc for the interaction. The fix is there, in the caller's domains, and it is a better fix than a
   * promise here would have been: **this throw is not a backstop for an argument, it is the only reason
   * either round's defect announced itself at all.** A method that cannot state an invariant about its
   * callers should not try to; it should refuse, loudly, and let the caller be the thing that is
   * corrected. THROWING RATHER THAN QUIETLY DESTROYING THE INCUMBENT:
   * a silent repair would have absorbed the finding as normal operation, and the choice between the two
   * editors — which text, whose cursor, whose undo — is not one this class has any basis to make.
   * `PaneCollection.add` and `SessionRegistry.add` refuse a duplicate id in exactly the same words for
   * exactly the same reason.
   *
   * **`collapsed` SEEDS THIS MOUNT TOO, AND UNTIL THIS FIX IT DID NOT — Important finding, review of
   * 5d-ii-d T9.** This is the OTHER mount — the one custody's own sweep and custody passes use
   * (`editor-custody.ts`'s `reconcileEditors`), not the one a fresh build takes — and it was seeded
   * nowhere: the host's class was written unconditionally and `#collapse.update(true)` ran with
   * `initial` defaulting to `false`, so a collapsed buffer claimed
   * onto another pane, or re-claimed out of custody after its holder closed, remounted EXPANDED. Nothing
   * in either sweep pass calls `on.collapse`, so `redextape.buffers` went on reading the buffer as
   * collapsed while the screen showed otherwise, and the next reload silently collapsed what the user had
   * just expanded by moving it. `editor-custody.ts`'s two `receiveEditor` call sites now read the
   * buffer's own flag through the `collapsedOf` reader threaded into `createEditorCustody` for exactly
   * this call, the same way `replies.ts`'s `scratch-compiled` arm already does for `setEditor`.
   */
  receiveEditor(editor: ScratchEditor, collapsed = false): void {
    if (this.#editor !== null) throw new Error('a λ pane was handed a second editor while still holding one')
    this.#editorHost.className = 'term-editor'
    this.#editorHost.append(editor.dom)
    // **THE EDITS FOLLOW THE VIEW, AND THIS LINE IS WHY — found by driving the app, not by the suite.**
    // A `ScratchEditor` is built by the pane that FORKS (`setEditor`'s mount branch), closing over THAT
    // pane's `editScratch`; moving `editor.dom` here does not move the callback. So a claimed editor
    // went on reporting through the pane that made it, and `transport.ts` resolves
    // `slot.binding.session` at edit time — meaning the instant that pane was rebound elsewhere,
    // keystrokes in the moved editor recompiled whatever IT was showing. `ScratchEditor.onEdit`'s own doc
    // carries the measurement. `this.#onEdit` may be `undefined` on a pane built without the handler,
    // which is the same "an edit that goes nowhere is invisible" split `#onEdit` already documents — and
    // is why this assigns the same wrapper `setEditor` does rather than the field itself.
    const onEdit = this.#onEdit
    editor.onEdit = (src) => onEdit?.(src)
    this.#editor = editor
    this.#syncEditorControls()
    this.#collapse.update(true, collapsed)
    this.#refreshClaim()
  }

  /**
   * Whether this pane is currently showing an editor.
   *
   * `takeEditor`'s QUESTION WITHOUT `takeEditor`'s ANSWER — that method reports the same fact by handing
   * the editor over, which is exactly what a caller only asking cannot afford. `editor-custody.ts`'s
   * `hasEditor` is the caller: it resolves a session's home pane and needs to know whether that pane is
   * holding anything, and a `takeEditor()` there would unmount the editor to find out.
   */
  holdsEditor(): boolean {
    return this.#editor !== null
  }

  /**
   * Report whether this pane's session has an editor anywhere — see `#editorAvailable` for why this is a
   * third input rather than something this class could work out for itself.
   *
   * THE NO-OP GUARD IS THE SAME ONE EVERY PER-FRAME SETTER IN THIS FILE STATES, and here it also keeps
   * `#refreshClaim` — and so `ViewMenu.setClaim`'s DOM write — off the hot path on the frames
   * where nothing moved, which is most of them during playback.
   */
  setEditorAvailable(available: boolean): void {
    if (available === this.#editorAvailable) return
    this.#editorAvailable = available
    this.#refreshClaim()
  }

  /**
   * Offer `options` in the pane selector and show `current` as the pair in force.
   *
   * A PUSH FROM THE SLOT RATHER THAN A PULL FROM A REGISTRY, which is what keeps design §3.2b's
   * "neither pane knows what it is bound to" true of the pane's TYPE while making it false of its
   * chrome. This pane still renders `(frame, controls) -> DOM`; what it gained is a control it reports
   * a click from (`PaneEvents.rebind`) and a list it displays. It does not resolve a binding, hold a
   * `Binding` of its own, or know that a registry exists — `PaneSlot.render` in `sessions.ts` is the
   * one place those live.
   *
   * `Binding<Leg>` RATHER THAN `Binding<'lambda'>`, THOUGH THIS IS THE λ PANE. The list is pairs for
   * BOTH legs now (`SessionRegistry.pairs()`), so the pair in force has to be spelled in the same
   * vocabulary the list is — a `Binding<'lambda'>` here would say the current pair can only ever name
   * this pane's own leg, which is the claim the widened control exists to stop making. The pane's
   * frame type is what pins its renderer; this parameter pins nothing.
   *
   * NOT A PURE SETTER. The selector is chrome on the `<h2>`'s row and is unaffected by which text the body
   * is showing, but a binding to another session is another term, so that change also starts the folds
   * over and has the body follow the new term's redex.
   */
  setBindings(options: PaneOption[], current: Binding<Leg>): void {
    this.#header.setBindings(options, current)
    // A NEW BINDING IS A DIFFERENT TERM. Folds are keyed by path, and a path in one session's term names
    // nothing in another's — the prototype carried a copy's folds home onto the program's tree. Called
    // every frame, so it acts only when the binding actually changed.
    if (current.session !== this.#bound) {
      this.#bound = current.session
      this.#folds.reset()
      this.#laidOut = null
      this.#body.attach()
    }
  }

  /**
   * The build this view's trees come from (`LambdaTrees.buildOf`). A new build is a new program behind the
   * same session, so `setBindings` sees nothing change — and a path in the old program's term names nothing
   * in the new one's, so the folds start over (spec §5.2's "and so does a new compile"). Called every
   * frame, before `renderTree`; it acts only when the build changed.
   */
  setBuild(build: number | null): void {
    if (build === this.#build) return
    this.#build = build
    this.#folds.reset()
    this.#laidOut = null
  }

  /**
   * Which layout gestures this pane currently offers, and what a split may create.
   *
   * DRIVEN FROM `main.ts`'s DRAW PASS, not from the pane, because every answer is a fact about
   * something the pane does not hold — whether this is the last leaf, whether this pane's kind may be
   * duplicated, and which `(leg, session)` pairs exist to create. Same division as `setBindings`, which
   * takes the options rather than computing them.
   *
   * `choices` IS STORED AND NOT PASSED ON, because `viewMenu` reads it through the thunk this
   * pane gave it at construction — see `#choices`, and `PaneView.setLayoutControls` for why the list
   * arrives here rather than through a setter of its own.
   */
  setLayoutControls(canClose: boolean, canSplit: boolean, choices: SplitChoices): void {
    this.#choices = choices
    this.#menu.setLayout(canClose, canSplit)
  }

  /**
   * Show or hide the `copy · not linked` status — design §4.5's second surface, paired with the sentence
   * `link-status.ts` puts in `#link-status`.
   *
   * `setDetached`, NOT `renderDetached`, THOUGH §4.5 CALLS IT "analogous to `renderLink`" (the link
   * window's setter, which Plan 7 part 4a folded into `renderTree`). The analogy is about the shape of
   * the call, not about what it does: a `render*` name here would suggest this participates in the
   * body's redraw. It does not touch `#redraw` at all — the badge is
   * chrome, it lives on the `<h2>`, and it is unaffected by which text the body is showing. `TmPane`
   * spells its chrome-and-highlight setters `setLink`/`setFocus`/`setProgram` for the same reason,
   * and this pane's counterpart is named to match across the two.
   *
   * A PURE SETTER, LIKE `TmPane.setFocus` AND UNLIKE `renderTree`: nothing here needs a redraw,
   * because the view header repaints its heading itself and the body is the caller's separate
   * decision — a detached λ pane shows its scratch's own term, which arrives through `render` like
   * any other frame.
   *
   * DEFAULTS TO ATTACHED AND IS NOW DRIVEN EVERY FRAME. It was "never called today" when the badge
   * landed, because no pane had a binding to report (§3.2b); `PaneSlot.render` calls it with
   * `SessionEntry.detached` for whichever session the slot is bound to, so the badge follows a rebind
   * without a second fact to keep in step. The default still matters: a pane that has never been
   * rendered shows no badge.
   *
   * **AN EDITOR CANNOT OUTLIVE `#detached`, AND THIS IS WHERE THAT IS ENFORCED — IMPORTANT finding,
   * whole-branch review before merge.** `setEditor` used to be reachable from exactly two places in
   * `main.ts` (the scratch's first build, and recompile-from-source's retire), and this method — the
   * one `PaneSlot.render` actually calls every frame — was not one of them. So the THIRD way a pane
   * stops being detached, the binding selector, unmounted nothing: picking `source` in a forked λ
   * pane's selector dropped the `[detached]` badge and repainted `#text` from the newly-bound leg, but
   * left `#editor` mounted on the scratch it had just left — a text input whose keystrokes reached a
   * session no longer on screen, which is exactly `pane-chrome.ts`'s "a control that provably cannot
   * work should not be presented as though it might" turned inside out (the control LOOKED live and
   * quietly wasn't). Rather than add a third external call site `main.ts` would have to remember at
   * every future exit — the fix the review rejected — the invariant lives here instead: an editor can
   * only be showing while its pane is detached, so the one setter that reports `#detached` is the one
   * place that tears it down, and no future way of leaving `#detached` needs its own reminder.
   *
   * GUARDED ON `#editor !== null` RATHER THAN CALLING `setEditor(null)` UNCONDITIONALLY, for the
   * no-op-cost reason every control in this file and `pane-chrome.ts` states: an ATTACHED pane is the
   * common case and is repainted every recorded frame during playback, so an unguarded call would pay
   * `setEditor`'s own work — a destroy check, a class assignment, a text-panel update — sixty
   * times a second for a pane that has never been forked at all.
   *
   * WHAT THIS DOES NOT COVER: a scratch whose WORKER DIES without the pane ever leaving it. Its
   * registry entry keeps `detached: true` (nothing here retires it — only `ScratchBuffers.retire`
   * does, and a dead worker is not that), so this method's own input never changes and this branch
   * never fires. `main.ts`'s `worker-error` arm for a scratch calls `setEditor(null)` directly for
   * exactly that reason — see its own comment there.
   */
  setDetached(detached: boolean): void {
    this.#detached = detached
    this.#header.setDetached(detached)
    if (!detached && this.#editor !== null) this.setEditor(null)
    this.#refreshDetach()
    // `setEditor(null)` ABOVE ALREADY CALLS `#refreshClaim` WHEN IT FIRES, but that branch is
    // conditional on `#editor !== null` and this call is not: a pane freshly bound to a scratch (still
    // `#editor === null`, never having held one) needs "move the editor here" offered the first time
    // `#detached` turns true, which is a transition `setEditor(null)` never sees because there was
    // never an editor here to unmount.
    this.#refreshClaim()
  }

  /** Spec §8's `steps` switch, per `PaneView.setStepsShown` — the view's header owns the slot. */
  setStepsShown(shown: boolean): void {
    this.#header.setStepsShown(shown)
  }

  /**
   * Offer "move the editor here" exactly when this pane's session has one to show and this pane is not
   * already showing it — wave 3 (5d-ii-a)'s editor-moves rule.
   *
   * THE SAME "PAIR OF INPUTS ARRIVE THROUGH TWO DIFFERENT CALLS" SHAPE AS `#refreshDetach`: `#detached`
   * moves through `setDetached`, `#editor` through `setEditor`/`takeEditor`/`receiveEditor`, and
   * whichever arrives second has to see the first — so this is called from all four.
   *
   * **THERE ARE THREE INPUTS NOW, AND THE THIRD IS THE ONLY ONE THAT IS NOT ABOUT THIS PANE** —
   * `#editorAvailable`, arriving through `setEditorAvailable` on the per-frame path, with the whole
   * argument for its existence on the field's own doc. The first two say "I am on a scratch and I am not
   * the one showing its editor"; without the third that sentence quietly assumes the editor exists.
   */
  #refreshClaim(): void {
    this.#menu.setClaim(this.#detached && this.#editor === null && this.#editorAvailable)
  }

  /**
   * Offer the fork control exactly when a fork would work.
   *
   * `frame.cut` NO LONGER GATES THIS, AND THAT REVERSES WHAT THIS METHOD USED TO CHECK — found and
   * fixed in T8 (plan 5d-iii), because the check it replaces silently disabled this whole slice's
   * headline capability. `detachButton`'s doc used to say a TRUNCATED frame "cannot be forked at
   * all" — true while the seed WAS the frame's own 512-byte print (`FRAME_BYTES`, "most non-trivial
   * terms WILL truncate here", this file's own module doc), so a `Bytes` cut was a prefix that would
   * not parse and a `Depth` cut was not even that. Design §4.1 replaced that seed: `detach` now sends
   * a STEP, and `main.ts` re-derives the term from the SOURCE compile's step-0 print at
   * `LAMBDA_BYTE_BUDGET` (65,536 — 128× `FRAME_BYTES`), which this frame's own 512-byte truncation
   * says nothing about. §4.1a states the consequence outright: "a term can still be too large to
   * fork, and the refusal moved rather than vanished... the worker answers `scratch: null` with a
   * diagnostic saying so, and **the pane keeps offering ✎**" — checking `frame.cut` here was
   * therefore refusing a control that provably CAN work, which is the opposite of what §4.5's own
   * standard asks for. The one refusal that survives is a source step-0 term that is ITSELF cut at
   * `LAMBDA_BYTE_BUDGET`; that cannot be seen from a `LambdaState` frame at all (a different budget,
   * a different print), so it is reported after the click — **not by routing a diagnostic into this
   * pane's own editor, which this paragraph used to claim and which was found wrong in code review
   * against a real worker.** The refusal this method exists to keep offering a fork for is exactly the
   * refusal that never mounts an editor at all: a failed build never reaches `scratch-compiled`, so
   * `setEditor` is never called and `#editor` stays `null` — `setDiagnostics`'s own doc already says
   * that call is a no-op with no editor mounted, which is what a diagnostic routed there would have
   * silently hit. `onScratchReply`'s `no-session` arm puts the diagnostic in a notice
   * (`notice.ts`'s `createNotices`) instead, which is a surface this pane does not have to be able to
   * show anything for.
   *
   * **AND THE CONTROL DOES NOT COME BACK AFTERWARDS, WHICH THIS PARAGRAPH USED TO PROMISE.** It said
   * the arm "asks `ScratchBuffers.noSessionReply` (`scratch.ts`) to retire the failed attempt — which is
   * what actually keeps this control offered, by putting `#detached` back to `false` rather than by
   * anything in this method". 5d-ii-c decision 2 deleted that retire: nothing ends a buffer implicitly,
   * so a pane whose fork failed stays bound to the buffer that failed, `#detached` stays `true`, and the
   * gate below withholds ✎ — correctly, since that buffer has no term to fork. §4.1a's "the pane keeps
   * offering ✎" is therefore unmet at this pane, and design §4.4 relocates the way out to the header
   * list, which can reach a buffer no pane is showing and is wired in `main.ts`. Retiring that buffer
   * rebinds this pane to source, which is what makes `#detached` false again and this control offered
   * again — through the binding, exactly as the deleted retire did, and never through this method.
   * Nothing in this method changes either way.
   *
   * WHAT STILL GATES IT: a detached pane is already on the scratchpad and has nothing to fork, and an
   * absent frame — `render(null, …)`, what a declined or not-yet-compiled leg produces — has no term
   * at all to report a step against. Reading `ControlState` for the second of those would be a second
   * source for the same fact.
   *
   * **THE LINK WINDOW'S REFUSAL WENT WITH THE WINDOW (Plan 7 part 4a).** This also withheld the
   * control while the step-0 link window was showing, since that body was not the step's term. The view
   * now shows only its own step, as a tree or as text, so there is nothing left for that rule to refuse.
   */
  #refreshDetach(): void {
    this.#menu.setCopy(!this.#detached && this.#frame !== null ? 'ready' : null)
  }

  /**
   * Draw what `#treeFor` holds: the tree, or the frame's text when there is none to draw.
   *
   * **FAIL SAFE: EACH FAILURE LEAVES A WORKING VIEW AND ONE NOTE (spec §10).** A tree whose drawing throws is
   * shown as the frame's text with a note saying so, like a refused one, and is remembered in `#unlaid` so no
   * later frame tries it again; the error goes to the console, once. Nothing thrown here reaches `draw()`, whose
   * loop draws every other view.
   */
  #redraw(): void {
    const t = this.#treeFor
    const tree = t.kind === 'tree' || t.kind === 'stale' ? this.#treeOf(t.tree) : null
    if (tree !== null && tree !== this.#unlaid) {
      try {
        this.#drawTree(tree, t.kind === 'stale')
        return
      } catch (e) {
        // LOGGED, NOT SWALLOWED: the layouts cannot overflow, so whatever reaches here is a bug. Once per tree,
        // since `#unlaid` keeps it from being tried again. `console.error`, not `reportError`, which would
        // raise it as uncaught — the very thing this catch exists to stop.
        console.error('the λ view could not draw this step’s tree, and shows it as text instead', e)
        this.#unlaid = tree
        this.#laidOut = null
      }
    }
    const note =
      t.kind === 'refused'
        ? `this step’s term has ${t.nodes.toLocaleString()} nodes — shown as text`
        : tree !== null
          ? 'this step’s term could not be laid out — shown as text'
          : null
    this.#shownLines = []
    this.#body.showText(this.#frame, note)
    this.#drawMap()
  }

  /** Lay out `tree` and draw it; `stale` says it is another step's. May throw — `#redraw` catches it. */
  #drawTree(tree: Tree, stale: boolean): void {
    this.#folds.advance(tree)
    const lines = this.#lines(tree)
    const linked = this.#pin === null ? [] : tree.nodesLinkedTo(this.#pin)
    this.#shownLines = lines
    this.#body.showTree(tree, lines, this.#display.layout === 'outline', linked, stale)
    // A NEW PIN IS SCROLLED TO ONCE, and only when its first node is off screen — a click in this view
    // pins what is under the pointer, so it never moves; a source click brings the construct in.
    if (this.#pin !== this.#revealed) {
      this.#revealed = this.#pin
      const first = this.#pin === this.#pinnedHere ? undefined : linked[0]
      const at = first === undefined ? -1 : lineOf(tree, lines, first)
      const { first: top, last } = this.#body.visible
      if (at >= 0 && (at < top || at > last)) this.#body.reveal(at)
    }
    this.#drawMap()
  }
}
