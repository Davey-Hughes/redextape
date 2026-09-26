# Plan 7, part 4 — Views: the λ tree and term map, the TM rule table and state diagram — design

Part 4 of [Plan 7](2026-09-17-frontend-overhaul-design.md). It changes what the λ and TM views *draw*:
the λ view becomes a laid-out, foldable tree with a map of the whole term, and the TM view gains an
accessible rule table and a state diagram.

It answers the three questions the umbrella's §6 left for this part, and **measurement changed two of
the umbrella's premises**. The umbrella pictured the state diagram as "a neighbourhood of the current
state"; measured, that neighbourhood is a median of 5 states strung along a chain, and the diagram
this spec settles on is grouped by asm instruction instead (§8). The umbrella left open whether λ
layout comes from the client or a core printer; measured, neither the recorded frames nor a printer can
carry it, and the answer is a tree served on demand (§4). §14 gives the command behind every figure.

Code facts below were read at `c9b6876` (#105, part 3c's squash merge).

**Amended 2026-09-23, while writing 4a's plan, before any code.** Three corrections, each to a claim
the approved text made:

1. **Owner tags alone would have regressed linking at step 0.** §5.4 said the tree links through `App`
   owner tags and the step-0 link window goes. Measured (§14.1), tags reach 7 of `fact(3)`'s 17 source
   constructs at step 0, where `node_to_lambda`'s paths — what the link window uses — reach all 17; the
   ones only paths reach are literals, variables and definitions. So the tree carries **both**: at step
   0 the path links, at every step the owner tags (§4.3, §5.4). The window still goes; step 0 keeps
   every link it had, and later steps gain the tagged ones.
2. **The running focus does not mark the λ view by owner.** §5.4 said it would. `Owner`'s own doc in
   `reduce.rs` forbids exactly that reading — "It names a construct, NOT A LOCATION" — because
   substitution copies a tagged subterm to every place it lands, so marking by owner would light every
   copy. The λ view's running focus is its *next redex* and *contractum* marks (§5.3), which are
   locations.
3. **The next redex is found by the arena walk, not by `reduce_step`.** §4.3 said `reduce_step`, which
   recurses once per level and so needs `LambdaCursor::next`'s depth guard in front of it, and builds
   the reduced term only to throw it away. The arena's builder already walks the term iteratively in
   pre-order, and the first `App` whose function is an `Abs` in that order is the leftmost-outermost
   redex; §11's oracle holds it equal to the path the next step records.

**Amended again 2026-09-23, from 4a's prototype, and on 2026-09-25 at its final review.** Two changes
found by running the prototype, a third found by reviewing what it built, and a fourth recording where the
build settled otherwise than this text:

4. **A chip ignores its hints' trailing digits.** §5.2 said hints are raw, so no digit stripping was
   involved. That holds for a lowered term, whose hints never carry a digit; a copy is built by
   re-parsing printed text, and there the printer's freshened names (`x0`) are the hints. Without the
   stripping, a numeral in any copy whose printer had freshened its binders never read as a chip (§2.1,
   §5.2).
5. **Folds also start over on a rebind, and a new compile is noticed by its build.** §5.2 named "reset
   folds" and a new compile. A view bound to another session's term resets too, since a path in one term
   names nothing in another's — the prototype carried a copy's folds home onto the program's tree. And a
   new compile is a new build behind the same session, so the binding does not change; the view resets
   when the build its trees come from changes, which the prototype first missed (§5.2).
6. **Both layouts are `role="tree"`.** §5.6 made *code* a labelled list of lines, but a list's items take
   neither a roving cursor (`aria-activedescendant`) nor `aria-expanded`, and the code layout needs both.
   Its rows are `treeitem`s levelled by nesting, as the outline's are, and the body's `data-layout` says
   which layout is showing (§5.6). §5.3's "follow redex" header action, which the plan had left out, is
   built too.
7. **Where the build differs from the text.** §5.5: a hidden view gets no tree and no compile's
   machine, but the `tm-value` reply and a copy's `no-session` and `worker-error` replies still write text
   into a hidden TM view; those are cheap text writes, and the per-compile cost is what §5.5 closes. §4.5
   and §10: the view keeps one tree request in flight per session, not one per animation frame, and a
   reply for a step it has moved past is not dropped but shown dimmed as stale, with `aria-busy`, and the
   λ link state reads `waiting` until this step's tree arrives. §5.3: keys that scroll, a term map pick
   and a pin's first scroll detach following too, not only a user scroll. §10: a tree the view cannot lay
   out shows its frame's text with one note, a failure the list there did not have.

## §1 Scope, and the two PRs

One design, two PRs, each with its own plan and roadmap entry. **4a ships first**, because 4b's diagram
links through the λ view and 4a replaces the λ link path that link would otherwise be wired to (§5.4).
Both live in `web/`, so they run one after the other, not as a parallel wave.

**4a — the λ view.** In: a tree for the displayed step, served on demand by the session worker (§4);
the *code* and *outline* layouts, folding, numeral and boolean chips, the names / de Bruijn toggle,
following the redex, and linking at every step (§5); the term map panel with its *icicle | minimap*
switch (§6); hidden views requesting nothing (§5.5). The step-0 link window is deleted in the same
change.

**4b — the TM view.** In: each state's instruction and the asm listing on `TmProgram` (§7); the state
diagram panel with its *program | local* switch (§8); the rule table's sizing and grid semantics, and a
non-visual equivalent for the tape head (§9).

**Source-view polish**, which the umbrella's §6 also lists for this part, has no concrete defect filed
against it. 4a changes the source editor only as far as linking at step *k* requires (§5.4); anything
else stays out (§13).

## §2 What exists

### §2.1 The λ view

`LambdaPane` draws a flat `<pre class="term">` of token spans, rebuilt every draw from a
`LambdaState` frame. Frames are printed at `FRAME_BYTES = 512` and recorded into a ring bounded by
`HISTORY_BYTES = 32 MiB`; scrubbing reads the ring. The worker streams frames as `lambda-frames`
replies.

- **The redex mark marks the contractum.** `LambdaState.redex_span` covers the subterm the step just
  *produced*, not the redex it is about to contract; `viewmodel.rs` says so in the field's own doc. The
  path it came from, `LambdaState.redex`, is on the Rust type but `#[serde(skip)]`, "until the tree
  view reads it".
- **Linking is step-0 only.** A source click switches the view into a *link window*: a slice of the
  step-0 term from `LinkIndex`, drawn instead of the current frame (`lambda-window.ts`, and the
  link-window mode in `lambda-pane.ts`, `link-wiring.ts` and `spans.ts`). The λ view shows no running
  focus at all; `draw.ts` applies it to the source editor and the rule table only.
- **A tree export exists and the web app does not read it.** `Session.lambdaAst(nodeBudget)` returns a
  `TermTree`: a post-order arena of `Var(index)`, `Abs(hint, body)`, `App(f, a)`, unshared, `null`
  over budget. Its callers are tests — `viewmodel_contract.rs`, `session.rs`'s unit tests, the wasm
  crate's `tests/browser.rs` — and `frame_cost_probe.rs`'s section F. Nothing in `web/src` calls it.
- **Names are hints, and freshening is print-time.** `LambdaTerm` is de Bruijn; `Abs` carries a
  print-only hint. The printer's `fresh()` appends a digit (`f0`, `x0`) when a hint would shadow, so a
  lowered term's hints never carry one — though a copy's can, since it re-parses printed names
  (amendment 4).
- **No numeral or boolean detection exists for display.** `decode_church` recognises a numeral at the
  root of a finished run, for decoding the value. Nothing detects one inside a term.

### §2.2 The TM view

- **Tapes**: one row of cells per tape, the head cell bold and bordered, tape names as labels.
- **Rule table**: hand-virtualized in `tm-pane.ts` over `state-table.ts`'s `StateIndex` (a prefix sum of
  one header row plus one row per rule, per state) and `virtual-list.ts`'s `visibleWindow`, with 24 px
  rows. Its host is capped at `max-height: 40vh` in `style.css`. Marks are `is-current` (the state's
  header row), `is-firing`, `is-linked` and `is-focus`. `Follow` in `state-table.ts` keeps the current
  row in view and detaches on a user scroll.
