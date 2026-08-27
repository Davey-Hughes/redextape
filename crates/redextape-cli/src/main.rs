//! `redextape` — the command line front end for `redextape-core`.
//!
//! `main` does dispatch and nothing else: each command module returns an outcome, and the only job
//! here is turning that outcome into a process exit code. The three codes are 0 (success), 1 (the
//! check failed — a file would be rewritten, or a diagnostic was an error) and 2 (the work could not
//! be done at all), which is also `clap`'s own code for a bad argument list.

mod cli;
mod config;
mod emit;
mod fmt;
mod input;
mod lint;
mod report;
mod run;

use clap::Parser;
use input::Input;
use std::io::Write;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args = cli::Cli::parse();
    let color = report::should_color();
    let (mut out, mut err) = (std::io::stdout(), std::io::stderr());

    // **RESOLVED ONCE, HERE, AND THE COMMAND MODULES NEVER SEE IT.** Each module takes the plain
    // values it needs, so precedence — flag > config file > built-in default — lives in exactly one
    // function and the modules' unit tests keep passing a number or a bool rather than a fixture.
    let source = if args.no_config {
        config::Source::Defaults
    } else if let Some(path) = args.config {
        config::Source::Explicit(path)
    } else {
        match std::env::current_dir() {
            Ok(from) => config::Source::Discover { from },
            // A process with no readable working directory cannot discover anything. Defaults are
            // the honest answer and are not a failure: an absent config file is the normal case.
            Err(_) => config::Source::Defaults,
        }
    };
    let cfg = match config::load(&source) {
        Ok(c) => c,
        Err(e) => {
            let _ = writeln!(err, "{e}");
            return ExitCode::from(2);
        }
    };

    match args.command {
        cli::Command::Fmt { paths, check, width } => {
            let width = width.unwrap_or(cfg.fmt.width);
            let inputs: Vec<Input> = paths.iter().map(|p| Input::from_arg(p)).collect();
            match fmt::run(&inputs, check, width, &mut out, &mut err, color) {
                Ok(fmt::Outcome::Clean | fmt::Outcome::Rewritten) => ExitCode::SUCCESS,
                Ok(fmt::Outcome::WouldChange) => ExitCode::from(1),
                Ok(fmt::Outcome::Failed) => ExitCode::from(2),
                Err(e) => {
                    let _ = writeln!(err, "{e}");
                    ExitCode::from(2)
                }
            }
        }
        cli::Command::Lint { paths, deny_warnings, no_deny_warnings } => {
            // flag > config > default, with the pair's last-one-wins already resolved by clap's
            // `overrides_with`: at most one of the two booleans is true here.
            let deny = if deny_warnings {
                true
            } else if no_deny_warnings {
                false
            } else {
                cfg.lint.deny_warnings
            };
            let inputs: Vec<Input> = paths.iter().map(|p| Input::from_arg(p)).collect();
            match lint::run(&inputs, &mut out, &mut err, color) {
                Ok(lint::Outcome::Clean) => ExitCode::SUCCESS,
                Ok(lint::Outcome::Warned) => {
                    if deny {
                        ExitCode::from(1)
                    } else {
                        ExitCode::SUCCESS
                    }
                }
                Ok(lint::Outcome::Errored) => ExitCode::from(1),
                Ok(lint::Outcome::Failed) => ExitCode::from(2),
                Err(e) => {
                    let _ = writeln!(err, "{e}");
                    ExitCode::from(2)
                }
            }
        }
        cli::Command::Run { path, backend } => {
            let input = Input::from_arg(&path);
            match run::run(&input, backend, &mut out, &mut err, color) {
                Ok(run::Outcome::Ran) => ExitCode::SUCCESS,
                Ok(run::Outcome::ProgramFailed) => ExitCode::from(1),
                Ok(run::Outcome::ToolFailed) => ExitCode::from(2),
                Err(e) => {
                    let _ = writeln!(err, "{e}");
                    ExitCode::from(2)
                }
            }
        }
        cli::Command::Emit { path, lang, encoding, field_width, out: dest } => {
            // **THE FLAG IS RANGE-CHECKED HERE, BECAUSE THE CONFIG KEY IT OVERRIDES ALREADY WAS.**
            // `config::validate` refuses `emit.field-width` outside `0 | MIN..=MAX` at exit 2, and
            // the flag that beats it checked nothing: `--field-width 65` wrote a `.tm` carrying
            // `width 65`, at exit 0, which this tool's own reader then refuses — and a width past
            // what a `usize` can allocate a bank for panicked inside the encoding. Both bounds are
            // read from core's constants rather than written out, for the reason `validate` gives:
            // a copy drifts the first time either constant moves.
            //
            // BEFORE the `--lang tm` guard rather than after, and that ordering is a choice: a width
            // outside the range is never valid on any target, so it is refused wherever it is typed.
            // The guard still tests flag PRESENCE only, so a config-set width cannot reach here at
            // all — design §7 is about the guard, not about this check.
            let (lo, hi) = (redextape_core::tm::MIN_FIELD_WIDTH, redextape_core::tm::MAX_FIELD_WIDTH);
            if let Some(w) = field_width
                && w != 0
                && !(lo..=hi).contains(&w)
            {
                let _ = writeln!(err, "error: `--field-width` must be 0 (auto-fit) or in {lo}..={hi}, got {w}");
                return ExitCode::from(2);
            }
            // The two flags stay `Option` here — `run`'s guard is what reads them — and the config
            // values ride alongside as `defaults` rather than being merged in. Design §7.
            let opts = emit::Options {
                encoding,
                field_width,
                defaults: emit::Defaults { encoding: cfg.emit.encoding, field_width: cfg.emit.field_width },
            };
            let input = Input::from_arg(&path);
            match emit::run(&input, lang, opts, dest.as_deref(), &mut out, &mut err, color) {
                Ok(emit::Outcome::Emitted) => ExitCode::SUCCESS,
                Ok(emit::Outcome::ProgramFailed) => ExitCode::from(1),
                Ok(emit::Outcome::ToolFailed) => ExitCode::from(2),
                Err(e) => {
                    let _ = writeln!(err, "{e}");
                    ExitCode::from(2)
                }
            }
        }
    }
}
