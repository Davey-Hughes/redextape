//! One CLIF instruction per step, under Cranelift's interpreter with native-rt's `Runtime` answering the
//! runtime imports, so that a run ends where the compiled code's does.

use cranelift_codegen::data_value::DataValue;
use cranelift_codegen::entity::EntityRef;
use cranelift_codegen::ir::{Block, BlockArg, ExternalName, Function, Inst, InstructionData, Value};
use cranelift_interpreter::environment::FunctionStore;
use cranelift_interpreter::frame::Frame;
use cranelift_interpreter::instruction::{DfgInstructionContext, InstructionContext};
use cranelift_interpreter::interpreter::InterpreterState;
use cranelift_interpreter::state::State;
use cranelift_interpreter::step::{ControlFlow, step};
use cranelift_interpreter::value::DataValueExt;
use redextape_core::heap::{self, HeapFault, VecTags};
use redextape_core::tm::{Caps, RxmOutcome};
use redextape_core::trace::{RxmCap, WordTag};
use redextape_native::RtFn;
use redextape_native_rt::{Runtime, Tripped};

/// The bytes a frame holds per value of its function: the interpreter's slot and the stepper's tag. A
/// call's frame is `num_values` of these, which `caps.mem` bounds.
pub const FRAME_BYTES_PER_VALUE: usize = size_of::<Option<DataValue>>() + size_of::<Option<WordTag>>();
// The memory stops the tests pin hold in the browser only while a value costs the same bytes on wasm32 as
// natively; a const assert is evaluated by the wasm32 check of this crate too, where no test runs.
const _: () = assert!(FRAME_BYTES_PER_VALUE == 33, "a frame value's bytes differ on this target");

/// Why a run ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClifEnd {
    /// Main returned and nothing faulted: its result, and the heap that decodes it.
    Ran(RxmOutcome),
    /// A runtime call faulted: `pc` is that call's srcloc, `None` when it has none, and `why` the fault's
    /// text. The run went on to main's return, as compiled code runs on past a faulting call.
    Fault { pc: Option<u32>, why: String },
    /// A call was refused at a cap: a runtime call at the steps, stack or heap cap, or a call of a
    /// subroutine whose frame would take the frames past `caps.mem`. It did not complete, and the run
    /// stands at it, paused until `Stepper::raise_caps`.
    Capped(RxmCap),
    /// Cranelift's interpreter trapped, with this text.
    Trap(String),
    /// The CLIF could not be stepped, for this reason.
    Broken(String),
}

/// A run of a program's CLIF functions.
pub struct Stepper<'f> {
    funcs: &'f [Function],
    state: InterpreterState<'f>,
    /// One per interpreter frame, innermost last.
    frames: Vec<Activation>,
    rt: Runtime<VecTags<WordTag>>,
    /// The bytes of the frames calls have pushed, which `caps.mem` bounds. Main's frame, which no call
    /// pushed, is not counted, as rxm's `caps.mem` counts the frames its calls save and not the running one.
    frame_bytes: u64,
    steps: u64,
    /// The srcloc of the runtime call after which `rt.fault` was first set.
    fault_pc: Option<u32>,
    end: Option<ClifEnd>,
}

/// What the stepper keeps beside one of the interpreter's frames.
pub(crate) struct Activation {
    /// The frame's function, by its index among the run's functions.
    pub(crate) function: u32,
    /// The instruction the frame runs next, which in a caller is the call it waits on.
    pub(crate) inst: Inst,
    /// A tag per value slot, `None` until the slot is set, so a reader knows which slots `Frame::get` can
    /// read without panicking. Each value takes its tag when it is set, by one rule: an instruction's
    /// results are values; a block's parameters take the tags of the arguments the branch passed it; a
    /// callee's parameters take its call's arguments' tags, and the call's results the returned values';
    /// a runtime call's result takes the tag `Stepper::answer` gives it.
    tags: Vec<Option<WordTag>>,
}

