//! The alphabet reduction: a `Machine` over any alphabet becomes a `Machine` over **two symbols**,
//! by giving every symbol a fixed-width block of cells and simulating each step as a bit-by-bit
//! comparison against one candidate rule's pattern.
//!
//! **THE BLANK IS THE ZERO BIT, AND THAT IS FORCED RATHER THAN CHOSEN.** `BLANK` is a fixed const
//! and `Tape` materializes cells lazily, so an unvisited cell reads it and no construction can
//! change that. A machine whose alphabet were literally `{'0', '1'}` would read a THIRD symbol the
//! moment a head stepped past its written region. So the two symbols are [`ZERO`] (which IS `BLANK`)
//! and [`ONE`], and `Code` gives `BLANK` the all-zeros pattern: an unwritten region is an infinite
//! run of zero bits and must decode back to the run of blanks the original tape has there.
//!
//! **NOTHING HERE IS NAMED `binary`.** `tm/encoding/binary.rs` already owns that name for a
//! different axis — how a NUMBER is represented in a field, against how a SYMBOL is represented in
//! cells. The two compose freely and disagree about which is smaller: `EncodingKind::Binary` makes
//! the tape ALPHABET larger (`#@_01` against unary's `#@_`), which can widen this reduction's block
//! width `k` — but only for a program whose lowering actually reaches the extra symbols, so the
//! effect is occasional rather than a per-symbol cost every program pays.
//! `two_symbol_oracle.rs`'s `the_leg_holds_where_the_encoding_widens_the_alphabet` measures and
//! scopes the case where it does.
//!
//! **THERE ARE NO RESERVED SYMBOLS, WHICH IS THE LARGEST SIMPLIFICATION OVER `single_tape`.** Every
//! cell of a reduced tape is a bit, so nothing of the original alphabet survives to collide with the
//! layout, and the tapes stay two-way infinite. The hazard here is COVERAGE, not collision: `code`
//! must encode every symbol in `m.alphabet()`, and [`uncovered_symbol`] is that predicate's callable
//! form, checked internally before `to_two_symbol` builds — the same way `to_single_tape` checks
//! `single_tape.rs`'s `layout_collision(m, &[])` before building. **The parallel stops there.**
//! `layout_collision(m, inits)` also takes `inits`, so a caller can call it separately to catch a
//! hazard arriving only through initial tape contents, which the `m, &[]` call inside `to_single_tape`
//! cannot see on its own. [`uncovered_symbol`] takes no `inits` at all, so it cannot see that hazard
//! either — for the composed leg, only a runtime [`bitify`] failure catches a `Code` built without the
//! `inits` that later feed it.

use std::collections::BTreeSet;

use crate::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
use crate::tm::sim::Tape;

/// The zero bit. **This IS `BLANK`** — see the module doc for why that is forced.
pub const ZERO: Symbol = BLANK;
/// The one bit.
pub const ONE: Symbol = '1';

/// The symbol ↔ bit-pattern table, and the block width `k` derived from it.
///
/// **ONE `Code` FEEDS `to_two_symbol`, `bitify` AND `unbitify`**, so the construction and the two
/// conversions cannot disagree about `k` or about any symbol's pattern. That is stage 1's "no second
/// decode path that could drift", obtained structurally instead of by discipline.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Code {
    /// Symbols in code order. `BLANK` is index 0 — forced, not conventional — and the rest follow in
    /// sorted order so the table is a function of the symbol set alone.
    order: Vec<Symbol>,
    bits: usize,
}

impl Code {
    /// The code table for `m` running on `inits`.
    ///
    /// **IT TAKES `inits` BECAUSE `Machine::alphabet()` IS NOT THE SET OF SYMBOLS THAT CAN APPEAR ON
    /// A TAPE.** That method collects reads ∪ writes. A rule with a wildcard read and a wildcard
    /// write carries an INITIAL symbol past untouched without ever mentioning it, and `BLANK` need
    /// not appear in any rule at all. The set that matters is `writes ∪ inits ∪ {BLANK}`, and
    /// `alphabet() ∪ inits ∪ {BLANK}` is the safe superset built here.
    ///
    /// The single-tape images this composes onto are the concrete case: `single_tape.rs`'s
    /// `interleave` writes a marker for EVERY tape in `0..k` whether that tape's rules mention it or
    /// not, so the reduced image of `1 + 2 * 3` runs on a tape over 15 symbols while its rules name
    /// 9 (`the_composed_machine_needs_more_symbols_than_its_rules_name` asserts both counts).
    #[must_use]
    pub fn new(m: &Machine, inits: &[Vec<Symbol>]) -> Code {
        let mut set: BTreeSet<Symbol> = m.alphabet().into_iter().collect();
        set.extend(inits.iter().flatten().copied());
        set.remove(&BLANK);
        let mut order = Vec::with_capacity(set.len() + 1);
        order.push(BLANK);
        order.extend(set);
        let mut bits = 1usize;
        while (1usize << bits) < order.len() {
            bits += 1;
        }
        Code { order, bits }
    }

    /// The block width `k`: `max(1, ceil(log2(n)))` over the symbol set. Never zero, so a pattern is
    /// never empty and a block never has width zero.
    #[must_use]
    pub fn bits(&self) -> usize {
        self.bits
    }

    /// The symbol set in code order, `BLANK` first.
    #[must_use]
    pub fn symbols(&self) -> &[Symbol] {
        &self.order
    }

    /// `s`'s bit pattern, most significant bit first, or `None` when `s` has no code. MSB-first is
    /// arbitrary; nothing depends on it beyond this function and [`Code::symbol`] agreeing.
    #[must_use]
    pub fn pattern(&self, s: Symbol) -> Option<Vec<Symbol>> {
        let idx = self.order.iter().position(|&x| x == s)?;
        Some((0..self.bits).map(|b| if (idx >> (self.bits - 1 - b)) & 1 == 1 { ONE } else { ZERO }).collect())
    }

    /// The symbol a block decodes to, or `None` when the block is the wrong width, holds a cell that
    /// is neither [`ZERO`] nor [`ONE`], or names an index past the symbol set.
    #[must_use]
    pub fn symbol(&self, block: &[Symbol]) -> Option<Symbol> {
        if block.len() != self.bits {
            return None;
        }
        let mut idx = 0usize;
        for cell in block {
            idx <<= 1;
            match *cell {
                ONE => idx |= 1,
                ZERO => {}
                _ => return None,
            }
        }
        self.order.get(idx).copied()
    }
}

/// Encode every tape: symbol `j` becomes cells `[j·k, (j+1)·k)`. `None` when any symbol has no code,
/// which is a caller pairing a `Code` with tapes it was not built from — the silently-wrong-tape
/// failure this signature exists to refuse.
#[must_use]
pub fn bitify(inits: &[Vec<Symbol>], code: &Code) -> Option<Vec<Vec<Symbol>>> {
    let mut out = Vec::with_capacity(inits.len());
    for tape in inits {
        let mut cells = Vec::with_capacity(tape.len() * code.bits());
        for s in tape {
            cells.extend(code.pattern(*s)?);
        }
        out.push(cells);
    }
    Some(out)
}

