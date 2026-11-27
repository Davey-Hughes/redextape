//! The programs the native tests run. A target includes this file by `#[path]` rather than through
//! `common/mod.rs`, so a target that uses `common` but not these lists does not compile them as dead code.

/// The first-order demo suite (a subset of `redextape-core`'s `three_way_oracle.rs`
/// `FIRST_ORDER_DEMOS`) — arithmetic, monus, comparison, if, let/let-mut/assign/while, calls &
/// recursion, list construction & access, higher-order programs (`defunc`), and mutually recursive /
/// forward-referencing `fn`s (`Core::LetRecGroup`) — every value stays « MAX_FIELD_WIDTH (64) so the TM
/// leg can participate too.
pub const FIRST_ORDER_DEMOS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "if 1 == 2 { 10 } else { 20 }",
    "let x = 40; x + 2",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    "let add1 = |x| x + 1; add1(41)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))",
    "is_empty(nil)",
    "is_empty(cons(1, nil))",
    "[1, 2, 3]",
    "cons(1, cons(2, nil))",
    "head(cons(7, nil))",
    "tail(cons(7, nil))",
    "head(cons(1, cons(2, nil)))",
    "tail(cons(1, cons(2, nil)))",
    "head(tail(cons(1, cons(2, nil))))",
    "head([1, 2, 3])",
    "tail([1, 2, 3])",
    // Higher-order: a function received as a value, defunctionalized before lowering.
    "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
    // Higher-order with immutable capture: `|x| x + n` captures `n` by value.
    "let n = 5; fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } [1, 2, 3].map(|x| x + n)",
    "\
        fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
        fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
        fn add(a, b) { a + b }\n\
        fn add1(x) { x + 1 }\n\
        fold([3, 1, 2].map(add1), 0, add)",
    // Higher-order currying: a value-lambda whose body is ANOTHER value-lambda.
    "fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)",
    // MUTUAL RECURSION (`Core::LetRecGroup`) — the same three programs `redextape-core`'s
    // `three_way_oracle.rs` adds, carried here so the design spec's `reference == λ == TM == native`
    // claim is ASSERTED on this class rather than assumed from the three-way leg. Each member is
    // observably different at every level, so a permuted group computes a wrong value, not a crash.
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)",
    // The ODD argument is not a duplicate: its answer comes out of the OTHER member's base case, so a
    // backend that collapsed the pair onto `is_even` (which still answers `true` at every even
    // argument) is caught here and not by the even case.
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(5)",
    // A forward reference with no cycle: `a` is a one-member component still emitted INSIDE `b`.
    "fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)",
    // Three members, not two: 1+2+4+1 = 8 identifies the exact rotation of the cycle.
    "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
     fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
     fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)",
    // A group reaching the backends THROUGH `defunc` (`id` is used as a value), and a forward
    // reference doing the same — the paths every case above skips, since they lower via `lower_rxm`
    // directly. See the matching comment in `three_way_oracle.rs`.
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(4, id)",
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(3, id)",
    "fn ap(h,x){ h(x) } fn f(n){ ap(g, n) } fn g(n){ n + 1 } f(3)",
    // A fn both CALLED BY NAME and USED AS A VALUE. Non-commutative at arity 2, so a forwarder with
    // swapped arguments cannot pass: 5 + 7 = 12.
    "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)",
    // RECURSIVE and value-used — the reason the class is large: `analyze` counts a self-call as
    // `name_called`, so every recursive fn used as a value is BOTH. 10 + 3 = 13.
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } fn ap(g, x) { g(x) } ap(sum, 4) + sum(2)",
    // `map` itself passed as a value while ALSO being called by name. Its body dispatches at arity 1
    // and it is value-used at arity 2, so the two dispatchers are distinct. `map` calls itself by
    // name, so the plain call graph has a cycle through `map` -- the interesting claim is about the
    // DISPATCHER graph instead: `$apply2 -> map -> $apply1 -> add1` has no cycle through dispatchers.
    // 2 + 6 = 8.
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
     fn add1(x) { x + 1 }\n\
     fn ap2(g, a, b) { g(a, b) }\n\
     head(map([1, 2], add1)) + head(ap2(map, [5, 6], add1))",
    // A forwarding arm (BOTH: `b`, called by name AND used as a value) SHARING one dispatcher with a
    // normal arm (value-only: `v`), at BOTH possible tag positions. Every BOTH demo above has its
    // forwarder as the SOLE arm of its `$applyN`, so a per-arm parameter-binding defect -- the
    // forwarder must bind NO params so `$a_i` reaches the call directly, while a normal arm must bind
    // its own -- would compile and pass unnoticed. Tags are assigned in declaration order per arity:
    // in the first program below `v` is tag 0 (normal arm) and `b` is tag 1 (forwarder); in the
    // second, the two `fn`s are declared in the opposite order, so `b` is tag 0 (forwarder) and `v`
    // is tag 1 (normal arm). `v` (x*10) and `b` (x+1) are value-distinguishable, so a tag mix-up or a
    // mis-bound param changes the answer rather than staying silent: 10 + 2 + 6 = 18.
    "fn v(x) { x * 10 } fn b(x) { x + 1 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)",
    "fn b(x) { x + 1 } fn v(x) { x * 10 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)",
    // A user `fn` shadowing a list builtin. `defunc` synthesizes `$head($clos)` for its dispatcher
    // tag test, and `lower_rxm` resolves a bound function BEFORE the builtin table — so with the
    // bare name this would silently miscompile. The `$` form is unforgeable in user source, so
    // scaffolding is uncapturable. 2 + 3 = 5.
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } head(1) + ap(add1, 2)",
    // The same shadowing where the shadowing function is ALSO the value being dispatched. 2 + 3 = 5.
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } head(1) + ap(head, 2)",
    // A user `fn tail` shadowing the builtin — but unlike the `head` pair above, a `tail`-shaped twin
    // of THAT demo (`fn tail(x){x+1} fn ap(g,x){g(x)} tail(1)+ap(tail,2)`) is VACUOUS: `$head` is
    // called unconditionally by every dispatcher (the tag test), but `$tail` is only called by
    // `tail1()` to unpack a dispatcher arm's CAPTURED env, and that program's closures capture
    // nothing, so `tail1()` is never invoked and the demo could not detect a reverted `$tail`->`tail`
    // regression. Here `tail` is BOTH called by name (`tail(3)`) and used as a value (`ap(tail, 2)`),
    // so it is KEPT — a real top-level `tail` binder exists for scaffolding to collide with — and the
    // sibling value-lambda `|y| y + n` at the SAME arity captures `n`, forcing its dispatcher arm to
    // call `tail1()` to unpack `$env`. 4 + 3 + 12 = 19.
    "let n = 7; fn tail(x) { x + 1 } fn ap(g, y) { g(y) } tail(3) + ap(tail, 2) + ap(|y| y + n, 5)",
    // `nil` is the FOURTH synthesized scaffolding name (the closed-function-value closure's env, the
    // dispatcher's fault sentinel, the env-list terminator), and `rewrite_value_name`'s bare-`"nil"`
    // check must come AFTER its `tags` check — otherwise a user `fn nil`, itself USED AS A VALUE,
    // compiles to the empty list instead of `cons(tag, $nil)`, and the dispatcher's `$head($clos)`
    // tag test then faults on it. `nil` is not a keyword in this language (see `prelude.rs`'s module
    // doc), so a user `fn nil` SHADOWS the empty list exactly as the reference interpreter's frame
    // lookup does — the reference evaluates this to 5. `defunc.rs`'s `rewrite_value_name` says why
    // the check order matters.
    "fn nil(x) { x + 5 } fn ap(g, x) { g(x) } ap(nil, 0)",
    // A user `fn nil` called by name ONLY (never itself used as a value) sharing a program with an
    // unrelated CLOSED function-value (`add1`, passed to `ap`). Without the `$nil` alias, `add1`'s
    // closed closure would be built as `cons(tag, nil)` — a bare `nil` that `lower_rxm`'s
    // `reject_fn_value` would flag as a value-use of the user's KEPT `fn nil`, rejecting the whole
    // program on every lowering backend even though `nil` itself is never value-used anywhere.
    // 2 + 3 = 5.
    "fn nil(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } nil(1) + ap(add1, 2)",
    // A user `fn cons` shadowing the list builtin — the `cons`-shaped twin of the `head`/`tail` pair
    // above. `defunc` builds every closure as `$cons(tag, env)`, so a bare `cons` here would let this
    // user function capture the closure representation itself — `add1`'s closed closure would become
    // `(tag + env)` (the user's `cons` computes `a + b`, not a pair), and the dispatcher's
    // `$head($clos)` tag test would then read that number as a list. 3 + 7 = 10.
    "fn cons(a, b) { a + b } fn ap2(g, a, b) { g(a, b) } cons(1, 2) + ap2(cons, 3, 4)",
];

