# `[continue]` during a recompile — design

**Accessibility list item 8, and only item 8.** The roadmap's deferred-accessibility list (roadmap
§"Accessibility is deferred to one pass at the end of Plan 5") files sixteen items, fourteen open.
This slice takes one of them and leaves the other thirteen where they are. It is not the pass.

The item, as filed:

> **`client.extend()` silently no-ops for the whole debounce.** `supersede()` advances `#gen` at
> dispatch, but the worker's `onExtend` drops any request for a generation it has never seen — so for
> ≥300 ms after any keystroke or encoding change, `▶`-at-the-frontier and `[continue]` do nothing.
> **The click is correctly inert**: the run it would extend is about to be discarded by the imminent
> compile. The defect is the *silence*, and item 1's principle applies directly — a control that
> provably cannot work should not be offered — so the fix is a control-visibility rule, moving
> focus/labelling deliberately, not a second messaging mechanism, which would be worse than the gap.

Every line number and quotation below was read at `d5da8c8`, except where a later baseline is named.

| what | where |
|---|---|
| `awaitingRun`, and the two edges that write it | `web/src/session-client.ts` |
| The repaint at dispatch | `web/src/session-client.ts` (`SessionPool`), `web/src/main.ts` |
| The control rule | `web/src/controls.ts`, `web/src/transport.ts` |
| Where the flag is read | `web/src/sessions.ts` |
| The focus measurement | `web/tests/browser/` (new) |

---

## §1 The window, established rather than assumed

`compile.ts`'s `schedule` claims the generation synchronously and posts 300 ms later:

```ts
const gen = client.supersede()                                        // compile.ts:133
timer = setTimeout(() => client.request(gen, src, picker.value), DEBOUNCE_MS)
```

`SessionClient.extend` addresses `#gen`, which is now the claimed-but-unposted one:

```ts
extend(leg: Leg): void {                                              // session-client.ts:108
  if (this.#gen === 0) return
  this.#port.postMessage({ kind: 'extend', gen: this.#gen, leg })
}
```

and the worker drops it:

```ts
async function onExtend(req): Promise<void> {                         // session-worker.ts:701
  // Deliberate silence: the generation being extended is not the live one anymore …
  if (live?.gen !== req.gen) return
```

**Three call sites open this window, not one.** `compile.ts:133` is the ≥300 ms case the item names.
`scratch.ts:859` (`#spawn`) and `scratch.ts:1001` (`recompile`) supersede and post in adjacent
statements, so their window is one message hop rather than a debounce — the same defect, shorter.
Any fix keyed to `compile.ts` alone would leave two sites carrying it.

## §2 The fact lives on `SessionClient`, as a mirror of the worker's own drop condition

`onExtend` drops when `live?.gen !== req.gen`. The client already computes the matching comparison in
its constructor guard:

```ts
if (this.#gen !== 0 && e.data.gen === this.#gen) onReply(e.data)      // session-client.ts:28
```

So the client needs no new information, only a name for what it already knows:

```ts
#awaitingRun = false

/**
 * Whether a generation has been claimed that no reply has answered yet — which is exactly when the
 * worker's `onExtend` will drop a request addressed to `#gen`.
 */
get awaitingRun(): boolean
```

| edge | where |
|---|---|
| set | `supersede()`, beside the `#gen` bump |
| clear | the constructor's message listener, on a reply whose `gen` matches `#gen`, **before** `onReply` runs |

Clearing before `onReply` is load-bearing: `replies.ts` drives `draw()` off that call, and a repaint
that ran while the flag was still set would paint the withdrawal one frame after the window closed.

**Named `awaitingRun`, not `superseded` and not `pending`.** `superseded` differs from the existing
`supersede()` by one character on the same object. `pending` reads as "a request is in flight", which
is the opposite of the debounce case — during those 300 ms nothing has been posted at all.

### §2.1 It is conservative, not exact, and this is the honest statement of it

The worker sets `live.gen` when it *starts* the run; the first reply follows. In that gap the worker
would accept an extend while the client still reads `awaitingRun`. The gap is a message queued behind
a run already in flight on a single-threaded worker, so nothing is lost — but the flag is **a
superset of the drop condition, not an equality**, and the doc comment says so rather than claiming
the two are the same predicate.

### §2.2 A wedged worker holds the flag set forever, and that is the right answer

If a worker never answers, `awaitingRun` never clears and the control is never offered again for that
session. An extend posted to a wedged worker would not be serviced either, so the withdrawal reports
the true state. Recovery is unchanged and is the header list's retire (design §3.4/§4.4).

