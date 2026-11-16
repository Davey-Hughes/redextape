# Redextape

A small programming language that compiles to both lambda calculus and Turing machines, so you can
run the same program both ways and step through them side by side. It runs in the browser at
[redextape.com](https://redextape.com).

[![One program on redextape.com, open as source, a λ-term and a Turing machine side by side](https://daveyhughes.com/readme/redextape/demo.webp)](https://redextape.com)

You write a program in `.rxt`, a small typed language. The compiler turns it into a λ-term, and
also into a Turing machine by way of a register machine called rxm, and the site shows them next to
each other. You can step each one forwards and backwards, and clicking part of one view highlights
the matching part in the others. The λ-term really is reduced one step at a time and the machine
really does follow its rules one move at a time, so the views show the actual runs.

## What it does

- `.rxt` has functions, `let` and `mut` bindings, `if`, `while`, natural numbers, booleans, lists
  and closures. The examples menu has a few programs to start from.
- A program can be viewed as source, as a λ-term (drawn as a tree you can fold), as rxm, and as a
  Turing machine with its tapes, rules and state diagram. Clicking a token, part of the term, an rxm
  instruction or a machine rule marks the same place in the other views.
- Each view steps forwards and backwards through a recorded history, plays at a speed you pick and
  can go back to step 0. A run too long to record stops at a step budget and asks before going on.
- A view's λ-term, rxm program or Turing machine can be copied out as text, edited and run on its
  own.
- Share links keep the program, the open views and the step each one is at. It all goes in the
  URL's fragment, which the browser doesn't send to the server.
- The tests run one set of programs through a reference interpreter, the λ reducer, the Turing
  machine on unary and binary tapes, and native code from Cranelift or LLVM, and fail if any two
  disagree.
- `redextape-lsp` is a language server with diagnostics, formatting, hover, go to definition, find
  references and an outline for `.rxt` and for rxm's and the Turing machine's text formats, plus
  diagnostics and formatting for λ files. The site runs the same server in a web worker. There are
  tree-sitter grammars for highlighting, and a Neovim plugin that sets up the filetypes, parsers and
  server.
- `redextape` is the command-line tool. It formats, lints, runs and emits programs: `run` picks the
  reference, λ or Turing machine backend, and `emit` prints the λ-term, rxm program or Turing
  machine as text, optionally reduced to a single tape or to two symbols.

## How it's built

It's a Rust workspace. `redextape-core` has the parser, the type checker and all the backends, and
wasm-pack compiles it to WebAssembly, so everything runs in the browser and the server only serves
static files. The web app is TypeScript with CodeMirror 6 and Vite, and the language server runs in
a worker as a second WebAssembly build. Native code uses Cranelift by default, with LLVM (through
`inkwell`) behind a feature flag. The site is deployed as a Docker image with nginx serving the
static build. CI runs on Forgejo: formatting and clippy, the Rust tests with a 90% line-coverage
minimum, the WebAssembly and web tests in a real browser, and a RustSec advisory check. It publishes
the image from `main`.

## Docs

- [Status and architecture](docs/architecture.md): where things stand, the crates and how they fit
  together, the cross-backend oracle, and what isn't built yet.
- [Development](docs/development.md): building and running it locally, CI, and the checks each commit
  goes through.
- [Conventions](docs/conventions.md): how changes get onto `main`, from linear history and branch
  protection to squash messages.
- The [command-line tool](crates/redextape-cli/README.md) and each of the
  [tree-sitter grammars](grammars/) have their own README; the grammars' cover editor setup.
- Design specs, plans and the [roadmap](docs/superpowers/plans/2026-07-19-redextape-roadmap.md) are
  under [`docs/superpowers/`](docs/superpowers/).

## The name

`redex` (a reducible expression, the thing one step of lambda-calculus reduction rewrites) plus
`tape` (a Turing machine's tape). It's pronounced like "red tape". Other candidates were
*Turnstile* and *Betamax*.

## License

GNU General Public License v3.0, version 3 only; see [LICENSE.md](LICENSE.md). The libraries and
fonts the site bundles keep their own licences, which are listed on its
[licences page](https://redextape.com/licences.html).
