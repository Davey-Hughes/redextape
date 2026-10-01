import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { BUFFERS_STORAGE_KEY, parseBuffers } from '../../src/buffers-store'
import { defaultLayout, splitLeaf } from '../../src/layout'
import { encodeLink, type SharePayload } from '../../src/share-link'
import { bindingKey } from '../../src/view-header'
import { defaultWorkspace, PRESETS, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A LINK PASTED INTO AN OPEN PAGE, AND ITS UNDO** — Plan 7 part 6a spec §5.3 and §5.5, heard as `hashchange`. The
 * page opens on `let x = 40; x + 2` in Explorer, and a second λ view is put on a copy first, beside the λ view of the
 * program. A whole link replaces the program and the workspace and builds every view again on the program — the λ
 * view its tree shares too, so it is drawn as the link says; its `undo` puts back the program, the workspace and the
 * copy's view, and goes at the next edit or encoding chosen. A link whose workspace cannot be read opens the program
 * alone; one that cannot be read at all changes nothing; any other fragment is left alone. ONE MOUNT FOR THE FILE, for
 * the reason every sibling gives.
 *
 * **THE LINKS CARRY TWO-LINE PROGRAMS, NOT EXAMPLES**: no case here is about a recording, and at a tenth of a core,
 * taking in an example's λ frames held the page's main thread past the seconds the open's `undo` is offered for.
 */

const LINKED = 'let y = 10; y + 5'
const OTHER = 'let z = 3; z + 4'
/**
 * The Debugger preset, with each part of the workspace the opener's differs in: its λ view drawn as an outline where
 * the opener's is code, so a view kept by the open would show; the inspector shut and the source outline open, the
 * other way round from the opener's; and a second λ view, `pane-2`, the id the opener's next view would take.
 */
const LINK: SharePayload = {
  program: LINKED,
  encoding: 'binary',
  workspace: serializeWorkspace({
    ...defaultWorkspace(),
    tree: splitLeaf(defaultLayout(), 'lambda-0', 'row', 'pane-2', 'lambda'),
    switches: PRESETS.debugger,
    display: { 'lambda-0': { layout: 'outline', vars: 'names', map: 'icicle' } },
    inspector: false,
    panels: { source: { outline: true } },
  }),
  positions: {},
}

const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const readout = () => [...document.querySelectorAll('#results .segment, #results .row')].length
const shows = (leaf: string) =>
  document.querySelector<HTMLElement>(`[data-leaf="${leaf}"] .view-title`)?.dataset.binding ?? ''
const lambdaLayout = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term')?.dataset.layout
/** The views on the page, by leaf. */
const leaves = () => [...document.querySelectorAll<HTMLElement>('.pane[data-leaf]')].map((p) => p.dataset.leaf ?? '')
const storedBindings = () => parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))?.bindings
const workspaceName = () => document.querySelector('#workspace')?.textContent
const panelOpen = (where: string) => document.querySelector<HTMLElement>(`${where} .panel`)?.dataset.open

let view: EditorView
/** The copy, as its binding reads, and the leaf of the view added to show it. */
let copy = ''
let copyLeaf = ''

/** Paste `fragment` into the address bar, as far as the page can tell: a `hashchange`. */
async function paste(fragment: string, until_: () => boolean, what: string): Promise<void> {
  location.hash = fragment
  await until(until_, what)
}

beforeAll(async () => {
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && readout() === 3, 'the first compile')
  // A COPY, THEN A VIEW OF IT, THEN THE λ VIEW BACK ON THE PROGRAM: the copy's view is one the link's tree lacks.
  document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
  await until(() => shows('lambda-0') !== bindingKey('lambda', 'source'), 'the copy')
  copy = shows('lambda-0')
  const before = new Set(leaves())
  await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
  await userEvent.click(
    document.querySelector<HTMLButtonElement>(`#new-view-menu button[data-binding="${copy}"]`) as HTMLButtonElement,
  )
  await until(() => leaves().some((l) => !before.has(l)), 'the view of the copy')
  copyLeaf = leaves().find((l) => !before.has(l)) ?? ''
  await userEvent.click(
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-title') as HTMLButtonElement,
  )
  await userEvent.click(
    document.querySelector<HTMLButtonElement>(
      `[data-leaf="lambda-0"] [popover] button[data-binding="${bindingKey('lambda', 'source')}"]`,
    ) as HTMLButtonElement,
  )
  await until(() => shows('lambda-0') === bindingKey('lambda', 'source'), 'the λ view back on the program')
})

