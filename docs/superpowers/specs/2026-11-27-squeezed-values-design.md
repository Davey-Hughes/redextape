# Values given the room they need — design

The squeezed values design. Base: main `adb5d5e` (#207). It follows the return-value lane: #194 gave a cut text its tooltip, and #201 showed the result whole at a run's end. This one is every value at every step.

## Intent

The user, 2026-11-23, after trying #194: "the tooltip is fine, but ideally we should avoid squeezing numbers when there's actually space. like here we should try to utilize the space better when a number is going to be cut off". Their screenshot: an rxm registers panel about 350 px wide reading `pc 20 | rr 4790016… | a0 0`, then `r0 12`, with room to its right and below. Their rule of 2026-11-17 holds over every choice: "I don't want anything like this that shifts the page unexpectedly".

## What was counted first

Over each example's rxm run, and its clif run, the rows each frame's values panel draws, laid out by the stylesheet's rules with Hack's advance assumed (0.602em at 12px) rather than read from a browser:

- **fact(12), rxm:** `rr` reaches nine digits, 479001600, at step 179 of 181, the frame of the screenshot. Of panels 250, 300, 350, 400, 450, 600 and 750 px wide, the grid cut a value only at 350 and 450, where its tracks sit near their 14ch floor. Every option that moves cells moved them once, at step 179; on a step back from 179 to 178, sizing from each frame's widest, spanning tracks and wrapping moved them again and the ratchet did not. A static 20-digit track drew 12 rows at 350 px where the grid draws 4. No other example's rxm values were cut at those widths.
- **clif:** every example but is-even holds 18446744073709551615, a value of 20 digits with no register, at some frame, which needs a values panel about 205 px wide; the CLIF row's values column was 7.375rem, 118 px.
- **The call stack and the heap:** a frame was cut in most of the rxm frames at 350 px, 162 of fact(12)'s 182, and map-fold's in 233 of 261 frames even at 600 px. A frame's words never change while it is on the stack, so wrapping frames moves lines only at calls and returns. Heap lines were cut only near 250 px, map-fold's in 21 of 261 frames; wrapping them moved lines at 23 steps where today's cut lines move at 7, and 10 with each line keeping its longest text.

## The choices

The user chose on 2026-11-27, "1a 2a 3b 4a 5b 6a", then "7a 8a":

1. **A ratchet:** each track of the values grid at least as wide as the widest row the run has needed, only growing, so cells move once, at the step a value first outgrows the tracks.
2. **Forgotten at a new program, a recompile or a new clif listing; kept across a rewind and a step back.**
3. **The call stack and heap lines too**, not the values alone.
4. **A panel narrower than one value keeps the ellipsis and the tooltip.**
5. **A wider clif values column, in this change.**
6. Yes to the downloads the counts needed.
7. **A frame or heap line too long for its panel wraps onto the lines below, indented**; frames move only at calls and returns, and a heap line grows once per crossing.
8. **The clif values column 14.75rem**, the call stack's and the heap's, which holds 20 digits and a register name. A clif view beside the source in a 1280 px window is medium from then on.

## The design

- **The values' room** (`machine-panels.ts`'s `valuesRoom`, `rowRoom`): a row needs its name's column (at least 4ch), the 1ch gap, its word and the registers after it, in ch, from its text's length alone, so no frame measures anything. The panel keeps the most any row has needed and writes it as `--values-room` on its body only when it grows; `style.css`'s `.rxm-register-list` sizes each track `min(100%, max(14ch, room + padding + 1px))`, so the grid has as many tracks as fit that room, and a panel narrower than one row has one track as wide as itself, where the ellipsis and the tooltip stay. The result's row spans every track and wraps already, so it is left out.
- **When it forgets:** the view calls `forget` from `setProgram`, which a new program, a recompile and a new clif listing all reach. A rewind draws no frame of its own, but the history it clears draws `null` in between; the room outlives that, so it cannot be keyed on an empty frame.
- **The call stack and the heap** break a line at a space where they can, and anywhere in a word too long for a line of its own, with every line after the first 2ch in. Nothing in them is cut, so `cut-text.ts` no longer watches them.
- **A heap line's room** (`lineRoom`): each line, by its lead, keeps the longest text it has had, which the panel lays out hidden in the same cell of a one-cell grid as the line's own text, so the line is as tall as the taller of the two. A cell's head and tail never change; the registers that name it do.
- **clif's values column** is 14.75rem, as its call stack's and heap's are, so the row is wide from 724 px and medium from 480 px under a 16px root.

## As built

- **The room is kept in the panels, and the views only tell them to forget**, one call each in `RxmPane` and `ClifPane`'s `setProgram`.
- **A heap line's room is its longest text, not its count of characters.** Hidden characters after a shorter text would break where that text's words do, and so take a different count of lines than the text they stand for; the text itself takes the same.
- **A frame keeps no room**, as its text is fixed for as long as it is on the stack.
- **A cut value is the only machine text the tooltip still has to read whole**, besides a panel's name and a listing row; the app's cut-text case reads a clif listing row where it read fact(12)'s result, which the clif view's wider values have room for at the page's 760 px by the stylesheet's rules (not drawn in a browser here).
