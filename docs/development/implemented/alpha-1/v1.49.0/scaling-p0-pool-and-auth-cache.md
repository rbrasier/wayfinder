# Implementation Summary — Scaling to Concurrent Load, P0 (v1.49.0)

- **Version**: 1.49.0 (MINOR — new feature, no DB schema change)
- **Date**: 2026-06-23
- **Roadmap**: "Scaling to Concurrent Load (~500 concurrent users)" (P0 tier).
  The full roadmap stays in `to-be-implemented/` because P1/P2 are not yet built;
  this summary covers only the P0 code tier.
- **Scope built**: P0 code items only, per the agreed scope. The pooler (P0 #2)
  is infra/ops and the deployment-shape decision are explicitly out of this build.

## What was built

### 1. Env-driven Postgres connection pool (roadmap P0 #1)

The hardcoded `postgres(url, { max: 10 })` is replaced with a `poolMax` parameter
(default 10, dev-safe). Both application containers pass a new `DATABASE_POOL_MAX`
env var. The `poolMax × instanceCount < Postgres max_connections` constraint —
ideally satisfied behind a transaction-mode pooler — is documented at the client
call site and in both env schemas.

This lifts the single biggest ceiling identified in the roadmap (wall #1): the
per-process in-flight query limit is now tunable per deployment without a code
change.

### 2. Request-path session + permission cache (roadmap P0 #3)

A generic, zero-dependency `TtlCache<Value>` adapter (`packages/adapters/src/cache/`)
backs two short-TTL caches wired in the web container:

- **Session cache** — `createCachedSessionResolver` fronts `resolveSession`.
  **Positive-only**: a missing/expired token is re-checked every request, so a
  user who just logged in is never locked out by a negative cache entry.
- **Permission cache** — `createCachedPermissionResolver` fronts effective
  permission resolution, keyed by `userId:isAdmin` (admin status changes the
  granted set). Only successful results are cached.

Both remove a DB round-trip from the hottest path (roadmap walls #2 and #3). TTL
and max size are env-driven (`AUTH_CACHE_TTL_MS` default 5000, `AUTH_CACHE_MAX_ENTRIES`
default 10000); `AUTH_CACHE_TTL_MS=0` disables caching entirely. The cache is
in-process and correct for a single instance; the seam is deliberately thin so a
Redis-backed implementation can replace it locally once more than one instance runs.

### 3. Statelessness audit (roadmap P0 #4)

Audited per-instance in-memory state reachable from the request path:

- **Auth caches (new)** — rebuildable; a cold instance simply re-queries on miss.
- **ADR-007 compiled-graph cache** — rebuildable cache keyed by flow version.
- **Lazily-built auth instance** (`authInstance` in the container) — reconstructed
  on demand per instance; not cross-request session state.

No request-scoped user/session state is held in memory beyond these rebuildable
caches. The app is stateless and safe to run as N replicas behind a load balancer.
The one caveat is shared-cache invalidation across instances, addressed by the
Redis promotion noted in roadmap P0 #3 once >1 instance runs.

## Files created

- `packages/adapters/src/cache/ttl-cache.ts` — generic TTL + max-size cache
- `packages/adapters/src/cache/index.ts`
- `packages/adapters/src/cache/__tests__/ttl-cache.test.ts`
- `packages/adapters/src/auth/cached-session-resolver.ts`
- `packages/adapters/src/auth/__tests__/cached-session-resolver.test.ts`
- `packages/adapters/src/db/__tests__/client.test.ts`
- `apps/web/src/lib/cached-permission-resolver.ts`
- `apps/web/src/lib/cached-permission-resolver.test.ts`
- `tests/e2e/phase-scaling-to-concurrent-load.spec.ts`

## Files modified

- `packages/adapters/src/db/client.ts` — `poolMax` parameter
- `packages/adapters/src/index.ts` / `auth/index.ts` — export new modules
- `apps/web/src/lib/env.ts` — `DATABASE_POOL_MAX`, `AUTH_CACHE_TTL_MS`, `AUTH_CACHE_MAX_ENTRIES`
- `apps/api/src/env.ts` — `DATABASE_POOL_MAX`
- `apps/web/src/lib/container.ts` — wires both caches; exposes cached `resolveSession`
  and a new `resolveEffectivePermissions`
- `apps/api/src/container.ts` — passes `DATABASE_POOL_MAX`
- `apps/web/src/server/trpc.ts` — permission resolution routed through the cache
- `VERSION`, `package.json` — 1.48.5 → 1.49.0

## Migrations run

None. P0 is config + caching only — no DB schema change (hence MINOR, not MAJOR).

## Tests

- **Unit**: `TtlCache` (TTL expiry, zero-TTL disable, max-size eviction, recency
  refresh, delete, clear); cached session resolver (positive caching, no negative
  caching, zero-TTL passthrough); cached permission resolver (cache hit, admin-keyed
  isolation, errors not cached); `createDatabase` pool sizing (default + override).
- **E2E**: `tests/e2e/phase-scaling-to-concurrent-load.spec.ts` — repeated
  authenticated navigations stay consistent (cache serves the same identity);
  admin permissions resolve consistently across rapid repeat loads; unauthenticated
  and stale-cookie requests are rejected on every repeat (proves no negative caching).
- Full `./validate.sh` passes (typecheck, lint, all unit tests, coverage thresholds).

## Known limitations

- **Single-instance cache.** Invalidation is per-instance. Running >1 instance
  requires promoting the auth caches to a shared store (Redis) so a logout or role
  change is reflected everywhere within the TTL. The seam is in place for this.
- **Bounded staleness.** With a non-zero TTL, a logout or permission change can be
  served stale for up to `AUTH_CACHE_TTL_MS`. Kept to seconds by default; set to 0
  where zero staleness is required.
- **E2E not executed in the build sandbox.** The remote sandbox's network policy
  blocks Docker image registry blob pulls, so Postgres/MinIO could not be booted to
  run Playwright locally. The spec is discovered and parses cleanly via
  `playwright test --list`; it runs in CI on push, where infra is available.
- **P0 #2 (pooler) and the deployment-shape decision are not in this build** — they
  are infra/ops, tracked in the roadmap.
