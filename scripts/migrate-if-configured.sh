#!/usr/bin/env bash
# Runs `pnpm db:migrate` only when DATABASE_URL is set, otherwise skips silently.
# Lets `pnpm dev` work in environments that don't have a database configured
# (CI lint/typecheck containers, contributors without local Postgres).
set -e

if [ -z "${DATABASE_URL}" ]; then
  echo "[migrate] DATABASE_URL not set — skipping migrations."
  exit 0
fi

pnpm --filter @rbrasier/adapters db:migrate
