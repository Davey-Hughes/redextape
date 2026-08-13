import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { lintGutter } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import init, { analyze, classifySource, encodings, tokenClasses } from '../../pkg/redextape_wasm.js'
import { APPEARANCE_LABEL, applyAppearance, nextAppearance, readStored, STORAGE_KEY } from './appearance'
import { showBanner } from './banner'
import { bufferList } from './buffer-list'
import { createCompile } from './compile'
import { createDraw } from './draw'
import { createEditorCustody } from './editor-custody'
import { declineMark, focusMark, highlighting, linkMark, setSpans } from './highlight'
import { History } from './history'
import type { LambdaPane } from './lambda-pane'
import {
  closeLeaf,
  defaultLayout,
  LAYOUT_STORAGE_KEY,
  type LayoutNode,
  leaves,
  parseLayout,
  SOURCE_LEAF,
} from './layout'
import { createLinkWiring, type LinkWiring } from './link-wiring'
import { lintFromAnalyze } from './lint'
import { layoutControls } from './pane-chrome'
import { createPaneHost } from './pane-host'
import { type LeafId, PaneCollection } from './panes'
import type { RunReply } from './protocol'
import { HISTORY_BYTES } from './protocol'
import { createReplies } from './replies'
import { ScratchBuffers } from './scratch'
import { type SessionId, SessionPool } from './session-client'
import { SessionRegistry } from './sessions'
import type { TmPane } from './tm-pane'
import { createTransport } from './transport'
import type { Classified, Diagnostic, LambdaState, TmState } from './types'
import { assertTokenClasses } from './types'

const SAMPLE = 'let x = 40; x + 2'

/**
 * The counter behind every `LeafId` a split mints, shared across both legs — module-level rather than
 * per call to `main()`, though `main()` only ever runs once (`ready` below is computed on import).
 *
 * STARTS AT 1 ONLY FOR THE TREE A FRESH PAGE SHIPS, whose leaves are already `lambda-0` and `tm-0`.
 * **REASONING ONLY ABOUT `defaultLayout()` IS EXACTLY THE BLIND SPOT THIS COMMENT USED TO HAVE**, and
 * it cost the first split after every reload: `main()` restores a tree from `localStorage` when there
 * is one, that tree can already contain `lambda-1` from a split in an earlier page load, and
 * `splitLeaf`'s collision guard then refuses the id `nextLeafId` mints — an uncaught throw out of the
 * click handler, no new pane, and nothing on screen to say why. (A SECOND click worked, because the
 * refused attempt had still incremented this. That is the shape of the bug, not a mitigation.)
 * `seedLeafCounter` below is what makes the starting value a fact about the tree actually in hand
 * rather than about the one a fresh page would have had.
 */
let leafCounter = 1

/**
 * Advance `leafCounter` past every numeric suffix in `tree` — called once, on the tree `main()` starts
 * with, whether that came from storage or from `defaultLayout()`.
 *
 * FIX THE CALLER, NOT THE GUARD. `splitLeaf`'s refusal of an id already in the tree is deliberate and
 * correct (its own doc: a duplicate id would not error, it would silently make the second leaf
 * unreachable) — the bug was minting a colliding id, not detecting one.
 *
 * MAX-PLUS-ONE OVER ALL LEAVES, NOT PER LEG, because the counter is shared across legs: a tree holding
 * `lambda-3` makes `tm-3` unmintable too, since the next `tm` split would take suffix 3 only if the
 * counter were still below it. A leaf id with no numeric suffix (`'source'`, or anything a hand-edited
 * `localStorage` entry carries — `parseLayout` accepts any non-empty string as an id) contributes
 * nothing rather than `NaN`: `Number('source')` is `NaN`, and `Number.isInteger` rejects it, so the
 * counter is left where it was. THIS DOES NOT GUARANTEE FREEDOM FROM COLLISION FOR AN ARBITRARY STORED
 * TREE — a hand-written id of `lambda-x` is not a suffix this can step past — but every id this app
 * itself mints is `${leg}-${n}`, and `splitLeaf`'s guard is still the backstop for the rest.
 */
function seedLeafCounter(tree: LayoutNode): void {
  for (const leaf of leaves(tree)) {
    const suffix = Number(leaf.id.slice(leaf.id.lastIndexOf('-') + 1))
    if (Number.isInteger(suffix) && suffix >= leafCounter) leafCounter = suffix + 1
  }
}

/**
 * The id a split mints for the new leaf it creates.
 *
 * `pane-${n}`, NOT `${leg}-${n}`, AND THE OLD SPELLING WAS A LIE THIS SLICE MADE VISIBLE. A leaf
 * minted as `lambda-3` that later renders a δ-table carries a name describing something it is not —
 * in the tree, in `localStorage`, and in `data-leaf`, which browser tests select on. `panes.ts:6`
 * already declares the id opaque ("a leaf's stable identity"), so the prefix was a convenience rather
 * than a fact, and a pane that can change leg is what falsifies it.
 *
 * `defaultLayout()`'s LITERAL `lambda-0` / `tm-0` ARE LEFT ALONE, for three reasons and none of them
 * is inertia: browser tests select on them, `reset layout`'s re-minting of exactly those ids is what
 * `applyLayout`'s claim-dropping line reasons about, and `seedLeafCounter` reads the digits after the
 * last `-` and does not care which word precedes them. `dataset.kind` is the truthful statement of
 * what a leaf renders.
 */
function nextLeafId(): LeafId {
  return `pane-${leafCounter++}`
}

/**
 * The `LeafId` of the sibling that absorbs a closed leaf's space.
 *
 * THE PREVIOUS LEAF IN `leaves(tree)` ORDER, OR THE NEXT IF THE CLOSED ONE WAS FIRST — the same
 * left-to-right, depth-first order `leaves` itself promises (and tab order follows), so this is "the
 * pane now sitting where the closed one used to be" rather than an arbitrary sibling.
 */
function neighbourOf(tree: LayoutNode, id: LeafId): LeafId | null {
  const ids = leaves(tree).map((l) => l.id)
  const i = ids.indexOf(id)
  if (i === -1) return null
  return ids[i - 1] ?? ids[i + 1] ?? null
}

