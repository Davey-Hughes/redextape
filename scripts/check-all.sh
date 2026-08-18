#!/usr/bin/env bash
# The full feature-matrix gate: every config the crate supports, in one command.
#
# CI invokes this same script (.forgejo/workflows/ci.yml), so the local and CI gates cannot drift.
# The pre-commit hooks deliberately do NOT run it — they stay fast: fmt and clippy on a Rust change,
# biome and tsc on a web/ one, plus two unscoped tree-wide gates (control bytes, `file:line`
# citations) on every commit. Six hooks; this is the before-a-merge check.
#
#   scripts/check-all.sh                  # everything: base, LLVM and browser configs
#   scripts/check-all.sh --no-llvm        # skip LLVM (no toolchain installed)
#   scripts/check-all.sh --no-browser     # skip the browser leg (no Chrome, or no time for it)
#   scripts/check-all.sh --llvm-only      # ONLY the LLVM configs — NOT a full gate on its own
#   scripts/check-all.sh --browser-only   # ONLY the browser leg — NOT a full gate on its own
#   scripts/check-all.sh --list           # print the legs the mode selects; run nothing
#
# --llvm-only exists because CI's `rust-llvm` job invoked this script with no flag, and no flag is
# `--no-llvm` PLUS the LLVM configs by construction — so that job recompiled every non-LLVM config
# the `rust` job had already run, from a different cache key. See
# docs/superpowers/specs/2026-08-04-ci-scope-filters-design.md §2.2.
#
# THE BROWSER TIER IS THE SAME SHAPE OF ANSWER TO THE SAME SHAPE OF PROBLEM, and it is worth saying
# why it is a TIER rather than a separate script. `wasm-pack test` needs a browser, which not every
# machine running this gate has — exactly the position LLVM was in. LLVM was not excluded for that;
# it was given a tier and an opt-out. A separate `check-browser.sh` would sit OUTSIDE the union
# invariant below, so "full gate" would quietly stop meaning full, and it would be a script nobody
# runs. The browser leg covers what nothing else can: the wasm32 rows below check that the crates
# BUILD for wasm32, while `#[wasm_bindgen]`'s generated glue and `serde-wasm-bindgen`'s marshalling
# only execute in a browser. `session.rs` is natively tested precisely so logic lives outside that
# shell — which means a wasm-bindgen or serde-wasm-bindgen bump can break the boundary with every
# other leg green.
#
# This gate runs the FAST test tier only. The slow tier (exhaustive sweeps, marked
# `#[ignore = "slow tier: ..."]`) has its own script and its own CI job: scripts/check-slow.sh.
# Kept separate deliberately — a merge gate that takes minutes stops being run before merges.
set -euo pipefail

run() { echo; echo "==> $*"; "$@"; }
usage() {
  echo "usage: scripts/check-all.sh [--no-llvm] [--no-browser] [--llvm-only | --browser-only] [--list]" >&2
  exit 2
}

# Parsed up front so a typo (`--no-llvmm`) fails immediately rather than silently falling through to
# a full run — a flag that quietly does the opposite of what was asked is the same class of bug as a
# gate that quietly covers less than it claims.
#
# THREE INDEPENDENT WANTS, NOT ONE `mode`, and the change is what a third tier forces. With two tiers
# a single `mode` variable could name every reachable state; with three it cannot, because "skip LLVM
# but keep the browser" and "skip both" are different runs and CI needs to ask for each. The `--no-*`
# flags subtract, the `--x-only` flags select exactly one tier, and the conflicts below are rejected
# rather than silently resolved.
list_only=0
only=""
no_llvm=0
no_browser=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-llvm)    no_llvm=1; shift ;;
    --no-browser) no_browser=1; shift ;;
    --llvm-only)
      [ -z "$only" ] || [ "$only" = llvm ] \
        || { echo "error: --llvm-only and --browser-only are exclusive" >&2; usage; }
      only=llvm; shift ;;
    --browser-only)
      [ -z "$only" ] || [ "$only" = browser ] \
        || { echo "error: --llvm-only and --browser-only are exclusive" >&2; usage; }
      only=browser; shift ;;
    --list)
      list_only=1; shift ;;
    *)
      echo "error: unknown argument: $1" >&2; usage ;;
  esac
done