/// Recover one tape's `(contents, head index)` — the shape `Tape::snapshot` returns, so the two are
/// directly comparable.
///
/// **THE RIGHT EDGE IS PADDED AND THE LEFT EDGE IS CHECKED, AND THE ASYMMETRY IS REAL.** A write
/// pass walks right one cell per bit and lands on the FIRST cell of the next block, materializing
/// it, so the rightmost materialized cell can sit one cell into a block that is otherwise unwritten
/// — the snapshot's length need not be a multiple of `k`. Padding with [`ZERO`] is not a repair: an
/// unmaterialized cell reads `BLANK`, which IS `ZERO`, so the padding restores exactly the cells the
/// tape would have returned had they been touched. The LEFT edge carries no such slack: every head
/// move is a whole `k`-cell stride and every verify ladder rewinds to the block start it came from,
/// so the head is always on a block boundary and `head % k != 0` means the reduction is broken.
///
/// `None` on that misalignment or on a block that does not decode — a structural failure of the
/// reduction rather than a computation that went wrong, so it carries no reason: the caller has
/// nothing to do with it but fail.
#[must_use]
pub fn unbitify(tape: &Tape, code: &Code) -> Option<(Vec<Symbol>, usize)> {
    let k = code.bits();
    let (mut cells, head) = tape.snapshot();
    if head % k != 0 {
        return None;
    }
    while cells.len() % k != 0 {
        cells.push(ZERO);
    }
    let mut out = Vec::with_capacity(cells.len() / k);
    for block in cells.chunks(k) {
        out.push(code.symbol(block)?);
    }
    Some((out, head / k))
}

/// Generated states per original state — the ratio that decides whether a machine can be reduced at
/// all, and the figure Task 5's gate holds a ceiling on. `None` when `code` does not cover
/// `m.alphabet()` ([`uncovered_symbol`] is `Some`): `to_two_symbol` refuses in that case and returns a
/// one-state machine, and dividing that state count by the original would report the refusal as a
/// favorable ratio instead of a failure to construct at all — the same reason [`bitify`] returns
/// `Option`.
#[must_use]
pub fn states_per_original(m: &Machine, code: &Code) -> Option<f64> {
    if uncovered_symbol(m, code).is_some() {
        return None;
    }
    let reduced = to_two_symbol(m, code);
    #[expect(clippy::cast_precision_loss, reason = "a ratio of state counts, reported to 2 dp")]
    let ratio = reduced.states.len() as f64 / m.states.len().max(1) as f64;
    Some(ratio)
}

/// Reduce `m` to a machine over the two symbols [`ZERO`] and [`ONE`], with `code` fixing the block
/// width and every symbol's pattern. **The tape count is PRESERVED** on a machine this can build —
/// this reduction varies the alphabet, not the machine's shape, and is orthogonal to
/// `single_tape.rs`'s, which varies the shape and not the alphabet. Composing them in that order
/// reaches one tape over two symbols. **A refusal is the exception**: [`refused`] always returns a
/// one-tape machine regardless of `m.tapes`, so a refused machine's tape count must not be read as
/// `m.tapes` — `a_code_built_for_a_different_machine_is_refused` asserts this for a two-tape `m`.
///
/// **REFUSES RATHER THAN BUILDING A CONSTRUCTION IT CANNOT REPRESENT.** `code` must cover every
/// symbol in `m.alphabet()` — what `Code::new(m, inits)` builds. This refuses exactly when
/// [`uncovered_symbol`] returns `Some`. A `Code` built from a different machine can leave a symbol
/// with no pattern; without this check, a write with no pattern would fold into the same case as no
/// write at all, and the candidate would fire, move, and report an ordinary accept on a tape that
/// was never written — a silent wrong answer. When `code` does not cover `m.alphabet()`, this returns
/// a degenerate one-state, non-accept machine ([`refused`]) named to say why, the same shape
/// `single_tape.rs`'s `refused` takes for its own unrepresentable inputs. Callers pair the two by
/// construction: build the `Code` once and hand the same one to `to_two_symbol` and `bitify`.
#[must_use]
pub fn to_two_symbol(m: &Machine, code: &Code) -> Machine {
    if uncovered_symbol(m, code).is_some() {
        return refused("code-does-not-cover-alphabet");
    }
    let mut b = Names::new(m.tapes);
    for (sid, st) in m.states.iter().enumerate() {
        b.emit_state(m, code, StateId::try_from(sid).unwrap_or(0), st);
    }
    b.finish(m)
}

/// The degenerate one-state machine `to_two_symbol` returns when `code` does not cover
/// `m.alphabet()`: a halt in a named, non-accept state rather than a construction it cannot
/// represent correctly — the same shape `single_tape.rs`'s `refused` takes for its own
/// unrepresentable inputs. `name` says why.
fn refused(name: &str) -> Machine {
    Machine { states: vec![State { name: name.into(), accept: false, rules: vec![] }], start: 0, tapes: 1 }
}

/// The first symbol in `m.alphabet()` that `code` cannot encode, or `None` when the pairing is safe.
///
/// **THIS IS WHAT `to_two_symbol`'S REFUSAL IS DEFINED AS**: `to_two_symbol` refuses exactly when this
/// is `Some`, so the two cannot drift apart on what "safe to reduce" means. A caller pairing a `Code`
/// with a machine it was not built from — the mismatch [`refused`] exists to catch — can call this
/// first and get the offending symbol back, instead of having to string-match the refused machine's
/// name to learn why.
#[must_use]
pub fn uncovered_symbol(m: &Machine, code: &Code) -> Option<Symbol> {
    m.alphabet().into_iter().find(|&s| code.pattern(s).is_none())
}

/// Assigns a `StateId` to every generated state name, so rules can name their targets before the
/// target is emitted. Names are the text form's identity and must be unique, non-empty and free of
/// whitespace and `; * : [ ]` (`Machine::validate`), which `.`-separated segments satisfy.
struct Names {
    ids: std::collections::HashMap<String, StateId>,
    states: Vec<State>,
    tapes: usize,
}

impl Names {
    fn new(tapes: usize) -> Names {
        Names { ids: std::collections::HashMap::new(), states: Vec::new(), tapes }
    }

    /// The id for `name`, minting the state on first mention. Every generated state is created here,
    /// so a target named by a rule always exists by the time `finish` runs.
    fn id(&mut self, name: &str) -> StateId {
        if let Some(id) = self.ids.get(name) {
            return *id;
        }
        let id = StateId::try_from(self.states.len()).unwrap_or(0);
        self.ids.insert(name.to_string(), id);
        self.states.push(State { name: name.to_string(), accept: false, rules: Vec::new() });
        id
    }

