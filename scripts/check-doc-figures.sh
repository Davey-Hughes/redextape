#!/usr/bin/env bash
# Hold the READMEs' numeric claims to the tree they describe.
#
# CI invokes this same script (.forgejo/workflows/ci.yml) and so does the pre-commit hook
# (.pre-commit-config.yaml), so the local and CI gates cannot drift — the convention
# `scripts/check-all.sh` already states, and the siblings `scripts/check-citations.sh` and
# `scripts/check-text-bytes.sh` already follow.
#
#   scripts/check-doc-figures.sh              # check every claim in the table below
#   scripts/check-doc-figures.sh --self-test  # prove the locators still locate
#
# **WHY THIS GATE EXISTS — MEASUREMENT, NOT PRINCIPLE.** One commit in the tree-sitter slice
# replaced `extras`'s `/\s/` with the five code points `is_ascii_whitespace()` accepts. That added
# one comment line to two `grammar.js` files, and the λ README — which had asserted *"75 lines —
# half the sibling's 156"* — became wrong in both halves of one sentence. Nothing failed. It was
# found only because a third README was being written and happened to need the same two numbers for
# a comparison. Had that PR not existed, the claim would still be there.
#
# **THE ROOT README EARNED ITS ROWS BY BEING WRONG IN FOUR PLACES AT ONCE.**
# The three grammar READMEs came first. The root README was added after a survey found it claiming
# "Four crates" against seven, "841 tests" against 1,156, "six pre-commit hooks" against seven, and
# "15 browser tests" against 26. **One of those was falsified by the very branch that introduced this
# script** — adding `check-doc-figures` made the hook count seven — so the gate's own arrival broke a
# figure in the one file it did not yet cover. Its repo-level rows (`.` as the scope) describe the
# workspace rather than a grammar, and every one is a structural grep that compiles nothing.
#
# **HOW MANY DOCUMENTS THIS TABLE COVERS IS DELIBERATELY NOT STATED HERE.** This header used to open
# by counting them, and that count went stale the moment a fourth grammar README got rows — the same
# failure the gate exists to stop, one level up, in the gate's own file. `scripts/check-all.sh`
# removed its own count for the same reason rather than bumping it. Read the table.
#
# **THE CROSS-REFERENCES ARE WHY THIS IS WORTH A GATE RATHER THAN A HABIT.** These READMEs quote
# each other: λ's cites the mini-language's line count AND its capture-name count, and TM's and
# asm's each cite the mini-language's line count and λ's. So editing ONE `grammar.js` can falsify
# several READMEs at once, and only one of them is the one the editor has any reason to open. The
# cross-reference rows below — the ones whose grammar-dir column is not their own README's — are the
# ones nobody is looking at. No count of them is given here, for the reason above.
#
# **A FIGURE ASSERTED TWICE IS TWO ROWS, BECAUSE IT DRIFTS TWICE.** The λ README states its
# capture-name count in three separate sentences — *"entire capture vocabulary is five names"*,
# *"holds nine patterns over five capture names"*, *"with five capture names and no
# `@function.call`"* — and the TM README states its own twice. Whoever updates the paragraph they
# are editing has no reason to suspect the other two. Each assertion gets its own row.
#
# **A CLAIM THAT CANNOT BE LOCATED IS A FAILURE, NOT A SKIP.** This is the whole design. The
# obvious construction — scan the prose for number-shaped things and check the ones found — passes
# when a rewording moves a figure out from under its pattern, which is the exact defect it exists
# to catch, reproduced inside the gate. So the table below is a REQUIRED set: every row must match
# EXACTLY once. Zero matches fails as loudly as a wrong number, and so do two or more, because an
# ambiguous locator may be reading a different sentence than the one intended. That is not
# hypothetical either: the first draft of the cross-reference rows matched `mini-language's lexer`
# and `λ's 912` — a different figure entirely, sharing only the possessive — and the ambiguity rule
# is what turned that into an error message instead of a wrong number checked against the wrong
# sentence. The cross-reference locators are anchored on their whole clause for that reason.
#
# **THIS SCAN IS NOT LINE-BASED, AND THAT DEPARTS FROM `check-citations.sh` DELIBERATELY.** That
# script documents the line wrap as its own blind spot — grep is line-based, so a citation split
# across a wrap is invisible to it. The TM README splits a claim across a wrap TODAY: it reads
# `**13 patterns** over **11` / `capture names**`. A line-based locator finds zero matches for the
# capture-name claim — and under the rule above that is a failure rather than a silent pass, which
# is how this construction catches an error in its own implementation. Each README is normalized to
# a single line before matching, so a reflow is invisible here by design.
#
# **NUMBERS ARE SPELLED THREE WAYS AND ALL THREE ARE ACCEPTED.** The λ README writes *"nine
# patterns over five capture names"* where the TM README writes *"13 patterns over 11 capture
# names"* — and TM also opens a sentence with *"Eleven capture names for nine classes"*, capitalised.
# A digit-only locator finds nothing in the λ README and, without the required-set rule, would have
# reported that whole file clean while checking none of it.
#
# **WHAT IT DELIBERATELY DOES NOT CATCH.**
#
#   1. THE ADJECTIVE BESIDE THE NUMBER. TM's README says *"nearly twice λ's 78"*. This gate checks
#      that 78 is λ's current line count; it cannot check "nearly twice". If λ's grammar doubled,
#      the gate would demand the 78 be corrected and then pass on prose calling the new figure
#      "nearly twice" its own. Anchoring the locator on the clause means EDITING the adjective
#      trips the gate, which is a tripwire, not a check — the relation itself stays a review
#      concern. So does "largest of the three", which was wrong for a whole PR and is not a number.
#   2. `docs/` — SPECS, PLANS AND THE ROADMAP — WHICH IS A BOUNDARY RATHER THAN AN EXEMPTION, and
#      the same one `check-citations.sh` draws for the same reason. A README says what the tree IS;
#      a dated roadmap entry says what the tree WAS on a date, and its figures are OBSERVATIONS.
#      One entry records `156 grammar.js lines`; that file is 171 today and the entry is still
#      correct. Gating it would demand falsifying the record. The roadmap's own convention — a
#      block headed "Every count this entry quotes, with what produces it" — is how those are held
#      honest, at the time they are written, which is the only time they can be.
#   3. HISTORICAL FIGURES INSIDE A README. The mini README reads `is 171 lines (156 until PR 3 …)`
#      and the λ README says its figures `read 75 and 156 before that`. Those are observations
#      sitting in a present-tense document, and every locator below is anchored to exclude them.
#      `--self-test` asserts that exclusion rather than trusting it.
#   4. FIGURES THAT ARE NOT CHEAPLY DERIVABLE. The TM README's `18,905 bytes` and `6,865 spans`
#      averages, its `282,006 spans in 0.74 s`, and the `32`/`256` proptest case counts are
#      measurements or config, not properties a one-line command recovers. λ's *"Five positions,
#      five patterns"* is a claim about where `_atom` and `_term` appear in the grammar, not a
#      total, and is not derivable either. None are gated.
#   5. THE WORKSPACE'S TEST COUNT, AND ANYTHING ELSE THAT NEEDS A BUILD. `cargo nextest list
#      --workspace` costs 218 s warm; this whole script costs ~150 ms. Gating that figure would make
#      every commit in this repository unusable, and putting it in CI alone would break the one
#      invariant both sibling gates rest on — the same script in both places, so local and CI cannot
#      drift. **The root README states it as a DATED OBSERVATION instead**, which is the same move
#      `docs/` gets and for the same reason: a figure nothing can cheaply check should carry a date
#      rather than a present tense. It had drifted by 315 tests and lost three crates from its
#      breakdown before anyone noticed. A gate that cannot be cheap should not exist; a claim that
#      cannot be gated should not be written in the present tense.
#   6. A FIGURE WITH NO ROW HERE. Adding a claim to a README does not add it to this table. The
#      gate covers what it lists and reports that count on success, rather than implying the prose
#      is checked. Deleting a claimed figure, by contrast, fails loudly.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

