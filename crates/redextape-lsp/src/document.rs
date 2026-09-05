//! The open documents, one `LineIndex` per version.
//!
//! `textDocumentSync` is `FULL` in slice 1, so "update" means "replace": these files are small, and
//! incremental sync is an optimization that buys a class of bugs before it buys anything else.
//! `replace` rebuilding the whole index is the honest cost of that choice and the reason it is one
//! line.

use std::collections::HashMap;

use crate::language::Language;
use crate::position::LineIndex;

/// One open document, at one version.
pub struct Document {
    /// `None` for a `languageId` this server does not serve. The document is still tracked — see
    /// `Language::from_language_id` for why answering is better than guessing.
    pub language: Option<Language>,
    pub version: i32,
    pub text: String,
    pub index: LineIndex,
}

impl Document {
    #[must_use]
    pub fn new(language_id: &str, version: i32, text: String) -> Self {
        let index = LineIndex::new(&text);
        Document { language: Language::from_language_id(language_id), version, text, index }
    }

    /// Replace the whole text. Under `FULL` sync this is the only update there is.
    pub fn replace(&mut self, version: i32, text: String) {
        self.index = LineIndex::new(&text);
        self.text = text;
        self.version = version;
    }
}

/// Every open document, keyed by URI string.
///
/// The key is the URI as the client spelled it, not a parsed URL. `gen-lsp-types` under default
/// features makes `Uri` a newtype over `String`, and nothing here needs a scheme, a host or a
/// path — only that the same buffer comes back under the same key.
#[derive(Default)]
pub struct Documents(HashMap<String, Document>);

impl Documents {
    pub fn open(&mut self, uri: String, language_id: &str, version: i32, text: String) {
        self.0.insert(uri, Document::new(language_id, version, text));
    }

    #[must_use]
    pub fn get(&self, uri: &str) -> Option<&Document> {
        self.0.get(uri)
    }

    /// Replace an open document's text. A URI that was never opened is left alone: a `didChange`
    /// with no `didOpen` behind it is a client bug, and inventing a document with no `languageId`
    /// would start answering questions about a file nobody described.
    pub fn replace(&mut self, uri: &str, version: i32, text: String) {
        if let Some(doc) = self.0.get_mut(uri) {
            doc.replace(version, text);
        }
    }

    pub fn close(&mut self, uri: &str) {
        self.0.remove(uri);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::position::Encoding;

    #[test]
    fn a_document_is_opened_replaced_and_closed_under_its_uri() {
        let mut docs = Documents::default();
        assert!(docs.get("file:///a.tm").is_none());

        docs.open("file:///a.tm".to_string(), "redextape_tm", 1, "tapes 1\n".to_string());
        let d = docs.get("file:///a.tm").expect("just opened");
        assert_eq!(d.language, Some(Language::Tm));
        assert_eq!(d.version, 1);
        assert_eq!(d.text, "tapes 1\n");

        docs.replace("file:///a.tm", 2, "tapes 2\n\n".to_string());
        let d = docs.get("file:///a.tm").expect("still open");
        assert_eq!(d.version, 2);
        assert_eq!(d.text, "tapes 2\n\n");
        // The index moved with the text: the new file has three line starts, the old had two.
        assert_eq!(d.index.end_position(&d.text, Encoding::Utf8), gen_lsp_types::Position::new(2, 0));

        docs.close("file:///a.tm");
        assert!(docs.get("file:///a.tm").is_none());
    }

    #[test]
    fn replacing_a_document_that_was_never_opened_does_nothing() {
        // A `didChange` for a URI with no `didOpen` is a client bug, not a reason to invent a
        // document with no `languageId` and start answering questions about it.
        let mut docs = Documents::default();
        docs.replace("file:///ghost.tm", 1, "tapes 1\n".to_string());
        assert!(docs.get("file:///ghost.tm").is_none());
    }

    #[test]
    fn an_unknown_language_id_is_tracked_with_no_language() {
        let mut docs = Documents::default();
        docs.open("file:///a.rs".to_string(), "rust", 1, "fn main() {}\n".to_string());
        let d = docs.get("file:///a.rs").expect("tracked anyway");
        assert_eq!(d.language, None);
        assert_eq!(d.text, "fn main() {}\n");
    }
}
