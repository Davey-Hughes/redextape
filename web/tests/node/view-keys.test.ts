import { describe, expect, it } from 'vitest'
import { HEADER_ORDER } from '../../src/layout'
import { HINT_ROWS, HINT_SENTENCE, type KeyPress, PREFIX, PREFIX_LABEL, step, VIEW_KEYS } from '../../src/view-keys'

/**
 * THE VIEW KEYS' MACHINE, AS A VALUE — the view layouts spec §7.3: every row of `step`'s table. The listener that
 * feeds it is `tests/browser/view-keys.test.ts`'s.
 */

const key = (k: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  key: k,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  ...mods,
})

describe('idle', () => {
  it('is armed by the prefix, which it consumes', () => {
    expect(step(false, PREFIX)).toEqual({ armed: true, consume: true, action: null })
  })

  it.each([
    ['the prefix’s key with no modifier', key('.')],
    ['the prefix with Shift too', key('.', { ctrl: true, shift: true })],
    ['the prefix with Alt too', key('.', { ctrl: true, alt: true })],
    ['the prefix with Meta too', key('.', { ctrl: true, meta: true })],
    ['a key the armed table names', key(']')],
    ['Escape', key('Escape')],
    ['Control alone', key('Control', { ctrl: true })],
  ])('leaves %s alone', (_what, press) => {
    expect(step(false, press)).toEqual({ armed: false, consume: false, action: null })
  })
})

