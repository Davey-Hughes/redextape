import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import type { TmProgram } from '../../src/types'
import {
  buttonOf,
  centreOf,
  chooseStyle,
  controlState,
  isShown,
  leafEl,
  menuOfId,
  picker,
  presetOf,
  pressed,
  SHELL,
  settled,
  stateIdle,
  until,
} from './harness'
import { mountTmFixture } from './tm-fixture'

/**
 * **THE TM VIEW'S BAR KEEPS ONE ROW, AND ITS STEP COUNT IS ON THE LINE UNDER IT** (the TM width design, decisions 25
 * to 28): the bar one row at 1280px in Explorer in each style at any count; the λ and rxm views' step text on their
 * bars; the line without it while the steps are on the one bar; in Explorer's two columns on a phone, the line's
 * height held while a run plays; and in a view as wide as a phone, the line one row under a state name too long for
 * it, only the name cut. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

const bar = (leaf: string) => leafEl(leaf).querySelector(':scope > .view-header') as HTMLElement
const titleOf = (leaf: string) => bar(leaf).querySelector(':scope > .view-title-heading') as HTMLElement
const statusOf = () => leafEl('tm-0').querySelector('.tm-status') as HTMLElement
/** Every box the bar draws that holds a control or text, as `view-strip-narrow.test.ts` reads a header. */
const boxesOf = (leaf: string) =>
  [...bar(leaf).querySelectorAll<HTMLElement>('.view-title, label, button, select, .step')].filter(isShown)
const nameOf = (el: HTMLElement) =>
  el.classList.contains('step') ? 'the step text' : (el.getAttribute('aria-label') ?? el.className)

/** A state name wider than what a phone's line leaves it beside the step text and the width. */
const LONG = 'scan_right_until_the_first_blank_cell'
/**
 * A machine of five tapes at width 4 that accepts after one step, its first state named `LONG`; each state is an
 * instruction of its own, listed by its name.
 */
const MACHINE: TmProgram = {
  states: [
    {
      name: LONG,
      accept: false,
      rules: [
        {
          read: [null, null, null, null, null],
          write: [null, null, null, null, null],
          moves: ['S', 'S', 'S', 'S', 'S'],
          next: 1,
        },
      ],
      instr: 0,
    },
    { name: 'done', accept: true, rules: [], instr: 1 },
  ],
  alphabet: ['_', '#', '1'],
  tapes: 5,
  width: 4,
  start: 0,
  listing: [LONG, 'done'],
  labels: [],
}

/** `sum_to(5)`, whose TM run under binary is five digits long. */
const SUM_TO = EXAMPLES.find((e) => e.id === 'sum-to')?.text ?? ''

let view: EditorView

beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
})

/** Put the `steps` switch on `value` with the pointer, through the workspace menu, as a user does. */
async function stepsOn(value: 'view' | 'bar'): Promise<void> {
  await userEvent.click(buttonOf('workspace'))
  await until(() => menuOfId('workspace').matches(':popover-open'), 'the workspace menu to open')
  await userEvent.click(
    menuOfId('workspace').querySelector<HTMLElement>(`[data-switch="steps"][data-value="${value}"]`) as HTMLElement,
  )
  if (menuOfId('workspace').matches(':popover-open')) menuOfId('workspace').hidePopover()
}

