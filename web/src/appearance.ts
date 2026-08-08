/**
 * The three states the header's appearance toggle cycles through. `system` — not `light` or `dark`
 * — is the default: the app already follows `prefers-color-scheme` correctly on its own, and a
 * two-state toggle would take that away. Once you picked one you could never get back to following
 * the OS, so `system` has to stay reachable, not just be the unpicked starting point.
 */
export type Appearance = 'light' | 'dark' | 'system'

/**
 * The `localStorage` key the chosen appearance is stored under.
 *
 * NAMESPACED, BECAUSE `localStorage` IS SCOPED TO AN ORIGIN AND NOT TO AN APP. Every dev server on
 * `http://localhost:5173` shares one store, so a bare `appearance` is a key any other project on
 * that port can read or overwrite — observed in practice, with an unrelated app's preferences
 * sitting alongside ours in the same origin.
 *
 * `index.html`'s inline script duplicates this string rather than importing it, and has to: it runs
 * before the module graph loads, which is the whole reason it exists. Change one and change both.
 */
export const STORAGE_KEY = 'redextape.appearance'

/**
 * The next state in the cycle: system → light → dark → system. Three states, three-way cycle — one
 * click always lands somewhere new, and the fourth click is back where the first one started.
 */
export function nextAppearance(current: Appearance): Appearance {
  switch (current) {
    case 'system':
      return 'light'
    case 'light':
      return 'dark'
    case 'dark':
      return 'system'
  }
}

/**
 * Parse whatever is sitting in storage. Anything unrecognised falls back to `'system'` — not just
 * `null` (nothing stored yet) and `''` (cleared), but also a value this build does not know, which is
 * what a stale write from a future version would look like. Failing open to the state that already
 * matches the OS is the safe direction to guess wrong in.
 */
export function readStored(raw: string | null): Appearance {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

/**
 * The glyph and the `aria-label` text for one state, keyed by state. The label names the CURRENT
 * state rather than just "theme" — a glyph alone announces to a screen reader as a bare character,
 * not as a control with state.
 */
export const APPEARANCE_LABEL: Record<Appearance, { glyph: string; label: string }> = {
  system: { glyph: '◐', label: 'appearance: system' },
  light: { glyph: '☀', label: 'appearance: light' },
  dark: { glyph: '☾', label: 'appearance: dark' },
}

/**
 * Apply a state to the document root. `'system'` REMOVES `data-theme` rather than setting it to the
 * literal string `"system"` — the CSS has no rule for that value to match, so removing it falls
 * through to `:root`'s own `color-scheme: light dark`, which is what makes `light-dark()` track
 * `prefers-color-scheme` again. `'light'` and `'dark'` set the attribute the CSS does match, which
 * pins `color-scheme` to one branch regardless of the OS.
 */
export function applyAppearance(root: HTMLElement, a: Appearance): void {
  if (a === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', a)
  }
}
