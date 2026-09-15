# Universal Turing Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One fixed Turing machine, generated in Rust with `Builder`, runs any guest machine laid out on its tapes. A new oracle leg runs guests directly and through it, and requires the same accept or stuck halt, every guest tape equal at its origin, and, for a compiled program, the reference interpreter's value.

**Architecture:** A new `tm/universal.rs` holds three public functions:
- `encode_guest` lays a guest out on five tapes: the rule table, the guest's state, the guest's tapes as interleaved tracks, and one slot per guest tape for the code under its head and for a rule's write and move.
- `universal_machine` builds the fixed 55-state machine. Each guest step scans the whole table for the first rule matching the guest's state and the code under every head, copies that rule's writes, moves and next state, and applies them in a rightward sweep and a leftward sweep that also reads every head's new code.
- `decode_guest` reads a guest run back from nothing but the tapes.

Every field on the tapes is delimited, so the machine never counts, and one machine runs a guest of any tape count, any number of states and any alphabet. `tests/universal_oracle.rs` holds the leg.

**Tech Stack:** Rust (`redextape-core`), cargo-nextest for the fast tier, `cargo test --release` for the slow tier, proptest, the repository's pre-commit gates.

**Spec:** `docs/superpowers/specs/2026-09-14-universal-tm-design.md`, committed at `c873f8e`. The spec is unchanged; what building the code decided or corrected is under *Decisions and spec corrections found while planning*.

## Global Constraints

- **Files:** `crates/redextape-core/src/tm.rs` gains exactly one line, `pub mod universal;`. The rest is the new `crates/redextape-core/src/tm/universal.rs` and `crates/redextape-core/tests/universal_oracle.rs`, plus one move between test files: `run_with_origins` and `acyclic_machine` leave `crates/redextape-core/tests/one_way_oracle.rs` for `crates/redextape-core/tests/common/mod.rs`. Nothing in Core, asm, `encoding`, `Builder`, `lower_tm` or the reductions changes.
- **Public items of `crate::tm::universal`:**
  - `pub fn universal_machine() -> Machine`
  - `pub fn encode_guest(m: &Machine, inits: &[Vec<Symbol>]) -> Option<Vec<Vec<Symbol>>>`
  - `pub fn decode_guest(tapes: &[Tape]) -> Option<GuestRun>`
  - `pub struct GuestRun { pub status: GuestStatus, pub tapes: Vec<OriginSnapshot> }`
  - `pub enum GuestStatus { Running, Accepted, Stuck }`
  - `pub const TABLE: usize = 0`, `STATE = 1`, `GUEST = 2`, `KEY = 3`, `ACTION = 4`
  - `pub const MAX_GUEST_TAPES: usize = MAX_TAPES`
- **The fixed machine is 55 states and 178 rules**, pinned by a unit test.
- **Build location:** work in the `universal-tm` worktree, and put `CARGO_TARGET_DIR="$P/target"` on every cargo command and on every `git commit`, because the pre-commit hook runs cargo. Never build into the main checkout's `target/`, and never into `/tmp`.
- **Memory cap:** every suite run, every `--release` run and every sabotage run goes under `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 --`. An OOM kill is a result to record, never a reason to raise the cap.
- **Hooks:** never `git commit --no-verify`. Tracked source may not cite `file:line`, and a citation of the form "`file.rs`'s `symbol`" must name the tracked file that declares the symbol.
- **Staging:** stage files by name, never with `git add -A`.
- No AI or Claude attribution anywhere: code, comments or commit messages.
- The roadmap entry is not part of this plan.

## How this plan's code was verified

Every task's end state was built in the scratch worktree `.claude/worktrees/universal-tm-scratch`, on branch `universal-tm-scratch`, started from `c873f8e`. Each was committed there through the unmodified pre-commit hooks before this plan was written, and nothing in this plan's verification used `--no-verify`.

| task | scratch commit |
| --- | --- |
| 1 | `2480278` Lay a guest machine out on a universal machine's tapes, and read it back |
| 2 | `4b15b9a` Build the universal machine that runs a guest laid out on those tapes |
| 3 | `9f18749` Run hand-built and generated guests through the universal machine |
| 4 | `21320d4` Run the compiled corpus through the universal machine |

**Each task's code below is that commit's `git show --format=` output, embedded verbatim. Apply it; do not retype it.** Each block, expected stat and commit message was compared byte for byte with its commit, and the four blocks were applied in order, staged and never committed, to a detached `c873f8e` in a throwaway worktree: after each one, `git diff --cached --quiet <that task's commit>` succeeded.

**No step shows a red-first run of a new test**, because the code existed before the plan. Task 4 instead runs the spec's five sabotages on the finished code, each breaking one mechanism, and records which tests go red.

Every embedded file sits between a `<!-- BEGIN name -->` line and an `<!-- END name -->` line. Set these once per shell before any task:

```bash
P=/home/davey/projects/redextape/.claude/worktrees/universal-tm
PLAN="$P/docs/superpowers/plans/2026-09-14-universal-tm.md"
S=/tmp/claude-1000/-home-davey-projects-redextape/c6a1cf33-0c42-448c-a0ee-76239e25a1eb/scratchpad/utm-exec
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
```

`$S` holds only small helper files; any directory outside the worktree works.

---

### Task 1: Lay a guest out on the tapes, and read it back

**Files:**
- Create: `crates/redextape-core/src/tm/universal.rs`
- Modify: `crates/redextape-core/src/tm.rs` — `pub mod universal;`

**What it builds.**
- **The five tape indices** and `MAX_GUEST_TAPES`.
- **`encode_guest`:**
  - The table is `^`, an accept entry `A<id>.` per accept state, then a rule entry per rule in the guest's own order: `Q<state id>.`, a read field per guest tape (`<code>,` or `?,` for a wildcard), `/`, a write field per guest tape (`<code>,` or `?,` for no write), `/`, one move character per guest tape (`L`, `R`, `S`), `/`, `<next id>.`. Then `$`, then the guest alphabet in code order as 21-bit character codes, for `decode_guest`.
  - State ids are in the fewest bits that hold every id; symbol codes in the fewest bits that hold every symbol, with `_` always code 0.
  - STATE is `?`, the start id, `.`. GUEST is `<`, one block per cell of the longest initial tape (`o` for cell 0, `|` otherwise, then per guest tape a flag, `H` at cell 0 and `-` elsewhere, and the code), `>`. KEY is `<`, then `,` and a zero code per guest tape, `>`. ACTION is `<`, then `S` and a zero code per guest tape, `>`.
  - It returns `None` for a machine `Machine::validate` rejects, no tapes, more than `MAX_GUEST_TAPES`, or more initial tapes than the machine has.
- **`decode_guest`** reads the status cell (`?` running, `Y` accepted, `N` stuck), the alphabet after `$`, and each track: its cells, the block holding its one `H` or `h`, and the `o` block. It returns `None` for anything else: fewer than five tapes, an unknown status, no alphabet, blocks of unequal size, a track with no head or two.
- **Tests:** the exact five tapes for the incrementer; freshly encoded tapes decoding to the blank-padded initial tapes; `encode_guest`'s four refusals and its limit; `decode_guest`'s six refusals.

**Interfaces:**
- Consumes: `crate::tm::build::MAX_TAPES`; `crate::tm::machine::{BLANK, Machine, Move, Symbol}`; `crate::tm::one_way::OriginSnapshot`; `crate::tm::sim::Tape`.
- Produces: everything in *Global Constraints*' public-item list except `universal_machine`.

- [ ] **Step 1: Confirm no code has changed yet**

```bash
git -C "$P" diff --quiet HEAD -- crates/ && git -C "$P" diff --cached --quiet -- crates/ && echo clean
```

Expected: `clean`

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task1.patch | git -C "$P" apply --index --check && block_of task1.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/tm.rs           |   1 +
 crates/redextape-core/src/tm/universal.rs | 342 ++++++++++++++++++++++++++++++
 2 files changed, 343 insertions(+)
