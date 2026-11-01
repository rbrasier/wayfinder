# PRD — Email Notifications

> Phase 6+ feature drawn from `wayfinder.prd.md` §11 ("Out of scope / future
> work"). Scopes outbound email for two triggers: **session completed** and
> **flow shared / permission granted**. Route to the Documentation Review skill
> before any code is written.

- **Status**: Implemented (v1.35.0)
- **Date**: 2026-05-31
- **Author**: Solo / Claude Code
- **Target version**: 1.35.0 (bump: **MINOR** — new table, new domain port, new
  adapter; no breaking change. See `docs/guides/versioning.md`.)

## 1. Problem

Wayfinder is entirely pull-based today: a user only learns that their session
finished, or that a colleague granted them access to a flow, by being in the
app at the right moment. Long-running sessions (a procurement can span days)
and access grants happen out of band, so the people who care are not told.
There is no outbound channel of any kind in the codebase — no mailer, no port,
no template.

## 2. Users / Personas

- **Procurement Officer (session owner)** — wants to know when a session they
  own reaches `complete` so they can collect the generated artefacts without
  polling the app.
- **Flow Owner / Collaborator (share recipient)** — when added to a flow's
  `permissions`, wants an email with a direct link so they can act on the
  newly shared flow without being told verbally.
- **Admin / Operator** — configures the SMTP transport (including Microsoft 365
  / Exchange Online) once per deployment and needs visibility into delivery
  successes and failures for support.

## 3. Goals

- When a session transitions to `status = 'complete'`, the session owner
  receives an email naming the flow and session and linking to the session.
- When a user is added to a flow's `permissions` (any role), that user receives
  an email naming the flow, the granter, and the assigned role, linking to the
  flow.
- Email is sent through a single configurable SMTP transport that supports both
  **generic SMTP AUTH** (self-hosted relays, dev) and **OAuth2 / XOAUTH2** for
  Microsoft 365 / Exchange Online (see ADR-023).
- Every send attempt is recorded in `app_notification_log` with its delivery
  status, so an admin can see what was sent and why a send failed.
- A failed or slow email **never** blocks or rolls back the triggering action
  (completing a session, sharing a flow). Delivery is decoupled via an outbox
  on `app_notification_log`.
- Sends are idempotent per (trigger, resource, recipient): a given
  session-complete or share event emails a recipient at most once.

## 4. Non-goals

- **No per-user notification preferences or unsubscribe** this round — every
  in-scope trigger always sends. Preferences are listed in §11.
- **No auto-node / document-ready notifications** — only the two triggers above.
- **No in-app notification centre, web push, or SMS.** Email only.
- **No digests or batching** — one event, one email.
- **No localisation / templated branding system** beyond a single plain
  subject + text + minimal HTML body composed in the application layer.
- **No marketing / bulk email.** Transactional only.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `INotificationSender` (port) | `packages/domain/src/ports/notification-sender.ts` | new | `send(message: EmailMessage): Promise<Result<true>>`. Provider-agnostic transport only. |
| `EmailMessage` (value object) | `packages/domain/src/entities/email-message.ts` | new | `to`, `subject`, `textBody`, `htmlBody`. No provider concepts. |
| `NotificationLog` (entity) | `packages/domain/src/entities/notification-log.ts` | new | Backs `app_notification_log`; doubles as the outbox row. |
| `INotificationLogRepository` (port) | `packages/domain/src/ports/notification-log-repository.ts` | new | `enqueue`, `markSent`, `markFailed`, `listPending`, `existsFor(trigger, resourceId, recipient)`. |
| `SmtpNotificationSender` (adapter) | `packages/adapters/src/notifications/smtp-notification-sender.ts` | new | Nodemailer; SMTP AUTH + XOAUTH2 (ADR-023). |
| `DrizzleNotificationLogRepository` | `packages/adapters/src/repositories/drizzle-notification-log-repository.ts` | new | Implements the log/outbox port. |
| `NotifyOnSessionComplete` (use-case) | `packages/application/src/use-cases/notifications/notify-on-session-complete.ts` | new | Composes the `EmailMessage`, dedupes, enqueues. |
| `NotifyOnFlowShared` (use-case) | `packages/application/src/use-cases/notifications/notify-on-flow-shared.ts` | new | Diffs old vs new `permissions`, emails only newly added users. |
| `core_audit_log` | `packages/adapters/src/db/schema/core.ts` | existing | Reuse: log a `notification.sent` / `notification.failed` audit event. |

Subject and body strings are composed in the **application layer** as pure
string builders (template literals only — no templating framework, satisfying
the "application imports only domain + shared" rule). The adapter is a dumb
transport.

## 6. User stories

1. As a **procurement officer**, when my session is marked complete, I get an
   email titled "Your '<Flow>' session is complete" with a link back to it.
2. As a **collaborator**, when an owner shares a flow with me, I get an email
   "<Granter> shared the '<Flow>' flow with you" with a link to open it.
3. As an **admin**, I configure SMTP/M365 credentials via environment variables
   and confirm a test send succeeds.
4. As an **admin**, I view `app_notification_log` (via DB or a future admin
   page) and see each attempt's recipient, trigger, status, and error.

## 7. Pages / surfaces affected

- **Session completion path** — wherever a session's status becomes
  `complete` (the agent advance / session service), invoke
  `NotifyOnSessionComplete` after the state is committed.
- **Flow share path** — `flow.update` / `flow.assignOwner` tRPC procedures that
  mutate `app_flows.permissions` invoke `NotifyOnFlowShared` with the previous
  and next permission sets.
- **tRPC** — no new user-facing router required for v1. (Optional, deferred: an
  admin `notification.listLog` read procedure — see §11.)
- **Wiring** — `apps/web/lib/container.ts` constructs `SmtpNotificationSender`
  from config and injects the notification use-cases.
- **Config** — new environment variables (see ADR-023): transport host/port,
  auth mode, and the M365 OAuth2 client credentials.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_notification_log` | NEW — id, recipient_email text, recipient_user_id uuid (nullable, FK → `core_users`), trigger text (`session_complete` / `flow_shared`), resource_type text, resource_id text, subject text, status text (`pending` / `sent` / `failed`), error text (nullable), attempts smallint default 0, sent_at timestamptz (nullable), created_at, updated_at | yes (`app_`) |

The row is created as `pending` (the outbox), flipped to `sent` or `failed` by
the sender. A unique index on `(trigger, resource_id, recipient_email)`
enforces idempotency. Columns are snake_case; `id`/`created_at`/`updated_at`
present per convention.

## 9. Architectural decisions

### Existing ADRs assumed

- **ADR-001 Hexagonal Architecture** — `INotificationSender` and
  `INotificationLogRepository` are domain ports; only `packages/adapters`
  knows about Nodemailer or SMTP.
- **ADR-003 Monorepo Structure** — the adapter is an npm dep of
  `@wayfinder/adapters`; wiring lives in `apps/web/lib/container.ts`.

### New ADR introduced by this PRD

- **ADR-023 Email Notification Transport** — selects Nodemailer with a single
  SMTP transport supporting SMTP AUTH and OAuth2/XOAUTH2 for Microsoft 365 /
  Exchange Online; defines the outbox-on-`app_notification_log` delivery model
  and the environment-variable contract.

## 10. Acceptance criteria

- [ ] Completing a session writes one `app_notification_log` row
      (`trigger='session_complete'`, `status='pending'`) and the owner receives
      an email; the row flips to `sent`.
- [ ] Adding a user to a flow's `permissions` writes one row
      (`trigger='flow_shared'`) per **newly added** user and each receives an
      email; users already present receive nothing.
- [ ] A second identical trigger for the same `(trigger, resource_id,
      recipient)` does **not** create a second row or send a second email.
- [ ] An SMTP failure marks the row `failed` with the error captured and the
      triggering action (session completion / share) still succeeds.
- [ ] With M365 OAuth2 env vars set, the adapter authenticates via XOAUTH2 and
      delivers against `smtp.office365.com`; with SMTP-AUTH vars set, it
      authenticates with username/password against a generic relay. (Verified
      against a local SMTP sink such as Mailpit in tests.)
- [ ] A `notification.sent` / `notification.failed` audit event is written to
      `core_audit_log` for each attempt.
- [ ] No framework or SMTP import exists outside `packages/adapters`
      (ESLint boundary check passes).
- [ ] `./validate.sh` passes; `VERSION` and root `package.json#version` match.

## 11. Out of scope / future work

- **Per-user notification preferences + unsubscribe** (needs a preferences
  table and a managed-link unsubscribe flow).
- **Auto-node completion / document-ready notifications** (Phase 5-adjacent).
- **In-app notification centre, web push, SMS.**
- **Digest / batched notifications.**
- **Admin notification-log UI page** (`/admin/notifications`) — the data lands
  in this PRD; the page can follow.
- **Rich/branded HTML templates and localisation.**

## 12. Risks / open questions

- **M365 Basic Auth deprecation** — Microsoft is retiring SMTP AUTH (basic) for
  Exchange Online; OAuth2/XOAUTH2 via an Azure AD app registration is the
  durable path. ADR-023 makes XOAUTH2 a first-class transport mode so this is
  not a later breaking change. **Open:** client-credentials vs. a dedicated
  service-mailbox grant — confirm with the target tenant at build time.
- **Delivery decoupling** — v1 uses `app_notification_log` as an outbox: the
  triggering action commits the `pending` row inside its transaction, then a
  best-effort send runs out of band; a sweeper (reusing the `job_registry`
  pattern) retries `pending`/`failed` rows. **Open:** is a periodic sweeper in
  scope for v1, or is a single inline best-effort attempt enough? (Recommend the
  outbox row + inline attempt now, sweeper as a fast follow.)
- **Idempotency window** — the unique index prevents duplicates permanently;
  confirm that a legitimately re-shared-after-revoke grant should re-notify
  (current design: no, because the row already exists — revisit if needed).
- **PII in email bodies** — keep bodies minimal (flow/session names + link); do
  not embed conversation content or generated documents.
- **Secrets handling** — SMTP/OAuth credentials are environment-only, never
  persisted to `admin_system_settings` or logs.
- **Email-address source** — recipients come from `core_users.email`; users
  without a verified email are skipped and the row is marked `failed` with a
  clear reason.
