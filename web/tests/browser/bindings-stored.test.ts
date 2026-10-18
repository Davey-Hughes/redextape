import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { bindingKey } from '../../src/view-header'
import { storedBindings, storedBuffers } from './copy-text-fixture'
import {
  deleteEveryCopyInline,
  editorsOf,
  host,
  mounted,
  press,
  pressShownToggle,
  resetToFourViews,
  SHELL,
  stateIdle,
  titleText,
  until,
} from './harness'

/**
 * WHICH VIEW SHOWS WHICH COPY, AS STORAGE HAS IT, AFTER A GESTURE THAT BUILDS OR DROPS A VIEW.
 *
 * `redextape.buffers` stores the copies and, beside them, which leaf shows which. A reload takes any stored binding
 * whose leaf the stored tree holds on the same leg. The bindings were written at a fork, a pick in a title, a pause
 * and a delete, and not when a view was closed, added, or built again. So a `✕` on a view of a copy left its leaf
 * bound in storage, the view its toggle built there next was on the program, and a reload put that view on the closed
 * view's copy: measured on `5ff63af` by seeding a second page with what the first had stored, which opened reading
 * `λ · copy 1`. `pane-host.ts`'s `applyLayout` writes the bindings now, each time it has built or dropped views.
 *
 * **EACH CASE WAITS FOR ITS COPY'S BUILD BEFORE ITS GESTURE.** A copy's build stores the bindings when its reply
 * lands, and a reply that landed after the gesture would write them right whatever the gesture did. The reply is
 * what mounts a new copy's editor, so the editor is what is waited for.
 *
 * **A RELOAD IS NOT DRIVEN HERE**: a file has one mount (`buffer-restore.test.ts` has why), and what a reload reads is
 * the stored value these cases hold.
 *
 * **THE GESTURE EACH CASE IS ABOUT IS MADE WITH THE POINTER**: a `✕`, a toggle, *reset preset*, `+ view` and a pick in
 * a title, each a press as a user makes one (`press`). The copy a case starts from, and the page put back before
 * each, are arranged with `.click()`.
 */

const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']

/**
 * Make a copy in `view` and wait for its build's reply, which is the last write a copy makes by itself. Answers the
 * copy's session and the title a view showing it has.
 */
async function copyIn(view: string): Promise<{ session: string; onCopy: string }> {
  host(view)?.querySelector<HTMLButtonElement>('button.detach')?.click()
  await until(() => / · copy \d+$/.test(titleText(view)) && editorsOf(view) === 1, 'the copy and its editor')
  const key = host(view)?.querySelector<HTMLElement>('button.view-title')?.dataset.binding ?? ''
  const session = /^[a-z]+:(scratch-\d+)$/.exec(key)?.[1]
  if (session === undefined) throw new Error(`the view’s title does not name a copy: ${JSON.stringify(key)}`)
  expect(
    storedBuffers()?.buffers.map((b) => b.id),
    'precondition: the copy is the only one stored',
  ).toEqual([session])
  expect(storedBindings(), 'precondition: the fork stored the view as showing its copy').toEqual({ [view]: session })
  return { session, onCopy: titleText(view) }
}

beforeAll(async () => {
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(stateIdle, 'the first compile')
})

// **ONE PAGE FOR THE FILE, SO EACH CASE PUTS IT BACK FIRST**: no copies, the four views on the program, and nothing
// remembered that names a view a case before it made.
beforeEach(async () => {
  deleteEveryCopyInline()
  await resetToFourViews()
  expect(mounted(), 'precondition: all four views').toEqual(FOUR)
  expect(storedBindings(), 'precondition: no view is stored as showing a copy').toEqual({})
})

