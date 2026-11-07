//! The §7.1 snapshot gate of `docs/superpowers/specs/2026-10-27-ir-views-groundwork-design.md`: every
//! corpus program's generated code on fixed targets, so that a change to the lowering can show it
//! leaves the CLIF, the machine code and the LLVM IR byte for byte as they were.
//!
//! The corpus is the native oracle's five lists (`tests/common/corpus.rs`), the web examples,
//! `measure::CORPUS` and `RXM_PROGRAMS`, hand-written rxm for shapes the λ lowering never emits. The
//! targets are fixed, never the host's, so the text is the same on every machine.
//!
//! Each program has three files in `snapshots/`, each opening with `;; <key>` and the source:
//! `<key>.clif` holds the CLIF as built, then per Cranelift target and level the optimised CLIF and
//! each function's code size, code hash and vcode; `<key>.ll` the LLVM module as built, one text for
//! `O0`-`O3` and one each for `Os` and `Oz`, whose size attributes are attached while it is built;
//! `<key>.opt.ll` the module after each level's passes. Post-pass IR may move with the LLVM release,
//! so on a release other than the one `llvm-version.txt` names, a difference in it prints a `NOTE:`
//! naming both releases and passes.
//!
//! A compare test fails on any file that differs, is missing, or belongs to no corpus key. To accept
//! a change, regenerate (on LLVM 23.1) and review `git diff --stat -- crates/redextape-native/snapshots`:
//!
//! ```text
//! REDEXTAPE_WRITE_SNAPSHOTS=1 cargo nextest run -p redextape-native --features llvm --lib codegen_snapshots
//! ```

// Clippy's `allow-*-in-tests` keys (see `clippy.toml`) recognize a BARE `#[cfg(test)]` only, not
// the feature-gated form this module needs, so the test exemption is restated here.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

#[cfg(feature = "cranelift")]
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[cfg(feature = "cranelift")]
use cranelift_codegen::ir::{Block, ExternalName, InstructionData, SourceLoc};
#[cfg(feature = "cranelift")]
use cranelift_codegen::isa::{self, OwnedTargetIsa};
#[cfg(feature = "cranelift")]
use cranelift_frontend::FunctionBuilderContext;
#[cfg(feature = "cranelift")]
use cranelift_module::default_libcall_names;
#[cfg(feature = "cranelift")]
use cranelift_object::{ObjectBuilder, ObjectModule};
#[cfg(feature = "llvm")]
use inkwell::context::Context;
#[cfg(feature = "llvm")]
use inkwell::targets::{InitializationConfig, Target, TargetTriple};
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{Program, lower_program, parse_rxm};

use crate::OptLevel;
#[cfg(feature = "llvm")]
use crate::analysis::Subroutine;
use crate::analysis::partition;
#[cfg(feature = "cranelift")]
use crate::codegen::{self, Stage};
#[cfg(feature = "llvm")]
use crate::llvm;
#[cfg(feature = "cranelift")]
use crate::rt_imports::RtFn;

#[path = "../tests/common/corpus.rs"]
mod corpus;

/// The site's examples, by file stem. `corpus_holds_every_web_example` keeps this list equal to the
/// directory, so a new example fails a test until it is snapshotted.
const WEB_EXAMPLES: [(&str, &str); 7] = [
    ("arithmetic", include_str!("../../../web/src/examples/arithmetic.rxt")),
    ("closure", include_str!("../../../web/src/examples/closure.rxt")),
    ("fact-12", include_str!("../../../web/src/examples/fact-12.rxt")),
    ("fact", include_str!("../../../web/src/examples/fact.rxt")),
    ("is-even", include_str!("../../../web/src/examples/is-even.rxt")),
    ("map-fold", include_str!("../../../web/src/examples/map-fold.rxt")),
    ("sum-to", include_str!("../../../web/src/examples/sum-to.rxt")),
];

/// rxm programs, by name, for shapes the λ lowering never emits. It places every `jz` ahead of its
/// label, so only hand-written rxm has a backward `jz`, which ticks before it reads its register;
/// `backward-jz` is a loop closed by one.
const RXM_PROGRAMS: [(&str, &str); 1] = [(
    "backward-jz",
    concat!(
        "    li\tr0, #3\n",
        "    li\tr1, #1\n",
        "    li\tr2, #0\n",
        "    li\trr, #0\n",
        "loop:\n",
        "    add\trr, rr, r0\n",
        "    sub\tr0, r0, r1\n",
        "    cmpeq\tr3, r0, r2\n",
        "    jz\tr3, loop\n",
        "    halt\n",
    ),
)];

