//! Fixtures that several test modules build the same way, so each is defined once.

use crate::core::{BinOp, Core};
use crate::desugar::desugar;
use crate::parser::parse;
use crate::tm::asm::{Instr, Program, Reg};
use crate::tm::machine::{Machine, Move, Rule, State, Symbol};

/// A one-tape unary incrementer: skip the `1`s, write a `1` on the first blank, accept.
pub(crate) fn increment() -> Machine {
    scan_ones(None, Some('1'))
}

/// A one-tape machine that walks right over `1`s writing `on_one`, writes `on_blank` on the first
/// blank, and accepts.
pub(crate) fn scan_ones(on_one: Option<Symbol>, on_blank: Option<Symbol>) -> Machine {
    Machine {
        tapes: 1,
        start: 0,
        states: vec![
            State {
                name: "scan".into(),
                accept: false,
                rules: vec![
                    Rule { read: vec![Some('1')], write: vec![on_one], moves: vec![Move::R], next: 0 },
                    Rule { read: vec![None], write: vec![on_blank], moves: vec![Move::S], next: 1 },
                ],
            },
            State { name: "halt".into(), accept: true, rules: vec![] },
        ],
    }
}

/// A machine of one non-accepting state, `name`, whose only rule is `rule`, with as many tapes as
/// `rule` reads.
pub(crate) fn one_rule_machine(name: &str, rule: Rule) -> Machine {
    Machine {
        tapes: rule.read.len(),
        start: 0,
        states: vec![State { name: name.into(), accept: false, rules: vec![rule] }],
    }
}

/// `rr = (2 + 3) * 4`, which is 20.
pub(crate) fn arithmetic_program() -> Program {
    Program {
        code: vec![
            Instr::Li(Reg::Loc(0), 2),
            Instr::Li(Reg::Loc(1), 3),
            Instr::Bin(BinOp::Add, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
            Instr::Li(Reg::Loc(3), 4),
            Instr::Bin(BinOp::Mul, Reg::Rr, Reg::Loc(2), Reg::Loc(3)),
            Instr::Halt,
        ],
        labels: vec![],
    }
}

/// `if (1 == 2) rr = 10 else rr = 20`, which is 20.
pub(crate) fn branch_program() -> Program {
    Program {
        code: vec![
            Instr::Li(Reg::Loc(0), 1),
            Instr::Li(Reg::Loc(1), 2),
            Instr::Bin(BinOp::Eq, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)), // 0 (false)
            Instr::Jz(Reg::Loc(2), "else".to_string()),
            Instr::Li(Reg::Rr, 10),
            Instr::Jmp("end".to_string()),
            Instr::Li(Reg::Rr, 20), // else:
            Instr::Halt,            // end:
        ],
        labels: vec![("else".to_string(), 6), ("end".to_string(), 7)],
    }
}

/// `rr = head(tail(cons(1, cons(2, nil))))`, which is 2.
pub(crate) fn head_of_tail_program() -> Program {
    Program {
        code: vec![
            Instr::Nil(Reg::Loc(0)), // r0 = nil
            Instr::Li(Reg::Loc(1), 2),
            Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(0)), // r2 = cons(2, nil)
            Instr::Li(Reg::Loc(3), 1),
            Instr::Cons(Reg::Loc(4), Reg::Loc(3), Reg::Loc(2)), // r4 = cons(1, r2)
            Instr::Tail(Reg::Loc(5), Reg::Loc(4)),              // r5 = tail(r4) -> ptr to (2,nil)
            Instr::Head(Reg::Rr, Reg::Loc(5)),                  // rr = head(r5) = 2
            Instr::Halt,
        ],
        labels: vec![],
    }
}

/// The machine `src` lowers to under `enc`, and the initial tapes its header lays out.
pub(crate) fn demo_machine(src: &str, enc: crate::tm::EncodingKind) -> (Machine, Vec<Vec<Symbol>>) {
    let (prog, ds) = crate::parser::parse(src);
    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
    let prog = prog.expect("a program");
    let ty = crate::typeck::result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
    let core = crate::desugar::desugar(&prog);
    let d = crate::tm::run_tm_described(&core, enc, ty, crate::tm::TM_DEFAULT_CAPS)
        .unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
    let init = d.header.init(d.machine.tapes);
    (d.machine, init)
}

pub(crate) fn core_of(src: &str) -> Core {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    desugar(&prog.unwrap())
}