- **`TmState.rule` is the rule about to fire** — the first rule matching the post-step tapes — not the
  rule that fired. Nothing reports which rule fired.
- **No diagram exists**, and `web/package.json` has no graph-layout dependency.
- **The lowering knows each state's instruction and the map discards it.** `lower_tm_mapped` returns
  `state_origins`, the `prog.code` index each state was built for. `SourceMap::build` resolves it to a
  source `NodeId` for `tm_owner(name)` and keeps only the `NodeId`.

### §2.3 What was measured

A throwaway crate of four probes over `redextape-core`, run natively in release under a memory cap
(§14.2 has the sources). The corpus is the umbrella's candidate examples plus `fact(4)` and `while4`.

**λ terms are far larger than a frame.** Per step, over whole runs:

| Program | β-steps | nodes: median / max | printed bytes: median / max | depth: max | all frames printed whole |
|---|---|---|---|---|---|
| `fact(3)` | 1,319 | 2,172 / 3,421 | 7,349 / 11,626 | 58 | 9,422,626 B |
| `fact(4)` | 7,398 | 4,152 / 6,298 | 14,134 / 21,508 | 83 | 99,328,337 B |
| `is_even(6)` | 654 | 1,314 / 2,160 | 4,242 / 7,140 | 57 | 2,832,043 B |
| `map_fold` | 555 | 968 / 2,921 | 3,048 / 8,519 | 41 | 2,263,069 B |
| `while4` | 470 | 1,962 / 9,763 | 7,064 / 35,426 | 54 | 4,992,671 B |

