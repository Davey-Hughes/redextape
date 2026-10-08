# About, help, licences and privacy pages — design

Four static pages beside the app, a header menu that reaches them, the deployed commit shown in both, and the
third-party licence notices the site does not carry today. The user asked for an about page and a licence page "and
anything else like that you recommend"; help and privacy are the two recommendations taken (§3).

Code facts below were read at `8dc603d` (#138). §12 gives the command behind every figure.

## §1 Scope

In:

- `about.html`, `help.html`, `licences.html` and `privacy.html`, built by Vite beside `index.html`.
- An `about ▾` header menu linking the four pages and the source, with the build's commit at its foot.
- The build's commit, read from the `COMMIT_HASH` the Docker build already receives.
- A copyright line whose year follows the viewer's clock (§7).
- Third-party notices for everything the site ships, generated into a committed file and held to the lockfiles by a
  new `scripts/check-licences.sh` (§8).
- One copy of the pre-paint script, inlined into all five pages by the build (§9).

Out:

- Copyright headers in `README.md`, `LICENSE.md` or source files.
- The GitHub mirror itself, which exists and is current (§2.4).
- Clean URLs (`/about` without `.html`): nginx's fallback serves the app there, and every link this design writes
  names the `.html` file.
- The existing `/licenses/hack-LICENSE.txt` and `/licenses/inter-LICENSE.txt` stay where they are, with
  `licenses.test.ts`; this design adds beside them and moves nothing.

## §2 What exists

### §2.1 The licence is not on the site

The workspace declares `license = "GPL-3.0-only"`, and `LICENSE.md` (35,149 bytes) holds the GPL-3.0 text. `README.md`'s
last section links it. Nothing in `web/` serves it or names it.

### §2.2 No third-party notice ships

The `web/dist` in the working tree, built 2026-10-07, has four JavaScript chunks; none contains `Permission is hereby
granted`, `@license`, `Copyright (c)` or `MIT License`. The site ships 18 npm packages of code — 16 its imports
reach, and Vite's and rolldown's helpers — and 2 of fonts, and its two `.wasm` builds compile in 28 third-party
crates (§8.1). MIT, the commonest licence among them, requires its
notice in "all copies or substantial portions of the Software".

The two font licences are served at `/licenses/` and held to their packages by `licenses.test.ts`. No page links them.

**Amended 2026-10-08, after the task reviews.** 28 was `cargo metadata`'s count, and it is a workspace-wide feature
union: the `tree-sitter` crate's build dependency turns on `serde_json`'s `preserve_order`, which adds `indexmap`,
`hashbrown`, `equivalent` and `foldhash` to the workspace's resolution, and neither wasm build compiles the workspace's
copies. `cargo tree` per build names 24. The standard library's precompiled copy of `hashbrown`, the same release,
does ship. And the builds compile in code no package manager names — the Rust standard library with the crates it
compiles in beside it (`compiler-builtins`, `dlmalloc` and its own `hashbrown`), and Emscripten's runtime inside
`web-tree-sitter` (§8.1's amendment).

### §2.3 `COMMIT_HASH` is plumbed and unread

CI's `docker` job passes `--build-arg COMMIT_HASH="$SHA"`, and the `Dockerfile` sets it as an environment variable
before `pnpm run build:app`. No file under `web/` reads it.

### §2.4 The source

`forge.daveynet.xyz` answers every anonymous request with `303` to `/user/login`, a repository that does not exist
included, so a link to it is a login page to a visitor.

The forge push-mirrors to `ssh://github.com/Davey-Hughes/redextape.git` with `sync_on_commit` set and no
`last_error`. On 2026-10-07 the mirror's `main` was `8dc603d`, the same as the forge's, and
`https://github.com/Davey-Hughes/redextape/tree/8dc603d` answered `200` anonymously.

### §2.5 Hosting

The proxy manager routes `redextape.com`, `www.redextape.com` and `redextape.daveynet.xyz` to the container. Both
domains measured answered through Cloudflare (`server: cloudflare`, a `cf-ray` header), and each HTML response set
no cookie and named one script, the app's own same-origin module; neither page referenced `cloudflareinsights`. The fonts are
bundled, and the only absolute URLs in `web/src/` are the SVG namespace.

### §2.6 What the app keeps in the browser

Ten `localStorage` keys, every one prefixed `redextape.`: `appearance`, `style`, `palette`, `palette.css`,
`palette.custom`, `keymap`, `formatOnBlur`, `layout`, `buffers` and `program`. `web/src/` uses no `sessionStorage`,
no IndexedDB and no `document.cookie`. A share link carries the program in the page's fragment (`#s=`), which a
browser does not send to the server (`share-link.ts`'s header).

### §2.7 The header

`index.html` declares each header menu as a native popover beside its button, and `app-header.ts`'s `wireMenu` wires
the invoker, `aria-expanded` and focus. `.bar` wraps. `wireMenu` autofocuses the menu's first
`button:not([disabled]), select`; a link is neither, so a menu of links would open with nothing focused.

### §2.8 The pre-paint script

`index.html` carries one inline `<script>` that applies the stored appearance, style and cached palette before first
paint. `prepaint.test.ts` reads it out of `index.html` with a regular expression and holds it to `skin.ts` and
`palettes.ts`.

### §2.9 Keys

`lsp-nav.ts`'s `navKeymap` binds `F12` (go to definition), `Shift-F12` (next reference) and `F2` (show the hover
information at the caret) in the source editor and in every copy's editor. `main.ts` binds `Mod-'` (link the caret's
position to the panes) in the source editor only. The keymap setting picks `default` or `vim`. Outside the editors,
keys are handled per widget — the λ body, the state diagram, the δ-table grid, the layout's splitters and tab lists,
and the view header's radio groups — each in its own `keydown` handler; the help page's table is read from those
handlers when it is written (§4).

## §3 Decisions

The user made these on 2026-10-07:

1. All four pages: about, licences, privacy and help.
2. Static pages, one per topic, each opened in a new tab from an `about ▾` header menu. A tab change keeps the app's
   stepping position and recorded history, which a reload loses (only the program, the copies and the layout are
   stored, §2.6).
3. The source link points at the GitHub mirror (§2.4).
4. The copyright holder is Davey Hughes, and the year is not written into the page (§7).
5. Notices are generated into a committed file and checked for drift (§8), over generating them at build time
   (which needs cargo in the Docker web stage and is never reviewed) or adopting `cargo-about` and
   `rollup-plugin-license` (two new tools and a CI install).

## §4 The pages

Each is an HTML file in `web/` beside `index.html`, added to the build's inputs, so the build writes
`dist/about.html` and its three siblings and nginx's `try_files $uri` serves them under the existing `no-cache`
rule. Each loads the app's `style.css` (its `body` rule is a plain flex column, so it suits a document) and a small
`pages.css` for prose width and headings, and one module script that loads no wasm. A shared nav at the top of each
page links the other three and the app.

1. **About.** The README's tagline, two paragraphs on what redextape does, where the name comes from, the build
   (§6), the source link, the licence (GPL-3.0-only, linking `licences.html`) and the copyright line (§7).
2. **Help.** A short how-to — open an example, step the three legs, link a position across panes, make a copy, share
   a link, the settings — then two key tables. *In the editors*: `F12`, `Shift-F12`, `F2`, `Mod-'` (written
   "Ctrl+' (⌘+' on a Mac)" and marked source editor only), and the vim keymap setting. *In the panes*: the
   navigation keys of §2.9, each read from its handler when the page is written.
3. **Licences.** redextape's licence and copyright first, with the full GPL-3.0 text; then the notices of §8,
   grouped as *in the page's code*, *in the WebAssembly* and *fonts*, each package a `<details>` holding its name,
   version, SPDX expression and licence texts.
4. **Privacy.** The program runs in the browser and nothing typed is sent anywhere; the site sets no cookies, runs no
   analytics and loads nothing from another host; the ten storage keys of §2.6, each with what it holds; share links
   keep the program in the fragment; and Cloudflare and the host receive each request — address, page and user agent
   — as for any website. Every claim is one §2.5 or §2.6 measured.

## §5 The menu

An `about ▾` button and popover in `index.html`, after `settings`, wired by `wireMenu`. Its items are links, each
`target="_blank" rel="noopener"`: about, help, licences, privacy, and `source ↗` to the mirror at the build's commit.
Below a rule, `build 8dc603d` — the short commit, or `dev build` (§6).

`wireMenu`'s first-focus query gains `a[href]`, so the menu opens with its first link focused as the other menus open
with their first control.

**Amended 2026-10-08, after the task reviews.** Picking a link closes the menu and gives the focus back to its button,
as every header menu's item does. Each link is described as opening a new tab (`aria-describedby` on a visually hidden
note), which only `source`'s arrow had shown, and that arrow is hidden from a reader.