describe('the stored bindings', () => {
  it('lose a closed view’s at its ✕, and the view its toggle builds there is stored on the program', async () => {
    const { session } = await copyIn('lambda-0')

    await press('#views [data-leaf="lambda-0"]:not([role="tab"]) button.view-close')
    expect(mounted(), 'precondition: the view is closed').toEqual(['source', 'asm-0', 'tm-0'])
    expect(storedBindings(), 'a closed view is still stored as showing its copy').toEqual({})

    await pressShownToggle('lambda')
    expect(mounted(), 'precondition: all four views again').toEqual(FOUR)
    expect(titleText('lambda-0'), 'precondition: the view built where the closed one was shows the program').toBe(
      'λ · program',
    )
    expect(storedBindings(), 'a reload would put the new view on the closed view’s copy').toEqual({})
    expect(
      storedBuffers()?.buffers.map((b) => b.id),
      'the copy itself is kept',
    ).toEqual([session])
  })

  it('lose the binding of a view *reset preset* builds again on the program, under the id it had', async () => {
    await copyIn('tm-0')

    await press('#workspace')
    await press('#reset-preset')
    expect(mounted(), 'precondition: the reset shows the source beside the TM view').toEqual(['source', 'tm-0'])
    expect(titleText('tm-0'), 'precondition: the TM view is on the program').toBe('TM · program')
    expect(storedBindings(), 'a reload would put the rebuilt view back on its copy').toEqual({})
  })

  it('keep a parked view’s, and lose it once the view is gone and another has its id', async () => {
    const { session, onCopy } = await copyIn('lambda-0')

    await pressShownToggle('lambda')
    expect(mounted(), 'precondition: the λ view is parked').toEqual(['source', 'asm-0', 'tm-0'])
    expect(storedBindings(), 'a parked view still shows its copy, and is stored so').toEqual({ 'lambda-0': session })
    await pressShownToggle('lambda')
    expect(titleText('lambda-0'), 'precondition: the parked view comes back showing its copy').toBe(onCopy)
    await pressShownToggle('lambda')
    expect(mounted(), 'precondition: the λ view is parked again').toEqual(['source', 'asm-0', 'tm-0'])

    // *RESET PRESET* FORGETS THE ARRANGEMENT THAT HELD THE PARKED VIEW, which closes it; the λ toggle then builds
    // another view under its id.
    await press('#workspace')
    await press('#reset-preset')
    expect(mounted(), 'precondition: the reset shows the source beside the TM view').toEqual(['source', 'tm-0'])
    await pressShownToggle('lambda')
    expect(mounted(), 'precondition: a λ view again, under the parked view’s id').toEqual([
      'source',
      'lambda-0',
      'tm-0',
    ])
    expect(titleText('lambda-0'), 'precondition: the view that has the parked view’s id shows the program').toBe(
      'λ · program',
    )
    expect(storedBindings(), 'a reload would put the new view on the parked view’s copy').toEqual({})
  })

  it('gain a view that `+ view` adds on a copy', async () => {
    const { session, onCopy } = await copyIn('lambda-0')

    host('lambda-0')?.querySelector<HTMLElement>('button.view-title')?.focus()
    const before = new Set(mounted())
    await press('#new-view')
    await press(`#new-view-menu button[data-binding="${bindingKey('lambda', session)}"]`)
    const second = mounted().find((id) => !before.has(id))
    if (second === undefined) throw new Error('+ view added no second view of the copy')
    expect(titleText(second), 'precondition: the new view shows the copy').toBe(onCopy)
    expect(storedBindings(), 'a reload would put the added view on the program').toEqual({
      'lambda-0': session,
      [second]: session,
    })
  })

  it('lose the binding of a view picked onto another leg', async () => {
    await copyIn('lambda-0')

    const title = host('lambda-0')?.querySelector<HTMLButtonElement>('button.view-title')
    await press('#views [data-leaf="lambda-0"]:not([role="tab"]) button.view-title')
    await press(`#${title?.getAttribute('aria-controls')} button[data-binding="${bindingKey('tm', 'source')}"]`)
    expect(titleText('lambda-0'), 'precondition: the view is a TM view of the program now').toBe('TM · program')
    expect(host('lambda-0')?.dataset.kind, 'precondition: the leaf changed kind and kept its id').toBe('tm')
    expect(storedBindings(), 'the view is still stored as showing the λ copy it left').toEqual({})
  })
})
