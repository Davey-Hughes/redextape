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
# **THE SECOND CHECK IS THE ONE THAT EARNS THE SCRIPT.** Every editor loads a parser by looking up the
# C symbol `tree_sitter_<name>`, so the four keys of that file's `GRAMMARS` table have to equal the
# four symbols `grammars/*/src/parser.c` export. The file's own comment says getting one wrong "loads a
# different language rather than failing to find one" — a silent, wrong-colour failure that no test in
# this repository could otherwise see, because nothing here loads those parsers by name. A `luac -p`
# would not catch it; a human reading the table would not catch it either, since both spellings look
# plausible.
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

  echo "self-test passed: a syntax error is caught and a valid file is not"
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

echo "check-lua: $count tracked Lua file(s) parse under $LUA_CMD; ${#declared[@]} GRAMMARS keys match the exported parser symbols."
