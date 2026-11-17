import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cdp, page, userEvent } from 'vitest/browser'
import { fieldWidths } from '../../../pkg/redextape_wasm.js'
import { contrastRatio } from '../../src/contrast'
import { STEP_PAUSE_MS } from '../../src/field-width'
import { SessionClient } from '../../src/session-client'
import { STYLE_IDS } from '../../src/skin'
import { chromiumOnly } from './engine'
import {
  controlledMenu,
  enterWidth,
  examplesButton,
  isShown,
  linkAt,
  noticeText,
  paneOrThrow,
  picker,
  recordingOver,
  rect,
  results,
  SHELL,
  segments,
  settled,
  splitSame,
  stateIdle,
  tmLeaves,
  tmPane,
  tmStatus,
  tmStepText,
  undoButton,
  until,
  widthBox,
  widthShown,
} from './harness'

/**
 * **THE WIDTH BOX: EMPTY FOR AUTO, OR A FIELD WIDTH PINNED FROM `fieldWidths()`** (the TM width design, decisions 1 to
 * 3, 17, 19, 24, 27 and 29). It sits at the end of a TM view's header bar, before `⋯`, each TM view of the program has
 * one, and every one shows and sets the program's one width, recompiling as the encoding select does. A pinned run
 * that overflows keeps its TM, which halts in `overflow`, and its value says so at that width. Driven by real
 * gestures, because a synthetic event is not one. The page opens on the program `setup.ts` stores, under `unary`. ONE
 * MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

/** `9 + 9` under binary: 18 outgrows a 4-cell field, which holds up to 15, and auto fits it at 8. */
const SUM = 'let a = 9; let b = 9; a + b'
const AUTO_AT_8 = /^TM 18 · [\d,]+ transitions · width 8$/

/** The header bar of `leaf`'s view. */
const bar = (leaf = 'tm-0') => paneOrThrow(leaf).querySelector(':scope > .view-header') as HTMLElement
/** The TM leg's segment of the results strip. */
const tmSegment = () => segments()[2] ?? ''
const toNewest = () => tmPane().querySelector<HTMLButtonElement>('.controls button.to-newest') as HTMLButtonElement
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let view: EditorView

beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => stateIdle() && segments().length > 0, 'the first compile')
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** `src` in the editor under `encoding`, both put there by the gestures a user makes, compiled. */
async function under(encoding: string, src: string): Promise<void> {
  if (picker().value !== encoding) await userEvent.selectOptions(picker(), encoding)
  await settled(view, src)
}

/**
 * Enter `value` in `leaf`'s width box, and wait for the compile it starts. **THE ENTRY CLAIMS A GENERATION AT ONCE**,
 * so `#results` is running before the wait: without a recompile it would still be idle, and the wait would return on
 * the previous run.
 */
async function choose(value: string, leaf = 'tm-0'): Promise<void> {
  await enterWidth(value, leaf)
  expect(widthShown(leaf)).toBe(value)
  expect(results().dataset.state, `entering ${value} starts a compile`).toBe('running')
  await until(stateIdle, `the compile at width ${value}`)
}

/** `SUM` under binary at `width`, compiled, and the compiles from here on counted. */
async function at(width: string) {
  await under('binary', SUM)
  if (widthShown() !== width) await choose(width)
  return {
    supersede: vi.spyOn(SessionClient.prototype, 'supersede'),
    request: vi.spyOn(SessionClient.prototype, 'request'),
  }
}

/** The up or the down half of `leaf`'s width box's own arrows. */
const arrow = (half: 'up' | 'down', leaf = 'tm-0') =>
  paneOrThrow(leaf).querySelector(`.field-width-arrows > .${half}`) as HTMLElement

/** `rgb(r, g, b)` as `getComputedStyle` writes an opaque colour, as `#rrggbb`. */
const hex = (rgb: string): string => {
  const channels = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(rgb)
  if (channels === null) throw new Error(`not an opaque rgb(): ${rgb}`)
  return `#${channels
    .slice(1)
    .map((c) => Number(c).toString(16).padStart(2, '0'))
    .join('')}`
}

