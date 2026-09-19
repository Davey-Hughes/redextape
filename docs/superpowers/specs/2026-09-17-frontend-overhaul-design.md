# Frontend overhaul — design (Plan 7, umbrella)

The web app has most of what the project set out to build — editable source, λ and TM panes, click
linking, running focus, copies of derived text, a persisted tiling layout — and is hard to use. This
design is the overhaul that makes it usable: every control functional and intuitive, and a styled
presentation of all four languages the project speaks (source, λ, TM, asm), taking its cue from
Compiler Explorer without copying it.

**This is an umbrella.** It records the decisions made during brainstorming, splits the work into seven
parts, and fixes the contracts those parts build against. Each part gets its own spec → plan → PR(s),
as Plan 5's slices did. Where a part has to settle something before it can be planned, §6 names it
rather than guessing an answer here.

Every figure below was read at `7d1ee20` on 2026-09-17; §11 gives the command or source for each.

## §1 What is wrong today

Observed by using the app (dev build at `7d1ee20`, 1440×900) and by a code-level inventory of every
interactive control in `web/`:

- **The layout does not hold together.** The λ pane's `✎ fork` button wraps onto two lines; the TM
  pane's step controls sit below its δ table, out of view; the results readout lives outside the tiled
  layout, under it.
- **The λ term is one line.** For `fact(3)` the initial term is 540 characters and the reduction runs
  1,319 β-steps; the interesting part at any step is one redex inside it.
- **The inventory counts 29 distinct controls**, and the worst of them are confusing by construction:
  - `⌄` means two different things — "show the editor" and "bring the editor to this pane" — told
    apart only by tooltip.
  - The `shows` selector reads as a trivial choice and is not one. On a fresh page it offers two options
    that both read `source`; only their optgroup labels (λ, TM) tell them apart, and picking the other
    one turns a λ pane into a TM pane. The caption `shows` names neither of those facts.
  - One concept has three names (buffer / scratch / scratchpad); the action is `fork` but the state it
    produces is `[detached]`, and nothing on screen connects the two.
  - `warm` rebuilds a buffer from its text at step 0, discarding its history, and its label does not
    say so.
  - `⏵` toggles playback — a second click pauses — but the button never changes to show it is
    playing, and playback runs at a fixed 8 fps.
  - Clicking a linkable λ token or a δ row works only by mouse, and nothing marks what is clickable;
    clicking an ordinary λ token does nothing.
- **Missing entirely:** an asm view; the LSP's features (format, definition, references, outline) —
  the server exists and serves Neovim, but the browser cannot reach it; colouring for λ, TM and asm
  text; any way to load an example or share a program.

## §2 Decisions

