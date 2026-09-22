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

/**
 * Which set of key bindings an editor answers to — umbrella §4's fourth setting.
 *
 * TWO NAMES RATHER THAN A BOOLEAN, where `formatOnBlur` above is a boolean. A checkbox reads as a
 * switch on one behaviour; this picks between two whole keyboards, and `vimMode: false` would have to
 * be read as "the other one, whatever that is". The stored value is one of these words, so a reader of
 * `localStorage` sees which keyboard is in force rather than which one is off.
 */
export type KeymapMode = 'default' | 'vim'

export const KEYMAP_KEY = 'redextape.keymap'

/**
 * **CodeMirror's OWN BINDINGS ON A FIRST VISIT, AND THAT IS NOT MERELY THE CAUTIOUS DEFAULT.** A
 * modal editor is unusable to someone who does not already know it — every letter is a command and
 * nothing types — so shipping it to a visitor who never asked would leave the app looking broken
 * rather than configured. The people who want vim know they want it; the setting is how they say so.
 */
export const DEFAULT_KEYMAP: KeymapMode = 'default'

/**
 * The word the settings menu offers for each mode — `appearance.ts`'s `APPEARANCE_LABEL`, one field
 * wide.
 *
 * **BESIDE THE TYPE RATHER THAN IN THE MARKUP**, so the words a control offers and the values it
 * stores are written once. A `<select>`'s own accessible name comes from the `<label>` wrapping it;
 * these are the option texts inside it.
 */
export const KEYMAP_LABEL: Record<KeymapMode, string> = { default: 'default', vim: 'vim' }

/**
 * Every keymap mode the app offers, in the order the settings menu lists them.
 *
 * **DERIVED FROM `KEYMAP_LABEL`, NOT WRITTEN OUT A SECOND TIME.** The select that offers these modes and
 * the code that narrows a chosen one back to a `KeymapMode` used to each spell out `'default'` and
 * `'vim'` themselves, so a third mode added to `KeymapMode` and `KEYMAP_LABEL` could still leave both
 * call sites listing only two — nothing in the type system would say so, because a string literal is
 * valid whether or not it is exhaustive. Reading `KEYMAP_LABEL`'s own keys makes it the one place a mode
 * is added.
 */
export const KEYMAP_MODES: readonly KeymapMode[] = Object.keys(KEYMAP_LABEL) as KeymapMode[]

/**
 * Narrow an arbitrary string — a `<select>`'s `.value`, which is a plain string as far as the type
 * system knows — to a `KeymapMode`, falling back to `DEFAULT_KEYMAP` for anything not in
 * `KEYMAP_MODES`. In practice the select's string always is one: its options are built from
 * `KEYMAP_MODES` in the first place. A stored string is where the fallback earns its keep, and
 * `readKeymap` below calls THIS function rather than testing for `'vim'` itself.
 *
 * **IT SAID "THE SAME FALLBACK `readKeymap` APPLIES, REUSED" WHILE THE TWO SHARED NO CODE.** `readKeymap`
 * spelled `=== 'vim'` out, which is the drift `KEYMAP_MODES` exists to prevent — harmless with two modes
 * and wrong the moment there is a third, since a stored `'emacs'` would fall back here and be accepted
 * there. Now the sentence is true because there is one narrowing.
 */
export function parseKeymapMode(value: string): KeymapMode {
  return KEYMAP_MODES.some((mode) => mode === value) ? (value as KeymapMode) : DEFAULT_KEYMAP
}

/**
 * Read the stored keymap.
 *
 * **AN UNRECOGNISED VALUE IS THE DEFAULT, NOT A THROW AND NOT A CAST.** The stored string is whatever
 * a previous version of this app, or the user's own devtools, last put there; `as KeymapMode` would
 * hand a typo straight to the compartment, which would install nothing and leave the control claiming
 * a mode no editor is in. The wrapping is `readFormatOnBlur`'s, for `appearance.ts`'s reason: storage
 * throws on access in a private window and under blocked site data.
 *
 * **THE NARROWING IS `parseKeymapMode`'s AND NOT A SECOND `=== 'vim'` HERE**, which is what that
 * function's own doc had always claimed. A missing key reads as `null`, and `''` is in no mode's name,
 * so an absent preference takes the same fallback an unrecognised one does.
 */
export function readKeymap(store: Storage = localStorage): KeymapMode {
  try {
    return parseKeymapMode(store.getItem(KEYMAP_KEY) ?? '')
  } catch {
    return DEFAULT_KEYMAP
  }
}

/** Store the keymap, or do nothing if storage refuses. */
export function writeKeymap(mode: KeymapMode, store: Storage = localStorage): void {
  try {
    store.setItem(KEYMAP_KEY, mode)
  } catch {
    // A preference that cannot be remembered is still a preference for this page.
  }
}
