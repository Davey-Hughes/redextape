//! arm64 by `yaxpeax-arm`, four bytes an instruction, with each branch's target as an offset in the
//! function. A far call's eight-byte address, which Cranelift places among the instructions and loads
//! beside them, is a `.8byte` row, never decoded as code.
//!
//! **ANY OTHER DATA IS REFUSED, NOT READ.** Data among the instructions is found only through the relocation
//! that marks a far call's address, so any other would decode as instructions: a constant pool, which Cranelift
//! reads with a literal load, or a jump table, which it addresses with `adr` and leaves through `br`. So the code
//! is refused (`Unplaced`) at the first instruction that shows such data: a literal load from anything but a far
//! call's address, an `adr` no relocation fills in, or an indirect jump.

use std::fmt::Write;

use yaxpeax_arch::{Decoder, U8Reader};
use yaxpeax_arm::armv8::a64::{InstDecoder, Instruction, Opcode, Operand};

use redextape_native::CodeReloc;

use crate::{Decoded, Unplaced, data_text, is_data};

pub(crate) fn decode(bytes: &[u8], relocs: &[CodeReloc]) -> Result<Vec<(u32, Decoded)>, Unplaced> {
    let decoder = InstDecoder::default();
    let mut out = Vec::new();
    let mut at = 0usize;
    while at < bytes.len() {
        let offset = u32::try_from(at).unwrap_or(u32::MAX);
        if relocs.iter().any(|r| is_data(r) && r.offset == offset) {
            let end = (at + 8).min(bytes.len());
            let word = bytes[at..end].iter().rev().fold(0u64, |acc, &b| (acc << 8) | u64::from(b));
            let len = u32::try_from(end - at).unwrap_or(8);
            out.push((offset, Decoded { len, text: format!(".8byte 0x{word:x}"), intel: None }));
            at = end;
            continue;
        }
        let end = (at + 4).min(bytes.len());
        let word = &bytes[at..end];
        let mut reader = U8Reader::new(word);
        // A word no decoder reads is one `.inst` word, as an assembler reads one; a tail short of a word is bytes.
        let text = match (decoder.decode(&mut reader), <[u8; 4]>::try_from(word)) {
            (Ok(inst), Ok(_)) => {
                if let Some(why) = unplaced(&inst, offset, relocs) {
                    return Err(Unplaced { offset, why });
                }
                absolute_branches(&inst.to_string(), offset)
            }
            (Err(_), Ok(whole)) => format!(".inst 0x{:08x}", u32::from_le_bytes(whole)),
            (_, Err(_)) => data_text(".byte", word),
        };
        out.push((offset, Decoded { len: u32::try_from(end - at).unwrap_or(4), text, intel: None }));
        at = end;
    }
    Ok(out)
}

/// Why `inst`, at `offset`, shows data the finder cannot place, or `None` when it shows none.
fn unplaced(inst: &Instruction, offset: u32, relocs: &[CodeReloc]) -> Option<&'static str> {
    let target = inst.operands.iter().find_map(|op| match op {
        Operand::PCOffset(delta) => Some(i64::from(offset) + delta),
        _ => None,
    });
    match inst.opcode {
        Opcode::BR => Some("an indirect jump, as through a jump table placed in the code"),
        Opcode::LDR | Opcode::LDRSW
            if target.is_some_and(|at| !relocs.iter().any(|r| is_data(r) && i64::from(r.offset) == at)) =>
        {
            Some("a literal load from data no relocation marks, as from a constant pool")
        }
        Opcode::ADR if !relocs.iter().any(|r| r.offset >= offset && r.offset < offset + 4) => {
            Some("an `adr` no relocation fills in, as of a jump table")
        }
        _ => None,
    }
}

