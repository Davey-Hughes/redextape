# Code history moved out of comments

Text moved verbatim out of code comments when they were trimmed to their why. Each entry names the file and the line of code the comment sat above.

## `.forgejo/workflows/ci.yml`, above `R_WEB: ${{ needs.web.result }}`

R_WEB was briefly DROPPED here when R_BROWSER was added — replaced rather than joined —
and `set -u` turned the unbound reference on the echo below into a hard failure before
any `require` ran. Left as a note because the failure mode is the good one: the gate went
red and blocked the merge rather than quietly evaluating `web` as not-success, which is
what an unset-but-tolerated variable would have done.

## `.forgejo/workflows/ci.yml`, above `gate:`

Measured on PR #8, run 59: the draft gating skipped `rust`, `rust-llvm` and `rust-slow`, and all three published `success` having never run, giving a combined state of `success` on a pull request that ran only `detect`, `linear-history` and the explicitly non-gating `rust-scoped`.

## `.forgejo/workflows/ci.yml`, above `- name: Test + coverage`

`llvm-cov nextest`, not `llvm-cov --all-targets`, for the same reason the gate above switched
runners. Measured on this tree before the swap: 373.7s -> 164.6s (2.27x).

It is NOT bit-identical coverage and saying so would be the easy lie: lines went 95.55% ->
95.52%, i.e. 1397 -> 1407 uncovered of 31417. The 10 lines are the target set — `--all-targets`
instruments example targets, nextest's default does not. Both sat 15 points above the gate
when the gate was 80; against today's 90 the margin is ~5.5. The swap is still safe, and the
delta is recorded rather than rounded away so that a future drop is not misread as this
change's fault. (Updated 2026-08-09 with the floor — the "15 points" reading was true of 80
and false the moment the floor moved.)

Measured 2026-08-09: 95.64% lines (15905 lines, 694 missed).

## `.forgejo/workflows/ci.yml`, above `rust-scoped:`

WHAT THIS JOB ACTUALLY BUYS, corrected 2026-08-04 after measuring the live payload. It was
designed to scope against the PUSH INCREMENT — "a WIP push that touched one test does not pay for
the whole feature matrix". **It cannot.** `github.event.before` is EMPTY on Forgejo's
`synchronize` (measured on PR #8 run 60; `action` reads `synchronized`, and the `types:` filter
above matches it anyway). `base.sha` is the merge-base with `main`, so the payload offers no
per-push increment at all — `check-scoped.sh` always takes its whole-branch fallback, which
design §1.2 measured as narrowing anything on 3 of the last 40 commits.

THE WALL-CLOCK SAVING IS LARGE, and a first version of this comment claimed it was ~zero.
MEASURED: a draft run is 72s (run 60) or 163s (run 59) — `rust-scoped` alone; a non-draft run is
353s (run 63) — `max` over three jobs that overlap in full. **A 3.2-4.7m saving, not zero.**

The wrong version reasoned "the jobs run in parallel, so wall = max, so draft ~= non-draft" from
an UNMEASURED guess that `rust-scoped` costs about what `rust` costs. It does not: `rust` also
runs `cargo llvm-cov nextest --workspace` on top of `check-all.sh --no-llvm`, and its 353s was
measured WHILE CONTENDING with two other jobs. `rust-scoped`'s worst case — full escalation to
`--no-llvm` — is 72s warm, consistent with the 50.1s `T_llvm_repeat` plus job overhead.

`wall = max(jobs)` is right about scheduling and wrong about cost. Runner capacity is >= 3 in run
63 specifically (its three heavy jobs span 19:59:35-20:05:28 together, so nothing queued there —
run 65 elsewhere queued twice, so capacity is a real constraint, just not this run's), but a job
with the box to ITSELF is far cheaper than the same job sharing it — the same contention lever
§6.5 credits for part of `rust-slow`'s PRE-to-POST mean shift (442s to 298s, untouched by any
commit on this branch) — see §6.5 for the counter-evidence that weakens this story too.

## `.forgejo/workflows/ci.yml`, above `- name: Reject merge commits`

MEASURED, NOT HYPOTHETICAL: PR #38 (5d-ii-b) failed this job on six `--no-ff` commits that were
the joins of six parallel worktree lanes. Every one of them was discarded by the squash. The
only remedy the check offered was rebasing thirty-two commits — destroying the per-commit
reasoning this repository keeps deliberately — to satisfy a property main never observes.

## `.forgejo/workflows/ci.yml`, above `- name: Install a Lua interpreter for the gate below`

THE RUNNER IMAGE HAS NO LUA AND NO NEOVIM, AND THE FIRST VERSION OF THIS GATE ASSUMED IT DID.
`catthehacker/ubuntu:act-latest` carries node, git and curl; `scripts/check-lua.sh` originally
ran `nvim --headless`, which is present on any machine that can actually use the plugin and
absent here. It failed in this job at 9s — and it failed in the SELF-TEST rather than the scan,
because with no interpreter "an invalid file is rejected" passes for the wrong reason while
"a valid file is accepted" does not. That is the self-test-before-scan order the three sibling
gates argue for, catching the exact class of thing they argue it catches.

## `.forgejo/workflows/ci.yml`, above `- name: Prove the figure detector still detects`

The first draft of this script had a locator whose leading backtick sat against `/` rather than `highlights`, so it matched nothing in the λ README — and the self-test failed on it before the scan was ever run.

## `.forgejo/workflows/ci.yml`, above `- name: Prove the citation detector still detects`

THIS LIST NAMED THREE ASSERTIONS UNTIL THE RE-REVIEW, and the self-test had grown past it: the
extension and case coverage came from a finding that the pattern failed SILENT on `.html`,
`Dockerfile`, `.conf`, `.tm` and `.txt`, and the tally assertion from a finding that the
reconciliation could not fail. A stale enumeration of a gate's own coverage is the shape of
claim this gate exists to retire, so it is written to be re-checkable rather than re-counted.

## `.forgejo/workflows/ci.yml`, above `- name: Prove the control-byte detector still detects`

