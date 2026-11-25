//! x86-64 by `iced-x86`, in AT&T syntax as Cranelift prints its own x86-64 code (`movq %rdi, %r12`) and in
//! Intel syntax (`mov r12, rdi`), with each branch's and each rip-relative operand's target as an offset in
//! the function.
//!
//! **CONSTANTS ARE DATA, NOT CODE.** Cranelift places a function's constants after its code and reads them
//! rip-relative (`cmovoq 0xb8, %rax`). Every offset such an operand reads is where data starts: from the first
//! of them to the end the bytes are `.quad` rows, and an instruction that would run into one stops short of
//! it as `.byte` rows. The zeros that align the constants are one `.zero` row. This holds while no data sits
//! inside the code, which is so because redextape-native emits no `br_table`: Cranelift puts a jump table in the
//! code and reads it rip-relative, so every instruction after one would read as `.quad` rows.

use iced_x86::{Decoder, DecoderOptions, Formatter, GasFormatter, Instruction, IntelFormatter};

use crate::{Decoded, data_text};

pub(crate) fn decode(bytes: &[u8]) -> Vec<(u32, Decoded)> {
    let data_from = data_start(bytes);
    let mut gas = GasFormatter::new();
    gas.options_mut().set_gas_show_mnemonic_size_suffix(true);
    let mut intel = IntelFormatter::new();
    for options in [gas.options_mut(), intel.options_mut()] {
        options.set_space_after_operand_separator(true);
        options.set_hex_prefix("0x");
        options.set_hex_suffix("");
        options.set_uppercase_hex(false);
        options.set_branch_leading_zeros(false);
        options.set_leading_zeros(false);
    }
    let code = &bytes[..data_from];
    let mut decoder = Decoder::with_ip(64, code, 0, DecoderOptions::NONE);
    let mut out = Vec::new();
    let mut inst = Instruction::default();
    while decoder.can_decode() {
        let start = decoder.position();
        // The padding that aligns the constants, taken before the decoder reads `00 00` as `addb %al, (%rax)`.
        if data_from < bytes.len() && code[start..].iter().all(|&b| b == 0) {
            let len = u32::try_from(code.len() - start).unwrap_or(u32::MAX);
            out.push((
                offset(start),
                Decoded { len, text: format!(".zero {len}"), intel: Some(format!("db {len} dup (0)")) },
            ));
            break;
        }
        decoder.decode_out(&mut inst);
        if inst.is_invalid() {
            // The decoder read as far as it could; show the bytes it consumed, or the rest when it took none.
            let end = if decoder.position() > start { decoder.position() } else { code.len() };
            push_data(&mut out, start, &code[start..end], ".byte");
            decoder.set_position(end).ok();
            continue;
        }
        let mut at_t = String::new();
        gas.format(&inst, &mut at_t);
        let mut i = String::new();
        intel.format(&inst, &mut i);
        let len = u32::try_from(inst.len()).unwrap_or(1);
        out.push((offset(start), Decoded { len, text: at_t, intel: Some(i) }));
    }
    for (k, chunk) in bytes[data_from..].chunks(8).enumerate() {
        let at = data_from + 8 * k;
        if chunk.len() == 8 {
            let word = chunk.iter().rev().fold(0u64, |acc, &b| (acc << 8) | u64::from(b));
            out.push((
                offset(at),
                Decoded { len: 8, text: format!(".quad 0x{word:x}"), intel: Some(format!("dq 0x{word:x}")) },
            ));
        } else {
            push_data(&mut out, at, chunk, ".byte");
        }
    }
    out
}

fn offset(at: usize) -> u32 {
    u32::try_from(at).unwrap_or(u32::MAX)
}

fn push_data(out: &mut Vec<(u32, Decoded)>, at: usize, bytes: &[u8], directive: &str) {
    let text = data_text(directive, bytes);
    let len = u32::try_from(bytes.len()).unwrap_or(u32::MAX);
    out.push((offset(at), Decoded { len, text: text.clone(), intel: Some(text.replace(".byte", "db")) }));
}

/// The first offset a rip-relative operand reads inside `bytes`, or `bytes.len()` for none: decoding up to
/// it, which can only shorten, finds every such operand before it.
fn data_start(bytes: &[u8]) -> usize {
    let mut end = bytes.len();
    let mut decoder = Decoder::with_ip(64, bytes, 0, DecoderOptions::NONE);
    let mut inst = Instruction::default();
    while decoder.can_decode() && decoder.position() < end {
        decoder.decode_out(&mut inst);
        if !inst.is_invalid()
            && inst.is_ip_rel_memory_operand()
            && let Ok(target) = usize::try_from(inst.ip_rel_memory_address())
            && target >= decoder.position()
            && target < end
        {
            end = target;
        }
    }
    end
}