# `--llvm-only --no-llvm` asks for a run whose only tier is one it also excludes: it would cover
# nothing but the `both` rows and still exit 0, which is the "green run that covered nothing" defect
# check_legs guards against one level down. Rejected rather than resolved in either direction.
#
# WRITTEN AS `if`, NOT `[ ... ] && { ... }`, and that is not a style preference. Under `set -e` a
# bare `A && B` statement whose A is false makes the LIST's status 1 and aborts the script — so the
# guard would kill every ordinary run, the one case it is supposed to wave through.
if [ "$only" = llvm ] && [ "$no_llvm" -eq 1 ]; then
  echo "error: --llvm-only and --no-llvm contradict each other" >&2; usage
fi
if [ "$only" = browser ] && [ "$no_browser" -eq 1 ]; then
  echo "error: --browser-only and --no-browser contradict each other" >&2; usage
fi

case "$only" in
  llvm)    want_base=0; want_llvm=1; want_browser=0 ;;
  browser) want_base=0; want_llvm=0; want_browser=1 ;;
  *)       want_base=1
           want_llvm=1
           want_browser=1
           if [ "$no_llvm" -eq 1 ]; then want_llvm=0; fi
           if [ "$no_browser" -eq 1 ]; then want_browser=0; fi ;;
esac

# THE LEG TABLE — the single source of truth for what this gate covers.
#
# Each row is `tier|kind|cargo args`. `both` rows run in every mode, `base` rows are exactly what
# --no-llvm runs, `llvm` rows are exactly what --llvm-only runs. So
#
#     --no-llvm  ∪  --llvm-only  ≡  full
#
# holds BY CONSTRUCTION — the modes select {both,base} and {both,llvm}, whose union is the whole
# table — rather than by anyone remembering to keep three lists in step. Three hand-maintained lists
# drift, and a mode that quietly covers less than its name claims is the exact defect this gate
# exists to catch. `--list` makes the property checkable from outside the script; check_legs() below
# catches the two things --list cannot: a row tagged with a tier no mode selects, and a row tagged
# with a kind do_leg does not dispatch on.
#
# ROW ORDER IS RUN ORDER. Cheap always-first legs (fmt, clippy) stay at the top of their tier so a
# formatting slip fails in seconds rather than after a feature matrix.
#
# Every config gets clippy AND tests; a config that is built but never tested is a blind spot. The
# default (`cranelift`) config is covered by the --workspace pair.
#
# `--features llvm` is additive to the default `cranelift`, so it is NOT a distinct build from
# `--features "cranelift llvm"`; the genuinely LLVM-only config is --no-default-features --features llvm.
LEGS=(
  "both|fmt|"
  "base|wasmprobe|"
  "base|clippy|--workspace --all-targets"
  "base|test|--workspace"
  "base|clippy|-p redextape-core --features serde --all-targets"
  "base|test|-p redextape-core --features serde"
  "base|wasm|-p redextape-core --lib"
  "base|wasm|-p redextape-core --lib --features serde"
  "base|wasm|-p redextape-wasm --lib"
  "base|build|-p redextape-native --no-default-features"
  "base|clippy|-p redextape-native --no-default-features --all-targets"
  "base|test|-p redextape-native --no-default-features"
  "llvm|probe|"
  "llvm|clippy|-p redextape-native --features llvm --all-targets"
  "llvm|test|-p redextape-native --features llvm"
  "llvm|clippy|-p redextape-native --no-default-features --features llvm --all-targets"
  "llvm|test|-p redextape-native --no-default-features --features llvm"
  # The browser tier is one leg, and the probe leads it for the same reason `llvm|probe|` leads the
  # LLVM tier: a missing browser should fail in seconds, not after wasm-pack has built a module.
  "browser|browserprobe|"
  "browser|browser|crates/redextape-wasm"
)

