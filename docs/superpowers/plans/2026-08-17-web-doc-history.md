# web doc history — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move retracted-claim prose and measurement transcripts out of `web/src/`'s five largest modules into one history note, leaving the live argument at the call site.

**Architecture:** No code changes at all. Each source file's doc comments are classified block by block under §4.1's three-category rule; retracted claims and transcripts move to `docs/superpowers/notes/2026-08-17-web-doc-history.md` organised file → symbol; each site that loses material gains a one-line pointer citing the symbol, never a line number.

**Tech Stack:** TypeScript doc comments (`/** */`), Markdown. No test framework involvement beyond proving nothing moved.

**Design spec:** `docs/superpowers/specs/2026-08-17-web-doc-history-design.md`. **Read §4.1's rule and §3.1's three worked exemplars before starting any task.**

## Global Constraints

- **NOT ONE LINE OF EXECUTABLE CODE CHANGES.** This is the constraint every task is verified against, mechanically, by Step "prove no code moved" below. Any executable change is a defect, not a bonus.
- **The suite stays at 606 passing in 63 files**, and coverage stays at **95.57 / 89.88 / 98.51 / 98.08**. A moved coverage figure means code was touched.
- **`web/src/`'s `file:line` citation count stays at exactly 7.** Six are `session.rs:257-273`, one is `session-client.ts:15`. Verify with `rg -o '[a-z-]+\.(ts|rs):[0-9]+(-[0-9]+)?' src/ | wc -l`.
- **Nothing is deleted.** Every line that leaves a source file appears in the note.
- **Ambiguity resolves toward STAY.** A block that resists classification stays where it is. The costliest failure here is a live argument leaving with the history.
- **Pointers cite symbols, never lines.**
- Doc comments are `/** */`, never `///`.
- Commit messages carry no attribution trailers.
- Pre-commit runs `tsc --noEmit` and Biome (`--error-on-warnings`). **Never pass `--no-verify`.**
- Work from `/home/davey/projects/redextape/web`. Branch `web-doc-history`. Do not switch branches.

## The two commands every task uses

**Comment ratio** (run before and after, report both):

```bash
awk 'BEGIN{c=0;b=0;code=0}
/^[[:space:]]*\/\*\*/{inb=1} inb{c++; if(/\*\//) inb=0; next}
/^[[:space:]]*\/\//{c++; next}
/^[[:space:]]*$/{b++; next}
{code++}
END{printf "%d lines  %.1f%% comment  %d code\n", c+b+code, 100*c/(c+b+code), code}' src/<FILE>
```

**Prove no code moved** — this is the task's real gate:

```bash
STRIP='/^[[:space:]]*\/\*\*/{inb=1} inb{if(/\*\//) inb=0; next} /^[[:space:]]*\/\//{next} {print}'
diff <(git show HEAD:web/src/<FILE> | awk "$STRIP") <(awk "$STRIP" src/<FILE>) && echo "NO CODE CHANGED"
```

Expected: `NO CODE CHANGED`. **If `diff` prints anything, stop and report it** — do not "fix" it by editing further.

> **THIS COMMAND USED TO WRITE TEMP FILES, AND THAT MADE IT ABLE TO PASS ON STALE INPUT — found by Task 1, and it is the reason the form above uses process substitution.** The shell here runs with `noclobber`, which **silently refuses `>` onto an existing path** and prints `file exists` to stderr. Task 1's redirects were refused, `diff` compared a snapshot from several edits earlier, and the gate printed a passing result for a tree it had not read. **A `file exists` line anywhere near this gate means it is not measuring the current tree.** The form above creates no files and therefore cannot go stale.

**Prove nothing was deleted** — Task 1 added this and it caught two real gaps, so it is mandatory from Task 2 on:

Take every line removed from the source file (`git diff -U0 HEAD -- web/src/<FILE> | grep '^-' | grep -v '^---'`) and confirm each one's distinctive content appears either in the file's new text or in the note. Task 1 did this with a five-word-window coverage check over all 239 removed lines rather than by eye, and **that is the standard** — "I moved it all" is an assertion, and this slice's whole claim is that nothing was lost.

