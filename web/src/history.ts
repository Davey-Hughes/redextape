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
 */
export class History<T> {
  #frames: T[] = []
  #sizes: number[] = []
  #bytes = 0
  #budget: number
  /** The step number of `#frames[0]`. Non-zero exactly when something has been evicted. */
  #firstStep = 0
  #head = 0
  #following = true

  constructor(budgetBytes: number) {
    this.#budget = budgetBytes
  }

  get length(): number {
    return this.#frames.length
  }

  get head(): number {
    return this.#head
  }

  get current(): T | undefined {
    return this.#frames[this.#head]
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
    return this.#firstStep + Math.max(0, this.#frames.length - 1)
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
    if (this.#following) this.#head = this.#frames.length - 1
    this.#evict()
  }

  /**
   * Drop oldest-first until the budget holds. NEVER DOWN TO ZERO: one frame larger than the whole
   * budget is still the frame the user is looking at, and an empty pane is a worse answer than an
   * over-budget one.
   */
  #evict(): void {
    while (this.#bytes > this.#budget && this.#frames.length > 1) {
      this.#frames.shift()
      this.#bytes -= this.#sizes.shift() ?? 0
      this.#firstStep += 1
      this.#head = Math.max(0, this.#head - 1)
    }
  }

  seek(i: number): void {
    if (this.#frames.length === 0) return
    this.#head = Math.min(Math.max(i, 0), this.#frames.length - 1)
    this.#following = this.#head === this.#frames.length - 1
  }

  back(): boolean {
    if (this.#frames.length === 0) return false
    // Set even on a clamped no-op: pressing ◀ at all — even from the oldest frame, where it can't
    // move — is the user taking manual control, and a `push` arriving right after must not yank the
    // head back to the frontier as if nothing happened.
    this.#following = false
    if (this.#head <= 0) return false
    this.#head -= 1
    return true
  }

  forward(): boolean {
    if (this.#head >= this.#frames.length - 1) return false
    this.#head += 1
    this.#following = this.#head === this.#frames.length - 1
    return true
  }

  clear(): void {
    this.#frames = []
    this.#sizes = []
    this.#bytes = 0
    this.#firstStep = 0
    this.#head = 0
    this.#following = true
  }
}
