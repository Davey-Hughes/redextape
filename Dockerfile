# syntax=docker/dockerfile:1
#
# redextape — a Rust -> WASM static site. The transpiler and the Turing-machine / lambda simulators
# all run in the browser, so the image is just the built static assets served by nginx: no server
# process, no runtime data, no volumes. Three stages: compile the WASM crates, bundle the web app,
# serve the output.
#
# CI builds this image on every push to `main` (see .forgejo/workflows/ci.yml's `docker` job), and
# again every Sunday and on a manual dispatch, because nothing else rebuilds `:latest` without a merge.

########  1. WASM (Rust -> wasm32) → /app/pkg, /app/pkg-lsp, /app/pkg-clif, /app/pkg-mc-*, /app/pkg-llvm  ####
FROM rust:slim-bookworm AS wasm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add wasm32-unknown-unknown \
    && curl -fsSL https://github.com/rustwasm/wasm-pack/releases/download/v0.15.1/wasm-pack-v0.15.1-x86_64-unknown-linux-musl.tar.gz \
       | tar xzf - --strip-components=1 -C /usr/local/bin --wildcards '*/wasm-pack'
# Manifests + sources only; nothing is read at runtime.
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
RUN wasm-pack build crates/redextape-wasm --release --target web --out-dir /app/pkg
# **EVERY PACKAGE BESIDE `pkg/` IS BUILT HERE TOO.** `web/src/lsp-worker.ts` imports
# `../../pkg-lsp/redextape_lsp_wasm.js`; without this line stage 2's `build:app` fails to resolve it.
# NOTHING IN CI CATCHES THAT — the `docker` job never runs on a PR, and `pnpm run build:app` is the
# only place the import is resolved for the image, so the web job's own `build:lsp-wasm` step does
# not stand in for it. Same class as the HEALTHCHECK note in stage 3.
RUN wasm-pack build crates/redextape-lsp-wasm --release --target web --out-dir /app/pkg-lsp
# `pkg-clif/`, the CLIF view's package, for the same reason, and before `web/` imports it: no PR runs this stage
# to notice the line missing once it does.
RUN wasm-pack build crates/redextape-clif-wasm --release --target web --out-dir /app/pkg-clif
# The machine code panel's two packages, one per target, for the same reason.
RUN wasm-pack build crates/redextape-mc-wasm --release --target web --out-dir /app/pkg-mc-x86-64
RUN wasm-pack build crates/redextape-mc-wasm --release --target web --out-dir /app/pkg-mc-arm64 \
    -- --no-default-features --features arm64
# The LLVM view's package, for the same reason.
RUN wasm-pack build crates/redextape-llvm-wasm --release --target web --out-dir /app/pkg-llvm

########################  2. Web bundle (Vite) → /app/web/dist  ################################
FROM node:26-slim AS web
WORKDIR /app/web
# pnpm pinned explicitly rather than via corepack, which is not bundled in every node image.
RUN npm install -g pnpm@11.20.0
# Manifest + lockfile first so this layer caches across source-only changes.
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
# The WASM packages produced above, beside `/app/web` where the web app's relative imports resolve.
COPY --from=wasm /app/pkg /app/pkg
COPY --from=wasm /app/pkg-lsp /app/pkg-lsp
COPY --from=wasm /app/pkg-clif /app/pkg-clif
COPY --from=wasm /app/pkg-mc-x86-64 /app/pkg-mc-x86-64
COPY --from=wasm /app/pkg-mc-arm64 /app/pkg-mc-arm64
COPY --from=wasm /app/pkg-llvm /app/pkg-llvm
# **THE COMMITTED GRAMMAR `.wasm`, AND NOTHING IN CI CATCHES THEIR ABSENCE.** `web/src/colour.ts`
# imports them as `../../grammars/<g>/<g>.wasm?url`, so `build:app` below cannot resolve them without
# this line — and the `docker` job never runs on a PR, exactly as the note in stage 1 says of
# `pkg-lsp`. `/app/grammars` beside `/app/web` is what makes the relative import resolve, the same
# placement `/app/pkg` and `/app/pkg-lsp` already use. Stage 1 does not build them: these are
# committed artefacts, not built ones.
COPY grammars/ /app/grammars/
ARG COMMIT_HASH
ENV COMMIT_HASH=$COMMIT_HASH
# `build:app`, not `build`: this stage has no Rust toolchain — stage 1 already produced
# /app/pkg, /app/pkg-lsp, /app/pkg-clif, the two /app/pkg-mc-* packages and /app/pkg-llvm.
RUN pnpm run build:app

########################  3. Runtime (static nginx)  ##########################################
FROM nginx:alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web /app/web/dist /usr/share/nginx/html
EXPOSE 80
# `127.0.0.1`, NOT `localhost`. `nginx:alpine`'s `/etc/hosts` maps `localhost` to both `127.0.0.1`
# and `::1`, busybox wget tries the v6 address, and the server block in `deploy/nginx.conf` says
# `listen 80;` — IPv4 only, so a `localhost` probe would connect to nothing and report `unhealthy`
# while the container serves.
#
# NO CI JOB CAN CATCH THIS. The `docker` job builds and pushes the image and never runs it, so a
# broken `HEALTHCHECK` passes a fully green pipeline. Changes here have to be built AND started by
# hand before merging.
#
# Adding `listen [::]:80;` to `deploy/nginx.conf` would fix it from the other end and make the
# container serve IPv6 generally. Not taken: it widens what the container binds to for a probe that
# only ever needs to reach itself, and on a bridge network there is no v6 to serve.
HEALTHCHECK --interval=30s --timeout=3s --start-period=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
