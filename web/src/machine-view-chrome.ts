import type { Dir } from './layout'
import type { PaneChoice, PaneEvents, SplitChoices } from './pane-chrome'
import type { Leg } from './protocol'
import type { Binding, PaneOption } from './sessions'
import { stepControls } from './step-controls'
import { type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'

/**
 * The chrome the TM, rxm and CLIF views share: the header, the step strip, the `⋯` menu, and the members that hand off
 * to them. A view builds its panels after `super()` and hands its body to `mount`.
 *
 * **THE CONSTRUCTOR CALLS NOTHING A VIEW OVERRIDES.** A subclass's private fields do not exist until `super()` returns,
 * so an override reached from here would throw on its first read of one.
 */
export abstract class MachineViewChrome {
  /** The view's header — `LambdaPane`'s `#header`, the same component. */
  protected readonly header: ViewHeader
  protected readonly steps: ReturnType<typeof stepControls>
  /** The view's `⋯` menu and `✕` — `LambdaPane.#menu`'s twin. */
  protected readonly menu: ViewMenu
  /**
   * What this pane's split menus offer — `LambdaPane.#choices`'s twin. `SplitChoices`'s doc carries the
   * argument for the starting value, and `LambdaPane.#choices`'s the one for reading it through a thunk
   * rather than handing a list over once.
   */
  #choices: SplitChoices = { options: [], sourceAvailable: false, current: null }

  constructor(on: PaneEvents) {
    this.header = viewHeader(on.rebind)
    this.steps = stepControls(on)
    this.menu = viewMenu(this.header.actions, {
      ...(on.splitRow !== undefined && on.splitColumn !== undefined
        ? { split: (dir: Dir, c: PaneChoice) => (dir === 'row' ? on.splitRow?.(c) : on.splitColumn?.(c)) }
        : {}),
      ...(on.close !== undefined ? { close: on.close } : {}),
      choices: () => this.#choices,
    })
  }

  /** Put the view on the page: the step strip in the header, then the header and `body` in `host`. */
  protected mount(host: HTMLElement, body: HTMLElement): void {
    this.header.steps.append(this.steps.el)
    host.replaceChildren(this.header.el, body)
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
