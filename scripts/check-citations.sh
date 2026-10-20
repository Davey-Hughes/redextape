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
# **WHY THIS GATE EXISTS: LINE NUMBERS ROT, AND NO CARE AT THE CITING SITE PREVENTS IT.** Three
# distinct mechanisms:
#
#   1. THE CITING COMMIT ITSELF INVALIDATES THE POINTER. The commit that writes the citation can also edit
#      lines above its target, so the pointer ships short of the thing it named. No later edit is required.
#   2. A LATER, UNRELATED COMMIT SHIFTS THE TARGET. A lint sweep that adds lines at the top of a file
#      re-resolves none of the citations below them.
#   3. THE TARGET IS DELETED OR RELOCATED ENTIRELY. When the invocation moves BETWEEN FILES, no line number
#      is correct at any offset — nothing line-based could follow it.
#
# A citation can even be accurate purely by coincidence — two errors cancelling — and no amount of care at
# the citing site reaches that.
#
# **`docs/` IS OUT OF SCOPE, AND THAT IS A BOUNDARY RATHER THAN AN EXEMPTION** (spec §4.2). A citation in
# source is a POINTER — *go look here* — and it stops being true the moment the target moves. A citation in
# a dated spec, plan or roadmap entry is an OBSERVATION — *on that date, this was at that line* — and
# rewriting it would falsify the record. They live there deliberately and in bulk, and **THAT THEIR NUMBER
# MOVES IS THE POINT, NOT A DEFECT** — an observation is allowed to be about a tree that no longer
# exists. So a future roadmap entry may still cite a line, and should, when the point is to timestamp where
# something stood.
#
# **WHAT IT DELIBERATELY DOES NOT CATCH.** Spec §4.3 names the prose form — `` (`desugar.rs` lines
# <a>-<b>) `` — which rots identically and is out of scope by the measurement §4.3 records.
# **A CITATION SPLIT ACROSS A LINE WRAP IS THE OTHER ONE, and it is not in §4.3's list because it is
# a property of the tool rather than a decision.** Write `// see desugar.rs:` on one line and
# `// <line> for the binding` on the next and nothing here matches, because grep is line-based and so
# is every rule below. Reflowing a comment can therefore hide a pointer this gate would have rejected
# the moment it was written on one line — and the pointer rots exactly as fast.
#
# **THIS FILE MAY NOT CONTAIN A REAL CITATION.** It is scanned by its own scan, so a header spelling one out
# in full would fail the gate it documents. Every example here is written with a placeholder line
# (`desugar.rs:<line>`); the ONLY real one is assembled from parts at runtime inside `--self-test` and is
# never written to a tracked file.
set -euo pipefail

