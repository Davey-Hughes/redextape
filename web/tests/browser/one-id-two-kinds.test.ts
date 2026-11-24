import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, type LayoutNode, leaves } from '../../src/layout'
import { bindingKey } from '../../src/view-header'
import { parseWorkspace } from '../../src/workspace'
import { focusInPage, host, hostKind, mountAt, mounted, resetToFourViews, titleText } from './harness'
import { userSplit } from './user-event-fixture'

/**
 * A SWITCH DOES NOT DESTROY THE VIEW THAT HOLDS AN ID ANOTHER TREE NAMES AS ANOTHER KIND — the view layouts spec §5.4.
 *
 * A pick in a view's title changes its kind and keeps its id. So with *TM · program* picked in the rxm view, `rxm-0` is
 * a TM view, while the arrangement remembered for all four still names `rxm-0` as an rxm view, and so does the default
 * of every combination with rxm in it. Entered under that id, such a tree would have `pane-host.ts`'s `applyLayout`
 * build an rxm view over the TM one.
 *
 * A leaf whose id is live as another kind is entered under a new id, so the view that holds the id stays parked and
 * comes back as it left.
 *
 * **AN ID STAYS UNDER TWO KINDS IN STORAGE UNTIL THE TREE THAT NAMES IT WRONGLY IS ENTERED**, and each case says so
 * after each switch: only the tree a switch enters is given new ids. Which of the two a parked view is, is read from
 * which arrangement was left last (`arrangements.ts`'s `liveLeaves`), and the first case returns to its view through
 * the source beside TM so that it is asked: the stale tree for all four is still remembered then, and was left first.
 *
 * **THE PICKED VIEW IS RECOGNISED BY ITS ELEMENT**, as `view-toggles.test.ts` recognises a view kept alive: a TM view
 * built again under `rxm-0` would have the same title, and another element.
 *
 * The toggles and the split are pressed with `userEvent`, as a user presses them. The pick in the title is
 * `.click()`: it is an item of a menu the case does not open.
 */

const errors: string[] = []
const onError = (e: ErrorEvent): void => {
  errors.push(e.message)
}

const FOUR = ['source', 'lambda-0', 'rxm-0', 'tm-0']
const ALL = 'source+lambda+rxm+tm'
const PICKED = 'source+lambda+tm'

/** A press on `kind`'s toggle with the pointer, after which the focus is somewhere in the page (spec §14 item 19). */
const press = async (kind: string): Promise<void> => {
  await userEvent.click(document.querySelector(`#views-shown button[data-shows="${kind}"]`) as HTMLElement)
  await focusInPage(`a press on the ${kind} toggle`)
}

/** The stored trees by key, the one on screen under `screen`, each as its leaves: `rxm-0:tm`. */
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
 * What every case starts with: *TM · program* picked in the rxm view's title. Answers the picked view's first element,
 * which the view's constructor builds, so a view built again under `rxm-0` has another.
 */
type PickedView = { inner: Element }
function pickTm(): PickedView {
  const picker = host('rxm-0')?.querySelector<HTMLButtonElement>('button.view-title')
  picker?.click()
  document
    .getElementById(picker?.getAttribute('aria-controls') ?? '')
    ?.querySelector<HTMLButtonElement>(`button[data-binding="${bindingKey('tm', 'source')}"]`)
    ?.click()
  expect(hostKind('rxm-0'), 'precondition: the pick made the rxm view a TM view under its own id').toBe('tm')
  expect(titleText('rxm-0')).toBe('TM · program')
  expect(storedTrees()[ALL], 'precondition: the tree before the pick is remembered, with rxm-0 an rxm view').toEqual([
    'source:source',
    'lambda-0:lambda',
    'rxm-0:rxm',
    'tm-0:tm',
  ])
  expect(underTwoKinds(), 'precondition: the pick left rxm-0 under two kinds').toEqual(['rxm-0'])
  const inner = host('rxm-0')?.firstElementChild
  if (inner === null || inner === undefined) throw new Error('the picked view has no element to recognise it by')
  return { inner }
}

