//! A universal Turing machine: ONE fixed machine, built once with `Builder`, that runs any guest machine
//! laid out on its tapes.
//!
//! **NOTHING ABOUT A GUEST IS BUILT INTO THE UTM.** The guest's tape count, its state-id width and its
//! symbol-code width are never stored as numbers the UTM reads: every field on the UTM's tapes is
//! delimited, so the UTM compares fields by walking them in lockstep and never counts. One machine
//! therefore runs a guest of any tape count, any number of states and any alphabet.
//!
//! **THE FIVE TAPES.**
//!
//! | tape | holds |
//! | --- | --- |
//! | [`TABLE`] | the accept list, then every rule in the guest's own order, then the guest alphabet |
//! | [`STATE`] | a status cell, then the guest's current state id |
//! | [`GUEST`] | every guest tape as one track per tape, a block per cell, with head and origin markers |
//! | [`KEY`] | the code under each guest head, one slot per guest tape |
//! | [`ACTION`] | the matched rule's move and write for each guest tape, one slot per guest tape |
//!
//! **ONE GUEST STEP** is a whole-table scan: the UTM walks [`TABLE`] from its start and takes the first
//! rule whose state id equals [`STATE`]'s and whose every read code equals [`KEY`]'s or is the wildcard.
//! It copies that rule's writes, moves and next state, then applies them to [`GUEST`] in two sweeps: a
//! rightward sweep writes and moves the heads going right or staying, and a leftward sweep writes and
//! moves the heads going left and reads every head's new code into [`KEY`] for the next step. An accept
//! state in the accept list halts the UTM in `guest-accepted`; a state no rule matches halts it in
//! `guest-stuck`. The status cell on [`STATE`] records which, so [`decode_guest`] needs only the tapes.

use std::collections::BTreeSet;

use crate::tm::build::{Builder, MAX_TAPES, RuleSpec};
use crate::tm::machine::{BLANK, Machine, Move, StateId, Symbol};
use crate::tm::one_way::OriginSnapshot;
use crate::tm::sim::Tape;

/// The rule table.
pub const TABLE: usize = 0;
/// The status cell and the guest's current state id.
pub const STATE: usize = 1;
/// The guest's tapes, interleaved as tracks.
pub const GUEST: usize = 2;
/// The code under each guest head.
pub const KEY: usize = 3;
/// The matched rule's move and write for each guest tape.
pub const ACTION: usize = 4;

/// The most guest tapes [`encode_guest`] lays out: the most a parsed `.tm` file may declare. The UTM itself
/// has no limit, since tracks are delimited; this bounds what `encode_guest` allocates.
pub const MAX_GUEST_TAPES: usize = MAX_TAPES;

const TABLE_START: Symbol = '^';
const TABLE_END: Symbol = '$';
const ACCEPT_ENTRY: Symbol = 'A';
const RULE_ENTRY: Symbol = 'Q';
const ID_END: Symbol = '.';
const FIELD_END: Symbol = ',';
const SECTION_END: Symbol = '/';
/// A wildcard read, or a write that leaves the cell unchanged.
const ANY: Symbol = '?';
const ZERO: Symbol = '0';
const ONE: Symbol = '1';
const LEFT: Symbol = 'L';
const RIGHT: Symbol = 'R';
const STAY: Symbol = 'S';
const PENDING_LEFT: Symbol = 'l';
const PENDING_RIGHT: Symbol = 'r';
const RUNNING: Symbol = '?';
const ACCEPTED: Symbol = 'Y';
const STUCK: Symbol = 'N';
const LEFT_END: Symbol = '<';
const RIGHT_END: Symbol = '>';
const BLOCK: Symbol = '|';
const ORIGIN_BLOCK: Symbol = 'o';
const HEAD: Symbol = 'H';
const ARRIVED: Symbol = 'h';
const NO_HEAD: Symbol = '-';

const BITS: [Symbol; 2] = [ZERO, ONE];
const FLAGS: [Symbol; 3] = [HEAD, ARRIVED, NO_HEAD];
const DELIMITERS: [Symbol; 2] = [BLOCK, ORIGIN_BLOCK];
const ACTION_MOVES: [Symbol; 5] = [LEFT, RIGHT, STAY, PENDING_LEFT, PENDING_RIGHT];
/// Bits per character in the alphabet written after [`TABLE_END`]: enough for any Unicode scalar value.
const CHAR_BITS: usize = 21;

/// Where a guest run stands, as the status cell on [`STATE`] records it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GuestStatus {
    /// The status cell's `?`: the guest has neither accepted nor got stuck. Freshly encoded tapes read
    /// this, and so does a guest still running forever in its own states; a tape taken mid-step, while the
    /// UTM is between guest steps, may also read this, with a configuration the guest never had.
    Running,
    /// The guest reached an accept state.
    Accepted,
    /// The guest reached a state with no rule matching its tapes.
    Stuck,
}

/// A guest run read back out of the UTM's tapes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GuestRun {
    pub status: GuestStatus,
    /// One per guest tape, in guest symbols, with the head and cell 0 located.
    pub tapes: Vec<OriginSnapshot>,
}

/// The fixed universal machine. Its start state expects the tapes [`encode_guest`] lays out.
#[must_use]
pub fn universal_machine() -> Machine {
    let mut b = Builder::new();
    let boot = b.state("boot");
    let sweep_left = b.state("sweep-left");
    let match_entry = b.state("match");
    let copy_entry = b.state("copy");
    let sweep_right = b.state("sweep-right");
    let accepted = b.accept("guest-accepted");
    let stuck = b.state("guest-stuck");
    boot_phase(&mut b, boot, sweep_left);
    sweep_left_phase(&mut b, sweep_left, match_entry);
    match_phase(&mut b, match_entry, copy_entry, accepted, stuck);
    copy_phase(&mut b, copy_entry, sweep_right);
    sweep_right_phase(&mut b, sweep_right, sweep_left);
    b.finish(boot)
}

