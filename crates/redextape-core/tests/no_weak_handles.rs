//! The gate behind `LambdaTerm`'s hand-written `Drop`.
//!
//! That destructor unlinks the root's children so the compiler's field drop glue — which runs after
//! it returns — has nothing deep to descend into. It reaches those children through `Rc::get_mut`,
//! which is `Some` only while the strong count is 1 AND no weak handle to the same allocation
//! exists. The strong count is checked at the call site. The second half was, until this file, a
//! grep somebody ran once and wrote into a comment. This runs that grep.
//!
//! THE BAN IS WIDER THAN THE INVARIANT AND THAT IS DELIBERATE. The invariant is about weak handles
//! to a TERM's allocation; this refuses every weak handle anywhere under `src`, because deciding
//! which `Rc` a handle points at needs type resolution a text walk does not have. The crate has
//! none today, so the over-approximation costs nothing; the day one is wanted for an unrelated
//! type, this gate is the conversation about whether the destructor still holds.
//!
//! IT WALKS `src`, NOT THE WHOLE CRATE, and the reason is this file rather than any judgement
//! about the rest of the tree: `NEEDLES` and the self-test's probe fixtures are code lines full of
//! needles, so a walk over the whole crate would flag the gate itself on every run. `tests/` and
//! `examples/` sitting outside the walk is a consequence of that, not a finding that nothing there
//! could matter.
//!
//! THE ROUTES BELOW DEFEAT IT, NAMED HERE RATHER THAN DISCOVERED LATER, in the same spirit as
//! `redextape-test-support`'s derive-site scanner names its own. Naming them is not the same as
//! having enumerated them: `NEEDLES` is a blacklist, and a blacklist holds only the spellings
//! somebody has already thought of. `Rc::new_cyclic` was named here as a route until it was gated
//! instead — it is now the fifth needle below — and that move shortened this list without making it
//! complete.
//!
//! 1. A macro that expands to a downgrade or a cyclic construction only at its call site.
//! 2. A `#[path]` attribute resolving outside `src`.
//! 3. IF a public accessor ever hands out a term's `Rc`, a weak handle minted in `tests/` or
//!    `examples/` would be outside this walk, and a test that then dropped a deep term would still
//!    overflow with nothing here to say why. That route is shut today by privacy rather than by
//!    this gate: `LambdaTerm`'s `Rc` field is private, `crate::lambda::term` has no submodule
//!    outside its own file, and no public function in the crate returns that `Rc` — so
//!    `src/lambda/term.rs` is the whole surface on which a handle to a term can be minted at all.
//!    That is both why banning every file under `src` costs nothing and what makes this route real
//!    the day the field opens up.
//!
//! IT SCANS CODE LINES ONLY. `//`-prefixed lines are skipped, because the destructor's own comment
//! and this file's own prose both discuss weak handles in English and a substring scan over prose
//! would fail against the very explanation it exists to enforce.

// Test target: `clippy.toml`'s `allow-*-in-tests` keys do not reach free helpers in a `tests/`
// target, so the exemption is stated per target, same as every other file under this directory.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::fs;
use std::path::Path;

/// The five spellings that mint or name a weak handle, and what each one is for. `Weak<` catches a
/// type position. `rc::Weak` catches every import route for the type, including
/// `use std::rc::Weak as Alias`. `Rc::downgrade` catches the canonical call. `downgrade` catches
/// that same call under ANY alias for the `Rc` path — `use std::rc::Rc as Handle;` followed by
/// `Handle::downgrade(&t.0)` contains none of the other three and compiles — so the bare form
/// strictly subsumes `Rc::downgrade`, which is kept because it is the spelling the destructor's
/// comment and this file's prose name. The method name is the one part that cannot be aliased the
/// way the type path can, which is what makes the bare form hard to dodge without a macro.
/// `Rc::downgrade` is the only FUNCTION that mints a weak handle from a strong one, but a needle
/// matches a SPELLING, and conflating the two is what let the aliased call above pass this gate.
/// Adding `downgrade` cost nothing when it was added: `grep -rn 'Weak\|downgrade' crates/*/src/`
/// matched no line workspace-wide. `new_cyclic` is the odd one out: it mints nothing from a strong
/// handle, it hands its closure a `&Weak<T>` to the allocation being built, so a call site can reach
/// a weak handle with no `downgrade` and no `Weak` anywhere on the line — the closure's parameter
/// type is inferred, so the call need name neither the type nor the method. It is spelled bare for
/// the same reason `downgrade` is: `use std::rc::Rc as Handle;` then `Handle::new_cyclic(..)`
/// contains no path-qualified form, and that exact alias construction is what defeated this gate
/// once already. It too cost nothing when it was added: `grep -rn 'new_cyclic' crates/` matched no
/// line outside this file's own doc. None of the five appears in ordinary prose about this subject,
/// which is what lets the scan run over string literals as well as code.
const NEEDLES: [&str; 5] = ["Rc::downgrade", "Weak<", "rc::Weak", "downgrade", "new_cyclic"];