**REPORT THE LIST, NOT THE COUNT — Task 2 is why.** Its report said *"exactly one window in one line is uncovered"*; reproducing the described method gave **twelve uncovered windows across four lines**. Nothing was lost — all four were sentence-boundary seams and both halves were present — but the headline number was wrong, and a normalisation loose enough to produce that number on a 511-line file could swallow a real gap on `main.ts`'s 1540.

So: **list every uncovered window and trace each one to where both halves live.** A bare count is exactly the kind of claim this slice has already had to abandon once (see the categorical-disclosure section). If tracing them all is tedious, that is the check working — the tedium is the evidence.

### Slice attributions STAY

A doc often ends a claim with its provenance — *"— 5d-ii-d T9 fix round 1"*, *"— Important finding, review of this fix"*. **These stay at the call site by default**, which is already the majority pattern in the tree: Task 2 left four in place and moved one, and the one it moved was the outlier.

Move an attribution only when it is attached to a **retracted** claim and travels with it. An attribution on live prose is part of the live record of why the code says what it says.

## File Structure

| file | responsibility | task |
| --- | --- | --- |
| `docs/superpowers/notes/2026-08-17-web-doc-history.md` *(create)* | The history note, organised file → symbol | 1, appended by 2–5 |
| `web/src/scratch.ts` | 1193 lines, 84.2% comment, 163 code, 27 retracted markers | 1 |
| `web/src/editor-custody.ts` | 511 lines, 84.1% comment, 73 code | 2 |
| `web/src/pane-host.ts` | 898 lines, 76.1% comment, 201 code | 3 |
| `web/src/main.ts` | 1540 lines, 69.7% comment, 421 code | 4 |
| `web/src/buffer-list.ts` | 393 lines, 69.7% comment, 103 code | 5 |

**Task 1 is first because it is the hardest and it sets the convention.** `scratch.ts` is the worst ratio, holds the most retracted markers, and carries the one clear measurement transcript (`MAX_WARM_BUFFERS`). Getting the rule right there — and reviewed — before applying it four more times is the point of the ordering.

---

### Task 1: `scratch.ts`, and the note it creates

**Files:**
- Create: `docs/superpowers/notes/2026-08-17-web-doc-history.md`
- Modify: `web/src/scratch.ts`

**Interfaces:**
- Produces: the note's structure and the pointer wording, both consumed verbatim by Tasks 2–5.

- [ ] **Step 1: Record the starting ratio**

Run the comment-ratio command on `src/scratch.ts`. Expected: `1193 lines  84.2% comment  163 code`. Record it.

- [ ] **Step 2: Read the rule and its exemplars**

Read spec §4.1 (the three-category table) and §3.1 (a worked exemplar of each category, all three quoted from this file). Do not proceed on a paraphrase.

- [ ] **Step 3: Create the note with this exact skeleton**

```markdown
# web doc history

Retracted claims and measurement transcripts moved out of `web/src/` by the
`web-doc-history` slice, so the call site keeps the live argument and this note
keeps the record. Nothing here was deleted from the tree; it was moved.

**Organised file → symbol.** A code site that lost material carries a pointer
naming its symbol; find that symbol below.

**Why not the roadmap:** the roadmap's entries answer *"what did slice N do"*.
This answers *"why does this symbol say what it says"* — a different question,
asked by someone looking at code who does not know which slice touched it.

---

## `web/src/scratch.ts`

### `<symbol>`

**What the doc claimed.** <the retracted text, quoted>

**What falsified it.** <what changed, and why>

**Slice.** <e.g. 5d-ii-d, review round 2 finding 3>
```

For a measurement transcript, use this entry shape instead:

```markdown
### `<symbol>` — <what was measured> transcript

<the raw figures, as a table or list, exactly as they read at the call site>

**The conclusion these support stays at the call site.**
```