/** The picked view is on the page as it was left: a TM view under `rxm-0`, its title, and its element. */
function expectThePickedView(was: PickedView, when: string): void {
  expect(titleText('rxm-0'), when).toBe('TM · program')
  expect(hostKind('rxm-0'), when).toBe('tm')
  expect(host('rxm-0')?.firstElementChild, `${when}: the picked view was built again`).toBe(was.inner)
}

beforeAll(async () => {
  window.addEventListener('error', onError)
  await mountAt(1280, 896)
})
afterAll(() => window.removeEventListener('error', onError))

// **ONE PAGE FOR THE FILE, SO EACH CASE PUTS IT BACK FIRST**: the four views on the program under their default ids,
// and nothing remembered that names a view a case before it made.
beforeEach(async () => {
  errors.length = 0
  await resetToFourViews()
  expect(mounted(), 'precondition: all four views').toEqual(FOUR)
  expect(FOUR.map(hostKind), 'precondition: each view is its default kind').toEqual(['source', 'lambda', 'rxm', 'tm'])
  expect(underTwoKinds(), 'precondition: no id is under two kinds').toEqual([])
})

describe('a TM view picked in the rxm view’s title', () => {
  it('is parked by the rxm toggle’s default, which builds its rxm view under a new id', async () => {
    const was = pickTm()

    // THE λ TOGGLE: the source beside TM, which holds neither id. The picked view is parked.
    await press('lambda')
    expect(mounted(), 'precondition: the source beside the TM view').toEqual(['source', 'tm-0'])
    expect(storedTrees()[PICKED], 'precondition: the picked tree is remembered, left last').toContain('rxm-0:tm')
    expect(Object.keys(storedTrees()).at(-1), 'precondition: the picked tree is the last entry').toBe(PICKED)
    expect(underTwoKinds(), 'neither tree that names rxm-0 was entered').toEqual(['rxm-0'])

    // THE rxm TOGGLE: the first visit of source, rxm and TM, whose default names rxm-0 as an rxm view. Built over the
    // parked view, it would take its id: the view comes back built again, below, and no id here is new.
    await press('rxm')
    const built = mounted().filter((id) => !FOUR.includes(id))
    expect(built, 'the default’s rxm view was not built under an id of its own').toHaveLength(1)
    const fresh = built[0] as string
    expect(fresh).toMatch(/^pane-\d+$/)
    expect(mounted()).toEqual(['source', fresh, 'tm-0'])
    expect(titleText(fresh)).toBe('rxm · program')
    expect(storedTrees().screen).toEqual(['source:source', `${fresh}:rxm`, 'tm-0:tm'])
    pageIsTheStoredTree()
    expect(underTwoKinds(), 'neither tree that names rxm-0 was entered').toEqual(['rxm-0'])

    // BACK TO THE COMBINATION THE PICKED VIEW WAS PARKED IN, THROUGH THE SOURCE BESIDE TM. The tree for all four
    // still names rxm-0 as an rxm view, and it was left before the picked tree, so the view is what the picked tree
    // says and is entered under its own id.
    await press('rxm')
    expect(mounted(), 'precondition: the source beside the TM view again').toEqual(['source', 'tm-0'])
    await press('lambda')
    expect(mounted()).toEqual(FOUR)
    expectThePickedView(was, 'back in source, λ and TM')
    pageIsTheStoredTree()
    expect(storedTrees()[ALL], 'precondition: the tree for all four still names rxm-0 as an rxm view').toContain(
      'rxm-0:rxm',
    )

    // ALL FOUR, WHOSE REMEMBERED TREE IS THE ONE BEFORE THE PICK: its rxm view takes a new id too, and no id is
    // under two kinds any longer.
    await press('rxm')
    const second = mounted().filter((id) => !FOUR.includes(id))
    expect(second, 'the remembered tree’s rxm view was not built under an id of its own').toHaveLength(1)
    expect(second[0], 'the two new views share an id').not.toBe(fresh)
    expect(mounted()).toEqual(['source', 'lambda-0', second[0], 'tm-0'])
    expect(hostKind(second[0] as string)).toBe('rxm')
    pageIsTheStoredTree()
    expect(underTwoKinds(), 'the tree that named rxm-0 as an rxm view was entered under that id').toEqual([])

    await press('rxm')
    expect(mounted()).toEqual(FOUR)
    expectThePickedView(was, 'back in source, λ and TM a second time')
    expect(errors, 'a handler threw').toEqual([])
  })

  it('is parked by the rxm toggle alone, which enters the tree before the pick under a new id', async () => {
    const was = pickTm()

    // THE rxm TOGGLE: all four, remembered as the tree before the pick, which names rxm-0 as an rxm view.
    await press('rxm')
    const built = mounted().filter((id) => !FOUR.includes(id))
    expect(built, 'the remembered tree’s rxm view was not built under an id of its own').toHaveLength(1)
    const fresh = built[0] as string
    expect(fresh).toMatch(/^pane-\d+$/)
    expect(mounted()).toEqual(['source', 'lambda-0', fresh, 'tm-0'])
    expect(titleText(fresh)).toBe('rxm · program')
    pageIsTheStoredTree()
    expect(storedTrees()[PICKED], 'the picked tree is not remembered as it was left').toEqual([
      'source:source',
      'lambda-0:lambda',
      'rxm-0:tm',
      'tm-0:tm',
    ])
    expect(underTwoKinds(), 'the switch left an id under two kinds').toEqual([])

    await press('rxm')
    expect(mounted()).toEqual(FOUR)
    expectThePickedView(was, 'after the rxm toggle twice')
    pageIsTheStoredTree()
    expect(underTwoKinds()).toEqual([])

    // A THIRD PRESS SHOWS THE RXM VIEW THE FIRST ONE BUILT, and mints nothing.
    await press('rxm')
    expect(mounted()).toEqual(['source', 'lambda-0', fresh, 'tm-0'])
    expect(errors, 'a handler threw').toEqual([])
  })

  /**
   * **AN EDIT THAT REPLACES THE ARRANGEMENT A PARKED VIEW IS IN LEAVES ITS ID UNDER ONE KIND.** A split of the TM view
   * adds a λ view to the source and the TM view, the combination the picked view is parked in, so the edit replaces the
   * tree it was left in (spec §4.3). The tree for all four still names `rxm-0`, as an rxm view, and the rxm toggle
   * builds that view under `rxm-0` itself, where a tree still naming the id as a TM view would have it built under a
   * new id. The parked view's close shows nowhere here, since the rxm view is built under `rxm-0` either way;
   * `parked-view-replaced.test.ts` holds it.
   */
  it('leaves rxm-0 under one kind when an edit replaces the arrangement the view is parked in', async () => {
    pickTm()
    await press('lambda')
    expect(mounted(), 'precondition: the source beside the TM view').toEqual(['source', 'tm-0'])

    await userSplit('tm-0', bindingKey('lambda', 'source'))

    const trees = storedTrees()
    expect(
      trees.screen?.map((named) => named.split(':')[1]),
      'precondition: source, TM and the added λ view',
    ).toEqual(['source', 'tm', 'lambda'])
    expect(Object.keys(trees), 'the edit did not replace the tree the picked view was parked in').not.toContain(PICKED)
    expect(trees[ALL], 'precondition: the tree for all four still names rxm-0, as an rxm view').toContain('rxm-0:rxm')
    expect(underTwoKinds(), 'an id is still under two kinds').toEqual([])

    await press('rxm')
    expect(mounted(), 'the rxm view was not built under rxm-0').toContain('rxm-0')
    expect(hostKind('rxm-0'), 'the view under rxm-0 is not the rxm view the tree names').toBe('rxm')
    expect(titleText('rxm-0')).toBe('rxm · program')
    pageIsTheStoredTree()
    expect(errors, 'a handler threw').toEqual([])
  })
})
