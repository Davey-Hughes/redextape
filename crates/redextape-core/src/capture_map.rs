//! Tree-sitter capture names to `TokenClass`, one table per language.
//!
//! **HERE RATHER THAN IN `redextape-grammar-check`, WHICH IS WHERE THESE TABLES USED TO LIVE.** That
//! crate is test-only and links four generated `parser.c` through a `cc` build script, so nothing that
//! ships can depend on it and nothing in a browser can call it. The tables themselves are neither
//! test-only nor tree-sitter-shaped: they are `&[(&str, TokenClass)]`, pure data, and the web app needs
//! exactly them to colour an editor. Moving them here keeps this crate WASM-clean — no `tree-sitter`
//! dependency arrives with them — and lets `redextape-wasm` export them, so `web/` holds no hand copy.
//!
//! **THE ALTERNATIVE WAS A HAND-WRITTEN TYPESCRIPT MIRROR HELD EQUAL BY A DRIFT TEST, AND IT WAS
//! DECLINED.** A map that disagrees per language in three places is precisely the shape a hand copy
//! gets wrong, and a drift test over a copy is a weaker claim than having no copy. It is the same
//! argument `redextape-wasm`'s `token_classes` and `encodings` already make one layer up: a list of
//! names in another language is a second authoritative registry that not even the compiler is
//! watching.
//!
//! **WHAT STAYS IN `redextape-grammar-check` IS EVERYTHING THAT TIES A TABLE TO A QUERY.** Totality
//! over the shipped `highlights.scm`, and the rule that no row goes unused, need the queries and the
//! grammars; they are tests about a grammar, not facts about a naming map.

use crate::analysis::TokenClass;

/// One language's capture table, keyed by the `languageId` the LSP client sends.
///
/// **KEYED BY `languageId` AND NOT BY GRAMMAR DIRECTORY NAME.** The four ids are already the one name
/// the whole system uses for these languages — the client sends them, `Language::from_language_id`
/// matches them, and a test holds those two sets equal. A second spelling keyed off `grammars/`'s
/// directory names would be a third naming scheme for four things that already have two.
pub struct LanguageCaptures {
    pub language_id: &'static str,
    pub rows: &'static [(&'static str, TokenClass)],
}

/// The mini-language. `@function.call` and `@variable` both project to `Ident`, so the extra
/// granularity on the left is deliberately unchecked by the differential.
pub const REDEXTAPE: &[(&str, TokenClass)] = &[
    ("keyword", TokenClass::Keyword),
    ("boolean", TokenClass::Bool),
    ("number", TokenClass::Nat),
    ("comment", TokenClass::Comment),
    ("operator", TokenClass::Operator),
    ("punctuation.bracket", TokenClass::Punct),
    ("punctuation.delimiter", TokenClass::Punct),
    ("function", TokenClass::Ident),
    ("function.call", TokenClass::Ident),
    ("variable", TokenClass::Ident),
    ("variable.parameter", TokenClass::Ident),
];

/// λ. `@variable.parameter` is a `Binder` here and an `Ident` in the mini-language, because
/// `print_lambda_mapped` folds the bound name into the binder and the mini-language's classifier calls
/// a parameter an identifier. Both are right for their own language.
pub const REDEXTAPE_LAMBDA: &[(&str, TokenClass)] = &[
    ("keyword.function", TokenClass::Binder),
    ("variable.parameter", TokenClass::Binder),
    ("variable", TokenClass::Ident),
    ("punctuation.delimiter", TokenClass::Punct),
    ("punctuation.bracket", TokenClass::Punct),
];

/// TM. `@label.reference` is a `StateName` here and a `Label` in asm, because TM keeps a state name's
/// defining and referencing positions apart and asm folds both label positions into one class.
///
/// **TWO ROWS PROJECT TO `Ident` AND BOTH ARE REQUIRED.** `@variable` is `encoding`'s operand and
/// `@type` is `result`'s; `write_header` classifies both `Ident` because neither an encoding name nor
/// a type has a class of its own. Splitting the capture is what gets `result List<Nat>` coloured as a
/// type in an editor.
///
/// **`@label` AND `@label.reference` ARE THE PAIR DESIGN §5.2 EXISTS FOR** — `Label` for a state name
/// where it is DEFINED, `StateName` for the same name as a `start` or `goto` target. TM is the grammar
/// that pays for that decision, and this is where the two become visible to the differential as
/// distinct.
///
/// There is no `@operator` row: TM emits no `Operator` class, and `->` is `@punctuation.delimiter`.
pub const REDEXTAPE_TM: &[(&str, TokenClass)] = &[
    ("keyword", TokenClass::Keyword),
    ("number", TokenClass::Nat),
    ("label", TokenClass::Label),
    ("label.reference", TokenClass::StateName),
    ("variable", TokenClass::Ident),
    ("type", TokenClass::Ident),
    ("character", TokenClass::TapeSymbol),
    ("constant.builtin", TokenClass::Move),
    ("comment", TokenClass::Comment),
    ("punctuation.bracket", TokenClass::Punct),
    ("punctuation.delimiter", TokenClass::Punct),
];