- [ ] **Step 4: Classify and move, block by block**

Walk `src/scratch.ts` top to bottom. For each doc block, classify every paragraph under §4.1's table.

`rg -n 'USED TO|used to say|used to read|THIS PARAGRAPH|that sentence|review round|took that back' src/scratch.ts` finds 27 sites and is **where to look first, not the rule**. A block that never uses those words can still be pure history; one that does can carry a live argument in its second half.

The two known-largest wins, both verified present:
- **`MAX_WARM_BUFFERS`** — 113 lines for one integer. Its *"THIS USED TO BE A CHOICE, NOT A MEASUREMENT"* paragraph is retracted; its three-run n=11 byte-count list is a transcript; its *"VERIFIED AT n = 11 DIRECTLY, NOT ONLY EXTRAPOLATED"* reasoning and the pre-registered threshold are **live argument and stay**.
- **`noSessionReply`** — ~125 lines on a 6-line body.

- [ ] **Step 5: Add pointers where material left**

One line per affected site, this wording:

```
For what this doc used to claim and why it changed, see the history note under `<symbol>`.
```

**A MEASUREMENT TRANSCRIPT NEEDS A DIFFERENT REFERENCE, AND TASK 1 FOUND THIS BY WRITING THE WRONG ONE FIRST.** *"What this doc used to claim"* is false of figures that were never retracted — every byte count in a transcript is current and correct. Use this second form, which names the symbol like the first one does:

```
— the per-run figures are in the history note under `<symbol>` — transcript.
```

**No pointer where nothing moved.** A file of uniform pointers is noise.

### The heading rule

Task 1 arrived at this and it should be applied deliberately from here on. A doc block's heading often mixes a live claim with its retraction — *"X IS TRUE NOW, AND THIS PARAGRAPH USED TO SAY OTHERWISE"*.

- **If the heading's first clause is live, keep it** and leave only the trailing "…and this used to say otherwise" as the hook the pointer answers.
- **If the heading has no live half, rewrite it to the claim the paragraph is now making.**

Both were done correctly in Task 1 — compare `` `collapsed` HAS A WRITER AND A READER NOW `` (kept) against `fork`'s heading, which was rewritten wholesale because its live half did not exist.

### Connective edits MUST be disclosed in the note

Moving a paragraph out often forces a small repair to the prose left behind — a count that referred to the moved text, a "the" that pointed at a list which is now elsewhere.

**Every such edit is disclosed in the note entry, not only in the task report.** Task 1 made ten, got all ten right, and disclosed one — miscounting it as "one word changed" when it changed three and added two.

**Why this matters:** the note's whole value is being the trustworthy record of a pure move. An undisclosed reword is how "it was a move" quietly stops being true.

### The disclosure is CATEGORICAL, not an enumeration — and Task 1 is why

**DO NOT LIST THE INDIVIDUAL REPAIRS.** Each note entry that lost material carries one sentence:

> The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted above in full.

**THE ENUMERATION WAS TRIED FIRST AND MISCOUNTED FOUR TIMES ON ONE FILE — 10 → 11 → 14 → 17**, each round confident it had finished. The failure mode was finally characterised as *"the sweep found one repair per paragraph and moved on"*, so a paragraph already holding a found repair was never re-checked for a second. Even after the method was corrected from list-sweeping to diff-derivation, the next count was still short by three.

**A claim that has been wrong four times is worse than no claim.** The categorical sentence cannot miscount, is always true, and costs nothing.

**NOTHING IS LOST BY DROPPING THE LIST, WHICH IS WHAT MAKES THIS SAFE RATHER THAN MERELY CHEAPER.** Every note entry quotes the full pre-move text in a blockquote. A reader who wants a specific repair diffs that blockquote against the file — which is exactly what they would have to do to *trust* an enumeration anyway. The precision the list promised was never available at a glance; it was only ever a claim to check.

