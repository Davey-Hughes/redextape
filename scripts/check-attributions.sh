#!/usr/bin/env bash
# Reject symbol citations that name the wrong file. Cite the file the symbol is IN.
#
# CI invokes this same script (.forgejo/workflows/ci.yml) and so does the pre-commit hook
# (.pre-commit-config.yaml), so the local and CI gates cannot drift — the convention
# `scripts/check-all.sh` already states, and the siblings `scripts/check-citations.sh` and
# `scripts/check-text-bytes.sh` already follow. This script is those siblings' shape on purpose.
#
#   scripts/check-attributions.sh              # scan the tracked tree
#   scripts/check-attributions.sh --self-test  # prove the detector still detects
#
# **WHY THIS GATE EXISTS, AND WHY IT IS `check-citations.sh`'s SUCCESSOR RATHER THAN ITS NEIGHBOUR.**
# That gate rejects `file:line` because line numbers rot, and the convention it enforces is CITE THE
# SYMBOL. This gate closes the rot that convention has of its own: **the symbol survives a move and the
# filename does not.** Split a god-module and every citation naming it keeps naming it. The symbol is
# still real, still spelled right, still findable by grep — so nothing looks broken, and no review of
# the extraction diff can see it, because the citing files are not in that diff.
#
# **MEASURED BY THIS GATE, AND THE SPLIT BETWEEN THE TIERS IS THE FINDING.** Run over the tracked tree
# at the branch point that added it, it found **492** attribution sites — **339** under `web/`, **150**
# under `crates/`, **3** under `grammars/` — and flagged **31**. Twenty-six were real drift and **every
# one of them was under `web/`**. `crates/` produced two flags and neither is drift: both deliberately
# name something no file holds in code, and both carry the marker below. That is a fact about history,
# not about languages. Rust's modules were split along
# boundaries that existed before the code did; `main.ts` was a god-module that PR #37 and its
# successors carved into `transport.ts`, `link-wiring.ts`, `compile.ts`, `panes.ts` and
# `buffer-list.ts`, and every citation written before the carve kept pointing at the file the symbol
# left. **The tier that never extracted never drifted**, which is why this gate covers both tiers
# rather than the one that was dirty: it is armed for the next extraction, wherever that happens.
#
# **THREE BLIND SPOTS, EACH OF WHICH SHIPPED GREEN IN A DRAFT OF THIS SCANNER BEFORE IT WAS FOUND.**
# They are here rather than in the plan because a reader of the gate is who needs them:
#
#   1. **A PRESENCE TEST THAT DOES NOT STRIP COMMENTS PASSES ON ANY FILE THAT MERELY MENTIONS THE
#      SYMBOL.** The first draft asked "does `forward` appear in `main.ts`" and got yes — from a
#      comment in `main.ts` about the handler that had moved out of it. A file that TALKS about a
#      symbol does not own it. `strip_code` below is the whole answer, and it is the same door
#      `check-citations.sh` had to close three times in its own scan.
#   2. **A RUST `'` IS A LIFETIME FAR MORE OFTEN THAN A CHAR LITERAL.** Blanking from `'` to the next
#      `'` deletes real code between two lifetime annotations, which turns present symbols into absent
#      ones: the draft reported `impl Drop for Core` missing from its own file. The stripper treats `'`
#      as a literal ONLY when a complete char literal follows, and as code otherwise.
#   3. **A SYMBOL WRITTEN `sym()` DOES NOT MATCH A PATTERN THAT STOPS AT WORD CHARACTERS.** This is not
#      hypothetical: it is how the seventh of the seven sites this sweep was filed to fix escaped the
#      first scan that was supposed to find all seven.
#
# **WHAT IT DELIBERATELY DOES NOT CATCH.** A doc quoted verbatim and attributed to the wrong file —
# `` see its doc in `<file>`: "…" `` — which this sweep found twice and fixed by hand. Two sites is not
# a corpus, and matching prose quotes needs fuzziness whose false-positive rate would be unmeasured.
# Neither does it catch an attribution split across a line wrap, for the reason `check-citations.sh`
# gives for the same gap: grep is line-based and so is every rule below. And it cannot see a symbol
# reached through a re-export — a citation naming the barrel file rather than the defining one reads
# clean here, because the symbol genuinely appears in the barrel's code.
set -euo pipefail

