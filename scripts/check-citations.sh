#!/usr/bin/env bash
# Reject `file:line` citations in tracked source. Cite the symbol.
#
# CI invokes this same script (.forgejo/workflows/ci.yml) and so does the pre-commit hook
# (.pre-commit-config.yaml), so the local and CI gates cannot drift — the convention
# `scripts/check-all.sh` already states, and the sibling `scripts/check-text-bytes.sh` already
# follows. This script is that sibling's shape on purpose.
#
#   scripts/check-citations.sh              # scan the tracked tree
#   scripts/check-citations.sh --self-test  # prove the detector still detects
#
# **WHY THIS GATE EXISTS — MEASUREMENT, NOT PRINCIPLE.** Converting the tree's surviving `file:line`
# citations to symbol citations resolved **57** of them and found **37 stale (65%)**. Three distinct
# mechanisms were confirmed, and only the first was anticipated by the design:
#
#   1. THE CITING COMMIT ITSELF INVALIDATES THE POINTER. `sourcemap_coverage.rs` cited a guard in
#      `lower_asm.rs` that was at exactly the cited line in the PARENT commit — and the same commit
#      that wrote the citation also replaced two `unwrap`s with `if let` seven lines above it. The
#      pointer shipped seven lines short of the thing it named. No later edit was required.
#   2. A LATER, UNRELATED COMMIT SHIFTS THE TARGET. One lint sweep over 104 files — `clippy::pedantic`,
#      whose only behaviour changes were three edge-case defect fixes in unrelated files — broke fifteen
#      citations across two test files: ten of the eleven in one and five of the eight in the other. It
#      **had the first of those files open**, adding four lines at the top for a crate-level
#      `#![allow(..)]`, and re-resolved none of the eleven citations below them.
#   3. THE TARGET IS DELETED OR RELOCATED ENTIRELY. A citation named a `- name: Clippy` step in
#      `ci.yml` that a later commit folded into `scripts/check-all.sh`'s matrix. The invocation moved
#      BETWEEN FILES, so after that commit no line number was correct at any offset — nothing
#      line-based could have followed it.
#
# **AND ONE SURVIVOR IS ACCURATE PURELY BY COINCIDENCE, WHICH IS THE SHARPEST ARGUMENT OF ALL.** Two
# probes cite the same constant one line apart. Each recorded the position its own commit had just
# destroyed, and a later import happened to push the constant back under one of the two pointers. Two
# errors cancelling. Both authors were careful, both were wrong, one got lucky — and no amount of
# care at the citing site reaches that.
#
# **`docs/` IS OUT OF SCOPE, AND THAT IS A BOUNDARY RATHER THAN AN EXEMPTION** (spec §4.2). A citation
# in source is a POINTER — *go look here* — and it stops being true the moment the target moves. A
# citation in a dated spec, plan or roadmap entry is an OBSERVATION — *on that date, this was at that
# line* — and rewriting it would falsify the record. They live there deliberately and in bulk: **849**
# at this slice's branch point, **855** by the time its design was written, **985** when this gate
# landed four and a half hours after the branch point, and **1015** two commits later, because writing
# the closing entry moved it again. Every figure here names a commit for the same reason. **THAT THE
# NUMBER MOVES IS THE POINT, NOT A DEFECT IN IT** — an observation is allowed to be about a tree that no
# longer exists — and the phrase this comment used to carry, "at this branch's close", is a coordinate
# with no tree attached, which is the same fault in prose that the gate rejects in `file:line` form. So
# a future roadmap entry may still cite a line, and should, when the point is to timestamp where
# something stood.
#
# **WHAT IT DELIBERATELY DOES NOT CATCH.** Spec §4.3 names the prose form — `` (`desugar.rs` lines
# <a>-<b>) `` — which rots identically and is out of scope by measurement: a gate on it would fire on 13
# non-citations to catch 2. **A CITATION SPLIT ACROSS A LINE WRAP IS THE OTHER ONE, and it is not in
# §4.3's list because it is a property of the tool rather than a decision.** Write `// see desugar.rs:`
# on one line and `// <line> for the binding` on the next and nothing here matches, because grep is
# line-based and so is every rule below. Reflowing a comment can therefore hide a pointer this gate
# would have rejected the moment it was written on one line — and the pointer rots exactly as fast.
#
# **THIS FILE MAY NOT CONTAIN A REAL CITATION.** It is scanned by its own scan, on the very commit that
# adds it, so a header spelling one out in full would fail the gate it documents. That is not a
# hypothetical: this sentence carried a real one in its first draft — written while explaining that it
# must not — and the first run of the scan over the staged file rejected it by name. Every example here
# is written with a placeholder line (`desugar.rs:<line>`); the ONLY real one is assembled from parts at
# runtime inside `--self-test` and is never written to a tracked file.
set -euo pipefail