/// The Cranelift targets every program is compiled for.
#[cfg(feature = "cranelift")]
const TARGETS: [&str; 2] = ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"];

/// One `OptLevel` for each Cranelift `opt_level` (`none`, `speed`, `speed_and_size`), which names its
/// sections.
#[cfg(feature = "cranelift")]
const LEVELS: [OptLevel; 3] = [OptLevel::O0, OptLevel::O3, OptLevel::Os];

/// The LLVM levels, with the names their sections use.
#[cfg(feature = "llvm")]
const LLVM_LEVELS: [(OptLevel, &str); 6] = [
    (OptLevel::O0, "O0"),
    (OptLevel::O1, "O1"),
    (OptLevel::O2, "O2"),
    (OptLevel::O3, "O3"),
    (OptLevel::Os, "Os"),
    (OptLevel::Oz, "Oz"),
];

const SNAPSHOT_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/snapshots");

const REGENERATE: &str =
    "REDEXTAPE_WRITE_SNAPSHOTS=1 cargo nextest run -p redextape-native --features llvm --lib codegen_snapshots";

/// Every program the snapshots cover, as (key, source), in the order the keys are listed.
fn corpus() -> Vec<(String, String)> {
    let lists: [(&str, &[&str]); 5] = [
        ("first-order", corpus::FIRST_ORDER_DEMOS),
        ("lambda-limitation", corpus::LAMBDA_LIMITATION_DEMOS),
        ("beyond-field-width", corpus::BEYOND_FIELD_WIDTH_DEMOS),
        ("saturation", corpus::SATURATION_DEMOS),
        ("fault", corpus::FAULT_DEMOS),
    ];
    let mut out = Vec::new();
    for (prefix, list) in lists {
        for (i, src) in list.iter().enumerate() {
            out.push((format!("{prefix}-{i:02}"), (*src).to_string()));
        }
    }
    for (stem, src) in WEB_EXAMPLES {
        out.push((format!("example-{stem}"), src.to_string()));
    }
    for (name, src) in crate::measure::CORPUS {
        out.push((format!("measure-{name}"), src.to_string()));
    }
    for (name, src) in RXM_PROGRAMS {
        out.push((format!("rxm-{name}"), src.to_string()));
    }
    out
}

/// `src` parsed with no diagnostics: as rxm under an `rxm-` key, and otherwise as λ, then desugared and
/// lowered.
fn program_of(key: &str, src: &str) -> Program {
    if key.starts_with("rxm-") {
        let (prog, diagnostics) = parse_rxm(src);
        assert!(diagnostics.is_empty(), "{key}: parse diagnostics {diagnostics:?}");
        return prog.unwrap();
    }
    let (ast, diagnostics) = parse(src);
    assert!(diagnostics.is_empty(), "{key}: parse diagnostics {diagnostics:?}");
    lower_program(&desugar(&ast.unwrap())).unwrap_or_else(|e| panic!("{key}: does not lower: {e:?}"))
}

/// Under `REDEXTAPE_WRITE_SNAPSHOTS=1` a compare test writes its files instead of comparing them.
fn writing() -> bool {
    std::env::var_os("REDEXTAPE_WRITE_SNAPSHOTS").is_some_and(|value| value == "1")
}

