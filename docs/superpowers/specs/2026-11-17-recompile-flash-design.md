# Recompile flash — short design

## Intent

Davey, 2026-11-17: "after the program recompiles, there's a bit of a flash as the panels are rebuilt, can we eliminate
that?" Shown three options by the controller (swap in one frame; the same plus dimming while an edit waits; hold every
view until all are ready), he chose the first, "Swap in one frame". The option's description is the controller's text:
"The worker sends each view's step-0 picture together with 'compiled', and the page switches every view to the new
program in a single frame. No blank frame and no jump."

## The cause

At each recompile captured on `main` (a typed edit, an example, the encoding, an example's undo and a shared link's open
in the Explorer preset; a typed edit and an example in Debugger) the page painted at least one frame of empty views
between the old program's last picture and the new one's step 0:

- `replies.ts`'s `compiled` arm called `resetLegs` (`sessions.ts`), which empties every leg's ring, then `draw()`.
  Each pane rendered `null`: the TM view lost its status line and tape rows, so its rules panel and state diagram
  moved up; the rxm registers, call stack and heap emptied; in Explorer the rxm and TM step lines read `not run`
  (at the encoding change the λ one too, and at a shared link's open TM's, the only one shown), and Debugger's one
  step line never did.
- The worker posted `compiled` before it recorded anything, then recorded λ, rxm and TM in turn, each to its end. A
  leg's first frames came with its first `frames` chunk, so TM's waited behind λ's whole first recording.
- The λ view asks for a step's tree only once its ring has that step, and `LambdaTrees` keys trees by generation, so
  until the `lambda-tree` reply it drew the term as flat text (`… truncated`), or nothing.

## The protocol change

`compiled` carries every leg's step-0 picture:

- `first`: each leg's step-0 frame, read by the same `frame` call the record loop uses and counted against the leg's
  allowance as the loop counts it; `null` for a leg that did not compile.
- `lambdaTree`: the λ term's step-0 tree at `LAMBDA_TREE_NODES`, as a λ view would ask for it; `null` when the λ leg
  did not compile. Its columns are transferred, as `lambda-tree`'s are.

The worker then records each leg from step 1 (`record-loop.ts`'s `recordBuild`), so no step is sent twice. The page's
`compiled` arm resets the legs, puts each step-0 frame in its ring, seeds the tree cache with the step-0 tree under the
new generation, and draws once: every view goes from the old program's picture to the new one's step 0 in one frame.

A copy's build reply does the same for its one leg: `scratch-compiled`, `tm-scratch-compiled` and
`rxm-scratch-compiled` carry `first`, the copy's step-0 frame, and `scratch-compiled` carries `lambdaTree` too
(`copy-build.ts`'s `buildCopy` reads the frame with `record-loop.ts`'s `firstFrame` and records on from step 1). Each
copy arm of `onScratchReply` puts the frame in the copy's ring, and a λ copy's tree in the cache, before its one draw.

## Calls made in the build (mine, not Davey's)

- **On `compiled` itself, not in replies after it.** Each message from a worker is its own task, and a browser may
  paint between two tasks, so a page told in two messages would still need to hold the first until the second came.
  One message gives one draw.
- **λ's tree is sent whether or not a λ view is open.** It is what an open λ view asks for at once, it is bounded by
  `LAMBDA_TREE_NODES`, and sending it always keeps which views are shown out of the `run` request.
- **A leg whose recording waits behind another's** (TM behind λ and rxm) reads `step 0 of 0…` from `compiled`, where
  it read `not run`; ⏭ is off until its first chunk gives it a newer step. `step-focus-recording.test.ts` waits for
  that chunk, not the `…` alone, before it clicks ⏭.
- **A leg whose run ends at step 0** (it halts, refuses or overflows there) shows step 0 from `compiled` and its end
  from its first chunk, an empty one that carries only the end; its settled view is unchanged.
- **A shared link with positions** shows each view's step 0 until the chunk holding its position arrives (TM's after
  the λ and rxm recordings), where it showed an empty view before. **A position of step 0 is spent at `compiled`**
  (`share-positions.ts`), since the reply has put step 0 in the ring, where the run opens: held, the TM step line read
  `step 0 of 0… — going to step 0 from the link` until TM's first chunk, which in Firefox wrapped the TM view's header
  and moved its panels. A position past step 0: see review 1's I2 below.
- **Unchanged:** a compile that fails (`no-session`), a worker error, and the strip and readout, which keep the old
  run's values, dimmed, until the new `result`.

## Review 1's fixes (the controller's calls, with mine where it left one to me)

- **↺ on a view waiting for its first chunk stays on step 0** (I1). The ring holds the one step 0 `compiled` carried,
  so ↺ is live there where the empty ring had it off, and `History.seek(0)` on a ring of one frame turned following on:
  every chunk after the press carried the view to the newest step. ↺ now seeks with `History.toStart`, which never
  follows, so a press of ↺ leaves the view on step 0 as it does on any ring. The controller's call: ↺ leaves the view
  at step 0, not following; mine: a method of its own rather than a change to `seek`, whose following onto the newest
  frame ⏭ and the link's positions use.
