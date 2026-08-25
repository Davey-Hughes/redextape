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
    /// Run a program and print its value.
    Run {
        /// The file to run. `.rxt` is a program; `.tm` is a machine. `-` reads standard input as a program.
        path: PathBuf,
        /// Which backend evaluates a `.rxt` program. All three agree on any program all three can
        /// answer for; `lambda` and `tm` decode their result by type, so a function-typed result
        /// exits 2 there and prints as `<non-value>` under `reference`. Rejected for a `.tm` file,
        /// which is already a machine.
        #[arg(long, value_enum, default_value_t = crate::run::Backend::Reference)]
        backend: crate::run::Backend,
    },
    /// Compile a program to a backend text form.
    Emit {
        /// The program to compile. `-` reads standard input.
        path: PathBuf,
        /// Which text form to write. All three read back — `tm` through `parse_tm_full`, `lambda`
        /// through `parse_lambda`, `asm` through `parse_asm`. Only `tm` is also executable from the
        /// command line: `redextape run` takes an emitted `.tm`, not yet an emitted `.asm`.
        #[arg(long, value_enum)]
        lang: crate::emit::Lang,
        /// Tape encoding, defaulting to unary. `--lang tm` only: passing it with any other target is
        /// an error rather than a silent no-op. `binary` packs a far larger value into the same field
        /// width, so it can express programs unary refuses.
        #[arg(long, value_enum)]
        encoding: Option<crate::emit::EncodingArg>,
        /// Write here instead of standard output.
        #[arg(short = 'o', long)]
        out: Option<PathBuf>,
    },
}
