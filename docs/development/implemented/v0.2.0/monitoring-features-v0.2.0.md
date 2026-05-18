# Monitoring Features — v0.2.0

## Version bump: MINOR (0.1.2 → 0.2.0)
New DB tables, new ports/adapters, new use cases. No breaking API changes.

## Problem
Template-derived apps shipped without structured logging, real dependency health
checks, audit trails, feature-flag capability, LLM cost visibility, or job health
tracking. Ops teams had no production-ready observability surface out of the box.

## Scope

### 1 — Pino structured logging
- `ILogger` port in domain
- `PinoLogger` adapter — emits JSON to stdout; `pino-pretty` in dev
- Replaces `console.*` calls across both apps
- Wired into all containers

### 2 — Composite health endpoint (`GET /health`)
Single endpoint returns a status object for every external dependency:
- `db` — SELECT 1 via Drizzle with latency
- `redis` — PING via ioredis with latency
- `ai` — configured provider + key present check
- `jobs` — worst-status across registered jobs
Overall `ok` is `false` if any service is degraded.
HTTP 200 always (let the caller decide alerting); body carries `ok: false` when degraded.

### 3 — OpenTelemetry HTTP + DB tracing
- `setupTelemetry()` in adapters, called before app boot
- `@opentelemetry/sdk-node` + `@opentelemetry/instrumentation-express` + `@opentelemetry/instrumentation-http`
- OTLP exporter when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; no-op otherwise
- Env vars: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`

### 4 — Audit log
- `AuditLog` entity, `IAuditLogger` port
- Schema: `core_audit_log` (actor_id, action, resource_type, resource_id, metadata)
- `DrizzleAuditLogger` adapter
- `LogAuditEvent` use case

### 5 — Feature flags
- `FeatureFlag` entity, `IFeatureFlagRepository` port
- Schema: `core_feature_flag` (key, enabled, rollout_pct, description)
- `DrizzleFeatureFlagRepository` adapter
- `GetFeatureFlag` use case
- Admin tRPC router + `/admin/flags` UI page

### 6 — LLM cost tracking
- `UsageEvent` entity, `IUsageRepository` port
- Schema: `ai_usage_event` (model, provider, prompt_tokens, completion_tokens, cost_usd, user_id, conversation_id)
- `DrizzleUsageRepository` adapter + `UsageTrackingAdapter` decorator (wraps ILanguageModel)
- `TrackUsage` + `GetUsageSummary` use cases
- Admin tRPC router + `/admin/usage` UI page

### 8 — Job health
- `Job` entity, `IJobRepository` port
- Schema: `job_registry` (name, status, last_run_at, next_run_at, error_count, last_error)
- `DrizzleJobRepository` adapter
- `RegisterJob`, `PingJob`, `FailJob` use cases
- Included in `/health` response under `jobs`

### validate.sh enhancements
- Section 9: verify health-checker adapters exist in code (static check)
- Section 10: live service connectivity (WARN-only, never FAIL — safe for CI)
  - Postgres: `pg_isready`
  - Redis: `redis-cli ping`
  - AI: at least one provider key set in env

## DB tables introduced
| Table | Group | Key columns |
|---|---|---|
| `core_audit_log` | core | actor_id, action, resource_type, resource_id, metadata |
| `core_feature_flag` | core | key (unique), enabled, rollout_pct, description |
| `ai_usage_event` | ai | model, provider, prompt_tokens, completion_tokens, cost_usd |
| `job_registry` | job | name (unique), status, last_run_at, error_count |

## Known limitations
- AI health check does not make a live API call (avoids cost); key presence only
- OTel Drizzle instrumentation is at the pg driver level via `@opentelemetry/instrumentation-pg`
- Feature flag rollout_pct is stored but percentage-rollout logic is left to the consumer
- Job scheduler is not included; `job_registry` is a health/heartbeat table only
