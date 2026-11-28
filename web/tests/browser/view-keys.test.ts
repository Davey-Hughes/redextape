import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cdp, page, userEvent } from 'vitest/browser'
import { HEADER_ORDER, LAYOUT_STORAGE_KEY, type LayoutNode, type MoveDirection, moveLeaf } from '../../src/layout'
import { HINT_ROWS, HINT_SENTENCE } from '../../src/view-keys'
import { chromiumOnly } from './engine'
import {
  armed,
  chooseOption,
  clickWorkspaceItem,
  drawn,
  focusInPage,
  live,
  mounted,
  notice,
  PREFIX,
  resetToFourViews,
  SHELL,
  stateIdle,
  titleText,
  until,
} from './harness'

/**
 * VIEW KEYS, THROUGH THE PAGE — the view layouts spec §7: the prefix chord arms a mode from wherever the focus is, the
 * next key acts and the mode is over, and a key the mode does not know is the editor's, typing as it does while the
 * mode is idle. `tests/node/view-keys.test.ts` holds the machine's table; this file holds the one listener that feeds
 * it, which is where an editor's keymap and the vim extension could take a key first.
 *
 * **KEYS ARRIVE THROUGH `userEvent`**, for `vim-keymap.test.ts`'s reason: half of what is asserted is that a key DID
 * or DID NOT type a character, and a synthetic `keydown` types nothing whatever the page does with it.
 *
 * **EVERY CASE STARTS FROM ALL FOUR VIEWS WITH THE CARET IN THE SOURCE EDITOR**, which `start` puts back and asserts,
 * so a case run alone fails on its precondition and not on another case's leavings. **AND NO CASE LEAVES THE MODE
 * ARMED FOR THE NEXT, OR A DIALOG OPEN**: a case that fails between its prefix and its second key would, and every
 * case after it would fail on `start`'s precondition, so after each one a modal dialog is closed and the mode left.
 *
 * **THE CARET STARTS INSIDE THE SECOND LINE, AT `CARET`, AND NOT AT 0.** An action from the editor is a rebuild that
 * takes the editor off the page and puts it back, and a caret that came back at the start of the document is where
 * one left at 0 already was. So a case that acts from the editor reads the caret after, and a key that types is
 * expected at `CARET` (`typed`).
 */

/** `[`, as `userEvent.keyboard` spells it: a single `[` opens a key code, as in `[KeyA]`. */
const PREVIOUS = '[['
const SOURCE = 'let x = 40;\nx + 2'
/** Where `start` puts the caret: in `x + 2`, before its `+`. */
const CARET = 14
/** The program with `text` typed at `CARET`. */
const typed = (text: string): string => `${SOURCE.slice(0, CARET)}${text}${SOURCE.slice(CARET)}`
/** The program with the `count` characters from `CARET` on deleted, as vim's `x` deletes them. */
const cut = (count: number): string => `${SOURCE.slice(0, CARET)}${SOURCE.slice(CARET + count)}`

let view: EditorView
/** The arrangement the first load drew, as `drawn` reads it: the one `start` puts back. */
let first: string

const hint = (): HTMLElement => document.querySelector('#view-keys') as HTMLElement

/** The tree the app stored last, which is the tree on screen once a gesture has run. */
const storedTree = (): LayoutNode => JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}').tree

/** Where the view `leaf` is drawn, as plain numbers: a `DOMRect`'s are getters, which `toEqual` does not compare. */
const place = (leaf: string) => {
  const r = (
    document.querySelector(`#views [data-leaf="${leaf}"]:not([role="tab"])`) as HTMLElement
  ).getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** Where each of the four views is drawn. */
const everyPlace = () => Object.fromEntries(['source', 'lambda-0', 'rxm-0', 'tm-0'].map((leaf) => [leaf, place(leaf)]))

/** Every view of `was` drawn within 1 px of where it was, each edge and extent, after `gesture`. */
const placedAs = (was: ReturnType<typeof everyPlace>, gesture: string): void => {
  for (const [leaf, box] of Object.entries(was)) {
    const now = place(leaf)
    for (const k of ['left', 'top', 'width', 'height'] as const)
      expect(Math.abs(now[k] - box[k]), `after ${gesture}, ${leaf}'s ${k}`).toBeLessThanOrEqual(1)
  }
}

/**
 * All four views in the first load's arrangement, the program as this file wrote it, and the caret in the source
 * editor at `CARET`.
 */
async function start(): Promise<void> {
  // EVERY TOGGLE BUT CLIF'S PRESSED, AND CLIF'S NOT: a case that fails between showing the CLIF view and hiding it
  // again leaves it shown.
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views-shown button'))
    if ((b.getAttribute('aria-pressed') === 'true') === (b.dataset.shows === 'clif')) b.click()
  // THE FIRST LOAD'S ARRANGEMENT, PUT BACK WHERE A CASE LEFT THE VIEWS IN OTHER PLACES: a move case that fails between
  // its move and the move back leaves them so, and the toggles above cannot undo it, since all four come back as they
  // were left (the view layouts spec §4.5).
  if (drawn() !== first) await resetToFourViews()
  if (view.state.doc.toString() !== SOURCE) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SOURCE } })
    await until(stateIdle, 'the program to compile again')
  }
  view.focus()
  view.dispatch({ selection: { anchor: CARET } })
  await until(() => view.hasFocus, 'the source editor to take the focus')
  expect(mounted(), 'precondition: all four views').toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0'])
  expect(armed(), 'precondition: the mode is not armed').toBe(false)
}

/**
 * Press the prefix, and hold that it armed the mode. **A CASE THAT ASSERTS THE MODE ENDED ASSERTS IT BEGAN**: with a
 * prefix that armed nothing, a key the mode does not know is typed, the mode reads as ended and the views are as they
 * were, which is all that case asked.
 */
