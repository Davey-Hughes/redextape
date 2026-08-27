//! The `clap` surface. Declarations only — every decision lives in the command modules, so this file
//! stays readable as a description of what the binary accepts.

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "redextape", version, about = "The redextape mini-language toolchain")]
pub struct Cli {
    /// Read settings from this file instead of searching for one. Naming a file that does not exist
    /// is an error, where finding no file during the search is not.
    #[arg(long, global = true, conflicts_with = "no_config", value_name = "PATH")]
    pub config: Option<PathBuf>,
    /// Ignore any `redextape.toml` and use built-in defaults.
    #[arg(long, global = true)]
    pub no_config: bool,
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
        /// Line budget, overriding `fmt.width` in `redextape.toml`. A BUDGET, not a bound: binary
        /// chains, parameter lists and deep indentation can each exceed it, and do so more often the
        /// narrower it is.
        #[arg(long, value_name = "COLUMNS")]
        width: Option<usize>,
    },
    /// Report parse, type and lint diagnostics.
    Lint {
        /// Files to check. `-` reads standard input.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
        /// Make a warning fail the run: exit 1 rather than 0. Overrides `lint.deny-warnings` in
        /// `redextape.toml`.
        #[arg(long)]
        deny_warnings: bool,
        /// Report warnings without failing, overriding `lint.deny-warnings` in `redextape.toml`.
        #[arg(long, overrides_with = "deny_warnings")]
        no_deny_warnings: bool,
    },
    /// Run a program and print its value.
    Run {
        /// The file to run. `.rxt` is a program; `.tm` is a machine and `.asm` is a register-machine
        /// listing, both already compiled. `-` reads standard input as a program.
        path: PathBuf,
        /// Which backend evaluates a `.rxt` program. All three agree on any program all three can
        /// answer for; `lambda` and `tm` decode their result by type, so a function-typed result
        /// exits 2 there and prints as `<non-value>` under `reference`. Rejected for a `.tm` or `.asm`
        /// file, which is already compiled.
        #[arg(long, value_enum, default_value_t = crate::run::Backend::Reference)]
        backend: crate::run::Backend,
    },
    /// Compile a program to a backend text form.
    Emit {
        /// The program to compile. `-` reads standard input.
        path: PathBuf,
        /// Which text form to write. All three read back — `tm` through `parse_tm_full`, `lambda`
        /// through `parse_lambda`, `asm` through `parse_asm`. `tm` and `asm` are also executable from
        /// the command line: `redextape run` takes an emitted `.tm` or `.asm` file directly.
        #[arg(long, value_enum)]
        lang: crate::emit::Lang,
        /// Tape encoding, defaulting to unary. `--lang tm` only: passing it with any other target is
        /// an error rather than a silent no-op. `binary` packs a far larger value into the same field
        /// width, so it can express programs unary refuses.
        #[arg(long, value_enum)]
        encoding: Option<crate::emit::EncodingArg>,
        /// TM tape field width in cells, overriding `emit.field-width` in `redextape.toml`. The same
        /// values that key accepts: 4..=64 to pin a width, or 0 to auto-fit — which is also what
        /// omitting the flag means, a search that starts narrow and widens until the values fit.
        /// Anything else exits 2. `--lang tm` only: passing it with any other target is an error
        /// rather than a silent no-op.
        #[arg(long, value_name = "CELLS")]
        field_width: Option<usize>,
        /// Write here instead of standard output.
        #[arg(short = 'o', long)]
        out: Option<PathBuf>,
    },
}
