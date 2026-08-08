//! Runs in headless Chrome via `wasm-bindgen-test`, NOT under `cargo test`. What it proves that the
//! native tests cannot: that the crate links as wasm at all, and that `serde-wasm-bindgen` marshals
//! these types across the boundary rather than merely compiling.
//!
//! EVERY CALL GOES THROUGH `Reflect`, NOT THROUGH RUST. Holding a `Session` as a Rust value and
//! calling its inherent methods would prove nothing this file is here for — it would re-run the native
//! tests in a browser and never touch the generated glue. Reading `session` back out of the object
//! `compile` returns, looking each method up on its prototype, and calling it with `JsValue`
//! arguments is the path a renderer actually takes, so it is the path under test.
//!
//! **WITH ONE EXCEPTION, AND IT IS NOT AN OVERSIGHT: THE FREE EXPORTS.** `the_free_exports_need_no
//! _session` calls `classify_source`/`analyze` as plain Rust, because there is nothing to look them up
//! ON — they are module-level functions rather than methods on a returned object, and
//! `wasm-bindgen-test` hands a test no handle on the generated module's own export table. What those
//! two calls still prove is the half that is reachable from here: that the functions link and run under
//! wasm, and that `to_value` marshals their results. That their JS NAMES exist and are camelCase is
//! closed from the other side instead: `wasm-pack build` emits `pkg/redextape_wasm.d.ts` — the file a
//! renderer actually imports — and it declares every export this crate has, `classifySource` and
//! `analyze` among them, as module-level functions under exactly those camelCase names. A missing or
//! misspelled `js_name` cannot survive that; it simply is not something a test in this file can see.
//! THE EXPECTED VALUES ARE PINNED IN `session.rs`'s NATIVE TESTS TOO, deliberately: "the values that
//! come back are the ones a native run produces" is only a claim if both sides name the same numbers.
//! `let x = 40; x + 2` reduces in 7 β-steps to Church 42 and runs 2,870 δ-steps on a 5-tape machine of
//! 123 states fitted to width 64.

// Test target: `wasm_bindgen_test` functions are not `#[test]` functions, so `clippy.toml`'s
// `allow-expect-in-tests` does not reach them, and neither it nor `allow-panic-in-tests` reaches the
// free helpers below. Stated per target, the same way `viewmodel_contract.rs` does.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use js_sys::{Array, Function, JSON, Object, Reflect};
use redextape_core::tm::EncodingKind;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

fn get(obj: &JsValue, key: &str) -> JsValue {
    Reflect::get(obj, &JsValue::from_str(key)).unwrap_or_else(|_| panic!("no property {key}"))
}

/// Writes `msg` to the browser's console via `console.log`, so a measurement this file makes can be
/// read back out of a headless run rather than only asserted on -- `wasm-pack test --headless` forwards
/// the page's console to this process's own output.
fn console_log(msg: &str) {
    let console = get(&JsValue::from(js_sys::global()), "console");
    call(&console, "log", &[JsValue::from_str(msg)]);
}

fn num(obj: &JsValue, key: &str) -> f64 {
    get(obj, key).as_f64().unwrap_or_else(|| panic!("{key} is not a number"))
}

/// Look `method` up on `obj`'s prototype chain and call it with `args`. The lookup is the point: a
/// method missing from the generated glue fails here rather than silently doing nothing.
fn call(obj: &JsValue, method: &str, args: &[JsValue]) -> JsValue {
    let f: Function = get(obj, method).unchecked_into();
    let arr = Array::new();
    for a in args {
        arr.push(a);
    }
    Reflect::apply(&f, obj, &arr).unwrap_or_else(|e| panic!("{method} threw: {e:?}"))
}

/// `compile(src, "unary")`, unwrapped into `(diagnostics, session)`.
fn compile(src: &str) -> (Array, JsValue) {
    let out = redextape_wasm::compile(src, "unary").expect("compile must not throw");
    let diagnostics: Array = get(&out, "diagnostics").unchecked_into();
    (diagnostics, get(&out, "session"))
}

/// The height of a `TermTree` arena (`ast`, a `lambdaAst` result), computed as a single linear pass
/// over `nodes` rather than by recursing — this is the capability the flat, post-order arena exists to
/// provide, and using it here is the same walk a real renderer would need to lay a term out without
/// recursing in JavaScript. A nested `Box`-shaped payload would force that walk to recurse instead;
/// this helper is a consumer-side demonstration that the arena shape avoids it.
///
/// Post-order guarantees `child_index < parent_index` for every child, so by the time index `i` is
/// reached, `depth[child]` has already been computed for every child `i` can name: no worklist, no
/// stack, no recursion, one forward pass filling a growing `Vec`. `depth[i]` is `0` for `Var`, `1 +
/// depth[body]` for `Abs`, and `1 + max(depth[f], depth[a])` for `App`; the tree's height is the
/// maximum over all of them (which is always `depth[root]`, since a node's depth already folds in
/// every depth beneath it — the max is taken explicitly anyway so this makes no assumption about which
/// index the root is).
fn depth(ast: &JsValue) -> u32 {
    let nodes: Array = get(ast, "nodes").unchecked_into();
    let len = nodes.length();
    let mut depths: Vec<u32> = Vec::with_capacity(len as usize);
    for i in 0..len {
        let node = nodes.get(i);
        let var = get(&node, "Var");
        let d = if !var.is_undefined() {
            0
        } else {
            let abs = get(&node, "Abs");
            if !abs.is_undefined() {
                let tuple: Array = abs.unchecked_into();
                let body = tuple.get(1).as_f64().expect("Abs body index marshals as a number") as usize;
                1 + depths[body]
            } else {
                let app: Array = get(&node, "App").unchecked_into();
                let f = app.get(0).as_f64().expect("App fn index marshals as a number") as usize;
                let a = app.get(1).as_f64().expect("App arg index marshals as a number") as usize;
                1 + depths[f].max(depths[a])
            }
        };
        depths.push(d);
    }
    depths.into_iter().max().unwrap_or(0)
}

