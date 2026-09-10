# Attribution drift sweep — symbol citations that name the wrong file

> **Filed by** PR #84 as *"Seven sites still say `main.ts` owns a pane handler that lives in
> `transport.ts`"*, and by PR #37 (plan 5d-ii-a) as the change that caused it. The sweep found the
> filing was an undercount by a factor of three, and that the class has a clean half nobody expected.

## The class, stated before the instances

`scripts/check-citations.sh` exists because `file:line` citations rot, and the convention it enforces
is **cite the symbol instead**. A symbol citation in this tree is written `` `file.ts`'s `symbol` ``.

That form has its own rot, and it is the one this slice closes: **the symbol survives the move and the
filename does not.** When a god-module is split, every citation naming it keeps naming it. The symbol
is still real, still spelled correctly, and still findable — so nothing looks broken, and neither
`check-citations.sh` nor any review of the extraction diff can see it, because the citing files are not
in that diff.

## What was measured, and the surprise in it

A scanner over all **286** tracked non-`docs/` source files, resolving each cited filename
nearest-first from the citing file and asking whether the named symbol appears in that file's **code**
— comments and string literals blanked first, because a file that merely *talks* about a symbol does
not own it:

| tier | attribution sites | absent from the named file's code |
|---|---|---|
| `crates/` (Rust) | 108 | **0** |
| `web/` (TypeScript) | ~60 | **26** |

**The Rust tier is clean and the web tier is not, and that is a fact about history rather than about
the languages.** Rust's modules were split along boundaries that existed before the code did. `main.ts`
was a god-module that PR #37 and its successors carved up — `transport.ts`, `link-wiring.ts`,
`compile.ts`, `panes.ts`, `buffer-list.ts` — and every citation written before the carve kept pointing
at the file the symbol left. The drift is not a TypeScript problem; it is an *extraction* problem, and
the tier that never extracted never drifted.

## Two shapes, and the second is the sharper one

1. **`` `file.ts`'s `symbol` ``** — 26 sites. Mechanically checkable.
2. **A doc quoted verbatim and attributed to a file** — `` see its doc in `main.ts`: "…" `` — 2 sites,
   both quoting `link-wiring.ts`. Sharper because the quote is *correct*: someone read the real doc,
   copied it accurately, and attributed it to the wrong file. Accuracy of the quotation is what makes
   the misattribution invisible.

## Tasks

### Task 1 — the gate, before the fixes

`scripts/check-attributions.sh`, built as `check-citations.sh`'s sibling and stating so: same
`--self-test` shape, same invocation from `.pre-commit-config.yaml` and `.forgejo/workflows/ci.yml` so
local and CI cannot drift, same practice of naming its own boundary in its header.

Writing it first is deliberate: the gate must be demonstrated RED against the unfixed tree, because a
gate written after the fixes has only ever seen a clean tree and its red half is untested. Its
`--self-test` proves the detector detects; the unfixed tree proves the scan reports.

**Three blind spots found while building the scanner, all of which shipped green before they were
found, and all of which belong in the header rather than in this plan:**

- A presence test that does not strip comments passes on any file that merely *mentions* the symbol.
  The first scanner reported `main.ts`'s `forward` clean for exactly this reason. `check-citations.sh`'s
  sibling problem was solved three times over; this is the same door in a new wall.
- A Rust `'` is a lifetime far more often than a char literal. Blanking from `'` to the next `'`
  deletes real code, which turns present symbols into absent ones — it reported `impl Drop for Core`
  missing from `core.rs`. The stripper must recognise a complete char literal and treat every other
  `'` as code.
- A symbol written `` `play()` `` does not match a symbol pattern that stops at word characters. This
  is how the seventh of PR #84's seven filed sites escaped the first scan that was supposed to find
  all seven.

### Task 2 — fix the 26 symbol citations

Grouped by where the symbol actually lives. No citation acquires a line number; the whole point of the
convention is that symbols outlive coordinates.

### Task 3 — fix the 2 quoted-doc attributions

### Task 4 — roadmap entry, with every figure re-derived at the commit it names

## What this slice deliberately does not do

- **It does not gate the quoted-doc shape.** Two sites is not a corpus, and a scanner for prose quotes
  needs fuzzy matching whose false-positive rate would be unmeasured. Task 3 fixes both by hand and the
  gate's header says the shape is uncovered.
- **It does not touch the Rust tier.** Zero absent is not a reason to edit anything, and the gate
  covers the tier anyway, so a future extraction there arrives red rather than silent.
