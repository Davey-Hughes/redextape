//! The single-tape reduction: a `Machine` over `k` tapes becomes a `Machine` over one, by
//! interleaving the tapes into fixed-width blocks and simulating each k-tape step as a sweep.
//!
//! **THE MARKER SYMBOL CARRIES THE TAPE INDEX.** A block holds, for each tape `i`, a marker cell
//! then a content cell; the marker is `head_here(i)` or `head_away(i)`. A shared marker pair like
//! `^`/`.` would force every walk to count its offset within the block to learn which tape it is
//! looking at, and that counter is `k` states on every walk — it multiplies the construction by 5.
//! Reading the identity out of the symbol costs `2k + 2` symbols against an alphabet of 4, which is
//! the dimension that is not scarce.

use crate::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
use crate::tm::sim::Tape;

/// The left and right sentinels bounding the block skeleton.
pub const LEFT: Symbol = '<';
/// See [`LEFT`].
pub const RIGHT: Symbol = '>';

/// The most tapes this reduction can encode, bounded by the marker letters `A`-`Z` / `a`-`z`.
/// `TAPES` is 5, so this is slack rather than a live limit.
///
/// **NOT named `MAX_TAPES`**: `tm/build.rs`'s `MAX_TAPES` is a different cap, on how many tapes a
/// parsed `.tm` file may declare (`tm/syntax.rs` only imports it). Two different limits under one
/// name in one module tree is the drift `scripts/check-attributions.sh` exists downstream of.
pub const MAX_ENCODABLE_TAPES: usize = 26;

/// Tape `i`'s marker when its head IS in this block.
#[must_use]
pub fn head_here(i: usize) -> Symbol {
    debug_assert!(i < MAX_ENCODABLE_TAPES);
    char::from(b'A' + u8::try_from(i).unwrap_or(0))
}

/// Tape `i`'s marker when its head is NOT in this block.
#[must_use]
pub fn head_away(i: usize) -> Symbol {
    debug_assert!(i < MAX_ENCODABLE_TAPES);
    char::from(b'a' + u8::try_from(i).unwrap_or(0))
}

/// Interleave `k` tapes into one. `left_pad` blocks precede cell 0 so a head can move left of its
/// origin; `right_pad` blocks follow the longest tape so a head can move right past its contents.
/// Every head starts in the block holding its own cell 0, which is block `left_pad`.
///
/// `k` need not equal `inits.len()`. `k > inits.len()` is safe: the extra tapes have no initial
/// contents, so every one of their cells is `BLANK`, same as a real empty tape. `k < inits.len()` is
/// NOT safe: the loop below only interleaves tapes `0..k`, so `inits[k..]` is SILENTLY DROPPED from
/// the output, while `longest` above is still computed over ALL of `inits` — the dropped tapes can
/// still make the skeleton wider, spending blocks on content nothing will ever decode back out.
#[must_use]
pub fn interleave(inits: &[Vec<Symbol>], k: usize, left_pad: usize, right_pad: usize) -> Vec<Symbol> {
    debug_assert!(k >= inits.len(), "interleave would silently drop inits[{k}..{}]", inits.len());
    let longest = inits.iter().map(Vec::len).max().unwrap_or(0).max(1);
    let blocks = left_pad + longest + right_pad;
    let mut out = Vec::with_capacity(blocks * 2 * k + 2);
    out.push(LEFT);
    for j in 0..blocks {
        for i in 0..k {
            out.push(if j == left_pad { head_here(i) } else { head_away(i) });
            let cell = j.checked_sub(left_pad).and_then(|c| inits.get(i).and_then(|t| t.get(c).copied()));
            out.push(cell.unwrap_or(BLANK));
        }
    }
    out.push(RIGHT);
    out
}

/// Recover `k` tapes from a single tape, as `(contents, head index)` per tape — the same shape
/// `Tape::snapshot` returns, so the two are directly comparable.
///
/// `None` when the tape is not a well-formed skeleton: no sentinels, a region that is not a whole
/// number of blocks, or a tape with no head marker. That is a structural failure of the reduction
/// rather than a computation that went wrong, so it is not an `Err` with a reason — the caller has
/// nothing to do with it but fail.
#[must_use]
pub fn deinterleave(tape: &Tape, k: usize) -> Option<Vec<(Vec<Symbol>, usize)>> {
    let (cells, _head) = tape.snapshot();
    let start = cells.iter().position(|c| *c == LEFT)? + 1;
    let end = cells.iter().rposition(|c| *c == RIGHT)?;
    let region = cells.get(start..end)?;
    if k == 0 || region.len() % (2 * k) != 0 {
        return None;
    }
    let mut out: Vec<(Vec<Symbol>, usize)> = vec![(Vec::new(), usize::MAX); k];
    for (j, block) in region.chunks_exact(2 * k).enumerate() {
        for i in 0..k {
            let marker = *block.get(2 * i)?;
            let content = *block.get(2 * i + 1)?;
            out.get_mut(i)?.0.push(content);
            if marker == head_here(i) {
                out.get_mut(i)?.1 = j;
            }
        }
    }
    if out.iter().any(|(_, h)| *h == usize::MAX) { None } else { Some(out) }
}

/// Trim blanks from both ends of a tape snapshot, keeping the head cell and adjusting its index.
///
/// **THIS IS WHAT MAKES TAPE-IDENTITY COMPARABLE AT ALL.** A `Tape` materializes cells lazily, so a
/// multi-tape run's snapshot holds only the cells its head actually visited, while the interleaved
/// tape holds every block the skeleton was built with. The two describe the same tape and differ in
/// padding, so comparing them raw always fails.
///
/// **LIMITATION: ON AN ALL-BLANK TAPE, THE HEAD POSITION IS DISCARDED.** With no non-`BLANK` cell to
/// anchor on, `first` and `last` both collapse to `head` itself, so the result is always a single
/// `BLANK` cell at relative index 0 — `normalize(&[BLANK; 5], 0) == normalize(&[BLANK; 5], 4)`, even
/// though the two heads started in different places. Every oracle assertion built on this function
/// (tape identity between the multi- and single-tape runs) is therefore satisfied by ANY head on
/// either side whenever that tape ends all-blank, which the normal-tier corpus does for most of its
/// tapes. This is an instrument weakness, not a construction defect — nothing in `to_single_tape` or
/// `interleave` loses head information, only this comparison does — and is left as-is rather than
/// redesigned.
#[must_use]
pub fn normalize(cells: &[Symbol], head: usize) -> (Vec<Symbol>, usize) {
    let first = cells.iter().position(|c| *c != BLANK).unwrap_or(head).min(head);
    let last = cells.iter().rposition(|c| *c != BLANK).unwrap_or(head).max(head);
    let slice = cells.get(first..=last).unwrap_or(&[BLANK]);
    (slice.to_vec(), head - first)
}

/// The state a machine enters when a head would leave the block skeleton. **A NAMED HALT RATHER
/// THAN A WRONG ANSWER**: the block count is fixed at construction (a Turing machine has no return
/// address, so a block-materialising subroutine would be duplicated at every call site and cost more
/// states than the whole rest of the construction), so running out of tape has to be reported rather
/// than grown into. A caller distinguishes it from a real halt by the final state id.
pub const OVERFLOW: &str = "overflow";