THE SELF-TEST RUNS FIRST AND IS NOT CEREMONY. This gate's first draft reported "clean"
against a planted NUL — it had the exact defect it exists to catch — and a scan that only
ever runs against a passing tree cannot tell the difference between working and broken.

## `.forgejo/workflows/ci.yml`, above `env:`

IT IS NOT FREE, which is why it is scoped here rather than set for everyone. On a WARM target tree
with a one-file edit — the shape of a second push to an open PR, where the cache restored is this
job's own — a rebuild measured 2s with incremental on against 8s with it off. That 6s buys 166 MiB
less traffic in each direction. A runner pays the traffic on every job and the 6s once; a laptop

## `.forgejo/workflows/ci.yml`, above `workflow_dispatch:`

MEASURED: PR #6's head commit (23ffc978) is docs-only and has ZERO commit statuses — under today's protection that PR would be unmergeable forever.

PR #6 is the only docs-only PR this repository has ever had, and that is the right population
to count — COMMITS are not. A `pull_request` path filter evaluates the whole `base...head`
diff, so docs-only commits on a mixed branch never trip it; only a wholly docs-only PR does.

## `.forgejo/workflows/ci.yml`, above `rm -f /etc/apt/apt.conf.d/docker-clean` in `rust-llvm`

THIS IS NOT WHY THE CACHE MISSED, and the first version of this comment said it was.
**Corrected 2026-08-07:** it claimed this cache had probably never worked. Observed, it
had been hitting and then stopped without its key being edited — which docker-clean
cannot explain, since it would have prevented every hit rather than ending a run of them.
The miss is the key's, and is fixed at the cache step above.

## `scripts/build-web-bindings.sh`, above `set -euo pipefail`