describe('the TM view’s bar at 1280 px, in Explorer', () => {
  /**
   * **EVERY BOX OF THE BAR ON THE TITLE'S ROW, AT EACH COUNT.** The step text's box, which the view draws on its status
   * line, is given each count and put back in the same task, so no frame the run draws in between can replace it.
   * `keep recording` is not drawn: its wrap is another change's.
   */
  it.each(['instrument', 'paper', 'terminal'])(
    'in %s, is one row with the step text at 1, 3, 5 and 7 digits',
    async (style) => {
      presetOf('explorer')
      await chooseStyle(style)
      await document.fonts.ready
      expect(document.querySelector<HTMLSelectElement>('#style')?.value, 'precondition: the style').toBe(style)
      expect(leafEl('tm-0').getBoundingClientRect().width, 'precondition: the TM view’s width').toBeCloseTo(634, 0)
      const extend = leafEl('tm-0').querySelector('.controls .extend') as HTMLElement
      expect(isShown(extend), 'precondition: no continue button').toBe(false)
      expect(isShown(bar('tm-0').querySelector('.field-width') as Element), 'precondition: the width box').toBe(true)
      const step = leafEl('tm-0').querySelector<HTMLElement>('.step') as HTMLElement
      const was = step.textContent
      try {
        for (const n of ['9', '999', '99,999', '9,999,999']) {
          step.textContent = `step ${n} of ${n}`
          const digits = n.replaceAll(',', '').length
          for (const el of [...boxesOf('tm-0'), bar('tm-0').querySelector(':scope > .view-actions') as HTMLElement]) {
            expect
              .soft(
                Math.abs(centreOf(el) - centreOf(titleOf('tm-0'))),
                `${digits} digits: ${nameOf(el)} on the title’s row`,
              )
              .toBeLessThan(1)
          }
        }
      } finally {
        step.textContent = was
      }
    },
  )

  /**
   * **ONLY THE TM VIEW'S STEP TEXT MOVES.** The λ and rxm views' bars hold theirs, on the title's row; the TM view's
   * bar holds none, and its status line does.
   */
  it('a λ and an rxm view keep their step text on their bar, and the TM view’s is on its status line', () => {
    presetOf('explorer')
    for (const leaf of ['lambda-0', 'rxm-0']) {
      const step = bar(leaf).querySelector<HTMLElement>('.view-steps .step')
      expect(step, `${leaf}’s bar holds its step text`).not.toBeNull()
      expect(isShown(step as HTMLElement), `${leaf}’s step text is drawn`).toBe(true)
      expect(step?.textContent).toMatch(/^step [\d,]+ of [\d,]+/)
      expect(
        Math.abs(centreOf(step as HTMLElement) - centreOf(titleOf(leaf))),
        `on ${leaf}’s title’s row`,
      ).toBeLessThan(1)
    }
    expect(bar('tm-0').querySelector('.step'), 'the TM view’s bar holds no step text').toBeNull()
    const line = statusOf().querySelector<HTMLElement>('.step')
    expect(isShown(line as HTMLElement), 'the TM view’s status line draws it').toBe(true)
    expect(line?.textContent).toMatch(/^step [\d,]+ of [\d,]+/)
  })

  /**
   * **AT THE `steps` SWITCH'S `bar` THE LINE DROPS THE STEP TEXT** (decision 25), as the bar drops its strip, so the
   * one step bar is the only place it shows; back at `view` the line holds it again, between the state and the width.
   */
  it('drops the step text from the status line while the steps are on the one bar, and takes it back', async () => {
    presetOf('explorer')
    const parts = () => [...(statusOf().querySelector('.tm-line') as HTMLElement).children] as HTMLElement[]
    expect(statusOf().querySelector('.step'), 'precondition: the line holds the step text').not.toBeNull()
    await stepsOn('bar')
    try {
      expect(bar('tm-0').querySelector('.view-steps'), 'precondition: the bar dropped its strip').toBeNull()
      const barStep = document.querySelector<HTMLElement>('.step-bar .step')
      expect(isShown(barStep as HTMLElement), 'the one step bar shows the step text').toBe(true)
      expect(statusOf().querySelector('.step'), 'the line drops it').toBeNull()
      expect(statusOf().textContent).toMatch(/^\S+ · width \d+$/)
    } finally {
      await stepsOn('view')
    }
    const [name, step, width] = parts()
    expect(name?.classList.contains('tm-state'), 'the state first').toBe(true)
    expect(step?.querySelector('.step'), 'the step text back, second').not.toBeNull()
    expect(isShown(step?.querySelector('.step') as HTMLElement), 'and drawn').toBe(true)
    expect(width?.textContent, 'the width third').toMatch(/^ · width \d+$/)
  })
})

