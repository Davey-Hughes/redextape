import type { EditorView } from '@codemirror/view'
import { afterEach, expect, vi } from 'vitest'
import html from '../../index.html?raw'
import type { ControlState, LegView } from '../../src/controls'
import type { LambdaBody } from '../../src/lambda-body'
import { LAYOUT_STORAGE_KEY, type LayoutNode, leaves } from '../../src/layout'
import type { PaneEvents } from '../../src/pane-chrome'
import type { PaneKind } from '../../src/panes'
import { PREPAINT } from '../../src/prepaint'
import { viewToggleButtons } from '../../src/view-toggle-markup'
import { defaultWorkspace, parseWorkspace, serializeWorkspace, type Workspace } from '../../src/workspace'
import { until } from './until'

/**
 * Shared browser-tier fixtures: the app shell the test files mount into, and `until.ts`'s wait, re-exported; for
 * the tests of what a reload draws first, the page's own pre-paint script, the palette picked from the settings
 * menu, and a colour as `getComputedStyle` writes it; and the other helpers the test files share.
 *
 * **WHY THIS DOES NOT BREAK THE DIRECTORY'S STANDING IDIOM.** Files in this directory carry a comment
 * saying that each browser test file gets its own page — `main()` runs once per module load and Vitest
 * gives each test file its own page — and concluding from it that duplicating a mount helper is right,
 * because "a shared mount would be a shared page two files could not both own". The premise is a fact
 * about the test runner and it holds; the conclusion is about a MOUNT. `SHELL` is an inert template
 * string and `until` closes over nothing, so importing either into two files shares no page, no state
 * and no mount. `setup.ts` already demonstrates a shared non-test module being loaded once per page
 * without sharing anything across pages. `mountApp` deliberately stays per-file: four files declare one,
 * all four bodies differ, and each owns its own page.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names
 * end in `.test.ts`, and this one does not.
 */

/**
 * The app shell that `index.html` provides in production and Vitest's own tester HTML does not.
 *
 * Reset `document.body.innerHTML` to this before a mount so a new instance queries fresh elements
 * rather than ones an earlier instance's listeners are still attached to.
 */
export const SHELL = `
  <header class="bar">
    <span class="wordmark"><img src="/favicon.svg" width="22" height="22" alt="" />redextape</span>
    <button type="button" id="workspace" aria-haspopup="menu" aria-controls="workspace-menu" aria-expanded="false">Explorer <span aria-hidden="true">▾</span></button>
    <div id="workspace-menu" class="header-menu" popover>
      <button type="button" id="reset-preset">reset preset — restores the default views</button>
    </div>
    <div id="views-shown" class="views-shown" role="group" aria-label="show">
      ${viewToggleButtons()}
    </div>
    <button type="button" id="examples" aria-haspopup="menu" aria-controls="examples-menu" aria-expanded="false">examples <span aria-hidden="true">▾</span></button>
    <div id="examples-menu" class="header-menu" popover></div>
    <label class="encoding">
      encoding
      <select id="encoding"></select>
    </label>
    <span class="bar-spacer"></span>
    <div id="notice" class="notice" hidden></div>
    <button type="button" id="share" aria-controls="share-menu" aria-expanded="false">share</button>
    <div id="share-menu" class="header-menu share" popover></div>
    <button type="button" id="appearance"></button>
    <button type="button" id="about" aria-controls="about-menu" aria-expanded="false">about <span aria-hidden="true">▾</span></button>
    <div id="about-menu" class="header-menu about" popover>
      <a href="/about.html" target="_blank" rel="noopener" aria-describedby="about-new-tab">about</a>
      <a href="/help.html" target="_blank" rel="noopener" aria-describedby="about-new-tab">help</a>
      <a href="/licences.html" target="_blank" rel="noopener" aria-describedby="about-new-tab">licences</a>
      <a href="/privacy.html" target="_blank" rel="noopener" aria-describedby="about-new-tab">privacy</a>
      <a id="about-source" href="https://github.com/Davey-Hughes/redextape" target="_blank" rel="noopener" aria-describedby="about-new-tab">source <span aria-hidden="true">↗</span></a>
      <p id="about-build" class="about-build"></p>
      <span id="about-new-tab" class="visually-hidden">opens in a new tab</span>
    </div>
    <button type="button" id="settings" aria-haspopup="menu" aria-controls="settings-menu" aria-expanded="false">settings</button>
    <div id="settings-menu" class="header-menu settings" popover>
      <label class="skin">style <select id="style"></select></label>
      <label class="skin">palette <select id="palette"></select></label>
      <label class="skin">appearance <select id="appearance-choice"></select></label>
      <label class="skin">keymap <select id="keymap"></select></label>
        <label class="skin"><input type="checkbox" id="format-on-blur" /> format when leaving the editor</label>
        <button type="button" id="import-base16">import base16…</button>
    </div>
  </header>
  <div id="live" class="visually-hidden" role="status"></div>
  <div id="view-keys" class="view-keys" hidden></div>
  <main>
    <div id="views"></div>
    <aside id="inspector" class="inspector" hidden></aside>
  </main>
  <div id="step-bar" class="step-bar" hidden></div>
  <div id="editor"></div>
  <footer class="strip">
    <section id="results" class="results"></section>
    <div id="link-status" class="link-status"></div>
  </footer>`

/**
 * A walk forward by a step control's clicks: where it starts, how it takes a step, where it ends, and the step the page
 * says the machine is at, which is how a part of it shows that its clicks landed.
 */
export type Walk = {
  /** What the walk ends at, as a failure says it: `inside cmpeq`. */
  readonly to: string
  /** Put the machine where the walk starts. Called once, by the first part; absent, the walk starts where it is. */
  readonly restart?: () => void
  /** One step forward. */
  readonly forward: () => void
  /** Whether the machine is where the walk ends. */
  readonly arrived: () => boolean
  /** The step the machine is at, read off the page. */
  readonly step: () => number
}

/** The clicks the last part of a walk may make before it waits. */
const WALK_BOUND = 20_000

/**
 * **A LONG WALK IN PARTS, EACH TO BE A HOOK OF ITS OWN.** A walk of many clicks is as slow as the machine it runs on:
 * each click is a step and a whole redraw, synchronously, and nothing in a test can make it faster. As one hook, such a
 * walk can run past Vitest's 30 s on the slower CI runner. A hook's cap is its own, so the walk is cut into parts and
 * each part is registered as a hook: `for (const part of walkInParts(...)) beforeAll(part)`. Hooks of one suite run in
 * the order they are registered, one after another.
 *
 * **EACH PART CLICKS UP TO ITS SHARE, OR UNTIL THE WALK HAS ARRIVED, AND THEN CHECKS ITS OWN WORK**: the page's step
 * count has moved by exactly the clicks it made, and it made some unless the walk had arrived. A part whose clicks did
 * nothing fails there, by its number and with its figures, and not as a later hook's timeout. `shares` gives the clicks
 * of every part but the last; the last walks until the walk has arrived, to `WALK_BOUND` clicks, and then waits for
 * it (`until`).
 */
export function walkInParts(walk: Walk, shares: readonly number[]): (() => Promise<void>)[] {
  const parts = shares.length + 1
  return Array.from({ length: parts }, (_, k) => async (): Promise<void> => {
    if (k === 0) walk.restart?.()
    const from = walk.step()
    const most = shares[k] ?? WALK_BOUND
    let clicks = 0
    while (clicks < most && !walk.arrived()) {
      walk.forward()
      clicks += 1
    }
    const at = walk.step()
    const part = `part ${k + 1} of ${parts} of the walk to ${walk.to}`
    if (at !== from + clicks) {
      throw new Error(`${part} clicked forward ${clicks} times from step ${from}, and the machine is at step ${at}`)
    }
    if (clicks === 0 && !walk.arrived()) throw new Error(`${part} clicked nothing at step ${from}, short of it`)
    if (k === parts - 1) await until(walk.arrived, `the machine to be ${walk.to}`)
  })
}

/**
 * A walk of a TM view by its own controls: ▶ and ↺ among the view's `.controls` by their text, the state's name at
 * the start of its status line, and the step after it on that line, `step N of M`. The walk ends at the first state
 * whose status matches `arrived`; `restart` starts it from ↺, step 0, and its clicks after ↺ rely on ↺ being a seek,
 * with nothing evicted.
 */
