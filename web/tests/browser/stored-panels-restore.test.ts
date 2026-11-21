import { beforeAll, describe, expect, it } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { LEGS } from '../../src/legs'
import { LEG_PANELS } from '../../src/panes'
import type { Leg } from '../../src/protocol'
import { RxmPane } from '../../src/rxm-pane'
import { TmPane } from '../../src/tm-pane'
import { serializeWorkspace } from '../../src/workspace'
import { fourViewWorkspace, host, inertEvents, SHELL, stateIdle, until } from './harness'

/**
 * **EVERY PANEL OF `LEG_PANELS` COMES BACK FROM A STORED WORKSPACE.** Seeded before `main.ts` is imported, as
 * `tm-display-restore.test.ts` is, because `main()` reads storage once. Each panel is stored as the opposite of what a
 * view built with nothing stored draws, so a panel the load did not read back fails whichever way its default falls.
 */

/**
 * The legs whose views `fourViewWorkspace` shows, every leg but CLIF: a CLIF view draws none of its panels while it
 * says it is loading, so there is nothing of it to read back.
 */
type PanelLeg = Exclude<Leg, 'clif'>
const PANEL_LEGS = LEGS.filter((leg): leg is PanelLeg => leg !== 'clif')

const BUILD_BARE: { readonly [K in PanelLeg]: (el: HTMLElement) => void } = {
  lambda: (el) => {
    new LambdaPane(el, inertEvents())
  },
  rxm: (el) => {
    new RxmPane(el, inertEvents())
  },
  tm: (el) => {
    new TmPane(el, inertEvents())
  },
}

const leafOf = (leg: Leg): string => `${leg}-0`

/** Whether `view` draws `name` open. A name it does not draw reads closed, for the table's own test to report. */
const drawsOpen = (view: HTMLElement, name: string): boolean =>
  view.querySelector<HTMLElement>(`[data-panel="${name}"]`)?.dataset.open === 'true'

/** What a view of `leg` draws for each of its panels with nothing stored. */
const bareDefaults = (leg: PanelLeg): ReadonlyMap<string, boolean> => {
  const el = document.createElement('div')
  BUILD_BARE[leg](el)
  return new Map(LEG_PANELS[leg].map((name) => [name, drawsOpen(el, name)]))
}

const defaults = new Map<PanelLeg, ReadonlyMap<string, boolean>>()

beforeAll(async () => {
  for (const leg of PANEL_LEGS) defaults.set(leg, bareDefaults(leg))
  const panels = Object.fromEntries(
    PANEL_LEGS.map((leg) => [
      leafOf(leg),
      Object.fromEntries([...(defaults.get(leg) ?? [])].map(([name, open]) => [name, !open])),
    ]),
  )
  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace({ ...fourViewWorkspace(), panels }))
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
})

describe('a workspace that stores every panel', () => {
  it('opens every stored panel as the workspace stored it', () => {
    for (const leg of PANEL_LEGS) {
      const view = host(leafOf(leg)) as HTMLElement
      for (const [name, open] of defaults.get(leg) ?? []) {
        expect(drawsOpen(view, name), `${leg}'s ${name}`).toBe(!open)
      }
    }
  })

  it('draws exactly the panels the table names, and the text panel', () => {
    for (const leg of PANEL_LEGS) {
      const drawn = [...(host(leafOf(leg)) as HTMLElement).querySelectorAll<HTMLElement>('[data-panel]')]
      expect(drawn.map((el) => el.dataset.panel).sort(), leg).toEqual([...LEG_PANELS[leg], 'text'].sort())
    }
  })
})
