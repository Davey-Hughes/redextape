#!/usr/bin/env bash
# Reject symbol citations that name the wrong file. Cite the file that DECLARES the symbol.
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
# **THE FINDING THAT SHAPED THE DECLARATION RULE BELOW, MEASURED ONCE ON THIS BRANCH BEFORE ITS TEN
# DRIFTED CITATIONS WERE REPOINTED — AND THE SPLIT READ 28/10 UNTIL ONE OF THE 28 TURNED OUT NEVER TO
# HAVE BEEN CORRECT AT ALL.** A declaration test flagged 38 of 499 attribution sites on that tree,
# sites the presence rule above passed at 0 violations, and **27 of the 38 were correct citations**:
# the possessive was being used for a `match` arm (10), a call or other expression (10), an impl of a
# foreign trait (3), a fixture (2), a statement inside a file's own header (1), and a quotation of a
# wrong citation kept as an illustration (1). **11 were not** — 10 real drift, plus one counted among
# the calls that should never have been: `config_cli.rs` named an
# `opts.field_width.unwrap_or(...)` expression in `emit.rs` that has never existed in any source file
# in this repository, only in a plan document. Rewording it to name an act deleted the attribution
# site and left the claim false, which is why the count moved at a later review rather than at the
# measurement: **a taxonomy of correct-versus-drifted can only be as good as the reading of each
# sentence, and rewording a sentence does not read it.** The convention this gate enforces from that
# count: **a possessive claims the declaration; every other act on a symbol is named, not possessed.**
#
# **THE TWO DISCRIMINATORS THAT DO NOT WORK, BECAUSE BOTH ARE THE OBVIOUS DESIGN.** Symbol *shape*
# cannot split declaration from use: `pane-host.ts`'s `paneEvents.rebind` is declared in the cited
# file and `run.rs`'s `form.is_artifact()` is only called there, and the two citations have the same
# shape. A following role noun (`the handler`, `the constant`) gets roughly 70%: it misses a citation
# that carries none, and it accepts `types.ts`'s `Owner` doc, which is drift.
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
# **A FOURTH, FOUND WHILE AUDITING THE DECLARATION RULE ITSELF RATHER THAN SHIPPED INTO A DRAFT OF
# IT: THE GATE CONFIRMS A FILE DECLARES A SYMBOL, AND SAYS NOTHING ABOUT WHICH DECLARATION.**
# `pane-chrome.ts` declares `update` seven times — once per factory function it exports — and a
# citation naming any of the seven passes identically.
#
# **WHAT IT DELIBERATELY DOES NOT CATCH.** A doc quoted verbatim and attributed to the wrong file —
# `` see its doc in `<file>`: "…" `` — which this sweep found twice and fixed by hand. Two sites is not
# a corpus, and matching prose quotes needs fuzziness whose false-positive rate would be unmeasured.
# Neither does it catch an attribution split across a line wrap, for the reason `check-citations.sh`
# gives for the same gap: grep is line-based and so is every rule below.
#
# **THAT WRAP GAP IS NOW DEMONSTRATED RATHER THAN ARGUED, AND WHAT DEMONSTRATED IT WAS A REFLOW NOBODY
# INTENDED AS A TEST.** `buffers-quota.test.ts` carried *"called at `` `reduce.rs`'s `reduce_step_go` ``"*
# with the filename ending one comment line and the symbol opening the next, so no `grep` line held
# both and the site did not exist as far as this gate was concerned. Rewrapping the surrounding
# paragraph joined them, and the very next run counted one more attribution site — the new one
# passing, because `reduce.rs` does declare `reduce_step_go`. So the hole is symmetrical and cheap to
# fall into in both directions: **reflowing a paragraph can put a citation under this gate or take it
# out from under it, and neither shows up as a diff to any citation.**
#
# **THAT CITATION IS JOINED NOW, AND THE ARGUMENT FOR KEEPING IT SPLIT HAD THE PROTECTION BACKWARDS.**
# The wrap was first restored so the site count would keep matching the arithmetic that explained it.
# But nothing guards that count — no gate reads it, and any commit adding or removing a citation
# anywhere in the tracked tree moves it — while the wrap itself WAS load-bearing: biome never reflows
# a comment, so one hand-placed line break was all that held the split, and the next prose edit to
# that paragraph would have moved the count with no diff to any citation. Keeping the split protected
# a number nothing protects by preserving the very hole this paragraph describes. The hole is
# untouched and still real; its one live instance was a correct citation hidden from the gate.
#
# **THE COUNT LANDS BACK ON 471, WHICH IS A COINCIDENCE TO RECORD RATHER THAN A SIGN NOTHING MOVED.**
# 499 at the branch point; minus 27 rewordings that deleted a site; minus 1 that became a marker;
# minus 1 more for the `.step` citation in `app.test.ts`, reworded once routing TypeScript bindings
# through `local:` showed it had only ever passed on a local `const`; plus 1 for this wrap-split
# citation, joined: **499 − 27 − 1 − 1 + 1 = 471**. Two changes moving the count by one in opposite
# directions leave a figure that reads as untouched — one more reason the figure is not a guard.
#
# **THE RE-EXPORT GAP THIS LIST USED TO NAME HERE IS CLOSED, NOT OPEN.** An import line and an
# `export ... from` line now declare nothing, so a citation naming the barrel file rather than the
# defining one fails here instead of reading clean on the symbol's mere presence in the barrel's
# code. Four of this branch's ten repointed citations were exactly that case.
#
# **THE GUARANTEE IS BOUNDED, AND THE HOLES BELOW ARE ITS EDGE.** `0 violations` is a verdict on the
# citations the tree holds today. The holes mean a FUTURE citation of their shapes can pass without
# being right, and they are written down rather than patched because each one is the line shape of a
# real declaration that live sites rest on. None was load-bearing when the last of them was written
# down, and that was checked rather than assumed: the tree then held 24 passing sites whose symbol is
# path-qualified, and for 23 of them every line in the cited file that emits the name PLAIN — the only
# emissions a qualified citation can use — was read, and every one is a real field, method, enum
# variant or type member, never a reassignment, parameter, key, label or match arm. The 24th,
# `events(...)`, never reaches the extractor, because its last segment is not an identifier.
#
# **A FAMILY OF LINE-BASED HOLES A PER-LINE EXTRACTOR CANNOT CLOSE.** A Rust `use` whose import list
# wraps puts the bare names on CONTINUATION lines, so `crates/redextape-grammar-check/tests/asm.rs`
# reads as declaring `CORPUS` — a name sitting alone on a wrapped line — when
# `crates/redextape-grammar-check/src/asm.rs` is the file that actually declares it. A Rust struct
# LITERAL at statement position (`Program {`) is indistinguishable from a struct-variant declaration,
# so `crates/redextape-native/src/jit.rs` reads as declaring `Program`, which `tm/asm.rs` declares — NOT
# `ast.rs`, which this sentence used to name: `jit.rs` imports `redextape_core::tm::Program` at its top
# and again in its test module, and `crates/redextape-core/src/ast.rs` declares a different, surface
# `Program` of the same name. A
# Rust TUPLE-variant match arm in that same file — `Ok(subs) => subs,` — is indistinguishable from a
# tuple-variant declaration and emits `Ok`; only the bare `Other => {}` shape, where `=>` could be
# misread as an assignment's `=`, was closed. A config-object key whose value is an imported symbol —
# `foo({ bar: thing })`, written so `bar:` opens its own line — is the same ambiguity in TypeScript:
# it matches the property rule that 63 live sites below rest on alone, and there is no cheaper test
# that tells the two apart. A fifth member of the family — a wrapped TypeScript CALL whose parameter
# list spilled onto the next line, read as a multi-line signature — WAS closed, by deleting that
# branch, at no cost to any passing site.
#
# **THREE MORE MEMBERS OF THAT FAMILY, EACH VERIFIED BY CONSTRUCTION RATHER THAN INFERRED FROM THE
# REGEXES.** A Rust struct LITERAL's field lines read as field declarations, which is the Rust twin of
# the config-object-key hole above: `crates/redextape-native/src/jit.rs` builds
# `Program { code: vec![..], labels: vec![], .. }`, so it reads as declaring `code` and `labels`, which
# `crates/redextape-core/src/tm/asm.rs` declares. Qualification does not help here — `Program::code`
# really is a member, so the field rule has to keep satisfying it. An `if let Some(v)` or `if let Ok(w)`
# makes a file declare `Some` or `Ok`, and **89 of the 165** tracked `.rs` files do; that one is
# NARROWED rather than open, because the `let` rule emits behind `local:`, so only a BARE citation can
# rest on the `if let` line — a qualified `Option::Some` cannot rest on THAT line, and can rest on a
# match arm, as the next paragraph shows. And a TypeScript plain RE-ASSIGNMENT reads as a
# declaration: `counter = counter + 1` matches the property rule, which cannot tell it from a key in an
# object literal, and **145** lines of the stripped tracked `.ts`/`.tsx` code have that shape.
#
# **THE `local:` TAG NARROWS WHICH RULE CAN SATISFY A QUALIFIED CITATION, NOT WHICH NAME, SO ANY OTHER
# RULE EMITTING THE SAME NAME PLAIN REOPENS IT.** Three such paths, each verified by construction
# against `symbol_declared_in`:
#
#   1. **A REASSIGNED BINDING.** `let timer` goes in behind the tag and `timer = setTimeout(...)` goes
#      in plain, so `web/src/compile.ts`, which emits `timer` from those two lines and no others,
#      satisfies `LegState.timer` — a member `sessions.ts` declares. Under `web/`, **99** name-and-file
#      pairs across **53** files carry both a `local:` name and the same name from a reassignment line,
#      and 4 more pairs carry it from a comparison opening a continuation line,
#      `frame === null || program === null`, whose first `=` the property rule reads the same way.
#   2. **A TYPESCRIPT PARAMETER ON ITS OWN LINE** (`button: HTMLButtonElement,`), **A DEFAULT PARAMETER**
#      (`width = 3,`), **A DESTRUCTURED KEY** (`warm: isWarm,`) **AND A LABEL** (`outer:`) all match the
#      property rule and go in plain. So `web/src/buffer-list.ts` satisfies a qualified `Session.button`,
#      through the first parameter of `bufferList`.
#   3. **A RUST TUPLE-VARIANT MATCH ARM.** `Some(y) =>` goes in plain through the UpperCamel variant
#      rule, so a qualified `Option::Some` passes on a file holding one, and **77 of the 165** tracked
#      `.rs` files emit a plain `Some`.
#
# The first two are the line shapes of an interface member, a class field and an object-literal key,
# which the 63 sites resting on the property rule alone need it to keep reading; the third is the shape
# of a tuple variant. No test on one line tells them apart.
#
# **DECLARATION FORMS THE EXTRACTOR MISSES. EACH WOULD REDDEN A CORRECT CITATION RATHER THAN LET A
# WRONG ONE THROUGH, AND THE HEADING HERE USED TO CLAIM ALL OF THEM WERE AT ZERO OCCURRENCES, WHICH WAS
# WRONG TWICE.** Three are at zero and re-measured: a destructured binding
# (`export const { compile, parse } = ...`), a Rust enum whose variants share the enum's own line, and a
# Rust field behind an inline attribute — the tree's one instance of that last shape sits inside a raw
# string in `ts_derive_scan.rs`, so the stripper blanks it and no name escapes. The two that were wrong:
#
#   1. **A TYPESCRIPT SIGNATURE WHOSE RETURN TYPE ITSELF CONTAINS BRACES WAS MISSED TWICE, NOT ONCE,
#      AND THE SECOND INSTANCE IS WHY THE MISS IS NOW CLOSED RATHER THAN DOCUMENTED.** Re-measured by
#      collecting every stripped line of the tracked `.ts`/`.tsx`/`.js` files that has a brace after a
#      `)` and `:` once a trailing body brace or semicolon is set aside — **53 lines**, not all of them
#      signatures — and running each through `declare_names` alone:
#      **15 yielded no name**, of which **9** are continuation lines of a wrapped signature whose
#      keyword sits on the opening line (all 9 names are reached there, checked one by one), **4** are
#      not declarations at all (two inline arrow callbacks, one `as` type assertion, one
#      `new Worker(...)` argument), and **2** are real declarations the extractor lost:
#      `scratch.ts`'s `editorSeed` and `pane-host.ts`'s `scratchSeedOf`, both returning
#      `{ text: string; collapsed: boolean } | null`. The earlier count of 37-and-one came from a
#      narrower collection and from stopping at the first miss found.
#
#      **THE SECOND MISS IS NOT MERELY A FALSE NEGATIVE: IT BECOMES A FALSE POSITIVE AT A DELEGATING
#      CALL SITE, AND IN THE WORST POSSIBLE FILE.** `pane-host.ts` declares `scratchSeedOf` as a member
#      of its own deps type and `main.ts` supplies it as an object-literal property —
#      `scratchSeedOf: (session) => scratchpad.editorSeed(session)` — which the property rule reads as
#      a declaration. So while the miss stood, a citation naming `main.ts`, the carved god-module this
#      gate's whole story is about, PASSED for `scratchSeedOf` while the file declaring the member
#      FAILED. The reassurance that "a cited declaration this extractor misses IS a violation" holds
#      only when no other file happens to emit the same name; where one does, the extractor silently
#      preferred the delegating call site over the declaration — the gate's own filed archetype,
#      produced by the gate. That asymmetry is what made closing it worth a widened regex: see the
#      comment on the signature rule for the widening and the declaration-set diff that priced it.
#   2. **AN `export function` WITH A DEFAULT PARAMETER VALUE IS NOT MISSED AT ALL**, and the claim is
#      retired rather than recounted: the keyword rule reads the `function` and never looks inside the
#      parameter list. `export function withDefault(a = 1) {` yields `withDefault`. Every
#      default-parameter signature line in the tracked tree yields its name — 15 of 15 by the same
#      per-line method, of which 14 are real default parameters and the fifteenth is a
#      `[data-leaf="..."]` selector the grep mistook for one.
set -euo pipefail

