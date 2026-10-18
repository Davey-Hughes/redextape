import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, type LayoutNode, leaves, MAX_TREE_LEAVES } from '../../src/layout'
import { parseWorkspace, serializeWorkspace } from '../../src/workspace'
import {
  copyNames,
  editorsOf,
  focusInPage,
  fourViewWorkspace,
  host,
  hostKind,
  leafOf,
  mounted,
  newLambdaViewItem,
  noticeText,
  pressed,
  rowOfLeaves,
  SHELL,
  stateIdle,
  storedLayoutText,
  titleText,
  toggle,
  until,
} from './harness'

/**
 * A STORED WORKSPACE THAT ALREADY HOLDS ONE ID UNDER TWO KINDS — the view layouts spec §5.4. A pick in a view's title
 * leaves storage so until the next switch into the tree that names the id as the kind it was, and a workspace stored
 * before `arrangements.ts`'s `reidentified` can hold any number of them. Each tree is valid alone, so the workspace
 * parses; a switch into such a tree gives the leaf a new id, and no view is built over another.
 *
 * The page opens on the source, an asm view and a TM view, 63 live views in all:
 *
 * - `source+tm` is remembered as the source beside `asm-0`, a TM view there and the asm view on screen;
 * - `source+asm` is remembered as the source beside `tm-0`, an asm view there and the TM view on screen;
 * - `lambda` is remembered as 60 λ views, which are there to count.
 *
 * **AND THE BOUND IS ASKED OF THE TREE AS IT IS ENTERED** (§5.6): a leaf entered under a new id is one more live view.
 * The first switch here takes the 63 to 64 and goes through; the second would take them to 65 and is refused, where
 * the tree as it is remembered names no id the workspace does not hold already. A workspace of 65 is one
 * `parseWorkspace` refuses, so that switch, let through, would cost the next load every arrangement.
 *
 * Storage is read once, at the mount, so the workspace is stored before it and this is a file of its own. **THE CASES
 * RUN IN ORDER ON ONE PAGE**, each from the state the one before left, and each asserts that state first.
 */

const pair = (a: LayoutNode, b: LayoutNode): LayoutNode => ({
  kind: 'split',
  dir: 'row',
  sizes: [0.5, 0.5],
  children: [a, b],
})
/** 60 λ views in one row. */
const SIXTY = rowOfLeaves(60)
const ON_SCREEN: LayoutNode = {
  kind: 'split',
  dir: 'row',
  sizes: [0.4, 0.3, 0.3],
  children: [leafOf('source', 'source'), leafOf('asm-0', 'asm'), leafOf('tm-0', 'tm')],
}
const SEEDED = serializeWorkspace({
  ...fourViewWorkspace(),
  tree: ON_SCREEN,
  focused: 'asm-0',
  arrangements: {
    'source+tm': pair(leafOf('source', 'source'), leafOf('asm-0', 'tm')),
    'source+asm': pair(leafOf('source', 'source'), leafOf('tm-0', 'asm')),
    lambda: SIXTY,
  },
})
const REFUSED =
  'showing source and asm would take the workspace from 64 views to 65, and it can keep 64 — reset preset makes room'

/** The stored workspace's trees, and how many ids they name between them; a throw where it does not parse. */
const storedTrees = (): { live: number; twoKinds: string[]; screen: string[] } => {
  const ws = parseWorkspace(storedLayoutText())
  if (ws === null) throw new Error('the stored workspace does not parse')
  const kinds = new Map<string, Set<string>>()
  for (const tree of [ws.tree, ...Object.values(ws.arrangements)])
    for (const l of leaves(tree)) kinds.set(l.id, (kinds.get(l.id) ?? new Set()).add(l.pane))
  return {
    live: kinds.size,
    twoKinds: [...kinds]
      .filter(([, of]) => of.size > 1)
      .map(([id]) => id)
      .sort(),
    screen: leaves(ws.tree).map((l) => `${l.id}:${l.pane}`),
  }
}

beforeAll(async () => {
  await page.viewport(1280, 896)
  localStorage.setItem(LAYOUT_STORAGE_KEY, SEEDED)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
})

