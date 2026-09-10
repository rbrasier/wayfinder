# ADR-023 — Email Notification Transport (Nodemailer, SMTP + M365 OAuth2)

- **Status**: Accepted (implemented in v1.35.0; scoped by `email-notifications.prd.md`)
- **Date**: 2026-05-31 (amended 2026-06-10 at build time)

> **Build-time amendment.** This ADR was drafted (as ADR-014, renumbered to 023
> to resolve a numbering collision) on the assumption that the codebase had no
> mailer. It already had one: the `IEmailSender` port and a
> `NodemailerEmailSender` adapter configured through the admin settings UI
> (credentials in `admin_system_settings`). Rather than adding a parallel
> `INotificationSender` port, notifications **reuse `IEmailSender`** and the
> existing adapter was **extended** with the transport modes below, selected
> from environment variables. When `SMTP_TRANSPORT_MODE` is set the env
> transport takes precedence; otherwise the adapter falls back to the
> admin-settings config, so existing deployments keep working unchanged.

## Context

`email-notifications.prd.md` introduces automated transactional email for two
triggers (session complete, flow shared). The codebase already had a manual
email path (`IEmailSender` + `NodemailerEmailSender`, admin-settings-configured,
used by the admin "send test email" feature) but no automated triggers,
templates, or delivery log.

Constraints:

1. **Hexagonal boundary (ADR-001).** The domain and application layers must not
   import a mail library. A domain port describes "send an email"; only
   `packages/adapters` knows how.
2. **Microsoft 365 / Exchange Online is a target deployment.** Recipients and
   senders in the reference (Australian Government procurement) environment live
   in Exchange Online. Microsoft is **deprecating Basic Auth (SMTP AUTH)** for
   Exchange Online; the durable path is **OAuth2 / XOAUTH2** via an Azure AD app
   registration.
3. **Self-hosted relays and local dev** still need plain SMTP AUTH (and an
   unauthenticated local sink such as Mailpit for tests).
4. **Reliability without blocking.** Completing a session or sharing a flow must
   not fail or stall because an SMTP server is slow or down.

## Decision

### Library and port

Use **Nodemailer** as the transport, behind the **existing** domain port
`IEmailSender` in `packages/domain/src/ports/email-sender.ts`:

```ts
export interface IEmailSender {
  send(input: SendEmailInput): Promise<Result<true>>;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
```

The implementation is the existing `NodemailerEmailSender` in
`packages/adapters/src/email/nodemailer-email-sender.ts`, extended with
environment-driven transport selection (`packages/adapters/src/email/smtp-transport.ts`).
Nodemailer is a dependency of `@wayfinder/adapters` only. The port returns the
Result pattern; it never throws across the boundary.

**Subject and body composition stays in the application layer** as pure string
builders (template literals — no templating framework), so the
"application imports only domain + shared" rule holds. The adapter is a dumb
transport that does not know what a "session" or a "flow" is.

### Transport modes

`NodemailerEmailSender` selects its Nodemailer transport from `SMTP_TRANSPORT_MODE`:

| Mode | Use | Nodemailer auth |
| ---- | --- | --------------- |
| `oauth2` | Microsoft 365 / Exchange Online | `auth: { type: 'OAuth2', user, accessToken }` (XOAUTH2) against `smtp.office365.com:587`; the access token comes from an Azure AD client-credentials grant fetched and cached by the adapter |
| `smtp` | Self-hosted relay, generic provider | `auth: { user, pass }` with host/port/secure from config |
| `stream` | Local dev & tests | Nodemailer `streamTransport` — messages are built but never delivered (no SMTP server needed) |
| *(unset)* | Existing deployments | Falls back to the admin-settings SMTP config (`admin_system_settings.email_config`) |

XOAUTH2 is a first-class mode from day one specifically so the M365 Basic-Auth
deprecation is **not** a future breaking change.

### Delivery model — outbox on `app_notification_log`

Delivery is decoupled from the triggering action:

1. The triggering use-case writes a `pending` row to `app_notification_log`
   **inside the action's own commit** (the outbox).
2. A best-effort send runs out of band; on success the row flips to `sent`, on
   failure to `failed` with the error captured.
3. A unique index on `(trigger, resource_id, recipient_email)` makes sends
   idempotent.
4. A future sweeper (reusing the `job_registry` pattern) retries
   `pending`/`failed` rows. Whether the sweeper ships in v1 is an open question
   in the PRD; the outbox row exists regardless so no event is lost.

A send attempt also writes a `notification.sent` / `notification.failed` event
to `core_audit_log`.

### Environment variables

| Var | Required when | Notes |
| --- | ------------- | ----- |
| `NOTIFICATIONS_ENABLED` | always | `false` (the default) still writes outbox rows but skips the send, so no event is lost and a later sweeper can deliver. |
| `SMTP_TRANSPORT_MODE` | env transport | `oauth2` \| `smtp` \| `stream`. Unset = fall back to the admin-settings SMTP config. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `smtp` | Host defaults to `smtp.office365.com:587` for `oauth2`. |
| `SMTP_USER` / `SMTP_PASS` | `smtp` | Basic SMTP AUTH. `SMTP_USER` doubles as the XOAUTH2 mailbox for `oauth2` (defaults to `SMTP_FROM`). |
| `M365_TENANT_ID` / `M365_CLIENT_ID` / `M365_CLIENT_SECRET` | `oauth2` | Azure AD app registration for XOAUTH2 (client-credentials grant, scope `https://outlook.office365.com/.default`). |
| `SMTP_FROM` | env transport | From address / sender mailbox. |
| `WEB_BASE_URL` | `apps/api` only | Base URL for links in email bodies (the web app uses `BETTER_AUTH_URL`). |

Notification credentials supplied via the environment are never persisted to
`admin_system_settings` or written to logs. The pre-existing admin-settings SMTP
config (which does store credentials in the database) remains supported as the
fallback for deployments configured through the UI.

## Consequences

**Positive**

- One library, one port; transport mode is config, not code.
- M365 OAuth2 supported from day one — no later breaking migration off Basic
  Auth.
- The outbox guarantees a triggering action never fails because of email, and
  gives a natural audit/retry surface.
- Bodies composed in the application layer keep the adapter provider-agnostic;
  swapping Nodemailer for an HTTP API later is an adapter change only.

**Negative**

- The outbox + idempotency index is more than a fire-and-forget call — extra
  table and write per event. Justified by reliability and de-duplication.
- M365 OAuth2 requires an Azure AD app registration and tenant configuration
  outside the codebase; documented as a deployment prerequisite.

## Open questions — resolved at build (v1.35.0)

- **Sweeper in v1?** No — outbox row + single inline best-effort attempt ships
  in v1; the periodic retry sweeper (consuming `listPending`) is a fast follow.
- **M365 grant type** — implemented as a client-credentials grant against
  `login.microsoftonline.com/<tenant>/oauth2/v2.0/token`; a dedicated
  service-mailbox grant would only change the Azure-side configuration.
- **`NOTIFICATIONS_ENABLED=false` semantics** — the outbox row is still written
  (status stays `pending`) and the send is skipped, keeping the event auditable
  and recoverable.
