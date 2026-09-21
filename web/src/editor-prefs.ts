/**
 * Editor preferences that live beside the user rather than beside the layout — Plan 7 part 3a.
 *
 * **ITS OWN KEY RATHER THAN A FIELD ON `Workspace`, WHICH IS WHERE THE PART 3 PLAN PUT IT.** The
 * workspace is the tiling tree, its presets, its switches and each view's panel state: things that
 * describe an arrangement, are versioned together, and are migrated when that version moves. Format
 * on blur is none of those. Putting it there would cost a `WORKSPACE_VERSION` bump and a migration
 * for a boolean, and would make a preference vanish whenever a layout failed to restore.
 *
 * It sits beside `appearance.ts`'s and `skin.ts`'s keys instead, which is where its siblings in the
 * settings menu already live — the umbrella's §4 lists skin, appearance, keymap and format on blur as
 * one group, and three of the four were already here.
 */

export const FORMAT_ON_BLUR_KEY = 'redextape.formatOnBlur'

/**
 * **OFF ON A FIRST VISIT, AND THAT IS THE DECISION RATHER THAN THE CAUTIOUS DEFAULT.** Formatting
 * rewrites the whole buffer — `textDocumentSync` is Full and the formatter is `print ∘ parse`, so the
 * edit spans the document — and doing that to someone's text because they clicked elsewhere is a
 * surprise the first time. It is safe to turn ON (a buffer that does not parse formats to nothing),
 * which is why it is offered at all; it is not safe to assume.
 */
export const DEFAULT_FORMAT_ON_BLUR = false

/**
 * Read the stored preference.
 *
 * **EVERY ACCESS IS WRAPPED, FOR `appearance.ts`'s REASON.** `localStorage` throws on access in a
 * private window and under blocked site data, and a preference read must never be what stops the app
 * starting.
 */
export function readFormatOnBlur(store: Storage = localStorage): boolean {
  try {
    return store.getItem(FORMAT_ON_BLUR_KEY) === 'true'
  } catch {
    return DEFAULT_FORMAT_ON_BLUR
  }
}

/** Store the preference, or do nothing if storage refuses. */
export function writeFormatOnBlur(on: boolean, store: Storage = localStorage): void {
  try {
    store.setItem(FORMAT_ON_BLUR_KEY, String(on))
  } catch {
    // A preference that cannot be remembered is still a preference for this page.
  }
}
