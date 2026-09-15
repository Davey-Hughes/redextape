# Reduction State Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No machine-model reduction builds more than `MAX_MACHINE_STATES` states. An input that would go over returns a named `too-many-states` refusal that survives every later stage, and one public `refusal()` recognises all five refusals.

**Architecture:** A new `tm/reduction.rs` holds a `StateTable`: the name-to-id table the three stages each carried a private copy of, plus a ceiling. The module also holds the five refusal names, the one refusal constructor and `refusal()`. Each stage's `Names` wraps a `StateTable`, and each public `to_*` becomes a one-line call to a `pub(crate)` `to_*_within(.., ceiling)` that:
1. hands a refusal back unchanged;
2. checks the ceiling as it builds: after each original state or worklist item, once more at the end of stage 1, whose `finish` creates states, and once before the fold's worklist, which a trip in the fold's preamble would otherwise never reach;
3. also returns how many original states or worklist items it began after the table tripped. That count is the only way a test can see the check inside each loop.

**Tech Stack:** Rust (`redextape-core`), cargo-nextest, the repository's pre-commit gates.

**Spec:** `docs/superpowers/specs/2026-09-14-reduction-state-guard-design.md`, committed at `4179ff6`. The corrections this plan found are applied to that file and left uncommitted — see *Spec corrections found while planning*.

## Global Constraints

- `MAX_MACHINE_STATES` stays `1_000_000` (`crates/redextape-core/src/tm/build.rs`). Nothing in Core, asm, `encoding`, `Builder` or `lower_tm` changes.
- **Public signatures:** `to_single_tape(m: &Machine) -> Machine`, `to_two_symbol(m: &Machine, code: &Code) -> Machine` and `to_one_way(m: &Machine) -> Machine` keep theirs. One public signature does change: `single_tape::states_per_original` returns `Option<f64>`.
- **Crate-private signatures:** every `_within` returns `(Machine, usize)`.
- The refusal names are exactly `too-many-states`, `too-many-tapes`, `alphabet-collision`, `code-does-not-cover-alphabet` and `left-end-collision`.
- **Build location:** work in the `reduction-state-guard` worktree, and put `CARGO_TARGET_DIR="$P/target"` on every cargo command and on every `git commit`, because the pre-commit hook runs cargo. Never build into the main checkout's `target/`, and never into `/tmp`.
- **Memory cap:** every run that builds the largest shipped demo, and every sabotage run, goes under `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 --`. An OOM kill is a result to record, never a reason to raise the cap.
- **Hooks:** never `git commit --no-verify`. The hook runs `cargo fmt`, `cargo clippy -D warnings`, the `file:line` ban in tracked source, and the attributions gate. That gate requires a citation of the form "`file.rs`'s `symbol`" to name the TRACKED file that declares the symbol.
- **Staging:** stage files by name, never with `git add -A`. An untracked probe sits in `crates/redextape-core/examples/` from Task 0 until the last step of Task 4.
- No AI or Claude attribution anywhere: code, comments or commit messages.
- The roadmap entry is not part of this plan.

## How this plan's code was verified

Every task's end state was built in the scratch worktree `.claude/worktrees/state-guard-scratch`, on branch `state-guard-scratch-4`, started from `4179ff6`. Each was committed there through the unmodified pre-commit hooks before this plan was written, and nothing in this plan's verification used `--no-verify`.

| task | scratch commit |
| --- | --- |
| 1 | `2dc7791` Route stage 1's states through a capped StateTable |
| 2 | `3877da9` Route stage 2's states through the capped StateTable |
| 3 | `7e33433` Route the fold's states through the capped StateTable |
| 4 | `ae07061` Hold the state ceiling at its real value on the largest shipped demo |

`ae07061` is `3aaaab2` with one word of its commit message corrected, "boundary" to "ceiling". Both have tree `1a6ea7f`, so every figure below measured at `3aaaab2` was measured on this tree.

**Each task's code below is that commit's `git show --format=` output, embedded verbatim. Apply it; do not retype it.** Each block and commit message was compared byte for byte with its commit.

The four blocks were also applied in order, staged and never committed, to a detached `4179ff6` in a throwaway worktree. After each one, `git diff --cached --quiet <that task's commit>` succeeded.

**No step shows a red-first run of a new test**, because the code existed before the plan. Task 4 instead runs nine sabotages on the finished code, each removing one mechanism, and records which tests go red. That is what shows each new test can fail, and the findings follow the table.

Every embedded file sits between a `<!-- BEGIN name -->` line and an `<!-- END name -->` line. Set these once per shell before any task:

```bash
P=/home/davey/projects/redextape/.claude/worktrees/state-guard
PLAN="$P/docs/superpowers/plans/2026-09-14-reduction-state-guard.md"
S=/tmp/claude-1000/-home-davey-projects-redextape/c6a1cf33-0c42-448c-a0ee-76239e25a1eb/scratchpad/state-guard-exec
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
```

`$S` holds only small helper scripts and probe output; any directory outside the worktree works.

---

### Task 0: Record the regression digests before any code changes

**Why this exists.** No existing test pins a reduced machine's structure. `one_way.rs`'s and `two_symbol.rs`'s cost rows print state counts and assert only `ratio < STATE_CEILING`, and the oracles check behaviour.

This probe prints a sha256 of `print_tm` for every reduced machine the three oracle files build, piped through `sha256sum` because the crate has no hash dependency. Task 4 re-runs it to show that routing every state through `StateTable` builds byte-identical machines.

**Files:**
- Create, UNTRACKED and never committed: `crates/redextape-core/examples/state_guard_digest_probe.rs`

- [ ] **Step 1: Create the probe from the block below**

```bash
block_of state_guard_digest_probe.rs >| "$P/crates/redextape-core/examples/state_guard_digest_probe.rs"
```

<!-- BEGIN state_guard_digest_probe.rs -->
````rust
//! Scratch probe (untracked): a sha256 of `print_tm` for every reduced machine the three oracle files
//! build, so a refactor of the reductions can be shown to build byte-identical machines.
//!
//!     cargo run --release --example state_guard_digest_probe -p redextape-core

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

#[cfg(not(target_arch = "wasm32"))]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

use std::io::Write;
use std::process::{Command, Stdio};

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::one_way::{to_one_way, zigzag};
use redextape_core::tm::single_tape::{interleave, layout_collision, to_single_tape};
use redextape_core::tm::two_symbol::{Code, to_two_symbol};
use redextape_core::tm::{
    EncodingKind, MAX_MACHINE_STATES, Machine, Symbol, TM_DEFAULT_CAPS, TmRun, print_tm, run_tm_described,
};
use redextape_core::typeck::result_type;

/// The oracles' `PAD`.
const PAD: usize = 2;

/// Every program the three oracle files build, with the encodings they build it under.
const CASES: &[(&str, &[EncodingKind])] = &[
    ("3 - 5", &[EncodingKind::Unary]),
    ("if 2 > 1 { 10 } else { 20 }", &[EncodingKind::Unary]),
    ("cons(1, cons(2, nil))", &[EncodingKind::Unary, EncodingKind::Binary]),
    ("fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))", &[EncodingKind::Unary]),
    ("1 + 2 * 3", &[EncodingKind::Unary, EncodingKind::Binary]),
    ("let x = 40; x + 2", &[EncodingKind::Unary, EncodingKind::Binary]),
    ("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)", &[EncodingKind::Unary, EncodingKind::Binary]),
];

fn build_machine(src: &str, enc: EncodingKind) -> (Machine, Vec<Vec<Symbol>>) {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
    let prog = prog.expect("a program");
    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
    let d = run_tm_described(&desugar(&prog), enc, ty, TM_DEFAULT_CAPS).unwrap_or_else(|r| panic!("{src}: {r:?}"));
    assert!(matches!(d.run, TmRun::Ran { .. }), "{src} must complete");
    let init = d.header.init(d.machine.tapes);
    (d.machine, init)
}

fn sha256(text: &str) -> String {
    let mut child = Command::new("sha256sum").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().expect("sha256sum");
    child.stdin.take().expect("stdin").write_all(text.as_bytes()).expect("write");
    let out = child.wait_with_output().expect("sha256sum output");
    String::from_utf8(out.stdout).expect("utf8").split_whitespace().next().expect("a digest").to_string()
}

fn row(label: &str, stage: &str, m: &Machine) {
    let over = if m.states.len() >= MAX_MACHINE_STATES { " OVER-CEILING" } else { "" };
    println!("{label:90} {stage:6} states {:>9} sha256 {}{over}", m.states.len(), sha256(&print_tm(m)));
    std::io::stdout().flush().unwrap();
}

fn main() {
    for (src, encs) in CASES {
        for &enc in *encs {
            let label = format!("{src} ({enc:?})");
            let (m, inits) = build_machine(src, enc);
            row(&label, "lower", &m);

            assert_eq!(layout_collision(&m, &inits), None, "{label}");
            let s1 = to_single_tape(&m);
            row(&label, "s1", &s1);
            let cells = vec![interleave(&inits, m.tapes, PAD, PAD)];
            let s12 = to_two_symbol(&s1, &Code::new(&s1, &cells));
            row(&label, "s1+s2", &s12);
            drop((s1, s12));

            let s2 = to_two_symbol(&m, &Code::new(&m, &inits));
            row(&label, "s2", &s2);
            drop(s2);

            let f = to_one_way(&m);
            row(&label, "f", &f);
            let z = zigzag(&inits, m.tapes).expect("no marker in the data");
            let f2 = to_two_symbol(&f, &Code::new(&f, &z));
            row(&label, "f+s2", &f2);
            drop(f2);

            // All three stages only where `one_way_oracle.rs` builds them: `3 - 5` under unary.
            if *src == "3 - 5" && enc == EncodingKind::Unary {
                let f1 = to_single_tape(&f);
                let fcells = vec![interleave(&z, f.tapes, 0, 1)];
                let f12 = to_two_symbol(&f1, &Code::new(&f1, &fcells));
                row(&label, "f+s1", &f1);
                row(&label, "all3", &f12);
            }
        }
    }
}
````
<!-- END state_guard_digest_probe.rs -->