/// The 1-based line number and trimmed text of every non-comment line of `src` carrying a needle.
fn offending_lines(src: &str) -> Vec<(usize, String)> {
    src.lines()
        .enumerate()
        .filter(|(_, line)| !line.trim_start().starts_with("//"))
        .filter(|(_, line)| NEEDLES.iter().any(|needle| line.contains(needle)))
        .map(|(i, line)| (i + 1, line.trim().to_string()))
        .collect()
}

fn walk(dir: &Path, hits: &mut Vec<String>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            walk(&path, hits);
        } else if path.extension().is_some_and(|e| e == "rs") {
            let src = fs::read_to_string(&path).unwrap();
            for (line_no, line) in offending_lines(&src) {
                hits.push(format!("{} line {line_no}: {line}", path.display()));
            }
        }
    }
}

/// A gate that has only ever run against a passing tree cannot tell you it still works, so this
/// runs first and feeds the matcher inputs chosen to break it. The benign half matters as much as
/// the offending half: a scan that fired on the destructor's own explanatory comment would be
/// reverted within the hour, and a reverted gate catches nothing. Each benign fixture embeds a
/// needle verbatim inside a comment, so the assertion can only pass because `offending_lines`'
/// comment filter removed the line — not because the fixture happened to dodge the substring it
/// exists to prove the filter catches. One offending fixture — `Handle::downgrade(&t.0)` — spells
/// the call under an aliased `Rc` path and names neither `Rc::downgrade` nor `Weak` at all, because
/// that exact alias route once walked past every other needle and defeated an earlier version of
/// this gate, so pinning it here exercises the `downgrade` needle from this tree rather than only
/// from a report. A second offending fixture spells `Rc::new_cyclic` and was checked character by
/// character to contain none of the other four needles, because a probe that also matches an older
/// needle proves nothing about the new one: `downgrade` shipped for one commit with no probe that
/// could fail for it alone, and every needle added since is pinned by a fixture that is its alone.
#[test]
fn the_scan_catches_every_spelling_it_claims_to_and_no_prose() {
    for probe in [
        "        let handle = Rc::downgrade(&self.0);",
        "struct Holder { back: Weak<Node> }",
        "use std::rc::Weak;",
        "use std::rc::Weak as Backref;",
        "    let w = Handle::downgrade(&t.0);",
        "    let t = Rc::new_cyclic(|me| Node::Leaf(me.clone()));",
    ] {
        assert_eq!(
            offending_lines(probe).len(),
            1,
            "the scan missed a weak-handle spelling it claims to catch: {probe:?}"
        );
    }
    for benign in [
        "// never calls Rc::downgrade anywhere in this crate",
        "/// holds no Weak<Node> field, only strong handles",
        "        // this indented note mentions rc::Weak in passing",
    ] {
        assert!(
            offending_lines(benign).is_empty(),
            "the scan fired on a comment, which would make it unkeepable: {benign:?}"
        );
    }
}

#[test]
fn no_weak_handle_to_a_term_is_ever_created() {
    let src_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut hits = Vec::new();
    walk(&src_root, &mut hits);
    assert!(
        hits.is_empty(),
        "a weak handle now exists under `redextape-core/src`, and `LambdaTerm`'s hand-written \
         `Drop` assumes none does. `Rc::get_mut` returns `None` while a weak handle to the same \
         allocation is alive, so that destructor silently degenerates to the compiler's recursive \
         drop glue and a deep term overflows the stack on teardown — the exact failure it was \
         written to prevent. If the new handle genuinely cannot point at a term's allocation, this \
         gate's own doc explains why it bans the whole crate anyway and what narrowing it would \
         cost. Sites:\n{}",
        hits.join("\n")
    );
}
