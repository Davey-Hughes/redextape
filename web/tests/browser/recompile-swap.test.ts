import { EditorView } from '@codemirror/view'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import {
  frame,
  frames,
  host,
  paneByLeaf,
  panelOf,
  picker,
  SHELL,
  showWideDefault,
  stateIdle,
  stepTextOf,
  undoButton,
  until,
} from './harness'

/**
 * **A RECOMPILE SWAPS EVERY VIEW TO THE NEW PROGRAM'S STEP 0 IN ONE FRAME** (recompile-flash design): no frame shows an
 * emptied TM tape or rxm register panel, the λ term as flat text, `not run`, or the TM rules panel moved. Each case is
 * one way a recompile starts, with the λ, rxm and TM views and their panels open: the program's, then a copy's, from an
 * edit in the copy's own editor.
 *
 * **THE WORKER'S REPLIES ARE HANDED OVER ONE A PAINTED FRAME APART**, so every state between two replies is painted and
 * sampled however close together they were posted.
 */

const SRC =
  'fn sum_to(n) {\n    let mut acc = 0;\n    while n > 0 {\n        acc = acc + n;\n        n = n - 1;\n    }\n    acc\n}\n\nsum_to(5)'

/** The program the copies are made from. */
const SMALL = 'let x = 40; x + 2'

const LEAVES = ['lambda-0', 'rxm-0', 'tm-0'] as const
type Leaf = (typeof LEAVES)[number]
const FORWARD = 'one step forward'

let view: EditorView

/** A session worker's reply not yet handed to the page, with its kind. */
type Held = { readonly kind: string; readonly hand: () => void }

/** The replies the page has not been handed yet, or `null` while they reach it as they come. */
let held: Held[] | null = null
const handed = new WeakSet<Event>()

/** Holds a session worker's reply while `held` is a list: the worker's first listener, so it runs before the app's. */
const hold = (worker: Worker, e: MessageEvent): void => {
  if (held === null || handed.has(e)) return
  e.stopImmediatePropagation()
  held.push({
    kind: String(e.data?.kind),
    hand: () => {
      const copy = new MessageEvent('message', { data: e.data })
      handed.add(copy)
      worker.dispatchEvent(copy)
    },
  })
}

const PageWorker = globalThis.Worker

/** What a frame paints of the three views, as far as a recompile can empty or move it. */
type Sample = {
  readonly tapes: number
  readonly registers: number
  readonly layout: string
  readonly lines: readonly string[]
  readonly rulesTop: number
}

const read = (): Sample => {
  const tm = paneByLeaf('tm-0')
  return {
    tapes: tm.querySelector('.tapes')?.childElementCount ?? -1,
    registers: paneByLeaf('rxm-0').querySelector('.rxm-registers')?.childElementCount ?? -1,
    layout: paneByLeaf('lambda-0').querySelector<HTMLElement>('.term')?.dataset.layout ?? '',
    lines: LEAVES.map((leaf) => stepTextOf(leaf)),
    // FROM THE TM VIEW'S OWN TOP, so the notice line moving every view below it, which the undo's does, is not counted.
    rulesTop: Math.round(panelOf(tm, 'rules').getBoundingClientRect().top - tm.getBoundingClientRect().top),
  }
}

/**
 * Sample every frame until the returned function is called, which answers the samples. **IN A `ResizeObserver`
 * CALLBACK**, which runs after the frame's animation callbacks and layout and before its paint, so a sample is what
 * that frame paints, an app redraw scheduled on an animation frame included.
 */