```

<!-- BEGIN task1.patch -->
````diff
diff --git a/crates/redextape-core/src/tm.rs b/crates/redextape-core/src/tm.rs
index 3a6d798..59aab80 100644
--- a/crates/redextape-core/src/tm.rs
+++ b/crates/redextape-core/src/tm.rs
@@ -21,6 +21,7 @@ pub mod sim;
 pub mod single_tape;
 pub mod syntax;
 pub mod two_symbol;
+pub mod universal;
 
 pub use asm::{
     AsmHeader, AsmOutcome, AsmRun, Caps, DEFAULT_CAPS, DecodeFailure, Instr, Program, Reg, decode_asm,
diff --git a/crates/redextape-core/src/tm/universal.rs b/crates/redextape-core/src/tm/universal.rs
new file mode 100644
index 0000000..0d8c1cc
--- /dev/null
+++ b/crates/redextape-core/src/tm/universal.rs
@@ -0,0 +1,342 @@
+//! The tapes a universal Turing machine runs a guest machine on, and how a guest run is read back off them.
+//!
+//! **NOTHING ABOUT A GUEST IS WRITTEN AS A NUMBER A MACHINE MUST COUNT.** The guest's tape count, its state-id
+//! width and its symbol-code width are implicit: every field on these tapes is delimited, so a machine can
+//! compare fields by walking them in lockstep. One layout therefore holds a guest of any tape count, any
+//! number of states and any alphabet.
+//!
+//! **THE FIVE TAPES.**
+//!
+//! | tape | holds |
+//! | --- | --- |
+//! | [`TABLE`] | the accept list, then every rule in the guest's own order, then the guest alphabet |
+//! | [`STATE`] | a status cell, then the guest's current state id |
+//! | [`GUEST`] | every guest tape as one track per tape, a block per cell, with head and origin markers |
+//! | [`KEY`] | the code under each guest head, one slot per guest tape |
+//! | [`ACTION`] | a move and a write for each guest tape, one slot per guest tape |
+
+use std::collections::BTreeSet;
+
+use crate::tm::build::MAX_TAPES;
+use crate::tm::machine::{BLANK, Machine, Move, Symbol};
+use crate::tm::one_way::OriginSnapshot;
+use crate::tm::sim::Tape;
+
+/// The rule table.
+pub const TABLE: usize = 0;
+/// The status cell and the guest's current state id.
+pub const STATE: usize = 1;
+/// The guest's tapes, interleaved as tracks.
+pub const GUEST: usize = 2;
+/// The code under each guest head.
+pub const KEY: usize = 3;
+/// A move and a write for each guest tape.
+pub const ACTION: usize = 4;
+
+/// The most guest tapes [`encode_guest`] lays out: the most a parsed `.tm` file may declare. The layout itself
+/// has no limit, since tracks are delimited; this bounds what `encode_guest` allocates.
+pub const MAX_GUEST_TAPES: usize = MAX_TAPES;
+
+const TABLE_START: Symbol = '^';
+const TABLE_END: Symbol = '$';
+const ACCEPT_ENTRY: Symbol = 'A';
+const RULE_ENTRY: Symbol = 'Q';
+const ID_END: Symbol = '.';
+const FIELD_END: Symbol = ',';
+const SECTION_END: Symbol = '/';
+/// A wildcard read, or a write that leaves the cell unchanged.
+const ANY: Symbol = '?';
+const ZERO: Symbol = '0';
+const ONE: Symbol = '1';
+const LEFT: Symbol = 'L';
+const RIGHT: Symbol = 'R';
+const STAY: Symbol = 'S';
+const RUNNING: Symbol = '?';
+const ACCEPTED: Symbol = 'Y';
+const STUCK: Symbol = 'N';
+const LEFT_END: Symbol = '<';
+const RIGHT_END: Symbol = '>';
+const BLOCK: Symbol = '|';
+const ORIGIN_BLOCK: Symbol = 'o';
+const HEAD: Symbol = 'H';
+const ARRIVED: Symbol = 'h';
+const NO_HEAD: Symbol = '-';
+
+const DELIMITERS: [Symbol; 2] = [BLOCK, ORIGIN_BLOCK];
+/// Bits per character in the alphabet written after [`TABLE_END`]: enough for any Unicode scalar value.
+const CHAR_BITS: usize = 21;
+
+/// Where a guest run stands, as the status cell on [`STATE`] records it.
+#[derive(Clone, Copy, Debug, PartialEq, Eq)]
+pub enum GuestStatus {
+    /// Not halted: freshly encoded tapes, or a run stopped by a cap.
+    Running,
+    /// The guest reached an accept state.
+    Accepted,
+    /// The guest reached a state with no rule matching its tapes.
+    Stuck,
+}
+
+/// A guest run read back off the tapes.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub struct GuestRun {
+    pub status: GuestStatus,
+    /// One per guest tape, in guest symbols, with the head and cell 0 located.
+    pub tapes: Vec<OriginSnapshot>,
+}
+
+/// The initial tapes for guest `m` started on `inits`, or `None` when the guest cannot be encoded: a machine
+/// `Machine::validate` rejects, no tapes, more than [`MAX_GUEST_TAPES`], or more initial tapes than the machine
+/// has.
+#[must_use]
+pub fn encode_guest(m: &Machine, inits: &[Vec<Symbol>]) -> Option<Vec<Vec<Symbol>>> {
+    if !m.validate().is_empty() || m.tapes == 0 || m.tapes > MAX_GUEST_TAPES || inits.len() > m.tapes {
+        return None;
+    }
+    let symbols = guest_symbols(m, inits);
+    let code_width = width_for(symbols.len());
+    let id_width = width_for(m.states.len());
+    let code = |s: Symbol| symbols.iter().position(|x| *x == s).map(|i| bits(i, code_width));
+
+    let mut table = vec![TABLE_START];
+    for (sid, _) in m.states.iter().enumerate().filter(|(_, s)| s.accept) {
+        table.push(ACCEPT_ENTRY);
+        table.extend(bits(sid, id_width));
+        table.push(ID_END);
+    }
+    for (sid, state) in m.states.iter().enumerate().filter(|(_, s)| !s.accept) {
+        for r in &state.rules {
+            table.push(RULE_ENTRY);
+            table.extend(bits(sid, id_width));
+            table.push(ID_END);
+            for cells in [&r.read, &r.write] {
+                for cell in cells {
+                    match cell {
+                        Some(s) => table.extend(code(*s)?),
+                        None => table.push(ANY),
+                    }
+                    table.push(FIELD_END);
+                }
+                table.push(SECTION_END);
+            }
+            table.extend(r.moves.iter().map(|mv| match mv {
+                Move::L => LEFT,
+                Move::R => RIGHT,
+                Move::S => STAY,
+            }));
+            table.push(SECTION_END);
+            table.extend(bits(usize::try_from(r.next).ok()?, id_width));
+            table.push(ID_END);
+        }
+    }
+    table.push(TABLE_END);
+    for s in &symbols {
+        table.extend(bits(usize::try_from(u32::from(*s)).ok()?, CHAR_BITS));
+        table.push(FIELD_END);
+    }
+
+    let mut state = vec![RUNNING];
+    state.extend(bits(usize::try_from(m.start).ok()?, id_width));
+    state.push(ID_END);
+
+    let cells = inits.iter().map(Vec::len).max().unwrap_or(0).max(1);
+    let mut guest = vec![LEFT_END];
+    for j in 0..cells {
+        guest.push(if j == 0 { ORIGIN_BLOCK } else { BLOCK });
+        for t in 0..m.tapes {
+            guest.push(if j == 0 { HEAD } else { NO_HEAD });
+            let s = inits.get(t).and_then(|tape| tape.get(j)).copied().unwrap_or(BLANK);
+            guest.extend(code(s)?);
+        }
+    }
+    guest.push(RIGHT_END);
+
+    let slots = |first: Symbol| {
+        std::iter::once(LEFT_END)
+            .chain((0..m.tapes).flat_map(move |_| std::iter::once(first).chain(std::iter::repeat_n(ZERO, code_width))))
+            .chain([RIGHT_END])
+            .collect::<Vec<Symbol>>()
+    };
+    Some(vec![table, state, guest, slots(FIELD_END), slots(STAY)])
+}
+
+/// A guest run read back off the tapes, or `None` when they are not tapes [`encode_guest`] lays out or a
+/// machine leaves between guest steps: no alphabet, an unknown status, blocks of unequal size, or a track with
+/// no head or more than one.
+#[must_use]
+pub fn decode_guest(tapes: &[Tape]) -> Option<GuestRun> {
+    let [table, state, guest, ..] = tapes else { return None };
+    let status = match *state.snapshot().0.first()? {
+        RUNNING => GuestStatus::Running,
+        ACCEPTED => GuestStatus::Accepted,
+        STUCK => GuestStatus::Stuck,
+        _ => return None,
+    };
+
+    let (table, _) = table.snapshot();
+    let mut rest = &table[table.iter().position(|c| *c == TABLE_END)? + 1..];
+    let mut symbols = Vec::new();
+    while let Some(end) = rest.iter().position(|c| *c == FIELD_END) {
+        symbols.push(char::from_u32(u32::try_from(value_of(&rest[..end])?).ok()?)?);
+        rest = &rest[end + 1..];
+    }
+    let slot = width_for(symbols.len()) + 1;
+
+    let (guest, _) = guest.snapshot();
+    let body =
+        guest.get(guest.iter().position(|c| *c == LEFT_END)? + 1..guest.iter().position(|c| *c == RIGHT_END)?)?;
+    let origin = body.iter().filter(|c| DELIMITERS.contains(c)).position(|c| *c == ORIGIN_BLOCK)?;
+    let blocks: Vec<&[Symbol]> = body.split(|c| DELIMITERS.contains(c)).skip(1).collect();
+    let block_len = blocks.first()?.len();
+    if block_len == 0 || block_len % slot != 0 || blocks.iter().any(|b| b.len() != block_len) {
+        return None;
+    }
+    let mut out = Vec::with_capacity(block_len / slot);
+    for t in 0..block_len / slot {
+        let mut cells = Vec::with_capacity(blocks.len());
+        let mut heads = Vec::new();
+        for (j, block) in blocks.iter().enumerate() {
+            let cell = &block[t * slot..(t + 1) * slot];
+            match cell[0] {
+                HEAD | ARRIVED => heads.push(j),
+                NO_HEAD => {}
+                _ => return None,
+            }
+            cells.push(*symbols.get(value_of(&cell[1..])?)?);
+        }
+        let [head] = heads[..] else { return None };
+        out.push(OriginSnapshot { cells, head, origin });
+    }
+    Some(GuestRun { status, tapes: out })
+}
+
+/// Every symbol the guest can meet, [`BLANK`] first so its code is all zeros, then the rest in order.
+fn guest_symbols(m: &Machine, inits: &[Vec<Symbol>]) -> Vec<Symbol> {
+    let mut rest: BTreeSet<Symbol> = m.alphabet().into_iter().chain(inits.iter().flatten().copied()).collect();
+    rest.remove(&BLANK);
+    std::iter::once(BLANK).chain(rest).collect()
+}
+
+/// Bits needed to write any of `n` values, and at least one.
+fn width_for(n: usize) -> usize {
+    let bits = usize::BITS - n.saturating_sub(1).leading_zeros();
+    usize::try_from(bits).unwrap_or(usize::MAX).max(1)
+}
+
+/// `value` in `width` bits, most significant first.
+fn bits(value: usize, width: usize) -> Vec<Symbol> {
+    (0..width).rev().map(|i| if (value >> i) & 1 == 1 { ONE } else { ZERO }).collect()
+}
+
+/// The value of a run of bits, most significant first, or `None` for a cell that is not a bit.
+fn value_of(cells: &[Symbol]) -> Option<usize> {
+    cells.iter().try_fold(0usize, |acc, c| match *c {
+        ZERO => acc.checked_mul(2),
+        ONE => acc.checked_mul(2)?.checked_add(1),
+        _ => None,
+    })
+}
+
+#[cfg(test)]
+mod tests {
+    use super::*;
+    use crate::tm::machine::{Rule, State};
+
+    /// A one-tape unary incrementer: skip the `1`s, write a `1` on the first blank, accept.
+    fn increment() -> Machine {
+        Machine {
+            tapes: 1,
+            start: 0,
+            states: vec![
+                State {
+                    name: "scan".into(),
+                    accept: false,
+                    rules: vec![
+                        Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::R], next: 0 },
+                        Rule { read: vec![None], write: vec![Some('1')], moves: vec![Move::S], next: 1 },
+                    ],
+                },
+                State { name: "halt".into(), accept: true, rules: vec![] },
+            ],
+        }
+    }
+
+    fn text(cells: &[Symbol]) -> String {
+        cells.iter().collect()
+    }
+
+    fn tapes_of(cells: &[Vec<Symbol>]) -> Vec<Tape> {
+        cells.iter().map(|t| Tape::new(t)).collect()
+    }
+
+    /// Every field of every tape for a guest small enough to read: two symbols in one bit (`_` is 0, `1` is
+    /// 1), two states in one bit, the accept entry before the rules, and the alphabet after the table's end
+    /// as 21-bit character codes.
+    #[test]
+    fn encode_guest_lays_out_the_five_tapes() {
+        let tapes = encode_guest(&increment(), &[vec!['1', '1']]).expect("an encodable guest");
+        assert_eq!(text(&tapes[TABLE]), "^A1.Q0.1,/?,/R/0.Q0.?,/1,/S/1.$000000000000001011111,000000000000000110001,");
+        assert_eq!(text(&tapes[STATE]), "?0.");
+        assert_eq!(text(&tapes[GUEST]), "<oH1|-1>");
+        assert_eq!(text(&tapes[KEY]), "<,0>");
+        assert_eq!(text(&tapes[ACTION]), "<S0>");
+    }
+
+    /// Freshly encoded tapes decode to the initial tapes, every track as long as the longest, blank-padded,
+    /// with every head and the origin on cell 0.
+    #[test]
+    fn freshly_encoded_tapes_decode_to_the_initial_tapes() {
+        let m = Machine {
+            tapes: 3,
+            start: 0,
+            states: vec![State {
+                name: "s".into(),
+                accept: false,
+                rules: vec![Rule {
+                    read: vec![Some('a'), None, Some('b')],
+                    write: vec![None, Some('c'), None],
+                    moves: vec![Move::S; 3],
+                    next: 0,
+                }],
+            }],
+        };
+        let inits = [vec!['a', 'b'], vec![], vec!['b']];
+        let run = decode_guest(&tapes_of(&encode_guest(&m, &inits).expect("an encodable guest"))).expect("well formed");
+        assert_eq!(run.status, GuestStatus::Running);
+        let want: Vec<OriginSnapshot> = [['a', 'b'], [BLANK, BLANK], ['b', BLANK]]
+            .into_iter()
+            .map(|cells| OriginSnapshot { cells: cells.to_vec(), head: 0, origin: 0 })
+            .collect();
+        assert_eq!(run.tapes, want);
+    }
+
+    #[test]
+    fn encode_guest_refuses_what_it_cannot_lay_out() {
+        let accept_only =
+            |tapes| Machine { tapes, start: 0, states: vec![State { name: "s".into(), accept: true, rules: vec![] }] };
+        assert!(encode_guest(&increment(), &[vec![], vec![]]).is_none(), "more initial tapes than the machine has");
+        let mut invalid = increment();
+        invalid.start = 9;
+        assert!(encode_guest(&invalid, &[]).is_none(), "a machine `validate` rejects");
+        assert!(encode_guest(&accept_only(0), &[]).is_none(), "no tapes");
+        assert!(encode_guest(&accept_only(MAX_GUEST_TAPES + 1), &[]).is_none(), "more than MAX_GUEST_TAPES");
+        assert!(encode_guest(&accept_only(MAX_GUEST_TAPES), &[]).is_some(), "exactly MAX_GUEST_TAPES");
+    }
+
+    #[test]
+    fn decode_guest_refuses_tapes_it_cannot_read() {
+        let good = encode_guest(&increment(), &[vec!['1']]).expect("an encodable guest");
+        let with = |tape: usize, cells: &str| {
+            let mut tapes = good.clone();
+            tapes[tape] = cells.chars().collect();
+            decode_guest(&tapes_of(&tapes))
+        };
+        assert!(decode_guest(&tapes_of(&good)).is_some(), "the unaltered tapes decode");
+        assert!(with(GUEST, "<oH1|H0>").is_none(), "a track with two heads");
+        assert!(with(GUEST, "<o-1|-0>").is_none(), "a track with no head");
+        assert!(with(GUEST, "<oH1|-10>").is_none(), "blocks of unequal size");
+        assert!(with(STATE, "X0.").is_none(), "an unknown status");
+        assert!(with(TABLE, "^").is_none(), "no alphabet");
+        assert!(decode_guest(&tapes_of(&good[..2])).is_none(), "too few tapes");
+    }
+}
````
<!-- END task1.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0` with no diff printed; `clippy exit 0` with no warning.

- [ ] **Step 4: Run this task's tests**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core --lib tm::universal
```

Expected summary line: `4 tests run: 4 passed, 830 skipped`

- [ ] **Step 5: Run the two text gates**

`--index` in Step 2 already tracks the new file; the attributions gate resolves citations against tracked files only.

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 480 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `460 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Lay a guest machine out on a universal machine's tapes, and read it back

universal.rs defines five tapes: the rule table, the guest's state, the
guest's tapes as interleaved tracks, and one slot per guest tape for the
code under its head and for a rule's write and move. encode_guest lays a
guest out on them; decode_guest reads a guest run back, including
whether it accepted or got stuck, from nothing but the tapes. Every
field is delimited, so no width or tape count is stored as a number.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

---

### Task 2: The universal machine

**Files:**
- Modify: `crates/redextape-core/src/tm/universal.rs`

**Why this is one task.** Each phase is a private function that adds states and rules to a `Builder`. Clippy's `-D warnings` rejects private functions nothing calls, so the phases land together with `universal_machine`, which calls them all.

**What it builds.** `universal_machine` allocates `boot`, `sweep-left`, `match`, `copy`, `sweep-right`, `guest-accepted` (an accept state) and `guest-stuck` (rule-less), and builds the phases between them. The guest step loops `sweep-left` → `match` → `copy` → `sweep-right` → `sweep-left`.

1. **`boot_phase`** moves STATE onto its first bit and GUEST, ACTION and KEY onto their right ends.
2. **`sweep_left_phase`** moves GUEST, ACTION and KEY leftward, a slot at a time.
   - Going left, a slot shows its bits before its flag, so a slot that needs work is handled at its flag by stepping back right over its bits and returning.
   - A head whose action is `L` has its write applied and its move marked `l`; the same track's slot one block left then takes the head.
   - Every head's final position has its code copied into KEY and its flag set to `H`.
   - A move still pending at the left end prepends a blank block, and the head there gets its code copied too.
3. **`match_phase`** walks TABLE from `^`.
   - An accept entry whose id equals STATE's writes `Y` into the status cell and halts in `guest-accepted`.
   - A rule entry whose id equals STATE's, and whose every read field equals KEY's slot or is `?`, continues into `copy` with TABLE on its first write field.
   - `$` writes `N` and halts in `guest-stuck`.
   - A mismatch returns KEY and STATE to their starts and moves on to the next entry.
4. **`copy_phase`** copies the rule's write fields into ACTION's slots (`?` fills a slot, meaning no write), its moves into ACTION's move cells, and its next id into STATE. It then returns TABLE, STATE and ACTION to their starts.
5. **`sweep_right_phase`** moves GUEST and ACTION rightward.
   - A head whose action is `S` has its write applied.
   - A head whose action is `R` has its write applied, its flag cleared and its move marked `r`; the same track's slot one block right takes it as `h`, which the rest of this sweep leaves alone.
   - A move still pending at the right end appends a blank block.

**Tests** run each phase alone on hand-made tapes, through `run_phase`: a prelude moves heads into position, since `Tape::new` always starts a head on cell 0. They cover:
- **`match`:** first match wins, a mismatched rule passing to a wildcard, the accept halt, and the stuck halt.
- **`copy`:** a two-tape rule copied, and every head back at its start.
- **`sweep_right`:** a right move, an append, and a stay written beside a left move left alone.
- **`sweep_left`:** a left move read at its new position, a prepend, and arrivals normalized.
- **The whole machine:** the incrementer, run to its accept halt.
- **The machine's size,** pinned at 55 states and 178 rules. It is a test of its own, not an assertion in front of the incrementer's run, so a sabotage that changes the machine still shows that run going red.

**Interfaces:**
- Consumes: Task 1's module; `crate::tm::build::{Builder, RuleSpec}`; `crate::tm::machine::StateId`.
- Produces: `pub fn universal_machine() -> Machine`.

- [ ] **Step 1: Confirm Task 1 is committed and nothing is pending**

```bash
git -C "$P" log --oneline -1 -- crates/redextape-core/src/tm/universal.rs && git -C "$P" diff --quiet HEAD -- crates/ && echo clean
```

Expected: Task 1's commit, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task2.patch | git -C "$P" apply --index --check && block_of task2.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/tm/universal.rs | 617 +++++++++++++++++++++++++++++-
 1 file changed, 599 insertions(+), 18 deletions(-)
