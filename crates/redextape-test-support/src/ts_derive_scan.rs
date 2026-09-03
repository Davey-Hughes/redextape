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

use quote::ToTokens;
use syn::Token;
use syn::ext::IdentExt;
use syn::parse::{Parse, ParseStream};
use syn::punctuated::Punctuated;

/// The ts-rs field keys that say something about whether the field can be null.
///
/// **`optional` IS THE THIRD, AND IT WAS NEITHER CHECKED NOR NAMED UNTIL THE SECOND WHOLE-BRANCH
/// REVIEW READ THE VENDORED MACRO CRATE.** `ts-rs-macros` 10.1.0 documents it on `FieldAttr`:
/// `#[ts(optional)]` turns `t: Option<T>` into `t?: T`, and only `#[ts(optional = nullable)]` turns
/// it into `t?: T | null`. So the bare flag drops the null exactly as `ts(type = "number")` does, on
/// a boundary where `serde_wasm_bindgen` really does put `null` in the value rather than omitting the
/// key.
///
/// **`skip` AND `flatten` ARE NOT ON THIS LIST AND ARE NOT SILENTLY IGNORED EITHER — THEY ARE A
/// DIFFERENT DEFECT.** `#[ts(skip)]` removes the field from the generated type altogether, which is
/// wrong about the wire in a way this rule does not describe (the field is present, not null), and
/// `#[ts(flatten)]` restructures rather than renullifies. `inline` and `rename` change neither.
/// Naming them is the point: a reader must not infer from a three-element list that every other key
/// is safe.
const NULLABILITY_KEYS: [&str; 3] = ["type", "as", "optional"];

/// Refuse the caller's gate file if it has started declaring types of its own.
///
/// **BOTH WALKS IN THIS MODULE SKIP THAT ONE FILE ENTIRELY, AND A WHOLE-FILE SKIP IS SAFE ONLY WHILE
/// THE FILE HOLDS NOTHING EITHER WALK WOULD WANT TO READ.** A gate file declares no `pub struct` or
/// `pub enum`, so it has no derive site and no field for an override to sit on; a type moved INTO it
/// would be invisible to every check in the binary that scans for it. The exclusion exists because a
/// gate file legitimately mentions `ts_rs` — the trait import `export_to_string` needs — which is not
/// a derive site and would otherwise fail the sibling scan on its own correctness.
///
/// This is asserted rather than commented, and it is called from both walks rather than written
/// twice, for the reason this module's header gives: one implementation, because a second copy drifts
/// the moment one is widened.
fn assert_scanner_file_declares_no_types(path: &Path) {
    let own_src = fs::read_to_string(path).unwrap();
    // PARSED, NOT MATCHED ON TWO PREFIXES. `pub struct ` / `pub enum ` at the start of a trimmed line
    // was the whole test, and a whole-file skip is only as safe as the guard on it: the fifth
    // whole-branch review appended a `pub(crate) struct` carrying the canonical derive and a bad
    // override to a gate file, ran the binary, and got `4 passed; 0 failed` with a real binding file
    // generated — every gate silent, through the guard, on exactly the sabotage the exclusion assumes
    // never happens. A private `struct`, `pub(super)`, a `union`, or a declaration not starting its
    // line all evaded it the same way. `syn` answers "does this file declare a type" exactly.
    struct DeclaresType(bool);
    impl<'ast> syn::visit::Visit<'ast> for DeclaresType {
        fn visit_item_struct(&mut self, _: &'ast syn::ItemStruct) {
            self.0 = true;
        }
        fn visit_item_enum(&mut self, _: &'ast syn::ItemEnum) {
            self.0 = true;
        }
        fn visit_item_union(&mut self, _: &'ast syn::ItemUnion) {
            self.0 = true;
        }
    }
    let mut found = DeclaresType(false);
    if let Ok(parsed) = syn::parse_file(&own_src) {
        syn::visit::Visit::visit_file(&mut found, &parsed);
    }
    assert!(
        !found.0,
        "{} declares a type of its own now — a `struct`, `enum` or `union`, at ANY visibility — \
         which makes this module's self-exclusion unsafe: a `ts_rs::TS` derive, or a field \
         override, attached to a type declared HERE would be invisible to every gate in this \
         binary, exactly the sabotage the exclusion was written to assume never happens. Move the \
         type out of this file into an ordinary crate source file, where the walks read it like any \
         other.",
        path.display()
    );
}

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
                //
                // The assertion itself is [`assert_scanner_file_declares_no_types`], shared with
                // `assert_overrides_match_field_nullability`'s walk, which excludes the same file for
                // the same reason and shipped without this guard until the whole-branch review said so.
                assert_scanner_file_declares_no_types(&path);
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

