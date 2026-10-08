import type { EditorView } from '@codemirror/view'
import { computeAccessibleName } from 'dom-accessibility-api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cdp, page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { decodeLink } from '../../src/share-link'
import { PRESETS, parseWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **`share`: THE POPOVER, ITS LINK AND ITS COPY** — Plan 7 part 6a spec §5.1, §5.2 and §6. Driven by real pointer
 * clicks, because a synthetic `.click()` is not the gesture, but where a case needs what the popover holds before its
 * link is made, which a click that awaits the browser is too slow to see. The page opens on the program `setup.ts`
 * stores, `let x = 40; x + 2`, whose legs end at λ 7, asm 5 and TM 2,870 (spec §2.7). ONE MOUNT FOR THE FILE, for
 * the reason every sibling gives.
 */

const ENCODINGS = ['unary', 'binary']
const button = () => document.querySelector<HTMLButtonElement>('#share') as HTMLButtonElement
const menu = () => document.querySelector<HTMLElement>('#share-menu') as HTMLElement
const open = () => menu().matches(':popover-open')
const field = () => menu().querySelector<HTMLInputElement>('#share-link') as HTMLInputElement
const copyButton = () => menu().querySelector<HTMLButtonElement>('button.share-copy')
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
const fragmentOf = (link: string): string => link.slice(link.indexOf('#'))

let view: EditorView

beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && segments().length === 3, 'the first compile')
})

/**
 * The browser context this page is in. **A PERMISSION IS GRANTED TO A CONTEXT, NAMED**: sent without one, CDP grants
 * it to Chrome's default context, not Playwright's, and every write is still refused — as it is here by default.
 */
async function context(): Promise<string> {
  const { targetInfo } = (await cdp().send('Target.getTargetInfo')) as { targetInfo: { browserContextId?: string } }
  if (targetInfo.browserContextId === undefined) throw new Error('the page is in no browser context')
  return targetInfo.browserContextId
}

afterAll(async () => {
  await cdp().send('Browser.resetPermissions', { browserContextId: await context() })
})

/** Open the popover with a click, and answer its link once it is made. */
async function openShare(): Promise<string> {
  if (open()) menu().hidePopover()
  await userEvent.click(button())
  expect(open()).toBe(true)
  await until(() => field().value !== '', 'the link')
  return field().value
}