```

<!-- BEGIN task2.patch -->
````diff
diff --git a/crates/redextape-core/src/tm/universal.rs b/crates/redextape-core/src/tm/universal.rs
index 0d8c1cc..4ff70ef 100644
--- a/crates/redextape-core/src/tm/universal.rs
+++ b/crates/redextape-core/src/tm/universal.rs
@@ -1,9 +1,10 @@
-//! The tapes a universal Turing machine runs a guest machine on, and how a guest run is read back off them.
+//! A universal Turing machine: ONE fixed machine, built once with `Builder`, that runs any guest machine
+//! laid out on its tapes.
 //!
-//! **NOTHING ABOUT A GUEST IS WRITTEN AS A NUMBER A MACHINE MUST COUNT.** The guest's tape count, its state-id
-//! width and its symbol-code width are implicit: every field on these tapes is delimited, so a machine can
-//! compare fields by walking them in lockstep. One layout therefore holds a guest of any tape count, any
-//! number of states and any alphabet.
+//! **NOTHING ABOUT A GUEST IS BUILT INTO THE UTM.** The guest's tape count, its state-id width and its
+//! symbol-code width are never stored as numbers the UTM reads: every field on the UTM's tapes is
+//! delimited, so the UTM compares fields by walking them in lockstep and never counts. One machine
+//! therefore runs a guest of any tape count, any number of states and any alphabet.
 //!
 //! **THE FIVE TAPES.**
 //!
@@ -13,12 +14,20 @@
 //! | [`STATE`] | a status cell, then the guest's current state id |
 //! | [`GUEST`] | every guest tape as one track per tape, a block per cell, with head and origin markers |
 //! | [`KEY`] | the code under each guest head, one slot per guest tape |
-//! | [`ACTION`] | a move and a write for each guest tape, one slot per guest tape |
+//! | [`ACTION`] | the matched rule's move and write for each guest tape, one slot per guest tape |
+//!
+//! **ONE GUEST STEP** is a whole-table scan: the UTM walks [`TABLE`] from its start and takes the first
+//! rule whose state id equals [`STATE`]'s and whose every read code equals [`KEY`]'s or is the wildcard.
+//! It copies that rule's writes, moves and next state, then applies them to [`GUEST`] in two sweeps: a
+//! rightward sweep writes and moves the heads going right or staying, and a leftward sweep writes and
+//! moves the heads going left and reads every head's new code into [`KEY`] for the next step. An accept
+//! state in the accept list halts the UTM in `guest-accepted`; a state no rule matches halts it in
+//! `guest-stuck`. The status cell on [`STATE`] records which, so [`decode_guest`] needs only the tapes.
 
 use std::collections::BTreeSet;
 
-use crate::tm::build::MAX_TAPES;
-use crate::tm::machine::{BLANK, Machine, Move, Symbol};
+use crate::tm::build::{Builder, MAX_TAPES, RuleSpec};
+use crate::tm::machine::{BLANK, Machine, Move, StateId, Symbol};
 use crate::tm::one_way::OriginSnapshot;
 use crate::tm::sim::Tape;
 
@@ -30,10 +39,10 @@ pub const STATE: usize = 1;
 pub const GUEST: usize = 2;
 /// The code under each guest head.
 pub const KEY: usize = 3;
-/// A move and a write for each guest tape.
+/// The matched rule's move and write for each guest tape.
 pub const ACTION: usize = 4;
 
-/// The most guest tapes [`encode_guest`] lays out: the most a parsed `.tm` file may declare. The layout itself
+/// The most guest tapes [`encode_guest`] lays out: the most a parsed `.tm` file may declare. The UTM itself
 /// has no limit, since tracks are delimited; this bounds what `encode_guest` allocates.
 pub const MAX_GUEST_TAPES: usize = MAX_TAPES;
 
@@ -51,6 +60,8 @@ const ONE: Symbol = '1';
 const LEFT: Symbol = 'L';
 const RIGHT: Symbol = 'R';
 const STAY: Symbol = 'S';
+const PENDING_LEFT: Symbol = 'l';
+const PENDING_RIGHT: Symbol = 'r';
 const RUNNING: Symbol = '?';
 const ACCEPTED: Symbol = 'Y';
 const STUCK: Symbol = 'N';
@@ -62,14 +73,17 @@ const HEAD: Symbol = 'H';
 const ARRIVED: Symbol = 'h';
 const NO_HEAD: Symbol = '-';
 
+const BITS: [Symbol; 2] = [ZERO, ONE];
+const FLAGS: [Symbol; 3] = [HEAD, ARRIVED, NO_HEAD];
 const DELIMITERS: [Symbol; 2] = [BLOCK, ORIGIN_BLOCK];
+const ACTION_MOVES: [Symbol; 5] = [LEFT, RIGHT, STAY, PENDING_LEFT, PENDING_RIGHT];
 /// Bits per character in the alphabet written after [`TABLE_END`]: enough for any Unicode scalar value.
 const CHAR_BITS: usize = 21;
 
 /// Where a guest run stands, as the status cell on [`STATE`] records it.
 #[derive(Clone, Copy, Debug, PartialEq, Eq)]
 pub enum GuestStatus {
-    /// Not halted: freshly encoded tapes, or a run stopped by a cap.
+    /// The UTM has not halted: freshly encoded tapes, or a run stopped by a cap.
     Running,
     /// The guest reached an accept state.
     Accepted,
@@ -77,7 +91,7 @@ pub enum GuestStatus {
     Stuck,
 }
 
-/// A guest run read back off the tapes.
+/// A guest run read back out of the UTM's tapes.
 #[derive(Clone, Debug, PartialEq, Eq)]
 pub struct GuestRun {
     pub status: GuestStatus,
@@ -85,9 +99,28 @@ pub struct GuestRun {
     pub tapes: Vec<OriginSnapshot>,
 }
 
-/// The initial tapes for guest `m` started on `inits`, or `None` when the guest cannot be encoded: a machine
-/// `Machine::validate` rejects, no tapes, more than [`MAX_GUEST_TAPES`], or more initial tapes than the machine
-/// has.
+/// The fixed universal machine. Its start state expects the tapes [`encode_guest`] lays out.
+#[must_use]
+pub fn universal_machine() -> Machine {
+    let mut b = Builder::new();
+    let boot = b.state("boot");
+    let sweep_left = b.state("sweep-left");
+    let match_entry = b.state("match");
+    let copy_entry = b.state("copy");
+    let sweep_right = b.state("sweep-right");
+    let accepted = b.accept("guest-accepted");
+    let stuck = b.state("guest-stuck");
+    boot_phase(&mut b, boot, sweep_left);
+    sweep_left_phase(&mut b, sweep_left, match_entry);
+    match_phase(&mut b, match_entry, copy_entry, accepted, stuck);
+    copy_phase(&mut b, copy_entry, sweep_right);
+    sweep_right_phase(&mut b, sweep_right, sweep_left);
+    b.finish(boot)
+}
+
+/// The UTM's initial tapes for guest `m` started on `inits`, or `None` when the guest cannot be encoded: a
+/// machine `Machine::validate` rejects, no tapes, more than [`MAX_GUEST_TAPES`], or more initial tapes than
+/// the machine has.
 #[must_use]
 pub fn encode_guest(m: &Machine, inits: &[Vec<Symbol>]) -> Option<Vec<Vec<Symbol>>> {
     if !m.validate().is_empty() || m.tapes == 0 || m.tapes > MAX_GUEST_TAPES || inits.len() > m.tapes {
@@ -160,9 +193,9 @@ pub fn encode_guest(m: &Machine, inits: &[Vec<Symbol>]) -> Option<Vec<Vec<Symbol
     Some(vec![table, state, guest, slots(FIELD_END), slots(STAY)])
 }
 
-/// A guest run read back off the tapes, or `None` when they are not tapes [`encode_guest`] lays out or a
-/// machine leaves between guest steps: no alphabet, an unknown status, blocks of unequal size, or a track with
-/// no head or more than one.
+/// A guest run read back out of the UTM's tapes, or `None` when they are not tapes [`encode_guest`] lays out
+/// or the UTM leaves between guest steps: no alphabet, an unknown status, blocks of unequal size, or a
+/// track with no head or more than one.
 #[must_use]
 pub fn decode_guest(tapes: &[Tape]) -> Option<GuestRun> {
     let [table, state, guest, ..] = tapes else { return None };
@@ -237,10 +270,365 @@ fn value_of(cells: &[Symbol]) -> Option<usize> {
     })
 }
 
+/// A rule over the named tapes — `(tape, read, write, move)`, `None` a wildcard read or no write — leaving
+/// every other tape unread, unwritten and unmoved.
+fn on(parts: &[(usize, Option<Symbol>, Option<Symbol>, Move)]) -> RuleSpec {
+    parts.iter().fold(RuleSpec::new(), |spec, &(t, r, w, mv)| spec.on(t, r, w, mv))
+}
+
+/// A rule reading `guest` on [`GUEST`], `action` on [`ACTION`], writing `guest_write` and `action_write` there,
+/// and moving [`GUEST`], [`ACTION`] and [`KEY`] together by `mv`.
+fn swept(
+    guest: Option<Symbol>,
+    guest_write: Option<Symbol>,
+    action: Option<Symbol>,
+    action_write: Option<Symbol>,
+    mv: Move,
+) -> RuleSpec {
+    on(&[(GUEST, guest, guest_write, mv), (ACTION, action, action_write, mv), (KEY, None, None, mv)])
+}
+
+/// From freshly encoded tapes: [`STATE`] onto its first bit, and [`GUEST`], [`ACTION`] and [`KEY`] onto
+/// their right ends, where [`sweep_left_phase`] starts.
+fn boot_phase(b: &mut Builder, entry: StateId, exit: StateId) {
+    let guest_right = b.state("boot.guest");
+    let others_right = b.state("boot.others");
+    b.add_rule(entry, on(&[(STATE, None, None, Move::R)]), guest_right);
+    b.add_rule(guest_right, on(&[(GUEST, Some(RIGHT_END), None, Move::S)]), others_right);
+    b.add_rule(guest_right, on(&[(GUEST, None, None, Move::R)]), guest_right);
+    b.add_rule(others_right, on(&[(ACTION, Some(RIGHT_END), None, Move::S)]), exit);
+    b.add_rule(others_right, on(&[(ACTION, None, None, Move::R), (KEY, None, None, Move::R)]), others_right);
+}
+
+/// The leftward sweep: [`GUEST`], [`ACTION`] and [`KEY`] from their right ends to their left ends, in
+/// lockstep, a slot of each at a time.
+///
+/// **GOING LEFT, A SLOT SHOWS ITS BITS BEFORE ITS FLAG**, so a slot needing work is handled at its flag by
+/// stepping back right over its bits and returning. A head whose action is `L` has its write applied and its
+/// move marked pending; the same track's slot in the next block left takes the head. Every head's final
+/// position has its code copied into [`KEY`] and its flag normalized to `H`. A move still pending at the
+/// left end prepends a blank block. It ends with the three swept tapes on their left ends.
+fn sweep_left_phase(b: &mut Builder, entry: StateId, exit: StateId) {
+    let over_bits = b.state("sl.bits");
+    let flag = b.state("sl.flag");
+    let write = b.state("sl.write");
+    let write_back = b.state("sl.write-back");
+    let read = b.state("sl.read");
+    let read_back = b.state("sl.read-back");
+    let next_block = b.state("sl.next-block");
+    let scan = b.state("sl.scan");
+    let key_home = b.state("sl.key-home");
+    let prepend = b.state("sl.prepend");
+
+    b.add_rule(entry, swept(None, None, None, None, Move::L), over_bits);
+
+    b.add_rule(over_bits, on(&[(GUEST, Some(LEFT_END), None, Move::S)]), scan);
+    for d in DELIMITERS {
+        b.add_rule(over_bits, on(&[(GUEST, Some(d), None, Move::S)]), next_block);
+    }
+    for f in FLAGS {
+        b.add_rule(over_bits, on(&[(GUEST, Some(f), None, Move::S)]), flag);
+    }
+    b.add_rule(over_bits, swept(None, None, None, None, Move::L), over_bits);
+
+    // ACTION and KEY sit on their left ends at a delimiter; both run back to their right ends, and then all
+    // three step left onto the previous block's last slot, or GUEST onto its left end.
+    b.add_rule(next_block, swept(None, None, Some(RIGHT_END), None, Move::L), over_bits);
+    b.add_rule(next_block, on(&[(ACTION, None, None, Move::R), (KEY, None, None, Move::R)]), next_block);
+
+    b.add_rule(flag, swept(Some(HEAD), None, Some(LEFT), None, Move::R), write);
+    b.add_rule(flag, swept(Some(NO_HEAD), Some(ARRIVED), Some(PENDING_LEFT), Some(STAY), Move::R), read);
+    b.add_rule(flag, swept(Some(HEAD), None, None, None, Move::R), read);
+    b.add_rule(flag, swept(Some(ARRIVED), None, None, None, Move::R), read);
+    b.add_rule(flag, swept(None, None, None, None, Move::L), over_bits);
+
+    for c in [HEAD, ARRIVED, NO_HEAD, BLOCK, ORIGIN_BLOCK, RIGHT_END] {
+        b.add_rule(write, swept(Some(c), None, None, None, Move::L), write_back);
+    }
+    b.add_rule(write, swept(None, None, Some(ANY), None, Move::R), write);
+    for bit in BITS {
+        b.add_rule(write, swept(None, Some(bit), Some(bit), None, Move::R), write);
+    }
+    for bit in BITS {
+        b.add_rule(write_back, swept(Some(bit), None, None, None, Move::L), write_back);
+    }
+    b.add_rule(write_back, swept(Some(HEAD), Some(NO_HEAD), None, Some(PENDING_LEFT), Move::L), over_bits);
+
+    copy_code_into_key(b, read, read_back, over_bits);
+
+    b.add_rule(scan, on(&[(ACTION, Some(PENDING_LEFT), None, Move::S)]), prepend);
+    b.add_rule(scan, on(&[(ACTION, Some(LEFT_END), None, Move::S)]), key_home);
+    b.add_rule(scan, on(&[(ACTION, None, None, Move::L)]), scan);
+    b.add_rule(key_home, on(&[(KEY, Some(LEFT_END), None, Move::S)]), exit);
+    b.add_rule(key_home, on(&[(KEY, None, None, Move::L)]), key_home);
+
+    prepend_block(b, prepend, exit);
+}
+
+/// From a flag on [`GUEST`], with every swept tape one cell into its slot: copy the slot's bits into
+/// [`KEY`], return to the flag, set it to `H`, and step left into `done`.
+fn copy_code_into_key(b: &mut Builder, read: StateId, read_back: StateId, done: StateId) {
+    for bit in BITS {
+        b.add_rule(read, swept(Some(bit), None, None, None, Move::R).on(KEY, None, Some(bit), Move::R), read);
+    }
+    b.add_rule(read, swept(None, None, None, None, Move::L), read_back);
+    for bit in BITS {
+        b.add_rule(read_back, swept(Some(bit), None, None, None, Move::L), read_back);
+    }
+    for f in [HEAD, ARRIVED] {
+        b.add_rule(read_back, swept(Some(f), Some(HEAD), None, None, Move::L), done);
+    }
+}
+
+/// With [`GUEST`] on its left end and a move pending on [`ACTION`]: write a blank block leftward in the left
+/// end's place, give each pending track its head there and copy that head's code into [`KEY`], and close it
+/// with a delimiter and a new left end.
+fn prepend_block(b: &mut Builder, entry: StateId, exit: StateId) {
+    let key_right = b.state("sl.prepend-key");
+    let cell = b.state("sl.prepend-cell");
+    let flag = b.state("sl.prepend-flag");
+    let read = b.state("sl.prepend-read");
+    let read_back = b.state("sl.prepend-read-back");
+    let close = b.state("sl.prepend-close");
+
+    b.add_rule(entry, on(&[(ACTION, Some(RIGHT_END), None, Move::S)]), key_right);
+    b.add_rule(entry, on(&[(ACTION, None, None, Move::R)]), entry);
+    b.add_rule(key_right, on(&[(KEY, Some(RIGHT_END), None, Move::L), (ACTION, None, None, Move::L)]), cell);
+    b.add_rule(key_right, on(&[(KEY, None, None, Move::R)]), key_right);
+
+    b.add_rule(cell, on(&[(ACTION, Some(LEFT_END), None, Move::S), (GUEST, None, Some(BLOCK), Move::L)]), close);
+    for mv in ACTION_MOVES {
+        b.add_rule(cell, on(&[(ACTION, Some(mv), None, Move::S)]), flag);
+    }
+    b.add_rule(cell, swept(None, Some(ZERO), None, None, Move::L), cell);
+
+    b.add_rule(flag, swept(None, Some(ARRIVED), Some(PENDING_LEFT), Some(STAY), Move::R), read);
+    b.add_rule(flag, swept(None, Some(NO_HEAD), None, None, Move::L), cell);
+    copy_code_into_key(b, read, read_back, cell);
+
+    b.add_rule(close, on(&[(GUEST, None, Some(LEFT_END), Move::S)]), exit);
+}
+
+/// Find the first rule for the current guest state matching [`KEY`], from [`TABLE`]'s start.
+///
+/// Expects [`TABLE`] on its start, [`STATE`] on its first bit and [`KEY`] on its left end. A matching accept
+/// entry marks the status accepted and halts in `accepted`; reaching the table's end marks it stuck and
+/// halts in `stuck`. A matching rule leaves [`TABLE`] on the rule's first write field, [`STATE`] on its id's
+/// end and [`KEY`] on its right end, and continues in `matched`.
+fn match_phase(b: &mut Builder, entry: StateId, matched: StateId, accepted: StateId, stuck: StateId) {
+    let scan = entry;
+    let accept_id = b.state("m.accept-id");
+    let rule_id = b.state("m.rule-id");
+    let mark_accepted = b.state("m.mark-accepted");
+    let mark_stuck = b.state("m.mark-stuck");
+    let next_entry = b.state("m.next-entry");
+    let field = b.state("m.field");
+    let field_any = b.state("m.field-any");
+    let field_bits = b.state("m.field-bits");
+    let next_rule = b.state("m.next-rule");
+
+    b.add_rule(scan, on(&[(TABLE, Some(ACCEPT_ENTRY), None, Move::R)]), accept_id);
+    b.add_rule(scan, on(&[(TABLE, Some(RULE_ENTRY), None, Move::R)]), rule_id);
+    b.add_rule(scan, on(&[(TABLE, Some(TABLE_END), None, Move::S)]), mark_stuck);
+    b.add_rule(scan, on(&[(TABLE, None, None, Move::R)]), scan);
+
+    for (id, on_equal) in [(accept_id, None), (rule_id, Some(field))] {
+        for bit in BITS {
+            b.add_rule(id, on(&[(TABLE, Some(bit), None, Move::R), (STATE, Some(bit), None, Move::R)]), id);
+        }
+        match on_equal {
+            None => b.add_rule(
+                id,
+                on(&[(TABLE, Some(ID_END), None, Move::S), (STATE, Some(ID_END), None, Move::S)]),
+                mark_accepted,
+            ),
+            Some(f) => b.add_rule(
+                id,
+                on(&[
+                    (TABLE, Some(ID_END), None, Move::R),
+                    (STATE, Some(ID_END), None, Move::S),
+                    (KEY, None, None, Move::R),
+                ]),
+                f,
+            ),
+        }
+        b.add_rule(id, on(&[]), next_entry);
+    }
+
+    for (mark, status, halt) in [(mark_accepted, ACCEPTED, accepted), (mark_stuck, STUCK, stuck)] {
+        b.add_rule(mark, on(&[(STATE, Some(RUNNING), Some(status), Move::S)]), halt);
+        b.add_rule(mark, on(&[(STATE, None, None, Move::L)]), mark);
+    }
+    b.add_rule(next_entry, on(&[(STATE, Some(RUNNING), None, Move::R)]), scan);
+    b.add_rule(next_entry, on(&[(STATE, None, None, Move::L)]), next_entry);
+
+    b.add_rule(field, on(&[(TABLE, Some(SECTION_END), None, Move::R), (KEY, Some(RIGHT_END), None, Move::S)]), matched);
+    b.add_rule(field, on(&[(TABLE, Some(ANY), None, Move::R), (KEY, Some(FIELD_END), None, Move::R)]), field_any);
+    for bit in BITS {
+        b.add_rule(field, on(&[(TABLE, Some(bit), None, Move::S), (KEY, Some(FIELD_END), None, Move::R)]), field_bits);
+    }
+    b.add_rule(field, on(&[]), next_rule);
+
+    for bit in BITS {
+        b.add_rule(field_any, on(&[(KEY, Some(bit), None, Move::R)]), field_any);
+    }
+    b.add_rule(field_any, on(&[(TABLE, None, None, Move::R)]), field);
+
+    for bit in BITS {
+        b.add_rule(field_bits, on(&[(TABLE, Some(bit), None, Move::R), (KEY, Some(bit), None, Move::R)]), field_bits);
+    }
+    for end in [FIELD_END, RIGHT_END] {
+        b.add_rule(field_bits, on(&[(TABLE, Some(FIELD_END), None, Move::R), (KEY, Some(end), None, Move::S)]), field);
+    }
+    b.add_rule(field_bits, on(&[]), next_rule);
+
+    b.add_rule(next_rule, on(&[(KEY, Some(LEFT_END), None, Move::S)]), next_entry);
+    b.add_rule(next_rule, on(&[(KEY, None, None, Move::L)]), next_rule);
+}
+
+/// Copy the matched rule's writes and moves into [`ACTION`] and its next state into [`STATE`], then return
+/// [`TABLE`], [`STATE`] and [`ACTION`] to where the next guest step starts them.
+fn copy_phase(b: &mut Builder, entry: StateId, exit: StateId) {
+    let write_field = b.state("c.write-field");
+    let write_any = b.state("c.write-any");
+    let write_bits = b.state("c.write-bits");
+    let moves_home = b.state("c.moves-home");
+    let move_field = b.state("c.move");
+    let move_skip = b.state("c.move-skip");
+    let next_home = b.state("c.next-home");
+    let next_state = b.state("c.next");
+    let table_home = b.state("c.table-home");
+    let state_home = b.state("c.state-home");
+    let action_home = b.state("c.action-home");
+
+    b.add_rule(entry, on(&[(ACTION, None, None, Move::R)]), write_field);
+
+    b.add_rule(write_field, on(&[(TABLE, Some(SECTION_END), None, Move::R)]), moves_home);
+    b.add_rule(write_field, on(&[(TABLE, Some(ANY), None, Move::R), (ACTION, None, None, Move::R)]), write_any);
+    b.add_rule(write_field, on(&[(ACTION, None, None, Move::R)]), write_bits);
+
+    for c in [ZERO, ONE, ANY] {
+        b.add_rule(write_any, on(&[(ACTION, Some(c), Some(ANY), Move::R)]), write_any);
+    }
+    b.add_rule(write_any, on(&[(TABLE, None, None, Move::R)]), write_field);
+
+    for bit in BITS {
+        b.add_rule(
+            write_bits,
+            on(&[(TABLE, Some(bit), None, Move::R), (ACTION, None, Some(bit), Move::R)]),
+            write_bits,
+        );
+    }
+    b.add_rule(write_bits, on(&[(TABLE, None, None, Move::R)]), write_field);
+
+    b.add_rule(moves_home, on(&[(ACTION, Some(LEFT_END), None, Move::R)]), move_field);
+    b.add_rule(moves_home, on(&[(ACTION, None, None, Move::L)]), moves_home);
+    for mv in [LEFT, RIGHT, STAY] {
+        b.add_rule(move_field, on(&[(TABLE, Some(mv), None, Move::R), (ACTION, None, Some(mv), Move::R)]), move_skip);
+    }
+    b.add_rule(move_field, on(&[(TABLE, None, None, Move::R)]), next_home);
+    for c in ACTION_MOVES.into_iter().chain([RIGHT_END]) {
+        b.add_rule(move_skip, on(&[(ACTION, Some(c), None, Move::S)]), move_field);
+    }
+    b.add_rule(move_skip, on(&[(ACTION, None, None, Move::R)]), move_skip);
+
+    b.add_rule(next_home, on(&[(STATE, Some(RUNNING), None, Move::R)]), next_state);
+    b.add_rule(next_home, on(&[(STATE, None, None, Move::L)]), next_home);
+    for bit in BITS {
+        b.add_rule(next_state, on(&[(TABLE, Some(bit), None, Move::R), (STATE, None, Some(bit), Move::R)]), next_state);
+    }
+    b.add_rule(next_state, on(&[]), table_home);
+
+    b.add_rule(table_home, on(&[(TABLE, Some(TABLE_START), None, Move::S)]), state_home);
+    b.add_rule(table_home, on(&[(TABLE, None, None, Move::L)]), table_home);
+    b.add_rule(state_home, on(&[(STATE, Some(RUNNING), None, Move::R)]), action_home);
+    b.add_rule(state_home, on(&[(STATE, None, None, Move::L)]), state_home);
+    b.add_rule(action_home, on(&[(ACTION, Some(LEFT_END), None, Move::S)]), exit);
+    b.add_rule(action_home, on(&[(ACTION, None, None, Move::L)]), action_home);
+}
+
+/// The rightward sweep: [`GUEST`] and [`ACTION`] from their left ends to their right ends, in lockstep.
+///
+/// A head whose action is `S` or `R` has its write applied; a head moving right leaves its flag and marks
+/// the move pending, and the same track's slot in the next block right takes it as `h`, which later steps of
+/// this sweep leave alone. A move still pending at the right end appends a blank block. It ends with
+/// [`GUEST`] and [`ACTION`] on their right ends, where [`sweep_left_phase`] starts.
+fn sweep_right_phase(b: &mut Builder, entry: StateId, exit: StateId) {
+    let block = b.state("sr.block");
+    let action_home = b.state("sr.action-home");
+    let flag = b.state("sr.flag");
+    let write = b.state("sr.write");
+    let skip = b.state("sr.skip");
+    let scan = b.state("sr.scan");
+    let action_end = b.state("sr.action-end");
+    let append = b.state("sr.append");
+    let append_flag = b.state("sr.append-flag");
+    let append_bits = b.state("sr.append-bits");
+
+    let right =
+        |guest: Option<Symbol>, guest_write: Option<Symbol>, action: Option<Symbol>, action_write: Option<Symbol>| {
+            on(&[(GUEST, guest, guest_write, Move::R), (ACTION, action, action_write, Move::R)])
+        };
+
+    b.add_rule(entry, on(&[(GUEST, None, None, Move::R)]), block);
+
+    b.add_rule(block, on(&[(GUEST, Some(RIGHT_END), None, Move::S)]), scan);
+    for d in DELIMITERS {
+        b.add_rule(block, right(Some(d), None, Some(LEFT_END), None), flag);
+        b.add_rule(block, on(&[(GUEST, Some(d), None, Move::S)]), action_home);
+    }
+    b.add_rule(action_home, on(&[(ACTION, Some(LEFT_END), None, Move::S)]), block);
+    b.add_rule(action_home, on(&[(ACTION, None, None, Move::L)]), action_home);
+
+    b.add_rule(flag, right(Some(HEAD), Some(NO_HEAD), Some(RIGHT), Some(PENDING_RIGHT)), write);
+    b.add_rule(flag, right(Some(HEAD), None, Some(STAY), None), write);
+    b.add_rule(flag, right(Some(NO_HEAD), Some(ARRIVED), Some(PENDING_RIGHT), Some(STAY)), skip);
+    b.add_rule(flag, right(None, None, None, None), skip);
+
+    for state in [write, skip] {
+        for f in FLAGS {
+            b.add_rule(state, on(&[(GUEST, Some(f), None, Move::S)]), flag);
+        }
+        for end in DELIMITERS.into_iter().chain([RIGHT_END]) {
+            b.add_rule(state, on(&[(GUEST, Some(end), None, Move::S)]), block);
+        }
+    }
+    b.add_rule(write, right(None, None, Some(ANY), None), write);
+    for bit in BITS {
+        b.add_rule(write, right(None, Some(bit), Some(bit), None), write);
+    }
+    b.add_rule(skip, right(None, None, None, None), skip);
+
+    b.add_rule(scan, on(&[(ACTION, Some(PENDING_RIGHT), None, Move::S)]), append);
+    b.add_rule(scan, on(&[(ACTION, Some(LEFT_END), None, Move::S)]), action_end);
+    b.add_rule(scan, on(&[(ACTION, None, None, Move::L)]), scan);
+    b.add_rule(action_end, on(&[(ACTION, Some(RIGHT_END), None, Move::S)]), exit);
+    b.add_rule(action_end, on(&[(ACTION, None, None, Move::R)]), action_end);
+
+    b.add_rule(
+        append,
+        on(&[(ACTION, Some(LEFT_END), None, Move::R), (GUEST, None, Some(BLOCK), Move::R)]),
+        append_flag,
+    );
+    b.add_rule(append, on(&[(ACTION, None, None, Move::L)]), append);
+    b.add_rule(append_flag, right(None, Some(ARRIVED), Some(PENDING_RIGHT), Some(STAY)), append_bits);
+    b.add_rule(
+        append_flag,
+        on(&[(ACTION, Some(RIGHT_END), None, Move::S), (GUEST, None, Some(RIGHT_END), Move::S)]),
+        exit,
+    );
+    b.add_rule(append_flag, right(None, Some(NO_HEAD), None, None), append_bits);
+    for c in ACTION_MOVES.into_iter().chain([RIGHT_END]) {
+        b.add_rule(append_bits, on(&[(ACTION, Some(c), None, Move::S)]), append_flag);
+    }
+    b.add_rule(append_bits, right(None, Some(ZERO), None, None), append_bits);
+}
+
 #[cfg(test)]
 mod tests {
     use super::*;
     use crate::tm::machine::{Rule, State};
+    use crate::tm::sim::{DEFAULT_CAPS, Status, simulate_final};
 
     /// A one-tape unary incrementer: skip the `1`s, write a `1` on the first blank, accept.
     fn increment() -> Machine {
@@ -339,4 +727,197 @@ mod tests {
         assert!(with(TABLE, "^").is_none(), "no alphabet");
         assert!(decode_guest(&tapes_of(&good[..2])).is_none(), "too few tapes");
     }
+
+    /// A head start for a phase: walk `tape` right until it reads one of `stop`, or step it right once.
+    enum Pre {
+        Seek(usize, &'static [Symbol]),
+        Step(usize),
+    }
+
+    /// Build a machine that runs `pre` and then the phase `build` adds from `entry`, run it on `tapes`, and
+    /// return every tape as `(cells, head)` and the name of the state it halted in. `build` allocates its own
+    /// exits, so the halting state's name says which exit the phase took.
+    fn run_phase(
+        tapes: &[&str],
+        pre: &[Pre],
+        build: impl FnOnce(&mut Builder, StateId),
+    ) -> (Vec<(String, usize)>, String) {
+        let mut b = Builder::new();
+        let start = b.state("pre");
+        let mut at = start;
+        for (i, p) in pre.iter().enumerate() {
+            let next = b.state(format!("pre.{i}"));
+            match p {
+                Pre::Seek(t, stop) => {
+                    for s in *stop {
+                        b.add_rule(at, on(&[(*t, Some(*s), None, Move::S)]), next);
+                    }
+                    b.add_rule(at, on(&[(*t, None, None, Move::R)]), at);
+                }
+                Pre::Step(t) => b.add_rule(at, on(&[(*t, None, None, Move::R)]), next),
+            }
+            at = next;
+        }
+        let entry = b.state("entry");
+        b.add_rule(at, on(&[]), entry);
+        build(&mut b, entry);
+        let m = b.finish(start);
+        assert_eq!(m.validate(), Vec::<String>::new());
+        let init: Vec<Vec<Symbol>> = tapes.iter().map(|t| t.chars().collect()).collect();
+        let (out, state, status, _) = simulate_final(&m, &init, DEFAULT_CAPS);
+        assert_eq!(status, Status::Halted, "the phase must halt");
+        let tapes = out.iter().map(|t| {
+            let (cells, head) = t.snapshot();
+            (text(&cells), head)
+        });
+        (tapes.collect(), m.states[state as usize].name.clone())
+    }
+
+    const INCREMENT_TABLE: &str = "^A1.Q0.1,/?,/R/0.Q0.?,/1,/S/1.$";
+
+    /// Run the match phase on `table` with `state` and `key`, returning the tapes and which exit it took.
+    fn run_match(table: &str, state: &str, key: &str) -> (Vec<(String, usize)>, String) {
+        run_phase(&[table, state, "<>", key, "<>"], &[Pre::Step(STATE)], |b, entry| {
+            let matched = b.state("matched");
+            let accepted = b.accept("accepted");
+            let stuck = b.state("stuck");
+            match_phase(b, entry, matched, accepted, stuck);
+        })
+    }
+
+    /// **THE FIRST MATCH WINS**: with `1` under the head both rules match — the second by its wildcard — and
+    /// the phase stops on the first rule's write field, index 10, not the second's, index 23.
+    #[test]
+    fn match_takes_the_first_matching_rule() {
+        let (tapes, exit) = run_match(INCREMENT_TABLE, "?0.", "<,1>");
+        assert_eq!(exit, "matched");
+        assert_eq!(tapes[TABLE].1, 10, "on the FIRST rule's write field");
+        assert_eq!((tapes[STATE].1, tapes[KEY].1), (2, 3), "STATE on its id's end, KEY on its right end");
+    }
+
+    #[test]
+    fn match_passes_a_mismatched_rule_to_a_wildcard() {
+        let (tapes, exit) = run_match(INCREMENT_TABLE, "?0.", "<,0>");
+        assert_eq!(exit, "matched");
+        assert_eq!(tapes[TABLE].1, 23, "on the second rule's write field");
+    }
+
+    #[test]
+    fn match_halts_accepted_on_an_accept_entry() {
+        let (tapes, exit) = run_match(INCREMENT_TABLE, "?1.", "<,0>");
+        assert_eq!((exit.as_str(), tapes[STATE].0.as_str()), ("accepted", "Y1."));
+    }
+
+    #[test]
+    fn match_halts_stuck_when_no_rule_matches() {
+        let (tapes, exit) = run_match("^Q0.1,/?,/R/0.$", "?0.", "<,0>");
+        assert_eq!((exit.as_str(), tapes[STATE].0.as_str()), ("stuck", "N0."));
+        assert_eq!(tapes[KEY].1, 0, "KEY back on its left end after the failed rule");
+    }
+
+    /// From the first write field of a two-tape rule: the write and the keep land in ACTION's slots, the
+    /// moves beside them, the next state in STATE, and every tape returns to where the next step starts it.
+    #[test]
+    fn copy_fills_action_and_state_and_rewinds() {
+        let (tapes, exit) = run_phase(
+            &["^Q0.?,1,/1,?,/RL/1.$", "?0.", "<>", ">", "<S0S0>"],
+            &[Pre::Seek(TABLE, &['/']), Pre::Step(TABLE), Pre::Seek(STATE, &['.'])],
+            |b, entry| {
+                let done = b.state("done");
+                copy_phase(b, entry, done);
+            },
+        );
+        assert_eq!(exit, "done");
+        assert_eq!(tapes[ACTION], ("<R1L?>".into(), 0));
+        assert_eq!(tapes[STATE], ("?1.".into(), 1));
+        assert_eq!(tapes[TABLE].1, 0);
+    }
+
+    fn run_sweep_right(guest: &str, action: &str) -> Vec<(String, usize)> {
+        let (tapes, exit) = run_phase(&["^", "?0.", guest, ">", action], &[], |b, entry| {
+            let done = b.state("done");
+            sweep_right_phase(b, entry, done);
+        });
+        assert_eq!(exit, "done");
+        tapes
+    }
+
+    #[test]
+    fn sweep_right_writes_and_moves_a_head_right() {
+        let tapes = run_sweep_right("<oH1|-0>", "<R0>");
+        assert_eq!(tapes[GUEST], ("<o-0|h0>".into(), 7), "written, then arrived one block right");
+        assert_eq!(tapes[ACTION], ("<S0>".into(), 3), "the pending move is spent");
+    }
+
+    #[test]
+    fn sweep_right_appends_a_block_for_a_head_leaving_the_right_end() {
+        let tapes = run_sweep_right("<oH1>", "<R?>");
+        assert_eq!(tapes[GUEST], ("<o-1|h0>".into(), 7), "kept, then a blank block appended for the head");
+        assert_eq!(tapes[ACTION].0, "<S?>");
+    }
+
+    #[test]
+    fn sweep_right_writes_a_staying_head_and_leaves_a_left_moving_one() {
+        let tapes = run_sweep_right("<oH0H1>", "<S1L0>");
+        assert_eq!(tapes[GUEST].0, "<oH1H1>", "the staying head written, the left-moving one not");
+    }
+
+    fn run_sweep_left(guest: &str, action: &str, key: &str) -> Vec<(String, usize)> {
+        let ends: &'static [Symbol] = &[RIGHT_END];
+        let (tapes, exit) = run_phase(
+            &["^", "?0.", guest, key, action],
+            &[Pre::Seek(GUEST, ends), Pre::Seek(ACTION, ends), Pre::Seek(KEY, ends)],
+            |b, entry| {
+                let done = b.state("done");
+                sweep_left_phase(b, entry, done);
+            },
+        );
+        assert_eq!(exit, "done");
+        assert_eq!((tapes[GUEST].1, tapes[ACTION].1, tapes[KEY].1), (0, 0, 0), "every swept tape on its left end");
+        tapes
+    }
+
+    #[test]
+    fn sweep_left_writes_and_moves_a_head_left_and_reads_it() {
+        let tapes = run_sweep_left("<o-1|H0>", "<L1>", "<,0>");
+        assert_eq!(tapes[GUEST].0, "<oH1|-1>", "written where it was, and arrived one block left");
+        assert_eq!(tapes[KEY].0, "<,1>", "the code at its new position");
+        assert_eq!(tapes[ACTION].0, "<S1>", "the pending move is spent");
+    }
+
+    #[test]
+    fn sweep_left_prepends_a_block_for_a_head_leaving_the_left_end() {
+        let tapes = run_sweep_left("<oH0>", "<L1>", "<,1>");
+        assert_eq!(tapes[GUEST].0, "<|H0o-1>", "a blank block before the origin, holding the head");
+        assert_eq!(tapes[KEY].0, "<,0>", "the blank code under it");
+    }
+
+    #[test]
+    fn sweep_left_reads_every_head_and_normalizes_arrivals() {
+        let tapes = run_sweep_left("<oh1H0>", "<S0S0>", "<,0,1>");
+        assert_eq!(tapes[GUEST].0, "<oH1H0>");
+        assert_eq!(tapes[KEY].0, "<,1,0>");
+    }
+
+    /// The whole machine on the incrementer: two `1`s become three, and the guest accepts.
+    #[test]
+    fn the_universal_machine_runs_the_incrementer() {
+        let utm = universal_machine();
+        assert_eq!(utm.validate(), Vec::<String>::new());
+        let tapes = encode_guest(&increment(), &[vec!['1', '1']]).expect("an encodable guest");
+        let (out, _, status, _) = simulate_final(&utm, &tapes, DEFAULT_CAPS);
+        assert_eq!(status, Status::Halted);
+        let run = decode_guest(&out).expect("well formed");
+        assert_eq!(run.status, GuestStatus::Accepted);
+        assert_eq!(run.tapes, vec![OriginSnapshot { cells: vec!['1', '1', '1'], head: 2, origin: 0 }]);
+    }
+
+    /// The fixed machine's size is pinned, so a change to it is a deliberate one: every guest step's cost is paid
+    /// in this machine's steps.
+    #[test]
+    fn the_universal_machine_is_55_states_and_178_rules() {
+        let utm = universal_machine();
+        let rules: usize = utm.states.iter().map(|s| s.rules.len()).sum();
+        assert_eq!((utm.states.len(), rules), (55, 178));
+    }
 }
````
<!-- END task2.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0` with no diff printed; `clippy exit 0` with no warning.

