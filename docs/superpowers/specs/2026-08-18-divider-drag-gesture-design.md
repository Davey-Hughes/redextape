# The divider drag is a gesture — design

**Slice:** `divider-drag-gesture`, filed against the roadmap's standing item *"the per-frame layout
write on `pointermove`"* (5d-ii-d's close, carried unchanged by every entry since).

**One-line statement of what this is:** the roadmap filed a performance concern; measurement says the
divider drag does not work at all, and the per-frame write is the second-largest of three wasteful
things sitting next to the cause.

---

## §1 The defect, measured before it was designed against

A probe mounted the app through `main()` in Chromium, grabbed the first divider and dispatched a
`pointerdown` followed by successive `pointermove`s. Verbatim:

```
sizes before:                        [0.5, 0.5]
after pointerdown, divider in DOM:   true
after move #1 (+40px), in DOM:       false
  sizes:                             [0.5966, 0.4034]     (40/414 = one step, correctly converted)
after move #2 (+80px total):         [0.5966, 0.4034]     unchanged
live divider is the node we grabbed: false
  after move #3 at the LIVE divider: [0.5966, 0.4034]     unchanged
```

**A drag moves exactly one `pointermove`'s worth and then dies.** To resize a pane a user would have to
press, twitch, release, and repeat.

**The mechanism.** `divider`'s `pointermove` calls `onResize`, whose caller is `pane-host.ts`'s
`applyLayout` → `renderLayout` → `root.replaceChildren()`. That destroys the divider element holding the
drag, on the drag's own first frame. The replacement element built in its place has `dragging = false` in
its own closure, so every later frame hits `if (!dragging) return`. Explicit pointer capture does not
save it: capture is released implicitly when the captured element leaves the document.

**This is not an artefact of synthetic events.** `root.contains(d) === false` after `replaceChildren()`
is deterministic DOM behaviour, and the fresh closure's `dragging` is `false` by construction. The probe
dispatched move #3 at the *live* divider as well as at the grabbed one; neither moved anything.

**Why every slice since walked past it.** `layout-view.test.ts`'s drag test is the only one, and its
`onResize` is a stub that pushes to an array — it never re-renders, so the divider it grabbed stays
alive for the whole test. 5d-ii-a's closing entry filed the gap in words: *"no test drags a divider on a
tree `main()` mounted and then reads back what was stored."* Nobody closed it, and 5d-ii-b, 5d-ii-c,
5d-ii-d and plan5d-iv each carried the sentence forward untouched.

**The filed item's proposed fix would not have worked.** It reads: *"The fix is a commit-on-`pointerup`
or a debounce."* The `pointerup` half is right. The debounce half addresses only the storage write, while
`renderLayout` keeps destroying the divider at whatever rate it is called.

## §2 What actually runs per frame today

Three things, of which one is necessary:

| per `pointermove` | necessary during a resize? |
| --- | --- |
| `renderLayout` — `replaceChildren()`, full box + divider rebuild, focus rescue | no, and it is the defect |
| `serializeLayout` + synchronous `localStorage.setItem` | no — the roadmap's filed item |
| `draw()` — a full app frame, every pane re-rendered | **yes**, see §6 |

Nothing structural changes during a resize. `resize` touches `sizes` on exactly one split node
(`layout.ts`: *"ONLY THE TWO NEIGHBOURS MOVE"*), so no pane is created, destroyed, rebound or
re-rendered as a *consequence* of the tree changing. Pane creation, custody reconciliation and the
storage write are all provably unnecessary work on this path.

## §3 The fix: a gesture has frames and an end

A resize gesture — a pointer drag, or a held arrow key — gets a cheap per-frame path and exactly one
commit when it ends.

**Per frame:** `setTree(resize(...))` → `syncSizes(root, tree)` → `draw()`.

**On gesture end:** one `applyLayout()`, which rebuilds, serialises and writes once.

No element is created or destroyed mid-gesture, so the divider survives, capture holds, and the drag
tracks the pointer for its whole length. The model is still updated on every frame, which is what keeps
`MIN_PANE_FRACTION` clamping and `aria-valuenow` correct with no logic duplicated anywhere.

## §4 `syncSizes(root, tree)`