/// A snapshot file's opening lines: its key and the program's source.
fn file_header(key: &str, src: &str) -> String {
    let mut out = format!(";; {key}\n;; source:\n");
    for line in src.lines() {
        out.push_str(";;   ");
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// Appends a section: its header line, then `parts` separated by blank lines.
fn push_section(out: &mut String, title: &str, parts: &[String]) {
    out.push_str(&format!(";; ==== {title} ====\n"));
    for (i, part) in parts.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(part);
        if !part.ends_with('\n') {
            out.push('\n');
        }
    }
}

/// Where `generated` first departs from `on_disk`: the line, and the section header above it.
fn first_difference(on_disk: &str, generated: &str) -> String {
    let on_disk: Vec<&str> = on_disk.lines().collect();
    let generated: Vec<&str> = generated.lines().collect();
    let same = on_disk.iter().zip(&generated).take_while(|(a, b)| a == b).count();
    if same == on_disk.len() && same == generated.len() {
        return "differs only in its line endings or final newline".to_string();
    }
    let section = generated.iter().take(same + 1).rev().find(|line| line.starts_with(";; ====")).unwrap_or(&";; <key>");
    format!("line {}, under `{section}`", same + 1)
}

/// The files of one kind in `snapshots/` that `files` (name, text) does not name: orphans, which the
/// comparison reports and the writer deletes.
fn orphans(files: &[(String, String)], owns: impl Fn(&str) -> bool) -> Vec<String> {
    let mut orphans: Vec<String> = std::fs::read_dir(SNAPSHOT_DIR)
        .map(|entries| {
            entries
                .map(|entry| entry.unwrap().file_name().into_string().unwrap())
                .filter(|name| owns(name) && !files.iter().any(|(file, _)| file == name))
                .collect()
        })
        .unwrap_or_default();
    orphans.sort();
    orphans
}

/// Writes `files` to `snapshots/` and deletes the orphans of the kind `owns` names.
fn write(files: &[(String, String)], owns: impl Fn(&str) -> bool) {
    let dir = Path::new(SNAPSHOT_DIR);
    std::fs::create_dir_all(dir).unwrap();
    for name in orphans(files, owns) {
        std::fs::remove_file(dir.join(name)).unwrap();
    }
    for (name, text) in files {
        std::fs::write(dir.join(name), text).unwrap();
    }
}

/// How `snapshots/` disagrees with `files`: each file whose text differs, with its first differing
/// line, and each file that is missing or an orphan of the kind `owns` names.
fn compare(files: &[(String, String)], owns: impl Fn(&str) -> bool) -> (Vec<String>, Vec<String>) {
    let (mut differing, mut absent) = (Vec::new(), Vec::new());
    for (name, generated) in files {
        match std::fs::read_to_string(Path::new(SNAPSHOT_DIR).join(name)) {
            Err(_) => absent.push(format!("{name}: missing")),
            Ok(on_disk) if on_disk != *generated => {
                differing.push(format!("{name}: {}", first_difference(&on_disk, generated)));
            }
            Ok(_) => {}
        }
    }
    absent.extend(orphans(files, owns).iter().map(|name| format!("{name}: no corpus key produces it")));
    (differing, absent)
}

/// Fails, listing every problem and the regenerate command, unless `problems` is empty.
fn fail_on(problems: &[String]) {
    assert!(
        problems.is_empty(),
        "{} snapshot file(s) disagree with the generated code:\n  {}\nIf the change is intended, regenerate \
         with\n  {REGENERATE}\nand review `git diff --stat -- crates/redextape-native/snapshots`.",
        problems.len(),
        problems.join("\n  "),
    );
}

/// Writes `files` when `writing()`; otherwise fails on any file that differs, is missing or is an
/// orphan of the kind `owns` names.
fn compare_or_write(files: &[(String, String)], owns: impl Fn(&str) -> bool) {
    if writing() {
        write(files, owns);
    } else {
        let (differing, absent) = compare(files, owns);
        fail_on(&[differing, absent].concat());
    }
}

/// The hash of a function's machine-code bytes, which its `;; function` line records.
#[cfg(feature = "cranelift")]
fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, &b| (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3))
}

/// A Cranelift ISA for `target` with the JIT's flags at `opt` (`codegen::jit_flags`) and no host CPU
/// features.
#[cfg(feature = "cranelift")]
fn fixed_isa(target: &str, opt: OptLevel) -> OwnedTargetIsa {
    isa::lookup_by_name(target).unwrap().finish(codegen::jit_flags(opt).unwrap()).unwrap()
}

/// One program's CLIF and machine code on one ISA, one entry per function in `partition` order.
#[cfg(feature = "cranelift")]
#[derive(PartialEq)]
struct ClifDump {
    /// Each function as `translate_subroutine` built it.
    built: Vec<String>,
    /// Each function after `define_function`, which optimises `ctx.func` in place.
    optimised: Vec<String>,
    /// Each function's `;; function` line (size and hash of its code bytes), then its vcode.
    machine_code: Vec<String>,
}

