//! The lambda backend: Core AST -> de Bruijn lambda-term -> normal-order reduction -> `Value`,
//! plus a round-tripping lambda text form. See
//! `docs/superpowers/specs/2026-07-21-lambda-backend-design.md`.

pub mod decode;
pub mod encode;
pub mod lower;
pub mod reduce;
pub mod syntax;
pub mod term;

pub use decode::{decode, decode_lambda_ty};
pub use lower::{LowerError, lower, lower_mapped};
pub use reduce::{MAX_REDUCTION_STEPS, Status, Step, Trace, reduce_to_normal_form, reduce_trace};
pub use syntax::{parse_lambda, print_lambda, print_lambda_mapped};
pub use term::{Dir, LambdaTerm, Path};

use crate::core::Core;

/// The outcome of lowering + reducing a program through the lambda backend. Decoding to a `Value` is a
/// separate, type-directed step, because bare normal forms are ambiguous — and there are two sibling
/// decoders for it: `decode` is guided by an expected `Value` (what the oracle holds after a reference
/// run) and `decode_lambda_ty` by a `Ty` alone (all a reader of printed text has). They disagree on two
/// cases on purpose; see `decode.rs`.
#[derive(Clone, Debug)]
pub enum LambdaRun {
    /// Reduced to a normal form. Decode it with `decode` (against an expected value's shape) or with
    /// `decode_lambda_ty` (against a type).
    Reduced(LambdaTerm),
    /// Reduction hit the step cap.
    HitCap,
    /// The program could not be lowered (e.g. a stateful closure).
    LowerError(LowerError),
}

/// Lower -> reduce. The convenience entry point for the oracle and later plans.
pub fn run_lambda(core: &Core, cap: u64) -> LambdaRun {
    let term = match lower(core) {
        Ok(t) => t,
        Err(e) => return LambdaRun::LowerError(e),
    };
    let (nf, status) = reduce_to_normal_form(&term, cap);
    match status {
        Status::HitCap => LambdaRun::HitCap,
        Status::Normalized => LambdaRun::Reduced(nf),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::parser::parse;

    fn lower_and_run(src: &str, cap: u64) -> LambdaRun {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        run_lambda(&core, cap)
    }

    #[test]
    fn reduces_a_valid_program_to_a_normal_form() {
        assert!(matches!(lower_and_run("1 + 1", MAX_REDUCTION_STEPS), LambdaRun::Reduced(_)));
    }

    #[test]
    fn hits_the_cap_on_non_terminating_reduction() {
        // Unconditional recursion never reaches a normal form; a tiny cap surfaces `HitCap`.
        let src = "fn spin(n) { spin(n) } spin(0)";
        assert!(matches!(lower_and_run(src, 10), LambdaRun::HitCap));
    }

    #[test]
    fn surfaces_a_lower_error_for_a_stateful_closure() {
        let src = "let mut c = 0; let inc = |x| { c = c + x; c }; inc(1)";
        assert!(matches!(
            lower_and_run(src, MAX_REDUCTION_STEPS),
            LambdaRun::LowerError(LowerError::StatefulClosure { .. })
        ));
    }
}
