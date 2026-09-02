# Width-search fold and brief-reference cleanup — design

**Slice:** `search-fold-and-brief-refs`. Two unrelated cleanups filed as open in the roadmap, taken
together in one branch because they are file-disjoint and each is too small to justify a branch of its
own. Neither adds a capability; neither changes what any program computes.

**One-line statement of what this is:** two library functions each carry their own copy of the TM
field-width search and nothing pins that they keep agreeing, and 45 comments across the tree cite a
per-task "brief" that is not in the tree and never was. The first is folded into one definition; the
second stops pointing at a document no reader can open.

**Scope boundary, decided before anything else:** no behaviour change anywhere. Every width the search
chooses, every `TmRun` variant it returns, and every value any program produces is identical before and
after. Item B touches only comments — no executable line changes in any file it edits.

---

## §1 The tree as it stands — verified 2026-09-02 at `45aa45a`

### §1.1 Item A — the width search

`crates/redextape-core/src/tm.rs` has two public entry points that each run the same search:
`MIN_FIELD_WIDTH`, doubling, up to `MAX_FIELD_WIDTH`, retrying only on `TmRun::Overflow` and treating a
`None` from the per-width attempt as `TmRun::TooLarge`.

`run_tm_fitted` (tm.rs:231) drives `attempt` directly and answers `(TmRun, Option<usize>)`.
`run_tm_described` (tm.rs:346) drives `describe_at` and answers `Result<DescribedRun, TmRun>`. The
loops differ only in what one attempt produces and how the outcome is packaged.

The roadmap filed this in July, under the TM-header slice's *"Still open after slice 2"*, item 3:

> `run_tm_fitted` and `run_tm_described` each carry their own `MIN_FIELD_WIDTH`/doubling/`Overflow`
> retry loop. They agree today and nothing pins that they keep agreeing.

The agreement is currently held by prose. `run_tm_described`'s doc comment says it *"Mirrors
`run_tm_fitted`'s search"* — a claim about another function, checked by nobody.

**The filing named two copies. There are five.** Three further sites re-encode the same ladder, each a
byte-identical `fn widths() -> Vec<usize>` and each documented as a model of the search:

| Site | Doc comment |
|---|---|
| `crates/redextape-core/tests/tm_bank_invariant.rs:65` | `/// Every width auto-fit can choose.` |
| `crates/redextape-core/tests/tm_width_equivalence.rs:38` | `/// Every width auto-fit can choose.` |
| `crates/redextape-core/examples/width_report.rs:110` | `/// Every width auto-fit can choose, narrowest first.` |

**These three are NOT folded, and §2.2 is the argument.**

### §1.2 Item B — the brief references

45 comments across 27 tracked source files cite a per-task brief: the prompt handed to an implementing
subagent, which has never been a file in this repository. A reader who follows one of these pointers
finds nothing, and no gate has ever looked at them.

The roadmap filed this at 15 across 10 files, measured with `grep --include='*.rs'` over `crates/`. That
measurement was scoped two ways its own filing did not state: to Rust, and to the literal lowercase
string `"the brief"`. The class is wider in both directions.

