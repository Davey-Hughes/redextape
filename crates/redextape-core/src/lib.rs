//! Redextape core: the mini-language front end, the λ and TM backends, and the shared analysis
//! layer. This crate is compiled to WASM for the web UI and reused by the CLI and LSP.
//!
//! Pipeline: lexer -> parser -> typecheck -> desugar -> Core AST, from which the reference
//! interpreter, the λ backend, and the TM backend each independently produce a `Value` (the
//! three-way oracle).

// Test code is exempt from `pedantic`, for the reason `clippy.toml` gives for the
// unwrap/expect/panic set: an assertion is a deliberate panic, and a probe that casts a `u64` step
// count to `f64` to print a ratio is not a defect. `cfg_attr` rather than the 36 module-level
// attributes this crate's own inline `#[cfg(test)]` modules would otherwise need — under
// `--all-targets` each lib compiles twice, and `cfg(test)` holds only in the test-harness pass, so
// production warnings still surface from the other one.
#![cfg_attr(test, allow(clippy::pedantic))]

pub mod analysis;
pub mod ast;
pub mod core;
pub mod desugar;
pub mod diagnostic;
pub mod interp;
pub mod lambda;
pub mod lexer;
pub mod lints;
pub mod parser;
pub mod prelude;
pub mod printer;
pub mod sourcemap;
pub mod span;
pub mod tm;
pub mod token;
pub mod trace;
pub mod ty;
pub mod typeck;
pub mod value;
pub mod viewmodel;

pub use diagnostic::{Diagnostic, Severity};
pub use interp::RuntimeError;
pub use span::Span;

/// The library version string, used by the smoke test and later by the CLI `--version`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The result of static analysis: all diagnostics plus the Core AST when the program is clean.
#[derive(Debug)]
pub struct Analysis {
    pub diagnostics: Vec<Diagnostic>,
    pub core: Option<core::Core>,
}

/// Parse, typecheck, and desugar `src`, collecting every static diagnostic. `core` is `Some` only
/// when there are no error-severity diagnostics.
#[must_use]
pub fn analyze(src: &str) -> Analysis {
    let (program, mut diagnostics) = parser::parse(src);
    let Some(program) = program else {
        return Analysis { diagnostics, core: None };
    };
    diagnostics.extend(typeck::typecheck(&program));
    let has_error = diagnostics.iter().any(|d| d.severity == Severity::Error);
    // Lints run only on a program that is otherwise clean. A file with a type error does not also
    // need to be told one of its bindings is unused — and it keeps the blast radius of these rules to
    // programs that previously reported NOTHING, which is the set the tree's `is_empty()` assertions
    // are about.
    if !has_error {
        diagnostics.extend(lints::check(&program));
    }
    let core = if has_error { None } else { Some(desugar::desugar(&program)) };
    Analysis { diagnostics, core }
}

/// Why a `run` did not produce a value.
#[derive(Debug)]
pub enum RunError {
    /// Parse or type errors — the program never ran.
    Static(Vec<Diagnostic>),
    /// The program ran but faulted (e.g. `head` of an empty list, or the step budget).
    Runtime(RuntimeError),
}

/// End-to-end: analyze then evaluate. The convenience entry point for the CLI and tests.
///
/// # Errors
///
/// Returns `RunError::Static` if `src` fails to parse or typecheck — the diagnostics say why, and no
/// evaluation is attempted — or `RunError::Runtime` if evaluation itself faults (the step budget,
/// `head`/`tail` of an empty list, or any other dynamic error `interp::eval` can raise).
pub fn run(src: &str) -> Result<value::Value, RunError> {
    let analysis = analyze(src);
    match analysis.core {
        Some(core) => interp::eval(&core).map_err(RunError::Runtime),
        None => Err(RunError::Static(analysis.diagnostics)),
    }
}

/// Format `src`: parse it and print it back canonically. The formatter is exactly `print ∘ parse`
/// (spec §7.2), so nothing about the input's layout is preserved except its comments and its blank
/// lines, both of which are trivia the printer places by rule.
///
/// # Errors
///
/// Returns the parse diagnostics when `src` does not parse. There is no partial format: a file that
/// does not parse is returned untouched to the caller, which is the only safe thing to do with it.
pub fn format(src: &str) -> Result<String, Vec<Diagnostic>> {
    format_with_width(src, printer::MAX_WIDTH)
}

