//! The tag survives β. Design §2.1 asserts that reduction creates no node ex nihilo; this file is
//! that assertion made executable, because the whole coordinate system rests on it.

// This file carries no unwrap/expect/panic allow because it never trips those lints — it needs
// only the pedantic exemption, for the same reason `clippy.toml` exempts test/example code generally.
#![allow(clippy::pedantic)]

use redextape_core::lambda::reduce::Owner;
use redextape_core::lambda::reduce::reduce_step;
use redextape_core::lambda::term::{LambdaTerm, Node, abs, app, app_owned, beta, var};

/// Every `App` reachable in `t`, as owner tags. Order is a pre-order walk, which is stable enough to
/// compare two terms' multisets without depending on the walk itself.
fn owners(t: &LambdaTerm) -> Vec<Option<u32>> {
    let mut out = Vec::new();
    let mut stack = vec![t.clone()];
    while let Some(cur) = stack.pop() {
        match cur.node() {
            Node::App(f, a, owner) => {
                out.push(*owner);
                stack.push(f.clone());
                stack.push(a.clone());
            }
            Node::Abs(_, b) => stack.push(b.clone()),
            Node::Var(_) => {}
        }
    }
    out
}

#[test]
fn shift_preserves_every_tag() {
    // A term with a free variable, so `shift` cannot take its identity fast path.
    let t = app_owned(abs("x", app_owned(var(0), var(3), 2)), var(3), 1);
    let shifted = redextape_core::lambda::term::shift(1, 0, &t);
    let mut before = owners(&t);
    let mut after = owners(&shifted);
    before.sort_unstable();
    after.sort_unstable();
    assert_eq!(before, after, "shift rebuilt an App without carrying its tag");
}

#[test]
fn subst_preserves_tags_from_both_the_body_and_the_argument() {
    // `subst` replaces index 0 in the body with `s`; `s`'s own tags must arrive intact, once per
    // occurrence, and the body's surviving Apps must keep theirs.
    let s = app_owned(var(5), var(6), 99);
    let body = app_owned(var(0), app_owned(var(0), var(1), 3), 2);
    let out = redextape_core::lambda::term::subst(0, &s, &body);

    let got = owners(&out);
    assert_eq!(got.iter().filter(|o| **o == Some(99)).count(), 2, "one copy of the argument per occurrence");
    assert!(got.contains(&Some(2)), "the body's outer App lost its tag");
    assert!(got.contains(&Some(3)), "the body's inner App lost its tag");
}

#[test]
fn beta_go_preserves_the_exact_tags_of_the_body_and_the_argument() {
    // `beta_go` is the third of the three propagating functions (`shift`, `subst`, `beta_go`) and,
    // unlike the other two, had no direct exact-match test before this one — only the totality test
    // below, which proves membership, not exactness. This mirrors `subst`'s test in shape but exercises
    // what `beta_go` alone does: substitute index 0 with the argument AND decrement every surviving
    // free index above it, in the same walk that must also carry every App's owner tag.
    //
    // body = App( App(Var(0), Var(1), 10), Var(0), 20 ), called as the body of the redex (`beta`
    // substitutes for index 0). Var(0) occurs twice and is replaced by `s` both times; Var(1) is the
    // free index directly above the redex and must be decremented to Var(0) while its parent App keeps
    // its own tag (10) rather than acquiring `s`'s.
    let s = app_owned(var(5), var(6), 99);
    let body = app_owned(app_owned(var(0), var(1), 10), var(0), 20);
    let out = beta(&body, &s);

    let mut got = owners(&out);
    got.sort_unstable();
    let mut want = vec![Some(20), Some(10), Some(99), Some(99)];
    want.sort_unstable();
    assert_eq!(
        got, want,
        "beta_go must carry the body's own App tags exactly and the argument's tag once per occurrence"
    );
}