**Say once, at the top of the note, what a repair is:** a dangling reference left behind when a paragraph moves — a pronoun whose antecedent went, a tense word whose referent went, a count that named the moved list.

- [ ] **Step 6: Prove no code moved**

Run the strip-and-diff command from the top of this plan against `src/scratch.ts`. Expected: `NO CODE CHANGED`.

- [ ] **Step 7: Verify the citation count is unchanged**

Run: `rg -o '[a-z-]+\.(ts|rs):[0-9]+(-[0-9]+)?' src/ | wc -l`
Expected: `7`. Any increase means a `file:line` citation was introduced — a direct violation of §4.3.

- [ ] **Step 8: Typecheck, lint, and record the closing ratio**

Run: `pnpm run typecheck && pnpm exec biome check --error-on-warnings src/scratch.ts`
Then re-run the ratio command. Report before and after. **Do not chase a number** — report what the rule produced.

- [ ] **Step 9: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/scratch.ts docs/superpowers/notes/2026-08-17-web-doc-history.md
git commit -m "web-doc-history: scratch.ts keeps the argument, the note takes the record

The worst ratio in web/src at 84.2% comment against 163 lines of code, and 27
retracted-claim markers. MAX_WARM_BUFFERS spent 113 lines on one integer and
noSessionReply ~125 on a six-line body.

Retracted claims and the n=11 measurement transcript move to the note; the
pre-registered threshold and the reason to believe the number stay where a
reader deciding whether to change the constant will be standing.

No executable line changed — verified by stripping comments from both revisions
and diffing."
```

---

### Task 2: `editor-custody.ts`

**Files:**
- Modify: `web/src/editor-custody.ts`, `docs/superpowers/notes/2026-08-17-web-doc-history.md`

**Interfaces:**
- Consumes: Task 1's note structure and pointer wording. **Use them verbatim** — two conventions is worse than the ratio.

- [ ] **Step 1: Record the starting ratio.** Expected: `511 lines  84.1% comment  73 code`.

- [ ] **Step 2: Classify and move.** Same rule. This file's history is dominated by custody-ownership claims that later slices falsified — `editorOwner`'s "SET IN TWO PLACES ONLY" enumerations, and the scratch→scratch leak recorded as live and later closed. **The leak's record was rewritten to "was live, now closed" in 5d-ii-d's last fix round; that rewrite is itself history and moves, while the current statement of what closes it stays.**

- [ ] **Step 3: Add pointers where material left.** Task 1's wording.

- [ ] **Step 4: Prove no code moved.** Strip-and-diff. Expected `NO CODE CHANGED`.

- [ ] **Step 5: Citation count still 7.**

- [ ] **Step 6: Typecheck, lint, record before/after ratio.**

- [ ] **Step 7: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/editor-custody.ts docs/superpowers/notes/2026-08-17-web-doc-history.md
git commit -m "web-doc-history: editor-custody.ts, statistically tied with scratch.ts at 84.1%

Its history is mostly ownership enumerations later slices falsified, and a
scratch-rebind leak recorded as live and then closed. The record of that
correction moves; what currently closes the leak stays.

No executable line changed."
```

---

### Task 3: `pane-host.ts`

**Files:**
- Modify: `web/src/pane-host.ts`, the note

- [ ] **Step 1: Record the starting ratio.** Expected: `898 lines  76.1% comment  201 code`.

- [ ] **Step 2: Classify and move.** Same rule, Task 1's conventions verbatim.

**Take particular care with `mountScratchEditor` and the creation-pass comment.** They are the newest prose in the file, they carry the reasoning for a behaviour fix that shipped days ago, and one of them was corrected once already for overstating which cases it repairs. Their *live* argument — why the `hasEditor` gate is the right gate, why the restore claim sits after `applyLayout()` — is exactly what a reader needs and **stays**.

- [ ] **Step 3: Add pointers where material left.**

- [ ] **Step 4: Prove no code moved.**

- [ ] **Step 5: Citation count still 7.**

