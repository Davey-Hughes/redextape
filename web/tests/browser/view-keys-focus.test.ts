import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { focusInPage, SHELL, until } from './harness'

/**
 * WHERE THE FOCUS IS AFTER A VIEW KEY — the view layouts spec §4.5 step 5: a switch leaves the keyboard focus where it
 * was, unless the view that held it left the page. `view-keys.test.ts` holds that for the source editor; this file
 * holds it for what else can have the focus when a key is pressed.
 *
 * **A FOCUS ON `<body>` IS THE FAILURE EVERY CASE HERE LOOKS FOR**, a frame after the key as well as at once: a
 * control that can no longer hold the focus gives it up when it is made so, or at the next frame.
 *
 * **EVERY CASE STARTS FROM ALL FOUR VIEWS, AS TILES, IN A WINDOW 1280 PX WIDE, WITH THE FOCUS IN THE SOURCE EDITOR**,
 * which `start` puts back and asserts. So the source view is the focused view when a case begins.
 */

const PREFIX = '{Control>}.{/Control}'
const SOURCE = 'let x = 40;\nx + 2'

let view: EditorView

const armed = (): boolean => !(document.querySelector('#view-keys') as HTMLElement).hidden
const notice = (): string => (document.querySelector('#notice .notice-text')?.textContent ?? '').trim()
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const host = (leaf: string): HTMLElement =>
  document.querySelector(`#views [data-leaf="${leaf}"]:not([role="tab"])`) as HTMLElement
const idle = (): boolean => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
/** The view the focus is in, by its leaf; none for a focus on a tab, a divider, the header or `<body>`. */
const viewOfFocus = (): string | undefined =>
  document.activeElement?.closest<HTMLElement>('#views [data-leaf]:not([role="tab"])')?.dataset.leaf
const toggle = (kind: string): HTMLButtonElement =>
  document.querySelector(`#views-shown button[data-shows="${kind}"]`) as HTMLButtonElement
/** Whether the header's `views` group is hidden, as `main.ts` hides it in a narrow window. */
const togglesHidden = (): boolean => (document.querySelector('#views-shown') as HTMLElement).hidden === true
/** Two frames: the one the page draws next, and one more, by which a control that cannot hold the focus has lost it. */
const frames = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

/** The prefix and then `key`, with the mode asserted armed between them. */
async function viewKey(key: string): Promise<void> {
  await userEvent.keyboard(PREFIX)
  expect(armed(), 'the prefix did not arm the mode').toBe(true)
  await userEvent.keyboard(key)
  expect(armed()).toBe(false)
}

/** `el` has the focus now, and still has it two frames on. */
async function holdsFocus(el: HTMLElement, what: string): Promise<void> {
  expect(document.activeElement, `${what}, at once`).toBe(el)
  await frames()
  expect(document.activeElement, `${what}, two frames on`).toBe(el)
}

/** Choose a preset in the workspace menu, as a user does. */
async function preset(name: 'explorer' | 'stage'): Promise<void> {
  const menu = document.querySelector('#workspace-menu') as HTMLElement
  await userEvent.click(document.querySelector('#workspace') as HTMLElement)
  await userEvent.click(menu.querySelector(`[data-preset="${name}"]`) as HTMLElement)
  if (menu.matches(':popover-open')) menu.hidePopover()
}

async function start(): Promise<void> {
  await page.viewport(1280, 896)
  if (document.querySelector('#views [role="tab"]') !== null) await preset('explorer')
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views-shown button[aria-pressed="false"]')) b.click()
  view.focus()
  await until(() => view.hasFocus, 'the source editor to take the focus')
  expect(mounted(), 'precondition: all four views').toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
  expect(togglesHidden(), 'precondition: the toggles are shown').toBe(false)
  expect(armed(), 'precondition: the mode is not armed').toBe(false)
}