# A row tagged with a tier no mode selects would vanish from every run while still LOOKING covered.
# Empty tiers are the same defect one step earlier: --llvm-only that runs nothing still exits 0.
#
# A row tagged with a kind do_leg does not dispatch on passes --list and lets whichever mode does
# NOT include that row finish green; the typo only fails when the other mode reaches the row, after
# everything before it has already run. Validated against the same set do_leg dispatches on.
check_legs() {
  local row tier kind n_base=0 n_llvm=0 n_browser=0
  for row in "${LEGS[@]}"; do
    tier="${row%%|*}"; kind="${row#*|}"; kind="${kind%%|*}"
    case "$tier" in
      both) ;;
      base) n_base=$((n_base + 1)) ;;
      llvm) n_llvm=$((n_llvm + 1)) ;;
      browser) n_browser=$((n_browser + 1)) ;;
      *) echo "error: leg tagged with unknown tier '$tier': $row" >&2; exit 1 ;;
    esac
    case "$kind" in
      fmt|clippy|build|test|probe|wasmprobe|wasm|browserprobe|browser) ;;
      *) echo "error: leg tagged with unknown kind '$kind': $row" >&2; exit 1 ;;
    esac
  done
  [ "$n_base" -gt 0 ] || { echo "error: no base-tier legs — --no-llvm would cover nothing" >&2; exit 1; }
  [ "$n_llvm" -gt 0 ] || { echo "error: no llvm-tier legs — --llvm-only would cover nothing" >&2; exit 1; }
  [ "$n_browser" -gt 0 ] || { echo "error: no browser-tier legs — --browser-only would cover nothing" >&2; exit 1; }
}
check_legs

selects() {
  case "$1" in
    both)    return 0 ;;
    base)    [ "$want_base" -eq 1 ] ;;
    llvm)    [ "$want_llvm" -eq 1 ] ;;
    browser) [ "$want_browser" -eq 1 ] ;;
    *)       echo "error: leg tagged with unknown tier '$1'" >&2; exit 1 ;;
  esac
}

if [ "$list_only" -eq 1 ]; then
  for row in "${LEGS[@]}"; do
    tier="${row%%|*}"; rest="${row#*|}"; kind="${rest%%|*}"; argstr="${rest#*|}"
    selects "$tier" || continue
    printf '%s\t%s\t%s\n' "$tier" "$kind" "$argstr"
  done
  exit 0
fi

# THE RUNNER IS cargo-nextest, not `cargo test`. `cargo test` runs the 22 test binaries ONE AT A TIME
# and shares threads only WITHIN a binary; nextest schedules every test from every binary in one
# parallel pool. Measured on this suite (2026-07-28, 12 logical CPUs): 231.7s -> 135.2s wall, the same
# 623 tests with the same pass set, parallelism 1.39x -> 2.51x. Nothing about any test changed.
#
# A hard failure, not a fallback to `cargo test`. A gate that silently runs a different runner
# depending on what happens to be installed is a gate whose behaviour nobody can predict — and the
# fallback would be the SLOW path, so the machine least likely to notice is the one that needed the
# speed most.
#
# DEMANDED ONLY WHEN A `test` LEG IS ACTUALLY SELECTED, which `--browser-only` is the first mode to
# make matter: its two legs run `wasm-pack`, never `cargo nextest`. An unconditional guard would
# refuse a browser run on a machine that has Chrome and wasm-pack but no nextest — a precondition
# demanded for work the run does not do, which is the same defect as `ensure_browser`'s Chrome-name
# problem wearing different clothes. `--llvm-only` still needs it and still gets it: that tier has
# `test` rows.
needs_nextest=0
for row in "${LEGS[@]}"; do
  tier="${row%%|*}"; rest="${row#*|}"; kind="${rest%%|*}"
  if selects "$tier" && [ "$kind" = test ]; then needs_nextest=1; break; fi
done
if [ "$needs_nextest" -eq 1 ] && ! cargo nextest --version >/dev/null 2>&1; then
  echo "error: cargo-nextest not found (the test runner this gate uses)." >&2
  echo "  install: cargo install cargo-nextest --locked   # or: brew install cargo-nextest" >&2
  echo "  scripts/setup-dev.sh installs it too." >&2
  exit 1
fi

# NEXTEST DOES NOT RUN DOCTESTS. `cargo test` ran them as a side effect, so swapping the runner would
# silently drop them — the exact "gate covers less than its name claims" defect this project keeps
# finding. Every `test` leg therefore pairs nextest with an explicit `cargo test --doc` AT THE SAME
# FEATURE FLAGS. Keep the pairing if a leg is ever added.
#
# There is one doctest in the tree today, `ty::show` (crates/redextape-core/src/ty.rs) — the paired
# run is what actually executes it, since nextest alone cannot. Its value only grows as more `///`
# examples land.
test_cfg() { run cargo nextest run "$@"; run cargo test "$@" --doc; }