/// The UTM's initial tapes for guest `m` started on `inits`, or `None` when the guest cannot be encoded: a
/// machine `Machine::validate` rejects, no tapes, more than [`MAX_GUEST_TAPES`], or more initial tapes than
/// the machine has.
#[must_use]
pub fn encode_guest(m: &Machine, inits: &[Vec<Symbol>]) -> Option<Vec<Vec<Symbol>>> {
    if !m.validate().is_empty() || m.tapes == 0 || m.tapes > MAX_GUEST_TAPES || inits.len() > m.tapes {
        return None;
    }
    let symbols = guest_symbols(m, inits);
    let code_width = width_for(symbols.len());
    let id_width = width_for(m.states.len());
    let code = |s: Symbol| symbols.iter().position(|x| *x == s).map(|i| bits(i, code_width));

    let mut table = vec![TABLE_START];
    for (sid, _) in m.states.iter().enumerate().filter(|(_, s)| s.accept) {
        table.push(ACCEPT_ENTRY);
        table.extend(bits(sid, id_width));
        table.push(ID_END);
    }
    for (sid, state) in m.states.iter().enumerate().filter(|(_, s)| !s.accept) {
        for r in &state.rules {
            table.push(RULE_ENTRY);
            table.extend(bits(sid, id_width));
            table.push(ID_END);
            for cells in [&r.read, &r.write] {
                for cell in cells {
                    match cell {
                        Some(s) => table.extend(code(*s)?),
                        None => table.push(ANY),
                    }
                    table.push(FIELD_END);
                }
                table.push(SECTION_END);
            }
            table.extend(r.moves.iter().map(|mv| match mv {
                Move::L => LEFT,
                Move::R => RIGHT,
                Move::S => STAY,
            }));
            table.push(SECTION_END);
            table.extend(bits(usize::try_from(r.next).ok()?, id_width));
            table.push(ID_END);
        }
    }
    table.push(TABLE_END);
    for s in &symbols {
        table.extend(bits(usize::try_from(u32::from(*s)).ok()?, CHAR_BITS));
        table.push(FIELD_END);
    }

    let mut state = vec![RUNNING];
    state.extend(bits(usize::try_from(m.start).ok()?, id_width));
    state.push(ID_END);

    let cells = inits.iter().map(Vec::len).max().unwrap_or(0).max(1);
    let mut guest = vec![LEFT_END];
    for j in 0..cells {
        guest.push(if j == 0 { ORIGIN_BLOCK } else { BLOCK });
        for t in 0..m.tapes {
            guest.push(if j == 0 { HEAD } else { NO_HEAD });
            let s = inits.get(t).and_then(|tape| tape.get(j)).copied().unwrap_or(BLANK);
            guest.extend(code(s)?);
        }
    }
    guest.push(RIGHT_END);

    let slots = |first: Symbol| {
        std::iter::once(LEFT_END)
            .chain((0..m.tapes).flat_map(move |_| std::iter::once(first).chain(std::iter::repeat_n(ZERO, code_width))))
            .chain([RIGHT_END])
            .collect::<Vec<Symbol>>()
    };
    Some(vec![table, state, guest, slots(FIELD_END), slots(STAY)])
}

/// A guest run read back out of the UTM's tapes, or `None` when they are not exactly five tapes, there is no
/// alphabet, the status is unknown, blocks are of unequal size, or a track has no head or more than one.
///
/// Decoding is guaranteed only for tapes [`encode_guest`] lays out and for tapes a halted UTM leaves. A tape
/// taken mid-step, while the UTM is between guest steps, may decode to `None` or to a half-applied step that
/// is not a configuration the guest ever passed through.
#[must_use]
pub fn decode_guest(tapes: &[Tape]) -> Option<GuestRun> {
    let [table, state, guest, _key, _action] = tapes else { return None };
    let status = match *state.snapshot().0.first()? {
        RUNNING => GuestStatus::Running,
        ACCEPTED => GuestStatus::Accepted,
        STUCK => GuestStatus::Stuck,
        _ => return None,
    };

    let (table, _) = table.snapshot();
    let mut rest = &table[table.iter().position(|c| *c == TABLE_END)? + 1..];
    let mut symbols = Vec::new();
    while let Some(end) = rest.iter().position(|c| *c == FIELD_END) {
        symbols.push(char::from_u32(u32::try_from(value_of(&rest[..end])?).ok()?)?);
        rest = &rest[end + 1..];
    }
    let slot = width_for(symbols.len()) + 1;

    let (guest, _) = guest.snapshot();
    let body =
        guest.get(guest.iter().position(|c| *c == LEFT_END)? + 1..guest.iter().position(|c| *c == RIGHT_END)?)?;
    let origin = body.iter().filter(|c| DELIMITERS.contains(c)).position(|c| *c == ORIGIN_BLOCK)?;
    let blocks: Vec<&[Symbol]> = body.split(|c| DELIMITERS.contains(c)).skip(1).collect();
    let block_len = blocks.first()?.len();
    if block_len == 0 || block_len % slot != 0 || blocks.iter().any(|b| b.len() != block_len) {
        return None;
    }
    let mut out = Vec::with_capacity(block_len / slot);
    for t in 0..block_len / slot {
        let mut cells = Vec::with_capacity(blocks.len());
        let mut heads = Vec::new();
        for (j, block) in blocks.iter().enumerate() {
            let cell = &block[t * slot..(t + 1) * slot];
            match cell[0] {
                HEAD | ARRIVED => heads.push(j),
                NO_HEAD => {}
                _ => return None,
            }
            cells.push(*symbols.get(value_of(&cell[1..])?)?);
        }
        let [head] = heads[..] else { return None };
        out.push(OriginSnapshot { cells, head, origin });
    }
    Some(GuestRun { status, tapes: out })
}

/// Every symbol the guest can meet, [`BLANK`] first so its code is all zeros, then the rest in order.
fn guest_symbols(m: &Machine, inits: &[Vec<Symbol>]) -> Vec<Symbol> {
    let mut rest: BTreeSet<Symbol> = m.alphabet().into_iter().chain(inits.iter().flatten().copied()).collect();
    rest.remove(&BLANK);
    std::iter::once(BLANK).chain(rest).collect()
}