# The attribution form: a backticked filename with a source extension, a possessive, and a backticked
# symbol. The symbol alternation admits `()`, `.`, `::` and `#` because all four appear in the tree's
# real citations — `play()`, `lambdaPane.setEditor`, `Encoding::heap_word_len`, `#editor`.
readonly ATTRIBUTION_RE='`[A-Za-z0-9_./-]+\.(rs|ts|tsx|js|css|html)`('"'"'|’)s +`[A-Za-z0-9_$.:#()]+`'

# THE ESCAPE HATCH, counted out loud for the reason `check-citations.sh` states: a marker sits on the
# line it excuses and is visible in review, where a config file collects exemptions nobody meets.
#
# **IT SHIPS AT SIX, AND EACH ONE'S ARGUMENT IS HERE RATHER THAN LEFT TO BE INFERRED.** Three are
# citations of a thing that deliberately IS NOT in any file's code, which is a different act from
# citing the wrong file: a guard in `lower.rs` that was measured, falsified and reverted; a wire term
# in `protocol.ts` that would exist only if a `serde(skip)`ped field were restored; and `panes.ts`'s
# note on what its `PaneCollection` REPLACED, which is a statement about a file that no longer holds
# the symbol and is worthless if rewritten to name one that does. Two more cite a discriminated-union
# tag — the `compiled` reply — which lives in `protocol.ts` as a quoted string, and `strip_code` blanks
# string literals ON PURPOSE, because the blindness it buys back (blind sub-case 1 above) costs more
# than two markers. **The sixth is not a live claim at all: `buffers-quota.test.ts` QUOTES the wrong
# citation this sweep fixed — `` `replies.ts`'s `LambdaPane.setEditor` `` — as the illustration of its
# own mistake, and the quote has to stay wrong to illustrate it.** These six are the measured
# false-positive rate of the declaration rule: 6 in 477, ~1%.
#
# This script is NOT scanned by its own scan, and the claim that it was is retired rather than kept.
# `SOURCE_RE` below is `\.(rs|ts|tsx|js|css|html)$` and this script is `.sh`; planting a wrong citation
# in this very header and running the gate left the count and verdict unchanged — still 471 sites, 6
# excused, 0 violations. The claim was inherited from `check-citations.sh`, where it IS true, because
# that gate has no `SOURCE_RE` and scans all tracked text. The no-possessive discipline below is kept
# anyway, now as a choice rather than a requirement it never actually had: `ci.yml`, `Cargo.toml`,
# `README.md`, a `.gitignore`, a comment in each of the two tree-sitter query files and
# `check-citations.sh`'s own header carry seven attribution sites this gate cannot read, and none of
# them is drifted today — which is why the scope stays as it is rather than widening to cover them.
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
  LC_ALL=C awk -v lang="$2" -v emit="${3:-code}" '
    function isq(ch) { return ch == "\"" || (lang == "ts" && (ch == "'"'"'" || ch == "`")) }
    function put(n) { if (n != "" && n ~ /^[A-Za-z_$]/) print n }
    # A name that is a BINDING rather than a member of a type, emitted into the same set behind a
    # `local:` tag that `symbol_declared_in` accepts only for an UNQUALIFIED citation. The tag cannot
    # collide with anything `put` emits: `put` only prints names starting `[A-Za-z_$]`, and no
    # identifier contains a colon.
    function put_local(n) { if (n != "" && n ~ /^[A-Za-z_$]/) print "local:" n }
    # Every name LINE declares. LINE is already stripped, so a name found here is found in CODE.
    #
    # **gawk HAS NO `\b`** — it is a backspace — so every boundary is written out, the same reason the
    # scan below writes `(^|[^A-Za-z0-9_])`. And **gawk cannot take a regex CONSTANT as a function
    # parameter**: it yields a boolean, silently, with only a warning. So every `sub` here is written
    # out rather than factored into a helper, which a first draft did and which reported 155 of 499
    # sites declared instead of 460. A regex constant also cannot be CONTINUED across lines, which is
    # why five `match` calls below run past 120 columns — wrapping one means converting its regex
    # to the string form no other rule here uses. Those five are the only lines in this file over 120.
    function declare_names(line,    s, head, j, parens, after) {
      # A line that strips to whitespace can declare nothing, so the battery below never runs on one.
      # 49.1% of the lines across the files this gate resolves as candidates strip to whitespace
      # (31,318 of 63,800 across 108 files), because comment density across this tree runs that high.
      # Measured by logging every path declarations_of resolves during a full scan, then running
      # strip_code on each logged file and counting output lines matching /^[ \t]*$/ against total
      # lines.
      #
      # **TIMED INTERLEAVED, BECAUSE THE TWO EARLIER FIVE-RUN PAIRS FOR THIS ONE COMPARISON READ AS A
      # SINGLE MEASUREMENT CONTRADICTING ITSELF.** They were two pairs taken at different commits --
      # 4,098-4,118 ms here, 4,099-4,118 ms in the hook comment and the roadmap entry -- and a range
      # that names neither its tree nor its run count invites exactly that misreading. Re-measured on
      # this tree, 10 rounds, one sample of each variant per round in rotating order, one untimed
      # warm-up each, "bash scripts/check-attributions.sh" with no --self-test: with this guard,
      # 2,845-2,887 ms, mean 2,865; with the guard line commented out, 4,180-4,242 ms, mean 4,217. So
      # removing it makes the same scan 47% slower, and the verdict is identical either way -- 471
      # sites, 6 excused, 0 violations -- which is what makes the guard pure saving.
      if (line ~ /^[ \t]*$/) return
      if (lang == "rust") {
        # A Rust `use` needs no bail of its own: no rule below fires on a single-line `use`, since
        # every rule in this branch is anchored on a keyword or on an UpperCamel or identifier at
        # the start of the line, and `use`/`pub use` match neither. TypeScript is different -- its
        # keyword declare rule reaches `type Owner` even inside `export { type Owner } from ...`,
        # which is why THAT bail earns its keep and this one does not. A `use` bail was tried here,
        # for symmetry with the TypeScript one, then measured and removed: across five single-line
        # `use` forms it changed the verdict on exactly one, a `use` sharing its line with a
        # declaration (`use crate::x::Y; pub fn after() {}`), where it swallowed the declaration.
        # Zero measured benefit, one lost declaration. A wrapped `use`, whose names sit on
        # CONTINUATION lines a per-line extractor cannot reach, stays an open blind spot either way.
        if (match(line, /(^|[^A-Za-z0-9_])fn[ \t]+[A-Za-z_][A-Za-z0-9_]*/)) {
          s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_]?fn[ \t]+/, "", s); put(s)
        }
        if (match(line, /(^|[^A-Za-z0-9_])(struct|enum|trait|union|type|const|static|mod)[ \t]+[A-Za-z_][A-Za-z0-9_]*/)) {
          s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_]?[a-z]+[ \t]+/, "", s); put(s)
        }
        if (match(line, /(^|[^A-Za-z0-9_])macro_rules![ \t]*[A-Za-z_][A-Za-z0-9_]*/)) {
          s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_]?macro_rules![ \t]*/, "", s); put(s)
        }
        # **A `let` BINDS A NAME; IT DOES NOT DECLARE A MEMBER OF A TYPE**, so it goes in behind the
        # `local:` tag and satisfies a BARE citation only. THIS IS THE RULE THAT CLOSES THE ARCHETYPE
        # THIS GATE WAS FILED FOR. `tm/lower_tm.rs` only CALLS `Builder::overflow` -- `tm/build.rs`
        # declares it -- but it binds `let overflow = b.overflow();`, so while a binding satisfied a
        # qualified citation the gate read the CALL SITE as the declaring file and passed two citations
        # of exactly the shape it exists to reject.
        #
        # Measured before the tag, by tagging every rule in this battery with the rule that emitted each
        # name and recording which tag satisfied each site (an instrumented copy of this script):
        # 11 of 471 sites rest on this rule or the field rule below with no other rule also emitting
        # the name, and qualification splits them exactly. The 5 that need a binding are
        # `Builder::overflow` twice -- qualified, and both drift -- against `first_order` twice and
        # `higher_order` once, all three bare and all three citing `examples/tm_demo.rs`.
        if (match(line, /(^|[^A-Za-z0-9_])let[ \t]+(mut[ \t]+)?[A-Za-z_][A-Za-z0-9_]*/)) {
          s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_]?let[ \t]+(mut[ \t]+)?/, "", s); put_local(s)
        }
        # A `wasm_bindgen` js_name MINTS the JS name, so this file is where it is declared. Without
        # this rule `link.ts`, citing a camelCase name against a snake_case Rust method, is a false
        # positive rather than the correct citation it is.
        if (match(line, /js_name[ \t]*=[ \t]*[A-Za-z_][A-Za-z0-9_]*/)) {
          s = substr(line, RSTART, RLENGTH); sub(/^js_name[ \t]*=[ \t]*/, "", s); put(s)
        }
        # A struct field, or a named parameter on its own line. **A FIELD IS A GENUINE MEMBER OF A TYPE,
        # SO THIS RULE KEEPS SATISFYING A QUALIFIED CITATION** -- unlike the `let` rule above -- even
        # though a named parameter on its own line is the same line shape and is NOT a member. The two
        # cannot be told apart by line shape, and the measurement says which way to resolve the tie: the
        # tree cites a struct field by a QUALIFIED name 5 times, `Session::tm` 4 times (the field is
        # `session.rs`s `pub(crate) tm:`) and `Work::closing` once (`lambda_sharing_probe.rs`s
        # `closing: u64,`), and after the `let` tag those 5 rest on this rule ALONE. Tagging this rule
        # too would redden 5 correct citations to close a parameter case no site in the tree exercises.
        # Guarded against a PATH at statement
        # position (`Encoding::push_frame(enc, 1);`) rather than widened to exclude it, because widening
        # this match grows RLENGTH and breaks the trailing-colon `sub` below it.
        if (line !~ /^[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*::/ &&
            match(line, /^[ \t]*(pub([ \t]*\([^)]*\))?[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*:/)) {
          s = substr(line, RSTART, RLENGTH); sub(/[ \t]*:$/, "", s)
          sub(/^[ \t]*(pub([ \t]*\([^)]*\))?[ \t]+)?/, "", s); put(s)
        }
        # An enum variant at statement position. **UPPERCAMEL ONLY, AND THAT RESTRICTION IS WHAT LETS
        # THIS GATE TELL A DECLARATION FROM A CALL AT ALL**: a variant and a call sit in the same
        # position, and the filed archetype — `push_frame(x);` — is snake_case, as every Rust function
        # is by a convention clippy enforces. The trailing `=[^>]` rather than bare `=` keeps a match
        # arm (`Other => {}`) from being read as an assignment, since `=>` contains `=`.
        if (match(line, /^[ \t]*[A-Z][A-Za-z0-9_]*[ \t]*([({,]|=[^>])/)) {
          s = substr(line, RSTART, RLENGTH); sub(/[ \t]*[({,=]$/, "", s); sub(/^[ \t]*/, "", s); put(s)
        }
        # A BARE UPPERCAMEL NAME ALONE ON A LINE WAS A RULE HERE AND IS DELETED, for the reason the
        # `use` bail above was: measured benefit zero. `^[ \t]*[A-Z][A-Za-z0-9_]*[ \t]*,?[ \t]*$`
        # fires on 302 stripped lines across the tracked `.rs` files, but the only name it contributes
        # that no other rule in the same file already emits is `None`, in 24 files -- so it made those
        # 24 files declare a name they only USE, and the verdict on every site was unchanged without
        # it. A bare `BITS` as the tail expression of `Binary::field_symbols` is the same shape and is
        # not in that 24 only because `tm/encoding/binary.rs` also declares `const BITS`. Measured by dumping
        # `strip_code <file> rust decls` for every tracked `.rs` file with and without the rule and
        # diffing the sorted name sets, and by `grep -cE` for the regex over the stripped lines.
        return
      }
      # **AN IMPORT OR A RE-EXPORT DECLARES NOTHING, AND THIS IS WHAT CATCHES THE BARREL.** A file that
      # only imports a symbol, or re-exports it from elsewhere, does not declare it, so a citation
      # naming that file for that symbol fails here rather than passing on mere presence.
      if (line ~ /^[ \t]*import[ \t]/) return
      if (line ~ /^[ \t]*export[ \t]/ && line ~ /[ \t]from[ \t]/) return
      # A TYPE-LEVEL DECLARATION. Each of these keywords mints a name another file can legitimately
      # claim a MEMBER of, so each goes in on plain `put` and satisfies a qualified citation.
      if (match(line, /(^|[^A-Za-z0-9_$])(function|class|interface|enum|namespace|type)[ \t]+\*?[ \t]*[A-Za-z_$][A-Za-z0-9_$]*/)) {
        s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_$]?[a-z]+[ \t]+\*?[ \t]*/, "", s); put(s)
      }
      # **`const`/`let`/`var` BIND A NAME EXACTLY AS A RUST `let` DOES, SO THEY GO BEHIND THE SAME
      # `local:` TAG** -- and this half of the split did not exist until a review of the Rust half went
      # looking for its twin and found the keyword rule here handing every binding to plain `put`. The
      # Rust rule above closed the filed archetype under `crates/`; this one closes the identical hole
      # in the tier that had actually drifted: all 26 drifted citations this gate found when it was
      # introduced were under `web/`, and so were 9 of the 10 this branch repointed. Before it,
      # `app.test.ts` cited `.step` against `pane-chrome.ts` -- a CSS class name against a `.ts` file --
      # and the only emission satisfying it there was
      # `const step = document.createElement(...)`, a local. Measured by running the scan with these
      # three keywords on `put` and then on `put_local`: it reddens exactly one site in the tracked
      # tree, that one, and leaves `--self-test` at 0 failures.
      if (match(line, /(^|[^A-Za-z0-9_$])(const|let|var)[ \t]+\*?[ \t]*[A-Za-z_$][A-Za-z0-9_$]*/)) {
        s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_$]?[a-z]+[ \t]+\*?[ \t]*/, "", s); put_local(s)
      }
      if (match(line, /(^|[^A-Za-z0-9_$])(get|set)[ \t]+#?[A-Za-z_$][A-Za-z0-9_$]*/)) {
        s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_$]?(get|set)[ \t]+/, "", s)
        sub(/^#/, "", s); put(s)
      }
      # A method or constructor SIGNATURE, told from a CALL by what follows its OWN parameter list: a
      # body `{` or a return type. A call is followed by `;`, `,`, `)` or a member access, and matches
      # neither -- but only once the list is found by its matching parenthesis, as the walk below
      # does, rather than by any `)` that happens to precede a colon. A wrapped CALL whose parameter
      # list spills to the next line used to pass this rule too — `bufferList(` alone on a line — until
      # the branch that accepted a bare line break was dropped; no passing site needed it.
      #
      # **"OVER 1,100 SITES OF THAT SHAPE UNDER `web/`" STOOD HERE AND IS WRONG BY MORE THAN AN ORDER OF
      # MAGNITUDE IN THE ALARMING DIRECTION. IT ALSO BORROWED THE WORD THIS GATE RESERVES FOR
      # ATTRIBUTION SITES TO MEAN STRIPPED LINES, AND `web/` HELD 339 ATTRIBUTION SITES IN TOTAL AT THE
      # BRANCH POINT, SO NO READING OF "SITES" REACHES 1,100.** Re-measured by running the real
      # `strip_code` over the 123 tracked `.ts`/`.tsx`/`.js` files under `web/` and applying the exact
      # condition of the deleted branch — the signature-head match above, then nothing but whitespace
      # after the `(` — which yields **39 lines**, against **193** that merely end in an open paren.
      # And all 39 are CALLS or control-flow keywords: `expect(` 17 times, `parseLayout(` 8,
      # `bufferList(` 4, `writeFileSync(` and `parseBuffers(` twice each, `while (` twice, and one each
      # of `setTmProgram(`, `reject(`, `if (` and `return (` — **10 distinct names, and not one genuine
      # wrapped signature among them.** So the deleted branch produced false declarations under `web/`
      # and nothing else, which is a stronger argument for deleting it than the inflated count was.
      if (match(line, /^[ \t]*((export|default|declare|abstract|async|static|readonly|public|private|protected|override)[ \t]+)*#?[A-Za-z_$][A-Za-z0-9_$]*[ \t]*(<[^<>]*>)?[ \t]*\(/)) {
        head = substr(line, RSTART, RLENGTH)
        # **THE SECOND ALTERNATIVE USED TO FORBID `{`, `}` AND `;` IN THE RETURN TYPE, WHICH LOST EVERY
        # SIGNATURE WHOSE RETURN TYPE IS AN OBJECT TYPE**, because an object type carries all three:
        # `scratchSeedOf(s: SessionId): { text: string; collapsed: boolean } | null`. Forbidding only
        # `;` is not enough -- measured, it closes NEITHER of the two the tree has -- so the whole tail
        # after `):` is accepted. Measured over the 127 tracked `.ts`/`.tsx`/`.js` files by diffing the
        # full declaration sets: that widening added exactly TWO names, `pane-host.ts` for
        # `scratchSeedOf` and `scratch.ts` for `editorSeed`, and removed none -- 3,565 to 3,567.
        #
        # **THE COMMENT HERE SAID A CALL IS NEVER FOLLOWED BY A COLON, AND THE RULE NEVER CHECKED WHICH
        # PARENTHESIS IT HAD MATCHED.** Both tests were `\)`-anchored regexes that ANY `)` on the
        # line satisfied, so the claim held for the parenthesis closing the call and for no other.
        # `setTimeout((): void => { tick() }, DEBOUNCE_MS)` read as declaring `setTimeout`, through the
        # typed arrow inside it; `render(busy ? spinner() : view())` through the ternary; and the
        # multi-line `register(id, (e: Event): void => {` through the body-brace test, whose head
        # parenthesis does not even close on its line. So the walk below counts parenthesis depth from
        # the head `(` -- the last character of HEAD, since the match is anchored at column 1 -- to its
        # MATCHING `)`, and only what follows THAT is tested for a return type or a body. An unclosed
        # head leaves AFTER empty, which the test cannot match. The regex guard in front of the walk is
        # a necessary condition of that test and only keeps the walk off lines that could never pass.
        # Strings and comments are already blanked and cannot miscount; a regex literal holding an
        # unbalanced parenthesis is not, and loses the signature: `strip(s = /\(/): string {` yields
        # nothing.
        #
        # **THE HOLE WAS LATENT, AND THE WALK WIDENS ONE THING.** Measured over the 127 tracked
        # `.ts`/`.tsx`/`.js` files, every emitted name keyed by its line: the walk removes NONE, so no
        # call line in the tree was being read as a signature, and it adds 3, 4,939 to 4,942, because a
        # body brace no longer has to end the line -- `panes.test.ts` builds a fake whose methods are
        # written `setDetached(_d: boolean) {},`, which are real declarations. Deleting the guard
        # leaves that set byte-identical.
        after = ""
        if (line ~ /\)[ \t]*[:{]/) {
          parens = 0
          for (j = length(head); j <= length(line); j++) {
            if (substr(line, j, 1) == "(") parens++
            else if (substr(line, j, 1) == ")" && --parens == 0) { after = substr(line, j + 1); break }
          }
        }
        if (after ~ /^[ \t]*[:{]/) {
          sub(/[ \t]*(<[^<>]*>)?[ \t]*\($/, "", head); sub(/^[ \t]*/, "", head)
          while (match(head, /^(export|default|declare|abstract|async|static|readonly|public|private|protected|override)[ \t]+/)) {
            head = substr(head, RLENGTH + 1)
          }
          sub(/^#/, "", head); put(head)
        }
      }
      # A field, a property, or an interface or type member. **63 OF THE TREE'"'"'S SITES REST ON THIS RULE
      # ALONE**, and the audit of them is why it is here rather than dropped as loose: this codebase
      # declares methods as object-literal properties holding arrow functions, and shapes as interface
      # members. Dropping it reddens 63 correct citations. It read 61 until TypeScript bindings moved
      # behind `local:`: the two `style.css` citations of `BufferRow.term` had ALSO rested on a local
      # `const term` in `buffer-list.ts`, and now rest on the member alone, which is the right place.
      if (match(line, /^[ \t]*((export|declare|static|readonly|public|private|protected|override)[ \t]+)*#?[A-Za-z_$][A-Za-z0-9_$]*[ \t]*[?!]?[ \t]*[:=]/)) {
        s = substr(line, RSTART, RLENGTH); sub(/[ \t]*[?!]?[ \t]*[:=]$/, "", s); sub(/^[ \t]*/, "", s)
        while (match(s, /^(export|declare|static|readonly|public|private|protected|override)[ \t]+/)) {
          s = substr(s, RLENGTH + 1)
        }
        sub(/^#/, "", s); put(s)
      }
    }
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
      if (emit == "decls") declare_names(out); else print out
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
  # Sets a global rather than printing, for `symbol_declared_in`'s reason: a command substitution at the
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

declare -A DECL_CACHE=()

# The names $1's CODE declares, newline-delimited, computed once per file. Same shape as
# `stripped_of` and for the same measured reason.
declarations_of() {
  local file="$1"
  if [[ -z ${DECL_CACHE[$file]+set} ]]; then
    DECL_CACHE[$file]="$(strip_code "$file" "$(lang_of "$file")" decls)"
  fi
}

# True when $2 (a symbol) is DECLARED in $1's code.
symbol_declared_in() {
  local file="$1" symbol="$2" bare stem qualified
  stem="${symbol%\(\)}"
  # **PATH-QUALIFIED OR BARE, AND THE DISTINCTION IS LOAD-BEARING.** `Type::member` and `Class.member`
  # claim a MEMBER of a type; a bare `name` claims only that the file declares that name. So a name that
  # `declare_names` emits ONLY behind the `local:` tag — from a Rust `let`, or a TypeScript
  # `const`/`let`/`var` — satisfies the bare form and not the qualified one. The tag marks the RULE that
  # emitted a name, not the name itself: where another rule in the same file emits it plain, a qualified
  # citation passes on that emission, binding or not.
  #
  # **"A BINDING NEVER SATISFIES THE QUALIFIED FORM" STOOD HERE, AND A REASSIGNMENT FALSIFIES IT.**
  # `web/src/compile.ts` emits `timer` twice, from `let timer` behind the tag and from
  # `timer = setTimeout(...)` plain, through the property rule; so this function answers DECLARED for
  # that file and `LegState.timer`, a member `sessions.ts` declares. The header lists the path with the
  # other two that reach the same place.
  #
  # **THE `Class.member` HALF OF THE FIRST VERSION OF THAT SENTENCE WAS FALSE FOR THE WHOLE LIFE OF THE
  # COMMIT THAT WROTE IT.** `put_local` was wired into the Rust `let` rule and nothing else, while
  # TypeScript `const`, `let` and `var` went through the keyword rule on plain `put` — so a qualified
  # `Class.member` citation was still satisfied by a local binding in a `.ts` file that merely CALLED
  # the member, the identical defect in the tier that had actually drifted. The heading constrained one
  # language and claimed two.
  # See the comment on the TypeScript binding rule for the one live site closing it reddened.
  #
  # **96 LIVE SITES NOW REST ON THE TAG, AND THE ASYMMETRY IS A CHOICE WITH A PRICE.** Measured by
  # re-running every site in the tree against the two halves of the declaration set separately: 96 pass
  # ONLY through `local:` — 6 under `crates/`, 90 under `web/` — and of those 96, **34** name a
  # module-scope binding (16 `export const`, 16 unexported `const`, 2 `let`) while **62** name one
  # indented inside a function or block. The 34 are module-level declarations that the tag nonetheless
  # treats as locals, so a QUALIFIED citation of one would be a false positive. The tree holds none:
  # routing the three TypeScript keywords through `put_local` reddened exactly one site, and that site
  # was wrong. The cheap rule stands until a real qualified citation of a module-scope `const` exists to
  # pay for a better one.
  if [[ $stem == *[.:]* ]]; then qualified=1; else qualified=0; fi
  bare="${stem}"
  bare="${bare##*[.:]}"
  bare="${bare#\#}"
  # A symbol that is not an identifier is not something this gate can resolve; pass it rather than
  # invent a verdict about it.
  if [[ -z $bare || ! $bare =~ ^[A-Za-z_] ]]; then
    return 0
  fi
  # CSS AND HTML HAVE NO DECLARATION EXTRACTOR, and fall back to the presence rule. `ATTRIBUTION_RE`
  # admits both extensions and NOTHING IN THE TREE CITES EITHER — of 499 sites at the branch point the
  # cited file was `.ts` 318 times, `.rs` 180 and `.js` once — so an extractor for them would ship
  # unexercised. The fallback is asserted in `--self-test` so it is a decision rather than an accident.
  case "$file" in
    *.css | *.html)
      stripped_of "$file"
      # A bash word test, not a `grep`, for the reason the deleted presence-only check carried: piping
      # this through `grep -qwF` instead is the shape that once cost this scan a seven-second run.
      [[ ${STRIP_CACHE[$file]} =~ (^|[^A-Za-z0-9_])"$bare"([^A-Za-z0-9_]|$) ]]
      return
      ;;
  esac
  declarations_of "$file"
  # A glob rather than a regex, and a literal `$bare` because it is quoted: no fork, and no regex over
  # whole-file text. Strictly cheaper than the presence test this replaces.
  [[ $'\n'"${DECL_CACHE[$file]}"$'\n' == *$'\n'"$bare"$'\n'* ]] && return 0
  # The tagged half of the same set. A bare citation may rest on a binding; a qualified one may not.
  ((qualified == 0)) && [[ $'\n'"${DECL_CACHE[$file]}"$'\n' == *$'\n'"local:$bare"$'\n'* ]]
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
      # An ambiguous citation passes when the symbol is declared in ANY candidate's code: the citation
      # is satisfiable, and picking between two `lib.rs` files is not this gate's job. It fails only
      # when no candidate declares it, which is the drift this gate exists for.
      hit=0
      while IFS= read -r candidate; do
        [[ -z $candidate ]] && continue
        excluded_path "$candidate" && continue
        [[ -f $candidate ]] || continue
        if symbol_declared_in "$candidate" "$symbol"; then hit=1; break; fi
      done <<<"$candidates"
      if ((hit == 0)); then
        printf '%s:%s: cites `%s` for `%s`, which that file does not declare\n' \
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

A symbol citation must name the file that DECLARES the symbol, not merely a file whose code calls it or
mentions it. When code moves, the citation does not follow it, and the symbol staying real is what
makes the wrong filename invisible. Fix by re-resolving the symbol, not by deleting the citation — and
if the reference is deliberately historical ("what replaces <file>'s <symbol>"), rewrite it so it does
not read as a pointer to live code.
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
  #
  # **THE TALKER CARRIES A REAL DECLARATION INSIDE ITS COMMENTS, AND THAT IS WHAT MAKES THE ASSERTION
  # ABLE TO FAIL.** While the comment was PROSE mentioning `forward`, no declare rule fired on the
  # comment text whether or not the comment was stripped, so the check was green with all comment
  # stripping deleted — it asserted the declaration rule and not the stripper it is named for. Both
  # comment forms are here because the two halves of the stripper can be lost separately: deleting the
  # `//` handling reddens this check through the first line, deleting the `/*` handling through the
  # second. Do not soften either back to prose. This is the same defect the barrel fixture below had.
  printf 'export const forward = () => {}\n' >"$tmp/owner.ts"
  printf '// export const forward = () => {} -- it moved out of this file.\n' >"$tmp/talker.ts"
  printf '/*\n * export const forward = () => {}\n */\nexport const other = 1\n' >>"$tmp/talker.ts"
  # A Rust target whose symbol sits between two lifetime annotations — blind sub-case 2.
  printf 'pub struct Holder<%sa> { pub inner: &%sa str }\nimpl Drop for Holder<%s_> { fn drop(&mut self) {} }\n' \
    "'" "'" "'" >"$tmp/core.rs"
  # A Rust target whose only mention of the symbol is inside a raw string, and the mention is a REAL
  # DECLARATION for the reason the talker above carries one.
  #
  # **THE INNER `"` IS LOAD-BEARING.** Drop it and this assertion stops testing the raw-string branch:
  # a stripper that has lost that branch reads `r#"` as a plain quote, and the raw string's own closing
  # quote then ends its string state, so the content is blanked anyway and the check is green either
  # way. With the inner quote, the naive stripper closes early and the declaration sitting between the
  # two quotes lands in CODE. Measured: deleting the raw-string branch reddens this check.
  printf 'pub const SRC: &str = r#"x" pub fn needle() {} "x"#;\n' >"$tmp/raw.rs"
  # A Rust file whose ONLY mention of the symbol is a call at statement position. This is the filed
  # archetype — `lower_tm.rs` calling `Encoding::push_frame`, which `encoding.rs` declares — and it is
  # the one assertion this gate was missing.
  printf 'pub fn lower() {\n    push_frame(1);\n}\n' >"$tmp/caller.rs"
  # A Rust file that only CALLS the symbol but BINDS the bare name to the result. This is the exact
  # shape the filed archetype had in `tm/lower_tm.rs` — `let overflow = b.overflow();` against a
  # `Builder::overflow` declared in `tm/build.rs` — and it is the shape that survived the first
  # version of the declaration rule: the binding made the CALL SITE read as the declaring file.
  #
  # **BOTH DIRECTIONS ARE ASSERTED BELOW, AND THE PAIR IS WHAT MAKES EITHER MEANINGFUL.** Rejecting
  # the qualified form is the fix; still accepting the BARE form is the constraint the fix had to
  # respect, because three live sites cite `examples/tm_demo.rs` for `first_order` and `higher_order`,
  # bare, and those names are `let` bindings and nothing else. A rule that rejected both would be
  # green on this fixture and red on the tree.
  printf 'pub fn caller(b: &Builder) {\n    let overflow = b.overflow();\n}\n' >"$tmp/binder.rs"
  # A TypeScript barrel: it re-exports and declares nothing, which `types.ts` says of itself.
  # THE SHAPE HERE IS NOT ARBITRARY: `export type { Owner } from ...` puts a `{` straight after
  # `type`, so no declare rule ever fires on it and the assertion below passes whether or not the
  # import/export-from bail exists. `export { type Owner } from ...` is the inline-type-modifier
  # form, and it DOES reach the keyword declare rule, so only this shape can actually exercise the
  # bail. Do not simplify this back to the bare `export type { ... } from` form.
  printf "export { type Owner } from '../bindings/Owner'\nexport const unrelated = 1\n" >"$tmp/barrel.ts"
  # A `wasm_bindgen` js_name MINTS the JS name, so the Rust file IS where it is declared.
  printf '#[wasm_bindgen(js_name = linkIndex)]\npub fn link_index(&self) -> usize { 0 }\n' >"$tmp/bindgen.rs"
  # An object-literal method. 63 of the tree's sites rest on this rule alone.
  printf 'export const make = () => ({\n  detach: (step: number) => {},\n})\n' >"$tmp/factory.ts"
  # A cited CSS file, for which there is no declaration extractor and the presence rule stands.
  printf '.linked {\n  color: red;\n}\n' >"$tmp/style.css"

  # **THE FIXTURES BELOW CLOSE A COVERAGE GAP THAT WAS MEASURED RULE BY RULE, NOT GUESSED.**
  # `declare_names` carries 13 declare rules — seven Rust, and six TypeScript counting the two early
  # bails — and this battery exercised **6** of them. Deleting any one of the other seven left
  # `--self-test` at 0 failures. Four of the seven carry live citations and took the tree scan red when
  # deleted: the Rust type-keyword rule at 30 violations, the TypeScript signature rule at 24, the Rust
  # field rule at 5, the Rust UpperCamel variant rule at 1 — 60 live citations whose only guard was
  # today's tree. The other three — `macro_rules!`, the TypeScript `import` bail, `get`/`set` — carry
  # none, so the scan stayed green too and nothing at all would have noticed them go. Deleting the `()`
  # strip in `symbol_declared_in`, which is not a declare rule, was the same shape: green, and the scan
  # at 22. A figure of "8 of 13" was written for this gap before it was measured, which is the error
  # this paragraph exists to report. Each fixture is built so that ONE rule emits the asserted name
  # and no other rule in the same file can.
  #
  # A Rust type-keyword declaration. The variant rule needs an UpperCamel name at line start and this
  # line starts `pub`; the field rule needs a colon straight after an identifier and there is none.
  printf 'pub struct Marker;\n' >"$tmp/typekw.rs"
  # A Rust struct FIELD, asserted through a QUALIFIED citation on purpose: the field rule sits on plain
  # `put` rather than `put_local` because a field IS a member of a type, and this check fails both if
  # the rule is deleted and if it is ever moved behind the tag. `Rec` comes from the type-keyword rule;
  # only the field rule emits `width`.
  printf 'pub struct Rec {\n    pub width: usize,\n}\n' >"$tmp/rec.rs"
  # A Rust enum VARIANT at statement position. The type-keyword rule emits `Shape`, not `Rounded`, and
  # the field rule needs a colon, so `Rounded` has exactly one source.
  printf 'pub enum Shape {\n    Rounded(u8),\n}\n' >"$tmp/variant.rs"
  # Two KEYWORDLESS TypeScript method signatures, which only the signature rule can reach: the property
  # rule wants `:` or `=` straight after the name and finds `(`, and there is no `function`/`const` on
  # either line. `seedOf` needs more than the rule — it needs the widened return-type alternative, since
  # its return type carries braces AND a `;`, and that is the miss this branch closed.
  printf '%s\n' \
    'export class Widget {' \
    '  compute(a: number): string {' \
    '    return String(a)' \
    '  }' \
    '' \
    '  seedOf(id: string): { text: string; collapsed: boolean } | null {' \
    '    return null' \
    '  }' \
    '}' >"$tmp/widget.ts"
  # A Rust `macro_rules!` definition. No other Rust rule reaches `tape_step`: it is snake_case, so the
  # variant rule cannot, and there is no keyword and no colon.
  printf 'macro_rules! tape_step {\n    () => {};\n}\n' >"$tmp/macro.rs"
  # A TypeScript accessor. The signature rule cannot reach `width` because its head is anchored at the
  # line start and reads `get` as the name, then finds a space rather than `(`.
  printf 'export class Box {\n  get width() {\n    return 1\n  }\n}\n' >"$tmp/accessor.ts"
  # A TypeScript `import` whose inline `type` modifier WOULD reach the declaration-keyword rule, for
  # the barrel fixture's reason: `import type { Owner }` puts `{` straight after `type`, no rule fires,
  # and the assertion would pass with the bail deleted. Only the inline form exercises the bail.
  printf "import { type Owner } from './bindings/Owner'\nexport const unrelated = 1\n" >"$tmp/importer.ts"

  # **THE TYPESCRIPT HALF OF THE QUALIFIED/BARE SPLIT SHIPPED GUARDED BY NOTHING.** Moving the
  # `const`/`let`/`var` rule from `put_local` back to `put` left this battery at `22 checks, 0 failures`
  # AND the scan at 471 sites and 0 violations: both qualified-rejection checks used the Rust
  # `binder.rs`, and the one live site the TypeScript move reddened had been reworded. This is that
  # fixture in TypeScript, the same call bound to the same bare name, asserted in both directions for
  # the reason `binder.rs` gives. `Builder` qualifies with `.` here where `binder.rs` uses `::`.
  printf 'export function caller(b: Builder) {\n  const overflow = b.overflow()\n}\n' >"$tmp/tsbinder.ts"
  # The other direction of the same split, per member rule. Moving the TypeScript SIGNATURE rule or the
  # PROPERTY rule behind `put_local` also left this battery green, and only the scan noticed, at 2 and 9
  # violations, because every TypeScript member check here was BARE, and a bare citation passes on a
  # tagged name. So one member per rule is cited QUALIFIED, as the Rust field check already was: the
  # property rule alone emits `timer`, and the signature rule alone emits `subscribe`.
  printf 'export interface Leg {\n  timer: number | null\n}\n' >"$tmp/leg.ts"
  # **`subscribe` IS BUILT TO FAIL TWO WRONG WALKS, NOT ONE.** Its parameter list holds a nested `)`
  # that is followed by ` => void`, so a walk stopping at the FIRST `)` rejects it; its return type
  # holds `() => void`, so a walk jumping to the LAST `)` rejects it too. Only the MATCHING `)` is
  # followed by `:`.
  printf '%s\n' \
    'export class Emitter {' \
    '  subscribe(handler: (e: Event) => void): { off: () => void } {' \
    '    return { off: () => {} }' \
    '  }' \
    '}' >"$tmp/emitter.ts"
  # **TWO CALLS THE SIGNATURE RULE READ AS DECLARATIONS, BECAUSE IT NEVER CHECKED WHICH `)` PRECEDED
  # THE COLON.** Neither head parenthesis is followed by `:` or `{`: `setTimeout` closes at the end of
  # its line, and `register` does not close on its line at all. Each was accepted by the old
  # `\)[ \t]*:.*$` test, through the typed arrow each carries.
  printf '%s\n' \
    'setTimeout((): void => { tick() }, DEBOUNCE_MS)' \
    'register(id, (e: Event): void => {' \
    '  apply(e)' \
    '})' >"$tmp/calls.ts"

  local good bad_moved bad_parens good_parens bad_raw bad_bound
  good="// see ${q}owner.ts${q}'s ${q}forward${q} for the handler"
  bad_moved="// see ${q}talker.ts${q}'s ${q}forward${q} for the handler"
  bad_parens="// see ${q}talker.ts${q}'s ${q}forward()${q} for the handler"
  # **THE POSITIVE DIRECTION OF THE `()` STRIPPER, WHICH NOTHING USED TO ASSERT.** The check above is
  # named for blind sub-case 3 and only ever proved `ATTRIBUTION_RE` admits the `sym()` form: it expects
  # 0, which a stripper that has lost `stem="${symbol%()}"` still returns, because a symbol spelled
  # `forward()` is absent from the declaration set either way. Deleting that one parameter expansion
  # left `--self-test` at 0 failures and took the tree scan to 22 violations. This citation names the
  # file that DOES declare `forward`, so it can only pass once the `()` has been stripped.
  good_parens="// see ${q}owner.ts${q}'s ${q}forward()${q} for the handler"
  bad_raw="// see ${q}raw.rs${q}'s ${q}needle${q} for the text"
  # End-to-end, and it carries the `::` the other four citations here do not: it is the only check
  # that proves `ATTRIBUTION_RE` admits a path-qualified symbol at all. Drop the `:` from that
  # alternation and this check reports no attribution matched rather than a wrong verdict.
  bad_bound="// see ${q}binder.rs${q}'s ${q}Builder::overflow${q} for the guard"

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
      if [[ -f $cand ]] && symbol_declared_in "$cand" "$symbol"; then found=1; fi
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

  assert_declared() {
    local label="$1" file="$2" symbol="$3" expect="$4" got=0
    checks=$((checks + 1))
    if symbol_declared_in "$file" "$symbol"; then got=1; fi
    if ((got == expect)); then
      printf '  ok    %s\n' "$label"
    else
      printf '  FAIL  %s (declared=%d, expected %d)\n' "$label" "$got" "$expect" >&2
      failures=$((failures + 1))
    fi
  }

  printf 'check-attributions --self-test\n'
  assert_site 'a citation naming the defining file passes' "$good" 'citer.ts' 1
  assert_site 'a symbol present only in a comment is NOT ownership' "$bad_moved" 'citer.ts' 0
  assert_site 'the sym() form is matched, not skipped' "$bad_parens" 'citer.ts' 0
  assert_site 'a sym() citation of the DEFINING file passes, which is the () stripper' \
    "$good_parens" 'citer.ts' 1
  assert_site 'a symbol present only in a Rust raw string is NOT ownership' "$bad_raw" 'citer.ts' 0
  assert_site 'a Type::member citation of a file that only binds the bare name is rejected' \
    "$bad_bound" 'citer.ts' 0

  assert_declared 'a call at statement position is NOT a declaration' "$tmp/caller.rs" 'push_frame' 0
  assert_declared 'a QUALIFIED citation is NOT satisfied by a local let binding' \
    "$tmp/binder.rs" 'Builder::overflow' 0
  assert_declared 'a BARE citation IS satisfied by a local let binding' "$tmp/binder.rs" 'overflow' 1
  assert_declared 'a re-export is NOT a declaration' "$tmp/barrel.ts" 'Owner' 0
  assert_declared 'a wasm_bindgen js_name IS a declaration' "$tmp/bindgen.rs" 'linkIndex' 1
  assert_declared 'an object-literal method IS a declaration' "$tmp/factory.ts" 'detach' 1
  assert_declared 'a cited CSS file falls back to the presence rule' "$tmp/style.css" 'linked' 1
  assert_declared 'a Rust type-keyword declaration IS a declaration' "$tmp/typekw.rs" 'Marker' 1
  assert_declared 'a Rust struct field satisfies a QUALIFIED citation' "$tmp/rec.rs" 'Rec::width' 1
  assert_declared 'a Rust enum variant at statement position IS a declaration' \
    "$tmp/variant.rs" 'Rounded' 1
  assert_declared 'a keywordless TypeScript method signature IS a declaration' \
    "$tmp/widget.ts" 'compute' 1
  assert_declared 'a TypeScript signature whose return type contains braces IS a declaration' \
    "$tmp/widget.ts" 'seedOf' 1
  assert_declared 'a Rust macro_rules! definition IS a declaration' "$tmp/macro.rs" 'tape_step' 1
  assert_declared 'a TypeScript get accessor IS a declaration' "$tmp/accessor.ts" 'width' 1
  assert_declared 'an import is NOT a declaration' "$tmp/importer.ts" 'Owner' 0
  assert_declared 'a QUALIFIED Class.member citation is NOT satisfied by a TypeScript const binding' \
    "$tmp/tsbinder.ts" 'Builder.overflow' 0
  assert_declared 'a BARE citation IS satisfied by a TypeScript const binding' "$tmp/tsbinder.ts" 'overflow' 1
  assert_declared 'a TypeScript interface member satisfies a QUALIFIED citation' "$tmp/leg.ts" 'Leg.timer' 1
  assert_declared 'a TypeScript signature with a nested paren satisfies a QUALIFIED citation' \
    "$tmp/emitter.ts" 'Emitter.subscribe' 1
  assert_declared 'a call carrying a typed arrow is NOT a signature' "$tmp/calls.ts" 'setTimeout' 0
  assert_declared 'a multi-line call carrying a typed arrow is NOT a signature' "$tmp/calls.ts" 'register' 0

  # Blind sub-case 2, re-targeted. `Drop` was the old probe and cannot be: a file that only IMPLEMENTS
  # a foreign trait does not declare it, so that assertion would now pass for the wrong reason. The
  # defect it guards is that a `'` read as a char-literal opener leaks the "string" state ACROSS the
  # line boundary — line 2 below carries THREE lifetimes, an odd count — and blanks the declaration on
  # the line after it. Measured: the real stripper keeps `after_the_lifetimes`, a naive one loses it.
  printf '%s\n%s\n%s\n' \
    "pub struct Holder<'a> { pub inner: &'a str }" \
    "impl<'a> AsRef<str> for Holder<'a> { fn as_ref(&self) -> &'a str { self.inner } }" \
    "pub fn after_the_lifetimes() -> usize { 1 }" >"$tmp/core.rs"
  assert_declared 'a declaration after an odd run of Rust lifetimes survives stripping' \
    "$tmp/core.rs" 'after_the_lifetimes' 1

  # **THE MIRROR IMAGE OF THE CHECK ABOVE, WHICH NOTHING GUARDED.** That check fails when every `'` opens
  # a string, and passes when the apostrophe branch is deleted outright, because a `'` reaching no branch
  # is plain code. But with the branch gone, the `"` INSIDE a char literal `'"'` opens a string, and that
  # string runs to the next `"` in the file, blanking every line between: deleting it changed what three
  # tracked files declare, and no citation names any of them, so the scan stayed green too. This line is
  # the shape, and `after_quote` is the declaration it swallows.
  printf '%s\n' "pub fn quote_char() -> char { '\"' }" 'pub fn after_quote() {}' >"$tmp/quote.rs"
  assert_declared 'a declaration after a Rust char literal of a double quote survives stripping' \
    "$tmp/quote.rs" 'after_quote' 1

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
