//! The register machine's heap: cons cells, boxes, the cap on each and the eight faults, decided here so
//! that every runtime holding one agrees. A pointer is 1-based and `0` is nil, the empty list or the null
//! handle; an allocation returns its arena's length after the push.
//!
//! **THE HEAP DECIDES; THE TAGS ONLY RECORD.** A `Tags` recorder keeps a tag beside each word for a view
//! to show. Every check is made on the arenas alone and the recorder is touched only once it passes, so
//! no tag can change a word, a fault or a cap. `NoTags` records nothing and is zero-sized, for a caller with no view.
//!
//! Everything but the test-only `tags_mut` is `#[inline]` so that a runtime calling it once per heap
//! instruction from another crate may inline it.

use std::fmt;

/// A fault an access raises. Its `Display` is the message a run reports, word for word.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HeapFault {
    HeadOfEmpty,
    HeadOfInvalid,
    TailOfEmpty,
    TailOfInvalid,
    BoxGetOfNull,
    BoxGetOfInvalid,
    BoxSetOfNull,
    BoxSetOfInvalid,
}

impl fmt::Display for HeapFault {
    #[inline]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            HeapFault::HeadOfEmpty => "head of empty list",
            HeapFault::HeadOfInvalid => "head of invalid list pointer",
            HeapFault::TailOfEmpty => "tail of empty list",
            HeapFault::TailOfInvalid => "tail of invalid list pointer",
            HeapFault::BoxGetOfNull => "box_get of null handle",
            HeapFault::BoxGetOfInvalid => "box_get of invalid handle",
            HeapFault::BoxSetOfNull => "box_set of null handle",
            HeapFault::BoxSetOfInvalid => "box_set of invalid handle",
        })
    }
}

/// An allocation the cap refused. Cells and boxes share the cap's value, not a count: each arena is
/// held to it alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HeapCapped;

/// What a heap records beside its words, one `Word` per word. A tag asked for past what was recorded
/// reads as the recorder's default.
pub trait Tags {
    type Word: Copy;
    fn push_cell(&mut self, head: Self::Word, tail: Self::Word);
    /// Cell `i`'s head and tail tags.
    fn cell(&self, i: usize) -> (Self::Word, Self::Word);
    fn push_box(&mut self, tag: Self::Word);
    fn box_tag(&self, i: usize) -> Self::Word;
    /// Box `i`'s new tag, growing the record to reach `i`.
    fn set_box(&mut self, i: usize, tag: Self::Word);
}

/// The recorder for a caller with no view.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoTags;

impl Tags for NoTags {
    type Word = ();
    #[inline]
    fn push_cell(&mut self, (): (), (): ()) {}
    #[inline]
    fn cell(&self, _: usize) -> ((), ()) {
        ((), ())
    }
    #[inline]
    fn push_box(&mut self, (): ()) {}
    #[inline]
    fn box_tag(&self, _: usize) {}
    #[inline]
    fn set_box(&mut self, _: usize, (): ()) {}
}

/// A tag per word, in vectors parallel to the arenas.
#[derive(Clone, Debug, Default)]
pub struct VecTags<W> {
    pub cells: Vec<(W, W)>,
    pub boxes: Vec<W>,
}

impl<W: Copy + Default> Tags for VecTags<W> {
    type Word = W;
    #[inline]
    fn push_cell(&mut self, head: W, tail: W) {
        self.cells.push((head, tail));
    }
    #[inline]
    fn cell(&self, i: usize) -> (W, W) {
        self.cells.get(i).copied().unwrap_or_default()
    }
    #[inline]
    fn push_box(&mut self, tag: W) {
        self.boxes.push(tag);
    }
    #[inline]
    fn box_tag(&self, i: usize) -> W {
        self.boxes.get(i).copied().unwrap_or_default()
    }
    #[inline]
    fn set_box(&mut self, i: usize, tag: W) {
        if i >= self.boxes.len() {
            self.boxes.resize(i + 1, W::default());
        }
        if let Some(slot) = self.boxes.get_mut(i) {
            *slot = tag;
        }
    }
}

/// The cells and boxes, and the recorder `R` beside them.
#[derive(Clone, Debug, Default)]
pub struct Heap<R> {
    cells: Vec<(u64, u64)>,
    boxes: Vec<u64>,
    tags: R,
}

impl<R: Tags> Heap<R> {
    /// A new cell's pointer.
    ///
    /// # Errors
    /// `HeapCapped` when `cap` cells exist already.
    #[inline]
    pub fn cons(
        &mut self,
        cap: u64,
        (head, ht): (u64, R::Word),
        (tail, tt): (u64, R::Word),
    ) -> Result<u64, HeapCapped> {
        if self.cells.len() as u64 >= cap {
            return Err(HeapCapped);
        }
        self.cells.push((head, tail));
        self.tags.push_cell(ht, tt);
        Ok(self.cells.len() as u64)
    }