/// Programs that only TM/native can run three-way with the reference — the λ backend v1 REJECTS them
/// (`LowerError`) since they involve mutable-in-closure capture or a `fn` inside a mutation region.
/// Since native shares `lower_rxm`/`defunc` with the TM, these still exercise `native == rxm-interp`
/// (the boxing/mutable-capture codegen path), just without the λ leg.
pub const LAMBDA_LIMITATION_DEMOS: &[&str] = &[
    "let mut x = 1; x = x + 1; let x = x + 10; x",
    "let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc",
    "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)",
    "let mut c = 0; fn twice(g) { g(0); g(0); } let bump = |x| { c = c + 1; c }; twice(bump); c",
];

/// Values that exceed `MAX_FIELD_WIDTH` (64) UNARY cells — the unary tape cannot represent them (every
/// value here is « 2⁶⁴, so the TM's `Binary` encoding represents all of them fine; this demo set is a
/// unary-vs-native contrast, not a TM-backend-vs-native one). Native compiles to real 64-bit registers,
/// so it has no such ceiling at any encoding; this is native's distinctive leg.
pub const BEYOND_FIELD_WIDTH_DEMOS: &[&str] = &[
    "100 * 100",
    "let n = 500; n + n",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(100)",
    "[100, 200, 300]",
];

