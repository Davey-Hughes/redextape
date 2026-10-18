import { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, type LayoutNode, leaves } from '../../src/layout'
import { bindingKey } from '../../src/view-header'
import { parseWorkspace } from '../../src/workspace'
import {
  copyNames,
  deleteEveryCopyInline,
  editorsOf,
  focusInPage,
  host,
  hostKind,
  mountAt,
  mounted,
  newLambdaViewItem,
  resetToFourViews,
  titleText,
  until,
} from './harness'

/**
 * A SWITCH DOES NOT DESTROY THE VIEW THAT HOLDS AN ID ANOTHER TREE NAMES AS ANOTHER KIND — the view layouts spec §5.4.
 *
 * A pick in a view's title changes its kind and keeps its id. So with *TM · program* picked in the asm view, `asm-0` is
 * a TM view, while the arrangement remembered for all four still names `asm-0` as an asm view, and so does the default
 * of every combination with asm in it. Entered under that id, such a tree had `pane-host.ts`'s `applyLayout` build an
 * asm view over the TM one. Measured before `arrangements.ts`'s `reidentified` (2026-10-12), with a copy made in the
 * picked view: the λ toggle and then the asm toggle left the copies menu reading `TM copy 1 · not shown`, and so did
 * the asm toggle alone; the combination the copy's view was parked in then showed `TM · program` in its place.
 *
 * A leaf whose id is live as another kind is entered under a new id now, so the view that holds the id stays parked
 * and comes back as it left.
 *
 * **AN ID STAYS UNDER TWO KINDS IN STORAGE UNTIL THE TREE THAT NAMES IT WRONGLY IS ENTERED**, and each case says so
 * after each switch: only the tree a switch enters is given new ids. Which of the two a parked view is, is read from
 * which arrangement was left last (`arrangements.ts`'s `liveLeaves`), and the first case returns to its view through
 * the source beside TM so that it is asked: the stale tree for all four is still remembered then, and was left first.
 *
 * **THE COPY'S VIEW IS RECOGNISED BY ITS ELEMENTS**, as `view-toggles.test.ts` recognises a view kept alive: a view
 * built again on the copy would have the title and the text, and other elements.
 *
 * The toggles, `+ view` and its item are pressed with `userEvent`, as a user presses them. The pick in the title and
 * *edit a copy* are `.click()`: each is an item of a menu the case does not open.
 */

const errors: string[] = []
const onError = (e: ErrorEvent): void => {
  errors.push(e.message)
}

const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']
const ALL = 'source+lambda+asm+tm'
const PICKED = 'source+lambda+tm'

/** A press on `kind`'s toggle with the pointer, after which the focus is somewhere in the page (spec §14 item 19). */
const press = async (kind: string): Promise<void> => {
  await userEvent.click(document.querySelector(`#views-shown button[data-shows="${kind}"]`) as HTMLElement)
  await focusInPage(`a press on the ${kind} toggle`)
}
const editorOf = (id: string): HTMLElement | null =>
  host(id)?.querySelector<HTMLElement>('.term-editor .cm-editor') ?? null
const textOf = (editor: HTMLElement | null): string | null =>
  editor === null ? null : (EditorView.findFromDOM(editor)?.state.doc.toString() ?? null)

/** The stored trees by key, the one on screen under `screen`, each as its leaves: `asm-0:tm`. */
const storedTrees = (): Record<string, string[]> => {
  const ws = parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))
  if (ws === null) throw new Error('the stored workspace does not parse')
  const named = (tree: LayoutNode): string[] => leaves(tree).map((l) => `${l.id}:${l.pane}`)
  return {
    screen: named(ws.tree),
    ...Object.fromEntries(Object.entries(ws.arrangements).map(([key, tree]) => [key, named(tree)])),
  }
}
/** The ids the stored trees hold under two kinds, sorted. */
const underTwoKinds = (): string[] => {
  const kinds = new Map<string, Set<string>>()
  for (const tree of Object.values(storedTrees()))
    for (const named of tree) {
      const [id, kind] = named.split(':') as [string, string]
      kinds.set(id, (kinds.get(id) ?? new Set()).add(kind))
    }
  return [...kinds]
    .filter(([, of]) => of.size > 1)
    .map(([id]) => id)
    .sort()
}
/** Every view on the page is the kind the stored tree on screen says its leaf is. */
const pageIsTheStoredTree = (): void => {
  expect(
    mounted().map((id) => `${id}:${hostKind(id)}`),
    'the page is not the stored tree',
  ).toEqual(storedTrees().screen)
}

