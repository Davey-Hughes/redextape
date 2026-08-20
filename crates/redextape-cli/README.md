# `redextape` — the command line front end

    redextape fmt foo.rxt            rewrite in place
    redextape fmt --check src/*.rxt  diff what would change; rewrite nothing
    redextape fmt -                  stdin to stdout
    redextape lint foo.rxt           parse, type and lint diagnostics

Exit codes: `0` success, `1` the check failed (`fmt --check` found a file it would rewrite, or `lint`
found an error-severity diagnostic), `2` the work could not be done (an unreadable or missing file,
bad arguments). `fmt` also exits `2` on a file it cannot parse — a formatter that cannot parse its
input has not done its job — where `lint` reports that same parse failure as a diagnostic and exits
`1`. Diagnostics go to stderr, so `redextape fmt - > out.rxt` and `redextape lint f.rxt | …` both stay
clean.

`fmt` is exactly `print ∘ parse` — `redextape_core::format`. A file that does not parse is reported
and left untouched. Every other file named on the same command line is still processed, and the worst
outcome across them is what sets the exit code.

`lint` reports errors and two warnings: a `let mut` that is never assigned, and a binding that is never
read. Name a binding `_x` to say you meant it. A warning does not fail the run — `lint` exits `0` and
prints it — and there is no `--deny-warnings` yet.