# The banned form: a filename with a source extension, a colon, and a digit. `file:N` and `file:N-M`
# are both caught, because the pattern stops at the first digit — and RANGES ARE THE COMMON FORM, not
# the exception, so anything anchored on a bare trailing integer would have passed half the corpus.
#
# **THE EXTENSION LIST FAILS SILENT, AND THAT IS THE OPPOSITE DIRECTION FROM `BINARY_RE` BELOW.** Both lists
# are dumb and visible for the same stated reason, so the difference has to be said out loud rather than
# inferred from the shared argument. A format missing from `BINARY_RE` is a binary file this gate then tries
# to read: it fails LOUDLY, at the person who added the format. A format missing from THIS list is a
# citation nobody is ever told about — a clean tree reported over a live pointer, which is the one outcome
# the rest of this file exists to prevent. **The quiet direction is the dangerous one here.** `-i` on every
# match below makes the extensions case-insensitive; `Dockerfile` is an ALTERNATIVE rather than an entry in
# the list because it has no extension to match.
#
# **THE `Dockerfile` ALTERNATIVE CARRIES A GUARD.** `-i` plus a bare `Dockerfile` fires on
# `# syntax=docker/dockerfile:1` — the BuildKit frontend directive that opens this repo's Dockerfile and
# most others. It is an `image:tag`, not a pointer, and **the escape hatch cannot reach it**: that directive
# must be the file's first line and BuildKit reads everything after the `=` as the image reference, so
# appending a marker would break the build rather than excuse the line. So the discrimination is structural
# — the character before `Dockerfile` must not be a path or word character, which a NAMESPACED image
# reference's `/` is and a citation's `(`, space or line start is not.
#
# **THE GUARD COVERS THE NAMESPACED CASE ONLY.** An unnamespaced Docker Hub reference has no slash at all:
# `# syntax=dockerfile:<tag>` and `FROM dockerfile:<tag>` are FLAGGED (written with a placeholder tag here
# because real digits would make THIS COMMENT fail the scan, the same reason the header above may hold no
# real citation). Neither form appears in this repo and the real BuildKit frontend is `docker/dockerfile`,
# so nothing here fires. **The residue fails LOUD**, which is the direction to be wrong in: an unnamespaced
# reference stops a commit and gets read, where a missed citation would not.
#
# **WHAT IS STILL UNCOVERED.** A `Dockerfile` citation written with a path prefix, which the guard above
# cannot keep apart from an image reference — this repo has one Dockerfile and it is at the root. Any other
# extensionless file. Any dotfile cited by its bare name, because `[A-Za-z0-9_./-]+` needs at least one
# character before the dot it anchors on. And `.lock`, `.proptest-regressions`, `.gitignore`,
# `.dockerignore` — tracked here, deliberately absent, on the judgement that nobody writes a line pointer
# into a lockfile or a proptest seed. If one appears, this list is the one-line edit, and nothing in this
# repository will ask for it first.
readonly CITATION_RE='([A-Za-z0-9_./-]+\.(rs|ts|tsx|js|json|toml|yml|yaml|css|md|sh|html|conf|tm|txt|rxt)|(^|[^/A-Za-z0-9_.-])Dockerfile):[0-9]+'

# THE ESCAPE HATCH, AND IT IS COUNTED OUT LOUD BECAUSE THAT IS THE ONLY THING SEPARATING IT FROM AN
# ALLOWLIST (spec §4.5). A config file collects exemptions where no reader of the code will ever meet
# them; a marker sits on the line it excuses and is visible in review. If this count is ever above zero
# without an argument beside it, that is a finding.
#
# **IT SHIPS AT TWO, AND THIS IS THE ARGUMENT THE SENTENCE ABOVE DEMANDS.** Both are in `report.rs`'s
# byte-vs-char indexing test, on the two lines carrying `a.rxt:<line>:<col>`. That is the exact case the
# message at the bottom of this file names — *"a stack-trace assertion, a source-map fixture"* — and it is a
# stronger instance than either: `a.rxt` IS NOT A FILE. It is the `label` argument that test hands to
# `render`, so the coordinate names a position in a string literal in the same function, and there is no
# target it could ever drift away from. A pointer that cannot rot is not what this gate is for, and the
# marker says so on the line rather than in a config nobody reads.
readonly ALLOW_RE='check-citations: allow[[:space:]]*$'

# BINARY FILES ARE SKIPPED BY EXTENSION, reusing `check-text-bytes.sh`'s argument verbatim: an
# extension list is dumb, visible, and wrong in ways a reader can see — a new binary format fails this
# gate until someone adds it here, which is the loud direction to be wrong in.
readonly BINARY_RE='\.(png|jpg|jpeg|gif|ico|webp|pdf|wasm|woff2?|ttf|otf|zip|gz|tar|bin|snap|lock)$'

# `docs/` is a scope boundary, not an exemption — see the header and spec §4.2.
readonly SCOPE_RE='^docs/'

# **RECORDINGS ARE THE SECOND BOUNDARY, AND THEY ARE A BOUNDARY FOR `docs/`'s REASON, NOT A NEW ONE.** A
# `.stdout`/`.stderr` golden is a byte-for-byte capture of what the binary printed. A golden can hold lines
# rendering `warn.rxt:<line>:<col>` — ariadne's rendered diagnostic location for a real fixture at its real
# position. That is not a pointer somebody wrote and will forget to update; it is output, and the test that
# owns it fails the moment it stops matching, so it CANNOT go stale unnoticed. Exactly `docs/`'s argument
# — an observation is not a pointer — arriving from the other end.
#
# **AND THE ESCAPE HATCH STRUCTURALLY CANNOT REACH THEM, WHICH IS WHY THIS IS A BOUNDARY RATHER THAN
# PER-LINE MARKERS.** A marker excuses the line it sits on; a golden must byte-match the program's output;
# the program does not print `check-citations: allow`. Appending one would break the test it belongs to
# — the same shape as the Dockerfile `# syntax=` line above, where the hatch also could not reach and
# the discrimination had to move into the pattern.
#
# What this gives up, stated rather than discovered later: a genuine authored pointer inside a golden
# is invisible here. Nobody hand-writes prose into a file `TRYCMD=dump` regenerates, and a golden
# is reviewed as a diff against real output, so the exposure is small — but it is not zero.
readonly RECORDING_RE='\.(stdout|stderr)$'