#[test]
fn a_full_reduction_never_produces_a_tag_that_was_not_in_the_source_term() {
    // TOTALITY, which is the property design §2.1 actually claims: every tag in the reduct traces to
    // a tag in the original. A propagation bug that INVENTED a tag would pass the two tests above.
    //
    // EVERY App BELOW MUST BE TAGGED, WITH A DISTINCT NON-ZERO VALUE — do not "simplify" this back to
    // an untagged inner App. If any App here were `None` (via plain `app`), `None` would be a
    // legitimate member of `allowed`, and the realistic regression — reverting `beta_go`'s `App` arm
    // from `app_tagged(.., *owner)` back to `app(f, a)` — turns every REBUILT tag into `None` too,
    // which is already `allowed`. The assertion below would then never fire, for all 20 iterations,
    // and this test would pass against a full revert of the change it exists to protect. Distinctness
    // guards the same hole in miniature: a mutation that writes one wrong constant tag (e.g.
    // hardcoding `Some(0)`) is caught only if `0` collides with none of these.
    //
    // The term is `(\f. f f) (\y. y y)`, an Ω-variant that never normalises: every step's redex is at
    // the ROOT, which is both why the 20-iteration loop actually runs instead of breaking at step 0,
    // AND why this fixture attributes every observed tag to `beta_go` alone. A root redex makes
    // `reduce_step` return before its descent arms run at all, so nothing but `beta_go` writes a tag
    // in the reducts asserted over below.
    //
    // THE JUSTIFICATION THIS COMMENT USED TO GIVE IS DEAD, AND IT IS NOT WHY THE FIXTURE STAYS THIS
    // SHAPE. It read that `reduce_step`'s non-root path rebuilds spine `App`s through plain `app(..)`,
    // so a redex below the root would emit unrelated `None`s. Task 4 changed exactly that: the descent
    // now rebuilds through `app_tagged_for_rebuild` (`reduce.rs:268,271`), preserving each spine node's
    // own owner, so a deeper fixture would no longer manufacture spurious `None`s. What survives is the
    // narrower point above — root-only keeps the descent out of the picture, so a failure here can only
    // be `beta_go`'s.
    let t = app_owned(abs("f", app_owned(var(0), var(0), 3)), abs("y", app_owned(var(0), var(0), 42)), 7);

    let mut allowed: Vec<Option<u32>> = owners(&t);
    allowed.sort_unstable();
    allowed.dedup();

    let mut cur = t;
    for _ in 0..20 {
        let Some((next, _path, _owner)) = reduce_step(&cur) else { break };
        for tag in owners(&next) {
            assert!(allowed.contains(&tag), "reduction invented the tag {tag:?}, which was in no source node");
        }
        cur = next;
    }
}

#[test]
fn lowering_tags_each_core_construct_at_its_own_root() {
    // `let x = 40; x + 2` is the app's own sample program and the one `viewmodel_contract.rs` uses to
    // pin that `node_to_lambda` never named `x + 2`. Both constructs must be tagged, EACH ON ITS OWN
    // root App, not merely somewhere in the term (`owners()` alone cannot tell "wrong node" from
    // "right node": `core.id()` resolves through the source map identically wherever it lands).
    let src = "let x = 40; x + 2";
    let (program, diags) = redextape_core::parser::parse(src);
    assert!(diags.is_empty(), "the sample program must parse cleanly: {diags:?}");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("the sample program lowers");

    // The two constructs' own ids, read off the parsed Core rather than hardcoded — so this test
    // tracks whatever the parser actually assigned instead of a number that could silently drift.
    let (let_id, binop_id) = match &core {
        redextape_core::core::Core::Let { id, mutable: false, body, .. } => match body.as_ref() {
            redextape_core::core::Core::BinOp(binop_id, redextape_core::core::BinOp::Add, ..) => (*id, *binop_id),
            other => panic!("expected the let's body to be `x + 2` (a BinOp), got {other:?}"),
        },
        other => panic!("expected a top-level immutable Let, got {other:?}"),
    };

    // Resolve a NodeId through the source map to the exact source text it names.
    let resolve = |id: u32| -> &str {
        let span = map.source_span(id).unwrap_or_else(|| panic!("tag {id} resolves to no source span"));
        &src[span.start..span.end]
    };

    // 1. The ROOT term's own owner is the `Let`'s own App — asserted via `LambdaTerm::owner()`
    // directly on the root, not via a flattened walk that would accept the tag landing anywhere.
    assert_eq!(term.owner(), Some(let_id), "the lowered term's root must be tagged with the Let construct's own id");
    // `"let x = 40;"` AND NOT THE WHOLE PROGRAM — THE FACT THE WHOLE `Within` ARGUMENT RESTS ON.
    // `desugar.rs`'s `Stmt::Let` arm records `Stmt::Let`'s OWN statement span (`spans.push((id, *span))`,
    // `desugar.rs:119-123`), which covers the binding syntax only, even though the `Core::Let` it builds
    // encloses every following statement as its `body`. Were the map to record the enclosing block's span
    // instead, the root's tag would name the entire program — and since the root is the outermost `App`,
    // every `Within` step in the run would resolve to it. "Somewhere inside `let x = 40;`" is a real
    // narrowing; "somewhere inside the whole program" is exactly the degenerate nearest-enclosing-node
    // answer 5b refused on the TM leg, and design §6's M2 threshold would have been a formality. That
    // is why this asserts the exact text rather than merely that `resolve` returns something.
    assert_eq!(resolve(let_id), "let x = 40;", "the Let's tag must resolve to the let binding's own source text");

    // 2. Descend by STRUCTURE — not by searching — to the BinOp's own App. `lower.rs`'s `Let` arm
    // builds `app_owned(abs(name, lower(body)), lower(value), let_id)`, and `lower_expr`'s `BinOp`
    // arm returns its OWN tagged App directly (no extra spine node in between), so the shape is:
    // root = App(Abs("x", <BinOp's own App>), <value>, Some(let_id)).
    let Node::App(f, _value, _) = term.node() else { panic!("root is not an App: {:?}", term.node()) };
    let Node::Abs(_name, body) = f.node() else { panic!("the Let's function side is not an Abs: {:?}", f.node()) };
    let Node::App(_, _, binop_owner) = body.node() else { panic!("the Abs body is not an App: {:?}", body.node()) };
    assert_eq!(
        *binop_owner,
        Some(binop_id),
        "the BinOp's own App — the Abs body reached by descending root -> AppL -> AbsBody — must be \
         tagged with the BinOp's own id, not left untagged or tagged on some other App"
    );
    assert_eq!(resolve(binop_id), "x + 2", "the BinOp's tag must resolve to exactly `x + 2`");

    // 3. Exactly these two tags exist anywhere in the term. A missed site (fewer tags) and a
    // spurious extra tag (more tags, e.g. a curried-spine App wrongly tagged too) both fail this.
    let present: std::collections::BTreeSet<u32> = owners(&term).into_iter().flatten().collect();
    assert_eq!(
        present,
        std::collections::BTreeSet::from([let_id, binop_id]),
        "exactly the Let's and BinOp's own roots must be tagged, nothing more and nothing less"
    );
}

