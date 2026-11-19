//! What the stepper's tests share: the snapshot corpus, the tight caps, and agreement with the JIT.
//!
//! The corpus is read back from `redextape-native`'s snapshot files, whose headers hold each program's key
//! and source, because the lists it is built from are that crate's test code, which no other crate can use.

use std::path::PathBuf;

use cranelift_codegen::ir::Function;
use redextape_clif::ClifEnd;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{Caps, DEFAULT_CAPS, Program, lower_program, parse_rxm};
use redextape_core::trace::RxmCap;
use redextape_native::NativeRun;

const SNAPSHOT_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../redextape-native/snapshots");

/// Caps tight enough that some corpus programs stop at each of the steps, stack and heap caps.
pub const TIGHT: Caps = Caps { steps: 40, stack: 6, heap: 4, mem: DEFAULT_CAPS.mem };

/// The corpus programs the stepper stops at `DEFAULT_CAPS.mem`, where the JIT runs them to their end: their
/// interpreter frames hold more than native frames do. Held fixed, so a program joining or leaving it fails.
pub const FRAME_MEMORY_LIST: [&str; 1] = ["measure-box30000"];

/// Every snapshot's program with its key, in file name order.
pub fn corpus() -> Vec<(String, Program)> {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(SNAPSHOT_DIR)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "clif"))
        .collect();
    paths.sort();
    paths.iter().map(|path| program_in(&std::fs::read_to_string(path).unwrap())).collect()
}

/// The key and program of a snapshot's header: `;; <key>`, `;; source:`, then each source line as
/// `;;   <line>`, or a bare `;;` when blank, up to the first section's header. Any other line fails, so a
/// misread header cannot pass as a program.
fn program_in(text: &str) -> (String, Program) {
    let mut lines = text.lines();
    let key = lines.next().and_then(|line| line.strip_prefix(";; ")).unwrap().to_string();
    assert_eq!(lines.next(), Some(";; source:"), "{key}: no source marker");
    let mut src = String::new();
    for line in lines.take_while(|line| !line.starts_with(";; ==== ")) {
        let source_line = if line == ";;" {
            ""
        } else {
            line.strip_prefix(";;   ").unwrap_or_else(|| panic!("{key}: not a source line: {line:?}"))
        };
        src.push_str(source_line);
        src.push('\n');
    }
    let prog = program_of(&key, &src);
    (key, prog)
}

/// `src` parsed with no diagnostics: as rxm under an `rxm-` key, and otherwise as λ, then desugared and
/// lowered.
pub fn program_of(key: &str, src: &str) -> Program {
    if key.starts_with("rxm-") {
        let (prog, diagnostics) = parse_rxm(src);
        assert!(diagnostics.is_empty(), "{key}: parse diagnostics {diagnostics:?}");
        return prog.unwrap();
    }
    let (ast, diagnostics) = parse(src);
    assert!(diagnostics.is_empty(), "{key}: parse diagnostics {diagnostics:?}");
    lower_program(&desugar(&ast.unwrap())).unwrap_or_else(|e| panic!("{key}: does not lower: {e:?}"))
}

/// The text of `key`'s snapshot file.
pub fn snapshot(key: &str) -> String {
    let path = format!("{SNAPSHOT_DIR}/{key}.clif");
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// The text of `file`'s section titled `title`: after its header line, up to the next section's header
/// line or the end of the file.
pub fn section<'a>(file: &'a str, title: &str) -> Option<&'a str> {
    let header = format!("\n;; ==== {title} ====\n");
    let rest = &file[file.find(&header)? + header.len()..];
    Some(rest.find("\n;; ==== ").map_or(rest, |end| &rest[..=end]))
}

/// `funcs` displayed and joined as the snapshot writer joins a section's functions: a blank line between
/// two, each ending in a newline.
pub fn listing_text(funcs: &[Function]) -> String {
    let mut out = String::new();
    for (i, func) in funcs.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        let text = func.display().to_string();
        out.push_str(&text);
        if !text.ends_with('\n') {
            out.push('\n');
        }
    }
    out
}

/// The first characters of `value`'s debug text: a `Ran` holds the whole heap.
pub fn short(value: &impl std::fmt::Debug) -> String {
    format!("{value:?}").chars().take(160).collect()
}

/// Whether the stepper ended where the JIT did: the same value and heap, the same fault text, or a stop at
/// the steps, stack or heap cap, which the JIT reports alike.
pub fn agrees(end: &ClifEnd, jit: &NativeRun) -> bool {
    match (end, jit) {
        (ClifEnd::Ran(stepped), NativeRun::Ran(compiled)) => stepped == compiled,
        (ClifEnd::Fault { why, .. }, NativeRun::Fault(text)) => why == text,
        (ClifEnd::Capped(RxmCap::Steps | RxmCap::Stack | RxmCap::Heap), NativeRun::HitCap) => true,
        _ => false,
    }
}