So a 512-byte frame shows about the first 7% of a median `fact(3)` term, and recording whole terms per
step would take `fact(4)` to 99 MB against a 32 MiB ring.

**Keeping every step's term is cheap, because terms share structure.** Counting each `Rc<Node>` once
across every step of a run, `fact(3)` retains 19,894 nodes and `fact(4)` 210,973. Re-reducing a whole
run from step 0 takes 0.95–1.03 ms for `fact(3)` and 12.8–12.9 ms for `fact(4)` (three runs each).

**A TM neighbourhood is a chain.** Sampled at every 7th step of whole runs, the states within 2 rules of
the current one (either direction) number a median of 5 for `fact(3)`, `map_fold` and `while4` alike;
within 3 rules forward, a median of 4. Runs visit nearly every state — `fact(3)` visits 1,190 of
1,199 over 18,574 steps.

**State names are hierarchical.** A compiled machine's states are named `<gadget><n>.<part>.…`, and the
first segment is one instruction's gadget or one runtime routine. Grouped by that first segment,
`fact(3)`'s 1,199 states form 46 groups joined by 60 edges; `while4`'s 542 form 38 groups and 44 edges;
`map_fold`'s 7,353 form 221 groups and 309 edges.

**Grouping by source construct does not partition the machine.** `tm_owner` assigns `fact(3)`'s
states to 14 constructs, with 244 states unowned and the largest construct owning 274.

## §3 Decisions