#[test]
fn contracting_a_tagged_redex_reports_exact() {
    // The redex App carries tag 7 itself.
    let t = app_owned(abs("x", var(0)), var(3), 7);
    let (_next, path, owner) = reduce_step(&t).expect("a redex exists");
    assert!(path.is_empty(), "the redex is at the root");
    assert_eq!(owner, Owner::Exact(7));
}

#[test]
fn contracting_an_untagged_redex_under_a_tagged_ancestor_reports_within() {
    // Outer App is tagged 5 and is NOT a redex (its function side is an App, not an Abs).
    // The redex is the untagged inner App on the function side.
    let inner = app(abs("x", var(0)), var(1));
    let t = app_owned(inner, var(2), 5);
    let (_next, path, owner) = reduce_step(&t).expect("a redex exists");
    assert_eq!(path, vec![redextape_core::lambda::term::Dir::AppL]);
    assert_eq!(owner, Owner::Within(5), "the innermost tagged ancestor, not the redex's own tag");
}

#[test]
fn contracting_with_no_tag_anywhere_reports_none() {
    // Design §5.1: this is the COMMON case in real programs, not an edge case.
    let t = app(abs("x", var(0)), var(3));
    let (_next, _path, owner) = reduce_step(&t).expect("a redex exists");
    assert_eq!(owner, Owner::None);
}

#[test]
fn exact_beats_an_enclosing_tag() {
    // Both the redex and its ancestor are tagged; the redex's OWN tag wins.
    let redex = app_owned(abs("x", var(0)), var(1), 9);
    let t = app_owned(redex, var(2), 5);
    let (_next, _path, owner) = reduce_step(&t).expect("a redex exists");
    assert_eq!(owner, Owner::Exact(9), "a node's own tag must beat its ancestor's");
}

#[test]
fn within_names_the_innermost_enclosing_tag_not_the_outermost() {
    // Two tagged ancestors. The INNER one (3) must win over the outer one (5).
    let redex = app(abs("x", var(0)), var(1));
    let middle = app_owned(redex, var(2), 3);
    let t = app_owned(middle, var(4), 5);
    let (_next, _path, owner) = reduce_step(&t).expect("a redex exists");
    assert_eq!(owner, Owner::Within(3), "innermost enclosing, not outermost");
}

#[test]
fn the_cursor_exposes_the_last_step_owner_and_redex() {
    let t = app_owned(abs("x", var(0)), var(3), 7);
    let mut c = redextape_core::trace::LambdaCursor::new(&t, 100);
    assert_eq!(c.last_owner(), Owner::None, "before any step there is no owner");
    assert!(c.last_redex().is_none(), "before any step there is no redex");

    let ev = c.next().expect("one step");
    assert_eq!(ev, redextape_core::trace::StepEvent::Beta { redex: Vec::new(), owner: Owner::Exact(7) });
    assert_eq!(c.last_owner(), Owner::Exact(7), "the cursor must retain what the event carried");
    assert_eq!(c.last_redex(), Some(&Vec::new()));
}

