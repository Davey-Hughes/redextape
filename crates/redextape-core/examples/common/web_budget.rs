/// `protocol.ts`'s `LAMBDA_BYTE_BUDGET`, and the reason §3.2 of Plan 5a's design caps the ring
/// buffer in bytes rather than frames: one frame is allowed to be this large.
///
/// THAT POINTER READ `protocol.ts` line 10 UNTIL THIS COMMIT, AND IT WAS WRONG AT BIRTH AND RIGHT
/// AGAIN BY ACCIDENT — invalidated by its own commit, then restored by an unrelated one. Line 10 held
/// that constant in the PARENT of the commit that wrote this doc, Plan 5a-i (#17); that same commit
/// rewrote `protocol.ts`, splitting the constant's one-line doc into a block and lifting the constant
/// one line, so the pointer landed on the blank line immediately below the constant.
/// Static click-linking (#23) later added a `LinkIndexWire` import at the top of the file, which
/// pushed the constant back down by exactly the line it had lost. Net drift over the whole history:
/// zero. A pointer that was wrong when written, is right now, and was made right by an import line
/// nobody connected to it is the whole argument for naming the symbol instead.
pub(crate) const WEB_BYTE_BUDGET: usize = 65_536;