**Measured at `45aa45a`**, counting `brief` as a noun (case-insensitive, less `briefly`, less
`LICENSE.md`'s GPL boilerplate, less `docs/` per §3.3):

```
$ git ls-files -z | grep -zv '^docs/' | grep -zv '^LICENSE.md$' \
    | xargs -0 grep -lic brief | while read -r f; do
        echo $(( $(grep -ic brief "$f") - $(grep -ic briefly "$f") )); done \
    | paste -sd+ | bc
45
```

45 sites across 27 files, against the filing's 15 across 10 — **3.0x on sites, 2.7x on files.** The
spellings the literal-string measurement missed include `the task brief's`, `this probe's brief`,
`this test's brief`, `the same brief`, `T8's BRIEF`, `THE BRIEF'S SIGNATURE` and `BRIEF'S SKETCH`.

**Seven of the 45 are in `web/src/` — production source, not tests** — and no earlier measurement of
this item reached any of them:

| File | Sites |
|---|---|
| `web/src/compile.ts` | 2 |
| `web/src/replies.ts` | 2 |
| `web/src/main.ts` | 1 |
| `web/src/session-worker.ts` | 1 |
| `web/src/style.css` | 1 |

**THIS IS THE THIRD CONSECUTIVE INSTANCE OF A CLASS THIS FILE'S SIBLINGS HAVE ALREADY MEASURED**, and
recording it is worth more than the cleanup. The roadmap's *"grep the tree for a falsified claim"*
lesson states the prediction: *"on this codebase, a list of consequence sites written from memory runs
~2x short."* The encoding-site survey ran 6 → 13 → 14 → 15. The λ-minors list ran 5 → 8 → 9 → 17. This
one runs 15 → 45. **And the first per-file tally taken while writing this spec was short too**, by a
mechanism worth naming because it is dumber than any of those: the file *selector* was case-sensitive
(`grep -c brief`) while the per-file *count* was not (`grep -ic brief`), so every file carrying only
uppercase `BRIEF` — which is **all seven** of the `web/src/` sites, spread across five files — was
dropped from the listing before anything counted it. A measurement is not evidence until its own
selection step is checked.

**AND THIS SENTENCE WAS ITSELF WRONG IN ITS FIRST DRAFT, BY THE FAMILY OF ERROR IT IS ABOUT.** It read
*"five of the seven `web/src/` sites"* — the FILE count (five) wearing the SITE label (seven), in the
one paragraph whose entire subject is a measurement that miscounted. Every one of the five files has
zero lowercase matches (`git show 45aa45a:<f> | grep -c brief` → `0` for all five), so the
case-sensitive selector dropped all seven sites, not five of them. Caught by the agent writing the
closing roadmap entry, re-deriving the figure rather than copying it — which is the only reason it was
caught at all.

---

## §2 Item A — fold the two search loops

### §2.1 What is built

One private helper in `crates/redextape-core/src/tm.rs`, owning the ladder and the retry rule:

```rust
fn search_width<T>(
    mut at: impl FnMut(usize) -> Option<T>,
    overflowed: impl Fn(&T) -> bool,
) -> Option<(T, usize)>
```

`at` runs one attempt at one width and answers `None` for the state-ceiling refusal. `overflowed`
answers whether the outcome is the overflow guard. The helper answers `Some((outcome, width))` for the
width that produced it, or `None` when an attempt refused. Both entry points then map that `None` onto
the `TooLarge` shape their own signature calls for — `(TmRun::TooLarge, None)` for `run_tm_fitted`,
`Err(TmRun::TooLarge)` for `run_tm_described`.

`run_tm_fitted`'s unbounded-encoding branch (`enc.field_width().is_none()` — one attempt, no search, no
width reported) stays where it is, ahead of the call. It is not part of the search.

### §2.2 What is deliberately NOT folded, and why

**The three `widths()` copies in §1.1 stay duplicated.** They are independent models of the search, and
routing them through the library's own definition would make them walk whatever the search says and
stop being able to disagree with it. Two of the three carry assertions that are *about* the ladder:

- `tm_width_equivalence.rs:218` — `assert!(widths_seen.iter().any(|&w| w > MIN_FIELD_WIDTH), ...)`,
  whose message is `"no program ever needed a retry"`.
- `tm_bank_invariant.rs:190` — `the_split_covers_the_whole_cross_product`'s
  `assert_eq!(emitted, expected, ...)`, checking `EMITTED` against the cross product of `widths()` and
  `encodings_at`.

This repository has already paid for the opposite choice, twice, and both precedents are recorded in
the roadmap rather than in a separate named finding: the `nvim-plugin-dir` entry (`####` heading at
`docs/superpowers/plans/2026-07-19-redextape-roadmap.md:14193`) records three green end-to-end
verifications of a plugin that produced no colour, because every harness registered the autocmd the
plugin lacked, and gives the verdict as *"The instrument was the defect, and that outranks the missing
call."* The asm-reader PR 3 entry (heading at line 13122 of the same file) states the general form —
its own sentence hard-wraps mid-word, so the clause that greps to it whole is *"watches cannot notice
that thing changed"* — crediting it to the λ-hang thread in a different subsystem. Duplication is the
isolation here, not an oversight.

