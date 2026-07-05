# Implementation Summary — Settings Connectivity Test

- **Version**: `1.46.0` (bump: **MINOR** — new read-only admin feature, no schema change)
- **Phase doc**: `settings-connectivity-test.phase.md` (this folder)

## What was built

Admins can now confirm, on demand, that each configured integration on
`/admin/settings` is **actually reachable with the saved credentials** — not just
"set". Each applicable card gains a **Test connectivity** button and a status
badge; the page header gains a **Test all** button that fans every probe out in
parallel, with each card's badge resolving independently as its probe returns.

This generalises the precedent of the Email card's existing "Send test" action
into live, **lightweight** probes across all external-dependency cards: no email
is sent, no object is written, and no token-generating AI call is made.

## Probes (lightweight, live)

| Target | Probe |
|--------|-------|
| AI provider | Auth ping (`GET /v1/models`) against Anthropic / OpenAI / Mistral. No completion call. |
| Storage (MinIO/S3) | `bucketExists()` on the configured bucket. |
| Email (SMTP / M365) | SMTP `transport.verify()` handshake, or M365 client-credentials token acquisition. No message sent. |
| n8n | Authenticated `GET /api/v1/workflows?limit=1`. |
| RAG embeddings | local: in-process model load (embed a tiny string); openai: `GET /v1/models` auth ping. |
| Entra / Graph | Scoped Graph probe (`GET /users?$top=1&$select=id`) — validates token + `User.Read.All`. |

Each probe is bounded by a timeout (default 8 s) so a hung endpoint cannot stall
a parallel "Test all". Failures surface a **sanitised** reason (e.g. `HTTP 401`,
`ENOTFOUND`, `SMTP verification failed (EAUTH)`) and never echo a credential.
Unconfigured targets come back `skipped` rather than failing.

## Layering (per CLAUDE.md)

Mirrors the existing `CompositeHealthChecker` pattern.

- **domain** — `ConnectivityTarget` union + `ConnectivityResult` entity (pure,
  zero deps); `IConnectivityTester` port (Result pattern only).
- **adapters** — standalone, injectable probe functions plus
  `CompositeConnectivityTester implements IConnectivityTester`, which holds the
  integration dependencies, dispatches per target, runs `testAll` with
  `Promise.all`, and maps every probe failure into a `ConnectivityResult`
  (never throws across the boundary).
- **apps/web** — `container.connectivityTester` wiring; two `adminProcedure`s
  (`testConnectivity`, `testAllConnectivity`); per-card buttons + badges and the
  header Test-all (client-side parallel fan-out so badges populate as they
  resolve).

No application-layer use case was added — the established `sendTestEmail`
precedent calls the adapter-backed service directly through the container; the
new domain port is wired the same way.

## Known limitations

- **Amazon Bedrock** has no lightweight live probe: a real check needs
  SigV4-signed control-plane calls, which are out of scope here. The AI probe
  reports Bedrock as `skipped` ("Live probe not supported for Bedrock") rather
  than faking a result. Anthropic / OpenAI / Mistral are probed live.

## Files created

- `packages/domain/src/entities/connectivity.ts` — `ConnectivityTarget`,
  `ConnectivityResult`, `CONNECTIVITY_TARGETS`.
- `packages/domain/src/entities/connectivity.test.ts`
- `packages/domain/src/ports/connectivity-tester.ts` — `IConnectivityTester`.
- `packages/adapters/src/health/connectivity-probes.ts` — per-target probe
  functions, timeout + error-sanitising helpers, minio client factory.
- `packages/adapters/src/health/connectivity-probes.test.ts`
- `packages/adapters/src/health/composite-connectivity-tester.ts` —
  `CompositeConnectivityTester`.
- `packages/adapters/src/health/composite-connectivity-tester.test.ts`
- `apps/web/e2e/enhance-settings-connectivity.spec.ts` — covering e2e.

## Files modified

- `packages/domain/src/entities/index.ts`, `packages/domain/src/ports/index.ts`
  — export the new entity + port.
- `packages/adapters/src/health/index.ts` — export the probes + composite tester.
- `packages/adapters/src/email/nodemailer-email-sender.ts` — add
  `testConnectivity()` (SMTP `verify()` / M365 token, never sends) + sanitised
  failure message helper.
- `packages/adapters/src/email/nodemailer-email-sender.test.ts` — connectivity
  test coverage.
- `apps/web/src/lib/container.ts` — instantiate + expose `connectivityTester`.
- `apps/web/src/server/routers/settings.ts` — `testConnectivity` /
  `testAllConnectivity` admin procedures.
- `apps/web/src/app/(admin)/admin/settings/page.tsx` — connectivity controller
  hook, status badge, per-card Test connectivity buttons (shown only when the
  card is configured) and the header Test all button.
- `VERSION`, `package.json` — `1.45.0` → `1.46.0`.

## Migrations run

**None.** Probes read existing `admin_system_settings` config via the runtime
config store and hit live services. No new table, column, or migration.

## E2E tests added

`apps/web/e2e/enhance-settings-connectivity.spec.ts`:

- Drives a per-card **Test connectivity** button and asserts the badge reaches a
  terminal state (`ok` / `failed` / `skipped`).
- Drives **Test all** and asserts the always-rendered card badges (embeddings,
  entra) each resolve to a terminal state from the single fan-out click.

The spec asserts the button → terminal-badge contract, not that a specific
service is reachable, so it is deterministic regardless of sandbox network
access.
