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
# **THE GATE COVERS BOTH TIERS**, Rust and TypeScript: it is armed for the next extraction, wherever
# that happens.
#
# **A POSSESSIVE CLAIMS THE DECLARATION; EVERY OTHER ACT ON A SYMBOL IS NAMED, NOT POSSESSED.** The
# declaration rule below rests on that convention.
#
# **THE TWO DISCRIMINATORS THAT DO NOT WORK, BECAUSE BOTH ARE THE OBVIOUS DESIGN.** Symbol *shape*
# cannot split declaration from use: `pane-host.ts`'s `paneEvents.rebind` is declared in the cited
# file and `run.rs`'s `form.is_artifact()` is only called there, and the two citations have the same
# shape. A following role noun (`the handler`, `the constant`) gets roughly 70%: it misses a citation
# that carries none, and it accepts `types.ts`'s `Owner` doc, which is drift.
#
# **THREE BLIND SPOTS THE SCANNER CLOSES.**
#
#   1. **A PRESENCE TEST THAT DOES NOT STRIP COMMENTS PASSES ON ANY FILE THAT MERELY MENTIONS THE
#      SYMBOL.** Asked whether `forward` appears in `main.ts`, such a test answers yes for any comment
#      in `main.ts` that mentions it. A file that TALKS about a symbol does not own it. `strip_code`
#      below is the whole answer, and it is the same door `check-citations.sh` closes in its own scan.
#   2. **A RUST `'` IS A LIFETIME FAR MORE OFTEN THAN A CHAR LITERAL.** Blanking from `'` to the next
#      `'` deletes real code between two lifetime annotations, which turns declared names into
#      missing ones. The stripper treats `'` as a literal ONLY when a complete char literal follows,
#      and as code otherwise.
#   3. **A SYMBOL WRITTEN `sym()` DOES NOT MATCH A PATTERN THAT STOPS AT WORD CHARACTERS.**
#
# **A FOURTH LIMIT: THE GATE CONFIRMS A FILE DECLARES A SYMBOL, AND SAYS NOTHING ABOUT WHICH DECLARATION.**
# Where a file declares a name more than once, a citation meant for any one of them passes identically.
#
# **WHAT IT DELIBERATELY DOES NOT CATCH.** A doc quoted verbatim and attributed to the wrong file —
# `` see its doc in `<file>`: "…" ``. Matching prose quotes needs fuzziness whose false-positive rate
# would be unmeasured.
# Neither does it catch an attribution split across a line wrap, for the reason `check-citations.sh`
# gives for the same gap: grep is line-based and so is every rule below.
#
# **The wrap gap is symmetrical and cheap to fall into in both directions: reflowing a paragraph can put a
# citation under this gate or take it out from under it, and neither shows up as a diff to any citation.**
#
# **AN IMPORT LINE AND AN `export ... from` LINE DECLARE NOTHING**, so a citation naming the barrel file
# rather than the defining one fails here instead of reading clean on the symbol's mere presence in the
# barrel's code.
#
# **THE GUARANTEE IS BOUNDED, AND THE HOLES BELOW ARE ITS EDGE.** `0 violations` is a verdict on the
# citations the tree holds today. The holes mean a FUTURE citation of their shapes can pass without being
# right, and they are written down rather than patched because each one is the line shape of a real
# declaration that live sites rest on.
#
# **A FAMILY OF LINE-BASED HOLES A PER-LINE EXTRACTOR CANNOT CLOSE.** A Rust `use` whose import list wraps
# puts the bare names on CONTINUATION lines, so `crates/redextape-grammar-check/tests/asm.rs` reads as
# declaring `CORPUS` — a name sitting alone on a wrapped line — when
# `crates/redextape-grammar-check/src/asm.rs` is the file that actually declares it. A Rust struct LITERAL
# at statement position (`Program {`) is indistinguishable from a struct-variant declaration, so
# `crates/redextape-native/src/jit.rs` reads as declaring `Program`, which `tm/asm.rs` declares — NOT
# `ast.rs`: `jit.rs` imports `redextape_core::tm::Program` at its top and again in its test module, and
# `crates/redextape-core/src/ast.rs` declares a different, surface `Program` of the same name. A Rust
# TUPLE-variant match arm in that same file — `Ok(subs) => subs,` — is indistinguishable from a
# tuple-variant declaration and emits `Ok`; only the bare `Other => {}` shape, where `=>` could be misread
# as an assignment's `=`, is closed. A config-object key whose value is an imported symbol —
# `foo({ bar: thing })`, written so `bar:` opens its own line — is the same ambiguity in TypeScript: it
# matches the property rule, which live sites rest on alone (below), and there is no cheaper test that
# tells the two apart.
#
# **THREE MORE MEMBERS OF THAT FAMILY.** A Rust struct LITERAL's field lines read as field declarations,
# which is the Rust twin of the config-object-key hole above: `crates/redextape-native/src/jit.rs` builds
# `Program { code: vec![..], labels: vec![], .. }`, so it reads as declaring `code` and `labels`, which
# `crates/redextape-core/src/tm/asm.rs` declares. Qualification does not help here — `Program::code`
# really is a member, so the field rule has to keep satisfying it. An `if let Some(v)` or `if let Ok(w)`
# makes a file declare `Some` or `Ok`; that one is NARROWED rather than open, because the `let` rule
# emits behind `local:`, so only a BARE citation can rest on the `if let` line — a qualified
# `Option::Some` cannot rest on THAT line, and can rest on a match arm, as the next paragraph shows. And
# a TypeScript plain RE-ASSIGNMENT reads as a declaration: `counter = counter + 1` matches the property
# rule, which cannot tell it from a key in an object literal.
#
# **THE `local:` TAG NARROWS WHICH RULE CAN SATISFY A QUALIFIED CITATION, NOT WHICH NAME, SO ANY OTHER
# RULE EMITTING THE SAME NAME PLAIN REOPENS IT.** Three such paths:
#
#   1. **A REASSIGNED BINDING.** `let timer` goes in behind the tag and `timer = setTimeout(...)` goes
#      in plain, so `web/src/compile.ts`, which emits `timer` from those two lines and no others,
#      satisfies a qualified `Type.timer`. Under `web/`, many name-and-file pairs carry both a `local:`
#      name and the same name from a reassignment line, and a few more carry it from a comparison
#      opening a continuation line, `frame === null || program === null`, whose first `=` the property
#      rule reads the same way.
#   2. **A TYPESCRIPT PARAMETER ON ITS OWN LINE** (`button: HTMLButtonElement,`), **A DEFAULT PARAMETER**
#      (`width = 3,`), **A DESTRUCTURED KEY** (`warm: isWarm,`) **AND A LABEL** (`outer:`) all match the
#      property rule and go in plain. So `web/src/buffer-list.ts` satisfies a qualified `Session.button`,
#      through the first parameter of `bufferList`.
#   3. **A RUST TUPLE-VARIANT MATCH ARM.** `Some(y) =>` goes in plain through the UpperCamel variant
#      rule, so a qualified `Option::Some` passes on any file holding one.
#
# The first two are the line shapes of an interface member, a class field and an object-literal key,
# which the sites resting on the property rule alone need it to keep reading; the third is the shape
# of a tuple variant. No test on one line tells them apart.
#
# **DECLARATION FORMS THE EXTRACTOR MISSES. EACH WOULD REDDEN A CORRECT CITATION RATHER THAN LET A WRONG ONE
# THROUGH.** Three have zero occurrences in the tree: an exported destructured binding
# (`export const { compile, parse } = ...`), a Rust enum whose variants share the enum's own line, and a
# Rust field behind an inline attribute — the tree's one instance of that last shape sits inside a raw
# string in `ts_derive_scan.rs`, so the stripper blanks it and no name escapes. The other two forms are not
# open misses:
#
#   1. **A TYPESCRIPT SIGNATURE WHOSE RETURN TYPE ITSELF CONTAINS BRACES IS CLOSED, NOT MISSED.**
#      `scratch.ts`'s `editorSeed` and `pane-host.ts`'s `scratchSeedOf` both return
#      `{ text: string; collapsed: boolean } | null`, and the signature rule accepts the whole tail after
#      `):`, so they are read as the declarations they are.
#
#      **LEFT OPEN, THE MISS WOULD BE NOT ONLY A FALSE NEGATIVE BUT A FALSE POSITIVE AT A DELEGATING CALL
#      SITE.** `pane-host.ts` declares `scratchSeedOf` as a member of its own deps type and `main.ts`
#      supplies it as an object-literal property —
#      `scratchSeedOf: (session: SessionId) => scratchpad.editorSeed(session)` — which the property rule
#      reads as a declaration. Were the miss open, a citation naming `main.ts` would pass for
#      `scratchSeedOf` while the file declaring the member failed. The reassurance that "a cited
#      declaration this extractor misses IS a violation" holds only when no other file happens to emit
#      the same name; where one does, the extractor would prefer the delegating call site over the
#      declaration — the defect this gate exists to reject, produced by the gate. That asymmetry is why
#      the signature rule reads such a return type: see the comment on that rule.
#
#   2. **AN `export function` WITH A DEFAULT PARAMETER VALUE IS NOT MISSED AT ALL**: the keyword rule reads
#      the `function` and never looks inside the parameter list. `export function withDefault(a = 1) {`
#      yields `withDefault`.
set -euo pipefail

