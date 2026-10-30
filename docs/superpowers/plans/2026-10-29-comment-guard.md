# The comment guard — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** `scripts/check-comments.mjs`, a fork of taiyaku's comment guard, runs as redextape's 14th pre-commit
hook and in CI's `linear-history` job, with the rules in `docs/superpowers/specs/2026-10-29-comment-guard-design.md`.

**Architecture:** taiyaku's script at `af694710` is copied verbatim, then changed in place, one rule or lexer per
task, each with its self-test cases. The budget file is re-derived whenever a task changes what is measured. CI
chooses the base in shell and passes it as `--base`.

**Tech stack:** node (no packages; `node:` built-ins only) and git. The source is
`git -C /home/davey/projects/taiyaku show af694710:scripts/check-comments.mjs`, also saved at
`/home/davey/temp/redextape-comment-guard-record/taiyaku-check-comments.mjs`. Taiyaku's prose for the rules is
the section "The comment guard" of `git -C /home/davey/projects/taiyaku show af694710:docs/ci.md`, saved beside
it as `taiyaku-ci.md`.

## Global constraints

- The spec is the authority. Where this plan and the spec disagree, the spec wins; report the disagreement.
- Node features no newer than node 16.9 (`Object.hasOwn` is the newest the source uses). No npm packages.
- The script's own comments follow the house rule: the why, never history or measurements. From Task 5 on the
  guard judges itself on every commit.
- No `file:line` citation in tracked source, self-test strings included (`scripts/check-citations.sh`). In
  `docs/` they are fine.
- Every commit passes the pre-commit hooks. Never `--no-verify`.
- Sabotages and replays run in a scratch clone (`git clone --local` into the record dir), never in
  `/home/davey/projects/redextape` and never in a worktree of it. Restore a sabotaged file from a saved copy and
  `cmp` it; do not use `git checkout` to restore.
- The Bash tool is zsh: `noclobber` is on, so write logs with `>|`. Run long commands into a log under
  `/home/davey/temp/redextape-comment-guard-record/` and read the summary lines.
- Do not change anything in `/home/davey/projects/taiyaku`.
- Commit messages are one sentence saying what the commit makes true (see `git log --oneline -10`).
- Do not dispatch subagents.

## Files

| File | Task | What it is |
|---|---|---|
| `scripts/check-comments.mjs` | 1–4 | the guard |
| `scripts/comment-budget.json` | 1, 3, 5 | `{"<area>": <share to 4 dp>}` for exactly the 15 areas |
| `.pre-commit-config.yaml` | 5 | the `check-comments` hook |
| `.forgejo/workflows/ci.yml` | 5 | two steps in `linear-history` |
| `README.md` | 5 | the "Checks" section's hook paragraph |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | 6 | the PR's roadmap entry |

---

### Task 1: The fork, with redextape's settings

The script runs on redextape with taiyaku's rules unchanged. Only settings and taiyaku-specific cases change.

**Files:** create `scripts/check-comments.mjs` and `scripts/comment-budget.json`.

- [ ] Copy taiyaku's script verbatim and commit nothing yet. Run `node scripts/check-comments.mjs --self-test`
      once to see which cases are taiyaku-specific.
- [ ] Change the settings. The record's `inventory.md` §1 lists each taiyaku-specific line range:
  - the header's pointer (`docs/ci.md`, "The comment guard") names the spec's path instead;
  - `langOf`: every `.yml`/`.yaml` file and `.toml` take the `hash` lexer, and so does a file named
    `nginx.conf`; the `Dockerfile` keeps it. Nothing under `docs/` is read, whatever its type;
  - `AREAS` is `web/src`, `web/tests`, `web/scripts`, `scripts`, `grammars` and `.forgejo`, and every
    `crates/<name>` stays an area through the existing pattern;
  - `readBudget`/`judgeShares`: an entry for an area the tree does not have fails, and so does an area the file
    leaves out (taiyaku fails only the second);
  - the rule-1 failure text names redextape's pointers: "Move the history to a docs/superpowers/notes/ file or
    drop it, or point at a spec §, a notes file or an issue #N."
