import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { PROGRAM_STORAGE_KEY } from '../../src/program-store'
import { SHELL, until } from './harness'

/**
 * **BLOCKED STORAGE IS NOT FULL STORAGE** — Plan 7 part 6a spec §4.3 and §7. Where this browser blocks site data,
 * `localStorage` throws a `SecurityError` rather than a quota error, and the resting line says the storage is blocked:
 * telling that visitor it is full would send them to clear space that is not the problem. A quota refusal keeps the
 * sentence `program-quota.test.ts` and `buffers-quota.test.ts` pin.
 *
 * **EVERY READ AND EVERY WRITE THROWS, FROM MODULE SCOPE, BEFORE `main()` RUNS**, as `buffers-quota-empty.test.ts`
 * arms its own refusal: blocked storage refuses every key, not one. The program `setup.ts` stores is removed first,
 * since blocked storage holds nothing, so the page opens on the first-load example as a first visit does. The throw is
 * the storage shim's methods', not `localStorage`'s getter's, which is the other place a browser throws it:
 * `storage-blocked.test.ts` throws from the getter, and holds the same "blocked" sentence there. ONE MOUNT FOR THE
 * FILE, for the reason every sibling gives.
 */

localStorage.removeItem(PROGRAM_STORAGE_KEY)
const blocked = (): never => {
  throw new DOMException('The operation is insecure.', 'SecurityError')
}
localStorage.getItem = blocked
localStorage.setItem = blocked

const LINE = 'not being saved — this browser’s storage for this site is blocked'
const notice = () => document.querySelector<HTMLElement>('#notice') as HTMLElement
const noticeText = () => notice().querySelector('.notice-text')?.textContent ?? ''
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

/** Every sentence the live region carries, in order: one read of `#live` holds only the latest. */
const said: string[] = []

let view: EditorView

describe('a program write refused because storage is blocked', () => {
  it('says nothing while the page shows the program it opened on', async () => {
    document.body.innerHTML = SHELL
    const live = document.querySelector('#live') as HTMLElement
    new MutationObserver(() => said.push(live.textContent?.trim() ?? '')).observe(live, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    view = await (await import('../../src/main')).ready
    await until(() => idle() && view.state.doc.length > 0, 'the first compile')
    expect(notice().hidden).toBe(true)
    expect(said.filter((t) => t.includes('not being saved'))).toEqual([])
  })

  it('says the program is not being saved because storage is blocked, once an edit is refused', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 1;\nx + 1\n' } })
    await until(() => noticeText() === `the program is ${LINE}`, 'the resting line')
    expect(notice().hidden).toBe(false)
    expect(said.filter((t) => t.includes('not being saved'))).toEqual([`the program is ${LINE}`])
  })

  it('says the copies are not being saved for the same reason, once there is a copy to lose', async () => {
    // THE EDIT ABOVE IS REFUSED WHEN ITS COMPILE IS POSTED, SO THAT COMPILE IS STILL RUNNING HERE, and a λ view
    // offers no copy between a compile's reply and its first frame. Its result is waited for by its value.
    await until(
      () => idle() && (document.querySelector('#results')?.textContent ?? '').includes('λ 2 · '),
      'the edited program to compile',
    )
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    await until(() => document.querySelector('[data-leaf="lambda-0"] .term-editor') !== null, 'the copy')
    // SAID AT ONCE, UNDER THE COPY'S OWN NOTICE: the live region is where the new sentence is heard.
    await until(() => said.includes(`the program and copies are ${LINE}`), 'the line naming both')
    expect(said.filter((t) => t.includes('not being saved'))).toEqual([
      `the program is ${LINE}`,
      `the program and copies are ${LINE}`,
    ])
  })
})