export function tmWalk(pane: () => HTMLElement, arrived: RegExp, to: string, restart = false): Walk {
  const control = (label: string) =>
    [...pane().querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
  const status = () => pane().querySelector('.tm-status')?.textContent ?? ''
  return {
    to,
    ...(restart ? { restart: () => control('↺')?.click() } : {}),
    forward: () => control('▶')?.click(),
    arrived: () => arrived.test(status()),
    step: () =>
      Number(
        (/^step ([\d,]+)/.exec(pane().querySelector('.tm-status .step')?.textContent ?? '')?.[1] ?? '').replaceAll(
          ',',
          '',
        ),
      ),
  }
}

/**
 * **`fact(3)` FROM STEP 0 INTO `cmpeq`, IN THREE PARTS**: 1,732 steps forward to the first step inside `cmpeq`, the
 * first instruction whose gadget has named sub-steps, where stepping back from the frontier would take about 9,000.
 * The first two parts click 578 times each and the third the 576 left.
 */
export const intoCmpeq = (pane: () => HTMLElement): (() => Promise<void>)[] =>
  walkInParts(tmWalk(pane, /^cmp/, 'inside cmpeq', true), [578, 578])

/** The pre-paint script every page's `<head>` carries, which draws a load's first frame from storage. */
export { PREPAINT }

/** `#rrggbb` as `getComputedStyle` writes a colour. */
export const rgb = (hex: string): string =>
  `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

/** A spacing token in pixels, as the page resolves it. */
export const space = (token: string): number => {
  const probe = document.createElement('div')
  probe.style.width = `var(${token})`
  document.body.append(probe)
  const width = probe.getBoundingClientRect().width
  probe.remove()
  return width
}

/**
 * A token (`--accent`), or a system colour (`Highlight`), as the page resolves it for `property`, `color` unless
 * named: the computed value of a probe that sets it inside `where`. A colour token is a `light-dark()` pair, which
 * only a computed value turns into the colour drawn, and a probe inside `where` reads it as that element's colour
 * scheme and cascade have it.
 */
export const token = (name: string, property = 'color', where: Element = document.body): string => {
  const probe = document.createElement('span')
  probe.style.setProperty(property, name.startsWith('--') ? `var(${name})` : name)
  where.append(probe)
  const value = getComputedStyle(probe).getPropertyValue(property)
  probe.remove()
  return value
}

/** How many lines a box's text is set on: one per distinct top among its text's line boxes. */
export const linesOf = (el: Element): number => {
  const range = document.createRange()
  range.selectNodeContents(el)
  return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
}

/** The vertical middle of `el`'s box, as `getBoundingClientRect` measures it. */
export const centreOf = (el: Element): number => {
  const box = el.getBoundingClientRect()
  return (box.top + box.bottom) / 2
}

/** The centre of `el` in the top-level page's CSS pixels, where CDP's input lands: the tests run in a scaled frame. */
export function pageCentreOf(el: Element): { x: number; y: number } {
  const frame = (window.frameElement as HTMLElement).getBoundingClientRect()
  const scale = frame.width / innerWidth
  const r = el.getBoundingClientRect()
  return { x: frame.left + (r.left + r.width / 2) * scale, y: frame.top + (r.top + r.height / 2) * scale }
}

/** `el`'s box, as `getBoundingClientRect` measures it. */
export const rect = (el: Element | null): DOMRect => (el as Element).getBoundingClientRect()

/** The root element's font size in pixels: what `1rem` is. */
export const rem = (): number => Number.parseFloat(getComputedStyle(document.documentElement).fontSize)

/** `el`'s height, as `getBoundingClientRect` measures it. */
export const heightOf = (el: Element): number => el.getBoundingClientRect().height

/** The region `name` of the view in `host`, its `[data-region]`. */
export const region = (host: HTMLElement, name: string) => host.querySelector(`[data-region="${name}"]`) as HTMLElement

/** The boundary in `host` between the regions `above` and `below`. */
export const boundary = (host: HTMLElement, above: string, below: string) =>
  host.querySelector(`.panel-boundary[data-above="${above}"][data-below="${below}"]`) as HTMLElement

/** The panel `name` of the view in `host`, its `[data-panel]`. */
export const panelOf = (host: HTMLElement, name: string) => host.querySelector(`[data-panel="${name}"]`) as HTMLElement

/** The disclosure in the header of `host`'s panel `name`. */
export const panelToggle = (host: HTMLElement, name: string) =>
  panelOf(host, name).querySelector('.panel-toggle') as HTMLElement

/** Whether `el` has a box on the page: `getClientRects` lists one or more. */
export const isShown = (el: Element) => el.getClientRects().length > 0

/** The pane's padding box across: where its content may lie without the pane scrolling sideways. */
export const innerOf = (pane: HTMLElement): { readonly left: number; readonly right: number } => {
  const left = pane.getBoundingClientRect().left + pane.clientLeft
  return { left, right: left + pane.clientWidth }
}

/** The median of `xs`, the upper of the two middles for an even count, and `NaN` for none. */
export const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN

/** `x` milliseconds to one decimal, padded to seven characters. */
export const ms = (x: number) => x.toFixed(1).padStart(7)

/** The attributes of `<html>` the pre-paint script sets from storage: the palette, the style and the appearance. */
const PREPAINTED = ['style', 'data-style', 'data-theme'] as const

/**
 * `<body>`'s background on a reload's first frame: `PREPAINT` run alone, on `<html>` as `index.html`'s markup has it
 * — no inline palette, the markup's `data-style`, no `data-theme` — so what the script finds in storage is all that
 * differs, as on a load. **THE PAGE IS PUT BACK AS IT WAS AFTER**, those attributes included, so the file's next case
 * meets the page this load drew, not the one a reload would.
 */
export function reloaded(): string {
  const root = document.documentElement
  const markup = new DOMParser().parseFromString(html, 'text/html').documentElement
  const kept = PREPAINTED.map((name) => [name, root.getAttribute(name)] as const)
  for (const name of PREPAINTED) {
    const value = markup.getAttribute(name)
    if (value === null) root.removeAttribute(name)
    else root.setAttribute(name, value)
  }
  new Function(PREPAINT)()
  const first = getComputedStyle(document.body).backgroundColor
  for (const [name, value] of kept) {
    if (value === null) root.removeAttribute(name)
    else root.setAttribute(name, value)
  }
  return first
}

/**
 * Pick `value` from the settings menu's select `id`, as a user does — the menu opened, the option chosen, the menu
 * closed — so the select's own `change` is what reaches `main.ts`.
 *
 * **`vitest/browser` IS IMPORTED HERE, WHEN IT IS CALLED, NOT AT THE TOP OF THE FILE.** The node tier's
 * `harness.test.ts` imports this file for `SHELL` and `until`, and `vitest/browser` refuses to load outside the
 * browser tier, which a top-level import would make it do.
 */
async function chooseSetting(id: string, value: string): Promise<void> {
  const { userEvent } = await import('vitest/browser')
  const settings = document.querySelector<HTMLElement>('#settings') as HTMLElement
  await userEvent.click(settings)
  await userEvent.selectOptions(document.querySelector(id) as HTMLSelectElement, value)
  await userEvent.click(settings)
  if (document.querySelector('#settings-menu')?.matches(':popover-open'))
    throw new Error('the settings menu stayed open')
}

/** The base16 import dialog. */
export const base16Dialog = (): HTMLDialogElement =>
  document.querySelector<HTMLDialogElement>('dialog.base16-dialog') as HTMLDialogElement

/** The palette select, `#palette`. */
export const paletteSelect = (): HTMLSelectElement =>
  document.querySelector<HTMLSelectElement>('#palette') as HTMLSelectElement

/** The computed style of `<body>`. */
export const bodyStyle = () => getComputedStyle(document.body)

/** The background colour of `<body>`, as `getComputedStyle` writes it. */
export const bodyBackground = () => getComputedStyle(document.body).backgroundColor

/** Pick a palette from the settings menu, as `chooseSetting` does. */
export const choosePalette = (value: string): Promise<void> => chooseSetting('#palette', value)

/** Pick a style from the settings menu, as `chooseSetting` does. */
export const chooseStyle = (value: string): Promise<void> => chooseSetting('#style', value)

/**
 * The host of the view `leaf`, or `null` where the page shows none.
 *
 * **NEVER ITS STAGE TAB.** A tab carries its view's `data-leaf` and comes before every host in the document, so on
 * the Stage a selector without `:not([role="tab"])` answers the tab, for the view that is shown as for the others.
 * A tab contains no controls, so a `contains(document.activeElement)` against it reads false no matter where the
 * focus is.
 */
export const host = (leaf: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${leaf}"]:not([role="tab"])`)

/** The first element whose `data-leaf` is `leaf`: in the Stage, unlike `host`, the view's tab. */
export const leafEl = (leaf: string) => document.querySelector<HTMLElement>(`[data-leaf="${leaf}"]`) as HTMLElement

/** The first element `sel` matches, cast to `T` as found: `null` where none does, whatever the type says. */
export const queryEl = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel) as T

/** The box of the view `leaf`'s host, as `getBoundingClientRect` measures it. */
export const box = (leaf: string): DOMRect => (host(leaf) as HTMLElement).getBoundingClientRect()

/** The text of the title on the view `leaf`'s host, or `''` where the page shows none. */
export const titleText = (leaf: string): string => host(leaf)?.querySelector('.view-title')?.textContent ?? ''

/** The binding the title on the view `leaf` names, its `data-binding`, or `''` where it names none. */
export const shows = (leaf: string) =>
  document.querySelector<HTMLElement>(`[data-leaf="${leaf}"] .view-title`)?.dataset.binding ?? ''

/** The text of the view `leaf`'s step readout, or `''` where it shows none. */
export const stepTextOf = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .step`)?.textContent ?? ''

/** The kind of the view `leaf`, its `data-kind`, or `''` where it has none. */
export const leafKind = (leaf: string) =>
  document.querySelector<HTMLElement>(`[data-leaf="${leaf}"]`)?.dataset.kind ?? ''

/** The kind of the view `leaf`'s host, its `data-kind`, or `''` where there is none. */
export const hostKind = (leaf: string): string => host(leaf)?.dataset.kind ?? ''

/** The layout the λ view `lambda-0`'s term is drawn in, its `data-layout`. */
export const lambdaLayout = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term')?.dataset.layout

/** The text of the λ view `lambda-0`'s step readout, or `''` where it shows none. */
export const lambdaStepText = () => stepTextOf('lambda-0')

/** The λ view `lambda-0`'s term, or `null` where it shows none. */
export const lambdaTerm = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term')

/** A mark the λ view draws: a bar piece's `data-lane`, and the `is-` class of a one-row node's run. */
export type LambdaMark = 'next-redex' | 'contractum' | 'linked' | 'result'

/** The selector for each element a λ view draws `mark` with, bar piece or run, so an absence it finds is the mark's. */
const anyMark = (mark: LambdaMark) => `.term-bar[data-lane="${mark}"], .term-mark.is-${mark}`

/** The selector for where a λ view's `mark` starts: its bar's piece on the node's first row, or a one-row run. */
export const markStart = (mark: LambdaMark) => `.term-bar[data-lane="${mark}"][data-first], .term-mark.is-${mark}`

/** The first element the λ view `lambda-0` draws `mark` with, in either form, or `null` where it draws none. */
export const lambdaMark = (mark: LambdaMark): Element | null => lambdaTerm()?.querySelector(anyMark(mark)) ?? null

/** Whether `s` draws a border on its `side`. */
export const drawsEdge = (s: CSSStyleDeclaration, side: 'Top' | 'Bottom' | 'Left' | 'Right') =>
  s[`border${side}Style`] !== 'none' && Number.parseFloat(s[`border${side}Width`]) > 0

/** Each element in a λ term's rows drawing an edge — outline, box shadow or border — the bars and their strip aside. */
export const wordEdges = (term: Element | null): HTMLElement[] =>
  [...(term?.querySelectorAll<HTMLElement>('.term-rows *') ?? [])].filter((el) => {
    if (el.matches('.term-lanes, .term-bar')) return false
    const s = getComputedStyle(el)
    const sides = ['Top', 'Bottom', 'Left', 'Right'] as const
    return s.outlineStyle !== 'none' || s.boxShadow !== 'none' || sides.some((side) => drawsEdge(s, side))
  })

/**
 * Where the word `result` on a λ row ends, in client px: past the row's last glyph by the word's padding and its
 * glyphs at its own font. The word is the row's `::after`, which has no box to read, so it is measured; a `Range` over
 * the row past its strip gives where the glyphs end.
 */
export function rowWordEnd(row: HTMLElement): number {
  const range = document.createRange()
  range.setStartAfter(row.querySelector('.term-lanes') as Element)
  range.setEnd(row, row.childNodes.length)
  const s = getComputedStyle(row, '::after')
  const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
  ctx.font = s.font
  const pad = Number.parseFloat(s.paddingInlineStart) + Number.parseFloat(s.paddingInlineEnd)
  return range.getBoundingClientRect().right + pad + ctx.measureText('result').width
}

/**
 * Hold `rects` as one column of touching boxes, `what` naming each: each as far left and as wide as the first, and
 * each top on the bottom of the one above. **TO UNDER 0.005 PX, NOT EXACTLY** (`toBeCloseTo` to two digits):
 * Firefox's rects carry float32 rounding, so one edge read as a box's top and as the bottom of the box above can differ
 * by 1e-5 px, where a gap the eye could see is a pixel.
 */
export function expectStacked(rects: readonly DOMRect[], what: string): void {
  const first = rects[0] as DOMRect
  for (const [i, r] of rects.entries()) {
    expect(r.left, `${what} ${i} under the first`).toBeCloseTo(first.left, 2)
    expect(r.width, `${what} ${i} as wide as the first`).toBeCloseTo(first.width, 2)
    if (i > 0) expect(r.top, `${what} ${i} touching the ${what} above`).toBeCloseTo((rects[i - 1] as DOMRect).bottom, 2)
  }
}

/** The pieces a λ term draws of `lane`'s bar, in the order drawn. */
export const barPieces = (term: Element | null, lane: LambdaMark): HTMLElement[] => [
  ...(term?.querySelectorAll<HTMLElement>(`.term-bar[data-lane="${lane}"]`) ?? []),
]

/** The width of the strip a λ term's rows are drawn with, which every drawn row must share. */
export const stripWidth = (term: Element): number => {
  const ws = [...term.querySelectorAll('.term-lanes')].map((s) => s.getBoundingClientRect().width)
  expect(new Set(ws).size, 'every drawn row’s strip as wide').toBe(1)
  return ws[0] as number
}

/** The lines of `lane`'s pieces' rows; each piece must lie in its row's first `strip` px, at the first piece's x. */
export const barRows = (term: Element | null, lane: LambdaMark, strip: number): number[] => {
  const ps = barPieces(term, lane)
  const at = (p: HTMLElement) => {
    const row = p.closest<HTMLElement>('.term-line') as HTMLElement
    return { row, b: p.getBoundingClientRect(), r: row.getBoundingClientRect() }
  }
  const first = ps[0] && at(ps[0])
  return ps.map((p) => {
    const { row, b, r } = at(p)
    const inside = [b.top >= r.top, b.bottom <= r.bottom, b.left >= r.left, b.right <= r.left + strip]
    expect(inside, `${lane}'s piece on row ${row.dataset.line} in its row's strip`).toEqual([true, true, true, true])
    expect(b.left - r.left, `${lane}'s piece on row ${row.dataset.line} in its lane`).toBeCloseTo(
      (first?.b.left ?? 0) - (first?.r.left ?? 0),
    )
    expect(b.width, `${lane}'s piece on row ${row.dataset.line} as wide as its lane`).toBeCloseTo(first?.b.width ?? 0)
    return Number(row.dataset.line)
  })
}

