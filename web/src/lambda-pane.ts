import type { ControlState } from './controls'
import { LambdaBody } from './lambda-body'
import { Folds } from './lambda-folds'
import { codeLines, type Line, lineOf, outlineLines } from './lambda-layout'
import { Tree } from './lambda-tree'
import type { TreeFor } from './lambda-trees'
import type { Dir } from './layout'
import type { LambdaLinkState } from './link-status'
import type { PaneChoice, PaneEvents, SplitChoices } from './pane-chrome'
import { createPanel, type Panel } from './panel'
import { PanelStack, type Shares } from './panel-stack'
import type { LambdaTreeWire, Leg } from './protocol'
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
export class LambdaPane {
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
   * The view's header (`view-header.ts`'s `viewHeader`): the title that is the selector, and the slot the transport
   * strip mounts in.
   */
  #header: ViewHeader
  /**
   * The view's `⋯` menu and `✕` (`view-header.ts`'s `viewMenu`): split right, split down and the display settings.
   *
   * AN ITEM IS BUILT ONLY WHEN ITS HANDLER EXISTS, rather than built always and calling `on.close?.()`.
   * That is the same standard 5d-i design §4.5 states and the `linkLambda` handler below does NOT need: a
   * click that goes nowhere is invisible, but a control that cannot work is on screen.
   */
  #menu: ViewMenu
  #frame: LambdaState | null = null
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
  /** `PaneEvents.linkLambda`: link from a construct's id. Absent, a click on the term links nothing. */
  #onLinkNode: ((node: number) => void) | undefined
  /** The construct `draw()` says is pinned, or `null` — this view marks every node that carries it. */
  #pin: number | null = null
  /** Whether `draw()` says the tree's root is the run's result (`result-mark.ts`). */
  #result = false
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
    // in a view too short for its floors the term is at its floor before, under and after the map's own maximise.
    // So the canvas's own box is watched. A draw that changes nothing is skipped by `term-map.ts`'s `TermMap.draw`, so
    // the frame of a drag that the term also reports costs one draw.
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
    this.#menu = viewMenu(this.#header.actions, {
      ...(on.splitRow !== undefined && on.splitColumn !== undefined
        ? { split: (dir: Dir, c: PaneChoice) => (dir === 'row' ? on.splitRow?.(c) : on.splitColumn?.(c)) }
        : {}),
      ...(on.close !== undefined ? { close: on.close } : {}),
      ...(on.move !== undefined ? { move: on.move } : {}),
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
        expandAll: {
          on: () => this.#folds.expandAll,
          set: (on) => {
            this.#folds.setExpandAll(on)
            this.#unlaid = null
            this.#redraw()
          },
        },
        reset: () => {
          this.#folds.reset()
          this.#unlaid = null
          this.#redraw()
        },
      },
      choices: () => this.#choices,
    })
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
    this.#header.steps.append(this.#steps.el)
    host.replaceChildren(this.#header.el, this.#body.el, this.#mapPanel.el)
    // THE REGIONS THAT SHARE THE VIEW'S HEIGHT (the view layouts spec §11.1), top to bottom. The term takes what the
    // view has spare; the term map keeps its own height until the boundary above it is dragged.
    // The term has no header: it is a region no maximise draws closed, and it keeps its floor under one.
    // IT KEEPS ITSELF: its listeners are on the regions and their headers, and nothing here reads it again.
    new PanelStack(
      [
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
   * What `draw()` knows about the tree for the displayed step (spec §4), and whether its root is the run's result.
   * Called every frame, after `render`; the layout is reused while its inputs are unchanged.
   */
  renderTree(treeFor: TreeFor, pin: number | null = null, result = false): void {
    this.#treeFor = treeFor
    this.#pin = pin
    this.#result = result
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
   * is showing, but a binding to another session is another term, so that change also starts the folds made
   * by hand over (expand all stays, `Folds.newTerm`) and has the body follow the new term's redex.
   */
  setBindings(options: PaneOption[], current: Binding<Leg>): void {
    this.#header.setBindings(options, current)
    // A NEW BINDING IS A DIFFERENT TERM. Folds are keyed by path, and a path in one session's term names
    // nothing in another's, so folds kept across a rebind would land on a tree they were not made on. Called
    // every frame, so it acts only when the binding actually changed.
    if (current.session !== this.#bound) {
      this.#bound = current.session
      this.#folds.newTerm()
      this.#laidOut = null
      this.#body.attach()
    }
  }

  /**
   * The build this view's trees come from (`LambdaTrees.buildOf`). A new build is a new program behind the
   * same session, so `setBindings` sees nothing change — and a path in the old program's term names nothing
   * in the new one's, so the folds made by hand start over (spec §5.2's "and so does a new compile"; expand all
   * stays, `Folds.newTerm`). Called every frame, before `renderTree`; it acts only when the build changed.
   */
  setBuild(build: number | null): void {
    if (build === this.#build) return
    this.#build = build
    this.#folds.newTerm()
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
  setLayoutControls(canClose: boolean, tiled: boolean, choices: SplitChoices): void {
    this.#choices = choices
    this.#menu.setLayout(canClose, tiled)
  }

  /**
   * Plan 7 part 2 spec §8's `steps` switch, per `PaneView.setStepsShown` — the view's header owns the slot.
   */
  setStepsShown(shown: boolean): void {
    this.#header.setStepsShown(shown)
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
    this.#body.showTree(tree, lines, this.#display.layout === 'outline', linked, stale, this.#result)
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
