//! Byte-offset source spans. All positions are byte offsets into the original `&str`, so slicing
//! `src[span.start..span.end]` recovers the exact source text.

/// A half-open byte range `[start, end)` into the source string.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

impl Span {
    pub fn new(start: usize, end: usize) -> Self {
        debug_assert!(start <= end, "span start must not exceed end");
        Span { start, end }
    }

    /// The smallest span covering both `self` and `other`.
    pub fn merge(self, other: Span) -> Span {
        Span::new(self.start.min(other.start), self.end.max(other.end))
    }
}