/// Bits needed to write any of `n` values, and at least one.
fn width_for(n: usize) -> usize {
    let bits = usize::BITS - n.saturating_sub(1).leading_zeros();
    usize::try_from(bits).unwrap_or(usize::MAX).max(1)
}

/// `value` in `width` bits, most significant first.
fn bits(value: usize, width: usize) -> Vec<Symbol> {
    (0..width).rev().map(|i| if (value >> i) & 1 == 1 { ONE } else { ZERO }).collect()
}

/// The value of a run of bits, most significant first, or `None` for a cell that is not a bit.
fn value_of(cells: &[Symbol]) -> Option<usize> {
    cells.iter().try_fold(0usize, |acc, c| match *c {
        ZERO => acc.checked_mul(2),
        ONE => acc.checked_mul(2)?.checked_add(1),
        _ => None,
    })
}

/// A rule over the named tapes — `(tape, read, write, move)`, `None` a wildcard read or no write — leaving
/// every other tape unread, unwritten and unmoved.
fn on(parts: &[(usize, Option<Symbol>, Option<Symbol>, Move)]) -> RuleSpec {
    parts.iter().fold(RuleSpec::new(), |spec, &(t, r, w, mv)| spec.on(t, r, w, mv))
}

/// A rule reading `guest` on [`GUEST`], `action` on [`ACTION`], writing `guest_write` and `action_write` there,
/// and moving [`GUEST`], [`ACTION`] and [`KEY`] together by `mv`.
fn swept(
    guest: Option<Symbol>,
    guest_write: Option<Symbol>,
    action: Option<Symbol>,
    action_write: Option<Symbol>,
    mv: Move,
) -> RuleSpec {
    on(&[(GUEST, guest, guest_write, mv), (ACTION, action, action_write, mv), (KEY, None, None, mv)])
}

/// From freshly encoded tapes: [`STATE`] onto its first bit, and [`GUEST`], [`ACTION`] and [`KEY`] onto
/// their right ends, where [`sweep_left_phase`] starts.
fn boot_phase(b: &mut Builder, entry: StateId, exit: StateId) {
    let guest_right = b.state("boot.guest");
    let others_right = b.state("boot.others");
    b.add_rule(entry, on(&[(STATE, None, None, Move::R)]), guest_right);
    b.add_rule(guest_right, on(&[(GUEST, Some(RIGHT_END), None, Move::S)]), others_right);
    b.add_rule(guest_right, on(&[(GUEST, None, None, Move::R)]), guest_right);
    b.add_rule(others_right, on(&[(ACTION, Some(RIGHT_END), None, Move::S)]), exit);
    b.add_rule(others_right, on(&[(ACTION, None, None, Move::R), (KEY, None, None, Move::R)]), others_right);
}

/// The leftward sweep: [`GUEST`], [`ACTION`] and [`KEY`] from their right ends to their left ends, in
/// lockstep, a slot of each at a time.
///
/// **GOING LEFT, A SLOT SHOWS ITS BITS BEFORE ITS FLAG**, so a slot needing work is handled at its flag by
/// stepping back right over its bits and returning. A head whose action is `L` has its write applied and its
/// move marked pending; the same track's slot in the next block left takes the head. Every head's final
/// position has its code copied into [`KEY`] and its flag normalized to `H`. A move still pending at the
/// left end prepends a blank block. It ends with the three swept tapes on their left ends.
fn sweep_left_phase(b: &mut Builder, entry: StateId, exit: StateId) {
    let over_bits = b.state("sl.bits");
    let flag = b.state("sl.flag");
    let write = b.state("sl.write");
    let write_back = b.state("sl.write-back");
    let read = b.state("sl.read");
    let read_back = b.state("sl.read-back");
    let next_block = b.state("sl.next-block");
    let scan = b.state("sl.scan");
    let key_home = b.state("sl.key-home");
    let prepend = b.state("sl.prepend");

    b.add_rule(entry, swept(None, None, None, None, Move::L), over_bits);

    b.add_rule(over_bits, on(&[(GUEST, Some(LEFT_END), None, Move::S)]), scan);
    for d in DELIMITERS {
        b.add_rule(over_bits, on(&[(GUEST, Some(d), None, Move::S)]), next_block);
    }
    for f in FLAGS {
        b.add_rule(over_bits, on(&[(GUEST, Some(f), None, Move::S)]), flag);
    }
    b.add_rule(over_bits, swept(None, None, None, None, Move::L), over_bits);

    // ACTION and KEY sit on their left ends at a delimiter; both run back to their right ends, and then all
    // three step left onto the previous block's last slot, or GUEST onto its left end.
    b.add_rule(next_block, swept(None, None, Some(RIGHT_END), None, Move::L), over_bits);
    b.add_rule(next_block, on(&[(ACTION, None, None, Move::R), (KEY, None, None, Move::R)]), next_block);

    b.add_rule(flag, swept(Some(HEAD), None, Some(LEFT), None, Move::R), write);
    b.add_rule(flag, swept(Some(NO_HEAD), Some(ARRIVED), Some(PENDING_LEFT), Some(STAY), Move::R), read);
    b.add_rule(flag, swept(Some(HEAD), None, None, None, Move::R), read);
    b.add_rule(flag, swept(Some(ARRIVED), None, None, None, Move::R), read);
    b.add_rule(flag, swept(None, None, None, None, Move::L), over_bits);

    for c in [HEAD, ARRIVED, NO_HEAD, BLOCK, ORIGIN_BLOCK, RIGHT_END] {
        b.add_rule(write, swept(Some(c), None, None, None, Move::L), write_back);
    }
    b.add_rule(write, swept(None, None, Some(ANY), None, Move::R), write);
    for bit in BITS {
        b.add_rule(write, swept(None, Some(bit), Some(bit), None, Move::R), write);
    }
    for bit in BITS {
        b.add_rule(write_back, swept(Some(bit), None, None, None, Move::L), write_back);
    }
    b.add_rule(write_back, swept(Some(HEAD), Some(NO_HEAD), None, Some(PENDING_LEFT), Move::L), over_bits);

    copy_code_into_key(b, read, read_back, over_bits);

    b.add_rule(scan, on(&[(ACTION, Some(PENDING_LEFT), None, Move::S)]), prepend);
    b.add_rule(scan, on(&[(ACTION, Some(LEFT_END), None, Move::S)]), key_home);
    b.add_rule(scan, on(&[(ACTION, None, None, Move::L)]), scan);
    b.add_rule(key_home, on(&[(KEY, Some(LEFT_END), None, Move::S)]), exit);
    b.add_rule(key_home, on(&[(KEY, None, None, Move::L)]), key_home);

    prepend_block(b, prepend, exit);
}

