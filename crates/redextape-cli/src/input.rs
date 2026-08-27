//! Where source text comes from and where it goes back to.
//!
//! Every failure a real invocation can hit lives here — a missing file, a directory where a file was
//! expected, bytes that are not UTF-8 — because each has to produce a message and an exit code rather
//! than a panic. The crate denies `unwrap`, and this is the module that would otherwise want one.
use std::fmt;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// One resolved input.
pub enum Input {
    Path(PathBuf),
    Stdin,
}

/// Why an input could not be read. `Display` is the message the user sees on stderr.
pub enum InputError {
    Io { label: String, err: std::io::Error },
    NotUtf8 { label: String },
}

impl fmt::Display for InputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InputError::Io { label, err } => write!(f, "cannot read `{label}`: {err}"),
            InputError::NotUtf8 { label } => write!(f, "`{label}` is not valid UTF-8"),
        }
    }
}

impl Input {
    /// `-` is standard input. Everything else is a path, including a path that does not exist — that
    /// is `read`'s problem to report, not this function's to guess at.
    #[must_use]
    pub fn from_arg(p: &Path) -> Self {
        if p.as_os_str() == "-" { Input::Stdin } else { Input::Path(p.to_path_buf()) }
    }

    /// What a diagnostic calls this input.
    #[must_use]
    pub fn label(&self) -> String {
        match self {
            Input::Path(p) => p.display().to_string(),
            Input::Stdin => "<stdin>".to_string(),
        }
    }

    /// Read the whole input as UTF-8.
    ///
    /// # Errors
    ///
    /// `InputError::Io` if the path cannot be opened or read (missing, a directory, unreadable), and
    /// `InputError::NotUtf8` if the bytes are not valid UTF-8. A source file is text; decoding it
    /// lossily would hand the parser bytes the author never wrote.
    pub fn read(&self) -> Result<String, InputError> {
        let label = self.label();
        let mut bytes = Vec::new();
        match self {
            Input::Stdin => {
                std::io::stdin().read_to_end(&mut bytes).map_err(|err| InputError::Io { label: label.clone(), err })?;
            }
            Input::Path(p) => {
                bytes = std::fs::read(p).map_err(|err| InputError::Io { label: label.clone(), err })?;
            }
        }
        String::from_utf8(bytes).map_err(|_| InputError::NotUtf8 { label })
    }
}

/// Replace `path`'s contents, atomically.
///
/// **`path` is taken literally: no symlink is followed.** If `path` names a symlink, the LINK
/// itself is what gets replaced — the sibling temporary is created next to the link, and the
/// rename lands a fresh regular file at the link's own name, leaving whatever the link used to
/// point at untouched. A caller that wants a symlinked target's real file rewritten in place,
/// with the link left standing, must resolve `path` (e.g. `Path::canonicalize`) before calling
/// this function; `fmt::one` is the one caller that needs that and does it there, so this
/// primitive can stay a literal "replace exactly this path" operation.
///
/// Write a sibling temporary and rename over the target. A formatter killed between opening and
/// closing a file must not leave a truncated source file behind, and rename within one directory is
/// the cheapest guarantee against that. The temporary is a sibling rather than in the system temp
/// directory because rename across filesystems is not atomic and may not be permitted at all.
///
/// The temporary's name includes this process's id, so two `redextape fmt` runs racing on the same
/// file do not collide, and it is opened with `create_new` (`O_EXCL` on Unix) so a file or symlink
/// already sitting at that path — from a stale run or planted by an attacker — is refused rather
/// than followed or truncated. Before the rename, the temporary's permissions are set to match the
/// target's current permissions (when the target exists), so replacing a `0600` file does not widen
/// it to the process umask's default. If anything fails after the temporary is created, the
/// temporary is removed before the original error is returned; a failure to create it in the first
/// place leaves nothing to remove.
///
/// Permission semantics follow from the mechanism, in both directions. A target file with no write
/// bit of its own (e.g. `0444`) IS still replaced: the rename swaps the directory entry rather than
/// writing through the existing inode, so the target's own permissions never come into play — only
/// the temporary's, which are freshly created and then widened to match the target's mode (see
/// `fill_temp`). Conversely, a perfectly writable target in a directory that itself denies write
/// (e.g. `0555`) is refused: creating the sibling temporary requires a directory entry to be added,
/// which needs write permission on the DIRECTORY, not the file.
///
/// # Errors
///
/// Any `std::io::Error` from creating, writing or renaming the temporary.
pub fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path.file_name().map_or_else(|| std::ffi::OsString::from("out"), std::ffi::OsStr::to_os_string);
    let mut tmp_name = name;
    tmp_name.push(format!(".redextape-tmp.{}", std::process::id()));
    let tmp = dir.join(tmp_name);

    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
    let filled = fill_temp(&mut file, path, contents);
    drop(file);

    if let Err(err) = filled {
        let _ = std::fs::remove_file(&tmp);
        return Err(err);
    }

    if let Err(err) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(err);
    }

    Ok(())
}