/// Compile `prog` on `isa` through the JIT's own loop, `codegen::define_all`, over an `ObjectModule`.
#[cfg(feature = "cranelift")]
fn clif_dump(prog: &Program, isa: OwnedTargetIsa) -> ClifDump {
    let mut module = ObjectModule::new(ObjectBuilder::new(isa, "redextape", default_libcall_names()).unwrap());
    let subs = partition(prog).unwrap();
    let mut dump = ClifDump { built: Vec::new(), optimised: Vec::new(), machine_code: Vec::new() };
    codegen::define_all(&mut module, prog, &subs, &mut FunctionBuilderContext::new(), |stage, fid, ctx| match stage {
        Stage::Built => {
            dump.built.push(ctx.func.display().to_string());
            ctx.set_disasm(true);
        }
        Stage::Defined => {
            dump.optimised.push(ctx.func.display().to_string());
            let code = ctx.compiled_code().unwrap();
            let bytes = code.code_buffer();
            let vcode = code.vcode.as_deref().unwrap();
            let id = fid.as_u32();
            dump.machine_code.push(format!(
                ";; function u0:{id}: {} bytes, fnv1a64 {:016x}\n{vcode}",
                bytes.len(),
                fnv1a64(bytes)
            ));
        }
    })
    .unwrap();
    dump
}

/// The text of `<key>.clif`.
#[cfg(feature = "cranelift")]
fn clif_snapshot(key: &str, src: &str) -> String {
    let prog = program_of(key, src);
    let mut built: Option<Vec<String>> = None;
    let mut compiled = String::new();
    for target in TARGETS {
        for opt in LEVELS {
            let level = codegen::cranelift_opt_level(opt);
            let dump = clif_dump(&prog, fixed_isa(target, opt));
            // The file holds one as-built section, which stands for all six only while they agree.
            match &built {
                None => built = Some(dump.built),
                Some(first) => assert!(*first == dump.built, "{key}: the CLIF as built differs on {target} at {level}"),
            }
            push_section(&mut compiled, &format!("{target} {level}: optimised"), &dump.optimised);
            push_section(&mut compiled, &format!("{target} {level}: machine code"), &dump.machine_code);
        }
    }
    let mut out = file_header(key, src);
    push_section(&mut out, "built", &built.unwrap());
    out.push_str(&compiled);
    out
}

/// `prog`'s LLVM module at `opt`, printed as built or, when `optimised`, after `optimize`. The
/// machine is x86-64 with the generic CPU and no host features, initialized alone so a host of
/// another architecture prints the same text.
#[cfg(feature = "llvm")]
fn llvm_ir(prog: &Program, subs: &[Subroutine], opt: OptLevel, optimised: bool) -> String {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| Target::initialize_x86(&InitializationConfig::default()));
    let machine = llvm::target_machine(&TargetTriple::create("x86_64-unknown-linux-gnu"), "x86-64", "", opt).unwrap();
    let ctx = Context::create();
    let (module, _) = llvm::build_module(&ctx, &machine, prog, subs, opt).unwrap();
    if optimised {
        llvm::optimize(&module, &machine, opt).unwrap();
    }
    module.print_to_string().to_string()
}

#[test]
fn corpus_holds_every_web_example() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../web/src/examples");
    let mut on_disk: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| {
            let name = entry.unwrap().file_name().into_string().unwrap();
            name.strip_suffix(".rxt").map_or(name.clone(), |stem| format!("example-{stem}"))
        })
        .collect();
    on_disk.sort();
    let mut listed: Vec<String> =
        corpus().into_iter().map(|(key, _)| key).filter(|k| k.starts_with("example-")).collect();
    listed.sort();
    assert_eq!(on_disk, listed, "web/src/examples differs from the corpus: list the new example in WEB_EXAMPLES");
}