# The banned form: a filename with a source extension, a colon, and a digit. `file:N` and `file:N-M`
# are both caught, because the pattern stops at the first digit — and RANGES ARE THE COMMON FORM, not
# the exception, so anything anchored on a bare trailing integer would have passed half the corpus.
# Counted over tracked non-`docs/` files at this slice's branch point: 55 citation tokens, of which 29
# were ranges and 26 were singles. Spec §3.4 first said *"26 of the 55 are `file:N-M`"* — **THE TWO
# HALVES WERE TRANSPOSED, not merely different: 26 is the SINGLES count wearing the ranges label.** The
# total agreed because nothing had been miscounted, which is exactly what made the disagreement look
# harmless enough to note and leave. §3.4 now reads 29, and these three numbers re-derive from the tree
# with this very pattern.
#
# **THE EXTENSION LIST FAILS SILENT, AND THAT IS THE OPPOSITE DIRECTION FROM `BINARY_RE` BELOW.** Both
# lists are dumb and visible for the same stated reason, so the difference has to be said out loud
# rather than inferred from the shared argument. A format missing from `BINARY_RE` is a binary file
# this gate then tries to read: it fails LOUDLY, at the person who added the format. A format missing
# from THIS list is a citation nobody is ever told about — a clean tree reported over a live pointer,
# which is the one outcome the rest of this file exists to prevent. **The quiet direction is the
# dangerous one here, and the list shipped wrong in it.** Eleven extensions, against a tree that
# already tracked five kinds it did not name: an `.html`, a `Dockerfile`, a `.txt`, a `.conf` and two
# `.tm` all passed, and so did an upper-case `Helper.RS:<line>`, because the alternation was
# lower-case only. Demonstrated by the whole-branch review, in a sandbox, on planted pointers — not by
# this gate, which reported the tree clean throughout. `-i` on every match below closes the case half;
# `Dockerfile` is an ALTERNATIVE rather than an entry in the list because it has no extension to match.
#
# **AND THAT ALTERNATIVE IS THE FIRST MEASURED FALSE POSITIVE THIS GATE HAS EVER HAD, WHICH IS WHY IT
# CARRIES A GUARD.** `-i` plus a bare `Dockerfile` fires on `# syntax=docker/dockerfile:1` — the
# BuildKit frontend directive that opens this repo's Dockerfile and most others. It is an `image:tag`,
# not a pointer, and **the escape hatch cannot reach it**: that directive must be the file's first line
# and BuildKit reads everything after the `=` as the image reference, so appending a marker would break
# the build rather than excuse the line. So the discrimination is structural — the character before
# `Dockerfile` must not be a path or word character, which an image reference's `/` always is and a
# citation's `(`, space or line start never is. The roadmap said this gate's false-positive rate was
# unmeasured because the tree held no legitimate use of the form. It holds one.
#
# **WHAT IS STILL UNCOVERED, STATED HERE RATHER THAN LEFT TO BE FOUND THE SAME WAY.** A `Dockerfile`
# citation written with a path prefix, which the guard above cannot keep apart from an image reference
# — this repo has one Dockerfile and it is at the root. Any other extensionless file. Any dotfile cited
# by its bare name, because `[A-Za-z0-9_./-]+` needs at least one character before the dot it anchors
# on. And `.lock`, `.proptest-regressions`, `.gitignore`, `.dockerignore` — tracked here, deliberately
# absent, on the judgement that nobody writes a line pointer into a lockfile or a proptest seed. If one
# appears, this list is the one-line edit, and nothing in this repository will ask for it first.
readonly CITATION_RE='([A-Za-z0-9_./-]+\.(rs|ts|tsx|js|json|toml|yml|yaml|css|md|sh|html|conf|tm|txt)|(^|[^/A-Za-z0-9_.-])Dockerfile):[0-9]+'

