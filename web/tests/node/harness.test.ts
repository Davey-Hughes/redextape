import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SHELL, until } from '../browser/harness'

describe('SHELL', () => {
  it('carries the elements the app mounts into', () => {
    for (const sel of [
      '#appearance',
      '#workspace',
      '#reset-preset',
      '#new-view',
      '#buffers',
      '#encoding',
      '#settings',
      '#style',
      '#palette',
      '#notice',
      '#live',
      '#results',
      '#link-status',
      '#step-bar',
      '#views',
      '#inspector',
      '#appearance-choice',
      '#workspace-menu',
      '#new-view-menu',
      '#settings-menu',
    ]) {
      // `id="…"`, NOT THE BARE WORD: a substring test is satisfied by a NEIGHBOUR's id — `#new-view` by
      // `id="new-view-menu"`, `#settings` by `id="settings-menu"`, `#appearance` by the settings label's
      // own text — so deleting the element this list is about would leave it green.
      expect(SHELL).toContain(`id="${sel.slice(1)}"`)
    }
    // `<main>` HOLDS TWO CHILDREN SINCE PART 2b: the layout tree's own root and the inspector column
    // beside it (spec §9). `renderLayout` opens with `root.replaceChildren()`, so the tree needed a root
    // of its own the moment anything else lived in `<main>`.
    expect(SHELL).toContain('<div id="views"></div>')
  })
})

/**
 * THE GATE THAT HOLDS THE REAL PAGE AND THE TEST SHELL TOGETHER.
 *
 * **THE ID LIST ABOVE IS NOT ONE, AND THAT WAS MEASURED RATHER THAN NOTICED.** It reads `SHELL` and never
 * opens `index.html`, so the two could diverge completely: part 2b's own whole-branch review deleted
 * `#views`, `#inspector` and `#step-bar` from `index.html` — reverting the real page to its part 2a shape —
 * and **all 533 node tests passed**, while the browser tier mounts `SHELL` and could not see it either.
 * `main()` would have thrown `the page is missing a mount point` on the real site, behind a green CI.
 *
 * **STRUCTURE, NOT SUBSTRINGS.** `main.ts` now also resolves `footer.strip` by CLASS, and `#inspector` has
 * to sit INSIDE `<main>` beside `#views` or the inspector column has nothing to be a column of — neither
 * fact is visible to a list of `id="…"` fragments. Comparing the whole body is the only form that holds
 * what the app actually depends on, and it costs one assertion.
 *
 * The module script is the one deliberate difference: `SHELL` is injected into a page that imports
 * `main.ts` itself, so it must not carry a second copy.
 */
describe('SHELL against index.html', () => {
  const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')

  /** Markup with every run of whitespace between tags collapsed, so indentation is not a difference. */
  const shape = (markup: string): string =>
    markup
      .replace(/<script type="module"[^>]*><\/script>/g, '')
      .replace(/>\s+</g, '><')
      .replace(/\s+/g, ' ')
      .trim()

  it('is the same markup the real page ships, from <header> to the end of the strip', () => {
    const body = /<body>([\s\S]*?)<\/body>/.exec(html)?.[1]
    expect(body, 'index.html has no <body> to compare against').toBeDefined()
    expect(shape(SHELL)).toBe(shape(body as string))
  })
})

describe('until', () => {
  it('evaluates the predicate before its first sleep', async () => {
    let polls = 0
    await until(() => {
      polls += 1
      return true
    })
    expect(polls).toBe(1)
  })

  it('polls until the predicate flips', async () => {
    let n = 0
    await until(() => ++n > 3, 'four evaluations', 1_000, 1)
    expect(n).toBe(4)
  })

  it('names the condition the call site described', async () => {
    await expect(until(() => false, 'the pane to mount', 30, 5)).rejects.toThrow(
      'timed out after 30ms waiting for the pane to mount',
    )
  })

  it('quotes the predicate source when the call site named nothing', async () => {
    await expect(until(() => 1 > 2, undefined, 30, 5)).rejects.toThrow(/waiting for `.*1 > 2.*`/)
  })

  it('truncates a predicate source too long to belong in a failure log', async () => {
    // Use a long inline string so toString() exceeds MAX_SOURCE_CHARS (120)
    const predicate = () =>
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
        .length < 0
    await expect(until(predicate, undefined, 30, 5)).rejects.toThrow(/…`$/)
  })
})
