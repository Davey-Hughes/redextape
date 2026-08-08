import { n } from './format'
import type { RecordEnd } from './protocol'

/** Everything the control strip needs to know about one leg, and nothing about the DOM. */
export type LegView = {
  available: boolean
  reason: string
  head: number
  length: number
  oldestStep: number
  currentStep: number
  newestStep: number
  evicted: boolean
  /** `null` while recording is still in flight. */
  done: RecordEnd | null
}

export type ControlState = {
  canBack: boolean
  canForward: boolean
  canPlay: boolean
  canRestart: boolean
  /**
   * The continue button's label, or `null` for NO BUTTON AT ALL. Whether asking the worker for more
   * frames would achieve anything is exactly `continueLabel !== null` — there is no separate
   * `canExtend` flag carrying the same fact under a second name; `pane-chrome.ts`'s `update` checks
   * `continueLabel` directly.
   */
  continueLabel: string | null
  stepText: string
}

/**
 * How the recording stopped, as one line the user can act on.
 *
 * THREE STOP REASONS AND THREE SENTENCES, because they are three different facts. A spent recording
 * budget leaves the run `Running` and costs nothing to continue; a spent cursor cap needs the cap
 * raised; and a depth refusal cannot be continued at all. `session.rs:415` records the first
 * distinction one layer in, and `trace.rs:98` records the second.
 */
function doneText(done: RecordEnd): string {
  switch (done) {
    case 'ended':
      return ''
    case 'capped':
      return ' — spent its step budget'
    case 'depth-refused':
      return ' — the term is deeper than the reducer allows'
    case 'budget':
      return ' — history is full'
  }
}

/**
 * Whether asking the worker to record further could achieve anything.
 *
 * THE ONE PLACE THIS IS DECIDED. `▶` at the recorded frontier and the `[continue]` button are the
 * same operation with different labels, so they must not each carry their own idea of when it is
 * available — `depth-refused` in particular is a case where continuing provably cannot help, and a
 * second copy of that list is how one of the two ends up offering it anyway.
 */
export function canRecordFurther(done: RecordEnd | null): boolean {
  return done === 'capped' || done === 'budget'
}

export function controlState(v: LegView): ControlState {
  if (!v.available) {
    return {
      canBack: false,
      canForward: false,
      canPlay: false,
      canRestart: false,
      continueLabel: null,
      stepText: v.reason,
    }
  }

  // `depth-refused` IS ABSENT FROM THIS LIST DELIBERATELY, and it is the one case worth stating out
  // loud: `raise_cap` refuses to clear `depth_capped`, so a continue button would offer something
  // that provably cannot work. No button, rather than a disabled-looking one. `canRecordFurther` is
  // the actual gate; the ternary below only picks which of its two positive cases gets which label.
  const continueLabel = !canRecordFurther(v.done)
    ? null
    : v.done === 'capped'
      ? 'continue — raise the step cap'
      : 'keep recording'

  const of = v.done === null ? `${n(v.newestStep)}…` : n(v.newestStep)
  const oldest = v.evicted ? ` (oldest kept: step ${n(v.oldestStep)})` : ''
  const stepText =
    v.length === 0 ? 'not run' : `step ${n(v.currentStep)} of ${of}${v.done === null ? '' : doneText(v.done)}${oldest}`

  return {
    canBack: v.head > 0,
    // `▶` STAYS LIVE AT THE FRONTIER WHEN THERE IS MORE TO RECORD. Forward means forward whether the
    // next frame has been recorded yet or not — `main.ts` turns a frontier `▶` into the same `extend`
    // request `[continue]` sends. Gating this on recorded frames alone left that branch unreachable:
    // the button was disabled at exactly the moment it had something to do.
    canForward: v.head < v.length - 1 || canRecordFurther(v.done),
    canPlay: v.length > 1,
    canRestart: v.length > 0,
    continueLabel,
    stepText,
  }
}