/// **THE TWO β-LOOPS COMPUTE `Owner` BY DIFFERENT MEANS, AND THIS IS WHERE THEY ARE HELD EQUAL ON
/// SHAPES CHOSEN FOR THE ZIPPER'S SPECIFIC WAYS OF GETTING IT WRONG.** `reduce_step_go` reads the
/// redex's tag off the `App` it is about to contract and carries the enclosing tag DOWN a root→redex
/// descent. `ZipperCursor` never builds that `App` at all: the tag rides `Frame::AppL` from the moment
/// the node was decomposed, and the enclosing tag comes from a reverse scan of the context stack.
///
/// `zipper_equivalence.rs` already holds the two equal over 256 generated programs and six lowered
/// shapes, and those ARE tagged (`lower.rs` tags `BinOp` and `If` at their own root `App`, which is
/// all `arb_expr_over` emits — measured: 115 `Exact`, 522 `Within`, 228 `None` across the six curated
/// programs). What lowering cannot reach is arbitrary tag placement: a tag on the argument side of a
/// spine, a tag separated from its redex by a binder, a tagged redex whose parent is also tagged. Each
/// row below names the frame-level mistake it would catch.
///
/// The expected first-step owner is pinned per row as well as compared across loops, because agreement
/// alone is satisfied by both loops being wrong in the same direction — e.g. if `Owner` were `None`
/// everywhere.
#[test]
fn both_beta_loops_agree_on_the_owner() {
    let omega_body = app(var(0), var(0));
    let cases: Vec<(&str, LambdaTerm, Owner)> = vec![
        // The redex is the root and carries its own tag. Catches `reduce_here` ignoring the popped
        // frame's `owner`.
        ("exact at the root", app_owned(abs("x", var(0)), var(3), 7), Owner::Exact(7)),
        // Untagged redex, tagged ancestor reached by descending its FUNCTION side. Catches a missing
        // context-stack scan.
        ("within, reached via AppL", app_owned(app(abs("x", var(0)), var(1)), var(2), 5), Owner::Within(5)),
        // Untagged redex, tagged ancestor reached by descending its ARGUMENT side. **The row that
        // catches `advance` dropping the tag when it converts an `AppL` frame into an `AppR` frame for
        // the same `App` node** — the AppL-only rows above all pass with that bug in place.
        ("within, reached via AppR", app_owned(var(9), app(abs("x", var(0)), var(1)), 5), Owner::Within(5)),
        // Two tagged ancestors. Catches a scan that takes the outermost (an unreversed iterator).
        (
            "within names the innermost of two ancestors",
            app_owned(app_owned(app(abs("x", var(0)), var(1)), var(2), 3), var(4), 5),
            Owner::Within(3),
        ),
        // A binder sits between the redex and the tagged ancestor. `Frame::AbsBody` yields `None`, and
        // the scan must SKIP it rather than stop at it — the same way `reduce_step_go`'s `Abs` arm
        // passes `enclosing` through untouched. Catches a scan written as `stack.last()`.
        (
            "a binder between the redex and its tagged ancestor",
            app_owned(var(9), abs("z", app(abs("x", var(0)), var(1))), 5),
            Owner::Within(5),
        ),
        // The redex is tagged AND has a tagged ancestor: the own tag must win. Catches a `match` that
        // gives `Within` precedence over `Exact` — which is also the precedence that makes reading the
        // enclosing tag before rather than after the pop harmless (see `reduce_here`'s doc).
        (
            "a redex's own tag beats its ancestor's",
            app_owned(app_owned(abs("x", var(0)), var(1), 9), var(2), 5),
            Owner::Exact(9),
        ),
        // The control. Nothing is tagged, so nothing may be reported — a scan that invented a tag from
        // an `AbsBody` frame or from the focus would fail here and nowhere else.
        ("no tag anywhere", app(abs("x", var(0)), var(3)), Owner::None),
        // **A TAG THAT MUST SURVIVE A STEP ON THE FRAME.** Step 1 contracts the untagged `App` on the
        // function side (`Within(11)`); that turns the tagged root into a redex, which `seek_resuming`
        // takes by its parent-check fast path WITHOUT re-descending — so step 2's `Exact(11)` can only
        // come from the frame that has been sitting on the stack since before step 1.
        (
            "the tagged parent becomes the redex after a step",
            app_owned(app(abs("f", var(0)), abs("y", var(0))), var(3), 11),
            Owner::Within(11),
        ),
        // The search must climb out of an exhausted left branch (through an `AppR` frame, the one place
        // navigation rebuilds a node) before it reaches the tagged redex on the right.
        (
            "a tagged redex reached only after a climb",
            app_owned(app(var(0), abs("x", var(0))), app_owned(abs("y", var(0)), var(1), 21), 5),
            Owner::Exact(21),
        ),
        // A tagged term that never normalizes, so the comparison covers 50 steps rather than a handful.
        // This is the brief's original single case, kept as the long-run row.
        (
            "a diverging tagged term",
            app_owned(abs("f", omega_body.clone()), abs("y", app_owned(var(0), var(0), 42)), 7),
            Owner::Exact(7),
        ),
    ];

    for (label, t, expected_first) in cases {
        let plain: Vec<_> = redextape_core::trace::LambdaCursor::new(&t, 50).collect();
        let zipped: Vec<_> = redextape_core::trace::ZipperCursor::new(&t, 50).collect();
        assert!(!plain.is_empty(), "{label}: the fixture must take at least one step");
        assert_eq!(plain, zipped, "{label}: the two beta loops disagree on Owner");

        let Some(redextape_core::trace::StepEvent::Beta { owner, .. }) = plain.first() else {
            panic!("{label}: a lambda cursor must emit Beta events");
        };
        assert_eq!(*owner, expected_first, "{label}: wrong owner for the first step");
    }
}

