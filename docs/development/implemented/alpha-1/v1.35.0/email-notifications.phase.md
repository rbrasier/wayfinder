# Phase — Email Notifications

- **Status**: Implemented (v1.35.0 — see `_implementation-summary.md` for
  build-time deviations: the existing `IEmailSender` port was reused instead of
  a new `INotificationSender`, and `flow.grantOwner` is the share path, not
  `flow.assignOwner`)
- **Target version**: 1.35.0 (bump: **MINOR** — new table, new domain port, new
  adapter)
- **PRD**: `docs/development/prd/email-notifications.prd.md`
- **ADR**: `docs/development/adr/023-email-notification-transport.adr.md`
- **Depends on**: v1.18.0 (sessions, flows, permissions, `core_audit_log`)

## 1. Goal

Deliver transactional email for two triggers — **session complete** and **flow
shared / permission granted** — via a Nodemailer SMTP adapter that supports
Microsoft 365 / Exchange Online (OAuth2/XOAUTH2) and generic SMTP AUTH, with an
outbox-backed delivery model on `app_notification_log`.

## 2. Approach

Hexagonal, outbox-driven:

1. A domain port `INotificationSender` describes "send an email"; the
   application composes subject/body and enqueues; the adapter transports.
2. The triggering action commits a `pending` `app_notification_log` row in its
   own transaction (the outbox), then a best-effort send runs out of band and
   flips the row to `sent`/`failed`.
3. Idempotency via a unique index on `(trigger, resource_id, recipient_email)`.

See ADR-023 for transport modes and the delivery model.

## 3. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/ports/notification-sender.ts` | New `INotificationSender` + `EmailMessage`. |
| domain | `packages/domain/src/entities/notification-log.ts` | New `NotificationLog` entity (also the outbox row). |
| domain | `packages/domain/src/ports/notification-log-repository.ts` | New `INotificationLogRepository` (`enqueue`, `markSent`, `markFailed`, `listPending`, `existsFor`). |
| application | `packages/application/src/use-cases/notifications/notify-on-session-complete.ts` | Compose + dedupe + enqueue on session completion. |
| application | `packages/application/src/use-cases/notifications/notify-on-flow-shared.ts` | Diff old vs new `permissions`; enqueue per newly added user. |
| application | `packages/application/src/use-cases/notifications/templates.ts` | Pure subject/text/HTML builders (no framework). |
| adapters | `packages/adapters/src/notifications/smtp-notification-sender.ts` | Nodemailer; `oauth2` / `smtp` / `stream` modes. |
| adapters | `packages/adapters/src/repositories/drizzle-notification-log-repository.ts` | Outbox/log persistence. |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | New `app_notification_log` table. |
| adapters | `packages/adapters/drizzle/<next>.sql` | Migration: create table + unique index. |
| apps/web | `apps/web/lib/container.ts` | Construct sender from config; inject use-cases. |
| apps/web | session-completion path (agent advance / session service) | Invoke `NotifyOnSessionComplete` after commit. |
| apps/web | `flow.update` / `flow.assignOwner` tRPC procedures | Invoke `NotifyOnFlowShared` with previous + next permissions. |

## 4. Database changes

### New table: `app_notification_log`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `recipient_email` | text | resolved from `core_users.email` |
| `recipient_user_id` | uuid FK → `core_users` | nullable |
| `trigger` | text | `session_complete` \| `flow_shared` |
| `resource_type` | text | `session` \| `flow` |
| `resource_id` | text | session or flow id |
| `subject` | text | |
| `status` | text | `pending` \| `sent` \| `failed` |
| `error` | text | nullable |
| `attempts` | smallint | default 0 |
| `sent_at` | timestamptz | nullable |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Unique index on `(trigger, resource_id, recipient_email)` for idempotency.

## 5. Environment variables

Per ADR-023: `NOTIFICATIONS_ENABLED`, `SMTP_TRANSPORT_MODE`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `M365_TENANT_ID`,
`M365_CLIENT_ID`, `M365_CLIENT_SECRET`, `SMTP_FROM`. Add to `.env.example` with
the `stream` (local sink) mode as the documented default for dev/tests.

## 6. Implementation order (tests first)

1. `app_notification_log` schema + migration; repository test → repository.
2. `INotificationSender` port; `SmtpNotificationSender` test (against a local
   SMTP sink) → adapter, covering `smtp` and `oauth2` mode selection.
3. Template builders test → `templates.ts`.
4. `NotifyOnSessionComplete` / `NotifyOnFlowShared` use-case tests (dedupe,
   newly-added-only, failure-is-non-blocking) → use-cases.
5. Wire into the session-completion and flow-share paths; container wiring.

Write the test file before each implementation file (CLAUDE.md rule).

## 7. ADR required

ADR-023 (written) — transport choice, M365 OAuth2, outbox delivery model,
env-var contract.

## 8. Risks / open questions

Carried from PRD §12: M365 OAuth2 grant type, whether the retry sweeper ships in
v1, idempotency-after-revoke behaviour, keeping PII out of bodies,
environment-only secrets, and skipping users without a usable email.

## 9. Acceptance criteria

Mirror PRD §10. At minimum:

- [ ] Session completion and flow-share each create the right outbox row(s) and
      send; rows flip to `sent`.
- [ ] Re-share to an existing member sends nothing; duplicate triggers do not
      double-send.
- [ ] SMTP failure marks `failed` and never breaks the triggering action.
- [ ] OAuth2 mode authenticates via XOAUTH2 against M365; SMTP mode against a
      generic relay.
- [ ] Audit events written; no mail/framework import outside `packages/adapters`.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.