/**
 * What every case starts with: *TM · program* picked in the asm view's title, then *edit a copy* in it. Answers the
 * copy's view as it is then: its title, the copies menu's row for one view of it, its editor's element, the first
 * element of its host, and its text.
 *
 * **THE COPY'S NUMBER IS READ, NOT ASSUMED**: the cases share a page, and a deleted copy's number is not given again.
 */
type CopysView = { title: string; row: string; editor: HTMLElement; inner: Element; text: string }
async function pickThenCopy(): Promise<CopysView> {
  const picker = host('asm-0')?.querySelector<HTMLButtonElement>('button.view-title')
  picker?.click()
  document
    .getElementById(picker?.getAttribute('aria-controls') ?? '')
    ?.querySelector<HTMLButtonElement>(`button[data-binding="${bindingKey('tm', 'source')}"]`)
    ?.click()
  expect(hostKind('asm-0'), 'precondition: the pick made the asm view a TM view under its own id').toBe('tm')
  expect(titleText('asm-0')).toBe('TM · program')
  expect(storedTrees()[ALL], 'precondition: the tree before the pick is remembered, with asm-0 an asm view').toEqual([
    'source:source',
    'lambda-0:lambda',
    'asm-0:asm',
    'tm-0:tm',
  ])
  expect(underTwoKinds(), 'precondition: the pick left asm-0 under two kinds').toEqual(['asm-0'])

  host('asm-0')?.querySelector<HTMLButtonElement>('button.detach')?.click()
  await until(() => /^TM · copy \d+$/.test(titleText('asm-0')) && editorsOf('asm-0') === 1, 'the copy and its editor')
  const title = titleText('asm-0')
  const row = `${title.replace(' · ', ' ')} · 1 view`
  const editor = editorOf('asm-0')
  const inner = host('asm-0')?.firstElementChild
  const text = textOf(editor)
  if (editor === null || inner === null || inner === undefined || text === null)
    throw new Error('the copy’s view has no editor to recognise it by')
  expect(text.length, 'precondition: the copy’s editor holds the machine’s text').toBeGreaterThan(100)
  expect(copyNames(), 'precondition: one view shows the copy').toEqual([row])
  return { title, row, editor, inner, text }
}

/** The copy's view is on the page as it was left: its title, its elements, its text, and the copies menu's count. */
function expectTheCopysView(was: CopysView, when: string): void {
  expect(titleText('asm-0'), `${when}: the view under asm-0 does not show the copy`).toBe(was.title)
  expect(hostKind('asm-0'), when).toBe('tm')
  expect(host('asm-0')?.firstElementChild, `${when}: the copy’s view was built again`).toBe(was.inner)
  expect(editorOf('asm-0'), `${when}: the copy’s editor is another one`).toBe(was.editor)
  expect(textOf(editorOf('asm-0')), `${when}: the editor’s text`).toBe(was.text)
  expect(copyNames(), when).toEqual([was.row])
}

beforeAll(async () => {
  window.addEventListener('error', onError)
  await mountAt(1280, 896)
})
afterAll(() => window.removeEventListener('error', onError))

