# The comment guard — design

The user's request (2026-10-29): port taiyaku's comment guard to redextape. Redextape's comment pass (#144–#147)
left its comments holding the why. History and measurements went to the notes files or were dropped. The guard
keeps them from growing back. It fails a branch that adds history to a comment, grows a comment block past 8
lines of text, or raises an area's comment share above its budget.

The source is taiyaku's #215 (`af694710`): `scripts/check-comments.mjs` and `scripts/comment-budget.json`.
Redextape takes a fork of that script, not a shared copy (the user's decision). Its lexers, its diff and carry
logic, its base resolution and most of its self-test are taiyaku's. Taiyaku's settings and test cases are
replaced by what this design gives.

This file is the guard's documentation. The script's header and the README's "Checks" section point here.

## Rule 1: history

A comment on a line the branch adds fails when it tells history. A line whose comment text the diff also removes
somewhere (a move, a re-indent) is carried, not added. Each pattern reads the line between its neighbouring
comment lines, so a pointer wrapped across two lines is seen whole, and only a hit that starts on the line itself
counts.

| Marker | Fails | Passes |
|---|---|---|
| a date `YYYY-MM-DD` | any date the next column does not pass, among them one followed by `T` and a digit, a timestamp (`2026-10-28T09:00`) | one in a file name (`2026-10-28-notes.md`); one after `ruling(s)` or `ruling(s) of`; one followed by a `§`; one after `decision` or `decisions`, with a comma, with `of` or with neither (`the user's decision, 2026-10-11`); one after `amended` or `note of` when a `§` comes before it on the joined line (`spec §5.3, amended 2026-10-01`, `§2's note of 2026-10-03`); the words in any case, and a list of dates (`decisions, 2026-10-05 and 2026-10-06`) passing whole |
| a commit hash | 7–40 lowercase hex digits holding both a digit and a letter | |
| a pull request | `PR #N`, `PR N`, `pull request #N`, `pull request N`, their plurals (`PRs #12 and #13`), and each with a lowercase letter after its number (`PR 3c`); `pull request` in any case (`PULL REQUEST #12`), `PR` in capitals | a bare `#N`, which points at an issue's or a pull request's record, and so one inside backticks too (asm and TM syntax: `` `li r0, #40` ``); the bare word `PR`; a lowercase `pr`, which names a variable (`pr 2`) |
| `previously` | `previously` | `previously-` as an adjective (`previously-focused`) |
| `originally`, `formerly` | the word | |
| a fix | `before this fix`, `before the change` | |
| struck-out text | `~~` | a line of tildes that fences code in a doc comment |

**Dropped from taiyaku's list:** the bare word `PR`, `was tried`/`were tried` and `used to`. The measure is the
one taiyaku tuned its list by: a pattern more than one in five of whose sampled hits are legitimate comments is
narrowed or dropped. Measured on redextape `main` at `7da611b`, by running the guard's history rule over every
existing comment line as if it were added:

- the word `PR`: 39 of 40 hits were legitimate, 38 of them about CI ("a docs-only PR");
- `used to`: 13 of 13 (purpose, "Used to recover …", or runtime state);
- `was/were tried`: 4 of 4 (the TM width search);
- `previously`: 3 of 3, all the hyphenated adjective, hence the narrowing.

**The commit hash is kept although it crosses that measure:** 2 of its 7 hits were legitimate, a toolchain pin
(`b940084d7`) and a placeholder (`abc1234`). The other 5 are real history, where the dropped patterns found
none, and a hash names a commit, which is history whatever the sentence around it says.

**The bare `#N` passes** (the user's decision). Redextape's house rule lets a comment point at an issue number,
and Forgejo numbers issues and pull requests in one series. Of the 8 `#N` comment lines on `main` at `7da611b`,
7 point at a recorded reason (`#99's rule`, `#28 records …`, `#30's`) and pass. One tells which change built the
code (`slice (PR #25)`) and fails. `PR #20's whole point` in `web/src/style.css` fails too.

**The dated pointers pass** (the user's decision): the 22 spec-amendment pointers on `main` at `7da611b`, and the
17 of its 21 decision pointers that name the decision with the word (`the user's decision, DATE`). Their date says
which decision or amendment, so it is the pointer's key. The other 4 say it otherwise (`The user chose this on
DATE`, `THE USER'S RULE FOR … (DATE)`) and fail when a branch adds them. The user kept the one phrasing (the
user's decision, 2026-10-29), so such a line is reworded to `the user's decision, DATE` when a branch edits it.

A failure names the file, the line, the marker and the text it matched, and says a comment holds the why: move
the history to a `docs/superpowers/notes/` file or drop it, or point at a spec `§`, a notes file or an issue
`#N`. Rules 1 and 2 have no allow-list.

## Rule 2: the block cap

Taiyaku's rule, unchanged (the user's decision). A block is a maximal run of whole-line comments. A blank line
inside a block comment continues it, and a blank line between line comments ends it. A line counts when it
holds text: a line that is only a delimiter (`/**`, `*/`, a bare `//`) does not. A block fails when it has more
than **8** counted lines and the branch grew it: the counted lines added inside it outnumber the counted lines
removed by the hunks that touch it. A new 9-line block fails. Trimming a 20-line block to 12, or rewording its
lines one for one, passes. Adding a line to it fails.

**Not counted:** in a doc comment (Rust `///`, `//!`, `/** */`, `/*! */`; TypeScript `/** */`), fenced code
between two fence lines and an `# Errors`, `# Panics`, `# Safety` or `# Examples` section up to the next
heading; Rust `//!` module docs; a file's leading header. The header is the file's first block, when only a
shebang and blank lines come before it. In Rust, TypeScript and JavaScript a blank line or an import must also
follow it.

**One addition: a moved block.** Taiyaku's count carries an added line only when its exact text is removed
somewhere, so a block that is moved and reworded reads as grown by every reworded line. The fork matches each
block the branch grew with a removed run: a maximal run of counted lines inside one block at the base, all of
which the diff removes, in any file, leaving out the runs that hunks touching the grown block remove (those
already count as its trims). They match when the words they share are at least half of the larger one's
distinct words, so a small block cannot match a large removal by holding a few of its words. Words are
lowercased runs of letters and digits. Each removed run matches at most one grown block, taken greedily by the
highest share. A matched block fails only when it has more than 8 counted lines and more counted lines than the
run it replaced, so a matched block passes only when it is no longer than the text it replaced. A run continues
through the block's lines the cap does not count (a doc comment's delimiter-only ` *`, fenced code, an exempt
section), which neither count nor end it. The replay below found two such moves (`web/src/pane-host.ts` in #147,
`scripts/check-all.sh` in #146), each shorter after the move, which taiyaku's count fails as grown by 21 and 10
lines. A run, not a whole block, is matched because each of those two sources ran straight into a comment that
stayed; the larger word count divides because, with the grown block's alone, three unrelated blocks in #147 matched
large removals elsewhere (a 10-line test doc against a 133-line coverage block). Measured over #146 and #147, the
rule as written passes those two moves and one same-file move in `ts_derive_scan.rs`, and no other block (the
user's decision, 2026-10-29).

On `main` at `7da611b`, 1,316 of the 12,916 blocks with a counted line are over the cap (measured before the
`.scm`, `.lua` and `.html` lexers existed). Rule 2 judges only what a branch adds, so they stand until someone
grows them.

## Rule 3: the comment share

For each area the share is comment lines ÷ (comment lines + code lines), with blank lines counting as neither.
It is compared with `scripts/comment-budget.json` to 4 decimals. A share above its budget fails. A share more
than 0.0050 below its budget also fails, as stale, when the branch has fewer comment lines in that area than its
base had, so a trim keeps its gain. The exact budget is the user's decision. Of the 10 pull requests up to and
including `7da611b`, the 8 outside the comment pass were measured: 5 raised a share, by between 0.0001 and
0.0084, and each would have carried a budget edit. Two pull requests that each add comments to one area can each pass
on its own base and together exceed the area's budget once both land; `main`'s `block_on_outdated_branch`
branch-protection setting is what stops that, since it makes the later one rebase and re-run before it merges.

**Areas (15):** each crate under `crates/` (nine today, matched by pattern, so a new crate is an area), `web/src`,
`web/tests`, `web/scripts`, `scripts`, `grammars` and `.forgejo`. A file outside every area (the root
`Cargo.toml`, `deny.toml`, `clippy.toml`, `.cargo/config.toml`, `.pre-commit-config.yaml`, `Dockerfile`,
`docker-compose.yml`, `deploy/nginx.conf`, `plugin/redextape.lua`, `web/vite.config.ts`, `web/*.html`) is judged
by rules 1 and 2 and has no budget. The budget file must name exactly these areas. An area it leaves out fails,
and so does an entry for an area that does not exist.

**Raising a budget, deliberately.** A branch whose new comments earn their place raises its area's budget in the
same diff, to the value the failure gives. A branch that trims writes the lower value the stale failure gives. A
budget is never raised to leave room for later. The guard's own branch writes every budget from the tree at its
head.

## What it reads

| Files | Lexer |
|---|---|
| `.rs` | Rust |
| `.ts`, `.js` (the grammars' `grammar.js`), `.mjs` (the guard itself), `.tsx` (none in the tree; taiyaku's JSX handling is kept) | TypeScript |
| `.css` | CSS |
| `.html` | HTML (new): `<!-- -->` is a comment; each inline `<script>` body goes to the TypeScript lexer and each `<style>` body to the CSS lexer |
| `.sh`, `Dockerfile`, every `.yml`/`.yaml`, `.toml`, `deploy/nginx.conf` | whole-line `#` |
| `.scm` (the tree-sitter queries) | whole-line `;` (new) |
| `.lua` | whole-line `--` (new) |

A lexer splits a file into comment, string and code before any rule reads it, so a `//` in a string or a URL is
not a comment. In the whole-line lexers only a line whose first non-blank characters open a comment is a
comment.

**Not read:** Markdown and everything under `docs/`; the generated tree-sitter sources (`grammars/*/src/parser.c`
and the `src/tree_sitter/*.h` beside them); the `.rxt`, `.tm` and `.asm` fixtures; any other type.

**What it does not see**, carried from taiyaku and true of the fork:

- A trailing comment in a whole-line lexer (`true # see …`) is code, so rules 1 and 2 never judge it.
- A whole-line `#` inside a shell heredoc reads as a comment.
- Two old blocks joined by deleting the code between them make one longer block that no added line grew, so it
  passes.
- A blank line ends a block, so two 8-line paragraphs with a blank line between them pass.
- History told in words the patterns do not list.
- One removed text can be credited twice. Taiyaku's carry lets two verbatim copies of a removed block both
  pass, and the fork's move match adds a reworded copy: a run that one block's trim or verbatim carry used can
  still match a reworded copy elsewhere, so a block reworded in place and copied reworded elsewhere passes
  both.

And of the fork's own lexers:

- A Lua `--[[ … ]]` block comment is a comment on its opening line only; the lines inside it read as code.
- In HTML, a `>` inside a quoted attribute of a `<script>` or `<style>` tag ends the tag early, and a `<!--`
  inside an attribute value opens a comment. None of the five pages has either.

## The base

Rules 1 and 2 judge the branch's diff against a base. With no base the guard fails rather than pass comments it
has not read.

- **Locally and in the pre-commit hook:** the merge base of `HEAD` and `origin/main`, as in taiyaku. The guard
  reads the working tree, which `pre-commit` has stripped of unstaged changes to tracked files before its hooks
  run. Untracked files that are not ignored are read too.
- **In CI, a pull request:** `github.event.pull_request.base.sha`, passed as `--base`. Forgejo sets it to the
  merge base with the target.
- **In CI, a push to `main`:** `github.event.before`, or `HEAD~1` when it is empty, all zeros or not a commit.
  That is the `Reject merge commits` step's fallback. Taiyaku's default would compare `origin/main` with itself,
  since on that push they are the same commit.
- **In CI, a tag push, a dispatch or the weekly schedule:** `HEAD`, so rules 1 and 2 judge an empty diff and rule
  3 checks every budget. Nothing lands in those events.

The CI arms are shell in `ci.yml`, as in taiyaku, so the script's self-test cannot reach them. The pull request
arm is checked in the guard's own pull request run, whose log names the base it used. The push arm is first
exercised by the run on `main` after the merge, and is checked there.

## Where it runs

- **A 14th pre-commit hook, `check-comments`:** `--self-test`, then the scan, like the other thirteen. It runs on
  every commit whatever is staged, since it judges the whole branch.
- **Two steps in CI's `linear-history` job,** the self-test and then the scan with the base above. That job already
  clones full history and runs on docs-only pull requests.
- **Knock-ons:** the README's hook count becomes fourteen in both places `check-doc-figures.sh` checks. A self-test
  expectation that reads as a citation to `check-citations.sh` (`new.ts:1`) ends in that gate's counted
  `check-citations: allow` marker (the user's decision, 2026-10-30). The script needs node 16.9 or later: local
  node is v26.12.1, and the CI image's version is checked in the plan.

## How the port is proven

1. **The self-test,** rewritten for redextape: a passing and a failing case for each marker row above, each new
   lexer (`.scm`, `.lua`, `.html` with an inline script), the moved-block rule (a match, a block grown past its
   match, a near miss under half), each exempt generated file, and a budget file with a missing or an unknown
   area.
2. **One sabotage per rule** in a scratch clone, never this checkout: a branch that adds a history marker, one
   that grows a block, one that raises a share. Each must fail with the expected message. A sabotage that does
   not fire is a finding.
3. **The replay,** re-run: rules 1 and 2 over each of the 10 pull requests up to and including `7da611b`, each
   squash commit diffed against its parent. Measured with taiyaku's settings, 8 of the 10 failed. The fork's run
   must show the `PR`-word, backticked `#N`, bare `#N`, dated-pointer and moved-block hits gone, and these still
   failing: `deny.toml`'s dated measurement (#155), the `PR #N` and `53ecbfa` hits in #147, and the new blocks
   of 9 to 33 lines in #149, #150, #153 and #155. Every remaining failure is listed with its verdict.
4. **The gates:** `pre-commit run --all-files` and `check-doc-figures.sh` at the branch's head.

## Not in scope

- Copying the generic changes (the moved-block rule, and failing a date followed by `T` and a digit) back to
  taiyaku. They would go in a taiyaku pull request of their own.
- Trimming the 1,316 blocks already over the cap.