#[wasm_bindgen_test]
fn compile_step_and_read_both_legs() {
    let (diagnostics, session) = compile("let x = 40; x + 2");
    assert_eq!(diagnostics.length(), 0, "a clean program has no diagnostics");
    assert!(!session.is_null(), "a clean program has a session");

    // --- the λ leg: 7 β-steps to Church 42, the same figure `session.rs` pins natively.
    let status = call(&session, "lambdaStatus", &[]);
    assert_eq!(get(&status, "available"), JsValue::TRUE, "the λ backend accepts this program");
    // `RunStatus` is a fieldless enum: serde makes it the variant NAME, which is what a renderer
    // switches on to decide whether "continue" is even an honest offer.
    assert_eq!(get(&status, "run").as_string().as_deref(), Some("Running"), "a fresh cursor has not ended");

    let mut steps = 0;
    while call(&session, "stepLambda", &[]) == JsValue::TRUE {
        steps += 1;
        assert!(steps <= 100, "this program normalizes in 7 steps; something is not terminating");
    }
    assert_eq!(steps, 7, "λ step count must cross the boundary intact");

    // `stepLambda` answered false, which alone cannot say WHY. This is the distinction that makes
    // `raiseLambdaCap` decidable, so it has to survive the crossing.
    let ended = call(&session, "lambdaStatus", &[]);
    assert_eq!(get(&ended, "run").as_string().as_deref(), Some("Ended"), "normalized, not capped");

    let state = call(&session, "lambdaState", &[JsValue::from_f64(1_000_000.0)]);
    assert_eq!(num(&state, "step"), 7.0);
    assert_eq!(get(&state, "truncated"), JsValue::FALSE);
    let text = get(&state, "text").as_string().expect("text marshals as a string");
    assert!(text.starts_with("λf. λx. f "), "the normal form is Church 42, got {text:?}");
    assert_eq!(text.matches("f (").count() + 1, 42, "Church 42 applies `f` 42 times, got {text:?}");

    // `spans` is a Vec<(Span, TokenClass)> — a tuple inside a Vec is the shape most likely to be
    // mangled by a serializer, so its arity is checked rather than only its presence.
    let spans: Array = get(&state, "spans").unchecked_into();
    assert!(spans.length() > 0, "a rendered term has token spans");
    let first: Array = spans.get(0).unchecked_into();
    assert_eq!(first.length(), 2, "each span entry is a (Span, TokenClass) pair");

    let ast = call(&session, "lambdaAst", &[JsValue::from_f64(1_000_000.0)]);
    assert!(!ast.is_null(), "an unreachable node budget yields a tree");

    // THE WIRE SHAPE, MEASURED RATHER THAN DESIGNED — PR 3b's `Decoded` lesson, applied before the
    // fact this time. `TermTree` is a struct, so it crosses as an object with `nodes` and `root`;
    // `TermNode` is an EXTERNALLY TAGGED enum, so each node is `{ Var: n }`, `{ Abs: [name, body] }`
    // or `{ App: [f, a] }`. A consumer branches on which key is present — there is no `kind` field.
    let nodes: Array = get(&ast, "nodes").unchecked_into();
    assert!(nodes.length() > 0, "a term has at least one node");
    assert_eq!(
        num(&ast, "root"),
        f64::from(nodes.length() - 1),
        "post-order puts the root last, and `root` says so explicitly"
    );

    // The term here is Church 42 — `λf. λx. f (f ... x)` — so its root is an `Abs`.
    let root_node = nodes.get(nodes.length() - 1);
    let abs: Array = get(&root_node, "Abs").unchecked_into();
    assert_eq!(abs.length(), 2, "`Abs(String, u32)` crosses as a two-element tuple");
    assert!(abs.get(0).as_string().is_some(), "the binder name marshals as a string");
    // THE LOAD-BEARING ASSERTION FOR `u32` OVER `usize`: an index must arrive as a JS number. A
    // `usize` child would cross as a `bigint`, which `as_f64` cannot read and a renderer cannot index
    // an array with.
    assert!(abs.get(1).as_f64().is_some(), "the body index marshals as a number, not a bigint");

    // `{Var:n}` and `{App:[f,a]}` ARE PUBLISHED AS MEASURED FACTS TOO (this file's own comment two
    // blocks up), but until now only `Abs` was actually exercised above. Found by scanning the arena
    // for a real occurrence of each rather than constructing one by hand: Church 42's body is an `App`
    // spine of `f` applied to itself repeatedly, ending in `x`, so both variants exist in this tree.
    let mut saw_var = false;
    let mut saw_app = false;
    for i in 0..nodes.length() {
        let node = nodes.get(i);
        let var = get(&node, "Var");
        if !var.is_undefined() {
            assert!(var.as_f64().is_some(), "node {i}: `Var(u32)` must cross as a bare number, got {var:?}");
            saw_var = true;
        }
        let app = get(&node, "App");
        if !app.is_undefined() {
            let app_pair: Array = app.unchecked_into();
            assert_eq!(app_pair.length(), 2, "node {i}: `App(u32, u32)` must cross as a two-element tuple");
            assert!(
                app_pair.get(0).as_f64().is_some(),
                "node {i}: App's fn index must marshal as a number, not a bigint"
            );
            assert!(
                app_pair.get(1).as_f64().is_some(),
                "node {i}: App's arg index must marshal as a number, not a bigint"
            );
            saw_app = true;
        }
        if saw_var && saw_app {
            break;
        }
    }
    assert!(saw_var, "Church 42's arena has no Var node to assert {{Var:n}} against -- fixture assumption broke");
    assert!(saw_app, "Church 42's arena has no App node to assert {{App:[f,a]}} against -- fixture assumption broke");

    // `None` must arrive as `null`, not `undefined` — §5.1 writes this `TermTree | null`.
    let refused = call(&session, "lambdaAst", &[JsValue::from_f64(1.0)]);
    assert!(refused.is_null(), "a 1-node budget refuses, and refusal marshals as null");
    assert!(!refused.is_undefined(), "null, specifically — a renderer testing `=== null` must see it");

    // --- the TM leg: 2,870 δ-steps on a 5-tape, 123-state machine fitted to width 64.
    let program = call(&session, "tmProgram", &[]);
    assert_eq!(num(&program, "tapes"), 5.0);
    assert_eq!(num(&program, "width"), 64.0);
    assert_eq!(num(&program, "start"), 2.0);
    let states: Array = get(&program, "states").unchecked_into();
    assert_eq!(states.length(), 123, "the whole machine crosses once, and all of it arrives");

    let mut delta = 0;
    while call(&session, "stepTm", &[]) == JsValue::TRUE {
        delta += 1;
        assert!(delta <= 10_000, "this machine halts in 2,870 steps");
    }
    assert_eq!(delta, 2870, "δ step count must cross the boundary intact");
    let tm_ended = call(&session, "tmStatus", &[]);
    assert_eq!(get(&tm_ended, "run").as_string().as_deref(), Some("Ended"), "halted, not capped");

    let tm_state = call(&session, "tmState", &[JsValue::from_f64(3.0)]);
    assert_eq!(num(&tm_state, "step"), 2870.0);
    let window: Array = get(&tm_state, "window").unchecked_into();
    assert_eq!(window.length(), 5, "one window per tape");
    let tape0: Array = window.get(0).unchecked_into();
    assert!(tape0.length() <= 7, "radius 3 yields at most 7 cells, got {}", tape0.length());

    // `tapeSlice` must speak the coordinates `tmState` reported, across the boundary as well as in
    // Rust — the property the whole `window_start`/`heads` coordinate space exists for.
    let starts: Array = get(&tm_state, "window_start").unchecked_into();
    let from = starts.get(0).as_f64().expect("window_start[0] is a number");
    let slice: Array = call(
        &session,
        "tapeSlice",
        &[JsValue::from_f64(0.0), JsValue::from_f64(from), JsValue::from_f64(from + tape0.length() as f64)],
    )
    .unchecked_into();
    assert_eq!(slice.length(), tape0.length(), "slice and window must agree in the same space");
    for i in 0..slice.length() {
        assert_eq!(slice.get(i), tape0.get(i), "cell {i} differs between slice and window");
    }

    // Both raises take a plain JS `number`, not a `bigint`. The shell narrows to `u32` and widens
    // back precisely so §5.1's `raiseLambdaCap(extra: number)` is what a caller writes — passing a
    // number to a `u64` parameter throws `TypeError: Cannot convert 1000 to a BigInt`, so this call
    // succeeding IS the assertion.
    call(&session, "raiseLambdaCap", &[JsValue::from_f64(1000.0)]);
    call(&session, "raiseTmCap", &[JsValue::from_f64(1000.0), JsValue::from_f64(1000.0)]);

    // An absent tape must arrive as a thrown error, not an abort: this is the one path where a Rust
    // `[]` would have poisoned the module instead of returning.
    let f: Function = get(&session, "tapeSlice").unchecked_into();
    let args = Array::new();
    args.push(&JsValue::from_f64(9_999.0));
    args.push(&JsValue::from_f64(0.0));
    args.push(&JsValue::from_f64(10.0));
    assert!(Reflect::apply(&f, &session, &args).is_err(), "an absent tape throws rather than aborting");
}

