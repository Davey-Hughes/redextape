#!/usr/bin/env bash
# Gate the tracked Lua. Syntax, and the one invariant `plugin/redextape.lua` calls load-bearing.
#
# CI invokes this same script (.forgejo/workflows/ci.yml) and so does the pre-commit hook
# (.pre-commit-config.yaml), so the local and CI gates cannot drift — the convention
# `scripts/check-all.sh` states and the three sibling `check-*.sh` scripts already follow.
#
#   scripts/check-lua.sh              # scan the tracked Lua
#   scripts/check-lua.sh --self-test  # prove the detector still detects
#
# **WHY THIS EXISTS.** `plugin/redextape.lua` arrived in a repository that gates every other language
# it ships — `cargo fmt` and `clippy` on `*.rs`, `biome ci` and `tsc` on `web/` — and was covered by
# nothing at all. Its own commit's pre-commit run reported `(no files to check) Skipped` for all four
# of those hooks, which is the honest reading of a tree with no Lua gate in it. A syntax error would
# have shipped green.
#
# **THE CHECKS AFTER THE FIRST ARE THE ONES THAT EARN THE SCRIPT, AND BOTH HAVE THE SAME SHAPE:** a
# list in `plugin/redextape.lua` that must equal a list somewhere else in the tree, where disagreeing
# is silent rather than loud.
#
# **`GRAMMARS` against the parser symbols.** Every editor loads a parser by looking up the C symbol
# `tree_sitter_<name>`, so the four keys of that file's `GRAMMARS` table have to equal the four
# symbols `grammars/*/src/parser.c` export. The file's own comment says getting one wrong "loads a
# different language rather than failing to find one" — a silent, wrong-colour failure that no test in
# this repository could otherwise see, because nothing here loads those parsers by name. A `luac -p`
# would not catch it; a human reading the table would not catch it either, since both spellings look
# plausible.
#
# **`FILETYPES` against the `languageId`s the server serves.** The same failure one layer up. Neovim
# attaches `redextape-lsp` to every filetype in that table and sends the buffer's filetype as the LSP
# `languageId`; `Language::from_language_id` in `crates/redextape-lsp/src/language.rs` answers `None`
# for anything it does not know. So a fifth form added to the plugin and forgotten in the server gets
# a language server that attaches, tracks the document, publishes an empty diagnostic list and answers
# `null` to every format request — indistinguishable, from the editor, from a file with nothing wrong
# with it. Nothing on either side fails: the Lua is valid, the Rust compiles, and every test of both
# still passes.
#
# **THE INTERPRETER IS PROBED RATHER THAN NAMED, AND THE FIRST DRAFT NAMING ONE FAILED IN CI.** It ran
# `nvim --headless` with `loadfile`, on the reasoning that Neovim is required to use any of this
# anyway. True on a developer's machine and false on the runner: `catthehacker/ubuntu:act-latest`
# carries node, git and curl, and no Neovim and no Lua at all. The self-test caught it rather than the
# scan — with the interpreter missing, "a syntactically invalid file is rejected" passes for the wrong
# reason and "a valid file is accepted" fails, which is the pair working exactly as the sibling gates'
# comments say a self-test should.
#
# So any Lua-capable interpreter will do and the script takes the first one it finds. If it finds
# none it FAILS rather than skipping: a gate that quietly does less in one of the two places it runs
# is the drift `scripts/check-all.sh` says these scripts exist to prevent.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "check-lua: $*" >&2
  exit 1
}

# Ordered by how likely it is to be the cheapest thing present, not by preference — every one of them
# compiles without executing, so they agree on what a syntax error is.
LUA_CMD=""
for cand in luac5.4 luac5.3 luac5.1 luac luajit lua5.4 lua5.3 lua5.1 lua nvim; do
  if command -v "$cand" >/dev/null 2>&1; then
    LUA_CMD="$cand"
    break
  fi