impl<'f> Stepper<'f> {
    /// A run of `funcs[0]`, main, which calls the others. Its runtime is `Runtime::new(caps)`: the
    /// interpreter keeps its frames on the heap, so no host stack bounds its depth below `caps.stack`.
    #[must_use]
    pub fn new(funcs: &'f [Function], caps: Caps) -> Stepper<'f> {
        let mut stepper = Stepper {
            funcs,
            state: InterpreterState::default(),
            frames: Vec::new(),
            rt: Runtime::new(caps),
            frame_bytes: 0,
            steps: 0,
            fault_pc: None,
            end: None,
        };
        if let Err(end) = stepper.start(funcs) {
            stepper.end = Some(end);
        }
        stepper
    }

    fn start(&mut self, funcs: &'f [Function]) -> Result<(), ClifEnd> {
        let mut store = FunctionStore::default();
        for func in funcs {
            let name = func.name.to_string();
            // `add` panics on a name the store holds already.
            if store.index_of(&name).is_some() {
                return Err(ClifEnd::Broken(format!("two functions are named {name}")));
            }
            store.add(name, func);
        }
        self.state = InterpreterState::default().with_function_store(store);
        let main = funcs.first().ok_or_else(|| ClifEnd::Broken("there is no main function".to_string()))?;
        // Main's parameter is the runtime pointer, which only runtime calls use, and the stepper answers
        // those itself.
        self.enter(main, vec![DataValue::I64(0)], &[WordTag::Value])
    }

    /// Runs the next instruction, and is true when it completed. Once the run has ended it changes
    /// nothing and is false, until `raise_caps` continues a pause.
    pub fn step(&mut self) -> bool {
        if self.end.is_some() {
            return false;
        }
        match self.advance() {
            Ok(end) => {
                self.steps += 1;
                self.end = end;
                true
            }
            Err(end) => {
                self.end = Some(end);
                false
            }
        }
    }

    /// Steps until `budget` steps have completed or the run ends: the number that completed.
    pub fn run(&mut self, budget: u64) -> u64 {
        let mut done = 0;
        while done < budget && self.step() {
            done += 1;
        }
        done
    }

    /// Why the run ended, or `None` while it can step.
    #[must_use]
    pub fn status(&self) -> Option<&ClifEnd> {
        self.end.as_ref()
    }

    /// The instructions completed, runtime calls and main's `return` included.
    #[must_use]
    pub fn steps_taken(&self) -> u64 {
        self.steps
    }

    /// Installs `caps`. A run paused at a cap goes on: the refused call runs again on the next `step`. At a
    /// steps, stack or heap pause the runtime first undoes the count that call made, so the repeat does not
    /// count it twice; a call refused at the frame-memory cap reached no runtime method. At any other end
    /// only the caps change.
    pub fn raise_caps(&mut self, caps: Caps) {
        let paused = matches!(self.end, Some(ClifEnd::Capped(_)));
        // `raise_cap` undoes a count only while the runtime holds a stop, which only a steps, stack or heap
        // pause leaves; anywhere else it installs the caps alone, and `Alloc` names the refusal that
        // counted nothing.
        let refused = if paused { self.refused_runtime_call() } else { None };
        self.rt.raise_cap(caps, refused.unwrap_or(Tripped::Alloc));
        if paused {
            self.end = None;
        }
    }

    /// The runtime call the run stands at, as `Runtime::raise_cap` names a call a cap refused; `None` when it
    /// stands at a call no cap refuses or at no runtime call.
    fn refused_runtime_call(&self) -> Option<Tripped> {
        let func = self.running()?;
        let inst = self.frames.last()?.inst;
        let data = DfgInstructionContext::new(inst, &func.dfg).data();
        runtime_import(func, &data).and_then(refusal).map(|(tripped, _)| tripped)
    }

    /// The runtime that answered the run's calls: its heap, its counters and its stops.
    #[must_use]
    pub fn runtime(&self) -> &Runtime<VecTags<WordTag>> {
        &self.rt
    }

    /// The frames, innermost last.
    pub(crate) fn frames(&self) -> &[Activation] {
        &self.frames
    }

    /// The running frame's function, `None` in a run that could not start.
    pub(crate) fn running(&self) -> Option<&'f Function> {
        self.state.frame_stack.last().map(Frame::function)
    }