/// From a flag on [`GUEST`], with every swept tape one cell into its slot: copy the slot's bits into
/// [`KEY`], return to the flag, set it to `H`, and step left into `done`.
fn copy_code_into_key(b: &mut Builder, read: StateId, read_back: StateId, done: StateId) {
    for bit in BITS {
        b.add_rule(read, swept(Some(bit), None, None, None, Move::R).on(KEY, None, Some(bit), Move::R), read);
    }
    b.add_rule(read, swept(None, None, None, None, Move::L), read_back);
    for bit in BITS {
        b.add_rule(read_back, swept(Some(bit), None, None, None, Move::L), read_back);
    }
    for f in [HEAD, ARRIVED] {
        b.add_rule(read_back, swept(Some(f), Some(HEAD), None, None, Move::L), done);
    }
}

/// With [`GUEST`] on its left end and a move pending on [`ACTION`]: write a blank block leftward in the left
/// end's place, give each pending track its head there and copy that head's code into [`KEY`], and close it
/// with a delimiter and a new left end.
fn prepend_block(b: &mut Builder, entry: StateId, exit: StateId) {
    let key_right = b.state("sl.prepend-key");
    let cell = b.state("sl.prepend-cell");
    let flag = b.state("sl.prepend-flag");
    let read = b.state("sl.prepend-read");
    let read_back = b.state("sl.prepend-read-back");
    let close = b.state("sl.prepend-close");

    b.add_rule(entry, on(&[(ACTION, Some(RIGHT_END), None, Move::S)]), key_right);
    b.add_rule(entry, on(&[(ACTION, None, None, Move::R)]), entry);
    b.add_rule(key_right, on(&[(KEY, Some(RIGHT_END), None, Move::L), (ACTION, None, None, Move::L)]), cell);
    b.add_rule(key_right, on(&[(KEY, None, None, Move::R)]), key_right);

    b.add_rule(cell, on(&[(ACTION, Some(LEFT_END), None, Move::S), (GUEST, None, Some(BLOCK), Move::L)]), close);
    for mv in ACTION_MOVES {
        b.add_rule(cell, on(&[(ACTION, Some(mv), None, Move::S)]), flag);
    }
    b.add_rule(cell, swept(None, Some(ZERO), None, None, Move::L), cell);

    b.add_rule(flag, swept(None, Some(ARRIVED), Some(PENDING_LEFT), Some(STAY), Move::R), read);
    b.add_rule(flag, swept(None, Some(NO_HEAD), None, None, Move::L), cell);
    copy_code_into_key(b, read, read_back, cell);

    b.add_rule(close, on(&[(GUEST, None, Some(LEFT_END), Move::S)]), exit);
}

/// Find the first rule for the current guest state matching [`KEY`], from [`TABLE`]'s start.
///
/// Expects [`TABLE`] on its start, [`STATE`] on its first bit and [`KEY`] on its left end. A matching accept
/// entry marks the status accepted and halts in `accepted`; reaching the table's end marks it stuck and
/// halts in `stuck`. A matching rule leaves [`TABLE`] on the rule's first write field, [`STATE`] on its id's
/// end and [`KEY`] on its right end, and continues in `matched`.
fn match_phase(b: &mut Builder, entry: StateId, matched: StateId, accepted: StateId, stuck: StateId) {
    let scan = entry;
    let accept_id = b.state("m.accept-id");
    let rule_id = b.state("m.rule-id");
    let mark_accepted = b.state("m.mark-accepted");
    let mark_stuck = b.state("m.mark-stuck");
    let next_entry = b.state("m.next-entry");
    let field = b.state("m.field");
    let field_any = b.state("m.field-any");
    let field_bits = b.state("m.field-bits");
    let next_rule = b.state("m.next-rule");

    b.add_rule(scan, on(&[(TABLE, Some(ACCEPT_ENTRY), None, Move::R)]), accept_id);
    b.add_rule(scan, on(&[(TABLE, Some(RULE_ENTRY), None, Move::R)]), rule_id);
    b.add_rule(scan, on(&[(TABLE, Some(TABLE_END), None, Move::S)]), mark_stuck);
    b.add_rule(scan, on(&[(TABLE, None, None, Move::R)]), scan);

    for (id, on_equal) in [(accept_id, None), (rule_id, Some(field))] {
        for bit in BITS {
            b.add_rule(id, on(&[(TABLE, Some(bit), None, Move::R), (STATE, Some(bit), None, Move::R)]), id);
        }
        match on_equal {
            None => b.add_rule(
                id,
                on(&[(TABLE, Some(ID_END), None, Move::S), (STATE, Some(ID_END), None, Move::S)]),
                mark_accepted,
            ),
            Some(f) => b.add_rule(
                id,
                on(&[
                    (TABLE, Some(ID_END), None, Move::R),
                    (STATE, Some(ID_END), None, Move::S),
                    (KEY, None, None, Move::R),
                ]),
                f,
            ),
        }
        b.add_rule(id, on(&[]), next_entry);
    }

    for (mark, status, halt) in [(mark_accepted, ACCEPTED, accepted), (mark_stuck, STUCK, stuck)] {
        b.add_rule(mark, on(&[(STATE, Some(RUNNING), Some(status), Move::S)]), halt);
        b.add_rule(mark, on(&[(STATE, None, None, Move::L)]), mark);
    }
    b.add_rule(next_entry, on(&[(STATE, Some(RUNNING), None, Move::R)]), scan);
    b.add_rule(next_entry, on(&[(STATE, None, None, Move::L)]), next_entry);

    b.add_rule(field, on(&[(TABLE, Some(SECTION_END), None, Move::R), (KEY, Some(RIGHT_END), None, Move::S)]), matched);
    b.add_rule(field, on(&[(TABLE, Some(ANY), None, Move::R), (KEY, Some(FIELD_END), None, Move::R)]), field_any);
    for bit in BITS {
        b.add_rule(field, on(&[(TABLE, Some(bit), None, Move::S), (KEY, Some(FIELD_END), None, Move::R)]), field_bits);
    }
    b.add_rule(field, on(&[]), next_rule);

    for bit in BITS {
        b.add_rule(field_any, on(&[(KEY, Some(bit), None, Move::R)]), field_any);
    }
    b.add_rule(field_any, on(&[(TABLE, None, None, Move::R)]), field);

    for bit in BITS {
        b.add_rule(field_bits, on(&[(TABLE, Some(bit), None, Move::R), (KEY, Some(bit), None, Move::R)]), field_bits);
    }
    for end in [FIELD_END, RIGHT_END] {
        b.add_rule(field_bits, on(&[(TABLE, Some(FIELD_END), None, Move::R), (KEY, Some(end), None, Move::S)]), field);
    }
    b.add_rule(field_bits, on(&[]), next_rule);

    b.add_rule(next_rule, on(&[(KEY, Some(LEFT_END), None, Move::S)]), next_entry);
    b.add_rule(next_rule, on(&[(KEY, None, None, Move::L)]), next_rule);
}