done
[ -n "$LUA_CMD" ] || fail "no Lua-capable interpreter found (tried luac*, luajit, lua*, nvim).
  Install any one of them — on Debian/Ubuntu, 'apt-get install -y lua5.4' is enough."

# The filetypes the plugin attaches the server to, against the `languageId`s the server answers.
# Both lists are read out of their own file rather than restated here: a third copy in this script
# would be one more place to forget. Prints the disagreement and returns non-zero; the caller decides
# what to do with it, which is what lets the self-test drive it over constructed files.
#
# An extraction that comes back EMPTY is a failure, not a pass. Renaming either list would otherwise
# turn this check off silently, which is the failure mode it exists to catch.
filetypes_agree() {
  local plugin="$1" lang="$2"
  local -a attached served

  # awk rather than a `sed` range: `FILETYPES` is written on one line, and `sed -n '/{/,/}/p'` starts
  # looking for its end on the NEXT line, so it would run on past the table it was given.
  mapfile -t attached < <(awk '/^local FILETYPES = \{/ { f = 1 } f { print } f && /\}/ { exit }' "$plugin" |
    grep -o '"[A-Za-z_][A-Za-z0-9_]*"' | tr -d '"' | sort)

  # Only the arms that RESOLVE. `_ => None` is the fallback, not a filetype.
  mapfile -t served < <(awk '/fn from_language_id/ { f = 1 } f && /^    \}$/ { exit } f { print }' "$lang" |
    sed -n 's/^ *"\([A-Za-z_][A-Za-z0-9_]*\)" => Some(.*/\1/p' | sort)

  if [ "${#attached[@]}" -eq 0 ]; then
    echo "found no FILETYPES entries in $plugin — has the table been renamed?"
    return 1
  fi
  if [ "${#served[@]}" -eq 0 ]; then
    echo "found no resolving languageId arms in $lang — has from_language_id been reshaped?"
    return 1
  fi
  if [ "${attached[*]}" != "${served[*]}" ]; then
    printf '%s\n' "$plugin's FILETYPES do not match the languageIds $lang serves" \
      "  attached by the plugin: ${attached[*]}" \
      "  served by the server:   ${served[*]}"
    return 1
  fi
  return 0
}

lua_syntax_ok() {
  # Compile without executing, which is what makes this safe to run over a plugin file whose whole
  # purpose is to register autocmds.
  case "$LUA_CMD" in
    luac*) "$LUA_CMD" -p "$1" 2>&1 ;;
    nvim)
      nvim --headless \
        -c "lua local f, e = loadfile('$1'); if not f then io.stderr:write(tostring(e)); vim.cmd('cq') end" \
        -c 'qa!' 2>&1
      ;;
    *) "$LUA_CMD" -e "local f, e = loadfile('$1'); if not f then io.stderr:write(tostring(e)); os.exit(1) end" 2>&1 ;;
  esac
}

# ---------------------------------------------------------------------------- self-test
if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp:?}"' EXIT

  printf 'local x = = 1\n' >"$tmp/broken.lua"
  if lua_syntax_ok "$tmp/broken.lua" >/dev/null 2>&1; then
    fail "self-test: a syntactically invalid file was accepted"
  fi

  printf 'local x = 1\nreturn x\n' >"$tmp/fine.lua"
  if ! lua_syntax_ok "$tmp/fine.lua" >/dev/null 2>&1; then
    fail "self-test: a valid file was rejected"
  fi

  # The FILETYPES/languageId check, proved the same way: construct a disagreeing pair and confirm it
  # is rejected. A check the self-test does not exercise is a check nothing holds.
  cat >"$tmp/language.rs" <<'RS'
    pub fn from_language_id(id: &str) -> Option<Self> {
        match id {
            "redextape" => Some(Language::Redextape),
            "redextape_tm" => Some(Language::Tm),
            _ => None,
        }
    }