# The wasm32 target is what makes `redextape-core`'s WASM-cleanliness a CHECK rather than a claim.
#
# A HARD FAILURE, not a skip. Before this leg existed the rule was "keep [dependencies] empty", which
# is checkable in one line but is a PROXY: it is sufficient for WASM-clean and not necessary (serde
# compiles to wasm32; a proc-macro dependency cannot break a wasm32 build at all). The proxy was worth
# keeping only while nothing checked the real property — and nothing did, since `rustup target add
# wasm32-unknown-unknown` appeared in ci.yml exactly once, inside the `web` job, which was gated off.
# A gate that silently skips when the target is missing would recreate that situation with extra steps.
#
# TWO FAILURE MODES, not one. `rustup target list --installed 2>/dev/null` swallows stderr, so a
# missing or broken `rustup` reported exactly the same "target is not installed" message as a present
# rustup missing the target — and pointed at `rustup target add`, a command that does not exist on a
# box without rustup. Distro-packaged Rust without rustup is a real configuration, so rustup's
# presence is checked first and reported honestly before the target is checked at all.
#
# CALLED FROM THREE ROWS ON PURPOSE, and the redundancy is the cheaper mistake. `base|wasmprobe|` runs
# it FIRST in its tier so a missing target fails in seconds rather than after the workspace clippy and
# test legs have already run — the same reason `llvm|probe|` leads the LLVM tier. Each `wasm` row (the
# default build and the `--features serde` one) then calls it again so every leg is correct on its own:
# a future edit that drops or reorders the probe row degrades the error message, where removing this
# call would let a leg run without its precondition and fail inside cargo instead. It is a `grep`
# against a list rustup already has in memory, so running it three times costs nothing worth saving.
# `ensure_llvm_prefix` is NOT called this way for a different reason: its own guard (`if [ -z
# "${LLVM_SYS_221_PREFIX:-}" ]`) memoizes the probe, so the exported variable persists for the rest of
# the process and a repeat call would add nothing but a duplicate log line. One call suffices — that is
# why one row calls it, not that a second call would cost something.
ensure_wasm_target() {
  if ! command -v rustup >/dev/null 2>&1; then
    echo "error: rustup not found, so this gate cannot check the wasm32 build." >&2
    echo "  this project's toolchain is managed by rustup (rust-toolchain.toml); install it from https://rustup.rs" >&2
    exit 1
  fi
  if ! rustup target list --installed | grep -qx wasm32-unknown-unknown; then
    echo "error: the wasm32-unknown-unknown target is not installed (this gate checks against it)." >&2
    echo "  install: rustup target add wasm32-unknown-unknown" >&2
    echo "  scripts/setup-dev.sh installs it too." >&2
    exit 1
  fi
}

# llvm-sys locates LLVM via a version-specific variable. Honor an existing setting; otherwise probe
# the usual locations. If broadening the supported LLVM range later, derive the variable NAME from
# the selected inkwell feature rather than hardcoding 221.
#
# `/usr` is in the list because that is where most Linux distributions put LLVM (Arch, Fedora, and
# openSUSE all ship `/usr/bin/llvm-config`); without it this gate could not run its LLVM configs on
# those systems at all, and reported "no LLVM 22 found" on a machine with LLVM 22 installed.
#
# THE VERSION CHECK IS THE POINT, not decoration. Three of the four entries are UNVERSIONED
# (`/opt/homebrew/opt/llvm`, `/usr/local/opt/llvm`, `/usr`) — only `/usr/lib/llvm-22` names 22 in the
# path. Accepting an unversioned prefix on the strength of `llvm-config` merely EXISTING is how a box
# with, say, LLVM 18 at `/usr` gets handed to llvm-sys as if it were 22: the failure then surfaces as
# an llvm-sys build error naming a version nobody asked for, far from the line that chose it. Probing
# for the right LLVM and probing for any LLVM are different questions, and this asks the first.
ensure_llvm_prefix() {
  local llvm_probe_paths="/opt/homebrew/opt/llvm /usr/lib/llvm-22 /usr/local/opt/llvm /usr"
  # An explicit LLVM_SYS_221_PREFIX is deliberately NOT version-checked: setting it is a statement of
  # intent, and a wrong one already fails loudly in llvm-sys. The guard below is for the GUESS.
  if [ -z "${LLVM_SYS_221_PREFIX:-}" ]; then
    local p
    for p in $llvm_probe_paths; do
      [ -x "$p/bin/llvm-config" ] || continue
      [ "$("$p/bin/llvm-config" --version 2>/dev/null | cut -d. -f1)" = 22 ] || continue
      export LLVM_SYS_221_PREFIX="$p"; break
    done
  fi
  if [ -z "${LLVM_SYS_221_PREFIX:-}" ]; then
    echo "error: no LLVM 22 found; set LLVM_SYS_221_PREFIX or pass --no-llvm" >&2
    echo "  probed (needs bin/llvm-config reporting major version 22): $llvm_probe_paths" >&2
    exit 1
  fi
  echo "==> using LLVM at $LLVM_SYS_221_PREFIX"
}