    /// The running frame's set values in value order, each with what it holds and its tag. Only a slot
    /// with a tag is read, since `Frame::get` panics on an unset one.
    pub(crate) fn values(&self) -> impl Iterator<Item = (Value, &DataValue, WordTag)> {
        let frame = self.state.frame_stack.last();
        let tags = self.frames.last().map_or(&[][..], |activation| activation.tags.as_slice());
        tags.iter().enumerate().filter_map(move |(i, tag)| {
            let tag = (*tag)?;
            let value = Value::new(i);
            Some((value, frame?.get(value), tag))
        })
    }

    /// Runs the next instruction: `Ok` when it completed, holding the end when it ended the run, and
    /// `Err` with the end when it did not complete.
    fn advance(&mut self) -> Result<Option<ClifEnd>, ClifEnd> {
        let Some(inst) = self.frames.last().map(|activation| activation.inst) else {
            return Err(ClifEnd::Broken("no frame is running".to_string()));
        };
        let func = self.state.get_current_function();
        let context = DfgInstructionContext::new(inst, &func.dfg);
        let data = context.data();
        if let Some(import) = runtime_import(func, &data) {
            self.call_runtime(func, inst, import)?;
            return Ok(None);
        }
        let flow =
            step(&mut self.state, context).map_err(|e| ClifEnd::Broken(format!("{inst} cannot be stepped: {e}")))?;
        match flow {
            ControlFlow::Assign(values) => {
                let results = func.dfg.inst_results(inst);
                self.define(results, values.into_vec(), &vec![WordTag::Value; results.len()])?;
                self.next_in_block(func, inst)?;
            }
            ControlFlow::Continue => self.next_in_block(func, inst)?,
            ControlFlow::ContinueAt(block, args) => {
                let tags = self.branch_tags(func, &data, block)?;
                self.define(func.dfg.block_params(block), args.into_vec(), &tags)?;
                let first =
                    func.layout.first_inst(block).ok_or_else(|| ClifEnd::Broken(format!("{block} is empty")))?;
                if let Some(activation) = self.frames.last_mut() {
                    activation.inst = first;
                }
            }
            ControlFlow::Call(callee, args) => {
                // Checked before the frame is pushed, so a call refused here leaves nothing to undo.
                let pushed = self.frame_bytes.saturating_add(frame_bytes(callee));
                if pushed > self.rt.caps.mem {
                    return Err(ClifEnd::Capped(RxmCap::Mem));
                }
                let tags = self.tags_of(func, func.dfg.inst_args(inst))?;
                self.enter(callee, args.into_vec(), &tags)?;
                self.frame_bytes = pushed;
            }
            ControlFlow::Return(values) => return self.leave(func, inst, values.into_vec()),
            ControlFlow::ReturnCall(callee, _) => {
                return Err(ClifEnd::Broken(format!("{inst} is a tail call of {}", callee.name)));
            }
            ControlFlow::Trap(trap) => return Err(ClifEnd::Trap(trap.to_string())),
        }
        Ok(None)
    }

    /// Pushes `func`'s frame with its entry block's parameters set to `args`, tagged `tags`, its first
    /// instruction next.
    fn enter(&mut self, func: &'f Function, args: Vec<DataValue>, tags: &[WordTag]) -> Result<(), ClifEnd> {
        // The interpreter's store holds the run's own references, so the callee is found by address.
        let function = self
            .funcs
            .iter()
            .position(|f| std::ptr::eq(f, func))
            .and_then(|i| u32::try_from(i).ok())
            .ok_or_else(|| ClifEnd::Broken(format!("{} is not one of the run's functions", func.name)))?;
        let entry = func.layout.entry_block().ok_or_else(|| ClifEnd::Broken(format!("{} has no blocks", func.name)))?;
        let first = func.layout.first_inst(entry).ok_or_else(|| ClifEnd::Broken(format!("{entry} is empty")))?;
        let params = func.dfg.block_params(entry);
        if params.len() != args.len() {
            return Err(ClifEnd::Broken(format!("{} takes {} arguments, not {}", func.name, params.len(), args.len())));
        }
        self.state.push_frame(func);
        self.frames.push(Activation { function, inst: first, tags: vec![None; func.dfg.num_values()] });
        self.define(params, args, tags)
    }

