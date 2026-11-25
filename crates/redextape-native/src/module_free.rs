//! CLIF without a `cranelift_module::Module`, so with no ISA: the `clif` feature, which builds for
//! wasm32. `build_clif` builds the functions `codegen::define_all` builds, numbered and imported as
//! a `Module` numbers and imports them, which `module_free_clif_equals_the_module_paths` checks.
//! `build_listing` builds them for the CLIF view, as built or optimised, and `machine_code` compiles
//! them for a target whose ISA the build has.

use cranelift_codegen::binemit::Reloc;
use cranelift_codegen::control::ControlPlane;
use cranelift_codegen::entity::PrimaryMap;
use cranelift_codegen::ir::{
    ExtFuncData, ExternalName, FuncRef, Function, UserExternalName, UserExternalNameRef, UserFuncName,
};
use cranelift_codegen::isa::{self, CallConv, TargetFrontendConfig};
use cranelift_codegen::settings::{self, Configurable, Flags, OptLevel};
use cranelift_codegen::{CodegenResult, Context};
use cranelift_codegen::{MachReloc, RelocTarget};
use cranelift_frontend::FunctionBuilderContext;
use redextape_core::core::NodeId;
use redextape_core::tm::{LowerError, Program};

use crate::analysis::{Subroutine, partition};
use crate::codegen::{Callee, FuncImports, jit_flags, rt_signature, translate_subroutine, word_signature};
use crate::rt_imports::RtFn;
use crate::shared::{MAX_REGISTERS, param_count, reg_over_cap};

/// The index `define_all`'s `Module` gives `callee`, its `FuncId`: the runtime imports are declared
/// first, in `RtFn::ALL`'s order, then the subroutines in `partition`'s order.
// `partition` makes at most one subroutine per instruction, so overflowing a `u32` needs a program
// of over 4 billion instructions in memory; `define_all`'s `FuncId` is a `u32` as well.
#[allow(clippy::cast_possible_truncation)]
fn index(callee: Callee) -> u32 {
    match callee {
        Callee::Rt(f) => f as u32,
        Callee::Sub(k) => (RtFn::ALL.len() + k) as u32,
    }
}

/// Imports as `Module::declare_func_in_func` does. Only a subroutine is `colocated`: it is defined
/// in the same module (`Linkage::Local`), and a runtime function is not.
struct Imports<'a> {
    config: TargetFrontendConfig,
    subs: &'a [Subroutine],
}

impl FuncImports for Imports<'_> {
    fn frontend_config(&self) -> TargetFrontendConfig {
        self.config
    }

    fn import(&mut self, func: &mut Function, callee: Callee) -> FuncRef {
        let (signature, colocated) = match callee {
            Callee::Rt(f) => (rt_signature(self.config, f), false),
            Callee::Sub(k) => (word_signature(self.config, param_count(&self.subs[k])), true),
        };
        let signature = func.import_signature(signature);
        let name = func.declare_imported_user_function(UserExternalName { namespace: 0, index: index(callee) });
        func.import_function(ExtFuncData { name: ExternalName::user(name), signature, colocated, patchable: false })
    }
}

fn unsupported(what: String) -> LowerError {
    LowerError::Unsupported { node: NodeId::default(), what }
}

fn codegen_error(e: impl std::fmt::Display) -> LowerError {
    unsupported(format!("native codegen: {e}"))
}

/// Why `build_clif` or a build from it refused a program, as a sentence a page can show: `Unsupported`'s own words,
/// and for `TooDeep` the guard it passed, since its node means nothing to a reader of the CLIF.
#[must_use]
pub fn decline_reason(e: &LowerError) -> String {
    match e {
        LowerError::Unsupported { what, .. } => what.clone(),
        LowerError::TooDeep { .. } => "the program nests deeper than the rxm lowering guard allows".to_string(),
    }
}