# The browser leg runs `wasm-pack test --headless --chrome`, which needs two things this gate cannot
# assume: wasm-pack, and a Chrome that wasm-pack can find.
#
# A HARD FAILURE, not a skip — the same rule `ensure_wasm_target` follows, and for a sharper reason
# here. A browser leg that silently skips when Chrome is absent would report green on exactly the
# machines where it covered nothing, and the boundary it guards (`#[wasm_bindgen]`'s generated glue,
# `serde-wasm-bindgen`'s marshalling) is invisible to every other leg in this file. `--no-browser`
# is how a machine without Chrome asks to skip it, and asking is the point: the flag leaves a record
# in the invocation, an auto-skip leaves none.
#
# CHROME IS PROBED BY PATH BECAUSE THE NAME IS THE ACTUAL PROBLEM, and this cost real time twice
# before it was written down. wasm-pack looks for `google-chrome` (or `$CHROME_PATH`); the Debian and
# Arch packages both install the binary as `google-chrome-stable`, so a machine with Chrome fully
# installed reports it as missing. Setting CHROME_PATH from the first binary that actually exists is
# the fix, and doing it here rather than in a README is what stops the next person rediscovering it.
#
# CHROMEDRIVER IS MATCHED TO CHROME BY `ensure_chromedriver` BELOW, and this paragraph used to say the
# opposite: "chromedriver is deliberately NOT probed: wasm-pack downloads a matching one on first use."
# It does not download a matching one — it downloads the LATEST one, which is the same thing only while
# the machine's Chrome is also the latest. That stopped being true when Chrome 152 shipped, and the
# resulting failure is unusually hard to read: chromedriver starts, announces success, and the run dies
# with `http status: 404` and `driver status: signal: 9 (SIGKILL)`. See that function for the
# measurement both ways.
#
# `crates/redextape-wasm/webdriver.json` CARRIES THE TWO FLAGS THIS LEG NEEDS IN A CONTAINER, and it
# lives there because that is where wasm-bindgen-test looks (crate root, `goog:chromeOptions.args`).
# `--no-sandbox` because CI containers run as root and Chrome refuses to sandbox as root;
# `--disable-dev-shm-usage` because a container's default /dev/shm is too small and Chrome crashes
# partway through instead of failing at startup. Both are no-ops for correctness locally, which is
# why one file serves both. `headless` is NOT in that list: wasm-bindgen-test enables it by default,
# and `--headless` on the wasm-pack command line is the separate switch that keeps it on.
ensure_browser() {
  if ! command -v wasm-pack >/dev/null 2>&1; then
    echo "error: wasm-pack not found (the browser leg drives the wasm boundary through it)." >&2
    echo "  install: cargo install wasm-pack --locked" >&2
    echo "  or skip this tier: scripts/check-all.sh --no-browser" >&2
    exit 1
  fi
  ensure_wasm_target
  if [ -z "${CHROME_PATH:-}" ] && ! command -v google-chrome >/dev/null 2>&1; then
    local c
    for c in /usr/bin/google-chrome-stable /opt/google/chrome/google-chrome \
             /usr/bin/chromium /usr/bin/chromium-browser \
             "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
      if [ -x "$c" ]; then export CHROME_PATH="$c"; break; fi
    done
  fi
  if [ -z "${CHROME_PATH:-}" ] && ! command -v google-chrome >/dev/null 2>&1; then
    echo "error: no Chrome found, so the browser leg cannot run." >&2
    echo "  wasm-pack looks for \`google-chrome\` or \$CHROME_PATH; the common packages install the" >&2
    echo "  binary as \`google-chrome-stable\`, which is why this gate probes by path as well." >&2
    echo "  set it explicitly: CHROME_PATH=/path/to/chrome scripts/check-all.sh" >&2
    echo "  or skip this tier:  scripts/check-all.sh --no-browser" >&2
    exit 1
  fi
  if [ -n "${CHROME_PATH:-}" ]; then echo "==> using Chrome at $CHROME_PATH"; fi
  ensure_chromedriver
}

