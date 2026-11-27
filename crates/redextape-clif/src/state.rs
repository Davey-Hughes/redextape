//! The frame a view reads between two steps of a CLIF run: where it stands, the running frame's values
//! with their tags and registers, the call stack, and the heap. Each list is cut to a `ClifWindow`, beside
//! the length it was cut from, as `RxmState` is cut to an `RxmWindow`.

use cranelift_codegen::data_value::DataValue;
use cranelift_codegen::ir::{Function, Inst, Value, ValueLabelAssignments};
use cranelift_interpreter::value::DataValueExt;
use redextape_core::tm::{label_reg, reg_str};
use redextape_core::trace::WordTag;
use redextape_core::viewmodel::{ResultCells, RxmBox, RxmCell, RxmWord, heap_boxes, heap_cells, reached, result_cells};

use crate::stepper::{Activation, ClifEnd, Stepper, pc_of};

/// An instruction of the run's functions.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ClifAt {
    /// The function's index among the run's functions.
    pub function: u32,
    /// The instruction's `Inst` index in that function.
    pub inst: u32,
}

/// How much of the run a `ClifState` carries: at most this many of each list.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub struct ClifWindow {
    pub values: usize,
    pub frames: usize,
    pub cells: usize,
    pub boxes: usize,
    /// At a `Ran` end, the newest this many of the returned list's cells, as `RxmWindow::result`.
    pub result: usize,
}

/// One set value of the running frame.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ClifValue {
    /// The value's number, `v4`'s 4.
    pub value: u32,
    pub word: RxmWord,
    /// The rxm registers its value labels name, spelled as the rxm listing spells them, each once in the
    /// order the labels give them. Empty for a value no label survives on.
    pub regs: Vec<String>,
}

/// One step of a CLIF run, cut to a `ClifWindow`.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ClifState {
    /// Instructions completed, `Stepper::steps_taken`. `number`, not `bigint`, for the reason
    /// `redextape_wire::TmStatus::total_steps` records.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub step: u64,
    /// `Stepper::at`.
    pub at: ClifAt,
    /// `Some(at)` while the run can go on, a pause at a cap included, and `None` once it has ended, as
    /// `RxmState::next` reads.
    pub next: Option<ClifAt>,
    /// The rxm pc `at` was lowered from, `None` for an instruction lowered from none.
    pub pc: Option<u32>,
    /// The first `ClifWindow::values` of the running frame's set values, in value order, the last of them
    /// `returned`'s row where the first ones miss it.
    pub values: Vec<ClifValue>,
    /// How many values the running frame has set, however many `values` shows.
    pub values_len: usize,
    /// At a `Ran` end, the value main's `return` names, its aliases followed (`return v9` with `v9 -> v8`
    /// names 8), and `None` before the end and at any other end. `values` always holds its row, since a
    /// values panel that cut the answer off would have nothing to mark.
    pub returned: Option<u32>,
    /// How many frames the run holds, however many `frames` shows.
    pub depth: usize,
    /// The top `ClifWindow::frames` frames, top first, for `RxmState::frames`' reason: each frame's
    /// instruction, which in a caller is the call it waits on.
    pub frames: Vec<ClifAt>,
    /// How many cons cells the heap holds.
    pub heap_len: usize,
    /// The newest `ClifWindow::cells` cells, plus each cell a list word in `values` points at, newest
    /// first, as `RxmState::cells` is chosen from its registers, plus at a `Ran` end the newest
    /// `ClifWindow::result` of the returned list's cells.
    pub cells: Vec<RxmCell>,
    /// The returned list's cells, as `RxmState::result` names `rr`'s.
    pub result: Option<ResultCells>,
    /// How many boxes the heap holds.
    pub box_len: usize,
    /// The newest `ClifWindow::boxes` boxes, plus each box a box handle in `values` names, newest first.
    pub boxes: Vec<RxmBox>,
}