# True when $1 is a path this gate does not read: out of scope, binary, or a recording.
#
# **THIS IS A FUNCTION SO THE SELF-TEST CAN REACH IT, AND THAT IS THE WHOLE REASON.** Every exclusion here
# is a door of exactly the shape of the three doors below — nothing on stdout, no warning, exit 0 —
# and predicates written inline in the scan loop are out of the self-test's reach. `violations_in` is
# tested, and the decision about WHICH FILES REACH IT needs testing as much.
excluded_path() {
  local f="$1"
  [[ $f =~ $SCOPE_RE ]] || [[ ${f,,} =~ $BINARY_RE ]] || [[ ${f,,} =~ $RECORDING_RE ]]
}

# Every citation-bearing line of $1, as `<lineno>:<text>`. **THE ONE DETECTION IMPLEMENTATION** — the
# scan below, the escape-hatch count, and `--self-test` all reach the tree through this and nothing
# else, so the self-test exercises the real thing rather than a paraphrase of it that could drift into
# agreeing with a broken scan.
#
# **REPORTING A CLEAN TREE OVER A FILE THAT WAS NEVER READ IS THE ONE OUTCOME THIS GATE CANNOT AFFORD, AND
# THREE DOORS LEAD TO IT.** All three have the identical signature — nothing on stdout, no warning the
# caller sees, exit 0 — and each arrives from a different layer, which is why closing one says nothing
# about the others:
#
#   1. **A FILE THE SHELL OPENS, NOT GREP.** A `< "$1"` redirect looks equivalent and is not: a redirect
#      that cannot open the file fails in BASH, before grep runs, and bash reports that as status **1** —
#      indistinguishable from grep's "found nothing". Passing the path makes grep the opener, so a
#      permission failure arrives as grep's exit **2** and the `rc` check below has something real to catch.
#   2. **A FILE GREP READS AND CALLS BINARY.** Under the default `--binary-files=binary` a file
#      holding a NUL — or any byte sequence invalid for the ambient locale — makes grep write
#      `binary file matches` to STDERR, print NOTHING to stdout, and exit **0**. Empty output plus
#      `rc=0` is precisely a clean file, so the `rc > 1` guard never fires. One stray `\377` byte hides
#      every citation in a file, and the sibling does not cover the gap: `check-text-bytes.sh` allows
#      `\200-\377` deliberately, so the file is legal there and invisible here. `-a` forces text
#      handling, so matches print and `rc` still means what the check below assumes; `LC_ALL=C` makes
#      that byte-exact instead of dependent on whoever's locale is set, which is the sibling's
#      convention. **AND IT IS NOT CONFINED TO ONE GREP:** `violations_in`'s `grep -vE` would
#      independently declare the PIPED stream binary and drop the very line this function produced, so
#      every grep in this script handles bytes the same way, which is the only version a reader can check
#      at a glance rather than re-derive per call site.
#   3. **A FILE THAT NEVER REACHES GREP AT ALL** — `git ls-files` quoting, closed at the scan's `-z` loop
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