| # | Topic | Decision | Declined |
|---|---|---|---|
| 1 | Split | One design, two PRs: 4a the λ view, 4b the TM view | three PRs (term map alone); λ and TM only, deferring folding, chips and tapes |
| 2 | Where λ structure comes from | A tree for the displayed step, served on demand; all layout client-side (§4) | a core pretty-printer (every fold and toggle a round trip); larger recorded frames (§2.3: 99 MB) |
| 3 | λ layout | Two layouts, switchable per view: *code* (indented) and *outline* (a node per row) | nested boxes — recorded for later, not built |
| 4 | Term map | One panel, *icicle \| minimap* switch | a strip showing position only |
| 5 | 0 and false | The name hint decides: `f x` binders make a numeral chip, `t f` binders a boolean chip | structure alone (`false` reads `0̄`); abbreviating only numerals ≥ 1 |
| 6 | State diagram | Two levels, *program \| local*: grouped by instruction by default, the states within 2 rules on drill-down | local only (the umbrella's reading, §2.3); grouping by source construct (§2.3) |
| 7 | Diagram layout | Hand-written and deterministic: a listing, and layers by distance | elkjs, dagre, or any graph-layout dependency |
| 8 | Linking in λ | Through the tree: `node_to_lambda` path links at step 0, `App` owner tags at every step; the step-0 link window is deleted | keeping the link window beside the tree; owner tags alone (§14.1: 7 of 17 constructs at step 0) |

## §4 4a — the tree on demand

### §4.1 The request

A new request, `lambda-tree { gen, step, nodeBudget }`, answered by one `lambda-tree` reply. The
`lambda-frames` stream is untouched: text frames, `FRAME_BYTES`, the ring and scrubbing stay exactly as
they are. A view asks for the tree of **the step it displays**, and for no other.

### §4.2 Checkpoints and replay

The session keeps a checkpoint every 256 steps: the cursor's term (an `Rc` clone, which shares
everything), its step count and its `last_redex()`. To answer step *k*, it starts a cursor from the
nearest checkpoint at or below *k* and steps at most 255 times. §2.3's figures bound the cost: a whole
`fact(4)` run re-reduces in about 13 ms natively, so 255 steps of it cost well under a millisecond.
Memory grows with steps ÷ 256, not with `MAX_REDUCTION_STEPS` (5,000,000). The same store serves
`LambdaScratch`, which has its own `lambdaAst` today.

A step past the recorded end clamps to the last step, the same rule share links use (umbrella §7).

### §4.3 The arena

One core function builds the reply, iteratively, as `to_tree` already walks: typed arrays, not an
array of objects, so 20,000 nodes cross the boundary as a handful of buffers.

- per node: kind (`Var`, `Abs`, `App`) and child indices;
- per `Var`: its de Bruijn index;
- per `Abs`: its **raw hint** and its **display name**, freshened by the printer's own `fresh()` rule
  in the same walk, so the tree's names are the text frames' names;