- [ ] **Step 4: Run this task's tests**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core --lib tm::universal
```

Expected summary line: `17 tests run: 17 passed, 830 skipped`

- [ ] **Step 5: Run the two text gates**

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 480 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `460 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Build the universal machine that runs a guest laid out on those tapes

universal_machine is one fixed 55-state machine. Each guest step scans
the whole rule table for the first rule matching the guest's state and
the code under every head, copies its writes, moves and next state,
and applies them in a rightward sweep and a leftward sweep that also
reads every head's new code. An accept entry halts it accepted; the
table's end halts it stuck. Each phase has unit tests from positioned
heads, and the incrementer runs through the whole machine.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

---

### Task 3: Hand-built and generated guests through the machine

**Files:**
- Create: `crates/redextape-core/tests/universal_oracle.rs`
- Modify: `crates/redextape-core/tests/common/mod.rs` — gains `run_with_origins` and `acyclic_machine`, and its module doc says why they are there
- Modify: `crates/redextape-core/tests/one_way_oracle.rs` — loses both, and imports them from `common`

**What it builds.**
- **`run_with_origins` and `acyclic_machine` move into `tests/common/mod.rs`,** since this leg needs both and `one_way_oracle.rs` defined them. Their bodies move unchanged and become `pub`, and `one_way_oracle.rs` imports them from `common`. The generator's doc gains its tape range. One clause of `run_with_origins`'s doc is dropped: it called the per-step length check affordable because every machine its file runs halts in thousands of steps, and this leg's direct run of `sum(5)` under unary takes 50,542 steps.
- **`assert_utm_agrees(label, m, inits, caps)`** runs the guest directly with `run_with_origins`, the method `one_way_oracle.rs` already used for locating each tape's origin. It then runs the guest through `universal_machine` under `caps`, which every caller in this task passes as `DEFAULT_CAPS`, and asserts, in order:
  1. the UTM halted;
  2. `decode_guest` reports `Accepted` exactly when the direct run halted in an accept state, and `Stuck` otherwise;
  3. every guest tape's `OriginSnapshot::trimmed` equals the direct run's.

  It prints a cost row and returns the decoded tapes.