/// **THE TAGS IN THE RESULTING TERM, WHICH `zipper_equivalence.rs` STRUCTURALLY CANNOT SEE.**
/// `LambdaTerm`'s `PartialEq` ignores an `App`'s owner (`term.rs`: `(Node::App(f1, a1, _),
/// Node::App(f2, a2, _)) => f1 == f2 && a1 == a2`), so a zipper that rebuilt its context spine through
/// plain `app` would return a term comparing EQUAL to `LambdaCursor`'s while carrying no provenance at
/// all — and every assertion in the equivalence gate would still pass. `reduce_to_normal_form` is
/// written over `ZipperCursor`, so that term is shipped output, not an internal.
///
/// Three positions, because the zipper rebuilds an `App` at three sites and each fixture below reaches
/// only one of them: `advance`'s climb (a run that ends at the root), `term()`'s `AppR` fold arm (a run
/// capped with a tagged `AppR` frame on the stack), and `term()`'s `AppL` fold arm (a run capped with a
/// tagged `AppL` frame on the stack instead). The third exists because `LambdaTerm`'s tag-blind
/// `PartialEq` also hides the `AppL` arm from `zipper_equivalence.rs`'s capping cases, and no other
/// fixture in this file leaves a tagged `AppL` frame on the stack while a tag assertion runs.
#[test]
fn the_zippers_normal_form_keeps_the_tags_the_plain_loop_keeps() {
    fn tags(t: &LambdaTerm) -> Vec<Option<u32>> {
        let mut v = owners(t);
        v.sort_unstable();
        v
    }

    fn drain(t: &LambdaTerm, cap: u64) -> (LambdaTerm, LambdaTerm) {
        let mut lc = redextape_core::trace::LambdaCursor::new(t, cap);
        lc.by_ref().count();
        let mut zc = redextape_core::trace::ZipperCursor::new(t, cap);
        zc.by_ref().count();
        (lc.term().clone(), zc.term())
    }

    // 1. Normalizes. The only redex is on the right, so the search climbs out of the exhausted left
    //    branch through an `AppR` frame — `advance`'s rebuild — and the tagged root (5) is what that
    //    rebuild reconstructs. A climb through plain `app` loses it.
    let climbing = app_owned(app(var(0), abs("x", var(0))), app(abs("y", var(0)), var(1)), 5);
    let (plain, zipped) = drain(&climbing, 50);
    assert_eq!(plain, zipped, "the two loops must reach the same normal form");
    assert!(tags(&plain).contains(&Some(5)), "the fixture must keep its tag in the normal form at all");
    assert_eq!(tags(&zipped), tags(&plain), "the zipper's normal form dropped a tag the plain loop kept");

    // 2. Caps with a non-empty context stack, so the term comes back through `term()`'s fold instead.
    //    `\k. v1 ((\x. x x)(\x. x x))` with the inner application tagged 5: the diverging redex sits in
    //    its argument, under a live binder, so the stack is `[AbsBody, AppR{owner: 5}, ...]` at every
    //    capping step and the fold has to put the 5 back.
    let omega_component = abs("x", app(var(0), var(0)));
    let capped = abs("k", app_owned(var(1), app(omega_component.clone(), omega_component.clone()), 5));
    let (plain, zipped) = drain(&capped, 12);
    assert_eq!(plain, zipped, "the two loops must reach the same capped term");
    assert!(tags(&plain).contains(&Some(5)), "the fixture must keep its tag in the capped term at all");
    assert_eq!(tags(&zipped), tags(&plain), "the zipper's fold dropped a tag the plain loop kept");

    // 3. Caps with a tagged `AppL` frame on the stack instead of `AppR`: `((\x. x x)(\x. x x)) 3`
    //    tagged 5. The root's function side is `(\x. x x)(\x. x x)` — an App, not an Abs — so the root
    //    is never itself a redex; the diverging redex sits inside that function side and keeps
    //    reducing to itself, so the search never climbs back out and the stack stays `[AppL{owner:
    //    5}]` for the whole run. Only `term()`'s `AppL` fold arm can put the 5 back here.
    let appl_capped = app_owned(app(omega_component.clone(), omega_component), var(3), 5);
    let (plain, zipped) = drain(&appl_capped, 12);
    assert_eq!(plain, zipped, "the two loops must reach the same capped term");
    assert!(tags(&plain).contains(&Some(5)), "the fixture must keep its tag in the capped term at all");
    assert_eq!(tags(&zipped), tags(&plain), "the zipper's fold dropped a tag the plain loop kept");
}

