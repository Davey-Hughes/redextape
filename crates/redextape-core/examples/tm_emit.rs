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

use redextape_core::Diagnostic;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{
    EncodingKind, TM_DEFAULT_CAPS, TmStatus, decode_tape_ty, parse_tm_full, print_tm_with, run_tm_described, simulate,
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
        .map_err(|run| format!("`{src}` did not run to a value: {run:?}"))?;

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