/// A snapshot needs the text to be the same on every build. The callee imports are the part that
/// could vary, so each function must import them in declaration order (ascending `u0:` index).
#[cfg(feature = "cranelift")]
#[test]
fn every_build_prints_the_same_clif() {
    let mut programs = 0;
    for (key, src) in corpus() {
        let prog = program_of(&key, &src);
        let n_subs = partition(&prog).unwrap().len();
        if n_subs < 3 {
            continue;
        }
        programs += 1;
        for target in TARGETS {
            let first = clif_dump(&prog, fixed_isa(target, OptLevel::O3));
            for build in 1..8 {
                let again = clif_dump(&prog, fixed_isa(target, OptLevel::O3));
                assert!(
                    again == first,
                    "{key} on {target}: build {build} differs from build 0 (built equal: {}, optimised equal: {}, \
                     machine code equal: {})",
                    again.built == first.built,
                    again.optimised == first.optimised,
                    again.machine_code == first.machine_code,
                );
            }
            for function in &first.built {
                let callees: Vec<u32> = function
                    .lines()
                    .filter_map(|line| line.split_once("colocated u0:"))
                    .map(|(_, rest)| rest.split_whitespace().next().unwrap().parse().unwrap())
                    .collect();
                assert_eq!(callees.len(), n_subs, "{key} on {target}: a function does not import every subroutine");
                assert!(
                    callees.windows(2).all(|w| w[0] < w[1]),
                    "{key} on {target}: callees imported out of declaration order: {callees:?}"
                );
            }
        }
    }
    assert!(programs > 0, "no corpus program has 3 subroutines");
}

/// `build_clif` is the CLIF a reader is shown, so it must be the CLIF the JIT compiles: each function
/// as `define_all` builds it over a `Module`, numbered and importing its callees the same way.
#[cfg(feature = "cranelift")]
#[test]
fn module_free_clif_equals_the_module_paths() {
    let mut differing = Vec::new();
    for (key, src) in corpus() {
        let prog = program_of(&key, &src);
        for target in TARGETS {
            let isa = fixed_isa(target, OptLevel::O0);
            let module_free: String = crate::build_clif(&prog, isa.frontend_config())
                .unwrap()
                .iter()
                .map(|f| f.display().to_string())
                .collect();
            let via_module = clif_dump(&prog, isa).built.concat();
            if module_free != via_module {
                let same = via_module.lines().zip(module_free.lines()).take_while(|(a, b)| a == b).count();
                differing.push(format!("{key} on {target}: first difference at line {}", same + 1));
            }
        }
    }
    assert!(
        differing.is_empty(),
        "{} build(s) differ from define_all's:\n  {}",
        differing.len(),
        differing.join("\n  ")
    );
}

/// The CLIF view links a CLIF instruction to the rxm instruction it lowers by its source location:
/// every instruction in the block of the rxm instruction at code index `pc`, and in each block a guard
/// there continues in, carries `pc`, and the prologue and the shared exit, which lower no one
/// instruction, carry the default. No corpus program has a loop, a call and a heap op together, so
/// this walks every program and asserts that it met each of those guards.
#[cfg(feature = "cranelift")]
#[test]
fn each_instruction_carries_its_pc() {
    let config = fixed_isa(TARGETS[0], OptLevel::O0).frontend_config();
    let mut guards = HashSet::new();
    let mut a_position_is_not_its_pc = false;
    for (key, src) in corpus() {
        let prog = program_of(&key, &src);
        let subs = partition(&prog).unwrap();
        for (sub, func) in subs.iter().zip(crate::build_clif(&prog, config).unwrap()) {
            let name = &func.name;
            // `ClifSink` creates the entry block, then one block per `body` entry, then the exit.
            let exit = Block::from_u32(u32::try_from(sub.body.len() + 1).unwrap());
            let mut owner = HashMap::from([(Block::from_u32(0), SourceLoc::default()), (exit, SourceLoc::default())]);
            for (block, &pc) in (1..).map(Block::from_u32).zip(&sub.body) {
                owner.insert(block, SourceLoc::new(u32::try_from(pc).unwrap()));
            }
            a_position_is_not_its_pc |= sub.body.iter().enumerate().any(|(k, &pc)| k != pc);
            let mut laid_out = 0;
            for block in func.layout.blocks() {
                let want = *owner
                    .get(&block)
                    .unwrap_or_else(|| panic!("{key} {name}: {block} is no block of `body` or a guard"));
                laid_out += 1;
                for inst in func.layout.block_insts(block) {
                    assert_eq!(func.srcloc(inst), want, "{key} {name} {block}: `{}`", func.dfg.display_inst(inst));
                }
                let last = func.layout.last_inst(block).unwrap();
                if let InstructionData::Brif { blocks: [taken, cont], .. } = &func.dfg.insts[last]
                    && taken.block(&func.dfg.value_lists) == exit
                {
                    owner.insert(cont.block(&func.dfg.value_lists), want);
                    let call = func.layout.prev_inst(last).unwrap();
                    let InstructionData::Call { func_ref, .. } = &func.dfg.insts[call] else {
                        panic!("{key} {name} {block}: a branch to the exit follows no guard call")
                    };
                    let ExternalName::User(callee) = &func.dfg.ext_funcs[*func_ref].name else { unreachable!() };
                    guards.insert(func.params.user_named_funcs()[*callee].index);
                }
            }
            assert_eq!(laid_out, owner.len(), "{key} {name}: a block of `body` or a guard's is not laid out");
        }
    }
    for guard in [RtFn::Tick, RtFn::Enter, RtFn::Faulted] {
        assert!(guards.contains(&(guard as u32)), "no corpus program has a {} guard", guard.symbol());
    }
    assert!(a_position_is_not_its_pc, "no function tells a `body` position from its code index");
}