- [ ] Rewrite the taiyaku-specific cases (`LANG_CASES`, the O-number history cases, any case naming a taiyaku
      path) with redextape paths and redextape wording, keeping each case's purpose. Add: an `.toml`, a
      non-workflow `.yml` and an `nginx.conf` lex as hash; a `.ts` under `docs/` is not read; the two budget
      failures above. Reword the expected message that reads as a citation (`new.ts:1`).
- [ ] Write `scripts/comment-budget.json` from the tree at the branch's head: with `{}`, every area fails with
      its share in the message (the record's C3); write those values.
- [ ] Prove it:
  - `node scripts/check-comments.mjs --self-test` passes;
  - `node scripts/check-comments.mjs` exits 0 on the branch, and its two summary lines name 15 areas;
  - `pre-commit run --files scripts/check-comments.mjs scripts/comment-budget.json` passes, every hook
    `Passed` or `Skipped`.
- [ ] Commit both files.

### Task 2: Rule 1, retuned

**Files:** `scripts/check-comments.mjs`: `HISTORY`, `historyMarker`, `HISTORY_CASES` and the change cases that
exercise rule 1.

- [ ] Replace `HISTORY` with this table, which was run against the cases below and against all 36 single-line
      dated pointers on `main` at `7da611b` (none hit). Drop the CSS skip in `historyMarker`, whose label no
      longer exists, and keep the tilde-fence skip.

```js
// Each pattern is a way a comment tells history. Allowed by omission: a bare
// `#N`, which points at an issue's or a pull request's record, and the word
// `PR`, which this repository's CI comments use for the event. A date passes in
// a file name, after a ruling or a decision, before a `§`, or after `amended`
// or `note of` once a `§` has been named, since there it is the pointer's key.
const HISTORY = [
  ['a date', /(?<![\w-])(?<!\brulings? (?:of )?)(?<!\bdecisions?(?:,|\s+of)\s+(?:\d{4}-\d\d-\d\d(?:,|\s+and)\s+)*)(?<!§.*\b(?:amended|note\s+of)\s+(?:\d{4}-\d\d-\d\d(?:,|\s+and)\s+)*)\d{4}-[01]\d-[0-3]\d(?![\w-]|\.\w|,?\s*§)/g],
  ['a commit hash', /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g],
  ['a pull request', /\b(?:PR|[Pp]ull [Rr]equest)\s*#?\d+\b/g],
  ['"previously"', /\bpreviously\b(?!-)/gi],
  ['"originally"', /\boriginally\b/gi],
  ['"formerly"', /\bformerly\b/gi],
  ['a fix', /\bbefore (?:this|the) (?:fix|change)\b/gi],
  ['struck-out text', /~~/g],
]
```

- [ ] Cases, each `[comment, expected label or null, before-line?]`. The probe that ran them is
      `/home/davey/temp/redextape-comment-guard-record/probe-history.mjs` (29 of 29 pass), run as
      `node probe-history.mjs dated-pointers.txt` in that directory:
  - fail: `// slice (PR #25):`, `// PR #20's whole point was a palette`, `// is what PR 1 of this slice
    recorded`, `// shipped in pull request #212`, `// Previously this read the cache`, `// measured on
    2026-10-28`, `# EMPTY ON 2026-10-27, A MEASUREMENT`, ``// fills at 69,008 on `047b0dd` ``, `// amended
    2026-10-01 for the order` (no `§`), `// a note of 2026-10-01 says` (no `§`), `// a decision was made on
    2026-10-04 to`, `// spec §5.3 holds. Measured 2026-10-01 and 2026-10-03`;
  - pass: `// what a docs-only PR needs from this job`, `// never on a PR`, `// #99's rule, since a body`,
    `// which is the fate #28 records`, ``// (`li\tr0, #40`)``, `// the previously-focused pane`,
    `// (the user's decision, 2026-10-11): the views`, `// (the user's decisions of 2026-10-05)`,
    `// (the user's decisions, 2026-10-05 and 2026-10-06)`, `// (spec §5.3, amended 2026-10-01).`,
    `// (spec §5.3, amended 2026-10-01, 2026-10-03)`, `// (spec §5.4's note of 2026-10-01).`, and the wrapped
    `// 2026-10-04) set the order` after `// (the user's decision,` and `// 2026-10-01).` after
    `// (spec §5.3, amended`;
  - keep taiyaku's file-name, ruling, `§`-wrap, `no longer`, non-hash and tilde-fence cases; delete the
    `used to`, `was tried` and CSS-colour cases, and flip `/* the rule draws in #808080 grey */` in `ts` to pass.
- [ ] Prove it, beyond the self-test: in a scratch clone at `7da611b` with the Task 2 script and budget excluded
      through `.git/info/exclude`, run the record's C5 ("every line on main as added", base an empty-tree
      commit). Expected rule-1 hits, from `inventory.md` §3b: the 3 real dates (`.cargo/config.toml`,
      `deny.toml`, `web/tests/browser/share-link.test.ts`), `PR #20` (`web/src/style.css`), `PR #25`
      (`web/src/session-client.ts`), the quoted `PR 3` in `scripts/check-doc-figures.sh`'s header, and the 7
      hashes. List every hit with a verdict; a hit outside that list is a finding to explain, not to match.
- [ ] Commit.

### Task 3: The new lexers

**Files:** `scripts/check-comments.mjs`: `LANGS`, `langOf`, the lexers, `LEXERS`, `LEAD`, `MARKER`,
`headerOf`, `LEXER_CASES`, `LANG_CASES`; `scripts/comment-budget.json`.

- [ ] Generalise `lexHash` to a whole-line lexer made from its opener: `#` (the shebang skip stays `#`-only),
      `;` for `.scm` and `--` for `.lua`. Only a line whose first non-blank characters are the opener is a
      comment.
- [ ] Add an `html` lexer for `.html`: `<!--` to the next `-->` is a comment; the body of each inline
      `<script>` element (between its opening tag's `>` and `</script>`) is lexed by `lexTs` and each `<style>`
      body by `lexCss`, with their spans shifted to the file's offsets; everything else is code. The spans
      must tile the text exactly, as `segments` requires.
- [ ] `LEAD` (rule 1's delimiter strip) and `MARKER` (rule 2's delimiter-only test) learn `;` runs, `--`,
      `<!--` and, for `MARKER`, `-->`. In `headerOf`, every language other than `rust` and `ts` takes the first
      block as its header whatever follows, as `hash` and `css` do.
- [ ] Cases: per new lexer, a comment line, a code line holding the opener mid-line (`(x) ; y`, `f("--")`),
      and an indented comment. For HTML, `<!-- a -->` on one line and across three, an inline script with a
      `//` comment and a string holding `<!--`, and a `<script src=…></script>` with no body. A delimiter-only
      line is not counted (`;;`, `--`, `-->`). `langOf` gives nothing for `grammars/x/src/parser.c`,
      `grammars/x/src/tree_sitter/parser.h`, an `.rxt`, a `.tm`, an `.asm` and a `.md`.
- [ ] Re-derive `scripts/comment-budget.json` (`.scm` lands in `grammars`, the `.html` pages and the Lua in no
      area, so `grammars` is the share expected to move). Say which shares moved and by how much.
- [ ] Prove it: self-test; the scan exits 0; `pre-commit run --files` on both files.
- [ ] Commit.

### Task 4: The moved block

**Files:** `scripts/check-comments.mjs`: `judgeChanges`, `blockFailures`, `CHANGE_CASES`.

The rule is the spec's ("Rule 2", "One addition: a moved block"). It is new, so its shape is given here.

- [ ] `judgeChanges` keeps each file's old blocks (`commentBlocks(old, …).blocks`, beside the `oldCounted` it
      keeps now). A **removed block** is an old block of at least one counted line, every counted line of which
      the file's hunks remove (`removedLines`). Collect them across all files.
- [ ] `blockFailures` first collects its **grown** blocks (size over `BLOCK_CAP` and `added > cut`, the current
      test) instead of failing them at once. Grown and removed entries are both `{ path, start, end, size,
      words }`, with `words` from `blockWords` over the new or the old side. Then:

```js
// Distinct words of a block's counted lines. A reworded move keeps most of
// them, which an exact-text carry cannot see.
function blockWords(info, counted, start, end) {
  const words = new Set()
  for (let k = start; k <= end; k += 1) {
    if (!counted[k]) continue
    for (const [w] of info[k].comment.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) words.add(w)
  }
  return words
}

// Pairs each grown block with the removed block that shares the most of its
// words, at least half, each removed block taken once. A matched block fails
// only if it is longer than the block it replaced, so a match never lets the
// over-cap lines grow.
function matchMoves(grown, removed) {
  const pairs = []
  for (const g of grown) {
    for (const r of removed) {
      let shared = 0
      for (const w of g.words) if (r.words.has(w)) shared += 1
      const share = g.words.size === 0 ? 0 : shared / g.words.size
      if (share >= 0.5) pairs.push({ g, r, share })
    }
  }
  pairs.sort((a, b) => b.share - a.share || a.g.path.localeCompare(b.g.path) || a.g.start - b.g.start)
  const from = new Map()
  const used = new Set()
  for (const { g, r } of pairs) {
    if (from.has(g) || used.has(r)) continue
    from.set(g, r)
    used.add(r)
  }
  return from
}
```

- [ ] A grown block with no match fails with taiyaku's message. A matched one fails only when its size is above
      the removed block's, and its message names where it moved from and that block's counted lines, in the
      form `…, moved from <path> lines <a>-<b>, which had <n> counted lines`. It passes when its size is at
      most the removed block's.
- [ ] Cases in `CHANGE_CASES`: a 12-line block moved within a file and reworded (passes); the same moved to
      another file (passes); moved and grown to 14 from 12 (fails, naming the source); a near miss, a new
      12-line block sharing under half its words with a removed one (fails as new); two new blocks that both
      match one removed block (one passes, the other fails as new); a block rewritten in place and grown (fails,
      as today).
- [ ] Prove it on the two real moves, in a scratch clone with the script excluded: at `fc0a8e7` with
      `--base fc0a8e7^`, `web/src/pane-host.ts`'s block from line 182 no longer fails; at `4687e79` with
      `--base 4687e79^`, `scripts/check-all.sh`'s block from line 423 no longer fails. Then sabotage
      `matchMoves` to return an empty map (saved copy, restore, `cmp`) and see both fail again.
- [ ] Commit.

### Task 5: Wiring

**Files:** `.pre-commit-config.yaml`, `.forgejo/workflows/ci.yml`, `README.md`, `scripts/comment-budget.json`.

- [ ] The hook goes after `check-licences`, as an unscoped hook like it: `id: check-comments`, a lower-case
      `name` in the house style, `entry: bash -c 'node scripts/check-comments.mjs --self-test && node
      scripts/check-comments.mjs'`, `language: system`, `always_run: true`, `pass_filenames: false`, and a
      comment above it of 8 lines or fewer saying why it is unscoped (it judges the whole branch against its
      merge base, so what it reads is not the staged set).
- [ ] Two steps in `linear-history`, after the other hygiene pairs. The base logic mirrors the `Reject merge
      commits` step's fallback:

```yaml
      - name: Comment guard (self-test)
        run: node --version && node scripts/check-comments.mjs --self-test
      - name: Comment guard
        env:
          EVENT: ${{ github.event_name }}
          REF: ${{ github.ref }}
          PR_BASE: ${{ github.event.pull_request.base.sha }}
          BEFORE: ${{ github.event.before }}
        run: |
          set -eu
          case "$EVENT" in
            pull_request) base="$PR_BASE" ;;
            push)
              if [ "$REF" != refs/heads/main ]; then
                base=HEAD
              elif [ -n "${BEFORE:-}" ] && [ "$BEFORE" != "0000000000000000000000000000000000000000" ] \
                   && git cat-file -e "$BEFORE^{commit}" 2>/dev/null; then
                base="$BEFORE"
              else
                base=HEAD~1
              fi ;;
            *) base=HEAD ;;
          esac
          echo "comment guard base: $base"
          node scripts/check-comments.mjs --base "$base"
```

      An empty `PR_BASE` reaches the script as `--base ''`, which it refuses with exit 2: no base fails. Add a
      comment over the steps of 8 lines or fewer on why the base is passed explicitly (on a push, `origin/main`
      is `HEAD`).
- [ ] Prove the step's shell: extract its `run:` text with `python3 -c` and `yaml.safe_load`, and run it in a
      scratch clone with a stub `node` on `PATH` that prints its arguments, under: `pull_request` with a SHA;
      `pull_request` with `PR_BASE` empty; `push` to main with a real `BEFORE`, with forty zeros, with empty,
      and with an unknown SHA; a `v1` tag push; `schedule`; `workflow_dispatch`. Then run the real script with
      `--base HEAD` and `--base HEAD~1` in the clone and see both exit as expected. Check the CI image's node:
      `docker run --rm catthehacker/ubuntu:act-latest node --version` if docker is available; otherwise say the
      first CI run's log answers it.
- [ ] README "Checks": `thirteen` becomes `fourteen` in both places, "the other eight" unscoped hooks become
      nine with `check-comments` listed and described in one sentence (what it fails, that it judges the branch
      against its merge base, that the spec holds the rules), and the paragraph's "newest of the eight" follows.
      A cost figure, if given, names its command and date. Run `scripts/check-doc-figures.sh --self-test &&
      scripts/check-doc-figures.sh`.
- [ ] The `ci.yml` comments move `.forgejo`'s share: re-derive its budget in the same commit. From this commit on
      the hook holds every commit to the budget.
- [ ] Prove it: `pre-commit run --all-files >| /home/davey/temp/redextape-comment-guard-record/task5-all-files.log
      2>&1`, exit 0, every hook `Passed` or `Skipped`.
- [ ] Commit.

### Task 6: The proof and the roadmap entry

**Files:** `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`; the rest is in the record dir.

- [ ] **Sabotages,** in a scratch clone of the branch's head, one branch each off it, each run with
      `--base` the head: add `// measured on 2026-10-28` to a `.ts` comment (rule 1); add a ninth counted line
      to an 8-line block (rule 2); add enough comment lines to `web/scripts`, in blocks of 8 or fewer, to lift
      its share by at least 0.0001 at 4 decimals, without touching the budget (rule 3; work out the count from
      the area's line totals first, since a share rounds to 4 decimals and a line or two may not move it); and
      remove comment lines from an area until it is more than 0.0050 under budget (the stale arm). Each must
      exit 1 with its own message. Record the four outputs.
- [ ] **The replay,** as the record's C6 with the branch's script excluded in the clone: rules 1 and 2 over the
      10 squash commits `7da611b`, `7f675a5`, `b3fe23d`, `6c9ad92`, `dec47bb`, `47c8a40`, `349ac8c`,
      `bdd977d`, `fc0a8e7`, `4687e79`, each with `--base <commit>^`, counting only rule-1 and rule-2 lines. Put
      the table beside `inventory.md` §3d's. The spec's "How the port is proven" item 3 lists what must be gone
      and what must still fail; every remaining failure gets a verdict.
- [ ] **The gates** at the head: `pre-commit run --all-files` and `scripts/check-doc-figures.sh`.
- [ ] **The roadmap entry,** after the last code commit, in the house shape (read the latest entry first): what
      the guard does, the six rulings, the verification figures each with its command, and what it does not
      close (the 1,316 over-cap blocks; carrying the move rule back to taiyaku).
- [ ] Commit the entry.

## After the plan

The controller writes the PR body from the roadmap entry and opens the PR only on the user's yes. The CI run on
the PR proves the pull-request arm (its log names the base). The push run on `main` after the merge proves the
push arm and the CI image's node.
