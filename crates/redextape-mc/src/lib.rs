//! The clif view's machine code: the code Cranelift makes from a program on one target, as
//! `redextape_native::machine_code` compiles it, turned into rows for a view to list. Each instruction row
//! carries its offset, its bytes, the rxm pc its source range names and, where a relocation falls in
//! it, the function the call or address is filled in with when the code is linked.
//!
//! A target is a feature: `x86` (x86-64, with AT&T and Intel text, by `iced-x86`) and `arm64`
//! (by `yaxpeax-arm`). A wasm32 package turns on one, so each target is a download of its own.

#[cfg(feature = "arm64")]
mod arm64;
#[cfg(test)]
#[cfg(any(feature = "x86", feature = "arm64"))]
mod compiled;
#[cfg(feature = "x86")]
mod x86;

use std::collections::HashMap;
use std::fmt::Write;

use redextape_core::core::NodeId;
use redextape_core::tm::{LowerError, Program};
#[cfg(feature = "arm64")]
use redextape_native::CodeReloc;
use redextape_native::analysis::partition;
use redextape_native::{Listing, MachineFunction, RtFn, machine_code};

pub use redextape_native::decline_reason;

/// What a listing is built from: the `clifInput()` value the clif package takes, of which only the
/// program is read, so its type and caps cross and are ignored.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct McInput {
    pub program: Program,
}

/// A target this build can compile for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    #[cfg(feature = "x86")]
    X86_64,
    #[cfg(feature = "arm64")]
    Arm64,
}

impl Target {
    /// The triple the snapshot gate compiles this target for, Linux on both.
    #[must_use]
    pub fn triple(self) -> &'static str {
        match self {
            #[cfg(feature = "x86")]
            Target::X86_64 => "x86_64-unknown-linux-gnu",
            #[cfg(feature = "arm64")]
            Target::Arm64 => "aarch64-unknown-linux-gnu",
        }
    }

    /// The name each package's `target()` returns: `x86-64` or `arm64`.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            #[cfg(feature = "x86")]
            Target::X86_64 => "x86-64",
            #[cfg(feature = "arm64")]
            Target::Arm64 => "arm64",
        }
    }
}

/// A listing's target, serialised as `Target::name` names it, which is what each package's `target()` returns. It
/// has both targets in every build, since the type exported to the page names both.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub enum McTarget {
    #[serde(rename = "x86-64")]
    X86_64,
    #[serde(rename = "arm64")]
    Arm64,
}

impl From<Target> for McTarget {
    fn from(target: Target) -> Self {
        match target {
            #[cfg(feature = "x86")]
            Target::X86_64 => McTarget::X86_64,
            #[cfg(feature = "arm64")]
            Target::Arm64 => McTarget::Arm64,
        }
    }
}

/// What a listing row shows.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub enum McRowKind {
    /// A function's header: its name, label and size are its `McFunction`'s.
    Function,
    /// One instruction, or one word of data placed among the instructions.
    Inst,
    /// The empty line between two functions.
    Blank,
}

/// One row of the listing.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct McRow {
    pub kind: McRowKind,
    /// The function its row belongs to, an index into `McListing::functions`.
    pub function: u32,
    /// An `Inst` row's offset in its function's code; 0 on every other row.
    pub offset: u32,
    /// An `Inst` row's bytes in hex, two digits each, in order; empty on every other row.
    pub bytes: String,
    /// The rxm pc of the source range the row's first byte is in; `None` outside every range (the prologue,
    /// the exit path) and on every row that is not `Inst`.
    pub pc: Option<u32>,
    /// The instruction as the target's assembly prints it, in AT&T syntax on x86-64; empty on every row that
    /// is not `Inst`.
    pub text: String,
    /// On x86-64 the same instruction in Intel syntax; `None` on arm64, which has one syntax, and on every row
    /// that is not `Inst`.
    pub intel: Option<String>,
    /// The function a relocation inside the row names, or that a call through a register reaches by the load that
    /// filled the register: `u0:8 rt_enter`, `u0:12 fact.0`. `None` for none.
    pub callee: Option<String>,
}

/// One function of the listing.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct McFunction {
    /// Its name as the clif listing prints it, `u0:12`.
    pub name: String,
    /// The rxm subroutine it was built from, as `partition` names it: `$main`, `fact.0`.
    pub label: String,
    /// Its code's size in bytes.
    pub size: u32,
    /// The index of its `Function` row in `McListing::rows`.
    pub first_row: u32,
}

/// The rows of a program's machine code on one target.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct McListing {
    pub target: McTarget,
    pub functions: Vec<McFunction>,
    pub rows: Vec<McRow>,
}

/// One decoded piece of a function's code, before it is placed in a row.
pub(crate) struct Decoded {
    pub(crate) len: u32,
    pub(crate) text: String,
    pub(crate) intel: Option<String>,
}