impl Stepper<'_> {
    /// The instruction about to run, or the one the run ended at: main's `return`, the runtime call a cap
    /// refused, or the instruction that trapped or could not be stepped. A run that could not start stands
    /// at instruction 0 of function 0.
    #[must_use]
    pub fn at(&self) -> ClifAt {
        self.frames().last().map_or(ClifAt { function: 0, inst: 0 }, at_of)
    }

    /// The run between two steps, cut to `window`.
    #[must_use]
    pub fn state(&self, window: ClifWindow) -> ClifState {
        let at = self.at();
        let running = self.running();
        let returned = self.returned();
        let mut shown: Vec<(Value, &DataValue, WordTag)> = self.values().take(window.values).collect();
        // `returned`'s doc says why the window holds it: where the first rows miss the returned value, its row
        // takes the window's last, and its number is past theirs, so value order holds.
        if let Some(returned) = returned
            && !shown.iter().any(|&(value, ..)| value == returned)
            && let (Some(last), Some(row)) = (shown.last_mut(), self.values().find(|&(value, ..)| value == returned))
        {
            *last = row;
        }
        let named =
            |tag: WordTag| shown.iter().filter(move |(_, _, t)| *t == tag).filter_map(|(_, held, _)| bits(held));
        let heap = self.runtime().heap();
        // The returned list's cells: `returned` is `Some` at a `Ran` end only.
        let result = returned
            .and_then(|returned| self.values().find(|&(value, ..)| value == returned))
            .and_then(|(_, held, tag)| bits(held).filter(|_| tag == WordTag::List))
            .map_or_default(|root| reached(root, heap.cells(), &heap.tags().cells));
        let cells =
            heap_cells(heap.cells(), &heap.tags().cells, window.cells, named(WordTag::List), (&result, window.result));
        ClifState {
            step: self.steps_taken(),
            at,
            next: match self.status() {
                None | Some(ClifEnd::Capped(_)) => Some(at),
                Some(ClifEnd::Ran(_) | ClifEnd::Fault { .. } | ClifEnd::Trap(_) | ClifEnd::Broken(_)) => None,
            },
            pc: running.and_then(|func| pc_of(func, Inst::from_u32(at.inst))),
            values: shown
                .iter()
                .map(|&(value, held, tag)| ClifValue {
                    value: value.as_u32(),
                    word: word(held, tag),
                    regs: running.map_or_default(|func| regs(func, value)),
                })
                .collect(),
            values_len: self.values().count(),
            returned: returned.map(Value::as_u32),
            depth: self.frames().len(),
            frames: self.frames().iter().rev().take(window.frames).map(at_of).collect(),
            heap_len: heap.cells().len(),
            result: result_cells(&cells, &result),
            cells,
            box_len: heap.boxes().len(),
            boxes: heap_boxes(heap.boxes(), &heap.tags().boxes, window.boxes, named(WordTag::Box)),
        }
    }

    /// At a `Ran` end, the value main's `return` names, through its aliases: the run stands at that
    /// `return`, main's frame kept. `None` before the end and at any other end.
    fn returned(&self) -> Option<Value> {
        if !matches!(self.status(), Some(ClifEnd::Ran(_))) {
            return None;
        }
        let func = self.running()?;
        let &operand = func.dfg.inst_args(Inst::from_u32(self.at().inst)).first()?;
        Some(func.dfg.resolve_aliases(operand))
    }
}

fn at_of(activation: &Activation) -> ClifAt {
    ClifAt { function: activation.function, inst: activation.inst.as_u32() }
}

/// An integer's bits, unsigned, when 64 hold them.
fn bits(held: &DataValue) -> Option<u64> {
    u64::try_from(held.clone().into_int_unsigned().ok()?).ok()
}

/// `held` as the views write a word: an integer's unsigned bits in decimal, and anything else, which no
/// lowering makes, as Cranelift prints it.
fn word(held: &DataValue, tag: WordTag) -> RxmWord {
    match bits(held) {
        Some(word) => RxmWord::of(word, tag),
        None => RxmWord { word: held.to_string(), tag },
    }
}

/// The registers `value`'s label starts name, each once, in the order they start.
fn regs(func: &Function, value: Value) -> Vec<String> {
    let mut regs: Vec<String> = Vec::new();
    let labels = func.dfg.values_labels.as_ref().and_then(|labels| labels.get(&value));
    if let Some(ValueLabelAssignments::Starts(starts)) = labels {
        for start in starts {
            let reg = reg_str(label_reg(start.label.as_u32()));
            if !regs.contains(&reg) {
                regs.push(reg);
            }
        }
    }
    regs
}