async function prefix(): Promise<void> {
  await userEvent.keyboard(PREFIX)
  expect(armed(), 'the prefix did not arm the mode').toBe(true)
}

/**
 * The caret is where `start` put it: the rebuild took the editor off the page and did not cost it its place.
 * `gesture` names what rebuilt it, for the failure's message.
 */
const caretKept = (gesture = 'switch'): void => {
  expect(view.hasFocus, `the ${gesture} took the focus out of the editor`).toBe(true)
  expect(view.state.selection.main.head, 'the caret is not where it was').toBe(CARET)
}

describe('view keys', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SOURCE } })
    await until(
      () => stateIdle() && (document.querySelector('#results')?.textContent ?? '').includes('λ 42'),
      'the compile',
    )
    first = drawn()
  })

  afterEach(async () => {
    // A DIALOG A FAILED CASE LEFT OPEN GOES FIRST: under one the page takes no focus, and the mode does not hear
    // Escape. Its `close` event comes a task later and hands the focus to `settings`, so it is waited for: without the
    // wait, it would take the focus from the next case's editor.
    const dialog = document.querySelector<HTMLDialogElement>('dialog:modal')
    if (dialog !== null) {
      const closed = new Promise((done) => dialog.addEventListener('close', done, { once: true }))
      dialog.close()
      await closed
    }
    if (armed()) await userEvent.keyboard('{Escape}')
  })

  it('arms on the prefix from the source editor, shows the keys, and leaves on Escape without a mark', async () => {
    await start()
    // `armed` READS THE HINT'S `hidden` ATTRIBUTE, AND A READER SEES ITS BOX: none while the mode is not armed, and
    // one inside the window while it is. `hidden.test.ts` holds every hidden element on the page to having no box.
    expect(hint().getBoundingClientRect().height, 'the hint is drawn while the mode is not armed').toBe(0)
    // WHAT THE LIVE REGION IS TOLD FROM HERE ON, WRITE BY WRITE, and not what it holds: it holds the sentence already
    // where a case before this one armed the mode, and a sentence said twice is written twice (`notice.ts`'s
    // `createNotices`).
    const region = document.querySelector('#live') as HTMLElement
    const said: string[] = []
    const watch = new MutationObserver((records) => {
      for (const record of records) said.push((record.addedNodes[0]?.textContent ?? '').trim())
    })
    watch.observe(region, { childList: true })
    await prefix()
    const box = hint().getBoundingClientRect()
    expect(box.height, 'the hint has no box while the mode is armed').toBeGreaterThan(0)
    expect(box.top, 'the hint is above the window').toBeGreaterThanOrEqual(0)
    expect(box.bottom, 'the hint is below the window').toBeLessThanOrEqual(window.innerHeight)
    // THE HINT'S ROWS ARE THE TABLE'S, EACH A KEY AND WHAT IT DOES, AND THE LIVE REGION SAYS THEM AS ONE SENTENCE
    // (`tests/node/view-keys.test.ts` holds the sentence's words): a reader who does not see the hint hears it.
    expect([...hint().querySelectorAll('kbd')].map((k) => k.textContent)).toEqual([
      ']',
      '[',
      ...HEADER_ORDER.map((_, i) => String(i + 1)),
      'h',
      'j',
      'k',
      'l',
      'Esc',
    ])
    expect([...hint().children].map((row) => row.textContent)).toEqual([
      'view keys',
      ...HINT_ROWS.map((row) => `${row.key} ${row.does}`),
    ])
    expect(live()).toBe(HINT_SENTENCE)
    expect(said, 'arming the mode did not say the keys, once').toEqual([HINT_SENTENCE])
    await userEvent.keyboard('{Escape}')
    expect(armed()).toBe(false)
    watch.disconnect()
    expect(said, 'leaving the mode was said in the live region').toEqual([HINT_SENTENCE])
    expect(hint().getBoundingClientRect().height, 'the hint is still drawn once the mode is left').toBe(0)
    expect(view.state.doc.toString(), 'the prefix or Escape typed something').toBe(SOURCE)
    caretKept()
    expect(mounted()).toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0'])
  })

  it('goes to the next layout on ] and the previous on [, with the caret where it was in the editor', async () => {
    await start()
    await prefix()
    await userEvent.keyboard(']')
    // ALL FOUR IS THE CYCLE'S LAST STOP, SO THE NEXT IS ITS FIRST: the source beside λ, the header's second toggle.
    expect(mounted()).toEqual(['source', 'lambda-0'])
    expect(armed(), 'the mode stayed armed after its one action').toBe(false)
    expect(live()).toBe('showing source and λ')
    expect(view.state.doc.toString(), 'the ] was typed').toBe(SOURCE)
    caretKept()
    await prefix()
    await userEvent.keyboard(']')
    expect(mounted()).toEqual(['source', 'tm-0'])
    await prefix()
    await userEvent.keyboard(PREVIOUS)
    await prefix()
    await userEvent.keyboard(PREVIOUS)
    expect(mounted()).toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0'])
    expect(view.state.doc.toString(), 'a [ was typed').toBe(SOURCE)
    caretKept()
  })

  /** THE NATURAL MOTION: `Ctrl` held down through both keys. */
  it('answers the second key with Ctrl still held', async () => {
    await start()
    await userEvent.keyboard('{Control>}.')
    expect(armed(), 'the prefix did not arm the mode').toBe(true)
    await userEvent.keyboard(']{/Control}')
    expect(mounted(), 'Ctrl held through ] did not go to the next layout').toEqual(['source', 'lambda-0'])
    expect(armed()).toBe(false)
    await userEvent.keyboard('{Control>}.3{/Control}')
    expect(mounted(), 'Ctrl held through 3 did not show the TM view').toEqual(['source', 'lambda-0', 'tm-0'])
    expect(view.state.doc.toString(), 'a key was typed').toBe(SOURCE)
    caretKept()
  })

  it('toggles the four kinds on 1 to 4, in the header’s order', async () => {
    await start()
    for (const [key, without] of [
      ['2', ['source', 'rxm-0', 'tm-0']],
      ['3', ['source', 'lambda-0', 'rxm-0']],
      ['4', ['source', 'lambda-0', 'tm-0']],
    ] as const) {
      await prefix()
      await userEvent.keyboard(key)
      expect(mounted(), `after ${key}`).toEqual(without)
      await prefix()
      await userEvent.keyboard(key)
      expect(mounted(), `after ${key} again`).toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0'])
    }
    expect(view.state.doc.toString(), 'a digit was typed').toBe(SOURCE)
    caretKept()
    // `1` LAST, SINCE IT HIDES THE VIEW THE CARET IS IN: the focus goes to another view (the case below), and the
    // second `1` is pressed from there.
    await prefix()
    await userEvent.keyboard('1')
    expect(mounted(), 'after 1').toEqual(['lambda-0', 'rxm-0', 'tm-0'])
    await prefix()
    await userEvent.keyboard('1')
    expect(mounted(), 'after 1 again').toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0'])
    expect(view.state.doc.toString(), 'a digit was typed').toBe(SOURCE)
  })

  it('toggles CLIF on 5', async () => {
    await start()
    await prefix()
    await userEvent.keyboard('5')
    // THE FIVE, IN WHATEVER ORDER THE ARRANGEMENT OF ALL FIVE PLACES THEM.
    expect([...mounted()].sort(), 'after 5').toEqual(['clif-0', 'lambda-0', 'rxm-0', 'source', 'tm-0'])
    expect(titleText('clif-0'), 'the view 5 showed is not a CLIF view').toBe('clif · program')
    await prefix()
    await userEvent.keyboard('5')
    expect(mounted(), 'after 5 again').toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0'])
    expect(view.state.doc.toString(), 'a digit was typed').toBe(SOURCE)
    caretKept()
  })

  it('hands the focus to the focused view when the key hides the view that held it', async () => {
    await start()
    await prefix()
    await userEvent.keyboard('1')
    expect(mounted()).toEqual(['lambda-0', 'rxm-0', 'tm-0'])
    expect(document.activeElement, 'the focus fell to <body>').not.toBe(document.body)
    // THE FOCUSED VIEW, AND NOT ANY VIEW ON THE PAGE: the source view was the focused one and left, so it is the first
    // view of the new tree that is not the source (`workspace.ts`'s `defaultFocus`).
    expect(
      document.activeElement?.closest<HTMLElement>('#views [data-leaf]')?.dataset.leaf,
      'the focus is not in the focused view',
    ).toBe('lambda-0')
    await prefix()
    await userEvent.keyboard('1')
    expect(mounted()).toContain('source')
    expect(view.state.doc.toString(), 'the source editor lost its text while it was off the page').toBe(SOURCE)
  })

  /**
   * A MODIFIER PRESSED ALONE DOES NOT END THE MODE (spec §7.3), a lock key among them. Each is pressed and let go by
   * `userEvent`, so its `keydown` is the browser's own: `Alt`'s says `Alt` is down, and a lock key's says nothing is.
   * These eight are the ones pressed here; `tests/node/view-keys.test.ts` has the whole list. **`Control` AMONG THEM**,
   * the prefix's own modifier, let go after the prefix and pressed again by itself.
   */
  it.for(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock'])(
    'stays armed through %s pressed alone, and the key after it acts',
    async (modifier, ctx) => {
      if (modifier === 'AltGraph')
        chromiumOnly(ctx, 'Playwright’s Firefox cannot press AltGraph: its keyboard.down fails with a protocol error')
      await start()
      await prefix()
      await userEvent.keyboard(`{${modifier}}`)
      expect(armed(), `${modifier} ended the mode`).toBe(true)
      await userEvent.keyboard('4')
      expect(mounted(), `the key after ${modifier} did not act`).toEqual(['source', 'lambda-0', 'tm-0'])
      expect(view.state.doc.toString(), 'a key was typed').toBe(SOURCE)
      caretKept()
    },
  )

  it('ends on a key it does not know, which types as it does while the mode is idle', async () => {
    await start()
    await prefix()
    await userEvent.keyboard('x')
    expect(armed()).toBe(false)
    expect(view.state.doc.toString(), 'the key after the prefix did not reach the editor').toBe(typed('x'))
    expect(mounted()).toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0'])
  })

  it('is over after one action: the next 3 is the editor’s, typed where the caret was', async () => {
    await start()
    await prefix()
    await userEvent.keyboard('3')
    caretKept()
    await userEvent.keyboard('3')
    expect(view.state.doc.toString(), 'a second key was taken as an action, or the caret moved').toBe(typed('3'))
    expect(mounted()).toEqual(['source', 'lambda-0', 'rxm-0'])
  })

  /**
   * A KEY HELD DOWN IS ONE PRESS (`view-keys.ts`'s `wireViewKeys`). `{k>3/}` presses `k`, repeats it twice and lets
   * it go, and the two repeats arrive as `keydown`s marked `repeat`.
   */
  describe('a key held down', () => {
    it('stays armed while the prefix is held', async () => {
      await start()
      await userEvent.keyboard('{Control>}{.>2/}{/Control}')
      expect(armed(), 'the prefix’s first repeat left the mode').toBe(true)
      await userEvent.keyboard('{Escape}')
      expect(armed()).toBe(false)
      await userEvent.keyboard('{Control>}{.>3/}{/Control}')
      expect(armed(), 'the prefix’s second repeat left the mode').toBe(true)
      await userEvent.keyboard('4')
      expect(mounted(), 'the key after a held prefix did not act').toEqual(['source', 'lambda-0', 'tm-0'])
      expect(view.state.doc.toString(), 'a repeat of the prefix reached the editor').toBe(SOURCE)
      caretKept()
    })

    it('acts once on a table key held after the prefix, and its repeats type nothing', async () => {
      await start()
      await prefix()
      await userEvent.keyboard('{4>3/}')
      expect(mounted(), 'a held 4 did not hide the rxm view once').toEqual(['source', 'lambda-0', 'tm-0'])
      expect(armed()).toBe(false)
      expect(view.state.doc.toString(), 'the repeats of 4 were typed').toBe(SOURCE)
      caretKept()
    })

    it('acts once with Ctrl held through a held ], and its repeats are not the editor’s Ctrl+]', async () => {
      await start()
      await userEvent.keyboard('{Control>}.{]>3/}{/Control}')
      expect(mounted(), 'a held ] did not go to the next layout once').toEqual(['source', 'lambda-0'])
      // CODEMIRROR'S `Ctrl+]` INDENTS THE LINE: each repeat that reached the editor would be an indent.
      expect(view.state.doc.toString(), 'the repeats of Ctrl+] indented the line').toBe(SOURCE)
      caretKept()
    })

    it('leaves once on a held Escape, and its repeats are not the editor’s', async () => {
      await start()
      view.dispatch({ selection: { anchor: CARET - 2, head: CARET } })
      await prefix()
      await userEvent.keyboard('{Escape>3/}')
      expect(armed()).toBe(false)
      // THE EDITOR'S `Escape` MAKES A SELECTION A CARET (`defaultKeymap`'s `simplifySelection`).
      expect(view.state.selection.main.empty, 'a repeat of Escape reached the editor').toBe(false)
    })

    it('lets a held key it does not know repeat into the editor', async () => {
      await start()
      await prefix()
      await userEvent.keyboard('{x>3/}')
      expect(armed()).toBe(false)
      expect(view.state.doc.toString(), 'the press and its two repeats were not all typed').toBe(typed('xxx'))
      expect(mounted()).toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0'])
    })

    /**
     * **A REPEAT IS ITS OWN KEY'S, WHATEVER WAS PRESSED OR RELEASED SINCE THE PRESS.** `userEvent.keyboard` lets go
     * of a key it holds before it presses it again, under the name the key was pressed by, so a repeat that follows
     * another key is asked for under the key's other name: `Period` is `.`, `KeyX` is `x` and `Digit2` is `2`, and
     * the browser, which knows a key by its `code`, sends a repeat.
     */
    it.each([
      ['Ctrl is let go', '{Period>2/}'],
      // WITH `Shift` DOWN THE SAME KEY'S `key` IS `>`: the repeat is told by the key's `code`, which does not change.
      ['Ctrl is let go and Shift is pressed', '{Shift>}{Period>2/}{/Shift}'],
    ])('takes the repeats of a held prefix as the prefix’s after %s', async (_what, repeats) => {
      await start()
      try {
        await userEvent.keyboard('{Control>}{.>}{/Control}')
        expect(armed(), 'the prefix did not arm the mode').toBe(true)
        await userEvent.keyboard(repeats)
        expect(armed(), 'a repeat of the prefix’s key left the mode').toBe(true)
        expect(view.state.doc.toString(), 'a repeat of the prefix’s key was typed').toBe(SOURCE)
      } finally {
        await userEvent.keyboard('{/.}')
      }
      await userEvent.keyboard('4')
      expect(mounted(), 'the key after the held prefix did not act').toEqual(['source', 'lambda-0', 'tm-0'])
    })

    it('lets a key held since before the prefix repeat into the editor, and stays armed', async () => {
      await start()
      try {
        await userEvent.keyboard('{x>}')
        await prefix()
        await userEvent.keyboard('{KeyX>2/}')
        expect(view.state.doc.toString(), 'the repeats of a key the editor was given were kept from it').toBe(
          typed('xxx'),
        )
        expect(armed(), 'a repeat of a key pressed before the prefix ended the mode').toBe(true)
      } finally {
        await userEvent.keyboard('{/x}')
      }
      await userEvent.keyboard('4')
      expect(mounted(), 'the key after the prefix did not act').toEqual(['source', 'lambda-0', 'tm-0'])
    })

    it('takes the repeats of a table key as its own after another key is pressed, until it is pressed again', async () => {
      await start()
      try {
        await prefix()
        await userEvent.keyboard('{2>}')
        expect(mounted()).toEqual(['source', 'rxm-0', 'tm-0'])
        // `y` IS THE EDITOR'S, AND THE MODE IS OVER: only the `2` still held is this listener's.
        await userEvent.keyboard('y')
        await userEvent.keyboard('{Digit2>2/}')
        expect(view.state.doc.toString(), 'a repeat of the 2 that acted was typed').toBe(typed('y'))
        expect(mounted(), 'a repeat of the 2 acted again').toEqual(['source', 'rxm-0', 'tm-0'])
      } finally {
        await userEvent.keyboard('{/2}')
      }
      // PRESSED AGAIN WITH THE MODE OVER, `2` IS THE EDITOR'S, AND SO ARE ITS REPEATS.
      await userEvent.keyboard('{2>2/}')
      expect(view.state.doc.toString(), 'a 2 pressed and held with the mode over was not typed twice').toBe(
        typed('y22'),
      )
    })

    /**
     * Under vim a digit is a count, `2x` deleting two characters (the doc of `runs ahead of vim: …`, below), so a
     * repeat of the `2` that reached vim would stay as one, and the next `x` would delete that many characters. And
     * vim's `.` does the last change again, the `x`: a repeat of the prefix's key that reached vim with `Ctrl` up would
     * delete one more.
     */
    it('leaves vim no count from the repeats of a table key, and no command from the prefix’s', async () => {
      await start()
      chooseOption('#keymap', 'vim')
      try {
        await until(() => view.scrollDOM.classList.contains('cm-vimMode'), 'vim’s normal mode')
        view.focus()
        await until(() => view.hasFocus, 'the source editor to take the focus')
        await prefix()
        await userEvent.keyboard('{2>3/}')
        expect(mounted(), 'a held 2 did not hide the λ view once').toEqual(['source', 'rxm-0', 'tm-0'])
        await userEvent.keyboard('x')
        expect(view.state.doc.toString(), 'vim took the repeats of 2 as a count').toBe(cut(1))
        try {
          await userEvent.keyboard('{Control>}{.>}{/Control}{Period>2/}')
          expect(armed(), 'a repeat of the prefix’s key, with Ctrl up, left the mode under vim').toBe(true)
          expect(view.state.doc.toString(), 'a repeat of the prefix’s key reached vim as its .').toBe(cut(1))
        } finally {
          await userEvent.keyboard('{/.}')
        }
      } finally {
        chooseOption('#keymap', 'default')
      }
    })
  })

  it('says why on the notice line when the key is for the only view shown', async () => {
    await start()
    for (const key of ['2', '3', '4']) {
      await prefix()
      await userEvent.keyboard(key)
    }
    expect(mounted()).toEqual(['source'])
    await prefix()
    await userEvent.keyboard('1')
    expect(mounted(), 'the last view was hidden').toEqual(['source'])
    expect(notice()).toBe('the source view is the only one shown — one view stays')
    caretKept()
  })

  /**
   * **A MOVE KEY MOVES THE FOCUSED VIEW** (spec §7.3, §9), here the source view, which holds the caret. All four put
   * it beside λ in a row of their own, so `l` trades their places and `←` trades them back, each place keeping its
   * size. The live region says what moved and which way (§9.5), and the caret stays where it was, as after a switch.
   */
  it('moves the focused view on l and back on the left arrow, keeping the caret, and says what moved', async () => {
    await start()
    const tree = storedTree()
    expect(
      moveLeaf(moveLeaf(tree, 'source', 'right') ?? tree, 'source', 'left'),
      'precondition: the source view moves right and back left to the tree it left',
    ).toEqual(tree)
    const [source, lambda] = [place('source'), place('lambda-0')]
    expect(source.top, 'precondition: λ is beside the source view').toBe(lambda.top)
    expect(source.left, 'precondition: λ is to the right of the source view').toBeLessThan(lambda.left)
    await prefix()
    await userEvent.keyboard('l')
    expect(place('source'), 'l did not put the source view where λ was').toEqual(lambda)
    expect(place('lambda-0'), 'l did not put λ where the source view was').toEqual(source)
    expect(live()).toBe('view moved right — source')
    caretKept('move')
    await prefix()
    await userEvent.keyboard('{ArrowLeft}')
    expect(place('source'), 'the left arrow did not put the source view back').toEqual(source)
    expect(live()).toBe('view moved left — source')
    expect(view.state.doc.toString(), 'a move key was typed').toBe(SOURCE)
    caretKept('move')
  })

  /**
   * **A MOVE STRAIGHT BACK PUTS EVERY VIEW WHERE IT WAS, AT ITS SIZE** (spec §9.6). In all four, the source view moved
   * down leaves its row for the column, a strip under λ, and moved up as §9.2 makes it would then trade places with λ,
   * leaving λ a strip across the top. `k` straight after `j` puts back the row of two instead.
   */
  it('moves the focused view straight back on k after j, every view where it was, where up would trade it', async () => {
    await start()
    const tree = storedTree()
    const down = moveLeaf(tree, 'source', 'down')
    expect(down, 'precondition: the source view moves down').not.toBeNull()
    expect(
      moveLeaf(down as LayoutNode, 'source', 'up'),
      'precondition: up as §9.2 makes it is another tree',
    ).not.toEqual(tree)
    const was = everyPlace()
    await prefix()
    await userEvent.keyboard('j')
    expect(storedTree(), 'j did not move the source view down').toEqual(down)
    caretKept('move')
    await prefix()
    await userEvent.keyboard('k')
    expect(storedTree(), 'k did not put back the tree j was pressed on').toEqual(tree)
    placedAs(was, 'k')
    expect(live()).toBe('view moved up — source')
    expect(view.state.doc.toString(), 'a move key was typed').toBe(SOURCE)
    caretKept('move')
  })

  it('walks two moves straight back, newest first, on j j k k', async () => {
    await start()
    const tree = storedTree()
    const once = moveLeaf(tree, 'source', 'down') as LayoutNode
    const was = everyPlace()
    for (const key of ['j', 'j']) {
      await prefix()
      await userEvent.keyboard(key)
    }
    expect(storedTree(), 'precondition: j twice moved the source view down twice').toEqual(
      moveLeaf(once, 'source', 'down'),
    )
    await prefix()
    await userEvent.keyboard('k')
    expect(storedTree(), 'the first k did not put back the tree of the first j').toEqual(once)
    await prefix()
    await userEvent.keyboard('k')
    expect(storedTree(), 'the second k did not put back the tree before').toEqual(tree)
    placedAs(was, 'k k')
    caretKept('move')
  })

  /**
   * **A MOVE IN A LAYOUT CHANGED OTHERWISE FORGETS EVERY MOVE BEFORE IT** (spec §9.6). With λ toggled off after `j`,
   * `k` is the move §9.2 makes in the three views, and `j` takes that back. λ toggled on again brings all four back
   * as `j` left them (§4.5), and `k` there is now §9.2's trade with λ: the move in three forgot `j`, which the
   * toggle off and on alone would have kept.
   */
  it('makes k the move §9.2 makes in the layout a toggle left, and forgets j once a move is made there', async () => {
    await start()
    const tree = storedTree()
    await prefix()
    await userEvent.keyboard('j')
    const down = storedTree()
    await prefix()
    await userEvent.keyboard('2')
    try {
      const three = storedTree()
      expect(mounted(), 'precondition: λ toggled off').toEqual(['source', 'rxm-0', 'tm-0'])
      const up = moveLeaf(three, 'source', 'up')
      expect(up, 'precondition: the source view moves up in the three').not.toBeNull()
      await prefix()
      await userEvent.keyboard('k')
      expect(storedTree(), 'k after a toggle is not the move §9.2 makes').toEqual(up)
      await prefix()
      await userEvent.keyboard('j')
      expect(storedTree(), 'j did not take back the move in the three').toEqual(three)
    } finally {
      await prefix()
      await userEvent.keyboard('2')
    }
    expect(storedTree(), 'precondition: all four as j left them').toEqual(down)
    const was = everyPlace()
    await prefix()
    await userEvent.keyboard('k')
    expect(storedTree(), 'k put back the tree before j, which a move since had forgotten').toEqual(
      moveLeaf(down, 'source', 'up'),
    )
    expect(storedTree()).not.toEqual(tree)
    expect(place('source'), 'precondition: the trade moved the source view').not.toEqual(was.source)
    caretKept('move')
  })

  /**
   * **CAPS LOCK TYPES A MOVE KEY AS ITS CAPITAL, AND IT STILL MOVES** (spec §7.3). `userEvent`'s `CapsLock` changes no
   * key sent after it, so the capital is sent as a browser with Caps Lock on reports it: `L`, with `Shift` up.
   */
  it('moves the focused view on a capital with Shift up, as Caps Lock types it, and types nothing', async () => {
    await start()
    const [source, lambda] = [place('source'), place('lambda-0')]
    expect(source.left, 'precondition: λ is to the right of the source view').toBeLessThan(lambda.left)
    await prefix()
    await userEvent.keyboard('L')
    expect(armed()).toBe(false)
    expect(place('source'), 'L did not put the source view where λ was').toEqual(lambda)
    expect(view.state.doc.toString(), 'the L was typed').toBe(SOURCE)
    caretKept('move')
    await prefix()
    await userEvent.keyboard('H')
    expect(place('source'), 'H did not put the source view back').toEqual(source)
    expect(view.state.doc.toString(), 'the H was typed').toBe(SOURCE)
    caretKept('move')
  })

  it('ends on a move key with Shift down, which types its capital, and moves nothing', async () => {
    await start()
    const before = place('source')
    await prefix()
    await userEvent.keyboard('{Shift>}L{/Shift}')
    expect(armed()).toBe(false)
    expect(view.state.doc.toString(), 'Shift+L did not reach the editor').toBe(typed('L'))
    expect(place('source'), 'Shift+L moved the view').toEqual(before)
  })

  it('says why on the notice line when a move key is refused, and moves nothing', async () => {
    await start()
    for (const key of ['2', '3', '4']) {
      await prefix()
      await userEvent.keyboard(key)
    }
    expect(mounted(), 'precondition: the source view alone').toEqual(['source'])
    const before = place('source')
    await prefix()
    await userEvent.keyboard('h')
    expect(armed()).toBe(false)
    expect(place('source'), 'a refused move moved the view').toEqual(before)
    expect(notice()).toBe('this view is the only one, so it has nowhere to go')
    expect(view.state.doc.toString(), 'the h was typed').toBe(SOURCE)
    caretKept('refused move')
  })

  /**
   * **AT THE EDGE A MOVE KEY IS REFUSED IN EACH DIRECTION'S OWN WORDS**, the words its greyed menu item has (spec §9.3).
   * The source view beside the TM view is at the left edge; `j`, `l` and `k` take it to the bottom, the right and the
   * top, and at each edge the key toward it moves nothing. **NO KEY IS THE ONE BEFORE IT STRAIGHT BACK** (§9.6), which
   * would put back the tree before rather than reach the next edge.
   */
  it('says how far the view has gone on the notice line when a move key is at the edge, and moves nothing', async () => {
    await start()
    for (const key of ['2', '4']) {
      await prefix()
      await userEvent.keyboard(key)
    }
    expect(mounted(), 'precondition: the source view and the TM view').toEqual(['source', 'tm-0'])
    const moved = async (key: string, d: MoveDirection): Promise<void> => {
      const want = moveLeaf(storedTree(), 'source', d)
      expect(want, `precondition: the source view moves ${d}`).not.toBeNull()
      await prefix()
      await userEvent.keyboard(key)
      expect(storedTree(), `${key} did not move the source view ${d}`).toEqual(want)
    }
    const refused = async (key: string, d: MoveDirection, words: string): Promise<void> => {
      const tree = storedTree()
      expect(moveLeaf(tree, 'source', d), `precondition: the source view is at the ${d} edge`).toBeNull()
      expect(notice(), 'precondition: the notice line does not say it already').not.toBe(words)
      const before = place('source')
      await prefix()
      await userEvent.keyboard(key)
      expect(armed()).toBe(false)
      expect(place('source'), `${key} at the edge moved the view`).toEqual(before)
      expect(storedTree(), `${key} at the edge changed the tree`).toEqual(tree)
      expect(notice()).toBe(words)
      expect(view.state.doc.toString(), `the ${key} was typed`).toBe(SOURCE)
      caretKept('refused move')
    }
    await refused('h', 'left', 'this view is as far left as it can go')
    await moved('j', 'down')
    await refused('j', 'down', 'this view is as far down as it can go')
    await moved('l', 'right')
    await refused('l', 'right', 'this view is as far right as it can go')
    await moved('k', 'up')
    await refused('k', 'up', 'this view is as far up as it can go')
  })

  /**
   * **ON THE STAGE A MOVE KEY IS REFUSED IN ITS OWN WORDS** (spec §9.4: tabs have no arrangement to move in), since the
   * menu there has no move item to take words from, and the tree under the tabs is left as it was.
   */
  it('refuses a move key on the Stage, saying so, and moves nothing', async () => {
    await start()
    const tree = storedTree()
    clickWorkspaceItem('[data-switch="views"][data-value="stage"]')
    try {
      expect(mounted(), 'precondition: the source view alone on the Stage').toEqual(['source'])
      await prefix()
      await userEvent.keyboard('l')
      expect(notice()).toBe('the stage has no arrangement to move this view in — choose tiles to move it')
      expect(storedTree(), 'a move key moved a view on the Stage').toEqual(tree)
    } finally {
      clickWorkspaceItem('[data-switch="views"][data-value="tiles"]')
    }
  })

  it('ends on a pointer press', async () => {
    await start()
    await prefix()
    await userEvent.click(document.querySelector('.wordmark') as HTMLElement)
    expect(armed(), 'a pointer press left the mode armed').toBe(false)
  })

  /**
   * **THE PRESS THAT ENDS THE MODE IS STILL A PRESS, AND THE FOCUS IS WHERE IT PUT IT** (spec §14 item 19): in the
   * editor it lands in, or on the control it presses, which acts as it would with the mode idle.
   *
   * **THE WORDMARK ABOVE IS NOT HELD TO IT.** It takes no focus, and a press on it leaves the focus on `<body>` with
   * the mode armed and with it idle alike: the browser's own answer to a press on something that cannot be focused,
   * which the mode has no part in.
   */
  it('ends on a pointer press in the source editor, which keeps the focus', async () => {
    await start()
    await prefix()
    await userEvent.click(document.querySelector('#views [data-leaf="source"] .cm-content') as HTMLElement)
    expect(armed(), 'a pointer press left the mode armed').toBe(false)
    await focusInPage('a pointer press in the source editor, which ends the mode')
    expect(view.hasFocus, 'the press took the focus out of the editor it landed in').toBe(true)
    expect(mounted(), 'the press acted as a view key').toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0'])
  })

  it('ends on a pointer press on a toggle, which acts and has the focus', async () => {
    await start()
    await prefix()
    const toggle = document.querySelector('#views-shown button[data-shows="tm"]') as HTMLElement
    await userEvent.click(toggle)
    expect(armed(), 'a pointer press left the mode armed').toBe(false)
    await focusInPage('a pointer press on the TM toggle, which ends the mode')
    expect(document.activeElement, 'the focus is not on the toggle that was pressed').toBe(toggle)
    expect(mounted(), 'the press that ended the mode did not reach the toggle').toEqual(['source', 'lambda-0', 'rxm-0'])
  })

  /**
   * **THE HINT TAKES NO POINTER** (spec §7.3): it floats over the foot of the page, and a press where it is drawn is
   * for what is under it. With `pointer-events: none` taken off it in `style.css`, the press would land on the hint and
   * the control under it would get nothing.
   */
  it('lets a pointer press at the hint through to what is under it', async () => {
    await start()
    await prefix()
    const box = hint().getBoundingClientRect()
    expect(box.width * box.height, 'precondition: the hint is drawn').toBeGreaterThan(0)
    const [x, y] = [box.left + box.width / 2, box.top + box.height / 2]
    const under = document.elementFromPoint(x, y) as HTMLElement
    expect(hint().contains(under), 'a press at the hint’s middle lands on the hint').toBe(false)
    let pressed: EventTarget | null = null
    const seen = (e: Event): void => {
      pressed = e.target
    }
    window.addEventListener('pointerdown', seen, { capture: true, once: true })
    const at = under.getBoundingClientRect()
    await userEvent.click(under, { position: { x: x - at.left, y: y - at.top } })
    window.removeEventListener('pointerdown', seen, { capture: true })
    expect(pressed, 'the press at the hint’s middle went to something else than what is under it').toBe(under)
    expect(armed(), 'the press left the mode armed').toBe(false)
  })

  /**
   * THE TESTS' PAGE IS A FRAME IN THE RUNNER'S PAGE, so giving the runner's window the focus is this window losing
   * it, and the browser sends this window its `blur`.
   */
  it('ends when the window loses the focus', async () => {
    await start()
    await prefix()
    try {
      window.parent.focus()
      await until(() => !document.hasFocus(), 'the window to lose the focus')
      expect(armed(), 'the mode stayed armed in a window without the focus').toBe(false)
    } finally {
      window.focus()
      await until(() => document.hasFocus(), 'the window to have the focus again')
    }
  })

  /**
   * **A KEY THE MODE CONSUMES IS SEEN BY NOTHING UNDER THE WINDOW** (spec §7.3: the editor under the focus does not see
   * it), and one it does not consume is seen as a key is while the mode is idle. A listener on the document stands for
   * whatever is under the window. CodeMirror runs no handler, vim's among them, for a `keydown` whose default was
   * prevented, and the app's own `keydown` listeners answer the arrows, Home, End, the page keys, Enter and Space.
   * **THE ARROWS ARE VIEW KEYS**, so an arrow after the prefix is held here with the table's other keys: the source
   * view moved right and back left, as the move case above moves it.
   */
  it('keeps a key it consumes from every listener under the window, and no other', async () => {
    await start()
    const seen: string[] = []
    const listener = (e: KeyboardEvent): void => {
      seen.push(e.key)
    }
    document.addEventListener('keydown', listener, { capture: true })
    try {
      await prefix()
      await userEvent.keyboard('{ArrowRight}')
      await prefix()
      await userEvent.keyboard('{ArrowLeft}')
      // `Control` IS A MODIFIER PRESSED ALONE, WHICH THE MODE LEAVES ALONE.
      expect(seen.splice(0), 'a prefix or an arrow was seen under the window').toEqual(['Control', 'Control'])
      expect(mounted(), 'the arrows did not move the source view back').toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0'])
      await prefix()
      await userEvent.keyboard('2')
      expect(seen.splice(0), 'the prefix or the table key was seen under the window').toEqual(['Control'])
      await prefix()
      await userEvent.keyboard('{Escape}')
      expect(seen.splice(0), 'the prefix or Escape was seen under the window').toEqual(['Control'])
      await prefix()
      await userEvent.keyboard('x')
      expect(seen.splice(0), 'a key the mode does not know was kept from the page').toEqual(['Control', 'x'])
    } finally {
      document.removeEventListener('keydown', listener, { capture: true })
    }
  })

  /**
   * A composition is begun through the browser's own input method interface, which no key of `userEvent`'s can do,
   * and the prefix pressed during it is `userEvent`'s: the browser marks its `keydown` as part of the composition.
   */
  it('is not armed by a prefix pressed during a composition', async (ctx) => {
    chromiumOnly(ctx, 'a composition is CDP’s Input.imeSetComposition, which only Chromium has')
    await start()
    await cdp().send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 })
    try {
      expect(view.composing, 'precondition: the editor is composing').toBe(true)
      await userEvent.keyboard(PREFIX)
      expect(armed(), 'the prefix armed the mode during a composition').toBe(false)
    } finally {
      await cdp().send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
      await until(() => !view.composing, 'the composition to end')
    }
  })

  it('is not armed while a modal dialog is open', async () => {
    await start()
    await userEvent.click(document.querySelector('#settings') as HTMLElement)
    await userEvent.click(document.querySelector('#import-base16') as HTMLElement)
    await until(() => document.querySelector('dialog:modal') !== null, 'the import dialog')
    await userEvent.keyboard(PREFIX)
    expect(armed(), 'the prefix armed the mode under a modal dialog').toBe(false)
    await userEvent.keyboard('{Escape}')
    await until(() => document.querySelector('dialog:modal') === null, 'the dialog to close')
  })

  /**
   * **NO PRESS OF A USER'S OPENS THE DIALOG WHILE THE MODE IS ARMED**: the page has one, behind `import base16…`,
   * and a pointer press on that button ends the mode, as `Enter` or `Space` on it does, being keys the mode does not
   * know. So the button is clicked from here, with no press, which is what a dialog opened by a reply or a timer
   * would be. The key after it is the dialog's: the page behind a modal dialog takes no input.
   */
  it('is left by the next key when a modal dialog has opened over it, and the key is the dialog’s', async () => {
    await start()
    await prefix()
    ;(document.querySelector('#import-base16') as HTMLElement).click()
    await until(() => document.querySelector('dialog:modal') !== null, 'the import dialog')
    expect(armed(), 'precondition: the mode is still armed under the dialog').toBe(true)
    const field = document.querySelector('dialog:modal textarea') as HTMLTextAreaElement
    expect(document.activeElement, 'precondition: the dialog’s field has the focus').toBe(field)
    await userEvent.keyboard('2')
    expect(mounted(), 'a view key acted behind a modal dialog').toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0'])
    expect(armed(), 'the mode stayed armed under the dialog').toBe(false)
    expect(field.value, 'the key was kept from the dialog').toBe('2')
    await userEvent.keyboard('{Escape}')
    await until(() => document.querySelector('dialog:modal') === null, 'the dialog to close')
  })

  /**
   * **`blocked` IS ASKED ONLY WHERE ITS ANSWER MATTERS**, and a key typed while the mode is idle is not such a press.
   * The page's `blocked` looks for `dialog:modal`, so the document's `querySelector` is counted for that selector
   * across three keys typed into the editor, and across a prefix, which does ask.
   */
  it('does not look for a modal dialog at a key typed while the mode is idle', async () => {
    await start()
    const find = document.querySelector
    let asked = 0
    document.querySelector = function (this: Document, selector: string): Element | null {
      if (selector === 'dialog:modal') asked += 1
      return find.call(this, selector)
    } as typeof document.querySelector
    try {
      await userEvent.keyboard('abc')
      expect(view.state.doc.toString(), 'precondition: the three keys were typed').toBe(typed('abc'))
      expect(asked, 'a key typed while the mode is idle asked whether a dialog is open').toBe(0)
      await prefix()
      expect(asked, 'precondition: the prefix asks, so the count reads what blocked does').toBeGreaterThan(0)
    } finally {
      // THE DOCUMENT'S OWN PROPERTY IS TAKEN AWAY AGAIN, and the method is its prototype's as it was.
      Reflect.deleteProperty(document, 'querySelector')
    }
    expect(document.querySelector, 'the count was left on the document').toBe(find)
  })

  /**
   * THE VIM EXTENSION'S `keydown` HANDLER RUNS AHEAD OF EVERY KEYMAP (`editor-keymap.ts`), and in normal mode a digit
   * is a count for the command after it: `2x` deletes two characters. So `2` after the prefix, then `x`, deleting ONE
   * character says the mode took the `2` and vim never saw it, and that `x`, which the mode does not know when it
   * follows a prefix, still reached vim. Each `x` deletes the character under the caret, at `CARET`.
   */
  it('runs ahead of vim: 2 after the prefix is the mode’s and no count of vim’s, and x after a prefix is vim’s', async () => {
    await start()
    chooseOption('#keymap', 'vim')
    try {
      await until(() => view.scrollDOM.classList.contains('cm-vimMode'), 'vim’s normal mode')
      view.focus()
      await until(() => view.hasFocus, 'the source editor to take the focus')
      await prefix()
      await userEvent.keyboard('2')
      expect(mounted(), '2 did not hide the λ view').toEqual(['source', 'rxm-0', 'tm-0'])
      caretKept()
      await userEvent.keyboard('x')
      expect(view.state.doc.toString(), 'vim took the 2 as a count, or did not get the x').toBe(cut(1))
      await prefix()
      await userEvent.keyboard('x')
      expect(view.state.doc.toString(), 'x after the prefix did not reach vim').toBe(cut(2))
    } finally {
      chooseOption('#keymap', 'default')
    }
  })
})