/// **THE DUPLICATION GUARD, AND THE REASON THE REGION ENTRY IS NOT A TAGGING SITE.**
/// `lower_region(node)` and `lower_region_body(node)` are called with the SAME node, so tagging both
/// would put one `NodeId` on two distinct `App`s. Design §1 rejects that; this is what notices if it
/// comes back.
///
/// **AND PER-CONSTRUCT PRESENCE THROUGH THE RESOLVED SOURCE TEXT, NOT A COUNT.** A `unique.len() >= 3`
/// floor would assert that *some* three tags exist, which stays green if one arm is wired up and
/// another is not. Resolving each tag to its own source text names which arms actually fired.
#[test]
fn region_constructs_tag_their_own_roots_without_duplicating() {
    let src = "let mut n = 2; while n > 0 { n = n - 1; } n";
    let (program, diags) = redextape_core::parser::parse(src);
    assert!(diags.is_empty(), "the fixture must parse cleanly: {diags:?}");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("the fixture lowers");

    let tags: Vec<u32> = owners(&term).into_iter().flatten().collect();
    let unique: std::collections::BTreeSet<u32> = tags.iter().copied().collect();
    assert_eq!(
        tags.len(),
        unique.len(),
        "a construct tagged more than one App — the region entry duplication design §1 rejects: {tags:?}"
    );

    let resolve = |id: u32| -> &str {
        let span = map.source_span(id).unwrap_or_else(|| panic!("tag {id} resolves to no source span"));
        &src[span.start..span.end]
    };
    let texts: Vec<&str> = unique.iter().map(|id| resolve(*id)).collect();
    assert!(
        texts.iter().any(|t| t.starts_with("let mut")),
        "the region's `let mut` must carry a tag of its own, got {texts:?}"
    );

    // The `Seq` joining the while-statement to its continuation `n`, and the `While` itself, BOTH
    // carry tags now (the latter as of the task that added `a_whiles_tag_names_the_loop_and_not_the_
    // whole_program`, below) — and the desugarer gives that `Seq` the same span as the statement it
    // opens with, so `While`'s own span is CHARACTER-IDENTICAL to `"while n > 0 { n = n - 1; }"`. A
    // text-only assertion here could not tell whose tag it was looking at: it would stay green whether
    // the Seq's tag, the While's, or (wrongly) only one of the two survived. Anchoring to each
    // construct's own `NodeId` is what a text match cannot do — exactly this project's recorded defect
    // shape, an assertion that has stopped looking at which node it names.
    let seq_id = find_id(&core, &|c| matches!(c, redextape_core::core::Core::Seq(..)))
        .expect("the fixture's while-statement is joined to its continuation by a Seq");
    let while_id =
        find_id(&core, &|c| matches!(c, redextape_core::core::Core::While(..))).expect("the fixture contains a while");
    assert_ne!(seq_id, while_id, "the Seq and the While it opens with are distinct nodes");
    assert!(
        unique.contains(&seq_id),
        "the region's `Seq` (joining the while-statement to `n`) must carry a tag of its own, got {texts:?}"
    );
    assert!(
        unique.contains(&while_id),
        "the region's `While` must carry a tag of its own, distinct from its enclosing Seq's, got {texts:?}"
    );
    assert_eq!(
        resolve(seq_id),
        "while n > 0 { n = n - 1; }",
        "the Seq's tag must resolve to exactly the while-statement's span — the same span the While's \
         tag also resolves to, which is why the NodeId checks above (not this text) are what tell them apart"
    );
}

/// **FINDING 1: THE FOURTH TAGGED ARM, OBSERVED.** `lower_region_body`'s `Let { mutable: false }` arm
/// (`lower.rs:637`) was the one tagged arm with no fixture reaching it: neither the fixture above nor
/// `a_region_ifs_tag_sits_on_its_outer_application`'s below contains an immutable `let` in region
/// position, and every other test in this file stays green whether or not that arm tags anything at
/// all — reverting `lower.rs:637`'s `app_owned(..)` back to plain `app(..)` left the whole file green.
///
/// `let k = 1;` sits in the body of the region-opening `let mut n`, which `lower_region_body`'s
/// `Let { mutable: true }` arm hands to `lower_region_body` again for its continuation — exactly
/// where the `Let { mutable: false }` arm fires, rather than the separate (untagged-by-this-task)
/// functional-path `Let` arm in `lower_expr` that a top-level immutable `let` would hit instead.
#[test]
fn region_immutable_let_is_tagged_at_its_own_root() {
    let src = "let mut n = 0; let k = 1; n = k; n";
    let (program, diags) = redextape_core::parser::parse(src);
    assert!(diags.is_empty(), "the fixture must parse cleanly: {diags:?}");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("the fixture lowers");

    let let_id = find_id(&core, &|c| matches!(c, redextape_core::core::Core::Let { mutable: false, .. }))
        .expect("the fixture contains an immutable let");
    app_tagged_with(&term, let_id).expect(
        "the region's immutable `let k = 1;` must carry a tag of its own root App — this is exactly \
         what reverting lower.rs's `Let { mutable: false }` arm back to plain `app(..)` breaks",
    );

    let span = map.source_span(let_id).unwrap_or_else(|| panic!("tag {let_id} resolves to no source span"));
    assert_eq!(
        &src[span.start..span.end],
        "let k = 1;",
        "the immutable let's tag must resolve to its own binding text"
    );
}

/// **WHICH `App` THE TAG LANDS ON, WHICH FLATTENING A TERM INTO A TAG SET CANNOT SEE.** A region `If`
/// builds `app(app(lc, lt), le)` and only the OUTER application is the construct's own root; tagging
/// the inner one leaves the tag set identical, resolves through the source map identically, and is
/// exactly the wrong-node defect this project has now hit in several disguises.
///
/// The discriminator is the condition's own shape. `true` lowers to a Scott boolean — an `Abs` — so
/// on the outer application the function side is an `App`, and on the inner one it would be that
/// `Abs`. A fixture with an application-shaped condition could not tell the two apart.
#[test]
fn a_region_ifs_tag_sits_on_its_outer_application() {
    let src = "let mut n = 0; if true { n = 1; } else { n = 2; }; n";
    let (program, diags) = redextape_core::parser::parse(src);
    assert!(diags.is_empty(), "the fixture must parse cleanly: {diags:?}");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, _map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("the fixture lowers");

    let if_id =
        find_id(&core, &|c| matches!(c, redextape_core::core::Core::If(..))).expect("the fixture contains an if");
    let tagged = app_tagged_with(&term, if_id).expect("the region If's own root App must be tagged");
    let Node::App(f, _, _) = tagged.node() else { unreachable!("app_tagged_with returns an App") };
    assert!(
        matches!(f.node(), Node::App(..)),
        "the tag sits on the INNER application — `app(app(lc, lt), le)`'s outer node is the If's own \
         root, and `true` lowers to an Abs so the inner one's function side is not an App"
    );
}