readonly G_MINI="grammars/tree-sitter-redextape"
readonly G_LAM="grammars/tree-sitter-redextape-lambda"
readonly G_TM="grammars/tree-sitter-redextape-tm"
readonly G_ASM="grammars/tree-sitter-redextape-asm"

# ---------------------------------------------------------------------------
# THE ONE DERIVATION IMPLEMENTATION. The scan and `--self-test` both call this, so the self-test
# exercises the real thing rather than a paraphrase of it that could drift into agreeing with a
# broken scan — the shape `check-text-bytes.sh` uses for the same reason.
# ---------------------------------------------------------------------------

# The `CAPTURE_CLASSES` table for a grammar lives in the checker crate, one module per grammar.
map_src() {
  case "$1" in
    "$G_MINI") echo "crates/redextape-grammar-check/src/mini.rs" ;;
    "$G_LAM")  echo "crates/redextape-grammar-check/src/lambda.rs" ;;
    "$G_TM")   echo "crates/redextape-grammar-check/src/tm.rs" ;;
    "$G_ASM")  echo "crates/redextape-grammar-check/src/asm.rs" ;;
    *) echo "check-doc-figures: no capture-map module for $1" >&2; return 1 ;;
  esac
}

map_rows_raw() { awk '/pub const CAPTURE_CLASSES/,/^\];/' "$(map_src "$1")" | grep '^    ("'; }