    /// The `return` `inst` in `func`, with `values`. Main's ends the run, its frame kept as it returned.
    /// Any other's pops its frame and completes its caller's call with `values`.
    fn leave(&mut self, func: &Function, inst: Inst, values: Vec<DataValue>) -> Result<Option<ClifEnd>, ClifEnd> {
        if self.frames.len() == 1 {
            return self.main_returned(&values).map(Some);
        }
        let tags = self.tags_of(func, func.dfg.inst_args(inst))?;
        self.state.pop_frame();
        self.frames.pop();
        self.frame_bytes = self.frame_bytes.saturating_sub(frame_bytes(func));
        let Some(call) = self.frames.last().map(|activation| activation.inst) else {
            return Err(ClifEnd::Broken("a return left no frame".to_string()));
        };
        let caller = self.state.get_current_function();
        self.define(caller.dfg.inst_results(call), values, &tags)?;
        self.next_in_block(caller, call)?;
        Ok(None)
    }

    /// The end of a run whose main returned `values`: the latched fault if a runtime call faulted, as the
    /// JIT's driver reports it, and otherwise the result word with the heap.
    fn main_returned(&self, values: &[DataValue]) -> Result<ClifEnd, ClifEnd> {
        let [DataValue::I64(result)] = values else {
            return Err(ClifEnd::Broken(format!("main returned {values:?}, not one word")));
        };
        Ok(match &self.rt.fault {
            Some(why) => ClifEnd::Fault { pc: self.fault_pc, why: why.clone() },
            None => ClifEnd::Ran(RxmOutcome { result: result.cast_unsigned(), heap: self.rt.heap().cells().to_vec() }),
        })
    }

    /// A call of runtime import `import`, answered by the `Runtime` method its `rt_*` function calls. A call
    /// refused at a cap does not complete: its result is not written and the run stands at it.
    fn call_runtime(&mut self, func: &Function, inst: Inst, import: RtFn) -> Result<(), ClifEnd> {
        // The first argument is the runtime pointer, which `self.rt` stands in for.
        let args = func.dfg.inst_args(inst);
        let results = func.dfg.inst_results(inst);
        if args.len() != import.word_params() + 1 || results.len() != usize::from(import.returns_word()) {
            return Err(ClifEnd::Broken(format!("{inst} does not call {import:?} with its signature")));
        }
        let mut words = [(0, WordTag::Value); 2];
        for (word, &arg) in words.iter_mut().zip(args.iter().skip(1)) {
            *word = (self.word_of(func, arg)?, self.tag_of(func, arg)?);
        }
        let faulted = self.rt.fault.is_some();
        let result = self.answer(import, words);
        if self.rt.hit_cap {
            let (_, cap) =
                refusal(import).ok_or_else(|| ClifEnd::Broken(format!("{import:?} stopped the run at a cap")))?;
            return Err(ClifEnd::Capped(cap));
        }
        if let (Some((word, tag)), Some(&value)) = (result, results.first()) {
            self.define(&[value], vec![DataValue::I64(word.cast_signed())], &[tag])?;
        }
        if !faulted && self.rt.fault.is_some() {
            self.fault_pc = pc_of(func, inst);
        }
        self.next_in_block(func, inst)
    }

    /// The word `import`'s `Runtime` method returns, with its tag, or `None` for one that returns nothing.
    /// `a` and `b` are the call's arguments after the runtime pointer, with their tags, `(0, Value)` past
    /// those it takes. A cell or box stores its words' tags; a read returns the tag stored with the word it
    /// read; every other import makes a plain number.
    fn answer(&mut self, import: RtFn, [a, b]: [(u64, WordTag); 2]) -> Option<(u64, WordTag)> {
        let rt = &mut self.rt;
        match import {
            RtFn::Cons => Some((rt.cons(a, b), WordTag::List)),
            RtFn::Head => Some((rt.head(a.0), stored_tag(rt, rt.heap().head(a.0)))),
            RtFn::Tail => Some((rt.tail(a.0), stored_tag(rt, rt.heap().tail(a.0)))),
            RtFn::IsEmpty => Some((u64::from(heap::is_empty(a.0)), WordTag::Value)),
            RtFn::Box => Some((rt.new_box(a), WordTag::Box)),
            RtFn::BoxGet => Some((rt.box_get(a.0), stored_tag(rt, rt.heap().box_get(a.0)))),
            RtFn::BoxSet => {
                rt.box_set(a.0, b);
                None
            }
            RtFn::Tick => Some((rt.tick(), WordTag::Value)),
            RtFn::Enter => Some((rt.enter(), WordTag::Value)),
            RtFn::Leave => {
                rt.leave();
                None
            }
            RtFn::Faulted => Some((rt.faulted(), WordTag::Value)),
        }
    }