| # | Topic | Decision | Declined |
|---|---|---|---|
| 1 | Workspace | Three **presets** — *Explorer* (views tiled, step controls in each view), *Debugger* (tiled, one step bar driving the focused view), *Stage* (one tabbed view plus an inspector) — each a named set of values for three independent **switches**. The switches stay individually reachable, and an arrangement between presets is remembered. | three fixed modes (triples the surface, drifts); no modes, compose-your-own (no starting point for a newcomer) |
| 2 | The switches | *step controls*: in each view \| one bar at the bottom · *views*: tiles \| one tabbed stage · *value & steps*: strip \| inspector panel | — |
| 3 | Look | **Style × palette.** Three styles — *Paper*, *Terminal*, *Instrument* — own fonts, label case, radius and density. Palettes own every colour. Each style ships its own palette in light and dark (six built-ins), and any palette can be used with any style. *Skin* and *appearance* (system / light / dark, as today) are two controls. | one control listing palettes by name; Terminal dark-only |
| 4 | Theming reach | Built-in palettes stored **as data**, plus **base16 paste-in import** (the format Gruvbox, Nord, Solarized, Dracula and Catppuccin are published in) with a contrast warning. | a per-token colour editor (possible later; needs its own design pass) |
| 5 | λ view | Laid out by structure, subterms foldable, Church numerals abbreviated (`3̄`) with the full term one click away, a names / de Bruijn toggle, and a **collapsible map of the whole term** marking the redex. | flowing text only |
| 6 | TM view | Tapes, plus a **rule table** and a **state diagram**, each an independently collapsible panel. | tapes with a one-line rule sentence and rules on demand only |
| 7 | asm view | The listing, **stepping**, with a **collapsible registers panel**. Needs a stepping interpreter in the core. | listing only |
| 8 | Secondary regions | Every secondary region in every view is a named, collapsible **panel** — one mechanism. | per-view one-off toggles (today's `hide δ`, `⌃/⌄`) |
| 9 | Editor intelligence | Format (on demand, plus an opt-in format-on-blur), outline, hover, go-to-definition, references, and diagnostics in every editor. Hover is new server work; the rest is served today. | — |
| 10 | Colouring | **web-tree-sitter** running the four existing grammars and their highlight queries, highlight-only. | classifiers in the core via wasm; LSP semantic tokens (reverses the server's recorded decision) |
| 11 | Keymap | *default* \| *vim*, via `@replit/codemirror-vim`. | — |
| 12 | Reach | An **examples menu**; first load shows *Explorer* with a real example; **share links** carry program, encoding, workspace and each view's step position, versioned. | links carrying the program only |
| 13 | Vocabulary | §4. "Copy" replaces buffer / scratch / scratchpad / fork. | keeping "fork" |

## §3 The seven parts, and their order

| # | Part | Contains | Depends on |
|---|---|---|---|
| 1 | **Foundations** | style × palette tokens; six built-in palettes as data; skin and appearance controls; the panel primitive; focus-visible styling; non-colour cues for every colour-carried state | — |
| 2 | **Workspace shell** | header and settings menu; presets and switches; the step-control component (with ⏸ and a speed setting); strip and inspector (the results readout moves into the workspace); view title-selector; `⋯` view menu; `+ view`; the copies menu; one polite live region; the §4 renames | 1 |
| 3 | **Editor intelligence** | LSP worker running `redextape-lsp`; format; outline; hover (server + client); definition; references; diagnostics in every editor; web-tree-sitter colouring for all four languages; vim keymap | 1 |
| 4 | **Views** | λ (layout, folding, term map); TM (tapes, rule table, state diagram); source | 2 |
| 5 | **asm** | stepping interpreter in the core → an `asm` leg in wasm → the asm view with its registers panel | core half: none · view: 2 |
| 6 | **Reach** | examples menu; first-load example; share links; base16 import | 2 (a link serialises the workspace) |
| 7 | **Accessibility close-out** | whatever remains of the roadmap's deferred-accessibility list after 1–6 (§9) | all |

Part 5's core half is Rust-only and touches no web file, so it can run beside parts 1 and 2. Parts 2 and
3 both live in `web/`, so they run one after the other rather than as a parallel wave: `web/`'s
`typecheck` script runs `cargo` through `build:bindings`, and two lanes in one tree collide.

## §4 Vocabulary and the rules every control follows

**Renamed.** Internal names (`pane`, `session`, `leg`, `slot`, `binding`) stay in the code; these are
the words a user sees.

| Today | Becomes |
|---|---|
| pane | **view** |
| buffer / scratch / scratchpad | **copy** — "λ copy 1", "TM copy 2"; the `buffers ▾` menu becomes `copies ▾` |
| `✎ fork` | **`✎ edit a copy`**; its tooltip states that λ copies *the term at this step* and TM copies *the whole machine* |
| `[detached]` | **"copy · not linked"**, in the view's title |
| the `shows` select | **the view's title is the selector** — `λ · program ▾`, `λ · copy 1 ▾`; plain text when there is one choice, never removed |
| `retire` | **delete**, followed by an undo notice for a few seconds |
| `warm` / `cool` / `asleep` | **running** / **paused**; the actions read "pause" and "resume — restarts at step 0" |
| `hide δ` · δ-steps · β-steps | **rules** · **transitions** · **reductions**, with δ and β in tooltips |
| `follow` | **follow current rule** |
| `◐`, `reset layout` | a **settings** menu (skin, appearance, keymap, format on blur) beside a labelled `◐` quick toggle; "reset preset" inside the preset menu |
| `(same)` in the split menu | "another view of this" |

**The rules.** Each one fixes a class the inventory found, not only the instances it found.

1. **A control's visible label and its accessible name agree.** A glyph-only button takes its tooltip
   text as its accessible name. (Today `reset layout` reads differently to a screen reader, and the step
   buttons' accessible names are their glyphs.)
2. **One glyph, one meaning, app-wide.** `▸`/`▾` only ever disclose; `✕` only ever closes; `⋯` only
   ever opens a view's menu; `⏮ ◀ ▶ ⏵ ⏸` only ever drive stepping.
3. **A toggle shows its state.** Play shows `⏸` while playing; a panel shows open or closed.
4. **Removed or disabled, by one rule.** A control is *removed* where it can never apply in that view
   — the project's existing rule, kept. It is *disabled, with its reason stated*, where it could apply
   but cannot right now — the exception the TM fork button already takes over `MAX_FORK_RULES`, made the
   rule.
5. **Clickable things look clickable, work from the keyboard, and changes are announced.** Linkable λ
   tokens and rule rows get hover and focus styling and keyboard reach. Layout, copy and link changes go
   to one polite live region.

**A view's header, left to right:** title/selector · status · step controls (when the switch puts them
in the view) · panel toggles · `⋯` · `✕`. The `⋯` menu holds split right, split down, edit a copy, move
the editor here, and format.

## §5 Contracts the parts build against

**Style × palette.** A style is a `[data-style]` CSS block that sets only non-colour tokens: font
families, radius, spacing steps, label case and tracking. A palette is data — a name plus `light` and
`dark` maps of the semantic colour tokens (surfaces, rules, text, accent, the token classes, and the
link / focus / redex / head marks) — written onto `:root` as custom properties at startup. The inline
pre-paint script in `index.html` already applies the stored appearance before first paint; it grows to
apply the stored style and the cached resolved palette the same way, so no load shows the wrong colours
for a frame. The CodeMirror editors take their colours from the same tokens.

**No colour bypasses a palette.** A new `scripts/check-*.sh` gate, with `--self-test` like its
siblings, fails on a colour literal in `web/src/style.css` outside the fallback token block.

**One disclosure mechanism.** `panel.ts` builds a named, collapsible region with a `▸`/`▾` header, an
`aria-expanded` disclosure button, and optional header actions. Its open state is saved per view in the
workspace state. It replaces `hide δ` and both `⌃/⌄` collapses, and it is the shape of the λ term map,
the TM rule table and state diagram, the asm registers, the outline, and the inspector.

**Workspace state.** The persisted layout tree (`layout.ts`, already versioned and validated on restore)
gains the preset, the three switches, the focused view, and each view's panel state. A preset is a set of
switch values plus a default tree; "reset preset" restores that tree. Stage's tabbed stage is a
layout-model change and part 2's spec decides its shape (§6).

**One step-control component.** It renders the `ControlState` that `controls.ts` already computes,
unchanged as logic, either inside each view's header or once in the bottom bar bound to the focused view,
per the switch. It adds the `⏸` state and a speed setting in place of the fixed interval.

**Editor intelligence.** A dedicated LSP worker runs `redextape-lsp`'s `Server` compiled to wasm. Its
library half is transport-free — `Server::handle` takes a message and returns messages — and already
covers `.rxt`, `.rxlambda`, `.tm` and `.asm`. Each editor is one document. web-tree-sitter colours all
four languages from the existing grammars' highlight queries; it is highlight-only and never produces a
tree that anything lowers or compiles, which is the line the roadmap's tree-sitter entry draws. vim is a
keymap compartment.

**asm as a third leg.** A stepping `AsmVm` in the core, with `run_asm` becoming a loop over its `step`,
exposed on the wasm session beside λ and TM. The asm view then gets recorded history, stepping and play
from the machinery λ and TM already use, rather than a parallel copy of it. This is the contract with the
most reach: it touches the session, protocol and worker types, not only a new pane.

**Share links.** `#s=` followed by base64url(deflate(JSON `{ version, program, encoding, workspace,
positions }`)), in the URL fragment so it is never sent to a server. Opening one validates it the way a
layout restore already validates stored state.

**Examples.** `web/src/examples/*.rxt` plus a manifest (title, one-line description). A test compiles
every example and checks λ and TM agree on its value within budget, so an example cannot rot unnoticed.

## §6 Each part's scope, and what its own spec settles first

**Part 1 — Foundations.** In: the token list and palette format; the six built-in palettes; skin and
appearance controls; `panel.ts`; focus-visible styling; a non-colour cue for each colour-carried state
(the δ table's current and firing rows, the head cell, `.linked` and its λ / δ counterparts, and the
three running-focus marks — including coincidence, which today is carried by hue alone); the colour gate.
Settle first: whether *Instrument*'s fonts (Inter, IBM Plex Mono in the mockups) ship as font files or
fall back to system faces — a bundle-size and licensing question.

**Part 2 — Workspace shell.** In: header and settings menu; presets and switches; the step-control
component; strip and inspector; the view title-selector; the `⋯` menu and `+ view`; the copies menu with
delete-and-undo and pause/resume; the live region and focus management; every §4 rename, with the tests
that pin old labels updated in the same change. Settle first: how Stage's tabbed stage sits in the
layout tree — a leaf holding a set of views, or a new tab-group node — and the migration of persisted
layouts across that version change.

**Part 3 — Editor intelligence.** In: the LSP worker and its wasm build; format and opt-in
format-on-blur; the outline panel; hover in the server and the client; definition and references
(including jumps across views); diagnostics in every editor, which closes the TM gutter showing none;
web-tree-sitter colouring; the vim keymap. Settle first:
- which grammar ABI `web-tree-sitter` loads — CI pins the tree-sitter CLI at 0.25.10, `web-tree-sitter`
  is at 0.27.0 — measured by loading one built grammar, not read from a changelog;
- how the four grammar `.wasm` files are built (`tree-sitter build --wasm` needs emscripten or docker)
  and whether CI builds them or the tree commits them;
- whether `redextape-lsp` compiles for `wasm32-unknown-unknown` as it stands — `lsp-server` is used only
  by `main.rs` but sits in `[dependencies]`;
- what hover says in each language; `.rxlambda` answers no definition or outline today, because the term
  type carries no source positions, so hover on a λ copy may answer nothing by design;
- how `Esc`, the format shortcut and pane shortcuts coexist with vim's modes.

**Part 4 — Views.** In: the λ layout, folding, numeral abbreviation, names / de Bruijn toggle and term
map; the TM tapes, rule table and state diagram; source-view polish. Settle first:
- where λ layout comes from — client-side over the `lambdaAst` view model the wasm already exports, or a
  core printer;
- the state diagram at scale: `fact(3)` compiles to a machine of 1,199 states and 2,816 rules, so the
  diagram shows a neighbourhood of the current state, not the whole machine, and the spec decides how;
- the rule table's semantics for a virtualized list (§9, item 3).

**Part 5 — asm.** In: the core `AsmVm` and its oracle; the wasm `asm` leg; protocol and session support
for a third leg; the asm view and registers panel; linking asm to source. Settle first: whether asm
instructions carry source nodes for linking the way λ and TM do; whether "edit a copy" extends to asm
(the core already parses and runs asm text).

**Part 6 — Reach.** In: the examples and manifest; the first-load example; share-link encode, decode,
versioning and a size warning; base16 import with its token mapping and contrast warning. The candidate
examples, each run through the CLI at `7d1ee20`: `let x = 40; x + 2` (42), a closure (42), `is_even(6)`
by mutual recursion (true), `fact(4)` (24), `map` and `fold` over `[3, 1, 2]` (9), and `sum_to(5)` with
`while` (15) — plus `fact(12)` as the example that runs out of step budget on purpose. Settle first: the
step counts each example produces in the browser, and the byte size of a typical link.

**Part 7 — Accessibility close-out.** §9.

## §7 When things fail

Each failure leaves a working app and one notice. None blocks editing or compiling.

- **The LSP worker dies.** Editors keep working without language features and a note says so. The
  worker restarts once, then stays off with a notice.
- **A tree-sitter grammar fails to load.** That language shows uncoloured, with one notice.
- **A stored or imported palette lacks tokens.** The missing ones fall back to the style's own palette.
  An import with poor contrast shows the failing pairs, and the user chooses whether to apply it.
- **The asm VM faults or hits its cap.** Reported through the end-of-run states λ and TM already use.
- **A share link is invalid or from an unknown version.** The program loads alone, with a notice. Step
  positions past the end of a run clamp to the last step, with a notice.
- **A copy is deleted.** Its worker stops at once; undo restores the text and restarts it at step 0,
  and the undo notice says so.

## §8 Testing

1. **Controls, as a class.** One browser test walks every button in every preset and asserts it has an
   accessible name that is not a bare glyph, that the name matches its visible label or tooltip, and that
   it is reachable by keyboard. This is §4's rules 1 and 5 as a gate, rather than one test per control.
2. **Palettes.** A node test asserts every built-in palette defines every token, and meets WCAG AA
   contrast (4.5:1 for text, 3:1 for UI marks) in light and dark.
3. **asm stepper.** A Rust oracle: stepping to the end matches `run_asm` on the whole corpus.
4. **Share links.** An encode → decode round-trip property, and a frozen link from the first version that
   must keep opening.
5. **Editor intelligence.** Per language, browser tests cover diagnostics, format, definition and
   outline; a grammar fixture checks the browser-loaded tree-sitter produces the highlights the Rust
   `redextape-grammar-check` crate already holds the grammars to, which also catches ABI or build drift.

**Not added: pixel screenshot baselines.** Across three styles and six or more palettes they would break
on every token change. Each part's roadmap entry records a manual visual check across the three presets
in light and dark instead.

## §9 The deferred accessibility pass

The roadmap's entry of 2026-08-18 moved the pass's trigger from "5d-iv has landed" to "the web UI is
close to done", with three checkable conditions: no scheduled slice that adds, removes or relabels a
control; no pane kind or renderer expected to change; and the standing list going a full slice without
gaining an entry. It named the reason — substantial tuning was still to come — and this overhaul is that
tuning.

**This design does not take the pass early.** Part 7 is the pass, run when those three conditions hold.
What parts 1–6 do is stop the list growing, by building every new or renamed control to §4's rules, and
close the items whose controls they replace outright. Of the sixteen items filed, 8, 11 and 12 are
closed; the other thirteen map to parts as below, and part 7 takes whatever is still open.

| Item | In brief | Part |
|---|---|---|
| 1 | a control that hides itself on click strands keyboard focus | 2 |
| 2 | the δ-table toggle relabels itself unannounced | 1 |
| 3 | a virtualized table is unreachable by assistive tech | 4 |
| 4 | the current row, firing row and head cell are carried visually only | 1, 4 |
| 5 | no focus-visible styling | 1 |
| 6 | `#link-status` announces nothing | 2 |
| 7 | link and running-focus states carried by colour, coincidence by hue alone | 1, 2 |
| 9 | layout controls announce nothing | 2 |
| 10 | the buffer list announces neither a retirement nor a refusal | 2 |
| 13 | temperature carried only in a row's text and its control | 2 |
| 14 | `cool` changes what other panes show, unannounced | 2 |
| 15 | a second collapse control doubles item 2's count | 1 |
| 16 | neither editable text region carries an accessible name | 3 |

## §10 Out of scope

- A per-token colour editor (§2, row 4).
- Synchronized stepping across views — the original design defers it to v1.5 because normal-order
  reduction visits constructs in a different order from strict evaluation.
- Tromp diagrams. The λ term map is a step toward that view, not the view.
- Producing reduced `.tm` files in the browser, and bidirectional editing.
- A phone-width layout. Nothing here should break on a narrow screen, but no small-screen workspace is
  designed.
- Pixel screenshot baselines (§8).

## §11 Figures, and what produced them

| Value | What | Produced by |
|---|---|---|
| 29 | distinct interactive controls in `web/` | a read of `web/index.html` and `web/src/*.ts` at `7d1ee20`; no command produces it, and five of its claims were re-checked against the code |
| 540 | characters in the initial λ term of `fact(3)` | `redextape --no-config emit fact.rxt --lang lambda \| tr -d '\n' \| wc -m` |
| 1,319 and 18,574 | β-steps and δ-steps for `fact(3)` in the browser; TM width 8, value 6 | the dev build at `7d1ee20`, source `fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }` then `fact(3)`, unary encoding |
| 1,199 and 2,816 | states and rules in `fact(3)`'s machine | `emit … --lang tm`, then `grep -c '^state '` and `grep -cE '^\s+\['` |
| 21 and 4 | instructions and labels in `fact(3)`'s asm | `emit … --lang asm`, then `grep -cE '^\s+[a-z]'` and `grep -cE '^[A-Za-z_.0-9]+:'` |
| 42, 42, true, 24, 9, 15, 479001600 | the candidate examples' values | `redextape --no-config run <file>` on each |
| 0.27.0 | latest `web-tree-sitter` | `pnpm view web-tree-sitter version`, 2026-09-17 |
| 6.4.0 | latest `@replit/codemirror-vim` | `pnpm view @replit/codemirror-vim version`, 2026-09-17 |
| 0.25.10 | tree-sitter CLI version CI pins | `TREESITTER_VERSION` in `scripts/install-treesitter-ci.sh` |
| 16 filed, 13 open | the deferred-accessibility list | the list in the roadmap's Plan 5 section; items 8, 11 and 12 are closed |