/// Write `contents` into the freshly created `file`, then — if `target` already exists — copy its
/// permissions onto `file` so the eventual rename does not widen them.
fn fill_temp(file: &mut std::fs::File, target: &Path, contents: &str) -> std::io::Result<()> {
    file.write_all(contents.as_bytes())?;
    if let Ok(meta) = std::fs::metadata(target) {
        file.set_permissions(meta.permissions())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn a_single_dash_means_standard_input() {
        assert!(matches!(Input::from_arg(Path::new("-")), Input::Stdin));
        assert!(matches!(Input::from_arg(Path::new("a.rxt")), Input::Path(_)));
    }

    #[test]
    fn stdin_is_labelled_so_a_diagnostic_can_name_it() {
        assert_eq!(Input::Stdin.label(), "<stdin>");
        assert_eq!(Input::from_arg(Path::new("a.rxt")).label(), "a.rxt");
    }

    #[test]
    fn a_missing_file_is_an_error_and_not_a_panic() {
        let e = Input::from_arg(Path::new("does/not/exist.rxt")).read().unwrap_err();
        assert!(e.to_string().contains("does/not/exist.rxt"), "the message names the file: {e}");
    }

    #[test]
    fn a_directory_is_an_error_and_not_a_panic() {
        let e = Input::from_arg(Path::new(".")).read().unwrap_err();
        assert!(!e.to_string().is_empty());
    }

    #[test]
    fn non_utf8_bytes_are_reported_rather_than_lossily_decoded() {
        let dir = redextape_test_support::ScratchDir::new("input-nonutf8").unwrap();
        let p = dir.join("bad.rxt");
        std::fs::write(&p, [0xff, 0xfe, 0x00]).unwrap();
        let e = Input::from_arg(&p).read().unwrap_err();
        assert!(e.to_string().contains("not valid UTF-8"), "got {e}");
    }

    #[test]
    fn an_atomic_write_replaces_the_file_contents() {
        let dir = redextape_test_support::ScratchDir::new("input-atomic").unwrap();
        let p = dir.join("out.rxt");
        std::fs::write(&p, "old").unwrap();
        write_atomic(&p, "new").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "new");
    }

    // M2 (mechanism): the previous test only pins the end state, which a plain `std::fs::write`
    // would also satisfy. Rename replaces the directory entry with a new inode; an in-place write
    // would truncate and rewrite the *same* inode. Unix-only because inode identity is a Unix
    // concept — there is no portable equivalent to assert.
    #[cfg(unix)]
    #[test]
    fn an_atomic_write_goes_through_a_rename_rather_than_truncating_in_place() {
        use std::os::unix::fs::MetadataExt;

        let dir = redextape_test_support::ScratchDir::new("input-atomic-inode").unwrap();
        let p = dir.join("out.rxt");
        std::fs::write(&p, "old").unwrap();
        let before = std::fs::metadata(&p).unwrap().ino();

        write_atomic(&p, "new").unwrap();

        let after = std::fs::metadata(&p).unwrap().ino();
        assert_ne!(before, after, "write_atomic should replace the file via rename, not truncate it in place");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "new");
    }

    // S2: a source file that was privately-permissioned before `fmt` touched it must come out with
    // the same permissions, not the process umask's default. Unix-specific — permission bits are a
    // Unix concept.
    #[cfg(unix)]
    #[test]
    fn an_atomic_write_preserves_the_target_s_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = redextape_test_support::ScratchDir::new("input-atomic-perms").unwrap();
        let p = dir.join("out.rxt");
        std::fs::write(&p, "old").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600)).unwrap();

        write_atomic(&p, "new").unwrap();

        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "write_atomic must not widen the target's permissions");
    }

    // S1: the temporary's name is deterministic (this process's id plus the target's file name), so
    // it is predictable — but `create_new` (`O_EXCL`) must still refuse a path that already exists,
    // symlink included, rather than following it. Plant the symlink at exactly the name `write_atomic`
    // will compute (we can, because the test and the code under test share a process, hence a pid),
    // pointing at a "victim" file that must never be touched.
    #[cfg(unix)]
    #[test]
    fn write_atomic_refuses_to_follow_a_symlink_planted_at_the_temp_path() {
        let dir = redextape_test_support::ScratchDir::new("input-atomic-symlink").unwrap();
        let target = dir.join("out.rxt");
        std::fs::write(&target, "old").unwrap();
        let victim = dir.join("victim.txt");
        std::fs::write(&victim, "victim-untouched").unwrap();

        let tmp = dir.join(format!("out.rxt.redextape-tmp.{}", std::process::id()));
        std::os::unix::fs::symlink(&victim, &tmp).unwrap();

        let result = write_atomic(&target, "new");
        assert!(result.is_err(), "a pre-existing temp path must not be silently written through");
        assert_eq!(
            std::fs::read_to_string(&victim).unwrap(),
            "victim-untouched",
            "the symlink target must be untouched"
        );
    }

    // M1: if the write succeeds but the rename fails, the temporary must not be left behind. Force
    // the rename to fail portably-within-Unix by making the destination an existing, non-empty
    // directory — renaming a regular file onto that is refused by the OS.
    #[test]
    fn a_failed_rename_does_not_leave_the_temporary_behind() {
        let dir = redextape_test_support::ScratchDir::new("input-atomic-rename-fails").unwrap();
        let target = dir.join("out.rxt");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("occupant"), "keeps the directory non-empty").unwrap();

        let result = write_atomic(&target, "new");
        assert!(result.is_err(), "renaming a file onto an existing non-empty directory should fail");

        let tmp = dir.join(format!("out.rxt.redextape-tmp.{}", std::process::id()));
        assert!(!tmp.exists(), "the temporary should be removed after a failed rename");
    }

    // M2 (boundary): a weakened `starts_with('-')` check would wrongly route `-foo` and `--` to
    // stdin. Only an exact `-` is stdin; everything else, including other dash-leading strings and a
    // dash with a leading path component, is a path.
    #[test]
    fn only_a_lone_dash_means_standard_input() {
        assert!(matches!(Input::from_arg(Path::new("-")), Input::Stdin));
        assert!(matches!(Input::from_arg(Path::new("-foo")), Input::Path(_)));
        assert!(matches!(Input::from_arg(Path::new("--")), Input::Path(_)));
        assert!(matches!(Input::from_arg(Path::new("./-")), Input::Path(_)));
    }
}
