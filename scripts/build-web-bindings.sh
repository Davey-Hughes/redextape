#!/usr/bin/env bash
# Regenerates web/bindings/ from the crates' `ts_rs::TS` derives, without a failed generation ever
# touching the last-good copy, without `tsc` ever seeing the directory gone for longer than a rename,
# and without two concurrent runs of this script being able to destroy the directory between them.
# Called by `web/package.json`'s `build:bindings` script, which `typecheck`, `test` and `build` all run
# first — so this runs every time a pre-commit hook, CI, or a second agent working in `web/` does.
#
# THE ORIGINAL SHAPE WAS `rm -rf bindings && cargo test ... export_bindings`, run at the START of every
# `typecheck`, `test` and `build` in `web/`. THAT HAD TWO MEASURED CONSEQUENCES: (i) a failed
# generation destroyed the last-good directory, because the `rm -rf` ran before `cargo` could fail; and
# (ii) `tsc` was measurably sensitive to the directory being gone for roughly the first second of a
# `--noEmit` run, which a concurrent `tsc` (a pre-commit hook, an editor's tsserver, a second agent)
# could land inside.
#
# THE FIRST ROUND'S FIX — generate into a scratch directory and swap it in with two renames — closed
# both of those and INTRODUCED A WORSE ONE: it used two FIXED, SHARED scratch names
# (`web/bindings.tmp`, `web/bindings.old`) and `rm -rf`'d both unconditionally with no lock. Two
# concurrent runs raced identically every time: the second run's `rm -rf` deleted the first run's
# already-populated scratch mid-flight, the first run's swap then moved the SECOND run's (still-being-
# written, or already-deleted) directory into place, and the loser's final `mv` found nothing to move —
# `web/bindings` ended up not existing at all, twelve files stranded under `bindings.old`, at exit 0.
# The pre-fix inline shape, raced identically, came through clean every time: this was a regression the
# scratch-directory fix introduced, not a hazard it failed to close, and a fix that is worse than the
# problem it fixed must not ship. There was a second, latent defect in the same lines too: `mv
# web/bindings web/bindings.old` when `web/bindings.old` already existed (a straggler from a crashed
# run) moved the directory INSIDE it, silently producing `web/bindings.old/bindings/`.
#
# THIS VERSION FIXES BOTH BY MAKING THE SCRATCH NAMES PER-PROCESS AND PUTTING A LOCK AROUND THE SWAP.
#
# PER-PROCESS SCRATCH NAMES (`mktemp -d`, suffixed `.old` for the swap's holding spot) mean no run ever
# owns a name any other run could also construct, so no run's cleanup can ever delete a directory a
# concurrent run is using — the exact mechanism of the regression above. A `trap ... EXIT INT TERM HUP`
# removes THIS run's own scratch directories no matter how the script exits, which is also what keeps a
# process interrupted mid-swap (see Finding 3 below) from leaving a scratch directory as the only copy
# of anything for longer than it takes the next run to reclaim the lock.
#
# A LOCK AROUND THE SWAP, because per-process names alone are not enough: the swap itself — check
# whether `web/bindings` exists, rename it out of the way, rename the new tree into its place — is a
# check-then-act over the ONE SHARED NAME every run contends over, and no shell can make a directory
# rename sequence atomic by itself. `mkdir` IS atomic (POSIX guarantees exactly one caller's `mkdir` on
# a given path succeeds when several race), portable, and needs no new dependency, so it is the mutex
# here: acquiring the lock is `mkdir web/bindings.lock` succeeding, releasing it is removing that
# directory. `flock` was considered and rejected, not on taste: it ships as part of util-linux, which is
# Linux-only, and `scripts/setup-dev.sh` explicitly supports this repo being set up on macOS (its
# `brew install` fallbacks for cargo-nextest and wasm-pack exist for exactly that), where `flock(1)` is
# not part of the base system. `mkdir` works unchanged on every platform `setup-dev.sh` already assumes.
#
# WHAT THE LOCK GUARANTEES, AND WHAT IT DOES NOT — stated plainly rather than assumed. It guarantees
# that two runs can never both believe they are the one renaming `web/bindings` at the same instant:
# `mkdir`'s atomicity is an OS guarantee, not an application-level check that could itself race. A
# lock left behind by a run that was killed (never a run that exited normally or via a trapped signal —
# see below) is reclaimed automatically and safely: every lock holder records its own PID in
# `web/bindings.lock/pid`, and a waiter that finds the lock held checks with `kill -0` whether that PID
# is still alive before ever touching the lock directory. `kill -0` failing is not by itself proof of
# that: it fails BOTH when the PID has no process (ESRCH) and when a live process with that PID exists
# but is owned by someone else (EPERM) — indistinguishable by exit code alone, and a runner shared
# between users can hit either. Only the ESRCH case, confirmed by `kill`'s own error text ("No such
# process", not "Operation not permitted"), is reclaimed; an EPERM is treated the same as "genuinely
# still alive" below, because a lock held by a live process this caller cannot signal is exactly the
# case that must not be reclaimed. That is what "this can never steal a lock a live process still
# holds" means for this script — a claim about a specific PID this process cannot prove is dead, not
# merely a PID it cannot prove is alive. A waiter that can prove neither liveness nor
# death — the PID file is unreadable, or genuinely still alive — waits, but ONLY up to a bounded timeout
# (`LOCK_TIMEOUT_SECS` below); past that it fails loudly with the holder's PID and how to clear the lock
# by hand, rather than hanging the pre-commit hook forever. That bound is what "cannot deadlock" means
# here: a bounded, loud failure is not a deadlock even though it is not instant success either.
#
# What it does NOT guarantee: `SIGKILL` cannot be trapped by anything, ever, so a run killed strictly
# BETWEEN the two renames — `web/bindings` already moved to this run's own `*.old` scratch directory,
# but the new tree not yet moved into place — leaves both `web/bindings` and the lock directory exactly
# as that moment left them. Nothing is lost: the pre-kill last-good copy sits intact, correctly named,
# under that run's own `*.old` directory. But nothing repairs it automatically either, beyond the lock
# itself being reclaimed (via the PID check above) so the NEXT run is never blocked by it. The orphaned
# `*.old` directory is a leaked scratch directory a human may need to clean up by hand; it is never
# silent data loss and never an indefinite hang. `web/bindings` itself is restored by the next
# successful run the normal way, from a fresh generation.
#
# THE SWAP IS ALSO GUARDED ON THE SCRATCH DIRECTORY ACTUALLY CONTAINING GENERATED FILES, not merely on
# `cargo test` exiting 0. A test filter that matches nothing exits 0 having written nothing — this is
# not exotic, `redextape-wasm`'s leg legitimately runs 0 tests today — so "cargo exited 0" was never
# proof that generation happened, only that nothing failed. The check below is a literal file-existence
# test, not a trust in the exit code.
#
# EVERY `rm -rf` BELOW USES A LITERAL PATH OR A VARIABLE WRITTEN `"${VAR:?}"` — the colon form is what
# aborts if a variable is ever set but empty, which `set -u` does not catch and quoting does not save
# you from; a bare `"$VAR"` is exactly as dangerous empty as it is safe non-empty, right up until it
# grows a trailing `/*` somewhere a future edit adds.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root, the same convention every other script here uses

