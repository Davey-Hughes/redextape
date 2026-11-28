import type { EditorView } from '@codemirror/view'
import { computeAccessibleName } from 'dom-accessibility-api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cdp, page, userEvent } from 'vitest/browser'
import { fieldWidths } from '../../../pkg/redextape_wasm.js'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { decodeLink } from '../../src/share-link'
import { PRESETS, parseWorkspace } from '../../src/workspace'
import { chromiumOnly } from './engine'
import {
  hear,
  noticeText,
  SHELL,
  segments,
  shareButton,
  shareLinkField,
  shareMenu,
  shareMenuOpen,
  stateIdle,
  until,
} from './harness'

/**
 * **`share`: THE POPOVER, ITS LINK AND ITS COPY** — Plan 7 part 6a spec §5.1, §5.2 and §6. Driven by real pointer
 * clicks, because a synthetic `.click()` is not the gesture, but where a case needs what the popover holds before its
 * link is made, which a click that awaits the browser is too slow to see. The page opens on the program `setup.ts`
 * stores, `let x = 40; x + 2`, whose legs end at λ 7, rxm 5 and TM 2,870 (spec §2.7). ONE MOUNT FOR THE FILE, for
 * the reason `app.test.ts` gives.
 */

const ENCODINGS = ['unary', 'binary']
const copyButton = () => shareMenu().querySelector<HTMLButtonElement>('button.share-copy')
const fragmentOf = (link: string): string => link.slice(link.indexOf('#'))

let view: EditorView

beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => stateIdle() && segments().length === 3, 'the first compile')
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

let permissionSet = false

afterAll(async () => {
  // ON WHAT A CASE DID, NOT ON THE ENGINE, so a permission set by a case that ran is always undone.
  if (permissionSet) await cdp().send('Browser.resetPermissions', { browserContextId: await context() })
})

/** The program `setup.ts` stores, which the page opens on. */
const PROGRAM = 'let x = 40; x + 2'

/** `PROGRAM` after 400 lines of TEXT THAT DOES NOT COMPRESS, a number per line from a seeded generator, as a comment. */
const LONG_PROGRAM = (() => {
  let s = 7
  const noise = Array.from({ length: 400 }, () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return `// ${s.toString(36)}`
  }).join('\n')
  return `${noise}\n${PROGRAM}`
})()

/** What the line under the field says of `link`, and what the live region says with it. */
const lengthWords = (link: string): string =>
  `this link is ${link.length.toLocaleString('en-US')} characters long — some chat and mail apps cut links past 2,000`

/** Write `source` in the editor, and wait for its compile, which `what` names. Each program here evaluates to 42. */
async function write(source: string, what: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } })
  await until(() => stateIdle() && (segments()[0] ?? '').startsWith('λ 42'), what)
}

/**
 * Run `act` with every link the page makes held until `act` ends, and answer how many it held. **HELD, NOT RACED**:
 * a link is made sooner than a click that awaits the browser returns, so a case whose gestures must land before a link
 * does holds the link's deflate, and a gesture can be the real one. **A HOLD THAT HELD NONE HELD NOTHING**: the caller
 * asserts the count.
 */
async function holdingLinks(act: () => Promise<void>): Promise<number> {
  const Deflate = globalThis.CompressionStream
  let open = () => {}
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  let count = 0
  globalThis.CompressionStream = class {
    readonly writable: WritableStream<BufferSource>
    readonly readable: ReadableStream<Uint8Array>
    constructor(format: CompressionFormat) {
      const deflate = new Deflate(format)
      count += 1
      this.writable = deflate.writable
      // A TRANSFORM TAKES NO CHUNK BEFORE ITS `start` SETTLES, so no byte reaches the link until the gate opens.
      this.readable = deflate.readable.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ start: () => gate }))
    }
  } as unknown as typeof CompressionStream
  try {
    await act()
  } finally {
    globalThis.CompressionStream = Deflate
    open()
  }
  return count
}

/** Open the popover with a click, and answer its link once it is made. */
async function openShare(): Promise<string> {
  if (shareMenuOpen()) shareMenu().hidePopover()
  await userEvent.click(shareButton())
  expect(shareMenuOpen()).toBe(true)
  await until(() => shareLinkField().value !== '', 'the link')
  return shareLinkField().value
}

