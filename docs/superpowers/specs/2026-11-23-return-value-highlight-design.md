# The result marked at a run's end — design

Return-value lane, PR 2 of 3 (PR 1, cut text read whole in a tooltip, merged as #194; PR 3 is list results). Base: main `b627fe3`. The lane's record is `~/temp/redextape-return-value-record/`: `progress.md` holds the decisions with times, `survey-a.md` and `survey-b.md` the code surveys (line numbers at `b32af3d`), and `.superpowers/brainstorm/*/content/` the mockups the user chose from.

## Intent

At the end of a run the user wants to see the answer in each view without hunting for it. Their words (2026-11-21): for the TM "the tape that holds that", for rxm and clif "the rr register (I presume)", for λ "the only value left". A long result must also read in full ("right now a long return value in clif for example gets truncated"); PR 1 gave every cut text a tooltip, and this PR shows the result itself whole at the end. And for the TM (2026-11-23): "specify whether it's big or little endian ... maybe in the bar above only if there's space".

## Today

- **The views never get the result.** Each leg's value reaches only the readout, as text (`Decoded` → `{ Value: { text } }`; replies.ts → `setProgram`). Nothing tells the page the result's type. `LegState.done === 'ended'` (sessions.ts) also covers a TM overflow, an rxm fault and a clif trap or fault; and the TM, rxm and clif values can be known while the recording stopped at the step cap, because they come from compile's own run or clif's scout. A result reply can belong to an older generation than the frames (readout.ts guards on `r.gen !== recording.gen`).
- **rxm:** the result is `rr` (rxm_cursor.rs: "The program's result is in `rr`"). Nothing marks it at the end. The registers are a grid of `minmax(14ch, 1fr)` columns, so a long value is cut: fact(12) at a 343 px registers panel reads `rr 4790016…`.
- **clif:** there is no `rr` register. The result is the operand of main's final `return`; main's frame is kept at the end and `ClifState.at` is that `return`. The operand can be an alias: sum_to(5) ends on `return v9` with `v9 -> v8`, and the values panel has no v9 row. The operand is only in the listing row's text; no field names it. The values panel holds the first 64 set values, so a high-numbered returned value can fall under "+N more values". A narrow values panel is one column (136 px at a 1400 px window), where fact(12)'s value is cut.
- **TM:** the result is field 0 of the REG tape (tape 0), the cells between its first and second `#`. Binary fields are least significant bit first, the leftmost cell least significant (tm/encoding/binary.rs:1, tm/build.rs). A frame carries the cells within 40 of each head.
- **λ:** a decoded result's final term is the value and nothing else; a Nat draws as one numeral chip at the root.
- **Marks in use:** `--accent` (the machine's position, a changed register), `--tok-nat` through `--link-bg`/`--link-edge` (the pinned link), `--tok-operator` (running focus, λ redex marks). Every mark also has a non-colour cue, a shape or words. Colours are palette tokens (palettes.ts: "THE TOKEN LIST IS THE CONTRACT"), held by `contrast.ts` and `palettes.test.ts`, in every palette's light and dark variant.

## Goals

1. At the last step of a run that finished with a value, the λ, TM, rxm and clif views each mark where the result is: rxm the `rr` register, clif the returned value, the TM REG tape's field 0, λ the root node.
2. The mark is an emerald tint with a thin emerald edge and the word "result".
3. In rxm and clif the result is never cut at the last step: its cell moves to the panel's first row, spans the whole row, and wraps only when even the whole row is too narrow.
4. The TM status line says "little-endian" for a binary field when it has room.

## Non-goals

- **Values cut mid-run** while their panel has room (squeezed-values TODO): its own PR, next. The user kept it out of this one (2026-11-23, "just a then").
- **A list result's heap cells, and a list-result example:** PR 3. Here a list result marks only its pointer word (rxm `rr`, the clif value, TM field 0). A λ list result is a multi-row term and gets no mark until PR 3 (the λ bar strip has no free lane).
- **Function results:** every leg answers `Undecodable` ("no encoding for this type"); no mark. A later feature (λ prints the normal form) may change that.
- **Copies:** no mark. The copies feature was being removed (remove-copies lane), and is gone: #196 (`e65a533`) removed it from the web app, and this branch merged it as `66ab998`.
- **The final `halt`/`return` row in the rxm and clif listings:** at the end no listing row is marked and the listing does not scroll there. Noted as a later follow-up, not part of this PR.
- **A TM field wider than the frame's window:** mark the part on screen; widening the window is not this PR.

## Anti-goals

- A mark on a run that did not finish with a value (stopped at the step cap, an overflow, a fault, a trap) or at any step but the last: it would point at something that is not the answer.
- Anything that moves the page. The layout changes here stay inside a view and happen only at the last step; the user chose them having seen that they move cells (the result to the top row; the TM word pushing the REG tape right).
- Wrapping the TM status line: its added words are dropped instead (the page-shift rule; the TM header-wrap TODO).
- A mark told by colour alone.

## Approaches

Chosen with screenshots of the real app (sum_to(5) and fact(12) at their last step, light and dark), 2026-11-23.

**The mark.** A: a green tint and edge plus the word "result" (a fourth hue). B: a double outline in the text colour plus "result" (no new hue; a 2 px double outline draws as one line, and it touched the next row). C: the words "← result" only, like the heap panel's "← rr". **The user picked A**, "but can we use a nicer shade of green", then **Emerald** from four: Material (#2e7d32 / #81c784), Emerald (#047857 / #34d399), Soft (#2f855a / #9ae6b4), Sea (#2e8b57 / #7fd8a6).

**A long result.** 1: the cell spans its whole row where it is (in rxm it left `pc` alone on the first row; in clif's one-column panel it changed nothing). 2: the cell moves to the first row, whole row. 3: the value wraps inside its cell (the only one that showed clif's value whole; in rxm it split `47900160` / `0`). **The user picked 2**, and took wrapping as the fallback when even the whole row is too narrow ("yes").

**The TM.** A: the word "result" right after field 0, pushing the rest of the REG tape right, and " · little-endian" at the end of the status line. B: the box alone, and " · result in REG · little-endian" in the status line, nothing moving. **The user picked A**, with "little-endian" as shown.

## The design

### When the mark shows

On a view of the program, when that view's cursor is at the last step of its leg's recording, the recording reached the run's end, and the leg's value for that recording's generation is a decoded `Value`. At any other step, and for a run that ended any other way, nothing is marked and the layout is today's. Stepping back from the end removes the mark; stepping to the end again restores it.

"The recording reached the run's end" must be proven from the recording itself, not from `done === 'ended'` alone: protocol.ts's `endOf` maps a `Running` status to `'ended'`, and a decoded TM, rxm or clif value comes from compile's own run, so an `'ended'` recording with a value does not prove the frames reached the end. A fault or a trap arrives as `Decoded::Fault`, never `Value`, so it is unmarked by the value test alone.

A Unit result gets no mark: its machine word means nothing (the rxm decoder ignores it). *(My call.)*

### The colour

A new palette token for the result, read only through `style.css`, in every palette's light and dark variant. In the default palette it is **#047857** light and **#34d399** dark. The tint is `color-mix(in oklab, <token> 20%, transparent)`; the edge an inset 1 px line in the token.

The word must reach 4.5:1 on the tint. The token does in dark (5.52:1) but not in light (3.96:1), so the light word is the darker **#065f46** (5.54:1 on the light tint over #fafafa, measured in the mockup). How the word gets its own colour (a second token, or a mix) is the builder's; `contrast.ts` must hold it.

The other palettes get a green that suits each and passes the same checks, kept apart from their existing tokens as `tok-binder` is; the Grayscale palette a grey from its own ramp, where the edge and the word carry the meaning. An imported base16 scheme takes its own green, `base0B`, which it already gives `tok-binder`; the binder clash check exempts the result/binder pair (they are never asked to mean different things side by side: a λ Nat result is a chip with no binder showing). The result word's contrast floor applies to imports too, and the import's "apply adjusted" step learns to fix it. A palette imported before this PR is re-derived from the scheme colours it stored, if it stored them; otherwise the builder picks the safest fallback and says which.

*(My calls; the user chose only the default palette's colour.)*

### The word

"result", at 0.75 em, right after the value, as real text so a screen reader reads it. In λ it joins the marks' screen-reader words (`data-marks` in lambda-body.ts) as the other λ marks do.

### rxm

At the last step the `rr` register's cell is first in the registers grid and spans every column, the value then the word. The value breaks onto a second line, anywhere, only when the whole row is too narrow for it. The other registers follow in their usual order. Other marks on the cell (`is-changed`) keep working.

### clif

The returned value is the operand of main's final `return` at `at`, with aliases followed to the value that has a row (`return v9`, `v9 -> v8` → v8). It is found exactly, not guessed from an `rr` label. The Rust side names it in the frame at the end (for example a field on `ClifState`) and makes sure the values window holds it, even past the first 64. The values panel lays it out as rxm's registers panel does: first row, whole row, wrapping only when the row is too narrow (in a 136 px one-column panel: `479001600`, then `rr result` under it).

### TM

REG field 0's cells take the tint and edge as one box. The word "result" sits right after the box and pushes the rest of the REG tape right, at the last step only. A field partly outside the frame's window is marked where it is on screen.

For a binary field the status line (`halt · step N of N · width W`) ends with ` · little-endian`. When the line has no room for it, the words are dropped, never wrapped. Unary says nothing about bit order.

### λ

The root node takes the tint, the edge and the word: for a Nat, its numeral chip; for a Bool, the root term on its one row.

## Left to the builder

- How each view learns that it is at a finished run's end with a decoded value, and of what generation (the readout's result reply already carries it; readout.ts's generation guard is the model).
- The token names, the word's colour mechanism, and the values for the palettes other than the default.
- How clif's returned value crosses from Rust, and how the values window keeps it.
- Tests: a browser test per view at the last step and at the step before; the layout rules (first row, wrap fallback) at a narrow and a wide panel; both themes; a run stopped at the step cap and a function result unmarked; that nothing outside the view moves.
- help.html's words for the mark, the roadmap entry, and the doc that lists the λ marks.
- Merge order with the remove-copies lane, which touches the same panes: whichever lands second rebases. Remove-copies landed first (#196, `e65a533`), and this branch took it by a merge, `66ab998`, rather than a rebase.

## As built

- **The dark word reads 5.49:1 on its tint, not 5.52:1.** The 5.52 was the mockup's. Composited as the browser draws a 20% mix over an opaque surface (`contrast.ts`'s `tinted`), `#34d399` over `#212121` gives the ground `#254539`, on which `#34d399` reads 5.49:1, still above 4.5:1; the light word `#065f46` reads 5.54:1 on its ground, as the mockup measured. The word's colour is a token of its own, `result-word`, beside `result` (the roadmap entry's figures).
- **The word's floor moved a test scheme's green.** Day, the light base16 scheme the tests hold to pass every check, failed the word on its own tint with its base0B `#2e6e2e` (4.25:1 over base00, 3.84:1 over base01), so its base0B is now `#2a602a`, which reads 5.00:1 and 4.53:1 there, and Day still passes every check. Each ratio here is rounded to two places.
- **A palette imported before this branch needs no fallback.** Every stored half holds its scheme's sixteen colours (the store refuses one without them), so a token it lacks is mapped from them and, for an adjusted half, adjusted beside its stored tokens; the tokens it stored are never changed.
- **clif's returned value is `ClifState::returned`** (`returned: number | null` in TypeScript), set only at a run's normal end, `ClifEnd::Ran`: the operand of main's `return`, through its aliases. Where it is not among the first values the window holds, its row takes the window's last place, after the others, as its number is the larger.
- **On a λ root that is also the contractum or a pinned link, the result's ground is drawn alone.** The plan laid the result's tint over the contractum's or the link's ground there, and on is_even(6)'s root `true`, the contractum at the λ view's last step, the word read under 4.5:1 in 7 of the 10 built-in variants, 4.20:1 in Material light. Drawn alone, the result's ground holds the word at or above its floor in each of the 10, measured in the browser on the ground the page draws: 4.68:1 at the lowest, Instrument light. The contractum keeps its underline and its words, the link its edge (the roadmap entry's figures).
- **λ marked a chip, on one row, and nothing else; PR 3 marks the root whatever it is.** As this PR built it, the root was marked only when it was a numeral's or a Bool's chip drawn on one row, so a list result, whose root is its constructor's λ, had no λ mark, and an opened chip over several rows had none, since the mark strip gives a result no lane. PR 3, list results, drops the rule: a root on one row is marked round its run, a list's `λn c. c …` and `[]`'s `λn c. n` included, and a root over several rows is one block, each of its rows in the result's ground with one edge round them all and the word after the first row's text (`.term-line.is-result-row`), so an opened chip is marked too and the strip still gives the result no lane. Its left edge is a shadow off the strip's right side, so it stays where the strip is when the term scrolls sideways. On one row or over several, the word is dropped where the root's first row has no room for it (the list results design's *As built*).
- **A program can end with a Unit value.** `let mut x = 0; x = 1;` ends on every leg with the value `()`, and the Unit test in `result-mark.ts` leaves each view of it unmarked. The plan took it that no program could, from two programs the parser refused for a missing `;`. An app case runs it to its end in the λ, TM, rxm and clif views, where the λ root is the numeral chip `0`, which the rule for a number would mark, and finds no mark in any of them.
- **The contrast floors cover the word alone**, as the design asks: the other text on the mark's ground has no floor there. On the tint over `bg-raised`, Material light's `fg` (a value in rxm and clif, a TM cell) reads 3.46:1 and its `tok-nat` (the λ chip) 3.45:1, Material dark's `fg-dim` (a register's name, a clif value's registers) 3.00:1, and Grayscale dark's `fg-dim` 2.91:1. Asked whether the result's own text must meet a floor on the tint, the user chose on 2026-11-25 to leave it without one.
- **The TM marks field 0 only from a window that starts at the tape's cell 0 with its `#`**: `resultField` answers `null` from any other. The compiler's encoding gadgets enter and leave with REG's head on that leading `#`, its home, and every halt probed had REG's window starting there; from anywhere else the first `#` in the window would open a later field. A field wider than the window is marked from its first cell to the window's end.
- **In clif, a value's registers and the word go in one box** (`span.result-tail`), which the row breaks before as a whole, so fact(12) in a one-column values panel reads `479001600`, then `rr result` under it, as drawn above. The plan's rule, a break at the space before the word first, gave `479001600 rr`, then `result`; this design's drawing was kept. In rxm, `rr`'s row has no registers after its value, so the box holds the word alone.
- **With classic scroll bars, the word can give REG's row a scroll bar at the last step.** The word after the box widens REG's cells, and where they nearly fill the view, the row's own horizontal scroll bar appears at the last step and moves the tapes under REG down, inside the view. Accepted: it stays in the view and at the last step, and a tape row already gains and loses a scroll bar mid-run as its window changes. No test asserts it: every Chromium project but the scroll-bar one launches with Playwright's `--hide-scrollbars`, under which a scroll bar takes no width, the scroll-bar project runs no result case, and no case in the Firefox projects, which pass no such flag, reads REG's row for a scroll bar.
- **No guard for copies.** The plan had `draw.ts` mark no view of a copy, and `result-copy.test.ts` held that with two cases, an rxm copy and a λ copy at their run's end. #196 (`e65a533`) removed copies and the session flag the guard read, and the page now registers the program's session alone, so no view can show a copy: the merge with main (`66ab998`) removed the guard and the file with them. The file's cases also showed a view split from another after the run's end marking the result, which a case in `result-app.test.ts` now shows on a view split from the rxm view at fact(12)'s end (the roadmap entry's *The merge with main*).
