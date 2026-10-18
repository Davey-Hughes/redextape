import type { EditorView } from '@codemirror/view'
import { expect, vi } from 'vitest'
import html from '../../index.html?raw'
import type { ControlState } from '../../src/controls'
import type { LambdaBody } from '../../src/lambda-body'
import { insertBeside, LAYOUT_STORAGE_KEY, type LayoutNode, leaves } from '../../src/layout'
import type { PaneEvents } from '../../src/pane-chrome'
import type { PaneKind } from '../../src/panes'
import { PREPAINT } from '../../src/prepaint'
import { defaultWorkspace, parseWorkspace, serializeWorkspace, type Workspace } from '../../src/workspace'

/**
 * Shared browser-tier fixtures: the app shell every test file mounts into, and the poll helper every test
 * file waits on; for the tests of what a reload draws first, the page's own pre-paint script, the palette
 * picked from the settings menu, and a colour as `getComputedStyle` writes it; and the other helpers the
 * test files share. The shell and the poll helper were duplicated — `SHELL` 29 times, `until` 23 times in 7
 * different bodies — the reload's helpers twice, and `rgb` four times, until this file replaced them.
 *
 * **WHY THIS DOES NOT BREAK THE DIRECTORY'S STANDING IDIOM.** Files in this directory have long carried
 * a comment saying that each browser test file gets its own page — `main()` runs once per module load
 * and Vitest gives each test file its own page — and concluding from it that duplicating a mount
 * helper is right, because "a shared mount would be a shared page two files could not both own". The
 * premise is a fact about the test runner and it holds; the conclusion is about a MOUNT. `SHELL` is an
 * inert template string and `until` closes over nothing, so importing either into two files shares no
 * page, no state and no mount. `setup.ts` already demonstrates a shared non-test module being loaded
 * once per page without sharing anything across pages. `mountApp` deliberately stays per-file: four
 * files declare one, all four bodies differ, and each owns its own page.
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
    <span class="wordmark">redextape</span>
    <button type="button" id="workspace" aria-haspopup="menu" aria-controls="workspace-menu" aria-expanded="false">Explorer <span aria-hidden="true">▾</span></button>
    <div id="workspace-menu" class="header-menu" popover>
      <button type="button" id="reset-preset">reset preset — restores the default views</button>
    </div>
    <div id="views-shown" class="views-shown" role="group" aria-label="views">
      <button type="button" class="view-toggle" data-shows="source" aria-pressed="false">source</button>
      <button type="button" class="view-toggle" data-shows="asm" aria-pressed="false">asm</button>
      <button type="button" class="view-toggle" data-shows="lambda" aria-pressed="false">λ</button>
      <button type="button" class="view-toggle" data-shows="tm" aria-pressed="false">TM</button>
    </div>
    <button type="button" id="new-view" aria-haspopup="menu" aria-controls="new-view-menu" aria-expanded="false">+ view</button>
    <div id="new-view-menu" class="header-menu" popover></div>
    <button type="button" id="buffers">copies <span aria-hidden="true">▾</span></button>
    <button type="button" id="examples" aria-haspopup="menu" aria-controls="examples-menu" aria-expanded="false">examples <span aria-hidden="true">▾</span></button>
    <div id="examples-menu" class="header-menu" popover></div>
    <label class="encoding">
      encoding
      <select id="encoding"></select>
    </label>
    <span class="bar-spacer"></span>
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
        <label class="skin"><input type="checkbox" id="format-on-blur" /> format on blur</label>
        <button type="button" id="import-base16">import base16…</button>
    </div>
  </header>
  <div id="notice" class="notice" hidden></div>
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

/** Longest predicate source a failure message will quote before it starts eliding. */
const MAX_SOURCE_CHARS = 120

const sourceOf = (predicate: () => boolean): string => {
  const src = predicate.toString().replace(/\s+/g, ' ').trim()
  return `\`${src.length > MAX_SOURCE_CHARS ? `${src.slice(0, MAX_SOURCE_CHARS)}…` : src}\``
}