/// The `App` carrying `id`, if exactly one does. Returns `None` when no node carries it; panics when
/// two do — the `found.len() <= 1` assert below is what forbids that, not the duplication-guard
/// assertion in `region_constructs_tag_their_own_roots_without_duplicating` above, which runs over
/// that test's own fixture only and says nothing about whatever term a different caller passes here
/// (e.g. `a_region_ifs_tag_sits_on_its_outer_application`'s `if` fixture, below).
fn app_tagged_with(t: &LambdaTerm, id: u32) -> Option<LambdaTerm> {
    let mut found: Vec<LambdaTerm> = Vec::new();
    let mut stack = vec![t.clone()];
    while let Some(cur) = stack.pop() {
        match cur.node() {
            Node::App(f, a, owner) => {
                if *owner == Some(id) {
                    found.push(cur.clone());
                }
                stack.push(f.clone());
                stack.push(a.clone());
            }
            Node::Abs(_, b) => stack.push(b.clone()),
            Node::Var(_) => {}
        }
    }
    assert!(found.len() <= 1, "tag {id} sits on {} Apps; it must sit on exactly its own root", found.len());
    found.pop()
}

/// The `NodeId` of the first `Core` node in a pre-order walk satisfying `pred`. Read off the parsed
/// tree rather than hardcoded, so these tests track whatever ids the parser assigns instead of a
/// number that could drift. Iterative, like every other `Core` walk in this suite (see `find_first`
/// in `tests/sourcemap_coverage.rs`, the same function over `&Core` rather than `NodeId`) —
/// `Core::for_each_child`'s doc (`core.rs:85-89`) states that a long statement sequence desugars to a
/// spine tens of thousands of nodes deep and that recursive traversal of it "aborts the process with
/// an uncatchable stack overflow", so a caller "walks the tree with its own explicit worklist"; this
/// function IS that caller, not licence to call itself.
fn find_id(core: &redextape_core::core::Core, pred: &impl Fn(&redextape_core::core::Core) -> bool) -> Option<u32> {
    let mut stack = vec![core];
    while let Some(n) = stack.pop() {
        if pred(n) {
            return Some(n.id());
        }
        n.for_each_child(&mut |c| stack.push(c));
    }
    None
}

/// **THE FACT THE WHOLE `Within` ARGUMENT RESTS ON, FOR THE LOOP.** A `While`'s tag encloses its
/// entire body, so if it resolved to the whole program instead of the loop's own text, every
/// `Within` step inside a loop would name the program — the degenerate nearest-enclosing-node
/// answer 5b refused on the TM leg. This is the same assertion 5c added for `Let`'s span, for the
/// same reason. Asserted as a prefix and a strict-substring bound rather than an exact literal: the
/// property is "the loop, not the program", not a particular slice of the fixture.
///
/// `app_tagged_with` anchors presence on the While's own `NodeId`, not on resolved text — the same
/// fixture's `Seq` (joining the while-statement to its continuation `n`) resolves to
/// CHARACTER-IDENTICAL text (`region_constructs_tag_their_own_roots_without_duplicating` above), so a
/// text-only presence check here could pass by finding the Seq's tag instead of the While's.
#[test]
fn a_whiles_tag_names_the_loop_and_not_the_whole_program() {
    let src = "let mut n = 2; while n > 0 { n = n - 1; } n";
    let (program, diags) = redextape_core::parser::parse(src);
    assert!(diags.is_empty(), "the fixture must parse cleanly: {diags:?}");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("the fixture lowers");

    let while_id =
        find_id(&core, &|c| matches!(c, redextape_core::core::Core::While(..))).expect("the fixture contains a while");
    app_tagged_with(&term, while_id).expect("the While's own root App must be tagged");

    let span = map.source_span(while_id).expect("the While's tag resolves to a source span");
    let text = &src[span.start..span.end];
    assert!(text.starts_with("while"), "the While's tag must name the loop, got {text:?}");
    assert!(
        span.end - span.start < src.len(),
        "the While's tag must not span the whole program, got {text:?} of {} bytes",
        src.len()
    );
}