- **No panel moves while a shared link's view waits for its first chunk** (I2). With every view past step 0 in the
  link, the step line read `step 0 of 0… — going to step 3 from the link` from `compiled` until the view's first chunk,
  and in Firefox at 1600 px that line wrapped the TM view's header and moved its rules panel down and back. The
  controller left the way to me; mine: **the line leaves the link's tail off while the leg's ring holds only the step 0
  `compiled` carried and its recording has said nothing**, so it reads `step 0 of 0…`, no longer than the settled line
  it turns into, and the tail comes with the first chunk (`controls.ts`'s `controlState`). Reserving the room in the
  header instead would change the header's layout for every view at every step, which is the open TM header-wrap item.
  A position past the first chunk (past step `RECORD_CHUNK`) still shows the tail from the first chunk on, as on
  `main`, and a header that wraps under it still moves its panels: that is the header-wrap item, left open.
- **A copy's edit swaps in one frame too** (I3). The controller's call: copies are in scope, because "The user asked for
  the flash after a recompile to go, and a copy's edit is a recompile" (the brief's second addendum). It replaces this
  document's earlier note that the brief's triggers do not reach the copies' builds. The protocol is the program's,
  per leg (above).
- **`test:probe:record`'s pins** (M1): its tally now counts the step 0 a build or copy reply carries with the leg's
  chunks, so the pinned frames are a leg's whole recording for a build and a copy alike, and are what (h)'s replayed
  rings hold; the pins are unchanged.

## A TM copy's value line keeps its room (the controller's call, with mine where it left one to me)

A headered TM copy's line (`value: …`) is emptied by `tm-scratch-compiled` and filled again by the value run's first
`tm-value`, which the worker posts only after the copy's whole first recording. Through that recording the empty line
took no room and the rules panel stood one line higher (`recompile-swap.test.ts`, the TM copy case, Chromium at
1600 px: 487, then 459, then 487 px from the view's top).

- **The controller's call: the line keeps its room while it waits, its settled height, empty**, with no new wording:
  the smallest visible change. The controller applied here what Davey said of the page's banners on 2026-11-17:
  "I don't want anything like this that shifts the page unexpectedly".
- **Mine: the room follows the build, not the reading.** A pane showing a copy whose build made a value run
  (`TmScratchStatus.header`, true exactly when the file has a header, which is when `tmScratch` makes one, so a
  `tm-value` will come) gives the line one line's room (`min-height: 1lh`) and its margin, whether a reading is in or
  not: through the wait after a build, and after a `no-session` that drops a run still going. A file with no header,
  and a pane showing the program rather than a copy, keep the empty line at no height, as before. Keeping the
  previous reading's exact height instead would need a layout read in the reply's draw and would still move the panel
  whenever the new value's line count differs.

## Not changed, reported

- **↺ on a view whose step 0 was dropped (`rewindLeg`) still empties the leg's ring** until the rewound recording's
  first chunk. That wait is designed (hidden-recording spec §6) and held by `restart-rewind.test.ts`: the step line
  reads `step 0 of 0…`, ⏸ is off and ↺ waits greyed with the focus. Keeping the old picture through it would change
  that designed state, so it is left for Davey to decide.
- **A view's header that wraps as its step line grows** (the TM header wrap item) can still move its body once at the
  swap: in the Explorer preset at 1600 px, the λ view's line `step 0 of 0…` fits on the header row and the recorded
  line after the first λ chunk wraps it, for one frame of the example capture. The same capture on `main` shows the
  same one-frame move, the unwrapped line there reading `step 0 of 768…`.
- **A TM copy's value that wraps onto more than one line** still grows the line by the extra lines when it arrives,
  and the line is back to one line's room at the next build, so the panels below move by those lines. The room kept
  is one line's.

## Verification

- `tests/browser/recompile-swap.test.ts`, in the `browser` and `firefox` projects: a typed edit, the encoding, an
  example, the example's undo, a shared link's open with every view at step 3, and an edit in a λ, an rxm and a TM
  copy's editor, with the worker's replies handed to the page one a frame apart and every frame sampled; and ↺ pressed
  on the TM view while it waits for its first chunk. The TM copy case holds the copy's rules panel still through the
  wait for its value run's first reading.
- `tests/browser/tm-pane-editor.test.ts`: a headered copy's empty value line keeps the room its value takes, and a
  file with no header's empty line takes none.
- `tests/node/record-loop.test.ts` (`recordBuild`), `tests/node/copy-build.test.ts` (a copy's step 0 on its reply),
  `tests/node/replies.test.ts` (the `compiled` arm's and each copy arm's one draw), `tests/node/history.test.ts`
  (`toStart`), `tests/node/controls.test.ts` (the link's tail) and `tests/node/share-positions.test.ts` (step 0 not
  held).
- Frame captures of every trigger in the Explorer preset and two in Debugger, before and after, are kept outside the
  repository with the lane's record.