/** The colour drawn behind `el`: its own background or its nearest ancestor's that is opaque. */
const backdrop = (el: Element): string => {
  for (let at: Element | null = el; at !== null; at = at.parentElement) {
    const colour = getComputedStyle(at).backgroundColor
    if (/^rgb\(/.test(colour)) return colour
  }
  return getComputedStyle(document.documentElement).backgroundColor
}

type DomNode = { nodeId: number; documentURL?: string; children?: DomNode[]; contentDocument?: DomNode }
type AxValue = { value?: unknown }
type AxNode = {
  role?: AxValue
  name?: AxValue
  description?: AxValue
  properties?: { name: string; value?: AxValue }[]
}

/**
 * Chromium's own accessibility node for `leaf`'s width box, by CDP. The session is the runner's page, so this test's
 * document is found among the frames CDP pierces, by its URL.
 */
async function axBox(
  leaf = 'tm-0',
): Promise<{ role: unknown; name: unknown; description: unknown; valuetext: unknown }> {
  const { root } = (await cdp().send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode }
  const ours = (n: DomNode): DomNode | undefined =>
    n.documentURL === location.href
      ? n
      : [...(n.children ?? []), ...(n.contentDocument ? [n.contentDocument] : [])].reduce<DomNode | undefined>(
          (found, c) => found ?? ours(c),
          undefined,
        )
  const doc = ours(root)
  if (doc === undefined) throw new Error(`no frame at ${location.href}`)
  const { nodeId } = (await cdp().send('DOM.querySelector', {
    nodeId: doc.nodeId,
    selector: `[data-leaf="${leaf}"] .field-width input`,
  })) as { nodeId: number }
  const { nodes } = (await cdp().send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })) as {
    nodes: AxNode[]
  }
  const node = nodes[0] as AxNode
  const valuetext = node.properties?.find((p) => p.name === 'valuetext')?.value?.value
  return { role: node.role?.value, name: node.name?.value, description: node.description?.value, valuetext }
}

/** Select the box's text with the keyboard, after a click in it, and type `text` over it. */
async function typeOver(text: string): Promise<void> {
  await userEvent.click(widthBox())
  await userEvent.keyboard(`{Control>}a{/Control}${text}`)
}

