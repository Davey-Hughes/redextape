import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import init, { compile } from '../../../pkg/redextape_wasm.js'
import initClif, { ClifSession } from '../../../pkg-clif/redextape_clif_wasm.js'
import { ClifPane } from '../../src/clif-pane'
import { EXAMPLE_ENCODING, EXAMPLES } from '../../src/examples'
import type { ClifCompiled, ClifLoad } from '../../src/protocol'
import type { ClifListing } from '../../src/types'
import { controlState, fixtureHost, paneEvents } from './harness'

/**
 * The CLIF view on its own (CLIF view design §4, *Listing* and *Loading and failure*): a host built by hand, the pane's
 * events stubbed, and `fact.rxt`'s listing from a real `ClifSession`. `clif-app.test.ts` drives the same view from a
 * real compile.
 */

let listing: ClifListing

beforeAll(async () => {
  await page.viewport(1280, 1000)
  await init()
  await initClif()
  const fact = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
  const { session } = compile(fact, EXAMPLE_ENCODING) as { session: { clifInput(): unknown; free(): void } | null }
  if (session === null) throw new Error('fact.rxt compiled to no session')
  const clif = new ClifSession(session.clifInput(), 'as-built')
  listing = clif.listing() as ClifListing
  clif.free()
  session.free()
})

afterEach(() => {
  document.body.innerHTML = ''
})

/**
 * A CLIF view in an 800 px tall host whose load stands at `load`, showing `program`; `retry` is its spy, and `loaded`
 * moves the load to another state and draws the view, as the page's `clif-load` does.
 */
function mount(load: ClifLoad, program: ClifCompiled | null) {
  const host = fixtureHost('clif-pane-fixture')
  host.dataset.kind = 'clif'
  host.style.height = '800px'
  const retry = vi.fn()
  let state = load
  const pane = new ClifPane(host, { ...paneEvents(), clifLoad: { state: () => state, retry } }, {}, {})
  pane.setProgram(program)
  pane.render(null, controlState(false, ''))
  const loaded = (next: ClifLoad) => {
    state = next
    pane.render(null, controlState(false, ''))
  }
  return { host, pane, retry, loaded }
}

const notice = (host: HTMLElement) => host.querySelector<HTMLElement>('p.clif-notice')
/** The notice's sentence, without the label of the button after it. */
const sentence = (host: HTMLElement) => notice(host)?.firstChild?.textContent ?? ''
const listingPanel = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('.panel[data-panel="listing"]') as HTMLElement

/** Whether `el` draws a box of its own inside the listing panel's. */
function drawnInListing(host: HTMLElement, el: HTMLElement | null): boolean {
  if (el === null) return false
  const box = el.getBoundingClientRect()
  const panel = listingPanel(host).getBoundingClientRect()
  return (
    box.width > 0 &&
    box.height > 0 &&
    box.left >= panel.left &&
    box.right <= panel.right &&
    box.top >= panel.top &&
    box.bottom <= panel.bottom
  )
}

describe('the CLIF view without a listing', () => {
  it('says it is loading while the package loads', () => {
    const { host } = mount('loading', null)
    expect(sentence(host)).toBe('Loading clif…')
    expect(notice(host)?.getAttribute('role')).toBe('status')
    expect(drawnInListing(host, notice(host))).toBe(true)
    expect(host.querySelector('button.clif-retry')).toBeNull()
  })

  it('says the load failed, and Retry asks for it again', async () => {
    const { host, retry, loaded } = mount('failed', null)
    expect(sentence(host)).toBe('clif could not be loaded.')
    expect(drawnInListing(host, notice(host))).toBe(true)
    const button = host.querySelector<HTMLButtonElement>('button.clif-retry')
    expect(button?.textContent).toBe('Retry')
    expect(drawnInListing(host, button)).toBe(true)
    await userEvent.click(button as HTMLButtonElement)
    expect(retry).toHaveBeenCalledTimes(1)

    // THE RETRY GOES WITH ITS NOTICE, AND HANDS ITS FOCUS TO THE LISTING'S TOGGLE rather than leaving it nowhere.
    expect(document.activeElement, 'precondition: the press focused Retry').toBe(button)
    loaded('loading')
    expect(sentence(host)).toBe('Loading clif…')
    expect(host.querySelector('button.clif-retry')).toBeNull()
    expect(document.activeElement).toBe(listingPanel(host).querySelector('.panel-toggle'))
  })

  it('says why a program has no CLIF', () => {
    const { host } = mount('ready', { error: 'x' })
    expect(sentence(host)).toBe('No clif for this program: x')
    expect(drawnInListing(host, notice(host))).toBe(true)
  })
})

describe('the CLIF view with a listing', () => {
  it('shows the listing once it arrives, and no notice, a function header as Cranelift prints it', () => {
    const { host, pane } = mount('ready', null)
    expect(sentence(host), 'precondition: a notice before the listing').toBe('Loading clif…')
    pane.setProgram({ listing, level: 'as-built' })
    pane.render(null, controlState(false, ''))
    expect(notice(host)).toBeNull()
    const first = host.querySelector<HTMLElement>('.clif-row[aria-rowindex="1"] .clif-cell')
    // COMPACT, THE DEFAULT: the gutter's 6 columns, the pc column and the space after it, before the line.
    expect(first?.textContent).toBe(`${' '.repeat(6)}function u0:11(i64) -> i64 system_v {`)
  })
})