/// Each subroutine of `prog` as CLIF for a target with `config`, in `partition`'s order: the text
/// `define_all` builds before it optimises, which the JIT compiles. Each value read from or written to a
/// register is labelled with that register's `tm::reg_label`.
///
/// # Errors
/// `LowerError::Unsupported` when `partition` rejects `prog`, when a register index reaches
/// `MAX_REGISTERS` (the JIT rejects it too, before allocating a register bank that large), or when
/// translating a subroutine fails.
pub fn build_clif(prog: &Program, config: TargetFrontendConfig) -> Result<Vec<Function>, LowerError> {
    if reg_over_cap(prog) {
        return Err(unsupported(format!("register index exceeds MAX_REGISTERS ({MAX_REGISTERS})")));
    }
    let subs = partition(prog)?;
    let mut imports = Imports { config, subs: &subs };
    let mut fbctx = FunctionBuilderContext::new();
    let mut funcs = Vec::with_capacity(subs.len());
    for (k, sub) in subs.iter().enumerate() {
        let name = UserFuncName::user(0, index(Callee::Sub(k)));
        let mut func = Function::with_name_signature(name, word_signature(config, param_count(sub)));
        // Only here: `define_all`, which the JIT and AOT backends compile through, builds with no
        // labels, so the code it generates stays the code the snapshots hold.
        func.collect_debug_info();
        translate_subroutine(&mut imports, &mut func, &mut fbctx, prog, sub, &subs).map_err(|e| codegen_error(e.0))?;
        funcs.push(func);
    }
    Ok(funcs)
}

/// `x86_64-unknown-linux-gnu`'s frontend config, made without an ISA, which a wasm32 build has none of.
#[must_use]
pub fn isa_free_config() -> TargetFrontendConfig {
    TargetFrontendConfig {
        default_call_conv: CallConv::SystemV,
        pointer_width: target_lexicon::PointerWidth::U64,
        page_size_align_log2: 12,
    }
}

/// Which CLIF the CLIF view lists.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Listing {
    /// Each function as `build_clif` builds it, the text the JIT compiles.
    AsBuilt,
    /// Each function after Cranelift's optimisations at `opt_level = speed`, before it is lowered to
    /// machine code.
    Optimised,
}

impl Listing {
    /// The listing `name` names, or `None`.
    #[must_use]
    pub fn parse(name: &str) -> Option<Listing> {
        match name {
            "as-built" => Some(Listing::AsBuilt),
            "optimised" => Some(Listing::Optimised),
            _ => None,
        }
    }

    /// The name `parse` reads.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Listing::AsBuilt => "as-built",
            Listing::Optimised => "optimised",
        }
    }

    /// The level whose machine code goes with this listing: the code the JIT makes from the CLIF it
    /// lists. *As built* is what O0 compiles, with no Cranelift pass, and *optimised* what every level
    /// from O1 up compiles (`codegen::cranelift_opt_level` gives `speed`, or `speed_and_size`, whose
    /// code the snapshots hold equal to `speed`'s).
    fn opt_level(self) -> crate::OptLevel {
        match self {
            Listing::AsBuilt => crate::OptLevel::O0,
            Listing::Optimised => crate::OptLevel::O3,
        }
    }
}

/// One function's machine code, as `machine_code` compiles it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MachineFunction {
    /// The function's code bytes, its relocations' placeholders included.
    pub bytes: Vec<u8>,
    /// The ranges of `bytes` lowered from one rxm instruction, in order and apart. Code in no range,
    /// the prologue's and the exit's, was lowered from none.
    pub ranges: Vec<CodeRange>,
    /// Each place in `bytes` a call or an address is filled in when the code is linked, in order.
    pub relocs: Vec<CodeReloc>,
}

/// Bytes `start..end` of a function's code, lowered from the rxm instruction at `pc`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CodeRange {
    pub start: u32,
    pub end: u32,
    pub pc: u32,
}

