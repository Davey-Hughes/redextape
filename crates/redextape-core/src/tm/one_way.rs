//! The two-way → one-way fold: a `Machine` whose tapes are infinite in both directions becomes a
//! `Machine` whose heads never visit a cell left of cell 0, by laying every tape out zig-zag behind a
//! marker and replacing each move with one to three physical steps.
//!
//! **THE LAYOUT.** Physical cell 0 holds [`LEFT_END`]; original cell `j ≥ 0` sits at physical cell
//! `2j + 1` and original cell `-(j + 1)` at physical cell `2j + 2`. An odd physical cell is on the right
//! half and an even one on the left, so [`unzigzag`] recovers a tape with no state from the run.
//!
//! **EACH TAPE'S SIDE LIVES IN THE CONTROL STATE, BECAUSE IT CANNOT LIVE ON THE TAPE.** A move right on
//! the left half is a move toward physical cell 0, so a move needs its tape's half. A cell no head has
//! visited reads `BLANK`, which says nothing about which half it is on, so a generated state stands for
//! a pair `(original state, sides)` instead. Pairs are emitted from a worklist starting at the preamble,
//! so a tape with no `Move::L` rule — which can never reach the left half — multiplies nothing.
//!
//! **RULES ARE COPIED, NOT REWRITTEN.** Reads and writes happen in place, so a pair carries its original
//! state's rules in order with identical reads and writes, and only the moves change. Nothing here
//! enumerates a symbol, which is what the roadmap's two-track fold would have had to do: `Symbol` is a
//! `char`, so a pair of symbols must be one `char`, and no rule can wildcard half of one.
//!
//! **ONE-WAYNESS IS CERTIFIED PER RUN, NOT ARGUED.** `sim.rs`'s `Tape` materializes cells lazily and
//! never discards one, so a head that ever stepped left of physical cell 0 leaves index 0 of every later
//! snapshot holding something other than [`LEFT_END`]: that cell materializes as `BLANK`, and this
//! construction never writes [`LEFT_END`]. [`unzigzag`] returning `Some` on a halted run is that proof.

use std::collections::{HashMap, VecDeque};

use crate::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
use crate::tm::sim::Tape;

/// The marker at physical cell 0 of every folded tape.
///
/// **NOT NAMED `ORIGIN`.** The encodings' comments already use "origin" for a tape's cell 0 — a cell.
/// This is the symbol in one, and two meanings under one name is the drift
/// `scripts/check-attributions.sh` exists downstream of.
pub const LEFT_END: Symbol = '|';

/// One tape in ORIGINAL coordinates: its cells, the head's index into them, and the index of original
/// cell 0. `Tape::snapshot` returns the first two and cannot return the third, because a `Tape` does
/// not know where it started — which is exactly what a comparison needs once one side of it has been
/// folded.
///
/// Named fields rather than a tuple because `head` and `origin` are both `usize`, and a swap between
/// them type-checks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OriginSnapshot {
    pub cells: Vec<Symbol>,
    pub head: usize,
    pub origin: usize,
}

impl OriginSnapshot {
    /// Strip the blanks outside the window spanning every non-blank cell, the head AND the origin, and
    /// re-index both. Two trimmed snapshots are equal exactly when they hold the same symbols at the same
    /// offsets from the origin and put the head at the same offset.
    ///
    /// **THIS IS NOT `single_tape.rs`'s `normalize`, AND THE DIFFERENCE IS THE POINT.** `normalize`
    /// anchors on the non-blank cells alone, so on an all-blank tape it keeps no head position at all —
    /// and on every lowered demo machine `docs/superpowers/specs/2026-09-13-one-way-fold-design.md`
    /// measured, a STACK tape that reaches cell -1 ends all blank. A comparison built on `normalize`
    /// could not see the fold misplace a head on the tapes that exercise it.
    #[must_use]
    pub fn trimmed(&self) -> OriginSnapshot {
        let lo = self.head.min(self.origin);
        let hi = self.head.max(self.origin);
        let first = self.cells.iter().position(|c| *c != BLANK).map_or(lo, |p| p.min(lo));
        let last = self.cells.iter().rposition(|c| *c != BLANK).map_or(hi, |p| p.max(hi));
        let cells = (first..=last).map(|i| self.cells.get(i).copied().unwrap_or(BLANK)).collect();
        OriginSnapshot { cells, head: self.head - first, origin: self.origin - first }
    }
}