# THE ESCAPE HATCH, AND IT IS COUNTED OUT LOUD BECAUSE THAT IS THE ONLY THING SEPARATING IT FROM AN
# ALLOWLIST (spec §4.5). A config file collects exemptions where no reader of the code will ever meet
# them; a marker sits on the line it excuses and is visible in review. If this count is ever above zero
# without an argument beside it, that is a finding. It ships at zero.
readonly ALLOW_RE='check-citations: allow[[:space:]]*$'

# BINARY FILES ARE SKIPPED BY EXTENSION, reusing `check-text-bytes.sh`'s argument verbatim: an
# extension list is dumb, visible, and wrong in ways a reader can see — a new binary format fails this
# gate until someone adds it here, which is the loud direction to be wrong in.
readonly BINARY_RE='\.(png|jpg|jpeg|gif|ico|webp|pdf|wasm|woff2?|ttf|otf|zip|gz|tar|bin|snap|lock)$'

# `docs/` is a scope boundary, not an exemption — see the header and spec §4.2.
readonly SCOPE_RE='^docs/'

# Every citation-bearing line of $1, as `<lineno>:<text>`. **THE ONE DETECTION IMPLEMENTATION** — the
# scan below, the escape-hatch count, and `--self-test` all reach the tree through this and nothing
# else, so the self-test exercises the real thing rather than a paraphrase of it that could drift into
# agreeing with a broken scan.
#
# **REPORTING A CLEAN TREE OVER A FILE THAT WAS NEVER READ IS THE ONE OUTCOME THIS GATE CANNOT AFFORD,
# AND IT TOOK THREE DOORS TO CLOSE. That is the honest lesson here, not the fix.** The class was
# declared shut after the first was found and argued about at length; review then found the other two
# still open, in the shipped gate, on a tree it had already reported clean. All three have the identical
# signature — nothing on stdout, no warning the caller sees, exit 0 — and each arrives from a different
# layer, which is why closing one taught nothing about the others:
#
#   1. **THE SHELL OPENED THE FILE, NOT GREP.** The first draft read `< "$1"`, which looks equivalent
#      and is not: a redirect that cannot open the file fails in BASH, before grep runs, and bash
#      reports that as status **1** — indistinguishable from grep's "found nothing". Tested by hand
#      against a `chmod 000` file, this script printed "0 violations" and exited 0 over a file it had
#      never read. Passing the path makes grep the opener, so a permission failure arrives as grep's
#      exit **2** and the `rc` check below has something real to catch.
#   2. **GREP READ THE FILE AND CALLED IT BINARY.** Under the default `--binary-files=binary` a file
#      holding a NUL — or any byte sequence invalid for the ambient locale — makes grep write
#      `binary file matches` to STDERR, print NOTHING to stdout, and exit **0**. Empty output plus
#      `rc=0` is precisely a clean file, so the `rc > 1` guard never fires. One stray `\377` byte hid
#      every citation in a file, and the sibling does not cover the gap: `check-text-bytes.sh` allows
#      `\200-\377` deliberately, so the file is legal there and invisible here. `-a` forces text
#      handling, so matches print and `rc` still means what the check below assumes; `LC_ALL=C` makes
#      that byte-exact instead of dependent on whoever's locale is set, which is the sibling's
#      convention. **AND IT WAS LIVE AT MORE THAN ONE GREP:** measured, `violations_in`'s `grep -vE`
#      independently declared the PIPED stream binary and dropped the very line this function had just
#      produced — so fixing this one grep alone would still have reported a clean file. Every grep in
#      this script now handles bytes the same way, which is the only version a reader can check at a
#      glance rather than re-derive per call site.
#   3. **THE FILE NEVER REACHED GREP AT ALL** — `git ls-files` quoting, closed at the scan's `-z` loop
#      below, where the argument for it belongs.
#
# A single file operand means grep prints no filename prefix, so the caller still formats the location
# itself, and `--` still sidesteps a leading-dash path.
citation_lines() {
  local rc=0
  LC_ALL=C grep -a -nEi -e "$CITATION_RE" -- "$1" || rc=$?
  # grep exits 1 for "found nothing", which is the passing case and the overwhelmingly common one.
  # ANYTHING ABOVE 1 IS A READ FAILURE. Door 1 is why this check exists and door 2 is why it is not
  # sufficient on its own — a binary verdict arrives as 0, not as 2, and slips straight past it.
  if [ "$rc" -gt 1 ]; then
    printf 'error: could not read %s (grep exited %s)\n' "$1" "$rc" >&2
    exit 2
  fi
}

