/**
 * Milliseconds between the last keystroke in a `ScratchEditor` and the recompile it schedules.
 *
 * ITS OWN MODULE, NOT A THIRD COPY OF `compile.ts`'s `DEBOUNCE_MS` (300). A scratch editor mounts from
 * more than one pane class, and a `= 300` beside each one's own constant would be the same number spelled
 * a third way. One dependency-free constant every scratch-editor-mounting pane imports is what keeps
 * "same gesture, same speed" a single fact instead of several that could drift apart one edit at a time.
 *
 * DEPENDENCY-FREE ON PURPOSE, so importing it never pulls in anything a pane module does not already
 * need on its own — `compile.ts`'s `DEBOUNCE_MS` stays where it is, unimported by this file or by any
 * pane module.
 */
export const EDITOR_DEBOUNCE_MS = 300