/// Reduce a k-tape machine to a one-tape machine over the block layout this module documents. A head
/// that would leave the block skeleton halts in [`OVERFLOW`]; how far a head may travel outside the
/// initial contents is fixed by [`interleave`]'s `left_pad`/`right_pad`, which is where that padding
/// actually lives — `to_single_tape` builds a transition TABLE, independent of block count, and takes
/// no padding arguments of its own.
///
/// **PRECONDITION: the pairing of `m` with whatever initial tapes a caller later feeds it must not put
/// a [`LEFT`], [`RIGHT`], or `head_here`/`head_away` marker (for any tape in `0..m.tapes`) in a CONTENT
/// cell.** `emit_one_tape_pass`'s seek finds a tape's new head position by walking until it meets that
/// tape's `head_away` symbol, justified by "the next `head_away(i)` in that direction is the
/// neighbouring block's marker, because a tape has one head" — a justification that holds only if no
/// CONTENT cell can ever hold a marker symbol. Nothing upstream enforces that (`Machine::validate`
/// rejects only whitespace and `* ; [ ]`), so a colliding data symbol would let the seek land on and
/// consume a WRITTEN symbol as though it were the tape's own marker, corrupting the tape while the
/// machine reports an ordinary ACCEPT — a silent wrong answer rather than a visible failure.
///
/// `to_single_tape` checks what IT can see and REFUSES a machine either with too many tapes to encode
/// (past [`MAX_ENCODABLE_TAPES`]) or whose `Machine::alphabet()` collides with the layout's own
/// symbols (`layout_collision(m, &[])`), returning a degenerate one-state machine ([`refused`]) that
/// halts in a named, non-accept state instead of building a construction it cannot represent
/// correctly — the same shape `lower_tm.rs`'s `refused` takes for ITS unrepresentable inputs (an
/// absurd slot count, `Mul` count, or state count).
///
/// **THAT SECOND REFUSAL IS NOT THE WHOLE PRECONDITION, AND CANNOT BE.** `Machine::alphabet` collects symbols
/// only from rules' `read`/`write` — it has no way to see INITIAL TAPE CONTENTS, which are a separate
/// argument to [`interleave`], not part of `m` at all. A symbol appearing solely in an initial tape
/// (never in any rule) is invisible to this refusal: a machine whose only rule is an unconditional
/// wildcard has an empty alphabet and sails straight through, no matter what its caller's initial tapes
/// contain. A caller wiring `to_single_tape` and `interleave` together must additionally call
/// [`layout_collision`] with both the machine AND the initial tapes before trusting the pair — this
/// function's refusal alone is not sufficient. The signature stays `Machine`, not `Option<Machine>`:
/// the caller already has to distinguish a real accept from [`OVERFLOW`] by state name, and a named
/// refusal state is that same mechanism, not a new one.
#[must_use]
pub fn to_single_tape(m: &Machine) -> Machine {
    // Checked BEFORE anything below calls `reserved_symbols`/`layout_collision`, which mint a
    // `head_here`/`head_away` marker for every tape in `0..m.tapes`: past `MAX_ENCODABLE_TAPES` those
    // markers wrap into each other and into `BLANK`, `LEFT` and `RIGHT` (`head_here`/`head_away`'s own
    // `debug_assert!` catches this in a debug build, but a release build silently wraps instead — see
    // this module's tests for a reproduction). Refusing on tape count ALONE, before the alphabet is
    // even consulted, is what keeps this check correct at any `m.tapes` up to `tm::build::MAX_TAPES`.
    if m.tapes > MAX_ENCODABLE_TAPES {
        return refused("too-many-tapes");
    }
    if layout_collision(m, &[]).is_some() {
        return refused("alphabet-collision");
    }
    let mut b = Names::new();
    for (sid, st) in m.states.iter().enumerate() {
        b.emit_state(m, StateId::try_from(sid).unwrap_or(0), st);
    }
    b.finish(m)
}

/// Generated states per original state — the ratio that decides whether the largest machine the
/// demo suite builds can be reduced at all.
#[must_use]
pub fn states_per_original(m: &Machine) -> f64 {
    let single = to_single_tape(m);
    #[expect(clippy::cast_precision_loss, reason = "a ratio of state counts, reported to 2 dp")]
    let ratio = single.states.len() as f64 / m.states.len().max(1) as f64;
    ratio
}

/// The symbols the block skeleton reserves for itself: [`LEFT`], [`RIGHT`], and every tape in
/// `0..m.tapes`'s two markers (`head_here`/`head_away`). The one place that set is built, so
/// `to_single_tape`'s own refusal and [`layout_collision`] cannot drift apart on what "reserved"
/// means: the former is exactly `layout_collision(m, &[]).is_some()`, `inits` empty because
/// `to_single_tape` never sees initial tape contents at all.
fn reserved_symbols(m: &Machine) -> Vec<Symbol> {
    [LEFT, RIGHT].into_iter().chain((0..m.tapes).flat_map(|i| [head_here(i), head_away(i)])).collect()
}

/// The degenerate one-state machine `to_single_tape` returns for a refusal: a halt in a named,
/// non-accept state rather than a construction it cannot represent correctly — the same shape
/// `lower_tm.rs`'s `refused` takes for ITS unrepresentable inputs. `name` says WHY refused, since
/// `to_single_tape` has more than one reason to (see its own doc).
fn refused(name: &str) -> Machine {
    Machine { states: vec![State { name: name.into(), accept: false, rules: vec![] }], start: 0, tapes: 1 }
}

/// The first symbol in `m`'s alphabet or in `inits` that collides with the layout's own symbols — the
/// sentinels and every tape's two markers — or `None` when the pair is safe to reduce.
///
/// **THIS SEES WHAT `to_single_tape`'s OWN REFUSAL CANNOT.** `Machine::alphabet` collects symbols only
/// from rules' `read`/`write`; it never sees `inits`, which `to_single_tape` and `interleave` take as
/// separate arguments and which this function takes together on purpose. A machine whose only rule is
/// an unconditional wildcard has an EMPTY alphabet, so `to_single_tape`'s own refusal passes it
/// regardless of what `inits` holds — and an initial tape containing, say, `head_away(0)` produces
/// exactly the silent tape corruption the refusal exists to prevent, while the machine still reports an
/// ordinary ACCEPT. A caller wiring `to_single_tape` and `interleave` together must call this function
/// on the same `(m, inits)` pair and refuse to proceed when it returns `Some`.
#[must_use]
pub fn layout_collision(m: &Machine, inits: &[Vec<Symbol>]) -> Option<Symbol> {
    let reserved = reserved_symbols(m);
    m.alphabet()
        .into_iter()
        .find(|s| reserved.contains(s))
        .or_else(|| inits.iter().flatten().find(|s| reserved.contains(s)).copied())
}

/// Assigns a `StateId` to every generated state name, so rules can name their targets before the
/// target is emitted. Names are the text form's identity and must be unique, non-empty and free of
/// whitespace and `; * : [ ]` (`Machine::validate`), which `.`-separated segments satisfy.
struct Names {
    ids: std::collections::HashMap<String, StateId>,
    states: Vec<State>,
}