/**
 * Poll `predicate` until it holds, or throw naming what never happened.
 *
 * **THE PREDICATE IS EVALUATED BEFORE THE FIRST SLEEP**, so `until(() => true)` waits for nothing. Every
 * one of the seven bodies this replaced had that property and several call sites rely on it.
 *
 * **AND AFTER EVERY SLEEP IT IS EVALUATED BEFORE THE DEADLINE IS CHECKED**, so a state that arrived during a
 * sleep resolves the wait even when that sleep ended past `timeoutMs`. A page whose main thread is held runs
 * no timer, and the first poll after it can come seconds past the deadline: at `CPUQuota=25%`, while `History`
 * moved every frame it kept at each eviction, *keep recording* in `readout-history-full.test.ts` and
 * `readout-history-held.test.ts` each ran one wait for 10.8 to 13.5 s, its last poll after a gap of 7.2 to
 * 12.9 s, and both passed because the recording had stopped by that poll. Checked the other way round, they
 * would have thrown on a state that had arrived. Those two waits took 991 to 2,204 ms there once it stopped,
 * in three interleaved runs each (each file's own comment). The first of `tm-scratch-fork.test.ts`'s two waits for
 * the source run after a fork passed on this order too, at 7,106 to 11,407 ms in three runs at `CPUQuota=25%` and
 * load averages of 11.60 to 56.53 (2026-10-06). On a quiet machine it fits: at that quota it took 4,405 to 4,902 ms
 * in three runs at load averages of 1.52 to 1.68, and 1,001 to 2,399 ms in three taken in turn with them, at 1.38 to
 * 2.13, once a TM frame's tapes crossed from the worker as one string each (2026-10-07; that file's comment). Whether it still passes
 * on this order under load was not measured. `tests/node/harness.test.ts` holds the order.
 *
 * **THE DEFAULT IS BOUNDED BELOW VITEST'S OWN, WHICH IS THE ENTIRE REASON IT IS ONE NUMBER.** Browser
 * mode raises `testTimeout` to 15,000 ms and `hookTimeout` to 30,000 — both measured against this
 * project's own config, which sets neither — so a wait bounded at or above the harness's own lets Vitest
 * kill the test first and report `Test timed out in 15000ms.` with no name for what never arrived. Twelve
 * files shipped a default above the bound and eleven call sites shipped `60_000`, none of which could
 * ever fire. 10,000 clears both bounds. **That property is per WAIT, not per test.** Vitest's bound
 * covers a test as a whole, so one wait can reach this ceiling and still print its own name while two
 * in the same test cannot. This paragraph once added that no wait in this tier exceeded 2,000 ms. On
 * 2026-09-19 an unconstrained run of the whole tier, with every wait's time logged, put the slowest at
 * 2,227 ms: a spinner's first recording in `tm-reduced-buffer.test.ts`, whose supersession test waited
 * on three recordings in one body, and on the slower of the two CI runners Vitest's cap fired in that
 * test with no name, twice. That file now gives each such wait a hook or a body of its own.
 *
 * **DO NOT PASS `timeoutMs` FROM A CALL SITE.** `tests/node/browser-timeout-invariants.test.ts` fails if
 * any call site under `tests/browser/` passes a numeric timeout. A wait that genuinely needs longer is a
 * reason to change this default and say why in the commit, not to add a number nothing re-checks.
 *
 * **THE REAL CEILING IS `timeoutMs + pollMs`, NOT `timeoutMs` ALONE**, because the throw only fires once
 * a sleep returns and finds the predicate still false. At today's defaults that is 10,000 + 20 = 10,020
 * ms, comfortably under both vitest bounds — but the gate above reads only `timeoutMs`; nothing checks
 * `pollMs`. A future `pollMs` raised high enough reintroduces the exact defect this file exists to close,
 * with the gate reporting green throughout, because it was never asked about the parameter that moved.
 *
 * **`pollMs` EXISTS FOR THE NODE-TIER UNIT TESTS IN `tests/node/harness.test.ts`, AND MUST NOT BE PASSED
 * FROM THE BROWSER TIER.** Shortening the poll interval there is what lets a unit test built around a
 * fake predicate finish in milliseconds instead of waiting out a real one; no file under `tests/browser/`
 * has a reason to pass it. The gate's own boundary does not distinguish which parameter a call site's
 * argument lands in, so a browser call passing only `pollMs` numerically is still rejected — with a
 * message reading "passes a numeric timeout", which is true of the ceiling this file protects and not of
 * which of the two parameters actually carried the number.
 */