/// Copy the matched rule's writes and moves into [`ACTION`] and its next state into [`STATE`], then return
/// [`TABLE`], [`STATE`] and [`ACTION`] to where the next guest step starts them.
fn copy_phase(b: &mut Builder, entry: StateId, exit: StateId) {
    let write_field = b.state("c.write-field");
    let write_any = b.state("c.write-any");
    let write_bits = b.state("c.write-bits");
    let moves_home = b.state("c.moves-home");
    let move_field = b.state("c.move");
    let move_skip = b.state("c.move-skip");
    let next_home = b.state("c.next-home");
    let next_state = b.state("c.next");
    let table_home = b.state("c.table-home");
    let state_home = b.state("c.state-home");
    let action_home = b.state("c.action-home");

    b.add_rule(entry, on(&[(ACTION, None, None, Move::R)]), write_field);

    b.add_rule(write_field, on(&[(TABLE, Some(SECTION_END), None, Move::R)]), moves_home);
    b.add_rule(write_field, on(&[(TABLE, Some(ANY), None, Move::R), (ACTION, None, None, Move::R)]), write_any);
    b.add_rule(write_field, on(&[(ACTION, None, None, Move::R)]), write_bits);

    for c in [ZERO, ONE, ANY] {
        b.add_rule(write_any, on(&[(ACTION, Some(c), Some(ANY), Move::R)]), write_any);
    }
    b.add_rule(write_any, on(&[(TABLE, None, None, Move::R)]), write_field);

    for bit in BITS {
        b.add_rule(
            write_bits,
            on(&[(TABLE, Some(bit), None, Move::R), (ACTION, None, Some(bit), Move::R)]),
            write_bits,
        );
    }
    b.add_rule(write_bits, on(&[(TABLE, None, None, Move::R)]), write_field);

    b.add_rule(moves_home, on(&[(ACTION, Some(LEFT_END), None, Move::R)]), move_field);
    b.add_rule(moves_home, on(&[(ACTION, None, None, Move::L)]), moves_home);
    for mv in [LEFT, RIGHT, STAY] {
        b.add_rule(move_field, on(&[(TABLE, Some(mv), None, Move::R), (ACTION, None, Some(mv), Move::R)]), move_skip);
    }
    b.add_rule(move_field, on(&[(TABLE, None, None, Move::R)]), next_home);
    for c in ACTION_MOVES.into_iter().chain([RIGHT_END]) {
        b.add_rule(move_skip, on(&[(ACTION, Some(c), None, Move::S)]), move_field);
    }
    b.add_rule(move_skip, on(&[(ACTION, None, None, Move::R)]), move_skip);

    b.add_rule(next_home, on(&[(STATE, Some(RUNNING), None, Move::R)]), next_state);
    b.add_rule(next_home, on(&[(STATE, None, None, Move::L)]), next_home);
    for bit in BITS {
        b.add_rule(next_state, on(&[(TABLE, Some(bit), None, Move::R), (STATE, None, Some(bit), Move::R)]), next_state);
    }
    b.add_rule(next_state, on(&[]), table_home);

    b.add_rule(table_home, on(&[(TABLE, Some(TABLE_START), None, Move::S)]), state_home);
    b.add_rule(table_home, on(&[(TABLE, None, None, Move::L)]), table_home);
    b.add_rule(state_home, on(&[(STATE, Some(RUNNING), None, Move::R)]), action_home);
    b.add_rule(state_home, on(&[(STATE, None, None, Move::L)]), state_home);
    b.add_rule(action_home, on(&[(ACTION, Some(LEFT_END), None, Move::S)]), exit);
    b.add_rule(action_home, on(&[(ACTION, None, None, Move::L)]), action_home);
}

