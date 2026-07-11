# Implementation Summary — Code Quality: Hot Paths, Group F (rate limiting) (v2.2.0)

- **Version**: 2.2.0 (**MINOR** — new domain port + entity and adapter, plus two
  route guards. No schema change; off-path behaviour unchanged; defaults are
  generous enough not to affect normal usage).
- **Date**: 2026-07-05
- **Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition", **Group F
  — In-process rate limiting** (phase doc under `to-be-implemented/`). Independent
  of the other groups.
- **Scope built**: item **19** in full — an `IRateLimiter` token-bucket port on
  the auth POST and chat-stream POST endpoints.

## What was built

### Pure token-bucket domain logic

`packages/domain/src/entities/rate-limit.ts`: `RateLimitConfig`
(`capacity`/`refillPerSecond`), `TokenBucket`, and a pure `consumeToken(bucket,
config, nowMs)` that refills by elapsed time (capped at capacity), takes one
token if available, and reports `retryAfterMs` when empty. No IO — trivially
unit-testable.

### `IRateLimiter` port + in-memory adapter

- `packages/domain/src/ports/rate-limiter.ts`: `IRateLimiter.consume(key)` →
  `Promise<Result<RateLimitOutcome>>`. Async so the infrastructure phase can back
  it with a shared store (Redis `INCR`+`EXPIRE`) behind the same port; an error
  Result means the limiter failed and callers fail open.
- `packages/adapters/src/rate-limit/in-memory-rate-limiter.ts`:
  `InMemoryRateLimiter` holds a bounded, insertion-ordered `Map` of buckets
  (oldest evicted first, like `TtlCache`), driven by an injected `IClock`. A
  non-positive capacity disables the limiter (every request passes).

### Wiring + route guards

- `apps/web/src/lib/env.ts`: `AUTH_RATE_LIMIT_BURST` (default 20),
  `AUTH_RATE_LIMIT_REFILL_PER_SEC` (1), `CHAT_RATE_LIMIT_BURST` (30),
  `CHAT_RATE_LIMIT_REFILL_PER_SEC` (1), `RATE_LIMIT_MAX_KEYS` (10000).
- `apps/web/src/lib/container.ts`: constructs `authRateLimiter` and
  `chatRateLimiter` (sharing the `SystemClock`) and exposes them on `services`.
- `apps/web/src/lib/rate-limit.ts`: `clientIpFromHeaders` (X-Forwarded-For →
  X-Real-IP → "unknown") and `tooManyRequestsResponse` (429 + `Retry-After`).
- `apps/web/src/app/api/auth/[...all]/route.ts`: auth POST consumes `auth:<ip>`
  before the better-auth handler; a throttled request returns 429.
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts`: the chat stream POST
  consumes `chat:<userId>` right after auth resolves. Both fail open on a limiter
  error so a limiter bug can never lock users out.

## Files changed

- `packages/domain/src/entities/rate-limit.ts` (+ `.test.ts`) + entities barrel.
- `packages/domain/src/ports/rate-limiter.ts` + ports barrel.
- `packages/adapters/src/rate-limit/in-memory-rate-limiter.ts` (+ `.test.ts`) +
  `rate-limit/index.ts` + adapters barrel.
- `apps/web/src/lib/env.ts`, `apps/web/src/lib/container.ts`,
  `apps/web/src/lib/rate-limit.ts`.
- `apps/web/src/app/api/auth/[...all]/route.ts`,
  `apps/web/src/app/api/chat/[sessionId]/stream/route.ts`.
- `tests/e2e/phase-code-quality-hot-paths-group-f.spec.ts`.
- `VERSION`, `package.json` — 2.1.0 → 2.2.0.

## Migrations run

None.

## Tests added

- **Unit (domain)** — `consumeToken`: allows up to capacity then throttles with a
  1s `retryAfterMs`; refills over time; never banks beyond capacity; reports an
  infinite wait when refill is disabled and the bucket is empty.
- **Unit (adapters)** — `InMemoryRateLimiter`: burst-then-throttle, independent
  buckets per key, allow-again after a clock advance, and disabled at capacity 0.
- **E2E** — `phase-code-quality-hot-paths-group-f.spec.ts`: a tight burst of auth
  sign-in POSTs from one IP eventually returns 429 with a `Retry-After` header,
  proving the limiter is wired into the route.

## Known limitations / follow-ups

- **Per-instance only.** At N instances each enforces the configured budget, so
  the effective limit is N× the intended one until the infrastructure phase backs
  `IRateLimiter` with a shared store (Redis) — that promotion is a local adapter
  swap behind this port, exactly as designed.
- Defaults are deliberately generous (behaviour-neutral for normal usage);
  tighten via env per deployment.