describe('the focus after a view key', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SOURCE } })
    await until(() => idle() && (document.querySelector('#results')?.textContent ?? '').includes('λ 42'), 'the compile')
  })

  afterEach(async () => {
    if (armed()) await userEvent.keyboard('{Escape}')
  })

  /**
   * A toggle is pressed where its kind is shown and disabled where it is the only one (spec §6). A press with the
   * pointer disables some OTHER toggle: the one pressed hides its own kind. A view key can leave the toggle that has
   * the focus as the only one pressed.
   */
  describe('on a views toggle', () => {
    const REASON = 'the λ view is the only one shown — one view stays'

    it('stays on the toggle the keys leave as the only one pressed, which refuses a press and says why', async () => {
      await start()
      const lambda = toggle('lambda')
      lambda.focus()
      expect(document.activeElement, 'precondition: the λ toggle has the focus').toBe(lambda)
      for (const key of ['1', '2', '4']) {
        await viewKey(key)
        expect(document.activeElement, `after ${key}`).toBe(lambda)
      }
      expect(mounted()).toEqual(['lambda-0'])
      expect(lambda.getAttribute('aria-disabled'), 'the only toggle pressed is not disabled').toBe('true')
      expect(lambda.title).toBe(REASON)
      // THE CURSOR IS ALL THAT DRAWS IT AS DISABLED (`style.css`): it keeps its pressed look.
      expect(getComputedStyle(lambda).cursor).toBe('default')
      await holdsFocus(lambda, 'the toggle the keys disabled lost the focus')
      await userEvent.keyboard('{Enter}')
      expect(mounted(), 'a press on the disabled toggle hid the last view').toEqual(['lambda-0'])
      expect(notice()).toBe(REASON)
      await holdsFocus(lambda, 'the refused press cost the toggle the focus')
      await viewKey('1')
      expect(mounted()).toEqual(['source', 'lambda-0'])
      expect(lambda.hasAttribute('aria-disabled'), 'the toggle stayed disabled with two views shown').toBe(false)
      expect(getComputedStyle(lambda).cursor).toBe('pointer')
      expect(document.activeElement).toBe(lambda)
    })

    it('stays on the TM toggle when a key hides the source view beside it', async () => {
      await start()
      await userEvent.click(toggle('asm'))
      await userEvent.click(toggle('lambda'))
      expect(mounted(), 'precondition: the source and TM views').toEqual(['source', 'tm-0'])
      const tm = toggle('tm')
      tm.focus()
      await viewKey('1')
      expect(mounted()).toEqual(['tm-0'])
      await holdsFocus(tm, 'the TM toggle lost the focus')
      expect(tm.getAttribute('aria-disabled')).toBe('true')
    })

    it('refuses a pointer press on the only toggle pressed, and says why', async () => {
      await start()
      for (const kind of ['source', 'asm', 'tm']) await userEvent.click(toggle(kind))
      expect(mounted()).toEqual(['lambda-0'])
      expect(toggle('lambda').getAttribute('aria-disabled'), 'precondition: the λ toggle is disabled').toBe('true')
      // `force`, BECAUSE THE TEST DRIVER WAITS FOR A CONTROL TO BE ENABLED BEFORE IT PRESSES ONE, and it reads
      // `aria-disabled` as not enabled: without it the press is never made (`locator.click: Timeout`, measured). A
      // user's pointer does not wait. The press itself is the driver's own, at the toggle's centre.
      await userEvent.click(toggle('lambda'), { force: true })
      await focusInPage('a pointer press on the only toggle pressed, which is refused')
      expect(mounted(), 'the press hid the last view').toEqual(['lambda-0'])
      expect(toggle('lambda').getAttribute('aria-pressed')).toBe('true')
      expect(notice()).toBe(REASON)
    })

    /** In a window 40rem wide or narrower the toggles are hidden (spec §6.1), and a hidden control holds no focus. */
    it('goes to + view when the window is narrowed past 40rem, and is there when it is widened again', async () => {
      await start()
      const lambda = toggle('lambda')
      const add = document.querySelector('#new-view') as HTMLElement
      lambda.focus()
      expect(document.activeElement, 'precondition: the λ toggle has the focus').toBe(lambda)
      await page.viewport(600, 896)
      await until(togglesHidden, 'the toggles to be hidden')
      await holdsFocus(add, 'the focus is not on + view in the narrow window')
      await page.viewport(1280, 896)
      await until(() => !togglesHidden(), 'the toggles to be shown')
      await holdsFocus(add, 'the focus is not on + view in the window widened again')
    })

    it('leaves the focus alone when the window is narrowed with the focus elsewhere', async () => {
      await start()
      const share = document.querySelector('#share') as HTMLElement
      share.focus()
      await page.viewport(600, 896)
      await until(togglesHidden, 'the toggles to be hidden')
      await holdsFocus(share, 'narrowing the window moved a focus that was not on a toggle')
      await page.viewport(1280, 896)
    })
  })

  /** The header is outside the views, and no rebuild touches it: a key pressed from one of its controls leaves it there. */
  describe('on a header control', () => {
    it('stays on share', async () => {
      await start()
      const share = document.querySelector('#share') as HTMLElement
      share.focus()
      await viewKey('2')
      expect(mounted()).toEqual(['source', 'lambda-0', 'tm-0'])
      await holdsFocus(share, 'the key took the focus from share')
    })

    /**
     * **THE SELECT'S OWN `keydown` LISTENER IS WHAT IS ASKED, AND NOT ITS VALUE.** Its options are `unary` and
     * `binary`, and a `2` that did reach it would choose neither, so a value that stayed the same said nothing. The
     * listener hears `Control`, which the mode lets through, so it is known to be listening.
     */
    it('stays on the encoding select, which is not given the key', async () => {
      await start()
      const encoding = document.querySelector('#encoding') as HTMLSelectElement
      const chosen = encoding.value
      encoding.focus()
      const heard: string[] = []
      const hear = (e: KeyboardEvent): void => {
        heard.push(e.key)
      }
      encoding.addEventListener('keydown', hear)
      try {
        await viewKey('2')
      } finally {
        encoding.removeEventListener('keydown', hear)
      }
      expect(mounted()).toEqual(['source', 'lambda-0', 'tm-0'])
      expect(heard, 'precondition: the select hears the keys the mode lets through').toContain('Control')
      expect(heard, 'the 2 reached the select').not.toContain('2')
      expect(encoding.value).toBe(chosen)
      await holdsFocus(encoding, 'the key took the focus from the select')
    })
  })

  /**
   * A divider is built again by every render, and `layout-view.ts`'s `renderLayout` puts the focus on the new one
   * where the tree still has a divider at the old one's path and index. `harness.ts`'s `fourViews()` is a column of
   * two rows: the divider between the rows is at `[]`, and each row's own is at `[0]` and `[1]`.
   */
  describe('on a divider', () => {
    const dividers = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('#views .layout-divider')]
    const named = (d: HTMLElement): string => `${d.dataset.path} ${d.dataset.index}`
    const divider = (name: string): HTMLElement => dividers().find((d) => named(d) === name) as HTMLElement

    it('stays on a divider the new tree keeps', async () => {
      await start()
      expect(dividers().map(named), 'precondition: the three dividers of four views').toEqual([
        '[0] 0',
        '[] 0',
        '[1] 0',
      ])
      const old = divider('[] 0')
      old.focus()
      expect(document.activeElement, 'precondition: the divider has the focus').toBe(old)
      await viewKey('4')
      expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0'])
      expect(dividers().map(named), 'precondition: the tree kept a divider at [] 0').toContain('[] 0')
      expect(old.isConnected, 'precondition: the divider was built again').toBe(false)
      await holdsFocus(divider('[] 0'), 'the focus is not on the divider built in its place')
    })

    it('goes to the focused view from a divider the new tree does not keep', async () => {
      await start()
      divider('[0] 0').focus()
      expect(document.activeElement, 'precondition: the divider has the focus').toBe(divider('[0] 0'))
      await viewKey('4')
      expect(dividers().map(named), 'precondition: the tree has no divider at [0] 0').toEqual(['[] 0', '[1] 0'])
      expect(document.activeElement, 'the focus fell to <body>').not.toBe(document.body)
      expect(viewOfFocus(), 'the focus is not in the focused view').toBe('source')
    })
  })

  /**
   * In Stage the views are tabs and one view is on the page (spec §6: the toggles choose which tabs there are).
   * `layout-view.ts`'s `renderStage` builds every tab again and puts the focus on the one for the leaf that had it.
   */
  describe('in Stage', () => {
    const tabs = (): string[] =>
      [...document.querySelectorAll<HTMLElement>('#views [role="tab"]')].map(
        (t) => `${t.dataset.leaf}${t.getAttribute('aria-selected') === 'true' ? ', selected' : ''}`,
      )
    const tab = (leaf: string): HTMLElement =>
      document.querySelector(`#views [role="tab"][data-leaf="${leaf}"]`) as HTMLElement

    /** Stage, with the source view the one on the page: it was the focused view when the preset was chosen. */
    async function stage(): Promise<void> {
      await start()
      await preset('stage')
      expect(tabs(), 'precondition: four tabs, the source’s selected').toEqual([
        'source, selected',
        'lambda-0',
        'asm-0',
        'tm-0',
      ])
      expect(mounted(), 'precondition: the source view alone is on the page').toEqual(['source'])
    }

    it('stays on the selected tab', async () => {
      await stage()
      const old = tab('source')
      old.focus()
      await viewKey('4')
      expect(tabs(), 'the key did not take the TM view’s tab away').toEqual(['source, selected', 'lambda-0', 'asm-0'])
      expect(old.isConnected, 'precondition: the tab was built again').toBe(false)
      await holdsFocus(tab('source'), 'the focus is not on the tab built in its place')
    })

    it('stays on a tab reached with an arrow and not selected', async () => {
      await stage()
      tab('source').focus()
      await userEvent.keyboard('{ArrowRight}')
      expect(document.activeElement, 'precondition: the arrow moved the focus to the λ view’s tab').toBe(
        tab('lambda-0'),
      )
      await viewKey('4')
      expect(tabs()).toEqual(['source, selected', 'lambda-0', 'asm-0'])
      await holdsFocus(tab('lambda-0'), 'the focus is not on the λ view’s tab')
      expect(mounted(), 'the key selected a tab').toEqual(['source'])
    })

    it('goes to the view on the page from the tab of the view the key hides', async () => {
      await stage()
      tab('source').focus()
      await userEvent.keyboard('{End}')
      expect(document.activeElement, 'precondition: End moved the focus to the TM view’s tab').toBe(tab('tm-0'))
      await viewKey('4')
      expect(tabs()).toEqual(['source, selected', 'lambda-0', 'asm-0'])
      expect(document.activeElement, 'the focus fell to <body>').not.toBe(document.body)
      expect(viewOfFocus(), 'the focus is not in the view on the page').toBe('source')
    })

    it('leaves the caret in the source editor, and the key chooses the tabs', async () => {
      await stage()
      view.focus()
      view.dispatch({ selection: { anchor: 14 } })
      await until(() => view.hasFocus, 'the source editor to take the focus')
      await viewKey('4')
      expect(tabs()).toEqual(['source, selected', 'lambda-0', 'asm-0'])
      expect(view.hasFocus, 'the key took the focus out of the editor').toBe(true)
      expect(view.state.selection.main.head, 'the caret is not where it was').toBe(14)
      await viewKey('1')
      expect(tabs(), 'hiding the view on the page did not select another').toEqual(['lambda-0, selected', 'asm-0'])
      expect(mounted()).toEqual(['lambda-0'])
      expect(viewOfFocus(), 'the focus is not in the view that took the page').toBe('lambda-0')
    })
  })

  /** A copy's own editor, in the view that shows the copy: a λ copy's, and a machine copy's. */
  describe('in a copy’s editor', () => {
    it.each([
      ['a λ copy', 'lambda-0', '.term-editor', '3'],
      ['a machine copy', 'tm-0', '.cm-editor', '4'],
    ])('stays in the editor of %s with its caret, and leaves with its view', async (_what, leaf, editor, own) => {
      await start()
      const more = host(leaf).querySelector('button.view-more') as HTMLElement
      await userEvent.click(more)
      const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement
      await until(() => menu.matches(':popover-open'), 'the view’s menu')
      await userEvent.click(menu.querySelector('button.detach') as HTMLElement)
      await until(() => host(leaf).querySelector(editor) !== null, 'the copy’s editor')
      const copy = EditorView.findFromDOM(host(leaf).querySelector(editor) as HTMLElement) as EditorView
      const text = copy.state.doc.toString()
      expect(text.length, 'precondition: the copy has text to put a caret in').toBeGreaterThan(5)
      copy.focus()
      copy.dispatch({ selection: { anchor: 5 } })
      await until(() => copy.hasFocus, 'the copy’s editor to take the focus')
      // A KEY THAT KEEPS THE COPY'S VIEW.
      await viewKey('2')
      expect(mounted()).toEqual(['source', 'lambda-0', 'tm-0'])
      expect(copy.hasFocus, 'the key took the focus out of the copy’s editor').toBe(true)
      expect(copy.state.selection.main.head, 'the caret is not where it was').toBe(5)
      expect(copy.state.doc.toString(), 'the key changed the copy').toBe(text)
      await viewKey('2')
      // THE KEY THAT HIDES IT: the first view that is not the source takes the focus (`workspace.ts`'s `defaultFocus`).
      expect(copy.hasFocus, 'precondition: the focus is in the copy’s editor').toBe(true)
      await viewKey(own)
      expect(mounted()).not.toContain(leaf)
      expect(document.activeElement, 'the focus fell to <body>').not.toBe(document.body)
      expect(viewOfFocus(), 'the focus is not in the focused view').toBe(mounted().find((l) => l !== 'source'))
      await viewKey(own)
      expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
      const back = EditorView.findFromDOM(host(leaf).querySelector(editor) as HTMLElement)
      expect(back?.state.doc.toString(), 'the copy’s editor did not come back with its text').toBe(text)
    })
  })
})