/// Refuse any ts-rs field override whose replacement disagrees with whether the Rust field is an
/// `Option`, in either direction.
///
/// **THE DEFECT THIS EXISTS FOR WAS SHIPPED TWICE BY THE SAME MECHANISM, AND BOTH RUST GATES PASS ON
/// IT.** `ts(type = "...")` substitutes the WHOLE field type, `Option` and all, so
/// `ts(type = "number")` on an `Option<u64>` generates `number` and silently drops the `| null` that
/// `None` puts on the wire. `no_generated_type_carries_bigint` finds no `bigint` in `number`, and
/// `the_gate_covers_every_exported_type` reads which types carry the derive, never a field. What
/// caught it was `tsc`, and only while a consumer assigned a literal `null` to the field.
///
/// **THIS PARSES RUST WITH `syn`. THE VERSION THAT SCANNED IT AS TEXT WAS DEFEATED BY ORDINARY RUST
/// FOUR TIMES ACROSS THREE REVIEW ROUNDS, AND EVERY ONE OF THOSE WAS A SILENT PASS.** In order: a
/// qualified `std::option::Option<u64>` read as not-an-`Option`; two `ts(...)` groups on one line,
/// of which only the first was read; an anchor sitting inside an attribute opened on an earlier
/// line, which made a `serde(... = "crate::de::opt")` continuation split on its `::` into a
/// fabricated field name and type; and a comment lexer that took the `'"'` char literal — which
/// really appears in `redextape-core`'s tests — for an open string. **[`ts_deriving_type_names_in_crate`]
/// records four widenings of a different text scan and the decision not to attempt a fifth; this is
/// that decision applied here, and the inversion available was not a wider scan but a parser.** Every
/// one of those four defects is a question about Rust's grammar, which is closed, finite, and already
/// answered by the crate `ts-rs` itself uses to read these same attributes.
///
/// **THE SIBLING SCAN STAYS TEXTUAL ON PURPOSE, AND THE DIFFERENCE IS NOT INCONSISTENCY.** That one
/// asks whether a line IS one exact string, byte for byte — a question with no grammar in it, and one
/// whose answer must not depend on a parser agreeing that the line means what it says. This one asks
/// what type a field has and which attributes sit on it, which is a question only a parser can answer.
/// Two mechanisms in one module, each matched to its question.
///
/// **THE RULE, OVER THE THREE KEYS THAT SAY ANYTHING ABOUT NULL** — see [`NULLABILITY_KEYS`] for why
/// those three and not the others. A field is an `Option` exactly when its override claims a null,
/// and any disagreement is a panic: `ts(type = "X")` claims one when `X` has a top-level `null` union
/// member, `ts(as = "Y")` when `Y` parses as a Rust `Option`, and `ts(optional)` claims one only in
/// its `= nullable` form — the bare flag generates `field?: T` and drops it.
///
/// **WHAT THIS DOES NOT COVER, NAMED RATHER THAN DENIED.** A field with NO override is never
/// examined: ts-rs maps `Option` to `| null` on its own, and nothing here would notice that changing.
/// Nullability INSIDE a generic is invisible — `RuleView::read` is `Vec<Option<Symbol>>`, and an
/// override rewriting the element type passes a rule that asks only whether the field's own outermost
/// type is an `Option`. A `type` alias for an `Option` reads as not-an-`Option`, because `syn` parses
/// one file and resolves no names. And a field introduced by a macro is invisible, because nothing
/// here expands macros — the same boundary the sibling scan names.
///
/// **AN OVERRIDE WRITTEN ON AN ENUM VARIANT RATHER THAN ON A FIELD IS NOT SEEN.** `ts-rs-macros`'s
/// `VariantAttr` carries `type` and `as` keys of its own, so that is a real override and not a
/// mistake the compiler would catch — this rule reads field attributes only. What a variant-level
/// override does to the nullability of the variant's payload has not been measured, and a rule
/// guessing at it would be exactly the unmeasured mechanism this module's history is made of. Named
/// here, pinned by a test, and left open.
pub fn assert_overrides_match_field_nullability(crate_root: &Path, scanner_path: &Path) {
    fn walk(dir: &Path, self_path: &Path) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                if path.file_name().is_some_and(|n| n == "target") {
                    continue;
                }
                walk(&path, self_path);
            } else if path == self_path {
                assert_scanner_file_declares_no_types(&path);
            } else if path.extension().is_some_and(|e| e == "rs") {
                check_source(&path, &fs::read_to_string(&path).unwrap());
            }
        }
    }
    walk(crate_root, scanner_path);
}

/// Every field in `src`, checked against the overrides on it. Split out from the walk so the rule can
/// be driven from source fixtures that never touch the filesystem.
///
/// A file that does not parse is a PANIC, not a skip: every file this walk opens is a file `rustc`
/// compiles, so a parse failure means this scan and the compiler disagree about the source — which is
/// exactly the condition under which its answers stop meaning anything.
fn check_source(path: &Path, src: &str) {
    let file = syn::parse_file(src).unwrap_or_else(|e| {
        panic!(
            "{} does not parse as Rust ({e}), so this scan cannot say anything about the overrides \
             in it. Every file this walk opens is one the compiler accepts, so this means the scan \
             and `rustc` disagree about the source rather than that the source is broken.",
            path.display()
        )
    });
    syn::visit::Visit::visit_file(&mut FieldWalk { path }, &file);
}