- **One-tape guests:** the incrementer, a guest that walks two cells left of cell 0, and a guest stuck on a `b`.
- **Two-tape guests:** a unary copy across tapes, and two tapes moving apart.
- **A three-tape guest.** Every hand-built guest moves every tape, and one on each tape count reaches cell -2.
- **A proptest** over `acyclic_machine`, on one to three tapes, with shrinking bounded at ten seconds. A failing case runs again at every shrink step, and a UTM that never halts takes each run to its cap.
- **A fixed-seed check** that the generator produces every tape count and reaches cell -1.

**Interfaces:**
- Consumes: `crate::tm::universal::{GuestStatus, decode_guest, encode_guest, universal_machine}`.
- Produces: `assert_utm_agrees(label: &str, m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> Vec<OriginSnapshot>`, which Task 4 calls for compiled programs.
- Produces, in `tests/common/mod.rs`: `pub fn run_with_origins(m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> (Vec<OriginSnapshot>, StateId, Status, u64)` and `pub fn acyclic_machine() -> impl Strategy<Value = (Machine, Vec<Vec<Symbol>>)>`. Task 4 imports both beside `core_and_ty`.

- [ ] **Step 1: Confirm Task 2 is committed and nothing is pending**

```bash
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD -- crates/ && echo clean
```

Expected: Task 2's commit, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task3.patch | git -C "$P" apply --index --check && block_of task3.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/tests/common/mod.rs       |  89 ++++++++++-
 crates/redextape-core/tests/one_way_oracle.rs   |  80 +---------
 crates/redextape-core/tests/universal_oracle.rs | 193 ++++++++++++++++++++++++
 3 files changed, 281 insertions(+), 81 deletions(-)
