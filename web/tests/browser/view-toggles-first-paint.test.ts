import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { STYLE_IDS, type StyleId } from '../../src/skin'
import { chooseStyle, frames, pressed, queryEl, SHELL, until } from './harness'

/**
 * THE `views` TOGGLES HOLD THEIR PLACE FROM THE FIRST PAINT — the view layouts spec §6. They are `index.html`'s own
 * markup, and `app-header.ts`'s `viewToggles` adopts them.
 *
 * Were they built after the wasm loads, in a header already on the page, `+ view`, `copies`, `examples` and `encoding`
 * would each move right by the group's width as it arrived.
 *
 * **WHAT IS HELD IS THE GROUP AND THE FOUR CONTROLS AFTER IT, THE `encoding` SELECT THE LAST**: where each starts,
 * and how wide the group and each button in it is, in the page's markup alone and again once the app is up. The app
 * presses the toggles of the views it shows, so this also holds a pressed toggle to the size of one that is not.
 *
 * **NOT HELD: THE REST OF THE HEADER, WHICH `main.ts` FILLS LATE.** The `encoding` select has no options until the wasm
 * lists them, and `#appearance` no label, so `share`, `about` and `settings` move when those arrive. In Terminal at
 * 1280 px the filled header keeps to one row because `style.css` halves Terminal's column gap up to 85rem
 * (`terminal-header-gap.test.ts` holds the gap).
 *
 * **IN A WINDOW 40rem WIDE OR NARROWER THE GROUP IS NOT DRAWN, BEFORE THE APP IS UP AS AFTER.** `main.ts` hides it
 * there with an attribute, which is not set until it runs; `style.css` has a media rule for the paint before that,
 * without which the header at 390 px would shrink when the attribute is set. **WHAT IS HELD THERE IS WHAT KEEPS THE
 * GROUP OFF THE PAGE**: its computed `display` with no attribute set, before the app is up, and the attribute after.
 * **NOT THE HEADER'S HEIGHT AT 390 px**: `main.ts` fills `encoding` and `#appearance` there as at any width, and with
 * the app up Terminal's header is taller than in the markup alone.
 *
 * The page's markup is `SHELL`, which `tests/node/harness.test.ts` holds to `index.html`. **ONE MOUNT, SO EVERY READING
 * OF THE MARKUP ALONE IS TAKEN BEFORE IT, IN A HOOK OF ITS OWN**, and the cases that assert on one read what the hook
 * kept. The mount is the hook after it, so the wasm load and the first compile have a hook's time and each case has
 * only its own reading to make.
 */

const tenth = (n: number): number => Math.round(n * 10) / 10
/** Where the group and the four controls after it start, and how wide the group and each of its buttons is. */
const places = (): Record<string, number | number[]> => ({
  group: tenth(queryEl('#views-shown').getBoundingClientRect().left),
  groupWidth: tenth(queryEl('#views-shown').getBoundingClientRect().width),
  toggles: [...document.querySelectorAll<HTMLElement>('#views-shown button')].map((b) =>
    tenth(b.getBoundingClientRect().width),
  ),
  newView: tenth(queryEl('#new-view').getBoundingClientRect().left),
  copies: tenth(queryEl('#buffers').getBoundingClientRect().left),
  examples: tenth(queryEl('#examples').getBoundingClientRect().left),
  encoding: tenth(queryEl('label.encoding').getBoundingClientRect().left),
})

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
  await frames()
  markup.narrow = {
    hidden: queryEl('#views-shown').hasAttribute('hidden'),
    display: getComputedStyle(queryEl('#views-shown')).display,
  }
  // 1280 px, THE MARKUP ALONE, IN EACH STYLE: `data-style` is what the pre-paint script sets from storage.
  await page.viewport(1280, 896)
  for (const style of STYLE_IDS) {
    root.setAttribute('data-style', style)
    await document.fonts.ready
    await frames()
    markup.wide.set(style, places())
  }
  if (shipped === null) root.removeAttribute('data-style')
  else root.setAttribute('data-style', shipped)
  markup.pressed = pressed()
})

beforeAll(async () => {
  await (await import('../../src/main')).ready
  await until(() => queryEl('#results').dataset.state === 'idle', 'the first compile')
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
    await frames()
    expect(places(), 'the app moved or resized what the markup had placed').toEqual(markup.wide.get(style))
  })

  it('are hidden by the attribute in a narrow window', async () => {
    await page.viewport(390, 844)
    await until(() => queryEl('#views-shown').hasAttribute('hidden'), 'the attribute to follow the window to 390 px')
    expect(queryEl('#views-shown').hidden).toBe(true)
  })
})