/// `format`, to a chosen line budget.
///
/// # Errors
///
/// The parse diagnostics when `src` does not parse — identical to `format`, which is this at
/// `printer::MAX_WIDTH`.
pub fn format_with_width(src: &str, width: usize) -> Result<String, Vec<Diagnostic>> {
    let (parsed, diagnostics) = parser::parse_full(src);
    match parsed {
        Some(p) => Ok(printer::print_with_width(&p, width)),
        None => Err(diagnostics),
    }
}

#[cfg(test)]
mod smoke_tests {
    use super::*;

    #[test]
    fn version_is_exposed() {
        assert_eq!(VERSION, "0.0.0");
    }

    #[test]
    fn format_returns_canonical_text_or_the_diagnostics_that_stopped_it() {
        assert_eq!(format("let  x=1;x").expect("formats"), "let x = 1;\nx\n");
        let err = format("let x = ;").expect_err("does not parse");
        assert!(!err.is_empty(), "and says why");
    }
}

#[cfg(test)]
mod api_tests {
    use super::*;

    #[test]
    fn analyze_reports_parse_errors_with_spans() {
        let src = "(1 + 2";
        let a = analyze(src);
        assert!(a.core.is_none());
        assert_eq!(a.diagnostics.len(), 1);
        assert!(a.diagnostics[0].message.contains(')'));
        // The span points at where `)` was expected (EOF, an empty range at end of source).
        let span = a.diagnostics[0].span;
        assert!(span.start <= span.end && span.end <= src.len(), "span out of bounds: {span:?}");
        assert_eq!(span.start, 6);
        assert_eq!(span.end, 6);
    }

    #[test]
    fn analyze_reports_type_errors() {
        let a = analyze("1 + true");
        assert!(a.core.is_none());
        assert!(a.diagnostics.iter().any(|d| d.message.contains("Nat")));
    }

    #[test]
    fn analyze_succeeds_on_valid_program() {
        let a = analyze("let x = 1; x + 2");
        assert!(a.diagnostics.is_empty());
        assert!(a.core.is_some());
    }

    #[test]
    fn run_returns_value_for_valid_program() {
        assert_eq!(run("let x = 40; x + 2").unwrap(), value::Value::Nat(42));
    }

    #[test]
    fn run_returns_static_errors_for_invalid_program() {
        match run("1 + true") {
            Err(RunError::Static(ds)) => assert!(!ds.is_empty()),
            other => panic!("expected static error, got {other:?}"),
        }
    }

    #[test]
    fn run_returns_runtime_error_for_head_of_empty() {
        match run("head(nil)") {
            Err(RunError::Runtime(e)) => assert!(e.message.contains("empty list")),
            other => panic!("expected runtime error, got {other:?}"),
        }
    }

    #[test]
    fn deep_binary_chain_is_a_diagnostic_not_a_stack_overflow() {
        // A `1 + 1 + ...` chain nested well above the typechecker's depth guard must surface as a
        // Diagnostic (with `core: None`), never a native typecheck stack overflow.
        let src = format!("1{}", " + 1".repeat(5000));
        let a = analyze(&src);
        assert!(a.core.is_none());
        assert!(a.diagnostics.iter().any(|d| d.message.contains("nested too deeply")), "diags: {:?}", a.diagnostics);
    }
}

