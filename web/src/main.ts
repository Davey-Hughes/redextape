import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { lintGutter } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import init, { analyze, classifySource, encodings, tokenClasses } from '../../pkg/redextape_wasm.js'
import { APPEARANCE_LABEL, applyAppearance, nextAppearance, readStored, STORAGE_KEY } from './appearance'
import { showBanner } from './banner'
import { createCompile } from './compile'
import { createDraw } from './draw'
import { declineMark, focusMark, highlighting, linkMark, setSpans } from './highlight'
import { History } from './history'
import type { LambdaEditor } from './lambda-editor'
import { LambdaPane } from './lambda-pane'
import {
  closeLeaf,
  defaultLayout,
  LAYOUT_STORAGE_KEY,
  type LayoutNode,
  leaves,
  parseLayout,
  resize,
  serializeLayout,
  splitLeaf,
} from './layout'
import { renderLayout } from './layout-view'
import { createLinkWiring, type LinkWiring } from './link-wiring'
import { lintFromAnalyze } from './lint'
import { layoutControls, type PaneEvents } from './pane-chrome'
import { type LeafId, PaneCollection, type PaneKind } from './panes'
import type { Leg, RunReply } from './protocol'
import { HISTORY_BYTES } from './protocol'
import { createReplies } from './replies'
import { LambdaScratchpad } from './scratch'
import { type SessionId, SessionPool } from './session-client'
import { PaneSlot, SessionRegistry } from './sessions'
import { TmPane } from './tm-pane'
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

