# Remove Redis

## Summary

Redis was only used for a single health check `PING` — no queues, no caching, no sessions.
The job system runs off Postgres (`job_registry` table). There was no real dependency on Redis.

## Changes

- Deleted `packages/adapters/src/health/redis-health-checker.ts`
- Removed `RedisHealthChecker` from `CompositeHealthChecker` constructor and `check()` logic
- Removed `redis: ServiceStatus` from the `SystemHealth` domain entity
- Removed `redisUrl` from `AdaptersConfig` in `factory.ts`
- Removed `ioredis` from `peerDependencies` and `devDependencies` in `packages/adapters/package.json`
- Removed `REDIS_URL` from `apps/api/src/env.ts` and `apps/api/src/container.ts`
- Removed `redis` service from `docker-compose.yml` and `redis-data` volume
- Removed `REDIS_URL` from `.env.example`
- Removed Redis from `ci.yml` and `e2e.yml` workflows
- Updated `validate.sh` — removed `redis-health-checker.ts` from required file list and removed Redis connectivity check
- Updated `docs/guides/setup-admin.md` — removed Redis from infrastructure table
- Updated `system.test.ts` fixture to remove `redis` from `healthySystem`

## Version bump

1.5.2 → 1.5.3 (PATCH — no schema change)