A new export in `layout-view.ts`, sited immediately beside `build` so the two cannot drift on how the
DOM interleaves panes and dividers. It walks the live box tree against the model and writes, for each
split node:

- `flex` on each model child, at DOM child index `i * 2`
- `aria-valuenow` on each divider, at DOM child index `i * 2 + 1`

**The `aria-valuenow` write is load-bearing, not a courtesy.** `divider()` sets it once at build time
from the `size` it is handed, and it stays truthful today only because the whole tree is rebuilt after
every resize. Stop rebuilding without adding this write and the attribute silently freezes at whatever
the divider was born with — a regression in the one part of the layout subsystem that was deliberately
exempted from Plan 5's deferred accessibility pass (`layout-view.ts`'s own header: *"DIVIDERS ARE
KEYBOARD-OPERABLE, WHICH IS A DELIBERATE EXCEPTION"*).

**A DOM/model shape mismatch throws rather than repairs.** It means a caller took the cheap path when a
rebuild was required, which is a programming error and not a state to paper over. This follows
`LambdaPane.receiveEditor`'s precedent and its stated reason: a silent repair absorbs the finding as
normal operation.

## §5 Interface: two named callbacks, not a positional phase flag

`renderLayout`'s fourth positional parameter changes from `onResize` to an object `{ resize, commit }`.

- `resize(path, index, delta)` — the model should change by `delta`, cheaply. Unchanged signature.
- `commit()` — the gesture is over; reconcile and persist.

`divider()` needs both regardless, and a fourth positional callback followed by a fifth reads worse at
every call site than one named pair. Rejected alternative: `resize(path, index, delta, phase)` — a
boolean-ish trailing argument that every caller has to decode.

## §6 `draw()` stays on the per-frame path, and the reason is measured

The TM pane's δ-table is virtualized. `visibleWindow` is computed against `this.#tableHost.clientHeight`
— a *measured* viewport height — and only `draw()` recomputes it. Drop `draw()` from the per-frame path
and dragging a pane taller shows blank space below the last rendered row for the length of the drag,
snapping right on release.

So `draw()` is kept per frame. It is the one item in §2's table whose output genuinely depends on pane
size.

**The general form of this bug is filed, not fixed here.** There is no `ResizeObserver` anywhere in this
app (`grep -rn ResizeObserver src/` finds nothing), so a plain window resize leaves the virtual window
stale too, until something else happens to redraw. Fixing that is a different slice: it changes when
every pane redraws, not when a gesture commits.

## §7 A gesture that moved nothing commits nothing

`divider()` tracks whether any `resize` fired between `pointerdown` and `pointerup`. A bare click on a
divider skips the commit rather than firing a full reconcile-and-write for a no-op.

## §8 The keyboard path takes the identical shape

`keydown` calls `resize`; `keyup` calls `commit`. Auto-repeat sends many `keydown`s and exactly one
`keyup`, so a held arrow key becomes N cheap frames and one storage write instead of N full rebuilds.
`blur` also commits, so a layout is not lost when focus leaves while a key is held.

**CORRECTED DURING IMPLEMENTATION — THIS SECTION ORIGINALLY CLAIMED THE KEYBOARD PATH STOPS EXERCISING
`renderLayout`'S FOCUS RESCUE, AND THAT IS FALSE.** The claim is left visible rather than quietly
rewritten, because it is the kind of error the rest of this document is about: a design statement that
sounded right and was never checked against the call graph. `commit` is wired to `applyLayout()`, and
`applyLayout` calls `renderLayout` unconditionally in its `finally` block — so a resize gesture's commit
rebuilds the tree exactly as `split` and `close` do. The focused divider IS destroyed at that moment, and
the rescue is what puts focus back on its replacement.

**What actually changes is the RATE, not the fact.** A resize used to rebuild once per frame; it now
rebuilds once per gesture, at the commit. The rescue stays load-bearing for arrow-key resize, and for
drags, and for every structural change. Its doc comment still needs repair — it justifies itself with
*"`onResize`'s caller re-renders after every resize, which is the natural way to reflect one"*, and
"after every resize" is what stopped being true — but the repair is a narrower one than §12 first
described, and §12 is corrected to match.

## §9 `MIN_PANE_FRACTION`: measure it, and change only the number

