import { CopyEditor } from './copy-editor'
import type { EditablePane } from './editor-custody'
import type { Dir } from './layout'
import type { PaneChoice, PaneEvents, SplitChoices } from './pane-chrome'
import type { StackRegion } from './panel-stack'
import type { Leg } from './protocol'
import type { ScratchEditor } from './scratch-editor'
import type { Binding, PaneOption } from './sessions'
import { stepControls } from './step-controls'
import { type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'

/** What a machine view tells the chrome it shares. */
export type MachineViewOptions = {
  /** What *edit a copy* says it copies: "the whole machine". */
  readonly what: string
  /** What the view's program counts, in the plural — `CopyEditorOptions.noun`. */
  readonly noun: string
  /** Whether the outline starts open — the view's stored panel state, read once. */
  readonly outlineOpen: boolean
}

/**
 * The chrome the TM view and the rxm view share: the header, the step strip, the `⋯` menu, the copy's editor, and the
 * members that hand off to them. A view builds its panels after `super()` and hands its body to `mount`.
 *
 * **THE CONSTRUCTOR CALLS NOTHING A VIEW OVERRIDES.** A subclass's private fields do not exist until `super()` returns,
 * so an override reached from here would throw on its first read of one. `editorUnmounted` is only handed over, in a
 * closure no unmount can call before the view is built.
 */
export abstract class MachineViewChrome implements EditablePane {
  /** The view's header — `LambdaPane`'s `#header`, the same component. */
  protected readonly header: ViewHeader
  protected readonly steps: ReturnType<typeof stepControls>
  /**
   * The view's `⋯` menu and `✕` — `LambdaPane.#menu`'s twin. `edit a copy` is **BUILT ONLY WHEN THE
   * HANDLER EXISTS**, for that field's own reason: a caller with no `detachProgram` gets a view with no
   * copy offered rather than one that offers a copy and swallows it. *Move the editor here* likewise, for
   * `PaneEvents.showEditor`. `copy` keeps *format*, *edit a copy* and *move the editor here* in step.
   */
  protected readonly menu: ViewMenu
  /**
   * A copy's editor, its text panel and outline, and the facts behind *format* and *edit a copy* — the part the two
   * views share (`copy-editor.ts`), whose comments carry the reasons behind the handoff.
   */
  protected readonly copy: CopyEditor
  /**
   * What this pane's split menus offer — `LambdaPane.#choices`'s twin. `SplitChoices`'s doc carries the
   * argument for the starting value, and `LambdaPane.#choices`'s the one for reading it through a thunk
   * rather than handing a list over once.
   */
  #choices: SplitChoices = { options: [], sourceAvailable: false, current: null }

  constructor(on: PaneEvents, opts: MachineViewOptions) {
    this.header = viewHeader(on.rebind)
    this.steps = stepControls(on)
    // `detachProgram` carries no argument (`PaneEvents.detachProgram`'s own doc: a machine has no step-k
    // text to report), so the item's run is the handler itself rather than a closure over a frame.
    const detachProgram = on.detachProgram
    // *FORMAT* IS REMOVED WHERE THERE IS NO EDITOR, *EDIT A COPY* WHERE THERE IS NO HANDLER OR NOTHING TO COPY, AND
    // *MOVE THE EDITOR HERE* WHERE THERE IS NO EDITOR TO MOVE: a control that cannot apply is removed (`CopyEditor`'s
    // `#syncEditorControls`, `#refreshDetach` and `#refreshClaim`).
    this.menu = viewMenu(this.header.actions, {
      // REMOVED WHERE THERE IS NO EDITOR, not disabled: a view showing a running leg has no
      // document to format, which is the umbrella's rule for a control that cannot apply.
      format: () => this.copy.format(),
      ...(on.splitRow !== undefined && on.splitColumn !== undefined
        ? { split: (dir: Dir, c: PaneChoice) => (dir === 'row' ? on.splitRow?.(c) : on.splitColumn?.(c)) }
        : {}),
      ...(on.close !== undefined ? { close: on.close } : {}),
      ...(detachProgram !== undefined ? { editCopy: { run: detachProgram, what: opts.what } } : {}),
      ...(on.showEditor !== undefined ? { claim: on.showEditor } : {}),
      choices: () => this.#choices,
    })
    this.copy = new CopyEditor(on, {
      menu: this.menu,
      outlineOpen: opts.outlineOpen,
      noun: opts.noun,
      onUnmount: () => this.editorUnmounted(),
    })
  }

  /** Put the view on the page: the step strip in the header, then the header and `body` in `host`. */
  protected mount(host: HTMLElement, body: HTMLElement): void {
    this.header.steps.append(this.steps.el)
    host.replaceChildren(this.header.el, body)
  }

  /** The copy's text as a region of the view's stack, keeping its own height until a boundary is dragged beside it. */
  protected textRegion(): StackRegion {
    return {
      name: 'text',
      label: 'text',
      el: this.copy.text.el,
      share: null,
      panels: [this.copy.text],
      bodies: () => [this.copy.text.body],
    }
  }

  /** The copy's outline as a region of the view's stack. */
  protected outlineRegion(): StackRegion {
    return {
      name: 'outline',
      label: 'outline',
      el: this.copy.outlinePanel.el,
      share: 1,
      panels: [this.copy.outlinePanel],
      bodies: () => [this.copy.outlinePanel.body],
    }
  }

  /** What `setEditor(null)` does beyond removing the editor — `CopyEditorOptions.onUnmount`. Nothing, by default. */
  protected editorUnmounted(): void {}

  /**
   * `copy · not linked`, in the title. A view moved off a copy gives up its editor, whichever route moved it, and
   * *edit a copy* follows the same fact — `CopyEditor.setDetached`, whose doc has the reasons behind both.
   */
  setDetached(detached: boolean): void {
    this.header.setDetached(detached)
    this.copy.setDetached(detached)
  }

  /** Mount a copy's editor seeded with `text`, or unmount it with `null` — `CopyEditor.setEditor`. */
  setEditor(text: string | null, collapsed = false): void {
    this.copy.setEditor(text, collapsed)
  }

  /** Give up the mounted editor without destroying it — `CopyEditor.takeEditor`. */
  takeEditor(): ScratchEditor | null {
    return this.copy.takeEditor()
  }

  /** Mount an editor this view did not build — `CopyEditor.receiveEditor`, for *move the editor here*. */
  receiveEditor(editor: ScratchEditor, collapsed = false): void {
    this.copy.receiveEditor(editor, collapsed)
  }

  /** Whether this view is showing an editor — `CopyEditor.holdsEditor`. */
  holdsEditor(): boolean {
    return this.copy.holdsEditor()
  }

  /** Whether another view holds this copy's editor, for *move the editor here* — `CopyEditor.setEditorAvailable`. */
  setEditorAvailable(available: boolean): void {
    this.copy.setEditorAvailable(available)
  }

  /** Send the mounted editor's pending edit now — `CopyEditor.flushEditor`. */
  flushEditor(): void {
    this.copy.flushEditor()
  }

  /**
   * Whether this view can offer *edit a copy*: `text` is the program's text, or `null` when there is none to copy;
   * `count` is how many rules or instructions it has, which words a refusal; and `resultDecodable` is whether its
   * result type has a decoding a header can name — `CopyEditor.setForkAvailable`, whose `#refreshDetach` gives its
   * three answers: absent, disabled with its reason, or ready. THE RXM VIEW PASSES NO THIRD ARGUMENT: the rxm leg's
   * header is optional, so a function-valued program still gets text (`RxmHeader::for_type`'s doc).
   */
  setForkAvailable(text: string | null, count: number, resultDecodable = true): void {
    this.copy.setForkAvailable(text, count, resultDecodable)
  }

  /** The `steps` switch, per `PaneView.setStepsShown` — the view's header owns the slot. */
  setStepsShown(shown: boolean): void {
    this.header.setStepsShown(shown)
  }

  /**
   * Offer `options` in the pane selector and show `current` as the pair in force. Same shape and same
   * contract as `LambdaPane.setBindings`; that method's doc carries the argument for pushing the list
   * in rather than letting a pane hold a registry, and the argument for `Binding<Leg>` rather than
   * `Binding<'tm'>`, and neither is repeated here.
   */
  setBindings(options: PaneOption[], current: Binding<Leg>): void {
    this.header.setBindings(options, current)
  }

  /**
   * Which layout gestures this pane currently offers, and what a split may create. Same shape and same
   * contract as `LambdaPane.setLayoutControls`; that method's doc carries the argument for driving this
   * from the draw pass `draw.ts`'s `createDraw` builds rather than from the pane, and
   * `PaneView.setLayoutControls` carries the argument for `choices` riding this call. Neither is
   * repeated here.
   */
  setLayoutControls(canClose: boolean, canSplit: boolean, choices: SplitChoices): void {
    this.#choices = choices
    this.menu.setLayout(canClose, canSplit)
  }
}