/// **THE WALK IS `syn`'s OWN VISITOR, NOT A HAND-WRITTEN DESCENT, AND THAT IS THE FIX FOR A CLASS
/// RATHER THAN FOR ITS INSTANCES.** Three rounds of "descend into `mod`", then "and into `fn`
/// bodies", then "and into `impl` methods" were each correct and each left the next container out: a
/// type declared in a nested block, a closure body, a match arm, a `const _: () = { … }` initializer,
/// or a `union` — all ordinary Rust, and every one of them a silent pass. Each had the same witness:
/// the sibling [`ts_deriving_type_names_in_crate`] is line-based and finds a derive wherever it sits,
/// so the two gates in one binary would answer differently about the same type. Implementing `Visit`
/// and overriding only the three item kinds that HAVE fields makes "did you remember to descend into
/// X" stop being a question this code can get wrong.
struct FieldWalk<'a> {
    path: &'a Path,
}

impl<'ast> syn::visit::Visit<'ast> for FieldWalk<'_> {
    fn visit_item_struct(&mut self, node: &'ast syn::ItemStruct) {
        check_fields(self.path, &node.ident.to_string(), &node.fields);
        syn::visit::visit_item_struct(self, node);
    }

    fn visit_item_enum(&mut self, node: &'ast syn::ItemEnum) {
        for variant in &node.variants {
            check_fields(self.path, &format!("{}::{}", node.ident, variant.ident), &variant.fields);
        }
        syn::visit::visit_item_enum(self, node);
    }

    fn visit_item_union(&mut self, node: &'ast syn::ItemUnion) {
        check_fields(self.path, &node.ident.to_string(), &syn::Fields::Named(node.fields.clone()));
        syn::visit::visit_item_union(self, node);
    }
}

/// A tuple field has no name, so it is reported by its index — the shape `resolve_field` used to
/// refuse outright as one it had never been measured against.
fn check_fields(path: &Path, owner: &str, fields: &syn::Fields) {
    for (index, field) in fields.iter().enumerate() {
        let name = field.ident.as_ref().map_or_else(|| index.to_string(), ToString::to_string);
        for (key, value) in ts_keys_on(path, owner, &name, &field.attrs) {
            if NULLABILITY_KEYS.contains(&key.as_str()) {
                check_override(path, owner, &name, &key, value.as_deref(), &field.ty);
            }
        }
    }
}

/// Every `ts(...)` key on one field, from a bare `#[ts(...)]` and from inside any `#[cfg_attr(...)]`.
fn ts_keys_on(path: &Path, owner: &str, field: &str, attrs: &[syn::Attribute]) -> Vec<(String, Option<String>)> {
    let mut found = Vec::new();
    for attr in attrs {
        if attr.path().is_ident("ts") {
            found.extend(ts_keys_in(path, owner, field, &attr.meta));
        } else if attr.path().is_ident("cfg_attr") {
            let inner =
                attr.parse_args_with(Punctuated::<syn::Meta, Token![,]>::parse_terminated).unwrap_or_else(|e| {
                    panic!(
                        "{}: `{owner}.{field}` carries a `cfg_attr` whose contents this scan cannot \
                         read ({e}). This used to be a silent `continue`, in a module whose stated \
                         rule is that an unreadable attribute is a panic and never a skip.",
                        path.display()
                    )
                });
            found.extend(ts_keys_under(path, owner, field, inner.iter()));
        }
    }
    found
}

/// The `ts(...)` keys among `metas`, descending through any further `cfg_attr` nesting.
///
/// **A NESTED `cfg_attr` WAS A SILENT PASS, AND IT IS ORDINARY RUST.**
/// `#[cfg_attr(feature = "a", cfg_attr(feature = "ts", ts(type = "number")))]` compiles, reaches the
/// derive with both features on, and drops the `| null` exactly as the flat form does — while a scan
/// looking one level inside `cfg_attr` found no `ts` key and moved on. Recursion closes it for any
/// depth rather than for the one depth somebody thought of, which is the lesson
/// [`ts_deriving_type_names_in_crate`]'s doc records paying four rounds for.
fn ts_keys_under<'a>(
    path: &Path,
    owner: &str,
    field: &str,
    metas: impl Iterator<Item = &'a syn::Meta>,
) -> Vec<(String, Option<String>)> {
    let mut found = Vec::new();
    for meta in metas {
        if meta.path().is_ident("ts") {
            found.extend(ts_keys_in(path, owner, field, meta));
        } else if meta.path().is_ident("cfg_attr") {
            let syn::Meta::List(list) = meta else {
                panic!(
                    "{}: `{owner}.{field}` carries a `cfg_attr` whose nested entry is not a list \
                     ({}), which this scan cannot read. Skipping it silently is the defect this \
                     module refuses everywhere else.",
                    path.display(),
                    meta.path().to_token_stream()
                )
            };
            let inner =
                list.parse_args_with(Punctuated::<syn::Meta, Token![,]>::parse_terminated).unwrap_or_else(|e| {
                    panic!(
                        "{}: `{owner}.{field}` carries a nested `cfg_attr` this scan cannot read \
                         ({e}). An attribute it cannot read is one it cannot check.",
                        path.display()
                    )
                });
            found.extend(ts_keys_under(path, owner, field, inner.iter()));
        }
    }
    found
}

