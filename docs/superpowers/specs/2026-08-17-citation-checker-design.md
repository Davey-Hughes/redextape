# the citation checker — a pointer must be true now, an observation only had to be true once

## §1 What is being built, and what forced it

Two things, in this order:

1. **The 55 surviving `file:line` citations in tracked source are converted to symbol citations.** Resolving each one is the staleness audit; the conversion is what the audit produces.
2. **`scripts/check-citations.sh` then rejects the form outright**, mirrored into CI the way `scripts/check-text-bytes.sh` already is.

**THE ORDER IS THE DESIGN, AND THE ROADMAP NAMED IT BEFORE THIS SLICE EXISTED.** 5d-ii-d considered a mechanical checker and declined it as *"the right instrument … the wrong moment"*, closing on: *"a checker over a tree that **has already converted** is a much smaller thing to get right."* `web/src` converted on that branch. `crates/` did not — only because 5d-ii-d was constrained not to touch Rust. That constraint expired when the branch merged, and the gate is cheap precisely to the degree the tree is already clean when it lands.

### 1.1 THE EVIDENCE THAT THE SURVIVORS ARE ROTTING, MEASURED RATHER THAN ASSUMED

5d-ii-d resolved 49 citations across its own changed files by script and found **15 stale, every one undershooting** — pointing at a line that still existed but whose content had moved down.

Four of the surviving Rust citations were checked by hand for this design. **Three are stale, and all three undershoot:**

| citation | what the citing comment claims is there | what the line actually holds | off by |
| --- | --- | --- | ---: |
| `zipper_equivalence.rs` → `lower.rs:611` | `Let { mutable: true }`'s own tag | a blank line above `lower_region_body`'s doc. That arm's own tag — its `Ok(app_owned(abs(STORE, cont), new_store, *id))` — is at **655** | 44 |
| `zipper_equivalence.rs` → `lower.rs:766` | `build_while`'s root tag | a bare `}`, closing `in_position`'s `match`. `fn build_while` does start five lines below at 771, but the sentence names the ROOT TAG inside it, `Ok(app_owned(app(fix(), g), s_init, id))`, at **810** | 44 |
| `lambda_provenance.rs` → `lower.rs:637` | the `Let { mutable: **false** }` arm's own tag | `origins.at_root(*id)` in the `Let { mutable: **true** }` arm — a **sourcemap origin**, not the term-owner tag the sentence is about. The `false` arm's own `Ok(app_owned(..))` is at **681** | 44 |

