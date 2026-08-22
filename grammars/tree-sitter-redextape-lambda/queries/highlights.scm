; Highlight captures for the redextape λ text form.
;
; Five capture sites, matching `print_lambda_mapped`'s five `push_span` calls exactly. The binder head
; and the name it binds are BOTH `Binder` — that is the printer's rule, not a simplification here.

["\\" "λ"] @keyword.function

(abstraction parameter: (identifier) @variable.parameter)

"." @punctuation.delimiter

["(" ")"] @punctuation.bracket

; Every other identifier is an occurrence. Ordered after the parameter pattern; the two overlap on a
; binder's name, and `captures_with` requires overlapping captures to agree — they do NOT here, so
; this pattern must NOT match a parameter. Scope it to the positions a variable occurrence can hold.
;
; That set is exhaustive against `grammar.js`: `identifier` is reachable only through the hidden
; `_atom` rule (`choice($.parenthesized_term, $.identifier)`), and `_atom` appears in exactly three
; places — `application`'s `function` field, `application`'s `argument` field (both directly), and
; the hidden `_term` rule, which itself appears in exactly three places — `source_file`,
; `abstraction`'s `body` field, and inside `parenthesized_term`. Five positions total; the parameter
; field is not one of them, since it is typed `$.identifier` directly, never through `_atom`.
(application function: (identifier) @variable)
(application argument: (identifier) @variable)
(parenthesized_term (identifier) @variable)
(abstraction body: (identifier) @variable)
(source_file (identifier) @variable)