    /// The head of the cell `p` names, and its tag.
    ///
    /// # Errors
    /// `HeadOfEmpty` for `0`; `HeadOfInvalid` for a pointer past the last cell.
    #[inline]
    pub fn head(&self, p: u64) -> Result<(u64, R::Word), HeapFault> {
        let i = index(p, HeapFault::HeadOfEmpty, HeapFault::HeadOfInvalid)?;
        let &(head, _) = self.cells.get(i).ok_or(HeapFault::HeadOfInvalid)?;
        Ok((head, self.tags.cell(i).0))
    }

    /// The tail of the cell `p` names, and its tag.
    ///
    /// # Errors
    /// `TailOfEmpty` for `0`; `TailOfInvalid` for a pointer past the last cell.
    #[inline]
    pub fn tail(&self, p: u64) -> Result<(u64, R::Word), HeapFault> {
        let i = index(p, HeapFault::TailOfEmpty, HeapFault::TailOfInvalid)?;
        let &(_, tail) = self.cells.get(i).ok_or(HeapFault::TailOfInvalid)?;
        Ok((tail, self.tags.cell(i).1))
    }

    /// A new box's handle.
    ///
    /// # Errors
    /// `HeapCapped` when `cap` boxes exist already.
    #[inline]
    pub fn new_box(&mut self, cap: u64, (value, tag): (u64, R::Word)) -> Result<u64, HeapCapped> {
        if self.boxes.len() as u64 >= cap {
            return Err(HeapCapped);
        }
        self.boxes.push(value);
        self.tags.push_box(tag);
        Ok(self.boxes.len() as u64)
    }

    /// The word in the box `p` names, and its tag.
    ///
    /// # Errors
    /// `BoxGetOfNull` for `0`; `BoxGetOfInvalid` for a handle past the last box.
    #[inline]
    pub fn box_get(&self, p: u64) -> Result<(u64, R::Word), HeapFault> {
        let i = index(p, HeapFault::BoxGetOfNull, HeapFault::BoxGetOfInvalid)?;
        let &value = self.boxes.get(i).ok_or(HeapFault::BoxGetOfInvalid)?;
        Ok((value, self.tags.box_tag(i)))
    }

    /// Overwrite the box `p` names, word and tag.
    ///
    /// # Errors
    /// `BoxSetOfNull` for `0`; `BoxSetOfInvalid` for a handle past the last box. A fault writes nothing.
    #[inline]
    pub fn box_set(&mut self, p: u64, (value, tag): (u64, R::Word)) -> Result<(), HeapFault> {
        let i = index(p, HeapFault::BoxSetOfNull, HeapFault::BoxSetOfInvalid)?;
        *self.boxes.get_mut(i).ok_or(HeapFault::BoxSetOfInvalid)? = value;
        self.tags.set_box(i, tag);
        Ok(())
    }

    /// The cells, in allocation order; pointer `p` names cell `p - 1`.
    #[inline]
    #[must_use]
    pub fn cells(&self) -> &[(u64, u64)] {
        &self.cells
    }

    /// The boxes, in allocation order; handle `p` names box `p - 1`.
    #[inline]
    #[must_use]
    pub fn boxes(&self) -> &[u64] {
        &self.boxes
    }

    #[inline]
    #[must_use]
    pub fn tags(&self) -> &R {
        &self.tags
    }

    #[cfg(test)]
    pub(crate) fn tags_mut(&mut self) -> &mut R {
        &mut self.tags
    }

    /// The cells alone, which is what decoding a result needs.
    #[inline]
    #[must_use]
    pub fn into_cells(self) -> Vec<(u64, u64)> {
        self.cells
    }
}

/// The arena index `p` names, before the arena's own bounds check. `p` is a word a program can set to any
/// `u64`, so on a 32-bit target `p - 1` may not fit `usize`; `try_from` makes that the same invalid fault
/// as a pointer past the end, where `as` would truncate it into a wrong, in-range index.
#[inline]
fn index(p: u64, null: HeapFault, invalid: HeapFault) -> Result<usize, HeapFault> {
    if p == 0 {
        return Err(null);
    }
    usize::try_from(p - 1).map_err(|_| invalid)
}