/// Lay `tapes` tapes out for a folded machine: [`LEFT_END`], then each initial tape's cells at the odd
/// physical cells, with a blank left-half cell between every two.
///
/// **EXACTLY `tapes` TAPES COME BACK, INCLUDING ANY `inits` DOES NOT NAME.** `trace.rs`'s `TmCursor::new`
/// gives a missing tape a plain `Tape::new(&[])`, which has no marker, and a folded machine's first
/// crossing on such a tape would walk off its left end.
///
/// `None` when an initial tape contains [`LEFT_END`] — `Machine::alphabet` cannot see initial contents,
/// so [`to_one_way`]'s own refusal cannot catch that pairing — or when `inits` holds more tapes than
/// `tapes`, which `single_tape.rs`'s `interleave` documents dropping silently.
#[must_use]
pub fn zigzag(inits: &[Vec<Symbol>], tapes: usize) -> Option<Vec<Vec<Symbol>>> {
    if inits.len() > tapes || inits.iter().flatten().any(|s| *s == LEFT_END) {
        return None;
    }
    let lay_out = |init: &[Symbol]| {
        let mut out = Vec::with_capacity(2 * init.len() + 1);
        out.push(LEFT_END);
        for (j, s) in init.iter().enumerate() {
            if j > 0 {
                out.push(BLANK);
            }
            out.push(*s);
        }
        out
    };
    Some((0..tapes).map(|i| lay_out(inits.get(i).map_or(&[][..], Vec::as_slice))).collect())
}

/// Recover one folded tape in original coordinates.
///
/// `None` when physical cell 0 is not [`LEFT_END`], when [`LEFT_END`] appears in any other materialized
/// cell, or when the head is ON physical cell 0.
///
/// **THE FIRST CONDITION IS THE ONE-WAY CERTIFICATE.** A `Tape` never discards a materialized cell, so a
/// head that ever stepped left of physical cell 0 leaves index 0 of every later snapshot holding something
/// other than [`LEFT_END`]: that cell materializes as `BLANK`, and [`to_one_way`] never writes [`LEFT_END`].
/// The third condition never holds between original steps — the preamble and every move end on physical
/// cell 1 or beyond — but a run stopped by a cap can leave a head there.
#[must_use]
pub fn unzigzag(tape: &Tape) -> Option<OriginSnapshot> {
    let (phys, head) = tape.snapshot();
    let (&marker, rest) = phys.split_first()?;
    if marker != LEFT_END || rest.contains(&LEFT_END) || head == 0 {
        return None;
    }
    // `rest[p - 1]` is physical cell `p`: odd `p` is original `(p - 1) / 2`, even `p` is `-(p / 2)`.
    let negatives = rest.len() / 2;
    let positives = rest.len() - negatives;
    let mut cells = Vec::with_capacity(rest.len());
    for n in (1..=negatives).rev() {
        cells.push(*rest.get(2 * n - 1)?);
    }
    for j in 0..positives {
        cells.push(*rest.get(2 * j)?);
    }
    let head = if head % 2 == 1 { negatives + (head - 1) / 2 } else { negatives - head / 2 };
    Some(OriginSnapshot { cells, head, origin: negatives })
}

/// Whether `m`'s rules name [`LEFT_END`] — the predicate [`to_one_way`]'s refusal is defined as. A rule
/// that wrote the marker could forge the certificate, and one that read it would match the marker as
/// data. Exported so a caller can check before building, rather than string-matching a refused
/// machine's name.
#[must_use]
pub fn left_end_collision(m: &Machine) -> bool {
    m.alphabet().contains(&LEFT_END)
}