```

<!-- BEGIN task3.patch -->
````diff
diff --git a/crates/redextape-core/tests/common/mod.rs b/crates/redextape-core/tests/common/mod.rs
index 4f96868..c381478 100644
--- a/crates/redextape-core/tests/common/mod.rs
+++ b/crates/redextape-core/tests/common/mod.rs
@@ -3,9 +3,12 @@
 //!
 //! Integration tests are separate binaries and cannot import one another, so these were originally
 //! duplicated across `tm_bank_invariant.rs`, `tm_exhaustive_bank_safety.rs` and
-//! `tm_static_delimiter_safety.rs`, with a test pinning the copies identical. Three copies is where
-//! that stops being cheaper than a shared module: `tests/common/mod.rs` is the standard way to share
-//! code between integration tests, and one definition cannot drift from itself.
+//! `tm_static_delimiter_safety.rs`, with a test pinning the copies identical. `tests/common/mod.rs` is
+//! the standard way to share code between integration tests, and one definition cannot drift from itself.
+//!
+//! Two oracle-leg helpers live here as well: `run_with_origins`, which locates each tape's origin after a
+//! run, and `acyclic_machine`, a generator of small machines that always halt. `one_way_oracle.rs` defined
+//! both; they moved here when `universal_oracle.rs` needed them too, so neither leg keeps a copy.
 //!
 //! Two checkers live here, and they establish DIFFERENT kinds of claim about the same property:
 //!
@@ -20,9 +23,13 @@
 #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
 #![allow(dead_code)] // each test binary uses a different subset
 
+use proptest::prelude::{Strategy, any, prop};
 use redextape_core::core::Core;
 use redextape_core::desugar::desugar;
 use redextape_core::parser::parse;
+use redextape_core::tm::machine::{Move, Rule, State, StateId};
+use redextape_core::tm::one_way::OriginSnapshot;
+use redextape_core::tm::sim::{Caps, Status, Tape, simulate_watched};
 use redextape_core::tm::{
     AT, BLANK, BOX, Encoding, EncodingKind, Machine, REG, SEP, Symbol, TM_DEFAULT_CAPS, TmRun, WORK, run_tm_described,
 };
@@ -337,3 +344,79 @@ pub fn stack_is_empty(cells: &[char]) -> Result<(), String> {
         )),
     }
 }
+
+/// Run `m` and record where each tape's origin ends up in its final snapshot.
+///
+/// **A TAPE GROWS ON ITS LEFT EXACTLY WHEN, AFTER A STEP, IT IS LONGER AND ITS HEAD IS AT INDEX 0.** A
+/// step moves a head at most one cell, so a tape grows by at most one; growth on the right leaves the
+/// head at index 1 or beyond. The count of left growths is the origin's index. `slice(0, usize::MAX)`
+/// is the tape's length, O(tape) per step.
+pub fn run_with_origins(m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> (Vec<OriginSnapshot>, StateId, Status, u64) {
+    let mut len: Vec<usize> = (0..m.tapes).map(|i| inits.get(i).map_or(1, |t| t.len().max(1))).collect();
+    let mut grown = vec![0usize; m.tapes];
+    let mut steps = 0u64;
+    let (tapes, state, status) = {
+        let mut watch = |tapes: &[Tape]| {
+            steps += 1;
+            for (i, t) in tapes.iter().enumerate() {
+                let l = t.slice(0, usize::MAX).len();
+                if l > len[i] && t.head_index() == 0 {
+                    grown[i] += l - len[i];
+                }
+                len[i] = l;
+            }
+            true
+        };
+        simulate_watched(m, inits, caps, &mut watch)
+    };
+    let snaps = tapes
+        .iter()
+        .zip(&grown)
+        .map(|(t, &origin)| {
+            let (cells, head) = t.snapshot();
+            OriginSnapshot { cells, head, origin }
+        })
+        .collect();
+    (snaps, state, status, steps)
+}
+
+/// Random machines of one to three tapes whose rules only ever target a higher-numbered state, so every
+/// run halts within as many steps as there are states. Moves lean left, since the left half is what this
+/// exists to reach.
+pub fn acyclic_machine() -> impl Strategy<Value = (Machine, Vec<Vec<Symbol>>)> {
+    (1usize..=3, 2usize..=12).prop_flat_map(|(tapes, n)| {
+        let sym = prop::sample::select(vec!['a', 'b', BLANK]);
+        let read = prop::option::of(sym.clone());
+        let write = prop::option::of(sym.clone());
+        let mv = prop::sample::select(vec![Move::L, Move::L, Move::R, Move::S]);
+        let rule = (
+            prop::collection::vec(read, tapes),
+            prop::collection::vec(write, tapes),
+            prop::collection::vec(mv, tapes),
+            any::<prop::sample::Index>(),
+        );
+        let states = prop::collection::vec(prop::collection::vec(rule, 1..=3), n);
+        let inits = prop::collection::vec(prop::collection::vec(sym, 0..4), tapes);
+        (states, inits).prop_map(move |(states, inits)| {
+            let mut built: Vec<State> = states
+                .into_iter()
+                .enumerate()
+                .map(|(i, rules)| State {
+                    name: format!("s{i}"),
+                    accept: false,
+                    rules: rules
+                        .into_iter()
+                        .map(|(read, write, moves, target)| Rule {
+                            read,
+                            write,
+                            moves,
+                            next: (i + 1 + target.index(n - i)) as StateId,
+                        })
+                        .collect(),
+                })
+                .collect();
+            built.push(State { name: "done".into(), accept: true, rules: vec![] });
+            (Machine { states: built, start: 0, tapes }, inits)
+        })
+    })
+}
diff --git a/crates/redextape-core/tests/one_way_oracle.rs b/crates/redextape-core/tests/one_way_oracle.rs
index d20c9df..48afccd 100644
--- a/crates/redextape-core/tests/one_way_oracle.rs
+++ b/crates/redextape-core/tests/one_way_oracle.rs
@@ -13,48 +13,12 @@ use proptest::prelude::*;
 use redextape_core::tm::EncodingKind;
 use redextape_core::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
 use redextape_core::tm::one_way::{LEFT_END, OriginSnapshot, to_one_way, unzigzag, zigzag};
-use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, Tape, simulate_final, simulate_watched};
+use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, simulate_final};
 use redextape_core::tm::single_tape::{LEFT, deinterleave, interleave, layout_collision, normalize, to_single_tape};
 use redextape_core::tm::two_symbol::{Code, bitify, to_two_symbol, unbitify};
 
 mod common;
-use common::build_machine;
-
-/// Run `m` and record where each tape's origin ends up in its final snapshot.
-///
-/// **A TAPE GROWS ON ITS LEFT EXACTLY WHEN, AFTER A STEP, IT IS LONGER AND ITS HEAD IS AT INDEX 0.** A
-/// step moves a head at most one cell, so a tape grows by at most one; growth on the right leaves the
-/// head at index 1 or beyond. The count of left growths is the origin's index. `slice(0, usize::MAX)`
-/// is the tape's length, O(tape) per step — affordable for machines that halt in thousands of steps,
-/// which is every machine this file runs through it.
-fn run_with_origins(m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> (Vec<OriginSnapshot>, StateId, Status, u64) {
-    let mut len: Vec<usize> = (0..m.tapes).map(|i| inits.get(i).map_or(1, |t| t.len().max(1))).collect();
-    let mut grown = vec![0usize; m.tapes];
-    let mut steps = 0u64;
-    let (tapes, state, status) = {
-        let mut watch = |tapes: &[Tape]| {
-            steps += 1;
-            for (i, t) in tapes.iter().enumerate() {
-                let l = t.slice(0, usize::MAX).len();
-                if l > len[i] && t.head_index() == 0 {
-                    grown[i] += l - len[i];
-                }
-                len[i] = l;
-            }
-            true
-        };
-        simulate_watched(m, inits, caps, &mut watch)
-    };
-    let snaps = tapes
-        .iter()
-        .zip(&grown)
-        .map(|(t, &origin)| {
-            let (cells, head) = t.snapshot();
-            OriginSnapshot { cells, head, origin }
-        })
-        .collect();
-    (snaps, state, status, steps)
-}
+use common::{acyclic_machine, build_machine, run_with_origins};
 
 struct Outcome {
     want: Vec<OriginSnapshot>,
@@ -240,46 +204,6 @@ fn two_tapes_crossing_the_origin_in_one_rule_agree() {
     assert!(out.want_accept && out.got_accept);
 }
 
-/// Random machines whose rules only ever target a higher-numbered state, so every run halts within as
-/// many steps as there are states. Moves lean left, since the left half is what this exists to reach.
-fn acyclic_machine() -> impl Strategy<Value = (Machine, Vec<Vec<Symbol>>)> {
-    (1usize..=3, 2usize..=12).prop_flat_map(|(tapes, n)| {
-        let sym = prop::sample::select(vec!['a', 'b', BLANK]);
-        let read = prop::option::of(sym.clone());
-        let write = prop::option::of(sym.clone());
-        let mv = prop::sample::select(vec![Move::L, Move::L, Move::R, Move::S]);
-        let rule = (
-            prop::collection::vec(read, tapes),
-            prop::collection::vec(write, tapes),
-            prop::collection::vec(mv, tapes),
-            any::<prop::sample::Index>(),
-        );
-        let states = prop::collection::vec(prop::collection::vec(rule, 1..=3), n);
-        let inits = prop::collection::vec(prop::collection::vec(sym, 0..4), tapes);
-        (states, inits).prop_map(move |(states, inits)| {
-            let mut built: Vec<State> = states
-                .into_iter()
-                .enumerate()
-                .map(|(i, rules)| State {
-                    name: format!("s{i}"),
-                    accept: false,
-                    rules: rules
-                        .into_iter()
-                        .map(|(read, write, moves, target)| Rule {
-                            read,
-                            write,
-                            moves,
-                            next: (i + 1 + target.index(n - i)) as StateId,
-                        })
-                        .collect(),
-                })
-                .collect();
-            built.push(State { name: "done".into(), accept: true, rules: vec![] });
-            (Machine { states: built, start: 0, tapes }, inits)
-        })
-    })
-}
-
 proptest! {
     #[test]
     fn random_acyclic_machines_agree_with_their_fold((m, inits) in acyclic_machine()) {
diff --git a/crates/redextape-core/tests/universal_oracle.rs b/crates/redextape-core/tests/universal_oracle.rs
new file mode 100644
index 0000000..a36b6fd
--- /dev/null
+++ b/crates/redextape-core/tests/universal_oracle.rs
@@ -0,0 +1,193 @@
+//! The universal-machine leg: a machine run directly and the same machine run as a guest of
+//! `universal.rs`'s `universal_machine` must end in the same place — the same accept or stuck halt, then every
+//! guest tape equal at its origin.
+//!
+//! **ONE MACHINE, EVERY TAPE COUNT**: hand-built guests of one, two and three tapes, and a proptest over small
+//! generated machines, are what show the UTM reads the tape count from its input.
+
+#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
+
+use proptest::prelude::*;
+use redextape_core::tm::machine::{Machine, Move, Rule, State, StateId, Symbol};
+use redextape_core::tm::one_way::OriginSnapshot;
+use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, simulate_final};
+use redextape_core::tm::universal::{GuestStatus, decode_guest, encode_guest, universal_machine};
+
+mod common;
+use common::{acyclic_machine, run_with_origins};
+
+/// The leg over any guest, returning the guest tapes the UTM left. The UTM runs under `caps`, so a UTM that never
+/// halts fails on a cap rather than running on. **The halt is asserted before the tapes**, so a UTM that stops
+/// early reports the halt rather than a tape difference it caused. Prints the cost row: guest steps, UTM steps,
+/// UTM steps per guest step, the encoded table's cells, and the cells the UTM's tapes end with, which is their
+/// peak, since a tape never shrinks.
+fn assert_utm_agrees(label: &str, m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> Vec<OriginSnapshot> {
+    let (want, want_state, want_status, guest_steps) = run_with_origins(m, inits, DEFAULT_CAPS);
+    assert_eq!(want_status, Status::Halted, "the direct run must halt for {label}");
+    let want_accept = m.states.get(want_state as usize).is_some_and(|s| s.accept);
+
+    let encoded = encode_guest(m, inits).unwrap_or_else(|| panic!("{label} must be encodable"));
+    let (tapes, _, status, utm_steps) = simulate_final(&universal_machine(), &encoded, caps);
+    assert_eq!(status, Status::Halted, "the UTM hit a cap for {label}");
+    let run = decode_guest(&tapes).unwrap_or_else(|| panic!("the UTM left tapes that do not decode for {label}"));
+    let want_status = if want_accept { GuestStatus::Accepted } else { GuestStatus::Stuck };
+    assert_eq!(run.status, want_status, "the UTM halted differently for {label}");
+    assert_eq!(run.tapes.len(), want.len(), "tape counts differ for {label}");
+    for (i, (got, want)) in run.tapes.iter().zip(&want).enumerate() {
+        assert_eq!(got.trimmed(), want.trimmed(), "guest tape {i} differs for {label}");
+    }
+
+    let per_step = utm_steps as f64 / guest_steps.max(1) as f64;
+    let peak: usize = tapes.iter().map(|t| t.snapshot().0.len()).sum();
+    println!(
+        "{label:64} guest {guest_steps:>6} steps, UTM {utm_steps:>13} steps ({per_step:>9.1} per guest step), table {:>6} cells, peak {peak:>6} cells",
+        encoded[0].len()
+    );
+    run.tapes
+}
+
+/// A machine of states `s0`, `s1`, … taking one rule each — read anything, then the given writes and moves —
+/// and then accepting.
+fn chain(tapes: usize, steps: &[(Vec<Option<Symbol>>, Vec<Move>)]) -> Machine {
+    let mut states: Vec<State> = steps
+        .iter()
+        .enumerate()
+        .map(|(i, (write, moves))| State {
+            name: format!("s{i}"),
+            accept: false,
+            rules: vec![Rule {
+                read: vec![None; tapes],
+                write: write.clone(),
+                moves: moves.clone(),
+                next: i as StateId + 1,
+            }],
+        })
+        .collect();
+    states.push(State { name: "done".into(), accept: true, rules: vec![] });
+    Machine { states, start: 0, tapes }
+}
+
+#[test]
+fn one_tape_guests_agree() {
+    let increment = Machine {
+        tapes: 1,
+        start: 0,
+        states: vec![
+            State {
+                name: "scan".into(),
+                accept: false,
+                rules: vec![
+                    Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::R], next: 0 },
+                    Rule { read: vec![None], write: vec![Some('1')], moves: vec![Move::S], next: 1 },
+                ],
+            },
+            State { name: "halt".into(), accept: true, rules: vec![] },
+        ],
+    };
+    assert_utm_agrees("the incrementer", &increment, &[vec!['1', '1']], DEFAULT_CAPS);
+
+    let left = chain(1, &[(vec![Some('a')], vec![Move::L]), (vec![Some('b')], vec![Move::L])]);
+    let tapes = assert_utm_agrees("two cells left", &left, &[vec!['x']], DEFAULT_CAPS);
+    assert_eq!(tapes[0].origin, 2, "the fixture must reach cell -2");
+
+    let stuck = Machine {
+        tapes: 1,
+        start: 0,
+        states: vec![State {
+            name: "skip-a".into(),
+            accept: false,
+            rules: vec![Rule { read: vec![Some('a')], write: vec![None], moves: vec![Move::R], next: 0 }],
+        }],
+    };
+    let tapes = assert_utm_agrees("stuck on b", &stuck, &[vec!['a', 'a', 'b']], DEFAULT_CAPS);
+    assert_eq!(tapes[0].head, 2, "stuck on the `b`");
+}
+
+#[test]
+fn two_tape_guests_agree() {
+    let copy = Machine {
+        tapes: 2,
+        start: 0,
+        states: vec![
+            State {
+                name: "copy".into(),
+                accept: false,
+                rules: vec![
+                    Rule {
+                        read: vec![Some('1'), None],
+                        write: vec![None, Some('1')],
+                        moves: vec![Move::R, Move::R],
+                        next: 0,
+                    },
+                    Rule { read: vec![None, None], write: vec![None, None], moves: vec![Move::S, Move::L], next: 1 },
+                ],
+            },
+            State {
+                name: "mark".into(),
+                accept: false,
+                rules: vec![Rule {
+                    read: vec![None, None],
+                    write: vec![Some('x'), Some('y')],
+                    moves: vec![Move::L, Move::L],
+                    next: 2,
+                }],
+            },
+            State { name: "done".into(), accept: true, rules: vec![] },
+        ],
+    };
+    assert_utm_agrees("copy a unary number across", &copy, &[vec!['1', '1', '1']], DEFAULT_CAPS);
+    let apart = chain(
+        2,
+        &[(vec![Some('a'), Some('b')], vec![Move::L, Move::R]), (vec![None, Some('c')], vec![Move::L, Move::L])],
+    );
+    let tapes = assert_utm_agrees("two tapes moving apart", &apart, &[], DEFAULT_CAPS);
+    assert_eq!(tapes[0].origin, 2, "tape 0 must reach cell -2");
+}
+
+#[test]
+fn three_tape_guests_agree() {
+    let m = chain(
+        3,
+        &[
+            (vec![Some('a'), Some('b'), Some('c')], vec![Move::R, Move::S, Move::L]),
+            (vec![None, None, None], vec![Move::L, Move::R, Move::S]),
+            (vec![None, None, Some('d')], vec![Move::S, Move::L, Move::L]),
+        ],
+    );
+    let tapes = assert_utm_agrees("three tapes", &m, &[vec!['p'], vec![], vec!['q', 'r']], DEFAULT_CAPS);
+    assert_eq!(tapes[2].origin, 2, "tape 2 must reach cell -2");
+}
+
+proptest! {
+    // A failing case runs again at every shrink step, and a UTM that never halts takes each run to its cap, so
+    // shrinking is also bounded at ten seconds: proptest's own bound is 1,024 runs, four times the 256 cases.
+    #![proptest_config(ProptestConfig { max_shrink_time: 10_000, ..ProptestConfig::default() })]
+    #[test]
+    fn random_acyclic_machines_agree_with_the_universal_machine((m, inits) in acyclic_machine()) {
+        assert_utm_agrees("a random acyclic machine", &m, &inits, DEFAULT_CAPS);
+    }
+}
+
+/// **A GREEN PROPTEST SAYS NOTHING ABOUT WHAT IT GENERATED**, so the generator's reach is held on a fixed
+/// seed: every tape count appears, and the left half is reached. Each floor is a tenth of the cases, well under
+/// what the generator measured when this was written; the printed line gives the live counts.
+#[test]
+fn the_acyclic_generator_reaches_every_tape_count_and_the_left_half() {
+    use proptest::strategy::ValueTree;
+    use proptest::test_runner::TestRunner;
+    let mut runner = TestRunner::deterministic();
+    let strategy = acyclic_machine();
+    let total = 256usize;
+    let (mut by_tapes, mut crossed) = ([0usize; 4], 0usize);
+    for _ in 0..total {
+        let (m, inits) = strategy.new_tree(&mut runner).unwrap().current();
+        by_tapes[m.tapes] += 1;
+        let (snaps, _s, _status, _n) = run_with_origins(&m, &inits, DEFAULT_CAPS);
+        crossed += usize::from(snaps.iter().any(|s| s.origin > 0));
+    }
+    println!("of {total} generated machines: {:?} with 1, 2 and 3 tapes; {crossed} reach cell -1", &by_tapes[1..]);
+    for (tapes, count) in by_tapes.iter().enumerate().skip(1) {
+        assert!(count * 10 >= total, "only {count} of {total} generated machines have {tapes} tapes");
+    }
+    assert!(crossed * 10 >= total, "only {crossed} of {total} generated machines reach cell -1");
+}
````
<!-- END task3.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0` with no diff printed; `clippy exit 0` with no warning.

- [ ] **Step 4: Run this task's tests**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core --test universal_oracle --no-capture
```

Expected summary line: `5 tests run: 5 passed, 0 skipped`, and the generator line `of 256 generated machines: [84, 89, 83] with 1, 2 and 3 tapes; 128 reach cell -1`.

This task also edits `one_way_oracle.rs`, so run its fast tier too:

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core --test one_way_oracle --no-capture
```

Expected summary line: `8 tests run: 8 passed, 2 skipped`, and the generator line `of 256 generated machines: 128 reach cell -1, 41 reach cell -2 or beyond`.

- [ ] **Step 5: Run the two text gates**

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 481 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `461 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Run hand-built and generated guests through the universal machine

universal_oracle.rs runs a guest directly and through the UTM, and
requires the same accept or stuck halt and then every guest tape equal
at its origin. Guests of one, two and three tapes, and a proptest over
generated machines of one to three tapes, show the UTM reads the tape
count from its input; a fixed-seed check holds the generator's reach.

run_with_origins and acyclic_machine move from one_way_oracle.rs into
tests/common, so both legs call one definition.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

---

### Task 4: The compiled corpus, the slow tier, and the finished-code checks

**Files:**
- Modify: `crates/redextape-core/tests/universal_oracle.rs`

**What it builds.**
- **Caps per tier.**
  - `UTM_CAPS`, the slow tier's, is 10^10 steps with the default cells cap. The largest slow-tier row takes 7,315,621,686 steps.
  - The fast tier keeps `DEFAULT_CAPS`. Its 5,000,000 steps are twice the 2,432,575 that its largest compiled row takes, so a UTM that never halts fails there on a cap.
- **`assert_program_agrees(src, enc, width, caps)`** lowers `src` with `run_tm_described`, or with `run_tm_described_at` when a width is given, and runs the leg under `caps`. For a run that produced a value, it decodes the value from the UTM's tapes and requires `interp::eval`'s.
- **Fast tier:**
  - `3 - 5` under unary and binary, and `if 2 > 1 { 10 } else { 20 }` under binary.
  - `2 + 3` under unary pinned at width 4, an overflow that must halt `Stuck`.
- **Slow tier, `#[ignore]`:**
  - `if 2 > 1 { 10 } else { 20 }` under unary, and `cons(1, cons(2, nil))` and `1 + 2 * 3` under both encodings.
  - `sum(5)` under both encodings, in its own test.