/// Where a target's reader stopped because what follows may be data or code, and reading it as either could show
/// the wrong one: the first instruction that shows such data, at `offset` in its function, and what it is.
#[cfg_attr(not(any(feature = "x86", feature = "arm64")), allow(dead_code))]
#[derive(Debug)]
pub(crate) struct Unplaced {
    pub(crate) offset: u32,
    pub(crate) why: &'static str,
}

/// `prog`'s machine code on `target` at `listing`'s level, as rows.
///
/// # Errors
/// `machine_code`'s and `partition`'s, and `LowerError::Unsupported` naming the function, the byte and the kind
/// of instruction where a function's code holds data its target's reader cannot place.
pub fn machine_listing(prog: &Program, listing: Listing, target: Target) -> Result<McListing, LowerError> {
    let funcs = machine_code(prog, listing, target.triple())?;
    let names: Vec<String> = partition(prog)?.into_iter().map(|sub| sub.name).collect();
    list(&funcs, &names, target)
}

/// `funcs`, the code of the subroutines `names` names in order, as `target`'s rows.
///
/// # Errors
/// `LowerError::Unsupported`, as `decline` words it, where a function's code holds data its target's reader cannot
/// place: the first such function declines the whole listing, the functions before it included.
fn list(funcs: &[MachineFunction], names: &[String], target: Target) -> Result<McListing, LowerError> {
    let callee = |index: u32| -> String {
        let index_us = index as usize;
        if let Some(rt) = RtFn::ALL.get(index_us) {
            format!("u0:{index} {}", rt.symbol())
        } else {
            let label = names.get(index_us - RtFn::ALL.len()).map_or("", String::as_str);
            format!("u0:{index} {label}")
        }
    };
    let mut out = McListing { target: target.into(), functions: Vec::new(), rows: Vec::new() };
    for (k, func) in funcs.iter().enumerate() {
        let function = u32::try_from(k).unwrap_or(u32::MAX);
        if k > 0 {
            out.rows.push(label_row(McRowKind::Blank, function));
        }
        out.functions.push(McFunction {
            name: format!("u0:{}", RtFn::ALL.len() + k),
            label: names.get(k).cloned().unwrap_or_default(),
            size: u32::try_from(func.bytes.len()).unwrap_or(u32::MAX),
            first_row: u32::try_from(out.rows.len()).unwrap_or(u32::MAX),
        });
        out.rows.push(label_row(McRowKind::Function, function));
        let mut loads = CalleeLoads::default();
        let pieces = decode(target, func).map_err(|unplaced| decline(k, target, &unplaced))?;
        for (offset, piece) in pieces {
            let start = offset as usize;
            let end = (start + piece.len as usize).min(func.bytes.len());
            let bytes = func.bytes[start..end].iter().fold(String::new(), |mut hex, b| {
                let _ = write!(hex, "{b:02x}");
                hex
            });
            let relocated = func.relocs.iter().find(|r| r.offset >= offset && r.offset < offset + piece.len);
            let loaded = relocated.map(|r| callee(r.callee));
            let through = loads.row(offset, &piece.text, loaded.as_deref());
            out.rows.push(McRow {
                kind: McRowKind::Inst,
                function,
                offset,
                bytes,
                pc: pc_at(func, offset),
                text: piece.text,
                intel: piece.intel,
                callee: loaded.or(through),
            });
        }
    }
    Ok(out)
}

/// A runtime call's address is a relocation the call does not hold: x86-64 loads it with `movabsq $0, %reg`
/// and arm64 with `ldr xN` from an `.8byte` beside the code, and each then calls through the register. This
/// follows the name from the load to the register's indirect call, so the call row names what it calls too.
#[derive(Default)]
struct CalleeLoads {
    /// arm64: the register each `ldr xN, 0x…` loads, by the literal's offset.
    literal: HashMap<u32, String>,
    /// The callee each register holds, until the call through it.
    held: HashMap<String, String>,
}

impl CalleeLoads {
    /// Note the row at `offset` reading `text`, which names `named`; the callee of an indirect call through a
    /// register a load filled, or `None`.
    fn row(&mut self, offset: u32, text: &str, named: Option<&str>) -> Option<String> {
        if let Some(rest) = text.strip_prefix("ldr ")
            && let Some((reg, at)) = rest.split_once(", 0x")
            && let Ok(at) = u32::from_str_radix(at, 16)
        {
            self.literal.insert(at, reg.to_string());
        }
        if let Some(callee) = named {
            let reg = text
                .strip_prefix("movabsq ")
                .and_then(|rest| rest.rsplit_once(", %"))
                .map(|(_, reg)| reg.to_string())
                .or_else(|| self.literal.get(&offset).cloned());
            if let Some(reg) = reg {
                self.held.insert(reg, callee.to_string());
            }
            return None;
        }
        let reg = text.strip_prefix("callq *%").or_else(|| text.strip_prefix("blr "))?;
        self.held.remove(reg)
    }
}