# Citation-bearing lines of $1 that the escape hatch does NOT excuse. These are the violations.
# The `|| true` covers only grep's "no lines survived", never `citation_lines`' exit 2, because the
# group binds it to the right-hand side of the pipe and `pipefail` still carries a left-hand failure.
violations_in() {
  citation_lines "$1" | { LC_ALL=C grep -a -vE "$ALLOW_RE" || true; }
}

# How many citation-bearing lines of $1 the escape hatch DOES excuse. A marker on a line holding no
# citation is inert rather than honoured, and is deliberately not counted: the number reported is the
# number of violations actually suppressed, which is the number a reader would want to argue with.
honoured_in() {
  citation_lines "$1" | { LC_ALL=C grep -a -cE "$ALLOW_RE" || true; }
}

# The tracked total, taken from `git ls-files` and NOT from the buckets it is about to be checked
# against. Counting NUL terminators rather than lines is what makes it immune to every quoting and
# embedded-newline shape `-z` exists to survive, so this number and the scan's number are wrong in the
# same way or not at all. **IT IS A SECOND, INDEPENDENT WALK OF THE INDEX ON PURPOSE** — a total
# derived from the loop that fills the buckets can only ever agree with the buckets.
tracked_total() {
  git ls-files -z | LC_ALL=C tr -dc '\0' | wc -c | tr -d '[:space:]'
}

# **THIS IS THE ASSERTION THAT CAN FAIL, AND FOR ONE BRANCH IT WAS ONE THAT COULD NOT.** The scan's
# tally used to print `$((scanned + excluded + skipped))` under a comment calling it *"`git ls-files`'
# own count"*. It compared nothing. The sum of the three buckets is the sum of the three buckets, so a
# path that vanished before the loop moved every term at once and the arithmetic stayed consistent all
# the way to `exit 0`. The whole-branch review demonstrated it: a planted drop over a file holding a
# real pointer, `0 skipped`, *"7 tracked paths in all"* against a tree of 8, clean exit. **That is door
# 3's own shape, reproduced inside the sentence written to announce door 3** — in the gate whose thesis
# is that a written claim rots, four doors after the class was declared shut. `$4` now has an
# independent origin, which is the entire difference between a reconciliation and a restatement.
reconcile() {
  local scanned="$1" excluded="$2" skipped="$3" total="$4" sum
  sum=$((scanned + excluded + skipped))
  if [ "$sum" -ne "$total" ]; then
    printf 'error: %s scanned + %s out of scope or binary + %s skipped = %s, but git ls-files reports %s tracked path(s) — this scan did not read the whole tree\n' \
      "$scanned" "$excluded" "$skipped" "$sum" "$total" >&2
    exit 2
  fi
}