fn ts_keys_in(path: &Path, owner: &str, field: &str, meta: &syn::Meta) -> Vec<(String, Option<String>)> {
    let syn::Meta::List(list) = meta else {
        panic!(
            "{}: `{owner}.{field}` carries a bare `ts` attribute with no key list, which this scan \
             cannot read. Skipping it silently is the defect this module refuses everywhere else.",
            path.display()
        )
    };
    match syn::parse2::<TsKeys>(list.tokens.clone()) {
        Ok(keys) => keys.0,
        Err(e) => panic!(
            "{}: `{owner}.{field}` carries a `ts(...)` attribute this scan cannot read ({e}). A key \
             it cannot read is a key it cannot check, so this is a panic rather than a skip.",
            path.display()
        ),
    }
}

/// The key list inside one `ts(...)`, parsed the way ts-rs itself parses it.
///
/// **`Ident::parse_any`, BECAUSE `type` IS A KEYWORD**, which is why `syn::Meta` cannot be used for
/// the inside of these attributes even though it reads the outside of them perfectly well.
///
/// **A VALUE MAY BE AN UNQUOTED IDENT, AND REQUIRING QUOTES BROKE THE ONE SPELLING THAT COMPILES.**
/// `ts-rs-macros` reads `optional`'s argument with `Ident::parse`, so `#[ts(optional = nullable)]` is
/// the correct form and `#[ts(optional = "nullable")]` does not compile. A previous version of this
/// parser demanded a string literal, so it panicked `cannot parse` on the only spelling a real crate
/// can contain — and its message then told the reader to write that spelling, which panicked again.
/// **The fixture that claimed to prove the good case passed used the quoted form**, a shape no
/// compiling tree can hold: the test and the parser agreed with each other about a thing that does
/// not exist.
struct TsKeys(Vec<(String, Option<String>)>);

impl Parse for TsKeys {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let mut keys = Vec::new();
        while !input.is_empty() {
            let key = syn::Ident::parse_any(input)?.to_string();
            let value = if input.peek(Token![=]) {
                input.parse::<Token![=]>()?;
                if input.peek(syn::LitStr) {
                    Some(input.parse::<syn::LitStr>()?.value())
                } else {
                    Some(syn::Ident::parse_any(input)?.to_string())
                }
            } else {
                None
            };
            keys.push((key, value));
            if input.peek(Token![,]) {
                input.parse::<Token![,]>()?;
            }
        }
        Ok(Self(keys))
    }
}

/// Whether `ty` is an `Option<...>` at its outermost layer, by the last segment of its path.
///
/// `Option<T>`, `std::option::Option<T>` and `::core::option::Option<T>` all answer yes, because a
/// path's meaning is in its last segment and `syn` hands over the segments rather than a string to
/// match a prefix against. The string-matching version of this question was defeated twice on this
/// branch, once on the field side and once — by the fix for the first — on the `as` side.
fn type_is_option(ty: &syn::Type) -> bool {
    let syn::Type::Path(path) = ty else {
        return false;
    };
    path.path
        .segments
        .last()
        .is_some_and(|seg| seg.ident == "Option" && matches!(seg.arguments, syn::PathArguments::AngleBracketed(_)))
}

/// Whether `ts_type` has `null` as a TOP-LEVEL member of its TypeScript union.
///
/// **`ends_with(" | null")` WAS ONE EXACT SPELLING, AND ORDINARY ONES FAILED IT.**
/// `ts(type = "null | number")` and `ts(type = "number|null")` both admit null in TypeScript, and
/// `rustfmt` never reaches inside a string literal to normalise either. Splitting the union at depth
/// zero asks the question the rule is about rather than matching one way of writing the answer, and
/// it is still not a search for the bytes `null`: `"'null' | number"`, whose first member is a
/// string-literal type, is not a union admitting `null`.
///
/// **`=>` AND `->` DO NOT CLOSE A GENERIC.** `((x: number) => void) | null` left the depth at -1 by
/// the time the top-level `|` was reached, so no member was ever split off and a correct override was
/// reported as a violation.
fn union_admits_null(ts_type: &str) -> bool {
    let bytes = ts_type.as_bytes();
    let mut depth = 0i32;
    let mut start = 0;
    let mut members = Vec::new();
    let mut ended_at_arrow = false;
    for (i, c) in ts_type.char_indices() {
        match c {
            '<' | '(' | '[' | '{' => depth += 1,
            // A `>` that closes an ARROW is not a closer at all. At depth zero it ends the search
            // outright: everything after it is the return type, so `(x: number) => void | null` is a
            // function returning `void | null` rather than a nullable function, and TypeScript only
            // reads that union as the FIELD's when the whole function type is parenthesised — in
            // which case this `>` sits at depth > 0 and is merely skipped.
            '>' if i > 0 && bytes[i - 1] == b'=' => {
                if depth == 0 {
                    ended_at_arrow = true;
                    break;
                }
            }
            '>' if i > 0 && bytes[i - 1] == b'-' => {}
            '>' | ')' | ']' | '}' => depth -= 1,
            '|' if depth == 0 => {
                members.push(&ts_type[start..i]);
                start = i + c.len_utf8();
            }
            _ => {}
        }
    }
    if !ended_at_arrow {
        members.push(&ts_type[start..]);
    }
    members.iter().any(|m| m.trim() == "null")
}