**What the slice adds instead is one doc line per copy**, saying the copy is a deliberate independent
model and must not be routed through `tm.rs`. That is the whole change to those three files: a comment,
no executable line. Without it the next sibling search finds three identical functions and folds them,
which is exactly how the assertion above stops being able to fail.

### §2.3 Prose that must change

`run_tm_described`'s *"Mirrors `run_tm_fitted`'s search"* is deleted rather than reworded. After the
fold there is no second search to mirror, and a claim about another function is the drift this item
exists to remove.

The retry rule's explanation — currently a long block on `run_tm_fitted` covering why only the guard
triggers a retry and why the retries are cheap — moves to `search_width`, which is the thing it
describes. The comment inside `run_tm_fitted`'s match explaining why `None` is matched rather than
flattened through `map_or` stays with the mapping, which is where that decision still lives.

---

## §3 Item B — the brief references

### §3.1 The rule

Each of the 45 sites is read and dispositioned individually. There are three dispositions:

1. **Name the document.** Where the fact came from a plan or spec that exists in `docs/superpowers/`,
   cite that file by name. The citation gate permits a path; it rejects `file:line`.
2. **Drop the possessive.** Where the fact stands on its own and the brief was only its provenance,
   the reference goes and the fact stays — `the brief's original 3-element literal` becomes `the
   original 3-element literal`.
3. **Reword to preserve the meaning.** Where the reference is load-bearing, the meaning survives and
   the dangling pointer does not. `tm_foreign_reader.rs:51`'s *"by someone who has not seen the
   brief"* records that the reader was built from doc comments alone — that is the methodological
   claim the whole file rests on, and it must still be readable after the edit.

**Replacement text is NOT prescribed here, and that is deliberate.** The `wire-type-generation` slice
recorded that five of its six correction rounds were for prose the plan or the spec had written rather
than an implementer; the `minor-findings-cleanup` slice recorded four defects written by the plan. A
spec that writes 45 replacement comments from outside the files would be reproducing that exact
failure. The rule above is the deliverable; the wording at each site is the implementer's, made with
the file open.

### §3.2 What "load-bearing" means, so disposition 3 is checkable

A reference is load-bearing when deleting it removes a fact the reader needs and nothing else supplies:
that a figure, layout or method came from **outside** the implementation. The foreign-reader tests are
the clear case — `tm_foreign_reader.rs` and `lambda_foreign_reader.rs` exist to demonstrate that an
independent implementer reading only doc comments reaches the same answer, and their briefs are named
precisely where that independence is qualified. Deleting those references would make the tests claim
more independence than they have.

Everything else is disposition 1 or 2.

### §3.3 `docs/` is out of scope, and it is a boundary rather than an exemption

33 further occurrences live in 7 files under `docs/`, 25 of them in the roadmap. **They stay.** The
roadmap is an append-only log and its entries record what a brief said on the date they were written;
a plan or spec is a dated document making the same kind of statement. Rewriting them would falsify the
record rather than fix a pointer.

**This is not a new argument — it is the one `scripts/check-citations.sh` already makes**, in its own
header, for the same directory and the same reason:

> A citation in source is a POINTER — *go look here* — and it stops being true the moment the target
> moves. A citation in a dated spec, plan or roadmap entry is an OBSERVATION — *on that date, this was
> at that line* — and rewriting it would falsify the record.

Citing that precedent rather than re-deriving it is the point of writing this section: the next sibling
search should find the boundary already argued, in the gate that enforces it, and stop.

### §3.4 No gate is added

Nothing in this slice pins that the references stay gone. A `check-brief-references.sh` was considered
and is not built: the string `brief` is an ordinary English word that appears legitimately (`briefly`,
LICENSE.md, and any future prose using it), so a gate would be a blacklist needing an allowlist beside
it, and `docs/` — which must keep its 33 — would need excluding by path. That is the shape of gate this
repository has watched get defeated repeatedly. **The item is closed by measurement at a named commit,
not by a gate, and the roadmap entry must say so** rather than implying the class cannot return.

---

## §4 Parallelism and the disjointness proof

Two agents, one worktree, one branch, two task-scoped commits.

**Item A writes four files:**