**Amended 2026-10-08, after the prototype.** The menu sits just before `settings`, not after it. After it, a Tab from
`settings` reached `about ▾` rather than the notice line's *undo*, which `base16-remove.test.ts` holds: 12 of its 15
cases failed. The user chose the position before `settings`, which keeps `settings` the header's last control; there
all 15 pass. The menu's markup carries no `aria-haspopup`, as `share`'s does not: its items are links, not menu items.

## §6 The build

`vite.config.ts` reads `process.env.COMMIT_HASH` and defines it for the app and the pages. A full hash shows as its
first seven characters and links `https://github.com/Davey-Hughes/redextape/tree/<hash>`. When it is unset — `pnpm
dev`, a local `pnpm build`, a `docker build` without the argument — the build reads `dev build` and the source link
names `main`. One module exports the mirror's URL and both link forms, so the menu and the about page cannot drift
apart.

## §7 The copyright year

The line reads `© 2026 Davey Hughes` in 2026 and `© 2026–YYYY Davey Hughes` after it, where `YYYY` is the year on
the viewer's clock when the page loads. 2026 is the first year of publication and stays; the end of the range is
never written into a file. The HTML carries `© 2026 Davey Hughes`, and the page's script widens it, so a page whose
script does not run still names the right first year. It appears on the about and licences pages.

