//! The derive-site scanner both crates' `ts_bindings` gates run, and the JSDoc stripper the
//! `bigint` gate needs.
//!
//! **IT LIVES HERE BECAUSE THERE ARE TWO CRATES TO SCAN AND ONE SCANNER IS THE POINT.**
//! `redextape-core` and `redextape-wasm` each declare types carrying `ts_rs::TS`, and each needs the
//! same coverage gate over its own sources. The scanning logic below took four revisions plus three
//! more in review, every one of them defeated within minutes by an ordinary spelling of the same
//! attribute — a history recorded in full on `ts_deriving_type_names_in_crate`. A second copy of that
//! logic would drift from the first the moment one is widened and the other is not, which is the same
//! class of defect the gate itself exists to catch. Parameterising by crate root costs one argument.
//!
//! **THE PANICS BELOW ARE THE PRODUCT, NOT A LIBRARY PATH THAT FORGOT TO RETURN `Result`.** This
//! module is a test gate: a source shape it cannot resolve must fail loudly, naming the file and
//! line, rather than be skipped — a silent `continue` on an unrecognized line is precisely the defect
//! an earlier revision shipped. The workspace's `unwrap_used`/`expect_used`/`panic` lints are allowed
//! at module level for that reason, stated here rather than at each site. `clippy.toml`'s
//! `allow-*-in-tests` keys do not reach this code: these are free functions in a library crate, not
//! bodies of `#[test]` functions.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

/// The one literal line every exported type in the crate being scanned must carry, verbatim, to be recognized as
/// exported: a feature-gated derive of `ts_rs::TS` with the crate path spelled out in full, paired
/// with the export flag, both inside one `cfg_attr`. `ts_deriving_type_names_in_crate` treats ANY
/// OTHER line that mentions the bytes `ts_rs` as a failure — see that function's doc for why that is a
/// whitelist and not one more banned spelling.
pub const CANONICAL_TS_DERIVE: &str = "#[cfg_attr(feature = \"ts\", derive(ts_rs::TS), ts(export))]";