#[wasm_bindgen_test]
fn a_lambda_limitation_program_reports_a_tm_only_session() {
    // From `three_way_oracle.rs`'s `LAMBDA_LIMITATION_DEMOS`: the λ backend refuses a closure over a
    // captured `let mut`, and the TM backend runs it. A declined leg crossing the boundary is the path
    // most likely to be silently lossy, and §7 says the UI must render it honestly.
    let (diagnostics, session) = compile("let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)");
    assert_eq!(diagnostics.length(), 0, "the program is well-formed; only the λ backend refuses it");
    assert!(!session.is_null(), "a TM-only session is still a session");

    let lambda = call(&session, "lambdaStatus", &[]);
    assert_eq!(get(&lambda, "available"), JsValue::FALSE);
    let reason = get(&lambda, "reason").as_string().expect("reason marshals as a string");
    assert!(!reason.is_empty(), "the reason is the payload the UI needs, and it must survive the crossing");
    // `node: Option<NodeId>` — `Some` must arrive as a number, so the source pane can highlight it.
    assert!(get(&lambda, "node").as_f64().is_some(), "the refusal names a Core node, got {:?}", get(&lambda, "node"));
    // A declined leg has no run to report on, and `None` must arrive as `null` — not `undefined`, and
    // certainly not a made-up "Ended".
    assert!(get(&lambda, "run").is_null(), "there is no λ run to have a status, got {:?}", get(&lambda, "run"));

    // Every λ method now throws rather than aborting the module.
    for method in ["stepLambda", "lambdaState", "lambdaAst"] {
        let f: Function = get(&session, method).unchecked_into();
        let args = Array::new();
        args.push(&JsValue::from_f64(1_000_000.0));
        assert!(Reflect::apply(&f, &session, &args).is_err(), "{method} must throw for an absent leg");
    }

    // The TM leg is unaffected and still steps.
    let tm = call(&session, "tmStatus", &[]);
    assert_eq!(get(&tm, "available"), JsValue::TRUE, "the TM backend does not decline this program");
    assert!(num(&tm, "width") > 0.0, "an available TM leg reports the width it fitted");
    assert_eq!(call(&session, "stepTm", &[]), JsValue::TRUE, "a TM-only session still steps");
}