describe('a whole link pasted into an open page', () => {
  it('replaces the program and its encoding, and clears the fragment', async () => {
    expect(shows(copyLeaf)).toBe(copy)
    await until(() => lambdaLayout() !== 'flat', 'the λ tree')
    expect(lambdaLayout()).toBe('code')
    // THE COPY'S VIEW IS STORED AS BOUND TO IT, which a reload on the link's tree would read as a leaf id's collision.
    expect(storedBindings()).toHaveProperty(copyLeaf)
    await paste(await encodeLink(LINK), () => noticeText() === 'opened a shared link', 'the open')
    expect(view.state.doc.toString()).toBe(LINKED)
    expect(picker().value).toBe('binary')
    expect(location.hash).toBe('')
    expect(undoButton()?.textContent).toBe('undo')
    expect(storedBindings()).toEqual({})
  })

  it("replaces the workspace, building every view again on the program in the link's display", async () => {
    expect(workspaceName()).toBe('Debugger ▾')
    expect(document.querySelector<HTMLElement>('#step-bar')?.hidden).toBe(false)
    expect(leaves()).toEqual(['source', 'lambda-0', 'pane-2', 'asm-0', 'tm-0'])
    expect(shows('lambda-0')).toBe(bindingKey('lambda', 'source'))
    // THE λ VIEW'S LEAF AND KIND SURVIVE THE OPEN, AND IT WAS ON THE PROGRAM: only a rebuild shows the link's display.
    // **READ ONCE ITS TREE HAS ARRIVED**: until a step's tree lands, the view is drawn `flat` whatever its display.
    await until(() => lambdaLayout() !== 'flat', 'the λ tree')
    expect(lambdaLayout()).toBe('outline')
    expect(panelOpen('#inspector')).toBe('false')
    expect(panelOpen('[data-leaf="source"]')).toBe('true')
    expect(document.querySelector('#buffers')?.textContent).toBe('copies 1 ▾')
  })

  // **THE UNDO IS USED BEFORE ANY WAIT ON THE LINK'S COMPILE**, which would spend the seconds it is offered for.
  it('puts back the program, the workspace and the copy’s view on undo', async () => {
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
    expect(picker().value).toBe('unary')
    expect(workspaceName()).toBe('Explorer ▾')
    expect(shows(copyLeaf)).toBe(copy)
    expect(shows('lambda-0')).toBe(bindingKey('lambda', 'source'))
    expect(panelOpen('#inspector')).toBe('true')
    expect(panelOpen('[data-leaf="source"]')).toBe('false')
    expect(noticeText()).toBe('put back the program and the workspace')
    expect(document.activeElement).toBe(view.contentDOM)
    await until(() => lambdaLayout() !== 'flat', 'the λ tree')
    expect(lambdaLayout()).toBe('code')
    await until(() => idle() && readout() === 3, 'the program’s compile')
  })

  it('withdraws the undo at the next edit that changes the program', async () => {
    await paste(await encodeLink(LINK), () => undoButton() !== null, 'the open')
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n' } })
    expect(undoButton()).toBeNull()
  })

  it('withdraws the undo at the next encoding chosen', async () => {
    await paste(await encodeLink({ ...LINK, program: OTHER }), () => undoButton() !== null, 'the open')
    await userEvent.selectOptions(picker(), 'unary')
    expect(undoButton()).toBeNull()
    await until(() => idle() && readout() > 0, 'the compile under unary')
  })

  // THE LINK'S TREE HOLDS `pane-2`, THE ID THE OPENER'S NEXT VIEW WOULD HAVE TAKEN: the next is minted past it.
  it("adds a view beside a link's views without taking an id its tree holds", async () => {
    // **THE PAGE IS ON `OTHER`, AS THE CASE ABOVE LEFT IT, SO ONLY THIS OPEN PUTS `LINKED` IN THE EDITOR.** That case's
    // open put `pane-2` on the page already, and a wait on it let this open land in the middle of the gesture.
    expect(view.state.doc.toString()).toBe(OTHER)
    await paste(await encodeLink(LINK), () => view.state.doc.toString() === LINKED, 'the open')
    const before = new Set(leaves())
    await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
    await userEvent.click(
      document.querySelector<HTMLButtonElement>(
        `#new-view-menu button[data-binding="${bindingKey('lambda', 'source')}"]`,
      ) as HTMLButtonElement,
    )
    await until(() => leaves().some((l) => !before.has(l)), 'the view')
    expect(leaves().filter((l) => l === 'pane-2')).toHaveLength(1)
  })

  /**
   * **ANOTHER OPEN TAKES THE UNDO'S PLACE**: its `undo` puts back what that open replaced, which is the earlier link's
   * program, and not what the earlier one did. **THE PAGE STARTS ON A PROGRAM NEITHER LINK HOLDS**, so the two are told
   * apart, and each paste waits for the program only its own open puts in the editor. Two links whose reads overlap are
   * `share-open-latest.test.ts`'s case, not this one.
   */
  it('offers the later open’s undo when a second link opens', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await paste(await encodeLink(LINK), () => view.state.doc.toString() === LINKED, 'the first open')
    await paste(await encodeLink({ ...LINK, program: OTHER }), () => view.state.doc.toString() === OTHER, 'the second')
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe(LINKED)
    expect(undoButton()).toBeNull()
  })
})

