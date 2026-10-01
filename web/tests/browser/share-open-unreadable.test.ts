import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

/**
 * **A LINK AT START-UP THAT CANNOT BE READ** — Plan 7 part 6a spec §5.3 and §7: `#s=` and characters base64url does not
 * have. Nothing changes, the notice says so and offers nothing, and the fragment is cleared anyway, so a reload does not
 * say it again. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')

let view: EditorView

beforeAll(async () => {
  history.replaceState(null, '', `${location.pathname}${location.search}#s=not*a*link`)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && segments().length === 3, 'the first compile')
})

describe('a link at start-up that cannot be read', () => {
  it('changes nothing: the stored program, under its encoding, in the stored workspace', () => {
    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
    expect(document.querySelector<HTMLSelectElement>('#encoding')?.value).toBe('unary')
    expect(document.querySelector('#workspace')?.textContent).toBe('Explorer ▾')
    expect(segments()[0]).toMatch(/^λ 42/)
  })

  it('says so, offering nothing, and clears the fragment', () => {
    expect(document.querySelector('#notice .notice-text')?.textContent).toBe(
      'this link could not be read — nothing was changed',
    )
    expect(document.querySelector('#notice button.notice-action')).toBeNull()
    expect(location.hash).toBe('')
  })
})