/// Values at or past 2⁶⁴ — the gap `past_the_u64_ceiling_the_backends_diverge_by_design` below exercises.
///
/// IT CANNOT BE AN AGREEMENT TEST, and this must not be "fixed" into one. The backends diverge here BY
/// DESIGN: the reference and native SATURATE (the `saturating_add`/`saturating_mul` in `tm/rxm.rs`),
/// while the TM halts in the rule-less overflow-guard state `tm/build.rs`'s `Builder::overflow`
/// allocates, and never saturates at any width up to the 64-cell ceiling. Both behaviours are
/// deliberate; they are simply different.
///
/// Each of these gives reference `Nat(u64::MAX)`, native `Nat(u64::MAX)`, binary TM `Overflow` (having
/// widened to 64), unary TM `Overflow`. The 20-digit literal parses with zero diagnostics, so these need
/// no special construction.
pub const SATURATION_DEMOS: &[&str] =
    &["18446744073709551615 + 1", "let n = 18446744073709551615; n + 1", "4294967295 * 4294967295 * 4294967295"];

/// Runtime-faulting programs: the reference faults (`RunError::Runtime`) and native reports a
/// `NativeRun::Fault` — the shared "no value, but not a crash and not a cap" outcome.
pub const FAULT_DEMOS: &[&str] = &["head(nil)", "tail(nil)"];