# derive <grammar-dir> <key> -> the true value, as a bare integer.
derive() {
  local dir="$1" key="$2" n
  case "$key" in
    grammar_js_lines) n=$(wc -l < "$dir/grammar.js") ;;
    parser_c_bytes)   n=$(wc -c < "$dir/src/parser.c") ;;
    # A "pattern" here is ONE CAPTURE OCCURRENCE, which is the sense both the READMEs and the
    # checker's totality tests use. Counted with `grep -o`, not `grep -c`: `-c` counts matching
    # LINES, so two captures on one line would read as one. That is true of none of the three files
    # today, which is exactly why it would go unnoticed if it started being false.
    # The `-v '^;'` matters: prose comments in these files name captures, and without it the
    # mini-language reads 14 patterns instead of 12.
    query_patterns)   n=$(grep -v '^;' "$dir/queries/highlights.scm" | grep -oE '@[a-z._]+' | wc -l) ;;
    capture_names)    n=$(grep -v '^;' "$dir/queries/highlights.scm" | grep -oE '@[a-z._]+' | sort -u | wc -l) ;;
    map_rows)         n=$(map_rows_raw "$dir" | wc -l) ;;
    # Distinct `TokenClass` values the rows project onto — fewer than the rows wherever two capture
    # names deliberately share a class.
    map_classes)      n=$(map_rows_raw "$dir" | sed -E 's/.*,[[:space:]]*(TokenClass::[A-Za-z]+).*/\1/' | sort -u | wc -l) ;;
    # Each `tree-sitter test` case is fenced by TWO `===` rules, so the count is half the rules.
    corpus_cases)     n=$(( $(cat "$dir"/test/corpus/* | grep -c '^===*$') / 2 )) ;;
    # REPO-LEVEL KEYS. These ignore `$dir` (passed as `.`) and describe the workspace rather than a
    # grammar. All three are structural greps — the reason they are gateable at all is that none
    # compiles anything. The workspace's TEST COUNT is deliberately absent: `cargo nextest list
    # --workspace` costs 218 s warm against this whole script's ~150 ms, so the root README states
    # that figure as a dated observation instead. A gate that cannot be cheap should not exist.
    workspace_crates)   n=$(find crates -mindepth 1 -maxdepth 1 -type d | wc -l) ;;
    grammar_count)      n=$(find grammars -mindepth 1 -maxdepth 1 -type d | wc -l) ;;
    precommit_hooks)    n=$(grep -c '^      - id: ' .pre-commit-config.yaml) ;;
    wasm_browser_tests) n=$(grep -c '#\[wasm_bindgen_test\]' crates/redextape-wasm/tests/browser.rs) ;;
    *) echo "check-doc-figures: unknown key '$key'" >&2; return 1 ;;
  esac
  echo "$((n))"
}

# The command a reader can run to reproduce a derivation, printed on failure so the error names its
# own fix rather than only its own unhappiness.
derive_cmd() {
  local dir="$1" key="$2" src
  # Guarded: a REPO-LEVEL scope (`.`) has no capture-map module, and `map_src` returns non-zero for
  # it. Unguarded under `set -e` that aborts the whole run while merely composing an error message.
  src="$(map_src "$dir" 2>/dev/null || echo '<no capture-map module>')"
  case "$key" in
    grammar_js_lines) echo "wc -l < $dir/grammar.js" ;;
    parser_c_bytes)   echo "wc -c < $dir/src/parser.c" ;;
    query_patterns)   echo "grep -v '^;' $dir/queries/highlights.scm | grep -oE '@[a-z._]+' | wc -l" ;;
    capture_names)    echo "grep -v '^;' $dir/queries/highlights.scm | grep -oE '@[a-z._]+' | sort -u | wc -l" ;;
    map_rows)         echo "awk '/pub const CAPTURE_CLASSES/,/^\\];/' $src | grep -c '^    (\"'" ;;
    map_classes)      echo "awk '/pub const CAPTURE_CLASSES/,/^\\];/' $src | grep '^    (\"' | sed -E 's/.*,[[:space:]]*(TokenClass::[A-Za-z]+).*/\\1/' | sort -u | wc -l" ;;
    corpus_cases)     echo "cat $dir/test/corpus/* | grep -c '^===*\$'  # halved" ;;
    workspace_crates)   echo "find crates -mindepth 1 -maxdepth 1 -type d | wc -l" ;;
    grammar_count)      echo "find grammars -mindepth 1 -maxdepth 1 -type d | wc -l" ;;
    precommit_hooks)    echo "grep -c '^      - id: ' .pre-commit-config.yaml" ;;
    wasm_browser_tests) echo "grep -c '#\[wasm_bindgen_test\]' crates/redextape-wasm/tests/browser.rs" ;;
  esac
}