# **THIS IS THE ASSERTION THAT CAN FAIL.** Comparing the sum of the three buckets with itself compares
# nothing: a path that vanished before the loop moves every term at once and the arithmetic stays consistent
# all the way to `exit 0`. `$4` has an independent origin (`git ls-files`' own count), which is the entire
# difference between a reconciliation and a restatement.
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
# checker itself. That is why `check-text-bytes.sh` and this script each carry a `--self-test`. Both
# directions are asserted here, plus the escape hatch, because a valve that silently stopped working
# would be discovered only by the person who needed it.
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
  surfaced="$SELF_TEST_DIR/surfaced.rs"

  # A real citation, assembled here rather than written. The name and the number are separate values
  # joined by printf, so no line of this tracked file matches `CITATION_RE` and the script does not
  # fail its own scan.
  name='desugar.rs'
  lineno=77
  printf '//! the `Stmt::Let` arm (%s:%d) builds the binding.\n' "$name" "$lineno" > "$dirty"
  printf '//! the `Stmt::Let` arm (`%s` — `lower_stmts_at`) builds the binding.\n' "$name" > "$clean"
  printf 'assert_eq!(frame, "%s:%d"); // check-citations: allow\n' "$name" "$lineno" > "$allowed"

  # These two, with the pair below, cover the pattern's surface beyond a single-line citation in a `.rs`
  # file: a RANGE in a non-`.rs` extension, an upper-case extension, and the extensionless alternative
  # against the image reference it must not fire on. The extension list's silent-failure direction is
  # argued at `CITATION_RE`; these are its assertions.
  html='index.html'
  shouty='Desugar.RS'
  printf '<!-- the viewport meta tag (%s:%d-%d) sets the scale -->\n' "$html" "$lineno" "$((lineno + 9))" > "$ranged"
  printf '//! the `Stmt::Let` arm (%s:%d) builds the binding.\n' "$shouty" "$lineno" > "$uppercase"

  # THE EXTENSIONLESS ALTERNATIVE AND THE THING IT MUST NOT FIRE ON, IN ONE FILE, BECAUSE THE PAIR IS
  # THE ASSERTION — either half alone can be satisfied by deleting the other. `# syntax=<image>:<tag>`
  # is a real line of this repo's Dockerfile; the guard in `CITATION_RE` is what tells the two apart, and
  # nothing else here would notice if it were removed.
  printf '# the build context (%s:%d) is what COPY reads\n# syntax=%s/%s:%d\n' \
    'Dockerfile' "$lineno" 'docker' 'dockerfile' 1 > "$dockerish"

  # Planted so the extension list cannot quietly lose `rxt`: every other planted citation names a
  # `.rs`, `.html` or `Dockerfile` target, so without this one, removing `rxt` from `CITATION_RE`
  # would pass this whole self-test.
  printf '//! the fixture at %s:%d is what `fmt_error.toml` feeds the binary.\n' 'broken.rxt' "$lineno" > "$surfaced"

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
    echo "self-test FAILED: a planted citation with an upper-case extension was not detected — the match is case-sensitive" >&2
    exit 1
  fi

  n=$(violations_in "$dockerish" | wc -l | tr -d '[:space:]')
  if [ "$n" -ne 1 ]; then
    echo "self-test FAILED: expected exactly 1 violation in the Dockerfile fixture, got $n — either the extensionless alternative stopped matching, or its guard stopped excusing a BuildKit image reference" >&2
    exit 1
  fi

  n=$(violations_in "$surfaced" | wc -l | tr -d '[:space:]')
  if [ "$n" -ne 1 ]; then
    echo "self-test FAILED: a planted citation naming a .rxt target was not detected — \`rxt\` has fallen out of the extension list, which fails silent by design" >&2
    exit 1
  fi

  # **WHICH FILES REACH THE DETECTOR, ASSERTED IN BOTH DIRECTIONS.** Every assertion above this point
  # tests `violations_in`; none of them tests whether a file ever gets handed to it. That is the same
  # blind spot as the three doors named above `citation_lines` — a path silently skipped and a file
  # silently unread are the identical outcome — and `excluded_path` exists as a function precisely so
  # this block can exist. The NEGATIVE half is the load-bearing one: an exclusion predicate that
  # returned true for everything would satisfy every positive case and read like a working gate.
  for excluded_case in 'docs/superpowers/plans/roadmap.md' 'web/public/logo.PNG' 'tests/cmd/lint_warn.stderr' 'tests/cmd/fmt_stdin.stdout'; do
    if ! excluded_path "$excluded_case"; then
      echo "self-test FAILED: '$excluded_case' should be out of scope, binary or a recording, and was not — an exclusion this gate documents is not being applied" >&2
      exit 1
    fi
  done
  for scanned_case in 'crates/redextape-core/src/lints.rs' 'web/src/highlight.ts' 'crates/redextape-cli/tests/cmd/broken.rxt' 'Dockerfile'; do
    if excluded_path "$scanned_case"; then
      echo "self-test FAILED: '$scanned_case' was excluded from the scan — a file this gate must read is being skipped, which is a silent pass" >&2
      exit 1
    fi
  done

  # THE SCAN'S BOOKKEEPING, BOTH DIRECTIONS. `reconcile` exits rather than returns, so it is driven in
  # a subshell and judged by its status. It is tested because an identity check that cannot fail looks
  # exactly like one that passes.
  if ! ( reconcile 7 3 1 11 ) 2>/dev/null; then
    echo "self-test FAILED: an exact tally was rejected — the reconciliation fires on a whole tree" >&2
    exit 1
  fi
  if ( reconcile 7 3 1 12 ) 2>/dev/null; then
    echo "self-test FAILED: a tally one short of git ls-files was accepted — a dropped file would pass unannounced" >&2
    exit 1
  fi

  echo "self-test passed: planted file:line citations are caught (single and range, .rs and not, either case, and naming a .rxt target), a symbol citation is not, an excused one is counted rather than hidden, the scan's own exclusions admit and reject the right paths, and a tally that does not match git ls-files is rejected"
}

