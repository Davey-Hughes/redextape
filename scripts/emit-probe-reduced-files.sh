#!/usr/bin/env bash
# Emit the reduced `.tm` files `web/tests/browser/tm-buffer-cost.test.ts` prices, with a release CLI built from this
# tree. It takes no arguments:
#
#   scripts/emit-probe-reduced-files.sh
#
# `pnpm run test:probe:tm-buffer`, from `web/`, runs it before building the probe's wasm and running the probe.
#
# **GENERATED, NOT COMMITTED.** The corpus runs to tens of megabytes, and a checked-in copy would go stale the first
# time `reduce` or `print_tm_with` changed what they write, with nothing failing: the probe would go on pricing files
# the CLI no longer emits. So every run rebuilds the CLI and re-emits every file, and deletes the previous run's files
# first, so a program dropped from the list below cannot linger in the probe's glob.
#
# **WRITTEN UNDER THE REPO'S `target/`, WHICH `.gitignore` ALREADY COVERS, AND AT A FIXED PATH.** The probe reads the
# directory with `import.meta.glob`, whose pattern has to be a literal, so the path cannot follow `CARGO_TARGET_DIR`;
# the CLI binary does. Vite serves it because `web/vite.config.ts` allows the whole repo root.
#
# **EVERY PROGRAM THROUGH EVERY STAGE LIST, THEN FILES OVER `max_bytes` DROPPED.** The lists are the seven `--reduce`
# accepts (each stage at most once, in `fold, single-tape, two-symbol` order). A stage may refuse a machine past
# `MAX_MACHINE_STATES`; that refusal writes no file and is printed, and any other failure stops the script. The drop
# keeps the probe's page from loading strings several times over any budget; each drop is printed.
#
# **STAMPED WITH `REDEXTAPE_PROBE_TM_BUFFER_RUN`,** which `pnpm run test:probe:tm-buffer` sets before calling this, in
# a `run.txt` file beside the corpus; the probe refuses a corpus whose stamp is not its own run's, and its file doc says
# why. Run alone, this writes an empty stamp, which no probe run accepts.
#
# The corpus brackets `MAX_SCRATCH_TM_BYTES`, 6,100,000 bytes: `head([1, 2])` through `single-tape, two-symbol` and
# `[1, 2, 3]` through `fold, two-symbol` are the two files either side of it. That constant's doc gives their sizes
# and the commit they were emitted at.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/target/probe-reduced-files"
max_bytes=16000000

programs=(
  'iftrue=if true { 1 } else { 2 }'
  'add11=1 + 1'
  'sub35=3 - 5'
  'sub53=5 - 3'
  'mul23=2 * 3'
  'letx=let x = 40; x + 2'
  'list2=[1, 2]'
  'arith=1 + 2 * 3'
  'hd=head([1, 2])'
  'list3=[1, 2, 3]'
)
stage_lists=(
  fold
  single-tape
  two-symbol
  fold,single-tape
  fold,two-symbol
  single-tape,two-symbol
  fold,single-tape,two-symbol
)

cargo build --release -p redextape-cli --manifest-path "$root/Cargo.toml"
cli="${CARGO_TARGET_DIR:-$root/target}/release/redextape"

mkdir -p "$out"
rm -f "${out:?}"/*.tm "${out:?}"/*.rxt "${out:?}"/run.txt

emitted=0
for entry in "${programs[@]}"; do
  name="${entry%%=*}"
  printf '%s\n' "${entry#*=}" >"$out/$name.rxt"
  for stages in "${stage_lists[@]}"; do
    file="$out/$name.${stages//,/+}.tm"
    if ! said="$("$cli" emit "$out/$name.rxt" --lang tm --reduce "$stages" -o "$file" 2>&1)"; then
      if [[ "$said" == *'with `too-many-states`'* ]]; then
        echo "refused $(basename "$file"): too-many-states"
        continue
      fi
      printf '%s\n' "$said" >&2
      echo "error: emitting $(basename "$file") failed, and not with too-many-states" >&2
      exit 1
    fi
    bytes="$(wc -c <"$file")"
    if ((bytes > max_bytes)); then
      echo "dropped $(basename "$file"): $bytes bytes, over $max_bytes"
      rm -f "${file:?}"
    else
      emitted=$((emitted + 1))
    fi
  done
done
printf '%s' "${REDEXTAPE_PROBE_TM_BUFFER_RUN:-}" >"$out/run.txt"
echo "emitted $emitted files into $out"