RS

  printf 'local FILETYPES = { "redextape", "redextape_tm" }\n' >"$tmp/plugin.lua"
  if ! filetypes_agree "$tmp/plugin.lua" "$tmp/language.rs" >/dev/null; then
    fail "self-test: an agreeing FILETYPES/languageId pair was rejected"
  fi

  # A fifth form attached by the plugin and forgotten in the server — the drift this check is for.
  printf 'local FILETYPES = { "redextape", "redextape_tm", "redextape_bf" }\n' >"$tmp/plugin.lua"
  if filetypes_agree "$tmp/plugin.lua" "$tmp/language.rs" >/dev/null; then
    fail "self-test: a filetype the server does not serve was accepted"
  fi

  # And the other direction, which is just as silent: served, never attached, so never reached.
  printf 'local FILETYPES = { "redextape" }\n' >"$tmp/plugin.lua"
  if filetypes_agree "$tmp/plugin.lua" "$tmp/language.rs" >/dev/null; then
    fail "self-test: a languageId no filetype attaches to was accepted"
  fi

  # Neither list may go missing quietly: an empty extraction must fail rather than pass vacuously.
  printf 'local OTHER = { "redextape", "redextape_tm" }\n' >"$tmp/renamed.lua"
  if filetypes_agree "$tmp/renamed.lua" "$tmp/language.rs" >/dev/null; then
    fail "self-test: a renamed FILETYPES table passed vacuously"
  fi
  printf 'local FILETYPES = { "redextape", "redextape_tm" }\n' >"$tmp/plugin.lua"
  printf 'fn nothing_of_the_sort() {}\n' >"$tmp/reshaped.rs"
  if filetypes_agree "$tmp/plugin.lua" "$tmp/reshaped.rs" >/dev/null; then
    fail "self-test: a reshaped from_language_id passed vacuously"
  fi

  echo "self-test passed: a syntax error is caught, a valid file is not, and a FILETYPES/languageId \
disagreement is rejected in both directions while a renamed list fails rather than passing empty"
  exit 0
fi

# ---------------------------------------------------------------------------- syntax
count=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if ! out="$(lua_syntax_ok "$f")"; then
    fail "syntax error in $f: $out"
  fi
  count=$((count + 1))
done < <(git ls-files '*.lua')

# ---------------------------------------------------------------------------- symbol agreement
plugin="plugin/redextape.lua"
[ -f "$plugin" ] || fail "$plugin is missing; this script exists for it"

# The table keys, in the order the file writes them.
mapfile -t declared < <(sed -n '/^local GRAMMARS = {$/,/^}$/p' "$plugin" |
  sed -n 's/^  \([A-Za-z_][A-Za-z0-9_]*\) = .*/\1/p' | sort)

# The symbols the committed parsers actually export.
mapfile -t exported < <(grep -ho 'tree_sitter_[a-z_]*' grammars/*/src/parser.c |
  sed 's/^tree_sitter_//' | sort -u)

if [ "${#declared[@]}" -eq 0 ]; then
  fail "found no GRAMMARS keys in $plugin — has the table been renamed?"
fi

if [ "${declared[*]}" != "${exported[*]}" ]; then
  fail "$plugin's GRAMMARS keys do not match the exported parser symbols
  declared: ${declared[*]}
  exported: ${exported[*]}
  Every editor loads a parser as tree_sitter_<name>, so a mismatch loads the wrong language silently."
fi

# ------------------------------------------------------------------- filetype/languageId agreement
lang="crates/redextape-lsp/src/language.rs"
[ -f "$lang" ] || fail "$lang is missing; the FILETYPES check reads it"

if ! disagreement="$(filetypes_agree "$plugin" "$lang")"; then
  fail "$disagreement
  Neovim sends the buffer's filetype as the LSP languageId, so a filetype the server does not serve
  attaches, tracks the document, publishes no diagnostics and answers null to formatting — the same
  silent wrong answer the GRAMMARS check above exists to prevent, one layer up."
fi

echo "check-lua: $count tracked Lua file(s) parse under $LUA_CMD; ${#declared[@]} GRAMMARS keys match the exported parser symbols, and $plugin's FILETYPES match the languageIds $lang serves."