/// An unknown encoding name is an error, not a silent default — a tape decoded under the wrong
/// encoding is not a degraded answer, it is a different program's answer.
#[wasm_bindgen_test]
fn an_unknown_encoding_is_refused_at_the_boundary() {
    assert!(redextape_wasm::compile("1 + 2", "trinary").is_err());
    assert!(redextape_wasm::compile("1 + 2", "").is_err());
    assert!(redextape_wasm::compile("1 + 2", "unary").is_ok());
    assert!(redextape_wasm::compile("1 + 2", "binary").is_ok());
}

/// A program the front end rejects yields diagnostics and a null session, and the diagnostics carry
/// their span and severity across intact — the shape the editor's gutter reads.
#[wasm_bindgen_test]
fn a_malformed_program_marshals_its_diagnostics() {
    let (diagnostics, session) = compile("let x = ;");
    assert!(session.is_null(), "no session for a program that does not analyze");
    assert!(diagnostics.length() > 0, "a parse error must be reported");

    let first = diagnostics.get(0);
    assert!(get(&first, "message").as_string().is_some_and(|m| !m.is_empty()));
    let span = get(&first, "span");
    assert!(span.is_object(), "a diagnostic carries its span, got {span:?}");
    assert!(num(&span, "end") >= num(&span, "start"), "the span survives as a well-formed range");
    // `Severity` is a fieldless enum: serde makes it the variant NAME, which is what a renderer
    // switches on.
    assert_eq!(get(&first, "severity").as_string().as_deref(), Some("Error"));
}

/// The depth guards must ANSWER rather than trap, on the one target where they were never calibrated.
///
/// **THIS TEST DELIBERATELY STAYS BELOW THE CRASH.** A wasm trap poisons the module for every later
/// case in this file, so nothing here may cross the line — the crash depth itself was measured once
/// by hand and is recorded in the roadmap, not asserted here.
///
/// NESTED PARENS RATHER THAN A LONG LIST LITERAL, and the difference is which guard is on trial.
/// `MAX_PARSE_DEPTH` counts `parse_binary`/block nesting ONLY; a list literal is `Expr::List { items }`
/// — flat in the AST — so 2,000 elements still parse and typecheck with zero diagnostics. Nesting is
/// what the front end bounds: counting literal parens WRITTEN, 299 is the deepest accepted and 300 is
/// the first depth refused. (The parser's own internal depth counter is a different quantity — it
/// first exceeds `MAX_PARSE_DEPTH` = 300 while parsing the 300th paren — and should not be read as a
/// count of parens written.)
#[wasm_bindgen_test]
fn a_deep_program_is_refused_rather_than_trapping() {
    // Deeper than `MAX_PARSE_DEPTH` (300), so the front end refuses it before any backend runs.
    let (diagnostics, session) = compile(&format!("{}0{}", "(".repeat(400), ")".repeat(400)));
    assert!(diagnostics.length() > 0, "a program past the parse guard is refused, not trapped");
    assert!(session.is_null(), "no session for a program that does not analyze");
}

/// Just under the guards, the whole pipeline runs in a browser — which is what says the guards are the
/// thing stopping deep input, rather than the module dying a little further along.
#[wasm_bindgen_test]
fn a_program_just_under_the_guard_still_compiles() {
    let elems = vec!["0"; 200].join(", ");
    let (diagnostics, session) = compile(&format!("[{elems}]"));
    assert_eq!(diagnostics.length(), 0, "200 elements is within every guard");
    assert!(!session.is_null(), "and it compiles in a browser, not only natively");
}

/// THE REGRESSION TEST FOR THE LINK ARG. It exercises the deepest recursion any front-end guard
/// admits — λ lowering at depth ~600 — rather than the parser's, which
/// `a_deep_program_is_refused_rather_than_trapping` above already covers. A 600-element list desugars
/// to a 600-deep `cons`-`Apply` spine, which `MAX_LAMBDA_LOWER_DEPTH` (700) admits — and on wasm32's
/// stock 1 MiB shadow stack that ABORTED the module with `RuntimeError: memory access out of bounds`,
/// measured. It returns here only because `.cargo/config.toml` links with `-zstack-size=8388608`.
///
/// **THE λ ASSERTION IS THE LOAD-BEARING ONE.** Without it this case would still pass if the lowering
/// had DECLINED — no deep recursion, nothing exercised, a green test proving nothing. Only the λ leg
/// is asserted because 600 is past `MAX_LOWER_DEPTH`/`MAX_DEFUNC_DEPTH` (580), so the TM leg declines
/// and no machine runs — which is also why this case costs milliseconds rather than the ~12 seconds a
/// 400-element list does.
///
/// STILL BELOW THE CRASH, and measured rather than assumed: past 580 the TM lowering refuses, so the
/// deepest input any guard admits is a 699-element list, and bisecting the STACK SIZE (the depth
/// cannot be pushed further — the guards refuse first) puts its requirement between 2 and 3 MiB of
/// the 8 given — against the LIST spine specifically. `lambda/lower.rs:36-38` records a store-passing
/// statement spine as ~19% fatter per level than that spine, so the true worst-reachable-case margin
/// is roughly **2.2x–3.4x**, not the 2.7x–4x a straight read of this bisection would give (the
/// decision is unaffected either way — see the roadmap entry for the full derivation).
#[wasm_bindgen_test]
fn a_deep_but_legal_program_needs_the_raised_shadow_stack() {
    let elems = vec!["0"; 600].join(", ");
    let (diagnostics, session) = compile(&format!("[{elems}]"));
    assert_eq!(diagnostics.length(), 0, "a 600-deep cons spine is inside every front-end guard");
    assert!(!session.is_null(), "and at 8 MiB it compiles instead of trapping");
    let lambda = call(&session, "lambdaStatus", &[]);
    assert_eq!(get(&lambda, "available"), JsValue::TRUE, "the λ lowering really recursed 600 deep");
}

