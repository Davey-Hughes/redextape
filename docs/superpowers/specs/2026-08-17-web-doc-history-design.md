# web doc history — the call site keeps the argument, the note keeps the record

## §1 What is being built, and what forced it

`web/src/`'s five largest modules are between 69.7% and 84.2% comment. The 5d-ii-d whole-branch review recorded it as *"the single biggest comprehensibility risk on the branch"*, and declined to fix it there because relocating prose is its own piece of work with its own review.

| file | lines | comment | code |
| --- | ---: | ---: | ---: |
| `scratch.ts` | 1193 | 84.2% | 163 |
| `main.ts` | 1540 | 69.7% | 421 |
| `pane-host.ts` | 898 | 76.1% | 201 |
| `editor-custody.ts` | 511 | 84.1% | 73 |
| `buffer-list.ts` | 393 | 69.7% | 103 |

**THE PROBLEM IS NOT LENGTH, AND SAYING SO IS THE WHOLE BASIS OF THIS SLICE.** This repo's doc comments are long on purpose and that is not being reversed. The problem is that a reader must walk through paragraphs of **retracted** claims to reach each current fact. `scratch.ts` carries 27 retracted-claim markers; `noSessionReply` spends ~125 lines on a 6-line body, `MAX_WARM_BUFFERS` 113 lines on one integer.

**THE MATERIAL IS NOT DUPLICATED ANYWHERE, WHICH IS WHY THIS IS A MOVE AND NOT A DELETION.** Verified before the design was written rather than assumed: of three distinctive retracted phrases probed against the roadmap, two return **zero** hits (*"EIGHT IS A CHOICE"*, *"Panes are NOT rebound"*). The file is the sole record. Deleting would lose it.

## §2 The decisions

1. **Three categories, and the boundary between them is the whole design.** Live argument stays; retracted claim moves; measurement transcript moves. §4.1.
2. **One new note, organised file → symbol**, at `docs/superpowers/notes/2026-08-17-web-doc-history.md`. Not the roadmap. §4.2.
3. **Every site that loses material keeps a one-line pointer, cited by SYMBOL, never by line.** §4.3.
4. **No target percentage is promised.** The rule decides what moves; the ratio is a result, not a goal. §4.4.
5. **All five files, one pass, one convention.** §4.5.
6. **Not one argument is deleted.** Anything that cannot be classified stays where it is. §4.6.

## §3 What verification established before any code was written

### 3.1 THE THREE CATEGORIES ARE REAL, AND EACH HAS A CLEAN EXEMPLAR IN THE TREE

Sampled from `scratch.ts` rather than invented.

**Retracted — moves.** `MAX_WARM_BUFFERS`, on what its own doc used to claim:

> **THIS USED TO BE A CHOICE, NOT A MEASUREMENT, AND SAID SO AT LENGTH.** The doc here read *"EIGHT IS A CHOICE, NOT A MEASUREMENT, and is recorded as such"* … and walked through the arithmetic behind eight … before closing on *"A LATER SLICE REPLACES IT WITH A MEASURED CAP"*.

Nothing there tells a reader what the constant *is*. It tells them what it was, and the story of how it stopped being that.

**Live argument — stays.** The same doc, on why the number is trustworthy:

> **VERIFIED AT n = 11 DIRECTLY, NOT ONLY EXTRAPOLATED.** The probe's sweep grew a fourth point at exactly the derived count … precisely because a two-point marginal projected seven buffers further is an extrapolation and eleven concurrent workers is exactly the range where a non-linearity would first show.

That is the reason to believe 11, and a reader deciding whether to change the constant needs it in front of them.

**Measurement transcript — moves.** Immediately following, three runs of byte counts:

> * Run 1: measured total 489,753,148 bytes; intercept (a) + measured = 528,026,172 bytes (503.56 MiB) — **fits**, ≈8.44 MiB of headroom.

**THIS THIRD CATEGORY IS WHY THE FIRST DRAFT OF THE RULE WAS INSUFFICIENT.** A run transcript is not retracted — every figure is current and correct — and it is not argument either. It is evidence. Left in place it is most of `MAX_WARM_BUFFERS`'s 113 lines; moved, the conclusion and the threshold stay and the reader who wants the raw readings knows where they are.

### 3.2 THE CITATIONS ARE ALREADY CLEAN, SO THIS SLICE CANNOT CLAIM CREDIT FOR THEM

`web/src/` holds exactly **seven** `file:line` citations, and six are the same one — `session.rs:257-273`. Checked against the tree: it lands precisely on the `Result`-pairing doc block whose fabricated-state cost the citing comments say it "prices". Accurate.

**That is 5d-ii-d's citation sweep holding, not this slice's doing**, and it sets this slice's obligation rather than relieving it: a relocation pass is exactly the operation that invalidates citations, so the pass must not introduce any, and the note must cite symbols from the start.

### 3.3 THE OPERATION IS THIS BRANCH FAMILY'S MOST COMMON DEFECT, PERFORMED DELIBERATELY