    /// The state a rule targeting original state `sid` must name.
    ///
    /// **ONE FUNCTION BECAUSE TWO SPELLINGS IS A BUG THAT TESTS GREEN**, the lesson `single_tape.rs`
    /// records under the same name: a mispredicted target mints an EMPTY state, and the simulator
    /// stopping there reports the same `Status::Halted` a real accept does. The difference is
    /// visible only in the final state's NAME, so any assertion on the status alone passes over it.
    /// Here the risk is larger than in stage 1, because a candidate's first state can be a check, a
    /// write, a move or nothing at all depending on the rule — which is why the entry is its own
    /// state rather than a name computed twice.
    fn entry_name(sid: StateId, accept: bool) -> String {
        if accept { format!("q{sid}.halt") } else { format!("q{sid}.enter") }
    }

    fn push_rule(&mut self, at: &str, rule: Rule) {
        let id = self.id(at);
        if let Some(st) = self.states.get_mut(id as usize) {
            st.rules.push(rule);
        }
    }

    /// A rule touching exactly one tape: every other tape reads a wildcard, writes nothing and stays
    /// put. Arity is `tapes` on all three vectors, which `Machine::validate` requires.
    fn one(&self, i: usize, read: Option<Symbol>, write: Option<Symbol>, mv: Move, next: StateId) -> Rule {
        let mut rule = Rule {
            read: vec![None; self.tapes],
            write: vec![None; self.tapes],
            moves: vec![Move::S; self.tapes],
            next,
        };
        if let Some(slot) = rule.read.get_mut(i) {
            *slot = read;
        }
        if let Some(slot) = rule.write.get_mut(i) {
            *slot = write;
        }
        if let Some(slot) = rule.moves.get_mut(i) {
            *slot = mv;
        }
        rule
    }

    /// An unconditional rule that touches no tape at all.
    fn nop(&self, next: StateId) -> Rule {
        Rule { read: vec![None; self.tapes], write: vec![None; self.tapes], moves: vec![Move::S; self.tapes], next }
    }

    /// `n` states, each moving tape `i` one cell in `mv`, ending at `dest`. Returns the name to
    /// enter — **`dest` itself when `n == 0`, emitting nothing**, which is how a `Move::S` with no
    /// write costs zero states.
    fn stride(&mut self, prefix: &str, i: usize, mv: Move, n: usize, dest: &str) -> String {
        let mut next = dest.to_string();
        for p in (0..n).rev() {
            let name = format!("{prefix}{p}");
            let next_id = self.id(&next);
            let rule = self.one(i, None, None, mv, next_id);
            self.push_rule(&name, rule);
            next = name;
        }
        next
    }

    /// A left-rewind ladder for tape `i`: entering rung `p` moves `p` cells left and lands on
    /// `dest`. Rung 0 IS `dest`, so no state is emitted for it — see [`Names::rung`].
    fn rewind_ladder(&mut self, prefix: &str, i: usize, depth: usize, dest: &str) {
        for p in 1..=depth {
            let below = Names::rung(prefix, p - 1, dest);
            let below_id = self.id(&below);
            let rule = self.one(i, None, None, Move::L, below_id);
            self.push_rule(&format!("{prefix}{p}"), rule);
        }
    }

    /// The name of rung `p` of a ladder built by [`Names::rewind_ladder`]. **Rung 0 is `dest`, not a
    /// state**, so a caller that spells `format!("{prefix}0")` instead of calling this names a state
    /// that was never emitted — the empty-state failure `entry_name` documents.
    fn rung(prefix: &str, p: usize, dest: &str) -> String {
        if p == 0 { dest.to_string() } else { format!("{prefix}{p}") }
    }

    /// Verify that tape `i`'s block equals `pattern`, then rewind to the block start and enter `ok`.
    /// A mismatch at bit `p` rewinds `p` cells and enters `bad`. Returns the name to enter.
    ///
    /// **THIS IS THE "VERIFY, NEVER COLLECT" TRICK, AND IT IS WHAT MAKES THE CONSTRUCTION FIT.**
    /// Collecting a block's `k` bits into the control state to learn WHICH symbol it is costs
    /// `2ᵏ = |Γ|` states per read position. Rules are an ordered list and determinism is
    /// first-match-wins, so the reduced machine never needs to know which symbol is there — only
    /// whether it equals the one a specific candidate asks for, and comparing against a known
    /// pattern costs `k`. `single_tape.rs`'s construction turns the same trick for the same reason.
    ///
    /// **THE TWO LADDERS CANNOT SHARE.** Both walk left over the same cells; they differ only in
    /// where rung 0 goes, and a Turing machine has no return address to carry that difference in. So
    /// the cost is `k` checks plus `2(k - 1)` rungs — `3k - 2`, which equals `2k` only at `k = 2`.
    fn check_block(&mut self, prefix: &str, i: usize, pattern: &[Symbol], ok: &str, bad: &str) -> String {
        let k = pattern.len();
        let back = format!("{prefix}.back");
        let fail = format!("{prefix}.fail");
        self.rewind_ladder(&back, i, k.saturating_sub(1), ok);
        self.rewind_ladder(&fail, i, k.saturating_sub(1), bad);
        for (p, bit) in pattern.iter().enumerate() {
            let name = format!("{prefix}.chk{p}");
            // On a match: step to the next bit, or — at the last one — stand still and take the
            // success ladder, which walks the k-1 cells back to the block start.
            let (on_match, mv) = if p + 1 < k {
                (format!("{prefix}.chk{}", p + 1), Move::R)
            } else {
                (Names::rung(&back, k - 1, ok), Move::S)
            };
            let match_id = self.id(&on_match);
            let matched = self.one(i, Some(*bit), None, mv, match_id);
            self.push_rule(&name, matched);
            // Anything else abandons this candidate from depth `p`. This rule is unconditional and
            // is pushed SECOND, so first-match-wins makes it the fallthrough.
            let bad_id = self.id(&Names::rung(&fail, p, bad));
            let missed = self.one(i, None, None, Move::S, bad_id);
            self.push_rule(&name, missed);
        }
        format!("{prefix}.chk0")
    }

    /// Write `pattern` onto tape `i`, one cell per bit walking right, ending at `dest`. **The head
    /// finishes on the FIRST cell of the NEXT block**, which is why `Move::R` costs nothing beyond
    /// the write and the other two moves pay to come back.
    fn write_block(&mut self, prefix: &str, i: usize, pattern: &[Symbol], dest: &str) -> String {
        let mut next = dest.to_string();
        for (p, bit) in pattern.iter().enumerate().rev() {
            let name = format!("{prefix}.wr{p}");
            let next_id = self.id(&next);
            let rule = self.one(i, None, Some(*bit), Move::R, next_id);
            self.push_rule(&name, rule);
            next = name;
        }
        next
    }