    /// Sets `names` in the running frame to `values`, each with the tag at its index in `tags`.
    fn define(&mut self, names: &[Value], values: Vec<DataValue>, tags: &[WordTag]) -> Result<(), ClifEnd> {
        // `Frame::set_all` panics unless `names` and `values` are as long as each other.
        if names.len() != values.len() || names.len() != tags.len() {
            return Err(ClifEnd::Broken(format!(
                "{} values and {} tags for {} names",
                values.len(),
                tags.len(),
                names.len()
            )));
        }
        let Some(activation) = self.frames.last_mut() else {
            return Err(ClifEnd::Broken("no frame is running".to_string()));
        };
        for (name, &tag) in names.iter().zip(tags) {
            // `Frame::set` panics on a name past the frame's slots, which the tags are as long as.
            let slot = activation.tags.get_mut(name.index());
            *slot.ok_or_else(|| ClifEnd::Broken(format!("{name} is not a value of its function")))? = Some(tag);
        }
        self.state.current_frame_mut().set_all(names, values);
        Ok(())
    }

    /// The tag `value` holds in the running frame.
    fn tag_of(&self, func: &Function, value: Value) -> Result<WordTag, ClifEnd> {
        let slot = func.dfg.resolve_aliases(value);
        let tag = self.frames.last().and_then(|activation| activation.tags.get(slot.index()).copied().flatten());
        tag.ok_or_else(|| ClifEnd::Broken(format!("{value} is read before it is set")))
    }

    /// The tags `values` hold in the running frame.
    fn tags_of(&self, func: &Function, values: &[Value]) -> Result<Vec<WordTag>, ClifEnd> {
        values.iter().map(|&value| self.tag_of(func, value)).collect()
    }

    /// The tags of the arguments the branch `data` passed to `block`, the block it went to. A `brif`'s arm
    /// is the one its condition picks, as `step` picks it, since both arms may name `block`.
    fn branch_tags(&mut self, func: &Function, data: &InstructionData, block: Block) -> Result<Vec<WordTag>, ClifEnd> {
        let call = match *data {
            InstructionData::Jump { destination, .. } => destination,
            InstructionData::Brif { arg, blocks: [then, otherwise], .. } => {
                let held = self.held(func, arg)?;
                let taken = held.into_bool().map_err(|e| ClifEnd::Broken(format!("{arg} is no condition: {e}")))?;
                if taken { then } else { otherwise }
            }
            _ => return Err(ClifEnd::Broken(format!("{} branches as no lowering does", data.opcode()))),
        };
        let pool = &func.dfg.value_lists;
        if call.block(pool) != block {
            return Err(ClifEnd::Broken(format!("the branch went to {block}, not {}", call.block(pool))));
        }
        call.args(pool)
            .map(|arg| match arg {
                BlockArg::Value(value) => self.tag_of(func, value),
                other => Err(ClifEnd::Broken(format!("{other} is not a value"))),
            })
            .collect()
    }

    /// What `value` holds in the running frame, read from its slot rather than by `Frame::get`, which
    /// panics on a slot not yet set.
    fn held(&mut self, func: &Function, value: Value) -> Result<DataValue, ClifEnd> {
        let slot = func.dfg.resolve_aliases(value);
        match self.state.current_frame_mut().entries_mut().get(slot.index()) {
            Some(Some(held)) => Ok(held.clone()),
            Some(None) | None => Err(ClifEnd::Broken(format!("{value} is read before it is set"))),
        }
    }

    /// The word `value` holds in the running frame.
    fn word_of(&mut self, func: &Function, value: Value) -> Result<u64, ClifEnd> {
        match self.held(func, value)? {
            DataValue::I64(word) => Ok(word.cast_unsigned()),
            other => Err(ClifEnd::Broken(format!("{value} holds {other}, not a word"))),
        }
    }

