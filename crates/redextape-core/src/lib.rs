//! Redextape core: the mini-language front end, the λ and TM backends, and the shared analysis
//! layer. This crate is compiled to WASM for the web UI and reused by the CLI and LSP.
//!
//! Foundation slice (this plan): lexer -> parser -> typecheck -> desugar -> reference interpreter.

pub mod ast;
pub mod core;
pub mod desugar;
pub mod diagnostic;
pub mod interp;
pub mod lambda;
pub mod lexer;
pub mod parser;
pub mod prelude;
pub mod span;
pub mod tm;
pub mod token;
pub mod ty;
pub mod typeck;
pub mod value;

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
pub fn analyze(src: &str) -> Analysis {
    let (program, mut diagnostics) = parser::parse(src);
    let Some(program) = program else {
        return Analysis { diagnostics, core: None };
    };
    diagnostics.extend(typeck::typecheck(&program));
    let has_error = diagnostics.iter().any(|d| d.severity == Severity::Error);
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
pub fn run(src: &str) -> Result<value::Value, RunError> {
    let analysis = analyze(src);
    match analysis.core {
        Some(core) => interp::eval(&core).map_err(RunError::Runtime),
        None => Err(RunError::Static(analysis.diagnostics)),
    }
}

#[cfg(test)]
mod smoke_tests {
    use super::*;

    #[test]
    fn version_is_exposed() {
        assert_eq!(VERSION, "0.0.0");
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
}