export async function until(predicate: () => boolean, what?: string, timeoutMs = 10_000, pollMs = 20): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what ?? sourceOf(predicate)}`)
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

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

/** The clicks the last part of a walk may make before it waits: the bound the walks had as one loop. */
const WALK_BOUND = 20_000

/**
 * **A LONG WALK IN PARTS, EACH TO BE A HOOK OF ITS OWN.** A walk of many clicks is as slow as the machine it runs on:
 * each click is a step and a whole redraw, synchronously, and nothing in a test can make it faster. As one hook, the
 * 1,732 clicks from step 0 into `cmpeq` that three files make ran past Vitest's 30 s on the slower CI runner, in two of
 * the three files in one run (2026-10-06); the same runner had passed both 48 minutes before, the files at 60 s and
 * 31 s. A hook's cap is its own, so the walk is cut into parts and each part is registered as a hook: `for (const part
 * of walkInParts(...)) beforeAll(part)`. Hooks of one suite run in the order they are registered, one after another.
 *
 * **EACH PART CLICKS UP TO ITS SHARE, OR UNTIL THE WALK HAS ARRIVED, AND THEN CHECKS ITS OWN WORK**: the page's step
 * count has moved by exactly the clicks it made, and it made some unless the walk had arrived. A part whose clicks did
 * nothing fails there, by its number and with its figures, and not as a later hook's timeout. `shares` gives the clicks
 * of every part but the last; the last walks until the walk has arrived, to the bound the walks had as one loop, and
 * then waits for it as they did (`until`), so the machine ends where it did.
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
 * A walk of a TM view by its own controls, as `state-diagram.test.ts`, `state-diagram-local.test.ts` and
 * `tm-pointer.test.ts` each read them: ▶ and ↺ among the view's `.controls` by their text, the state's name at the
 * start of its status line, and the step in its strip's `step N of M`. The walk ends at the first state whose status
 * matches `arrived`; `restart` starts it from ↺, the oldest kept step.
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
        (/^step ([\d,]+)/.exec(pane().querySelector('.view-steps .step')?.textContent ?? '')?.[1] ?? '').replaceAll(
          ',',
          '',
        ),
      ),
  }
}

/**
 * **`fact(3)` FROM STEP 0 INTO `cmpeq`, IN THREE PARTS**: 1,732 steps forward to the first step inside `cmpeq`, the
 * first instruction whose gadget has named sub-steps, where stepping back from the frontier took about 9,000. The
 * first two parts click 578 times each and the third the 576 left.
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

/** The milliseconds from posting `payload` on a `MessageChannel` to its arrival at the other port: its structured clone. */
export const cloneMs = (payload: unknown) =>
  new Promise<number>((resolve) => {
    const ch = new MessageChannel()
    const start = performance.now()
    ch.port2.onmessage = () => resolve(performance.now() - start)
    ch.port1.postMessage(payload)
  })

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
 * the Stage a selector without `:not([role="tab"])` answers the tab, for the view that is shown as for the others
 * (read off the page, 2026-10-12): six of the files the view layouts added spelled it without, three as `host` and
 * three inside a `box`. None of them enters the Stage, so none read a tab; they use this now. A tab contains no
 * controls, so a `contains(document.activeElement)` against it reads false no matter where the focus is.
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

/** A view's *move the editor here*, which its menu holds only while it is offered. */
export const claim = (leaf: string): HTMLButtonElement | null =>
  host(leaf)?.querySelector<HTMLButtonElement>('button.claim-editor') ?? null

/** The copy editors a view's host holds, on the page or off it. */
export const termEditorsIn = (host: HTMLElement | null): number =>
  host?.querySelectorAll('.term-editor .cm-editor').length ?? 0

/** The copy editors the view `id`'s host holds, counted by `termEditorsIn`. */
export const editorsOf = (id: string): number => termEditorsIn(host(id))

/** The CodeMirror editors under the elements whose `data-leaf` is `leaf`, counted. */
export const editorsInLeaf = (leaf: string) => document.querySelectorAll(`[data-leaf="${leaf}"] .cm-editor`).length

/** The layout the λ view `lambda-0`'s term is drawn in, its `data-layout`. */
export const lambdaLayout = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term')?.dataset.layout

/** The text of the λ view `lambda-0`'s step readout, or `''` where it shows none. */
export const lambdaStepText = () => stepTextOf('lambda-0')

/** The λ view `lambda-0`'s term, or `null` where it shows none. */
export const lambdaTerm = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term')

/** The text of the λ view `lambda-0`'s term, or `''` where it shows none. */
export const lambdaTermText = () => document.querySelector('[data-leaf="lambda-0"] .term')?.textContent ?? ''

/** The text of the view `leaf`'s term, or `''` where it shows none. */
export const termOf = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .term`)?.textContent ?? ''

/** The text of the λ view `lambda-0`'s `h2`, or `''` where it has none. */
export const lambdaHeading = () => document.querySelector('[data-leaf="lambda-0"] h2')?.textContent ?? ''

/** The λ view `lambda-0`'s `button.detach`, or `null` where it has none. */
export const forkButton = () => document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')

/** Click the λ view `lambda-0`'s control labelled `label`; nothing happens where it has none. */
export const lambdaControl = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')]
    .find((b) => b.textContent === label)
    ?.click()

/** Click the λ view `lambda-0`'s control labelled `label`; it throws where it has none. */
export const clickLambda = (label: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')].find(
    (x) => x.textContent === label,
  )
  if (b === undefined) throw new Error(`no \`${label}\` button in the λ pane`)
  b.click()
}

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

/**
 * `#results` READS THE FOCUSED VIEW'S SESSION (Plan 7 part 2 spec §9), so a read of the PROGRAM'S result
 * after a copy's view took the focus puts the focus on the program first.
 */
export const focusProgram = () => document.querySelector<HTMLElement>('[data-leaf="source"] .cm-content')?.focus()

/** The box that scrolls a long program: the source editor's own, in the share of its view it has (spec §11.1). */
export const sourceScroller = (): HTMLElement => sourcePane().querySelector('.cm-scroller') as HTMLElement

/** The λ view `lambda-0`'s host. */
export const lambdaHost = (): HTMLElement => host('lambda-0') as HTMLElement