/// A relocation at byte `offset`, naming the function `define_all`'s `Module` gives the index
/// `callee` (`index`'s numbering: the runtime imports in `RtFn::ALL`'s order, then the
/// subroutines in `partition`'s).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CodeReloc {
    pub offset: u32,
    pub callee: u32,
    /// Whether the eight bytes at `offset` are the callee's whole absolute address (`Reloc::Abs8`): on arm64
    /// a far call's address, placed as data beside the code that loads it; on x86-64 a `movabs` immediate.
    pub absolute: bool,
}

/// Each subroutine of `prog` compiled for `target` (a triple, `x86_64-unknown-linux-gnu`) with the
/// JIT's flags at `listing`'s level and no host CPU features: the code the snapshot gate's machine code
/// sections describe, byte for byte (`machine_code_equals_the_snapshots`), in `partition`'s order. The
/// CLIF is `build_clif`'s for the target's own frontend config; its value labels change no byte.
///
/// # Errors
/// `build_clif`'s, and `LowerError::Unsupported` when this build has no ISA for `target`, a function
/// does not compile, or a relocation in its code names no import or subroutine (`code_relocs`).
pub fn machine_code(prog: &Program, listing: Listing, target: &str) -> Result<Vec<MachineFunction>, LowerError> {
    let flags = jit_flags(listing.opt_level()).map_err(codegen_error)?;
    let isa = isa::lookup_by_name(target).map_err(codegen_error)?.finish(flags).map_err(codegen_error)?;
    let funcs = build_clif(prog, isa.frontend_config())?;
    let mut out = Vec::with_capacity(funcs.len());
    for func in funcs {
        let base = func.params.base_srcloc();
        let names = func.params.user_named_funcs().clone();
        let mut ctx = Context::for_function(func);
        let code =
            ctx.compile(&*isa, &mut ControlPlane::default()).map_err(|e| codegen_error(format!("{:?}", e.inner)))?;
        let ranges = code
            .buffer
            .get_srclocs_sorted()
            .iter()
            .filter_map(|range| {
                let loc = if range.loc.is_abs() { range.loc.as_abs() } else { range.loc.relocate(base) };
                (!loc.is_default() && range.start < range.end).then(|| CodeRange {
                    start: range.start,
                    end: range.end,
                    pc: loc.bits(),
                })
            })
            .collect();
        let relocs = code_relocs(code.buffer.relocs(), &names)?;
        out.push(MachineFunction { bytes: code.code_buffer().to_vec(), ranges, relocs });
    }
    Ok(out)
}

/// `relocs` as `CodeReloc`s, each naming its callee by `names`.
///
/// # Errors
/// `LowerError::Unsupported` for a relocation to anything but a runtime import or a subroutine, such as a
/// Cranelift library call: its target has no index to name, and on arm64 the address it fills in is data that
/// only a relocation marks, so dropping it would decode that address as instructions.
fn code_relocs(
    relocs: &[MachReloc],
    names: &PrimaryMap<UserExternalNameRef, UserExternalName>,
) -> Result<Vec<CodeReloc>, LowerError> {
    relocs
        .iter()
        .map(|reloc| match &reloc.target {
            RelocTarget::ExternalName(ExternalName::User(name)) if let Some(callee) = names.get(*name) => {
                Ok(CodeReloc { offset: reloc.offset, callee: callee.index, absolute: reloc.kind == Reloc::Abs8 })
            }
            target => Err(codegen_error(format!("a relocation to {target:?}, which names no import or subroutine"))),
        })
        .collect()
}

/// Each subroutine of `prog` as `listing` shows it, built for `isa_free_config` in `partition`'s order.
///
/// # Errors
/// `build_clif`'s, and `LowerError::Unsupported` when an optimisation pass fails.
pub fn build_listing(prog: &Program, listing: Listing) -> Result<Vec<Function>, LowerError> {
    let funcs = build_clif(prog, isa_free_config())?;
    if listing == Listing::AsBuilt {
        return Ok(funcs);
    }
    // Only `opt_level` is set, where the JIT's flags set more: `the_isa_free_listings_equal_the_snapshot_sections`
    // holds the output equal to the JIT's at `speed` on each snapshot target.
    let mut builder = settings::builder();
    builder.set("opt_level", "speed").map_err(codegen_error)?;
    let flags = Flags::new(builder);
    funcs.into_iter().map(|func| optimise(func, &flags).map_err(codegen_error)).collect()
}