BINDINGS_DIR="web/bindings"
LOCK_DIR="web/bindings.lock"
LOCK_TIMEOUT_SECS=30

# Per-process, via mktemp's random suffix — never a name any other concurrently running instance of
# this script could also construct, which is what makes every rm/mv below safe to run without
# coordinating with any other run except at the lock in swap_in below.
TMP_DIR="$(mktemp -d "$PWD/web/bindings.tmp.XXXXXX")"
OLD_DIR="${TMP_DIR}.old"   # never pre-created — appending to a unique name keeps this unique too, and
                           # `mv` onto a path that does not yet exist renames INTO that path rather than
                           # inside it, which is what closes the second, latent defect described above.

LOCK_HELD=0

# This run's own scratch directories, and this run's own lock if it is holding one — removed on every
# exit this script can trap (normal completion, an error under `set -e`, INT, TERM, HUP). Idempotent:
# by the time this runs after a successful swap, TMP_DIR has already been renamed away and OLD_DIR has
# already been renamed into existence, so `rm -rf` on whichever of the two no longer applies is simply a
# no-op, not an error. SIGKILL bypasses this entirely — see the header comment above for what that does
# and does not leave behind.
cleanup() {
  rm -rf "${TMP_DIR:?}" "${OLD_DIR:?}"
  if [ "$LOCK_HELD" -eq 1 ]; then
    rm -rf "${LOCK_DIR:?}"
    LOCK_HELD=0
  fi
}
trap cleanup EXIT INT TERM HUP