# ---------------------------------------------------------------------------
# Claim location
# ---------------------------------------------------------------------------

# Number words appear in the λ README where the others use digits, and one TM sentence opens with a
# capitalised one. Input is lowercased before lookup. Anything unrecognised falls through with
# commas stripped, so `42,220` becomes 42220 and a non-numeric match stays non-numeric and fails the
# comparison loudly rather than silently reading as zero.
to_number() {
  local w="${1,,}"
  case "$w" in
    zero) echo 0 ;;  one) echo 1 ;;   two) echo 2 ;;    three) echo 3 ;;  four) echo 4 ;;
    five) echo 5 ;;  six) echo 6 ;;   seven) echo 7 ;;  eight) echo 8 ;;  nine) echo 9 ;;
    ten) echo 10 ;;  eleven) echo 11 ;; twelve) echo 12 ;; thirteen) echo 13 ;;
    fourteen) echo 14 ;; fifteen) echo 15 ;; sixteen) echo 16 ;; seventeen) echo 17 ;;
    eighteen) echo 18 ;; nineteen) echo 19 ;; twenty) echo 20 ;;
    *) echo "${1//,/}" ;;
  esac
}

# A README as one line, so a claim that wraps is matched the same as one that does not.
normalize() { tr '\n' ' ' < "$1" | tr -s ' '; }

# find_claim <normalized-text> <regex> -> the claimed value; the empty string if the regex does not
# match at all; `AMBIGUOUS:<n>` if it matches more than once.
find_claim() {
  local text="$1" re="$2" hits n raw
  hits=$(printf '%s' "$text" | grep -oE "$re" || true)
  [ -z "$hits" ] && return 0
  n=$(printf '%s\n' "$hits" | wc -l)
  [ "$n" -ne 1 ] && { echo "AMBIGUOUS:$n"; return 0; }
  # Re-match the single hit to pull the captured value out of it.
  [[ "$hits" =~ $re ]] || return 0
  raw="${BASH_REMATCH[1]}"
  to_number "$raw"
}

