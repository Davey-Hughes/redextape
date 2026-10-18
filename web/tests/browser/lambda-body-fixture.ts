import { vi } from 'vitest'
import { LambdaBody } from '../../src/lambda-body'

/**
 * A `LambdaBody` on the page without a pane, for the files that test the λ view's body on its own. It is kept out of
 * `harness.ts`, which every browser file loads, because it imports `LambdaBody` at run time.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names end in
 * `.test.ts`, and this one does not.
 */

/**
 * A `LambdaBody` with a spy for its `toggle` and its `link`, in a 640 px wide `section` of classes `pane` and
 * `fixture` at the end of `<body>`; each file names its own `fixture` class to find its rows by.
 */
export function mountLambdaBody(fixture: string) {
  const toggle = vi.fn()
  const link = vi.fn()
  const body = new LambdaBody({ toggle, link })
  const host = document.createElement('section')
  host.className = `pane ${fixture}`
  host.style.width = '640px'
  host.append(body.el)
  document.body.append(host)
  return { body, toggle, link }
}
