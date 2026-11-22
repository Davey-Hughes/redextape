# redextape

redextape is a small programming language that compiles to both the lambda calculus and Turing
machines. You can run a program both ways at [redextape.com](https://redextape.com) and step through
the λ-term and the machine side by side.

[![One program on redextape.com, open as source, a λ-term and a Turing machine side by side](https://daveyhughes.com/readme/redextape/demo.webp)](https://redextape.com)

Programs are written in `.rxt`, a small typed language. The compiler turns a program into a single
λ-term, and separately into a multi-tape Turing machine by way of a register machine called rxm. A
step in the λ view is one β-reduction of the term, and a step in the Turing machine view is one move
of the machine.

## What it does

- `.rxt` has functions, closures, `let` and `mut` bindings, `if`, `while`, natural numbers, booleans
  and lists. The site has a few example programs to start from.
- A program can be opened as source, as a λ-term drawn as a tree you can fold, as an rxm program, and
  as a Turing machine with its tapes, rules and state diagram. Clicking part of one view marks the
  matching parts of the others.
- The λ, rxm and Turing machine views each step forwards and backwards, play at a speed you pick and
  go back to step 0. A long run pauses when it reaches the step cap or fills the recording, and you
  can tell it to carry on.
- You can copy the λ-term, rxm program or Turing machine out as text, edit it and run the copy.
- A share link holds the program, the layout of the views and the step shown for each machine. It's
  kept in the URL's fragment, which the browser doesn't send to the server.
- The tests run the same programs through a reference interpreter, the λ reducer, the Turing machine
  with unary and binary tapes, and native code, and fail if any two disagree.
- `redextape-lsp` is a language server for `.rxt` and for the λ, rxm and Turing machine text formats.
  There are tree-sitter grammars for all four and a Neovim plugin that sets them up. The site uses
  the same server and grammars.
- `redextape` is the command-line tool. It formats, lints and runs programs, and writes out a
  program's λ-term, rxm program or Turing machine.

## How it works

The compiler is written in Rust. It parses `.rxt`, infers types with Hindley–Milner and lowers the
program to a small core language. From there it goes two ways.

The λ backend builds one term for the whole program. Numbers are Church numerals, booleans and lists
are Scott-encoded, recursion goes through the Y combinator, and `mut` and `while` are compiled in
store-passing style. The term has to be reduced in normal order, because under call-by-value the Y
combinator never stops unfolding and an `if` evaluates both of its branches. The answer is read back
from the normal form using the program's type. A few programs that use `mut` have no λ-term,
such as one where a closure changes a variable it captured. For those, the λ view shows the reason
in place of a term.

The Turing machine backend first compiles the program to rxm, a register machine with instructions
for arithmetic, jumps, calls, pairs and mutable cells. A function used as a value becomes a tagged
pair on the heap, and calls to it go through a dispatcher. Each rxm instruction then becomes a block
of states on a five-tape machine, with tapes for the registers, scratch work, the call stack, the
heap and mutable cells. Numbers are stored in fixed-width fields, in unary or binary. The finished
machine can be folded onto one-way tapes, merged onto a single tape and cut down to two symbols.

Every node of the core program has an ID, and a source map records which part of the λ-term, which
rxm instructions and which Turing machine states came from it. That's how a click in one view finds
the matching parts of the others. The views step independently of each other.

The site runs all of this in the browser. The Rust code is compiled to WebAssembly, a web worker
runs the machines, and the page keeps the recent steps so that ◀ can go backwards. The editor is
CodeMirror 6.

## Docs

- [Status and architecture](docs/architecture.md): where things stand, the crates and how they fit
  together, the cross-backend oracle, and what isn't built yet.
- [Development](docs/development.md): building and running it locally, CI, and the checks each commit
  goes through.
- [Conventions](docs/conventions.md): how changes get onto `main`, from linear history and branch
  protection to squash messages.
- The [command-line tool](crates/redextape-cli/README.md) has its own README, and so do the
  [tree-sitter grammars](grammars/README.md), with editor setup.
- Design specs, plans and the [roadmap](docs/superpowers/plans/2026-07-19-redextape-roadmap.md) are
  under [`docs/superpowers/`](docs/superpowers/).

## The name

`redex` (a reducible expression, the thing one step of lambda-calculus reduction rewrites) plus
`tape` (a Turing machine's tape). It's pronounced like "red tape". Other candidates were
*Turnstile* and *Betamax*.

## License

GNU General Public License v3.0, version 3 only; see [LICENSE.md](LICENSE.md).
[COPYING](COPYING) is the same licence as plain text, which is what the site's
[licences page](https://redextape.com/licences.html) shows. The libraries and fonts the site bundles
keep their own licences, which are listed on that page.