# The attribution form: a backticked filename with a source extension, a possessive, and a backticked
# symbol. The symbol alternation admits `()`, `.`, `::` and `#` because all four appear in the tree's
# real citations — `play()`, `lambdaPane.setEditor`, `Encoding::heap_word_len`, `#editor`.
readonly ATTRIBUTION_RE='`[A-Za-z0-9_./-]+\.(rs|ts|tsx|js|css|html)`('"'"'|’)s +`[A-Za-z0-9_$.:#()]+`'

# THE ESCAPE HATCH, counted out loud for the reason `check-citations.sh` states: a marker sits on the
# line it excuses and is visible in review, where a config file collects exemptions nobody meets.
#
# **IT SHIPS AT FIVE, AND EACH ONE'S ARGUMENT IS HERE RATHER THAN LEFT TO BE INFERRED.** Three are
# citations of a thing that deliberately IS NOT in any file's code, which is a different act from
# citing the wrong file: a guard in `lower.rs` that was measured, falsified and reverted; a wire term
# in `protocol.ts` that would exist only if a `serde(skip)`ped field were restored; and `panes.ts`'s
# note on what its `PaneCollection` REPLACED, which is a statement about a file that no longer holds
# the symbol and is worthless if rewritten to name one that does. The other two cite a discriminated-
# union tag — the `compiled` reply — which lives in `protocol.ts` as a quoted string, and `strip_code`
# blanks string literals ON PURPOSE, because the blindness it buys back (blind sub-case 1 above) costs
# more than two markers. **These five are the measured false-positive rate of the strict rule: 5 in
# 490, ~1%.**
#
# This script is also scanned by its own scan, so an illustrative attribution in the header would fail
# the gate it documents — the trap `check-citations.sh` fell into and now warns about. Every example
# above is therefore written without a possessive, and the only complete attributions this file
# contains are assembled at runtime inside `--self-test` and never written to a tracked path.
readonly ALLOW_RE='check-attributions: allow[[:space:]]*$'

readonly BINARY_RE='\.(png|jpg|jpeg|gif|ico|webp|pdf|wasm|woff2?|ttf|otf|zip|gz|tar|bin|snap|lock)$'
readonly RECORDING_RE='\.(stdout|stderr)$'
# `docs/` is a scope boundary, not an exemption — a roadmap entry is an observation about a tree that
# may no longer exist, and `check-citations.sh` draws the same line for the same reason.
readonly SCOPE_RE='^docs/'
readonly SOURCE_RE='\.(rs|ts|tsx|js|css|html)$'

# True when $1 is a path this gate does not read.
excluded_path() {
  local f="$1"
  [[ $f =~ $SCOPE_RE ]] || [[ ${f,,} =~ $BINARY_RE ]] || [[ ${f,,} =~ $RECORDING_RE ]]
}

