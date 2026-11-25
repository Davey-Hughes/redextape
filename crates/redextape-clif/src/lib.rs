//! The CLIF view's package: the CLIF `redextape-native` builds for a program, stepped one instruction at a
//! time by Cranelift's interpreter with native-rt's `Runtime` answering the runtime imports, so that a run
//! ends where the compiled code's does.

mod leg;
mod listing;
mod state;
mod stepper;

pub use leg::{ClifInput, ClifLeg, ClifStatus};
pub use listing::{ClifFunction, ClifListing, ClifRow, ClifRowKind, listing};
pub use redextape_native::decline_reason;
pub use state::{ClifAt, ClifState, ClifValue, ClifWindow};
pub use stepper::{ClifEnd, FRAME_BYTES_PER_VALUE, Stepper};
