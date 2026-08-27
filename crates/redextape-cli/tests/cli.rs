//! End-to-end transcripts: argv in, stdout/stderr/exit-code out.
//!
//! The unit tests in each command module call `run` directly with a buffer. These run the real
//! binary, which is the only place `main`'s exit-code mapping and `clap`'s own errors are exercised.
//!
//! **The `/` in `fmt_check_dirty.stdout`'s "no newline" trailer is not a redextape defect and not
//! literally what the binary prints.** The real binary's diff output ends that line with a
//! backslash — `\ No newline at end of file`, which is `similar`'s own unified-diff format — never a
//! forward slash. The `/` in the checked-in golden comes from `trycmd`'s dependency `snapbox`: its
//! `FilterPaths` filter unconditionally rewrites every literal `\` byte to `/` (intended for
//! Windows path-separator normalization, applied with no context check to every captured stream).
//! That filter runs on BOTH the live captured output and the loaded golden file before they are
//! compared, so the comparison stays self-consistent and the test remains valid — but it means this
//! golden does not literally match what a real terminal shows. `trycmd::TestCases`'s public API has
//! no setting to disable it. Do not "fix" the binary to emit `/`; there is nothing here to fix.
//!
//! NO file-level `allow` here: `clippy.toml`'s in-tests exemption already covers a `#[test]` fn in an
//! integration target. If a free helper is added to this file and clippy then fails, add the narrowest
//! allow that fixes it — and confirm it is load-bearing by deleting it and re-running.
//!
//! **A `.git` MARKER IS PLANTED IN EVERY `tests/cmd/*.in` DIRECTORY, NOT CHECKED IN.** `trycmd`
//! copies each `.in` directory into a sandbox under `/tmp` and runs the case with that sandbox as the
//! working directory. `config::discover` walks upward from there for a
//! `redextape.toml`, stopping at whichever comes first in a directory: the config file, or a `.git`.
//! `/tmp` on this machine is a shared tmpfs other processes write to, so a case with no config of its
//! own has an unbounded walk that can reach `/tmp` and pick up whatever a stray file there holds,
//! silently changing what the case tests. Measured: 18 of the 20 `.in` directories under
//! `tests/cmd/` have no `redextape.toml` anywhere in them, and for those the marker is what stops the
//! walk — delete it and `discover` keeps climbing toward `/tmp`.
//!
//! The other two, `config_unknown_key.in` and `config_bad_width.in`, put their `redextape.toml`
//! directly in the sandbox root, which is also `discover`'s starting directory. `discover` checks
//! `dir.join(FILE_NAME).is_file()` before `dir.join(".git").exists()` **in the same directory** —
//! the order `discover`'s own doc comment calls out — so for those two the config file is found and
//! returned on the very first
//! iteration — `.git` in that same directory is never consulted. The marker there is inert; it gets
//! planted anyway only because the loop below writes one into every `.in` directory unconditionally,
//! reading the list from disk rather than naming cases, so a future case with no config of its own is
//! bounded automatically instead of depending on someone remembering to add a marker for it.
//!
//! It is written into the working tree's `.in/` directories right before `trycmd` copies each into
//! its sandbox, which makes it present on every run including a fresh CI checkout. `tests/cmd/.gitignore`
//! names them, with the pattern `*.in/.git`, and **that ignore is belt-and-braces rather than the
//! reason they stay out of `git status`.** Measured with the ignore file moved aside:
//! `git status --porcelain --untracked-files=all` still lists none of the markers,
//! `git check-ignore -v` reports the path matched by no rule at all, and `git add -f` on one of them
//! silently stages nothing. Git skips a directory entry literally named `.git` during traversal
//! unconditionally, ignore rules or not — so the pattern suppresses nothing that was ever going to
//! show. It is kept as a statement of intent for whoever finds untracked-looking `.git` files
//! on disk and goes looking for why. Git refuses to
//! track any path component literally named `.git`: `git add` and even
//! `git update-index --add --cacheinfo` both silently no-op on it (verified directly, including with
//! `core.protectHFS`/`core.protectNTFS` off — this is the unconditional exact-name check, not the
//! configurable fuzzy one), so this marker cannot be a fixture like `a.rxt` or `redextape.toml` are.
//!
//! **INLINE IN THE `#[test]` FN, NOT A FREE HELPER.** A free helper in this target sits outside both
//! exemptions this file's own doc comment above describes, so an `expect` here would need its own
//! `#[allow(clippy::expect_used)]`; lexically inside `#[test] fn cli_transcripts` it is already
//! covered.
#[test]
fn cli_transcripts() {
    for entry in std::fs::read_dir("tests/cmd").expect("reading tests/cmd") {
        let path = entry.expect("reading a tests/cmd entry").path();
        let is_case_dir = path.is_dir() && path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("in"));
        if is_case_dir {
            std::fs::write(path.join(".git"), "gitdir: elsewhere\n").expect("planting the .git marker");
        }
    }
    trycmd::TestCases::new().default_bin_name("redextape").case("tests/cmd/*.toml");
}