    /// Moves the running frame past `inst`, which a later instruction follows: only a block's terminator
    /// has none.
    fn next_in_block(&mut self, func: &Function, inst: Inst) -> Result<(), ClifEnd> {
        let next = func.layout.next_inst(inst).ok_or_else(|| ClifEnd::Broken(format!("{inst} ends its block")))?;
        if let Some(activation) = self.frames.last_mut() {
            activation.inst = next;
        }
        Ok(())
    }
}

/// The bytes of a frame of `func`.
fn frame_bytes(func: &Function) -> u64 {
    u64::try_from(func.dfg.num_values().saturating_mul(FRAME_BYTES_PER_VALUE)).unwrap_or(u64::MAX)
}

/// The runtime import `data` calls, if it calls one: `build_clif` names the imports `u0:0` up in
/// `RtFn::ALL`'s order, and the subroutines after them.
fn runtime_import(func: &Function, data: &InstructionData) -> Option<RtFn> {
    let InstructionData::Call { func_ref, .. } = *data else {
        return None;
    };
    let ExternalName::User(name) = &func.dfg.ext_funcs.get(func_ref)?.name else {
        return None;
    };
    let index = func.params.user_named_funcs().get(*name)?.index;
    RtFn::ALL.get(usize::try_from(index).ok()?).copied()
}

/// A cap's refusal of `import`: the call as `Runtime::raise_cap` names it, and the cap the run stops at.
/// `None` for an import no cap refuses.
fn refusal(import: RtFn) -> Option<(Tripped, RxmCap)> {
    match import {
        RtFn::Tick => Some((Tripped::Tick, RxmCap::Steps)),
        RtFn::Enter => Some((Tripped::Enter, RxmCap::Stack)),
        RtFn::Cons | RtFn::Box => Some((Tripped::Alloc, RxmCap::Heap)),
        RtFn::Head | RtFn::Tail | RtFn::IsEmpty | RtFn::BoxGet | RtFn::BoxSet | RtFn::Leave | RtFn::Faulted => None,
    }
}

/// The tag `read`, a read of `rt`'s heap, found stored with its word, or `Value` once a fault or a cap has
/// stopped the run, since `Runtime`'s reads then return 0 without reading. `Runtime::faulted` is the
/// runtime's own answer to whether it has stopped, so the rule is not restated here.
fn stored_tag(rt: &Runtime<VecTags<WordTag>>, read: Result<(u64, WordTag), HeapFault>) -> WordTag {
    if rt.faulted() != 0 {
        return WordTag::Value;
    }
    read.map_or(WordTag::Value, |(_, tag)| tag)
}

/// `inst`'s srcloc, the rxm pc it was lowered from, or `None` for an instruction lowered from none.
pub(crate) fn pc_of(func: &Function, inst: Inst) -> Option<u32> {
    let loc = func.srcloc(inst);
    (!loc.is_default()).then(|| loc.bits())
}

#[cfg(test)]
mod tests {
    use redextape_core::heap::VecTags;
    use redextape_core::tm::DEFAULT_CAPS;
    use redextape_core::trace::WordTag;
    use redextape_native_rt::Runtime;

    use super::stored_tag;

    /// Once the run has stopped, a read returns 0 without reading, so its word is no list, whatever the
    /// cell it names holds.
    #[test]
    fn a_read_after_the_run_stopped_is_a_plain_number() {
        let mut rt = Runtime::<VecTags<WordTag>>::new(DEFAULT_CAPS);
        let inner = rt.cons((7, WordTag::Value), (0, WordTag::Value));
        let outer = rt.cons((inner, WordTag::List), (0, WordTag::Value));
        assert_eq!(stored_tag(&rt, rt.heap().head(outer)), WordTag::List);
        rt.fault = Some("head of empty list".to_string());
        assert_eq!(stored_tag(&rt, rt.heap().head(outer)), WordTag::Value);
        rt.fault = None;
        rt.hit_cap = true;
        assert_eq!(stored_tag(&rt, rt.heap().head(outer)), WordTag::Value);
    }
}
