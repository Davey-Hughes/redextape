//! Counter machines: a program over a handful of unbounded natural-number counters, which is all a
//! Minsky machine has, and the reduction of a Turing machine to one.
//!
//! **TWO LEVELS, ONE MEANING.** A [`program::Program`] is written in macros, and every macro has exactly
//! one literal expansion into the `Inc`/`Dec`/`Stop` instructions a textbook counter machine runs, with an
//! exact count of the literal steps that expansion takes — except [`program::Macro::Spin`], which never
//! finishes and so has none. [`accel`] runs a program both ways: literally, one
//! instruction at a time, and accelerated, where each macro is arithmetic on the counters' values and its step
//! count is computed from its formula. **An accelerated run computes its literal step count; it does not take those
//! steps**, and nothing that reports one may say otherwise.
//!
//! [`nat`] is the arithmetic the counters need, [`compile`] turns a Turing machine into a program, [`readback`]
//! turns a stopped program's counters back into tapes and a value, and [`godel`] folds three counters into
//! two for literal runs on toy machines.

pub mod accel;
pub mod compile;
pub mod godel;
pub mod nat;
pub mod program;
pub mod readback;
