//! arm64 by `yaxpeax-arm`, four bytes an instruction, with each branch's target as an offset in the
//! function. A far call's eight-byte address, which Cranelift places among the instructions and loads
//! beside them, is a `.8byte` row, never decoded as code. No other data is found, and none is there
//! because redextape-native emits no float and no `br_table`: a constant pool or a jump table among the
//! instructions would decode as instructions.

use std::fmt::Write;

use yaxpeax_arch::{Decoder, U8Reader};
use yaxpeax_arm::armv8::a64::InstDecoder;

use redextape_native::CodeReloc;

use crate::{Decoded, data_text, is_data};

pub(crate) fn decode(bytes: &[u8], relocs: &[CodeReloc]) -> Vec<(u32, Decoded)> {
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
            (Ok(inst), Ok(_)) => absolute_branches(&inst.to_string(), offset),
            (Err(_), Ok(whole)) => format!(".inst 0x{:08x}", u32::from_le_bytes(whole)),
            (_, Err(_)) => data_text(".byte", word),
        };
        out.push((offset, Decoded { len: u32::try_from(end - at).unwrap_or(4), text, intel: None }));
        at = end;
    }
    out
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
    use super::decode;

    /// The refused word's four bytes differ, so a word read in the wrong byte order reads as another word.
    #[test]
    fn a_word_no_decoder_reads_is_one_inst_and_a_short_tail_is_bytes() {
        let texts: Vec<String> =
            decode(&[0xef, 0xbe, 0xad, 0xde, 0x1f, 0x20], &[]).into_iter().map(|(_, d)| d.text).collect();
        assert_eq!(texts, [".inst 0xdeadbeef", ".byte 0x1f, 0x20"]);
    }
}