# **AN UNRECOGNISED ARGUMENT IS AN ERROR, IN A GATE WHOSE WHOLE THESIS IS "NO SILENT PASS".** A
# `[ "${1:-}" = "--self-test" ]` test falls through on anything else, so `check-citations.sh --slf-test`
# would run a full scan and exit 0 — a typo in the CI step or the hook would quietly downgrade the
# self-test into a duplicate of the scan beside it, and a duplicate scan passes for exactly as long as
# the tree is clean. Matching `$#` alongside `$1` also rejects a second operand and an explicit empty
# one, which a bare `case "${1-}"` would wave through.
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
# `core.quotePath` defaults to true — so a tracked `café.rs` arrives as the literal `"caf\303\251.rs"`,
# `[ -f ]` fails on that string, and the file is dropped: not read, not counted, not warned, `scanned`
# unmoved. Read that way, the gate's verdict would hang on a config setting. `-c core.quotePath=false`
# would close that and would still drop a path with an embedded NEWLINE, because the loop would still
# be reading lines. NUL-delimited closes both, plus spaces and leading dashes, and cannot be undone by
# whatever a user has in their config.
while IFS= read -r -d '' f; do
  if [ ! -f "$f" ]; then
    # A dangling symlink or a submodule gitlink lands here — and so would a return of door 3, which is
    # the point of counting rather than skipping in silence.
    printf 'note: skipped %s — tracked but not a regular file\n' "$f" >&2
    skipped=$((skipped + 1))
    continue
  fi
  # Matched in bash rather than by piping each path into `grep -q`, unlike the sibling: two extra
  # processes per file is most of a whole-tree scan's runtime, and a path is one string.
  # `${f,,}` lowercases, which is what the sibling's `grep -qi` was for.
  if excluded_path "$f"; then
    excluded=$((excluded + 1))
    continue
  fi
  scanned=$((scanned + 1))

  # ONE detector pass on the overwhelmingly common path — no file has a citation, so this returns
  # empty and the file is done. The two classifiers below each run `citation_lines` again, and that
  # re-read is free precisely because it only happens for a file that already has a hit. THE EARLY EXIT
  # CANNOT CHANGE AN ANSWER: both classifiers read `citation_lines`' output and nothing else, so empty in
  # means empty and zero out.
  #
  # `$(...)` STRIPS NUL AND PRINTS A WARNING WHEN IT DOES, WHICH IS SAFE ONLY BECAUSE OF WHAT THIS
  # VALUE IS USED FOR. It is tested for emptiness and nothing else, and a line that matched
  # `CITATION_RE` carries a filename and a digit, so no amount of NUL-stripping can empty it. That is
  # the whole argument — it is not that the bytes survive, it is that they cannot flip this test. A
  # check that passes the BYTES through `$(...)` rather than a count is killed by the same stripping, so
  # a reader who sees bash's warning here should be able to find out in one place why this instance is
  # not that bug.
  hits=$(citation_lines "$f")
  [ -n "$hits" ] || continue

  n=$(honoured_in "$f")
  honoured=$((honoured + n))

  while IFS= read -r hit; do
    # The location is printed in the editors' and compilers' `path:line:` form, which is exactly the
    # shape this gate bans in a file — and the distinction is §4.2's, not an inconsistency. A pointer
    # written into a tracked file has to stay true; a line of terminal output is an observation of one
    # run against one tree, and it is never a tracked file.
    # **THE `Dockerfile` ALTERNATIVE'S GUARD IS CONSUMING, SO `-o` HANDS BACK THE CHARACTER BEFORE THE
    # CITATION AS WELL.** Unstripped, this would print `cites =dockerfile:<tag>` and
    # `cites  dockerfile:<tag>` — misreporting what was found, in the message whose whole job is to name
    # it (placeholder tags again, since literal ones would trip the scan). The class is exactly one
    # character and always one of the guard's own exclusion set, so one `sed` removes it; for every
    # other alternative the match already starts on a citation character and the strip is a no-op.
    tokens=$(printf '%s\n' "$hit" | { LC_ALL=C grep -a -oEi "$CITATION_RE" || true; } \
      | LC_ALL=C sed -E 's|^[^/A-Za-z0-9_.-]||' | tr '\n' ' ')
    printf 'error: %s:%s: cites %sby line number — name the symbol instead\n' \
      "$f" "${hit%%:*}" "$tokens" >&2
    bad=1
  done < <(violations_in "$f")
