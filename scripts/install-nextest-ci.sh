#!/usr/bin/env bash
# Install cargo-nextest for CI, from a pinned and checksummed release asset.
#
# Called by BOTH the `rust` and `rust-llvm` jobs (.forgejo/workflows/ci.yml), because both run
# scripts/check-all.sh and that gate hard-fails when the runner is missing — by design, see its
# header. It lived inline in `rust` only, so `rust-llvm` ran check-all.sh with no runner on PATH and
# failed on every run from the day the fast tier moved to nextest. One file instead of two copies:
# the version and its checksum are the kind of pair that drifts silently once duplicated, and a
# second job quietly installing a different runner than the first is the same class of defect as a
# gate that covers less than its name claims.
#
# PINNED to an exact version and an exact release asset, and checksummed BEFORE it reaches PATH.
# This binary executes every test in CI with full repo access, so the documented one-liner —
# `curl https://get.nexte.st/latest/linux | tar zxf -` — is arbitrary unversioned code from a
# redirector, piped straight to disk. `get.nexte.st/<version>/linux` resolves to this very GitHub
# asset (same blob), so naming the asset directly costs nothing and is what makes the pin auditable.
#
# Upstream publishes no .sha256 alongside the asset, so this hash was taken from the pinned artifact
# itself: it cannot prove the artifact was honest on the day it was pinned, but it does prove nothing
# has changed since. Update BOTH values together when bumping.
#
#   scripts/install-nextest-ci.sh              # -> $HOME/.cargo/bin
#   scripts/install-nextest-ci.sh /some/dir    # -> /some/dir (used by the self-test below)
set -euo pipefail

NEXTEST_VERSION=0.9.140
NEXTEST_SHA256=4ee9aaa0d0171a985a5d0eb735b87355894c1c455972e9674fb9fdbd1387c9a3

dest="${1:-$HOME/.cargo/bin}"
[ -d "$dest" ] || { echo "error: destination is not a directory: $dest" >&2; exit 1; }

tarball="$(mktemp -t nextest-XXXXXX.tar.gz)"
# ${tarball:?} so a set-but-empty expansion can never widen the rm — set -u does not catch that case.
trap 'rm -f "${tarball:?}"' EXIT

curl -fsSL -o "$tarball" \
  "https://github.com/nextest-rs/nextest/releases/download/cargo-nextest-${NEXTEST_VERSION}/cargo-nextest-${NEXTEST_VERSION}-x86_64-unknown-linux-gnu.tar.gz"

# Explicit failure rather than relying on the caller's shell being `bash -e`: a checksum check that
# cannot fail the step is not a checksum check.
echo "${NEXTEST_SHA256}  ${tarball}" | sha256sum -c - \
  || { echo "cargo-nextest checksum mismatch — refusing to install" >&2; exit 1; }

tar xzf "$tarball" -C "$dest"
echo "==> cargo-nextest ${NEXTEST_VERSION} installed to ${dest}"
