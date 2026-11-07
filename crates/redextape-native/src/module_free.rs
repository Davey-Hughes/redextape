//! CLIF without a `cranelift_module::Module`, so with no ISA: the `clif` feature, which builds for
//! wasm32. `build_clif` builds the functions `codegen::define_all` builds, numbered and imported as
//! a `Module` numbers and imports them, which `module_free_clif_equals_the_module_paths` checks.

use cranelift_codegen::ir::{ExtFuncData, ExternalName, FuncRef, Function, UserExternalName, UserFuncName};
use cranelift_codegen::isa::TargetFrontendConfig;
use cranelift_frontend::FunctionBuilderContext;
use redextape_core::core::NodeId;
use redextape_core::tm::{LowerError, Program};

use crate::analysis::{Subroutine, partition};
use crate::codegen::{Callee, FuncImports, rt_signature, translate_subroutine, word_signature};
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

/// Each subroutine of `prog` as CLIF for a target with `config`, in `partition`'s order: the text
/// `define_all` builds before it optimises, which the JIT compiles.
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
        translate_subroutine(&mut imports, &mut func, &mut fbctx, prog, sub, &subs)
            .map_err(|e| unsupported(format!("native codegen: {}", e.0)))?;
        funcs.push(func);
    }
    Ok(funcs)
}

#[cfg(test)]
mod tests {
    use cranelift_codegen::isa::{self, CallConv};
    use cranelift_codegen::settings;
    use redextape_core::tm::{Instr, LowerError, Program, Reg, lower_program};
    use redextape_core::{desugar::desugar, parser::parse};

    use super::{MAX_REGISTERS, build_clif};

    #[test]
    fn subroutines_follow_the_runtime_imports_and_import_each_other_colocated() {
        // `PointerWidth` is `target_lexicon`'s, which cranelift-codegen does not re-export, so the
        // config comes from an ISA and is checked to be the one wanted.
        let isa = isa::lookup_by_name("x86_64-unknown-linux-gnu").unwrap();
        let config = isa.finish(settings::Flags::new(settings::builder())).unwrap().frontend_config();
        assert!(config.default_call_conv == CallConv::SystemV && config.pointer_bits() == 64);
        assert_eq!(config.page_size_align_log2, 12);
        let prog = lower_program(&desugar(&parse("fn f(x) { x + 1 } f(2)").0.unwrap())).unwrap();
        let funcs = build_clif(&prog, config).unwrap();
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
}