/// **WHICH `App` THE TAG LANDS ON, WHICH FLATTENING A TERM INTO A TAG SET CANNOT SEE.** `build_while`
/// builds `app(app(fix(), g), s_init)` and only the OUTER application is the loop's own root; tagging
/// the inner one — `(fix g)` — instead leaves the tag set identical and resolves through the source
/// map identically, so neither `a_whiles_tag_names_the_loop_and_not_the_whole_program` above nor
/// `region_constructs_tag_their_own_roots_without_duplicating` can tell the two placements apart
/// (confirmed BEFORE THIS TEST EXISTED: mutating `build_while` to tag `(fix g)` instead of its own
/// return left every test binary in the crate green. The test below is what closes that gap — at
/// HEAD, the same mutation now fails it). This is `a_region_ifs_tag_sits_on_its_outer_application`'s
/// idiom, applied here.
///
/// It is not just tidiness: `fix()` is itself an `Abs` (`lower.rs:83-86`, the Y-combinator shape), so
/// `(fix g)` is a redex. Under the WRONG (inner) placement the loop's first β-step would report
/// `Owner::Exact(while_id)` — the redex contracted first carries the tag directly. Under the correct
/// (outer) placement that same first β-step instead descends through the tagged outer App to reach
/// `(fix g)`, so it reports `Owner::Within(while_id)` instead — and disagreeing on `Exact` vs.
/// `Within` here is disagreeing with the path `origins.at_root(*id)` records for the loop, which
/// names the outer App, not `(fix g)`.
///
/// The discriminator is `fix()`'s own shape. On the outer application (the loop's own root) the
/// function side is `(fix g)`, an `App`; on the inner placement the tagged App IS `(fix g)`, whose
/// function side is `fix()` itself, an `Abs`. A fixture that could not tell an `App` function side
/// from an `Abs` one could not tell the two placements apart.
#[test]
fn a_whiles_tag_sits_on_its_outer_application() {
    let src = "let mut n = 2; while n > 0 { n = n - 1; } n";
    let (program, diags) = redextape_core::parser::parse(src);
    assert!(diags.is_empty(), "the fixture must parse cleanly: {diags:?}");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, _map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("the fixture lowers");

    let while_id =
        find_id(&core, &|c| matches!(c, redextape_core::core::Core::While(..))).expect("the fixture contains a while");
    let tagged = app_tagged_with(&term, while_id).expect("the While's own root App must be tagged");
    let Node::App(f, _, _) = tagged.node() else { unreachable!("app_tagged_with returns an App") };
    assert!(matches!(f.node(), Node::App(..)), "the tag sits on the inner `(fix g)`, not the loop's own root");
}

/// `in_position` DISCARDS the loop in value position (`encode::church(0)`), so there is no node to
/// tag and nothing runs. A later "fix" that stopped discarding it would silently start tagging a
/// term the reducer never reaches; this fails if that happens.
///
/// **NOT REACHABLE THROUGH `parser::parse` — BUILT DIRECTLY.** `while` is a `Stmt`, never an
/// `Expr` (`ast.rs`), and `Stmt::While` desugars UNCONDITIONALLY into
/// `Core::Seq(seq_id, While(..), acc)` (`desugar.rs:141-153`) — even for a tail-less block, whose
/// `acc` starts as `Core::Unit`, not the `While` itself (`desugar.rs:93-99`). `Core::Seq`'s `first`
/// is always lowered at `Pos::Store` (the `Core::Seq` arm in `lower_region_body`), never
/// `Pos::Value`. So no parsed program can ever put a `Core::While` node itself in `Pos::Value` — a
/// fixture built through `parser::parse` (as originally tried here, with
/// `"let mut n = 2; while n > 0 { n = n - 1; }"`, on the theory that a tail-less region's last
/// statement lowers in `Pos::Value`) does not test this: it fails, because that `while` is the
/// `first` of a `Seq` and so is tagged anyway, at `Pos::Store`, exactly like every other `while`.
///
/// `Core::While` IS reachable at `Pos::Value`, but only through hand-built `Core` — never through
/// the parser. The path below is the simplest one: the TOP-LEVEL node handed to
/// `lower`/`lower_mapped`. `lower_expr`'s `Core::While(..) => lower_region(core, ..)` arm passes
/// `lower_region` that same node, and `lower_region` (`lower.rs:566`) enters `lower_region_body` on
/// it at `Pos::Value`. It is not the only one: any hand-built node that encloses a `While` in value
/// position reaches the same branch too — e.g. `Core::Lambda(_, ["x"], Core::While(..))`, the shape
/// `forget_discards_a_store_discarding_assigns_subtree_without_dangling_paths` (`lower.rs:1204`)
/// uses for the sibling `Assign` branch, under `lower.rs`'s own "`forget` is reachable only through
/// direct `Core` construction" section (`lower.rs:1193-1198`) — which states the identical
/// structural fact for `Assign`/`While` together, so the two accounts should not drift apart.
/// Constructing the `Core` by hand — bypassing `parser::parse`/`desugar` — is what actually
/// exercises this branch, by any such route.
#[test]
fn a_while_in_value_position_carries_no_tag() {
    use redextape_core::core::Core;
    // A synthetic top-level `While` that mutates nothing, so `collect_region_vars` needs no bound
    // names to resolve and the region opens with zero store slots.
    let while_id = 1;
    let core = Core::While(while_id, Box::new(Core::Bool(2, false)), Box::new(Core::Unit(3)));
    let term = redextape_core::lambda::lower(&core).expect("a trivial standalone while lowers");

    assert!(
        app_tagged_with(&term, while_id).is_none(),
        "a value-position While is discarded by `in_position`; tagging it names a term that never runs"
    );
}