# Blocks until this run holds web/bindings.lock, reclaiming a lock a killed process left behind and
# refusing to wait past LOCK_TIMEOUT_SECS for one that might still be live. See the header comment for
# what this does and does not guarantee.
acquire_lock() {
  local start=$SECONDS
  while true; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      LOCK_HELD=1
      echo "$$" >"$LOCK_DIR/pid" 2>/dev/null || true
      return 0
    fi
    local holder_pid=""
    if [ -f "$LOCK_DIR/pid" ]; then
      holder_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    fi
    if [ -n "$holder_pid" ]; then
      # `kill -0` fails for TWO different reasons, and only one of them means "gone": ESRCH (no
      # process has this PID) and EPERM (a process HAS this PID, alive, but owned by someone else
      # this caller may not signal) both return nonzero with stderr suppressed identically. Treating
      # either as "confirmed gone" is exactly the bug this replaced: a lock held by pid 1, or by any
      # live process another user owns, was reclaimed on the very next loop iteration. Bash's `kill`
      # builtin distinguishes the two only in its error TEXT ("No such process" vs "Operation not
      # permitted"), so that text — not the exit code alone — is what this checks. `kill_status=$?`
      # on the `||` branch, rather than checking `$?` directly after the assignment, is deliberate:
      # under `set -e`, `x=$(cmd)` with a failing `cmd` would otherwise exit this script outright.
      local kill_err="" kill_status=0
      kill_err="$(kill -0 "$holder_pid" 2>&1 >/dev/null)" || kill_status=$?
      if [ "$kill_status" -ne 0 ] && [[ "$kill_err" == *"No such process"* ]]; then
        # ESRCH, confirmed by the kernel via errno through kill's own message text — not merely
        # absent from a file we failed to read, and not an EPERM we cannot tell from "alive": safe
        # to reclaim.
        rm -rf "${LOCK_DIR:?}"
        continue
      fi
      # EPERM (or any other failure) falls through here as "cannot prove gone" — the same bucket as
      # "genuinely still alive" below, waited out rather than reclaimed.
    fi
    if ((SECONDS - start >= LOCK_TIMEOUT_SECS)); then
      echo "build-web-bindings.sh: timed out after ${LOCK_TIMEOUT_SECS}s waiting for $LOCK_DIR" \
        "(held by pid ${holder_pid:-unknown}). If that process is gone, remove $LOCK_DIR by hand" \
        "and retry; if it is still running, wait for it to finish." >&2
      exit 1
    fi
    sleep 0.2
  done
}

TS_RS_EXPORT_DIR="$TMP_DIR" cargo test -p redextape-core --features ts export_bindings
TS_RS_EXPORT_DIR="$TMP_DIR" cargo test -p redextape-wasm --features ts export_bindings

if [ -z "$(find "$TMP_DIR" -maxdepth 1 -name '*.ts' -print -quit)" ]; then
  echo "build-web-bindings.sh: both cargo legs exited 0 but $TMP_DIR contains no .ts files —" \
    "refusing to touch the last-good $BINDINGS_DIR. A cargo test filter that matches nothing exits 0" \
    "having written nothing (redextape-wasm's leg legitimately runs 0 tests, so '0 tests passed' is" \
    "not itself evidence of a problem — an EMPTY export directory is). Check TS_RS_EXPORT_DIR and the" \
    "export_bindings filter above." >&2
  exit 1
fi

# Generation succeeded and produced files: web/bindings.tmp.* is a complete, good tree. Everything past
# this point that touches the SHARED name web/bindings runs under the lock.
acquire_lock
if [ -d "$BINDINGS_DIR" ]; then
  mv "$BINDINGS_DIR" "$OLD_DIR"
fi
mv "$TMP_DIR" "$BINDINGS_DIR"
