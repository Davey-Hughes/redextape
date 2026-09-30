import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { STYLE_IDS, type StyleId } from '../../src/skin'
import { SHELL, until } from './harness'

/**
 * THE HEADER'S SELECTS WEAR THE HEADER BUTTONS' CHROME, AND EVERY SELECT'S OPEN LIST IS IN THE PALETTE.
 *
 * Part 5c's roadmap entry left the encoding `<select>` native and unstyled. It was five, not one: `#encoding` in the
 * header and the settings menu's four. No rule reached any of them, so each drew in the browser's Arial at 13.33px on
 * its own grey field, the same in every style and palette. They now take the header buttons' font, padding, radius,
 * border and height, and the palette's text colour, not the dim colour of the label wrapping them.
 *
 * **`#buffers` IS THE REFERENCE**: it stands next to `#encoding`, and every header button shares its one rule, so any
 * of them would read the same. The expected text and option colours are read off `<body>`, whose own rule is
 * `var(--bg)` and `var(--fg)`.
 *
 * **THE HEIGHT IS SET, NOT LEFT TO THE FONT.** Chrome holds a select's `line-height` at `normal`, the font's own, so
 * without a height of its own a select stood 0.5px short of the buttons in Paper and Terminal and 1.5px in Instrument
 * on this machine's Noto — and 2.5px with DejaVu, which a review found by pointing `FONTCONFIG_FILE` at it. Paper and
 * Terminal draw in whatever system font the machine has, so the height is asserted EQUAL, in every style.
 *
 * **THE OPEN LIST IS THE OTHER HALF, AND IT COVERS EVERY SELECT ON THE PAGE.** Chrome paints a select's open list in
 * the select's own background, and a transparent one comes out WHITE, whatever `color-scheme` says. So the palette's
 * light text sat on white in dark mode, all but unreadable, and the step controls' speed select, transparent too,
 * opened that way. Each `<option>` now carries `--bg` and `--fg` itself. Its test walks every select the page holds,
 * rather than a list, so a select added later is held to the same rule without anyone naming it here.
 *
 * Every combination of style and light/dark is driven through the settings menu's own selects, with the menu open.
 * ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

const SELECTS = ['encoding', 'style', 'palette', 'appearance-choice', 'keymap'] as const
/** What a select shares with the header's buttons. */
const CHROME = [
  'font-family',
  'font-size',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  ...['top', 'right', 'bottom', 'left'].flatMap((side) =>
    ['width', 'style', 'color'].map((part) => `border-${side}-${part}`),
  ),
  'border-radius',
  'background-color',
]

const byId = (id: string) => document.getElementById(id) as HTMLElement
const rect = (el: Element) => el.getBoundingClientRect()
const menu = () => byId('settings-menu')
const speed = () => document.querySelector<HTMLSelectElement>('.pane .controls select.speed')

/** Open the settings menu with the pointer, if it is not open already. */
async function openSettings(): Promise<void> {
  if (menu().matches(':popover-open')) return
  await userEvent.click(byId('settings'))
  await until(() => menu().matches(':popover-open'), 'the settings menu to open')
}

/** Draw the page in `style` and `theme`, through the settings menu's own selects. */
async function wear(style: StyleId, theme: 'light' | 'dark'): Promise<void> {
  await openSettings()
  await userEvent.selectOptions(byId('style'), style)
  await userEvent.selectOptions(byId('appearance-choice'), theme)
  const root = document.documentElement
  await until(() => root.dataset.style === style && root.dataset.theme === theme, `${style} in ${theme}`)
  await document.fonts.ready
}

beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => speed() !== null, 'a view’s speed select')
})

describe.each(STYLE_IDS.flatMap((s) => (['light', 'dark'] as const).map((t) => [s, t] as const)))(
  'in %s, %s',
  (style, theme) => {
    it('the header’s five selects wear the header buttons’ chrome, in the palette’s text colour', async () => {
      await wear(style, theme)
      // THE PRECONDITION: the settings menu is open, so its four selects are laid out and what they compute is
      // what they paint.
      expect(menu().matches(':popover-open')).toBe(true)
      const buffers = byId('buffers')
      const reference = getComputedStyle(buffers)
      const fg = getComputedStyle(document.body).color
      for (const id of SELECTS) {
        const select = byId(id)
        expect(select.tagName).toBe('SELECT')
        expect(rect(select).width * rect(select).height, `#${id} is laid out`).toBeGreaterThan(0)
        const computed = getComputedStyle(select)
        for (const property of CHROME) {
          expect
            .soft(computed.getPropertyValue(property), `#${id}: ${property}`)
            .toBe(reference.getPropertyValue(property))
        }
        // THE LABEL WRAPPING IT IS DIM, so a select inheriting its colour would be dim too.
        expect(getComputedStyle(select.closest('label') as Element).color).not.toBe(fg)
        expect.soft(computed.color, `#${id}: color`).toBe(fg)
        expect.soft(rect(select).height, `#${id}: height`).toBe(rect(buffers).height)
      }
      // `#encoding` STANDS ON THE BUTTONS' LINE.
      const centre = (el: Element) => (rect(el).top + rect(el).bottom) / 2
      expect(Math.abs(centre(byId('encoding')) - centre(buffers))).toBeLessThan(1)
    })

    it('every select’s options take the palette’s background and text colour, the speed select’s too', async () => {
      await wear(style, theme)
      const body = getComputedStyle(document.body)
      const selects = [...document.querySelectorAll('select')]
      const found = selects.map((s) => (s.id === '' ? `.${s.className}` : `#${s.id}`))
      // THE PRECONDITION: the walk found the header's five and at least one view's speed select, laid out, and
      // every select it found has options to open. A walk over nothing would pass.
      for (const id of SELECTS) expect(found, `selects found: ${found.join(', ')}`).toContain(`#${id}`)
      expect(found.length, `selects found: ${found.join(', ')}`).toBeGreaterThan(SELECTS.length)
      const steps = speed() as HTMLSelectElement
      expect(steps, 'a view’s speed select').toBeInstanceOf(HTMLSelectElement)
      expect(rect(steps).width * rect(steps).height, 'the speed select is laid out').toBeGreaterThan(0)
      for (const [i, select] of selects.entries()) {
        expect(select.options.length, `${found[i]} has options`).toBeGreaterThan(1)
        for (const option of select.options) {
          const computed = getComputedStyle(option)
          expect.soft(computed.backgroundColor, `${found[i]} ${option.value}: background`).toBe(body.backgroundColor)
          expect.soft(computed.color, `${found[i]} ${option.value}: color`).toBe(body.color)
        }
      }
    })
  },
)
