# syntax=docker/dockerfile:1

# Not alpine. The local embeddings path pulls onnxruntime-node (ADR-017), a
# glibc-linked native binary with no musl build.
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app


FROM base AS build

# Dependencies change far less often than source, so install them in their own
# layer keyed on the manifests alone.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/domain/package.json packages/domain/
COPY packages/application/package.json packages/application/
COPY packages/shared/package.json packages/shared/
COPY packages/adapters/package.json packages/adapters/
COPY patches/ patches/
RUN pnpm install --frozen-lockfile

COPY . .

# next.config.ts inlines the repo-root VERSION into NEXT_PUBLIC_APP_VERSION, so
# the built image is version-stamped and the About modal matches the tag it was
# published from. `next build` needs no DATABASE_URL — verified, so there is no
# build-time stub hiding in here.
RUN pnpm build

# Air-gapped installs need the embedding model resident in the image rather than
# fetched on first use, which would be slow at best and impossible behind
# restricted egress. Off by default because it is a large addition.
ARG VENDOR_EMBEDDINGS_MODEL=false
ENV EMBEDDINGS_CACHE_DIR=/app/.embeddings-cache
RUN if [ "$VENDOR_EMBEDDINGS_MODEL" = "true" ]; then \
      node scripts/fetch-embeddings-model.mjs; \
    fi

# Dev dependencies are no longer reachable at runtime — the start path stopped
# invoking drizzle-kit when migrations moved to their own command (ADR-047) — so
# `pnpm prune --prod` is now possible here. It is deliberately not done: the
# framework packages are peerDependencies of @wayfinder/adapters and real
# dependencies of the apps, and whether pruning survives that resolution has not
# been proven by building and running. Size is the cost; a broken image is not.


# ── Built-in signing engines (ADR-069) ───────────────────────────────────────
# The DSS signature engine jar, the same one the standalone sidecar runs.
FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS dss-build
WORKDIR /build
COPY deploy/dss/pom.xml .
RUN mvn -q -B dependency:go-offline
COPY deploy/dss/src ./src
RUN mvn -q -B package -DskipTests


# A Java runtime cut down to the modules the engine uses (from `jdeps
# --print-module-deps` on the jar, plus jdk.crypto.ec for TLS to a timestamp
# authority). A full JRE would roughly double this layer.
FROM eclipse-temurin:21.0.8_9-jdk-noble@sha256:03b731a231066bd04ada0a7ee9003cdbc1460083344f9277245b233e5ffcbf47 AS jre
RUN jlink \
      --add-modules java.base,java.compiler,java.desktop,java.naming,java.net.http,java.security.jgss,java.sql,jdk.httpserver,jdk.net,jdk.crypto.ec \
      --strip-debug --no-man-pages --no-header-files --compress=zip-6 \
      --output /jre


# The -slim image: Wayfinder without the built-in engines, for installs that
# sign with attestation or drawn signatures only, or that point at external
# engines (`docker build --target runtime-slim`, published as `:<version>-slim`).
FROM base AS runtime-slim
ENV NODE_ENV=production

# Only the final stage's labels reach the published image. `image.source` is the
# one that matters operationally: GHCR uses it to link the package to this
# repository, and an unlinked package shows no source, carries no README and
# does not inherit the repository's permissions.
LABEL org.opencontainers.image.source="https://github.com/rbrasier/wayfinder"
LABEL org.opencontainers.image.description="Wayfinder — an AI-guided workflow agent for document-heavy processes"
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"

# Migrations are a deployment's own step, not a side effect of web boot. Both
# cloud guides and docker-compose.prod.yml run the `migrate` command first.
ENV RUN_MIGRATIONS_ON_START=false

# The API is bundled, so its own path says nothing about where the generated SQL
# ended up. Tell it explicitly rather than have it guess.
ENV MIGRATIONS_DIR=/app/packages/adapters/drizzle

# The upstream node image lags Debian's security fixes, and the npm CLI it
# bundles carries its own vulnerable dependency tree (tar, minimatch, glob, …).
# Nothing here runs npm — the entrypoint uses pnpm via corepack — so it goes
# rather than being patched. Both are what the Trivy gate in CI and publish
# would otherwise block on. SECURITY_REFRESH (CI passes today's date) busts the
# layer cache daily, so a cached upgrade never outlives Debian's next fix.
ARG SECURITY_REFRESH
RUN apt-get update --error-on=any \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# The app writes into /app at runtime (the embeddings cache when the model is
# not vendored), so the unprivileged user owns it.
COPY --from=build --chown=node:node /app /app

# web, api. Only web is normally published; the api takes almost no ingress.
EXPOSE 3000 3001

# Not root: a compromised web or api process would otherwise own the container.
# `node` ships with the base image; nothing here binds a port below 1024.
USER node

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["web"]


# The default image: everything above plus the PDF converter (LibreOffice) and
# the signature engine (EU DSS on a trimmed Java runtime), started only when the
# chosen signature method needs them (ADR-069 §1). Last stage, so a plain
# `docker build` produces it.
FROM runtime-slim AS runtime
USER root

# Writer only, headless, with metric-compatible stand-ins for the Office fonts
# templates use (Carlito for Calibri, Caladea for Cambria, Liberation for
# Arial/Times/Courier), so converted PDFs keep the layout Word gave them.
ARG SECURITY_REFRESH
RUN apt-get update --error-on=any \
  && apt-get install -y --no-install-recommends \
       libreoffice-writer-nogui \
       fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*

COPY --from=jre /jre /opt/wayfinder/jre
COPY --from=dss-build /build/target/wayfinder-dss.jar /opt/wayfinder/dss/wayfinder-dss.jar

# Trust anchors are deployment configuration (ADR-067 §5): mount the CA
# certificates here. Nothing in the UI can add one.
ENV TRUST_ANCHORS_DIR=/app/trust
RUN mkdir -p /app/trust && chown node:node /app/trust

USER node
