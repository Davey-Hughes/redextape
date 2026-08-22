; Highlight queries for the Redextape TM text form.
;
; THESE MUST BE TOTAL OVER THE GRAMMAR'S OWN TOKENS, which is a constraint neither sibling grammar
; carries. `print_tm_inner` pushes a span for EVERY non-whitespace byte it writes — separators
; included — so a token this file leaves uncaptured becomes a length mismatch in the differential
; rather than merely an uncoloured character. That is a feature: it means nothing here can quietly
; go unchecked.
;
; NOTHING OVERLAPS. Every name in this form is one `identifier` token, told apart by the FIELD it
; sits in. Resist adding a broad `(identifier) @variable` catch-all: it would land on the same byte
; range as the field-scoped patterns and ask for `Ident` where the printer says `Label` or
; `StateName`. `tests/tm.rs`'s `a_conflicting_query_is_rejected` runs exactly that query and asserts
; it is refused.

[
  "tapes"
  "start"
  "state"
  "accept"
  "write"
  "move"
  "goto"
  "version"
  "encoding"
  "width"
  "slots"
  "tape"
  "result"
] @keyword

(number) @number

; A state name in DEFINING position is a `Label`; the same name as a `start` or `goto` target is a
; `StateName`. The standard capture vocabulary has no clean pair for that, and `@label` /
; `@label.reference` is design §5.2's resolution: nvim-treesitter and Helix both fall back to a dotted
; capture's prefix when the theme has no rule for the full name, so an editor with no opinion about
; `@label.reference` colours it as `@label` — correct, if less specific — while the projection map
; still sees two distinct keys.
(state name: (identifier) @label)
(start target: (identifier) @label.reference)
(rule target: (identifier) @label.reference)

; Both project to `Ident`, and both rows are needed. `write_header`'s own comment says why the class
; is `Ident` for each: "`encoding` and `result` name an encoding and a type; neither has a class of
; its own, and `Ident` is the vocabulary's word for a name whose meaning comes from elsewhere in the
; file." Splitting the CAPTURE is what gets `result List<Nat>` coloured as a type in an editor.
(encoding name: (identifier) @variable)
(result type: (identifier) @type)

; A packed cell run is ONE span (`write_header`), a symbol inside `[..]` is one span EACH
; (`write_syms`). Two nodes, same capture, same class.
(tape cells: (identifier) @character)
(symbol) @character

(head_move) @constant.builtin

(comment) @comment

["[" "]"] @punctuation.bracket

; `->` is a DELIMITER here, not an operator. TM emits no `Operator` class at all, and a map row for
; `@operator` would fail `every_capture_row_is_used`.
[":" "," "->"] @punctuation.delimiter
