import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { STYLE_IDS, type StyleId } from '../../src/skin'
import { chooseStyle, SHELL, until } from './harness'

/**
 * THE `views` TOGGLES HOLD THEIR PLACE FROM THE FIRST PAINT — the view layouts spec §6. They are `index.html`'s own
 * markup, and `app-header.ts`'s `viewToggles` adopts them.
 *
 * It built them, after the wasm had loaded, in a header already on the page. Measured at 1280 px before that changed
 * (2026-10-12): `+ view`, `copies`, `examples` and `encoding` each moved right by the group's width as it arrived,
 * 147.5 px in Paper, 149.1 in Terminal and 154.0 in Instrument.
 *
 * **WHAT IS HELD IS THE GROUP AND THE CONTROLS BETWEEN IT AND THE `encoding` SELECT**: where each starts, and how wide
 * the group and each button in it is, in the page's markup alone and again once the app is up. The app presses the
 * toggles of the views it shows, so this also holds a pressed toggle to the size of one that is not.
 *
 * **NOT HELD: THE REST OF THE HEADER, WHICH `main.ts` STILL FILLS LATE.** The `encoding` select has no options until
 * the wasm lists them, and `#appearance` no label, so `share`, `about` and `settings` move when those arrive, as they
 * did before the toggles existed. In Terminal at 1280 px the filled header was wider than the window, and `settings`
 * went to a second row then (46 px to 91); `style.css` halves Terminal's column gap up to 85rem since, and there the
 * header is 46 px in the markup alone and with the app up (measured 2026-10-12; `terminal-header-gap.test.ts` holds
 * the gap).
 *
 * **IN A WINDOW 40rem WIDE OR NARROWER THE GROUP IS NOT DRAWN, BEFORE THE APP IS UP AS AFTER.** `main.ts` hides it
 * there with an attribute, which is not set until it runs; `style.css` has a media rule for the paint before that.
 * Measured at 390 px without the rule: a header of 181 px that became 136. **WHAT IS HELD THERE IS WHAT KEEPS THE
 * GROUP OFF THE PAGE**: its computed `display` with no attribute set, before the app is up, and the attribute after.
 * **NOT THE HEADER'S HEIGHT AT 390 px**, which this compared before the app was up and after, in Instrument, where
 * the two agree: `main.ts` fills `encoding` and `#appearance` there as at any width, and the header is 136 px in each
 * style in the markup alone and, with the app up, 136 in Paper and Instrument and 181 in Terminal (measured
 * 2026-10-12).
 *
 * The page's markup is `SHELL`, which `tests/node/harness.test.ts` holds to `index.html`. **ONE MOUNT, SO EVERY
 * READING OF THE MARKUP ALONE IS TAKEN BEFORE IT, IN A HOOK OF ITS OWN**, and the cases that assert on one read what
 * the hook kept. The mount is the hook after it, as its siblings' is, so the wasm load and the first compile have a
 * hook's time and each case has only its own reading to make: this was one case under a case's cap, and took 6.2 s
 * of it at `CPUQuota=25%` (2026-10-12).
 */

const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
const el = (sel: string): HTMLElement => document.querySelector<HTMLElement>(sel) as HTMLElement
const tenth = (n: number): number => Math.round(n * 10) / 10
/** Where the group and the three controls after it start, and how wide the group and each of its buttons is. */
const places = (): Record<string, number | number[]> => ({
  group: tenth(el('#views-shown').getBoundingClientRect().left),
  groupWidth: tenth(el('#views-shown').getBoundingClientRect().width),
  toggles: [...document.querySelectorAll<HTMLElement>('#views-shown button')].map((b) =>
    tenth(b.getBoundingClientRect().width),
  ),
  newView: tenth(el('#new-view').getBoundingClientRect().left),
  copies: tenth(el('#buffers').getBoundingClientRect().left),
  examples: tenth(el('#examples').getBoundingClientRect().left),
  encoding: tenth(el('label.encoding').getBoundingClientRect().left),
})
const pressed = (): string[] =>
  [...document.querySelectorAll<HTMLButtonElement>('#views-shown button[aria-pressed="true"]')].map(
    (b) => b.dataset.shows as string,
  )

const FOUR = ['source', 'asm', 'lambda', 'tm']

/**
 * What the markup alone drew, read before the mount: the group at 390 px, and `places()` in each style at 1280 px.
 * Each starts as a value its case refuses, so a reading the hook did not take fails the case that asserts on it.
 */
const markup = {
  narrow: { hidden: true, display: '' },
  wide: new Map<StyleId, ReturnType<typeof places>>(),
  pressed: FOUR,
}

beforeAll(async () => {
  const root = document.documentElement
  const shipped = root.getAttribute('data-style')
  // 390 px, THE MARKUP ALONE: no attribute hides the group yet.
  await page.viewport(390, 844)
  document.body.innerHTML = SHELL
  await frame()
  markup.narrow = {
    hidden: el('#views-shown').hasAttribute('hidden'),
    display: getComputedStyle(el('#views-shown')).display,
  }
  // 1280 px, THE MARKUP ALONE, IN EACH STYLE: `data-style` is what the pre-paint script sets from storage.
  await page.viewport(1280, 896)
  for (const style of STYLE_IDS) {
    root.setAttribute('data-style', style)
    await document.fonts.ready
    await frame()
    markup.wide.set(style, places())
  }
  if (shipped === null) root.removeAttribute('data-style')
  else root.setAttribute('data-style', shipped)
  markup.pressed = pressed()
})

beforeAll(async () => {
  await (await import('../../src/main')).ready
  await until(() => el('#results').dataset.state === 'idle', 'the first compile')
})

describe('the views toggles, in the page’s markup before the app is up', () => {
  it('are not drawn in a narrow window, by the stylesheet and with no attribute set', () => {
    expect(markup.narrow.hidden, 'precondition: nothing has set the attribute').toBe(false)
    expect(markup.narrow.display, 'the group is drawn in a narrow window').toBe('none')
  })

  it('are the four, none of them pressed', () => {
    for (const style of STYLE_IDS) expect(markup.wide.get(style)?.toggles, `${style}: the four`).toHaveLength(4)
    expect(markup.pressed).toEqual([])
  })
})

describe('the views toggles, once the app is up', () => {
  it.each(STYLE_IDS)('are where the markup had them and as wide, in %s', async (style) => {
    await page.viewport(1280, 896)
    // ALL FOUR VIEWS (`setup.ts` stores that workspace), so every toggle is pressed where none was.
    expect(pressed(), 'precondition: the app pressed the toggles of the views it shows').toEqual(FOUR)
    await chooseStyle(style)
    await document.fonts.ready
    await frame()
    expect(places(), 'the app moved or resized what the markup had placed').toEqual(markup.wide.get(style))
  })

  it('are hidden by the attribute in a narrow window', async () => {
    await page.viewport(390, 844)
    await until(() => el('#views-shown').hasAttribute('hidden'), 'the attribute to follow the window to 390 px')
    expect(el('#views-shown').hidden).toBe(true)
  })
})