describe('armed', () => {
  it('answers every key of its table with that key’s action, consumed, and is idle after', () => {
    for (const row of VIEW_KEYS)
      expect(step(true, key(row.key)), row.key).toEqual({ armed: false, consume: true, action: row.action })
  })

  it('cycles on ] and [, and toggles each kind on its place in the header order', () => {
    expect(step(true, key(']')).action).toEqual({ kind: 'cycle', step: 1 })
    expect(step(true, key('[')).action).toEqual({ kind: 'cycle', step: -1 })
    expect(HEADER_ORDER.map((_, i) => step(true, key(String(i + 1))).action)).toEqual(
      HEADER_ORDER.map((pane) => ({ kind: 'toggle', pane })),
    )
    // SPELLED OUT AS WELL: the line above follows `HEADER_ORDER` wherever it goes, right or wrong.
    expect(step(true, key('2')).action).toEqual({ kind: 'toggle', pane: 'lambda' })
    expect(step(true, key('3')).action).toEqual({ kind: 'toggle', pane: 'tm' })
    expect(step(true, key('4')).action).toEqual({ kind: 'toggle', pane: 'rxm' })
    expect(step(true, key('5')).action).toEqual({ kind: 'toggle', pane: 'clif' })
  })

  it('moves the focused view on h j k l and on the arrows: left, down, up, right', () => {
    const moves = (keys: string[]) => keys.map((k) => step(true, key(k)))
    const to = (direction: string) => ({ armed: false, consume: true, action: { kind: 'move', direction } })
    const vim = [to('left'), to('down'), to('up'), to('right')]
    expect(moves(['h', 'j', 'k', 'l'])).toEqual(vim)
    expect(moves(['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'])).toEqual(vim)
  })

  /** A ROW'S SECOND KEY IS ANSWERED AS ITS FIRST IS: with `Ctrl` or `Shift` down as without. */
  it('answers the second key of a row as its first, with Ctrl or Shift down as without', () => {
    const seconds = VIEW_KEYS.filter((row) => row.also !== undefined)
    expect(seconds.length, 'precondition: rows with a second key').toBeGreaterThan(0)
    for (const row of seconds)
      for (const mods of [{}, { ctrl: true }, { shift: true }])
        expect(step(true, key(row.also?.key ?? '', mods)), row.also?.key).toEqual({
          armed: false,
          consume: true,
          action: row.action,
        })
  })

  /**
   * THE PREFIX'S OWN MODIFIER MAY STILL BE DOWN: holding `Ctrl` through the second key is the natural motion, so a
   * table key answers with it held as without.
   */
  it('answers every key of its table with Ctrl still held, as without', () => {
    for (const row of VIEW_KEYS)
      expect(step(true, key(row.key, { ctrl: true })), row.key).toEqual({
        armed: false,
        consume: true,
        action: row.action,
      })
  })

  /**
   * **CAPS LOCK TYPES A MOVE KEY AS ITS CAPITAL WITH `Shift` UP**, and that capital is the move key. With `Shift` down
   * the capital is no key of the table, and is left to be typed.
   */
  describe('a move key’s capital', () => {
    const moves = VIEW_KEYS.filter((row) => row.action.kind === 'move')
    const capitals = (mods: Partial<KeyPress>) =>
      moves.map((row) => ({ press: key(row.key.toUpperCase(), mods), action: row.action }))

    it('is the move key with Shift up, as Caps Lock types it', () => {
      expect(
        moves.map((row) => row.key),
        'precondition: the move keys',
      ).toEqual(['h', 'j', 'k', 'l'])
      for (const { press, action } of capitals({}))
        expect(step(true, press), press.key).toEqual({ armed: false, consume: true, action })
    })

    it('is the move key with Ctrl still held and Shift up', () => {
      for (const { press, action } of capitals({ ctrl: true }))
        expect(step(true, press), press.key).toEqual({ armed: false, consume: true, action })
    })

    it('ends the mode with Shift down, Ctrl held or not, and is left for whatever is under the focus', () => {
      for (const mods of [{ shift: true }, { shift: true, ctrl: true }])
        for (const { press } of capitals(mods))
          expect(step(true, press), `${press.key} ${JSON.stringify(mods)}`).toEqual({
            armed: false,
            consume: false,
            action: null,
          })
    })
  })

  it('leaves on Escape and on the prefix again, consuming both and doing nothing', () => {
    expect(step(true, key('Escape'))).toEqual({ armed: false, consume: true, action: null })
    expect(step(true, PREFIX)).toEqual({ armed: false, consume: true, action: null })
  })

  it('leaves on Escape with Ctrl still held, as a table key answers with it held', () => {
    expect(step(true, key('Escape', { ctrl: true }))).toEqual({ armed: false, consume: true, action: null })
  })

  /**
   * **`Shift` DOWN DOES NOT STOP A TABLE KEY OR `Escape`**: `bare` reads `Alt` and `Meta` and no other modifier. This
   * holds what it answers. Whether a layout that types these keys with another modifier should be answered is not
   * settled here.
   */
  it('answers every key of its table, and Escape, with Shift down', () => {
    for (const row of VIEW_KEYS)
      expect(step(true, key(row.key, { shift: true })), row.key).toEqual({
        armed: false,
        consume: true,
        action: row.action,
      })
    expect(step(true, key('Escape', { shift: true }))).toEqual({ armed: false, consume: true, action: null })
  })

  it.each([
    ['a key the table does not name', key('x')],
    ['H, a move key with Shift, which types a capital', key('H', { shift: true })],
    ['an arrow with Alt down', key('ArrowLeft', { alt: true })],
    ['a table key with Alt down', key('1', { alt: true })],
    ['a table key with Meta down', key(']', { meta: true })],
    ['Escape with Alt down', key('Escape', { alt: true })],
    ['Escape with Meta down', key('Escape', { meta: true })],
    ['the prefix with Meta too', key('.', { ctrl: true, meta: true })],
    ['n, no cycle key, since Ctrl+N opens a window', key('n')],
    ['Ctrl+N itself, which the browser keeps', key('n', { ctrl: true })],
    ['Enter', key('Enter')],
  ])('ends on %s and leaves the press for whatever is under the focus', (_what, press) => {
    expect(step(true, press)).toEqual({ armed: false, consume: false, action: null })
  })

  /**
   * THE UI EVENTS KEY VALUES' MODIFIER KEYS, WRITTEN OUT HERE AND NOT READ FROM `view-keys.ts`, so a key dropped from
   * its set fails a row: the twelve of that specification's table, and its two legacy ones, `Hyper` and `Super`.
   */
  it.each([
    'Alt',
    'AltGraph',
    'CapsLock',
    'Control',
    'Fn',
    'FnLock',
    'Hyper',
    'Meta',
    'NumLock',
    'ScrollLock',
    'Shift',
    'Super',
    'Symbol',
    'SymbolLock',
  ])('stays armed through %s pressed alone', (modifier) => {
    expect(step(true, key(modifier))).toEqual({ armed: true, consume: false, action: null })
  })

  /**
   * **A MODIFIER'S OWN `keydown` SAYS THAT MODIFIER IS DOWN**: `Alt` pressed alone arrives with `alt` set, as the
   * browser sends it (`tests/browser/view-keys.test.ts` presses each). The rows above have every flag clear, which no
   * press of these four has, and a machine that let a modifier through only with `Alt` and `Meta` up would pass them.
   */
  it.each([
    ['Control', key('Control', { ctrl: true })],
    ['Shift', key('Shift', { shift: true })],
    ['Alt', key('Alt', { alt: true })],
    ['Meta', key('Meta', { meta: true })],
  ])('stays armed through %s pressed alone, as its own keydown reports it', (_modifier, press) => {
    expect(step(true, press)).toEqual({ armed: true, consume: false, action: null })
  })
})

