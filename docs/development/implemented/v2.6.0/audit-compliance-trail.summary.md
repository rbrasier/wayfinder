# Implementation Summary — Audit & Compliance Trail

- **Version**: 2.6.0 (**MINOR** — additive schema on `core_audit_log`, new
  `app_legal_holds` table, new admin/read surface)
- **Phase doc**: `audit-compliance-trail.phase.md` (this directory)
- **PRD / ADR**: `audit-compliance-trail.prd.md`, `033-immutable-audit-log-and-legal-hold.adr.md`
- **Branch**: `claude/audit-compliance-trail-review-friqys` (PR against `main`)

## What was built

Turns the previously write-only `core_audit_log` into a compliance-grade audit
trail: searchable/exportable from the admin console, append-only and
tamper-evident via an in-database hash chain, guarded by legal hold against
retention, and optionally streamed to a SIEM.

### Domain (`packages/domain`, pure, tests-first)

- `audit-hash.ts` — canonical serialisation + `computeAuditHash` +
  `verifyAuditChain`. The SHA-256 primitive is **injected** (`Sha256Hex`) so the
  domain keeps its zero-dependency, relative-imports-only constraint; the adapter
  supplies a `node:crypto` implementation.
- `legal-hold.ts` — `LegalHold` entity + coverage predicates (`hasGlobalHold`,
  `heldSessionIds`, `isRowCoveredByHold`) for `global` and `by_session` scopes.
- `audit-query.ts` — `buildAuditQuery` filter/pagination value object with range
  validation and limit clamping.
- `audit-export.ts` — pure CSV/JSON shaping (`toAuditCsv`, `toAuditJson`).
- `audit-log.ts` — **dropped `updatedAt`** (append-only), added `sequence`,
  `prevHash`, `hash`.
- New ports: `siem-forwarder`, `legal-hold-repository`, `audit-query-repository`.
- `runtime-config.ts` — `SiemConfig` + `parseSiemConfig` + `SIEM_CONFIG_SETTING_KEY`
  (registered as a sensitive/encrypted key).

### Adapters (`packages/adapters`)

- Schema: `core_audit_log` gains `sequence bigserial`, `prev_hash`, `hash` + a
  unique sequence index and **drops `updated_at`**; new `app_legal_holds` table.
- `DrizzleAuditLogger` — advisory-locked, in-transaction chain write (reads the
  max-sequence row's hash, sets `created_at` to the hashed instant), then
  best-effort SIEM fan-out **after** commit.
- `DrizzleAuditQueryRepository` — filtered/paginated `search`, `getById`,
  `exportRows`, `loadChain`.
- `HttpSiemForwarder` — no-op when unconfigured, **fail-open** on error, JSON or
  minimal CEF, bearer token; transport seam injected for testing.
- `DrizzleLegalHoldRepository` — create / list / listActive / release.
- Retention hold-guard placed in the **`ApplyRetentionPolicies` use-case + the
  repository** (not the poller — see design notes): a global hold freezes the
  whole sweep; a by_session hold excludes held rows. Audit deletes route through
  the privileged `core_audit_log_retention_delete` function.
- `RuntimeConfigStore` — `getSiemConfig` / `invalidateSiem` / `redactSiem`.

### Apps/web

- tRPC routers (all admin-gated): `audit.search/getById/export/verifyChain`,
  `legalHold.list/create/release`, `settings.getSiemConfig/setSiemConfig`.
- `/admin/audit` — filter bar, newest-first paginated table, row-detail dialog,
  CSV/JSON export of the filtered set, on-demand chain verification, and a Legal
  Holds card. Sidebar gains an **Audit** link.
- `/admin/settings` — SIEM streaming card (masked token).

## Files created / modified

**Created (domain):** `entities/audit-hash.ts`, `entities/legal-hold.ts`,
`entities/audit-query.ts`, `entities/audit-export.ts`,
`ports/siem-forwarder.ts`, `ports/legal-hold-repository.ts`,
`ports/audit-query-repository.ts` (+ tests).
**Created (adapters):** `audit/sha256.ts`, `audit/drizzle-audit-query-repository.ts`,
`audit/http-siem-forwarder.ts`, `repositories/drizzle-legal-hold-repository.ts`,
migrations `0029`–`0031` (+ tests).
**Created (web):** `server/routers/audit.ts`, `server/routers/legal-hold.ts`,
`app/(admin)/admin/audit/{page,_content,_legal-holds}.tsx`,
`components/settings/siem-streaming-card.tsx`,
`e2e/phase-audit-compliance-trail.spec.ts`.
**Modified:** `entities/audit-log.ts`, `entities/runtime-config.ts`,
`ports/retention-repository.ts`, indexes; `db/schema/core.ts`, `db/schema/app.ts`,
`audit/drizzle-audit-logger.ts`, `repositories/drizzle-retention-repository.ts`,
`config/runtime-config-store.ts`, `factory.ts`;
`use-cases/retention/apply-retention-policies.ts`; `server/routers/settings.ts`,
`server/router.ts`, `components/sidebar.tsx`, both `container.ts` files;
`CLAUDE.md` (recorded the `updated_at` convention exception), the PRD and ADR-033.

## Migrations

- `0029_audit_chain_and_legal_holds.sql` — adds `sequence`/`prev_hash`/`hash` +
  unique sequence index to `core_audit_log`; creates `app_legal_holds`.
- `0030_drop_audit_updated_at.sql` — drops `core_audit_log.updated_at`.
- `0031_audit_append_only_enforcement.sql` — reject trigger blocking
  UPDATE/DELETE on `core_audit_log`, plus the SECURITY DEFINER
  `core_audit_log_retention_delete(cutoff, batch, excluded_sessions)` function
  (the sole sanctioned deleter, hold-aware).

## E2E

`apps/web/e2e/phase-audit-compliance-trail.spec.ts` covers the admin audit
console (filter bar + export controls, chain-integrity check, row detail), a
legal-hold place-and-release flow, and the SIEM streaming card. Run via the
`/e2e` (Playwright MCP) skill against a running stack; excluded from the vitest
unit run.

## Design notes

- **`updated_at` dropped.** Per the resolved doc-review decision, `core_audit_log`
  is the one sanctioned exception to the `id`/`created_at`/`updated_at` table
  convention (recorded in `CLAUDE.md`): an append-only row is written once and
  never updated, so the column would only ever equal `created_at` and would
  falsely imply mutability.
- **Guard placement corrected.** The PRD/ADR named `retention-worker.ts`, but that
  file is only a poller; the actual delete lives in `ApplyRetentionPolicies` and
  the retention repository, so the hold-guard was implemented there.
- **Chain writer.** A single-key transaction advisory lock serialises audit
  writers, keeping the chain strictly ordered without insert retries; acceptable
  at audit volumes (ADR-033).

## Known limitations / future work

- Append-only is enforced by a reject trigger with a transaction-local bypass the
  SECURITY DEFINER retention function sets. Hardening to a named, `REVOKE`-based
  role for the retention path is deferred (a production hardening step; the trigger
  already blocks all ordinary UPDATE/DELETE).
- Migration `0029` adds `hash text NOT NULL` without a backfill, assuming a fresh
  (empty) audit table — correct for a pre-release alpha deploy; a populated table
  would need a backfill first.
- SIEM delivery is best-effort (no retry queue / dead-letter), per the PRD
  non-goals. The exact CEF field mapping is minimal and provider-tunable.
- `by_session` hold coverage of audit rows keys on `resource_id`; broader scope
  granularity is deliberately deferred (ADR-033 "start coarse").