# Prove the detector still detects. **A GATE THAT ONLY EVER RUNS AGAINST A PASSING TREE CANNOT TELL YOU
# IT STILL WORKS** — this repo's own "an assertion that cannot fail is a defect" rule turned on the
# checker itself. `check-text-bytes.sh`'s first draft reported clean against a planted NUL, and only a
# by-hand test against the real thing found it; that is why its `--self-test` exists and why this one
# does. Both directions are asserted here, plus the escape hatch, because a valve that silently stopped
# working would be discovered only by the person who needed it.
self_test() {
  local dirty clean allowed ranged uppercase dockerish name html shouty lineno n
  SELF_TEST_DIR=$(mktemp -d)
  trap 'rm -rf "${SELF_TEST_DIR:?}"' EXIT
  dirty="$SELF_TEST_DIR/dirty.rs"
  clean="$SELF_TEST_DIR/clean.rs"
  allowed="$SELF_TEST_DIR/allowed.rs"
  ranged="$SELF_TEST_DIR/ranged.md"
  uppercase="$SELF_TEST_DIR/uppercase.rs"
  dockerish="$SELF_TEST_DIR/Dockerfile"

  # **THE ONLY REAL CITATION ANYWHERE IN THIS SLICE, AND IT IS ASSEMBLED HERE RATHER THAN WRITTEN.**
  # The name and the number are separate values joined by printf, so no line of this tracked file
  # matches `CITATION_RE` and the script does not fail its own scan on the commit that adds it.
  name='desugar.rs'
  lineno=77
  printf '//! the `Stmt::Let` arm (%s:%d) builds the binding.\n' "$name" "$lineno" > "$dirty"
  printf '//! the `Stmt::Let` arm (`%s` — `lower_stmts_at`) builds the binding.\n' "$name" > "$clean"
  printf 'assert_eq!(frame, "%s:%d"); // check-citations: allow\n' "$name" "$lineno" > "$allowed"

  # **FOR A WHOLE BRANCH THE ONLY THING THIS TEST EVER PLANTED WAS A SINGLE-LINE CITATION IN A `.rs`
  # FILE, WHICH IS THE SAME BLIND-SPOT SHAPE AS THE DOORS IT MISSED.** The corpus is 29 ranges to 26
  # singles and the pattern's extension list runs to fifteen entries plus `Dockerfile`, so the one form
  # planted was the form least able to expose a fault in either half. These two, with the pair below,
  # cover the rest of the pattern's surface: a RANGE in a non-`.rs` extension, an upper-case extension,
  # and the extensionless alternative against the image reference it must not fire on. The extension
  # list's silent-failure direction is argued at `CITATION_RE`; these are the assertions that would
  # have caught the five kinds it was missing.
  html='index.html'
  shouty='Desugar.RS'
  printf '<!-- the viewport meta tag (%s:%d-%d) sets the scale -->\n' "$html" "$lineno" "$((lineno + 9))" > "$ranged"
  printf '//! the `Stmt::Let` arm (%s:%d) builds the binding.\n' "$shouty" "$lineno" > "$uppercase"

  # THE EXTENSIONLESS ALTERNATIVE AND THE THING IT MUST NOT FIRE ON, IN ONE FILE, BECAUSE THE PAIR IS
  # THE ASSERTION — either half alone can be satisfied by deleting the other. `# syntax=<image>:<tag>`
  # is a real line of this repo's Dockerfile and the only false positive this gate has ever produced;
  # the guard in `CITATION_RE` is what tells the two apart, and nothing else here would notice if it
  # were removed.
  printf '# the build context (%s:%d) is what COPY reads\n# syntax=%s/%s:%d\n' \
    'Dockerfile' "$lineno" 'docker' 'dockerfile' 1 > "$dockerish"

  n=$(violations_in "$dirty" | wc -l | tr -d '[:space:]')
  if [ "$n" -ne 1 ]; then
    echo "self-test FAILED: a planted file:line citation was not detected — this gate is not working" >&2
    exit 1
  fi

  n=$(violations_in "$clean" | wc -l | tr -d '[:space:]')
  if [ "$n" -ne 0 ]; then
    echo "self-test FAILED: a symbol citation was flagged — this gate rejects the form it asks for" >&2
    exit 1
  fi

  n=$(violations_in "$allowed" | wc -l | tr -d '[:space:]')
  if [ "$n" -ne 0 ]; then
    echo "self-test FAILED: an excused citation was still reported — the escape hatch does not work" >&2
    exit 1
  fi

  n=$(honoured_in "$allowed")
  if [ "$n" -ne 1 ]; then
    echo "self-test FAILED: an excused citation was not counted — an uncounted marker is an allowlist" >&2
    exit 1
  fi

  n=$(violations_in "$ranged" | wc -l | tr -d '[:space:]')
  if [ "$n" -ne 1 ]; then
    echo "self-test FAILED: a planted RANGE citation in a non-.rs file was not detected — the pattern's range half or its extension list is broken" >&2
    exit 1
  fi

  n=$(violations_in "$uppercase" | wc -l | tr -d '[:space:]')
  if [ "$n" -ne 1 ]; then
    echo "self-test FAILED: a planted citation with an upper-case extension was not detected — the match is case-sensitive again" >&2
    exit 1
  fi

  n=$(violations_in "$dockerish" | wc -l | tr -d '[:space:]')
  if [ "$n" -ne 1 ]; then
    echo "self-test FAILED: expected exactly 1 violation in the Dockerfile fixture, got $n — either the extensionless alternative stopped matching, or its guard stopped excusing a BuildKit image reference" >&2
    exit 1
  fi

  # THE SCAN'S BOOKKEEPING, BOTH DIRECTIONS, AND IT IS THE ONE ASSERTION HERE THAT IS NOT ABOUT THE
  # DETECTOR. `reconcile` exits rather than returns, so it is driven in a subshell and judged by its
  # status. It is tested because the claim it now enforces shipped for a whole branch as an identity
  # that could not fail, and because four of this gate's five silent-pass doors were invisible to this
  # function — this one being the fifth, and an announcement that cannot fail being the same defect
  # wearing a new shape.
  if ! ( reconcile 7 3 1 11 ) 2>/dev/null; then
    echo "self-test FAILED: an exact tally was rejected — the reconciliation fires on a whole tree" >&2
    exit 1
  fi
  if ( reconcile 7 3 1 12 ) 2>/dev/null; then
    echo "self-test FAILED: a tally one short of git ls-files was accepted — a dropped file would pass unannounced" >&2
    exit 1
  fi

  echo "self-test passed: planted file:line citations are caught (single and range, .rs and not, either case), a symbol citation is not, an excused one is counted rather than hidden, and a tally that does not match git ls-files is rejected"
}