/// THE DEPTH-TOLERANCE CASE, and it samples a REDUCED term rather than a compiled one — and, unlike
/// the version this replaces, it MEASURES depth rather than only checking `lambdaAst` came back
/// non-null. A non-null result is true regardless of how deep the sampled term was, since the node
/// budget below is unreachable by construction; only reading the arena's actual height, via `depth`
/// above, can tell a shallow sample from a deep one.
///
/// NOT A REGRESSION TEST, and the distinction is recorded rather than glossed: measured before the
/// arena landed, the `Box`-shaped `TermNode` did not trap at any depth the guards admit on the 8 MiB
/// shadow stack. There is no crash here to pin. What this is instead is a TRIPWIRE: a future change
/// that reintroduces per-level recursion into `lambdaAst`'s marshaling, or that lowers the shadow
/// stack, has nothing to trap on today — this case is what would first notice, by no longer being able
/// to walk a term this deep without itself recursing into a stack it does not have.
///
/// MEASURED IN THIS RUN, IN HEADLESS CHROME, NOT ASSUMED FROM AN EARLIER ONE: fourteen samples at
/// 100-step spacing (thirteen mid-reduction, the fourteenth the normal form) —
/// `[607, 707, 807, 907, 1007, 1107, 1207, 1307, 1407, 1507, 1607, 1707, 1803, 1803]` — peak depth
/// **1803**. The freshly compiled term alone is depth 607; sampling only that would pin a depth well
/// under half of what this program actually reaches mid-reduction, which is why the loop steps rather
/// than reading once. The assertion's threshold, 1,500, sits with real margin below the observed peak
/// and well above the compile-time floor, so a pass means a mid-reduction depth was genuinely observed.
///
/// A GAP HONESTLY LEFT OPEN: 100-step sampling still discretizes a continuously changing depth, so the
/// true peak between two adjacent samples could exceed any single one caught here. The two consecutive
/// 1803s at the end suggest the depth had already leveled off near the normal form by then, and an
/// earlier, coarser 300-step run of this same program recorded 1805 — close enough to this run's 1803
/// to be consistent with a true peak in the low 1800s, but this test does not prove that number is the
/// maximum, only that a depth in that neighborhood was reached.
///
/// THE HELPER ITSELF IS THE OTHER HALF OF THE POINT: `depth` is a consumer-side walk of the arena,
/// computed with one linear pass and no recursion — the capability the flat, post-order shape exists to
/// provide. A `Box`-shaped payload would force this exact walk to recurse in JavaScript instead.
///
/// THE BUDGET IS DELIBERATELY UNREACHABLE: `usize` is 32 bits on wasm32, so 4,000,000,000 is a node
/// budget no term can exhaust. A `null` would mean the BUDGET refused rather than the depth being
/// tolerated, and the case would pass for the wrong reason.
#[wasm_bindgen_test]
fn the_ast_tolerates_the_deepest_term_a_reduction_reaches() {
    let elems = vec!["0"; 600].join(", ");
    let (diagnostics, session) = compile(&format!("[{elems}]"));
    assert_eq!(diagnostics.length(), 0, "a 600-deep cons spine is inside every front-end guard");
    assert!(!session.is_null(), "and it compiles at 8 MiB");

    // MEASURED, NOT THE BRIEF'S DRAFTED `2_000`: this program normalizes in exactly 1,200 β-steps
    // (confirmed via `lambdaState`'s `step` field in a headless-Chrome run), so a 100-step chunk gives
    // roughly a dozen samples across the run rather than four (this run took fourteen, see below) — a
    // spacing dense enough that the earlier 300-step version, which sampled the same run in only four
    // places, could straddle the depth peak entirely.
    let mut chunks = 0;
    let mut depths: Vec<u32> = Vec::new();
    loop {
        let ast = call(&session, "lambdaAst", &[JsValue::from_f64(4_000_000_000.0)]);
        assert!(!ast.is_null(), "the arena crosses at chunk {chunks}");
        depths.push(depth(&ast));
        let status = call(&session, "runLambda", &[JsValue::from_f64(100.0)]);
        chunks += 1;
        assert!(chunks < 500, "this program normalizes well inside 500 chunks");
        if status.as_string().as_deref() != Some("Running") {
            break;
        }
    }

    let ast = call(&session, "lambdaAst", &[JsValue::from_f64(4_000_000_000.0)]);
    assert!(!ast.is_null(), "and on the normal form too");
    depths.push(depth(&ast));
    assert!(chunks > 1, "the loop must have actually stepped — one chunk means the run never ran");

    // MEASURED IN THIS BROWSER, THIS RUN: fourteen samples (thirteen mid-reduction plus the normal
    // form), `[607, 707, 807, 907, 1007, 1107, 1207, 1307, 1407, 1507, 1607, 1707, 1803, 1803]`, peak
    // 1803. 1,500 is comfortably below that peak — a margin of roughly 300 — and comfortably above the
    // 607 the compiled-but-unreduced term alone would give, so a passing run has actually observed a
    // mid-reduction depth, not merely the term this program starts from.
    let peak = depths.iter().copied().max().unwrap_or(0);
    assert!(peak > 1_500, "peak sampled depth was {peak}, expected > 1500; samples were {depths:?}");
}