/// Whether list `p` is empty. Nothing is looked up, so it never faults.
#[inline]
#[must_use]
pub const fn is_empty(p: u64) -> bool {
    p == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use HeapFault::*;

    #[test]
    fn each_fault_reads_as_its_message() {
        let messages = [
            (HeadOfEmpty, "head of empty list"),
            (HeadOfInvalid, "head of invalid list pointer"),
            (TailOfEmpty, "tail of empty list"),
            (TailOfInvalid, "tail of invalid list pointer"),
            (BoxGetOfNull, "box_get of null handle"),
            (BoxGetOfInvalid, "box_get of invalid handle"),
            (BoxSetOfNull, "box_set of null handle"),
            (BoxSetOfInvalid, "box_set of invalid handle"),
        ];
        for (fault, message) in messages {
            assert_eq!(fault.to_string(), message);
        }
    }

    /// Each arena is held to the cap alone: full cells leave room for boxes, and a refused allocation
    /// leaves its arena as it was.
    #[test]
    fn a_cap_of_two_admits_two_cells_and_two_boxes_and_refuses_the_third() {
        let mut heap = Heap::<NoTags>::default();
        assert_eq!((heap.cons(2, (10, ()), (0, ())), heap.cons(2, (11, ()), (1, ()))), (Ok(1), Ok(2)));
        assert_eq!(heap.cons(2, (12, ()), (2, ())), Err(HeapCapped));
        assert_eq!((heap.new_box(2, (20, ())), heap.new_box(2, (21, ()))), (Ok(1), Ok(2)));
        assert_eq!(heap.new_box(2, (22, ())), Err(HeapCapped));
        assert_eq!((heap.cells(), heap.boxes()), (&[(10, 0), (11, 1)][..], &[20, 21][..]));
        assert_eq!(std::mem::size_of::<NoTags>(), 0);
    }

    /// Past an arena's end, up to `u64::MAX`, a pointer is invalid, never a panic. `(1 << 32) + 1` is for a 32-bit
    /// run, where an `as` cast would wrap it onto pointer 1's cell or box; on a 64-bit host it is only past the end.
    #[test]
    fn null_and_out_of_range_pointers_fault_by_name() {
        let mut heap = Heap::<NoTags>::default();
        assert_eq!((heap.cons(1, (7, ()), (0, ())), heap.new_box(1, (8, ()))), (Ok(1), Ok(1)));
        for p in [2, (1 << 32) + 1, u64::MAX] {
            assert_eq!((heap.head(p), heap.tail(p)), (Err(HeadOfInvalid), Err(TailOfInvalid)), "{p}");
            assert_eq!((heap.box_get(p), heap.box_set(p, (9, ()))), (Err(BoxGetOfInvalid), Err(BoxSetOfInvalid)));
        }
        assert_eq!((heap.head(0), heap.tail(0)), (Err(HeadOfEmpty), Err(TailOfEmpty)));
        assert_eq!((heap.box_get(0), heap.box_set(0, (9, ()))), (Err(BoxGetOfNull), Err(BoxSetOfNull)));
        assert_eq!((heap.head(1), heap.tail(1), heap.box_get(1)), (Ok((7, ())), Ok((0, ())), Ok((8, ()))));
        assert_eq!(heap.boxes(), &[8]);
        assert!(is_empty(0) && !is_empty(1) && !is_empty(u64::MAX));
    }

    #[test]
    fn tags_pushed_are_read_back_and_a_missing_tag_reads_as_default() {
        let mut heap = Heap::<VecTags<u8>>::default();
        assert_eq!((heap.cons(4, (7, 1), (0, 2)), heap.new_box(4, (8, 3))), (Ok(1), Ok(1)));
        assert_eq!((heap.head(1), heap.tail(1), heap.box_get(1)), (Ok((7, 1)), Ok((0, 2)), Ok((8, 3))));
        assert_eq!((&heap.tags().cells[..], &heap.tags().boxes[..]), (&[(1, 2)][..], &[3][..]));
        heap.tags_mut().cells.clear();
        heap.tags_mut().boxes.clear();
        assert_eq!((heap.head(1), heap.tail(1), heap.box_get(1)), (Ok((7, 0)), Ok((0, 0)), Ok((8, 0))));
    }

    #[test]
    fn box_set_past_the_tag_vectors_end_grows_it() {
        let mut heap = Heap::<VecTags<u8>>::default();
        assert_eq!((heap.new_box(4, (8, 3)), heap.new_box(4, (9, 4))), (Ok(1), Ok(2)));
        heap.tags_mut().boxes.clear();
        assert_eq!(heap.box_set(2, (5, 6)), Ok(()));
        assert_eq!(heap.tags().boxes, [0, 6]);
        assert_eq!((heap.box_get(1), heap.box_get(2), heap.boxes()), (Ok((8, 0)), Ok((5, 6)), &[8, 5][..]));
    }
}