- [ ] **Step 1: Confirm Task 3 is committed and nothing is pending**

```bash
git -C "$P" log --oneline -1 -- crates/redextape-core/tests/universal_oracle.rs && git -C "$P" diff --quiet HEAD -- crates/ && echo clean
```

Expected: Task 3's commit, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task4.patch | git -C "$P" apply --index --check && block_of task4.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/tests/universal_oracle.rs | 79 +++++++++++++++++++++++--
 1 file changed, 74 insertions(+), 5 deletions(-)
```

<!-- BEGIN task4.patch -->
````diff
diff --git a/crates/redextape-core/tests/universal_oracle.rs b/crates/redextape-core/tests/universal_oracle.rs
index a36b6fd..e0d08fc 100644
--- a/crates/redextape-core/tests/universal_oracle.rs
+++ b/crates/redextape-core/tests/universal_oracle.rs
@@ -1,20 +1,33 @@
 //! The universal-machine leg: a machine run directly and the same machine run as a guest of
 //! `universal.rs`'s `universal_machine` must end in the same place — the same accept or stuck halt, then every
-//! guest tape equal at its origin.
+//! guest tape equal at its origin, then, for a compiled program, the reference interpreter's value decoded
+//! from the tapes the UTM left.
 //!
-//! **ONE MACHINE, EVERY TAPE COUNT**: hand-built guests of one, two and three tapes, and a proptest over small
-//! generated machines, are what show the UTM reads the tape count from its input.
+//! **THE CORPUS NEVER VARIES THE TAPE COUNT**: every lowered machine has five tapes. Hand-built guests of one,
+//! two and three tapes, and a proptest over small generated machines, are what show the UTM reads the tape
+//! count from its input.
+//!
+//! **TIERS FOLLOW THE DEV PROFILE**, which runs the UTM over 20 times slower than a release build. The fast tier
+//! holds the compiled programs under about a second there, under the default caps; the rest are `#[ignore]`d,
+//! run under `UTM_CAPS`, and `scripts/check-slow.sh` runs them in `--release`.
 
 #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
 
 use proptest::prelude::*;
 use redextape_core::tm::machine::{Machine, Move, Rule, State, StateId, Symbol};
 use redextape_core::tm::one_way::OriginSnapshot;
-use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, simulate_final};
+use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, Tape, simulate_final};
 use redextape_core::tm::universal::{GuestStatus, decode_guest, encode_guest, universal_machine};
+use redextape_core::tm::{EncodingKind, TM_DEFAULT_CAPS, TmRun, decode_tape_ty, run_tm_described, run_tm_described_at};
 
 mod common;
-use common::{acyclic_machine, run_with_origins};
+use common::{acyclic_machine, core_and_ty, run_with_origins};
+
+/// The slow tier's caps: enough steps for its largest row, `sum(5)` under unary, which the UTM runs in
+/// 7,315,621,686; the cells cap stays the default's, far above the 204,401 cells the largest row uses. The fast
+/// tier keeps `DEFAULT_CAPS`, whose 5,000,000 steps are twice the 2,432,575 its largest compiled row takes, so a
+/// UTM that never halts fails there on a cap instead of running toward these.
+const UTM_CAPS: Caps = Caps { steps: 10_000_000_000, cells: DEFAULT_CAPS.cells };
 
 /// The leg over any guest, returning the guest tapes the UTM left. The UTM runs under `caps`, so a UTM that never
 /// halts fails on a cap rather than running on. **The halt is asserted before the tapes**, so a UTM that stops
@@ -46,6 +59,62 @@ fn assert_utm_agrees(label: &str, m: &Machine, inits: &[Vec<Symbol>], caps: Caps
     run.tapes
 }
 
