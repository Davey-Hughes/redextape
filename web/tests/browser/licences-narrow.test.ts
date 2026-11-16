import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import '../../src/pages.css'
import { renderLicences } from '../../src/licences-page'
import { initPage } from '../../src/pages'

/**
 * **THE LICENCES PAGE AT A PHONE'S WIDTH** — edge-spacing design, decision 3. The body is `licences.html`'s as the
 * server serves it, with its script left out and run here as the page runs it, under `pages.css` (`setup.ts` gives
 * every file `style.css`). Every licence is opened, because a closed `details` lays out only its summary and a link
 * inside it has no box to measure.
 */

beforeAll(async () => {
  await page.viewport(390, 844)
  const served = new DOMParser().parseFromString(await (await fetch('/licences.html')).text(), 'text/html')
  for (const script of served.body.querySelectorAll('script')) script.remove()
  document.body.className = served.body.className
  document.body.replaceChildren(...served.body.childNodes)
  initPage()
  renderLicences()
  for (const d of document.querySelectorAll('details')) d.open = true
  await document.fonts.ready
})

const links = () => [...document.querySelectorAll<HTMLAnchorElement>('.page .meta a')]

describe('the licences page at 390 px, every licence open', () => {
  it('is the served page, with its packages drawn', () => {
    expect(document.body.classList.contains('page')).toBe(true)
    expect(document.querySelectorAll('#notices details').length).toBeGreaterThan(0)
    expect(links().length).toBeGreaterThan(0)
  })

  it('does not scroll sideways', () => {
    const root = document.documentElement
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
  })

  it("ends every package's link inside the page", () => {
    const right = (e: Element | null) => (e as Element).getBoundingClientRect().right
    const outside = links()
      .filter((a) => right(a) > right(a.closest('.page')))
      .map((a) => a.href)
    expect(outside).toEqual([])
  })
})
