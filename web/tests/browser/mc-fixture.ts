import { commands } from 'vitest/browser'
import type { LayoutNode } from '../../src/layout'
import type { McTarget } from '../../src/protocol'
import { defaultWorkspace, serializeWorkspace, type Workspace } from '../../src/workspace'
import { type Heard, sleep } from './clif-fixture'

/** What every request for either machine code package asks for: its module and its wasm. */
export const MC_MATCH = 'redextape_mc_wasm'

/** The source beside a clif view. */
export const SOURCE_AND_CLIF: LayoutNode = {
  kind: 'split',
  dir: 'row',
  sizes: [0.5, 0.5],
  children: [
    { kind: 'leaf', id: 'source', pane: 'source' },
    { kind: 'leaf', id: 'clif-0', pane: 'clif' },
  ],
}

/** The workspace text of the source beside a clif view, with `over`'s fields: what a stored workspace or link holds. */
export const sourceAndClif = (over: Partial<Workspace> = {}): string =>
  serializeWorkspace({ ...defaultWorkspace('wide'), tree: SOURCE_AND_CLIF, focused: 'source', ...over })

/**
 * The machine code package requests the page reported since this file's watch started (`vite.config.ts`'s
 * `watchRequests`), by the target whose package each asks for. **THE PAGE'S LIST**, which reports a dedicated worker's
 * requests as the context's does.
 */
export async function mcRequests(): Promise<Record<McTarget, string[]>> {
  const log = await commands.watchRequests('read', MC_MATCH)
  if (log === null) throw new Error('this file started no watch of the machine code requests')
  return {
    'x86-64': log.page.filter((url) => url.includes('/pkg-mc-x86-64/')),
    arm64: log.page.filter((url) => url.includes('/pkg-mc-arm64/')),
  }
}

/**
 * `mcRequests` once `target`'s holds its package's wasm, the last of its module's requests, read every 50 ms, or a
 * throw after 10 s, `until`'s bound, naming what never came.
 */
export async function mcFetched(target: McTarget): Promise<Record<McTarget, string[]>> {
  const started = performance.now()
  for (;;) {
    const seen = await mcRequests()
    if (seen[target].some((url) => url.includes('.wasm'))) return seen
    if (performance.now() - started > 10_000) throw new Error(`timed out after 10000ms waiting for ${target}'s wasm`)
    await sleep(50)
  }
}

/**
 * Every `mc-load` in `heard`, asked for by the page or answered by the worker, on either target, so empty until
 * something has asked for a machine code package or the worker has started loading one. **A FILE WHOSE ARMED FAILURE
 * MUST MEET THE PAGE'S FIRST LOAD ASSERTS THIS EMPTY BEFORE ARMING IT**: the worker keeps a package it has loaded, so
 * after one the armed request is never made, and the file would wait out its bound for a notice that cannot come.
 */
export const mcLoads = (heard: readonly Heard[]): Heard[] =>
  heard.filter((h) => ('request' in h ? h.request.kind : h.reply.kind) === 'mc-load')

/** The URLs `urls` asks for more than once. */
export const twice = (urls: readonly string[]): string[] => urls.filter((url, i) => urls.indexOf(url) !== i)

/** `pane`'s machine code panel. */
export const codePanelOf = (pane: HTMLElement): HTMLElement =>
  pane.querySelector<HTMLElement>('.panel[data-panel="code"]') as HTMLElement

/** `pane`'s choice of `target` on its machine code panel's header. */
export const targetChoice = (pane: HTMLElement, target: McTarget): HTMLButtonElement =>
  codePanelOf(pane).querySelector<HTMLButtonElement>(`.mc-target [data-value="${target}"]`) as HTMLButtonElement

/** `pane`'s choice of `syntax` on its machine code panel's header. */
export const syntaxChoice = (pane: HTMLElement, syntax: 'att' | 'intel'): HTMLButtonElement =>
  codePanelOf(pane).querySelector<HTMLButtonElement>(`.mc-syntax [data-value="${syntax}"]`) as HTMLButtonElement

/** `pane`'s machine code rows as drawn, in the order the panel draws them. */
export const codeRows = (pane: HTMLElement): HTMLElement[] => [
  ...codePanelOf(pane).querySelectorAll<HTMLElement>('.mc-listing .clif-row'),
]
