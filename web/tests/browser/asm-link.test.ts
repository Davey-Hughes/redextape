import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import init, { compile as compileInPage } from '../../../pkg/redextape_wasm.js'
import type { LinkIndexWire } from '../../src/link'
import { SHELL, until } from './harness'

/**
 * Linking through the asm view (Plan 7 part 5 spec §6.6): an instruction pins the construct its lowering came from,
 * in every view; a construct pinned elsewhere marks the instructions billed to it; an instruction `defunc` minted
 * links to nothing and the status line says so; and the asm run's own focus marks its view and meets the pin.
 */

const SAMPLE = 'let x = 40; x + 2'
/** `map` with a closure: `defunc` rewrites it, and the instructions its dispatch mints have no owner (5a's fixture). */
const MAP =
  'fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } map([3, 1, 2], |x| x + 1)'

let view: EditorView

const asmHost = () => document.querySelector<HTMLElement>('.pane[data-leaf="asm-0"]') as HTMLElement
const listing = () => asmHost().querySelector<HTMLElement>('.asm-listing') as HTMLElement
const rowOf = (pc: number) =>
  [...asmHost().querySelectorAll<HTMLElement>('.asm-row')].find(
    (r) => r.querySelector('.asm-pc')?.textContent === `pc${pc}`,
  )
const linkedPcs = () =>
  [...asmHost().querySelectorAll<HTMLElement>('.asm-row.is-linked .asm-pc')].map((e) => e.textContent)
const focusPcs = () =>
  [...asmHost().querySelectorAll<HTMLElement>('.asm-row.is-focus .asm-pc')].map((e) => e.textContent)
const sourceLinked = () => document.querySelector('.cm-editor .linked')?.textContent ?? null
const linkStatus = () => document.querySelector('#link-status')?.textContent ?? ''
const stepOf = () => asmHost().querySelector('.step')?.textContent ?? ''
const control = (label: string) =>
  [...asmHost().querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

async function compile(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
  await until(() => rowOf(0) !== undefined, 'the asm listing to draw')
}

/** Link the source construct at `pos`, as `Mod-'` does. */
function linkAt(pos: number): void {
  view.dispatch({ selection: { anchor: pos } })
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: "'", ctrlKey: true, cancelable: true }))
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await compile(SAMPLE)
})

describe('linking through the asm view', () => {
  it('pins the construct an instruction came from, in the source and on the machine, from a real click', async () => {
    // pc3 is `add rr, r1, r2`, which `x + 2` lowered to. The focus starts in the source editor, as a user's would.
    view.focus()
    await userEvent.click(rowOf(3) as HTMLElement)
    await until(() => sourceLinked() !== null, 'the source to be linked')
    expect(sourceLinked()).toBe('x + 2')
    expect(linkedPcs()).toEqual(['pc3'])
    expect(document.activeElement).toBe(listing())
    await until(
      () => document.querySelector('.pane[data-leaf="tm-0"] .state-row.is-linked') !== null,
      'the TM view to mark the construct',
    )
  })

  it('marks the instructions a construct pinned in the source was lowered to', async () => {
    linkAt(SAMPLE.indexOf('40'))
    await until(() => linkedPcs().length > 0, 'the asm view to mark the pin')
    expect(linkedPcs()).toEqual(['pc0'])
  })

  it('marks the construct the asm run is working on, and says when the pin is that construct', async () => {
    control('↺')?.click()
    await until(() => stepOf().startsWith('step 0 of'), 'the asm view to restart')
    // pc0, about to run, is `li r0, #40`: the literal `40`, which the test above pinned.
    await until(() => focusPcs().includes('pc0'), 'the running focus to mark pc0')
    await until(() => linkStatus().includes('the asm run is here right now'), 'the coincidence to be said')
  })

  // ON THE KEYSTROKE ITSELF, not when the next compile lands, whose `setProgram` clears every mark anyway: asserted
  // with no `await` after the edit, as `running-focus.test.ts`'s clears-the-δ-table-focus case is.
  it("clears the asm view's pin on the keystroke that edits the program", () => {
    expect(linkedPcs(), 'the pin the tests above made, still there to clear').toEqual(['pc0'])
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } })
    expect(linkedPcs()).toEqual([])
  })
})

describe('an instruction with no owner', () => {
  it('links to nothing, and the status line says the instruction has no source construct', async () => {
    await compile(MAP)
    // WHICH INSTRUCTIONS `defunc` MINTED IS READ OFF THE SAME LOWERING THE APP RAN, in the page, rather than written
    // down: the index is the one `compile` builds, and `asmOwner` is -1 exactly where no construct owns an instruction.
    await init()
    const { session } = compileInPage(MAP, 'unary') as {
      session: { linkIndex(budget: number): LinkIndexWire; free(): void } | null
    }
    const owners = session?.linkIndex(65_536).asmOwner
    session?.free()
    const minted = owners === undefined ? -1 : owners.indexOf(-1)
    expect(minted, 'the fixture has an instruction defunc minted').toBeGreaterThanOrEqual(0)
    listing().scrollTop = Math.max(0, (minted - 2) * 24)
    await until(() => rowOf(minted) !== undefined, `pc${minted} to be drawn`)
    await userEvent.click(rowOf(minted) as HTMLElement)
    await until(() => linkStatus() === 'this instruction has no source construct', 'the status line to say why')
    expect(sourceLinked()).toBeNull()
    expect(linkedPcs()).toEqual([])
  })
})