/// `func` through the steps of `Context::optimize`, which takes an ISA, given `flags` alone. Its NaN
/// canonicalisation is left out: it needs an ISA, and runs only under `enable_nan_canonicalization`,
/// which neither `flags` nor the JIT's flags turn on.
fn optimise(func: Function, flags: &Flags) -> CodegenResult<Function> {
    let mut ctx = Context::for_function(func);
    ctx.verify_if(flags)?;
    ctx.compute_cfg();
    ctx.compute_domtree();
    ctx.eliminate_unreachable_code(flags)?;
    ctx.remove_constant_phis(flags)?;
    ctx.func.dfg.resolve_all_aliases();
    if flags.opt_level() != OptLevel::None {
        ctx.egraph_pass(flags, &mut ControlPlane::default())?;
    }
    Ok(ctx.func)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use cranelift_codegen::binemit::Reloc;
    use cranelift_codegen::entity::{EntityRef, PrimaryMap};
    use cranelift_codegen::ir::{
        ExternalName, Function, LibCall, UserExternalName, UserExternalNameRef, ValueLabelAssignments,
    };
    use cranelift_codegen::isa;
    use cranelift_codegen::settings;
    use cranelift_codegen::{MachReloc, RelocTarget};
    use redextape_core::tm::{Instr, LowerError, Program, Reg, label_reg, lower_program, reg_str};
    use redextape_core::{desugar::desugar, parser::parse};

    use super::{CodeReloc, Listing, MAX_REGISTERS, build_clif, build_listing, code_relocs, isa_free_config};

    /// How many of `func`'s defined values (each block's parameters, then its instructions' results, in
    /// layout order) carry labels, and the registers those labels name.
    fn labelled(func: &Function) -> (usize, BTreeSet<String>) {
        let Some(labels) = &func.dfg.values_labels else { return (0, BTreeSet::new()) };
        let mut values = 0;
        let mut regs = BTreeSet::new();
        for block in func.layout.blocks() {
            let results = func.layout.block_insts(block).flat_map(|inst| func.dfg.inst_results(inst).iter().copied());
            for value in func.dfg.block_params(block).iter().copied().chain(results) {
                if let Some(ValueLabelAssignments::Starts(starts)) = labels.get(&value) {
                    values += 1;
                    regs.extend(starts.iter().map(|start| reg_str(label_reg(start.label.as_u32()))));
                }
            }
        }
        (values, regs)
    }

    /// Each of `funcs` by name, with `labelled`'s count and registers.
    fn labelled_by_name(funcs: &[Function]) -> Vec<(String, usize, BTreeSet<String>)> {
        funcs
            .iter()
            .map(|func| {
                let (values, regs) = labelled(func);
                (func.name.to_string(), values, regs)
            })
            .collect()
    }

    fn regs(names: &[&str]) -> BTreeSet<String> {
        names.iter().map(|name| (*name).to_string()).collect()
    }

    fn fact() -> Program {
        let src = include_str!("../../../web/src/examples/fact.rxt");
        lower_program(&desugar(&parse(src).0.unwrap())).unwrap()
    }

    #[test]
    fn build_clif_labels_each_value_with_its_register() {
        let isa = isa::lookup_by_name("x86_64-unknown-linux-gnu").unwrap();
        let config = isa.finish(settings::Flags::new(settings::builder())).unwrap().frontend_config();
        let funcs = build_clif(&fact(), config).unwrap();
        assert_eq!(
            labelled_by_name(&funcs),
            [
                ("u0:11".to_string(), 5, regs(&["a0", "r0", "rr"])),
                ("u0:12".to_string(), 19, regs(&["a0", "r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "rr"])),
            ]
        );
    }

    #[test]
    fn labels_survive_on_the_values_the_optimiser_keeps() {
        let funcs = build_listing(&fact(), Listing::Optimised).unwrap();
        assert_eq!(
            labelled_by_name(&funcs),
            [
                ("u0:11".to_string(), 3, regs(&["a0", "r0", "rr"])),
                ("u0:12".to_string(), 7, regs(&["a0", "r0", "r6", "r8", "rr"])),
            ]
        );
    }

    #[test]
    fn each_listing_is_parsed_from_its_name() {
        assert_eq!([Listing::AsBuilt.name(), Listing::Optimised.name()], ["as-built", "optimised"]);
        for listing in [Listing::AsBuilt, Listing::Optimised] {
            assert_eq!(Listing::parse(listing.name()), Some(listing));
        }
        assert_eq!(Listing::parse("optimized"), None);
    }

    #[test]
    fn isa_free_config_matches_x86_64_linux() {
        let isa = isa::lookup_by_name("x86_64-unknown-linux-gnu").unwrap();
        let want = isa.finish(settings::Flags::new(settings::builder())).unwrap().frontend_config();
        let got = isa_free_config();
        assert_eq!(
            (got.default_call_conv, got.pointer_width, got.page_size_align_log2),
            (want.default_call_conv, want.pointer_width, want.page_size_align_log2)
        );
    }

    #[test]
    fn subroutines_follow_the_runtime_imports_and_import_each_other_colocated() {
        let prog = lower_program(&desugar(&parse("fn f(x) { x + 1 } f(2)").0.unwrap())).unwrap();
        let funcs = build_clif(&prog, isa_free_config()).unwrap();
        let names: Vec<String> = funcs.iter().map(|f| f.name.to_string()).collect();
        assert_eq!(names, ["u0:11", "u0:12"]);
        let main = &funcs[0];
        let colocated: Vec<String> = main
            .dfg
            .ext_funcs
            .values()
            .filter(|ext| ext.colocated)
            .map(|ext| ext.name.display(Some(&main.params)).to_string())
            .collect();
        assert_eq!(colocated, ["u0:11", "u0:12"]);
    }

    #[test]
    fn a_register_index_of_max_registers_is_refused() {
        // At the boundary, where a missing guard builds a million-register function and returns `Ok`.
        let isa = isa::lookup_by_name("x86_64-unknown-linux-gnu").unwrap();
        let config = isa.finish(settings::Flags::new(settings::builder())).unwrap().frontend_config();
        let prog = Program { code: vec![Instr::Li(Reg::Loc(MAX_REGISTERS), 1), Instr::Halt], labels: vec![] };
        let Err(LowerError::Unsupported { what, .. }) = build_clif(&prog, config) else {
            panic!("a register index of MAX_REGISTERS was not refused as `Unsupported`");
        };
        assert!(what.contains("MAX_REGISTERS"), "{what}");
    }

    #[test]
    fn a_relocation_naming_no_import_or_subroutine_is_refused() {
        let mut names = PrimaryMap::new();
        let rt = names.push(UserExternalName { namespace: 0, index: 3 });
        let reloc =
            |name| MachReloc { offset: 8, kind: Reloc::Abs8, target: RelocTarget::ExternalName(name), addend: 0 };
        let named = code_relocs(&[reloc(ExternalName::User(rt))], &names);
        assert_eq!(named, Ok(vec![CodeReloc { offset: 8, callee: 3, absolute: true }]));
        for name in [ExternalName::LibCall(LibCall::FloorF64), ExternalName::User(UserExternalNameRef::new(1))] {
            let Err(LowerError::Unsupported { what, .. }) = code_relocs(&[reloc(name.clone())], &names) else {
                panic!("a relocation to {name:?} was not refused as `Unsupported`");
            };
            assert!(what.contains("names no import or subroutine"), "{what}");
        }
    }
}
