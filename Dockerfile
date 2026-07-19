# syntax=docker/dockerfile:1
#
# Redextape — a Rust -> WASM static site. The transpiler and the Turing-machine / lambda simulators
# all run in the browser, so the image is just the built static assets served by nginx: no server
# process, no runtime data, no volumes. Three stages: compile the core crate to WASM, bundle the web
# app, serve the output.
#
# NOTE: the paths below (crates/, web/) do not exist until implementation begins. This Dockerfile is
# the intended build, ready to activate — CI only runs it once the code lands (see .forgejo/workflows
# /ci.yml). Tool versions and the exact web build command are finalized at v1. See docs/ for the spec.

########################  1. WASM (Rust -> wasm32) → /app/pkg  #################################
FROM rust:slim-bookworm AS wasm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add wasm32-unknown-unknown \
    && curl -fsSL https://github.com/rustwasm/wasm-pack/releases/download/v0.13.1/wasm-pack-v0.13.1-x86_64-unknown-linux-musl.tar.gz \
       | tar xzf - --strip-components=1 -C /usr/local/bin --wildcards '*/wasm-pack'
# Manifests + sources only; nothing is read at runtime.
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
RUN wasm-pack build crates/redextape-wasm --release --target web --out-dir /app/pkg

########################  2. Web bundle (Vite) → /app/web/dist  ################################
FROM node:24-slim AS web
WORKDIR /app/web
# Install deps against the lockfile first so this layer caches across source-only changes.
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# The WASM package produced above, imported by the web app.
COPY --from=wasm /app/pkg /app/pkg
ARG COMMIT_HASH
ENV COMMIT_HASH=$COMMIT_HASH
RUN npm run build

########################  3. Runtime (static nginx)  ##########################################
FROM nginx:alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web /app/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=3s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