/** The text of the view `leaf`'s term, or `''` where it shows none. */
export const termOf = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .term`)?.textContent ?? ''

/** Click the λ view `lambda-0`'s control labelled `label`; nothing happens where it has none. */
export const lambdaControl = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')]
    .find((b) => b.textContent === label)
    ?.click()

/** The view hosts actually in the document — every `[data-leaf]` under `#views` that is not a tab. */
export const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)

/** The toggle in `#views-shown` that shows and hides the `kind` views. */
export const toggle = (kind: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`) as HTMLButtonElement

/** The kinds whose toggles in `#views-shown` are pressed. */
export const pressed = (): string[] =>
  [...document.querySelectorAll<HTMLButtonElement>('#views-shown button[aria-pressed="true"]')].map(
    (b) => b.dataset.shows as string,
  )

/** The first control of a view, which is where a gesture that gives the view the focus puts it. */
export const firstButton = (leaf: string): HTMLElement =>
  (host(leaf) as HTMLElement).querySelector('button') as HTMLElement

/** The view the focus is in, by its leaf; none for a focus on a tab, a divider, the header or `<body>`. */
export const viewOfFocus = (): string | undefined =>
  document.activeElement?.closest<HTMLElement>('#views [data-leaf]:not([role="tab"])')?.dataset.leaf

/** The source view's host. */
export const sourcePane = (): HTMLElement => host('source') as HTMLElement

/** Puts the focus in the source editor, so the keys a case types next edit the program. */
export const focusProgram = () => document.querySelector<HTMLElement>('[data-leaf="source"] .cm-content')?.focus()

/** The box that scrolls a long program: the source editor's own, in the share of its view it has (spec §11.1). */
export const sourceScroller = (): HTMLElement => sourcePane().querySelector('.cm-scroller') as HTMLElement

/** The λ view `lambda-0`'s host. */
export const lambdaHost = (): HTMLElement => host('lambda-0') as HTMLElement

/** A view's host — `.pane`, since in the stage each tab carries the leaf id too. */
export const paneByLeaf = (leaf: string) =>
  document.querySelector<HTMLElement>(`.pane[data-leaf="${leaf}"]`) as HTMLElement

/** `leaf`'s view, `[data-leaf="…"]`, thrown on where there is none; `missing` begins the message. */
export const paneOrThrow = (leaf: string, missing = 'no pane mounted at'): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-leaf="${leaf}"]`)
  if (el === null) throw new Error(`${missing} [data-leaf="${leaf}"]`)
  return el
}

/** Every `data-leaf` under `<main>`, in document order. */
export const mainLeafIds = () =>
  [...document.querySelectorAll<HTMLElement>('main [data-leaf]')].map((el) => el.dataset.leaf ?? '')

/** The leaf ids of the views whose kind is `tm`. */
export const tmLeaves = () =>
  [...document.querySelectorAll<HTMLElement>('[data-kind="tm"]')].map((el) => el.dataset.leaf ?? '')

/** Every `data-leaf` on the page, in document order. */
export const leafIds = () => [...document.querySelectorAll<HTMLElement>('[data-leaf]')].map((e) => e.dataset.leaf ?? '')

/**
 * The ids of every λ pane — by `data-kind`, NOT by an `id` prefix. `nextLeafId` mints `pane-${n}`
 * regardless of which leg the split came from (`main.ts`'s own doc on `nextLeafId`: a pane can change
 * which leg it renders, so an id like `lambda-3` would describe something the pane is not), so
 * `dataset.kind` is the truthful statement of what a leaf renders. This matters MORE in
 * `layout-restore.test.ts` than in its siblings: its `STORED` deliberately seeds a leaf spelled `lambda-1`,
 * so an id-prefix filter would find it by luck while silently missing a freshly split leaf spelled `pane-N`
 * — the exact mismatch that file exists to restore correctly.
 */
export const lambdaLeaves = () =>
  [...document.querySelectorAll<HTMLElement>('[data-kind="lambda"]')].map((e) => e.dataset.leaf ?? '')

/**
 * Every leaf's id paired with the `flex` `layout-view.ts` gave it, in document order — "where each pane
 * is and how big it is", as one comparable value.
 *
 * THE ID IS IN IT BECAUSE THE ORDER IS HALF THE CLAIM. `renderLayout` only ever appends, so a pane
 * rebuilt as a fresh leaf rather than changed in place would arrive at the END of its parent split with
 * a size the divider positions no longer describe; comparing bare sizes would call that arrangement
 * equal to this one whenever the sizes happen to match.
 */
export const places = () =>
  [...document.querySelectorAll<HTMLElement>('[data-leaf]')].map((e) => `${e.dataset.leaf}@${e.style.flex}`)

/** The text of `id`'s TM status line, or `''` where it shows none. */
export const statusOf = (id: string) => paneOrThrow(id, 'no pane at').querySelector('.tm-status')?.textContent ?? ''

/** The text of `id`'s step line, or `''` where it shows none. */
export const stepLineOf = (id: string) => paneOrThrow(id, 'no pane at').querySelector('.step')?.textContent ?? ''

/** The newest step a step line counts, 0 while it counts none: 72,000 from `step 72,000 of 72,000…`. */
export const recorded = (line: string) => Number(/of ([\d,]+)/.exec(line)?.[1]?.replaceAll(',', '') ?? 0)

/** Whether a step line says its recording has stopped: a count, and no `…` after it. */
export const recordingOver = (line: string) => line.startsWith('step ') && !line.includes('…')

/** The newest step a step line names — its `of N` — as the line prints it: `69,008` from `step 69,008 of 69,008 — …`. */
export const newest = (line: string) => /of ([\d,]+)/.exec(line)?.[1] ?? ''

/** The number `printed` writes, without its thousands separators. */
export const countOf = (printed: string) => Number(printed.replaceAll(',', ''))

/** The rxm view `rxm-0`'s pane. */
export const rxmPane = () => paneByLeaf('rxm-0')

/** The control labelled `label` among `pane`'s controls, or `undefined` where there is none. */
export const controlIn = (pane: HTMLElement, label: string) =>
  [...pane.querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)

/** The TM view `tm-0`'s host. */
export const tmViewHost = (): HTMLElement => host('tm-0') as HTMLElement

/** The state table under the TM view `tm-0`'s `host`, where `stateTable` looks under `tmPane`. */
export const tmStateTable = (): HTMLElement => host('tm-0')?.querySelector('.state-table') as HTMLElement

/** The TM view `tm-0`'s element, `[data-leaf="tm-0"]`. */
export const tmPane = () => document.querySelector('[data-leaf="tm-0"]') as HTMLElement

/** The text of `tmPane`'s status line, or `''` where it shows none. */
export const tmStatus = () => tmPane().querySelector('.tm-status')?.textContent ?? ''

/**
 * What a TM pane is actually showing, as three readings a blank pane cannot fake.
 *
 * ALL THREE ARE PAINTED FROM `TmPane`'s `#program`, AND THEY FAIL IN DIFFERENT DIRECTIONS. `render`
 * returns early — clearing the status line and the tape rows — when either the frame or the program is
 * `null`, so `tapes` and `status` say the pane has BOTH; `rows` is drawn from the `StateIndex` the
 * program builds and is painted whether or not a frame ever lands, so it says the machine reached the
 * pane even when the legs are empty. Counting `.cell` rather than `.tape` is deliberate: an empty tape
 * row is markup, a cell is a symbol read off a frame.
 */