5d-ii-d produced **eleven** findings of comments asserting something untrue. Mass-moving prose while leaving live argument intact is the same operation those eleven arose from, done on purpose and at scale. §5's review obligations exist for that reason and are not boilerplate.

## §4 The design

### 4.1 THE CLASSIFICATION RULE

| category | test | disposition |
| --- | --- | --- |
| **Live argument** | Does a reader need this *while reading the code* — to understand what it does, or why it is this way rather than a plausible alternative? | **Stays** |
| **Retracted claim** | Does it describe what the doc, the code or the design *used to* say or do? | **Moves** |
| **Measurement transcript** | Is it raw evidence — run figures, byte counts, per-round readings — rather than the conclusion drawn from it? | **Moves; the conclusion stays** |

**A PARAGRAPH THAT RESISTS THE TEST STAYS WHERE IT IS.** Decision 6 is not a formality: the failure mode with the highest cost here is a live argument leaving with the history, and the rule is deliberately biased so that ambiguity resolves toward *stay*.

**THE MARKERS ARE A STARTING POINT, NOT THE RULE.** `rg 'USED TO|used to say|THIS PARAGRAPH|review round'` finds 27 sites in `scratch.ts`, and they are where to look first — but a block that never uses those words can still be pure history, and one that does can carry a live argument in its second half. Every block is read and classified; nothing is moved by pattern match.

### 4.2 THE NOTE

`docs/superpowers/notes/2026-08-17-web-doc-history.md`, organised **file → symbol**, each entry recording: the symbol, what was claimed, what falsified it, and which slice.

**NOT THE ROADMAP, AND THE REASON IS THE READER RATHER THAN THE SIZE.** The whole-branch review recommended filing this into slice closing entries. Two things argue against it. The roadmap's entries answer *"what did slice N do"*; this material answers *"why does this symbol say what it says"* — a different question, asked from a different starting point, by someone who is looking at code and does not know which slice touched it. And a claim retracted across three slices has no single entry to live in.

**A DEDICATED NOTE ALSO KEEPS THE ROADMAP'S OWN COST FROM GROWING.** It is ~7,500 lines and gains a closing entry per slice; adding per-symbol comment history would make it the place two unrelated kinds of question are asked.

### 4.3 THE POINTER

Every site that loses material keeps one line naming where it went:

> For what this doc used to claim and why it changed, see the history note under `<symbol>`.

**BY SYMBOL, NEVER BY LINE.** 5d-ii-d's most common defect sub-class was stale `file:line` citations — fifteen at its whole-branch review, several invalidated by insertions made in the same commit that wrote them, one having become a false instruction. A symbol survives every edit that does not rename it. `buffer-affordability.test.ts` cites 24 times with zero drift, and cites other files, which is the property being copied.

**A SITE THAT LOSES NOTHING GAINS NOTHING.** No pointer is added where no material moved; a file of uniform pointers is noise.

### 4.4 NO TARGET PERCENTAGE — AND THE REVIEW'S SUGGESTED ONE IS DECLINED WITH A REASON

The whole-branch review proposed *"get `scratch.ts` under 50% comment without deleting a single argument, only relocating the retracted ones."* **Both halves cannot hold at once.** 961 lines of code across the five files against ~3,400 of comment means 50% requires moving ~2,300 lines; the retracted and transcript material is closer to 600–900. The remainder is live argument, which the rule says stays.

**SO THE RATIO IS REPORTED, NOT TARGETED.** A number to hit would put pressure on exactly the judgement call §4.1 biases toward *stay*, which is the one place this slice can do real damage.

### 4.5 ALL FIVE FILES, ONE PASS

`scratch.ts`, `main.ts`, `pane-host.ts`, `editor-custody.ts`, `buffer-list.ts`. One convention applied once, rather than two files now and three later under a drifted rule.

### 4.6 NOTHING IS DELETED

Every line removed from a source file appears in the note. The pass is a move, verifiable as one: §5 requires the reviewer to check that the note accounts for what left.

## §5 Testing

**There is no test tier for prose, and pretending otherwise would be worse than saying so.** What replaces it:

1. **The suite must stay green and coverage must not move.** No behaviour changes, so `pnpm test` stays at 606/63 and the four coverage figures stay where they are. **A moved coverage figure means code was touched and is a finding, not a surprise.**
2. **A reviewer checks the three failure modes**, each stated so it can be checked rather than assessed:
   - **A live argument left with the history.** For each moved block, does the call site still answer *why is the code this way?*
   - **A pointer naming a symbol that does not exist.** Every pointer resolves.
   - **Material lost rather than moved.** The note accounts for every line that left.
3. **No new `file:line` citation** appears in `web/src/`. The count stays at seven.

## §6 What this does not do

- **It does not shorten a single live argument.** Long docs stay long where the length is carrying reasoning.
- **It does not touch `web/tests/`.** Test files carry their own history and are out of scope; the rule can be applied there later under the same note.
- **It does not add the pre-commit citation checker.** That is a separate follow-up on its own branch, and it validates the state this slice produces.
- **It changes no code.** Any line of executable change in this slice is a defect.
