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


FROM base AS runtime
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

COPY --from=build /app /app

# web, api. Only web is normally published; the api takes almost no ingress.
EXPOSE 3000 3001

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["web"]