/// Generated states per original state. `None` when [`to_one_way`] refuses `m`: a refusal is a
/// one-state machine, and dividing that by the original's state count would report a failure to build
/// as an excellent ratio — the lesson `two_symbol.rs`'s `states_per_original` records.
#[must_use]
pub fn states_per_original(m: &Machine) -> Option<f64> {
    if left_end_collision(m) {
        return None;
    }
    let folded = to_one_way(m);
    #[expect(clippy::cast_precision_loss, reason = "a ratio of state counts, reported to 2 dp")]
    let ratio = folded.states.len() as f64 / m.states.len().max(1) as f64;
    Some(ratio)
}

/// Fold `m` onto one-way tapes over the layout [`zigzag`] builds. The tape count is preserved on a
/// machine this can build.
///
/// **REFUSES RATHER THAN BUILDING SOMETHING IT CANNOT CERTIFY.** When [`left_end_collision`] holds, this
/// returns a one-state, non-accept machine named `left-end-collision` — the shape `single_tape.rs`'s and
/// `two_symbol.rs`'s refusals take, including their fixed tape count of one.
///
/// **A PREAMBLE STARTS THE MACHINE**, stepping every head from [`LEFT_END`] onto physical cell 1, because
/// `Tape::new` starts every head on cell 0 and cell 0 is the marker. It is one state and one step.
#[must_use]
pub fn to_one_way(m: &Machine) -> Machine {
    if left_end_collision(m) {
        return refused("left-end-collision");
    }
    let mut b = Names::new(m.tapes);
    let mut queue = VecDeque::new();
    let pre = b.id("pre");
    let start = b.pair(m.start, &vec![Side::Right; m.tapes], &mut queue);
    let preamble =
        Rule { read: vec![None; m.tapes], write: vec![None; m.tapes], moves: vec![Move::R; m.tapes], next: start };
    b.push_rule(pre, preamble);
    while let Some((sid, sides)) = queue.pop_front() {
        b.emit_pair(m, sid, &sides, &mut queue);
    }
    Machine { states: b.states, start: pre, tapes: m.tapes }
}

/// The degenerate machine [`to_one_way`] returns for a refusal: one named, non-accept state.
fn refused(name: &str) -> Machine {
    Machine { states: vec![State { name: name.into(), accept: false, rules: vec![] }], start: 0, tapes: 1 }
}

/// Which half of a folded tape a head is on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Side {
    Right,
    Left,
}

impl Side {
    fn flipped(self) -> Side {
        match self {
            Side::Right => Side::Left,
            Side::Left => Side::Right,
        }
    }
}

/// `sides` spelled one letter per tape, `r` or `l`, for a state name.
fn spell(sides: &[Side]) -> String {
    sides.iter().map(|s| if *s == Side::Right { 'r' } else { 'l' }).collect()
}

/// `sides` with tape `i` on the other half.
fn with_flip(sides: &[Side], i: usize) -> Vec<Side> {
    let mut out = sides.to_vec();
    if let Some(s) = out.get_mut(i) {
        *s = s.flipped();
    }
    out
}

/// Tape `i`'s side, `Right` past the end of `sides`.
fn side_of(sides: &[Side], i: usize) -> Side {
    sides.get(i).copied().unwrap_or(Side::Right)
}

/// Tape `i`'s move in `rule`, `S` past the end of `rule.moves`. `Machine::validate` requires
/// `moves.len() == tapes`, so no valid machine reaches the default.
fn move_of(rule: &Rule, i: usize) -> Move {
    rule.moves.get(i).copied().unwrap_or(Move::S)
}

/// A move's first physical step. **It depends only on the move and the tape's side**, which is what lets
/// it ride along in the copied rule together with the write, instead of costing a state of its own.
fn first_step(side: Side, mv: Move) -> Move {
    match (side, mv) {
        (_, Move::S) => Move::S,
        (Side::Right, Move::R) | (Side::Left, Move::L) => Move::R,
        (Side::Right, Move::L) | (Side::Left, Move::R) => Move::L,
    }
}

type Queue = VecDeque<(StateId, Vec<Side>)>;