+/// The leg over a compiled program, with the UTM under `caps`: the machine `run_tm_described` builds for `src`
+/// under `enc` — at `width` when one is given — then, for a program that produced a value, that value decoded
+/// from the UTM's tapes against the reference interpreter's.
+fn assert_program_agrees(src: &str, enc: EncodingKind, width: Option<usize>, caps: Caps) {
+    let (core, ty) = core_and_ty(src);
+    let d = match width {
+        Some(w) => run_tm_described_at(&core, enc, ty, TM_DEFAULT_CAPS, w),
+        None => run_tm_described(&core, enc, ty, TM_DEFAULT_CAPS),
+    }
+    .unwrap_or_else(|r| panic!("{src} did not lower: {r:?}"));
+    let label = format!("{src} ({enc:?})");
+    let tapes = assert_utm_agrees(&label, &d.machine, &d.header.init(d.machine.tapes), caps);
+    if matches!(d.run, TmRun::Ran { .. }) {
+        let rebuilt: Vec<Tape> = tapes.iter().map(|s| Tape::new(&s.cells)).collect();
+        // `interp::eval` is this project's reference interpreter for the mini-language `Core` built above
+        // from a fixed test corpus, not a dynamic or untrusted code-execution primitive.
+        let want = redextape_core::interp::eval(&core).unwrap_or_else(|e| panic!("reference failed for {src}: {e:?}"));
+        assert_eq!(decode_tape_ty(&rebuilt, &d.header.result, &*d.header.encoding()), Some(want), "value for {label}");
+    }
+}
+
+#[test]
+fn the_universal_leg_agrees_on_small_programs() {
+    assert_program_agrees("3 - 5", EncodingKind::Unary, None, DEFAULT_CAPS);
+    assert_program_agrees("3 - 5", EncodingKind::Binary, None, DEFAULT_CAPS);
+    assert_program_agrees("if 2 > 1 { 10 } else { 20 }", EncodingKind::Binary, None, DEFAULT_CAPS);
+}
+
+/// A lowered machine that overflows its field width halts in its rule-less `overflow` state, which is not an
+/// accept, so the UTM must report the guest stuck. Pinned at width 4, where `2 + 3` cannot fit under unary.
+#[test]
+fn a_program_that_overflows_its_field_width_halts_stuck() {
+    let (core, ty) = core_and_ty("2 + 3");
+    let d = run_tm_described_at(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS, 4).expect("lowers");
+    assert!(matches!(d.run, TmRun::Overflow), "the fixture must overflow: {:?}", d.run);
+    assert_program_agrees("2 + 3", EncodingKind::Unary, Some(4), DEFAULT_CAPS);
+}
+
+#[test]
+#[ignore = "slow tier: 2 to 7 seconds each in the dev profile; run via scripts/check-slow.sh"]
+fn the_universal_leg_agrees_on_the_rest_of_the_small_programs() {
+    assert_program_agrees("if 2 > 1 { 10 } else { 20 }", EncodingKind::Unary, None, UTM_CAPS);
+    for enc in [EncodingKind::Unary, EncodingKind::Binary] {
+        assert_program_agrees("cons(1, cons(2, nil))", enc, None, UTM_CAPS);
+        assert_program_agrees("1 + 2 * 3", enc, None, UTM_CAPS);
+    }
+}
+
+#[test]
+#[ignore = "slow tier: 7.3 billion UTM steps under unary; run via scripts/check-slow.sh"]
+fn the_universal_leg_agrees_on_sum_five() {
+    for enc in [EncodingKind::Unary, EncodingKind::Binary] {
+        assert_program_agrees("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)", enc, None, UTM_CAPS);
+    }
+}
+
 /// A machine of states `s0`, `s1`, … taking one rule each — read anything, then the given writes and moves —
 /// and then accepting.
 fn chain(tapes: usize, steps: &[(Vec<Option<Symbol>>, Vec<Move>)]) -> Machine {
````
<!-- END task4.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0` with no diff printed; `clippy exit 0` with no warning.

- [ ] **Step 4: Run the fast tier**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core --test universal_oracle --no-capture
```

Expected summary line: `7 tests run: 7 passed, 2 skipped`. Besides one row per generated guest, it prints these cost rows:

```text
2 + 3 (Unary)                                                    guest    153 steps, UTM        985361 steps (   6440.3 per guest step), table   4875 cells, peak   5191 cells
the incrementer                                                  guest      3 steps, UTM           429 steps (    143.0 per guest step), table     75 cells, peak     97 cells
two cells left                                                   guest      2 steps, UTM           356 steps (    178.0 per guest step), table    126 cells, peak    154 cells
stuck on b                                                       guest      2 steps, UTM           368 steps (    184.0 per guest step), table     82 cells, peak    109 cells
3 - 5 (Unary)                                                    guest    253 steps, UTM       1920262 steps (   7590.0 per guest step), table   5099 cells, peak   5607 cells
3 - 5 (Binary)                                                   guest    140 steps, UTM       1064104 steps (   7600.7 per guest step), table   6267 cells, peak   6567 cells
if 2 > 1 { 10 } else { 20 } (Binary)                             guest    215 steps, UTM       2432575 steps (  11314.3 per guest step), table  10529 cells, peak  10910 cells
three tapes                                                      guest      3 steps, UTM          1472 steps (    490.7 per guest step), table    265 cells, peak    351 cells
copy a unary number across                                       guest      5 steps, UTM          1551 steps (    310.2 per guest step), table    158 cells, peak    208 cells
two tapes moving apart                                           guest      2 steps, UTM           580 steps (    290.0 per guest step), table    137 cells, peak    187 cells
```

- [ ] **Step 5: Run the two text gates**

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 481 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `461 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Run the compiled corpus through the universal machine

The leg now takes compiled programs: the lowered machine runs directly
and through the UTM, and the value decoded from the UTM's tapes must be
the reference interpreter's. Three rows under a second in the dev
profile join the fast tier, with an overflow that must halt stuck, and
keep the default caps, so a UTM that never halts fails there on a cap.
The rest of the small corpus and sum(5) under both encodings, 7.3
billion UTM steps under unary, are slow tier, under caps of 10^10
steps.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

- [ ] **Step 7: Run the slow tier in release**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo test --release -p redextape-core --test universal_oracle -- --ignored --nocapture
```

Expected: `test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out`. Four runs while planning finished in 133.69, 171.57, 138.80 and 259.45 s, the last on `3a18b27`, and a fifth, on `21320d4`, in 132.86 s while other work shared the machine; the time depends on machine load. Steps and cells are exact, since the machines are deterministic. The cost rows:

```text
if 2 > 1 { 10 } else { 20 } (Unary)                              guest    638 steps, UTM       8855841 steps (  13880.6 per guest step), table   8780 cells, peak   9945 cells
cons(1, cons(2, nil)) (Unary)                                    guest    422 steps, UTM       7358907 steps (  17438.2 per guest step), table  14936 cells, peak  15414 cells
1 + 2 * 3 (Unary)                                                guest   1020 steps, UTM      20921278 steps (  20511.1 per guest step), table  15203 cells, peak  16001 cells
cons(1, cons(2, nil)) (Binary)                                   guest    495 steps, UTM      12791210 steps (  25840.8 per guest step), table  22593 cells, peak  23216 cells
1 + 2 * 3 (Binary)                                               guest    613 steps, UTM      23215225 steps (  37871.5 per guest step), table  34015 cells, peak  34478 cells
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Unary) guest  50542 steps, UTM    7315621686 steps ( 144743.4 per guest step), table 150364 cells, peak 153437 cells
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Binary) guest  18086 steps, UTM    3485288884 steps ( 192706.5 per guest step), table 199520 cells, peak 204401 cells
```

- [ ] **Step 8: Run the whole crate's normal tier**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core
```

Expected summary line: `1155 tests run: 1155 passed, 16 skipped`. Under load, nextest may add `(N slow)` after `passed`. At `78ebea6` it was `1131 tests run: 1131 passed, 14 skipped`. The difference is this plan's tests:
- **24 normal-tier:** 4 in Task 1, 13 in Task 2, 5 in Task 3, 2 in Task 4.
- **2 ignored**, from Task 4.

- [ ] **Step 9: Run the sabotages, restoring after each**

Each edit is an exact-text replacement that must match exactly once, applied by the helper below. Every run carries a nextest per-test timeout from the tool config below, which ends a test at 60 s. On `3a18b27` no test reached the timeout; the slowest oracle-file run was S5's, at 14.4 s. On `21320d4`, with other work sharing the machine, none reached it either, and S5's oracle-file run took 11.9 s. The config stays so that a sabotage the caps do not stop fails instead of hanging.

After every row, `both` restores the module and deletes `universal_oracle.proptest-regressions`. A failing proptest writes that file, and the next row must not replay this row's seeds. `both` then prints `restored` only if the worktree is clean. `leg` takes the nextest selection as separate arguments, because zsh, unlike bash, does not split an unquoted variable into words.

<!-- BEGIN sab.py -->
```python
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
n = text.count(old)
if n != 1:
    sys.exit(f"SABOTAGE NOT APPLIED: expected exactly 1 match, found {n}")
open(path, "w").write(text.replace(old, new))
```
<!-- END sab.py -->

<!-- BEGIN nextest-timeout.toml -->
```toml
[profile.default]
slow-timeout = { period = "30s", terminate-after = 2 }
```
<!-- END nextest-timeout.toml -->

<!-- BEGIN sabotage.sh -->
```bash
block_of sab.py >| "$S/sab.py"
block_of nextest-timeout.toml >| "$S/nextest-timeout.toml"
F="$P/crates/redextape-core/src/tm/universal.rs"
leg() { cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core "$@" --no-fail-fast --tool-config-file "timeout:$S/nextest-timeout.toml" 2>&1 | awk '/^ +(FAIL|TIMEOUT|SIGKILL|SIGSEGV|SIGABRT) \[|Summary|error\[/ {print} /panicked at/ {getline m; print "    panic: " m}'; }
both() { leg --lib tm::universal; leg --test universal_oracle; git -C "$P" checkout -- crates/redextape-core/src/tm/universal.rs; rm -f "$P/crates/redextape-core/tests/universal_oracle.proptest-regressions"; git -C "$P" diff --quiet -- crates/ && test -z "$(git -C "$P" status --porcelain -- crates/)" && echo restored; }

# S1: flip the low bit of the first encoded rule's next state id
python3 "$S/sab.py" "$F" '            table.extend(bits(usize::try_from(r.next).ok()?, id_width));' $'            let first = table.iter().filter(|c| **c == RULE_ENTRY).count() == 1;\n            table.extend(bits(usize::try_from(r.next).ok()? ^ usize::from(first), id_width));' && both

# S2: encode in reverse order the rules of the first state that has two rules able to match one key
python3 "$S/sab.py" "$F" '        for r in &state.rules {' $'        let overlap = |s: &crate::tm::machine::State| s.rules.iter().enumerate().any(|(i, a)| s.rules[i + 1..].iter().any(|b| a.read.iter().zip(&b.read).all(|(x, y)| x.is_none() || y.is_none() || x == y)));\n        let rules: Vec<_> = if m.states.iter().position(|s| !s.accept && overlap(s)) == Some(sid) {\n            state.rules.iter().rev().collect()\n        } else {\n            state.rules.iter().collect()\n        };\n        for r in rules {' && both

# S3: treat the wildcard as a literal symbol, by deleting the rule that lets `?` match any slot
python3 "$S/sab.py" "$F" $'    b.add_rule(field, on(&[(TABLE, Some(ANY), None, Move::R), (KEY, Some(FIELD_END), None, Move::R)]), field_any);\n' '' && both

# S4: halt in guest-accepted when no rule matches
python3 "$S/sab.py" "$F" '(mark_stuck, STUCK, stuck)' '(mark_stuck, ACCEPTED, accepted)' && both

# S5: lay out one slot fewer than the guest's tape count on KEY and ACTION
python3 "$S/sab.py" "$F" '.chain((0..m.tapes).flat_map(move |_|' '.chain((1..m.tapes).flat_map(move |_|' && both
```
<!-- END sabotage.sh -->

Expected, as measured on `3a18b27`, and matched on `21320d4` in every summary and failing test name. The times in the table depend on machine load: match each row's summaries and test names, not its times. The clean summaries are `17 tests run: 17 passed, 830 skipped` for the unit tests and `7 tests run: 7 passed, 2 skipped` for the oracle file.

In every row, `the_acyclic_generator_reaches_every_tape_count_and_the_left_half` passes, since it never runs the UTM.

| row | spec's expected red | `--lib tm::universal` | `--test universal_oracle` | expected red seen |
| --- | --- | --- | --- | --- |
| S1 | a tape comparison, or halting | `17 tests run: 15 passed, 2 failed, 830 skipped`: `encode_guest_lays_out_the_five_tapes`, `the_universal_machine_runs_the_incrementer` | `7 tests run: 1 passed, 6 failed, 2 skipped`, in 11.9 s. Tape comparison: the incrementer, and the copy across two tapes. The UTM hit a cap: three tapes, `3 - 5` under unary, and the `2 + 3` overflow, each in 2.7 to 2.8 s. The proptest. | yes |
| S2 | a tape comparison, for the program where order matters | `17 tests run: 15 passed, 2 failed, 830 skipped`: `encode_guest_lays_out_the_five_tapes`, `the_universal_machine_runs_the_incrementer` | `7 tests run: 3 passed, 4 failed, 2 skipped`. Tape comparison: the incrementer, and the copy across two tapes. Halted differently: the `2 + 3` overflow. The proptest. **`the_universal_leg_agrees_on_small_programs` stays green.** | yes, from the hand-built guests and the overflow; see *Findings* 3 |
| S3 | halting (`guest-stuck`) | `17 tests run: 14 passed, 3 failed, 830 skipped`: `match_passes_a_mismatched_rule_to_a_wildcard`, `the_universal_machine_runs_the_incrementer`, `the_universal_machine_is_55_states_and_178_rules` | `7 tests run: 1 passed, 6 failed, 2 skipped`. Halted differently: the incrementer, the copy, three tapes, and `3 - 5` under unary. Tape comparison: the `2 + 3` overflow. The proptest. | yes |
| S4 | the halting test | `17 tests run: 16 passed, 1 failed, 830 skipped`: `match_halts_stuck_when_no_rule_matches` | `7 tests run: 4 passed, 3 failed, 2 skipped`. Halted differently: stuck on `b`, the `2 + 3` overflow, and the proptest. | yes |
| S5 | the 1–3 tape guests | `17 tests run: 15 passed, 2 failed, 830 skipped`: `encode_guest_lays_out_the_five_tapes`, and `the_universal_machine_runs_the_incrementer` in 2.7 s | `7 tests run: 1 passed, 6 failed, 2 skipped`, in 14.4 s. The UTM hit a cap: the incrementer, the copy, three tapes, `3 - 5` under unary, the `2 + 3` overflow, and the proptest. | yes |

---

## Measured cost

Release build, `simulate_final`, one run each. The dev-profile times come from a debug build of the same probe, and the estimate is the spec's.

| row | guest steps | UTM steps | per guest step | table cells | peak cells | release | dev | spec estimate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `3 - 5`, unary | 253 | 1,920,262 | 7,590.0 | 5,099 | 5,607 | 0.024 s | 0.597 s | 1.71×10^6 |
| `3 - 5`, binary | 140 | 1,064,104 | 7,600.7 | 6,267 | 6,567 | 0.017 s | 0.352 s | — |
| `if 2 > 1 { 10 } else { 20 }`, unary | 638 | 8,855,841 | 13,880.6 | 8,780 | 9,945 | 0.104 s | 2.978 s | 7.41×10^6 |
| `if 2 > 1 { 10 } else { 20 }`, binary | 215 | 2,432,575 | 11,314.3 | 10,529 | 10,910 | 0.034 s | 0.745 s | — |
| `cons(1, cons(2, nil))`, unary | 422 | 7,358,907 | 17,438.2 | 14,936 | 15,414 | 0.086 s | 2.181 s | 9.54×10^6 |
| `cons(1, cons(2, nil))`, binary | 495 | 12,791,210 | 25,840.8 | 22,593 | 23,216 | 0.171 s | 4.570 s | — |
| `1 + 2 * 3`, unary | 1,020 | 20,921,278 | 20,511.1 | 15,203 | 16,001 | 0.266 s | 6.348 s | 2.03×10^7 |
| `1 + 2 * 3`, binary | 613 | 23,215,225 | 37,871.5 | 34,015 | 34,478 | 0.262 s | 6.709 s | — |
| `sum(5)`, unary | 50,542 | 7,315,621,686 | 144,743.4 | 150,364 | 153,437 | 83.502 s | — | 9.72×10^9 |
| `sum(5)`, binary | 18,086 | 3,485,288,884 | 192,706.5 | 199,520 | 204,401 | 40.645 s | — | — |
| `2 + 3` at width 4, unary, overflow | 153 | 985,361 | 6,440.3 | 4,875 | 5,191 | — | 0.316 s | — |

- **Against the estimate:** measured over estimated is 1.12 for `3 - 5`, 1.19 for `if`, 0.77 for `cons`, 1.03 for `1 + 2 * 3` and 0.75 for `sum(5)`. No row is near the 10× the spec's stop condition names.
- **Cells:** the largest peak is 204,401 cells, against `TM_DEFAULT_CAPS.cells` of 5,000,000.
- **Other runs:**
  - The incrementer on `11` takes 429 UTM steps for 3 guest steps, as Task 4 Step 4's rows show.
  - The proptest draws new guests on every run, so its largest guest varies. Across the three measured runs of 256 guests, the largest took 4,900, 5,225 and 5,491 UTM steps.
  - `50 + 50` under unary overflows at its fitted width. It takes 52,470,882 UTM steps for 1,864 guest steps, 17.9 s in the dev profile, and halts `Stuck` with every tape equal. That is why the overflow fixture is pinned at width 4.

## Decisions and spec corrections found while planning

The spec is unchanged; these record what building the code decided, and why.

1. **Five tapes, not three.**
   - **What the spec said:** a table, a key holding the current state id and the codes under the heads, and the guest.
   - **What was built:** the state id moved to its own STATE tape, beside a status cell, and a fifth tape, ACTION, holds the matched rule's writes and moves one slot per guest tape.
   - **Why:** with those apart, every comparison and copy is a lockstep walk of two tapes, and the sweeps apply a rule by walking GUEST beside ACTION, with no marking and no counting.
2. **No preamble of widths or tape count.** The spec put the guest's tape count, state-id width and code width in a preamble for the UTM to read. The UTM never needs them: every field is delimited. What follows the table's end is the guest alphabet, 21 bits per character, which only `decode_guest` reads, so a run can be decoded from the tapes alone.
3. **The wildcard and "no write" are one cell, `?`, not reserved codes.**
   - **Consequence:** codes need only as many bits as the symbols, and no symbol-code width limit exists.
   - **The one limit is `MAX_GUEST_TAPES`**, equal to `MAX_TAPES`, the most a parsed `.tm` file may declare. It bounds what `encode_guest` allocates, not what the UTM can run.
   - **The spec's second limit constant,** the largest code width, has nothing to bound, and there is none.
4. **`decode_guest` returns a three-valued `GuestStatus`, not `accepted: bool`.** Freshly encoded tapes and a run stopped by a cap are neither accepted nor stuck. They decode as `Running`, which is what lets Task 1 test the round trip before any machine exists.
5. **The halt is on the tapes.** Before halting, the UTM writes `Y` or `N` into STATE's status cell, so `decode_guest` needs no final state. The halting states keep the spec's names, `guest-accepted` (an accept state) and `guest-stuck`.
6. **A guest step is two sweeps, not three.**
   - The rightward sweep applies `S` and `R` heads.
   - The leftward sweep applies `L` heads and also reads every head's final code into KEY, stepping back over a slot's bits at its flag.
   - Blocks are appended or prepended only when a move is still pending at an end, which keeps GUEST as long as the furthest cell any tape reached.
7. **Tiers follow the dev profile.**
   - **The spec's plan:** `3 - 5`, `if`, `cons` and `1 + 2 * 3` under unary in the fast tier, on an estimate taken at release speed.
   - **What was measured:** nextest's fast tier runs the dev profile, 21 to 29 times slower than release on the eight rows timed both ways. There the unary `if`, `cons` and `1 + 2 * 3` take 2.2 to 6.3 s, and `cons` and `1 + 2 * 3` under binary 4.6 and 6.7 s.
   - **The result:** the fast tier holds the rows under a second there — `3 - 5` under both encodings, `if` under binary, and the overflow. The other small rows and `sum(5)` are `#[ignore]`d, and `scripts/check-slow.sh` runs them in `--release`.
8. **The overflow fixture is `2 + 3` pinned at width 4.** `50 + 50` at its fitted width also halts `Stuck` correctly, but takes 17.9 s in the dev profile.
9. **The fast tier runs the UTM under `DEFAULT_CAPS`; only the slow tier runs it under `UTM_CAPS`.**
   - **Why:** the repository has no nextest config that ends a test. A fast-tier test whose UTM never halts runs until its step cap stops it.
   - **The choice:** `assert_utm_agrees` takes the UTM's caps. Every fast-tier caller passes `DEFAULT_CAPS`, 5,000,000 steps, twice the 2,432,575 of the largest compiled fast-tier row. The slow tier passes `UTM_CAPS`.
   - **Shrinking is bounded too.** The proptest sets `max_shrink_time` to 10 s. Proptest 1.11.0's own bound is 1,024 runs, four times its 256 cases, and under a sabotage that stops the UTM halting each run lasts until the cap.
   - **What it changed** is under *Findings*.
10. **Four tasks, not five.**
    - The UTM's phases cannot land before `universal_machine`, since clippy rejects private functions nothing calls.
    - The hand-built guests and the proptest share `assert_utm_agrees`, so they landed together.
11. **Each phase is unit-tested alone from positioned heads.** `Tape::new` always starts a head on cell 0, so `run_phase` builds a prelude that moves heads into a phase's starting position before the phase runs.
12. **The cost row is printed without the estimate beside it.** The *Measured cost* table above does that comparison instead.
13. **S5 is adapted.**
    - **What the spec said:** "read the tape count as one less".
    - **What was run:** the UTM never reads a count, so the sabotage lays out one slot fewer than the guest has tapes on KEY and ACTION, and the slots and tracks then disagree.
14. **S2 is aimed at a state where rule order can matter.**
    - **What the spec said:** reverse the rules of "one unary state", with the red expected "for the program where order matters".
    - **The condition:** reversal changes a guest's run only in a state with two rules that can both match one key, where on every tape one rule reads anything or both read the same symbol.
    - **What was run:** the row reverses the first such state.
    - **The first form** reversed the first state with rules, when that state had more than one. It is under *Findings*.
15. **`run_with_origins` and the acyclic generator move into `tests/common/mod.rs`,** by decision before the build started, instead of being copied from `one_way_oracle.rs`.
    - **What was first built:** copies in `universal_oracle.rs`, on scratch commits `f65e049` and `3a18b27`, citing `one_way_oracle.rs` as the original.
    - **What changed:** both functions are `pub` in `tests/common/mod.rs`, whose module doc no longer names three copies as the point where a shared module pays. `one_way_oracle.rs` and `universal_oracle.rs` import them, and `one_way_oracle.rs`'s fast tier stays `8 tests run: 8 passed, 2 skipped`, and its two ignored tests pass in release.
    - **The counts that moved:** the attributions gate checks 481 sites at Tasks 3 and 4, not 483, because the two citations of the copies' original are gone. Task 3's stat grows to three files, and Task 4's patch imports the helpers beside `core_and_ty`.

## Findings

1. **The first form of S2 reversed nothing in any compiled guest.**
   - **The form:** it reversed the first state with rules, when that state had more than one.
   - **What `utm_s2_probe.rs` shows:** in every lowered machine, that state is state 2, with one rule. This holds for `3 - 5`, `if 2 > 1 { 10 } else { 20 }`, `cons(1, cons(2, nil))`, `1 + 2 * 3` and `sum(5)` under both encodings, and for the overflow fixture.
   - **What the run showed:** on `5176354`, that form left both compiled fast-tier tests green, and only the hand-built guests and the proptest went red. The spec's expected red, "a tape comparison, for the program where order matters", still appeared, but not from any program.
2. **No binary guest in the corpus can show rule order.**
   - **Binary:** no state of any binary lowered machine has two rules that can both match one key. For those guests the first matching rule is the only one, so a UTM that ignored table order would run every binary row the same.
   - **Unary:** such states number 1 in `3 - 5`, 1 in `if`, 2 in `cons`, 5 in `1 + 2 * 3`, 22 in `sum(5)`, and 2 in the overflow fixture.
3. **Aimed, S2 goes red on one compiled fast-tier row, the overflow.**
   - **`3 - 5` under unary:** S2 reverses its state 55, `sub4.d.wr`, with three rules, and `the_universal_leg_agrees_on_small_programs` stays green. Reversing those rules leaves that run's halt, tapes and value unchanged.
   - **The `2 + 3` overflow:** S2 reverses its state 36, `add4.a.w.wkh`, and the test goes red: the UTM halted differently.
   - **The consequence:** among compiled fast-tier rows, only the overflow shows that the UTM keeps first-match order. The incrementer, the two-tape copy and the proptest show it for hand-built and generated guests.
4. **The caps and the shrink bound are what keep a UTM that never halts from hanging the fast tier.** Across the three carves, with the sabotage timeout ending any test at 60 s:
   - **`5176354`, the fast tier under `UTM_CAPS`:** S1 left four oracle tests running until the timeout — the proptest, three tapes, the small programs and the overflow — and S5 left the proptest.
   - **`c28cc1e`, the fast tier under `DEFAULT_CAPS`:** S1's three-tape, small-program and overflow tests failed on the cap in 2.8 to 2.9 s. The proptest still ran until the timeout under both S1 and S5. Each shrink step runs the test again, and under those sabotages each run lasts until the cap.
   - **`3a18b27`, with shrinking bounded at 10 s:** no test reached the timeout. The oracle file took 11.9 s under S1 and 14.4 s under S5.
   - **Without a timeout:** a run under `UTM_CAPS` lasts until 10^10 steps. At the 2.8 to 3.5 million steps a second the dev-profile rows ran at, that is 48 to 60 minutes, unless the cells cap stops it first.
5. **Every expected red was seen,** and no sabotage left the fast tier green. S3 also turns the size pin red, since it deletes one of the machine's rules.

## Left for the controller

- **The roadmap entry,** with the *Measured cost* table.
- **The scratch worktree** `.claude/worktrees/universal-tm-scratch`, branch `universal-tm-scratch`, holds the four commits this plan embeds. It can be deleted without losing anything this plan does not embed. Its reflog also holds four superseded carves:
  - `cc286af`, `f7a578e` and `f9ace09`, whose Task 2 lacked the size pin;
  - `b96d9d5` and `5176354`, whose oracle ran the fast tier under `UTM_CAPS`;
  - `3eb974f` and `c28cc1e`, whose proptest shrinking was unbounded;
  - `f65e049` and `3a18b27`, whose oracle copied `run_with_origins` and the acyclic generator.
- **The untracked probes,** kept outside the worktree in `/tmp/claude-1000/-home-davey-projects-redextape/c6a1cf33-0c42-448c-a0ee-76239e25a1eb/scratchpad/utm-plan/`. `utm_plan_probe.rs` produced the release and dev timings; `utm_s2_probe.rs` produced the rule-order counts under *Findings*.