const sampling = (): (() => Sample[]) => {
  const samples: Sample[] = []
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:-50px;top:0;height:1px;width:1px;pointer-events:none'
  document.body.append(probe)
  // A box resized every frame, so the observer reports in every frame.
  const observer = new ResizeObserver(() => samples.push(read()))
  observer.observe(probe)
  let on = true
  let width = 1
  const tick = () => {
    if (!on) return
    width = 3 - width
    probe.style.width = `${width}px`
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  return () => {
    on = false
    observer.disconnect()
    probe.remove()
    return samples
  }
}

/** The program session idle and no view recording. */
const settled = () =>
  until(() => stateIdle() && LEAVES.every((leaf) => !stepTextOf(leaf).includes('…')), 'the compile to settle')

const forward = (leaf: string) =>
  document.querySelector(`[data-leaf="${leaf}"] .controls button[aria-label="${FORWARD}"]`) as HTMLButtonElement

/** Whether `kind` is a copy's build reply, `*-scratch-compiled`. */
const copyBuilt = (kind: string): boolean => kind.endsWith('scratch-compiled')

/**
 * The views of `watched` stepped on, off step 0, so the old build's picture differs from the new one's step 0;
 * then `act`, the replies handed over one a frame from the new build's `compiled` to its `result`, every frame sampled.
 * **A COPY'S BUILD HAS NO `result`** (`copy` set): its replies are handed from its `*-scratch-compiled` until none is
 * held and no watched view records.
 */
async function recompile(
  act: () => Promise<void>,
  { watched = LEAVES, copy = false }: { watched?: readonly Leaf[]; copy?: boolean } = {},
): Promise<{ before: Sample; samples: Sample[] }> {
  if (!copy) await settled()
  // ONE STEP ON IN A COPY, whose small program's rxm run is only a few steps long.
  const on = copy ? 1 : 3
  for (const leaf of watched) for (let i = 0; i < on; i += 1) await userEvent.click(forward(leaf))
  await frames()
  const before = read()
  expect(
    watched.every((leaf) => before.lines[LEAVES.indexOf(leaf)]?.startsWith(`step ${on} of`)),
    `precondition: every watched view at step ${on}, ${before.lines}`,
  ).toBe(true)
  const stop = sampling()
  held = []
  await act()
  const built = (kind: string) => (copy ? copyBuilt(kind) : kind === 'compiled')
  await until(() => held?.some((r) => built(r.kind)) ?? false, 'the new build’s compiled reply')
  const recording = () => watched.some((leaf) => stepTextOf(leaf).includes('…'))
  let ended = false
  for (let n = 0; !ended || (held?.length ?? 0) > 0; n += 1) {
    if (n > 5_000) throw new Error('the new build’s replies did not end')
    const next = held?.shift()
    if (next === undefined) {
      if (copy && n > 0 && !recording()) ended = true
      await frame()
      continue
    }
    if (!copy && next.kind === 'result') ended = true
    next.hand()
    await frames()
  }
  held = null
  await frames()
  return { before, samples: stop() }
}

/**
 * What each sample of `samples` shows emptied, as flat text or `not run`, with the number of frames that showed it, and
 * the rules panel's tops if it stood anywhere but the old program's and then the new one's: `[]` when no frame did.
 * **THE TOP MAY CHANGE ONCE**, from the old program's to the new one's, since two programs' TM views can differ above
 * the panel; any other top is a frame drawn between the two.
 */
function flashes(before: Sample, samples: readonly Sample[], watched: readonly Leaf[] = LEAVES): string[] {
  const on = (leaf: Leaf) => watched.includes(leaf)
  const lineOf = (s: Sample, leaf: Leaf) => s.lines[LEAVES.indexOf(leaf)] ?? ''
  expect(samples.length, 'precondition: frames were sampled').toBeGreaterThan(10)
  expect(
    samples.some((s) => watched.every((leaf) => lineOf(s, leaf).startsWith('step 0 of'))),
    'precondition: a sampled frame shows every watched view at the new step 0',
  ).toBe(true)
  const found = new Map<string, number>()
  for (const s of samples) {
    const what = [
      on('tm-0') && s.tapes < 1 ? 'no TM tape rows' : '',
      on('rxm-0') && s.registers < 1 ? 'no rxm registers' : '',
      on('lambda-0') && s.layout === 'flat' ? 'the λ term as flat text' : '',
      ...watched.filter((leaf) => lineOf(s, leaf) === 'not run').map((leaf) => `${leaf} not run`),
    ].filter((w) => w !== '')
    for (const w of what) found.set(w, (found.get(w) ?? 0) + 1)
  }
  if (!on('tm-0')) return [...found].map(([what, n]) => `${what} (${n} frames)`)
  const tops = [before, ...samples].map((s) => s.rulesTop).filter((top, i, all) => i === 0 || top !== all[i - 1])
  const settled = samples.at(-1)?.rulesTop
  const moved = tops.length > 2 || (tops.length === 2 && tops[1] !== settled)
  // The TM step line of each frame the panel stood elsewhere: a line that wraps moves the panel too.
  const elsewhere = samples
    .filter((s) => s.rulesTop !== before.rulesTop && s.rulesTop !== settled)
    .map((s) => s.lines[2])
  const where = moved ? [`the TM rules panel at ${tops}, under ${[...new Set(elsewhere)].join(' | ')}`] : []
  return [...[...found].map(([what, n]) => `${what} (${n} frames)`), ...where]
}

describe('a recompile, in the app with the λ, rxm and TM views and their panels open', () => {
  beforeAll(async () => {
    globalThis.Worker = new Proxy(PageWorker, {
      construct(target, args: ConstructorParameters<typeof Worker>, newTarget) {
        const worker: Worker = Reflect.construct(target, args, newTarget)
        if (String(args[0]).includes('session-worker'))
          worker.addEventListener('message', (e) => hold(worker, e as MessageEvent))
        return worker
      },
    })
    await page.viewport(1600, 1000)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await showWideDefault()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SRC } })
    await settled()
    const closed = (leaf: string) =>
      [...paneByLeaf(leaf).querySelectorAll<HTMLElement>('button.panel-toggle[aria-expanded="false"]')].filter(
        (t) => t.closest<HTMLElement>('[data-panel]')?.dataset.panel !== 'outline',
      )
    for (const leaf of LEAVES) for (const toggle of closed(leaf)) await userEvent.click(toggle)
    expect(
      LEAVES.map((leaf) => closed(leaf).length),
      'precondition: every panel but the outline open',
    ).toEqual([0, 0, 0])
  }, 60_000)
  // A CASE THAT FAILS WHILE IT HOLDS THE REPLIES WOULD LEAVE THE NEXT ONE'S RUN NEVER ARRIVING.
  afterEach(() => {
    const replies = held ?? []
    held = null
    for (const reply of replies) reply.hand()
  })
  afterAll(() => {
    globalThis.Worker = PageWorker
  })

  it('swaps in one frame on a typed edit', async () => {
    const { before, samples } = await recompile(async () => {
      const at = view.state.doc.toString().lastIndexOf('5)') + 1
      view.dispatch({ selection: { anchor: at } })
      view.focus()
      await userEvent.keyboard('{Backspace}4')
    })
    expect(flashes(before, samples)).toEqual([])
  }, 60_000)

  it('swaps in one frame on a change of encoding', async () => {
    const { before, samples } = await recompile(() => userEvent.selectOptions(picker(), 'unary'))
    expect(flashes(before, samples)).toEqual([])
    await userEvent.selectOptions(picker(), 'binary')
  }, 60_000)

  it('swaps in one frame on an example', async () => {
    const { before, samples } = await recompile(async () => {
      await userEvent.click(document.querySelector('#examples') as HTMLElement)
      const fact = [...document.querySelectorAll<HTMLElement>('button.example')].find((b) =>
        /^fact\(4\)/.test(b.textContent ?? ''),
      )
      await userEvent.click(fact as HTMLElement)
    })
    expect(flashes(before, samples)).toEqual([])
  }, 60_000)

  it('swaps in one frame on the example’s undo', async () => {
    const { before, samples } = await recompile(() => userEvent.click(undoButton() as HTMLButtonElement))
    expect(flashes(before, samples)).toEqual([])
  }, 60_000)

  /**
   * **THE LINK CARRIES EVERY VIEW AT STEP 3**, so each view's position lies past the step 0 `compiled` carries, and a
   * view waits on its leg's first chunk to go there: the TM view behind the λ and rxm recordings.
   */
  it('swaps in one frame on a shared link’s open', async () => {
    await settled()
    for (const leaf of LEAVES) for (let i = 0; i < 3; i += 1) await userEvent.click(forward(leaf))
    await frames()
    await userEvent.click(document.querySelector('#share') as HTMLElement)
    await until(() => document.querySelector<HTMLInputElement>('#share-link')?.value.includes('#') ?? false, 'the link')
    const link = (document.querySelector('#share-link') as HTMLInputElement).value
    await userEvent.keyboard('{Escape}')
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SRC.replace('sum_to(5)', 'sum_to(3)') } })
    await settled()
    const { before, samples } = await recompile(async () => {
      location.hash = new URL(link).hash
    })
    expect(
      samples.at(-1)?.lines.map((l) => l.replace(/ of .*/, '')),
      'precondition: the link took every view to step 3',
    ).toEqual(['step 3', 'step 3', 'step 3'])
    expect(flashes(before, samples)).toEqual([])
  }, 60_000)

  /**
   * **↺ ON A VIEW WAITING FOR ITS LEG'S FIRST CHUNK LEAVES IT ON STEP 0**, as ↺ does anywhere: the ring holds only the
   * step 0 `compiled` carried, and the chunks that come after the press do not carry the view on with them.
   */
  it('leaves a view on step 0 when ↺ is pressed while it waits for its first chunk', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SRC } })
    await settled()
    held = []
    const at = view.state.doc.toString().lastIndexOf('5)') + 1
    view.dispatch({ selection: { anchor: at } })
    view.focus()
    await userEvent.keyboard('{Backspace}4')
    await until(() => held?.some((r) => r.kind === 'compiled') ?? false, 'the new build’s `compiled` reply')
    for (let next = held?.shift(); next !== undefined; next = held?.shift()) {
      next.hand()
      if (next.kind === 'compiled') break
    }
    await frames()
    const restart = document.querySelector<HTMLButtonElement>(
      '[data-leaf="tm-0"] .controls button[aria-label="back to step 0"]',
    ) as HTMLButtonElement
    expect(
      [stepTextOf('tm-0'), restart.disabled || restart.getAttribute('aria-disabled') === 'true'],
      'precondition: the TM view waits on its first chunk, ↺ live',
    ).toEqual(['step 0 of 0…', false])
    await userEvent.click(restart)
    for (let n = 0; !stateIdle() || (held?.length ?? 0) > 0; n += 1) {
      if (n > 5_000) throw new Error('the new build’s replies did not end')
      const next = held?.shift()
      if (next === undefined) await frame()
      else {
        next.hand()
        await frames()
      }
    }
    held = null
    await settled()
    expect(stepTextOf('tm-0')).toMatch(/^step 0 of [1-9]/)
  }, 60_000)

  /**
   * A copy made from `leaf`'s view through its `⋯` menu, settled: the view shows the copy from here on, with its own
   * editor. **OF A SMALL PROGRAM**, so that each copy's recording ends inside its allowance.
   */
  const copyOf = async (leaf: Leaf): Promise<EditorView> => {
    if (view.state.doc.toString() !== SMALL)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SMALL } })
    await settled()
    const more = host(leaf)?.querySelector('button.view-more') as HTMLElement
    await userEvent.click(more)
    const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement
    await until(() => menu.matches(':popover-open'), 'the view’s menu')
    await userEvent.click(menu.querySelector('button.detach') as HTMLElement)
    const editor = () => paneByLeaf(leaf).querySelector<HTMLElement>('.term-editor .cm-content')
    await until(() => editor() !== null, `the ${leaf} copy’s editor`)
    await until(() => /^step 0 of [\d,]+$/.test(stepTextOf(leaf)), `the ${leaf} copy to settle`)
    return EditorView.findFromDOM(editor() as HTMLElement) as EditorView
  }

  /** A space typed at the end of the copy's text, in its own editor. */
  const typeInCopy = async (leaf: Leaf, copy: EditorView): Promise<void> => {
    await userEvent.click(paneByLeaf(leaf).querySelector('.term-editor .cm-content') as HTMLElement, {
      position: { x: 4, y: 4 },
    })
    copy.dispatch({ selection: { anchor: copy.state.doc.length } })
    await userEvent.keyboard(' ')
  }

  for (const leaf of LEAVES) {
    it(`swaps in one frame on an edit in the ${leaf.replace('-0', '')} copy’s editor`, async () => {
      const copy = await copyOf(leaf)
      const { before, samples } = await recompile(() => typeInCopy(leaf, copy), { watched: [leaf], copy: true })
      expect(flashes(before, samples, [leaf])).toEqual([])
    }, 60_000)
  }
})