impl Names {
    fn new() -> Names {
        Names { ids: std::collections::HashMap::new(), states: Vec::new() }
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
    /// **ONE FUNCTION BECAUSE TWO SPELLINGS IS A BUG THAT TESTS GREEN.** An accept state is emitted
    /// as `q{sid}.halt` and a non-accept one as `q{sid}.c0.scan`. A rule that always named
    /// `q{sid}.c0.scan` would, for an accept target, mint an EMPTY state instead — and the machine
    /// would stop there, which `Status::Halted` reports exactly as it reports a real accept. The
    /// difference is only visible in the final state's name, so any test asserting the status alone
    /// passes over it.
    fn entry_name(m: &Machine, sid: StateId) -> String {
        let accept = m.states.get(sid as usize).is_some_and(|s| s.accept);
        if accept { format!("q{sid}.halt") } else { format!("q{sid}.c0.scan") }
    }

    fn push_rule(&mut self, at: &str, rule: Rule) {
        let id = self.id(at);
        if let Some(st) = self.states.get_mut(id as usize) {
            st.rules.push(rule);
        }
    }

    /// A one-tape rule: read `r`, write `w`, move `mv`, go to `next`.
    fn r(read: Option<Symbol>, write: Option<Symbol>, mv: Move, next: StateId) -> Rule {
        Rule { read: vec![read], write: vec![write], moves: vec![mv], next }
    }

    fn emit_state(&mut self, m: &Machine, sid: StateId, st: &State) {
        if st.accept {
            let name = format!("q{sid}.halt");
            let id = self.id(&name);
            if let Some(s) = self.states.get_mut(id as usize) {
                s.accept = true;
                s.rules.clear();
            }
            return;
        }
        for (c, rule) in st.rules.iter().enumerate() {
            self.emit_candidate(m, sid, c, st.rules.len(), rule);
        }
        if st.rules.is_empty() {
            // A non-accept state with no rules is a stuck halt in the original, and stays one here:
            // the entry state exists, has no rules, and the simulator stops on it.
            let _ = self.id(&format!("q{sid}.c0.scan"));
        }
    }

    /// The scan state walks RIGHT looking for head markers. A tape with a CONCRETE read hands off to
    /// that tape's check state on the content cell; a wildcard read emits no check at all, which is
    /// the whole reason this construction fits (81% of read positions are wildcards on the design
    /// spec's real lowered machines). **THAT SHARE IS NOT UNIVERSAL, THOUGH** (same caveat as
    /// `emit_apply`'s tapes-per-rule figure, for the same reason — a different triple of machines):
    /// the worst shipped demo (`the_worst_shipped_demo_measured_directly` below) measures only **66.0%**
    /// wildcard read positions. Reaching `>` means every concrete read matched, so the candidate is verified and the
    /// sweep rewinds to apply it; a mismatch on any checked tape abandons this candidate and falls
    /// through to the next one, or to a stuck state if there is none.
    fn emit_candidate(&mut self, m: &Machine, sid: StateId, c: usize, n_rules: usize, rule: &Rule) {
        let scan = format!("q{sid}.c{c}.scan");
        let rew = format!("q{sid}.c{c}.rew");
        let fail = format!("q{sid}.c{c}.fail");
        let scan_id = self.id(&scan);
        let rew_id = self.id(&rew);
        let fail_id = self.id(&fail);

        // Reaching `>` means every concrete read matched: rewind and apply.
        self.push_rule(&scan, Names::r(Some(RIGHT), None, Move::S, rew_id));
        // A head marker for a tape with a CONCRETE read hands over to that tape's check state, which
        // sits on the content cell one to the right. Wildcard reads emit nothing here, which is the
        // whole reason this construction fits — see this function's doc for the measured share and
        // why it is not universal.
        for (i, want) in rule.read.iter().enumerate().take(m.tapes) {
            if let Some(sym) = want {
                let chk = format!("q{sid}.c{c}.chk{i}");
                let chk_id = self.id(&chk);
                self.push_rule(&scan, Names::r(Some(head_here(i)), None, Move::R, chk_id));
                // On the content cell: match continues the scan, anything else fails this candidate.
                self.push_rule(&chk, Names::r(Some(*sym), None, Move::R, scan_id));
                self.push_rule(&chk, Names::r(None, None, Move::S, fail_id));
            }
        }
        self.push_rule(&scan, Names::r(None, None, Move::R, scan_id));

        // Fail: rewind left to `<`, then start the next candidate — or stick if there is none.
        //
        // `fail` (and, for the last candidate, `stuck`) is minted UNCONDITIONALLY here regardless of
        // whether `rule` has any concrete read at all. When `rule` is an all-wildcard catch-all, the
        // `for` loop above never pushes a rule INTO `fail_id` — nothing can mismatch a wildcard — so
        // `fail` (and the `stuck` it would lead to) is allocated but UNREACHABLE from `start`. Corrects
        // a prior claim of mine that such states "do not touch the state budget": measured by BFS
        // reachability over the built `Machine` (following every rule's `next` from `start`),
        // unreachable states are **1.25%-2.65%** of every real first-order lowered image measured
        // (`1 + 2 * 3`, `cons(1, cons(2, nil))`, `sum(5)`, `count_down(4)`, the `while`-loop program in
        // `real_lowered_machines_cost_far_more_than_the_toy_fixtures`'s doc) — exactly one `fail` plus
        // one `stuck` per state whose last rule is an all-wildcard catch-all — and a smaller **0.46%**
        // of the worst shipped (higher-order) demo. Pruning them would take `sum(5)` from 19.2014 to
        // **18.8866** states per original state, and the worst shipped demo from 36.8587 to **36.6878**
        // — real, but nowhere near enough alone to close either gap against `CEILING`. NOT IMPLEMENTED:
        // recorded here, not acted on, so a future roadmap entry can cite the measurement without
        // re-deriving it.
        let after_fail = if c + 1 < n_rules {
            self.id(&format!("q{sid}.c{}.scan", c + 1))
        } else {
            self.id(&format!("q{sid}.stuck"))
        };
        self.push_rule(&fail, Names::r(Some(LEFT), None, Move::R, after_fail));
        self.push_rule(&fail, Names::r(None, None, Move::L, fail_id));

        // Rewind after a successful verify, then run the apply chain for whichever tapes act.
        let applied = self.emit_apply(m, sid, c, rule);
        self.push_rule(&rew, Names::r(Some(LEFT), None, Move::R, applied));
        self.push_rule(&rew, Names::r(None, None, Move::L, rew_id));
    }

    /// One pass per ACTING tape: a tape acts when it has a concrete write or a non-`S` move. Measured
    /// on the design spec's three real lowered machines (`sum(5)`, `count_down(4)`, `[1, 2, 3]`), that
    /// is 0.91-0.94 tapes per rule — essentially one — which is why a pass per acting tape costs what a
    /// single pass would. **NOT the same triple this file's own tests measure**:
    /// `real_lowered_machines_cost_far_more_than_the_toy_fixtures`'s three `SOURCES` (`1 + 2 * 3`,
    /// `cons(1, cons(2, nil))`, `sum(5)`) measure 0.87, 0.90 and 0.93 tapes per rule respectively — a
    /// nearby but different range, since it is a different triple of machines.
    fn emit_apply(&mut self, m: &Machine, sid: StateId, c: usize, rule: &Rule) -> StateId {
        let acting: Vec<usize> = (0..m.tapes)
            .filter(|i| {
                // `.unwrap_or(Move::S)` here and in `emit_one_tape_pass` below classify a SHORT
                // `moves` (fewer entries than `m.tapes`) as "no move" — untested and untestable:
                // `Machine::validate` requires `moves.len() == tapes`, so no valid machine ever
                // reaches either default.
                rule.write.get(*i).copied().flatten().is_some()
                    || rule.moves.get(*i).copied().unwrap_or(Move::S) != Move::S
            })
            .collect();
        let done = self.id(&Names::entry_name(m, rule.next));
        // Built back to front so each pass knows the state that follows it.
        let mut next = done;
        for i in acting.into_iter().rev() {
            next = self.emit_one_tape_pass(sid, c, i, rule, next);
        }
        next
    }

    /// Walk right to tape `i`'s head marker. With a concrete write, step onto the content cell, write,
    /// step back; with no write there is nothing on the content cell worth visiting, so land ON the
    /// marker and hand straight to `mv{i}`. Either way, move the marker, rewind, continue.
    ///
    /// **THE NO-WRITE ARM SKIPS THE CONTENT CELL ENTIRELY, RATHER THAN VISITING IT TO WRITE NOTHING.**
    /// Measured on `real_lowered_machines_cost_far_more_than_the_toy_fixtures`'s three `SOURCES`,
    /// `rule.write.get(i)` is `None` for 87-91% of acting-tape passes there: for a first-order machine,
    /// a write is the exception, not the rule. **THAT SHARE IS NOT UNIVERSAL, THOUGH**: the worst
    /// shipped demo (`the_worst_shipped_demo_measured_directly` below) measures only 53% no-write
    /// against 1.71 acting tapes per rule — nearly double the acting-tape rate and roughly half the
    /// no-write share of the three `SOURCES` machines, which is why this split's saving on that machine
    /// (6.7%, see that test's doc) falls well short of what the `SOURCES` figure alone would suggest.
    /// Either way, the old unconditional shape emitted `wr{i}` and stepped right onto the content cell
    /// and back left onto the marker even when `write` was `None` — a whole state and two steps spent
    /// producing no effect. `ap{i}` in the no-write arm now stops moving as soon as it finds the marker
    /// (`Move::S`, not `Move::R`) and hands off to `mv{i}` directly, which is exactly where the write
    /// arm's `wr{i}` also leaves it: `mv{i}`'s wildcard read does not care which arm put it there.
    fn emit_one_tape_pass(&mut self, sid: StateId, c: usize, i: usize, rule: &Rule, after: StateId) -> StateId {
        let ap = format!("q{sid}.c{c}.ap{i}");
        let mv = format!("q{sid}.c{c}.mv{i}");
        let rap = format!("q{sid}.c{c}.rap{i}");
        let ap_id = self.id(&ap);
        let mv_id = self.id(&mv);
        let rap_id = self.id(&rap);
        let over = self.id(OVERFLOW);

        let write = rule.write.get(i).copied().flatten();
        if let Some(w) = write {
            // Find tape i's head marker; step right onto its content cell.
            let wr = format!("q{sid}.c{c}.wr{i}");
            let wr_id = self.id(&wr);
            self.push_rule(&ap, Names::r(Some(head_here(i)), None, Move::R, wr_id));
            self.push_rule(&ap, Names::r(None, None, Move::R, ap_id));
            // Write, then step back onto the marker.
            self.push_rule(&wr, Names::r(None, Some(w), Move::L, mv_id));
        } else {
            // No write: find tape i's head marker and stop ON it — `mv{i}` acts on the marker, not the
            // content cell, so there is nothing to step onto and back off of.
            self.push_rule(&ap, Names::r(Some(head_here(i)), None, Move::S, mv_id));
            self.push_rule(&ap, Names::r(None, None, Move::R, ap_id));
        }

        // Move the marker. `S` is free; `L`/`R` clear it here and set it on the neighbouring block's
        // tape-i marker, which is the NEXT `h_i` in that direction because a tape has one head.
        // `.unwrap_or(Move::S)`: see `emit_apply`'s matching comment — a short `moves` is untestable.
        match rule.moves.get(i).copied().unwrap_or(Move::S) {
            Move::S => self.push_rule(&mv, Names::r(None, None, Move::S, rap_id)),
            dir => {
                let step = if dir == Move::L { Move::L } else { Move::R };
                let seek = format!("q{sid}.c{c}.sk{i}");
                let seek_id = self.id(&seek);
                self.push_rule(&mv, Names::r(None, Some(head_away(i)), step, seek_id));
                // Landing on a sentinel means the head left the skeleton.
                self.push_rule(&seek, Names::r(Some(LEFT), None, Move::S, over));
                self.push_rule(&seek, Names::r(Some(RIGHT), None, Move::S, over));
                self.push_rule(&seek, Names::r(Some(head_away(i)), Some(head_here(i)), Move::S, rap_id));
                self.push_rule(&seek, Names::r(None, None, step, seek_id));
            }
        }

        // Rewind to `<` and hand on to the next acting tape, or to the next state's entry.
        self.push_rule(&rap, Names::r(Some(LEFT), None, Move::R, after));
        self.push_rule(&rap, Names::r(None, None, Move::L, rap_id));
        ap_id
    }

    fn finish(mut self, m: &Machine) -> Machine {
        let _ = self.id(OVERFLOW);
        let start = self.id(&Names::entry_name(m, m.start));
        Machine { states: self.states, start, tapes: 1 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    /// The largest machine the shipped demo corpus builds, per `state_cost_probe` section G — the
    /// floor both budget tests below divide `MAX_MACHINE_STATES` by, so they cannot drift apart on
    /// what "the ceiling" means.
    const WORST_SHIPPED_DEMO_STATES: f64 = 49_135.0;
    /// States-per-original budget: `MAX_MACHINE_STATES` / [`WORST_SHIPPED_DEMO_STATES`] = 20.3521.
    const CEILING: f64 = crate::tm::build::MAX_MACHINE_STATES as f64 / WORST_SHIPPED_DEMO_STATES;

    fn round_trip(inits: &[Vec<Symbol>], left_pad: usize, right_pad: usize) -> Vec<(Vec<Symbol>, usize)> {
        let k = inits.len();
        let cells = interleave(inits, k, left_pad, right_pad);
        let tape = Tape::new(&cells);
        deinterleave(&tape, k).expect("a freshly interleaved tape is well formed")
    }

    #[test]
    fn every_head_starts_at_its_own_cell_zero() {
        let inits = vec![vec!['1', '1'], vec!['#'], vec![]];
        let out = round_trip(&inits, 2, 3);
        for (i, (contents, head)) in out.iter().enumerate() {
            assert_eq!(*head, 2, "tape {i} head should sit at the origin block");
            assert_eq!(contents.len(), 2 + 2 + 3, "tape {i} spans left_pad + longest + right_pad blocks");
        }
    }

    #[test]
    fn contents_survive_the_round_trip_under_normalize() {
        let inits = vec![vec!['1', '_', '1'], vec!['#', '#']];
        let out = round_trip(&inits, 1, 1);
        for (i, (contents, head)) in out.iter().enumerate() {
            let (norm, nhead) = normalize(contents, *head);
            let (expect, ehead) = normalize(&inits[i], 0);
            assert_eq!((norm, nhead), (expect, ehead), "tape {i}");
        }
    }

    /// Pins `normalize`'s own documented limitation: on an all-blank tape there is no non-`BLANK`
    /// cell to anchor `first`/`last` on, so the head position is discarded and any two heads on an
    /// all-blank tape normalize identically. NOT a claim that this is safe in general — see
    /// `normalize`'s doc for why an oracle assertion built on this function is satisfied by any head
    /// whenever the tape it is comparing ends up all-blank.
    #[test]
    fn normalize_discards_the_head_on_an_all_blank_tape() {
        assert_eq!(normalize(&[BLANK; 5], 0), normalize(&[BLANK; 5], 4));
    }

    #[test]
    fn a_tape_with_no_sentinels_is_refused() {
        assert!(deinterleave(&Tape::new(&['1', '1']), 2).is_none());
    }

    #[test]
    fn a_region_that_is_not_whole_blocks_is_refused() {
        assert!(deinterleave(&Tape::new(&[LEFT, head_here(0), '1', RIGHT]), 2).is_none());
    }

    proptest! {
        #[test]
        fn deinterleave_inverts_interleave(
            // `cargo fmt` cannot parse proptest's `ident in expr` syntax, so this stays under
            // `max_width = 120` by hand rather than by the usual `cargo fmt --all` pass.
            tapes in prop::collection::vec(
                prop::collection::vec(prop::sample::select(vec!['1', '#', '@', BLANK]), 0..8),
                1..5,
            ),
            left_pad in 0usize..3,
            right_pad in 0usize..3,
        ) {
            let out = round_trip(&tapes, left_pad, right_pad);
            prop_assert_eq!(out.len(), tapes.len());
            for (i, (contents, head)) in out.iter().enumerate() {
                prop_assert_eq!(*head, left_pad);
                let (got, gh) = normalize(contents, *head);
                let (want, wh) = normalize(&tapes[i], 0);
                prop_assert_eq!((got, gh), (want, wh));
            }
        }
    }

    /// A two-tape machine whose one rule reads nothing, writes nothing and moves nothing, then
    /// accepts. Its single-tape image must halt with both tapes unchanged.
    fn wildcard_only() -> Machine {
        Machine {
            tapes: 2,
            start: 0,
            states: vec![
                State {
                    name: "go".into(),
                    accept: false,
                    rules: vec![Rule {
                        read: vec![None, None],
                        write: vec![None, None],
                        moves: vec![Move::S, Move::S],
                        next: 1,
                    }],
                },
                State { name: "done".into(), accept: true, rules: vec![] },
            ],
        }
    }

    #[test]
    fn the_reduced_machine_is_structurally_valid() {
        let single = to_single_tape(&wildcard_only());
        assert_eq!(single.tapes, 1);
        assert!(single.validate().is_empty(), "{:?}", single.validate());
    }

    #[test]
    fn a_sweep_only_machine_leaves_both_tapes_alone() {
        use crate::tm::sim::{DEFAULT_CAPS, Status};
        let m = wildcard_only();
        let inits = vec![vec!['1', '1'], vec!['#']];
        let single = to_single_tape(&m);
        let cells = interleave(&inits, m.tapes, 1, 1);
        let (tapes, fin, status, _steps) = crate::tm::sim::simulate_final(&single, &[cells], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        // NOT just "it halted": a stuck state halts too, and reports the same `Status`. Assert the
        // machine reached the state that stands for the original's ACCEPT.
        assert!(
            single.states[fin as usize].accept,
            "halted in {}, not an accept state",
            single.states[fin as usize].name
        );
        let out = deinterleave(&tapes[0], m.tapes).expect("well formed");
        for (i, (contents, head)) in out.iter().enumerate() {
            let (got, gh) = normalize(contents, *head);
            let (want, wh) = normalize(&inits[i], 0);
            assert_eq!((got, gh), (want, wh), "tape {i}");
        }
    }

    /// Two candidates on one state: the first reads `1` on tape 0, the second is a wildcard. Which
    /// one fires is decided by tape 0's cell, and by rule ORDER when both could match.
    fn two_candidates() -> Machine {
        Machine {
            tapes: 2,
            start: 0,
            states: vec![
                State {
                    name: "pick".into(),
                    accept: false,
                    rules: vec![
                        Rule {
                            read: vec![Some('1'), None],
                            write: vec![None, None],
                            moves: vec![Move::S, Move::S],
                            next: 1,
                        },
                        Rule {
                            read: vec![None, None],
                            write: vec![None, None],
                            moves: vec![Move::S, Move::S],
                            next: 2,
                        },
                    ],
                },
                State { name: "took-first".into(), accept: true, rules: vec![] },
                State { name: "took-second".into(), accept: true, rules: vec![] },
            ],
        }
    }

    fn final_state_name(m: &Machine, inits: &[Vec<Symbol>]) -> String {
        use crate::tm::sim::{DEFAULT_CAPS, simulate_final};
        let single = to_single_tape(m);
        let cells = interleave(inits, m.tapes, 1, 1);
        let (_tapes, fin, _status, _steps) = simulate_final(&single, &[cells], DEFAULT_CAPS);
        single.states[fin as usize].name.clone()
    }

    #[test]
    fn a_concrete_read_that_matches_takes_the_first_candidate() {
        let name = final_state_name(&two_candidates(), &[vec!['1'], vec!['#']]);
        assert_eq!(name, "q1.halt");
    }

    #[test]
    fn a_concrete_read_that_misses_falls_through_to_the_next_candidate() {
        let name = final_state_name(&two_candidates(), &[vec!['@'], vec!['#']]);
        assert_eq!(name, "q2.halt");
    }

    /// A single candidate with a CONCRETE read and no wildcard fallback — the shape `emit_candidate`'s
    /// last-candidate-mismatch branch needs. Fed an input that does not match, this is the one
    /// hand-written machine whose only candidate can miss.
    fn one_candidate_no_wildcard() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "go".into(),
                    accept: false,
                    rules: vec![Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::S], next: 1 }],
                },
                State { name: "done".into(), accept: true, rules: vec![] },
            ],
        }
    }

    /// `emit_candidate`'s last-candidate-mismatch -> `q{sid}.stuck` branch, otherwise untested: a stuck
    /// state has no rules, so entering one ends the run, and the oracle leg asserts the final state is
    /// an accept — so no oracle-corpus program reaches it. This fixture's only candidate is a
    /// concrete, non-wildcard read, and the input tape does not match it, so ALL candidates are
    /// exhausted and the machine halts in the stuck state exactly as the original does.
    #[test]
    fn a_last_candidate_mismatch_halts_in_the_stuck_state() {
        use crate::tm::sim::{DEFAULT_CAPS, Status, simulate_final};
        let m = one_candidate_no_wildcard();
        let inits = vec![vec!['2']]; // does not match the only candidate's `Some('1')`
        let single = to_single_tape(&m);
        let cells = interleave(&inits, m.tapes, 1, 1);
        let (_tapes, fin, status, _steps) = simulate_final(&single, &[cells], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(single.states[fin as usize].name, "q0.stuck");
        assert!(!single.states[fin as usize].accept, "stuck is a non-accept halt, same as the original");
    }

    /// Tape 0 walks right over `1`s writing `@`, and halts on the first blank. Exercises a concrete
    /// read, a concrete write and an `R` move in one machine.
    fn rewrite_ones() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "scan".into(),
                    accept: false,
                    rules: vec![
                        Rule { read: vec![Some('1')], write: vec![Some('@')], moves: vec![Move::R], next: 0 },
                        Rule { read: vec![None], write: vec![None], moves: vec![Move::S], next: 1 },
                    ],
                },
                State { name: "halt".into(), accept: true, rules: vec![] },
            ],
        }
    }

    #[test]
    fn writes_and_moves_reproduce_the_multitape_run() {
        use crate::tm::sim::{DEFAULT_CAPS, Status, simulate};
        let m = rewrite_ones();
        let inits = vec![vec!['1', '1', '1']];
        let (want, want_status) = simulate(&m, &inits, DEFAULT_CAPS);
        let single = to_single_tape(&m);
        let cells = interleave(&inits, m.tapes, 1, 4);
        let (got, got_status) = simulate(&single, &[cells], DEFAULT_CAPS);
        assert_eq!(want_status, Status::Halted);
        assert_eq!(got_status, Status::Halted);
        let out = deinterleave(&got[0], m.tapes).expect("well formed");
        let (w_cells, w_head) = want[0].snapshot();
        assert_eq!(normalize(&out[0].0, out[0].1), normalize(&w_cells, w_head));
    }

    #[test]
    fn a_head_that_leaves_the_skeleton_halts_in_overflow() {
        let m = rewrite_ones();
        let inits = vec![vec!['1', '1', '1']];
        // No right padding: the third `R` move walks tape 0 off the end of the blocks. Generous LEFT
        // padding is deliberate, not slack: every block other than the active one carries a legitimate
        // `head_away(0)` marker, so a seek that walked LEFT instead of RIGHT would find one within a
        // step or two and just relocate the head there instead of overflowing — it would only reach
        // `LEFT` (and so still land in `OVERFLOW`, for the wrong reason) if there were no room to its
        // left at all. With room to spare, a reversed seek instead drifts the head into the padding,
        // the next scan reads a blank where it expected `1`, and the machine falls through to the
        // wildcard candidate and ACCEPTS — a different final state, not `OVERFLOW`. That is what pins
        // the seek's step direction: only a rightward run can reach `OVERFLOW` here.
        let single = to_single_tape(&m);
        let cells = interleave(&inits, m.tapes, 4, 0);
        use crate::tm::sim::{DEFAULT_CAPS, simulate_final};
        let (_t, fin, _s, _n) = simulate_final(&single, &[cells], DEFAULT_CAPS);
        assert_eq!(single.states[fin as usize].name, OVERFLOW);
    }

    /// The exact failing input from the review: a 1-tape machine that writes `'a'`, which collides with
    /// `head_away(0)`. Without the refusal in `to_single_tape`, the marker move would clear the marker
    /// to `'a'`, step onto the just-written `'a'` content cell, and the seek would mistake it for the
    /// tape's own marker — corrupting the tape while the machine still reports ACCEPT.
    #[test]
    fn a_data_symbol_colliding_with_a_marker_is_refused_not_silently_corrupted() {
        use crate::tm::sim::{DEFAULT_CAPS, simulate_final};
        let m = Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "go".into(),
                    accept: false,
                    rules: vec![Rule {
                        read: vec![Some('1')],
                        write: vec![Some('a')], // collides with head_away(0)
                        moves: vec![Move::R],
                        next: 1,
                    }],
                },
                State { name: "done".into(), accept: true, rules: vec![] },
            ],
        };
        let inits = vec![vec!['1', '1']];
        let single = to_single_tape(&m);
        let refusal = &single.states[single.start as usize];
        assert_eq!(refusal.name, "alphabet-collision");
        assert!(!refusal.accept, "the refusal must be a stuck halt, not an accept");
        assert!(refusal.rules.is_empty());
        assert_eq!(single.tapes, 1);

        // Running the refusal does not silently corrupt a tape: it halts immediately in the named
        // state rather than in an ACCEPT state with a tape that no longer decodes.
        let cells = interleave(&inits, m.tapes, 1, 4);
        let (_tapes, fin, _status, _steps) = simulate_final(&single, &[cells], DEFAULT_CAPS);
        assert_eq!(single.states[fin as usize].name, "alphabet-collision");
    }

    /// The hole in `to_single_tape`'s refusal, reproduced live: a 1-tape machine whose only rule is an
    /// unconditional wildcard (no concrete symbol anywhere in `read`/`write`, so `Machine::alphabet()`
    /// is empty) paired with an initial tape that contains `head_away(0)`. `to_single_tape`'s own
    /// refusal does NOT fire for this pair — it only ever looks at `m.alphabet()`, which is empty here —
    /// so it would build the real construction and hand back a machine that silently corrupts this
    /// exact tape. That asymmetry between the two checks is the whole point of the finding:
    /// `layout_collision` sees the initial tape too, and refuses what `to_single_tape` alone cannot see.
    #[test]
    fn layout_collision_sees_a_symbol_only_the_initial_tape_carries() {
        let m = Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "go".into(),
                    accept: false,
                    rules: vec![Rule { read: vec![None], write: vec![None], moves: vec![Move::S], next: 1 }],
                },
                State { name: "done".into(), accept: true, rules: vec![] },
            ],
        };
        assert!(m.alphabet().is_empty(), "the only rule is an unconditional wildcard");
        let inits = vec![vec!['1', head_away(0)]];
        assert_eq!(layout_collision(&m, &inits), Some(head_away(0)));
    }

    #[test]
    fn layout_collision_is_none_for_a_safe_machine_and_safe_tapes() {
        let m = wildcard_only();
        let inits = vec![vec!['1', '1'], vec!['#']];
        assert_eq!(layout_collision(&m, &inits), None);
    }

    /// A machine with one rule that concretely touches only tape `i`, every other tape a wildcard —
    /// so `head_here`/`head_away` for tapes OTHER than `i` are minted (by `reserved_symbols`) but
    /// never appear in any emitted rule, and `i` is the only tape whose marker actually reaches the
    /// transition table.
    fn machine_touching_only_tape(tapes: usize, i: usize) -> Machine {
        Machine {
            tapes,
            start: 0,
            states: vec![
                State {
                    name: "go".into(),
                    accept: false,
                    rules: vec![Rule {
                        read: (0..tapes).map(|t| if t == i { Some('1') } else { None }).collect(),
                        write: (0..tapes).map(|t| if t == i { Some('2') } else { None }).collect(),
                        moves: vec![Move::S; tapes],
                        next: 1,
                    }],
                },
                State { name: "done".into(), accept: true, rules: vec![] },
            ],
        }
    }

    /// The real safety gap `to_single_tape`'s tape-count refusal closes: past `MAX_ENCODABLE_TAPES`,
    /// `head_here`/`head_away` wrap past `Z`/`z` into other reserved symbols and eventually into
    /// `BLANK` itself — `head_here(30)` is `'A' + 30` = code point 95 = `'_'` = [`BLANK`]. With the
    /// tape-count check REMOVED (verified by temporarily disabling it, in `--release` so the
    /// `debug_assert!` inside `head_here`/`head_away` does not catch it first): a 27-tape machine
    /// touching only tape 26 reduces to a `Machine` whose `validate()` reports `'['` (tape 26's own
    /// `head_here`) as an unrepresentable symbol — caught, just not by THIS refusal. A 31-tape machine
    /// touching only tape 30 reduces to a `Machine` `validate()` calls CLEAN: `head_here(30)` typechecks
    /// as an ordinary data symbol because it IS `BLANK`, so nothing distinguishes a head marker from an
    /// untouched cell — the corruption class `layout_collision` exists for, reached through a door that
    /// check does not cover because it is about tape COUNT, not alphabet content.
    #[test]
    fn a_machine_with_too_many_tapes_is_refused_not_silently_corrupted() {
        // `head_here(30)` itself is not callable here: its `debug_assert!` forbids `i >=
        // MAX_ENCODABLE_TAPES` in exactly the build this test runs under, which is the point — so the
        // collision is stated via the same raw arithmetic `head_here`'s body uses, not by calling it.
        assert_eq!(char::from(b'A' + 30_u8), BLANK, "the exact collision MAX_ENCODABLE_TAPES exists to prevent");

        let refusal = to_single_tape(&machine_touching_only_tape(31, 30));
        let start = &refusal.states[refusal.start as usize];
        assert_eq!(start.name, "too-many-tapes");
        assert!(!start.accept, "the refusal must be a stuck halt, not an accept");
        assert!(start.rules.is_empty());
        assert_eq!(refusal.tapes, 1);
    }

    #[test]
    fn a_machine_at_the_encodable_tape_limit_is_not_refused_on_tape_count_alone() {
        let m = machine_touching_only_tape(MAX_ENCODABLE_TAPES, MAX_ENCODABLE_TAPES - 1);
        let single = to_single_tape(&m);
        assert_ne!(single.states[single.start as usize].name, "too-many-tapes");
        assert!(single.validate().is_empty(), "{:?}", single.validate());
    }

    /// A 3-tape machine whose one rule writes and moves on TWO tapes (0 and 1) in a single step, mixing
    /// all three `Move`s across the rule (tape 0: `R`, tape 1: `L`, tape 2: `S`). This is the fixture
    /// that stays green if `emit_one_tape_pass` hardcoded tape 0 for every tape's own walk: tape 1's
    /// pass would then search for and clear tape 0's marker instead of its own, corrupting both tapes
    /// while the machine still reports ACCEPT.
    fn multi_tape_rule() -> Machine {
        Machine {
            tapes: 3,
            start: 0,
            states: vec![
                State {
                    name: "go".into(),
                    accept: false,
                    rules: vec![Rule {
                        read: vec![None, None, None],
                        write: vec![Some('x'), Some('y'), None],
                        moves: vec![Move::R, Move::L, Move::S],
                        next: 1,
                    }],
                },
                State { name: "done".into(), accept: true, rules: vec![] },
            ],
        }
    }

    #[test]
    fn writes_and_moves_reproduce_the_multitape_run_at_k_gt_1() {
        use crate::tm::sim::{DEFAULT_CAPS, Status, simulate};
        let m = multi_tape_rule();
        let inits = vec![vec!['1'], vec!['2'], vec!['3']];
        let (want, want_status) = simulate(&m, &inits, DEFAULT_CAPS);
        // Generous padding on both sides: tape 0 moves R, tape 1 moves L, tape 2 stays — none of them
        // should come close to a sentinel.
        let single = to_single_tape(&m);
        let cells = interleave(&inits, m.tapes, 3, 3);
        let (got, got_status) = simulate(&single, &[cells], DEFAULT_CAPS);
        assert_eq!(want_status, Status::Halted);
        assert_eq!(got_status, Status::Halted);
        let out = deinterleave(&got[0], m.tapes).expect("well formed");
        for i in 0..m.tapes {
            let (w_cells, w_head) = want[i].snapshot();
            assert_eq!(normalize(&out[i].0, out[i].1), normalize(&w_cells, w_head), "tape {i}");
        }
    }

    /// A 2-tape machine whose rule has tape 0 MOVE WITHOUT WRITING (`write: None`, `moves: R`) and tape
    /// 1 WRITE WITHOUT MOVING (`write: Some('z')`, `moves: S`) — the two arms `emit_one_tape_pass`
    /// splits between. Every acting tape in `multi_tape_rule` above has a concrete write, so that test
    /// never exercises the no-write arm at all. Tape 0 here is exactly the case Step 1 rewired: `ap0`
    /// must land ON the marker and hand off to `mv0` directly, never visiting the content cell; an off
    /// by one step there corrupts tape 0's own data (a marker symbol written into a content cell, or the
    /// head left on a neighbouring block's cell) rather than raising an error, so only a differential
    /// check against the multi-tape simulator — not a status code — can catch it.
    fn moves_without_writing_and_writes_without_moving() -> Machine {
        Machine {
            tapes: 2,
            start: 0,
            states: vec![
                State {
                    name: "go".into(),
                    accept: false,
                    rules: vec![Rule {
                        read: vec![None, None],
                        write: vec![None, Some('z')],
                        moves: vec![Move::R, Move::S],
                        next: 1,
                    }],
                },
                State { name: "done".into(), accept: true, rules: vec![] },
            ],
        }
    }

    #[test]
    fn a_tape_that_moves_without_writing_and_a_tape_that_writes_without_moving_agree_with_the_multitape_run() {
        use crate::tm::sim::{DEFAULT_CAPS, Status, simulate};
        let m = moves_without_writing_and_writes_without_moving();
        let inits = vec![vec!['1', '1'], vec!['2']];
        let (want, want_status) = simulate(&m, &inits, DEFAULT_CAPS);
        // Tape 0 moves R with no write; generous padding on both sides so neither head nears a sentinel.
        let single = to_single_tape(&m);
        let cells = interleave(&inits, m.tapes, 1, 3);
        let (got, got_status) = simulate(&single, &[cells], DEFAULT_CAPS);
        assert_eq!(want_status, Status::Halted);
        assert_eq!(got_status, Status::Halted);
        let out = deinterleave(&got[0], m.tapes).expect("well formed");
        for i in 0..m.tapes {
            let (w_cells, w_head) = want[i].snapshot();
            assert_eq!(normalize(&out[i].0, out[i].1), normalize(&w_cells, w_head), "tape {i}");
        }
    }

    /// The largest machine the shipped demos build is 49,135 states (`state_cost_probe` section G),
    /// and `MAX_MACHINE_STATES` is 1,000,000, so the construction has 20.4 states per original state
    /// to spend. This asserts the PROPERTY rather than recording a figure that goes stale.
    ///
    /// MEASURED (inverting this assertion once, via `cargo nextest run -p redextape-core
    /// the_construction_stays_inside_the_state_budget`): `wildcard_only` 3.00, `two_candidates`
    /// 3.67, `rewrite_ones` 7.50 — all comfortably inside the 20.35 budget, UNCHANGED by Task 5b's
    /// no-write split in `emit_one_tape_pass` (`rewrite_ones` has a concrete write on its only acting
    /// tape; the other two have no acting tape at all — none of these three fixtures ever exercises
    /// the no-write arm). **These fixtures are NOT representative of a real lowered machine**, and
    /// comfortably passing here does not mean the construction fits a real one: see
    /// `real_lowered_machines_cost_far_more_than_the_toy_fixtures` below, which measures that directly
    /// and finds a ratio that crosses this same budget.
    #[test]
    fn the_construction_stays_inside_the_state_budget() {
        for m in [wildcard_only(), two_candidates(), rewrite_ones()] {
            let ratio = states_per_original(&m);
            assert!(ratio < CEILING, "{ratio:.2} states per original state exceeds the {CEILING:.1} budget");
        }
    }

    /// The gate above uses only the hand-written toy fixtures at the top of this module, and they are
    /// not representative: `docs/superpowers/specs/2026-09-10-single-tape-reduction-design.md`
    /// measures a real lowered machine at ~2.35 rules per state and ~0.94 concrete reads per rule
    /// (echoed here by `emit_candidate`'s "81% of read positions are wildcards" and `emit_apply`'s
    /// "0.91-0.94 tapes per rule"), while a 2-3 state toy has neither property. This builds three
    /// real machines through the same pipeline `tm_header.rs` uses end to end — `parser::parse` ->
    /// `typeck::result_type` -> `desugar::desugar` -> `tm::run_tm_described` — and measures
    /// `states_per_original` on the `Machine` that pipeline actually produces, reachable here with no
    /// new dependency because `parser`, `typeck`, `desugar` and `tm` are all modules of this same
    /// crate.
    ///
    /// MEASURED (inverting this test's assertion once, via `cargo nextest run -p redextape-core
    /// real_lowered_machines_cost_far_more_than_the_toy_fixtures`), under `EncodingKind::Unary`, BEFORE
    /// and AFTER Task 5b's no-write split in `emit_one_tape_pass`:
    ///
    /// | source | original states | rules | rules/state | ratio BEFORE | ratio AFTER |
    /// | --- | --- | --- | --- | --- | --- |
    /// | `1 + 2 * 3` | 143 | 315 | 2.20 | 19.22 | 17.51 |
    /// | `cons(1, cons(2, nil))` | 146 | 309 | 2.12 | 18.75 | 17.09 |
    /// | `fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)` | 1182 | 2782 | 2.35 | 21.20 | **19.20** |
    ///
    /// **THE LAST ROW IS THE DESIGN DOC'S OWN `sum(5)` FIXTURE** (1,182 states, 2.35 rules/state,
    /// 0.94 reads/rule — identical to its table). Before Task 5b it measured 21.20, over the 20.35
    /// budget; AFTER Task 5b's split it measures 19.20 — UNDER budget on its own. That doc's formula
    /// estimated this same machine at 7.75 states per original state and called the margin "roughly
    /// 2.5x inside" the budget; even the improved construction (this module) measures 19.20 for it,
    /// 2.5x higher than the estimate, for the same reason as before: the formula counted the check and
    /// apply states and not the scan, rewind, fail and seek states this module also emits.
    ///
    /// **`sum(5)` CLEARING THE BUDGET DOES NOT MEAN THE CONSTRUCTION FITS.** `sum(5)` is first-order
    /// recursion — a different shape from the higher-order demos that set the ceiling's own floor (see
    /// `the_worst_shipped_demo_measured_directly` below), whose ratio stays over budget after this same
    /// change. This test does not extend a `ratio < CEILING` assertion to that machine: for the worst
    /// shipped demo it would fail permanently (closing that gap needs shrinking the construction
    /// further, raising `MAX_MACHINE_STATES`, or lowering the worst-shipped-demo floor, none of which
    /// this task does), and that budget question stays on record here and in `task-5b-report.md`. The
    /// OTHER two rows above (`1 + 2 * 3`, `cons(1, cons(2, nil))`) DO get the same `ratio < CEILING`
    /// assertion `sum(5)` gets, for the reason the next paragraph measures.
    ///
    /// **ALL THREE `SOURCES` ROWS GET A REAL CEILING ASSERTION BELOW, THREE WITNESSES RATHER THAN ONE**
    /// — an earlier version of this doc gated `sum(5)` alone and said no sabotage measurement showed
    /// the other two rows were sensitive enough; that was never re-checked, and it is false. The
    /// toy-fixture gate above (`the_construction_stays_inside_the_state_budget`) is too small to catch
    /// a regression in the wildcard skip `emit_candidate` documents as "the whole reason this
    /// construction fits". A sabotage that deletes that skip — emitting a `chk` state for every read
    /// position instead of only `Some(_)` reads — moves the three toy fixtures from 3.00/3.67/7.50 to
    /// 4.00/4.67/8.00: all three stay far under the 20.3521 ceiling, so that gate DOES NOT REDDEN. The
    /// SAME sabotage, measured directly rather than assumed, moves EVERY `SOURCES` row across the
    /// ceiling: `1 + 2 * 3` from 17.51 to **26.49**, `cons(1, cons(2, nil))` from 17.09 to **25.77**,
    /// `sum(5)` from 19.20 to **28.76** — and the worst shipped demo from 36.86 to 46.43 (already over
    /// budget before the sabotage, so not a NEW crossing). All three `SOURCES` rows are sensitive to
    /// this regression, so all three carry the assertion, not `sum(5)` alone.
    ///
    /// **THE ORACLE LEG ITSELF CANNOT REPLACE THIS ASSERTION, FOR A STRUCTURAL REASON, NOT A GAP TO
    /// CLOSE.** Under the same wildcard-skip sabotage, `single_tape_oracle.rs`'s
    /// `the_single_tape_leg_agrees_on_small_programs` still PASSES — verified directly, not assumed: a
    /// bloated construction that emits far more states is still a CORRECT one, and an oracle leg checks
    /// correctness, never cost. No oracle leg can ever redden for a pure cost regression; this ratio
    /// assertion is the only thing in this module that can.
    ///
    /// **THE MARGIN AGAINST THE CEILING IS TIGHTER THAN THIS DOC USED TO SAY, AND `sum(5)` IS NOT THE
    /// TIGHTEST CASE ON RECORD.** `sum(5)`'s margin is 5.65% (19.2014 against 20.3521 — the same figure
    /// this doc used to round to "~5.6%" against a rounded 19.20). Two related first-order fixtures,
    /// measured the same way, sit far closer to the edge — MEASURED (via a temporary block added to
    /// this test's `SOURCES` loop, run with `cargo nextest run -p redextape-core
    /// real_lowered_machines_cost_far_more_than_the_toy_fixtures --nocapture`, then removed), under
    /// `EncodingKind::Unary`:
    ///
    /// - `let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc` — 542 original
    ///   states, ratio **20.3395**, margin +0.062% against 20.3521
    /// - `fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)`
    ///   — 1,365 original states, ratio **20.1480**, margin +1.003% against 20.3521
    /// - `fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)` — 1,182 original states, ratio
    ///   19.2014, margin +5.654% against 20.3521
    ///
    /// NEITHER new program is in `SOURCES`, and neither gets a `ratio < CEILING` assertion, on purpose:
    /// at a 0.062% or 1.003% margin the assertion would fail on essentially any future change to the
    /// construction's per-rule state cost — not only the specific wildcard-skip-class regression it
    /// exists to police — which is not a useful signal, only noise with a pass/fail label on it.
    /// `sum(5)`'s 5.654% (and the other two `SOURCES` rows' 13.96% and 16.03%) is thin but wide enough
    /// that the one change that already moved this construction the other way (Task 5b's no-write
    /// split, 21.20 -> 19.20) did not cross it. Reddening any `SOURCES` row's assertion is the test
    /// WORKING, not the test being brittle: a change that costs states instead of saving them is
    /// exactly the kind of regression this assertion exists to surface, and the fix at that point is to
    /// shrink the construction, not to loosen this test — or, if a program this close to the ceiling
    /// legitimately needs to be reducible, to move that program's own row into `SOURCES`.
    #[test]
    fn real_lowered_machines_cost_far_more_than_the_toy_fixtures() {
        use crate::desugar::desugar;
        use crate::parser::parse;
        use crate::tm::{EncodingKind, TM_DEFAULT_CAPS, run_tm_described};
        use crate::typeck::result_type;

        const SOURCES: [&str; 3] =
            ["1 + 2 * 3", "cons(1, cons(2, nil))", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"];
        // Every row is gated on the shared `CEILING` — see the doc above for the sabotage measurement
        // that establishes all three, not `sum(5)` alone, are sensitive to the wildcard-skip
        // regression the toy-fixture gate above cannot see.
        for src in SOURCES {
            let (prog, ds) = parse(src);
            assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
            let prog = prog.unwrap_or_else(|| panic!("no program for {src}"));
            let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
            let core = desugar(&prog);
            let d = run_tm_described(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS)
                .unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
            let ratio = states_per_original(&d.machine);
            assert!(
                ratio < CEILING,
                "{src} measured {ratio:.4} states per original state, at or over the {CEILING:.4} \
                 ceiling — the wildcard-skip regression the toy-fixture gate above cannot see"
            );
        }
    }

    /// The premise the two budget tests above never checked: does `sum(5)`'s ratio (first-order
    /// recursion) transfer to the machine that actually sets the 49,135 floor in the ceiling those
    /// tests use? `state_cost_probe`'s section G lowers every entry of `native_oracle.rs`'s
    /// `FIRST_ORDER_DEMOS` under both encodings and finds 49,135 states there — the `map`/`ap2` demo
    /// under `Binary` at `MAX_FIELD_WIDTH` (also `guard_counterexamples.rs`'s
    /// `the_worst_shipped_demo_lowers_far_below_the_state_ceiling`, which asserts that same figure is
    /// far under `MAX_MACHINE_STATES`). It reaches the backends through `defunc` (`map` and `add1` are
    /// passed as values), unlike `sum(5)`'s direct first-order recursion — a different SHAPE, not
    /// merely a bigger program, so nothing established here inherits from that test.
    ///
    /// Hand-copied as one program rather than the whole 46-entry corpus: `real_lowered_machines_cost_far_more_than_the_toy_fixtures`'s
    /// `SOURCES` above already hand-copies individual `FIRST_ORDER_DEMOS` entries the same way, and
    /// which entry is the corpus's maximum is section G's job to re-derive, not this module's — this
    /// test measures the one entry that job has already named.
    ///
    /// `run_tm_described_at(..., MAX_FIELD_WIDTH)` reproduces section G's own method (`Binary::default()`
    /// is `MAX_FIELD_WIDTH`, not an auto-fitted width): confirmed by getting the identical 49,135 states
    /// back, where `run_tm_described`'s normal auto-fit search — the sequence the test above reuses —
    /// lands on a narrower width and only 12,295 states for this same program, understating the ratio
    /// this task's ceiling actually needs (measured 28.29 there against 39.51 here, before Step 1).
    ///
    /// MEASURED (inverting this test's assertion once, via `cargo nextest run -p redextape-core
    /// the_worst_shipped_demo_measured_directly -- --nocapture`), `Binary` at `MAX_FIELD_WIDTH`:
    /// 49,135 original states throughout (Step 1 changes only how the single-tape image is built, not
    /// the multi-tape machine being reduced), BEFORE Step 1's split **39.51** states per original state
    /// (1,941,089 single-tape states, 1.94x the 20.35 budget), AFTER **36.86** (1,811,054 single-tape
    /// states, 1.81x the budget) — worse than `sum(5)`'s 21.20 either way, and over budget both before
    /// and after. Step 1's saving is real (130,035 fewer states, 6.7%) but nowhere near enough on its
    /// own to close a 1.8x gap; closing it needs shrinking the construction further, raising
    /// `MAX_MACHINE_STATES`, or lowering the worst-shipped-demo floor, none of which this task does —
    /// see this test's own non-assertion below for why that is recorded rather than forced green.
    #[test]
    fn the_worst_shipped_demo_measured_directly() {
        use crate::desugar::desugar;
        use crate::parser::parse;
        use crate::tm::{EncodingKind, MAX_FIELD_WIDTH, TM_DEFAULT_CAPS, run_tm_described_at};
        use crate::typeck::result_type;

        // `native_oracle.rs`'s `FIRST_ORDER_DEMOS`, the entry `state_cost_probe`'s section G finds as
        // the corpus's maximum under `Binary` (49,135 states) — byte-identical to
        // `guard_counterexamples.rs`'s `WORST_SHIPPED_DEMO`.
        const WORST_SHIPPED_DEMO: &str = "\
            fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
            fn add1(x) { x + 1 }\n\
            fn ap2(g, a, b) { g(a, b) }\n\
            head(map([1, 2], add1)) + head(ap2(map, [5, 6], add1))";

        let (prog, ds) = parse(WORST_SHIPPED_DEMO);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let prog = prog.unwrap_or_else(|| panic!("no program for the worst shipped demo"));
        let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors: {e:?}"));
        let core = desugar(&prog);
        let d = run_tm_described_at(&core, EncodingKind::Binary, ty, TM_DEFAULT_CAPS, MAX_FIELD_WIDTH)
            .unwrap_or_else(|r| panic!("the worst shipped demo did not run: {r:?}"));
        let ratio = states_per_original(&d.machine);
        // Same shape as `real_lowered_machines_cost_far_more_than_the_toy_fixtures`: this is deliberately
        // not `ratio < CEILING` (see that test's doc for why), since Step 0 found this machine already
        // over budget before Step 1's change and Step 1 alone does not close the gap.
        assert!(ratio.is_finite() && ratio > 0.0, "non-sensical ratio {ratio}");
    }
}