/// MEASURES V8's OWN LIMITS on a nested plain JS object, independent of `TermTree`/`TermNode`
/// entirely. The design's load-bearing justification for this whole branch is a claim that was never
/// run: *"a 3,000-deep nested object still traps a recursive JS walk or a `JSON.stringify`"*
/// (`docs/superpowers/specs/2026-08-07-termnode-arena-design.md:37`). This project's own standard —
/// applied to the Rust side just above, in `the_ast_tolerates_the_deepest_term_a_reduction_reaches` —
/// is that a claim like this is not established until a program chosen to break it has actually been
/// run. This test runs it, checking both the design's own quoted 3,000 and the smaller 1,805 this
/// project's own reduction is independently measured to reach (a native run recorded in the roadmap;
/// this file's own sampling above measured 1,803).
///
/// BUILT ITERATIVELY: `nested_object` wraps one plain object per level in a loop, never recursing to
/// construct its own input — the fixture must not import the hazard it exists to measure.
///
/// MEASURED, HEADLESS CHROME, THIS RUN (Chrome via `wasm-pack test --headless --chrome`): at depth
/// 1,805 AND at the design's own quoted depth of 3,000, `JSON.stringify` succeeds and the naive
/// recursive walk also succeeds — **neither traps at either depth.** Bisecting further: `JSON.stringify`
/// was not observed to fail at all, up through this test's own 1,000,000-depth safety cap (V8's
/// stringifier does not appear to recurse one native call-stack frame per JS nesting level, unlike the
/// walk below). The naive recursive walk has a real, reproducible boundary: it survives up to 15,000
/// and fails by 15,031 (`RangeError: Maximum call stack size exceeded`) — more than 8x past 3,000, and
/// more than 8x past the 1,805 this project's own programs actually reach.
///
/// VERDICT: the design's specific numeric claim does not hold on this stack. A 3,000-deep plain object
/// traps NEITHER a naive recursive JS walk NOR `JSON.stringify` in headless Chrome — the walk's own
/// boundary is roughly 5x deeper than 3,000, and `JSON.stringify` did not break within a cap more than
/// 300x deeper. **This weakens this branch's stated justification** for the reason the design itself
/// gives most weight to (§0's "now the load-bearing reason"). What remains true, and is worth keeping
/// separate from the falsified number: a JS object CAN be built deep enough to overflow a naive
/// recursive walk — the boundary is real, just at ~15,000 rather than 3,000 — and the arena's iterative
/// `depth` helper above is what lets a consumer avoid ever reaching for that recursive walk at all. The
/// insurance is real; it is insurance against a depth roughly 5x deeper than the design claimed, and
/// `JSON.stringify` on this stack is not shown to be a hazard at any depth this project's own programs
/// could plausibly produce.
#[wasm_bindgen_test]
fn v8_native_limits_on_a_nested_plain_js_object() {
    /// Wraps `depth` plain objects around `null`, one key `"k"` per level: `{k:{k:{k:...null}}}}`.
    /// ITERATIVE, deliberately: this fixture must not recurse to build the very input meant to measure
    /// what recursion cannot survive.
    fn nested_object(depth: u32) -> JsValue {
        let mut acc = JsValue::NULL;
        for _ in 0..depth {
            let level = Object::new();
            Reflect::set(&level, &JsValue::from_str("k"), &acc)
                .unwrap_or_else(|e| panic!("Reflect::set failed while building a nested object: {e:?}"));
            acc = level.into();
        }
        acc
    }

    /// `true` iff `JSON.stringify` completes on `v` without throwing.
    fn stringify_survives(v: &JsValue) -> bool {
        JSON::stringify(v).is_ok()
    }

    /// The one deliberately recursive function this file contains — see this test's own doc: it is
    /// the thing under measurement, and it lives in JavaScript, not Rust (the module-wide iterative
    /// rule binds Rust walks, not the JS program being measured). A named inner function DECLARATION,
    /// not the anonymous outer function `Function::new_with_args` itself returns, so it has a name to
    /// call recursively.
    fn recursive_walker() -> Function {
        Function::new_with_args(
            "o",
            "function walk(o) { \
                 if (o === null || typeof o !== 'object') return 0; \
                 return 1 + walk(o.k); \
             } \
             return walk(o);",
        )
    }

    /// `true` iff `walker(v)` completes without throwing (a `RangeError: Maximum call stack size
    /// exceeded` on a deep enough `v`).
    fn walk_survives(walker: &Function, v: &JsValue) -> bool {
        let args = Array::new();
        args.push(v);
        Reflect::apply(walker, &JsValue::UNDEFINED, &args).is_ok()
    }

    /// Coarse bisection, per this test's brief — exact-frame precision is not the point. `probe` is
    /// assumed true-then-false as `n` grows (more nesting only costs more stack, never less): doubles
    /// `hi` until `probe` fails or `cap` is hit, then narrows to within 50.
    fn find_breakpoint(cap: u32, mut probe: impl FnMut(u32) -> bool) -> (u32, u32) {
        let mut lo = 0u32;
        let mut hi = 1_000u32.min(cap);
        while probe(hi) {
            lo = hi;
            if hi >= cap {
                return (lo, hi); // never broke within the safety cap
            }
            hi = hi.saturating_mul(2).min(cap);
        }
        while hi - lo > 50 {
            let mid = lo + (hi - lo) / 2;
            if probe(mid) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        (lo, hi)
    }

    let walker = recursive_walker();

    // The two numbers this branch's own justification turns on: the design's own quoted depth, and
    // the smaller depth this project's own reduction is independently measured to reach.
    let designs_quoted_depth = 3_000u32;
    let reachable = 1_805u32;
    let stringify_at_quoted = stringify_survives(&nested_object(designs_quoted_depth));
    let walk_at_quoted = walk_survives(&walker, &nested_object(designs_quoted_depth));
    let stringify_at_reachable = stringify_survives(&nested_object(reachable));
    let walk_at_reachable = walk_survives(&walker, &nested_object(reachable));

    // Coarse bisection to find roughly where each actually breaks, independent of the two fixed
    // depths above.
    let cap = 1_000_000u32;
    let (stringify_lo, stringify_hi) = find_breakpoint(cap, |n| stringify_survives(&nested_object(n)));
    let (walk_lo, walk_hi) = find_breakpoint(cap, |n| walk_survives(&walker, &nested_object(n)));

    console_log(&format!(
        "FIX 2 measurement -- at depth {designs_quoted_depth} (the design's own quoted depth): \
         stringify_ok={stringify_at_quoted} walk_ok={walk_at_quoted}. At depth {reachable} (this \
         project's own reachable depth): stringify_ok={stringify_at_reachable} \
         walk_ok={walk_at_reachable}. Bisected: stringify ok up to {stringify_lo}, fails by \
         {stringify_hi} (cap {cap}); walk ok up to {walk_lo}, fails by {walk_hi} (cap {cap})."
    ));

    // THE LOAD-BEARING ASSERTIONS. First, the design's own quoted number: at depth 3,000, the claim
    // says both operations trap. Measured, neither does.
    assert!(
        stringify_at_quoted,
        "JSON.stringify trapped at depth {designs_quoted_depth}, the design's own quoted depth -- the \
         claim would be correct after all"
    );
    assert!(
        walk_at_quoted,
        "the naive recursive walk trapped at depth {designs_quoted_depth}, the design's own quoted \
         depth -- the claim would be correct after all"
    );
    // Second, the smaller depth this project's own programs are actually measured to reach -- the
    // narrower and more directly relevant question.
    assert!(stringify_at_reachable, "JSON.stringify trapped at depth {reachable}, the project's own reachable depth");
    assert!(
        walk_at_reachable,
        "the naive recursive walk trapped at depth {reachable}, the project's own reachable depth"
    );

    // The walk's own measured boundary is real and reproducible: it must be found (not just "didn't
    // break within the cap"), and it must sit comfortably above the design's own quoted depth -- which
    // is the actual insurance the arena's iterative `depth` helper buys a consumer, now measured rather
    // than assumed.
    assert!(walk_hi <= cap, "the recursive walk never broke within the {cap}-depth safety cap");
    assert!(
        walk_lo > designs_quoted_depth,
        "the recursive walk's measured survival boundary ({walk_lo}) does not clear the design's own \
         quoted depth ({designs_quoted_depth}) -- the arena's iterative walk would no longer be buying \
         real headroom over the hazard as described"
    );
}

/// The two free exports, which take no session and must therefore be reachable as module-level
/// functions rather than as prototype methods.
#[wasm_bindgen_test]
fn the_free_exports_need_no_session() {
    let spans: Array = redextape_wasm::classify_source("let x = 40; x + 2").expect("marshals").unchecked_into();
    assert!(spans.length() > 0, "a clean program has tokens to highlight");
    let first: Array = spans.get(0).unchecked_into();
    assert_eq!(first.length(), 2, "each entry is a (Span, TokenClass) pair");

    // Highlighting a broken file is when highlighting matters most.
    let broken: Array = redextape_wasm::classify_source("let x = ;").expect("marshals").unchecked_into();
    assert!(broken.length() > 0, "a file that does not analyze still has tokens");

    let clean: Array = redextape_wasm::analyze("let x = 40; x + 2").expect("marshals").unchecked_into();
    assert_eq!(clean.length(), 0, "a clean program has no diagnostics");
    let errs: Array = redextape_wasm::analyze("let x = ;").expect("marshals").unchecked_into();
    assert!(errs.length() > 0, "a parse error is reported");
    assert_eq!(get(&errs.get(0), "severity").as_string().as_deref(), Some("Error"));
}

/// All three legs, through the glue, agreeing. `Decoded` is an externally tagged enum with struct
/// variants — the shape most likely to be mangled by a serializer — so its tag and payload are both
/// read rather than only its presence.
#[wasm_bindgen_test]
fn all_three_legs_agree_across_the_boundary() {
    let (_, session) = compile("let x = 40; x + 2");

    // Before the λ run, its value is `Unfinished`: a unit variant, which serde renders as a bare
    // string rather than an object.
    let before = call(&session, "lambdaValue", &[]);
    assert_eq!(before.as_string().as_deref(), Some("Unfinished"), "got {before:?}");

    // The chunked loop: three steps at a time, exactly as a renderer drives it.
    let mut chunks = 0;
    loop {
        let st = call(&session, "runLambda", &[JsValue::from_f64(3.0)]);
        chunks += 1;
        assert!(chunks <= 100, "this program normalizes in 7 β-steps");
        match st.as_string().as_deref() {
            Some("Running") => continue,
            Some("Ended") => break,
            other => panic!("unexpected status {other:?}"),
        }
    }
    assert_eq!(chunks, 3, "7 steps at 3 per chunk ends inside the third");

    // `Value { text }` is a struct variant: serde renders it as `{ Value: { text: "42" } }`.
    //
    // MEASURED IN THIS BROWSER, NOT ASSUMED, because PR 3c's renderer reads exactly this. A probe run
    // of `JSON.stringify` on `before` and on the three values below reported, verbatim:
    //
    // ```
    // before    = "Unfinished"
    // lambda    = {"Value":{"text":"42"}}
    // tm        = {"Value":{"text":"42"}}
    // reference = {"Value":{"text":"42"}}
    // ```
    //
    // So `Decoded` is externally tagged with no envelope of its own: a unit variant IS the bare
    // variant-name string, and a struct variant is a one-key object whose value is the fields. This is
    // `serde-wasm-bindgen`'s documented behaviour and not an accident of `serialize_missing_as_null` —
    // `ser.rs` renders unit variants as strings "for compatibility with serde-json" and wraps struct
    // variants in a fresh `Object` keyed by the variant name.
    let expected = |v: &JsValue| {
        let inner = get(v, "Value");
        assert!(inner.is_object(), "a decoded value is a tagged object, got {v:?}");
        get(&inner, "text").as_string()
    };
    let lambda = call(&session, "lambdaValue", &[]);
    let tm = call(&session, "tmValue", &[]);
    let reference = call(&session, "evaluate", &[]);
    assert_eq!(expected(&lambda).as_deref(), Some("42"), "λ");
    assert_eq!(expected(&tm).as_deref(), Some("42"), "TM");
    assert_eq!(expected(&reference).as_deref(), Some("42"), "reference");

    // `evaluateWithBudget` is the one export a caller reaches for when it cannot afford `evaluate`'s
    // five-million-step worst case, so BOTH of its outcomes are read here rather than only the happy
    // one — a budget that finishes must answer exactly what `evaluate` answered, and a budget that does
    // not must come back as a tagged `Fault` rather than as an abort or an empty value. Its `budget`
    // takes a plain JS `number` like the two raises: passing one to a `u64` parameter throws
    // `TypeError: Cannot convert 1000000 to a BigInt`, so this call succeeding IS that assertion.
    let generous = call(&session, "evaluateWithBudget", &[JsValue::from_f64(1_000_000.0)]);
    assert_eq!(expected(&generous).as_deref(), Some("42"), "a budget the program finishes inside");
    let starved = call(&session, "evaluateWithBudget", &[JsValue::from_f64(1.0)]);
    let fault = get(&starved, "Fault");
    assert!(fault.is_object(), "a spent budget is a tagged Fault, got {starved:?}");
    let message = get(&fault, "message").as_string().expect("a fault carries its message across");
    assert!(message.contains("budget"), "the fault must name what ran out, got {message:?}");

    // `tmValue` needed no stepping: the answer came from the run `compile` performed.
    let tm_status = call(&session, "tmStatus", &[]);
    assert_eq!(num(&tm_status, "total_steps"), 2870.0, "the whole run's length");
    assert_eq!(
        get(&tm_status, "run").as_string().as_deref(),
        Some("Running"),
        "and the cursor has not moved — total_steps is not about the cursor"
    );
}

/// The picker's list comes from the registry rather than from a hand-written TypeScript array.
///
/// THREE ASSERTIONS, NOT ONE: that the list is non-empty and names both shipped kinds, that every
/// name it advertises is one `compile` actually accepts, and that the list is exactly
/// `EncodingKind::ALL`'s names in declaration order. The second is what makes this a check on the
/// `encoding_kinds!` registry rather than on a copy of it — a row added to the macro with a broken
/// `parse` arm would pass the first and fail the second. But soundness alone is silent about a row the
/// export drops: a hand-written `vec!["unary", "binary"]` would pass both of those checks forever. The
/// third assertion is the completeness half — it fails the moment `EncodingKind::ALL` grows a kind that
/// `encodings()` does not report, which is the exact drift this export exists to prevent.
#[wasm_bindgen_test]
fn encodings_lists_every_name_compile_accepts() {
    let names: Array = redextape_wasm::encodings().expect("marshals").unchecked_into();
    assert!(names.length() >= 2, "the registry ships at least unary and binary");

    let mut seen: Vec<String> = Vec::new();
    for i in 0..names.length() {
        let name = names.get(i).as_string().expect("each encoding name marshals as a string");
        assert!(
            redextape_wasm::compile("let x = 40; x + 2", &name).is_ok(),
            "`compile` rejected {name:?}, which `encodings()` advertises"
        );
        seen.push(name);
    }
    assert!(seen.iter().any(|n| n == "unary"), "got {seen:?}");
    assert!(seen.iter().any(|n| n == "binary"), "got {seen:?}");

    let expected: Vec<&str> = EncodingKind::ALL.iter().map(|k| k.name()).collect();
    assert_eq!(seen, expected, "`encodings()` must list exactly `EncodingKind::ALL`, in declaration order");
}

/// `tapeNames` crosses as an array of strings, and its length is the lowering's `TAPES`.
///
/// PINNED SEPARATELY FROM `tmProgram().tapes` ON PURPOSE. They agree for a compiled machine and are
/// different facts — one is this compiler's convention, the other is the machine in hand — so a test
/// that read only one would not notice the two coming apart.
#[wasm_bindgen_test]
fn tape_names_are_five_strings_in_tape_order() {
    let names: Array = redextape_wasm::tape_names().expect("tapeNames returns Ok").unchecked_into();
    assert_eq!(names.length(), 5, "the lowering emits five tapes");
    assert_eq!(names.get(0).as_string().as_deref(), Some("REG"));
    assert_eq!(names.get(4).as_string().as_deref(), Some("BOX"));
}
