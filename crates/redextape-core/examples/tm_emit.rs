//! `tm_emit` — write a self-describing `.tm` file, and run one back.
//!
//! `tm_demo` runs the TM backend in-process and checks it against the reference interpreter; this
//! example is the other half — it is the slice's headline claim (a `.tm` file is self-describing: it
//! carries the literal initial tapes plus the `encoding`/`width`/`slots`/`result` recipe, not just δ
//! and q₀) made executable OUTSIDE the test harness. `emit` compiles a program and writes the text;
//! `run` reads nothing but that text, builds the initial configuration from its header, simulates, and
//! decodes the final tapes to a value.
//!
//!     cargo run --example tm_emit -p redextape-core -- emit '<program>' [--encoding unary|binary] [-o <path>]
//!     cargo run --example tm_emit -p redextape-core -- run <path>
//!
//! This is the one place in the tree where a human types the input directly, so both subcommands are
//! total over their argument list and over whatever the file/program string turns out to say: every
//! failure prints a diagnostic to stderr and exits non-zero rather than panicking.

// Example target: a demo that cannot build its own input has nothing to demonstrate, so aborting is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` do not reach example targets at all.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use redextape_core::Diagnostic;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{
    EncodingKind, TM_DEFAULT_CAPS, TmRun, TmStatus, decode_tape_ty, parse_tm_full, print_tm_with, run_tm_described,
    simulate,
};
use redextape_core::ty::show as show_ty;
use redextape_core::typeck::result_type;
use redextape_core::value::format_value;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("emit") => emit(&args[1..]),
        Some("run") => run(&args[1..]),
        Some(other) => Err(format!("unknown subcommand `{other}` (expected `emit` or `run`)\n\n{}", usage())),
        None => Err(usage()),
    };
    if let Err(msg) = result {
        eprintln!("{msg}");
        std::process::exit(1);
    }
}

fn usage() -> String {
    "usage:\n  \
     tm_emit emit '<program>' [--encoding unary|binary] [-o <path>]\n  \
     tm_emit run <path>"
        .to_string()
}

fn format_diagnostics(ds: &[Diagnostic]) -> String {
    ds.iter().map(|d| format!("  {}..{}: {}", d.span.start, d.span.end, d.message)).collect::<Vec<_>>().join("\n")
}

/// Prose for every `TmRun` outcome that is not `Ran` -- used both for `run_tm_described`'s `Err` (which
/// only ever carries `LowerError`/`TooLarge`, since those are refused before a single step) and for a
/// `described.run` that came back `Ok` without reaching a value (`Overflow`/`HitCap`, since the width
/// auto-fit loop gives up at the ceiling and returns whatever it last got).
fn describe_non_value_run(run: &TmRun, encoding: EncodingKind) -> String {
    match run {
        TmRun::Ran { .. } => "ran to a value".to_string(),
        TmRun::Overflow => format!(
            "no value fit `{encoding:?}`'s field width at any width up to the ceiling. This is a property of \
             the encoding, not of the program -- `--encoding binary` represents far larger values in the same \
             field width and may succeed where `{encoding:?}` does not."
        ),
        // No leading "it" — every caller already prefixes "`<prog>` did not run to a value: ", and the
        // two read together as one sentence.
        TmRun::HitCap => {
            "the simulation did not halt; it hit the step/tape-cell cap before producing a result".to_string()
        }
        TmRun::TooLarge => "the program's register file, call-frame bank, or multiplication count is too large \
             for the TM backend to represent"
            .to_string(),
        TmRun::LowerError(e) => format!("it could not be lowered to the TM backend: {e:?}"),
    }
}