done < <(git ls-files -z)

# A SCAN OF NOTHING MUST NOT PASS. Run from a tree where `git ls-files` returns nothing — a bad `cd`, a
# fresh worktree, a submodule — every check above is vacuous and the gate reports success.
if [ "$scanned" -eq 0 ]; then
  echo "error: scanned 0 files — this is an empty scan reporting success, not a clean tree" >&2
  exit 1
fi

# **EVERY TRACKED PATH LANDS IN EXACTLY ONE OF THE THREE, AND THAT IS CHECKED AGAINST `git ls-files` RATHER
# THAN RESTATED FROM THE THREE.** A file that goes missing between them shows up as a total that no longer
# adds. `skipped` ships at 0 — this repo has no submodules and no dangling symlinks — and the reported total
# is `git ls-files`' number, not the scan's.
total=$(tracked_total)
reconcile "$scanned" "$excluded" "$skipped" "$total"
tally=$(printf '%s out of scope, binary or recording, %s skipped — %s tracked paths in all' \
  "$excluded" "$skipped" "$total")

if [ "$bad" -ne 0 ]; then
  cat >&2 <<'MSG'

A `file:line` citation is a POINTER, and it stops being true the moment anything is inserted above the
target — including by the commit that writes the citation.

Cite the SYMBOL instead. It survives every edit that does not rename it, and a rename is a `grep` the
compiler will usually run for you:

    banned    see desugar.rs:<line> for the binding
    instead   see `desugar.rs`'s `lower_stmts_at`, in its `Stmt::Let` arm

Where the sentence already names the symbol, the file basename alone is enough. Where the old
coordinate is worth keeping as a record of the drift, write it in prose (`desugar.rs` line <line>) —
a dated observation about the past is not a pointer, which is also why `docs/` is out of scope here.

If a line genuinely must carry a coordinate — a stack-trace assertion, a source-map fixture — end it
with `check-citations: allow`. Every run counts those out loud.
MSG
  # **"EVERY RUN" HAS TO INCLUDE THIS ONE, AND THAT IS §4.5'S DISTINCTION RATHER THAN A FORMATTING
  # CHOICE.** Printed only on the success path, the count would let a commit adding a violation AND a
  # marker slip the marker past unannounced: the failing run would exit 1 without it, and it would first
  # show on the run after the violation is fixed — exactly when nobody is looking for it. A marker
  # nobody is told about is the allowlist §4.5 rejected.
  printf '%s escape-hatch marker(s) honoured on this run; %s files scanned (%s).\n' \
    "$honoured" "$scanned" "$tally" >&2
  exit 1
fi

printf 'no file:line citations in tracked source: %s files scanned, 0 violations, %s escape-hatch marker(s) honoured (%s)\n' \
  "$scanned" "$honoured" "$tally"