export const showing = (leaf: string) => ({
  tapes: [...document.querySelectorAll(`[data-leaf="${leaf}"] .tape .cell`)].map((e) => e.textContent).join(''),
  rows: document.querySelectorAll(`[data-leaf="${leaf}"] .state-row`).length,
  status: document.querySelector(`[data-leaf="${leaf}"] .tm-status`)?.textContent ?? '',
})

/** The control labelled `label` among `tmPane`'s controls, or `undefined` where there is none. */
export const control = (label: string) => controlIn(tmPane(), label)

/** The text of the TM view `tm-0`'s step readout, or `''` where it shows none. */
export const tmStepText = () => document.querySelector('[data-leaf="tm-0"] .step')?.textContent ?? ''

/** The TM view `tm-0`'s `.extend` control, or `null` where it has none. */
export const extendButton = () => document.querySelector<HTMLButtonElement>('[data-leaf="tm-0"] .controls .extend')

/** The `▶` specifically. The strip's first button is `↺`, so a positional lookup would name the wrong one. */
export const forwardButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="tm-0"] .controls button')].find(
    (b) => b.textContent === '▶',
  )

/** About half of the callers' `BUDGET_SRC`'s TM recording, which stops with its history full at step 75,024. */
const BUDGET_HALF = 37_000

/**
 * **THE CALLERS' `BUDGET_SRC`'S TM HISTORY FILLING, IN THREE WAITS: THE TM LEG STARTING TO RECORD, ITS HISTORY HALF FULL, THEN THE
 * FILL.** As one wait it took up to 8,590 ms at `CPUQuota=25%`, against `until`'s 10 s, and as two the second took up
 * to 6,900 ms. The TM leg records last, after λ and rxm, and its step line reads `…` from its first frames until it
 * stops, and counts them. Called right after a dispatch, which withdraws the stop before and drops the line's `…`
 * (`compile.ts`'s `schedule`, `controls.ts`): the first two assertions hold both, so no wait can pass on the run
 * before, and the third holds that the line the second wait counts is this run's.
 */
export async function historyFills(): Promise<void> {
  expect(tmStepText(), 'precondition: the stop before is withdrawn').not.toContain('history is full')
  expect(tmStepText(), 'precondition: no TM recording under way').not.toContain('…')
  await until(
    () => tmStepText().includes('…') || tmStepText().includes('history is full'),
    'the TM leg to start recording',
  )
  expect(tmStepText(), 'precondition: the TM leg is past the recompile').not.toContain('— recompiling')
  await until(
    () =>
      Number(/of ([\d,]+)/.exec(tmStepText())?.[1]?.replaceAll(',', '') ?? 0) >= BUDGET_HALF ||
      tmStepText().includes('history is full'),
    'the TM history to be half full',
  )
  await until(() => tmStepText().includes('history is full'), 'the TM history to fill')
}

/** The alpha of a computed colour, written `rgba(r, g, b, a)` or with `/ a)` at its end. */
export const alphaOf = (colour: string): number => {
  const m = /(?:\/\s*|rgba\((?:[^,]+,){3}\s*)([\d.]+)\)$/.exec(colour)
  return m === null ? 1 : Number(m[1])
}

/** `tmPane`'s state table. */
export const stateTable = () => tmPane().querySelector('.state-table') as HTMLElement

/** `tmPane`'s state diagram panel. */
export const diagram = () => tmPane().querySelector('[data-panel="diagram"]') as HTMLElement

/** The scroller of `diagram`'s program level. */
export const programScroll = () => diagram().querySelector('.program-scroll') as HTMLElement

/** The rows `diagram`'s program level draws. */
export const programRows = () => [...diagram().querySelectorAll<HTMLElement>('.program-row')]

/** The boxes `diagram`'s program level draws. */
export const diagramBoxes = () => [...diagram().querySelectorAll<HTMLElement>('.program-box')]

/** The name on the row `diagram`'s program level marks as the current step; `undefined` where it marks none. */
export const currentRowName = () =>
  diagram().querySelector('.program-row[aria-current="step"] .program-name')?.textContent

/** The mode button of `diagram` whose `data-value` is `value`, or `undefined` where there is none. */
export const diagramChoice = (value: string) =>
  [...diagram().querySelectorAll<HTMLButtonElement>('.diagram-mode')].find((b) => b.dataset.value === value)

/** Whether an element is drawn: `hidden` is not enough, since an author `display` can outrank it. */
export const diagramShows = (sel: string) =>
  getComputedStyle(diagram().querySelector(sel) as HTMLElement).display !== 'none'

/** The name on the program row that holds `programScroll`'s `aria-activedescendant`. */
export const activeProgramName = () =>
  document
    .getElementById(programScroll().getAttribute('aria-activedescendant') ?? '')
    ?.closest('.program-row')
    ?.querySelector('.program-name')?.textContent

/** How far `el` can scroll down: a box that cannot is at 0 whatever it was given. */
export const scrollRange = (el: HTMLElement): number => el.scrollHeight - el.clientHeight

/**
 * Mount the app on this file's page in a window `width` × `height`: the shell, `main()`, and its first compile
 * settled.
 */
export async function mountAt(width: number, height: number): Promise<void> {
  const { page } = await import('vitest/browser')
  await page.viewport(width, height)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
}

/**
 * The notice line's words, without the label of the action beside them: `#notice`'s own text ends in `undo` where the
 * notice offers one.
 */
export const notice = (): string => (document.querySelector('#notice .notice-text')?.textContent ?? '').trim()

/** What the live region says, without the space a sentence said twice is written with (`notice.ts`'s `createNotices`). */
export const live = (): string => (document.querySelector('#live')?.textContent ?? '').trim()

/** What the live region says, as it is written: unlike `live`, not trimmed. */
export const liveText = () => document.querySelector('#live')?.textContent ?? ''

/**
 * Every notice the line draws and every sentence the live region says from this call on, in order, until `stop`.
 *
 * **A NOTICE IS COUNTED BY ITS ELEMENT, AND A SENTENCE BY ITS WRITE.** `notice.ts`'s `paint` builds a new
 * `.notice-text` for each notice without an action, and its `say` writes the live region once per notice, so a notice
 * said again in the same words is counted again: what the user sees drawn and what a screen reader hears. **IT WATCHES
 * THE WHOLE BODY**, so a remount's fresh `SHELL` goes on being counted, and the page it replaced, whose elements are
 * gone from the body, is not.
 *
 * **A SENTENCE IS READ FROM THE NODE ITS WRITE ADDED, NOT FROM THE REGION.** The observer is called once the code
 * that wrote has run, so two writes in one task would both read the region's last words; each `textContent` write
 * replaces the region's text node with a new one, which keeps that write's own words (`notice.test.ts` holds both).
 */
export function hear(): { readonly notices: string[]; readonly said: string[]; stop(): void } {
  const notices: string[] = []
  const said: string[] = []
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.target instanceof HTMLElement && r.target.id === 'live')
        said.push(r.addedNodes[0]?.textContent?.trim() ?? '')
      for (const n of r.addedNodes) {
        if (n instanceof HTMLElement && n.classList.contains('notice-text')) notices.push(n.textContent ?? '')
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return { notices, said, stop: () => observer.disconnect() }
}

/** The notice, `#notice`. */
export const noticeEl = (): HTMLElement => document.querySelector<HTMLElement>('#notice') as HTMLElement

/** The notice's text, as it is written: unlike `notice`, not trimmed. */
export const noticeElText = () => noticeEl().querySelector('.notice-text')?.textContent ?? ''

/** What the notice line says, or `''` while it says nothing: unlike `notice`, not trimmed. */
export const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''

/** The notice line's action button, or `null` where the notice offers none. */
export const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')

/** The encoding picker, `#encoding`. */
export const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement

/** The width box on `leaf`'s TM view's header bar (`field-width.ts`). */
export const widthBox = (leaf = 'tm-0'): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(`[data-leaf="${leaf}"] .field-width input`) as HTMLInputElement
/** What `leaf`'s width box shows: its number, or `auto`, its placeholder, when it is empty. */
export const widthShown = (leaf = 'tm-0'): string => widthBox(leaf).value || 'auto'
/**
 * Enter `value` in `leaf`'s width box as a user does: a click in it, its text selected, `value` typed over it, or the
 * text deleted for `auto`, and Enter, which applies it.
 */
export async function enterWidth(value: string, leaf = 'tm-0'): Promise<void> {
  const { userEvent } = await import('vitest/browser')
  await userEvent.click(widthBox(leaf))
  await userEvent.keyboard('{Control>}a{/Control}')
  await userEvent.keyboard(value === 'auto' ? '{Backspace}' : value)
  await userEvent.keyboard('{Enter}')
}

/** The text of each segment of the results line, in order. */
export const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')

/** How many segments and rows the results line holds. */
export const readout = () => [...document.querySelectorAll('#results .segment, #results .row')].length