## §3 The repaint: one callback, injected at `SessionPool`'s constructor

**At `d5da8c8`, nothing repaints at dispatch.** `compile.ts`'s `schedule` deliberately shed its `draw()`
dependency — its own comment says *"nothing here changes a binding now, so there is nothing for this
path to repaint"*. Without a repaint the flag would first be read when the next reply arrives, which
is the moment the window **closes**: the control would be withdrawn for zero frames.

Three shapes were considered, and the call-site census is what decided between them:

| shape | sites it touches | verdict |
|---|---|---|
| Each of the three supersede sites calls `draw()` | 3 in `src/` | Three sites to keep in step, and a fourth supersede added later silently reopens the defect |
| A required third argument to `SessionClient` and to `SessionPool.bind` | **45** — `git grep -c 'new SessionClient(' d5da8c8 -- web` (20) plus `git grep -c 'pool\.bind(' d5da8c8 -- web` (25) | Rejected — see §3.2 |
| **`SessionPool` takes it once, at construction; `bind` passes it to every client it makes** | **7** — `main.ts:282` and six test pool constructions | Taken |

**The middle row's figure used to read 36, which could not be reproduced.** That number came from
grepping `new ScratchBuffers|pool.bind` across `web/tests` only, then reporting it as this row's
blast radius — a different quantity than the one this row names. Re-measured directly at `d5da8c8`:
`git grep -c 'new SessionClient(' d5da8c8 -- web` gives 20 (1 in `src`, 19 in tests) and
`git grep -c 'pool\.bind(' d5da8c8 -- web` gives 25 (2 in `src`, 23 in tests), 45 combined. The
argument does not change: the true figure is larger, not smaller, so this shape is rejected more
firmly than before, and the decisive reason was never the count anyway but
`web/tests/node/scratch.test.ts`'s two-parameter `pool.bind` interceptor (§3.1).

**The pool is the only route from `src/` to a `SessionClient`**, so a repaint no app site can forget
is bought by requiring one argument at one place. Its constructor is already where injected policy
lives, by its own doc: *"IT IS ALSO WHERE THE FAILURE POLICY LIVES, which is the reason it is a
constructor argument"* — the `error` listener that raises the load-failure banner arrives the same
way, for the same reason.

```
new SessionPool(spawn, onSupersede)      // onSupersede REQUIRED — main.ts:282 plus six test sites
new SessionClient(port, onReply, onSupersede = () => {})   // optional; the pool always supplies it
bind(id, onReply)                        // UNCHANGED
```

### §3.1 `bind`'s signature does not move, and that is the point

`SessionPool.bind` keeps its two parameters. That leaves untouched the 23 `pool.bind` call sites in
the test tiers **and** `web/tests/node/scratch.test.ts:110-111`, which intercepts the method:

```ts
const bind = pool.bind.bind(pool)
pool.bind = (id, onReply) => { … }
```

A required third argument on `bind` would have to be added to that interceptor by hand, and an
interceptor that quietly drops a callback because its arity was not updated is the *same defect this
slice exists to fix*, installed in the harness that tests the fix.

`ScratchBuffers` needs no new config field either, for the same reason: it obtains its client from
`this.#pool.bind(…)` at `scratch.ts:818`, and the pool already carries the callback.

### §3.2 The `SessionClient` argument is optional, and the asymmetry is deliberate

Nineteen test sites construct a `SessionClient` directly — five local `fakeClient()` factories plus
fourteen in `session-client.test.ts` — to exercise the staleness rule, which the file's own doc says
*"does not need a thread to exercise"*. None of them has a repaint to perform. Requiring the argument
there would buy nothing and cost nineteen no-ops.

The client is the mechanism; the pool is where the policy is injected. `awaitingRun` works identically
whether or not the notification is wired, so a directly-constructed client is not a half-built one.

### §3.3 The one wiring site

`main.ts:282` constructs the pool. `draw` is declared `let draw: () => void` at `:259` and is not
assigned until `draw = createDraw({…})` at `:1119`, so the argument must be **a thunk, not `draw`** —
the same hazard the file already documents for `view`, and the same fix. The first supersede is
`compile.schedule(SAMPLE)` at `main.ts:1312`, after the assignment, so the thunk is never called
before it resolves.


## §4 The control rule

### §4.1 `canRecordFurther` takes the flag, so there is still one gate

