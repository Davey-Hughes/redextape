# Values given the room they need — design

The squeezed values design. Base: main `adb5d5e` (#207). It follows the return-value lane: #194 gave a cut text its tooltip, and #201 showed the result whole at a run's end. This one is every value at every step.

## Intent

The user, 2026-11-23, after trying #194: "the tooltip is fine, but ideally we should avoid squeezing numbers when there's actually space. like here we should try to utilize the space better when a number is going to be cut off". Their screenshot: an rxm registers panel about 350 px wide reading `pc 20 | rr 4790016… | a0 0`, then `r0 12`, with room to its right and below. Their rule of 2026-11-17 holds over every choice: "I don't want anything like this that shifts the page unexpectedly".

## What was counted first

Over each example's rxm run, and its clif run, the rows each frame's values panel draws, laid out by the stylesheet's rules with Hack's advance assumed (0.602em at 12px) rather than read from a browser:

- **fact(12), rxm:** `rr` reaches nine digits, 479001600, at step 179 of 181, the frame of the screenshot. Of panels 250, 300, 350, 400, 450, 600 and 750 px wide, the grid cut a value only at 350 and 450, where its tracks sit near their 14ch floor. Every option that moves cells moved them once, at step 179; on a step back from 179 to 178, sizing from each frame's widest, spanning tracks and wrapping moved them again and the ratchet did not. A static 20-digit track drew 12 rows at 350 px where the grid draws 4. No other example's rxm values were cut at those widths.
- **clif:** every example but is-even holds 18446744073709551615, a value of 20 digits with no register, at some frame, which needs a values panel about 205 px wide; the clif row's values column was 7.375rem, 118 px.
- **The call stack and the heap:** a frame was cut in most of the rxm frames at 350 px, 162 of fact(12)'s 182, and map-fold's in 233 of 261 frames even at 600 px. An rxm frame's words never change while it is on the stack, so wrapping its frames moves lines only at calls and returns. Heap lines were cut only near 250 px, map-fold's in 21 of 261 frames; wrapping them moved lines at 23 steps where today's cut lines move at 7, and 10 with each line keeping its longest text.

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

## The rulings after the first review

The user, 2026-11-28:

- **The clif values keep a 20-digit word's room from the run's first step, and the rxm registers keep the ratchet.** Under choice 1 the clif room grew to 25ch at the step where 18446744073709551615 first showed, partway through every clif run the review drove (fact(12) at step 399 of 493, fact at 159 of 189, map-fold at 119 of 665, countdown at 51 of 157), and moved 22 to 30 cells at once, from two or three tracks to one. A fixed room ends in the same layout with no move during the run: one track in a values panel narrower than two of them, which a 1000 px or 1600 px window gives a clif view beside the source.
- **A step back after a jump to the end can move cells**, as the room counts only the frames the view draws (*As built*): accepted as it is.

## The design

- **The values' room** (`machine-panels.ts`'s `valuesRoom`, `rowRoom`): a row needs its name's column (at least 4ch), the 1ch gap, its word and the registers after it, in ch, from its text's length alone, so no frame measures anything. The rxm view's panel keeps the most any row has needed and writes it as `--values-room` on its body only when it grows; the clif view's writes `WORD_ROOM`, a 20-digit word's row under a 4ch name, 25ch, when it is made, and never changes it (the rulings below); `style.css`'s `.rxm-register-list` sizes each track `min(100%, max(14ch, room + padding + 1px))`, so the grid has as many tracks as fit that room, and a panel narrower than one row has one track as wide as itself, where the ellipsis and the tooltip stay. The result's row spans every track and wraps already, so it is left out.
- **When it forgets:** the view calls `forget` from `setProgram`, which a new program, a recompile and a new clif listing all reach; the clif view's values have nothing to forget. A rewind draws no frame of its own, but the history it clears draws `null` in between; the room outlives that, so it cannot be keyed on an empty frame.
- **The call stack and the heap** break a line at a space where they can, and anywhere in a word too long for a line of its own, with every line after the first 2ch in. Nothing in them is cut, so `cut-text.ts` no longer watches them.
- **A heap line's room** (`lineRoom`): each line, by its lead, keeps the longest text it has had, which the panel lays out hidden in the same cell of a one-cell grid as the line's own text, so the line is as tall as the taller of the two. A cell's head and tail never change; the registers that name it do.
- **A clif frame's pc:** the running frame's names the instruction the run is at, which changes at each step, and is empty at an instruction with no srcloc. Every clif frame's pc is as wide as the listing's widest label (`clif-view.ts`'s `widestPc`, written as `--ret-room` on the call stack's body at `setProgram`), so a clif stack's lines too move only at calls and returns.
- **clif's values column** is 14.75rem, as its call stack's and heap's are, so the row is wide from 724 px and medium from 480 px under a 16px root. It holds one track of the values' room with a register name after the word.

## As built

- **The room is kept in the panels, and the views only tell them to forget**: `RxmPane`'s `setProgram` tells its registers and its heap, `ClifPane`'s its heap.
- **A heap line's room is its longest text, not its count of characters.** Hidden characters after a shorter text would break where that text's words do, and so take a different count of lines than the text they stand for; the text itself takes the same.
- **A frame keeps no room**, as its text is fixed for as long as it is on the stack but for a clif frame's pc, which is as wide as the listing's widest label.
- **The room counts the frames the view draws.** A value at a step the view never drew, which a jump to the end or a play faster than the screen passes over, widens the tracks at the step back that first draws it, as it would have at the step it was first done, and a heap line likewise. Counting every recorded frame would have the panes read the recording, which only the player does.
- **A heap line keeps its longest text by length.** A later text with fewer characters but other break points can take one line more than it; that line grows at that step and shrinks at the step back. Its room holds every lead the view has drawn since it last forgot.
- **A cut value is the only machine text the tooltip still has to read whole**, besides a panel's name and a listing row; the app's cut-text case reads a cut row of fact(12)'s clif listing where it read fact(12)'s result, which the clif view's wider values have room for. It draws that row in a page 520 px wide, as the clif view cuts no row of the listing at the 760 px its TM cases use.
