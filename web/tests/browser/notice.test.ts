import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNotices, NOTICE_MS } from '../../src/notice'

let line: HTMLElement
let live: HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  line = document.createElement('div')
  live = document.createElement('div')
  document.body.append(line, live)
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('notices', () => {
  it('shows one notice, says it in the live region, and clears it after NOTICE_MS', () => {
    const n = createNotices(line, live)
    n.notify('λ copy 1 paused · 1 view now shows the program')
    expect(line.hidden).toBe(false)
    expect(line.querySelector('.notice-text')?.textContent).toBe('λ copy 1 paused · 1 view now shows the program')
    expect(live.getAttribute('role')).toBe('status')
    expect(live.textContent).toContain('λ copy 1 paused')
    vi.advanceTimersByTime(NOTICE_MS)
    expect(line.hidden).toBe(true)
  })

  it('replaces the notice before it, action and all', () => {
    const n = createNotices(line, live)
    const run = vi.fn()
    n.notify('λ copy 1 deleted', { action: { label: 'undo', run } })
    n.notify('TM copy 2 created')
    expect(line.querySelector('.notice-text')?.textContent).toBe('TM copy 2 created')
    expect(line.querySelector('button.notice-action')).toBeNull()
    vi.advanceTimersByTime(NOTICE_MS - 1)
    expect(line.hidden).toBe(false)
  })

  /**
   * **THE LINE CAN BE HOLDING THE FOCUS WHEN IT IS REDRAWN** — spec §11, the accessibility list's item 1.
   * *undo* is offered for eight seconds; a user who tabs to it and waits, or who is still on it when any
   * other gesture makes a notice, loses the button to the next repaint. Both routes are here, plus the
   * case where the new notice has an action of its own to land on.
   */
  describe('the focus the line is holding', () => {
    const fallbackEl = () => document.querySelector<HTMLElement>('#fallback')

    beforeEach(() => {
      const b = document.createElement('button')
      b.id = 'fallback'
      document.body.append(b)
    })

    it('goes to the fallback when the notice holding it expires', () => {
      const n = createNotices(line, live, fallbackEl)
      n.notify('λ copy 1 deleted', { action: { label: 'undo', run: () => undefined } })
      line.querySelector<HTMLButtonElement>('button.notice-action')?.focus()
      vi.advanceTimersByTime(NOTICE_MS)
      expect(document.activeElement).not.toBe(document.body)
      expect(document.activeElement).toBe(fallbackEl())
    })

    it('goes to the next notice’s own action when there is one', () => {
      const n = createNotices(line, live, fallbackEl)
      n.notify('λ copy 1 deleted', { action: { label: 'undo', run: () => undefined } })
      line.querySelector<HTMLButtonElement>('button.notice-action')?.focus()
      n.notify('TM copy 2 deleted', { action: { label: 'undo', run: () => undefined } })
      expect(document.activeElement).toBe(line.querySelector('button.notice-action'))
    })

    it('leaves the focus alone when it is somewhere else entirely', () => {
      const n = createNotices(line, live, fallbackEl)
      n.notify('λ copy 1 deleted', { action: { label: 'undo', run: () => undefined } })
      fallbackEl()?.focus()
      const elsewhere = document.activeElement
      n.notify('TM copy 2 created')
      expect(document.activeElement).toBe(elsewhere)
    })
  })

  it('runs its action once and clears', () => {
    const n = createNotices(line, live)
    const run = vi.fn()
    n.notify('λ copy 1 deleted', { action: { label: 'undo', run } })
    const undo = line.querySelector<HTMLButtonElement>('button.notice-action')
    expect(undo?.textContent).toBe('undo')
    undo?.click()
    expect(run).toHaveBeenCalledTimes(1)
    expect(line.hidden).toBe(true)
  })

  describe('the resting state', () => {
    it('is what the line says when nothing else is being said', () => {
      const n = createNotices(line, live)
      n.rest('copies are not being saved')
      expect(line.hidden).toBe(false)
      expect(line.querySelector('.notice-text')?.textContent).toBe('copies are not being saved')
      expect(live.textContent).toContain('copies are not being saved')
    })

    it('is said at once and comes back when the notice over it ends', () => {
      const n = createNotices(line, live)
      n.notify('λ copy 1 created')
      n.rest('copies are not being saved')
      // SAID, THOUGH NOT SHOWN: the notice the user may be reading keeps the line.
      expect(live.textContent).toContain('copies are not being saved')
      expect(line.querySelector('.notice-text')?.textContent).toBe('λ copy 1 created')
      vi.advanceTimersByTime(NOTICE_MS)
      expect(line.querySelector('.notice-text')?.textContent).toBe('copies are not being saved')
      expect(line.hidden).toBe(false)
    })

    it('survives every notice after it, and goes when the condition does', () => {
      const n = createNotices(line, live)
      n.rest('copies are not being saved')
      for (const text of ['λ copy 1 created', 'view added — TM · program', 'λ copy 1 deleted']) {
        n.notify(text)
        expect(line.querySelector('.notice-text')?.textContent).toBe(text)
        vi.advanceTimersByTime(NOTICE_MS)
        expect(line.querySelector('.notice-text')?.textContent).toBe('copies are not being saved')
      }
      n.rest(null)
      expect(line.hidden).toBe(true)
    })

    it('says a condition once, however many times it is reported', () => {
      const n = createNotices(line, live)
      n.rest('copies are not being saved')
      const said = live.textContent
      n.rest('copies are not being saved')
      expect(live.textContent).toBe(said)
    })

    /**
     * **AND ONCE ACROSS A CYCLE, NOT ONCE PER RUN OF IT.** A write refused by SIZE succeeds and fails by
     * turns — a user typing into a copy near the quota gets one every 300 ms — so a condition cleared and
     * reported again is the ordinary case, not a corner. The line still tracks it; the announcement does
     * not repeat.
     */
    it('does not say it again when the condition comes back', () => {
      const n = createNotices(line, live)
      n.rest('copies are not being saved')
      const said = live.textContent
      n.rest(null)
      n.rest('copies are not being saved')
      expect(live.textContent).toBe(said)
      expect(line.querySelector('.notice-text')?.textContent).toBe('copies are not being saved')
    })
  })

  it('announces without showing, and re-announces a repeat', () => {
    const n = createNotices(line, live)
    n.announce('the machine is here right now')
    expect(line.hidden).toBe(true)
    const first = live.textContent
    n.announce('the machine is here right now')
    expect(live.textContent).not.toBe(first)
    expect(live.textContent?.trim()).toBe('the machine is here right now')
  })
})