# ---------------------------------------------------------------------------
# THE REQUIRED SET. Every row must match exactly once. Columns:
#   readme | grammar-dir the claim is ABOUT | key | description | locator regex
# The grammar-dir column is not always the README's own: a cross-reference is a claim in one README
# about ANOTHER grammar, and those are the rows nobody is looking at when they edit.
# ---------------------------------------------------------------------------
claims() {
  cat <<'ROWS'
README.md|.|workspace_crates|workspace crates under crates/|([0-9,]+|[A-Za-z]+) crates under
README.md|.|precommit_hooks|pre-commit hooks (1 of 2: "There are N")|There are \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} pre-commit hooks
README.md|.|precommit_hooks|pre-commit hooks (2 of 2: "All N are fast enough")|All \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} are fast enough
README.md|.|wasm_browser_tests|wasm browser tests|has \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} browser tests
grammars/tree-sitter-redextape/README.md|grammars/tree-sitter-redextape|grammar_js_lines|mini grammar.js lines|`grammar\.js` is \*{0,2}([0-9,]+|[A-Za-z]+) lines
grammars/tree-sitter-redextape-lambda/README.md|grammars/tree-sitter-redextape-lambda|grammar_js_lines|lambda grammar.js lines|`grammar\.js` is \*{0,2}([0-9,]+|[A-Za-z]+) lines
grammars/tree-sitter-redextape-lambda/README.md|grammars/tree-sitter-redextape|grammar_js_lines|mini grammar.js lines (CROSS-REF from lambda)|under half the mini-language's \*{0,2}([0-9,]+|[A-Za-z]+)
grammars/tree-sitter-redextape-lambda/README.md|grammars/tree-sitter-redextape-lambda|query_patterns|lambda query patterns|highlights\.scm` holds \*{0,2}([0-9,]+|[A-Za-z]+) patterns
grammars/tree-sitter-redextape-lambda/README.md|grammars/tree-sitter-redextape-lambda|capture_names|lambda capture names (1 of 3: "over N capture names")|over \*{0,2}([0-9,]+|[A-Za-z]+) capture names
grammars/tree-sitter-redextape-lambda/README.md|grammars/tree-sitter-redextape-lambda|capture_names|lambda capture names (2 of 3: "capture vocabulary is N names")|capture vocabulary is \*{0,2}([0-9,]+|[A-Za-z]+) names
grammars/tree-sitter-redextape-lambda/README.md|grammars/tree-sitter-redextape-lambda|capture_names|lambda capture names (3 of 3: "with N capture names")|with \*{0,2}([0-9,]+|[A-Za-z]+) capture names
grammars/tree-sitter-redextape-lambda/README.md|grammars/tree-sitter-redextape|capture_names|mini capture names (CROSS-REF from lambda)|against the mini-language's \*{0,2}([0-9,]+|[A-Za-z]+)
grammars/tree-sitter-redextape-lambda/README.md|grammars/tree-sitter-redextape-lambda|map_classes|lambda distinct capture classes|project onto \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} `TokenClass`
grammars/tree-sitter-redextape-lambda/README.md|grammars/tree-sitter-redextape-lambda|map_rows|lambda CAPTURE_CLASSES rows|CAPTURE_CLASSES` has \*{0,2}([0-9,]+|[A-Za-z]+) rows
grammars/tree-sitter-redextape-lambda/README.md|.|grammar_count|grammar count (1 of 2: "All N are installed from the same clone")|All \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} are installed from the same clone
grammars/tree-sitter-redextape-lambda/README.md|.|grammar_count|grammar count (2 of 2: "N grammars, one clone")|\*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} grammars, one clone
grammars/tree-sitter-redextape-tm/README.md|grammars/tree-sitter-redextape-tm|grammar_js_lines|tm grammar.js lines|`grammar\.js` is \*{0,2}([0-9,]+|[A-Za-z]+) lines
grammars/tree-sitter-redextape-tm/README.md|grammars/tree-sitter-redextape|grammar_js_lines|mini grammar.js lines (CROSS-REF from tm)|close to the mini-language's \*{0,2}([0-9,]+|[A-Za-z]+)
grammars/tree-sitter-redextape-tm/README.md|grammars/tree-sitter-redextape-lambda|grammar_js_lines|lambda grammar.js lines (CROSS-REF from tm)|nearly twice λ's \*{0,2}([0-9,]+|[A-Za-z]+)
grammars/tree-sitter-redextape-tm/README.md|grammars/tree-sitter-redextape-tm|query_patterns|tm query patterns|highlights\.scm` holds \*{0,2}([0-9,]+|[A-Za-z]+) patterns
grammars/tree-sitter-redextape-tm/README.md|grammars/tree-sitter-redextape-tm|capture_names|tm capture names (1 of 2: "over N capture names")|over \*{0,2}([0-9,]+|[A-Za-z]+) capture names
grammars/tree-sitter-redextape-tm/README.md|grammars/tree-sitter-redextape-tm|capture_names|tm capture names (2 of 2: "N capture names for M classes")|\*{0,2}([0-9,]+|[A-Za-z]+) capture names for
grammars/tree-sitter-redextape-tm/README.md|grammars/tree-sitter-redextape-tm|map_classes|tm distinct capture classes|capture names for \*{0,2}([0-9,]+|[A-Za-z]+) classes
grammars/tree-sitter-redextape-tm/README.md|grammars/tree-sitter-redextape-tm|map_rows|tm CAPTURE_CLASSES rows|CAPTURE_CLASSES` has \*{0,2}([0-9,]+|[A-Za-z]+) rows
grammars/tree-sitter-redextape-tm/README.md|grammars/tree-sitter-redextape-tm|parser_c_bytes|tm parser.c bytes|`src/parser\.c` is \*{0,2}([0-9,]+|[A-Za-z]+) bytes
grammars/tree-sitter-redextape-tm/README.md|grammars/tree-sitter-redextape-tm|corpus_cases|tm tree-sitter test cases|`test/corpus/` holds \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} `tree-sitter test` cases
grammars/tree-sitter-redextape-tm/README.md|.|grammar_count|grammar count (1 of 3: "One of N grammars in this repository")|One of \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} grammars in this repository
grammars/tree-sitter-redextape-tm/README.md|.|grammar_count|grammar count (2 of 3: "All N install from the same clone")|All \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} install from the same clone
grammars/tree-sitter-redextape-tm/README.md|.|grammar_count|grammar count (3 of 3: "now with N grammars in one clone")|now with \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} grammars in one clone
grammars/tree-sitter-redextape-asm/README.md|grammars/tree-sitter-redextape-asm|grammar_js_lines|asm grammar.js lines|`grammar\.js` is \*{0,2}([0-9,]+|[A-Za-z]+) lines
grammars/tree-sitter-redextape-asm/README.md|grammars/tree-sitter-redextape|grammar_js_lines|mini grammar.js lines (CROSS-REF from asm)|under the mini-language's \*{0,2}([0-9,]+|[A-Za-z]+)
grammars/tree-sitter-redextape-asm/README.md|grammars/tree-sitter-redextape-lambda|grammar_js_lines|lambda grammar.js lines (CROSS-REF from asm)|over twice λ's \*{0,2}([0-9,]+|[A-Za-z]+)
grammars/tree-sitter-redextape-asm/README.md|grammars/tree-sitter-redextape-asm|query_patterns|asm query patterns|highlights\.scm` holds \*{0,2}([0-9,]+|[A-Za-z]+) patterns
grammars/tree-sitter-redextape-asm/README.md|grammars/tree-sitter-redextape-asm|capture_names|asm capture names|over \*{0,2}([0-9,]+|[A-Za-z]+) capture names
grammars/tree-sitter-redextape-asm/README.md|grammars/tree-sitter-redextape-asm|map_rows|asm CAPTURE_CLASSES rows|CAPTURE_CLASSES` has \*{0,2}([0-9,]+|[A-Za-z]+) rows
grammars/tree-sitter-redextape-asm/README.md|grammars/tree-sitter-redextape-asm|map_classes|asm distinct capture classes|onto \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} distinct `TokenClass`
grammars/tree-sitter-redextape-asm/README.md|grammars/tree-sitter-redextape-asm|parser_c_bytes|asm parser.c bytes|`src/parser\.c` is \*{0,2}([0-9,]+|[A-Za-z]+) bytes
grammars/tree-sitter-redextape-asm/README.md|grammars/tree-sitter-redextape-asm|corpus_cases|asm tree-sitter test cases|`test/corpus/` holds \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} `tree-sitter test` cases
grammars/tree-sitter-redextape-asm/README.md|.|grammar_count|grammar count (1 of 4: "One of N grammars in this repository")|One of \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} grammars in this repository
grammars/tree-sitter-redextape-asm/README.md|.|grammar_count|grammar count (2 of 4: "across all N grammars in this repository")|across all \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} grammars in this repository
grammars/tree-sitter-redextape-asm/README.md|.|grammar_count|grammar count (3 of 4: "All N install from the same clone")|All \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} install from the same clone
grammars/tree-sitter-redextape-asm/README.md|.|grammar_count|grammar count (4 of 4: "now with N grammars in one clone")|now with \*{0,2}([0-9,]+|[A-Za-z]+)\*{0,2} grammars in one clone
ROWS
}