**Amended 2026-10-08, after the prototype.** It appears in the footer of the four pages beside the app, and in the
licences page's own statement besides; the app's own page carries none.

## §8 The notices

### §8.1 What ships

**npm.** The closure under `dependencies` and `peerDependencies` of the packages `web/src/` imports
(`@codemirror/view`, `state`, `lint` and `commands`; `@replit/codemirror-vim`; `web-tree-sitter`) and the two fonts
`fonts.css` loads (`@fontsource/inter`, `hack-font`). That closure is 16 code packages — `@codemirror/language` and
`search` among them, reached through `commands` and the vim keymap — and the 2 fonts. Two more ship
without being imported: Vite's preload helper and rolldown's module helpers (`__toESM`, `__commonJSMin`) are both in
the built chunk, so `vite` and `rolldown` are added by name. Vite's `LICENSE.md` also carries the licences of what
Vite bundles into its own Node build, none of which reaches a browser, so only its first section (*Vite core
license*) is reproduced.

**Rust.** `cargo metadata --filter-platform wasm32-unknown-unknown`'s graph, from `redextape-wasm` and
`redextape-lsp-wasm`, along normal edges only, not entering a proc-macro crate. That is 28 crates, and every one has
at least one `LICENSE*`, `COPYING*` or `NOTICE*` file in its source directory. A proc-macro runs in the compiler and
leaves nothing in the `.wasm`, so `serde_derive`, `wasm-bindgen-macro` and the crates only they reach are not listed.

Over-including is harmless and under-including is the defect, so the npm side takes the whole closure rather than
asking the bundler what survived tree-shaking.

**Amended 2026-10-08, after the task reviews, with the user's decision.** The closure is wider and exacter:

- *The toolchains.* A fixed group, *From the toolchains*, shown with no version so a new Rust release does not stale
  the file; the user chose this over narrowing the page's claim. The Rust standard library (MIT OR Apache-2.0) with
  the three crates it compiles in beside it — `compiler-builtins` (`__multi3` and `memcmp` are in both builds, by name
  in the unstripped `.wasm`), `dlmalloc` and `hashbrown` (both builds carry `/rust/deps/dlmalloc-0.2.14` and
  `/rust/deps/hashbrown-0.17.1`) — and Emscripten's runtime (MIT or NCSA). Their texts are committed under
  `web/scripts/toolchain-licences/`: the Rust repository's `COPYRIGHT`, `LICENSE-MIT`, `LICENSE-APACHE` and
  `library/compiler-builtins/LICENSE.txt` at the commit of Rust 1.99.0, whose `library/Cargo.lock` names
  `dlmalloc` 0.2.14 and `hashbrown` 0.17.1, whose crates' licence files these are; Emscripten's `LICENSE` at 4.0.15.
  `hashbrown` and `compiler-builtins` were added after the whole-branch review found the first in both builds; a test
  now holds the list to every `/rust/deps/` crate a build carries.