/// asm. `@function` is a `Mnemonic` here and an `Ident` in the mini-language — the single row that
/// most obviously breaks if the four tables are merged.
///
/// **TWO ROWS PROJECT TO `Label` AND THE DIFFERENTIAL CANNOT TELL THEM APART.** `Operand::class` maps
/// a label operand to `Label` and `print_asm_mapped` pushes `Label` for a declaration too;
/// `TokenClass::StateName` is a TM-only distinction. The captures are kept separate so an editor can
/// theme a definition differently from a reference — the projection map is allowed to be many-to-one.
///
/// **`@comment` HAS NO PRINTER.** `Comment` never appears on the authority side.
///
/// There is no `@punctuation.bracket` row and no `@operator` row: this form has no brackets and emits
/// no `Operator` class.
pub const REDEXTAPE_ASM: &[(&str, TokenClass)] = &[
    ("keyword", TokenClass::Keyword),
    ("type", TokenClass::Ident),
    ("function", TokenClass::Mnemonic),
    ("variable.builtin", TokenClass::Register),
    ("number", TokenClass::Nat),
    ("label", TokenClass::Label),
    ("label.reference", TokenClass::Label),
    ("punctuation.delimiter", TokenClass::Punct),
    ("comment", TokenClass::Comment),
];

/// Every language's table, in the order the protocol lists the ids.
pub static CAPTURE_MAPS: &[LanguageCaptures] = &[
    LanguageCaptures { language_id: "redextape", rows: REDEXTAPE },
    LanguageCaptures { language_id: "redextape_lambda", rows: REDEXTAPE_LAMBDA },
    LanguageCaptures { language_id: "redextape_tm", rows: REDEXTAPE_TM },
    LanguageCaptures { language_id: "redextape_asm", rows: REDEXTAPE_ASM },
];

/// The class a capture projects to in one language, or `None`.
///
/// `None` rather than a fallback class, for both misses. A default would colour a capture nobody
/// mapped, which turns an omission into a quiet miscolouring instead of a visible gap.
#[must_use]
pub fn capture_class(language_id: &str, capture: &str) -> Option<TokenClass> {
    let table = CAPTURE_MAPS.iter().find(|m| m.language_id == language_id)?;
    table.rows.iter().find(|(n, _)| *n == capture).map(|(_, c)| *c)
}

#[cfg(test)]
mod tests {
    use super::{CAPTURE_MAPS, capture_class};
    use crate::analysis::TokenClass;

    /// The four `languageId` strings, in the order the LSP client sends them.
    #[test]
    fn the_four_languages_are_present_and_named_as_the_protocol_names_them() {
        let ids: Vec<_> = CAPTURE_MAPS.iter().map(|m| m.language_id).collect();
        assert_eq!(ids, ["redextape", "redextape_lambda", "redextape_tm", "redextape_asm"]);
    }

    /// **THE THREE DISAGREEMENTS ARE THE REASON THERE ARE FOUR TABLES AND NOT ONE.** A merged table
    /// would have to pick a winner for each of these rows, and every choice mis-colours one language:
    /// an asm mnemonic would read as an identifier, or a λ binder would.
    #[test]
    fn the_tables_disagree_on_exactly_the_three_captures_that_must_disagree() {
        assert_eq!(capture_class("redextape", "function"), Some(TokenClass::Ident));
        assert_eq!(capture_class("redextape_asm", "function"), Some(TokenClass::Mnemonic));
        assert_eq!(capture_class("redextape", "variable.parameter"), Some(TokenClass::Ident));
        assert_eq!(capture_class("redextape_lambda", "variable.parameter"), Some(TokenClass::Binder));
        assert_eq!(capture_class("redextape_tm", "label.reference"), Some(TokenClass::StateName));
        assert_eq!(capture_class("redextape_asm", "label.reference"), Some(TokenClass::Label));
    }

    /// A duplicate key would make the table's meaning depend on lookup order.
    #[test]
    fn no_table_has_a_duplicate_capture_name() {
        for m in CAPTURE_MAPS {
            let mut names: Vec<_> = m.rows.iter().map(|(n, _)| *n).collect();
            names.sort_unstable();
            let before = names.len();
            names.dedup();
            assert_eq!(names.len(), before, "{} has a duplicate capture name", m.language_id);
        }
    }

    /// An unknown language or an unknown capture answers `None` rather than a default class, because a
    /// default would colour a capture nobody mapped and hide the omission.
    #[test]
    fn an_unknown_language_or_capture_answers_none() {
        assert_eq!(capture_class("redextape", "no.such.capture"), None);
        assert_eq!(capture_class("no_such_language", "keyword"), None);
    }

    /// The row counts, so a row deleted by accident is a failure rather than a quieter colouring.
    #[test]
    fn the_row_counts_are_eleven_five_eleven_and_nine() {
        let counts: Vec<_> = CAPTURE_MAPS.iter().map(|m| m.rows.len()).collect();
        assert_eq!(counts, [11, 5, 11, 9]);
    }
}