# ---------------------------------------------------------------------------
# The scan
# ---------------------------------------------------------------------------
scan() {
  local failures=0 checked=0 last_readme="" text="" readme dir key desc re claimed derived
  while IFS='|' read -r readme dir key desc re; do
    [ -z "${readme:-}" ] && continue
    if [ "$readme" != "$last_readme" ]; then
      if [ ! -f "$readme" ]; then
        echo "error: $readme does not exist." >&2
        failures=$((failures + 1))
        continue
      fi
      text="$(normalize "$readme")"
      last_readme="$readme"
    fi
    claimed="$(find_claim "$text" "$re")"
    derived="$(derive "$dir" "$key")"
    checked=$((checked + 1))

    if [ -z "$claimed" ]; then
      echo "error: $readme — the claim for '$desc' was NOT FOUND." >&2
      echo "  locator: $re" >&2
      echo "  a figure that cannot be located is a failure, not a skip. If the prose was reworded," >&2
      echo "  update the locator in scripts/check-doc-figures.sh; if the claim was deleted, delete" >&2
      echo "  its row. Leaving it unfound would silently stop checking it." >&2
      failures=$((failures + 1))
    elif [[ "$claimed" == AMBIGUOUS:* ]]; then
      echo "error: $readme — the locator for '$desc' matched ${claimed#AMBIGUOUS:} times." >&2
      echo "  locator: $re" >&2
      echo "  an ambiguous locator may be reading a different sentence than the one intended." >&2
      echo "  anchor it on more of its clause." >&2
      failures=$((failures + 1))
    elif [ "$claimed" != "$derived" ]; then
      echo "error: $readme — '$desc' claims $claimed, the tree says $derived." >&2
      echo "  derived by: $(derive_cmd "$dir" "$key")" >&2
      failures=$((failures + 1))
    fi
  done < <(claims)

  if [ "$failures" -gt 0 ]; then
    echo "" >&2
    echo "$failures of $checked documented figures do not match the tree." >&2
    return 1
  fi
  echo "check-doc-figures: $checked documented figures match the tree."
}

