//! x86-64 by `iced-x86`, in AT&T syntax as Cranelift prints its own x86-64 code (`movq %rdi, %r12`) and in
//! Intel syntax (`mov r12, rdi`), with each branch's and each rip-relative operand's target as an offset in
//! the function.
//!
//! **CONSTANTS ARE DATA, NOT CODE.** Cranelift places a function's constants after its code and reads them
//! rip-relative (`cmovoq 0xb8, %rax`). Every offset such an operand reads is where data starts: from the first
//! of them to the end the bytes are `.quad` rows, and an instruction that would run into one stops short of
//! it as `.byte` rows. The zeros that align the constants are one `.zero` row.
//!
//! **DATA INSIDE THE CODE IS REFUSED, NOT READ.** The finder holds only while every byte after the first datum is
//! data. A jump table, which Cranelift places in the code after the indirect jump that reads it, breaks that: the
//! code after the table would read as `.quad` rows. So the code is refused (`Unplaced`) at the first sign of what
//! the finder cannot place: an indirect jump, whose targets nothing in the code names; a branch into the bytes it
//! reads as data; or a rip-relative operand that reads back into the code. A forward read is taken as where data
//! starts, so one that reads code after it is not refused: in a jump table's code, the indirect jump is.

use iced_x86::{Decoder, DecoderOptions, Formatter, GasFormatter, Instruction, IntelFormatter, Mnemonic, OpKind};

use crate::{Decoded, Unplaced, data_text};

pub(crate) fn decode(bytes: &[u8]) -> Result<Vec<(u32, Decoded)>, Unplaced> {
    let data_from = data_start(bytes);
    if let Some(unplaced) = unplaced(bytes, data_from) {
        return Err(unplaced);
    }
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
    Ok(out)
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

/// The first instruction before `data_from` that shows code or data the finder cannot place, or `None` for none.
fn unplaced(bytes: &[u8], data_from: usize) -> Option<Unplaced> {
    let code = &bytes[..data_from];
    let mut decoder = Decoder::with_ip(64, code, 0, DecoderOptions::NONE);
    let mut inst = Instruction::default();
    while decoder.can_decode() {
        let start = decoder.position();
        decoder.decode_out(&mut inst);
        if inst.is_invalid() {
            // `decode` shows the bytes as `.byte` rows; one that consumed none ends the code there, as it does there.
            if decoder.position() == start {
                break;
            }
            continue;
        }
        let branch = matches!(inst.op0_kind(), OpKind::NearBranch16 | OpKind::NearBranch32 | OpKind::NearBranch64)
            .then(|| usize::try_from(inst.near_branch_target()).unwrap_or(usize::MAX));
        let why = if inst.mnemonic() == Mnemonic::Jmp && matches!(inst.op0_kind(), OpKind::Register | OpKind::Memory) {
            "an indirect jump, as through a jump table placed in the code"
        } else if branch.is_some_and(|target| target >= data_from && target < bytes.len()) {
            "a branch into the bytes read as constants"
        } else if inst.is_ip_rel_memory_operand()
            && usize::try_from(inst.ip_rel_memory_address()).is_ok_and(|target| target < data_from)
        {
            "a rip-relative operand that reads the code itself"
        } else {
            continue;
        };
        return Some(Unplaced { offset: offset(start), why });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::decode;
    use crate::{Target, compiled};

    /// `bytes` decoded, as each row's offset and AT&T text, or the offset and reason of its refusal.
    fn read(bytes: &[u8]) -> Result<Vec<(u32, String)>, (u32, &'static str)> {
        decode(bytes).map(|rows| rows.into_iter().map(|(at, d)| (at, d.text)).collect()).map_err(|u| (u.offset, u.why))
    }

    /// A jump through a table placed in the code, as Cranelift emits a `br_table`: the `leaq` names the table as
    /// the first datum, so without the refusal its two `retq`s after the table read as `.byte` rows.
    #[test]
    fn a_jump_table_in_the_code_is_refused_at_its_indirect_jump() {
        let bytes = [
            0x48, 0x8d, 0x05, 0x09, 0x00, 0x00, 0x00, // leaq 0x10(%rip), %rax: the table
            0x48, 0x63, 0x0c, 0xb8, // movslq (%rax,%rdi,4), %rcx
            0x48, 0x01, 0xc1, // addq %rax, %rcx
            0xff, 0xe1, // jmpq *%rcx
            0x08, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, // the table: each case's offset from it
            0xc3, 0xc3, // the two cases
        ];
        assert_eq!(read(&bytes), Err((0xe, "an indirect jump, as through a jump table placed in the code")));
    }

    /// A branch to the constant's first byte is into the constants, as one further in is.
    #[test]
    fn a_branch_into_the_constants_is_refused() {
        for (rel, lands) in [(0x04, "on its first byte"), (0x05, "inside it")] {
            let bytes = [
                0x48, 0x8b, 0x05, 0x06, 0x00, 0x00, 0x00, // movq 0xd(%rip), %rax: the constant
                0xeb, rel, // jmp 0xd or 0xe
                0xc3, 0x90, 0x90, 0x90, // retq and padding
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f, // 1.0
            ];
            assert_eq!(read(&bytes), Err((7, "a branch into the bytes read as constants")), "a jump landing {lands}");
        }
    }

    #[test]
    fn a_rip_relative_read_of_the_code_itself_is_refused() {
        let bytes = [
            0x90, // nop, which the read below takes as data
            0x48, 0x8b, 0x05, 0xf8, 0xff, 0xff, 0xff, // movq -0x8(%rip), %rax: offset 0
            0xc3, // retq
        ];
        assert_eq!(read(&bytes), Err((1, "a rip-relative operand that reads the code itself")));
    }

    /// The constants after the code, read forward and branched over by nothing, are what the finder places.
    #[test]
    fn constants_after_the_code_are_quad_rows() {
        let bytes = [
            0x48, 0x8b, 0x05, 0x01, 0x00, 0x00, 0x00, // movq 0x8(%rip), %rax: the constant
            0xc3, // retq
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f, // 1.0
        ];
        assert_eq!(
            read(&bytes),
            Ok(vec![
                (0, "movq 8, %rax".to_string()),
                (7, "retq".to_string()),
                (8, ".quad 0x3ff0000000000000".to_string())
            ])
        );
    }

    /// Cranelift's own jump table and constant, compiled here.
    #[test]
    fn cranelifts_jump_table_is_refused_and_its_constant_pool_read() {
        assert_eq!(
            read(&compiled::jump_table(Target::X86_64).bytes),
            Err((0x22, "an indirect jump, as through a jump table placed in the code"))
        );
        let rows = read(&compiled::f64_constant(Target::X86_64).bytes).unwrap();
        assert!(rows.iter().all(|(_, text)| !text.starts_with(".byte")), "{rows:?}");
        assert_eq!(
            rows[rows.len() - 3..],
            [
                (0x53, ".zero 13".to_string()),
                (0x60, ".quad 0x3ff199999999999a".to_string()),
                (0x68, ".quad 0x0".to_string())
            ]
        );
    }
}