/** The id a `splitLeaf` call mints for the new leaf it creates. */
function nextLeafId(leg: Leg): LeafId {
  return `${leg}-${leafCounter++}`
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
   * **T12 (5d-ii-a) RETIRES THE LAST CLAUSE TOO.** `applyLayout` (below) can now put a second
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
  // recompile, so the selector has one option to offer until someone forks — which is why
  // `bindingSelect` renders nothing on a fresh page and appears the moment there are two. That is the
  // control's stated idiom, not a gap: see its doc.
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
   * reference rather than a value (T7's own shape, one step earlier now). `applyLayout` below is the
   * only thing that ever calls `.add`/`.remove` on it; `linkWiring`/`draw`/`compile`/`replies` just
   * hold onto the same object and read it live, which is what makes them tolerant of it being empty
   * at construction time.
   */
  const panes = new PaneCollection()

  /**
   * Which pane currently holds each scratch session's editor — design §4.3's fork, extended by wave 3
   * (5d-ii-a)'s editor-moves rule.
   *
   * ONE `LambdaEditor` PER SCRATCH, MOUNTED WHEREVER IT WAS LAST ASKED FOR. Not one instance per pane
   * with a policy keeping copies in step: two uncoordinated CodeMirror instances over one buffer
   * desynchronize between debounces and resolve last-write-wins at recompile, which is a control that
   * provably cannot work, offered anyway. Moving the live view (`LambdaPane.takeEditor`/`receiveEditor`,
   * `reconcileEditors` below) makes that state unrepresentable rather than policed, and cursor,
   * selection and undo survive because nothing is destroyed.
   *
   * CLOSING THE HOLDER UNMOUNTS WITHOUT REASSIGNING. The scratch is a session and no pane's death
   * retires one; the next pane to ask (`showEditor` in `paneEvents` below) re-mounts the same view.
   * Relocating on close would put the editor somewhere the user did not put it, which is the state
   * design §4.2 refuses movement for — `editorHomeFor` below is what makes a stale entry (closed, or
   * rebound away) resolve to "no home" rather than to a fallback pane. `heldEditors` below is where
   * the unmounted view WAITS in the meantime, and without it "the next pane to ask re-mounts the same
   * view" was a sentence with nothing behind it.
   *
   * SET IN TWO PLACES ONLY: `paneEvents`'s wrapped `detach` (the first mount, at the moment a fork
   * succeeds) and its `showEditor` (every later move). Nothing else ever writes this map — a rebind
   * away from the scratch leaves the entry stale on purpose, per the paragraph above.
   */
  const editorOwner = new Map<SessionId, LeafId>()

  /**
   * A session's `LambdaEditor` while NO pane holds it — custody between the close of the pane that had
   * it and the claim of the pane that asks for it next.
   *
   * **IMPORTANT FINDING, WHOLE-BRANCH REVIEW BEFORE MERGE: WITHOUT THIS, CLOSING THE HOLDER STRANDED
   * THE EDITOR AND THE CONTROL TO RETRIEVE IT STAYED OFFERED.** `applyLayout` drops a closed pane from
   * `panes` before anything asks it for its editor, and `reconcileEditors` only ever iterates
   * `panes.of('lambda')` — so the `LambdaEditor` was left mounted in a host no longer in the tree, with
   * nothing holding a reference that could reach it. Meanwhile the surviving pane, still bound to the
   * scratch and still holding no editor, kept offering "bring the term editor to this pane"
   * (`LambdaPane.#refreshClaim`'s `#detached && #editor === null`), and clicking it did nothing —
   * forever. **That is the exact failure this slice's own standard names first: a control that provably
   * cannot work must not be offered.** Rather than withdraw the control, the editor is taken into
   * custody so the control works — which is what design §4.3 promises in as many words: "the next pane
   * to ask for the editor re-mounts the same view with its text, cursor and undo intact".
   *
   * KEYED BY SESSION, NOT BY THE CLOSED `LeafId`, because that is the key the next claim arrives under:
   * `showEditor` writes `editorOwner.set(slot.binding.session, id)` and `reconcileEditors` asks per
   * session. Keying by the closed leaf would be keying by something no claim ever mentions.
   *
   * **THE PREMISE THIS USED TO ARGUE FROM IS FALSE, AND THE CORRECTED ONE POINTS THE SAME WAY — Minor
   * finding, re-review of this fix.** It read "the closed leaf's id is never reused (`nextLeafId` only
   * counts up), so keying by it would be keying by something nothing can ask for again". `nextLeafId`
   * does only count up, but it is not the only source of ids: `defaultLayout()` writes `source`,
   * `lambda-0` and `tm-0` down as literals and `reset layout` re-mints all three, so a closed `lambda-0`
   * comes back — and `parseLayout` can restore any id a stored tree holds. A leaf id is therefore a
   * WEAKER key than a session, not merely a differently-shaped one: it can be inherited by a pane that
   * has nothing to do with the one that claimed the editor. `applyLayout`'s pane-creation loop drops
   * exactly that inheritance for `editorOwner` (which IS keyed by leaf) where it happens.
   *
   * NOT A SECOND HOME. Nothing renders from here and nothing reads through it — it is exactly the "one
   * instance, unmounted, not destroyed" state design §4.3 describes, made addressable. An entry lives
   * only from the close that produced it to the next `reconcileEditors` that finds a home for it, or to
   * the retirement of its session, whichever comes first — and BOTH ENDINGS ARE NOW REACHED BY THE SAME
   * FUNCTION, which they were not when this sentence was first written: retiring used to happen on a
   * path that never reconciled, so the second ending never arrived. See `reconcileEditors`' own doc.
   *
   * **AND "THE SAME FUNCTION" WAS NOT ENOUGH ON ITS OWN — IMPORTANT FINDING, THIRD REVIEW ROUND.** That
   * function ran both its passes inside one loop over `editorOwner.keys()`, so it could only reach an
   * entry HERE for a session that also held a claim — and the Minor fix beside this one (`applyLayout`'s
   * pane-creation loop, which drops a claim recorded against an arriving leaf id) deletes exactly that
   * claim while the entry stays. The two endings then both went missing for the same entry: no home was
   * ever found for it, and its session's retirement swept nothing. `reconcileEditors` now iterates THIS
   * MAP for its custody pass rather than the claim map, which is what makes the sentence above a fact
   * about the code rather than about the common case.
   */
  const heldEditors = new Map<SessionId, LambdaEditor>()

  /**
   * The session a freshly split leaf should be bound to, consulted once by `applyLayout`'s pane-creation
   * loop and then discarded.
   *
   * A SPLIT INHERITS THE SESSION OF THE PANE IT CAME FROM, RATHER THAN DEFAULTING TO THE SOURCE SESSION
   * — the layout tree itself cannot carry this (`layout.ts`'s own doc: "no binding is persistable... the
   * runtime pairing lives in `panes.ts`, keyed by `LeafId`"), so this side map is what lets `splitRow`/
   * `splitColumn` (in `paneEvents` below) say "the new leaf starts on whatever session I am showing"
   * before `applyLayout` ever constructs the `PaneSlot` that holds that fact for real. Without it, every
   * split would default to the source session regardless of what was split — which would make "split a
   * forked λ pane" produce a SECOND pane on the SOURCE session rather than a second view onto the same
   * scratch, and `tests/browser/two-lambda-panes.test.ts`'s "moves the one editor" test has no other way
   * to reach two panes bound to one scratch without an explicit rebind.
   */
  const pendingBinding = new Map<LeafId, SessionId>()

  /**
   * The host element for `id`, created on first request and kept forever after.
   *
   * KEPT RATHER THAN REBUILT, WHICH IS DESIGN §4.3's DETACH-NOT-DESTROY RULE AT THE APP LAYER. Program
   * text is not persisted anywhere, so a host rebuilt on close would take the CodeMirror instance —
   * and the user's program — with it. `renderLayout` only ever appends, so a host that leaves the tree
   * is simply not appended and its live view waits in this map.
   */
  const hosts = new Map<LeafId, HTMLElement>()
  const hostFor = (id: LeafId, kind: PaneKind): HTMLElement => {
    const existing = hosts.get(id)
    if (existing !== undefined) return existing
    const el = document.createElement('section')
    el.className = 'pane'
    el.dataset.leaf = id
    el.dataset.kind = kind
    hosts.set(id, el)
    return el
  }

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
  sourceHost.dataset.leaf = 'source'
  sourceHost.dataset.kind = 'source'
  const sourceTitle = document.createElement('h2')
  sourceTitle.textContent = 'source'
  /**
   * THE SOURCE PANE'S OWN CLOSE CONTROL — `layoutControls`'s doc records why source is refused a SPLIT
   * and not a close: there is one editor, so there is nothing to duplicate into, but closing the source
   * pane is exactly `hostFor`'s detach-not-destroy rule doing its job — the editor and its text wait in
   * `hosts` and come back intact the moment the leaf does (`tests/browser/two-lambda-panes.test.ts`'s
   * "keeps the program" test).
   *
   * A SEPARATE `layoutControls` INSTANCE, NOT ROUTED THROUGH `paneEvents`, BECAUSE THE SOURCE PANE HAS
   * NO `PaneSlot`. `paneEvents` is built for a `(LeafId, PaneSlot<K>)` pair — `applyLayout`'s own `if
   * (l.pane === 'source') continue` is exactly the statement that no such pair exists for this leaf —
   * so the closure here re-states `close`'s two lines directly against the literal id `'source'` rather
   * than manufacturing a slot that would have nothing to resolve.
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
      const grew = neighbourOf(tree, 'source')
      tree = closeLeaf(tree, 'source')
      applyLayout()
      focusPane(grew)
    },
  })
  sourceHost.append(sourceTitle, editorHost, linkStatusHost, sourceControls)
  hosts.set('source', sourceHost)

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
   * A pane's events, including the layout gestures the pane itself cannot answer.
   *
   * THE LEAF ID IS CLOSED OVER HERE RATHER THAN PASSED THROUGH THE PANE, which is why `PaneEvents`'s
   * members below take no arguments. A pane does not know its place in the tree and does not need to;
   * this closure is the one place that pairs a pane with its leaf.
   *
   * `detach`/`showEditor` ARE WRAPPED RATHER THAN LEFT TO `transport.events`, AND ONLY FOR THE λ LEG —
   * `transport.ts` resolves a fork against the registry and the source index, neither of which knows a
   * `LeafId` exists; `editorOwner` is keyed by one, so pairing the two has to happen here, the same
   * division `splitRow`/`splitColumn`/`close` already draw for the layout gestures below them.
   */
  const paneEvents = <K extends Leg>(id: LeafId, slot: PaneSlot<K>): PaneEvents => {
    const base = transport.events(slot)
    return {
      ...base,
      ...(slot.binding.leg === 'lambda'
        ? {
            // THE FIRST-MOUNT HALF OF `editorOwner`. `base.detach` (when it fires at all — the guards
            // inside `transport.ts`'s own handler can decline) REBINDS `slot` SYNCHRONOUSLY, before this
            // wrapper resumes, so `slot.binding.session` already names the scratch by the time this
            // line runs — checked rather than assumed, because a declined attempt leaves the binding
            // exactly where it was (still the source session), and recording ownership for a fork that
            // never happened would point `editorOwner` at a session with no editor to come.
            detach: (step: number) => {
              base.detach?.(step)
              if (slot.binding.session === LAMBDA_SCRATCH) editorOwner.set(LAMBDA_SCRATCH, id)
            },
            // THE MOVE HALF. Only `editorOwner` changes here — `reconcileEditors` (below `applyLayout`)
            // is what actually relocates the mounted `LambdaEditor`, which is what lets this handler stay
            // as small as `PaneEvents.showEditor`'s own doc says it should be: report the click, know
            // nothing else.
            showEditor: () => {
              editorOwner.set(slot.binding.session, id)
              applyLayout()
            },
          }
        : {}),
      splitRow: () => {
        const newId = nextLeafId(slot.binding.leg)
        pendingBinding.set(newId, slot.binding.session)
        tree = splitLeaf(tree, id, 'row', newId)
        applyLayout()
      },
      splitColumn: () => {
        const newId = nextLeafId(slot.binding.leg)
        pendingBinding.set(newId, slot.binding.session)
        tree = splitLeaf(tree, id, 'column', newId)
        applyLayout()
      },
      close: () => {
        const grew = neighbourOf(tree, id)
        tree = closeLeaf(tree, id)
        applyLayout()
        focusPane(grew)
      },
    }
  }

  /**
   * Move focus into `id`'s pane after a close.
   *
   * THE ACCESSIBILITY LIST'S ITEM 1, AGGRAVATED PAST EVERYTHING ON IT AND THEREFORE FIXED HERE RATHER
   * THAN FILED. That item's measured instance is `tm-pane.ts`'s reattach, which strands focus on
   * `<body>` after a click; `[continue]` shares the idiom but survives its own click in the common case
   * because `controls.ts` keeps the button when a run hits `budget` again. A close control removes the
   * clicked element UNCONDITIONALLY, every time, so leaving this would add the list's worst instance in
   * the same slice that writes the list.
   *
   * IT TARGETS THE PANE THAT GREW, NOT THE FIRST FOCUSABLE THING ON THE PAGE. The space the closed pane
   * occupied is now that pane's, so it is where the user is looking.
   *
   * `:not([disabled])` IS LOAD-BEARING, NOT DEFENSIVE STYLE — found by this task's own Step 8 dry run.
   * A `querySelector('button, ...')` with no exclusion matches the transport strip's `↺` FIRST, in DOM
   * order, ahead of the layout controls this close just repainted — and `↺`/`◀`/`▶`/`⏵` are disabled
   * (`controls.ts`'s `canRestart`/`canBack`/`canForward`/`canPlay`) whenever the leg they belong to has
   * no history yet, which is exactly the state a pane can be in the moment this fires. `.focus()` on a
   * disabled control is a silent no-op per the HTML spec, not a thrown error, so without this the
   * symptom is indistinguishable from the bug Step 8 exists to reproduce: `document.activeElement`
   * stays `<body>` even though the call ran. `[hidden]` gets the same treatment for the same reason —
   * the continue button (`controls.ts`'s `extend`) is hidden rather than disabled when there is nothing
   * to continue, and a hidden element cannot take focus either.
   */
  const focusPane = (id: LeafId | null): void => {
    if (id === null) return
    const host = hosts.get(id)
    const target = host?.querySelector<HTMLElement>('button:not([disabled]):not([hidden]), select, [tabindex]')
    target?.focus()
  }

  /**
   * Reconcile panes to leaves, re-render the tree, and persist it.
   *
   * PANES ARE CREATED AND REMOVED HERE AND NOWHERE ELSE, so "which panes exist" has exactly one answer
   * and it is derived from the tree rather than tracked alongside it.
   *
   * IT DOES NOT DESTROY A REMOVED PANE'S HOST — see `hostFor`. A closed pane's element leaves the DOM
   * and its entry leaves the collection; the element itself, and any CodeMirror instance inside it,
   * stays in `hosts` and is remounted intact if the leaf returns.
   *
   * **A REMOVED λ PANE'S EDITOR IS TAKEN INTO CUSTODY BEFORE THE PANE LEAVES THE COLLECTION**, which is
   * the ordering the whole fix turns on: after `panes.remove`, nothing can reach that `LambdaPane` to
   * ask it. The host being kept by `hostFor` is no help either — it is kept so that a leaf which RETURNS
   * comes back intact, and a `LambdaPane` built over a returning host rebuilds its children from scratch
   * (`replaceChildren` in the constructor), so the editor left inside the old one is unreachable
   * whichever way the id goes. See `heldEditors` for what this repaired and why the survivor's "bring
   * the term editor to this pane" control was previously offered on a promise it could not keep.
   *
   * A NEW LEAF'S SESSION COMES FROM `pendingBinding`, NOT ALWAYS `SOURCE_SESSION` — see that map's own
   * doc. Consulted and cleared in the same pass. The reason this used to give for the clearing being
   * merely belt-and-braces was "ids are minted once by `nextLeafId` and never reused within a page's
   * life", AND THAT IS FALSE: `reset layout` re-mints `defaultLayout()`'s three literal ids, so an id
   * genuinely can arrive here having been used before (`heldEditors` has the correction in full). What
   * still makes a stale entry unreachable is timing rather than uniqueness — `splitRow`/`splitColumn`
   * write the entry and call `applyLayout` in the next statement, so every entry is consumed by the pass
   * that follows the write. The clearing is what keeps that a local fact instead of an invariant a
   * future caller has to know. The re-minting itself is answered directly, one line into the loop below:
   * an arriving id drops any `editorOwner` claim recorded against it.
   *
   * `reconcileEditors()` RUNS AFTER PANES EXIST AND BEFORE THE TREE PAINTS — after, because it needs
   * `panes.get` to resolve the panes `editorOwner` names; before painting, though the two are otherwise
   * independent (one moves a `LambdaEditor` inside a host, the other moves hosts inside `<main>`),
   * simply so a split that both creates a new pane AND moves the editor onto it settles in one pass
   * rather than a visible one-frame lag.
   */
  const applyLayout = (): void => {
    const live = new Set(leaves(tree).map((l) => l.id))
    for (const p of panes.all()) {
      if (live.has(p.id)) continue
      // THE CUSTODY HANDOVER, AND IT HAS TO BE ON THIS SIDE OF `panes.remove` — see this function's own
      // doc. `takeEditor()` returns `null` for every λ pane that was not holding one, which is all of
      // them on an ordinary close, so this costs a method call and a field read on the way out.
      if (p.slot.binding.leg === 'lambda') {
        const held = (p.pane as LambdaPane).takeEditor()
        if (held !== null) heldEditors.set(p.slot.binding.session, held)
      }
      panes.remove(p.id)
    }

    // THE SOURCE PANE'S OWN CLOSE CONTROL, DRIVEN FROM HERE RATHER THAN FROM `draw()`'s PER-FRAME LOOP.
    // That loop is `panes.all()`, and the source leaf has no `PaneEntry` (`applyLayout`'s own `if (l.pane
    // === 'source') continue` below is exactly why) — but `canClose` only changes when the leaf count
    // does, which is only ever true right here, at a structural change, never on a recorded frame during
    // playback. Driving it from `applyLayout` rather than adding a source-shaped special case to `draw()`
    // is answering the fact where it changes rather than threading it through a per-frame path that has
    // no other reason to know this pane exists.
    sourceLayout.update(live.size > 1, false)

    for (const l of leaves(tree)) {
      if (panes.get(l.id) !== undefined) continue
      if (l.pane === 'source') continue // the source pane is chrome inside its host, not a PaneView
      // A LEAF ID ARRIVING FRESH DROPS ANY EDITOR CLAIM RECORDED AGAINST IT — Minor finding, re-review
      // of the whole-branch review's own custody fix, and the behaviour half of the correction
      // `heldEditors`' doc carries above. `reset layout` re-mints `defaultLayout()`'s three LITERAL ids,
      // so a closed `lambda-0` genuinely does come back, and `editorOwner` was still naming it: the
      // moment the user pointed the NEW `lambda-0` at the scratch, `editorHomeFor` resolved it as the
      // editor's home and the next layout gesture delivered the held editor onto a pane that never asked
      // for it — while the "bring the term editor to this pane" control withdrew itself as it arrived.
      // That is the silent relocation design §4.2 and §4.3 both refuse, performed by nobody.
      //
      // A PANE BUILT HERE IS BY DEFINITION NOT THE PANE THAT CLAIMED ANYTHING: every writer of
      // `editorOwner` (`paneEvents`'s wrapped `detach` and `showEditor`) records the id of a pane that
      // already existed when the click landed, so an id reaching this loop can only be inheriting a
      // claim, never restating one. The entry is dropped rather than repointed for the reason
      // `editorOwner`'s own doc gives for never relocating on close: the editor waits in custody, the
      // claim control stays offered on any pane bound to the session, and a click is what moves it.
      // Deleting the current key mid-iteration is defined behaviour for a `Map` — the iterator visits
      // entries in insertion order and simply does not revisit a removed one.
      //
      // AND IT LEAVES THE HELD EDITOR REACHABLE ONLY THROUGH `heldEditors` ITSELF, which is the half of
      // this line that the third review round found missing on the other side. Dropping the claim is
      // right; what was wrong is that `reconcileEditors` then had no domain in which the surviving
      // custody entry appeared, so neither a later home nor its own session's death could reach it. See
      // that function's own doc — its custody pass iterates `heldEditors` for exactly this line's sake.
      for (const [claimed, owner] of editorOwner) if (owner === l.id) editorOwner.delete(claimed)
      const host = hostFor(l.id, l.pane)
      const session = pendingBinding.get(l.id) ?? SOURCE_SESSION
      pendingBinding.delete(l.id)
      if (l.pane === 'lambda') {
        const slot = new PaneSlot('lambda', session)
        panes.add({ id: l.id, kind: 'lambda', slot, pane: new LambdaPane(host, paneEvents(l.id, slot)), host })
      } else {
        const slot = new PaneSlot('tm', session)
        panes.add({ id: l.id, kind: 'tm', slot, pane: new TmPane(host, paneEvents(l.id, slot)), host })
      }
    }

    // **`try`/`finally`, AND THE `finally` IS THE WHOLE POINT — IMPORTANT FINDING, THIRD REVIEW ROUND.**
    // `LambdaPane.receiveEditor` throws when it is handed a second editor, deliberately (its own doc: a
    // silent repair would absorb the finding as normal operation). It stays throwing. What changed is
    // what the throw COSTS: `reconcileEditors` is called from the middle of this function, so an
    // exception escaping it took `renderLayout`, `writeLayoutStorage` and `draw()` with it — and every
    // caller is a click handler, so the measured result was a model that had gained a leaf, a DOM that
    // had not, and a `localStorage` entry still holding the previous tree. **The tree, the DOM and
    // storage disagreeing is a worse state than the one the guard is reporting**, and it is one nothing
    // else in this app can repair. The three lines below run either way now; the exception still leaves
    // this function, still reaches `window`'s `error` event, and is still what the tests assert on.
    try {
      reconcileEditors()
    } finally {
      for (const l of leaves(tree)) hostFor(l.id, l.pane)
      renderLayout(root, tree, hosts, (path, index, delta) => {
        tree = resize(tree, path, index, delta)
        applyLayout()
      })
      writeLayoutStorage(serializeLayout(tree))
      draw()
    }
  }

  /**
   * The pane currently showing `session`'s scratch editor, or `undefined` if no pane currently is.
   *
   * A LOOKUP THROUGH `editorOwner` GUARDED BY THE PANE'S OWN BINDING, NOT A BARE MAP READ. Closing the
   * owning pane leaves `editorOwner` pointing at a `LeafId` that `panes` no longer holds (`editorOwner`'s
   * own doc: closing unmounts without reassigning), and rebinding the owning pane away from the session
   * leaves the SAME stale entry pointing at a pane that no longer wants it. Both are "no current home",
   * not "the wrong home" — resolving them to `undefined` is what keeps `setEditor`/`receiveEditor` from
   * ever being called on a pane whose slot disagrees with the session a caller is asking about.
   */
  const editorHomeFor = (session: SessionId): LambdaPane | undefined => {
    const id = editorOwner.get(session)
    if (id === undefined) return undefined
    const entry = panes.get(id)
    if (entry === undefined || entry.slot.binding.session !== session) return undefined
    return entry.pane as LambdaPane
  }

  /**
   * Make every `LambdaEditor` in the app — mounted on a pane, or waiting in custody — agree with where
   * this file says it belongs. The other half of the editor-moves rule, for the one way ownership can
   * change with nothing arriving on the wire to drive it: the
   * "bring the term editor to this pane" control (`claimEditorButton`). **Not to be confused with
   * `collapseButton`'s "show the term editor"**, which is a different action on a different pane — it
   * un-collapses an editor this pane ALREADY owns, and moves nothing. The two carried the same label
   * until a review pointed out that a screen-reader user heard one name for both.
   * `replies.ts`'s `scratch-compiled` case is the other way ownership takes
   * effect, and it needs no such sweep — `editorOwner` already names the right pane by the time a reply
   * can arrive (`paneEvents`'s wrapped `detach` sets it synchronously, before the worker round trip that
   * produces one), so `setEditor` there lands directly.
   *
   * **TWO PASSES OVER TWO DOMAINS, AND THE SECOND DOMAIN IS AN IMPORTANT FINDING OF THE THIRD REVIEW
   * ROUND.** The sweep is a statement about CLAIMS, so it iterates `editorOwner`; custody is a statement
   * about an editor with nowhere to be, so it iterates `heldEditors`. Both passes used to live inside
   * ONE loop over `editorOwner.keys()`, which made this function's opening sentence — then, as now, a
   * claim about EVERY editor — false of any held editor whose session held no claim. That is not a
   * hypothetical state: the Minor fix in the same commit as the custody one has `applyLayout`'s
   * pane-creation loop DROP the claim recorded against an arriving leaf id, and `reset layout` re-mints
   * `defaultLayout()`'s literal ids, so dropping it is exactly what `reset layout` does after a close.
   * **Six clicks, and both fixes are individually correct**: fork `lambda-0`, close it, `reset layout`
   * (drops the claim, leaves the entry), type in the SOURCE editor (retires the scratch — and the sweep
   * this retire calls could not see the entry, so the editor over the terminated worker survived), fork
   * again on the fresh `lambda-0` (a second, live editor, mounted legitimately), then split any pane.
   * The custody pass then handed the live pane the dead editor and `receiveEditor` threw. What caught
   * it was concatenating the two tests those two fixes shipped with — neither sequence reaches it alone;
   * `tests/browser/two-lambda-panes.test.ts`'s concatenation test is the result.
   *
   * RUN ON EVERY `applyLayout()` CALL RATHER THAN ONLY WHEN `editorOwner` CHANGED. The sweep is cheap
   * (`panes.of('lambda')` is at most a handful of entries, and there is at most one scratch session to
   * iterate today) and self-correcting: a pane that already agrees with its owner costs one
   * `takeEditor()` call that returns `null` and nothing more, so there is no separate "did anything
   * change" flag for every caller that touches `editorOwner` to keep in step.
   *
   * A STALE OWNER RESOLVES TO NO HOME, NOT TO A FALLBACK PANE — `editorHomeFor`'s own doc has the two
   * ways it goes stale. Reassigning to some other pane bound to the session would be exactly the
   * "relocating on close puts the editor somewhere the user did not put it" `editorOwner`'s doc refuses.
   * An editor taken off a pane that is still ON SCREEN and no longer wants it (the REBIND-away case) is
   * destroyed, because the session behind it is one the user has navigated away from; an editor whose
   * pane was CLOSED is a different case and is not destroyed — see the custody pass below.
   *
   * THE CUSTODY PASS IS SECOND, AND THE ORDER IS LOAD-BEARING. It mounts a `heldEditors` entry onto the
   * home if there now is one, and it runs AFTER the sweep so that a home which has just been handed an
   * editor by the sweep is not handed a second one. Splitting the two passes apart (above) STRENGTHENED
   * that ordering rather than weakening it: every sweep now runs before any custody mount, where before
   * only the sweep for the same session did.
   *
   * **WHAT THAT ORDER DOES AND DOES NOT BUY, CORRECTED — IMPORTANT FINDING, RE-REVIEW OF THIS FIX.**
   * This paragraph used to assert that "the two can never both fire for one session (there is one editor
   * per session, so if a pane holds it, custody does not)". **That was false across a retire, and the
   * six-step sequence in `tests/browser/two-lambda-panes.test.ts` is the falsification.** The λ scratch's
   * session id is a CONSTANT that the next fork re-registers, so a custody entry keyed by it survived
   * its session's death — the retire path called `draw()` and never `applyLayout()`, so the
   * `!sessions.has(session)` branch below never ran — and a later fork then mounted a SECOND editor for
   * the same id on the pane the stale entry named. Both did fire, `receiveEditor` overwrote a live
   * `#editor`, and design §4.3's structurally impossible state was on screen: two `.cm-editor`s in one
   * pane, the pane pointing at the one over the terminated worker and the live one orphaned in the DOM.
   *
   * **WHAT IS TRUE NOW IS A CONJUNCTION OF THREE THINGS, AND THE ORDER OF THE TWO PASSES IS ONLY THE
   * WEAKEST OF THEM.** (1) EVERY RETIRE SWEEPS EVERY HELD EDITOR: both retire sites — `compile.ts`'s
   * recompile-from-source and `replies.ts`'s phantom-fork `no-session` — call this function, AND its
   * custody pass iterates `heldEditors` itself, so no custody entry can outlive the incarnation of the
   * session it is keyed by. **The second half of that sentence is the third round's correction and it is
   * not a detail**: while both passes shared one loop over `editorOwner.keys()`, "every retire sweeps"
   * described a function whose body could not see an entry no claim named, and one existed after every
   * `reset layout`. (2) `receiveEditor` THROWS rather than overwriting, so if the two ever do both fire,
   * the app says so at the moment of the mistake instead of silently orphaning a live view — and the
   * throw now costs the caller its gesture and nothing more (see `applyLayout`'s `try`/`finally`).
   * (3) The order below then means that even a case satisfying both — a session with an editor mounted
   * on a pane AND an entry in custody — hands the sweep's editor over first, so custody's throw names
   * the sweep as the arrival that got there first. WITHIN one page-load incarnation the old sentence is
   * still true and still worth keeping for that reason: there is one editor per session, so if a pane
   * holds it, custody does not.
   *
   * **THE `heldEditors` ENTRY IS DROPPED AFTER A SUCCESSFUL MOUNT, NEVER BEFORE — the leak half of the
   * third round's finding.** `heldEditors.delete(session)` used to run on the line ABOVE
   * `home.receiveEditor(waiting)`, so the throw that (2) exists to raise dropped the app's LAST
   * reference to a live `EditorView` — with its own pending debounce — before the call that would have
   * given it a new home. An invariant violation left the editor unrecoverable, which is the one outcome
   * a guard must not have; deleting after the mount leaves the entry exactly where the next
   * `reconcileEditors` can find it again. The destroy branch below is the opposite case and deletes
   * FIRST on purpose: there, losing the reference is the point.
   *
   * A HELD EDITOR WHOSE SESSION IS GONE IS DESTROYED HERE. `LambdaScratchpad.retire` removes the entry
   * from the registry and rebinds every pane back to source, so no pane will ever ask for that editor
   * again — and `replies.ts`'s `editorHome()?.setEditor(null)`, the call that would normally tear an
   * editor down, resolves to `undefined` for a session whose owning pane is closed and is therefore a
   * no-op. (It resolves to `undefined` after ANY retire, in fact — `retire` rebinds every slot before it
   * returns, so `editorHomeFor` can no longer match one — which is why `compile.ts` no longer calls it
   * at all; that file's own doc has the measurement.) Without this line a retirement during custody
   * would leak one live `EditorView` with its own pending debounce over a terminated worker.
   */
  const reconcileEditors = (): void => {
    for (const session of editorOwner.keys()) {
      const home = editorHomeFor(session)
      for (const p of panes.of('lambda')) {
        const pane = p.pane as LambdaPane
        if (pane === home) continue
        const held = pane.takeEditor()
        if (held === null) continue
        if (home !== undefined) home.receiveEditor(held)
        else held.destroy()
      }
    }

    // ITERATED WHILE BEING DELETED FROM, WHICH IS DEFINED BEHAVIOUR FOR A `Map` — the same fact
    // `applyLayout`'s claim-dropping loop relies on, and for the same reason: the iterator walks entries
    // in insertion order and does not revisit a removed one. Nothing here ADDS an entry (only
    // `applyLayout`'s removal loop does), so the walk cannot be extended by its own work either.
    for (const [session, waiting] of heldEditors) {
      const home = editorHomeFor(session)
      if (home !== undefined) {
        home.receiveEditor(waiting)
        heldEditors.delete(session)
      } else if (!sessions.has(session)) {
        heldEditors.delete(session)
        waiting.destroy()
      }
    }
  }

  restoreLayoutButton.addEventListener('click', () => {
    tree = defaultLayout()
    applyLayout()
  })

  /**
   * THE LINK STATE — `link-wiring.ts`'s own doc has the argument for why `index`/`linkable`/`link`/
   * `forkFailed` live there now instead of as four `let`s in this scope. `panes` IS HANDED OVER EMPTY,
   * NOT "AFTER BOTH PANES EXIST" AS THIS USED TO READ — `PaneCollection` is built above and
   * `applyLayout` (below) is the only thing that ever populates it, so every reader here resolves it
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
  draw = createDraw({
    view: () => view,
    sessions,
    panes,
    links: linkWiring,
    leaves: () => leaves(tree).length,
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
    reconcileEditors,
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
    editorHome: () => editorHomeFor(LAMBDA_SCRATCH),
    // THE RETIRE INSIDE `noSessionReply`'s PHANTOM PATH — the app's second retire site, swept for the
    // same reason `compile`'s is.
    reconcileEditors,
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
  applyLayout()
  return view
}

/**
 * The app starts on import — `index.html` loads this module and nothing else.
 *
 * THE VIEW IS EXPORTED AS A PROMISE so the browser tests can drive the editor through CodeMirror's own
 * API rather than synthesizing key events into a contenteditable. Nothing in the product reads it.
 */
export const ready = main()