/** The link status line's text, `#link-status`, or `''` where the page has none. */
export const linkStatus = () => document.querySelector('#link-status')?.textContent ?? ''

/** The text of whichever source construct is currently marked `.linked`, or `''` if none is. */
export const linkedSource = () => document.querySelector('.cm-editor .linked')?.textContent ?? ''

/**
 * The text of whichever source construct is currently marked `.linked`, or `null` if none is, where `linkedSource`
 * reads `''`.
 */
export const sourceLinked = () => document.querySelector('.cm-editor .linked')?.textContent ?? null

/**
 * Link the source construct at `pos` (a UTF-16 doc position) in `v`, via the keyboard route `main.ts` binds
 * to `Mod-'` rather than synthesizing a `mouseup` at a computed pixel — real Chromium under Playwright
 * would make that work too, but the keyboard path resolves against the caret alone and needs no
 * `posAtCoords` layout to line up. `Mod` is `Ctrl` on this platform (`@codemirror/view`'s
 * `normalizeKeyName`: `mac ? meta : ctrl`), and the callers' fixtures are ASCII, so a UTF-16 position and
 * a byte offset coincide for them — the conversion `main.ts` itself does is not what their tests are for.
 */
export function linkAt(v: EditorView, pos: number): void {
  v.dispatch({ selection: { anchor: pos } })
  v.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: "'", ctrlKey: true, cancelable: true }))
}

/** Replace `v`'s text. */
export function retype(v: EditorView, text: string): void {
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
}

/** `v`'s document, as a string. */
export const text = (v: EditorView): string => v.state.doc.toString()

/** The examples menu's button, `#examples`. */
export const examplesButton = () => document.querySelector<HTMLButtonElement>('#examples') as HTMLButtonElement

/** The share button, `#share`. */
export const shareButton = () => document.querySelector<HTMLButtonElement>('#share') as HTMLButtonElement

/** The share menu, `#share-menu`. */
export const shareMenu = () => document.querySelector<HTMLElement>('#share-menu') as HTMLElement

/** Whether the share menu is open. */
export const shareMenuOpen = () => shareMenu().matches(':popover-open')

/** The share menu's link field, `#share-link`. */
export const shareLinkField = () => shareMenu().querySelector<HTMLInputElement>('#share-link') as HTMLInputElement

/** Whether the view keys are armed: their hint, `#view-keys`, is shown. */
export const armed = (): boolean => !(document.querySelector('#view-keys') as HTMLElement).hidden

/** The prefix chord that arms the view keys, as `userEvent.keyboard` writes it. */
export const PREFIX = '{Control>}.{/Control}'

/**
 * Split `leaf` through its `⋯` menu, as a user does: `dir` is the direction, and `pick` is `'same'`
 * (another view of this), `'source'`, or a `bindingKey(leg, session)`.
 *
 * **THE MENU IS REACHED THROUGH THE INVOKER'S `aria-controls`, NOT THROUGH `[data-leaf] .view-menu`.**
 * A view has ONE menu, so the scoped query would find the right element too — but `aria-controls` is the
 * relationship `view-header.ts`'s `viewMenu` builds `⋯` for, and going through it means a header that ever
 * stopped naming its own menu fails this helper loudly (the `item == null` throw below) instead of every split
 * here quietly turning into a no-op.
 *
 * IT THROWS WHEN THE ENTRY IS ABSENT, NAMING WHAT WAS ON OFFER. `find(...)?.click()` on a missing item is
 * a silent no-op, and every assertion after it would then describe a page nothing happened on — the same
 * hazard `pickBinding` records.
 */
export function splitVia(leaf: string, dir: 'row' | 'column', pick: string): void {
  const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
  if (more === null) throw new Error(`no view menu on [data-leaf="${leaf}"]`)
  more.click()
  const menu = document.getElementById(more.getAttribute('aria-controls') ?? '')
  menu?.querySelector<HTMLButtonElement>(`button.view-split[data-dir="${dir}"]`)?.click()
  const selector =
    pick === 'same' ? 'button[data-same]' : pick === 'source' ? 'button[data-source]' : `button[data-binding="${pick}"]`
  const item = menu?.querySelector<HTMLButtonElement>(`.view-menu-pairs ${selector}`)
  if (item == null) {
    const offered = [...(menu?.querySelectorAll<HTMLButtonElement>('.view-menu-pairs button') ?? [])].map(
      (b) => b.textContent,
    )
    throw new Error(`[data-leaf="${leaf}"] offers no ${pick} to split into — offered: ${offered.join(' | ')}`)
  }
  item.click()
}

/**
 * Split `leaf` into a second pane of the same kind on the same session.
 *
 * **THE PICK IS THE PANE'S OWN PAIR**, the item `view-header.ts`'s `viewMenu` labels "another view of this": the
 * same pane, duplicated, on the same session, which reaches two views of one session without a rebind.
 */
export const splitSame = (leaf: string, dir: 'row' | 'column'): void => splitVia(leaf, dir, 'same')

/**
 * Split `leaf` into a second pane of the same kind on the same session.
 *
 * **THE PICK IS THE PANE'S OWN PAIR, FOUND BY ITS `data-same` RATHER THAN BY POSITION**: `find(...)?.click()` on a
 * missing entry is a silent no-op, and taking the first item of a menu that had reordered would quietly make every
 * test that calls it a test of a different split. `pane-picker.test.ts` is where the other entries are exercised.
 */
export const splitRow = (leaf: string): void => splitVia(leaf, 'row', 'same')