- [ ] **Step 2: Run it and compare with the expected digests**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo run --release --example state_guard_digest_probe -p redextape-core >| "$S/digests-before.txt"; echo "exit $?"
diff <(block_of digests) "$S/digests-before.txt" && echo "digests match the plan"
```

Expected: `exit 0`, then `digests match the plan`. The file is these 68 lines, and none carries `OVER-CEILING`:

<!-- BEGIN digests -->
```text
3 - 5 (Unary)                                                                              lower  states        60 sha256 66ba60131fbaf06a53ac503173c43ca0f11beacb9b31fed491f7d040370fad80
3 - 5 (Unary)                                                                              s1     states       904 sha256 0674c334e89488751a2f2a7d76ba72130276e71aeb0eda9e6253970970b63764
3 - 5 (Unary)                                                                              s1+s2  states     18433 sha256 6af00b53f3486565c52a471ba6398f490ed9e0af72da42ae66e9504737c58a2b
3 - 5 (Unary)                                                                              s2     states       729 sha256 a92b78acd3435dc0a5d13c7ef7eeb0ad9fdbd124d0a056d0013d118f77ba4112
3 - 5 (Unary)                                                                              f      states       614 sha256 76d1ec05c2700ce4f206a3a626de828bf4b1039d0dfafbcbba6281f342fcc547
3 - 5 (Unary)                                                                              f+s2   states      4712 sha256 91f7a09aa6c8af55a3643fd82f083e5ec1924a955dd238c6500f39b33e35c30a
3 - 5 (Unary)                                                                              f+s1   states      7042 sha256 7277a2aedfd9c5606d248a9b9a2389d24fc666c1ff9d98181bb8955433c7e893
3 - 5 (Unary)                                                                              all3   states    137532 sha256 7bc111561223520481b1be9afbc8f22e715b9cf6907c798bef9aa77f4590439b
if 2 > 1 { 10 } else { 20 } (Unary)                                                        lower  states        96 sha256 57adf2e7db21c567465d7381de99bb1a2ff921d3eebb9777f63a7abaa60b53c0
if 2 > 1 { 10 } else { 20 } (Unary)                                                        s1     states      1489 sha256 f7d372ed74e953299cf11793c5732e38f2650411a0d844ad4f82725f20f18f2a
if 2 > 1 { 10 } else { 20 } (Unary)                                                        s1+s2  states     30439 sha256 c0b9e3645b8bcd7aa59997e6bac67f4e5d95b58ba13d0955cd34841c770fa5f3
if 2 > 1 { 10 } else { 20 } (Unary)                                                        s2     states      1203 sha256 a77b99f6de24b5a5da17b96a9db7e8d855704b012fb2797c2deeae892e2d49d8
if 2 > 1 { 10 } else { 20 } (Unary)                                                        f      states      1098 sha256 8bebe8d17f97fd16d482338fed60789bd1e47c45929880d0c0a62d24293ffe7c
if 2 > 1 { 10 } else { 20 } (Unary)                                                        f+s2   states      8492 sha256 21fa1ba60d22e28712a06227e0f236e676e42deca9b2b3963003be40bd175849
cons(1, cons(2, nil)) (Unary)                                                              lower  states       146 sha256 8df125aac27c67949ccafb94c7e3a26db60f5fcf48ad7a96b0b95a695eafc1d1
cons(1, cons(2, nil)) (Unary)                                                              s1     states      2495 sha256 75eeeec5d818544bce28a5c6bd4f4c7624cfd93a4d4ab7a620598335b5f5ce8a
cons(1, cons(2, nil)) (Unary)                                                              s1+s2  states     51445 sha256 c8951e059d3e80ee2b228a119695b829d745f3d22381a28166fc445f5f5dccde
cons(1, cons(2, nil)) (Unary)                                                              s2     states      1981 sha256 906705eae3174c1a6292c0f48ec75dac8b05f0543f8acdc8e1ab17dc78460cc2
cons(1, cons(2, nil)) (Unary)                                                              f      states      2965 sha256 c1aa044b7123a6f5d5f38c8583579586e4838a23e0a8eac3a3d354f9e44ca096
cons(1, cons(2, nil)) (Unary)                                                              f+s2   states     33300 sha256 5aa14d3234c38df1a231cf8b4537e0b3f177c32d7d71eca01b7c49a79a237e9d
cons(1, cons(2, nil)) (Binary)                                                             lower  states       201 sha256 1c6253f90a74ff55b7d3da30593ce8a2f5acbe955e3852133130de2150654c69
cons(1, cons(2, nil)) (Binary)                                                             s1     states      4456 sha256 4e3ed6935d3e991ae0d48a790b30d68c962e64b9db72ad741396b51ddedffb6d
cons(1, cons(2, nil)) (Binary)                                                             s1+s2  states    116871 sha256 31c29a822f58504b86899590b9bc80b64ba7080b3d7c0fc9eb797ec516a5b502
cons(1, cons(2, nil)) (Binary)                                                             s2     states      5930 sha256 7c6c1ccf36350b8b35d53b1076bc5eba4a3763473f80001c71b32e9e9e10e28a
cons(1, cons(2, nil)) (Binary)                                                             f      states      6235 sha256 889fa804b968aa6da76625dcabb01dce3a2846e922bfaf5b2ac7cec97d192a35
cons(1, cons(2, nil)) (Binary)                                                             f+s2   states     73847 sha256 7346306f29f5e1b97c9113fdd953ea87a2011fc09e02d00aec554231aa7b6d10
fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2)) (Unary)              lower  states       636 sha256 53ecac2687eb56bf340d077effb866cbf996479025a5d66c7909003fb3b8cb34
fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2)) (Unary)              s1     states     11229 sha256 7ee4fe60d45f8a5000489cc639d15221c1fb448e846fc4a1ed94fea1dc43c094
fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2)) (Unary)              s1+s2  states    232335 sha256 821736af703d760c29c7c2cc0844c80758bf328c9e765603d58047c12fe72190
fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2)) (Unary)              s2     states      9017 sha256 531976a4674d76036e9adccbac0f86eff25928e3a6e4088d2117f2e6321b17e3
fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2)) (Unary)              f      states     16498 sha256 19457be494e7309b9b9014eff6dbfc524fc594c0e0bcc9903889ffd783f6b472
fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2)) (Unary)              f+s2   states    129270 sha256 35a3c0f88189454e2cd15dc01d1e631415ebe53e5e803445f85f423eb44a2884
1 + 2 * 3 (Unary)                                                                          lower  states       143 sha256 e1bc628fedb5676eb12c9ccced1ba4a673891a369798546be558866d7daa6ef5
1 + 2 * 3 (Unary)                                                                          s1     states      2504 sha256 657327966d87aa01c9d159489c52bca8ca28fcb52cea9a27f767afde6e795c0e
1 + 2 * 3 (Unary)                                                                          s1+s2  states     51783 sha256 e2efbeb76bf8e3062d0f07da60a49c196cdff497612cdcb34ff7a48cacea0fa2
1 + 2 * 3 (Unary)                                                                          s2     states      2011 sha256 f023b564980b3df45babec63490edd9330a53cbcbf126a1947d396fe00bae7d5
1 + 2 * 3 (Unary)                                                                          f      states      1893 sha256 d2f78ecaaf85bf2ff3c743d600b2e7a7a0842e5b2f90e55862c370802df5a914
1 + 2 * 3 (Unary)                                                                          f+s2   states     14942 sha256 19107fa449d12ed56d5d1d934e010f12675cb293d2a3d562bd21b443f0da64e9
1 + 2 * 3 (Binary)                                                                         lower  states       278 sha256 b6da3021d25ceedc29f469336c17e474b962b8388d5a99cf5c838bd6868a2309
1 + 2 * 3 (Binary)                                                                         s1     states      5957 sha256 b309d4d14580a19b10a2e474095dd7da5991060813bcd6f966a18c06fddf5e9e
1 + 2 * 3 (Binary)                                                                         s1+s2  states    124745 sha256 97ef0f7a6303408bc9682721b10e8f6d2b7448fe258dc172b2d5b184c2261a09
1 + 2 * 3 (Binary)                                                                         s2     states      4999 sha256 9394564176e285346b40b9bcc08365b4beedb9c0c944f9571e478063fa4bd950
1 + 2 * 3 (Binary)                                                                         f      states      5103 sha256 ceaffa3a61cd13b3bb1e07ce7c25c9f23fe71bef3a239c013f7044bdcf3ae08e
1 + 2 * 3 (Binary)                                                                         f+s2   states     62109 sha256 add7b9061dad648c0843d5912bef23dcb947b6a0e8c1122c7df999f9d731e460
let x = 40; x + 2 (Unary)                                                                  lower  states       123 sha256 29e34ab368f2e725f09f5d517bab6bce37a04dbc90b11fcc362923e35bffedf7
let x = 40; x + 2 (Unary)                                                                  s1     states      1780 sha256 76420447e66f3acfb241f061b741ea2db9e8f12851e75bbafa7ac43af3c8938b
let x = 40; x + 2 (Unary)                                                                  s1+s2  states     36083 sha256 7c6cc30f3e55b46baed4e388e4079b4cf271e6a0a92ef278b5ca3a22a52f2be9
let x = 40; x + 2 (Unary)                                                                  s2     states      1423 sha256 f0440f011c7231de87df824ade8f2bc19a147fff1c251f65127b4321d54abe43
let x = 40; x + 2 (Unary)                                                                  f      states      1359 sha256 3f4c4a5a9e621c10b936f89839aefab73d00ce9f504de52a96d703481ce66c2e
let x = 40; x + 2 (Unary)                                                                  f+s2   states     10456 sha256 a44c1d48b63701563160ed84dfc2aa0138dff462adacc039035ddb5fb97e78f0
let x = 40; x + 2 (Binary)                                                                 lower  states       112 sha256 13030ab7b02d449241a3d8d726412ea9879710b53d9b293ae778b2d08ade7b22
let x = 40; x + 2 (Binary)                                                                 s1     states      3321 sha256 be621c27ed493a1fbb255ec22f1114b58a50b90f93987c78bf5cf3e73832e416
let x = 40; x + 2 (Binary)                                                                 s1+s2  states     70341 sha256 195cd0705df09db8ec5c3e7c8b6dc7dda2c86961662f020cebfaec8029b1ec06
let x = 40; x + 2 (Binary)                                                                 s2     states      2823 sha256 8d0d2589bbdd8deaa448fd1523a374e3f14318bc27e74558a8604461028a7990
let x = 40; x + 2 (Binary)                                                                 f      states      2924 sha256 829de713d0b8446cf887a527132515eddd1010ca361a532e05a3b64e359aafcb
let x = 40; x + 2 (Binary)                                                                 f+s2   states     36183 sha256 2dc99dbc636927dd2322e8c6695cd25dc0036aa38708182fa706b624e10fadfd
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Unary)                       lower  states      1182 sha256 7457828174f3c0aa522ef68333e8f09ac13a59ba4d9011d1006039132f1fc172
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Unary)                       s1     states     22696 sha256 5fd42f7fb4a12dafba542ce5a4052c6de09bd476461047262acae3908758e2b0
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Unary)                       s1+s2  states    472777 sha256 9c0f5bdc4050cd6b7e9daafd0e638d5d5d0c5245975211835f349e411c8be1e8
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Unary)                       s2     states     18261 sha256 9d89c0934258d1dd146356eacddb4484b3fc520f899ef0ebc06273d293fee65b
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Unary)                       f      states     25673 sha256 5c5852ad46690ef497849e44bc534e696d5156e35b4cb0f358ef348c0f899cbf
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Unary)                       f+s2   states    203822 sha256 712b3e14d32bfef4d5874c464400cbec506745f32ffdc7e53c7ee33dcdfe7867
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Binary)                      lower  states      1371 sha256 3960cc06b24250743dceee99bb9ac9e1da6e9a7efad89ff4209dffc0b5f3434b
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Binary)                      s1     states     37113 sha256 61a3d55f21dad90b0a488d7263f863a4c9354fdbd53db3a6cd91502d315e8d39
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Binary)                      s1+s2  states    789185 sha256 b751cef5f81dec077063b8f2a43d7b89232746a7bfcac2131eedfd768ea5fd66
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Binary)                      s2     states     32657 sha256 fa8482e2c0c45ac99ce8ef560c7afc90535189e57f617abd1317ccfcf4fab5c6
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Binary)                      f      states     47478 sha256 e59297888f19bce113bf0be330e5de49a6abf7b5a8cc90687ec804a7fbb28604
fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5) (Binary)                      f+s2   states    590454 sha256 a7cb3f00bf5971cf3bf661688d180c5aef7b9086c1111f791d0f41d04a383a1e
```
<!-- END digests -->

---

### Task 1: `reduction.rs`, and stage 1 through it

**Files:**
- Create: `crates/redextape-core/src/tm/reduction.rs`
- Modify: `crates/redextape-core/src/tm.rs` — `pub mod reduction;`
- Modify: `crates/redextape-core/src/tm/single_tape.rs`
- Modify: `crates/redextape-core/src/tm/two_symbol.rs` — three doc comments, nothing else

**Why these land together.**
- `StateTable` and its methods are `pub(crate)`, and clippy `-D warnings` rejects any that nothing calls. So `reduction.rs` has to arrive with a consumer, and carries only the methods stage 1 calls; `get` arrives in Task 2.
- `two_symbol.rs` changes here because three of its doc comments cite "`single_tape.rs`'s `refused`", which this task deletes. The attributions gate rejects a citation of a file that no longer declares the symbol.

**What changes in `single_tape.rs`:**
1. `to_single_tape(m)` is now `to_single_tape_within(m, MAX_MACHINE_STATES).0`.
2. `to_single_tape_within`, in order:
   - returns a refused input unchanged, before any other check;
   - keeps both existing refusals, now `refused(TOO_MANY_TAPES)` and `refused(ALPHABET_COLLISION)`;
   - checks `b.table.overflowed()` after each original state.

   `Names::finish` checks once more, because it creates the `overflow` state and the entry state after the loop.
3. **The count.** `to_single_tape_within` returns `(Machine, usize)`. The `usize` counts the original states the loop began after the table had already refused a name; the state that trips is not counted. While the check after each state exists it is 0. Without that check `finish` still refuses, so only the count shows the difference. `to_single_tape` discards it, so no field is written in normal builds and read only by a test.
4. `Names` holds a `StateTable`, and the module's private `refused` is deleted.
5. `states_per_original` returns `Option<f64>`, `None` for any refusal. `the_worst_shipped_demo_measured_directly` now measures through `to_single_tape_within(.., usize::MAX).0`, because `to_single_tape` refuses that machine.
6. **Tests:**
   - New: `every_ceiling_below_the_image_size_refuses_and_the_image_size_builds_it`, `a_refusal_handed_back_in_comes_back_unchanged`, and `no_original_state_is_started_after_the_ceiling_trips`. The first tries every ceiling from 0 to the image's size on four fixtures, and reports every ceiling that neither refuses below the size nor builds the image at it. The last runs `two_candidates`, three original states, at ceiling 1, where the first state trips.
   - The two existing refusal tests gain a `refusal()` assertion.

**Interfaces:**
- Consumes: `crate::tm::build::MAX_MACHINE_STATES`; `crate::tm::machine::{Machine, State, StateId}`.
- Produces, in `crate::tm::reduction`:
  - `pub const TOO_MANY_STATES: &str`, `pub const TOO_MANY_TAPES: &str`, `pub const ALPHABET_COLLISION: &str`, `pub const CODE_DOES_NOT_COVER_ALPHABET: &str`, `pub const LEFT_END_COLLISION: &str`
  - `pub(crate) const REFUSALS: [&str; 5]`
  - `pub(crate) fn refused(name: &'static str) -> Machine`
  - `pub fn refusal(m: &Machine) -> Option<&'static str>`
  - `pub(crate) struct StateTable`, with:
    - `pub(crate) fn new(ceiling: usize) -> StateTable`
    - `pub(crate) fn id(&mut self, name: &str) -> StateId`
    - `pub(crate) fn get_mut(&mut self, id: StateId) -> Option<&mut State>`
    - `pub(crate) fn overflowed(&self) -> bool`
    - `pub(crate) fn into_states(self) -> Vec<State>`
- Produces, in `crate::tm::single_tape`:
  - `pub(crate) fn to_single_tape_within(m: &Machine, ceiling: usize) -> (Machine, usize)`
  - `pub fn states_per_original(m: &Machine) -> Option<f64>`, which was `-> f64`

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
 crates/redextape-core/src/tm.rs             |   1 +
 crates/redextape-core/src/tm/reduction.rs   | 149 ++++++++++++++++++++++++++
 crates/redextape-core/src/tm/single_tape.rs | 155 +++++++++++++++++++++-------
 crates/redextape-core/src/tm/two_symbol.rs  |   6 +-
 4 files changed, 270 insertions(+), 41 deletions(-)
```

<!-- BEGIN task1.patch -->
````diff
diff --git a/crates/redextape-core/src/tm.rs b/crates/redextape-core/src/tm.rs
index 3a6d798..82dbca3 100644
--- a/crates/redextape-core/src/tm.rs
+++ b/crates/redextape-core/src/tm.rs
@@ -17,6 +17,7 @@ pub mod lower_asm;
 pub mod lower_tm;
 pub mod machine;
 pub mod one_way;
+pub mod reduction;
 pub mod sim;
 pub mod single_tape;
 pub mod syntax;
diff --git a/crates/redextape-core/src/tm/reduction.rs b/crates/redextape-core/src/tm/reduction.rs
new file mode 100644
index 0000000..2c4ed81
--- /dev/null
+++ b/crates/redextape-core/src/tm/reduction.rs
@@ -0,0 +1,149 @@
+//! What the three machine-model reductions share: the table every state they generate is created in,
+//! capped at a ceiling, and the one shape a refusal takes.
+//!
+//! **ONE CEILING FOR THREE CONSTRUCTIONS.** `single_tape.rs`, `two_symbol.rs` and `one_way.rs` create
+//! every state through a [`StateTable`], so the state ceiling is enforced in one place, and a fourth
+//! reduction gets it by using the table. `build.rs`'s `Builder` enforces `MAX_MACHINE_STATES` for
+//! lowering; this is the reductions' counterpart to it, not a replacement.
+//!
+//! **A REFUSAL SURVIVES THE STAGES AFTER IT.** Each stage builds its states under names of its own, so
+//! reducing another stage's refusal would erase the refusal's name. Every stage therefore returns a
+//! refused input unchanged, and [`refusal`] on the end of a pipeline answers for every stage in it.
+
+use std::collections::HashMap;
+
+use crate::tm::machine::{Machine, State, StateId};
+
+/// The refusal a stage returns when the machine it is building would exceed its state ceiling.
+pub const TOO_MANY_STATES: &str = "too-many-states";
+/// The single-tape reduction's refusal of a machine with more tapes than its markers can name.
+pub const TOO_MANY_TAPES: &str = "too-many-tapes";
+/// The single-tape reduction's refusal of a machine whose alphabet collides with its block layout.
+pub const ALPHABET_COLLISION: &str = "alphabet-collision";
+/// The alphabet reduction's refusal of a code that cannot encode the machine's alphabet.
+pub const CODE_DOES_NOT_COVER_ALPHABET: &str = "code-does-not-cover-alphabet";
+/// The one-way fold's refusal of a machine whose rules name its marker.
+pub const LEFT_END_COLLISION: &str = "left-end-collision";
+
+/// Every refusal name. [`refusal`] recognises a machine only when its one state carries one of these.
+pub(crate) const REFUSALS: [&str; 5] =
+    [TOO_MANY_STATES, TOO_MANY_TAPES, ALPHABET_COLLISION, CODE_DOES_NOT_COVER_ALPHABET, LEFT_END_COLLISION];
+
+/// The degenerate machine a stage returns instead of a construction it cannot build: one non-accept
+/// state with no rules, on one tape, named for the reason. It halts at once without accepting.
+pub(crate) fn refused(name: &'static str) -> Machine {
+    Machine { states: vec![State { name: name.into(), accept: false, rules: vec![] }], start: 0, tapes: 1 }
+}
+
+/// The reason `m` is a refusal, or `None` when it is not one.
+///
+/// **THE SHAPE IS CHECKED, NOT ONLY THE NAME.** A machine is a refusal when it is exactly what
+/// [`refused`] builds: one state, which is the start state, is not an accept and has no rules, on one
+/// tape, named by one of [`REFUSALS`]. A state that carries a rule or accepts is doing something,
+/// whatever it is called.
+///
+/// **A HAND-WRITTEN MACHINE OF EXACTLY THIS SHAPE IS INDISTINGUISHABLE FROM A REFUSAL**, and every stage
+/// passes it through unchanged. That is accepted rather than worked around with a side channel.
+#[must_use]
+pub fn refusal(m: &Machine) -> Option<&'static str> {
+    let [only] = m.states.as_slice() else { return None };
+    if m.start != 0 || m.tapes != 1 || only.accept || !only.rules.is_empty() {
+        return None;
+    }
+    REFUSALS.into_iter().find(|name| *name == only.name)
+}
+
+/// Assigns a `StateId` to every state a reduction generates, by name, and creates at most `ceiling` of
+/// them.
+///
+/// **PAST THE CEILING, `id` RETURNS STATE 0 WITHOUT CREATING ANYTHING** and sets `overflowed` — the answer
+/// `build.rs`'s `Builder::state` gives at `MAX_MACHINE_STATES`. A stage checks `overflowed` as it builds
+/// and returns [`refused`] with [`TOO_MANY_STATES`], so a machine that would hold millions of states stops
+/// at the ceiling instead of being built first and measured afterwards. A refused name is not recorded,
+/// so asking for it again trips again rather than resolving to state 0.
+pub(crate) struct StateTable {
+    ids: HashMap<String, StateId>,
+    states: Vec<State>,
+    ceiling: usize,
+    overflowed: bool,
+}
+
+impl StateTable {
+    pub(crate) fn new(ceiling: usize) -> StateTable {
+        StateTable { ids: HashMap::new(), states: Vec::new(), ceiling, overflowed: false }
+    }
+
+    /// The id for `name`, creating a non-accept state with no rules on first mention. A name already in
+    /// the table still resolves after the ceiling has tripped.
+    pub(crate) fn id(&mut self, name: &str) -> StateId {
+        if let Some(id) = self.ids.get(name) {
+            return *id;
+        }
+        if self.states.len() >= self.ceiling {
+            self.overflowed = true;
+            return 0;
+        }
+        let id = StateId::try_from(self.states.len()).unwrap_or(0);
+        self.ids.insert(name.to_string(), id);
+        self.states.push(State { name: name.to_string(), accept: false, rules: Vec::new() });
+        id
+    }
+
+    pub(crate) fn get_mut(&mut self, id: StateId) -> Option<&mut State> {
+        self.states.get_mut(id as usize)
+    }
+
+    /// Whether `id` has refused a name for the ceiling.
+    pub(crate) fn overflowed(&self) -> bool {
+        self.overflowed
+    }
+
+    pub(crate) fn into_states(self) -> Vec<State> {
+        self.states
+    }
+}
+
+#[cfg(test)]
+mod tests {
+    use super::*;
+    use crate::tm::machine::{Move, Rule};
+
+    #[test]
+    fn a_state_table_refuses_the_first_new_name_past_its_ceiling() {
+        let mut t = StateTable::new(3);
+        assert_eq!([t.id("a"), t.id("b"), t.id("c")], [0, 1, 2]);
+        assert!(!t.overflowed(), "three states fit a ceiling of three");
+        assert_eq!(t.id("d"), 0, "past the ceiling, state 0 without creating a state");
+        assert!(t.overflowed());
+        assert_eq!(t.id("b"), 1, "a name already in the table still resolves after the trip");
+        let names: Vec<String> = t.into_states().into_iter().map(|s| s.name).collect();
+        assert_eq!(names, ["a", "b", "c"], "`d` was never created");
+    }
+
+    #[test]
+    fn refusal_names_every_machine_refused_builds() {
+        for name in REFUSALS {
+            assert_eq!(refusal(&refused(name)), Some(name));
+        }
+    }
+
+    fn one_state(name: &str, accept: bool, rules: Vec<Rule>, tapes: usize) -> Machine {
+        Machine { states: vec![State { name: name.into(), accept, rules }], start: 0, tapes }
+    }
+
+    #[test]
+    fn refusal_checks_the_shape_and_not_only_the_name() {
+        let rule = Rule { read: vec![None], write: vec![None], moves: vec![Move::S], next: 0 };
+        for (what, m) in [
+            ("a rule", one_state(TOO_MANY_STATES, false, vec![rule], 1)),
+            ("an accept", one_state(TOO_MANY_STATES, true, vec![], 1)),
+            ("two tapes", one_state(TOO_MANY_STATES, false, vec![], 2)),
+            ("a name no refusal carries", one_state("q0.stuck", false, vec![], 1)),
+        ] {
+            assert_eq!(refusal(&m), None, "a one-state machine with {what}");
+        }
+        let mut two = refused(TOO_MANY_STATES);
+        two.states.push(State { name: "extra".into(), accept: false, rules: vec![] });
+        assert_eq!(refusal(&two), None, "a refusal with a second state");
+    }
+}
diff --git a/crates/redextape-core/src/tm/single_tape.rs b/crates/redextape-core/src/tm/single_tape.rs
index eff038e..99afb10 100644
--- a/crates/redextape-core/src/tm/single_tape.rs
+++ b/crates/redextape-core/src/tm/single_tape.rs
@@ -8,7 +8,9 @@
 //! Reading the identity out of the symbol costs `2k + 2` symbols against an alphabet of 4, which is
 //! the dimension that is not scarce.
 
+use crate::tm::build::MAX_MACHINE_STATES;
 use crate::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
+use crate::tm::reduction::{ALPHABET_COLLISION, StateTable, TOO_MANY_STATES, TOO_MANY_TAPES, refusal, refused};
 use crate::tm::sim::Tape;
 
 /// The left and right sentinels bounding the block skeleton.
@@ -142,10 +144,11 @@ pub const OVERFLOW: &str = "overflow";
 /// consume a WRITTEN symbol as though it were the tape's own marker, corrupting the tape while the
 /// machine reports an ordinary ACCEPT — a silent wrong answer rather than a visible failure.
 ///
-/// `to_single_tape` checks what IT can see and REFUSES a machine either with too many tapes to encode
-/// (past [`MAX_ENCODABLE_TAPES`]) or whose `Machine::alphabet()` collides with the layout's own
-/// symbols (`layout_collision(m, &[])`), returning a degenerate one-state machine ([`refused`]) that
-/// halts in a named, non-accept state instead of building a construction it cannot represent
+/// `to_single_tape` checks what IT can see and REFUSES a machine with too many tapes to encode (past
+/// [`MAX_ENCODABLE_TAPES`]), whose `Machine::alphabet()` collides with the layout's own symbols
+/// (`layout_collision(m, &[])`), or whose image would hold more than `MAX_MACHINE_STATES` states. Each
+/// refusal is a degenerate one-state machine ([`refused`]) that halts in a named, non-accept state
+/// instead of building a construction it cannot represent
 /// correctly — the same shape `lower_tm.rs`'s `refused` takes for ITS unrepresentable inputs (an
 /// absurd slot count, `Mul` count, or state count).
 ///
@@ -158,9 +161,30 @@ pub const OVERFLOW: &str = "overflow";
 /// [`layout_collision`] with both the machine AND the initial tapes before trusting the pair — this
 /// function's refusal alone is not sufficient. The signature stays `Machine`, not `Option<Machine>`:
 /// the caller already has to distinguish a real accept from [`OVERFLOW`] by state name, and a named
-/// refusal state is that same mechanism, not a new one.
+/// refusal state is that same mechanism, not a new one. [`refusal`] names every refusal the three
+/// reductions return, and each of them hands a refusal back unchanged, so a pipeline checks once, at
+/// its end.
 #[must_use]
 pub fn to_single_tape(m: &Machine) -> Machine {
+    to_single_tape_within(m, MAX_MACHINE_STATES).0
+}
+
+/// [`to_single_tape`] under a caller's state ceiling instead of `MAX_MACHINE_STATES`, so a test can trip
+/// the ceiling on a machine small enough to read, together with the number of original states it began
+/// emitting after its table had refused a name.
+///
+/// **A REFUSAL IS RETURNED UNCHANGED, BEFORE ANY OTHER CHECK.** This construction builds its states under
+/// names of its own, so reducing a refusal would erase its name. **THE CEILING IS CHECKED AFTER EACH
+/// ORIGINAL STATE**, and once more in `Names::finish`, which creates states of its own.
+///
+/// **THE CHECK AFTER EACH STATE STOPS THE WORK, AND ONLY THE COUNT SHOWS IT.** Without it the loop would go
+/// on emitting every remaining original state against a full table, and `finish` would refuse all the same,
+/// so the machine returned cannot tell the two apart. The count can: it stays 0, because the loop returns
+/// on the state that trips. `no_original_state_is_started_after_the_ceiling_trips` holds it there.
+pub(crate) fn to_single_tape_within(m: &Machine, ceiling: usize) -> (Machine, usize) {
+    if refusal(m).is_some() {
+        return (m.clone(), 0);
+    }
     // Checked BEFORE anything below calls `reserved_symbols`/`layout_collision`, which mint a
     // `head_here`/`head_away` marker for every tape in `0..m.tapes`: past `MAX_ENCODABLE_TAPES` those
     // markers wrap into each other and into `BLANK`, `LEFT` and `RIGHT` (`head_here`/`head_away`'s own
@@ -168,26 +192,38 @@ pub fn to_single_tape(m: &Machine) -> Machine {
     // this module's tests for a reproduction). Refusing on tape count ALONE, before the alphabet is
     // even consulted, is what keeps this check correct at any `m.tapes` up to `tm::build::MAX_TAPES`.
     if m.tapes > MAX_ENCODABLE_TAPES {
-        return refused("too-many-tapes");
+        return (refused(TOO_MANY_TAPES), 0);
     }
     if layout_collision(m, &[]).is_some() {
-        return refused("alphabet-collision");
+        return (refused(ALPHABET_COLLISION), 0);
     }
-    let mut b = Names::new();
+    let mut b = Names::new(ceiling);
+    let mut started_after_trip = 0;
     for (sid, st) in m.states.iter().enumerate() {
+        if b.table.overflowed() {
+            started_after_trip += 1;
+        }
         b.emit_state(m, StateId::try_from(sid).unwrap_or(0), st);
+        if b.table.overflowed() {
+            return (refused(TOO_MANY_STATES), started_after_trip);
+        }
     }
-    b.finish(m)
+    (b.finish(m), started_after_trip)
 }
 
 /// Generated states per original state — the ratio that decides whether the largest machine the
-/// demo suite builds can be reduced at all.
+/// demo suite builds can be reduced at all. `None` when [`to_single_tape`] refuses `m`: a refusal is a
+/// one-state machine, and dividing that by the original's state count would report a failure to build
+/// as an excellent ratio — the lesson `two_symbol.rs`'s `states_per_original` records.
 #[must_use]
-pub fn states_per_original(m: &Machine) -> f64 {
+pub fn states_per_original(m: &Machine) -> Option<f64> {
     let single = to_single_tape(m);
+    if refusal(&single).is_some() {
+        return None;
+    }
     #[expect(clippy::cast_precision_loss, reason = "a ratio of state counts, reported to 2 dp")]
     let ratio = single.states.len() as f64 / m.states.len().max(1) as f64;
-    ratio
+    Some(ratio)
 }
 
 /// The symbols the block skeleton reserves for itself: [`LEFT`], [`RIGHT`], and every tape in
@@ -199,14 +235,6 @@ fn reserved_symbols(m: &Machine) -> Vec<Symbol> {
     [LEFT, RIGHT].into_iter().chain((0..m.tapes).flat_map(|i| [head_here(i), head_away(i)])).collect()
 }
 
-/// The degenerate one-state machine `to_single_tape` returns for a refusal: a halt in a named,
-/// non-accept state rather than a construction it cannot represent correctly — the same shape
-/// `lower_tm.rs`'s `refused` takes for ITS unrepresentable inputs. `name` says WHY refused, since
-/// `to_single_tape` has more than one reason to (see its own doc).
-fn refused(name: &str) -> Machine {
-    Machine { states: vec![State { name: name.into(), accept: false, rules: vec![] }], start: 0, tapes: 1 }
-}
-
 /// The first symbol in `m`'s alphabet or in `inits` that collides with the layout's own symbols — the
 /// sentinels and every tape's two markers — or `None` when the pair is safe to reduce.
 ///
@@ -231,25 +259,19 @@ pub fn layout_collision(m: &Machine, inits: &[Vec<Symbol>]) -> Option<Symbol> {
 /// target is emitted. Names are the text form's identity and must be unique, non-empty and free of
 /// whitespace and `; * : [ ]` (`Machine::validate`), which `.`-separated segments satisfy.
 struct Names {
-    ids: std::collections::HashMap<String, StateId>,
-    states: Vec<State>,
+    table: StateTable,
 }
 
 impl Names {
-    fn new() -> Names {
-        Names { ids: std::collections::HashMap::new(), states: Vec::new() }
+    fn new(ceiling: usize) -> Names {
+        Names { table: StateTable::new(ceiling) }
     }
 
     /// The id for `name`, minting the state on first mention. Every generated state is created here,
-    /// so a target named by a rule always exists by the time `finish` runs.
+    /// so a target named by a rule always exists by the time `finish` runs — unless the ceiling tripped,
+    /// which `to_single_tape_within` and `finish` check before the machine is used.
     fn id(&mut self, name: &str) -> StateId {
-        if let Some(id) = self.ids.get(name) {
-            return *id;
-        }
-        let id = StateId::try_from(self.states.len()).unwrap_or(0);
-        self.ids.insert(name.to_string(), id);
-        self.states.push(State { name: name.to_string(), accept: false, rules: Vec::new() });
-        id
+        self.table.id(name)
     }
 
     /// The state a rule targeting original state `sid` must name.
@@ -267,7 +289,7 @@ impl Names {
 
     fn push_rule(&mut self, at: &str, rule: Rule) {
         let id = self.id(at);
-        if let Some(st) = self.states.get_mut(id as usize) {
+        if let Some(st) = self.table.get_mut(id) {
             st.rules.push(rule);
         }
     }
@@ -281,7 +303,7 @@ impl Names {
         if st.accept {
             let name = format!("q{sid}.halt");
             let id = self.id(&name);
-            if let Some(s) = self.states.get_mut(id as usize) {
+            if let Some(s) = self.table.get_mut(id) {
                 s.accept = true;
                 s.rules.clear();
             }
@@ -459,7 +481,10 @@ impl Names {
     fn finish(mut self, m: &Machine) -> Machine {
         let _ = self.id(OVERFLOW);
         let start = self.id(&Names::entry_name(m, m.start));
-        Machine { states: self.states, start, tapes: 1 }
+        if self.table.overflowed() {
+            return refused(TOO_MANY_STATES);
+        }
+        Machine { states: self.table.into_states(), start, tapes: 1 }
     }
 }
 
@@ -768,6 +793,7 @@ mod tests {
         };
         let inits = vec![vec!['1', '1']];
         let single = to_single_tape(&m);
+        assert_eq!(crate::tm::reduction::refusal(&single), Some(ALPHABET_COLLISION));
         let refusal = &single.states[single.start as usize];
         assert_eq!(refusal.name, "alphabet-collision");
         assert!(!refusal.accept, "the refusal must be a stuck halt, not an accept");
@@ -857,6 +883,7 @@ mod tests {
         assert_eq!(char::from(b'A' + 30_u8), BLANK, "the exact collision MAX_ENCODABLE_TAPES exists to prevent");
 
         let refusal = to_single_tape(&machine_touching_only_tape(31, 30));
+        assert_eq!(crate::tm::reduction::refusal(&refusal), Some(TOO_MANY_TAPES));
         let start = &refusal.states[refusal.start as usize];
         assert_eq!(start.name, "too-many-tapes");
         assert!(!start.accept, "the refusal must be a stuck halt, not an accept");
@@ -917,6 +944,51 @@ mod tests {
         }
     }
 
+    /// **EVERY CEILING FROM 0 TO THE IMAGE'S OWN SIZE.** Below the image's state count the construction must
+    /// refuse, wherever the table trips — inside the loop or in `Names::finish` — and at that count it must
+    /// build the image unchanged. Every ceiling is tried and every failing one reported, because one ceiling
+    /// that escapes unrefused is what this looks for, and a test of the boundary alone tries two.
+    #[test]
+    fn every_ceiling_below_the_image_size_refuses_and_the_image_size_builds_it() {
+        let mut wrong = Vec::new();
+        for (fixture, m) in [wildcard_only(), two_candidates(), rewrite_ones(), multi_tape_rule()].iter().enumerate() {
+            let full = to_single_tape(m);
+            assert_eq!(refusal(&full), None, "a toy fixture is not refused");
+            let n = full.states.len();
+            for ceiling in 0..=n {
+                let got = to_single_tape_within(m, ceiling).0;
+                let right = if ceiling < n { refusal(&got) == Some(TOO_MANY_STATES) } else { got == full };
+                if !right {
+                    wrong.push((fixture, ceiling, n));
+                }
+            }
+        }
+        assert_eq!(wrong, Vec::new(), "(fixture, ceiling, image size) neither refused below the size nor built at it");
+    }
+
+    /// **THE CHECK AFTER EACH ORIGINAL STATE, WHICH NO ASSERTION ON THE MACHINE CAN SEE.** At a ceiling of
+    /// one, the first of `two_candidates`'s three original states trips the table. Without the check the loop
+    /// would start the other two against a full table and `Names::finish` would still refuse, so the returned
+    /// machine is the same either way; the count of states started after the trip is not.
+    #[test]
+    fn no_original_state_is_started_after_the_ceiling_trips() {
+        let m = two_candidates();
+        assert_eq!(m.states.len(), 3, "the trip must leave original states still to start");
+        let (single, started_after_trip) = to_single_tape_within(&m, 1);
+        assert_eq!(refusal(&single), Some(TOO_MANY_STATES));
+        assert_eq!(started_after_trip, 0, "an original state was started after the ceiling tripped");
+    }
+
+    /// Reducing a refusal would build a machine of its own that carries none of the refusal's name, so a
+    /// refusal from an earlier stage has to come back exactly as it went in.
+    #[test]
+    fn a_refusal_handed_back_in_comes_back_unchanged() {
+        for name in crate::tm::reduction::REFUSALS {
+            let r = refused(name);
+            assert_eq!(to_single_tape(&r), r, "for {name}");
+        }
+    }
+
     /// A 2-tape machine whose rule has tape 0 MOVE WITHOUT WRITING (`write: None`, `moves: R`) and tape
     /// 1 WRITE WITHOUT MOVING (`write: Some('z')`, `moves: S`) — the two arms `emit_one_tape_pass`
     /// splits between. Every acting tape in `multi_tape_rule` above has a concrete write, so that test
@@ -980,7 +1052,7 @@ mod tests {
     #[test]
     fn the_construction_stays_inside_the_state_budget() {
         for m in [wildcard_only(), two_candidates(), rewrite_ones()] {
-            let ratio = states_per_original(&m);
+            let ratio = states_per_original(&m).expect("a toy fixture is not refused");
             assert!(ratio < CEILING, "{ratio:.2} states per original state exceeds the {CEILING:.1} budget");
         }
     }
@@ -1091,7 +1163,7 @@ mod tests {
             let core = desugar(&prog);
             let d = run_tm_described(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS)
                 .unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
-            let ratio = states_per_original(&d.machine);
+            let ratio = states_per_original(&d.machine).expect("a `SOURCES` machine is under the state ceiling");
             assert!(
                 ratio < CEILING,
                 "{src} measured {ratio:.4} states per original state, at or over the {CEILING:.4} \
@@ -1131,6 +1203,11 @@ mod tests {
     /// own to close a 1.8x gap; closing it needs shrinking the construction further, raising
     /// `MAX_MACHINE_STATES`, or lowering the worst-shipped-demo floor, none of which this task does —
     /// see this test's own non-assertion below for why that is recorded rather than forced green.
+    ///
+    /// **THESE FIGURES ARE NOW MEASURED WITH THE CEILING LIFTED.** Since the reductions gained a state
+    /// ceiling, `to_single_tape` refuses this machine with `too-many-states` and `states_per_original`
+    /// answers `None` for it, so this test builds the image through `to_single_tape_within` at
+    /// `usize::MAX` — the whole image, as it did before the ceiling existed.
     #[test]
     fn the_worst_shipped_demo_measured_directly() {
         use crate::desugar::desugar;
@@ -1154,7 +1231,9 @@ mod tests {
         let core = desugar(&prog);
         let d = run_tm_described_at(&core, EncodingKind::Binary, ty, TM_DEFAULT_CAPS, MAX_FIELD_WIDTH)
             .unwrap_or_else(|r| panic!("the worst shipped demo did not run: {r:?}"));
-        let ratio = states_per_original(&d.machine);
+        let single = to_single_tape_within(&d.machine, usize::MAX).0;
+        #[expect(clippy::cast_precision_loss, reason = "a ratio of state counts")]
+        let ratio = single.states.len() as f64 / d.machine.states.len() as f64;
         // Same shape as `real_lowered_machines_cost_far_more_than_the_toy_fixtures`: this is deliberately
         // not `ratio < CEILING` (see that test's doc for why), since Step 0 found this machine already
         // over budget before Step 1's change and Step 1 alone does not close the gap.
diff --git a/crates/redextape-core/src/tm/two_symbol.rs b/crates/redextape-core/src/tm/two_symbol.rs
index 1d2f47e..3fadfe0 100644
--- a/crates/redextape-core/src/tm/two_symbol.rs
+++ b/crates/redextape-core/src/tm/two_symbol.rs
@@ -202,7 +202,7 @@ pub fn states_per_original(m: &Machine, code: &Code) -> Option<f64> {
 /// write at all, and the candidate would fire, move, and report an ordinary accept on a tape that
 /// was never written — a silent wrong answer. When `code` does not cover `m.alphabet()`, this returns
 /// a degenerate one-state, non-accept machine ([`refused`]) named to say why, the same shape
-/// `single_tape.rs`'s `refused` takes for its own unrepresentable inputs. Callers pair the two by
+/// `reduction.rs`'s `refused` builds for `single_tape.rs`'s unrepresentable inputs. Callers pair the two by
 /// construction: build the `Code` once and hand the same one to `to_two_symbol` and `bitify`.
 #[must_use]
 pub fn to_two_symbol(m: &Machine, code: &Code) -> Machine {
@@ -218,7 +218,7 @@ pub fn to_two_symbol(m: &Machine, code: &Code) -> Machine {
 
 /// The degenerate one-state machine `to_two_symbol` returns when `code` does not cover
 /// `m.alphabet()`: a halt in a named, non-accept state rather than a construction it cannot
-/// represent correctly — the same shape `single_tape.rs`'s `refused` takes for its own
+/// represent correctly — the same shape `reduction.rs`'s `refused` builds for `single_tape.rs`'s own
 /// unrepresentable inputs. `name` says why.
 fn refused(name: &str) -> Machine {
     Machine { states: vec![State { name: name.into(), accept: false, rules: vec![] }], start: 0, tapes: 1 }
@@ -1033,7 +1033,7 @@ mod tests {
 
     /// A `Code` built over a DIFFERENT machine's alphabet cannot cover this one's, so `to_two_symbol`
     /// must refuse rather than build a construction where a write with no pattern would silently fold
-    /// into "no write at all". The refusal is the shape `single_tape.rs`'s `refused` uses: one state,
+    /// into "no write at all". The refusal is the shape `reduction.rs`'s `refused` builds: one state,
     /// not an accept, named. `m` has two tapes so this also exercises the refusal's own tape count,
     /// which stays fixed regardless of `m.tapes` — `to_two_symbol`'s doc names this test for it.
     #[test]
````
<!-- END task1.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0` with no diff printed; `clippy exit 0` with no warning.

- [ ] **Step 4: Run this task's tests**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core --lib tm::single_tape tm::reduction
```

Expected summary line: `29 tests run: 29 passed, 807 skipped`. The slowest is `the_worst_shipped_demo_measured_directly`, because it still builds the unguarded image its doc records at 1,811,054 states.

- [ ] **Step 5: Run the two text gates**

`--index` in Step 2 already tracks `reduction.rs`. The attributions gate resolves citations against tracked files only, so running it before staging reports every citation of `reduction.rs` as a violation.

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 482 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `460 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Route stage 1's states through a capped StateTable

reduction.rs holds what the three reductions share: a StateTable that
creates at most `ceiling` states and flags the first refused name, the
five refusal names, the one refusal shape, and refusal(), which
recognises that shape. to_single_tape now refuses with too-many-states
past MAX_MACHINE_STATES, checking after each original state and in
finish, and hands an earlier refusal back unchanged.

A fast test tries every ceiling from 0 to the image's size: below it
the stage must refuse, at it build the image unchanged, and every
ceiling that does neither is reported.

The check after each state stops the work, but finish refuses either
way, so no assertion on the returned machine can see it.
to_single_tape_within also returns how many original states it started
after the table tripped, and a fast test holds that count at 0.

states_per_original returns None for a refusal, as the other two
stages' do; without that it would report the largest shipped demo's
refusal as a ratio of 1/49,135.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

---

### Task 2: Stage 2 through the `StateTable`

**Files:**
- Modify: `crates/redextape-core/src/tm/reduction.rs` — `StateTable::get`, and one more assertion in the table's test
- Modify: `crates/redextape-core/src/tm/two_symbol.rs`

**What changes in `two_symbol.rs`:**
1. **The entry point.**
   - `to_two_symbol(m, code)` is now `to_two_symbol_within(m, code, MAX_MACHINE_STATES).0`.
   - `to_two_symbol_within` hands a refusal back unchanged, refuses with `refused(CODE_DOES_NOT_COVER_ALPHABET)` as before, and checks the ceiling after each original state.
   - It returns the same count as stage 1's.
   - **No check after the loop.** Every state is created inside `emit_state`, so the check after each state sees a trip before the next one starts, and `Names::finish` creates none. `finish` has no check of its own, and a comment after the loop says why.
2. `finish` reads the entry state's id through `StateTable::get`. **This is why `get` exists and the spec's `contains` did not** — see *Spec corrections found while planning*, item 1.
3. `states_per_original` checks `refusal()` on the built image instead of `uncovered_symbol()` up front, so a `too-many-states` refusal is also `None`.
4. The module's private `refused` is deleted. The comment inside `emit_candidate` that named `to_two_symbol`'s loop now names `to_two_symbol_within`'s, which is where that loop moved.
5. **Tests:**
   - New: `every_ceiling_below_the_image_size_refuses_and_the_image_size_builds_it`, the same every-ceiling test on three fixtures, `a_refusal_handed_back_in_comes_back_unchanged`, and `no_original_state_is_started_after_the_ceiling_trips`. The last runs `chain(3)`, four original states, at ceiling 1, where the first state trips.
   - `a_code_built_for_a_different_machine_is_refused` gains a `refusal()` assertion.

**Interfaces:**
- Consumes: everything Task 1 produces in `crate::tm::reduction`; `crate::tm::single_tape::to_single_tape_within`, which this module's doc cites.
- Produces:
  - on `StateTable`: `pub(crate) fn get(&self, name: &str) -> Option<StateId>`
  - in `crate::tm::two_symbol`: `pub(crate) fn to_two_symbol_within(m: &Machine, code: &Code, ceiling: usize) -> (Machine, usize)`

- [ ] **Step 1: Confirm Task 1 is committed and nothing is pending**

```bash
git -C "$P" log --oneline -1 -- crates/redextape-core/src/tm/reduction.rs && git -C "$P" diff --quiet HEAD -- crates/ && echo clean
```

Expected: a line for Task 1's commit, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task2.patch | git -C "$P" apply --index --check && block_of task2.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/tm/reduction.rs  |   6 ++
 crates/redextape-core/src/tm/two_symbol.rs | 135 ++++++++++++++++++++---------
 2 files changed, 101 insertions(+), 40 deletions(-)
```

<!-- BEGIN task2.patch -->
````diff
diff --git a/crates/redextape-core/src/tm/reduction.rs b/crates/redextape-core/src/tm/reduction.rs
index 2c4ed81..efb67b3 100644
--- a/crates/redextape-core/src/tm/reduction.rs
+++ b/crates/redextape-core/src/tm/reduction.rs
@@ -89,6 +89,11 @@ impl StateTable {
         id
     }
 
+    /// The id `name` already has, without creating a state.
+    pub(crate) fn get(&self, name: &str) -> Option<StateId> {
+        self.ids.get(name).copied()
+    }
+
     pub(crate) fn get_mut(&mut self, id: StateId) -> Option<&mut State> {
         self.states.get_mut(id as usize)
     }
@@ -116,6 +121,7 @@ mod tests {
         assert_eq!(t.id("d"), 0, "past the ceiling, state 0 without creating a state");
         assert!(t.overflowed());
         assert_eq!(t.id("b"), 1, "a name already in the table still resolves after the trip");
+        assert_eq!(t.get("d"), None, "a refused name is not recorded, so asking again trips again");
         let names: Vec<String> = t.into_states().into_iter().map(|s| s.name).collect();
         assert_eq!(names, ["a", "b", "c"], "`d` was never created");
     }
diff --git a/crates/redextape-core/src/tm/two_symbol.rs b/crates/redextape-core/src/tm/two_symbol.rs
index 3fadfe0..e6e3350 100644
--- a/crates/redextape-core/src/tm/two_symbol.rs
+++ b/crates/redextape-core/src/tm/two_symbol.rs
@@ -32,7 +32,9 @@
 
 use std::collections::BTreeSet;
 
+use crate::tm::build::MAX_MACHINE_STATES;
 use crate::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
+use crate::tm::reduction::{CODE_DOES_NOT_COVER_ALPHABET, StateTable, TOO_MANY_STATES, refusal, refused};
 use crate::tm::sim::Tape;
 
 /// The zero bit. **This IS `BLANK`** — see the module doc for why that is forced.
@@ -171,17 +173,17 @@ pub fn unbitify(tape: &Tape, code: &Code) -> Option<(Vec<Symbol>, usize)> {
 }
 
 /// Generated states per original state — the ratio that decides whether a machine can be reduced at
-/// all, and the figure Task 5's gate holds a ceiling on. `None` when `code` does not cover
-/// `m.alphabet()` ([`uncovered_symbol`] is `Some`): `to_two_symbol` refuses in that case and returns a
-/// one-state machine, and dividing that state count by the original would report the refusal as a
-/// favorable ratio instead of a failure to construct at all — the same reason [`bitify`] returns
-/// `Option`.
+/// all, and the figure Task 5's gate holds a ceiling on. `None` when `to_two_symbol` refuses `m` — when
+/// `code` does not cover `m.alphabet()` ([`uncovered_symbol`] is `Some`), or when the image would exceed
+/// `MAX_MACHINE_STATES` states. A refusal is a one-state machine, and dividing that state count by the
+/// original would report the refusal as a favorable ratio instead of a failure to construct at all — the
+/// same reason [`bitify`] returns `Option`.
 #[must_use]
 pub fn states_per_original(m: &Machine, code: &Code) -> Option<f64> {
-    if uncovered_symbol(m, code).is_some() {
+    let reduced = to_two_symbol(m, code);
+    if refusal(&reduced).is_some() {
         return None;
     }
-    let reduced = to_two_symbol(m, code);
     #[expect(clippy::cast_precision_loss, reason = "a ratio of state counts, reported to 2 dp")]
     let ratio = reduced.states.len() as f64 / m.states.len().max(1) as f64;
     Some(ratio)
@@ -201,27 +203,42 @@ pub fn states_per_original(m: &Machine, code: &Code) -> Option<f64> {
 /// with no pattern; without this check, a write with no pattern would fold into the same case as no
 /// write at all, and the candidate would fire, move, and report an ordinary accept on a tape that
 /// was never written — a silent wrong answer. When `code` does not cover `m.alphabet()`, this returns
-/// a degenerate one-state, non-accept machine ([`refused`]) named to say why, the same shape
-/// `reduction.rs`'s `refused` builds for `single_tape.rs`'s unrepresentable inputs. Callers pair the two by
-/// construction: build the `Code` once and hand the same one to `to_two_symbol` and `bitify`.
+/// a degenerate one-state, non-accept machine ([`refused`]) named to say why, the shape every
+/// reduction's refusals share. It refuses the same way when the image would exceed `MAX_MACHINE_STATES`
+/// states, and hands an earlier stage's refusal back unchanged: this construction builds its states under
+/// names of its own, so reducing a refusal would erase its name. Callers pair the two by construction:
+/// build the `Code` once and hand the same one to `to_two_symbol` and `bitify`.
 #[must_use]
 pub fn to_two_symbol(m: &Machine, code: &Code) -> Machine {
+    to_two_symbol_within(m, code, MAX_MACHINE_STATES).0
+}
+
+/// [`to_two_symbol`] under a caller's state ceiling instead of `MAX_MACHINE_STATES`, so a test can trip
+/// the ceiling on a machine small enough to read, together with the number of original states it began
+/// emitting after its table had refused a name. The ceiling is checked after each original state, and the
+/// count stays 0 because the loop returns on the state that trips;
+/// `no_original_state_is_started_after_the_ceiling_trips` holds it there.
+pub(crate) fn to_two_symbol_within(m: &Machine, code: &Code, ceiling: usize) -> (Machine, usize) {
+    if refusal(m).is_some() {
+        return (m.clone(), 0);
+    }
     if uncovered_symbol(m, code).is_some() {
-        return refused("code-does-not-cover-alphabet");
+        return (refused(CODE_DOES_NOT_COVER_ALPHABET), 0);
     }
-    let mut b = Names::new(m.tapes);
+    let mut b = Names::new(m.tapes, ceiling);
+    let mut started_after_trip = 0;
     for (sid, st) in m.states.iter().enumerate() {
+        if b.table.overflowed() {
+            started_after_trip += 1;
+        }
         b.emit_state(m, code, StateId::try_from(sid).unwrap_or(0), st);
+        if b.table.overflowed() {
+            return (refused(TOO_MANY_STATES), started_after_trip);
+        }
     }
-    b.finish(m)
-}
-
-/// The degenerate one-state machine `to_two_symbol` returns when `code` does not cover
-/// `m.alphabet()`: a halt in a named, non-accept state rather than a construction it cannot
-/// represent correctly — the same shape `reduction.rs`'s `refused` builds for `single_tape.rs`'s own
-/// unrepresentable inputs. `name` says why.
-fn refused(name: &str) -> Machine {
-    Machine { states: vec![State { name: name.into(), accept: false, rules: vec![] }], start: 0, tapes: 1 }
+    // No check after the loop: every state is created inside `emit_state`, so the check above sees a trip
+    // before the next original state starts, and `Names::finish` creates none.
+    (b.finish(m), started_after_trip)
 }
 
 /// The first symbol in `m.alphabet()` that `code` cannot encode, or `None` when the pairing is safe.
@@ -240,26 +257,20 @@ pub fn uncovered_symbol(m: &Machine, code: &Code) -> Option<Symbol> {
 /// target is emitted. Names are the text form's identity and must be unique, non-empty and free of
 /// whitespace and `; * : [ ]` (`Machine::validate`), which `.`-separated segments satisfy.
 struct Names {
-    ids: std::collections::HashMap<String, StateId>,
-    states: Vec<State>,
+    table: StateTable,
     tapes: usize,
 }
 
 impl Names {
-    fn new(tapes: usize) -> Names {
-        Names { ids: std::collections::HashMap::new(), states: Vec::new(), tapes }
+    fn new(tapes: usize, ceiling: usize) -> Names {
+        Names { table: StateTable::new(ceiling), tapes }
     }
 
     /// The id for `name`, minting the state on first mention. Every generated state is created here,
-    /// so a target named by a rule always exists by the time `finish` runs.
+    /// so a target named by a rule always exists by the time `finish` runs — unless the ceiling tripped,
+    /// which `to_two_symbol_within` checks before the machine is used.
     fn id(&mut self, name: &str) -> StateId {
-        if let Some(id) = self.ids.get(name) {
-            return *id;
-        }
-        let id = StateId::try_from(self.states.len()).unwrap_or(0);
-        self.ids.insert(name.to_string(), id);
-        self.states.push(State { name: name.to_string(), accept: false, rules: Vec::new() });
-        id
+        self.table.id(name)
     }
 
     /// The state a rule targeting original state `sid` must name.
@@ -277,7 +288,7 @@ impl Names {
 
     fn push_rule(&mut self, at: &str, rule: Rule) {
         let id = self.id(at);
-        if let Some(st) = self.states.get_mut(id as usize) {
+        if let Some(st) = self.table.get_mut(id) {
             st.rules.push(rule);
         }
     }
@@ -400,7 +411,7 @@ impl Names {
         if st.accept {
             let name = Names::entry_name(sid, true);
             let id = self.id(&name);
-            if let Some(s) = self.states.get_mut(id as usize) {
+            if let Some(s) = self.table.get_mut(id) {
                 s.accept = true;
                 s.rules.clear();
             }
@@ -447,8 +458,8 @@ impl Names {
             let Some(want) = rule.read.get(i).copied().flatten() else { continue };
             // **THIS BRANCH IS UNREACHABLE, PROVABLY.** `emit_candidate` is private with exactly one
             // caller chain: `emit_state` calls it once per candidate of `st`, and `emit_state` is
-            // reached only from `to_two_symbol`'s loop over `m.states`. That loop runs only after
-            // `to_two_symbol`'s own refusal has already returned early whenever `code` does not cover
+            // reached only from `to_two_symbol_within`'s loop over `m.states`. That loop runs only after
+            // `to_two_symbol_within`'s own refusal has already returned early whenever `code` does not cover
             // `m.alphabet()` — the union of every rule's reads and writes, so `want` (a read of one of
             // `st`'s own rules) is always a member. By the time this line runs, `code.pattern(want)` is
             // always `Some`. The branch is kept to name that invariant, not because it can fire: if it
@@ -506,11 +517,10 @@ impl Names {
 
     fn finish(self, m: &Machine) -> Machine {
         let start = self
-            .ids
+            .table
             .get(&Names::entry_name(m.start, m.states.get(m.start as usize).is_some_and(|s| s.accept)))
-            .copied()
             .unwrap_or(0);
-        Machine { states: self.states, start, tapes: m.tapes }
+        Machine { states: self.table.into_states(), start, tapes: m.tapes }
     }
 }
 
@@ -814,6 +824,50 @@ mod tests {
         }
     }
 
+    /// **EVERY CEILING FROM 0 TO THE IMAGE'S OWN SIZE**, as the single-tape reduction checks it: below the
+    /// image's state count the construction must refuse, and at that count it must build the image unchanged.
+    /// Every failing ceiling is reported, not only the first.
+    #[test]
+    fn every_ceiling_below_the_image_size_refuses_and_the_image_size_builds_it() {
+        let alphabet = ['a', 'b', 'c'];
+        let mut wrong = Vec::new();
+        for (fixture, m) in [chain(3), reads('b', &alphabet), writes('c', Move::L, &alphabet)].iter().enumerate() {
+            let code = Code::new(m, &[alphabet.to_vec()]);
+            let full = to_two_symbol(m, &code);
+            assert_eq!(refusal(&full), None, "a toy fixture is not refused");
+            let n = full.states.len();
+            for ceiling in 0..=n {
+                let got = to_two_symbol_within(m, &code, ceiling).0;
+                let right = if ceiling < n { refusal(&got) == Some(TOO_MANY_STATES) } else { got == full };
+                if !right {
+                    wrong.push((fixture, ceiling, n));
+                }
+            }
+        }
+        assert_eq!(wrong, Vec::new(), "(fixture, ceiling, image size) neither refused below the size nor built at it");
+    }
+
+    /// **THE CHECK AFTER EACH ORIGINAL STATE.** At a ceiling of one, the first of `chain(3)`'s four original
+    /// states trips the table, so none of the other three may start.
+    #[test]
+    fn no_original_state_is_started_after_the_ceiling_trips() {
+        let m = chain(3);
+        assert_eq!(m.states.len(), 4, "the trip must leave original states still to start");
+        let (reduced, started_after_trip) = to_two_symbol_within(&m, &Code::new(&m, &[]), 1);
+        assert_eq!(refusal(&reduced), Some(TOO_MANY_STATES));
+        assert_eq!(started_after_trip, 0, "an original state was started after the ceiling tripped");
+    }
+
+    /// Reducing a refusal would build a machine of its own that carries none of the refusal's name, so a
+    /// refusal from an earlier stage has to come back exactly as it went in.
+    #[test]
+    fn a_refusal_handed_back_in_comes_back_unchanged() {
+        for name in crate::tm::reduction::REFUSALS {
+            let r = refused(name);
+            assert_eq!(to_two_symbol(&r, &Code::new(&r, &[])), r, "for {name}");
+        }
+    }
+
     /// **`stride` HAD NEVER EXECUTED BEFORE THIS TEST.** It carried `#[expect(dead_code)]` through
     /// two tasks — which only survives `-D warnings` while nothing calls the item — and the two arms
     /// that reach it, a move with no write, are reached by no other machine in this file. A rule that
@@ -1059,6 +1113,7 @@ mod tests {
             "the fixture must actually exercise the mismatch: `code` must miss a symbol of `m`'s"
         );
         let reduced = to_two_symbol(&m, &code);
+        assert_eq!(crate::tm::reduction::refusal(&reduced), Some(CODE_DOES_NOT_COVER_ALPHABET));
         assert_eq!(reduced.states.len(), 1, "a refusal is the degenerate one-state machine, not a partial build");
         assert!(!reduced.states[0].accept, "a refusal must not be an accept");
         assert_eq!(
````
<!-- END task2.patch -->

- [ ] **Step 3: Format check and lint** — the commands of Task 1 Step 3. Expected: `fmt exit 0`, `clippy exit 0`.

- [ ] **Step 4: Run this task's tests, with stage 1's again, since both use the table**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core --lib tm::two_symbol tm::reduction tm::single_tape
```

Expected summary line: `53 tests run: 53 passed, 786 skipped`.

- [ ] **Step 5: Run the two text gates** — the commands of Task 1 Step 5.

Expected:
- `checked 480 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `460 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Route stage 2's states through the capped StateTable

to_two_symbol now refuses with too-many-states past MAX_MACHINE_STATES,
checking after each original state, and hands an earlier stage's
refusal back unchanged. Its own refusal moves to the shared refused().
StateTable gains get(), because finish reads the entry state's id
rather than only testing whether it exists.

Nothing is checked after the loop: every state is created inside
emit_state, and finish creates none. As in stage 1, a fast test tries
every ceiling from 0 to the image's size, and to_two_symbol_within
returns how many original states it started after the table tripped,
which another fast test holds at 0.

states_per_original checks refusal() on the built image instead of
uncovered_symbol() up front, so a too-many-states refusal is None too.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

---

### Task 3: The fold through the `StateTable`, and a refusal through every stage

**Files:**
- Modify: `crates/redextape-core/src/tm/one_way.rs`
- Modify: `crates/redextape-core/src/tm/reduction.rs` — the composition test

**What changes in `one_way.rs`:**
1. **The entry point.** `to_one_way(m)` is now `to_one_way_within(m, MAX_MACHINE_STATES).0`. `to_one_way_within`:
   - hands a refusal back unchanged, and refuses with `refused(LEFT_END_COLLISION)` as before;
   - checks the ceiling once after the preamble, before the worklist starts, and after each pair the worklist emits;
   - returns the count of worklist items begun after the trip.
2. **`Names::pair` queues nothing once the table has tripped.** A refused name is never recorded, so without this a refused pair would be queued again every time it is named, including by the item that pops it, and the worklist would never end. With it, the worklist ends even with the check after each pair deleted (row S6c in Task 4).
3. **The check before the worklist, and what the doc records**, all of it measured:
   - **It is the only check a ceiling of 0 reaches.** `pre` trips the table before the start pair is named, so nothing is queued and the worklist never runs. Without it, the fold's every-ceiling test reports ceiling 0 on each of its three fixtures and no other ceiling (row S8 in Task 4).
   - **At a ceiling of 1 it refuses first, but is not the only check that could.** The start pair is queued just before its own name trips the table, so without this check the worklist starts that one item and the check after it refuses.
   - **The count is 0 at every ceiling.** A scratch run printed, for each of the three fixtures, a count of 0, a refusal below the fixture's size and the fold at it, at every ceiling from 0 to the size — 3, 4 and 16 states.
   - A comment after the worklist says why no check is needed there.
4. **Structure.** `Names` holds a `StateTable`, and `pair` tests membership with `StateTable::get(..).is_none()`. `HashMap` and `State` leave the module's imports; the test module imports `State` itself.
5. `states_per_original` checks `refusal()` on the folded machine.
6. `STATE_CEILING`'s doc says `to_one_way` now refuses the largest shipped demo, instead of only recording its 7,363,253-state measurement.
7. **Tests:**
   - New in `one_way.rs`:
     - `every_ceiling_below_the_fold_size_refuses_and_the_fold_size_builds_it`, the same every-ceiling test on three `walk` fixtures
     - `a_refusal_handed_back_in_comes_back_unchanged`
     - `no_worklist_item_is_started_after_the_ceiling_trips`, which runs a four-step `walk` at ceiling 2, so the preamble fits and the first worklist item trips
     - `a_tripped_table_queues_no_more_pairs`, which calls `Names::pair` directly: at ceiling 1, once the start pair's name trips the table, neither a new pair nor the refused one is queued. It tests `Names::pair` rather than `to_one_way_within`, because the check after each pair returns before a refused pair can be popped.
   - `a_machine_naming_the_marker_is_refused_and_has_no_ratio` gains a `refusal()` assertion.
   - New in `reduction.rs`: `a_refusal_survives_every_stage_after_it` runs every refusal through stage 1 then stage 2, and through the fold then stage 1 then stage 2.

**Interfaces:**
- Consumes: Task 1's and Task 2's `crate::tm::reduction` items, including `StateTable::get`.
- Produces: `pub(crate) fn to_one_way_within(m: &Machine, ceiling: usize) -> (Machine, usize)` in `crate::tm::one_way`.

- [ ] **Step 1: Confirm Task 2 is committed and nothing is pending**

```bash
git -C "$P" log --oneline -1 -- crates/redextape-core/src/tm/two_symbol.rs && git -C "$P" diff --quiet HEAD -- crates/ && echo clean
```

Expected: a line for Task 2's commit, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task3.patch | git -C "$P" apply --index --check && block_of task3.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/tm/one_way.rs   | 152 +++++++++++++++++++++++-------
 crates/redextape-core/src/tm/reduction.rs |  21 +++++
 2 files changed, 141 insertions(+), 32 deletions(-)
```

<!-- BEGIN task3.patch -->
````diff
diff --git a/crates/redextape-core/src/tm/one_way.rs b/crates/redextape-core/src/tm/one_way.rs
index a518835..f94ea3a 100644
--- a/crates/redextape-core/src/tm/one_way.rs
+++ b/crates/redextape-core/src/tm/one_way.rs
@@ -22,9 +22,11 @@
 //! snapshot holding something other than [`LEFT_END`]: that cell materializes as `BLANK`, and this
 //! construction never writes [`LEFT_END`]. [`unzigzag`] returning `Some` on a halted run is that proof.
 
-use std::collections::{HashMap, VecDeque};
+use std::collections::VecDeque;
 
-use crate::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
+use crate::tm::build::MAX_MACHINE_STATES;
+use crate::tm::machine::{BLANK, Machine, Move, Rule, StateId, Symbol};
+use crate::tm::reduction::{LEFT_END_COLLISION, StateTable, TOO_MANY_STATES, refusal, refused};
 use crate::tm::sim::Tape;
 
 /// The marker at physical cell 0 of every folded tape.
@@ -138,15 +140,15 @@ pub fn left_end_collision(m: &Machine) -> bool {
     m.alphabet().contains(&LEFT_END)
 }
 
-/// Generated states per original state. `None` when [`to_one_way`] refuses `m`: a refusal is a
-/// one-state machine, and dividing that by the original's state count would report a failure to build
-/// as an excellent ratio — the lesson `two_symbol.rs`'s `states_per_original` records.
+/// Generated states per original state. `None` when [`to_one_way`] refuses `m`, for either reason: a
+/// refusal is a one-state machine, and dividing that by the original's state count would report a failure
+/// to build as an excellent ratio — the lesson `two_symbol.rs`'s `states_per_original` records.
 #[must_use]
 pub fn states_per_original(m: &Machine) -> Option<f64> {
-    if left_end_collision(m) {
+    let folded = to_one_way(m);
+    if refusal(&folded).is_some() {
         return None;
     }
-    let folded = to_one_way(m);
     #[expect(clippy::cast_precision_loss, reason = "a ratio of state counts, reported to 2 dp")]
     let ratio = folded.states.len() as f64 / m.states.len().max(1) as f64;
     Some(ratio)
@@ -156,32 +158,57 @@ pub fn states_per_original(m: &Machine) -> Option<f64> {
 /// machine this can build.
 ///
 /// **REFUSES RATHER THAN BUILDING SOMETHING IT CANNOT CERTIFY.** When [`left_end_collision`] holds, this
-/// returns a one-state, non-accept machine named `left-end-collision` — the shape `single_tape.rs`'s and
-/// `two_symbol.rs`'s refusals take, including their fixed tape count of one.
+/// returns a one-state, non-accept machine named `left-end-collision` — [`refused`]'s shape, which every
+/// reduction's refusals share, including their fixed tape count of one. It refuses the same way, named
+/// `too-many-states`, when the folded machine would exceed `MAX_MACHINE_STATES` states, and hands an
+/// earlier stage's refusal back unchanged: the fold builds its states under names of its own, so folding
+/// a refusal would erase its name.
 ///
 /// **A PREAMBLE STARTS THE MACHINE**, stepping every head from [`LEFT_END`] onto physical cell 1, because
 /// `Tape::new` starts every head on cell 0 and cell 0 is the marker. It is one state and one step.
 #[must_use]
 pub fn to_one_way(m: &Machine) -> Machine {
+    to_one_way_within(m, MAX_MACHINE_STATES).0
+}
+
+/// [`to_one_way`] under a caller's state ceiling instead of `MAX_MACHINE_STATES`, so a test can trip the
+/// ceiling on a machine small enough to read, together with the number of worklist items it began emitting
+/// after its table had refused a name. The ceiling is checked once after the preamble and then after each pair
+/// the worklist emits, so the count is always 0; `no_worklist_item_is_started_after_the_ceiling_trips` holds it.
+///
+/// **THE CHECK AFTER THE PREAMBLE IS THE ONLY ONE A CEILING OF 0 REACHES.** `pre` trips the table before the
+/// start pair is named, so `Names::pair` queues nothing and the worklist never runs. At a ceiling of 1 the start
+/// pair is queued just before its own name trips the table, and that check refuses before the worklist starts it.
+pub(crate) fn to_one_way_within(m: &Machine, ceiling: usize) -> (Machine, usize) {
+    if refusal(m).is_some() {
+        return (m.clone(), 0);
+    }
     if left_end_collision(m) {
-        return refused("left-end-collision");
+        return (refused(LEFT_END_COLLISION), 0);
     }
-    let mut b = Names::new(m.tapes);
+    let mut b = Names::new(m.tapes, ceiling);
     let mut queue = VecDeque::new();
     let pre = b.id("pre");
     let start = b.pair(m.start, &vec![Side::Right; m.tapes], &mut queue);
     let preamble =
         Rule { read: vec![None; m.tapes], write: vec![None; m.tapes], moves: vec![Move::R; m.tapes], next: start };
     b.push_rule(pre, preamble);
+    if b.table.overflowed() {
+        return (refused(TOO_MANY_STATES), 0);
+    }
+    let mut started_after_trip = 0;
     while let Some((sid, sides)) = queue.pop_front() {
+        if b.table.overflowed() {
+            started_after_trip += 1;
+        }
         b.emit_pair(m, sid, &sides, &mut queue);
+        if b.table.overflowed() {
+            return (refused(TOO_MANY_STATES), started_after_trip);
+        }
     }
-    Machine { states: b.states, start: pre, tapes: m.tapes }
-}
-
-/// The degenerate machine [`to_one_way`] returns for a refusal: one named, non-accept state.
-fn refused(name: &str) -> Machine {
-    Machine { states: vec![State { name: name.into(), accept: false, rules: vec![] }], start: 0, tapes: 1 }
+    // No check after the worklist: the check before it refuses a trip in the preamble, and the check after each
+    // pair refuses every trip inside it.
+    (Machine { states: b.table.into_states(), start: pre, tapes: m.tapes }, started_after_trip)
 }
 
 /// Which half of a folded tape a head is on.
@@ -241,29 +268,22 @@ type Queue = VecDeque<(StateId, Vec<Side>)>;
 /// is emitted. Names are the text form's identity and must be unique, non-empty and free of whitespace
 /// and `; * : [ ]` (`Machine::validate`), which `.`-separated segments of letters and digits satisfy.
 struct Names {
-    ids: HashMap<String, StateId>,
-    states: Vec<State>,
+    table: StateTable,
     tapes: usize,
 }
 
 impl Names {
-    fn new(tapes: usize) -> Names {
-        Names { ids: HashMap::new(), states: Vec::new(), tapes }
+    fn new(tapes: usize, ceiling: usize) -> Names {
+        Names { table: StateTable::new(ceiling), tapes }
     }
 
     /// The id for `name`, minting the state on first mention.
     fn id(&mut self, name: &str) -> StateId {
-        if let Some(id) = self.ids.get(name) {
-            return *id;
-        }
-        let id = StateId::try_from(self.states.len()).unwrap_or(0);
-        self.ids.insert(name.to_string(), id);
-        self.states.push(State { name: name.to_string(), accept: false, rules: Vec::new() });
-        id
+        self.table.id(name)
     }
 
     fn push_rule(&mut self, at: StateId, rule: Rule) {
-        if let Some(st) = self.states.get_mut(at as usize) {
+        if let Some(st) = self.table.get_mut(at) {
             st.rules.push(rule);
         }
     }
@@ -288,9 +308,13 @@ impl Names {
     /// The state standing for original state `sid` with its tapes on `sides`, queued for emission the
     /// first time it is named. **The only place a pair's name is spelled**, so a rule targeting a pair
     /// and the pair's own emission cannot disagree about it.
+    ///
+    /// **NOTHING IS QUEUED ONCE THE TABLE HAS TRIPPED.** A name the table refuses is never recorded, so without
+    /// this a refused pair would be queued again every time it is named, including by the item that pops it,
+    /// and the worklist would never end. `a_tripped_table_queues_no_more_pairs` holds it.
     fn pair(&mut self, sid: StateId, sides: &[Side], queue: &mut Queue) -> StateId {
         let name = format!("q{sid}.{}", spell(sides));
-        if !self.ids.contains_key(&name) {
+        if !self.table.overflowed() && self.table.get(&name).is_none() {
             queue.push_back((sid, sides.to_vec()));
         }
         self.id(&name)
@@ -306,7 +330,7 @@ impl Names {
         let here = self.pair(sid, sides, queue);
         let Some(st) = m.states.get(sid as usize) else { return };
         if st.accept {
-            if let Some(s) = self.states.get_mut(here as usize) {
+            if let Some(s) = self.table.get_mut(here) {
                 s.accept = true;
             }
             return;
@@ -388,6 +412,7 @@ impl Names {
 #[cfg(test)]
 mod tests {
     use super::*;
+    use crate::tm::machine::State;
     use crate::tm::sim::{DEFAULT_CAPS, Status, simulate_final};
     use crate::tm::single_tape::normalize;
     use proptest::prelude::*;
@@ -548,6 +573,7 @@ mod tests {
         let m = walk(&[(Some(LEFT_END), Move::R)]);
         assert!(left_end_collision(&m));
         let folded = to_one_way(&m);
+        assert_eq!(refusal(&folded), Some(LEFT_END_COLLISION));
         assert_eq!(folded.states.len(), 1, "a refusal is the degenerate one-state machine, not a partial build");
         assert!(!folded.states[0].accept, "a refusal must not be an accept");
         assert_eq!(folded.states[0].name, "left-end-collision");
@@ -555,6 +581,67 @@ mod tests {
         assert!(states_per_original(&walk(&[(Some('a'), Move::R)])).is_some(), "and a clean machine has one");
     }
 
+    /// **EVERY CEILING FROM 0 TO THE FOLD'S OWN SIZE**, as the other two reductions check it: below the folded
+    /// machine's state count the fold must refuse, and at that count it must build the fold unchanged. Every
+    /// failing ceiling is reported, not only the first.
+    #[test]
+    fn every_ceiling_below_the_fold_size_refuses_and_the_fold_size_builds_it() {
+        let x = Some('x');
+        let fixtures =
+            [walk(&[(None, Move::S)]), walk(&[(x, Move::R)]), walk(&[(x, Move::L), (x, Move::L), (None, Move::R)])];
+        let mut wrong = Vec::new();
+        for (fixture, m) in fixtures.iter().enumerate() {
+            let full = to_one_way(m);
+            assert_eq!(refusal(&full), None, "a toy fixture is not refused");
+            let n = full.states.len();
+            for ceiling in 0..=n {
+                let got = to_one_way_within(m, ceiling).0;
+                let right = if ceiling < n { refusal(&got) == Some(TOO_MANY_STATES) } else { got == full };
+                if !right {
+                    wrong.push((fixture, ceiling, n));
+                }
+            }
+        }
+        assert_eq!(wrong, Vec::new(), "(fixture, ceiling, fold size) neither refused below the size nor built at it");
+    }
+
+    /// **THE CHECK AFTER EACH PAIR.** At a ceiling of two the preamble's two states fit and the first worklist
+    /// item trips the table, so no item may start after it.
+    #[test]
+    fn no_worklist_item_is_started_after_the_ceiling_trips() {
+        let x = Some('x');
+        let m = walk(&[(x, Move::L), (x, Move::L), (x, Move::L), (None, Move::R)]);
+        let (folded, started_after_trip) = to_one_way_within(&m, 2);
+        assert_eq!(refusal(&folded), Some(TOO_MANY_STATES));
+        assert_eq!(started_after_trip, 0, "a worklist item was started after the ceiling tripped");
+    }
+
+    /// **A TRIPPED TABLE QUEUES NO MORE PAIRS, WHICH IS WHAT LETS THE WORKLIST END.** Tested on `Names::pair`
+    /// directly, because the check after each pair returns before a refused pair can be popped, so
+    /// `to_one_way_within` does not show it.
+    #[test]
+    fn a_tripped_table_queues_no_more_pairs() {
+        let mut queue = Queue::new();
+        let mut b = Names::new(1, 1);
+        let _ = b.id("pre");
+        let _ = b.pair(0, &[Side::Right], &mut queue);
+        assert!(b.table.overflowed(), "the start pair's name must trip a ceiling of one");
+        assert_eq!(queue.len(), 1, "the pair whose name trips the table is queued");
+        let _ = b.pair(1, &[Side::Right], &mut queue);
+        let _ = b.pair(0, &[Side::Right], &mut queue);
+        assert_eq!(queue.len(), 1, "a pair named after the trip is not queued, even the one the trip refused");
+    }
+
+    /// Folding a refusal would build a machine of its own that carries none of the refusal's name, so a
+    /// refusal from an earlier stage has to come back exactly as it went in.
+    #[test]
+    fn a_refusal_handed_back_in_comes_back_unchanged() {
+        for name in crate::tm::reduction::REFUSALS {
+            let r = refused(name);
+            assert_eq!(to_one_way(&r), r, "for {name}");
+        }
+    }
+
     /// Tape 0 crosses into the left half; tape 1 only ever moves right, so no reachable pair may put it on
     /// the left — the property that keeps the multiplier at `2^(tapes with a Move::L rule)` rather than
     /// `2^tapes`.
@@ -623,7 +710,8 @@ mod tests {
     /// **NOT A CEILING EVERY SHIPPED MACHINE MEETS.** The largest shipped demo — `single_tape.rs`'s
     /// `the_worst_shipped_demo_measured_directly` builds it — has four tapes with a `Move::L` rule where
     /// this corpus has two or three, and folded to 7,363,253 states against `MAX_MACHINE_STATES` of
-    /// 1,000,000 when measured on 2026-09-13. That is recorded in the roadmap entry, not gated here.
+    /// 1,000,000 when measured on 2026-09-13, before the reductions had a state ceiling. `to_one_way` now
+    /// refuses it with `too-many-states`; the measurement is recorded in the roadmap entry, not gated here.
     const STATE_CEILING: f64 = 40.0;
 
     /// Also prints, per row, how many `sides` combinations the worklist reached against `2^n` for `n`
diff --git a/crates/redextape-core/src/tm/reduction.rs b/crates/redextape-core/src/tm/reduction.rs
index efb67b3..1309692 100644
--- a/crates/redextape-core/src/tm/reduction.rs
+++ b/crates/redextape-core/src/tm/reduction.rs
@@ -133,6 +133,27 @@ mod tests {
         }
     }
 
+    /// **A REFUSAL SURVIVES EVERY STAGE AFTER IT**, in the orders the oracles compose the stages: stage 1
+    /// then stage 2, and the fold then stage 1 then stage 2. Each stage's own test shows it passing a
+    /// refusal through alone; this runs the chain a pipeline relies on when it calls [`refusal`] once, at
+    /// its end.
+    #[test]
+    fn a_refusal_survives_every_stage_after_it() {
+        use crate::tm::one_way::to_one_way;
+        use crate::tm::single_tape::to_single_tape;
+        use crate::tm::two_symbol::{Code, to_two_symbol};
+        let two_symbol = |m: &Machine| to_two_symbol(m, &Code::new(m, &[]));
+        for name in REFUSALS {
+            let r = refused(name);
+            assert_eq!(refusal(&two_symbol(&to_single_tape(&r))), Some(name), "stage 1 then stage 2, for {name}");
+            assert_eq!(
+                refusal(&two_symbol(&to_single_tape(&to_one_way(&r)))),
+                Some(name),
+                "the fold then stage 1 then stage 2, for {name}"
+            );
+        }
+    }
+
     fn one_state(name: &str, accept: bool, rules: Vec<Rule>, tapes: usize) -> Machine {
         Machine { states: vec![State { name: name.into(), accept, rules }], start: 0, tapes }
     }
````
<!-- END task3.patch -->

- [ ] **Step 3: Format check and lint** — the commands of Task 1 Step 3. Expected: `fmt exit 0`, `clippy exit 0`.

- [ ] **Step 4: Run all four modules' tests**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core --lib tm::one_way tm::reduction tm::two_symbol tm::single_tape
```

Expected summary line: `70 tests run: 70 passed, 774 skipped`.

- [ ] **Step 5: Run the two text gates** — the commands of Task 1 Step 5.

Expected:
- `checked 480 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `460 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Route the fold's states through the capped StateTable

to_one_way now refuses with too-many-states past MAX_MACHINE_STATES,
checking once after the preamble and then after each pair the worklist
emits, and hands an earlier stage's refusal back unchanged. Its own
refusal moves to the shared refused(), and states_per_original checks
refusal() on the built machine, so either refusal is None.

pair() queues nothing once the table has tripped. A refused name is
never recorded, so queueing it would queue it again every time it is
named, and the worklist would never end. That leaves a ceiling of 0 to
the check after the preamble: pre trips the table before the start pair
is named, nothing is queued, and the worklist never runs. Without that
check, the fold's every-ceiling test reports a ceiling of 0 for each
fixture and no other ceiling. Nothing is checked after the worklist.

to_one_way_within returns how many items it started after the trip,
held at 0 by a fast test, and a test on pair() pins that a tripped
table queues nothing.

reduction.rs gains the composition test: every refusal still names
itself after stage 1 then stage 2, and after the fold then stage 1 then
stage 2.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

---

### Task 4: The real ceiling on the largest shipped demo, the sweep, and the finished-code checks

**Files:**
- Modify: `crates/redextape-core/src/tm/reduction.rs` — `#[cfg(test)] worst_shipped_demo()` and the three slow-tier tests
- Modify: `crates/redextape-core/src/tm/single_tape.rs` — `the_worst_shipped_demo_measured_directly` uses the shared helper
- Modify: `crates/redextape-core/src/tm/build.rs` — `MAX_MACHINE_STATES`'s doc
- Modify: `crates/redextape-core/tests/two_symbol_oracle.rs` — one assertion, one import
- Modify: `crates/redextape-core/examples/state_cost_probe.rs` — one doc sentence

**What changes:**
1. **`worst_shipped_demo()`** is a `#[cfg(test)] pub(crate)` function in `reduction.rs`. It holds the source of the `map` + `ap2` demo, lowers it under `Binary` at `MAX_FIELD_WIDTH`, and returns it with its initial tapes.
   - It is the one copy inside the crate's unit tests. The copy in `guard_counterexamples.rs` stays, because an integration test cannot share it.
   - It lives outside `mod tests` because a private test module is not reachable from `single_tape.rs`, and the constant it replaces was local to one test function.
2. **Three `#[ignore]` tests, one per stage**, each assert that the PUBLIC `to_*` refuses the demo with `too-many-states`, and each doc records its measured peak RSS:
   - `stage_one_refuses_the_worst_shipped_demo_at_the_real_ceiling`
   - `stage_two_refuses_the_worst_shipped_demo_at_the_real_ceiling`
   - `the_fold_refuses_the_worst_shipped_demo_at_the_real_ceiling`
3. **`build.rs`:** the ceiling doc names the reductions' `StateTable`, and "the single choke point every state goes through" becomes "every state LOWERING builds".
4. **`two_symbol_oracle.rs`:** `assert!(canonical.states.len() < MAX_MACHINE_STATES, ..)` becomes `assert_eq!(refusal(&canonical), None, ..)`. A one-state refusal passes the old comparison, so it could no longer fail.
5. **`state_cost_probe.rs`:** its list of copies to update when the largest demo moves gains `reduction.rs`'s `worst_shipped_demo`.

**Interfaces:**
- Consumes: every `crate::tm::reduction` item from Tasks 1–3; `crate::tm::{EncodingKind, MAX_FIELD_WIDTH, TM_DEFAULT_CAPS, run_tm_described_at}`.
- Produces: `#[cfg(test)] pub(crate) fn worst_shipped_demo() -> (Machine, Vec<Vec<crate::tm::machine::Symbol>>)` in `crate::tm::reduction`.

- [ ] **Step 1: Confirm Task 3 is committed and nothing is pending**

```bash
git -C "$P" log --oneline -1 -- crates/redextape-core/src/tm/one_way.rs && git -C "$P" diff --quiet HEAD -- crates/ && echo clean
```

Expected: a line for Task 3's commit, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task4.patch | git -C "$P" apply --index --check && block_of task4.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/examples/state_cost_probe.rs |  5 +-
 crates/redextape-core/src/tm/build.rs              |  9 ++-
 crates/redextape-core/src/tm/reduction.rs          | 69 ++++++++++++++++++++++
 crates/redextape-core/src/tm/single_tape.rs        | 27 ++-------
 crates/redextape-core/tests/two_symbol_oracle.rs   |  6 +-
 5 files changed, 86 insertions(+), 30 deletions(-)
```

<!-- BEGIN task4.patch -->
````diff
diff --git a/crates/redextape-core/examples/state_cost_probe.rs b/crates/redextape-core/examples/state_cost_probe.rs
index 9ec7c64..657e925 100644
--- a/crates/redextape-core/examples/state_cost_probe.rs
+++ b/crates/redextape-core/examples/state_cost_probe.rs
@@ -42,8 +42,9 @@
 //! copy is shaped: that is both what the sync test's extractor looks for and what `grep -rn
 //! FIRST_ORDER_DEMOS` — the audit method that test's own doc names — finds. If `FIRST_ORDER_DEMOS`
 //! grows a new entry, re-copy the array from that file into this one and re-run this probe; its
-//! `WORST SHIPPED DEMO` line is what `tm/build.rs`'s `MAX_MACHINE_STATES` doc and
-//! `guard_counterexamples.rs`'s `WORST_SHIPPED_DEMO` need to match if the maximum moves. G is what
+//! `WORST SHIPPED DEMO` line is what `tm/build.rs`'s `MAX_MACHINE_STATES` doc,
+//! `guard_counterexamples.rs`'s `WORST_SHIPPED_DEMO` and `reduction.rs`'s `worst_shipped_demo` need to
+//! match if the maximum moves. G is what
 //! pins the "never rejects a legitimate program" half of `MAX_MACHINE_STATES`, and
 //! `guard_counterexamples.rs` asserts the relation this section measures.
 //!
diff --git a/crates/redextape-core/src/tm/build.rs b/crates/redextape-core/src/tm/build.rs
index b222207..3d87026 100644
--- a/crates/redextape-core/src/tm/build.rs
+++ b/crates/redextape-core/src/tm/build.rs
@@ -72,7 +72,9 @@ pub const MIN_FIELD_WIDTH: usize = 4;
 pub const MAX_FIELD_WIDTH: usize = 64;
 
 /// The most states any one `Machine` may contain. Reaching it makes `Builder` stop allocating and
-/// raise `overflowed`; `lower_tm_all` then refuses the program rather than laying out the rest.
+/// raise `overflowed`; `lower_tm_all` then refuses the program rather than laying out the rest. The three
+/// machine-model reductions enforce the same ceiling through `reduction.rs`'s `StateTable`, and refuse
+/// with `too-many-states`.
 ///
 /// MEASURED, not chosen for roundness. At **727 bytes per state** — RSS delta around `lower_tm`,
 /// against a `size_of::<State>()` of 56 that understates the heap `String` name and `Vec<Rule>` by
@@ -112,8 +114,9 @@ pub const MAX_FIELD_WIDTH: usize = 64;
 /// estimated the cost up front would be symmetric with those three and would refuse before
 /// allocating anything. It would also duplicate per-gadget cost knowledge in a second place, which
 /// goes stale silently the first time a gadget changes — the same failure mode as the prose this
-/// replaces. `Builder::state`/`accept` is the single choke point every state goes through, so a
-/// ceiling here is exact and cannot drift from what the gadgets actually build.
+/// replaces. `Builder::state`/`accept` is the single choke point every state LOWERING builds goes
+/// through, so a ceiling here is exact and cannot drift from what the gadgets actually build. The
+/// reductions count at their own choke point, `StateTable::id`, for the same reason.
 ///
 /// Full measurement tables: `docs/superpowers/specs/2026-08-11-count-bounds-design.md` §3.
 /// `cargo run --release --example state_cost_probe -p redextape-core` re-derives most of them.
diff --git a/crates/redextape-core/src/tm/reduction.rs b/crates/redextape-core/src/tm/reduction.rs
index 1309692..1c0c798 100644
--- a/crates/redextape-core/src/tm/reduction.rs
+++ b/crates/redextape-core/src/tm/reduction.rs
@@ -108,11 +108,80 @@ impl StateTable {
     }
 }
 
+/// The largest machine the shipped demos build, with the initial tapes it runs on: the `map` + `ap2` entry
+/// of `native_oracle.rs`'s `FIRST_ORDER_DEMOS`, which `state_cost_probe`'s section G finds as the corpus's
+/// maximum, lowered as section G lowers it — under `Binary` at `MAX_FIELD_WIDTH`, 49,135 states.
+///
+/// The source is byte-identical to `guard_counterexamples.rs`'s `WORST_SHIPPED_DEMO`, which an
+/// integration test cannot share. Within this crate's unit tests it is written once, here, for
+/// `single_tape.rs`'s `the_worst_shipped_demo_measured_directly` and the slow-tier tests below.
+#[cfg(test)]
+pub(crate) fn worst_shipped_demo() -> (Machine, Vec<Vec<crate::tm::machine::Symbol>>) {
+    use crate::tm::{EncodingKind, MAX_FIELD_WIDTH, TM_DEFAULT_CAPS, run_tm_described_at};
+
+    const WORST_SHIPPED_DEMO: &str = "\
+        fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
+        fn add1(x) { x + 1 }\n\
+        fn ap2(g, a, b) { g(a, b) }\n\
+        head(map([1, 2], add1)) + head(ap2(map, [5, 6], add1))";
+
+    let (prog, ds) = crate::parser::parse(WORST_SHIPPED_DEMO);
+    assert!(ds.is_empty(), "parse errors: {ds:?}");
+    let prog = prog.unwrap_or_else(|| panic!("no program for the worst shipped demo"));
+    let ty = crate::typeck::result_type(&prog).unwrap_or_else(|e| panic!("type errors: {e:?}"));
+    let core = crate::desugar::desugar(&prog);
+    let d = run_tm_described_at(&core, EncodingKind::Binary, ty, TM_DEFAULT_CAPS, MAX_FIELD_WIDTH)
+        .unwrap_or_else(|r| panic!("the worst shipped demo did not run: {r:?}"));
+    let init = d.header.init(d.machine.tapes);
+    (d.machine, init)
+}
+
 #[cfg(test)]
 mod tests {
     use super::*;
     use crate::tm::machine::{Move, Rule};
 
+    /// **THE REAL CEILING, ON THE LARGEST SHIPPED DEMO.** Every ceiling test beside a stage passes its
+    /// ceiling in by hand, so a public `to_*` that stopped passing `MAX_MACHINE_STATES` would leave all of
+    /// them green; only a trip at the real ceiling can see it. One test per stage rather than one test with
+    /// three assertions, because a failed assertion ends its test and would hide the stages after it.
+    ///
+    /// Unguarded, [`worst_shipped_demo`] builds 1,811,054 states through stage 1, 2,601,972 through stage 2
+    /// applied to the lowered machine, and 7,363,253 through the fold
+    /// (`docs/superpowers/specs/2026-09-14-reduction-state-guard-design.md`), so each stage fills its table
+    /// to the ceiling before it refuses.
+    ///
+    /// Peak RSS of this test alone, as the release test binary's `ru_maxrss`: 744,844 KB, in 1.2 s.
+    #[test]
+    #[ignore = "slow tier: builds a ceiling's worth of states before refusing; run via scripts/check-slow.sh"]
+    fn stage_one_refuses_the_worst_shipped_demo_at_the_real_ceiling() {
+        let (m, _inits) = worst_shipped_demo();
+        assert_eq!(refusal(&crate::tm::single_tape::to_single_tape(&m)), Some(TOO_MANY_STATES));
+    }
+
+    /// Stage 2 on the lowered machine, with the `Code` its initial tapes need. See
+    /// `stage_one_refuses_the_worst_shipped_demo_at_the_real_ceiling` for why each stage has its own test.
+    ///
+    /// Peak RSS of this test alone, as the release test binary's `ru_maxrss`: 669,720 KB, in 1.2 s.
+    #[test]
+    #[ignore = "slow tier: builds a ceiling's worth of states before refusing; run via scripts/check-slow.sh"]
+    fn stage_two_refuses_the_worst_shipped_demo_at_the_real_ceiling() {
+        use crate::tm::two_symbol::{Code, to_two_symbol};
+        let (m, inits) = worst_shipped_demo();
+        assert_eq!(refusal(&to_two_symbol(&m, &Code::new(&m, &inits))), Some(TOO_MANY_STATES));
+    }
+
+    /// The fold on the lowered machine. See `stage_one_refuses_the_worst_shipped_demo_at_the_real_ceiling`
+    /// for why each stage has its own test.
+    ///
+    /// Peak RSS of this test alone, as the release test binary's `ru_maxrss`: 718,712 KB, in 1.3 s.
+    #[test]
+    #[ignore = "slow tier: builds a ceiling's worth of states before refusing; run via scripts/check-slow.sh"]
+    fn the_fold_refuses_the_worst_shipped_demo_at_the_real_ceiling() {
+        let (m, _inits) = worst_shipped_demo();
+        assert_eq!(refusal(&crate::tm::one_way::to_one_way(&m)), Some(TOO_MANY_STATES));
+    }
+
     #[test]
     fn a_state_table_refuses_the_first_new_name_past_its_ceiling() {
         let mut t = StateTable::new(3);
diff --git a/crates/redextape-core/src/tm/single_tape.rs b/crates/redextape-core/src/tm/single_tape.rs
index 99afb10..cc66a96 100644
--- a/crates/redextape-core/src/tm/single_tape.rs
+++ b/crates/redextape-core/src/tm/single_tape.rs
@@ -1210,30 +1210,11 @@ mod tests {
     /// `usize::MAX` — the whole image, as it did before the ceiling existed.
     #[test]
     fn the_worst_shipped_demo_measured_directly() {
-        use crate::desugar::desugar;
-        use crate::parser::parse;
-        use crate::tm::{EncodingKind, MAX_FIELD_WIDTH, TM_DEFAULT_CAPS, run_tm_described_at};
-        use crate::typeck::result_type;
-
-        // `native_oracle.rs`'s `FIRST_ORDER_DEMOS`, the entry `state_cost_probe`'s section G finds as
-        // the corpus's maximum under `Binary` (49,135 states) — byte-identical to
-        // `guard_counterexamples.rs`'s `WORST_SHIPPED_DEMO`.
-        const WORST_SHIPPED_DEMO: &str = "\
-            fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
-            fn add1(x) { x + 1 }\n\
-            fn ap2(g, a, b) { g(a, b) }\n\
-            head(map([1, 2], add1)) + head(ap2(map, [5, 6], add1))";
-
-        let (prog, ds) = parse(WORST_SHIPPED_DEMO);
-        assert!(ds.is_empty(), "parse errors: {ds:?}");
-        let prog = prog.unwrap_or_else(|| panic!("no program for the worst shipped demo"));
-        let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors: {e:?}"));
-        let core = desugar(&prog);
-        let d = run_tm_described_at(&core, EncodingKind::Binary, ty, TM_DEFAULT_CAPS, MAX_FIELD_WIDTH)
-            .unwrap_or_else(|r| panic!("the worst shipped demo did not run: {r:?}"));
-        let single = to_single_tape_within(&d.machine, usize::MAX).0;
+        // `reduction.rs`'s `worst_shipped_demo` holds the source and lowers it the way section G does.
+        let (machine, _inits) = crate::tm::reduction::worst_shipped_demo();
+        let single = to_single_tape_within(&machine, usize::MAX).0;
         #[expect(clippy::cast_precision_loss, reason = "a ratio of state counts")]
-        let ratio = single.states.len() as f64 / d.machine.states.len() as f64;
+        let ratio = single.states.len() as f64 / machine.states.len() as f64;
         // Same shape as `real_lowered_machines_cost_far_more_than_the_toy_fixtures`: this is deliberately
         // not `ratio < CEILING` (see that test's doc for why), since Step 0 found this machine already
         // over budget before Step 1's change and Step 1 alone does not close the gap.
diff --git a/crates/redextape-core/tests/two_symbol_oracle.rs b/crates/redextape-core/tests/two_symbol_oracle.rs
index 12d48d9..603a618 100644
--- a/crates/redextape-core/tests/two_symbol_oracle.rs
+++ b/crates/redextape-core/tests/two_symbol_oracle.rs
@@ -16,8 +16,8 @@
 #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
 
 use redextape_core::tm::EncodingKind;
-use redextape_core::tm::build::MAX_MACHINE_STATES;
 use redextape_core::tm::machine::{BLANK, Machine, Symbol};
+use redextape_core::tm::reduction::refusal;
 use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, Tape, simulate_final};
 use redextape_core::tm::single_tape::{interleave, layout_collision, normalize, to_single_tape};
 use redextape_core::tm::two_symbol::{Code, bitify, to_two_symbol, unbitify};
@@ -188,7 +188,9 @@ fn the_composed_machine_is_one_tape_over_two_symbols() {
         assert_eq!(canonical.validate(), Vec::<String>::new(), "for {src:?}");
         assert_eq!(canonical.tapes, 1, "one tape, for {src:?}");
         assert_eq!(canonical.alphabet().len(), 2, "two symbols, for {src:?}");
-        assert!(canonical.states.len() < MAX_MACHINE_STATES, "over MAX_MACHINE_STATES for {src:?}");
+        // Not `states.len() < MAX_MACHINE_STATES`: past the ceiling `to_two_symbol` refuses, and a refusal
+        // is one state, so that comparison can no longer fail.
+        assert_eq!(refusal(&canonical), None, "refused for {src:?}");
         println!(
             "{src:40} k={} states={} (from {} single-tape, {} original)",
             code.bits(),
````
<!-- END task4.patch -->

- [ ] **Step 3: Format check and lint** — the commands of Task 1 Step 3. Expected: `fmt exit 0`, `clippy exit 0`.

- [ ] **Step 4: Run the normal-tier tests this task touches**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core --lib tm::reduction tm::single_tape
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core --test two_symbol_oracle
```

Expected summary lines, in order:
- `30 tests run: 30 passed, 817 skipped`
- `6 tests run: 6 passed, 1 skipped`

The three new tests are ignored, so they appear in the skipped count, not the passed count.

- [ ] **Step 5: Run the two text gates** — the commands of Task 1 Step 5.

Expected:
- `checked 484 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `460 files scanned, 0 violations`

- [ ] **Step 6: Run each slow-tier test alone, with its peak RSS**

`/usr/bin/time` is not installed on this machine, so peak RSS comes from `getrusage(RUSAGE_CHILDREN).ru_maxrss`, which is what `time -v` reports. Measured through `cargo test` and through the test binary run directly, the two agreed within 0.05% for every test, so cargo's own footprint does not move the figure.

```bash
block_of maxrss.py >| "$S/maxrss.py"
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo test --release -p redextape-core --lib --no-run 2>&1 | tee "$S/norun.txt" | tail -1
BIN="$P/$(sed -n 's/.*Executable unittests src\/lib.rs (\(.*\))/\1/p' "$S/norun.txt")"
for t in stage_one_refuses_the_worst_shipped_demo_at_the_real_ceiling stage_two_refuses_the_worst_shipped_demo_at_the_real_ceiling the_fold_refuses_the_worst_shipped_demo_at_the_real_ceiling; do
  systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- python3 "$S/maxrss.py" "$BIN" "tm::reduction::tests::$t" --ignored --exact --nocapture 2>&1 | grep -E "test result|MAXRSS"
done
```

`sed` prints the binary path relative to the worktree, hence the `$P/` prefix. Fix the prefix if your cargo prints an absolute path.

<!-- BEGIN maxrss.py -->
```python
import resource, subprocess, sys, time
t = time.monotonic()
rc = subprocess.run(sys.argv[1:]).returncode
print(f"MAXRSS_KB {resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss} ELAPSED_S {time.monotonic() - t:.1f} RC {rc}", file=sys.stderr)
sys.exit(rc)
```
<!-- END maxrss.py -->

Expected: each prints `test result: ok. 1 passed`. The figures:

| test | `MAXRSS_KB` in its doc | re-measured at `3aaaab2`'s tree, two runs | elapsed |
| --- | --- | --- | --- |
| `stage_one_refuses_the_worst_shipped_demo_at_the_real_ceiling` | 744,844 | 744,196 and 744,032 | 1.1–1.2 s |
| `stage_two_refuses_the_worst_shipped_demo_at_the_real_ceiling` | 669,720 | 671,404 and 670,092 | 1.2 s |
| `the_fold_refuses_the_worst_shipped_demo_at_the_real_ceiling` | 718,712 | 718,484 and 718,936 | 1.3 s |

The docs carry the first measurement; the re-runs differ from it by under 0.3%. RSS moves with the allocator and the machine, so a different figure is a measurement to record, not a failure.

- [ ] **Step 7: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Hold the state ceiling at its real value on the largest shipped demo

Three slow-tier tests in reduction.rs lower the largest shipped demo
and assert that each public stage refuses it with too-many-states. The
ceiling tests beside each stage pass their ceiling in by hand, so only
these can see a stage that stopped passing MAX_MACHINE_STATES; they are
three tests because a failed assertion would hide the stages after it.

The demo's source moves into reduction.rs's worst_shipped_demo, shared
with single_tape.rs's measurement test. build.rs's ceiling doc names the
reductions' own choke point, state_cost_probe lists the new copy, and
two_symbol_oracle's `states.len() < MAX_MACHINE_STATES` becomes a
refusal() check, since a one-state refusal passed the old comparison.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

- [ ] **Step 8: Re-run the regression digests on the finished code**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo run --release --example state_guard_digest_probe -p redextape-core >| "$S/digests-after.txt"; echo "exit $?"
diff "$S/digests-before.txt" "$S/digests-after.txt" && echo "DIGESTS IDENTICAL"
```

Expected: `exit 0`, `DIGESTS IDENTICAL`. At `3aaaab2` all 68 rows matched Task 0's, and no reduced machine in the corpus reaches the ceiling, so the guard changes none of them.

- [ ] **Step 9: Run the whole crate's normal tier**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core
```

Expected summary line: `1145 tests run: 1145 passed, 17 skipped`.

At `78ebea6`, before this plan, it was `1131 tests run: 1131 passed, 14 skipped`. The difference is exactly this plan's new tests:
- **14 normal-tier:** 6 in Task 1, 3 in Task 2, 5 in Task 3.
- **3 ignored**, from Task 4.

- [ ] **Step 10: Run the sabotages, restoring after each**

Each edit is an exact-text replacement that must match exactly once, applied by the helper below. After every row, restore with `git -C "$P" checkout -- crates/redextape-core/src/` and confirm `git -C "$P" status --short` shows only the untracked probe.

**The four-module runs carry a 30-second nextest per-test timeout**, from the tool config below, so a sabotage that stops a loop from ending fails instead of hanging the run. None of the rows below times out. The whole normal tier in row S2 runs without it: at 30 seconds, `tm_bank_invariant`'s `the_reg_bank_stays_well_formed_at_width_64_binary` timed out, a test that uses no reduction.

```bash
block_of sab.py >| "$S/sab.py"
block_of nextest-timeout.toml >| "$S/nextest-timeout.toml"
fast() { cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core --lib tm::single_tape tm::two_symbol tm::one_way tm::reduction --no-fail-fast --tool-config-file "timeout:$S/nextest-timeout.toml" 2>&1 | grep -E "^\s+(FAIL|TIMEOUT) \[|Summary|^\s+left:"; }
T1="$P/crates/redextape-core/src/tm/single_tape.rs"; T2="$P/crates/redextape-core/src/tm/two_symbol.rs"; T3="$P/crates/redextape-core/src/tm/one_way.rs"; TR="$P/crates/redextape-core/src/tm/reduction.rs"
```

<!-- BEGIN sab.py -->
```python
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
n = text.count(old)
if n != 1:
    sys.exit(f"SABOTAGE NOT APPLIED: expected exactly 1 match in {path}, found {n}")
open(path, "w").write(text.replace(old, new))
```
<!-- END sab.py -->

<!-- BEGIN nextest-timeout.toml -->
```toml
[profile.default]
slow-timeout = { period = "10s", terminate-after = 3 }
```
<!-- END nextest-timeout.toml -->

The edits, one row at a time, each followed by the restore:

```bash
# S2: to_one_way passes usize::MAX — the WHOLE normal tier without the timeout, then the fold's slow test
python3 "$S/sab.py" "$T3" '    to_one_way_within(m, MAX_MACHINE_STATES).0' '    to_one_way_within(m, usize::MAX).0' && \
( cd "$P" && CARGO_TARGET_DIR="$P/target" systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- cargo nextest run -p redextape-core --no-fail-fast 2>&1 | grep -E "^\s+(FAIL|TIMEOUT) \[|Summary" ) && \
( cd "$P" && CARGO_TARGET_DIR="$P/target" cargo test --release -p redextape-core --lib --no-run >/dev/null 2>&1 ) && \
systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- python3 "$S/maxrss.py" "$BIN" tm::reduction::tests::the_fold_refuses_the_worst_shipped_demo_at_the_real_ceiling --ignored --exact --nocapture 2>&1 | grep -E "left:|right:|test result|MAXRSS"

# S3: delete the pass-through in to_single_tape_within
python3 "$S/sab.py" "$T1" $'pub(crate) fn to_single_tape_within(m: &Machine, ceiling: usize) -> (Machine, usize) {\n    if refusal(m).is_some() {\n        return (m.clone(), 0);\n    }\n' $'pub(crate) fn to_single_tape_within(m: &Machine, ceiling: usize) -> (Machine, usize) {\n' && fast

# S4: refusal() checks only the name
python3 "$S/sab.py" "$TR" $'    if m.start != 0 || m.tapes != 1 || only.accept || !only.rules.is_empty() {\n        return None;\n    }\n' '' && fast

# S5: StateTable::id checks > instead of >=
python3 "$S/sab.py" "$TR" '        if self.states.len() >= self.ceiling {' '        if self.states.len() > self.ceiling {' && fast

# S6a: stage 1 — delete ONLY the check inside the loop; finish's stays
python3 "$S/sab.py" "$T1" $'        b.emit_state(m, StateId::try_from(sid).unwrap_or(0), st);\n        if b.table.overflowed() {\n            return (refused(TOO_MANY_STATES), started_after_trip);\n        }\n' $'        b.emit_state(m, StateId::try_from(sid).unwrap_or(0), st);\n' && fast

# S6b: stage 2 — delete the check inside the loop, its only check
python3 "$S/sab.py" "$T2" $'        b.emit_state(m, code, StateId::try_from(sid).unwrap_or(0), st);\n        if b.table.overflowed() {\n            return (refused(TOO_MANY_STATES), started_after_trip);\n        }\n' $'        b.emit_state(m, code, StateId::try_from(sid).unwrap_or(0), st);\n' && fast

# S6c: the fold — delete the check inside the worklist, its only check
python3 "$S/sab.py" "$T3" $'        b.emit_pair(m, sid, &sides, &mut queue);\n        if b.table.overflowed() {\n            return (refused(TOO_MANY_STATES), started_after_trip);\n        }\n' $'        b.emit_pair(m, sid, &sides, &mut queue);\n' && fast

# S7: Names::pair queues after a trip again
python3 "$S/sab.py" "$T3" '        if !self.table.overflowed() && self.table.get(&name).is_none() {' '        if self.table.get(&name).is_none() {' && fast

# S8: the fold — delete the check before the worklist
python3 "$S/sab.py" "$T3" $'    b.push_rule(pre, preamble);\n    if b.table.overflowed() {\n        return (refused(TOO_MANY_STATES), 0);\n    }\n' $'    b.push_rule(pre, preamble);\n' && fast
```

`$BIN` is the binary path from Step 6. The release build is re-run before the slow test so the binary carries the sabotage; if cargo prints a new hash, re-derive `$BIN` from its `--no-run` output.

Expected, as measured on `3aaaab2`. The clean four-module summary is `70 tests run: 70 passed, 777 skipped`. An every-ceiling test's `left:` is its list of `(fixture, ceiling, size)` that neither refused below the size nor built the machine at it:

| row | sabotage | red | green |
| --- | --- | --- | --- |
| S2 | `to_one_way` passes `usize::MAX` | the fold's slow test: `left: None`, `right: Some("too-many-states")`, `MAXRSS_KB 5348040`, 10.1 s. It built the whole fold inside the 8G cap | **the whole normal tier**: `1145 tests run: 1145 passed, 17 skipped`. This is why the slow tier exists |
| S3 | `to_single_tape_within`'s pass-through | `tm::reduction::tests::a_refusal_survives_every_stage_after_it` and `tm::single_tape::tests::a_refusal_handed_back_in_comes_back_unchanged` — `68 passed, 2 failed` | the rest |
| S4 | `refusal()` checks only the name | `tm::reduction::tests::refusal_checks_the_shape_and_not_only_the_name` — `69 passed, 1 failed` | the rest |
| S5 | `StateTable::id` uses `>` | `tm::reduction::tests::a_state_table_refuses_the_first_new_name_past_its_ceiling`, `tm::one_way::tests::a_tripped_table_queues_no_more_pairs`, and all three every-ceiling tests, each at ceiling `N - 1` on every fixture — `65 passed, 5 failed` | the rest |
| S6a | stage 1's in-loop check | `tm::single_tape::tests::no_original_state_is_started_after_the_ceiling_trips`, `left: 2` — `69 passed, 1 failed` | the rest, stage 1's every-ceiling test included, because `finish` still refuses |
| S6b | stage 2's in-loop check, its only check | `tm::two_symbol::tests::no_original_state_is_started_after_the_ceiling_trips` at `left: None`, and `tm::two_symbol::tests::every_ceiling_below_the_image_size_refuses_and_the_image_size_builds_it` at every ceiling below every fixture's size — `68 passed, 2 failed` | the rest |
| S6c | the fold's in-loop check | `tm::one_way::tests::no_worklist_item_is_started_after_the_ceiling_trips` at `left: None`, and `tm::one_way::tests::every_ceiling_below_the_fold_size_refuses_and_the_fold_size_builds_it` at every ceiling from 2 to one below each fixture's size — `68 passed, 2 failed`; nothing times out | the rest |
| S7 | `Names::pair` queues after a trip | `tm::one_way::tests::a_tripped_table_queues_no_more_pairs`, `left: 3` — `69 passed, 1 failed` | the rest |
| S8 | the fold's check before the worklist | `tm::one_way::tests::every_ceiling_below_the_fold_size_refuses_and_the_fold_size_builds_it`, `left: [(0, 0, 3), (1, 0, 4), (2, 0, 16)]` — `69 passed, 1 failed` | the rest |

**Findings.**
- **S8 names ceiling 0 on each fixture and no other ceiling.** A ceiling of 1 does not escape without the check before the worklist: the start pair is queued before its own name trips the table, and the check after that item refuses.
- **S6b and S6c do not redden on the count.** Stage 2 and the fold have no final check, so without the check inside the loop the machine comes back unrefused and the count test stops at its refusal assertion. Only in stage 1, whose `finish` still refuses, does the count test alone see the deletion. In S6c the fold's ceilings 0 and 1 stay refused, by the check before the worklist.
- **S6c does not hang**, because `Names::pair` queues nothing after a trip.

- [ ] **Step 11: Delete the probe**

```bash
rm "$P/crates/redextape-core/examples/state_guard_digest_probe.rs" && git -C "$P" status --short
```

Expected: `git status --short` prints nothing for `crates/`.

---

## Spec corrections found while planning

**The spec now carries every item below.** `docs/superpowers/specs/2026-09-14-reduction-state-guard-design.md` holds them as uncommitted changes in the `reduction-state-guard` worktree, with false passages deleted rather than restated where possible. This section records what building the code found, and why each change was made.

1. **`StateTable` needs `get`, not `contains`.**
   - The spec listed `contains(&self, name)`, citing `one_way.rs`'s `ids.contains_key`. It missed `two_symbol.rs`'s `Names::finish`, which reads the entry state's id through `ids.get(..).copied()` rather than testing membership.
   - One `get(&self, name) -> Option<StateId>` serves both uses: `pair` calls `get(..).is_none()`.
   - It arrives with its first caller in Task 2, because clippy `-D warnings` rejects a `pub(crate)` method nothing calls.
2. **The spec did not mention `states_per_original`, and the guard broke stage 1's.**
   - It returned a bare `f64`, so once `to_single_tape` refuses the largest shipped demo it would report a ratio of 1/49,135. `the_worst_shipped_demo_measured_directly` asserts only `ratio.is_finite() && ratio > 0.0`, so it would stay green while measuring a refusal.
   - All three `states_per_original` now return `None` for any refusal, checked with `refusal()` on the built machine.
   - No other file calls any of the three: `git grep -n states_per_original 4179ff6 -- . ':!crates/redextape-core/src/tm/single_tape.rs' ':!crates/redextape-core/src/tm/two_symbol.rs' ':!crates/redextape-core/src/tm/one_way.rs' ':!docs'` prints nothing.
3. **The spec's sweep list missed five sentences or assertions this branch makes false**, each fixed in the task named:
   - `two_symbol_oracle.rs`'s `canonical.states.len() < MAX_MACHINE_STATES`, which a one-state refusal passes (Task 4)
   - `two_symbol.rs`'s three citations of "`single_tape.rs`'s `refused`" (Task 1)
   - `two_symbol.rs`'s `emit_candidate` comment naming `to_two_symbol`'s loop (Task 2)
   - `one_way.rs`'s `STATE_CEILING` doc on the 7,363,253-state fold (Task 3)
   - `state_cost_probe.rs`'s list of demo copies (Task 4)
4. **The check inside each loop was held by no test.** The spec said it "stops the work, not just the answer", but its sabotage table only deleted it together with the final check. Deleted alone in stage 1 at `5bd0f05`, before the count existed, it reddened nothing; stage 1's slow test passed at `MAXRSS_KB 1045872` against 744,844 with the check.
   - Each `_within` now returns a count of work begun after the trip, and one fast test per stage holds it at 0 (rows S6a–S6c).
5. **In the fold, that check was what made the worklist end.** A refused name is never recorded, and `Names::pair` re-queued it every time it was named, so with the check deleted two tests timed out rather than failing. `Names::pair` now queues nothing once the table has tripped, `a_tripped_table_queues_no_more_pairs` holds that (row S7), and the same deletion now fails without a timeout.
6. **Stage 2's final check and the fold's could not fire while the in-loop checks existed, and are deleted.** The spec justified a final check by stage 1's `finish` alone, which creates states; the other two create none after their loops. Each loop carries a comment saying why.
7. **Deleting the fold's final check left a ceiling of 0 unrefused.** Once `Names::pair` stops queueing after a trip, a ceiling of 0 trips on `pre` before the start pair is queued, and the fold returned an empty, unrefused machine that no test saw. A check before the worklist now refuses it, and with that check deleted the fold's every-ceiling test names exactly that ceiling on each fixture (row S8). A ceiling of 1 did not escape: its start pair is queued before its own name trips the table.
8. **The boundary tests could not see that escape.** Each tried two ceilings, `N` and `N - 1`. They are replaced, on the same fixtures, by tests of every ceiling from 0 to `N` that report every failing ceiling.
9. **S3 reddens one more test than the spec predicted.** The spec expected "the composition test through stage 1". Measured, S3 also reddens `single_tape.rs`'s own `a_refusal_handed_back_in_comes_back_unchanged`, a test the spec's testing list asks for but its sabotage table did not name.
10. **The spec's reason for the slow tier does not cover a test that already exists.**
   - The spec puts the real-ceiling trips in the slow tier because they allocate a ceiling's worth of states: 669,720–744,844 KB each, measured.
   - `the_worst_shipped_demo_measured_directly` runs in the normal tier at `78ebea6`, building the unguarded image its doc records at 1,811,054 states, and still does. This plan leaves its tier alone, and its peak RSS was not measured.
11. **"Share that test's copy of the source" was not possible as written.** The copy was a `const` local to one test function. The source now lives in `reduction.rs`'s `#[cfg(test)] pub(crate) fn worst_shipped_demo()`, which that test and the three slow-tier tests call.

## Left for the controller

- **Stage 3's roadmap bullet** ("`to_one_way` has no `MAX_MACHINE_STATES` guard of its own; neither do the two earlier stages") is a sentence this branch makes false. It belongs to the roadmap entry, which this plan does not write.
- **The spec's corrections are uncommitted** in the `reduction-state-guard` worktree, beside this untracked plan.
- **The scratch worktree** `.claude/worktrees/state-guard-scratch` holds four branches:
  - `state-guard-scratch-4`: the four commits this plan embeds.
  - `state-guard-scratch-3` (`46fe2d2`), `state-guard-scratch-2` (`c155930`) and `state-guard-scratch` (`5bd0f05`): earlier versions, superseded.

  All four, and the untracked probe there, can be deleted without losing anything this plan does not embed.