/** The λ view `lambda-0`'s pane, `.pane[data-leaf="lambda-0"]`. */
export const lambdaPane = (): HTMLElement =>
  document.querySelector<HTMLElement>('.pane[data-leaf="lambda-0"]') as HTMLElement

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
 * The ids of every λ pane — by `data-kind`, NOT by an `id` prefix. `nextLeafId` now mints `pane-${n}`
 * regardless of which leg the split came from (`main.ts`'s own doc on `nextLeafId`: a pane can change
 * which leg it renders, so an id like `lambda-3` would describe something the pane is not), so
 * `dataset.kind` is the only truthful statement of what a leaf renders left to select on. This matters
 * MORE in `layout-restore.test.ts` than in its siblings: its `STORED` deliberately seeds a leaf spelled the OLD way
 * (`lambda-1`), so an id-prefix filter would still find it by luck while silently missing a freshly
 * split leaf spelled the new way (`pane-N`) — the exact mismatch that file exists to restore correctly.
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

/** The asm view `asm-0`'s pane. */
export const asmPane = () => paneByLeaf('asm-0')

/** The text of the asm view's value readout, or `''` where it shows none. */
export const asmValue = () => asmPane().querySelector('.asm-value')?.textContent ?? ''

/** The text of `pane`'s step readout, or `''` where it shows none. */
export const paneStepText = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''

/** The control labelled `label` among `pane`'s controls, or `undefined` where there is none. */
export const controlIn = (pane: HTMLElement, label: string) =>
  [...pane.querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)

/** Whether `pane` says it shows a copy that is not linked. */
export const copyShown = (pane: HTMLElement) => /copy · not linked/.test(pane.textContent ?? '')

/** The TM view `tm-0`'s host. */
export const tmViewHost = (): HTMLElement => host('tm-0') as HTMLElement

/** The state table under the TM view `tm-0`'s `host`, where `stateTable` looks under `tmPane`. */
export const tmStateTable = (): HTMLElement => host('tm-0')?.querySelector('.state-table') as HTMLElement

/** The TM view `tm-0`'s element, `[data-leaf="tm-0"]`; unlike `tmPaneHost`, it does not throw where none is mounted. */
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
 * FILL.** As one wait it took 7,504 and 8,590 ms at `CPUQuota=25%` (2026-10-05), against `until`'s 10 s; as two, the
 * second took up to 6,900 ms. The TM leg records last, after λ and asm, and its step line reads `…` from its first
 * frames until it stops, and counts them. Called right after a dispatch, which withdraws the stop before and drops the
 * line's `…` (`compile.ts`'s `schedule`, `controls.ts`): the first two assertions hold both, so no wait can pass on the
 * run before, and the third holds that the line the second wait counts is this run's.
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
 * notice offers one, which is what one file read.
 */
export const notice = (): string => (document.querySelector('#notice .notice-text')?.textContent ?? '').trim()

/** What the live region says, without the space a sentence said twice is written with (`notice.ts`'s `createNotices`). */
export const live = (): string => (document.querySelector('#live')?.textContent ?? '').trim()

/** What the live region says, as it is written: unlike `live`, not trimmed. */
export const liveText = () => document.querySelector('#live')?.textContent ?? ''

/** The notice, `#notice`. */
export const noticeEl = (): HTMLElement => document.querySelector<HTMLElement>('#notice') as HTMLElement

/** The notice's text, as it is written: unlike `notice`, not trimmed. */
export const noticeElText = () => noticeEl().querySelector('.notice-text')?.textContent ?? ''

/** What the notice line says, or `''` while it says nothing: unlike `notice`, not trimmed. */
export const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''

/** The notice line's text — where a refusal is said since Plan 7 part 2 (spec §11) — or `''` while it is hidden. */
export const shownNoticeText = () => {
  const notice = document.querySelector<HTMLElement>('#notice')
  return notice === null || notice.hidden ? '' : (notice.querySelector('.notice-text')?.textContent ?? '')
}

/** The notice line's action button, or `null` where the notice offers none. */
export const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')

/** The encoding picker, `#encoding`. */
export const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement

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

/** Replace `v`'s text and wait past the edit debounce, which is what posts `didChange`. */
export function retype(v: EditorView, text: string): void {
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
}

/** `v`'s document, as a string. */
export const text = (v: EditorView): string => v.state.doc.toString()

/**
 * Error markers inside ONE pane's editor, so a source-editor marker cannot be mistaken for a copy's — the settle
 * signal for "this pane's edit reached the server".
 */
