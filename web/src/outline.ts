import type { LspDocumentSymbol, LspRange } from './lsp-protocol'
import { createPanel, type Panel } from './panel'

/**
 * The outline's rows, rendered into a panel body — Plan 7 part 3a, and a consumer of the panel
 * primitive part 1 built rather than a mechanism of its own.
 *
 * **WHAT EACH LANGUAGE ANSWERS WAS MEASURED, NOT ASSUMED** (driven against the real server):
 *
 * | language | symbols |
 * |---|---|
 * | `redextape` | its `fn` definitions (kind 12) AND its `let` bindings (kind 13) |
 * | `redextape_tm` | its `state` blocks, kind 5 |
 * | `redextape_asm` | its labels, kind 12 |
 * | `redextape_lambda` | **none, by design** — a λ term carries no source positions |
 *
 * **NOTHING SENDS `children` TODAY, AND THIS RENDERS THEM ANYWAY.** The server answers the
 * hierarchical `DocumentSymbol` shape — that is what `initialize` negotiates, and an entry carries
 * `selectionRange` rather than `location` — but every symbol the four front ends produce is
 * top-level. Rendering the nesting costs four lines, where not rendering it would make the flat data
 * look like a decision.
 *
 * It does NOT follow that a front end gaining structure needs no change here, which an earlier
 * version of this paragraph claimed. `style.css` has an indent rule for depth 1 and depth 2; a third
 * level would render flush with the first until one is added.
 */

/** A row's depth is its own class, so a stylesheet decides indentation rather than inline padding. */
const DEPTH_ATTR = 'data-depth'

/**
 * Replace `body`'s contents with rows for `symbols`.
 *
 * `reveal` is given the symbol's `selectionRange` — the name itself — rather than `range`, which
 * spans the whole definition. Jumping to a function should put the caret on its name, not select its
 * body.
 */
export function renderOutline(
  body: HTMLElement,
  symbols: readonly LspDocumentSymbol[],
  reveal: (range: LspRange) => void,
): void {
  const rows: HTMLElement[] = []

  const walk = (list: readonly LspDocumentSymbol[], depth: number): void => {
    for (const s of list) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'outline-row'
      row.setAttribute(DEPTH_ATTR, String(depth))
      row.dataset.kind = String(s.kind)
      row.textContent = s.name
      // **A BUTTON, NOT A `<li>` WITH A CLICK HANDLER.** It is reachable from the keyboard and
      // announces itself as activatable without an `aria-*` attribute saying so — the umbrella's §4
      // rule 5, met by using the element that already means it.
      row.addEventListener('click', () => reveal(s.selectionRange))
      rows.push(row)
      if (s.children !== undefined && s.children.length > 0) walk(s.children, depth + 1)
    }
  }
  walk(symbols, 0)

  if (rows.length === 0) {
    // **A SENTENCE RATHER THAN AN EMPTY BOX.** A panel that is open and blank reads as broken. This
    // is reachable on a document that is mid-edit and does not parse, where the server has nothing
    // to say — not only on an empty one.
    const empty = document.createElement('p')
    empty.className = 'outline-empty'
    empty.textContent = 'nothing to show'
    body.replaceChildren(empty)
    return
  }
  body.replaceChildren(...rows)
}

/**
 * The outline as a panel, with the refresh rule that keeps it cheap.
 *
 * **IT ASKS ONLY WHILE IT IS OPEN, WHICH IS WHY `refresh` IS SAFE TO CALL ON EVERY DOCUMENT
 * CHANGE.** The caller wires it to the same signal diagnostics arrive on — one per settled edit —
 * and a closed panel turns that into nothing at all. A panel that asked regardless would issue a
 * `documentSymbol` request per edit for a list nobody is looking at.
 *
 * **AND IT ASKS WHEN IT IS OPENED**, because a panel opened after the last edit would otherwise show
 * whatever the document held when it was last open, or nothing.
 */
export function createOutlinePanel(opts: {
  readonly open: boolean
  readonly onToggle: (open: boolean) => void
  readonly symbols: () => Promise<readonly LspDocumentSymbol[]>
  readonly reveal: (range: LspRange) => void
}): { readonly panel: Panel; readonly refresh: () => void } {
  const body = document.createElement('div')
  body.className = 'outline'

  let generation = 0
  const refresh = (): void => {
    if (!panel.isOpen()) return
    // **A GENERATION, FOR `SessionClient`'s REASON ONE LAYER DOWN.** Two edits in flight answer in
    // whatever order the worker gets to them, and a slow first answer landing after a fast second
    // would paint the older outline over the newer one.
    generation += 1
    const mine = generation
    opts
      .symbols()
      .then((syms) => {
        if (mine !== generation) return
        renderOutline(body, syms, opts.reveal)
      })
      .catch(() => {
        // The client reports an unavailable server once, through the notice line. An outline that
        // cannot be fetched stays as it was rather than blanking under a message of its own.
      })
  }

  const panel = createPanel({
    name: 'outline',
    label: 'outline',
    body,
    open: opts.open,
    onToggle: (open) => {
      opts.onToggle(open)
      if (open) refresh()
    },
  })

  if (opts.open) refresh()
  return { panel, refresh }
}