- *Crates* come from `cargo tree` for each wasm build (normal edges, no proc-macro), not `cargo metadata`'s graph:
  24, not 28 (§2.2's amendment).
- *A licence file* is one whose name holds `licence`, `license`, `copying`, `copyright` or `notice` anywhere, not at
  its start: rolldown's `THIRD-PARTY-LICENSE`, which carries the esbuild and Rollup notices behind the helpers
  rolldown is listed for, was missed.
- *The scan* also reads the pages' `/node_modules/` references and inline module scripts and unquoted CSS `url()`,
  throws on an import built in a template, and is held to Vite's parser for every source and every page's inline
  module scripts (`licences-scan.test.ts`). Links that are not `http(s)` fall back to
  the registry's page. The output sorts by code unit: Danish and Estonian collation changed its bytes.

### §8.2 The file and the check

A Node script writes one committed JSON file: each package's name, version, SPDX expression, group (§4) and the names
of its licence texts, with each distinct text stored once (the Apache-2.0 text is shared by most crates). It reads
redextape's own `LICENSE.md` into the same file, so the licences page has one source. The licences page's script
renders it.

`scripts/check-licences.sh` regenerates the file into a temporary path and fails with the diff if it differs from the
committed one. `--self-test` proves the comparison fires on a changed copy, as every `check-*.sh` does. Pre-commit
and CI run both, like the other checks. A dependency bump or a licence change then fails until the file is
regenerated, and the regenerated diff is reviewable.

## §9 One pre-paint script

The inline script moves to its own file. A small Vite plugin inlines it into every page's `<head>` at build and dev
time, so all five pages paint in the stored theme and the script stays one copy. `prepaint.test.ts` reads the file
rather than `index.html`, and a new case holds that each of the five built pages carries it.

## §10 Failure

- `COMMIT_HASH` unset: `dev build`, source link to `main` (§6).
- The mirror behind the forge: the commit link 404s until the push lands. It is pushed on commit and the image is
  built after the merge, so the window is the push's duration.
- `localStorage` throwing: the pages read storage only in the pre-paint script, which already guards it.
- A dependency bump without regenerating: `check-licences.sh` fails pre-commit and CI (§8.2).

## §11 Testing

1. `check-licences.sh --self-test` and the drift check, in pre-commit and CI.
2. A node test holding the help page's editor table to the keys `navKeymap` returns and the `Mod-'` binding, which
   moves into an exported constant so the test can name it.
3. A node test holding the privacy page's key list to every `redextape.*` storage key declared in `web/src/`.
4. `prepaint.test.ts` reading the moved script, plus the five-pages case (§9).
5. A browser test: the menu opens with its first link focused; each link names its page, `target="_blank"` and
   `rel="noopener"`; the build line and the source link agree with the defined commit; the copyright line widens when
   the clock is past 2026.

Delivery: one branch, `about-pages`, one PR, with a roadmap entry before it opens. The Docker image is built and run
before the PR, since no PR job builds it, and each page is fetched from the running container.

## §12 Figures, and what produced them

All run 2026-10-07 at `8dc603d`, from the repository root unless a `cd` says otherwise.

- 35,149 bytes: `wc -c < LICENSE.md`.
- Four chunks, no notice in any: `for f in web/dist/assets/*.js; do grep -c -E "Permission is hereby
  granted|@license|Copyright \(c\)|MIT License" $f; done`, which printed `0` four times.
- `COMMIT_HASH` unread: `git grep -l "COMMIT_HASH"` lists `.forgejo/workflows/ci.yml`, `Dockerfile` and one plan
  under `docs/`, and nothing under `web/`.
- `303` to `/user/login`, for the repository and for one that does not exist: `curl -s -o /dev/null -w '%{http_code}
  %{redirect_url}' -A redextape-probe https://forge.daveynet.xyz/davey/redextape`, and the same for
  `davey/nonexistent-repo-xyz`.
- The push mirror: `GET /api/v1/repos/davey/redextape/push_mirrors` on the forge, authenticated.
- The mirror at `8dc603d`: `curl -s https://api.github.com/repos/Davey-Hughes/redextape/commits/main`; `200` from
  `curl -s -o /dev/null -w '%{http_code}' https://github.com/Davey-Hughes/redextape/tree/8dc603d`.
- The three domains: the proxy manager's `proxy_host` table, `domain_names` and `forward_port` for port 55004.
- Cloudflare, no cookie, one same-origin script, no beacon: `curl -s -D -` on `https://redextape.com/` and
  `https://redextape.daveynet.xyz/` with a browser user agent, grepping the headers for `server`, `cf-ray` and
  `set-cookie` and the body for `<script` and `cloudflareinsights`.
- Ten storage keys: `git grep -h -o "'redextape\.[a-zA-Z.]*'" -- web/src | sort -u`; none of `sessionStorage`,
  `indexedDB` or `document.cookie`: `git grep -n "sessionStorage\|indexedDB\|document.cookie" -- web/src`, which
  printed nothing and exited 1.
- The imports: `git grep -h -o -E "from ['\"]@?[a-z][^'\"]*['\"]" -- web/src | sort | uniq -c`, whose package lines
  are the six of §8.1 (the rest are prose in comments).
- 16 code packages, 2 fonts: a Node walk of `dependencies` and `peerDependencies` from those six, the two fonts and
  `vite` (not descending into `vite`), run in `web/` against the installed `node_modules`, which listed 19 packages:
  16 of code, 2 fonts and `vite`. `rolldown` is not reached by the walk and is the 18th code package.
- Vite and rolldown helpers in the chunk: `grep -c "__vitePreload\|modulepreload"` printed `3` and `grep -o -E
  "__toESM|__commonJSMin"` found both in `web/dist/assets/index-*.js`.
- 28 crates, each with a licence file: `cargo metadata --format-version 1 --filter-platform wasm32-unknown-unknown
  --locked`, walked by a Python script along edges whose `dep_kinds` include a `null` kind, skipping packages with a
  `proc-macro` target, then globbing each source directory for `LICENSE*`, `LICENCE*`, `COPYING*` and `NOTICE*`.
