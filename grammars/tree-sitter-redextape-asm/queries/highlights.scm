; Highlight queries for the Redextape asm text form.
;
; THESE MUST BE TOTAL OVER THE GRAMMAR'S OWN TOKENS. `print_asm_mapped` pushes a span for EVERY
; non-whitespace byte it writes — the `:` after a label and the `,` between operands included — so a
; token this file leaves uncaptured becomes a length mismatch in the differential rather than merely
; an uncoloured character. The four-space indent, the `\t` before the first operand and the space
; after each `,` belong to no span and there is nothing here to capture them with.
;
; NOTHING OVERLAPS. A mnemonic, a register and an immediate are each their own token; the two
; identifier roles are told apart by the FIELD they sit in. Resist adding a broad
; `(identifier) @variable` catch-all — it would land on the same byte range as the field-scoped
; patterns and ask for the wrong class where the printer disagrees. `tests/asm.rs`'s
; `a_conflicting_query_is_rejected` demonstrates exactly that failure with `(identifier) @type` —
; asm has no bare `variable` capture row, so `@type` is the row that actually lands on a label's
; span and asks for `Ident` where the printer says `Label`.

"result" @keyword
(result type: (identifier) @type)

[
  "li" "mov"
  "add" "sub" "mul" "cmpeq" "cmpne" "cmplt" "cmple" "cmpgt" "cmpge"
  "jz" "jmp" "call"
  "ret" "halt"
  "nil" "cons" "head" "tail" "isempty"
  "box" "box_get" "box_set"
] @function

(register) @variable.builtin
(immediate) @number

; A label name in DEFINING position and the same name as a jump target BOTH project to
; `TokenClass::Label` — unlike TM, where the printer distinguishes `Label` from `StateName`. The two
; captures are kept apart anyway so an editor can theme a definition differently from a reference,
; and `tests/asm.rs`'s `each_label_capture_lands_on_its_own_positions` is what checks they have not
; been swapped, because the differential structurally cannot.
(label name: (identifier) @label)
(branch_instruction target: (identifier) @label.reference)
(jump_instruction target: (identifier) @label.reference)

(comment) @comment

; `:` ends a label declaration and `,` separates operands. There are no brackets in this form and no
; `Operator` class, so this is the only punctuation row.
[":" ","] @punctuation.delimiter
