/**
 * Browser-tier setup: give the tester page the app's stylesheet.
 *
 * VITEST'S BROWSER MODE SERVES ITS OWN HTML, NOT THIS PROJECT'S `index.html`, and `index.html` is the
 * only place `style.css` is referenced (`<link rel="stylesheet" href="/src/style.css">` — `main.ts`
 * does not import it, deliberately, so the stylesheet loads from `<head>` rather than after the module
 * and the page does not flash unstyled). The consequence is that every browser test before this file
 * ran against a completely unstyled DOM.
 *
 * THAT IS NOT A COSMETIC DIFFERENCE FOR THE STATE TABLE. `.state-table`'s `max-height: 40vh` is what
 * bounds the scroll container; without it the box lays out at its full content height — measured at
 * 271,968px for 11,332 rows — and a test asserting that virtualization renders few rows would be
 * exercising `TmPane`'s clamp fallback instead of the geometry the app actually ships.
 *
 * Importing the stylesheet here makes the browser tier test the real thing. It is a `setupFiles` entry
 * rather than an import in `main.ts` because the `<head>` link is the right production loading order
 * and this is a test-harness gap, not an application one.
 */
import '../../src/style.css'
