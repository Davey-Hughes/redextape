# `.rxt` Navigation Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `.rxt` the same three navigation requests `.tm` and `.asm` already answer — `definition`, `references`, `documentSymbol` — on a scope-aware binder pass rather than a flat name lookup.

**Architecture:** The surface AST grows name spans and a `Param` type. A new `redextape-core/src/binder.rs` walks the tree from `parse_recovering` over an explicit worklist, resolving each occurrence against a persistent scope arena, emitting events that are sorted into source order and pushed into the existing `NameIndex`. `nav.rs` gains a `DefKind` discriminant so the server can tell a `fn` from a `let` from a parameter; the LSP crate gains one `nav` arm and swaps its per-language `symbol_kind` for a per-kind `outline_kind`.

**Tech Stack:** Rust 2024, `redextape-core` (zero dependencies), `redextape-lsp` (`gen-lsp-types` 0.11.0, `lsp-server` 0.10.0).

**Design:** [`../specs/2026-09-08-rxt-navigation-index-design.md`](../specs/2026-09-08-rxt-navigation-index-design.md)

## Global Constraints

- **Every commit passes `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check`.** The pre-commit gate runs both. This is why Task 1 and Task 2 each change the AST *and* every consumer in one commit: an intermediate state that does not compile cannot be committed, so those tasks cannot be split further.
- **`unwrap`, `expect`, `panic!`, `todo!` and `unimplemented!` are `warn` (and therefore fatal) in library code.** Test code is exempt via `clippy.toml`. No `todo!()` placeholder arms.
- **No `file:line` citations in tracked source.** The `check-citations` pre-commit hook enforces it. Code comments name symbols (`` `free_member_refs` ``), never `desugar.rs:367`. `file:line` is normal in `docs/` and this plan uses it freely.
- **`redextape-core` has zero dependencies and must keep them.** `binder.rs` may use `std` and `crate::` only.
- **Doc comments are `///` in Rust.**
- **Never `git commit --no-verify`.** If a hook fails, fix the cause.
- **`redextape-core` is the only crate that names `ast::`.** Verified: `grep -rn "ast::" --include='*.rs' crates | grep -v redextape-core` returns 0 lines.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `crates/redextape-core/src/ast.rs` | `Param`; name spans on `Let`, `Fn`, `Assign`, `Method` | 1, 2 |
| `crates/redextape-core/src/parser.rs` | supplies every span | 1, 2 |
| `crates/redextape-core/src/{desugar,typeck,lints,printer}.rs` | consume `params` | 1 |
| `crates/redextape-core/src/nav.rs` | `DefKind`, `Role::Definition { kind }`, `push_resolved_reference` | 3 |
| `crates/redextape-core/src/tm/{syntax,asm_syntax}.rs` | pass `DefKind::State` / `DefKind::Label` | 3 |
| `crates/redextape-core/src/binder.rs` (new) | the scope walk and `nav_rxt` | 4, 5 |
| `crates/redextape-lsp/src/language.rs` | `outline_kind`, the `.rxt` `nav` arm | 6 |
| `crates/redextape-lsp/src/lib.rs` | `document_symbol` filters on kind | 6 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | the PR's roadmap entry | 7 |

---

### Task 1: `Param` — parameters carry their spans

**Files:**
- Modify: `crates/redextape-core/src/ast.rs` (add `Param`; `Stmt::Fn.params`, `Expr::Lambda.params`)
- Modify: `crates/redextape-core/src/parser.rs:428` (`parse_param_list`), `:615` (lambda)
- Modify: `crates/redextape-core/src/desugar.rs` (6 sites), `typeck.rs` (3), `lints.rs` (2), `printer.rs` (2)
- Test: `crates/redextape-core/src/parser.rs` (inline `mod tests`)

