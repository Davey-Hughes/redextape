import { computeAccessibleName } from 'dom-accessibility-api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import ABOUT from '../../about.html?raw'
import SVG from '../../public/favicon.svg?raw'
import '../../src/pages.css'
import { STYLE_IDS } from '../../src/skin'
import { mountAt, rem, until } from './harness'

/**
 * The red tape logo before the wordmark, on a page beside the app and on the app. 1280 px wide, a width at which the
 * logo adds no row to the header in any style; at some narrower ones it does (the roadmap's favicon entry).
 */
const WIDTH = 1280

/** The logo's own file: the tester's server answers `/favicon.svg` with Vitest's icon, not this one. */
const LOGO = `data:image/svg+xml,${encodeURIComponent(SVG)}`

const header = (): HTMLElement => document.querySelector('header.bar') as HTMLElement
const wordmark = (): HTMLElement => header().querySelector('.wordmark') as HTMLElement
const logo = (): HTMLImageElement => wordmark().querySelector('img') as HTMLImageElement

/** The box the word's own glyphs take, measured on its text rather than on the wordmark around the logo. */
function word(): DOMRect {
  const text = [...wordmark().childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim() !== '')
  const range = document.createRange()
  range.selectNodeContents(text as Node)
  return range.getBoundingClientRect()
}

const middle = (r: DOMRect): number => (r.top + r.bottom) / 2

/** The header's height with the logo taken out, the logo then put back where it was. */
function heightWithoutLogo(): number {
  const img = logo()
  const [parent, next] = [img.parentNode as Node, img.nextSibling]
  img.remove()
  const height = header().getBoundingClientRect().height
  parent.insertBefore(img, next)
  return height
}

/** Draw the page in `style` and `theme`, its fonts and the logo loaded. */
async function dress(style: string, theme: 'light' | 'dark'): Promise<void> {
  document.documentElement.dataset.style = style
  document.documentElement.dataset.theme = theme
  await document.fonts.ready
  await until(() => logo().complete && logo().naturalWidth > 0, 'the logo to load')
}

/** The cases each header answers, `name` naming it. */
function logoCases(name: string): void {
  it.each(STYLE_IDS)(`in %s, ${name}'s logo sits left of the word and centred on it`, async (style) => {
    await dress(style, 'light')
    const [img, text] = [logo().getBoundingClientRect(), word()]
    expect(text.width, 'precondition: the word is drawn').toBeGreaterThan(0)
    expect(img.right, 'the logo ends before the word starts').toBeLessThanOrEqual(text.left)
    expect(Math.abs(middle(img) - middle(text)), 'the logo centred on the word, in px').toBeLessThanOrEqual(1)
  })

  it.each(STYLE_IDS)(`in %s, ${name}'s header is as tall with the logo as without it`, async (style) => {
    await dress(style, 'light')
    expect(header().getBoundingClientRect().height).toBe(heightWithoutLogo())
  })

  it(`hides ${name}'s logo at the phone breakpoint, 30rem, and shows it a pixel wider`, async () => {
    const { page } = await import('vitest/browser')
    await dress('paper', 'light')
    const [phone, height] = [30 * rem(), window.innerHeight]
    try {
      const at = async (width: number): Promise<[string, number]> => {
        await page.viewport(width, height)
        return [getComputedStyle(logo()).display, logo().getBoundingClientRect().width]
      }
      expect(await at(phone), 'at 30rem').toEqual(['none', 0])
      expect(await at(phone + 1), 'a pixel wider').toEqual(['block', 22])
    } finally {
      await page.viewport(WIDTH, height)
    }
  })

  it(`keeps ${name}'s logo its own colours in every style and theme`, async () => {
    for (const style of STYLE_IDS) {
      for (const theme of ['light', 'dark'] as const) {
        await dress(style, theme)
        for (let el: Element | null = logo(); el !== null; el = el.parentElement) {
          const css = getComputedStyle(el)
          expect([css.filter, css.mixBlendMode, css.opacity], `${style}, ${theme}: <${el.localName}>`).toEqual([
            'none',
            'normal',
            '1',
          ])
        }
      }
    }
  })
}

afterAll(() => {
  delete document.documentElement.dataset.style
  delete document.documentElement.dataset.theme
})

describe('the wordmark on a page beside the app', () => {
  beforeAll(async () => {
    const { page } = await import('vitest/browser')
    await page.viewport(WIDTH, 600)
    document.body.className = 'page'
    document.body.innerHTML = /<header class="bar">[\s\S]*?<\/header>/.exec(ABOUT)?.[0] ?? ''
    logo().src = LOGO
  })

  logoCases('about.html')

  it("leaves the link's accessible name the word alone", () => {
    expect(computeAccessibleName(wordmark())).toBe('redextape')
  })

  it('takes its place before the logo has loaded, so the load moves nothing', async () => {
    await dress('paper', 'light')
    const [left, height] = [word().left, header().getBoundingClientRect().height]
    const loaded = logo()
    const pending = document.createElement('img')
    for (const { name, value } of loaded.attributes) if (name !== 'src') pending.setAttribute(name, value)
    await commands.holdRequests('favicon.svg?held')
    try {
      pending.src = '/favicon.svg?held'
      loaded.replaceWith(pending)
      expect(pending.complete, 'precondition: the logo has not loaded').toBe(false)
      expect([word().left, header().getBoundingClientRect().height]).toEqual([left, height])
    } finally {
      await commands.releaseRequests()
      pending.replaceWith(loaded)
    }
  })
})

describe('the wordmark on the app', () => {
  beforeAll(async () => {
    document.body.className = ''
    await mountAt(WIDTH, 800)
    logo().src = LOGO
  })

  logoCases('the app')
})