# A chromedriver whose MAJOR VERSION MATCHES THE INSTALLED CHROME, placed on `$PATH` so wasm-pack
# uses it instead of fetching its own.
#
# THIS EXISTS BECAUSE THE COMMENT ABOVE USED TO SAY WASM-PACK "DOWNLOADS A MATCHING ONE ON FIRST USE",
# AND THAT WAS NEVER TRUE. It downloads the LATEST one. The two agree only while the machine's Chrome
# is also the latest, which is a coincidence that expires on every Chrome release — and it expired:
# Chrome 152 shipped, wasm-pack began fetching chromedriver 152, and every machine still on 151
# started failing. The failure does not say "version mismatch"; chromedriver starts fine, reports
# `ChromeDriver was started successfully`, and then the runner gets `http status: 404` and reports
# `driver status: signal: 9 (SIGKILL)`, which reads like a crash or an OOM. MEASURED BOTH WAYS on one
# machine: driver 152 against Chrome 151 reproduces that signature byte for byte; driver 151.0.7922.138
# against Chrome 151.0.7922.137 runs 24 tests green. Major-matching is enough — the patch levels differ
# in that passing run.
#
# ON `$PATH` RATHER THAN VIA `--chromedriver`, because `$PATH` is the hook wasm-pack documents for
# exactly this ("if the chromedriver WebDriver client is not on the `$PATH`, and not specified with
# `--chromedriver`, then wasm-pack will download a local copy"). Taking the `$PATH` branch means the
# `wasm-pack test` invocation in `do_leg` needs no argument and cannot drift out of step with this.
#
# AN ALREADY-MATCHING DRIVER IS LEFT ALONE, so a machine that manages its own chromedriver — a distro
# package, a pinned CI image — is not second-guessed and nothing is downloaded.
ensure_chromedriver() {
  local chrome="${CHROME_PATH:-google-chrome}" major have cache url
  major="$("$chrome" --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)"
  if [ -z "$major" ]; then
    echo "warning: could not read Chrome's version, so chromedriver cannot be matched to it." >&2
    echo "  letting wasm-pack choose; if it fetches a different major you will see a 404 and a SIGKILL." >&2
    return 0
  fi

  if command -v chromedriver >/dev/null 2>&1; then
    have="$(chromedriver --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)"
    if [ "$have" = "$major" ]; then
      echo "==> chromedriver $have already matches Chrome $major"
      return 0
    fi
  fi

  cache="${XDG_CACHE_HOME:-$HOME/.cache}/redextape/chromedriver-$major"
  if [ ! -x "$cache/chromedriver" ]; then
    if ! command -v unzip >/dev/null 2>&1; then
      echo "error: unzip not found, and Chrome for Testing ships chromedriver only as a .zip." >&2
      echo "  install unzip, or put a chromedriver for Chrome $major on \$PATH yourself." >&2
      echo "  or skip this tier: scripts/check-all.sh --no-browser" >&2
      exit 1
    fi
    # ONE ENDPOINT, KEYED BY MILESTONE, so this asks the question it actually has ("a driver for Chrome
    # $major") rather than the one that broke us ("the newest driver"). `latest-patch` within the
    # milestone is fine: the passing measurement above pairs .138 with .137.
    url="$(curl -fsSL https://googlechromelabs.github.io/chrome-for-testing/latest-versions-per-milestone-with-downloads.json 2>/dev/null \
      | tr ',' '\n' | grep -F "/$major." | grep -F 'chromedriver-linux64.zip' | grep -oE 'https://[^"]+' | head -1 || true)"
    if [ -z "$url" ]; then
      echo "error: no chromedriver published for Chrome $major." >&2
      echo "  Chrome for Testing lists drivers per milestone; $major is not among them." >&2
      echo "  put one on \$PATH yourself, or skip this tier: scripts/check-all.sh --no-browser" >&2
      exit 1
    fi
    echo "==> fetching chromedriver for Chrome $major"
    mkdir -p "$cache"
    curl -fsSL -o "$cache/cd.zip" "$url"
    unzip -qo "$cache/cd.zip" -d "$cache"
    # The archive nests the binary one directory down; move it up so `$PATH` needs one entry.
    find "$cache" -name chromedriver -type f -exec mv -f {} "$cache/chromedriver" \; 2>/dev/null || true
    chmod +x "$cache/chromedriver"
    rm -f "$cache/cd.zip"
  fi
  export PATH="$cache:$PATH"
  echo "==> using chromedriver $("$cache/chromedriver" --version 2>&1 | grep -oE '[0-9.]+' | head -1) for Chrome $major"
}