/** The title-selector of `leaf`'s view — the pair in force is its `data-binding`. */
export const titleOf = (leaf: string) =>
  document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-title`)

/** The title-selector of the view in `pane` — the pair in force is its `data-binding`. */
export const viewTitleOf = (pane: HTMLElement) =>
  pane.querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement

/**
 * Pick `key` (`bindingKey(leg, session)`) through `leaf`'s title menu, as a user does.
 *
 * **IT ASSERTS THE ITEM WAS THERE, WHICH IS NOT PEDANTRY** — a pick that never happened would leave every
 * assertion after it passing against the pane's old pair.
 */
export function pickBinding(leaf: string, key: string): void {
  const title = titleOf(leaf)
  if (title === null) throw new Error(`no title-selector on [data-leaf="${leaf}"]`)
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const item = menu?.querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
  if (item == null) {
    const offered = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b) => b.dataset.binding)
    throw new Error(`[data-leaf="${leaf}"] offers no ${JSON.stringify(key)} — offered: ${JSON.stringify(offered)}`)
  }
  item.click()
}

/**
 * **AFTER A GESTURE THE FOCUS IS ON AN ELEMENT INSIDE `<body>`, AND NOT ON `<body>`** — the view layouts spec §14
 * item 19. A rebuild takes every view's host off the page and puts it back, and a control that is hidden or removed
 * gives the focus up, so a gesture that hands it nowhere leaves it on `<body>`: the next `Tab` starts from the top of
 * the page, and a key typed goes to no editor. Called after a gesture, with words for it, this throws saying where
 * the focus was.
 *
 * **AT ONCE, AND TWO FRAMES ON**: a control that can no longer hold the focus gives it up when it is made so or at
 * the next frame, and a focus handed on from a frame's callback has landed by the second.
 *
 * **IT SAYS NOTHING OF WHICH ELEMENT**: a case that knows where the focus belongs asserts that beside this.
 */
export async function focusInPage(gesture: string): Promise<void> {
  const check = (when: string): void => {
    const el = document.activeElement
    if (el !== null && el !== document.body && document.body.contains(el)) return
    const where = el === null ? 'nothing' : `<${el.tagName.toLowerCase()}>`
    throw new Error(`${gesture} left the focus on ${where}, ${when}`)
  }
  check('at once')
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  check('two frames on')
}

/**
 * Two animation frames: the one the page draws next, and one more. Long enough for the browser to lay out, clamp and
 * deliver its own `scroll` events and a resize observer's, for a control that cannot hold the focus to have lost it,
 * and for the style recalc that hides a menu and the blur that follows it.
 */
export const frames = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

/** One animation frame: the one the page draws next. */
export const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

/**
 * Fail each case of the calling file during which the page reports an error: a `ResizeObserver loop`, which the
 * browser reports and goes on past, or anything thrown where no case catches it (`hear-loops.test.ts`).
 *
 * **EVERY ERROR, NOT LOOPS ALONE.** Vitest fails a run for an uncaught error only while the page has no `error`
 * listener but its own, so one that kept the loops alone would pass a case whose timer or handler threw.
 *
 * **IT OWNS THE FILE'S TEARDOWN, TO WAIT BEFORE IT.** A loop is reported at the frame after the write that caused it,
 * and not at all once its elements are off the page; a teardown in a hook of the file's own would run on whichever
 * side of the wait the runner's hook order put it.
 */
export function hearLoops(teardown: () => void | Promise<void>): void {
  const errors: string[] = []
  window.addEventListener('error', (e) => errors.push(String(e.message)))
  afterEach(async () => {
    await frames()
    let heard: string[] = []
    try {
      await teardown()
    } finally {
      heard = errors.splice(0)
    }
    expect(heard, 'errors the page reported in this test').toEqual([])
  })
}

/**
 * Wait until `read` gives the same value for six frames running, for a scroll that may animate, and answer it; fail,
 * naming `what`, if it has not held still within 240 frames, rather than answer a value still moving.
 */
export async function steady(read: () => number, what: string): Promise<number> {
  let last = read()
  for (let same = 0, n = 0; n < 240; n += 1) {
    await frame()
    const now = read()
    same = now === last ? same + 1 : 0
    last = now
    if (same >= 6) return last
  }
  throw new Error(`${what} did not hold still for 6 frames within 240`)
}

/** A control's accessible name, the tag of an element without one (`BODY`), or `nothing`. */
export const controlName = (el: Element | null): string => el?.getAttribute('aria-label') ?? el?.tagName ?? 'nothing'

/**
 * The name of whatever holds the focus once it has held still for six frames, so a failure reads as two names. **NOT ONE
 * READ AFTER THE GESTURE**: Chromium leaves the focus on a control disabled under it until a later rendering update (the
 * HTML spec's focus fixup rule), so a read in the same frame names the disabled button and a read one frame on may too.
 */
export async function settledFocus(): Promise<string> {
  const seen: (Element | null)[] = []
  const i = await steady(() => {
    if (!seen.includes(document.activeElement)) seen.push(document.activeElement)
    return seen.indexOf(document.activeElement)
  }, 'the focus')
  return controlName(seen[i] ?? null)
}

/**
 * The next `scroll` event on `el`, once a listener registered before it, as `VirtualGrid`'s is in its constructor,
 * has run. **AWAITED RATHER THAN COUNTING FRAMES**: a scroll's event can come later than two frames, so an assertion
 * after two frames could run before the event it was about, and pass whatever the handler would have done. **IT
 * RESOLVES FROM A TASK AFTER THE EVENT**, so nothing after the await, the next case included, runs inside the event's
 * dispatch, where a scroll it makes gets its own event a frame late and can read as the echo of an earlier one.
 */
export const scrolled = (el: HTMLElement) =>
  new Promise<void>((r) => el.addEventListener('scroll', () => setTimeout(r), { once: true }))

/**
 * The boxes `scrollHeldAt` has written whose `scroll` event has not reached them yet, with the frames drawn since and
 * the case that wrote.
 */
const unheard = new WeakMap<HTMLElement, { frames: number; by: string | undefined }>()

/** The case running now, by its full name. */
const runningCase = () => expect.getState().currentTestName

/**
 * Frames a written box may go without its `scroll` event before `scrollHeldAt` gives up on it: many times the few
 * rendering updates a drawn box's event takes, and few enough that the helper's message, which names the box, comes
 * before the bound of the `until` it sits in while the page draws at least three frames a second.
 */
const EVENT_FRAMES = 30

/**
 * Put `box`'s top at `top`, as near as it goes, and say whether it holds there: a predicate for `until`, for a box that
 * may be following something (a run's row, the current state, the next redex). **WRITTEN AGAIN UNTIL IT HOLDS**: a
 * draw that runs after the write and before the write's own `scroll` event finds the box still following, puts it
 * back where it follows, and records that as its own write, so the event reads as that write's echo and the box goes
 * on following. A reply the page draws for at once can land there whenever the worker is still answering; a wheel
 * cannot, since its place and its event reach the page together, nor a key the grid handles, which detaches it first.
 */
export function scrollHeldAt(box: HTMLElement, top: number): boolean {
  const there = Math.min(top, box.scrollHeight - box.clientHeight)
  const name = box.classList.length > 0 ? `.${[...box.classList].join('.')}` : box.tagName.toLowerCase()
  // A WAIT A THROW HAS REPORTED IS SPENT: left behind, it would fail the next call that finds the box in place at once,
  // for a write that call did not make.
  const failure = (text: string) => {
    unheard.delete(box)
    return new Error(`scrollHeldAt: ${text}`)
  }
  // HELD ONLY ONCE THE WRITE'S OWN EVENT HAS BEEN HANDLED, since until then a draw can still put a following box back.
  // A box already in place holds at once: a write that moves nothing sends no event.
  if (Math.abs(box.scrollTop - there) <= 1) {
    const wait = unheard.get(box)
    // A WAIT ENDS WITH THE CASE THAT WROTE: one left by a case whose `until` gave up before the count reached its bound
    // would otherwise hold a later case back, and then fail it, for a write that case did not make.
    if (wait === undefined || wait.by !== runningCase()) {
      unheard.delete(box)
      return true
    }
    // COUNTED IN FRAMES, NOT TIME: a main thread held for a while delays the frames as much as the polls, so the count
    // grows only while the page draws and the event still does not come. Firefox sends no `scroll` event to a box that
    // a hidden level holds until the level is shown, and a wait on one would end at `until`'s bound under the caller's
    // message, which names neither the box nor what it waited for.
    if (wait.frames >= EVENT_FRAMES)
      throw failure(
        `no scroll event has come for ${name}'s write in ${wait.frames} frames: it reads ${box.scrollTop}, is ${box.isConnected ? '' : 'not '}in the document and has ${box.getClientRects().length} client rects. Possible causes: the box was taken out of the document, or a level that holds it is hidden (Firefox sends no scroll event to such a box until the level is shown)`,
      )
    return false
  }
  box.scrollTop = top
  // THROWN AT ONCE FOR A PLACE THE BOX CANNOT REACH: a write lands as it is made and only its event waits, so a box
  // that does not read the place straight after the write never will (a `top` below 0 or not a number, a box that does
  // not scroll), and writing again would only spin to the wait's bound under a message about something else.
  const landed = box.scrollTop
  if (!(Math.abs(landed - there) <= 1))
    throw failure(
      `${name} cannot reach ${top}: it reads ${landed} straight after the write, and scrolls from 0 to ${box.scrollHeight - box.clientHeight}`,
    )
  const wait = { frames: 0, by: runningCase() }
  unheard.set(box, wait)
  // Added after the box's own listeners, so it runs once they have acted on the event.
  box.addEventListener('scroll', () => unheard.delete(box), { once: true })
  const tick = () => {
    if (unheard.get(box) !== wait) return
    wait.frames += 1
    if (wait.frames < EVENT_FRAMES) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  return false
}

/** Dispatch a bubbling `keydown` of `key` on `body`'s element. */
export const keyOnBody = (body: LambdaBody, key: string) =>
  body.el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

/** `el` has the focus now, and still has it two frames on. */
export async function holdsFocus(el: Element, what: string): Promise<void> {
  expect(document.activeElement, `${what}, at once`).toBe(el)
  await frames()
  expect(document.activeElement, `${what}, two frames on`).toBe(el)
}

/**
 * Yield to the event loop once.
 *
 * NOT `until(() => true)`, WHICH WAITS FOR NOTHING. `until` evaluates its predicate before its first
 * sleep, so a predicate that is already true returns synchronously — an `await` on it is a no-op that
 * reads like a wait. Places that need the DOM to settle after a synchronous click use this;
 * places that need a specific condition use `until` with that condition instead.
 */
export const tick = () => new Promise((r) => setTimeout(r, 0))

/**
 * A press on a toggle with the pointer, after which the focus is somewhere in the page (spec §14 item 19).
 * `vitest/browser` is imported when it is called, as `chooseSetting` says why.
 */
export const pressToggle = async (kind: string): Promise<void> => {
  const { userEvent } = await import('vitest/browser')
  await userEvent.click(toggle(kind))
  await focusInPage(`a press on the ${kind} toggle`)
}

/** And one on a Stage tab. */
export const pressTab = async (leaf: string): Promise<void> => {
  const { userEvent } = await import('vitest/browser')
  await userEvent.click(document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`) as HTMLElement)
  await focusInPage(`a press on the Stage tab of ${leaf}`)
}

/** The Stage tab of the view `leaf`. */
export const stageTab = (leaf: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`) as HTMLElement

/** The leaves of the Stage's tabs, in the order they come. */
export const tabLeaves = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [role="tab"]')].map((t) => t.dataset.leaf as string)

/** The leaf of the Stage tab that is selected. */
export const selectedTab = (): string | undefined =>
  document.querySelector<HTMLElement>('#views [role="tab"][aria-selected="true"]')?.dataset.leaf

/** Choose the item `sel` from the workspace menu, and close the menu where it is still open. */
export const clickWorkspaceItem = (sel: string): void => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
  const menu = document.querySelector<HTMLElement>('#workspace-menu')
  if (menu?.matches(':popover-open')) menu.hidePopover()
}

/** The workspace button's words: the preset's name, or `custom`. */
export const workspaceNameText = (): string => document.querySelector('#workspace')?.textContent ?? ''

/** Choose a workspace preset through the workspace menu. */
export const pickPreset = (name: 'explorer' | 'stage'): void => clickWorkspaceItem(`[data-preset="${name}"]`)

/** The workspace menu, `#workspace-menu`. */
export const workspaceMenu = (): HTMLElement => document.querySelector<HTMLElement>('#workspace-menu') as HTMLElement

/** Open the workspace menu with a click on its button, and return the menu. */
export const openWorkspaceMenu = (): HTMLElement => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  return document.querySelector<HTMLElement>('#workspace-menu') as HTMLElement
}

/** The views' container, `#views`. */
export const views = (): HTMLElement => document.querySelector<HTMLElement>('#views') as HTMLElement

/** The inspector, `#inspector`. */
export const inspector = (): HTMLElement => document.querySelector<HTMLElement>('#inspector') as HTMLElement

/** Set the `<select>` that `sel` finds to `value`, and dispatch a `change` event on it. */
export function chooseOption(sel: string, value: string): void {
  const select = document.querySelector<HTMLSelectElement>(sel) as HTMLSelectElement
  select.value = value
  select.dispatchEvent(new Event('change'))
}

/** The view hosts on the page — every `[data-leaf]` under `#views` but a Stage's tabs, which carry one too. */
export const hosts = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')].filter((el) => el.getAttribute('role') !== 'tab')

/**
 * What a mark in the view `leaf` may not move, to compare at two steps: the box of every view host, `leaf`'s own
 * included, the header's and `#results`', and the document's scroll size. **PLAIN NUMBERS**: a `DOMRect`'s sides are
 * getters, which `toEqual` does not read, so two rects of any size compare equal.
 */
export function outside(leaf: string): Record<string, readonly number[]> {
  if (host(leaf) === null) throw new Error(`no view at ${leaf}`)
  const sides = (el: Element) => {
    const r = el.getBoundingClientRect()
    return [r.left, r.top, r.width, r.height]
  }
  const out: Record<string, readonly number[]> = {}
  for (const h of hosts()) out[h.dataset.leaf ?? ''] = sides(h)
  out.header = sides(queryEl('header.bar'))
  out.results = sides(results())
  out.scroll = [document.documentElement.scrollWidth, document.documentElement.scrollHeight]
  return out
}

/** The layout storage holds, as written, or `null` where it holds none. */
export const storedLayoutText = (): string | null => localStorage.getItem(LAYOUT_STORAGE_KEY)

/** The stored layout, parsed, as the type `T` the caller reads it as; `null` where storage holds none. */
export const storedLayout = <T = Record<string, unknown>>(): T =>
  JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null')