describe('the width box', () => {
  it('sits on the view’s bar on the title’s row, after the strip and right before ⋯, named by its visible word, in the speed select’s chrome', async () => {
    const header = bar()
    const box = widthBox()
    const title = header.querySelector(':scope > .view-title-heading') as HTMLElement
    const speed = header.querySelector('.controls select.speed') as HTMLSelectElement
    const actions = header.querySelector(':scope > .view-actions') as HTMLElement
    const more = actions.querySelector('button.view-more') as HTMLElement
    // THE PRECONDITIONS: the bar holds the title, the strip's last box and `⋯`, which the box is placed between.
    expect(isShown(title) && isShown(speed) && isShown(more), 'precondition: the title, speed and ⋯ are drawn').toBe(
      true,
    )
    expect(isShown(header.querySelector('.controls .extend') as Element), 'precondition: no continue button').toBe(
      false,
    )

    // ON THE TITLE'S ROW, AFTER THE STRIP AND RIGHT BEFORE `⋯`, AT THE GAP `⋯` KEEPS BEFORE `✕`, INSIDE THE BAR.
    const centre = (r: DOMRect) => (r.top + r.bottom) / 2
    expect(Math.abs(centre(rect(box)) - centre(rect(title))), 'on the title’s row').toBeLessThanOrEqual(1)
    expect(rect(box).left, 'after the speed select').toBeGreaterThan(rect(speed).right)
    const gap = rect(more).left - rect(box).right
    const actionsGap = Number.parseFloat(getComputedStyle(actions).columnGap)
    expect(Math.abs(gap - actionsGap), `${gap}px before ⋯, the actions’ ${actionsGap}px`).toBeLessThanOrEqual(0.5)
    const controls = [...header.querySelectorAll<HTMLElement>('button, select, input')].filter(isShown)
    expect(controls[controls.indexOf(box) + 1], '⋯ is the next control').toBe(more)
    expect(rect(box).top).toBeGreaterThanOrEqual(rect(header).top)
    expect(rect(box).bottom).toBeLessThanOrEqual(rect(header).bottom)

    // ITS WORD IS ON SCREEN, BEFORE IT ON ITS LINE, AND IS ITS NAME.
    const label = box.closest('label') as HTMLLabelElement
    const word = [...label.childNodes].find((n) => n.nodeType === Node.TEXT_NODE) as Text
    const range = document.createRange()
    range.selectNodeContents(word)
    const drawn = range.getBoundingClientRect()
    expect(drawn.width * drawn.height, 'the word is drawn').toBeGreaterThan(0)
    expect(drawn.right).toBeLessThanOrEqual(rect(box).left)
    expect(Math.abs(centre(drawn) - centre(rect(box)))).toBeLessThanOrEqual(1)
    const named = await page.getByRole('spinbutton', { name: 'width', exact: true }).elements()
    expect(named, 'the box is the spin button named “width”').toContain(box)

    // THE SPEED SELECT'S CHROME, THE PAGE'S TEXT COLOUR, AND A WORD AS DIM AS THE STATUS LINE UNDER THE BAR.
    const [ours, action] = [box, speed].map((el) => getComputedStyle(el))
    for (const property of [
      'font-family',
      'font-size',
      'border-top-width',
      'border-top-style',
      'border-top-color',
      'border-top-left-radius',
      'background-color',
    ]) {
      expect.soft(ours?.getPropertyValue(property), property).toBe(action?.getPropertyValue(property))
    }
    // AS TALL AS THE SPEED SELECT, in each engine.
    const taller = rect(speed).height - rect(box).height
    expect(Math.abs(taller), `the speed select is ${taller}px taller`).toBeLessThanOrEqual(0.5)
    expect(ours?.color).toBe(getComputedStyle(document.body).color)
    const dim = getComputedStyle(tmPane().querySelector('.tm-status') as Element).color
    expect(getComputedStyle(label).color).toBe(dim)

    // EMPTY IS AUTO: ITS PLACEHOLDER, IN THE DIM WORD'S COLOUR AT FULL OPACITY, AND THE VALUE TEXT A SCREEN READER HEARS.
    expect(box.value).toBe('')
    expect(box.placeholder).toBe('auto')
    const placeholder = getComputedStyle(box, '::placeholder')
    expect(placeholder.color, 'auto in the dim colour').toBe(dim)
    expect(placeholder.opacity, 'not faded').toBe('1')
    expect(box.getAttribute('aria-valuetext')).toBe('auto')
    // FOUR CHARACTERS OF ITS MONO FONT, AS WIDE AS `auto`, FIT BESIDE ITS ARROWS, AND A FIFTH DOES NOT.
    box.value = '6464'
    const four = [box.scrollWidth, box.clientWidth]
    box.value = '64646'
    const five = [box.scrollWidth, box.clientWidth]
    box.value = ''
    expect(four[0], `4 characters: scroll ${four[0]}, client ${four[1]}`).toBeLessThanOrEqual(four[1] as number)
    expect(five[0], `5 characters: scroll ${five[0]}, client ${five[1]}`).toBeGreaterThan(five[1] as number)

    // A TEXT FIELD THAT IS A SPIN BUTTON FROM THE NARROWEST WIDTH TO THE WIDEST, WITH A KEYPAD OF DIGITS (decision 33).
    const widths = fieldWidths() as number[]
    expect([box.type, box.inputMode, box.getAttribute('role')]).toEqual(['text', 'numeric', 'spinbutton'])
    expect([box.getAttribute('aria-valuemin'), box.getAttribute('aria-valuemax')]).toEqual([
      String(widths[0]),
      String(widths.at(-1)),
    ])
    expect(box.hasAttribute('aria-valuenow'), 'no number at auto').toBe(false)
  })

  /**
   * **OUR OWN ARROWS, NONE OF THE BROWSER'S** (decision 30): an up half and a down half splitting the box's height inside
   * its border at its end, drawn as shapes, out of the Tab order and out of what a screen reader reads, the box being
   * the spin button. The browser draws none: the box is a text field (decision 33), and four characters fill the room
   * left of ours, where an arrow of the browser's would take some of it (the placement case above).
   */
  it('draws its own up and down arrows inside its border at its end, each half its height, and none of the browser’s', async () => {
    const box = widthBox()
    const b = rect(box)
    const border = Number.parseFloat(getComputedStyle(box).borderTopWidth)
    const [up, down] = [arrow('up'), arrow('down')]
    expect(isShown(up) && isShown(down), 'both halves are drawn').toBe(true)
    const inner = b.height - 2 * border
    for (const [half, r] of [
      ['up', rect(up)],
      ['down', rect(down)],
    ] as const) {
      expect(Math.abs(r.right - (b.right - border)), `${half}: at the end, inside the border`).toBeLessThanOrEqual(0.5)
      expect(Math.abs(r.height - inner / 2), `${half}: half the height inside the border`).toBeLessThanOrEqual(0.5)
      expect(r.left, `${half}: right of the text’s room`).toBeGreaterThan(b.left + border)
      const shape = (half === 'up' ? up : down).querySelector('svg') as SVGSVGElement
      const s = rect(shape)
      expect(s.width * s.height, `${half}: its shape is drawn`).toBeGreaterThan(0)
      expect(
        s.left >= r.left - 0.5 && s.right <= r.right + 0.5 && s.top >= r.top - 0.5 && s.bottom <= r.bottom + 0.5,
        `${half}: its shape inside its half`,
      ).toBe(true)
    }
    expect(Math.abs(rect(up).top - (b.top + border)), 'up: at the top inside the border').toBeLessThanOrEqual(0.5)
    expect(Math.abs(rect(down).bottom - (b.bottom - border)), 'down: at the bottom').toBeLessThanOrEqual(0.5)
    expect(up.textContent, 'shapes, not glyphs').toBe('')
    expect(down.textContent).toBe('')
    expect(up.closest('[aria-hidden="true"]'), 'not read: the box is the spin button').not.toBeNull()
    expect(
      [up, down].some((el) => el.matches('button, [tabindex]')),
      'not Tab stops',
    ).toBe(false)
    expect(
      [up, down].map((el) => getComputedStyle(el).cursor),
      'the plain arrow pointer, not a link’s hand (decision 31)',
    ).toEqual(['default', 'default'])
    expect(box.type, 'a text field, which has no arrows of the browser’s').toBe('text')
  })

  it('pinned at 4, the TM keeps its run and its value is the overflow at width 4; auto fits it at 8, at 18', async () => {
    await under('binary', SUM)
    expect(tmSegment(), 'precondition: auto').toMatch(AUTO_AT_8)
    await choose('4')
    expect(tmSegment()).toMatch(
      /^TM fault: a number the machine stores \(a value, an address or a call's return tag\) outgrew the 4-cell tape field chosen for this run; try a wider width, or auto · [\d,]+ transitions · width 4 \(pinned\)$/,
    )
    // A LENGTH, NOT A STOP: the run ended, in `overflow`.
    expect(tmSegment()).not.toContain('at a cap')
    await choose('auto')
    expect(tmSegment()).toMatch(AUTO_AT_8)
  })

  it('pinned at 4, ⏭ takes the TM view to the run’s halt, in overflow', async () => {
    await under('binary', SUM)
    if (widthShown() !== '4') await choose('4')
    const steps = /· ([\d,]+) transitions ·/.exec(tmSegment())?.[1]
    expect(steps, `the run’s length in ${tmSegment()}`).toBeDefined()
    await until(
      () => recordingOver(tmStepText()) && tmStepText().includes(`of ${steps}`),
      'the TM recording to reach the halt',
    )
    await userEvent.click(toNewest())
    await until(() => tmStepText().startsWith(`step ${steps} of ${steps}`), `the TM view at step ${steps}`)
    expect(tmStatus().split(' · ')[0]).toMatch(/\boverflow\b/)
    expect(tmStatus()).toContain('width 4')
  })

  /** The encoding select's case in `app.test.ts`, for the width box: a recompile with no edit to clear the mark. */
  it('recompiles with no document change, and clears the source’s link mark', async () => {
    await under('binary', 'let x = 40; x + 2')
    linkAt(view, 'let x = 40; x + 2'.indexOf('x + 2'))
    expect(document.querySelector('.cm-editor .linked'), 'precondition: a link mark').not.toBeNull()
    const doc = view.state.doc
    await choose(widthShown() === '16' ? '32' : '16')
    expect(view.state.doc, 'the same document').toBe(doc)
    expect(tmSegment()).toMatch(new RegExp(`· width ${widthShown()} \\(pinned\\)$`))
    expect(document.querySelector('.cm-editor .linked')).toBeNull()
  })

  /** **A PICK'S UNDO GOES AT A WIDTH CHOSEN**, as at an encoding chosen (`examples-menu.test.ts`). */
  it('withdraws a picked example’s undo', async () => {
    await userEvent.click(examplesButton())
    await userEvent.click(document.querySelector('#examples-menu button[data-example="map-fold"]') as HTMLElement)
    expect(undoButton()?.textContent).toBe('undo')
    await until(stateIdle, 'the example’s compile')
    await choose(widthShown() === '8' ? '16' : '8')
    expect(undoButton()).toBeNull()
    expect(noticeText()).toBe('')
  })

  /**
   * **ONE WIDTH FOR THE PROGRAM, HOWEVER MANY VIEWS SHOW IT**: an entry in a second TM view is what the first one
   * shows, and it recompiles once, not once per view. A second compile is a second `supersede`, which the debounce
   * would fold into one post, so the count is of `supersede`.
   */
  it('entered in one of two TM views, shows in both and recompiles once', async () => {
    await under('binary', SUM)
    if (widthShown() !== 'auto') await choose('auto')
    const before = new Set(tmLeaves())
    splitSame('tm-0', 'row')
    await until(() => tmLeaves().length === before.size + 1, 'a second TM view')
    const second = tmLeaves().find((leaf) => !before.has(leaf)) as string
    await until(() => widthBox(second) !== null, 'the second view’s width box')
    expect(widthShown(second), 'a new view shows the program’s width').toBe('auto')

    const supersede = vi.spyOn(SessionClient.prototype, 'supersede')
    const request = vi.spyOn(SessionClient.prototype, 'request')
    await choose('4', second)
    expect(widthShown('tm-0'), 'the first view shows the entry').toBe('4')
    expect(supersede, 'one compile').toHaveBeenCalledTimes(1)
    expect(request.mock.calls.map((c) => c[3])).toEqual([4])
    expect(tmSegment()).toMatch(/· width 4 \(pinned\)$/)

    // AND BACK FROM THE FIRST VIEW TO THE SECOND.
    await choose('auto', 'tm-0')
    expect(widthShown(second)).toBe('auto')
    expect(tmSegment()).toMatch(AUTO_AT_8)
  })

  /**
   * **REACHED FROM THE KEYBOARD, IN THE BAR'S VISUAL ORDER**: Tab from the title passes the step buttons and the speed
   * select, then reaches the box, then `⋯` and `✕`.
   */
  it('is the Tab stop after the speed select and before ⋯, named and described', async () => {
    await under('binary', SUM)
    const title = bar().querySelector('button.view-title') as HTMLButtonElement
    const speed = bar().querySelector('.controls select.speed') as HTMLSelectElement
    const more = bar().querySelector('button.view-more') as HTMLButtonElement
    const close = bar().querySelector('button.view-close') as HTMLButtonElement
    expect(isShown(title) && isShown(close), 'precondition: the title and ✕ are drawn').toBe(true)

    title.focus()
    const stops: Element[] = []
    for (let i = 0; i < 20 && document.activeElement !== close; i++) {
      await userEvent.tab()
      stops.push(document.activeElement as Element)
    }
    const at = stops.indexOf(widthBox())
    expect(stops.slice(at - 1, at + 3), 'speed, width, ⋯, ✕').toEqual([speed, widthBox(), more, close])
    for (const el of stops.slice(0, at)) {
      expect(el.closest('.controls'), `${el.getAttribute('aria-label')} is in the strip`).not.toBeNull()
    }
    await userEvent.tab({ shift: true })
    await userEvent.tab({ shift: true })
    expect(document.activeElement, 'Shift+Tab back from ✕ past ⋯').toBe(widthBox())
    // THE VISIBLE WORD IS THE NAME; WHAT IT SETS, AND THAT EVERY TM VIEW SHARES IT, IS SAID ONLY TO A SCREEN READER.
    expect(document.activeElement).toHaveAccessibleName('width')
    expect(document.activeElement).toHaveAccessibleDescription(
      'tape field width in cells for the program’s TM, shared by every TM view; empty for auto',
    )
  })

  /**
   * **A SCREEN READER IN CHROMIUM HEARS THAT EMPTY IS AUTO, AND THE WIDTH FROM A SET BOX** (decision 33). Read from
   * Chromium's own accessibility node by CDP, not from the DOM: Chromium hands on no native input's `aria-valuetext`,
   * so the empty box's `auto` reaches a reader there only in its description. Firefox has no CDP; the design doc says
   * how its node was read.
   */
  it('tells a screen reader in Chromium that empty is auto, and its width when set, in Chromium’s own accessibility node', async (ctx) => {
    chromiumOnly(ctx, 'the accessibility node is read by CDP, which only Chromium has')
    await at('auto')
    const auto = await axBox()
    expect([auto.role, auto.name], 'precondition: the box’s node').toEqual(['spinbutton', 'width'])
    expect(auto.description, 'at auto').toMatch(/; empty for auto$/)
    await choose('13')
    const set = await axBox()
    expect([set.valuetext, set.description], 'at 13').toEqual(['13', auto.description])
    await choose('auto')
  })
})

/**
 * **AN ENTRY APPLIES ON ENTER OR ON LEAVING THE BOX, A STEP AFTER A PAUSE, AND NOTHING ELSE APPLIES** (the TM width
 * design, decision 29).
 */
describe('the width box under real input', () => {
  it('runs nothing while 13 is typed, then on Enter runs once at 13, and the strip says it is pinned', async () => {
    const { supersede, request } = await at('auto')
    await typeOver('13')
    expect(widthBox().value, 'precondition: the box holds the entry').toBe('13')
    await pause(STEP_PAUSE_MS + 200)
    expect(supersede, 'typing runs nothing').toHaveBeenCalledTimes(0)
    await userEvent.keyboard('{Enter}')
    expect(results().dataset.state, 'Enter starts a compile').toBe('running')
    await until(stateIdle, 'the compile at width 13')
    expect(supersede, 'one compile').toHaveBeenCalledTimes(1)
    expect(request.mock.calls.map((c) => c[3])).toEqual([13])
    expect(tmSegment()).toMatch(/· width 13 \(pinned\)$/)
    expect(widthShown()).toBe('13')
  })

  it('cleared, runs at auto on Enter, and on leaving the box', async () => {
    await at('16')
    await choose('auto')
    expect(tmSegment()).toMatch(AUTO_AT_8)
    expect(widthBox().getAttribute('aria-valuetext')).toBe('auto')
    await choose('16')
    await typeOver('{Backspace}')
    expect(widthBox().value, 'precondition: the box is cleared').toBe('')
    expect(results().dataset.state, 'clearing runs nothing').toBe('idle')
    await userEvent.tab()
    expect(results().dataset.state, 'leaving the box starts a compile').toBe('running')
    await until(stateIdle, 'the compile at auto')
    expect(widthShown()).toBe('auto')
    expect(tmSegment()).toMatch(AUTO_AT_8)
  })

  it.each(['0', '65', '7.5', 'ten', 'abc', '1a3'])(
    'puts back its width for %s, on Enter and on leaving the box, and runs nothing',
    async (entry) => {
      const { supersede } = await at('16')
      for (const leave of ['{Enter}', '{Tab}']) {
        await typeOver(entry)
        const box = widthBox()
        expect(box.value, 'precondition: the box shows the entry').toBe(entry)
        await userEvent.keyboard(leave)
        expect(box.value, `after ${leave}`).toBe('16')
      }
      await pause(STEP_PAUSE_MS + 200)
      expect(supersede, 'nothing runs').toHaveBeenCalledTimes(0)
      expect(tmSegment()).toMatch(/· width 16 \(pinned\)$/)
    },
  )

  /** **EACH ENTRY IS JUDGED ON THE TEXT THE BOX HOLDS WHEN IT APPLIES**: a refused letter typed before is gone with its text. */
  it('runs at a width typed over text it would refuse', async () => {
    const { request } = await at('9')
    await typeOver('1x')
    await typeOver('16')
    expect(widthBox().value, 'precondition: the box holds 16').toBe('16')
    await userEvent.keyboard('{Enter}')
    await until(() => request.mock.calls.length > 0 && stateIdle(), 'the compile at 16')
    expect(request.mock.calls.map((c) => c[3])).toEqual([16])
    expect(tmSegment()).toMatch(/· width 16 \(pinned\)$/)
  })

  /** **↑/↓ WITH CTRL, ALT OR META LEAVE THE BOX AS IT IS**: never a step past the plain order (decision 32). */
  it('is not stepped by ↑ or ↓ held with Ctrl, Alt or Meta, and runs nothing on leaving', async () => {
    const { supersede } = await at('auto')
    await userEvent.click(widthBox())
    for (const key of ['Control', 'Alt', 'Meta']) {
      for (const arrow of ['ArrowDown', 'ArrowUp']) {
        await userEvent.keyboard(`{${key}>}{${arrow}}{/${key}}`)
        expect(widthShown(), `${key}+${arrow} at auto`).toBe('auto')
      }
    }
    await userEvent.tab()
    await pause(STEP_PAUSE_MS + 200)
    expect(supersede, 'nothing runs').toHaveBeenCalledTimes(0)
    expect(tmSegment()).toMatch(AUTO_AT_8)
  })

  /**
   * **ITS FLOOR IS ONE CELL, AND ↓ PAST IT IS AUTO** (decision 31): widths under the search's 4 are for demos, where
   * most programs overflow, and stepping down through them ends at auto. **ONE PLAIN ORDER, AUTO, 1, 2, ..., 64**
   * (decision 32): ↓ at auto keeps it, and ↑ from it is 1 whatever width auto fitted.
   */
  it('goes down to 1, where the TM keeps its run and its value is the overflow at 1 cell', async () => {
    await under('binary', SUM)
    expect(widthBox().getAttribute('aria-valuemin'), 'the floor').toBe('1')
    await choose('1')
    expect(tmSegment()).toMatch(
      /^TM fault: a number the machine stores \(a value, an address or a call's return tag\) outgrew the 1-cell tape field chosen for this run; try a wider width, or auto · [\d,]+ transitions? · width 1 \(pinned\)$/,
    )
  })

  it('steps ↓ from 2 to 1 and on to auto, which ↓ keeps and ↑ leaves for 1, and runs once at auto after the pause', async () => {
    const { supersede, request } = await at('2')
    await userEvent.click(widthBox())
    await userEvent.keyboard('{ArrowDown}')
    expect(widthBox().value, '↓ from 2').toBe('1')
    await userEvent.keyboard('{ArrowDown}')
    expect([widthShown(), widthBox().getAttribute('aria-valuetext')], '↓ from 1').toEqual(['auto', 'auto'])
    await userEvent.keyboard('{ArrowDown}')
    expect(widthShown(), '↓ from that auto').toBe('auto')
    await userEvent.keyboard('{ArrowUp}')
    expect(widthBox().value, '↑ from that auto').toBe('1')
    await userEvent.keyboard('{ArrowDown}')
    expect(widthShown(), '↓ from 1 again').toBe('auto')
    expect(supersede, 'not at once').toHaveBeenCalledTimes(0)
    await until(() => supersede.mock.calls.length > 0 && stateIdle(), 'the compile after the pause')
    await pause(STEP_PAUSE_MS + 200)
    expect(request.mock.calls.map((c) => c[3])).toEqual([null])
    expect(tmSegment()).toMatch(AUTO_AT_8)
  })

  it('steps to auto from 1 when its down arrow is pressed, as ↓ does', async () => {
    const { request } = await at('1')
    await userEvent.click(arrow('down'))
    expect(widthShown(), 'the down arrow from 1').toBe('auto')
    expect(document.activeElement, 'the press puts the focus in the box').toBe(widthBox())
    await until(() => request.mock.calls.length > 0 && stateIdle(), 'the compile after the pause')
    expect(request.mock.calls.map((c) => c[3])).toEqual([null])
    expect(tmSegment()).toMatch(AUTO_AT_8)
  })

  it('keeps auto on ↓ from auto, steps ↑ from auto to 1 though auto fitted 8, ↓ from 1 to auto, and runs nothing', async () => {
    const { supersede } = await at('auto')
    expect(tmSegment(), 'precondition: auto fits 8').toMatch(AUTO_AT_8)
    await userEvent.click(widthBox())
    await userEvent.keyboard('{ArrowDown}')
    expect([widthShown(), widthBox().getAttribute('aria-valuetext')], '↓ from auto').toEqual(['auto', 'auto'])
    await userEvent.keyboard('{ArrowUp}')
    expect(widthBox().value, '↑ from auto').toBe('1')
    await userEvent.keyboard('{ArrowDown}')
    expect([widthShown(), widthBox().getAttribute('aria-valuetext')], '↓ from 1').toEqual(['auto', 'auto'])
    await pause(STEP_PAUSE_MS + 200)
    expect(supersede, 'back at the program’s auto, nothing runs').toHaveBeenCalledTimes(0)
    expect(tmSegment()).toMatch(AUTO_AT_8)
  })

  it('keeps auto when its down arrow is pressed at auto, and steps to 1 and on with its up arrow, as ↑/↓ do, the focus in the box', async () => {
    const { supersede, request } = await at('auto')
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement, 'precondition: the focus is not in the box').not.toBe(widthBox())
    await userEvent.click(arrow('down'))
    expect(widthShown(), 'the down arrow from auto').toBe('auto')
    expect(document.activeElement, 'the press puts the focus in the box').toBe(widthBox())
    await userEvent.click(arrow('up'))
    expect(widthBox().value, 'the up arrow from auto').toBe('1')
    await userEvent.click(arrow('up'))
    expect(widthBox().value, 'the up arrow from 1').toBe('2')
    expect(document.activeElement, 'and keeps it there').toBe(widthBox())
    expect(supersede, 'not at once').toHaveBeenCalledTimes(0)
    await until(() => request.mock.calls.length > 0 && stateIdle(), 'the compile after the pause')
    await pause(STEP_PAUSE_MS + 200)
    expect(request.mock.calls.map((c) => c[3])).toEqual([2])
    expect(tmSegment()).toMatch(/· width 2 \(pinned\)$/)
  })

  it('runs once for three quick presses of its up arrow, at the third width on, the focus staying in the box', async () => {
    const { supersede, request } = await at('9')
    await userEvent.click(widthBox())
    for (let n = 0; n < 3; n++) await userEvent.click(arrow('up'))
    expect(widthBox().value).toBe('12')
    expect(document.activeElement, 'the presses leave the focus in the box').toBe(widthBox())
    expect(supersede, 'nothing runs before the pause').toHaveBeenCalledTimes(0)
    await until(() => supersede.mock.calls.length > 0 && stateIdle(), 'the compile after the pause')
    await pause(STEP_PAUSE_MS + 200)
    expect(supersede, 'one compile').toHaveBeenCalledTimes(1)
    expect(request.mock.calls.map((c) => c[3])).toEqual([12])
  })

  /**
   * **A PLAYING RUN REDRAWS THE VIEW AT EVERY STEP**, and each redraw brings the box to the program's width: an entry
   * being typed is not the program's width yet, and stays.
   */
  it('keeps a width being typed while a playing run draws its frames', async () => {
    await at('16')
    const play = tmPane().querySelector<HTMLButtonElement>('.controls button.play') as HTMLButtonElement
    await userEvent.click(play)
    try {
      expect(play.getAttribute('aria-label'), 'precondition: the run plays').toBe('pause')
      await typeOver('2')
      for (const typed of ['2', '20']) {
        if (typed === '20') await userEvent.keyboard('0')
        for (let frame = 0; frame < 2; frame++) {
          const shown = tmStepText()
          await until(() => tmStepText() !== shown, 'a frame')
        }
        expect(widthBox().value, `after frames, ${typed} typed`).toBe(typed)
        expect(document.activeElement, 'the focus stays in the box').toBe(widthBox())
      }
    } finally {
      // ESCAPE BEFORE THE PAUSE: the press on pause takes the focus from the box, which would apply the entry.
      await userEvent.keyboard('{Escape}')
      if (play.getAttribute('aria-label') === 'pause') await userEvent.click(play)
    }
    expect(widthBox().value).toBe('16')
  })

  it('runs once for three quick presses of ↑, at the third width on', async () => {
    const { supersede, request } = await at('9')
    await userEvent.click(widthBox())
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(widthBox().value).toBe('12')
    await until(() => supersede.mock.calls.length > 0 && stateIdle(), 'the compile after the pause')
    await pause(STEP_PAUSE_MS + 200)
    expect(supersede, 'one compile').toHaveBeenCalledTimes(1)
    expect(request.mock.calls.map((c) => c[3])).toEqual([12])
    expect(tmSegment()).toMatch(/· width 12 \(pinned\)$/)
  })

  it('puts back its width on Escape, after typing and after a step, and runs nothing then or on leaving', async () => {
    const { supersede } = await at('16')
    await typeOver('20')
    await userEvent.keyboard('{Escape}')
    expect(widthBox().value, 'after typing').toBe('16')
    await userEvent.keyboard('{ArrowUp}')
    expect(widthBox().value, 'precondition: a step').toBe('17')
    await userEvent.keyboard('{Escape}')
    expect(widthBox().value, 'after a step').toBe('16')
    await userEvent.tab()
    await pause(STEP_PAUSE_MS + 200)
    expect(supersede, 'nothing runs').toHaveBeenCalledTimes(0)
  })

  it('is not changed by the wheel over it with the focus in it', async () => {
    const { supersede } = await at('16')
    await userEvent.click(widthBox())
    expect(document.activeElement, 'precondition: the focus').toBe(widthBox())
    await userEvent.wheel(widthBox(), { delta: { y: -100 } })
    await userEvent.wheel(widthBox(), { delta: { y: -100 } })
    expect(widthBox().value).toBe('16')
    await pause(STEP_PAUSE_MS + 200)
    expect(supersede, 'nothing runs').toHaveBeenCalledTimes(0)
  })

  /**
   * **FORCED COLOURS DRAW THE BOX IN SYSTEM COLOURS**: its text as the speed select's, its `auto` in `GrayText`, and its
   * focus ring whole.
   */
  it('keeps its text, its auto and its focus ring in forced colours', async (ctx) => {
    chromiumOnly(ctx, 'forced colours are CDP’s Emulation.setEmulatedMedia, which only Chromium has')
    await at('auto')
    await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] })
    try {
      expect(matchMedia('(forced-colors: active)').matches, 'precondition: forced colours').toBe(true)
      const gray = document.createElement('span')
      gray.style.color = 'GrayText'
      document.body.append(gray)
      const grayText = getComputedStyle(gray).color
      gray.remove()
      const box = widthBox()
      const speed = bar().querySelector('.controls select.speed') as HTMLSelectElement
      expect(getComputedStyle(box).color, 'its text').toBe(getComputedStyle(speed).color)
      expect(getComputedStyle(box, '::placeholder').color, 'its auto').toBe(grayText)
      expect(getComputedStyle(box).borderTopStyle, 'its border').toBe('solid')
      // ITS ARROWS IN THE TEXT'S SYSTEM COLOUR, never the page's, which forced colours would draw over.
      const system = (name: string): string => {
        const probe = document.createElement('span')
        probe.style.color = name
        document.body.append(probe)
        const colour = getComputedStyle(probe).color
        probe.remove()
        return colour
      }
      expect(system('CanvasText'), 'precondition: two system colours').not.toBe(system('Canvas'))
      for (const half of ['up', 'down'] as const) {
        const stroke = getComputedStyle(arrow(half).querySelector('path') as Element).stroke
        expect(stroke, `${half}: in the text’s system colour`).toBe(system('CanvasText'))
      }
      await userEvent.click(widthBox())
      expect(getComputedStyle(box).outlineStyle, 'its focus ring').toBe('solid')
    } finally {
      await cdp().send('Emulation.setEmulatedMedia', { features: [] })
    }
  })
})