# **AN UNRECOGNISED ARGUMENT IS AN ERROR, IN A GATE WHOSE WHOLE THESIS IS "NO SILENT PASS".** The first
# version tested `[ "${1:-}" = "--self-test" ]` and fell through on anything else, so
# `check-citations.sh --slf-test` ran a full scan and exited 0 — a typo in the CI step or the hook would
# have quietly downgraded the self-test into a duplicate of the scan beside it, and a duplicate scan
# passes for exactly as long as the tree is clean. Matching `$#` alongside `$1` also rejects a second
# operand and an explicit empty one, which a bare `case "${1-}"` would wave through.
case "$#:${1-}" in
  0:) ;;                              # no argument: scan the tracked tree
  1:--self-test) self_test; exit 0 ;;
  *)
    printf 'error: unrecognised argument: %s\n' "$*" >&2
    cat >&2 <<'MSG'
usage: scripts/check-citations.sh [--self-test]

  (no argument)   scan tracked source for `file:line` citations
  --self-test     prove the detector still detects, against planted fixtures
MSG
    exit 2
    ;;
esac

cd "$(git rev-parse --show-toplevel)"

bad=0
honoured=0
scanned=0
excluded=0
skipped=0
# **DOOR 3, AND `-z` IS NOT ABOUT SPACES.** `git ls-files` C-QUOTES any path it considers unusual —
# `core.quotePath` defaults to true — so a tracked `café.rs` arrives as the ten-character literal
# `"caf\303\251.rs"`, `[ -f ]` fails on that string, and the file is dropped: not read, not counted, not
# warned, `scanned` unmoved. Demonstrated on a throwaway repo, this scan reported a clean tree over a
# file carrying a citation, and flipping ONLY `core.quotePath` made the same script catch it — the gate's
# verdict hung on a config setting nobody had thought about. `-c core.quotePath=false` would close that
# and would still drop a path with an embedded NEWLINE, because the loop would still be reading lines.
# NUL-delimited closes both, plus the spaces and leading dashes that were already handled, and cannot be
# undone by whatever a user has in their config.
while IFS= read -r -d '' f; do
  if [ ! -f "$f" ]; then
    # A DANGLING SYMLINK OR A SUBMODULE GITLINK LANDS HERE — and so would a return of door 3, which is
    # the point of counting rather than skipping in silence. This branch was the channel door 3 rode in
    # through, and it said nothing while it did.
    printf 'note: skipped %s — tracked but not a regular file\n' "$f" >&2
    skipped=$((skipped + 1))
    continue
  fi
  # Matched in bash rather than by piping each path into `grep -q`, unlike the sibling: two extra
  # processes per file is most of a whole-tree scan's runtime, and a path is one string.
  # `${f,,}` lowercases, which is what the sibling's `grep -qi` was for.
  if [[ $f =~ $SCOPE_RE ]] || [[ ${f,,} =~ $BINARY_RE ]]; then
    excluded=$((excluded + 1))
    continue
  fi
  scanned=$((scanned + 1))

  # ONE detector pass on the overwhelmingly common path — no file has a citation, so this returns
  # empty and the file is done. The two classifiers below each run `citation_lines` again, and that
  # re-read is free precisely because it only happens for a file that already has a hit; running it
  # on all of them was two thirds of this gate's cost. THE EARLY EXIT CANNOT CHANGE AN ANSWER: both
  # classifiers read `citation_lines`' output and nothing else, so empty in means empty and zero out.
  #
  # `$(...)` STRIPS NUL AND PRINTS A WARNING WHEN IT DOES, WHICH IS SAFE ONLY BECAUSE OF WHAT THIS
  # VALUE IS USED FOR. It is tested for emptiness and nothing else, and a line that matched
  # `CITATION_RE` carries a filename and a digit, so no amount of NUL-stripping can empty it. That is
  # the whole argument — it is not that the bytes survive, it is that they cannot flip this test. The
  # sibling's first draft was killed by the same stripping precisely because it passed the BYTES
  # through `$(...)` rather than a count, so a reader who sees bash's warning here should be able to
  # find out in one place why this instance is not that bug.
  hits=$(citation_lines "$f")
  [ -n "$hits" ] || continue

  n=$(honoured_in "$f")
  honoured=$((honoured + n))

  while IFS= read -r hit; do
    # The location is printed in the editors' and compilers' `path:line:` form, which is exactly the
    # shape this gate bans in a file — and the distinction is §4.2's, not an inconsistency. A pointer
    # written into a tracked file has to stay true; a line of terminal output is an observation of one
    # run against one tree, and it is never a tracked file.
    tokens=$(printf '%s\n' "$hit" | { LC_ALL=C grep -a -oEi "$CITATION_RE" || true; } | tr '\n' ' ')
    printf 'error: %s:%s: cites %sby line number — name the symbol instead\n' \
      "$f" "${hit%%:*}" "$tokens" >&2
    bad=1
  done < <(violations_in "$f")