/// `text` with each pc-relative target `$+0x10` or `$-0x8` written as the offset it reaches from `offset`.
fn absolute_branches(text: &str, offset: u32) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(at) = rest.find('$') {
        out.push_str(&rest[..at]);
        let tail = &rest[at + 1..];
        let sign = tail.chars().next();
        let digits = tail.get(1..).and_then(|t| t.strip_prefix("0x"));
        let parsed = digits.map(|d| {
            let n = d.find(|c: char| !c.is_ascii_hexdigit()).unwrap_or(d.len());
            (i64::from_str_radix(&d[..n], 16), n)
        });
        if let (Some(s @ ('+' | '-')), Some((Ok(delta), n))) = (sign, parsed) {
            let target = if s == '+' { i64::from(offset) + delta } else { i64::from(offset) - delta };
            let _ = write!(out, "0x{target:x}");
            rest = &tail[1 + 2 + n..];
        } else {
            out.push('$');
            rest = tail;
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use redextape_native::{CodeReloc, MachineFunction};

    use super::decode;
    use crate::{Target, compiled};

    /// `words` in order as little-endian code, with `relocs`, decoded as each row's offset and text, or the offset
    /// and reason of its refusal.
    fn read(words: &[u32], relocs: &[CodeReloc]) -> Result<Vec<(u32, String)>, (u32, &'static str)> {
        let bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        decode(&bytes, relocs)
            .map(|rows| rows.into_iter().map(|(at, d)| (at, d.text)).collect())
            .map_err(|u| (u.offset, u.why))
    }

    const NOP: u32 = 0xd503_201f;
    const RET: u32 = 0xd65f_03c0;
    /// `b` four words on, over an eight-byte literal.
    const B_OVER: u32 = 0x1400_0003;

    /// A far call as Cranelift emits it: the literal load reads the address a relocation fills in, which is placed.
    #[test]
    fn a_far_calls_literal_is_one_8byte_row() {
        let relocs = [CodeReloc { offset: 8, callee: 3, absolute: true }];
        let rows = read(&[0x5800_0050, B_OVER, 0, 0, 0xd63f_0200], &relocs).unwrap();
        let texts: Vec<&str> = rows.iter().map(|(_, t)| t.as_str()).collect();
        assert_eq!(texts, ["ldr x16, 0x8", "b 0x10", ".8byte 0x0", "blr x16"]);
    }

    /// A float constant read with a literal load from beside the code, which no relocation marks: its two words of
    /// 1.0 would decode as instructions.
    #[test]
    fn a_literal_no_relocation_marks_is_refused() {
        // ldr d0, 0x8; b over 1.0; ret
        let words = [0x5c00_0040, B_OVER, 0x0000_0000, 0x3ff0_0000, RET];
        assert_eq!(
            read(&words, &[]),
            Err((0, "a literal load from data no relocation marks, as from a constant pool"))
        );
    }

    /// A call's relocation at a literal's offset marks no data there, so the literal load from it is refused.
    #[test]
    fn a_literal_at_a_call_relocation_is_refused() {
        let relocs = [CodeReloc { offset: 8, callee: 3, absolute: false }];
        assert_eq!(
            read(&[0x5800_0050, B_OVER, 0, 0, 0xd63f_0200], &relocs),
            Err((0, "a literal load from data no relocation marks, as from a constant pool"))
        );
    }

    /// A jump through a table, as Cranelift emits a `br_table`: the `adr` takes the table's address and the `br`
    /// leaves through it. Each is refused alone, so that neither rule rests on the other.
    #[test]
    fn a_jump_tables_adr_and_its_indirect_jump_are_refused() {
        assert_eq!(
            read(&[NOP, 0x1000_0050, NOP, RET], &[]),
            Err((4, "an `adr` no relocation fills in, as of a jump table"))
        );
        assert_eq!(
            read(&[NOP, 0xd61f_0200, 0x0000_0008, RET], &[]),
            Err((4, "an indirect jump, as through a jump table placed in the code"))
        );
    }

    /// The refused word's four bytes differ, so a word read in the wrong byte order reads as another word.
    #[test]
    fn a_word_no_decoder_reads_is_one_inst_and_a_short_tail_is_bytes() {
        let texts: Vec<String> =
            decode(&[0xef, 0xbe, 0xad, 0xde, 0x1f, 0x20], &[]).unwrap().into_iter().map(|(_, d)| d.text).collect();
        assert_eq!(texts, [".inst 0xdeadbeef", ".byte 0x1f, 0x20"]);
    }

    /// A compiled function's code read with its own relocations, as `read` gives it.
    fn read_compiled(func: &MachineFunction) -> Result<Vec<(u32, String)>, (u32, &'static str)> {
        decode(&func.bytes, &func.relocs)
            .map(|rows| rows.into_iter().map(|(at, d)| (at, d.text)).collect())
            .map_err(|u| (u.offset, u.why))
    }

    /// Cranelift's own jump table and constant pool, compiled here.
    #[test]
    fn cranelifts_jump_table_and_constant_pool_are_refused() {
        assert_eq!(
            read_compiled(&compiled::jump_table(Target::Arm64)),
            Err((0xc, "an `adr` no relocation fills in, as of a jump table"))
        );
        assert_eq!(
            read_compiled(&compiled::f64_constant(Target::Arm64)),
            Err((0x4, "a literal load from data no relocation marks, as from a constant pool"))
        );
    }
}