/// Assigns a `StateId` to every generated state name, so rules can name their targets before the target
/// is emitted. Names are the text form's identity and must be unique, non-empty and free of whitespace
/// and `; * : [ ]` (`Machine::validate`), which `.`-separated segments of letters and digits satisfy.
struct Names {
    ids: HashMap<String, StateId>,
    states: Vec<State>,
    tapes: usize,
}

impl Names {
    fn new(tapes: usize) -> Names {
        Names { ids: HashMap::new(), states: Vec::new(), tapes }
    }

    /// The id for `name`, minting the state on first mention.
    fn id(&mut self, name: &str) -> StateId {
        if let Some(id) = self.ids.get(name) {
            return *id;
        }
        let id = StateId::try_from(self.states.len()).unwrap_or(0);
        self.ids.insert(name.to_string(), id);
        self.states.push(State { name: name.to_string(), accept: false, rules: Vec::new() });
        id
    }

    fn push_rule(&mut self, at: StateId, rule: Rule) {
        if let Some(st) = self.states.get_mut(at as usize) {
            st.rules.push(rule);
        }
    }

    /// A rule touching only tape `i`: every other tape reads a wildcard, writes nothing and stays put.
    fn one(&self, i: usize, read: Option<Symbol>, mv: Move, next: StateId) -> Rule {
        let mut rule = Rule {
            read: vec![None; self.tapes],
            write: vec![None; self.tapes],
            moves: vec![Move::S; self.tapes],
            next,
        };
        if let Some(slot) = rule.read.get_mut(i) {
            *slot = read;
        }
        if let Some(slot) = rule.moves.get_mut(i) {
            *slot = mv;
        }
        rule
    }

    /// The state standing for original state `sid` with its tapes on `sides`, queued for emission the
    /// first time it is named. **The only place a pair's name is spelled**, so a rule targeting a pair
    /// and the pair's own emission cannot disagree about it.
    fn pair(&mut self, sid: StateId, sides: &[Side], queue: &mut Queue) -> StateId {
        let name = format!("q{sid}.{}", spell(sides));
        if !self.ids.contains_key(&name) {
            queue.push_back((sid, sides.to_vec()));
        }
        self.id(&name)
    }

    /// Emit the pair `(sid, sides)`: an accept stays an accept with no rules, and every other state
    /// carries a copy of each original rule, in order, with its moves replaced.
    ///
    /// A state with no rules gets none here either, so a stuck halt stays a stuck halt — the reduction
    /// must not invent an accept, which is what makes "the accept flags agree" an assertion. A `sid` past
    /// the end of `m.states` gets no rules for the same reason the simulator halts on one.
    fn emit_pair(&mut self, m: &Machine, sid: StateId, sides: &[Side], queue: &mut Queue) {
        let here = self.pair(sid, sides, queue);
        let Some(st) = m.states.get(sid as usize) else { return };
        if st.accept {
            if let Some(s) = self.states.get_mut(here as usize) {
                s.accept = true;
            }
            return;
        }
        let stem = format!("q{sid}.{}", spell(sides));
        for (c, rule) in st.rules.iter().enumerate() {
            let moving: Vec<usize> = (0..self.tapes).filter(|&i| move_of(rule, i) != Move::S).collect();
            let next = self.finish_moves(&format!("{stem}.c{c}"), rule, &moving, sides, queue);
            let copied = Rule {
                read: (0..self.tapes).map(|i| rule.read.get(i).copied().flatten()).collect(),
                write: (0..self.tapes).map(|i| rule.write.get(i).copied().flatten()).collect(),
                moves: (0..self.tapes).map(|i| first_step(side_of(sides, i), move_of(rule, i))).collect(),
                next,
            };
            self.push_rule(here, copied);
        }
    }

