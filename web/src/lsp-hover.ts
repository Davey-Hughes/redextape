import { hoverTooltip, type Tooltip } from '@codemirror/view'
import type { LspClient } from './lsp-client'
import type { LspPosition } from './lsp-protocol'
import { rangeOf } from './lsp-text'

/**
 * What the tooltip needs to ask a question: which document, and of whom.
 *
 * **`Pick<LspClient, 'hover'>`, NOT THE WHOLE CLASS — `lsp-nav.ts`'s `NavContext` narrows its own
 * client the same way.** A tooltip asks one question; a type that could ask for the whole client
 * would let a future caller reach into `format` or `closeDocument` from a hover source, which is not
 * a thing a hover source should be able to do.
 */
export type HoverDeps = {
  readonly uri: () => string | undefined
  readonly client: () => Pick<LspClient, 'hover'> | undefined
}

/**
 * The hover tooltip, for the pointer.
 *
 * The KEYBOARD path is not here — it is a binding in `lsp-nav.ts` calling `activateHover`, so that
 * both editors get it from the one place both already build their navigation keys.
 *
 * Plaintext, because that is what `lsp-client.ts` advertises: the value goes in as `textContent`,
 * which is also what stops a server answer from being able to inject markup.
 */
export function lspHover(deps: HoverDeps) {
  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    const uri = deps.uri()
    const client = deps.client()
    if (uri === undefined || client === undefined) return null

    const line = view.state.doc.lineAt(pos)
    const position: LspPosition = { line: line.number - 1, character: pos - line.from }
    const answer = await client.hover(uri, position).catch(() => null)
    if (answer === null) return null

    /**
     * **`end`, NOT JUST `pos` — vendored `HoverPlugin.mousemove` (`@codemirror/view`) DEFAULTS `end`
     * TO `pos` WHEN A TOOLTIP OMITS IT, AND THAT DEFAULT CHANGES WHICH BRANCH IT TAKES.** With
     * `pos == end`, a mousemove closes the tooltip the instant `posAtCoords` stops reading exactly
     * `pos` — one character's worth of pointer movement, anywhere else in the very token the tooltip
     * is about. Passing the server's own `range` as `{ pos, end }` instead sends it down
     * `isOverRange`, which keeps the tooltip open anywhere between the two.
     *
     * `range` is optional in the protocol, so an answer with none falls back to the point `pos` the
     * request was made at — the previous, `end`-less behaviour.
     *
     * **`end` IS OMITTED RATHER THAN SET TO `undefined` WHEN THERE IS NO SPAN.** `Tooltip.end` is
     * optional, and this project's `exactOptionalPropertyTypes` treats "the key is absent" and "the
     * key is present and `undefined`" as different types — only the former satisfies `end?: number`.
     */
    const span = answer.range === undefined ? undefined : rangeOf(view.state.doc, answer.range)

    return {
      pos: span?.from ?? pos,
      ...(span === undefined ? {} : { end: span.to }),
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'cm-hover-answer'
        // `textContent`, never `innerHTML`.
        dom.textContent = answer.contents.value
        return { dom }
      },
    }
  })
}
