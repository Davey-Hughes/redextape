import { beforeAll, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { PC_COLUMNS } from '../../src/clif-view'
import { LAYOUT_STORAGE_KEY, type LayoutNode } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace, type Workspace } from '../../src/workspace'
import { textColumn } from './clif-fixture'
import { host, menuOf, moreOf, mountAt, mounted, storedLayout, until } from './harness'

/**
 * **A CLIF VIEW'S LAYOUT IS STORED WITH THE WORKSPACE, UNDER THE VIEW'S ID**, as a λ view's display settings are.
 * Seeded before `main.ts` is imported, as `tm-display-restore.test.ts` is and for its reason: only the seed crosses all
 * three places the setting does on its way back, `main.ts` restoring it, `displayOf` answering for the leaf, and
 * `pane-host.ts` building the view with it.
 */

/** The source beside a CLIF view. */
const SOURCE_AND_CLIF: LayoutNode = {
  kind: 'split',
  dir: 'row',
  sizes: [0.5, 0.5],
  children: [
    { kind: 'leaf', id: 'source', pane: 'source' },
    { kind: 'leaf', id: 'clif-0', pane: 'clif' },
  ],
}

beforeAll(async () => {
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({
      ...defaultWorkspace('wide'),
      tree: SOURCE_AND_CLIF,
      focused: 'source',
      clifDisplay: { 'clif-0': { layout: 'exact' } },
    }),
  )
  await mountAt(1280, 896)
}, 30_000)

const clif = () => host('clif-0') as HTMLElement
const item = () => menuOf(moreOf(clif())).querySelector<HTMLButtonElement>('button.clif-compact') as HTMLButtonElement
const stored = () => storedLayout<Pick<Workspace, 'clifDisplay'>>().clifDisplay?.['clif-0']

/** Where the text of the instruction about to run starts, in columns right of its pc column. */
function nextColumn(): number {
  const row = clif().querySelector<HTMLElement>('.clif-row.is-next') as HTMLElement
  const pc = row.querySelector('.rxm-pc') as HTMLElement
  expect(pc.textContent?.length ?? 0, 'precondition: a label no wider than the pc column').toBeLessThanOrEqual(
    PC_COLUMNS,
  )
  const box = pc.getBoundingClientRect()
  return textColumn(row, box.right, box.width / PC_COLUMNS)
}

it('builds the view with the layout its workspace stored, and stores the one a press chooses', async () => {
  expect(mounted(), 'precondition: the stored workspace').toEqual(['source', 'clif-0'])
  await until(() => clif().querySelector('.clif-row.is-next') !== null, 'the CLIF view to show its step 0')
  expect(item().getAttribute('aria-checked'), 'compact, unchecked').toBe('false')
  expect(nextColumn(), 'the stored layout, exact').toBe(31)

  await userEvent.click(moreOf(clif()))
  await until(() => menuOf(moreOf(clif())).matches(':popover-open'), 'the view menu to open')
  await userEvent.click(item())
  expect(nextColumn(), 'compact, pressed').toBe(5)
  expect(item().getAttribute('aria-checked'), 'compact, checked').toBe('true')
  expect(stored()).toEqual({ layout: 'compact' })

  await userEvent.click(item())
  expect(nextColumn(), 'exact, pressed again').toBe(31)
  expect(item().getAttribute('aria-checked'), 'compact, unchecked again').toBe('false')
  expect(stored()).toEqual({ layout: 'exact' })
})