`layout.ts`'s `MIN_PANE_FRACTION` doc says the floor is a guess, in as many words: *"0.1 IS A CHOICE,
NOT A MEASUREMENT ... Nothing was measured to pick it; if a pane turns out to be unusable at the floor,
the number moves."* Nobody could check whether it is usable, because driving a pane to the floor requires
a drag that works. Now one will.

**The measurement:** drive each pane kind to the floor at a realistic window width and record whether it
is usable there. If 0.1 is wrong, the constant moves and the entry says what the reading was.

**The boundary, stated so it is argued with rather than discovered:** this slice does not change the
floor from a fraction to a pixel count, even if the measurement argues for one. A fraction is wrong in
both directions — roughly 90px at a 900px window, roughly 344px on a 3440px ultrawide — and that may
well be the real finding. But the constant's own doc chose the shape deliberately and gave a reason: *"A
FRACTION RATHER THAN A PIXEL COUNT, so this module needs no element measurements and stays
node-testable."* Changing the *kind* of the floor changes the layout model and costs `layout.ts` its node
tier. It gets filed with the reading behind it, not slipped into a gesture fix.

## §10 Reload

Carried forward from 5d-ii-a by three slices: whether a dragged layout survives a reload. The regression
test already reads `localStorage` back, so this costs one more step — `remountApp()`, then assert the
dragged sizes return. `tm-buffer-restore.test.ts`'s cache-busting `?remount=N` idiom is the mechanism and
is documented at length in that file; no new machinery.

## §11 Tests

**`layout-view.test.ts` (browser tier), for `syncSizes` in isolation:**

1. moves `flex` on both neighbours of the addressed divider and leaves every other child alone
2. updates `aria-valuenow` on the divider
3. the divider node's identity survives — the same element object, not an equal one

**A new browser file, for the gesture through `main()` — the test 5d-ii-a said did not exist:**

4. the grabbed divider is still in the DOM after *every* `pointermove` — the direct guard on §1
5. sizes track the full drag distance, not one frame of it
6. `localStorage.setItem` fires exactly once per gesture (spied), and not at all mid-drag
7. the keyboard equivalent: N `keydown`s then one `keyup` → sizes moved `N * KEY_STEP`, one write
8. a `pointerdown`/`pointerup` with no movement writes nothing
9. drag → release → `remountApp()` → the dragged sizes come back (§10)

Test 4 is the one that fails against the current source. It is written and seen to fail before the fix,
per this repo's convention that a defect is reproduced rather than reasoned about.

## §12 Two doc repairs

**`renderLayout`'s focus-rescue comment** justifies itself with a sentence whose *"after every resize"*
this slice makes false — a resize now rebuilds once per gesture rather than once per frame. It is
repaired in place, because it is live argument about why the rescue exists rather than a retracted claim.
**The repair must not overstate itself**, which is the trap this document fell into at §8: the rescue is
still exercised by every resize gesture's own commit, not merely by `split`, `close` and `reset layout`.
A comment claiming a resize no longer rebuilds would be a new false statement replacing an old one.

**The roadmap's filed item characterises this as a performance concern.** Per the web-doc-history
convention — *"correcting history to match the present is worse than leaving it, because a dated entry
that has been edited to agree with today teaches the next reader nothing about how the belief changed"* —
5d-ii-d's entry is left exactly as it stands. The correction is made forward, in this slice's closing
entry, where it is visible as a correction.

## §13 Rejected approaches

**The DOM leads and the model commits at `pointerup`.** `pointermove` writes `flex-grow` on the two
neighbours against a locally accumulated delta; the model is untouched until release. Fewer moving parts
in `pane-host.ts` — and it forces `layout-view.ts` to reimplement `resize`'s `MIN_PANE_FRACTION` clamp in
pixels, or the user drags past a floor the commit then silently enforces. Two places computing one thing
is the defect class this repo has filed repeatedly. `aria-valuenow` would also be stale for the whole
gesture rather than for none of it.

**rAF-coalesce the existing path and debounce the write.** This is half of what the roadmap's own filed
item recommends, and it fixes nothing: `requestAnimationFrame` still calls `renderLayout`, still calls
`replaceChildren()`, still destroys the divider — at precisely the rate a pointer drag already produces.
Recorded here because the filed item recommends it and the next reader deserves to know it was tried
against the measurement rather than skipped.
