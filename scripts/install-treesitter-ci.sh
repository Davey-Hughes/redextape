#!/usr/bin/env bash
# Install the tree-sitter CLI for CI (and for `scripts/setup-dev.sh` locally), from a pinned and
# checksummed NUMBERED release asset.
#
# Called by BOTH the `rust` and `rust-scoped` jobs (.forgejo/workflows/ci.yml), because both reach
# scripts/check-all.sh's base tier, which has a grammar leg that hard-fails when the CLI is missing
# (see `ensure_treesitter` there). One file instead of two copies, for the same reason
# scripts/install-nextest-ci.sh gives for cargo-nextest: the version and the fetch logic are the kind
# of pair that drifts silently once duplicated.
#
# **NEITHER v0.26.12'S PREBUILT ASSET NOR A SOURCE BUILD OF IT WORKS ON THE CI RUNNER.** Its prebuilt Linux
# assets need GLIBC_2.39 and the runner (`catthehacker/ubuntu:act-latest`) has GLIBC_2.35, with no musl
# variant; a source build vendors QuickJS through `bindgen`, which needs `libclang`, and the runner has none.
#
# THIS PINS v0.25.10 INSTEAD OF THE NEWEST RELEASE, AND USES A PREBUILT DOWNLOAD: its Linux asset needs at
# most GLIBC_2.34, which the runner's 2.35 satisfies, and it generates ABI 15, as v0.26.12 does.
#
# THIS PIN CAN MOVE UP TO 0.26+ ONLY WHEN BOTH BLOCKERS ABOVE ARE GONE: a runner image with
# GLIBC_2.39 or newer (so a prebuilt binary — or a locally-built one, moot at that point — can run),
# AND `libclang` available on that runner (so `cargo install`, if that route is preferred instead of
# a prebuilt asset, does not fail on `bindgen`). Either blocker alone is not enough; both must be
# fixed before bumping this version is safe. Re-verify the GLIBC and ABI claims above at that time —
# they hold for v0.25.10 and v0.26.12 specifically, not for whatever is newest when this is read.
#
# THE ASSET IS SELECTED BY `uname -s`/`uname -m`, one of a small pinned-and-checksummed set — not a
# guess, and not "whatever this OS/arch happens to map to". Each entry below was downloaded and its
# checksum computed independently, the same caveat the rest of this file states: this cannot prove
# upstream was honest on the day it was pinned, only that nothing has changed since. A combination not
# in the case below fails closed with an actionable message rather than silently fetching the wrong
# binary.
#
# Upstream publishes no .sha256 alongside these assets, so each hash below was taken from the pinned
# artifact itself, the same caveat install-nextest-ci.sh states for cargo-nextest.
#
# THE ASSETS ARE BARE `.gz` FILES, NOT `.zip` — gzipped single binaries
# (`tree-sitter-{linux,macos}-{x64,arm64}.gz`), so extraction is `gunzip`, not `unzip`
# (ensure_chromedriver in scripts/check-all.sh still needs `unzip` for a different asset).
#
# EXTRACTED AND VERIFIED IN A TEMP DIRECTORY, THEN `install`ED INTO PLACE — never a partial or wrong
# binary at the destination. A checksum failure, or a mid-stream interruption, must never leave a
# truncated binary sitting where `ensure_treesitter` looks before `$PATH`. Fail-closed here means a
# failure at any step below leaves the destination exactly as it was.
#
# A CHECKSUM-CLEAN DOWNLOAD CAN STILL FAIL TO RUN — a platform this script has not correctly pinned, or a
# corrupt runner image. Caught here, in the temp directory, before `install` ever touches the destination:
# this is the other half of "fail closed" above. This self-test turns the glibc mismatch above into a
# legible one-line error instead of a mystery three steps later — keep it even if the download-vs-build
# tradeoff above ever gets re-litigated.
#
# SKIPS THE DOWNLOAD WHEN THE CORRECT VERSION IS ALREADY AT `dest`: no network round trip to GitHub
# and no re-verification when the right binary is already sitting there. A stale or non-executing
# binary at `dest` (wrong version, or one that fails to run at all) falls through to a full download
# rather than being trusted.
#
# DEFAULTS TO `$HOME/.cargo/bin`, matching scripts/install-nextest-ci.sh, which CI calls with no
# argument. `ensure_treesitter` in scripts/check-all.sh probes the repo-local `.tools/` first either
# way, so this default only matters when nothing local has been installed yet.
#
#   scripts/install-treesitter-ci.sh              # -> $HOME/.cargo/bin
#   scripts/install-treesitter-ci.sh /some/dir    # -> /some/dir
set -euo pipefail