/// `emit`: parse -> typecheck -> desugar -> run to fit the width -> write the self-describing text.
fn emit(args: &[String]) -> Result<(), String> {
    let mut program: Option<String> = None;
    let mut encoding = EncodingKind::Unary;
    let mut out: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--encoding" => {
                let val =
                    args.get(i + 1).ok_or_else(|| "`--encoding` needs a value (`unary` or `binary`)".to_string())?;
                encoding = EncodingKind::parse(val)
                    .ok_or_else(|| format!("unknown `--encoding` value `{val}` (expected `unary` or `binary`)"))?;
                i += 2;
            }
            "-o" => {
                let path = args.get(i + 1).ok_or_else(|| "`-o` needs a path".to_string())?;
                out = Some(path.clone());
                i += 2;
            }
            // Reject flag-shaped arguments BEFORE the program arm below can swallow them. Without
            // this, a plausible typo like `--econding binary` becomes the program string and is
            // reported as "`--econding` does not parse" — technically true, and useless.
            s if s.starts_with('-') => {
                return Err(format!("unknown flag `{s}`\n\n{}", usage()));
            }
            s if program.is_none() => {
                program = Some(s.to_string());
                i += 1;
            }
            s => return Err(format!("unexpected argument `{s}`\n\n{}", usage())),
        }
    }
    let src = program.ok_or_else(|| format!("`emit` needs a program argument\n\n{}", usage()))?;

    let (prog, ds) = parse(&src);
    if !ds.is_empty() {
        return Err(format!("`{src}` does not parse:\n{}", format_diagnostics(&ds)));
    }
    let prog = prog.ok_or_else(|| format!("`{src}` did not parse to a program"))?;

    let ty = result_type(&prog).map_err(|ds| format!("`{src}` does not typecheck:\n{}", format_diagnostics(&ds)))?;

    let core = desugar(&prog);
    let described = run_tm_described(&core, encoding, ty, TM_DEFAULT_CAPS)
        .map_err(|run| format!("`{src}` did not run to a value: {}", describe_non_value_run(&run, encoding)))?;

    // `run_tm_described`'s `Err` arm only carries `LowerError`/`TooLarge` — it can still come back `Ok`
    // with a `described.run` that never reached a value (`Overflow`/`HitCap`), because the width
    // auto-fit loop gives up at `MAX_FIELD_WIDTH` and returns whatever it last got. Left unchecked, that
    // machine and header still print as a complete, self-describing `.tm` file, and `run` happily
    // simulates and decodes it -- against whatever the overflow guard's rule-less non-accept state
    // (itself a HALT) or the step/cell cap left on the tapes. That is how a program like `50 + 50`
    // (whose largest intermediate, 100, exceeds `Unary`'s field width ceiling) silently emits a file
    // that computes 64, not 100, with no diagnostic at all.
    if !matches!(described.run, TmRun::Ran { .. }) {
        return Err(format!("`{src}` did not run to a value: {}", describe_non_value_run(&described.run, encoding)));
    }

    let text = print_tm_with(&described.machine, &described.header);
    match out {
        Some(path) => {
            std::fs::write(&path, &text).map_err(|e| format!("could not write `{path}`: {e}"))?;
            println!("wrote {path}");
        }
        None => print!("{text}"),
    }
    Ok(())
}

/// `run`: read the file -> `parse_tm_full` -> build `init` from the header -> `simulate` ->
/// `decode_tape_ty` -> print the value.
fn run(args: &[String]) -> Result<(), String> {
    let path = args.first().ok_or_else(|| format!("`run` needs a path argument\n\n{}", usage()))?;
    // Same guard as `emit`: reject flag-shaped arguments before they can be swallowed as the path.
    // Without this, `tm_emit run --help` reports "could not read `--help`" -- technically true, and
    // useless.
    if path.starts_with('-') {
        return Err(format!("unknown flag `{path}`\n\n{}", usage()));
    }
    if let Some(extra) = args.get(1) {
        return Err(format!("unexpected argument `{extra}`\n\n{}", usage()));
    }

    let text = std::fs::read_to_string(path).map_err(|e| format!("could not read `{path}`: {e}"))?;

    let (m, h, ds) = parse_tm_full(&text);
    if !ds.is_empty() {
        return Err(format!("`{path}` does not parse as a `.tm` file:\n{}", format_diagnostics(&ds)));
    }
    let m = m.ok_or_else(|| format!("`{path}` did not parse to a machine"))?;
    let h = h.ok_or_else(|| {
        format!(
            "`{path}` has no header. A `.tm` file without one records δ and the start state but not \
             an initial configuration, so it genuinely cannot be run without the caller supplying \
             `init` by hand — this file is a valid machine, just not a runnable one on its own. \
             Re-emit it with `tm_emit emit` (which always writes a header) and try again."
        )
    })?;

    let init = h.init(m.tapes);
    let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
    if status != TmStatus::Halted {
        return Err(format!("`{path}` did not halt (hit a step/tape-cell cap) before producing a result"));
    }

    let value = decode_tape_ty(&tapes, &h.result, &*h.encoding())
        .ok_or_else(|| format!("`{path}`'s final tapes did not decode to a `{}`", show_ty(&h.result)))?;

    println!("{}", format_value(&value));
    Ok(())
}