/// The decline for the `k`th function's code on `target`, which holds data its reader cannot place: a page shows it
/// as the reason no code is listed, so it names the function as the clif listing does, the byte and the kind of instruction.
fn decline(k: usize, target: Target, unplaced: &Unplaced) -> LowerError {
    let Unplaced { offset, why } = unplaced;
    let what = format!(
        "u0:{}'s {} code holds data the listing cannot place: at byte {offset:#x}, {why}",
        RtFn::ALL.len() + k,
        target.name()
    );
    LowerError::Unsupported { node: NodeId::default(), what }
}

fn label_row(kind: McRowKind, function: u32) -> McRow {
    McRow { kind, function, offset: 0, bytes: String::new(), pc: None, text: String::new(), intel: None, callee: None }
}

/// The pc of the source range `offset` is in.
fn pc_at(func: &MachineFunction, offset: u32) -> Option<u32> {
    func.ranges.iter().find(|r| r.start <= offset && offset < r.end).map(|r| r.pc)
}

/// `func`'s code decoded from its first byte to its last, each piece with its offset, or where the target's reader
/// cannot place its data.
#[cfg_attr(not(any(feature = "x86", feature = "arm64")), allow(unused_variables))]
fn decode(target: Target, func: &MachineFunction) -> Result<Vec<(u32, Decoded)>, Unplaced> {
    match target {
        #[cfg(feature = "x86")]
        Target::X86_64 => x86::decode(&func.bytes),
        #[cfg(feature = "arm64")]
        Target::Arm64 => arm64::decode(&func.bytes, &func.relocs),
    }
}

/// `bytes` as a data directive, `.byte 0x0f, 0x0b`, for code no decoder reads.
#[cfg(any(feature = "x86", feature = "arm64"))]
pub(crate) fn data_text(directive: &str, bytes: &[u8]) -> String {
    let words: Vec<String> = bytes.iter().map(|b| format!("0x{b:02x}")).collect();
    format!("{directive} {}", words.join(", "))
}

/// Whether a relocation fills in an absolute address placed as data in the code, which arm64's
/// far calls load from beside the instruction that reads it.
#[cfg(feature = "arm64")]
pub(crate) fn is_data(reloc: &CodeReloc) -> bool {
    reloc.absolute
}

#[cfg(test)]
mod tests {
    #[cfg(any(feature = "x86", feature = "arm64"))]
    use super::{LowerError, McListing, Target, compiled, list};

    #[cfg(any(feature = "x86", feature = "arm64"))]
    fn names() -> Vec<String> {
        vec!["$main".to_string(), "f.0".to_string()]
    }

    /// The decline `list` returns, or a panic naming the listing it returned instead.
    #[cfg(any(feature = "x86", feature = "arm64"))]
    fn declined(listed: Result<McListing, LowerError>) -> String {
        match listed {
            Err(LowerError::Unsupported { what, .. }) => what,
            other => panic!("the listing was not declined as `Unsupported`: {other:?}"),
        }
    }

    /// A function holding data its reader cannot place declines the whole listing, the function before it, which
    /// lists alone, included: Cranelift's `br_table` places its jump table in the code.
    #[cfg(feature = "x86")]
    #[test]
    fn a_jump_table_declines_the_whole_x86_64_listing() {
        let target = Target::X86_64;
        let plain = compiled::plain(target);
        assert!(list(std::slice::from_ref(&plain), &names(), target).is_ok());
        assert_eq!(
            declined(list(&[plain, compiled::jump_table(target)], &names(), target)),
            "u0:12's x86-64 code holds data the listing cannot place: at byte 0x22, an indirect jump, as through a \
             jump table placed in the code"
        );
    }

    /// As on x86-64, with the data arm64 cannot place and x86-64 can: an `f64` constant, which arm64 loads from a pool.
    #[cfg(feature = "arm64")]
    #[test]
    fn a_constant_pool_declines_the_whole_arm64_listing() {
        let target = Target::Arm64;
        let plain = compiled::plain(target);
        assert!(list(std::slice::from_ref(&plain), &names(), target).is_ok());
        assert_eq!(
            declined(list(&[plain, compiled::f64_constant(target)], &names(), target)),
            "u0:12's arm64 code holds data the listing cannot place: at byte 0x4, a literal load from data no \
             relocation marks, as from a constant pool"
        );
    }

    #[cfg(feature = "x86")]
    #[test]
    fn a_decline_names_the_function_the_target_the_byte_and_the_kind_of_instruction() {
        use super::{Target, Unplaced, decline, decline_reason};
        let unplaced = Unplaced { offset: 0x2c, why: "an indirect jump, as through a jump table placed in the code" };
        assert_eq!(
            decline_reason(&decline(1, Target::X86_64, &unplaced)),
            "u0:12's x86-64 code holds data the listing cannot place: at byte 0x2c, an indirect jump, as through a \
             jump table placed in the code"
        );
    }
}