export const markersIn = (pane: HTMLElement) => pane.querySelectorAll('.cm-editor .cm-lintRange-error').length

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
 * A view has ONE menu now, where a pane used to carry a picker per split control, so the scoped query
 * would find the right element too — but `aria-controls` is the relationship `view-header.ts`'s `viewMenu`
 * builds `⋯` for, and going through it means a header that ever stopped naming its own menu fails this helper
 * loudly (the `item == null` throw below) instead of every split here quietly turning into a no-op.
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
 * Split `leaf` through `control` into a second pane of the same kind on the same session — the gesture
 * every test in `two-lambda-panes.test.ts` reached with a single `btn(leaf, 'split …')?.click()`.
 *
 * **A SPLIT IS TWO CLICKS NOW, AND THE FIRST MENU ENTRY IS WHY IT IS STILL ONE GESTURE.** The control
 * opens a picker (`view-header.ts`'s `viewMenu`), whose first item is the pane's own `(leg, session)`
 * pair labelled "another view of this" — put there precisely so the case that WAS the whole gesture stays one click
 * away. That is what keeps every test that calls it testing what it always tested: the same pane, duplicated,
 * on the same session, which is how `two-lambda-panes.test.ts` reaches two λ panes on one scratch without a rebind.
 *
 * THE MENU IS REACHED THROUGH `aria-controls`, AND THE LABEL IS CHECKED. A pane has two pickers and each
 * keeps the entries it was last opened with, so `[data-leaf] .view-menu button` could click an item in
 * a popover that is not open; and a missing entry clicked through `?.` is a silent no-op that would
 * leave every assertion after it describing a page nothing happened on.
 */
export const splitSame = (leaf: string, dir: 'row' | 'column'): void => splitVia(leaf, dir, 'same')

/**
 * Split `leaf` into a second pane of the same kind on the same session — the gesture every test in
 * `layout-app.test.ts` used to reach with one click on the control its `splitRowOn` finds.
 *
 * **A SPLIT IS TWO CLICKS NOW, AND THE FIRST ENTRY IS WHY IT IS STILL ONE GESTURE.** The control opens a
 * picker (`view-header.ts`'s `viewMenu`), whose first item is the pane's own `(leg, session)` pair
 * labelled "another view of this" — put there precisely so the case that WAS the whole gesture stays one click away.
 * The label is checked rather than assumed: `find(...)?.click()` on a missing entry is a silent no-op,
 * and taking the first item of a menu that had reordered would quietly make every test that calls it a test of a
 * different split. `pane-picker.test.ts` is where the other entries are exercised.
 */
export const splitRow = (leaf: string): void => splitVia(leaf, 'row', 'same')

/** The title-selector of `leaf`'s view — the pair in force is its `data-binding`. */
export const titleOf = (leaf: string) =>
  document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-title`)

/** The title-selector of the λ view `lambda-0`, as `titleOf` finds it. */
export const lambdaTitle = () => titleOf('lambda-0')

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
 * The next `scroll` event on `el`, once a listener registered before it, as `VirtualGrid`'s is in its constructor,
 * has run. **AWAITED RATHER THAN COUNTING FRAMES**: a scroll's event came later than two frames when
 * `virtual-grid.test.ts` ran whole, so an assertion after two frames could run before the event it was about, and
 * pass whatever the handler would have done.
 */
export const scrolled = (el: HTMLElement) =>
  new Promise<void>((r) => el.addEventListener('scroll', () => r(), { once: true }))

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

/** The *λ · program* item of the `+ view` menu, or `undefined` where the menu holds none. */
export const newLambdaViewItem = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('#new-view-menu button')].find(
    (b) => b.textContent === 'λ · program',
  )

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

/** `+ view` pressed `presses` times in a row: each adds a λ view beside the view the last one added and focused. */
export const pressedLayout = (presses: number): LayoutNode => {
  let tree = fourViews()
  let focused = 'lambda-0'
  for (let k = 1; k <= presses; k++) {
    tree = insertBeside(tree, focused, 'row', `pane-${k}`, 'lambda')
    focused = `pane-${k}`
  }
  return tree
}

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
 * All four views in two rows of two: source and λ over asm and TM. A fresh page built this tree until the view
 * layouts, and most files here were written against it; `layout.ts`'s `defaultLayout()` is the source beside the TM
 * view now. A file that wants four views says so with this, where it used to say `defaultLayout()`.
 *
 * **SPELLED OUT, NOT TAKEN FROM `defaultArrangement`**: all four views' default there is two COLUMNS of two now, with
 * the same views in the same corners, and what these files measure is this tree — its row dividers, its paths, and
 * the order its leaves come in.
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
        { kind: 'leaf', id: 'asm-0', pane: 'asm' },
        { kind: 'leaf', id: 'tm-0', pane: 'tm' },
      ],
    },
  ],
})

/**
 * The workspace a four-view page stored: `fourViews()`, Explorer, the focus on the λ view, nothing remembered. It is
 * what `defaultWorkspace()` answered until the view layouts, and what `setup.ts` stores for every file.
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
 * `column[50](row[50](source lambda-0) row[50](asm-0 tm-0))`. In Stage it is the tabs in their order, which is all the
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
 * **A FIXTURE, NOT A GESTURE UNDER TEST**: files that reset between cases did it with *reset preset* alone while that
 * restored four views. `.click()` and no `userEvent`, as those files' own reset was.
 *
 * **THE PAGE IT LEAVES IS NOT THE ONE *RESET PRESET* ALONE LEFT WHILE THAT GAVE FOUR VIEWS.** What it adds to a
 * reset, each held by `four-views-fixture.test.ts`:
 *
 * - Two arrangements remembered in the stored workspace, the two the toggles pass through: the source beside the TM
 *   view, and those two with the λ view. The reset alone remembers none.
 * - The live region on `showing source, asm, λ and TM`, the last switch's sentence.
 * - A λ and an asm view built new, and the TM view kept where it showed the program: the reset closes the first two,
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
 * `resetToFourViews`' second half, for a file that performs the reset itself: the λ and the asm toggle pressed where
 * they are not, and the focus in the λ view.
 *
 * **THE TOGGLES ARE PRESSED IN A WINDOW TALLER THAN IT IS WIDE, WHICH IS THEN PUT BACK.** A combination's first visit
 * shows its default, and the default of all four in a wide window is two COLUMNS of two (`layout.ts`'s
 * `defaultArrangement`, the user's decision of 2026-10-11); in a tall one it is two rows of two, which is
 * `fourViews()`, the tree these files measure. The arrangement is remembered once it is on screen, so the window's
 * size afterwards does not change it. The toggles are hidden in a window this narrow and `.click()` reaches them
 * all the same.
 *
 * **IT THROWS UNLESS THE PAGE ENDS ON `fourViews()`**, naming the arrangement it found, read off the page: a
 * combination visited before shows the arrangement it remembers and not its default, so on a page that remembers one
 * for a combination the toggles pass through, the presses end on some other tree. It asserted the tall window it
 * needs and not what came of it, and a miss went on to the caller as four views in another tree. *Reset preset*
 * first forgets them all, which is what `resetToFourViews` does. **IN STAGE THE PAGE DRAWS NO TREE**, and what is
 * held there is the tabs' order.
 *
 * **NOTHING HERE WAITS AFTER THE SECOND RESIZE, AND NOTHING WAS SEEN TO ARRIVE LATE.** `page.viewport` resolves a
 * frame after the tester's frame is resized (Vitest 4.1.10's `setIframeViewport`), and the app's `ResizeObserver`s
 * and its narrow-window listener had run by then: a probe read the views area's and the rule table's observed sizes,
 * the toggles' `hidden`, the rule table's rows and the term's lines as `resetToFourViews` returned, two frames later
 * and 200 ms after that, and the three readings agreed in 40 rounds of 40, and in 40 of 40 at `CPUQuota=50%`
 * (2026-10-12).
 *
 * **THE FOCUS ENDS IN THE λ VIEW**, on its first control, where *reset preset* put it while λ was the first view of
 * the default: several files' cases start from "the λ view is the focused view", and `+ view` adds beside it.
 */
export async function showFourViews(): Promise<void> {
  const { page } = await import('vitest/browser')
  const [width, height] = [window.innerWidth, window.innerHeight]
  // 320 × 1400, NOT THE RUNNER'S 414 × 896: with the inspector stacked under the views, as Debugger and Stage have
  // it in a narrow window, the views area there is about as wide as it is tall, and the default built was a wide one.
  await page.viewport(320, 1400)
  const area = (document.querySelector('#views') as HTMLElement).getBoundingClientRect()
  if (area.height <= area.width)
    throw new Error(`the views area is not taller than wide: ${area.width} × ${area.height}`)
  for (const kind of ['lambda', 'asm'])
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
 * over the asm view and the λ over the TM view: `resetToFirstLoad`, then the asm and the λ toggle, which is each
 * combination's first visit. `showFourViews` leaves the two ROWS these files' stored start has, which no default
 * builds in a wide window.
 *
 * **IT THROWS UNLESS THE PAGE ENDS ON THOSE COLUMNS**, as `resetToFirstLoad` does for its row.
 */
export async function showWideDefault(): Promise<void> {
  await resetToFirstLoad()
  for (const kind of ['asm', 'lambda'])
    document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`)?.click()
  const [found, wanted] = [drawn(), 'row[50](column[50](source asm-0) column[50](lambda-0 tm-0))']
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
 * gives `editSink` and `collapse` too, and takes no `over`.
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
  editSink: () => vi.fn(),
  collapse: vi.fn(),
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
 * playing, no continue button, and `stepText` on the step line.
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
  playing: false,
  stepText,
  continueLabel: null,
})

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