/// The name of every type in the crate being scanned carrying [`CANONICAL_TS_DERIVE`], resolved by scanning
/// FORWARD from that line, past any further attribute lines and doc-comment lines, to the
/// `pub struct NAME` / `pub enum NAME` line it sits above.
///
/// THIS IS A TEXTUAL CHECK OVER THE CRATE'S OWN SOURCES, NOT A PARSE OF THE LANGUAGE — stated plainly
/// because four review rounds each compiled a counterexample past the previous wording of this claim.
///
/// **THIS IS A WHITELIST OVER EVERY MENTION OF `ts_rs`, NOT A BLACKLIST OF SPELLINGS TO REFUSE — AND
/// THAT INVERSION IS THE FIX FOR ALL FOUR PRIOR ROUNDS AT ONCE, NOT A FIFTH WIDENING.** Every earlier
/// version of this function asked "does this line avoid the spellings I have banned so far", and each
/// round's answer was a new spelling that had not been banned yet: keying on the substring
/// `ts(export)` missed `ts(rename = "Foo", export)`; keying on `derive(ts_rs::TS)` missed
/// `derive(Default, ts_rs::TS)`; banning `use ts_rs::` (colon-qualified) missed `use ts_rs::TS;` then
/// bare `derive(TS)`, which carries the derive with the path `ts_rs::TS` never appearing on that line
/// at all; and banning that still missed `use ts_rs as tsrs;` then `derive(tsrs::TS)` — a crate alias,
/// which puts `tsrs::TS` on the derive line, not `ts_rs::TS`, so a check for that path never even
/// looked at the line that mattered. Four rounds, four spellings, because a blacklist can only ever
/// enumerate the spellings someone has already thought of, and there is always one more — this
/// function's own history is the proof.
///
/// So this asks the opposite question. Every line in the scanned crate's own `.rs` files — every file
/// at or below `crate_root`, `target/` excluded as build output, which is `src/`, `tests/`,
/// `benches/`, `examples/`, and any loose file sitting beside `Cargo.toml`, not `src/` alone — that
/// contains the literal bytes `ts_rs` — checked first, before any of the reasoning below runs, so the
/// check is over the BYTES the crate name itself must appear as, not over any one shape a derive or
/// import could take — must equal [`CANONICAL_TS_DERIVE`] EXACTLY, or the scan panics. `use ts_rs;`,
/// `use ::ts_rs;`, `use ts_rs as tsrs;`, `derive(Default, ts_rs::TS)`, and
/// every spelling nobody has thought of yet all share the one property this scan actually tests for:
/// none of them IS the canonical line, byte for byte. Closing the ALIAS-AND-IMPORT CLASS this way — by
/// asking every mention of the crate name to be one exact line, rather than trying to enumerate what it
/// must not be — is what stops a review round from finding one more spelling INSIDE A FILE THIS SCAN
/// ALREADY READS. It says nothing at all about a file this scan never opens — that is a different
/// class of gap, named below rather than conflated with this one.
///
/// **`src/`-ONLY WAS ITSELF ONE MORE GAP OF EXACTLY THIS SHAPE, FOUND BY THE WHOLE-BRANCH REVIEW PAST
/// THE VERSION THAT SCANNED ONLY `src/`.** `pub use ts_rs::TS;` in `crates/redextape-core/tsalias.rs`
/// — a file directly under `crate_root`, never under `src/` — pulled in via
/// `#[path = "../tsalias.rs"] pub mod tsalias;` in `src/lib.rs`, then `derive(crate::tsalias::TS)` on a
/// new type with a `u64` field: the derive line itself carries no `ts_rs` bytes (it names
/// `crate::tsalias::TS`), and the one line that does — `pub use ts_rs::TS;` — sat in a file a
/// `src/`-only scan never read. Both tests in `redextape-core`'s gate file passed at the time, and
/// `web/bindings/Sneaky.ts` was really written carrying `bigint`. Widening the walk to the whole crate
/// (below) closes exactly this route: `tsalias.rs` is now a file this scan opens, so its
/// `pub use ts_rs::TS;` line fails the canonical-line check like any other non-canonical mention. The
/// same gap covered a derive placed directly in `tests/` or `benches/`, not routed through `src/` at
/// all.
///
/// WHAT THIS WHITELIST ACTUALLY GUARANTEES, AND WHAT REMAINS OUTSIDE IT, NAMED RATHER THAN DENIED. It
/// guarantees that every line in the scanned crate's own `.rs` files mentioning `ts_rs` is the one
/// canonical derive line, spelled exactly one way — so the whole alias/import class above (any name for
/// the crate or the item other than the literal one this scan matches) cannot compile silently past it,
/// from ANY file this scan reads; a build that tries fails the test binary outright, every time, rather
/// than needing the next spelling named first. It does NOT guarantee no derive can dodge the scan by a
/// route that never writes the bytes `ts_rs` in any `.rs` file this scan opens. Three such routes are
/// named, not denied.
///
/// A `Cargo.toml` rename of the `ts-rs` dependency (a different key in `[dependencies]` with
/// `package = "ts-rs"`, e.g. `bindgen = { package = "ts-rs" }`) routes every derive through a path —
/// `bindgen::TS` — that contains neither `ts_rs` nor the canonical line; this scan reads `.rs` source
/// text and never opens `Cargo.toml`, so such a derive is invisible to it, not refused by it. A macro
/// that expanded to `derive(...ts_rs::TS...)` only at its call site would hide the token from the TEXT
/// this function reads, since nothing here expands macros — the call site itself carries no `ts_rs`
/// bytes.
///
/// **A `#[path = "..."]` THAT RESOLVES OUTSIDE `crate_root` pulls in a file this walk never opens, and
/// IS THE THIRD ROUTE, FOUND BY THE WHOLE-BRANCH REVIEW PAST THE VERSION THAT WALKED THE WHOLE
/// CRATE.** The walk starts at `crate_root` and reads only what sits at or below it — it has no notion
/// of Rust's module system at all, and does not RESOLVE `#[path]` in either direction: a loose file
/// inside the tree is read because it physically sits there, not because the walk followed anything to
/// find it, and a file outside the tree stays unread for the identical reason, regardless of how many
/// `#[path]` attributes name it. `#[path = "../../tsalias.rs"]` in `src/lib.rs`, resolving to
/// `crates/tsalias.rs` — one directory ABOVE `crate_root`, one level further out than the whole-crate
/// walk above already covers — reproduces the prior gap exactly, one level higher. **THIS SCAN IS NOT
/// WIDENED A FIFTH TIME TO CLOSE IT.** Four widenings have each bought one more round before the next
/// `#[path]` moved the boundary again; a fifth walk starting one directory higher is defeated by the
/// same construction moved one directory higher still, forever. The honest boundary is that this walk
/// reads `.rs` files by physical location under one root and does not, and cannot without parsing Rust
/// itself, resolve where a `#[path]` attribute sends the compiler.
///
/// None of the three is closed by this scan; each would need a different mechanism entirely (reading
/// `Cargo.toml`, expanding macros, or resolving `#[path]` the way `rustc` does) to see.
///
/// **The structural alternative, for whoever wants this class actually closed, is `ts-rs`'s own derive
/// macro, not a wider text scan.** `derive(TS)` emits one `export_bindings_*` test per exported type, so
/// filtering `--list`'s own output for that prefix counts them without shelling out to a second `cargo`
/// (see the lock hazard below): `cargo test -p redextape-core --features ts --lib export_bindings --
/// --list` reads `12 tests, 0 benchmarks` on `redextape-core`'s clean tree today and 13 under every
/// construction above (the crate-alias, the `src/`-only gap, and this `#[path]`-outside-the-root gap
/// alike) — the unfiltered `-- --list` reads the crate's WHOLE test count instead, 707 today, a figure
/// this comment does not track and the wrong one to quote here. The filtered count comes from macro
/// expansion, which sees every derive site `rustc` compiles, not from source text a `#[path]` or a
/// `Cargo.toml` rename can route around. **This gate does
/// not shell out to that count instead, for a reason worth keeping rather than rediscovering: a test
/// binary invoking `cargo test`/`cargo` while it is itself running under `cargo nextest run`/`cargo
/// test` is a build-lock hazard** — cargo holds a lock on the target directory for the duration of a
/// build or test invocation, and a nested invocation launched from inside a running test contends for
/// that same lock, at best serializing this gate behind an unpredictable second build and at worst
/// deadlocking, depending on the invoking harness. The text scan above pays for avoiding that hazard with
/// the four-widenings history recorded above it; the `--list` count would not need widening again, at
/// the cost of introducing exactly the hazard this paragraph names.
///
/// And a doc comment or attribute shape `resolve_item_name` does not recognize is a PANIC, not a pass —
/// loud, but still a shape this heuristic cannot parse the way `rustc` can. What this scan is actually
/// measured against is the sabotage runs recorded against
/// `docs/superpowers/plans/2026-08-30-wire-type-generation-core-types.md`'s Task 2 Step 5 — read that
/// for the counterexamples this construction has been checked against, not this comment's word for it,
/// and the re-runs of those same sabotages recorded against
/// `docs/superpowers/plans/2026-08-31-wire-type-generation-wasm-types.md`'s Task 1 Step 6, which is
/// where those same sabotages were re-run against this function after it was moved into this crate,
/// and all four still fired.
///
/// EVERY LINE THIS FUNCTION DOES NOT RECOGNIZE IS A PANIC NAMING THE FILE AND LINE, NEVER A SKIP. A
/// `continue` on an unrecognized line is exactly the defect this replaced — see `resolve_item_name`,
/// which this delegates the forward scan to and which is where that rule is enforced.
pub fn ts_deriving_type_names_in_crate(crate_root: &Path, scanner_path: &Path) -> BTreeSet<String> {
    fn walk(dir: &Path, self_path: &Path, names: &mut BTreeSet<String>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                // `target/` is the one directory under a crate root that is build output rather than
                // source — normally it lives at the workspace root instead, but a `CARGO_TARGET_DIR`
                // override could put one here, and it is large enough that walking into it by accident
                // would be its own kind of bug. Nothing else under a crate root is excluded by
                // directory: `tests/`, `benches/`, `examples/`, and any loose file beside `Cargo.toml`
                // are all Rust source this scan now reads, which is the fix for the gap described
                // above.
                if path.file_name().is_some_and(|n| n == "target") {
                    continue;
                }
                walk(&path, self_path, names);
            } else if path == self_path {
                // THE CALLER'S OWN GATE FILE, BY THE PATH IT PASSES AS `scanner_path` — the one
                // file-level exclusion, and it is not a `src/`-shaped carve-out reopening the gap
                // above. `use ts_rs::TS;` at the top of the caller's gate file is the trait import
                // `export_to_string()` needs, present for a reason that has nothing to do with a
                // derive site: that file is a SCANNER's caller, not a candidate for the sabotage it
                // scans for. Widening the walk to include `tests/` (above) would otherwise make the
                // caller's gate file fail its own check on its own legitimate import — a false
                // positive, not a caught sabotage. The exclusion is safe precisely because the
                // caller's gate file declares no `pub struct`/`pub enum` of its own for a derive to
                // attach to; a sabotage that smuggled a real exported type into that gate file would
                // need to add one first, and every other file in the crate — including every other
                // file under `tests/` — is still read.
                //
                // THAT LAST CLAIM IS ENFORCED HERE, NOT MERELY OBSERVED IN THIS COMMENT. A `pub
                // struct`/`pub enum` appended to that same gate file would be exactly the sabotage
                // described above: the exclusion above hides it from the scan, so a `#[cfg_attr(feature
                // = "ts", derive(ts_rs::TS), ts(export))]` attached to it would generate a real
                // `export_bindings_*` test — running in this same binary, alongside the two gates that
                // cannot see it — with neither gate ever asking about it. Read the gate file's own
                // source and refuse the silent exclusion the moment that property stops holding, rather
                // than trusting the comment above to stay true.
                let own_src = fs::read_to_string(&path).unwrap();
                assert!(
                    !own_src.lines().any(|line| {
                        let t = line.trim();
                        t.starts_with("pub struct ") || t.starts_with("pub enum ")
                    }),
                    "{} declares a `pub struct`/`pub enum` of its own now, which makes the scanner's \
                     self-exclusion above unsafe: a `ts_rs::TS` derive attached to a type declared HERE \
                     would be invisible to both gates in this binary, exactly the sabotage the exclusion \
                     was written to assume never happens. Move the type out of this file \
                     into an ordinary crate source file, where the walk above reads it like any other.",
                    path.display()
                );
            } else if path.extension().is_some_and(|e| e == "rs") {
                let src = fs::read_to_string(&path).unwrap();
                let lines: Vec<&str> = src.lines().collect();
                for (i, line) in lines.iter().enumerate() {
                    if !line.contains("ts_rs") {
                        continue;
                    }
                    assert!(
                        line.trim() == CANONICAL_TS_DERIVE,
                        "{}:{} mentions `ts_rs` on a line that is not the canonical derive attribute \
                         ({line:?}). This gate treats {CANONICAL_TS_DERIVE:?}, written verbatim at a \
                         type's derive site, as the ONLY line in the scanned crate's own `.rs` files \
                         allowed to mention `ts_rs` — an import (`use ts_rs::TS;` then bare `derive(TS)`), a \
                         crate alias (`use ts_rs as tsrs;` then `derive(tsrs::TS)`), a differently- \
                         shaped derive list, or any other spelling all fail this assertion, because \
                         every one of them would let a derive site avoid ever writing the exact line \
                         this scan looks for — the same way each was found defeating an earlier, \
                         narrower version of this check. Spell the canonical line out exactly, \
                         unmodified, at the derive site. An ordinary ts-rs key this line does not \
                         carry — `rename`, or any other `ts(...)` key — is not banned: put it on a \
                         SECOND `#[cfg_attr(feature = \"ts\", ts(...))]` line below this one, which \
                         this scan never touches because it does not mention `ts_rs`, and which \
                         `resolve_item_name` already skips over as just another attribute line.",
                        path.display(),
                        i + 1
                    );
                    names.insert(resolve_item_name(&path, &lines, i));
                }
            }
        }
    }
    let mut names = BTreeSet::new();
    walk(crate_root, scanner_path, &mut names);
    names
}

