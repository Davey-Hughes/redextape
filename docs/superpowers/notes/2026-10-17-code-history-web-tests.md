# Code history moved out of comments

Text moved verbatim out of code comments when they were trimmed to their why. Each entry names the file and the line of code the comment sat above.

## `web/tests/browser/stage-gestures.test.ts`, above `const host = (leaf: string): HTMLElement | null =>`

Caught by this file's own first run, against a fix that was already working.

## `web/tests/browser/tm-buffer-restore.test.ts`, above `function editedToHaltImmediately(text: string): { text: string; start: string } {`

Reused for
the SECOND composition this file's Task 11 fix round adds: an edit surviving a reload needs a real
edit, not merely a reload of what a fork already seeded, and this is the smallest one already proven
to reach a running machine.

## `web/tests/browser/buffers-quota.test.ts`, above `const noticeText = (): string => document.querySelector('#notice .notice-text')?.textConte`

The notice line's text — where the storage report rests since Plan 7 part 2 (spec §11).

## `web/tests/browser/buffers-quota-restored.test.ts`, above `const noticeText = (): string => document.querySelector('#notice .notice-text')?.textConte`

The notice line's text — where the storage report is said since Plan 7 part 2 (spec §11).

## `web/tests/node/sessions.test.ts`, above `const paintLambda = (reg: SessionRegistry, slot: PaneSlot<'lambda'>, pane: PaneView<Lambda`

TWO MONOMORPHIC HELPERS RATHER THAN ONE GENERIC IN `K`, mirroring `draw()`, which also has exactly
two call sites and no loop over legs. A helper generic over `K` needs the correlation between the
leg's frame type and the pane's frame type — which is what `PaneSlot.render`'s own signature
carries — restated in the helper, and the only spellings that compile go through `any`. Two lines
are cheaper than a cast, and they are the two lines the app actually runs.

## `web/tests/browser/pane-kind-switch.test.ts`, above `const splitSame = (leaf: string, dir: 'row' | 'column'): void => splitVia(leaf, dir, 'same`

the split control opens a picker now, whose
first entry is the pane's own pair labelled "another view of this", so the gesture that used to be one click is two
and still means what it meant.

## `web/tests/browser/layout-restore.test.ts`, above `const splitRow = (leaf: string): void => splitVia(leaf, 'row', 'same')`

the control opens a picker now, whose first
entry is the pane's own pair labelled "another view of this", so the gesture that used to be one click is two and
still means what it meant.

## `web/tests/browser/extend-focus-probe.test.ts`, above `async function historyFills(): Promise<void> {`

As one wait it took 7,198 to 8,988 ms at `CPUQuota=25%` (2026-10-05), against `until`'s 10 s; as two, the
second took up to 7,513 ms.