/** The stored layout, parsed, or `{}` where storage holds none. */
export const storedLayoutOrEmpty = (): Record<string, unknown> =>
  JSON.parse(localStorage.getItem('redextape.layout') ?? '{}')

/** How many ids the stored workspace's trees name between them; a throw where the loader would refuse it. */
export const liveViewCount = (): number => {
  const ws = parseWorkspace(storedLayoutText())
  if (ws === null) throw new Error('the stored workspace does not parse')
  return new Set([ws.tree, ...Object.values(ws.arrangements)].flatMap((t) => leaves(t)).map((l) => l.id)).size
}

/** A layout leaf: the view `id`, of the kind `pane`. */
export const leafOf = (id: string, pane: PaneKind): LayoutNode => ({ kind: 'leaf', id, pane })

/**
 * `n` λ views in one row, `pane-1` to `pane-n`, each an equal share of it: one split deep, so only the leaf bound is in
 * play.
 */
export const rowOfLeaves = (n: number): LayoutNode => ({
  kind: 'split',
  dir: 'row',
  sizes: Array.from({ length: n }, () => 1 / n),
  children: Array.from({ length: n }, (_, i) => ({ kind: 'leaf', id: `pane-${i + 1}`, pane: 'lambda' }) as const),
})

/** The source beside one other view, the view `id` of the kind `pane`: a split in `dir`, sized `sizes`. */
export const sourceBeside = (
  id: string,
  pane: PaneKind,
  dir: 'row' | 'column' = 'row',
  sizes: [number, number] = [0.5, 0.5],
): LayoutNode => ({
  kind: 'split',
  dir,
  sizes,
  children: [leafOf('source', 'source'), leafOf(id, pane)],
})

/** The step bar, `#step-bar`. */
export const stepBar = (): HTMLElement => document.querySelector<HTMLElement>('#step-bar') as HTMLElement

/** The title of the view the bar drives, which `step-bar.ts` writes in front of its controls; `''` for none. */
export const barTitle = (): string => stepBar().querySelector('.step-bar-title')?.textContent?.trim() ?? ''

/** The step bar's own step readout, trimmed; `''` for none. */
export const barStep = (): string => stepBar().querySelector('.step-bar-inner .step')?.textContent?.trim() ?? ''

/** The step bar's button named `name`. */
export const barButton = (name: string): HTMLButtonElement =>
  stepBar().querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) as HTMLButtonElement

/**
 * All four views in two rows of two: source and λ over rxm and TM. `layout.ts`'s `defaultLayout()` is the source
 * beside the TM view. A file that wants four views says so with this.
 *
 * **SPELLED OUT, NOT TAKEN FROM `defaultArrangement`**: all four views' default in a wide area is two COLUMNS of two,
 * with the same views in the same corners, and what these files measure is this tree — its row dividers, its paths,
 * and the order its leaves come in.
 */
export const fourViews = (): LayoutNode => ({
  kind: 'split',
  dir: 'column',
  sizes: [0.5, 0.5],
  children: [
    {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [
        { kind: 'leaf', id: 'source', pane: 'source' },
        { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
      ],
    },
    {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [
        { kind: 'leaf', id: 'rxm-0', pane: 'rxm' },
        { kind: 'leaf', id: 'tm-0', pane: 'tm' },
      ],
    },
  ],
})

/**
 * The workspace a four-view page stored: `fourViews()`, Explorer, the focus on the λ view, nothing remembered. It is
 * what `setup.ts` stores for every file.
 */
export const fourViewWorkspace = (): Workspace => ({
  ...defaultWorkspace('wide'),
  tree: fourViews(),
  focused: 'lambda-0',
})

/** Store `fourViewWorkspace()` — for a file that clears storage before its mount and was written against four views. */
export const storeFourViews = (): void => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace(fourViewWorkspace()))
}

/**
 * An arrangement as one line, each split by its direction, its dividers' shares in hundredths and its children:
 * `column[50](row[50](source lambda-0) row[50](rxm-0 tm-0))`. In Stage it is the tabs in their order, which is all the
 * page draws of a tree there.
 */
const described = (tree: LayoutNode, stage: boolean): string => {
  if (stage)
    return `stage(${leaves(tree)
      .map((l) => l.id)
      .join(' ')})`
  if (tree.kind === 'leaf') return tree.id
  const shares = tree.sizes.slice(0, -1).map((size) => Math.round(size * 100))
  return `${tree.dir}[${shares.join(' ')}](${tree.children.map((child) => described(child, false)).join(' ')})`
}

/** The arrangement `#views` draws, read off the page as `described` writes one. */
export const drawn = (): string => {
  const read = (el: Element): string => {
    if (!el.classList.contains('layout-split')) return (el as HTMLElement).dataset.leaf ?? el.tagName.toLowerCase()
    const parts = [...el.children]
    const shares = parts
      .filter((c) => c.classList.contains('layout-divider'))
      .map((d) => d.getAttribute('aria-valuenow'))
    const children = parts.filter((c) => !c.classList.contains('layout-divider')).map(read)
    return `${(el as HTMLElement).dataset.dir}[${shares.join(' ')}](${children.join(' ')})`
  }
  const views = document.querySelector('#views') as HTMLElement
  const tabs = [...views.querySelectorAll<HTMLElement>('[role="tab"]')]
  if (tabs.length > 0) return `stage(${tabs.map((t) => t.dataset.leaf).join(' ')})`
  return [...views.children].map(read).join(' ')
}

/**
 * Put a mounted page back on all four views, each on the program, as `fourViews()` arranges them: *reset preset*,
 * which leaves the source beside the TM view and forgets every other arrangement, then `showFourViews`.
 *
 * **A FIXTURE, NOT A GESTURE UNDER TEST**: `.click()` and no `userEvent`.
 *
 * **WHAT IT ADDS TO A RESET**, each held by `four-views-fixture.test.ts`:
 *
 * - Two arrangements remembered in the stored workspace, the two the toggles pass through: the source beside the TM
 *   view, and those two with the λ view. The reset alone remembers none.
 * - The live region on `showing source, λ, TM and rxm`, the last switch's sentence.
 * - A λ and an rxm view built new, and the TM view kept where it showed the program: the reset closes the first two,
 *   which its tree does not hold, and their toggles build others under their ids.
 * - The focus in the λ view, on its first control, and `lambda-0` as the workspace's focused view. The reset alone
 *   leaves both on the TM view.
 * - The window resized twice, to 320 px wide and back (`showFourViews`).
 */
export async function resetToFourViews(): Promise<void> {
  document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
  await showFourViews()
}

/**
 * `resetToFourViews`' second half, for a file that performs the reset itself: the λ and the rxm toggle pressed where
 * they are not, and the focus in the λ view.
 *
 * **THE TOGGLES ARE PRESSED IN A WINDOW TALLER THAN IT IS WIDE, WHICH IS THEN PUT BACK.** A combination's first visit
 * shows its default, and the default of all four in a wide window is two COLUMNS of two (`layout.ts`'s
 * `defaultArrangement`); in a tall one it is two rows of two, which is `fourViews()`, the tree these files measure.
 * The arrangement is remembered once it is on screen, so the window's size afterwards does not change it. The toggles
 * are in the workspace menu in a window this narrow, and `.click()` reaches them there all the same.
 *
 * **IT THROWS UNLESS THE PAGE ENDS ON `fourViews()`**, naming the arrangement it found, read off the page: a
 * combination visited before shows the arrangement it remembers and not its default, so on a page that remembers one
 * for a combination the toggles pass through, the presses end on some other tree. The tall window alone does not
 * hold that, and a miss would go on to the caller as four views in another tree. *Reset preset* first forgets them
 * all, which is what `resetToFourViews` does. **IN STAGE THE PAGE DRAWS NO TREE**, and what is held there is the
 * tabs' order.
 *
 * **NOTHING HERE WAITS AFTER THE SECOND RESIZE, AND NOTHING WAS SEEN TO ARRIVE LATE.** `page.viewport` resolves a
 * frame after the tester's frame is resized (Vitest 4.1.12's `setIframeViewport`), and the app's `ResizeObserver`s
 * and its narrow-window listener had run by then, in the probe that
 * `docs/superpowers/notes/2026-10-17-code-history-web-tests.md`'s entry above `showFourViews` gives.
 *
 * **THE FOCUS ENDS IN THE λ VIEW**, on its first control: several files' cases start from "the λ view is the focused
 * view".
 */
export async function showFourViews(): Promise<void> {
  const { page } = await import('vitest/browser')
  const [width, height] = [window.innerWidth, window.innerHeight]
  // 320 × 1400, NOT THE RUNNER'S 414 × 896: with the inspector stacked under the views, as Debugger and Stage have
  // it in a narrow window, the views area there is about as wide as it is tall, and the default built would be a
  // wide one.
  await page.viewport(320, 1400)
  const area = (document.querySelector('#views') as HTMLElement).getBoundingClientRect()
  if (area.height <= area.width)
    throw new Error(`the views area is not taller than wide: ${area.width} × ${area.height}`)
  for (const kind of ['lambda', 'rxm'])
    document
      .querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"][aria-pressed="false"]`)
      ?.click()
  await page.viewport(width, height)
  const [found, wanted] = [drawn(), described(fourViews(), document.querySelector('#views [role="tab"]') !== null)]
  if (found !== wanted) throw new Error(`showFourViews left the page on ${found}, and not on ${wanted}`)
  // IN STAGE THE λ VIEW IS A TAB UNTIL IT IS SELECTED, and only a view on the page can take the focus.
  document.querySelector<HTMLElement>('#views [role="tab"][data-leaf="lambda-0"]')?.click()
  document
    .querySelector<HTMLElement>(
      '#views [data-leaf="lambda-0"] button:not([disabled]):not([hidden]), #views [data-leaf="lambda-0"] select, #views [data-leaf="lambda-0"] [tabindex]',
    )
    ?.focus()
}