/// The rightward sweep: [`GUEST`] and [`ACTION`] from their left ends to their right ends, in lockstep.
///
/// A head whose action is `S` or `R` has its write applied; a head moving right leaves its flag and marks
/// the move pending, and the same track's slot in the next block right takes it as `h`, which later steps of
/// this sweep leave alone. A move still pending at the right end appends a blank block. It ends with
/// [`GUEST`] and [`ACTION`] on their right ends, where [`sweep_left_phase`] starts.
fn sweep_right_phase(b: &mut Builder, entry: StateId, exit: StateId) {
    let block = b.state("sr.block");
    let action_home = b.state("sr.action-home");
    let flag = b.state("sr.flag");
    let write = b.state("sr.write");
    let skip = b.state("sr.skip");
    let scan = b.state("sr.scan");
    let action_end = b.state("sr.action-end");
    let append = b.state("sr.append");
    let append_flag = b.state("sr.append-flag");
    let append_bits = b.state("sr.append-bits");

    let right =
        |guest: Option<Symbol>, guest_write: Option<Symbol>, action: Option<Symbol>, action_write: Option<Symbol>| {
            on(&[(GUEST, guest, guest_write, Move::R), (ACTION, action, action_write, Move::R)])
        };

    b.add_rule(entry, on(&[(GUEST, None, None, Move::R)]), block);

    b.add_rule(block, on(&[(GUEST, Some(RIGHT_END), None, Move::S)]), scan);
    for d in DELIMITERS {
        b.add_rule(block, right(Some(d), None, Some(LEFT_END), None), flag);
        b.add_rule(block, on(&[(GUEST, Some(d), None, Move::S)]), action_home);
    }
    b.add_rule(action_home, on(&[(ACTION, Some(LEFT_END), None, Move::S)]), block);
    b.add_rule(action_home, on(&[(ACTION, None, None, Move::L)]), action_home);

    b.add_rule(flag, right(Some(HEAD), Some(NO_HEAD), Some(RIGHT), Some(PENDING_RIGHT)), write);
    b.add_rule(flag, right(Some(HEAD), None, Some(STAY), None), write);
    b.add_rule(flag, right(Some(NO_HEAD), Some(ARRIVED), Some(PENDING_RIGHT), Some(STAY)), skip);
    b.add_rule(flag, right(None, None, None, None), skip);

    for state in [write, skip] {
        for f in FLAGS {
            b.add_rule(state, on(&[(GUEST, Some(f), None, Move::S)]), flag);
        }
        for end in DELIMITERS.into_iter().chain([RIGHT_END]) {
            b.add_rule(state, on(&[(GUEST, Some(end), None, Move::S)]), block);
        }
    }
    b.add_rule(write, right(None, None, Some(ANY), None), write);
    for bit in BITS {
        b.add_rule(write, right(None, Some(bit), Some(bit), None), write);
    }
    b.add_rule(skip, right(None, None, None, None), skip);

    b.add_rule(scan, on(&[(ACTION, Some(PENDING_RIGHT), None, Move::S)]), append);
    b.add_rule(scan, on(&[(ACTION, Some(LEFT_END), None, Move::S)]), action_end);
    b.add_rule(scan, on(&[(ACTION, None, None, Move::L)]), scan);
    b.add_rule(action_end, on(&[(ACTION, Some(RIGHT_END), None, Move::S)]), exit);
    b.add_rule(action_end, on(&[(ACTION, None, None, Move::R)]), action_end);

    b.add_rule(
        append,
        on(&[(ACTION, Some(LEFT_END), None, Move::R), (GUEST, None, Some(BLOCK), Move::R)]),
        append_flag,
    );
    b.add_rule(append, on(&[(ACTION, None, None, Move::L)]), append);
    b.add_rule(append_flag, right(None, Some(ARRIVED), Some(PENDING_RIGHT), Some(STAY)), append_bits);
    b.add_rule(
        append_flag,
        on(&[(ACTION, Some(RIGHT_END), None, Move::S), (GUEST, None, Some(RIGHT_END), Move::S)]),
        exit,
    );
    b.add_rule(append_flag, right(None, Some(NO_HEAD), None, None), append_bits);
    for c in ACTION_MOVES.into_iter().chain([RIGHT_END]) {
        b.add_rule(append_bits, on(&[(ACTION, Some(c), None, Move::S)]), append_flag);
    }
    b.add_rule(append_bits, right(None, Some(ZERO), None, None), append_bits);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::machine::{Rule, State};
    use crate::tm::sim::{DEFAULT_CAPS, Status, simulate_final};

    /// A one-tape unary incrementer: skip the `1`s, write a `1` on the first blank, accept.
    fn increment() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "scan".into(),
                    accept: false,
                    rules: vec![
                        Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::R], next: 0 },
                        Rule { read: vec![None], write: vec![Some('1')], moves: vec![Move::S], next: 1 },
                    ],
                },
                State { name: "halt".into(), accept: true, rules: vec![] },
            ],
        }
    }

    fn text(cells: &[Symbol]) -> String {
        cells.iter().collect()
    }

    fn tapes_of(cells: &[Vec<Symbol>]) -> Vec<Tape> {
        cells.iter().map(|t| Tape::new(t)).collect()
    }

    /// Every field of every tape for a guest small enough to read: two symbols in one bit (`_` is 0, `1` is
    /// 1), two states in one bit, the accept entry before the rules, and the alphabet after the table's end
    /// as 21-bit character codes.
    #[test]
    fn encode_guest_lays_out_the_five_tapes() {
        let tapes = encode_guest(&increment(), &[vec!['1', '1']]).expect("an encodable guest");
        assert_eq!(text(&tapes[TABLE]), "^A1.Q0.1,/?,/R/0.Q0.?,/1,/S/1.$000000000000001011111,000000000000000110001,");
        assert_eq!(text(&tapes[STATE]), "?0.");
        assert_eq!(text(&tapes[GUEST]), "<oH1|-1>");
        assert_eq!(text(&tapes[KEY]), "<,0>");
        assert_eq!(text(&tapes[ACTION]), "<S0>");
    }

    /// Freshly encoded tapes decode to the initial tapes, every track as long as the longest, blank-padded,
    /// with every head and the origin on cell 0.
    #[test]
    fn freshly_encoded_tapes_decode_to_the_initial_tapes() {
        let m = Machine {
            tapes: 3,
            start: 0,
            states: vec![State {
                name: "s".into(),
                accept: false,
                rules: vec![Rule {
                    read: vec![Some('a'), None, Some('b')],
                    write: vec![None, Some('c'), None],
                    moves: vec![Move::S; 3],
                    next: 0,
                }],
            }],
        };
        let inits = [vec!['a', 'b'], vec![], vec!['b']];
        let run = decode_guest(&tapes_of(&encode_guest(&m, &inits).expect("an encodable guest"))).expect("well formed");
        assert_eq!(run.status, GuestStatus::Running);
        let want: Vec<OriginSnapshot> = [['a', 'b'], [BLANK, BLANK], ['b', BLANK]]
            .into_iter()
            .map(|cells| OriginSnapshot { cells: cells.to_vec(), head: 0, origin: 0 })
            .collect();
        assert_eq!(run.tapes, want);
    }

    #[test]
    fn encode_guest_refuses_what_it_cannot_lay_out() {
        let accept_only =
            |tapes| Machine { tapes, start: 0, states: vec![State { name: "s".into(), accept: true, rules: vec![] }] };
        assert!(encode_guest(&increment(), &[vec![], vec![]]).is_none(), "more initial tapes than the machine has");
        let mut invalid = increment();
        invalid.start = 9;
        assert!(encode_guest(&invalid, &[]).is_none(), "a machine `validate` rejects");
        assert!(encode_guest(&accept_only(0), &[]).is_none(), "no tapes");
        assert!(encode_guest(&accept_only(MAX_GUEST_TAPES + 1), &[]).is_none(), "more than MAX_GUEST_TAPES");
        assert!(encode_guest(&accept_only(MAX_GUEST_TAPES), &[]).is_some(), "exactly MAX_GUEST_TAPES");
    }

    #[test]
    fn decode_guest_refuses_tapes_it_cannot_read() {
        let good = encode_guest(&increment(), &[vec!['1']]).expect("an encodable guest");
        let with = |tape: usize, cells: &str| {
            let mut tapes = good.clone();
            tapes[tape] = cells.chars().collect();
            decode_guest(&tapes_of(&tapes))
        };
        assert!(decode_guest(&tapes_of(&good)).is_some(), "the unaltered tapes decode");
        assert!(with(GUEST, "<oH1|H0>").is_none(), "a track with two heads");
        assert!(with(GUEST, "<o-1|-0>").is_none(), "a track with no head");
        assert!(with(GUEST, "<oH1|-10>").is_none(), "blocks of unequal size");
        assert!(with(STATE, "X0.").is_none(), "an unknown status");
        assert!(with(TABLE, "^").is_none(), "no alphabet");
        assert!(decode_guest(&tapes_of(&good[..2])).is_none(), "too few tapes");
        assert!(decode_guest(&tapes_of(&good[..4])).is_none(), "four tapes are too few");
        let mut six = good.clone();
        six.push(vec![]);
        assert!(decode_guest(&tapes_of(&six)).is_none(), "six tapes are too many");
    }

    /// A head start for a phase: walk `tape` right until it reads one of `stop`, or step it right once.
    enum Pre {
        Seek(usize, &'static [Symbol]),
        Step(usize),
    }

    /// Build a machine that runs `pre` and then the phase `build` adds from `entry`, run it on `tapes`, and
    /// return every tape as `(cells, head)` and the name of the state it halted in. `build` allocates its own
    /// exits, so the halting state's name says which exit the phase took.
    fn run_phase(
        tapes: &[&str],
        pre: &[Pre],
        build: impl FnOnce(&mut Builder, StateId),
    ) -> (Vec<(String, usize)>, String) {
        let mut b = Builder::new();
        let start = b.state("pre");
        let mut at = start;
        for (i, p) in pre.iter().enumerate() {
            let next = b.state(format!("pre.{i}"));
            match p {
                Pre::Seek(t, stop) => {
                    for s in *stop {
                        b.add_rule(at, on(&[(*t, Some(*s), None, Move::S)]), next);
                    }
                    b.add_rule(at, on(&[(*t, None, None, Move::R)]), at);
                }
                Pre::Step(t) => b.add_rule(at, on(&[(*t, None, None, Move::R)]), next),
            }
            at = next;
        }
        let entry = b.state("entry");
        b.add_rule(at, on(&[]), entry);
        build(&mut b, entry);
        let m = b.finish(start);
        assert_eq!(m.validate(), Vec::<String>::new());
        let init: Vec<Vec<Symbol>> = tapes.iter().map(|t| t.chars().collect()).collect();
        let (out, state, status, _) = simulate_final(&m, &init, DEFAULT_CAPS);
        assert_eq!(status, Status::Halted, "the phase must halt");
        let tapes = out.iter().map(|t| {
            let (cells, head) = t.snapshot();
            (text(&cells), head)
        });
        (tapes.collect(), m.states[state as usize].name.clone())
    }

    const INCREMENT_TABLE: &str = "^A1.Q0.1,/?,/R/0.Q0.?,/1,/S/1.$";

    /// Run the match phase on `table` with `state` and `key`, returning the tapes and which exit it took.
    fn run_match(table: &str, state: &str, key: &str) -> (Vec<(String, usize)>, String) {
        run_phase(&[table, state, "<>", key, "<>"], &[Pre::Step(STATE)], |b, entry| {
            let matched = b.state("matched");
            let accepted = b.accept("accepted");
            let stuck = b.state("stuck");
            match_phase(b, entry, matched, accepted, stuck);
        })
    }

    /// **THE FIRST MATCH WINS**: with `1` under the head both rules match — the second by its wildcard — and
    /// the phase stops on the first rule's write field, index 10, not the second's, index 23.
    #[test]
    fn match_takes_the_first_matching_rule() {
        let (tapes, exit) = run_match(INCREMENT_TABLE, "?0.", "<,1>");
        assert_eq!(exit, "matched");
        assert_eq!(tapes[TABLE].1, 10, "on the FIRST rule's write field");
        assert_eq!((tapes[STATE].1, tapes[KEY].1), (2, 3), "STATE on its id's end, KEY on its right end");
    }

    #[test]
    fn match_passes_a_mismatched_rule_to_a_wildcard() {
        let (tapes, exit) = run_match(INCREMENT_TABLE, "?0.", "<,0>");
        assert_eq!(exit, "matched");
        assert_eq!(tapes[TABLE].1, 23, "on the second rule's write field");
    }

    #[test]
    fn match_halts_accepted_on_an_accept_entry() {
        let (tapes, exit) = run_match(INCREMENT_TABLE, "?1.", "<,0>");
        assert_eq!((exit.as_str(), tapes[STATE].0.as_str()), ("accepted", "Y1."));
    }

    #[test]
    fn match_halts_stuck_when_no_rule_matches() {
        let (tapes, exit) = run_match("^Q0.1,/?,/R/0.$", "?0.", "<,0>");
        assert_eq!((exit.as_str(), tapes[STATE].0.as_str()), ("stuck", "N0."));
        assert_eq!(tapes[KEY].1, 0, "KEY back on its left end after the failed rule");
    }

    /// From the first write field of a two-tape rule: the write and the keep land in ACTION's slots, the
    /// moves beside them, the next state in STATE, and every tape returns to where the next step starts it.
    #[test]
    fn copy_fills_action_and_state_and_rewinds() {
        let (tapes, exit) = run_phase(
            &["^Q0.?,1,/1,?,/RL/1.$", "?0.", "<>", ">", "<S0S0>"],
            &[Pre::Seek(TABLE, &['/']), Pre::Step(TABLE), Pre::Seek(STATE, &['.'])],
            |b, entry| {
                let done = b.state("done");
                copy_phase(b, entry, done);
            },
        );
        assert_eq!(exit, "done");
        assert_eq!(tapes[ACTION], ("<R1L?>".into(), 0));
        assert_eq!(tapes[STATE], ("?1.".into(), 1));
        assert_eq!(tapes[TABLE].1, 0);
    }

    fn run_sweep_right(guest: &str, action: &str) -> Vec<(String, usize)> {
        let (tapes, exit) = run_phase(&["^", "?0.", guest, ">", action], &[], |b, entry| {
            let done = b.state("done");
            sweep_right_phase(b, entry, done);
        });
        assert_eq!(exit, "done");
        tapes
    }

    #[test]
    fn sweep_right_writes_and_moves_a_head_right() {
        let tapes = run_sweep_right("<oH1|-0>", "<R0>");
        assert_eq!(tapes[GUEST], ("<o-0|h0>".into(), 7), "written, then arrived one block right");
        assert_eq!(tapes[ACTION], ("<S0>".into(), 3), "the pending move is spent");
    }

    #[test]
    fn sweep_right_appends_a_block_for_a_head_leaving_the_right_end() {
        let tapes = run_sweep_right("<oH1>", "<R?>");
        assert_eq!(tapes[GUEST], ("<o-1|h0>".into(), 7), "kept, then a blank block appended for the head");
        assert_eq!(tapes[ACTION].0, "<S?>");
    }

    #[test]
    fn sweep_right_writes_a_staying_head_and_leaves_a_left_moving_one() {
        let tapes = run_sweep_right("<oH0H1>", "<S1L0>");
        assert_eq!(tapes[GUEST].0, "<oH1H1>", "the staying head written, the left-moving one not");
    }

    fn run_sweep_left(guest: &str, action: &str, key: &str) -> Vec<(String, usize)> {
        let ends: &'static [Symbol] = &[RIGHT_END];
        let (tapes, exit) = run_phase(
            &["^", "?0.", guest, key, action],
            &[Pre::Seek(GUEST, ends), Pre::Seek(ACTION, ends), Pre::Seek(KEY, ends)],
            |b, entry| {
                let done = b.state("done");
                sweep_left_phase(b, entry, done);
            },
        );
        assert_eq!(exit, "done");
        assert_eq!((tapes[GUEST].1, tapes[ACTION].1, tapes[KEY].1), (0, 0, 0), "every swept tape on its left end");
        tapes
    }

    #[test]
    fn sweep_left_writes_and_moves_a_head_left_and_reads_it() {
        let tapes = run_sweep_left("<o-1|H0>", "<L1>", "<,0>");
        assert_eq!(tapes[GUEST].0, "<oH1|-1>", "written where it was, and arrived one block left");
        assert_eq!(tapes[KEY].0, "<,1>", "the code at its new position");
        assert_eq!(tapes[ACTION].0, "<S1>", "the pending move is spent");
    }

    #[test]
    fn sweep_left_prepends_a_block_for_a_head_leaving_the_left_end() {
        let tapes = run_sweep_left("<oH0>", "<L1>", "<,1>");
        assert_eq!(tapes[GUEST].0, "<|H0o-1>", "a blank block before the origin, holding the head");
        assert_eq!(tapes[KEY].0, "<,0>", "the blank code under it");
    }

    #[test]
    fn sweep_left_reads_every_head_and_normalizes_arrivals() {
        let tapes = run_sweep_left("<oh1H0>", "<S0S0>", "<,0,1>");
        assert_eq!(tapes[GUEST].0, "<oH1H0>");
        assert_eq!(tapes[KEY].0, "<,1,0>");
    }

    /// The whole machine on the incrementer: two `1`s become three, and the guest accepts.
    #[test]
    fn the_universal_machine_runs_the_incrementer() {
        let utm = universal_machine();
        assert_eq!(utm.validate(), Vec::<String>::new());
        let tapes = encode_guest(&increment(), &[vec!['1', '1']]).expect("an encodable guest");
        let (out, _, status, _) = simulate_final(&utm, &tapes, DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        let run = decode_guest(&out).expect("well formed");
        assert_eq!(run.status, GuestStatus::Accepted);
        assert_eq!(run.tapes, vec![OriginSnapshot { cells: vec!['1', '1', '1'], head: 2, origin: 0 }]);
    }

    /// The fixed machine's size is pinned, so a change to it is a deliberate one: every guest step's cost is paid
    /// in this machine's steps.
    #[test]
    fn the_universal_machine_is_55_states_and_178_rules() {
        let utm = universal_machine();
        let rules: usize = utm.states.iter().map(|s| s.rules.len()).sum();
        assert_eq!((utm.states.len(), rules), (55, 178));
    }
}
