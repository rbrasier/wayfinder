# v1.35.0 — Email Notifications (Implementation Summary)

**Version bump:** MINOR (1.34.1 → 1.35.0) — new table, new domain entity/port,
new adapter. No breaking change.

**PRD:** `docs/development/prd/email-notifications.prd.md`
**ADR:** `docs/development/adr/023-email-notification-transport.adr.md`
**Phase doc:** `docs/development/implemented/v1.35.0/email-notifications.phase.md`

## What was built

Transactional email for two triggers, via an outbox-backed delivery model:

1. **Session complete** — when a session transitions to `status = 'complete'`
   (conversational turn, auto-node callback, or scheduled-node fire), the
   session owner is emailed a link back to the session.
2. **Flow shared** — when a user is newly added to a flow's `permissions`
   (`flow.grantOwner`), that user is emailed a link to the flow naming the
   granter and assigned role. Already-present members are not re-notified.

Each trigger writes a `pending` row to `app_notification_log` (the outbox), then
a best-effort send flips it to `sent`/`failed`. A unique index on
`(trigger, resource_id, recipient_email)` makes sends idempotent. Every send
attempt writes a `notification.sent` / `notification.failed` audit event to
`core_audit_log`. A failed or slow send never blocks the triggering action — all
notifier calls at the call sites are fire-and-forget.

## Deviations from the phase doc (confirmed at build via doc-review)

- **Reused `IEmailSender` instead of a new `INotificationSender`.** The codebase
  already had an email port (`packages/domain/src/ports/email-sender.ts`) and a
  `NodemailerEmailSender` adapter configured through the admin settings UI. Per
  the architecture rules (no dead code, no parallel systems), notifications send
  through the existing port; the adapter was **extended** with ADR-023's
  transport modes. ADR-023 (renumbered from the drafted ADR-014, which collided
  with an existing ADR-014) records this. `EmailMessage` from the PRD was not
  introduced; `SendEmailInput` (the existing value object) is used.
- **Share path is `flow.grantOwner`, not `flow.assignOwner`.** No `assignOwner`
  procedure exists; `grantOwner` is the admin procedure that mutates
  `app_flows.permissions`.
- **No retry sweeper in v1.** A single inline best-effort attempt ships now; the
  repository exposes `listPending` for a future sweeper.
- **`NOTIFICATIONS_ENABLED=false`** writes the outbox row (`pending`) but skips
  the send, so the event is auditable and recoverable.
- **Transport precedence.** When `SMTP_TRANSPORT_MODE` is set, the env-driven
  transport is used (credentials environment-only); otherwise the adapter falls
  back to the admin-settings SMTP config, so existing deployments are unaffected.

## Files created

| Layer | File |
|-------|------|
| domain | `packages/domain/src/entities/notification-log.ts` |
| domain | `packages/domain/src/ports/notification-log-repository.ts` |
| application | `packages/application/src/use-cases/notifications/templates.ts` (+ test) |
| application | `packages/application/src/use-cases/notifications/notify-on-session-complete.ts` (+ test) |
| application | `packages/application/src/use-cases/notifications/notify-on-flow-shared.ts` (+ test) |
| application | `packages/application/src/use-cases/notifications/index.ts` |
| adapters | `packages/adapters/src/email/smtp-transport.ts` (+ test) |
| adapters | `packages/adapters/src/repositories/drizzle-notification-log-repository.ts` |
| adapters | `packages/adapters/drizzle/0021_email_notification_log.sql` (migration) |
| apps/web | `apps/web/src/app/api/test/notifications/route.ts` (E2E read-only outbox endpoint, TEST_AUTH_BYPASS only) |
| tests | `tests/e2e/phase-email-notifications.spec.ts` |

## Files modified

- `packages/domain/src/entities/index.ts`, `ports/index.ts` — barrel exports.
- `packages/application/src/use-cases/index.ts` — barrel export.
- `packages/application/src/use-cases/session/run-turn.ts` — invoke notifier on
  no-outgoing-edge completion (optional injected `ISessionCompleteNotifier`).
- `packages/application/src/use-cases/session/apply-auto-node-result.ts` — same,
  for the auto-node callback completion path.
- `packages/application/src/use-cases/scheduling/advance-scheduled-node.ts` —
  same, for the scheduled-node fire completion path.
- `packages/adapters/src/email/nodemailer-email-sender.ts` — env-driven
  transport selection (oauth2/smtp/stream) with admin-settings fallback; M365
  client-credentials token fetch + cache.
- `packages/adapters/src/email/index.ts`, `repositories/index.ts` — barrels.
- `packages/adapters/src/db/schema/wayfinder.ts` — `app_notification_log` table.
- `apps/web/src/lib/container.ts`, `apps/api/src/container.ts` — wire the sender,
  repository, and notifiers; pass the notifier into the three completion paths.
- `apps/web/src/lib/env.ts`, `apps/api/src/env.ts` — notification env vars.
- `apps/web/src/server/routers/flow.ts` — `grantOwner` invokes `NotifyOnFlowShared`
  with previous + next permissions.
- `apps/web/src/lib/e2e-fixtures.ts` — clear `app_notification_log` on teardown.
- `.env.example` — documented the notification env vars (stream default).
- `VERSION`, `package.json` — 1.35.0.

## Migration run

`0021_email_notification_log.sql` — creates `app_notification_log` with the
idempotency unique constraint on `(trigger, resource_id, recipient_email)` and a
`(status, created_at)` index for the future sweeper. Verified applied against a
local Postgres 16 + pgvector instance.

## Tests

- **Unit (domain/application):** 27 new tests across `templates`,
  `notify-on-session-complete`, `notify-on-flow-shared`, plus notifier-wiring
  cases added to `RunTurn`, `ApplyAutoNodeResult`, and `AdvanceScheduledNode`.
  Full application suite: 275 passing.
- **Unit (adapters):** `smtp-transport` (10) and `nodemailer-email-sender` (4)
  covering transport-option mapping, M365 token fetch, and admin-settings
  fallback.
- **E2E:** `tests/e2e/phase-email-notifications.spec.ts` — sharing a flow writes
  exactly one `flow_shared` outbox row for the newly added user, a repeat grant
  does not duplicate it (idempotency), and granting on a nonexistent flow fails
  visibly while writing no row. Reads the outbox through the test-only endpoint.

## Known limitations

- No retry sweeper — `pending`/`failed` rows are not yet re-attempted.
- No per-user preferences / unsubscribe (out of scope, PRD §11).
- A legitimately re-shared-after-revoke grant will not re-notify (the unique
  index already holds the row) — accepted per PRD §12.

`./validate.sh` passes (14/14).