/**
 * **ITS ARROWS STAND AT 3:1 OR MORE AGAINST WHAT IS BEHIND THE BOX** (decision 30), the floor for a control's parts,
 * in every style, light and dark. The box draws no background of its own, so behind it is its bar's.
 */
describe('the width box’s arrows in each style and theme', () => {
  it('stand at 3:1 or more against the box', async () => {
    const root = document.documentElement
    const settings = document.querySelector('#settings') as HTMLElement
    const choice = (id: string) => document.querySelector(id) as HTMLSelectElement
    const was = [choice('#style').value, choice('#appearance-choice').value]
    const wear = async (style: string, theme: string) => {
      await userEvent.click(settings)
      await userEvent.selectOptions(choice('#style'), style)
      await userEvent.selectOptions(choice('#appearance-choice'), theme)
      await userEvent.click(settings)
    }
    try {
      for (const style of STYLE_IDS) {
        for (const theme of ['light', 'dark'] as const) {
          await wear(style, theme)
          await until(() => root.dataset.style === style && root.dataset.theme === theme, `${style} in ${theme}`)
          const behind = hex(backdrop(widthBox()))
          for (const half of ['up', 'down'] as const) {
            const stroke = hex(getComputedStyle(arrow(half).querySelector('path') as Element).stroke)
            const ratio = contrastRatio(stroke, behind)
            expect.soft(ratio, `${style}, ${theme}, ${half}: ${stroke} on ${behind}`).toBeGreaterThanOrEqual(3)
          }
        }
      }
    } finally {
      await wear(was[0] as string, was[1] as string)
    }
  })
})

/** Last in the file: the copy it makes takes `tm-0`'s place. */
describe('the width box in a copy’s view', () => {
  /**
   * **A COPY RUNS AT THE WIDTH ITS HEADER RECORDS**, so a view showing one offers no width (design decision 19): its
   * bar, on screen, draws one select, the speed's, and no box.
   */
  it('is absent from a view showing a TM copy', async () => {
    await under('binary', SUM)
    const pane = tmPane()
    expect(isShown(widthBox()), 'precondition: the program’s view offers it').toBe(true)
    const more = pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
    await userEvent.click(more)
    await until(() => controlledMenu(more).matches(':popover-open'), 'the view menu to open')
    await userEvent.click(controlledMenu(more).querySelector<HTMLElement>('button.detach') as HTMLElement)
    await until(() => pane.querySelector('.view-status') !== null, 'the copy’s badge')
    expect(isShown(bar()), 'the copy’s bar is on screen').toBe(true)
    const drawn = [...bar().querySelectorAll('select, input')].filter(isShown)
    expect(drawn, 'and draws no width box').toEqual([bar().querySelector('.controls select.speed')])
  })
})