**Interfaces:**
- Produces: `pub struct Param { pub name: String, pub span: Span }` in `crate::ast`. `Stmt::Fn.params: Vec<Param>`, `Expr::Lambda.params: Vec<Param>`. Task 4 reads `p.name.as_str()` and `p.span`.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/src/parser.rs`'s `mod tests`:

```rust
#[test]
fn parameters_carry_the_span_of_their_own_name() {
    // Both producers go through `parse_param_list`, but they are reached by different callers,
    // so both are pinned. Spans are sliced back out of the source rather than compared to
    // literals: a span that is merely non-empty would satisfy a literal comparison written to
    // match whatever the code happened to produce.
    let src = "fn f(alpha, beta) { 1 }\nlet g = |gamma| gamma;\n0";
    let (program, diags) = parse(src);
    assert!(diags.is_empty(), "{diags:?}");
    let stmts = &program.expect("parses").block.stmts;

    let Stmt::Fn { params, .. } = &stmts[0] else { panic!("expected a fn, got {:?}", stmts[0]) };
    let text: Vec<&str> = params.iter().map(|p| &src[p.span.start..p.span.end]).collect();
    assert_eq!(text, vec!["alpha", "beta"]);
    assert_eq!(params.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), vec!["alpha", "beta"]);

    let Stmt::Let { value: Expr::Lambda { params, .. }, .. } = &stmts[1] else {
        panic!("expected a let holding a lambda, got {:?}", stmts[1])
    };
    assert_eq!(params.len(), 1);
    assert_eq!(&src[params[0].span.start..params[0].span.end], "gamma");
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cargo test -p redextape-core --lib parameters_carry_the_span`
Expected: FAIL to compile — `no field span on type &String` (the `params` element is still `String`).

- [ ] **Step 3: Add `Param` and change the two fields**

In `crates/redextape-core/src/ast.rs`, after the `Block` struct:

```rust
/// One parameter of a `fn` or a lambda: its name, and the span of that name in the source.
///
/// A pair rather than `Vec<String>` beside `Vec<Span>`, because two parallel vectors carry a
/// length invariant nothing enforces — the parser writes both and the printer reads one, so a
/// desync produces wrong spans rather than a failure. Navigation needs the span; nothing else
/// does, and every other consumer reads `name` exactly as it read the bare `String`.
///
/// Holds no `Expr` or `Block`, so it stays outside the iterative `Drop` worklist below.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Param {
    pub name: String,
    pub span: Span,
}
```

Change `Stmt::Fn`'s and `Expr::Lambda`'s `params: Vec<String>` to `params: Vec<Param>`.

- [ ] **Step 4: Make the parser produce them**

`crates/redextape-core/src/parser.rs`, `parse_param_list`:

```rust
    fn parse_param_list(&mut self, close: TokenKind) -> PResult<Vec<Param>> {
        let mut params = Vec::new();
        while self.peek().kind != close {
            let tok = self.expect(TokenKind::Ident, "a parameter name")?;
            params.push(Param { name: self.text(tok.span), span: tok.span });
```

The rest of the function is unchanged. Add `Param` to the `crate::ast` import at the top of `parser.rs`.

- [ ] **Step 5: Update the 16 consumers**

Run `grep -rn "Stmt::Fn {[^}]*params\|Expr::Lambda {[^}]*params" --include='*.rs' crates` to list them (16 lines, 5 files). Each is one of two mechanical shapes:

- `params.iter().map(|p| ...)` / `for p in params` → the element is now `&Param`, so `p` becomes `p.name.as_str()` or `p.name.clone()`.
- `params.join(", ")` in `printer.rs` → `params.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", ")`.

`desugar.rs`'s `free_member_refs` and `fn_run_groups` take `params: &'a [String]`; change to `&'a [Param]` and read `p.name.as_str()` at the `bind` calls.

- [ ] **Step 6: Run the full suite**

Run: `cargo test -p redextape-core`
Expected: PASS, including `parameters_carry_the_span_of_their_own_name`.

- [ ] **Step 7: Run the gate**

Run: `cargo clippy --all-targets -- -D warnings && cargo fmt --check`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Parameters carry the span of their own name

`Vec<Param>` rather than `Vec<String>` beside a parallel `Vec<Span>`:
the parallel form's length invariant is enforced by nothing, and the
parser writes both while the printer reads one, so a desync produces
wrong spans rather than a failure.

16 destructuring sites across desugar, typeck, parser, lints and
printer; `ast::` is named by no crate but this one, and the AST carries
no serde or ts_rs derive, so nothing outside redextape-core moves."
```

---

### Task 2: Name spans on `Let`, `Fn`, `Assign` and `Method`

**Files:**
- Modify: `crates/redextape-core/src/ast.rs` (4 new fields)
- Modify: `crates/redextape-core/src/parser.rs:380` (`parse_let`), `:399` (`parse_fn`), `:419` (`parse_assign`), `:521` (the `Dot` arm)
- Modify: `crates/redextape-core/src/desugar.rs:652` (a comment that becomes false)
- Test: `crates/redextape-core/src/parser.rs` (inline `mod tests`)

**Interfaces:**
- Produces: `Stmt::Let.name_span`, `Stmt::Fn.name_span`, `Stmt::Assign.target_span`, `Expr::Method.name_span`, all `Span`. Task 4 reads all four.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/src/parser.rs`'s `mod tests`:

```rust
#[test]
fn definitions_and_the_method_callee_carry_the_span_of_their_own_name() {
    // The statement spans these four sit beside are deliberately WIDER than the name — `Let` and
    // `Assign` swallow their `;`, `Fn` runs to the body's `}`, and `Method` covers the whole call
    // — so slicing the name span back out of the source is what separates a real name span from
    // a copy of the statement span.
    let src = "let mut counter = 1; fn compute(a) { a } counter = 2; 1.method()";
    let (program, diags) = parse(src);
    assert!(diags.is_empty(), "{diags:?}");
    let block = program.expect("parses").block;
    let slice = |s: Span| &src[s.start..s.end];

    let Stmt::Let { name_span, span, .. } = &block.stmts[0] else { panic!("{:?}", block.stmts[0]) };
    assert_eq!(slice(*name_span), "counter");
    assert_ne!(name_span, span, "the name span must not be the statement span");

    let Stmt::Fn { name_span, .. } = &block.stmts[1] else { panic!("{:?}", block.stmts[1]) };
    assert_eq!(slice(*name_span), "compute");

    let Stmt::Assign { target_span, .. } = &block.stmts[2] else { panic!("{:?}", block.stmts[2]) };
    assert_eq!(slice(*target_span), "counter");

    let Some(Expr::Method { name_span, .. }) = block.tail.as_deref() else {
        panic!("expected a method call tail, got {:?}", block.tail)
    };
    assert_eq!(slice(*name_span), "method");
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cargo test -p redextape-core --lib definitions_and_the_method_callee`
Expected: FAIL to compile — `struct variant Stmt::Let has no field named name_span`.

- [ ] **Step 3: Add the four fields**

In `ast.rs`: `name_span: Span` on `Stmt::Let` and `Stmt::Fn`, `target_span: Span` on `Stmt::Assign`, `name_span: Span` on `Expr::Method`. Give each the same doc line shape:

```rust
        /// The span of the NAME, not of the statement. `span` above covers the whole statement.
        name_span: Span,
```

- [ ] **Step 4: Supply them in the parser**

Each site already holds the token. Four one-line changes:

```rust
// parse_let — `name_tok` already exists
Ok(Stmt::Let { name, name_span: name_tok.span, mutable, value, span: kw.span.merge(semi) })

// parse_fn — `name_tok` already exists
Ok(Stmt::Fn { name, name_span: name_tok.span, params, body, span })

// parse_assign — `name_tok` already exists
Ok(Stmt::Assign { target, target_span: name_tok.span, value, span: name_tok.span.merge(semi) })

// the `TokenKind::Dot` arm — `name_tok` already exists
e = Expr::Method { recv: Box::new(e), name, name_span: name_tok.span, args, span };
```

- [ ] **Step 5: Correct the comment the change falsifies**

`desugar.rs`'s UFCS lowering arm says "the method name has no span of its own in this AST". That is now false. Replace with:

```rust
            // UFCS: recv.m(args) -> m(recv, args). The callee `Var` is synthesized and inherits the
            // whole call's span, NOT the method name's — `name_span` exists now and navigation uses
            // it, but feeding it here would move sourcemap entries that `sourcemap_coverage` pins.
```

- [ ] **Step 6: Run the suite and the gate**

Run: `cargo test -p redextape-core && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
Expected: PASS, no clippy output.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Name spans on let, fn, assign and the method callee

All four sites already hold the token; each is one field threaded from
it. The statement spans these sit beside are wider than the name in
every case, which is what the test slices apart.

desugar's UFCS arm said the method name has no span of its own. It has
one now, and the arm still feeds the call's span to the synthesized Var
on purpose: using the name span there would move sourcemap entries that
sourcemap_coverage pins."
```

---

### Task 3: `DefKind`, and a definition that knows what it is

**Files:**
- Modify: `crates/redextape-core/src/nav.rs` (module doc, `DefKind`, `Role::Definition`, `push_definition`, `push_resolved_reference`, `Occurrence::def_kind`, 4 match sites, every test call)
- Modify: `crates/redextape-core/src/tm/syntax.rs:554`, `crates/redextape-core/src/tm/asm_syntax.rs:214`
- Test: `crates/redextape-core/src/nav.rs` (inline `mod tests`)

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces: `pub enum DefKind { State, Label, Let, Fn, Param }`; `Role::Definition { kind: DefKind }`; `Occurrence::def_kind(&self) -> Option<DefKind>`; `pub(crate) fn push_resolved_reference(&mut self, name: &str, span: Span, def: Option<usize>)`; `push_definition(&mut self, name: &str, span: Span, kind: DefKind)`. Task 4 calls `push_definition` and `push_resolved_reference`; Task 6 calls `def_kind`.

- [ ] **Step 1: Write the failing test**

Add to `nav.rs`'s `mod tests`:

```rust
#[test]
fn a_definition_carries_the_kind_its_parser_gave_it_and_a_reference_carries_none() {
    let mut n = NameIndex::default();
    n.push_definition("q0", Span::new(0, 2), DefKind::State);
    n.push_definition("f", Span::new(10, 11), DefKind::Fn);
    n.push_reference("q0", Span::new(20, 22));
    n.link();
    assert_eq!(n.get(0).and_then(Occurrence::def_kind), Some(DefKind::State));
    // Two kinds in one index, so an implementation that hard-codes a single constant fails here
    // rather than passing against whichever kind the first assertion happens to name.
    assert_eq!(n.get(1).and_then(Occurrence::def_kind), Some(DefKind::Fn));
    assert_eq!(n.get(2).and_then(Occurrence::def_kind), None, "a reference has no kind");
}

#[test]
fn a_resolved_reference_keeps_the_link_it_was_given_and_link_is_not_called() {
    // The `.rxt` path resolves as it walks and never calls `link`. Two definitions share the
    // name, so a `link`-style first-definition-wins rule and the supplied link disagree: this
    // asserts the SECOND, which `link` could not produce.
    let mut n = NameIndex::default();
    n.push_definition("x", Span::new(0, 1), DefKind::Let);
    n.push_definition("x", Span::new(10, 11), DefKind::Let);
    n.push_resolved_reference("x", Span::new(20, 21), Some(1));
    n.push_resolved_reference("ghost", Span::new(30, 35), None);
    assert_eq!(n.definition_of(2), Some(1), "the supplied link, not the first definition");
    assert_eq!(n.definition_of(3), None);
    assert_eq!(n.references_to(1).map(|o| o.span).collect::<Vec<_>>(), vec![Span::new(20, 21)]);
    assert_eq!(n.references_to(0).count(), 0);
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test -p redextape-core --lib nav::`
Expected: FAIL to compile — `cannot find value DefKind in this scope`.

- [ ] **Step 3: Add `DefKind` and rework `Role`**

In `nav.rs`, after the `Occurrence` struct:

```rust
/// What a definition defines.
///
/// **SUPPLIED BY THE PARSER THAT PUSHED THE OCCURRENCE; NOTHING HERE DECIDES ONE.** That is the
/// distinction this module's own rule turns on — a function answering "is this a state?" would be
/// a second definition of a grammar that has exactly one, and a value the parser hands over is
/// not. The server maps these to the protocol's `SymbolKind`; this crate names no protocol.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DefKind {
    /// A `.tm` `state <name>:` header.
    State,
    /// A `.asm` `<name>:` label.
    Label,
    /// A `.rxt` `let` binding.
    Let,
    /// A `.rxt` `fn` declaration.
    Fn,
    /// A `.rxt` `fn` or lambda parameter.
    Param,
}
```

Change `Role::Definition` to `Definition { kind: DefKind }`, and the four sites:

| line | now | becomes |
|---|---|---|
| `nav.rs:52` | `role: Role::Definition` | `role: Role::Definition { kind }` |
| `nav.rs:66` | `if o.role == Role::Definition` | `if matches!(o.role, Role::Definition { .. })` |
| `nav.rs:112` | `Role::Definition => Some(i)` | `Role::Definition { .. } => Some(i)` |
| `nav.rs:120` | `.filter(\|o\| o.role == Role::Definition)` | `.filter(\|o\| matches!(o.role, Role::Definition { .. }))` |

`push_definition` takes `kind: DefKind`. Add beside it:

```rust
    /// Record a mention whose binding is already known.
    ///
    /// **`link` IS THE WRONG RULE FOR A SCOPED LANGUAGE, WHICH IS WHY THIS IS A SECOND ENTRY POINT
    /// RATHER THAN A FLAG ON THE FIRST.** `link` points every reference at the FIRST definition of
    /// its name; in `let x = 1; let x = x + 1;` the right-hand `x` is bound by the first `let` and
    /// the tail by the second, and no name-keyed rule can answer both. `binder` resolves against
    /// the scope chain as it walks and calls this; the `.tm` and `.asm` parsers keep calling
    /// `push_reference` and `link`. Neither rule is a mode of the other.
    pub(crate) fn push_resolved_reference(&mut self, name: &str, span: Span, def: Option<usize>) {
        self.occurrences.push(Occurrence { name: name.to_string(), span, role: Role::Reference { def } });
    }
```

And on `Occurrence`:

```rust
impl Occurrence {
    /// The kind of thing this defines, or `None` when it is a reference.
    #[must_use]
    pub fn def_kind(&self) -> Option<DefKind> {
        match self.role {
            Role::Definition { kind } => Some(kind),
            Role::Reference { .. } => None,
        }
    }
}
```

- [ ] **Step 4: Correct the module doc that this contradicts**

`nav.rs`'s doc opens "**THIS MODULE HOLDS NO GRAMMAR.**" and then forbids anything that "could answer 'is this a state?'". `DefKind` names four grammars' constructs. Append to that paragraph:

```rust
//! `DefKind` names constructs from every form and does not breach this: the rule is that nothing
//! here may DECIDE what a name is. A discriminant each parser supplies and this module only
//! carries decides nothing, and the alternative — a neutral vocabulary invented to avoid the
//! words — would be the protocol's `SymbolKind` in disguise, in a crate that names no protocol.
```

- [ ] **Step 5: Update the two artifact parsers and every test call**

`tm/syntax.rs:554` → `nav.push_definition(&name, Span { start: at, end: at + name.len() }, DefKind::State);`
`tm/asm_syntax.rs:214` → `nav.push_definition(name_text, Span::new(at, at + name_text.len()), DefKind::Label);`

Add `DefKind` to each file's `crate::nav` import. Then update every `push_definition` call in `nav.rs`'s own tests — `DefKind::State` is the right filler for the `.tm`-shaped fixtures.

- [ ] **Step 6: Run the suite and the gate**

Run: `cargo test -p redextape-core && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "A definition carries the kind its parser gave it

.rxt yields fns, lets and parameters where .tm and .asm each yield one
kind, so the per-language constant in Language::symbol_kind cannot
answer for it. DefKind moves that answer to the push site.

nav.rs's module doc forbade this in the letter and not in the spirit:
the rule is that nothing here may DECIDE what a name is, and a
discriminant the parser supplies decides nothing. The doc now says
which of the two it means.

push_resolved_reference lands beside push_reference rather than as a
flag on it. link points every reference at the first definition of its
name, which no scoped language can use: in `let x = 1; let x = x + 1;`
the right-hand x is the first binding and the tail is the second."
```

---

### Task 4: `binder.rs` — the walk, the arena, and source order

**Files:**
- Create: `crates/redextape-core/src/binder.rs`
- Modify: `crates/redextape-core/src/lib.rs` (add `pub mod binder;` between `ast` and `core`)
- Modify: `crates/redextape-core/src/analysis.rs` (one pointer line in the module doc)

**Interfaces:**
- Consumes: `ast::Param`, the four name spans (Tasks 1–2); `nav::{DefKind, NameIndex}`, `push_definition`, `push_resolved_reference` (Task 3).
- Produces: `pub fn nav_rxt(src: &str) -> NameIndex`. Task 6 calls it.

**Note on `fn`:** this task binds each `fn` as a run of one — name, then params, then body. That is correct for self-recursion and for every program without a forward reference between siblings. Task 5 replaces it with run grouping. Do not attempt run grouping here; its test belongs with its code.

- [ ] **Step 1: Write the failing tests**

Create `crates/redextape-core/src/binder.rs` containing only the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Every fixture in this module was run through `parse_recovering` before being written down.
    /// Three earlier candidates did not hold the property their test asserted — see the design's
    /// §9. Byte offsets below are from that probe, not from counting characters by eye.

    #[test]
    fn a_reference_resolves_to_the_binding_in_scope_and_not_to_the_name() {
        // `let x = 1; let x = x + 1; x`
        //  ^4          ^15   ^19       ^26
        // The value of the second `let` is walked BEFORE its own name is bound, so the `x` at 19
        // is the FIRST binding and the tail at 26 is the second. Asserting INDICES: every
        // occurrence here is spelled `x`, so a name-only assertion passes against everything.
        let n = nav_rxt("let x = 1; let x = x + 1; x");
        let rhs = n.at(19).expect("a name at 19").0;
        let tail = n.at(26).expect("a name at 26").0;
        assert_eq!(n.definition_of(rhs), Some(0), "the right-hand x is the FIRST let");
        assert_eq!(n.definition_of(tail), Some(1), "the tail x is the SECOND let");
        assert_eq!(n.get(0).map(|o| o.span), Some(Span::new(4, 5)));
        assert_eq!(n.get(1).map(|o| o.span), Some(Span::new(15, 16)));
    }

    #[test]
    fn a_parameter_shadows_an_outer_binding_inside_its_body_and_not_outside_it() {
        // `let x = 1; fn f(x) { x } x`
        //      ^4        ^14 ^16   ^21  ^25
        let n = nav_rxt("let x = 1; fn f(x) { x } x");
        let body = n.at(21).expect("a name at 21").0;
        let tail = n.at(25).expect("a name at 25").0;
        assert_eq!(n.get(n.definition_of(body).expect("resolved")).map(|o| o.span), Some(Span::new(16, 17)));
        assert_eq!(n.get(n.definition_of(tail).expect("resolved")).map(|o| o.span), Some(Span::new(4, 5)));
    }

    #[test]
    fn a_block_scoped_binding_does_not_escape_its_block() {
        // `let g = { let y = 1; y }; y`
        //      ^4        ^14      ^21  ^26
        // The bare-block form `{ let y = 1; y } y` cannot be used: its trailing `y` parses as a
        // `Stmt::Error`, so there is no occurrence to assert on.
        let n = nav_rxt("let g = { let y = 1; y }; y");
        let inner = n.at(21).expect("a name at 21").0;
        let outer = n.at(26).expect("a name at 26").0;
        assert_eq!(n.get(n.definition_of(inner).expect("resolved")).map(|o| o.span), Some(Span::new(14, 15)));
        assert_eq!(n.definition_of(outer), None, "the block's y does not escape it");
    }

    #[test]
    fn an_assignment_target_is_a_reference_and_not_a_definition() {
        // `let mut x = 1; x = 2; x` — three occurrences of `x`, ONE definition.
        let n = nav_rxt("let mut x = 1; x = 2; x");
        assert_eq!(n.definitions().count(), 1, "an assignment must not define");
        let target = n.at(15).expect("a name at 15").0;
        assert_eq!(n.definition_of(target), Some(0));
        assert_eq!(n.definition_of(n.at(22).expect("a name at 22").0), Some(0));
    }

    #[test]
    fn a_method_name_resolves_to_the_binding_it_calls() {
        // `fn m(v) { v } 1.m()` — UFCS: typeck looks `m` up in the environment, so it is a
        //  ^3 ^5     ^10   ^16     reference like any other and navigation must agree.
        let n = nav_rxt("fn m(v) { v } 1.m()");
        let call = n.at(16).expect("a name at 16").0;
        assert_eq!(n.definition_of(call), Some(0));
        assert_eq!(n.get(0).map(|o| o.span), Some(Span::new(3, 4)));
    }

    #[test]
    fn definitions_come_back_in_source_order_when_the_walk_order_is_not() {
        // The worklist pops `else_blk` before `then_blk`, so without the sort `a` precedes `z`.
        // Names chosen so source order and alphabetical order DISAGREE — against `c, p, q` the
        // two are the same list and this test would pass against a sort by name.
        let n = nav_rxt("let c = true; if c { let z = 1; z } else { let a = 2; a }");
        let defs: Vec<_> = n.definitions().map(|o| (o.name.as_str(), o.span)).collect();
        assert_eq!(
            defs,
            vec![("c", Span::new(4, 5)), ("z", Span::new(25, 26)), ("a", Span::new(47, 48))],
            "source order, which is neither walk order nor alphabetical order"
        );
    }

    #[test]
    fn a_file_that_does_not_parse_still_indexes_what_it_has() {
        // THE POINT OF THE PARSE-RECOVERY PR THIS ONE SPENDS. Both fixtures were probed: each
        // reports exactly one diagnostic and each keeps the occurrences asserted here.
        let n = nav_rxt("let x = ; x");
        assert_eq!(n.definitions().count(), 1, "the binding survives losing its value");
        assert_eq!(n.definition_of(n.at(10).expect("a name at 10").0), Some(0));

        let n = nav_rxt("fn f(a) { a");
        assert_eq!(n.definitions().count(), 2, "the fn and its parameter");
        let body = n.at(10).expect("a name at 10").0;
        assert_eq!(n.get(n.definition_of(body).expect("resolved")).map(|o| o.span), Some(Span::new(5, 6)));
    }

    #[test]
    fn a_deep_chain_indexes_without_overflowing_the_stack() {
        // **A DEFAULT TEST THREAD CANNOT FAIL THIS.** `.cargo/config.toml` sets RUST_MIN_STACK to
        // 32 MiB, so a recursive binder would pass at any depth this input can reach. The
        // `drop_tests` module carries the same problem and the same remedy: an EXPLICIT 512 KiB
        // thread, at the same 40,000 depth. `nav_rxt` and nothing else is called inside it —
        // `analyze` recurses to MAX_TYPE_DEPTH and overflows 512 KiB on its own, which would
        // redden this test for a reason that is not the one it is about.
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                let src = format!("let x = 1; {}", vec!["x"; 40_000].join(" + "));
                let n = nav_rxt(&src);
                assert_eq!(n.definitions().count(), 1);
                let last = n.at(src.len() - 1).expect("a name at the end").0;
                assert_eq!(n.definition_of(last), Some(0), "every x in the chain is the one binding");
            })
            .expect("spawn")
            .join()
            .expect("the walk must not overflow 512 KiB");
    }
}
```

- [ ] **Step 2: Run and confirm failure**

Add `pub mod binder;` to `lib.rs` (between `pub mod ast;` and `pub mod core;`), then run:

Run: `cargo test -p redextape-core --lib binder::`
Expected: FAIL to compile — `cannot find function nav_rxt in this scope`.

- [ ] **Step 3: Write the module doc and the types**

At the top of `binder.rs`, above the test module:

```rust
//! Which binding each name in a `.rxt` document refers to.
//!
//! `.tm` and `.asm` resolve a name by looking it up in a flat table, which `NameIndex::link` does
//! for both. `.rxt` names are SCOPED: an occurrence resolves to a binding, and in
//! `let x = 1; let x = x + 1;` the two `x`es on the second line resolve to different ones. So this
//! is a pass and not a lookup, and it is why `.rxt` navigation is a separate piece of work from
//! the two forms that shipped first.
//!
//! **ITERATIVE, AND THE GUARANTEE IT CANNOT BORROW IS THE REASON.** `lints.rs`'s `check` walks the
//! same surface tree recursively, and its module doc records that this is safe only because both
//! of its callers run it AFTER typechecking has added no error-severity diagnostic — so
//! `MAX_TYPE_DEPTH` has already rejected anything nested deeper than a recursive walk survives.
//! Navigation runs BEFORE typechecking, on a tree that may not typecheck and, since `.rxt` gained
//! parse recovery, may not have parsed completely either. It cannot borrow that gate, and what it
//! would buy is not a diagnostic: a recursive walk over adversarial nesting is an uncatchable
//! native stack overflow that takes the editor's server process with it. The parser builds
//! left-nested `Binary`/`Call`/`Method` chains up to roughly `MAX_TOKENS`/2 deep — `ast.rs`'s
//! hand-written iterative `Drop` exists for exactly those — so the depth is reachable from
//! ordinary source. `desugar.rs`'s `free_member_refs` already walks this scoping shape over an
//! explicit worklist; this follows it rather than reinventing it.
//!
//! **THE RESOLUTION RULES ARE THE TYPECHECKER'S, NOT A SECOND READING OF THE GRAMMAR.** A jump
//! that disagrees with `typeck` is wrong rather than merely different, so each rule below names
//! the function it copies: `TyEnv::lookup`'s reverse scan for shadowing, `infer_stmt`'s `Let` arm
//! for a value that cannot see its own binding, `infer_block_inner` and `infer_fn_run` for the
//! mutually-recursive run, and `infer_stmt`'s `Assign` arm for a target that is a reference.

use crate::ast::{Block, Expr, Param, Program, Stmt};
use crate::nav::{DefKind, NameIndex};
use crate::Span;

/// One binding in the shadow chain: `(enclosing scope, the name it binds, the event that defines
/// it)`. Scopes live in a flat arena addressed by index, and `ROOT` is an index no slot can have.
///
/// **PERSISTENT AND NEVER POPPED, WHICH IS WHAT LETS THE WALK BE OUT OF ORDER.** A mutable
/// push/pop scope stack needs the walk to visit in tree order; a worklist does not, so each work
/// item carries its own scope index instead. `free_member_refs`'s `Shadow` is the same structure
/// with one field fewer.
type Scope<'a> = (usize, &'a str, usize);
const ROOT: usize = usize::MAX;

/// One name occurrence, before it has an index. `Ref`'s `def` is an EVENT id, not an occurrence
/// index: occurrences are numbered only once the events are in source order.
enum Ev<'a> {
    Def { name: &'a str, span: Span, kind: DefKind },
    Ref { name: &'a str, span: Span, def: Option<usize> },
}

/// Worklist item. `Expr` and `Block` are mutually recursive, so one type is not enough — the same
/// reason `ast.rs`'s iterative `Drop` carries three.
enum Work<'a> {
    E(&'a Expr, usize),
    B(&'a Block, usize),
}

#[derive(Default)]
struct Binder<'a> {
    chain: Vec<Scope<'a>>,
    events: Vec<Ev<'a>>,
}
```

- [ ] **Step 4: Write the entry point and the scope operations**

```rust
/// Every name written in one `.rxt` document, each reference pointed at the binding it resolves to.
///
/// Built from `parse_recovering`, never `parse` or `parse_full`: those answer `None` for exactly
/// the broken files navigation is worth most on.
#[must_use]
pub fn nav_rxt(src: &str) -> NameIndex {
    let (parsed, _diags) = crate::parser::parse_recovering(src);
    let mut b = Binder::default();
    b.walk(&parsed.program);
    b.finish()
}

impl<'a> Binder<'a> {
    /// Introduce `name`, and answer the scope that has it. Emits the definition event here, so a
    /// binding and the occurrence that records it cannot get out of step.
    fn bind(&mut self, scope: usize, name: &'a str, span: Span, kind: DefKind) -> usize {
        let ev = self.events.len();
        self.events.push(Ev::Def { name, span, kind });
        self.chain.push((scope, name, ev));
        self.chain.len() - 1
    }

    /// The event that defines `name` at `scope`, or `None` when nothing does.
    ///
    /// Walks the chain to the root and takes the FIRST match, which is the innermost and latest
    /// binding — the same answer as `TyEnv::lookup`'s reverse scan over its stack. A loop, not
    /// recursion. Cost is the number of bindings enclosing this point, which is bounded by nesting
    /// rather than by file length: a chain holds a scope's ancestors, not every binding seen.
    fn resolve(&self, scope: usize, name: &str) -> Option<usize> {
        let mut cur = scope;
        // `get` answers `None` for `ROOT`, which ends the walk.
        while let Some(&(parent, bound, ev)) = self.chain.get(cur) {
            if bound == name {
                return Some(ev);
            }
            cur = parent;
        }
        None
    }

    /// Record a mention, resolved against `scope` as it is written.
    fn note(&mut self, scope: usize, name: &'a str, span: Span) {
        let def = self.resolve(scope, name);
        self.events.push(Ev::Ref { name, span, def });
    }

    fn params(&mut self, scope: usize, params: &'a [Param]) -> usize {
        let mut inner = scope;
        for p in params {
            inner = self.bind(inner, p.name.as_str(), p.span, DefKind::Param);
        }
        inner
    }
}
```

- [ ] **Step 5: Write the walk**

```rust
impl<'a> Binder<'a> {
    fn walk(&mut self, program: &'a Program) {
        let mut work = vec![Work::B(&program.block, ROOT)];
        while let Some(item) = work.pop() {
            match item {
                Work::E(e, scope) => self.expr(e, scope, &mut work),
                Work::B(b, scope) => self.block(b, scope, &mut work),
            }
        }
    }

    fn expr(&mut self, e: &'a Expr, scope: usize, work: &mut Vec<Work<'a>>) {
        match e {
            // A list literal's synthetic `cons`/`nil` are deliberately not references: `typeck`
            // types a list structurally without consulting either name, so recording them would
            // make navigation disagree with the scope the typechecker checked against.
            Expr::Nat { .. } | Expr::Bool { .. } | Expr::Error { .. } => {}
            Expr::Var { name, span } => self.note(scope, name.as_str(), *span),
            Expr::List { items, .. } => work.extend(items.iter().map(|i| Work::E(i, scope))),
            Expr::Binary { lhs, rhs, .. } => {
                work.push(Work::E(lhs, scope));
                work.push(Work::E(rhs, scope));
            }
            Expr::If { cond, then_blk, else_blk, .. } => {
                work.push(Work::E(cond, scope));
                work.push(Work::B(then_blk, scope));
                work.push(Work::B(else_blk, scope));
            }
            Expr::Block { block, .. } => work.push(Work::B(block, scope)),
            Expr::Lambda { params, body, .. } => {
                let inner = self.params(scope, params);
                work.push(Work::E(body, inner));
            }
            Expr::Call { callee, args, .. } => {
                work.push(Work::E(callee, scope));
                work.extend(args.iter().map(|a| Work::E(a, scope)));
            }
            Expr::Method { recv, name, name_span, args, .. } => {
                // UFCS: `recv.m(args)` is a reference to whatever `m` names in scope, which is how
                // `typeck` resolves it and how `free_member_refs` counts it.
                self.note(scope, name.as_str(), *name_span);
                work.push(Work::E(recv, scope));
                work.extend(args.iter().map(|a| Work::E(a, scope)));
            }
        }
    }

    /// Statements bind progressively: a `let`'s name covers the rest of the block but NOT its own
    /// value, which is why the value is pushed against the scope in hand before `bind` replaces it.
    fn block(&mut self, b: &'a Block, scope: usize, work: &mut Vec<Work<'a>>) {
        let mut cur = scope;
        for stmt in &b.stmts {
            match stmt {
                Stmt::Let { name, name_span, value, .. } => {
                    work.push(Work::E(value, cur));
                    cur = self.bind(cur, name.as_str(), *name_span, DefKind::Let);
                }
                Stmt::Fn { name, name_span, params, body, .. } => {
                    cur = self.bind(cur, name.as_str(), *name_span, DefKind::Fn);
                    let inner = self.params(cur, params);
                    work.push(Work::B(body, inner));
                }
                Stmt::Assign { target, target_span, value, .. } => {
                    // A REFERENCE, not a definition: `infer_stmt`'s `Assign` arm looks the target
                    // up and reports `unbound variable` when it is not there.
                    self.note(cur, target.as_str(), *target_span);
                    work.push(Work::E(value, cur));
                }
                Stmt::While { cond, body, .. } => {
                    work.push(Work::E(cond, cur));
                    work.push(Work::B(body, cur));
                }
                Stmt::Expr(e) => work.push(Work::E(e, cur)),
                // An error statement binds nothing and mentions nothing: the source it covers is
                // the source the parser could not read.
                Stmt::Error { .. } => {}
            }
        }
        if let Some(tail) = &b.tail {
            work.push(Work::E(tail, cur));
        }
    }
}
```

- [ ] **Step 6: Write `finish` — the sort and the remap**

```rust
impl Binder<'_> {
    /// Order the events by position and hand them to `NameIndex`.
    ///
    /// **SOURCE ORDER IS A PROPERTY OF THIS SORT, NOT OF THE PUSH SITES.** `NameIndex::definitions`
    /// promises source order and `documentSymbol` renders it, but a worklist pops LIFO — the `if`
    /// arm above pushes `cond`, `then_blk`, `else_blk` and pops them backwards. The alternative was
    /// to push every child reversed so that pop order is source order, which is a discipline held
    /// at ten sites with nothing to enforce it, and getting it wrong is close to invisible: `at`
    /// finds an occurrence by containment and is indifferent to order, so `definition` and
    /// `references` would both still be right and only the outline would be scrambled.
    ///
    /// A reference's `def` is an EVENT id until here, because an occurrence index does not exist
    /// until the order does. `remap` is that renumbering.
    fn finish(self) -> NameIndex {
        let span_of = |e: &Ev<'_>| match e {
            Ev::Def { span, .. } | Ev::Ref { span, .. } => (span.start, span.end),
        };
        let mut order: Vec<usize> = (0..self.events.len()).collect();
        order.sort_by_key(|&i| span_of(&self.events[i]));
        let mut remap = vec![0usize; self.events.len()];
        for (occurrence, &event) in order.iter().enumerate() {
            remap[event] = occurrence;
        }
        let mut index = NameIndex::default();
        for &event in &order {
            match &self.events[event] {
                Ev::Def { name, span, kind } => index.push_definition(name, *span, *kind),
                Ev::Ref { name, span, def } => {
                    index.push_resolved_reference(name, *span, def.map(|d| remap[d]));
                }
            }
        }
        index
    }
}
```

- [ ] **Step 7: Point `analysis.rs` at the new module**

The navigation design and the roadmap both describe this pass as "teach `analysis` to keep resolved symbols". It landed elsewhere. Add to `analysis.rs`'s module doc:

```rust
//! **NAME RESOLUTION IS NOT HERE.** The LSP navigation design describes `.rxt`'s binder pass as
//! teaching this module to keep resolved symbols; it landed in `binder` instead, because this
//! module classifies tokens and a scoping pass is a different concern with a different consumer.
//! A reader following that phrasing wants `binder::nav_rxt`.
```

- [ ] **Step 8: Run the tests**

Run: `cargo test -p redextape-core --lib binder::`
Expected: PASS, 8 tests.

- [ ] **Step 9: Run the sabotages and record their output**

Each of these must redden the named test. Apply, run, confirm, revert.

| sabotage | must redden |
|---|---|
| in `resolve`, walk to the root and keep the LAST match instead of returning the first | `a_reference_resolves_to_the_binding_in_scope_and_not_to_the_name` |
| in `finish`, replace `order.sort_by_key(...)` with nothing | `definitions_come_back_in_source_order_when_the_walk_order_is_not` |
| in `block`'s `Let` arm, `bind` before pushing the value | `a_reference_resolves_to_the_binding_in_scope_and_not_to_the_name` |
| in `block`'s `Assign` arm, `bind` instead of `note` | `an_assignment_target_is_a_reference_and_not_a_definition` |
| make `expr` recursive: call `self.expr(lhs, scope, work)` directly for `Binary` instead of pushing | `a_deep_chain_indexes_without_overflowing_the_stack` |

Paste each run's output into the commit message. **A sabotage that does not fire is a finding about the test, not about the sabotage.**

- [ ] **Step 10: Run the gate and commit**

Run: `cargo test -p redextape-core && cargo clippy --all-targets -- -D warnings && cargo fmt --check`

```bash
git add -A
git commit -m "A binder pass for .rxt, iterative because it runs before typechecking

lints.rs's check walks this same tree recursively and is safe only
because both its callers run it after typechecking, where MAX_TYPE_DEPTH
has already rejected anything deep enough to matter. Navigation runs
before typechecking, on a tree that may not typecheck or even parse, so
it cannot borrow that gate — and the failure it would buy is an
uncatchable native stack overflow, not a diagnostic. free_member_refs
walks the same scoping shape over a worklist; this follows it.

Source order comes from a sort in finish, not from reverse-pushing at
every site. Getting the latter wrong is close to invisible: at() finds
an occurrence by containment, so definition and references stay correct
and only the outline scrambles.

fn is bound as a run of one here. Run grouping is the next commit.

Sabotage runs, with output:
<paste the five runs from Step 9>"
```

---

### Task 5: `fn` runs bind before any body

**Files:**
- Modify: `crates/redextape-core/src/binder.rs` (`block`'s `Stmt::Fn` arm)
- Test: `crates/redextape-core/src/binder.rs` (inline `mod tests`)

**Interfaces:**
- Consumes: everything from Task 4.
- Produces: no new signatures.

- [ ] **Step 1: Write the failing tests**

```rust
    #[test]
    fn a_fn_forward_references_its_own_run() {
        // `fn a(n) { b(n) } fn b(n) { a(n) } 0`
        //     ^3 ^5   ^10 ^12        ^20 ^22   ^27 ^29
        // `infer_block_inner` binds every name in a maximal run of consecutive `fn`s before
        // checking any body, so `b` inside `a` is a forward reference the language allows.
        let n = nav_rxt("fn a(n) { b(n) } fn b(n) { a(n) } 0");
        let b_in_a = n.at(10).expect("a name at 10").0;
        let a_in_b = n.at(27).expect("a name at 27").0;
        assert_eq!(n.get(n.definition_of(b_in_a).expect("resolved")).map(|o| o.span), Some(Span::new(20, 21)));
        assert_eq!(n.get(n.definition_of(a_in_b).expect("resolved")).map(|o| o.span), Some(Span::new(3, 4)));

        // The two parameters are both spelled `n` and must NOT cross-link. This is what separates
        // run binding done right from a run that leaks one body's parameters into the next.
        let n_in_a = n.at(12).expect("a name at 12").0;
        let n_in_b = n.at(29).expect("a name at 29").0;
        assert_eq!(n.get(n.definition_of(n_in_a).expect("resolved")).map(|o| o.span), Some(Span::new(5, 6)));
        assert_eq!(n.get(n.definition_of(n_in_b).expect("resolved")).map(|o| o.span), Some(Span::new(22, 23)));
    }

    #[test]
    fn a_fn_does_not_forward_reference_past_a_run_boundary() {
        // `fn a(n) { b(n) } let z = 1; fn b(n) { n } 0`
        //              ^10                  ^31
        // A non-`fn` statement ends the run, so `b` is not yet bound inside `a`. THE LANGUAGE'S
        // OWN ANSWER, not this pass's invention: `analyze` on this source reports exactly
        // "unbound variable `b`".
        let src = "fn a(n) { b(n) } let z = 1; fn b(n) { n } 0";
        let diags = crate::analyze(src).diagnostics;
        assert!(
            diags.iter().any(|d| d.message.contains("unbound variable `b`")),
            "the fixture must be one the language rejects: {diags:?}"
        );
        let n = nav_rxt(src);
        assert_eq!(n.definition_of(n.at(10).expect("a name at 10").0), None, "b is not bound yet");
        // The later `fn b` is still a definition — it is only unreachable FROM `a`.
        assert!(n.definitions().any(|o| o.span == Span::new(31, 32)), "fn b is still defined");
    }
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test -p redextape-core --lib binder::a_fn_forward_references_its_own_run`
Expected: FAIL — `definition_of(b_in_a)` is `None`, because Task 4 binds each `fn` in turn and `b` is not yet in scope inside `a`.

- [ ] **Step 3: Replace the `Stmt::Fn` arm with run grouping**

`block`'s `for stmt in &b.stmts` becomes an index loop, because a run consumes several statements at once:

```rust
        let mut cur = scope;
        let mut i = 0;
        while let Some(stmt) = b.stmts.get(i) {
            match stmt {
                Stmt::Fn { .. } => {
                    // The maximal run of consecutive `Stmt::Fn`, which is the unit
                    // `infer_block_inner` groups and `infer_fn_run` binds. Every name in the run
                    // is bound before ANY body is walked, so a member may forward-reference or
                    // mutually recurse with any other member; a non-`fn` statement ends the run
                    // and a `fn` after it starts a fresh one that the earlier run cannot see.
                    let start = i;
                    while matches!(b.stmts.get(i), Some(Stmt::Fn { .. })) {
                        i += 1;
                    }
                    let run = b.stmts.get(start..i).unwrap_or(&[]);
                    for stmt in run {
                        if let Stmt::Fn { name, name_span, .. } = stmt {
                            cur = self.bind(cur, name.as_str(), *name_span, DefKind::Fn);
                        }
                    }
                    for stmt in run {
                        if let Stmt::Fn { params, body, .. } = stmt {
                            // Each body gets its OWN parameter scope branching off the run's
                            // shared one, so one member's parameters never reach the next.
                            let inner = self.params(cur, params);
                            work.push(Work::B(body, inner));
                        }
                    }
                }
                Stmt::Let { name, name_span, value, .. } => {
                    work.push(Work::E(value, cur));
                    cur = self.bind(cur, name.as_str(), *name_span, DefKind::Let);
                    i += 1;
                }
                Stmt::Assign { target, target_span, value, .. } => {
                    self.note(cur, target.as_str(), *target_span);
                    work.push(Work::E(value, cur));
                    i += 1;
                }
                Stmt::While { cond, body, .. } => {
                    work.push(Work::E(cond, cur));
                    work.push(Work::B(body, cur));
                    i += 1;
                }
                Stmt::Expr(e) => {
                    work.push(Work::E(e, cur));
                    i += 1;
                }
                Stmt::Error { .. } => {
                    i += 1;
                }
            }
        }
```

Keep the tail push unchanged below the loop.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p redextape-core --lib binder::`
Expected: PASS, 10 tests. The 8 from Task 4 must still pass unchanged.

- [ ] **Step 5: Run the sabotages**

| sabotage | must redden |
|---|---|
| bind only the first member of the run before walking bodies | `a_fn_forward_references_its_own_run` |
| build the parameter scope once outside the second `for` and share it across bodies | the parameter half of `a_fn_forward_references_its_own_run` |
| extend the run across a non-`fn` statement | `a_fn_does_not_forward_reference_past_a_run_boundary` |

- [ ] **Step 6: Run the gate and commit**

Run: `cargo test -p redextape-core && cargo clippy --all-targets -- -D warnings && cargo fmt --check`

```bash
git add -A
git commit -m "A fn run binds every name before any body is walked

infer_block_inner groups the maximal run of consecutive fns and
infer_fn_run binds all of them before checking one, which is what lets
a member forward-reference or mutually recurse with a sibling. A
non-fn statement ends the run, and navigation has to draw the boundary
in the same place or it points at a binding the typechecker says is
unbound.

The run-boundary test asserts against analyze first: the fixture is
only a negative case if the language really rejects it, and analyze
reports unbound variable b on it.

Both parameters in the mutual-recursion fixture are spelled n, which is
what separates a correct run from one that leaks a body's parameters
into the next.

Sabotage runs, with output:
<paste the three runs from Step 5>"
```

---

### Task 6: The LSP surface

**Files:**
- Modify: `crates/redextape-lsp/src/language.rs` (`nav` arm, `symbol_kind` → `outline_kind`, two tests)
- Modify: `crates/redextape-lsp/src/lib.rs:326` (`document_symbol`), `:1267` (a test that inverts)
- Test: both files' inline `mod tests`

**Interfaces:**
- Consumes: `binder::nav_rxt` (Task 4), `nav::{DefKind, Occurrence::def_kind}` (Task 3).
- Produces: `fn outline_kind(kind: DefKind) -> Option<SymbolKind>` in `language.rs`.

- [ ] **Step 1: Write the failing tests**

In `language.rs`'s `mod tests`, replace `only_the_two_artifact_forms_have_a_navigation_index` and `every_form_with_an_index_has_a_symbol_kind` with:

```rust
    #[test]
    fn three_of_the_four_forms_have_a_navigation_index() {
        assert!(Language::Tm.nav("tapes 1\nstart q0\nstate q0: accept\n").is_some());
        assert!(Language::Asm.nav("f:\n\tret\n").is_some());
        assert!(Language::Redextape.nav("let x = 1;\nx\n").is_some(), "the binder pass ships here");
        // `.rxlambda` waits on a term type that carries no source positions at all. `None` is the
        // answer and not an empty index: an empty index would claim the file has no names in it.
        assert!(Language::Lambda.nav("λx. x").is_none());
    }

    #[test]
    fn an_outline_lists_functions_and_bindings_and_not_parameters() {
        // A parameter must be IN the index — go-to-definition on one has to land — but an outline
        // listing every parameter of every function as a flat sibling of the functions is noise.
        // `None` here means "not an outline symbol", which is why this is not called symbol_kind.
        assert_eq!(outline_kind(DefKind::Fn), Some(SymbolKind::Function));
        assert_eq!(outline_kind(DefKind::Let), Some(SymbolKind::Variable));
        assert_eq!(outline_kind(DefKind::Param), None);
        // Unchanged from the slice that shipped them.
        assert_eq!(outline_kind(DefKind::State), Some(SymbolKind::Class));
        assert_eq!(outline_kind(DefKind::Label), Some(SymbolKind::Function));
    }
```

In `lib.rs`'s `mod tests`, rewrite `document_symbol_is_null_for_a_form_this_server_does_not_index` to use `.rxlambda` (`languageId: "redextape_lambda"`, uri `file:///a.rxlambda`, text `"λx. x"`), and add:

```rust
    #[test]
    fn document_symbol_lists_a_rxt_fn_and_its_let_but_not_its_parameters() {
        // The source this test opens is the one the `.rxt`-is-not-indexed test used to open, back
        // when answering `null` for it was the correct behaviour.
        let mut server = Server::new();
        init_hierarchical(&mut server);
        server.handle(notification(
            "textDocument/didOpen",
            &json!({"textDocument": {
                "uri": "file:///a.rxt", "languageId": "redextape", "version": 1,
                "text": "let top = 1;\nfn compute(alpha) { alpha }\ncompute(top)\n"
            }}),
        ));
        let out = server.handle(request(
            5,
            "textDocument/documentSymbol",
            &json!({"textDocument": {"uri": "file:///a.rxt"}}),
        ));
        let v = success_value(&out);
        let syms = v.as_array().expect("an array");
        let names: Vec<_> = syms.iter().map(|s| s["name"].as_str()).collect();
        // `alpha` is deliberately absent, and `top` and `compute` are in SOURCE order.
        assert_eq!(names, vec![Some("top"), Some("compute")]);
        let kinds: Vec<_> = syms.iter().map(|s| s["kind"].as_u64()).collect();
        assert_eq!(kinds, vec![Some(13), Some(12)], "Variable then Function");
    }
```

Helpers used above all exist in `lib.rs`'s `mod tests`: `request` (`:524`), `notification` (`:531`), `success_value` (`:544`) and `init_hierarchical` (`:927`). `open_tm` is `.tm`-specific, which is why this test sends its own `didOpen`. `SymbolKind::Variable` is `13` and `Function` is `12` in `gen-lsp-types` 0.11.0 (`generated/enumerations.rs:574`).

Also check `a_tm_state_and_an_asm_label_get_different_symbol_kinds` (`lib.rs:1196`) still passes — `State` and `Label` keep their mappings, so it should, and if it does not the rework changed something it was not meant to.

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test -p redextape-lsp`
Expected: FAIL to compile — `cannot find function outline_kind`.

- [ ] **Step 3: Replace `symbol_kind` with `outline_kind`**

In `language.rs`, delete the `symbol_kind` method and add a free function. Its doc replaces the "two lists of languages written twice" rationale, which no longer applies:

```rust
/// The `SymbolKind` a document outline lists this definition as, or `None` for a definition an
/// outline should not list.
///
/// **THIS TAKES NO `Language`, AND THAT IS WHAT REPLACED A TEST.** `Language::symbol_kind`
/// answered one fixed kind per form, and `every_form_with_an_index_has_a_symbol_kind` existed to
/// stop `nav` and that match drifting apart — because a form gaining an index without gaining a
/// kind reports nothing in an outline, with no compile error. `DefKind` moves the answer to the
/// push site, so the match is exhaustive over kinds and a new one is a compile error here. The
/// test is gone; the compiler holds what it held.
///
/// **`None` MEANS "NOT AN OUTLINE SYMBOL", NOT "NOT INDEXED".** A parameter must be in the index —
/// go-to-definition on one has to land — but an outline listing every parameter of every function
/// as a flat sibling of the functions is noise. The name is `outline_kind` rather than
/// `symbol_kind` because those are two different questions and the old name answered one.
fn outline_kind(kind: DefKind) -> Option<SymbolKind> {
    match kind {
        // A TM state is a place the machine can be in; an asm label names a point in a program.
        // `Class` and `Function` are the nearest of the protocol's fixed set. Unchanged.
        DefKind::State => Some(SymbolKind::Class),
        DefKind::Label | DefKind::Fn => Some(SymbolKind::Function),
        DefKind::Let => Some(SymbolKind::Variable),
        DefKind::Param => None,
    }
}
```

Make it `pub(crate)` if `lib.rs` cannot reach it otherwise. Update `Language::nav`:

```rust
            Language::Redextape => Some(redextape_core::binder::nav_rxt(src)),
            Language::Lambda => None,
```

and its doc comment, which currently says `.rxt` "waits on a binder-resolution pass".

- [ ] **Step 4: Make `document_symbol` filter on the kind**

The `kind` is now per-occurrence, so it moves into the tuple the iterator builds:

```rust
            let doc = self.documents.get(uri.as_ref())?;
            let nav = doc.nav.as_ref()?;
            let symbols = nav.definitions().filter_map(|o| {
                // `None` is a definition an outline does not list — a `.rxt` parameter. Filtering
                // here rather than in the index keeps the parameter navigable.
                let kind = outline_kind(o.def_kind()?)?;
                let selection_range = doc.index.range(&doc.text, o.span, self.encoding);
                let range = doc.index.range(&doc.text, enclosing_line(&doc.text, o.span), self.encoding);
                Some((o.name.clone(), kind, range, selection_range))
            });
```

Then thread `kind` through both response shapes: `.map(|(name, kind, range, selection_range)| ...)` in the hierarchical arm and `.map(|(name, kind, range, _)| ...)` in the flat one. The `doc.language?` line is no longer needed — `doc.nav.as_ref()?` already answers `None` for an unindexed form — so remove it.

- [ ] **Step 5: Run the tests**

Run: `cargo test -p redextape-lsp`
Expected: PASS.

- [ ] **Step 6: Run the whole workspace and the gate**

Run: `cargo test --workspace && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
Expected: PASS. **If any test outside these two crates fails, that is a finding, not noise** — report it rather than adjusting the test.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Navigation for .rxt reaches the editor

One nav arm, and symbol_kind becomes outline_kind: a free function
exhaustive over DefKind that takes no Language at all. That deletes
every_form_with_an_index_has_a_symbol_kind, which existed to stop nav
and a per-language match drifting apart — a form gaining an index
without gaining a kind reported nothing in an outline, with no compile
error. The compiler now holds what that test held.

Param maps to None, meaning not an outline symbol rather than not
indexed. A parameter must be navigable; an outline listing every
parameter as a flat sibling of the functions is noise.

document_symbol_is_null_for_a_form_this_server_does_not_index opened a
.rxt buffer and asserted null under a comment saying .rxt gets no
navigation. That is now false, so it moves to .rxlambda, and the .rxt
source it vacates becomes the positive outline test."
```

---

### Task 7: The roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**Interfaces:** none.

- [ ] **Step 1: Read the two entries this one follows**

Read the `rxt-parse-recovery` entry (search for "`.rxt` GETS PARSE RECOVERY") and the navigation entry before it. Match their shape: a shouting `####` headline naming what shipped AND what went wrong, a design/plan link line, a body, `#####` subsections for each substantive finding, and a `##### WHAT STAYS OPEN` list.

- [ ] **Step 2: Write the entry**

It must record, at minimum:

- The branch name, the commit range, and the commit count — each measured with `git log --oneline main..HEAD | wc -l`, not estimated.
- That the fixture probe rejected three of the design's own §7 fixtures before any code was written, and which three. This is the entry's most transferable finding: each was chosen by reading the grammar, each looked right, and none held the property its test asserted.
- That `every_form_with_an_index_has_a_symbol_kind` was deleted on purpose, and what replaced it.
- Whatever the per-task and whole-branch reviews find. **Leave this subsection unwritten until those reviews have run** — an entry written before them records the branch the plan expected rather than the one that shipped.

- [ ] **Step 3: Update `WHAT STAYS OPEN` on the B1 entry**

The B1 entry's first open item is "**PR B2 owns the rest of `.rxt` navigation**", listing name spans, the binder pass, `Role::Definition`'s kind, `nav_rxt` and the two `Language` arms. Every item on that list is now closed. Mark it so, and carry forward the two items that are still open: `.rxlambda` has no recovery and no navigation, and `let x 1;` still discards the binding.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "Roadmap entry for the .rxt navigation index"
```

---

## Self-Review

**Spec coverage.** §1 (what is missing) → Tasks 1, 2, 6. §2 (scoping rules) → Task 4 Steps 4–5 and Task 5 Step 3, each rule named in a comment at the site that implements it. §3 (the pass) → Task 4; §3.1 iterative → Task 4 Steps 3 and 5 plus the stack sabotage in Step 9; §3.2 arena → Task 4 Step 4; §3.3 sort → Task 4 Step 6. §4 (name spans) → Tasks 1 and 2. §5 (`DefKind`) → Task 3, with `outline_kind` in Task 6. §6 (LSP surface) → Task 6. §7 testing items 1–9 → Task 4 Step 1 (items 1, 2, 4, 5, 6, 7, 8, 9) and Task 5 Step 1 (item 3). §8 (non-goals) → nothing implements them, by construction; `enclosing_line` is left alone in Task 6 Step 4. §9 (verification) → the figures are already in the spec.

**One spec item with no task, added:** §5's claim that the two artifact parsers keep their existing `SymbolKind` mapping is covered by `an_outline_lists_functions_and_bindings_and_not_parameters`'s last two assertions, which pin `State` and `Label` so the rework cannot silently change them.

**Type consistency.** `Param { name, span }` (Task 1) is read as `p.name.as_str()` / `p.span` in Task 4's `params`. `name_span` / `target_span` (Task 2) are read in Task 4's `block` and `expr`. `DefKind` and `push_resolved_reference` (Task 3) are called in Task 4's `bind` and `finish`. `Occurrence::def_kind` (Task 3) is called in Task 6's `document_symbol`. `nav_rxt` (Task 4) is called in Task 6's `Language::nav`. `outline_kind` (Task 6) is used in Task 6 only.

**One guessed name, found and fixed during this review.** Task 6 Step 1's `lib.rs` test called a `response_result` helper that does not exist; the real one is `success_value` (`lib.rs:544`), and the test now uses it in the shape `document_symbol_lists_the_states_a_tm_file_defines` already uses. Every other helper it names was checked against the file: `request` `:524`, `notification` `:531`, `init_hierarchical` `:927`.

**What this plan does not pin, deliberately.** Task 7's roadmap entry is a set of requirements rather than prose, because the findings it must record do not exist until the reviews have run. Writing it now would record the branch this plan expects rather than the one that ships.