# The attribution form: a backticked filename with a source extension, a possessive, and a
# backticked symbol. The symbol alternation admits `()`, `.`, `::` and `#` because all four appear
# in the tree's real citations.
readonly ATTRIBUTION_RE='`[A-Za-z0-9_./-]+\.(rs|ts|tsx|js|css|html)`('"'"'|’)s +`[A-Za-z0-9_$.:#()]+`'

# THE ESCAPE HATCH, counted out loud for the reason `check-citations.sh` states: a marker sits on the
# line it excuses and is visible in review, where a config file collects exemptions nobody meets.
#
# **EACH MARKER'S ARGUMENT IS HERE RATHER THAN LEFT TO BE INFERRED.** Both cite a discriminated-union tag —
# the `compiled` reply — which lives in `protocol.ts` as a quoted string, and `strip_code` blanks string
# literals ON PURPOSE, because the blindness it buys back (blind sub-case 1 above) costs more than two markers.
#
# This script is NOT scanned by its own scan: `SOURCE_RE` below is `\.(rs|ts|tsx|js|css|html)$` and this
# script is `.sh`. `check-citations.sh` is scanned by its own scan, because that gate has no `SOURCE_RE` and
# scans all tracked text. `ci.yml`, `Cargo.toml`, `README.md`, a `.gitignore`, a comment in two of the
# tree-sitter query files and `check-citations.sh`'s own header, among other files, carry attribution sites
# this gate cannot read, and none of them is drifted today — which is why the scope stays as it is rather
# than widening to cover them.
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
# remains is found in CODE. `$2` is `rust` or `ts`, and every place the two differ tests `lang`. THE ONE
# STRIPPING IMPLEMENTATION — the scan and `--self-test` both reach it here.
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
    # parameter**: it yields a boolean, silently, with only a warning. So every `sub` here is written out
    # rather than factored into a helper. A regex constant also cannot be CONTINUED across lines, which is
    # why five `match` calls below run past 120 columns — wrapping one means converting its regex to the
    # string form no other rule here uses. Those five are the only lines in this file over 120.
    function declare_names(line,    s, head, j, parens, after) {
      # A line that strips to whitespace can declare nothing, so the battery below never runs on one. About
      # half the lines across the files this gate resolves as candidates strip to whitespace, because
      # comment density across this tree runs that high; removing this guard makes the same scan 47% slower
      # with an identical verdict, which is what makes it pure saving.
      if (line ~ /^[ \t]*$/) return
      if (lang == "rust") {
        # A Rust `use` needs no bail of its own: no rule below fires on a single-line `use`, since every
        # rule in this branch is anchored on a keyword or on an UpperCamel or identifier at the start of the
        # line, and `use`/`pub use` match neither. TypeScript is different -- its keyword declare rule
        # reaches `type Owner` even inside `export { type Owner } from ...`, which is why THAT bail earns
        # its keep and this one does not. A bail here would also swallow a declaration that shares its line
        # with a `use` (`use crate::x::Y; pub fn after() {}`). A wrapped `use`, whose names sit on
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
        # THIS GATE EXISTS FOR. `tm/lower_tm.rs` only CALLS `Builder::overflow` -- `tm/build.rs`
        # declares it -- but it binds `let overflow = b.overflow();`, so a rule that let a binding satisfy
        # a qualified citation would read the CALL SITE as the declaring file and pass a citation of
        # exactly the shape this gate exists to reject.
        #
        # A binding must still satisfy a BARE citation: `first_order` twice and `higher_order` once are bare
        # citations of `examples/tm_demo.rs` and rest on it.
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
        # cannot be told apart by line shape, and the citations say which way to resolve the tie: the
        # tree cites struct fields by QUALIFIED name (`Session::tm`, `session.rs`s `pub(crate) tm:`;
        # `Work::closing`, `lambda_sharing_probe.rs`s `closing: u64,`; `LambdaState.spans`, a field
        # `viewmodel.rs` declares), and with the `let` rule tagged those citations rest on this rule ALONE.
        # Tagging this rule too would redden them to close a parameter case no site in the tree exercises.
        # Guarded against a PATH at statement position (`Encoding::push_frame(enc, 1);`) rather than
        # widened to exclude it, because widening this match grows RLENGTH and breaks the trailing-colon
        # `sub` below it.
        if (line !~ /^[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*::/ &&
            match(line, /^[ \t]*(pub([ \t]*\([^)]*\))?[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*:/)) {
          s = substr(line, RSTART, RLENGTH); sub(/[ \t]*:$/, "", s)
          sub(/^[ \t]*(pub([ \t]*\([^)]*\))?[ \t]+)?/, "", s); put(s)
        }
        # An enum variant at statement position. **UPPERCAMEL ONLY, AND THAT RESTRICTION IS WHAT LETS
        # THIS GATE TELL A DECLARATION FROM A CALL AT ALL**: a variant and a call sit in the same
        # position, and the archetype — `push_frame(x);` — is snake_case, as every Rust function
        # is by a convention clippy enforces. The trailing `=[^>]` rather than bare `=` keeps a match
        # arm (`Other => {}`) from being read as an assignment, since `=>` contains `=`.
        if (match(line, /^[ \t]*[A-Z][A-Za-z0-9_]*[ \t]*([({,]|=[^>])/)) {
          s = substr(line, RSTART, RLENGTH); sub(/[ \t]*[({,=]$/, "", s); sub(/^[ \t]*/, "", s); put(s)
        }
        # A BARE UPPERCAMEL NAME ALONE ON A LINE IS NOT READ AS A DECLARATION: a line matching
        # `^[ \t]*[A-Z][A-Za-z0-9_]*[ \t]*,?[ \t]*$` names something the file USES, such as `None`, or a
        # bare `BITS` as the tail expression of `Binary::field_symbols`, rather than declares it.
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
      # **`const`/`let`/`var` BIND A NAME EXACTLY AS A RUST `let` DOES, SO THEY GO BEHIND THE SAME `local:`
      # TAG.** The Rust rule above closes the archetype under `crates/`; this one closes the identical
      # hole under `web/`. Without the tag, a citation of a CSS class `.step` against a `.ts` file would be
      # satisfied by a local `const step = document.createElement(...)`.
      if (match(line, /(^|[^A-Za-z0-9_$])(const|let|var)[ \t]+\*?[ \t]*[A-Za-z_$][A-Za-z0-9_$]*/)) {
        s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_$]?[a-z]+[ \t]+\*?[ \t]*/, "", s); put_local(s)
      }
      if (match(line, /(^|[^A-Za-z0-9_$])(get|set)[ \t]+#?[A-Za-z_$][A-Za-z0-9_$]*/)) {
        s = substr(line, RSTART, RLENGTH); sub(/^[^A-Za-z0-9_$]?(get|set)[ \t]+/, "", s)
        sub(/^#/, "", s); put(s)
      }
      # A method or constructor SIGNATURE, told from a CALL by what follows its OWN parameter list: a body
      # `{` or a return type. A call is followed by `;`, `,`, `)` or a member access, and matches neither --
      # but only once the list is found by its matching parenthesis, as the walk below does, rather than by
      # any `)` that happens to precede a colon. A wrapped CALL whose parameter list spills to the next line
      # (`bufferList(` alone on a line) is deliberately not accepted as a signature, since accepting it
      # would produce false declarations under `web/` and no genuine signature.
      if (match(line, /^[ \t]*((export|default|declare|abstract|async|static|readonly|public|private|protected|override)[ \t]+)*#?[A-Za-z_$][A-Za-z0-9_$]*[ \t]*(<[^<>]*>)?[ \t]*\(/)) {
        head = substr(line, RSTART, RLENGTH)
        # **NOTHING AFTER THE `:` OF A RETURN TYPE IS TESTED, SO A SIGNATURE WHOSE RETURN TYPE IS AN OBJECT
        # TYPE IS NOT LOST**, although an object type carries `{`, `}` and `;`:
        # `scratchSeedOf(s: SessionId): { text: string; collapsed: boolean } | null`. A test that forbade
        # `;` there would lose both `scratchSeedOf` (`pane-host.ts`) and `editorSeed` (`scratch.ts`), which
        # return such a type.
        #
        # **THE WALK, NOT A `\)`-ANCHORED REGEX, FINDS THE PARENTHESIS TO TEST.** A `\)`-anchored regex is
        # satisfied by ANY `)` on the line, so `setTimeout((): void => { tick() }, DEBOUNCE_MS)` would read
        # as declaring `setTimeout`, through the typed arrow inside it; `render(busy ? spinner() : view())`
        # through the ternary; and the multi-line `register(id, (e: Event): void => {` through the body-brace
        # test, whose head parenthesis does not even close on its line. So the walk below counts parenthesis
        # depth from the head `(` -- the last character of HEAD, since the match is anchored at column 1 --
        # to its MATCHING `)`, and only what follows THAT is tested for a return type or a body. An unclosed
        # head leaves AFTER empty, which the test cannot match. The regex guard in front of the walk is a
        # necessary condition of that test and only keeps the walk off lines that could never pass. Strings
        # and comments are already blanked and cannot miscount; a regex literal holding an unbalanced
        # parenthesis is not, and loses the signature: `strip(s = /\(/): string {` yields nothing.
        #
        # A body brace need not end the line, so the methods of the fake `panes.test.ts` builds, written
        # `setDetached(_d: boolean) {},`, are read as the real declarations they are.
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
      # A field, a property, or an interface or type member. **MANY OF THE TREE'"'"'S SITES REST ON THIS RULE
      # ALONE**, and the audit of them is why it is here rather than dropped as loose: this codebase
      # declares methods as object-literal properties holding arrow functions, and shapes as interface
      # members, and dropping the rule reddens those correct citations. The `style.css` citation of
      # `BufferRow.term` rests on the member alone, not on the local `const term` in `buffer-list.ts`.
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
# THAN IN A TODO.** By basename alone, `lib.rs`, `syntax.rs`, `asm.rs` and `decode.rs` each name
# more than one file in this workspace. An unresolvable citation is reported, not silently skipped.
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
  # Sets a global rather than printing: a command substitution at the call site is a fork per SITE
  # even when the answer is already cached.
  RESOLVED="${RESOLVE_CACHE[$key]}"
}

# The resolution itself, split out so `resolve_cited` can memoize it. `TRACKED_TEXT` is the tracked
# list as one string, built once — rebuilding it per site would cost more than every other part of the
# scan put together.
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
# **THE CACHE IS ALSO WHAT KEEPS `grep` OFF THE END OF A PIPE, AND THAT IS NOT A CONVENIENCE.** In
# `strip_code ... | grep -qwF`, `grep -q` exits at the FIRST match, `awk` upstream dies of SIGPIPE, and
# `set -o pipefail` — three characters in this file's own `set` line — reports the pipeline as failed.
# So every site whose symbol IS present would fail exactly like a site whose symbol is absent, and the
# gate would be at its reddest precisely where the tree is cleanest.
stripped_of() {
  local file="$1"
  if [[ -z ${STRIP_CACHE[$file]+set} ]]; then
    STRIP_CACHE[$file]="$(strip_code "$file" "$(lang_of "$file")")"
  fi
}

declare -A DECL_CACHE=()

# The names $1's CODE declares, newline-delimited, computed once per file. Same shape as
# `stripped_of` and for the same reason.
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
  # **A REASSIGNMENT LETS A BINDING SATISFY THE QUALIFIED FORM.** `web/src/compile.ts` emits `timer`
  # twice, from `let timer` behind the tag and from `timer = setTimeout(...)` plain, through the property
  # rule; so this function answers DECLARED for that file and a qualified `Type.timer`. The header lists
  # the path with the other two that reach the same place.
  #
  # **THE ASYMMETRY IS A CHOICE WITH A PRICE.** Sites that pass ONLY through `local:` include module-scope
  # bindings (`export const`, unexported `const`, `let`) that the tag nonetheless treats as locals, so a
  # QUALIFIED citation of one would be a false positive. The tree holds none. The cheap rule stands until a
  # real qualified citation of a module-scope `const` exists to pay for a better one.
  if [[ $stem == *[.:]* ]]; then qualified=1; else qualified=0; fi
  bare="${stem}"
  bare="${bare##*[.:]}"
  bare="${bare#\#}"
  # A symbol that is not an identifier is not something this gate can resolve; pass it rather than
  # invent a verdict about it.
  if [[ -z $bare || ! $bare =~ ^[A-Za-z_] ]]; then
    return 0
  fi
  # CSS AND HTML HAVE NO DECLARATION EXTRACTOR, and fall back to the presence rule: `ATTRIBUTION_RE`
  # admits both extensions. The fallback is asserted in `--self-test` so it is a decision rather
  # than an accident.
  case "$file" in
    *.css | *.html)
      stripped_of "$file"
      # A bash word test rather than a `grep`, so no process per site.
      [[ ${STRIP_CACHE[$file]} =~ (^|[^A-Za-z0-9_])"$bare"([^A-Za-z0-9_]|$) ]]
      return
      ;;
  esac
  declarations_of "$file"
  # A glob rather than a regex, and a literal `$bare` because it is quoted: no fork, and no regex over
  # whole-file text. Strictly cheaper than a presence test over the file's text.
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
# **IT SETS GLOBALS RATHER THAN PRINTING, AND THAT IS WHAT KEEPS THE SELF-TEST HONEST.** A printing version
# costs a fork per SITE, which tempts inlining the parse into the scan loop for speed and leaving this
# function reachable only from `--self-test` — two implementations of one idea, with the tested one no
# longer the one that runs. The gate's whole subject is a claim that stops matching what it describes, so
# shipping that would be the defect it exists to catch, in the file that catches it.
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
  # ABLE TO FAIL.** A comment of PROSE mentioning `forward` fires no declare rule whether or not it is
  # stripped, so with one the check would stay green with all comment stripping deleted — asserting the
  # declaration rule and not the stripper it is named for. Both comment forms are here because the two
  # halves of the stripper can be lost separately: deleting the `//` handling reddens this check through
  # the first line, deleting the `/*` handling through the second. Do not soften either to prose. The
  # barrel fixture below is shaped against the same defect.
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
  # A Rust file whose ONLY mention of the symbol is a call at statement position. This is the
  # archetype: `lower_tm.rs` calling `Encoding::push_frame`, which `encoding.rs` declares.
  printf 'pub fn lower() {\n    push_frame(1);\n}\n' >"$tmp/caller.rs"
  # A Rust file that only CALLS the symbol but BINDS the bare name to the result. This is the exact
  # shape the archetype has in `tm/lower_tm.rs` — `let overflow = b.overflow();` against a
  # `Builder::overflow` declared in `tm/build.rs` — and a declaration rule that reads a local binding as
  # a declaration passes it: the binding makes the CALL SITE read as the declaring file.
  #
  # **BOTH DIRECTIONS ARE ASSERTED BELOW, AND THE PAIR IS WHAT MAKES EITHER MEANINGFUL.** Rejecting
  # the qualified form is the rule; accepting the BARE form is the constraint it respects, because
  # three live sites cite `examples/tm_demo.rs` for `first_order` and `higher_order`, bare, and those
  # names are `let` bindings and nothing else. A rule that rejected both would be green on this
  # fixture and red on the tree.
  printf 'pub fn caller(b: &Builder) {\n    let overflow = b.overflow();\n}\n' >"$tmp/binder.rs"
  # A TypeScript barrel: it re-exports and declares nothing, which `types.ts` says of itself.
  # THE SHAPE HERE IS NOT ARBITRARY: `export type { Owner } from ...` puts a `{` straight after
  # `type`, so no declare rule ever fires on it and the assertion below passes whether or not the
  # import/export-from bail exists. `export { type Owner } from ...` is the inline-type-modifier
  # form, and it DOES reach the keyword declare rule, so only this shape can actually exercise the
  # bail. Do not simplify this to the bare `export type { ... } from` form.
  printf "export { type Owner } from '../bindings/Owner'\nexport const unrelated = 1\n" >"$tmp/barrel.ts"
  # A `wasm_bindgen` js_name MINTS the JS name, so the Rust file IS where it is declared.
  printf '#[wasm_bindgen(js_name = linkIndex)]\npub fn link_index(&self) -> usize { 0 }\n' >"$tmp/bindgen.rs"
  # An object-literal method, read by the property rule, which many of the tree's sites rest on alone.
  printf 'export const make = () => ({\n  detach: (step: number) => {},\n})\n' >"$tmp/factory.ts"
  # A cited CSS file, for which there is no declaration extractor and the presence rule stands.
  printf '.linked {\n  color: red;\n}\n' >"$tmp/style.css"

  # **THESE DECLARE RULES GET A FIXTURE OF THEIR OWN** (the Rust type-keyword, field and variant rules,
  # the TypeScript signature rule, `macro_rules!`, the TypeScript `import` bail, and `get`/`set`).
  # Deleting a rule the battery does not exercise leaves `--self-test` at 0 failures, so the live
  # citations resting on it are guarded only by today's tree, and a rule carrying none (`macro_rules!`,
  # the TypeScript `import` bail, `get`/`set`) can go with nothing noticing. The `()` strip in
  # `symbol_declared_in` is not a declare rule; `good_parens` below, a `forward()` citation of the
  # `owner.ts` fixture above, is its check. Each fixture is built so that ONE rule emits the asserted
  # name and no other rule in the same file can.
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
  # its return type carries braces AND a `;`.
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

  # **THE TYPESCRIPT HALF OF THE QUALIFIED/BARE SPLIT NEEDS A FIXTURE OF ITS OWN.** The qualified-rejection
  # checks above use the Rust `binder.rs`, so moving the `const`/`let`/`var` rule from `put_local` to `put`
  # would leave them green. This is that fixture in TypeScript, the same call bound to the same bare name,
  # asserted in both directions for the reason `binder.rs` gives. `Builder` qualifies with `.` here where
  # `binder.rs` uses `::`.
  printf 'export function caller(b: Builder) {\n  const overflow = b.overflow()\n}\n' >"$tmp/tsbinder.ts"
  # The other direction of the same split, per member rule. A bare citation passes on a tagged name, so
  # with only BARE TypeScript member checks, moving the SIGNATURE or PROPERTY rule behind `put_local`
  # would leave this battery green. So one member per rule is cited QUALIFIED, as the Rust field check
  # is: the property rule alone emits `timer`, and the signature rule alone emits `subscribe`.
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
  # Two calls the signature rule must not read as declarations. Neither head parenthesis is followed
  # by `:` or `{`: `setTimeout` closes at the end of its line, and `register` does not close on its line
  # at all. Each carries a typed arrow.
  printf '%s\n' \
    'setTimeout((): void => { tick() }, DEBOUNCE_MS)' \
    'register(id, (e: Event): void => {' \
    '  apply(e)' \
    '})' >"$tmp/calls.ts"

  local good bad_moved bad_parens good_parens bad_raw bad_bound
  good="// see ${q}owner.ts${q}'s ${q}forward${q} for the handler"
  bad_moved="// see ${q}talker.ts${q}'s ${q}forward${q} for the handler"
  bad_parens="// see ${q}talker.ts${q}'s ${q}forward()${q} for the handler"
  # **THE POSITIVE DIRECTION OF THE `()` STRIPPER.** The check above, named for blind sub-case 3, proves
  # only that `ATTRIBUTION_RE` admits the `sym()` form: it expects 0, which a stripper that has lost
  # `stem="${symbol%\(\)}"` still returns, because a symbol spelled `forward()` is absent from the
  # declaration set either way. This citation names the file that DOES declare `forward`, so it can
  # only pass once the `()` has been stripped.
  good_parens="// see ${q}owner.ts${q}'s ${q}forward()${q} for the handler"
  bad_raw="// see ${q}raw.rs${q}'s ${q}needle${q} for the text"
  # End-to-end, and it carries the `::` the other citations here do not: it is the only check that
  # proves `ATTRIBUTION_RE` admits a path-qualified symbol at all. Drop the `:` from that
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

  # Blind sub-case 2. A file that only IMPLEMENTS a foreign trait does not declare it, so `Drop` cannot
  # be the probe: that assertion would pass for the wrong reason. The defect it guards is that a `'`
  # read as a char-literal opener leaks the "string" state ACROSS the line boundary — line 2 below
  # carries THREE lifetimes, an odd count — and blanks the declaration on the line after it. Measured:
  # the real stripper keeps `after_the_lifetimes`, a naive one loses it.
  printf '%s\n%s\n%s\n' \
    "pub struct Holder<'a> { pub inner: &'a str }" \
    "impl<'a> AsRef<str> for Holder<'a> { fn as_ref(&self) -> &'a str { self.inner } }" \
    "pub fn after_the_lifetimes() -> usize { 1 }" >"$tmp/core.rs"
  assert_declared 'a declaration after an odd run of Rust lifetimes survives stripping' \
    "$tmp/core.rs" 'after_the_lifetimes' 1

  # **THE MIRROR IMAGE OF THE CHECK ABOVE.** That check fails when every `'` opens a string, and passes
  # when the apostrophe branch is deleted outright, because a `'` reaching no branch is plain code. But
  # with the branch gone, the `"` INSIDE a char literal `'"'` opens a string, and that string runs to the
  # next `"` in the file, blanking every line between — and the scan need not notice, since no citation
  # has to name a file whose declarations that changes. This line is the shape, and `after_quote` is the
  # declaration it swallows.
  printf '%s\n' "pub fn quote_char() -> char { '\"' }" 'pub fn after_quote() {}' >"$tmp/quote.rs"
  assert_declared 'a declaration after a Rust char literal of a double quote survives stripping' \
    "$tmp/quote.rs" 'after_quote' 1

  printf '%d checks, %d failures\n' "$checks" "$failures"
  ((failures == 0))
}

mapfile -t TRACKED < <(git ls-files)
readonly TRACKED
# The tracked list as one string. Built ONCE: rebuilding it per site would cost more than every other
# part of the scan put together.
TRACKED_TEXT="$(printf '%s\n' "${TRACKED[@]}")"
readonly TRACKED_TEXT

if [[ ${1:-} == --self-test ]]; then
  self_test
else
  scan
fi
