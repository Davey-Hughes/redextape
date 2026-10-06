/**
 * A byte-budgeted ring of recorded frames, and the play head that walks it.
 *
 * THE BUDGET IS BYTES, NOT FRAMES, and that is measured rather than tasteful. `frame_cost_probe`
 * found a λ frame ranging from ~5 KB to 781 KB across nine programs, so "keep 1,000 frames" is a
 * memory policy spanning three orders of magnitude depending on what the user typed.
 *
 * GENERIC OVER THE FRAME, AND SIZING IS THE CALLER'S JOB. `lambdaFrameBytes`/`tmFrameBytes` live in
 * `protocol.ts` beside the budgets they are spent against; this class knows only how to add numbers
 * up. That is also what keeps it DOM-free and node-testable.
 *
 * **AN EVICTION MOVES NO FRAME THE RING KEEPS.** The oldest frame is dropped by emptying its place and
 * moving `#start` past it, and the emptied places are cut off in one copy once there are as many of
 * them as frames kept, so an eviction's work does not grow with the frames the ring holds. It used to
 * `shift` both arrays. V8 trims a small array in place, but on one as large as a full TM history a
 * `shift` moves every element: a node bench (2026-10-05) put a push and a `shift` at 0.08 to 0.30 µs with
 * 1,000 to 10,000 kept and at 1.76 to 46.95 µs from 16,000 up. One *keep recording* on `map and fold`
 * pushes 22,777 frames onto its full TM ring, from step 69,008 to the halt at 91,785, and at
 * `CPUQuota=25%` CPU profiles of the page put 7,397.5 and 9,347.7 ms of that press's 10,899 and
 * 13,467 ms in `#evict` (2026-10-05, at `53ecbfa`). The page handled the worker's chunks back
 * to back and ran no timer for up to 12.2 s. Since, in three interleaved runs at 25 %, no two of the
 * press's polls came more than 601 ms apart, where they had come 7,604 to 8,288 ms apart.
 */
export class History<T> {
  /**
   * The frames, the oldest kept at `#start`. **THE PLACES BEFORE `#start` ARE EVICTED FRAMES'**, each emptied as its
   * frame goes so that nothing here keeps it alive, until `#evict` cuts them off.
   */
  #frames: (T | undefined)[] = []
  /** What each frame in `#frames` cost, at the same index. */
  #sizes: number[] = []
  /** Where the oldest kept frame is in `#frames` and `#sizes`. */
  #start = 0
  #bytes = 0
  #budget: number
  /** The step number of the oldest kept frame. Non-zero exactly when something has been evicted. */
  #firstStep = 0
  /** The play head, counted from the oldest kept frame. */
  #head = 0
  #following = true

  constructor(budgetBytes: number) {
    this.#budget = budgetBytes
  }

  get length(): number {
    return this.#frames.length - this.#start
  }

  get head(): number {
    return this.#head
  }

  get current(): T | undefined {
    return this.#frames[this.#start + this.#head]
  }

  /**
   * The step number of the oldest RETAINED frame. §6's contract for scrubbing past the eviction
   * point is stated in this number: the UI says where history begins rather than pretending it
   * begins at zero.
   */
  get oldestStep(): number {
    return this.#firstStep
  }

  get newestStep(): number {
    return this.#firstStep + Math.max(0, this.length - 1)
  }

  get currentStep(): number {
    return this.#firstStep + this.#head
  }

  get evicted(): boolean {
    return this.#firstStep > 0
  }

  /**
   * Append a frame. The head FOLLOWS the frontier only while it was already there — a user who has
   * scrubbed back is not yanked forward by frames still arriving behind them.
   */
  push(frame: T, bytes: number): void {
    this.#frames.push(frame)
    this.#sizes.push(bytes)
    this.#bytes += bytes
    if (this.#following) this.#head = this.length - 1
    this.#evict()
  }

  /**
   * Drop oldest-first until the budget holds. NEVER DOWN TO ZERO: one frame larger than the whole
   * budget is still the frame the user is looking at, and an empty pane is a worse answer than an
   * over-budget one.
   *
   * **THE EMPTIED PLACES ARE CUT OFF ONCE THEY ARE AS MANY AS THE FRAMES KEPT**, by one copy of the frames kept and
   * their sizes. A cut follows at least as many evictions as the frames it copies, so the copying averages at most one
   * frame and one size per eviction, and between calls each array holds fewer than twice as many places as frames kept.
   */
  #evict(): void {
    while (this.#bytes > this.#budget && this.length > 1) {
      this.#bytes -= this.#sizes[this.#start] ?? 0
      this.#frames[this.#start] = undefined
      this.#start += 1
      this.#firstStep += 1
      this.#head = Math.max(0, this.#head - 1)
    }
    if (this.#start > 0 && this.#start >= this.length) {
      this.#frames = this.#frames.slice(this.#start)
      this.#sizes = this.#sizes.slice(this.#start)
      this.#start = 0
    }
  }

  seek(i: number): void {
    if (this.length === 0) return
    this.#head = Math.min(Math.max(i, 0), this.length - 1)
    this.#following = this.#head === this.length - 1
  }

  back(): boolean {
    if (this.length === 0) return false
    // Set even on a clamped no-op: pressing ◀ at all — even from the oldest frame, where it can't
    // move — is the user taking manual control, and a `push` arriving right after must not yank the
    // head back to the frontier as if nothing happened.
    this.#following = false
    if (this.#head <= 0) return false
    this.#head -= 1
    return true
  }

  forward(): boolean {
    if (this.#head >= this.length - 1) return false
    this.#head += 1
    this.#following = this.#head === this.length - 1
    return true
  }

  clear(): void {
    this.#frames = []
    this.#sizes = []
    this.#start = 0
    this.#bytes = 0
    this.#firstStep = 0
    this.#head = 0
    this.#following = true
  }
}