describe('share', () => {
  it('sits after the spacer and before appearance, in the chrome of the header’s other buttons', () => {
    const spacer = document.querySelector('header.bar .bar-spacer') as HTMLElement
    const appearance = document.querySelector<HTMLButtonElement>('#appearance') as HTMLButtonElement
    expect(spacer.compareDocumentPosition(shareButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(shareButton().compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(computeAccessibleName(shareButton())).toBe('share')
    const [x, y] = [appearance, shareButton()].map((el) => getComputedStyle(el))
    for (const property of [
      'borderTopStyle',
      'borderTopWidth',
      'paddingLeft',
      'backgroundColor',
      'fontFamily',
    ] as const)
      expect(y?.[property], property).toBe(x?.[property])
    expect(shareButton().getBoundingClientRect().height).toBe(appearance.getBoundingClientRect().height)
  })

  /**
   * **A DISCLOSURE, NOT A MENU BUTTON** (spec §6): the popover is a field and a button, so `share` names what it
   * controls and says whether it is open, and claims no `aria-haspopup`, which a screen reader announces as a menu and
   * whose arrow-key navigation the popover does not have.
   */
  it('is a disclosure: it names its popover, says whether it is open, and claims no menu', async () => {
    expect(shareMenuOpen()).toBe(false)
    expect(shareButton().getAttribute('aria-expanded')).toBe('false')
    expect(shareButton().getAttribute('aria-controls')).toBe('share-menu')
    expect(shareButton().hasAttribute('aria-haspopup')).toBe(false)
    await openShare()
    expect(shareButton().getAttribute('aria-expanded')).toBe('true')
    await userEvent.keyboard('{Escape}')
    expect(shareMenuOpen()).toBe(false)
    expect(shareButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('opens on a click, with the link in its field, focused and selected', async () => {
    expect(shareButton().getAttribute('aria-expanded')).toBe('false')
    const link = await openShare()
    expect(shareButton().getAttribute('aria-expanded')).toBe('true')
    expect(link.startsWith(`${location.origin}${location.pathname}#s=`)).toBe(true)
    expect(document.activeElement).toBe(shareLinkField())
    expect([shareLinkField().selectionStart, shareLinkField().selectionEnd]).toEqual([0, link.length])
    expect(shareLinkField().readOnly).toBe(true)
    // NAMED BY ITS LABEL, `link`, and not by the link it holds.
    expect(computeAccessibleName(shareLinkField())).toBe('link')
    // A SHORT LINK: no length line, and nothing describing the field.
    expect(shareMenu().querySelector('.share-line')).toBeNull()
    expect(shareLinkField().hasAttribute('aria-describedby')).toBe(false)
  })

  it('links to what is on the page: the program, its encoding, the workspace, and each leg’s step', async () => {
    const opened = await decodeLink(fragmentOf(await openShare()), ENCODINGS, fieldWidths() as number[])
    expect(opened).toEqual({
      kind: 'whole',
      program: 'let x = 40; x + 2',
      encoding: 'unary',
      width: null,
      listing: 'as-built',
      workspace: parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY)),
      // STEP 0 IN EVERY LEG, where a run opens (`History`), and where each head is.
      positions: { lambda: 0, rxm: 0, tm: 0 },
    })
  })

  it('takes a leg’s step where its head is, not where its recording ends', async () => {
    shareMenu().hidePopover()
    await userEvent.click(
      document.querySelector(
        '[data-leaf="lambda-0"] button[aria-label="to the newest recorded step"]',
      ) as HTMLButtonElement,
    )
    await userEvent.click(
      document.querySelector('[data-leaf="lambda-0"] button[aria-label="one step back"]') as HTMLButtonElement,
    )
    const opened = await decodeLink(fragmentOf(await openShare()), ENCODINGS, fieldWidths() as number[])
    expect(opened.kind === 'whole' && opened.positions).toEqual({ lambda: 6, rxm: 0, tm: 0 })
  })

  it('carries no positions while the program is compiling', async () => {
    shareMenu().hidePopover()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let y = 1; y + 2' } })
    // SYNCHRONOUSLY, SO THE POPOVER IS BUILT WHILE THE COMPILE IS STILL PENDING — a click that awaits the browser
    // could land after it answers.
    shareButton().click()
    await until(() => shareLinkField().value !== '', 'the link')
    const opened = await decodeLink(fragmentOf(shareLinkField().value), ENCODINGS, fieldWidths() as number[])
    // `toEqual` ON THE POSITIONS THEMSELVES: `toMatchObject` would take `{}` as a subset every positions object has.
    expect(opened.kind === 'whole' && opened.program).toBe('let y = 1; y + 2')
    expect(opened.kind === 'whole' && opened.positions).toEqual({})
    shareMenu().hidePopover()
    await write(PROGRAM, 'the program’s compile')
  })

  it('offers copy link disabled, with its reason, until the link is made', async () => {
    if (shareMenuOpen()) shareMenu().hidePopover()
    shareButton().click()
    expect(copyButton()?.disabled).toBe(true)
    expect(copyButton()?.title).toBe('the link is being made')
    expect(shareLinkField().value).toBe('')
    await until(() => copyButton()?.disabled === false, 'the link')
    expect(copyButton()?.hasAttribute('title')).toBe(false)
    expect(computeAccessibleName(copyButton() as HTMLButtonElement)).toBe('copy link')
  })

  it('copies the link on a click, and says so', async (ctx) => {
    chromiumOnly(ctx, 'it grants the clipboard through CDP, and Playwright’s Firefox knows no clipboard permission')
    permissionSet = true
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
  it('says the link is selected in the field when the clipboard refuses it', async (ctx) => {
    chromiumOnly(ctx, 'it refuses the clipboard through CDP, and Playwright’s Firefox knows no clipboard permission')
    permissionSet = true
    await cdp().send('Browser.setPermission', {
      permission: { name: 'clipboard-write' },
      setting: 'denied',
      browserContextId: await context(),
    })
    const link = await openShare()
    await userEvent.click(copyButton() as HTMLButtonElement)
    await until(() => noticeText() === 'the link could not be copied — it is selected in the field', 'the refusal')
    expect(document.activeElement).toBe(shareLinkField())
    expect([shareLinkField().selectionStart, shareLinkField().selectionEnd]).toEqual([0, link.length])
  })

  it('has no copy link where the page has no clipboard, and the field is still selected', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    try {
      const link = await openShare()
      // NO BUTTON AT ALL, not merely none named `copy link`: the field is the whole of the way to copy here.
      expect(shareMenu().querySelector('button')).toBeNull()
      expect(document.activeElement).toBe(shareLinkField())
      expect([shareLinkField().selectionStart, shareLinkField().selectionEnd]).toEqual([0, link.length])
    } finally {
      delete (navigator as { clipboard?: Clipboard }).clipboard
    }
    expect(navigator.clipboard).toBeDefined()
  })

  it('closes on Escape, with the focus back on share', async () => {
    await openShare()
    // THE FOCUS IS ON THE FIELD BEFORE THE KEY, or `share` would hold it already and the case could not tell.
    expect(document.activeElement).toBe(shareLinkField())
    await userEvent.keyboard('{Escape}')
    expect(shareMenuOpen()).toBe(false)
    expect(shareButton().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(shareButton())
  })

  it('says how long a link is past 2,000 characters, and that some apps cut it', async () => {
    await write(LONG_PROGRAM, 'the long program’s compile')
    const heard = hear()
    const link = await openShare()
    heard.stop()
    expect(link.length).toBeGreaterThan(2000)
    const line = shareMenu().querySelector('#share-length')
    const words = lengthWords(link)
    expect(line?.textContent).toBe(words)
    expect(shareLinkField().getAttribute('aria-describedby')).toBe('share-length')
    // SAID, NOT ONLY DESCRIBED: the field had the focus before the line was there, so a reader may not read it out.
    expect(
      heard.said.filter((said) => said === words),
      'said once in the live region',
    ).toHaveLength(1)
    expect(heard.notices, 'not drawn as a notice: the popover shows it').not.toContain(words)
    shareMenu().hidePopover()
    await write(PROGRAM, 'the program’s compile')
  })

  /**
   * **SAID FOR THE OPEN ON SHOW ALONE.** Each open builds its own field, so a link that arrives after share was opened
   * again fills a field no longer on the page; said, a reader who opened share twice would hear the line twice.
   */
  it('says the line once when share is opened again before the first open’s link arrives', async () => {
    await write(LONG_PROGRAM, 'the long program’s compile')
    if (shareMenuOpen()) shareMenu().hidePopover()
    const heard = hear()
    const fields: HTMLInputElement[] = []
    const held = await holdingLinks(async () => {
      await userEvent.click(shareButton())
      fields.push(shareLinkField())
      await userEvent.keyboard('{Escape}')
      await userEvent.click(shareButton())
      fields.push(shareLinkField())
    })
    expect(held, 'both opens’ links held').toBe(2)
    expect(shareMenuOpen()).toBe(true)
    const [first, second] = fields as [HTMLInputElement, HTMLInputElement]
    expect(first.isConnected, 'the second open took the first open’s field off the page').toBe(false)
    await until(() => first.value !== '' && second.value !== '', 'both opens’ links')
    heard.stop()
    expect(second.value.length).toBeGreaterThan(2000)
    expect(
      heard.said.filter((said) => said.startsWith('this link is')),
      'said once, for the open on show',
    ).toEqual([lengthWords(second.value)])
    shareMenu().hidePopover()
    await write(PROGRAM, 'the program’s compile')
  })

  /** **NOR FOR AN OPEN SINCE CLOSED**: its field is still in the popover, but nothing on screen shows the line. */
  it('says nothing of a link that arrives after share was closed', async () => {
    await write(LONG_PROGRAM, 'the long program’s compile')
    if (shareMenuOpen()) shareMenu().hidePopover()
    const heard = hear()
    const fields: HTMLInputElement[] = []
    const held = await holdingLinks(async () => {
      await userEvent.click(shareButton())
      fields.push(shareLinkField())
      await userEvent.keyboard('{Escape}')
    })
    expect(held, 'the link held').toBe(1)
    expect(shareMenuOpen()).toBe(false)
    const [field] = fields as [HTMLInputElement]
    await until(() => field.value !== '', 'the link')
    heard.stop()
    // THE FIELD IS STILL ON THE PAGE AND THE LINE WRITTEN, so what leaves it unsaid is the popover's being closed.
    expect(field.isConnected).toBe(true)
    expect(shareMenu().querySelector('#share-length')?.textContent).toBe(lengthWords(field.value))
    expect(heard.said.filter((said) => said.startsWith('this link is'))).toEqual([])
    await write(PROGRAM, 'the program’s compile')
  })

  /**
   * **THE PAYLOAD IS WHAT THE PAGE HOLDS, NOT WHAT THE PAGE OPENED ON**: the cases above share from `unary` and the
   * workspace the page opened on, which a payload that wrote either down would pass. Last in the file, since it leaves
   * both moved.
   */
  it('links to the encoding and the workspace the user chose, not the ones the page opened on', async () => {
    await userEvent.selectOptions(document.querySelector('#encoding') as HTMLSelectElement, 'binary')
    await userEvent.click(document.querySelector('#workspace') as HTMLButtonElement)
    await userEvent.click(document.querySelector('#workspace-menu [data-preset="debugger"]') as HTMLButtonElement)
    if (document.querySelector('#workspace-menu')?.matches(':popover-open'))
      (document.querySelector('#workspace-menu') as HTMLElement).hidePopover()
    await until(
      () => stateIdle() && document.querySelectorAll('#results .segment, #results .row').length > 0,
      'the compile',
    )
    expect(document.querySelector('#workspace')?.textContent).toBe('Debugger ▾')
    const opened = await decodeLink(fragmentOf(await openShare()), ENCODINGS, fieldWidths() as number[])
    expect(opened.kind).toBe('whole')
    if (opened.kind !== 'whole') return
    expect(opened.encoding).toBe('binary')
    expect(opened.workspace.switches).toEqual(PRESETS.debugger)
    expect(opened.workspace).toEqual(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY)))
  })
})