async function main(): Promise<EditorView> {
  const results = document.querySelector<HTMLElement>('#results')
  const editorHost = document.querySelector<HTMLElement>('#editor')
  const linkStatusHost = document.querySelector<HTMLElement>('#link-status')
  const picker = document.querySelector<HTMLSelectElement>('#encoding')
  const appearanceButton = document.querySelector<HTMLButtonElement>('#appearance')
  const restoreLayoutButton = document.querySelector<HTMLButtonElement>('#restore-layout')
  /**
   * THE BUFFER LIST'S BUTTON — design §4.2's `[buffers 3 ▾]`, queried here exactly as `#appearance` and
   * `#restore-layout` are, because `bufferList` takes a button rather than building one (its own doc).
   *
   * **NO `aria-label`, WHERE THE TASK BRIEF'S MARKUP CARRIED `aria-label="scratch buffers"`.** An
   * `aria-label` REPLACES an element's contents as its accessible name, and the contents here are the
   * readout: `bufferList.update` writes `buffers 3 ▾` into them at every moment the count changes,
   * precisely so the header states how many buffers exist while the list is closed. A label naming the
   * control and not the count would make that readout inaudible to the one reader who cannot see it —
   * the opposite of what `#restore-layout`'s label does, which EXPANDS a terse visible word rather than
   * hiding a number. `aria-haspopup`/`aria-expanded` (both `bufferList`'s) are what announce that it
   * opens something.
   */
  const buffersButton = document.querySelector<HTMLButtonElement>('#buffers')
  const root = document.querySelector<HTMLElement>('main')
  if (
    !results ||
    !editorHost ||
    !linkStatusHost ||
    !picker ||
    !appearanceButton ||
    !restoreLayoutButton ||
    !buffersButton ||
    !root
  ) {
    throw new Error('the page is missing a mount point')
  }

  // Wired BEFORE `init()`, unlike everything below it. The toggle has nothing to do with wasm — it
  // reads and writes `localStorage` and flips an attribute on `<html>` — so it stays live even on the
  // one failure path (`showBanner` below) that replaces `<main>` and leaves the header bar standing.
  //
  // `localStorage` ACCESS IS GUARDED, same as `index.html`'s inline script and for the same reason:
  // it throws in some privacy modes. Unguarded here it would be worse than in that script, not the
  // same — this runs before the `init()` try/catch below, so an uncaught throw would reject `ready`
  // itself and blank the page before any banner could report why.
  const readAppearanceStorage = (): string | null => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  }
  const writeAppearanceStorage = (a: string): void => {
    try {
      localStorage.setItem(STORAGE_KEY, a)
    } catch {
      // Nothing to do — the toggle still works for the rest of this page load, it just will not
      // survive a reload. The same tradeoff the inline script in `index.html` makes.
    }
  }

  let appearance = readStored(readAppearanceStorage())
  const relabelAppearance = () => {
    const { glyph, label } = APPEARANCE_LABEL[appearance]
    appearanceButton.textContent = glyph
    appearanceButton.setAttribute('aria-label', label)
  }
  applyAppearance(document.documentElement, appearance)
  relabelAppearance()
  appearanceButton.addEventListener('click', () => {
    appearance = nextAppearance(appearance)
    applyAppearance(document.documentElement, appearance)
    writeAppearanceStorage(appearance)
    relabelAppearance()
  })

  // THE ONE PLACE THE APP CAN FAIL TO START. `init()` fetches the wasm; a worker constructed against
  // a missing module fails the same way. PR 3c had no surface for either and the failure was a blank
  // page.
  try {
    await init()
  } catch (e) {
    showBanner(root, e)
    throw e
  }

  // Checked once, here, immediately after the module is live. See `assertTokenClasses`.
  assertTokenClasses(tokenClasses() as string[])

  for (const name of encodings() as string[]) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    picker.append(opt)
  }

  let view: EditorView

  /**
   * THE SESSION REGISTRY — the container design §3.2b says decision 1 presupposes.
   *
   * IT IS A `SessionRegistry` FROM `sessions.ts` NOW, NOT A `Map` DECLARED HERE, and the move is what
   * this task's test costs rather than a tidy-up. T7's claim is that two panes bound to two different
   * λ sessions show two different terms at the same time, and nothing in this slice can put a second
   * session in this registry: a `LambdaScratch` needs a worker message `session-worker.ts` does not
   * have, and creating one on edit is §4.3, which is T8. A registry that is a module is a registry a
   * test can put two sessions in. `SessionRegistry`'s own doc carries the argument in full.
   *
   * **T8 HAS LANDED AND THE APP CAN NOW HOLD TWO, WHICH RETIRES THE SECOND HALF OF THE PARAGRAPH
   * ABOVE BUT NOT THE FIRST.** The λ pane's fork control registers a second entry (`scratchpad`
   * below, `scratch.ts`), so the selector this app draws is no longer hypothetical. The reason the
   * registry is a module survives it: how many sessions a fork produces must be asserted on POOL SIZE,
   * which is not reachable from the DOM, and this app has ONE λ pane — so "two panes on two λ
   * sessions" still cannot be performed here, whatever the registry can hold.
   *
   * **T12 (5d-ii-a) RETIRES THE LAST CLAUSE TOO.** `applyLayout` (`pane-host.ts`) can now put a second
   * `'lambda'`-kind pane on screen from a layout split, and the binding selector already lets either
   * one point at a different registered session — so "two panes on two λ sessions" is mechanically
   * reachable through the UI, not only through `tests/node/sessions.test.ts`'s hand-built panes. What
   * survives is the reason the registry is a module: HOW MANY SESSIONS A FORK PRODUCES is still
   * asserted on pool size, which no DOM query reaches regardless of how many panes exist to watch it.
   * 5d-ii-c decision 1 changed the number that assertion expects — a fork mints a buffer per call
   * rather than reusing one — and left the axis exactly where 5d-i put it.
   */
  const sessions = new SessionRegistry()

  /**
   * The session compiled from the editor's text — the only one that exists today, and the only one
   * that will ever have a `SourceMap` behind it (§3.3: `linkIndex` and `sourceSpan` exist on neither
   * scratch type).
   */
  const SOURCE_SESSION: SessionId = 'source'

  // **THE λ SCRATCH ID AND LABEL USED TO BE DECLARED HERE, AND THEY ARE NOT ANY MORE.** They read
  // `const LAMBDA_SCRATCH: SessionId = 'lambda-scratch'` / `'λ scratchpad'`, named in this file for the
  // reason `SessionEntry.label`'s doc gave: `main.ts` names the app's sessions and `sessions.ts` never
  // does. 5d-ii-c decision 1 makes a fork mint a buffer per call, so there is no fixed name for this
  // file to write down before the session exists — `ScratchBuffers.fork` mints id and label together,
  // and `SessionEntry.label`'s doc now draws the line where it was always really drawn: a session is
  // named where it is CREATED, never in the registry that holds it.
  //
  // THE LABEL IS STILL WHAT THE BINDING SELECTOR PUTS IN FRONT OF A USER, which is why a buffer's is
  // words (`scratch 2`) rather than its id — `tests/browser/binding-selector.test.ts` asserts the
  // options are told apart by their labels and not by colour or position.
  //
  // A `//` BLOCK RATHER THAN `/** */`, WHICH IS THE WHOLE OF WHY THIS PARAGRAPH WAS REWRITTEN: it
  // documents a declaration that is GONE, and a doc comment with nothing under it is read as documenting
  // whatever comes next — here `let draw`, which it says nothing about. Two consecutive `/** */` blocks
  // before one symbol is the shape that made it noticeable.

  /**
   * BOTH `let`, NOT `const` — DECLARED HERE SO `transport` BELOW CAN CLOSE OVER THEM THROUGH THUNKS
   * BEFORE EITHER IS ASSIGNED. `transport.events(...)` builds the click handlers the panes are
   * CONSTRUCTED with, so `transport` has to exist before either pane does — but `linkWiring`
   * (`link-wiring.ts`) takes both panes as values, and `draw` (`draw.ts`) takes `linkWiring` as one, so
   * neither can be built until after the panes are. `createTransport` therefore sees only thunks for
   * both (`transport.ts`'s own doc has the reason `linkWiring` needs one at all, not only `draw`).
   * Assigned once each, in that order, right after the panes are built, below.
   */
  let draw: () => void
  let linkWiring: LinkWiring

  /**
   * ONE WORKER PER SESSION (design §4.2), AND THE ONLY THING HERE THAT MAY SPAWN OR TERMINATE ONE.
   *
   * THE `worker` LOCAL IS GONE, AND IT WAS THE LAST PIECE OF A SESSION LIVING OUTSIDE ITS ENTRY. The
   * task before this one gave an entry its own legs and its own client but left `main()` holding a
   * `Worker` handle and its `error` listener beside them, because spawning is this task's. A
   * session's thread is now created where its client is and dies where its client does.
   *
   * WHY IT IS WORTH A CLASS AT ALL, since there is still exactly one session: the pool's reason is
   * damage containment, not tidiness. A wasm call that aborts leaves a wasm-bindgen borrow taken and
   * poisons the module permanently, and a worker's print-stack ceiling drops after its first deep
   * print and stays down — both are properties of the THREAD, so one worker holding three sessions
   * shares both. `SessionPool`'s own doc carries the measurements; this call site is just where the
   * policy lands.
   *
   * THE FACTORY IS THIS FILE'S HALF OF THE SPLIT, and it is exactly the two decisions the pool must
   * not make: which module a session's worker runs — `session-worker.ts`, resolved against
   * `import.meta.url` so the bundler rewrites the URL — and what a load failure looks like, which
   * needs `root`. §4.2 puts the pool in `session-client.ts`, and a module with no DOM cannot own the
   * second of those.
   */
  const pool = new SessionPool(() => {
    const worker = new Worker(new URL('./session-worker.ts', import.meta.url), { type: 'module' })
    // THE SECOND HALF OF §6's LOAD-FAILURE ROW, and it is not the same failure as `init()`'s. A worker
    // whose module fails to load does not throw from the constructor — it fires `error` on the handle,
    // asynchronously, and nothing else in this file would ever hear it. Without this the pane sits on
    // "running…" forever, which is the same blank-page problem one layer in.
    worker.addEventListener('error', (e) => showBanner(root, e instanceof ErrorEvent ? (e.error ?? e.message) : e))
    return worker
  })

  /**
   * THE λ SCRATCH BUFFERS — design §4.3's fork, and the thing that makes a second session reachable.
   *
   * ONE OBJECT RATHER THAN A `fork`/`retire` PAIR OF CLOSURES HERE, and the reason is the test the
   * plan names: how many sessions a fork produces has to be asserted on POOL SIZE, which is not
   * reachable from the DOM. Before T12 this app had ONE λ pane, so "two source-derived λ panes edited
   * in turn" could not be performed through it at all; a layout split now puts a second one on screen,
   * and the argument for one object survives unchanged — the pool-size assertion still needs
   * `tests/node`, whatever the DOM can now show. `scratch.ts` is a module a test can drive with two
   * slots and fake ports; this line is the app taking the same object.
   *
   * THE REPLY HANDLER IS THE BUFFERS' OWN, NOT `onReply`. A buffer has one leg, no results pane, no
   * link index and no `tmProgram`, so every branch of `onReply` (`replies.ts`) except `lambda-frames`
   * is about state it does not have — routing it there would mean five `if (session === …)` guards
   * inside a function whose whole point (see its doc) is that a reply belongs to the session whose
   * worker sent it. Two handlers, one per session kind, is the same split §3.2 draws at the port.
   *
   * IT NAMES THE BUFFER THE REPLY CAME FROM, WHICH IS WHAT THIS LINE USED TO HARD-CODE. It read
   * `replies.onScratchReply(LAMBDA_SCRATCH, reply)`, correct while one id was the only one a buffer
   * could have; `ScratchBuffers` curries each buffer's own id in at `pool.bind`, so the name arrives
   * with the reply and this file no longer has one to supply.
   */
  const scratchpad = new ScratchBuffers({
    registry: sessions,
    pool,
    historyBytes: HISTORY_BYTES,
    onReply: (session: SessionId, reply: RunReply) => replies.onScratchReply(session, reply),
  })

  // THE SOURCE SESSION, AND NO LONGER THE ONLY ENTRY THE APP EVER HOLDS. It is the only one created
  // at start-up: a §4.3 buffer is created by a click (`scratchpad` above) and ends only where
  // `ScratchBuffers.retire` is called — **which is the header list's retire handler below, and nothing
  // else in `src/`**. That is 5d-ii-c decision 2 complete: one ending, explicit, on a control the user
  // aims at. **THIS SENTENCE ENDED "and retired by the next recompile"** until that decision deleted
  // the first of the two implicit retires (`compile.ts` records what went with it); it then read "today
  // that is `replies.ts`'s phantom-fork `no-session` and nothing else" until the second went too
  // (`replies.ts`'s own `no-session` arm records that one); and it then said the app could create
  // buffers and end none, which was the deliberate window §4.2's list closes — so that "what ends a
  // buffer" landed as one reviewable change rather than as a residue of two, and knowingly, since §4.4
  // makes that list the poison recovery as well as the ordinary way out.
  //
  // **THE SELECTOR IS ON SCREEN FROM THE FIRST PAINT, AND THAT REVERSES WHAT THIS COMMENT USED TO
  // SAY** — it read "the selector has one option to offer until someone forks — which is why
  // `bindingSelect` renders nothing on a fresh page and appears the moment there are two." That was
  // true of a control listing SESSIONS. `paneSelect` lists `(leg, session)` PAIRS, and this one entry
  // has BOTH legs, so it contributes two pairs on its own and the control's "not shown below two
  // options" threshold is crossed with nothing forked. Its stated idiom is unchanged; what changed is
  // what it counts. See its doc.
  //
  // ASSEMBLED HERE RATHER THAN WHERE `lam`/`tm` USED TO BE DECLARED, because an entry owns its client
  // and the client cannot exist before its worker does. The legs are initialised inline for the same
  // reason the entry exists at all: a session's legs and its client are one thing now, and splitting
  // them across two hundred lines is what let them drift apart into unrelated locals in the first
  // place. Registered before either pane is constructed — `transport.events(...)` below resolves through the
  // registry, and although every handler it builds runs later, `entryOf` would throw if one somehow
  // fired first.
  //
  // `detached: false`, AND IT IS THE ONLY ENTRY THAT MAY SAY SO. This is the session with a
  // `SourceMap` behind it; §3.3 puts `linkIndex` and `sourceSpan` on neither scratch type, so every
  // buffer's entry is `detached: true` by construction — `ScratchBuffers.fork` writes the
  // literal and nothing derives it, for the reason `SessionEntry.detached`'s own doc gives.
  //
  // THE REPLY HANDLER NAMES ITS SESSION. Nothing on the wire does (§3.2 — the port is the id), so the
  // binding between a client and the legs its frames land in is made here, at the one place that
  // knows both. `pool.bind` is what pairs that handler with a thread; this file never sees the port.
  sessions.add({
    id: SOURCE_SESSION,
    label: 'source',
    detached: false,
    client: pool.bind(SOURCE_SESSION, (reply: RunReply) => replies.onReply(SOURCE_SESSION, reply)),
    legs: {
      lambda: {
        hist: new History<LambdaState>(HISTORY_BYTES),
        status: { available: false, reason: '' },
        done: null,
        timer: null,
      },
      tm: {
        hist: new History<TmState>(HISTORY_BYTES),
        status: { available: false, reason: '' },
        done: null,
        timer: null,
      },
    },
    // NOTHING COMPILED YET, AND THIS SESSION IS THE ONE THAT EVER WILL — `compiled` is the reply the
    // scratch types cannot send (§4.1), so the scratchpad's own entry states the same `null` and keeps
    // it. See `SessionEntry.tmProgram` for what reads this and when.
    tmProgram: null,
  })
  /**
   * TRANSPORT, BEFORE EITHER PANE — its `events(...)` is what each pane is constructed with, so it has
   * to exist first. `scratchpad` is a real value (constructed above, and nothing later reassigns it);
   * `draw` and `linkWiring` are thunks, for the reason the `let`s above give.
   */
  const transport = createTransport({
    sessions,
    scratchpad,
    draw: () => draw(),
    linkWiring: () => linkWiring,
    // A THUNK FOR THE SAME REASON `draw` IS ONE, one step further down the file: `refreshBuffers` is
    // declared below, after the header list it refreshes, which is itself declared after `paneHost`.
    // The body is not evaluated until a fork actually happens.
    onBuffersChanged: () => refreshBuffers(),
  })

  /**
   * THE PANE COLLECTION — built empty, before any pane exists, and handed to every later factory as a
   * reference rather than a value (T7's own shape, one step earlier now). `pane-host.ts`'s `applyLayout` is the
   * only thing that ever calls `.add`/`.remove` on it; `linkWiring`/`draw`/`compile`/`replies` just
   * hold onto the same object and read it live, which is what makes them tolerant of it being empty
   * at construction time.
   */
  const panes = new PaneCollection()

  /**
   * WHERE EACH SCRATCH EDITOR IS AND WHERE IT BELONGS — `editor-custody.ts`'s own doc has the argument
   * for why the two maps behind this (`editorOwner`, the claims; `heldEditors`, the editors in custody)
   * and the two functions that read them live there now instead of as four names in this scope, and its
   * doc comments are the record of the three review rounds that shaped them.
   *
   * `panes` IS HANDED OVER EMPTY, exactly as `linkWiring` below takes it: `applyLayout` is the only
   * thing that ever populates the collection, and nothing in that module reads it before `applyLayout`'s
   * first call has run. `applyLayout` (now `pane-host.ts`'s), and it is still the only caller that knows a layout
   * tree exists — custody is told what happened (`hold`, `claim`, `dropClaimsOn`) and asked to settle
   * (`reconcile`), never handed the tree.
   */
  const custody = createEditorCustody({ panes, sessions })

  /**
   * THE SOURCE PANE'S HOST, PRE-SEEDED RATHER THAN LEFT TO `hostFor`'s GENERIC BRANCH. `#editor` is the
   * element `view` is constructed against below — `index.html` ships it as a bare top-level node rather
   * than nested under a `#source` section, because that section no longer exists in the markup at all
   * (the tree builds it). Moving it here, once, before `applyLayout` ever runs, is what lets
   * `hostFor('source', 'source')` find this entry already in `hosts` and return it rather than building
   * an empty section with nothing inside it — the source leaf is chrome around an editor `main.ts`
   * already owns, not a `PaneView` `applyLayout` constructs.
   *
   * **`#link-status` USED TO MOVE IN HERE BESIDE IT, AND THAT WAS DEFERRED-A11Y ITEM 12 — fixed by
   * deleting it from the `append` below rather than by anything more elaborate.** This host ships a
   * close control, and `hostFor`'s detach-not-destroy rule takes the whole subtree out of the document
   * when the source leaf closes; `createLinkWiring` captures the status element once at construction, so
   * every write after that close landed in a node that had left the page. `✎ fork` stays offered on the
   * λ pane throughout — closing the source PANE ends no session — so a refusal past the buffer cap
   * reported to nobody, which is the Critical this branch already fixed arriving again by a narrower
   * road. The line's own contract is what settles where it belongs: `link-status.ts` says of `forkFailed`
   * that this is *"the surface that exists whether or not a pane can show anything"*, and a surface
   * inside a closeable pane cannot keep that promise. Two of its three live jobs (detached panes, a
   * failed fork) are app-wide anyway; the third (what is pinned) is about a construct lit in three panes
   * rather than about this one. So it stays where `index.html` declares it — between the pane tree and
   * `#results`, outside every host `hostFor` can detach.
   */
  const sourceHost = document.createElement('section')
  sourceHost.className = 'pane'
  sourceHost.dataset.leaf = SOURCE_LEAF
  sourceHost.dataset.kind = 'source'
  const sourceTitle = document.createElement('h2')
  sourceTitle.textContent = 'source'
  /**
   * THE SOURCE PANE'S OWN CLOSE CONTROL — `layoutControls`'s doc records why source is refused a SPLIT
   * and not a close: there is one editor, so there is nothing to duplicate into, but closing the source
   * pane is exactly `hostFor`'s detach-not-destroy rule doing its job — the editor and its text wait in
   * `hosts` and come back intact the moment the leaf does. Two gestures bring it back now, and the
   * second is the one this control was always waiting for: `reset layout`
   * (`tests/browser/two-lambda-panes.test.ts`'s "keeps the program" test), which costs every other pane
   * on the page, and any other pane's split picker (`tests/browser/pane-picker.test.ts`), which costs
   * nothing.
   *
   * A SEPARATE `layoutControls` INSTANCE, NOT ROUTED THROUGH `paneEvents`, BECAUSE THE SOURCE PANE HAS
   * NO `PaneSlot`. `paneEvents` is built for a `(LeafId, PaneSlot<K>)` pair — `applyLayout`'s own `if
   * (l.pane === 'source') continue` is exactly the statement that no such pair exists for this leaf —
   * so the closure here re-states `close`'s two lines directly against `SOURCE_LEAF` rather than
   * manufacturing a slot that would have nothing to resolve. (That constant is `layout.ts`'s now, and
   * its own doc has the reason: `pane-host.ts`'s picker can CREATE a source leaf, so the id this handler
   * closes over and the id that split mints have to be the same id in a way two literals cannot promise.)
   *
   * `{ close: ... }` ALONE, NOT SPLIT — `layoutControls`'s own doc has the reason its parameter type
   * changed to allow this. `update`'s SECOND ARGUMENT IS A LITERAL `false`, ALWAYS: source can never
   * split (`splitLeaf`'s own refusal), so there is no boolean this pane's chrome could ever compute for
   * `canSplit` that isn't already known at every call site.
   */
  // `.controls`, THE SAME CLASS `controlStrip` GIVES THE TRANSPORT STRIP IN `LambdaPane`/`TmPane` — not
  // a new style, the existing `.controls button` rule (`layoutControls`'s own doc: "one control in a
  // pane, not a new style").
  const sourceControls = document.createElement('div')
  sourceControls.className = 'controls'
  const sourceLayout = layoutControls(sourceControls, {
    close: () => {
      const grew = neighbourOf(tree, SOURCE_LEAF)
      tree = closeLeaf(tree, SOURCE_LEAF)
      paneHost.applyLayout()
      paneHost.focusPane(grew)
    },
  })
  sourceHost.append(sourceTitle, editorHost, sourceControls)

  // `localStorage` ACCESS IS GUARDED, same reason and same shape as `readAppearanceStorage`/
  // `writeAppearanceStorage` above: it throws in some privacy modes, and a layout is a preference —
  // design §4.4 says a failure to persist or restore one must stay silent to the user, not blank the
  // page or block the app from starting.
  const readLayoutStorage = (): string | null => {
    try {
      return localStorage.getItem(LAYOUT_STORAGE_KEY)
    } catch {
      return null
    }
  }
  const writeLayoutStorage = (raw: string): void => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, raw)
    } catch {
      // Nothing to do — the layout still works for the rest of this page load, it just will not
      // survive a reload. The same tradeoff `writeAppearanceStorage` makes.
    }
  }

  /** The layout tree — restored from `localStorage` if there is a usable value there, the shipped arrangement otherwise. */
  let tree: LayoutNode = parseLayout(readLayoutStorage()) ?? defaultLayout()
  // IMMEDIATELY, AND ON THE RESTORED TREE RATHER THAN ONLY THE DEFAULT ONE — see `seedLeafCounter`'s
  // own doc. ONCE, HERE, NOT ON EVERY `applyLayout`: the counter only ever needs to learn about ids it
  // did not mint itself, and this is the one moment such an id can enter the tree. (Re-seeding later
  // would be harmless — the function only ever advances — but it would also be a second place to read
  // as though the invariant needed maintaining.)
  seedLeafCounter(tree)

  /**
   * THE PANE LIFECYCLE — `pane-host.ts`'s own doc has the argument for why `hosts` and `pendingBinding`,
   * and the four closures over them (`hostFor`, `paneEvents`, `focusPane`, `applyLayout`), live there now
   * instead of as six names in this scope, and its doc comments are the record of the review rounds that
   * shaped them.
   *
   * CONSTRUCTED AFTER `tree`, `sourceLayout` AND `writeLayoutStorage`, AND BEFORE ANY PANE EXISTS, because
   * those three are its irreducible ties back to this file: the tree it reads and rewrites, the source
   * pane's close control it drives at every structural change, and the guarded writer that persists a
   * layout. `panes` IS HANDED OVER EMPTY — `applyLayout` is still the only thing that ever populates it —
   * and `draw` is a thunk for the same reason `linkWiring`/`compile` below take one: the `let` it names is
   * not assigned until `createDraw` runs.
   *
   * `tree` STAYS A `let` IN THIS SCOPE AND CROSSES AS A GETTER/SETTER PAIR, not as a field over there and
   * not as a mutable export. Two of its writers stay here — the restore just above and the `reset layout`
   * button just below — so a copy in that module would be a second place the current tree lives, and this
   * file would be holding the stale one.
   *
   * `nextLeafId` AND `neighbourOf` CROSS AS FUNCTIONS RATHER THAN MOVING WITH THEIR CALLERS. `leafCounter`
   * is deliberately per-module rather than per-`main()` call (see its own doc), and `seedLeafCounter` above
   * is the other reader of it; `neighbourOf`'s other caller is `sourceLayout`'s close handler above, which
   * has no `PaneSlot` and therefore no `paneEvents` to go through.
   */
  const paneHost = createPaneHost({
    root,
    panes,
    custody,
    transport,
    sourceSession: SOURCE_SESSION,
    sourceLayout,
    nextLeafId,
    neighbourOf,
    getTree: () => tree,
    setTree: (next) => {
      tree = next
    },
    writeLayoutStorage,
    draw: () => draw(),
    // THE ONE SESSION QUESTION `pane-host.ts` ASKS, ANSWERED HERE BECAUSE THIS FILE IS WHERE THE REGISTRY
    // IS — that module's own doc argues why it takes this rather than the registry it would otherwise
    // need. `entryOf` throws for a session nothing registered, which is the policy `legOf` already sets
    // for the same class of wiring bug.
    tmProgramOf: (session: SessionId) => sessions.entryOf(session).tmProgram,
  })
  // THE `hosts.set('source', sourceHost)` THIS USED TO BE, now that the map is `pane-host.ts`'s.
  // `sourceHost`'s own doc above has the argument for why this file builds that host rather than leaving
  // it to `hostFor`'s generic branch, and for why the seeding has to happen before `applyLayout` first
  // runs — still true here, with the whole tail of `main()` between this line and that call.
  paneHost.seedHost(SOURCE_LEAF, sourceHost)

  restoreLayoutButton.addEventListener('click', () => {
    tree = defaultLayout()
    paneHost.applyLayout()
  })

  /**
   * **THE HEADER'S BUFFER LIST — design §4.2's surface, and §4.4's poison recovery arriving with it.**
   * This is the call that closes the window decision 2 opened: until it existed the app could create
   * buffers and end none, so a wedged worker could not be reclaimed, a failed fork left its pane reading
   * `building…` forever, and `buffer-list.ts` was a tested module nothing imported.
   *
   * **`paneCount` IS COMPUTED HERE AND LIVES ON NO OTHER TYPE, WHICH IS WHY `BufferInfo` AND
   * `BufferRow` ARE TWO TYPES.** `ScratchBuffers` answers what buffers exist; `PaneCollection` answers
   * which panes are bound to one. Putting the count on `BufferInfo` would give `scratch.ts` a
   * `PaneCollection` dependency for a number only the header renders — and this file already holds both
   * objects, so the join costs one `map` at the one place that is not a second reader of either.
   *
   * A THUNK BUILT PER OPEN, NOT A VALUE: `bufferList` calls this on `beforetoggle` (its own doc), so
   * the `ofSession` scan runs once per gesture rather than on every frame that repaints the header.
   *
   * `panes.all().map(...)` HANDS OVER EVERY SLOT ON THE PAGE, NOT THE λ ONES. `retire` rebinds only the
   * slots whose binding names the buffer it is ending (`scratch.ts`'s own rule, and
   * `tests/node/scratch.test.ts` pins it against a TM slot that must not be dragged home), so filtering
   * here would be this file restating a rule the callee enforces — and getting it wrong would be
   * invisible, since the buffer would end either way.
   *
   * **THE `custody.reconcile()` IS THIS HANDLER'S OWN OBLIGATION AND NOTHING ELSE WILL DISCHARGE IT.**
   * A retire is the one event that makes `!sessions.has(session)` true, and `editor-custody.ts`'s
   * `reconcileEditors` is what then drops the retired session's claim and destroys an editor waiting in
   * custody for it — the last reference to a live `EditorView`, with its own pending debounce, over a
   * terminated worker. Both retire sites used to call it; 5d-ii-c decision 2 deleted both, and
   * `createReplies` shed the dependency on the stated reasoning that the header list's retire would live
   * in the list's own handler, "so that is where the sweep obligation belongs". This is that handler.
   *
   * `try`/`finally` FOR `applyLayout`'s REASON, IN ONE SENTENCE: `reconcile` throws deliberately
   * (`LambdaPane.receiveEditor` refuses a second editor), and a throw escaping here would leave the
   * header advertising a buffer that has gone and the rebound panes unpainted — a disagreement worse
   * than the one being reported. The exception still leaves this handler.
   */
  const buffers = bufferList(
    buffersButton,
    () =>
      scratchpad.list().map((b) => ({
        id: b.id,
        label: b.label,
        paneCount: panes.ofSession('lambda', b.id).length,
        /**
         * **THE ROW'S ONE DISTINGUISHING FACT, JOINED HERE FOR `paneCount`'s REASON** — see
         * `BufferRow.term` for what the list looked like without it (eight rows reading `scratch N —
         * orphan`, under a refusal telling the user to pick one). `ScratchBuffers` answers what buffers
         * exist and the registry answers what each one currently holds; this file is the one place that
         * holds both, so the join costs one property on a thunk that already runs once per open.
         *
         * `hist.current`, WHICH IS THE FRAME A PANE BOUND TO THIS BUFFER WOULD BE SHOWING — the head of
         * the ring, not step 0 — so a row and a pane never disagree about the same buffer, and scrubbing
         * a buffer's history changes what its row says next time the list opens.
         *
         * `legOf` CANNOT THROW HERE, AND THE REASON IS THE GOVERNING RULE RATHER THAN AN ASSUMPTION: a
         * buffer is in `#buffers` and in the registry together or in neither, because `#reg.remove` and
         * `#buffers.delete` appear exactly once in `src/` and both are inside `retire`. Every id
         * `list()` returns is therefore registered at the moment this runs.
         *
         * `?? null` FOR A BUFFER WITH NO FRAME — a fork the worker has not answered, or one whose build
         * failed. The row says which of those it cannot tell; `BufferRow.term` has that argument.
         */
        term: sessions.legOf({ session: b.id, leg: 'lambda' }).hist.current?.text ?? null,
      })),
    (id) => {
      scratchpad.retire(
        id,
        SOURCE_SESSION,
        panes.all().map((p) => p.slot),
      )
      /**
       * **A RETIRE ANSWERS THE CAP REFUSAL, SO THE REFUSAL STOPS BEING TRUE HERE — found by driving the
       * app, not by a test.** The message reads *"all 8 scratch buffers are live; retire one from the
       * buffers list in the header to make room"*, and until this line the page went on showing it after
       * the user had done exactly that. `#link-status` said all eight were live while the header two
       * inches above it read `buffers 7 ▾` — two surfaces disagreeing about the one number the sentence
       * is about, with the stale one being the advice.
       *
       * IT CLEARED ONLY ON THE NEXT SUCCESSFUL FORK (`transport.ts`'s success path), which is one
       * gesture too late: the whole point of the retire is that the fork can now be RE-ATTEMPTED, and a
       * user who reads the line before re-attempting is told their own action did not happen.
       *
       * UNCONDITIONAL, NOT GUARDED ON THERE BEING A REFUSAL TO CLEAR. `setForkFailed(null)` on a model
       * already holding `null` is a field write and a repaint this handler performs anyway, and a guard
       * would be this file deciding which refusals a retire answers — it answers the cap one, and the
       * sibling (a fork whose BUILD failed) names a buffer the user may have just retired. Both are
       * stale after this call for the same reason.
       *
       * BEFORE `custody.reconcile()`'s `try`, so a throw from the sweep cannot leave the message on
       * screen — the `finally` below already draws, and this is the state that draw should paint.
       */
      linkWiring.setForkFailed(null)
      try {
        custody.reconcile()
      } finally {
        refreshBuffers()
        draw()
      }
    },
  )

  /**
   * Put the header's readout back in step with how many buffers there are — called at the two moments
   * that number can change, a fork and a retire, and at no other.
   *
   * **THE BUTTON IS NOT OFFERED AT ZERO, AND THAT IS A DECISION.** A list with no rows is a gesture with
   * no possible outcome: there is nothing to reclaim, nothing to name and nothing a click could do —
   * which is this slice's own standard ("a control that provably cannot work must not be offered",
   * `editor-custody.ts`), and the standard `detachButton`, `collapseButton` and `paneSelect`'s
   * below-two-options self-removal already apply in pane chrome. The counter-argument is real and is
   * rejected: an always-present `buffers 0 ▾` would advertise that the capability exists, at the price of
   * a control whose only reachable state is an empty bordered box.
   *
   * `hidden` RATHER THAN `remove()`, WHICH IS WHERE THIS DEPARTS FROM THOSE THREE. The popover is
   * inserted BESIDE this button (`button.after(menu)`, once, at construction) and takes it as its
   * implicit anchor, so detaching the button would strand the list in the header and leave re-insertion
   * to guess the header's order. `hidden` takes the control out of the layout, out of the tab order and
   * out of the accessibility tree while leaving that pairing intact — the same mechanism
   * `controlStrip` uses for `extend`.
   *
   * **AND WITHDRAWING IT IS WHERE THE TWO CORRECT DECISIONS ABOVE MEET AND STRAND THE KEYBOARD.**
   * Measured, not reasoned from the spec: retiring the last buffer left `document.activeElement` as
   * `<body>`. `buffer-list.ts`'s row control dismisses the popover before it fires, and the popover hide
   * algorithm hands focus back to the invoker when focus is inside the popover — so by the time this
   * runs, focus is on the very button the next line takes out of the tab order, and focus on a
   * `display: none` element falls to the document body. Neither half is wrong on its own: the list
   * autofocuses its first row so the control is reachable, and the button withdraws because at zero it
   * provably cannot work. It is the accessibility list's own item 1 — *"a control that hides itself on
   * click strands the keyboard"* — assembled out of two parts that each pass review, and item 1's stated
   * remedy is to move focus deliberately rather than to stop hiding things.
   *
   * **`#restore-layout` RATHER THAN A PANE, WHICH IS WHERE THIS DIVERGES FROM `pane-host.ts`'s
   * `focusPane`.** That helper names "the place the user is looking" as a leaf the gesture acted on, and
   * a retire has no such leaf to offer in the case that reaches this branch: the buffer whose retire
   * empties the header is very often an orphan — the state this whole list exists to reach — so nothing
   * was rebound and there is no pane the gesture touched. What survives, in the strip the gesture was
   * made in and immediately beside the control that has just gone, is `#restore-layout`; it is never
   * itself withheld, so this cannot hand focus to a second hidden element.
   *
   * IT IS GUARDED ON THE BUTTON ACTUALLY HOLDING FOCUS, because a retire is not the only caller. A fork
   * reaches here too, and so does the initial call below, and neither should move a caret out of the
   * source editor. The guard is also what keeps a mouse user's focus where the pointer left it: a click
   * that never focused the invoker never gets focus back from `hidePopover`, so there is nothing here to
   * move.
   */
  const refreshBuffers = (): void => {
    const live = scratchpad.list().length
    if (live === 0 && document.activeElement === buffersButton) restoreLayoutButton.focus()
    buffersButton.hidden = live === 0
    buffers.update(live)
  }
  refreshBuffers()

  /**
   * THE LINK STATE — `link-wiring.ts`'s own doc has the argument for why `index`/`linkable`/`link`/
   * `forkFailed` live there now instead of as four `let`s in this scope. `panes` IS HANDED OVER EMPTY,
   * NOT "AFTER BOTH PANES EXIST" AS THIS USED TO READ — `PaneCollection` is built above and
   * `applyLayout` (`pane-host.ts`) is the only thing that ever populates it, so every reader here resolves it
   * live rather than at construction time; nothing in this module reads `panes` before `applyLayout`'s
   * first call has run. `view` and `draw` are passed as thunks rather than the values themselves: `view`
   * is not assigned until the `EditorView` construction below, and `draw` (assigned via `createDraw`
   * just below) calls `linkWiring.drawLink` at its own end while `linkWiring.setLinkTo` calls `draw`, so
   * one of the two directions has to be late-bound either way.
   */
  linkWiring = createLinkWiring({
    view: () => view,
    statusHost: linkStatusHost,
    sessions,
    panes,
    draw: () => draw(),
  })

  // ASSIGNED HERE, NOT DECLARED HERE — see the `let draw` comment above for why the split is forced
  // rather than stylistic. `panes` and `linkWiring` both exist as real values by this point (`panes` is
  // still empty until `applyLayout` first runs, near the end of this function — see `linkWiring`'s own
  // comment just above), which is what `createDraw` wants; `view` is still a thunk, for the same reason
  // `linkWiring` above takes it as one.
  //
  // `leaves` IS A NEW DEP (T12) — `leaves: () => leaves(tree).length`, resolved live against the tree
  // rather than a number captured once, because a split or a close changes it and `draw()` runs on
  // every recorded frame during playback. `draw.ts` itself never imports `layout.ts`: `setLayoutControls`
  // needs a leaf count, not a tree, and handing it a thunk over a raw number is what keeps `draw.ts`
  // from holding a second, possibly-stale opinion about the shape `main.ts` already tracks.
  //
  // `sourceAvailable` IS THE SAME ARRANGEMENT FOR THE SPLIT PICKER'S THIRD INPUT — whether a split may
  // be offered the SOURCE pane, which is true exactly while the tree holds no source leaf. It is the
  // same predicate `splitLeaf` refuses on (`kind === 'source' && hasSource(root)`), asked here so the
  // menu never offers what that call would throw on; `layout.ts` keeps its own copy private because a
  // tree operation must enforce its invariant whatever the UI believes.
  draw = createDraw({
    view: () => view,
    sessions,
    panes,
    links: linkWiring,
    leaves: () => leaves(tree).length,
    sourceAvailable: () => !leaves(tree).some((l) => l.pane === 'source'),
    // WRAPPED RATHER THAN PASSED AS `custody.hasEditor`, the same shape `editorHome` below uses for
    // `custody.homeFor`: the methods read `panes`, `sessions` and the two custody maps through the
    // closure `createEditorCustody` returns, and handing the reference over bare would work today only
    // because that object is not built with `this` in mind. This is the one call site that decides
    // whether "bring the term editor to this pane" appears at all — deferred-a11y item 11.
    hasEditor: (session) => custody.hasEditor(session),
  })

  /**
   * THE DEBOUNCE PIPELINE — `compile.ts`'s own doc has the case for `schedule`'s dependencies and for
   * the `supersede()`-before-`setTimeout` ordering that must not move; this is only the construction
   * site. A PLAIN `const`, SAME REASON `replies` BELOW IS ONE: `linkWiring` is a real value by this
   * line, so this needs none of the `let` + thunk indirection `draw`/`linkWiring` themselves used two
   * blocks up. `view` is still passed as a thunk — the picker's `change` listener `compile.ts` wires at
   * construction reads it, and `main.ts` does not assign `view` until the `EditorView` construction
   * below.
   *
   * **IT PASSED `scratchpad`, `panes`, `draw` AND `reconcileEditors` UNTIL 5d-ii-c DECISION 2, and all
   * four served the retire a source keystroke used to perform.** A recompile ends no buffer now
   * (`compile.ts`'s `schedule` records what the deletion cost and what replaced it), and a compile needs
   * nothing but the source session's own client — so this call site shrank with the signature rather
   * than going on handing over dependencies nothing reads. **THE CUSTODY ARGUMENT FOR `reconcileEditors`
   * WAS SAID TO LIVE AT `createReplies`'s CALL BELOW, "WHICH STILL SWEEPS AT THE APP'S REMAINING RETIRE
   * SITE"** — that site is gone too, so the argument lives at `editor-custody.ts`'s `reconcileEditors`
   * and at its callers: `applyLayout`, and the buffer list's retire handler above in this file.
   *
   * **BOTH SENTENCES ABOVE WERE FALSIFIED BY THE COMMIT THAT WIRED THAT HANDLER, WHICH IS WHY THE
   * CORRECTION IS ITSELF RECORDED.** They read "what has not yet replaced it" and "`applyLayout`, the one
   * caller left" — while the same commit was editing `compile.ts` to say the sweep had gained a second
   * caller, and adding that caller ninety-odd lines above this paragraph. A file can contradict itself
   * across two of its own paragraphs in one diff, and this is the instance that proves it: the sweep for
   * stale citations ran over every file that named the missing retire and missed the file that supplied
   * it.
   */
  const compile = createCompile({
    sessions,
    results,
    picker,
    view: () => view,
    links: linkWiring,
    sourceSession: SOURCE_SESSION,
  })

  /**
   * THE TWO REPLY SWITCHES — `replies.ts`'s own doc has the case for why they are one module and what
   * each depends on; this is only the construction site. LAST OF THE FIVE FACTORIES (`transport`,
   * `linkWiring`, `draw`, `compile`, `replies`), AND A PLAIN `const` RATHER THAN A `let` + THUNK LIKE
   * `draw`/`linkWiring` ABOVE — nothing calls `createReplies` before everything it needs already
   * exists: `linkWiring` and `draw` are both real values by this line, and both are passed bare below
   * for exactly that reason — same as `compile` just above does for the same two. `view` is still
   * passed as a thunk for the same reason `linkWiring`/`draw` themselves take it as one two blocks up.
   *
   * `scratchpad` AND `sessions.add(...)` ABOVE ALREADY BUILT THEIR REPLY CALLBACKS AGAINST A NAME —
   * `replies` — THAT DID NOT EXIST YET AT THAT POINT IN THE FILE, and that is the same forward
   * reference this file already relies on for `draw`/`linkWiring` themselves: `(session, reply) =>
   * replies.onScratchReply(session, reply)` and `(reply) => replies.onReply(SOURCE_SESSION,
   * reply)` are arrow function BODIES, not evaluated until a reply actually arrives, by which time this
   * assignment has long since run.
   */
  const replies = createReplies({
    sessions,
    scratchpad,
    results,
    view: () => view,
    panes,
    links: linkWiring,
    draw,
    // **IT TAKES THE REPLY'S OWN SESSION, WHERE IT USED TO BE BOUND TO ONE.** This read `() =>
    // custody.homeFor(LAMBDA_SCRATCH)` and argued that `onScratchReply` "is only ever invoked with
    // `LAMBDA_SCRATCH`", so binding it here saved threading a `SessionId` through every call site in
    // `replies.ts`. 5d-ii-c decision 1 removes the constant that sentence rested on; both call sites
    // over there already hold the session the reply named, so the parameter costs nothing it was
    // avoiding. THIS FILE KEEPS IT WHERE `compile.ts` TAKES NOTHING OF THE KIND, because `replies.ts`
    // has two uses that are not retires: `scratch-compiled` MOUNTS text onto the home pane, and
    // `worker-error` unmounts from a pane whose session is still live and still bound.
    //
    // **`sourceSession` AND `reconcileEditors` WERE PASSED HERE UNTIL DECISION 2's SECOND DELETION**,
    // and both served the retire inside `noSessionReply`'s phantom-fork path — a home for its panes to
    // be sent back to, and a sweep so no `LambdaEditor` outlived the session it killed. That path ends
    // no buffer now (`replies.ts`'s own arm records what the user loses with it), so both arguments
    // followed the same four `compile.ts` shed one task earlier. `custody.reconcile` is unchanged and
    // still reached on every layout gesture through `applyLayout`.
    editorHome: (session: SessionId) => custody.homeFor(session),
  })

  view = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: SAMPLE,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        highlighting,
        declineMark,
        linkMark,
        focusMark,
        // AN EXPLICIT CLICK, NOT A CARET MOVE. Clicking an editor already means "place the caret", and
        // linking on every arrow key would fire constantly while navigating — and, worse, would have
        // to be airtight about the stale-index rule on every keystroke rather than only on clicks.
        // `mouseup` rather than `mousedown`, so a drag that selects text does not also link.
        EditorView.domEventHandlers({
          mouseup: (event, v) => {
            const pos = v.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos === null) return false
            // CodeMirror positions are UTF-16 indices; the index speaks bytes. `Buffer` is not
            // available in a browser, so the conversion goes through the same `TextEncoder` the
            // byte/UTF-16 split already forces everywhere else in this app.
            linkWiring.linkAtSourceOffset(new TextEncoder().encode(v.state.doc.sliceString(0, pos)).length)
            return false
          },
        }),
        // The keyboard route to the same thing. `Mod-'` is unbound in `defaultKeymap` and in
        // `historyKeymap`; verify that before changing it. Reachability without a mouse is the whole
        // point — the roadmap defers the rest of accessibility to one pass at the end of Plan 5, but a
        // mouse-only primary interaction would have to be retrofitted by that pass rather than
        // adjusted.
        keymap.of([
          {
            key: "Mod-'",
            run: (v) => {
              const pos = v.state.selection.main.head
              linkWiring.linkAtSourceOffset(new TextEncoder().encode(v.state.doc.sliceString(0, pos)).length)
              return true
            },
          },
        ]),
        lintGutter(),
        lintFromAnalyze((src) => analyze(src) as Diagnostic[]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          const src = u.state.doc.toString()
          // Synchronous, in the same frame as the keystroke. This is the whole reason `classifySource`
          // is not behind the worker.
          u.view.dispatch({ effects: setSpans.of(classifySource(src) as Classified) })
          // STALE FROM THIS KEYSTROKE UNTIL THE NEXT COMPILE. `linkMark` clears its own decoration on
          // `docChanged`; this clears the state behind it, the status line, AND THE OTHER TWO PANES —
          // design §6 case 4 requires all three cleared, not only the source echo. Before this, the λ
          // window and the δ-table's `.is-linked` rows stayed painted from the PREVIOUS index until the
          // next `compiled` reply landed — up to `DEBOUNCE_MS` plus a compile, seconds on a larger
          // program — while the status line already said "linking resumes when this compiles".
          //
          // A SECOND `drawLink()`/`renderLink()`/`setLink()` CALL SITE, DELIBERATELY — none of this is
          // redundant with `draw()`'s. Nothing here calls `draw()`: `lam.hist`/`tm.hist` have not
          // changed, so repainting both panes on every keystroke would be pure waste. But all three
          // panes still have to go stale THIS keystroke, not 300 ms from now when `compile.schedule`'s
          // debounce finally lands a `compiled`/`no-session` reply — so each gets its own direct, targeted call
          // rather than waiting for `draw()` to earn one. Passed `null`/`[]`/`false` rather than
          // resolving anything: `linkable` is already false on the line above, and every one of these
          // reads that (`drawLink` directly; `renderLink`/`setLink`/`setFocus` take the already-cleared
          // view) before it would ever look at what is linked or focused.
          //
          // `setFocus([])` TOO, NOT ONLY `setLink` — the running focus is the δ-table's own second
          // highlight layer (`TmPane`'s own doc) and goes stale on this same keystroke, for the same
          // reason `.is-linked` does: `tm.hist` is untouched by a keystroke, so without this call the
          // previous program's focused rows would stay painted until the next `compiled` reply.
          // `focusMark` (the CodeMirror decoration) needs no matching call — it clears itself on
          // `docChanged`, same as `linkMark`.
          //
          // AND IT RUNS BEFORE `setLink`, WHICH IS THE ONE THAT DRAWS. `setFocus` is a pure setter (its
          // own doc says why); `setLink` is what calls `#drawTable`, so it has to be the LAST of the two
          // or the cleared focus would not reach the DOM until some later draw. Same rule `draw()`
          // follows by putting its own `setFocus` ahead of `tmPane.render`.
          //
          // PER-LEG, FANNED OUT THROUGH `panes` (T7) — every pane on a leg follows the same app-wide
          // link state, matching `draw.ts`'s and `link-wiring.ts`'s identical loops. THERE ARE NO
          // `lambdaPane`/`tmPane` LOCALS TO CALL STRAIGHT THROUGH ANY MORE (T12): `applyLayout` builds
          // every pane from the tree's leaves, so a leg can now hold more than one, and the collection
          // is the one route every consumer of this rule shares.
          linkWiring.clearLink()
          linkWiring.drawLink(null, false)
          for (const p of panes.of('lambda')) (p.pane as LambdaPane).renderLink(null)
          for (const p of panes.of('tm')) {
            const pane = p.pane as TmPane
            pane.setFocus([])
            pane.setLink([], false)
          }
          compile.schedule(src)
        }),
      ],
    }),
  })

  view.dispatch({ effects: setSpans.of(classifySource(SAMPLE) as Classified) })
  compile.schedule(SAMPLE)
  // THE FIRST RECONCILE, REPLACING THE BARE `draw()` THIS USED TO BE. `applyLayout()` builds the
  // lambda-0/tm-0 panes the default tree names, attaches every host (including `sourceHost`, built
  // above) into `<main>`, persists the tree, and calls `draw()` itself at its own end — so this is
  // still "one call, at the very end of `main()`, after everything else is wired" (`view` included:
  // `linkWiring`/`draw`/`compile`/`replies` all close over it as a thunk, but `draw()`'s own body reads
  // `view()` directly, which is why this cannot run any earlier than here).
  paneHost.applyLayout()
  return view
}

/**
 * The app starts on import — `index.html` loads this module and nothing else.
 *
 * THE VIEW IS EXPORTED AS A PROMISE so the browser tests can drive the editor through CodeMirror's own
 * API rather than synthesizing key events into a contenteditable. Nothing in the product reads it.
 */
export const ready = main()