`controls.ts`'s `canRecordFurther` is documented as *"THE ONE PLACE THIS IS DECIDED"* for whether
extending could achieve anything, and it has two callers — `controlState`, and the frontier `▶`
click handler at `transport.ts:126`. The flag is folded into the gate itself rather than checked only
inside `controlState`:

```ts
export function canRecordFurther(done: RecordEnd | null, awaitingRun: boolean): boolean {
  return !awaitingRun && (done === 'capped' || done === 'budget')
}
```

**Not because the other caller would otherwise misbehave.** An earlier draft of this document claimed
that leaving `awaitingRun` out of `controlState`'s own check would leave the `transport.ts` handler
"posting a doomed extend under its own copy of the rule." That is false, and checkably so — the
handler cannot reach this gate's `awaitingRun` half at all:

1. `on.forward` fires only from a click on the `forward` button, which `pane-chrome.ts`'s
   `controlStrip.update` renders `forward.disabled = !c.canForward`. `button()` in that file attaches
   a plain `addEventListener('click', …)`, and a disabled `<button>` receives no click from a user
   gesture.
2. While `awaitingRun` is true, `canRecordFurther` returns `false`, so `canForward` reduces to
   `v.head < v.length - 1`.
3. `head < length - 1` is exactly the case where `hist.forward()` **succeeds** — so
   `!leg.hist.forward()` short-circuits and the gate's second operand is never evaluated.
4. The repaint that sets the flag is synchronous (`supersede()` → `onSupersede` → `draw()`), so no
   click can land between the transition and the paint.
5. `play()` is the only other `hist.forward()` caller, and it stops at the frontier without posting
   anything.

This was established by reading those five points against the source, not by running anything — the
sabotage aimed at this gate reddens nothing, which is how
the reachability question came to be asked at all. The gate is unreachable through this caller today.
It is kept anyway, for the reason given above: one gate rather than two. A narrower rule here would be
a second opinion about the same question, held correct only by `pane-chrome.ts`'s current rendering
choice rather than by anything `controls.ts` owns.

**Item 1 of the accessibility list is not a case for removing `disabled` here.** Item 1 is about a
control that *hides* itself on click stranding keyboard focus, and its own words are that "the idiom
is right and should survive" — a control that provably cannot work should read as no button at all
rather than a grey one, which is why `raise_cap`'s refusal of `depth_capped` means no button rather
than a disabled one. Read correctly, item 1's principle applied to the frontier `▶` would *hide* an
unusable arrow, not un-disable it — equally unclickable, so no version of that pass makes this call
"the only gate left."

At `ce2ff70` — this shape does not exist at `d5da8c8`, where `canRecordFurther` still took one
argument — `transport.ts`'s `forward` handler resolves
`const entry = sessions.entryOf(slot.binding.session)` once (`transport.ts:126`) and reuses it:
`entry.client.awaitingRun` reaches this gate (`transport.ts:127`) and
`entry.client.extend(slot.binding.leg)` is the call it guards (`transport.ts:128`) — one resolved
entry, not two separate lookups.

### §4.2 `LegView` gains one field, and `controlState` changes in three places

| | at `d5da8c8` | with `awaitingRun` |
|---|---|---|
| `continueLabel` | `capped`/`budget` → a label | `null` — no button |
| `canForward` | `head < length-1 \|\| canRecordFurther(done)` | frontier arm dead; recorded-history arm untouched |
| `stepText` tail | `— history is full` etc. | `— recompiling` |
| `stepText` count | `step 5 of 12…` while `done === null` | `step 5 of 12` — the `…` drops |

The `…` drop is deliberate rather than incidental: `of` renders `…` to mean *this count is not
final*, and for a superseded run it is final — that run will record nothing more whatever the new one
does.

`canBack`, `canPlay` and `canRestart` are untouched. They walk recorded history, which is unaffected
by the window, and the item's own text is that only the frontier operations are inert.

**The word differs from the field name on purpose.** The flag is `awaitingRun` because that is what is
true of the session; the readout says `recompiling` because that is what the user did. They are the
same state described from the two ends.

### §4.3 The `available: false` early return is not touched

`controlState` returns early with every control dead and `stepText: v.reason` when the leg is
unavailable. That covers the app's first compile — `compile.schedule(SAMPLE)` supersedes from
generation 0 with no history and no run — so the boot case never reaches the new code and needs no
special arm.

### §4.4 Where the flag is read

`PaneSlot.render` (`sessions.ts:621`) builds the `LegView`, and already holds both halves it needs:

