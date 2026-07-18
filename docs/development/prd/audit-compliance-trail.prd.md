# PRD — Audit & Compliance Trail

> Turns the existing `core_audit_log` (write-only today) into a compliance-grade
> audit trail: an admin viewer, export, optional SIEM streaming, tamper-evidence,
> and legal hold that overrides retention.

- **Status**: Draft
- **Date**: 2026-07-18
- **Author**: richy.brasier@gmail.com
- **Target version**: 2.6.0 (bump: **MINOR** — additive schema, new read surface. Tentative: assumes this lands first of the enterprise phases; take the next MINOR if not.)

## 1. Problem

Wayfinder already records actions to `core_audit_log` via `IAuditLogger`, but the
data is unreachable: there is no admin UI to view or search it, no way to export
it for auditors, and the retention worker can prune it (`RetentionConfig.coreAuditLogDays`).
For a product used by procurement, HR, and ops teams in governed processes, an
audit trail that nobody can read, export, or trust as immutable is not evidence.

## 2. Users / Personas

- **Compliance / audit officer** — needs to answer "who did what, when" over a
  date range and export it for an external auditor or regulator.
- **Administrator** — investigates incidents and access changes from the admin
  console without SQL access to the database.
- **Security / IT (SIEM operator)** — wants audit events streamed into the
  organisation's SIEM (Splunk, Microsoft Sentinel) alongside other systems.
- **Legal** — needs to freeze records relevant to a matter so retention cannot
  delete them.

## 3. Goals

- An admin can search/filter `core_audit_log` by actor, action, resource type,
  resource id, and date range, paginated, from `/admin/audit`.
- An admin can export the current filtered result set as CSV and JSON.
- Audit rows are append-only and tamper-evident: a modification or deletion is
  detectable.
- An operator can place a **legal hold** that prevents the retention worker from
  deleting held records, overriding `coreAuditLogDays` (and other windows).
- Optionally, audit events are forwarded to an external SIEM endpoint.

## 4. Non-goals

- No new categories of audited action in this phase (we surface what is already
  logged; expanding coverage is follow-up).
- No user-facing (non-admin) audit view.
- No cryptographic external notarisation/anchoring — an in-database hash chain
  is the tamper-evidence mechanism.
- No BYOK/KMS (tracked separately, gap #5).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `AuditLog` | `packages/domain/src/entities/audit-log.ts` | existing | Gains hash-chain fields (see §8). |
| `LegalHold` | `packages/domain/src/entities/legal-hold.ts` | new | A named hold scoping records exempt from retention. |
| `AuditQuery` | `packages/domain/src/entities/audit-query.ts` | new | Value object for filter/sort/pagination. |
| `SiemForwarder` | `packages/domain/src/ports/siem-forwarder.ts` | new port | Emits an audit event to an external sink; no-op when unconfigured. |

## 6. User stories

1. As a compliance officer, I can filter the audit log to "role changes by anyone in June" and export the result as CSV, so that I can hand it to an auditor.
2. As an administrator, I can open `/admin/audit`, page through recent events, and click into one to see its full metadata.
3. As legal, I can place a hold named after a matter so the retention sweep stops deleting the relevant audit and session history.
4. As a security operator, I can configure a SIEM endpoint so new audit events also land in Sentinel.
5. As an auditor, I can trust that a row could not have been silently altered, because the hash chain would break.

## 7. Pages / surfaces affected

- `/admin/audit` — **new** admin page: filter bar, results table, row detail, export buttons.
- `/admin/settings` — **new** SIEM streaming card (endpoint, format, enable toggle, masked token).
- tRPC: `audit.search`, `audit.export`, `audit.getById` (admin) — added.
- tRPC: `legalHold.list`, `legalHold.create`, `legalHold.release` (admin) — added.
- tRPC: `settings.getSiemConfig`, `settings.setSiemConfig` (admin) — added.
- `packages/adapters/src/retention/retention-worker.ts` — consults active legal holds before deleting.
- `packages/adapters/src/audit/drizzle-audit-logger.ts` — computes and writes the hash chain; optionally fans out to the SIEM forwarder.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `core_audit_log` | add `hash text not null`, `prev_hash text` (chain), `sequence bigserial`; drop `updated_at` | n/a (existing) |
| `app_legal_holds` | NEW — `id`, `name`, `reason`, `created_by`, `released_at`, scope columns, `created_at`, `updated_at` | yes (`app_`) |

DB-level tamper resistance: revoke `UPDATE`/`DELETE` on `core_audit_log` from the
application role, or install a trigger that rejects them, so append-only is
enforced by Postgres, not only by convention. `updated_at` is **dropped**: an
append-only row is written once and never updated, so the column would only ever
equal `created_at` and would falsely imply the row is mutable. `core_audit_log`
is therefore the one sanctioned exception to the `id`/`created_at`/`updated_at`
table convention (recorded in `CLAUDE.md`).

## 9. Architectural decisions

- **New:** ADR-033 — Immutable audit log (hash chain + DB-enforced append-only)
  and legal hold overriding retention.
- Assumes ADR-001 (hexagonal), ADR-021 (RBAC — audit pages are admin-gated), and
  the retention design behind `RetentionConfig`.

## 10. Acceptance criteria

- [ ] `/admin/audit` lists rows newest-first, paginated, and filters by actor, action, resourceType, resourceId, and date range.
- [ ] Export produces CSV and JSON of the *filtered* set, not just the page.
- [ ] Each new audit row stores `hash = H(prev_hash || canonical(row))`; a verifier procedure detects any altered or missing row.
- [ ] `UPDATE`/`DELETE` against `core_audit_log` by the app role fails.
- [ ] A record covered by an active legal hold is skipped by the retention sweep even when older than its window; releasing the hold re-enables pruning.
- [ ] When a SIEM endpoint is configured, a new audit event is delivered to it; when unconfigured, logging still succeeds (forwarder no-ops, fail-open on the SIEM path only).
- [ ] All new tRPC procedures reject non-admin callers.

## 11. Out of scope / future work

- Expanding *what* is audited (coverage of more actions).
- External notarisation / blockchain anchoring.
- SIEM delivery guarantees (retry queue / dead-letter) beyond best-effort.

## 12. Risks / open questions

- **Hash chain vs. concurrency:** a strict chain needs a serialised writer or a
  per-writer chain; decide in ADR-033 (a monotonic `sequence` + periodic chaining
  may suffice). 
- **Legal hold scope granularity:** hold everything vs. hold by session/actor/
  date — start coarse (global + by session) to avoid over-design.
- **Fail-open vs fail-closed on SIEM:** must not block the primary write; SIEM is
  best-effort, audited if it fails.
- **Retention interaction:** the worker must treat a hold as authoritative; a bug
  here deletes evidence — needs explicit tests.