TREESITTER_VERSION=0.25.10

dest="${1:-$HOME/.cargo/bin}"
[ -d "$dest" ] || { echo "error: destination is not a directory: $dest" >&2; exit 1; }

# See "SKIPS THE DOWNLOAD..." above. Tolerant of a binary that exists but cannot execute — same
# `&&`/`||` capture `ensure_treesitter` uses, so a stale or corrupt cached binary falls through to a
# fresh download rather than short-circuiting on a command substitution that `set -e`/`pipefail`
# would otherwise abort on.
if [ -x "$dest/tree-sitter" ]; then
  raw="$("$dest/tree-sitter" --version 2>&1)" && rc=0 || rc=$?
  if [ "$rc" -eq 0 ] && [ "$(echo "$raw" | awk '{print $2}')" = "$TREESITTER_VERSION" ]; then
    echo "==> tree-sitter ${TREESITTER_VERSION} already installed at ${dest}, skipping download"
    exit 0
  fi
fi

os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
  Linux-x86_64)
    asset=tree-sitter-linux-x64.gz
    sha256=8283ddba69253c698f6e987ba0e2f9285e079c8db4d36ebe1394b5bb3a0ebdfd
    ;;
  Darwin-x86_64)
    asset=tree-sitter-macos-x64.gz
    sha256=c7a962bdc850dccb184afdb73853754767304d725b545362352d1838c9a18d7e
    ;;
  Darwin-arm64)
    asset=tree-sitter-macos-arm64.gz
    sha256=a6295d469669f6e901b6029ae6c129bd094df582d278c237fada413505cb9c42
    ;;
  *)
    echo "error: no pinned tree-sitter v${TREESITTER_VERSION} asset for $os-$arch." >&2
    echo "  supported: Linux-x86_64, Darwin-x86_64, Darwin-arm64." >&2
    echo "  install manually from https://github.com/tree-sitter/tree-sitter/releases/tag/v${TREESITTER_VERSION}" >&2
    echo "  and either put it on \$PATH or set TREE_SITTER=/path/to/tree-sitter for scripts/check-all.sh." >&2
    exit 1
    ;;
esac

workdir="$(mktemp -d -t tree-sitter-install-XXXXXX)"
# ${workdir:?} so a set-but-empty expansion can never widen the rm — set -u does not catch that case.
trap 'rm -rf "${workdir:?}"' EXIT

archive="$workdir/tree-sitter.gz"
curl -fsSL -o "$archive" \
  "https://github.com/tree-sitter/tree-sitter/releases/download/v${TREESITTER_VERSION}/${asset}"

# Explicit failure rather than relying on the caller's shell being `bash -e`: a checksum check that
# cannot fail the step is not a checksum check.
echo "${sha256}  ${archive}" | sha256sum -c - \
  || { echo "tree-sitter checksum mismatch — refusing to install" >&2; exit 1; }

gunzip -c "$archive" > "$workdir/tree-sitter"
chmod 0755 "$workdir/tree-sitter"

# A binary that downloads, checksums and extracts cleanly can still fail to RUN — see "A
# CHECKSUM-CLEAN DOWNLOAD..." above. Caught here, in the temp directory, before `install` ever
# touches the destination.
if ! "$workdir/tree-sitter" --version >/dev/null 2>&1; then
  echo "error: downloaded tree-sitter for $os-$arch (asset $asset) but it will not run here." >&2
  echo "  nothing was installed to ${dest}." >&2
  exit 1
fi
version="$("$workdir/tree-sitter" --version | awk '{print $2}')"
if [ "$version" != "$TREESITTER_VERSION" ]; then
  echo "error: downloaded tree-sitter reports $version, not the requested ${TREESITTER_VERSION}." >&2
  echo "  nothing was installed to ${dest}." >&2
  exit 1
fi

install -m 0755 "$workdir/tree-sitter" "$dest/tree-sitter"
echo "==> tree-sitter $("$dest/tree-sitter" --version | awk '{print $2}') installed to ${dest}"
