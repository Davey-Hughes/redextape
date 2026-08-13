import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { lintGutter } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import init, { analyze, classifySource, encodings, tokenClasses } from '../../pkg/redextape_wasm.js'
import { APPEARANCE_LABEL, applyAppearance, nextAppearance, readStored, STORAGE_KEY } from './appearance'
import { showBanner } from './banner'
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
import { LambdaScratchpad } from './scratch'
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
  const root = document.querySelector<HTMLElement>('main')
  if (!results || !editorHost || !linkStatusHost || !picker || !appearanceButton || !restoreLayoutButton || !root) {
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
   * registry is a module survives it: the singleton must be asserted on POOL SIZE, which is not
   * reachable from the DOM, and this app has ONE λ pane — so "two panes on two λ sessions" still
   * cannot be performed here, whatever the registry can hold.
   *
   * **T12 (5d-ii-a) RETIRES THE LAST CLAUSE TOO.** `applyLayout` (`pane-host.ts`) can now put a second
   * `'lambda'`-kind pane on screen from a layout split, and the binding selector already lets either
   * one point at a different registered session — so "two panes on two λ sessions" is mechanically
   * reachable through the UI, not only through `tests/node/sessions.test.ts`'s hand-built panes. What
   * survives is the reason the registry is a module: the SINGLETON is still asserted on pool size,
   * which no DOM query reaches regardless of how many panes exist to watch it.
   */
  const sessions = new SessionRegistry()

  /**
   * The session compiled from the editor's text — the only one that exists today, and the only one
   * that will ever have a `SourceMap` behind it (§3.3: `linkIndex` and `sourceSpan` exist on neither
   * scratch type).
   */
  const SOURCE_SESSION: SessionId = 'source'

  /**
   * The one λ scratchpad — design §4.3's singleton, named here for the reason `SessionEntry.label`'s
   * doc gives: `main.ts` names the app's sessions, `sessions.ts` and `scratch.ts` never do.
   *
   * THE LABEL IS WHAT THE BINDING SELECTOR PUTS IN FRONT OF A USER, so it is words rather than the id
   * — `tests/browser/binding-selector.test.ts` already asserts the options are told apart by their
   * labels and not by colour or position (§6).
   */
  const LAMBDA_SCRATCH: SessionId = 'lambda-scratch'
  const LAMBDA_SCRATCH_LABEL = 'λ scratchpad'

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
   * THE λ SCRATCHPAD — design §4.3's fork, and the thing that makes a second session reachable.
   *
   * ONE OBJECT RATHER THAN A `detach`/`retire` PAIR OF CLOSURES HERE, and the reason is the test the
   * plan names: the singleton claim has to be asserted on POOL SIZE, which is not reachable from the
   * DOM. Before T12 this app had ONE λ pane, so "two source-derived λ panes edited in turn" could not
   * be performed through it at all; a layout split now puts a second one on screen, and the argument
   * for one object survives unchanged — the pool-size assertion still needs `tests/node`, whatever the
   * DOM can now show. `scratch.ts` is a module a test can drive with two slots and fake ports; this
   * line is the app taking the same object.
   *
   * THE REPLY HANDLER IS THE SCRATCHPAD'S OWN, NOT `onReply`. A scratchpad has one leg, no results
   * pane, no link index and no `tmProgram`, so every branch of `onReply` (`replies.ts`) except
   * `lambda-frames` is about state it does not have — routing it there would mean five `if (session ===
   * …)` guards inside a function whose whole point (see its doc) is that a reply belongs to the session
   * whose worker sent it. Two handlers, one per session kind, is the same split §3.2 draws at the port.
   */
  const scratchpad = new LambdaScratchpad({
    registry: sessions,
    pool,
    id: LAMBDA_SCRATCH,
    label: LAMBDA_SCRATCH_LABEL,
    historyBytes: HISTORY_BYTES,
    onReply: (reply: RunReply) => replies.onScratchReply(LAMBDA_SCRATCH, reply),
  })

  // THE SOURCE SESSION, AND NO LONGER THE ONLY ENTRY THE APP EVER HOLDS. It is the only one created
  // at start-up: §4.3's scratchpad is created by a click (`scratchpad` above) and retired by the next
  // recompile.
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
  // `SourceMap` behind it; §3.3 puts `linkIndex` and `sourceSpan` on neither scratch type, so the
  // scratchpad entry is `detached: true` by construction — `LambdaScratchpad.detach` writes the
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
   * THE SOURCE PANE'S HOST, PRE-SEEDED RATHER THAN LEFT TO `hostFor`'s GENERIC BRANCH. `#editor` and
   * `#link-status` are the same two elements `view` and `linkWiring` are constructed against below —
   * `index.html` ships them as bare top-level nodes rather than nested under a `#source` section,
   * because that section no longer exists in the markup at all (the tree builds it). Moving them here,
   * once, before `applyLayout` ever runs, is what lets `hostFor('source', 'source')` find this entry
   * already in `hosts` and return it rather than building an empty section with nothing inside it —
   * the source leaf is chrome around an editor `main.ts` already owns, not a `PaneView` `applyLayout`
   * constructs.
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
  sourceHost.append(sourceTitle, editorHost, linkStatusHost, sourceControls)

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
    lambdaScratch: LAMBDA_SCRATCH,
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
  })

  /**
   * THE DEBOUNCE PIPELINE — `compile.ts`'s own doc has the case for `schedule`'s dependencies and for
   * the `supersede()`-before-`setTimeout` ordering that must not move; this is only the construction
   * site. A PLAIN `const`, SAME REASON `replies` BELOW IS ONE: `draw` and `linkWiring` are both real
   * values by this line, so this needs none of the `let` + thunk indirection `draw`/`linkWiring`
   * themselves used two blocks up. `view` is still passed as a thunk — the picker's `change` listener
   * `compile.ts` wires at construction reads it, and `main.ts` does not assign `view` until the
   * `EditorView` construction below.
   */
  const compile = createCompile({
    sessions,
    scratchpad,
    results,
    picker,
    view: () => view,
    panes,
    links: linkWiring,
    draw,
    sourceSession: SOURCE_SESSION,
    // THE WHOLE SWEEP, NOT A THUNK OVER `editorHomeFor(LAMBDA_SCRATCH)` — Important finding, re-review
    // of the whole-branch review's own custody fix, and `compile.ts`'s own dependency doc has the
    // argument. The narrow version resolved ONE pane, so it could not see a `heldEditors` entry at all,
    // and a custody entry keyed by this constant session id outlived the incarnation that produced it.
    // Passed as the function itself rather than wrapped: `reconcileEditors` takes no session because it
    // sweeps TWO exact domains — `editorOwner` for mounted editors and `heldEditors` for those in
    // custody — which is the generality the narrow thunk was deliberately avoiding and the reason it
    // could not answer this. **`editorOwner` ALONE IS NOT ENOUGH, and saying so here is the point.**
    // The third review round proved it: `reset layout` re-mints `defaultLayout()`'s literal ids, the
    // arriving-leaf sweep drops the stale claim, and a custody entry with no claim then became
    // unreachable from a loop keyed on claims — so the retire swept nothing and the held editor leaked.
    reconcileEditors: custody.reconcile,
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
   * reference this file already relies on for `draw`/`linkWiring` themselves: `(reply) =>
   * replies.onScratchReply(LAMBDA_SCRATCH, reply)` and `(reply) => replies.onReply(SOURCE_SESSION,
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
    sourceSession: SOURCE_SESSION,
    // SAME BINDING AS `compile`'s USED TO BE, AND THE SAME REASON: `onScratchReply` is only ever invoked
    // with `LAMBDA_SCRATCH` (see `scratchpad`'s construction above), so this is bound once here rather
    // than threading a `SessionId` parameter through every call site in `replies.ts`. THIS FILE KEEPS
    // BOTH DEPENDENCIES WHERE `compile.ts` NOW TAKES ONLY THE SWEEP, because `replies.ts` has two uses
    // that are not retires and that a sweep cannot express: `scratch-compiled` MOUNTS text onto the home
    // pane, and `worker-error` unmounts from a pane whose session is still live and still bound.
    editorHome: () => custody.homeFor(LAMBDA_SCRATCH),
    // THE RETIRE INSIDE `noSessionReply`'s PHANTOM PATH — the app's second retire site, swept for the
    // same reason `compile`'s is.
    reconcileEditors: custody.reconcile,
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