/** The TM view `tm-0`'s host, thrown on where none is mounted. */
export const tmPaneHost = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-leaf="tm-0"]')
  if (el === null) throw new Error('no TM pane mounted at [data-leaf="tm-0"]')
  return el
}

/**
 * Rewrite the start state's rule list to a single unconditional jump to `halt`, and hand back the
 * name that state was edited under — `tm-scratch-fork.test.ts`'s `runs the edited machine` reads it back rather
 * than hard-coding it a second time (Important 3, fix round: the assertion has to name the SAME state
 * this function edited, derived from the SAME text, or a future change to the lowering's naming could
 * silently desynchronize the two).
 *
 * **DERIVED FROM THE REAL TEXT, NOT HARD-CODED.** The state names are the lowering's (`pc0`,
 * `wl1s2.s.sk0`, …) and it is free to change them; a machine typed into this file would keep passing
 * after such a change while no longer being the machine the pane forked. This reads the `start`
 * directive out of the emitted header and edits the state it names.
 *
 * **`halt` ITSELF IS NOT DERIVED, AND THAT IS SAFE RATHER THAN A SECOND HARD-CODE — `redextape-core`'s
 * `tm/lower_tm.rs`, `tm/build.rs`, `tm/encoding/unary.rs` ALL BUILD THE ACCEPT STATE WITH THE LITERAL
 * `"halt"`.** It is the lowering's own fixed name for the machine's one accept state, not a fact this
 * function reads off the source program the way `start`'s target is — every encoding path in
 * `redextape-core` calls `b.accept("halt")`, and `crates/redextape-core/tests/fixtures/list_1_2.tm`
 * (`state halt: accept`) is a committed instance of exactly that convention.
 */
