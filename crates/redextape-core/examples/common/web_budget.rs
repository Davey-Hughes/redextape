/// `protocol.ts`'s `LAMBDA_BYTE_BUDGET`, and the reason §3.2 of Plan 5a's design caps the ring
/// buffer in bytes rather than frames: one frame is allowed to be this large.
pub(crate) const WEB_BYTE_BUDGET: usize = 65_536;