describe('the TM view’s status line while a run plays, in Explorer’s two columns at a phone’s width', () => {
  /**
   * `sum_to(5)` under binary, its run five digits long, in Explorer's four views, which a phone's width puts in two
   * columns: a TM view under 200px wide, where the status line takes more than one row.
   */
  beforeAll(async () => {
    await page.viewport(1280, 800)
    presetOf('explorer')
    if (picker().value !== 'binary') await userEvent.selectOptions(picker(), 'binary')
    await settled(view, SUM_TO)
  })
  afterAll(async () => {
    await page.viewport(1280, 800)
  })

  /**
   * **THE LINE'S ROWS ARE SETTLED BY THE RUN'S TOTAL, NOT BY THE STEP** (decision 28): played at 1000 steps a second
   * from step 0 past step 1,000, through a count of one, two, three and four digits, the line keeps one height and the
   * tapes under it one place. Every frame is sampled, so a row gained for one digit and lost for the next still fails.
   */
  it.each([
    [375, 812],
    [390, 844],
  ])('at %i px, keeps its height, and the tapes their place, from step 0 past step 1,000', async (w, h) => {
    await page.viewport(w, h)
    const leaf = leafEl('tm-0')
    await until(() => leaf.getBoundingClientRect().width < 200, 'the TM view in one of two columns')
    for (const kind of ['lambda', 'rxm', 'tm']) expect(pressed(), 'precondition: the views shown').toContain(kind)
    const controls = leaf.querySelector('.view-steps .controls') as HTMLElement
    const named = (label: string) => controls.querySelector<HTMLElement>(`button[aria-label="${label}"]`)
    const stepText = () => statusOf().querySelector('.step')?.textContent ?? ''
    const stepNumber = () => Number((/^step ([\d,]+) of/.exec(stepText())?.[1] ?? '-1').replaceAll(',', ''))
    if (stepNumber() !== 0) await userEvent.click(named('back to step 0') as HTMLElement)
    await until(() => /^step 0 of \d{1,3}(,\d{3})+$/.test(stepText()), 'the whole run recorded, on step 0')
    await userEvent.selectOptions(controls.querySelector('select.speed') as HTMLSelectElement, '1000')
    const tapes = leaf.querySelector('.tapes') as HTMLElement
    const place = () =>
      `line ${statusOf().getBoundingClientRect().height}px, tapes at ` +
      `${tapes.getBoundingClientRect().top - leaf.getBoundingClientRect().top}px`
    const seen = new Map([[place(), stepText()]])
    await userEvent.click(named('play') as HTMLElement)
    try {
      await new Promise<void>((resolve, reject) => {
        const t0 = performance.now()
        const sample = () => {
          if (!seen.has(place())) seen.set(place(), stepText())
          if (stepNumber() > 1000) resolve()
          else if (performance.now() - t0 > 20_000) reject(new Error(`the run stopped at ${stepText()}`))
          else requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
    } finally {
      const pause = named('pause')
      if (pause !== null) await userEvent.click(pause)
    }
    const changes = [...seen].map(([at, step]) => `${at} from ${step}`)
    expect(changes.length, changes.join('; ')).toBe(1)
  })
})

describe('the TM view’s status line at a phone’s width, in a view as wide as the page', () => {
  /** A TM view of its own, over the app and as wide as the page, on `MACHINE` at step 0 in `LONG`. */
  let host: HTMLElement
  beforeAll(() => {
    const fixture = mountTmFixture(MACHINE, ['0', '1', '2', '3', '4'], { width: innerWidth, height: 400 })
    host = fixture.host
    host.style.position = 'fixed'
    host.style.inset = '0 auto auto 0'
    host.style.width = '100%'
    fixture.pane.render(
      {
        state: 0,
        step: 0,
        heads: [0, 0, 0, 0, 0],
        window_start: [0, 0, 0, 0, 0],
        window: ['_', '_', '_', '_', '_'],
        source_node: null,
        rule: 0,
      },
      controlState(false, 'step 0 of 1'),
    )
  })

  it.each([
    [375, 812],
    [320, 568],
  ])('at %i px, holds the state, the step and the width in that order on one row, only the name cut', async (w, h) => {
    await page.viewport(w, h)
    const view = host.getBoundingClientRect()
    expect(view.width, 'precondition: the TM view is as wide as the page').toBeCloseTo(innerWidth, 0)
    const status = host.querySelector('.tm-status') as HTMLElement
    expect(status.textContent, 'the state, the step, the width').toMatch(
      new RegExp(`^${LONG} · step 0 of 1 · width 4$`),
    )
    const name = status.querySelector<HTMLElement>('.tm-state') as HTMLElement
    const step = status.querySelector<HTMLElement>('.step') as HTMLElement
    const parts = [...status.querySelectorAll<HTMLElement>('.tm-line > *')]
    const [first, stepPart, widthPart] = parts
    expect(first, 'the name first').toBe(name)
    expect(stepPart?.contains(step), 'the step text second').toBe(true)
    expect(widthPart?.textContent, 'the width third').toBe(' · width 4')

    // ONE ROW: the line no taller than the name's box. Not `linesOf`, which counts the tops of the row's boxes and of its
    // text, a half-leading apart, so that in some positions they round to two values for one row.
    const tall = status.getBoundingClientRect().height
    expect(Math.abs(tall - name.getBoundingClientRect().height), `one row, ${tall}px tall`).toBeLessThan(1)
    for (const part of parts) {
      expect.soft(Math.abs(centreOf(part) - centreOf(name)), `${part.textContent} on the name’s row`).toBeLessThan(1)
    }
    expect
      .soft(name.getBoundingClientRect().right, 'the name before the step')
      .toBeLessThanOrEqual((stepPart as HTMLElement).getBoundingClientRect().left + 0.5)
    expect
      .soft((stepPart as HTMLElement).getBoundingClientRect().right, 'the step before the width')
      .toBeLessThanOrEqual((widthPart as HTMLElement).getBoundingClientRect().left + 0.5)
    // THE STEP AND THE WIDTH WHOLE: neither box cuts its text, and both lie inside the view.
    for (const part of [stepPart, widthPart] as HTMLElement[]) {
      expect.soft(part.scrollWidth, `${part.textContent} is whole`).toBeLessThanOrEqual(part.clientWidth)
      expect
        .soft(part.getBoundingClientRect().right, `${part.textContent} inside the view`)
        .toBeLessThanOrEqual(view.right)
    }
    // THE NAME CUT, WITH AN ELLIPSIS, AND WHOLE IN ITS TOOLTIP.
    expect.soft(name.scrollWidth, 'the name is cut').toBeGreaterThan(name.clientWidth)
    expect.soft(name.clientWidth, 'and still drawn').toBeGreaterThan(0)
    expect.soft(getComputedStyle(name).textOverflow, 'with an ellipsis').toBe('ellipsis')
    expect.soft(name.title, 'its tooltip').toBe(LONG)
  })
})