do_leg() {
  local kind="$1"; shift
  case "$kind" in
    fmt)    run cargo fmt --all --check ;;
    clippy) run cargo clippy "$@" -- -D warnings ;;
    build)  run cargo build "$@" ;;
    test)   test_cfg "$@" ;;
    probe)  ensure_llvm_prefix ;;
    wasmprobe) ensure_wasm_target ;;
    # Parameterized on cargo args, not a second kind: a `wasm` row is `cargo check --target
    # wasm32-unknown-unknown` plus whatever the row supplies, so `--features serde` builds exactly the
    # wasm32+serde configuration `Cargo.toml`'s `serde` dependency comment cites — the one config the
    # default-features-only wasm leg never built.
    #
    # THE PACKAGE MOVED FROM HERE INTO THE ROWS when `redextape-wasm` arrived. It used to be hardcoded
    # as `-p redextape-core --lib`, which cannot express a second crate: appending `-p redextape-wasm`
    # to that would check both packages in one invocation and report them as one leg, so a crate whose
    # ONLY real target is wasm32 would fail under the other crate's name. Each row names its own
    # package now, which costs one repeated fragment per row and buys a leg per crate.
    wasm)   ensure_wasm_target; run cargo check --target wasm32-unknown-unknown "$@" ;;
    browserprobe) ensure_browser ;;
    # NOT a `cargo` leg, and the only row in this table that is not: `wasm-pack test` takes a crate
    # DIRECTORY, not cargo arguments, so the row supplies `crates/redextape-wasm` rather than a `-p`
    # flag. `--headless` keeps it CI-shaped; `--chrome` picks the engine the boundary was measured
    # against — Firefox and Safari would be different measurements, not the same one twice.
    browser) ensure_browser; run wasm-pack test --headless --chrome "$@" ;;
    *)      echo "error: unknown leg kind: $kind" >&2; exit 1 ;;
  esac
}

for row in "${LEGS[@]}"; do
  tier="${row%%|*}"; rest="${row#*|}"; kind="${rest%%|*}"; argstr="${rest#*|}"
  selects "$tier" || continue
  read -r -a leg_args <<< "$argstr"
  # Guarded expansion: with `set -u`, "${leg_args[@]}" on an empty array aborts as an unbound
  # variable on bash < 4.4 — that boundary is a documented bash fact (bash's own changelog), not a
  # guess. What is untested is not the version number but whether this script actually runs, let
  # alone is supported, under bash that old: this is an inference from the LLVM probe's
  # /opt/homebrew/opt/llvm entry above (which suggests a macOS/Homebrew, bash-3.2-vintage target),
  # and "older bash" below names that untested support claim, not the 4.4 boundary itself.
  do_leg "$kind" ${leg_args[@]+"${leg_args[@]}"}
done

# NAMES WHAT WAS SKIPPED, NOT JUST WHAT PASSED. A partial run that signs off with an unqualified
# "green" is how a tier gets dropped from CI and nobody notices for weeks — the same defect the union
# invariant exists to make structurally impossible.
echo
skipped=""
[ "$want_base" -eq 1 ]    || skipped="$skipped base"
[ "$want_llvm" -eq 1 ]    || skipped="$skipped LLVM"
[ "$want_browser" -eq 1 ] || skipped="$skipped browser"
if [ -z "$skipped" ]; then
  echo "all configs green — base, LLVM and browser"
else
  echo "green, but PARTIAL — these tiers were SKIPPED:$skipped. This is NOT a full gate on its own."
fi
