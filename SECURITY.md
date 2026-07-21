# Security Policy

Wayfinder is an AI-guided workflow agent used for document-heavy, often governed
processes. We take the security of the project and of deployments seriously. This
document explains how to report a vulnerability and summarises the security
posture of the codebase. It is a living document — corrections and additions are
welcome.

> **Maintainer note:** replace the placeholder contact below with your real
> security contact before publishing this repository to customers.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report suspected vulnerabilities privately via GitHub's private
**Security advisories** ("Report a vulnerability") on this repository.

Please include:

- a description of the issue and its impact,
- steps to reproduce (proof-of-concept if possible),
- affected version (`VERSION` file) and configuration (auth method, providers),
- any suggested remediation.

### What to expect

- **Acknowledgement:** we aim to acknowledge a report within a few business days.
- **Assessment:** we triage and confirm, and share an initial severity assessment.
- **Fix & disclosure:** we work on a fix and coordinate a disclosure timeline with
  you. We support coordinated disclosure and will credit reporters who wish to be
  credited.

Please act in good faith: do not access, modify, or exfiltrate data that is not
yours, and do not run denial-of-service or spam tests against deployments you do
not own.

## Supported versions

Wayfinder is released in alpha lines (`alpha-N` = the `N.x.x` line; see
`docs/guides/managing-releases.md`). Security fixes are applied to the current
alpha's release branch and to `main` (the next alpha). Older alpha lines are not
maintained.

| Version line | Status |
| ------------ | ------ |
| Current `alpha` (latest `2.x`) | Supported |
| Previous alpha lines | Not supported — please upgrade |

## Security posture (summary)

These are properties of the codebase as built today. They are provided for
transparency, not as a compliance certification.

- **Authentication.** Configurable sign-in methods (email/password, Microsoft
  Entra ID via OIDC, and PKI client-certificate). Auth configuration is runtime
  state with a fail-closed rule: a half-configured provider is not offered
  (ADR-025). New federated identities are provisioned as non-admins.
- **Authorization.** Role-based access control with a developer-owned permission
  registry; admins toggle which roles hold each key rather than inventing keys
  (ADR-021). Admin surfaces are gated behind an admin check.
- **Audit logging.** Security-relevant actions are recorded to an audit log
  (`core_audit_log`). *(An admin viewer, export, tamper-evidence, and legal hold
  are planned — see `docs/development/prd/audit-compliance-trail.prd.md`.)*
- **Secrets at rest.** Secret-bearing system settings (AI, storage, n8n, auth, and
  email provider credentials) are encrypted at rest with AES-256-GCM using
  `SETTINGS_ENCRYPTION_KEY`. Provider secrets are never returned to clients — the
  API exposes only `set`/`unset` state.
- **Data retention.** Operator-configurable retention windows prune
  unbounded-growth tables; a zero/negative window means "keep forever" (audit and
  conversation history are not pruned unless explicitly opted in).
- **Transport & rate limiting.** Requests are rate-limited; deployments are
  expected to terminate TLS at the edge and forward client-certificate headers
  only from trusted proxies (`PKI_TRUSTED_PROXY_IPS`).
- **Architecture.** A hexagonal boundary keeps the domain free of framework/IO
  concerns; all port boundaries use a `Result` pattern rather than throwing, which
  keeps error handling explicit across trust boundaries.
- **Observability.** Optional OpenTelemetry tracing and Langfuse instrumentation;
  neither is required to run and both are off unless configured.

## Deployment hardening checklist

Operators are responsible for the environment around the app. At minimum:

- Set a strong, unique `BETTER_AUTH_SECRET` and `SETTINGS_ENCRYPTION_KEY`
  (`openssl rand -hex 32`); never reuse the examples.
- Serve only over TLS; restrict `PKI_TRUSTED_PROXY_IPS` to your real proxies.
- Set `ADMIN_SEED_EMAIL` before first run and remove/lock the seed path after the
  first admin is established.
- Scope object-storage (S3/MinIO) credentials to the app's bucket and enable
  bucket-level encryption.
- Keep provider API keys in the environment or the encrypted settings store — not
  in source control.
- Apply database least-privilege for the application role.
- Keep the deployment on a supported version line.

## Known scope / non-goals (today)

The following are recognised gaps with planning docs in
`docs/development/` and are **not** yet implemented: an audit-log admin
viewer/export with tamper-evidence and legal hold, generic SAML/OIDC SSO and
SCIM provisioning, app-enforced MFA and admin session revocation,
application-managed encryption of stored documents / customer-managed keys, and
multi-tenant data isolation. Treat these as roadmap, not current guarantees, when
assessing the project against enterprise requirements.