- [ ] **Step 6: Typecheck, lint, record before/after ratio.**

- [ ] **Step 7: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/pane-host.ts docs/superpowers/notes/2026-08-17-web-doc-history.md
git commit -m "web-doc-history: pane-host.ts at 76.1%

The ordering argument for the restore claim and the hasEditor gate's reasoning
stay — they are what a reader changing this file needs. The record of the
positions that were tried and rejected moves to the note.

No executable line changed."
```

---

### Task 4: `main.ts`

**Files:**
- Modify: `web/src/main.ts`, the note

- [ ] **Step 1: Record the starting ratio.** Expected: `1540 lines  69.7% comment  421 code`.

- [ ] **Step 2: Classify and move.** Same rule, Task 1's conventions verbatim.

**The restore sequence's 44-line block is the one to think hardest about.** It records three rejected positions, each with the specific `TypeError` it produced, and closes with "WHAT WOULD BREAK THIS". A whole-branch reviewer called it *the best documentation on the branch*.

**Classification:** the rejected positions and their `TypeError`s are **history and move**. The statement of the order that holds, why it holds, and what would break it is **live argument and stays** — it is the thing that stops the next person reordering `main()` and reintroducing a start-up crash. Splitting this block correctly is the highest-value judgement in the slice; if you cannot split it cleanly, **leave it whole and say so**.

- [ ] **Step 3: Add pointers where material left.**

- [ ] **Step 4: Prove no code moved.**

- [ ] **Step 5: Citation count still 7.**

- [ ] **Step 6: Typecheck, lint, record before/after ratio.**

- [ ] **Step 7: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/main.ts docs/superpowers/notes/2026-08-17-web-doc-history.md
git commit -m "web-doc-history: main.ts, the composition root

The restore sequence keeps the order that holds, why it holds, and what would
break it — that is what stops the next reorder reintroducing a start-up crash.
The three rejected positions and the TypeErrors they produced move to the note.

No executable line changed."
```

---

### Task 5: `buffer-list.ts`

**Files:**
- Modify: `web/src/buffer-list.ts`, the note

- [ ] **Step 1: Record the starting ratio.** Expected: `393 lines  69.7% comment  103 code`.

- [ ] **Step 2: Classify and move.** Same rule, Task 1's conventions verbatim.

The retire-dismisses-versus-temperature-rebuilds asymmetry is **live argument and stays** — it reads as an inconsistency without it. The record of the temperature control shipping unstyled, unnamed and stale-on-click is **history and moves**.

- [ ] **Step 3: Add pointers where material left.**

- [ ] **Step 4: Prove no code moved.**

- [ ] **Step 5: Citation count still 7.**

- [ ] **Step 6: Typecheck, lint, record before/after ratio.**

- [ ] **Step 7: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/buffer-list.ts docs/superpowers/notes/2026-08-17-web-doc-history.md
git commit -m "web-doc-history: buffer-list.ts at 69.7%

The retire-dismisses / temperature-rebuilds asymmetry stays — it reads as an
inconsistency without its argument. The record of the control shipping
unstyled, unnamed and stale-on-click moves to the note.

No executable line changed."
```

---

## Closing the branch

- [ ] Run `pnpm test`. Expected: **606 passed in 63 files**, unchanged.
- [ ] Run `pnpm test:coverage`. Expected: **95.57 / 89.88 / 98.51 / 98.08**, unchanged. **A moved figure means code was touched — investigate before proceeding.**
- [ ] Run the ratio command on all five files and record before/after in one table.
- [ ] Run `rg -o '[a-z-]+\.(ts|rs):[0-9]+(-[0-9]+)?' src/ | wc -l`. Expected: **7**.
- [ ] Confirm the note accounts for every block that left. Spot-check three moved blocks by searching the note for a distinctive phrase from each.
- [ ] Report the resulting ratios **without editorialising them against the declined 50% target** — spec §4.4 declines it with arithmetic, and the number is a result rather than a goal.