describe('the table', () => {
  it('names each key once', () => {
    const every = VIEW_KEYS.flatMap((r) => (r.also === undefined ? [r.key] : [r.key, r.also.key]))
    expect(new Set(every).size).toBe(every.length)
    expect(VIEW_KEYS.map((r) => r.key)).toEqual([
      ']',
      '[',
      ...HEADER_ORDER.map((_, i) => String(i + 1)),
      'h',
      'j',
      'k',
      'l',
    ])
  })
})

describe('the toggle keys', () => {
  const toggleRows = VIEW_KEYS.filter((row) => row.action.kind === 'toggle')

  it('are single digits, so a tenth kind is a decision', () => {
    for (const row of toggleRows) expect(row.key).toMatch(/^[1-9]$/)
  })

  it('are 1 to N in the header’s order', () => {
    expect(toggleRows.map((row) => row.key)).toEqual(HEADER_ORDER.map((_, i) => String(i + 1)))
  })
})

/**
 * WHAT A READER IS TOLD WHEN THE MODE IS ARMED: the hint's rows on the page, and the same rows as one sentence in the
 * live region. `tests/browser/view-keys.test.ts` holds that the page shows the rows and says the sentence.
 */
describe('the hint', () => {
  it('lists every row of the table in the table’s order, and then the way out', () => {
    expect(HINT_ROWS.slice(0, -1)).toEqual(
      VIEW_KEYS.map((r) => ({ key: r.key, does: r.also === undefined ? r.does : `or ${r.also.shown} ${r.does}` })),
    )
    expect(HINT_ROWS.at(-1)).toEqual({ key: 'Esc', does: `or ${PREFIX_LABEL} leave` })
  })

  it('is said as one sentence that names each key with what it does', () => {
    expect(HINT_SENTENCE).toBe(
      'view keys: ] the next layout, [ the previous layout, 1 show or hide source, 2 show or hide λ, ' +
        '3 show or hide TM, 4 show or hide rxm, 5 show or hide clif, h or ← move view left, j or ↓ move view down, ' +
        'k or ↑ move view up, l or → move view right, Esc or Ctrl+. leave',
    )
    // AND THOSE WORDS ARE THE TABLE'S, NOT A SECOND COPY OF THEM: each row's key and what it does, in its order.
    const said = HINT_SENTENCE.replace(/^view keys: /, '').split(', ')
    expect(said).toEqual(HINT_ROWS.map((row) => `${row.key} ${row.does}`))
    expect(said.slice(0, VIEW_KEYS.length)).toEqual(
      VIEW_KEYS.map((r) => (r.also === undefined ? `${r.key} ${r.does}` : `${r.key} or ${r.also.shown} ${r.does}`)),
    )
  })
})
