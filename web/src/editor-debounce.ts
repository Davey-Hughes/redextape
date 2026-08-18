/**
 * Milliseconds between the last keystroke in a `ScratchEditor` and the recompile it schedules.
 *
 * ITS OWN MODULE, NOT A THIRD COPY OF `compile.ts`'s `DEBOUNCE_MS` (300). `lambda-pane.ts` used to hold
 * this literal itself, under the identical argument `ScratchEditor`'s own doc still gives for why
 * `debounceMs` is injected rather than imported: importing from the module that mounts the app would
 * make a widget a dependency of `main.ts`. That argument justifies a SECOND copy of the number, held
 * where a pane can pass it to the editor it constructs — it does not justify a third: a scratch editor
 * now mounts from more than one pane class, and a `= 300` beside each one's own constant would be the
 * same number spelled a third way rather than a second deliberate duplicate. One dependency-free
 * constant every scratch-editor-mounting pane imports is what keeps "same gesture, same speed" a single
 * fact instead of several that could drift apart one edit at a time.
 *
 * DEPENDENCY-FREE ON PURPOSE, so importing it never pulls in anything a pane module does not already
 * need on its own — `compile.ts`'s `DEBOUNCE_MS` stays where it is, unimported by this file or by either
 * pane, for the same reason `ScratchEditor`'s own doc gives: `main.ts` mounts the app, and nothing here
 * should become a dependency of it.
 */
export const EDITOR_DEBOUNCE_MS = 300
