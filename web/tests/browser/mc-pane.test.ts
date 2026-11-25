import { beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import init, { compile } from '../../../pkg/redextape_wasm.js'
import initClif, { ClifSession } from '../../../pkg-clif/redextape_clif_wasm.js'
import initArm64, { machineCode as arm64Code } from '../../../pkg-mc-arm64/redextape_mc_wasm.js'
import initX86, { machineCode as x86Code } from '../../../pkg-mc-x86-64/redextape_mc_wasm.js'
import { ClifPane, type ClifPanels } from '../../src/clif-pane'
import { EXAMPLE_ENCODING, EXAMPLES } from '../../src/examples'
import type { McAnswer } from '../../src/machine-code'
import type { ClifCompiled, ClifLoad, McTarget } from '../../src/protocol'
import type { ClifAt, ClifListing, ClifState, McListing } from '../../src/types'
import { DEFAULT_CLIF_DISPLAY } from '../../src/workspace'
import { controlState, frames, hearLoops, inertEvents, menuOf, moreOf, pick } from './harness'
import { codePanelOf, syntaxChoice, targetChoice } from './mc-fixture'

/**
 * WHAT THE MACHINE CODE PANEL DRAWS, as a user reads it (machine code panel design §4, *The panel*, *Rows*, *Loading
 * and failure*, *When there is none*): each notice in its words, drawn and seen inside the open panel's body, and none
 * of them while it is closed; Retry after a failed load, which hands its focus on when it goes; nothing for a program
 * that does not compile; a row's instruction in AT&T or Intel as chosen, the bytes column while the `⋯` item is
 * checked, and no syntax choice on arm64. A `ClifPane` built by hand on `fact.rxt`, its machine code the real
 * packages', and the page's machine code store stood in for by a stub each case sets.
 */

const CONTROLS = controlState(true, 'step 3 of 55')
/** A reason a program's lowering gives for declining it, as the listing's notice quotes it. */
const DECLINED = 'the program nests deeper than the rxm lowering guard allows'

let clif: ClifListing
const code = {} as Record<McTarget, McListing>

beforeAll(async () => {
  await page.viewport(1280, 1000)
  await init()
  await initClif()
  await initX86()
  await initArm64()
  const fact = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
  const { session } = compile(fact, EXAMPLE_ENCODING) as { session: { clifInput(): unknown; free(): void } | null }
  if (session === null) throw new Error('fact.rxt compiled to no session')
  const s = new ClifSession(session.clifInput(), 'as-built')
  clif = s.listing() as ClifListing
  s.free()
  code['x86-64'] = x86Code(session.clifInput(), 'as-built') as McListing
  code.arm64 = arm64Code(session.clifInput(), 'as-built') as McListing
  session.free()
})

hearLoops(() => {
  document.body.innerHTML = ''
})

/** What the stub store says: each target's load and the answer it holds for the listing shown. */
type Store = { load: ClifLoad; answer: Partial<Record<McTarget, McAnswer>> }

function mount(
  store: Store,
  o: {
    panels?: ClifPanels
    program?: ClifCompiled | null | undefined
    reason?: string
    target?: McTarget
    width?: number
  } = {},
) {
  const host = document.createElement('section')
  host.className = 'pane'
  host.dataset.kind = 'clif'
  host.style.width = `${o.width ?? 1000}px`
  host.style.height = '900px'
  document.body.append(host)
  const machineCode = {
    load: () => store.load,
    intent: vi.fn(),
    code: (target: McTarget) => store.answer[target] ?? null,
    want: vi.fn(),
    retry: vi.fn(() => {
      store.load = 'loading'
    }),
  }
  const display = { ...DEFAULT_CLIF_DISPLAY, target: o.target ?? 'x86-64' }
  const pane = new ClifPane(
    host,
    inertEvents({ machineCode, legReason: () => o.reason ?? '' }),
    o.panels ?? { code: true },
    {},
    display,
  )
  pane.setProgram(o.program === undefined ? { listing: clif, level: 'as-built' } : o.program)
  let step = 0
  /** Draw a step whose next instruction is `next`, as a frame does. */
  const at = (next: ClifAt | null) => {
    step += 1
    const s: ClifState = {
      step,
      at: next ?? { function: 0, inst: 0 },
      next,
      pc: null,
      values: [],
      values_len: 0,
      returned: null,
      depth: 1,
      frames: [],
      heap_len: 0,
      cells: [],
      box_len: 0,
      boxes: [],
    }
    pane.render(s, CONTROLS)
  }
  if (o.program !== null) at(null)
  return { host, machineCode, at }
}

/** The answers that show each target's rows. */
const ROWS = (): Store['answer'] => ({ 'x86-64': { code: code['x86-64'] }, arm64: { code: code.arm64 } })

const notice = (host: HTMLElement) => codePanelOf(host).querySelector<HTMLElement>('.mc-notice')
const retry = (host: HTMLElement) => codePanelOf(host).querySelector<HTMLButtonElement>('.mc-retry')
const rows = (host: HTMLElement) => [...codePanelOf(host).querySelectorAll<HTMLElement>('.mc-listing .clif-row')]
const toggle = (host: HTMLElement) => codePanelOf(host).querySelector('.panel-toggle') as HTMLElement

/**
 * Whether `el` is drawn where the user sees it: a box of its own, inside the panel's body, and not made invisible.
 */
function seen(host: HTMLElement, el: Element | null): boolean {
  if (el === null || !el.isConnected) return false
  const r = el.getBoundingClientRect()
  const body = (
    document.getElementById(toggle(host).getAttribute('aria-controls') ?? '') as HTMLElement
  ).getBoundingClientRect()
  return (
    r.width > 0 &&
    r.height > 0 &&
    getComputedStyle(el).visibility === 'visible' &&
    r.top >= body.top - 0.5 &&
    r.bottom <= body.bottom + 0.5
  )
}

/** The notice's sentence, without the label of the button after it. */
const sentence = (host: HTMLElement) => notice(host)?.firstChild?.textContent ?? ''

/** The instruction a row draws: the cell's own text, without its offset, pc, bytes and callee. */
const instruction = (row: HTMLElement) =>
  [...(row.querySelector('.clif-cell')?.childNodes ?? [])]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join('')

/** Where the instruction's text begins on screen, in px from the viewport's left. */
function textLeft(row: HTMLElement): number {
  const text = [...(row.querySelector('.clif-cell')?.childNodes ?? [])].find((n) => n.nodeType === Node.TEXT_NODE)
  if (text === undefined) throw new Error('a row with no instruction text')
  const range = document.createRange()
  range.selectNodeContents(text)
  return range.getBoundingClientRect().left
}

/** The drawn instruction rows, each with its offset, by their index in the listing. */
const instructions = (host: HTMLElement) =>
  new Map(
    rows(host)
      .filter((r) => r.querySelector('.mc-offset') !== null)
      .map((r) => [r.getAttribute('aria-rowindex'), r] as const),
  )

/** Each state the open panel has words for, the store that makes it, and the words. */
const NOTICES: readonly {
  readonly name: string
  readonly store: () => Store
  readonly program?: ClifCompiled
  readonly says: string
  readonly retry: boolean
}[] = [
  { name: 'loading', store: () => ({ load: 'loading', answer: {} }), says: 'Loading machine code…', retry: false },
  { name: 'building', store: () => ({ load: 'ready', answer: {} }), says: 'Building machine code…', retry: false },
  {
    name: 'failed',
    store: () => ({ load: 'failed', answer: {} }),
    says: 'machine code could not be loaded.',
    retry: true,
  },
  {
    name: 'a declined program',
    store: () => ({ load: 'ready', answer: {} }),
    program: { error: DECLINED },
    says: `No machine code for this program: ${DECLINED}`,
    retry: false,
  },
  {
    name: 'a declined answer',
    store: () => ({ load: 'ready', answer: { 'x86-64': { declined: DECLINED } } }),
    says: `No machine code for this program: ${DECLINED}`,
    retry: false,
  },
  {
    name: 'a trap',
    store: () => ({ load: 'ready', answer: { 'x86-64': { trapped: 'RuntimeError: unreachable' } } }),
    says: 'machine code could not be built: the package stopped with an error.',
    retry: false,
  },
]

describe("the machine code panel's notices", () => {
  it.each(NOTICES)('says $name in its words, seen in the open panel, and nothing closed', async (n) => {
    const closed = mount(n.store(), { panels: { code: false }, program: n.program })
    await frames()
    expect(
      closed.host.querySelectorAll('.mc-notice, .mc-retry').length,
      'a notice or a Retry in the closed panel',
    ).toBe(0)
    document.body.innerHTML = ''

    const { host } = mount(n.store(), { program: n.program })
    await frames()
    expect(sentence(host), 'the words').toBe(n.says)
    expect(seen(host, notice(host)), 'the notice seen').toBe(true)
    expect(rows(host), 'rows beside the notice').toEqual([])
    if (n.retry) expect(seen(host, retry(host)), 'Retry seen').toBe(true)
    else expect(retry(host), 'a Retry').toBeNull()
  })

  it('says nothing, and draws no rows, for a program that does not compile', async () => {
    const { host } = mount({ load: 'ready', answer: ROWS() }, { program: null, reason: 'not compiled' })
    await frames()
    expect(codePanelOf(host).dataset.open, 'precondition: open').toBe('true')
    expect(notice(host), 'a notice').toBeNull()
    expect(rows(host), 'rows').toEqual([])
  })

  it('loads again on Retry, then shows the rows', async () => {
    const store: Store = { load: 'failed', answer: {} }
    const { host, machineCode, at } = mount(store)
    await frames()
    expect(seen(host, retry(host)), 'precondition: Retry seen').toBe(true)
    await userEvent.click(retry(host) as HTMLButtonElement)
    expect(machineCode.retry, 'the store asked to load x86-64 again').toHaveBeenCalledWith('x86-64')
    await frames()
    expect(sentence(host), 'the load under way').toBe('Loading machine code…')
    store.load = 'ready'
    store.answer = ROWS()
    at(null)
    await frames()
    expect(notice(host), 'a notice beside the rows').toBeNull()
    expect(rows(host).filter((r) => seen(host, r)).length, 'rows seen').toBeGreaterThan(0)
  })

  it('hands the focus to the panel’s toggle when the Retry it was on goes', async () => {
    const { host } = mount({ load: 'failed', answer: {} })
    await frames()
    ;(retry(host) as HTMLButtonElement).focus()
    await userEvent.keyboard('{Enter}')
    await frames()
    expect(retry(host), 'precondition: Retry gone').toBeNull()
    expect(document.activeElement, 'the focus').toBe(toggle(host))
  })
})

describe("the machine code panel's rows", () => {
  it('reads each instruction in AT&T, then in Intel once Intel is chosen, the same instruction on each row', async () => {
    const { host } = mount({ load: 'ready', answer: ROWS() })
    await frames()
    const att = instructions(host)
    expect(att.size, 'precondition: instruction rows drawn').toBeGreaterThan(5)
    const texts = [...att.values()].map(instruction)
    expect(
      texts.some((t) => t.includes('%')),
      'AT&T’s sigils',
    ).toBe(true)
    await userEvent.click(syntaxChoice(host, 'intel'))
    await frames()
    const intel = instructions(host)
    expect([...intel.keys()], 'the same rows').toEqual([...att.keys()])
    const pairs = [...att].map(([i, r]) => [instruction(r), instruction(intel.get(i) as HTMLElement)] as const)
    expect(
      pairs.filter(([a, b]) => !code['x86-64'].rows.some((r) => r.text === a && r.intel === b)),
      'rows whose two texts are not one instruction’s',
    ).toEqual([])
    expect(
      pairs.filter(([a, b]) => a === b),
      'rows the same in both',
    ).not.toHaveLength(pairs.length)
    expect(
      pairs.filter(([, b]) => b.includes('%')),
      'Intel rows with AT&T’s sigils',
    ).toEqual([])
  })

  it('shows the bytes in a column of their own while the ⋯ item is checked', async () => {
    const { host } = mount({ load: 'ready', answer: ROWS() })
    await frames()
    const [first] = instructions(host).values()
    const before = textLeft(first as HTMLElement)
    expect(codePanelOf(host).querySelectorAll('.mc-bytes').length, 'precondition: no bytes').toBe(0)
    await pick(host, 'clif-bytes')
    await frames()
    const drawn = [...instructions(host).values()]
    const bytes = drawn.map((r) => r.querySelector<HTMLElement>('.mc-bytes'))
    expect(bytes.filter((b) => b === null).length, 'instruction rows without bytes').toBe(0)
    const widest = Math.max(...bytes.map((b) => (b as HTMLElement).getBoundingClientRect().width))
    expect(widest, 'the column drawn').toBeGreaterThan(0)
    const lefts = new Set(drawn.map((r) => Math.round(textLeft(r))))
    expect(lefts.size, 'every instruction starts in one column').toBe(1)
    expect(textLeft(drawn[0] as HTMLElement) - before, 'the text moved right by the column').toBeGreaterThanOrEqual(
      widest,
    )
    // THE MENU STAYS OPEN ON A CHECK, as the view's other checks leave it: the second press is on the same item.
    const item = menuOf(moreOf(host)).querySelector<HTMLButtonElement>('button.clif-bytes') as HTMLButtonElement
    expect(item.getAttribute('aria-checked'), 'the item checked').toBe('true')
    await userEvent.click(item)
    await frames()
    expect(item.getAttribute('aria-checked'), 'the item unchecked').toBe('false')
    expect(codePanelOf(host).querySelectorAll('.mc-bytes').length, 'bytes after the second press').toBe(0)
    expect(textLeft([...instructions(host).values()][0] as HTMLElement), 'the text back').toBeCloseTo(before, 0)
  })

  it('has no syntax choice on arm64, seen or in the tab order, and the target choice stays put', async () => {
    const { host } = mount({ load: 'ready', answer: ROWS() })
    await frames()
    const x86 = targetChoice(host, 'x86-64').getBoundingClientRect().left
    expect(getComputedStyle(syntaxChoice(host, 'att')).visibility, 'precondition: the choice on x86-64').toBe('visible')
    await userEvent.click(targetChoice(host, 'arm64'))
    await frames()
    expect(getComputedStyle(syntaxChoice(host, 'att')).visibility, 'the AT&T choice seen').toBe('hidden')
    expect(getComputedStyle(syntaxChoice(host, 'intel')).visibility, 'the Intel choice seen').toBe('hidden')
    expect(targetChoice(host, 'x86-64').getBoundingClientRect().left, 'the target choice moved').toBe(x86)
    expect(document.activeElement, 'precondition: the focus on arm64').toBe(targetChoice(host, 'arm64'))
    await userEvent.tab()
    expect(
      (document.activeElement as Element).closest('.mc-syntax'),
      'the focus on a syntax choice from arm64',
    ).toBeNull()
    expect(
      [...instructions(host).values()].map(instruction).filter((t) => t.includes('%')),
      'arm64 rows read as AT&T',
    ).toEqual([])
  })
})