describe('share', () => {
  it('sits after the spacer and before appearance, in the chrome of the header’s other buttons', () => {
    const spacer = document.querySelector('header.bar .bar-spacer') as HTMLElement
    const appearance = document.querySelector<HTMLButtonElement>('#appearance') as HTMLButtonElement
    expect(spacer.compareDocumentPosition(button()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(button().compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(computeAccessibleName(button())).toBe('share')
    const [x, y] = [appearance, button()].map((el) => getComputedStyle(el))
    for (const property of [
      'borderTopStyle',
      'borderTopWidth',
      'paddingLeft',
      'backgroundColor',
      'fontFamily',
    ] as const)
      expect(y?.[property], property).toBe(x?.[property])
    expect(button().getBoundingClientRect().height).toBe(appearance.getBoundingClientRect().height)
  })

  /**
   * **A DISCLOSURE, NOT A MENU BUTTON** (spec §6): the popover is a field and a button, so `share` names what it
   * controls and says whether it is open, and claims no `aria-haspopup`, which a screen reader announces as a menu and
   * whose arrow-key navigation the popover does not have.
   */
  it('is a disclosure: it names its popover, says whether it is open, and claims no menu', async () => {
    expect(open()).toBe(false)
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(button().getAttribute('aria-controls')).toBe('share-menu')
    expect(button().hasAttribute('aria-haspopup')).toBe(false)
    await openShare()
    expect(button().getAttribute('aria-expanded')).toBe('true')
    await userEvent.keyboard('{Escape}')
    expect(open()).toBe(false)
    expect(button().getAttribute('aria-expanded')).toBe('false')
  })

  it('opens on a click, with the link in its field, focused and selected', async () => {
    expect(button().getAttribute('aria-expanded')).toBe('false')
    const link = await openShare()
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(link.startsWith(`${location.origin}${location.pathname}#s=`)).toBe(true)
    expect(document.activeElement).toBe(field())
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, link.length])
    expect(field().readOnly).toBe(true)
    // NAMED BY ITS LABEL, `link`, and not by the link it holds.
    expect(computeAccessibleName(field())).toBe('link')
    // A SHORT LINK AND NO COPY ON THE PAGE: neither line, and nothing describing the field.
    expect(menu().querySelector('.share-line')).toBeNull()
    expect(field().hasAttribute('aria-describedby')).toBe(false)
  })

  it('links to what is on the page: the program, its encoding, the workspace, and each leg’s step', async () => {
    const opened = await decodeLink(fragmentOf(await openShare()), ENCODINGS)
    expect(opened).toEqual({
      kind: 'whole',
      program: 'let x = 40; x + 2',
      encoding: 'unary',
      workspace: parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY)),
      // STEP 0 IN EVERY LEG, where a run opens (`History`), and where each head is.
      positions: { lambda: 0, asm: 0, tm: 0 },
    })
  })

  it('takes a leg’s step where its head is, not where its recording ends', async () => {
    menu().hidePopover()
    await userEvent.click(
      document.querySelector(
        '[data-leaf="lambda-0"] button[aria-label="to the newest recorded step"]',
      ) as HTMLButtonElement,
    )
    await userEvent.click(
      document.querySelector('[data-leaf="lambda-0"] button[aria-label="one step back"]') as HTMLButtonElement,
    )
    const opened = await decodeLink(fragmentOf(await openShare()), ENCODINGS)
    expect(opened.kind === 'whole' && opened.positions).toEqual({ lambda: 6, asm: 0, tm: 0 })
  })

  it('carries no positions while the program is compiling', async () => {
    menu().hidePopover()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let y = 1; y + 2' } })
    // SYNCHRONOUSLY, SO THE POPOVER IS BUILT WHILE THE COMPILE IS STILL PENDING — a click that awaits the browser
    // could land after it answers.
    button().click()
    await until(() => field().value !== '', 'the link')
    const opened = await decodeLink(fragmentOf(field().value), ENCODINGS)
    // `toEqual` ON THE POSITIONS THEMSELVES: `toMatchObject` would take `{}` as a subset every positions object has.
    expect(opened.kind === 'whole' && opened.program).toBe('let y = 1; y + 2')
    expect(opened.kind === 'whole' && opened.positions).toEqual({})
    menu().hidePopover()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(() => idle() && (segments()[0] ?? '').startsWith('λ 42'), 'the program’s compile')
  })

  it('offers copy link disabled, with its reason, until the link is made', async () => {
    if (open()) menu().hidePopover()
    button().click()
    expect(copyButton()?.disabled).toBe(true)
    expect(copyButton()?.title).toBe('the link is being made')
    expect(field().value).toBe('')
    await until(() => copyButton()?.disabled === false, 'the link')
    expect(copyButton()?.hasAttribute('title')).toBe(false)
    expect(computeAccessibleName(copyButton() as HTMLButtonElement)).toBe('copy link')
  })

  it('copies the link on a click, and says so', async () => {
    await cdp().send('Browser.grantPermissions', {
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
      browserContextId: await context(),
    })
    const link = await openShare()
    await userEvent.click(copyButton() as HTMLButtonElement)
    await until(() => noticeText() === 'link copied', 'the copy')
    expect(await navigator.clipboard.readText()).toBe(link)
  })

  // REFUSED AFTER THE CASE ABOVE GRANTED IT, so the refusal is the permission's and not the context's default.
  it('says the link is selected in the field when the clipboard refuses it', async () => {
    await cdp().send('Browser.setPermission', {
      permission: { name: 'clipboard-write' },
      setting: 'denied',
      browserContextId: await context(),
    })
    const link = await openShare()
    await userEvent.click(copyButton() as HTMLButtonElement)
    await until(() => noticeText() === 'the link could not be copied — it is selected in the field', 'the refusal')
    expect(document.activeElement).toBe(field())
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, link.length])
  })

  it('has no copy link where the page has no clipboard, and the field is still selected', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    try {
      const link = await openShare()
      // NO BUTTON AT ALL, not merely none named `copy link`: the field is the whole of the way to copy here.
      expect(menu().querySelector('button')).toBeNull()
      expect(document.activeElement).toBe(field())
      expect([field().selectionStart, field().selectionEnd]).toEqual([0, link.length])
    } finally {
      delete (navigator as { clipboard?: Clipboard }).clipboard
    }
    expect(navigator.clipboard).toBeDefined()
  })

  it('closes on Escape, with the focus back on share', async () => {
    await openShare()
    // THE FOCUS IS ON THE FIELD BEFORE THE KEY, or `share` would hold it already and the case could not tell.
    expect(document.activeElement).toBe(field())
    await userEvent.keyboard('{Escape}')
    expect(open()).toBe(false)
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button())
  })

  it('says how long a link is past 2,000 characters, and that some apps cut it', async () => {
    // TEXT THAT DOES NOT COMPRESS: a number per line from a seeded generator, as a comment.
    let s = 7
    const noise = Array.from({ length: 400 }, () => {
      s = (s * 1103515245 + 12345) % 2147483648
      return `// ${s.toString(36)}`
    }).join('\n')
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: `${noise}\nlet x = 40; x + 2` } })
    await until(() => idle() && (segments()[0] ?? '').startsWith('λ 42'), 'the long program’s compile')
    const link = await openShare()
    expect(link.length).toBeGreaterThan(2000)
    const line = menu().querySelector('#share-length')
    expect(line?.textContent).toBe(
      `this link is ${link.length.toLocaleString('en-US')} characters long — some chat and mail apps cut links past 2,000`,
    )
    expect(field().getAttribute('aria-describedby')).toBe('share-length')
    menu().hidePopover()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(() => idle() && (segments()[0] ?? '').startsWith('λ 42'), 'the program’s compile')
  })

  it('names the views that will open on the program, when a view shows a copy', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    await until(
      () => (document.querySelector('[data-leaf="lambda-0"] .view-title')?.textContent ?? '').includes('copy'),
      'the copy',
    )
    await openShare()
    expect(menu().querySelector('#share-copies')?.textContent).toBe(
      'copies are not included — the λ · copy 1 view will open on the program',
    )
    expect(field().getAttribute('aria-describedby')).toBe('share-copies')
  })

  /**
   * **THE PAYLOAD IS WHAT THE PAGE HOLDS, NOT WHAT THE PAGE OPENED ON**: the cases above share from `unary` and the
   * default workspace, which a payload that wrote either down would pass. Last in the file, since it leaves both moved.
   */
  it('links to the encoding and the workspace the user chose, not the ones the page opened on', async () => {
    await userEvent.selectOptions(document.querySelector('#encoding') as HTMLSelectElement, 'binary')
    await userEvent.click(document.querySelector('#workspace') as HTMLButtonElement)
    await userEvent.click(document.querySelector('#workspace-menu [data-preset="debugger"]') as HTMLButtonElement)
    if (document.querySelector('#workspace-menu')?.matches(':popover-open'))
      (document.querySelector('#workspace-menu') as HTMLElement).hidePopover()
    await until(() => idle() && document.querySelectorAll('#results .segment, #results .row').length > 0, 'the compile')
    expect(document.querySelector('#workspace')?.textContent).toBe('Debugger ▾')
    const opened = await decodeLink(fragmentOf(await openShare()), ENCODINGS)
    expect(opened.kind).toBe('whole')
    if (opened.kind !== 'whole') return
    expect(opened.encoding).toBe('binary')
    expect(opened.workspace.switches).toEqual(PRESETS.debugger)
    expect(opened.workspace).toEqual(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY)))
  })
})