#[cfg(feature = "cranelift")]
#[test]
fn clif_matches_the_snapshots() {
    let files: Vec<(String, String)> =
        corpus().iter().map(|(key, src)| (format!("{key}.clif"), clif_snapshot(key, src))).collect();
    compare_or_write(&files, |name| name.ends_with(".clif"));
}

#[cfg(feature = "llvm")]
#[test]
fn built_llvm_ir_matches_the_snapshots() {
    let files: Vec<(String, String)> = corpus()
        .iter()
        .map(|(key, src)| {
            let prog = program_of(key, src);
            let subs = partition(&prog).unwrap();
            let built: Vec<String> = LLVM_LEVELS.iter().map(|&(opt, _)| llvm_ir(&prog, &subs, opt, false)).collect();
            assert!(built[1..4].iter().all(|b| *b == built[0]), "{key}: the LLVM IR as built differs within O0-O3");
            let mut out = file_header(key, src);
            push_section(&mut out, "built: O0 O1 O2 O3", &built[0..1]);
            push_section(&mut out, "built: Os", &built[4..5]);
            push_section(&mut out, "built: Oz", &built[5..6]);
            (format!("{key}.ll"), out)
        })
        .collect();
    compare_or_write(&files, |name| name.ends_with(".ll") && !name.ends_with(".opt.ll"));
}

/// Post-pass IR may change with the LLVM release, so a difference in it fails only on the release that
/// wrote it (`llvm-version.txt`). On any other release it prints a `NOTE:` naming both and passes; a
/// missing or orphan file fails on every release, since no release explains it.
#[cfg(feature = "llvm")]
#[test]
fn optimised_llvm_ir_matches_the_snapshots_on_the_recorded_llvm() {
    let (major, minor, patch) = inkwell::support::get_llvm_version();
    let running = format!("{major}.{minor}.{patch}");
    let mut files: Vec<(String, String)> = corpus()
        .iter()
        .map(|(key, src)| {
            let prog = program_of(key, src);
            let subs = partition(&prog).unwrap();
            let mut out = file_header(key, src);
            for &(opt, name) in &LLVM_LEVELS[1..] {
                push_section(&mut out, name, &[llvm_ir(&prog, &subs, opt, true)]);
            }
            (format!("{key}.opt.ll"), out)
        })
        .collect();
    if writing() {
        files.push(("llvm-version.txt".to_string(), format!("{running}\n")));
        write(&files, |name| name.ends_with(".opt.ll"));
        return;
    }
    let path = format!("{SNAPSHOT_DIR}/llvm-version.txt");
    let recorded =
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}; regenerate with {REGENERATE}"));
    let recorded = recorded.trim();
    let (differing, absent) = compare(&files, |name| name.ends_with(".opt.ll"));
    if recorded == running {
        fail_on(&[differing, absent].concat());
        return;
    }
    fail_on(&absent);
    if !differing.is_empty() {
        println!(
            "NOTE: this is LLVM {running}, the post-pass IR snapshots are LLVM {recorded}'s, so {} differing \
             file(s) pass:\n  {}",
            differing.len(),
            differing.join("\n  "),
        );
    }
}