// **ONE PAGE FOR THE FILE, SO EACH CASE PUTS IT BACK FIRST**: no copies, the four views on the program under their
// default ids, and nothing remembered that names a view a case before it made.
beforeEach(async () => {
  errors.length = 0
  deleteEveryCopyInline()
  await resetToFourViews()
  expect(mounted(), 'precondition: all four views').toEqual(FOUR)
  expect(FOUR.map(hostKind), 'precondition: each view is its default kind').toEqual(['source', 'lambda', 'asm', 'tm'])
  expect(copyNames(), 'precondition: no copies').toEqual([])
  expect(underTwoKinds(), 'precondition: no id is under two kinds').toEqual([])
})

describe('a TM view picked in the asm view’s title, showing a copy', () => {
  it('is parked by the asm toggle’s default, which builds its asm view under a new id', async () => {
    const was = await pickThenCopy()

    // THE λ TOGGLE: the source beside TM, which holds neither id. The copy's view is parked.
    await press('lambda')
    expect(mounted(), 'precondition: the source beside the TM view').toEqual(['source', 'tm-0'])
    expect(copyNames(), 'the parked view stopped counting as a view of its copy').toEqual([was.row])
    expect(storedTrees()[PICKED], 'precondition: the picked tree is remembered, left last').toContain('asm-0:tm')
    expect(Object.keys(storedTrees()).at(-1), 'precondition: the picked tree is the last entry').toBe(PICKED)
    expect(underTwoKinds(), 'neither tree that names asm-0 was entered').toEqual(['asm-0'])

    // THE asm TOGGLE: the first visit of source, asm and TM, whose default names asm-0 as an asm view. SOFT, SO A
    // SWITCH THAT BUILT THAT VIEW OVER THE PARKED ONE IS REPORTED BY BOTH: the copy lost its view, and no id was new.
    await press('asm')
    expect.soft(copyNames(), 'the switch destroyed the parked view of the copy').toEqual([was.row])
    const built = mounted().filter((id) => !FOUR.includes(id))
    expect.soft(built, 'the default’s asm view was not built under an id of its own').toHaveLength(1)
    const fresh = built[0] as string
    expect(fresh).toMatch(/^pane-\d+$/)
    expect(mounted()).toEqual(['source', fresh, 'tm-0'])
    expect(titleText(fresh)).toBe('asm · program')
    expect(storedTrees().screen).toEqual(['source:source', `${fresh}:asm`, 'tm-0:tm'])
    pageIsTheStoredTree()
    expect(underTwoKinds(), 'neither tree that names asm-0 was entered').toEqual(['asm-0'])

    // BACK TO THE COMBINATION THE COPY'S VIEW WAS PARKED IN, THROUGH THE SOURCE BESIDE TM. The tree for all four
    // still names asm-0 as an asm view, and it was left before the picked tree, so the view is what the picked tree
    // says and is entered under its own id.
    await press('asm')
    expect(mounted(), 'precondition: the source beside the TM view again').toEqual(['source', 'tm-0'])
    await press('lambda')
    expect(mounted()).toEqual(FOUR)
    expectTheCopysView(was, 'back in source, λ and TM')
    pageIsTheStoredTree()
    expect(storedTrees()[ALL], 'precondition: the tree for all four still names asm-0 as an asm view').toContain(
      'asm-0:asm',
    )

    // ALL FOUR, WHOSE REMEMBERED TREE IS THE ONE BEFORE THE PICK: its asm view takes a new id too, and no id is
    // under two kinds any longer.
    await press('asm')
    const second = mounted().filter((id) => !FOUR.includes(id))
    expect(second, 'the remembered tree’s asm view was not built under an id of its own').toHaveLength(1)
    expect(second[0], 'the two new views share an id').not.toBe(fresh)
    expect(mounted()).toEqual(['source', 'lambda-0', second[0], 'tm-0'])
    expect(hostKind(second[0] as string)).toBe('asm')
    pageIsTheStoredTree()
    expect(copyNames(), 'the switch destroyed the parked view of the copy').toEqual([was.row])
    expect(underTwoKinds(), 'the tree that named asm-0 as an asm view was entered under that id').toEqual([])

    await press('asm')
    expect(mounted()).toEqual(FOUR)
    expectTheCopysView(was, 'back in source, λ and TM a second time')
    expect(errors, 'a handler threw').toEqual([])
  })

  it('is parked by the asm toggle alone, which enters the tree before the pick under a new id', async () => {
    const was = await pickThenCopy()

    // THE asm TOGGLE: all four, remembered as the tree before the pick, which names asm-0 as an asm view. SOFT, AS
    // IN THE CASE ABOVE.
    await press('asm')
    expect.soft(copyNames(), 'the switch destroyed the view of the copy it parked').toEqual([was.row])
    const built = mounted().filter((id) => !FOUR.includes(id))
    expect.soft(built, 'the remembered tree’s asm view was not built under an id of its own').toHaveLength(1)
    const fresh = built[0] as string
    expect(fresh).toMatch(/^pane-\d+$/)
    expect(mounted()).toEqual(['source', 'lambda-0', fresh, 'tm-0'])
    expect(titleText(fresh)).toBe('asm · program')
    pageIsTheStoredTree()
    expect(storedTrees()[PICKED], 'the picked tree is not remembered as it was left').toEqual([
      'source:source',
      'lambda-0:lambda',
      'asm-0:tm',
      'tm-0:tm',
    ])
    expect(underTwoKinds(), 'the switch left an id under two kinds').toEqual([])

    await press('asm')
    expect(mounted()).toEqual(FOUR)
    expectTheCopysView(was, 'after the asm toggle twice')
    pageIsTheStoredTree()
    expect(underTwoKinds()).toEqual([])

    // A THIRD PRESS SHOWS THE ASM VIEW THE FIRST ONE BUILT, and mints nothing.
    await press('asm')
    expect(mounted()).toEqual(['source', 'lambda-0', fresh, 'tm-0'])
    expect(copyNames()).toEqual([was.row])
    expect(errors, 'a handler threw').toEqual([])
  })

  /**
   * **AN EDIT THAT REPLACES THE ARRANGEMENT A PARKED VIEW IS IN CLOSES THE VIEW, WHATEVER ELSE NAMES ITS ID.** `+ view`
   * adds a λ view beside the source and the TM view, which is the combination the copy's view is parked in, so the
   * tree it was left in is replaced by the edit (spec §4.3) and no tree holds the view. The tree for all four still
   * names `asm-0`, as an asm view. Measured while `applyLayout` kept a parked pane on its id alone (2026-10-12): the
   * copies menu went on reading `TM copy 1 · 1 view` here, until the asm toggle built an asm view over it.
   */
  it('is closed when an edit replaces the arrangement it is parked in, though another still names its id', async () => {
    const was = await pickThenCopy()
    await press('lambda')
    expect(mounted(), 'precondition: the source beside the TM view').toEqual(['source', 'tm-0'])
    expect(copyNames(), 'precondition: the parked view counts as a view of its copy').toEqual([was.row])

    host('tm-0')?.querySelector<HTMLElement>('button.view-title')?.focus()
    await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
    await until(() => newLambdaViewItem() !== undefined, '+ view’s λ · program')
    await userEvent.click(newLambdaViewItem() as HTMLButtonElement)

    const trees = storedTrees()
    expect(
      trees.screen?.map((named) => named.split(':')[1]),
      'precondition: source, TM and the added λ view',
    ).toEqual(['source', 'tm', 'lambda'])
    expect(Object.keys(trees), 'precondition: the edit replaced the tree the copy’s view was parked in').not.toContain(
      PICKED,
    )
    expect(trees[ALL], 'precondition: the tree for all four still names asm-0, as an asm view').toContain('asm-0:asm')
    expect(copyNames(), 'a view no tree holds still counts as a view of its copy').toEqual([
      was.row.replace('1 view', 'not shown'),
    ])
    expect(errors, 'a handler threw').toEqual([])
  })
})
