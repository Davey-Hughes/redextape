//! Machine code Cranelift compiles as the tests run, through `machine_function` with `machine_code`'s ISA at
//! `speed`: data placed in the code, which no program makes and each reader must place or refuse, as it is emitted.

use cranelift_codegen::ir::types::{F64, I32, I64};
use cranelift_codegen::ir::{
    AbiParam, BlockCall, Function, InstBuilder, JumpTableData, Signature, UserFuncName, Value,
};
use cranelift_frontend::{FunctionBuilder, FunctionBuilderContext};
use redextape_native::{Listing, MachineFunction, machine_function, machine_isa};

use crate::Target;

/// For `target`, `u0:12` as `body` builds it from its entry block and `i64` parameter, returning one `i64`.
fn compile(target: Target, body: impl FnOnce(&mut FunctionBuilder, Value)) -> MachineFunction {
    let isa = machine_isa(Listing::Optimised, target.triple()).unwrap();
    let mut sig = Signature::new(isa.default_call_conv());
    sig.params.push(AbiParam::new(I64));
    sig.returns.push(AbiParam::new(I64));
    let mut func = Function::with_name_signature(UserFuncName::user(0, 12), sig);
    let mut fctx = FunctionBuilderContext::new();
    let mut b = FunctionBuilder::new(&mut func, &mut fctx);
    let entry = b.create_block();
    b.append_block_params_for_function_params(entry);
    b.switch_to_block(entry);
    let x = b.block_params(entry)[0];
    body(&mut b, x);
    b.seal_all_blocks();
    b.finalize(isa.frontend_config());
    machine_function(func, &*isa).unwrap()
}

/// `x + 1`: code that holds no data.
pub(crate) fn plain(target: Target) -> MachineFunction {
    compile(target, |b, x| {
        let sum = b.ins().iadd_imm_s(x, 1);
        b.ins().return_(&[sum]);
    })
}

/// A `br_table` on `x` over four blocks and a default, each returning `x` plus its own number. Cranelift places
/// the jump table in the code, after the indirect jump that reads it.
pub(crate) fn jump_table(target: Target) -> MachineFunction {
    compile(target, |b, x| {
        let blocks: Vec<_> = (0..5).map(|_| b.create_block()).collect();
        let index = b.ins().ireduce(I32, x);
        let pool = &mut b.func.dfg.value_lists;
        let cases: Vec<BlockCall> = blocks[..4].iter().map(|&block| BlockCall::new(block, [], pool)).collect();
        let default = BlockCall::new(blocks[4], [], pool);
        let table = b.create_jump_table(JumpTableData::new(default, &cases));
        b.ins().br_table(index, table);
        for (block, add) in blocks.into_iter().zip([3, 10, 17, 24, 31]) {
            b.switch_to_block(block);
            let sum = b.ins().iadd_imm_s(x, add);
            b.ins().return_(&[sum]);
        }
    })
}

/// `x` times the `f64` 1.1, saturated back to an `i64`. No immediate holds 1.1 on either target, so Cranelift
/// places it beside the code: after the code on x86-64, in a pool read by a literal load on arm64.
pub(crate) fn f64_constant(target: Target) -> MachineFunction {
    compile(target, |b, x| {
        let float = b.ins().fcvt_from_sint(F64, x);
        let factor = b.ins().f64const(1.1);
        let product = b.ins().fmul(float, factor);
        let back = b.ins().fcvt_to_sint_sat(I64, product);
        b.ins().return_(&[back]);
    })
}