/// From `lines[marker]`, a line containing the literal path `ts_rs::TS`, scan forward over any further
/// attribute lines (`#[...]`) and doc-comment lines (`///...`) to the item they sit above, and return
/// its name. Handles the marker sitting anywhere inside a longer `derive(...)` list
/// (`derive(Default, ts_rs::TS)`), and the derive on its own `cfg_attr` line with `ts(export)` on a
/// separate `cfg_attr` line below it — those intervening attribute lines are skipped, not mistaken for
/// a second marker, because only a line containing `ts_rs::TS` itself triggers a call here.
///
/// PANICS, NAMING `path` AND THE LINE, AT THE FIRST LINE THAT FITS NONE OF: another attribute, a doc
/// comment, or `pub struct NAME` / `pub enum NAME` — including running off the end of the file. A
/// shape this function does not recognize is exactly Finding 1's failure mode one layer down: it must
/// be loud, never a silently skipped line.
fn resolve_item_name(path: &Path, lines: &[&str], marker: usize) -> String {
    let mut i = marker + 1;
    loop {
        let Some(line) = lines.get(i) else {
            panic!(
                "{}:{} carries `ts_rs::TS` but no `pub struct NAME` / `pub enum NAME` line followed \
                 before the file ended. Teach this fixture the new shape.",
                path.display(),
                marker + 1
            );
        };
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with("///") {
            i += 1;
            continue;
        }
        let after_keyword = trimmed.strip_prefix("pub struct ").or_else(|| trimmed.strip_prefix("pub enum "));
        return match after_keyword {
            Some(rest) => rest
                .split(|c: char| c.is_whitespace() || c == '{' || c == '<' || c == '(')
                .next()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| {
                    panic!(
                        "{}:{} carries `ts_rs::TS` but line {} has no type name after `pub \
                         struct`/`pub enum`: {line:?}",
                        path.display(),
                        marker + 1,
                        i + 1
                    )
                })
                .to_string(),
            None => panic!(
                "{}:{} carries `ts_rs::TS` but line {} is neither another attribute, a doc comment, \
                 nor `pub struct NAME` / `pub enum NAME`: {line:?}. Teach this fixture the new shape.",
                path.display(),
                marker + 1,
                i + 1
            ),
        };
    }
}

/// `ts` with every JSDoc block `export_to_string` copied verbatim from a Rust doc comment removed, so
/// a scan over the result asks about the generated declaration and not about prose a doc comment
/// happens to contain. `ts-rs` (without the `format` feature, which neither scanned crate enables)
/// always opens a block on a line that is exactly `/**`, closes it on a line that is exactly ` */`,
/// and writes every line between as ` * ...` or ` *` — verified against `redextape-core`'s own
/// generated output, which already carries a doc comment on `LambdaState` — so matching on those three
/// exact forms is precise, not a prefix heuristic that could also eat a declaration line.
pub fn without_doc_comments(ts: &str) -> String {
    let mut kept = String::new();
    let mut in_doc_comment = false;
    for line in ts.lines() {
        let trimmed = line.trim();
        if !in_doc_comment && trimmed == "/**" {
            in_doc_comment = true;
            continue;
        }
        if in_doc_comment {
            if trimmed == "*/" {
                in_doc_comment = false;
            }
            continue;
        }
        kept.push_str(line);
        kept.push('\n');
    }
    kept
}
