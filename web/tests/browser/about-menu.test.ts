import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { BUILD } from '../../src/build-info'
import { SHELL, until } from './harness'

/**
 * **THE ABOUT MENU** — about pages design §5: just before settings, a popover of links to the four pages and the
 * source, each opening in a new tab so the app keeps its stepping position, and the build beneath them. ONE MOUNT
 * FOR THE FILE, for the reason every sibling gives.
 */

const button = () => document.querySelector<HTMLButtonElement>('#about') as HTMLButtonElement
const menu = () => document.querySelector<HTMLElement>('#about-menu') as HTMLElement
const links = () => [...menu().querySelectorAll<HTMLAnchorElement>('a')]

beforeAll(async () => {
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('the about menu', () => {
  it('opens on a click, says so, and focuses its first link', async () => {
    expect(button().getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(button())
    expect(menu().matches(':popover-open')).toBe(true)
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(links()[0])
    await userEvent.keyboard('{Escape}')
    expect(menu().matches(':popover-open')).toBe(false)
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button())
  })

  /** Its items are links, not menu items, so it is a disclosure as `share` is — spec §5's amendment. */
  it('names what it controls, and claims no menu', () => {
    expect(button().getAttribute('aria-controls')).toBe('about-menu')
    expect(button().hasAttribute('aria-haspopup')).toBe(false)
    expect(computeAccessibleName(button())).toBe('about')
  })

  it('links the four pages and the source, each in a new tab with no opener', () => {
    expect(links().map((a) => a.textContent?.trim())).toEqual(['about', 'help', 'licences', 'privacy', 'source ↗'])
    expect(
      links()
        .map((a) => new URL(a.href).pathname)
        .slice(0, 4),
    ).toEqual(['/about.html', '/help.html', '/licences.html', '/privacy.html'])
    for (const a of links()) {
      expect(a.target, a.textContent ?? '').toBe('_blank')
      expect(a.rel, a.textContent ?? '').toBe('noopener')
    }
  })

  /** The arrow on `source` is drawn and not read; every link says aloud what only that arrow shows. */
  it('names each link without its arrow, and says each opens a new tab', () => {
    expect(links().map((a) => computeAccessibleName(a))).toEqual(['about', 'help', 'licences', 'privacy', 'source'])
    for (const a of links()) expect(computeAccessibleDescription(a), a.textContent ?? '').toBe('opens in a new tab')
  })

  /**
   * **PICKING ONE CLOSES THE MENU**, as every header menu's item does, and the focus goes back to its button. The
   * click's default — the new tab — is prevented here, so the test page stays where it is.
   */
  it('closes when a link is picked, and gives the focus back to its button', async () => {
    const stay = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('a[href]') !== null) e.preventDefault()
    }
    document.addEventListener('click', stay, { capture: true })
    try {
      await userEvent.click(button())
      expect(menu().matches(':popover-open')).toBe(true)
      await userEvent.click(links()[1] as HTMLAnchorElement)
      expect(menu().matches(':popover-open')).toBe(false)
      expect(button().getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(button())
    } finally {
      document.removeEventListener('click', stay, { capture: true })
      if (menu().matches(':popover-open')) menu().hidePopover()
    }
  })

  /** Leftward under its button, as `settings` beside it opens — measured, since nothing else holds `.header-menu.about`. */
  it('opens under its button, leftward, at a desktop width', async () => {
    await page.viewport(1280, 896)
    try {
      await userEvent.click(button())
      const b = button().getBoundingClientRect()
      const m = menu().getBoundingClientRect()
      expect(m.top).toBeGreaterThanOrEqual(b.bottom - 1)
      expect(Math.abs(m.right - b.right)).toBeLessThanOrEqual(1)
      expect(m.left).toBeLessThan(b.left)
    } finally {
      if (menu().matches(':popover-open')) menu().hidePopover()
    }
  })

  /** This test's build has no commit defined, so it is a dev build and its source is the mirror's `main`. */
  it("names this build and links this build's source", () => {
    expect(document.querySelector('#about-build')?.textContent).toBe(BUILD.label)
    expect(document.querySelector<HTMLAnchorElement>('#about-source')?.href).toBe(BUILD.source)
    expect(BUILD.label).toBe('dev build')
  })

  it('draws its links as the other menus draw their items, without underlines', async () => {
    await userEvent.click(button())
    try {
      const first = getComputedStyle(links()[0] as HTMLAnchorElement)
      expect(first.display).toBe('block')
      expect(first.textDecorationLine).toBe('none')
    } finally {
      menu().hidePopover()
    }
  })
})
