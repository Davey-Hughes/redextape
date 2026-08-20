//! `redextape` — the command line front end for `redextape-core`.
//!
//! `main` does dispatch and nothing else: each command module returns an outcome, and the only job
//! here is turning that outcome into a process exit code. The three codes are 0 (success), 1 (the
//! check failed — a file would be rewritten, or a diagnostic was an error) and 2 (the work could not
//! be done at all), which is also `clap`'s own code for a bad argument list.

mod cli;
mod fmt;
mod input;
mod lint;
mod report;

use clap::Parser;
use input::Input;
use std::io::Write;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args = cli::Cli::parse();
    let color = report::should_color();
    let (mut out, mut err) = (std::io::stdout(), std::io::stderr());
    match args.command {
        cli::Command::Fmt { paths, check } => {
            let inputs: Vec<Input> = paths.iter().map(|p| Input::from_arg(p)).collect();
            match fmt::run(&inputs, check, &mut out, &mut err, color) {
                Ok(fmt::Outcome::Clean | fmt::Outcome::Rewritten) => ExitCode::SUCCESS,
                Ok(fmt::Outcome::WouldChange) => ExitCode::from(1),
                Ok(fmt::Outcome::Failed) => ExitCode::from(2),
                Err(e) => {
                    let _ = writeln!(err, "{e}");
                    ExitCode::from(2)
                }
            }
        }
        cli::Command::Lint { paths } => {
            let inputs: Vec<Input> = paths.iter().map(|p| Input::from_arg(p)).collect();
            match lint::run(&inputs, &mut out, &mut err, color) {
                Ok(lint::Outcome::Clean | lint::Outcome::Warned) => ExitCode::SUCCESS,
                Ok(lint::Outcome::Errored) => ExitCode::from(1),
                Ok(lint::Outcome::Failed) => ExitCode::from(2),
                Err(e) => {
                    let _ = writeln!(err, "{e}");
                    ExitCode::from(2)
                }
            }
        }
    }
}