```
crates/redextape-core/src/tm.rs                       (the fold, plus its inline `mod run_tm_tests`)
crates/redextape-core/tests/tm_bank_invariant.rs      (one doc line, §2.2)
crates/redextape-core/tests/tm_width_equivalence.rs   (one doc line, §2.2)
crates/redextape-core/examples/width_report.rs        (one doc line, §2.2)
```

**Item B writes 27 files** — the §1.2 inventory. **None of item A's four files appears in it**, checked
by name rather than asserted: `tm.rs` carries no `brief` occurrence, and `tm_bank_invariant.rs`,
`tm_width_equivalence.rs` and `width_report.rs` are absent from the 27.

The intersection is empty, so the two agents never write the same file. They share the `target/`
directory, where cargo's lock serializes builds rather than corrupting them — the cost is wall clock,
not correctness.

**Commits are serialized even though the edits are not.** The pre-commit gate runs `cargo clippy -D
warnings` over the workspace on every commit, so a commit taken while the other agent's edit is
mid-flight would gate on a tree neither agent intended. Each agent commits only its own files, and the
second waits for the first.

---

## §5 Testing

**Item A adds one test and changes no existing assertion.** The fold is a refactor, so the existing
suite is the primary evidence: `tm_width_equivalence.rs` already asserts that a program needing a retry
gets one, that a program fitting at the floor is not widened, and that `run_tm_described_at` refuses
out-of-range widths. All of it must stay green with no edit.

The new test pins the property the roadmap item names — that the two entry points agree — end to end
through both public functions rather than through the helper, so a future divergence in how each
*calls* `search_width` is caught and not just a divergence inside it.

**The fold must be shown capable of failing.** A refactor whose test suite passes before and after has
demonstrated nothing on its own. Sabotage the helper — change the doubling to `+ 1`, or make
`overflowed` answer `false` — and record which tests redden. A sabotage that reddens nothing is the
finding, not a pass.

**Item B changes no executable line and so adds no test.** Its verification is the measurement in §6
plus the gates: `cargo clippy -D warnings` and `cargo fmt` for the Rust comments, `biome ci` and `pnpm
run typecheck` for the `web/` ones, and `check-citations.sh` for the whole tree — the last because
disposition 1 introduces document names, and a name written as `file:line` would trip it.

---

## §6 Verification

Every figure in the closing roadmap entry names the command that produced it and is re-run at the
commit it describes. Required, at minimum:

```
$ ./scripts/check-all.sh                  # full form, no --no-llvm/--no-browser
$ pre-commit run --all-files
$ git ls-files -z | grep -zv '^docs/' | grep -zv '^LICENSE.md$' \
    | xargs -0 grep -lic brief | while read -r f; do
        echo $(( $(grep -ic brief "$f") - $(grep -ic briefly "$f") )); done \
    | paste -sd+ | bc
0
$ git ls-files -z 'docs/*' | xargs -0 grep -c 'the brief' | grep -v ':0$'   # unchanged at 33
```

The `docs/` figure is re-measured rather than carried forward from §1.2, because the closing entry
itself adds occurrences of the word to the roadmap and the number will have moved. **State the
property — that no non-`docs/` source file cites a brief — alongside whatever the count is**, since the
count is gated by nothing and this file has an entry's worth of history about ungated numbers.

---

## §7 Risks

**The 45 is a measurement, not a guarantee.** It counts the word `brief`. A comment citing the same
document without using that word — *"the task instructions"*, *"the prompt"*, *"what T8 asked for"* —
is the same defect and this inventory cannot see it. The closing entry should say the class was closed
*for the spelling that was searched*, and name the search, rather than claiming the class is gone.

**Disposition 3 can lose a fact quietly.** Rewording to preserve a methodological claim is prose
judgment, and prose is what four of the last two slices' defects were. Each disposition-3 site should
be reviewed against the question *"does the file still say the reader was independent, and to exactly
the degree it was?"* rather than against whether the sentence reads well.

**The fold could hide the unbounded-encoding branch.** `run_tm_fitted` has a path that never enters the
search at all. It must stay outside the helper and stay covered; a test that exercises only bounded
encodings would let it rot unnoticed.