    /// Finish the moves of the tapes in `moving`, whose first physical step the copied rule has already
    /// taken, one tape at a time, and enter the pair for `rule.next`. `cur` is every tape's side so far.
    /// Returns the state to enter.
    ///
    /// | side, move | after step 1 | this emits | side flips |
    /// | --- | --- | --- | --- |
    /// | right, `R` | physical `2j + 2` | `R` | never |
    /// | left, `L` | physical `2j + 3` | `R` | never |
    /// | right, `L` | physical `2j` | reads [`LEFT_END`]? `R`, `R` : `L` | leaving cell 0 |
    /// | left, `R` | physical `2j + 1` | `L`, then reads [`LEFT_END`]? `R` : stay | leaving cell -1 |
    ///
    /// **NEITHER CROSSING STEPS LEFT OF PHYSICAL CELL 0.** From original cell 0 (physical 1) the first
    /// `L` lands on the marker; from original cell -1 (physical 2) the two `L`s do.
    ///
    /// A crossing check has two exits, so each later tape's chain is built once per exit. Every path
    /// through one rule's chain flips a different subset of `moving`, so no `(tape, cur)` is reached twice
    /// and no state is emitted twice.
    fn finish_moves(&mut self, stem: &str, rule: &Rule, moving: &[usize], cur: &[Side], queue: &mut Queue) -> StateId {
        let Some((&i, rest)) = moving.split_first() else {
            return self.pair(rule.next, cur, queue);
        };
        let base = format!("{stem}.t{i}.{}", spell(cur));
        let same = self.finish_moves(stem, rule, rest, cur, queue);
        match (side_of(cur, i), move_of(rule, i)) {
            // Unreachable: `moving` holds only tapes whose move is not `S`.
            (_, Move::S) => same,
            (Side::Right, Move::R) | (Side::Left, Move::L) => {
                let fin = self.id(&format!("{base}.fin"));
                let outward = self.one(i, None, Move::R, same);
                self.push_rule(fin, outward);
                fin
            }
            (Side::Right, Move::L) => {
                let crossed = self.finish_moves(stem, rule, rest, &with_flip(cur, i), queue);
                let chk = self.id(&format!("{base}.chk"));
                let over = self.id(&format!("{base}.over"));
                let on_marker = self.one(i, Some(LEFT_END), Move::R, over);
                self.push_rule(chk, on_marker);
                let inside = self.one(i, None, Move::L, same);
                self.push_rule(chk, inside);
                let onto_minus_one = self.one(i, None, Move::R, crossed);
                self.push_rule(over, onto_minus_one);
                chk
            }
            (Side::Left, Move::R) => {
                let crossed = self.finish_moves(stem, rule, rest, &with_flip(cur, i), queue);
                let inward = self.id(&format!("{base}.in"));
                let chk = self.id(&format!("{base}.chk"));
                let toward = self.one(i, None, Move::L, chk);
                self.push_rule(inward, toward);
                let on_marker = self.one(i, Some(LEFT_END), Move::R, crossed);
                self.push_rule(chk, on_marker);
                let inside = self.one(i, None, Move::S, same);
                self.push_rule(chk, inside);
                inward
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::sim::{DEFAULT_CAPS, Status, simulate_final};
    use crate::tm::single_tape::normalize;
    use proptest::prelude::*;

    fn rule1(read: Option<Symbol>, write: Option<Symbol>, mv: Move, next: StateId) -> Rule {
        Rule { read: vec![read], write: vec![write], moves: vec![mv], next }
    }

    fn accept(name: &str) -> State {
        State { name: name.into(), accept: true, rules: vec![] }
    }

    /// A one-tape machine taking `steps` in order — each a wildcard read, an optional write and a move —
    /// then accepting.
    fn walk(steps: &[(Option<Symbol>, Move)]) -> Machine {
        let mut states: Vec<State> = steps
            .iter()
            .enumerate()
            .map(|(k, (write, mv))| State {
                name: format!("s{k}"),
                accept: false,
                rules: vec![rule1(None, *write, *mv, StateId::try_from(k + 1).unwrap_or(0))],
            })
            .collect();
        states.push(accept("done"));
        Machine { states, start: 0, tapes: 1 }
    }

    /// Every pair state's `sides`, read back from its name `q{sid}.{sides}`. Chain states carry more
    /// dots and the preamble none, so exactly one dot picks out the pairs.
    fn pair_sides(folded: &Machine) -> Vec<String> {
        folded
            .states
            .iter()
            .filter(|s| s.name.starts_with('q') && s.name.matches('.').count() == 1)
            .filter_map(|s| s.name.split_once('.').map(|(_, sides)| sides.to_string()))
            .collect()
    }

    #[test]
    fn zigzag_lays_out_both_halves_and_marks_every_tape() {
        assert_eq!(
            zigzag(&[vec!['a', 'b', 'c']], 2),
            Some(vec![vec![LEFT_END, 'a', BLANK, 'b', BLANK, 'c'], vec![LEFT_END]]),
            "a second tape `inits` does not name still gets its marker"
        );
    }

    #[test]
    fn zigzag_refuses_a_marker_in_the_data_and_a_tape_it_would_drop() {
        assert_eq!(zigzag(&[vec!['a', LEFT_END]], 1), None);
        assert_eq!(zigzag(&[vec![], vec![]], 1), None);
        assert!(zigzag(&[vec!['a']], 1).is_some(), "the refusals above must not be a refusal of everything");
    }

    #[test]
    fn unzigzag_reads_both_halves_back_in_original_order() {
        // One step right, from the marker onto physical cell 1 — what the preamble does, written by hand
        // so this test does not depend on `to_one_way`.
        let step = walk(&[(None, Move::R)]);
        let (tapes, _s, status, _n) = simulate_final(&step, &[vec![LEFT_END, 'a', 'x', 'b', 'y']], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(unzigzag(&tapes[0]), Some(OriginSnapshot { cells: vec!['y', 'x', 'a', 'b'], head: 2, origin: 2 }));
    }

    #[test]
    fn unzigzag_refuses_a_head_on_the_marker_a_missing_marker_and_a_second_marker() {
        assert_eq!(unzigzag(&Tape::new(&[LEFT_END, 'a'])), None, "head on physical cell 0");
        let step = walk(&[(None, Move::R)]);
        for (cells, accepted) in [
            (vec![LEFT_END, 'a', BLANK, 'b'], true),
            (vec!['x', 'a', BLANK, 'b'], false),
            (vec![LEFT_END, 'a', LEFT_END, 'b'], false),
        ] {
            let (tapes, _s, status, _n) = simulate_final(&step, std::slice::from_ref(&cells), DEFAULT_CAPS);
            assert_eq!(status, Status::Halted);
            assert_eq!(unzigzag(&tapes[0]).is_some(), accepted, "for {cells:?}");
        }
    }

    #[test]
    fn trimmed_keeps_the_head_where_normalize_discards_it() {
        let a = OriginSnapshot { cells: vec![BLANK; 5], head: 1, origin: 3 };
        let b = OriginSnapshot { cells: vec![BLANK; 5], head: 3, origin: 3 };
        assert_eq!(normalize(&a.cells, a.head), normalize(&b.cells, b.head), "the blind spot `trimmed` exists for");
        assert_ne!(a.trimmed(), b.trimmed());
        assert_eq!(a.trimmed(), OriginSnapshot { cells: vec![BLANK; 3], head: 0, origin: 2 });
    }

    #[test]
    fn an_accepting_start_state_halts_after_the_preamble_alone() {
        let m = Machine { states: vec![accept("done")], start: 0, tapes: 1 };
        let folded = to_one_way(&m);
        assert_eq!(folded.validate(), Vec::<String>::new());
        let cells = zigzag(&[vec!['a', 'b']], 1).expect("no marker in the data");
        let (tapes, state, status, steps) = simulate_final(&folded, &cells, DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(steps, 1, "the preamble is the only step");
        assert!(folded.states[state as usize].accept, "halted in `{}`", folded.states[state as usize].name);
        let back = unzigzag(&tapes[0]).expect("the preamble leaves the head on physical cell 1");
        assert_eq!(back.trimmed(), OriginSnapshot { cells: vec!['a', 'b'], head: 0, origin: 0 });
    }

    #[test]
    fn a_stuck_original_stays_stuck_and_does_not_become_an_accept() {
        let m = Machine { states: vec![State { name: "s0".into(), accept: false, rules: vec![] }], start: 0, tapes: 1 };
        let folded = to_one_way(&m);
        assert_eq!(folded.validate(), Vec::<String>::new());
        let (_t, state, status, _n) = simulate_final(&folded, &[vec![LEFT_END]], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert!(!folded.states[state as usize].accept, "halted in an ACCEPT, but the original is stuck");
    }

    /// Every move row, both crossings and a left excursion three cells deep, against a final tape derived
    /// by hand — and the hand derivation checked against the unfolded run, so a wrong expectation cannot
    /// pass as a right construction.
    ///
    /// Write `x` walking left three cells from cell 0, then `y` walking right five: cells -3..=1 end `y`,
    /// the head ends on cell 2, and the original tape grew three cells on its left.
    #[test]
    fn a_toy_machine_matches_its_fold_cell_for_cell_across_the_origin() {
        let x = Some('x');
        let y = Some('y');
        let m = walk(&[
            (x, Move::L),
            (x, Move::L),
            (x, Move::L),
            (y, Move::R),
            (y, Move::R),
            (y, Move::R),
            (y, Move::R),
            (y, Move::R),
        ]);
        let inits = vec![vec!['a', 'b']];
        let expected = OriginSnapshot { cells: vec!['y', 'y', 'y', 'y', 'y', BLANK], head: 5, origin: 3 }.trimmed();

        let (want, _ws, want_status, _wn) = simulate_final(&m, &inits, DEFAULT_CAPS);
        assert_eq!(want_status, Status::Halted);
        let (w_cells, w_head) = want[0].snapshot();
        assert_eq!(
            OriginSnapshot { cells: w_cells, head: w_head, origin: 3 }.trimmed(),
            expected,
            "the hand derivation"
        );

        let folded = to_one_way(&m);
        assert_eq!(folded.validate(), Vec::<String>::new());
        let cells = zigzag(&inits, 1).expect("no marker in the data");
        let (got, state, status, _n) = simulate_final(&folded, &cells, DEFAULT_CAPS);
        let back = unzigzag(&got[0]).expect("the certificate: the fold never stepped left of physical cell 0");
        assert_eq!(status, Status::Halted);
        assert_eq!(back.trimmed(), expected);
        assert!(folded.states[state as usize].accept, "halted in `{}`", folded.states[state as usize].name);
    }

    #[test]
    fn a_machine_naming_the_marker_is_refused_and_has_no_ratio() {
        let m = walk(&[(Some(LEFT_END), Move::R)]);
        assert!(left_end_collision(&m));
        let folded = to_one_way(&m);
        assert_eq!(folded.states.len(), 1, "a refusal is the degenerate one-state machine, not a partial build");
        assert!(!folded.states[0].accept, "a refusal must not be an accept");
        assert_eq!(folded.states[0].name, "left-end-collision");
        assert_eq!(states_per_original(&m), None, "a refusal must not be reported as a ratio");
        assert!(states_per_original(&walk(&[(Some('a'), Move::R)])).is_some(), "and a clean machine has one");
    }

    /// Tape 0 crosses into the left half; tape 1 only ever moves right, so no reachable pair may put it on
    /// the left — the property that keeps the multiplier at `2^(tapes with a Move::L rule)` rather than
    /// `2^tapes`.
    #[test]
    fn a_tape_with_no_left_move_is_never_on_the_left_half() {
        let m = Machine {
            states: vec![
                State {
                    name: "s0".into(),
                    accept: false,
                    rules: vec![Rule {
                        read: vec![None, None],
                        write: vec![None, None],
                        moves: vec![Move::L, Move::R],
                        next: 1,
                    }],
                },
                accept("done"),
            ],
            start: 0,
            tapes: 2,
        };
        let sides = pair_sides(&to_one_way(&m));
        assert!(sides.iter().any(|s| s.starts_with('l')), "the fixture must put tape 0 on the left: {sides:?}");
        assert!(sides.iter().all(|s| s.chars().nth(1) == Some('r')), "tape 1 reached the left half: {sides:?}");
    }

    proptest! {
        /// The round trip through the real preamble: fold arbitrary tapes, run a machine that accepts at
        /// once, and every tape comes back. Compared trimmed, because `zigzag` materializes a blank
        /// left-half cell between every two content cells, so `unzigzag` alone reports an origin past 0.
        #[test]
        fn zigzag_then_the_preamble_then_unzigzag_gives_the_tapes_back(
            tapes in prop::collection::vec(prop::collection::vec(prop::sample::select(vec!['a', 'b', BLANK]), 0..6), 1..4)
        ) {
            let m = Machine { states: vec![accept("done")], start: 0, tapes: tapes.len() };
            let folded = to_one_way(&m);
            let cells = zigzag(&tapes, tapes.len()).expect("no marker in the data");
            let (got, _s, status, _n) = simulate_final(&folded, &cells, DEFAULT_CAPS);
            prop_assert_eq!(status, Status::Halted);
            for (i, tape) in tapes.iter().enumerate() {
                let back = unzigzag(&got[i]).expect("the preamble leaves every head on physical cell 1");
                prop_assert_eq!(back.trimmed(), OriginSnapshot { cells: tape.clone(), head: 0, origin: 0 }.trimmed());
            }
        }
    }

    fn demo_machine(src: &str, enc: crate::tm::EncodingKind) -> (Machine, Vec<Vec<Symbol>>) {
        let (prog, ds) = crate::parser::parse(src);
        assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
        let prog = prog.expect("a program");
        let ty = crate::typeck::result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
        let core = crate::desugar::desugar(&prog);
        let d = crate::tm::run_tm_described(&core, enc, ty, crate::tm::TM_DEFAULT_CAPS)
            .unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
        let init = d.header.init(d.machine.tapes);
        (d.machine, init)
    }

    /// The ratio [`to_one_way`] may not exceed on the corpus below, as a PROPERTY rather than a restated
    /// measurement: an oracle leg can never redden for a cost regression, because a bloated-but-correct
    /// construction is still correct. Set above the highest ratio that corpus measured when this module
    /// was written, and each row prints its margin in STATES, because a percentage does not say whether
    /// the next generated state is the one that trips it.
    ///
    /// **NOT A CEILING EVERY SHIPPED MACHINE MEETS.** The largest shipped demo — `single_tape.rs`'s
    /// `the_worst_shipped_demo_measured_directly` builds it — has four tapes with a `Move::L` rule where
    /// this corpus has two or three, and folded to 7,363,253 states against `MAX_MACHINE_STATES` of
    /// 1,000,000 when measured on 2026-09-13. That is recorded in the roadmap entry, not gated here.
    const STATE_CEILING: f64 = 40.0;

    /// Also prints, per row, how many `sides` combinations the worklist reached against `2^n` for `n`
    /// tapes with a `Move::L` rule — whether emitting only reachable pairs saves anything is a
    /// measurement, not a promise.
    #[test]
    fn the_fold_stays_under_its_state_ceiling() {
        for src in
            ["1 + 2 * 3", "cons(1, cons(2, nil))", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"]
        {
            for enc in [crate::tm::EncodingKind::Unary, crate::tm::EncodingKind::Binary] {
                let (m, _inits) = demo_machine(src, enc);
                let ratio = states_per_original(&m).expect("no lowered machine names the marker");
                let folded = to_one_way(&m);
                let mut sides = pair_sides(&folded);
                sides.sort();
                sides.dedup();
                let lefty = (0..m.tapes)
                    .filter(|&i| m.states.iter().flat_map(|s| &s.rules).any(|r| move_of(r, i) == Move::L))
                    .count();
                #[expect(clippy::cast_precision_loss, reason = "a state count, in a states margin")]
                let margin = (STATE_CEILING - ratio) * m.states.len() as f64;
                println!(
                    "{src:60} {enc:?} states {} -> {} ratio {ratio:.6} sides {} of 2^{lefty} margin {margin:.0} states",
                    m.states.len(),
                    folded.states.len(),
                    sides.len()
                );
                assert!(ratio < STATE_CEILING, "{src} at {enc:?} measures {ratio:.6} against {STATE_CEILING}");
            }
        }
    }
}
