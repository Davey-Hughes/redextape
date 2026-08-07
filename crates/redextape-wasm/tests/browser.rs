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

use js_sys::{Array, Function, Reflect};
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

fn get(obj: &JsValue, key: &str) -> JsValue {
    Reflect::get(obj, &JsValue::from_str(key)).unwrap_or_else(|_| panic!("no property {key}"))
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
    // `None` must arrive as `null`, not `undefined` — §5.1 writes this `TermNode | null`.
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