```ts
controlState({ …, awaitingRun: reg.entryOf(b.session).client.awaitingRun })
```

One line. No plumbing through the pane classes: the flag is per session, `render` has the binding,
and `controls.ts` stays the only module that knows what the flag means for a control.

## §5 The focus half — measured, not assumed

Item 8 invokes item 1 (*"a control that hides itself on click strands the keyboard"*), so this slice
has to answer whether withdrawing `[continue]` strands focus. **The answer is measured, and the
measurement is two halves that must not be confused.**

**Half one — is the mechanism real?** Programmatically focus `[continue]`, set `hidden`, and read
`document.activeElement`. Same for a frontier `▶` going `disabled`. This establishes that the browser
behaves as item 1 recorded.

**Half two — can a user gesture reach it?** Every trigger of the window is itself a focus-bearing
interaction somewhere else, verified by enumerating the call sites at `d5da8c8`:

| trigger | where focus is when it fires |
|---|---|
| source editor update listener | `main.ts:1305` — in the editor |
| encoding picker `change` | `compile.ts:139` — on the `<select>` |
| scratch editor debounce | `transport.ts:342` — in that editor |
| app boot | `main.ts:1312` — no `[continue]` exists yet |
| `scratch.ts`'s `#spawn` (`scratch.ts:859`, `fork`/`forkBlank`/`warm`'s shared path) | not a focus question — `#spawn` sets the entry's status to `available: false` immediately before calling `supersede()`, so `controlState` takes §4.3's early return for that session: neither `[continue]` nor a frontier `▶` renders for it, and there is no control to withdraw |

If half one passes and half two cannot be constructed, **that pair is the finding**: the mechanism is
real, no user path reaches it through this change, and no focus code ships. The roadmap entry records
it, so the next reader of item 8 does not re-derive it. If half two *can* be constructed, the focus
rule lands in this branch and item 1 gains a retired instance.

**What this explicitly does not do** is take item 1's two standing instances — `tm-pane.ts`'s reattach
and `[continue]`'s own click path, which hides the button when a resumed run reports `done === null`.
Both are reachable today, independently of this change, and both stay filed.

## §6 Tests

Each test is paired with the sabotage it forbids, and every sabotage is run.

### §6.1 `web/tests/node/session-client.test.ts`

The file's `ClientPort` interface exists so this needs no thread — its own doc: *"the staleness check
is the only logic in this file and it does not need a thread to exercise"*.

| test | sabotage that must redden it |
|---|---|
| `awaitingRun` is false at construction | initialise the field `true` |
| `supersede()` sets it | drop the write from `supersede` |
| a reply matching `#gen` clears it | drop the write from the listener |
| **a reply for a stale generation does not clear it** | clear unconditionally on any reply, before the guard |

### §6.2 `web/tests/node/controls.test.ts`

One test per row of §4.2's table, plus the `available: false` early return, each with the sabotage
that reverts that row.

### §6.3 `web/tests/browser/` — one new file

1. Run a program to a `budget` stop; assert `[continue]` is present.
2. Type one character into the source editor; assert the button is gone **inside** the window.
3. Let the new run settle; assert the control reflects the new run rather than the old one.
~~4. Assert a frontier `▶` click during the window posts no `extend` (§4.1's second caller).~~ **Struck —
   §4.1 as corrected proves this path unreachable while `awaitingRun` holds: the forward button
   renders `disabled`, and a disabled button receives no click from a user gesture, so there is no
   state in which a click could post an extend to observe the absence of. This obligation was the
   retracted `transport.ts`-misbehaves claim restated in test-obligation form, which is why a sweep for
   the claim's wording did not find it.

Plus §5's two-half measurement, which lives here because it needs a real browser's focus model.

## §7 What this slice does not close

- **Items 1–7 and 9–16** of the deferred-accessibility list, unchanged. This is one item.
- **Announcement.** Nothing here is announced to a screen reader; `stepText` is a plain `<span>`. The
  item forbids a second messaging mechanism, and a live region for the step readout is a decision for
  the pass, not for this slice.
- **The `hidden`/removal difference.** `controlStrip`'s doc says the continue button is *"ADDED AND
  REMOVED, NEVER DISABLED"* while `update` sets `extend.hidden`. `detachedBadge`'s doc already records
  the distinction and why the badge goes further. `hidden` does take the button out of the tab order
  and the accessibility tree, so nothing in this slice depends on closing the gap; it is noted so the
  pass can decide.