/// The rule itself, in both directions, over all three keys.
fn check_override(path: &Path, owner: &str, field_name: &str, key: &str, value: Option<&str>, field_ty: &syn::Type) {
    let is_option = type_is_option(field_ty);
    let claims_null = match (key, value) {
        // `optional` is a FLAG, and its bare form is the wrong one: `#[ts(optional)]` generates
        // `t?: T`, which says the key may be ABSENT — while this boundary sends the key with a `null`
        // in it. Only `optional = nullable` keeps the null.
        ("optional", v) => v == Some("nullable"),
        ("type", Some(v)) => union_admits_null(v),
        // PARSED AS A RUST TYPE AND ASKED THE SAME QUESTION THE FIELD IS ASKED, rather than matched
        // against a prefix. `ts(as = ...)` names a Rust type, so `syn` can read it exactly.
        ("as", Some(v)) => {
            let parsed = syn::parse_str::<syn::Type>(v).unwrap_or_else(|e| {
                panic!(
                    "{}: `{owner}.{field_name}` has `ts(as = \"{v}\")`, which does not parse as a \
                     Rust type ({e}). `as` names a type ts-rs routes the field through, so a value \
                     that is not one cannot be checked and cannot have compiled either.",
                    path.display()
                )
            });
            type_is_option(&parsed)
        }
        _ => false,
    };
    if is_option == claims_null {
        return;
    }
    // Each key is wrong by a DIFFERENT mechanism, and saying so is the point of the message: an
    // explanation that fits one arm and is quietly false for another teaches the next reader the
    // wrong thing about the attribute they are holding.
    let mechanism = match key {
        "type" => {
            "`ts(type = ...)` replaces the WHOLE field type, `Option` and all, rather than the part \
             of it that needed changing — which is how this defect shipped twice"
        }
        "as" => {
            "`ts(as = ...)` routes the field through the named Rust type's own `TS` impl, so it is \
             THAT type's optionality that reaches the wire type, not the field's"
        }
        _ => {
            "`ts(optional)` generates `field?: T`, which says the KEY MAY BE ABSENT — but this \
             boundary sends the key with a `null` in it, so the two describe different wires. \
             `ts(optional = nullable)` generates `field?: T | null` and does not"
        }
    };
    let remedy = match (is_option, key) {
        (true, "type") => {
            "the field is an `Option`, so the override must say so too — give it a top-level `null` \
             union member, as in `\"number | null\"`"
        }
        (true, "as") => {
            "the field is an `Option`, so the type this routes through must be one as well: \
             `ts(as = \"Option<...>\")`, which carries the optionality in the Rust type by \
             construction"
        }
        (true, _) => "the field is an `Option`, so this must be `ts(optional = nullable)` or nothing at all",
        (false, "type") => {
            "the field is not an `Option`, so nothing on the wire can be null and the override must \
             not claim otherwise — drop the `null` member"
        }
        (false, "as") => {
            "the field is not an `Option`, so nothing on the wire can be null and the type this \
             routes through must not be one either — drop the `Option<...>` wrapper"
        }
        (false, _) => "the field is not an `Option`, so `optional` has nothing to describe here — remove it",
    };
    let written = match value {
        Some(v) => format!("ts({key} = \"{v}\")"),
        None => format!("ts({key})"),
    };
    panic!(
        "{}: `{owner}.{field_name}: {}` carries `{written}`, and the two disagree about whether the \
         field can be null. {mechanism}. Here, {remedy}.",
        path.display(),
        field_ty.to_token_stream()
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A source fixture as `check_source` sees it: a path that only appears in panic messages, and
    /// text that never reaches a compiler.
    fn check(src: &str) {
        check_source(Path::new("fixture.rs"), src);
    }

    #[test]
    fn an_option_field_whose_override_keeps_the_null_passes() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    #[test]
    #[should_panic(expected = "total_steps")]
    fn an_option_field_whose_override_drops_the_null_panics() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    #[test]
    fn a_bare_field_overridden_to_number_passes() {
        check(
            r#"
pub struct TmState {
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub step: u64,
}
"#,
        );
    }

    #[test]
    #[should_panic(expected = "is not an `Option`")]
    fn a_bare_field_whose_override_invents_a_null_panics() {
        check(
            r#"
pub struct TmState {
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub step: u64,
}
"#,
        );
    }

    #[test]
    fn an_option_field_routed_through_as_option_passes() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(as = "Option<u32>"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    #[test]
    #[should_panic(expected = "total_steps")]
    fn an_option_field_routed_through_a_bare_as_panics() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(as = "u32"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// The case a `#[`-prefix anchor passes silently. This shape compiles as Rust.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn an_override_split_across_two_lines_is_still_read() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts",
        ts(type = "number"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// The largest class of `ts(` occurrences in the two scanned crates is this one — identifier
    /// tails, not attributes. No count here: see the anchor's own doc for why this paragraph does
    /// not carry a number that its own existence would change.
    #[test]
    fn an_identifier_ending_in_ts_is_not_an_anchor() {
        check(
            r#"
fn sweep_targets() -> usize {
    let counts = simulate_counts();
    list_of_nats(counts)
}
"#,
        );
    }

    /// `redextape-wasm`'s `session.rs` really does quote the wrong override, four times, in the doc
    /// comment directly above the field it warns about.
    #[test]
    fn a_comment_quoting_the_wrong_override_is_not_an_anchor() {
        check(
            r#"
pub struct TmStatus {
    /// Do not write `ts(type = "number")` here: it drops the `| null`.
    // ts(type = "number") is likewise wrong
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    #[test]
    fn the_canonical_derive_line_is_not_an_anchor() {
        check(
            r#"
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Span {
    pub start: usize,
}
"#,
        );
    }

    #[test]
    fn a_rename_key_carries_no_nullability_claim() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(rename = "totalSteps"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// Parsing only the FIRST key would let this through.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_type_key_after_a_rename_key_is_still_checked() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(rename = "totalSteps", type = "number"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// `ts(type = number)` does not COMPILE — ts-rs reads `type`'s argument with `parse_assign_str`,
    /// which requires a string literal — so no tree this gate walks can contain it, and what the gate
    /// does with it is moot as long as it is not a silent pass. It reads the bare ident as the value
    /// and judges it by the rule, because the parser must accept an unquoted ident for
    /// `optional = nullable`, which is the one spelling of THAT key that does compile.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn an_unquoted_type_value_is_judged_rather_than_passed() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = number))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// A whitespace variant is a RULE violation, not an unparseable line: `cargo fmt` normalises
    /// spacing, and a gate that treated formatting as an unrecognized spelling would be noise.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_whitespace_variant_is_judged_by_the_rule() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type="number"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// SILENT PASS, found by the whole-branch review building the fixture and running it. Two
    /// `ts(...)` groups on one line is legal Rust; reading only the first found `rename`, found no
    /// override, and moved on.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn two_ts_groups_on_one_line_are_both_read() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(rename = "totalSteps"), ts(type = "number"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// SILENT PASS, same origin. `starts_with("Option<")` reads this as not-an-`Option`, so the rule
    /// agreed with an override that had dropped the very `| null` the field puts on the wire.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_fully_qualified_option_is_recognized() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub total_steps: std::option::Option<u64>,
}
"#,
        );
    }

    /// The boundary [`type_is_option`] names and does not close: resolving this means resolving Rust's
    /// type system, not reading a line. Pinned as a test so the hole is a recorded property rather
    /// than something a later reader has to rediscover by being bitten.
    #[test]
    fn a_type_alias_for_an_option_is_a_named_boundary_rather_than_a_catch() {
        check(
            r#"
pub type MaybeSteps = Option<u64>;

pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub total_steps: MaybeSteps,
}
"#,
        );
    }

    /// A false red on correct source: the loop went round again and met `)` where it wanted a key.
    #[test]
    fn a_trailing_comma_inside_the_attribute_is_accepted() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = "number | null",))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// The mirror of the shape sabotage 5 was written for. The anchor was taught the FRONT half of a
    /// split attribute and `resolve_field` was not taught the back half, so this correct source
    /// panicked on the `)]` line.
    #[test]
    fn an_attribute_spread_over_several_lines_resolves_to_its_field() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(
        feature = "ts",
        ts(type = "number | null")
    )]
    #[serde(
        default,
    )]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// `mechanism` branched on the key and `remedy` did not, so this printed an instruction naming a
    /// `| null` that the attribute in front of the reader does not contain.
    #[test]
    #[should_panic(expected = "drop the `Option<...>` wrapper")]
    fn a_wrongly_wrapped_as_on_a_bare_field_says_which_wrapper_to_drop() {
        check(
            r#"
pub struct TmState {
    #[cfg_attr(feature = "ts", ts(as = "Option<u32>"))]
    pub step: u64,
}
"#,
        );
    }

    #[test]
    fn a_block_comment_line_is_not_an_anchor() {
        check(
            r#"
pub struct TmStatus {
    /* ts(type = "number") would be wrong here */
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// SILENT PASS, second review. The anchor sits INSIDE an attribute opened two lines earlier, so
    /// a resolver starting at depth zero took the `serde(...)` continuation for a field, split it on
    /// the `::`, and checked a fabricated name against a fabricated type.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn an_anchor_inside_an_already_open_attribute_still_finds_its_field() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(
        feature = "ts",
        ts(type = "number"),
        serde(deserialize_with = "crate::de::opt_u64")
    )]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// The false-red half of the same defect: no `::` on the continuation line, so the old resolver
    /// panicked on legal source instead of fabricating a field.
    #[test]
    fn a_continuation_line_after_the_anchor_is_not_a_field() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(
        feature = "ts",
        ts(type = "number | null"),
        ts(rename = "totalSteps")
    )]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// SILENT PASS, second review: the `as` arm kept its own `starts_with("Option<")` one line below
    /// the fix that removed the same test from the field side.
    #[test]
    #[should_panic(expected = "step")]
    fn a_qualified_option_in_an_as_override_is_recognized() {
        check(
            r#"
pub struct TmState {
    #[cfg_attr(feature = "ts", ts(as = "std::option::Option<u32>"))]
    pub step: u64,
}
"#,
        );
    }

    #[test]
    fn an_interior_block_comment_line_is_not_an_anchor() {
        check(
            r#"
pub struct TmStatus {
    /*
    Never write ts(type = "number") on this field.
    */
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// Worse than a false red before the fix: this anchored and reported a violation against the
    /// NEXT field, naming an override that field does not carry.
    #[test]
    fn a_trailing_comment_after_code_is_not_an_anchor() {
        check(
            r#"
pub struct TmStatus {
    pub width: u64, // ts(type = "number") is wrong here
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// `#[ts(optional)]` generates `field?: T`, dropping the null — the third key that makes a
    /// nullability claim, and one nothing checked or named until the second review read the macro.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_bare_optional_flag_on_an_option_field_panics() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(optional))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// Both admit null in TypeScript, and `rustfmt` never reaches inside a string literal to
    /// normalise either into the one spelling the old rule accepted.
    #[test]
    fn null_in_any_union_position_or_spacing_is_accepted() {
        check(
            r#"
pub struct A {
    #[cfg_attr(feature = "ts", ts(type = "null | number"))]
    pub a: Option<u64>,
}

pub struct B {
    #[cfg_attr(feature = "ts", ts(type = "number|null"))]
    pub b: Option<u64>,
}
"#,
        );
    }

    /// Still not a search for the bytes `null`: a string-literal type spelled `'null'` is a member
    /// whose value is the STRING, and the field can never actually be null.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_string_literal_type_spelled_null_is_not_a_null_member() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = "'null' | number"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// The text scan REFUSED this shape as one it had never been measured against. A parser has no
    /// trouble with it: the field is unnamed, so it is reported by index.
    #[test]
    fn an_override_on_an_enum_variants_tuple_field_is_checked_by_index() {
        check(
            r#"
pub enum Decoded {
    Text(#[cfg_attr(feature = "ts", ts(type = "string"))] String),
}
"#,
        );
    }

    #[test]
    #[should_panic(expected = "Decoded::Text.0")]
    fn a_tuple_field_that_is_an_option_is_checked_like_any_other() {
        check(
            r#"
pub enum Decoded {
    Text(#[cfg_attr(feature = "ts", ts(type = "string"))] Option<String>),
}
"#,
        );
    }

    /// SILENT PASS, fourth review. Ordinary Rust, and with both features on the inner `ts(...)`
    /// reaches the derive exactly as a flat one would.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_nested_cfg_attr_is_descended_into() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "a", cfg_attr(feature = "ts", ts(type = "number")))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// SILENT PASS, fourth review, and it had a witness: the sibling line-based scan DOES find a
    /// derive on a type declared inside a function, so the two gates in one binary would have
    /// disagreed about whether that type was covered.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_type_declared_inside_a_function_body_is_checked() {
        check(
            r#"
pub fn make() -> u8 {
    #[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
    pub struct Inner {
        #[cfg_attr(feature = "ts", ts(type = "number"))]
        pub total_steps: Option<u64>,
    }
    0
}
"#,
        );
    }

    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_type_declared_inside_an_impl_method_is_checked() {
        check(
            r#"
pub struct Outer;

impl Outer {
    pub fn make(&self) -> u8 {
        pub struct Inner {
            #[cfg_attr(feature = "ts", ts(type = "number"))]
            pub total_steps: Option<u64>,
        }
        0
    }
}
"#,
        );
    }

    /// SILENT PASSES, fifth review — four containers the hand-written descent did not reach, all
    /// ordinary Rust. The visitor reaches them because it descends everywhere by default.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_type_in_a_nested_block_is_checked() {
        check(
            r#"
pub fn outer() {
    {
        pub struct NestedInBlock {
            #[cfg_attr(feature = "ts", ts(type = "number"))]
            pub total_steps: Option<u64>,
        }
    }
}
"#,
        );
    }

    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_type_in_a_closure_body_is_checked() {
        check(
            r#"
pub fn outer() {
    let _f = || {
        pub struct InClosure {
            #[cfg_attr(feature = "ts", ts(type = "number"))]
            pub total_steps: Option<u64>,
        }
    };
}
"#,
        );
    }

    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_type_in_a_match_arm_is_checked() {
        check(
            r#"
pub fn outer(x: u8) {
    match x {
        0 => {
            pub struct InArm {
                #[cfg_attr(feature = "ts", ts(type = "number"))]
                pub total_steps: Option<u64>,
            }
        }
        _ => {}
    }
}
"#,
        );
    }

    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_type_in_a_const_initializer_is_checked() {
        check(
            r#"
const _K: () = {
    pub struct InConst {
        #[cfg_attr(feature = "ts", ts(type = "number"))]
        pub total_steps: Option<u64>,
    }
};
"#,
        );
    }

    /// A `union`'s fields were never visited either. Proved from the REVERSE direction, because
    /// `ts(type = "number")` on a bare `u64` is the CORRECT override and asserting a panic on it was
    /// this fixture's own first mistake — a test that passes for the wrong reason proves nothing.
    #[test]
    #[should_panic(expected = "is not an `Option`")]
    fn a_union_field_is_checked() {
        check(
            r#"
pub union Overlap {
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub total_steps: u64,
    pub other: u32,
}
"#,
        );
    }

    /// `(x: number) => void | null` is a function RETURNING `void | null`, not a nullable function,
    /// so on an `Option` field it is a genuinely non-nullable override. The `=>` guard added for the
    /// parenthesised case created this sibling and then read it as nullable.
    #[test]
    #[should_panic(expected = "on_step")]
    fn an_unparenthesised_arrow_does_not_make_the_field_nullable() {
        check(
            r#"
pub struct Handlers {
    #[cfg_attr(feature = "ts", ts(type = "(x: number) => void | null"))]
    pub on_step: Option<u64>,
}
"#,
        );
    }

    /// The GUARD on the whole-file skip, exercised through a real file. The fifth review appended a
    /// `pub(crate) struct` carrying the canonical derive and a bad override to a gate file and got
    /// every gate silent with a binding really generated — through a guard matching two prefixes.
    #[test]
    #[should_panic(expected = "declares a type of its own")]
    fn the_guard_refuses_a_type_at_any_visibility() {
        let dir = crate::ScratchDir::new("ts-derive-scan-guard").unwrap();
        let file = dir.join("gate.rs");
        std::fs::write(&file, "pub(crate) struct HiddenHere {\n    pub total_steps: Option<u64>,\n}\n").unwrap();
        assert_scanner_file_declares_no_types(&file);
    }

    #[test]
    fn the_guard_accepts_a_gate_file_that_declares_nothing() {
        let dir = crate::ScratchDir::new("ts-derive-scan-guard-ok").unwrap();
        let file = dir.join("gate.rs");
        std::fs::write(&file, "use ts_rs::TS;\n\n#[test]\nfn a_gate() {}\n").unwrap();
        assert_scanner_file_declares_no_types(&file);
    }

    /// A NAMED BOUNDARY, PINNED RATHER THAN CLAIMED CLOSED. `ts-rs-macros`'s `VariantAttr` carries
    /// `type` and `as` of its own, so an override written on the VARIANT is a real ts-rs override —
    /// and this scan reads field attributes only, so it does not see one. What such an override does
    /// to a variant's nullability has not been measured here, and a rule guessing at it would be the
    /// thing this branch spent three review rounds learning not to write. Found while correcting a
    /// fixture in this very module that had put the attribute on the variant by mistake and passed
    /// vacuously because of it.
    #[test]
    fn an_override_on_the_variant_itself_is_not_seen_by_this_rule() {
        check(
            r#"
pub enum Decoded {
    #[cfg_attr(feature = "ts", ts(type = "string"))]
    Text(Option<String>),
}
"#,
        );
    }

    /// The ONE spelling of the nullable form that compiles: ts-rs reads it with `Ident::parse`, so
    /// `optional = "nullable"` is rejected by the compiler and the parser that demanded a string
    /// literal here panicked on every tree that could exist.
    #[test]
    fn optional_nullable_unquoted_is_the_form_that_compiles_and_it_passes() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// SILENT PASS under the text scan: `in_string` was reset per line, so a `/*` inside a multi-line
    /// raw string opened a block-comment state that never closed and blanked the rest of the file.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn a_raw_string_holding_a_comment_opener_does_not_blank_the_file() {
        check(
            r##"
pub const SAMPLE: &str = r#"
/* not really a comment
"#;

pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub total_steps: Option<u64>,
}
"##,
        );
    }

    /// FALSE RED under the text scan, on a construct that is live in `redextape-core`'s tests: the
    /// `'"'` char literal flipped the lexer into string mode for the rest of the line.
    #[test]
    fn a_char_literal_holding_a_quote_does_not_open_a_string() {
        check(
            r#"
pub fn scan(chars: &[char], i: usize) -> bool {
    chars[i] == '"' // ts(type = "number") mentioned in a comment
}

pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub total_steps: Option<u64>,
}
"#,
        );
    }

    /// MIS-RESOLUTION under the text scan: the resolver started on the NEXT line, so an attribute
    /// sharing a line with its field was checked against the field below it.
    #[test]
    #[should_panic(expected = "total_steps")]
    fn an_attribute_sharing_a_line_with_its_field_is_checked_against_that_field() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = "number"))] pub total_steps: Option<u64>,
    pub other: Option<u64>,
}
"#,
        );
    }

    /// FALSE RED under the text scan, which stripped only `pub ` and `pub(crate) `. `pub(super)` is
    /// live in `redextape-core`'s `tm` module.
    #[test]
    fn a_restricted_visibility_field_is_read_like_any_other() {
        check(
            r#"
pub struct TmStatus {
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub(super) total_steps: Option<u64>,
}
"#,
        );
    }

    /// FALSE RED under the text scan: the `>` of the arrow closed a generic that was never opened, so
    /// the union never split and its `null` member was never seen.
    #[test]
    fn an_arrow_type_in_the_union_does_not_close_a_generic() {
        check(
            r#"
pub struct Handlers {
    #[cfg_attr(feature = "ts", ts(type = "((x: number) => void) | null"))]
    pub on_step: Option<u64>,
}
"#,
        );
    }
}