# Blank every comment and string literal in $1, preserving line structure, so a symbol found in what
# remains is found in CODE. `$2` is `rust` or `ts`; the two differ in three places and the awk below
# names each. THE ONE STRIPPING IMPLEMENTATION — the scan and `--self-test` both reach it here.
strip_code() {
  LC_ALL=C awk -v lang="$2" '
    function isq(ch) { return ch == "\"" || (lang == "ts" && (ch == "'"'"'" || ch == "`")) }
    BEGIN { st = "code"; depth = 0 }
    {
      out = ""
      i = 1
      n = length($0)
      while (i <= n) {
        c = substr($0, i, 1)
        two = substr($0, i, 2)
        if (st == "block") {
          # Rust block comments nest; TypeScript ones do not, so only `rust` counts depth up.
          if (lang == "rust" && two == "/*") { depth++; out = out "  "; i += 2; continue }
          if (two == "*/") { depth--; out = out "  "; i += 2; if (depth <= 0) st = "code"; continue }
          out = out " "; i++; continue
        }
        if (st == "str") {
          if (c == "\\") { out = out "  "; i += 2; continue }
          if (c == q) { st = "code"; out = out " "; i++; continue }
          out = out " "; i++; continue
        }
        if (st == "raw") {
          if (substr($0, i, length(rawclose)) == rawclose) {
            st = "code"; out = out sprintf("%*s", length(rawclose), ""); i += length(rawclose); continue
          }
          out = out " "; i++; continue
        }
        if (two == "//") { out = out sprintf("%*s", n - i + 1, ""); break }
        if (two == "/*") { st = "block"; depth = 1; out = out "  "; i += 2; continue }
        # A Rust raw string: r"..." or r#"..."#, closed by a quote and the same run of hashes.
        if (lang == "rust" && c == "r" && match(substr($0, i), /^r#*"/)) {
          hashes = RLENGTH - 2
          rawclose = "\""
          for (h = 0; h < hashes; h++) rawclose = rawclose "#"
          st = "raw"; out = out sprintf("%*s", RLENGTH, ""); i += RLENGTH; continue
        }
        # A Rust `'"'"'` opens a literal ONLY when a complete char literal follows. Every other one is a
        # LIFETIME, which is code — blanking through it deletes the code between two annotations.
        if (lang == "rust" && c == "'"'"'") {
          if (match(substr($0, i), /^'"'"'(\\.|[^'"'"'\\])'"'"'/)) {
            out = out sprintf("%*s", RLENGTH, ""); i += RLENGTH; continue
          }
          out = out c; i++; continue
        }
        if (isq(c)) { st = "str"; q = c; out = out " "; i++; continue }
        out = out c; i++
      }
      print out
    }
  ' "$1"
}

# The language tag `strip_code` takes, from a path.
lang_of() { [[ $1 == *.rs ]] && echo rust || echo ts; }

# Resolve a cited filename against the tracked tree, NEAREST-FIRST from the citing file: a citation
# carrying a path prefix matches by path suffix; a bare basename prefers the citing file's own
# directory, then its own crate or package, then the whole tree.
#
# **WITHOUT THE NEAREST-FIRST RULE THIS GATE IS UNUSABLE ON THIS REPO, WHICH IS WHY IT IS HERE RATHER
# THAN IN A TODO.** A first draft resolved by basename alone and reported 17 Rust sites unresolvable —
# `lib.rs`, `syntax.rs`, `asm.rs` and `decode.rs` each name several files in a workspace of eight
# members. Every one of those 17 resolved to exactly one file once the citing file's own crate was
# preferred, and all 17 were clean. An unresolvable citation is reported, not silently skipped.
declare -A RESOLVE_CACHE=()
RESOLVED=''