    fn emit_state(&mut self, m: &Machine, code: &Code, sid: StateId, st: &State) {
        if st.accept {
            let name = Names::entry_name(sid, true);
            let id = self.id(&name);
            if let Some(s) = self.states.get_mut(id as usize) {
                s.accept = true;
                s.rules.clear();
            }
            return;
        }
        // A non-accept state with no matching candidate is a stuck halt in the original and stays one
        // here: a real state, with no rules, that is not an accept. The simulator stops on it, and the
        // oracle leg tells it from a real accept by the final state's `accept` flag.
        let stuck = format!("q{sid}.stuck");
        let _ = self.id(&stuck);
        // **CANDIDATES ARE EMITTED BACK TO FRONT**, so each one's fallthrough target is a name that
        // has already been built and no name is ever predicted. Determinism is first-match-wins, so
        // candidate `c`'s failure path is candidate `c + 1`'s head, and the last one's is `stuck`.
        let mut fallthrough = stuck;
        for (c, rule) in st.rules.iter().enumerate().rev() {
            let next = self.emit_candidate(m, code, sid, c, rule, &fallthrough);
            fallthrough = next;
        }
        let head_id = self.id(&fallthrough);
        let rule = self.nop(head_id);
        self.push_rule(&Names::entry_name(sid, false), rule);
    }

    /// Emit candidate `c` of original state `sid`, whose failure path is `fallthrough`. Returns the
    /// name of the candidate's FIRST state, which is the previous candidate's failure path.
    ///
    /// Built back to front: the apply phase is emitted first so the verify chain can name it, and the
    /// verify blocks are then threaded right to left so each names the next. **A wildcard read emits
    /// nothing at all**, which is the property that makes stage 1 fit too — most read positions are
    /// wildcards on the real lowered machines spec measured, under UNARY encoding. Binary encoding's
    /// data symbols carry bits a wildcard cannot skip, so its wildcard share is lower, and this
    /// branch's corpus — half binary — is not the population that measurement describes.
    fn emit_candidate(
        &mut self,
        m: &Machine,
        code: &Code,
        sid: StateId,
        c: usize,
        rule: &Rule,
        fallthrough: &str,
    ) -> String {
        let mut head = self.emit_apply(m, code, sid, c, rule);
        for i in (0..self.tapes).rev() {
            let Some(want) = rule.read.get(i).copied().flatten() else { continue };
            // **THIS BRANCH IS UNREACHABLE, PROVABLY.** `emit_candidate` is private with exactly one
            // caller chain: `emit_state` calls it once per candidate of `st`, and `emit_state` is
            // reached only from `to_two_symbol`'s loop over `m.states`. That loop runs only after
            // `to_two_symbol`'s own refusal has already returned early whenever `code` does not cover
            // `m.alphabet()` — the union of every rule's reads and writes, so `want` (a read of one of
            // `st`'s own rules) is always a member. By the time this line runs, `code.pattern(want)` is
            // always `Some`. The branch is kept to name that invariant, not because it can fire: if it
            // ever does, the screen above it has a hole.
            let Some(pattern) = code.pattern(want) else { return fallthrough.to_string() };
            let prefix = format!("q{sid}.c{c}.t{i}");
            head = self.check_block(&prefix, i, &pattern, &head, fallthrough);
        }
        head
    }

    /// Emit candidate `c`'s apply phase — every acting tape's write and move — ending in the state
    /// `rule.next` is entered at. Returns the name to enter, which is that entry directly when no
    /// tape acts.
    ///
    /// **THE WRITE AND THE MOVE FUSE, AND `Move::S` WITH NO WRITE IS FREE.** A write walks right one
    /// cell per bit and lands on the next block, so `R` is already done, `S` owes `k` cells back and
    /// `L` owes `2k`. Without a write, `R` and `L` are a `k`-cell stride and `S` emits no state at
    /// all. Stage 1 had to split its no-write path out as an optimisation worth ~9% of its state
    /// count; here it falls out of the layout.
    ///
    /// Tapes are folded RIGHT TO LEFT so each one's pass names the next, and a tape that neither
    /// writes nor moves drops out of the chain entirely rather than contributing a no-op state.
    fn emit_apply(&mut self, m: &Machine, code: &Code, sid: StateId, c: usize, rule: &Rule) -> String {
        let accept = m.states.get(rule.next as usize).is_some_and(|s| s.accept);
        let mut dest = Names::entry_name(rule.next, accept);
        let k = code.bits();
        for i in (0..self.tapes).rev() {
            let write = rule.write.get(i).copied().flatten();
            let mv = rule.moves.get(i).copied().unwrap_or(Move::S);
            let prefix = format!("q{sid}.c{c}.t{i}");
            dest = match (write.and_then(|y| code.pattern(y)), mv) {
                // A write leaves the head on the next block: R is done, S owes k back, L owes 2k.
                (Some(pattern), Move::R) => self.write_block(&prefix, i, &pattern, &dest),
                (Some(pattern), Move::S) => {
                    let back = format!("{prefix}.ret");
                    self.rewind_ladder(&back, i, k, &dest);
                    let entry = Names::rung(&back, k, &dest);
                    self.write_block(&prefix, i, &pattern, &entry)
                }
                (Some(pattern), Move::L) => {
                    let back = format!("{prefix}.ret");
                    self.rewind_ladder(&back, i, 2 * k, &dest);
                    let entry = Names::rung(&back, 2 * k, &dest);
                    self.write_block(&prefix, i, &pattern, &entry)
                }
                // No write: a move is one k-cell stride, and staying put costs nothing.
                (None, Move::R) => self.stride(&format!("{prefix}.mvr"), i, Move::R, k, &dest),
                (None, Move::L) => self.stride(&format!("{prefix}.mvl"), i, Move::L, k, &dest),
                (None, Move::S) => dest,
            };
        }
        dest
    }