describe('a stored workspace with asm-0 and tm-0 each under two kinds', () => {
  let asmView: { inner: Element; editor: Element }

  it('opens as it was stored', () => {
    // A WORKSPACE THE LOADER REFUSED WOULD HAVE OPENED ON THE DEFAULT, the source beside the TM view.
    expect(mounted()).toEqual(['source', 'asm-0', 'tm-0'])
    expect(['asm-0', 'tm-0'].map(hostKind)).toEqual(['asm', 'tm'])
    const opened = storedTrees()
    expect(opened.twoKinds, 'precondition: two ids are stored under two kinds').toEqual(['asm-0', 'tm-0'])
    expect(opened.live, 'precondition: one short of the bound').toBe(MAX_TREE_LEAVES - 1)
  })

  it('enters the tree that names the asm view’s id as a TM view under a new id, and parks the asm view', async () => {
    host('asm-0')?.querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => titleText('asm-0') === 'asm · copy 1' && editorsOf('asm-0') === 1, 'the copy and its editor')
    const inner = host('asm-0')?.firstElementChild
    const editor = host('asm-0')?.querySelector('.term-editor .cm-editor')
    if (inner === null || inner === undefined || editor === null || editor === undefined)
      throw new Error('the copy’s view has nothing to recognise it by')
    asmView = { inner, editor }
    expect(copyNames(), 'precondition: one view shows the copy').toEqual(['asm copy 1 · 1 view'])

    await userEvent.click(toggle('asm'))
    await focusInPage('a press on the asm toggle, which parks the asm view')
    expect
      .soft(copyNames(), 'the switch built a TM view over the asm view of the copy')
      .toEqual(['asm copy 1 · 1 view'])
    const built = mounted().filter((id) => id !== 'source')
    expect.soft(built, 'the TM view was built under the asm view’s id').not.toEqual(['asm-0'])
    expect(built).toHaveLength(1)
    const fresh = built[0] as string
    // THE LEAF COUNTER STEPPED PAST EVERY LIVE ID AT THE LOAD, the 60 off the screen included.
    expect(fresh).toBe('pane-61')
    expect(hostKind(fresh)).toBe('tm')
    expect(titleText(fresh)).toBe('TM · program')
    const now = storedTrees()
    expect(now.screen).toEqual(['source:source', `${fresh}:tm`])
    expect(now.twoKinds, 'the tree entered still names an id as another kind').toEqual(['tm-0'])
    expect(now.live, 'the view built is one more live view').toBe(MAX_TREE_LEAVES)
  })

  it('shows the asm view as it was left when the asm toggle is pressed again', async () => {
    expect(pressed(), 'precondition: the source beside a TM view').toEqual(['source', 'tm'])
    await userEvent.click(toggle('asm'))
    await focusInPage('a press on the asm toggle, which shows the asm view again')
    expect(mounted()).toEqual(['source', 'asm-0', 'tm-0'])
    expect(titleText('asm-0')).toBe('asm · copy 1')
    expect(host('asm-0')?.firstElementChild, 'the asm view was built again').toBe(asmView.inner)
    expect(host('asm-0')?.querySelector('.term-editor .cm-editor'), 'the copy’s editor is another one').toBe(
      asmView.editor,
    )
    expect(copyNames()).toEqual(['asm copy 1 · 1 view'])
  })

  /**
   * The TM toggle asks for the source beside asm, remembered as the source beside `tm-0`: both ids are live, so the
   * tree as it is remembered would leave the workspace at 64. `tm-0` is the TM view on screen, so the leaf is
   * entered under a new id, and that is a 65th.
   */
  it('refuses a switch whose leaf under a new id would be a 65th live view, and changes nothing', async () => {
    expect(mounted(), 'precondition: the source, the asm view and the TM view').toEqual(['source', 'asm-0', 'tm-0'])
    expect(storedTrees().live, 'precondition: the workspace is at the bound').toBe(MAX_TREE_LEAVES)
    expect(toggle('tm').getAttribute('aria-disabled'), 'precondition: the TM toggle can be pressed').toBeNull()
    const before = { mounted: mounted(), pressed: pressed(), stored: storedLayoutText() }

    await userEvent.click(toggle('tm'))
    await focusInPage('a press on the TM toggle, whose switch is refused')
    expect.soft(noticeText(), 'the switch was not refused').toBe(REFUSED)
    expect.soft(pressed(), 'the refused switch moved the toggles').toEqual(before.pressed)
    expect.soft(mounted(), 'the refused switch changed the views on the page').toEqual(before.mounted)
    expect.soft(storedLayoutText() === before.stored, 'the refused switch stored another workspace').toBe(true)
    expect.soft(parseWorkspace(storedLayoutText()), 'the stored workspace is one the loader refuses').not.toBeNull()
  })

  /**
   * **A REFUSED SWITCH MINTS NO ID**, as a refused add mints none (`pane-host.ts`'s `admit`): `main.ts`'s `switchTo`
   * asks the bound of the tree with ids that are not minted. The first switch here took `pane-61`. *Reset preset*
   * forgets every arrangement, which makes room for an add, and the view added takes the number after it.
   */
  it('left the leaf counter where it was: after reset preset, the view + view adds is pane-62', async () => {
    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
    expect(mounted(), 'precondition: the reset shows the source beside the TM view').toEqual(['source', 'tm-0'])
    expect(storedTrees().live, 'precondition: the reset forgot every arrangement').toBe(2)
    await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
    await until(() => newLambdaViewItem() !== undefined, '+ view’s λ · program')
    await userEvent.click(newLambdaViewItem() as HTMLButtonElement)
    expect(
      mounted().filter((id) => id !== 'source' && id !== 'tm-0'),
      'the refused switch minted an id',
    ).toEqual(['pane-62'])
  })
})