resolve_cited() {
  local named="$1" from="$2" dir crate matches key
  case "$from" in
    crates/*) crate="$(cut -d/ -f1,2 <<<"$from")" ;;
    web/*) crate="web" ;;
    *) crate="${from%%/*}" ;;
  esac
  dir="${from%/*}"
  key="$named|$dir|$crate"
  if [[ -z ${RESOLVE_CACHE[$key]+set} ]]; then
    RESOLVE_CACHE[$key]="$(resolve_uncached "$named" "$dir" "$crate")"
  fi
  # Sets a global rather than printing, for `symbol_in_code`'s reason: a command substitution at the
  # call site is a fork per SITE even when the answer is already cached.
  RESOLVED="${RESOLVE_CACHE[$key]}"
}

# The resolution itself, split out so `resolve_cited` can memoize it. `TRACKED_TEXT` is the tracked
# list as one string, built once — rebuilding it per site cost more than every other part of the scan
# put together.
resolve_uncached() {
  local named="$1" dir="$2" crate="$3" matches
  matches="$(grep -E "(^|/)${named//./\\.}$" <<<"$TRACKED_TEXT" || true)"
  [[ -z $matches ]] && return 0
  if [[ $(wc -l <<<"$matches") -eq 1 ]]; then printf '%s\n' "$matches"; return 0; fi
  local same_dir
  same_dir="$(grep -E "^${dir}/[^/]+$" <<<"$matches" || true)"
  if [[ -n $same_dir && $(wc -l <<<"$same_dir") -eq 1 ]]; then printf '%s\n' "$same_dir"; return 0; fi
  local same_crate
  same_crate="$(grep -E "^${crate}/" <<<"$matches" || true)"
  if [[ -n $same_crate && $(wc -l <<<"$same_crate") -eq 1 ]]; then printf '%s\n' "$same_crate"; return 0; fi
  printf '%s\n' "$matches"
}

# The symbol is matched on its LAST path segment — a cited `a.b` asks about `b` — because a citation
# names where to look, and the receiver in front of the dot is prose about the route rather than the
# thing being cited.
declare -A STRIP_CACHE=()

# $1's code with comments and string literals blanked, computed once per file.
#
# **THE CACHE IS ALSO WHAT KEEPS `grep` OFF THE END OF A PIPE, AND THAT IS NOT A CONVENIENCE.** The
# first version of this function was `strip_code ... | grep -qwF`, and it reported 467 violations over
# 492 sites on a tree with 26. `grep -q` exits at the FIRST match, `awk` upstream dies of SIGPIPE, and
# `set -o pipefail` — three characters in this file's own `set` line — reports the pipeline as failed.
# So every site whose symbol WAS present failed exactly like a site whose symbol was absent, and the
# gate was at its reddest precisely where the tree was cleanest. A gate can be wrong in the loud
# direction too, and a 95% violation rate is the shape that says the instrument is broken rather than
# the tree.
stripped_of() {
  local file="$1"
  if [[ -z ${STRIP_CACHE[$file]+set} ]]; then
    STRIP_CACHE[$file]="$(strip_code "$file" "$(lang_of "$file")")"
  fi
}

# True when $2 (a symbol) appears in $1's CODE.
symbol_in_code() {
  local file="$1" symbol="$2" bare
  bare="${symbol%\(\)}"
  bare="${bare##*[.:]}"
  bare="${bare#\#}"
  # A symbol that is not an identifier is not something this gate can resolve; pass it rather than
  # invent a verdict about it.
  if [[ -z $bare || ! $bare =~ ^[A-Za-z_] ]]; then
    return 0
  fi
  stripped_of "$file"
  # A bash word test rather than a `grep`, and the difference is the whole runtime. Stripping every
  # cited file costs ~180 ms; the first version then spent SEVEN SECONDS asking whether the symbol was
  # in the result, because `grep <<<"$(stripped_of …)"` forks a subshell and copies a whole file's text
  # through a pipe once PER SITE, 486 times. Measured, because the guess was wrong in both directions:
  # the pre-commit comment for this hook first claimed 3.6-3.9 s from no measurement at all, the real
  # figure was 7.5 s, and the fix that brought it down was not the one the profile was expected to name.
  [[ ${STRIP_CACHE[$file]} =~ (^|[^A-Za-z0-9_])"$bare"([^A-Za-z0-9_]|$) ]]
}

# Every attribution-shaped line of $1, as `<lineno>:<match>`. **THE ONE DETECTION IMPLEMENTATION** —
# the scan, the escape-hatch count and `--self-test` all reach the tree through this and nothing else.
#
# The byte handling is `check-citations.sh`'s, verbatim and for its reasons: `-a` so a stray high byte
# cannot make grep print nothing and exit 0 over a file it decided was binary, `LC_ALL=C` so that is
# byte-exact rather than locale-dependent, and the path passed to grep rather than redirected in so a
# file that cannot be opened arrives as grep's exit 2 instead of bash's exit 1.
attributions_in() {
  local rc=0 out
  out="$(LC_ALL=C grep -anoE "$ATTRIBUTION_RE" -- "$1")" || rc=$?
  if ((rc > 1)); then
    printf 'check-attributions: cannot read %s (grep exit %d)\n' "$1" "$rc" >&2
    exit 2
  fi
  [[ -n $out ]] && printf '%s\n' "$out"
  return 0
}

PARSED_FILE=''
PARSED_SYMBOL=''

# Split a matched attribution into `PARSED_FILE` and `PARSED_SYMBOL`.
#
# **IT SETS GLOBALS RATHER THAN PRINTING, AND THAT IS WHAT KEEPS THE SELF-TEST HONEST.** A printing
# version costs a fork per SITE, so an earlier draft inlined the parse into the scan loop for speed and
# left this function reachable only from `--self-test` — two implementations of one idea, with the
# tested one no longer the one that runs. The gate's whole subject is a claim that stops matching what
# it describes, so shipping that would have been the defect it exists to catch, in the file that
# catches it.
parse_attribution() {
  local m="$1"
  PARSED_FILE="${m#\`}"
  PARSED_FILE="${PARSED_FILE%%\`*}"
  PARSED_SYMBOL="${m%\`}"
  PARSED_SYMBOL="${PARSED_SYMBOL##*\`}"
}

declare -A LINE_CACHE=()

scan() {
  local violations=0 allowed=0 sites=0 f line_and_match lineno match named symbol candidates hit numbered
  for f in "${TRACKED[@]}"; do
    excluded_path "$f" && continue
    [[ ${f,,} =~ $SOURCE_RE ]] || continue
    [[ -f $f ]] || continue
    # The full text of every attribution-bearing line, read in ONE pass so the escape-hatch check does
    # not cost a `sed` per site. `attributions_in` yields the matches; this yields the lines they sit on.
    LINE_CACHE=()
    while IFS= read -r numbered; do
      [[ -z $numbered ]] && continue
      LINE_CACHE["$f:${numbered%%:*}"]="${numbered#*:}"
    done < <(LC_ALL=C grep -anE "$ATTRIBUTION_RE" -- "$f" || true)
    while IFS= read -r line_and_match; do
      [[ -z $line_and_match ]] && continue
      lineno="${line_and_match%%:*}"
      match="${line_and_match#*:}"
      if [[ ${LINE_CACHE[$f:$lineno]:-} =~ $ALLOW_RE ]]; then
        allowed=$((allowed + 1))
        continue
      fi
      sites=$((sites + 1))
      parse_attribution "$match"
      named="$PARSED_FILE"
      symbol="$PARSED_SYMBOL"
      resolve_cited "$named" "$f"
      candidates="$RESOLVED"
      if [[ -z $candidates ]]; then
        printf '%s:%s: cites `%s`, which is not a tracked file\n' "$f" "$lineno" "$named"
        violations=$((violations + 1))
        continue
      fi
      # An ambiguous citation passes when the symbol is in ANY candidate's code: the citation is
      # satisfiable, and picking between two `lib.rs` files is not this gate's job. It fails only when
      # no candidate holds it, which is the drift this gate exists for.
      hit=0
      while IFS= read -r candidate; do
        [[ -z $candidate ]] && continue
        excluded_path "$candidate" && continue
        [[ -f $candidate ]] || continue
        if symbol_in_code "$candidate" "$symbol"; then hit=1; break; fi
      done <<<"$candidates"
      if ((hit == 0)); then
        printf '%s:%s: cites `%s` for `%s`, which is not in that file'"'"'s code\n' \
          "$f" "$lineno" "$named" "$symbol"
        violations=$((violations + 1))
      fi
    done < <(attributions_in "$f")
    unset 'LINE_CACHE[@]'
  done
  printf '\nchecked %d attribution sites, %d excused by marker, %d violations\n' \
    "$sites" "$allowed" "$violations"
  if ((violations > 0)); then
    cat >&2 <<'MSG'

A symbol citation must name the file the symbol is IN. When code moves, the citation does not follow
it, and the symbol staying real is what makes the wrong filename invisible. Fix by re-resolving the
symbol, not by deleting the citation — and if the reference is deliberately historical ("what replaces
<file>'s <symbol>"), rewrite it so it does not read as a pointer to live code.
MSG
    return 1
  fi
  return 0
}

self_test() {
  local tmp rc out
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp:?}"' RETURN
  local q='`'

  # A TypeScript target that DEFINES the symbol, and one that only TALKS about it. The pair is the
  # whole point: blind sub-case 1 above is a scanner that cannot tell them apart.
  printf 'export const forward = () => {}\n' >"$tmp/owner.ts"
  printf '// The forward handler used to live here.\nexport const other = 1\n' >"$tmp/talker.ts"
  # A Rust target whose symbol sits between two lifetime annotations — blind sub-case 2.
  printf 'pub struct Holder<%sa> { pub inner: &%sa str }\nimpl Drop for Holder<%s_> { fn drop(&mut self) {} }\n' \
    "'" "'" "'" >"$tmp/core.rs"
  # A Rust target whose only mention of the symbol is inside a raw string.
  printf 'pub fn render() -> &%sstatic str { r#"needle lives only here"# }\n' "'" >"$tmp/raw.rs"

  local good bad_moved bad_parens bad_raw
  good="// see ${q}owner.ts${q}'s ${q}forward${q} for the handler"
  bad_moved="// see ${q}talker.ts${q}'s ${q}forward${q} for the handler"
  bad_parens="// see ${q}talker.ts${q}'s ${q}forward()${q} for the handler"
  bad_raw="// see ${q}raw.rs${q}'s ${q}needle${q} for the text"

  local checks=0 failures=0
  assert_site() {
    local label="$1" content="$2" target="$3" expect="$4"
    printf '%s\n' "$content" >"$tmp/$target"
    checks=$((checks + 1))
    if LC_ALL=C grep -qaoE "$ATTRIBUTION_RE" -- "$tmp/$target"; then
      local m named symbol cand found=0
      m="$(LC_ALL=C grep -aoE "$ATTRIBUTION_RE" -- "$tmp/$target" | head -1)"
      parse_attribution "$m"
      named="$PARSED_FILE"
      symbol="$PARSED_SYMBOL"
      cand="$tmp/${named}"
      if [[ -f $cand ]] && symbol_in_code "$cand" "$symbol"; then found=1; fi
      if [[ $found -eq $expect ]]; then
        printf '  ok    %s\n' "$label"
      else
        printf '  FAIL  %s (symbol found=%d, expected %d)\n' "$label" "$found" "$expect" >&2
        failures=$((failures + 1))
      fi
    else
      printf '  FAIL  %s (the detector did not match an attribution at all)\n' "$label" >&2
      failures=$((failures + 1))
    fi
  }

  printf 'check-attributions --self-test\n'
  assert_site 'a citation naming the defining file passes' "$good" 'citer.ts' 1
  assert_site 'a symbol present only in a comment is NOT ownership' "$bad_moved" 'citer.ts' 0
  assert_site 'the sym() form is matched, not skipped' "$bad_parens" 'citer.ts' 0
  assert_site 'a symbol present only in a Rust raw string is NOT ownership' "$bad_raw" 'citer.ts' 0

  # Blind sub-case 2, asserted on the stripper directly: the lifetimes must not swallow `Drop`.
  checks=$((checks + 1))
  if symbol_in_code "$tmp/core.rs" 'Drop'; then
    printf '  ok    a Rust symbol between two lifetime annotations survives stripping\n'
  else
    printf '  FAIL  a Rust lifetime blanked real code\n' >&2
    failures=$((failures + 1))
  fi

  printf '%d checks, %d failures\n' "$checks" "$failures"
  ((failures == 0))
}

mapfile -t TRACKED < <(git ls-files)
readonly TRACKED
# The tracked list as one string. Built ONCE: rebuilding it per site, which the first version did,
# cost more than every other part of the scan put together.
TRACKED_TEXT="$(printf '%s\n' "${TRACKED[@]}")"
readonly TRACKED_TEXT

if [[ ${1:-} == --self-test ]]; then
  self_test
else
  scan
fi