describe('a TM state with no owner', () => {
  /**
   * AMENDMENT 11's OTHER HALF: a TM state with no owner — scaffolding, which most states are — unpins as it always
   * has, and the line says nothing. Only an asm instruction with no owner earns a sentence. The line is made to say
   * that sentence first, so the empty line after the click is the click's doing and not the line's resting state.
   */
  it('unpins without a word, where an instruction with no owner said why', async () => {
    // The case above left `MAP` compiled. The machine's state 0, `halt`, is the rule table's first row; whether it has
    // an owner is read off the same lowering, in the page, as that case reads its minted instruction.
    await init()
    const { session } = compileInPage(MAP, 'unary') as {
      session: {
        linkIndex(budget: number): LinkIndexWire
        tmProgram(): { states: { name: string }[] }
        free(): void
      } | null
    }
    const index = session?.linkIndex(65_536)
    const first = session?.tmProgram().states[0]?.name
    session?.free()
    expect(index?.tmOwner[0], 'the rule table’s first state has no owner').toBe(-1)
    const minted = index === undefined ? -1 : index.asmOwner.indexOf(-1)
    listing().scrollTop = Math.max(0, (minted - 2) * 24)
    await until(() => rowOf(minted) !== undefined, `pc${minted} to be drawn`)
    await userEvent.click(rowOf(minted) as HTMLElement)
    await until(() => linkStatus() === 'this instruction has no source construct', 'the line to say why first')

    const table = document.querySelector<HTMLElement>('.pane[data-leaf="tm-0"] .state-table') as HTMLElement
    table.scrollTop = 0
    const halt = () =>
      [...table.querySelectorAll<HTMLElement>('.state-row.is-state')].find((r) => r.textContent === first)
    await until(() => halt() !== undefined, `the ${first} row to be drawn`)
    await userEvent.click(halt() as HTMLElement)
    await until(() => linkStatus() === '', 'the line to go quiet')
    expect(sourceLinked(), 'nothing is pinned').toBeNull()
    expect(linkedPcs()).toEqual([])
  })
})

describe('a following listing', () => {
  /**
   * THE PIN'S ROWS STAY IN VIEW AFTER THE SCROLL'S OWN EVENT. The listing follows the instruction about to run, and a
   * link's scroll that won only the draw writing it lost the redraw that event causes, a frame later, to following.
   * `map`'s listing is long enough that the literal `3`, lowered after every function, is off the screen at pc0.
   */
  it('scrolls to a construct pinned in the source, and keeps it there past the scroll', async () => {
    control('↺')?.click()
    await until(() => stepOf().startsWith('step 0 of'), 'the asm view to restart')
    // The case above scrolled the listing by hand, which stopped following.
    asmHost().querySelector<HTMLButtonElement>('.table-reattach')?.click()
    await until(() => listing().scrollTop === 0, 'the listing to follow pc0')
    const echo = new Promise<void>((r) => listing().addEventListener('scroll', () => r(), { once: true }))
    const late = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('the pin needed no scroll, so this case cannot see the hold')), 5_000),
    )
    linkAt(MAP.indexOf('[3') + 1)
    await Promise.race([echo, late])
    expect(listing().scrollTop, 'the listing is still where the link scrolled it').toBeGreaterThan(0)
    expect(linkedPcs().length, "the pin's instructions are on screen").toBeGreaterThan(0)
  })
})

describe('an asm view off the page', () => {
  /** Choose a workspace preset through the workspace menu, as `hidden-views.test.ts` does. */
  function preset(name: 'explorer' | 'stage'): void {
    document.querySelector<HTMLButtonElement>('#workspace')?.click()
    document.querySelector<HTMLButtonElement>(`#workspace-menu [data-preset="${name}"]`)?.click()
    const m = document.querySelector<HTMLElement>('#workspace-menu')
    if (m?.matches(':popover-open')) m.hidePopover()
  }
  const tab = (leaf: string) => document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`)

  /**
   * THE LISTING IT MISSED CLEARS ITS PIN, SO THE SEED PUTS THE PIN BACK. A view off the page for a compile is seeded
   * with the new listing when it is shown, and `setProgram` drops every instruction a link named; the pin made while
   * it was away is resolved against the index that listing came with.
   */
  it('takes the pin it missed with the listing, once the stage shows it', async () => {
    preset('stage')
    tab('lambda-0')?.click()
    await until(() => document.querySelector('.pane[data-leaf="asm-0"]') === null, 'the asm view to leave the page')
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SAMPLE } })
    await until(() => !idle(), 'the compile to start')
    await until(idle, 'the compile to finish')
    // The source editor is off the page in the stage too, so the pin is read off the status line.
    expect(linkStatus(), 'no pin before the gesture').toBe('')
    linkAt(SAMPLE.indexOf('40'))
    await until(() => linkStatus() !== '', 'the pin to be made')
    tab('asm-0')?.click()
    await until(() => rowOf(0) !== undefined, 'the shown asm view to draw its listing')
    await until(() => linkedPcs().length > 0, 'the shown asm view to mark the pin')
    expect(linkedPcs()).toEqual(['pc0'])
    preset('explorer')
  })
})