    fn finish(self, m: &Machine) -> Machine {
        let start = self
            .ids
            .get(&Names::entry_name(m.start, m.states.get(m.start as usize).is_some_and(|s| s.accept)))
            .copied()
            .unwrap_or(0);
        Machine { states: self.states, start, tapes: m.tapes }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::machine::{Move, Rule, State};
    use crate::tm::sim::{DEFAULT_CAPS, Status, simulate_final};
    use proptest::prelude::*;

    /// A machine whose rules mention exactly `syms`, so `Code::new` sees a known alphabet.
    fn machine_over(syms: &[Symbol]) -> Machine {
        let rules = syms
            .iter()
            .map(|s| Rule { read: vec![Some(*s)], write: vec![Some(*s)], moves: vec![Move::S], next: 0 })
            .collect();
        Machine { states: vec![State { name: "q".into(), accept: false, rules }], start: 0, tapes: 1 }
    }

    #[test]
    fn blank_is_always_the_all_zeros_pattern() {
        for syms in [&['a'][..], &['a', 'b', 'c'][..], &['#', '1', '@'][..]] {
            let code = Code::new(&machine_over(syms), &[]);
            assert_eq!(code.pattern(BLANK), Some(vec![ZERO; code.bits()]), "for {syms:?}");
        }
    }

    #[test]
    fn width_is_ceil_log2_and_never_zero() {
        // `BLANK` is always in the set, so n is syms.len() + 1 for these.
        assert_eq!(Code::new(&machine_over(&[]), &[]).bits(), 1, "just BLANK: n = 1, k = 1");
        assert_eq!(Code::new(&machine_over(&['a']), &[]).bits(), 1, "n = 2");
        assert_eq!(Code::new(&machine_over(&['a', 'b']), &[]).bits(), 2, "n = 3");
        assert_eq!(Code::new(&machine_over(&['a', 'b', 'c']), &[]).bits(), 2, "n = 4");
        assert_eq!(Code::new(&machine_over(&['a', 'b', 'c', 'd']), &[]).bits(), 3, "n = 5");
    }

    /// The hazard `Code::new`'s doc names: a machine whose only rule is an unconditional wildcard has
    /// an EMPTY `alphabet()`, so a code built from the rules alone has no pattern for a symbol that
    /// arrives on an initial tape.
    #[test]
    fn a_symbol_reaching_a_tape_only_through_inits_still_gets_a_code() {
        let m = Machine {
            states: vec![State {
                name: "q".into(),
                accept: false,
                rules: vec![Rule { read: vec![None], write: vec![None], moves: vec![Move::R], next: 0 }],
            }],
            start: 0,
            tapes: 1,
        };
        assert!(m.alphabet().is_empty(), "the only rule is an unconditional wildcard");
        let inits = vec![vec!['x', 'y']];
        assert_eq!(Code::new(&m, &[]).pattern('x'), None, "a code built from the rules alone cannot encode it");
        let code = Code::new(&m, &inits);
        assert!(code.pattern('x').is_some() && code.pattern('y').is_some());
        assert!(bitify(&inits, &code).is_some());
    }

    #[test]
    fn bitify_refuses_a_symbol_the_code_does_not_cover() {
        let code = Code::new(&machine_over(&['a']), &[]);
        assert_eq!(bitify(&[vec!['z']], &code), None);
    }

    /// `unbitify`'s right-edge padding, which no round trip through `bitify` can reach: `bitify`
    /// always emits a whole number of blocks. A real run gets there because a write pass walks right
    /// one cell per bit and lands on the FIRST cell of the next block, materializing it.
    #[test]
    fn unbitify_pads_a_trailing_partial_block_with_zeros() {
        let code = Code::new(&machine_over(&['a', 'b', 'c']), &[]);
        assert_eq!(code.bits(), 2, "the fixture needs a two-bit code for a partial block to exist");
        // Three cells: one whole block, plus one cell of a second. The missing cell is unwritten, and
        // an unwritten cell reads BLANK, which IS ZERO — so padding restores it exactly rather than
        // inventing anything.
        let tape = Tape::new(&[ONE, ZERO, ONE]);
        let (back, head) = unbitify(&tape, &code).expect("a trailing partial block is not a failure");
        assert_eq!(head, 0);
        assert_eq!(back, vec!['b', 'b'], "both blocks are 10, and index 2 of [BLANK, a, b, c] is `b`");
    }

    #[test]
    fn symbol_refuses_a_block_it_cannot_decode() {
        let code = Code::new(&machine_over(&['a', 'b']), &[]);
        assert_eq!(code.bits(), 2, "order is [BLANK, a, b], three symbols, so index 3 is past the set");
        assert_eq!(code.symbol(&[ONE]), None, "too narrow");
        assert_eq!(code.symbol(&[ONE, ZERO, ONE]), None, "too wide");
        assert_eq!(code.symbol(&[ONE, 'x']), None, "a cell that is neither bit");
        assert_eq!(code.symbol(&[ONE, ONE]), None, "index 3 against a set of 3");
        assert_eq!(code.symbol(&[ONE, ZERO]), Some('b'), "and a block that IS in range still decodes");
    }

    /// The LEFT edge carries no slack. Every head move in the real construction is a whole `k`-cell
    /// stride and every verify ladder rewinds to the block start it came from, so a head off a block
    /// boundary means the reduction is broken — `unbitify` refuses rather than guessing which block
    /// the head is in.
    #[test]
    fn unbitify_refuses_a_head_that_is_not_on_a_block_boundary() {
        let code = Code::new(&machine_over(&['a', 'b', 'c']), &[]);
        assert_eq!(code.bits(), 2);
        // Steps one CELL right — half a block — and halts.
        let m = Machine {
            states: vec![
                State {
                    name: "s0".into(),
                    accept: false,
                    rules: vec![Rule { read: vec![None], write: vec![None], moves: vec![Move::R], next: 1 }],
                },
                State { name: "done".into(), accept: true, rules: vec![] },
            ],
            start: 0,
            tapes: 1,
        };
        let (tapes, _s, status, _steps) = simulate_final(&m, &[vec![ONE, ZERO, ONE, ZERO]], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted, "the fixture must halt on its own, not satisfy this test by hitting a cap");
        assert_eq!(unbitify(&tapes[0], &code), None, "half a block off is a broken reduction, not a tape to guess at");
    }

    proptest! {
        /// The round trip, through a real `Tape` rather than a `Vec`, because `Tape` is what the
        /// oracle leg hands `unbitify` and it is the thing that materializes cells lazily.
        #[test]
        fn unbitify_inverts_bitify(
            syms in prop::collection::vec(prop::sample::select(vec!['a', 'b', 'c', '#', '@', BLANK]), 0..12),
            extra in prop::sample::select(vec!['a', 'b', 'c', 'd', 'e', 'f', 'g'])
        ) {
            let m = machine_over(&[extra]);
            let code = Code::new(&m, std::slice::from_ref(&syms));
            let cells = bitify(std::slice::from_ref(&syms), &code).expect("the code was built from these symbols");
            let tape = Tape::new(&cells[0]);
            let (back, head) = unbitify(&tape, &code).expect("a freshly built tape is aligned");
            prop_assert_eq!(head, 0);
            // `bitify` writes no trailing padding, so the decode is exact up to the input's length.
            prop_assert_eq!(&back[..syms.len()], &syms[..]);
        }
    }

    /// Every generated state must either carry rules, be an accept, or be a NAMED stuck halt. An
    /// empty state with any other name is a target somebody spelled twice and got wrong — the
    /// failure `Names::entry_name` documents, which no status assertion can see.
    fn assert_no_accidental_empty_states(reduced: &Machine) {
        for st in &reduced.states {
            assert!(
                !st.rules.is_empty() || st.accept || st.name.ends_with(".stuck"),
                "state `{}` has no rules, is not an accept, and is not a named stuck halt",
                st.name
            );
        }
    }

    /// A machine that steps `n` times through wildcard rules and accepts. Every rule reads a
    /// wildcard, writes nothing and stays put, so Task 2's construction alone is enough for it.
    fn chain(n: usize) -> Machine {
        let mut states: Vec<State> = (0..n)
            .map(|i| State {
                name: format!("s{i}"),
                accept: false,
                rules: vec![Rule {
                    read: vec![None],
                    write: vec![None],
                    moves: vec![Move::S],
                    next: StateId::try_from(i + 1).unwrap_or(0),
                }],
            })
            .collect();
        states.push(State { name: "done".into(), accept: true, rules: vec![] });
        Machine { states, start: 0, tapes: 1 }
    }

    #[test]
    fn a_wildcard_chain_reduces_and_reaches_the_same_accept() {
        let m = chain(3);
        let code = Code::new(&m, &[]);
        let reduced = to_two_symbol(&m, &code);
        assert_eq!(reduced.validate(), Vec::<String>::new());
        assert_eq!(reduced.tapes, m.tapes, "the alphabet reduction preserves the tape count");
        assert_eq!(reduced.alphabet(), Vec::<Symbol>::new(), "wildcard rules name no symbol at all");
        assert_no_accidental_empty_states(&reduced);
        let (_t, state, status, _steps) = simulate_final(&reduced, &[vec![]], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert!(reduced.states[state as usize].accept, "halted in `{}`", reduced.states[state as usize].name);
    }

    /// A non-accept state with no rules is stuck in the original, and the reduction must not invent
    /// an accept there. `Status::Halted` cannot tell the two apart, so this asserts the flag.
    #[test]
    fn a_stuck_original_stays_stuck_and_does_not_become_an_accept() {
        let m = Machine { states: vec![State { name: "s0".into(), accept: false, rules: vec![] }], start: 0, tapes: 1 };
        let code = Code::new(&m, &[]);
        let reduced = to_two_symbol(&m, &code);
        assert_eq!(reduced.validate(), Vec::<String>::new());
        assert_no_accidental_empty_states(&reduced);
        let (_t, state, status, _steps) = simulate_final(&reduced, &[vec![]], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert!(!reduced.states[state as usize].accept, "halted in an ACCEPT, but the original is stuck");
    }

    /// A one-tape machine that accepts only when it reads `want` under the head.
    fn reads(want: Symbol, alphabet: &[Symbol]) -> Machine {
        let mut rules = vec![Rule { read: vec![Some(want)], write: vec![None], moves: vec![Move::S], next: 1 }];
        // A second candidate over a different symbol, so first-match-wins has something to fall
        // through TO and the fallthrough chain is exercised rather than assumed.
        if let Some(other) = alphabet.iter().find(|s| **s != want) {
            rules.push(Rule { read: vec![Some(*other)], write: vec![None], moves: vec![Move::S], next: 2 });
        }
        Machine {
            states: vec![
                State { name: "s0".into(), accept: false, rules },
                State { name: "yes".into(), accept: true, rules: vec![] },
                State { name: "no".into(), accept: false, rules: vec![] },
            ],
            start: 0,
            tapes: 1,
        }
    }

    #[test]
    fn a_candidate_matches_its_own_symbol_and_falls_through_on_every_other() {
        let alphabet = ['a', 'b', 'c'];
        let m = reads('b', &alphabet);
        // Built over the whole alphabet, not just the two symbols the rules name: `'c'` reaches the
        // tape only as an initial symbol, which is the case `Code::new`'s doc exists for.
        let code = Code::new(&m, &[alphabet.to_vec()]);
        let reduced = to_two_symbol(&m, &code);
        assert_eq!(reduced.validate(), Vec::<String>::new());
        assert_no_accidental_empty_states(&reduced);
        assert_eq!(reduced.alphabet(), vec![ONE, ZERO], "two symbols, and `_` sorts after `1`");
        for sym in [BLANK, 'a', 'b', 'c'] {
            let cells = bitify(&[vec![sym]], &code).expect("the code covers the alphabet");
            let (_t, state, status, _steps) = simulate_final(&reduced, &cells, DEFAULT_CAPS);
            assert_eq!(status, Status::Halted, "for {sym:?}");
            assert_eq!(
                reduced.states[state as usize].accept,
                sym == 'b',
                "reading {sym:?} halted in `{}`",
                reduced.states[state as usize].name
            );
        }
    }

    /// The verify ladders must leave the head exactly where they found it, whether the candidate
    /// matched or not — otherwise the next candidate reads a shifted block. Asserted through
    /// `unbitify`, which returns `None` on a head that is not on a block boundary.
    #[test]
    fn a_failed_candidate_leaves_the_head_on_its_block_boundary() {
        let alphabet = ['a', 'b', 'c'];
        let m = reads('b', &alphabet);
        let code = Code::new(&m, &[alphabet.to_vec()]);
        assert!(code.bits() >= 2, "a one-bit code would not exercise the ladders");
        let reduced = to_two_symbol(&m, &code);
        for sym in [BLANK, 'a', 'b', 'c'] {
            let cells = bitify(&[vec![sym]], &code).expect("the code covers the alphabet");
            let (tapes, _state, _status, _steps) = simulate_final(&reduced, &cells, DEFAULT_CAPS);
            let (back, head) = unbitify(&tapes[0], &code).unwrap_or_else(|| panic!("misaligned for {sym:?}"));
            assert_eq!(head, 0, "for {sym:?}");
            assert_eq!(back.first(), Some(&sym), "verify must not write, for {sym:?}");
        }
    }

    /// A one-tape machine that writes `out` over whatever it reads, moves `mv`, and accepts.
    fn writes(out: Symbol, mv: Move, alphabet: &[Symbol]) -> Machine {
        let seed: Vec<Rule> = alphabet
            .iter()
            .map(|s| Rule { read: vec![Some(*s)], write: vec![Some(out)], moves: vec![mv], next: 1 })
            .collect();
        Machine {
            states: vec![
                State { name: "s0".into(), accept: false, rules: seed },
                State { name: "done".into(), accept: true, rules: vec![] },
            ],
            start: 0,
            tapes: 1,
        }
    }

    /// The construction against the original, cell for cell and head for head — the same assertion
    /// the oracle leg makes, on a machine small enough to read.
    #[test]
    fn a_toy_machine_matches_its_two_symbol_image_cell_for_cell() {
        let alphabet = ['a', 'b', 'c'];
        for mv in [Move::L, Move::S, Move::R] {
            let m = writes('c', mv, &alphabet);
            let inits = vec![vec!['a', 'b', 'a']];
            let code = Code::new(&m, &inits);
            let reduced = to_two_symbol(&m, &code);
            assert_eq!(reduced.validate(), Vec::<String>::new(), "for {mv:?}");
            assert_no_accidental_empty_states(&reduced);
            let (want, _ws, want_status, _wsteps) = simulate_final(&m, &inits, DEFAULT_CAPS);
            assert_eq!(want_status, Status::Halted, "for {mv:?}");
            let cells = bitify(&inits, &code).expect("the code was built from these tapes");
            let (got, gs, got_status, _gsteps) = simulate_final(&reduced, &cells, DEFAULT_CAPS);
            assert_eq!(got_status, Status::Halted, "for {mv:?}");
            assert!(reduced.states[gs as usize].accept, "halted in `{}` for {mv:?}", reduced.states[gs as usize].name);
            let (back, head) = unbitify(&got[0], &code).unwrap_or_else(|| panic!("misaligned for {mv:?}"));
            let (w_cells, w_head) = want[0].snapshot();
            assert_eq!(
                crate::tm::single_tape::normalize(&back, head),
                crate::tm::single_tape::normalize(&w_cells, w_head),
                "for {mv:?}"
            );
        }
    }

    /// **`stride` HAD NEVER EXECUTED BEFORE THIS TEST.** It carried `#[expect(dead_code)]` through
    /// two tasks — which only survives `-D warnings` while nothing calls the item — and the two arms
    /// that reach it, a move with no write, are reached by no other machine in this file. A rule that
    /// moves without writing is every scanning step a real lowered machine takes.
    #[test]
    fn a_move_with_no_write_strides_one_whole_block() {
        for mv in [Move::R, Move::L] {
            let m = Machine {
                states: vec![
                    State {
                        name: "s0".into(),
                        accept: false,
                        rules: vec![Rule { read: vec![None], write: vec![None], moves: vec![mv], next: 1 }],
                    },
                    State { name: "done".into(), accept: true, rules: vec![] },
                ],
                start: 0,
                tapes: 1,
            };
            let inits = vec![vec!['a', 'b', 'c']];
            let code = Code::new(&m, &inits);
            let reduced = to_two_symbol(&m, &code);
            assert_eq!(reduced.validate(), Vec::<String>::new(), "for {mv:?}");
            assert_no_accidental_empty_states(&reduced);
            let (want, _ws, _wstatus, _wsteps) = simulate_final(&m, &inits, DEFAULT_CAPS);
            let cells = bitify(&inits, &code).expect("the code was built from these tapes");
            let (got, gs, got_status, _gsteps) = simulate_final(&reduced, &cells, DEFAULT_CAPS);
            assert_eq!(got_status, Status::Halted, "for {mv:?}");
            assert!(reduced.states[gs as usize].accept, "halted in `{}` for {mv:?}", reduced.states[gs as usize].name);
            // A stride of the wrong LENGTH leaves the head off a block boundary and `unbitify`
            // refuses; a stride in the wrong DIRECTION lands on the wrong block and the comparison
            // fails. The two failure modes are distinguishable in the output.
            let (back, head) = unbitify(&got[0], &code).unwrap_or_else(|| panic!("misaligned for {mv:?}"));
            let (w_cells, w_head) = want[0].snapshot();
            assert_eq!(
                crate::tm::single_tape::normalize(&back, head),
                crate::tm::single_tape::normalize(&w_cells, w_head),
                "for {mv:?}"
            );
        }
    }

    /// Multi-tape: the reduction preserves the tape count, and each tape's blocks are independent.
    #[test]
    fn two_tapes_reduce_independently() {
        let m = Machine {
            states: vec![
                State {
                    name: "s0".into(),
                    accept: false,
                    // **BOTH READS ARE CONCRETE ON PURPOSE.** One concrete read and one wildcard
                    // emits a single `check_block`, and a single check cannot catch a tape-INDEX
                    // confusion — a check or a write built for tape 0 landing on tape 1. Two
                    // concrete reads can. **IT DOES NOT CATCH A WRONG FOLD ORDER**: every generated
                    // rule touches exactly one tape, so the per-tape passes commute, and reordering
                    // them changes the step sequence without changing either tape's final contents.
                    // The wildcard-read path is covered by
                    // `a_wildcard_chain_reduces_and_reaches_the_same_accept`.
                    rules: vec![Rule {
                        read: vec![Some('a'), Some('c')],
                        write: vec![Some('b'), Some('c')],
                        moves: vec![Move::R, Move::L],
                        next: 1,
                    }],
                },
                State { name: "done".into(), accept: true, rules: vec![] },
            ],
            start: 0,
            tapes: 2,
        };
        let inits = vec![vec!['a', 'a'], vec!['c', 'a']];
        let code = Code::new(&m, &inits);
        let reduced = to_two_symbol(&m, &code);
        assert_eq!(reduced.validate(), Vec::<String>::new());
        assert_eq!(reduced.tapes, 2);
        assert_no_accidental_empty_states(&reduced);
        let (want, _ws, _wstatus, _wsteps) = simulate_final(&m, &inits, DEFAULT_CAPS);
        let cells = bitify(&inits, &code).expect("the code was built from these tapes");
        let (got, _gs, _gstatus, _gsteps) = simulate_final(&reduced, &cells, DEFAULT_CAPS);
        for (i, tape) in want.iter().enumerate() {
            let (back, head) = unbitify(&got[i], &code).unwrap_or_else(|| panic!("tape {i} misaligned"));
            let (w_cells, w_head) = tape.snapshot();
            assert_eq!(
                crate::tm::single_tape::normalize(&back, head),
                crate::tm::single_tape::normalize(&w_cells, w_head),
                "tape {i}"
            );
        }
    }

    /// **`k == 1` DEGENERATES BOTH LADDERS TO NOTHING.** The check state's match arm must go
    /// straight to `ok` and its mismatch arm straight to `bad`, because `Names::rung(_, 0, dest)` IS
    /// `dest` and emits no state. Naming a rung here instead would mint an empty state, and halting
    /// in one reports the same `Status::Halted` a real accept does.
    #[test]
    fn a_one_bit_code_emits_no_ladder_rungs_and_still_decides() {
        let alphabet = ['a'];
        let m = reads('a', &alphabet);
        let code = Code::new(&m, &[alphabet.to_vec()]);
        assert_eq!(code.bits(), 1, "BLANK and `a` is two symbols, so one bit");
        let reduced = to_two_symbol(&m, &code);
        assert_eq!(reduced.validate(), Vec::<String>::new());
        assert_no_accidental_empty_states(&reduced);
        for sym in [BLANK, 'a'] {
            let cells = bitify(&[vec![sym]], &code).expect("the code covers the alphabet");
            let (_t, state, status, _steps) = simulate_final(&reduced, &cells, DEFAULT_CAPS);
            assert_eq!(status, Status::Halted, "for {sym:?}");
            assert_eq!(
                reduced.states[state as usize].accept,
                sym == 'a',
                "reading {sym:?} halted in `{}`",
                reduced.states[state as usize].name
            );
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

    /// The ratio the construction may not exceed, as a PROPERTY rather than a restated measurement.
    /// **A gate on an exact figure is a gate that a one-state change trips**, which stage 1 learned
    /// by putting a program with a 0.062% margin inside its gated set — a PERCENT margin, which does
    /// not say how many states that was. `the_construction_stays_under_its_state_ceiling` measures
    /// and prints this construction's own margin in STATES instead: an absolute count says whether
    /// the next generated state is the one that trips it, and a percentage alone does not.
    const STATE_CEILING: f64 = 30.0;

    /// The `(ratio, original_states)` row whose margin to [`STATE_CEILING`], IN STATES, is smallest —
    /// how many more states its reduced image could gain before its ratio reached the ceiling.
    /// **NOT the row with the highest ratio**: margin is `(STATE_CEILING - ratio) * original_states`,
    /// so a row with a lower ratio but far more original states can carry the smaller — the more
    /// dangerous — margin. `None` on an empty slice.
    fn worst_margin(measurements: &[(f64, usize)]) -> Option<(f64, f64, usize)> {
        measurements
            .iter()
            .map(|&(ratio, orig)| {
                #[expect(clippy::cast_precision_loss, reason = "an original state count, in a states margin")]
                let margin = (STATE_CEILING - ratio) * orig as f64;
                (margin, ratio, orig)
            })
            .min_by(|a, b| a.0.partial_cmp(&b.0).expect("a margin computed from finite ratios is always finite"))
    }

    /// **THE CASE `max_by` ON RATIO GETS WRONG.** Row A sits closer to `STATE_CEILING` by ratio, but
    /// its LARGE original state count still keeps its margin, in states, wide. Row B sits further
    /// from the ceiling by ratio, but its SMALL original state count makes its margin the tighter
    /// one. Selecting by ratio would report row A's wide margin as the corpus's worst; the true worst
    /// is row B's narrow one. The figures are in the assertions below, not restated here.
    #[test]
    fn the_worst_margin_row_is_the_smallest_margin_not_the_highest_ratio() {
        let measurements = vec![(29.0, 100usize), (5.0, 1usize)];
        let (margin, ratio, orig) = worst_margin(&measurements).expect("the slice above is non-empty");
        assert_eq!((ratio, orig), (5.0, 1), "the smaller-margin row must be selected, not the higher-ratio one");
        assert!((margin - 25.0).abs() < 1e-9, "margin = (30 - 5) * 1 = 25, not row A's (30 - 29) * 100 = 100");
    }

    #[test]
    fn the_construction_stays_under_its_state_ceiling() {
        let mut measurements: Vec<(f64, usize)> = Vec::new();
        for src in
            ["1 + 2 * 3", "cons(1, cons(2, nil))", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"]
        {
            for enc in [crate::tm::EncodingKind::Unary, crate::tm::EncodingKind::Binary] {
                let (m, inits) = demo_machine(src, enc);
                let code = Code::new(&m, &inits);
                let ratio = states_per_original(&m, &code).expect("the demo suite's own codes cover their machines");
                println!("{src:60} {enc:?} k={} ratio={ratio:.6}", code.bits());
                assert!(
                    ratio < STATE_CEILING,
                    "{src} at {enc:?} (k={}) measures {ratio:.6} against {STATE_CEILING}",
                    code.bits()
                );
                measurements.push((ratio, m.states.len()));
            }
        }
        // The margin in ABSOLUTE STATES, not percent, for the worst-gated program: the corpus member
        // whose reduced image could gain the FEWEST more states before its ratio reached
        // `STATE_CEILING`. `STATE_CEILING`'s own doc explains why states rather than percent; this is
        // where the live figure it points to actually lives, and `worst_margin`'s own test shows why
        // it is not simply the highest-ratio row.
        let (worst_margin_states, worst_ratio, orig) =
            worst_margin(&measurements).expect("the corpus above is non-empty");
        println!(
            "worst gated margin = {worst_margin_states:.1} states (ratio {worst_ratio:.6} at {orig} original \
             states)"
        );
    }

    /// One `.enter` state per **non-accept** original state — the arity this test checks, and the
    /// reason it exists: a state emitted twice would otherwise be absorbed into the ratio above.
    /// **This counts `.enter` states only.** `emit_state` also mints a `.stuck` state for every
    /// non-accept original state, and this test does not count those — its name says "enter" rather
    /// than claiming the per-state scaffold is `.enter` alone.
    ///
    /// **THIS SAYS NOTHING ABOUT STEPS.** What the entry state costs at run time is a different
    /// quantity, needing a different instrument, and no figure for it is asserted anywhere in this
    /// file. Two earlier drafts of this comment asserted one: the first claimed this test measured
    /// it, the second dropped that and kept the figure.
    #[test]
    fn there_is_exactly_one_enter_state_per_non_accept_original_state() {
        let (m, inits) = demo_machine("1 + 2 * 3", crate::tm::EncodingKind::Unary);
        let code = Code::new(&m, &inits);
        let reduced = to_two_symbol(&m, &code);
        let entries = reduced.states.iter().filter(|s| s.name.ends_with(".enter")).count();
        let non_accept = m.states.iter().filter(|s| !s.accept).count();
        assert_eq!(entries, non_accept, "one `.enter` state per non-accept original state, and no more");
    }

    /// A `Code` built over a DIFFERENT machine's alphabet cannot cover this one's, so `to_two_symbol`
    /// must refuse rather than build a construction where a write with no pattern would silently fold
    /// into "no write at all". The refusal is the shape `single_tape.rs`'s `refused` uses: one state,
    /// not an accept, named. `m` has two tapes so this also exercises the refusal's own tape count,
    /// which stays fixed regardless of `m.tapes` — `to_two_symbol`'s doc names this test for it.
    #[test]
    fn a_code_built_for_a_different_machine_is_refused() {
        let m = Machine {
            states: vec![State {
                name: "q".into(),
                accept: false,
                rules: vec![Rule {
                    read: vec![Some('a'), None],
                    write: vec![Some('a'), None],
                    moves: vec![Move::S, Move::S],
                    next: 0,
                }],
            }],
            start: 0,
            tapes: 2,
        };
        let other = machine_over(&['x', 'y']);
        let code = Code::new(&other, &[]);
        assert!(
            m.alphabet().iter().any(|s| code.pattern(*s).is_none()),
            "the fixture must actually exercise the mismatch: `code` must miss a symbol of `m`'s"
        );
        let reduced = to_two_symbol(&m, &code);
        assert_eq!(reduced.states.len(), 1, "a refusal is the degenerate one-state machine, not a partial build");
        assert!(!reduced.states[0].accept, "a refusal must not be an accept");
        assert_eq!(
            reduced.states[0].name, "code-does-not-cover-alphabet",
            "a refusal must be named, so the reason is visible"
        );
        assert_eq!(reduced.tapes, 1, "a refusal always returns one tape, even though `m` has {}", m.tapes);
    }

    /// **THE BUG THIS SIGNATURE EXISTS TO RULE OUT.** A refusal is a one-state machine; dividing that
    /// by the original state count is a small, comfortable-looking ratio, not a failure. `None` is the
    /// only way a caller can tell the two apart without string-matching the refused name.
    #[test]
    fn states_per_original_reports_none_rather_than_a_refusals_ratio() {
        let m = machine_over(&['a', 'b', 'c']);
        let other = machine_over(&['x', 'y']);
        let code = Code::new(&other, &[]);
        assert!(
            m.alphabet().iter().any(|s| code.pattern(*s).is_none()),
            "the fixture must actually exercise the mismatch: `code` must miss a symbol of `m`'s"
        );
        assert_eq!(
            states_per_original(&m, &code),
            None,
            "a refusal must not be reported as a states-per-original ratio"
        );
    }
}