**THIS TABLE WAS CORRECTED IN PLACE, AND ITS THREE MAGNITUDES WERE ONE NUMBER MISREAD THREE WAYS.** It
shipped reading 26, 5 and 27. Every one of the three is a drift of **44**, all three under the same
commit — `clippy::pedantic` (#31). The magnitudes came out small because the *replacement* coordinates
this table originally offered were themselves the wrong anchor: **637** and **664** are the two arms'
`origins.at_root` calls, sourcemap origins rather than the term-owner tags the citing sentences
census, and **771** is `fn build_while` rather than the root tag inside its body. Measured against the
tags the sentences actually name — 655, 810 and 681 — the drift is 44 every time. At `#31`'s parent
those same three tags sit at exactly 611, 637 and 766, which is what makes the three 44s one event
rather than three coincidences. **The verdict the table exists to support is untouched: three of the four
hand-checked citations were stale, and all three undershoot.** Only the magnitudes and two of the named
targets were wrong. Coordinates in this table are as they stood at the branch point `08b3442`; the
correction is a rewrite rather than a footnote for the reason §4.4's and §3.4's were — *a wrong number
gets fixed, and a note saying it is wrong is not a fix* — and because this document is a live contract,
so a wrong number in it ships as an instruction.

**THE THIRD IS THE FALSE-INSTRUCTION CLASS AGAIN.** A reader following it lands on the opposite arm from the one the finding is about, and the arm they land on is plausible enough to read as confirmation. 5d-ii-d found one of these too — *"Delete `main.ts:1240` and this line sees `{}`"* naming an unrelated comment — and recorded that the sentence was the only surviving record of what the test protected.

**They undershoot for a structural reason, not a careless one.** A file grows above the line being cited, and the commonest way for that to happen is the citing commit itself. Several on 5d-ii-d were invalidated by insertions made in the same breath that wrote them.

#### ADDENDUM, ADDED AFTER THE CONVERSION RAN — THE MECHANISM ABOVE IS CONFIRMED AND IT IS THE RAREST OF FOUR

**The mechanism paragraph above stands as written. Its evidence table did not, and has been corrected in place** — see the note under it; the three drift magnitudes were wrong and the verdicts were not. The prose is a correct inference from the evidence it had, and the mechanism it names is real. Resolving all 57 rather than a sample of four measured how often it fires, which four citations cannot show. Split over the **37 stale**, derived row by row from the per-task ledgers:

| how the citation came to be wrong | count |
| --- | ---: |
| a later, unrelated commit shifted the target | 28 |
| never correct at any revision — the pointer matched no state that entered history | 4 |
| **the citing commit itself** | 3 |
| the target was deleted, the work relocated to another file | 1 |
| mechanism not established by the record | 1 |

**The citing-commit case is confirmed four times and only three of the four are stale today**; the fourth is accurate through two errors cancelling. The demonstration is exact: `9fbd911` wrote two citations at `lower_asm.rs:321`, which at `9fbd911~1` *was* the `if src != dst` guard both sentences name, and the same commit then added +4 and +3 lines above it in two unrelated `unwrap` → `if let` rewrites.

**The correction that matters for §4.1 runs the other way from what this changes.** One lint sweep over 104 files — `clippy::pedantic` (#31), whose only behaviour changes were three edge-case defect fixes in unrelated files — moved the targets of fifteen citations across two test files **while having both of those files open**, and re-resolved none of them. A convention asking authors to be careful cannot reach that, and a convention asking them to re-check pointers into files they are not editing reaches it less. The gate is the answer to the 28, not to the 3.

The roadmap entry closing this slice carries the full derivation.

### 1.2 WHY AN ALLOWLIST WAS CONSIDERED AND REJECTED

The cheap version of this gate ships in an afternoon: ban the form, allowlist the 55, zero false positives on day one. It was the first recommendation and it is wrong for three reasons.

- **It contradicts the convention it exists to enforce.** The roadmap states the rule with no exemptions: *"CITE SYMBOLS, NEVER LINES, FOR ANYTHING IN THIS REPO."*
- **It blesses exactly the citations most likely to be stale** — §1.1's sample says roughly half — and then declares them permanently out of scope.
- **The audit is the value.** Converting requires resolving, and resolving is what finds the rot. An allowlist skips the only expensive step and keeps only the cheap one.

## §2 The decisions

1. **All 55 convert. No allowlist, no per-citation exemption.** §4.1.
2. **`docs/` is outside the gate's scope — because of what those documents ARE, not to save work.** §4.2.
3. **The gate bans one unambiguous form and checks nothing else.** No symbol resolution. §4.3.
4. **A `--self-test`, on the `check-text-bytes.sh` model, and the same CI mirror.** §4.4.
5. **One inline escape hatch, at the site, never in a config file.** §4.5 — *and this is the one deviation from decision 1; §4.5 states the case against it too.*

## §3 What verification established before any code was written

### 3.1 THE CORPUS IS 55, AND EVERY ONE RESOLVES TO A FILE THAT EXISTS

All 55 were resolved by script — relative to the citing file's directory, then from the repo root, then by unique basename. **54 land inside a file that is long enough; one does not resolve at all.** So a checker that merely verified "the file exists and has that many lines" would have found **one** problem out of a corpus where hand-reading finds roughly half. That measurement is why §4.3 does not include a range check: it is machinery that buys almost nothing.

### 3.2 THE ONE UNRESOLVABLE CITATION IS NOT AN EXCEPTION, AND CHECKING SAVED AN EXEMPTION

`crates/redextape-native/src/jit.rs` cites `src/backend.rs:60-74` — inside **cranelift-jit 0.134.2**, a third-party crate. It resolves to nothing here because it is not here.

**It looked like the one case that must stay a line, and it is not.** The doc already pins the version, and the material it points at is a function; naming `with_flags` instead of `60-74` keeps the version pin, keeps the provenance, and drops the only part that can rot. **A citation into an external artifact is still a citation into a symbol.**

### 3.3 CITATIONS ARE NOT ONLY IN COMMENTS, WHICH IS WHY THE SCAN IS OVER RAW TEXT

Two of the 55 live inside string literals — a `println!` in `step_survey.rs` and a label string in `blowup_probe.rs`, both probe output read by a human. A comment-aware scanner would miss both. **The gate greps text, and that is a decision rather than a shortcut:** the citing context does not change whether the line number is going to rot.

### 3.4 RANGES ARE THE COMMON FORM, NOT THE EXCEPTION

29 of the 55 are `file:N-M` rather than `file:N`, and 26 are `file:N`. Any pattern that only matches a bare trailing integer would pass most of the corpus. The pattern anchors on `.<ext>:<digit>` and stops there, so both forms are caught by the same rule.

**This sentence first read *"26 of the 55 are `file:N-M`"*, and the correction is worth recording because of its shape: the two halves were TRANSPOSED, not miscounted.** 26 is the `file:N` count wearing the `file:N-M` label. The total was right, which is exactly what made the disagreement look small enough to note beside the implementation and leave standing — a wrong number is not made harmless by a comment saying it is wrong. Re-derived over the branch point with the shipped pattern: **55 tokens, 29 ranges, 26 singles.**

## §4 The design

### 4.1 THE RULE

> **A `file:line` citation is banned in tracked source. Cite the symbol.**

A symbol survives every edit that does not rename it, and a rename is a `grep` the compiler will usually run for you. A line number survives no edit above it, including edits made in the same commit.

**THE EVIDENCE FOR THE RULE IS IN THE TREE, NOT IN THE ARGUMENT.** `buffer-affordability.test.ts` cites **24 times with zero drift**, for the reason that generalises: most of its citations name *other* files, and another file does not shift when the citing file grows.

### 4.2 SCOPE — TRACKED SOURCE, NOT `docs/`

`docs/` holds **849** of the repo's 904 citations, spread across dated specs, plans and the roadmap. They are out of scope, and the reason is a distinction rather than a budget:

| | what it is | what makes it wrong |
| --- | --- | --- |
| a citation in **source** | a **pointer** — *go look here* | it stops being true the moment the target moves |
| a citation in a **dated record** | an **observation** — *on 2026-08-12, this was at line 44* | nothing; it was true then, and it still records that |

**REWRITING THE SECOND KIND WOULD FALSIFY THE RECORD.** The web-doc-history slice settled this shape once already, deliberately leaving one stale roadmap hit alone: *"a dated closing entry records what was true then, and correcting history to match the present would be worse than leaving it."*

**SO A FUTURE ROADMAP ENTRY MAY STILL CITE A LINE**, and should, when the point is to timestamp where something stood. That freedom is the reason this is a scope boundary and not an exemption — an exemption suspends a rule that ought to apply; here the rule does not apply.

The scan also skips binary files by extension, reusing `check-text-bytes.sh`'s argument verbatim: an extension list is dumb, visible, and wrong in ways a reader can see.

### 4.3 WHAT THE GATE CHECKS, AND WHAT IT DELIBERATELY DOES NOT

**It checks one thing: the absence of `<name>.<ext>:<digits>` in tracked source.** That pattern is unambiguous, so the gate cannot report a judgement call as a violation.

Two richer designs were considered and declined:

- **Resolving the cited line** (does the file exist, is it long enough). §3.1 measured what this catches on the real corpus: **one hit out of 55**, against a hand-read rate near half. It cannot see undershoot — the line still exists — which is the entire observed failure mode.
- **Resolving symbol citations** — extracting backticked identifiers from comments and checking each exists. This is the ambitious version and the one most likely to fire on prose, CSS classes, string literals and shell flags. The roadmap named the cost precisely: *"a gate that fires spuriously in its first week is a gate someone disables."* Filed, not refused; it wants prototyping against the converted tree and a measured false-positive rate before it is wired to anything.

**THE PROSE FORM IS OUT OF SCOPE, AND THE RATIO IS MEASURED RATHER THAN GUESSED.** A pointer can be written `` (`replies.ts` lines 325-341) `` instead of `replies.ts:325-341`, and it rots identically — Task 1's review found one already **stale by ~29 lines**. So the gate has a real blind spot, and it stays. Tracked source holds **15** prose-form hits, of which only **2 are live pointers**: six are coverage figures in `vite.config.ts` (*"THEY ARE: lines 97.99 (1513/1544)"*), one is a CI flag (`--fail-under-lines 90`), and six are **drift notes deliberately written in prose** so they do not trip this very gate.

**A gate on that form would fire on 13 non-citations to catch 2** — the *"fires spuriously in its first week"* failure named above, arrived at by measurement. **The 2 are converted by hand instead** (plan Task 1b), and the residual risk is stated rather than closed: a prose-form pointer written after this slice will not be caught by anything.

**THE GATE'S OWN DOC CANNOT CONTAIN AN EXAMPLE VIOLATION**, which is a real constraint and not a curiosity: a script whose header shows `desugar.rs:77` would fail itself on the first run. Examples in the header are written with a placeholder line (`desugar.rs:<line>`), and the **only** place a real one appears is inside `--self-test`, where it is constructed at runtime and never written to a tracked file.

### 4.4 THE SHAPE — `check-text-bytes.sh`'s, ON PURPOSE

Bash, in `scripts/`, invoked identically by `.pre-commit-config.yaml` and by `.forgejo/workflows/ci.yml`, so the local and CI gates cannot drift. `always_run: true` and `pass_filenames: false`: the scan walks `git ls-files` and costs a quarter-second (measured 247-262 ms; the sibling, 583-589 ms), and a rule scoped by staged path would miss a citation arriving in a path nobody thought to list. **THAT FIGURE IS MEASURED BECAUSE THE SIBLING'S WAS NOT.** `check-text-bytes.sh` and its hook entry both claimed "milliseconds" and were two orders out; the claim had stood since the gate was written, unchecked, in a file whose subject is claims that go stale unchecked.

**`--self-test` IS NOT OPTIONAL AND ITS REASON IS THIS REPO'S OWN.** A gate that only ever runs against a passing tree cannot tell you it still works — the same *"an assertion that cannot fail is a defect"* rule turned on the checker. `check-text-bytes.sh`'s first draft passed against a planted NUL, and only a by-hand test found it. Both directions are asserted here: a planted citation must be caught, and a clean fixture must pass.

### 4.5 THE ESCAPE HATCH, AND THE ARGUMENT AGAINST IT

A line may end with `check-citations: allow` to be skipped, and the gate reports how many such lines it honoured on every run.

**THIS IS THE ONE DEVIATION FROM DECISION 1 AND IT DESERVES ITS OWN CHALLENGE.** The case for it: today's tree has zero legitimate uses, but a test asserting on a stack trace or a source-map fixture is a plausible future one, and with no valve the only way past a false positive is to disable the hook — which is the exact failure the roadmap warns about. The case against: an escape hatch is an allowlist with better manners, and §1.2 rejected allowlists.

**WHAT KEEPS THEM DIFFERENT IS WHERE THEY LIVE.** A config file collects exemptions where no reader of the code will meet them; a marker sits on the line it excuses, is visible in review, and is counted out loud on every run. **If the count is ever above zero without an argument beside it, that is a finding.** It ships at zero.

### 4.6 NOTHING IS DELETED, AND NO CITATION LOSES ITS PROVENANCE

Every converted citation keeps what it was pointing at and what it was arguing; only the coordinate changes. Where a citation was stale, the correction is recorded at the site rather than silently applied — a comment that quietly starts naming a different line teaches the next reader nothing about how it drifted.

## §5 Testing

1. **`--self-test`, both directions**, per §4.4. It exercises the same detection function the scan uses, never a paraphrase of it, so the self-test cannot drift into agreeing with a broken scan.
2. **The gate run against the tree, expected to pass at zero violations and zero honoured markers.** A gate landing on an unconverted tree is the failure mode this slice's ordering exists to avoid.
3. **The suite must stay green and coverage must not move.** The conversion changes comments and two probe strings; no executable behaviour. `pnpm test` stays at 606/63 and the four web coverage figures stay put. `cargo nextest run --workspace` unchanged.
4. **Each converted citation is verified by resolving it before conversion** — the reviewer checks that the symbol named is the symbol the citing text claims, not merely that a symbol exists. **This is where the stale ones are caught, and it is the only step that finds them.**
5. **A stale citation found during conversion is reported, not quietly fixed.** The count of stale-on-arrival citations is a deliverable of this slice.

## §6 What this does not do

- **It does not check symbol citations.** §4.3. Separate slice, wants a measured false-positive rate first.
- **It does not touch `docs/`.** §4.2, and not for cost reasons.
- **It does not shorten or restructure a single doc comment.** Any change beyond a citation's coordinate — and the sentence around it when the coordinate was wrong — is out of scope.
- **It changes no behaviour.** Any executable change in the conversion commits is a defect. The gate script and its two invocations are the only new executable lines in the slice.
