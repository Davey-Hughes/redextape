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
import { PanelStack, type Shares } from './panel-stack'
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
 * The λ pane: the displayed step's term, laid out from the tree the worker serves for it (Plan 7 part 4
 * spec §4) — or, before that tree arrives and when it is refused, the frame's own text, syntax-coloured by
 * the same token classes the source pane uses.
 *
 * TRUNCATION IS SHOWN, NOT HIDDEN, in that flat text. A history frame's budget is 512 bytes, two orders
 * below the readout's, so most non-trivial frames WILL truncate. A BYTE cut's text is a prefix of the real
 * term; a DEPTH cut's is not — see `results.ts`'s note on the two cuts for why — but showing either beats
 * hiding it, which is why both are marked the same way (`… truncated` / `… too deep`, `lambda-body.ts`'s
 * `flatText`) rather than one being suppressed. The tree is the whole term, and `results.ts` still prints
 * the full normal form at 64 KiB.
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
   * **THE TREE IS STORED BEFORE IT IS DRAWN, SO A DRAW THAT THROWS MUST NOT LEAVE IT TO THROW AGAIN.** A tree
   * whose layout throws would stay in `#treeFor`; `render` redraws before `renderTree` can replace it, so every
   * later frame would throw inside `draw()` and the view would never draw another tree, even after a recompile.
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
   * That is the same standard 5d-i design §4.5 states and the `linkLambda` handler below does NOT need: a
   * click that goes nowhere is invisible, but a control that cannot work is on screen. A caller with no
   * `detach` — a test fixture, or any future pane that renders λ frames it does not own — gets a view with
   * no copy offered rather than one that offers a copy and swallows it.
   */
  #menu: ViewMenu
  #frame: LambdaState | null = null
  /**
   * The upper half of 5d-iii design §4.2's split body — a stable parent that outlives any editor mounted
   * or unmounted inside it, so `setEditor` can do both without touching the pane's own child order.
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
   * `setDetached` is what makes "attached" and "`#editor === null`" the same fact — see its own doc.
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
   * `on.editSink`, captured once at construction — `setEditor` calls it per mount, so each editor it builds sends
   * its edits to the copy this pane showed when it was built (`PaneEvents.editSink`). A pane built with no handler
   * mounts an editor that simply drops its edits, the same "control that cannot work is still absent, an edit that
   * goes nowhere is invisible" split `#menu`'s doc above draws.
   */
  #editSink: (() => (src: string) => void) | undefined
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
   * Whether the session this pane is bound to is outside the source correspondence — 5d-i design
   * §4.5's fact, kept because the fork control needs it and `setDetached` is not the only thing that
   * moves it.
   *
   * A FIELD RATHER THAN A READ OF THE STATUS'S OWN STATE. The fork control's availability is a
   * function of TWO inputs that arrive through two different calls — the binding (`setDetached`) and
   * the frame (`render`) — so whichever arrives second has to see the first. The view header holds an
   * equivalent boolean privately for its own no-op guard; asking it would make one widget's internal
   * state another's input.
   */
  #detached = false
  /**
   * Whether this pane's session has an editor to bring here at all — `#refreshClaim`'s THIRD input, without
   * which "move the editor here" would be a control that provably could not work (deferred-a11y item 11).
   *
   * **THE TWO INPUTS IT JOINS ONLY APPROXIMATE THIS.** `#detached && #editor === null` reads as "this session
   * has an editor, mounted elsewhere", but nothing ends a buffer implicitly, so a pane stranded on a phantom
   * fork sits with both conjuncts permanently true and no editor in existence: the control would be offered
   * forever and the click would record a claim `reconcileEditors` could find nothing for.
   *
   * **TWO ROUTES REACH THAT STATE.** A fork whose build failed is one. `replies.ts`'s `worker-error` arm calls
   * `editorHome(session)?.setEditor(null)`, which DESTROYS the editor and retires nothing, so a pane whose
   * worker died is left in exactly the same shape as one whose fork never built.
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
    opts: { readonly display?: LambdaDisplay; readonly map?: boolean; readonly sizes?: Shares } = {},
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
    // THE MAP IS DRAWN FOR THE HEIGHT ITS CANVAS HAS, AND THAT HEIGHT IS NOT THE STYLESHEET'S 120px ALONE (the
    // view layouts spec §11.1): the map has a share of its view once its boundary is dragged, and takes the view's
    // spare height while it is maximised. The term's own change of size draws it again (`scrolled`, above), which
    // covers a drag and a view that changes height. It does not cover a canvas that changes with the term as it was:
    // a maximise of another panel hides the canvas and shows it again, and in a view too short for its floors the
    // term is at its floor before, under and after. So the canvas's own box is watched. A draw that changes nothing
    // is skipped by `term-map.ts`'s `TermMap.draw`, so the frame of a drag that the term also reports costs one draw.
    // **NOT FOR A CANVAS WITH NO HEIGHT**, which is one that has left the page or been hidden: there is nothing to
    // draw it for, and `lambda-body.ts`'s own observer holds the same line for the term.
    new ResizeObserver(() => {
      if (this.#map.el.clientHeight > 0) this.#drawMap()
    }).observe(this.#map.el)
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
    // actually at, which is what 5d-iii design §4.1's replay reduces to. `#refreshDetach` does NOT check
    // the frame's cut: 5d-iii §4.1a gives that refusal to the worker, which answers a diagnostic while
    // this control stays offered.
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
    this.#editSink = on.editSink
    this.#lspDocument = on.lspDocument
    this.#colour = on.colour
    this.#keymap = on.keymap
    // FOLLOW REDEX (Plan 7 part 4 spec §5.3), ADDED AND REMOVED, NEVER DISABLED — the TM view's
    // `follow current rule`, and the umbrella's rule for a control that cannot apply: a re-attach does
    // something only while the body shows a tree it is not following, so the action exists only then, and
    // the body says when that changes.
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
      // THE BUTTON HIDES ITSELF — the paint above tells `onDetached` — AND MUST NOT TAKE THE FOCUS WITH IT.
      // A control its own click removes is the gesture case `focus-handoff.ts`'s doc sets apart from its
      // rule, so the gesture says where the focus goes: the term it acts on takes it, one tab stop with its
      // own keys.
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
    // THE REGIONS THAT SHARE THE VIEW'S HEIGHT (the view layouts spec §11.1), top to bottom. The term takes what the
    // view has spare; a copy's text and the term map keep their own heights until a boundary beside one is dragged.
    // The term has no header: it is a region no maximise draws closed, and it keeps its floor under one.
    // IT KEEPS ITSELF: its listeners are on the regions and their headers, and nothing here reads it again.
    new PanelStack(
      [
        {
          name: 'text',
          label: 'text',
          el: this.#collapse.el,
          share: null,
          panels: [this.#collapse.panel],
          bodies: () => [this.#collapse.panel.body],
        },
        { name: 'term', label: 'term', el: this.#body.el, share: 1, panels: [], bodies: () => [this.#body.el] },
        {
          name: 'map',
          label: 'term map',
          el: this.#mapPanel.el,
          share: null,
          panels: [this.#mapPanel],
          bodies: () => [mapHost],
        },
      ],
      opts.sizes ?? {},
      (next) => on.panelSizes?.(next),
    )

    // λ -> SOURCE, the third direction: a click on any token links from the construct its node belongs to
    // (`LambdaBody`'s `link` event, `#linkFrom`), at whatever step is on screen (Plan 7 part 4 spec §5.4).
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
   * Mount an editor over this pane's term seeded with `text`, or unmount it with `null` — 5d-iii design
   * §4.2's upper region.
   *
   * MOUNTED AND UNMOUNTED, NEVER HIDDEN: a hidden CodeMirror instance is a live instance with a live
   * debounce, and 5d-iii §5 asks for a test that reattaching a pane REMOVES the editor. Removal is what
   * makes that question have one answer.
   *
   * A RE-SEED WITH THE SAME TEXT IS A NO-OP INSIDE `ScratchEditor.setText`, so this is safe on the
   * per-frame path, which it sits on: `setDetached` below calls `setEditor(null)` itself whenever the
   * pane it reports for stops being detached, and `setDetached` is driven every frame by
   * `PaneSlot.render`, for a view on the page. `replies.ts` calls this method directly for the two
   * things only a caller outside this class can know — the text a freshly-built scratch replied with
   * (`scratch-compiled`) and a scratch whose worker just died with nothing left to recompile against
   * (`worker-error`). A retire's editors come down through the sweep (`editor-custody.ts`'s
   * `reconcileEditors`). No caller has to remember a matching `setEditor(null)` for every OTHER way a
   * pane can stop being detached — see `setDetached`'s own doc.
   *
   * **`collapsed` SEEDS THE MOUNT, AND ONLY THE MOUNT — 5d-ii-d design §4.7.** Every mount the app
   * makes passes the buffer's own recorded flag, which is `false` for a fresh fork (nobody has collapsed
   * a buffer that has never had an editor). The RE-SEED branch below (`this.#editor.setText(text)`)
   * ignores it, because a live editor's collapse state is the user's own click, not something a later
   * reply gets to overwrite.
   *
   * **`#editorHost.className` HAS FOUR WRITERS IN THIS FILE.** Two CLEAR it (this method's own `text === null`
   * branch, and `takeEditor`), because an unmounted host carries no class at all. The other two are MOUNT
   * sites, and both write the unconditional `'term-editor'`: this method's, and `receiveEditor`'s.
   *
   * **THE SEED DOES NOT LIVE IN THE CLASS.** The text panel hides a collapsed editor with `hidden`, so
   * `collapsed` reaches only `this.#collapse.update(true, collapsed)`, in this method and in `receiveEditor`.
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
    if (this.#editor === null) {
      this.#editorHost.className = 'term-editor'
      // RESOLVED HERE, NOT AT CONSTRUCTION — the binding this pane shows now is the buffer the editor being built
      // belongs to, for its edits as for its document.
      const sink = this.#editSink?.()
      this.#editor = new ScratchEditor({
        host: this.#editorHost,
        initial: text,
        debounceMs: EDITOR_DEBOUNCE_MS,
        onEdit: (src) => sink?.(src),
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
   * different pane — with `receiveEditor`, one half of the editor-moves rule (5d-ii-a design §4.3), and
   * together the two are what `editor-custody.ts`'s `reconcileEditors` uses to answer the "move the
   * editor here" control. `null` if this pane holds none, so a caller can call this on every lambda pane
   * and only act on the one that says yes.
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
    // **THE NODE LEAVES TOO.** For two callers its place would not matter: `applyLayout`'s drop loop takes the
    // whole host out of the document with the pane, and `reconcileEditors`' sweep hands the view straight to
    // `receiveEditor`, whose `append` RELOCATES the node. For the `rebind` handover in `pane-host.ts` the pane
    // SURVIVES and nothing re-parents — and without this line the view would stay mounted, visible and
    // `contenteditable`, in a pane now bound to a different buffer, with only the `.term-editor` class gone.
    //
    // WORSE THAN COSMETIC, WHICH IS WHY IT IS A `remove()` AND NOT A `display: none`. The view keeps the
    // `onEdit` it was constructed with, so a keystroke in that stray editor would still reach
    // `ScratchBuffers.recompile` — the parse error from a half-edited term would be painted as a diagnostic
    // on a DIFFERENT pane's editor, one buffer over. That would be the same class of defect the handover
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
   * **IT THROWS ON A PANE THAT ALREADY HOLDS ONE.** Assigning `#editor` over a live value would drop the
   * only reference to the previous view WITHOUT removing its node: the pane would go on rendering two
   * `.cm-editor`s stacked in one host, `#editor` would name whichever arrived last, and the other would be
   * unreachable for `setEditor`, `takeEditor` and `destroy` alike — 5d-ii-a design §4.3's "two
   * uncoordinated CodeMirror instances over one buffer", reached by the very mechanism 5d-ii-a §4.3
   * introduces to make it impossible. `editor-custody.ts`'s `reconcileEditors` is what must never ask for
   * that; this is the check that the invariant is a fact rather than an argument.
   *
   * A method that cannot state an invariant about its callers should not try to; it should refuse, loudly,
   * and let the caller be the thing that is corrected. THROWING RATHER THAN QUIETLY DESTROYING THE
   * INCUMBENT: a silent repair would absorb a caller's defect as normal operation, and the choice between
   * the two editors — which text, whose cursor, whose undo — is not one this class has any basis to make.
   * `SessionRegistry.add` refuses a duplicate id for the same reason, and `PaneCollection.add` for the
   * stranding one above: an overwritten pane would leave its DOM subtree unreachable.
   *
   * **`collapsed` SEEDS THIS MOUNT TOO.** This is the OTHER mount — the one custody's own sweep and custody
   * passes use (`editor-custody.ts`'s `reconcileEditors`), not the one a fresh build takes. Unseeded, a
   * collapsed buffer claimed onto another pane, or re-claimed out of custody after its holder closed, would
   * remount EXPANDED; nothing in either sweep pass calls `on.collapse`, so `redextape.buffers` would go on
   * reading the buffer as collapsed while the screen showed otherwise, and the next reload would silently
   * collapse what the user had just expanded by moving it. `editor-custody.ts`'s two `receiveEditor` call
   * sites read the buffer's own flag through the `collapsedOf` reader threaded into `createEditorCustody`
   * for this call, the same way `replies.ts`'s `scratch-compiled` arm does for `setEditor`.
   */
  receiveEditor(editor: ScratchEditor, collapsed = false): void {
    if (this.#editor !== null) throw new Error('a λ pane was handed a second editor while still holding one')
    this.#editorHost.className = 'term-editor'
    this.#editorHost.append(editor.dom)
    // **THE EDITS STAY WITH THE COPY, AND NOTHING HERE TOUCHES THEM.** The editor's sink is bound to its copy
    // when it is built (`PaneEvents.editSink`), and this pane shows that same copy, so there is nothing to
    // re-point. A handler that read the building pane's binding when an edit fired would send keystrokes in
    // the moved editor to whatever that pane shows once it is rebound elsewhere.
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

  /** Send the mounted editor's pending edit now — `EditablePane.flushEditor`, for `EditorCustody.flush`. */
  flushEditor(): void {
    this.#editor?.flush()
  }

  /**
   * Report whether this pane's session has an editor anywhere — see `#editorAvailable` for why this is a
   * third input rather than something this class could work out for itself.
   *
   * THE NO-OP GUARD KEEPS `#refreshClaim` — and so `ViewMenu.setClaim`'s DOM write — off the hot path
   * on the frames where nothing moved, which is most of them during playback.
   */
  setEditorAvailable(available: boolean): void {
    if (available === this.#editorAvailable) return
    this.#editorAvailable = available
    this.#refreshClaim()
  }

  /**
   * Offer `options` in the pane selector and show `current` as the pair in force.
   *
   * A PUSH FROM THE SLOT RATHER THAN A PULL FROM A REGISTRY, which is what keeps 5d-i design §3.2b's
   * "neither pane knows what it is bound to" true of the pane's TYPE while making it false of its
   * chrome. This pane renders `(frame, controls) -> DOM`; beside that it has a control it reports
   * a click from (`PaneEvents.rebind`) and a list it displays. It does not resolve a binding, hold a
   * `Binding` of its own, or know that a registry exists — `PaneSlot.render` in `sessions.ts` is the
   * one place those live.
   *
   * `Binding<Leg>` RATHER THAN `Binding<'lambda'>`, THOUGH THIS IS THE λ PANE. The list is pairs for
   * EVERY leg (`SessionRegistry.pairs()`), so the pair in force has to be spelled in the same
   * vocabulary the list is — a `Binding<'lambda'>` here would say the current pair can only ever name
   * this pane's own leg, which is a claim a control listing every leg must not make. The pane's
   * frame type is what pins its renderer; this parameter pins nothing.
   *
   * NOT A PURE SETTER. The selector is chrome on the `<h2>`'s row and is unaffected by which text the body
   * is showing, but a binding to another session is another term, so that change also starts the folds
   * over and has the body follow the new term's redex.
   */
  setBindings(options: PaneOption[], current: Binding<Leg>): void {
    this.#header.setBindings(options, current)
    // A NEW BINDING IS A DIFFERENT TERM. Folds are keyed by path, and a path in one session's term names
    // nothing in another's, so a copy's folds kept across a rebind would land on the program's tree. Called
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
   * DRIVEN FROM THE DRAW PASS (`draw.ts`'s `createDraw`), not from the pane, because every answer is a
   * fact about something the pane does not hold — whether this is the last leaf, whether this pane's
   * kind may be duplicated, and which `(leg, session)` pairs exist to create. Same division as
   * `setBindings`, which takes the options rather than computing them.
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
   * Show or hide the `copy · not linked` status — 5d-i design §4.5's second surface, paired with the
   * sentence `link-status.ts` puts in `#link-status`.
   *
   * `setDetached`, NOT `renderDetached`, THOUGH §4.5 CALLS IT "analogous to `renderLink`" (the link
   * window's setter, which this pane does not have). The analogy is about the shape of the call, not
   * about what it does: a `render*` name here would suggest this participates in the body's redraw. It
   * does not touch `#redraw` at all — the status is chrome, it lives on the `<h2>`, and it is unaffected
   * by which text the body is showing. `TmPane` spells its chrome-and-highlight setters
   * `setLink`/`setFocus`/`setProgram`, and this pane's counterpart is named to match across the two.
   *
   * A PURE SETTER, LIKE `TmPane.setFocus` AND UNLIKE `renderTree`: nothing here needs a redraw,
   * because the view header repaints its heading itself and the body is the caller's separate
   * decision — a detached λ pane shows its scratch's own term, which arrives through `render` like
   * any other frame.
   *
   * DEFAULTS TO ATTACHED AND IS DRIVEN EVERY FRAME. `PaneSlot.render` calls it with
   * `SessionEntry.detached` for whichever session the slot is bound to, so the status follows a rebind
   * without a second fact to keep in step. The default matters: a pane that has never been rendered
   * shows no status.
   *
   * **AN EDITOR CANNOT OUTLIVE `#detached`, AND THIS IS WHERE THAT IS ENFORCED.** An editor can only be
   * showing while its pane is detached, so the one setter that reports `#detached` is the one place
   * that tears it down, and no future way of leaving `#detached` needs its own reminder. A teardown
   * left to callers would need a call at every exit: a pause or a delete that moves a view onto the
   * program would drop the `copy · not linked` status but leave `#editor` mounted on the copy it had
   * just left — a text input whose keystrokes reach a session no longer on screen.
   *
   * **A VIEW THAT IS NOT ON THE PAGE IS TOLD SEPARATELY.** `PaneSlot.render` calls this every frame for
   * a view that is drawn, and `draw()` passes over a Stage tab that is not selected and a view a switch
   * parked. One that a pause or a delete moves onto the program would be told nothing, and would go on
   * holding the editor of a copy it no longer shows, so `pane-host.ts`'s `reseedingSlots` calls this as
   * it moves such a view (the view layouts spec §5.5).
   *
   * GUARDED ON `#editor !== null` RATHER THAN CALLING `setEditor(null)` UNCONDITIONALLY: an ATTACHED
   * pane is the common case and is repainted every recorded frame during playback, so an unguarded call
   * would pay `setEditor`'s own work — a destroy check, a class assignment, a text-panel update — on
   * every frame for a pane that has never been forked at all.
   *
   * WHAT THIS DOES NOT COVER: a scratch whose WORKER DIES without the pane ever leaving it. Its
   * registry entry keeps `detached: true` (nothing here removes it — only `ScratchBuffers.cool`
   * does, `retire` through it, and a dead worker is neither), so this method's own input never
   * changes and this branch never fires. `replies.ts`'s `worker-error` arm for a scratch calls
   * `setEditor(null)` directly for exactly that reason — see its own comment there.
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

  /**
   * Plan 7 part 2 spec §8's `steps` switch, per `PaneView.setStepsShown` — the view's header owns the slot.
   */
  setStepsShown(shown: boolean): void {
    this.#header.setStepsShown(shown)
  }

  /**
   * Offer "move the editor here" exactly when this pane's session has one to show and this pane is not
   * already showing it — the editor-moves rule (5d-ii-a design §4.3).
   *
   * THE SAME "PAIR OF INPUTS ARRIVE THROUGH TWO DIFFERENT CALLS" SHAPE AS `#refreshDetach`: `#detached`
   * moves through `setDetached`, `#editor` through `setEditor`/`takeEditor`/`receiveEditor`, and
   * whichever arrives second has to see the first — so this is called from all four.
   *
   * **THERE ARE THREE INPUTS, AND THE THIRD IS THE ONLY ONE THAT IS NOT ABOUT THIS PANE** —
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
   * `frame.cut` DOES NOT GATE THIS. Under 5d-iii design §4.1, `detach` sends a STEP, and the term is
   * re-derived from the SOURCE compile's step-0 print at `LAMBDA_BYTE_BUDGET` (65,536 — 128×
   * `FRAME_BYTES`), which this frame's own 512-byte truncation says nothing about. 5d-iii §4.1a states
   * the consequence outright: "a term can still be too large to fork, and the refusal moved rather than
   * vanished... the worker answers `scratch: null` with a diagnostic saying so, and
   * **the pane keeps offering ✎**" — checking `frame.cut` here would refuse a control that provably CAN
   * work, which is the opposite of what 5d-i design §4.5's own standard asks for. The one refusal left
   * is a source step-0 term that is ITSELF cut at `LAMBDA_BYTE_BUDGET`; that cannot be seen from a
   * `LambdaState` frame at all (a different budget, a different print), so it is reported after the
   * click. A failed build never reaches `scratch-compiled`, so `setEditor` is never called and `#editor`
   * stays `null`; `onScratchReply`'s `no-session` arm puts the diagnostic in a notice (`notice.ts`'s
   * `createNotices`), which is a surface this pane does not have to be able to show anything for.
   *
   * THE CONTROL DOES NOT COME BACK AFTERWARDS. Nothing ends a buffer implicitly, so a pane whose fork
   * failed stays bound to the buffer that failed, `#detached` stays `true`, and the gate below withholds
   * ✎ — correctly, since that buffer has no term to fork. 5d-iii §4.1a's "the pane keeps offering ✎" is
   * therefore unmet at this pane, and 5d-ii-c design §4.4 relocates the way out to the header list,
   * which can reach a buffer no pane is showing and is wired in `main.ts`. Retiring that buffer rebinds
   * this pane to source, which is what makes `#detached` false again and this control offered again —
   * through the binding, never through this method.
   *
   * WHAT GATES IT: a detached pane is already on the scratchpad and has nothing to fork, and an absent
   * frame — `render(null, …)`, what a declined or not-yet-compiled leg produces — has no term at all to
   * report a step against. Reading `ControlState` for the second of those would be a second source for
   * the same fact.
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