/// Each of the three recursively-owned types (`Core`, `Expr`, `Value`) is torn down by a
/// hand-written iterative `Drop`, so dropping a tree tens of thousands of nodes deep uses bounded
/// stack instead of aborting the process (SIGABRT) via recursive `drop_in_place`.
///
/// The `.cargo/config.toml` `RUST_MIN_STACK = 32 MiB` means the default test threads are far too
/// large to overflow at these depths — so each test runs on an EXPLICIT 512 KiB thread that a naive
/// recursive drop of the same tree WOULD overflow (verified: a plain 40 000-deep `Box` cons list
/// aborts a 512 KiB thread). Each test building its tree without overflowing and then joining
/// cleanly proves the iterative teardown works; a regression would abort the whole test process.
///
/// Depth 40 000 is within the token/step limits (`~80 001 < MAX_TOKENS = 100 000`; the `while` loop
/// is `O(1)` eval depth so `MAX_EVAL_DEPTH` never trips). Each test isolates the target type's
/// build+drop from any deep-recursive analysis pass that would itself overflow 512 KiB:
///   - Core  via `analyze` (parse/typecheck/desugar of a list literal are all shallow-iterative),
///     NOT `run`, because evaluating the deep `cons`-`Apply` spine needs several MiB to reach the
///     `MAX_EVAL_DEPTH` guard.
///   - Expr  via `parser::parse` (an iterative left-nested build), NOT `analyze`, because
///     typecheck's own depth guard recurses to `MAX_TYPE_DEPTH = 1500`, overflowing 512 KiB before
///     the drop is ever reached.
///   - Value via `run` of a `while` loop (`O(1)` eval depth), whose deep runtime `Cons` list is
///     dropped when the environment tears down as `eval` returns.
#[cfg(test)]
mod drop_tests {
    /// Deep `Core` (`Box`/`Vec` cons-`Apply` spine from a big list literal): built by `analyze`,
    /// dropped when the returned `Analysis` drops.
    #[test]
    fn dropping_deep_core_tree_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                let src = format!("[{}]", vec!["1"; 40_000].join(", "));
                let a = crate::analyze(&src); // builds the deep Core...
                assert!(a.core.is_some(), "expected a clean list literal to desugar");
                drop(a); // ...and tears it down iteratively here.
            })
            .unwrap()
            .join()
            .unwrap();
    }

    /// Deep `Expr` (left-nested `Binary` chain): built by the parser, dropped when the returned
    /// `Program` drops.
    #[test]
    fn dropping_deep_expr_tree_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                let src = format!("1{}", " + 1".repeat(40_000));
                let (program, _diags) = crate::parser::parse(&src); // builds the deep Expr...
                assert!(program.is_some(), "expected the binary chain to parse");
                drop(program); // ...and tears it down iteratively here.
            })
            .unwrap()
            .join()
            .unwrap();
    }

    /// Deep `Value` (runtime `Cons` list): built by the interpreter in a `while` loop and dropped
    /// when the environment holding it tears down as `run` returns.
    #[test]
    fn dropping_deep_value_list_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                let src = "let mut xs = nil; let mut i = 0; while i < 40000 { xs = cons(i, xs); i = i + 1; } i";
                let _ = crate::run(src); // building + dropping the deep list must not overflow.
            })
            .unwrap()
            .join()
            .unwrap();
    }

    /// A block expression carrying `fn`/`while`/expr statements exercises the iterative-drop
    /// teardown for every `Stmt` kind (`take_stmt_children`) when the parsed `Program` drops.
    #[test]
    fn dropping_block_with_statements_tears_down_cleanly() {
        let src = "{ fn g() { 0 } let mut x = 0; while x > 5 { x = x + 1; } g(); g() }";
        let (program, diags) = crate::parser::parse(src);
        assert!(diags.is_empty(), "diags: {diags:?}");
        assert!(program.is_some());
        drop(program); // exercises take_stmt_children's Fn/While/expr-statement arms
    }

    /// `Core::LetRecGroup` (mutual-recursion slice, Task 2) is the highest-risk edit to
    /// `take_core_children`: a binding group's children live in TWO places — every binding's VALUE
    /// (an unboxed `Core` inside a `Vec`, not a `Box<Core>`) and the `body`. Missing either one means
    /// the compiler's own field drop-glue (which runs after our custom `drop()` returns) recurses into
    /// that un-unlinked child via a genuine Rust function call instead of our explicit worklist — and
    /// if that child is another `LetRecGroup` down a long chain, each level adds one more native stack
    /// frame until it overflows. Nothing produces this variant from source yet (Task 3 desugars into
    /// it), so it is built directly here, the same way `interp.rs`'s own unit test does.
    ///
    /// Two chains, so each half of the invariant is independently falsifiable: chaining through
    /// `body` (bindings shallow) would only catch a forgotten `body`; chaining through a binding's
    /// VALUE (body shallow) would only catch a forgotten bindings-vec drain.
    #[test]
    fn dropping_deep_letrecgroup_chain_through_body_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                use crate::core::{Core, NodeGen};
                let mut g = NodeGen::default();
                let mut acc = Core::Nat(g.fresh(), 0);
                for _ in 0..40_000 {
                    let bindings =
                        vec![("f".to_string(), Core::Nat(g.fresh(), 0)), ("g".to_string(), Core::Nat(g.fresh(), 0))];
                    acc = Core::LetRecGroup(g.fresh(), bindings, Box::new(acc)); // chain via body
                }
                drop(acc); // must tear down iteratively, not recurse 40,000 deep.
            })
            .unwrap()
            .join()
            .unwrap();
    }

    #[test]
    fn dropping_deep_letrecgroup_chain_through_a_binding_value_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                use crate::core::{Core, NodeGen};
                let mut g = NodeGen::default();
                let mut acc = Core::Nat(g.fresh(), 0);
                for _ in 0..40_000 {
                    // chain via the binding's VALUE this time; the body is a shallow leaf.
                    acc = Core::LetRecGroup(g.fresh(), vec![("f".to_string(), acc)], Box::new(Core::Nat(g.fresh(), 0)));
                }
                drop(acc);
            })
            .unwrap()
            .join()
            .unwrap();
    }

    /// Deep `LambdaTerm` via a right-nested `Abs` chain: exercises the `Abs` arm of `LambdaTerm`'s
    /// `Drop` — both of them, the root unlink and the worklist descent.
    ///
    /// `term.rs` gives `LambdaTerm` the same hand-written iterative `Drop` the types above have, and
    /// before this NOTHING tested it directly — `decode.rs`'s small-stack decode exercised it only
    /// incidentally, as a side effect of a test about a different subject. This closed that gap
    /// BEFORE the representation changed, so the net was known to work before it was needed.
    ///
    /// Built with an iterative loop, not a recursive helper: the build must not be what overflows.
    #[test]
    fn dropping_deep_lambda_abs_chain_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                use crate::lambda::term::{abs, var};
                let mut acc = var(0);
                for _ in 0..40_000 {
                    acc = abs("x", acc);
                }
                drop(acc); // must tear down iteratively, not recurse 40,000 deep.
            })
            .unwrap()
            .join()
            .unwrap();
    }

    /// Deep `LambdaTerm` via a left-nested `App` chain: exercises the `App` arm of `LambdaTerm`'s
    /// `Drop`, which unlinks TWO children rather than one. This is the left-nested half of a pair — the same
    /// device the `LetRecGroup` pair above uses — so it is falsifiable only for a forgotten `f`;
    /// its twin below (deep via `a`) is what makes a forgotten `a` falsifiable too.
    #[test]
    fn dropping_deep_lambda_app_chain_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                use crate::lambda::term::{app, var};
                let mut acc = var(0);
                for _ in 0..40_000 {
                    acc = app(acc, var(1)); // chain via the LEFT child; the right is a shallow leaf.
                }
                drop(acc);
            })
            .unwrap()
            .join()
            .unwrap();
    }

    /// The right-nested twin: deep via `a`, with `f` a shallow leaf. The `App` arm unlinks TWO
    /// children, so it needs TWO chains, and without this one the pair is not the device the test
    /// above claims it is.
    ///
    /// Concretely: a destructor that unlinked `f` and forgot `a` would leave `a` to the
    /// compiler's recursive drop glue — which is O(1) when `a` is always `var(1)`, so the left-nested
    /// test PASSES with that half broken. Verified by sabotage, not reasoned about.
    #[test]
    fn dropping_deep_lambda_app_chain_through_the_argument_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                use crate::lambda::term::{app, var};
                let mut acc = var(0);
                for _ in 0..40_000 {
                    acc = app(var(1), acc); // chain via the RIGHT child; the left is a shallow leaf.
                }
                drop(acc);
            })
            .unwrap()
            .join()
            .unwrap();
    }

    /// Deep `LambdaTerm` where EVERY child is SHARED: each level is `App(c, c)` over one allocation.
    ///
    /// Not reachable at all before the `Rc` conversion — under `Box` this term is a tree of 2^40,000
    /// nodes and could not be built — but `subst` now installs the substituted argument at every
    /// occurrence as a refcount bump, so a node holding two handles to the same child is the ordinary
    /// product of reducing `(\x. x x) M`, and iterating that nests it.
    ///
    /// THE THREE CHAINS ABOVE CANNOT CATCH WHAT THIS CATCHES. In each of them every child is uniquely
    /// owned, so a destructor that unlinked only uniquely-owned children — leaving shared ones to the
    /// compiler's glue on the reasoning that a decrement frees nothing — passes all three. Here it
    /// overflows: at each level the glue's SECOND decrement is the one that reaches zero, and the free
    /// it triggers recurses into the next level through drop glue rather than through the worklist.
    /// The fix is the invariant `Drop` actually maintains: unlink ALL children, so the handle that
    /// finally reaches zero does so inside the loop.
    #[test]
    fn dropping_deep_lambda_shared_child_chain_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                use crate::lambda::term::{app, var};
                let mut acc = var(0);
                for _ in 0..40_000 {
                    acc = app(acc.clone(), acc); // BOTH children are the same allocation.
                }
                drop(acc);
            })
            .unwrap()
            .join()
            .unwrap();
    }

    /// A deep chain SHARED partway down — the failure mode `Rc` introduces and `Box` could not have.
    /// The walk must stop unlinking where the strong count exceeds one and merely decrement, without
    /// either corrupting the still-live `keep` or falling back to a recursive teardown of the rest.
    ///
    /// THIS IS A DIFFERENT SHAPE FROM `dropping_deep_lambda_shared_child_chain_does_not_overflow`
    /// ABOVE, and deliberately so — do not fold one into the other. That test shares at EVERY level
    /// and everything dies together in one `drop`; it cannot catch a corrupted survivor because
    /// nothing survives. Here sharing is at exactly ONE interior node — the top of `keep`'s chain —
    /// unique above it (in `outer`'s own 20,000 "y" levels) and unique below it (in `keep`'s 20,000
    /// "x" levels), and `outer` is dropped while `keep` is still alive, so the shared node IS shared
    /// at teardown time. The property only this test can catch is non-corruption of a survivor: after
    /// `drop(outer)`, `keep` must still be a valid, fully intact 20,000-deep term.
    ///
    /// That check has to be more than "did not crash", and what it does and does not distinguish is
    /// worth being exact about. `Drop` contains no `unsafe`, so "corrupted" here cannot mean torn or
    /// freed memory: `Rc` will not hand out an owned `Node` while another handle holds it, and the
    /// sabotage that tries to force one does not compile. What the depth assert distinguishes is a
    /// STRUCTURAL LOGIC bug — a walk that unlinked a shared child anyway would leave `keep` TRUNCATED
    /// at the shared node — from a run that merely did not crash. Walking and counting the spine
    /// BEFORE `keep` is dropped is what turns that into a failed assertion here, rather than a silently
    /// shortened term that tears down fine at the second `drop`.
    ///
    /// Two drops, in this order on purpose: the outer chain goes first while `keep` is still alive
    /// (so the shared node IS shared at teardown time — the whole point), then `keep` goes, which is
    /// itself a 20,000-deep uniquely-owned teardown.
    #[test]
    fn dropping_a_deep_chain_shared_partway_down_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                use crate::lambda::term::{Node, abs, var};
                let mut keep = var(0);
                for _ in 0..20_000 {
                    keep = abs("x", keep);
                }
                let mut outer = keep.clone(); // strong count 2 at this node
                for _ in 0..20_000 {
                    outer = abs("y", outer);
                }
                drop(outer); // must stop at the shared node, not recurse past it

                // Observe that `keep` survived intact, rather than merely not crashing: walk its
                // spine iteratively and count the levels.
                let mut depth = 0u32;
                let mut cur = &keep;
                loop {
                    match cur.node() {
                        Node::Abs(_, body) => {
                            depth += 1;
                            cur = body;
                        }
                        Node::Var(_) => break,
                        Node::App(..) => panic!("keep should be a pure Abs chain over a Var leaf"),
                    }
                }
                assert_eq!(depth, 20_000, "keep must still be a fully intact 20,000-deep chain");

                drop(keep); // now uniquely owned again; tears down iteratively
            })
            .unwrap()
            .join()
            .unwrap();
    }
}
