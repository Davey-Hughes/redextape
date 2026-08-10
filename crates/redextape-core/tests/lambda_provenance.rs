//! The tag survives β. Design §2.1 asserts that reduction creates no node ex nihilo; this file is
//! that assertion made executable, because the whole coordinate system rests on it.

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