export function editedToHaltImmediately(text: string): { text: string; start: string } {
  const start = /^start (\S+)$/m.exec(text)?.[1]
  if (start === undefined) throw new Error('emitted text has no `start` directive')
  const tapes = Number(/^tapes (\d+)$/m.exec(text)?.[1])
  if (!Number.isInteger(tapes)) throw new Error('emitted text has no `tapes` directive')
  const wild = Array.from({ length: tapes }, () => '*').join(' ')
  const stay = Array.from({ length: tapes }, () => 'S').join(' ')
  const rule = `  [${wild}] -> write [${wild}], move [${stay}], goto halt`

  // Replace every rule line under `state <start>:` with the one above. A state block runs from its
  // header to the next line that is not indented.
  const lines = text.split('\n')
  const at = lines.indexOf(`state ${start}:`)
  if (at < 0) throw new Error(`no block for the start state \`${start}\``)
  let end = at + 1
  while ((lines[end] ?? '').startsWith('  ')) end++
  return { text: [...lines.slice(0, at + 1), rule, ...lines.slice(end)].join('\n'), start }
}

/**
 * Whether the δ-table's rendered rows show `state`'s own header immediately followed by exactly the
 * one rule `editedToHaltImmediately` wrote — the fact worth waiting for and asserting, in place of
 * both the vacuous `/halt/i` this replaces (Important 3: `state halt: accept` is always somewhere in
 * the δ-table, forked or not, edited or not — the reviewer measured this true before the fork and
 * before the edit alike) and plain content quiescence (Important 4: `tm-scratch-fork.test.ts`'s `typeInto` changes
 * the editor's own text synchronously, well before the 300 ms debounce ever posts a recompile, so a quiescence
 * poll can settle in the gap before the worker answers at all — polling for this fact instead is
 * immune to that race by construction, since it can only become true once the reply that recompiled
 * the edited text has actually landed and repainted).
 *
 * READS THE RENDERED TABLE, NOT THE EDITOR'S OWN TEXT. The editor shows whatever was typed the
 * instant `typeInto` runs, which proves a keystroke reached the document and nothing about whether
 * the worker ever recompiled it — `TmPane.setProgram` is the one thing that can move what this reads,
 * and it runs only from a `tm-scratch-compiled` reply.
 */
export function startStateGoesToHalt(pane: HTMLElement, start: string): boolean {
  const rows = [...pane.querySelectorAll<HTMLElement>('.state-row')]
  const at = rows.findIndex((el) => el.classList.contains('is-state') && el.textContent === start)
  const rule = at < 0 ? undefined : rows[at + 1]
  if (rule === undefined || !rule.classList.contains('is-rule')) return false
  return /→ halt$/.test(rule.textContent ?? '')
}

/**
 * Whether `v` is in vim's NORMAL mode, asked of the DOM rather than of the package.
 *
 * `@replit/codemirror-vim`'s plugin puts `cm-vimMode` on the scroller whenever vim is installed and
 * not in insert mode, and removes it in `destroy()` — so this one class answers "is vim here" and
 * "which mode is it in" together, and it answers them about the element the user is looking at.
 */
export const inNormalMode = (v: EditorView): boolean => v.scrollDOM.classList.contains('cm-vimMode')

/** The host of the scratch editor in the λ view `lambda-0`, or `null` where none is mounted. */
export const editorHost = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor')

/**
 * The header's buffers button — thrown rather than optional-chained past, the same standard
 * `tmPaneHost` sets: every caller needs the real element to act on, and a silent `null` here would
 * turn a missing mount point into a `TypeError` several lines away from where the mount actually failed.
 */
export const buffersButton = (): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>('#buffers')
  if (el === null) throw new Error('no #buffers control in the header')
  return el
}