- per node: its **link** `NodeId`, or none. At step 0 a node at a `node_to_lambda` path carries that
  construct (first by node id, `print_lambda_linked`'s rule); otherwise an `App` carries its owner tag.
  A `LambdaScratch` has no `SourceMap`, so its trees carry tags only;
- two marked node indices: **next redex**, the first `App` whose function is an `Abs` in the builder's
  pre-order walk, and **contractum**, resolved from `last_redex()`. This is the reader
  `LambdaState.redex`'s doc has been waiting for; the field itself stays skipped on the frame.

The arena is **unshared**, like `TermTree`: a shared subterm appears once per occurrence, which is what
a layout needs. A term over `nodeBudget` returns a refusal carrying the node count, never a partial
tree.

### §4.4 `lambdaAst`

`lambda-tree` supersedes `lambdaAst`. Its tests — `viewmodel_contract.rs`'s arena contract, the
session's budget tests, and `tests/browser.rs`'s marshalling and depth tests — are carried over to the
new arena rather than dropped, and `frame_cost_probe.rs`'s section F is retargeted or retired with a
note. The plan decides whether `TermTree` is extended into the new arena or replaced by it.

### §4.5 Budget and play

The default budget is 20,000 nodes; `while4`'s peak of 9,763 is the largest in §2.3's corpus. Over
budget, the view falls back to the flat text it draws today, with one notice naming the node count.

A view keeps at most one tree request in flight per session, and a reply for a step it has moved past
is shown dimmed as stale until this step's tree arrives (amendment 7). During play at 5,000 steps a
second, it shows the most recent tree that came back.

## §5 4a — the λ view

### §5.1 Two layouts

- **code**: a subterm that fits the width stays on one line; one that does not puts its head on the
  first line and its arguments indented below. Curried binders merge: `λm n0.`.
- **outline**: one node per row with tree guides; an application spine flattens to `apply head` with
  its arguments as child rows.

Both render **by line through `visibleWindow`**, since the terms run to thousands of nodes (§2.3).
*Nested boxes* was the third candidate; it is recorded in §13, not built.

The layout and the variable mode are **display settings in the view's `⋯` menu**, as a "Display"
group of radio items: *code | outline*, and *names | de Bruijn*. De Bruijn mode prints `λ.` binders
and index variables. Both settings persist per view in the workspace envelope beside `panels`; a
stored workspace without them loads with the defaults (code, names). The plan decides whether that
needs a `WORKSPACE_VERSION` bump or only a tolerant parse.

### §5.2 Folding and chips

A node that spans more than one line gets a `▸`/`▾` gutter disclosure, the only glyph pair the
umbrella's rule 2 lets disclose.

- **The automatic policy**: the path from the root to the next redex is always open; any other subterm
  over 200 nodes starts folded, drawn as its head and a count — `(λm n. … 312 nodes)`.
- **Overrides**: a fold or unfold the user makes is keyed by the node's path. A step rewrites only its
  redex's own subtree, so stepping by one drops the overrides under that step's contractum path and
  keeps every other. Across a jump of several steps the view does not know the intermediate redexes, so
  it keeps any override whose path still resolves, even where the subterm there has changed; that is a
  display imprecision this spec accepts rather than a replay it pays for. "Reset folds" in `⋯` clears
  them all, and so do a new compile and a rebind to another session (amendment 5).
- **Chips are folds with a label.** `λf. λx. fⁿ x` shows as `n̄` when its two binders' raw hints are `f`
  and `x`; `λt. λf. t` and `λt. λf. f` show as `true` and `false` when the hints are `t` and `f`.
  Anything else is a plain λ. A chip opens on click or Enter, like any fold. A hint's trailing digits
  are ignored (amendment 4), so a copy's re-parsed `x0` reads as `x`; a hand-written λ copy that names
  its binders `f x` gets chips too, which is the intent.

### §5.3 Marks and following

- **next redex** (new) and **contractum** (today's `is-redex`, renamed to say what it marks), each with a
  shape as well as a colour, per part 1's rule: the redex outlined, the contractum underlined.
- **Follow redex**: the view scrolls to keep the next redex in sight, and a user scroll detaches it, as
  do keys that scroll, a term map pick and a pin's first scroll (amendment 7); a "follow redex" header
  action re-attaches. It is `state-table.ts`'s `Follow`, reused, not copied.

### §5.4 Linking at every step

Every node carries a link `NodeId` or none (§4.3): path links at step 0, owner tags at every step. So a
source click marks **every node that carries that construct at the current step** and scrolls to the
first, and a click on a λ row links from its nearest ancestor-or-self that carries one — the innermost,
as `nodeAtLambda` answers today. At step 0 that reaches every construct the link window reaches; at a
later step it reaches the tagged ones, where today it reaches none.

The step-0 link window goes: `lambda-window.ts`, the link-window mode in `lambda-pane.ts`, and its
wiring in `link-wiring.ts` and `spans.ts`. The λ half of the link status changes with it: *not at step
0* and *truncated* have no producer any more, and a construct with no node at the displayed step reads
"this construct has no node in the λ term at this step". The running focus does not mark the λ view by
owner (amendment 2 above); the source editor's focus marks are unchanged.

### §5.5 Hidden views

A view that is not connected — one in an unselected Stage tab — requests no tree and is not handed a
compile's machine; it is seeded when shown. The replies that write only text — `tm-value`, and a copy's
`no-session` and `worker-error` — still reach it (amendment 7). This closes 2b's "`replies.ts` paints
disconnected panes", left for this part.

### §5.6 Keyboard and assistive tech

One tab stop per view body, with a roving row cursor: ↑/↓ move between rows, ← folds and → unfolds.
Both layouts are `role="tree"` with `aria-level` and `aria-expanded` on their rows (amendment 6); the
body's `data-layout` names the layout. The redex, contractum and linked rows carry visually hidden text
naming the mark, so the λ view's new marks do not add instances to the colour-carried class the
accessibility list's item 7 files.

## §6 4a — the term map

A collapsible panel named **term map**, closed by default, with an *icicle | minimap* switch among its
header actions. Its mode persists per view like the layout.

- **icicle**: one row per depth level, each node as wide as its size. It shows the term's shape — long
  spines, large arguments, numerals — and it does not change with the view's layout.
- **minimap**: every line of the current layout drawn at 2 px with its indentation, like an editor's
  minimap. It follows the layout.

Both draw on a canvas and mark the next redex, the contractum, linked nodes and the view's visible
window. A click scrolls the view to that node, opening folds on its path.

## §7 4b — what the core adds for TM

- **`SourceMap::tm_instr(name) -> Option<usize>`**, kept from the `state_origins` `SourceMap::build`
  already reads, keyed by state name exactly as `tm_owner` is.
- **`StateView.instr: number | null`** and **`TmProgram.listing: string[]`**, one printed asm
  instruction per `prog.code` index, printed by the code `print_asm` already uses for one line; the plan
  names the function. Both are
  sent once per compile, as `TmProgram` is today.

**Grouping has three tiers, chosen per machine:**

1. **by instruction**, when `instr` is present — a compiled program;
2. **by the first dotted segment of the state name**, when it is absent — a TM copy, a reduced file;
3. **none**, when the names carry no dots either. The diagram then offers the local level only, and
   the program item is *disabled with its reason stated*, per the umbrella's rule 4.

`state_origins` bills a `call`'s frame push to that `call`, because the push is built inside its arm of
the per-instruction loop. The shared return handler — frame restore and return dispatch — is built
before that loop, and it and `overflow` are billed to no instruction; they are grouped by their first
name segment in every tier.

## §8 4b — the state diagram

A collapsible panel named **state diagram**, beside the rules panel, with a *program | local* switch
among its header actions.

- **Program level**: one row per instruction, in listing order, with its state count —
  `pc4 cmpeq r1, r2, r3 · N states`.
  Fall-throughs are short arrows, jumps and calls are arcs, and runtime routines sit in a side column.
  Edges into `overflow` collapse into a ⚠ badge on their row. The current instruction opens to show its
  sub-steps — the second name segment, `m1 z1 pk m2 …` — with the current one highlighted, and a "show
  states" action that switches to the local level.
- **Local level**: the current state and every state within 2 rules, in columns by forward distance,
  self-loops drawn. An edge label names only the tapes its rule touches, by tape name — `reg:1 L` for
  "on `reg` read 1, move left" — and the next rule's edge is marked.

Both follow the running state. Per frame only highlight classes change; the local level re-lays out
when the state changes, and it is small (§2.3). A click links exactly as a rule-table click does. Nodes
are reached through one tab stop and a roving cursor. The program level grows with instruction count,
one row each, so a large program is a taller scroll, not a denser picture.

## §9 4b — the rule table, tapes and accessibility

### §9.1 Sizing

A view's open panels share its height through flex rather than the rule table's `max-height: 40vh`:
the rules panel takes two shares and the diagram one, each with a minimum height, and a collapsed panel
keeps only its header. `draw()` already measures `#tableHost.clientHeight`, so the virtual window's
arithmetic does not change. This closes 2a's "the TM rules panel's viewport-relative height".

### §9.2 The grid (accessibility item 3)

The table becomes `role="grid"`, with `aria-rowcount` set to the full row total from `StateIndex`, and
each rendered row carries its `aria-rowindex`. The grid is one tab stop; ↑/↓, PgUp/PgDn and Home/End
move an **active row by index**, the window scrolls so that row is rendered, and
`aria-activedescendant` names it. Enter on a row does what a click does. The active row is designed
against the index, as item 3 asks, never against the rendered window.

### §9.3 Current state, next rule and head (accessibility item 4)

- The current state's header row carries `aria-current="step"`; the next rule's row carries visually
  hidden text, "fires next". The mark's user-facing name changes from *firing* to **next rule**, since
  that is what `TmState.rule` is (§2.2).
- Each tape row becomes a labelled group — "tape reg, head at cell 12, reading 1".
- **Nothing is announced per step.** At 5,000 steps a second a live region is noise; the current state,
  next rule and head are reachable on demand instead. This is a decision, recorded so part 7 does not
  re-file it.

## §10 When things fail

Each failure leaves a working view and at most one notice.

- **A term over the node budget**: the flat text view, with a notice naming the node count (§4.5).
- **A tree reply for a step the view has left**: shown dimmed as stale, with `aria-busy` and no notice,
  until this step's tree arrives (amendment 7); during play it is normal.
- **A tree the view cannot lay out**: its frame's text, with one note saying so (amendment 7).
- **The session worker dies**: the existing path handles it; a tree request in flight gets no answer.
- **A machine with neither an instruction map nor dotted names**: the local level only, the program
  item disabled with its reason (§7).

## §11 Testing

1. **Rust oracles over the corpus**, each run at every step of every program:
   - the tree's *next redex* equals the path the next `LambdaCursor::next` records, and its
     *contractum* equals `last_redex()`;
   - a tree built from checkpoint replay equals one built by stepping directly from step 0;
   - the display names equal the names `print_lambda_capped` prints;
   - `tm_instr` agrees with `state_origins` for every state.
2. **Node tests** of the pure functions: code and outline line layout from an arena; chip detection by
   hint; the fold policy, and an override surviving a step outside the redex and dropping inside it;
   icicle geometry; the grid's index arithmetic; the three grouping tiers; the local level's layering.
3. **Browser tests**: `fact(3)` draws in both layouts; follow redex detaches and re-attaches; keyboard
   folding; a source click at step *k* marks owned λ nodes; a term-map click scrolls the view; the
   grid's keys move the active row by index past the rendered window; the diagram follows the running
   state. Panel sizing is asserted as **geometry and computed style**, not `textContent`.
4. **Each key test is sabotaged once** and the sabotage recorded, per the repository's practice: a test
   that cannot be shown to fail has not been shown to test anything.
5. **A `REDEXTAPE_PROBE`-tier cost probe** for tree requests during play, beside `frame-cost.test.ts`.

Per the umbrella's §8, there are no pixel baselines; each roadmap entry records a manual check across
the three presets in light and dark.

## §12 Delivery

- **4a** — core arena and checkpoints → wasm and protocol → the two layouts → folding, chips and the
  toggle → marks, follow and linking, with the link window deleted → the term map → hidden views.
  Roughly 15–18 commits.
- **4b** — `tm_instr` and `listing` → panel sizing and the grid → tape labelling → the program level →
  the local level and the switch. Roughly 10–12 commits.

Each is its own branch, plan, PR and roadmap entry, and each plan builds every task's end state before
dispatching, per the repository's practice for plan code.

## §13 Out of scope

- **Nested boxes**, the third λ layout (§3, row 3): every λ a bordered box headed by its binders, an
  application's parts side by side. Recorded as a candidate for a later part, with the other two
  layouts' shared arena as its data source.
- **Tromp diagrams** (umbrella §10). The icicle is a step toward that kind of view, not the view.
- **Announcing every step** (§9.3).
- **Source-view changes** beyond the link marks §5.4 requires.
- **Which rule just fired.** `TmState` reports the rule about to fire, and this part relabels the mark
  rather than adding a second one.

## §14 Figures, and what produced them

### §14.1 Table

| Value | What | Produced by |
|---|---|---|
| 1,199 and 2,816 | states and rules in `fact(3)`'s machine | `redextape --no-config emit fact3.rxt --lang tm`, then `grep -c '^state '` and `grep -cE '^\s+\['` |
| 540 | characters in `fact(3)`'s initial λ term | `emit fact3.rxt --lang lambda \| tr -d '\n' \| wc -m` |
| §2.3's first table | per-step nodes, printed bytes, depth, and the sum of whole-term prints | `term_sizes` (§14.2) on the six corpus files |
| 19,894 and 210,973 | nodes retained across every step, `fact(3)` and `fact(4)` | `term_retain` (§14.2) |
| 0.95–1.03 ms and 12.8–12.9 ms | whole-run re-reduction, `fact(3)` and `fact(4)`, three runs | `term_retain` (§14.2) |
| 5, 4 | median states within 2 rules either way, and within 3 forward | `tm_neighbourhood` (§14.2) on `fact3`, `map_fold`, `while4` |
| 1,190 of 1,199 over 18,574 | states `fact(3)`'s run visits, and its TM steps | `tm_neighbourhood` (§14.2) |
| 46 / 60, 38 / 44, 221 / 309 | first-segment groups / inter-group edges for `fact3`, `while4`, `map_fold` | the `awk` in §14.3 over each `emit --lang tm` |
| 14, 244, 274 | `fact(3)`'s `tm_owner` constructs, unowned states, largest construct | `tm_neighbourhood` (§14.2) |
| 17 / 17 / 7, 66 / 66 / 24, 21 / 21 / 9 | source constructs / reached by a step-0 path / carried by an `App` tag at step 0, for `fact3`, `map_fold`, `while4` | `link_coverage` (§14.2) |
| 5,000,000 | `MAX_REDUCTION_STEPS` | `crates/redextape-core/src/lambda/reduce.rs` |
| 512, 32 MiB | `FRAME_BYTES`, `HISTORY_BYTES` | `web/src/protocol.ts` |
| 127,881 | rows in `list60`'s rule table | the roadmap's accessibility item 3 |

All measured on 2026-09-23 against `c9b6876`, natively in release, each probe under
`systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0`, with `CARGO_TARGET_DIR` outside the
repository.

### §14.2 The probes

A throwaway crate, `part4-probes`, depending on `redextape-core` by path, with one binary per probe.
Its corpus is six files: `fact3.rxt` and `fact4.rxt` (`fn fact(n) { if n == 0 { 1 } else { n *
fact(n - 1) } }` then `fact(3)` / `fact(4)`), `is_even.rxt` (mutual recursion, `is_even(6)`),
`map_fold.rxt` and `while4.rxt` (`frame_cost_probe.rs`'s programs of those names), and `sample.rxt`
(`let x = 40; x + 2`). Every λ probe lowers through `parser::parse`, `typeck::typecheck`,
`desugar_mapped` and `lambda::lower`, and steps a `LambdaCursor` at `MAX_REDUCTION_STEPS`.

- **`term_sizes`**: at every step, `logical_size(term)`, `term.depth()`, and the byte length of
  `LambdaState::render(cursor, 4 MiB, MAX_TERM_DEPTH).text`; prints min / median / p90 / max of each
  and the sum of the print lengths.
- **`term_retain`**: at every step, walks the term and counts each `Rc<Node>` allocation the first time
  it is seen (by the address `term.node()` returns), keeping a clone of every step's term so none is
  freed; then times a fresh cursor stepping from step 0 to the end.
- **`tm_neighbourhood`**: builds the `SourceMap` and runs `run_tm_described` at unary, as
  `frame_cost_probe.rs`'s `compile` does; counts states per `tm_owner`; then steps a `TmCursor` to the
  end and, at every 7th step, counts the states within 2 rules in either direction and within 2 and 3
  rules forward of the current state, by breadth-first search over the rule graph.
- **`link_coverage`**: builds the map with `SourceMap::build_from_program` at unary; counts the
  constructs in `node_to_source`, those of them with a `node_to_lambda` path, and those carried as an
  `App` owner tag anywhere in the step-0 term (and, stepping to the end, at any later step — the same
  set on all five files, since tags are inherited and never minted).
- **`redex_paths`**: steps to a given step and prints `last_redex()`, steps once more and prints the
  new `last_redex()`, and prints the full term. It produced the mockups' data, and no figure here.

### §14.3 The grouping `awk`

```sh
redextape --no-config emit PROGRAM.rxt --lang tm | awk '
/^state /  { s = $2; sub(/:$/, "", s); g = s; sub(/\..*/, "", g); groups[g]++ }
/^\s+\[/   { e[s " " $NF] = 1 }
END {
  for (k in e) { split(k, a, " "); ga = a[1]; sub(/\..*/, "", ga); gb = a[2]; sub(/\..*/, "", gb)
                 if (ga != gb) ge[ga " " gb] = 1 }
  for (g in groups) ng++; for (k in ge) ne++
  print ng " groups, " ne " inter-group edges"
}'
```
