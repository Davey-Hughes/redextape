//! The `clap` surface. Declarations only — every decision lives in the command modules, so this file
//! stays readable as a description of what the binary accepts.

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "redextape", version, about = "The redextape mini-language toolchain")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Format source files in place.
    Fmt {
        /// Files to format. `-` reads standard input and writes standard output.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
        /// Print a diff instead of rewriting; exit 1 if anything would change.
        #[arg(long)]
        check: bool,
    },
    /// Report parse, type and lint diagnostics.
    Lint {
        /// Files to check. `-` reads standard input.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
    },
}