describe('any other link pasted into an open page', () => {
  it('opens the program alone when the workspace cannot be read, and undo puts back the program alone', async () => {
    await until(() => idle() && readout() > 0, 'the compile')
    const before = view.state.doc.toString()
    const workspace = workspaceName()
    // **THE PAGE IS ON `binary` AND THE LINK IS ON `unary`**, so the encoding on the page after the open is the link's
    // and not the picker's own.
    expect(picker().value).toBe('binary')
    await paste(
      await encodeLink({ ...LINK, program: OTHER, encoding: 'unary', workspace: 'not a workspace' }),
      () => noticeText().startsWith("opened a shared link's program"),
      'the open',
    )
    expect(noticeText()).toBe("opened a shared link's program — its workspace and step positions were left out")
    expect(view.state.doc.toString()).toBe(OTHER)
    expect(picker().value).toBe('unary')
    expect(workspaceName()).toBe(workspace)
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe(before)
    expect(picker().value).toBe('binary')
    expect(noticeText()).toBe('put back the program')
  })

  // **A BARE `#s=` IS THE LIKELIEST CUT PASTE.** Before the case below, so the notice it waits for is not that case's.
  it('changes nothing for a link with nothing after `#s=`, and says so', async () => {
    const before = view.state.doc.toString()
    expect(noticeText()).toBe('put back the program')
    await paste('#s=', () => noticeText() === 'this link could not be read — nothing was changed', 'it')
    expect(view.state.doc.toString()).toBe(before)
    expect(undoButton()).toBeNull()
    expect(location.hash).toBe('')
  })

  it('changes nothing for a link that cannot be read, and says so', async () => {
    const before = view.state.doc.toString()
    // **THE NOTICE IS THE SAME AS THE CASE ABOVE'S**, so the open is waited for by the fragment it clears as well.
    await paste(
      '#s=not*a*link',
      () => location.hash === '' && noticeText() === 'this link could not be read — nothing was changed',
      'it',
    )
    expect(view.state.doc.toString()).toBe(before)
    expect(undoButton()).toBeNull()
    expect(location.hash).toBe('')
  })

  it('leaves a fragment that is not a link alone', async () => {
    const said = noticeText()
    location.hash = '#section'
    await new Promise<void>((resolve) => addEventListener('hashchange', () => resolve(), { once: true }))
    expect(location.hash).toBe('#section')
    expect(noticeText()).toBe(said)
    history.replaceState(null, '', `${location.pathname}${location.search}`)
  })
})