/**
 * Put a mounted page on the views a first load shows in a wide window, the source beside the TM view, each on the
 * program: *reset preset*, which forgets every remembered arrangement too.
 *
 * **A FIXTURE, NOT A GESTURE UNDER TEST**, as `resetToFourViews` is: `.click()` and no `userEvent`. The focus ends
 * in the TM view, on its first control, where the reset puts it.
 *
 * **IT THROWS UNLESS THE PAGE ENDS ON THAT ROW**, naming what it found: in a window taller than it is wide the reset
 * builds a column, and in Stage the page draws no tree.
 */
export async function resetToFirstLoad(): Promise<void> {
  document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
  const [found, wanted] = [drawn(), 'row[50](source tm-0)']
  if (found !== wanted) throw new Error(`resetToFirstLoad left the page on ${found}, and not on ${wanted}`)
}

/**
 * Put a mounted page on all four views as a wide window's default arranges them, two columns of two with the source
 * over the rxm view and the λ over the TM view: `resetToFirstLoad`, then the rxm and the λ toggle, which is each
 * combination's first visit. `showFourViews` leaves the two ROWS these files' stored start has, which no default
 * builds in a wide window.
 *
 * **IT THROWS UNLESS THE PAGE ENDS ON THOSE COLUMNS**, as `resetToFirstLoad` does for its row.
 */
export async function showWideDefault(): Promise<void> {
  await resetToFirstLoad()
  for (const kind of ['rxm', 'lambda'])
    document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`)?.click()
  const [found, wanted] = [drawn(), 'row[50](column[50](source rxm-0) column[50](lambda-0 tm-0))']
  if (found !== wanted) throw new Error(`showWideDefault left the page on ${found}, and not on ${wanted}`)
}

/**
 * The events of a pane built by hand: every transport control a `vi.fn()` that does nothing, a speed of 8, and
 * `over`'s members on top.
 */
export const inertEvents = (over: Partial<PaneEvents> = {}): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  toNewest: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
  ...over,
})

/**
 * `PaneEvents`'s members, all inert — no test that calls this clicks a transport control. Unlike `inertEvents`, it
 * takes no `over`.
 */
export const paneEvents = (): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  toNewest: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
})

/** A new `section.pane` at the end of `<body>`, to build a pane in by hand. */
export const newPaneHost = (): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane'
  document.body.append(el)
  return el
}

/**
 * A real drag: a press at the middle of `handle`'s empty part and a release `dy` pixels down from it (up, for a
 * negative `dy`), measured against the host so the driver has one element to aim both ends at. `vitest/browser` is
 * imported when it is called, as `chooseSetting` says why.
 */
export async function drag(host: HTMLElement, handle: HTMLElement, dy: number): Promise<void> {
  const { userEvent } = await import('vitest/browser')
  const [h, area] = [handle.getBoundingClientRect(), host.getBoundingClientRect()]
  const x = h.left - area.left + h.width / 2
  const y = h.top - area.top + h.height / 2
  await userEvent.dragAndDrop(host, host, { sourcePosition: { x, y }, targetPosition: { x, y: y + dy } })
  await new Promise<void>((r) => requestAnimationFrame(() => r()))
}

/**
 * A transport strip's state for a pane rendered by hand: restart enabled, back, forward, to-newest and play as
 * `canBack`, `canForward`, `canToNewest` and `canPlay` (the last three enabled unless passed `false`), nothing
 * playing, no continue button, and `stepText` on the step line, which it also reads at the newest step.
 */
export const controlState = (
  canBack: boolean,
  stepText: string,
  canForward = true,
  canToNewest = true,
  canPlay = true,
): ControlState => ({
  canRestart: true,
  canBack,
  canForward,
  canToNewest,
  canPlay,
  recording: false,
  playing: false,
  stepText,
  stepTextAtNewest: stepText,
  continueLabel: null,
})

/** A leg as `controls.ts`'s `controlState` reads it: available, on its one recorded step, recording, unless `over` differs. */
export const legView = (over: Partial<LegView> = {}): LegView => ({
  available: true,
  reason: '',
  head: 0,
  length: 1,
  oldestStep: 0,
  currentStep: 0,
  newestStep: 0,
  evicted: false,
  done: null,
  awaitingRun: false,
  playing: false,
  pending: null,
  rewinding: false,
  ...over,
})

/**
 * Whether a press on `b` will act: it is there, enabled, and not waiting on a recording, which `step-controls.ts` marks
 * by `aria-disabled` alone on a button it leaves enabled, and whose press it drops.
 */
export const pressable = (b: HTMLButtonElement | null | undefined): boolean =>
  b !== null && b !== undefined && !b.disabled && b.getAttribute('aria-disabled') !== 'true'

/** What the results line says. */
export const resultsText = () => document.querySelector('#results')?.textContent ?? ''

/** `#results` idle, on its state alone: unlike `idle`, it does not ask for text in it. */
export const stateIdle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

/** The source compile's own "finished" flag: `#results` idle, with something in it. */
export const idle = () => stateIdle() && resultsText() !== ''

/** The same invariant argument as `app.test.ts`'s `settled` applies — see its doc there. */
export async function settled(v: EditorView, src: string): Promise<void> {
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: src } })
  await until(idle, `the app to settle on \`${src}\``)
}

/** The results line, `#results`. */
export const results = () => document.querySelector<HTMLElement>('#results') as HTMLElement

/** Whether `results`' `data-state` is `idle`: `stateIdle`'s question, asked through `results`. */
export const resultsIdle = () => results().dataset.state === 'idle'

/**
 * Put `src` in the editor and wait for its compile to finish recording. It waits on `#results`'s state alone, not on
 * `idle`, which also asks for text in it.
 */
export async function compile(view: EditorView, src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(() => !stateIdle(), 'the compile to start')
  await until(stateIdle, 'the compile to finish')
}

/**
 * A 640 px wide `section` of classes `pane` and `fixture` at the end of `<body>`, for a view a file builds directly;
 * each file names its own `fixture` class.
 */
export const fixtureHost = (fixture: string): HTMLElement => {
  const el = document.createElement('section')
  el.className = `pane ${fixture}`
  el.style.width = '640px'
  document.body.append(el)
  return el
}

/**
 * Whether `v` is in vim's NORMAL mode, asked of the DOM rather than of the package.
 *
 * `@replit/codemirror-vim`'s plugin puts `cm-vimMode` on the scroller whenever vim is installed and
 * not in insert mode, and removes it in `destroy()` — so this one class answers "is vim here" and
 * "which mode is it in" together, and it answers them about the element the user is looking at.
 */
export const inNormalMode = (v: EditorView): boolean => v.scrollDOM.classList.contains('cm-vimMode')

/**
 * A press with the pointer on the one element `sel` names, which throws where there is none. `vitest/browser` is
 * imported when it is called, as `chooseSetting` says why.
 */
export const press = async (sel: string): Promise<void> => {
  const el = document.querySelector<HTMLElement>(sel)
  if (el === null) throw new Error(`nothing to press at ${sel}`)
  const { userEvent } = await import('vitest/browser')
  await userEvent.click(el)
}

/** The menu `button` controls, thrown where it controls none. */
export const menuOf = (button: HTMLButtonElement): HTMLElement => {
  const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
  if (menu === null) throw new Error('the button controls no menu')
  return menu
}

/** The menu `button` controls, by its `aria-controls`; unlike `menuOf`, it does not throw where there is none. */
export const controlledMenu = (button: HTMLElement): HTMLElement =>
  document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement

/** The button `#id`. */
export const buttonOf = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`) as HTMLButtonElement

/** The menu the button `#id` controls, as `controlledMenu` finds it. */
export const menuOfId = (id: string): HTMLElement => controlledMenu(buttonOf(id))

/** Put the workspace on `preset`, by the menu's own buttons. */
export const presetOf = (preset: string): void => {
  buttonOf('workspace').click()
  menuOfId('workspace').querySelector<HTMLButtonElement>(`[data-preset="${preset}"]`)?.click()
  if (menuOfId('workspace').matches(':popover-open')) menuOfId('workspace').hidePopover()
}

/** `pane`'s `⋯` button. */
export const moreOf = (pane: HTMLElement) =>
  pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement

/**
 * Open `pane`'s `⋯` menu with the pointer and pick `cls`'s item with it, as a user does. It finds the menu through
 * `moreOf` and `menuOf`. `vitest/browser` is imported when it is called, as `chooseSetting` says why.
 */
export async function pick(pane: HTMLElement, cls: string): Promise<void> {
  const { userEvent } = await import('vitest/browser')
  await userEvent.click(moreOf(pane))
  await until(() => menuOf(moreOf(pane)).matches(':popover-open'), 'the view menu to open')
  const item = menuOf(moreOf(pane)).querySelector<HTMLButtonElement>(`button.${cls}`)
  if (item === null) throw new Error(`the menu offers no ${cls}`)
  await userEvent.click(item)
}

/** The `⋯` menu of `pane`, thrown where `pane` has no `⋯` or it controls no menu. */
export const viewMenu = (pane: HTMLElement): HTMLElement => {
  const more = pane.querySelector<HTMLButtonElement>('button.view-more')
  const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
  if (more === null || menu === null) throw new Error('no view menu')
  return menu
}

export { until }

/**
 * Read `read()` in every frame until `stop`. **IN A `ResizeObserver`'S CALLBACK**, which runs after every
 * `requestAnimationFrame` callback of the frame and its layout, and before its paint: a frame's own callback runs
 * before the page's draws for that frame, so it would read what the frame before painted, and miss a state the page
 * drew in one frame and replaced before the next. A box whose width flips each frame makes the observer call back.
 */
export function everyFrame<T>(read: () => T): { readonly seen: T[]; readonly ticks: () => number; stop(): void } {
  const seen: T[] = []
  const flip = document.createElement('div')
  flip.style.cssText = 'position: fixed; left: 0; top: 0; height: 1px; width: 1px; pointer-events: none'
  document.body.append(flip)
  let ticks = 0
  let on = true
  const observer = new ResizeObserver(() => {
    if (on) seen.push(read())
  })
  observer.observe(flip)
  const tick = () => {
    if (!on) return
    ticks += 1
    flip.style.width = `${1 + (ticks % 2)}px`
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  return {
    seen,
    ticks: () => ticks,
    stop: () => {
      on = false
      observer.disconnect()
      flip.remove()
    },
  }
}
