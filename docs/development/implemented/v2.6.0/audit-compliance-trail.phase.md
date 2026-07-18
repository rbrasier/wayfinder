# Phase — Audit & Compliance Trail

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: 2.6.0 — **MINOR** (schema change on `core_audit_log`,
  new `app_legal_holds` table, new read/admin surface). Tentative sequencing.
- **PRD**: `docs/development/prd/audit-compliance-trail.prd.md`
- **ADR**: `docs/development/adr/033-immutable-audit-log-and-legal-hold.adr.md`
- **Depends on**: ADR-021 (RBAC — pages are admin-gated), retention worker +
  `RetentionConfig`, `RuntimeConfigStore` settings pattern.

## 1. Goal

Make `core_audit_log` usable and trustworthy: searchable + exportable from the
admin console, append-only and tamper-evident, guarded by legal hold against
retention, and optionally streamed to a SIEM.

## 2. What is built

| Layer | File(s) | Change |
| ----- | ------- | ------ |
| domain | `entities/audit-hash.ts`, `entities/legal-hold.ts`, `entities/audit-query.ts` | Pure hash/canonicalisation, hold predicate, filter value object (tests first). |
| domain | `entities/audit-log.ts` | Add `sequence`, `prevHash`, `hash`; drop `updatedAt` (append-only, never updated). |
| domain | `ports/siem-forwarder.ts`, `ports/legal-hold-repository.ts`, `ports/audit-query-repository.ts` | New ports. |
| adapters | `db/schema/core.ts` | `core_audit_log`: add `hash`, `prev_hash`, `sequence`; drop `updated_at`. |
| adapters | `db/schema/app.ts` | New `app_legal_holds`. |
| adapters | `audit/drizzle-audit-logger.ts` | Compute chain in-tx; fan out to SIEM forwarder post-commit. |
| adapters | `audit/audit-query-repository.ts` | Filtered, paginated read + CSV/JSON export shaping. |
| adapters | `audit/http-siem-forwarder.ts` | Best-effort forwarder; no-op when unconfigured. |
| adapters | `retention/retention-worker.ts` | Legal-hold guard before every delete. |
| adapters | migration | Revoke `UPDATE`/`DELETE` on `core_audit_log` from the app role (or reject-trigger); privileged retention delete path. |
| apps/web | `server/routers/audit.ts`, `server/routers/legal-hold.ts` | `search`/`getById`/`export`, hold `list`/`create`/`release` (admin). |
| apps/web | `server/routers/settings.ts` | `get/setSiemConfig` (masked token). |
| apps/web | `app/(admin)/admin/audit/page.tsx` | Filter bar, table, row detail, export. |
| apps/web | `app/(admin)/admin/settings` | SIEM streaming card. |

## 3. Database changes

- `core_audit_log`: `+ hash text not null`, `+ prev_hash text`, `+ sequence bigserial`; drop `updated_at` (append-only; the one sanctioned exception to the `updated_at` convention).
- `app_legal_holds`: `id uuid`, `name text`, `reason text`, `created_by uuid`,
  `scope jsonb`, `released_at timestamptz`, `created_at`, `updated_at`.
- Grant change: app role loses `UPDATE`/`DELETE` on `core_audit_log`.

## 4. Implementation order (tests first)

1. Domain: `audit-hash` (canonical + chain), `legal-hold` predicate, `audit-query` — unit tests → impl.
2. Schema migration + grant revocation; `verifyAuditChain` recompute.
3. `DrizzleAuditLogger` chain write (in-tx prior-hash read) — test the chain end-to-end.
4. Retention worker hold-guard — test "held row survives, released row prunes".
5. `audit.search`/`export`/`getById` + admin page.
6. `legalHold.*` procedures + minimal admin UI.
7. SIEM config + `HttpSiemForwarder` (fail-open) + settings card.

## 5. ADR required

ADR-033 (above). No other ADR touched.

## 6. Risks / open questions

Carried from PRD §12: hash-chain concurrency (per-sequence chain + retry),
legal-hold scope granularity (start `global` + `by_session`), fail-open SIEM,
and the retention/hold deletion interaction (the highest-risk test surface —
deleting under a hold loses evidence).
