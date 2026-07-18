# ADR-033 — Immutable Audit Log & Legal Hold

- **Status**: Proposed (scoped by `audit-compliance-trail.prd.md`)
- **Date**: 2026-07-18

## Context

`core_audit_log` is written through `IAuditLogger` / `DrizzleAuditLogger` and is
otherwise inert: no reader, no export, and — critically — the retention worker
can delete from it (`RetentionConfig.coreAuditLogDays`, one of the
`RETENTION_TARGET_KEYS`). The `AuditLog` entity even carries an `updatedAt`,
implying rows are mutable.

Two properties an auditor assumes are therefore false today:

1. **Immutability** — nothing stops an `UPDATE`/`DELETE` on an audit row.
2. **Durability under legal obligation** — the retention sweep prunes audit
   history on a schedule, with no way to freeze records tied to a live matter.

Constraints:

1. **Hexagonal boundary (ADR-001).** The hash-chain computation is domain logic
   (pure, testable); the DB enforcement lives in `packages/adapters`; wiring
   stays in the app container.
2. **Don't block the hot path.** Audit logging must stay a single cheap insert;
   tamper-evidence must not require a table scan per write.
3. **Retention already exists.** Legal hold layers on top of the existing
   retention worker rather than replacing it.
4. **Fail closed on integrity, fail open on forwarding.** A broken hash chain is
   a hard signal; a down SIEM endpoint must never fail the primary write.

## Decision

### 1. Append-only enforced by Postgres, not convention

Revoke `UPDATE` and `DELETE` on `core_audit_log` from the application database
role. Because the app cannot rewrite history, the audit table is append-only at
the engine level. The retention sweep is the sole exception and runs as a
distinct, narrowly-scoped `DELETE` path (see §3) — either under a role permitted
to delete, or via a `SECURITY DEFINER` function that refuses to touch held rows.
`updated_at` is **dropped**: an audit event is written once and never updated, so
the column would be permanently equal to `created_at` and would falsely imply the
row is mutable — the very assumption this ADR removes. `core_audit_log` is the one
documented exception to the `id`/`created_at`/`updated_at` table convention (noted
in `CLAUDE.md`); the `AuditLog` entity loses its `updatedAt` field to match.

### 2. Tamper-evidence via a hash chain

Each row gains `sequence bigserial`, `prev_hash text`, and `hash text not null`
where `hash = SHA-256(prev_hash || canonicalJSON(actorId, action, resourceType,
resourceId, metadata, createdAt, sequence))`. `canonicalJSON` and the hashing
rule are pure functions in `packages/domain` (`audit-hash.ts`) so they are unit
tested independently of Drizzle.

To avoid a serialisation bottleneck, chaining is **per monotonic sequence**: the
writer reads the previous row's `hash` for `sequence - 1` inside the same
transaction as the insert. Under contention the transaction retries; audit
volume is low relative to the hot request path, so this is acceptable. A
`verifyAuditChain` admin procedure recomputes the chain and reports the first
break — that is the detection mechanism; the chain is not consulted on the write
hot path beyond reading one prior hash.

### 3. Legal hold overrides retention

Add `app_legal_holds` (`id`, `name`, `reason`, `created_by`, `scope`,
`released_at`, timestamps). A hold's `scope` is coarse in this phase: `global`
(freeze all retention) or `by_session` (freeze a session's audit + messages).
The retention worker gains a pre-delete guard: before deleting rows from any
`RetentionTargetKey`, it excludes rows covered by an **active** (`released_at IS
NULL`) hold. A `global` hold short-circuits the sweep entirely. Releasing a hold
re-enables pruning on the next run.

The guard lives in the worker (adapter); which rows a hold covers is decided by a
pure predicate in the domain so it is testable without a database.

### 4. SIEM forwarding is a best-effort port

Introduce `SiemForwarder` (`packages/domain/src/ports/siem-forwarder.ts`) with a
single `forward(event)` returning `Result`. `DrizzleAuditLogger` fans out to it
**after** the primary insert commits. When no SIEM endpoint is configured the
forwarder is a no-op; when configured but failing, the failure is logged and
swallowed — it never fails `log()`. Config (endpoint, format `cef|json`, masked
token, enable flag) is stored in `admin_system_settings` via the existing
`RuntimeConfigStore` pattern, exactly like the AI/email/auth configs, with env
fallbacks the DB overrides.

> The exact CEF/syslog field mapping and any HTTP framing must be verified
> against the chosen transport during Build; this ADR does not freeze it.

## Alternatives considered

- **App-level "don't update" convention only.** Rejected — an audit control an
  admin (or a bug) can bypass is not an audit control. DB-enforced append-only is
  the point.
- **Per-request synchronous hash over the whole table.** Rejected — O(n) per
  write. The single-prior-hash chain plus an on-demand verifier gives the same
  detection with an O(1) write.
- **A separate immutable store (e.g. append-only object storage / QLDB).**
  Heavier operationally and a new dependency; the existing Postgres table with
  revoked grants + hash chain meets the requirement without new infrastructure.
- **Delete-and-tombstone instead of legal hold.** Rejected — retention deleting
  under a hold, even with a tombstone, loses the evidence the hold exists to
  preserve.

## Consequences

**Positive**

- Audit rows become append-only and tamper-evident with no new infrastructure.
- Legal hold reuses the existing retention worker; the net new surface is a
  table, a pure predicate, a guard in the worker, and admin procedures.
- SIEM forwarding follows the proven runtime-config + masked-secret pattern and
  cannot destabilise the primary write.

**Negative**

- Revoking `DELETE` complicates the retention path, which now needs a
  privileged deletion route that honours holds — a sharp edge that must be
  covered by tests (deleting under a hold is the failure that loses evidence).
- The hash chain adds a prior-row read inside the insert transaction and a retry
  under contention; acceptable at audit volumes but not free.
- Revoking `UPDATE`/`DELETE` from the app role means the audit table's grants
  differ from every other table; migrations and any admin tooling that assumes
  full DML on `core_*` must account for it.