THE ORIGINAL SHAPE WAS `rm -rf bindings && cargo test ... export_bindings`, run at the START of every
`typecheck`, `test` and `build` in `web/`. THAT HAD TWO MEASURED CONSEQUENCES: (i) a failed
generation destroyed the last-good directory, because the `rm -rf` ran before `cargo` could fail; and
(ii) `tsc` was measurably sensitive to the directory being gone for roughly the first second of a
`--noEmit` run, which a concurrent `tsc` (a pre-commit hook, an editor's tsserver, a second agent)
could land inside.

THE FIRST ROUND'S FIX — generate into a scratch directory and swap it in with two renames — closed
both of those and INTRODUCED A WORSE ONE: it used two FIXED, SHARED scratch names
(`web/bindings.tmp`, `web/bindings.old`) and `rm -rf`'d both unconditionally with no lock. Two
concurrent runs raced identically every time: the second run's `rm -rf` deleted the first run's
already-populated scratch mid-flight, the first run's swap then moved the SECOND run's (still-being-
written, or already-deleted) directory into place, and the loser's final `mv` found nothing to move —
`web/bindings` ended up not existing at all, twelve files stranded under `bindings.old`, at exit 0.
The pre-fix inline shape, raced identically, came through clean every time: this was a regression the
scratch-directory fix introduced, not a hazard it failed to close, and a fix that is worse than the
problem it fixed must not ship. There was a second, latent defect in the same lines too: `mv
web/bindings web/bindings.old` when `web/bindings.old` already existed (a straggler from a crashed
run) moved the directory INSIDE it, silently producing `web/bindings.old/bindings/`.

Before `redextape-wasm` had its own `ts-rs` derives, its leg ran 0 tests and wrote nothing, so "at least one `.ts` file exists anywhere in the scratch directory" and "the leg that matters produced something" were the same question — one file existing was equivalent to the producing leg having produced.

## `scripts/check-all.sh`, above `needs_nextest=0`

Measured on this suite (2026-07-28, 12 logical CPUs): 231.7s -> 135.2s wall, the same 623 tests with the same pass set, parallelism 1.39x -> 2.51x. Nothing about any test changed.

## `scripts/check-attributions.sh`, above `printf 'pub struct Marker;\n' >"$tmp/typekw.rs"`

**THE FIXTURES BELOW CLOSE A COVERAGE GAP THAT WAS MEASURED RULE BY RULE, NOT GUESSED.**
`declare_names` carries 13 declare rules — seven Rust, and six TypeScript counting the two early
bails — and this battery exercised **6** of them. Deleting any one of the other seven left
`--self-test` at 0 failures. Four of the seven carry live citations and took the tree scan red when
deleted: the Rust type-keyword rule at 30 violations, the TypeScript signature rule at 24, the Rust
field rule at 5, the Rust UpperCamel variant rule at 1 — 60 live citations whose only guard was
today's tree. The other three — `macro_rules!`, the TypeScript `import` bail, `get`/`set` — carry
none, so the scan stayed green too and nothing at all would have noticed them go. Deleting the `()`
strip in `symbol_declared_in`, which is not a declare rule, was the same shape: green, and the scan
at 22. A figure of "8 of 13" was written for this gap before it was measured, which is the error
this paragraph exists to report. Each fixture is built so that ONE rule emits the asserted name

## `scripts/check-attributions.sh`, above `if [[ $stem == *[.:]* ]]; then qualified=1; else qualified=0; fi`

**96 LIVE SITES NOW REST ON THE TAG, AND THE ASYMMETRY IS A CHOICE WITH A PRICE.** Measured by
re-running every site in the tree against the two halves of the declaration set separately: 96 pass
ONLY through `local:` — 6 under `crates/`, 90 under `web/` — and of those 96, **34** name a
module-scope binding (16 `export const`, 16 unexported `const`, 2 `let`) while **62** name one
indented inside a function or block. The 34 are module-level declarations that the tag nonetheless
treats as locals, so a QUALIFIED citation of one would be a false positive. The tree holds none:
routing the three TypeScript keywords through `put_local` reddened exactly one site, and that site
was wrong. The cheap rule stands until a real qualified citation of a module-scope `const` exists to
pay for a better one.

## `scripts/check-attributions.sh`, above `after = ""`

after `):` is accepted. Measured over the 127 tracked `.ts`/`.tsx`/`.js` files by diffing the
full declaration sets: that widening added exactly TWO names, `pane-host.ts` for
`scratchSeedOf` and `scratch.ts` for `editorSeed`, and removed none -- 3,565 to 3,567.

**THE HOLE WAS LATENT, AND THE WALK WIDENS ONE THING.** Measured over the 127 tracked
`.ts`/`.tsx`/`.js` files, every emitted name keyed by its line: the walk removes NONE, so no
call line in the tree was being read as a signature, and it adds 3, 4,939 to 4,942, because a
body brace no longer has to end the line -- `panes.test.ts` builds a fake whose methods are
written `setDetached(_d: boolean) {},`, which are real declarations. Deleting the guard
leaves that set byte-identical.

## `scripts/check-attributions.sh`, above `if (match(line, /^[ \t]*((export|default|declare|abstract|async|static|readonly|public|pri`

does, rather than by any `)` that happens to precede a colon. A wrapped CALL whose parameter
list spills to the next line used to pass this rule too — `bufferList(` alone on a line — until
the branch that accepted a bare line break was dropped; no passing site needed it.

**"OVER 1,100 SITES OF THAT SHAPE UNDER `web/`" STOOD HERE AND IS WRONG BY MORE THAN AN ORDER OF
MAGNITUDE IN THE ALARMING DIRECTION. IT ALSO BORROWED THE WORD THIS GATE RESERVES FOR
ATTRIBUTION SITES TO MEAN STRIPPED LINES, AND `web/` HELD 339 ATTRIBUTION SITES IN TOTAL AT THE
BRANCH POINT, SO NO READING OF "SITES" REACHES 1,100.** Re-measured by running the real
`strip_code` over the 123 tracked `.ts`/`.tsx`/`.js` files under `web/` and applying the exact
condition of the deleted branch — the signature-head match above, then nothing but whitespace
after the `(` — which yields **39 lines**, against **193** that merely end in an open paren.
And all 39 are CALLS or control-flow keywords: `expect(` 17 times, `parseLayout(` 8,
`bufferList(` 4, `writeFileSync(` and `parseBuffers(` twice each, `while (` twice, and one each
of `setTmProgram(`, `reject(`, `if (` and `return (` — **10 distinct names, and not one genuine
wrapped signature among them.** So the deleted branch produced false declarations under `web/`
and nothing else, which is a stronger argument for deleting it than the inflated count was.

## `scripts/check-attributions.sh`, above `if (match(line, /(^|[^A-Za-z0-9_$])(const|let|var)[ \t]+\*?[ \t]*[A-Za-z_$][A-Za-z0-9_$]*/`

**`const`/`let`/`var` BIND A NAME EXACTLY AS A RUST `let` DOES, SO THEY GO BEHIND THE SAME
`local:` TAG** -- and this half of the split did not exist until a review of the Rust half went
looking for its twin and found the keyword rule here handing every binding to plain `put`. The
Rust rule above closed the filed archetype under `crates/`; this one closes the identical hole
in the tier that had actually drifted: all 26 drifted citations this gate found when it was
introduced were under `web/`, and so were 9 of the 10 this branch repointed. Before it,
`app.test.ts` cited `.step` against `pane-chrome.ts` -- a CSS class name against a `.ts` file --
and the only emission satisfying it there was
`const step = document.createElement(...)`, a local. Measured by running the scan with these
three keywords on `put` and then on `put_local`: it reddens exactly one site in the tracked
tree, that one, and leaves `--self-test` at 0 failures.

## `scripts/check-attributions.sh`, above `if (match(line, /(^|[^A-Za-z0-9_])let[ \t]+(mut[ \t]+)?[A-Za-z_][A-Za-z0-9_]*/)) {`

Measured before the tag, by tagging every rule in this battery with the rule that emitted each
name and recording which tag satisfied each site (an instrumented copy of this script):
11 of 471 sites rest on this rule or the field rule below with no other rule also emitting
the name, and qualification splits them exactly. The 5 that need a binding are
`Builder::overflow` twice -- qualified, and both drift -- against `first_order` twice and
`higher_order` once, all three bare and all three citing `examples/tm_demo.rs`.

## `scripts/check-attributions.sh`, above `if (match(line, /(^|[^A-Za-z0-9_])fn[ \t]+[A-Za-z_][A-Za-z0-9_]*/)) {`

which is why THAT bail earns its keep and this one does not. A `use` bail was tried here,
for symmetry with the TypeScript one, then measured and removed: across five single-line
`use` forms it changed the verdict on exactly one, a `use` sharing its line with a
declaration (`use crate::x::Y; pub fn after() {}`), where it swallowed the declaration.
Zero measured benefit, one lost declaration. A wrapped `use`, whose names sit on

## `scripts/check-attributions.sh`, above `if (line ~ /^[ \t]*$/) return`

49.1% of the lines across the files this gate resolves as candidates strip to whitespace
(31,318 of 63,800 across 108 files), because comment density across this tree runs that high.
Measured by logging every path declarations_of resolves during a full scan, then running
strip_code on each logged file and counting output lines matching /^[ \t]*$/ against total
lines.

**TIMED INTERLEAVED, BECAUSE THE TWO EARLIER FIVE-RUN PAIRS FOR THIS ONE COMPARISON READ AS A
SINGLE MEASUREMENT CONTRADICTING ITSELF.** They were two pairs taken at different commits --
4,098-4,118 ms here, 4,099-4,118 ms in the hook comment and the roadmap entry -- and a range
that names neither its tree nor its run count invites exactly that misreading. Re-measured on
this tree, 10 rounds, one sample of each variant per round in rotating order, one untimed
warm-up each, "bash scripts/check-attributions.sh" with no --self-test: with this guard,
2,845-2,887 ms, mean 2,865; with the guard line commented out, 4,180-4,242 ms, mean 4,217. So
removing it makes the same scan 47% slower, and the verdict is identical either way -- 471
sites, 6 excused, 0 violations -- which is what makes the guard pure saving.

## `scripts/check-attributions.sh`, above `readonly ALLOW_RE='check-attributions: allow[[:space:]]*$'`

These six are the measured false-positive rate of the declaration rule: 6 in 477, ~1%.

`SOURCE_RE` below is `\.(rs|ts|tsx|js|css|html)$` and this script is `.sh`; planting a wrong citation
in this very header and running the gate left the count and verdict unchanged — still 471 sites, 6
excused, 0 violations. The claim was inherited from `check-citations.sh`, where it IS true, because

## `scripts/check-attributions.sh`, above `set -euo pipefail`

**MEASURED BY THIS GATE, AND THE SPLIT BETWEEN THE TIERS IS THE FINDING.** Run over the tracked tree
at the branch point that added it, it found **492** attribution sites — **339** under `web/`, **150**
under `crates/`, **3** under `grammars/` — and flagged **31**. Twenty-six were real drift and **every
one of them was under `web/`**. `crates/` produced two flags and neither is drift: both deliberately
name something no file holds in code, and both carry the marker below. That is a fact about history,
not about languages. Rust's modules were split along
boundaries that existed before the code did; `main.ts` was a god-module that PR #37 and its
successors carved into `transport.ts`, `link-wiring.ts`, `compile.ts`, `panes.ts` and
`buffer-list.ts`, and every citation written before the carve kept pointing at the file the symbol
left. **The tier that never extracted never drifted**, which is why this gate covers both tiers
rather than the one that was dirty: it is armed for the next extraction, wherever that happens.

**THE FINDING THAT SHAPED THE DECLARATION RULE BELOW, MEASURED ONCE ON THIS BRANCH BEFORE ITS TEN
DRIFTED CITATIONS WERE REPOINTED — AND THE SPLIT READ 28/10 UNTIL ONE OF THE 28 TURNED OUT NEVER TO
HAVE BEEN CORRECT AT ALL.** A declaration test flagged 38 of 499 attribution sites on that tree,
sites the presence rule above passed at 0 violations, and **27 of the 38 were correct citations**:
the possessive was being used for a `match` arm (10), a call or other expression (10), an impl of a
foreign trait (3), a fixture (2), a statement inside a file's own header (1), and a quotation of a
wrong citation kept as an illustration (1). **11 were not** — 10 real drift, plus one counted among
the calls that should never have been: `config_cli.rs` named an
`opts.field_width.unwrap_or(...)` expression in `emit.rs` that has never existed in any source file
in this repository, only in a plan document. Rewording it to name an act deleted the attribution
site and left the claim false, which is why the count moved at a later review rather than at the
measurement: **a taxonomy of correct-versus-drifted can only be as good as the reading of each
sentence, and rewording a sentence does not read it.** The convention this gate enforces from that
count: **a possessive claims the declaration; every other act on a symbol is named, not possessed.**

**THAT WRAP GAP IS NOW DEMONSTRATED RATHER THAN ARGUED, AND WHAT DEMONSTRATED IT WAS A REFLOW NOBODY
INTENDED AS A TEST.** `buffers-quota.test.ts` carried *"called at `` `reduce.rs`'s `reduce_step_go` ``"*
with the filename ending one comment line and the symbol opening the next, so no `grep` line held
both and the site did not exist as far as this gate was concerned. Rewrapping the surrounding
paragraph joined them, and the very next run counted one more attribution site — the new one
passing, because `reduce.rs` does declare `reduce_step_go`. So the hole is symmetrical and cheap to
fall into in both directions: **reflowing a paragraph can put a citation under this gate or take it
out from under it, and neither shows up as a diff to any citation.**

**THAT CITATION IS JOINED NOW, AND THE ARGUMENT FOR KEEPING IT SPLIT HAD THE PROTECTION BACKWARDS.**
The wrap was first restored so the site count would keep matching the arithmetic that explained it.
But nothing guards that count — no gate reads it, and any commit adding or removing a citation
anywhere in the tracked tree moves it — while the wrap itself WAS load-bearing: biome never reflows
a comment, so one hand-placed line break was all that held the split, and the next prose edit to
that paragraph would have moved the count with no diff to any citation. Keeping the split protected
a number nothing protects by preserving the very hole this paragraph describes. The hole is
untouched and still real; its one live instance was a correct citation hidden from the gate.

**THE COUNT LANDS BACK ON 471, WHICH IS A COINCIDENCE TO RECORD RATHER THAN A SIGN NOTHING MOVED.**
499 at the branch point; minus 27 rewordings that deleted a site; minus 1 that became a marker;
minus 1 more for the `.step` citation in `app.test.ts`, reworded once routing TypeScript bindings
through `local:` showed it had only ever passed on a local `const`; plus 1 for this wrap-split
citation, joined: **499 − 27 − 1 − 1 + 1 = 471**. Two changes moving the count by one in opposite
directions leave a figure that reads as untouched — one more reason the figure is not a guard.

None was load-bearing when the last of them was written down, and that was checked rather than assumed: the tree then held 24 passing sites whose symbol is path-qualified, and for 23 of them every line in the cited file that emits the name PLAIN — the only emissions a qualified citation can use — was read, and every one is a real field, method, enum variant or type member, never a reassignment, parameter, key, label or match arm. The 24th, `events(...)`, never reaches the extractor, because its last segment is not an identifier.

**DECLARATION FORMS THE EXTRACTOR MISSES. EACH WOULD REDDEN A CORRECT CITATION RATHER THAN LET A
WRONG ONE THROUGH, AND THE HEADING HERE USED TO CLAIM ALL OF THEM WERE AT ZERO OCCURRENCES, WHICH WAS
WRONG TWICE.** Three are at zero and re-measured: a destructured binding
(`export const { compile, parse } = ...`), a Rust enum whose variants share the enum's own line, and a
Rust field behind an inline attribute — the tree's one instance of that last shape sits inside a raw
string in `ts_derive_scan.rs`, so the stripper blanks it and no name escapes. The two that were wrong:

1. **A TYPESCRIPT SIGNATURE WHOSE RETURN TYPE ITSELF CONTAINS BRACES WAS MISSED TWICE, NOT ONCE,
AND THE SECOND INSTANCE IS WHY THE MISS IS NOW CLOSED RATHER THAN DOCUMENTED.** Re-measured by
collecting every stripped line of the tracked `.ts`/`.tsx`/`.js` files that has a brace after a
`)` and `:` once a trailing body brace or semicolon is set aside — **53 lines**, not all of them
signatures — and running each through `declare_names` alone:
**15 yielded no name**, of which **9** are continuation lines of a wrapped signature whose
keyword sits on the opening line (all 9 names are reached there, checked one by one), **4** are
not declarations at all (two inline arrow callbacks, one `as` type assertion, one
`new Worker(...)` argument), and **2** are real declarations the extractor lost:
`scratch.ts`'s `editorSeed` and `pane-host.ts`'s `scratchSeedOf`, both returning
`{ text: string; collapsed: boolean } | null`. The earlier count of 37-and-one came from a
narrower collection and from stopping at the first miss found.

Every default-parameter signature line in the tracked tree yields its name — 15 of 15 by the same per-line method, of which 14 are real default parameters and the fifteenth is a `[data-leaf="..."]` selector the grep mistook for one.

## `scripts/check-citations.sh`, above `reconcile() {`

**THIS IS THE ASSERTION THAT CAN FAIL, AND FOR ONE BRANCH IT WAS ONE THAT COULD NOT.** The scan's
tally used to print `$((scanned + excluded + skipped))` under a comment calling it *"`git ls-files`'
own count"*. It compared nothing. The sum of the three buckets is the sum of the three buckets, so a
path that vanished before the loop moved every term at once and the arithmetic stayed consistent all
the way to `exit 0`. The whole-branch review demonstrated it: a planted drop over a file holding a
real pointer, `0 skipped`, *"7 tracked paths in all"* against a tree of 8, clean exit. **That is door
3's own shape, reproduced inside the sentence written to announce door 3** — in the gate whose thesis
is that a written claim rots, four doors after the class was declared shut. `$4` now has an
independent origin, which is the entire difference between a reconciliation and a restatement.

## `scripts/check-citations.sh`, above `citation_lines() {`

Tested by hand against a `chmod 000` file, this script printed "0 violations" and exited 0 over a file it had never read.

## `scripts/check-citations.sh`, above `readonly CITATION_RE='([A-Za-z0-9_./-]+\.(rs|ts|tsx|js|json|toml|yml|yaml|css|md|sh|html|c`

Counted over tracked non-`docs/` files at this slice's branch point: 55 citation tokens, of which 29
were ranges and 26 were singles. Spec §3.4 first said *"26 of the 55 are `file:N-M`"* — **THE TWO
HALVES WERE TRANSPOSED, not merely different: 26 is the SINGLES count wearing the ranges label.** The
total agreed because nothing had been miscounted, which is exactly what made the disagreement look
harmless enough to note and leave. §3.4 now reads 29, and these three numbers re-derive from the tree
with this very pattern.

**The quiet direction is the dangerous one here, and the list shipped wrong in it.** Eleven extensions, against a tree that already tracked five kinds it did not name: an `.html`, a `Dockerfile`, a `.txt`, a `.conf` and two `.tm` all passed, and so did an upper-case `Helper.RS:<line>`, because the alternation was lower-case only. Demonstrated by the whole-branch review, in a sandbox, on planted pointers — not by this gate, which reported the tree clean throughout.

## `scripts/check-citations.sh`, above `readonly SCOPE_RE='^docs/'`

When `rxt` joined
the list above, three of them lit up on lines rendering `warn.rxt:<line>:<col>` — ariadne's rendered
diagnostic location for a real fixture at its real position.

## `scripts/check-citations.sh`, above `set -euo pipefail`

**WHY THIS GATE EXISTS — MEASUREMENT, NOT PRINCIPLE.** Converting the tree's surviving `file:line`
citations to symbol citations resolved **57** of them and found **37 stale (65%)**. Three distinct
mechanisms were confirmed, and only the first was anticipated by the design:

1. THE CITING COMMIT ITSELF INVALIDATES THE POINTER. `sourcemap_coverage.rs` cited a guard in
`lower_asm.rs` that was at exactly the cited line in the PARENT commit — and the same commit
that wrote the citation also replaced two `unwrap`s with `if let` seven lines above it. The
pointer shipped seven lines short of the thing it named. No later edit was required.
2. A LATER, UNRELATED COMMIT SHIFTS THE TARGET. One lint sweep over 104 files — `clippy::pedantic`,
whose only behaviour changes were three edge-case defect fixes in unrelated files — broke fifteen
citations across two test files: ten of the eleven in one and five of the eight in the other. It
**had the first of those files open**, adding four lines at the top for a crate-level
`#![allow(..)]`, and re-resolved none of the eleven citations below them.
3. THE TARGET IS DELETED OR RELOCATED ENTIRELY. A citation named a `- name: Clippy` step in
`ci.yml` that a later commit folded into `scripts/check-all.sh`'s matrix. The invocation moved
BETWEEN FILES, so after that commit no line number was correct at any offset — nothing
line-based could have followed it.

**AND ONE SURVIVOR IS ACCURATE PURELY BY COINCIDENCE, WHICH IS THE SHARPEST ARGUMENT OF ALL.** Two
probes cite the same constant one line apart. Each recorded the position its own commit had just
destroyed, and a later import happened to push the constant back under one of the two pointers. Two
errors cancelling. Both authors were careful, both were wrong, one got lucky — and no amount of
care at the citing site reaches that.

line* — and rewriting it would falsify the record. They live there deliberately and in bulk: **849**
at this slice's branch point, **855** by the time its design was written, **985** when this gate
landed four and a half hours after the branch point, and **1015** two commits later, because writing
the closing entry moved it again. Every figure here names a commit for the same reason. **THAT THE
NUMBER MOVES IS THE POINT, NOT A DEFECT IN IT** — an observation is allowed to be about a tree that no
longer exists — and the phrase this comment used to carry, "at this branch's close", is a coordinate
with no tree attached, which is the same fault in prose that the gate rejects in `file:line` form. So
a future roadmap entry may still cite a line, and should, when the point is to timestamp where
something stood.

## `scripts/check-doc-figures.sh`, above `set -euo pipefail`

**WHY THIS GATE EXISTS — MEASUREMENT, NOT PRINCIPLE.** One commit in the tree-sitter slice
replaced `extras`'s `/\s/` with the five code points `is_ascii_whitespace()` accepts. That added
one comment line to two `grammar.js` files, and the λ README — which had asserted *"75 lines —
half the sibling's 156"* — became wrong in both halves of one sentence. Nothing failed. It was
found only because a third README was being written and happened to need the same two numbers for
a comparison. Had that PR not existed, the claim would still be there.

**THE ROOT README EARNED ITS ROWS BY BEING WRONG IN FOUR PLACES AT ONCE.**
The three grammar READMEs came first. The root README was added after a survey found it claiming
"Four crates" against seven, "841 tests" against 1,156, "six pre-commit hooks" against seven, and
"15 browser tests" against 26. **One of those was falsified by the very branch that introduced this
script** — adding `check-doc-figures` made the hook count seven — so the gate's own arrival broke a
figure in the one file it did not yet cover. Its repo-level rows (`.` as the scope) describe the
workspace rather than a grammar, and every one is a structural grep that compiles nothing.

It had drifted by 315 tests and lost three crates from its breakdown before anyone noticed.

## `scripts/check-grammar-wasm.sh`, above `set -euo pipefail`

It cannot catch a `.wasm` replaced or corrupted by hand with `parser.c` untouched, and the design's first draft accepted that hole on the grounds that CI cannot rebuild the artefact — which does not follow, because checking a hash is not rebuilding.

## `scripts/check-shared-docs.sh`, above `set -euo pipefail`

**WHY THIS EXISTS, AND IT IS NOT A STYLE PREFERENCE.** The branch that gave Neovim a one-line install
wrote the same install prose into all four grammar READMEs. A review flagged the duplication; the
measurement that followed found **184 identical lines across the four**, and — the part that settles
it — one of the three shared blocks had ALREADY drifted into three different wordings. The `main`
versus `master` paragraph reads one way in the mini-language README, is re-wrapped in λ's, and in the
asm and TM copies has lost the clause *"Pick the one you have installed — the `install_info` field
sets are different"* entirely. Nobody decided that. Four copies of a paragraph edited over four
branches is all it takes, and no gate in this repository could see it: `check-doc-figures.sh` derives
NUMBERS from the tree and has no opinion about prose.

## `scripts/check-text-bytes.sh`, above `set -euo pipefail`

So every search across `web/src/` quietly omitted a file holding four heavily-argued doc comments, and one of those had gone stale and was found only because a reviewer read the file rather than searching it.

## `scripts/install-treesitter-ci.sh`, above `set -euo pipefail`

CORRECTED 2026-08-21, TWICE IN ONE DAY. The full sequence, because a future reader who only sees
one of these corrections will be tempted to undo it:

1. This pin started at "0.27.0", read off a local `tree-sitter` binary. No such release exists —
that string is Arch's `tree-sitter-cli-git`, built off `master`, self-reporting a version
number nobody has tagged. Corrected to the real newest release, v0.26.12.
2. v0.26.12's prebuilt Linux asset needs GLIBC_2.39. The CI runner
(`catthehacker/ubuntu:act-latest`) has GLIBC_2.35. `objdump -T` on every published v0.26.12
Linux asset — `tree-sitter-linux-x64.gz` and `tree-sitter-cli-linux-x64.zip` alike — shows the
same requirement, and there is no musl variant, so no prebuilt Linux asset for that release can
run on this runner. This script switched to `cargo install tree-sitter-cli --version 0.26.12
--locked`, compiling against the runner's own glibc instead of a prebuilt one.
3. That build failed too: the tree-sitter CLI vendors QuickJS through `bindgen`, which shells out
to `libclang` at build time. The runner has no `libclang`. `cargo install` does not fail
quietly here — it fails loud, with a `bindgen` error naming the missing library — but it fails.

## `scripts/check-attributions.sh`, above `printf '%s\n%s\n%s\n' \`

Blind sub-case 2, re-targeted. `Drop` was the old probe and cannot be: a file that only IMPLEMENTS a foreign trait does not declare it, so that assertion would now pass for the wrong reason.

## `scripts/check-attributions.sh`, above `printf '%s\n' \`

**TWO CALLS THE SIGNATURE RULE READ AS DECLARATIONS, BECAUSE IT NEVER CHECKED WHICH `)` PRECEDED THE COLON.**

Each was accepted by the old `\)[ \t]*:.*$` test, through the typed arrow each carries.

## `scripts/check-attributions.sh`, above `printf '%s\n' \`

, and that is the miss this branch closed.

## `scripts/check-citations.sh`, above `printf 'note: skipped %s — tracked but not a regular file\n' "$f" >&2`

This branch was the channel door 3 rode in through, and it said nothing while it did.

## `scripts/check-citations.sh`, above `printf '//! the fixture at %s:%d is what `fmt_error.toml` feeds the binary.\n' 'broken.rxt`

**THE EXTENSION THE LIST WAS LAST MISSING, PLANTED SO THE LIST CANNOT QUIETLY LOSE IT AGAIN.** `rxt` joined `CITATION_RE` when the CLI slice landed and `.rxt` fixtures entered the tree. Removing it again passed this whole self-test — every planted citation named a `.rs`, `.md`, `.html` or `Dockerfile` target, so the newest entry was the one thing no assertion covered. That is the extension list's documented silent-failure direction reproduced inside the test written to guard it, one branch after the same shape was found in the list itself. Caught by sabotaging the shipped pattern rather than by reading it.

## `scripts/check-citations.sh`, above `name='desugar.rs'`

**THE ONLY REAL CITATION ANYWHERE IN THIS SLICE, AND IT IS ASSEMBLED HERE RATHER THAN WRITTEN.**

on the commit that adds it.

## `scripts/check-colours.sh`, above `set -euo pipefail`

The tree had none when this gate landed, so it enforces an invariant that already held rather than one that had to be reached.

## `scripts/check-attributions.sh`, above `good_parens="// see ${q}owner.ts${q}'s ${q}forward()${q} for the handler"`

Deleting that one parameter expansion left `--self-test` at 0 failures and took the tree scan to 22 violations.

## `scripts/check-attributions.sh`, above `function declare_names(line,    s, head, j, parens, after) {`

So every `sub` here is written out rather than factored into a helper, which a first draft did and which reported 155 of 499 sites declared instead of 460.

## `scripts/check-attributions.sh`, above `declare -A RESOLVE_CACHE=()`

A first draft resolved by basename alone and reported 17 Rust sites unresolvable — `lib.rs`, `syntax.rs`, `asm.rs` and `decode.rs` each name several files in a workspace of eight members. Every one of those 17 resolved to exactly one file once the citing file's own crate was preferred, and all 17 were clean.

## `scripts/check-attributions.sh`, above `stripped_of() {`

The first version of this function was `strip_code ... | grep -qwF`, and it reported 467 violations over 492 sites on a tree with 26. `grep -q` exits at the FIRST match, `awk` upstream dies of SIGPIPE, and `set -o pipefail` — three characters in this file's own `set` line — reports the pipeline as failed. So every site whose symbol WAS present failed exactly like a site whose symbol was absent, and the gate was at its reddest precisely where the tree was cleanest. A gate can be wrong in the loud direction too, and a 95% violation rate is the shape that says the instrument is broken rather than the tree.

## `scripts/check-citations.sh`, above `html='index.html'`

**FOR A WHOLE BRANCH THE ONLY THING THIS TEST EVER PLANTED WAS A SINGLE-LINE CITATION IN A `.rs` FILE, WHICH IS THE SAME BLIND-SPOT SHAPE AS THE DOORS IT MISSED.** The corpus is 29 ranges to 26 singles and the pattern's extension list runs to fifteen entries plus `Dockerfile`, so the one form planted was the form least able to expose a fault in either half.

## `scripts/check-grammar-wasm.sh`, above `set -euo pipefail`

measured byte-reproducible (the same grammar, rebuilt after deleting the artefact and written to a different output filename, hashes identically)

## `scripts/check-slow.sh`, above `if [ "$mode" = ignored ]; then`

Second, these sweeps were written and measured under a serial runner — the exhaustive
198,928-program sweep in particular — and running them concurrently changes their peak memory
profile in a way nobody has measured.

## `scripts/install-treesitter-ci.sh`, above `set -euo pipefail`

Verified by experiment, not assumed:
- `objdump -T` on v0.25.10's `tree-sitter-linux-x64.gz` tops out at GLIBC_2.34 — the runner's
  2.35 satisfies that, unlike v0.26.12's 2.39 requirement.
- Regenerating this repository's grammar with the v0.25.10 binary reproduces
  `grammars/tree-sitter-redextape/src/grammar.json` and `src/node-types.json` byte-for-byte, ABI
  15 (same as v0.26.12 — nothing about the ABI moved), corpus 8/8. The ONLY change anywhere in
  `src/` is line 1 of `parser.c`, its `@generated by` header comment naming the generator version;
  the parse tables themselves are unchanged.

## `scripts/install-treesitter-ci.sh`, above `os="$(uname -s)"`

Verified against the v0.25.10 release page (api.github.com/repos/tree-sitter/tree-sitter/releases/
tags/v0.25.10) on 2026-08-21: each asset name below exists, and each checksum below was computed
from an independently downloaded copy of that exact asset — not copied from the release's own
reported digest.

## `scripts/check-attributions.sh`, above `set -euo pipefail`

which this sweep found twice and fixed by hand. Two sites is not a corpus

and **89 of the 165** tracked `.rs` files do

and **145** lines of the stripped tracked `.ts`/`.tsx` code have that shape.

and **77 of the 165** tracked `.rs` files emit a plain `Some`.

## `scripts/check-attributions.sh`, above `return`

A BARE UPPERCAMEL NAME ALONE ON A LINE WAS A RULE HERE AND IS DELETED, for the reason the
`use` bail above was: measured benefit zero. `^[ \t]*[A-Z][A-Za-z0-9_]*[ \t]*,?[ \t]*$`
fires on 302 stripped lines across the tracked `.rs` files, but the only name it contributes
that no other rule in the same file already emits is `None`, in 24 files -- so it made those
24 files declare a name they only USE, and the verdict on every site was unchanged without
it. A bare `BITS` as the tail expression of `Binary::field_symbols` is the same shape and is
not in that 24 only because `tm/encoding/binary.rs` also declares `const BITS`. Measured by dumping
`strip_code <file> rust decls` for every tracked `.rs` file with and without the rule and
diffing the sorted name sets, and by `grep -cE` for the regex over the stripped lines.

## `scripts/check-attributions.sh`, above `if (match(line, /^[ \t]*((export|declare|static|readonly|public|private|protected|override)[ \t]+)*#?[A-Za-z_$][A-Za-z0-9_$]*[ \t]*[?!]?[ \t]*[:=]/)) {`

It read 61 until TypeScript bindings moved
behind `local:`: the two `style.css` citations of `BufferRow.term` had ALSO rested on a local
`const term` in `buffer-list.ts`, and now rest on the member alone, which is the right place.

## `scripts/check-attributions.sh`, above `case "$file" in`

— of 499 sites at the branch point the
cited file was `.ts` 318 times, `.rs` 180 and `.js` once —

## `scripts/check-attributions.sh`, above `[[ ${STRIP_CACHE[$file]} =~ (^|[^A-Za-z0-9_])"$bare"([^A-Za-z0-9_]|$) ]]`

for the reason the deleted presence-only check carried: piping
this through `grep -qwF` instead is the shape that once cost this scan a seven-second run.

## `scripts/check-attributions.sh`, above `printf 'export function caller(b: Builder) {\n  const overflow = b.overflow()\n}\n' >"$tmp/tsbinder.ts"`

**THE TYPESCRIPT HALF OF THE QUALIFIED/BARE SPLIT SHIPPED GUARDED BY NOTHING.** Moving the
`const`/`let`/`var` rule from `put_local` back to `put` left this battery at `22 checks, 0 failures`
AND the scan at 471 sites and 0 violations: both qualified-rejection checks used the Rust
`binder.rs`, and the one live site the TypeScript move reddened had been reworded.

## `scripts/check-attributions.sh`, above `printf 'export interface Leg {\n  timer: number | null\n}\n' >"$tmp/leg.ts"`

Moving the TypeScript SIGNATURE rule or the
PROPERTY rule behind `put_local` also left this battery green, and only the scan noticed, at 2 and 9
violations, because every TypeScript member check here was BARE, and a bare citation passes on a
tagged name.

## `scripts/check-attributions.sh`, above `printf '%s\n' "pub fn quote_char() -> char { '\"' }" 'pub fn after_quote() {}' >"$tmp/quote.rs"`

deleting it changed what three
tracked files declare, and no citation names any of them, so the scan stayed green too.

## `scripts/check-citations.sh`, above `while IFS= read -r -d '' f; do`

Demonstrated on a throwaway repo, this scan reported a clean tree over a
file carrying a citation, and flipping ONLY `core.quotePath` made the same script catch it — the gate's
verdict hung on a config setting nobody had thought about.

## `scripts/check-citations.sh`, above `hits=$(citation_lines "$f")`

running it
on all of them was two thirds of this gate's cost.

## `scripts/check-all.sh`, above `ensure_chromedriver() {`

Chrome 152 shipped, wasm-pack began fetching chromedriver 152, and every machine still on 151
started failing.

MEASURED BOTH WAYS on one
machine: driver 152 against Chrome 151 reproduces that signature byte for byte; driver 151.0.7922.138
against Chrome 151.0.7922.137 runs 24 tests green. Major-matching is enough — the patch levels differ
in that passing run.

## `scripts/check-text-bytes.sh`, above `set -euo pipefail`

`web/src/pane-chrome.ts` carried a literal NUL (0x00) and SOH (0x01) as delimiters in
`bindingSelect`'s cache key.

## `scripts/check-text-bytes.sh`, above `while IFS= read -r -d '' f; do`

Demonstrated on
a throwaway repo: a `café.ts` carrying a real NUL passed this gate, a hole in the very gate that
exists to catch the byte that makes a file invisible.

## `.pre-commit-config.yaml`, above `- id: check-citations`

and the
cost was MEASURED rather than assumed: self-test plus scan is ~250 ms over 258 files, after
the per-file `printf | grep` filters were replaced with bash matching (~975 ms before). The
tally reconciliation added a second `git ls-files` walk, worth about +35 ms — measured
INTERLEAVED against the previous version on the same machine, because absolute figures here
vary by more than the change does and a single before/after pair would have measured load.

## `.pre-commit-config.yaml`, above `- id: check-attributions`

the real figure was 7.5 s, and
what the profile then said was not what the sentence had assumed — stripping every cited file
costs ~180 ms, and the other seven seconds were 486 forks, one per SITE, from command
substitutions in the symbol test and the resolver. Both now return through globals and a bash
word test.

Re-measured INTERLEAVED across three trees, 10 rounds, one sample of each per round in rotating
order, one untimed warm-up per tree, `bash scripts/check-attributions.sh` with no `--self-test`
and the two older trees in `git worktree` checkouts:

```text
  55750f8  presence rule,    499 sites   2,679-2,830 ms   mean 2,778
  e7da0a1  presence rule,    471 sites   2,637-2,680 ms   mean 2,662
  HEAD     declaration rule, 471 sites   2,679-2,796 ms   mean 2,765
```

So the honest result is INDISTINGUISHABLE FROM THE BRANCH POINT — 13 ms of mean on a ~2,700 ms
base, inside a spread of 150 ms — and about **4% SLOWER** than the same 471-site tree under the
old rule, which is the only pair that isolates the extractor. Both halves have a mechanism. The
sweep deleted 28 sites and took ~116 ms of mean with them; the extractor put ~103 ms back.

The guard is now measured on its own terms, both sides the same way:
interleaved on this tree, 10 rounds, one sample of each variant per round in rotating order,
one untimed warm-up each, no `--self-test` — guard present **2,845-2,887 ms, mean 2,865**;
guard line commented out **4,180-4,242 ms, mean 4,217**. Removing it makes the same scan
**47% slower** for an identical verdict. That is a claim about the guard and nothing else; what
the extractor costs against the presence rule is the interleaved table above, and the two
measurements are separate sessions that must not be subtracted from each other.

Re-run
together, interleaved over five rounds, each hook doing what this file makes it do
(`--self-test` then scan): `check-text-bytes` 1,131-1,165 ms, `check-citations` 507-528 ms,
`check-doc-figures` 260-267 ms, `check-shared-docs` 185-193 ms, this hook 2,803-2,843 ms.

## `Cargo.toml`, above `[profile.dev]`

this was measured rather than taken from the documentation: the
workspace's `cargo llvm-cov nextest --workspace --fail-under-lines 90` gate passes at 95.19% lines
under this profile.

Measured on 32 cores, `cargo nextest run --workspace --no-run` into a FRESH target dir each time,
then tarred and zstd'd the way actions/cache stores it:

```text
  debug = 2 (cargo default)   3.71 GB   863 MiB zstd   24s / 25s / 23s
  line-tables-only            2.26 GB   582 MiB zstd   23s / 20s / 22s   <- here
```

THE THREE TIMES PER ARM ARE THE POINT, not padding. A single pair of runs made this look like a
28s-to-20s speedup, and repeating it dissolved that into overlapping ranges: the honest claim is
that dropping the DWARF costs no build time and may save a little, NOT that it is materially
faster. ws-sim, which made this same change, DID measure a large speedup (35s to 18s) — its
workspace is roughly seven times this one's and link time dominates there. Do not import its
number here.