done < <(git ls-files -z)

# A SCAN OF NOTHING MUST NOT PASS. Run from a tree where `git ls-files` returns nothing — a bad `cd`, a
# fresh worktree, a submodule — every check above is vacuous and the gate reports success. That is the
# empty-scan trap the conversion tasks had to rule out by hand before trusting their own clean runs.
if [ "$scanned" -eq 0 ]; then
  echo "error: scanned 0 files — this is an empty scan reporting success, not a clean tree" >&2
  exit 1
fi

# **EVERY TRACKED PATH LANDS IN EXACTLY ONE OF THE THREE, AND THAT IS CHECKED AGAINST `git ls-files`
# RATHER THAN RESTATED FROM THE THREE.** A file that goes missing between them shows up as a total that
# no longer adds — which is the shape door 3 had and could not announce, and which the first version of
# this very sentence also could not, because it printed the sum instead of comparing it. `reconcile`
# carries that history and the demonstration. `skipped` ships at 0 — this repo has no submodules and no
# dangling symlinks — and the reported total is now `git ls-files`' number, not the scan's.
total=$(tracked_total)
reconcile "$scanned" "$excluded" "$skipped" "$total"
tally=$(printf '%s out of scope or binary, %s skipped — %s tracked paths in all' \
  "$excluded" "$skipped" "$total")

if [ "$bad" -ne 0 ]; then
  cat >&2 <<'MSG'

A `file:line` citation is a POINTER, and it stops being true the moment anything is inserted above the
target — including by the commit that writes the citation. Of 57 resolved on the slice that introduced
this gate, 37 were already stale; one lint sweep over 104 files — whose only behaviour changes were
three edge-case defect fixes in unrelated files — broke fifteen of them.

Cite the SYMBOL instead. It survives every edit that does not rename it, and a rename is a `grep` the
compiler will usually run for you:

    banned    see desugar.rs:<line> for the binding
    instead   see `desugar.rs`'s `lower_stmts_at`, in its `Stmt::Let` arm

Where the sentence already names the symbol, the file basename alone is enough. Where the old
coordinate is worth keeping as a record of the drift, write it in prose (`desugar.rs` line <line>) —
a dated observation about the past is not a pointer, which is also why `docs/` is out of scope here.

If a line genuinely must carry a coordinate — a stack-trace assertion, a source-map fixture — end it
with `check-citations: allow`. Every run counts those out loud, and the count ships at zero.
MSG
  # **"EVERY RUN" HAS TO INCLUDE THIS ONE, AND THAT IS §4.5'S DISTINCTION RATHER THAN A FORMATTING
  # CHOICE.** The count printed only on the success path at first, so a commit adding a violation AND a
  # marker slipped the marker past unannounced: the run that should have shown it exited 1 without it,
  # and it first became visible on the run after the violation was fixed — exactly when nobody is
  # looking for it. A marker nobody is told about is the allowlist §4.5 rejected.
  printf '%s escape-hatch marker(s) honoured on this run; %s files scanned (%s).\n' \
    "$honoured" "$scanned" "$tally" >&2
  exit 1
fi

printf 'no file:line citations in tracked source: %s files scanned, 0 violations, %s escape-hatch marker(s) honoured (%s)\n' \
  "$scanned" "$honoured" "$tally"