# ---------------------------------------------------------------------------
# --self-test: prove the locators still locate, and still refuse what they must refuse.
# ---------------------------------------------------------------------------
self_test() {
  local fails=0
  check() { # check <label> <expected> <actual>
    if [ "$2" = "$3" ]; then
      echo "  ok   $1"
    else
      echo "  FAIL $1 — expected '$2', got '$3'" >&2
      fails=$((fails + 1))
    fi
  }

  local lines_re='`grammar\.js` is \*{0,2}([0-9,]+|[A-Za-z]+) lines'
  local pat_re='highlights\.scm` holds \*{0,2}([0-9,]+|[A-Za-z]+) patterns'
  local cap_re='over \*{0,2}([0-9,]+|[A-Za-z]+) capture names'
  local cls_re='capture names for \*{0,2}([0-9,]+|[A-Za-z]+) classes'
  local xref_re="under half the mini-language's \\*{0,2}([0-9,]+|[A-Za-z]+)"

  echo "detector:"
  check "digits are read" 147 \
    "$(find_claim '`grammar.js` is **147 lines** — close to' "$lines_re")"
  check "number WORDS are read (the lambda README spells them)" 9 \
    "$(find_claim '`queries/highlights.scm` holds **nine patterns** over' "$pat_re")"
  check "a CAPITALISED number word is read (TM opens a sentence with one)" 9 \
    "$(find_claim '**Eleven capture names for nine classes**, and both' "$cls_re")"
  check "commas are stripped" 42220 \
    "$(find_claim '`src/parser.c` is **42,220 bytes** at ABI 15' '`src/parser\.c` is \*{0,2}([0-9,]+|[A-Za-z]+) bytes')"
  check "a claim WRAPPED across lines is found (the TM README wraps this one)" 11 \
    "$(find_claim "$(printf 'holds **13 patterns** over **11\ncapture names**, and' | tr '\n' ' ')" "$cap_re")"
  check "a cross-reference is read" 171 \
    "$(find_claim "under half the mini-language's 171, which is" "$xref_re")"

  echo "refusals:"
  check "a MISSING claim returns empty, so the scan fails rather than skipping" "" \
    "$(find_claim 'the grammar covers statements and expressions' "$lines_re")"
  check "a REWORDED claim returns empty rather than passing" "" \
    "$(find_claim 'the grammar file runs to 147 lines' "$lines_re")"
  check "an AMBIGUOUS locator is refused, not silently first-match" "AMBIGUOUS:2" \
    "$(find_claim '`grammar.js` is 171 lines and `grammar.js` is 78 lines' "$lines_re")"
  # The loose cross-reference locator this script shipped with in draft, and the prose that caught
  # it: `mini-language's (...)` matched four different clauses in the λ README.
  check "an UNANCHORED cross-reference is refused rather than reading the wrong clause" "AMBIGUOUS:2" \
    "$(find_claim "the mini-language's lexer and the mini-language's 171 lines" "mini-language's \\*{0,2}([0-9,]+|[A-Za-z]+)")"
  # The two historical figures that live inside present-tense READMEs today.
  check "the mini README's historical '156 until PR 3' is NOT captured" 171 \
    "$(find_claim '`grammar.js` is 171 lines (156 until PR 3 replaced extras)' "$lines_re")"
  check "the lambda README's historical 'read 75 and 156 before that' is NOT captured" 78 \
    "$(find_claim '`grammar.js` is **78 lines** — under half. (they read 75 and 156 before that.)' "$lines_re")"

  echo "derivation reaches the real tree:"
  local k v
  for k in grammar_js_lines parser_c_bytes query_patterns capture_names map_rows map_classes corpus_cases; do
    v="$(derive "$G_TM" "$k")"
    if [ "$v" -gt 0 ] 2>/dev/null; then
      echo "  ok   derive($k) = $v"
    else
      echo "  FAIL derive($k) returned '$v'" >&2; fails=$((fails + 1))
    fi
  done

  echo ""
  if [ "$fails" -gt 0 ]; then
    echo "self-test: $fails assertion(s) failed — the detector is broken." >&2
    return 1
  fi
  echo "self-test: all assertions passed."
}

case "${1:-}" in
  --self-test) self_test ;;
  "") scan ;;
  *) echo "usage: $0 [--self-test]" >&2; exit 2 ;;
esac