/** The header's buffers button, or `null` where there is none: `buffersButton` throws instead. */
export const buffersControl = () => document.querySelector<HTMLButtonElement>('#buffers')

/**
 * The popover `bufferList` appends beside `#buffers` — present once `bufferList` has run at all
 * (`main.ts` constructs it unconditionally now, per this task: the button is never withheld), whether or
 * not it is currently open.
 */
export const buffersMenu = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('.buffer-list')
  if (el === null) throw new Error('no .buffer-list popover beside #buffers')
  return el
}

/**
 * Every row the list currently holds — elements rather than text, since `it('mints a warm TM
 * buffer...')` in `tm-blank-buffer.test.ts` claims only the COUNT.
 *
 * **FORCES THE LIST OPEN FIRST, THE WAY `buffer-restore.test.ts`'s OWN `openList` DOES, AND FOR THE
 * SAME REASON.** `bufferList`'s rows are built on `beforetoggle` — a closed list keeps whatever it last
 * rendered, which can predate a mint that happened while it was shut (`buffer-list.ts`'s own doc: "A
 * closed list has no state to keep fresh"). The *new TM copy* control dismisses the popover before it
 * mints (`buffer-list.ts`'s own click handler, the one gesture in that menu that still does), so every mint leaves
 * the list closed on stale rows; reading it without reopening would answer what the list showed BEFORE
 * the mint, not what it holds now.
 */
export const bufferRows = (): HTMLElement[] => {
  const button = buffersButton()
  if (button.getAttribute('aria-expanded') !== 'true') button.click()
  return [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row')]
}

/** What each row READS, which is what §5 requires an assertion about a buffer to be made against. */
export const rowNames = (): (string | null)[] =>
  [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row-name')].map((e) => e.textContent)

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

/** A `press` on the toggle in `#views-shown` that shows and hides the `kind` views. */
export const pressShownToggle = (kind: string): Promise<void> => press(`#views-shown button[data-shows="${kind}"]`)

/** The copies menu beside `#buffers`, or `null` where the page has none. */
export const copiesMenu = (): HTMLElement | null => document.querySelector<HTMLElement>('.buffer-list')

/** Press a control of the copies menu by its name, opening the menu with a press where it is shut. */
export const inCopiesMenu = async (label: string): Promise<void> => {
  if (copiesMenu()?.matches(':popover-open') !== true) await press('#buffers')
  await press(`.buffer-list button[aria-label="${label}"]`)
}

/** Close the copies menu where it is open. */
export const shutCopiesMenu = (): void => {
  if (copiesMenu()?.matches(':popover-open') === true) copiesMenu()?.hidePopover()
}

/** Delete every copy, which leaves every view on the program. */
export function deleteEveryCopy(): void {
  for (let n = 0; n < 16; n += 1) {
    shutCopiesMenu()
    document.querySelector<HTMLButtonElement>('#buffers')?.click()
    const del = document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label^="delete "]')
    if (del === null) {
      shutCopiesMenu()
      return
    }
    del.click()
  }
  throw new Error('the copies menu still lists a copy after 16 deletes')
}

/**
 * Delete every copy, which leaves every view on the program. Unlike `deleteEveryCopy`, it finds and shuts the copies
 * menu itself rather than through `shutCopiesMenu`.
 */
export function deleteEveryCopyInline(): void {
  const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('.buffer-list')
  const shut = (): void => {
    if (menu()?.matches(':popover-open') === true) menu()?.hidePopover()
  }
  for (let n = 0; n < 16; n += 1) {
    shut()
    document.querySelector<HTMLButtonElement>('#buffers')?.click()
    const del = document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label^="delete "]')
    if (del === null) {
      shut()
      return
    }
    del.click()
  }
  throw new Error('the copies menu still lists a copy after 16 deletes')
}

/** The copies menu's rows, read with the menu opened and shut again. */
export const copyNames = (): (string | null)[] => {
  document.querySelector<HTMLButtonElement>('#buffers')?.click()
  const rows = [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row-name')].map((e) => e.textContent)
  document.querySelector<HTMLElement>('.buffer-list')?.hidePopover()
  return rows
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
 * `moreOf` and `menuOf`, where `pickInViewMenu` finds it through `viewMenu`, and the two throw differently where there
 * is none. `vitest/browser` is imported when it is called, as `chooseSetting` says why.
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

/**
 * Open `pane`'s `⋯` menu with the pointer and pick `cls`'s item with it, as a user does. `vitest/browser` is imported
 * when it is called, as `chooseSetting` says why.
 */
export async function pickInViewMenu(pane: HTMLElement, cls: string): Promise<void> {
  const { userEvent } = await import('vitest/browser')
  await userEvent.click(pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement)
  await until(() => viewMenu(pane).matches(':popover-open'), 'the view menu to open')
  const item = viewMenu(pane).querySelector<HTMLButtonElement>(`button.${cls}`)
  if (item === null) throw new Error(`the menu offers no ${cls}`)
  await userEvent.click(item)
}
