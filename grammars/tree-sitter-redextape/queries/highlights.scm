; Highlight captures for the redextape mini-language.
;
; THE BROAD `(identifier) @variable` PATTERN AND THE NARROW ONES BELOW IT DELIBERATELY OVERLAP. An
; editor resolves that by override order; `crates/redextape-grammar-check` reads raw query matches
; instead, and resolves it by requiring the overlapping captures to project to the same TokenClass —
; which they do, since every identifier role is `Ident`. Adding a pattern that overlaps an existing
; one with a DIFFERENT class is what that check exists to catch.

; Keywords. `true`/`false` are NOT here: `class_of` in `analysis.rs` maps them to `TokenClass::Bool`.
["fn" "let" "mut" "if" "else" "while"] @keyword

(boolean) @boolean

(number) @number

(comment) @comment

["==" "!=" "<" "<=" ">" ">=" "+" "-" "*" "="] @operator

["(" ")" "{" "}" "[" "]"] @punctuation.bracket

; `.` and `|` are `Punct` in `class_of`, NOT `Operator` — `TokenKind::Dot` and `TokenKind::Pipe` fall
; in the punctuation arm. Capturing either as `@operator` is the single most likely way to fail the
; differential in Task 4.
["," ";" "." "|"] @punctuation.delimiter

; Every identifier, whatever its role. Required: without it, an identifier in a position no narrow
; pattern below names would go uncaptured and the differential would fail on a length mismatch.
(identifier) @variable

; Roles, refining the above for an editor's benefit. All project to `Ident`, so the differential
; cannot tell them apart — design §6.1 states that gap and prices the alternatives.
(call_expression function: (identifier) @function.call)
(method_call method: (identifier) @function.call)
(function_definition name: (identifier) @function)
(parameters parameter: (identifier) @variable.parameter)
