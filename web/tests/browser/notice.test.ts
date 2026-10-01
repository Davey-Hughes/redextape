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

    // A PALETTE REMOVAL'S UNDO BELONGS TO THE SETTINGS, NOT THE COPIES: its action names where the focus goes instead.
    it('goes to the action’s own fallback when it names one, whether the notice expires or its action runs', () => {
      const own = document.createElement('button')
      document.body.append(own)
      const n = createNotices(line, live, fallbackEl)
      const action = { label: 'undo', run: () => undefined, fallback: () => own }
      n.notify('dark palette Night removed', { action })
      line.querySelector<HTMLButtonElement>('button.notice-action')?.focus()
      vi.advanceTimersByTime(NOTICE_MS)
      expect(document.activeElement).toBe(own)
      n.notify('dark palette Night removed', { action })
      line.querySelector<HTMLButtonElement>('button.notice-action')?.focus()
      line.querySelector<HTMLButtonElement>('button.notice-action')?.click()
      expect(document.activeElement).toBe(own)
    })

    // THE OTHER TWO WAYS A NOTICE ENDS UNDER THE FOCUS: drawn over by a notice with no action of its own, and expired
    // onto a resting sentence, which has none either. Each hands the focus to the ending notice's own fallback.
    it('goes to the action’s own fallback when a notice with no action is drawn over it', () => {
      const own = document.createElement('button')
      document.body.append(own)
      const n = createNotices(line, live, fallbackEl)
      n.notify('dark palette Night removed', { action: { label: 'undo', run: () => undefined, fallback: () => own } })
      line.querySelector<HTMLButtonElement>('button.notice-action')?.focus()
      n.notify('Explorer reset — the default views are back')
      expect(line.querySelector('.notice-text')?.textContent).toBe('Explorer reset — the default views are back')
      expect(document.activeElement).toBe(own)
    })

    it('goes to the action’s own fallback when the notice expires onto a resting sentence', () => {
      const own = document.createElement('button')
      document.body.append(own)
      const n = createNotices(line, live, fallbackEl)
      n.rest('copies are not being saved')
      n.notify('dark palette Night removed', { action: { label: 'undo', run: () => undefined, fallback: () => own } })
      line.querySelector<HTMLButtonElement>('button.notice-action')?.focus()
      vi.advanceTimersByTime(NOTICE_MS)
      expect(line.querySelector('.notice-text')?.textContent).toBe('copies are not being saved')
      expect(document.activeElement).toBe(own)
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

  /**
   * **THE SAME ACTION OFFERED AGAIN KEEPS ITS BUTTON, WHERE IT WAS** — Plan 7 part 6a spec §5.5: a link's clamps
   * redraw the open's notice with the open's `undo`, hundreds of milliseconds after the open, while a user may be
   * pressing it. Chrome clicks nothing for a press whose button is replaced before the release, or moves from under
   * the pointer, so the button is the same element, in the same place, and only the words change.
   */
  describe('the same action offered again', () => {
    it('keeps its button and the focus on it, changes only the words, and runs the action once', () => {
      const n = createNotices(line, live)
      const run = vi.fn()
      const action = { label: 'undo', run }
      n.notify('opened a shared link', { action })
      const button = line.querySelector<HTMLButtonElement>('button.notice-action') as HTMLButtonElement
      button.focus()
      n.notify("the link's λ step 100 is past the end of this run — showing step 7", { action })
      expect(line.querySelector('button.notice-action')).toBe(button)
      expect(document.activeElement).toBe(button)
      expect(line.querySelector('.notice-text')?.textContent).toBe(
        "the link's λ step 100 is past the end of this run — showing step 7",
      )
      expect(live.textContent).toBe("the link's λ step 100 is past the end of this run — showing step 7")
      button.click()
      expect(run).toHaveBeenCalledTimes(1)
      expect(line.hidden).toBe(true)
    })

    it('replaces the button for another action under the same label', () => {
      const n = createNotices(line, live)
      n.notify('λ copy 1 deleted', { action: { label: 'undo', run: () => undefined } })
      const first = line.querySelector('button.notice-action')
      n.notify('TM copy 2 deleted', { action: { label: 'undo', run: () => undefined } })
      expect(first).not.toBeNull()
      expect(line.querySelector('button.notice-action')).not.toBe(first)
    })

    /**
     * **IN THE APP'S OWN STYLES, AT A PHONE'S WIDTH, WHERE THE LONGER WORDS WRAP.** The button sits at the line's end
     * and on its first line, so neither the words' length nor how many lines they take moves it.
     */
    it('stays where it was however long the words are, and however many lines they take', () => {
      line.className = 'notice'
      line.style.width = '390px'
      const n = createNotices(line, live)
      const action = { label: 'undo', run: () => undefined }
      n.notify('opened a shared link', { action })
      const text = () => line.querySelector('.notice-text') as HTMLElement
      const button = line.querySelector('button.notice-action') as HTMLElement
      const box = () => {
        const r = button.getBoundingClientRect()
        return [r.left, r.top, r.width, r.height]
      }
      const oneLine = text().getBoundingClientRect().height
      const before = box()
      n.notify(
        "the link's λ step 100 and asm step 100 are past the end of this run — showing λ step 7 and asm step 5",
        { action },
      )
      expect(text().getBoundingClientRect().height).toBeGreaterThan(oneLine)
      expect(box()).toEqual(before)
    })
  })

  /**
   * **A NOTICE ENDED EARLY BY ITS OWN HANDLE, AND ONLY WHILE IT IS STILL THE ONE ON THE LINE.** Once it has expired
   * or been drawn over, what the line says is another gesture's, and ending it would take that from under the user.
   */
  it('lets a caller end its own notice early, and only while that notice is still on the line', () => {
    const n = createNotices(line, live)
    const text = () => line.querySelector('.notice-text')?.textContent
    const expired = n.notify('dark palette Night removed', { action: { label: 'undo', run: () => undefined } })
    vi.advanceTimersByTime(NOTICE_MS)
    n.notify('λ copy 1 deleted', { action: { label: 'undo', run: () => undefined } })
    expired.dismiss()
    expect(text()).toBe('λ copy 1 deleted')
    const replaced = n.notify('dark palette Night removed', { action: { label: 'undo', run: () => undefined } })
    const showing = n.notify('TM copy 2 created')
    replaced.dismiss()
    expect(text()).toBe('TM copy 2 created')
    showing.dismiss()
    expect(line.hidden).toBe(true)
  })

  /**
   * **ENDED EARLY, IT LEAVES THE RESTING LINE UNDER IT, AS ITS OWN TIMER WOULD.** A pick's `undo` goes at the next edit
   * (`main.ts`'s `openExample`), since putting back the text the pick replaced would throw that edit away; the line
   * goes back to what it said before the pick.
   */
  it('ends its own notice early, action and all, and leaves the resting line under it', () => {
    const n = createNotices(line, live)
    n.rest('copies are not being saved')
    const pick = n.notify('opened the example fact(4)', { action: { label: 'undo', run: () => undefined } })
    pick.dismiss()
    expect(line.querySelector('button.notice-action')).toBeNull()
    expect(line.querySelector('.notice-text')?.textContent).toBe('copies are not being saved')
  })

  /**
   * **AND NOTHING ONCE IT HAS RUN OUT, NOT EVEN A REPAINT.** A pick's notice is ended at every edit after the pick,
   * which is every keystroke for as long as the page is open; each one redrawing the resting line under it would be
   * work for a line that is not changing.
   */
  it('ends nothing once it has run out, and leaves the line as it is', () => {
    const n = createNotices(line, live)
    n.rest('copies are not being saved')
    const expired = n.notify('opened the example fact(4)', { action: { label: 'undo', run: () => undefined } })
    vi.advanceTimersByTime(NOTICE_MS)
    const resting = line.querySelector('.notice-text')
    expect(resting?.textContent).toBe('copies are not being saved')
    expired.dismiss()
    expect(line.querySelector('.notice-text')).toBe(resting)
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
